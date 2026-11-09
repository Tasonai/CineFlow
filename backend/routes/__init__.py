"""
Velarium Modular Route Registry & Dispatcher
"""

from backend.routes.context import ServerContext
from backend.routes.backup import BACKUP_GET_ROUTES, BACKUP_POST_ROUTES
from backend.routes.catalog import (
    handle_catalog,
    handle_catalog_recommendations,
    handle_search,
)
from backend.routes.debrid import DEBRID_GET_ROUTES, DEBRID_POST_ROUTES
from backend.routes.downloads import (
    handle_downloads_batch,
    handle_downloads_cancel,
    handle_downloads_cleanup_pending,
    handle_downloads_delete,
    handle_downloads_delete_season,
    handle_downloads_get,
    handle_downloads_open_folder,
    handle_downloads_prefs_get,
    handle_downloads_prefs_post,
    handle_downloads_retry,
    handle_downloads_season_status,
    handle_downloads_start,
)
from backend.routes.kinorium import (
    handle_integrations,
    handle_kinorium_avatar,
    handle_kinorium_continue_watching_remove,
    handle_kinorium_continue_watching_restore,
    handle_kinorium_disconnect,
    handle_kinorium_episode_watched,
    handle_kinorium_live_digest,
    handle_kinorium_never,
    handle_kinorium_one_click_cancel,
    handle_kinorium_one_click_complete,
    handle_kinorium_one_click_login,
    handle_kinorium_one_click_status,
    handle_kinorium_rate,
    handle_kinorium_rate_episode,
    handle_kinorium_scrobble,
    handle_kinorium_stats,
    handle_kinorium_sync,
    handle_kinorium_watched,
    handle_kinorium_watched_episodes_batch,
    handle_kinorium_watching,
    handle_kinorium_watchlist,
)
from backend.routes.meta import META_GET_ROUTES, META_POST_ROUTES
from backend.routes.profiles import (
    handle_profiles_delete,
    handle_profiles_get,
    handle_profiles_save,
    handle_profiles_switch,
    handle_profiles_verify_pin,
)
from backend.routes.remote import REMOTE_GET_ROUTES, REMOTE_POST_ROUTES
from backend.routes.static_files import (
    get_static_file_etag,
    load_cached_static_file,
    lookup_static_etag,
    resolve_safe_public_static_path,
    serve_static_file,
)
from backend.routes.streaming import (
    STREAMING_EXACT_ROUTES,
    STREAMING_PREFIX_ROUTES,
    dispatch_streaming_route,
    handle_download_mp4,
    handle_downloads_poster,
    handle_downloads_stream,
    handle_downloads_sub,
    handle_proxy_stream,
    handle_proxy_vtt,
    handle_remux_stream,
    handle_video_snapshot,
    serve_offline_video_file,
    terminate_active_remux_procs,
)
from backend.routes.streams import (
    handle_hdrezka_check_watching_updates,
    handle_hdrezka_streams,
    handle_remux_probe,
    handle_remux_subtitle,
    handle_stremio_addons_get,
    handle_stremio_addons_post,
    handle_stremio_resolve_post,
    handle_stremio_streams_get,
)
from backend.routes.system import (
    handle_settings_get,
    handle_settings_post,
    handle_stream_embed_close_post,
    handle_stream_embed_open_post,
    handle_system_autostart_post,
    handle_system_lan_post,
    handle_system_status,
    handle_system_update_check_get,
    handle_system_update_check_post,
    handle_system_update_download_post,
    handle_system_update_open_post,
    handle_system_update_status,
)

GET_ROUTES = {
    "/api/catalog": handle_catalog,
    "/api/catalog/recommendations": handle_catalog_recommendations,
    "/api/search": handle_search,
    "/api/system/status": handle_system_status,
    "/api/system/update/status": handle_system_update_status,
    "/api/system/update/check": handle_system_update_check_get,
    "/api/settings": handle_settings_get,
    "/api/profiles": handle_profiles_get,
    "/api/downloads": handle_downloads_get,
    "/api/downloads/prefs": handle_downloads_prefs_get,
    "/api/downloads/season-status": handle_downloads_season_status,
    "/api/kinorium/avatar": handle_kinorium_avatar,
    "/api/kinorium/live-digest": handle_kinorium_live_digest,
    "/api/kinorium/stats": handle_kinorium_stats,
    "/api/kinorium/one-click-status": handle_kinorium_one_click_status,
    "/api/integrations": handle_integrations,
    "/api/hdrezka/streams": handle_hdrezka_streams,
    "/api/hdrezka/check-watching-updates": handle_hdrezka_check_watching_updates,
    "/api/stremio/addons": handle_stremio_addons_get,
    "/api/stremio/streams": handle_stremio_streams_get,
    "/api/remux-probe": handle_remux_probe,
    "/api/remux-subtitle": handle_remux_subtitle,
    **REMOTE_GET_ROUTES,
    **BACKUP_GET_ROUTES,
    **META_GET_ROUTES,
    **DEBRID_GET_ROUTES,
}

