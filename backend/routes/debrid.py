"""
Modular route handlers for Debrid, Torrent and Backup Streams endpoints:
- GET /api/backup-streams
- POST /api/integrations
- POST /api/debrid/resolve
- POST /api/backup-streams/resolve
"""

from __future__ import annotations

from typing import Any, Dict


def handle_backup_streams_get(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    title = qs.get("title", [""])[0]
    orig_title = qs.get("orig_title", [""])[0]
    year = ctx.qs_int(qs, "year", 0)
    item_id = qs.get("id", [""])[0]
    imdb_id_param = qs.get("imdb_id", [""])[0].strip()
    eff_item_id = imdb_id_param if imdb_id_param.startswith("tt") and not str(item_id).startswith("tt") else item_id
    rezka_url = qs.get("rezka_url", [""])[0]
    media_type = qs.get("media_type", ["movie"])[0]
    season = max(1, ctx.qs_int(qs, "season", 1))
    episode = max(1, ctx.qs_int(qs, "episode", 1))
    req_lang = ctx.norm_app_lang(qs.get("lang", [ctx.app_prefs.get("app_lang", "ru")])[0], ctx.app_prefs.get("app_lang", "ru"))
    if ctx.profile_manager.is_kids_mode_active():
        cand_item = ctx.build_trusted_item_for_kids_check(
            item_id=item_id or eff_item_id,
            title=title,
            orig_title=orig_title,
            media_type=media_type,
        )
        probe_bkp = (
            cand_item
            if (cand_item.get("genres") or cand_item.get("description") or cand_item.get("age_rating"))
            else {**cand_item, "genres": ["семейный"]}
        )
        if not (cand_item.get("title") or cand_item.get("orig_title") or cand_item.get("genres")) or not ctx.profile_manager.is_item_kids_safe(probe_bkp):
            handler._send_json({"ok": False, "error": ctx.msg("Контент недоступен в детском профиле", "Content restricted in Kids Mode", req_lang)}, status=403)
            return True
    data = ctx.backup_stream_engine.search_releases(
        title=title,
        orig_title=orig_title,
        year=year,
        item_id=eff_item_id,
        rezka_url=rezka_url,
        media_type=media_type,
        season=season,
        episode=episode,
        stremio_engine=ctx.stremio_engine,
        lang=req_lang,
    )
    data["remux_available"] = ctx.remux_engine.is_available()
    if getattr(ctx.net_client, "local_media_proxy", False):
        fb_u = str(data.get("fallback_stream_url") or "").strip()
        if fb_u and ctx.is_allowed_media_source_url(fb_u, allow_torrserver_loopback=False):
            data["fallback_stream_url"] = ctx.wrap_voidboost_stream_url(fb_u)
        for rel in data.get("releases") or []:
            if rel.get("stream_kind") == "direct_http":
                su = str(rel.get("stream_url") or "").strip()
                if su and ctx.is_allowed_media_source_url(su, allow_torrserver_loopback=False):
                    rel["stream_url"] = ctx.wrap_voidboost_stream_url(su)
    handler._send_json(data)
    return True


def handle_integrations_post(handler: Any, qs: Dict[str, Any], parsed: Any, body: Dict[str, Any], ctx: Any) -> bool:
    if not handler._require_authorized_client_if_lan(body):
        return True
    if not handler._require_kids_pin_if_locked(str(body.get("pin") or body.get("current_pin") or "")):
        return True
    service_id = str(body.get("service_id", ""))
    logged_in = body.get("logged_in", None)
    if logged_in is not None:
        logged_in = bool(logged_in)
    enabled = body.get("enabled", None)
    if enabled is not None:
        enabled = bool(enabled)
    username = str(body.get("username", ""))
    updated = ctx.kinorium_service.set_service_login(
        service_id,
        logged_in=logged_in,
        username=username,
        enabled=enabled,
    )
    ctx.aggregator.invalidate_catalog_cache()
    handler._send_json({"ok": True, "integrations": updated})
    return True


def handle_debrid_resolve_post(handler: Any, qs: Dict[str, Any], parsed: Any, body: Dict[str, Any], ctx: Any) -> bool:
    req_lang = ctx.norm_app_lang(body.get("lang", ctx.app_prefs.get("app_lang", "ru")), ctx.app_prefs.get("app_lang", "ru"))
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True
    magnet = str(body.get("magnet") or "").strip()
    if ctx.profile_manager.is_kids_mode_active():
        dn_db = ctx.extract_magnet_display_name(magnet)
        cand_db = ctx.build_trusted_item_for_kids_check(
            item_id=str(body.get("id") or ""),
            title=str(body.get("title") or dn_db or ""),
            orig_title=str(body.get("orig_title") or ""),
            media_type=str(body.get("media_type") or "movie"),
        )
        probe_db = (
            cand_db
            if (cand_db.get("genres") or cand_db.get("description") or cand_db.get("age_rating"))
            else {**cand_db, "genres": ["семейный"]}
        )
        if not (cand_db.get("title") or cand_db.get("orig_title") or cand_db.get("genres")) or not ctx.profile_manager.is_item_kids_safe(probe_db):
            handler._send_json({"ok": False, "error": ctx.msg("Контент недоступен в детском профиле", "Content restricted in Kids Mode", req_lang)}, status=403)
            return True
    media_type = str(body.get("media_type") or "movie")
    season = max(1, ctx.safe_int(body.get("season"), 1))
    episode = max(1, ctx.safe_int(body.get("episode"), 1))
    provider = body.get("provider")
    handler._send_json(
        ctx.backup_stream_engine.resolve_debrid_magnet(
            magnet=magnet,
            media_type=media_type,
            season=season,
            episode=episode,
            provider=provider,
            lang=req_lang,
        )
    )
    return True


def handle_backup_streams_resolve_post(handler: Any, qs: Dict[str, Any], parsed: Any, body: Dict[str, Any], ctx: Any) -> bool:
    req_lang = ctx.norm_app_lang(body.get("lang", ctx.app_prefs.get("app_lang", "ru")), ctx.app_prefs.get("app_lang", "ru"))
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True
    magnet = str(body.get("magnet") or "").strip()
    if ctx.profile_manager.is_kids_mode_active():
        dn_bs = ctx.extract_magnet_display_name(magnet)
        cand_bs = ctx.build_trusted_item_for_kids_check(
            item_id=str(body.get("id") or ""),
            title=str(body.get("title") or body.get("filename_hint") or dn_bs or ""),
            orig_title=str(body.get("orig_title") or ""),
            media_type=str(body.get("media_type") or "movie"),
        )
        probe_bs = (
            cand_bs
            if (cand_bs.get("genres") or cand_bs.get("description") or cand_bs.get("age_rating"))
            else {**cand_bs, "genres": ["семейный"]}
        )
        if not (cand_bs.get("title") or cand_bs.get("orig_title") or cand_bs.get("genres")) or not ctx.profile_manager.is_item_kids_safe(probe_bs):
            handler._send_json({"ok": False, "error": ctx.msg("Контент недоступен в детском профиле", "Content restricted in Kids Mode", req_lang)}, status=403)
            return True
    media_type = str(body.get("media_type") or "movie")
    season = max(1, ctx.safe_int(body.get("season"), 1))
    episode = max(1, ctx.safe_int(body.get("episode"), 1))
    raw_fidx = body.get("file_index")
    file_index = ctx.safe_int(raw_fidx, 0) if raw_fidx is not None else 0
    filename_hint = str(body.get("filename_hint") or "").strip()
    handler._send_json(
        ctx.backup_stream_engine.resolve_torrserver_stream(
            magnet=magnet,
            media_type=media_type,
            season=season,
            episode=episode,
            file_index=file_index if file_index > 0 else None,
            filename_hint=filename_hint,
            lang=req_lang,
        )
    )
    return True


DEBRID_GET_ROUTES = {
    "/api/backup-streams": handle_backup_streams_get,
}

DEBRID_POST_ROUTES = {
    "/api/integrations": handle_integrations_post,
    "/api/debrid/resolve": handle_debrid_resolve_post,
    "/api/backup-streams/resolve": handle_backup_streams_resolve_post,
}
