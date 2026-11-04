"""
CineFlow Profiles Route Handlers
Dispatches /api/profiles and /api/profiles/* requests.
"""

from typing import Any, Dict


def handle_profiles_get(handler, qs: Dict[str, Any], parsed, ctx) -> bool:
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(qs.get("lang", [app_lang])[0], app_lang)
    handler._send_json(
        ctx.profile_manager.get_profiles_payload(
            lang=req_lang,
            live_kinorium_service=ctx.kinorium_service,
        )
    )
    return True


def handle_profiles_verify_pin(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True
    pin_val = str(body.get("pin") or body.get("current_pin") or "").strip()
    target_prof_id = str(body.get("profile_id") or "").strip() or None
    matched = ctx.profile_manager.verify_active_kids_pin(pin_val, profile_id=target_prof_id)
    if not matched:
        lock_rem = ctx.profile_manager.get_pin_lockout_remaining(target_prof_id)
        if lock_rem > 0:
            sec = int(lock_rem) + 1
            handler._send_json(
                {
                    "ok": False,
                    "pin_required": True,
                    "pin_locked_out": True,
                    "locked_seconds": sec,
                    "error": ctx.msg(
                        f"Слишком много неверных попыток PIN-кода — подождите {sec} секунд",
                        f"Too many failed PIN attempts — please wait {sec} seconds",
                        req_lang,
                    ),
                },
                status=429,
            )
            return True
        handler._send_json(
            {
                "ok": False,
                "pin_required": True,
                "error": ctx.msg("Неверный PIN-код детского профиля", "Incorrect Kids profile PIN", req_lang),
            },
            status=403,
        )
        return True
    handler._send_json({"ok": True})
    return True


def handle_profiles_switch(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True
    target_id = str(body.get("profile_id") or body.get("id") or "main").strip()
    pin_val = str(body.get("pin") or "").strip()
    try:
        switched = ctx.profile_manager.switch_profile(target_id, pin=pin_val)
        st_path = ctx.profile_manager.get_kinorium_state_path(switched["id"])
        acc = ctx.kinorium_service.switch_state_file(st_path)
        ctx.aggregator.invalidate_catalog_cache()
        prof_payload = ctx.profile_manager.get_profiles_payload(
            lang=req_lang,
            live_kinorium_service=ctx.kinorium_service,
        )
        handler._send_json(
            {
                **prof_payload,
                "kinorium_account": acc,
                "integrations": ctx.kinorium_service.get_integrations(),
                "kinorium_counts": ctx.kinorium_service.get_sections_counts(),
            }
        )
    except PermissionError:
        lock_rem = ctx.profile_manager.get_pin_lockout_remaining()
        if lock_rem > 0:
            sec = int(lock_rem) + 1
            handler._send_json(
                {
                    "ok": False,
                    "pin_required": True,
                    "pin_locked_out": True,
                    "locked_seconds": sec,
                    "error": ctx.msg(
                        f"Слишком много неверных попыток PIN-кода — подождите {sec} секунд",
                        f"Too many failed PIN attempts — please wait {sec} seconds",
                        req_lang,
                    ),
                },
                status=429,
            )
            return True
        handler._send_json(
            {
                "ok": False,
                "pin_required": True,
                "error": ctx.msg(
                    "Для выхода из детского профиля введите 4-значный PIN-код",
                    "Enter the 4-digit PIN to exit the Kids profile",
                ),
            },
            status=403,
        )
    except Exception as exc:
        handler._send_json({"ok": False, "error": str(exc)}, status=400)
    return True


def handle_profiles_save(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True
    try:
        edit_id = str(body.get("id") or "").strip()
        kids_arg = body.get("kids_mode")
        kids_pin_arg = body.get("kids_pin") if "kids_pin" in body else None
        current_pin = str(body.get("current_pin") or body.get("pin") or "").strip()
        act_prof = ctx.profile_manager.get_active_profile(lang=req_lang)
        # Prevent bypassing or mutating an active PIN-locked Kids profile without verifying current_pin
        if act_prof.get("kids_mode") and act_prof.get("has_kids_pin"):
            if not handler._require_kids_pin_if_locked(
                current_pin,
                "Введите текущий 4-значный PIN-код для управления профилями из детского режима",
                "Enter the current 4-digit PIN to manage profiles from Kids Mode",
                req_lang,
            ):
                return True

        saved_prof = ctx.profile_manager.save_profile(
            profile_id=edit_id,
            name=str(body.get("name") or ""),
            avatar_color=str(body.get("avatar_color") or ""),
            kids_mode=bool(kids_arg) if isinstance(kids_arg, bool) else None,
            kids_pin=str(kids_pin_arg) if kids_pin_arg is not None else None,
            default_audio_pref=str(body.get("default_audio_pref") or "") or None,
            icon=str(body.get("icon") or ""),
            pin=current_pin,
        )
        if body.get("activate"):
            ctx.profile_manager.switch_profile(saved_prof["id"], pin=current_pin)
            ctx.kinorium_service.switch_state_file(ctx.profile_manager.get_kinorium_state_path(saved_prof["id"]))
        ctx.aggregator.invalidate_catalog_cache()
        prof_payload = ctx.profile_manager.get_profiles_payload(
            lang=req_lang,
            live_kinorium_service=ctx.kinorium_service,
        )
        handler._send_json(
            {
                **prof_payload,
                "saved_profile": ctx.profile_manager.format_profile_for_client(
                    saved_prof,
                    lang=req_lang,
                    live_kinorium_service=ctx.kinorium_service,
                ),
                "kinorium_account": ctx.kinorium_service.get_account_summary(),
                "integrations": ctx.kinorium_service.get_integrations(),
            }
        )
    except PermissionError:
        lock_rem = ctx.profile_manager.get_pin_lockout_remaining(edit_id or None)
        if lock_rem > 0:
            sec = int(lock_rem) + 1
            handler._send_json(
                {
                    "ok": False,
                    "pin_required": True,
                    "pin_locked_out": True,
                    "locked_seconds": sec,
                    "error": ctx.msg(
                        f"Слишком много неверных попыток PIN-кода — подождите {sec} секунд",
                        f"Too many failed PIN attempts — please wait {sec} seconds",
                        req_lang,
                    ),
                },
                status=429,
            )
            return True
        handler._send_json(
            {
                "ok": False,
                "pin_required": True,
                "error": ctx.msg(
                    "Введите 4-значный PIN-код детского профиля",
                    "Enter the 4-digit Kids profile PIN",
                    req_lang,
                ),
            },
            status=403,
        )
    except Exception as exc:
        handler._send_json({"ok": False, "error": str(exc)}, status=400)
    return True


def handle_profiles_delete(handler, qs: Dict[str, Any], parsed, body: Dict[str, Any], ctx) -> bool:
    app_lang = ctx.app_prefs.get("app_lang", "ru")
    req_lang = ctx.norm_app_lang(body.get("lang", app_lang), app_lang)
    if not handler._require_authorized_client_if_lan(body, lang=req_lang):
        return True
    raw_target_id = str(body.get("id") or body.get("profile_id") or "").strip()
    target_id = ctx.profile_manager._sanitize_profile_id(raw_target_id)
    pin_val = str(body.get("pin") or body.get("current_pin") or "").strip()
    try:
        was_active = bool(target_id and ctx.profile_manager.get_active_profile_id() == target_id)
        if was_active or ctx.profile_manager.is_active_kids_pin_locked():
            if not handler._require_kids_pin_if_locked(
                pin_val,
                "Введите 4-значный PIN-код детского профиля",
                "Enter the 4-digit Kids profile PIN",
                req_lang,
            ):
                return True
        if was_active:
            ctx.kinorium_service.switch_state_file(
                ctx.profile_manager.get_kinorium_state_path("main"),
                force_reload=True,
                discard_dirty=True,
            )
        deleted = ctx.profile_manager.delete_profile(target_id, pin=pin_val)
        if deleted:
            ctx.download_manager.delete_profile_downloads(target_id)
        ctx.aggregator.invalidate_catalog_cache()
        prof_payload = ctx.profile_manager.get_profiles_payload(
            lang=req_lang,
            live_kinorium_service=ctx.kinorium_service,
        )
        handler._send_json(
            {
                **prof_payload,
                "deleted": deleted,
                "kinorium_account": ctx.kinorium_service.get_account_summary(),
                "integrations": ctx.kinorium_service.get_integrations(),
            }
        )
    except PermissionError:
        lock_rem = ctx.profile_manager.get_pin_lockout_remaining(target_id or None)
        if lock_rem > 0:
            sec = int(lock_rem) + 1
            handler._send_json(
                {
                    "ok": False,
                    "pin_required": True,
                    "pin_locked_out": True,
                    "locked_seconds": sec,
                    "error": ctx.msg(
                        f"Слишком много неверных попыток PIN-кода — подождите {sec} секунд",
                        f"Too many failed PIN attempts — please wait {sec} seconds",
                        req_lang,
                    ),
                },
                status=429,
            )
            return True
        handler._send_json(
            {
                "ok": False,
                "pin_required": True,
                "error": ctx.msg(
                    "Введите 4-значный PIN-код детского профиля",
                    "Enter the 4-digit Kids profile PIN",
                    req_lang,
                ),
            },
            status=403,
        )
    except Exception as exc:
        handler._send_json({"ok": False, "error": str(exc)}, status=400)
    return True
