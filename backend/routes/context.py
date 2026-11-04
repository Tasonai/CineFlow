"""
CineFlow Server Context Adapter
Provides unified dependency access for route handlers in backend.routes.
"""

from typing import Any, Callable, Dict, Optional


class ServerContext:
    """
    Adapter providing live access to server singletons, configuration and engine instances
    for modular route handlers in backend.routes.
    """

    def __init__(
        self,
        provider_fn: Optional[Callable[[str], Any]] = None,
        services: Optional[Any] = None,
        **kwargs: Any,
    ) -> None:
        self._provider_fn: Optional[Callable[[str], Any]] = provider_fn
        self._services: Optional[Any] = services
        self._providers: Dict[str, Any] = dict(kwargs)

    def register(self, key: str, value: Any) -> None:
        self._providers[key] = value

    def update(self, mapping: Dict[str, Any]) -> None:
        self._providers.update(mapping)

    def register_provider(self, fn: Callable[[str], Any]) -> None:
        self._provider_fn = fn

    def _resolve(self, name: str) -> Any:
        if name in self._providers:
            val = self._providers[name]
            if callable(val) and getattr(val, "__cineflow_lazy__", False):
                return val()
            return val
        if self._provider_fn is not None:
            try:
                res = self._provider_fn(name)
                if res is not None:
                    return res
            except Exception:
                pass
        if self._services is not None and hasattr(self._services, name):
            return getattr(self._services, name)
        return None

    def __getattr__(self, name: str) -> Any:
        val = self._resolve(name)
        if val is not None:
            return val
        raise AttributeError(f"'{type(self).__name__}' object has no attribute '{name}'")

    def __getitem__(self, name: str) -> Any:
        return getattr(self, name)

    def __setattr__(self, name: str, value: Any) -> None:
        if name.startswith("_"):
            super().__setattr__(name, value)
        else:
            if "_providers" in self.__dict__:
                self._providers[name] = value
            else:
                super().__setattr__(name, value)

    def __setitem__(self, name: str, value: Any) -> None:
        self._providers[name] = value

    def __contains__(self, name: str) -> bool:
        if name in self._providers:
            return True
        if self._provider_fn is not None:
            try:
                return self._provider_fn(name) is not None
            except Exception:
                return False
        return False

    def get(self, name: str, default: Any = None) -> Any:
        val = self._resolve(name)
        return default if val is None else val

    # -------------------------------------------------------------------------
    # Core Server Singletons & State
    # -------------------------------------------------------------------------

    @property
    def aggregator(self) -> Any:
        return self._resolve("aggregator")

    @property
    def profile_manager(self) -> Any:
        return self._resolve("profile_manager")

    @property
    def kinorium_service(self) -> Any:
        return self._resolve("kinorium_service")

    @property
    def app_updater(self) -> Any:
        return self._resolve("app_updater")

    @property
    def app_prefs(self) -> Any:
        return self._resolve("app_prefs")

    @property
    def rezka_client(self) -> Any:
        return self._resolve("rezka_client")

    @property
    def backup_stream_engine(self) -> Any:
        return self._resolve("backup_stream_engine")

    @property
    def stremio_engine(self) -> Any:
        return self._resolve("stremio_engine")

    @property
    def remux_engine(self) -> Any:
        return self._resolve("remux_engine")

    @property
    def skip_intro_engine(self) -> Any:
        return self._resolve("skip_intro_engine")

    @property
    def remote_broker(self) -> Any:
        return self._resolve("remote_broker")

    @property
    def net_client(self) -> Any:
        return self._resolve("net_client")

    @property
    def download_manager(self) -> Any:
        return self._resolve("download_manager")

    @property
    def kinorium_auth_manager(self) -> Any:
        return self._resolve("kinorium_auth_manager")

    @property
    def dlna_manager(self) -> Any:
        return self._resolve("dlna_manager")

    @property
    def server_runtime(self) -> Any:
        return self._resolve("server_runtime")

    @property
    def storage_db(self) -> Any:
        return self._resolve("storage_db")

    @property
    def subtitle_service(self) -> Any:
        return self._resolve("subtitle_service")

    @property
    def en_meta_resolver(self) -> Any:
        return self._resolve("en_meta_resolver")

    # -------------------------------------------------------------------------
    # Server Lifecycle, Settings & Configuration Methods
    # -------------------------------------------------------------------------

    @property
    def save_persisted_server_settings(self) -> Any:
        return self._resolve("save_persisted_server_settings")

    @property
    def sync_lan_listener(self) -> Any:
        return self._resolve("sync_lan_listener")

    @property
    def set_system_autostart(self) -> Any:
        return self._resolve("set_system_autostart")

    @property
    def apply_user_country(self) -> Any:
        return self._resolve("apply_user_country")

    @property
    def get_system_status_payload(self) -> Any:
        return self._resolve("get_system_status_payload")

    @property
    def detect_lan_ipv4(self) -> Any:
        return self._resolve("detect_lan_ipv4")

    @property
    def build_remote_pairing_payload(self) -> Any:
        return self._resolve("build_remote_pairing_payload")

    # -------------------------------------------------------------------------
    # Utility, Parsing & Validation Helpers
    # -------------------------------------------------------------------------

    @property
    def redact_stremio_addons_for_client(self) -> Any:
        res = self._resolve("redact_stremio_addons_for_client")
        if res is not None:
            return res
        from backend.catalog_helpers import redact_stremio_addons_for_client
        stremio = self.stremio_engine
        default_addons = getattr(stremio, "DEFAULT_ADDONS", None)
        return lambda addons, is_local_client: redact_stremio_addons_for_client(
            addons, is_local_client=is_local_client, default_addons=default_addons
        )

    @property
    def norm_app_lang(self) -> Any:
        res = self._resolve("norm_app_lang")
        if res is not None:
            return res
        sm = self._resolve("settings_manager")
        if sm is not None and hasattr(sm, "norm_app_lang"):
            return sm.norm_app_lang
        return lambda l, default="ru": str(l or default).strip().lower() or default

    @property
    def msg(self) -> Any:
        res = self._resolve("msg")
        if res is not None:
            return res
        sm = self._resolve("settings_manager")
        if sm is not None and hasattr(sm, "msg"):
            return sm.msg
        return lambda ru, en, lang=None: ru if (lang or "ru") == "ru" else en

    @property
    def safe_float(self) -> Any:
        res = self._resolve("safe_float")
        if res is not None:
            return res
        from backend.bootstrap import safe_float
        return safe_float

    @property
    def safe_int(self) -> Any:
        res = self._resolve("safe_int")
        if res is not None:
            return res
        from backend.bootstrap import safe_int
        return safe_int

    @property
    def qs_int(self) -> Any:
        res = self._resolve("qs_int")
        if res is not None:
            return res
        from backend.bootstrap import qs_int
        return qs_int

    @property
    def qs_float(self) -> Any:
        res = self._resolve("qs_float")
        if res is not None:
            return res
        from backend.bootstrap import qs_float
        return qs_float

    @property
    def safe_log(self) -> Any:
        return self._resolve("safe_log")

    @property
    def has_cyrillic(self) -> Any:
        res = self._resolve("has_cyrillic")
        if res is not None:
            return res
        from backend.en_metadata import has_cyrillic
        return has_cyrillic

    # -------------------------------------------------------------------------
    # Media & Network Security
    # -------------------------------------------------------------------------

    @property
    def is_allowed_media_source_url(self) -> Any:
        res = self._resolve("is_allowed_media_source_url")
        if res is not None:
            return res
        from backend.net_security import is_allowed_media_source_url
        b_engine = self._resolve("backup_stream_engine")
        torr_url = str(getattr(b_engine, "torrserver_url", None) or "http://127.0.0.1:8090")
        s_runtime = self._resolve("server_runtime") or {}
        own_p = int(s_runtime.get("port") or 8765)
        net_c = self._resolve("net_client")
        return lambda raw_url, allow_torrserver_loopback=True: is_allowed_media_source_url(
            raw_url,
            allow_torrserver_loopback=allow_torrserver_loopback,
            torrserver_url=torr_url,
            own_port=own_p,
            net_client=net_c,
        )

    @property
    def unwrap_local_proxy_media_url(self) -> Any:
        res = self._resolve("unwrap_local_proxy_media_url")
        if res is not None:
            return res
        from backend.routes.streaming import _unwrap_local_proxy_media_url
        return _unwrap_local_proxy_media_url

    @property
    def open_safe_public_url(self) -> Any:
        res = self._resolve("open_safe_public_url")
        if res is not None:
            return res
        from backend.net_security import open_safe_public_url
        b_engine = self._resolve("backup_stream_engine")
        torr_url = str(getattr(b_engine, "torrserver_url", None) or "http://127.0.0.1:8090")
        s_runtime = self._resolve("server_runtime") or {}
        own_p = int(s_runtime.get("port") or 8765)
        net_c = self._resolve("net_client")
        return lambda url, headers=None, timeout=6.0, proxy_url=None: open_safe_public_url(
            url,
            headers=headers,
            timeout=timeout,
            proxy_url=proxy_url,
            allow_torrserver_loopback=False,
            torrserver_url=torr_url,
            own_port=own_p,
            net_client=net_c,
        )

    @property
    def sniff_raster_image_type(self) -> Any:
        res = self._resolve("sniff_raster_image_type")
        if res is not None:
            return res
        from backend.routes.streaming import _sniff_raster_image_type
        return _sniff_raster_image_type

    @property
    def wrap_voidboost_stream_url(self) -> Any:
        res = self._resolve("wrap_voidboost_stream_url")
        if res is not None:
            return res
        from backend.routes.streaming import _wrap_voidboost_stream_url
        return _wrap_voidboost_stream_url

    # -------------------------------------------------------------------------
    # Catalog, Metadata & Caching
    # -------------------------------------------------------------------------

    @property
    def build_trusted_item_for_kids_check(self) -> Any:
        res = self._resolve("build_trusted_item_for_kids_check")
        if res is not None:
            return res
        from backend.catalog_helpers import build_trusted_item_for_kids_check
        return lambda item_id="", title="", orig_title="", media_type="", server_genres=None, server_age="", server_description="": build_trusted_item_for_kids_check(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            media_type=media_type,
            server_genres=server_genres,
            server_age=server_age,
            server_description=server_description,
            aggregator=self.aggregator,
            kinorium_service=self.kinorium_service,
        )

    @property
    def person_photo_cache(self) -> Any:
        return self._resolve("person_photo_cache")

    @property
    def person_photo_lock(self) -> Any:
        return self._resolve("person_photo_lock")

    @property
    def last_bg_watching_sync(self) -> Any:
        return self._resolve("last_bg_watching_sync")

    @property
    def is_stub_description(self) -> Any:
        res = self._resolve("is_stub_description")
        if res is not None:
            return res
        from backend.catalog_helpers import is_stub_description
        return is_stub_description

    @property
    def lookup_fallback_description(self) -> Any:
        res = self._resolve("lookup_fallback_description")
        if res is not None:
            return res
        from backend.catalog_helpers import lookup_fallback_description
        return lambda item_id="", kinorium_id="", title="", orig_title="": lookup_fallback_description(
            item_id=item_id,
            kinorium_id=kinorium_id,
            title=title,
            orig_title=orig_title,
            kinorium_service=self.kinorium_service,
            aggregator=self.aggregator,
        )

    @property
    def is_known_episode_unreleased(self) -> Any:
        res = self._resolve("is_known_episode_unreleased")
        if res is not None:
            return res
        from backend.catalog_helpers import is_known_episode_unreleased
        return lambda kid="", item_id="", title="", orig_title="", year=0, season=1, episode=1: is_known_episode_unreleased(
            kid=kid,
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            year=year,
            season=season,
            episode=episode,
            kinorium_service=self.kinorium_service,
            en_meta_resolver=self.en_meta_resolver,
        )

    @property
    def scrub_cyrillic_episode_dicts(self) -> Any:
        res = self._resolve("scrub_cyrillic_episode_dicts")
        if res is not None:
            return res
        from backend.catalog_helpers import scrub_cyrillic_episode_dicts
        return scrub_cyrillic_episode_dicts

    @property
    def translate_kinorium_extra_desc_to_en(self) -> Any:
        res = self._resolve("translate_kinorium_extra_desc_to_en")
        if res is not None:
            return res
        from backend.en_metadata import translate_kinorium_extra_desc_to_en
        return translate_kinorium_extra_desc_to_en

    @property
    def build_english_cast_people(self) -> Any:
        res = self._resolve("build_english_cast_people")
        if res is not None:
            return res
        from backend.en_metadata import build_english_cast_people
        return build_english_cast_people

    @property
    def extract_magnet_display_name(self) -> Any:
        res = self._resolve("extract_magnet_display_name")
        if res is not None:
            return res
        from backend.catalog_helpers import extract_magnet_display_name
        return extract_magnet_display_name

    # -------------------------------------------------------------------------
    # Window / Desktop Integration
    # -------------------------------------------------------------------------

    @property
    def trigger_macos_browser_fullscreen_key(self) -> Any:
        res = self._resolve("trigger_macos_browser_fullscreen_key")
        if res is not None:
            return res
        from backend.server_lifecycle import trigger_macos_browser_fullscreen_key
        return lambda: trigger_macos_browser_fullscreen_key(is_running_fn=lambda: bool((self.server_runtime or {}).get("running")))

    @property
    def trigger_macos_browser_pip_key(self) -> Any:
        res = self._resolve("trigger_macos_browser_pip_key")
        if res is not None:
            return res
        from backend.server_lifecycle import trigger_macos_browser_pip_key
        return lambda engine="": trigger_macos_browser_pip_key(engine=engine, is_running_fn=lambda: bool((self.server_runtime or {}).get("running")))
