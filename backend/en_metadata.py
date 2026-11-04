import atexit
import copy
from datetime import datetime, timedelta, timezone
import gzip
import html
import http.client
import io
import ipaddress
import json
import os
import re
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional

from .storage_db import get_storage_db

_SHARED_SSL_CTX = ssl.create_default_context()


from .translit_en import (
    ISO_COUNTRIES_EN,
    RU_COUNTRIES_TO_EN,
    RU_GENRES_TO_EN,
    _CYR_TO_LAT,
    _CYRILLIC_RE,
    _POLISH_POSTER_SLUGS,
    _RU_CAREER_TO_EN,
    _RU_MONTHS_GENITIVE_TO_EN,
    _consonant_skeleton,
    _names_match_ru_en,
    _phonetic_key,
    build_english_cast_people,
    has_cyrillic,
    is_localized_non_en_image_url,
    resolve_original_backdrop_url,
    resolve_original_poster_url,
    translate_birth_date_en,
    translate_birth_place_en,
    translate_career_role_en,
    translate_kinorium_extra_desc_to_en,
    transliterate_cyrillic,
)


class EnglishMetadataResolver:
    """
    Fast, disk-cached resolver for 100% English metadata, original-language US/UK posters,
    English directors & cast, English episode titles, and Critics (%) ratings via
    JustWatch US GraphQL (`country: "US", language: "en"`) + Stremio Cinemeta.
    """

    JW_GRAPHQL_URL = "https://apis.justwatch.com/graphql"
    CINEMETA_BASE = "https://v3-cinemeta.strem.io"

    _JW_QUERY = """
    query SearchEnglishMeta($searchQuery: String!, $country: Country!, $language: Language!) {
      popularTitles(country: $country, first: 6, filter: {searchQuery: $searchQuery}) {
        edges {
          node {
            id
            objectType
            objectId
            content(country: $country, language: $language) {
              title
              originalReleaseYear
              shortDescription
              runtime
              productionCountries
              posterUrl(profile: S592, format: WEBP)
              backdropUrl: backdrops(profile: S1920, format: WEBP) {
                backdropUrl
              }
              externalIds {
                imdbId
                tmdbId
              }
              scoring {
                imdbScore
                tomatoMeter
              }
              genres {
                shortName
                translation(language: $language)
              }
              credits {
                role
                name
              }
            }
          }
        }
      }
    }
    """

    def __init__(
        self,
        cache_path: str,
        net_client: Optional[Any] = None,
        kinorium_html_fetcher: Optional[Any] = None,
    ):
        self.cache_path = cache_path
        self.net = net_client
        self.kinorium_html_fetcher = kinorium_html_fetcher
        self._lock = threading.Lock()
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._dirty_count = 0
        storage_dir = os.path.dirname(os.path.abspath(cache_path)) or "."
        self._db = get_storage_db(storage_dir)
        self._load()
        atexit.register(self._flush_on_exit)

    def _flush_on_exit(self) -> None:
        with self._lock:
            if self._dirty_count <= 0:
                return
        self._save(force=True)

    def _load(self) -> None:
        try:
            db_map = self._db.load_cache_dict("en_meta", max_entries=5000)
            if db_map:
                self._cache = {k: v for k, v in db_map.items() if isinstance(v, dict) and v.get("ok")}
                return
            if os.path.exists(self.cache_path):
                with open(self.cache_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    self._cache = {
                        k: v for k, v in data.items() if isinstance(v, dict) and v.get("ok")
                    }
                    if self._cache:
                        self._db.save_cache_dict("en_meta", self._cache, max_entries=5000)
        except Exception:
            self._cache = {}

    def _save(self, force: bool = False) -> None:
        with self._lock:
            self._dirty_count += 1
            if not force and self._dirty_count < 3:
                return
            self._dirty_count = 0
            snapshot = {k: v for k, v in self._cache.items() if isinstance(v, dict) and v.get("ok")}
        try:
            self._db.save_cache_dict("en_meta", snapshot, max_entries=5000)
        except Exception:
            pass

    def _make_key(
        self,
        item_id: str,
        orig_title: str,
        title: str,
        year: int,
        media_type: str,
        imdb_id: str,
    ) -> str:
        if imdb_id and re.match(r"^tt\d{5,10}$", imdb_id):
            return f"imdb:{imdb_id}"
        if item_id and re.match(r"^tt\d{5,10}$", item_id):
            return f"imdb:{item_id}"
        if item_id and item_id.startswith("kin_"):
            return f"kin:{item_id[4:]}"
        q = (orig_title or title or item_id or "").strip().lower()
        return f"q:{media_type or 'any'}:{year or 0}:{q}"

    def get_cached(
        self,
        item_id: str = "",
        title: str = "",
        orig_title: str = "",
        year: int = 0,
        media_type: str = "",
        imdb_id: str = "",
    ) -> Optional[Dict[str, Any]]:
        key = self._make_key(item_id, orig_title, title, year, media_type, imdb_id)
        with self._lock:
            entry = self._cache.get(key)
        if not entry:
            return None
        now = time.time()
        entry_ts = float(entry.get("ts") or 0)
        ttl = 86400 * 14 if entry.get("ok") else 900
        if now - entry_ts > ttl:
            return None
        out = copy.deepcopy(entry)
        ep_meta_en = out.get("episodes_meta_en")
        has_future_ep = False
        if isinstance(ep_meta_en, dict) and ep_meta_en:
            utc_today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            for _sk, s_eps in ep_meta_en.items():
                if not isinstance(s_eps, dict):
                    continue
                for _ek, ev in s_eps.items():
                    if not isinstance(ev, dict):
                        continue
                    air_d = str(ev.get("air_date") or "")[:10]
                    if re.match(r"^\d{4}-\d{2}-\d{2}$", air_d):
                        ev["is_future"] = bool(air_d > utc_today)
                    if ev.get("is_future"):
                        has_future_ep = True
        if out.get("episodes_fetched") and (now - entry_ts) > 21600:
            if not ep_meta_en or has_future_ep:
                out["episodes_fetched"] = False
        return out

    @staticmethod
    def _decode_json_dict(raw_bytes: bytes, content_encoding: str = "") -> Optional[Dict[str, Any]]:
        max_compressed = 4 * 1024 * 1024
        if len(raw_bytes) > max_compressed:
            return None
        if raw_bytes[:2] == b"\x1f\x8b":
            max_inflated = 8 * 1024 * 1024
            try:
                with gzip.GzipFile(fileobj=io.BytesIO(raw_bytes)) as gz:
                    raw_bytes = gz.read(max_inflated + 1)
            except (EOFError, OSError, zlib.error):
                raw_bytes = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(raw_bytes, max_inflated + 1)
            if not raw_bytes or len(raw_bytes) > max_inflated:
                return None
        parsed = json.loads(raw_bytes.decode("utf-8", errors="replace"))
        return parsed if isinstance(parsed, dict) else None

    @staticmethod
    def _is_safe_public_http_url(url: str) -> bool:
        from .stremio import StremioAddonEngine
        return StremioAddonEngine.is_safe_public_http_url(url)

    def _open_json_request(self, req: urllib.request.Request, timeout: float) -> Optional[Dict[str, Any]]:
        from .stremio import StremioAddonEngine

        is_safe = self._is_safe_public_http_url

        def _verify_peer_socket(sock_obj: Any) -> None:
            peer_ip_raw = str(sock_obj.getpeername()[0]).split("%", 1)[0]
            peer_ip_obj = ipaddress.ip_address(peer_ip_raw)
            if StremioAddonEngine._is_disallowed_ip(peer_ip_obj):
                raise urllib.error.URLError(f"Disallowed peer IP: {peer_ip_raw}")

        class _SafeHTTPConnection(http.client.HTTPConnection):
            def connect(self):
                super().connect()
                try:
                    _verify_peer_socket(self.sock)
                except Exception:
                    try:
                        self.close()
                    except Exception:
                        pass
                    raise

        class _SafeHTTPSConnection(http.client.HTTPSConnection):
            def connect(self):
                http.client.HTTPConnection.connect(self)
                try:
                    _verify_peer_socket(self.sock)
                except Exception:
                    try:
                        self.close()
                    except Exception:
                        pass
                    raise
                server_hostname = self._tunnel_host if self._tunnel_host else self.host
                if isinstance(server_hostname, str):
                    server_hostname = server_hostname.rstrip(".")
                self.sock = self._context.wrap_socket(self.sock, server_hostname=server_hostname)

        class _SafeHTTPHandler(urllib.request.HTTPHandler):
            def http_open(self, r_req):
                return self.do_open(_SafeHTTPConnection, r_req)

        class _SafeHTTPSHandler(urllib.request.HTTPSHandler):
            def https_open(self, r_req):
                return self.do_open(_SafeHTTPSConnection, r_req, context=self._context)

        class _SafeRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, r_req, fp, code, msg, headers, newurl):
                resolved_url = urllib.parse.urljoin(r_req.full_url, str(newurl or ""))
                if not is_safe(resolved_url):
                    if fp is not None:
                        try:
                            fp.close()
                        except Exception:
                            pass
                    raise urllib.error.URLError("Disallowed redirect target")
                return super().redirect_request(r_req, fp, code, msg, headers, resolved_url)

        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            _SafeHTTPHandler(),
            _SafeHTTPSHandler(context=_SHARED_SSL_CTX),
            _SafeRedirect(),
        )
        with opener.open(req, timeout=timeout) as resp:
            if getattr(resp, "status", 200) != 200:
                return None
            raw = resp.read(4 * 1024 * 1024 + 1)
            enc = str(resp.headers.get("Content-Encoding") or "")
            return self._decode_json_dict(raw, content_encoding=enc)

    def _http_post_json(self, url: str, payload: Dict[str, Any], timeout: float = 5.5) -> Optional[Dict[str, Any]]:
        if not self._is_safe_public_http_url(url):
            return None
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Accept-Encoding": "gzip, identity",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        }
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            return self._open_json_request(req, timeout=timeout)
        except Exception as exc:
            if "Disallowed" not in str(exc) and self.net is not None:
                try:
                    status, body_text, resp_hdrs = self.net.request(
                        url,
                        method="POST",
                        headers=headers,
                        data=body,
                        spoof_geo_country="DIRECT",
                        timeout=int(max(3, round(timeout))),
                    )
                    final_u = str((resp_hdrs or {}).get("_final_url") or url)
                    if status == 200 and body_text and self._is_safe_public_http_url(final_u):
                        parsed = json.loads(body_text)
                        return parsed if isinstance(parsed, dict) else None
                except Exception:
                    pass
            return None

    def _http_get_json(self, url: str, timeout: float = 4.5) -> Optional[Dict[str, Any]]:
        if not self._is_safe_public_http_url(url):
            return None
        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "gzip, identity",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        }
        try:
            req = urllib.request.Request(url, headers=headers, method="GET")
            return self._open_json_request(req, timeout=timeout)
        except Exception as exc:
            if "Disallowed" not in str(exc) and self.net is not None:
                try:
                    status, body_text, resp_hdrs = self.net.request(
                        url,
                        method="GET",
                        headers=headers,
                        spoof_geo_country="DIRECT",
                        timeout=int(max(3, round(timeout))),
                    )
                    final_u = str((resp_hdrs or {}).get("_final_url") or url)
                    if status == 200 and body_text and self._is_safe_public_http_url(final_u):
                        parsed = json.loads(body_text)
                        return parsed if isinstance(parsed, dict) else None
                except Exception:
                    pass
            return None

    def _query_kinorium_en_search(
        self,
        query_str: str,
        year: int = 0,
        kinorium_id: str = "",
    ) -> Optional[Dict[str, Any]]:
        q_clean = re.sub(r"[\s\xa0]+", " ", (query_str or "")).strip()
        if not q_clean:
            return None
        url = f"https://en.kinorium.com/handlers/Search/?str={urllib.parse.quote(q_clean)}"
        xhr_headers = {
            "X-Requested-With": "XMLHttpRequest",
            "Referer": "https://en.kinorium.com/",
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "en-US,en;q=0.9",
            "Cookie": "",
        }
        data: Optional[Dict[str, Any]] = None
        if callable(self.kinorium_html_fetcher):
            try:
                raw_txt = self.kinorium_html_fetcher(url, extra_headers=xhr_headers)
                if raw_txt and raw_txt.strip().startswith("{"):
                    data = json.loads(raw_txt)
            except Exception:
                data = None
        if data is None:
            data = self._http_get_json(url, timeout=4.0)
        if not isinstance(data, dict):
            return None

        def _norm_cmp(val: str) -> str:
            s = html.unescape(str(val or "")).lower().replace("ё", "е")
            s = re.sub(r"[\s\xa0«»\"'„“”.,:;!?–—-]+", " ", s).strip()
            return s

        eff_kid = str(kinorium_id or "").strip()
        q_cmp = _norm_cmp(q_clean)
        best_entry: Optional[Dict[str, Any]] = None
        for entry in data.get("list") or []:
            if not isinstance(entry, dict):
                continue
            if str(entry.get("mixtype") or "") != "movie":
                continue
            eid = str(entry.get("id") or "").strip()
            if not eid.isdigit():
                continue
            if eff_kid and eff_kid.isdigit():
                if eid == eff_kid:
                    best_entry = entry
                    break
                continue
            en_name = re.sub(r"[\s\xa0]+", " ", html.unescape(str(entry.get("name") or ""))).strip()
            orig_n = re.sub(r"[\s\xa0]+", " ", html.unescape(str(entry.get("name_orig") or entry.get("orig") or ""))).strip()
            if has_cyrillic(en_name):
                continue
            cand_orig_cmp = _norm_cmp(orig_n)
            cand_en_cmp = _norm_cmp(en_name)
            if q_cmp and (cand_orig_cmp == q_cmp or cand_en_cmp == q_cmp):
                yr_raw = str(entry.get("year_serial_b") or entry.get("year") or "")
                ym = re.search(r"\b(19\d\d|20\d\d)\b", yr_raw)
                yr_num = int(ym.group(1)) if ym else 0
                try:
                    req_yr = int(year or 0)
                except (TypeError, ValueError):
                    req_yr = 0
                if not req_yr or not yr_num or abs(yr_num - req_yr) <= 1:
                    best_entry = entry
                    break

        if not best_entry:
            return None
        en_title = re.sub(r"[\s\xa0]+", " ", html.unescape(str(best_entry.get("name") or ""))).strip()
        if not en_title or has_cyrillic(en_title):
            return None
        eid_res = str(best_entry.get("id") or eff_kid)
        return {
            "title_en": en_title,
            "poster_en": f"https://en-images.kinorium.com/movie/600/{eid_res}.jpg" if eid_res.isdigit() else "",
        }

    def _query_justwatch_us(
        self,
        query_str: str,
        year: int = 0,
        media_type: str = "",
        imdb_id: str = "",
    ) -> Optional[Dict[str, Any]]:
        if not query_str:
            return None
        data = self._http_post_json(
            self.JW_GRAPHQL_URL,
            {
                "query": self._JW_QUERY,
                "variables": {
                    "searchQuery": query_str,
                    "country": "US",
                    "language": "en",
                },
            },
            timeout=5.5,
        )
        edges = (((data or {}).get("data") or {}).get("popularTitles") or {}).get("edges") or []
        if not edges:
            return None

        q_low = query_str.strip().lower()
        want_obj_type = "SHOW" if media_type == "series" else ("MOVIE" if media_type == "movie" else "")
        try:
            target_yr = int(year or 0)
        except (TypeError, ValueError):
            target_yr = 0

        best_score = -999.0
        best_node: Optional[Dict[str, Any]] = None
        best_trusted = False
        imdb_exact_hit = False
        for idx, edge in enumerate(edges):
            node = (edge or {}).get("node") or {}
            content = node.get("content") or {}
            c_title = str(content.get("title") or "").strip()
            if not c_title:
                continue
            ext = content.get("externalIds") or {}
            c_imdb = str(ext.get("imdbId") or "").strip()
            if imdb_id and c_imdb and c_imdb == imdb_id:
                best_node = node
                imdb_exact_hit = True
                break
            if imdb_id and c_imdb and c_imdb != imdb_id:
                # Known IMDb id that differs: definitely another title
                continue

            sc = max(0.0, 20.0 - idx * 3.0)
            obj_type = str(node.get("objectType") or "")
            type_ok = (not want_obj_type) or obj_type == want_obj_type
            if want_obj_type:
                if obj_type == want_obj_type:
                    sc += 25.0
                else:
                    sc -= 20.0

            try:
                c_year = int(content.get("originalReleaseYear") or 0)
            except (TypeError, ValueError):
                c_year = 0

            c_low = c_title.lower()
            title_ratio = SequenceMatcher(None, q_low, c_low).ratio()
            title_match = bool(c_low == q_low or title_ratio >= 0.8)
            if c_low == q_low:
                sc += 45.0
            else:
                shorter, longer = (q_low, c_low) if len(q_low) <= len(c_low) else (c_low, q_low)
                is_subtitle_prefix = bool(
                    len(shorter) >= 4
                    and (longer.startswith(shorter + ":") or longer.startswith(shorter + " -"))
                )
                word_contained = bool(
                    len(shorter) >= 4
                    and (len(shorter.split()) >= 2 or is_subtitle_prefix)
                    and re.search(rf"(?<!\w){re.escape(shorter)}(?!\w)", longer)
                )
                year_close = bool(
                    (target_yr and c_year and abs(target_yr - c_year) <= (1 if len(shorter.split()) < 2 else 2))
                    or (not target_yr and len(shorter.split()) >= 2)
                )
                if word_contained and year_close:
                    sc += 18.0
                    title_match = True
                else:
                    sc += title_ratio * 25.0

            if target_yr and c_year:
                diff = abs(target_yr - c_year)
                if diff == 0:
                    sc += 30.0
                elif diff == 1:
                    sc += 16.0
                elif diff <= 2 and want_obj_type == "SHOW":
                    sc += 6.0
                elif diff >= 4:
                    sc -= 28.0
                    if c_low != q_low:
                        title_match = False

            # A candidate is only trustworthy with a real title match (or exact IMDb match handled above).
            # Never trust a Cyrillic query against an English title solely because the release year matched.
            trusted = bool(type_ok and title_match)
            if sc > best_score:
                best_score = sc
                best_node = node
                best_trusted = trusted

        if not best_node:
            return None
        if not imdb_exact_hit and (not best_trusted or best_score < 45.0):
            return None

        content = best_node.get("content") or {}
        ext = content.get("externalIds") or {}
        scoring = content.get("scoring") or {}
        poster_rel = str(content.get("posterUrl") or "").strip()
        poster_en = f"https://images.justwatch.com{poster_rel}" if poster_rel.startswith("/") else poster_rel

        backdrops = content.get("backdropUrl") or []
        backdrop_en = ""
        if isinstance(backdrops, list) and backdrops:
            b_rel = str((backdrops[0] or {}).get("backdropUrl") or "").strip()
            if b_rel:
                backdrop_en = f"https://images.justwatch.com{b_rel}" if b_rel.startswith("/") else b_rel

        prod_codes = [str(c).upper() for c in (content.get("productionCountries") or []) if c]
        countries_en = [ISO_COUNTRIES_EN.get(code, code) for code in prod_codes[:4]]

        genres_en: List[str] = []
        for g in content.get("genres") or []:
            gt = str((g or {}).get("translation") or "").strip()
            if gt and gt not in genres_en:
                genres_en.append(gt)

        directors_en: List[str] = []
        actors_en: List[str] = []
        for cr in content.get("credits") or []:
            role = str((cr or {}).get("role") or "").upper()
            cname = str((cr or {}).get("name") or "").strip()
            if not cname or has_cyrillic(cname):
                continue
            if role in ("DIRECTOR", "CREATOR") and cname not in directors_en:
                directors_en.append(cname)
            elif role == "ACTOR" and cname not in actors_en:
                actors_en.append(cname)

        tomato = scoring.get("tomatoMeter")
        critics_pct: Optional[int] = None
        if tomato is not None:
            try:
                tv = int(round(float(tomato)))
                if 0 < tv <= 100:
                    critics_pct = tv
            except Exception:
                pass

        runtime_min = 0
        try:
            runtime_min = max(0, int(content.get("runtime") or 0))
        except Exception:
            runtime_min = 0

        imdb_score_val = 0.0
        try:
            imdb_score_val = max(0.0, float(scoring.get("imdbScore") or 0.0))
        except (TypeError, ValueError):
            imdb_score_val = 0.0
        try:
            out_year = int(content.get("originalReleaseYear") or target_yr or 0)
        except (TypeError, ValueError):
            out_year = target_yr

        jw_title_en = str(content.get("title") or "").strip()
        if has_cyrillic(jw_title_en):
            jw_title_en = ""
        jw_desc_en = str(content.get("shortDescription") or "").strip()
        if has_cyrillic(jw_desc_en):
            jw_desc_en = ""
        clean_genres_en = [g for g in genres_en if g and not has_cyrillic(g)]
        return {
            "title_en": jw_title_en,
            "year": out_year,
            "description_en": jw_desc_en,
            "runtime_min": runtime_min,
            "countries_en": countries_en,
            "genres_en": clean_genres_en[:4],
            "poster_en": poster_en,
            "backdrop_en": backdrop_en,
            "imdb_id": str(ext.get("imdbId") or imdb_id or "").strip(),
            "imdb_score": imdb_score_val,
            "critics_pct": critics_pct,
            "directors_en": directors_en[:4],
            "actors_en": actors_en[:14],
            "media_type": "series" if str(best_node.get("objectType") or "") == "SHOW" else "movie",
        }

    def _query_cinemeta(self, imdb_id: str, media_type: str = "", include_episodes: bool = True) -> Optional[Dict[str, Any]]:
        if not imdb_id or not re.match(r"^tt\d{5,10}$", imdb_id):
            return None
        types_to_try = (
            ["series", "movie"]
            if media_type == "series"
            else (["movie", "series"] if media_type == "movie" else ["movie", "series"])
        )
        now_utc = datetime.now(timezone.utc)
        utc_today = now_utc.strftime("%Y-%m-%d")
        stale_cutoff_iso = (now_utc - timedelta(days=180)).strftime("%Y-%m-%d")
        for ctype in types_to_try:
            url = f"{self.CINEMETA_BASE}/meta/{ctype}/{imdb_id}.json"
            data = self._http_get_json(url, timeout=4.5)
            meta = (data or {}).get("meta") if isinstance(data, dict) else None
            if not isinstance(meta, dict) or not meta.get("name"):
                continue

            directors = [
                str(x).strip()
                for x in (meta.get("director") or meta.get("writer") or [])
                if str(x).strip() and not has_cyrillic(str(x))
            ]
            actors = [
                str(x).strip()
                for x in (meta.get("cast") or [])
                if str(x).strip() and not has_cyrillic(str(x))
            ]
            runtime_str = str(meta.get("runtime") or "").strip()
            m_rt = re.search(r"(\d+)", runtime_str)
            runtime_min = int(m_rt.group(1)) if m_rt else 0

            country_raw = str(meta.get("country") or "").strip()
            countries_en = [
                ISO_COUNTRIES_EN.get(c.strip().upper(), c.strip())
                for c in country_raw.split(",")
                if c.strip() and not has_cyrillic(c)
            ]

            cm_imdb_score = 0.0
            try:
                cm_imdb_score = max(0.0, float(meta.get("imdbRating") or 0.0))
            except (TypeError, ValueError):
                cm_imdb_score = 0.0

            episodes_titles_en: Dict[str, Dict[str, str]] = {}
            episodes_meta_en: Dict[str, Dict[str, Dict[str, Any]]] = {}
            if include_episodes and ctype == "series" and isinstance(meta.get("videos"), list):
                any_dated = False
                had_dated_released = False
                max_aired_season = 0
                max_aired_ep = 0
                max_aired_date = ""
                min_dated_season: Optional[int] = None
                for vid in meta["videos"]:
                    if not isinstance(vid, dict):
                        continue
                    try:
                        sn = int(vid.get("season") or 0)
                        ep = int(vid.get("episode") or vid.get("number") or 0)
                    except Exception:
                        continue
                    if sn <= 0 or ep <= 0:
                        continue
                    sn_k = str(sn)
                    ep_k = str(ep)
                    raw_ep_title = str(vid.get("name") or vid.get("title") or "").strip()
                    clean_ep_title = ""
                    if (
                        raw_ep_title
                        and not has_cyrillic(raw_ep_title)
                        and not re.match(r"^Episode\s+\d+$", raw_ep_title, re.I)
                    ):
                        clean_ep_title = raw_ep_title
                    ep_overview = str(vid.get("overview") or vid.get("description") or "").strip()
                    if has_cyrillic(ep_overview):
                        ep_overview = ""
                    ep_thumb = str(vid.get("thumbnail") or "").strip()
                    ep_rel = str(vid.get("released") or "")[:10]
                    if ep_rel and not re.match(r"^\d{4}-\d{2}-\d{2}$", ep_rel):
                        ep_rel = ""
                    prev_m = episodes_meta_en.get(sn_k, {}).get(ep_k)
                    if prev_m is not None:
                        if not clean_ep_title and prev_m.get("title"):
                            clean_ep_title = str(prev_m["title"])
                        if not ep_overview and prev_m.get("overview"):
                            ep_overview = str(prev_m["overview"])
                        if not ep_thumb and prev_m.get("still"):
                            ep_thumb = str(prev_m["still"])
                        if not ep_rel and prev_m.get("air_date"):
                            ep_rel = str(prev_m["air_date"])
                    if ep_rel:
                        any_dated = True
                        if min_dated_season is None or sn < min_dated_season:
                            min_dated_season = sn
                        if ep_rel <= utc_today:
                            had_dated_released = True
                            if ep_rel > max_aired_date:
                                max_aired_date = ep_rel
                            if (sn, ep) > (max_aired_season, max_aired_ep):
                                max_aired_season, max_aired_ep = sn, ep
                    if clean_ep_title:
                        episodes_titles_en.setdefault(sn_k, {})[ep_k] = clean_ep_title
                    episodes_meta_en.setdefault(sn_k, {})[ep_k] = {
                        "title": clean_ep_title,
                        "overview": ep_overview,
                        "still": ep_thumb,
                        "air_date": ep_rel,
                        "is_future": bool(ep_rel and ep_rel > utc_today),
                    }
                if any_dated:
                    for sn_k_u, s_eps_map in episodes_meta_en.items():
                        s_int = int(sn_k_u)
                        has_future_dated_in_season = any(
                            bool(ev.get("air_date") and ev.get("is_future")) for ev in s_eps_map.values()
                        )
                        for ek, ev in s_eps_map.items():
                            if not str(ek).isdigit() or ev.get("air_date"):
                                continue
                            ep_n = int(ek)
                            is_prior = bool(
                                (had_dated_released and (s_int < max_aired_season or (s_int, ep_n) < (max_aired_season, max_aired_ep)))
                                or (min_dated_season is not None and s_int < min_dated_season)
                                or (
                                    had_dated_released
                                    and s_int == max_aired_season
                                    and not has_future_dated_in_season
                                    and bool(max_aired_date and max_aired_date <= stale_cutoff_iso)
                                )
                            )
                            ev["is_future"] = not is_prior

            cm_title_en = str(meta.get("name") or "").strip()
            if has_cyrillic(cm_title_en):
                cm_title_en = ""
            cm_desc_en = str(meta.get("description") or "").strip()
            if has_cyrillic(cm_desc_en):
                cm_desc_en = ""
            cm_genres_en = [
                str(g).strip()
                for g in (meta.get("genres") or [])
                if str(g).strip() and not has_cyrillic(str(g))
            ][:4]
            poster = str(meta.get("poster") or f"https://images.metahub.space/poster/medium/{imdb_id}/img").strip()
            return {
                "title_en": cm_title_en,
                "description_en": cm_desc_en,
                "runtime_min": runtime_min,
                "countries_en": countries_en[:4],
                "genres_en": cm_genres_en,
                "poster_en": poster,
                "backdrop_en": str(meta.get("background") or "").strip(),
                "imdb_id": imdb_id,
                "imdb_score": cm_imdb_score,
                "directors_en": directors[:4],
                "actors_en": actors[:14],
                "episodes_titles_en": episodes_titles_en,
                "episodes_meta_en": episodes_meta_en,
                "episodes_fetched": bool(include_episodes and ctype == "series" and episodes_meta_en),
                "media_type": ctype,
            }
        return None

    def resolve(
        self,
        item_id: str = "",
        title: str = "",
        orig_title: str = "",
        year: int = 0,
        media_type: str = "",
        imdb_id: str = "",
        kinorium_id: str = "",
        need_episodes: bool = False,
    ) -> Dict[str, Any]:
        eff_imdb = imdb_id or (item_id if str(item_id).startswith("tt") else "")
        cached = self.get_cached(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            year=year,
            media_type=media_type,
            imdb_id=eff_imdb,
        )
        now_ts = time.time()
        reusing_cached_base = False
        if cached is not None:
            if not cached.get("ok"):
                return cached
            if not (need_episodes and media_type == "series" and not cached.get("episodes_fetched")):
                return cached
            last_ep_attempt = float(cached.get("episodes_attempted_ts") or 0.0)
            if last_ep_attempt and (now_ts - last_ep_attempt) < 600:
                return cached
            if not eff_imdb and cached.get("imdb_id"):
                eff_imdb = str(cached["imdb_id"]).strip()
            reusing_cached_base = bool(cached.get("description_en") and cached.get("poster_en"))
        if cached and cached.get("ok") is False and (now_ts - float(cached.get("ts") or 0)) < 900:
            # Recent negative result: don't repeat JustWatch + Cinemeta + Kinorium on every catalog load
            return cached

        search_q = ""
        if orig_title and not has_cyrillic(orig_title):
            search_q = orig_title.strip()
        elif title and not has_cyrillic(title):
            search_q = title.strip()
        elif cached and cached.get("title_en") and not has_cyrillic(str(cached.get("title_en"))):
            search_q = str(cached["title_en"]).strip()

        kin_en_early: Optional[Dict[str, Any]] = None
        if not search_q and not eff_imdb and (title or orig_title or kinorium_id):
            kin_en_early = self._query_kinorium_en_search(
                query_str=(title or orig_title).strip(),
                year=year,
                kinorium_id=kinorium_id or (item_id[4:] if str(item_id or "").startswith("kin_") else ""),
            )
            if kin_en_early and kin_en_early.get("title_en") and not has_cyrillic(str(kin_en_early["title_en"])):
                search_q = str(kin_en_early["title_en"]).strip()

        cm_data: Optional[Dict[str, Any]] = None
        cm_queried_imdb = ""
        if eff_imdb and (not search_q or need_episodes or media_type == "series"):
            cm_queried_imdb = eff_imdb
            cm_data = self._query_cinemeta(eff_imdb, media_type=media_type, include_episodes=need_episodes)
            if cm_data and not search_q:
                search_q = cm_data.get("title_en") or ""

        if not search_q and (orig_title or title):
            search_q = (orig_title or title).strip()

        jw_data: Optional[Dict[str, Any]] = None
        if reusing_cached_base and cached is not None:
            jw_data = dict(cached)
        else:
            jw_data = self._query_justwatch_us(
                query_str=search_q,
                year=year,
                media_type=media_type,
                imdb_id=eff_imdb,
            )
            if jw_data is None and title and title.strip() and not has_cyrillic(title) and title.strip().lower() != search_q.lower():
                jw_data = self._query_justwatch_us(
                    query_str=title.strip(),
                    year=year,
                    media_type=media_type,
                    imdb_id=eff_imdb,
                )

        resolved_imdb = eff_imdb or str((jw_data or {}).get("imdb_id") or "").strip()
        if resolved_imdb and cm_data is None and resolved_imdb != cm_queried_imdb and (
            need_episodes
            or not jw_data
            or not (jw_data.get("directors_en") or [])
            or not jw_data.get("description_en")
        ):
            cm_queried_imdb = resolved_imdb
            cm_data = self._query_cinemeta(
                resolved_imdb,
                media_type=media_type or str((jw_data or {}).get("media_type") or ""),
                include_episodes=need_episodes,
            )

        if not jw_data and not cm_data:
            kin_en = kin_en_early or self._query_kinorium_en_search(
                query_str=(title or orig_title).strip(),
                year=year,
                kinorium_id=kinorium_id or (item_id[4:] if str(item_id or "").startswith("kin_") else ""),
            )
            if kin_en and kin_en.get("title_en"):
                jw_data = kin_en

        if not jw_data and not cm_data:
            if cached and cached.get("ok"):
                return cached
            neg = {
                "ok": False,
                "ts": time.time(),
                "poster_en": resolve_original_poster_url(
                    {"id": item_id, "imdb_id": eff_imdb, "kinorium_id": kinorium_id}
                ),
            }
            key = self._make_key(item_id, orig_title, title, year, media_type, eff_imdb)
            with self._lock:
                if len(self._cache) >= 5000:
                    try:
                        self._cache.pop(next(iter(self._cache)))
                    except StopIteration:
                        pass
                self._cache[key] = neg
            return copy.deepcopy(neg)

        jw = jw_data or {}
        cm = cm_data or {}

        poster_en = (
            jw.get("poster_en")
            or cm.get("poster_en")
            or resolve_original_poster_url(
                {"id": item_id, "imdb_id": resolved_imdb, "kinorium_id": kinorium_id}
            )
        )
        directors_en = list(jw.get("directors_en") or [])
        for d in cm.get("directors_en") or []:
            if d not in directors_en:
                directors_en.append(d)

        actors_en = list(jw.get("actors_en") or [])
        for a in cm.get("actors_en") or []:
            if a not in actors_en:
                actors_en.append(a)

        imdb_score_out = float(jw.get("imdb_score") or cm.get("imdb_score") or (cached or {}).get("imdb_score") or 0.0)

        mtype_out = (
            media_type
            or str(jw.get("media_type") or cm.get("media_type") or (cached or {}).get("media_type") or "")
        ).strip()
        result: Dict[str, Any] = {
            "ok": True,
            "ts": time.time(),
            "media_type": mtype_out,
            "title_en": jw.get("title_en") or cm.get("title_en") or (orig_title if not has_cyrillic(orig_title) else ""),
            "description_en": jw.get("description_en") or cm.get("description_en") or "",
            "runtime_min": jw.get("runtime_min") or cm.get("runtime_min") or 0,
            "countries_en": jw.get("countries_en") or cm.get("countries_en") or [],
            "genres_en": jw.get("genres_en") or cm.get("genres_en") or [],
            "poster_en": poster_en,
            "backdrop_en": jw.get("backdrop_en") or cm.get("backdrop_en") or "",
            "imdb_id": resolved_imdb,
            "imdb_score": imdb_score_out,
            "critics_pct": jw.get("critics_pct") if jw.get("critics_pct") is not None else (cached or {}).get("critics_pct"),
            "directors_en": directors_en[:4],
            "actors_en": actors_en[:14],
            "episodes_titles_en": cm.get("episodes_titles_en") or (cached or {}).get("episodes_titles_en") or {},
            "episodes_meta_en": cm.get("episodes_meta_en") or (cached or {}).get("episodes_meta_en") or {},
            "episodes_fetched": bool(cm.get("episodes_fetched") or (cached or {}).get("episodes_fetched")),
            "episodes_attempted_ts": time.time() if need_episodes else float((cached or {}).get("episodes_attempted_ts") or 0.0),
        }

        keys_to_store = {
            self._make_key(item_id, orig_title, title, year, media_type, eff_imdb),
        }
        if resolved_imdb:
            keys_to_store.add(f"imdb:{resolved_imdb}")
        if kinorium_id:
            keys_to_store.add(f"kin:{kinorium_id}")
        with self._lock:
            for k in keys_to_store:
                if k not in self._cache and len(self._cache) >= 5000:
                    try:
                        self._cache.pop(next(iter(self._cache)))
                    except StopIteration:
                        pass
                self._cache[k] = result
        try:
            if hasattr(self._db, "set_cache_entries_batch"):
                self._db.set_cache_entries_batch("en_meta", {str(k): result for k in keys_to_store})
            else:
                for k in keys_to_store:
                    self._db.set_cache_entry("en_meta", str(k), result)
        except Exception:
            self._save(force=need_episodes)
        return copy.deepcopy(result)
