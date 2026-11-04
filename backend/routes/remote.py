"""
Modular route handlers for DLNA / Smart TV and Mobile Remote Control endpoints:
- GET /api/tv/devices
- GET /api/tv/deep-link
- GET /api/remote/pairing
- GET /api/remote/state
- GET /api/remote/commands
- GET /api/remote/catalog
- POST /api/tv/cast
- POST /api/tv/stop
- POST /api/remote/pair
- POST /api/remote/state
- POST /api/remote/native-fullscreen
- POST /api/remote/native-pip
- POST /api/remote/command
"""

from __future__ import annotations

import re
from typing import Any, Dict


def handle_tv_devices(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> None:
    is_local_tv = handler._is_loopback_client()
    has_tv_auth = is_local_tv or ctx.remote_broker.verify_key(qs.get("k", [""])[0].strip())
    force_scan = (
        qs.get("force", ["0"])[0].strip().lower() in ("1", "true", "yes")
        and has_tv_auth
    )
    item_id = qs.get("id", [""])[0].strip()
    season = ctx.qs_int(qs, "season", 0)
    episode = ctx.qs_int(qs, "episode", 0)
    item_title = qs.get("title", [""])[0].strip()
    if item_id and item_title and has_tv_auth:
        raw_genres = [
            g.strip()
            for g in qs.get("genres", [""])[0].split(",")
            if g.strip()
        ]
        orig_t_tv = qs.get("orig_title", [""])[0].strip()
        mtype_tv = qs.get("media_type", ["movie"])[0].strip()
        age_tv = qs.get("age_rating", [""])[0].strip()
        if ctx.profile_manager.is_kids_mode_active():
            trusted_tv = ctx.build_trusted_item_for_kids_check(
                item_id=item_id,
                title=item_title,
                orig_title=orig_t_tv,
                media_type=mtype_tv,
            )
            eff_genres_tv = list(trusted_tv.get("genres") or [])
            eff_age_tv = str(trusted_tv.get("age_rating") or age_tv)
        else:
            eff_genres_tv = raw_genres
            eff_age_tv = age_tv
        ctx.dlna_manager.register_deep_link_item(
            item_id,
            {
                "id": item_id,
                "kinorium_id": qs.get("kinorium_id", [""])[0].strip(),
                "rezka_id": qs.get("rezka_id", [""])[0].strip(),
                "rezka_url": qs.get("rezka_url", [""])[0].strip(),
                "title": item_title,
                "orig_title": orig_t_tv,
                "year": qs.get("year", [""])[0].strip(),
                "media_type": mtype_tv,
                "poster": qs.get("poster", [""])[0].strip(),
                "backdrop": qs.get("backdrop", [""])[0].strip(),
                "genres": eff_genres_tv,
                "age_rating": eff_age_tv,
            },
        )
    lan_ip = ctx.detect_lan_ipv4()
    port = int(ctx.server_runtime.get("port") or 8765)
    devices = ctx.dlna_manager.discover_devices(timeout_sec=1.5 if force_scan else 1.2, force_refresh=force_scan)
    k_tv_auth = (
        qs.get("k", [""])[0].strip()
        or str(handler.headers.get("X-CineFlow-Key") or "").strip()
    )
    can_read_pair_token = bool(handler._is_loopback_client() or ctx.remote_broker.verify_key(k_tv_auth))
    qr_info = ctx.dlna_manager.build_tv_qr_payload(
        lan_ip=lan_ip,
        port=port,
        item_id=item_id,
        season=season,
        episode=episode,
        pair_key=ctx.remote_broker.pair_token if can_read_pair_token else "",
    )
    handler._send_json(
        {
            "ok": True,
            "devices": devices,
            "active_cast": ctx.dlna_manager.get_active_cast(),
            "lan_ip": lan_ip,
            "lan_enabled": bool(ctx.app_prefs.get("lan_access", False)),
            "is_local_client": handler._is_loopback_client(),
            "tv_url": qr_info["tv_url"],
            "qr_svg": qr_info["qr_svg"],
        }
    )
    return True


def handle_tv_deep_link(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    target_id = qs.get("p", qs.get("id", [""]))[0].strip()
    if not target_id:
        handler._send_json({"ok": False, "item": None}, status=400)
        return True
    resolved_item = ctx.dlna_manager.get_deep_link_item(target_id)
    if not resolved_item:
        if hasattr(ctx.aggregator, "find_cached_item_for_deep_link"):
            resolved_item = ctx.aggregator.find_cached_item_for_deep_link(target_id)
        else:
            clean_tid = re.sub(r"[^a-zA-Z0-9_-]+", "", target_id)[:24]
            with ctx.aggregator._catalog_lock:
                cache_entries = list(ctx.aggregator._catalog_cache.items())
            for _, cached_entry in cache_entries:
                cat_payload = cached_entry[1] if isinstance(cached_entry, tuple) and len(cached_entry) >= 2 else cached_entry
                if not isinstance(cat_payload, dict):
                    continue
                for cand in (cat_payload.get("items") or []):
                    cid = str(cand.get("id") or "")
                    if cid == target_id or re.sub(r"[^a-zA-Z0-9_-]+", "", cid)[:24] == clean_tid:
                        resolved_item = dict(cand)
                        break
                if resolved_item:
                    break
    if resolved_item and ctx.profile_manager.is_kids_mode_active():
        if not ctx.profile_manager.is_item_kids_safe(resolved_item):
            resolved_item = None
    handler._send_json({"ok": bool(resolved_item), "item": resolved_item})
    return True


def handle_remote_pairing_get(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    is_local = handler._is_loopback_client()
    k_param = qs.get("k", [""])[0].strip()
    has_auth = is_local or ctx.remote_broker.verify_key(k_param)
    auto_lan = qs.get("auto_lan", ["0"])[0].strip().lower() in ("1", "true", "yes")
    intent_ok = (handler.headers.get("X-CineFlow-Intent") or "").strip().lower() == "pair"
    if (
        is_local
        and auto_lan
        and intent_ok
        and not ctx.app_prefs.get("lan_access")
        and not ctx.profile_manager.is_kids_mode_active()
        and not ctx.profile_manager.is_active_kids_pin_locked()
    ):
        ctx.app_prefs["lan_access"] = True
        ctx.save_persisted_server_settings()
        if ctx.server_runtime.get("running"):
            ctx.sync_lan_listener(True)
    handler._send_json(ctx.build_remote_pairing_payload(include_secret=has_auth))
    return True


def handle_remote_state_get(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    is_local = handler._is_loopback_client()
    k_param = qs.get("k", [""])[0].strip()
    if not is_local and not ctx.remote_broker.verify_key(k_param):
        handler._send_json({"ok": False, "error": "Unauthorized remote key"}, status=403)
        return True
    since_seq = ctx.qs_int(qs, "since", 0)
    wait_sec = min(18.0, max(0.0, ctx.qs_float(qs, "timeout", 12.0)))
    cid = qs.get("cid", [""])[0].strip()
    dev_name = qs.get("device", [""])[0].strip()
    client_ip = str((handler.client_address or ("", 0))[0] or "")
    st_payload = ctx.remote_broker.wait_for_state(
        since_seq=since_seq,
        timeout=wait_sec,
        client_id=cid if not is_local or cid else "",
        device_name=dev_name or ("Смартфон" if ctx.app_prefs.get("app_lang", "ru") == "ru" else "Phone"),
        client_ip=client_ip,
    )
    cur_srv_lang = ctx.norm_app_lang(ctx.app_prefs.get("app_lang", "ru"), "ru")
    if isinstance(st_payload.get("state"), dict):
        st_payload["state"]["app_lang"] = cur_srv_lang
    st_payload["app_lang"] = cur_srv_lang
    handler._send_json(st_payload)
    return True


def handle_remote_commands_get(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    if not handler._is_loopback_client():
        handler._send_json({"ok": False, "error": "Loopback only"}, status=403)
        return True
    since_id = ctx.qs_int(qs, "since", 0)
    wait_sec = min(18.0, max(0.0, ctx.qs_float(qs, "timeout", 12.0)))
    cmd_payload = ctx.remote_broker.wait_for_commands(since_id=since_id, timeout=wait_sec)
    handler._send_json(cmd_payload)
    return True


def handle_remote_catalog_get(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    is_local = handler._is_loopback_client()
    k_param = qs.get("k", [""])[0].strip()
    if not is_local and not ctx.remote_broker.verify_key(k_param):
        handler._send_json({"ok": False, "error": "Unauthorized remote key"}, status=403)
        return True
    req_lang = ctx.norm_app_lang(qs.get("lang", [ctx.app_prefs.get("app_lang", "ru")])[0], ctx.app_prefs.get("app_lang", "ru"))
    q_str = qs.get("q", [""])[0].strip()

    def _compact_card(it: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": it.get("id") or "",
            "kinorium_id": it.get("kinorium_id") or (it.get("kinorium") or {}).get("kinorium_id") or "",
            "rezka_id": it.get("rezka_id") or "",
            "rezka_url": it.get("rezka_url") or "",
            "title": it.get("title") or it.get("orig_title") or "",
            "orig_title": it.get("orig_title") or it.get("title") or "",
            "year": it.get("year") or "",
            "media_type": it.get("media_type") or "movie",
            "poster": it.get("poster") or "",
            "poster_en": it.get("poster_en") or "",
            "backdrop": it.get("backdrop") or "",
            "season": it.get("season") or 1,
            "episode": it.get("episode") or 1,
            "current_time": it.get("current_time") or 0,
            "duration": it.get("duration") or 0,
        }

    if q_str:
        srch = ctx.aggregator.unified_search(query=q_str, lang=req_lang, mode="full")
        if ctx.profile_manager.is_kids_mode_active():
            srch = ctx.profile_manager.filter_catalog_payload_for_kids(srch)
        cards = [_compact_card(x) for x in (srch.get("items") or [])[:18]]
        handler._send_json({"ok": True, "query": q_str, "items": cards})
        return True

    cat = ctx.aggregator.get_catalog(lang=req_lang)
    if ctx.profile_manager.is_kids_mode_active():
        cat = ctx.profile_manager.filter_catalog_payload_for_kids(cat)
    cw_cards = [_compact_card(x) for x in (cat.get("continue_watching") or [])[:12]]
    top_cards = [_compact_card(x) for x in (cat.get("items") or [])[:16]]
    handler._send_json(
        {
            "ok": True,
            "continue_watching": cw_cards,
            "items": top_cards,
        }
    )
    return True


def handle_tv_cast(handler: Any, qs: Dict[str, Any], parsed: Any, body: Dict[str, Any], ctx: Any) -> bool:
    if not handler._require_authorized_client_if_lan(body):
        return True
    control_url = str(body.get("control_url") or "").strip()
    raw_stream = str(body.get("stream_url") or "").strip()
    raw_sub = str(body.get("subtitle_url") or "").strip()
    title_lbl = str(body.get("title") or "CineFlow").strip()
    dev_name = str(body.get("device_name") or "Smart TV").strip()
    srv_type = str(body.get("service_type") or "urn:schemas-upnp-org:service:AVTransport:1").strip()
    start_pos = max(0.0, ctx.safe_float(body.get("start_sec"), 0.0))

    if not control_url or not raw_stream:
        handler._send_json(
            {
                "ok": False,
                "error": ctx.msg(
                    "Укажите устройство и поток для передачи на телевизор",
                    "Select a TV device and stream to cast",
                ),
            },
            status=400,
        )
        return True

    unwrapped_cast_src = ctx.unwrap_local_proxy_media_url(raw_stream)
    is_local_cast_path = raw_stream.startswith("/api/") or any(
        raw_stream.startswith(f"http://{h}:") or raw_stream.startswith(f"https://{h}:")
        for h in ("127.0.0.1", "localhost")
    )
    if not is_local_cast_path and not ctx.is_allowed_media_source_url(unwrapped_cast_src, allow_torrserver_loopback=True):
        handler._send_json(
            {
                "ok": False,
                "error": ctx.msg(
                    "Недопустимый или небезопасный адрес медиапотока для трансляции",
                    "Invalid or unsafe media stream URL for casting",
                ),
            },
            status=400,
        )
        return True

    if ctx.profile_manager.is_kids_mode_active():
        raw_cast_title = str(body.get("item_title") or "").strip()
        if not raw_cast_title and title_lbl.lower() != "cineflow":
            raw_cast_title = re.sub(r"\s*·\s*S\d+E\d+.*$", "", title_lbl, flags=re.I).strip()
        cand_cast = ctx.build_trusted_item_for_kids_check(
            item_id=str(body.get("id") or ""),
            title=raw_cast_title,
            orig_title=str(body.get("orig_title") or ""),
            media_type=str(body.get("media_type") or "movie"),
        )
        probe_cast = (
            cand_cast
            if (cand_cast.get("genres") or cand_cast.get("description") or cand_cast.get("age_rating"))
            else {**cand_cast, "genres": ["семейный"]}
        )
        if not (cand_cast.get("title") or cand_cast.get("orig_title") or cand_cast.get("genres")) or not ctx.profile_manager.is_item_kids_safe(probe_cast):
            handler._send_json(
                {"ok": False, "error": ctx.msg("Трансляция недоступна в детском профиле", "Casting restricted in Kids Mode")},
                status=403,
            )
            return True

    if (
        not ctx.app_prefs.get("lan_access")
        and handler._is_loopback_client()
        and not ctx.profile_manager.is_kids_mode_active()
        and not ctx.profile_manager.is_active_kids_pin_locked()
    ):
        ctx.app_prefs["lan_access"] = True
        ctx.save_persisted_server_settings()
        if ctx.server_runtime.get("running"):
            ctx.sync_lan_listener(True)

    lan_ip = ctx.detect_lan_ipv4()
    port_num = int(ctx.server_runtime.get("port") or 8765)
    lan_stream = ctx.dlna_manager.build_lan_stream_url(raw_stream, lan_ip, port_num, start_sec=start_pos)
    lan_sub = ctx.dlna_manager.build_lan_stream_url(raw_sub, lan_ip, port_num) if raw_sub else ""

    res = ctx.dlna_manager.cast_stream(
        control_url=control_url,
        stream_url=lan_stream,
        title=title_lbl,
        subtitle_url=lan_sub,
        start_sec=start_pos,
        device_name=dev_name,
        service_type=srv_type,
    )
    handler._send_json(res, status=200 if res.get("ok") else 502)
    return True


def handle_tv_stop(handler: Any, qs: Dict[str, Any], parsed: Any, body: Dict[str, Any], ctx: Any) -> bool:
    if not handler._require_authorized_client_if_lan(body):
        return True
    ctrl_u = str(body.get("control_url") or "").strip()
    res = ctx.dlna_manager.stop_cast(ctrl_u)
    handler._send_json(res)
    return True


def handle_remote_pair(handler: Any, qs: Dict[str, Any], parsed: Any, body: Dict[str, Any], ctx: Any) -> bool:
    if not handler._is_loopback_client():
        handler._send_json({"ok": False, "error": "Loopback only"}, status=403)
        return True
    req_lang = ctx.norm_app_lang(body.get("lang", ctx.app_prefs.get("app_lang", "ru")), ctx.app_prefs.get("app_lang", "ru"))
    if not handler._require_kids_pin_if_locked(str(body.get("pin") or ""), lang=req_lang):
        return True
    if body.get("regenerate"):
        ctx.remote_broker.rotate_token()
        ctx.save_persisted_server_settings()
    if (
        body.get("enable_lan", True)
        and not ctx.app_prefs.get("lan_access")
        and not (ctx.profile_manager.is_kids_mode_active() and not ctx.profile_manager.is_active_kids_pin_locked())
    ):
        ctx.app_prefs["lan_access"] = True
        ctx.save_persisted_server_settings()
        if ctx.server_runtime.get("running"):
            ctx.sync_lan_listener(True)
    handler._send_json(ctx.build_remote_pairing_payload(include_secret=True))
    return True


def handle_remote_state_post(handler: Any, qs: Dict[str, Any], parsed: Any, body: Dict[str, Any], ctx: Any) -> bool:
    if not handler._is_loopback_client():
        handler._send_json({"ok": False, "error": "Loopback only"}, status=403)
        return True
    st_snap = ctx.remote_broker.update_desktop_state(body)
    handler._send_json(
        {
            "ok": True,
            "seq": st_snap["seq"],
            "connected_remotes": st_snap["connected_remotes"],
        }
    )
    return True


def handle_remote_native_fullscreen(handler: Any, qs: Dict[str, Any], parsed: Any, body: Dict[str, Any], ctx: Any) -> bool:
    if not handler._is_loopback_client():
        handler._send_json({"ok": False, "error": "Loopback only"}, status=403)
        return True
    triggered = ctx.trigger_macos_browser_fullscreen_key()
    handler._send_json({"ok": triggered})
    return True


def handle_remote_native_pip(handler: Any, qs: Dict[str, Any], parsed: Any, body: Dict[str, Any], ctx: Any) -> bool:
    if not handler._is_loopback_client():
        handler._send_json({"ok": False, "error": "Loopback only"}, status=403)
        return True
    engine = str(body.get("engine") or "").strip().lower()
    triggered = ctx.trigger_macos_browser_pip_key(engine)
    handler._send_json({"ok": triggered})
    return True


def handle_remote_command(handler: Any, qs: Dict[str, Any], parsed: Any, body: Dict[str, Any], ctx: Any) -> bool:
    is_local = handler._is_loopback_client()
    k_val = str(body.get("k") or (qs.get("k", [""])[0] if qs else "")).strip()
    if not is_local and not ctx.remote_broker.verify_key(k_val):
        handler._send_json({"ok": False, "error": "Unauthorized remote key"}, status=403)
        return True
    action = str(body.get("action") or "").strip()
    cmd_payload = body.get("payload") if isinstance(body.get("payload"), dict) else {}
    if not cmd_payload:
        cmd_payload = {
            k: v
            for k, v in body.items()
            if k not in ("action", "k", "cid", "client_id", "device", "device_name")
        }
    if action == "play_item" and ctx.profile_manager.is_kids_mode_active():
        raw_rem_item = cmd_payload.get("item") if isinstance(cmd_payload.get("item"), dict) else cmd_payload
        cand_rem = ctx.build_trusted_item_for_kids_check(
            item_id=str(raw_rem_item.get("id") or raw_rem_item.get("item_id") or ""),
            title=str(raw_rem_item.get("title") or ""),
            orig_title=str(raw_rem_item.get("orig_title") or ""),
            media_type=str(raw_rem_item.get("media_type") or "movie"),
        )
        probe_rem = (
            cand_rem
            if (cand_rem.get("genres") or cand_rem.get("description") or cand_rem.get("age_rating"))
            else {**cand_rem, "genres": ["семейный"]}
        )
        if not (cand_rem.get("title") or cand_rem.get("orig_title") or cand_rem.get("genres")) or not ctx.profile_manager.is_item_kids_safe(probe_rem):
            handler._send_json(
                {
                    "ok": False,
                    "error": ctx.msg(
                        "Контент недоступен в детском профиле",
                        "Content restricted in Kids Mode",
                    ),
                },
                status=403,
            )
            return True
    client_ip = str((handler.client_address or ("", 0))[0] or "")
    cid = str(body.get("cid") or body.get("client_id") or "").strip()
    dev_name = str(body.get("device") or body.get("device_name") or "").strip()
    snap_state = ctx.remote_broker.get_snapshot().get("state", {})
    if (
        action == "toggle_fullscreen"
        and ctx.server_runtime.get("running")
        and not snap_state.get("native_fs_ready")
    ):
        if cid or client_ip:
            ctx.remote_broker.touch_remote_client(
                client_id=cid,
                device_name=dev_name or ("Смартфон" if ctx.app_prefs.get("app_lang", "ru") == "ru" else "Phone"),
                client_ip=client_ip,
            )
        if ctx.trigger_macos_browser_fullscreen_key():
            handler._send_json({"ok": True, "native_fullscreen": True})
            return True
    if (
        action in ("toggle_pip", "toggle_mini")
        and ctx.server_runtime.get("running")
        and not snap_state.get("native_pip_ready")
    ):
        if cid or client_ip:
            ctx.remote_broker.touch_remote_client(
                client_id=cid,
                device_name=dev_name or ("Смартфон" if ctx.app_prefs.get("app_lang", "ru") == "ru" else "Phone"),
                client_ip=client_ip,
            )
        if ctx.trigger_macos_browser_pip_key():
            handler._send_json({"ok": True, "native_pip": True})
            return True
    enq = ctx.remote_broker.enqueue_command(
        action=action,
        payload=cmd_payload,
        client_id=cid,
        device_name=dev_name or ("Смартфон" if ctx.app_prefs.get("app_lang", "ru") == "ru" else "Phone"),
        client_ip=client_ip,
    )
    handler._send_json(enq, status=200 if enq.get("ok") else 400)
    return True


REMOTE_GET_ROUTES = {
    "/api/tv/devices": handle_tv_devices,
    "/api/tv/deep-link": handle_tv_deep_link,
    "/api/remote/pairing": handle_remote_pairing_get,
    "/api/remote/state": handle_remote_state_get,
    "/api/remote/commands": handle_remote_commands_get,
    "/api/remote/catalog": handle_remote_catalog_get,
}

REMOTE_POST_ROUTES = {
    "/api/tv/cast": handle_tv_cast,
    "/api/tv/stop": handle_tv_stop,
    "/api/remote/pair": handle_remote_pair,
    "/api/remote/state": handle_remote_state_post,
    "/api/remote/native-fullscreen": handle_remote_native_fullscreen,
    "/api/remote/native-pip": handle_remote_native_pip,
    "/api/remote/command": handle_remote_command,
}
