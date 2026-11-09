"""
Kinorium HTTP Transport, Anti-Bot JS Challenge Solver & Cookie Management (`backend/kinorium_http.py`).
Extracted from `backend/kinorium.py` to isolate network transport, DoH/domain failover,
cookie sanitization, and cross-platform JS challenge solving.
"""

import http.cookiejar
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from typing import Any, Dict, List, Optional, Tuple

_MAX_KINORIUM_RESP_BYTES = 6 * 1024 * 1024


def _read_resp_bounded(resp: Any, limit: int = _MAX_KINORIUM_RESP_BYTES) -> bytes:
    try:
        return resp.read(limit + 1)[:limit]
    except TypeError:
        return resp.read()[:limit]


def _decompress_gzip_bounded(raw: bytes, limit: int = _MAX_KINORIUM_RESP_BYTES) -> bytes:
    if not raw:
        return b""
    try:
        dobj = zlib.decompressobj(16 + zlib.MAX_WBITS)
        out = dobj.decompress(raw, limit)
        return out[:limit]
    except Exception:
        return raw[:limit]


def extract_user_path(raw_input: str) -> str:
    s = (raw_input or "").strip()
    if not s:
        return ""
    m_u = re.search(r"(?:^|/|\b)user/(\d+)", s, re.I)
    if m_u:
        return f"/user/{m_u.group(1)}/"
    m = re.search(r"kinorium\.com(/user/\d+/?|/[a-zA-Z0-9_.-]+/?)", s, re.I)
    if m:
        path = m.group(1)
        return path if path.endswith("/") else path + "/"
    if s.isdigit():
        return f"/user/{s}/"
    m_num = re.search(r"\b(\d{3,10})\b", s)
    if m_num:
        return f"/user/{m_num.group(1)}/"
    return "/" + s.strip("/") + "/"


def extract_cookie_user_id(raw_cookie: str) -> str:
    """Extracts `user_id` from Kinorium's URL-encoded JSON `auth` cookie if present."""
    if not raw_cookie:
        return ""
    for chunk in re.split(r";|\r|\n", str(raw_cookie)):
        chunk = chunk.strip()
        if "=" not in chunk:
            continue
        k, v = chunk.split("=", 1)
        if k.strip() == "auth":
            val = v.strip()
            if not val or val.lower() == "deleted":
                continue
            try:
                decoded = urllib.parse.unquote(val)
                obj = json.loads(decoded)
                if isinstance(obj, dict):
                    uid = str(obj.get("user_id") or "").strip()
                    if uid.isdigit() and int(uid) > 0:
                        return uid
            except Exception:
                m = re.search(r'"user_id"\s*:\s*"?(\d+)"?', urllib.parse.unquote(val))
                if m and int(m.group(1)) > 0:
                    return m.group(1)
    return ""


