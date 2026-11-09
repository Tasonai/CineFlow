"""
Velarium Catalog & Search Route Handlers
Dispatches /api/catalog and /api/search requests.
"""

from typing import Dict, Any, List


def _safe_int(val: Any, default: int = 1) -> int:
    try:
        return int(val) if val is not None and str(val).strip() != "" else default
    except (ValueError, TypeError):
        return default


def build_offline_catalog_payload(ctx, media_type: str = "all", lang: str = "ru") -> Dict[str, Any]:
    """Constructs catalog payload directly from completed offline downloads."""
    dl_mgr = getattr(ctx, "download_manager", None)
    if dl_mgr is None:
        return {"ok": True, "items": [], "providers_meta": {}, "continue_watching": [], "is_offline": True}

    kids_mode = (
        bool(getattr(ctx.profile_manager, "is_kids_mode_active", lambda: False)())
        if hasattr(ctx, "profile_manager") and ctx.profile_manager
        else False
    )
    active_prof_id = (
        getattr(ctx.profile_manager, "get_active_profile_id", lambda: "main")()
        if hasattr(ctx, "profile_manager") and ctx.profile_manager
        else "main"
    )
    dl_payload = dl_mgr.get_downloads_payload(
        profile_id=active_prof_id,
        kids_mode=kids_mode,
        active_profile_id=active_prof_id,
        lang=lang,
    )
    items_raw = dl_payload.get("items") or []
    completed = [it for it in items_raw if it.get("status") == "completed"]

    grouped_items: List[Dict[str, Any]] = []
    series_groups: Dict[str, Dict[str, Any]] = {}

    for it in completed:
        m_type = it.get("media_type") or "movie"
        if media_type != "all" and m_type != media_type:
            continue

        if m_type == "series":
            group_key = (
                str(it.get("item_id") or "").strip()
                or (f"kin_{it.get('kinorium_id')}" if it.get("kinorium_id") else "")
                or (f"rezka_{it.get('rezka_id')}" if it.get("rezka_id") else "")
                or str(it.get("title") or "").strip().lower()
            )
            s_num = max(1, _safe_int(it.get("season"), 1))
            e_num = max(1, _safe_int(it.get("episode"), 1))

            if group_key not in series_groups:
                series_item = {
                    "id": it.get("item_id") or group_key,
                    "title": it.get("title") or "Velarium",
                    "orig_title": it.get("orig_title") or "",
                    "year": it.get("year") or "",
                    "media_type": "series",
                    "poster": it.get("poster") or "",
                    "backdrop": it.get("backdrop") or it.get("poster") or "",
                    "genres": it.get("genres") or [],
                    "age_rating": it.get("age_rating") or "",
                    "ratings": it.get("ratings") or {},
                    "kinorium": it.get("kinorium") or {},
                    "is_offline": True,
                    "download_id": it.get("download_id"),
                    "offline_count": 0,
                    "_seasons_map": {},
                }
                series_groups[group_key] = series_item
                grouped_items.append(series_item)

            s_map = series_groups[group_key]["_seasons_map"]
            s_key = str(s_num)
            if s_key not in s_map:
                s_map[s_key] = []
            if e_num not in s_map[s_key]:
                s_map[s_key].append(e_num)
            series_groups[group_key]["offline_count"] += 1
        else:
            movie_item = {
                "id": it.get("item_id") or f"dl_{it.get('download_id')}",
                "title": it.get("title") or "Velarium",
                "orig_title": it.get("orig_title") or "",
                "year": it.get("year") or "",
                "media_type": "movie",
                "poster": it.get("poster") or "",
                "backdrop": it.get("backdrop") or it.get("poster") or "",
                "genres": it.get("genres") or [],
                "age_rating": it.get("age_rating") or "",
                "ratings": it.get("ratings") or {},
                "kinorium": it.get("kinorium") or {},
                "is_offline": True,
                "download_id": it.get("download_id"),
                "offline_play_url": it.get("play_url"),
            }
            grouped_items.append(movie_item)

    for item in grouped_items:
        if item.get("media_type") == "series" and "_seasons_map" in item:
            s_map = item.pop("_seasons_map")
            for k in s_map:
                s_map[k].sort()
            item["seasons_map"] = s_map

    return {
        "ok": True,
        "items": grouped_items,
        "providers_meta": {"offline": {"name": "Offline", "badge": "Offline"}},
        "continue_watching": [],
        "is_offline": True,
    }


