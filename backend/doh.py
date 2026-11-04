import gzip
import hashlib
import http.client
import http.cookiejar
import io
import ipaddress
import json
import re
import socket
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable, Dict, List, Optional, Tuple

from .regions import get_country_profile

from .net_security import (
    _CTRL_CHAR_RE,
    _DISALLOWED_HOST_SUFFIXES,
    _LockedCookieJar,
    _SafePublicHTTPConnection,
    _SafePublicHTTPHandler,
    _SafeRedirectHandler,
    _is_disallowed_hostname,
    _is_valid_public_ip_addr,
    _merge_cookie_header_strings,
    _resolve_verified_public_ips,
    _sanitize_header_str,
    validate_safe_external_url,
)

class _DoHHTTPSConnection(http.client.HTTPSConnection):
    """HTTPSConnection that connects TCP to a DoH-resolved or verified public IP while preserving TLS SNI."""

    def __init__(
        self,
        host: str,
        *args,
        doh_resolver: Optional[Callable[[str], str]] = None,
        pre_resolved_map: Optional[Dict[str, str]] = None,
        enforce_public_ip: bool = True,
        **kwargs,
    ):
        super().__init__(host, *args, **kwargs)
        self._doh_resolver = doh_resolver
        self._pre_resolved_map = pre_resolved_map or {}
        self._enforce_public_ip = enforce_public_ip

    def connect(self):
        if self._tunnel_host:
            return super().connect()

        clean_host = (self.host or "").strip().lower().rstrip(".")
        ip_addr = self._pre_resolved_map.get(clean_host, "")
        if not ip_addr and self._doh_resolver is not None:
            ip_addr = self._doh_resolver(clean_host)

        if ip_addr:
            if self._enforce_public_ip and not _is_valid_public_ip_addr(ip_addr):
                raise urllib.error.URLError(f"Blocked non-public DoH IP {ip_addr} for {clean_host}")
            candidate_ips = [ip_addr]
        elif self._enforce_public_ip:
            candidate_ips = _resolve_verified_public_ips(self.host, self.port or 443)
        else:
            return super().connect()

        candidate_ips.sort(key=lambda ip: 1 if ":" in ip else 0)
        attempt_timeout = min(3.0, self.timeout) if len(candidate_ips) > 1 and self.timeout else self.timeout

        last_err: Optional[Exception] = None
        for cand_ip in candidate_ips:
            raw_sock = None
            try:
                raw_sock = socket.create_connection(
                    (cand_ip, self.port or 443),
                    attempt_timeout,
                    self.source_address,
                )
                if self.timeout:
                    raw_sock.settimeout(self.timeout)
                self.sock = self._context.wrap_socket(
                    raw_sock,
                    server_hostname=(clean_host.strip("[]") or self.host),
                )
                return
            except Exception as exc:
                last_err = exc
                if raw_sock is not None:
                    try:
                        raw_sock.close()
                    except Exception:
                        pass
        if last_err is not None:
            raise last_err
        raise urllib.error.URLError(f"Unable to connect to {self.host}")


class _DoHHTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(
        self,
        context: ssl.SSLContext,
        doh_resolver: Optional[Callable[[str], str]] = None,
        pre_resolved_map: Optional[Dict[str, str]] = None,
        enforce_public_ip: bool = True,
    ):
        super().__init__(context=context)
        self._ctx = context
        self._doh_resolver = doh_resolver
        self._pre_resolved_map = pre_resolved_map or {}
        self._enforce_public_ip = enforce_public_ip

    def https_open(self, req):
        def _conn_factory(host, **kwargs):
            kwargs.setdefault("context", self._ctx)
            return _DoHHTTPSConnection(
                host,
                doh_resolver=self._doh_resolver,
                pre_resolved_map=self._pre_resolved_map,
                enforce_public_ip=self._enforce_public_ip,
                **kwargs,
            )

        return self.do_open(_conn_factory, req)