def sanitize_session_cookie(raw_cookie: str) -> str:
    """
    Cleans user-pasted browser cookies (including Firefox/Zen truncated '…' values,
    'Cookie:' header prefixes, cURL snippets, or Cookie-Editor JSON exports) so:
    1. Non-latin-1 / truncated cookies (e.g. __eoi=...…m) never raise UnicodeEncodeError in http.client.
    2. Browser-bound anti-bot tokens (t=..., rw=..., x149=...) and analytics junk are stripped
       so they never conflict with KinoriumService's built-in JSC anti-bot solver.
    """
    if not raw_cookie:
        return ""
    s = raw_cookie.strip()
    if not s:
        return ""

    # Support Cookie-Editor JSON export: [{"name": "auth", "value": "..."}, ...]
    if s.startswith("[") and s.endswith("]"):
        try:
            arr = json.loads(s)
            if isinstance(arr, list):
                s = "; ".join(
                    f"{it.get('name', '').strip()}={it.get('value', '').strip()}"
                    for it in arr
                    if isinstance(it, dict) and it.get("name")
                )
        except Exception:
            pass

    # Support pasted cURL command (-H 'Cookie: ...' or -b '...')
    m_curl = re.search(r"(?:-H\s+['\"]Cookie:\s*([^'\"]+)['\"]|-b\s+['\"]([^'\"]+)['\"])", s, re.I)
    if m_curl:
        s = (m_curl.group(1) or m_curl.group(2) or "").strip()

    if s.lower().startswith("cookie:"):
        s = s.split(":", 1)[1].strip()

    skip_exact = {
        "t",
        "rw",
        "check_reloads",
        "check_reloads_sets",
        "pixr",
        "brotheme",
        "cdnp",
        "64m",
        "64i",
        "autotheme",
        "first_visit",
        "hiddentooltips",
        "hidepushwindow",
        "time_shift",
    }
    skip_prefixes = ("_ga", "_ym", "_gcl", "__eoi", "tmr_")
    kept: Dict[str, str] = {}

    for chunk in re.split(r";|\r|\n", s):
        chunk = chunk.strip()
        if not chunk or "=" not in chunk:
            continue
        # Drop values truncated in Firefox/Zen DevTools UI with ellipsis
        if "\u2026" in chunk or "..." in chunk:
            continue
        try:
            chunk.encode("latin-1")
        except UnicodeEncodeError:
            continue
        k, v = chunk.split("=", 1)
        k = k.strip()
        v = v.strip()
        if not k or not v or v.lower() == "deleted":
            continue
        kl = k.lower()
        if kl in skip_exact or kl.startswith(skip_prefixes):
            continue
        if re.fullmatch(r"x\d+", kl):
            continue
        kept[k] = v

    # Never share the browser's live PHPSESSID when persistent 'auth' cookie is present,
    # otherwise concurrent requests with a different TLS/UA fingerprint invalidate the browser session.
    if any(k.lower() == "auth" for k in kept):
        for k_sess in [k for k in kept if k.lower() == "phpsessid"]:
            kept.pop(k_sess, None)

    return "; ".join(f"{k}={v}" for k, v in kept.items())


