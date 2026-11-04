"""JustWatch GraphQL API client and streaming provider offer resolution service.

Encapsulates:
- JustWatch GraphQL API queries for popular/recent movies and series in Poland / EU regions
- Provider-specific catalog scraping/aggregation (Netflix, Apple TV+, Prime, Disney+, Max, Player.pl)
- Accurate title offer resolution and fuzzy matching for streaming availability badges
"""

from __future__ import annotations

import copy
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional, Tuple

from .kinorium import _norm_title

JW_GRAPHQL_URL = "https://apis.justwatch.com/graphql"

JW_PACKAGE_MAP: Dict[str, List[str]] = {
    "netflix": ["nfx"],
    "appletv": ["atp"],
    "prime": ["prv"],
    "disney": ["dnp"],
    "max": ["mxx", "hbm"],
    "playerpl": ["plp"],
}

JW_DEFAULT_URLS: Dict[str, str] = {
    "netflix": "https://www.netflix.com",
    "appletv": "https://tv.apple.com/pl",
    "prime": "https://www.primevideo.com",
    "disney": "https://www.disneyplus.com",
    "max": "https://play.max.com",
    "playerpl": "https://player.pl",
}

JW_LABEL_MAP: Dict[str, str] = {
    "netflix": "Netflix",
    "appletv": "Apple TV+",
    "prime": "Prime Video",
    "disney": "Disney+",
    "max": "Max",
    "playerpl": "Player.pl",
}

JW_CODE_TO_ID: Dict[str, str] = {
    "nfx": "netflix",
    "atp": "appletv",
    "prv": "prime",
    "dnp": "disney",
    "mxx": "max",
    "hbm": "max",
    "plp": "playerpl",
}

JW_GENRE_MAP: Dict[str, str] = {
    "drm": "Драма",
    "scf": "Фантастика",
    "act": "Боевик",
    "cmy": "Комедия",
    "trl": "Триллер",
    "crm": "Криминал",
    "fnt": "Фэнтези",
    "ani": "Мультфильм",
    "hrr": "Ужасы",
    "mys": "Детектив",
    "rma": "Мелодрама",
    "hst": "История",
    "doc": "Документальный",
    "war": "Военный",
    "fml": "Семейный",
    "wsn": "Вестерн",
    "spt": "Спорт",
    "adv": "Приключения",
    "bio": "Биография",
}

OFFER_PRIO: Dict[str, int] = {
    "FLATRATE": 4,
    "FREE": 3,
    "ADS": 2,
    "RENT": 1,
    "BUY": 0,
}

OFFICIAL_PROVIDER_IDS = {"netflix", "appletv", "prime", "disney", "max", "playerpl"}

GQL_QUERY_POPULAR = """
query GetSearchTitles($country: Country!, $language: Language!, $first: Int!, $filter: TitleFilter) {
  popularTitles(country: $country, first: $first, filter: $filter) {
    edges {
      node {
        id
        objectId
        objectType
        content(country: $country, language: $language) {
          title
          originalReleaseYear
          shortDescription
          posterUrl
          backdrops {
            backdropUrl
          }
          externalIds {
            imdbId
          }
          scoring {
            imdbScore
            tomatoMeter
          }
          genres {
            shortName
          }
        }
        origContent: content(country: "US", language: "en") {
          title
          shortDescription
          posterUrl
        }
        plContent: content(country: "PL", language: "pl") {
          title
        }
        offers(country: $country, platform: WEB) {
          monetizationType
          standardWebURL
          package {
            shortName
            clearName
          }
        }
      }
    }
  }
}
"""


def _safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


