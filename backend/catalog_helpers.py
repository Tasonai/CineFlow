"""
Velarium Catalog & Title Metadata Helpers.

Provides magnet link parsing, description validation, fallback lookups,
kids-safety metadata normalization, future episode release detection,
cyrillic scrubbing for English UI, and remote client Stremio add-on redaction.
"""

import re
from typing import Any, Dict, List, Optional, Tuple
import urllib.parse

from .translit_en import has_cyrillic


def extract_magnet_display_name(magnet: str) -> str:
    """Extracts human-readable display name from a magnet URI dn parameter."""
    m = str(magnet or "").strip()
    if not m.lower().startswith("magnet:?"):
        return ""
    try:
        qs_m = urllib.parse.parse_qs(m[8:])
        dn = (qs_m.get("dn") or [""])[0]
        return urllib.parse.unquote_plus(str(dn or "")).replace(".", " ").replace("_", " ").strip()
    except Exception:
        return ""


def is_stub_description(desc: Any, title: str = "", orig_title: str = "") -> bool:
    """Determines whether a description string is a placeholder stub or too short/trivial."""
    s = str(desc or "").strip()
    if not s or len(s) < 18:
        return True
    s_low = s.lower()
    t_low = str(title or "").strip().lower()
    o_low = str(orig_title or "").strip().lower()
    if s_low in (t_low, o_low):
        return True
    if len(s) < 90 and re.match(r"^[^.!?]{1,55}\s*\([^()]{1,65}\)\s*$", s):
        return True
    return False


def lookup_fallback_description(
    item_id: str = "",
    kinorium_id: str = "",
    title: str = "",
    orig_title: str = "",
    kinorium_service: Any = None,
    aggregator: Any = None,
) -> str:
    """Finds a non-stub overview description across Kinorium caches, remote items and catalog aggregator."""
    eff_kid = str(kinorium_id or "").strip()
    if not eff_kid and str(item_id or "").startswith("kin_") and str(item_id)[4:].isdigit():
        eff_kid = str(item_id)[4:]
    if not eff_kid and kinorium_service is not None:
        try:
            resolved_k = kinorium_service._resolve_kinorium_id(item_id, title, orig_title, allow_network=False)
            if resolved_k and str(resolved_k).isdigit():
                eff_kid = str(resolved_k)
        except Exception:
            pass
    if eff_kid.isdigit() and kinorium_service is not None:
        lock = getattr(kinorium_service, "_state_lock", None)
        if lock is not None:
            with lock:
                cached_k_desc = str((kinorium_service.state.get("descriptions_by_kid") or {}).get(eff_kid) or "").strip()
                if not is_stub_description(cached_k_desc, title, orig_title):
                    return cached_k_desc
                for skey in ("remote_watching_items", "remote_watchlist_items", "remote_watched_items"):
                    rem_e = (kinorium_service.state.get(skey) or {}).get(eff_kid)
                    if isinstance(rem_e, dict):
                        r_desc = str(rem_e.get("description") or "").strip()
                        if not is_stub_description(r_desc, title, orig_title):
                            return r_desc
        else:
            cached_k_desc = str((getattr(kinorium_service, "state", {}).get("descriptions_by_kid") or {}).get(eff_kid) or "").strip()
            if not is_stub_description(cached_k_desc, title, orig_title):
                return cached_k_desc
            for skey in ("remote_watching_items", "remote_watchlist_items", "remote_watched_items"):
                rem_e = (getattr(kinorium_service, "state", {}).get(skey) or {}).get(eff_kid)
                if isinstance(rem_e, dict):
                    r_desc = str(rem_e.get("description") or "").strip()
                    if not is_stub_description(r_desc, title, orig_title):
                        return r_desc

    if aggregator is not None:
        for cid in filter(None, [item_id, f"kin_{eff_kid}" if eff_kid.isdigit() else ""]):
            cat_it = (
                aggregator.lookup_cached_item(cid)
                if hasattr(aggregator, "lookup_cached_item")
                else (getattr(aggregator, "_catalog_by_id", {}) or {}).get(cid)
            )
            if isinstance(cat_it, dict):
                c_desc = str(cat_it.get("description") or "").strip()
                if not is_stub_description(c_desc, title, orig_title):
                    return c_desc
    return ""


