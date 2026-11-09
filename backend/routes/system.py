"""
Velarium System & Settings Route Handlers
Dispatches /api/system/* and /api/settings requests.
"""

import os
import subprocess
import sys
import threading
from urllib.parse import urlparse

from backend.regions import (
    get_country_profile,
    get_european_countries_list,
    normalize_country_code,
)

_STREAM_EMBED_LOCK = threading.Lock()
_ACTIVE_STREAM_EMBED_PROC = None
_ALLOWED_STREAM_EMBED_DOMAINS = (
    "netflix.com",
    "tv.apple.com",
    "apple.com",
    "primevideo.com",
    "amazon.com",
    "disneyplus.com",
    "max.com",
    "hbomax.com",
    "player.pl",
    "justwatch.com",
)


def _is_allowed_stream_embed_url(raw_url: str) -> bool:
    try:
        parsed = urlparse(str(raw_url or "").strip())
        if parsed.scheme.lower() != "https":
            return False
        host = (parsed.hostname or "").lower().strip(".")
        if not host:
            return False
        return any(host == dom or host.endswith("." + dom) for dom in _ALLOWED_STREAM_EMBED_DOMAINS)
    except Exception:
        return False


def _find_desktop_chromium_executable() -> str:
    try:
        from windows.kinorium_login_webview import find_chromium_browser

        exe = find_chromium_browser()
        if exe and os.path.isfile(exe):
            return exe
    except Exception:
        pass
    if sys.platform == "darwin":
        mac_candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
        for cand in mac_candidates:
            if os.path.isfile(cand):
                return cand
    return ""


def _close_active_stream_embed_proc() -> None:
    global _ACTIVE_STREAM_EMBED_PROC
    with _STREAM_EMBED_LOCK:
        proc = _ACTIVE_STREAM_EMBED_PROC
        _ACTIVE_STREAM_EMBED_PROC = None
    if proc is not None:
        try:
            if proc.poll() is None:
                if os.name == "nt":
                    try:
                        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                        subprocess.run(
                            ["taskkill", "/PID", str(proc.pid)],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                            timeout=1.2,
                            creationflags=creationflags,
                        )
                        proc.wait(timeout=0.8)
                    except Exception:
                        pass
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=1.5)
                    except Exception:
                        try:
                            proc.kill()
                            proc.wait(timeout=0.5)
                        except Exception:
                            pass
        except Exception:
            pass


def handle_system_status(handler, qs, parsed, ctx):
    handler._send_json(ctx.get_system_status_payload(is_local_client=handler._is_loopback_client()))
    return True


def handle_system_update_status(handler, qs, parsed, ctx):
    handler._send_json(ctx.app_updater.get_status(redact_local_paths=not handler._is_loopback_client()))
    return True


def handle_system_update_check_get(handler, qs, parsed, ctx):
    if not handler._require_authorized_client_if_lan():
        return True
    force_chk = qs.get("force", ["0"])[0].strip().lower() in ("1", "true", "yes")
    res_chk = ctx.app_updater.check_for_updates(force=force_chk)
    if not handler._is_loopback_client():
        res_chk = ctx.app_updater.get_status(redact_local_paths=True)
    handler._send_json(res_chk)
    return True


def handle_settings_get(handler, qs, parsed, ctx):
    is_local = handler._is_loopback_client()
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(qs.get("lang", [app_lang])[0], app_lang)
    cur_cc = normalize_country_code(ctx.app_prefs.get("user_country", "PL"))
    country_prof = get_country_profile(cur_cc, lang=req_lang)
    handler._send_json(
        {
            "region": f"{country_prof['code']} ({country_prof['name']})",
            "user_country": country_prof["code"],
            "setup_completed": bool(ctx.app_prefs.get("setup_completed", False)),
            "country_profile": country_prof,
            "eu_countries": get_european_countries_list(lang=req_lang),
            "app_lang": ctx.app_prefs.get("app_lang", "ru"),
            "system": ctx.get_system_status_payload(is_local_client=is_local),
            "hdrezka": {
                "custom_mirror": ctx.rezka_client.custom_mirror if is_local else "",
                "proxy_url": ctx.rezka_client.proxy_url if is_local else "",
                "cf_worker_relay": ctx.rezka_client.cf_worker_relay if is_local else "",
                "spoof_region": ctx.rezka_client.spoof_region,
                "preferred_studios": ctx.rezka_client.preferred_studios,
                "active_mirrors": ctx.rezka_client.get_mirrors(),
            },
            "backup_stream": {
                "mode": ctx.backup_stream_engine.mode,
                "p2p_strict": bool(getattr(ctx.net_client, "p2p_strict", False)),
                "torrserver_url": ctx.backup_stream_engine.torrserver_url if is_local else "http://127.0.0.1:8090",
                "torrserver_connected": ctx.backup_stream_engine._is_torrserver_alive_cached(),
                "torrserver_builtin": bool(ctx.backup_stream_engine.torr_bin_path),
                "remux_available": ctx.remux_engine.is_available(),
                "hw_accel": ctx.remux_engine.get_hw_capabilities(),
                "debrid_configured": bool(ctx.backup_stream_engine.debrid_api_key),
            },
            "stremio_addons": ctx.redact_stremio_addons_for_client(
                ctx.stremio_engine.get_addons(lang=req_lang),
                is_local,
            ),
            "kinorium": ctx.kinorium_service.get_account_summary(),
            "integrations": ctx.kinorium_service.get_integrations(),
            "profiles": ctx.profile_manager.get_profiles_payload(
                lang=req_lang,
                live_kinorium_service=ctx.kinorium_service,
            ),
            "webview_userscript": ctx.skip_intro_engine.get_webview_cinema_userscript(),
        }
    )
    return True


