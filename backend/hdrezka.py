import base64
import copy
import functools
import ipaddress
from concurrent.futures import ThreadPoolExecutor
import html
import json
import re
import time
import threading
import unicodedata
import urllib.parse
import urllib.request
from itertools import product
from typing import Any, Dict, List, Optional, Tuple

from .doh import DoHSplitNetworkClient


_CTRL_CHAR_RE = re.compile(r"[\x00-\x20\x7f]")
_NORM_NON_WORD_RE = re.compile(r"[^\w\s]")
_NORM_MULTI_SPACE_RE = re.compile(r"\s+")


def _safe_int(val: Any, default: int = 0) -> int:
    if val is None or isinstance(val, bool):
        return default
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        return int(val)
    s = str(val).strip()
    if not s:
        return default
    try:
        return int(s)
    except ValueError:
        m = re.search(r"-?\d+", s)
        if m:
            try:
                return int(m.group(0))
            except ValueError:
                pass
        return default


def _read_bounded(resp: Any, limit: int = 2 * 1024 * 1024) -> bytes:
    try:
        return resp.read(limit)
    except TypeError:
        return resp.read()[:limit]


class _RejectedMeta(dict):
    """Empty (falsy) metadata marker: the supplied rezka_url / rezka_id was verified as a WRONG title."""


_REZKA_TRASH_CHARS = ["@", "#", "!", "^", "$"]
_REZKA_TRASH_TOKENS = [
    base64.b64encode("".join(comb).encode("ascii")).decode("ascii")
    for length in (3, 2)
    for comb in product(_REZKA_TRASH_CHARS, repeat=length)
]
_REZKA_TRASH_SET = set(_REZKA_TRASH_TOKENS)
_REZKA_EQ_TOKENS = [tok for tok in _REZKA_TRASH_TOKENS if "=" in tok]
_REZKA_PREFIXED_TRASH = ["//_//" + tok for tok in _REZKA_TRASH_TOKENS]