def _wrap_cf_worker_relay_url(relay_url: str, inner_url: str) -> str:
    clean_relay = _CTRL_CHAR_RE.sub("", (relay_url or "").strip())
    if not clean_relay:
        return inner_url
    p_rel = urllib.parse.urlparse(clean_relay)
    if p_rel.scheme not in ("http", "https") or not p_rel.hostname:
        return inner_url
    if "url=" in clean_relay:
        prefix = clean_relay.split("url=", 1)[0] + "url="
        return f"{prefix}{urllib.parse.quote(inner_url, safe='')}"
    sep = "&" if "?" in clean_relay else "?"
    return f"{clean_relay.rstrip('/')}{sep}url={urllib.parse.quote(inner_url, safe='')}"


class DoHSplitNetworkClient:
    """
    Network client with:
    1. Real DNS-over-HTTPS (DoH) via Cloudflare (1.1.1.1) and Google (8.8.8.8) preserving TLS SNI.
    2. Automatic GZIP / Deflate decompression.
    3. Persistent CookieJar + automatic Anubis PoW challenge solver
       (/.within.website/x/cmd/anubis/api/pass-challenge) for hdrezka-home.tv / hdrezka.ag.
    4. Country-aware censorship bypass & neutral geo-forwarding headers per European country.
    """

    _GEO_SPOOF_IPS: Dict[str, Tuple[str, str]] = {
        "KZ": ("2.132.148.42", "KZ"),
        "AM": ("37.252.88.19", "AM"),
        "MD": ("178.168.72.14", "MD"),
    }

    _CENSORED_HOST_MARKERS = (
        "rezka",
        "hdrezka",
        "voidboost",
        "jacred",
        "jac.red",
        "torrentio",
        "rutracker",
        "rutor",
        "nnmclub",
        "kinozal",
        "thepiratebay",
        "opensubtitles",
    )

    def __init__(self):
        self.doh_cache: Dict[str, Tuple[str, float]] = {}
        self._doh_lock = threading.Lock()
        self.country_code: str = "PL"
        self.doh_enabled: bool = True
        self.kinorium_domain_fallback: bool = True
        self.p2p_strict: bool = False
        self.local_media_proxy: bool = False

        self.ssl_ctx = ssl.create_default_context()
        self.ssl_ctx.check_hostname = False
        self.ssl_ctx.verify_mode = ssl.CERT_NONE
        self._doh_verify_ctx = ssl.create_default_context()
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
        self.configure_country("PL")

    def configure_country(self, country_code: str) -> Dict[str, Any]:
        prof = get_country_profile(country_code)
        self.country_code = prof["code"]
        self.doh_enabled = bool(prof["doh_enabled"])
        self.kinorium_domain_fallback = bool(prof["kinorium_domain_fallback"])
        self.p2p_strict = bool(prof["p2p_strict"])
        self.local_media_proxy = bool(prof.get("local_media_proxy", False))
        new_headers = dict(self.default_headers)
        raw_al = f"ru-RU,ru;q=0.9,{prof['accept_language']},en-US;q=0.6,en;q=0.5"
        seen_langs = set()
        dedup_al: List[str] = []
        for token in raw_al.split(","):
            tok = token.strip()
            if not tok:
                continue
            lang_key = tok.split(";", 1)[0].strip().lower()
            if lang_key and lang_key not in seen_langs:
                seen_langs.add(lang_key)
                dedup_al.append(tok)
        new_headers["Accept-Language"] = ",".join(dedup_al)
        self.default_headers = new_headers
        return prof

    @staticmethod
    def _is_valid_public_ip(ip_str: str) -> bool:
        return _is_valid_public_ip_addr(ip_str)

    @staticmethod
    def _is_valid_public_ipv4(ip_str: str) -> bool:
        try:
            ip_obj = ipaddress.IPv4Address((ip_str or "").strip())
            return ip_obj.version == 4 and _is_valid_public_ip_addr(str(ip_obj))
        except Exception:
            return False

    def _should_proactively_doh(self, host: str) -> bool:
        if not self.doh_enabled or not host:
            return False
        h = host.strip().lower()
        if any(m in h for m in self._CENSORED_HOST_MARKERS):
            return True
        if self.kinorium_domain_fallback and "kinorium.com" in h:
            return True
        return False

    def resolve_doh_ipv4(self, host: str) -> str:
        clean_host = (host or "").strip().lower().rstrip(".")
        if _is_disallowed_hostname(clean_host) or clean_host in ("127.0.0.1", "::1"):
            return ""
        try:
            ipaddress.ip_address(clean_host)
            return ""
        except ValueError:
            pass
        try:
            ascii_host = clean_host.encode("idna").decode("ascii")
        except Exception:
            ascii_host = clean_host

        now = time.time()
        with self._doh_lock:
            cached = self.doh_cache.get(clean_host)
            if cached and cached[1] > now:
                # Negative entries ("") are cached briefly so blocked DoH endpoints
                # never add ~7.5 s of timeouts to every single request.
                return cached[0]

        endpoints = (
            f"https://1.1.1.1/dns-query?name={urllib.parse.quote(ascii_host)}&type=A",
            f"https://8.8.8.8/resolve?name={urllib.parse.quote(ascii_host)}&type=A",
            f"https://9.9.9.9:5053/dns-query?name={urllib.parse.quote(ascii_host)}&type=A",
        )
        # DoH answers decide which IP we connect to, so the resolver endpoints themselves
        # are always verified (1.1.1.1 / 8.8.8.8 / 9.9.9.9 carry IP SANs in their certificates).
        direct_opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=self._doh_verify_ctx),
            urllib.request.ProxyHandler({}),
        )

        def _query_doh_ep(ep: str) -> Optional[Tuple[str, int]]:
            try:
                req = urllib.request.Request(
                    ep,
                    headers={
                        "Accept": "application/dns-json",
                        "User-Agent": self.default_ua,
                    },
                    method="GET",
                )
                with direct_opener.open(req, timeout=2.2) as resp:
                    if resp.status != 200:
                        return None
                    payload = json.loads(resp.read(65536).decode("utf-8", errors="ignore"))
                for ans in payload.get("Answer") or []:
                    if int(ans.get("type") or 0) == 1:
                        cand_ip = str(ans.get("data") or "").strip()
                        if self._is_valid_public_ipv4(cand_ip):
                            ttl = max(300, min(3600, int(ans.get("TTL") or 1800)))
                            return (cand_ip, ttl)
            except Exception:
                pass
            return None

        # Query resolvers in parallel so blocked endpoints (e.g. 1.1.1.1 in RU/BY) don't stall the request
        pool = ThreadPoolExecutor(max_workers=len(endpoints))
        try:
            futures = [pool.submit(_query_doh_ep, ep) for ep in endpoints]
            for f in as_completed(futures, timeout=2.8):
                res = f.result()
                if res is not None:
                    cand_ip, ttl = res
                    with self._doh_lock:
                        if len(self.doh_cache) > 512:
                            for k_ev in list(self.doh_cache.keys())[:128]:
                                self.doh_cache.pop(k_ev, None)
                        self.doh_cache[clean_host] = (cand_ip, now + ttl)
                    return cand_ip
        except Exception:
            pass
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

        with self._doh_lock:
            if len(self.doh_cache) > 512:
                for k_ev in list(self.doh_cache.keys())[:128]:
                    self.doh_cache.pop(k_ev, None)
            self.doh_cache[clean_host] = ("", time.time() + 60)
        return ""

    def _forget_doh_host(self, host: str) -> None:
        with self._doh_lock:
            self.doh_cache.pop((host or "").strip().lower().rstrip("."), None)

    MAX_DECOMPRESSED_BYTES = 16 * 1024 * 1024  # 16 MB zip-bomb cap

    @classmethod
    def _decompress_bytes(
        cls,
        raw: bytes,
        content_encoding: str = "",
        max_bytes: Optional[int] = None,
    ) -> bytes:
        if not raw:
            return b""
        limit = max_bytes if max_bytes is not None else cls.MAX_DECOMPRESSED_BYTES
        enc = (content_encoding or "").lower()
        has_gzip_magic = len(raw) >= 2 and raw[:2] == b"\x1f\x8b"
        if has_gzip_magic:
            try:
                with gzip.GzipFile(fileobj=io.BytesIO(raw)) as gz:
                    raw = gz.read(limit)
            except Exception:
                try:
                    dobj = zlib.decompressobj(16 + zlib.MAX_WBITS)
                    raw = dobj.decompress(raw, limit)
                except Exception:
                    return b""
        elif "gzip" in enc:
            # Upstream relay / transparent proxy stripped gzip framing while keeping the Content-Encoding header
            raw = raw[:limit]
        elif "deflate" in enc:
            try:
                try:
                    dobj = zlib.decompressobj(zlib.MAX_WBITS)
                    raw = dobj.decompress(raw, limit)
                except zlib.error:
                    dobj = zlib.decompressobj(-zlib.MAX_WBITS)
                    raw = dobj.decompress(raw, limit)
            except Exception:
                lead = raw[:64].lstrip()[:1]
                if lead in (b"<", b"{", b"["):
                    raw = raw[:limit]
                else:
                    return b""
        else:
            raw = raw[:limit]
        return raw

    @classmethod
    def _decompress(
        cls,
        raw: bytes,
        content_encoding: str = "",
        max_bytes: Optional[int] = None,
    ) -> str:
        raw_out = cls._decompress_bytes(raw, content_encoding=content_encoding, max_bytes=max_bytes)
        if not raw_out:
            return ""
        return raw_out.decode("utf-8", errors="replace")

    def _build_opener(
        self,
        proxy_url: Optional[str] = None,
        cf_worker_relay: Optional[str] = None,
        use_doh: bool = False,
        pre_resolved_map: Optional[Dict[str, str]] = None,
        cookie_jar: Optional[http.cookiejar.CookieJar] = None,
        use_cookies: bool = True,
        verify_tls: bool = True,
    ):
        clean_proxy = (proxy_url or "").strip()
        tls_ctx = self._doh_verify_ctx if verify_tls else self.ssl_ctx
        if not clean_proxy:
            https_handler: urllib.request.BaseHandler = _DoHHTTPSHandler(
                context=tls_ctx,
                doh_resolver=(self.resolve_doh_ipv4 if use_doh else None),
                pre_resolved_map=pre_resolved_map,
                enforce_public_ip=True,
            )
            http_handler: urllib.request.BaseHandler = _SafePublicHTTPHandler()
        else:
            https_handler = urllib.request.HTTPSHandler(context=tls_ctx)
            http_handler = urllib.request.HTTPHandler()

        handlers: List[urllib.request.BaseHandler] = [
            http_handler,
            https_handler,
            _SafeRedirectHandler(cf_worker_relay=cf_worker_relay or ""),
        ]
        if cookie_jar is not None:
            handlers.append(urllib.request.HTTPCookieProcessor(cookie_jar))
        elif use_cookies:
            handlers.append(urllib.request.HTTPCookieProcessor(self.cookie_jar))
        if clean_proxy:
            handlers.append(
                urllib.request.ProxyHandler({"http": clean_proxy, "https": clean_proxy})
            )
        else:
            # Explicitly disable macOS _scproxy SCDynamicStore lookup across threads when no proxy is used
            handlers.append(urllib.request.ProxyHandler({}))
        return urllib.request.build_opener(*handlers)

    @classmethod
    def build_geo_headers(cls, spoof_geo_country: str) -> Dict[str, str]:
        region = (spoof_geo_country or "").strip().upper()
        if not region or region == "DIRECT":
            return {}
        spoof_entry = cls._GEO_SPOOF_IPS.get(region)
        if not spoof_entry:
            return {}
        ip_val, cc_val = spoof_entry
        return {
            "X-Forwarded-For": ip_val,
            "X-Real-IP": ip_val,
            "CF-IPCountry": cc_val,
        }

    def _solve_anubis_challenge(
        self,
        html_body: str,
        page_url: str,
        opener: urllib.request.OpenerDirector,
        headers: Dict[str, str],
        skip_target_get: bool = False,
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
            if not isinstance(ch_data, dict):
                return None
            ch = ch_data.get("challenge")
            rules = ch_data.get("rules") if isinstance(ch_data.get("rules"), dict) else {}
            if isinstance(ch, dict):
                rand_data = str(ch.get("randomData") or "")
                ch_id = str(ch.get("id") or "")
                raw_diff = rules.get("difficulty", ch.get("difficulty", 2))
            elif isinstance(ch, str):
                rand_data = ch
                ch_id = str(ch_data.get("id") or "")
                raw_diff = rules.get("difficulty", ch_data.get("difficulty", 2))
            else:
                return None
            if not rand_data or len(rand_data) > 512:
                return None
            difficulty = max(1, min(5, int(raw_diff or 2)))
            prefix = "0" * difficulty
            rand_bytes = rand_data.encode("utf-8", errors="ignore")

            with self._anubis_lock:
                nonce = 0
                digest = ""
                found_pow = False
                while nonce < 2_500_000:
                    digest = hashlib.sha256(rand_bytes + str(nonce).encode("ascii")).hexdigest()
                    if digest.startswith(prefix):
                        found_pow = True
                        break
                    nonce += 1
                if not found_pow:
                    return None

                parsed_base = urllib.parse.urlparse(page_url)
                if parsed_base.scheme not in ("http", "https") or not parsed_base.netloc:
                    return None
                origin = f"{parsed_base.scheme}://{parsed_base.netloc}"
                pass_query_dict: Dict[str, str] = {
                    "response": digest,
                    "nonce": str(nonce),
                    "redir": "/",
                    "elapsedTime": "100",
                }
                if ch_id:
                    pass_query_dict["id"] = ch_id
                pass_params = urllib.parse.urlencode(pass_query_dict)
                pass_url = f"{origin}/.within.website/x/cmd/anubis/api/pass-challenge?{pass_params}"
                if "url=" in parsed_base.query:
                    q_map = urllib.parse.parse_qs(parsed_base.query)
                    inner_u = (q_map.get("url") or [""])[0]
                    if inner_u.startswith(("http://", "https://")):
                        p_in = urllib.parse.urlparse(inner_u)
                        inner_origin = f"{p_in.scheme}://{p_in.netloc}"
                        inner_pass = f"{inner_origin}/.within.website/x/cmd/anubis/api/pass-challenge?{pass_params}"
                        pass_url = _wrap_cf_worker_relay_url(page_url, inner_pass)
                pass_headers = dict(headers)
                pass_headers["Referer"] = _sanitize_header_str(page_url)
                req_pass = urllib.request.Request(pass_url, headers=pass_headers, method="GET")
                try:
                    with opener.open(req_pass, timeout=8) as resp_pass:
                        resp_pass.read(65536)
                except urllib.error.HTTPError as he_pass:
                    try:
                        he_pass.read(16384)
                    finally:
                        he_pass.close()

            if skip_target_get:
                self._last_anubis_raw_bytes = b""
                return 200, "", page_url, b""

            req_target = urllib.request.Request(page_url, headers=headers, method="GET")
            with opener.open(req_target, timeout=8) as resp_target:
                raw = resp_target.read(self.MAX_DECOMPRESSED_BYTES)
                dec_bytes = self._decompress_bytes(raw, resp_target.headers.get("Content-Encoding", ""))
                self._last_anubis_raw_bytes = dec_bytes
                text = dec_bytes.decode("utf-8", errors="replace") if dec_bytes else ""
                return resp_target.status, text, resp_target.geturl(), dec_bytes
        except Exception:
            return None

    def _try_recover_anubis(
        self,
        body: str,
        final_url: str,
        target_url: str,
        method: str,
        data: Optional[bytes],
        merged_headers: Dict[str, str],
        opener: urllib.request.OpenerDirector,
        timeout: int,
    ) -> Optional[Tuple[int, str, Dict[str, str]]]:
        if 'id="anubis_challenge"' not in body:
            return None
        is_post = method.upper() == "POST"
        solved = self._solve_anubis_challenge(
            body, final_url, opener, merged_headers, skip_target_get=is_post
        )
        if not solved:
            return None
        if len(solved) == 4:
            status2, body2, final_url2, raw_solved_bytes = solved
        else:
            status2, body2, final_url2 = solved
            raw_solved_bytes = getattr(self, "_last_anubis_raw_bytes", None)
        if not isinstance(raw_solved_bytes, (bytes, bytearray)):
            raw_solved_bytes = body2.encode("utf-8", errors="replace")
        resp_headers: Dict[str, str] = {
            "_final_url": final_url2,
            "_raw_bytes": bytes(raw_solved_bytes),
        }
        if is_post:
            req_retry = urllib.request.Request(
                target_url, data=data, headers=merged_headers, method="POST"
            )
            with opener.open(req_retry, timeout=timeout) as resp_post:
                raw_post = resp_post.read(self.MAX_DECOMPRESSED_BYTES)
                dec_post_bytes = self._decompress_bytes(
                    raw_post, resp_post.headers.get("Content-Encoding", "")
                )
                body_post = dec_post_bytes.decode("utf-8", errors="replace") if dec_post_bytes else ""
                post_headers = dict(resp_post.headers)
                post_headers["_final_url"] = resp_post.geturl() or final_url2
                post_headers["_raw_bytes"] = dec_post_bytes
                return resp_post.status, body_post, post_headers
        return status2, body2, resp_headers

    def _execute_once(
        self,
        target_url: str,
        method: str,
        data: Optional[bytes],
        merged_headers: Dict[str, str],
        opener: urllib.request.OpenerDirector,
        timeout: int,
    ) -> Tuple[int, str, Dict[str, str]]:
        req = urllib.request.Request(target_url, data=data, headers=merged_headers, method=method)
        try:
            with opener.open(req, timeout=timeout) as resp:
                raw = resp.read(self.MAX_DECOMPRESSED_BYTES)
                final_url = resp.geturl()
                dec_bytes = self._decompress_bytes(raw, resp.headers.get("Content-Encoding", ""))
                body = dec_bytes.decode("utf-8", errors="replace") if dec_bytes else ""
                resp_headers = dict(resp.headers)
                resp_headers["_final_url"] = final_url
                resp_headers["_raw_bytes"] = dec_bytes

                recovered = self._try_recover_anubis(
                    body, final_url, target_url, method, data, merged_headers, opener, timeout
                )
                if recovered is not None:
                    rec_st, rec_body, rec_hdrs = recovered
                    resp_headers.update(rec_hdrs)
                    if "_raw_bytes" not in rec_hdrs:
                        resp_headers["_raw_bytes"] = rec_body.encode("utf-8", errors="replace")
                    return rec_st, rec_body, resp_headers

                return resp.status, body, resp_headers
        except urllib.error.HTTPError as he:
            if he.code in (401, 403, 429, 503):
                err_body = ""
                err_url = he.geturl() or target_url
                try:
                    raw_ch = he.read(2 * 1024 * 1024)
                    err_body = self._decompress(
                        raw_ch, he.headers.get("Content-Encoding", "") if he.headers else ""
                    )
                except Exception:
                    err_body = ""
                finally:
                    try:
                        he.close()
                    except Exception:
                        pass
                recovered = self._try_recover_anubis(
                    err_body, err_url, target_url, method, data, merged_headers, opener, timeout
                )
                if recovered is not None:
                    return recovered
                return he.code, err_body, {"_final_url": err_url}
            raise

    def fetch_text(
        self,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        timeout: float = 8.0,
        **kwargs: Any,
    ) -> Tuple[int, str]:
        eff_timeout = max(1, int(round(float(timeout or 8.0))))
        st, body, _ = self.request(
            url,
            method=str(kwargs.get("method") or "GET"),
            data=kwargs.get("data"),
            headers=headers,
            proxy_url=kwargs.get("proxy_url"),
            cf_worker_relay=kwargs.get("cf_worker_relay"),
            spoof_geo_country=str(kwargs.get("spoof_geo_country") or "DIRECT"),
            timeout=eff_timeout,
        )
        return st, body

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
        st, body, rh = self._request_impl(
            url,
            method=method,
            data=data,
            headers=headers,
            proxy_url=proxy_url,
            cf_worker_relay=cf_worker_relay,
            spoof_geo_country=spoof_geo_country,
            timeout=timeout,
        )
        clean_proxy = (proxy_url or "").strip().lower()
        relay_used = bool((cf_worker_relay or "").strip()) or ("workers.dev" in clean_proxy or "?url=" in clean_proxy)
        if relay_used and isinstance(rh, dict) and rh.get("_final_url"):
            # Callers derive mirrors / canonical page URLs from _final_url: never expose the relay host
            rh["_final_url"] = url
        if isinstance(rh, dict):
            rh.pop("_raw_bytes", None)
        return st, body, rh

    def request_bytes(
        self,
        url: str,
        method: str = "GET",
        data: Optional[bytes] = None,
        headers: Optional[Dict[str, str]] = None,
        proxy_url: Optional[str] = None,
        cf_worker_relay: Optional[str] = None,
        spoof_geo_country: str = "KZ",
        timeout: int = 8,
    ) -> Tuple[int, bytes, Dict[str, str]]:
        st, body, rh = self._request_impl(
            url,
            method=method,
            data=data,
            headers=headers,
            proxy_url=proxy_url,
            cf_worker_relay=cf_worker_relay,
            spoof_geo_country=spoof_geo_country,
            timeout=timeout,
        )
        raw_bytes: bytes = b""
        if isinstance(rh, dict):
            maybe_raw = rh.pop("_raw_bytes", None)
            if isinstance(maybe_raw, (bytes, bytearray)):
                raw_bytes = bytes(maybe_raw)
        if not raw_bytes and body:
            raw_bytes = body.encode("utf-8", errors="replace")
        clean_proxy = (proxy_url or "").strip().lower()
        relay_used = bool((cf_worker_relay or "").strip()) or ("workers.dev" in clean_proxy or "?url=" in clean_proxy)
        if relay_used and isinstance(rh, dict) and rh.get("_final_url"):
            rh["_final_url"] = url
        return st, raw_bytes, rh

    @staticmethod
    def _is_tls_cert_error(exc: BaseException) -> bool:
        if isinstance(exc, ssl.SSLCertVerificationError):
            return True
        if isinstance(exc, urllib.error.URLError) and isinstance(
            getattr(exc, "reason", None), ssl.SSLCertVerificationError
        ):
            return True
        return False

    def _request_impl(
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
        clean_url = (url or "").strip()
        if not clean_url or _CTRL_CHAR_RE.search(clean_url):
            return 0, "Invalid request URL", {}
        try:
            parsed_orig = urllib.parse.urlparse(clean_url)
            _ = parsed_orig.port
        except ValueError:
            return 0, "Invalid request URL", {}
        if parsed_orig.scheme not in ("http", "https") or not parsed_orig.hostname:
            return 0, f"Unsupported URL scheme: {parsed_orig.scheme!r}", {}
        if parsed_orig.username or parsed_orig.password:
            return 0, "Disallowed credentials in URL", {}
        orig_host = (parsed_orig.hostname or "").strip().lower().rstrip(".")
        if _is_disallowed_hostname(orig_host):
            return 0, "Blocked non-public host", {}
        try:
            ipaddress.ip_address(orig_host)
            if not _is_valid_public_ip_addr(orig_host):
                return 0, "Blocked non-public IP literal", {}
        except ValueError:
            pass

        raw_headers = dict(self.default_headers)
        geo_hdrs = self.build_geo_headers(spoof_geo_country)
        if geo_hdrs:
            raw_headers.update(geo_hdrs)
        if headers:
            raw_headers.update(headers)

        merged_headers: Dict[str, str] = {}
        has_sensitive_auth = False
        for hk, hv in raw_headers.items():
            if hv is None:
                continue
            sk = _sanitize_header_str(hk).replace(":", "")
            if not sk:
                continue
            sv = _sanitize_header_str(hv)
            if sk.lower() == "accept-encoding":
                parts = [p.strip() for p in sv.split(",") if p.strip() and not p.strip().lower().startswith("br")]
                sv = ", ".join(parts) if parts else "gzip, deflate"
            if sk.lower() in ("cookie", "authorization", "proxy-authorization") and sv:
                has_sensitive_auth = True
            merged_headers[sk] = sv

        clean_proxy = _CTRL_CHAR_RE.sub("", (proxy_url or "").strip())
        clean_relay = _CTRL_CHAR_RE.sub("", (cf_worker_relay or "").strip())

        # Smart guard: if user pasted a Cloudflare Worker URL into proxy_url, route as relay instead of HTTP CONNECT
        if clean_proxy and not clean_relay and ("workers.dev" in clean_proxy.lower() or "?url=" in clean_proxy.lower()):
            clean_relay = clean_proxy
            clean_proxy = ""

        if clean_proxy:
            p_prx = urllib.parse.urlparse(clean_proxy)
            if p_prx.scheme not in ("http", "https") or not p_prx.hostname:
                clean_proxy = ""

        target_url = clean_url
        if clean_relay:
            p_rel = urllib.parse.urlparse(clean_relay)
            rel_host = (p_rel.hostname or "").strip().lower().rstrip(".")
            if p_rel.scheme in ("http", "https") and rel_host and not _is_disallowed_hostname(rel_host):
                target_url = _wrap_cf_worker_relay_url(clean_relay, clean_url)
            else:
                clean_relay = ""

        parsed = urllib.parse.urlparse(target_url)
        host = (parsed.hostname or "").strip().lower().rstrip(".")
        if parsed.scheme not in ("http", "https") or not host or _is_disallowed_hostname(host):
            return 0, "Invalid target URL", {}

        can_doh = bool(parsed.scheme == "https" and host and not clean_proxy and not clean_relay)
        proactive_doh = can_doh and self._should_proactively_doh(host)

        pre_map: Dict[str, str] = {}
        if proactive_doh:
            resolved_ip = self.resolve_doh_ipv4(host)
            if resolved_ip:
                pre_map[host] = resolved_ip

        allow_unverified_tls_retry = (not has_sensitive_auth) and any(
            m in orig_host for m in self._CENSORED_HOST_MARKERS
        )

        def _exec_with_tls_policy(
            *,
            use_doh_flag: bool,
            resolved_map: Optional[Dict[str, str]] = None,
        ) -> Tuple[int, str, Dict[str, str]]:
            op_verified = self._build_opener(
                proxy_url=clean_proxy,
                cf_worker_relay=clean_relay,
                use_doh=use_doh_flag,
                pre_resolved_map=resolved_map,
                verify_tls=True,
            )
            try:
                return self._execute_once(target_url, method, data, merged_headers, op_verified, timeout)
            except Exception as tls_exc:
                if allow_unverified_tls_retry and self._is_tls_cert_error(tls_exc):
                    op_relaxed = self._build_opener(
                        proxy_url=clean_proxy,
                        cf_worker_relay=clean_relay,
                        use_doh=use_doh_flag,
                        pre_resolved_map=resolved_map,
                        verify_tls=False,
                    )
                    return self._execute_once(target_url, method, data, merged_headers, op_relaxed, timeout)
                raise

        try:
            st, body, rh = _exec_with_tls_policy(
                use_doh_flag=bool(proactive_doh and pre_map),
                resolved_map=pre_map,
            )
            if st == 451 and can_doh and not proactive_doh:
                fb_ip = self.resolve_doh_ipv4(host)
                if fb_ip:
                    try:
                        return _exec_with_tls_policy(use_doh_flag=True, resolved_map={host: fb_ip})
                    except Exception:
                        self._forget_doh_host(host)
            return st, body, rh
        except urllib.error.HTTPError as e:
            err_code = e.code
            body = ""
            try:
                raw_err = e.read(2 * 1024 * 1024)
                body = self._decompress(raw_err, e.headers.get("Content-Encoding", "") if e.headers else "")
            except Exception:
                pass
            finally:
                try:
                    e.close()
                except Exception:
                    pass
            if err_code == 451 and can_doh and not proactive_doh:
                fb_ip = self.resolve_doh_ipv4(host)
                if fb_ip:
                    try:
                        return _exec_with_tls_policy(use_doh_flag=True, resolved_map={host: fb_ip})
                    except Exception:
                        self._forget_doh_host(host)
            return err_code, body, {}
        except Exception as e:
            if proactive_doh and pre_map:
                # DoH-pinned IP is dead / unreachable: drop it and retry once via system DNS
                self._forget_doh_host(host)
                try:
                    return _exec_with_tls_policy(use_doh_flag=False)
                except urllib.error.HTTPError as e2:
                    err_b2 = ""
                    try:
                        raw_e2 = e2.read(512 * 1024)
                        err_b2 = self._decompress(
                            raw_e2, e2.headers.get("Content-Encoding", "") if e2.headers else ""
                        )
                    except Exception:
                        pass
                    finally:
                        try:
                            e2.close()
                        except Exception:
                            pass
                    return e2.code, err_b2, {}
                except Exception:
                    pass
            if can_doh and not proactive_doh:
                fb_ip = self.resolve_doh_ipv4(host)
                if fb_ip:
                    try:
                        return _exec_with_tls_policy(use_doh_flag=True, resolved_map={host: fb_ip})
                    except Exception:
                        self._forget_doh_host(host)
            return 0, str(e), {}
