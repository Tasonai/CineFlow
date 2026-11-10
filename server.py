#!/usr/bin/env python3
"""
Velarium Unified Cinema Server
Ultra-compact entry point coordinating domain services, request dispatch,
and server lifecycle.
"""

import os
import sys
import threading
from typing import Any, Dict, List, Optional, Tuple

# Ensure sys.modules["server"] always resolves even when server.py is launched as __main__
sys.modules.setdefault("server", sys.modules[__name__])

from backend.app_factory import create_velarium_services
from backend.autostart import (
    _build_windows_autostart_command,
    is_macos_autostart_enabled,
    is_system_autostart_enabled,
    is_system_autostart_supported,
    is_windows_autostart_enabled,
    set_macos_autostart,
    set_system_autostart,
    set_windows_autostart,
)
from backend.bootstrap import (
    ensure_bin_in_path,
    ensure_safe_std_streams,
    make_safe_logger,
    resolve_runtime_paths,
    safe_int as _safe_int,
)
from backend.catalog_helpers import redact_stremio_addons_for_client as _backend_redact_stremio_addons_for_client
from backend.net_security import (
    _DEFAULT_SAFE_PUBLIC_OPENER,
    _SHARED_VERIFIED_SSL_CTX,
    connect_strictly_public_socket as _connect_strictly_public_socket,
    is_allowed_media_source_url as _net_is_allowed_media_source_url,
    is_strictly_public_ip_obj as _is_strictly_public_ip_obj,
    open_safe_public_url as _net_open_safe_public_url,
)
from backend.qrcode_svg import detect_lan_ipv4, generate_qr_svg
from backend.remote_control import DesktopRemoteBroker
from backend.routes import ServerContext, terminate_active_remux_procs
from backend.routes.static_files import (
    load_cached_static_file as _backend_load_cached_static_file,
    serve_static_file as _backend_serve_static_file,
    transform_index_html as _backend_transform_index_html,
)
from backend.routes.streaming import (
    DEAD_MEDIA_EDGE_IPS,
    MEDIA_EDGE_LOCK,
    VOIDBOOST_EDGE_CACHE,
    _configure_low_latency_socket,
    _connect_media_http,
    _is_voidboost_cdn_host,
    _open_resilient_media_upstream,
    _rewrite_hls_manifest_for_proxy,
    _unwrap_local_proxy_media_url,
    _wrap_voidboost_stream_url,
)
from backend.subtitles import convert_any_subtitle_to_webvtt
from backend.system_service import (
    build_system_status_payload,
    sync_lan_listener as _backend_sync_lan_listener,
)

APP_VERSION = "2.7.13"
_PATHS = resolve_runtime_paths(__file__)
BASE_DIR = _PATHS["base_dir"]
PUBLIC_DIR = _PATHS["public_dir"]
DATA_DIR = _PATHS["data_dir"]
SETTINGS_PATH = _PATHS["settings_path"]
BIN_DIR = _PATHS["bin_dir"]
SETTINGS_SAVE_LOCK = threading.Lock()
ensure_bin_in_path(BIN_DIR)


def _ensure_safe_std_streams() -> None:
    ensure_safe_std_streams(DATA_DIR)


_IS_DAEMON_LOG_MODE = ("--launchd" in sys.argv) and not bool(
    os.environ.get("VELARIUM_VERBOSE_LOG") or os.environ.get("CINEFLOW_VERBOSE_LOG")
)
_safe_log = make_safe_logger(_IS_DAEMON_LOG_MODE)

_ensure_safe_std_streams()

SERVICES = create_velarium_services(
    base_dir=BASE_DIR,
    data_dir=DATA_DIR,
    app_version=APP_VERSION,
    safe_log_fn=_safe_log,
    register_atexit_hooks=True,
)

storage_db = SERVICES.storage_db
net_client = SERVICES.net_client
rezka_client = SERVICES.rezka_client
profile_manager = SERVICES.profile_manager
kinorium_service = SERVICES.kinorium_service
skip_intro_engine = SERVICES.skip_intro_engine
backup_stream_engine = SERVICES.backup_stream_engine
remux_engine = SERVICES.remux_engine
stremio_engine = SERVICES.stremio_engine
subtitle_service = SERVICES.subtitle_service
remote_broker = SERVICES.remote_broker
en_meta_resolver = SERVICES.en_meta_resolver
aggregator = SERVICES.aggregator
download_manager = SERVICES.download_manager
dlna_manager = SERVICES.dlna_manager
kinorium_auth_manager = SERVICES.kinorium_auth_manager
app_updater = SERVICES.app_updater
settings_manager = SERVICES.settings_manager

