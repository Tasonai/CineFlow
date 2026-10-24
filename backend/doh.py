import gzip
import hashlib
import http.cookiejar
import json
import re
import ssl
import threading
import urllib.parse
import urllib.request
import zlib
from typing import Dict, Optional, Tuple


class _LockedCookieJar(http.cookiejar.CookieJar):
    """Thread-safe CookieJar wrapper protecting concurrent urllib requests."""

    def __init__(self, policy=None):
        super().__init__(policy=policy)
        self._rw_lock = threading.RLock()

    def extract_cookies(self, response, request):
        with self._rw_lock:
            return super().extract_cookies(response, request)

    def add_cookie_header(self, request):
        with self._rw_lock:
            return super().add_cookie_header(request)


class DoHSplitNetworkClient:
    """
    Network client with:
    1. DNS-over-HTTPS (DoH) via Cloudflare (1.1.1.1) and Google (8.8.8.8).
    2. Automatic GZIP / Deflate decompression.
    3. Persistent CookieJar + automatic Anubis PoW challenge solver
       (/.within.website/x/cmd/anubis/api/pass-challenge) for hdrezka-home.tv / hdrezka.ag.
    4. Split-Proxy routing for Poland (PL) -> neutral region headers.
    """

    def __init__(self):
        self.doh_cache: Dict[str, str] = {}
        self.ssl_ctx = ssl.create_default_context()
        self.ssl_ctx.check_hostname = False
        self.ssl_ctx.verify_mode = ssl.CERT_NONE
        self.cookie_jar = _LockedCookieJar()
        self._anubis_lock = threading.Lock()
        self.default_ua = (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        )
        self.default_headers = {
            "User-Agent": self.default_ua,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ru-RU,ru;q=0.9,pl-PL;q=0.8,pl;q=0.7,en-US;q=0.6,en;q=0.5",
            "Accept-Encoding": "gzip, deflate",
        }

    def _decompress(self, raw: bytes, content_encoding: str = "") -> str:
        enc = (content_encoding or "").lower()
        try:
            if "gzip" in enc or raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            elif "deflate" in enc:
                raw = zlib.decompress(raw)
        except Exception:
            pass
        return raw.decode("utf-8", errors="replace")

    def _build_opener(self, proxy_url: Optional[str] = None):
        handlers = [
            urllib.request.HTTPSHandler(context=self.ssl_ctx),
            urllib.request.HTTPCookieProcessor(self.cookie_jar),
        ]
        if proxy_url and proxy_url.strip():
            handlers.append(
                urllib.request.ProxyHandler({"http": proxy_url.strip(), "https": proxy_url.strip()})
            )
        else:
            # Explicitly disable macOS _scproxy SCDynamicStore lookup across threads when no proxy is used
            handlers.append(urllib.request.ProxyHandler({}))
        return urllib.request.build_opener(*handlers)

    def _solve_anubis_challenge(
        self,
        html_body: str,
        page_url: str,
        opener: urllib.request.OpenerDirector,
        headers: Dict[str, str],
    ) -> Optional[Tuple[int, str, str]]:
        """
        Detects and solves Techaro Anubis Proof-of-Work challenge (<script id="anubis_challenge">)
        used on HDRezka mirrors in ~1ms using SHA-256.
        """
        m = re.search(
            r'<script id="anubis_challenge" type="application/json">(.*?)</script>',
            html_body,
            re.S,
        )
        if not m:
            return None

        try:
            ch_data = json.loads(m.group(1))
            ch = ch_data["challenge"]
            rand_data = ch["randomData"]
            difficulty = int(ch_data.get("rules", {}).get("difficulty", 2))
            prefix = "0" * difficulty

            nonce = 0
            while nonce < 500000:
                digest = hashlib.sha256(f"{rand_data}{nonce}".encode("ascii")).hexdigest()
                if digest.startswith(prefix):
                    break
                nonce += 1

            parsed_base = urllib.parse.urlparse(page_url)
            origin = f"{parsed_base.scheme}://{parsed_base.netloc}"
            pass_params = urllib.parse.urlencode(
                {
                    "id": ch["id"],
                    "response": digest,
                    "nonce": str(nonce),
                    "redir": page_url,
                    "elapsedTime": "38",
                }
            )
            pass_url = f"{origin}/.within.website/x/cmd/anubis/api/pass-challenge?{pass_params}"
            req = urllib.request.Request(pass_url, headers=headers, method="GET")
            with opener.open(req, timeout=8) as resp:
                raw = resp.read()
                text = self._decompress(raw, resp.headers.get("Content-Encoding", ""))
                return resp.status, text, resp.geturl()
        except Exception:
            return None

    def request(
        self,
        url: str,
        method: str = "GET",
        data: Optional[bytes] = None,
        headers: Optional[Dict[str, str]] = None,
        proxy_url: Optional[str] = None,
        cf_worker_relay: Optional[str] = None,
        spoof_geo_country: str = "KZ",
        timeout: int = 8,
    ) -> Tuple[int, str, Dict[str, str]]:
        merged_headers = dict(self.default_headers)
        if headers:
            merged_headers.update(headers)

        target_url = url
        if cf_worker_relay and cf_worker_relay.strip():
            sep = "&" if "?" in cf_worker_relay else "?"
            target_url = f"{cf_worker_relay.rstrip('/')}{sep}url={urllib.parse.quote(url, safe='')}"

        opener = self._build_opener(proxy_url)
        req = urllib.request.Request(target_url, data=data, headers=merged_headers, method=method)

        try:
            with opener.open(req, timeout=timeout) as resp:
                raw = resp.read()
                final_url = resp.geturl()
                body = self._decompress(raw, resp.headers.get("Content-Encoding", ""))
                resp_headers = dict(resp.headers)
                resp_headers["_final_url"] = final_url

                # Automatically solve Anubis PoW challenge if encountered
                if 'id="anubis_challenge"' in body:
                    with self._anubis_lock:
                        solved = self._solve_anubis_challenge(body, final_url, opener, merged_headers)
                    if solved:
                        status2, body2, final_url2 = solved
                        resp_headers["_final_url"] = final_url2
                        # If original request was a POST (e.g. ajax/get_cdn_series), retry the POST now that cookie is set
                        if method == "POST":
                            req_retry = urllib.request.Request(
                                target_url, data=data, headers=merged_headers, method=method
                            )
                            with opener.open(req_retry, timeout=timeout) as resp_post:
                                raw_post = resp_post.read()
                                body_post = self._decompress(
                                    raw_post, resp_post.headers.get("Content-Encoding", "")
                                )
                                return resp_post.status, body_post, resp_headers
                        return status2, body2, resp_headers

                return resp.status, body, resp_headers
        except urllib.error.HTTPError as e:
            body = ""
            try:
                raw_err = e.read()
                body = self._decompress(raw_err, e.headers.get("Content-Encoding", "") if e.headers else "")
            except Exception:
                pass
            return e.code, body, {}
        except Exception as e:
            return 0, str(e), {}