class JustWatchClient:
    """Client for JustWatch GraphQL queries and streaming offer resolution."""

    def __init__(
        self,
        net_client: Any = None,
        country: str = "PL",
        is_service_enabled: Optional[Callable[[str], bool]] = None,
    ) -> None:
        self.net = net_client
        self.country: str = country or "PL"
        self._is_service_enabled_fn = is_service_enabled
        self._lock = threading.Lock()
        self._provider_jw_cache: Dict[Tuple[str, str], Tuple[float, List[Dict[str, Any]]]] = {}
        self._provider_offers_cache: Dict[Tuple[Any, ...], Tuple[float, List[Dict[str, Any]]]] = {}

    def is_service_enabled(self, service_id: str) -> bool:
        if self._is_service_enabled_fn:
            try:
                return bool(self._is_service_enabled_fn(service_id))
            except Exception:
                return True
        return True

    def clear_cache(self) -> None:
        with self._lock:
            self._provider_jw_cache.clear()
            self._provider_offers_cache.clear()

    def query_graphql(
        self, title_filter: Dict[str, Any], first: int = 10
    ) -> List[Dict[str, Any]]:
        """Execute GraphQL query against JustWatch API."""
        if not self.net:
            return []

        jw_cc = self.country or "PL"
        payload = {
            "operationName": "GetSearchTitles",
            "variables": {
                "country": jw_cc,
                "language": "ru",
                "first": first,
                "filter": title_filter,
            },
            "query": GQL_QUERY_POPULAR,
        }

        try:
            status, body, _ = self.net.request(
                JW_GRAPHQL_URL,
                method="POST",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                spoof_geo_country="DIRECT",
                timeout=5,
            )
        except Exception:
            return []

        results: List[Dict[str, Any]] = []
        if status != 200 or not body:
            return results

        try:
            data = json.loads(body)
            if not isinstance(data, dict):
                return []
            data_inner = data.get("data") if isinstance(data.get("data"), dict) else {}
            pop_titles = (
                data_inner.get("popularTitles")
                if isinstance(data_inner.get("popularTitles"), dict)
                else {}
            )
            edges = pop_titles.get("edges") or []
            for edge in edges:
                try:
                    if not isinstance(edge, dict):
                        continue
                    node = edge.get("node") or {}
                    content = node.get("content") or {}
                    title = content.get("title") or ""
                    if not title:
                        continue
                    year = content.get("originalReleaseYear") or 0
                    imdb_id = (content.get("externalIds") or {}).get("imdbId") or node.get(
                        "id", f"jw_{node.get('objectId')}"
                    )
                    raw_imdb_score = (content.get("scoring") or {}).get("imdbScore")
                    poster_path = content.get("posterUrl") or ""
                    if not poster_path:
                        continue

                    poster_url = (
                        "https://images.justwatch.com"
                        + poster_path.replace("{profile}", "s592").replace("{format}", "webp")
                    )
                    bds = content.get("backdrops") or []
                    if bds and isinstance(bds[0], dict) and bds[0].get("backdropUrl"):
                        backdrop_url = (
                            "https://images.justwatch.com"
                            + bds[0]["backdropUrl"].replace("{profile}", "s1920").replace("{format}", "webp")
                        )
                    else:
                        backdrop_url = poster_url

                    media_type = "series" if node.get("objectType") == "SHOW" else "movie"
                    parsed_genres = []
                    for g_obj in content.get("genres") or []:
                        if not isinstance(g_obj, dict):
                            continue
                        g_ru = JW_GENRE_MAP.get(str(g_obj.get("shortName") or "").lower())
                        if g_ru and g_ru not in parsed_genres:
                            parsed_genres.append(g_ru)
                    if not parsed_genres:
                        parsed_genres = ["Сериал" if media_type == "series" else "Фильм"]

                    providers = [
                        {
                            "id": "hdrezka",
                            "available": True,
                            "quality": "1080p",
                            "url": "",
                        }
                    ]
                    best_offer_by_pid: Dict[str, Tuple[int, Dict[str, Any]]] = {}
                    for offer in node.get("offers") or []:
                        if not isinstance(offer, dict):
                            continue
                        pkg = offer.get("package") or {}
                        short_name = pkg.get("shortName", "")
                        mapped_id = JW_CODE_TO_ID.get(short_name)
                        if not mapped_id:
                            continue
                        m_type = str(offer.get("monetizationType") or "").upper()
                        prio = OFFER_PRIO.get(m_type, 1)
                        prev = best_offer_by_pid.get(mapped_id)
                        if prev is None or prio > prev[0]:
                            best_offer_by_pid[mapped_id] = (
                                prio,
                                {
                                    "id": mapped_id,
                                    "available": True,
                                    "quality": pkg.get("clearName", mapped_id),
                                    "url": offer.get("standardWebURL", "https://www.justwatch.com/pl"),
                                },
                            )
                    for _, p_entry in best_offer_by_pid.values():
                        providers.append(p_entry)

                    providers.append(
                        {
                            "id": "backup4k",
                            "available": True,
                            "quality": "4K HDR",
                            "url": f"native://backup4k/{imdb_id}",
                        }
                    )

                    orig_content = node.get("origContent") or {}
                    orig_title_val = orig_content.get("title") or title
                    pl_title_val = (node.get("plContent") or {}).get("title") or orig_title_val
                    orig_poster_rel = orig_content.get("posterUrl") or ""
                    poster_en_url = (
                        "https://images.justwatch.com"
                        + orig_poster_rel.replace("{profile}", "s592").replace("{format}", "webp")
                        if orig_poster_rel
                        else poster_url
                    )
                    tomato_raw = (content.get("scoring") or {}).get("tomatoMeter")
                    jw_rats: Dict[str, Any] = {}
                    if raw_imdb_score is not None:
                        try:
                            im_fl = round(float(raw_imdb_score), 1)
                            if 0.0 < im_fl <= 10.0:
                                jw_rats["imdb"] = im_fl
                                jw_rats["kinorium"] = im_fl
                        except (TypeError, ValueError):
                            pass
                    if tomato_raw is not None:
                        try:
                            tm_int = int(round(float(tomato_raw)))
                            if 0 < tm_int <= 100:
                                jw_rats["critics"] = tm_int
                        except Exception:
                            pass

                    yr_int = _safe_int(year)
                    results.append(
                        {
                            "id": imdb_id,
                            "rezka_id": "",
                            "rezka_url": "",
                            "title": title,
                            "title_pl": pl_title_val,
                            "orig_title": orig_title_val,
                            "year": yr_int or "",
                            "media_type": media_type,
                            "seasons_count": 1,
                            "episodes_per_season": 0 if media_type == "series" else 1,
                            "duration_min": 55 if media_type == "series" else 125,
                            "genres": parsed_genres,
                            "description": content.get("shortDescription")
                            or (f"{title} ({yr_int})" if yr_int > 1880 else ""),
                            "description_en": orig_content.get("shortDescription")
                            or (f"{orig_title_val} ({yr_int})" if yr_int > 1880 else ""),
                            "poster": poster_url,
                            "poster_en": poster_en_url,
                            "backdrop": backdrop_url,
                            "ambient_color": "#334155",
                            "ratings": jw_rats,
                            "providers": providers,
                            "featured": False,
                        }
                    )
                except Exception:
                    continue
        except Exception:
            pass

        return results

    def search_poland(self, query: str) -> List[Dict[str, Any]]:
        """Search JustWatch for titles matching query in Poland."""
        return self.query_graphql({"searchQuery": query}, first=12)

    def fetch_by_provider(self, provider_id: str) -> List[Dict[str, Any]]:
        """Fetch popular catalog items for a given streaming provider."""
        if not self.is_service_enabled(provider_id):
            return []

        packages = JW_PACKAGE_MAP.get(provider_id)
        if not packages:
            return []

        now = time.time()
        cache_key = (self.country, provider_id)
        with self._lock:
            cached_entry = self._provider_jw_cache.get(cache_key)
            if cached_entry and (now - cached_entry[0]) < 900 and cached_entry[1]:
                return [copy.deepcopy(it) for it in cached_entry[1]]

        shows: List[Dict[str, Any]] = []
        movies: List[Dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=2) as pool:
            f_shows = pool.submit(
                self.query_graphql,
                {"objectTypes": ["SHOW"], "packages": packages},
                24,
            )
            f_movies = pool.submit(
                self.query_graphql,
                {"objectTypes": ["MOVIE"], "packages": packages},
                24,
            )
            try:
                shows = f_shows.result(timeout=6.0) or []
            except Exception:
                shows = []
            try:
                movies = f_movies.result(timeout=6.0) or []
            except Exception:
                movies = []

        if not shows and not movies:
            fallback = self.query_graphql({"packages": packages}, first=24) or []
            shows = [x for x in fallback if x.get("media_type") == "series"]
            movies = [x for x in fallback if x.get("media_type") != "series"]

        combined: List[Dict[str, Any]] = []
        seen_ids = set()
        max_len = max(len(shows), len(movies))
        for i in range(max_len):
            for bucket in (shows, movies):
                if i >= len(bucket):
                    continue
                item = dict(bucket[i])
                iid = str(item.get("id") or "")
                if iid and iid in seen_ids:
                    continue
                if iid:
                    seen_ids.add(iid)
                provs = [dict(p) for p in (item.get("providers") or [])]
                if not any(p.get("id") == provider_id for p in provs):
                    provs.append(
                        {
                            "id": provider_id,
                            "available": True,
                            "quality": JW_LABEL_MAP.get(provider_id, provider_id),
                            "url": JW_DEFAULT_URLS.get(provider_id, "https://www.justwatch.com/pl"),
                        }
                    )
                item["providers"] = provs
                item["primary_provider"] = provider_id
                item["_provider_rank"] = len(combined)
                combined.append(item)

        if combined:
            with self._lock:
                if len(self._provider_jw_cache) > 64:
                    for k_ev in list(self._provider_jw_cache.keys())[:16]:
                        self._provider_jw_cache.pop(k_ev, None)
                self._provider_jw_cache[cache_key] = (now, [copy.deepcopy(it) for it in combined])
        return [copy.deepcopy(it) for it in combined]

    def resolve_provider_offers_for_title(
        self,
        title: str = "",
        orig_title: str = "",
        year: int = 0,
        media_type: str = "",
    ) -> List[Dict[str, Any]]:
        """Resolve legal streaming availability offers for a given title."""
        clean_orig = str(orig_title or "").strip()
        clean_title = str(title or "").strip()
        if " / " in clean_title and not clean_orig:
            parts = [p.strip() for p in clean_title.split(" / ") if p.strip()]
            clean_title = parts[0]
            if len(parts) > 1:
                clean_orig = parts[-1]

        queries = []
        for q in (clean_orig, clean_title):
            if q and q.lower() not in [x.lower() for x in queries]:
                queries.append(q)
        if not queries:
            return []

        try:
            target_year = int(year or 0)
        except (TypeError, ValueError):
            target_year = 0
        target_mt = str(media_type or "").strip().lower()

        now = time.time()
        cache_key = (
            self.country,
            queries[0].lower(),
            clean_title.lower(),
            target_year,
            target_mt,
        )
        with self._lock:
            cached = self._provider_offers_cache.get(cache_key)
            if cached and (now - cached[0]) < (1800 if cached[1] else 120):
                return [
                    dict(p)
                    for p in cached[1]
                    if self.is_service_enabled(str(p.get("id") or ""))
                ]

        best_offers: List[Dict[str, Any]] = []

        for q in queries:
            filter_dict: Dict[str, Any] = {"searchQuery": q}
            if target_mt == "series":
                filter_dict["objectTypes"] = ["SHOW"]
            elif target_mt == "movie":
                filter_dict["objectTypes"] = ["MOVIE"]
            candidates = self.query_graphql(filter_dict, first=6) or []
            if not candidates and "objectTypes" in filter_dict:
                candidates = self.query_graphql({"searchQuery": q}, first=6) or []
            if not candidates:
                continue

            q_low = _norm_title(q)
            t_low = _norm_title(clean_title)
            o_low = _norm_title(clean_orig)
            q_toks = set(q_low.split())

            scored: List[Tuple[int, Dict[str, Any]]] = []
            for idx, cand in enumerate(candidates):
                c_title = _norm_title(str(cand.get("title") or ""))
                c_orig = _norm_title(str(cand.get("orig_title") or ""))
                c_pl = _norm_title(str(cand.get("title_pl") or ""))
                c_names = {x for x in (c_title, c_orig, c_pl) if x}
                score = max(0, 20 - idx * 3)
                title_hit = False
                if q_low in c_names or (o_low and o_low in c_names) or (t_low and t_low in c_names):
                    score += 50
                    title_hit = True
                elif len(q_toks) >= 2 and any(
                    min(len(q_low), len(n)) >= 5
                    and len(n.split()) >= 2
                    and (
                        q_toks.issubset(set(n.split()))
                        or set(n.split()).issubset(q_toks)
                    )
                    for n in c_names
                ):
                    score += 25
                    title_hit = True
                if not title_hit:
                    # Never attach streaming offers of an unrelated title just because it ranked first
                    continue
                c_mt = str(cand.get("media_type") or "").strip().lower()
                if target_mt and c_mt:
                    if target_mt == c_mt:
                        score += 20
                    else:
                        continue
                try:
                    c_yr = int(cand.get("year") or 0)
                except (TypeError, ValueError):
                    c_yr = 0
                if target_year > 1900 and c_yr > 1900:
                    diff = abs(target_year - c_yr)
                    if diff == 0:
                        score += 25
                    elif diff == 1:
                        score += 15
                    elif diff <= 2 and target_mt == "series":
                        score += 5
                    else:
                        continue
                scored.append((score, cand))

            scored.sort(key=lambda pair: pair[0], reverse=True)
            if scored and scored[0][0] >= 45:
                winner = scored[0][1]
                for p in winner.get("providers") or []:
                    pid = str(p.get("id") or "")
                    if pid in OFFICIAL_PROVIDER_IDS and p.get("available"):
                        best_offers.append(dict(p))
                if best_offers:
                    break

        with self._lock:
            if len(self._provider_offers_cache) > 600:
                for k_ev in list(self._provider_offers_cache.keys())[:150]:
                    self._provider_offers_cache.pop(k_ev, None)
            self._provider_offers_cache[cache_key] = (now, [dict(p) for p in best_offers])
        return [
            dict(p)
            for p in best_offers
            if self.is_service_enabled(str(p.get("id") or ""))
        ]