def build_trusted_item_for_kids_check(
    item_id: str = "",
    title: str = "",
    orig_title: str = "",
    media_type: str = "",
    server_genres: Optional[List[str]] = None,
    server_age: str = "",
    server_description: str = "",
    aggregator: Any = None,
    kinorium_service: Any = None,
) -> Dict[str, Any]:
    """Builds a trusted catalog metadata representation with enriched genres and age ratings for kids-mode filtering."""
    merged_genres: List[str] = list(server_genres or [])
    age_val = str(server_age or "").strip()
    desc_val = str(server_description or "").strip()
    eff_title = str(title or "").strip()
    eff_orig = str(orig_title or "").strip()

    clean_iid = str(item_id or "").strip()
    if aggregator is not None:
        cat_it = (
            aggregator.lookup_cached_item(clean_iid)
            if hasattr(aggregator, "lookup_cached_item")
            else (getattr(aggregator, "_catalog_by_id", {}) or {}).get(clean_iid)
        )
        if isinstance(cat_it, dict):
            eff_title = eff_title or str(cat_it.get("title") or "")
            eff_orig = eff_orig or str(cat_it.get("orig_title") or "")
            if not merged_genres and isinstance(cat_it.get("genres"), list):
                merged_genres = list(cat_it["genres"])
            age_val = age_val or str(cat_it.get("age_rating") or cat_it.get("mpaa") or "")
            desc_val = desc_val or str(cat_it.get("description") or "")

    eff_kid = ""
    if str(item_id or "").startswith("kin_") and str(item_id)[4:].isdigit():
        eff_kid = str(item_id)[4:]
    elif (eff_title or eff_orig) and kinorium_service is not None:
        eff_kid = str(
            kinorium_service._resolve_kinorium_id(item_id, eff_title, eff_orig, allow_network=False) or ""
        )
    if eff_kid.isdigit() and kinorium_service is not None:
        lock = getattr(kinorium_service, "_state_lock", None)
        if lock is not None:
            with lock:
                for skey in ("remote_watching_items", "remote_watchlist_items", "remote_watched_items"):
                    rem_e = (kinorium_service.state.get(skey) or {}).get(eff_kid)
                    if isinstance(rem_e, dict):
                        if not merged_genres and isinstance(rem_e.get("genres"), list):
                            merged_genres = list(rem_e["genres"])
                        desc_val = desc_val or str(rem_e.get("description") or "")
                        break
        else:
            for skey in ("remote_watching_items", "remote_watchlist_items", "remote_watched_items"):
                rem_e = (getattr(kinorium_service, "state", {}).get(skey) or {}).get(eff_kid)
                if isinstance(rem_e, dict):
                    if not merged_genres and isinstance(rem_e.get("genres"), list):
                        merged_genres = list(rem_e["genres"])
                    desc_val = desc_val or str(rem_e.get("description") or "")
                    break

    return {
        "id": item_id,
        "title": eff_title,
        "orig_title": eff_orig,
        "media_type": media_type,
        "genres": merged_genres,
        "age_rating": age_val,
        "description": desc_val,
    }


def is_known_episode_unreleased(
    kid: str = "",
    item_id: str = "",
    title: str = "",
    orig_title: str = "",
    year: int = 0,
    season: int = 1,
    episode: int = 1,
    kinorium_service: Any = None,
    en_meta_resolver: Any = None,
) -> bool:
    """Verifies whether an episode has not yet aired based on Kinorium or English metadata episode schedules."""
    eff_kid = str(kid or "").strip()
    if not eff_kid.isdigit() and str(item_id or "").startswith("kin_") and str(item_id)[4:].isdigit():
        eff_kid = str(item_id)[4:]
    if (
        not eff_kid.isdigit()
        and (title or orig_title)
        and kinorium_service is not None
        and hasattr(kinorium_service, "is_service_enabled")
        and kinorium_service.is_service_enabled("kinorium")
    ):
        eff_kid = str(
            kinorium_service._resolve_kinorium_id(
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                allow_network=False,
                media_type="series",
                year=year or None,
            )
            or ""
        )
    if (
        eff_kid.isdigit()
        and kinorium_service is not None
        and hasattr(kinorium_service, "is_service_enabled")
        and kinorium_service.is_service_enabled("kinorium")
    ):
        try:
            ep_st = kinorium_service.fetch_series_episodes_state(eff_kid, item_id="")
            ep_obj = (ep_st.get("episodes") or {}).get((int(season), int(episode)))
            if isinstance(ep_obj, dict):
                if ep_obj.get("is_future"):
                    return True
                return False
        except Exception:
            pass
    if en_meta_resolver is not None:
        try:
            en_ep_res = en_meta_resolver.resolve(
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                year=year,
                media_type="series",
                kinorium_id=eff_kid,
                need_episodes=True,
            )
            if isinstance(en_ep_res, dict):
                ep_m = ((en_ep_res.get("episodes_meta_en") or {}).get(str(int(season))) or {}).get(str(int(episode)))
                if isinstance(ep_m, dict) and ep_m.get("is_future"):
                    return True
        except Exception:
            pass
    return False


