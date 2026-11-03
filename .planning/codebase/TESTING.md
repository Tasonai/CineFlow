---
last_mapped_commit: 0ca6949e3be2a26342beea7cbfcd591a789fea04
last_mapped_at: 2026-11-03
---
# Testing Patterns

**Analysis Date:** 2026-11-03

## Test Framework

**Runner:**
- Python standard library `unittest` (Python 3.x)
- Entry point / Config: `run_tests.py` (discovers `test_*.py` in `tests/` with `verbosity=2` and exits via `os._exit(0 if result.wasSuccessful() else 1)` so daemon threads never hang the runner)
- Secondary syntax checker for frontend JS: macOS WebKit JavaScriptCore CLI (`/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m`) invoked inside `tests/test_frontend_integrity.py`

**Assertion Library:**
- Standard `unittest.TestCase` assertion methods (`self.assertEqual`, `self.assertTrue`, `self.assertFalse`, `self.assertIn`, `self.assertNotIn`, `self.assertIsNone`, `self.assertIsNotNone`, `self.assertAlmostEqual`, `self.assertGreater`, `self.assertGreaterEqual`, `self.assertLess`, `self.assertRaises`, `self.assertRegex`)

**Run Commands:**
```bash
python3 run_tests.py                                           # Run entire test suite (recommended)
python3 -m unittest discover -s tests -p "test_*.py" -v        # Standard unittest discovery
python3 -m unittest tests/test_frontend_integrity.py -v        # Run a single test module
```

## Test File Organization

**Location:**
- All test files live in the top-level `tests/` directory (`tests/__init__.py` present).

**Naming:**
- Files: `test_<domain>.py`
- Test classes: `Test<FeatureOrSuite>(unittest.TestCase)`
- Test methods: `test_<behavior_or_invariant>`

**Structure:**
```text
tests/
├── __init__.py
├── test_audit_fixes.py          # Security (SSRF, redaction), scrapers, cross-platform & UI/DOM invariants
├── test_auto_status_rules.py    # Watch progress (10% watching, 95%/credits watched, series finale)
├── test_en_metadata.py          # Phonetic matching, RU->EN bio/genre translation, EN poster resolution
├── test_frontend_integrity.py   # ES module graph, ?v= cache uniformity, JSC syntax, CSS/ARIA/A11y guards
├── test_qrcode_and_remux.py     # Pure-Python QR SVG generation and FFmpeg remux CLI builders
├── test_roadmap_features.py     # Multi-profile isolation, Kids PIN, DLNA/UPnP, offline HTTP Range streaming
├── test_server_live.py          # Live ThreadingHTTPServer endpoints, ETag/304 caching, PWA manifest
└── test_v31_upgrades.py         # SQLite WAL engine, HDRezka homonym guards, WebVTT/ASS, Remote broker
```

## Test Structure

**Suite Organization:**
```python
import json
import os
import tempfile
import unittest

from backend.kinorium import KinoriumService


class _MockNetClient:
    def __init__(self, responses=None):
        self.responses = responses or {}

    def request(self, url, spoof_geo_country="PL", headers=None, timeout=8, **kwargs):
        for pattern, payload in self.responses.items():
            if pattern in url:
                return 200, json.dumps(payload), {}
        return 404, "", {}


class TestAutoStatusRules(unittest.TestCase):
    def test_legacy_085_threshold_migrates_to_095(self):
        with tempfile.TemporaryDirectory() as td:
            with open(os.path.join(td, "kinorium_state.json"), "w", encoding="utf-8") as f:
                json.dump({"account": {"auto_scrobble_threshold": 0.85}}, f)
            svc = KinoriumService(_MockNetClient(), td)
            self.assertEqual(svc.state["account"]["auto_scrobble_threshold"], 0.95)


if __name__ == "__main__":
    unittest.main()
```

**Patterns:**
- **Filesystem Isolation:** Always use `with tempfile.TemporaryDirectory() as tmpdir:` whenever instantiating stateful services (`KinoriumService`, `ProfileManager`, `OfflineDownloadManager`, `CineFlowStorageDB`, `StremioAddonEngine`) so tests never mutate the real `data/` directory.
- **Global Server State Restoration:** When mutating module-level singletons on `server` (`server.profile_manager`, `server.download_manager`, `server.APP_PREFS`), save the original value before the test and restore it in a `try ... finally:` block (`tests/test_roadmap_features.py`, `tests/test_audit_fixes.py`).
- **Ephemeral Port Binding:** Bind live HTTP and WebSocket test servers to `("127.0.0.1", 0)` and read `httpd.server_address[1]` or `sock.getsockname()[1]` so tests never collide with a running CineFlow instance on port `8765`.

## Mocking

**Framework:**
- Lightweight custom fake/stub classes (`_MockNetClient`, `_DummyNetClient`, `_FakeNetForRezka`, `_DummyRemuxEngine`) combined with `unittest.mock.patch` / `patch.object` and direct method lambdas.