def handle_system_lan_post(handler, qs, parsed, body, ctx):
    if not handler._is_loopback_client():
        handler._send_json(
            {
                "ok": False,
                "error": ctx.msg(
                    "Управление режимом домашней сети разрешено только на основном компьютере",
                    "Managing Home Wi-Fi LAN mode is only allowed on the host computer",
                ),
                "system": ctx.get_system_status_payload(is_local_client=False),
            },
            status=403,
        )
        return True
    if not handler._require_kids_pin_if_locked(str(body.get("pin") or body.get("current_pin") or "")):
        return True
    enabled = bool(body.get("enabled"))
    ctx.app_prefs["lan_access"] = enabled
    ctx.save_persisted_server_settings()
    ctx.sync_lan_listener(enabled)
    handler._send_json({"ok": True, "system": ctx.get_system_status_payload(is_local_client=True)})
    return True


def handle_system_autostart_post(handler, qs, parsed, body, ctx):
    if not handler._is_loopback_client():
        handler._send_json(
            {
                "ok": False,
                "error": ctx.msg(
                    "Настройка автозапуска доступна только на основном компьютере",
                    "Configuring startup launch is only allowed on the host computer",
                ),
                "system": ctx.get_system_status_payload(is_local_client=False),
            },
            status=403,
        )
        return True
    if not handler._require_kids_pin_if_locked(str(body.get("pin") or body.get("current_pin") or "")):
        return True
    enabled = bool(body.get("enabled"))
    res = ctx.set_system_autostart(enabled)
    status_code = 200 if res.get("ok") else 400
    handler._send_json({**res, "system": ctx.get_system_status_payload(is_local_client=True)}, status=status_code)
    return True


def handle_system_update_check_post(handler, qs, parsed, body, ctx):
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True
    is_local = handler._is_loopback_client()
    if is_local:
        changed_cfg = False
        if "update_repo" in body:
            ctx.app_prefs["update_repo"] = str(body.get("update_repo") or "").strip()[:160]
            changed_cfg = True
        if "update_manifest_url" in body:
            raw_m_url = str(body.get("update_manifest_url") or "").strip()[:512]
            if raw_m_url and not raw_m_url.lower().startswith(("https://", "http://")):
                raw_m_url = ""
            ctx.app_prefs["update_manifest_url"] = raw_m_url
            changed_cfg = True
        if "auto_check_updates" in body:
            ctx.app_prefs["auto_check_updates"] = bool(body.get("auto_check_updates"))
            changed_cfg = True
        if changed_cfg:
            ctx.save_persisted_server_settings()
    force_chk = bool(body.get("force", True))
    res_chk = ctx.app_updater.check_for_updates(force=force_chk)
    if not is_local:
        res_chk = ctx.app_updater.get_status(redact_local_paths=True)
    handler._send_json(res_chk)
    return True


def handle_system_update_download_post(handler, qs, parsed, body, ctx):
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._is_loopback_client():
        handler._send_json(
            {
                "ok": False,
                "error": ctx.msg(
                    "Загрузка обновлений разрешена только непосредственно на компьютере",
                    "Downloading updates is allowed only directly on the host computer",
                    req_lang,
                ),
            },
            status=403,
        )
        return True
    if not handler._require_kids_pin_if_locked(str(body.get("pin") or ""), lang=req_lang):
        return True
    res_dl = ctx.app_updater.start_download()
    handler._send_json(res_dl, status=200 if res_dl.get("ok") else 400)
    return True


