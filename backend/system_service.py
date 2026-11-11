"""
Velarium System Service
Encapsulates system status monitoring, hardware capability detection,
QR code generation, and dynamic LAN HTTP listener synchronization.
"""

import os
import sys
import threading
from typing import Any, Callable, Dict, Optional


def build_system_status_payload(
    server_runtime: Dict[str, Any],
    app_prefs: Dict[str, Any],
    app_version: str,
    detect_lan_fn: Callable[[], str],
    remux_engine: Any,
    kinorium_auth_manager: Any,
    app_updater: Any,
    profile_manager: Any,
    kinorium_service: Any,
    is_local_client: bool = True,
    base_dir: str = "",
    norm_lang_fn: Optional[Callable[[Any, str], str]] = None,
    autostart_supported_fn: Optional[Callable[[], bool]] = None,
    autostart_enabled_fn: Optional[Callable[[], bool]] = None,
    generate_qr_svg_fn: Optional[Callable[..., str]] = None,
) -> Dict[str, Any]:
    """
    Builds the comprehensive /api/system/status diagnostic payload,
    including network bindings, hardware acceleration capabilities,
    updater status, and active user profile.
    """
    lan_ip = detect_lan_fn() if detect_lan_fn else ""
    port = int(server_runtime.get("port") or 8765)
    lan_enabled = bool(app_prefs.get("lan_access", False))
    lan_url = f"http://{lan_ip}:{port}" if lan_ip else ""

    qr_svg = ""
    if lan_url and generate_qr_svg_fn:
        try:
            qr_svg = generate_qr_svg_fn(lan_url, quiet_zone=3)
        except Exception:
            qr_svg = ""

    autostart_supp = autostart_supported_fn() if autostart_supported_fn else False
    autostart_en = autostart_enabled_fn() if autostart_enabled_fn else False
    hw_caps = remux_engine.get_hw_capabilities() if hasattr(remux_engine, "get_hw_capabilities") else {}
    kin_one_click = kinorium_auth_manager.is_supported() if hasattr(kinorium_auth_manager, "is_supported") else False

    macos_app_built = False
    if base_dir:
        macos_app_built = os.path.isdir(os.path.join(base_dir, "dist", "Velarium.app")) or os.path.isdir(
            os.path.join(base_dir, "dist", "CineFlow.app")
        )

    norm_lang = (
        norm_lang_fn(app_prefs.get("app_lang"), "ru")
        if norm_lang_fn
        else str(app_prefs.get("app_lang") or "ru")
    )
    updater_status = (
        app_updater.get_status(redact_local_paths=not is_local_client)
        if hasattr(app_updater, "get_status")
        else {}
    )
    active_profile = (
        profile_manager.get_active_profile(
            lang=norm_lang,
            live_kinorium_service=kinorium_service,
        )
        if hasattr(profile_manager, "get_active_profile")
        else {}
    )

    return {
        "app": "velarium",
        "version": app_version,
        "platform": sys.platform,
        "is_macos": sys.platform == "darwin",
        "is_windows": sys.platform == "win32",
        "is_local_client": bool(is_local_client),
        "lan_enabled": lan_enabled,
        "bind_host": str(server_runtime.get("host") or ("0.0.0.0" if lan_enabled else "127.0.0.1")),
        "port": port,
        "lan_ip": lan_ip,
        "lan_url": lan_url,
        "qr_svg": qr_svg,
        "autostart_supported": autostart_supp,
        "autostart_enabled": autostart_en,
        "hw_accel": hw_caps,
        "kinorium_one_click_supported": kin_one_click,
        "macos_app_built": macos_app_built,
        "auto_check_updates": bool(app_prefs.get("auto_check_updates", True)),
        "update_repo": str(app_prefs.get("update_repo") or "") if is_local_client else "",
        "update_manifest_url": str(app_prefs.get("update_manifest_url") or "") if is_local_client else "",
        "updater": updater_status,
        "active_profile": active_profile,
    }