**Patterns:**
```python
from unittest.mock import patch

# 1. Context-manager patching on live server services (from tests/test_roadmap_features.py)
with patch.object(server.dlna_manager, "discover_devices", return_value=[]):
    with urllib.request.urlopen(f"{base_url}/api/tv/devices?id=tt0816692", timeout=8) as r_tv:
        self.assertEqual(r_tv.status, 200)

# 2. Instance method stubbing via lambda for HTML/JSON parser tests (from tests/test_audit_fixes.py)
svc = KinoriumService(_DummyNetClient(), tmp)
svc.fetch_kinorium_html = lambda url, *a, **kw: sample_person_html
filmog = svc.fetch_person_filmography(persona_id="295341", name="Кристофер Нолан")
```

**What to Mock:**
- External HTTP requests (`DoHSplitNetworkClient.request` / `fetch_text`, `KinoriumService.fetch_kinorium_html`, `StremioAddonEngine._http_get_json`).
- Subprocess/binary execution (`RemuxStreamEngine` replaced with `_DummyRemuxEngine` or `OfflineDownloadManager(..., start_workers=False)` when testing queue logic or FFmpeg argument construction).
- LAN UDP multicast discovery (`server.dlna_manager.discover_devices`).

**What NOT to Mock:**
- SQLite WAL database operations (`CineFlowStorageDB` is tested against real SQLite databases in `tempfile.TemporaryDirectory()`).
- HTML/XML/subtitle parsers (`KinoriumService.extract_similar_items_html`, `HDRezkaClient._verify_resolved_page`, `parse_upnp_device_xml`, `convert_ass_to_webvtt`).
- `CinemaThreadingHTTPServer` and `CinemaRequestHandler` routing, headers, ETag caching, and HTTP Range streaming.

## Fixtures and Factories

**Test Data:**
- Inline multi-line HTML/XML/ASS/JSON fixtures defined directly inside test methods for high locality (`tests/test_audit_fixes.py`, `tests/test_v31_upgrades.py`, `tests/test_roadmap_features.py`):
```python
sample_mp4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isomCINEFLOW_OFFLINE_VIDEO_PAYLOAD"
with open(os.path.join(item_dir, "video.mp4"), "wb") as vf:
    vf.write(sample_mp4)
```

**Location:**
- Self-contained inside each `tests/test_*.py` file; no external fixture files or shared `conftest.py` required.

## Coverage

**Requirements:** None enforced via coverage percentage tooling, but all new features, bug fixes, and UI/UX invariants are paired with regression tests in `tests/`.

**View Coverage:**
```bash
python3 -m coverage run run_tests.py && python3 -m coverage report   # If coverage package is installed locally
```

## Test Types

**Unit Tests:**
- Test pure logic, CLI command builders, and parsers without network or server threads (`tests/test_en_metadata.py`, `tests/test_qrcode_and_remux.py`, `tests/test_auto_status_rules.py`).

**Live HTTP & Threading Integration Tests:**
- Spin up `CinemaThreadingHTTPServer(("127.0.0.1", 0), CinemaRequestHandler)` on a daemon thread and issue real HTTP `GET`/`HEAD`/`POST` requests with `urllib.request` (`tests/test_server_live.py`, `tests/test_roadmap_features.py`).
- Test multi-threaded long-polling and WebSocket handshakes using `threading.Thread` and local loopback sockets (`test_phone_remote_broker_pairing_state_and_commands` in `tests/test_v31_upgrades.py`, `test_kinorium_one_click_auth_and_native_macos_bundle` in `tests/test_roadmap_features.py`).

**Frontend Static Integrity & Design System Guard Tests (`tests/test_frontend_integrity.py`):**
- **ES Module Graph & Cache Version Check:** Parses all `import` and `export` statements across `public/app.js` and `public/js/*.js`, verifying every imported symbol exists on the target module and every `?v=` parameter matches `public/index.html`.
- **WebKit JSC Syntax Check:** Strips `?v=` query suffixes into a temporary directory and runs macOS `jsc -m app.js` to catch any `SyntaxError` or `ResolveError`.
- **A11y, CSS & Copy Invariants:** Verifies ARIA attributes (`role="dialog"`, `role="tablist"`, `role="switch"`), 44x44px hit-slop pseudo-elements, zero unguarded `:hover` rules outside `@media (hover: hover)`, zero `backdrop-filter: blur(`, zero off-palette hex colors, and zero dotted Russian abbreviations or emojis.
- **Version Synchronization Guards:** `tests/test_frontend_integrity.py` and `tests/test_audit_fixes.py` assert the current application version string across `public/index.html` and `windows/installer/cineflow.nsi` (see `AGENTS.md` for version bump rules).

## Common Patterns

**Live Server Testing (`tests/test_server_live.py`):**
```python
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
```

**HTTP Error & Status Code Testing (`tests/test_roadmap_features.py`):**
```python
req_sw = urllib.request.Request(
    f"{base_url}/api/profiles/switch",
    data=json.dumps({"profile_id": "main"}).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with self.assertRaises(urllib.error.HTTPError) as ctx_sw:
    urllib.request.urlopen(req_sw, timeout=6)
self.assertEqual(ctx_sw.exception.code, 403)
err_json = json.loads(ctx_sw.exception.read())
self.assertTrue(err_json.get("pin_required"))
```

---

*Testing analysis: 2026-11-03*
