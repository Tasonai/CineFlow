"""
Unit and integration tests for modular routes in backend/routes/ (kinorium.py and streams.py).
"""

import unittest
from unittest.mock import MagicMock, patch
from backend.routes import (
    GET_ROUTES,
    POST_ROUTES,
    STREAMING_EXACT_ROUTES,
    STREAMING_PREFIX_ROUTES,
    dispatch_get_route,
    dispatch_post_route,
    dispatch_streaming_route,
)


class TestModularRoutes(unittest.TestCase):
    def test_kinorium_routes_registered(self):
        # Kinorium GET routes
        self.assertIn("/api/kinorium/avatar", GET_ROUTES)
        self.assertIn("/api/kinorium/live-digest", GET_ROUTES)
        self.assertIn("/api/kinorium/stats", GET_ROUTES)
        self.assertIn("/api/kinorium/one-click-status", GET_ROUTES)
        self.assertIn("/api/integrations", GET_ROUTES)

        # Kinorium POST routes
        self.assertIn("/api/kinorium/scrobble", POST_ROUTES)
        self.assertIn("/api/kinorium/rate-episode", POST_ROUTES)
        self.assertIn("/api/kinorium/rate", POST_ROUTES)
        self.assertIn("/api/kinorium/watched", POST_ROUTES)
        self.assertIn("/api/kinorium/episode-watched", POST_ROUTES)
        self.assertIn("/api/kinorium/episode-watch", POST_ROUTES)
        self.assertIn("/api/kinorium/watched-episodes-batch", POST_ROUTES)
        self.assertIn("/api/kinorium/watchlist", POST_ROUTES)
        self.assertIn("/api/kinorium/watching", POST_ROUTES)
        self.assertIn("/api/kinorium/never", POST_ROUTES)
        self.assertIn("/api/kinorium/continue-watching/remove", POST_ROUTES)
        self.assertIn("/api/kinorium/continue-watching/restore", POST_ROUTES)
        self.assertIn("/api/kinorium/sync", POST_ROUTES)
        self.assertIn("/api/kinorium/disconnect", POST_ROUTES)
        self.assertIn("/api/kinorium/one-click-login", POST_ROUTES)
        self.assertIn("/api/kinorium/one-click-cancel", POST_ROUTES)
        self.assertIn("/api/kinorium/one-click-complete", POST_ROUTES)

    def test_streams_routes_registered(self):
        # Streams GET routes
        self.assertIn("/api/hdrezka/streams", GET_ROUTES)
        self.assertIn("/api/hdrezka/check-watching-updates", GET_ROUTES)
        self.assertIn("/api/stremio/addons", GET_ROUTES)
        self.assertIn("/api/stremio/streams", GET_ROUTES)
        self.assertIn("/api/remux-probe", GET_ROUTES)
        self.assertIn("/api/remux-subtitle", GET_ROUTES)

        # Streams POST routes
        self.assertIn("/api/stremio/addons", POST_ROUTES)
        self.assertIn("/api/stremio/resolve", POST_ROUTES)

    def test_remote_routes_registered(self):
        # Remote & TV GET routes
        self.assertIn("/api/tv/devices", GET_ROUTES)
        self.assertIn("/api/tv/deep-link", GET_ROUTES)
        self.assertIn("/api/remote/pairing", GET_ROUTES)
        self.assertIn("/api/remote/state", GET_ROUTES)
        self.assertIn("/api/remote/commands", GET_ROUTES)
        self.assertIn("/api/remote/catalog", GET_ROUTES)

        # Remote & TV POST routes
        self.assertIn("/api/tv/cast", POST_ROUTES)
        self.assertIn("/api/tv/stop", POST_ROUTES)
        self.assertIn("/api/remote/pair", POST_ROUTES)
        self.assertIn("/api/remote/state", POST_ROUTES)
        self.assertIn("/api/remote/native-fullscreen", POST_ROUTES)
        self.assertIn("/api/remote/native-pip", POST_ROUTES)
        self.assertIn("/api/remote/command", POST_ROUTES)

    def test_backup_routes_registered(self):
        # Backup GET route
        self.assertIn("/api/backup/export", GET_ROUTES)

        # Backup POST route
        self.assertIn("/api/backup/import", POST_ROUTES)

    def test_meta_routes_registered(self):
        # Meta & Subtitles GET routes
        self.assertIn("/api/trailer", GET_ROUTES)
        self.assertIn("/api/person", GET_ROUTES)
        self.assertIn("/api/person-photo", GET_ROUTES)
        self.assertIn("/api/title-meta", GET_ROUTES)
        self.assertIn("/api/provider-link", GET_ROUTES)
        self.assertIn("/api/skip-intro", GET_ROUTES)
        self.assertIn("/api/subtitles/search", GET_ROUTES)
        self.assertIn("/api/subtitles/translate", GET_ROUTES)
        self.assertIn("/api/calendar", GET_ROUTES)

    def test_debrid_routes_registered(self):
        # Debrid & Backup streams GET routes
        self.assertIn("/api/backup-streams", GET_ROUTES)

        # Debrid & Backup streams POST routes
        self.assertIn("/api/debrid/resolve", POST_ROUTES)
        self.assertIn("/api/backup-streams/resolve", POST_ROUTES)
        self.assertIn("/api/integrations", POST_ROUTES)

    def test_dispatch_kinorium_one_click_status(self):
        handler = MagicMock()
        ctx = MagicMock()
        ctx.kinorium_auth_manager.get_status.return_value = {"supported": True, "active": False}
        handled = dispatch_get_route(handler, "/api/kinorium/one-click-status", {}, None, ctx)
        self.assertTrue(handled)
        handler._send_json.assert_called_once_with({"supported": True, "active": False})

    def test_dispatch_stremio_addons_get(self):
        handler = MagicMock()
        handler._is_loopback_client.return_value = True
        ctx = MagicMock()
        ctx.app_prefs = {"app_lang": "ru"}
        ctx.norm_app_lang.side_effect = lambda l, d: l or d
        ctx.stremio_engine.get_addons.return_value = [{"id": "cinemeta"}]
        ctx.redact_stremio_addons_for_client.side_effect = lambda addons, is_local: addons
        handled = dispatch_get_route(handler, "/api/stremio/addons", {}, None, ctx)
        self.assertTrue(handled)
        handler._send_json.assert_called_once_with({"ok": True, "addons": [{"id": "cinemeta"}]})

    def test_streaming_routes_registered(self):
        # Exact streaming routes
        self.assertIn("/api/proxy-stream", STREAMING_EXACT_ROUTES)
        self.assertIn("/api/download-mp4", STREAMING_EXACT_ROUTES)
        self.assertIn("/api/proxy-vtt", STREAMING_EXACT_ROUTES)
        self.assertIn("/api/remux-stream", STREAMING_EXACT_ROUTES)
        self.assertIn("/api/video-snapshot", STREAMING_EXACT_ROUTES)

        # Prefix streaming routes
        prefix_paths = [prefix for prefix, _ in STREAMING_PREFIX_ROUTES]
        self.assertIn("/api/downloads/stream/", prefix_paths)
        self.assertIn("/api/downloads/sub/", prefix_paths)
        self.assertIn("/api/downloads/poster/", prefix_paths)

    def test_dispatch_streaming_head_remux(self):
        handler = MagicMock()
        ctx = MagicMock()
        parsed = MagicMock()
        parsed.path = "/api/remux-stream"
        handled = dispatch_streaming_route(handler, "/api/remux-stream", {}, parsed, ctx, head_only=True)
        self.assertTrue(handled)
        handler.send_response.assert_called_once_with(200)
        handler.send_header.assert_any_call("Content-Type", "video/mp4")
        handler.send_header.assert_any_call("Accept-Ranges", "none")


if __name__ == "__main__":
    unittest.main()
