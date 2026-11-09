"""
Modular route handlers for Backup & Restore endpoints:
- GET /api/backup/export
- POST /api/backup/import
"""

from __future__ import annotations

import json
import os
import time
from typing import Any, Dict


def handle_backup_export(handler: Any, qs: Dict[str, Any], parsed: Any, ctx: Any) -> None:
    if not handler._require_authorized_client_if_lan():
        return
    pin_q = qs.get("pin", [""])[0].strip()
    if not handler._require_kids_pin_if_locked(
        pin_q,
        "Для экспорта резервной копии введите 4-значный PIN-код детского профиля",
        "Enter the 4-digit Kids profile PIN to export backup",
    ):
        return
    is_local = handler._is_loopback_client()
    act_prof_id = ctx.profile_manager.get_active_profile_id()
    profiles_bundle = ctx.profile_manager.export_profiles_bundle(redact_secrets=not is_local)
    if act_prof_id == "main":
        main_kin_state = ctx.kinorium_service.export_backup_state(redact_secrets=not is_local)
    else:
        profiles_bundle.setdefault("secondary_kinorium_states", {})[
            act_prof_id
        ] = ctx.kinorium_service.export_backup_state(redact_secrets=not is_local)
        main_st_path = ctx.profile_manager.get_kinorium_state_path("main")
        main_kin_state = {}
        try:
            db_main = ctx.storage_db.load_profile_state("main")
        except Exception:
            db_main = None
        if isinstance(db_main, dict) and db_main:
            main_kin_state = dict(db_main)
        elif os.path.isfile(main_st_path):
            try:
                with open(main_st_path, "r", encoding="utf-8") as mf:
                    loaded_main = json.load(mf)
                if isinstance(loaded_main, dict):
                    main_kin_state = dict(loaded_main)
            except Exception:
                main_kin_state = {}
        if not is_local and isinstance(main_kin_state.get("account"), dict):
            main_acc = dict(main_kin_state["account"])
            main_acc.pop("session_cookie", None)
            main_acc.pop("auth_token", None)
            main_kin_state["account"] = main_acc
    handler._send_json(
        {
            "app": "Velarium",
            "version": "2.7",
            "exported_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "app_lang": ctx.app_prefs.get("app_lang", "ru"),
            "user_country": ctx.app_prefs.get("user_country", "PL"),
            "setup_completed": bool(ctx.app_prefs.get("setup_completed", False)),
            "hdrezka": {
                "custom_mirror": ctx.rezka_client.custom_mirror if is_local else "",
                "proxy_url": ctx.rezka_client.proxy_url if is_local else "",
                "cf_worker_relay": ctx.rezka_client.cf_worker_relay if is_local else "",
                "spoof_region": ctx.rezka_client.spoof_region,
                "preferred_studios": ctx.rezka_client.preferred_studios,
            },
            "backup_stream": {
                "mode": ctx.backup_stream_engine.mode,
                "torrserver_url": ctx.backup_stream_engine.torrserver_url if is_local else "http://127.0.0.1:8090",
                "debrid_api_key": ctx.backup_stream_engine.debrid_api_key if is_local else "",
            },
            "kinorium_state": main_kin_state,
            "profiles_bundle": profiles_bundle,
            "stremio_addons": ctx.redact_stremio_addons_for_client(
                ctx.stremio_engine.get_addons(lang=ctx.app_prefs.get("app_lang", "ru")),
                is_local,
            ),
        }
    )
    return True