APP_PREFS = SERVICES.app_prefs
SERVER_RUNTIME = SERVICES.server_runtime
PERSON_PHOTO_BYTES_CACHE = SERVICES.person_photo_cache
PERSON_PHOTO_LOCK = SERVICES.person_photo_lock
LAST_BG_WATCHING_SYNC = SERVICES.last_bg_watching_sync
LAST_STREAM_ACTIVITY_TS: float = 0.0

_resolve_offline_episode_stream = SERVICES.resolve_offline_episode_stream


def _norm_app_lang(val: object, default: str = "ru") -> str:
    return settings_manager.norm_app_lang(val, default)


def apply_user_country(
    country_code: str,
    adjust_bypass: bool = True,
    adjust_local_services: bool = False,
    persist_integrations: bool = True,
) -> Dict[str, Any]:
    return settings_manager.apply_user_country(
        country_code,
        adjust_bypass=adjust_bypass,
        adjust_local_services=adjust_local_services,
        persist_integrations=persist_integrations,
    )


load_persisted_server_settings = settings_manager.load_persisted_server_settings
_msg = settings_manager.msg
save_persisted_server_settings = settings_manager.save_persisted_server_settings
_build_remote_pairing_payload = settings_manager.build_remote_pairing_payload


def get_system_status_payload(is_local_client: bool = True) -> Dict[str, Any]:
    return build_system_status_payload(
        server_runtime=SERVER_RUNTIME,
        app_prefs=APP_PREFS,
        app_version=APP_VERSION,
        detect_lan_fn=detect_lan_ipv4,
        remux_engine=remux_engine,
        kinorium_auth_manager=kinorium_auth_manager,
        app_updater=app_updater,
        profile_manager=profile_manager,
        kinorium_service=kinorium_service,
        is_local_client=is_local_client,
        base_dir=BASE_DIR,
        norm_lang_fn=_norm_app_lang,
        autostart_supported_fn=is_system_autostart_supported,
        autostart_enabled_fn=is_system_autostart_enabled,
        generate_qr_svg_fn=generate_qr_svg,
    )


def _is_allowed_media_source_url(raw_url: str, allow_torrserver_loopback: bool = True) -> bool:
    torr_url = str(getattr(backup_stream_engine, "torrserver_url", None) or "http://127.0.0.1:8090")
    own_p = int(SERVER_RUNTIME.get("port") or 8765)
    return _net_is_allowed_media_source_url(
        raw_url,
        allow_torrserver_loopback=allow_torrserver_loopback,
        torrserver_url=torr_url,
        own_port=own_p,
        net_client=net_client,
    )


def _open_safe_public_url(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 6.0,
    proxy_url: Optional[str] = None,
):
    torr_url = str(getattr(backup_stream_engine, "torrserver_url", None) or "http://127.0.0.1:8090")
    own_p = int(SERVER_RUNTIME.get("port") or 8765)
    return _net_open_safe_public_url(
        url,
        headers=headers,
        timeout=timeout,
        proxy_url=proxy_url,
        allow_torrserver_loopback=False,
        torrserver_url=torr_url,
        own_port=own_p,
        net_client=net_client,
    )


def sync_lan_listener(lan_enabled: bool) -> None:
    _backend_sync_lan_listener(
        lan_enabled=lan_enabled,
        server_runtime=SERVER_RUNTIME,
        detect_lan_fn=detect_lan_ipv4,
        server_class=CinemaThreadingHTTPServer,
        handler_class=CinemaRequestHandler,
    )


def _redact_stremio_addons_for_client(addons: Any, is_local_client: bool) -> List[Dict[str, Any]]:
    return _backend_redact_stremio_addons_for_client(
        addons,
        is_local_client=is_local_client,
        default_addons=getattr(stremio_engine, "DEFAULT_ADDONS", None),
    )