def handle_system_update_open_post(handler, qs, parsed, body, ctx):
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._is_loopback_client():
        handler._send_json(
            {
                "ok": False,
                "error": ctx.msg(
                    "Запуск установщика разрешён только непосредственно на компьютере",
                    "Launching the installer is allowed only directly on the host computer",
                    req_lang,
                ),
            },
            status=403,
        )
        return True
    if not handler._require_kids_pin_if_locked(str(body.get("pin") or ""), lang=req_lang):
        return True
    res_open = ctx.app_updater.open_installer(auto_reveal=bool(body.get("reveal", False)))
    handler._send_json(res_open, status=200 if res_open.get("ok") else 400)
    return True


def handle_stream_embed_open_post(handler, qs, parsed, body, ctx):
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._is_loopback_client():
        handler._send_json(
            {
                "ok": False,
                "error": ctx.msg(
                    "Встроенное окно стриминга доступно только на самом компьютере",
                    "Embedded streaming stage is available only on the host computer",
                    req_lang,
                ),
            },
            status=403,
        )
        return True
    raw_url = str(body.get("url") or "").strip()
    if not _is_allowed_stream_embed_url(raw_url):
        handler._send_json(
            {
                "ok": False,
                "error": ctx.msg(
                    "Недопустимый адрес официального стриминга",
                    "Invalid official streaming service URL",
                    req_lang,
                ),
            },
            status=400,
        )
        return True

    rect = body.get("rect") if isinstance(body.get("rect"), dict) else {}
    try:
        win_x = max(0, min(7680, int(round(float(rect.get("screenX", 140))))))
        win_y = max(0, min(4320, int(round(float(rect.get("screenY", 120))))))
        win_w = max(480, min(3840, int(round(float(rect.get("width", 1120))))))
        win_h = max(270, min(2160, int(round(float(rect.get("height", 630))))))
    except Exception:
        win_x, win_y, win_w, win_h = 140, 120, 1120, 630

    root_dir = getattr(ctx, "base_dir", "") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    win_launcher = os.path.join(root_dir, "Velarium.exe") if os.name == "nt" else ""

    if win_launcher and os.path.isfile(win_launcher):
        cmd = [
            win_launcher,
            "--stream-window",
            raw_url,
            str(win_x),
            str(win_y),
            str(win_w),
            str(win_h),
        ]
    else:
        browser_exe = _find_desktop_chromium_executable()
        if not browser_exe:
            handler._send_json({"ok": False, "fallback": "popup", "url": raw_url}, status=200)
            return True

        profile_dir = os.path.join(ctx.data_dir, "StreamEmbedProfile")
        try:
            os.makedirs(profile_dir, exist_ok=True)
        except Exception:
            pass

        cmd = [
            browser_exe,
            f"--app={raw_url}",
            f"--user-data-dir={profile_dir}",
            f"--window-position={win_x},{win_y}",
            f"--window-size={win_w},{win_h}",
            "--no-first-run",
            "--no-default-browser-check",
        ]

    _close_active_stream_embed_proc()
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
        )
        global _ACTIVE_STREAM_EMBED_PROC
        with _STREAM_EMBED_LOCK:
            _ACTIVE_STREAM_EMBED_PROC = proc
        handler._send_json({"ok": True, "mode": "chromium_app", "url": raw_url})
    except Exception as exc:
        handler._send_json({"ok": False, "fallback": "popup", "url": raw_url, "detail": str(exc)}, status=200)
    return True


def handle_stream_embed_close_post(handler, qs, parsed, body, ctx):
    if not handler._is_loopback_client():
        handler._send_json({"ok": False}, status=403)
        return True
    _close_active_stream_embed_proc()
    handler._send_json({"ok": True})
    return True


