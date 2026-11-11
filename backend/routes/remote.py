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
import socket
import threading
import time
import urllib.parse
from typing import Any, Dict

from backend.qrcode_svg import detect_lan_ipv4, generate_qr_svg

try:
    _LOCAL_HOSTNAME = socket.gethostname() or "Velarium"
except Exception:
    _LOCAL_HOSTNAME = "Velarium"


def handle_tv_devices(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
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
        or str(handler.headers.get("X-Velarium-Key") or handler.headers.get("X-CineFlow-Key") or "").strip()
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
    is_local = (
        handler._is_loopback_client()
        if hasattr(handler, "_is_loopback_client")
        else True
    )
    k_param = qs.get("k", [""])[0].strip()
    has_auth = is_local or ctx.remote_broker.verify_key(k_param)
    auto_lan = qs.get("auto_lan", ["0"])[0].strip().lower() in ("1", "true", "yes")
    intent_ok = (
        str(handler.headers.get("X-Velarium-Intent") or handler.headers.get("X-CineFlow-Intent") or "")
        .strip()
        .lower()
        == "pair"
    )
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
    is_local = (
        handler._is_loopback_client()
        if hasattr(handler, "_is_loopback_client")
        else True
    )
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
    is_local = (
        handler._is_loopback_client()
        if hasattr(handler, "_is_loopback_client")
        else True
    )
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
    title_lbl = str(body.get("title") or "Velarium").strip()
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
    unwrapped_parsed = urllib.parse.urlparse(unwrapped_cast_src)
    unwrapped_path = (unwrapped_parsed.path or "").strip()
    is_local_cast_path = (
        unwrapped_cast_src.startswith("/api/downloads/stream/")
        or (
            (unwrapped_parsed.hostname or "").lower() in ("127.0.0.1", "localhost", "::1")
            and unwrapped_path.startswith("/api/downloads/stream/")
            and ".." not in unwrapped_path
        )
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
        if not raw_cast_title and title_lbl.lower() not in ("velarium", "cineflow"):
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

    burn_subs = bool(body.get("burn_subtitles") or body.get("burn_subs"))
    lan_ip = (
        ctx.detect_lan_ipv4()
        or str(ctx.server_runtime.get("lan_bound_ip") or "").strip()
    )
    if not lan_ip or lan_ip in ("0.0.0.0", "127.0.0.1", "localhost"):
        handler._send_json(
            {"ok": False, "error": "Не удалось определить локальный IP-адрес компьютера в сети Wi-Fi/LAN для трансляции на ТВ."},
            status=400,
        )
        return True
    port_num = int(ctx.server_runtime.get("port") or 8765)
    if raw_sub and burn_subs:
        remux_params = {
            "src": raw_stream,
            "sub": raw_sub,
            "burn_sub": "1",
            "compat": "1",
        }
        if start_pos > 5.0:
            remux_params["start"] = f"{start_pos:.1f}"
        remux_qs = urllib.parse.urlencode(remux_params)
        lan_stream = f"http://{lan_ip}:{port_num}/api/remux-stream?{remux_qs}"
        lan_sub = ""
    else:
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
    st_snap = ctx.remote_broker.update_desktop_state(body, include_state=False)
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
    is_local = (
        handler._is_loopback_client()
        if hasattr(handler, "_is_loopback_client")
        else True
    )
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
    snap_state = (
        ctx.remote_broker.get_state_flags()
        if hasattr(ctx.remote_broker, "get_state_flags")
        else ctx.remote_broker.get_snapshot().get("state", {})
    )
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


def handle_handoff(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    item_id = qs.get("id", [""])[0].strip()
    season = ctx.qs_int(qs, "season", 1)
    episode = ctx.qs_int(qs, "episode", 1)
    start_sec = max(0, ctx.qs_int(qs, "t", 0))
    tab = qs.get("tab", [""])[0].strip()
    studio_id = qs.get("tr", [""])[0].strip()
    title = qs.get("title", [""])[0].strip()
    orig_title = qs.get("orig_title", [""])[0].strip()
    year = qs.get("year", [""])[0].strip()
    media_type = qs.get("media_type", ["movie"])[0].strip()
    raw_poster = qs.get("poster", [""])[0].strip()
    poster = raw_poster if raw_poster.lower().startswith(("https://", "http://", "/")) else ""

    req_headers = getattr(handler, "headers", None)
    if req_headers is not None:
        sfs = (req_headers.get("Sec-Fetch-Site") or "").strip().lower()
        if sfs == "cross-site":
            handler._send_json({"ok": False, "error": "Forbidden cross-site request"}, status=403)
            return True

    if hasattr(ctx, "profile_manager") and ctx.profile_manager and ctx.profile_manager.is_kids_mode_active():
        cand = ctx.build_trusted_item_for_kids_check(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            media_type=media_type,
        )
        if not ctx.profile_manager.is_item_kids_safe(cand):
            handler._send_json({"ok": False, "error": "Restricted in Kids Mode"}, status=403)
            return True

    is_local = (
        handler._is_loopback_client()
        if hasattr(handler, "_is_loopback_client")
        else True
    )
    if not is_local and hasattr(handler, "_require_authorized_client_if_lan"):
        if not handler._require_authorized_client_if_lan():
            return True
    if (
        is_local
        and hasattr(ctx, "app_prefs")
        and not ctx.app_prefs.get("lan_access")
        and hasattr(ctx, "profile_manager")
        and not ctx.profile_manager.is_kids_mode_active()
        and not ctx.profile_manager.is_active_kids_pin_locked()
    ):
        ctx.app_prefs["lan_access"] = True
        if hasattr(ctx, "save_persisted_server_settings"):
            ctx.save_persisted_server_settings()
        if hasattr(ctx, "server_runtime") and ctx.server_runtime.get("running"):
            if hasattr(ctx, "sync_lan_listener"):
                ctx.sync_lan_listener(True)

    dlna_mgr = getattr(ctx, "dlna_manager", None)
    lan_ip = getattr(dlna_mgr, "lan_ip", "") or ""
    if not lan_ip:
        lan_ip = ctx.detect_lan_ipv4() if hasattr(ctx, "detect_lan_ipv4") else detect_lan_ipv4()
        if dlna_mgr is not None:
            try:
                dlna_mgr.lan_ip = lan_ip
            except Exception:
                pass
    if not lan_ip:
        lan_ip = "127.0.0.1"

    port = 8765
    server_addr = getattr(getattr(handler, "server", None), "server_address", None)
    if isinstance(server_addr, tuple) and len(server_addr) >= 2:
        port = int(server_addr[1])

    if item_id and dlna_mgr and hasattr(dlna_mgr, "register_deep_link_item"):
        dlna_mgr.register_deep_link_item(
            item_id,
            {
                "id": item_id,
                "title": title or "Velarium",
                "orig_title": orig_title,
                "year": year,
                "media_type": media_type,
                "poster": poster,
            },
        )

    clean_id = urllib.parse.quote(item_id)
    handoff_url = f"http://{lan_ip}:{port}/?p={clean_id}&t={start_sec}"
    if media_type == "series" or season > 1 or episode > 1:
        handoff_url += f"&s={season}&e={episode}"
    if tab:
        handoff_url += f"&tab={urllib.parse.quote(tab)}"
    if studio_id:
        handoff_url += f"&tr={urllib.parse.quote(studio_id)}"

    try:
        qr_svg = generate_qr_svg(handoff_url, quiet_zone=2)
    except Exception:
        qr_svg = ""

    handler._send_json({
        "ok": True,
        "handoff_url": handoff_url,
        "qr_svg": qr_svg,
        "lan_ip": lan_ip,
        "port": port,
        "start_sec": start_sec,
    })
    return True


_SYNC_MERGE_LOCK = threading.Lock()


class _StorageDbSyncStoreAdapter:
    def __init__(self, db: Any) -> None:
        self._db = db

    def get(self, key: str, default: Any = None) -> Any:
        try:
            val = self._db.get_kv("lan_sync", key, default=default)
            return default if val is None else val
        except Exception:
            return default

    def set(self, key: str, value: Any) -> None:
        try:
            self._db.set_kv("lan_sync", key, value)
        except Exception:
            pass


def _resolve_sync_store(ctx: Any) -> Any:
    store = getattr(ctx, "store", None)
    if store is not None and hasattr(store, "get"):
        return store
    db = getattr(ctx, "storage_db", None)
    if db is not None and hasattr(db, "get_kv") and hasattr(db, "set_kv"):
        return _StorageDbSyncStoreAdapter(db)
    return None


def handle_sync_state(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    req_auth = getattr(handler, "_require_authorized_client_if_lan", None)
    if callable(req_auth) and not req_auth(None):
        return True
    prof_id = getattr(getattr(ctx, "profile_manager", None), "get_active_profile_id", lambda: "main")()
    is_kids = bool(getattr(getattr(ctx, "profile_manager", None), "is_kids_mode_active", lambda: False)())
    lan_ip = ctx.detect_lan_ipv4() if hasattr(ctx, "detect_lan_ipv4") else detect_lan_ipv4()
    port = 8765
    server_addr = getattr(getattr(handler, "server", None), "server_address", None)
    if isinstance(server_addr, tuple) and len(server_addr) >= 2:
        port = int(server_addr[1])

    store = _resolve_sync_store(ctx)
    state_payload = {
        "ok": True,
        "device_name": socket.gethostname(),
        "device_ip": lan_ip or "127.0.0.1",
        "port": port,
        "profile_id": prof_id,
        "is_kids": is_kids,
        "sync_ts": time.time(),
        "watch_history": store.get(f"sync_history_{prof_id}", []) if store and hasattr(store, "get") else [],
        "bookmarks": store.get(f"sync_bookmarks_{prof_id}", []) if store and hasattr(store, "get") else [],
        "preferred_studios": store.get(f"sync_studios_{prof_id}", {}) if store and hasattr(store, "get") else {},
    }
    handler._send_json(state_payload)
    return True


def handle_sync_merge(handler: Any, qs: Dict[str, Any], parsed: Any, body: Any = None, ctx: Any = None) -> bool:
    if ctx is None and body is not None and not isinstance(body, dict):
        ctx = body
        body = None
    if not isinstance(body, dict):
        try:
            body = handler._read_json_body()
        except Exception:
            body = {}
    if not isinstance(body, dict):
        body = {}

    req_auth = getattr(handler, "_require_authorized_client_if_lan", None)
    if callable(req_auth) and not req_auth(body):
        return True

    prof_mgr = getattr(ctx, "profile_manager", None)
    is_kids = bool(getattr(prof_mgr, "is_kids_mode_active", lambda: False)())
    prof_id = getattr(prof_mgr, "get_active_profile_id", lambda: "main")()

    in_history = body.get("watch_history") or []
    in_bookmarks = body.get("bookmarks") or []
    in_studios = body.get("preferred_studios") if isinstance(body.get("preferred_studios"), dict) else {}

    # If local device is in Kids mode, filter out non-kids-safe content
    if is_kids and prof_mgr and hasattr(prof_mgr, "is_item_kids_safe"):
        in_history = [it for it in in_history if isinstance(it, dict) and prof_mgr.is_item_kids_safe(it)]
        in_bookmarks = [it for it in in_bookmarks if isinstance(it, dict) and prof_mgr.is_item_kids_safe(it)]

    store = _resolve_sync_store(ctx)
    merged_history_count = 0
    merged_bookmarks_count = 0
    merged_studios_count = 0
    merged_hist_list = list(in_history)[:300]
    merged_bm_list = list(in_bookmarks)[:500]
    merged_studios_map = dict(in_studios)

    if store and hasattr(store, "get") and hasattr(store, "set"):
        with _SYNC_MERGE_LOCK:
            hist_key = f"sync_history_{prof_id}"
            bm_key = f"sync_bookmarks_{prof_id}"
            st_key = f"sync_studios_{prof_id}"
            cur_hist = list(store.get(hist_key, []) or [])
            cur_bm = list(store.get(bm_key, []) or [])
            cur_st = dict(store.get(st_key, {}) or {})

            def _sync_ts(entry: Dict[str, Any], fallback_key: str = "ts") -> float:
                raw = entry.get("updatedAt")
                if raw is None:
                    raw = entry.get(fallback_key, 0)
                try:
                    return float(raw or 0)
                except (ValueError, TypeError):
                    return 0.0

            def _bm_key(m: Dict[str, Any]) -> str:
                raw_mid = m.get("id")
                if not raw_mid and m.get("itemId") is not None and m.get("time") is not None:
                    raw_mid = f"{m.get('itemId')}_{m.get('time')}"
                return str(raw_mid or "").strip()

            # Merge history by item id with last-write-wins
            hist_map = {str(it.get("id") or it.get("title") or ""): it for it in cur_hist if isinstance(it, dict) and str(it.get("id") or it.get("title") or "").strip()}
            for it in in_history:
                if not isinstance(it, dict):
                    continue
                iid = str(it.get("id") or it.get("title") or "").strip()
                if not iid:
                    continue
                existing = hist_map.get(iid)
                if not existing or _sync_ts(it, "ts") >= _sync_ts(existing, "ts"):
                    hist_map[iid] = it
                    merged_history_count += 1
            merged_hist_list = sorted(hist_map.values(), key=lambda x: _sync_ts(x, "ts"), reverse=True)[:300]
            store.set(hist_key, merged_hist_list)

            # Merge bookmarks by id or (itemId, time)
            bm_map = {}
            for m in cur_bm:
                if isinstance(m, dict):
                    mk = _bm_key(m)
                    if mk:
                        bm_map[mk] = m
            for m in in_bookmarks:
                if not isinstance(m, dict):
                    continue
                mid = _bm_key(m)
                if not mid:
                    continue
                existing = bm_map.get(mid)
                if not existing or _sync_ts(m, "time") >= _sync_ts(existing, "time"):
                    bm_map[mid] = m
                    merged_bookmarks_count += 1
            merged_bm_list = list(bm_map.values())[:500]
            store.set(bm_key, merged_bm_list)

            # Merge per-series preferred studios by key with last-write-wins
            st_map = {str(k)[:128]: v for k, v in cur_st.items() if isinstance(v, dict)}
            for k, v in list(in_studios.items())[:500]:
                k_str = str(k or "").strip()[:128]
                if not k_str or not isinstance(v, dict):
                    continue
                existing = st_map.get(k_str)
                if not existing or _sync_ts(v, "updated_at") >= _sync_ts(existing, "updated_at"):
                    st_map[k_str] = v
                    merged_studios_count += 1
            if len(st_map) > 500:
                sorted_st_keys = sorted(
                    st_map.keys(),
                    key=lambda kk: _sync_ts(st_map[kk], "updated_at"),
                    reverse=True,
                )[:500]
                st_map = {kk: st_map[kk] for kk in sorted_st_keys}
            merged_studios_map = st_map
            store.set(st_key, merged_studios_map)
    else:
        merged_history_count = len([x for x in in_history if isinstance(x, dict)])
        merged_bookmarks_count = len([x for x in in_bookmarks if isinstance(x, dict)])
        merged_studios_count = len([v for v in in_studios.values() if isinstance(v, dict)])

    handler._send_json({
        "ok": True,
        "device_name": socket.gethostname(),
        "merged_history": merged_history_count,
        "merged_bookmarks": merged_bookmarks_count,
        "merged_studios": merged_studios_count,
        "watch_history": merged_hist_list,
        "bookmarks": merged_bm_list,
        "preferred_studios": merged_studios_map,
        "profile_id": prof_id,
        "sync_ts": time.time(),
    })
    return True


def handle_sync_peers(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> bool:
    req_auth = getattr(handler, "_require_authorized_client_if_lan", None)
    if callable(req_auth) and not req_auth(None):
        return True
    is_kids = bool(getattr(getattr(ctx, "profile_manager", None), "is_kids_mode_active", lambda: False)())
    lan_ip = ctx.detect_lan_ipv4() if hasattr(ctx, "detect_lan_ipv4") else detect_lan_ipv4()
    port = 8765
    server_addr = getattr(getattr(handler, "server", None), "server_address", None)
    if isinstance(server_addr, tuple) and len(server_addr) >= 2:
        port = int(server_addr[1])

    peers = []
    # Local self-peer
    peers.append({
        "name": f"{_LOCAL_HOSTNAME} (это устройство)",
        "ip": lan_ip or "127.0.0.1",
        "port": port,
        "is_self": True,
        "online": True,
    })

    # Discovered DLNA/Smart TV devices (suppressed in Kids Mode)
    dlna_mgr = getattr(ctx, "dlna_manager", None) if not is_kids else None
    if dlna_mgr:
        if hasattr(dlna_mgr, "discovered_renderers") and isinstance(getattr(dlna_mgr, "discovered_renderers", None), dict):
            for dev in list(getattr(dlna_mgr, "discovered_renderers", {}).values()):
                if isinstance(dev, dict):
                    peers.append({
                        "name": dev.get("name") or "Smart TV",
                        "ip": dev.get("location") or dev.get("ip") or dev.get("host") or "",
                        "port": 0,
                        "is_self": False,
                        "kind": "tv",
                        "online": True,
                    })
        elif hasattr(dlna_mgr, "_cached_devices"):
            with getattr(dlna_mgr, "_lock", threading.Lock()):
                cached_devs = list(getattr(dlna_mgr, "_cached_devices", []) or [])
            for dev in cached_devs:
                if isinstance(dev, dict):
                    peers.append({
                        "name": dev.get("name") or "Smart TV",
                        "ip": dev.get("host") or dev.get("location") or dev.get("ip") or dev.get("location_url") or "",
                        "port": 0,
                        "is_self": False,
                        "kind": "tv",
                        "online": True,
                    })

    handler._send_json({
        "ok": True,
        "local_ip": lan_ip or "127.0.0.1",
        "port": port,
        "peers": peers,
    })
    return True


REMOTE_GET_ROUTES = {
    "/api/tv/devices": handle_tv_devices,
    "/api/tv/deep-link": handle_tv_deep_link,
    "/api/remote/pairing": handle_remote_pairing_get,
    "/api/remote/state": handle_remote_state_get,
    "/api/remote/commands": handle_remote_commands_get,
    "/api/remote/catalog": handle_remote_catalog_get,
    "/api/handoff": handle_handoff,
    "/api/sync/state": handle_sync_state,
    "/api/sync/peers": handle_sync_peers,
}

REMOTE_POST_ROUTES = {
    "/api/tv/cast": handle_tv_cast,
    "/api/tv/stop": handle_tv_stop,
    "/api/remote/pair": handle_remote_pair,
    "/api/remote/state": handle_remote_state_post,
    "/api/remote/native-fullscreen": handle_remote_native_fullscreen,
    "/api/remote/native-pip": handle_remote_native_pip,
    "/api/remote/command": handle_remote_command,
    "/api/sync/merge": handle_sync_merge,
}