POST_ROUTES = {
    "/api/settings": handle_settings_post,
    "/api/system/lan": handle_system_lan_post,
    "/api/system/autostart": handle_system_autostart_post,
    "/api/system/update/check": handle_system_update_check_post,
    "/api/system/update/download": handle_system_update_download_post,
    "/api/system/update/open": handle_system_update_open_post,
    "/api/stream-embed/open": handle_stream_embed_open_post,
    "/api/stream-embed/close": handle_stream_embed_close_post,
    "/api/profiles/verify-pin": handle_profiles_verify_pin,
    "/api/profiles/switch": handle_profiles_switch,
    "/api/profiles/save": handle_profiles_save,
    "/api/profiles/delete": handle_profiles_delete,
    "/api/downloads/start": handle_downloads_start,
    "/api/downloads/retry": handle_downloads_retry,
    "/api/downloads/resume": handle_downloads_retry,
    "/api/downloads/cancel": handle_downloads_cancel,
    "/api/downloads/delete": handle_downloads_delete,
    "/api/downloads/delete-season": handle_downloads_delete_season,
    "/api/downloads/batch-season/delete": handle_downloads_delete_season,
    "/api/downloads/open-folder": handle_downloads_open_folder,
    "/api/downloads/batch": handle_downloads_batch,
    "/api/downloads/batch-season": handle_downloads_batch,
    "/api/downloads/prefs": handle_downloads_prefs_post,
    "/api/downloads/cleanup-pending": handle_downloads_cleanup_pending,
    "/api/kinorium/scrobble": handle_kinorium_scrobble,
    "/api/kinorium/rate-episode": handle_kinorium_rate_episode,
    "/api/kinorium/rate": handle_kinorium_rate,
    "/api/kinorium/watched": handle_kinorium_watched,
    "/api/kinorium/episode-watched": handle_kinorium_episode_watched,
    "/api/kinorium/episode-watch": handle_kinorium_episode_watched,
    "/api/kinorium/watched-episodes-batch": handle_kinorium_watched_episodes_batch,
    "/api/kinorium/watchlist": handle_kinorium_watchlist,
    "/api/kinorium/watching": handle_kinorium_watching,
    "/api/kinorium/never": handle_kinorium_never,
    "/api/kinorium/continue-watching/remove": handle_kinorium_continue_watching_remove,
    "/api/kinorium/continue-watching/restore": handle_kinorium_continue_watching_restore,
    "/api/kinorium/sync": handle_kinorium_sync,
    "/api/kinorium/disconnect": handle_kinorium_disconnect,
    "/api/kinorium/one-click-login": handle_kinorium_one_click_login,
    "/api/kinorium/one-click-cancel": handle_kinorium_one_click_cancel,
    "/api/kinorium/one-click-complete": handle_kinorium_one_click_complete,
    "/api/stremio/addons": handle_stremio_addons_post,
    "/api/stremio/resolve": handle_stremio_resolve_post,
    **REMOTE_POST_ROUTES,
    **BACKUP_POST_ROUTES,
    **META_POST_ROUTES,
    **DEBRID_POST_ROUTES,
}


def dispatch_get_route(handler, path, qs, parsed, ctx):
    """
    Attempts to dispatch a GET request using the registered route table.
    Returns True if handled, False otherwise.
    """
    route_handler = GET_ROUTES.get(path)
    if route_handler:
        res = route_handler(handler, qs, parsed, ctx)
        return True if res is None else bool(res)
    return False


def dispatch_post_route(handler, path, qs, parsed, body, ctx):
    """
    Attempts to dispatch a POST request using the registered route table.
    Returns True if handled, False otherwise.
    """
    route_handler = POST_ROUTES.get(path)
    if route_handler:
        res = route_handler(handler, qs, parsed, body, ctx)
        return True if res is None else bool(res)
    return False