def scrub_cyrillic_episode_dicts(
    ep_titles: Optional[Dict[str, Any]],
    ep_meta: Optional[Dict[str, Any]],
) -> Tuple[Dict[str, Dict[str, str]], Dict[str, Dict[str, Dict[str, Any]]]]:
    """Scrubs Cyrillic strings from episode title maps and metadata dictionaries for clean English display."""
    clean_titles: Dict[str, Dict[str, str]] = {}
    for sn_k, sn_map in (ep_titles or {}).items():
        if not isinstance(sn_map, dict):
            continue
        c_sn: Dict[str, str] = {}
        for ep_k, t_val in sn_map.items():
            s_val = str(t_val or "").strip()
            if s_val and not has_cyrillic(s_val):
                c_sn[str(ep_k)] = s_val
        if c_sn:
            clean_titles[str(sn_k)] = c_sn

    clean_meta: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for sn_k, sn_map in (ep_meta or {}).items():
        if not isinstance(sn_map, dict):
            continue
        c_sn_m: Dict[str, Dict[str, Any]] = {}
        for ep_k, info in sn_map.items():
            if not isinstance(info, dict):
                continue
            item_info = dict(info)
            if has_cyrillic(str(item_info.get("title") or "")):
                item_info["title"] = ""
            if has_cyrillic(str(item_info.get("orig_title") or "")):
                item_info["orig_title"] = ""
            if has_cyrillic(str(item_info.get("overview") or "")):
                item_info["overview"] = ""
            if has_cyrillic(str(item_info.get("air_date") or "")):
                item_info["air_date"] = ""
            c_sn_m[str(ep_k)] = item_info
        if c_sn_m:
            clean_meta[str(sn_k)] = c_sn_m
    return clean_titles, clean_meta


def redact_stremio_addons_for_client(
    addons: Any,
    is_local_client: bool,
    default_addons: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Redacts private/custom Stremio add-on manifest URLs when queried by external/LAN clients."""
    if not isinstance(addons, list):
        return []
    if is_local_client:
        return addons
    default_urls = {
        str(d.get("manifest_url") or "").rstrip("/")
        for d in (default_addons or [])
        if isinstance(d, dict)
    }
    out: List[Dict[str, Any]] = []
    for a in addons:
        if not isinstance(a, dict):
            continue
        item = dict(a)
        m_url = str(item.get("manifest_url") or "").strip()
        if m_url and m_url.rstrip("/") not in default_urls and not item.get("builtin"):
            p = urllib.parse.urlparse(m_url)
            if p.scheme and p.netloc:
                item["manifest_url"] = f"{p.scheme}://{p.netloc}/[redacted]/manifest.json"
            else:
                item["manifest_url"] = ""
            if "base_url" in item:
                item["base_url"] = f"{p.scheme}://{p.netloc}" if (p.scheme and p.netloc) else ""
        out.append(item)
    return out


__all__ = [
    "extract_magnet_display_name",
    "is_stub_description",
    "lookup_fallback_description",
    "build_trusted_item_for_kids_check",
    "is_known_episode_unreleased",
    "scrub_cyrillic_episode_dicts",
    "redact_stremio_addons_for_client",
]