def handle_backup_import(handler: Any, qs: Dict[str, Any], parsed: Any, body: Dict[str, Any], ctx: Any) -> bool:
    if not handler._require_authorized_client_if_lan(body):
        return True
    import_pin = str(body.get("pin") or body.get("current_pin") or "").strip()
    if not handler._require_kids_pin_if_locked(
        import_pin,
        "Для импорта резервной копии сначала введите 4-значный PIN-код детского профиля",
        "Enter the 4-digit Kids profile PIN before importing a backup",
    ):
        return True
    if isinstance(body.get("profiles_bundle"), dict) and ctx.profile_manager.has_any_kids_pin_locked_profile():
        lock_rem = max(
            ctx.profile_manager.get_pin_lockout_remaining("main"),
            ctx.profile_manager.get_pin_lockout_remaining(ctx.profile_manager.get_active_profile_id()),
        )
        if lock_rem > 0:
            handler._send_json(
                {
                    "ok": False,
                    "pin_required": True,
                    "lockout_seconds": lock_rem,
                    "error": ctx.msg(
                        f"Слишком много неверных попыток PIN-кода — подождите {int(lock_rem) + 1} секунд",
                        f"Too many failed PIN attempts — please wait {int(lock_rem) + 1} seconds",
                    ),
                },
                status=429,
            )
            return True
        if not ctx.profile_manager.verify_any_kids_pin(import_pin):
            ctx.profile_manager._record_pin_failure("main")
            handler._send_json(
                {
                    "ok": False,
                    "pin_required": True,
                    "error": ctx.msg(
                        "Для импорта резервной копии сначала введите 4-значный PIN-код детского профиля",
                        "Enter the 4-digit Kids profile PIN before importing a backup",
                    ),
                },
                status=403,
            )
            return True
    is_local = handler._is_loopback_client()
    if isinstance(body.get("profiles_bundle"), dict):
        try:
            ctx.profile_manager.import_profiles_bundle(
                body["profiles_bundle"],
                redact_secrets=not is_local,
                enforce_pin=True,
                pin=import_pin,
            )
        except ValueError as exc:
            handler._send_json(
                {
                    "ok": False,
                    "pin_required": True,
                    "error": str(exc),
                },
                status=403,
            )
            return True
    if "app_lang" in body:
        ctx.app_prefs["app_lang"] = ctx.norm_app_lang(body.get("app_lang"), ctx.app_prefs.get("app_lang", "ru"))
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
    if "user_country" in body:
        ctx.apply_user_country(
            str(body.get("user_country") or "PL"),
            adjust_bypass=True,
            adjust_local_services=False,
            persist_integrations=False,
        )
    rezka_cfg = body.get("hdrezka") or {}
    if isinstance(rezka_cfg, dict) and rezka_cfg:
        ctx.rezka_client.configure(
            custom_mirror=rezka_cfg.get("custom_mirror") if is_local else None,
            proxy_url=rezka_cfg.get("proxy_url") if is_local else None,
            cf_worker_relay=rezka_cfg.get("cf_worker_relay") if is_local else None,
            spoof_region=rezka_cfg.get("spoof_region"),
            preferred_studios=rezka_cfg.get("preferred_studios"),
        )
    bkp_cfg = body.get("backup_stream") or {}
    if isinstance(bkp_cfg, dict) and bkp_cfg and is_local:
        ctx.backup_stream_engine.configure(
            mode=bkp_cfg.get("mode"),
            debrid_api_key=bkp_cfg.get("debrid_api_key"),
            torrserver_url=bkp_cfg.get("torrserver_url"),
        )
    if isinstance(body.get("stremio_addons"), list) and is_local:
        ctx.stremio_engine.restore_addons(body["stremio_addons"])
    ctx.save_persisted_server_settings()
    act_after_import = ctx.profile_manager.get_active_profile_id()
    k_state = body.get("kinorium_state")
    if isinstance(k_state, dict) and k_state:
        if not is_local and isinstance(k_state.get("account"), dict):
            safe_k_state = dict(k_state)
            safe_k_acc = dict(k_state["account"])
            safe_k_acc.pop("session_cookie", None)
            safe_k_acc.pop("auth_token", None)
            safe_k_state["account"] = safe_k_acc
            k_state = safe_k_state
        if act_after_import == "main":
            ctx.kinorium_service.switch_state_file(
                ctx.profile_manager.get_kinorium_state_path("main"),
                force_reload=True,
                discard_dirty=True,
            )
            acc = ctx.kinorium_service.import_backup_state(k_state)
        else:
            try:
                ctx.storage_db.save_profile_state("main", k_state)
            except Exception:
                pass
            acc = ctx.kinorium_service.switch_state_file(
                ctx.profile_manager.get_kinorium_state_path(act_after_import),
                force_reload=True,
                discard_dirty=True,
            )
    else:
        acc = ctx.kinorium_service.switch_state_file(
            ctx.profile_manager.get_kinorium_state_path(act_after_import),
            force_reload=True,
            discard_dirty=True,
        )
    ctx.aggregator.invalidate_catalog_cache()
    with ctx.kinorium_service._state_lock:
        total_watched = len(ctx.kinorium_service.state.get("remote_watched_items") or {}) + len(
            ctx.kinorium_service.state.get("watched") or {}
        )
        ratings_cnt = len(ctx.kinorium_service.state.get("ratings") or {}) + len(
            ctx.kinorium_service.state.get("remote_watched_items") or {}
        )
        cw_cnt = len(ctx.kinorium_service.state.get("continue_watching") or [])
    handler._send_json(
        {
            "ok": True,
            "kinorium_account": acc,
            "integrations": ctx.kinorium_service.get_integrations(),
            "profiles": ctx.profile_manager.get_profiles_payload(
                lang=ctx.app_prefs.get("app_lang", "ru"),
                live_kinorium_service=ctx.kinorium_service,
            ),
            "restored": {
                "ratings_count": ratings_cnt,
                "continue_watching_count": cw_cnt,
                "watched_count": total_watched,
            },
        }
    )
    return True


BACKUP_GET_ROUTES = {
    "/api/backup/export": handle_backup_export,
}

BACKUP_POST_ROUTES = {
    "/api/backup/import": handle_backup_import,
}