def handle_settings_post(handler, qs, parsed, body, ctx):
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True
    non_lang_keys = set(body.keys()) - {"app_lang", "lang", "pin", "current_pin", "k"}
    if non_lang_keys:
        if not handler._require_kids_pin_if_locked(
            str(body.get("pin") or body.get("current_pin") or ""), lang=req_lang
        ):
            return True
    is_local = handler._is_loopback_client()
    if "app_lang" in body:
        ctx.app_prefs["app_lang"] = ctx.norm_app_lang(body.get("app_lang"), app_lang)
        ctx.remote_broker.set_app_lang(ctx.app_prefs["app_lang"])
    if "setup_completed" in body:
        ctx.app_prefs["setup_completed"] = bool(body.get("setup_completed"))
    if "auto_check_updates" in body and is_local:
        ctx.app_prefs["auto_check_updates"] = bool(body.get("auto_check_updates"))
    if "update_repo" in body and is_local:
        ctx.app_prefs["update_repo"] = str(body.get("update_repo") or "").strip()[:160]
    if "update_manifest_url" in body and is_local:
        raw_m_url = str(body.get("update_manifest_url") or "").strip()[:512]
        if raw_m_url and not raw_m_url.lower().startswith(("https://", "http://")):
            raw_m_url = ""
        ctx.app_prefs["update_manifest_url"] = raw_m_url
    rezka_cfg = body.get("hdrezka", {})
    has_explicit_spoof = isinstance(rezka_cfg, dict) and bool(rezka_cfg.get("spoof_region"))
    if "user_country" in body:
        auto_bypass = bool(body.get("auto_adjust_bypass", not has_explicit_spoof))
        adjust_local_srv = bool(body.get("adjust_local_services", False))
        ctx.apply_user_country(
            str(body.get("user_country") or ctx.app_prefs.get("user_country", "PL")),
            adjust_bypass=auto_bypass,
            adjust_local_services=adjust_local_srv,
            persist_integrations=True,
        )
    enabled_services = body.get("enabled_services")
    if isinstance(enabled_services, dict) and enabled_services:
        ctx.kinorium_service.set_services_enabled_bulk(enabled_services)
    if isinstance(rezka_cfg, dict) and rezka_cfg:
        ctx.rezka_client.configure(
            custom_mirror=rezka_cfg.get("custom_mirror") if is_local else None,
            proxy_url=rezka_cfg.get("proxy_url") if is_local else None,
            cf_worker_relay=rezka_cfg.get("cf_worker_relay") if is_local else None,
            spoof_region=rezka_cfg.get("spoof_region"),
            preferred_studios=rezka_cfg.get("preferred_studios"),
        )
    bkp_cfg = body.get("backup_stream", {})
    if isinstance(bkp_cfg, dict) and bkp_cfg and is_local:
        ctx.backup_stream_engine.configure(
            mode=bkp_cfg.get("mode"),
            debrid_api_key=bkp_cfg.get("debrid_api_key"),
            torrserver_url=bkp_cfg.get("torrserver_url"),
        )
        ctx.backup_stream_engine.apply_country_policy(bool(getattr(ctx.net_client, "p2p_strict", False)))
        if ctx.backup_stream_engine.mode == "torrserver":
            ctx.backup_stream_engine.ensure_local_torrserver()
    if isinstance(body.get("stremio_addons"), list) and is_local:
        ctx.stremio_engine.restore_addons(body["stremio_addons"])
    ctx.save_persisted_server_settings()
    kin_cfg = body.get("kinorium", {})
    if isinstance(kin_cfg, dict) and kin_cfg and is_local:
        ctx.kinorium_service.configure_account(
            username=kin_cfg.get("username", ""),
            session_cookie=kin_cfg.get("session_cookie", ""),
            threshold=ctx.safe_float(kin_cfg.get("auto_scrobble_threshold"), 0.95),
        )
    ctx.aggregator.invalidate_catalog_cache()
    cur_cc = normalize_country_code(ctx.app_prefs.get("user_country", "PL"))
    country_prof = get_country_profile(cur_cc, lang=str(ctx.app_prefs.get("app_lang") or "ru"))
    handler._send_json(
        {
            "ok": True,
            "app_lang": ctx.app_prefs.get("app_lang", "ru"),
            "user_country": country_prof["code"],
            "setup_completed": bool(ctx.app_prefs.get("setup_completed", False)),
            "country_profile": country_prof,
            "hdrezka": {
                "custom_mirror": ctx.rezka_client.custom_mirror if is_local else "",
                "proxy_url": ctx.rezka_client.proxy_url if is_local else "",
                "cf_worker_relay": ctx.rezka_client.cf_worker_relay if is_local else "",
                "spoof_region": ctx.rezka_client.spoof_region,
                "preferred_studios": ctx.rezka_client.preferred_studios,
                "active_mirrors": ctx.rezka_client.get_mirrors(),
            },
            "integrations": ctx.kinorium_service.get_integrations(),
            "kinorium_account": ctx.kinorium_service.get_account_summary(),
            "backup_stream": {
                "mode": ctx.backup_stream_engine.mode,
                "p2p_strict": bool(getattr(ctx.net_client, "p2p_strict", False)),
                "torrserver_url": ctx.backup_stream_engine.torrserver_url if is_local else "http://127.0.0.1:8090",
                "torrserver_connected": ctx.backup_stream_engine._is_torrserver_alive_cached(),
                "debrid_configured": bool(ctx.backup_stream_engine.debrid_api_key),
            },
        }
    )
    return True