def handle_catalog(handler, qs, parsed, ctx):
    provider = qs.get("provider", ["all"])[0]
    media_type = qs.get("media_type", ["all"])[0]
    kinorium_section = qs.get("kinorium_section", ["all"])[0]
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(qs.get("lang", [app_lang])[0], app_lang)

    if provider == "offline" or kinorium_section == "offline" or media_type == "offline":
        cat_payload = build_offline_catalog_payload(
            ctx,
            media_type=media_type if media_type != "offline" else "all",
            lang=req_lang,
        )
    else:
        try:
            cat_payload = ctx.aggregator.get_catalog(
                provider_filter=provider,
                media_type_filter=media_type,
                kinorium_section=kinorium_section,
                lang=req_lang,
            )
        except Exception:
            cat_payload = build_offline_catalog_payload(
                ctx,
                media_type=media_type,
                lang=req_lang,
            )

    if not isinstance(cat_payload, dict):
        cat_payload = build_offline_catalog_payload(
            ctx,
            media_type=media_type if media_type != "offline" else "all",
            lang=req_lang,
        )

    prof_mgr = getattr(ctx, "profile_manager", None)
    if prof_mgr and hasattr(prof_mgr, "is_kids_mode_active") and prof_mgr.is_kids_mode_active():
        cat_payload = prof_mgr.filter_catalog_payload_for_kids(cat_payload)
    else:
        cat_payload = dict(cat_payload)
    if prof_mgr and hasattr(prof_mgr, "get_active_profile"):
        cat_payload["active_profile"] = prof_mgr.get_active_profile(
            lang=req_lang,
            live_kinorium_service=getattr(ctx, "kinorium_service", None),
        )
    handler._send_json(cat_payload)
    return True


def handle_search(handler, qs, parsed, ctx):
    q = qs.get("q", [""])[0]
    provider = qs.get("provider", ["all"])[0]
    media_type = qs.get("media_type", ["all"])[0]
    kinorium_section = qs.get("kinorium_section", ["all"])[0]
    search_mode = qs.get("mode", ["full"])[0]
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(qs.get("lang", [app_lang])[0], app_lang)

    if provider == "offline" or kinorium_section == "offline" or media_type == "offline":
        off_payload = build_offline_catalog_payload(
            ctx,
            media_type=media_type if media_type != "offline" else "all",
            lang=req_lang,
        )
        q_norm = q.strip().lower()
        if q_norm:
            off_payload["items"] = [
                it
                for it in off_payload.get("items", [])
                if q_norm in str(it.get("title") or "").lower()
                or q_norm in str(it.get("orig_title") or "").lower()
            ]
        srch_payload = off_payload
    else:
        try:
            srch_payload = ctx.aggregator.unified_search(
                query=q,
                provider_filter=provider,
                media_type_filter=media_type,
                kinorium_section=kinorium_section,
                lang=req_lang,
                mode=search_mode,
            )
        except Exception:
            srch_payload = build_offline_catalog_payload(
                ctx,
                media_type=media_type,
                lang=req_lang,
            )

    if not isinstance(srch_payload, dict):
        srch_payload = build_offline_catalog_payload(
            ctx,
            media_type=media_type,
            lang=req_lang,
        )

    prof_mgr = getattr(ctx, "profile_manager", None)
    if prof_mgr and hasattr(prof_mgr, "is_kids_mode_active") and prof_mgr.is_kids_mode_active():
        srch_payload = prof_mgr.filter_catalog_payload_for_kids(srch_payload)
    handler._send_json(srch_payload)
    return True
