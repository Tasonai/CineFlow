import concurrent.futures
import copy
import datetime
import re
import threading
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Set, Tuple

from .en_metadata import (
    RU_GENRES_TO_EN,
    _names_match_ru_en,
    has_cyrillic,
    resolve_original_poster_url,
    translate_birth_date_en,
    translate_birth_place_en,
    translate_career_role_en,
    transliterate_cyrillic,
)
from .kinorium import _norm_title, _title_variants
from .profiles import ProfileManager
from .storage_db import get_storage_db

_DISCOVERY_BG_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=6,
    thread_name_prefix="VelariumDiscoveryBg",
)


def resolve_similar_for_title(
    agg,
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
    kin_enabled = agg.is_service_enabled("kinorium")

    if kin_enabled:
        kin_sim = agg.kinorium.get_similar_catalog_items(
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
            agg._enrich_from_curated(kin_sim)
            enriched = [agg.enrich_item(it) for it in kin_sim]
            filtered = agg._filter_items_list(enriched, allow_empty_providers=True)
            target_aliases = agg._extract_item_aliases(
                {"title": title, "orig_title": orig_title, "id": item_id, "kinorium_id": kinorium_id}
            )
            deduped: List[Dict[str, Any]] = []
            for cand in filtered:
                if str(cand.get("id") or "") == str(item_id or ""):
                    continue
                if kinorium_id and str(cand.get("kinorium_id") or "") == str(kinorium_id):
                    continue
                if target_aliases and (agg._extract_item_aliases(cand) & target_aliases):
                    continue
                deduped.append(agg._strip_internal_search_keys(cand))
            if deduped:
                if ui_lang == "en":
                    cyr_items = [
                        x
                        for x in deduped
                        if not x.get("orig_title") or has_cyrillic(str(x.get("orig_title") or ""))
                    ]
                    if cyr_items:
                        agg._prewarm_en_metadata_for_items(cyr_items[:4], max_items=4)
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
    c_seed = agg._match_curated_catalog_entry(seed_item)
    if c_seed:
        if not seed_item["genres"]:
            seed_item["genres"] = list(c_seed.get("genres") or [])
        if not seed_item["directors"] and c_seed.get("directors"):
            seed_item["directors"] = list(c_seed.get("directors") or [])
        if not seed_item["actors"] and c_seed.get("actors"):
            seed_item["actors"] = list(c_seed.get("actors") or [])

    sim_pool = agg._filter_items_list([agg.enrich_item(it) for it in agg.CURATED_CATALOG])
    premieres_all = agg._get_online_premieres()
    fb_items = agg._build_search_similar_items(
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
    agg._register_catalog_items(sliced_fb)
    return {"items": sliced_fb, "source": "curated"}


_FRANCHISE_SUFFIX_RE = re.compile(
    r"""(?ix)
    (?:
        \s*[:\-–—]\s*(?:
            part\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+|[ivx]+)
            |chapter\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+|[ivx]+)
            |volume\s+(?:\d+|[ivx]+)
            |vol\.?\s*(?:\d+|[ivx]+)
            |часть\s+(?:первая|вторая|третья|четвертая|четвёртая|пятая|шестая|\d+|[ivx]+)
            |глава\s+(?:первая|вторая|третья|четвертая|четвёртая|\d+|[ivx]+)
            |фильм\s+(?:первый|второй|третий|\d+|[ivx]+)
        )\b.*$
        |\s+(?:
            part\s+(?:one|two|three|four|five|\d+|[ivx]+)
            |chapter\s+(?:one|two|three|four|five|\d+|[ivx]+)
            |часть\s+(?:первая|вторая|третья|четвертая|четвёртая|\d+|[ivx]+)
            |глава\s+(?:первая|вторая|третья|четвертая|четвёртая|\d+|[ivx]+)
        )\b.*$
    )
    """
)
_TRAILING_PART_NUM_RE = re.compile(r"\s+(?:[2-9]|1[0-5]|ii|iii|iv|v|vi|vii|viii|ix|x)\s*$", re.I)


def extract_franchise_root_key(title: str = "", orig_title: str = "") -> str:
    raw = str(orig_title or "").strip()
    if not raw or has_cyrillic(raw):
        raw = str(title or orig_title or "").strip()
    if not raw:
        return ""
    s = raw.lower().replace("ё", "е").strip()
    s = re.sub(r"\(\s*(?:19|20)\d{2}\s*\)\s*$", "", s).strip()
    s = _FRANCHISE_SUFFIX_RE.sub("", s).strip()
    if ":" in s:
        head = s.split(":", 1)[0].strip()
        head = _TRAILING_PART_NUM_RE.sub("", head).strip()
        if len(head) >= 3 and head not in ("the", "movie", "film", "фильм", "кино", "история"):
            s = head
    s = _TRAILING_PART_NUM_RE.sub("", s).strip()
    s = re.sub(r"^(?:the|a|an)\s+", "", s).strip()
    s = re.sub(r"[^\w\s]+", " ", s, flags=re.U)
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) >= 3 else ""


def resolve_franchise_for_title(
    agg,
    item_id: str = "",
    rezka_id: str = "",
    title: str = "",
    orig_title: str = "",
    year: int = 0,
    media_type: str = "movie",
    preloaded_parts: Optional[List[Dict[str, Any]]] = None,
    lang: str = "ru",
) -> Dict[str, Any]:
    with agg._catalog_lock:
        catalog_pool = list(agg.CURATED_CATALOG) + list(agg._catalog_by_id.values())

    by_rezka_id: Dict[str, Dict[str, Any]] = {}
    by_norm_title: Dict[Tuple[str, int], Dict[str, Any]] = {}
    for cat_it in catalog_pool:
        if not isinstance(cat_it, dict):
            continue
        rid = str(cat_it.get("rezka_id") or "").strip()
        if rid and rid not in by_rezka_id:
            by_rezka_id[rid] = cat_it
        cy = int(cat_it.get("year") or 0) if str(cat_it.get("year") or "").isdigit() else 0
        for t_field in ("title", "orig_title"):
            nt = _norm_title(str(cat_it.get(t_field) or ""))
            if nt and (nt, cy) not in by_norm_title:
                by_norm_title[(nt, cy)] = cat_it
            if nt and (nt, 0) not in by_norm_title:
                by_norm_title[(nt, 0)] = cat_it

    kin_enabled = agg.is_service_enabled("kinorium")

    if isinstance(preloaded_parts, list) and len(preloaded_parts) >= 2:
        items_out: List[Dict[str, Any]] = []
        for idx, part in enumerate(preloaded_parts, start=1):
            if not isinstance(part, dict):
                continue
            p_rid = str(part.get("rezka_id") or "").strip()
            p_title = str(part.get("title") or "").strip()
            p_year = int(part.get("year") or 0) if str(part.get("year") or "").isdigit() else 0
            p_nt = _norm_title(p_title)
            matched_cat = (
                by_rezka_id.get(p_rid)
                or (by_norm_title.get((p_nt, p_year)) if p_nt and p_year else None)
                or (by_norm_title.get((p_nt, 0)) if p_nt else None)
            )
            enriched_cat = agg.enrich_item(matched_cat) if matched_cat else {}
            kin_state = enriched_cat.get("kinorium") if isinstance(enriched_cat, dict) else None
            if not kin_state and kin_enabled and hasattr(agg.kinorium, "get_status_for_item"):
                try:
                    kin_state = agg.kinorium.get_status_for_item(
                        {
                            "title": p_title,
                            "orig_title": str(enriched_cat.get("orig_title") or ""),
                            "year": p_year,
                            "media_type": str(enriched_cat.get("media_type") or media_type or "movie"),
                        }
                    )
                except Exception:
                    kin_state = {}
            is_cur = bool(
                part.get("is_current")
                or (rezka_id and p_rid and str(rezka_id) == p_rid)
                or (item_id and enriched_cat.get("id") and str(enriched_cat.get("id")) == str(item_id))
                or (not rezka_id and p_nt and p_nt == _norm_title(title) and (not year or not p_year or p_year == int(year)))
            )
            rating_str = str(
                part.get("rating")
                or (enriched_cat.get("ratings") or {}).get("kinorium")
                or (enriched_cat.get("ratings") or {}).get("imdb")
                or ""
            ).strip()
            items_out.append(
                {
                    "id": str(enriched_cat.get("id") or (f"rz_{p_rid}" if p_rid else f"fr_{idx}")),
                    "num": int(part.get("num") or idx),
                    "title": str(enriched_cat.get("title") or p_title),
                    "orig_title": str(enriched_cat.get("orig_title") or ""),
                    "year": p_year or enriched_cat.get("year") or "",
                    "rating": rating_str,
                    "ratings": enriched_cat.get("ratings") or ({"kinorium": rating_str} if rating_str else {}),
                    "poster": str(enriched_cat.get("poster") or ""),
                    "poster_en": str(enriched_cat.get("poster_en") or ""),
                    "backdrop": str(enriched_cat.get("backdrop") or ""),
                    "media_type": str(enriched_cat.get("media_type") or media_type or "movie"),
                    "rezka_id": p_rid or str(enriched_cat.get("rezka_id") or ""),
                    "rezka_url": str(part.get("rezka_url") or enriched_cat.get("rezka_url") or ""),
                    "kinorium_id": str(enriched_cat.get("kinorium_id") or ""),
                    "kinorium": kin_state or {},
                    "is_current": is_cur,
                }
            )
        if len(items_out) >= 2:
            if not any(x.get("is_current") for x in items_out):
                for x in items_out:
                    if _norm_title(x.get("title", "")) == _norm_title(title):
                        x["is_current"] = True
                        break
            return {"items": items_out, "source": "hdrezka"}

    # Fallback: group franchise siblings from catalog by normalized root title
    root_key = extract_franchise_root_key(title, orig_title)
    if not root_key:
        return {"items": [], "source": "none"}

    seen_keys: Set[str] = set()
    matched_siblings: List[Dict[str, Any]] = []
    target_mt = str(media_type or "movie").strip().lower()
    for cat_it in catalog_pool:
        if not isinstance(cat_it, dict):
            continue
        c_mt = str(cat_it.get("media_type") or "movie").strip().lower()
        if c_mt != target_mt:
            continue
        c_root = extract_franchise_root_key(str(cat_it.get("title") or ""), str(cat_it.get("orig_title") or ""))
        if c_root != root_key:
            continue
        dedup_k = f"{_norm_title(str(cat_it.get('orig_title') or cat_it.get('title') or ''))}|{cat_it.get('year') or ''}"
        if dedup_k in seen_keys:
            continue
        seen_keys.add(dedup_k)
        matched_siblings.append(agg.enrich_item(cat_it))

    if len(matched_siblings) < 2:
        return {"items": [], "source": "none"}

    matched_siblings.sort(
        key=lambda x: (
            int(x.get("year")) if str(x.get("year") or "").isdigit() else 9999,
            str(x.get("title") or ""),
        )
    )
    cat_out: List[Dict[str, Any]] = []
    for idx, sib in enumerate(matched_siblings, start=1):
        sib_id = str(sib.get("id") or "")
        sib_yr = int(sib.get("year")) if str(sib.get("year") or "").isdigit() else 0
        is_cur = bool(
            (item_id and sib_id == str(item_id))
            or (
                _norm_title(str(sib.get("title") or "")) == _norm_title(title)
                and (not year or not sib_yr or sib_yr == int(year))
            )
        )
        r_obj = sib.get("ratings") or {}
        r_str = str(r_obj.get("kinorium") or r_obj.get("imdb") or "")
        cat_out.append(
            {
                "id": sib_id or f"fr_{idx}",
                "num": idx,
                "title": str(sib.get("title") or ""),
                "orig_title": str(sib.get("orig_title") or ""),
                "year": sib_yr or "",
                "rating": r_str,
                "ratings": r_obj,
                "poster": str(sib.get("poster") or ""),
                "poster_en": str(sib.get("poster_en") or ""),
                "backdrop": str(sib.get("backdrop") or ""),
                "media_type": str(sib.get("media_type") or target_mt),
                "rezka_id": str(sib.get("rezka_id") or ""),
                "rezka_url": str(sib.get("rezka_url") or ""),
                "kinorium_id": str(sib.get("kinorium_id") or ""),
                "kinorium": sib.get("kinorium") or {},
                "is_current": is_cur,
            }
        )
    return {"items": cat_out, "source": "catalog"}

def _build_search_similar_items(
    agg,
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
        excluded_aliases.update(agg._extract_item_aliases(m_it))

    seen_sim_ids: Set[str] = set()
    seen_sim_aliases: Set[str] = set()
    final_out: List[Dict[str, Any]] = []

    # 1. Prefer real Kinorium #similar-slider recommendations for the top matched work
    top_hit = matched[0]
    top_kid = str(top_hit.get("kinorium_id") or (top_hit.get("kinorium") or {}).get("kinorium_id") or "")
    if kin_enabled and use_kinorium_live and len(matched) <= 8:
        kin_sim_items = agg.kinorium.get_similar_catalog_items(
            kid=top_kid,
            item_id=str(top_hit.get("id") or ""),
            title=str(top_hit.get("title") or ""),
            orig_title=str(top_hit.get("orig_title") or ""),
            year=agg._safe_int(top_hit.get("year")) or None,
            media_type=str(top_hit.get("media_type") or ""),
            allow_network=bool(len(matched) <= 4),
            limit=limit,
        )
        if kin_sim_items:
            agg._enrich_from_curated(kin_sim_items)
            for ks_raw in kin_sim_items:
                enr = agg._filter_item_by_enabled_services(
                    agg.enrich_item(ks_raw),
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
                cand_aliases = agg._extract_item_aliases(enr)
                if (cand_aliases & excluded_aliases) or cid in seen_sim_ids or (cand_aliases & seen_sim_aliases):
                    continue
                seen_sim_ids.add(cid)
                seen_sim_aliases.update(cand_aliases)
                final_out.append(agg._strip_internal_search_keys(enr))
                if len(final_out) >= limit:
                    return final_out

    # 2. Multi-signal fallback / supplement (directors, actors, franchise, specific genre intersections)
    target_genres: Dict[str, float] = {}
    target_genre_labels: Dict[str, str] = {}
    for idx, m_it in enumerate(matched[:3]):
        weight = 1.0 if idx == 0 else 0.55
        for g in m_it.get("genres") or []:
            g_disp = agg._canonical_genre(str(g or ""))
            gl = g_disp.strip().lower()
            if gl and gl not in ("фильм", "сериал") and gl not in agg.COUNTRY_STOPWORDS:
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
    for alias in agg._extract_item_aliases(top_hit):
        for w in alias.split():
            if len(w) >= 5 and w not in agg.GENERIC_SIMILAR_WORDS:
                franchise_tokens.add(w)

    raw_pool: List[Dict[str, Any]] = []
    raw_pool.extend(sim_pool or [])
    raw_pool.extend(premieres_all or [])
    if kin_enabled:
        wl_items = agg.kinorium.get_section_catalog_items("watchlist", media_type_filter="all", query="")
        wt_items = agg.kinorium.get_section_catalog_items("watching", media_type_filter="all", query="")
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
        cand_aliases = agg._extract_item_aliases(cand)
        if cand_aliases & excluded_aliases:
            continue
        if cid in seen_sim_ids or (cand_aliases & seen_sim_aliases):
            continue

        poster_u = str(cand.get("poster") or "")
        if not poster_u or "hdrezka" in poster_u.lower():
            continue

        filtered_cand = agg._filter_item_by_enabled_services(cand, allow_empty_providers=False)
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
            agg._canonical_genre(str(g or "")).strip().lower()
            for g in (filtered_cand.get("genres") or [])
            if str(g or "").strip().lower() not in ("фильм", "сериал", "")
            and str(g or "").strip().lower() not in agg.COUNTRY_STOPWORDS
        ]
        matched_genres: List[str] = []
        specific_matched_count = 0
        genre_score = 0.0
        for cg in cand_genres:
            if cg in target_genres:
                matched_genres.append(cg)
                if cg in agg.BROAD_GENRES_LOW_WEIGHT:
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

        out_cand = agg._strip_internal_search_keys(filtered_cand)
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

def _fetch_justwatch_by_provider(agg, provider_id: str) -> List[Dict[str, Any]]:
    return agg.justwatch.fetch_by_provider(provider_id)

def resolve_provider_offers_for_title(
    agg,
    title: str = "",
    orig_title: str = "",
    year: int = 0,
    media_type: str = "",
) -> List[Dict[str, Any]]:
    return agg.justwatch.resolve_provider_offers_for_title(
        title=title, orig_title=orig_title, year=year, media_type=media_type
    )

def _search_hdrezka_live(agg, query: str) -> List[Dict[str, Any]]:
    import re as _re

    out: List[Dict[str, Any]] = []
    try:
        raw_list = agg.rezka.search_live(query)
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
            if _re.search(r"\b(19\d\d|20\d\d)\b", p) or p.lower() in agg.COUNTRY_STOPWORDS or "..." in p:
                continue
            cg = agg._canonical_genre(p)
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

def _search_justwatch_poland(agg, query: str) -> List[Dict[str, Any]]:
    return agg.justwatch.search_poland(query)

def _query_justwatch_graphql(agg, title_filter: Dict[str, Any], first: int = 10) -> List[Dict[str, Any]]:
    return agg.justwatch.query_graphql(title_filter, first=first)

def get_person_profile(
    agg,
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
    with agg._catalog_lock:
        cached_raw_entry = agg._person_raw_cache.get(cache_key) if cache_key else None
        raw = copy.deepcopy(cached_raw_entry[1]) if (cached_raw_entry and (now_ts - cached_raw_entry[0]) < 1800) else None
    if raw is None:
        if not person_url and clean_low:
            person_url = agg.rezka.find_cached_person_url(name)

        if not person_url and clean_low and (hint_title or hint_orig):
            try:
                agg.rezka._resolve_page_metadata("", hint_title, hint_orig, None)
            except Exception:
                pass
            person_url = agg.rezka.find_cached_person_url(name)

        if not person_url and clean_low:
            for c_it in agg.CURATED_CATALOG:
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
                        agg.rezka._resolve_page_metadata(
                            "",
                            str(c_it.get("title") or ""),
                            str(c_it.get("orig_title") or ""),
                            None,
                            year=agg._safe_int(c_it.get("year")),
                            media_type=str(c_it.get("media_type") or "movie"),
                        )
                    except Exception:
                        pass
                    person_url = agg.rezka.find_cached_person_url(name)
                    if person_url:
                        break

        kin_prof: Dict[str, Any] = {}
        if not person_url and clean_low and hasattr(agg.kinorium, "fetch_person_filmography"):
            try:
                kin_prof = agg.kinorium.fetch_person_filmography(name=name) or {}
            except Exception:
                kin_prof = {}
            if kin_prof and kin_prof.get("sections") and agg.is_service_enabled("hdrezka"):
                top_sec_items = (kin_prof["sections"][0].get("items") or []) if kin_prof["sections"] else []
                for kw in top_sec_items[:2]:
                    try:
                        agg.rezka._resolve_page_metadata(
                            "",
                            str(kw.get("title") or ""),
                            str(kw.get("orig_title") or ""),
                            None,
                            year=agg._safe_int(kw.get("year")),
                            media_type=str(kw.get("media_type") or "movie"),
                        )
                    except Exception:
                        pass
                    person_url = (
                        agg.rezka.find_cached_person_url(name)
                        or agg.rezka.find_cached_person_url(str(kin_prof.get("name") or ""))
                        or agg.rezka.find_cached_person_url(str(kin_prof.get("orig_name") or ""))
                    )
                    if person_url:
                        break

        raw = agg.rezka.get_person_details(name=name, hint_url=person_url)
        if not (raw or {}).get("sections") and not kin_prof and clean_low and hasattr(agg.kinorium, "fetch_person_filmography"):
            try:
                kin_prof = agg.kinorium.fetch_person_filmography(name=name) or {}
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
            with agg._catalog_lock:
                if len(agg._person_raw_cache) > 120:
                    for k_ev in list(agg._person_raw_cache.keys())[:30]:
                        agg._person_raw_cache.pop(k_ev, None)
                agg._person_raw_cache[cache_key] = (now_ts, raw_snap)
                if raw.get("person_url"):
                    agg._person_raw_cache[str(raw["person_url"]).strip().lower()] = (now_ts, raw_snap)
                if raw.get("name"):
                    agg._person_raw_cache[str(raw["name"]).strip().lower()] = (now_ts, raw_snap)
                if raw.get("orig_name"):
                    agg._person_raw_cache[str(raw["orig_name"]).strip().lower()] = (now_ts, raw_snap)
    kin_enabled = agg.is_service_enabled("kinorium")

    curated_by_norm: Dict[str, Dict[str, Any]] = {}
    for c_it in agg.CURATED_CATALOG:
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
                "year": agg._safe_int(r.get("year")),
                "media_type": mtype,
                "seasons_count": agg._safe_int(r.get("seasons_count"), 1),
                "episodes_per_season": agg._safe_int(r.get("episodes_per_season"), 0 if mtype == "series" else 1),
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
                if re.search(r"\b(19\d\d|20\d\d)\b", p) or p.lower() in agg.COUNTRY_STOPWORDS or "..." in p:
                    continue
                cg = agg._canonical_genre(p)
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
                c_yr = agg._safe_int(c_match.get("year"))
                it_yr = agg._safe_int(item_dict.get("year"))
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

        enriched = agg.enrich_item(item_dict)
        filtered = agg._filter_item_by_enabled_services(enriched, allow_empty_providers=True)
        if filtered is None:
            return None
        return agg._strip_internal_search_keys(filtered)

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
            conv_items.sort(key=lambda x: agg._safe_int(x.get("year")), reverse=True)
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
        key=lambda x: agg._safe_int(x.get("year")),
        reverse=True,
    )

    if ui_lang == "en" and all_items:
        agg._prewarm_en_metadata_for_items(all_items[:16], max_items=16)
        if len(all_items) > 16 and agg.en_meta is not None:
            tail_items = [dict(x) for x in all_items[16:44]]
            _DISCOVERY_BG_EXECUTOR.submit(
                agg._prewarm_en_metadata_for_items,
                tail_items,
                28,
            )

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
    career_str = (
        str(raw.get("career_roles") or "")
        .replace("Актер", "Актёр")
        .replace("актер", "актёр")
        .replace("Режиссер", "Режиссёр")
        .replace("режиссер", "режиссёр")
        .replace("Монтажер", "Монтажёр")
        .replace("монтажер", "монтажёр")
    )
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

    agg._register_catalog_items(all_items)
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
    agg,
    days_past: int = 14,
    days_ahead: int = 45,
    lang: str = "ru",
    kids_mode: bool = False,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
    today_dt = datetime.date.today()
    today_iso = today_dt.isoformat()
    min_iso = (today_dt - datetime.timedelta(days=max(1, min(90, agg._safe_int(days_past, 14) or 14)))).isoformat()
    max_iso = (today_dt + datetime.timedelta(days=max(1, min(120, agg._safe_int(days_ahead, 45) or 45)))).isoformat()

    tracked_series: List[Dict[str, Any]] = []
    seen_keys: Set[str] = set()

    def _push_series(raw_it: Dict[str, Any], is_actively_watching: bool = False) -> None:
        if not isinstance(raw_it, dict):
            return
        if str(raw_it.get("media_type") or "") != "series":
            return
        it = agg.enrich_item(raw_it)
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

    for cw_it in agg._build_continue_watching_list(ui_lang=ui_lang):
        _push_series(cw_it, is_actively_watching=True)

    if agg.is_service_enabled("kinorium"):
        watching_items = agg._enrich_from_curated(
            agg.kinorium.get_section_catalog_items(
                section="watching",
                media_type_filter="series",
                query="",
            )
        )
        for w_it in watching_items[:28]:
            _push_series(w_it, is_actively_watching=True)

        if len(tracked_series) < 18:
            wl_items = agg._enrich_from_curated(
                agg.kinorium.get_section_catalog_items(
                    section="watchlist",
                    media_type_filter="series",
                    query="",
                )
            )
            for wl_it in wl_items[:16]:
                _push_series(wl_it, is_actively_watching=False)

    if len(tracked_series) < 8:
        for cur_it in agg.CURATED_CATALOG:
            if cur_it.get("media_type") == "series":
                _push_series(cur_it, is_actively_watching=False)
            if len(tracked_series) >= 14:
                break

    if kids_mode:
        tracked_series = ProfileManager.filter_items_for_kids(tracked_series)

    tracked_series = tracked_series[:24]
    storage_db = None
    if getattr(agg.kinorium, "storage_dir", None):
        try:
            storage_db = get_storage_db(agg.kinorium.storage_dir)
        except Exception:
            storage_db = None

    def _fetch_series_schedule(ser: Dict[str, Any]) -> List[Dict[str, Any]]:
        try:
            if agg.stremio is None:
                return []
            raw_id = str(ser.get("imdb_id") or ser.get("id") or "")
            imdb_id = raw_id if raw_id.startswith("tt") else ""
            if not imdb_id and hasattr(agg.stremio, "resolve_imdb_id"):
                try:
                    imdb_id = str(
                        agg.stremio.resolve_imdb_id(
                            item_id=str(ser.get("id") or ""),
                            title=str(ser.get("title") or ""),
                            orig_title=str(ser.get("orig_title") or ""),
                            year=agg._safe_int(ser.get("year")),
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
                    c_meta = agg.stremio.fetch_cinemeta_series_meta(imdb_id, force_refresh=force_refresh)
                except TypeError:
                    c_meta = agg.stremio.fetch_cinemeta_series_meta(imdb_id)
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
            live_m = agg.kinorium.get_series_live_meta(
                item_id=str(ser.get("id") or ""),
                title=str(ser.get("title") or ""),
                orig_title=str(ser.get("orig_title") or ""),
                kid=str(ser.get("kinorium_id") or ks.get("kinorium_id") or ""),
                year=agg._safe_int(ser.get("year")),
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
            known_seasons_cnt = max(1, agg._safe_int(ser.get("seasons_count"), 1))
            for s_num, e_num, info in flat_eps:
                air_date = str(info.get("air_date") or "")[:10]
                if not re.match(r"^\d{4}-\d{2}-\d{2}$", air_date):
                    continue
                if air_date < min_iso or air_date > max_iso:
                    continue
                watched_eps_in_s = {
                    agg._safe_int(x, -1) for x in (we_map.get(str(s_num)) or [])
                }
                is_watched = e_num in watched_eps_in_s or bool(
                    not has_explicit_ep_history
                    and air_date <= today_iso
                    and ks.get("watched")
                    and not ks.get("has_new_episode")
                    and s_num <= known_seasons_cnt
                )
                dub_eps_in_s = {
                    agg._safe_int(x, -1) for x in (dub_seasons.get(str(s_num)) or [])
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
    if tracked_series and agg.stremio is not None:
        for rows in _DISCOVERY_BG_EXECUTOR.map(_fetch_series_schedule, tracked_series):
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
