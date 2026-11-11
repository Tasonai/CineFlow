import concurrent.futures
import copy
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import http.client
import io
import ipaddress
import json
import os
import re
import socket
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from .backup_stream import _PUBLIC_TRACKERS_SUFFIX, _enrich_magnet_trackers
from .kinorium import _norm_title
from .storage_db import get_storage_db

_SHARED_SSL_CTX = ssl.create_default_context()

_CTRL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")
_WHITESPACE_RE = re.compile(r"\s")
_IMDB_ID_RE = re.compile(r"^tt\d{5,10}$")
_RUS_TOKEN_RE = re.compile(r"(?<![a-z0-9])(?:rus|russian|ru)(?![a-z0-9])", re.IGNORECASE)
_DUB_TOKEN_RE = re.compile(r"(?<![a-z0-9])(?:dub|dubbed)(?![a-z0-9])", re.IGNORECASE)
_DV_TOKEN_RE = re.compile(r"(?<![a-z0-9])(?:dv|dovi|dolby\s*vision)(?![a-z0-9])", re.IGNORECASE)
_YEAR_EXTRACT_RE = re.compile(r"((?:19|20)\d{2})")


def _safe_stremio_int(val: Any, default: int = 0) -> int:
    if isinstance(val, bool) or val is None:
        return default
    if isinstance(val, int):
        return val
    try:
        return int(str(val).strip())
    except (TypeError, ValueError):
        return default

_EMOJI_STRIP_RE = re.compile(
    "["
    "\U0001F1E0-\U0001F1FF"
    "\U0001F300-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0000FE00-\U0000FE0F"
    "\U0000200D"
    "]+",
    flags=re.UNICODE,
)

_FLAG_LANG_MAP = {
    "\U0001F1F7\U0001F1FA": "RU",
    "\U0001F1EC\U0001F1E7": "EN",
    "\U0001F1FA\U0001F1F8": "EN",
    "\U0001F1FA\U0001F1E6": "UA",
    "\U0001F1F5\U0001F1F1": "PL",
    "\U0001F1E9\U0001F1EA": "DE",
    "\U0001F1EB\U0001F1F7": "FR",
    "\U0001F1EA\U0001F1F8": "ES",
    "\U0001F1EE\U0001F1F9": "IT",
    "\U0001F1EF\U0001F1F5": "JA",
    "\U0001F1F0\U0001F1F7": "KO",
}

_SUB_LANG_LABELS = {
    "rus": "Русский",
    "ru": "Русский",
    "eng": "Английский",
    "en": "Английский",
    "pol": "Польский",
    "pl": "Польский",
    "ukr": "Украинский",
    "uk": "Украинский",
}

_SUB_LANG_LABELS_EN = {
    "rus": "Russian",
    "ru": "Russian",
    "eng": "English",
    "en": "English",
    "pol": "Polish",
    "pl": "Polish",
    "ukr": "Ukrainian",
    "uk": "Ukrainian",
}

_VOICE_KEYWORDS = [
    ("Дубляж", ("дубляж", "нефафильм", "невафильм", "пифагор", "red head sound", "rhs")),
    ("HDRezka", ("hdrezka", "резка", "rezka")),
    ("TVShows", ("tvshows",)),
    ("LostFilm", ("lostfilm", "лостфильм")),
    ("Jaskier", ("jaskier", "яскьер")),
    ("Кубик в Кубе", ("кубик", "kubik")),
    ("AlexFilm", ("alexfilm",)),
    ("NewStudio", ("newstudio",)),
]


_MULTI_SPACE_RE = re.compile(r"[ \t]+")
_WEBVTT_HEADER_STRIP_RE = re.compile(r"^\s*WEBVTT[^\n]*\n+", re.IGNORECASE)
_VTT_TIME_CUE_RE = re.compile(
    r"(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})(.*)"
)
_SRT_NUMBERED_CUE_BOUNDARY_RE = re.compile(r"\n(?=\d+\n\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->)")
_SRT_SINGLE_NL_CUE_BOUNDARY_RE = re.compile(r"(?<!\n)\n(?=\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->)")
_VTT_BLOCK_SPLIT_RE = re.compile(r"(?:\n[ \t]*){2,}")
_VTT_HEADER_BLOCK_RE = re.compile(r"^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)", re.IGNORECASE)
_SRT_TOP_TAG_RE = re.compile(r"\{\\(?:an[789]|a[567])\b[^}]*\}", re.IGNORECASE)
_SRT_OVERRIDE_TAG_RE = re.compile(r"\{\\[^}]*\}")
_VTT_X1_SETTING_RE = re.compile(r"\s*\bX1:\d+\b.*$", re.IGNORECASE)
_INFO_HASH_40_RE = re.compile(r"^[0-9a-f]{40}$")
_SEED_EMOJI_RE = re.compile("\U0001F464\\s*(\\d+)")
_SEED_TEXT_RE = re.compile(r"(?:seeders|сиды)[:\s]+(\d+)")
_SIZE_EMOJI_RE = re.compile("\U0001F4BE\\s*([\\d.,]+\\s*(?:GB|MB|TB|ГБ|МБ|ТБ))", re.IGNORECASE)
_SIZE_UNIT_RE = re.compile(r"\b([\d.,]+\s*(?:GB|MB|TB|ГБ|МБ|ТБ))\b", re.IGNORECASE)
_TRACKER_EMOJI_RE = re.compile("\u2699(?:\uFE0F)?\\s*([^\n\U0001F464\U0001F4BE\U0001F1E6-\U0001F1FF]+)")
_CYR_WORD_3_RE = re.compile(r"[а-яё]{3,}")
_ENG_SUB_TOKEN_RE = re.compile(r"(?<![a-z0-9])(?:eng|english|sub)(?![a-z0-9])")
_4K_UHD_TOKEN_RE = re.compile(r"(?<![a-z0-9])(?:4k|uhd)(?![a-z0-9])")
_HDR_TOKEN_RE = re.compile(r"(?<![a-z0-9])hdr(?:\d*\+?)?(?![a-z0-9])")
_WHITESPACE_COLLAPSE_RE = re.compile(r"\s+")


def _clean_no_emoji(text: str) -> str:
    if not text:
        return ""
    cleaned = _EMOJI_STRIP_RE.sub(" ", text)
    cleaned = _MULTI_SPACE_RE.sub(" ", cleaned)
    return cleaned.strip(" \t\r\n·|/-")


def convert_srt_or_vtt_to_webvtt(raw_text: str, offset_sec: float = 0.0) -> str:
    """
    Converts SRT or WebVTT text into valid WebVTT and optionally shifts all cue
    timestamps by -offset_sec (used when seeking in FFmpeg Remux streams).
    """
    if not raw_text:
        return "WEBVTT\n\n"
    text = raw_text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    text = _WEBVTT_HEADER_STRIP_RE.sub("", text)

    def _to_sec(h_s: Optional[str], m_s: str, s_s: str, ms_s: str) -> float:
        h = int(h_s) if h_s else 0
        ms_padded = (ms_s + "000")[:3]
        return h * 3600.0 + int(m_s) * 60.0 + int(s_s) + int(ms_padded) / 1000.0

    def _fmt_vtt_ts(sec: float) -> str:
        sec = max(0.0, sec)
        total_ms = int(round(sec * 1000))
        hrs, rem = divmod(total_ms, 3600_000)
        mins, rem = divmod(rem, 60_000)
        secs, ms = divmod(rem, 1000)
        return f"{hrs:02d}:{mins:02d}:{secs:02d}.{ms:03d}"

    # Normalize single-newline SRT cue boundaries (`\n12\n00:01:02,000 --> ...`)
    text = _SRT_NUMBERED_CUE_BOUNDARY_RE.sub("\n\n", text.strip())
    text = _SRT_SINGLE_NL_CUE_BOUNDARY_RE.sub("\n\n", text)
    blocks = _VTT_BLOCK_SPLIT_RE.split(text.strip())
    out_cues: List[str] = []
    shift = max(0.0, float(offset_sec or 0.0))

    for blk in blocks:
        lines = [ln.strip() for ln in blk.split("\n") if ln.strip()]
        if not lines:
            continue
        if _VTT_HEADER_BLOCK_RE.match(lines[0]):
            continue
        ts_idx = -1
        m_ts = None
        for idx, ln in enumerate(lines[:3]):
            m = _VTT_TIME_CUE_RE.match(ln)
            if m:
                ts_idx = idx
                m_ts = m
                break
        if ts_idx < 0 or not m_ts:
            continue
        start_s = _to_sec(m_ts.group(1), m_ts.group(2), m_ts.group(3), m_ts.group(4)) - shift
        end_s = _to_sec(m_ts.group(5), m_ts.group(6), m_ts.group(7), m_ts.group(8)) - shift
        extra_settings = _VTT_X1_SETTING_RE.sub("", m_ts.group(9) or "")
        if end_s <= 0.05 or end_s <= start_s:
            continue
        start_s = max(0.0, start_s)
        if end_s <= start_s:
            continue
        raw_payload_lines = lines[ts_idx + 1 :]
        if not raw_payload_lines:
            continue
        joined_raw_payload = "\n".join(raw_payload_lines)
        if _SRT_TOP_TAG_RE.search(joined_raw_payload) and "line:" not in extra_settings.lower():
            extra_settings = f"{extra_settings} line:8%"
        payload_lines = []
        for pln in raw_payload_lines:
            cleaned_pln = _SRT_OVERRIDE_TAG_RE.sub("", pln).strip().replace("-->", "--&gt;")
            if cleaned_pln:
                payload_lines.append(cleaned_pln)
        if not payload_lines:
            continue
        out_cues.append(f"{_fmt_vtt_ts(start_s)} --> {_fmt_vtt_ts(end_s)}{extra_settings}\n" + "\n".join(payload_lines))

    return "WEBVTT\n\n" + "\n\n".join(out_cues) + "\n"


