"""
Velarium Kinorium Route Handlers
Dispatches /api/kinorium/* and /api/integrations requests.
"""

import re
import urllib.parse
from typing import Any, Dict


def _check_kinorium_kids_safe(handler, body: Dict[str, Any], ctx, path: str = "") -> bool:
    """
    Validates LAN authorization and Kids Mode content safety for mutating Kinorium routes.
    Returns True if allowed, or False if rejected (response already sent).
    """
    if not handler._require_authorized_client_if_lan(body):
        return False
    if path != "/api/kinorium/sync" and ctx.profile_manager.is_kids_mode_active():
        km_id = str(body.get("id") or "").strip()
        km_title = str(body.get("title") or "").strip()
        km_orig = str(body.get("orig_title") or "").strip()
        if km_id or km_title or km_orig:
            cand_km = ctx.build_trusted_item_for_kids_check(
                item_id=km_id,
                title=km_title,
                orig_title=km_orig,
                media_type=str(body.get("media_type") or ""),
            )
            probe_km = (
                cand_km
                if (cand_km.get("genres") or cand_km.get("description"))
                else {**cand_km, "genres": ["семейный"]}
            )
            if not ctx.profile_manager.is_item_kids_safe(probe_km):
                handler._send_json(
                    {
                        "ok": False,
                        "error": ctx.msg("Действие недоступно в детском профиле", "Restricted in Kids Mode"),
                    },
                    status=403,
                )
                return False
    return True


# ---------------------------------------------------------------------------
# GET Handlers
# ---------------------------------------------------------------------------

def handle_kinorium_avatar(handler, qs: Dict[str, Any], parsed, ctx) -> bool:
    uid_q = re.sub(r"\D+", "", qs.get("uid", [""])[0].strip())
    if not uid_q:
        acc_sum = ctx.kinorium_service.get_account_summary()
        uid_q = re.sub(r"\D+", "", str(acc_sum.get("user_id") or ""))
    cache_key = f"kin_avatar:{uid_q}" if uid_q else ""
    cached_hit = None
    if cache_key:
        with ctx.person_photo_lock:
            cached_hit = ctx.person_photo_cache.get(cache_key)
    if cached_hit:
        cached_ctype, cached_bytes = cached_hit
        handler.send_response(200)
        handler.send_header("Content-Type", cached_ctype)
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.send_header("Content-Security-Policy", "sandbox; default-src 'none'")
        handler.send_header("Content-Length", str(len(cached_bytes)))
        handler.send_header("Cache-Control", "public, max-age=3600")
        handler.end_headers()
        handler.wfile.write(cached_bytes)
        return True

    if uid_q:
        proxy_cfg = getattr(ctx.rezka_client, "proxy_url", None)
        for av_url in (
            f"https://images.kinorium.com/user/200/{uid_q}.jpg",
            f"https://images.kinorium.com/user/96/{uid_q}.jpg",
        ):
            try:
                with ctx.open_safe_public_url(
                    av_url,
                    headers={
                        "User-Agent": ctx.net_client.default_ua,
                        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                        "Referer": "https://ru.kinorium.com/",
                    },
                    timeout=4.0,
                    proxy_url=proxy_cfg,
                ) as resp:
                    raw_img = resp.read(524288)
                    sniff_ctype = ctx.sniff_raster_image_type(raw_img)
                    if resp.status == 200 and raw_img and sniff_ctype:
                        out_ctype = sniff_ctype
                        with ctx.person_photo_lock:
                            if len(ctx.person_photo_cache) > 350:
                                for k_old in list(ctx.person_photo_cache.keys())[:88]:
                                    ctx.person_photo_cache.pop(k_old, None)
                            ctx.person_photo_cache[cache_key] = (out_ctype, raw_img)
                        handler.send_response(200)
                        handler.send_header("Content-Type", out_ctype)
                        handler.send_header("X-Content-Type-Options", "nosniff")
                        handler.send_header("Content-Security-Policy", "sandbox; default-src 'none'")
                        handler.send_header("Content-Length", str(len(raw_img)))
                        handler.send_header("Cache-Control", "public, max-age=3600")
                        handler.end_headers()
                        handler.wfile.write(raw_img)
                        return True
            except Exception:
                continue

    acc_disp = str(ctx.kinorium_service.get_account_summary().get("display_name") or "CF")
    parts = [w for w in acc_disp.split() if w]
    initials = "".join(w[0].upper() for w in parts[:2]) or "CF"
    safe_initials = initials.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">'
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0%" stop-color="#0A84FF"/><stop offset="100%" stop-color="#0051D5"/>'
        '</linearGradient></defs>'
        '<rect width="120" height="120" rx="60" fill="url(#g)"/>'
        f'<text x="60" y="74" fill="#ffffff" font-family="-apple-system,sans-serif" '
        f'font-size="42" font-weight="700" text-anchor="middle">{safe_initials}</text></svg>'
    ).encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "image/svg+xml; charset=utf-8")
    handler.send_header("Content-Length", str(len(svg)))
    handler.send_header("Cache-Control", "public, max-age=300")
    handler.end_headers()
    handler.wfile.write(svg)
    return True


