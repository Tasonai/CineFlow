import json
import threading
import unittest
import urllib.error
import urllib.request

from server import CinemaRequestHandler, CinemaThreadingHTTPServer


class TestLiveHttpServerEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = CinemaThreadingHTTPServer(("127.0.0.1", 0), CinemaRequestHandler)
        cls.port = cls.httpd.server_address[1]
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def _req(self, path: str, method: str = "GET"):
        r = urllib.request.Request(self.base_url + path, method=method)
        try:
            with urllib.request.urlopen(r, timeout=15) as resp:
                return resp.status, resp.headers.get("Content-Type", ""), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers.get("Content-Type", ""), e.read()

    def test_root_and_pwa_manifest(self):
        st, ct, body = self._req("/")
        self.assertEqual(st, 200)
        self.assertIn("text/html", ct)
        self.assertIn(b"manifest.webmanifest", body)

        st_m, ct_m, body_m = self._req("/manifest.webmanifest")
        self.assertEqual(st_m, 200)
        self.assertIn("manifest+json", ct_m)
        manifest = json.loads(body_m)
        self.assertEqual(manifest.get("short_name"), "CineFlow")

    def test_missing_static_assets_return_404(self):
        st_get, _, _ = self._req("/css/nonexistent-style.css", "GET")
        st_head, _, _ = self._req("/js/nonexistent-script.js", "HEAD")
        self.assertEqual(st_get, 404)
        self.assertEqual(st_head, 404)

    def test_system_status_and_catalog_endpoints(self):
        st_sys, _, body_sys = self._req("/api/system/status")
        self.assertEqual(st_sys, 200)
        sys_data = json.loads(body_sys)
        self.assertEqual(sys_data.get("app"), "cineflow")
        self.assertIn("hw_accel", sys_data)

        for lang in ("ru", "en"):
            st_cat, _, body_cat = self._req(f"/api/catalog?lang={lang}")
            self.assertEqual(st_cat, 200)
            cat_data = json.loads(body_cat)
            self.assertGreater(len(cat_data.get("items") or []), 0)


if __name__ == "__main__":
    unittest.main()
