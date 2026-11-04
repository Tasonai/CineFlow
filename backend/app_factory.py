"""
CineFlow Application Factory and Service Container
Constructs and wires all domain services, engines, databases,
settings managers, and runtime state dictionaries into a cohesive container.
"""

from __future__ import annotations

import atexit
import os
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

from backend.aggregator import UnifiedCinemaAggregator
from backend.backup_stream import BackupStreamingEngine
from backend.doh import DoHSplitNetworkClient
from backend.downloads import OfflineDownloadManager, resolve_offline_episode_stream
from backend.en_metadata import EnglishMetadataResolver
from backend.hdrezka import HDRezkaClient
from backend.kinorium import KinoriumService
from backend.kinorium_auth import KinoriumOneClickAuthManager
from backend.profiles import ProfileManager
from backend.remote_control import DesktopRemoteBroker
from backend.remuxer import RemuxStreamEngine
from backend.routes.streaming import _unwrap_local_proxy_media_url, _wrap_voidboost_stream_url
from backend.settings_manager import ServerSettingsManager
from backend.skip_intro import SkipIntroEngine
from backend.storage_db import get_storage_db
from backend.stremio import StremioAddonEngine
from backend.subtitles import SubtitleSearchService
from backend.tv_cast import DlnaCastManager
from backend.updater import AppUpdater


@dataclass
class CineFlowServices:
    """Container holding all initialized CineFlow services and shared state."""

    storage_db: Any
    net_client: DoHSplitNetworkClient
    rezka_client: HDRezkaClient
    profile_manager: ProfileManager
    kinorium_service: KinoriumService
    skip_intro_engine: SkipIntroEngine
    backup_stream_engine: BackupStreamingEngine
    remux_engine: RemuxStreamEngine
    stremio_engine: StremioAddonEngine
    subtitle_service: SubtitleSearchService
    remote_broker: DesktopRemoteBroker
    en_meta_resolver: EnglishMetadataResolver
    aggregator: UnifiedCinemaAggregator
    download_manager: OfflineDownloadManager
    dlna_manager: DlnaCastManager
    kinorium_auth_manager: KinoriumOneClickAuthManager
    app_updater: AppUpdater
    settings_manager: ServerSettingsManager
    app_prefs: Dict[str, Any]
    server_runtime: Dict[str, Any]
    person_photo_cache: Dict[str, Any] = field(default_factory=dict)
    person_photo_lock: threading.Lock = field(default_factory=threading.Lock)
    last_bg_watching_sync: Dict[str, Any] = field(default_factory=lambda: {"ts": 0.0, "checked": 0})
    resolve_offline_stream_fn: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None

    def resolve_offline_episode_stream(self, snapshot: Dict[str, Any]) -> Dict[str, Any]:
        """Resolves media stream for offline background downloading."""
        if self.resolve_offline_stream_fn is not None:
            return self.resolve_offline_stream_fn(snapshot)
        return resolve_offline_episode_stream(
            snapshot,
            rezka_client=self.rezka_client,
            backup_stream_engine=self.backup_stream_engine,
            stremio_engine=self.stremio_engine,
            remux_engine=self.remux_engine,
            wrap_voidboost_fn=_wrap_voidboost_stream_url,
            unwrap_media_fn=_unwrap_local_proxy_media_url,
            is_server_running_fn=lambda: bool(self.server_runtime.get("running")),
        )


