"""
CineFlow Catalog & Search Route Handlers
Dispatches /api/catalog and /api/search requests.
"""


def handle_catalog(handler, qs, parsed, ctx):
    provider = qs.get("provider", ["all"])[0]
    media_type = qs.get("media_type", ["all"])[0]
    kinorium_section = qs.get("kinorium_section", ["all"])[0]
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(qs.get("lang", [app_lang])[0], app_lang)
    cat_payload = ctx.aggregator.get_catalog(
        provider_filter=provider,
        media_type_filter=media_type,
        kinorium_section=kinorium_section,
        lang=req_lang,
    )
    if ctx.profile_manager.is_kids_mode_active():
        cat_payload = ctx.profile_manager.filter_catalog_payload_for_kids(cat_payload)
    cat_payload["active_profile"] = ctx.profile_manager.get_active_profile(
        lang=req_lang,
        live_kinorium_service=ctx.kinorium_service,
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
    srch_payload = ctx.aggregator.unified_search(
        query=q,
        provider_filter=provider,
        media_type_filter=media_type,
        kinorium_section=kinorium_section,
        lang=req_lang,
        mode=search_mode,
    )
    if ctx.profile_manager.is_kids_mode_active():
        srch_payload = ctx.profile_manager.filter_catalog_payload_for_kids(srch_payload)
    handler._send_json(srch_payload)
    return True