class HDRezkaClient:
    """
    Live HDRezka Parser, Anubis PoW Solver, Split-Proxy Bypasser, and Stream Extractor.
    Automatically bypasses HDRezka without registration and filters out the 15-second
    'HD REZKA PREMIUM' QR-code stub video (/1/5/3/6/4/2/4/zrkms.mp4) returned on
    unauthenticated '1080p Ultra' tracks, selecting the full-length 1080p stream instead.
    """

    DEFAULT_MIRRORS = [
        "https://hdrezka-home.tv",
        "https://hdrezka.ag",
        "https://rezka.ag",
        "https://hdrezka.me",
    ]

    TRASH_CHARS = list(_REZKA_TRASH_CHARS)
    _TRASH_TOKENS = _REZKA_TRASH_TOKENS
    _TRASH_SET = _REZKA_TRASH_SET
    _EQ_TOKENS = _REZKA_EQ_TOKENS
    _PREFIXED_TRASH = _REZKA_PREFIXED_TRASH

    # Known HDRezka Premium QR-code promo stub filenames/paths served to unauthenticated users on "Ultra"
    PREMIUM_STUB_PATTERNS = (
        "/1/5/3/6/4/2/4/",
        "zrkms.mp4",
        "premium",
    )

    def __init__(self, net_client: DoHSplitNetworkClient):
        self.net = net_client
        self.custom_mirror: str = ""
        self.proxy_url: str = ""
        self.cf_worker_relay: str = ""
        self.spoof_region: str = "KZ"
        self.mirror_priority: List[str] = list(self.DEFAULT_MIRRORS)
        self.preferred_studios: List[str] = [
            "HDrezka Studio",
            "Кубик в Кубе",
            "Red Head Sound",
            "TVShows",
            "Дубляж",
            "LostFilm",
            "Оригинал",
        ]
        self.page_cache: Dict[str, Dict[str, Any]] = {}
        self.trailer_cache: Dict[str, Dict[str, Any]] = {}
        self.search_cache: Dict[str, List[Dict[str, Any]]] = {}
        self._search_cache_ts: Dict[str, float] = {}
        self.person_url_by_name: Dict[str, str] = {}
        self.person_photo_by_name: Dict[str, str] = {}
        self.person_profile_cache: Dict[str, Dict[str, Any]] = {}
        self.subtitles_by_ep_cache: Dict[str, List[Dict[str, str]]] = {}
        self._subtitles_cache_ts: Dict[str, float] = {}
        self._cache_lock = threading.Lock()
        self._mirror_lock = threading.Lock()
        self._cached_mirror_hosts: Optional[set] = None
        self._studio_probe_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="rezka-probe")

    def configure(
        self,
        custom_mirror: Optional[str] = None,
        proxy_url: Optional[str] = None,
        cf_worker_relay: Optional[str] = None,
        spoof_region: Optional[str] = None,
        preferred_studios: Optional[List[str]] = None,
        mirror_priority: Optional[List[str]] = None,
    ):
        with self._mirror_lock:
            self._cached_mirror_hosts = None
            if custom_mirror is not None:
                self.custom_mirror = custom_mirror.strip().rstrip("/")
            if cf_worker_relay is not None:
                self.cf_worker_relay = cf_worker_relay.strip()
            if proxy_url is not None:
                p_clean = proxy_url.strip()
                if p_clean and ("workers.dev" in p_clean.lower() or "?url=" in p_clean.lower()):
                    if not self.cf_worker_relay:
                        self.cf_worker_relay = p_clean
                    self.proxy_url = ""
                else:
                    self.proxy_url = p_clean
            if spoof_region is not None:
                self.spoof_region = spoof_region.strip()
            if preferred_studios is not None:
                self.preferred_studios = list(preferred_studios)
            if mirror_priority is not None and isinstance(mirror_priority, list) and mirror_priority:
                self.mirror_priority = [str(m).strip().rstrip("/") for m in mirror_priority if str(m).strip()]

    def get_mirrors(self) -> List[str]:
        mirrors: List[str] = []
        if self.custom_mirror:
            m = self.custom_mirror
            if not m.startswith("http"):
                m = "https://" + m
            m_clean = m.rstrip("/")
            if self._is_rezka_page_url(m_clean):
                mirrors.append(m_clean)
        with self._mirror_lock:
            prio_snap = list(self.mirror_priority)
        for m in prio_snap:
            if m and m not in mirrors and self._is_rezka_page_url(m):
                mirrors.append(m)
        for m in self.DEFAULT_MIRRORS:
            if m not in mirrors:
                mirrors.append(m)
        return mirrors

    def _promote_working_mirror(self, mirror: str) -> None:
        if not mirror:
            return
        m_clean = mirror.strip().rstrip("/")
        if not self._is_rezka_page_url(m_clean):
            return
        relay = str(getattr(self, "cf_worker_relay", "") or "").strip()
        if relay and m_clean.split("//")[-1].split("/")[0] in relay:
            # Never promote the Cloudflare relay host itself as a HDRezka mirror
            return
        with self._mirror_lock:
            new_order = [m for m in self.mirror_priority if m != m_clean]
            new_order.insert(0, m_clean)
            self.mirror_priority = new_order
            self._cached_mirror_hosts = None

    def _demote_broken_mirror(self, mirror: str) -> None:
        if not mirror:
            return
        m_clean = mirror.strip().rstrip("/")
        with self._mirror_lock:
            if m_clean in self.mirror_priority:
                self.mirror_priority = [m for m in self.mirror_priority if m != m_clean] + [m_clean]
                self._cached_mirror_hosts = None

    @classmethod
    def decode_rezka_stream_bundle(cls, raw_stream: str) -> Dict[str, Any]:
        """
        Parses HDRezka stream string into primary MP4 qualities, backup MP4 mirrors,
        and HLS (.m3u8) fallback manifests while filtering out paid QR-code stubs.
        """
        empty = {"qualities": {}, "backup_qualities": {}, "hls_qualities": {}}
        if not raw_stream or not isinstance(raw_stream, str):
            return empty

        text = raw_stream.strip().replace("\\/", "/")

        if (text.startswith("#h") or text.startswith("#2") or (text.startswith("#") and not text.startswith("[") and "http" not in text[:20])) and "[" not in text[:15]:
            body = re.sub(r"\s+", "", re.sub(r"^#[a-zA-Z0-9]", "", text))
            trash_tokens = cls._TRASH_TOKENS
            trash_set = cls._TRASH_SET
            eq_tokens = cls._EQ_TOKENS
            prefixed_trash = cls._PREFIXED_TRASH
            cleaned = body
            # Step 1: Strip explicit '//_//' + trash_token markers before touching bare Base64
            for _ in range(8):
                prev = cleaned
                for ptok in prefixed_trash:
                    if ptok in cleaned:
                        cleaned = cleaned.replace(ptok, "")
                if cleaned == prev:
                    break
            while "//_//" in cleaned:
                cleaned = "".join(cleaned.split("//_//"))
            cleaned = re.sub(r"\s+", "", cleaned)
            for etok in eq_tokens:
                if etok in cleaned:
                    cleaned = cleaned.replace(etok, "")
            # Step 2: Strip any remaining bare 4-char trash tokens strictly at 4-char Base64 block boundaries
            for _ in range(6):
                blocks = [cleaned[i : i + 4] for i in range(0, len(cleaned), 4)]
                filtered_blocks = [b for b in blocks if b not in trash_set]
                next_cleaned = "".join(filtered_blocks)
                if next_cleaned == cleaned:
                    break
                cleaned = next_cleaned
            cleaned = re.sub(r"\s+", "", cleaned).rstrip("=")
            if "=" in cleaned:
                cleaned = cleaned.replace("=", "")
            rem = len(cleaned) % 4
            if rem == 1:
                cleaned = cleaned[:-1]
            elif rem in (2, 3):
                cleaned += "=" * (4 - rem)
            try:
                text = base64.b64decode(cleaned).decode("utf-8", errors="ignore").replace("\\/", "/")
            except Exception:
                pass

        streams: Dict[str, str] = {}
        backups: Dict[str, List[str]] = {}
        hls_map: Dict[str, str] = {}
        chunks = re.split(r",(?=\[)", text)
        for chunk in chunks:
            m = re.match(r"\[([^\]]+)\](.+)", chunk.strip())
            if not m:
                continue
            raw_quality, urls_str = m.groups()
            clean_quality = re.sub(r"<[^>]+>", "", raw_quality).strip()

            # Skip paid 'Ultra' / '2K' / '4K' tags when they contain HTML <span class="p-info">
            # because HDRezka serves a 15-sec QR code stub on those without a paid account
            if "ultra" in clean_quality.lower() or "<span" in raw_quality.lower():
                continue

            candidates = [
                u.strip()
                for u in urls_str.split(" or ")
                if u.strip().startswith(("http://", "https://"))
                and not _CTRL_CHAR_RE.search(u.strip())
                and not any(pat in u.strip().lower() for pat in cls.PREMIUM_STUB_PATTERNS)
            ]
            if not candidates:
                continue

            mp4_urls = [u for u in candidates if not u.endswith(".m3u8") and ":hls:" not in u]
            m3u8_urls = [u for u in candidates if u.endswith(".m3u8") or ":hls:" in u]

            chosen = mp4_urls[0] if mp4_urls else candidates[0]
            streams[clean_quality] = chosen
            alt_urls = list(mp4_urls[1:])
            if m3u8_urls:
                hls_map[clean_quality] = m3u8_urls[0]
                if not mp4_urls and len(m3u8_urls) > 1:
                    alt_urls.extend(m3u8_urls[1:])
                elif mp4_urls and len(m3u8_urls) > 1:
                    alt_urls.extend(m3u8_urls[1:])
            if alt_urls:
                backups[clean_quality] = alt_urls

        def _quality_sort_key(q_lbl: str) -> Tuple[int, int]:
            ql = q_lbl.lower()
            m_res = re.search(r"(\d{3,4})", ql)
            res_n = int(m_res.group(1)) if m_res else (2160 if "4k" in ql else (1440 if "2k" in ql else 0))
            u_val = streams.get(q_lbl, "").lower()
            is_mp4 = 1 if (not u_val.endswith(".m3u8") and ":hls:" not in u_val) else 0
            return (res_n, is_mp4)

        ordered_keys = sorted(streams.keys(), key=_quality_sort_key, reverse=True)
        return {
            "qualities": {k: streams[k] for k in ordered_keys},
            "backup_qualities": {k: backups[k] for k in ordered_keys if k in backups},
            "hls_qualities": {k: hls_map[k] for k in ordered_keys if k in hls_map},
        }

    @staticmethod
    def parse_subtitles(subtitle_str: Any) -> List[Dict[str, str]]:
        if not subtitle_str or subtitle_str is False or not isinstance(subtitle_str, str):
            return []
        subs: List[Dict[str, str]] = []
        text = subtitle_str.replace("\\/", "/")
        for match in re.finditer(r"\[([^\]]+)\](https?://[^\s,]+)", text):
            raw_lbl = html.unescape(re.sub(r"<[^>]+>", "", match.group(1))).strip()[:80]
            raw_u = match.group(2).strip()
            if not raw_lbl or not raw_u.startswith(("http://", "https://")) or _CTRL_CHAR_RE.search(raw_u):
                continue
            subs.append({"lang": raw_lbl, "url": raw_u})
        return subs

    @staticmethod
    def _norm_rezka_asset_url(raw_u: str, mirror: str) -> str:
        u = (raw_u or "").strip()
        if not u:
            return ""
        if u.startswith(("http://", "https://")):
            return u
        if u.startswith("//"):
            return "https:" + u
        if u.startswith("/"):
            return mirror.rstrip("/") + u
        return mirror.rstrip("/") + "/" + u

    def search_live(self, query: str, allow_person_shortcut: bool = True) -> List[Dict[str, Any]]:
        q_norm = (query or "").strip().lower()
        if not q_norm or q_norm in ("фильм", "сериал", "movie", "series"):
            return []
        cache_k = f"{q_norm}|p={1 if allow_person_shortcut else 0}"
        now = time.time()
        with self._cache_lock:
            if cache_k in self.search_cache:
                ts_k = self._search_cache_ts.get(cache_k, now)
                if (now - ts_k) < 1800.0:
                    return [dict(r) for r in self.search_cache[cache_k]]
                self.search_cache.pop(cache_k, None)
                self._search_cache_ts.pop(cache_k, None)
            if allow_person_shortcut and q_norm in self.search_cache:
                ts_q = self._search_cache_ts.get(q_norm, now)
                if (now - ts_q) < 1800.0:
                    return [dict(r) for r in self.search_cache[q_norm]]
                self.search_cache.pop(q_norm, None)
                self._search_cache_ts.pop(q_norm, None)
            person_url = self.person_url_by_name.get(q_norm) if allow_person_shortcut else None
        if person_url and not self._is_rezka_page_url(person_url):
            person_url = None
        results: List[Dict[str, Any]] = []
        seen_rezka_ids = set()
        encoded_q = urllib.parse.quote(query.strip())

        item_pattern = re.compile(
            r'<div class="b-content__inline_item(?:\s+[^"]*)?"[^>]*data-id="(\d+)"[^>]*data-url="([^"]+)"[^>]*>.*?'
            r'<img[^>]*src="([^"]+)"[^>]*>.*?'
            r'<div class="b-content__inline_item-link">\s*<a[^>]*>([^<]+)</a>\s*<div[^>]*>([^<]*)</div>',
            re.S,
        )

        # If query matches a known director/actor name from a viewed movie/series, fetch their filmography page directly
        if person_url:
            status, body, resp_headers = self.net.request(
                person_url,
                proxy_url=self.proxy_url,
                cf_worker_relay=self.cf_worker_relay,
                spoof_geo_country=self.spoof_region,
                timeout=8,
            )
            if status == 200 and "b-content__inline_item" in body:
                final_mirror = "/".join(resp_headers.get("_final_url", person_url).split("/")[:3])
                for m in item_pattern.finditer(body):
                    rezka_id, item_url, poster, title, info = m.groups()
                    if rezka_id in seen_rezka_ids:
                        continue
                    seen_rezka_ids.add(rezka_id)
                    item_url = self._norm_rezka_asset_url(item_url, final_mirror)
                    poster = self._norm_rezka_asset_url(poster, final_mirror)
                    results.append(
                        {
                            "rezka_id": rezka_id,
                            "url": item_url,
                            "poster": poster,
                            "title": html.unescape(title.strip()),
                            "info": html.unescape(info.strip()),
                            "mirror": final_mirror,
                        }
                    )
                if results:
                    cached_snap = [dict(r) for r in results]
                    with self._cache_lock:
                        if len(self.search_cache) >= 400:
                            self.search_cache.clear()
                            self._search_cache_ts.clear()
                        self.search_cache[cache_k] = cached_snap
                        self._search_cache_ts[cache_k] = now
                        self.search_cache[q_norm] = list(cached_snap)
                        self._search_cache_ts[q_norm] = now
                    return results

        for mirror in self.get_mirrors()[:4]:
            search_url = f"{mirror}/search/?do=search&subaction=search&q={encoded_q}"
            status, body, resp_headers = self.net.request(
                search_url,
                headers={"Referer": f"{mirror}/"},
                proxy_url=self.proxy_url,
                cf_worker_relay=self.cf_worker_relay,
                spoof_geo_country=self.spoof_region,
                timeout=5.0,
            )
            if status != 200 or not body:
                self._demote_broken_mirror(mirror)
                continue
            if status == 200 and "b-content__inline_item" in body:
                final_mirror = "/".join(resp_headers.get("_final_url", search_url).split("/")[:3])
                self._promote_working_mirror(final_mirror)
                for m in item_pattern.finditer(body):
                    rezka_id, item_url, poster, title, info = m.groups()
                    if rezka_id in seen_rezka_ids:
                        continue
                    seen_rezka_ids.add(rezka_id)
                    item_url = self._norm_rezka_asset_url(item_url, final_mirror)
                    poster = self._norm_rezka_asset_url(poster, final_mirror)
                    results.append(
                        {
                            "rezka_id": rezka_id,
                            "url": item_url,
                            "poster": poster,
                            "title": html.unescape(title.strip()),
                            "info": html.unescape(info.strip()),
                            "mirror": final_mirror,
                        }
                    )
                if results:
                    break
        if results:
            cached_snap = [dict(r) for r in results]
            with self._cache_lock:
                if len(self.search_cache) >= 400:
                    self.search_cache.clear()
                    self._search_cache_ts.clear()
                self.search_cache[cache_k] = cached_snap
                self._search_cache_ts[cache_k] = now
                if allow_person_shortcut:
                    self.search_cache[q_norm] = list(cached_snap)
                    self._search_cache_ts[q_norm] = now
        return results

    @staticmethod
    @functools.lru_cache(maxsize=2048)
    def _norm_title_cmp(raw_val: str) -> str:
        s = (raw_val or "").strip().lower().replace("ё", "е").replace("–", "-").replace("—", "-").replace("ł", "l")
        if s.isascii():
            x = s
        else:
            out_chars: List[str] = []
            for ch in s:
                if "\u0400" <= ch <= "\u04ff" or ch.isascii():
                    out_chars.append(ch)
                else:
                    decomp = unicodedata.normalize("NFKD", ch)
                    out_chars.append("".join(c for c in decomp if not unicodedata.combining(c)))
            x = "".join(out_chars)
        x = _NORM_NON_WORD_RE.sub(" ", x)
        return _NORM_MULTI_SPACE_RE.sub(" ", x).strip()

    @classmethod
    def _extract_page_imdb_id(cls, page_html: str) -> str:
        if not page_html:
            return ""
        # Truncate before user comments so commenter-pasted IMDb links never hijack page verification
        scope = page_html
        for marker in ('id="comments-form"', 'class="b-comments"', 'id="b-comments"'):
            idx = scope.find(marker)
            if idx > 0:
                scope = scope[:idx]
        # Prefer HDRezka's official header /help/<base64> outbound link first
        for b64_raw in re.findall(r"/help/([A-Za-z0-9+/=%_-]{12,160})/?", scope):
            try:
                unq = urllib.parse.unquote(b64_raw).strip().replace("-", "+").replace("_", "/")
                pad = len(unq) % 4
                if pad:
                    unq += "=" * (4 - pad)
                dec = base64.b64decode(unq).decode("utf-8", errors="ignore")
                m_tt = re.search(r"imdb\.com/title/(tt\d{5,10})", dec, re.I)
                if m_tt:
                    return m_tt.group(1).lower()
            except Exception:
                continue
        m_direct = re.search(r"imdb\.com/title/(tt\d{5,10})", scope, re.I)
        if m_direct:
            return m_direct.group(1).lower()
        return ""

    @classmethod
    def _verify_resolved_page(
        cls,
        page_html: str,
        page_url: str = "",
        title: str = "",
        orig_title: str = "",
        year: int = 0,
        media_type: str = "movie",
        expected_imdb: str = "",
    ) -> bool:
        if not page_html or "initCDN" not in page_html:
            return False

        # 1. Media type check against initCDN player event kind
        has_series_cdn = "initCDNSeriesEvents" in page_html
        has_movie_cdn = "initCDNMoviesEvents" in page_html
        if media_type == "series" and has_movie_cdn and not has_series_cdn:
            return False
        if media_type == "movie" and has_series_cdn and not has_movie_cdn:
            return False

        # 2. Deterministic IMDb ID check when both page & caller have tt-IDs
        exp_tt = str(expected_imdb or "").strip().lower()
        if not re.match(r"^tt\d{5,10}$", exp_tt):
            exp_tt = ""
        page_tt = cls._extract_page_imdb_id(page_html)
        if exp_tt and page_tt:
            return exp_tt == page_tt

        # 3. Title & Original Title check (when HTML contains post header metadata)
        m_h1 = re.search(r'<h1[^>]*itemprop="name"[^>]*>(.*?)</h1>', page_html, re.S | re.I)
        m_orig = re.search(r'<div[^>]*class="b-post__origtitle"[^>]*>(.*?)</div>', page_html, re.S | re.I)
        page_ru = cls._norm_title_cmp(html.unescape(re.sub(r"<[^>]+>", " ", m_h1.group(1)))) if m_h1 else ""
        page_orig_raw = html.unescape(re.sub(r"<[^>]+>", " ", m_orig.group(1))).strip() if m_orig else ""
        page_orig_alts = [cls._norm_title_cmp(p) for p in re.split(r"[/|;]", page_orig_raw) if cls._norm_title_cmp(p)]

        req_ru = cls._norm_title_cmp(title)
        if req_ru in ("фильм", "сериал", "movie", "series"):
            req_ru = ""
        req_orig = cls._norm_title_cmp(orig_title)
        if req_orig in ("фильм", "сериал", "movie", "series"):
            req_orig = ""

        roman_to_arabic = {
            "ii": "2",
            "iii": "3",
            "iv": "4",
            "vi": "6",
            "vii": "7",
            "viii": "8",
            "ix": "9",
            "x": "10",
            "xi": "11",
            "xii": "12",
            "xiii": "13",
            "xiv": "14",
            "xv": "15",
        }

        def _canon_num_token(w: str, idx: int, total_words: int) -> Optional[str]:
            if w.isdigit():
                return w
            if w in roman_to_arabic:
                return roman_to_arabic[w]
            # Treat standalone "i" / "v" as Roman 1 / 5 only at the end of a multi-word title ("Part I", "Rocky V"),
            # never in the middle ("Batman v Superman")
            if total_words >= 2 and idx == total_words - 1:
                if w == "i":
                    return "1"
                if w == "v":
                    return "5"
            return None

        def _extract_num_tokens(txt: str) -> set:
            words = txt.split()
            out = set()
            for idx, w in enumerate(words):
                cn = _canon_num_token(w, idx, len(words))
                if cn is not None:
                    out.add(cn)
            return out

        # If both page_orig and req_orig exist, ensure they do not contradict each other
        if page_orig_alts and req_orig:
            clean_req_nosp = req_orig.replace(" ", "")
            req_nums = _extract_num_tokens(req_orig)
            raw_orig_parts = [p.strip() for p in re.split(r"[/|;]", page_orig_raw) if p.strip()]
            req_head_colon = cls._norm_title_cmp(orig_title.split(":", 1)[0]) if ":" in (orig_title or "") else ""
            exact_orig = any(
                po == req_orig
                or (po.replace(" ", "") == clean_req_nosp and len(clean_req_nosp) >= 4)
                for po in page_orig_alts
            )
            if not exact_orig:
                # Accept main-title match before subtitle colon ("Furiosa" == "Furiosa: A Mad Max Saga") when sequel numbers match
                for raw_part in raw_orig_parts:
                    full_norm = cls._norm_title_cmp(raw_part)
                    if not full_norm or _extract_num_tokens(full_norm) != req_nums:
                        continue
                    if ":" in raw_part:
                        po_head = cls._norm_title_cmp(raw_part.split(":", 1)[0])
                        if len(po_head) >= 5 and po_head == req_orig:
                            exact_orig = True
                            break
                    if req_head_colon and len(req_head_colon) >= 5 and full_norm == req_head_colon:
                        exact_orig = True
                        break
            if not exact_orig:
                stop_words = {"the", "and", "for", "of", "in", "on", "to", "a", "an"}

                def _sig_tokens(txt: str) -> set:
                    words = txt.split()
                    out = set()
                    for idx, w in enumerate(words):
                        if w in stop_words and len(words) > 1:
                            continue
                        cn = _canon_num_token(w, idx, len(words))
                        if cn is not None:
                            out.add(cn)
                        elif len(w) >= 3 or (len(w) >= 2 and any(c.isdigit() for c in w)) or (len(words) <= 2 and len(w) >= 2):
                            out.add(w)
                    if not out and words:
                        out.add(words[0])
                    return out

                req_tokens = _sig_tokens(req_orig)
                any_alt_ok = False
                for po in page_orig_alts:
                    po_tokens = _sig_tokens(po)
                    if not req_tokens or not po_tokens:
                        continue
                    # Sequel numbers / roman numerals must match ("Scream" != "Scream VI", "Scream 6" == "Scream VI")
                    if req_nums != _extract_num_tokens(po):
                        continue
                    overlap = len(req_tokens & po_tokens) / max(1, max(len(req_tokens), len(po_tokens)))
                    if overlap >= 0.5:
                        any_alt_ok = True
                        break
                if not any_alt_ok:
                    return False

        # Verify Russian/main title against h1 when original title could not be cross-checked
        if page_ru and (req_ru or req_orig) and (not page_orig_alts or not req_orig):
            # Page has an original title but caller does not: Russian titles often differ slightly
            # ("Андор" vs "Звёздные войны: Андор"), so accept token-subset matches in that mode.
            relaxed_ru_mode = bool(page_orig_alts and not req_orig)
            candidates_req = [x for x in (req_ru, req_orig) if x]
            pg_nums = _extract_num_tokens(page_ru)
            pg_toks = {w for w in page_ru.split() if len(w) >= 2 or w.isdigit()} | pg_nums
            matched_h1 = False
            for cr in candidates_req:
                if page_ru == cr:
                    matched_h1 = True
                    break
                cr_nums = _extract_num_tokens(cr)
                if cr_nums != pg_nums:
                    continue
                cr_toks = {w for w in cr.split() if len(w) >= 2 or w.isdigit()} | cr_nums
                if cr_toks and pg_toks and cr_toks == pg_toks:
                    matched_h1 = True
                    break
                if relaxed_ru_mode and cr_toks and pg_toks and (cr_toks <= pg_toks or pg_toks <= cr_toks):
                    matched_h1 = True
                    break
            if not matched_h1:
                return False

        # 4. Release year check (when HTML specifies /year/YYYY/)
        yr_int = _safe_int(year)
        if yr_int >= 1900:
            yr_hits = [int(y) for y in re.findall(r"/year/(\d{4})/", page_html) if 1895 <= int(y) <= 2035]
            if yr_hits:
                min_diff = min(abs(py - yr_int) for py in yr_hits)
                max_tol = 3 if media_type == "series" else 2
                if min_diff > max_tol:
                    return False

        return True

    def _is_rezka_page_url(self, raw_url: str) -> bool:
        s = str(raw_url or "").strip()
        if not s or _CTRL_CHAR_RE.search(s):
            return False
        try:
            parsed = urllib.parse.urlparse(s)
        except Exception:
            return False
        if parsed.scheme not in ("http", "https"):
            return False
        if parsed.username is not None or parsed.password is not None:
            return False
        try:
            p_port = parsed.port
        except ValueError:
            return False
        if p_port not in (None, 80, 443):
            return False
        host = (parsed.hostname or "").strip().lower().rstrip(".")
        if not host or host == "localhost" or host.endswith(
            (".local", ".lan", ".home", ".internal", ".localhost", ".localdomain", ".nip.io", ".sslip.io", ".xip.io")
        ):
            return False
        try:
            ipaddress.ip_address(host)
            return False
        except ValueError:
            pass
        with self._mirror_lock:
            known_hosts = self._cached_mirror_hosts
            if known_hosts is None:
                mirror_list = list(self.mirror_priority) + list(self.DEFAULT_MIRRORS)
                if self.custom_mirror:
                    cm = self.custom_mirror.strip()
                    if cm and not cm.startswith(("http://", "https://")):
                        cm = "https://" + cm
                    if cm:
                        mirror_list.append(cm)
                built_hosts = set()
                for m in mirror_list:
                    try:
                        mh = (urllib.parse.urlparse(m).hostname or "").strip().lower().rstrip(".")
                    except Exception:
                        mh = ""
                    if mh and mh != "localhost" and not mh.endswith(
                        (".local", ".lan", ".home", ".internal", ".localhost", ".localdomain", ".nip.io", ".sslip.io", ".xip.io")
                    ):
                        try:
                            ipaddress.ip_address(mh)
                        except ValueError:
                            built_hosts.add(mh)
                self._cached_mirror_hosts = built_hosts
                known_hosts = built_hosts
        if host in known_hosts:
            return True
        # HDRezka rotates mirror domains (hdrezka-*.tv, rezka-ua.org, ...): require "rezka" in a public DNS name
        return "rezka" in host and "." in host

    @staticmethod
    def _is_valid_person_photo_url(raw_url: str) -> bool:
        u = str(raw_url or "").strip()
        if not u or not u.startswith(("http://", "https://")) or _CTRL_CHAR_RE.search(u):
            return False
        u_low = u.lower()
        path_only = u_low.split("?", 1)[0].split("#", 1)[0]
        if path_only.endswith(".svg") or ".svg/" in u_low or ".svg." in u_low:
            return False
        bad_tokens = (
            "nopersonphoto",
            "no-photo",
            "no_photo",
            "nophoto",
            "noavatar",
            "no-avatar",
            "no_avatar",
            "default-avatar",
            "default_avatar",
            "placeholder",
            "blank.gif",
            "spacer.gif",
            "/images/no",
            "/i/0.png",
            "/0.png",
            "/0.jpg",
            "/0.gif",
            "disambig",
            "question_book",
            "flag_of_",
            "coat_of_arms",
        )
        return not any(tok in u_low for tok in bad_tokens)

    @staticmethod
    def _clone_page_meta(meta: Dict[str, Any]) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for k, v in meta.items():
            if isinstance(v, list):
                out[k] = [dict(x) if isinstance(x, dict) else x for x in v]
            elif isinstance(v, dict):
                if k == "inline_streams":
                    out[k] = {
                        sk: {bk: dict(bv) if isinstance(bv, dict) else bv for bk, bv in sv.items()}
                        if isinstance(sv, dict)
                        else sv
                        for sk, sv in v.items()
                    }
                elif k in ("seasons", "prem_episodes_map"):
                    out[k] = {sk: list(sv) if isinstance(sv, list) else sv for sk, sv in v.items()}
                else:
                    out[k] = dict(v)
            else:
                out[k] = v
        return out

    @staticmethod
    def _extract_rezka_id_from_url(rezka_url: Optional[str]) -> str:
        if not rezka_url:
            return ""
        m = re.search(r"/(\d+)-[^/?#]+\.html", str(rezka_url))
        return m.group(1) if m else ""

    @staticmethod
    def _extract_franchise_parts_html(page_html: str, mirror: str = "") -> List[Dict[str, Any]]:
        if not page_html or "b-post__partcontent_item" not in page_html:
            return []
        raw_parts: List[Dict[str, Any]] = []
        base_mirror = str(mirror or "https://rezka.ag").rstrip("/")
        for idx, (attrs, inner) in enumerate(
            re.findall(
                r'<div([^>]*class="[^"]*\bb-post__partcontent_item\b[^"]*"[^>]*)>(.*?)</div>',
                page_html,
                re.S | re.I,
            )
        ):
            m_title = re.search(r'<span[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>(.*?)</span>', inner, re.S | re.I)
            if not m_title:
                continue
            title_html = m_title.group(1)
            title_txt = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", title_html))).strip()
            if not title_txt:
                continue
            is_current = bool(re.search(r"\bcurrent\b", attrs, re.I))
            m_data_url = re.search(r'data-url=["\']([^"\']+)["\']', attrs, re.I)
            m_href = re.search(r'href=["\']([^"\']+)["\']', title_html, re.I)
            raw_url = (m_data_url.group(1) if m_data_url else (m_href.group(1) if m_href else "")).strip()
            if raw_url.startswith("/"):
                raw_url = f"{base_mirror}{raw_url}"
            rezka_id = HDRezkaClient._extract_rezka_id_from_url(raw_url)
            year_val = 0
            m_year = re.search(r'<span[^>]*class="[^"]*\byear\b[^"]*"[^>]*>(.*?)</span>', inner, re.S | re.I)
            if m_year:
                m_yr_num = re.search(r"((?:19|20)\d{2})", m_year.group(1))
                if m_yr_num:
                    year_val = int(m_yr_num.group(1))
            rating_val = ""
            m_rat = re.search(r'<span[^>]*class="[^"]*\brating\b[^"]*"[^>]*>(.*?)</span>', inner, re.S | re.I)
            if m_rat:
                rat_clean = re.sub(r"<[^>]+>", " ", m_rat.group(1))
                m_rat_num = re.search(r"(\d+(?:\.\d+)?)", rat_clean)
                if m_rat_num:
                    rating_val = m_rat_num.group(1)
            raw_parts.append(
                {
                    "_idx": idx,
                    "title": title_txt,
                    "year": year_val,
                    "rating": rating_val,
                    "rezka_url": raw_url,
                    "rezka_id": rezka_id,
                    "is_current": is_current,
                }
            )
        if len(raw_parts) < 2:
            return []
        raw_parts.sort(key=lambda p: (p["year"] if p["year"] > 0 else 9999, p["_idx"]))
        result: List[Dict[str, Any]] = []
        for i, part in enumerate(raw_parts, start=1):
            part_copy = {k: v for k, v in part.items() if k != "_idx"}
            part_copy["num"] = i
            result.append(part_copy)
        return result

    def _resolve_page_metadata(
        self,
        numeric_id: str,
        title: str,
        orig_title: str,
        rezka_url: Optional[str],
        year: int = 0,
        media_type: str = "movie",
        imdb_id: str = "",
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        clean_title = "" if str(title or "").strip().lower() in ("фильм", "сериал") else str(title or "").strip()
        clean_orig = "" if str(orig_title or "").strip().lower() in ("фильм", "сериал") else str(orig_title or "").strip()
        if rezka_url and not self._is_rezka_page_url(rezka_url):
            # Client-supplied URL that is not a HDRezka mirror page: never fetch it (SSRF guard)
            rezka_url = None
        url_rid = self._extract_rezka_id_from_url(rezka_url)
        safe_numeric_id = str(numeric_id or "").strip()
        if safe_numeric_id and not safe_numeric_id.isdigit():
            safe_numeric_id = ""
        if not safe_numeric_id and url_rid:
            safe_numeric_id = url_rid

        yr_int = _safe_int(year)
        cache_key = (
            f"id={imdb_id}|rid={safe_numeric_id}|url={rezka_url or ''}|"
            f"t={clean_title.lower()}|o={clean_orig.lower()}|y={yr_int}|mt={media_type}"
        )
        now = time.time()
        cached_hit = None
        with self._cache_lock:
            if not force_refresh and cache_key in self.page_cache:
                cached_meta = self.page_cache[cache_key]
                if (now - float(cached_meta.get("_cached_at") or 0)) < 3600:
                    cached_hit = cached_meta
                else:
                    self.page_cache.pop(cache_key, None)
        if cached_hit is not None:
            return self._clone_page_meta(cached_hit)

        target_url = rezka_url
        page_html = ""
        resp_headers: Dict[str, Any] = {}
        status = 0
        rejected_poisoned = False

        if target_url and target_url.startswith("http"):
            t_path = urllib.parse.urlparse(target_url).path or ""
            if t_path in ("", "/"):
                target_url = ""
        if target_url and target_url.startswith("http"):
            status, page_html, resp_headers = self.net.request(
                target_url,
                proxy_url=self.proxy_url,
                cf_worker_relay=self.cf_worker_relay,
                spoof_geo_country=self.spoof_region,
                timeout=5.0,
            )
            if status == 200 and page_html and "initCDN" in page_html:
                final_m = "/".join(resp_headers.get("_final_url", target_url).split("/")[:3])
                self._promote_working_mirror(final_m)
                if not self._verify_resolved_page(
                    page_html,
                    page_url=target_url,
                    title=clean_title,
                    orig_title=clean_orig,
                    year=year,
                    media_type=media_type,
                    expected_imdb=imdb_id,
                ):
                    # Poisoned or mismatched rezka_url — discard and fall back to strict search
                    rejected_poisoned = True
                    status = 0
                    page_html = ""
                    target_url = ""
                    safe_numeric_id = ""

        # If target_url was missing, stale, or failed verification, resolve via dual-query search
        if status != 200 or not page_html or "initCDN" not in page_html:
            t_norm = self._norm_title_cmp(clean_title)
            o_norm = self._norm_title_cmp(clean_orig)

            def _score_candidate(cand: Dict[str, Any]) -> int:
                sc = 0
                if safe_numeric_id and cand.get("rezka_id") == safe_numeric_id:
                    sc += 140
                ct = self._norm_title_cmp(cand.get("title") or "")
                cinfo_raw = cand.get("info") or ""
                cinfo = cinfo_raw.lower()
                curl = (cand.get("url") or "").lower()

                # Parse candidate info: typically "2023, США, Триллеры" or with original title / series marker
                cand_years = [int(y) for y in re.findall(r"\b(19\d{2}|20\d{2})\b", cinfo_raw)]
                is_cand_series = (
                    "/series/" in curl
                    or "сериал" in cinfo
                    or "сезон" in cinfo
                    or "многосерийный" in cinfo
                )
                is_cand_film = "/films/" in curl and not is_cand_series
                is_cand_anim = "/cartoons/" in curl or "/animation/" in curl or "/anime/" in curl

                title_matched = False
                cand_title_raw = cand.get("title") or ""
                alt_parts = [self._norm_title_cmp(p) for p in cand_title_raw.split("/") if p.strip()]
                if t_norm and (ct == t_norm or t_norm in alt_parts):
                    sc += 55
                    title_matched = True
                elif o_norm and (ct == o_norm or o_norm in alt_parts):
                    sc += 55
                    title_matched = True
                else:
                    # Word-boundary token match (never raw substring inside unrelated words)
                    ct_words = ct.split()
                    t_words = t_norm.split() if t_norm else []
                    o_words = o_norm.split() if o_norm else []
                    if t_words and ct_words[: len(t_words)] == t_words:
                        extra_words = len(ct_words) - len(t_words)
                        sc += max(8, 26 - extra_words * 7)
                        title_matched = extra_words <= 2
                    elif o_words and ct_words[: len(o_words)] == o_words:
                        extra_words = len(ct_words) - len(o_words)
                        sc += max(8, 26 - extra_words * 7)
                        title_matched = extra_words <= 2

                # Check URL slug against orig_title (very strong signal on HDRezka when Russian title is ambiguous!)
                slug_m = re.search(r"/\d+-([a-z0-9-]+?)(?:-\d{4})?(?:-latest)?\.html", curl)
                slug_norm = slug_m.group(1).replace("-", " ").strip() if slug_m else ""
                if o_norm and slug_norm:
                    o_ascii = re.sub(r"[^a-z0-9\s]", " ", clean_orig.lower())
                    o_ascii = re.sub(r"\s+", " ", o_ascii).strip()
                    if o_ascii and slug_norm == o_ascii:
                        sc += 50
                        title_matched = True

                if not title_matched and not (safe_numeric_id and cand.get("rezka_id") == safe_numeric_id):
                    sc -= 40

                # Strict media_type matching
                if media_type == "series":
                    if is_cand_series:
                        sc += 32
                    elif is_cand_anim and "полнометраж" not in cinfo:
                        sc -= 20
                    elif is_cand_film:
                        sc -= 60
                else:
                    if is_cand_film:
                        sc += 32
                    elif is_cand_anim and not is_cand_series:
                        sc += 28
                    elif is_cand_series:
                        sc -= 60

                # Strict year matching
                if yr_int >= 1900 and cand_years:
                    min_diff = min(abs(cy - yr_int) for cy in cand_years)
                    if min_diff == 0:
                        sc += 35
                    elif min_diff == 1:
                        sc += 20
                    elif min_diff == 2 and media_type == "series":
                        sc += 6
                    elif min_diff >= 3:
                        sc -= 45 if media_type == "movie" else 35
                return sc

            # Always search BOTH orig_title and Russian title when distinct so homonyms (e.g. "Терапия" vs "Shrinking") find the true match
            found: List[Dict[str, Any]] = []
            seen_rids = set()
            queries_to_run: List[str] = []
            if clean_orig:
                queries_to_run.append(clean_orig)
            if clean_title and clean_title.lower() != clean_orig.lower():
                queries_to_run.append(clean_title)

            for q_str in queries_to_run:
                for hit in self.search_live(q_str, allow_person_shortcut=False):
                    rid = hit.get("rezka_id")
                    if rid and rid not in seen_rids:
                        found.append(hit)
                        seen_rids.add(rid)

            if found:
                scored_found = [(_score_candidate(c), c) for c in found]
                scored_found.sort(key=lambda x: x[0], reverse=True)
                for cand_score, cand in scored_found[:3]:
                    if cand_score < 48:
                        break
                    cand_url = cand["url"]
                    c_st, c_html, c_hdrs = self.net.request(
                        cand_url,
                        proxy_url=self.proxy_url,
                        cf_worker_relay=self.cf_worker_relay,
                        spoof_geo_country=self.spoof_region,
                        timeout=5.0,
                    )
                    if c_st == 200 and c_html and "initCDN" in c_html:
                        final_m = "/".join(c_hdrs.get("_final_url", cand_url).split("/")[:3])
                        self._promote_working_mirror(final_m)
                        if self._verify_resolved_page(
                            c_html,
                            page_url=cand_url,
                            title=clean_title,
                            orig_title=clean_orig,
                            year=year,
                            media_type=media_type,
                            expected_imdb=imdb_id,
                        ):
                            safe_numeric_id = cand["rezka_id"]
                            target_url = cand_url
                            status = c_st
                            page_html = c_html
                            resp_headers = c_hdrs
                            break
                        else:
                            if safe_numeric_id and cand.get("rezka_id") == safe_numeric_id:
                                rejected_poisoned = True
                                safe_numeric_id = ""
                            status = 0
                            page_html = ""

            if (status != 200 or not page_html or "initCDN" not in page_html) and media_type != "series" and found:
                series_tries = 0
                for cand in found:
                    if series_tries >= 3:
                        break
                    curl = (cand.get("url") or "").lower()
                    cinfo = (cand.get("info") or "").lower()
                    if "/series/" in curl or "сериал" in cinfo or "сезон" in cinfo:
                        ct = self._norm_title_cmp(cand.get("title") or "")
                        cand_alts = [self._norm_title_cmp(p) for p in str(cand.get("title") or "").split("/") if p.strip()]
                        if (t_norm and (ct == t_norm or t_norm in cand_alts)) or (o_norm and (ct == o_norm or o_norm in cand_alts)):
                            series_tries += 1
                            cand_url = cand["url"]
                            c_st, c_html, c_hdrs = self.net.request(
                                cand_url,
                                proxy_url=self.proxy_url,
                                cf_worker_relay=self.cf_worker_relay,
                                spoof_geo_country=self.spoof_region,
                                timeout=5.0,
                            )
                            if c_st == 200 and c_html and "initCDN" in c_html:
                                if self._verify_resolved_page(
                                    c_html,
                                    page_url=cand_url,
                                    title=clean_title,
                                    orig_title=clean_orig,
                                    year=year,
                                    media_type="series",
                                    expected_imdb=imdb_id,
                                ):
                                    final_m = "/".join(c_hdrs.get("_final_url", cand_url).split("/")[:3])
                                    self._promote_working_mirror(final_m)
                                    safe_numeric_id = cand["rezka_id"]
                                    target_url = cand_url
                                    status = c_st
                                    page_html = c_html
                                    resp_headers = c_hdrs
                                    media_type = "series"
                                    break

        if status != 200 or not page_html or "initCDN" not in page_html:
            return _RejectedMeta() if rejected_poisoned else {}

        final_url = resp_headers.get("_final_url", target_url)
        mirror = "/".join(final_url.split("/")[:3])
        clean_page_html = page_html.split('<div class="b-comments"', 1)[0]

        country_text = ""
        countries: List[str] = []
        trans_info_text = ""
        m_country = re.search(
            r'<td class="l">\s*<h2>\s*Страна\s*</h2>\s*:?\s*</td>\s*<td>(.*?)</td>',
            clean_page_html,
            re.S | re.I,
        )
        if m_country:
            country_text = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m_country.group(1)))).strip()
            raw_c_links = re.findall(r"<a[^>]*>([^<]+)</a>", m_country.group(1), re.I)
            c_candidates = raw_c_links if raw_c_links else country_text.split(",")
            for c_raw in c_candidates:
                cn = html.unescape(re.sub(r"\s+", " ", c_raw)).strip().strip(".,;:")
                if cn and cn not in countries:
                    countries.append(cn)
        m_trans_info = re.search(
            r'<td class="l">\s*<h2>\s*В переводе\s*</h2>\s*:?\s*</td>\s*<td>(.*?)</td>',
            clean_page_html,
            re.S | re.I,
        )
        if m_trans_info:
            trans_info_text = html.unescape(
                re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m_trans_info.group(1)))
            ).strip()

        country_low = country_text.lower()
        is_russian_native = bool(
            ("россия" in country_low or "ссср" in country_low or "беларусь" in country_low)
            and not any(k in country_low for k in ("сша", "великобритания", "франция", "германия", "канада", "япония", "корея"))
            and not bool(orig_title and re.search(r"[A-Za-z]", orig_title))
        )

        age_rating = ""
        m_age = re.search(
            r'<td class="l">\s*<h2>\s*Возраст\s*</h2>\s*:?\s*</td>\s*<td>(.*?)</td>',
            clean_page_html,
            re.S | re.I,
        )
        if m_age:
            raw_age_txt = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m_age.group(1)))).strip()
            m_age_num = re.search(r"\b(0|6|12|16|18)\s*\+", raw_age_txt)
            age_rating = f"{m_age_num.group(1)}+" if m_age_num else raw_age_txt[:24]

        studios: List[Dict[str, Any]] = []
        skipped_prem_studios: List[Dict[str, Any]] = []
        skipped_prem_tr_ids: set = set()
        seen_tr = set()
        for tr_m in re.finditer(
            r'<(?:li|a|option)([^>]*data-translator_id="(\d+)"[^>]*)>(.*?)</(?:li|a|option)>',
            clean_page_html,
            re.S,
        ):
            li_attrs, tr_id, tr_inner_html = tr_m.groups()
            if tr_id in seen_tr:
                continue
            m_flag = re.search(r'<img[^>]*title="([^"]+)"', tr_inner_html, re.I)
            flag_lang = html.unescape(m_flag.group(1).strip()) if m_flag else ""
            clean_name = re.sub(r"<[^>]+>", " ", tr_inner_html)
            clean_name = html.unescape(re.sub(r"\s+", " ", clean_name)).strip()
            if not clean_name:
                m_title_attr = re.search(r'title="([^"]+)"', li_attrs)
                if m_title_attr:
                    clean_name = html.unescape(m_title_attr.group(1).strip())
            if not clean_name:
                continue

            low_name = clean_name.lower()
            is_orig = bool(
                tr_id == "238"
                or "оригинал" in low_name
                or "original" in low_name
                or ("субтитр" in low_name and "укр" not in low_name)
            )
            is_prem = bool("b-prem_translator" in li_attrs or "prem_translator" in li_attrs)

            if flag_lang and "укр" in flag_lang.lower() and "укр" not in low_name:
                clean_name = f"{clean_name} (Украинский)"

            if is_orig and "оригинал" not in low_name:
                clean_name = f"Оригинал ({clean_name})"

            seen_tr.add(tr_id)
            studio_entry = {
                "id": tr_id,
                "name": clean_name,
                "lang": "EN" if is_orig else ("UA" if "укр" in clean_name.lower() else "RU"),
                "is_original": is_orig,
                "is_prem_locked": is_prem,
                "badge": "Оригинал · 1080p" if is_orig else ("Premium" if is_prem else "1080p Full HD"),
            }
            # Skip paid 'b-prem_translator' dub entries that only serve the 15s Premium QR code stub.
            # Never include HDRezka Premium translators when free alternatives exist.
            if is_prem:
                skipped_prem_tr_ids.add(tr_id)
                skipped_prem_studios.append(studio_entry)
                continue

            studios.append(studio_entry)

        default_tr_m = re.search(r"initCDN(Series|Movies)Events\(\s*(\d+)\s*,\s*(\d+)", page_html)
        cdn_event_kind = default_tr_m.group(1) if default_tr_m else ""
        page_rezka_id = default_tr_m.group(2) if default_tr_m else safe_numeric_id
        parsed_default_tr = default_tr_m.group(3) if default_tr_m else ""
        if parsed_default_tr and parsed_default_tr not in skipped_prem_tr_ids and any(s["id"] == parsed_default_tr for s in studios):
            raw_default_tr_id = parsed_default_tr
        else:
            raw_default_tr_id = studios[0]["id"] if studios else (parsed_default_tr or "111")

        if not studios:
            if skipped_prem_studios:
                # All translators on the page are locked behind HDRezka Premium — preserve their locked flag
                studios = list(skipped_prem_studios)
            else:
                trans_low = trans_info_text.lower()
                if raw_default_tr_id == "238" or "оригинал" in trans_low or "субтитр" in trans_low:
                    studios = [
                        {
                            "id": raw_default_tr_id,
                            "name": "Оригинал (+субтитры)",
                            "lang": "EN",
                            "is_original": True,
                            "is_prem_locked": False,
                            "badge": "Оригинал · 1080p",
                        }
                    ]
                elif is_russian_native:
                    studios = [
                        {
                            "id": raw_default_tr_id,
                            "name": "Оригинал (Русская дорожка)",
                            "lang": "RU",
                            "is_original": True,
                            "is_prem_locked": False,
                            "badge": "Оригинал · 1080p",
                        }
                    ]
                else:
                    studios = [
                        {
                            "id": raw_default_tr_id,
                            "name": trans_info_text or "Профессиональный перевод (HDRezka)",
                            "lang": "RU",
                            "is_original": False,
                            "is_prem_locked": False,
                            "badge": "1080p",
                        }
                    ]

        # Guarantee 'Оригинал' always appears in HDRezka voiceovers list if free
        if not any(s.get("is_original") for s in studios):
            if is_russian_native and studios:
                studios[0]["is_original"] = True
                if "оригинал" not in studios[0]["name"].lower():
                    studios[0]["name"] = f"Оригинал ({studios[0]['name']})"
            elif not skipped_prem_studios:
                studios.append(
                    {
                        "id": "238",
                        "name": "Оригинал (+субтитры)",
                        "lang": "EN",
                        "is_original": True,
                        "is_prem_locked": False,
                        "badge": "Оригинал · 1080p",
                    }
                )

        # Pin 'Оригинал' at the very top of the studios list so it is always immediately visible
        studios.sort(key=lambda s: (0 if s.get("is_original") else 1))

        # Strictly exclude any paid/locked HDRezka Premium translators when free translators exist
        free_studios = [s for s in studios if not s.get("is_prem_locked") and s["id"] not in skipped_prem_tr_ids]
        if free_studios:
            studios = free_studios

        # If the page's default translator was a paid b-prem_translator or ukrainian by default, select best free translator
        raw_default_locked = not any(str(s["id"]) == str(raw_default_tr_id) and not s.get("is_prem_locked") for s in studios)
        raw_default_meta = next((s for s in studios if str(s["id"]) == str(raw_default_tr_id)), None)
        is_ukr_raw = bool(raw_default_meta and (raw_default_meta.get("lang") == "UA" or "украин" in str(raw_default_meta.get("name") or "").lower()))
        if studios and (raw_default_locked or is_ukr_raw):
            ru_free = [s for s in free_studios if not s.get("is_original") and s.get("lang") != "UA" and "украин" not in str(s.get("name") or "").lower()]
            if ru_free:
                default_tr_id = str(ru_free[0]["id"])
            elif not raw_default_locked:
                default_tr_id = str(raw_default_tr_id)
            elif free_studios:
                default_tr_id = str(free_studios[0]["id"])
            else:
                default_tr_id = str(studios[0]["id"])
        else:
            default_tr_id = str(raw_default_tr_id)

        def _decode_js_str(raw_js: str) -> str:
            try:
                return json.loads('"' + raw_js + '"')
            except Exception:
                return raw_js.replace("\\/", "/")

        inline_bundle = {"qualities": {}, "backup_qualities": {}, "hls_qualities": {}}
        raw_default_is_prem = bool(
            raw_default_tr_id in skipped_prem_tr_ids
            or any(s["id"] == raw_default_tr_id and s.get("is_prem_locked") for s in studios)
        )
        m_streams = re.search(r'"streams"\s*:\s*"((?:\\.|[^"\\])+)"', page_html)
        if m_streams and not raw_default_is_prem:
            inline_bundle = self.decode_rezka_stream_bundle(_decode_js_str(m_streams.group(1)))
        inline_streams = inline_bundle["qualities"]

        inline_subs = []
        m_subs = re.search(r'"subtitle"\s*:\s*"((?:\\.|[^"\\])+)"', page_html)
        if m_subs:
            inline_subs = self.parse_subtitles(_decode_js_str(m_subs.group(1)))

        # Extract real seasons & episodes map + schedule episode titles from page_html
        seasons_map: Dict[str, List[int]] = {}
        prem_episodes_map: Dict[str, List[int]] = {}
        episodes_titles: Dict[str, Dict[str, str]] = {}
        episodes_meta: Dict[str, Dict[str, Dict[str, Any]]] = {}
        for li_attrs, li_inner in re.findall(
            r"<li([^>]*data-(?:season|episode)_id=[^>]*)>(.*?)</li>",
            clean_page_html,
            re.S | re.I,
        ):
            m_s = re.search(r'data-season_id="(\d+)"', li_attrs, re.I)
            m_e = re.search(r'data-episode_id="(\d+)"', li_attrs, re.I)
            if not m_s or not m_e:
                continue
            s_str, e_str = m_s.group(1), m_e.group(1)
            ep_num = int(e_str)
            if ep_num < 1:
                continue
            attrs_low = li_attrs.lower()
            inner_low = li_inner.lower()
            is_prem_ep = bool(
                "prem_episode" in attrs_low
                or "b-prem_episode" in attrs_low
                or "prem-icon" in inner_low
            )
            clean_lbl = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", li_inner))).strip()
            if clean_lbl and not re.match(r"^(?:серия|эпизод|episode)\s*\d+$", clean_lbl, re.I):
                episodes_titles.setdefault(s_str, {})[str(ep_num)] = clean_lbl
            if is_prem_ep:
                prem_episodes_map.setdefault(s_str, []).append(ep_num)
                episodes_meta.setdefault(s_str, {})[str(ep_num)] = {
                    "title": clean_lbl if not re.match(r"^(?:серия|эпизод|episode)\s*\d+$", clean_lbl, re.I) else "",
                    "orig_title": "",
                    "air_date": "",
                    "is_released": True,
                    "is_future": False,
                    "is_prem_locked": True,
                }
            else:
                seasons_map.setdefault(s_str, []).append(ep_num)
        if not seasons_map and not prem_episodes_map:
            for s_str, e_str in re.findall(r'data-season_id="(\d+)"[^>]*data-episode_id="(\d+)"', page_html):
                ep_num = int(e_str)
                if ep_num >= 1:
                    seasons_map.setdefault(s_str, []).append(ep_num)

        # Parse full HDRezka episode schedule table (<table class="b-post__schedule_table">)
        # for real Russian/original episode titles, air dates, and earlier released seasons
        schedule_rows = re.findall(
            r'<tr[^>]*>\s*<td class="td-1"[^>]*>\s*(\d+)\s*сезон\s*(\d+)\s*серия\s*</td>\s*'
            r'<td class="td-2">\s*(?:<b>(.*?)</b>)?(?:\s*<br\s*/?>\s*<span>(.*?)</span>)?\s*</td>\s*'
            r'<td class="td-3">.*?</td>\s*<td class="td-4">(.*?)</td>\s*<td class="td-5">(.*?)</td>',
            clean_page_html,
            re.S,
        )
        unreleased_eps_set: set = set()
        for s_str, e_str, raw_b, raw_span, raw_date, raw_td5 in schedule_rows:
            ep_num = int(e_str)
            if ep_num < 1:
                continue
            b_title = html.unescape(re.sub(r"<[^>]+>", "", raw_b or "")).strip()
            orig_ep = html.unescape(re.sub(r"<[^>]+>", "", raw_span or "")).strip()
            air_date = html.unescape(re.sub(r"<[^>]+>", "", raw_date or "")).strip()
            is_ep_released = "exists-episode" in (raw_td5 or "")
            is_only_prem = bool(
                ep_num in (prem_episodes_map.get(s_str) or [])
                and ep_num not in (seasons_map.get(s_str) or [])
            )
            if is_ep_released:
                if not is_only_prem:
                    seasons_map.setdefault(s_str, []).append(ep_num)
            elif not is_only_prem:
                unreleased_eps_set.add((s_str, ep_num))
            is_generic_b = bool(re.match(r"^(?:серия|эпизод|episode)\s*\d+$|\b\d+\s*(?:серия|эпизод)\b", b_title, re.I))
            is_generic_orig = bool(re.match(r"^(?:серия|эпизод|episode)\s*\d+$", orig_ep, re.I))
            if b_title and not is_generic_b:
                episodes_titles.setdefault(s_str, {})[str(ep_num)] = b_title
            elif orig_ep and not is_generic_orig:
                episodes_titles.setdefault(s_str, {}).setdefault(str(ep_num), orig_ep)
            existing_li_title = (episodes_titles.get(s_str) or {}).get(str(ep_num), "")
            eff_ep_title = (b_title if (b_title and not is_generic_b) else existing_li_title) or b_title
            if eff_ep_title or orig_ep or air_date or not is_ep_released or is_only_prem:
                episodes_meta.setdefault(s_str, {})[str(ep_num)] = {
                    "title": eff_ep_title,
                    "orig_title": orig_ep if orig_ep.lower() != eff_ep_title.lower() else "",
                    "air_date": air_date,
                    "is_released": bool(is_ep_released or is_only_prem),
                    "is_future": not bool(is_ep_released or is_only_prem),
                    **({"is_prem_locked": True} if is_only_prem else {}),
                }

        for s_str in list(seasons_map.keys()):
            seasons_map[s_str] = sorted(set(seasons_map[s_str]))
        for s_str in list(prem_episodes_map.keys()):
            prem_episodes_map[s_str] = sorted(set(prem_episodes_map[s_str]))

        # Episodes already playable in the HDRezka player list are released, even if the
        # schedule table has not yet marked them with "exists-episode".
        for s_str, ep_meta_by_num in episodes_meta.items():
            playable = set(seasons_map.get(s_str) or [])
            for e_key, ep_m in ep_meta_by_num.items():
                if ep_m.get("is_future") and int(e_key) in playable:
                    ep_m["is_released"] = True
                    ep_m["is_future"] = False
                    unreleased_eps_set.discard((s_str, int(e_key)))
        unreleased_schedule_count = len(unreleased_eps_set)

        latest_season = 1
        latest_episode = 1
        if seasons_map:
            s_nums = [int(k) for k in seasons_map.keys() if k.isdigit()]
            if s_nums:
                latest_season = max(s_nums)
                ep_list = seasons_map.get(str(latest_season)) or [1]
                latest_episode = max(ep_list) if ep_list else 1

        # Extract full Russian plot synopsis from <div class="b-post__description_text">
        description = ""
        m_desc = re.search(r'<div class="b-post__description_text">\s*(.*?)\s*</div>', clean_page_html, re.S)
        if m_desc:
            raw_desc = re.sub(r"<[^>]+>", " ", m_desc.group(1))
            description = html.unescape(re.sub(r"\s+", " ", raw_desc)).strip()

        # Extract directors, cast (actors), photos, and duration from page_html
        def _norm_photo(raw_p: str) -> str:
            p = (raw_p or "").strip()
            if not p or p.lower() in ("null", "none") or "nopersonphoto" in p.lower():
                return ""
            m_i = re.search(r"(/i/\d+/\d+/\d+/[^\s\"']+)", p)
            if m_i:
                return f"{mirror.rstrip('/')}{m_i.group(1)}"
            if p.startswith("//"):
                return "https:" + p
            return p

        directors: List[str] = []
        actors: List[str] = []
        cast_people: List[Dict[str, Any]] = []
        seen_people = set()

        for span_attrs, inner_html in re.findall(
            r'<span([^>]*class="[^"]*person-name-item[^"]*"[^>]*)>(.*?)</span>\s*(?:</a>\s*)?</span>',
            clean_page_html,
            re.S,
        ):
            m_name = re.search(r'itemprop="name"[^>]*>([^<]+)', inner_html)
            if not m_name:
                m_name = re.search(r">([^<>]+)$", inner_html.strip())
            if not m_name:
                continue
            p_name = html.unescape(m_name.group(1).strip())
            if not p_name:
                continue
            person_full_url = ""
            m_href = re.search(r'href="([^"]+)"', inner_html)
            if m_href:
                href_val = m_href.group(1)
                cand_p_url = href_val if href_val.startswith("http") else (mirror + href_val)
                if self._is_rezka_page_url(cand_p_url):
                    person_full_url = cand_p_url
                    with self._cache_lock:
                        if len(self.person_url_by_name) >= 2000:
                            for k_ev in list(self.person_url_by_name.keys())[:500]:
                                self.person_url_by_name.pop(k_ev, None)
                        self.person_url_by_name[p_name.lower()] = person_full_url
            m_photo = re.search(r'data-photo="([^"]*)"', span_attrs)
            photo_url = _norm_photo(m_photo.group(1) if m_photo else "")
            if photo_url:
                with self._cache_lock:
                    if len(self.person_photo_by_name) >= 1500:
                        for k_ev in list(self.person_photo_by_name.keys())[:375]:
                            self.person_photo_by_name.pop(k_ev, None)
                    self.person_photo_by_name[p_name.lower()] = photo_url

            m_job = re.search(r'data-job="([^"]*)"', span_attrs)
            job_raw = html.unescape(m_job.group(1).strip()) if m_job else ""
            is_dir = 'itemprop="director"' in span_attrs or "режисс" in job_raw.lower()
            is_act = 'itemprop="actor"' in span_attrs or "актер" in job_raw.lower() or "актрис" in job_raw.lower()

            if is_dir and p_name not in directors:
                directors.append(p_name)
            elif is_act and p_name not in actors and p_name not in directors:
                actors.append(p_name)

            if (is_dir or is_act) and p_name.lower() not in seen_people:
                seen_people.add(p_name.lower())
                role_clean = (
                    job_raw.replace("Актер", "Актёр")
                    .replace("актер", "актёр")
                    .replace("Режиссер", "Режиссёр")
                    .replace("режиссер", "режиссёр")
                )
                cast_people.append(
                    {
                        "name": p_name,
                        "role": "Режиссёр" if is_dir else (role_clean or "В ролях"),
                        "is_director": is_dir,
                        "photo": photo_url,
                        "person_url": person_full_url,
                    }
                )

        if not directors:
            for p_url, d_name in re.findall(
                r'itemprop="director"[^>]*>.*?(?:<a[^>]*href="([^"]+)"[^>]*>\s*)?<span[^>]*itemprop="name"[^>]*>([^<]+)</span>',
                clean_page_html,
                re.S,
            ):
                dn = html.unescape(d_name.strip())
                if dn and dn not in directors:
                    directors.append(dn)
                    if p_url:
                        cand_p_url = p_url if p_url.startswith("http") else (mirror + p_url)
                        if self._is_rezka_page_url(cand_p_url):
                            with self._cache_lock:
                                if len(self.person_url_by_name) >= 2000:
                                    for k_ev in list(self.person_url_by_name.keys())[:500]:
                                        self.person_url_by_name.pop(k_ev, None)
                                self.person_url_by_name[dn.lower()] = cand_p_url

        if not actors:
            for p_url, a_name in re.findall(
                r'itemprop="actor"[^>]*>.*?(?:<a[^>]*href="([^"]+)"[^>]*>\s*)?<span[^>]*itemprop="name"[^>]*>([^<]+)</span>',
                clean_page_html,
                re.S,
            ):
                an = html.unescape(a_name.strip())
                if an and an not in actors:
                    actors.append(an)
                    if p_url:
                        cand_p_url = p_url if p_url.startswith("http") else (mirror + p_url)
                        if self._is_rezka_page_url(cand_p_url):
                            with self._cache_lock:
                                if len(self.person_url_by_name) >= 2000:
                                    for k_ev in list(self.person_url_by_name.keys())[:500]:
                                        self.person_url_by_name.pop(k_ev, None)
                                self.person_url_by_name[an.lower()] = cand_p_url

        duration_label = ""
        m_dur = re.search(r'<td[^>]*itemprop="duration"[^>]*>([^<]+)</td>', clean_page_html)
        if m_dur:
            duration_label = html.unescape(m_dur.group(1).strip())

        genre_canonical_map = {
            "драмы": "Драма",
            "драма": "Драма",
            "триллеры": "Триллер",
            "триллер": "Триллер",
            "комедии": "Комедия",
            "комедия": "Комедия",
            "боевики": "Боевик",
            "боевик": "Боевик",
            "детективы": "Детектив",
            "детектив": "Детектив",
            "мелодрамы": "Мелодрама",
            "мелодрама": "Мелодрама",
            "ужасы": "Ужасы",
            "фантастика": "Фантастика",
            "фэнтези": "Фэнтези",
            "криминал": "Криминал",
            "приключения": "Приключения",
            "документальные": "Документальный",
            "документальный": "Документальный",
            "биографические": "Биография",
            "биография": "Биография",
            "исторические": "История",
            "история": "История",
            "военные": "Военный",
            "военный": "Военный",
            "семейные": "Семейный",
            "семейный": "Семейный",
            "мультфильмы": "Мультфильм",
            "мультфильм": "Мультфильм",
            "аниме": "Аниме",
            "спортивные": "Спорт",
            "спорт": "Спорт",
            "вестерны": "Вестерн",
            "вестерн": "Вестерн",
            "мюзиклы": "Мюзикл",
            "мюзикл": "Мюзикл",
            "музыкальные": "Музыка",
            "музыка": "Музыка",
            "короткометражные": "Короткометражка",
            "короткометражка": "Короткометражка",
            "детские": "Детский",
            "детский": "Детский",
            "реальное тв": "Реальное ТВ",
            "ток-шоу": "Ток-шоу",
            "фильмы-нуар": "Нуар",
            "нуар": "Нуар",
        }
        genre_origin_stopwords = {
            "зарубежные",
            "русские",
            "украинские",
            "советские",
            "корейские",
            "турецкие",
            "индийские",
            "японские",
        }
        genres: List[str] = []
        m_genre_row = re.search(
            r'<td class="l">\s*<h2>\s*Жанр\s*</h2>\s*:?\s*</td>\s*<td>(.*?)</td>',
            clean_page_html,
            re.S | re.I,
        )
        genre_scope = m_genre_row.group(1) if m_genre_row else clean_page_html
        raw_genre_hits = re.findall(r'<span[^>]*itemprop="genre"[^>]*>([^<]+)</span>', genre_scope, re.I)
        if not raw_genre_hits and m_genre_row:
            raw_genre_hits = re.findall(r"<a[^>]*>([^<]+)</a>", genre_scope, re.I)
        for g_raw in raw_genre_hits:
            gn = html.unescape(re.sub(r"\s+", " ", g_raw)).strip()
            if not gn:
                continue
            gl = gn.lower()
            if gl in genre_origin_stopwords:
                continue
            canon_g = genre_canonical_map.get(gl, gn[:1].upper() + gn[1:] if gn else "")
            if canon_g and not any(existing.lower() == canon_g.lower() for existing in genres):
                genres.append(canon_g)

        player_kind = (
            "series"
            if (cdn_event_kind == "Series" or bool(seasons_map) or bool(prem_episodes_map))
            else ("movie" if cdn_event_kind == "Movies" else media_type)
        )

        series_status_text = ""
        m_infolast = re.search(r'<div class="b-post__infolast"[^>]*>\s*(.*?)\s*</div>', clean_page_html, re.S)
        if m_infolast:
            raw_infolast = re.sub(r"<[^>]+>", " ", m_infolast.group(1))
            series_status_text = html.unescape(re.sub(r"\s+", " ", raw_infolast)).strip()

        has_season_only_marker = bool(re.search(r"\d+\s*(?:-\s*[йя]|сезон)?\s*сезон\s+заверш", series_status_text, re.I))
        is_completed = bool(
            player_kind == "series"
            and seasons_map
            and unreleased_schedule_count == 0
            and not has_season_only_marker
            and re.search(r"(?:завершен|завершён|закрыт)", series_status_text, re.I)
        )
        franchise_parts = self._extract_franchise_parts_html(page_html, mirror)

        meta = {
            "_cached_at": time.time(),
            "rezka_id": page_rezka_id,
            "rezka_url": final_url,
            "page_imdb_id": self._extract_page_imdb_id(page_html),
            "mirror": mirror,
            "player_kind": player_kind,
            "raw_default_tr_id": raw_default_tr_id,
            "default_tr_id": default_tr_id,
            "studios": studios,
            "inline_streams": inline_streams,
            "inline_backup_qualities": inline_bundle["backup_qualities"],
            "inline_hls_qualities": inline_bundle["hls_qualities"],
            "inline_subs": inline_subs,
            "seasons_map": seasons_map,
            "prem_episodes_map": prem_episodes_map,
            "episodes_titles": episodes_titles,
            "episodes_meta": episodes_meta,
            "latest_season": latest_season,
            "latest_episode": latest_episode,
            "is_completed": is_completed,
            "series_status_text": series_status_text,
            "description": description,
            "age_rating": age_rating,
            "directors": directors[:4],
            "actors": actors[:10],
            "cast_people": cast_people[:14],
            "duration_label": duration_label,
            "genres": genres[:5],
            "countries": countries[:4],
            "franchise_parts": franchise_parts,
            "skipped_prem_tr_ids": list(skipped_prem_tr_ids),
        }
        if default_tr_m or inline_streams or seasons_map or prem_episodes_map:
            meta_copy = self._clone_page_meta(meta)
            with self._cache_lock:
                if len(self.page_cache) >= 240:
                    for k_ev in list(self.page_cache.keys())[:60]:
                        self.page_cache.pop(k_ev, None)
                self.page_cache[cache_key] = meta_copy
        return meta

    def _fetch_ajax_streams_bundle(
        self,
        used_mirror: str,
        resolved_id: str,
        resolved_url: str,
        tr_id: str,
        media_type: str,
        season: int,
        episode: int,
    ) -> Tuple[Dict[str, Any], List[Dict[str, str]], bool]:
        empty_bundle = {"qualities": {}, "backup_qualities": {}, "hls_qualities": {}}
        ajax_url = f"{used_mirror}/ajax/get_cdn_series/?t={int(time.time() * 1000)}"
        post_params = {
            "id": resolved_id,
            "translator_id": str(tr_id),
            "action": "get_stream" if media_type == "series" else "get_movie",
        }
        if media_type == "series":
            post_params["season"] = str(season)
            post_params["episode"] = str(episode)

        encoded_data = urllib.parse.urlencode(post_params).encode("utf-8")
        status, body, _ = self.net.request(
            ajax_url,
            method="POST",
            data=encoded_data,
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Origin": used_mirror,
                "Referer": resolved_url,
            },
            proxy_url=self.proxy_url,
            cf_worker_relay=self.cf_worker_relay,
            spoof_geo_country=self.spoof_region,
            timeout=8,
        )
        if status == 200 and body:
            try:
                payload = json.loads(body)
                if isinstance(payload, dict):
                    if payload.get("url"):
                        self._promote_working_mirror(used_mirror)
                        bundle = self.decode_rezka_stream_bundle(payload["url"])
                        subs = self.parse_subtitles(payload.get("subtitle", ""))
                        return bundle, subs, True
                    return empty_bundle, [], False
            except Exception:
                pass
        self._demote_broken_mirror(used_mirror)
        return empty_bundle, [], False

    def _fetch_ajax_streams_ex(
        self,
        used_mirror: str,
        resolved_id: str,
        resolved_url: str,
        tr_id: str,
        media_type: str,
        season: int,
        episode: int,
    ) -> Tuple[Dict[str, str], List[Dict[str, str]], bool]:
        bundle, subs, ok_json = self._fetch_ajax_streams_bundle(
            used_mirror,
            resolved_id,
            resolved_url,
            tr_id,
            media_type,
            season,
            episode,
        )
        return bundle["qualities"], subs, ok_json

    def _fetch_ajax_streams(
        self,
        used_mirror: str,
        resolved_id: str,
        resolved_url: str,
        tr_id: str,
        media_type: str,
        season: int,
        episode: int,
    ) -> Tuple[Dict[str, str], List[Dict[str, str]]]:
        streams, subs, _ = self._fetch_ajax_streams_ex(
            used_mirror,
            resolved_id,
            resolved_url,
            tr_id,
            media_type,
            season,
            episode,
        )
        return streams, subs

    @classmethod
    def _extract_safe_rezka_id(cls, item_id: str, explicit_rezka_id: str = "", rezka_url: Optional[str] = None) -> str:
        exp = str(explicit_rezka_id or "").strip()
        if exp.isdigit():
            return exp
        s_id = str(item_id or "").strip()
        if s_id.startswith("rezka_") and s_id[6:].isdigit():
            return s_id[6:]
        from_url = cls._extract_rezka_id_from_url(rezka_url)
        if from_url:
            return from_url
        return ""

    def get_streams_for_title(
        self,
        item_id: str,
        title: str,
        orig_title: str = "",
        year: int = 0,
        media_type: str = "movie",
        translator_id: str = "",
        season: int = 1,
        episode: int = 1,
        rezka_url: Optional[str] = None,
        prefer_original: bool = False,
        lang: str = "ru",
        rezka_id: str = "",
        imdb_id: str = "",
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        season = max(1, _safe_int(season, 1))
        episode = max(1, _safe_int(episode, 1))
        s_id = str(item_id or "").strip()
        inferred_imdb = imdb_id.strip() if imdb_id else (s_id if re.match(r"^tt\d{5,10}$", s_id) else "")
        safe_rezka_url = rezka_url if (rezka_url and self._is_rezka_page_url(rezka_url)) else None
        numeric_id = self._extract_safe_rezka_id(s_id, explicit_rezka_id=rezka_id, rezka_url=safe_rezka_url)
        raw_meta = self._resolve_page_metadata(
            numeric_id,
            title,
            orig_title,
            safe_rezka_url,
            year=_safe_int(year),
            media_type=media_type,
            imdb_id=inferred_imdb,
            force_refresh=force_refresh,
        )
        was_rejected = isinstance(raw_meta, _RejectedMeta)
        if was_rejected:
            # Never fetch streams for an id / url that was verified as a different title
            numeric_id = ""
            safe_rezka_url = None
        # Work on a private copy so per-request tweaks never leak into the shared page_cache entry
        meta = dict(raw_meta)

        live_streams: Dict[str, str] = {}
        live_backups: Dict[str, List[str]] = {}
        live_hls: Dict[str, str] = {}
        live_subtitles: List[Dict[str, str]] = []
        studios = meta.get("studios", [])
        used_mirror = meta.get("mirror", self.get_mirrors()[0])
        resolved_id = "" if was_rejected else (meta.get("rezka_id") or numeric_id)
        canonical_rezka_url = "" if was_rejected else (meta.get("rezka_url") or safe_rezka_url or "")
        resolved_url = canonical_rezka_url or used_mirror
        effective_type = meta.get("player_kind") or media_type
        seasons_map = meta.get("seasons_map") or {}
        prem_episodes_map = meta.get("prem_episodes_map") or {}
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"

        # Never silently clamp out-of-range (season, episode) to an earlier episode — preserve the exact
        # requested episode so unreleased episodes report unavailable and Premium-locked episodes trigger fallback!
        ep_meta_for_s = (meta.get("episodes_meta") or {}).get(str(season)) or {}
        ep_meta_entry = ep_meta_for_s.get(str(episode)) if isinstance(ep_meta_for_s, dict) else None
        is_ep_unreleased = bool(isinstance(ep_meta_entry, dict) and ep_meta_entry.get("is_future"))
        is_ep_prem_locked = bool(
            effective_type == "series"
            and int(episode) in (prem_episodes_map.get(str(season)) or [])
            and int(episode) not in (seasons_map.get(str(season)) or [])
        )

        skipped_prem_set = set(meta.get("skipped_prem_tr_ids") or [])
        free_studios = [s for s in studios if not s.get("is_prem_locked") and s["id"] not in skipped_prem_set]
        if not free_studios:
            free_studios = studios

        default_tr_candidate = str(meta.get("default_tr_id", "111"))
        if default_tr_candidate in skipped_prem_set or any(str(s["id"]) == default_tr_candidate and s.get("is_prem_locked") for s in studios):
            if free_studios:
                default_tr_candidate = str(free_studios[0]["id"])

        def_st_meta = next((s for s in studios if str(s["id"]) == default_tr_candidate), None)
        is_def_ukr = bool(def_st_meta and (def_st_meta.get("lang") == "UA" or "украин" in str(def_st_meta.get("name") or "").lower()))
        if not translator_id and (ui_lang == "ru" or not prefer_original) and is_def_ukr:
            ru_st = next(
                (
                    s for s in free_studios
                    if not s.get("is_original")
                    and s.get("lang") != "UA"
                    and "украин" not in str(s.get("name") or "").lower()
                    and str(s["id"]) not in skipped_prem_set
                    and not s.get("is_prem_locked")
                ),
                None
            )
            if ru_st:
                default_tr_candidate = str(ru_st["id"])

        if not translator_id and (prefer_original or ui_lang == "en"):
            orig_st = next(
                (
                    s
                    for s in free_studios
                    if (s.get("is_original") or str(s.get("id")) == "238")
                    and str(s.get("id")) not in skipped_prem_set
                    and not s.get("is_prem_locked")
                ),
                None,
            )
            if orig_st:
                default_tr_candidate = str(orig_st["id"])

        chosen_tr_id = (
            str(translator_id)
            if translator_id and any(str(s["id"]) == str(translator_id) for s in studios)
            else default_tr_candidate
        )
        chosen_studio_meta = next((s for s in studios if str(s["id"]) == str(chosen_tr_id)), None)
        studio_auto_switched_from = ""

        # Strictly ignore HDRezka Premium: immediately auto-substitute first available free studio
        if (str(chosen_tr_id) in skipped_prem_set or (chosen_studio_meta and chosen_studio_meta.get("is_prem_locked"))) and free_studios:
            first_free = free_studios[0]
            studio_auto_switched_from = str(chosen_studio_meta.get("name") or chosen_tr_id) if chosen_studio_meta else str(chosen_tr_id)
            chosen_tr_id = first_free["id"]
            chosen_studio_meta = first_free

        req_is_original = bool(
            str(chosen_tr_id) == "238"
            or (chosen_studio_meta and chosen_studio_meta.get("is_original"))
        )

        # Only reuse inline_streams on movies when fresh (<15m) and NOT force_refresh (nocache=1)
        inline_age = time.time() - float(meta.get("_cached_at") or 0)
        if (
            not force_refresh
            and inline_age < 900
            and effective_type == "movie"
            and meta.get("inline_streams")
            and chosen_tr_id == meta.get("raw_default_tr_id")
        ):
            live_streams = dict(meta["inline_streams"])
            live_backups = dict(meta.get("inline_backup_qualities") or {})
            live_hls = dict(meta.get("inline_hls_qualities") or {})
            if not live_subtitles and meta.get("inline_subs"):
                live_subtitles = list(meta.get("inline_subs") or [])

        req_is_prem_locked = bool(chosen_studio_meta and chosen_studio_meta.get("is_prem_locked"))
        primary_mirror_alive = bool(live_streams)
        studio_auto_switched_from = studio_auto_switched_from or ""

        # Fetch exact stream for the requested studio + season/episode via AJAX
        # Always allow probing translator_id=238 (Original) only if not locked behind HDRezka Premium
        can_probe_primary = (not req_is_prem_locked and str(chosen_tr_id) not in skipped_prem_set) or (
            str(chosen_tr_id) == "238" and not any(s["id"] == "238" and (s.get("is_prem_locked") or s["id"] in skipped_prem_set) for s in studios)
        )
        if not live_streams and resolved_id and can_probe_primary and not is_ep_unreleased:
            ajax_bundle, live_subtitles, primary_mirror_alive = self._fetch_ajax_streams_bundle(
                used_mirror,
                resolved_id,
                resolved_url,
                chosen_tr_id,
                effective_type,
                season,
                episode,
            )
            live_streams = ajax_bundle["qualities"]
            live_backups = ajax_bundle["backup_qualities"]
            live_hls = ajax_bundle["hls_qualities"]

        # Fallback across alternate studios when requested studio does not have this episode/stream yet or is premium locked
        if not live_streams and resolved_id and studios and not is_ep_unreleased:
            pref_low = [p.lower() for p in (self.preferred_studios or []) if p]

            def _studio_rank(st_item: Dict[str, Any]) -> int:
                nm = str(st_item.get("name") or "").lower()
                for idx, pf in enumerate(pref_low):
                    if pf in nm:
                        return idx
                return len(pref_low) + 1

            alt_candidates = [
                st_item
                for st_item in studios
                if str(st_item.get("id")) != str(chosen_tr_id)
                and not st_item.get("is_prem_locked")
            ]
            alt_candidates.sort(key=_studio_rank)

            batch_size = 4 if (effective_type == "series" and len(alt_candidates) > 2) else 1
            for start_idx in range(0, len(alt_candidates), batch_size):
                batch = alt_candidates[start_idx : start_idx + batch_size]
                def _probe_alt(st_entry: Dict[str, Any]) -> Tuple[str, Dict[str, Any], List[Dict[str, str]], bool]:
                    aid = str(st_entry["id"])
                    b_map, sb_list, ok_j = self._fetch_ajax_streams_bundle(
                        used_mirror,
                        resolved_id,
                        resolved_url,
                        aid,
                        effective_type,
                        season,
                        episode,
                    )
                    return aid, b_map, sb_list, ok_j

                if len(batch) == 1:
                    raw_res = [_probe_alt(batch[0])]
                else:
                    raw_res = list(self._studio_probe_executor.map(_probe_alt, batch))
                if any(r[3] for r in raw_res):
                    primary_mirror_alive = True

                winner = next((r for r in raw_res if r[1].get("qualities")), None)
                if winner:
                    alt_id, alt_bundle, alt_subs, _ok = winner
                    if chosen_studio_meta:
                        studio_auto_switched_from = str(chosen_studio_meta.get("name") or "")
                    live_streams = alt_bundle["qualities"]
                    live_backups = alt_bundle.get("backup_qualities") or {}
                    live_hls = alt_bundle.get("hls_qualities") or {}
                    live_subtitles = alt_subs
                    chosen_tr_id = alt_id
                    if not translator_id:
                        meta["default_tr_id"] = alt_id
                    break

        # Mirror failover if primary mirror failed to deliver working streams
        if not live_streams and resolved_id and not req_is_prem_locked and not is_ep_unreleased:
            parsed_res = urllib.parse.urlparse(resolved_url)
            rel_path = parsed_res.path or "/"
            failover_bundles: Dict[str, Dict[str, Any]] = {}

            def _fetch_ajax_streams(mirror_b, rid, ref_url, tr, mtype, s_n, e_n):  # noqa: E306
                b_map, sb, _ok = self._fetch_ajax_streams_bundle(mirror_b, rid, ref_url, tr, mtype, s_n, e_n)
                failover_bundles["last"] = b_map
                return b_map["qualities"], sb

            for alt_mirror in self.get_mirrors():
                alt_base = alt_mirror.rstrip("/")
                if alt_base == used_mirror.rstrip("/"):
                    continue
                alt_ref = alt_base + rel_path
                live_streams, live_subtitles = _fetch_ajax_streams(
                    alt_base,
                    resolved_id,
                    alt_ref,
                    chosen_tr_id,
                    effective_type,
                    season,
                    episode,
                )
                if not live_streams:
                    # Warm page on alternate mirror to solve Anubis challenge if needed, then retry AJAX
                    try:
                        self.net.request(
                            alt_ref,
                            proxy_url=self.proxy_url,
                            cf_worker_relay=self.cf_worker_relay,
                            spoof_geo_country=self.spoof_region,
                            timeout=5.0,
                        )
                    except Exception:
                        pass
                    live_streams, live_subtitles = _fetch_ajax_streams(
                        alt_base,
                        resolved_id,
                        alt_ref,
                        chosen_tr_id,
                        effective_type,
                        season,
                        episode,
                    )
                if not live_streams and studios:
                    alt_try = 0
                    for alt_studio in studios:
                        alt_id = alt_studio["id"]
                        if alt_id == str(chosen_tr_id) or alt_studio.get("is_prem_locked"):
                            continue
                        alt_try += 1
                        if alt_try > 2:
                            break
                        s_streams, s_subs = _fetch_ajax_streams(
                            alt_base,
                            resolved_id,
                            alt_ref,
                            alt_id,
                            effective_type,
                            season,
                            episode,
                        )
                        if s_streams:
                            if chosen_studio_meta:
                                studio_auto_switched_from = str(chosen_studio_meta.get("name") or "")
                            live_streams = s_streams
                            live_subtitles = s_subs
                            chosen_tr_id = alt_id
                            break
                if live_streams:
                    last_b = failover_bundles.get("last") or {}
                    live_backups = last_b.get("backup_qualities") or {}
                    live_hls = last_b.get("hls_qualities") or {}
                    used_mirror = alt_base
                    resolved_url = alt_ref
                    if canonical_rezka_url:
                        canonical_rezka_url = alt_ref
                    break

        if (
            not live_streams
            and effective_type == "movie"
            and not req_is_original
            and not force_refresh
            and inline_age < 900
            and meta.get("inline_streams")
        ):
            if meta.get("raw_default_tr_id"):
                raw_def = str(meta["raw_default_tr_id"])
                if raw_def != str(chosen_tr_id) and chosen_studio_meta:
                    studio_auto_switched_from = str(chosen_studio_meta.get("name") or "")
                chosen_tr_id = raw_def
            live_streams = dict(meta["inline_streams"])
            live_backups = dict(meta.get("inline_backup_qualities") or {})
            live_hls = dict(meta.get("inline_hls_qualities") or {})
            if not live_subtitles and meta.get("inline_subs"):
                live_subtitles = list(meta.get("inline_subs") or [])

        # Preserve or fetch native HDRezka subtitles from Original (+subtitles) track when a dubbed studio omits them
        if resolved_id and not is_ep_unreleased:
            ep_sub_key = f"{resolved_id}:{effective_type}:{season}:{episode}"
            now_sub = time.time()
            with self._cache_lock:
                if live_subtitles:
                    if len(self.subtitles_by_ep_cache) >= 256:
                        for k_ev in list(self.subtitles_by_ep_cache.keys())[:64]:
                            self.subtitles_by_ep_cache.pop(k_ev, None)
                            self._subtitles_cache_ts.pop(k_ev, None)
                    self.subtitles_by_ep_cache[ep_sub_key] = list(live_subtitles)
                    self._subtitles_cache_ts[ep_sub_key] = now_sub
                    cached_ep_subs = None
                else:
                    cached_ep_subs = self.subtitles_by_ep_cache.get(ep_sub_key)
                    if cached_ep_subs is not None and (now_sub - self._subtitles_cache_ts.get(ep_sub_key, now_sub)) > 3600.0:
                        self.subtitles_by_ep_cache.pop(ep_sub_key, None)
                        self._subtitles_cache_ts.pop(ep_sub_key, None)
                        cached_ep_subs = None
            if not live_subtitles:
                if not cached_ep_subs and effective_type == "movie" and meta.get("inline_subs"):
                    cached_ep_subs = list(meta["inline_subs"])
                if not cached_ep_subs and not req_is_original:
                    orig_st_for_subs = next(
                        (
                            s
                            for s in studios
                            if (s.get("is_original") or str(s.get("id")) == "238")
                            and not s.get("is_prem_locked")
                            and str(s.get("id")) != str(chosen_tr_id)
                        ),
                        None,
                    )
                    if orig_st_for_subs:
                        try:
                            _, orig_subs, _ = self._fetch_ajax_streams_bundle(
                                used_mirror,
                                resolved_id,
                                resolved_url,
                                str(orig_st_for_subs["id"]),
                                effective_type,
                                season,
                                episode,
                            )
                            if orig_subs:
                                cached_ep_subs = list(orig_subs)
                                with self._cache_lock:
                                    if len(self.subtitles_by_ep_cache) >= 256:
                                        for k_ev in list(self.subtitles_by_ep_cache.keys())[:64]:
                                            self.subtitles_by_ep_cache.pop(k_ev, None)
                                            self._subtitles_cache_ts.pop(k_ev, None)
                                    self.subtitles_by_ep_cache[ep_sub_key] = cached_ep_subs
                                    self._subtitles_cache_ts[ep_sub_key] = now_sub
                        except Exception:
                            pass
                if cached_ep_subs:
                    live_subtitles = list(cached_ep_subs)

        selected_studio = next(
            (s for s in studios if s["id"] == str(chosen_tr_id)),
            studios[0] if studios else {"id": "111", "name": "HDRezka Studio", "lang": "RU", "badge": "1080p"},
        )

        default_quality = next(iter(live_streams.keys()), "1080p")
        default_stream_url = live_streams.get(default_quality, "")
        strict_original_pref = bool(
            req_is_original and (bool(translator_id) or prefer_original or ui_lang == "en")
        )
        needs_original_fallback = bool(
            req_is_original and (not live_streams or (strict_original_pref and studio_auto_switched_from))
        )
        stream_unavailable = not bool(default_stream_url)
        episode_unavailable = bool(
            effective_type == "series"
            and stream_unavailable
            and (
                is_ep_unreleased
                or is_ep_prem_locked
                or (seasons_map and int(episode) not in (seasons_map.get(str(season)) or []))
            )
        )

        return {
            "provider": "hdrezka",
            "rezka_id": resolved_id,
            "rezka_url": canonical_rezka_url,
            "page_imdb_id": meta.get("page_imdb_id", ""),
            "title": title,
            "orig_title": orig_title,
            "year": year,
            "media_type": media_type,
            "season": season,
            "episode": episode,
            "seasons_map": meta.get("seasons_map", {}),
            "prem_episodes_map": meta.get("prem_episodes_map", {}),
            "episodes_titles": meta.get("episodes_titles", {}),
            "episodes_meta": meta.get("episodes_meta", {}),
            "latest_season": meta.get("latest_season", season),
            "latest_episode": meta.get("latest_episode", episode),
            "is_completed": bool(meta.get("is_completed", False)),
            "series_status_text": meta.get("series_status_text", ""),
            "description": meta.get("description", ""),
            "age_rating": meta.get("age_rating", ""),
            "directors": meta.get("directors", []),
            "actors": meta.get("actors", []),
            "cast_people": meta.get("cast_people", []),
            "duration_label": meta.get("duration_label", ""),
            "genres": meta.get("genres", []),
            "countries": meta.get("countries", []),
            "selected_studio": selected_studio,
            "selected_translator_id": str(selected_studio.get("id") or chosen_tr_id),
            "selected_studio_name": str(selected_studio.get("name") or ""),
            "studio_auto_switched_from": studio_auto_switched_from,
            "studios": free_studios if free_studios else studios,
            "qualities": live_streams,
            "backup_qualities": live_backups,
            "hls_qualities": live_hls,
            "default_quality": default_quality,
            "default_stream_url": default_stream_url,
            "subtitles": live_subtitles,
            "stream_unavailable": stream_unavailable,
            "episode_unavailable": episode_unavailable,
            "is_unreleased": is_ep_unreleased,
            "is_prem_locked": bool(stream_unavailable and (is_ep_prem_locked or req_is_prem_locked)),
            "needs_original_fallback": needs_original_fallback,
            "original_preferred": strict_original_pref,
            "mirror": used_mirror,
            "geo_bypass": {
                "enabled": True,
                "user_region": "PL (Poland)",
                "api_relay_region": self.spoof_region,
                "status_text": (
                    "1080p No registration • Direct stream"
                    if ui_lang == "en"
                    else "1080p Без регистрации • Прямой поток"
                ),
            },
        }

    def check_series_latest_episodes(
        self,
        series_items: List[Dict[str, Any]],
        batch_limit: int = 20,
    ) -> List[Dict[str, Any]]:
        from .hdrezka_extras import check_series_latest_episodes as _check_series_latest_episodes
        return _check_series_latest_episodes(self, series_items, batch_limit=batch_limit)

    def _is_youtube_embeddable(self, vid: str) -> bool:
        from .hdrezka_extras import _is_youtube_embeddable as _is_yt_emb
        return _is_yt_emb(self, vid)

    def _search_youtube_video_id(self, query: str) -> str:
        from .hdrezka_extras import _search_youtube_video_id as _search_yt
        return _search_yt(self, query)

    def get_trailer_for_title(
        self,
        item_id: str,
        title: str,
        orig_title: str = "",
        year: int = 0,
        media_type: str = "movie",
        rezka_url: Optional[str] = None,
        rezka_id: str = "",
        imdb_id: str = "",
    ) -> Dict[str, Any]:
        from .hdrezka_extras import get_trailer_for_title as _get_trailer_for_title
        return _get_trailer_for_title(
            self,
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            year=year,
            media_type=media_type,
            rezka_url=rezka_url,
            rezka_id=rezka_id,
            imdb_id=imdb_id,
        )

    def _fetch_wiki_json(self, url: str, timeout: float = 2.8) -> Dict[str, Any]:
        from .hdrezka_extras import _fetch_wiki_json as _fetch_wiki
        return _fetch_wiki(self, url, timeout=timeout)

    def resolve_person_photo(self, name: str) -> str:
        from .hdrezka_extras import resolve_person_photo as _resolve_person_photo
        return _resolve_person_photo(self, name)

    def find_cached_person_url(self, target_name: str) -> str:
        from .hdrezka_extras import find_cached_person_url as _find_cached_person_url
        return _find_cached_person_url(self, target_name)

    @staticmethod
    def _normalize_wiki_person_title(raw_title: str) -> str:
        from .hdrezka_extras import _normalize_wiki_person_title as _norm_wiki_title
        return _norm_wiki_title(raw_title)

    def get_person_details(self, name: str, hint_url: str = "") -> Dict[str, Any]:
        from .hdrezka_extras import get_person_details as _get_person_details
        return _get_person_details(self, name=name, hint_url=hint_url)
