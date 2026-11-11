"""
Velarium Downloads & Offline Media Route Handlers
Dispatches /api/downloads and /api/downloads/* JSON API requests.
"""

import urllib.parse
from typing import Any, Dict, Optional


def handle_downloads_get(handler, qs: Dict[str, Any], parsed, ctx) -> bool:
    prof_filter = qs.get("profile_id", ["all"])[0]
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(qs.get("lang", [app_lang])[0], app_lang)
    handler._send_json(
        ctx.download_manager.get_downloads_payload(
            profile_id=prof_filter,
            kids_mode=ctx.profile_manager.is_kids_mode_active(),
            active_profile_id=ctx.profile_manager.get_active_profile_id(),
            lang=req_lang,
        )
    )
    return True


def handle_downloads_prefs_get(handler, qs: Dict[str, Any], parsed, ctx) -> bool:
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(qs.get("lang", [app_lang])[0], app_lang)
    if not handler._require_authorized_client_if_lan(lang=req_lang):
        return True
    handler._send_json({"ok": True, "prefs": ctx.download_manager.get_prefs()})
    return True


def handle_downloads_start(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True

    raw_stream = str(body.get("stream_url") or "").strip()
    is_remux_src = bool(body.get("is_remux_source", False))
    audio_idx = max(0, ctx.safe_int(body.get("audio_index"), 0))
    vcodec = str(body.get("video_codec") or "").strip()
    acodec = str(body.get("audio_codec") or "").strip()
    channels = max(1, ctx.safe_int(body.get("channels"), 2))
    port_num = int(ctx.server_runtime.get("port") or 8765)

    if "/api/remux-stream" in raw_stream:
        qs_rmx = urllib.parse.parse_qs(urllib.parse.urlparse(raw_stream).query)
        src_inner = (qs_rmx.get("src") or [""])[0].strip()
        if not ctx.is_allowed_media_source_url(src_inner, allow_torrserver_loopback=True):
            handler._send_json(
                {"ok": False, "error": ctx.msg("Недопустимая ссылка источника ремукса", "Invalid remux source URL")},
                status=400,
            )
            return True
        raw_stream = src_inner
        is_remux_src = True
        audio_idx = max(0, ctx.qs_int(qs_rmx, "audio", audio_idx))
        vcodec = (qs_rmx.get("vcodec") or [vcodec])[0].strip()
        acodec = (qs_rmx.get("acodec") or [acodec])[0].strip()
        channels = max(1, ctx.qs_int(qs_rmx, "ch", channels))
    elif raw_stream.startswith("/api/proxy-stream"):
        unwrapped = ctx.unwrap_local_proxy_media_url(raw_stream)
        if not ctx.is_allowed_media_source_url(unwrapped, allow_torrserver_loopback=False):
            handler._send_json(
                {"ok": False, "error": ctx.msg("Недопустимая ссылка прокси-потока", "Invalid proxy stream URL")},
                status=400,
            )
            return True
        raw_stream = (
            f"http://127.0.0.1:{port_num}{raw_stream}"
            if ctx.server_runtime.get("running")
            else unwrapped
        )
    else:
        unwrapped = ctx.unwrap_local_proxy_media_url(raw_stream)
        if not ctx.is_allowed_media_source_url(unwrapped, allow_torrserver_loopback=True):
            handler._send_json(
                {
                    "ok": False,
                    "error": ctx.msg(
                        "Недопустимая ссылка потока для офлайн-загрузки",
                        "Invalid stream URL for offline download",
                    ),
                },
                status=400,
            )
            return True
        raw_stream = unwrapped

    is_kids_safe_item: Optional[bool] = None
    eff_dl_genres = body.get("genres") if isinstance(body.get("genres"), list) else []
    eff_dl_age = str(body.get("age_rating") or "")
    if not eff_dl_genres or not eff_dl_age or ctx.profile_manager.is_kids_mode_active():
        cand_dl_item = ctx.build_trusted_item_for_kids_check(
            item_id=str(body.get("id") or body.get("item_id") or ""),
            title=str(body.get("title") or ""),
            orig_title=str(body.get("orig_title") or ""),
            media_type=str(body.get("media_type") or "movie"),
        )
        if not eff_dl_genres and cand_dl_item.get("genres"):
            eff_dl_genres = list(cand_dl_item.get("genres") or [])
        if not eff_dl_age and cand_dl_item.get("age_rating"):
            eff_dl_age = str(cand_dl_item.get("age_rating") or "")
        if ctx.profile_manager.is_kids_mode_active():
            has_trusted_meta = bool(
                cand_dl_item.get("genres") or cand_dl_item.get("description") or cand_dl_item.get("age_rating")
            )
            probe_dl = cand_dl_item if has_trusted_meta else {**cand_dl_item, "genres": ["семейный"]}
            if not (cand_dl_item.get("title") or cand_dl_item.get("orig_title") or cand_dl_item.get("genres")) or not ctx.profile_manager.is_item_kids_safe(probe_dl):
                handler._send_json(
                    {"ok": False, "error": ctx.msg("Загрузка недоступна в Детском профиле", "Download restricted in Kids profile", req_lang)},
                    status=403,
                )
                return True
            eff_dl_genres = list(cand_dl_item.get("genres") or [])
            eff_dl_age = str(cand_dl_item.get("age_rating") or "")
            is_kids_safe_item = True if has_trusted_meta else None

    try:
        item_entry = ctx.download_manager.enqueue_download(
            item_id=str(body.get("id") or body.get("item_id") or ""),
            kinorium_id=str(body.get("kinorium_id") or ""),
            rezka_id=str(body.get("rezka_id") or ""),
            rezka_url=str(body.get("rezka_url") or ""),
            title=str(body.get("title") or "Видео"),
            orig_title=str(body.get("orig_title") or ""),
            year=body.get("year") or "",
            media_type=str(body.get("media_type") or "movie"),
            season=max(1, ctx.safe_int(body.get("season"), 1)),
            episode=max(1, ctx.safe_int(body.get("episode"), 1)),
            episode_title=str(body.get("episode_title") or ""),
            poster=str(body.get("poster") or ""),
            backdrop=str(body.get("backdrop") or ""),
            stream_url=raw_stream,
            quality=str(body.get("quality") or "1080p"),
            studio=str(body.get("studio") or "HDRezka"),
            translator_id=str(body.get("translator_id") or ""),
            source_tab=str(body.get("source_tab") or "hdrezka"),
            is_remux_source=is_remux_src,
            audio_index=audio_idx,
            video_codec=vcodec,
            audio_codec=acodec,
            channels=channels,
            duration_sec=ctx.safe_float(body.get("duration"), 0.0),
            subtitles=body.get("subtitles") if isinstance(body.get("subtitles"), list) else [],
            profile_id=ctx.profile_manager.get_active_profile_id(),
            genres=eff_dl_genres,
            age_rating=eff_dl_age,
            kids_safe=is_kids_safe_item,
            max_season_episode=max(0, ctx.safe_int(body.get("max_season_episode"), 0)),
            lang=req_lang,
        )
        handler._send_json(
            {
                "ok": True,
                "item": item_entry,
                "downloads": ctx.download_manager.get_downloads_payload(
                    kids_mode=ctx.profile_manager.is_kids_mode_active(),
                    active_profile_id=ctx.profile_manager.get_active_profile_id(),
                    lang=req_lang,
                ),
            }
        )
    except Exception as exc:
        handler._send_json({"ok": False, "error": str(exc)}, status=400)
    return True


def handle_downloads_cancel(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True
    did = str(body.get("download_id") or body.get("id") or "").strip()
    if ctx.profile_manager.is_kids_mode_active() and not ctx.download_manager.is_download_allowed(
        did,
        kids_mode=True,
        active_profile_id=ctx.profile_manager.get_active_profile_id(),
    ):
        handler._send_json(
            {"ok": False, "error": ctx.msg("Недоступно в Детском профиле", "Restricted in Kids profile", req_lang)},
            status=403,
        )
        return True
    ctx.download_manager.cancel_download(did)
    handler._send_json(
        {
            "ok": True,
            "downloads": ctx.download_manager.get_downloads_payload(
                kids_mode=ctx.profile_manager.is_kids_mode_active(),
                active_profile_id=ctx.profile_manager.get_active_profile_id(),
                lang=req_lang,
            ),
        }
    )
    return True


def handle_downloads_retry(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True
    did = str(body.get("download_id") or body.get("id") or "").strip()
    if ctx.profile_manager.is_kids_mode_active() and not ctx.download_manager.is_download_allowed(
        did,
        kids_mode=True,
        active_profile_id=ctx.profile_manager.get_active_profile_id(),
    ):
        handler._send_json(
            {"ok": False, "error": ctx.msg("Недоступно в Детском профиле", "Restricted in Kids profile", req_lang)},
            status=403,
        )
        return True
    res = ctx.download_manager.retry_download(did, lang=req_lang)
    handler._send_json(res, status=200 if res.get("ok") else 400)
    return True


def handle_downloads_delete(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True
    did = str(body.get("download_id") or body.get("id") or "").strip()
    if ctx.profile_manager.is_kids_mode_active() and not ctx.download_manager.is_download_allowed(
        did,
        kids_mode=True,
        active_profile_id=ctx.profile_manager.get_active_profile_id(),
    ):
        handler._send_json(
            {"ok": False, "error": ctx.msg("Недоступно в Детском профиле", "Restricted in Kids profile", req_lang)},
            status=403,
        )
        return True
    deleted = ctx.download_manager.delete_download(did)
    handler._send_json(
        {
            "ok": True,
            "deleted": deleted,
            "downloads": ctx.download_manager.get_downloads_payload(
                kids_mode=ctx.profile_manager.is_kids_mode_active(),
                active_profile_id=ctx.profile_manager.get_active_profile_id(),
                lang=req_lang,
            ),
        }
    )
    return True


def handle_downloads_open_folder(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not handler._is_loopback_client():
        handler._send_json(
            {
                "ok": False,
                "error": ctx.msg(
                    "Открытие папки доступно только на основном компьютере",
                    "Opening the downloads folder is only available on the host computer",
                ),
            },
            status=403,
        )
        return True
    if not handler._require_kids_pin_if_locked(str(body.get("pin") or body.get("current_pin") or "")):
        return True
    did = str(body.get("download_id") or body.get("id") or "").strip()
    if ctx.profile_manager.is_kids_mode_active() and did and not ctx.download_manager.is_download_allowed(
        did,
        kids_mode=True,
        active_profile_id=ctx.profile_manager.get_active_profile_id(),
    ):
        handler._send_json({"ok": False, "error": "Restricted in Kids Mode"}, status=403)
        return True
    res = ctx.download_manager.reveal_in_file_manager(did)
    handler._send_json(res)
    return True


def handle_downloads_batch(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True
    is_kids_safe_batch: Optional[bool] = None
    eff_batch_genres = body.get("genres") if isinstance(body.get("genres"), list) else []
    eff_batch_age = str(body.get("age_rating") or "")
    if not eff_batch_genres or not eff_batch_age or ctx.profile_manager.is_kids_mode_active():
        cand_batch_item = ctx.build_trusted_item_for_kids_check(
            item_id=str(body.get("id") or body.get("item_id") or ""),
            title=str(body.get("title") or ""),
            orig_title=str(body.get("orig_title") or ""),
            media_type="series",
        )
        if not eff_batch_genres and cand_batch_item.get("genres"):
            eff_batch_genres = list(cand_batch_item.get("genres") or [])
        if not eff_batch_age and cand_batch_item.get("age_rating"):
            eff_batch_age = str(cand_batch_item.get("age_rating") or "")
        if ctx.profile_manager.is_kids_mode_active():
            has_trusted_b = bool(
                cand_batch_item.get("genres") or cand_batch_item.get("description") or cand_batch_item.get("age_rating")
            )
            probe_batch = cand_batch_item if has_trusted_b else {**cand_batch_item, "genres": ["семейный"]}
            if not (cand_batch_item.get("title") or cand_batch_item.get("orig_title") or cand_batch_item.get("genres")) or not ctx.profile_manager.is_item_kids_safe(probe_batch):
                handler._send_json(
                    {"ok": False, "error": ctx.msg("Загрузка недоступна в Детском профиле", "Download restricted in Kids profile", req_lang)},
                    status=403,
                )
                return True
            eff_batch_genres = list(cand_batch_item.get("genres") or [])
            eff_batch_age = str(cand_batch_item.get("age_rating") or "")
            is_kids_safe_batch = True if has_trusted_b else None
    try:
        batch_res = ctx.download_manager.enqueue_batch_series(
            item_id=str(body.get("id") or body.get("item_id") or ""),
            kinorium_id=str(body.get("kinorium_id") or ""),
            rezka_id=str(body.get("rezka_id") or ""),
            rezka_url=str(body.get("rezka_url") or ""),
            title=str(body.get("title") or "Сериал"),
            orig_title=str(body.get("orig_title") or ""),
            year=body.get("year") or "",
            season=max(1, ctx.safe_int(body.get("season"), 1)),
            episodes=body.get("episodes") if isinstance(body.get("episodes"), list) else [],
            episode_titles=body.get("episode_titles") if isinstance(body.get("episode_titles"), dict) else {},
            poster=str(body.get("poster") or ""),
            backdrop=str(body.get("backdrop") or ""),
            quality=str(body.get("quality") or "1080p"),
            studio=str(body.get("studio") or "HDRezka"),
            translator_id=str(body.get("translator_id") or ""),
            source_tab=str(body.get("source_tab") or "hdrezka"),
            profile_id=ctx.profile_manager.get_active_profile_id(),
            genres=eff_batch_genres,
            age_rating=eff_batch_age,
            kids_safe=is_kids_safe_batch,
            max_season_episode=max(0, ctx.safe_int(body.get("max_season_episode"), 0)),
            lang=req_lang,
        )
        handler._send_json(
            {
                **batch_res,
                "downloads": ctx.download_manager.get_downloads_payload(
                    kids_mode=ctx.profile_manager.is_kids_mode_active(),
                    active_profile_id=ctx.profile_manager.get_active_profile_id(),
                    lang=req_lang,
                ),
            }
        )
    except Exception as exc:
        handler._send_json({"ok": False, "error": str(exc)}, status=400)
    return True


def handle_downloads_prefs_post(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True
    if not handler._require_kids_pin_if_locked(str(body.get("pin") or ""), lang=req_lang):
        return True
    upd_prefs = ctx.download_manager.set_prefs(
        auto_cleanup_watched=(
            bool(body.get("auto_cleanup_watched"))
            if "auto_cleanup_watched" in body
            else None
        ),
        auto_download_next=(
            bool(body.get("auto_download_next"))
            if "auto_download_next" in body
            else None
        ),
    )
    handler._send_json({"ok": True, "prefs": upd_prefs})
    return True


def handle_downloads_cleanup_pending(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    if not handler._require_authorized_client_if_lan(body):
        return True
    if ctx.profile_manager.is_kids_mode_active():
        handler._send_json({"ok": True, "deleted_count": 0, "deleted_ids": []})
        return True
    excl_id = str(body.get("exclude_download_id") or "").strip()
    res_cl = ctx.download_manager.sweep_pending_cleanups(exclude_download_id=excl_id)
    handler._send_json(res_cl)
    return True


def handle_downloads_season_status(handler, qs: Dict[str, Any], parsed, ctx) -> bool:
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(qs.get("lang", [app_lang])[0], app_lang)
    item_id = qs.get("id", [qs.get("item_id", [""])[0]])[0]
    kinorium_id = qs.get("kinorium_id", [""])[0]
    rezka_id = qs.get("rezka_id", [""])[0]
    title = qs.get("title", [""])[0]
    raw_season = qs.get("season", [qs.get("season_num", ["1"])[0]])[0]
    season = max(1, ctx.safe_int(raw_season, 1))
    res = ctx.download_manager.get_season_download_status(
        item_id=str(item_id or ""),
        kinorium_id=str(kinorium_id or ""),
        rezka_id=str(rezka_id or ""),
        title=str(title or ""),
        season=season,
        kids_mode=ctx.profile_manager.is_kids_mode_active(),
        active_profile_id=ctx.profile_manager.get_active_profile_id(),
        lang=req_lang,
    )
    handler._send_json(res)
    return True


def handle_downloads_delete_season(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True
    if not handler._require_kids_pin_if_locked(str(body.get("pin") or ""), lang=req_lang):
        return True
    season = max(1, ctx.safe_int(body.get("season") or body.get("season_num"), 1))
    res = ctx.download_manager.delete_season_downloads(
        item_id=str(body.get("id") or body.get("item_id") or ""),
        kinorium_id=str(body.get("kinorium_id") or ""),
        rezka_id=str(body.get("rezka_id") or ""),
        title=str(body.get("title") or ""),
        season=season,
        kids_mode=ctx.profile_manager.is_kids_mode_active(),
        active_profile_id=ctx.profile_manager.get_active_profile_id(),
    )
    handler._send_json(
        {
            **res,
            "downloads": ctx.download_manager.get_downloads_payload(
                kids_mode=ctx.profile_manager.is_kids_mode_active(),
                active_profile_id=ctx.profile_manager.get_active_profile_id(),
                lang=req_lang,
            ),
        }
    )
    return True

