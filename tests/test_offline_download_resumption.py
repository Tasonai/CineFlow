#!/usr/bin/env python3
import os
import shutil
import tempfile
import time
import unittest

from backend.downloads import OfflineDownloadManager
from backend.storage_db import VelariumStorageDB

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class TestOfflineDownloadResumption(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp(prefix="velarium_test_dl_resume_")
        self.downloads_dir = os.path.join(self.tmp_dir, "downloads")
        os.makedirs(self.downloads_dir, exist_ok=True)
        from backend.storage_db import get_storage_db
        self.db = get_storage_db(self.tmp_dir)

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_interrupted_downloads_auto_resumed_on_startup(self):
        # Insert a pre-existing download record that was interrupted mid-stream
        did = "dl_interrupted_movie_1080p"
        sample_record = {
            "download_id": did,
            "title": "Interrupted Film",
            "media_type": "movie",
            "season": 1,
            "episode": 1,
            "status": "downloading",
            "progress_pct": 45.0,
            "stream_url": "http://127.0.0.1:8765/api/mock-stream",
            "created_at": time.time() - 100,
            "file_size": 0,
            "downloaded_bytes": 1024 * 1024 * 50,
            "error": "",
        }
        self.db.upsert_download(did, sample_record)

        # Initialize manager with mock resolver
        mgr = OfflineDownloadManager(
            data_dir=self.tmp_dir,
            remux_engine=None,
            start_workers=False,
            stream_resolver=lambda item: {"stream_url": "http://127.0.0.1:8765/api/mock-stream"},
        )
        try:
            items = mgr._items
            self.assertIn(did, items)
            # Must NOT be marked as failed! It should be automatically restored to queued for auto-resume
            self.assertEqual(items[did]["status"], "queued")
            self.assertEqual(items[did]["error"], "")
            self.assertTrue(items[did].get("lazy_resolve"))
            # Check that it got placed into the worker queue
            self.assertFalse(mgr._queue.empty())
            queued_did = mgr._queue.get_nowait()
            self.assertEqual(queued_did, did)
        finally:
            mgr.shutdown()

    def test_retry_failed_download_method(self):
        did = "dl_failed_movie_1080p"
        sample_record = {
            "download_id": did,
            "title": "Failed Film",
            "media_type": "movie",
            "season": 1,
            "episode": 1,
            "status": "failed",
            "progress_pct": 10.0,
            "stream_url": "http://127.0.0.1:8765/api/mock-stream",
            "created_at": time.time() - 200,
            "file_size": 0,
            "downloaded_bytes": 1024 * 1024 * 10,
            "error": "Connection timed out",
        }
        self.db.upsert_download(did, sample_record)

        mgr = OfflineDownloadManager(
            data_dir=self.tmp_dir,
            remux_engine=None,
            start_workers=False,
            stream_resolver=lambda item: {"stream_url": "http://127.0.0.1:8765/api/mock-stream"},
        )
        try:
            # Drain queue if any
            while not mgr._queue.empty():
                mgr._queue.get_nowait()

            # Call retry_download
            res = mgr.retry_download(did)
            self.assertTrue(res.get("ok"))
            self.assertEqual(res["item"]["status"], "queued")
            self.assertEqual(res["item"]["error"], "")
            self.assertTrue(mgr._items[did].get("lazy_resolve"))

            # Verify queue has the item
            self.assertFalse(mgr._queue.empty())
            self.assertEqual(mgr._queue.get_nowait(), did)
        finally:
            mgr.shutdown()

    def test_dispatch_downloads_retry_route(self):
        from backend.routes import dispatch_post_route

        did = "dl_failed_ep_1080p"
        sample_record = {
            "download_id": did,
            "title": "Failed Episode",
            "media_type": "series",
            "season": 1,
            "episode": 2,
            "status": "failed",
            "created_at": time.time(),
        }
        self.db.upsert_download(did, sample_record)

        mgr = OfflineDownloadManager(
            data_dir=self.tmp_dir,
            remux_engine=None,
            start_workers=False,
            stream_resolver=lambda item: {"stream_url": "http://127.0.0.1:8765/api/mock-stream"},
        )

        sent_payloads = []

        class FakeHandler:
            def _require_authorized_client_if_lan(self, body, lang="ru"):
                return True

            def _send_json(self, data, status=200):
                sent_payloads.append((status, data))

        class FakeCtx:
            app_prefs = {"app_lang": "ru"}
            download_manager = mgr

            class profile_manager:
                @staticmethod
                def is_kids_mode_active():
                    return False

            @staticmethod
            def norm_app_lang(val, default):
                return "ru"

        try:
            handled = dispatch_post_route(
                handler=FakeHandler(),
                path="/api/downloads/retry",
                qs={},
                parsed=None,
                body={"download_id": did},
                ctx=FakeCtx(),
            )
            self.assertTrue(handled)
            self.assertEqual(len(sent_payloads), 1)
            st, body = sent_payloads[0]
            self.assertEqual(st, 200)
            self.assertTrue(body.get("ok"))
            self.assertEqual(body["item"]["status"], "queued")
        finally:
            mgr.shutdown()


if __name__ == "__main__":
    unittest.main()