def handle_kinorium_live_digest(handler, qs: Dict[str, Any], parsed, ctx) -> bool:
    with ctx.kinorium_service._state_lock:
        raw_meta = ctx.kinorium_service.state.get("series_live_meta") or {}
        meta_snapshot = list(dict(raw_meta).values())
    seen_ids = set()
    updates_out = []
    kids_active_ld = ctx.profile_manager.is_kids_mode_active()
    for entry in meta_snapshot:
        if not isinstance(entry, dict) or entry.get("not_found"):
            continue
        dedup = str(entry.get("id") or entry.get("kinorium_id") or entry.get("title") or "")
        if not dedup or dedup in seen_ids:
            continue
        if kids_active_ld:
            cand_ld = ctx.build_trusted_item_for_kids_check(
                item_id=str(entry.get("id") or ""),
                title=str(entry.get("title") or ""),
                orig_title=str(entry.get("orig_title") or ""),
                media_type="series",
            )
            probe_ld = (
                cand_ld
                if (cand_ld.get("genres") or cand_ld.get("description") or cand_ld.get("age_rating"))
                else {**cand_ld, "genres": ["семейный"]}
            )
            if not ctx.profile_manager.is_item_kids_safe(probe_ld):
                continue
        seen_ids.add(dedup)
        updates_out.append(entry)
    handler._send_json(
        {
            "ok": True,
            "updates": updates_out,
            "kinorium_counts": ctx.kinorium_service.get_sections_counts(),
            "last_bg_sync_at": ctx.last_bg_watching_sync.get("ts", 0.0),
            "torrserver_connected": ctx.backup_stream_engine._is_torrserver_alive_cached(),
            "remux_available": ctx.remux_engine.is_available(),
        }
    )
    return True


def handle_kinorium_stats(handler, qs: Dict[str, Any], parsed, ctx) -> bool:
    stats_payload = ctx.kinorium_service.get_profile_stats()
    if ctx.profile_manager.is_kids_mode_active() and isinstance(stats_payload.get("top_favorites"), list):
        safe_favs = []
        for fav in stats_payload["top_favorites"]:
            if not isinstance(fav, dict):
                continue
            cand_fav = ctx.build_trusted_item_for_kids_check(
                item_id=str(fav.get("id") or ""),
                title=str(fav.get("title") or ""),
                orig_title=str(fav.get("orig_title") or ""),
                media_type=str(fav.get("media_type") or "movie"),
            )
            probe_fav = (
                cand_fav
                if (cand_fav.get("genres") or cand_fav.get("description") or cand_fav.get("age_rating"))
                else {**cand_fav, "genres": ["семейный"]}
            )
            if ctx.profile_manager.is_item_kids_safe(probe_fav):
                safe_favs.append(fav)
        stats_payload["top_favorites"] = safe_favs
    handler._send_json(stats_payload)
    return True


def handle_kinorium_one_click_status(handler, qs: Dict[str, Any], parsed, ctx) -> bool:
    handler._send_json(ctx.kinorium_auth_manager.get_status())
    return True


def handle_integrations(handler, qs: Dict[str, Any], parsed, ctx) -> bool:
    handler._send_json({"integrations": ctx.kinorium_service.get_integrations()})
    return True


# ---------------------------------------------------------------------------
# POST Handlers
# ---------------------------------------------------------------------------