def sync_lan_listener(
    lan_enabled: bool,
    server_runtime: Dict[str, Any],
    detect_lan_fn: Callable[[], str],
    server_class: Any,
    handler_class: Any,
    poll_interval: float = 0.15,
    app_prefs: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Dynamically binds or unbinds the secondary HTTP listener on the local LAN IPv4 address.
    Allows home network devices (Apple TV, smart TVs, phone remotes) to access the cinema server.
    """
    port = int(server_runtime.get("port") or 8765)
    lan_ip = detect_lan_fn() if detect_lan_fn else ""
    with server_runtime["lock"]:
        existing = server_runtime.get("lan_server")
        existing_ip = server_runtime.get("lan_bound_ip")
        if not lan_enabled or not lan_ip:
            server_runtime["lan_server"] = None
            server_runtime["lan_bound_ip"] = ""
            server_runtime["host"] = "127.0.0.1"
        elif existing is not None and existing_ip == lan_ip:
            server_runtime["host"] = "0.0.0.0"
            return
        else:
            server_runtime["lan_server"] = None
            server_runtime["lan_bound_ip"] = ""

    if existing is not None:
        def _shut_srv(srv_to_close):
            try:
                srv_to_close.shutdown()
                srv_to_close.server_close()
            except Exception:
                pass
        threading.Thread(target=_shut_srv, args=(existing,), daemon=True, name="VelariumLanShutdown").start()

    if lan_enabled and lan_ip:
        try:
            lan_srv = server_class((lan_ip, port), handler_class)
            should_start = True
            with server_runtime["lock"]:
                if app_prefs is not None and not bool(app_prefs.get("lan_access", False)):
                    should_start = False
                else:
                    server_runtime["lan_server"] = lan_srv
                    server_runtime["lan_bound_ip"] = lan_ip
                    server_runtime["host"] = "0.0.0.0"
            if not should_start:
                try:
                    lan_srv.server_close()
                except Exception:
                    pass
                return
            threading.Thread(
                target=lan_srv.serve_forever,
                kwargs={"poll_interval": poll_interval},
                name="VelariumLanHTTP",
                daemon=True,
            ).start()
        except Exception as exc:
            sys.stderr.write(f"[Velarium] Failed to bind LAN listener on {lan_ip}:{port}: {exc}\n")


class SystemService:
    """
    Service facade consolidating system diagnostics, status reporting,
    and network listener synchronization.
    """
    def __init__(
        self,
        server_runtime: Dict[str, Any],
        app_prefs: Dict[str, Any],
        app_version: str,
        base_dir: str,
        detect_lan_fn: Callable[[], str],
        remux_engine: Any,
        kinorium_auth_manager: Any,
        app_updater: Any,
        profile_manager: Any,
        kinorium_service: Any,
        server_class: Any,
        handler_class: Any,
        autostart_supported_fn: Optional[Callable[[], bool]] = None,
        autostart_enabled_fn: Optional[Callable[[], bool]] = None,
        norm_lang_fn: Optional[Callable[[Any, str], str]] = None,
        generate_qr_svg_fn: Optional[Callable[..., str]] = None,
    ) -> None:
        self.server_runtime = server_runtime
        self.app_prefs = app_prefs
        self.app_version = app_version
        self.base_dir = base_dir
        self.detect_lan_fn = detect_lan_fn
        self.remux_engine = remux_engine
        self.kinorium_auth_manager = kinorium_auth_manager
        self.app_updater = app_updater
        self.profile_manager = profile_manager
        self.kinorium_service = kinorium_service
        self.server_class = server_class
        self.handler_class = handler_class
        self.autostart_supported_fn = autostart_supported_fn
        self.autostart_enabled_fn = autostart_enabled_fn
        self.norm_lang_fn = norm_lang_fn
        self.generate_qr_svg_fn = generate_qr_svg_fn

    def get_status_payload(self, is_local_client: bool = True) -> Dict[str, Any]:
        return build_system_status_payload(
            server_runtime=self.server_runtime,
            app_prefs=self.app_prefs,
            app_version=self.app_version,
            detect_lan_fn=self.detect_lan_fn,
            remux_engine=self.remux_engine,
            kinorium_auth_manager=self.kinorium_auth_manager,
            app_updater=self.app_updater,
            profile_manager=self.profile_manager,
            kinorium_service=self.kinorium_service,
            is_local_client=is_local_client,
            base_dir=self.base_dir,
            norm_lang_fn=self.norm_lang_fn,
            autostart_supported_fn=self.autostart_supported_fn,
            autostart_enabled_fn=self.autostart_enabled_fn,
            generate_qr_svg_fn=self.generate_qr_svg_fn,
        )

    def sync_lan_listener(self, lan_enabled: bool) -> None:
        sync_lan_listener(
            lan_enabled=lan_enabled,
            server_runtime=self.server_runtime,
            detect_lan_fn=self.detect_lan_fn,
            server_class=self.server_class,
            handler_class=self.handler_class,
            app_prefs=self.app_prefs,
        )
