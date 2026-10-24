import concurrent.futures
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from .backup_stream import _PUBLIC_TRACKERS_SUFFIX, _enrich_magnet_trackers
from .kinorium import _norm_title

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
    ("Дубляж", ("дубляж", "dub", "нефафильм", "невафильм", "пифагор", "red head sound", "rhs")),
    ("HDRezka", ("hdrezka", "резка", "rezka")),
    ("TVShows", ("tvshows",)),
    ("LostFilm", ("lostfilm", "лостфильм")),
    ("Jaskier", ("jaskier", "яскьер")),
    ("Кубик в Кубе", ("кубик", "kubik")),
    ("AlexFilm", ("alexfilm",)),
    ("NewStudio", ("newstudio",)),
]


def _clean_no_emoji(text: str) -> str:
    if not text:
        return ""
    cleaned = _EMOJI_STRIP_RE.sub(" ", text)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    return cleaned.strip(" \t\r\n·|/-")


def convert_srt_or_vtt_to_webvtt(raw_text: str, offset_sec: float = 0.0) -> str:
    """
    Converts SRT or WebVTT text into valid WebVTT and optionally shifts all cue
    timestamps by -offset_sec (used when seeking in FFmpeg Remux streams).
    """
    if not raw_text:
        return "WEBVTT\n\n"
    text = raw_text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")

    time_re = re.compile(
        r"(?:(\d{1,2}):)?(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})[,.](\d{3})(.*)"
    )

    def _to_sec(h_s: Optional[str], m_s: str, s_s: str, ms_s: str) -> float:
        h = int(h_s) if h_s else 0
        return h * 3600.0 + int(m_s) * 60.0 + int(s_s) + int(ms_s) / 1000.0

    def _fmt_vtt_ts(sec: float) -> str:
        sec = max(0.0, sec)
        total_ms = int(round(sec * 1000))
        hrs, rem = divmod(total_ms, 3600_000)
        mins, rem = divmod(rem, 60_000)
        secs, ms = divmod(rem, 1000)
        return f"{hrs:02d}:{mins:02d}:{secs:02d}.{ms:03d}"

    blocks = re.split(r"\n{2,}", text.strip())
    out_cues: List[str] = []
    shift = max(0.0, float(offset_sec or 0.0))

    for blk in blocks:
        lines = [ln.strip() for ln in blk.split("\n") if ln.strip()]
        if not lines:
            continue
        if lines[0].upper().startswith("WEBVTT") or lines[0].upper().startswith("NOTE"):
            continue
        ts_idx = -1
        m_ts = None
        for idx, ln in enumerate(lines[:3]):
            m = time_re.match(ln)
            if m:
                ts_idx = idx
                m_ts = m
                break
        if ts_idx < 0 or not m_ts:
            continue
        start_s = _to_sec(m_ts.group(1), m_ts.group(2), m_ts.group(3), m_ts.group(4)) - shift
        end_s = _to_sec(m_ts.group(5), m_ts.group(6), m_ts.group(7), m_ts.group(8)) - shift
        extra_settings = m_ts.group(9) or ""
        if end_s <= 0.05:
            continue
        start_s = max(0.0, start_s)
        payload_lines = lines[ts_idx + 1 :]
        if not payload_lines:
            continue
        out_cues.append(f"{_fmt_vtt_ts(start_s)} --> {_fmt_vtt_ts(end_s)}{extra_settings}\n" + "\n".join(payload_lines))

    return "WEBVTT\n\n" + "\n\n".join(out_cues) + "\n"