def create_cineflow_services(
    base_dir: str,
    data_dir: str,
    app_version: str = "2.6.11",
    safe_log_fn: Optional[Callable[[str, bool], None]] = None,
    register_atexit_hooks: bool = True,
) -> CineFlowServices:
    """
    Instantiates and wires all domain services, engines, databases, and managers
    into a CineFlowServices container with persisted settings loaded.
    """
    settings_path = os.path.join(data_dir, "server_settings.json")

    storage_db = get_storage_db(data_dir)
    net_client = DoHSplitNetworkClient()
    rezka_client = HDRezkaClient(net_client)
    profile_manager = ProfileManager(data_dir)
    kinorium_service = KinoriumService(net_client, data_dir)
    kinorium_service._rezka_client = rezka_client

    if profile_manager.get_active_profile_id() != "main":
        kinorium_service.switch_state_file(profile_manager.get_kinorium_state_path())

    skip_intro_engine = SkipIntroEngine(net_client)
    backup_stream_engine = BackupStreamingEngine(net_client, rezka_client, base_dir)
    remux_engine = RemuxStreamEngine(base_dir)
    stremio_engine = StremioAddonEngine(data_dir, backup_stream_engine)
    subtitle_service = SubtitleSearchService(net_client, stremio_engine)
    remote_broker = DesktopRemoteBroker()
    en_meta_resolver = EnglishMetadataResolver(os.path.join(data_dir, "en_meta_cache.json"), net_client)
    aggregator = UnifiedCinemaAggregator(
        net_client,
        rezka_client,
        kinorium_service,
        stremio_engine,
        en_meta_resolver=en_meta_resolver,
    )

    app_prefs: Dict[str, Any] = {
        "app_lang": "ru",
        "lan_access": False,
        "user_country": "PL",
        "auto_check_updates": True,
        "update_repo": "",
        "update_manifest_url": "",
        "setup_completed": bool(
            kinorium_service.had_persisted_state
            and (
                kinorium_service.state.get("account", {}).get("user_id")
                or kinorium_service.state.get("watched")
                or kinorium_service.state.get("remote_watched_items")
            )
        ),
    }

    server_runtime: Dict[str, Any] = {
        "server": None,
        "host": "127.0.0.1",
        "port": 8765,
        "running": False,
        "rebind_requested": False,
        "lock": threading.Lock(),
    }

    def _resolve_offline_stream(snapshot: Dict[str, Any]) -> Dict[str, Any]:
        return resolve_offline_episode_stream(
            snapshot,
            rezka_client=rezka_client,
            backup_stream_engine=backup_stream_engine,
            stremio_engine=stremio_engine,
            remux_engine=remux_engine,
            wrap_voidboost_fn=_wrap_voidboost_stream_url,
            unwrap_media_fn=_unwrap_local_proxy_media_url,
            is_server_running_fn=lambda: bool(server_runtime.get("running")),
        )

    download_manager = OfflineDownloadManager(
        data_dir,
        remux_engine,
        net_client=net_client,
        local_port_getter=lambda: int(server_runtime.get("port") or 8765),
        stream_resolver=_resolve_offline_stream,
    )
    dlna_manager = DlnaCastManager()
    kinorium_auth_manager = KinoriumOneClickAuthManager(
        base_dir,
        kinorium_service,
        on_sync_complete=lambda: aggregator.invalidate_catalog_cache(),
    )

    if register_atexit_hooks:
        atexit.register(backup_stream_engine.shutdown_local_torrserver)
        atexit.register(download_manager.shutdown)

    app_updater = AppUpdater(app_version, data_dir, settings_getter=lambda: app_prefs)

    settings_manager = ServerSettingsManager(
        data_dir=data_dir,
        settings_path=settings_path,
        app_prefs=app_prefs,
        server_runtime=server_runtime,
        storage_db=storage_db,
        net_client=net_client,
        aggregator=aggregator,
        kinorium_service=kinorium_service,
        rezka_client=rezka_client,
        backup_stream_engine=backup_stream_engine,
        remote_broker=remote_broker,
        safe_log_fn=safe_log_fn,
    )
    settings_manager.load_persisted_server_settings()

    return CineFlowServices(
        storage_db=storage_db,
        net_client=net_client,
        rezka_client=rezka_client,
        profile_manager=profile_manager,
        kinorium_service=kinorium_service,
        skip_intro_engine=skip_intro_engine,
        backup_stream_engine=backup_stream_engine,
        remux_engine=remux_engine,
        stremio_engine=stremio_engine,
        subtitle_service=subtitle_service,
        remote_broker=remote_broker,
        en_meta_resolver=en_meta_resolver,
        aggregator=aggregator,
        download_manager=download_manager,
        dlna_manager=dlna_manager,
        kinorium_auth_manager=kinorium_auth_manager,
        app_updater=app_updater,
        settings_manager=settings_manager,
        app_prefs=app_prefs,
        server_runtime=server_runtime,
        resolve_offline_stream_fn=_resolve_offline_stream,
    )