def handle_kinorium_scrobble(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not _check_kinorium_kids_safe(handler, body, ctx, path="/api/kinorium/scrobble"):
        return True
    raw_comp = body.get("is_series_completed")
    sc_id = str(body.get("id") or "").strip()
    sc_title = str(body.get("title") or "").strip()
    sc_type = str(body.get("media_type") or "movie")
    sc_season = max(1, ctx.safe_int(body.get("season"), 1))
    sc_episode = max(1, ctx.safe_int(body.get("episode"), 1))
    sc_source = str(body.get("source") or "HDRezka")
    res = ctx.kinorium_service.update_progress_and_scrobble(
        item_id=sc_id,
        title=sc_title,
        orig_title=str(body.get("orig_title", "")),
        poster=str(body.get("poster", "")),
        backdrop=str(body.get("backdrop", "")),
        media_type=sc_type,
        season=sc_season,
        episode=sc_episode,
        current_time=ctx.safe_float(body.get("current_time"), 0.0),
        duration=ctx.safe_float(body.get("duration"), 1.0),
        source=sc_source,
        studio=str(body.get("studio", "HDRezka Studio")),
        total_seasons=max(0, ctx.safe_int(body.get("total_seasons"), 1)),
        total_episodes_in_season=max(0, ctx.safe_int(body.get("total_episodes_in_season"), 1)),
        is_series_completed=bool(raw_comp) if isinstance(raw_comp, bool) else None,
        force_watched=bool(body.get("force_watched", False)),
        reason=str(body.get("reason") or ""),
    )
    if res.get("just_scrobbled") or res.get("just_scrobbled_episode") or res.get("auto_scrobbled") or body.get("force_watched"):
        try:
            dl_hook = ctx.download_manager.handle_watched_scrobble(
                item_id=sc_id,
                kinorium_id=str(body.get("kinorium_id") or res.get("kinorium_id") or ""),
                rezka_id=str(body.get("rezka_id") or ""),
                title=sc_title,
                media_type=sc_type,
                season=sc_season,
                episode=sc_episode,
                is_active_offline_playback=(sc_source.lower() == "offline" or bool(body.get("is_offline"))),
                active_download_id=str(body.get("download_id") or ""),
                lang=ctx.app_prefs.get("app_lang", "ru"),
                profile_id=ctx.profile_manager.get_active_profile_id(),
            )
            res["offline_hook"] = dl_hook
            res["offline_automation"] = dl_hook
        except Exception:
            pass
        ctx.aggregator.invalidate_catalog_cache()
    handler._send_json(res)
    return True


def handle_kinorium_rate_episode(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not _check_kinorium_kids_safe(handler, body, ctx, path="/api/kinorium/rate-episode"):
        return True
    raw_comp = body.get("is_series_completed")
    raw_score = 0 if body.get("clear") else ctx.safe_int(body.get("score"), 8)
    score_val = 0 if raw_score <= 0 else max(1, min(10, raw_score))
    res = ctx.kinorium_service.set_episode_rating(
        item_id=str(body.get("id", "")),
        title=str(body.get("title", "")),
        season=max(1, ctx.safe_int(body.get("season"), 1)),
        episode=max(1, ctx.safe_int(body.get("episode"), 1)),
        score=score_val,
        comment=str(body.get("comment", "")),
        orig_title=str(body.get("orig_title", "")),
        episode_title=str(body.get("episode_title", "")),
        total_seasons=max(0, ctx.safe_int(body.get("total_seasons"), 0)),
        total_episodes_in_season=max(0, ctx.safe_int(body.get("total_episodes_in_season"), 0)),
        is_series_completed=bool(raw_comp) if isinstance(raw_comp, bool) else None,
        poster=body.get("poster"),
        backdrop=body.get("backdrop"),
        year=body.get("year"),
        rezka_id=body.get("rezka_id"),
        rezka_url=body.get("rezka_url"),
    )
    ctx.aggregator.invalidate_catalog_cache()
    handler._send_json(res)
    return True


def handle_kinorium_rate(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if body.get("scope") == "episode":
        return handle_kinorium_rate_episode(handler, qs, parsed, body, ctx)
    if not _check_kinorium_kids_safe(handler, body, ctx, path="/api/kinorium/rate"):
        return True
    raw_comp = body.get("is_series_completed")
    raw_score = 0 if body.get("clear") else ctx.safe_int(body.get("score"), 8)
    score_val = 0 if raw_score <= 0 else max(1, min(10, raw_score))
    res = ctx.kinorium_service.set_rating(
        item_id=str(body.get("id", "")),
        title=str(body.get("title", "")),
        score=score_val,
        comment=str(body.get("comment", "")),
        orig_title=str(body.get("orig_title", "")),
        is_series_completed=bool(raw_comp) if isinstance(raw_comp, bool) else None,
        poster=body.get("poster"),
        backdrop=body.get("backdrop"),
        year=body.get("year"),
        media_type=body.get("media_type"),
        rezka_id=body.get("rezka_id"),
        rezka_url=body.get("rezka_url"),
    )
    ctx.aggregator.invalidate_catalog_cache()
    handler._send_json(res)
    return True


def handle_kinorium_watched(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not _check_kinorium_kids_safe(handler, body, ctx, path="/api/kinorium/watched"):
        return True
    w_flag = bool(body.get("watched", True))
    res = ctx.kinorium_service.mark_watched(
        item_id=str(body.get("id", "")),
        title=str(body.get("title", "")),
        orig_title=str(body.get("orig_title", "")),
        watched=w_flag,
        season=body.get("season"),
        episode=body.get("episode"),
        poster=body.get("poster"),
        backdrop=body.get("backdrop"),
        year=body.get("year"),
        media_type=body.get("media_type"),
        rezka_id=body.get("rezka_id"),
        rezka_url=body.get("rezka_url"),
    )
    if w_flag:
        try:
            ctx.download_manager.handle_watched_scrobble(
                item_id=str(body.get("id") or ""),
                kinorium_id=str(body.get("kinorium_id") or res.get("kinorium_id") or ""),
                rezka_id=str(body.get("rezka_id") or ""),
                title=str(body.get("title") or ""),
                media_type=str(body.get("media_type") or "movie"),
                season=max(1, ctx.safe_int(body.get("season"), 1)),
                episode=max(1, ctx.safe_int(body.get("episode"), 1)),
                is_active_offline_playback=bool(body.get("is_offline")),
                active_download_id=str(body.get("download_id") or ""),
                lang=ctx.app_prefs.get("app_lang", "ru"),
                profile_id=ctx.profile_manager.get_active_profile_id(),
            )
        except Exception:
            pass
    ctx.aggregator.invalidate_catalog_cache()
    handler._send_json(res)
    return True


def handle_kinorium_episode_watched(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not _check_kinorium_kids_safe(handler, body, ctx, path="/api/kinorium/episode-watched"):
        return True
    raw_comp = body.get("is_series_completed")
    watched_arg = body.get("watched")
    ep_s = max(1, ctx.safe_int(body.get("season"), 1))
    ep_e = max(1, ctx.safe_int(body.get("episode"), 1))
    res = ctx.kinorium_service.toggle_episode_watched(
        item_id=str(body.get("id", "")),
        title=str(body.get("title", "")),
        orig_title=str(body.get("orig_title", "")),
        season=ep_s,
        episode=ep_e,
        watched=bool(watched_arg) if isinstance(watched_arg, bool) else None,
        total_seasons=max(0, ctx.safe_int(body.get("total_seasons"), 0)),
        total_episodes_in_season=max(0, ctx.safe_int(body.get("total_episodes_in_season"), 0)),
        is_series_completed=bool(raw_comp) if isinstance(raw_comp, bool) else None,
        poster=body.get("poster"),
        backdrop=body.get("backdrop"),
        year=body.get("year"),
        media_type=body.get("media_type") or "series",
        rezka_id=body.get("rezka_id"),
        rezka_url=body.get("rezka_url"),
    )
    if res.get("episode_watched"):
        try:
            ctx.download_manager.handle_watched_scrobble(
                item_id=str(body.get("id") or ""),
                kinorium_id=str(body.get("kinorium_id") or res.get("kinorium_id") or ""),
                rezka_id=str(body.get("rezka_id") or ""),
                title=str(body.get("title") or ""),
                media_type="series",
                season=ep_s,
                episode=ep_e,
                is_active_offline_playback=bool(body.get("is_offline")),
                active_download_id=str(body.get("download_id") or ""),
                lang=ctx.app_prefs.get("app_lang", "ru"),
                profile_id=ctx.profile_manager.get_active_profile_id(),
            )
        except Exception:
            pass
    ctx.aggregator.invalidate_catalog_cache()
    handler._send_json(res)
    return True


def handle_kinorium_watched_episodes_batch(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not _check_kinorium_kids_safe(handler, body, ctx, path="/api/kinorium/watched-episodes-batch"):
        return True
    raw_comp = body.get("is_series_completed")
    res = ctx.kinorium_service.mark_episodes_batch(
        item_id=str(body.get("id", "")),
        title=str(body.get("title", "")),
        orig_title=str(body.get("orig_title", "")),
        season=max(1, ctx.safe_int(body.get("season"), 1)),
        episodes=body.get("episodes") or [],
        mark_season_complete=bool(body.get("mark_season_complete", False)),
        total_seasons=max(0, ctx.safe_int(body.get("total_seasons"), 0)),
        total_episodes_in_season=max(0, ctx.safe_int(body.get("total_episodes_in_season"), 0)),
        is_series_completed=bool(raw_comp) if isinstance(raw_comp, bool) else None,
        poster=body.get("poster"),
        backdrop=body.get("backdrop"),
        year=body.get("year"),
        media_type=body.get("media_type") or "series",
        rezka_id=body.get("rezka_id"),
        rezka_url=body.get("rezka_url"),
    )
    ctx.aggregator.invalidate_catalog_cache()
    handler._send_json(res)
    return True


def handle_kinorium_watchlist(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not _check_kinorium_kids_safe(handler, body, ctx, path="/api/kinorium/watchlist"):
        return True
    res = ctx.kinorium_service.toggle_watchlist(
        item_id=str(body.get("id", "")),
        title=str(body.get("title", "")),
        orig_title=str(body.get("orig_title", "")),
        poster=body.get("poster"),
        backdrop=body.get("backdrop"),
        year=body.get("year"),
        media_type=body.get("media_type"),
        rezka_id=body.get("rezka_id"),
        rezka_url=body.get("rezka_url"),
    )
    ctx.aggregator.invalidate_catalog_cache()
    handler._send_json(res)
    return True


def handle_kinorium_watching(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not _check_kinorium_kids_safe(handler, body, ctx, path="/api/kinorium/watching"):
        return True
    res = ctx.kinorium_service.toggle_watching(
        item_id=str(body.get("id", "")),
        title=str(body.get("title", "")),
        orig_title=str(body.get("orig_title", "")),
        poster=body.get("poster"),
        backdrop=body.get("backdrop"),
        year=body.get("year"),
        media_type=body.get("media_type"),
        rezka_id=body.get("rezka_id"),
        rezka_url=body.get("rezka_url"),
    )
    ctx.aggregator.invalidate_catalog_cache()
    handler._send_json(res)
    return True


def handle_kinorium_never(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not _check_kinorium_kids_safe(handler, body, ctx, path="/api/kinorium/never"):
        return True
    res = ctx.kinorium_service.toggle_not_watching(
        item_id=str(body.get("id", "")),
        title=str(body.get("title", "")),
        orig_title=str(body.get("orig_title", "")),
        poster=body.get("poster"),
        backdrop=body.get("backdrop"),
        year=body.get("year"),
        media_type=body.get("media_type"),
        rezka_id=body.get("rezka_id"),
        rezka_url=body.get("rezka_url"),
    )
    ctx.aggregator.invalidate_catalog_cache()
    handler._send_json(res)
    return True


def handle_kinorium_continue_watching_remove(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not _check_kinorium_kids_safe(handler, body, ctx, path="/api/kinorium/continue-watching/remove"):
        return True
    res = ctx.kinorium_service.dismiss_continue_watching(
        item_id=str(body.get("id", "")),
        title=str(body.get("title", "")),
    )
    if isinstance(res, dict):
        res["kinorium_counts"] = ctx.kinorium_service.get_sections_counts()
    ctx.aggregator.invalidate_catalog_cache()
    handler._send_json(res)
    return True


def handle_kinorium_continue_watching_restore(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not _check_kinorium_kids_safe(handler, body, ctx, path="/api/kinorium/continue-watching/restore"):
        return True
    res = ctx.kinorium_service.restore_continue_watching(
        item_id=str(body.get("id", "")),
        title=str(body.get("title", "")),
        restore_all=bool(body.get("restore_all", False)),
    )
    if isinstance(res, dict):
        res["kinorium_counts"] = ctx.kinorium_service.get_sections_counts()
    ctx.aggregator.invalidate_catalog_cache()
    handler._send_json(res)
    return True


def handle_kinorium_sync(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    is_local = handler._is_loopback_client()
    if not is_local and (body.get("user_id") or body.get("profile_url") or body.get("session_cookie")):
        if not handler._require_authorized_client_if_lan(body):
            return True
    with ctx.kinorium_service._state_lock:
        cur_uid = str((ctx.kinorium_service.state.get("account") or {}).get("user_id") or "")
    explicit_target = str(body.get("user_id") or body.get("profile_url") or "").strip()
    has_mutating_sync = bool((explicit_target and explicit_target != cur_uid) or body.get("session_cookie"))
    if has_mutating_sync and not handler._require_kids_pin_if_locked(
        str(body.get("pin") or body.get("current_pin") or "")
    ):
        return True
    user_input = str(body.get("user_id") or body.get("profile_url") or cur_uid or "")
    session_cookie = body.get("session_cookie") if is_local else None
    try:
        sync_info = ctx.kinorium_service.sync_user_profile(user_input, session_cookie=session_cookie)
        ctx.aggregator.invalidate_catalog_cache()
        handler._send_json(
            {
                "ok": bool(sync_info.get("synced", True)),
                "sync": sync_info,
                "kinorium_account": ctx.kinorium_service.get_account_summary(),
                "integrations": ctx.kinorium_service.get_integrations(),
            }
        )
    except Exception as exc:
        handler._send_json(
            {
                "ok": False,
                "sync": {"synced": False, "error": str(exc)},
                "kinorium_account": ctx.kinorium_service.get_account_summary(),
                "integrations": ctx.kinorium_service.get_integrations(),
            },
            status=200,
        )
    return True


def handle_kinorium_disconnect(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not handler._is_loopback_client():
        handler._send_json(
            {
                "ok": False,
                "error": ctx.msg(
                    "Отключение профиля разрешено только на основном компьютере",
                    "Disconnecting a profile is only allowed on the host computer",
                ),
            },
            status=403,
        )
        return True
    if not handler._require_kids_pin_if_locked(str(body.get("pin") or body.get("current_pin") or "")):
        return True
    acc = ctx.kinorium_service.disconnect_user_profile()
    ctx.aggregator.invalidate_catalog_cache()
    handler._send_json(
        {
            "ok": True,
            "kinorium_account": acc,
            "integrations": ctx.kinorium_service.get_integrations(),
        }
    )
    return True


def handle_kinorium_one_click_login(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not handler._is_loopback_client():
        handler._send_json(
            {
                "ok": False,
                "error": ctx.msg(
                    "Авторизация в один клик доступна только на основном компьютере",
                    "One-click sign-in is only available on the host computer",
                ),
            },
            status=403,
        )
        return True
    req_lang = ctx.norm_app_lang(body.get("lang", ctx.app_prefs.get("app_lang", "ru")), ctx.app_prefs.get("app_lang", "ru"))
    if not handler._require_kids_pin_if_locked(
        str(body.get("pin") or body.get("current_pin") or ""),
        lang=req_lang,
    ):
        return True
    res = ctx.kinorium_auth_manager.start_interactive_login(lang=req_lang)
    handler._send_json(res, status=200 if res.get("ok") else 400)
    return True


def handle_kinorium_one_click_cancel(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not handler._is_loopback_client():
        handler._send_json({"ok": False, "error": "Forbidden"}, status=403)
        return True
    if not handler._require_kids_pin_if_locked(str(body.get("pin") or body.get("current_pin") or "")):
        return True
    handler._send_json({"ok": True, **ctx.kinorium_auth_manager.cancel()})
    return True


def handle_kinorium_one_click_complete(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not handler._is_loopback_client():
        handler._send_json({"ok": False, "error": "Forbidden"}, status=403)
        return True
    if not handler._require_kids_pin_if_locked(str(body.get("pin") or body.get("current_pin") or "")):
        return True
    res = ctx.kinorium_auth_manager.complete_with_captured_session(
        user_id=str(body.get("user_id") or ""),
        session_cookie=str(body.get("session_cookie") or body.get("cookie") or ""),
        display_name_hint=str(body.get("display_name") or ""),
    )
    handler._send_json(res, status=200 if res.get("ok") else 400)
    return True
