import atexit
from concurrent.futures import ThreadPoolExecutor
import functools
import gzip
import html
import http.cookiejar
import json
import os
import re
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from .doh import DoHSplitNetworkClient

_RE_NON_WORD_SPACE = re.compile(r"[^\w\s]")
_RE_MULTI_SPACE = re.compile(r"\s+")


@functools.lru_cache(maxsize=32768)
def _norm_title(text: str) -> str:
    if not text:
        return ""
    s = html.unescape(text).lower().replace("\xa0", " ").replace("ё", "е")
    s = _RE_NON_WORD_SPACE.sub(" ", s)
    return _RE_MULTI_SPACE.sub(" ", s).strip()


@functools.lru_cache(maxsize=16384)
def _title_variants_tuple(text: str) -> Tuple[str, ...]:
    if not text:
        return ()
    out: List[str] = []
    full_norm = _norm_title(text)
    if full_norm:
        out.append(full_norm)
    if "/" in text:
        for part in text.split("/"):
            pn = _norm_title(part)
            if pn and pn not in out:
                out.append(pn)
    return tuple(out)


def _title_variants(text: str) -> List[str]:
    if not text:
        return []
    return list(_title_variants_tuple(text))


class KinoriumService:
    """
    Live Kinorium Integration for CineFlow:
    - Connects to real Kinorium user profiles (e.g., https://en.kinorium.com/user/51670/ -> Andrei Crustillio).
    - Automatically solves Kinorium's anti-bot JS challenge to fetch:
      1. All watched & rated movies/series of the user (/user/{id}/ratings/).
      2. The user's 'Буду смотреть' watchlist (/user/{id}/watchlist/).
      3. The user's real friends (/user/{id}/following/) and their real ratings!
    - Provides 85% automatic scrobbling and 1-10 post-watch rating sync.
    """

    JSC_PATH = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
    UA = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    )

    DEFAULT_INTEGRATIONS = {
        "kinorium": {
            "id": "kinorium",
            "name": "Kinorium",
            "enabled": True,
            "requires_login": True,
            "logged_in": True,
            "status_label": "Подключено: Andrei Crustillio (user/51670)",
            "login_url": "https://en.kinorium.com/user/51670/",
        },
        "hdrezka": {
            "id": "hdrezka",
            "name": "HDRezka",
            "enabled": True,
            "requires_login": False,
            "logged_in": True,
            "status_label": "Активно без регистрации (Обход ограничений + 1080p)",
            "login_url": "https://hdrezka-home.tv",
        },
        "backup4k": {
            "id": "backup4k",
            "name": "4K Remux",
            "enabled": True,
            "requires_login": False,
            "logged_in": True,
            "status_label": "Прямой 4K UHD HDR поток и TorrServer",
            "login_url": "http://127.0.0.1:8090",
        },
        "stremio": {
            "id": "stremio",
            "name": "Stremio",
            "enabled": True,
            "requires_login": False,
            "logged_in": True,
            "status_label": "Встроенные аддоны Torrentio + OpenSubtitles",
            "login_url": "https://web.stremio.com/",
        },
        "appletv": {
            "id": "appletv",
            "name": "Apple TV+",
            "enabled": True,
            "requires_login": True,
            "logged_in": False,
            "status_label": "Не выполнен вход",
            "login_url": "https://tv.apple.com/pl",
        },
        "netflix": {
            "id": "netflix",
            "name": "Netflix",
            "enabled": True,
            "requires_login": True,
            "logged_in": False,
            "status_label": "Не выполнен вход",
            "login_url": "https://www.netflix.com/pl/login",
        },
        "prime": {
            "id": "prime",
            "name": "Prime Video",
            "enabled": True,
            "requires_login": True,
            "logged_in": False,
            "status_label": "Не выполнен вход",
            "login_url": "https://www.primevideo.com/",
        },
        "disney": {
            "id": "disney",
            "name": "Disney+",
            "enabled": True,
            "requires_login": True,
            "logged_in": False,
            "status_label": "Не выполнен вход",
            "login_url": "https://www.disneyplus.com/pl-pl/login",
        },
        "max": {
            "id": "max",
            "name": "Max (HBO)",
            "enabled": True,
            "requires_login": True,
            "logged_in": False,
            "status_label": "Не выполнен вход",
            "login_url": "https://play.max.com/",
        },
        "playerpl": {
            "id": "playerpl",
            "name": "Player.pl",
            "enabled": True,
            "requires_login": True,
            "logged_in": False,
            "status_label": "Не выполнен вход",
            "login_url": "https://player.pl/",
        },
    }

    def __init__(self, net_client: DoHSplitNetworkClient, storage_dir: str):
        self.net = net_client
        self.storage_dir = storage_dir
        os.makedirs(self.storage_dir, exist_ok=True)
        self.state_file = os.path.join(self.storage_dir, "kinorium_state.json")
        self.premieres_cache_file = os.path.join(self.storage_dir, "online_premieres_cache.json")
        self._state_lock = threading.RLock()
        self._cookie_lock = threading.Lock()
        self._episodes_lock = threading.Lock()
        self._series_episodes_cache: Dict[str, Dict[str, Any]] = {}
        self._session_auth_verified: Optional[bool] = None
        self._kinorium_cookie_cache: str = ""
        self._state_version: int = 1
        self._integrations_cache: Optional[Dict[str, Any]] = None
        self._save_dirty: bool = False
        self._save_timer: Optional[threading.Timer] = None
        self._online_premieres_mem: List[Dict[str, Any]] = []
        self._online_premieres_ts: float = 0.0
        self._online_premieres_last_attempt_ts: float = 0.0
        self._online_premieres_refreshing: bool = False
        self._preload_premieres_disk_cache()
        self.state = self._load_state()
        self._build_lookup_indices()
        atexit.register(self._flush_state_on_exit)

    def _preload_premieres_disk_cache(self) -> None:
        if not os.path.isfile(self.premieres_cache_file):
            return
        try:
            with open(self.premieres_cache_file, "r", encoding="utf-8") as f:
                cached_payload = json.load(f)
            cached_items = cached_payload.get("items") if isinstance(cached_payload, dict) else None
            cached_ts = float(cached_payload.get("updated_at") or 0.0) if isinstance(cached_payload, dict) else 0.0
            if isinstance(cached_items, list) and len(cached_items) >= 20:
                self._online_premieres_mem = cached_items
                self._online_premieres_ts = cached_ts
        except Exception:
            pass

    def _load_state(self) -> Dict[str, Any]:
        default_state: Dict[str, Any] = {
            "account": {
                "connected": True,
                "user_id": "51670",
                "profile_url": "https://en.kinorium.com/user/51670/",
                "username": "Andrei Crustillio (user/51670)",
                "display_name": "Andrei Crustillio",
                "session_cookie": "",
                "auto_scrobble_threshold": 0.85,
                "watched_count": 0,
                "friends_count": 0,
                "last_synced": "",
            },
            "integrations": json.loads(json.dumps(self.DEFAULT_INTEGRATIONS)),
            "watched": {},
            "ratings": {},
            "watchlist": [],
            "watching_local": [],
            "never_local": [],
            "remote_watched_items": {},
            "remote_watching_items": {},
            "remote_watchlist_items": {},
            "remote_never_items": {},
            "friends": [],
            "friends_ratings_by_kid": {},
            "continue_watching": [],
            "watched_episodes": {},
            "episode_ratings": {},
            "series_live_meta": {},
        }
        if os.path.exists(self.state_file):
            try:
                with open(self.state_file, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                    for k, v in loaded.items():
                        if k == "integrations" and isinstance(v, dict):
                            merged_int = json.loads(json.dumps(self.DEFAULT_INTEGRATIONS))
                            for ik, iv in v.items():
                                if ik in merged_int and isinstance(iv, dict):
                                    merged_int[ik].update(iv)
                                    if "enabled" not in merged_int[ik]:
                                        merged_int[ik]["enabled"] = True
                            default_state["integrations"] = merged_int
                        elif k == "account" and isinstance(v, dict):
                            default_state["account"].update(v)
                            if default_state["account"].get("session_cookie"):
                                default_state["account"]["session_cookie"] = self.sanitize_session_cookie(
                                    str(default_state["account"]["session_cookie"])
                                )
                        else:
                            default_state[k] = v
            except Exception:
                pass
        # Clean up any malformed 'kin_tt...' keys from earlier non-numeric ID fallbacks
        for dict_key in ("watched_episodes", "episode_ratings", "watched", "ratings"):
            sub_d = default_state.get(dict_key)
            if isinstance(sub_d, dict):
                bad_keys = [k for k in list(sub_d.keys()) if str(k).startswith("kin_") and not str(k)[4:].isdigit()]
                for bk in bad_keys:
                    raw_val = sub_d.pop(bk, None)
                    orig_id = str(bk)[4:]
                    if orig_id and orig_id not in sub_d and raw_val is not None:
                        sub_d[orig_id] = raw_val
        return default_state

    def _write_state_file_locked(self) -> None:
        try:
            tmp_path = f"{self.state_file}.tmp.{threading.get_ident()}"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(self.state, f, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp_path, self.state_file)
            self._save_dirty = False
        except Exception:
            pass

    def _flush_dirty_state(self) -> None:
        with self._state_lock:
            self._save_timer = None
            if self._save_dirty:
                self._write_state_file_locked()

    def _flush_state_on_exit(self) -> None:
        with self._state_lock:
            if self._save_timer is not None:
                self._save_timer.cancel()
                self._save_timer = None
            if self._save_dirty:
                self._write_state_file_locked()

    def _save_state(self, immediate: bool = True, bump_version: bool = True):
        with self._state_lock:
            self._integrations_cache = None
            if bump_version:
                self._state_version += 1
            if immediate:
                if self._save_timer is not None:
                    self._save_timer.cancel()
                    self._save_timer = None
                self._write_state_file_locked()
            else:
                self._save_dirty = True
                if self._save_timer is None:
                    t = threading.Timer(25.0, self._flush_dirty_state)
                    t.daemon = True
                    self._save_timer = t
                    t.start()

    def _build_lookup_indices(self):
        """
        Builds fast in-memory lookup maps by normalized Russian title, normalized original title,
        and Kinorium ID across all 4 Kinorium status sections:
        - `remote_watched_items` (Просмотрено / done)
        - `remote_watching_items` (Смотрю / now)
        - `remote_watchlist_items` (Буду смотреть / future)
        - `remote_never_items` (Не буду смотреть / never)
        """
        self._by_ru: Dict[str, Dict[str, Any]] = {}
        self._by_orig: Dict[str, Dict[str, Any]] = {}
        self._by_kid: Dict[str, Dict[str, Any]] = {}
        self._watching_by_ru: set = set()
        self._watching_by_orig: set = set()
        self._watchlist_by_ru: set = set()
        self._watchlist_by_orig: set = set()
        self._never_by_ru: set = set()
        self._never_by_orig: set = set()
        self._friend_kid_by_ru: Dict[str, str] = {}
        self._friend_kid_by_orig: Dict[str, str] = {}
        self._live_meta_by_id: Dict[str, Dict[str, Any]] = {}
        self._live_meta_by_ru: Dict[str, Dict[str, Any]] = {}
        self._live_meta_by_orig: Dict[str, Dict[str, Any]] = {}

        for m_key, m_val in (self.state.get("series_live_meta") or {}).items():
            if not isinstance(m_val, dict):
                continue
            self._live_meta_by_id[str(m_key)] = m_val
            if m_val.get("id"):
                self._live_meta_by_id[str(m_val["id"])] = m_val
            if m_val.get("kinorium_id"):
                self._live_meta_by_id[str(m_val["kinorium_id"])] = m_val
                self._live_meta_by_id[f"kin_{m_val['kinorium_id']}"] = m_val
            m_nr = _norm_title(m_val.get("title", ""))
            m_no = _norm_title(m_val.get("orig_title", ""))
            if m_nr:
                self._live_meta_by_ru[m_nr] = m_val
            if m_no:
                self._live_meta_by_orig[m_no] = m_val

        watched_map = self.state.get("remote_watched_items") or {}
        watching_map = self.state.get("remote_watching_items") or {}
        for kid, w_item in watching_map.items():
            if not w_item.get("score") and kid in watched_map and watched_map[kid].get("score"):
                w_item["score"] = watched_map[kid]["score"]

        for section_key in (
            "remote_never_items",
            "remote_watchlist_items",
            "remote_watching_items",
            "remote_watched_items",
        ):
            for kid, item in (self.state.get(section_key) or {}).items():
                self._by_kid[str(kid)] = item
                nr = _norm_title(item.get("ru_title", ""))
                no = _norm_title(item.get("orig_title", ""))
                if nr:
                    self._by_ru[nr] = item
                if no:
                    self._by_orig[no] = item

        for kid, item in watching_map.items():
            nr = _norm_title(item.get("ru_title", ""))
            no = _norm_title(item.get("orig_title", ""))
            if nr:
                self._watching_by_ru.add(nr)
            if no:
                self._watching_by_orig.add(no)

        for kid, item in (self.state.get("remote_watchlist_items") or {}).items():
            nr = _norm_title(item.get("ru_title", ""))
            no = _norm_title(item.get("orig_title", ""))
            if nr:
                self._watchlist_by_ru.add(nr)
            if no:
                self._watchlist_by_orig.add(no)

        for kid, item in (self.state.get("remote_never_items") or {}).items():
            nr = _norm_title(item.get("ru_title", ""))
            no = _norm_title(item.get("orig_title", ""))
            if nr:
                self._never_by_ru.add(nr)
            if no:
                self._never_by_orig.add(no)

        for kid, fmeta in (self.state.get("friend_known_titles") or {}).items():
            fnr = _norm_title(fmeta.get("ru_title", ""))
            fno = _norm_title(fmeta.get("orig_title", ""))
            if fnr:
                self._friend_kid_by_ru[fnr] = str(kid)
            if fno:
                self._friend_kid_by_orig[fno] = str(kid)

    @staticmethod
    def extract_user_path(raw_input: str) -> str:
        s = (raw_input or "").strip()
        if not s:
            return "/user/51670/"
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

    @staticmethod
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
            if not k:
                continue
            kl = k.lower()
            if kl in skip_exact or kl.startswith(skip_prefixes):
                continue
            if re.fullmatch(r"x\d+", kl):
                continue
            kept[k] = v

        return "; ".join(f"{k}={v}" for k, v in kept.items())

    def _ensure_kinorium_cookies(self, extra_cookie: str = "") -> str:
        with self._cookie_lock:
            if self._kinorium_cookie_cache and not extra_cookie:
                return self._kinorium_cookie_cache

            cj = http.cookiejar.CookieJar()
            opener = urllib.request.build_opener(
                urllib.request.HTTPCookieProcessor(cj),
                urllib.request.ProxyHandler({}),
            )
            req = urllib.request.Request("https://ru.kinorium.com/movies/online/", headers={"User-Agent": self.UA})
            raw = opener.open(req, timeout=10).read()
            if raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            body = raw.decode("utf-8", errors="ignore")

            js_cookie = ""
            if "var x =" in body and "document['cookie']" in body and os.path.exists(self.JSC_PATH):
                js_code = re.sub(r"</?script>", "", body)
                shim = f"""
                var cookies = [];
                var console = {{ log: function() {{}} }};
                var document = {{
                  set cookie(val) {{
                    var kv = val.split(";")[0];
                    var eq = kv.indexOf("=");
                    cookies.push(kv.slice(0, eq).trim() + "=" + kv.slice(eq + 1).trim());
                  }},
                  get cookie() {{ return cookies.join("; "); }},
                  createElement: function() {{ return {{ getContext: function() {{ return {{ getExtension: function() {{ return {{ UNMASKED_RENDERER_WEBGL: 1 }}; }}, getParameter: function() {{ return "ANGLE (Apple, Apple M2, OpenGL 4.1)"; }} }}; }} }}; }},
                  startViewTransition: function() {{}}
                }};
                var window = {{ screen: {{ width: 1920, height: 1080 }}, speechSynthesis: {{}} }};
                var navigator = {{ maxTouchPoints: 0, webdriver: false, userAgent: "{self.UA}", bluetooth: {{}}, userAgentData: {{}}, speechSynthesis: {{}}, platform: "MacIntel", hardwareConcurrency: 8, deviceMemory: 8, languages: ["ru-RU", "ru"] }};
                var top = {{ location: {{ href: "https://ru.kinorium.com/", reload: function() {{}} }} }};
                var XMLHttpRequest = function() {{ this.open = function(){{}}; this.setRequestHeader = function(){{}}; this.send = function(){{}}; }};
                {js_code}
                print("COOKIES_OUT:" + cookies.join("; "));
                """
                out = subprocess.check_output([self.JSC_PATH, "-e", shim], timeout=5).decode("utf-8")
                for line in out.splitlines():
                    if "COOKIES_OUT:" in line:
                        js_cookie = line.split("COOKIES_OUT:", 1)[1].strip()
                        break

            merged: Dict[str, str] = {}
            for c in cj:
                merged[c.name] = c.value
            if js_cookie:
                for item in js_cookie.split(";"):
                    item = item.strip()
                    if "=" in item:
                        jk, jv = item.split("=", 1)
                        merged[jk.strip()] = jv.strip()

            raw_user_ck = extra_cookie or self.state["account"].get("session_cookie", "").strip()
            clean_user_ck = self.sanitize_session_cookie(raw_user_ck)
            if clean_user_ck:
                for item in clean_user_ck.split(";"):
                    item = item.strip()
                    if "=" in item:
                        uk, uv = item.split("=", 1)
                        merged[uk.strip()] = uv.strip()

            self._kinorium_cookie_cache = "; ".join(f"{k}={v}" for k, v in merged.items())
            return self._kinorium_cookie_cache

    def fetch_kinorium_html(self, url: str, extra_headers: Optional[Dict[str, str]] = None) -> str:
        ck = self._ensure_kinorium_cookies()
        hdrs = {"User-Agent": self.UA, "Cookie": ck}
        if extra_headers:
            hdrs.update(extra_headers)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        req = urllib.request.Request(url, headers=hdrs)
        raw = opener.open(req, timeout=12).read()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        body = raw.decode("utf-8", errors="ignore")
        if "var x =" in body and "document['cookie']" in body:
            with self._cookie_lock:
                self._kinorium_cookie_cache = ""
            ck = self._ensure_kinorium_cookies()
            hdrs["Cookie"] = ck
            req2 = urllib.request.Request(url, headers=hdrs)
            raw2 = opener.open(req2, timeout=12).read()
            if raw2[:2] == b"\x1f\x8b":
                raw2 = gzip.decompress(raw2)
            body = raw2.decode("utf-8", errors="ignore")
        return body

    @staticmethod
    def extract_friends_tooltip_ratings(blk_html: str) -> List[Dict[str, Any]]:
        m_fr = re.search(
            r'<li[^>]*\btitle=(["\'])(.*?)\1[^>]*>\s*<div[^>]*class=["\'][^"\']*rating__name[^"\']*["\'][^>]*>\s*(?:Друзья|Friends)\s*</div>',
            blk_html,
            re.S | re.I,
        )
        if not m_fr:
            return []
        raw_tip = html.unescape(m_fr.group(2))
        out: List[Dict[str, Any]] = []
        for line in re.split(r"[\r\n]+", raw_tip):
            m_line = re.match(r"^(\d{1,2})\s*[-–—]\s*(.+)$", line.strip())
            if m_line:
                sc_val = int(m_line.group(1))
                f_name = m_line.group(2).strip()
                if 1 <= sc_val <= 10 and f_name:
                    out.append({"name": f_name, "score": sc_val})
        return out

    @staticmethod
    def extract_critics_pct(blk_html: str) -> Optional[int]:
        if not blk_html:
            return None
        # Note: Kinorium list pages use Cyrillic 'с' in `class="rating_critiс "`, while movie
        # pages use `<a>Критики<span class='value green'>98%</span></a>`. Matching the label
        # + numeric `%` handles both cleanly and ignores `rating_na` (`&mdash;`).
        m_cr = re.search(
            r"(?:Критики|Critics|Рейтинг\s+критиков)\s*:?\s*(?:<[^>]+>\s*)*(\d{1,3})\s*%",
            blk_html,
            re.I | re.S,
        )
        if not m_cr:
            return None
        try:
            val = int(m_cr.group(1))
            return val if 0 <= val <= 100 else None
        except Exception:
            return None

    def fetch_movie_critics_pct(
        self,
        kid: str = "",
        item_id: str = "",
        title: str = "",
        orig_title: str = "",
        year: Optional[int] = None,
        media_type: str = "",
        allow_network: bool = True,
    ) -> Optional[int]:
        eff_kid = str(kid or "").strip()
        if not eff_kid.isdigit():
            resolved = self._resolve_kinorium_id(
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                allow_network=allow_network,
                media_type=media_type,
                year=year,
            )
            eff_kid = str(resolved or "").strip()
        if not eff_kid.isdigit():
            return None

        critics_map = self.state.setdefault("critics_by_kid", {})
        if eff_kid in critics_map:
            cached_v = critics_map[eff_kid]
            return int(cached_v) if isinstance(cached_v, int) and cached_v > 0 else None

        for skey in ("remote_watching_items", "remote_watchlist_items", "remote_watched_items", "remote_never_items"):
            rem_entry = (self.state.get(skey) or {}).get(eff_kid)
            if isinstance(rem_entry, dict) and rem_entry.get("critics_rating") is not None:
                c_val = int(rem_entry["critics_rating"])
                critics_map[eff_kid] = c_val
                return c_val

        if not allow_network:
            return None

        try:
            body = self.fetch_kinorium_html(f"https://ru.kinorium.com/{eff_kid}/")
            pct = self.extract_critics_pct(body[:65000])
            critics_map[eff_kid] = int(pct) if pct is not None else -1
            return pct
        except Exception:
            return None

    @staticmethod
    def parse_movie_list_html(body: str, default_status: str = "done") -> Dict[str, Dict[str, Any]]:
        results: Dict[str, Dict[str, Any]] = {}
        main_part = body.split("filmList__pager")[0] if "filmList__pager" in body else body
        for block_m in re.finditer(r"user-status-list(.*?)(?=user-status-list|\Z)", main_part, re.S):
            blk = block_m.group(1)[:8500]
            m_id = re.search(r'data-movieId\s*=\s*"(\d+)"', blk)
            m_name = re.search(r'data-movieName\s*=\s*"([^"]+)"', blk)
            if not m_id or not m_name:
                continue
            kid = m_id.group(1)
            ru_clean = html.unescape(m_name.group(1)).strip().replace("\xa0", " ")

            # Determine status from block header class or default_status
            header_slice = blk[:220]
            is_future_film = ("future_film" in header_slice) or bool(
                re.search(r'data-future\s*=\s*"1"', blk[:1600])
            )
            if "status_now" in header_slice:
                st_code = "now"
            elif "status_never" in header_slice:
                st_code = "never"
            elif "status_future" in header_slice and "status_done" not in header_slice:
                st_code = "future"
            elif "status_done" in header_slice:
                st_code = "done"
            else:
                st_code = default_status

            # On a friend's profile page (/user/{fid}/ratings/), Kinorium renders two statusWidgetData widgets:
            # 1) statusList__status-widget (logged-in viewer's own rating)
            # 2) statusWidget_is-alian-profile (the profile owner's actual rating)
            if "statusWidget_is-alian-profile" in blk:
                m_vbg = re.search(
                    r"statusWidget_is-alian-profile.*?<span[^>]*class=['\"]valueBg([^'\"]*)['\"]",
                    blk[:3800],
                    re.S,
                )
            else:
                m_vbg = re.search(
                    r"statusWidgetData.*?<span[^>]*class=['\"]valueBg([^'\"]*)['\"]",
                    blk[:2800],
                    re.S,
                )
            score = None
            if m_vbg:
                m_num = re.search(r"\bnumber-(\d+)\b", m_vbg.group(1))
                if m_num:
                    score = int(m_num.group(1))

            # Media type: series vs movie
            media_type = "series" if "status-list__serial_text" in blk else "movie"

            # Extract orig_title, year, seasons_count from <small ...>...</small>
            m_small = re.search(r"<small[^>]*>(.*?)</small>", blk, re.S)
            small_clean = ""
            if m_small:
                small_clean = re.sub(r"<[^>]+>", " ", m_small.group(1))
                small_clean = html.unescape(small_clean).replace("\xa0", " ")
                small_clean = re.sub(r"\s+", " ", small_clean).strip()

            orig_title = ""
            year = None
            seasons_count = 2 if media_type == "series" else 1
            episodes_count = 8 if media_type == "series" else 1

            m_yr = re.search(r"(?:^|,\s*)((?:19|20)\d{2})\b", small_clean)
            if m_yr:
                year = int(m_yr.group(1))
                prefix = small_clean[: m_yr.start()].strip().rstrip(",").strip()
                if prefix and not prefix.isdigit():
                    orig_title = prefix

            m_seas = re.search(r"(\d+)\s*сезон", small_clean)
            if m_seas:
                seasons_count = max(1, int(m_seas.group(1)))
            m_eps = re.search(r"(\d+)\s*эпизод", small_clean)
            if m_eps:
                episodes_count = max(1, min(24, int(m_eps.group(1))))

            # Genres & description from <p class='filmList__extra-info'>
            genres: List[str] = []
            extra_desc = ""
            m_extra = re.search(r"class=['\"]filmList__extra-info['\"][^>]*>(.*?)</p>", blk, re.S)
            if m_extra:
                extra_txt = re.sub(r"<[^>]+>", " ", m_extra.group(1))
                extra_txt = html.unescape(extra_txt).replace("\xa0", " ")
                extra_txt = re.sub(r"\s+", " ", extra_txt).strip()
                extra_desc = extra_txt
                first_line = extra_txt.split("•")[0]
                for g_part in first_line.split(","):
                    g_clean = g_part.strip()
                    if g_clean and not re.search(r"\d+\s*(?:ч|мин)", g_clean) and len(g_clean) < 25:
                        genres.append(g_clean.capitalize())

            # Kinorium & IMDb ratings
            m_kr = re.search(
                r'class="rating_kinorium(?![^"]*rating_na)[^"]*"[^>]*>.*?<span[^>]*>\s*([\d.]+)',
                blk,
                re.S,
            )
            m_ir = re.search(
                r'class="rating_imdb(?![^"]*rating_na)[^"]*"[^>]*>.*?<span[^>]*>\s*([\d.]+)',
                blk,
                re.S,
            )
            has_real_rating = bool(m_kr or m_ir)
            kinorium_rating = float(m_kr.group(1)) if m_kr else (float(m_ir.group(1)) if m_ir else 7.8)
            imdb_rating = float(m_ir.group(1)) if m_ir else kinorium_rating
            critics_rating = KinoriumService.extract_critics_pct(blk)

            is_unreleased = bool(
                is_future_film
                or year is None
                or year > 2026
                or not has_real_rating
                or (year == 2026 and not m_kr)
            )

            m_date = re.search(r'class="filmList__date-links date"[^>]*>\s*([^<]+?)\s*</a>', blk)
            watched_at = html.unescape(m_date.group(1)).strip() if m_date else ""
            friends_tooltip = KinoriumService.extract_friends_tooltip_ratings(blk)

            results[kid] = {
                "kinorium_id": kid,
                "ru_title": ru_clean,
                "orig_title": orig_title,
                "year": year or 2024,
                "media_type": media_type,
                "seasons_count": seasons_count,
                "episodes_per_season": episodes_count,
                "genres": genres[:3] or (["Сериал", "Драма"] if media_type == "series" else ["Фильм", "Драма"]),
                "description": extra_desc or f"{ru_clean} ({orig_title or year or ''})",
                "kinorium_rating": kinorium_rating,
                "imdb_rating": imdb_rating,
                **({"critics_rating": critics_rating} if critics_rating is not None else {}),
                "poster": f"https://ru-images.kinorium.com/movie/600/{kid}.jpg",
                "poster_en": f"https://en-images.kinorium.com/movie/600/{kid}.jpg",
                "backdrop": f"https://ru-images.kinorium.com/movie/1080/{kid}.jpg",
                "status": st_code,
                "watched": st_code == "done",
                "watching": st_code == "now",
                "in_watchlist": st_code == "future",
                "not_watching": st_code == "never",
                "is_unreleased": is_unreleased,
                "available_online": not is_unreleased,
                "score": score,
                "watched_at": watched_at,
                **({"friends_tooltip": friends_tooltip} if friends_tooltip else {}),
            }
        return results

    @staticmethod
    def parse_premieres_list_html(
        body: str,
        forced_media_type: Optional[str] = None,
        min_year: int = 0,
        require_rating: bool = False,
    ) -> List[Dict[str, Any]]:
        if not body:
            return []
        main_part = body.split("filmList__pager")[0] if "filmList__pager" in body else body
        blocks = re.split(r'(?=<div[^>]+class=[\'"][^\'"]*\bitem\s+headlines_type-)', main_part)[1:]
        parsed_items: List[Dict[str, Any]] = []
        seen_kids = set()

        for blk in blocks:
            blk_slice = blk[:5200]
            m_id = re.search(r'\brel=["\'](\d+)["\']', blk_slice[:280]) or re.search(
                r'data-movieId\s*=\s*["\'](\d+)["\']', blk_slice
            )
            if not m_id:
                continue
            kid = m_id.group(1)
            if kid in seen_kids:
                continue

            m_title = re.search(r'<span\s+class=["\']title["\'][^>]*>(.*?)</span>', blk_slice[:2600], re.S) or re.search(
                r'data-movieName\s*=\s*["\']([^"\']+)["\']', blk_slice
            )
            if not m_title:
                continue
            ru_title = re.sub(r"<[^>]+>", "", m_title.group(1))
            ru_title = html.unescape(ru_title).replace("\xa0", " ").strip()
            if not ru_title:
                continue

            m_img = re.search(r"<img[^>]+movie-list-poster[^>]*>", blk_slice[:2000], re.I)
            raw_img_url = ""
            alt_text = ""
            if m_img:
                img_tag = m_img.group(0)
                m_pre = re.search(r'data-preload=["\']([^"\']+)["\']', img_tag)
                m_src = re.search(r'\bsrc=["\']([^"\']+)["\']', img_tag)
                cand_url = (m_pre.group(1) if m_pre else "") or (m_src.group(1) if m_src else "")
                if cand_url and "blank." not in cand_url and "no-poster" not in cand_url:
                    raw_img_url = cand_url if cand_url.startswith("http") else f"https:{cand_url}"
                m_alt = re.search(r'\balt=["\']([^"\']+)["\']', img_tag)
                if m_alt:
                    alt_text = html.unescape(m_alt.group(1)).lower()

            if raw_img_url and "/movie/" in raw_img_url:
                poster_url = re.sub(r"/movie/\d+/", "/movie/600/", raw_img_url)
                backdrop_url = re.sub(r"/movie/\d+/", "/movie/1080/", raw_img_url)
            else:
                poster_url = f"https://ru-images.kinorium.com/movie/600/{kid}.jpg"
                backdrop_url = f"https://ru-images.kinorium.com/movie/1080/{kid}.jpg"

            m_small = re.search(r"filmList__small-text[^>]*>(.*?)</span>", blk_slice, re.S) or re.search(
                r"<small[^>]*>(.*?)</small>", blk_slice, re.S
            )
            small_clean = ""
            if m_small:
                small_clean = re.sub(r"<[^>]+>", " ", m_small.group(1))
                small_clean = html.unescape(small_clean).replace("\xa0", " ")
                small_clean = re.sub(r"\s+", " ", small_clean).strip()

            if forced_media_type in ("movie", "series"):
                media_type = forced_media_type
            elif (
                "сезон" in small_clean.lower()
                or "сериал" in alt_text
                or "status-list__serial_text" in blk_slice
            ):
                media_type = "series"
            else:
                media_type = "movie"

            orig_title = ""
            year: Optional[int] = None
            m_yr = re.search(r"(?:^|,\s*)((?:19|20)\d{2})\b", small_clean)
            if m_yr:
                year = int(m_yr.group(1))
                prefix = small_clean[: m_yr.start()].strip().rstrip(",").strip()
                if prefix and not prefix.isdigit():
                    orig_title = prefix

            if min_year and (not year or year < min_year):
                continue

            seasons_count = 1
            episodes_per_season = 1
            if media_type == "series":
                m_seas = re.search(r"(\d+)\s*сезон", small_clean)
                seasons_count = max(1, int(m_seas.group(1))) if m_seas else 1
                m_eps = re.search(r"(\d+)\s*эпизод", small_clean)
                if m_eps:
                    total_eps = max(1, int(m_eps.group(1)))
                    episodes_per_season = max(1, min(26, round(total_eps / max(1, seasons_count))))
                else:
                    episodes_per_season = 8

            genres: List[str] = []
            duration_label = ""
            director_name = ""
            cast_people: List[Dict[str, Any]] = []
            extra_desc = ""

            m_extra = re.search(r"class=['\"]filmList__extra-info['\"][^>]*>(.*?)</p>", blk_slice, re.S)
            if m_extra:
                extra_raw = m_extra.group(1)
                m_dir = re.search(
                    r"href=['\"]/name/(\d+)/['\"][^>]*>([^<]+)</a>",
                    extra_raw,
                )
                if m_dir:
                    d_pid = m_dir.group(1)
                    director_name = html.unescape(m_dir.group(2)).replace("\xa0", " ").strip()
                    if director_name:
                        cast_people.append(
                            {
                                "id": d_pid,
                                "name": director_name,
                                "role": "Режиссёр",
                                "is_director": True,
                                "photo": f"https://ru-images.kinorium.com/persona/180/{d_pid}.jpg",
                            }
                        )

                extra_txt = re.sub(r"<[^>]+>", " ", extra_raw)
                extra_txt = html.unescape(extra_txt).replace("\xa0", " ")
                extra_txt = re.sub(r"\s+", " ", extra_txt).strip()
                extra_desc = extra_txt

                first_chunk = extra_txt.split("•")[0]
                m_dur = re.search(r"(\d+\s*ч(?:\s*\d+\s*мин)?|\d+\s*мин)\b", first_chunk)
                if m_dur:
                    duration_label = m_dur.group(1).strip()

                for g_part in first_chunk.split(","):
                    g_clean = g_part.strip()
                    if not g_clean or len(g_clean) >= 25:
                        continue
                    if re.search(r"\d+\s*(?:ч|мин)", g_clean):
                        continue
                    # Strip trailing country names if glued after genre without <br> separator
                    g_word = g_clean.split(" ")[0] if any(ch.isupper() for ch in g_clean[1:]) else g_clean
                    if g_word and g_word[0].islower():
                        genres.append(g_word.capitalize())

            m_kr = re.search(
                r'class=["\'][^"\']*rating_kinorium(?![^"\']*rating_na)[^"\']*["\'][^>]*>.*?<span[^>]*class=["\'][^"\']*value[^"\']*["\'][^>]*>\s*([\d.]+)',
                blk_slice,
                re.S,
            )
            m_ir = re.search(
                r'class=["\'][^"\']*rating_imdb(?![^"\']*rating_na)[^"\']*["\'][^>]*>.*?<span[^>]*class=["\'][^"\']*value[^"\']*["\'][^>]*>\s*([\d.]+)',
                blk_slice,
                re.S,
            )
            if require_rating and not (m_kr or m_ir):
                continue

            kr_val = float(m_kr.group(1)) if m_kr else (float(m_ir.group(1)) if m_ir else 7.0)
            im_val = float(m_ir.group(1)) if m_ir else kr_val
            critics_pct = KinoriumService.extract_critics_pct(blk_slice)

            seen_kids.add(kid)
            ratings_dict: Dict[str, Any] = {
                "kinorium": round(kr_val, 1),
                "imdb": round(im_val, 1),
            }
            if critics_pct is not None:
                ratings_dict["critics"] = critics_pct

            item_obj: Dict[str, Any] = {
                "id": f"kin_{kid}",
                "kinorium_id": kid,
                "title": ru_title,
                "orig_title": orig_title or ru_title,
                "title_pl": orig_title or ru_title,
                "year": year or 2026,
                "media_type": media_type,
                "seasons_count": seasons_count,
                "episodes_per_season": episodes_per_season,
                "genres": genres[:3] or (["Сериал"] if media_type == "series" else ["Фильм"]),
                "description": extra_desc or f"{ru_title} ({orig_title or year or 2026})",
                "poster": poster_url,
                "poster_en": f"https://en-images.kinorium.com/movie/600/{kid}.jpg",
                "backdrop": backdrop_url,
                "ambient_color": "#1e293b",
                "ratings": ratings_dict,
                "providers": [
                    {"id": "hdrezka", "available": True, "quality": "1080p", "audio": "RU/EN"},
                    {"id": "backup4k", "available": True, "quality": "4K Remux", "audio": "RU/EN"},
                ],
            }
            if duration_label:
                item_obj["duration_label"] = duration_label
            if director_name:
                item_obj["director"] = director_name
            if cast_people:
                item_obj["cast_people"] = cast_people
            friends_tip = KinoriumService.extract_friends_tooltip_ratings(blk_slice)
            if friends_tip:
                item_obj["friends_tooltip"] = friends_tip
            parsed_items.append(item_obj)

        return parsed_items

    def _refresh_online_premieres_sync(self) -> List[Dict[str, Any]]:
        results_map: Dict[str, str] = {}

        def _fetch_one(key: str, url: str) -> None:
            try:
                results_map[key] = self.fetch_kinorium_html(url)
            except Exception:
                results_map[key] = ""

        t_movies = threading.Thread(
            target=_fetch_one,
            args=("movies", "https://ru.kinorium.com/movies/online/?perpage=100"),
            daemon=True,
        )
        t_shows = threading.Thread(
            target=_fetch_one,
            args=("shows", "https://ru.kinorium.com/shows/popular/?perpage=100"),
            daemon=True,
        )
        t_movies.start()
        t_shows.start()
        t_movies.join(timeout=14.0)
        t_shows.join(timeout=14.0)

        online_movies = self.parse_premieres_list_html(results_map.get("movies", ""))
        fresh_series = self.parse_premieres_list_html(
            results_map.get("shows", ""),
            forced_media_type="series",
            min_year=2025,
            require_rating=True,
        )

        combined: List[Dict[str, Any]] = []
        seen_kids = set()
        friend_id_by_name = {
            str(f.get("name") or "").strip(): str(f.get("id") or "")
            for f in (self.state.get("friends") or [])
            if f.get("name")
        }
        own_name = str(self.state.get("account", {}).get("display_name") or "").strip()
        updated_friends_cache = False

        for it in online_movies + fresh_series:
            kid = str(it.get("kinorium_id") or "")
            if kid and kid in seen_kids:
                continue
            if kid:
                seen_kids.add(kid)
            f_tips = it.pop("friends_tooltip", None) or []
            if kid and f_tips:
                with self._state_lock:
                    fbk = self.state.setdefault("friends_ratings_by_kid", {})
                    cur_list = list(fbk.get(kid) or [])
                    by_name = {str(x.get("name") or ""): x for x in cur_list if x.get("name")}
                    for ft in f_tips:
                        fnm = str(ft.get("name") or "").strip()
                        fsc = ft.get("score")
                        if not fnm or fnm == own_name or not fsc:
                            continue
                        by_name[fnm] = {
                            "name": fnm,
                            "user_id": friend_id_by_name.get(fnm) or by_name.get(fnm, {}).get("user_id", ""),
                            "score": int(fsc),
                        }
                        updated_friends_cache = True
                    fbk[kid] = list(by_name.values())
            combined.append(it)

        if updated_friends_cache:
            try:
                self._save_state()
            except Exception:
                pass

        if combined:
            now = time.time()
            with self._state_lock:
                self._online_premieres_mem = combined
                self._online_premieres_ts = now
                self._state_version += 1
            try:
                with open(self.premieres_cache_file, "w", encoding="utf-8") as f:
                    json.dump({"updated_at": now, "items": combined}, f, ensure_ascii=False)
            except Exception:
                pass
        return combined

    def _maybe_trigger_bg_premieres_refresh(self, now: float) -> None:
        with self._state_lock:
            if (
                self._online_premieres_refreshing
                or (now - self._online_premieres_ts) < 1800
                or (now - self._online_premieres_last_attempt_ts) < 300
            ):
                return
            self._online_premieres_refreshing = True
            self._online_premieres_last_attempt_ts = now

        def _bg_refresh() -> None:
            try:
                self._refresh_online_premieres_sync()
            finally:
                with self._state_lock:
                    self._online_premieres_refreshing = False

        threading.Thread(target=_bg_refresh, daemon=True).start()

    def get_online_premieres_count(self) -> int:
        now = time.time()
        with self._state_lock:
            if self._online_premieres_mem:
                count = len(self._online_premieres_mem)
                self._maybe_trigger_bg_premieres_refresh(now)
                return count
        items = self.fetch_online_premieres(force_refresh=False)
        return len(items)

    def fetch_online_premieres(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        now = time.time()
        if not force_refresh:
            with self._state_lock:
                if self._online_premieres_mem:
                    cached_copy = [dict(it) for it in self._online_premieres_mem]
                else:
                    cached_copy = []
            if cached_copy:
                self._maybe_trigger_bg_premieres_refresh(now)
                return cached_copy
            self._preload_premieres_disk_cache()
            with self._state_lock:
                if self._online_premieres_mem:
                    cached_copy = [dict(it) for it in self._online_premieres_mem]
            if cached_copy:
                self._maybe_trigger_bg_premieres_refresh(now)
                return cached_copy

        with self._state_lock:
            self._online_premieres_last_attempt_ts = now
        fresh = self._refresh_online_premieres_sync()
        return [dict(it) for it in fresh]

    def fetch_status_list_ajax(self, user_id: str, status_code: str, max_pages: int = 3) -> Dict[str, Dict[str, Any]]:
        collected: Dict[str, Dict[str, Any]] = {}
        for page_num in range(1, max_pages + 1):
            url = (
                f"https://ru.kinorium.com/handlers/getStatusList/"
                f"?type=self&user_id={user_id}&mode=movie&requestMode=onlyList"
                f"&perpage=200&page={page_num}&filter%5Bstatus%5D%5B%5D={status_code}"
            )
            try:
                raw_json = self.fetch_kinorium_html(
                    url,
                    extra_headers={
                        "X-Requested-With": "XMLHttpRequest",
                        "Referer": f"https://ru.kinorium.com/user/{user_id}/ratings/",
                    },
                )
                data = json.loads(raw_json)
                html_chunk = data.get("result", {}).get("html", "") or data.get("result", {}).get("content", "")
                parsed = self.parse_movie_list_html(html_chunk, default_status=status_code)
                if not parsed:
                    break
                collected.update(parsed)
                if len(parsed) < 190:
                    break
            except Exception:
                break
        return collected

    def _verify_recent_watchlist_online_availability(
        self, watchlist_items: Dict[str, Dict[str, Any]]
    ) -> None:
        """
        Verifies online streaming / HDRezka / 4K Remux availability for recent (2025+)
        items in 'Буду смотреть', hiding unreleased or theatrical-only titles that do not yet
        have online streams.
        """
        from concurrent.futures import ThreadPoolExecutor
        from .hdrezka import HDRezkaClient

        prev_wl = self.state.get("remote_watchlist_items") or {}
        rc = HDRezkaClient(self.net)
        to_check: List[str] = []

        for kid, v in watchlist_items.items():
            if v.get("is_unreleased") or int(v.get("year") or 2024) > 2026:
                v["available_online"] = False
                continue
            prev_entry = prev_wl.get(kid)
            if prev_entry and "available_online" in prev_entry and "rezka_checked" in prev_entry:
                v["available_online"] = prev_entry["available_online"]
                v["rezka_checked"] = True
                if prev_entry.get("rezka_id"):
                    v["rezka_id"] = prev_entry["rezka_id"]
                if prev_entry.get("rezka_url"):
                    v["rezka_url"] = prev_entry["rezka_url"]
                continue
            if int(v.get("year") or 2024) >= 2025:
                to_check.append(kid)
            else:
                v["available_online"] = True

        def _check_kid(kid_str: str) -> None:
            v = watchlist_items[kid_str]
            yr = int(v.get("year") or 2025)
            mtype = v.get("media_type", "movie")
            try:
                meta = rc._resolve_page_metadata(
                    "",
                    v.get("ru_title", ""),
                    v.get("orig_title", ""),
                    None,
                    yr,
                    mtype,
                )
                r_url = meta.get("rezka_url") or ""
                year_ok = (
                    (str(yr) in r_url)
                    or (str(yr - 1) in r_url)
                    or (mtype == "series" and bool(meta.get("seasons_map")))
                )
                has_stream_data = False
                if year_ok and r_url:
                    if meta.get("inline_streams"):
                        has_stream_data = True
                    else:
                        st_res = rc.get_streams_for_title(
                            "",
                            title=v.get("ru_title", ""),
                            orig_title=v.get("orig_title", ""),
                            year=yr,
                            media_type=mtype,
                            rezka_url=r_url,
                        )
                        has_stream_data = bool(st_res.get("qualities"))
                if has_stream_data and year_ok:
                    v["available_online"] = True
                    v["rezka_id"] = meta.get("rezka_id")
                    v["rezka_url"] = r_url
                else:
                    v["available_online"] = False
                v["rezka_checked"] = True
            except Exception:
                v["available_online"] = yr <= 2025

        if to_check:
            with ThreadPoolExecutor(max_workers=8) as pool:
                list(pool.map(_check_kid, to_check))

    def sync_user_profile(self, user_identifier: str = "51670", session_cookie: Optional[str] = None) -> Dict[str, Any]:
        """
        Synchronizes a real Kinorium profile (supports switching to any Kinorium user):
        - Display name & counts
        - 'Смотрю' (status=now)
        - 'Буду смотреть' (status=future, verified for online availability)
        - 'Просмотрено' & ratings (status=done)
        - 'Не буду смотреть' (status=never)
        - Real friends list (/following/) & their ratings
        """
        if session_cookie is not None and session_cookie.strip():
            cleaned_cookie = self.sanitize_session_cookie(session_cookie)
            if cleaned_cookie:
                self.state["account"]["session_cookie"] = cleaned_cookie
                self._kinorium_cookie_cache = ""

        prev_user_id = str(self.state.get("account", {}).get("user_id") or "")
        user_path = self.extract_user_path(user_identifier)
        base_url = f"https://ru.kinorium.com{user_path}"

        prof_html = self.fetch_kinorium_html(base_url)
        m_title = re.search(r"<title>(.*?)</title>", prof_html)
        display_name = html.unescape(m_title.group(1)).strip() if m_title else user_identifier
        display_name = display_name.replace(" - Кинориум", "").strip()

        m_uid = re.search(r"data-user_id='(\d+)'", prof_html) or re.search(r"/user/(\d+)/", user_path)
        user_id = m_uid.group(1) if m_uid else user_identifier.strip("/").replace("user/", "")

        is_switching_user = bool(prev_user_id and str(user_id) != prev_user_id)
        if is_switching_user:
            # Clear previous user's local overrides and cached state so the new user gets a clean profile
            self.state["watched"] = {}
            self.state["ratings"] = {}
            self.state["watchlist"] = []
            self.state["watchlist_removed"] = []
            self.state["watching_local"] = []
            self.state["watching_removed"] = []
            self.state["never_local"] = []
            self.state["never_removed"] = []
            self.state["continue_watching"] = []
            self.state["friends"] = []
            self.state["friends_ratings_by_kid"] = {}
            self.state["friend_known_titles"] = {}
            self.state["remote_watched_items"] = {}
            self.state["remote_watching_items"] = {}
            self.state["remote_watchlist_items"] = {}
            self.state["remote_never_items"] = {}
            self.state["watched_episodes"] = {}
            self.state["episode_ratings"] = {}
            self.state["cw_dismissed"] = []

        # 1. Fetch 'Смотрю' (status=now)
        watching_items = self.fetch_status_list_ajax(user_id, "now", max_pages=2)

        # 2. Fetch 'Не буду смотреть' (status=never)
        never_items = self.fetch_status_list_ajax(user_id, "never", max_pages=2)

        # 3. Fetch 'Буду смотреть' (status=future, up to 3 pages = 600 items)
        watchlist_items = self.fetch_status_list_ajax(user_id, "future", max_pages=3)
        self._verify_recent_watchlist_online_availability(watchlist_items)

        # 4. Fetch all watched/rated pages of the user (status=done, up to 8 pages = 1600 items)
        watched_items = self.fetch_status_list_ajax(user_id, "done", max_pages=8)
        if not watched_items:
            for page_num in range(1, 9):
                p_url = f"{base_url}ratings/?perpage=200&page={page_num}"
                try:
                    p_html = self.fetch_kinorium_html(p_url)
                    parsed = self.parse_movie_list_html(p_html, default_status="done")
                    if not parsed:
                        break
                    watched_items.update(parsed)
                    if len(parsed) < 190:
                        break
                except Exception:
                    break

        # 5. Fetch user's real friends (/following/) including official Kinorium proximity % & similar counts
        self._kinorium_cookie_cache = ""
        friends_list: List[Dict[str, Any]] = []
        try:
            foll_html = self.fetch_kinorium_html(f"{base_url}following/")
            seen_f = set()
            for li_m in re.finditer(
                r"<li[^>]*class=['\"][^'\"]*\bitem\b[^'\"]*['\"][^>]*>(.*?)</li>",
                foll_html,
                re.S,
            ):
                li_blk = li_m.group(1)
                m_fid = re.search(r'data-id="(\d+)"', li_blk)
                m_fnm = re.search(r'class=[\'"][^\'"]*\busername\b[^\'"]*[\'"][^>]*>([^<]+)</a>', li_blk)
                if not m_fid or not m_fnm:
                    continue
                fid = m_fid.group(1)
                fname = html.unescape(m_fnm.group(1)).strip()
                if fid in seen_f or fid == str(user_id):
                    continue
                seen_f.add(fid)
                m_pct = re.search(r"proxymity__percent[^>]*>\s*(\d+)\s*%", li_blk)
                m_sim = re.search(r"proxymity__num[^>]*>\s*(\d+)\s*<", li_blk)
                f_obj: Dict[str, Any] = {
                    "id": fid,
                    "name": fname,
                    "avatar": f"https://images.kinorium.com/user/96/{fid}.jpg",
                }
                if m_pct:
                    f_obj["kinorium_proximity_pct"] = int(m_pct.group(1))
                if m_sim:
                    f_obj["kinorium_similar_count"] = int(m_sim.group(1))
                friends_list.append(f_obj)
        except Exception:
            pass

        if not friends_list and not is_switching_user and self.state.get("friends"):
            friends_list = self.state["friends"]

        # 6. Collect real friends' ratings from:
        #    (a) Kinorium's 'Друзья' tooltip across all user status lists (covers entire friend history)
        #    (b) Each friend's recent ratings pages (/user/{fid}/ratings/, using statusWidget_is-alian-profile)
        friend_id_by_name = {str(f.get("name") or "").strip(): str(f.get("id") or "") for f in friends_list}
        friends_map_by_kid: Dict[str, Dict[str, Dict[str, Any]]] = {}

        def _upsert_friend_score(kid_key: str, f_name: str, f_uid: str, f_score: Any) -> None:
            fn = str(f_name or "").strip()
            if not fn or fn == display_name or not f_score:
                return
            try:
                sc_int = int(f_score)
            except Exception:
                return
            if not (1 <= sc_int <= 10):
                return
            uid_resolved = str(f_uid or friend_id_by_name.get(fn) or "")
            friends_map_by_kid.setdefault(str(kid_key), {})[fn] = {
                "name": fn,
                "user_id": uid_resolved,
                "score": sc_int,
            }

        for status_dict in (watched_items, watching_items, watchlist_items, never_items):
            for kid, st_item in status_dict.items():
                for ft in st_item.pop("friends_tooltip", None) or []:
                    _upsert_friend_score(kid, ft.get("name", ""), "", ft.get("score"))

        for friend in friends_list[:8]:
            fid = str(friend["id"])
            fname = str(friend["name"])
            for f_page in range(1, 3):
                try:
                    fr_html = self.fetch_kinorium_html(
                        f"https://ru.kinorium.com/user/{fid}/ratings/?perpage=200&page={f_page}"
                    )
                    f_parsed = self.parse_movie_list_html(fr_html, default_status="done")
                    if not f_parsed:
                        break
                    for kid, f_item in f_parsed.items():
                        for ft in f_item.pop("friends_tooltip", None) or []:
                            _upsert_friend_score(kid, ft.get("name", ""), "", ft.get("score"))
                        if f_item.get("score"):
                            _upsert_friend_score(kid, fname, fid, f_item["score"])
                        if kid not in watched_items and kid not in watchlist_items:
                            self.state.setdefault("friend_known_titles", {})[kid] = {
                                "kinorium_id": kid,
                                "ru_title": f_item.get("ru_title", ""),
                                "orig_title": f_item.get("orig_title", ""),
                            }
                    if len(f_parsed) < 190:
                        break
                except Exception:
                    break

        friends_ratings_by_kid: Dict[str, List[Dict[str, Any]]] = {
            kid: list(fdict.values()) for kid, fdict in friends_map_by_kid.items() if fdict
        }

        if not friends_ratings_by_kid and not is_switching_user and self.state.get("friends_ratings_by_kid"):
            friends_ratings_by_kid = self.state["friends_ratings_by_kid"]

        wl_online_count = sum(
            1
            for v in watchlist_items.values()
            if v.get("available_online", True)
            and not v.get("is_unreleased", False)
            and int(v.get("year") or 2024) <= 2026
        )

        self.state["account"]["connected"] = True
        self.state["account"]["user_id"] = str(user_id)
        self.state["account"]["profile_url"] = f"https://en.kinorium.com{user_path}"
        self.state["account"]["username"] = f"{display_name} (user/{user_id})"
        self.state["account"]["display_name"] = display_name
        self.state["account"]["watched_count"] = len(watched_items)
        self.state["account"]["watching_count"] = len(watching_items)
        self.state["account"]["watchlist_count"] = wl_online_count
        self.state["account"]["never_count"] = len(never_items)
        self.state["account"]["friends_count"] = len(friends_list)
        self.state["account"]["last_synced"] = time.strftime("%Y-%m-%d %H:%M")

        self.state["remote_watched_items"] = watched_items
        self.state["remote_watching_items"] = watching_items
        self.state["remote_watchlist_items"] = watchlist_items
        self.state["remote_never_items"] = never_items
        self.state["friends"] = friends_list
        self.state["friends_ratings_by_kid"] = friends_ratings_by_kid

        if "integrations" in self.state and "kinorium" in self.state["integrations"]:
            self.state["integrations"]["kinorium"]["login_url"] = f"https://en.kinorium.com{user_path}"

        self.set_service_login(
            "kinorium",
            True,
            f"{display_name} • {len(watched_items)} просмотрено • {len(watching_items)} смотрю • {len(friends_list)} друзей",
        )
        self._build_lookup_indices()
        self._save_state()
        try:
            self.reconcile_all_local_episodes(pull_watching_limit=16)
        except Exception:
            pass
        wl_after = self.get_sections_counts().get("watchlist", wl_online_count)
        watching_after = len(self.state.get("remote_watching_items") or {})
        watched_after = len(self.state.get("remote_watched_items") or {})
        self.state["account"]["watched_count"] = watched_after
        self.state["account"]["watching_count"] = watching_after
        self.state["account"]["watchlist_count"] = wl_after
        self._save_state()
        return {
            "user_id": str(user_id),
            "display_name": display_name,
            "profile_url": f"https://en.kinorium.com{user_path}",
            "watched_count": watched_after,
            "watching_count": watching_after,
            "watchlist_count": wl_after,
            "never_count": len(never_items),
            "friends": friends_list,
        }

    def disconnect_user_profile(self) -> Dict[str, Any]:
        """
        Disconnects the current Kinorium user profile and clears all user-specific lists
        so a new user installing the app can connect their own Kinorium profile cleanly.
        """
        self.state["watched"] = {}
        self.state["ratings"] = {}
        self.state["watchlist"] = []
        self.state["watchlist_removed"] = []
        self.state["watching_local"] = []
        self.state["watching_removed"] = []
        self.state["never_local"] = []
        self.state["never_removed"] = []
        self.state["continue_watching"] = []
        self.state["friends"] = []
        self.state["friends_ratings_by_kid"] = {}
        self.state["friend_known_titles"] = {}
        self.state["remote_watched_items"] = {}
        self.state["remote_watching_items"] = {}
        self.state["remote_watchlist_items"] = {}
        self.state["remote_never_items"] = {}
        self.state["watched_episodes"] = {}
        self.state["episode_ratings"] = {}
        self.state["cw_dismissed"] = []

        self.state["account"] = {
            "connected": False,
            "user_id": "",
            "profile_url": "https://en.kinorium.com/",
            "username": "",
            "display_name": "Не подключен",
            "watched_count": 0,
            "watching_count": 0,
            "watchlist_count": 0,
            "never_count": 0,
            "friends_count": 0,
            "last_synced": "",
            "session_cookie": "",
            "auto_scrobble_threshold": 0.85,
        }
        self.set_service_login("kinorium", False, "")
        self._build_lookup_indices()
        self._save_state()
        return self.get_account_summary()

    def get_account_summary(self) -> Dict[str, Any]:
        acc = self.state.get("account") or {}
        return {
            "connected": bool(acc.get("connected")),
            "user_id": str(acc.get("user_id") or ""),
            "display_name": str(acc.get("display_name") or "Не подключен"),
            "profile_url": str(acc.get("profile_url") or "https://en.kinorium.com/"),
            "last_synced": str(acc.get("last_synced") or ""),
            "has_session_cookie": bool((acc.get("session_cookie") or "").strip()),
        }

    def export_backup_state(self) -> Dict[str, Any]:
        keys_to_export = [
            "account",
            "integrations",
            "watched",
            "ratings",
            "watchlist",
            "watchlist_removed",
            "watching_local",
            "watching_removed",
            "never_local",
            "never_removed",
            "continue_watching",
            "watched_episodes",
            "episode_ratings",
            "cw_dismissed",
            "series_live_meta",
            "remote_watched_items",
            "remote_watching_items",
            "remote_watchlist_items",
            "remote_never_items",
            "friends",
            "friends_ratings_by_kid",
            "friend_known_titles",
        ]
        return {k: self.state.get(k) for k in keys_to_export if k in self.state}

    def import_backup_state(self, backup_data: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(backup_data, dict):
            return self.get_account_summary()
        allowed_keys = [
            "account",
            "integrations",
            "watched",
            "ratings",
            "watchlist",
            "watchlist_removed",
            "watching_local",
            "watching_removed",
            "never_local",
            "never_removed",
            "continue_watching",
            "watched_episodes",
            "episode_ratings",
            "cw_dismissed",
            "series_live_meta",
            "remote_watched_items",
            "remote_watching_items",
            "remote_watchlist_items",
            "remote_never_items",
            "friends",
            "friends_ratings_by_kid",
            "friend_known_titles",
        ]
        prev_uid = str(self.state.get("account", {}).get("user_id") or "")
        for k in allowed_keys:
            if k in backup_data and backup_data[k] is not None:
                if k == "integrations" and isinstance(backup_data[k], dict):
                    merged_int = json.loads(json.dumps(self.DEFAULT_INTEGRATIONS))
                    for ik, iv in backup_data[k].items():
                        if ik in merged_int and isinstance(iv, dict):
                            merged_int[ik].update(iv)
                            if "enabled" not in merged_int[ik]:
                                merged_int[ik]["enabled"] = True
                    self.state["integrations"] = merged_int
                else:
                    self.state[k] = backup_data[k]
        new_uid = str(self.state.get("account", {}).get("user_id") or "")
        self._build_lookup_indices()
        self._save_state()
        if new_uid and new_uid != prev_uid and not backup_data.get("remote_watched_items"):
            try:
                self.sync_user_profile(new_uid)
            except Exception:
                pass
        return self.get_account_summary()

    def get_integrations(self) -> Dict[str, Any]:
        cached = self._integrations_cache
        if cached is not None:
            return cached
        stored = self.state.get("integrations")
        merged = {k: dict(v) for k, v in self.DEFAULT_INTEGRATIONS.items()}
        if isinstance(stored, dict):
            for ik, iv in stored.items():
                if ik in merged and isinstance(iv, dict):
                    merged[ik].update(iv)
                    if "enabled" not in merged[ik]:
                        merged[ik]["enabled"] = True
        self.state["integrations"] = merged
        self._integrations_cache = merged
        return merged

    def is_service_enabled(self, service_id: str) -> bool:
        if not service_id or service_id == "all":
            return True
        integ = self.get_integrations().get(service_id)
        if not isinstance(integ, dict):
            return True
        return bool(integ.get("enabled", True))

    def set_service_enabled(self, service_id: str, enabled: bool) -> Dict[str, Any]:
        integrations = self.get_integrations()
        if service_id in integrations:
            integrations[service_id]["enabled"] = bool(enabled)
            self._save_state()
        return integrations

    def set_service_login(
        self,
        service_id: str,
        logged_in: Optional[bool] = None,
        username: str = "",
        enabled: Optional[bool] = None,
    ) -> Dict[str, Any]:
        integrations = self.get_integrations()
        if enabled is not None and service_id in integrations:
            integrations[service_id]["enabled"] = bool(enabled)

        if logged_in is not None:
            if service_id == "hdrezka":
                integrations["hdrezka"]["logged_in"] = True
                integrations["hdrezka"]["status_label"] = "Активно без регистрации (Обход ограничений + 1080p)"
            elif service_id == "backup4k":
                integrations["backup4k"]["logged_in"] = True
                integrations["backup4k"]["status_label"] = "Прямой 4K UHD HDR поток и TorrServer"
            elif service_id in integrations:
                integrations[service_id]["logged_in"] = bool(logged_in)
                if logged_in:
                    label = f"Подключено ({username})" if username else "Вход выполнен"
                    integrations[service_id]["status_label"] = label
                else:
                    integrations[service_id]["status_label"] = "Не выполнен вход"

            if service_id == "kinorium":
                self.state["account"]["connected"] = bool(logged_in)

        self._save_state()
        return integrations

    def get_series_live_meta(
        self,
        item_id: str = "",
        title: str = "",
        orig_title: str = "",
        kid: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        if item_id and item_id in self._live_meta_by_id:
            return self._live_meta_by_id[item_id]
        if kid:
            if str(kid) in self._live_meta_by_id:
                return self._live_meta_by_id[str(kid)]
            if f"kin_{kid}" in self._live_meta_by_id:
                return self._live_meta_by_id[f"kin_{kid}"]
        for nr in _title_variants(title):
            if nr in self._live_meta_by_ru:
                return self._live_meta_by_ru[nr]
        for no in _title_variants(orig_title):
            if no in self._live_meta_by_orig:
                return self._live_meta_by_orig[no]
        return None

    def save_series_live_meta(self, updates: List[Dict[str, Any]]):
        if not updates:
            return
        store = self.state.setdefault("series_live_meta", {})
        now_ts = time.time()
        changed = False
        for u in updates:
            if not isinstance(u, dict):
                continue
            uid = str(u.get("id") or "").strip()
            title = str(u.get("title") or "").strip()
            orig_title = str(u.get("orig_title") or "").strip()
            kid = self._resolve_kinorium_id(uid, title, orig_title, allow_network=False) or ""
            key = f"kin_{kid}" if kid else (uid or _norm_title(title))
            if not key:
                continue
            existing = store.get(key) if isinstance(store.get(key), dict) else {}
            raw_smap = u.get("seasons_map")
            smap = (
                raw_smap
                if isinstance(raw_smap, dict) and raw_smap
                else (existing.get("seasons_map") if isinstance(existing.get("seasons_map"), dict) else {})
            )
            is_comp = (
                bool(u.get("is_completed"))
                if "is_completed" in u and u.get("is_completed") is not None
                else bool(existing.get("is_completed", False))
            )
            status_txt = (
                str(u.get("series_status_text") or "")
                if "series_status_text" in u
                else str(existing.get("series_status_text") or "")
            )
            entry = {
                "id": uid or key,
                "kinorium_id": str(kid) if kid else "",
                "title": title,
                "orig_title": orig_title,
                "rezka_id": str(u.get("rezka_id") or existing.get("rezka_id") or ""),
                "rezka_url": str(u.get("rezka_url") or existing.get("rezka_url") or ""),
                "latest_season": int(u.get("latest_season") or 1),
                "latest_episode": int(u.get("latest_episode") or 1),
                "seasons_map": smap,
                "is_completed": is_comp,
                "series_status_text": status_txt,
                "studios_summary": str(u.get("studios_summary") or "HDRezka"),
                "studios_count": int(u.get("studios_count") or 0),
                "not_found": bool(u.get("not_found", False)),
                "updated_at": float(u.get("updated_at") or now_ts),
            }
            store[key] = entry
            self._live_meta_by_id[key] = entry
            if uid:
                self._live_meta_by_id[uid] = entry
            if kid:
                self._live_meta_by_id[str(kid)] = entry
                self._live_meta_by_id[f"kin_{kid}"] = entry
            nr = _norm_title(title)
            no = _norm_title(orig_title)
            if nr:
                self._live_meta_by_ru[nr] = entry
            if no:
                self._live_meta_by_orig[no] = entry
            changed = True
        if changed:
            self._save_state()

    def _resolve_remote_item(
        self,
        item_id: str,
        title: str = "",
        orig_title: str = "",
    ) -> Optional[Dict[str, Any]]:
        if item_id and item_id.startswith("kin_"):
            kid = item_id[4:]
            if kid in self._by_kid:
                return self._by_kid[kid]
        elif item_id and item_id.isdigit() and item_id in self._by_kid:
            return self._by_kid[item_id]
        for nr in _title_variants(title):
            if nr in self._by_ru:
                return self._by_ru[nr]
            if nr in self._by_orig:
                return self._by_orig[nr]
        for no in _title_variants(orig_title):
            if no in self._by_orig:
                return self._by_orig[no]
            if no in self._by_ru:
                return self._by_ru[no]
        return None

    def _resolve_kinorium_id(
        self,
        item_id: str,
        title: str = "",
        orig_title: str = "",
        allow_network: bool = False,
        media_type: str = "",
        year: Optional[int] = None,
    ) -> Optional[str]:
        if item_id and item_id.startswith("kin_") and item_id[4:].isdigit():
            return item_id[4:]
        if item_id and item_id.isdigit() and item_id in self._by_kid:
            return item_id
        if item_id and item_id in self._live_meta_by_id:
            lm_kid = str(self._live_meta_by_id[item_id].get("kinorium_id") or "")
            if lm_kid.isdigit():
                return lm_kid
        rem = self._resolve_remote_item(item_id, title, orig_title)
        if rem and str(rem.get("kinorium_id") or "").isdigit():
            return str(rem["kinorium_id"])
        for nr in _title_variants(title):
            if nr in self._friend_kid_by_ru and str(self._friend_kid_by_ru[nr]).isdigit():
                return str(self._friend_kid_by_ru[nr])
            if nr in self._friend_kid_by_orig and str(self._friend_kid_by_orig[nr]).isdigit():
                return str(self._friend_kid_by_orig[nr])
        for no in _title_variants(orig_title):
            if no in self._friend_kid_by_orig and str(self._friend_kid_by_orig[no]).isdigit():
                return str(self._friend_kid_by_orig[no])
            if no in self._friend_kid_by_ru and str(self._friend_kid_by_ru[no]).isdigit():
                return str(self._friend_kid_by_ru[no])
        if not allow_network:
            return None
        # Live lookup via Kinorium /handlers/Search/ (requires XHR headers)
        nr_targets = set(_title_variants(title))
        no_targets = set(_title_variants(orig_title))
        queries: List[str] = []
        for q_cand in (orig_title, title):
            q_clean = (q_cand or "").strip()
            if q_clean and q_clean not in queries:
                queries.append(q_clean)
        xhr_headers = {
            "X-Requested-With": "XMLHttpRequest",
            "Referer": "https://ru.kinorium.com/",
        }
        best_kid: Optional[str] = None
        best_score = -1
        best_entry: Optional[Dict[str, Any]] = None
        for query in queries:
            try:
                q_enc = urllib.parse.quote(query)
                raw = self.fetch_kinorium_html(
                    f"https://ru.kinorium.com/handlers/Search/?str={q_enc}",
                    extra_headers=xhr_headers,
                )
                data = json.loads(raw)
                for idx, entry in enumerate(data.get("list") or []):
                    if entry.get("mixtype") != "movie" or not str(entry.get("id") or "").isdigit():
                        continue
                    cand_kid = str(entry["id"])
                    cand_ru = str(entry.get("name") or "")
                    cand_orig = str(entry.get("name_orig") or entry.get("orig") or "")
                    cand_nr = _norm_title(cand_ru)
                    cand_no = _norm_title(cand_orig)
                    sc = max(0, 15 - idx * 2)
                    if cand_no and cand_no in no_targets:
                        sc += 110
                    if cand_nr and cand_nr in nr_targets:
                        sc += 100
                    if cand_no and cand_no in nr_targets:
                        sc += 80
                    if cand_nr and cand_nr in no_targets:
                        sc += 80
                    if media_type in ("movie", "series"):
                        is_ser = bool(entry.get("isSerial"))
                        if is_ser == (media_type == "series"):
                            sc += 35
                        else:
                            sc -= 25
                    if year:
                        ey_raw = str(entry.get("year_serial_b") or entry.get("year") or "")
                        if ey_raw.isdigit() and abs(int(ey_raw) - int(year)) <= 1:
                            sc += 25
                    if sc > best_score:
                        best_score = sc
                        best_kid = cand_kid
                        best_entry = entry
                if best_kid and best_score >= 100:
                    break
            except Exception:
                continue
        if best_kid and best_entry is not None:
            self.state.setdefault("friend_known_titles", {})[best_kid] = {
                "kinorium_id": best_kid,
                "ru_title": str(best_entry.get("name") or title),
                "orig_title": str(best_entry.get("name_orig") or best_entry.get("orig") or orig_title),
            }
            self._build_lookup_indices()
            return best_kid
        return None

    def get_item_status(
        self,
        item_id: str,
        base_kinorium_rating: float = 8.1,
        title: str = "",
        orig_title: str = "",
    ) -> Dict[str, Any]:
        # 1. Check local overrides (scrobbled or rated during current session)
        local_watched = self.state.get("watched", {}).get(item_id)
        local_rating = self.state.get("ratings", {}).get(item_id)
        local_in_watchlist = item_id in self.state.get("watchlist", [])
        local_watching = item_id in self.state.get("watching_local", [])
        local_never = item_id in self.state.get("never_local", [])

        # 2. Check real synced Kinorium profile (`remote_*_items`)
        remote_item = self._resolve_remote_item(item_id, title, orig_title)
        kid_str = str(remote_item.get("kinorium_id")) if remote_item and remote_item.get("kinorium_id") else ""

        if local_watched is not None:
            is_watched = bool(local_watched.get("watched"))
        else:
            is_watched = bool(
                (kid_str and kid_str in (self.state.get("remote_watched_items") or {}))
                or (remote_item and remote_item.get("watched"))
            )

        if local_rating and local_rating.get("cleared"):
            user_score = None
        else:
            user_score = (
                local_rating.get("score")
                if local_rating and local_rating.get("score") is not None and int(local_rating.get("score") or 0) > 0
                else (remote_item.get("score") if remote_item else None)
            )
        user_comment = (
            ""
            if (local_rating and local_rating.get("cleared"))
            else (local_rating.get("comment", "") if local_rating else "")
        )

        nr_vars = _title_variants(title)
        no_vars = _title_variants(orig_title)
        nr = nr_vars[0] if nr_vars else ""

        unwatched_watchlist = self.state.get("watchlist_removed", [])
        in_watchlist = bool(
            item_id not in unwatched_watchlist
            and (
                local_in_watchlist
                or (kid_str and kid_str in (self.state.get("remote_watchlist_items") or {}))
                or any(v in self._watchlist_by_ru for v in nr_vars)
                or any(v in self._watchlist_by_orig for v in no_vars)
            )
        )

        watching_removed = self.state.get("watching_removed", [])
        is_watching = bool(
            item_id not in watching_removed
            and (
                local_watching
                or (kid_str and kid_str in (self.state.get("remote_watching_items") or {}))
                or any(v in self._watching_by_ru for v in nr_vars)
                or any(v in self._watching_by_orig for v in no_vars)
            )
        )

        never_removed = self.state.get("never_removed", [])
        not_watching = bool(
            item_id not in never_removed
            and (
                local_never
                or (kid_str and kid_str in (self.state.get("remote_never_items") or {}))
                or any(v in self._never_by_ru for v in nr_vars)
                or any(v in self._never_by_orig for v in no_vars)
            )
        )

        # 3. Resolve real friends' ratings and per-season watched episodes map first
        kid = kid_str or self._resolve_kinorium_id(item_id, title, orig_title)
        friends_ratings: List[Dict[str, Any]] = []
        if kid:
            friends_ratings = (self.state.get("friends_ratings_by_kid") or {}).get(str(kid), [])

        raw_we = self.state.get("watched_episodes") or {}
        we_map: Dict[str, List[int]] = {}
        for k_lookup in filter(None, [item_id, f"kin_{kid}" if kid else ""]):
            sub_map = raw_we.get(k_lookup) or {}
            if isinstance(sub_map, dict):
                for s_k, ep_list in sub_map.items():
                    if isinstance(ep_list, list):
                        merged_eps = sorted(
                            set(we_map.get(str(s_k), []) + [int(x) for x in ep_list if str(x).isdigit()])
                        )
                        we_map[str(s_k)] = merged_eps

        raw_er = self.state.get("episode_ratings") or {}
        ep_ratings_map: Dict[str, Dict[str, Any]] = {}
        for k_lookup in filter(None, [item_id, f"kin_{kid}" if kid else ""]):
            sub_er = raw_er.get(k_lookup) or {}
            if isinstance(sub_er, dict):
                for ep_k, ep_val in sub_er.items():
                    if isinstance(ep_val, dict):
                        ep_ratings_map[str(ep_k)] = dict(ep_val)

        # 4. Unified Season & Episode resolution across Continue Watching, Poster Grid, Notifications & Player
        mtype_val = (remote_item.get("media_type") if remote_item else "series") or "series"
        has_new_episode = bool(is_watching and not is_watched and not not_watching and mtype_val == "series")

        cw_match = None
        for cw_it in self.state.get("continue_watching") or []:
            if (
                cw_it.get("id") == item_id
                or (kid and cw_it.get("id") == f"kin_{kid}")
                or (nr and _norm_title(cw_it.get("title", "")) == nr)
            ):
                cw_match = cw_it
                break

        live_meta = self.get_series_live_meta(item_id=item_id, title=title, orig_title=orig_title, kid=kid)
        next_season = 1
        next_episode = 1
        episode_verified = False
        latest_season = None
        latest_episode = None
        studios_summary = ""

        has_mid_episode_resume = bool(
            cw_match
            and not cw_match.get("is_new_episode")
            and float(cw_match.get("current_time") or 0.0) >= 15.0
        )

        is_series_completed = False
        if live_meta and not live_meta.get("not_found"):
            latest_season = max(1, int(live_meta.get("latest_season") or 1))
            latest_episode = max(1, int(live_meta.get("latest_episode") or 1))
            studios_summary = str(live_meta.get("studios_summary") or "")
            if bool(live_meta.get("is_completed")):
                rem_seasons = int(remote_item.get("seasons_count") or 0) if remote_item else 0
                if not (rem_seasons > latest_season):
                    is_series_completed = True

        if has_mid_episode_resume and cw_match:
            next_season = max(1, int(cw_match.get("season") or 1))
            next_episode = max(1, int(cw_match.get("episode") or 1))
            episode_verified = True
        elif latest_season is not None and latest_episode is not None:
            watched_in_latest = we_map.get(str(latest_season)) or []
            if watched_in_latest:
                max_watched_ep = max(watched_in_latest)
                if max_watched_ep >= latest_episode:
                    # User already watched up to the latest released episode on HDRezka
                    has_new_episode = False
                    next_season = latest_season
                    next_episode = latest_episode
                else:
                    next_season = latest_season
                    next_episode = max_watched_ep + 1
            else:
                numeric_seasons = sorted(
                    int(k) for k in we_map.keys() if str(k).isdigit() and we_map.get(k)
                )
                if numeric_seasons:
                    max_prev_s = max(numeric_seasons)
                    max_prev_ep = max(we_map[str(max_prev_s)])
                    smap = (live_meta.get("seasons_map") or {}) if isinstance(live_meta, dict) else {}
                    prev_s_eps = [
                        int(x) for x in (smap.get(str(max_prev_s)) or []) if str(x).isdigit()
                    ]
                    if prev_s_eps and max_prev_ep < max(prev_s_eps):
                        next_season = max_prev_s
                        next_episode = max_prev_ep + 1
                    else:
                        next_season = min(latest_season, max_prev_s + 1)
                        next_episode = 1
                elif cw_match and not cw_match.get("is_new_episode") and (
                    cw_match.get("season") or cw_match.get("episode")
                ):
                    next_season = max(1, int(cw_match.get("season") or 1))
                    next_episode = max(1, int(cw_match.get("episode") or 1))
                else:
                    next_season = 1
                    next_episode = 1
            episode_verified = True
        elif live_meta and live_meta.get("not_found"):
            has_new_episode = False
            episode_verified = False
        elif cw_match and (cw_match.get("season") or cw_match.get("episode")):
            next_season = max(1, int(cw_match.get("season") or next_season))
            next_episode = max(1, int(cw_match.get("episode") or 1))
            episode_verified = not bool(cw_match.get("is_new_episode"))
        elif we_map:
            numeric_seasons = [int(k) for k in we_map.keys() if str(k).isdigit() and we_map.get(k)]
            if numeric_seasons:
                max_s = max(numeric_seasons)
                max_w = max(we_map[str(max_s)])
                next_season = max_s
                next_episode = max_w + 1
                episode_verified = True

        # Primary status code for badge display
        if not_watching:
            st_code = "never"
        elif has_new_episode:
            st_code = "new_ep"
        elif is_watched:
            st_code = "done"
        elif is_watching:
            st_code = "now"
        elif in_watchlist:
            st_code = "future"
        else:
            st_code = ""

        cached_critics = None
        if remote_item and remote_item.get("critics_rating") is not None:
            cached_critics = int(remote_item["critics_rating"])
        elif kid and str(kid) in (self.state.get("critics_by_kid") or {}):
            cv = self.state["critics_by_kid"][str(kid)]
            if isinstance(cv, int) and cv > 0:
                cached_critics = cv

        return {
            "kinorium_id": kid,
            "kinorium_rating": remote_item.get("kinorium_rating", base_kinorium_rating) if remote_item else base_kinorium_rating,
            "critics_rating": cached_critics,
            "status_code": st_code,
            "watched": is_watched,
            "watching": is_watching,
            "has_new_episode": has_new_episode,
            "episode_verified": episode_verified,
            "next_season": next_season,
            "next_episode": next_episode,
            "latest_season": latest_season,
            "latest_episode": latest_episode,
            "is_completed": is_series_completed,
            "studios_summary": studios_summary,
            "watched_episodes": we_map,
            "episode_ratings": ep_ratings_map,
            "in_watchlist": in_watchlist,
            "not_watching": not_watching,
            "watched_info": local_watched or remote_item,
            "user_rating": user_score,
            "user_comment": user_comment,
            "friends_ratings": friends_ratings,
            "profile_name": self.state["account"].get("display_name", "Andrei Crustillio"),
        }

    def get_watching_with_new_episodes(self) -> List[Dict[str, Any]]:
        """
        Returns all series from the user's 'Смотрю' list that have unwatched / newly released episodes
        (i.e. `has_new_episode == True`).
        """
        all_watching = self.get_section_catalog_items(section="watching", media_type_filter="series", query="")
        active_new_eps: List[Dict[str, Any]] = []
        for it in all_watching:
            ks = it.get("kinorium") or {}
            if ks.get("has_new_episode") and not ks.get("watched") and not ks.get("not_watching"):
                active_new_eps.append(it)
        return active_new_eps

    def get_sections_counts(self, premieres_count: int = 50) -> Dict[str, int]:
        wl_items = self.state.get("remote_watchlist_items") or {}
        wl_online_count = sum(
            1
            for v in wl_items.values()
            if v.get("available_online", True)
            and not v.get("is_unreleased", False)
            and int(v.get("year") or 2024) <= 2026
        )
        return {
            "premieres": premieres_count,
            "watching": len(self.state.get("remote_watching_items") or {}),
            "watchlist": wl_online_count,
            "watched": len(self.state.get("remote_watched_items") or {}),
            "never": len(self.state.get("remote_never_items") or {}),
        }

    def get_section_catalog_items(
        self,
        section: str,
        media_type_filter: str = "all",
        query: str = "",
    ) -> List[Dict[str, Any]]:
        """
        Converts all synced Kinorium items from a given section:
        - `watching` / `now` («Смотрю»)
        - `watchlist` / `future` («Буду смотреть»)
        - `watched` / `done` («Просмотрено»)
        - `never` / `not_watching` («Не буду смотреть»)
        into full, playable CineFlow catalog items with high-resolution Kinorium posters.
        """
        sec_map = {
            "watching": "remote_watching_items",
            "now": "remote_watching_items",
            "watchlist": "remote_watchlist_items",
            "future": "remote_watchlist_items",
            "watched": "remote_watched_items",
            "done": "remote_watched_items",
            "never": "remote_never_items",
            "not_watching": "remote_never_items",
        }
        state_key = sec_map.get(section)
        if not state_key:
            return []

        raw_dict = self.state.get(state_key) or {}
        q_norm = _norm_title(query)
        items_out: List[Dict[str, Any]] = []

        for kid, entry in raw_dict.items():
            # In 'watchlist' («Буду смотреть»), hide movies/series that are not yet released online
            if section in ("watchlist", "future"):
                if (
                    entry.get("available_online") is False
                    or entry.get("is_unreleased") is True
                    or int(entry.get("year") or 2024) > 2026
                ):
                    continue

            mtype = entry.get("media_type", "movie")
            if media_type_filter in ("movie", "series") and mtype != media_type_filter:
                continue

            ru_t = entry.get("ru_title", "")
            orig_t = entry.get("orig_title", "") or ru_t
            if q_norm:
                if q_norm not in _norm_title(ru_t) and q_norm not in _norm_title(orig_t):
                    continue

            item_id = f"kin_{kid}" if str(kid).isdigit() else str(kid)
            kr_rating = float(entry.get("kinorium_rating") or 7.8)
            im_rating = float(entry.get("imdb_rating") or kr_rating)
            k_status = self.get_item_status(
                item_id=item_id,
                base_kinorium_rating=kr_rating,
                title=ru_t,
                orig_title=orig_t,
            )
            critics_val = entry.get("critics_rating")
            if critics_val is None and k_status.get("critics_rating") is not None:
                critics_val = k_status["critics_rating"]
            ratings_out: Dict[str, Any] = {
                "kinorium": kr_rating,
                "imdb": im_rating,
            }
            if critics_val is not None:
                ratings_out["critics"] = int(critics_val)

            item_obj: Dict[str, Any] = {
                "id": item_id,
                "kinorium_id": str(kid),
                "title": ru_t,
                "orig_title": orig_t,
                "title_pl": orig_t,
                "year": entry.get("year") or 2024,
                "media_type": mtype,
                "seasons_count": entry.get("seasons_count") or (2 if mtype == "series" else 1),
                "episodes_per_season": entry.get("episodes_per_season") or (8 if mtype == "series" else 1),
                "genres": entry.get("genres") or (["Сериал"] if mtype == "series" else ["Фильм"]),
                "description": entry.get("description") or f"{ru_t} ({orig_t})",
                "poster": entry.get("poster") or f"https://ru-images.kinorium.com/movie/600/{kid}.jpg",
                "poster_en": entry.get("poster_en") or (f"https://en-images.kinorium.com/movie/600/{kid}.jpg" if str(kid).isdigit() else ""),
                "backdrop": entry.get("backdrop") or f"https://ru-images.kinorium.com/movie/1080/{kid}.jpg",
                "ambient_color": "#1e293b",
                "ratings": ratings_out,
                "providers": [
                    {"id": "hdrezka", "available": True, "quality": "1080p", "audio": "RU/EN"},
                    {"id": "backup4k", "available": True, "quality": "4K Remux", "audio": "RU/EN"},
                ],
                "kinorium": k_status,
            }
            if entry.get("rezka_id"):
                item_obj["rezka_id"] = entry["rezka_id"]
            if entry.get("rezka_url"):
                item_obj["rezka_url"] = entry["rezka_url"]
            items_out.append(item_obj)
        return items_out

    def _maybe_auto_complete_series(
        self,
        item_id: str,
        title: str,
        orig_title: str = "",
        season: int = 1,
        episode: int = 1,
        total_seasons: int = 0,
        total_episodes_in_season: int = 0,
        is_series_completed: Optional[bool] = None,
        **extra,
    ) -> bool:
        """
        If a series is completed/ended, currently has status 'Смотрю' (`watching == True`),
        and the user finished watching the final episode of the final season, automatically
        switch its status from 'Смотрю' to 'Просмотрено' (`watched = True`, `watching = False`).
        """
        cur_status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        if not cur_status.get("watching") or cur_status.get("watched") or cur_status.get("not_watching"):
            return False

        kid = cur_status.get("kinorium_id")
        live_meta = self.get_series_live_meta(item_id=item_id, title=title, orig_title=orig_title, kid=kid)
        if live_meta and live_meta.get("not_found"):
            return False

        meta_has_flag = bool(live_meta and "is_completed" in live_meta)
        meta_completed = bool(live_meta and live_meta.get("is_completed"))
        if meta_has_flag and not meta_completed:
            return False
        effective_completed = meta_completed or bool(is_series_completed is True)
        if not effective_completed:
            return False

        final_season = 0
        final_episode = 0
        if live_meta:
            smap = live_meta.get("seasons_map")
            if isinstance(smap, dict) and smap:
                s_nums = [int(k) for k in smap.keys() if str(k).isdigit() and smap.get(k)]
                if s_nums:
                    final_season = max(s_nums)
                    ep_vals = [int(e) for e in (smap.get(str(final_season)) or []) if str(e).isdigit()]
                    if ep_vals:
                        final_episode = max(ep_vals)
            if (final_season <= 0 or final_episode <= 0) and live_meta.get("latest_season") and live_meta.get("latest_episode"):
                final_season = int(live_meta.get("latest_season") or 0)
                final_episode = int(live_meta.get("latest_episode") or 0)

        if (final_season <= 0 or final_episode <= 0) and total_seasons > 0 and total_episodes_in_season > 0:
            if int(season) == int(total_seasons):
                final_season = int(total_seasons)
                final_episode = int(total_episodes_in_season)

        if final_season <= 0 or final_episode <= 0:
            return False

        remote_item = self._resolve_remote_item(item_id, title, orig_title)
        if remote_item:
            if remote_item.get("is_unreleased"):
                return False
            rem_seasons = int(remote_item.get("seasons_count") or 0)
            if rem_seasons > final_season:
                return False

        if int(season) != final_season or int(episode) < final_episode:
            return False

        extra_payload = dict(extra)
        extra_payload.setdefault("media_type", "series")
        self.mark_watched(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            watched=True,
            season=int(season),
            episode=int(episode),
            auto_scrobbled=True,
            **extra_payload,
        )
        return True

    def update_progress_and_scrobble(
        self,
        item_id: str,
        title: str,
        orig_title: str = "",
        poster: str = "",
        backdrop: str = "",
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        current_time: float = 0,
        duration: float = 1,
        source: str = "HDRezka",
        studio: str = "HDRezka Studio",
        total_seasons: int = 1,
        total_episodes_in_season: int = 1,
        is_series_completed: Optional[bool] = None,
    ) -> Dict[str, Any]:
        progress = min(1.0, max(0.0, current_time / max(1.0, duration)))
        threshold = float(self.state["account"].get("auto_scrobble_threshold", 0.85))
        nr = _norm_title(title)
        kid_hint = self._resolve_kinorium_id(item_id, title, orig_title, allow_network=False)

        cw_list: List[Dict[str, Any]] = [
            x
            for x in self.state.get("continue_watching", [])
            if x.get("id") != item_id
            and (not kid_hint or x.get("id") != f"kin_{kid_hint}")
            and (not nr or _norm_title(x.get("title", "")) != nr)
        ]

        just_scrobbled = False
        just_scrobbled_episode = False
        auto_completed_series = False
        promoted_to_watching = False
        remote_ep_synced = False
        cur_status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        already_watched = bool(cur_status.get("watched"))

        if progress >= threshold:
            if media_type == "series":
                prev_season_eps = (cur_status.get("watched_episodes") or {}).get(str(int(season)), [])
                already_ep_watched = int(episode) in prev_season_eps
                kid_resolved = self._resolve_kinorium_id(
                    item_id,
                    title,
                    orig_title,
                    allow_network=True,
                    media_type="series",
                )
                self._record_episode_watched(
                    item_id,
                    title,
                    orig_title,
                    season,
                    episode,
                    resolved_kid=kid_resolved,
                )
                if not already_ep_watched:
                    just_scrobbled_episode = True
                auto_completed_series = self._maybe_auto_complete_series(
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    season=season,
                    episode=episode,
                    total_seasons=total_seasons,
                    total_episodes_in_season=total_episodes_in_season,
                    is_series_completed=is_series_completed,
                    poster=poster,
                    backdrop=backdrop,
                    media_type="series",
                )
                if auto_completed_series:
                    just_scrobbled = True
                else:
                    promoted_to_watching = self._promote_series_to_watching_if_needed(
                        item_id=item_id,
                        title=title,
                        orig_title=orig_title,
                        kid=kid_resolved,
                        poster=poster,
                        backdrop=backdrop,
                        media_type="series",
                    )
                    # Check if there is a next episode in this season or next season
                    has_more_in_season = total_episodes_in_season > 1 and episode < total_episodes_in_season
                    has_more_seasons = total_seasons > 1 and season < total_seasons
                    if has_more_in_season or has_more_seasons:
                        next_s = season if has_more_in_season else season + 1
                        next_e = (episode + 1) if has_more_in_season else 1
                        cw_entry = {
                            "id": item_id,
                            "title": title,
                            "orig_title": orig_title,
                            "poster": poster,
                            "backdrop": backdrop,
                            "media_type": media_type,
                            "season": next_s,
                            "episode": next_e,
                            "current_time": 0.0,
                            "duration": round(duration, 1),
                            "progress": 0.0,
                            "is_new_episode": True,
                            "source": source,
                            "studio": studio,
                            "updated_at": int(time.time()),
                        }
                        cw_list.insert(0, cw_entry)
                if kid_resolved and (not already_ep_watched or not self._is_episode_cached_remote_done(kid_resolved, int(season), int(episode))):
                    remote_ep_synced, _ = self._sync_episodes_map_to_kinorium_remote(
                        kid=kid_resolved,
                        item_id=item_id,
                        target_by_season={int(season): [int(episode)]},
                    )
            else:
                # Finished movie -> mark watched and remove from Up Next
                if not already_watched:
                    self.mark_watched(
                        item_id=item_id,
                        title=title,
                        orig_title=orig_title,
                        auto_scrobbled=True,
                        poster=poster,
                        backdrop=backdrop,
                        media_type="movie",
                    )
                    just_scrobbled = True
        elif current_time >= 15.0 or progress >= 0.02:
            cw_entry = {
                "id": item_id,
                "title": title,
                "orig_title": orig_title,
                "poster": poster,
                "backdrop": backdrop,
                "media_type": media_type,
                "season": season,
                "episode": episode,
                "current_time": round(current_time, 1),
                "duration": round(duration, 1),
                "progress": round(progress, 3),
                "is_new_episode": False,
                "source": source,
                "studio": studio,
                "updated_at": int(time.time()),
            }
            cw_list.insert(0, cw_entry)

        self.state["continue_watching"] = cw_list[:12]
        if not auto_completed_series and (current_time >= 15.0 or progress >= 0.02):
            dismissed = self.state.get("cw_dismissed") or []
            if dismissed:
                self.state["cw_dismissed"] = [
                    d for d in dismissed if d != item_id and (not nr or d != f"title:{nr}")
                ]
        is_milestone = bool(just_scrobbled or just_scrobbled_episode or auto_completed_series or promoted_to_watching)
        self._save_state(immediate=is_milestone, bump_version=is_milestone)
        out: Dict[str, Any] = {
            "progress": round(progress, 3),
            "threshold": threshold,
            "just_scrobbled": just_scrobbled,
            "just_scrobbled_episode": just_scrobbled_episode,
            "auto_completed_series": auto_completed_series,
            "promoted_to_watching": promoted_to_watching,
            "remote_synced": remote_ep_synced if media_type == "series" else just_scrobbled,
            "scrobbled_season": int(season),
            "scrobbled_episode": int(episode),
            "continue_watching": self.state["continue_watching"],
            "kinorium_status": self.get_item_status(item_id, title=title, orig_title=orig_title),
        }
        if just_scrobbled or auto_completed_series or promoted_to_watching:
            out["kinorium_counts"] = self.get_sections_counts()
        return out

    def dismiss_continue_watching(self, item_id: str, title: str = "") -> Dict[str, Any]:
        nr = _norm_title(title)
        self.state["continue_watching"] = [
            x
            for x in self.state.get("continue_watching", [])
            if x.get("id") != item_id and (not nr or _norm_title(x.get("title", "")) != nr)
        ]
        dismissed = self.state.setdefault("cw_dismissed", [])
        if item_id and item_id not in dismissed:
            dismissed.append(item_id)
        if nr and f"title:{nr}" not in dismissed:
            dismissed.append(f"title:{nr}")
        self._save_state()
        return {"ok": True, "dismissed_id": item_id}

    def _ensure_remote_entry_template(
        self,
        kid: str,
        title: str,
        orig_title: str,
        extra: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        existing = self._by_kid.get(str(kid))
        if existing:
            tpl = dict(existing)
        else:
            ex = extra or {}
            mtype = str(ex.get("media_type") or "movie")
            year_val = int(ex.get("year") or 2024)
            default_poster = f"https://ru-images.kinorium.com/movie/600/{kid}.jpg" if str(kid).isdigit() else ""
            default_backdrop = f"https://ru-images.kinorium.com/movie/1080/{kid}.jpg" if str(kid).isdigit() else ""
            tpl = {
                "kinorium_id": str(kid),
                "ru_title": title,
                "orig_title": orig_title or title,
                "year": year_val,
                "media_type": mtype,
                "seasons_count": 2 if mtype == "series" else 1,
                "episodes_per_season": 8 if mtype == "series" else 1,
                "genres": ["Сериал"] if mtype == "series" else ["Фильм"],
                "description": f"{title} ({orig_title or year_val})",
                "kinorium_rating": 8.0,
                "imdb_rating": 8.0,
                "poster": str(ex.get("poster") or default_poster),
                "backdrop": str(ex.get("backdrop") or ex.get("poster") or default_backdrop),
                "status": "done",
                "watched": False,
                "watching": False,
                "in_watchlist": False,
                "not_watching": False,
                "score": None,
                "watched_at": "",
            }
        if extra:
            if extra.get("poster") and not tpl.get("poster"):
                tpl["poster"] = str(extra["poster"])
            if extra.get("backdrop") and not tpl.get("backdrop"):
                tpl["backdrop"] = str(extra["backdrop"])
            if extra.get("media_type"):
                tpl["media_type"] = str(extra["media_type"])
            if extra.get("year"):
                tpl["year"] = int(extra["year"])
            if extra.get("rezka_id"):
                tpl["rezka_id"] = str(extra["rezka_id"])
            if extra.get("rezka_url"):
                tpl["rezka_url"] = str(extra["rezka_url"])
        return tpl

    def _record_episode_watched(
        self,
        item_id: str,
        title: str,
        orig_title: str,
        season: Optional[int],
        episode: Optional[int],
        resolved_kid: Optional[str] = None,
    ):
        if not season or not episode:
            return
        s_key = str(int(season))
        ep_num = int(episode)
        kid = resolved_kid or self._resolve_kinorium_id(item_id, title, orig_title, allow_network=False)
        we_root = self.state.setdefault("watched_episodes", {})
        keys = [k for k in (item_id, f"kin_{kid}" if (kid and str(kid).isdigit()) else "") if k]
        for k_id in dict.fromkeys(keys):
            item_map = we_root.setdefault(k_id, {})
            cur_list = item_map.get(s_key) or []
            if ep_num not in cur_list:
                cur_list.append(ep_num)
                item_map[s_key] = sorted(set(cur_list))

    def _unrecord_episode_watched(
        self,
        item_id: str,
        title: str,
        orig_title: str,
        season: Optional[int],
        episode: Optional[int],
        resolved_kid: Optional[str] = None,
    ):
        if not season or not episode:
            return
        s_key = str(int(season))
        ep_num = int(episode)
        kid = resolved_kid or self._resolve_kinorium_id(item_id, title, orig_title, allow_network=False)
        we_root = self.state.setdefault("watched_episodes", {})
        keys = [k for k in (item_id, f"kin_{kid}" if (kid and str(kid).isdigit()) else "") if k]
        for k_id in dict.fromkeys(keys):
            item_map = we_root.get(k_id)
            if isinstance(item_map, dict) and s_key in item_map:
                next_list = [int(x) for x in (item_map.get(s_key) or []) if str(x).isdigit() and int(x) != ep_num]
                if next_list:
                    item_map[s_key] = sorted(set(next_list))
                else:
                    item_map.pop(s_key, None)

    def mark_episodes_batch(
        self,
        item_id: str,
        title: str,
        orig_title: str = "",
        season: int = 1,
        episodes: Optional[List[int]] = None,
        mark_season_complete: bool = False,
        total_seasons: int = 0,
        total_episodes_in_season: int = 0,
        is_series_completed: Optional[bool] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        eps = sorted({int(x) for x in (episodes or []) if str(x).isdigit() and int(x) > 0})
        kid = self._resolve_kinorium_id(
            item_id,
            title,
            orig_title,
            allow_network=True,
            media_type="series",
            year=int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None,
        )
        for ep_num in eps:
            self._record_episode_watched(item_id, title, orig_title, season, ep_num, resolved_kid=kid)
        auto_completed_series = False
        promoted_to_watching = False
        remote_synced = False
        remote_synced_count = 0
        if eps:
            auto_completed_series = self._maybe_auto_complete_series(
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                season=season,
                episode=max(eps),
                total_seasons=total_seasons,
                total_episodes_in_season=total_episodes_in_season,
                is_series_completed=is_series_completed,
                **kwargs,
            )
            if not auto_completed_series:
                promoted_to_watching = self._promote_series_to_watching_if_needed(
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    kid=kid,
                    **kwargs,
                )
            if kid:
                remote_synced, remote_synced_count = self._sync_episodes_map_to_kinorium_remote(
                    kid=kid,
                    item_id=item_id,
                    target_by_season={int(season): eps},
                    mark_season_complete=mark_season_complete,
                )
        self._save_state()
        status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        status["marked_episodes_count"] = len(eps)
        status["mark_season_complete"] = bool(mark_season_complete)
        status["auto_completed_series"] = auto_completed_series
        status["promoted_to_watching"] = promoted_to_watching
        status["remote_synced"] = remote_synced
        status["remote_synced_count"] = remote_synced_count
        status["kinorium_counts"] = self.get_sections_counts()
        return status

    def toggle_episode_watched(
        self,
        item_id: str,
        title: str,
        orig_title: str = "",
        season: int = 1,
        episode: int = 1,
        watched: Optional[bool] = None,
        total_seasons: int = 0,
        total_episodes_in_season: int = 0,
        is_series_completed: Optional[bool] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        s_num = max(1, int(season or 1))
        e_num = max(1, int(episode or 1))
        cur_status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        cur_eps = (cur_status.get("watched_episodes") or {}).get(str(s_num)) or []
        currently_watched = e_num in cur_eps
        next_watched = (not currently_watched) if watched is None else bool(watched)
        kid = self._resolve_kinorium_id(
            item_id,
            title,
            orig_title,
            allow_network=True,
            media_type="series",
            year=int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None,
        )
        auto_completed_series = False
        promoted_to_watching = False
        remote_synced = False
        if next_watched:
            self._record_episode_watched(item_id, title, orig_title, s_num, e_num, resolved_kid=kid)
            auto_completed_series = self._maybe_auto_complete_series(
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                season=s_num,
                episode=e_num,
                total_seasons=total_seasons,
                total_episodes_in_season=total_episodes_in_season,
                is_series_completed=is_series_completed,
                **kwargs,
            )
            if not auto_completed_series:
                promoted_to_watching = self._promote_series_to_watching_if_needed(
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    kid=kid,
                    **kwargs,
                )
            if kid:
                remote_synced, _ = self._sync_episodes_map_to_kinorium_remote(
                    kid=kid,
                    item_id=item_id,
                    target_by_season={s_num: [e_num]},
                )
        else:
            self._unrecord_episode_watched(item_id, title, orig_title, s_num, e_num, resolved_kid=kid)
            if kid:
                ep_state = self.fetch_series_episodes_state(kid, item_id=item_id)
                ep_info = (ep_state.get("episodes") or {}).get((s_num, e_num))
                if ep_info and ep_info.get("ep_id"):
                    remote_synced = self._post_episode_status_remote(
                        kid=kid,
                        ep_id=str(ep_info["ep_id"]),
                        watched=False,
                    )
                    if remote_synced:
                        ep_info["watched"] = False
                        ep_info["rating"] = None
            er_root = self.state.get("episode_ratings") or {}
            ep_key = f"s{s_num}e{e_num}"
            for k_id in filter(None, [item_id, f"kin_{kid}" if (kid and str(kid).isdigit()) else ""]):
                if isinstance(er_root.get(k_id), dict):
                    er_root[k_id].pop(ep_key, None)

        self._save_state()
        status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        status["episode_watched"] = next_watched
        status["toggled_season"] = s_num
        status["toggled_episode"] = e_num
        status["auto_completed_series"] = auto_completed_series
        status["promoted_to_watching"] = promoted_to_watching
        status["remote_synced"] = remote_synced
        status["kinorium_counts"] = self.get_sections_counts()
        return status

    def get_profile_stats(self) -> Dict[str, Any]:
        watched_dict = self.state.get("remote_watched_items") or {}
        watching_dict = self.state.get("remote_watching_items") or {}
        watchlist_dict = self.state.get("remote_watchlist_items") or {}
        never_dict = self.state.get("remote_never_items") or {}
        local_ratings = self.state.get("ratings") or {}
        friends_by_kid = self.state.get("friends_ratings_by_kid") or {}

        watched_movies = 0
        watched_series = 0
        histogram = {str(s): 0 for s in range(10, 0, -1)}
        user_scores: List[int] = []
        kin_scores: List[float] = []
        decades = {
            "2020–2026": 0,
            "2010–2019": 0,
            "2000–2009": 0,
            "1990–1999": 0,
            "До 1990": 0,
        }
        favorites: List[Dict[str, Any]] = []
        friend_stats: Dict[str, Dict[str, Any]] = {}

        for kid, entry in watched_dict.items():
            mtype = entry.get("media_type", "movie")
            if mtype == "series":
                watched_series += 1
            else:
                watched_movies += 1

            yr = int(entry.get("year") or 2020)
            if yr >= 2020:
                decades["2020–2026"] += 1
            elif yr >= 2010:
                decades["2010–2019"] += 1
            elif yr >= 2000:
                decades["2000–2009"] += 1
            elif yr >= 1990:
                decades["1990–1999"] += 1
            else:
                decades["До 1990"] += 1

            kr = entry.get("kinorium_rating")
            if kr:
                try:
                    kin_scores.append(float(kr))
                except Exception:
                    pass

            loc_r = local_ratings.get(f"kin_{kid}") or local_ratings.get(str(kid))
            sc = loc_r.get("score") if isinstance(loc_r, dict) else entry.get("score")
            if sc is not None:
                try:
                    sc_int = max(1, min(10, int(sc)))
                    user_scores.append(sc_int)
                    histogram[str(sc_int)] = histogram.get(str(sc_int), 0) + 1
                    if sc_int >= 9:
                        favorites.append(
                            {
                                "id": f"kin_{kid}" if str(kid).isdigit() else str(kid),
                                "title": entry.get("ru_title") or entry.get("orig_title") or "",
                                "orig_title": entry.get("orig_title") or "",
                                "year": yr,
                                "media_type": mtype,
                                "score": sc_int,
                                "poster": entry.get("poster")
                                or (f"https://ru-images.kinorium.com/movie/600/{kid}.jpg" if str(kid).isdigit() else ""),
                            }
                        )
                    for fr in friends_by_kid.get(str(kid), []):
                        fname = fr.get("name")
                        fscore = fr.get("score")
                        if fname and fscore:
                            st = friend_stats.setdefault(
                                fname,
                                {
                                    "name": fname,
                                    "common": 0,
                                    "similar_within_1": 0,
                                    "diff_sum": 0.0,
                                    "friend_sum": 0.0,
                                },
                            )
                            diff_val = abs(float(sc_int) - float(fscore))
                            st["common"] += 1
                            if diff_val <= 1.0:
                                st["similar_within_1"] += 1
                            st["diff_sum"] += diff_val
                            st["friend_sum"] += float(fscore)
                except Exception:
                    pass

        favorites.sort(key=lambda x: (x["score"], x["year"]), reverse=True)
        friend_meta_by_name = {
            str(f.get("name") or "").strip(): f
            for f in (self.state.get("friends") or [])
            if isinstance(f, dict) and f.get("name")
        }
        friends_out = []
        for fname, st in friend_stats.items():
            if st["common"] > 0:
                avg_diff = st["diff_sum"] / st["common"]
                f_meta = friend_meta_by_name.get(fname) or {}
                official_pct = f_meta.get("kinorium_proximity_pct")
                if official_pct is not None:
                    similarity = max(0, min(100, int(official_pct)))
                else:
                    # Kinorium defines 'процент близости' as the share of common ratings differing by at most 1 point
                    similarity = max(0, min(100, round(st["similar_within_1"] * 100 / st["common"])))
                friends_out.append(
                    {
                        "name": fname,
                        "common_count": st["common"],
                        "similar_count": st["similar_within_1"],
                        "avg_friend_score": round(st["friend_sum"] / st["common"], 1),
                        "avg_diff": round(avg_diff, 2),
                        "similarity_pct": similarity,
                        "official_kinorium_pct": official_pct is not None,
                    }
                )
        friends_out.sort(key=lambda x: (x["similarity_pct"], x["common_count"]), reverse=True)

        total_watched = len(watched_dict)
        estimated_hours = round(watched_movies * 2.0 + watched_series * 10.5)
        return {
            "profile_name": self.state.get("account", {}).get("display_name") or "Киноман",
            "user_id": self.state.get("account", {}).get("user_id") or "",
            "total_watched": total_watched,
            "watched_movies": watched_movies,
            "watched_series": watched_series,
            "watching_count": len(watching_dict),
            "watchlist_count": len(watchlist_dict),
            "never_count": len(never_dict),
            "estimated_hours": estimated_hours,
            "estimated_days": round(estimated_hours / 24, 1),
            "rated_count": len(user_scores),
            "avg_user_rating": round(sum(user_scores) / len(user_scores), 2) if user_scores else 0.0,
            "avg_kinorium_rating": round(sum(kin_scores) / len(kin_scores), 2) if kin_scores else 0.0,
            "ratings_histogram": histogram,
            "decades": decades,
            "friends_comparison": friends_out[:8],
            "top_favorites": favorites[:12],
        }

    def mark_watched(
        self,
        item_id: str,
        title: str,
        orig_title: str = "",
        watched: bool = True,
        season: Optional[int] = None,
        episode: Optional[int] = None,
        auto_scrobbled: bool = False,
        auto_scrobbled_alias: bool = False,
        **kwargs,
    ) -> Dict[str, Any]:
        now_str = time.strftime("%Y-%m-%d %H:%M")
        prev_status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        was_watching = bool(prev_status.get("watching"))
        kid = self._resolve_kinorium_id(
            item_id,
            title,
            orig_title,
            allow_network=True,
            media_type=str(kwargs.get("media_type") or ""),
            year=int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None,
        )
        eff_kid = str(kid) if (kid and str(kid).isdigit()) else ""
        nr = _norm_title(title)
        if watched:
            if season and episode:
                self._record_episode_watched(item_id, title, orig_title, season, episode, resolved_kid=kid)
                if eff_kid:
                    self._sync_episodes_map_to_kinorium_remote(
                        kid=eff_kid,
                        item_id=item_id,
                        target_by_season={int(season): [int(episode)]},
                    )
            entry_val = {
                "item_id": item_id,
                "title": title,
                "orig_title": orig_title,
                "watched": True,
                "watched_at": now_str,
                "season": season,
                "episode": episode,
                "auto_scrobbled": auto_scrobbled or auto_scrobbled_alias,
            }
            self.state["watched"][item_id] = entry_val
            # Remove from continue_watching since all episodes / movie are now marked watched
            self.state["continue_watching"] = [
                x
                for x in self.state.get("continue_watching", [])
                if x.get("id") != item_id
                and (not eff_kid or x.get("id") != f"kin_{eff_kid}")
                and (not nr or _norm_title(x.get("title", "")) != nr)
            ]
            # Clear 'Смотрю' locally so item moves cleanly from 'Смотрю' -> 'Просмотрено'
            loc_w = self.state.setdefault("watching_local", [])
            if item_id in loc_w:
                loc_w.remove(item_id)
            if eff_kid and f"kin_{eff_kid}" in loc_w:
                loc_w.remove(f"kin_{eff_kid}")
            rem_w = self.state.setdefault("watching_removed", [])
            if item_id and item_id not in rem_w:
                rem_w.append(item_id)
            if eff_kid:
                self.state["watched"][f"kin_{eff_kid}"] = entry_val
                if f"kin_{eff_kid}" not in rem_w:
                    rem_w.append(f"kin_{eff_kid}")
                tpl = self._ensure_remote_entry_template(eff_kid, title, orig_title, extra=kwargs)
                tpl["watched"] = True
                tpl["watching"] = False
                tpl["in_watchlist"] = False
                tpl["status"] = "done"
                tpl["watched_at"] = now_str
                self.state.setdefault("remote_watched_items", {})[str(eff_kid)] = tpl
                (self.state.get("remote_watchlist_items") or {}).pop(str(eff_kid), None)
                (self.state.get("remote_watching_items") or {}).pop(str(eff_kid), None)
            if item_id in self.state["watchlist"]:
                self.state["watchlist"].remove(item_id)
            rem_wl = self.state.setdefault("watchlist_removed", [])
            if item_id not in rem_wl:
                rem_wl.append(item_id)
            if eff_kid and f"kin_{eff_kid}" not in rem_wl:
                rem_wl.append(f"kin_{eff_kid}")
            if was_watching:
                self._sync_to_kinorium_remote(
                    action="watching_remove",
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    resolved_kid=eff_kid or None,
                )
            remote_ok = self._sync_to_kinorium_remote(
                action="watched",
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_kid or None,
            )
        else:
            unw_val = {
                "item_id": item_id,
                "title": title,
                "watched": False,
            }
            self.state["watched"][item_id] = unw_val
            if eff_kid:
                self.state["watched"][f"kin_{eff_kid}"] = unw_val
                (self.state.get("remote_watched_items") or {}).pop(str(eff_kid), None)
            remote_ok = self._sync_to_kinorium_remote(
                action="unwatched",
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_kid or None,
            )

        self._build_lookup_indices()
        self._save_state()
        status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        status["remote_synced"] = remote_ok
        status["kinorium_counts"] = self.get_sections_counts()
        return status

    def set_rating(
        self,
        item_id: str,
        title: str,
        score: int,
        comment: str = "",
        orig_title: str = "",
        is_series_completed: Optional[bool] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        raw_score = int(score or 0)
        now_str = time.strftime("%Y-%m-%d %H:%M")
        kid = self._resolve_kinorium_id(
            item_id,
            title,
            orig_title,
            allow_network=True,
            media_type=str(kwargs.get("media_type") or ""),
            year=int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None,
        )

        if raw_score <= 0:
            cleared_val = {"score": None, "comment": "", "cleared": True, "updated_at": now_str}
            self.state["ratings"][item_id] = cleared_val
            if kid:
                self.state["ratings"][f"kin_{kid}"] = cleared_val
                for sec_k in ("remote_watched_items", "remote_watching_items", "remote_watchlist_items"):
                    sec_d = self.state.get(sec_k) or {}
                    if str(kid) in sec_d:
                        sec_d[str(kid)]["score"] = None
            self._build_lookup_indices()
            self._save_state()
            remote_ok = self._sync_to_kinorium_remote(
                action="rate_remove",
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                resolved_kid=kid,
            )
            status = self.get_item_status(item_id, title=title, orig_title=orig_title)
            status["remote_synced"] = remote_ok
            status["kinorium_counts"] = self.get_sections_counts()
            return status

        score = max(1, min(10, raw_score))
        prev_status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        remote_item = self._resolve_remote_item(item_id, title, orig_title)
        meta_kw = kwargs.get("item_meta") if isinstance(kwargs.get("item_meta"), dict) else {}
        mtype = str(
            kwargs.get("media_type")
            or meta_kw.get("media_type")
            or (remote_item.get("media_type") if remote_item else "")
            or ""
        ).lower()
        completed_flag = (
            bool(is_series_completed)
            if isinstance(is_series_completed, bool)
            else bool(prev_status.get("is_completed") or prev_status.get("is_series_completed"))
        )
        keep_in_watching = bool(
            prev_status.get("watching")
            and mtype != "movie"
            and not completed_flag
        )

        r_val = {
            "score": score,
            "comment": comment.strip(),
            "updated_at": now_str,
        }
        self.state["ratings"][item_id] = r_val
        if kid:
            self.state["ratings"][f"kin_{kid}"] = r_val

        if not keep_in_watching:
            self.mark_watched(item_id=item_id, title=title, orig_title=orig_title, watched=True, **kwargs)

        if kid:
            for sec_k in ("remote_watched_items", "remote_watching_items", "remote_watchlist_items"):
                sec_d = self.state.get(sec_k) or {}
                if str(kid) in sec_d:
                    sec_d[str(kid)]["score"] = score
        self._build_lookup_indices()
        self._save_state()
        remote_ok = self._sync_to_kinorium_remote(
            action="rate",
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            score=score,
            comment=comment,
            resolved_kid=kid,
        )
        status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        status["remote_synced"] = remote_ok
        status["kinorium_counts"] = self.get_sections_counts()
        return status

    def set_episode_rating(
        self,
        item_id: str,
        title: str,
        season: int,
        episode: int,
        score: int,
        comment: str = "",
        orig_title: str = "",
        episode_title: str = "",
        total_seasons: int = 0,
        total_episodes_in_season: int = 0,
        is_series_completed: Optional[bool] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        raw_score = int(score or 0)
        s_num = max(1, int(season or 1))
        e_num = max(1, int(episode or 1))
        ep_key = f"s{s_num}e{e_num}"
        now_str = time.strftime("%Y-%m-%d %H:%M")
        kid = self._resolve_kinorium_id(
            item_id,
            title,
            orig_title,
            allow_network=True,
            media_type="series",
            year=int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None,
        )
        er_root = self.state.setdefault("episode_ratings", {})
        remote_synced = False

        if raw_score <= 0:
            for k_id in filter(None, [item_id, f"kin_{kid}" if (kid and str(kid).isdigit()) else ""]):
                item_map = er_root.get(k_id)
                if isinstance(item_map, dict):
                    item_map.pop(ep_key, None)
            if kid:
                ep_state = self.fetch_series_episodes_state(kid, item_id=item_id)
                ep_info = (ep_state.get("episodes") or {}).get((s_num, e_num))
                if ep_info and ep_info.get("ep_id"):
                    remote_synced = self._post_episode_status_remote(
                        kid=kid,
                        ep_id=str(ep_info["ep_id"]),
                        watched=True,
                        clear_rating_only=True,
                    )
                    if remote_synced:
                        ep_info["rating"] = None
            self._save_state()
            status = self.get_item_status(item_id, title=title, orig_title=orig_title)
            status["rated_episode"] = None
            status["auto_completed_series"] = False
            status["remote_synced"] = remote_synced
            status["kinorium_counts"] = self.get_sections_counts()
            return status

        score = max(1, min(10, raw_score))
        clean_comment = (comment or "").strip()
        entry = {
            "season": s_num,
            "episode": e_num,
            "score": score,
            "comment": clean_comment,
            "episode_title": (episode_title or "").strip(),
            "updated_at": now_str,
        }
        for k_id in filter(None, [item_id, f"kin_{kid}" if (kid and str(kid).isdigit()) else ""]):
            item_map = er_root.setdefault(k_id, {})
            item_map[ep_key] = entry
        self._record_episode_watched(item_id, title, orig_title, s_num, e_num, resolved_kid=kid)
        auto_completed_series = self._maybe_auto_complete_series(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            season=s_num,
            episode=e_num,
            total_seasons=total_seasons,
            total_episodes_in_season=total_episodes_in_season,
            is_series_completed=is_series_completed,
            **kwargs,
        )
        promoted_to_watching = False
        if not auto_completed_series:
            promoted_to_watching = self._promote_series_to_watching_if_needed(
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                kid=kid,
                **kwargs,
            )
        if kid:
            ep_state = self.fetch_series_episodes_state(kid, item_id=item_id)
            ep_info = (ep_state.get("episodes") or {}).get((s_num, e_num))
            if ep_info and ep_info.get("ep_id") and not ep_info.get("is_future"):
                remote_synced = self._post_episode_status_remote(
                    kid=kid,
                    ep_id=str(ep_info["ep_id"]),
                    watched=True,
                    score=score,
                    comment=clean_comment,
                )
                if remote_synced:
                    ep_info["watched"] = True
                    ep_info["rating"] = score
        self._save_state()
        status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        status["rated_episode"] = entry
        status["auto_completed_series"] = auto_completed_series
        status["promoted_to_watching"] = promoted_to_watching
        status["remote_synced"] = remote_synced
        status["kinorium_counts"] = self.get_sections_counts()
        return status

    def toggle_watchlist(self, item_id: str, title: str = "", orig_title: str = "", **kwargs) -> Dict[str, Any]:
        cur = self.get_item_status(item_id, title=title, orig_title=orig_title)
        kid = self._resolve_kinorium_id(
            item_id,
            title,
            orig_title,
            allow_network=True,
            media_type=str(kwargs.get("media_type") or ""),
            year=int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None,
        )
        eff_kid = str(kid) if (kid and str(kid).isdigit()) else ""
        rem_wl = self.state.setdefault("watchlist_removed", [])
        if cur.get("in_watchlist"):
            if item_id in self.state["watchlist"]:
                self.state["watchlist"].remove(item_id)
            if item_id not in rem_wl:
                rem_wl.append(item_id)
            if eff_kid:
                if f"kin_{eff_kid}" not in rem_wl:
                    rem_wl.append(f"kin_{eff_kid}")
                (self.state.get("remote_watchlist_items") or {}).pop(str(eff_kid), None)
            remote_ok = self._sync_to_kinorium_remote(
                action="watchlist_remove",
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_kid or None,
            )
        else:
            if item_id not in self.state["watchlist"]:
                self.state["watchlist"].append(item_id)
            if item_id in rem_wl:
                rem_wl.remove(item_id)
            if eff_kid:
                if f"kin_{eff_kid}" in rem_wl:
                    rem_wl.remove(f"kin_{eff_kid}")
                tpl = self._ensure_remote_entry_template(eff_kid, title, orig_title, extra=kwargs)
                tpl["in_watchlist"] = True
                tpl["status"] = "future"
                self.state.setdefault("remote_watchlist_items", {})[str(eff_kid)] = tpl
            remote_ok = self._sync_to_kinorium_remote(
                action="watchlist_add",
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_kid or None,
            )
        self._build_lookup_indices()
        self._save_state()
        status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        status["remote_synced"] = remote_ok
        status["kinorium_counts"] = self.get_sections_counts()
        return status

    def toggle_watching(self, item_id: str, title: str = "", orig_title: str = "", **kwargs) -> Dict[str, Any]:
        cur = self.get_item_status(item_id, title=title, orig_title=orig_title)
        was_in_watchlist = bool(cur.get("in_watchlist"))
        kid = self._resolve_kinorium_id(
            item_id,
            title,
            orig_title,
            allow_network=True,
            media_type=str(kwargs.get("media_type") or ""),
            year=int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None,
        )
        eff_kid = str(kid) if (kid and str(kid).isdigit()) else ""
        loc_w = self.state.setdefault("watching_local", [])
        rem_w = self.state.setdefault("watching_removed", [])
        rem_wl = self.state.setdefault("watchlist_removed", [])
        if cur.get("watching"):
            if item_id in loc_w:
                loc_w.remove(item_id)
            if eff_kid and f"kin_{eff_kid}" in loc_w:
                loc_w.remove(f"kin_{eff_kid}")
            if item_id not in rem_w:
                rem_w.append(item_id)
            if eff_kid:
                if f"kin_{eff_kid}" not in rem_w:
                    rem_w.append(f"kin_{eff_kid}")
                (self.state.get("remote_watching_items") or {}).pop(str(eff_kid), None)
            remote_ok = self._sync_to_kinorium_remote(
                action="watching_remove",
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_kid or None,
            )
        else:
            if item_id not in loc_w:
                loc_w.append(item_id)
            if eff_kid and f"kin_{eff_kid}" not in loc_w:
                loc_w.append(f"kin_{eff_kid}")
            if item_id in rem_w:
                rem_w.remove(item_id)
            if item_id in self.state["watchlist"]:
                self.state["watchlist"].remove(item_id)
            if was_in_watchlist and item_id not in rem_wl:
                rem_wl.append(item_id)
            if eff_kid:
                if f"kin_{eff_kid}" in rem_w:
                    rem_w.remove(f"kin_{eff_kid}")
                if was_in_watchlist and f"kin_{eff_kid}" not in rem_wl:
                    rem_wl.append(f"kin_{eff_kid}")
                (self.state.get("remote_watchlist_items") or {}).pop(str(eff_kid), None)
                tpl = self._ensure_remote_entry_template(eff_kid, title, orig_title, extra=kwargs)
                tpl["watching"] = True
                tpl["in_watchlist"] = False
                tpl["status"] = "now"
                self.state.setdefault("remote_watching_items", {})[str(eff_kid)] = tpl
            if was_in_watchlist:
                self._sync_to_kinorium_remote(
                    action="watchlist_remove",
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    resolved_kid=eff_kid or None,
                )
            remote_ok = self._sync_to_kinorium_remote(
                action="watching_add",
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_kid or None,
            )
        self._build_lookup_indices()
        self._save_state()
        status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        status["remote_synced"] = remote_ok
        status["kinorium_counts"] = self.get_sections_counts()
        return status

    def toggle_not_watching(self, item_id: str, title: str = "", orig_title: str = "", **kwargs) -> Dict[str, Any]:
        cur = self.get_item_status(item_id, title=title, orig_title=orig_title)
        kid = self._resolve_kinorium_id(
            item_id,
            title,
            orig_title,
            allow_network=True,
            media_type=str(kwargs.get("media_type") or ""),
            year=int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None,
        )
        eff_kid = str(kid) if (kid and str(kid).isdigit()) else ""
        loc_n = self.state.setdefault("never_local", [])
        rem_n = self.state.setdefault("never_removed", [])
        if cur.get("not_watching"):
            if item_id in loc_n:
                loc_n.remove(item_id)
            if item_id not in rem_n:
                rem_n.append(item_id)
            if eff_kid:
                if f"kin_{eff_kid}" not in rem_n:
                    rem_n.append(f"kin_{eff_kid}")
                (self.state.get("remote_never_items") or {}).pop(str(eff_kid), None)
            remote_ok = self._sync_to_kinorium_remote(
                action="never_remove",
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_kid or None,
            )
        else:
            if item_id not in loc_n:
                loc_n.append(item_id)
            if item_id in rem_n:
                rem_n.remove(item_id)
            if eff_kid:
                if f"kin_{eff_kid}" in rem_n:
                    rem_n.remove(f"kin_{eff_kid}")
                tpl = self._ensure_remote_entry_template(eff_kid, title, orig_title, extra=kwargs)
                tpl["not_watching"] = True
                tpl["status"] = "never"
                self.state.setdefault("remote_never_items", {})[str(eff_kid)] = tpl
            remote_ok = self._sync_to_kinorium_remote(
                action="never_add",
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_kid or None,
            )
        self._build_lookup_indices()
        self._save_state()
        status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        status["remote_synced"] = remote_ok
        status["kinorium_counts"] = self.get_sections_counts()
        return status

    def configure_account(self, username: str, session_cookie: str, threshold: float = 0.85) -> Dict[str, Any]:
        raw_user = (username or "").strip()
        cookie_updated = False
        if session_cookie is not None and session_cookie.strip():
            cleaned_cookie = self.sanitize_session_cookie(session_cookie)
            if cleaned_cookie:
                self.state["account"]["session_cookie"] = cleaned_cookie
                self._kinorium_cookie_cache = ""
                self._session_auth_verified = None
                cookie_updated = True
        self.state["account"]["auto_scrobble_threshold"] = max(0.5, min(0.99, float(threshold)))
        if raw_user:
            new_path = self.extract_user_path(raw_user)
            cur_uid = str(self.state.get("account", {}).get("user_id") or "")
            if not cur_uid or new_path != f"/user/{cur_uid}/":
                self.sync_user_profile(raw_user)
            else:
                self._save_state()
                if cookie_updated:
                    threading.Thread(target=self.reconcile_all_local_episodes, daemon=True).start()
        else:
            self._save_state()
            if cookie_updated:
                threading.Thread(target=self.reconcile_all_local_episodes, daemon=True).start()
        return self.state["account"]

    def _promote_series_to_watching_if_needed(
        self,
        item_id: str,
        title: str = "",
        orig_title: str = "",
        kid: Optional[str] = None,
        **extra,
    ) -> bool:
        """
        Automatically promotes an unfinished series to 'Смотрю' (`watching=True`, `isNow=1`)
        when the user watches, batch-marks, or rates episodes while the series is still in
        'Буду смотреть' (`future`) or has no status yet.
        """
        cur = self.get_item_status(item_id, title=title, orig_title=orig_title)
        if cur.get("watching") or cur.get("watched") or cur.get("not_watching"):
            return False
        was_in_watchlist = bool(cur.get("in_watchlist"))
        eff_kid = str(kid) if (kid and str(kid).isdigit()) else ""
        if not eff_kid:
            resolved = self._resolve_kinorium_id(
                item_id,
                title,
                orig_title,
                allow_network=True,
                media_type="series",
            )
            eff_kid = str(resolved) if (resolved and str(resolved).isdigit()) else ""

        loc_w = self.state.setdefault("watching_local", [])
        rem_w = self.state.setdefault("watching_removed", [])
        rem_wl = self.state.setdefault("watchlist_removed", [])
        if item_id and item_id not in loc_w:
            loc_w.append(item_id)
        if item_id in rem_w:
            rem_w.remove(item_id)
        if item_id in self.state["watchlist"]:
            self.state["watchlist"].remove(item_id)
        if was_in_watchlist and item_id and item_id not in rem_wl:
            rem_wl.append(item_id)

        if eff_kid:
            k_pref = f"kin_{eff_kid}"
            if k_pref not in loc_w:
                loc_w.append(k_pref)
            if k_pref in rem_w:
                rem_w.remove(k_pref)
            if was_in_watchlist and k_pref not in rem_wl:
                rem_wl.append(k_pref)
            (self.state.get("remote_watchlist_items") or {}).pop(eff_kid, None)
            extra_kw = dict(extra)
            extra_kw.setdefault("media_type", "series")
            tpl = self._ensure_remote_entry_template(eff_kid, title, orig_title, extra=extra_kw)
            tpl["watching"] = True
            tpl["watched"] = False
            tpl["in_watchlist"] = False
            tpl["status"] = "now"
            self.state.setdefault("remote_watching_items", {})[eff_kid] = tpl

        self._build_lookup_indices()
        if eff_kid:
            if was_in_watchlist:
                self._sync_to_kinorium_remote(
                    action="watchlist_remove",
                    item_id=item_id or f"kin_{eff_kid}",
                    title=title,
                    orig_title=orig_title,
                    resolved_kid=eff_kid,
                )
            self._sync_to_kinorium_remote(
                action="watching_add",
                item_id=item_id or f"kin_{eff_kid}",
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_kid,
            )
        return True

    @staticmethod
    def parse_series_episodes_html(ep_html: str) -> Dict[str, Any]:
        episodes: Dict[Tuple[int, int], Dict[str, Any]] = {}
        season_buttons: Dict[int, Dict[str, Any]] = {}
        if not ep_html:
            return {"episodes": episodes, "season_buttons": season_buttons}

        for btn_m in re.finditer(r"<button\b([^>]*\bid=['\"]seasonButton(\d+)['\"][^>]*)>", ep_html, re.I):
            attrs = btn_m.group(1)
            s_num = int(btn_m.group(2))
            season_buttons[s_num] = {
                "disabled": bool(re.search(r"\bdisabled\b", attrs, re.I)),
                "active": bool(re.search(r"\bactive\b", attrs, re.I)),
            }

        for li_m in re.finditer(
            r"<li\s+class=['\"]([^'\"]*seasonItem__episodes-item[^'\"]*)['\"][^>]*>(.*?)</li>",
            ep_html,
            re.S,
        ):
            li_cls = li_m.group(1)
            blk = li_m.group(2)
            m_ep_id = re.search(r"data-movieId\s*=\s*['\"](\d+)['\"]", blk, re.I)
            if not m_ep_id:
                continue
            ep_id = m_ep_id.group(1)
            m_se = re.search(r"(\d+)\s*с:\s*(\d+)\s*э", blk) or re.search(
                r"/episodes/s(\d+)e(\d+)/",
                blk,
                re.I,
            )
            if not m_se:
                continue
            s_num = int(m_se.group(1))
            e_num = int(m_se.group(2))
            if s_num <= 0 or e_num <= 0:
                continue

            m_widget = re.search(r"<div[^>]*statusWidgetData[^>]*>", blk, re.S)
            widget_tag = m_widget.group(0) if m_widget else blk[:500]
            m_st = re.search(r"data-status\s*=\s*['\"]([^'\"]*)['\"]", widget_tag, re.I)
            st_val = (m_st.group(1).strip().lower() if m_st else "")
            watched = bool(
                st_val == "done"
                or re.search(r"class\s*=\s*['\"][^'\"]*\bdone\b", widget_tag, re.I)
            )
            m_rt = re.search(r"data-rating\s*=\s*['\"](\d+)['\"]", widget_tag, re.I)
            rating_val: Optional[int] = None
            if m_rt:
                r_int = int(m_rt.group(1))
                if 1 <= r_int <= 10:
                    rating_val = r_int

            is_future = bool(
                "futureEpisode" in li_cls
                or re.search(r"\bdisabled\b", widget_tag, re.I)
                or re.search(r"data-future\s*=\s*['\"]1['\"]", widget_tag, re.I)
            )
            m_nm = re.search(r"data-movieName\s*=\s*['\"]([^'\"]+)['\"]", widget_tag)
            ru_name = html.unescape(m_nm.group(1)).strip() if m_nm else ""
            m_orig = re.search(r"<h3>\s*([^<\n]+)", blk)
            orig_name = html.unescape(m_orig.group(1)).strip() if m_orig else ""

            episodes[(s_num, e_num)] = {
                "ep_id": ep_id,
                "season": s_num,
                "episode": e_num,
                "watched": watched,
                "rating": rating_val,
                "is_future": is_future,
                "ru_title": ru_name,
                "orig_title": orig_name,
            }

        return {"episodes": episodes, "season_buttons": season_buttons}

    def _is_episode_cached_remote_done(self, kid: str, season: int, episode: int) -> bool:
        if not kid or not str(kid).isdigit():
            return False
        cached = self._series_episodes_cache.get(str(kid))
        if not cached:
            return False
        ep_info = (cached.get("episodes") or {}).get((int(season), int(episode)))
        return bool(ep_info and ep_info.get("watched"))

    def _merge_remote_episodes_into_local(
        self,
        kid: str,
        episodes_map: Dict[Tuple[int, int], Dict[str, Any]],
        item_id: str = "",
    ) -> bool:
        if not kid or not str(kid).isdigit() or not episodes_map:
            return False
        changed = False
        we_root = self.state.setdefault("watched_episodes", {})
        er_root = self.state.setdefault("episode_ratings", {})
        target_keys = [k for k in (f"kin_{kid}", item_id if (item_id and item_id != f"kin_{kid}") else "") if k]
        now_str = time.strftime("%Y-%m-%d %H:%M")

        for (s_num, e_num), ep_info in episodes_map.items():
            s_key = str(s_num)
            ep_key = f"s{s_num}e{e_num}"
            if ep_info.get("watched") or ep_info.get("rating"):
                for k_id in target_keys:
                    s_map = we_root.setdefault(k_id, {})
                    cur_list = s_map.get(s_key) or []
                    if e_num not in cur_list:
                        cur_list.append(e_num)
                        s_map[s_key] = sorted(set(cur_list))
                        changed = True
            r_val = ep_info.get("rating")
            if r_val and 1 <= int(r_val) <= 10:
                for k_id in target_keys:
                    r_map = er_root.setdefault(k_id, {})
                    existing_r = r_map.get(ep_key)
                    if not isinstance(existing_r, dict) or existing_r.get("score") != int(r_val):
                        r_map[ep_key] = {
                            "season": s_num,
                            "episode": e_num,
                            "score": int(r_val),
                            "comment": str(existing_r.get("comment") or "") if isinstance(existing_r, dict) else "",
                            "episode_title": str(
                                (existing_r.get("episode_title") if isinstance(existing_r, dict) else "")
                                or ep_info.get("ru_title")
                                or ""
                            ),
                            "updated_at": now_str,
                        }
                        changed = True
        return changed

    def fetch_series_episodes_state(
        self,
        kid: str,
        item_id: str = "",
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        kid_str = str(kid or "").strip()
        if not kid_str.isdigit():
            return {"episodes": {}, "season_buttons": {}, "is_authed": False}

        now_ts = time.time()
        with self._episodes_lock:
            cached = self._series_episodes_cache.get(kid_str)
            if cached and not force_refresh and (now_ts - float(cached.get("ts") or 0.0)) < 600.0:
                if cached.get("is_authed") and item_id:
                    if self._merge_remote_episodes_into_local(kid_str, cached.get("episodes") or {}, item_id=item_id):
                        self._save_state(immediate=False, bump_version=True)
                return cached

        try:
            ep_html = self.fetch_kinorium_html(f"https://ru.kinorium.com/{kid_str}/episodes/")
            uid = str(self.state.get("account", {}).get("user_id") or "").strip()
            is_authed = bool(
                uid
                and (
                    f"USER_ID = '{uid}'" in ep_html
                    or f'USER_ID = "{uid}"' in ep_html
                )
            )
            if (self.state.get("account", {}).get("session_cookie") or "").strip():
                self._session_auth_verified = is_authed
            parsed = self.parse_series_episodes_html(ep_html)
            if not parsed["episodes"] and cached and cached.get("episodes"):
                return cached
            state_obj: Dict[str, Any] = {
                "ts": now_ts,
                "is_authed": is_authed,
                "episodes": parsed["episodes"],
                "season_buttons": parsed["season_buttons"],
            }
            if parsed["episodes"]:
                with self._episodes_lock:
                    self._series_episodes_cache[kid_str] = state_obj
            if is_authed and parsed["episodes"]:
                if self._merge_remote_episodes_into_local(kid_str, parsed["episodes"], item_id=item_id):
                    self._save_state(immediate=False, bump_version=True)
            return state_obj
        except Exception:
            if cached and cached.get("episodes"):
                return cached
            return {"episodes": {}, "season_buttons": {}, "is_authed": False}

    def _post_episode_status_remote(
        self,
        kid: str,
        ep_id: str,
        watched: bool = True,
        score: Optional[int] = None,
        comment: str = "",
        clear_rating_only: bool = False,
    ) -> bool:
        user_cookie = self.state["account"].get("session_cookie", "").strip()
        if not user_cookie or not str(kid).isdigit() or not str(ep_id).isdigit():
            return False
        try:
            full_cookie = self._ensure_kinorium_cookies(extra_cookie=user_cookie)
            headers = {
                "User-Agent": self.UA,
                "Cookie": full_cookie,
                "X-Requested-With": "XMLHttpRequest",
                "Origin": "https://ru.kinorium.com",
                "Referer": f"https://ru.kinorium.com/{kid}/episodes/",
            }
            group_key = str(int(time.time() * 1000))
            if clear_rating_only or not watched:
                del_type = "rating" if clear_rating_only else "status"
                qs = urllib.parse.urlencode(
                    {
                        "movie_id": str(ep_id),
                        "episode_of": str(kid),
                        "del_type": del_type,
                        "group_key": group_key,
                    }
                )
                req = urllib.request.Request(
                    f"https://ru.kinorium.com/handlers/delStatus/?{qs}",
                    headers=headers,
                    method="GET",
                )
                raw = urllib.request.urlopen(req, timeout=8).read().decode("utf-8", errors="ignore").strip()
                if not raw.startswith("{"):
                    return False
                resp_json = json.loads(raw)
                return bool(isinstance(resp_json, dict) and not resp_json.get("error") and "result" in resp_json)

            form: Dict[str, Any] = {
                "group_key": group_key,
                "status": "done",
                "rating": str(int(score)) if (score is not None and 1 <= int(score) <= 10) else "",
                "isNow": "",
                "isEdit": "",
                "logId": "",
                "comment": comment or "",
                "movie_id": str(ep_id),
                "episode_of": str(kid),
                "share": "",
            }
            payload = urllib.parse.urlencode(form).encode("utf-8")
            req = urllib.request.Request(
                "https://ru.kinorium.com/handlers/setStatus/",
                data=payload,
                headers=headers,
                method="POST",
            )
            raw = urllib.request.urlopen(req, timeout=8).read().decode("utf-8", errors="ignore").strip()
            if not raw.startswith("{"):
                return False
            resp_json = json.loads(raw)
            return bool(isinstance(resp_json, dict) and not resp_json.get("error") and "result" in resp_json)
        except Exception:
            return False

    def _sync_episodes_map_to_kinorium_remote(
        self,
        kid: str,
        item_id: str,
        target_by_season: Dict[int, List[int]],
        mark_season_complete: bool = False,
    ) -> Tuple[bool, int]:
        user_cookie = self.state["account"].get("session_cookie", "").strip()
        if not user_cookie or not str(kid).isdigit() or not target_by_season:
            return False, 0

        ep_state = self.fetch_series_episodes_state(kid, item_id=item_id)
        if not ep_state.get("is_authed"):
            return False, 0
        ep_map: Dict[Tuple[int, int], Dict[str, Any]] = ep_state.get("episodes") or {}
        if not ep_map:
            return False, 0

        to_mark: List[Dict[str, Any]] = []
        already_done_count = 0
        for s_num, e_list in target_by_season.items():
            for e_num in sorted(set(int(x) for x in e_list if int(x) > 0)):
                ep_info = ep_map.get((int(s_num), int(e_num)))
                if not ep_info or ep_info.get("is_future"):
                    continue
                if ep_info.get("watched"):
                    already_done_count += 1
                else:
                    to_mark.append(ep_info)

        if not to_mark:
            return (already_done_count > 0 or bool(ep_state.get("is_authed"))), 0

        # Fast-path whole-season check when Kinorium's season button is enabled (all episodes released)
        if mark_season_complete and len(target_by_season) == 1 and len(to_mark) >= 3:
            only_s = next(iter(target_by_season.keys()))
            s_btn = (ep_state.get("season_buttons") or {}).get(int(only_s)) or {}
            season_released_eps = [
                info for (sn, _), info in ep_map.items() if sn == int(only_s) and not info.get("is_future")
            ]
            target_set = set(target_by_season[only_s])
            if (
                s_btn
                and not s_btn.get("disabled")
                and season_released_eps
                and all(info["episode"] in target_set for info in season_released_eps)
            ):
                try:
                    full_cookie = self._ensure_kinorium_cookies(extra_cookie=user_cookie)
                    qs = urllib.parse.urlencode(
                        {"movie_id": str(kid), "season": str(only_s), "checked": "1"}
                    )
                    req = urllib.request.Request(
                        f"https://ru.kinorium.com/handlers/checkEpisode/?{qs}",
                        headers={
                            "User-Agent": self.UA,
                            "Cookie": full_cookie,
                            "X-Requested-With": "XMLHttpRequest",
                            "Referer": f"https://ru.kinorium.com/{kid}/episodes/",
                        },
                        method="GET",
                    )
                    raw = urllib.request.urlopen(req, timeout=8).read().decode("utf-8", errors="ignore").strip()
                    if raw.startswith("{"):
                        rj = json.loads(raw)
                        if isinstance(rj, dict) and not rj.get("error") and "result" in rj:
                            for info in season_released_eps:
                                info["watched"] = True
                            return True, len(to_mark)
                except Exception:
                    pass

        er_root = self.state.get("episode_ratings") or {}
        er_for_item: Dict[str, Any] = {}
        for k_lookup in filter(None, [f"kin_{kid}", item_id]):
            if isinstance(er_root.get(k_lookup), dict):
                er_for_item.update(er_root[k_lookup])

        def _mark_one(info: Dict[str, Any]) -> bool:
            ep_k = f"s{info['season']}e{info['episode']}"
            loc_r = er_for_item.get(ep_k) if isinstance(er_for_item.get(ep_k), dict) else None
            sc_val = int(loc_r["score"]) if (loc_r and str(loc_r.get("score") or "").isdigit()) else None
            cm_val = str(loc_r.get("comment") or "") if loc_r else ""
            ok = self._post_episode_status_remote(
                kid=str(kid),
                ep_id=str(info["ep_id"]),
                watched=True,
                score=sc_val,
                comment=cm_val,
            )
            if ok:
                info["watched"] = True
                if sc_val:
                    info["rating"] = sc_val
            return ok

        if len(to_mark) == 1:
            ok_single = _mark_one(to_mark[0])
            return ok_single, (1 if ok_single else 0)

        with ThreadPoolExecutor(max_workers=min(4, len(to_mark))) as pool:
            results = list(pool.map(_mark_one, to_mark))
        synced_cnt = sum(1 for r in results if r)
        return synced_cnt > 0, synced_cnt

    def reconcile_series_episodes(
        self,
        item_id: str = "",
        title: str = "",
        orig_title: str = "",
        kid: Optional[str] = None,
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        """
        Two-way synchronization of watched episodes & episode ratings for a single series:
        1. Pulls all watched/rated episodes from `ru.kinorium.com/{kid}/episodes/` into CineFlow.
        2. Pushes any locally watched/rated episodes from CineFlow to `kinorium.com`.
        3. Automatically promotes the series from 'Буду смотреть' (`future`) to 'Смотрю' (`now`)
           if episodes have been watched in CineFlow while the series is still incomplete.
        """
        eff_kid = str(kid) if (kid and str(kid).isdigit()) else ""
        if not eff_kid:
            resolved = self._resolve_kinorium_id(
                item_id,
                title,
                orig_title,
                allow_network=True,
                media_type="series",
            )
            eff_kid = str(resolved) if (resolved and str(resolved).isdigit()) else ""
        eff_item_id = item_id or (f"kin_{eff_kid}" if eff_kid else "")
        if not eff_kid:
            return self.get_item_status(eff_item_id, title=title, orig_title=orig_title)

        ep_state = self.fetch_series_episodes_state(eff_kid, item_id=eff_item_id, force_refresh=force_refresh)
        ep_map: Dict[Tuple[int, int], Dict[str, Any]] = ep_state.get("episodes") or {}

        we_root = self.state.setdefault("watched_episodes", {})
        local_by_season: Dict[int, List[int]] = {}
        for k_lookup in filter(None, [eff_item_id, f"kin_{eff_kid}"]):
            sub_map = we_root.get(k_lookup)
            if isinstance(sub_map, dict):
                for s_k, ep_list in sub_map.items():
                    if str(s_k).isdigit() and isinstance(ep_list, list):
                        s_int = int(s_k)
                        merged = sorted(
                            set(local_by_season.get(s_int, []) + [int(x) for x in ep_list if str(x).isdigit() and int(x) > 0])
                        )
                        if merged:
                            local_by_season[s_int] = merged

        state_changed = False
        if local_by_season:
            # Ensure canonical 'kin_{eff_kid}' key also holds all merged episodes
            kin_map = we_root.setdefault(f"kin_{eff_kid}", {})
            for s_int, ep_list in local_by_season.items():
                prev_l = kin_map.get(str(s_int)) or []
                merged_l = sorted(set(prev_l + ep_list))
                if merged_l != prev_l:
                    kin_map[str(s_int)] = merged_l
                    state_changed = True

            if ep_state.get("is_authed"):
                cur_st = self.get_item_status(eff_item_id, title=title, orig_title=orig_title)
                if not cur_st.get("watching") and not cur_st.get("watched") and not cur_st.get("not_watching"):
                    rem_entry = self._by_kid.get(eff_kid) or {}
                    eff_title = title or str(rem_entry.get("ru_title") or "")
                    eff_orig = orig_title or str(rem_entry.get("orig_title") or "")
                    if self._promote_series_to_watching_if_needed(
                        item_id=eff_item_id,
                        title=eff_title,
                        orig_title=eff_orig,
                        kid=eff_kid,
                    ):
                        state_changed = True

                _, pushed_cnt = self._sync_episodes_map_to_kinorium_remote(
                    kid=eff_kid,
                    item_id=eff_item_id,
                    target_by_season=local_by_season,
                )
                if pushed_cnt > 0:
                    state_changed = True

        # Also push any local episode ratings not yet reflected on Kinorium
        if ep_state.get("is_authed") and ep_map:
            er_root = self.state.get("episode_ratings") or {}
            merged_er: Dict[str, Dict[str, Any]] = {}
            for k_lookup in filter(None, [f"kin_{eff_kid}", eff_item_id]):
                if isinstance(er_root.get(k_lookup), dict):
                    merged_er.update(er_root[k_lookup])
            for ep_val in merged_er.values():
                if not isinstance(ep_val, dict):
                    continue
                sn = int(ep_val.get("season") or 0)
                en = int(ep_val.get("episode") or 0)
                sc = int(ep_val.get("score") or 0)
                ep_info = ep_map.get((sn, en))
                if ep_info and not ep_info.get("is_future") and 1 <= sc <= 10 and ep_info.get("rating") != sc:
                    if self._post_episode_status_remote(
                        kid=eff_kid,
                        ep_id=str(ep_info["ep_id"]),
                        watched=True,
                        score=sc,
                        comment=str(ep_val.get("comment") or ""),
                    ):
                        ep_info["watched"] = True
                        ep_info["rating"] = sc
                        state_changed = True

        if state_changed:
            self._save_state()
        return self.get_item_status(eff_item_id, title=title, orig_title=orig_title)

    def reconcile_all_local_episodes(self, pull_watching_limit: int = 8) -> Dict[str, Any]:
        """
        Reconciles all locally recorded series episodes & active 'Смотрю' / 'Продолжить просмотр'
        series bidirectionally with Kinorium.
        """
        user_cookie = (self.state.get("account", {}).get("session_cookie") or "").strip()
        if not user_cookie:
            return {"ok": False, "reason": "no_session_cookie", "reconciled": 0}

        cw_meta_by_id: Dict[str, Dict[str, str]] = {}
        for cw in self.state.get("continue_watching") or []:
            cid = str(cw.get("id") or "").strip()
            if cid:
                cw_meta_by_id[cid] = {
                    "title": str(cw.get("title") or ""),
                    "orig_title": str(cw.get("orig_title") or ""),
                    "media_type": str(cw.get("media_type") or ""),
                }

        tasks: List[Tuple[str, str, str, Optional[str]]] = []
        seen_targets: set = set()

        # 1. All series with local watched_episodes or episode_ratings (push + pull)
        local_keys = set((self.state.get("watched_episodes") or {}).keys()) | set(
            (self.state.get("episode_ratings") or {}).keys()
        )
        for raw_k in local_keys:
            k_str = str(raw_k).strip()
            if not k_str:
                continue
            kid_cand = k_str[4:] if (k_str.startswith("kin_") and k_str[4:].isdigit()) else None
            t_ru = ""
            t_orig = ""
            if kid_cand and kid_cand in self._by_kid:
                t_ru = str(self._by_kid[kid_cand].get("ru_title") or "")
                t_orig = str(self._by_kid[kid_cand].get("orig_title") or "")
            if k_str in cw_meta_by_id:
                t_ru = t_ru or cw_meta_by_id[k_str]["title"]
                t_orig = t_orig or cw_meta_by_id[k_str]["orig_title"]
            lm = self._live_meta_by_id.get(k_str)
            if lm:
                t_ru = t_ru or str(lm.get("title") or "")
                t_orig = t_orig or str(lm.get("orig_title") or "")
                if not kid_cand and str(lm.get("kinorium_id") or "").isdigit():
                    kid_cand = str(lm["kinorium_id"])
            if not kid_cand and not t_ru and not t_orig:
                continue
            dedup = kid_cand or k_str
            if dedup in seen_targets:
                continue
            seen_targets.add(dedup)
            tasks.append((k_str, t_ru, t_orig, kid_cand))

        # 2. Active series in Continue Watching & 'Смотрю' (pull remote Kinorium checkmarks into CineFlow)
        pulled_extra = 0
        for cw in self.state.get("continue_watching") or []:
            if pulled_extra >= pull_watching_limit:
                break
            if cw.get("media_type") != "series":
                continue
            cid = str(cw.get("id") or "")
            kid_c = cid[4:] if (cid.startswith("kin_") and cid[4:].isdigit()) else None
            dedup = kid_c or cid
            if dedup and dedup not in seen_targets:
                seen_targets.add(dedup)
                tasks.append((cid, str(cw.get("title") or ""), str(cw.get("orig_title") or ""), kid_c))
                pulled_extra += 1

        for kid_w, w_entry in (self.state.get("remote_watching_items") or {}).items():
            if pulled_extra >= pull_watching_limit:
                break
            if w_entry.get("media_type") != "series":
                continue
            kid_s = str(kid_w)
            if kid_s.isdigit() and kid_s not in seen_targets:
                seen_targets.add(kid_s)
                tasks.append(
                    (
                        f"kin_{kid_s}",
                        str(w_entry.get("ru_title") or ""),
                        str(w_entry.get("orig_title") or ""),
                        kid_s,
                    )
                )
                pulled_extra += 1

        def _run_one(t_args: Tuple[str, str, str, Optional[str]]) -> bool:
            try:
                self.reconcile_series_episodes(
                    item_id=t_args[0],
                    title=t_args[1],
                    orig_title=t_args[2],
                    kid=t_args[3],
                )
                time.sleep(0.2)
                return True
            except Exception:
                return False

        reconciled_cnt = 0
        if tasks:
            with ThreadPoolExecutor(max_workers=min(2, len(tasks))) as pool:
                reconciled_cnt = sum(1 for ok in pool.map(_run_one, tasks) if ok)
            self._save_state()
        return {
            "ok": True,
            "reconciled": reconciled_cnt,
            "session_authenticated": self._session_auth_verified,
        }

    def _sync_to_kinorium_remote(
        self,
        action: str,
        item_id: str,
        title: str = "",
        orig_title: str = "",
        score: Optional[int] = None,
        comment: str = "",
        resolved_kid: Optional[str] = None,
    ) -> bool:
        user_cookie = self.state["account"].get("session_cookie", "").strip()
        if not user_cookie:
            return False
        kid = (
            str(resolved_kid)
            if (resolved_kid and str(resolved_kid).isdigit())
            else self._resolve_kinorium_id(item_id, title, orig_title, allow_network=True)
        )
        if not kid or not str(kid).isdigit():
            return False
        try:
            full_cookie = self._ensure_kinorium_cookies(extra_cookie=user_cookie)
            headers = {
                "User-Agent": self.UA,
                "Cookie": full_cookie,
                "X-Requested-With": "XMLHttpRequest",
                "Origin": "https://ru.kinorium.com",
                "Referer": f"https://ru.kinorium.com/{kid}/",
            }
            group_key = str(int(time.time() * 1000))
            if action in ("watched", "rate", "watchlist_add", "watching_add", "never_add"):
                if action == "watching_add":
                    form: Dict[str, Any] = {
                        "movie_id": kid,
                        "group_key": group_key,
                        "status": "",
                        "isNow": "1",
                    }
                else:
                    status_map = {
                        "watched": "done",
                        "rate": "done",
                        "watchlist_add": "future",
                        "never_add": "never",
                    }
                    form = {
                        "movie_id": kid,
                        "group_key": group_key,
                        "status": status_map[action],
                        "isNow": "",
                    }
                if score is not None:
                    form["rating"] = str(score)
                if comment:
                    form["comment"] = comment
                payload = urllib.parse.urlencode(form).encode("utf-8")
                req = urllib.request.Request(
                    "https://ru.kinorium.com/handlers/setStatus/",
                    data=payload,
                    headers=headers,
                    method="POST",
                )
                raw = urllib.request.urlopen(req, timeout=6).read().decode("utf-8", errors="ignore").strip()
                if not raw.startswith("{"):
                    return False
                resp_json = json.loads(raw)
                if isinstance(resp_json, dict) and (resp_json.get("error") or "result" not in resp_json):
                    return False
                return True
            elif action in ("unwatched", "watchlist_remove", "watching_remove", "never_remove", "rate_remove"):
                if action == "watching_remove":
                    del_type = "now"
                elif action == "rate_remove":
                    del_type = "rating"
                else:
                    del_type = "status"
                qs = urllib.parse.urlencode(
                    {
                        "movie_id": kid,
                        "del_type": del_type,
                        "group_key": group_key,
                    }
                )
                req = urllib.request.Request(
                    f"https://ru.kinorium.com/handlers/delStatus/?{qs}",
                    headers=headers,
                    method="GET",
                )
                raw = urllib.request.urlopen(req, timeout=6).read().decode("utf-8", errors="ignore").strip()
                if not raw.startswith("{"):
                    return False
                resp_json = json.loads(raw)
                if isinstance(resp_json, dict) and (resp_json.get("error") or "result" not in resp_json):
                    return False
                return True
        except Exception:
            pass
        return False