class StremioAddonEngine:
    """
    Native Stremio Addon Protocol Client for CineFlow:
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
        self.addons: List[Dict[str, Any]] = []
        self._imdb_cache: Dict[str, str] = {}
        self._cinemeta_meta_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._streams_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._load_state()

    def _load_state(self) -> None:
        loaded_addons: List[Dict[str, Any]] = []
        if os.path.isfile(self.addons_path):
            try:
                with open(self.addons_path, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                if isinstance(raw, list):
                    loaded_addons = [a for a in raw if isinstance(a, dict) and a.get("manifest_url")]
            except Exception:
                loaded_addons = []

        if not loaded_addons:
            loaded_addons = [dict(a) for a in self.DEFAULT_ADDONS]
        else:
            existing_urls = {str(a.get("manifest_url") or "").rstrip("/") for a in loaded_addons}
            for d_add in self.DEFAULT_ADDONS:
                if d_add["manifest_url"].rstrip("/") not in existing_urls:
                    loaded_addons.append(dict(d_add))

        self.addons = loaded_addons

        if os.path.isfile(self.imdb_cache_path):
            try:
                with open(self.imdb_cache_path, "r", encoding="utf-8") as f:
                    raw_c = json.load(f)
                if isinstance(raw_c, dict):
                    self._imdb_cache = {str(k): str(v) for k, v in raw_c.items() if str(v).startswith("tt")}
            except Exception:
                self._imdb_cache = {}

    def _save_addons(self) -> None:
        try:
            os.makedirs(self.data_dir, exist_ok=True)
            tmp = self.addons_path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.addons, f, ensure_ascii=False, indent=2)
            os.replace(tmp, self.addons_path)
        except Exception:
            pass

    def _save_imdb_cache(self) -> None:
        try:
            os.makedirs(self.data_dir, exist_ok=True)
            tmp = self.imdb_cache_path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._imdb_cache, f, ensure_ascii=False, indent=2)
            os.replace(tmp, self.imdb_cache_path)
        except Exception:
            pass

    def _http_get_json(self, url: str, timeout: float = 7.5) -> Optional[Dict[str, Any]]:
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": self.UA,
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status != 200:
                    return None
                raw = resp.read().decode("utf-8", errors="replace")
                data = json.loads(raw)
                return data if isinstance(data, dict) else None
        except Exception:
            return None

    def get_addons(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [dict(a) for a in self.addons]

    @staticmethod
    def normalize_manifest_url(raw_url: str) -> str:
        u = (raw_url or "").strip()
        if not u:
            return ""
        if u.lower().startswith("stremio://"):
            u = "https://" + u[len("stremio://") :]
        elif not re.match(r"^https?://", u, re.I):
            u = "https://" + u
        parsed = urllib.parse.urlparse(u)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return ""
        path = parsed.path or ""
        if not path.endswith("/manifest.json"):
            path = path.rstrip("/") + "/manifest.json"
        return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, path, "", parsed.query, ""))

    def add_addon_by_url(self, raw_url: str) -> Dict[str, Any]:
        manifest_url = self.normalize_manifest_url(raw_url)
        if not manifest_url:
            return {"ok": False, "error": "Укажите корректную ссылку manifest.json или stremio://"}

        manifest = self._http_get_json(manifest_url, timeout=9.0)
        if not manifest or not manifest.get("id") or not manifest.get("name"):
            return {"ok": False, "error": "Не удалось загрузить manifest.json по указанному адресу"}

        raw_res = manifest.get("resources") or []
        res_names: List[str] = []
        for r in raw_res:
            if isinstance(r, str):
                res_names.append(r)
            elif isinstance(r, dict) and r.get("name"):
                res_names.append(str(r["name"]))
        if not any(rn in ("stream", "subtitles", "catalog", "meta") for rn in res_names):
            return {"ok": False, "error": "Этот аддон не предоставляет потоки или субтитры"}

        base_url = re.sub(r"/manifest\.json(?:\?.*)?$", "", manifest_url)
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
        valid = [
            a
            for a in addons_list
            if isinstance(a, dict) and a.get("manifest_url") and a.get("base_url")
        ]
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
        cache_key = f"{stremio_type}:{_norm_title(orig_title or title)}:{year or 0}"
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
        target_year = int(year or 0)
        norm_orig = _norm_title(orig_title) if orig_title else ""
        norm_ru = _norm_title(title) if title else ""

        for q in queries:
            enc_q = urllib.parse.quote(q)
            url = f"{self.CINEMETA_BASE}/catalog/{stremio_type}/top/search={enc_q}.json"
            data = self._http_get_json(url, timeout=6.0)
            metas = (data or {}).get("metas") or []
            for m in metas[:12]:
                cand_id = str(m.get("id") or m.get("imdb_id") or "")
                if not re.match(r"^tt\d{5,10}$", cand_id):
                    continue
                cand_name = _norm_title(str(m.get("name") or ""))
                rel_info = str(m.get("releaseInfo") or m.get("year") or "")
                m_yr = re.search(r"((?:19|20)\d{2})", rel_info)
                cand_year = int(m_yr.group(1)) if m_yr else 0

                score = 0
                if norm_orig and cand_name == norm_orig:
                    score += 60
                elif norm_ru and cand_name == norm_ru:
                    score += 55
                elif norm_orig and (norm_orig in cand_name or cand_name in norm_orig):
                    score += 30
                elif norm_ru and (norm_ru in cand_name or cand_name in norm_ru):
                    score += 25

                if target_year and cand_year:
                    diff = abs(target_year - cand_year)
                    if diff == 0:
                        score += 35
                    elif diff == 1:
                        score += 20
                    elif diff > 3:
                        score -= 40

                if score > best_score:
                    best_score = score
                    best_tt = cand_id
            if best_score >= 75 and best_tt:
                break

        if best_tt and best_score >= 25:
            with self._lock:
                self._imdb_cache[cache_key] = best_tt
                self._save_imdb_cache()
            return best_tt
        return ""

    def fetch_cinemeta_series_meta(self, imdb_id: str) -> Dict[str, Any]:
        if not imdb_id:
            return {}
        now = time.time()
        with self._lock:
            cached = self._cinemeta_meta_cache.get(imdb_id)
            if cached and now - cached[0] < 1800:
                return cached[1]

        data = self._http_get_json(f"{self.CINEMETA_BASE}/meta/series/{imdb_id}.json", timeout=6.5)
        meta = (data or {}).get("meta") or {}
        videos = meta.get("videos") or []
        seasons_map: Dict[str, List[int]] = {}
        episodes_titles: Dict[str, str] = {}
        episodes_meta: Dict[str, Dict[str, str]] = {}
        latest_season = 1
        latest_episode = 1

        now_iso = time.strftime("%Y-%m-%d")
        for v in videos:
            if not isinstance(v, dict):
                continue
            s_num = int(v.get("season") or 0)
            e_num = int(v.get("episode") or v.get("number") or 0)
            if s_num <= 0 or e_num <= 0:
                continue
            released = str(v.get("released") or "")[:10]
            s_key = str(s_num)
            seasons_map.setdefault(s_key, [])
            if e_num not in seasons_map[s_key]:
                seasons_map[s_key].append(e_num)
            ep_title = _clean_no_emoji(str(v.get("name") or v.get("title") or ""))
            ep_key = f"s{s_num}e{e_num}"
            if ep_title and not re.match(r"^Episode\s+\d+$", ep_title, re.I):
                episodes_titles[ep_key] = ep_title
            episodes_meta[ep_key] = {
                "title": episodes_titles.get(ep_key, ""),
                "air_date": released,
            }
            if not released or released <= now_iso:
                if (s_num, e_num) > (latest_season, latest_episode):
                    latest_season, latest_episode = s_num, e_num

        for s_key in seasons_map:
            seasons_map[s_key].sort()

        parsed = {
            "seasons_map": seasons_map,
            "episodes_titles": episodes_titles,
            "episodes_meta": episodes_meta,
            "latest_season": latest_season,
            "latest_episode": latest_episode,
        }
        with self._lock:
            self._cinemeta_meta_cache[imdb_id] = (now, parsed)
        return parsed

    def search_cinemeta(self, query: str, media_type_filter: str = "all") -> List[Dict[str, Any]]:
        q_clean = (query or "").strip()
        if len(q_clean) < 2:
            return []
        types_to_query = ["movie", "series"] if media_type_filter == "all" else [media_type_filter]
        results: List[Dict[str, Any]] = []
        seen_ids = set()

        for mtype in types_to_query:
            st_type = "series" if mtype == "series" else "movie"
            url = f"{self.CINEMETA_BASE}/catalog/{st_type}/top/search={urllib.parse.quote(q_clean)}.json"
            data = self._http_get_json(url, timeout=4.5)
            for m in ((data or {}).get("metas") or [])[:8]:
                tt_id = str(m.get("id") or "")
                if not tt_id.startswith("tt") or tt_id in seen_ids:
                    continue
                name = _clean_no_emoji(str(m.get("name") or ""))
                poster = str(m.get("poster") or "")
                if not name or not poster:
                    continue
                seen_ids.add(tt_id)
                rel_info = str(m.get("releaseInfo") or m.get("year") or "2024")
                m_yr = re.search(r"((?:19|20)\d{2})", rel_info)
                yr = int(m_yr.group(1)) if m_yr else 2024
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
    ) -> Optional[Dict[str, Any]]:
        if not isinstance(raw_st, dict):
            return None
        direct_url = str(raw_st.get("url") or "").strip()
        info_hash = str(raw_st.get("infoHash") or "").strip().lower()
        if not direct_url and not re.match(r"^[0-9a-f]{40}$", info_hash):
            return None

        raw_name = str(raw_st.get("name") or "")
        raw_title = str(raw_st.get("title") or raw_st.get("description") or "")
        combined = f"{raw_name}\n{raw_title}"
        comb_low = combined.lower()

        if any(bad in comb_low for bad in ("camrip", "hdcam", "telesync", "telecine", "ts-rip")):
            return None

        # Extract seeders before stripping emojis
        seeders = 0
        m_seed = re.search("\U0001F464\\s*(\\d+)", combined) or re.search(
            r"(?:seeders|сиды)[:\s]+(\d+)", comb_low
        )
        if m_seed:
            seeders = int(m_seed.group(1))

        # Extract size
        size_label = ""
        m_size = re.search(
            "\U0001F4BE\\s*([\\d.,]+\\s*(?:GB|MB|TB|ГБ|МБ))", combined, re.I
        ) or re.search(r"\b([\d.,]+\s*(?:GB|MB|TB|ГБ|МБ))\b", combined, re.I)
        if m_size:
            size_label = (
                m_size.group(1)
                .upper()
                .replace("GB", "ГБ")
                .replace("MB", "МБ")
                .replace("TB", "ТБ")
            )

        # Extract tracker / source
        tracker = ""
        m_trk = re.search("\u2699(?:\uFE0F)?\\s*([^\n\U0001F464\U0001F4BE\U0001F1E6-\U0001F1FF]+)", combined)
        if m_trk:
            tracker = _clean_no_emoji(m_trk.group(1))[:32]

        # Extract flag languages & voiceovers
        langs: List[str] = []
        for flag, code in _FLAG_LANG_MAP.items():
            if flag in combined and code not in langs:
                langs.append(code)

        has_ru_text = bool(
            re.search(r"[а-яё]{3,}", comb_low)
            or any(k in comb_low for _, kws in _VOICE_KEYWORDS for k in kws)
            or "rus" in comb_low
        )
        if has_ru_text and "RU" not in langs:
            langs.insert(0, "RU")

        has_orig = bool(
            "EN" in langs
            or any(k in comb_low for k in ("original", "оригинал", "eng", "multi", "sub", "dl", "bluray", "webrip"))
        )
        if has_orig and "EN" not in langs and "RU" not in langs:
            langs.append("EN")

        detected_voices: List[str] = []
        for v_label, kws in _VOICE_KEYWORDS:
            if any(k in comb_low for k in kws):
                detected_voices.append(v_label)

        # Quality classification
        q_rank = 100
        quality = "1080p"
        if "2160p" in comb_low or "4k" in comb_low or "uhd" in comb_low:
            if "dv" in comb_low or "dolby vision" in comb_low:
                quality = "4K DV HDR"
                q_rank = 420
            elif "hdr" in comb_low:
                quality = "4K HDR"
                q_rank = 400
            else:
                quality = "4K UHD"
                q_rank = 380
        elif "remux" in comb_low:
            quality = "1080p Remux"
            q_rank = 300
        elif "1080p" in comb_low:
            quality = "1080p"
            q_rank = 240
        elif "720p" in comb_low:
            quality = "720p"
            q_rank = 140

        title_lines = [_clean_no_emoji(ln) for ln in raw_title.splitlines() if _clean_no_emoji(ln)]
        clean_release_title = title_lines[0] if title_lines else _clean_no_emoji(raw_name) or "Поток Stremio"
        clean_release_title = re.sub(r"\s+", " ", clean_release_title).strip()

        hints = raw_st.get("behaviorHints") if isinstance(raw_st.get("behaviorHints"), dict) else {}
        filename_hint = str(hints.get("filename") or "")

        file_idx_raw = raw_st.get("fileIdx")
        file_idx: Optional[int] = None
        if isinstance(file_idx_raw, int) and file_idx_raw >= 0:
            file_idx = file_idx_raw

        magnet = ""
        if info_hash:
            dn_part = f"&dn={urllib.parse.quote(filename_hint or clean_release_title[:90])}"
            extra_tr = ""
            for src_entry in raw_st.get("sources") or []:
                if isinstance(src_entry, str) and src_entry.startswith("tracker:"):
                    tr_url = src_entry[len("tracker:") :].strip()
                    if tr_url.startswith(("udp://", "http://", "https://")):
                        extra_tr += f"&tr={urllib.parse.quote(tr_url, safe='')}"
            magnet = f"magnet:?xt=urn:btih:{info_hash}{dn_part}{extra_tr}{_PUBLIC_TRACKERS_SUFFIX}"

        is_cached_http = bool(direct_url and direct_url.startswith(("http://", "https://")))
        has_ru = "RU" in langs

        voice_parts: List[str] = []
        if has_ru and "EN" in langs:
            voice_parts.append("RU + Оригинал")
        elif has_ru:
            voice_parts.append("Русская дорожка")
        else:
            voice_parts.append("Оригинал")
        if detected_voices:
            voice_parts.append(", ".join(detected_voices[:3]))

        addon_short = _clean_no_emoji(raw_name.splitlines()[0] if raw_name else addon.get("name", "Stremio"))
        if not addon_short:
            addon_short = addon.get("name", "Stremio")

        return {
            "stream_id": f"{info_hash or urllib.parse.quote(direct_url[-36:])}_{file_idx if file_idx is not None else 'auto'}",
            "title": clean_release_title,
            "addon_name": addon.get("name", "Stremio"),
            "addon_badge": addon_short[:28],
            "quality": quality,
            "quality_rank": q_rank,
            "size": size_label or "Поток",
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

    def _fetch_addon_streams(self, addon: Dict[str, Any], st_type: str, video_id: str) -> List[Dict[str, Any]]:
        base = str(addon.get("base_url") or "").rstrip("/")
        if not base:
            return []
        url = f"{base}/stream/{st_type}/{video_id}.json"
        data = self._http_get_json(url, timeout=7.5)
        raw_list = (data or {}).get("streams") or []
        parsed_out: List[Dict[str, Any]] = []
        for st in raw_list:
            p = self._parse_single_stream(st, addon)
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
        url = f"{base}/subtitles/{st_type}/{video_id}.json"
        data = self._http_get_json(url, timeout=6.5)
        raw_subs = (data or {}).get("subtitles") or []
        grouped: Dict[str, List[Dict[str, Any]]] = {"rus": [], "eng": [], "pol": [], "ukr": []}
        for s in raw_subs:
            if not isinstance(s, dict):
                continue
            sub_url = str(s.get("url") or "").strip()
            lang_raw = str(s.get("lang") or "").strip().lower()
            if not sub_url.startswith(("http://", "https://")):
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
    ) -> Dict[str, Any]:
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        st_type = "series" if media_type == "series" else "movie"
        imdb_id = self.resolve_imdb_id(item_id, title, orig_title, year, st_type)
        torr_online = self.backup_engine.ensure_local_torrserver()
        debrid_ready = bool(
            self.backup_engine.debrid_api_key
            and self.backup_engine.mode in ("realdebrid", "torbox", "debrid_https")
        )

        if not imdb_id:
            return {
                "ok": False,
                "imdb_id": "",
                "streams": [],
                "subtitles": [],
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

        video_id = f"{imdb_id}:{max(1, season)}:{max(1, episode)}" if st_type == "series" else imdb_id
        cache_key = f"{st_type}:{video_id}:{ui_lang}"
        now = time.time()
        with self._lock:
            cached = self._streams_cache.get(cache_key)
        if cached and now - cached[0] < 300:
            payload = dict(cached[1])
            payload["torrserver_connected"] = torr_online
            payload["debrid_ready"] = debrid_ready
            payload["mode"] = self.backup_engine.mode
            return payload

        active_addons = [
            a
            for a in self.get_addons()
            if a.get("enabled") and st_type in (a.get("types") or ["movie", "series"])
        ]
        stream_addons = [a for a in active_addons if "stream" in (a.get("resources") or [])]
        sub_addons = [a for a in active_addons if "subtitles" in (a.get("resources") or [])]

        all_streams: List[Dict[str, Any]] = []
        all_subs: List[Dict[str, Any]] = []
        series_meta: Dict[str, Any] = {}

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            stream_futs = [pool.submit(self._fetch_addon_streams, a, st_type, video_id) for a in stream_addons]
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
            healthy = 1 if (s["stream_kind"] == "direct_http" or int(s.get("seeders") or 0) >= 3) else 0
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
            return (
                is_direct,
                healthy,
                lang_pref,
                min(int(s.get("seeders") or 0), 50) // 10,
                int(s.get("quality_rank") or 0),
                int(s.get("seeders") or 0),
            )

        sorted_streams = sorted(
            deduped.values(),
            key=_stream_sort_key,
            reverse=True,
        )[:45]

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
            "torrserver_connected": torr_online,
            "debrid_ready": debrid_ready,
            "mode": self.backup_engine.mode,
            "torrserver_url": self.backup_engine.torrserver_url,
            "addons": self.get_addons(),
        }
        with self._lock:
            if len(self._streams_cache) >= 40:
                self._streams_cache.clear()
            self._streams_cache[cache_key] = (now, result)
        return result

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
    ) -> List[Dict[str, Any]]:
        """
        Fetches external Stremio subtitles (OpenSubtitles v3) for a title/episode without
        waiting on torrent stream scrapers. Used by `/api/backup-streams` and `/api/hdrezka/streams`.
        """
        ui_lang = "en" if str(lang or "").strip().lower() == "en" else "ru"
        st_type = "series" if media_type == "series" else "movie"
        imdb_id = self.resolve_imdb_id(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            year=year,
            media_type=st_type,
        )
        if not imdb_id:
            return []
        video_id = f"{imdb_id}:{max(1, int(season))}:{max(1, int(episode))}" if st_type == "series" else imdb_id
        cache_key = f"subs:{st_type}:{video_id}:{ui_lang}"
        now = time.time()
        with self._lock:
            subs_cache = getattr(self, "_subs_only_cache", None)
            if subs_cache is None:
                self._subs_only_cache = {}
                subs_cache = self._subs_only_cache
            cached = subs_cache.get(cache_key)
            if cached and (now - cached[0]) < 900:
                return list(cached[1])
            full_cached = self._streams_cache.get(f"{st_type}:{video_id}:{ui_lang}")
            if full_cached and (now - full_cached[0]) < 600:
                subs_list = list(full_cached[1].get("subtitles") or [])
                subs_cache[cache_key] = (now, subs_list)
                return subs_list

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
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, len(sub_addons))) as pool:
            futs = [pool.submit(self._fetch_addon_subtitles, a, st_type, video_id, ui_lang) for a in sub_addons]
            for f in futs:
                try:
                    all_subs.extend(f.result(timeout=4.5) or [])
                except Exception:
                    pass
        with self._lock:
            if len(self._subs_only_cache) >= 60:
                self._subs_only_cache.clear()
            self._subs_only_cache[cache_key] = (now, all_subs)
        return all_subs

    def resolve_stream_to_playable_url(
        self,
        magnet: str,
        filename_hint: str = "",
        file_idx: Optional[int] = None,
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
    ) -> Dict[str, Any]:
        """
        Resolves a Stremio BitTorrent stream (infoHash/magnet) into a direct playable HTTP stream
        via Cloud Debrid (if configured) or built-in TorrServer with exact episode filename matching.
        """
        enriched_magnet = _enrich_magnet_trackers(magnet)
        if not enriched_magnet:
            return {"ok": False, "error": "Отсутствует magnet-ссылка потока"}

        if self.backup_engine.debrid_api_key and self.backup_engine.mode in (
            "realdebrid",
            "torbox",
            "debrid_https",
        ):
            d_res = self.backup_engine.resolve_debrid_magnet(
                enriched_magnet, media_type=media_type, season=season, episode=episode
            )
            if d_res.get("ok") and d_res.get("stream_url"):
                return {"ok": True, "stream_url": d_res["stream_url"], "via": self.backup_engine.mode}

        if not self.backup_engine.ensure_local_torrserver():
            return {
                "ok": False,
                "error": "Встроенный TorrServer недоступен — проверьте настройки сети или укажите ключ Debrid",
            }

        torr_idx = 1
        body = json.dumps({"action": "add", "link": enriched_magnet, "save_to_db": False}).encode("utf-8")
        hint_base = os.path.basename(filename_hint).strip().lower() if filename_hint else ""

        fstats: List[Dict[str, Any]] = []
        deadline = time.time() + 4.5
        while time.time() < deadline:
            try:
                req = urllib.request.Request(
                    f"{self.backup_engine.torrserver_url}/torrents",
                    data=body,
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=3.5) as r:
                    st_data = json.loads(r.read().decode("utf-8", errors="replace"))
                fstats = st_data.get("file_stats") or []
                if fstats:
                    break
            except Exception:
                pass
            time.sleep(0.35)

        if fstats:
            matched_id: Optional[int] = None
            if hint_base:
                for f in fstats:
                    p_low = os.path.basename(str(f.get("path") or "")).strip().lower()
                    if p_low == hint_base:
                        matched_id = int(f.get("id") or 1)
                        break
            if matched_id is None and media_type == "series":
                matched_id = self.backup_engine._resolve_torrserver_file_index(
                    enriched_magnet, media_type, season, episode, wait_metadata_sec=0.2
                )
            if matched_id is None and isinstance(file_idx, int) and 0 <= file_idx < len(fstats):
                # TorrServer file_stats is sorted and 1-indexed
                matched_id = int(fstats[file_idx].get("id") or (file_idx + 1))
            if matched_id is None:
                video_exts = (".mkv", ".mp4", ".ts", ".m2ts", ".avi", ".mov", ".webm")
                vfiles = [f for f in fstats if str(f.get("path") or "").lower().endswith(video_exts)] or fstats
                largest = max(vfiles, key=lambda x: int(x.get("length") or 0))
                matched_id = int(largest.get("id") or 1)
            torr_idx = matched_id

        stream_url = (
            f"{self.backup_engine.torrserver_url}/stream/fname"
            f"?link={urllib.parse.quote(enriched_magnet)}&index={torr_idx}&play"
        )
        return {"ok": True, "stream_url": stream_url, "via": "torrserver", "torr_index": torr_idx}

    def resolve_original_audio_fallback(
        self,
        item_id: str,
        title: str,
        orig_title: str = "",
        year: int = 2024,
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        remux_engine: Any = None,
        lang: str = "ru",
    ) -> Optional[Dict[str, Any]]:
        """
        Fallback when HDRezka marks Original (+subtitles) as b-prem_translator AND JacRed has no match
        (e.g. brand-new 2026 international releases). Uses Stremio addons + TorrServer/Debrid + Remuxer.
        """
        if not remux_engine or not remux_engine.is_available():
            return None
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        st_data = self.get_streams_for_title(
            item_id=item_id,
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
                )
                if res_play.get("ok") and res_play.get("stream_url"):
                    raw_stream_url = str(res_play["stream_url"])
            if not raw_stream_url:
                continue

            probe = remux_engine.probe_media(raw_stream_url, timeout_sec=11.0, fast_probe=True, lang="en")
            if not probe.get("ok"):
                continue

            audio_tracks = probe.get("audio_tracks") or []
            audio_idx = int(probe.get("default_audio_index") or 0)
            orig_track = next(
                (tr for tr in audio_tracks if int(tr.get("audio_index") or 0) == audio_idx),
                audio_tracks[0] if audio_tracks else {"channels": 2},
            )
            vcodec = str(probe.get("video_codec") or "")
            channels = int(orig_track.get("channels") or 2)
            remux_qs = urllib.parse.urlencode(
                {
                    "src": raw_stream_url,
                    "audio": str(audio_idx),
                    "start": "0",
                    "vcodec": vcodec,
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
                        "dur": "5400",
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
                    "audioIndex": audio_idx,
                    "videoCodec": vcodec,
                    "channels": channels,
                    "audioTracks": remux_engine.probe_media(raw_stream_url, timeout_sec=4.0, fast_probe=True, lang=ui_lang).get("audio_tracks") or audio_tracks,
                    "subtitleTracks": probe.get("subtitle_tracks") or [],
                },
            }
        return None