class StremioAddonEngine:
    """
    Native Stremio Addon Protocol Client for Velarium:
    - Manages installed Stremio addons (manifest.json URLs & stremio:// links)
    - Resolves IMDb tt-IDs and episode maps via official Stremio Cinemeta v3
    - Fetches streams (Torrentio, TPB+, custom Debrid/HTTP addons) & OpenSubtitles v3 in parallel
    - Resolves exact episode file indices in TorrServer or Debrid for instant browser playback
    """

    CINEMETA_BASE = "https://v3-cinemeta.strem.io"
    UA = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    )

    DEFAULT_ADDONS: List[Dict[str, Any]] = [
        {
            "id": "com.stremio.torrentio.ru.addon",
            "name": "Torrentio (RU + EN · 4K / 1080p)",
            "description": "Потоки 4K Dolby Vision, HDR и 1080p с русскими дорожками (HDRezka, LostFilm, TVShows, Дубляж) и оригиналом",
            "description_en": "4K Dolby Vision, HDR, and 1080p streams with Original English and multi-language audio tracks",
            "manifest_url": "https://torrentio.strem.fun/language=russian/manifest.json",
            "base_url": "https://torrentio.strem.fun/language=russian",
            "resources": ["stream"],
            "types": ["movie", "series"],
            "enabled": True,
            "builtin": True,
        },
        {
            "id": "org.stremio.opensubtitlesv3",
            "name": "OpenSubtitles v3",
            "description": "Официальный аддон субтитров Stremio (русские, английские, польские и другие субтитры)",
            "description_en": "Official Stremio subtitles addon (English, Russian, Polish, and international subtitles)",
            "manifest_url": "https://opensubtitles-v3.strem.io/manifest.json",
            "base_url": "https://opensubtitles-v3.strem.io",
            "resources": ["subtitles"],
            "types": ["movie", "series"],
            "enabled": True,
            "builtin": True,
        },
        {
            "id": "com.stremio.tpbplus.addon",
            "name": "ThePirateBay+",
            "description": "Дополнительный международный каталог потоков Stremio в оригинале",
            "description_en": "Additional international Stremio stream catalog with original audio",
            "manifest_url": "https://thepiratebay-plus.strem.fun/manifest.json",
            "base_url": "https://thepiratebay-plus.strem.fun",
            "resources": ["stream"],
            "types": ["movie", "series"],
            "enabled": True,
            "builtin": True,
        },
    ]

    def __init__(self, data_dir: str, backup_engine: Any):
        self.data_dir = data_dir
        self.backup_engine = backup_engine
        self.addons_path = os.path.join(data_dir, "stremio_addons.json")
        self.imdb_cache_path = os.path.join(data_dir, "stremio_imdb_cache.json")
        self._lock = threading.Lock()
        self._db = get_storage_db(data_dir)
        self.addons: List[Dict[str, Any]] = []
        self._imdb_cache: Dict[str, str] = {}
        self._cinemeta_meta_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._streams_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._safe_opener: Optional[Any] = None
        self._addon_executor = concurrent.futures.ThreadPoolExecutor(max_workers=6)
        self._load_state()

    def _load_state(self) -> None:
        loaded_addons: List[Dict[str, Any]] = []
        try:
            db_addons = self._db.get_kv("stremio", "addons")
            if isinstance(db_addons, list):
                loaded_addons = [a for a in db_addons if isinstance(a, dict) and a.get("manifest_url")]
        except Exception:
            loaded_addons = []

        if not loaded_addons and os.path.isfile(self.addons_path):
            try:
                with open(self.addons_path, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                if isinstance(raw, list):
                    loaded_addons = [a for a in raw if isinstance(a, dict) and a.get("manifest_url")]
                if loaded_addons:
                    self._db.set_kv("stremio", "addons", loaded_addons)
            except Exception:
                loaded_addons = []

        if not loaded_addons:
            loaded_addons = [dict(a) for a in self.DEFAULT_ADDONS]
        else:
            defaults_by_id = {d["id"]: d for d in self.DEFAULT_ADDONS}
            defaults_by_url = {d["manifest_url"].rstrip("/"): d for d in self.DEFAULT_ADDONS}
            for item in loaded_addons:
                matched_def = defaults_by_id.get(str(item.get("id") or "")) or defaults_by_url.get(
                    str(item.get("manifest_url") or "").rstrip("/")
                )
                if matched_def:
                    if not item.get("description_en") and matched_def.get("description_en"):
                        item["description_en"] = matched_def["description_en"]
                    if not item.get("description_ru") and matched_def.get("description"):
                        item["description_ru"] = matched_def["description"]
            existing_urls = {str(a.get("manifest_url") or "").rstrip("/") for a in loaded_addons}
            for d_add in self.DEFAULT_ADDONS:
                if d_add["manifest_url"].rstrip("/") not in existing_urls:
                    loaded_addons.append(dict(d_add))

        self.addons = loaded_addons

        try:
            db_imdb = self._db.load_cache_dict("stremio_imdb", max_entries=6000)
            if db_imdb:
                self._imdb_cache = {str(k): str(v) for k, v in db_imdb.items() if str(v).startswith("tt")}
                return
        except Exception:
            pass

        if os.path.isfile(self.imdb_cache_path):
            try:
                with open(self.imdb_cache_path, "r", encoding="utf-8") as f:
                    raw_c = json.load(f)
                if isinstance(raw_c, dict):
                    self._imdb_cache = {str(k): str(v) for k, v in raw_c.items() if str(v).startswith("tt")}
                    if self._imdb_cache:
                        self._db.save_cache_dict("stremio_imdb", self._imdb_cache, max_entries=6000)
            except Exception:
                self._imdb_cache = {}

    def _save_addons(self) -> None:
        try:
            self._db.set_kv("stremio", "addons", self.addons)
        except Exception:
            pass

    def _save_imdb_cache(self) -> None:
        try:
            self._db.save_cache_dict("stremio_imdb", dict(self._imdb_cache), max_entries=6000)
        except Exception:
            pass

    @staticmethod
    def _is_disallowed_ip(ip_obj: Any) -> bool:
        if isinstance(ip_obj, ipaddress.IPv6Address):
            if ip_obj.ipv4_mapped is not None:
                return StremioAddonEngine._is_disallowed_ip(ip_obj.ipv4_mapped)
            if getattr(ip_obj, "sixtofour", None) is not None:
                return StremioAddonEngine._is_disallowed_ip(ip_obj.sixtofour)
            if getattr(ip_obj, "teredo", None) is not None:
                srv_ip, cli_ip = ip_obj.teredo
                return StremioAddonEngine._is_disallowed_ip(srv_ip) or StremioAddonEngine._is_disallowed_ip(cli_ip)
        return bool(
            ip_obj.is_loopback
            or ip_obj.is_private
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_unspecified
            or ip_obj.is_reserved
            or not ip_obj.is_global
        )

    @staticmethod
    def is_safe_public_http_url(url: str) -> bool:
        u = str(url or "").strip()
        if not u or _CTRL_CHAR_RE.search(u) or _WHITESPACE_RE.search(u):
            return False
        try:
            from backend.net_security import is_allowed_media_source_url
            return bool(is_allowed_media_source_url(u, allow_torrserver_loopback=False))
        except Exception:
            return False

    def _get_safe_opener(self) -> Any:
        opener = getattr(self, "_safe_opener", None)
        if opener is not None:
            return opener

        from .net_security import SafePublicHTTPHandler, SafePublicHTTPSHandler

        class _SafeRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                resolved_url = urllib.parse.urljoin(req.full_url, str(newurl or ""))
                if not StremioAddonEngine.is_safe_public_http_url(resolved_url):
                    if fp is not None:
                        try:
                            fp.close()
                        except Exception:
                            pass
                    raise urllib.error.URLError("Disallowed redirect target")
                return super().redirect_request(req, fp, code, msg, headers, resolved_url)

        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            SafePublicHTTPHandler(),
            SafePublicHTTPSHandler(context=_SHARED_SSL_CTX),
            _SafeRedirect(),
        )
        self._safe_opener = opener
        return opener

    def _http_get_json(self, url: str, timeout: float = 7.5) -> Optional[Dict[str, Any]]:
        if not self.is_safe_public_http_url(url):
            return None

        try:
            opener = self._get_safe_opener()
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": self.UA,
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip, identity",
                },
            )
            with opener.open(req, timeout=timeout) as resp:
                if resp.status != 200:
                    return None
                max_compressed = 2 * 1024 * 1024
                raw_bytes = resp.read(max_compressed + 1)
                if len(raw_bytes) > max_compressed:
                    return None
                enc = str(resp.headers.get("Content-Encoding") or "").lower()
                if "gzip" in enc or raw_bytes[:2] == b"\x1f\x8b":
                    max_inflated = 6 * 1024 * 1024
                    with gzip.GzipFile(fileobj=io.BytesIO(raw_bytes)) as gz:
                        raw_bytes = gz.read(max_inflated + 1)
                    if len(raw_bytes) > max_inflated:
                        return None
                raw = raw_bytes.decode("utf-8", errors="replace")
                data = json.loads(raw)
                return data if isinstance(data, dict) else None
        except Exception:
            return None

    def get_addons(self, lang: str = "ru") -> List[Dict[str, Any]]:
        is_en = str(lang or "").strip().lower().startswith("en")
        with self._lock:
            out: List[Dict[str, Any]] = []
            for a in self.addons:
                copied = dict(a)
                ru_desc = str(copied.get("description_ru") or copied.get("description") or "")
                en_desc = str(copied.get("description_en") or "")
                copied["description_ru"] = ru_desc
                if en_desc:
                    copied["description_en"] = en_desc
                if is_en and en_desc:
                    copied["description"] = en_desc
                else:
                    copied["description"] = ru_desc
                out.append(copied)
            return out

    @staticmethod
    def normalize_manifest_url(raw_url: str) -> str:
        u = (raw_url or "").strip()
        if not u or _CTRL_CHAR_RE.search(u):
            return ""
        if u.lower().startswith("stremio://"):
            u = "https://" + u[len("stremio://") :]
        elif not re.match(r"^https?://", u, re.I):
            u = "https://" + u
        parsed = urllib.parse.urlparse(u)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return ""
        path = parsed.path or ""
        if path.lower().endswith("/manifest.json"):
            path = path[: -len("/manifest.json")] + "/manifest.json"
        else:
            path = path.rstrip("/") + "/manifest.json"
        candidate = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, path, "", parsed.query, ""))
        if not StremioAddonEngine.is_safe_public_http_url(candidate):
            return ""
        return candidate

    def add_addon_by_url(self, raw_url: str, lang: str = "ru") -> Dict[str, Any]:
        is_en = str(lang or "").strip().lower().startswith("en")
        manifest_url = self.normalize_manifest_url(raw_url)
        if not manifest_url:
            return {
                "ok": False,
                "error": (
                    "Enter a valid manifest.json or stremio:// URL"
                    if is_en
                    else "Укажите корректную ссылку manifest.json или stremio://"
                ),
            }

        manifest = self._http_get_json(manifest_url, timeout=9.0)
        if not manifest or not manifest.get("id") or not manifest.get("name"):
            return {
                "ok": False,
                "error": (
                    "Could not fetch manifest.json from the provided URL"
                    if is_en
                    else "Не удалось загрузить manifest.json по указанному адресу"
                ),
            }

        raw_res = manifest.get("resources") or []
        res_names: List[str] = []
        for r in raw_res:
            if isinstance(r, str):
                res_names.append(r)
            elif isinstance(r, dict) and r.get("name"):
                res_names.append(str(r["name"]))
        if not any(rn in ("stream", "subtitles", "catalog", "meta") for rn in res_names):
            return {
                "ok": False,
                "error": (
                    "This addon does not provide streams or subtitles"
                    if is_en
                    else "Этот аддон не предоставляет потоки или субтитры"
                ),
            }

        base_url = re.sub(r"/manifest\.json(?:\?.*)?$", "", manifest_url, flags=re.I)
        clean_name = _clean_no_emoji(str(manifest.get("name") or "Stremio Addon"))
        clean_desc = _clean_no_emoji(str(manifest.get("description") or ""))
        addon_id = str(manifest.get("id"))
        types_list = [str(t) for t in (manifest.get("types") or ["movie", "series"]) if isinstance(t, str)]

        new_entry = {
            "id": addon_id,
            "name": clean_name or addon_id,
            "version": str(manifest.get("version") or ""),
            "description": clean_desc[:220],
            "manifest_url": manifest_url,
            "base_url": base_url,
            "resources": res_names,
            "types": types_list or ["movie", "series"],
            "enabled": True,
            "builtin": False,
        }

        with self._lock:
            replaced = False
            for idx, existing in enumerate(self.addons):
                if (
                    existing.get("manifest_url", "").rstrip("/") == manifest_url.rstrip("/")
                    or (existing.get("id") == addon_id and not existing.get("builtin"))
                ):
                    new_entry["builtin"] = bool(existing.get("builtin"))
                    self.addons[idx] = new_entry
                    replaced = True
                    break
            if not replaced:
                self.addons.insert(0, new_entry)
            self._streams_cache.clear()
            self._save_addons()

        return {"ok": True, "addon": new_entry, "addons": self.get_addons()}

    def toggle_addon(self, manifest_url_or_id: str, enabled: bool) -> Dict[str, Any]:
        target = (manifest_url_or_id or "").strip()
        with self._lock:
            for a in self.addons:
                if a.get("manifest_url") == target or a.get("id") == target:
                    a["enabled"] = bool(enabled)
            self._streams_cache.clear()
            self._save_addons()
        return {"ok": True, "addons": self.get_addons()}

    def remove_addon(self, manifest_url_or_id: str) -> Dict[str, Any]:
        target = (manifest_url_or_id or "").strip()
        with self._lock:
            self.addons = [
                a
                for a in self.addons
                if not ((a.get("manifest_url") == target or a.get("id") == target) and not a.get("builtin"))
            ]
            self._streams_cache.clear()
            self._save_addons()
        return {"ok": True, "addons": self.get_addons()}

    def restore_addons(self, addons_list: Any) -> None:
        if not isinstance(addons_list, list):
            return
        builtin_by_manifest = {d["manifest_url"]: d for d in self.DEFAULT_ADDONS}
        valid: List[Dict[str, Any]] = []
        seen_manifests = set()
        for a in addons_list:
            if not isinstance(a, dict) or not a.get("manifest_url"):
                continue
            # Re-validate every restored URL (backup files are untrusted input → SSRF to LAN hosts)
            norm_manifest = self.normalize_manifest_url(str(a.get("manifest_url") or ""))
            if not norm_manifest or norm_manifest in seen_manifests:
                continue
            seen_manifests.add(norm_manifest)
            entry = dict(a)
            entry["manifest_url"] = norm_manifest
            entry["base_url"] = re.sub(r"/manifest\.json(?:\?.*)?$", "", norm_manifest, flags=re.I)
            entry["builtin"] = norm_manifest in builtin_by_manifest
            valid.append(entry)
        if not valid:
            return
        with self._lock:
            self.addons = valid
            self._streams_cache.clear()
            self._save_addons()

    def resolve_imdb_id(
        self,
        item_id: str,
        title: str,
        orig_title: str,
        year: int,
        media_type: str,
    ) -> str:
        raw_id = (item_id or "").strip()
        m_tt = re.search(r"(tt\d{5,10})", raw_id)
        if m_tt:
            return m_tt.group(1)

        stremio_type = "series" if media_type == "series" else "movie"
        target_year = _safe_stremio_int(year, 0)
        cache_key = f"{stremio_type}:{_norm_title(orig_title or title)}:{target_year}"
        with self._lock:
            cached = self._imdb_cache.get(cache_key)
            if cached:
                return cached

        queries: List[str] = []
        for q in (orig_title, title):
            q_clean = (q or "").strip()
            if q_clean and q_clean not in queries:
                queries.append(q_clean)

        best_tt = ""
        best_score = -1
        norm_orig = _norm_title(orig_title) if orig_title else ""
        norm_ru = _norm_title(title) if title else ""
        fold_orig = self.backup_engine._fold_double_chars(norm_orig) if norm_orig else ""
        fold_ru = self.backup_engine._fold_double_chars(norm_ru) if norm_ru else ""
        target_seq = (
            self.backup_engine._extract_sequel_markers(orig_title)
            | self.backup_engine._extract_sequel_markers(title)
        )
        target_explicit_seq = {n for n in target_seq if n >= 2}

        for q in queries:
            enc_q = urllib.parse.quote(q)
            url = f"{self.CINEMETA_BASE}/catalog/{stremio_type}/top/search={enc_q}.json"
            data = self._http_get_json(url, timeout=6.0)
            raw_metas = (data or {}).get("metas")
            metas = raw_metas if isinstance(raw_metas, list) else []
            for m in metas[:12]:
                if not isinstance(m, dict):
                    continue
                cand_id = str(m.get("id") or m.get("imdb_id") or "")
                if not _IMDB_ID_RE.match(cand_id):
                    continue
                raw_cand_name = str(m.get("name") or "")
                cand_name = _norm_title(raw_cand_name)
                fold_cand = self.backup_engine._fold_double_chars(cand_name)
                cand_seq = self.backup_engine._extract_sequel_markers(raw_cand_name)
                cand_explicit_seq = {n for n in cand_seq if n >= 2}
                rel_info = str(m.get("releaseInfo") or m.get("year") or "")
                m_yr = re.search(r"((?:19|20)\d{2})", rel_info)
                cand_year = int(m_yr.group(1)) if m_yr else 0

                score = 0
                if norm_orig and (cand_name == norm_orig or (fold_orig and fold_cand == fold_orig)):
                    score += 65
                elif norm_ru and (cand_name == norm_ru or (fold_ru and fold_cand == fold_ru)):
                    score += 60
                elif norm_orig and (norm_orig in cand_name or cand_name in norm_orig):
                    extra_words = len(cand_name.split()) - len(norm_orig.split())
                    score += 28 if extra_words <= 0 else max(5, 22 - extra_words * 8)
                elif norm_ru and (norm_ru in cand_name or cand_name in norm_ru):
                    extra_words = len(cand_name.split()) - len(norm_ru.split())
                    score += 24 if extra_words <= 0 else max(5, 18 - extra_words * 8)

                if target_explicit_seq:
                    if cand_explicit_seq & target_explicit_seq:
                        score += 25
                    else:
                        score -= 45
                elif cand_explicit_seq:
                    score -= 45

                if target_year and cand_year:
                    diff = abs(target_year - cand_year)
                    if diff == 0:
                        score += 35
                    elif diff == 1:
                        score += 20
                    elif diff > 3:
                        score -= 45

                if score > best_score:
                    best_score = score
                    best_tt = cand_id
            if best_score >= 75 and best_tt:
                break

        if best_tt and best_score >= 25:
            with self._lock:
                if len(self._imdb_cache) >= 6000:
                    try:
                        self._imdb_cache.pop(next(iter(self._imdb_cache)))
                    except StopIteration:
                        pass
                self._imdb_cache[cache_key] = best_tt
            if self._db is not None:
                try:
                    self._db.set_cache_entry("stremio_imdb", cache_key, best_tt)
                except Exception:
                    pass
            return best_tt
        return ""

    def fetch_cinemeta_series_meta(self, imdb_id: str, force_refresh: bool = False) -> Dict[str, Any]:
        clean_imdb = str(imdb_id or "").strip()
        if not _IMDB_ID_RE.match(clean_imdb):
            return {}
        now = time.time()
        if not force_refresh:
            cached_val = None
            with self._lock:
                cached = self._cinemeta_meta_cache.get(clean_imdb)
                if cached and now - cached[0] < 1800:
                    cached_val = cached[1]
            if cached_val is not None:
                return copy.deepcopy(cached_val)

        data = self._http_get_json(f"{self.CINEMETA_BASE}/meta/series/{clean_imdb}.json", timeout=6.5)
        raw_meta = (data or {}).get("meta")
        meta = raw_meta if isinstance(raw_meta, dict) else {}
        meta_title_en = _clean_no_emoji(str(meta.get("name") or ""))
        raw_videos = meta.get("videos")
        videos = raw_videos if isinstance(raw_videos, list) else []
        seasons_map: Dict[str, List[int]] = {}
        episodes_titles: Dict[str, Dict[str, str]] = {}
        episodes_meta: Dict[str, Dict[str, Dict[str, Any]]] = {}
        latest_season = 1
        latest_episode = 1

        now_utc = datetime.now(timezone.utc)
        now_iso = now_utc.strftime("%Y-%m-%d")
        stale_cutoff_iso = (now_utc - timedelta(days=180)).strftime("%Y-%m-%d")
        any_dated = False
        any_released = False
        had_dated_released = False
        max_dated_season = 0
        max_dated_ep = 0
        max_aired_date = ""
        min_dated_season: Optional[int] = None
        for v in videos:
            if not isinstance(v, dict):
                continue
            try:
                s_num = int(v.get("season") or 0)
                e_num = int(v.get("episode") or v.get("number") or 0)
            except (TypeError, ValueError):
                continue
            if s_num <= 0 or e_num <= 0:
                continue
            s_key = str(s_num)
            e_key = str(e_num)
            released = str(v.get("released") or "")[:10]
            if released and not re.match(r"^\d{4}-\d{2}-\d{2}$", released):
                released = ""
            ep_title = _clean_no_emoji(str(v.get("name") or v.get("title") or ""))
            clean_ep_title = ""
            if ep_title and not re.match(r"^Episode\s+\d+$", ep_title, re.I):
                clean_ep_title = ep_title
            prev_ep = episodes_meta.get(s_key, {}).get(e_key)
            if prev_ep is not None:
                if not released and prev_ep.get("air_date"):
                    released = str(prev_ep["air_date"])
                if not clean_ep_title and prev_ep.get("title"):
                    clean_ep_title = str(prev_ep["title"])
            if released:
                any_dated = True
                if min_dated_season is None or s_num < min_dated_season:
                    min_dated_season = s_num
            seasons_map.setdefault(s_key, [])
            if e_num not in seasons_map[s_key]:
                seasons_map[s_key].append(e_num)
            if clean_ep_title:
                episodes_titles.setdefault(s_key, {})[e_key] = clean_ep_title
            # Episodes without an air date are resolved below once we know (max_dated_season, max_dated_ep)
            is_future = bool(released > now_iso) if released else None
            episodes_meta.setdefault(s_key, {})[e_key] = {
                "title": clean_ep_title,
                "air_date": released,
                "is_future": bool(is_future),
                "is_released": is_future is False,
                "_undated": is_future is None,
            }
            if is_future is False:
                any_released = True
                had_dated_released = True
                if released and released > max_aired_date:
                    max_aired_date = released
                if (s_num, e_num) > (max_dated_season, max_dated_ep):
                    max_dated_season, max_dated_ep = s_num, e_num
                if (s_num, e_num) > (latest_season, latest_episode):
                    latest_season, latest_episode = s_num, e_num

        if any_dated:
            # Undated entries PRIOR to the latest dated released episode (or in seasons before min_dated_season,
            # or in a finished historical season whose latest dated episode aired >180 days ago) are back-catalog;
            # undated entries AFTER an active/upcoming season's latest dated released episode are TBA/unreleased.
            for s_key_u, s_eps in episodes_meta.items():
                s_int = int(s_key_u)
                has_future_dated_in_season = any(
                    bool(em.get("air_date") and em.get("is_future")) for em in s_eps.values()
                )
                for e_key_u, ep_m in s_eps.items():
                    if ep_m.pop("_undated", False):
                        e_int = int(e_key_u)
                        is_prior = bool(
                            (had_dated_released and (s_int < max_dated_season or (s_int, e_int) < (max_dated_season, max_dated_ep)))
                            or (min_dated_season is not None and s_int < min_dated_season)
                            or (
                                had_dated_released
                                and s_int == max_dated_season
                                and not has_future_dated_in_season
                                and bool(max_aired_date and max_aired_date <= stale_cutoff_iso)
                            )
                        )
                        if is_prior:
                            ep_m["is_future"] = False
                            ep_m["is_released"] = True
                            any_released = True
                            if (s_int, e_int) > (latest_season, latest_episode):
                                latest_season, latest_episode = s_int, e_int
                        else:
                            ep_m["is_future"] = True
                            ep_m["is_released"] = False
        else:
            # Show has no air dates at all: cannot tell, treat every listed episode as released
            for s_key_u, s_eps in episodes_meta.items():
                for e_key_u, ep_m in s_eps.items():
                    if ep_m.pop("_undated", False):
                        ep_m["is_future"] = False
                        ep_m["is_released"] = True
                        any_released = True
                        if (int(s_key_u), int(e_key_u)) > (latest_season, latest_episode):
                            latest_season, latest_episode = int(s_key_u), int(e_key_u)
        if not any_released:
            latest_season, latest_episode = 0, 0

        released_seasons_map: Dict[str, List[int]] = {}
        for s_key in seasons_map:
            seasons_map[s_key].sort()
            rel_eps = [
                e for e in seasons_map[s_key]
                if episodes_meta.get(s_key, {}).get(str(e), {}).get("is_released")
            ]
            if rel_eps:
                released_seasons_map[s_key] = rel_eps

        parsed = {
            "title_en": meta_title_en,
            # Brand-new show with only announced episodes → nothing playable yet
            "seasons_map": released_seasons_map,
            "planned_seasons_map": seasons_map,
            "episodes_titles": episodes_titles,
            "episodes_meta": episodes_meta,
            "latest_season": latest_season,
            "latest_episode": latest_episode,
        }
        if data is None:
            # Network / parse failure: do not pin an empty map for 30 minutes
            return parsed
        with self._lock:
            if len(self._cinemeta_meta_cache) >= 256:
                for k_old in list(self._cinemeta_meta_cache.keys())[:64]:
                    self._cinemeta_meta_cache.pop(k_old, None)
            self._cinemeta_meta_cache[clean_imdb] = (now, parsed)
        return copy.deepcopy(parsed)

    def search_cinemeta(self, query: str, media_type_filter: str = "all") -> List[Dict[str, Any]]:
        q_clean = (query or "").strip()
        if len(q_clean) < 2:
            return []
        types_to_query = ["movie", "series"] if media_type_filter == "all" else [media_type_filter]
        results: List[Dict[str, Any]] = []
        seen_ids = set()

        def _fetch_type(mtype: str) -> Tuple[str, List[Dict[str, Any]]]:
            st_type = "series" if mtype == "series" else "movie"
            url = f"{self.CINEMETA_BASE}/catalog/{st_type}/top/search={urllib.parse.quote(q_clean)}.json"
            data = self._http_get_json(url, timeout=4.5)
            raw_metas = (data or {}).get("metas")
            return st_type, (raw_metas if isinstance(raw_metas, list) else [])

        if len(types_to_query) > 1:
            fetched = list(self._addon_executor.map(_fetch_type, types_to_query))
        else:
            fetched = [_fetch_type(types_to_query[0])]

        for st_type, metas_list in fetched:
            for m in metas_list[:8]:
                if not isinstance(m, dict):
                    continue
                tt_id = str(m.get("id") or "")
                if not _IMDB_ID_RE.match(tt_id) or tt_id in seen_ids:
                    continue
                name = _clean_no_emoji(str(m.get("name") or ""))
                poster = str(m.get("poster") or "")
                if not name or not poster:
                    continue
                seen_ids.add(tt_id)
                rel_info = str(m.get("releaseInfo") or m.get("year") or "")
                m_yr = _YEAR_EXTRACT_RE.search(rel_info)
                yr = int(m_yr.group(1)) if m_yr else 0
                imdb_rt = 0.0
                try:
                    imdb_rt = round(float(m.get("imdbRating") or 0), 1)
                except (ValueError, TypeError):
                    imdb_rt = 0.0
                results.append(
                    {
                        "id": tt_id,
                        "title": name,
                        "orig_title": name,
                        "year": yr,
                        "media_type": st_type,
                        "poster": poster,
                        "poster_en": poster,
                        "backdrop": str(m.get("background") or poster),
                        "description": _clean_no_emoji(str(m.get("description") or "")),
                        "description_en": _clean_no_emoji(str(m.get("description") or "")),
                        "genres": [str(g) for g in (m.get("genres") or [])[:3] if g],
                        "ratings": {"imdb": imdb_rt or 0, "kinorium": imdb_rt or 0},
                        "providers": [
                            {
                                "id": "stremio",
                                "available": True,
                                "quality": "Stremio · 4K/1080p",
                                "url": f"native://stremio/{tt_id}",
                            }
                        ],
                    }
                )
        return results

    def _parse_single_stream(
        self,
        raw_st: Dict[str, Any],
        addon: Dict[str, Any],
        ui_lang: str = "ru",
    ) -> Optional[Dict[str, Any]]:
        if not isinstance(raw_st, dict):
            return None
        is_en = ui_lang == "en"
        direct_url = str(raw_st.get("url") or "").strip()
        if direct_url and not self.is_safe_public_http_url(direct_url):
            direct_url = ""
        info_hash = str(raw_st.get("infoHash") or "").strip().lower()
        if not _INFO_HASH_40_RE.match(info_hash):
            info_hash = ""
        if not direct_url and not info_hash:
            return None

        raw_name = str(raw_st.get("name") or "")
        raw_title = str(raw_st.get("title") or raw_st.get("description") or "")
        combined = f"{raw_name}\n{raw_title}"
        comb_low = combined.lower()

        if any(bad in comb_low for bad in ("camrip", "hdcam", "telesync", "telecine", "ts-rip")):
            return None

        # Extract seeders before stripping emojis
        seeders = 0
        m_seed = _SEED_EMOJI_RE.search(combined) or _SEED_TEXT_RE.search(comb_low)
        if m_seed:
            seeders = int(m_seed.group(1))

        # Extract size
        size_label = ""
        m_size = _SIZE_EMOJI_RE.search(combined) or _SIZE_UNIT_RE.search(combined)
        if m_size:
            raw_sz = m_size.group(1).upper()
            if is_en:
                size_label = raw_sz.replace("ГБ", "GB").replace("МБ", "MB").replace("ТБ", "TB")
            else:
                size_label = raw_sz.replace("GB", "ГБ").replace("MB", "МБ").replace("TB", "ТБ")

        # Extract tracker / source
        tracker = ""
        m_trk = _TRACKER_EMOJI_RE.search(combined)
        if m_trk:
            tracker = _clean_no_emoji(m_trk.group(1))[:32]

        # Extract flag languages & voiceovers
        langs: List[str] = []
        for flag, code in _FLAG_LANG_MAP.items():
            if flag in combined and code not in langs:
                langs.append(code)

        has_ru_text = bool(
            _CYR_WORD_3_RE.search(comb_low)
            or any(k in comb_low for _, kws in _VOICE_KEYWORDS for k in kws)
            or _RUS_TOKEN_RE.search(comb_low)
        )
        if len(langs) >= 5 and not has_ru_text and "RU" in langs:
            # Multi-flag rows on English releases (e.g. 10 subtitle flags on TPB/UIndex) indicate embedded subs, not Russian audio
            langs = [c for c in langs if c != "RU"]
        if has_ru_text and "RU" not in langs:
            langs.insert(0, "RU")

        has_orig = bool(
            "EN" in langs
            or any(k in comb_low for k in ("original", "оригинал", "multi", "dual audio", "dual-audio"))
            or _ENG_SUB_TOKEN_RE.search(comb_low)
        )
        if has_orig and "EN" not in langs and "RU" not in langs:
            langs.append("EN")

        detected_voices: List[str] = []
        for v_label, kws in _VOICE_KEYWORDS:
            if any(k in comb_low for k in kws):
                detected_voices.append(v_label)
        if "RU" in langs and "Дубляж" not in detected_voices and _DUB_TOKEN_RE.search(comb_low):
            detected_voices.insert(0, "Дубляж")

        # Quality classification
        q_rank = 100
        quality = "1080p"
        if "2160p" in comb_low or _4K_UHD_TOKEN_RE.search(comb_low):
            if _DV_TOKEN_RE.search(comb_low):
                quality = "4K DV HDR"
                q_rank = 420
            elif _HDR_TOKEN_RE.search(comb_low):
                quality = "4K HDR"
                q_rank = 400
            else:
                quality = "4K UHD"
                q_rank = 380
        elif "remux" in comb_low:
            quality = "1080p Remux"
            q_rank = 270
        elif "1080p" in comb_low:
            quality = "1080p"
            q_rank = 240
        elif "720p" in comb_low:
            quality = "720p"
            q_rank = 140
        elif any(tok in comb_low for tok in ("web-dl", "webdl", "web-dlrip", "bdrip", "bluray", "blu-ray")):
            quality = "1080p"
            q_rank = 210

        title_lines = [_clean_no_emoji(ln) for ln in raw_title.splitlines() if _clean_no_emoji(ln)]
        clean_release_title = (
            title_lines[0]
            if title_lines
            else _clean_no_emoji(raw_name) or ("Stremio Stream" if is_en else "Поток Stremio")
        )
        clean_release_title = _WHITESPACE_COLLAPSE_RE.sub(" ", clean_release_title).strip()

        hints = raw_st.get("behaviorHints") if isinstance(raw_st.get("behaviorHints"), dict) else {}
        filename_hint = str(hints.get("filename") or "")

        file_idx_raw = raw_st.get("fileIdx")
        file_idx: Optional[int] = None
        if not isinstance(file_idx_raw, bool):
            if isinstance(file_idx_raw, int) and file_idx_raw >= 0:
                file_idx = file_idx_raw
            elif isinstance(file_idx_raw, str) and file_idx_raw.strip().isascii() and file_idx_raw.strip().isdigit():
                file_idx = int(file_idx_raw.strip())

        magnet = ""
        if info_hash:
            dn_part = f"&dn={urllib.parse.quote(filename_hint or clean_release_title[:90])}"
            extra_tr = ""
            raw_sources = raw_st.get("sources")
            for src_entry in (raw_sources if isinstance(raw_sources, list) else []):
                if isinstance(src_entry, str) and src_entry.startswith("tracker:"):
                    tr_url = src_entry[len("tracker:") :].strip()
                    if tr_url.startswith("udp://") or (
                        tr_url.startswith(("http://", "https://")) and self.is_safe_public_http_url(tr_url)
                    ):
                        extra_tr += f"&tr={urllib.parse.quote(tr_url, safe='')}"
            magnet = f"magnet:?xt=urn:btih:{info_hash}{dn_part}{extra_tr}{_PUBLIC_TRACKERS_SUFFIX}"

        is_cached_http = bool(direct_url and direct_url.startswith(("http://", "https://")))
        has_ru = "RU" in langs

        voice_parts: List[str] = []
        if is_en:
            if has_ru and "EN" in langs:
                voice_parts.append("RU + Original")
            elif has_ru:
                voice_parts.append("Russian Audio")
            else:
                voice_parts.append("Original")
        else:
            if has_ru and "EN" in langs:
                voice_parts.append("RU + Оригинал")
            elif has_ru:
                voice_parts.append("Русская дорожка")
            else:
                voice_parts.append("Оригинал")
        if detected_voices:
            en_voice_map = {"Дубляж": "Dubbed", "Кубик в Кубе": "Kubik v Kube"}
            v_disp = [en_voice_map.get(v, v) if is_en else v for v in detected_voices[:3]]
            voice_parts.append(", ".join(v_disp))

        addon_short = _clean_no_emoji(raw_name.splitlines()[0] if raw_name else addon.get("name", "Stremio"))
        if not addon_short:
            addon_short = addon.get("name", "Stremio")

        id_seed = info_hash or hashlib.sha1(direct_url.encode("utf-8", errors="ignore")).hexdigest()[:20]
        return {
            "stream_id": f"{id_seed}_{file_idx if file_idx is not None else 'auto'}",
            "title": clean_release_title,
            "addon_name": addon.get("name", "Stremio"),
            "addon_badge": addon_short[:28],
            "quality": quality,
            "quality_rank": q_rank,
            "size": size_label or ("Stream" if is_en else "Поток"),
            "seeders": seeders,
            "tracker": tracker or addon_short[:22],
            "languages": langs,
            "has_russian": has_ru,
            "has_original": has_orig,
            "voice_summary": " · ".join(voice_parts),
            "stream_kind": "direct_http" if is_cached_http else "torrent",
            "direct_url": direct_url if is_cached_http else "",
            "info_hash": info_hash,
            "file_idx": file_idx,
            "filename_hint": filename_hint,
            "magnet": magnet,
        }

    def _fetch_addon_streams(
        self,
        addon: Dict[str, Any],
        st_type: str,
        video_id: str,
        ui_lang: str = "ru",
    ) -> List[Dict[str, Any]]:
        base = str(addon.get("base_url") or "").rstrip("/")
        if not base:
            return []
        safe_type = urllib.parse.quote(str(st_type or "movie"), safe="")
        safe_vid = urllib.parse.quote(str(video_id or ""), safe=":")
        url = f"{base}/stream/{safe_type}/{safe_vid}.json"
        data = self._http_get_json(url, timeout=7.5)
        raw_list = (data or {}).get("streams")
        if not isinstance(raw_list, list):
            return []
        parsed_out: List[Dict[str, Any]] = []
        for st in raw_list:
            p = self._parse_single_stream(st, addon, ui_lang=ui_lang)
            if p:
                parsed_out.append(p)
        return parsed_out

    def _fetch_addon_subtitles(
        self,
        addon: Dict[str, Any],
        st_type: str,
        video_id: str,
        ui_lang: str = "ru",
    ) -> List[Dict[str, Any]]:
        base = str(addon.get("base_url") or "").rstrip("/")
        if not base:
            return []
        safe_type = urllib.parse.quote(str(st_type or "movie"), safe="")
        safe_vid = urllib.parse.quote(str(video_id or ""), safe=":")
        url = f"{base}/subtitles/{safe_type}/{safe_vid}.json"
        data = self._http_get_json(url, timeout=6.5)
        raw_subs = (data or {}).get("subtitles")
        if not isinstance(raw_subs, list):
            return []
        grouped: Dict[str, List[Dict[str, Any]]] = {"rus": [], "eng": [], "pol": [], "ukr": []}
        for s in raw_subs:
            if not isinstance(s, dict):
                continue
            sub_url = str(s.get("url") or "").strip()
            lang_raw = str(s.get("lang") or "").strip().lower()
            if not self.is_safe_public_http_url(sub_url):
                continue
            norm_lang = (
                "rus"
                if lang_raw in ("rus", "ru", "russian")
                else "eng"
                if lang_raw in ("eng", "en", "english")
                else "pol"
                if lang_raw in ("pol", "pl", "polish")
                else "ukr"
                if lang_raw in ("ukr", "uk", "ukrainian")
                else ""
            )
            if not norm_lang:
                continue
            if ui_lang == "en":
                max_per_lang = 4 if norm_lang == "eng" else (3 if norm_lang == "rus" else 2)
                base_lbl = _SUB_LANG_LABELS_EN.get(norm_lang, norm_lang.upper())
            else:
                max_per_lang = 4 if norm_lang == "rus" else (3 if norm_lang == "eng" else 2)
                base_lbl = _SUB_LANG_LABELS.get(norm_lang, norm_lang.upper())
            if len(grouped[norm_lang]) >= max_per_lang:
                continue
            rel_grp = _clean_no_emoji(str(s.get("releaseGroup") or ""))
            idx_num = len(grouped[norm_lang]) + 1
            suffix = f" ({rel_grp})" if rel_grp else (f" #{idx_num}" if idx_num > 1 else " (OpenSubtitles)")
            grouped[norm_lang].append(
                {
                    "lang": f"{base_lbl}{suffix}",
                    "raw_url": sub_url,
                    "url": f"/api/proxy-vtt?url={urllib.parse.quote(sub_url, safe='')}",
                    "direct_vtt": True,
                    "from_stremio": True,
                }
            )

        ordered: List[Dict[str, Any]] = []
        lang_order = ("eng", "rus", "pol", "ukr") if ui_lang == "en" else ("rus", "eng", "pol", "ukr")
        for k in lang_order:
            ordered.extend(grouped[k])
        return ordered

    def get_streams_for_title(
        self,
        item_id: str,
        title: str,
        orig_title: str,
        year: int,
        media_type: str,
        season: int = 1,
        episode: int = 1,
        lang: str = "ru",
        imdb_id: str = "",
        skip_preflight: bool = False,
    ) -> Dict[str, Any]:
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        st_type = "series" if media_type == "series" else "movie"
        imdb_id = self.resolve_imdb_id(imdb_id or item_id, title, orig_title, year, st_type)
        torr_online = self.backup_engine.ensure_local_torrserver()
        debrid_ready = bool(
            self.backup_engine.debrid_api_key
            and self.backup_engine.mode in ("realdebrid", "torbox", "debrid_https")
        )

        p2p_strict = bool(getattr(self.backup_engine.net, "p2p_strict", False))

        if not imdb_id:
            return {
                "ok": False,
                "imdb_id": "",
                "streams": [],
                "subtitles": [],
                "p2p_strict": p2p_strict,
                "torrserver_connected": torr_online,
                "debrid_ready": debrid_ready,
                "mode": self.backup_engine.mode,
                "addons": self.get_addons(),
                "error": (
                    "Could not match IMDb ID in Stremio Cinemeta catalog"
                    if ui_lang == "en"
                    else "Не удалось сопоставить IMDb ID в каталоге Stremio Cinemeta"
                ),
            }

        s_num = max(1, _safe_stremio_int(season, 1))
        e_num = max(1, _safe_stremio_int(episode, 1))
        video_id = f"{imdb_id}:{s_num}:{e_num}" if st_type == "series" else imdb_id
        cache_key = f"{st_type}:{video_id}:{ui_lang}"
        now = time.time()
        with self._lock:
            cached = self._streams_cache.get(cache_key)
        if cached and now - cached[0] < 300:
            payload = dict(cached[1])
            payload["streams"] = [dict(s) for s in (payload.get("streams") or [])]
            payload["subtitles"] = [dict(s) for s in (payload.get("subtitles") or [])]
            payload["p2p_strict"] = p2p_strict
            payload["torrserver_connected"] = torr_online
            payload["debrid_ready"] = debrid_ready
            payload["mode"] = self.backup_engine.mode
            return payload

        active_addons = [
            a
            for a in self.get_addons(lang=ui_lang)
            if a.get("enabled") and st_type in (a.get("types") or ["movie", "series"])
        ]
        stream_addons = [a for a in active_addons if "stream" in (a.get("resources") or [])]
        sub_addons = [a for a in active_addons if "subtitles" in (a.get("resources") or [])]

        all_streams: List[Dict[str, Any]] = []
        all_subs: List[Dict[str, Any]] = []
        series_meta: Dict[str, Any] = {}

        pool = getattr(self, "_addon_executor", None) or concurrent.futures.ThreadPoolExecutor(max_workers=6)
        self._addon_executor = pool
        stream_futs = [pool.submit(self._fetch_addon_streams, a, st_type, video_id, ui_lang) for a in stream_addons]
        sub_futs = [pool.submit(self._fetch_addon_subtitles, a, st_type, video_id, ui_lang) for a in sub_addons]
        meta_fut = pool.submit(self.fetch_cinemeta_series_meta, imdb_id) if st_type == "series" else None

        for f in stream_futs:
            try:
                all_streams.extend(f.result(timeout=8.5) or [])
            except Exception:
                pass
        for f in sub_futs:
            try:
                all_subs.extend(f.result(timeout=7.5) or [])
            except Exception:
                pass
        if meta_fut is not None:
            try:
                series_meta = meta_fut.result(timeout=7.0) or {}
            except Exception:
                series_meta = {}

        # Deduplicate streams by info_hash / direct_url while keeping richest metadata
        deduped: Dict[str, Dict[str, Any]] = {}
        for st in all_streams:
            key = st["direct_url"] or f"{st['info_hash']}:{st.get('file_idx')}"
            prev = deduped.get(key)
            if not prev or int(st.get("seeders") or 0) > int(prev.get("seeders") or 0):
                deduped[key] = st

        def _stream_sort_key(s: Dict[str, Any]) -> Tuple[Any, ...]:
            is_direct = 1 if s["stream_kind"] == "direct_http" else 0
            seeds = int(s.get("seeders") or 0)
            healthy = 1 if (s["stream_kind"] == "direct_http" or seeds >= 3) else 0
            rel_title_str = str(s.get("title") or "")
            is_multi_pack = 1 if (st_type != "series" and self.backup_engine._is_multi_movie_pack(rel_title_str)) else 0
            single_movie_tier = 0 if is_multi_pack else 1
            if ui_lang == "en":
                langs = s.get("languages") or []
                if (langs == ["EN"] or (langs and langs[0] == "EN")) and not s.get("has_russian"):
                    lang_pref = 3
                elif "EN" in langs and not s.get("has_russian"):
                    lang_pref = 2
                elif "EN" in langs or not s.get("has_russian"):
                    lang_pref = 1
                else:
                    lang_pref = 0
            else:
                lang_pref = 1 if s.get("has_russian") else 0
            size_gb = self.backup_engine._parse_size_gb(str(s.get("size") or ""))
            is_remux = bool(re.search(r"bdremux|remux|\bblu-?ray\s*disc\b|\bbdmv\b", rel_title_str, re.IGNORECASE))
            if is_direct or debrid_ready:
                streamable_tier = 3
            elif st_type == "series":
                streamable_tier = 1 if is_remux else (3 if (0.0 <= size_gb <= 24.0 and seeds >= 10) else 2)
            else:
                if not is_remux and 0.4 <= size_gb <= 18.5 and seeds >= 8:
                    streamable_tier = 3
                elif not is_remux and 0.0 <= size_gb <= 28.5:
                    streamable_tier = 2
                elif 0.0 <= size_gb <= 45.0:
                    streamable_tier = 1
                else:
                    streamable_tier = 0
            q_rank_val = int(s.get("quality_rank") or 0)
            quality_tier = 3 if q_rank_val >= 300 else (2 if q_rank_val >= 180 else (1 if q_rank_val >= 135 else 0))
            trk_low = f"{s.get('tracker') or ''} {s.get('addon_name') or ''}".lower()
            is_public_dht_tracker = any(
                k in trk_low
                for k in ("rutor", "rutracker", "torrentio", "tpb", "piratebay", "bitsearch", "1337x", "eztv", "yts", "nyaa")
            )
            if is_direct or debrid_ready:
                dht_swarm_tier = 3
            elif seeds >= 25 or (seeds >= 12 and is_public_dht_tracker):
                dht_swarm_tier = 2
            elif seeds >= 5:
                dht_swarm_tier = 1
            else:
                dht_swarm_tier = 0
            p2p_realtime_viable = (
                1
                if (
                    is_direct
                    or debrid_ready
                    or (streamable_tier >= 2 and seeds >= 8)
                    or seeds >= 25
                )
                else 0
            )
            return (
                is_direct,
                healthy,
                single_movie_tier,
                lang_pref,
                p2p_realtime_viable,
                quality_tier,
                streamable_tier,
                dht_swarm_tier,
                min(seeds, 50) // 10,
                q_rank_val,
                seeds,
            )

        sorted_streams = sorted(
            deduped.values(),
            key=_stream_sort_key,
            reverse=True,
        )[:45]
        if (
            not skip_preflight
            and torr_online
            and not debrid_ready
            and sorted_streams
            and hasattr(self.backup_engine, "preflight_rank_torrserver_candidates")
        ):
            sorted_streams = self.backup_engine.preflight_rank_torrserver_candidates(
                sorted_streams,
                _stream_sort_key,
                max_probe=5,
                wait_sec=3.5,
            )

        result = {
            "ok": True,
            "imdb_id": imdb_id,
            "video_id": video_id,
            "streams": sorted_streams,
            "subtitles": all_subs,
            "seasons_map": series_meta.get("seasons_map", {}),
            "episodes_titles": series_meta.get("episodes_titles", {}),
            "episodes_meta": series_meta.get("episodes_meta", {}),
            "latest_season": series_meta.get("latest_season", season),
            "latest_episode": series_meta.get("latest_episode", episode),
            "p2p_strict": p2p_strict,
            "torrserver_connected": torr_online,
            "debrid_ready": debrid_ready,
            "mode": self.backup_engine.mode,
            "torrserver_url": self.backup_engine.torrserver_url,
            "addons": self.get_addons(),
        }
        if sorted_streams and not skip_preflight:
            with self._lock:
                if len(self._streams_cache) >= 40:
                    for k_old in list(self._streams_cache.keys())[:10]:
                        self._streams_cache.pop(k_old, None)
                self._streams_cache[cache_key] = (now, dict(result))
        return dict(result)

    def get_subtitles_only(
        self,
        item_id: str = "",
        title: str = "",
        orig_title: str = "",
        year: int = 2024,
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        lang: str = "ru",
        imdb_id: str = "",
    ) -> List[Dict[str, Any]]:
        """
        Fetches external Stremio subtitles (OpenSubtitles v3) for a title/episode without
        waiting on torrent stream scrapers. Used by `/api/backup-streams` and `/api/hdrezka/streams`.
        """
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        st_type = "series" if media_type == "series" else "movie"
        raw_imdb = str(imdb_id or "").strip()
        resolved_imdb = (
            raw_imdb
            if _IMDB_ID_RE.match(raw_imdb)
            else self.resolve_imdb_id(
                item_id=item_id or raw_imdb,
                title=title,
                orig_title=orig_title,
                year=year,
                media_type=st_type,
            )
        )
        if not resolved_imdb:
            return []
        video_id = (
            f"{resolved_imdb}:{max(1, _safe_stremio_int(season, 1))}:{max(1, _safe_stremio_int(episode, 1))}"
            if st_type == "series"
            else resolved_imdb
        )
        cache_key = f"subs:{st_type}:{video_id}:{ui_lang}"
        now = time.time()
        with self._lock:
            subs_cache = getattr(self, "_subs_only_cache", None)
            if subs_cache is None:
                self._subs_only_cache = {}
                subs_cache = self._subs_only_cache
            cached = subs_cache.get(cache_key)
            if cached and (now - cached[0]) < 900:
                return copy.deepcopy(cached[1])
            full_cached = self._streams_cache.get(f"{st_type}:{video_id}:{ui_lang}")
            if full_cached and (now - full_cached[0]) < 600:
                subs_list = full_cached[1].get("subtitles") or []
                subs_cache[cache_key] = (now, subs_list)
                return copy.deepcopy(subs_list)

        sub_addons = [
            a
            for a in self.get_addons()
            if a.get("enabled")
            and st_type in (a.get("types") or ["movie", "series"])
            and "subtitles" in (a.get("resources") or [])
        ]
        if not sub_addons:
            return []

        all_subs: List[Dict[str, Any]] = []
        pool = getattr(self, "_addon_executor", None) or concurrent.futures.ThreadPoolExecutor(max_workers=6)
        self._addon_executor = pool
        futs = [pool.submit(self._fetch_addon_subtitles, a, st_type, video_id, ui_lang) for a in sub_addons]
        for f in futs:
            try:
                all_subs.extend(f.result(timeout=4.5) or [])
            except Exception:
                pass
        if all_subs:
            with self._lock:
                if len(self._subs_only_cache) >= 60:
                    for k_old in list(self._subs_only_cache.keys())[:15]:
                        self._subs_only_cache.pop(k_old, None)
                self._subs_only_cache[cache_key] = (now, copy.deepcopy(all_subs))
        return all_subs

    def resolve_stream_to_playable_url(
        self,
        magnet: str,
        filename_hint: str = "",
        file_idx: Optional[int] = None,
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        lang: str = "ru",
        year: int = 0,
        title: str = "",
        orig_title: str = "",
    ) -> Dict[str, Any]:
        """
        Resolves a Stremio BitTorrent stream (infoHash/magnet) into a direct playable HTTP stream
        via Cloud Debrid (if configured) or built-in TorrServer with exact episode filename matching.
        """
        is_en = str(lang or "").strip().lower().startswith("en")
        s_clean = max(1, _safe_stremio_int(season, 1))
        e_clean = max(1, _safe_stremio_int(episode, 1))
        enriched_magnet = _enrich_magnet_trackers(magnet)
        if not enriched_magnet:
            return {
                "ok": False,
                "error": "Missing stream magnet link" if is_en else "Отсутствует magnet-ссылка потока",
            }

        debrid_err = ""
        if self.backup_engine.debrid_api_key and self.backup_engine.mode in (
            "realdebrid",
            "torbox",
            "debrid_https",
        ):
            d_res = self.backup_engine.resolve_debrid_magnet(
                enriched_magnet,
                media_type=media_type,
                season=s_clean,
                episode=e_clean,
                lang=lang,
                year=year,
                title=title,
                orig_title=orig_title,
            )
            d_url = str(d_res.get("stream_url") or "").strip()
            if d_res.get("ok") and d_url and self.is_safe_public_http_url(d_url):
                return {"ok": True, "stream_url": d_url, "via": self.backup_engine.mode}
            debrid_err = str(d_res.get("error") or "").strip()

        if not self.backup_engine.ensure_local_torrserver():
            if debrid_err:
                return {"ok": False, "error": debrid_err}
            if getattr(self.backup_engine.net, "p2p_strict", False) and self.backup_engine.mode != "torrserver":
                return {
                    "ok": False,
                    "error": (
                        "Direct BitTorrent P2P is disabled by your country privacy profile — connect a Real-Debrid / TorBox (HTTPS) key or switch mode in Settings"
                        if is_en
                        else (
                            "Прямой BitTorrent P2P отключён профилем безопасности выбранной страны — "
                            "подключите ключ Real-Debrid / TorBox (HTTPS) или переключите режим в настройках"
                        )
                    ),
                }
            return {
                "ok": False,
                "error": (
                    "Built-in TorrServer is unavailable — check network settings or configure a Debrid key"
                    if is_en
                    else "Встроенный TorrServer недоступен — проверьте настройки сети или укажите ключ Debrid"
                ),
            }

        torr_idx = 1
        hint_base = os.path.basename(filename_hint.replace("\\", "/")).strip().lower() if filename_hint else ""
        ih_m = re.search(r"btih:([A-Fa-f0-9]{40})", enriched_magnet)
        self.backup_engine._drop_other_active_torrents(
            {ih_m.group(1).lower()} if ih_m else set()
        )
        fstats = self.backup_engine._fetch_torrserver_file_stats(enriched_magnet, wait_metadata_sec=4.5)
        if not fstats:
            return {
                "ok": False,
                "dead_swarm": True,
                "error": (
                    "No active DHT peers found for this Stremio stream — switching to next stream"
                    if is_en
                    else "Нет активных пиров DHT для этого потока Stremio — переключаем на следующую раздачу"
                ),
            }

        video_files_out: List[Dict[str, Any]] = []
        if fstats:
            main_files = self.backup_engine._filter_main_video_files(fstats, "path", "length")
            main_files_sorted = sorted(main_files, key=lambda x: str(x.get("path") or "").lower())
            for idx_pos, vf in enumerate(main_files_sorted):
                fid = int(vf.get("id") or (idx_pos + 1))
                raw_path = str(vf.get("path") or f"file_{fid}.mkv")
                base_name = raw_path.replace("\\", "/").split("/")[-1] or raw_path
                f_bytes = int(vf.get("length") or 0)
                det_ep = (
                    self.backup_engine._detect_episode_in_path(raw_path, season=s_clean)
                    if media_type == "series"
                    else None
                )
                video_files_out.append(
                    {
                        "id": fid,
                        "name": base_name,
                        "path": raw_path,
                        "bytes": f_bytes,
                        "size": self.backup_engine._format_file_bytes(f_bytes, is_en=is_en),
                        "episode": det_ep,
                    }
                )

            video_exts = (".mkv", ".mp4", ".ts", ".m2ts", ".avi", ".mov", ".webm")
            matched_id: Optional[int] = None
            if hint_base:
                for f in fstats:
                    p_low = os.path.basename(str(f.get("path") or "").replace("\\", "/")).strip().lower()
                    if p_low == hint_base:
                        matched_id = int(f.get("id") or 1)
                        break
            if matched_id is None and media_type == "series":
                matched_id = self.backup_engine._match_episode_from_files(
                    fstats,
                    "path",
                    "id",
                    "length",
                    media_type,
                    s_clean,
                    e_clean,
                    year=year,
                    title=title,
                    orig_title=orig_title,
                )
            if matched_id is None and isinstance(file_idx, int) and 0 <= file_idx < len(fstats):
                cand_path = str(fstats[file_idx].get("path") or "").lower()
                if cand_path.endswith(video_exts):
                    matched_id = int(fstats[file_idx].get("id") or (file_idx + 1))
            if matched_id is None and media_type != "series" and len(main_files) > 1:
                matched_id = self.backup_engine._match_episode_from_files(
                    fstats,
                    "path",
                    "id",
                    "length",
                    media_type,
                    s_clean,
                    e_clean,
                    year=year,
                    title=title,
                    orig_title=orig_title,
                )
            if matched_id is None:
                vfiles = main_files or [
                    f for f in fstats if str(f.get("path") or "").lower().endswith(video_exts)
                ] or fstats
                largest = max(vfiles, key=lambda x: int(x.get("length") or 0))
                matched_id = int(largest.get("id") or 1)
            torr_idx = matched_id
        elif media_type == "series" and isinstance(file_idx, int) and file_idx >= 0:
            torr_idx = file_idx + 1

        chosen_file_obj = next((f for f in video_files_out if int(f["id"]) == torr_idx), None)
        fname_raw = (
            (chosen_file_obj["name"] if chosen_file_obj else "")
            or (os.path.basename(filename_hint.replace("\\", "/")).strip() if filename_hint else "")
            or "fname"
        )
        fname_seg = urllib.parse.quote(fname_raw)
        stream_url = (
            f"{self.backup_engine.torrserver_url}/stream/{fname_seg}"
            f"?link={urllib.parse.quote(enriched_magnet)}&index={torr_idx}&play"
        )
        return {
            "ok": True,
            "stream_url": stream_url,
            "via": "torrserver",
            "torr_index": torr_idx,
            "video_files": video_files_out,
        }

    def resolve_original_audio_fallback(
        self,
        item_id: str = "",
        title: str = "",
        orig_title: str = "",
        year: int = 2024,
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        remux_engine: Any = None,
        lang: str = "ru",
        imdb_id: str = "",
    ) -> Optional[Dict[str, Any]]:
        """
        Fallback when HDRezka marks Original (+subtitles) as b-prem_translator AND JacRed has no match
        (e.g. brand-new 2026 international releases). Uses Stremio addons + TorrServer/Debrid + Remuxer.
        """
        if not remux_engine or not remux_engine.is_available():
            return None
        eff_item_id = str(item_id or imdb_id or "").strip()
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        st_data = self.get_streams_for_title(
            item_id=eff_item_id,
            title=title,
            orig_title=orig_title,
            year=year,
            media_type=media_type,
            season=season,
            episode=episode,
            lang="en",
        )
        raw_streams = st_data.get("streams") or []
        if not raw_streams:
            return None

        # Prefer fast-starting 1080p/720p English releases with healthy seeders
        candidates = sorted(
            [
                s
                for s in raw_streams
                if s.get("stream_kind") == "direct_http" or int(s.get("seeders") or 0) >= 3
            ],
            key=lambda s: (
                1 if s.get("stream_kind") == "direct_http" else 0,
                1 if "1080p" in str(s.get("quality") or "").lower() else (
                    0 if "720p" in str(s.get("quality") or "").lower() else -1
                ),
                2
                if (
                    ((s.get("languages") or []) == ["EN"] or ((s.get("languages") or [""])[0] == "EN"))
                    and not s.get("has_russian")
                )
                else (1 if ("EN" in (s.get("languages") or []) or not s.get("has_russian")) else 0),
                min(int(s.get("seeders") or 0), 80),
            ),
            reverse=True,
        )

        addon_subs = st_data.get("subtitles") or []
        if ui_lang == "ru":
            # Ensure Russian OpenSubtitles appear first when UI language is Russian
            addon_subs = sorted(
                addon_subs,
                key=lambda sub: 0 if "рус" in str(sub.get("lang") or "").lower() or "russian" in str(sub.get("lang") or "").lower() else 1,
            )

        for cand in candidates[:3]:
            raw_stream_url = str(cand.get("direct_url") or "").strip()
            if not raw_stream_url and cand.get("magnet"):
                res_play = self.resolve_stream_to_playable_url(
                    magnet=str(cand["magnet"]),
                    filename_hint=str(cand.get("filename_hint") or ""),
                    file_idx=cand.get("file_idx"),
                    media_type=media_type,
                    season=season,
                    episode=episode,
                    year=year,
                    title=title,
                    orig_title=orig_title,
                )
                if res_play.get("ok") and res_play.get("stream_url"):
                    raw_stream_url = str(res_play["stream_url"])
            if not raw_stream_url:
                continue

            probe = remux_engine.probe_media(raw_stream_url, timeout_sec=11.0, fast_probe=True, lang=ui_lang)
            if not probe.get("ok"):
                continue

            audio_tracks = probe.get("audio_tracks") or []
            if hasattr(remux_engine, "_select_default_audio_index"):
                audio_idx = int(remux_engine._select_default_audio_index(audio_tracks, ui_lang="en") or 0)
            else:
                audio_idx = int(probe.get("default_audio_index") or 0)
            orig_track = next(
                (tr for tr in audio_tracks if int(tr.get("audio_index") or 0) == audio_idx),
                audio_tracks[0] if audio_tracks else {"channels": 2},
            )
            orig_lang = str(orig_track.get("lang") or "").strip().lower()
            orig_lbl = str(orig_track.get("label") or orig_track.get("title") or "").strip().lower()
            if orig_lang in ("rus", "ru", "ukr", "uk") or (
                not orig_lang and any(w in orig_lbl for w in ("рус", "дубляж", "russian"))
            ):
                continue
            vcodec = str(probe.get("video_codec") or "")
            acodec = str(orig_track.get("codec") or orig_track.get("codec_name") or "").strip().lower()
            channels = int(orig_track.get("channels") or 2)
            remux_qs = urllib.parse.urlencode(
                {
                    "src": raw_stream_url,
                    "audio": str(audio_idx),
                    "start": "0",
                    "vcodec": vcodec,
                    "acodec": acodec,
                    "ch": str(channels),
                }
            )
            remux_play_url = f"/api/remux-stream?{remux_qs}"
            subs_out: List[Dict[str, Any]] = []
            for st in (probe.get("subtitle_tracks") or []):
                sub_qs = urllib.parse.urlencode(
                    {
                        "src": raw_stream_url,
                        "si": str(st.get("stream_index") or 0),
                        "ss": "0",
                        "dur": "420",
                    }
                )
                subs_out.append(
                    {
                        "lang": st.get("label") or ("Subtitles" if ui_lang == "en" else "Субтитры"),
                        "url": f"/api/remux-subtitle?{sub_qs}",
                        "direct_vtt": True,
                    }
                )
            subs_out.extend(addon_subs)
            qual_label = "1080p" if "1080" in str(cand.get("quality") or "") else str(cand.get("quality") or "1080p")
            return {
                "qualities": {qual_label: remux_play_url},
                "default_quality": qual_label,
                "default_stream_url": remux_play_url,
                "subtitles": subs_out,
                "remux_session": {
                    "rawSourceUrl": raw_stream_url,
                    "duration": float(probe.get("duration") or 0.0),
                    "creditsStartSec": float(probe.get("credits_start_sec") or 0.0),
                    "audioIndex": audio_idx,
                    "videoCodec": vcodec,
                    "audioCodec": acodec,
                    "channels": channels,
                    "audioTracks": audio_tracks,
                    "subtitleTracks": probe.get("subtitle_tracks") or [],
                },
            }
        return None
