import concurrent.futures
import copy
import datetime
import itertools
import json
import re
import threading
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Set, Tuple

from .curated_catalog import CURATED_CATALOG, PROVIDERS_META
from .doh import DoHSplitNetworkClient
from .en_metadata import (
    EnglishMetadataResolver,
    RU_GENRES_TO_EN,
    _names_match_ru_en,
    has_cyrillic,
    resolve_original_backdrop_url,
    resolve_original_poster_url,
    translate_birth_date_en,
    translate_birth_place_en,
    translate_career_role_en,
    translate_kinorium_extra_desc_to_en,
    transliterate_cyrillic,
)
from .hdrezka import HDRezkaClient
from .justwatch import JustWatchClient
from .kinorium import KinoriumService, _norm_title, _sanitize_kinorium_genres, _title_variants
from .profiles import ProfileManager
from .regions import get_country_profile
from .storage_db import get_storage_db


class UnifiedCinemaAggregator:
    """
    Unified Catalog & Search Engine for Poland (PL):
    Includes Apple TV+, Netflix, Prime Video, Disney+, Max, Player.pl, HDRezka, and 4K Remux.
    Supports filtering by provider AND by media_type ('all', 'movie', 'series').
    """

    PROVIDERS_META = PROVIDERS_META
    CURATED_CATALOG = CURATED_CATALOG

    def __init__(
        self,
        net_client: DoHSplitNetworkClient,
        rezka_client: HDRezkaClient,
        kinorium_service: KinoriumService,
        stremio_engine: Any = None,
        en_meta_resolver: Optional[EnglishMetadataResolver] = None,
    ):
        self.net = net_client
        self.rezka = rezka_client
        self.kinorium = kinorium_service
        self.stremio = stremio_engine
        self.en_meta = en_meta_resolver
        if self.en_meta is not None and getattr(self.en_meta, "kinorium_html_fetcher", None) is None:
            self.en_meta.kinorium_html_fetcher = self.kinorium.fetch_kinorium_html
        self.country_code: str = "PL"
        self.justwatch_country: str = "PL"
        self.justwatch = JustWatchClient(
            net_client=self.net,
            country=self.justwatch_country,
            is_service_enabled=self.is_service_enabled,
        )
        self._premieres_cache: List[Dict[str, Any]] = []
        self._premieres_cache_ts: float = 0.0
        self._premieres_cache_key: tuple = ()
        self._catalog_lock = threading.RLock()
        self._catalog_cache: Dict[tuple, Dict[str, Any]] = {}
        self._person_raw_cache: Dict[str, Any] = {}
        self._provider_jw_cache = self.justwatch._provider_jw_cache
        self._provider_offers_cache = self.justwatch._provider_offers_cache
        self._catalog_by_id: Dict[str, Dict[str, Any]] = {
            str(it["id"]): dict(it) for it in self.CURATED_CATALOG if isinstance(it, dict) and it.get("id")
        }

    def _register_catalog_items(self, *item_lists: Any) -> None:
        updates: Dict[str, Dict[str, Any]] = {}
        for lst in item_lists:
            if not isinstance(lst, list):
                continue
            for it in lst:
                if not isinstance(it, dict):
                    continue
                iid = str(it.get("id") or "").strip()
                if iid:
                    updates[iid] = dict(it)
                imdb_val = str(it.get("imdb_id") or "").strip()
                if imdb_val.startswith("tt") and imdb_val not in updates:
                    updates[imdb_val] = dict(it)
                kid_val = str(it.get("kinorium_id") or "").strip()
                if kid_val.isdigit() and f"kin_{kid_val}" not in updates:
                    updates[f"kin_{kid_val}"] = dict(it)
        if not updates:
            return
        with self._catalog_lock:
            new_map = dict(self._catalog_by_id)
            new_map.update(updates)
            if len(new_map) > 3000:
                seeded = {
                    str(it["id"]): dict(it)
                    for it in self.CURATED_CATALOG
                    if isinstance(it, dict) and it.get("id")
                }
                tail_keys = list(new_map.keys())[-2000:]
                for k in tail_keys:
                    seeded[k] = new_map[k]
                seeded.update(updates)
                new_map = seeded
            self._catalog_by_id = new_map

    @staticmethod
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

    def _kinorium_state_get(self, key: str, default: Any = None) -> Any:
        lock = getattr(self.kinorium, "_state_lock", None)
        if lock is not None:
            with lock:
                val = self.kinorium.state.get(key, default)
                return copy.deepcopy(val)
        return copy.deepcopy(self.kinorium.state.get(key, default))

    def set_country(self, country_code: str) -> Dict[str, Any]:
        prof = get_country_profile(country_code)
        with self._catalog_lock:
            if prof["code"] != self.country_code:
                self._premieres_cache = []
                self._premieres_cache_ts = 0.0
                self._catalog_cache.clear()
                self._provider_jw_cache.clear()
                self._provider_offers_cache.clear()
            self.country_code = prof["code"]
            self.justwatch_country = prof["justwatch_country"]
            if hasattr(self, "justwatch") and self.justwatch:
                self.justwatch.country = self.justwatch_country
        return prof

    def is_service_enabled(self, service_id: str) -> bool:
        return self.kinorium.is_service_enabled(service_id)

    def _filter_item_by_enabled_services(
        self, item: Dict[str, Any], allow_empty_providers: bool = False
    ) -> Any:
        raw_provs = [dict(p) for p in (item.get("providers") or []) if isinstance(p, dict)]
        if self.is_service_enabled("stremio") and not any(
            str(p.get("id") or "") == "stremio" for p in raw_provs
        ):
            raw_provs.append(
                {
                    "id": "stremio",
                    "available": True,
                    "quality": "Torrentio · 4K/1080p",
                    "url": f"native://stremio/{item.get('id', '')}",
                }
            )
        if not raw_provs:
            return dict(item)
        enabled_provs = [
            dict(p) for p in raw_provs if self.is_service_enabled(str(p.get("id") or ""))
        ]
        if not enabled_provs and not allow_empty_providers:
            return None
        copied = dict(item)
        copied["providers"] = enabled_provs
        return copied

    def _filter_items_list(
        self, items: List[Dict[str, Any]], allow_empty_providers: bool = False
    ) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for it in items or []:
            filtered = self._filter_item_by_enabled_services(
                it, allow_empty_providers=allow_empty_providers
            )
            if filtered is not None:
                out.append(filtered)
        return out

    def enrich_item(self, item: Dict[str, Any]) -> Dict[str, Any]:
        enriched = dict(item)
        k_status = self.kinorium.get_item_status(
            item["id"],
            base_kinorium_rating=item.get("ratings", {}).get("kinorium", 8.0),
            title=item.get("title", ""),
            orig_title=item.get("orig_title", ""),
        )
        enriched["kinorium"] = k_status
        kid_val = str(k_status.get("kinorium_id") or "")
        if kid_val and not enriched.get("kinorium_id"):
            enriched["kinorium_id"] = kid_val
        if kid_val.isdigit():
            cur_poster = str(enriched.get("poster") or "")
            if not cur_poster or "hdrezka" in cur_poster.lower():
                enriched["poster"] = f"https://ru-images.kinorium.com/movie/600/{kid_val}.jpg"
                enriched["backdrop"] = f"https://ru-images.kinorium.com/movie/1080/{kid_val}.jpg"
        w_info = k_status.get("watched_info")
        if isinstance(w_info, dict):
            if w_info.get("genres"):
                cur_g = enriched.get("genres") or []
                if not cur_g or cur_g in (["Фильм"], ["Сериал"]):
                    enriched["genres"] = w_info["genres"]
            if w_info.get("orig_title") and (
                not enriched.get("orig_title") or enriched.get("orig_title") == enriched.get("title")
            ):
                enriched["orig_title"] = w_info["orig_title"]
            if w_info.get("seasons_count") and enriched.get("media_type") == "series":
                w_sc = self._safe_int(w_info.get("seasons_count"), 0)
                if w_sc > self._safe_int(enriched.get("seasons_count"), 1):
                    enriched["seasons_count"] = w_sc
        if enriched.get("media_type") == "series":
            live_m = self.kinorium.get_series_live_meta(
                item_id=str(enriched.get("id") or ""),
                title=str(enriched.get("title") or ""),
                orig_title=str(enriched.get("orig_title") or ""),
                kid=kid_val,
                year=self._safe_int(enriched.get("year")),
                media_type="series",
            )
            if live_m and not live_m.get("not_found"):
                lm_url = str(live_m.get("rezka_url") or "")
                if "/films/" not in lm_url.lower():
                    if live_m.get("rezka_id") and not enriched.get("rezka_id"):
                        enriched["rezka_id"] = live_m["rezka_id"]
                    if lm_url and not enriched.get("rezka_url"):
                        enriched["rezka_url"] = lm_url
                if live_m.get("seasons_map") and not enriched.get("seasons_map"):
                    enriched["seasons_map"] = live_m["seasons_map"]
                if live_m.get("latest_season") and not enriched.get("latest_season"):
                    enriched["latest_season"] = live_m["latest_season"]
                if live_m.get("latest_episode") and not enriched.get("latest_episode"):
                    enriched["latest_episode"] = live_m["latest_episode"]

        rats = dict(enriched.get("ratings") or {})
        rats.pop("kp", None)
        if rats.get("critics") is None and k_status.get("critics_rating") is not None:
            cr_val = self._safe_int(k_status["critics_rating"], -1)
            if cr_val >= 0:
                rats["critics"] = cr_val

        if isinstance(enriched.get("genres"), list) and enriched["genres"]:
            enriched["genres"] = _sanitize_kinorium_genres(
                enriched["genres"], str(enriched.get("media_type") or "movie")
            )

        if self.en_meta is not None:
            cached_en = self.en_meta.get_cached(
                item_id=str(enriched.get("id") or ""),
                title=str(enriched.get("title") or ""),
                orig_title=str(enriched.get("orig_title") or ""),
                year=self._safe_int(enriched.get("year")),
                media_type=str(enriched.get("media_type") or ""),
                imdb_id=str(enriched.get("imdb_id") or ""),
            )
            if cached_en and cached_en.get("ok"):
                if cached_en.get("imdb_id") and not enriched.get("imdb_id"):
                    enriched["imdb_id"] = cached_en["imdb_id"]
                if cached_en.get("description_en"):
                    enriched["description_en"] = cached_en["description_en"]
                if cached_en.get("poster_en"):
                    enriched["poster_en"] = cached_en["poster_en"]
                if cached_en.get("backdrop_en"):
                    enriched["backdrop_en"] = cached_en["backdrop_en"]
                if cached_en.get("title_en") and (
                    not enriched.get("orig_title") or has_cyrillic(str(enriched.get("orig_title") or ""))
                ):
                    enriched["orig_title"] = cached_en["title_en"]
                if rats.get("critics") is None and cached_en.get("critics_pct") is not None:
                    cp_val = self._safe_int(cached_en["critics_pct"], -1)
                    if cp_val >= 0:
                        rats["critics"] = cp_val
                if not rats.get("imdb") and cached_en.get("imdb_score") is not None:
                    try:
                        sc_v = round(float(cached_en["imdb_score"]), 1)
                        if 0.0 < sc_v <= 10.0:
                            rats["imdb"] = sc_v
                    except (TypeError, ValueError):
                        pass
                if cached_en.get("directors_en"):
                    enriched["directors_en"] = cached_en["directors_en"]
                if cached_en.get("actors_en"):
                    enriched["actors_en"] = cached_en["actors_en"]

        enriched["ratings"] = rats
        enriched["poster_en"] = resolve_original_poster_url(enriched)
        enriched["backdrop_en"] = resolve_original_backdrop_url(enriched)
        cur_bg = str(enriched.get("backdrop") or "").strip()
        en_bg = str(enriched.get("backdrop_en") or "").strip()
        if en_bg and "kinorium.com/movie/" not in en_bg and (not cur_bg or "kinorium.com/movie/" in cur_bg):
            enriched["backdrop"] = en_bg
        if not enriched.get("description_en") and enriched.get("description"):
            raw_desc = str(enriched["description"])
            enriched["description_en"] = (
                translate_kinorium_extra_desc_to_en(raw_desc) if has_cyrillic(raw_desc) else raw_desc
            )
        return enriched

    def invalidate_catalog_cache(self) -> None:
        with self._catalog_lock:
            self._catalog_cache.clear()

    def lookup_cached_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        if not item_id:
            return None
        with self._catalog_lock:
            hit = self._catalog_by_id.get(item_id)
            return dict(hit) if isinstance(hit, dict) else None

    def find_cached_item_for_deep_link(self, target_id: str) -> Optional[Dict[str, Any]]:
        tid = str(target_id or "").strip()
        if not tid:
            return None
        clean_tid = re.sub(r"[^a-zA-Z0-9_-]+", "", tid)[:24]
        with self._catalog_lock:
            direct = self._catalog_by_id.get(tid) or (self._catalog_by_id.get(clean_tid) if clean_tid else None)
            if isinstance(direct, dict):
                return dict(direct)
            for _, cached_entry in list(self._catalog_cache.items()):
                cat_payload = (
                    cached_entry[1]
                    if isinstance(cached_entry, tuple) and len(cached_entry) >= 2
                    else cached_entry
                )
                if not isinstance(cat_payload, dict):
                    continue
                for list_key in ("items", "continue_watching"):
                    for cand in (cat_payload.get(list_key) or []):
                        if not isinstance(cand, dict):
                            continue
                        cid = str(cand.get("id") or "")
                        if cid == tid or (clean_tid and re.sub(r"[^a-zA-Z0-9_-]+", "", cid)[:24] == clean_tid):
                            return dict(cand)
        return None

    def _prewarm_en_metadata_for_items(self, items: List[Dict[str, Any]], max_items: int = 8) -> bool:
        if self.en_meta is None or not items:
            return False
        to_resolve: List[Dict[str, Any]] = []
        for it in items:
            if len(to_resolve) >= max_items:
                break
            cached_en = self.en_meta.get_cached(
                item_id=str(it.get("id") or ""),
                title=str(it.get("title") or ""),
                orig_title=str(it.get("orig_title") or ""),
                year=self._safe_int(it.get("year")),
                media_type=str(it.get("media_type") or ""),
                imdb_id=str(it.get("imdb_id") or ""),
            )
            if cached_en is not None and not cached_en.get("ok"):
                continue
            desc_en = str(it.get("description_en") or "").strip()
            orig_val = str(it.get("orig_title") or "").strip()
            needs_en_title = not orig_val or has_cyrillic(orig_val)
            needs_plot = (
                not desc_en
                or "•" in desc_en
                or len(desc_en) < 42
                or has_cyrillic(desc_en)
                or re.search(r"\(\d{4}\b.*\)$", desc_en) is not None
            )
            cur_bg = str(it.get("backdrop") or "").strip()
            cur_poster = str(it.get("poster") or "").strip()
            needs_backdrop = (
                not cur_bg
                or cur_bg == cur_poster
                or "kinorium.com/movie/" in cur_bg
                or "/poster/" in cur_bg
            )
            if needs_plot or needs_en_title or not it.get("poster_en") or needs_backdrop:
                to_resolve.append(it)
        if not to_resolve:
            return False
        from concurrent.futures import ThreadPoolExecutor

        changed_any = False

        def _resolve_one(target: Dict[str, Any]) -> None:
            nonlocal changed_any
            res = self.en_meta.resolve(
                item_id=str(target.get("id") or ""),
                title=str(target.get("title") or ""),
                orig_title=str(target.get("orig_title") or ""),
                year=self._safe_int(target.get("year")),
                media_type=str(target.get("media_type") or ""),
                imdb_id=str(target.get("imdb_id") or ""),
                kinorium_id=str(target.get("kinorium_id") or ""),
                need_episodes=False,
            )
            if not res or not res.get("ok"):
                return
            if res.get("imdb_id") and not target.get("imdb_id"):
                target["imdb_id"] = res["imdb_id"]
            if res.get("description_en"):
                target["description_en"] = res["description_en"]
            if res.get("poster_en"):
                target["poster_en"] = res["poster_en"]
            if res.get("backdrop_en"):
                target["backdrop_en"] = res["backdrop_en"]
                t_bg = str(target.get("backdrop") or "").strip()
                t_poster = str(target.get("poster") or "").strip()
                if "kinorium.com/movie/" not in res["backdrop_en"] and (
                    not t_bg
                    or t_bg == t_poster
                    or "kinorium.com/movie/" in t_bg
                    or "/poster/" in t_bg
                ):
                    target["backdrop"] = res["backdrop_en"]
            if res.get("title_en") and (
                not target.get("orig_title") or has_cyrillic(str(target.get("orig_title") or ""))
            ):
                target["orig_title"] = res["title_en"]
            if res.get("critics_pct") is not None:
                rats = dict(target.get("ratings") or {})
                if rats.get("critics") is None:
                    cp_val = self._safe_int(res["critics_pct"], -1)
                    if cp_val >= 0:
                        rats["critics"] = cp_val
                        target["ratings"] = rats
            if res.get("imdb_score") is not None:
                rats = dict(target.get("ratings") or {})
                if not rats.get("imdb"):
                    try:
                        sc_v = round(float(res["imdb_score"]), 1)
                        if 0.0 < sc_v <= 10.0:
                            rats["imdb"] = sc_v
                            target["ratings"] = rats
                    except (TypeError, ValueError):
                        pass
            if res.get("directors_en"):
                target["directors_en"] = res["directors_en"]
            if res.get("actors_en"):
                target["actors_en"] = res["actors_en"]
            changed_any = True

        with ThreadPoolExecutor(max_workers=min(8, len(to_resolve))) as pool:
            futs = [pool.submit(_resolve_one, t) for t in to_resolve]
            for f in futs:
                try:
                    f.result(timeout=4.5)
                except Exception:
                    pass
        return changed_any

    def _match_curated_catalog_entry(self, it: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        it_id = str(it.get("id") or "").strip()
        if it_id:
            for c_it in self.CURATED_CATALOG:
                if c_it.get("id") == it_id:
                    return c_it
        it_imdb = str(it.get("imdb_id") or (it_id if it_id.startswith("tt") else "")).strip()
        it_rezka = str(
            it.get("rezka_id") or (it_id[6:] if it_id.startswith("rezka_") and it_id[6:].isdigit() else "")
        ).strip()
        it_title = str(it.get("title") or "").strip().lower()
        it_orig = str(it.get("orig_title") or "").strip().lower()
        if not it_title and not it_orig and not it_imdb and not it_rezka:
            return None
        it_mt = str(it.get("media_type") or "").strip().lower()
        try:
            it_yr = int(it.get("year") or 0)
        except (TypeError, ValueError):
            it_yr = 0

        for c_it in self.CURATED_CATALOG:
            c_id = str(c_it.get("id") or "").strip()
            c_imdb = str(c_it.get("imdb_id") or (c_id if c_id.startswith("tt") else "")).strip()
            c_rezka = str(c_it.get("rezka_id") or "").strip()
            if it_imdb and c_imdb:
                if it_imdb == c_imdb:
                    return c_it
                continue
            if it_rezka and c_rezka:
                if it_rezka == c_rezka:
                    return c_it
                continue
            c_title = str(c_it.get("title") or "").strip().lower()
            c_orig = str(c_it.get("orig_title") or "").strip().lower()
            title_hit = (it_title and (it_title == c_title or it_title == c_orig)) or (
                it_orig and (it_orig == c_orig or it_orig == c_title)
            )
            if not title_hit:
                continue
            c_mt = str(c_it.get("media_type") or "").strip().lower()
            if it_mt and c_mt and it_mt != c_mt:
                continue
            try:
                c_yr = int(c_it.get("year") or 0)
            except (TypeError, ValueError):
                c_yr = 0
            if it_yr > 1900 and c_yr > 1900 and abs(it_yr - c_yr) > 1:
                continue
            return c_it
        return None

    def _enrich_from_curated(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        for it in items:
            c_match = self._match_curated_catalog_entry(it)
            if c_match:
                c_imdb = c_match.get("imdb_id") or (
                    c_match.get("id", "") if str(c_match.get("id", "")).startswith("tt") else ""
                )
                if c_imdb and not it.get("imdb_id"):
                    it["imdb_id"] = c_imdb
                if c_match.get("rezka_id") and not it.get("rezka_id"):
                    it["rezka_id"] = c_match["rezka_id"]
                if c_match.get("rezka_url") and not it.get("rezka_url"):
                    it["rezka_url"] = c_match["rezka_url"]
                merged_provs = [dict(p) for p in (c_match.get("providers") or [])]
                seen_pids = {str(p.get("id") or ""): p for p in merged_provs if p.get("id")}
                for p in it.get("providers") or []:
                    pid = str(p.get("id") or "")
                    if not pid:
                        continue
                    if pid not in seen_pids:
                        merged_provs.append(dict(p))
                        seen_pids[pid] = merged_provs[-1]
                    elif p.get("url") and (
                        not seen_pids[pid].get("url")
                        or "search?" in str(seen_pids[pid].get("url") or "")
                        or str(seen_pids[pid].get("url") or "").rstrip("/") in ("https://player.pl", "https://tv.apple.com/pl")
                    ):
                        seen_pids[pid]["url"] = p["url"]
                it["providers"] = merged_provs
                it["ambient_color"] = c_match.get("ambient_color", it.get("ambient_color", "#1e293b"))
                if c_match.get("backdrop"):
                    cur_bg = str(it.get("backdrop") or "").strip()
                    if not cur_bg or "kinorium.com/movie/" in cur_bg or cur_bg == str(it.get("poster") or "").strip():
                        it["backdrop"] = c_match["backdrop"]
                if c_match.get("description"):
                    cur_desc = str(it.get("description") or "").strip()
                    if not cur_desc or len(cur_desc) < 48 or re.match(r"^[^()]{1,70}\s*\([^()]{1,90}\)$", cur_desc):
                        it["description"] = c_match["description"]
                if c_match.get("description_en"):
                    cur_desc_en = str(it.get("description_en") or "").strip()
                    if not cur_desc_en or len(cur_desc_en) < 48 or re.match(r"^[^()]{1,70}\s*\([^()]{1,90}\)$", cur_desc_en):
                        it["description_en"] = c_match["description_en"]
                if c_match.get("poster_en") and not it.get("poster_en"):
                    it["poster_en"] = c_match["poster_en"]
                c_rats = c_match.get("ratings") or {}
                if c_rats.get("critics") is not None:
                    rats = dict(it.get("ratings") or {})
                    rats.pop("kp", None)
                    if rats.get("critics") is None:
                        rats["critics"] = c_rats["critics"]
                    it["ratings"] = rats
            it_mtype = str(it.get("media_type") or "").strip().lower()
            try:
                it_year = int(it.get("year") or 0)
            except (TypeError, ValueError):
                it_year = 0
            live_m = (
                self.kinorium.get_series_live_meta(
                    item_id=str(it.get("id") or ""),
                    title=str(it.get("title") or ""),
                    orig_title=str(it.get("orig_title") or ""),
                    kid=str(it.get("kinorium_id") or ""),
                    year=it_year,
                    media_type="series",
                )
                if it_mtype == "series"
                else None
            )
            if live_m and not live_m.get("not_found"):
                lm_url = str(live_m.get("rezka_url") or "")
                if "/films/" not in lm_url.lower():
                    if live_m.get("rezka_id") and not it.get("rezka_id"):
                        it["rezka_id"] = live_m["rezka_id"]
                    if live_m.get("rezka_url") and not it.get("rezka_url"):
                        it["rezka_url"] = live_m["rezka_url"]
                    if live_m.get("seasons_map") and not it.get("seasons_map"):
                        it["seasons_map"] = live_m["seasons_map"]
                    if live_m.get("latest_season") and not it.get("latest_season"):
                        it["latest_season"] = live_m["latest_season"]
                    if live_m.get("latest_episode") and not it.get("latest_episode"):
                        it["latest_episode"] = live_m["latest_episode"]
        return items

    def _filter_unwatched_premieres(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not self.is_service_enabled("kinorium"):
            return items
        out: List[Dict[str, Any]] = []
        for it in items:
            ks = it.get("kinorium") or {}
            if self.kinorium.is_item_fully_watched_or_caught_up(
                ks, media_type=str(it.get("media_type") or "movie")
            ):
                continue
            out.append(it)
        return out

    def _get_online_premieres(self) -> List[Dict[str, Any]]:
        now = time.time()
        kin_premieres = self.kinorium.fetch_online_premieres()
        if kin_premieres:
            self._enrich_from_curated(kin_premieres)
            enriched = [self.enrich_item(it) for it in kin_premieres]
            return self._filter_unwatched_premieres(
                self._filter_items_list(enriched, allow_empty_providers=True)
            )

        pkg_service_pairs = [
            ("nfx", "netflix"),
            ("atp", "appletv"),
            ("prv", "prime"),
            ("dnp", "disney"),
            ("mxx", "max"),
            ("plp", "playerpl"),
        ]
        pkgs = [code for code, srv_id in pkg_service_pairs if self.is_service_enabled(srv_id)]
        cache_key = tuple(pkgs)

        with self._catalog_lock:
            cached_premieres = (
                [dict(it) for it in self._premieres_cache]
                if (self._premieres_cache and self._premieres_cache_key == cache_key and (now - self._premieres_cache_ts) < 900)
                else None
            )
        if cached_premieres is not None:
            return self._filter_unwatched_premieres(
                self._filter_items_list(
                    [self.enrich_item(it) for it in cached_premieres], allow_empty_providers=True
                )
            )

        jw_movies = (
            self._query_justwatch_graphql(
                {"objectTypes": ["MOVIE"], "releaseYear": {"min": 2025}, "packages": pkgs},
                first=25,
            )
            if pkgs
            else []
        )
        jw_shows = (
            self._query_justwatch_graphql(
                {"objectTypes": ["SHOW"], "releaseYear": {"min": 2025}, "packages": pkgs},
                first=25,
            )
            if pkgs
            else []
        )

        combined: List[Dict[str, Any]] = []
        seen_ids = set()
        seen_titles = set()
        for jw in jw_movies + jw_shows:
            t_low = str(jw.get("title") or "").strip().lower()
            mt_key = (str(jw.get("media_type") or "movie"), t_low)
            if jw["id"] not in seen_ids and (not t_low or mt_key not in seen_titles):
                combined.append(jw)
                seen_ids.add(jw["id"])
                if t_low:
                    seen_titles.add(mt_key)

        if combined:
            with self._catalog_lock:
                self._premieres_cache = [dict(it) for it in combined]
                self._premieres_cache_ts = now
                self._premieres_cache_key = cache_key
        return self._filter_unwatched_premieres(
            self._filter_items_list([self.enrich_item(it) for it in combined], allow_empty_providers=True)
        )

    def get_catalog(
        self,
        provider_filter: str = "all",
        media_type_filter: str = "all",
        kinorium_section: str = "all",
        lang: str = "ru",
    ) -> Dict[str, Any]:
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        if provider_filter and provider_filter != "all" and not self.is_service_enabled(provider_filter):
            provider_filter = "all"

        kin_enabled = self.is_service_enabled("kinorium")
        if not kin_enabled and kinorium_section in ("watching", "watchlist", "watched", "never"):
            kinorium_section = "all"

        enabled_sig = tuple(
            sorted(
                srv_id
                for srv_id in list(self.PROVIDERS_META.keys()) + ["kinorium"]
                if self.is_service_enabled(srv_id)
            )
        )
        start_state_file = str(getattr(self.kinorium, "state_file", ""))
        cache_key = (
            self.country_code,
            provider_filter,
            media_type_filter,
            kinorium_section,
            ui_lang,
            enabled_sig,
            start_state_file,
            getattr(self.kinorium, "_state_version", 0),
            int(time.time() // 120),
        )
        with self._catalog_lock:
            cached_base = copy.deepcopy(self._catalog_cache.get(cache_key))
        if cached_base is not None:
            cw_list = self._build_continue_watching_list(ui_lang=ui_lang)
            self._register_catalog_items(cw_list)
            cached_base["continue_watching"] = cw_list[:24]
            cached_base["kinorium_account"] = self.kinorium.get_account_summary()
            return cached_base

        if kinorium_section in ("watching", "watchlist", "watched", "never"):
            premieres_all = []
            premieres_count = self.kinorium.get_online_premieres_count()
        else:
            premieres_all = self._get_online_premieres()
            premieres_count = len(premieres_all)

        if kinorium_section == "premieres":
            items = list(premieres_all)
            if provider_filter and provider_filter not in ("all", "hdrezka", "backup4k"):
                items = [
                    it
                    for it in items
                    if any(p["id"] == provider_filter and p.get("available") for p in it.get("providers", []))
                ]
            if media_type_filter in ("movie", "series"):
                items = [it for it in items if it.get("media_type") == media_type_filter]

        elif kinorium_section in ("watching", "watchlist", "watched", "never"):
            items = self.kinorium.get_section_catalog_items(
                section=kinorium_section,
                media_type_filter=media_type_filter,
                query="",
            )
            self._enrich_from_curated(items)
            items = [self.enrich_item(it) for it in items]
            items = self._filter_items_list(items, allow_empty_providers=True)

            if provider_filter and provider_filter not in ("all", "hdrezka", "backup4k"):
                items = [
                    it
                    for it in items
                    if any(p["id"] == provider_filter and p.get("available") for p in it.get("providers", []))
                ]
        else:
            # Main Screen ('all'):
            # 1. Include series the user is watching ('Смотрю') that have new/unwatched episodes!
            # 2. Exclude movies/series where the user has ALREADY watched everything (`watched == True` and no new episodes)
            #    or marked 'Не буду смотреть' (`not_watching == True`).
            watching_new_eps = (
                [
                    self.enrich_item(it)
                    for it in self._enrich_from_curated(self.kinorium.get_watching_with_new_episodes())
                ]
                if kin_enabled
                else []
            )
            base_curated = [self.enrich_item(it) for it in self.CURATED_CATALOG]

            merged: List[Dict[str, Any]] = []
            seen_ids: Dict[str, Dict[str, Any]] = {}
            seen_titles: Dict[str, Dict[str, Any]] = {}

            def _merge_providers_into(existing_item: Dict[str, Any], incoming_item: Dict[str, Any]):
                ex_provs = [dict(p) for p in (existing_item.get("providers") or []) if isinstance(p, dict)]
                ex_map = {str(p.get("id") or ""): p for p in ex_provs if p.get("id")}
                changed = False
                for p in incoming_item.get("providers") or []:
                    if not isinstance(p, dict):
                        continue
                    pid = str(p.get("id") or "")
                    if not pid:
                        continue
                    if pid not in ex_map:
                        p_copy = dict(p)
                        ex_provs.append(p_copy)
                        ex_map[pid] = p_copy
                        changed = True
                    else:
                        old_u = str(ex_map[pid].get("url") or "")
                        new_u = str(p.get("url") or "")
                        if new_u and (not old_u or "search?" in old_u or old_u.rstrip("/") in ("https://player.pl", "https://tv.apple.com/pl", "https://www.justwatch.com/pl")):
                            ex_map[pid]["url"] = new_u
                            changed = True
                if changed:
                    existing_item["providers"] = ex_provs
                if incoming_item.get("primary_provider") and not existing_item.get("primary_provider"):
                    existing_item["primary_provider"] = incoming_item["primary_provider"]
                if incoming_item.get("_provider_rank") is not None and existing_item.get("_provider_rank") is None:
                    existing_item["_provider_rank"] = incoming_item["_provider_rank"]

            def _add_if_unwatched_main(candidate: Dict[str, Any]):
                filtered_cand = self._filter_item_by_enabled_services(candidate)
                if filtered_cand is None:
                    return
                ks = filtered_cand.get("kinorium") or {}
                if kin_enabled:
                    if self.kinorium.is_item_fully_watched_or_caught_up(
                        ks, media_type=str(filtered_cand.get("media_type") or "movie")
                    ):
                        return
                cid = str(filtered_cand.get("id") or "")
                mt_cand = str(filtered_cand.get("media_type") or "movie").strip().lower()
                t_low = str(filtered_cand.get("title") or "").strip().lower()
                orig_low = str(filtered_cand.get("orig_title") or "").strip().lower()
                existing = seen_ids.get(cid)
                if existing is None and t_low:
                    cand_by_t = seen_titles.get((mt_cand, t_low))
                    if cand_by_t is not None and self._is_same_work(cand_by_t, filtered_cand):
                        existing = cand_by_t
                if existing is None and orig_low:
                    cand_by_o = seen_titles.get((mt_cand, orig_low))
                    if cand_by_o is not None and self._is_same_work(cand_by_o, filtered_cand):
                        existing = cand_by_o
                if existing is not None:
                    _merge_providers_into(existing, filtered_cand)
                    return
                if cid:
                    seen_ids[cid] = filtered_cand
                if t_low:
                    seen_titles[(mt_cand, t_low)] = filtered_cand
                if orig_low:
                    seen_titles[(mt_cand, orig_low)] = filtered_cand
                merged.append(filtered_cand)

            is_official_provider_view = bool(
                provider_filter
                and provider_filter not in ("all", "hdrezka", "stremio", "backup4k")
            )
            if is_official_provider_view:
                extra_jw = self._fetch_justwatch_by_provider(provider_filter)
                self._enrich_from_curated(extra_jw)
                for idx, jw in enumerate(extra_jw):
                    jw_enriched = self.enrich_item(jw)
                    jw_enriched["primary_provider"] = provider_filter
                    jw_enriched["_provider_rank"] = idx
                    _add_if_unwatched_main(jw_enriched)

            # Place unwatched curated items and active series with new episodes
            for it in base_curated:
                _add_if_unwatched_main(it)
            for it in watching_new_eps:
                _add_if_unwatched_main(it)
            # Also supplement with unwatched online premieres and watchlist titles for rich variety
            for it in premieres_all:
                _add_if_unwatched_main(it)
            if kin_enabled:
                watchlist_sample = self.kinorium.get_section_catalog_items(
                    section="watchlist", media_type_filter="all", query=""
                )[:48]
                self._enrich_from_curated(watchlist_sample)
                for wl_it in watchlist_sample:
                    _add_if_unwatched_main(self.enrich_item(wl_it))

            if provider_filter and provider_filter != "all":
                if not is_official_provider_view:
                    extra_jw = self._fetch_justwatch_by_provider(provider_filter)
                    for jw in extra_jw:
                        _add_if_unwatched_main(self.enrich_item(jw))
                items = [
                    it
                    for it in merged
                    if any(p["id"] == provider_filter and p.get("available") for p in it.get("providers", []))
                ]
                if is_official_provider_view:
                    items.sort(
                        key=lambda x: (
                            0 if x.get("primary_provider") == provider_filter else 1,
                            int(x.get("_provider_rank", 9999)),
                        )
                    )
            else:
                items = merged

            if media_type_filter in ("movie", "series"):
                items = [it for it in items if it.get("media_type") == media_type_filter]

        bg_en_warm_tail: List[Dict[str, Any]] = []
        cw_list = self._build_continue_watching_list(ui_lang=ui_lang)
        if ui_lang == "en":
            if cw_list:
                self._prewarm_en_metadata_for_items(cw_list[:12], max_items=8)
            if items:
                cyr_titles = [
                    it
                    for it in items
                    if not it.get("orig_title") or has_cyrillic(str(it.get("orig_title") or ""))
                ]
                missing_plot = [
                    it
                    for it in items
                    if it not in cyr_titles and not str(it.get("description_en") or "").strip()
                ]
                seen_pw: set = set()
                prewarm_pool: List[Dict[str, Any]] = []
                for cand_it in cyr_titles + items[:12] + missing_plot:
                    oid = id(cand_it)
                    if oid not in seen_pw:
                        seen_pw.add(oid)
                        prewarm_pool.append(cand_it)
                self._prewarm_en_metadata_for_items(prewarm_pool, max_items=24)
                if len(prewarm_pool) > 24 and self.en_meta is not None:
                    bg_en_warm_tail = [copy.deepcopy(x) for x in prewarm_pool[24:60]]
        enabled_providers_meta = {
            k: v for k, v in self.PROVIDERS_META.items() if self.is_service_enabled(k)
        }
        raw_live_store = self._kinorium_state_get("series_live_meta", {}) or {}
        live_series_updates = (
            [v for v in raw_live_store.values() if isinstance(v, dict) and not v.get("not_found")]
            if kin_enabled and isinstance(raw_live_store, dict)
            else []
        )

        self._register_catalog_items(items, cw_list, premieres_all)

        base_payload = {
            "region": self.country_code,
            "providers_meta": enabled_providers_meta,
            "integrations": self.kinorium.get_integrations(),
            "kinorium_account": self.kinorium.get_account_summary(),
            "kinorium_friends": self._kinorium_state_get("friends", []) if kin_enabled else [],
            "kinorium_counts": self.kinorium.get_sections_counts(premieres_count=premieres_count),
            "continue_watching": cw_list[:24],
            "live_series_updates": live_series_updates,
            "similar_pool": self._filter_items_list([self.enrich_item(it) for it in self.CURATED_CATALOG]),
            "items": items,
        }
        if str(getattr(self.kinorium, "state_file", "")) == start_state_file:
            with self._catalog_lock:
                if len(self._catalog_cache) >= 24:
                    for k_ev in list(self._catalog_cache.keys())[:6]:
                        self._catalog_cache.pop(k_ev, None)
                self._catalog_cache[cache_key] = copy.deepcopy(base_payload)
        if bg_en_warm_tail and self.en_meta is not None:
            def _bg_en_warm() -> None:
                if self._prewarm_en_metadata_for_items(bg_en_warm_tail, max_items=36):
                    with self._catalog_lock:
                        self._catalog_cache.clear()

            threading.Thread(target=_bg_en_warm, daemon=True).start()
        return base_payload

    def _build_continue_watching_list(self, ui_lang: str = "ru") -> List[Dict[str, Any]]:
        """
        Builds 'Новые серии и Продолжить просмотр' (continue_watching):
        - Only includes items that are NOT completely watched (`not watched` or `has_new_episode`)
        - Automatically includes series from 'Смотрю' that have new/unwatched episodes!
        """
        if (
            not self.is_service_enabled("hdrezka")
            and not self.is_service_enabled("backup4k")
            and not self.is_service_enabled("stremio")
        ):
            return []

        kin_enabled = self.is_service_enabled("kinorium")
        cw_list: List[Dict[str, Any]] = []
        cw_seen_titles = set()
        cw_seen_ids = set()
        cw_dismissed = set(self._kinorium_state_get("cw_dismissed", []) or [])

        for cw in self._kinorium_state_get("continue_watching", []) or []:
            if not isinstance(cw, dict):
                continue
            cw_id = cw.get("id", "")
            cw_raw_t = (cw.get("title", "") or "").strip()
            cw_norm_t = self.kinorium._norm_title(cw_raw_t) if hasattr(self.kinorium, "_norm_title") else cw_raw_t.lower()
            cw_low_t = cw_raw_t.lower()
            if (
                cw_id in cw_dismissed
                or (cw_norm_t and f"title:{cw_norm_t}" in cw_dismissed)
                or (cw_low_t and f"title:{cw_low_t}" in cw_dismissed)
            ):
                continue
            try:
                cur_time_val = float(cw.get("current_time") or 0)
            except (TypeError, ValueError):
                cur_time_val = 0.0
            k_st = self.kinorium.get_item_status(
                cw.get("id", ""),
                title=cw.get("title", ""),
                orig_title=cw.get("orig_title", ""),
            )
            has_prior_series_progress = bool(
                cw.get("media_type") == "series"
                and (
                    cw.get("is_auto_next")
                    or int(cw.get("episode") or 1) > 1
                    or int(cw.get("season") or 1) > 1
                    or any(bool(v) for v in (k_st.get("watched_episodes") or {}).values())
                )
            )
            if cur_time_val < 15.0 and not cw.get("is_new_episode") and not has_prior_series_progress:
                continue
            if kin_enabled:
                if self.kinorium.is_item_fully_watched_or_caught_up(
                    k_st, media_type=str(cw.get("media_type") or "series")
                ):
                    continue
            cw_copy = dict(cw)
            kid_str = str(k_st.get("kinorium_id") or cw_copy.get("kinorium_id") or "")
            if kid_str:
                cw_copy["kinorium_id"] = kid_str
            w_info = k_st.get("watched_info")
            if isinstance(w_info, dict) and w_info.get("orig_title") and (
                not cw_copy.get("orig_title") or has_cyrillic(str(cw_copy.get("orig_title") or ""))
            ):
                cw_copy["orig_title"] = w_info["orig_title"]
            matched_cat = self._match_curated_catalog_entry(cw_copy)
            if matched_cat:
                mc_imdb = matched_cat.get("imdb_id") or (
                    matched_cat.get("id", "") if str(matched_cat.get("id", "")).startswith("tt") else ""
                )
                if mc_imdb and not cw_copy.get("imdb_id"):
                    cw_copy["imdb_id"] = mc_imdb
                if matched_cat.get("orig_title") and (
                    not cw_copy.get("orig_title") or has_cyrillic(str(cw_copy.get("orig_title") or ""))
                ):
                    cw_copy["orig_title"] = matched_cat["orig_title"]
                cw_copy["poster"] = matched_cat["poster"]
                cw_copy["poster_en"] = matched_cat.get("poster_en") or resolve_original_poster_url(matched_cat)
                cw_copy["backdrop"] = matched_cat["backdrop"]
            else:
                cw_copy["poster_en"] = resolve_original_poster_url(cw_copy)
            if self.en_meta is not None:
                cached_en = self.en_meta.get_cached(
                    item_id=str(cw_copy.get("id") or ""),
                    title=str(cw_copy.get("title") or ""),
                    orig_title=str(cw_copy.get("orig_title") or ""),
                    year=self._safe_int(cw_copy.get("year")),
                    media_type=str(cw_copy.get("media_type") or "series"),
                    imdb_id=str(cw_copy.get("imdb_id") or ""),
                )
                if cached_en and cached_en.get("ok"):
                    if cached_en.get("imdb_id") and not cw_copy.get("imdb_id"):
                        cw_copy["imdb_id"] = cached_en["imdb_id"]
                    if cached_en.get("title_en") and (
                        not cw_copy.get("orig_title") or has_cyrillic(str(cw_copy.get("orig_title") or ""))
                    ):
                        cw_copy["orig_title"] = cached_en["title_en"]
                    if cached_en.get("poster_en"):
                        cw_copy["poster_en"] = cached_en["poster_en"]
                    if cached_en.get("backdrop_en"):
                        cw_copy["backdrop_en"] = cached_en["backdrop_en"]
            cw_copy["backdrop_en"] = resolve_original_backdrop_url(cw_copy)
            cur_cw_bg = str(cw_copy.get("backdrop") or "").strip()
            en_cw_bg = str(cw_copy.get("backdrop_en") or "").strip()
            if en_cw_bg and "kinorium.com/movie/" not in en_cw_bg and (
                not cur_cw_bg
                or cur_cw_bg == str(cw_copy.get("poster") or "").strip()
                or "kinorium.com/movie/" in cur_cw_bg
                or "/poster/" in cur_cw_bg
            ):
                cw_copy["backdrop"] = en_cw_bg
            if (cw_copy.get("is_new_episode") or cur_time_val < 15.0) and k_st.get("episode_verified"):
                cw_copy["season"] = k_st.get("next_season") or cw_copy.get("season") or 1
                cw_copy["episode"] = k_st.get("next_episode") or cw_copy.get("episode") or 1
            cw_copy["episode_verified"] = bool(
                k_st.get("episode_verified") or not cw_copy.get("is_new_episode")
            )
            if k_st.get("studios_summary") and (
                not cw_copy.get("studio") or cw_copy.get("studio") == "Новая серия"
            ):
                cw_copy["studio"] = k_st["studios_summary"]
            cw_copy["kinorium"] = k_st
            cw_list.append(cw_copy)
            cw_seen_ids.add(cw_copy.get("id", ""))
            cw_mt_k = str(cw_copy.get("media_type") or "series").strip().lower()
            cw_t_k = cw_copy.get("title", "").strip().lower()
            if cw_t_k:
                cw_seen_titles.add((cw_mt_k, cw_t_k))

        has_any_stream_srv = (
            self.is_service_enabled("hdrezka")
            or self.is_service_enabled("stremio")
            or self.is_service_enabled("backup4k")
        )
        default_cw_src = (
            "HDRezka"
            if self.is_service_enabled("hdrezka")
            else ("Stremio" if self.is_service_enabled("stremio") else "4K Remux")
        )
        if kin_enabled and has_any_stream_srv:
            for w_ep_raw in self._enrich_from_curated(self.kinorium.get_watching_with_new_episodes()):
                w_ep = self.enrich_item(w_ep_raw)
                t_raw = w_ep.get("title", "").strip()
                t_low = t_raw.lower()
                t_norm = self.kinorium._norm_title(t_raw) if hasattr(self.kinorium, "_norm_title") else t_low
                if (
                    w_ep["id"] in cw_dismissed
                    or (t_norm and f"title:{t_norm}" in cw_dismissed)
                    or (t_low and f"title:{t_low}" in cw_dismissed)
                ):
                    continue
                if w_ep["id"] in cw_seen_ids or (t_low and ("series", t_low) in cw_seen_titles):
                    continue
                ks = w_ep.get("kinorium") or {}
                w_bg_en = w_ep.get("backdrop_en") or resolve_original_backdrop_url(w_ep)
                w_bg = str(w_ep.get("backdrop") or "").strip()
                if w_bg_en and "kinorium.com/movie/" not in w_bg_en and (
                    not w_bg
                    or w_bg == str(w_ep.get("poster") or "").strip()
                    or "kinorium.com/movie/" in w_bg
                    or "/poster/" in w_bg
                ):
                    w_bg = w_bg_en
                cw_list.append(
                    {
                        "id": w_ep["id"],
                        "imdb_id": w_ep.get("imdb_id", ""),
                        "kinorium_id": w_ep.get("kinorium_id") or ks.get("kinorium_id", ""),
                        "year": w_ep.get("year"),
                        "title": w_ep["title"],
                        "orig_title": w_ep.get("orig_title", ""),
                        "rezka_id": w_ep.get("rezka_id", ""),
                        "rezka_url": w_ep.get("rezka_url", ""),
                        "poster": w_ep.get("poster", ""),
                        "poster_en": w_ep.get("poster_en") or resolve_original_poster_url(w_ep),
                        "backdrop": w_bg or w_ep.get("poster", ""),
                        "backdrop_en": w_bg_en,
                        "media_type": "series",
                        "season": ks.get("next_season") or 1,
                        "episode": ks.get("next_episode") or 1,
                        "episode_verified": bool(ks.get("episode_verified")),
                        "latest_season": ks.get("latest_season"),
                        "latest_episode": ks.get("latest_episode"),
                        "current_time": 0.0,
                        "duration": 3300.0,
                        "progress": 0.0,
                        "is_new_episode": False,
                        "source": default_cw_src,
                        "studio": ks.get("studios_summary") or default_cw_src,
                        "kinorium": ks,
                    }
                )
                cw_seen_ids.add(w_ep["id"])
                if t_low:
                    cw_seen_titles.add(("series", t_low))
        if cw_list and self.en_meta is not None:
            cw_need_bg = [
                it
                for it in cw_list[:24]
                if not str(it.get("backdrop") or "").strip()
                or "kinorium.com/movie/" in str(it.get("backdrop") or "")
                or str(it.get("backdrop") or "") == str(it.get("poster") or "")
            ]
            if ui_lang == "en":
                self._prewarm_en_metadata_for_items(cw_list[:12], max_items=8)
            elif cw_need_bg:
                self._prewarm_en_metadata_for_items(cw_need_bg[:8], max_items=8)
            remaining_bg = [
                dict(it)
                for it in cw_list[:24]
                if "kinorium.com/movie/" in str(it.get("backdrop") or "")
                or str(it.get("backdrop") or "") == str(it.get("poster") or "")
            ]
            if remaining_bg:
                threading.Thread(
                    target=self._prewarm_en_metadata_for_items,
                    args=(remaining_bg, len(remaining_bg)),
                    daemon=True,
                ).start()
        return cw_list

    def unified_search(
        self,
        query: str,
        provider_filter: str = "all",
        media_type_filter: str = "all",
        kinorium_section: str = "all",
        lang: str = "ru",
        mode: str = "full",
    ) -> Dict[str, Any]:
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        is_suggest = str(mode or "").strip().lower() == "suggest"
        q_clean = str(query or "").strip()
        if not q_clean:
            if is_suggest:
                return {"query": "", "mode": "suggest", "region": self.country_code, "persons": [], "items": []}
            return self.get_catalog(provider_filter, media_type_filter, kinorium_section, lang=ui_lang)

        if provider_filter and provider_filter != "all" and not self.is_service_enabled(provider_filter):
            provider_filter = "all"

        kin_enabled = self.is_service_enabled("kinorium")
        if not kin_enabled and kinorium_section in ("watching", "watchlist", "watched", "never"):
            kinorium_section = "all"

        if is_suggest:
            premieres_all: List[Dict[str, Any]] = []
            premieres_count = 0
            cw_list: List[Dict[str, Any]] = []
            enabled_providers_meta = {
                k: v for k, v in self.PROVIDERS_META.items() if self.is_service_enabled(k)
            }
            sim_pool: List[Dict[str, Any]] = []
        else:
            premieres_all = self._get_online_premieres()
            premieres_count = len(premieres_all)
            cw_list = self._build_continue_watching_list(ui_lang=ui_lang)
            enabled_providers_meta = {
                k: v for k, v in self.PROVIDERS_META.items() if self.is_service_enabled(k)
            }
            sim_pool = self._filter_items_list([self.enrich_item(it) for it in self.CURATED_CATALOG])

        if not is_suggest and kinorium_section == "premieres":
            q_low = q_clean.lower()
            matched = [
                it
                for it in premieres_all
                if q_low in it.get("title", "").lower() or q_low in it.get("orig_title", "").lower()
            ]
            if media_type_filter in ("movie", "series"):
                matched = [it for it in matched if it.get("media_type") == media_type_filter]
            if provider_filter and provider_filter != "all":
                matched = [
                    it
                    for it in matched
                    if any(
                        isinstance(p, dict) and p.get("id") == provider_filter and p.get("available")
                        for p in (it.get("providers") or [])
                    )
                ]
            similar_items = self._build_search_similar_items(
                matched=matched,
                extra_candidates=[],
                sim_pool=sim_pool,
                premieres_all=premieres_all,
                provider_filter=provider_filter,
                media_type_filter=media_type_filter,
                kin_enabled=kin_enabled,
            )
            self._register_catalog_items(matched, cw_list, similar_items)
            return {
                "query": q_clean,
                "region": self.country_code,
                "providers_meta": enabled_providers_meta,
                "integrations": self.kinorium.get_integrations(),
                "kinorium_account": self.kinorium.get_account_summary(),
                "kinorium_friends": self._kinorium_state_get("friends", []) if kin_enabled else [],
                "kinorium_counts": self.kinorium.get_sections_counts(premieres_count=premieres_count),
                "continue_watching": cw_list[:24],
                "similar_pool": sim_pool,
                "similar_items": similar_items,
                "similar_source": (
                    "kinorium"
                    if any(str(x.get("similar_source") or "") == "kinorium" for x in similar_items)
                    else "curated"
                ),
                "persons": [],
                "items": matched,
            }

        if not is_suggest and kinorium_section in ("watching", "watchlist", "watched", "never"):
            sec_enriched = [
                self.enrich_item(it)
                for it in self._enrich_from_curated(
                    self.kinorium.get_section_catalog_items(
                        section=kinorium_section,
                        media_type_filter=media_type_filter,
                        query=q_clean,
                    )
                )
            ]
            matched = self._filter_items_list(
                sec_enriched,
                allow_empty_providers=(provider_filter in ("", "all")),
            )
            if provider_filter and provider_filter != "all":
                matched = [
                    it
                    for it in matched
                    if any(
                        isinstance(p, dict) and p.get("id") == provider_filter and p.get("available")
                        for p in (it.get("providers") or [])
                    )
                ]
            similar_items = self._build_search_similar_items(
                matched=matched,
                extra_candidates=[],
                sim_pool=sim_pool,
                premieres_all=premieres_all,
                provider_filter=provider_filter,
                media_type_filter=media_type_filter,
                kin_enabled=kin_enabled,
            )
            self._register_catalog_items(matched, cw_list, similar_items)
            return {
                "query": q_clean,
                "region": self.country_code,
                "providers_meta": enabled_providers_meta,
                "integrations": self.kinorium.get_integrations(),
                "kinorium_account": self.kinorium.get_account_summary(),
                "kinorium_friends": self._kinorium_state_get("friends", []) if kin_enabled else [],
                "kinorium_counts": self.kinorium.get_sections_counts(premieres_count=premieres_count),
                "continue_watching": cw_list[:24],
                "similar_pool": sim_pool,
                "similar_items": similar_items,
                "similar_source": (
                    "kinorium"
                    if any(str(x.get("similar_source") or "") == "kinorium" for x in similar_items)
                    else "curated"
                ),
                "persons": [],
                "items": matched,
            }

        q_lower = q_clean.lower()
        q_norm = _norm_title(q_clean)
        stop_words = {
            "в",
            "на",
            "и",
            "с",
            "по",
            "из",
            "за",
            "к",
            "о",
            "у",
            "от",
            "до",
            "для",
            "the",
            "a",
            "an",
            "of",
            "in",
            "on",
            "to",
            "and",
        }
        raw_words = [w for w in q_norm.split() if w]
        sig_tokens = [w for w in raw_words if w not in stop_words and len(w) >= 2]
        if not sig_tokens:
            sig_tokens = raw_words

        rz_lock = getattr(self.rezka, "_cache_lock", None)
        if rz_lock is not None:
            with rz_lock:
                is_person_search = q_lower in self.rezka.person_url_by_name
        else:
            is_person_search = q_lower in self.rezka.person_url_by_name
        known_genres = {
            str(g).strip().lower()
            for c_it in self.CURATED_CATALOG
            for g in (c_it.get("genres") or [])
            if g
        }
        is_genre_search = len(sig_tokens) == 1 and q_norm in known_genres

        merged_pool: List[Dict[str, Any]] = []
        raw_person_candidates: List[Dict[str, Any]] = []

        def _add_or_merge_candidate(raw_cand: Dict[str, Any], allow_empty_providers: bool = False):
            filtered_cand = self._filter_item_by_enabled_services(
                raw_cand, allow_empty_providers=allow_empty_providers
            )
            if filtered_cand is None:
                return
            for idx, existing in enumerate(merged_pool):
                if self._is_same_work(existing, filtered_cand):
                    merged_pool[idx] = self._merge_two_search_items(existing, filtered_cand, sig_tokens)
                    return
            merged_pool.append(filtered_cand)

        for item in self.CURATED_CATALOG:
            title_hay = " ".join(
                [
                    item.get("title", ""),
                    item.get("title_pl", ""),
                    item.get("orig_title", ""),
                ]
            ).lower()
            genre_hay = " ".join(item.get("genres", [])).lower() if is_genre_search else ""
            cast_pairs: List[tuple] = []
            for d_ru, d_en in itertools.zip_longest(
                list(item.get("directors") or []),
                list(item.get("directors_en") or []),
                fillvalue="",
            ):
                cast_pairs.append((str(d_ru or "").strip(), str(d_en or "").strip(), "Режиссёр"))
            for a_ru, a_en in itertools.zip_longest(
                list(item.get("actors") or []),
                list(item.get("actors_en") or []),
                fillvalue="",
            ):
                cast_pairs.append((str(a_ru or "").strip(), str(a_en or "").strip(), "Актёр"))

            matched_cast_person = False
            if len(q_clean) >= 3:
                for p_ru, p_en, p_role in cast_pairs:
                    hay_p = f"{p_ru} {p_en}".lower()
                    if q_lower in hay_p or (len(q_clean) >= 4 and (
                        _names_match_ru_en(p_ru, q_clean) >= 0.78
                        or (p_en and _names_match_ru_en(p_en, q_clean) >= 0.78)
                    )):
                        matched_cast_person = True
                        p_lookup = (p_ru or p_en).lower()
                        if rz_lock is not None:
                            with rz_lock:
                                p_photo = self.rezka.person_photo_by_name.get(p_lookup, "")
                        else:
                            p_photo = self.rezka.person_photo_by_name.get(p_lookup, "")
                        raw_person_candidates.append(
                            {
                                "name": p_ru or p_en,
                                "orig_name": p_en or (p_ru if not has_cyrillic(p_ru) else ""),
                                "role": p_role,
                                "photo": p_photo,
                                "person_url": self.rezka.find_cached_person_url(p_ru or p_en),
                                "hint_title": str(item.get("title") or ""),
                                "hint_orig": str(item.get("orig_title") or ""),
                            }
                        )

            if q_lower in title_hay or (is_genre_search and q_lower in genre_hay) or matched_cast_person:
                enr_cur = self.enrich_item(item)
                if matched_cast_person and q_lower not in title_hay:
                    enr_cur["_from_person_match"] = True
                _add_or_merge_candidate(enr_cur)

        if kin_enabled:
            for sec in ("watching", "watchlist", "watched", "never"):
                for k_item in self.kinorium.get_section_catalog_items(sec, "all", q_clean):
                    _add_or_merge_candidate(k_item, allow_empty_providers=True)

        want_rz = self.is_service_enabled("hdrezka")
        want_kn_search = bool(
            kin_enabled and len(q_clean) >= 2 and hasattr(self.kinorium, "search_persons_and_movies")
        )
        want_jw = bool(
            (not is_suggest or not want_rz)
            and not is_person_search
            and any(self.is_service_enabled(s) for s in ("appletv", "netflix", "prime", "disney", "max", "playerpl"))
        )
        want_st = bool(
            (not is_suggest or not want_rz)
            and self.stremio is not None
            and self.is_service_enabled("stremio")
            and not is_person_search
        )
        active_search_tasks = sum(
            [1 if want_rz else 0, 1 if want_kn_search else 0, 1 if want_jw else 0, 1 if want_st else 0]
        )
        rz_hits: List[Dict[str, Any]] = []
        kn_hits: List[Dict[str, Any]] = []
        kn_persons: List[Dict[str, Any]] = []
        jw_hits: List[Dict[str, Any]] = []
        st_hits: List[Dict[str, Any]] = []

        t_rz = 2.2 if is_suggest else 9.0
        t_kn = 2.2 if is_suggest else 7.5
        t_jw = 2.0 if is_suggest else 6.0
        t_st = 2.0 if is_suggest else 5.5

        if active_search_tasks > 1:
            from concurrent.futures import ThreadPoolExecutor

            with ThreadPoolExecutor(max_workers=active_search_tasks) as search_pool:
                fut_rz = search_pool.submit(self._search_hdrezka_live, q_clean) if want_rz else None
                fut_kn = (
                    search_pool.submit(self.kinorium.search_persons_and_movies, q_clean)
                    if want_kn_search
                    else None
                )
                fut_jw = search_pool.submit(self._search_justwatch_poland, q_clean) if want_jw else None
                fut_st = (
                    search_pool.submit(self.stremio.search_cinemeta, q_clean, media_type_filter)
                    if want_st
                    else None
                )
                if fut_rz is not None:
                    try:
                        rz_hits = fut_rz.result(timeout=t_rz) or []
                    except Exception:
                        rz_hits = []
                if fut_kn is not None:
                    try:
                        kn_both = fut_kn.result(timeout=t_kn) or {}
                        kn_persons = list(kn_both.get("persons") or [])
                        if kin_enabled and not is_person_search:
                            kn_hits = list(kn_both.get("movies") or [])
                    except Exception:
                        kn_hits = []
                if fut_jw is not None:
                    try:
                        jw_hits = fut_jw.result(timeout=t_jw) or []
                    except Exception:
                        jw_hits = []
                if fut_st is not None:
                    try:
                        st_hits = fut_st.result(timeout=t_st) or []
                    except Exception:
                        st_hits = []
        else:
            if want_rz:
                rz_hits = self._search_hdrezka_live(q_clean)
            if want_kn_search:
                kn_both = self.kinorium.search_persons_and_movies(q_clean)
                kn_persons = list(kn_both.get("persons") or [])
                if kin_enabled and not is_person_search:
                    kn_hits = list(kn_both.get("movies") or [])
            if want_jw:
                jw_hits = self._search_justwatch_poland(q_clean)
            if want_st:
                st_hits = self.stremio.search_cinemeta(q_clean, media_type_filter)

        for kp in kn_persons:
            raw_person_candidates.append(
                {
                    "kinorium_person_id": str(kp.get("kinorium_person_id") or ""),
                    "name": str(kp.get("name") or ""),
                    "orig_name": str(kp.get("orig_name") or ""),
                    "role": "Персона",
                    "photo": str(kp.get("photo") or ""),
                    "birth_date": str(kp.get("birth_date") or ""),
                    "person_url": self.rezka.find_cached_person_url(str(kp.get("name") or "")),
                    "hint_title": "",
                    "hint_orig": "",
                }
            )

        deduped_persons: List[Dict[str, Any]] = []
        seen_p_norms: set = set()
        for pc in raw_person_candidates:
            p_ru = str(pc.get("name") or "").strip()
            p_en = str(pc.get("orig_name") or "").strip()
            if not p_ru and not p_en:
                continue
            k_ru = _norm_title(p_ru)
            k_en = _norm_title(p_en)
            existing_p = None
            for dp in deduped_persons:
                if (k_ru and k_ru == dp.get("_k_ru")) or (k_en and k_en == dp.get("_k_en")):
                    existing_p = dp
                    break
            if existing_p is not None:
                if pc.get("photo") and not existing_p.get("photo"):
                    existing_p["photo"] = pc["photo"]
                if pc.get("kinorium_person_id") and not existing_p.get("kinorium_person_id"):
                    existing_p["kinorium_person_id"] = pc["kinorium_person_id"]
                if pc.get("person_url") and not existing_p.get("person_url"):
                    existing_p["person_url"] = pc["person_url"]
                if pc.get("role") and existing_p.get("role") == "Персона" and pc.get("role") != "Персона":
                    existing_p["role"] = pc["role"]
                continue
            if (k_ru and k_ru in seen_p_norms) or (k_en and k_en in seen_p_norms):
                continue
            if k_ru:
                seen_p_norms.add(k_ru)
            if k_en:
                seen_p_norms.add(k_en)
            pc_copy = dict(pc)
            pc_copy["_k_ru"] = k_ru
            pc_copy["_k_en"] = k_en
            deduped_persons.append(pc_copy)

        def _person_match_score(p_obj: Dict[str, Any]) -> float:
            k_ru = str(p_obj.get("_k_ru") or "")
            k_en = str(p_obj.get("_k_en") or "")
            sc = 0.0
            if q_norm and (q_norm == k_ru or q_norm == k_en):
                sc += 150.0
            elif q_norm and ((k_ru and k_ru.startswith(q_norm)) or (k_en and k_en.startswith(q_norm))):
                sc += 95.0
            elif sig_tokens and all(
                any(w.startswith(t) for w in f"{k_ru} {k_en}".split()) for t in sig_tokens
            ):
                sc += 80.0
            elif q_norm and ((k_ru and q_norm in k_ru) or (k_en and q_norm in k_en)):
                sc += 55.0
            if p_obj.get("photo"):
                sc += 25.0
            if p_obj.get("birth_date"):
                sc += 10.0
            return sc

        deduped_persons = [p for p in deduped_persons if _person_match_score(p) >= 50.0]
        deduped_persons.sort(key=_person_match_score, reverse=True)

        top_matched_person = deduped_persons[0] if deduped_persons else None
        is_strong_person_query = bool(
            is_person_search
            or (
                top_matched_person is not None
                and (
                    _person_match_score(top_matched_person) >= 100.0
                    or (len(sig_tokens) >= 2 and _person_match_score(top_matched_person) >= 80.0)
                )
            )
        )

        out_persons: List[Dict[str, Any]] = []
        for dp in deduped_persons[:6]:
            ru_n = str(dp.get("name") or "").strip()
            en_n = str(dp.get("orig_name") or "").strip()
            disp_n = (
                (en_n or (ru_n if not has_cyrillic(ru_n) else transliterate_cyrillic(ru_n)))
                if ui_lang == "en"
                else (ru_n or en_n)
            )
            role_ru = str(dp.get("role") or "Персона")
            role_out = (
                (translate_career_role_en(role_ru) or "Person")
                if ui_lang == "en" and role_ru != "Персона"
                else ("Person" if ui_lang == "en" else role_ru)
            )
            ph = str(dp.get("photo") or "")
            ph_ep = f"/api/person-photo?name={urllib.parse.quote(ru_n or disp_n)}" + (
                f"&url={urllib.parse.quote(ph)}" if ph else ""
            )
            out_persons.append(
                {
                    "kinorium_person_id": str(dp.get("kinorium_person_id") or ""),
                    "name": disp_n,
                    "ru_name": ru_n,
                    "orig_name": en_n,
                    "role": role_out,
                    "photo": ph,
                    "photo_endpoint": ph_ep,
                    "person_url": str(dp.get("person_url") or ""),
                    "hint_title": str(dp.get("hint_title") or ""),
                    "hint_orig": str(dp.get("hint_orig") or ""),
                }
            )

        if not is_suggest and is_strong_person_query and hasattr(self.kinorium, "fetch_person_filmography"):
            top_pid = str((top_matched_person or {}).get("kinorium_person_id") or "")
            p_filmog = self.kinorium.fetch_person_filmography(persona_id=top_pid, name=q_clean)
            if p_filmog and p_filmog.get("sections"):
                if out_persons and p_filmog.get("career_roles"):
                    first_role_ru = p_filmog["career_roles"].split(",")[0].strip()
                    if first_role_ru:
                        out_persons[0]["role"] = (
                            (translate_career_role_en(first_role_ru) or "Person")
                            if ui_lang == "en"
                            else first_role_ru
                        )
                seen_f_kids: set = set()
                for sec_f in p_filmog.get("sections") or []:
                    for fw in (sec_f.get("items") or [])[:28]:
                        fkid = str(fw.get("kinorium_id") or fw.get("id") or "")
                        if fkid and fkid in seen_f_kids:
                            continue
                        if fkid:
                            seen_f_kids.add(fkid)
                        fw_enr = self.enrich_item(fw)
                        fw_enr["_from_person_match"] = True
                        _add_or_merge_candidate(fw_enr, allow_empty_providers=True)

        for rz_item in rz_hits:
            rz_enriched = self.enrich_item(rz_item)
            rz_enriched["_from_hdrezka"] = True
            _add_or_merge_candidate(rz_enriched)

        for kn_item in kn_hits:
            _add_or_merge_candidate(self.enrich_item(kn_item), allow_empty_providers=True)

        for jw in jw_hits:
            _add_or_merge_candidate(self.enrich_item(jw))

        for st_item in st_hits:
            _add_or_merge_candidate(self.enrich_item(st_item))

        extra_for_similar: List[Dict[str, Any]] = []

        if is_strong_person_query or is_genre_search or not sig_tokens:
            relevant_items = list(merged_pool)
        else:
            strict_hits: List[Dict[str, Any]] = []
            partial_hits: List[Dict[str, Any]] = []
            person_hits: List[Dict[str, Any]] = [c for c in merged_pool if c.get("_from_person_match")]
            longest_tok = max(sig_tokens, key=len)

            for cand in merged_pool:
                aliases_set = self._extract_item_aliases(cand)
                alias_words = {w for a in aliases_set for w in a.split()}

                def _matches_tok(tok: str) -> bool:
                    return any(
                        w == tok
                        or (len(tok) >= 3 and w.startswith(tok))
                        or (len(tok) >= 5 and tok in w)
                        for w in alias_words
                    )

                matched_count = sum(1 for tok in sig_tokens if _matches_tok(tok))
                if matched_count == len(sig_tokens):
                    strict_hits.append(cand)
                elif matched_count > 0:
                    partial_hits.append(cand)
                    extra_for_similar.append(cand)

            if strict_hits:
                relevant_items = strict_hits + [p for p in person_hits if p not in strict_hits]
            elif person_hits:
                relevant_items = person_hits
            else:
                # Fallback 1: match longest distinctive token (e.g. if one service omitted a prefix word)
                fallback_longest = (
                    [
                        c
                        for c in partial_hits
                        if len(longest_tok) >= 4
                        and any(
                            w == longest_tok or w.startswith(longest_tok)
                            for a in self._extract_item_aliases(c)
                            for w in a.split()
                        )
                    ]
                    if partial_hits
                    else []
                )
                if fallback_longest:
                    relevant_items = fallback_longest
                else:
                    # Fallback 2: user manually typed a director/actor name into search -> keep HDRezka filmography hits
                    hdrezka_person_hits = [c for c in merged_pool if c.get("_from_hdrezka")]
                    relevant_items = hdrezka_person_hits if hdrezka_person_hits else partial_hits

        def _relevance_rank(cand: Dict[str, Any]) -> float:
            aliases_set = self._extract_item_aliases(cand)
            sc = 0.0
            if q_norm in aliases_set:
                sc += 140.0
            elif cand.get("_from_person_match"):
                sc += 95.0
            elif not is_strong_person_query and any(a.startswith(q_norm) for a in aliases_set):
                sc += 80.0
            elif not is_strong_person_query and any(q_norm in a for a in aliases_set):
                sc += 50.0
            elif is_strong_person_query and any(q_norm in a for a in aliases_set):
                sc += 20.0
            if cand.get("rezka_id"):
                sc += 15.0
            ks = cand.get("kinorium") or {}
            if ks.get("watching") or ks.get("in_watchlist") or ks.get("watched"):
                sc += 10.0
            try:
                kr = float(ks.get("kinorium_rating") or (cand.get("ratings") or {}).get("kinorium") or 7.5)
            except (ValueError, TypeError):
                kr = 7.5
            sc += min(10.0, kr) * 1.8
            try:
                yr_v = int(cand.get("year") or 0)
                if yr_v >= 1950:
                    sc += min(6.0, max(0.0, (yr_v - 1980) * 0.1))
            except (ValueError, TypeError):
                pass
            return sc

        relevant_items.sort(key=_relevance_rank, reverse=True)

        matched = [self._strip_internal_search_keys(it) for it in relevant_items]

        if provider_filter and provider_filter != "all":
            matched = [
                it
                for it in matched
                if any(p["id"] == provider_filter and p.get("available") for p in it.get("providers", []))
            ]

        if media_type_filter in ("movie", "series"):
            matched = [it for it in matched if it.get("media_type") == media_type_filter]

        if is_suggest:
            top_suggest_items = matched[:8]
            if ui_lang == "en" and top_suggest_items:
                self._prewarm_en_metadata_for_items(top_suggest_items[:4], max_items=4)
            self._register_catalog_items(top_suggest_items)
            return {
                "query": q_clean,
                "mode": "suggest",
                "region": self.country_code,
                "persons": out_persons[:5],
                "items": top_suggest_items,
            }

        if ui_lang == "en" and matched:
            self._prewarm_en_metadata_for_items(matched[:8], max_items=8)

        similar_items = self._build_search_similar_items(
            matched=matched,
            extra_candidates=extra_for_similar,
            sim_pool=sim_pool,
            premieres_all=premieres_all,
            provider_filter=provider_filter,
            media_type_filter=media_type_filter,
            kin_enabled=kin_enabled,
        )

        self._register_catalog_items(matched, cw_list, similar_items)

        return {
            "query": q_clean,
            "region": self.country_code,
            "providers_meta": enabled_providers_meta,
            "integrations": self.kinorium.get_integrations(),
            "kinorium_account": self.kinorium.get_account_summary(),
            "kinorium_friends": self._kinorium_state_get("friends", []) if kin_enabled else [],
            "kinorium_counts": self.kinorium.get_sections_counts(premieres_count=premieres_count),
            "continue_watching": cw_list[:24],
            "similar_pool": sim_pool,
            "similar_items": similar_items,
            "similar_source": (
                "kinorium"
                if any(str(x.get("similar_source") or "") == "kinorium" for x in similar_items)
                else "curated"
            ),
            "persons": out_persons[:6],
            "items": matched,
        }

    COUNTRY_STOPWORDS = {
        "сша",
        "великобритания",
        "россия",
        "ссср",
        "франция",
        "германия",
        "италия",
        "испания",
        "канада",
        "япония",
        "южная корея",
        "корея",
        "китай",
        "польша",
        "австралия",
        "швеция",
        "дания",
        "норвегия",
        "бельгия",
        "нидерланды",
        "ирландия",
        "мексика",
        "бразилия",
        "индия",
        "турция",
        "украина",
        "чехия",
        "финляндия",
        "швейцария",
        "австрия",
        "новая зеландия",
        "гонконг",
        "тайвань",
        "аргентина",
        "зарубежные",
        "русские",
    }

    GENERIC_SIMILAR_WORDS = {
        "фильм",
        "сериал",
        "сезон",
        "часть",
        "история",
        "жизнь",
        "любовь",
        "война",
        "город",
        "время",
        "черный",
        "белый",
        "новый",
        "последний",
        "первый",
        "большой",
        "маленький",
        "тайна",
        "дело",
        "дом",
        "путь",
        "мир",
        "день",
        "ночь",
        "человек",
        "люди",
        "семья",
        "клан",
        "movie",
        "series",
        "story",
        "world",
        "house",
        "black",
        "white",
        "night",
        "first",
    }

    GENRE_CANONICAL_MAP = {
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
    }

    @classmethod
    def _canonical_genre(cls, raw_genre: str) -> str:
        gs = str(raw_genre or "").strip()
        if not gs:
            return ""
        return cls.GENRE_CANONICAL_MAP.get(gs.lower(), gs)

    @staticmethod
    def _extract_item_aliases(item: Dict[str, Any]) -> Set[str]:
        aliases: Set[str] = set()

        def _push_variant(v: str):
            if not v:
                return
            aliases.add(v)
            stripped = re.sub(
                r"\b(?:фильм|сериал|кино)\s+по\s+мотивам(?:\s+сериала|\s+фильма)?\s+",
                "",
                v,
            ).strip()
            stripped = re.sub(r"\s+", " ", stripped)
            if stripped and stripped != v:
                aliases.add(stripped)

        for field in ("title", "orig_title", "title_pl"):
            for v in _title_variants(str(item.get(field) or "")):
                _push_variant(v)
        for raw_a in item.get("_aliases") or []:
            for v in _title_variants(str(raw_a or "")):
                _push_variant(v)
        ks = item.get("kinorium")
        if isinstance(ks, dict):
            w_info = ks.get("watched_info")
            if isinstance(w_info, dict):
                for field in ("ru_title", "orig_title", "title"):
                    for v in _title_variants(str(w_info.get(field) or "")):
                        _push_variant(v)
        return aliases

    @staticmethod
    def _poster_quality_score(url: str, is_backdrop: bool = False) -> int:
        u = (url or "").strip().lower()
        if not u:
            return 0
        if "hdrezka" in u or "rezka" in u:
            return 1
        score = 3 if any(h in u for h in ("images.justwatch.com", "ru-images.kinorium.com", "image.tmdb.org", "unsplash.com")) else 2
        if is_backdrop and any(w in u for w in ("1080", "1920", "backdrop", "original")):
            score += 2
        return score

    @classmethod
    def _is_same_work(cls, a: Dict[str, Any], b: Dict[str, Any]) -> bool:
        mt_a = str(a.get("media_type") or "")
        mt_b = str(b.get("media_type") or "")
        id_a = str(a.get("id") or "")
        id_b = str(b.get("id") or "")
        imdb_a = str(a.get("imdb_id") or (id_a if id_a.startswith("tt") else "") or "").strip()
        imdb_b = str(b.get("imdb_id") or (id_b if id_b.startswith("tt") else "") or "").strip()
        if imdb_a and imdb_b:
            return imdb_a == imdb_b
        if mt_a in ("movie", "series") and mt_b in ("movie", "series") and mt_a != mt_b:
            return False
        if id_a and id_a == id_b:
            return True
        kid_a = str(
            a.get("kinorium_id")
            or (a.get("kinorium") or {}).get("kinorium_id")
            or (id_a[4:] if id_a.startswith("kin_") and id_a[4:].isdigit() else "")
            or ""
        ).strip()
        kid_b = str(
            b.get("kinorium_id")
            or (b.get("kinorium") or {}).get("kinorium_id")
            or (id_b[4:] if id_b.startswith("kin_") and id_b[4:].isdigit() else "")
            or ""
        ).strip()
        if kid_a and kid_b:
            return kid_a == kid_b
        rid_a = str(
            a.get("rezka_id")
            or (id_a[6:] if id_a.startswith("rezka_") and id_a[6:].isdigit() else "")
            or ""
        ).strip()
        rid_b = str(
            b.get("rezka_id")
            or (id_b[6:] if id_b.startswith("rezka_") and id_b[6:].isdigit() else "")
            or ""
        ).strip()
        if rid_a and rid_b:
            return rid_a == rid_b
        yr_a = cls._safe_int(a.get("year"))
        yr_b = cls._safe_int(b.get("year"))
        if yr_a and yr_b and abs(yr_a - yr_b) > 1:
            return False
        aliases_a = cls._extract_item_aliases(a)
        aliases_b = cls._extract_item_aliases(b)
        lat_a = {x for x in aliases_a if x and not re.search(r"[а-яё]", x)}
        lat_b = {x for x in aliases_b if x and not re.search(r"[а-яё]", x)}
        if lat_a and lat_b and not (lat_a & lat_b):
            return False
        return bool(aliases_a and aliases_b and (aliases_a & aliases_b))

    def _merge_two_search_items(
        self,
        base: Dict[str, Any],
        inc: Dict[str, Any],
        q_tokens: List[str],
    ) -> Dict[str, Any]:
        merged = dict(base)

        def _id_rank(val: str) -> int:
            if not val:
                return 0
            if val.startswith("tt"):
                return 4
            if val.startswith("kin_"):
                return 3
            if not val.startswith("rezka_"):
                return 2
            return 1

        if _id_rank(str(inc.get("id") or "")) > _id_rank(str(merged.get("id") or "")):
            merged["id"] = inc["id"]

        yr_m = self._safe_int(merged.get("year"))
        yr_i = self._safe_int(inc.get("year"))
        same_type = (
            not merged.get("media_type")
            or not inc.get("media_type")
            or merged.get("media_type") == inc.get("media_type")
        )
        year_compat = not (yr_m and yr_i and abs(yr_m - yr_i) > 2)
        if same_type and year_compat:
            for key in ("rezka_id", "rezka_url", "kinorium_id", "imdb_id"):
                if not merged.get(key) and inc.get(key):
                    merged[key] = inc[key]

        def _title_score(t: str) -> float:
            s = (t or "").strip()
            if not s:
                return -1.0
            sc = 0.0
            if re.search(r"[А-Яа-яЁё]", s):
                sc += 10.0
            if "/" not in s:
                sc += 3.0
            t_words = set(_norm_title(s).split())
            for qt in q_tokens:
                if any(w == qt or (len(qt) >= 3 and w.startswith(qt)) for w in t_words):
                    sc += 5.0
            return sc

        if _title_score(str(inc.get("title") or "")) > _title_score(str(merged.get("title") or "")):
            merged["title"] = inc["title"]

        def _orig_score(orig: str, ru_t: str) -> int:
            o = (orig or "").strip()
            if not o:
                return 0
            sc = 1
            if _norm_title(o) != _norm_title(ru_t):
                sc += 2
            if re.search(r"[A-Za-z]", o):
                sc += 4
            return sc

        cur_ru = str(merged.get("title") or "")
        if _orig_score(str(inc.get("orig_title") or ""), cur_ru) > _orig_score(
            str(merged.get("orig_title") or ""), cur_ru
        ):
            merged["orig_title"] = inc["orig_title"]

        if inc.get("title_pl") and (
            not merged.get("title_pl") or merged.get("title_pl") == merged.get("title")
        ):
            merged["title_pl"] = inc["title_pl"]

        if self._poster_quality_score(str(inc.get("poster") or ""), False) > self._poster_quality_score(
            str(merged.get("poster") or ""), False
        ):
            merged["poster"] = inc["poster"]

        if self._poster_quality_score(str(inc.get("backdrop") or ""), True) > self._poster_quality_score(
            str(merged.get("backdrop") or ""), True
        ):
            merged["backdrop"] = inc["backdrop"]

        if inc.get("poster_en") and not merged.get("poster_en"):
            merged["poster_en"] = inc["poster_en"]
        if inc.get("backdrop_en") and not merged.get("backdrop_en"):
            merged["backdrop_en"] = inc["backdrop_en"]

        combined_genres: List[str] = []
        for g in list(merged.get("genres") or []) + list(inc.get("genres") or []):
            gs = self._canonical_genre(str(g or ""))
            gl = gs.lower()
            if not gs or gl in ("фильм", "сериал") or gl in self.COUNTRY_STOPWORDS:
                continue
            if not any(existing.lower() == gl for existing in combined_genres):
                combined_genres.append(gs)
        if combined_genres:
            merged["genres"] = combined_genres[:4]

        def _desc_score(d: str) -> int:
            ds = (d or "").strip()
            if not ds:
                return 0
            if re.match(r"^[^()]{1,70}\s*\([^()]{1,90}\)$", ds):
                return 1
            return min(500, len(ds))

        if _desc_score(str(inc.get("description") or "")) > _desc_score(str(merged.get("description") or "")):
            merged["description"] = inc["description"]
        if _desc_score(str(inc.get("description_en") or "")) > _desc_score(str(merged.get("description_en") or "")):
            merged["description_en"] = inc["description_en"]

        base_is_rezka_placeholder = str(base.get("id") or "").startswith("rezka_")
        inc_is_rezka_placeholder = str(inc.get("id") or "").startswith("rezka_")
        if base_is_rezka_placeholder and not inc_is_rezka_placeholder and inc.get("ratings"):
            merged["ratings"] = dict(inc["ratings"])

        prov_by_id: Dict[str, Dict[str, Any]] = {}
        for p in list(merged.get("providers") or []) + list(inc.get("providers") or []):
            pid = str(p.get("id") or "")
            if not pid:
                continue
            if pid not in prov_by_id or (p.get("url") and not prov_by_id[pid].get("url")):
                prov_by_id[pid] = dict(p)
        if prov_by_id:
            merged["providers"] = list(prov_by_id.values())

        raw_aliases = list(merged.get("_aliases") or []) + [
            merged.get("title", ""),
            merged.get("orig_title", ""),
            merged.get("title_pl", ""),
            inc.get("title", ""),
            inc.get("orig_title", ""),
            inc.get("title_pl", ""),
        ] + list(inc.get("_aliases") or [])
        merged["_aliases"] = list(dict.fromkeys([str(a).strip() for a in raw_aliases if str(a or "").strip()]))
        merged["_from_hdrezka"] = bool(merged.get("_from_hdrezka") or inc.get("_from_hdrezka"))
        merged["_from_person_match"] = bool(merged.get("_from_person_match") or inc.get("_from_person_match"))
        return self.enrich_item(merged)

    @staticmethod
    def _strip_internal_search_keys(item: Dict[str, Any]) -> Dict[str, Any]:
        cleaned = {k: v for k, v in item.items() if not k.startswith("_")}
        ks = cleaned.get("kinorium")
        if isinstance(ks, dict) and ks.get("kinorium_rating"):
            rats = dict(cleaned.get("ratings") or {})
            rats["kinorium"] = ks["kinorium_rating"]
            cleaned["ratings"] = rats
        return cleaned

    BROAD_GENRES_LOW_WEIGHT = {"драма", "комедия", "мелодрама"}

    def resolve_similar_for_title(
        self,
        item_id: str = "",
        kinorium_id: str = "",
        title: str = "",
        orig_title: str = "",
        year: int = 0,
        media_type: str = "",
        directors: Optional[List[str]] = None,
        actors: Optional[List[str]] = None,
        genres: Optional[List[str]] = None,
        preloaded_raw: Optional[List[Dict[str, Any]]] = None,
        allow_network: bool = True,
        lang: str = "ru",
        limit: int = 12,
    ) -> Dict[str, Any]:
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        kin_enabled = self.is_service_enabled("kinorium")

        if kin_enabled:
            kin_sim = self.kinorium.get_similar_catalog_items(
                kid=kinorium_id,
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                year=year if year > 0 else None,
                media_type=media_type,
                allow_network=allow_network,
                limit=limit,
                preloaded_raw=preloaded_raw,
            )
            if kin_sim:
                self._enrich_from_curated(kin_sim)
                enriched = [self.enrich_item(it) for it in kin_sim]
                filtered = self._filter_items_list(enriched, allow_empty_providers=True)
                target_aliases = self._extract_item_aliases(
                    {"title": title, "orig_title": orig_title, "id": item_id, "kinorium_id": kinorium_id}
                )
                deduped: List[Dict[str, Any]] = []
                for cand in filtered:
                    if str(cand.get("id") or "") == str(item_id or ""):
                        continue
                    if kinorium_id and str(cand.get("kinorium_id") or "") == str(kinorium_id):
                        continue
                    if target_aliases and (self._extract_item_aliases(cand) & target_aliases):
                        continue
                    deduped.append(self._strip_internal_search_keys(cand))
                if deduped:
                    if ui_lang == "en":
                        cyr_items = [
                            x
                            for x in deduped
                            if not x.get("orig_title") or has_cyrillic(str(x.get("orig_title") or ""))
                        ]
                        if cyr_items:
                            self._prewarm_en_metadata_for_items(cyr_items[:4], max_items=4)
                    return {"items": deduped[:limit], "source": "kinorium"}

        # Multi-signal fallback when Kinorium is disabled or has no #similar-slider for this title
        seed_item: Dict[str, Any] = {
            "id": item_id,
            "kinorium_id": kinorium_id,
            "title": title,
            "orig_title": orig_title,
            "year": year or "",
            "media_type": media_type or "movie",
            "genres": list(genres or []),
            "directors": list(directors or []),
            "actors": list(actors or []),
        }
        c_seed = self._match_curated_catalog_entry(seed_item)
        if c_seed:
            if not seed_item["genres"]:
                seed_item["genres"] = list(c_seed.get("genres") or [])
            if not seed_item["directors"] and c_seed.get("directors"):
                seed_item["directors"] = list(c_seed.get("directors") or [])
            if not seed_item["actors"] and c_seed.get("actors"):
                seed_item["actors"] = list(c_seed.get("actors") or [])

        sim_pool = self._filter_items_list([self.enrich_item(it) for it in self.CURATED_CATALOG])
        premieres_all = self._get_online_premieres()
        fb_items = self._build_search_similar_items(
            matched=[seed_item],
            extra_candidates=[],
            sim_pool=sim_pool,
            premieres_all=premieres_all,
            provider_filter="all",
            media_type_filter="all",
            kin_enabled=kin_enabled,
            limit=limit,
            use_kinorium_live=False,
        )
        sliced_fb = fb_items[:limit]
        self._register_catalog_items(sliced_fb)
        return {"items": sliced_fb, "source": "curated"}

    def _build_search_similar_items(
        self,
        matched: List[Dict[str, Any]],
        extra_candidates: List[Dict[str, Any]],
        sim_pool: List[Dict[str, Any]],
        premieres_all: List[Dict[str, Any]],
        provider_filter: str = "all",
        media_type_filter: str = "all",
        kin_enabled: bool = True,
        limit: int = 18,
        use_kinorium_live: bool = True,
    ) -> List[Dict[str, Any]]:
        if not matched:
            return []

        excluded_ids: Set[str] = set()
        excluded_aliases: Set[str] = set()
        for m_it in matched:
            if m_it.get("id"):
                excluded_ids.add(str(m_it["id"]))
            if m_it.get("kinorium_id"):
                excluded_ids.add(f"kin_{m_it['kinorium_id']}")
            excluded_aliases.update(self._extract_item_aliases(m_it))

        seen_sim_ids: Set[str] = set()
        seen_sim_aliases: Set[str] = set()
        final_out: List[Dict[str, Any]] = []

        # 1. Prefer real Kinorium #similar-slider recommendations for the top matched work
        top_hit = matched[0]
        top_kid = str(top_hit.get("kinorium_id") or (top_hit.get("kinorium") or {}).get("kinorium_id") or "")
        if kin_enabled and use_kinorium_live and len(matched) <= 8:
            kin_sim_items = self.kinorium.get_similar_catalog_items(
                kid=top_kid,
                item_id=str(top_hit.get("id") or ""),
                title=str(top_hit.get("title") or ""),
                orig_title=str(top_hit.get("orig_title") or ""),
                year=self._safe_int(top_hit.get("year")) or None,
                media_type=str(top_hit.get("media_type") or ""),
                allow_network=bool(len(matched) <= 4),
                limit=limit,
            )
            if kin_sim_items:
                self._enrich_from_curated(kin_sim_items)
                for ks_raw in kin_sim_items:
                    enr = self._filter_item_by_enabled_services(
                        self.enrich_item(ks_raw),
                        allow_empty_providers=(provider_filter in ("", "all")),
                    )
                    if enr is None:
                        continue
                    if provider_filter and provider_filter != "all":
                        if not any(
                            isinstance(p, dict) and p.get("id") == provider_filter and p.get("available")
                            for p in (enr.get("providers") or [])
                        ):
                            continue
                    if media_type_filter in ("movie", "series") and enr.get("media_type") != media_type_filter:
                        continue
                    cid = str(enr.get("id") or "")
                    ckid = str(enr.get("kinorium_id") or "")
                    if cid in excluded_ids or (ckid and f"kin_{ckid}" in excluded_ids):
                        continue
                    cand_aliases = self._extract_item_aliases(enr)
                    if (cand_aliases & excluded_aliases) or cid in seen_sim_ids or (cand_aliases & seen_sim_aliases):
                        continue
                    seen_sim_ids.add(cid)
                    seen_sim_aliases.update(cand_aliases)
                    final_out.append(self._strip_internal_search_keys(enr))
                    if len(final_out) >= limit:
                        return final_out

        # 2. Multi-signal fallback / supplement (directors, actors, franchise, specific genre intersections)
        target_genres: Dict[str, float] = {}
        target_genre_labels: Dict[str, str] = {}
        for idx, m_it in enumerate(matched[:3]):
            weight = 1.0 if idx == 0 else 0.55
            for g in m_it.get("genres") or []:
                g_disp = self._canonical_genre(str(g or ""))
                gl = g_disp.strip().lower()
                if gl and gl not in ("фильм", "сериал") and gl not in self.COUNTRY_STOPWORDS:
                    target_genres[gl] = target_genres.get(gl, 0.0) + weight
                    target_genre_labels.setdefault(gl, g_disp)

        seed_directors = {
            str(d).strip().lower(): str(d).strip()
            for d in (top_hit.get("directors") or [])
            if str(d or "").strip()
        }
        seed_actors = {
            str(a).strip().lower(): str(a).strip()
            for a in (top_hit.get("actors") or [])[:6]
            if str(a or "").strip()
        }

        primary_mtype = top_hit.get("media_type")
        franchise_tokens: Set[str] = set()
        for alias in self._extract_item_aliases(top_hit):
            for w in alias.split():
                if len(w) >= 5 and w not in self.GENERIC_SIMILAR_WORDS:
                    franchise_tokens.add(w)

        raw_pool: List[Dict[str, Any]] = []
        raw_pool.extend(sim_pool or [])
        raw_pool.extend(premieres_all or [])
        if kin_enabled:
            wl_items = self.kinorium.get_section_catalog_items("watchlist", media_type_filter="all", query="")
            wt_items = self.kinorium.get_section_catalog_items("watching", media_type_filter="all", query="")
            raw_pool.extend(wl_items[:90])
            raw_pool.extend(wt_items[:45])
        raw_pool.extend(extra_candidates or [])

        scored_out: List[tuple] = []

        for cand in raw_pool:
            if not cand or not cand.get("title"):
                continue
            cid = str(cand.get("id") or "")
            ckid = str(cand.get("kinorium_id") or (cand.get("kinorium") or {}).get("kinorium_id") or "")
            if cid in excluded_ids or (ckid and f"kin_{ckid}" in excluded_ids):
                continue
            cand_aliases = self._extract_item_aliases(cand)
            if cand_aliases & excluded_aliases:
                continue
            if cid in seen_sim_ids or (cand_aliases & seen_sim_aliases):
                continue

            poster_u = str(cand.get("poster") or "")
            if not poster_u or "hdrezka" in poster_u.lower():
                continue

            filtered_cand = self._filter_item_by_enabled_services(cand, allow_empty_providers=False)
            if filtered_cand is None:
                continue
            if provider_filter and provider_filter != "all":
                if not any(
                    isinstance(p, dict) and p.get("id") == provider_filter and p.get("available")
                    for p in (filtered_cand.get("providers") or [])
                ):
                    continue
            if media_type_filter in ("movie", "series") and filtered_cand.get("media_type") != media_type_filter:
                continue

            ks = filtered_cand.get("kinorium") or {}
            if kin_enabled and ks.get("not_watching"):
                continue

            cand_words = {w for a in cand_aliases for w in a.split()}
            has_franchise = bool(franchise_tokens and (franchise_tokens & cand_words))

            cand_dirs = [str(d).strip() for d in (filtered_cand.get("directors") or []) if str(d or "").strip()]
            shared_dir = next((seed_directors[d.lower()] for d in cand_dirs if d.lower() in seed_directors), "")
            cand_acts = [str(a).strip() for a in (filtered_cand.get("actors") or []) if str(a or "").strip()]
            shared_act = next((seed_actors[a.lower()] for a in cand_acts if a.lower() in seed_actors), "")

            cand_genres = [
                self._canonical_genre(str(g or "")).strip().lower()
                for g in (filtered_cand.get("genres") or [])
                if str(g or "").strip().lower() not in ("фильм", "сериал", "")
                and str(g or "").strip().lower() not in self.COUNTRY_STOPWORDS
            ]
            matched_genres: List[str] = []
            specific_matched_count = 0
            genre_score = 0.0
            for cg in cand_genres:
                if cg in target_genres:
                    matched_genres.append(cg)
                    if cg in self.BROAD_GENRES_LOW_WEIGHT:
                        genre_score += 1.4 * min(1.5, target_genres[cg])
                    else:
                        specific_matched_count += 1
                        genre_score += 5.2 * min(1.5, target_genres[cg])

            matched_genre_count = len(matched_genres)
            has_strong_signal = bool(
                shared_dir
                or shared_act
                or has_franchise
                or matched_genre_count >= 2
                or (specific_matched_count >= 1 and (not primary_mtype or filtered_cand.get("media_type") == primary_mtype))
            )
            if not has_strong_signal:
                continue
            if cand in (extra_candidates or []) and not (has_franchise or shared_dir) and matched_genre_count < 2:
                continue

            score = genre_score
            if shared_dir:
                score += 18.0
            if shared_act:
                score += 10.0
            if matched_genre_count >= 2:
                score += 4.0
            if has_franchise:
                score += 13.0
            if primary_mtype and filtered_cand.get("media_type") == primary_mtype:
                score += 3.5
            if not ks.get("watched"):
                score += 2.0
            if ks.get("in_watchlist") or ks.get("watching"):
                score += 1.2
            try:
                kr = float(ks.get("kinorium_rating") or (filtered_cand.get("ratings") or {}).get("kinorium") or 7.5)
            except (TypeError, ValueError):
                kr = 7.5
            score += min(9.5, kr) * 0.45

            out_cand = self._strip_internal_search_keys(filtered_cand)
            if shared_dir:
                out_cand["similar_reason"] = f"Режиссёр: {shared_dir}"
                out_cand["similar_reason_en"] = f"Director: {shared_dir}"
            elif shared_act:
                out_cand["similar_reason"] = f"В ролях: {shared_act}"
                out_cand["similar_reason_en"] = f"Cast: {shared_act}"
            elif has_franchise:
                out_cand["similar_reason"] = "Одна франшиза"
                out_cand["similar_reason_en"] = "Same franchise"
            elif matched_genres:
                g_ru = ", ".join(target_genre_labels.get(g, g.capitalize()) for g in matched_genres[:2])
                out_cand["similar_reason"] = f"Жанры: {g_ru}"
                out_cand["similar_reason_en"] = "Shared genres"
            out_cand.setdefault("similar_source", "curated")

            seen_sim_ids.add(cid)
            seen_sim_aliases.update(cand_aliases)
            scored_out.append((score, out_cand))

        scored_out.sort(key=lambda pair: pair[0], reverse=True)
        needed = max(0, limit - len(final_out))
        final_out.extend(it for _, it in scored_out[:needed])
        return final_out

    def _fetch_justwatch_by_provider(self, provider_id: str) -> List[Dict[str, Any]]:
        return self.justwatch.fetch_by_provider(provider_id)

    def resolve_provider_offers_for_title(
        self,
        title: str = "",
        orig_title: str = "",
        year: int = 0,
        media_type: str = "",
    ) -> List[Dict[str, Any]]:
        return self.justwatch.resolve_provider_offers_for_title(
            title=title, orig_title=orig_title, year=year, media_type=media_type
        )

    def _search_hdrezka_live(self, query: str) -> List[Dict[str, Any]]:
        import re as _re

        out: List[Dict[str, Any]] = []
        try:
            raw_list = self.rezka.search_live(query)
        except Exception:
            raw_list = []
        for r in raw_list[:18]:
            rid = str(r.get("rezka_id") or "")
            rurl = str(r.get("url") or "")
            raw_title = str(r.get("title") or "").strip()
            info = str(r.get("info") or "").strip()
            poster = str(r.get("poster") or "")
            if not rid or not raw_title:
                continue
            slash_parts = [p.strip() for p in raw_title.split("/") if p.strip()]
            display_title = slash_parts[0] if slash_parts else raw_title
            latin_part = next((p for p in slash_parts[1:] if _re.search(r"[A-Za-z]", p)), "")
            orig_t = latin_part or (slash_parts[-1] if len(slash_parts) > 1 else display_title)

            ym = _re.search(r"\b(19\d\d|20\d\d)\b", info)
            year: Any = int(ym.group(1)) if ym else ""
            mtype = (
                "series"
                if ("/series/" in rurl or "/animation/" in rurl or "сериал" in info.lower())
                else "movie"
            )
            info_parts = [p.strip() for p in info.split(",") if p.strip() and not p.strip().isdigit()]
            genres: List[str] = []
            for p in info_parts:
                if _re.search(r"\b(19\d\d|20\d\d)\b", p) or p.lower() in self.COUNTRY_STOPWORDS or "..." in p:
                    continue
                cg = self._canonical_genre(p)
                if cg and not any(x.lower() == cg.lower() for x in genres):
                    genres.append(cg)
            genres = genres[:3]
            if not genres:
                genres = ["Сериал"] if mtype == "series" else ["Фильм"]
            out.append(
                {
                    "id": f"rezka_{rid}",
                    "rezka_id": rid,
                    "rezka_url": rurl,
                    "title": display_title,
                    "orig_title": orig_t,
                    "title_pl": orig_t,
                    "_aliases": slash_parts if len(slash_parts) > 1 else [display_title],
                    "year": year,
                    "media_type": mtype,
                    "seasons_count": 1,
                    "episodes_per_season": 0 if mtype == "series" else 1,
                    "genres": genres,
                    "description": f"{display_title} ({info})" if info else display_title,
                    "poster": poster,
                    "backdrop": poster,
                    "ambient_color": "#1e293b",
                    "ratings": {"kinorium": 7.8, "imdb": 7.8},
                    "providers": [
                        {"id": "hdrezka", "available": True, "quality": "1080p", "audio": "RU/EN"},
                        {"id": "backup4k", "available": True, "quality": "4K Remux", "audio": "RU/EN"},
                    ],
                }
            )
        return out

    def _search_justwatch_poland(self, query: str) -> List[Dict[str, Any]]:
        return self.justwatch.search_poland(query)

    def _query_justwatch_graphql(self, title_filter: Dict[str, Any], first: int = 10) -> List[Dict[str, Any]]:
        return self.justwatch.query_graphql(title_filter, first=first)

    def get_person_profile(
        self,
        name: str,
        person_url: str = "",
        hint_title: str = "",
        hint_orig: str = "",
        lang: str = "ru",
    ) -> Dict[str, Any]:
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        clean_low = (name or "").strip().lower()
        cache_key = (person_url or clean_low).strip().lower()
        now_ts = time.time()
        with self._catalog_lock:
            cached_raw_entry = self._person_raw_cache.get(cache_key) if cache_key else None
            raw = copy.deepcopy(cached_raw_entry[1]) if (cached_raw_entry and (now_ts - cached_raw_entry[0]) < 1800) else None
        if raw is None:
            if not person_url and clean_low:
                person_url = self.rezka.find_cached_person_url(name)

            if not person_url and clean_low and (hint_title or hint_orig):
                try:
                    self.rezka._resolve_page_metadata("", hint_title, hint_orig, None)
                except Exception:
                    pass
                person_url = self.rezka.find_cached_person_url(name)

            if not person_url and clean_low:
                for c_it in self.CURATED_CATALOG:
                    cand_names = [
                        str(x).strip()
                        for x in (
                            list(c_it.get("directors") or [])
                            + list(c_it.get("actors") or [])
                            + list(c_it.get("directors_en") or [])
                            + list(c_it.get("actors_en") or [])
                        )
                        if str(x).strip()
                    ]
                    if any(
                        cn.lower() == clean_low or _names_match_ru_en(cn, name) >= 0.76
                        for cn in cand_names
                    ):
                        try:
                            self.rezka._resolve_page_metadata(
                                "",
                                str(c_it.get("title") or ""),
                                str(c_it.get("orig_title") or ""),
                                None,
                                year=self._safe_int(c_it.get("year")),
                                media_type=str(c_it.get("media_type") or "movie"),
                            )
                        except Exception:
                            pass
                        person_url = self.rezka.find_cached_person_url(name)
                        if person_url:
                            break

            kin_prof: Dict[str, Any] = {}
            if not person_url and clean_low and hasattr(self.kinorium, "fetch_person_filmography"):
                try:
                    kin_prof = self.kinorium.fetch_person_filmography(name=name) or {}
                except Exception:
                    kin_prof = {}
                if kin_prof and kin_prof.get("sections") and self.is_service_enabled("hdrezka"):
                    top_sec_items = (kin_prof["sections"][0].get("items") or []) if kin_prof["sections"] else []
                    for kw in top_sec_items[:2]:
                        try:
                            self.rezka._resolve_page_metadata(
                                "",
                                str(kw.get("title") or ""),
                                str(kw.get("orig_title") or ""),
                                None,
                                year=self._safe_int(kw.get("year")),
                                media_type=str(kw.get("media_type") or "movie"),
                            )
                        except Exception:
                            pass
                        person_url = (
                            self.rezka.find_cached_person_url(name)
                            or self.rezka.find_cached_person_url(str(kin_prof.get("name") or ""))
                            or self.rezka.find_cached_person_url(str(kin_prof.get("orig_name") or ""))
                        )
                        if person_url:
                            break

            raw = self.rezka.get_person_details(name=name, hint_url=person_url)
            if not (raw or {}).get("sections") and not kin_prof and clean_low and hasattr(self.kinorium, "fetch_person_filmography"):
                try:
                    kin_prof = self.kinorium.fetch_person_filmography(name=name) or {}
                except Exception:
                    kin_prof = {}

            if kin_prof:
                raw = dict(raw or {})
                if not raw.get("sections") and kin_prof.get("sections"):
                    raw["sections"] = kin_prof["sections"]
                for fld in ("name", "orig_name", "person_url", "photo", "career_roles", "birth_date", "birth_place", "bio"):
                    if not raw.get(fld) and kin_prof.get(fld):
                        raw[fld] = kin_prof[fld]

            if cache_key and raw and raw.get("sections"):
                raw_snap = copy.deepcopy(raw)
                with self._catalog_lock:
                    if len(self._person_raw_cache) > 120:
                        for k_ev in list(self._person_raw_cache.keys())[:30]:
                            self._person_raw_cache.pop(k_ev, None)
                    self._person_raw_cache[cache_key] = (now_ts, raw_snap)
                    if raw.get("person_url"):
                        self._person_raw_cache[str(raw["person_url"]).strip().lower()] = (now_ts, raw_snap)
                    if raw.get("name"):
                        self._person_raw_cache[str(raw["name"]).strip().lower()] = (now_ts, raw_snap)
                    if raw.get("orig_name"):
                        self._person_raw_cache[str(raw["orig_name"]).strip().lower()] = (now_ts, raw_snap)
        kin_enabled = self.is_service_enabled("kinorium")

        curated_by_norm: Dict[str, Dict[str, Any]] = {}
        for c_it in self.CURATED_CATALOG:
            for v in _title_variants(str(c_it.get("title") or "")) + _title_variants(
                str(c_it.get("orig_title") or "")
            ):
                if v:
                    curated_by_norm[v] = c_it

        def _convert_raw_work(r: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            rid = str(r.get("rezka_id") or "")
            kid = str(r.get("kinorium_id") or "")
            rurl = str(r.get("url") or "")
            raw_title = str(r.get("title") or "").strip()
            info = str(r.get("info") or "").strip()
            poster = str(r.get("poster") or "")
            if (not rid and not kid) or not raw_title:
                return None

            if kid and not rid:
                mtype = str(r.get("media_type") or "movie")
                orig_t = str(r.get("orig_title") or raw_title).strip()
                item_dict = {
                    "id": str(r.get("id") or f"kin_{kid}"),
                    "imdb_id": str(r.get("imdb_id") or ""),
                    "kinorium_id": kid,
                    "title": raw_title,
                    "orig_title": orig_t,
                    "title_pl": orig_t,
                    "_aliases": list(dict.fromkeys([raw_title, orig_t])),
                    "year": self._safe_int(r.get("year")),
                    "media_type": mtype,
                    "seasons_count": self._safe_int(r.get("seasons_count"), 1),
                    "episodes_per_season": self._safe_int(r.get("episodes_per_season"), 0 if mtype == "series" else 1),
                    "genres": list(r.get("genres") or (["Сериал"] if mtype == "series" else ["Фильм"]))[:3],
                    "description": str(r.get("description") or raw_title),
                    "description_en": str(r.get("description_en") or ""),
                    "poster": poster or f"https://ru-images.kinorium.com/movie/600/{kid}.jpg",
                    "poster_en": str(r.get("poster_en") or f"https://en-images.kinorium.com/movie/600/{kid}.jpg"),
                    "backdrop": str(r.get("backdrop") or f"https://ru-images.kinorium.com/movie/1080/{kid}.jpg"),
                    "backdrop_en": str(r.get("backdrop_en") or ""),
                    "ambient_color": "#1e293b",
                    "ratings": dict(r.get("ratings") or {}),
                    "providers": [
                        dict(p)
                        for p in (
                            r.get("providers")
                            or [
                                {"id": "hdrezka", "available": True, "quality": "1080p", "audio": "RU/EN"},
                                {"id": "backup4k", "available": True, "quality": "4K Remux", "audio": "RU/EN"},
                            ]
                        )
                        if isinstance(p, dict)
                    ],
                }
            else:
                slash_parts = [p.strip() for p in raw_title.split("/") if p.strip()]
                display_title = slash_parts[0] if slash_parts else raw_title
                latin_part = next((p for p in slash_parts[1:] if re.search(r"[A-Za-z]", p)), "")
                orig_t = latin_part or (slash_parts[-1] if len(slash_parts) > 1 else display_title)

                ym = re.search(r"\b(19\d\d|20\d\d)\b", info)
                year = int(ym.group(1)) if ym else 0
                mtype = (
                    "series"
                    if ("/series/" in rurl or "/animation/" in rurl or "сериал" in info.lower())
                    else "movie"
                )
                info_parts = [p.strip() for p in info.split(",") if p.strip() and not p.strip().isdigit()]
                genres: List[str] = []
                for p in info_parts:
                    if re.search(r"\b(19\d\d|20\d\d)\b", p) or p.lower() in self.COUNTRY_STOPWORDS or "..." in p:
                        continue
                    cg = self._canonical_genre(p)
                    if cg and not any(x.lower() == cg.lower() for x in genres):
                        genres.append(cg)
                if not genres:
                    genres = ["Сериал"] if mtype == "series" else ["Фильм"]

                item_dict = {
                    "id": f"rezka_{rid}",
                    "rezka_id": rid,
                    "rezka_url": rurl,
                    "title": display_title,
                    "orig_title": orig_t,
                    "title_pl": orig_t,
                    "_aliases": slash_parts if len(slash_parts) > 1 else [display_title],
                    "year": year,
                    "media_type": mtype,
                    "seasons_count": 1,
                    "episodes_per_season": 0 if mtype == "series" else 1,
                    "genres": genres[:3],
                    "description": f"{display_title} ({info})" if info else display_title,
                    "poster": poster,
                    "backdrop": poster,
                    "ambient_color": "#1e293b",
                    "ratings": {},
                    "providers": [
                        {"id": "hdrezka", "available": True, "quality": "1080p", "audio": "RU/EN"},
                        {"id": "backup4k", "available": True, "quality": "4K Remux", "audio": "RU/EN"},
                    ],
                }

            for v in _title_variants(raw_title):
                c_match = curated_by_norm.get(v)
                if c_match and c_match.get("media_type") == mtype:
                    c_yr = self._safe_int(c_match.get("year"))
                    it_yr = self._safe_int(item_dict.get("year"))
                    if c_yr and it_yr and abs(c_yr - it_yr) > 2:
                        continue
                    item_dict["poster"] = c_match.get("poster") or item_dict["poster"]
                    item_dict["poster_en"] = c_match.get("poster_en") or item_dict.get("poster_en") or ""
                    item_dict["backdrop"] = c_match.get("backdrop") or item_dict["backdrop"]
                    item_dict["backdrop_en"] = c_match.get("backdrop_en") or item_dict.get("backdrop_en") or ""
                    item_dict["orig_title"] = c_match.get("orig_title") or item_dict["orig_title"]
                    item_dict["genres"] = list(c_match.get("genres") or item_dict["genres"])
                    item_dict["description"] = c_match.get("description") or item_dict["description"]
                    item_dict["description_en"] = c_match.get("description_en") or item_dict.get("description_en") or ""
                    item_dict["ratings"] = dict(c_match.get("ratings") or item_dict["ratings"])
                    item_dict["providers"] = [dict(p) for p in (c_match.get("providers") or item_dict["providers"]) if isinstance(p, dict)]
                    break

            enriched = self.enrich_item(item_dict)
            filtered = self._filter_item_by_enabled_services(enriched, allow_empty_providers=True)
            if filtered is None:
                return None
            return self._strip_internal_search_keys(filtered)

        enriched_sections: List[Dict[str, Any]] = []
        unique_works_by_key: Dict[str, Dict[str, Any]] = {}

        for sec in raw.get("sections") or []:
            conv_items: List[Dict[str, Any]] = []
            for r_it in sec.get("items") or []:
                pre_ukey = str(
                    r_it.get("rezka_id") or r_it.get("kinorium_id") or r_it.get("id") or r_it.get("title") or ""
                )
                if pre_ukey and pre_ukey in unique_works_by_key:
                    conv_items.append(unique_works_by_key[pre_ukey])
                    continue
                c_it = _convert_raw_work(r_it)
                if c_it:
                    ukey = pre_ukey or str(c_it.get("rezka_id") or c_it.get("id") or c_it.get("title"))
                    shared_work = unique_works_by_key.setdefault(ukey, c_it)
                    conv_items.append(shared_work)
            if conv_items:
                conv_items.sort(key=lambda x: self._safe_int(x.get("year")), reverse=True)
                s_key = sec.get("key", "works")
                s_lbl = sec.get("label", "Фильмография")
                if ui_lang == "en":
                    s_lbl = translate_career_role_en(s_lbl) or "Filmography"
                enriched_sections.append(
                    {
                        "key": s_key,
                        "role_key": s_key,
                        "label": s_lbl,
                        "role_label": s_lbl,
                        "count": len(conv_items),
                        "items": conv_items,
                    }
                )

        all_items = sorted(
            unique_works_by_key.values(),
            key=lambda x: self._safe_int(x.get("year")),
            reverse=True,
        )

        if ui_lang == "en" and all_items:
            self._prewarm_en_metadata_for_items(all_items[:16], max_items=16)
            if len(all_items) > 16 and self.en_meta is not None:
                tail_items = [dict(x) for x in all_items[16:44]]
                threading.Thread(
                    target=self._prewarm_en_metadata_for_items,
                    args=(tail_items, 28),
                    daemon=True,
                ).start()

            def _apply_en_work_fields(work: Dict[str, Any]) -> None:
                orig_t = str(work.get("orig_title") or "").strip()
                if orig_t and not has_cyrillic(orig_t):
                    work["title"] = orig_t
                elif has_cyrillic(str(work.get("title") or "")):
                    work["title"] = transliterate_cyrillic(str(work.get("title") or ""))
                best_en_poster = resolve_original_poster_url(work)
                if best_en_poster:
                    work["poster_en"] = best_en_poster
                    work["poster"] = best_en_poster
                en_genres: List[str] = []
                for g in work.get("genres") or []:
                    gl = str(g or "").strip().lower()
                    if gl == "сериал":
                        en_g = "Series"
                    elif gl == "фильм":
                        en_g = "Movie"
                    else:
                        en_g = RU_GENRES_TO_EN.get(gl, g if not has_cyrillic(str(g)) else transliterate_cyrillic(str(g)).title())
                    if en_g and en_g not in en_genres:
                        en_genres.append(en_g)
                if en_genres:
                    work["genres"] = en_genres
                if work.get("description_en"):
                    work["description"] = work["description_en"]

            seen_obj_ids = set()
            for w in all_items:
                seen_obj_ids.add(id(w))
                _apply_en_work_fields(w)
            for sec_obj in enriched_sections:
                for w in sec_obj.get("items") or []:
                    if id(w) not in seen_obj_ids:
                        seen_obj_ids.add(id(w))
                        _apply_en_work_fields(w)

        total_count = len(all_items)
        watched_count = 0
        watching_count = 0
        watchlist_count = 0
        user_scores: List[float] = []

        if kin_enabled:
            for w in all_items:
                ks = w.get("kinorium") or {}
                if ks.get("watched"):
                    watched_count += 1
                if ks.get("watching"):
                    watching_count += 1
                if ks.get("in_watchlist"):
                    watchlist_count += 1
                if ks.get("user_rating"):
                    try:
                        user_scores.append(float(ks["user_rating"]))
                    except Exception:
                        pass

        avg_user = round(sum(user_scores) / len(user_scores), 1) if user_scores else None
        watched_pct = round((watched_count / total_count) * 100) if total_count > 0 else 0

        ru_name = raw.get("name") or name
        orig_name_val = raw.get("orig_name") or (name if not has_cyrillic(name) else "")
        photo_hint = raw.get("photo") or ""
        photo_endpoint = f"/api/person-photo?name={urllib.parse.quote(ru_name)}" + (
            f"&url={urllib.parse.quote(photo_hint)}" if photo_hint else ""
        )
        career_str = str(raw.get("career_roles") or "")
        career_list = [c.strip() for c in career_str.split(",") if c.strip()]

        out_name = ru_name
        out_birth_date = str(raw.get("birth_date") or "")
        out_birth_place = str(raw.get("birth_place") or "")
        out_bio = str(raw.get("bio") or "")
        out_bio_en = str(raw.get("bio_en") or "")

        if ui_lang == "en":
            out_name = orig_name_val or (ru_name if not has_cyrillic(ru_name) else transliterate_cyrillic(ru_name))
            en_careers: List[str] = []
            for c in career_list:
                tc = translate_career_role_en(c)
                if tc and tc not in en_careers:
                    en_careers.append(tc)
            career_list = en_careers
            career_str = ", ".join(career_list)
            out_birth_date = translate_birth_date_en(out_birth_date)
            out_birth_place = translate_birth_place_en(out_birth_place)
            out_bio = out_bio_en or (out_bio if not has_cyrillic(out_bio) else "")

        self._register_catalog_items(all_items)
        return {
            "name": out_name,
            "ru_name": ru_name if has_cyrillic(ru_name) else "",
            "orig_name": orig_name_val,
            "person_url": raw.get("person_url") or person_url,
            "photo": photo_hint,
            "photo_endpoint": photo_endpoint,
            "career": career_list,
            "career_roles": career_str,
            "birth_date": out_birth_date,
            "birth_place": out_birth_place,
            "bio": out_bio,
            "bio_en": out_bio_en,
            "kinorium_enabled": kin_enabled,
            "stats": {
                "total_count": total_count,
                "watched_count": watched_count,
                "watching_count": watching_count,
                "watchlist_count": watchlist_count,
                "rated_count": len(user_scores),
                "avg_user_rating": avg_user,
                "watched_pct": watched_pct,
            },
            "roles": enriched_sections,
            "sections": enriched_sections,
            "all_items": all_items,
        }

    def get_release_calendar(
        self,
        days_past: int = 14,
        days_ahead: int = 45,
        lang: str = "ru",
        kids_mode: bool = False,
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        today_dt = datetime.date.today()
        today_iso = today_dt.isoformat()
        min_iso = (today_dt - datetime.timedelta(days=max(1, min(90, self._safe_int(days_past, 14) or 14)))).isoformat()
        max_iso = (today_dt + datetime.timedelta(days=max(1, min(120, self._safe_int(days_ahead, 45) or 45)))).isoformat()

        tracked_series: List[Dict[str, Any]] = []
        seen_keys: Set[str] = set()

        def _push_series(raw_it: Dict[str, Any], is_actively_watching: bool = False) -> None:
            if not isinstance(raw_it, dict):
                return
            if str(raw_it.get("media_type") or "") != "series":
                return
            it = self.enrich_item(raw_it)
            ks = it.get("kinorium") or {}
            if ks.get("not_watching"):
                return
            cand_keys: List[str] = []
            it_id = str(it.get("id") or "").strip()
            if it_id:
                cand_keys.append(f"id:{it_id}")
                if it_id.startswith("tt"):
                    cand_keys.append(f"imdb:{it_id}")
            imdb_v = str(it.get("imdb_id") or "").strip()
            if imdb_v.startswith("tt"):
                cand_keys.append(f"imdb:{imdb_v}")
            kid_v = str(it.get("kinorium_id") or ks.get("kinorium_id") or "").strip()
            if kid_v.isdigit():
                cand_keys.append(f"kin:{kid_v}")
            rz_v = str(it.get("rezka_id") or "").strip()
            if rz_v.isdigit():
                cand_keys.append(f"rz:{rz_v}")
            key_t = _norm_title(str(it.get("orig_title") or it.get("title") or ""))
            if key_t:
                cand_keys.append(f"t:{key_t}")
            if not cand_keys or any(ck in seen_keys for ck in cand_keys):
                return
            seen_keys.update(cand_keys)
            cp = dict(it)
            cp["_actively_watching"] = bool(is_actively_watching or ks.get("watching"))
            tracked_series.append(cp)

        for cw_it in self._build_continue_watching_list(ui_lang=ui_lang):
            _push_series(cw_it, is_actively_watching=True)

        if self.is_service_enabled("kinorium"):
            watching_items = self._enrich_from_curated(
                self.kinorium.get_section_catalog_items(
                    section="watching",
                    media_type_filter="series",
                    query="",
                )
            )
            for w_it in watching_items[:28]:
                _push_series(w_it, is_actively_watching=True)

            if len(tracked_series) < 18:
                wl_items = self._enrich_from_curated(
                    self.kinorium.get_section_catalog_items(
                        section="watchlist",
                        media_type_filter="series",
                        query="",
                    )
                )
                for wl_it in wl_items[:16]:
                    _push_series(wl_it, is_actively_watching=False)

        if len(tracked_series) < 8:
            for cur_it in self.CURATED_CATALOG:
                if cur_it.get("media_type") == "series":
                    _push_series(cur_it, is_actively_watching=False)
                if len(tracked_series) >= 14:
                    break

        if kids_mode:
            tracked_series = ProfileManager.filter_items_for_kids(tracked_series)

        tracked_series = tracked_series[:24]
        storage_db = None
        if getattr(self.kinorium, "storage_dir", None):
            try:
                storage_db = get_storage_db(self.kinorium.storage_dir)
            except Exception:
                storage_db = None

        def _fetch_series_schedule(ser: Dict[str, Any]) -> List[Dict[str, Any]]:
            try:
                if self.stremio is None:
                    return []
                raw_id = str(ser.get("imdb_id") or ser.get("id") or "")
                imdb_id = raw_id if raw_id.startswith("tt") else ""
                if not imdb_id and hasattr(self.stremio, "resolve_imdb_id"):
                    try:
                        imdb_id = str(
                            self.stremio.resolve_imdb_id(
                                item_id=str(ser.get("id") or ""),
                                title=str(ser.get("title") or ""),
                                orig_title=str(ser.get("orig_title") or ""),
                                year=self._safe_int(ser.get("year")),
                                media_type="series",
                            )
                            or ""
                        )
                    except Exception:
                        imdb_id = ""
                if not imdb_id.startswith("tt"):
                    return []

                c_meta = None
                if storage_db is not None and not force_refresh:
                    c_meta = storage_db.get_cache_entry("release_calendar", imdb_id, ttl_sec=3600.0)
                if not isinstance(c_meta, dict):
                    try:
                        c_meta = self.stremio.fetch_cinemeta_series_meta(imdb_id, force_refresh=force_refresh)
                    except TypeError:
                        c_meta = self.stremio.fetch_cinemeta_series_meta(imdb_id)
                    except Exception:
                        c_meta = {}
                    if isinstance(c_meta, dict) and c_meta.get("episodes_meta") and storage_db is not None:
                        try:
                            storage_db.set_cache_entry("release_calendar", imdb_id, c_meta)
                        except Exception:
                            pass

                ep_meta_map = (c_meta or {}).get("episodes_meta") or {}
                if not isinstance(ep_meta_map, dict) or not ep_meta_map:
                    return []

                ks = ser.get("kinorium") or {}
                we_map = ks.get("watched_episodes") if isinstance(ks.get("watched_episodes"), dict) else {}
                live_m = self.kinorium.get_series_live_meta(
                    item_id=str(ser.get("id") or ""),
                    title=str(ser.get("title") or ""),
                    orig_title=str(ser.get("orig_title") or ""),
                    kid=str(ser.get("kinorium_id") or ks.get("kinorium_id") or ""),
                    year=self._safe_int(ser.get("year")),
                    media_type="series",
                )
                lm_valid = bool(
                    isinstance(live_m, dict)
                    and not live_m.get("not_found")
                    and "/films/" not in str(live_m.get("rezka_url") or "").lower()
                )
                dub_seasons = (live_m or {}).get("seasons_map") if lm_valid else {}
                if not isinstance(dub_seasons, dict):
                    dub_seasons = {}

                if ui_lang == "en":
                    raw_orig = str(ser.get("orig_title") or "").strip()
                    cm_en_t = str((c_meta or {}).get("title_en") or (c_meta or {}).get("name") or "").strip()
                    if raw_orig and not has_cyrillic(raw_orig):
                        disp_title = raw_orig
                    elif cm_en_t and not has_cyrillic(cm_en_t):
                        disp_title = cm_en_t
                    else:
                        raw_t = str(ser.get("title") or raw_orig or "").strip()
                        disp_title = transliterate_cyrillic(raw_t) if has_cyrillic(raw_t) else raw_t
                    poster_url = str(
                        resolve_original_poster_url(ser) or ser.get("poster_en") or ser.get("poster") or ""
                    )
                else:
                    disp_title = str(ser.get("title") or ser.get("orig_title") or "")
                    poster_url = str(ser.get("poster") or "")

                out_rows: List[Dict[str, Any]] = []
                # Cinemeta episodes_meta is nested {season: {episode: info}}; legacy cache rows may be flat {"s1e3": info}
                flat_eps: List[Tuple[int, int, Dict[str, Any]]] = []
                for top_key, top_val in ep_meta_map.items():
                    if not isinstance(top_val, dict):
                        continue
                    m_flat = re.match(r"^s(\d+)e(\d+)$", str(top_key), re.I)
                    if m_flat:
                        flat_eps.append((int(m_flat.group(1)), int(m_flat.group(2)), top_val))
                        continue
                    if not str(top_key).isdigit():
                        continue
                    for e_key, e_info in top_val.items():
                        if isinstance(e_info, dict) and str(e_key).isdigit():
                            flat_eps.append((int(top_key), int(e_key), e_info))
                has_explicit_ep_history = any(bool(v) for v in we_map.values())
                known_seasons_cnt = max(1, self._safe_int(ser.get("seasons_count"), 1))
                for s_num, e_num, info in flat_eps:
                    air_date = str(info.get("air_date") or "")[:10]
                    if not re.match(r"^\d{4}-\d{2}-\d{2}$", air_date):
                        continue
                    if air_date < min_iso or air_date > max_iso:
                        continue
                    watched_eps_in_s = {
                        self._safe_int(x, -1) for x in (we_map.get(str(s_num)) or [])
                    }
                    is_watched = e_num in watched_eps_in_s or bool(
                        not has_explicit_ep_history
                        and air_date <= today_iso
                        and ks.get("watched")
                        and not ks.get("has_new_episode")
                        and s_num <= known_seasons_cnt
                    )
                    dub_eps_in_s = {
                        self._safe_int(x, -1) for x in (dub_seasons.get(str(s_num)) or [])
                    }
                    dub_ready = bool(e_num in dub_eps_in_s)
                    ep_title_val = str(info.get("title") or "")
                    if ui_lang == "en" and has_cyrillic(ep_title_val):
                        ep_title_val = ""
                    out_rows.append(
                        {
                            "id": str(ser.get("id") or imdb_id),
                            "imdb_id": imdb_id,
                            "kinorium_id": str(ser.get("kinorium_id") or ks.get("kinorium_id") or ""),
                            "rezka_id": str(ser.get("rezka_id") or ((live_m or {}).get("rezka_id") if lm_valid else "") or ""),
                            "rezka_url": str(ser.get("rezka_url") or ((live_m or {}).get("rezka_url") if lm_valid else "") or ""),
                            "title": disp_title,
                            "ru_title": str(ser.get("title") or disp_title),
                            "orig_title": str(ser.get("orig_title") or ""),
                            "year": ser.get("year") or "",
                            "media_type": "series",
                            "poster": poster_url,
                            "season": s_num,
                            "episode": e_num,
                            "episode_title": ep_title_val,
                            "air_date": air_date,
                            "is_today": air_date == today_iso,
                            "is_released": air_date <= today_iso,
                            "watched": bool(is_watched),
                            "dub_available": dub_ready,
                            "actively_watching": bool(ser.get("_actively_watching")),
                        }
                    )
                return out_rows
            except Exception:
                return []

        all_events: List[Dict[str, Any]] = []
        seen_ev_keys: Set[Tuple[str, int, int]] = set()
        if tracked_series and self.stremio is not None:
            max_w = min(6, max(1, len(tracked_series)))
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_w) as pool:
                for rows in pool.map(_fetch_series_schedule, tracked_series):
                    for ev in rows or []:
                        ev_key = (str(ev.get("imdb_id") or ev.get("id") or ""), int(ev.get("season") or 0), int(ev.get("episode") or 0))
                        if ev_key in seen_ev_keys:
                            continue
                        seen_ev_keys.add(ev_key)
                        all_events.append(ev)

        upcoming = [ev for ev in all_events if ev["air_date"] >= today_iso]
        recent = [ev for ev in all_events if ev["air_date"] < today_iso]

        upcoming.sort(key=lambda x: (x["air_date"], x["title"], x["season"], x["episode"]))
        recent.sort(key=lambda x: (x["air_date"], x["season"], x["episode"]), reverse=True)

        alerts: List[Dict[str, Any]] = []
        recent_cutoff = (today_dt - datetime.timedelta(days=7)).isoformat()
        for ev in all_events:
            if (
                ev.get("actively_watching")
                and ev.get("is_released")
                and not ev.get("watched")
                and ev["air_date"] >= recent_cutoff
            ):
                alerts.append(ev)
        alerts.sort(key=lambda x: (x["air_date"], x["season"], x["episode"]), reverse=True)

        return {
            "ok": True,
            "today": today_iso,
            "tracked_count": len(tracked_series),
            "upcoming": upcoming[:80],
            "recent": recent[:60],
            "alerts": alerts[:20],
        }