_CONTEXT_ATTR_MAP = {
    "app_prefs": "APP_PREFS",
    "server_runtime": "SERVER_RUNTIME",
    "person_photo_cache": "PERSON_PHOTO_BYTES_CACHE",
    "person_photo_lock": "PERSON_PHOTO_LOCK",
    "last_bg_watching_sync": "LAST_BG_WATCHING_SYNC",
    "base_dir": "BASE_DIR",
    "public_dir": "PUBLIC_DIR",
    "data_dir": "DATA_DIR",
    "settings_path": "SETTINGS_PATH",
    "bin_dir": "BIN_DIR",
}


def _resolve_server_context(name: str) -> Any:
    g = globals()
    if name in _CONTEXT_ATTR_MAP:
        return g.get(_CONTEXT_ATTR_MAP[name])
    if name in g:
        return g[name]
    under_name = f"_{name}"
    if under_name in g:
        return g[under_name]
    return None


SERVER_CONTEXT = ServerContext(services=SERVICES, provider_fn=_resolve_server_context)


def _transform_index_html(raw_bytes: bytes) -> bytes:
    boot_lang = _norm_app_lang(APP_PREFS.get("app_lang"), "ru")
    return _backend_transform_index_html(
        raw_bytes,
        boot_lang=boot_lang,
        setup_completed=bool(APP_PREFS.get("setup_completed")),
    )


def _load_cached_static_file(file_path: str, can_gzip: bool = False) -> Tuple[bytes, bool]:
    return _backend_load_cached_static_file(
        file_path, can_gzip=can_gzip, index_transformer=_transform_index_html
    )


def _serve_static_file_unified(handler: Any, path: str, parsed: Any, head_only: bool = False) -> None:
    _backend_serve_static_file(
        handler,
        path,
        parsed,
        PUBLIC_DIR,
        head_only=head_only,
        index_transformer=_transform_index_html,
    )


from backend.request_handler import (
    CinemaRequestHandler,
    _CACHED_OWN_MDNS_HOSTNAME,
    _compute_own_mdns_hostname,
)

CinemaRequestHandler.set_dependencies(
    context_getter=lambda: SERVER_CONTEXT,
    static_file_server=_serve_static_file_unified,
    safe_log_fn=_safe_log,
    public_dir=PUBLIC_DIR,
)

# Core API routes served via backend.request_handler and backend.routes:
# "/api/catalog", "/api/search", "/api/hdrezka/streams", "/api/subtitles/translate", "/api/settings"


from backend.server_lifecycle import (
    CinemaThreadingHTTPServer,
    is_port_already_serving_velarium,
    is_port_already_serving_velarium as _is_port_already_serving_velarium,
    is_port_already_serving_velarium as _is_port_already_serving_cineflow,
    run_velarium_server,
    start_background_watching_sync_daemon,
    start_lan_ip_watchdog_daemon,
)


def run_server(port: int = 8765) -> None:
    run_velarium_server(
        port=port,
        server_runtime=SERVER_RUNTIME,
        app_prefs=APP_PREFS,
        handler_class=CinemaRequestHandler,
        app_version=APP_VERSION,
        sync_lan_fn=sync_lan_listener,
        ensure_torrserver_fn=backup_stream_engine.ensure_local_torrserver,
        start_bg_watching_fn=lambda: start_background_watching_sync_daemon(
            kinorium_service=kinorium_service,
            aggregator=aggregator,
            rezka_client=rezka_client,
            last_stream_activity_getter=lambda: LAST_STREAM_ACTIVITY_TS,
            last_bg_watching_sync=LAST_BG_WATCHING_SYNC,
            safe_int_fn=_safe_int,
        ),
        start_lan_watchdog_fn=lambda: start_lan_ip_watchdog_daemon(
            server_runtime=SERVER_RUNTIME,
            app_prefs=APP_PREFS,
            detect_lan_fn=detect_lan_ipv4,
            sync_lan_fn=sync_lan_listener,
        ),
        detect_lan_fn=detect_lan_ipv4,
        terminate_remux_fn=terminate_active_remux_procs,
        cleanup_callbacks=(
            backup_stream_engine.shutdown_local_torrserver,
            download_manager.shutdown,
        ),
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    if "--launchd" in sys.argv and is_port_already_serving_velarium(port, app_version=APP_VERSION):
        sys.exit(0)
    run_server(port)