def solve_kinorium_js_challenge(self: Any, body: str) -> str:
    """
    Cross-platform solver for Kinorium's JS anti-bot cookie challenge (`document['cookie'] = ...`).
    Works across macOS (`jsc`), Node.js (`node`), Windows/Linux headless Chromium (`msedge` / `chrome`),
    and pure-Python static/concatenation cookie assignments without requiring macOS-only tools.
    """
    if not body or len(body) > 131072 or ("document['cookie']" not in body and "document.cookie" not in body):
        return ""
    js_code = re.sub(r"</?script[^>]*>", "", body, flags=re.I)
    if re.search(
        r"\b(?:require|process|child_process|Deno|Bun|ActiveXObject|WScript|WebSocket|fetch|importScripts)\b",
        js_code,
    ):
        return ""
    shim_core = f"""
    var __cf_orig_console = (typeof globalThis !== "undefined" && globalThis.console) ? globalThis.console : null;
    var __cf_emit = (typeof print === "function")
      ? print
      : (__cf_orig_console && __cf_orig_console.log ? __cf_orig_console.log.bind(__cf_orig_console) : function() {{}});
    var process = undefined, require = undefined, global = undefined, Deno = undefined, Bun = undefined;
    var cookies = [];
    var console = {{ log: function() {{}}, warn: function() {{}}, error: function() {{}} }};
    var document = {{
      set cookie(val) {{
        var kv = String(val || "").split(";")[0];
        var eq = kv.indexOf("=");
        if (eq > 0) {{
          cookies.push(kv.slice(0, eq).trim() + "=" + kv.slice(eq + 1).trim());
        }}
      }},
      get cookie() {{ return cookies.join("; "); }},
      createElement: function() {{ return {{ getContext: function() {{ return {{ getExtension: function() {{ return {{ UNMASKED_RENDERER_WEBGL: 1 }}; }}, getParameter: function() {{ return "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)"; }} }}; }} }}; }},
      startViewTransition: function() {{}}
    }};
    var window = {{ screen: {{ width: 1920, height: 1080 }}, speechSynthesis: {{}} }};
    var navigator = {{ maxTouchPoints: 0, webdriver: false, userAgent: {json.dumps(self.UA)}, bluetooth: {{}}, userAgentData: {{}}, speechSynthesis: {{}}, platform: "MacIntel", hardwareConcurrency: 8, deviceMemory: 8, languages: ["ru-RU", "ru", "en-US"] }};
    var top = {{ location: {{ href: "https://en.kinorium.com/", reload: function() {{}} }} }};
    var location = top.location;
    var XMLHttpRequest = function() {{ this.open = function(){{}}; this.setRequestHeader = function(){{}}; this.send = function(){{}}; }};
    try {{
      {js_code}
    }} catch (_err) {{}}
    __cf_emit("COOKIES_OUT:" + cookies.join("; "));
    """

    no_win_flag = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    import shutil as _shutil

    # 1. macOS JavaScriptCore CLI (if present) or Node.js (cross-platform isolated VM)
    js_runners: List[List[str]] = []
    if os.path.isfile(self.JSC_PATH):
        js_runners.append([self.JSC_PATH, "-e", shim_core])
    node_bin = _shutil.which("node") or _shutil.which("nodejs")
    if node_bin:
        node_vm_runner = (
            "const vm = require('vm');\n"
            "const sb = Object.create(null);\n"
            "sb.print = (s) => process.stdout.write(String(s) + '\\n');\n"
            "sb.String = String; sb.Number = Number; sb.Boolean = Boolean; sb.Array = Array;\n"
            "sb.Object = Object; sb.Math = Math; sb.Date = Date; sb.RegExp = RegExp;\n"
            "sb.JSON = JSON; sb.parseInt = parseInt; sb.parseFloat = parseFloat;\n"
            "sb.encodeURIComponent = encodeURIComponent; sb.decodeURIComponent = decodeURIComponent;\n"
            f"const code = {json.dumps(shim_core)};\n"
            "try {\n"
            "  const ctx = vm.createContext(sb, { codeGeneration: { strings: false, wasm: false } });\n"
            "  vm.runInContext(code, ctx, { timeout: 2000 });\n"
            "} catch (_) {}\n"
        )
        js_runners.append([node_bin, "--disallow-code-generation-from-strings", "-e", node_vm_runner])

    for cmd in js_runners:
        try:
            out = subprocess.check_output(
                cmd,
                stderr=subprocess.DEVNULL,
                timeout=5,
                creationflags=no_win_flag,
            ).decode("utf-8", errors="ignore")
            for line in out.splitlines():
                if "COOKIES_OUT:" in line:
                    solved = line.split("COOKIES_OUT:", 1)[1].strip()
                    if solved:
                        return solved
        except Exception:
            continue

    # 2. Pure-Python extraction for literal / string-concatenated document['cookie'] assignments
    try:
        var_table: Dict[str, str] = {}
        for vm in re.finditer(
            r"\b(?:var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(['\"])([^'\"]*)\2",
            js_code,
        ):
            var_table[vm.group(1)] = vm.group(3)

        extracted_pairs: List[str] = []
        assign_re = re.compile(
            r"document(?:\[['\"]cookie['\"]\]|\.cookie)\s*=\s*((?:(?:'[^']*'|\"[^\"]*\"|[A-Za-z0-9_$+\s])+)"
        )
        tok_re = re.compile(r"'([^']*)'|\"([^\"]*)\"|([A-Za-z_$][A-Za-z0-9_$]*)|(\d+)")
        for cm in assign_re.finditer(js_code):
            expr = cm.group(1).strip()
            parts: List[str] = []
            valid_expr = True
            for raw_seg in expr.split("+"):
                t = raw_seg.strip()
                if not t:
                    continue
                tm = tok_re.fullmatch(t)
                if not tm:
                    valid_expr = False
                    break
                if tm.group(1) is not None:
                    parts.append(tm.group(1))
                elif tm.group(2) is not None:
                    parts.append(tm.group(2))
                elif tm.group(3) is not None and tm.group(3) in var_table:
                    parts.append(var_table[tm.group(3)])
                elif tm.group(4) is not None:
                    parts.append(tm.group(4))
                else:
                    valid_expr = False
                    break
            if valid_expr and parts:
                kv = "".join(parts).split(";", 1)[0].strip()
                if "=" in kv:
                    ck_k, ck_v = kv.split("=", 1)
                    if ck_k.strip() and ck_v.strip():
                        extracted_pairs.append(f"{ck_k.strip()}={ck_v.strip()}")
        if extracted_pairs:
            return "; ".join(extracted_pairs)
    except Exception:
        pass

    # 3. Windows native Chakra JScript9 CLI (cscript.exe, ~15ms, zero browser startup)
    cscript_bin = _shutil.which("cscript") or _shutil.which("cscript.exe")
    if cscript_bin and sys.platform == "win32":
        try:
            import tempfile as _tempfile

            cscript_shim = (
                "var __cf_emit = function(s){ try { WScript.Echo(s); } catch(e){} };\n"
                "var ActiveXObject = undefined, GetObject = undefined, WScript_safe = undefined;\n"
                "var cookies = [];\n"
                "var console = { log: function(){}, warn: function(){}, error: function(){} };\n"
                "var document = {\n"
                "  createElement: function(){ return { getContext: function(){ return { getExtension: function(){ return { UNMASKED_RENDERER_WEBGL: 1 }; }, getParameter: function(){ return 'ANGLE (Generic GPU, Direct3D11)'; } }; } }; },\n"
                "  startViewTransition: function(){}\n"
                "};\n"
                "if (Object.defineProperty) {\n"
                "  Object.defineProperty(document, 'cookie', {\n"
                "    set: function(val){ var kv=String(val||'').split(';')[0]; var eq=kv.indexOf('='); if(eq>0) cookies.push(kv.slice(0,eq).trim()+'='+kv.slice(eq+1).trim()); },\n"
                "    get: function(){ return cookies.join('; '); }\n"
                "  });\n"
                "}\n"
                f"var window = {{ screen: {{ width: 1920, height: 1080 }}, speechSynthesis: {{}} }};\n"
                f"var navigator = {{ maxTouchPoints: 0, webdriver: false, userAgent: {json.dumps(self.UA)}, platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8, languages: ['ru-RU', 'ru', 'en-US'] }};\n"
                "var top = { location: { href: 'https://en.kinorium.com/', reload: function(){} } };\n"
                "var location = top.location;\n"
                "var XMLHttpRequest = function(){ this.open=function(){}; this.setRequestHeader=function(){}; this.send=function(){}; };\n"
                f"try {{ {js_code} }} catch (_err) {{}}\n"
                "__cf_emit('COOKIES_OUT:' + cookies.join('; '));\n"
            )
            with _tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", delete=False) as tf:
                tf.write(cscript_shim)
                js_tmp_path = tf.name
            try:
                out = subprocess.check_output(
                    [
                        cscript_bin,
                        "//NoLogo",
                        "//B",
                        "//T:3",
                        "//E:{16d51579-a30b-4c8b-a276-0ff4dc41e755}",
                        js_tmp_path,
                    ],
                    stderr=subprocess.DEVNULL,
                    timeout=4,
                    creationflags=no_win_flag,
                ).decode("utf-8", errors="ignore")
                for line in out.splitlines():
                    if "COOKIES_OUT:" in line:
                        solved = line.split("COOKIES_OUT:", 1)[1].strip()
                        if solved:
                            return solved
            finally:
                try:
                    os.unlink(js_tmp_path)
                except OSError:
                    pass
        except Exception:
            pass

    # 4. Windows / Linux headless Edge / Chrome V8 DOM evaluation with persistent profile dir
    try:
        from windows.kinorium_login_webview import find_chromium_browser

        browser_exe = find_chromium_browser()
        if browser_exe:
            import tempfile as _tempfile

            with _tempfile.TemporaryDirectory(prefix="cf_kin_js_") as td:
                prof_dir = os.path.join(td, "prof")
                os.makedirs(prof_dir, exist_ok=True)
                html_file = os.path.join(td, "challenge.html")
                wrapped_html = (
                    "<!doctype html><html><head><meta charset='utf-8'></head><body><script>"
                    "var __ck=[];Object.defineProperty(document,'cookie',{"
                    "set:function(v){var s=String(v||'').split(';')[0];if(s.indexOf('=')>0)__ck.push(s.trim());},"
                    "get:function(){return __ck.join('; ');}});"
                    f"try{{{js_code}}}catch(e){{}}"
                    "document.body.setAttribute('data-cf-ck',__ck.join('; '));"
                    "</script></body></html>"
                )
                with open(html_file, "w", encoding="utf-8") as hf:
                    hf.write(wrapped_html)
                file_url = "file:///" + html_file.replace("\\", "/").lstrip("/")
                dom_out = subprocess.check_output(
                    [
                        browser_exe,
                        "--headless=new",
                        "--disable-gpu",
                        "--no-first-run",
                        "--no-default-browser-check",
                        "--disable-extensions",
                        "--disable-component-update",
                        "--disable-sync",
                        "--proxy-bypass-list=<-loopback>",
                        f"--user-data-dir={prof_dir}",
                        "--dump-dom",
                        file_url,
                    ],
                    stderr=subprocess.DEVNULL,
                    timeout=6,
                    creationflags=no_win_flag,
                ).decode("utf-8", errors="ignore")
                m_dom = re.search(r'data-cf-ck="([^"]*)"', dom_out)
                if m_dom and m_dom.group(1).strip():
                    return m_dom.group(1).strip()
    except Exception:
        pass

    return ""


def kinorium_candidate_domains(self: Any, path_or_url: str) -> Tuple[List[str], str]:
    """Returns `(ordered_domains, path_with_query)` with automatic `en.kinorium.com` fallback."""
    s = (path_or_url or "").strip()
    explicit_en = False
    if s.startswith(("http://", "https://")):
        parsed = urllib.parse.urlparse(s)
        host_low = (parsed.hostname or "").lower()
        explicit_en = host_low.startswith("en.")
        pq = parsed.path or "/"
        if parsed.query:
            pq = f"{pq}?{parsed.query}"
    else:
        pq = s if s.startswith("/") else f"/{s}"

    prefer_en = explicit_en or (time.time() < self._prefer_en_domain_until)
    if prefer_en:
        return ["en.kinorium.com", "ru.kinorium.com"], pq
    if getattr(self.net, "kinorium_domain_fallback", True):
        return ["ru.kinorium.com", "en.kinorium.com"], pq
    return ["ru.kinorium.com", "en.kinorium.com"], pq


def is_ip_cooldown_active(self: Any) -> bool:
    proxy_sig = str(getattr(self, "proxy_url", None) or "")
    return time.time() < self._ip_blocked_until and proxy_sig == self._ip_blocked_proxy_sig


def kinorium_http_request(
    self: Any,
    path_or_url: str,
    *,
    method: str = "GET",
    data: Optional[bytes] = None,
    extra_headers: Optional[Dict[str, str]] = None,
    cookie_jar: Optional[http.cookiejar.CookieJar] = None,
    timeout: float = 10.0,
) -> Tuple[int, str, str]:
    """
    Executes a Kinorium HTTP request through `DoHSplitNetworkClient` (DoH + optional proxy)
    with automatic failover between `ru.kinorium.com` and `en.kinorium.com`.
    Returns `(status_code, decoded_body, active_domain)`.
    """
    domains, pq = self._kinorium_candidate_domains(path_or_url)
    use_proactive_doh = bool(
        getattr(self.net, "doh_enabled", True) and getattr(self.net, "kinorium_domain_fallback", False)
    )
    proxy_url = getattr(self, "proxy_url", None) or None
    proxy_sig = str(proxy_url or "")
    if self.is_ip_cooldown_active():
        raise urllib.error.URLError("Kinorium IP cooldown active (HTTP 403 Forbidden)")

    # Polite human-like rate-limiting for live network client to prevent Kinorium anti-bot / 403 bans
    build_fn = getattr(self.net, "_build_opener", None)
    is_live_net = (
        build_fn is not None
        and type(self.net).__name__ == "DoHSplitNetworkClient"
        and "mock" not in type(build_fn).__module__.lower()
    )
    if is_live_net:
        with self._rate_limit_lock:
            now_rl = time.time()
            min_gap = 1.15 + ((hash(pq) & 0xFF) / 255.0) * 0.30
            target_ts = max(now_rl, self._last_http_req_ts + min_gap)
            wait_s = target_ts - now_rl
            self._last_http_req_ts = target_ts
        if wait_s > 0:
            time.sleep(wait_s)
            if self.is_ip_cooldown_active():
                raise urllib.error.URLError("Kinorium IP cooldown active (HTTP 403 Forbidden)")

    doh_modes = [True] if use_proactive_doh else [False, True]

    last_exc: Optional[Exception] = None
    forbidden_domains = 0
    for dom_idx, domain in enumerate(domains):
        target_url = f"https://{domain}{pq}"
        req_headers: Dict[str, str] = {
            "User-Agent": self.UA,
            "Accept-Encoding": "gzip, deflate",
        }
        if extra_headers:
            for hk, hv in extra_headers.items():
                if hk.lower() in ("origin", "referer") and isinstance(hv, str):
                    hv = hv.replace("ru.kinorium.com", domain).replace("en.kinorium.com", domain)
                req_headers[hk] = hv

        for use_doh in doh_modes:
            try:
                if hasattr(self.net, "_build_opener"):
                    try:
                        opener = self.net._build_opener(
                            proxy_url=proxy_url,
                            use_doh=use_doh,
                            use_cookies=bool(cookie_jar is not None),
                            cookie_jar=cookie_jar,
                        )
                    except TypeError:
                        opener = self.net._build_opener(proxy_url=proxy_url, use_doh=use_doh)
                        if cookie_jar is not None and hasattr(opener, "add_handler"):
                            opener.add_handler(urllib.request.HTTPCookieProcessor(cookie_jar))
                else:
                    handlers: List[urllib.request.BaseHandler] = [urllib.request.ProxyHandler({})]
                    if cookie_jar is not None:
                        handlers.insert(0, urllib.request.HTTPCookieProcessor(cookie_jar))
                    opener = urllib.request.build_opener(*handlers)

                req = urllib.request.Request(
                    target_url,
                    data=data,
                    headers=req_headers,
                    method=method.upper(),
                )
                with opener.open(req, timeout=timeout) as resp:
                    status = int(getattr(resp, "status", 200) or 200)
                    raw = _read_resp_bounded(resp, _MAX_KINORIUM_RESP_BYTES)
                    enc = str(resp.headers.get("Content-Encoding") or "").lower()
                if "gzip" in enc or raw[:2] == b"\x1f\x8b":
                    raw = _decompress_gzip_bounded(raw, _MAX_KINORIUM_RESP_BYTES)
                body_txt = raw.decode("utf-8", errors="ignore")
                if self._ip_blocked_until > 0:
                    self._ip_blocked_until = 0.0
                if dom_idx > 0 and domain == "en.kinorium.com":
                    self._prefer_en_domain_until = time.time() + 600.0
                return status, body_txt, domain
            except urllib.error.HTTPError as he:
                # HTTP 403/451/5xx on ru.kinorium.com may be regional GeoIP/ISP block -> try fallback domain
                last_exc = he
                if he.code in (403, 429):
                    forbidden_domains += 1
                if he.code in (403, 429, 451, 502, 503, 520, 521, 522, 523, 524, 525, 526):
                    break
                try:
                    err_raw = _read_resp_bounded(he, 512 * 1024)
                    if err_raw[:2] == b"\x1f\x8b":
                        err_raw = _decompress_gzip_bounded(err_raw, 512 * 1024)
                    return int(he.code), err_raw.decode("utf-8", errors="ignore"), domain
                except Exception:
                    break
            except Exception as exc:
                last_exc = exc
                continue

    if is_live_net and forbidden_domains >= len(domains) and len(domains) >= 2:
        # Both ru.kinorium.com and en.kinorium.com returned 403/429 -> activate 10-minute circuit breaker
        self._ip_blocked_until = time.time() + 600.0
        self._ip_blocked_proxy_sig = proxy_sig

    if last_exc is not None:
        raise last_exc
    return 0, "", domains[0]


def get_active_sync_cookie(self: Any) -> str:
    tl_override = getattr(self._sync_cookie_tl, "cookie", None)
    if tl_override is not None:
        return str(tl_override).strip()
    with self._state_lock:
        return str((self.state.get("account") or {}).get("session_cookie") or "").strip()


def ensure_kinorium_cookies(
    self: Any,
    extra_cookie: str = "",
    challenge_cookie: str = "",
    include_auth: bool = True,
) -> str:
    tl_override = getattr(self._sync_cookie_tl, "cookie", None)
    start_pid = self._profile_id
    if not include_auth:
        stored_user_ck = ""
        extra_cookie = ""
    elif tl_override is not None:
        stored_user_ck = str(tl_override).strip()
        # When running inside a profile-bound sync job, ignore live self.state session_cookie overrides
        extra_cookie = ""
    else:
        with self._state_lock:
            stored_user_ck = str((self.state.get("account") or {}).get("session_cookie") or "").strip()
    clean_stored_ck = self.sanitize_session_cookie(stored_user_ck) if include_auth else ""
    clean_extra_ck = self.sanitize_session_cookie(extra_cookie) if (include_auth and extra_cookie) else ""
    extra_is_same_as_stored = bool(
        not extra_cookie or (clean_extra_ck and clean_extra_ck == clean_stored_ck)
    )

    with self._cookie_lock:
        if not include_auth:
            if self._kinorium_anon_cookie_cache and not challenge_cookie:
                return self._kinorium_anon_cookie_cache
            prev_cached_ck = self._kinorium_anon_cookie_cache
        else:
            if (
                self._kinorium_cookie_cache
                and extra_is_same_as_stored
                and not challenge_cookie
                and tl_override is None
            ):
                return self._kinorium_cookie_cache
            prev_cached_ck = self._kinorium_cookie_cache or self._kinorium_anon_cookie_cache

    merged: Dict[str, str] = {"CONTENT_LANG": "ru"}
    if prev_cached_ck:
        for item in prev_cached_ck.split(";"):
            item = item.strip()
            if "=" in item:
                ck_prev, cv_prev = item.split("=", 1)
                ck_prev = ck_prev.strip()
                cv_prev = cv_prev.strip()
                if ck_prev and cv_prev and cv_prev.lower() != "deleted":
                    if (not include_auth or tl_override is not None) and ck_prev.lower() in (
                        "auth",
                        "session",
                        "phpsessid",
                        "ulogin",
                    ):
                        continue
                    merged[ck_prev] = cv_prev
    if include_auth:
        for ck_src in (clean_stored_ck, clean_extra_ck):
            if ck_src:
                for item in ck_src.split(";"):
                    item = item.strip()
                    if "=" in item:
                        uk, uv = item.split("=", 1)
                        uk = uk.strip()
                        uv = uv.strip()
                        if uk and uv and uv.lower() != "deleted":
                            merged[uk] = uv

    # Merge anti-bot JS challenge tokens (e.g. t=..., x1=..., pow_token=...) without dropping session_cookie
    has_explicit_challenge = False
    for raw_chal in (challenge_cookie, extra_cookie if (extra_cookie and not clean_extra_ck) else ""):
        if not raw_chal:
            continue
        safe_chal = raw_chal.replace("\r", "").replace("\n", "")
        for item in safe_chal.split(";"):
            item = item.strip()
            if "=" not in item:
                continue
            ck_k, ck_v = item.split("=", 1)
            ck_k = ck_k.strip()
            ck_v = ck_v.strip()
            if not ck_k or not ck_v:
                continue
            if ck_k.lower() in ("path", "domain", "expires", "max-age", "samesite", "secure", "httponly"):
                continue
            try:
                f"{ck_k}={ck_v}".encode("latin-1")
            except UnicodeEncodeError:
                continue
            if ck_v.lower() != "deleted":
                merged[ck_k] = ck_v
                has_explicit_challenge = True

    if not has_explicit_challenge and not prev_cached_ck:
        with self._cookie_refresh_lock:
            with self._cookie_lock:
                if not include_auth and self._kinorium_anon_cookie_cache:
                    return self._kinorium_anon_cookie_cache
                if (
                    include_auth
                    and self._kinorium_cookie_cache
                    and extra_is_same_as_stored
                    and tl_override is None
                    and self._profile_id == start_pid
                ):
                    return self._kinorium_cookie_cache

            # Never send user's auth/session cookie to the initial /movies/online/ JS challenge probe
            init_hdrs: Dict[str, str] = {"Cookie": "CONTENT_LANG=ru"}
            cj = http.cookiejar.CookieJar()
            body = ""
            try:
                _, body, _ = self._kinorium_http_request(
                    "/movies/online/",
                    method="GET",
                    extra_headers=init_hdrs,
                    cookie_jar=cj,
                    timeout=9.0,
                )
            except Exception:
                body = ""

            js_cookie = ""
            if "document['cookie']" in body or ("var x =" in body and "cookie" in body):
                js_cookie = self._solve_kinorium_js_challenge(body)

            anon_merged: Dict[str, str] = {"CONTENT_LANG": "ru"}
            for c in cj:
                c_val = str(c.value or "").strip()
                if c.name and c_val and c_val.lower() != "deleted":
                    anon_merged[c.name] = c_val
                    if c.name.lower() != "phpsessid" or "PHPSESSID" not in merged:
                        merged[c.name] = c_val
            if js_cookie:
                for item in js_cookie.split(";"):
                    item = item.strip()
                    if "=" in item:
                        jk, jv = item.split("=", 1)
                        jk = jk.strip()
                        jv = jv.strip()
                        if jk and jv and jv.lower() != "deleted":
                            anon_merged[jk] = jv
                            merged[jk] = jv
            built_anon = "; ".join(f"{k}={v}" for k, v in anon_merged.items())
            with self._cookie_lock:
                self._kinorium_anon_cookie_cache = built_anon

    merged.setdefault("CONTENT_LANG", "ru")
    built_ck = "; ".join(f"{k}={v}" for k, v in merged.items())
    if not include_auth:
        with self._cookie_lock:
            self._kinorium_anon_cookie_cache = built_ck
        return built_ck
    if extra_is_same_as_stored and tl_override is None and self._profile_id == start_pid:
        with self._cookie_lock:
            self._kinorium_cookie_cache = built_ck
    return built_ck


def fetch_kinorium_html(
    self: Any,
    url: str,
    extra_headers: Optional[Dict[str, str]] = None,
    include_auth: Optional[bool] = None,
) -> str:
    eff_auth = (
        bool(include_auth)
        if include_auth is not None
        else bool(getattr(self._sync_cookie_tl, "include_auth", False))
    )
    ck = self._ensure_kinorium_cookies(include_auth=eff_auth)
    hdrs: Dict[str, str] = {"User-Agent": self.UA}
    if ck:
        hdrs["Cookie"] = ck
    if extra_headers:
        hdrs.update(extra_headers)

    _, body, _ = self._kinorium_http_request(url, method="GET", extra_headers=hdrs, timeout=12.0)
    if "var x =" in body and ("document['cookie']" in body or "document.cookie" in body):
        js_ck = self._solve_kinorium_js_challenge(body)
        ck2 = self._ensure_kinorium_cookies(
            challenge_cookie=js_ck or "CONTENT_LANG=ru",
            include_auth=eff_auth,
        )
        if ck2:
            hdrs["Cookie"] = ck2
        _, body, _ = self._kinorium_http_request(url, method="GET", extra_headers=hdrs, timeout=12.0)
    return body
