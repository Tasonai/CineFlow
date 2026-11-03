---
last_mapped_commit: 0ca6949e3be2a26342beea7cbfcd591a789fea04
last_mapped_at: 2026-11-03
---
<!-- refreshed: 2026-11-03 -->
# Codebase Concerns

**Analysis Date:** 2026-11-03

## Tech Debt

**Monolithic Request Handler and Global Runtime State (`server.py`):**
- Issue: `server.py` (7,524 lines) combines HTTP routing (`CinemaRequestHandler.do_GET`, `do_POST`, `do_HEAD`), media reverse-proxying (`_handle_proxy_stream`), subtitle conversion, Remux lifecycle management (`_ACTIVE_REMUX_PROCS`), LAN listener synchronization (`sync_lan_listener`), and macOS AppleScript window automation (`_trigger_macos_browser_fullscreen_key`, `_trigger_macos_browser_pip_key`) in a single module with module-level singletons (`storage_db`, `net_client`, `rezka_client`, `kinorium_service`, `profile_manager`, `aggregator`, `APP_PREFS`, `SERVER_RUNTIME`).
- Files: `server.py`
- Impact: Any import of `server.py` (including in tests like `tests/test_server_live.py` and `tests/test_audit_fixes.py`) immediately initializes `storage_db`, `ProfileManager`, `KinoriumService`, and `RemuxStreamEngine` hardware probes at import time. Modifying endpoint logic or adding middleware requires navigating thousands of lines of `if path == ...:` branches.
- Fix approach: Extract HTTP route handlers into domain controller modules under `backend/routes/` (e.g., `streams.py`, `kinorium_routes.py`, `downloads_routes.py`, `remote_routes.py`, `system_routes.py`) and encapsulate server singletons inside a `CineFlowApplication` context object passed to `CinemaThreadingHTTPServer`.

**Oversized Domain Modules (`backend/kinorium.py`, `public/js/player.js`, `backend/aggregator.py`):**
- Issue: Core business logic is concentrated in very large files: `backend/kinorium.py` (8,875 lines), `public/js/player.js` (9,281 lines), `public/css/modals-and-search.css` (5,357 lines), `public/js/catalog.js` (4,722 lines), `backend/aggregator.py` (4,618 lines), `public/app.js` (4,249 lines), and `public/js/features.js` (3,650 lines).
- Files: `backend/kinorium.py`, `public/js/player.js`, `backend/aggregator.py`, `public/js/catalog.js`, `public/app.js`, `public/js/features.js`
- Impact: High cognitive load when modifying player state transitions, Kinorium HTML/API parsers, or catalog merging rules; increased risk of regressions across coupled UI states (fullscreen, mini-player, PiP, X-Ray, and remote control sync).
- Fix approach: Split `backend/kinorium.py` into `kinorium_parser.py` (HTML/JSON scraping), `kinorium_sync.py` (bidirectional status/episode reconciliation), and `kinorium_client.py` (HTTP/cookie session transport). Split `public/js/player.js` into focused ES modules (`player-core.js`, `player-remux.js`, `player-controls.js`, `player-xray.js`).

**Dual JSON + SQLite Persistence Compatibility Layer:**
- Issue: State persistence maintains dual-write/dual-read compatibility between legacy JSON files (`data/kinorium_state.json`, `data/profiles.json`, `data/downloads/downloads_index.json`, `data/en_meta_cache.json`, `data/server_settings.json`) and the SQLite WAL database (`data/cineflow.db` via `backend/storage_db.py`).
- Files: `backend/storage_db.py`, `backend/kinorium.py`, `backend/profiles.py`, `backend/downloads.py`, `server.py`
- Impact: Extra disk I/O and serialization overhead on state mutations (such as `OfflineDownloadManager._save_index_locked` writing both SQLite rows via `self._db.replace_all_downloads(mp)` and atomic JSON temp files to `downloads_index.json`), plus complex migration/fallback branches if JSON and SQLite diverge.
- Fix approach: Complete the transition to `CineFlowStorageDB` (`data/cineflow.db`) as the single source of truth, retaining JSON reading strictly as a one-time import migration when `cineflow.db` is first created.

**Multi-File Manual Version and Cache-Buster Synchronization:**
- Issue: Application version strings (`X.Y.Z` / `X.Y.Z.0`) and frontend ES module cache-busting query strings (`?v=YYYYMMDDvNNN`) are hardcoded across 15+ files and enforced by static regex tests.
- Files: `AGENTS.md`, `server.py`, `public/index.html`, `public/app.js`, `public/js/*.js`, `macos/CineFlowApp.swift`, `macos/build_macos_app.py`, `windows/build_windows_installer.py`, `windows/installer/cineflow.nsi`, `windows/launcher/cineflow_launcher.rc`, `tests/test_frontend_integrity.py`
- Impact: Every frontend edit requires updating `?v=...` across `public/index.html`, `public/app.js`, and all `public/js/*.js` imports, and every release requires synchronized edits across Python, Swift, C, NSIS, batch scripts, and test files.
- Fix approach: Centralize version metadata in a single `VERSION` or `version.json` file read by build scripts and `server.py`, and compute or inject asset version hashes dynamically or via a lightweight sync script.

## Known Bugs

**Interrupted Offline Downloads Mark as Failed Instead of Resuming on Restart:**
- Symptoms: Any offline download in `downloading` or `queued` status when the server stops or restarts is permanently marked `failed` with `"Загрузка была прервана при перезапуске"` upon next startup rather than re-queuing or resuming.
- Files: `backend/downloads.py` (`OfflineDownloadManager._load_index`, lines 168-172)
- Trigger: Start an offline movie/episode download and quit or restart CineFlow before FFmpeg finishes writing `video.mp4`.
- Workaround: Manually retry/re-enqueue the failed item in the Downloads modal.

**Debug Logging Left Enabled on Every HDRezka Stream Request:**
- Symptoms: Every call to `/api/hdrezka/streams` writes raw `[CineFlow-DEBUG] streams req:` and `[CineFlow-DEBUG] streams resp:` lines to stdout/log files regardless of log verbosity settings.
- Files: `server.py` (lines 2675 and 3063)
- Trigger: Open any movie or series in the player or switch episodes/translators.
- Workaround: None; logs accumulate in `data/cineflow-macos.log` / `data/cineflow.log`. Gate behind `CINEFLOW_VERBOSE_LOG`.

## Security Considerations

**Intentional TLS Verification Bypass for Voidboost CDN Edges:**
- Risk: When connecting to `voidboost.*` or `*.voidboost.*` media CDN hosts (`_is_voidboost_cdn_host`), `_connect_media_http` catches `ssl.SSLCertVerificationError` and retries using `_SHARED_UNVERIFIED_SSL_CTX` (`ssl._create_unverified_context()`) to work around expired upstream CDN certificates. This exposes media stream byte-range connections to potential MITM tampering on untrusted networks.
- Files: `server.py` (`_SHARED_UNVERIFIED_SSL_CTX` at line 830, `_connect_media_http` at lines 1028 and 1061-1075), `backend/doh.py`
- Current mitigation: Only enabled for hostnames matching `_is_voidboost_cdn_host(host)`, peer IP is verified to be strictly public (`_is_strictly_public_ip_obj`), and response `Content-Type` is stripped to media-only MIME types via `_safe_media_content_type` with `X-Content-Type-Options: nosniff`.
- Recommendations: Restrict the unverified context fallback exclusively to `SSLCertVerificationError` with expired-certificate reason codes (`verify_code == 10` / `X509_V_ERR_CERT_HAS_EXPIRED`) while still validating the leaf certificate hostname/chain structure, or make the fallback user-configurable.

**Custom Stream Cipher Construction in `LocalVaultCipher`:**
- Risk: `LocalVaultCipher` implements a custom HMAC-SHA256 counter-mode stream cipher (`_keystream` + XOR + truncated 128-bit HMAC-SHA256 tag) in pure Python to avoid external C-extension dependencies (`cryptography`), storing the raw 32-byte key in `data/.vault_key`. On Windows (`sys.platform == "win32"`), `set_private_file_permissions` is a no-op (`if not path or sys.platform == "win32": return`), leaving `data/.vault_key` and `data/cineflow.db` governed by default parent directory ACLs.
- Files: `backend/storage_db.py` (`set_private_file_permissions` at lines 18-26, `LocalVaultCipher` at lines 29-174)
- Current mitigation: Uses `secrets.token_bytes`, domain-separated HMAC tag (`CINEFLOW_VAULT_V1`), and constant-time `hmac.compare_digest`.
- Recommendations: On Windows, protect the 32-byte master key in `data/.vault_key` using Windows DPAPI (`CryptProtectData` / `CryptUnprotectData` via `ctypes.windll.crypt32`) or apply explicit owner-only DACLs via `icacls` / Win32 security APIs.

**Plaintext HTTP Transport for LAN Access, DLNA Casting, and Mobile Remote:**
- Risk: When LAN mode (`lan_access`) is enabled, the server listens on `http://<lan_ip>:8765` without TLS. The mobile remote pairing key (`k` query parameter or `X-CineFlow-Key` header, 16 hex chars) and Kids Mode 4-digit PIN (`X-CineFlow-Pin`) traverse the local Wi-Fi network in cleartext HTTP.
- Files: `server.py` (`_require_authorized_client_if_lan`, `_require_kids_pin_if_locked`, `sync_lan_listener`), `backend/remote_control.py` (`DesktopRemoteBroker.verify_key`)
- Current mitigation: Loopback-only enforcement (`_is_loopback_client`) on administrative endpoints (`/api/remote/pair`, `/api/downloads/open-folder`, `/api/remote/commands`), brute-force lockout on remote keys (30 failures/60s freezes for 60s in `backend/remote_control.py`) and Kids PINs (`backend/profiles.py`), and DNS rebinding `Host` / `Origin` checks.
- Recommendations: Avoid passing the pairing key `k` in URL query strings after initial pairing (exchange it for an `HttpOnly` session cookie or `X-CineFlow-Key` header only) and consider challenge-response HMAC signing for LAN remote requests.

**macOS AppleScript Keystroke Injection for Fullscreen / PiP:**
- Risk: `_trigger_macos_browser_fullscreen_key` and `_trigger_macos_browser_pip_key` invoke `osascript` (`tell application "System Events" ... key code 3 / key code 34`) to bring a browser process to the foreground and synthesize keystrokes when triggered by the mobile remote.
- Files: `server.py` (lines 7135-7150, 7207-7223, 7250-7320)
- Current mitigation: Restricted to local or paired-remote requests when `SERVER_RUNTIME["running"]` is true, and uses hardcoded browser lists (`browserList`).
- Recommendations: When running inside the native `CineFlow.app` WKWebView wrapper (`macos/CineFlowApp.swift`), route fullscreen and PiP commands through the native bridge rather than synthesizing global `System Events` keystrokes.

## Performance Bottlenecks

**Synchronous Full-Table Rewrite on Download Progress Updates:**
- Problem: `OfflineDownloadManager._save_index_locked` calls `self._db.replace_all_downloads(mp)` (which executes `DELETE FROM downloads` followed by re-inserting every download row in `backend/storage_db.py`) and rewrites the entire `downloads_index.json` file on disk.
- Files: `backend/downloads.py` (`_save_index_locked`, lines 190-208), `backend/storage_db.py` (`replace_all_downloads`)
- Cause: The persistence method replaces the entire downloads collection instead of updating a single `download_id` row.
- Improvement path: Add an incremental `upsert_download(download_id, item_dict)` method in `CineFlowStorageDB` and debounce `downloads_index.json` snapshots during active FFmpeg progress ticks.

**Single SQLite Connection Contention Under Concurrent Threads:**
- Problem: `CineFlowStorageDB` shares a single `sqlite3.Connection` (`check_same_thread=False`) guarded by a process-wide `threading.RLock()` (`self._lock`) for all reads and writes across `CinemaThreadingHTTPServer` worker threads, background sync daemons, and download workers.
- Files: `backend/storage_db.py` (lines 229-243)
- Cause: Even though SQLite WAL mode supports concurrent readers alongside a writer, serializing all queries through one `sqlite3.Connection` and one Python `RLock` turns concurrent read requests into sequential operations.
- Improvement path: Use thread-local read connections (or a small connection pool) for `SELECT` queries while keeping the `RLock` and write connection dedicated to `_write_tx` transactions.

**Canvas Ambilight Sampling and Unbundled Frontend Boot:**
- Problem: `startAmbilightLoop` in `public/js/audio-dsp.js` periodically draws `<video>` frames onto a 2D `<canvas>` and calls `getImageData` on the main thread during playback. Additionally, the frontend loads 11 separate ES module files and 5 CSS stylesheets without bundling or minification (~30,000+ lines of raw JS/CSS).
- Files: `public/js/audio-dsp.js`, `public/app.js`, `public/index.html`
- Cause: Zero-build frontend architecture serves raw source files directly from `public/`.
- Improvement path: Keep `server.py`'s in-memory gzip static cache (`_load_cached_static_file`) warm at startup, and pause or throttle the Ambilight canvas sampling loop when the browser tab is backgrounded, in fullscreen/PiP, or on battery power.

## Fragile Areas

**HTML Scraping and Stream Obfuscation Decoders (`backend/hdrezka.py`, `backend/kinorium.py`):**
- Files: `backend/hdrezka.py` (`decode_rezka_stream_bundle`, Anubis PoW solver, DOM regex extractors), `backend/kinorium.py` (HTML regex scrapers for user lists, episode air dates, and persona pages)
- Why fragile: Upstream providers (`hdrezka.*` mirrors and `kinorium.com`) frequently change their HTML markup, Base64 trash-token obfuscation (`TRASH_CHARS`, `//_//` delimiters in `HDRezkaClient.decode_rezka_stream_bundle`), or anti-bot challenges (Anubis PoW / Cloudflare / IP rate-limiting).
- Safe modification: Always test changes against fixture payloads in `tests/test_audit_fixes.py` and `tests/test_v31_upgrades.py`, preserve fallback chains (`backup_stream_engine` and `stremio_engine`), and never remove defensive bounds (`_read_bounded`, `_MAX_KINORIUM_RESP_BYTES`).
- Test coverage: Covered by unit tests with mocked HTML/JSON in `tests/test_audit_fixes.py`, but live upstream markup drift cannot be caught without live integration checks.

**Browser Cookie Database Extraction in One-Click Kinorium Auth (`windows/kinorium_login_webview.py`):**
- Files: `windows/kinorium_login_webview.py`, `backend/kinorium_auth.py`, `macos/kinorium_login_helper.swift`
- Why fragile: Extracting authenticated session cookies from third-party browsers (Gecko `cookies.sqlite` WAL/journal files and Chromium `--app` CDP debugging ports) depends on browser profile directory layouts, SQLite locking behavior while the browser is running, and Chromium command-line flag behavior.
- Safe modification: Maintain the WebKit/WebView2 and manual cookie fallbacks whenever modifying browser discovery or CDP capture logic.
- Test coverage: Basic unit coverage of cookie parsing (`extract_cookie_user_id`, `_has_valid_auth_cookie`), but browser process spawning and live CDP/SQLite capture are not exercised in automated CI tests.

**Strict Static Regex Invariants in `tests/test_frontend_integrity.py`:**
- Files: `tests/test_frontend_integrity.py`
- Why fragile: Tests enforce strict source-text invariants across HTML, CSS, JS, and Swift files—including zero emojis (`[\U0001F300-\U0001FAFF\u2600-\u27BF]`), zero dotted Russian abbreviations (`сек.`, `мин.`, `эп.`, `стр.`, `г.`), zero `backdrop-filter: blur(`, zero non-`none` CSS `outline:` rules, zero inline `style="` attributes in `modals.js` and `settings.js`, and exact `?v=` query parameter uniformity across every ES module `import`.
- Safe modification: Always run `python3 run_tests.py` after any frontend or string edit, and update `?v=` uniformly across `public/index.html`, `public/app.js`, and all `public/js/*.js` files.
- Test coverage: 100% enforced by `TestFrontendIntegrity` in `tests/test_frontend_integrity.py`.

## Scaling Limits

**Local Single-Node Threading & Process Model:**
- Current capacity: Designed for single-household desktop/LAN use (`CinemaThreadingHTTPServer` with `request_queue_size = 128`, `OfflineDownloadManager.MAX_CONCURRENT = 2`, and on-the-fly FFmpeg remuxing subprocesses in `_ACTIVE_REMUX_PROCS`).
- Limit: Concurrent 4K HEVC/remux streams or simultaneous multi-device LAN streams are bounded by local CPU/GPU hardware encoder sessions (`VideoToolbox` / `NVENC` / `QSV` / `AMF`) and upstream CDN per-IP connection limits.
- Scaling path: Cap concurrent `_ACTIVE_REMUX_PROCS` per client IP so rapid seeking or multiple open tabs automatically terminate superseded FFmpeg remux processes immediately.

**In-Memory Caches in `server.py` and Backend Services:**
- Current capacity: Bounded dictionary caches (`_ALLOWED_MEDIA_HOST_CACHE` capped at 512, `DEAD_MEDIA_EDGE_IPS` capped at 512, `SkipIntroEngine.cache` capped at 512), while some caches in `HDRezkaClient` (`page_cache`, `trailer_cache`, `person_profile_cache`, `person_url_by_name`) and static asset caches in `server.py` grow over the process lifetime.
- Limit: Long-running daemon instances (`--launchd` on macOS or background tray process on Windows) running for weeks can accumulate thousands of entries in `HDRezkaClient.page_cache` and `person_profile_cache`.
- Scaling path: Add size caps (LRU or batch eviction similar to `SkipIntroEngine._set_cached_segment`) to `HDRezkaClient.page_cache`, `trailer_cache`, and `person_profile_cache`.

## Dependencies at Risk

**Prebuilt Native Binaries Checked Into Repository (`backend/bin/` and `build/cache/`):**
- Risk: The repository tracks large binary executables directly (`backend/bin/ffmpeg`, `backend/bin/ffprobe`, `backend/bin/torrserver`, `backend/bin/kinorium_login_helper`, and Windows build caches under `build/cache/`). Binary blobs bloat repository size, are architecture-specific (e.g., macOS arm64 vs x86_64, Windows amd64), and do not receive automated security updates.
- Files: `backend/bin/ffmpeg`, `backend/bin/ffprobe`, `backend/bin/torrserver`, `backend/bin/kinorium_login_helper`, `macos/build_macos_app.py`, `windows/build_windows_installer.py`
- Impact: Running from source on a different OS/CPU architecture fails unless matching binaries are installed on `PATH` or staged by the platform installer script.
- Migration plan: Document exact upstream versions and SHA-256 checksums for `ffmpeg`, `ffprobe`, and `torrserver` in a manifest, and fetch/verify them in `build_macos_app.py` / `build_windows_installer.py` rather than committing build staging artifacts under `build/`.

**External Unofficial APIs (HDRezka Mirrors, JacRed, Torrentio, TheIntroDB, IMDb Suggestion API):**
- Risk: Stream resolution and metadata enrichment depend on third-party endpoints without SLAs (`hdrezka-home.tv`, `jacred.xyz`, `jac.red`, `torrentio.strem.fun`, `api.theintrodb.org`, `v3.sg.media-imdb.com`).
- Files: `backend/hdrezka.py`, `backend/backup_stream.py`, `backend/stremio.py`, `backend/skip_intro.py`, `backend/en_metadata.py`
- Impact: Domain blocks, mirror takedowns, or API schema changes can degrade stream discovery or metadata resolution.
- Migration plan: Continue maintaining multi-provider fallbacks (HDRezka -> JacRed/TorrServer -> Stremio addons -> local offline downloads) and DoH/Cloudflare Worker relay support in `backend/doh.py`.

## Missing Critical Features

**Incomplete Linux Desktop Integration:**
- Problem: While `backend/updater.py` (`get_platform_key()`) and `backend/kinorium_auth.py` detect `linux`, system autostart (`set_system_autostart` in `server.py`), native app packaging (`macos/`, `windows/`), and hardware acceleration defaults are only implemented for macOS (`launchd` / `CineFlow.app`) and Windows (Registry `Run` / `CineFlow.exe`).
- Files: `server.py` (lines 519-525), `backend/updater.py` (lines 72-77)
- Blocks: First-class Linux desktop deployment (systemd/XDG autostart and AppImage/deb packaging).

**Resumable Partial Offline Downloads:**
- Problem: Offline downloads via FFmpeg write to a staging directory and mark interrupted downloads as `failed` on startup (`backend/downloads.py`, lines 168-172) without resuming partial downloads or automatically re-queuing interrupted jobs.
- Files: `backend/downloads.py`
- Blocks: Seamless background downloading across laptop sleep/reboot cycles.

## Test Coverage Gaps

**Frontend DOM and Player State Machine Behavior (`public/js/*.js`):**
- What's not tested: Interactive browser execution of the 9,281-line video player (`public/js/player.js`), catalog filtering/rendering (`public/js/catalog.js`), Web Audio DSP graph (`public/js/audio-dsp.js`), and spatial TV navigation (`public/js/features.js`). Current frontend tests (`tests/test_frontend_integrity.py`) validate static AST/regex invariants and JavaScriptCore module syntax (`jsc -m`), not runtime DOM state transitions.
- Files: `public/js/player.js`, `public/js/catalog.js`, `public/js/features.js`, `public/js/audio-dsp.js`, `tests/test_frontend_integrity.py`
- Risk: Runtime regressions in episode switching, autoplay timers, PiP/fullscreen transitions, or modal focus restoration can pass static regex checks undetected.
- Priority: High

**Native Wrapper and Installer Build Scripts (`macos/` and `windows/`):**
- What's not tested: Compilation and runtime behavior of `macos/CineFlowApp.swift`, `macos/kinorium_login_helper.swift`, `windows/launcher/cineflow_launcher.c`, `windows/desktop_webview2.py`, `macos/build_macos_app.py`, and `windows/build_windows_installer.py`.
- Files: `macos/CineFlowApp.swift`, `macos/build_macos_app.py`, `windows/launcher/cineflow_launcher.c`, `windows/build_windows_installer.py`, `windows/desktop_webview2.py`
- Risk: Platform-specific regressions in process lifecycle management, port takeover, or WebView bridge messaging are only caught during manual packaging/testing.
- Priority: Medium

**Live FFmpeg Remux Streaming and DLNA Socket Loops:**
- What's not tested: End-to-end streaming of fragmented MP4 output from `RemuxStreamEngine` through `CinemaRequestHandler` under client disconnect/seek storms, and live UDP SSDP multicast discovery (`DlnaCastManager` in `backend/tv_cast.py`).
- Files: `backend/remuxer.py`, `backend/tv_cast.py`, `server.py`
- Risk: Orphaned `ffmpeg` processes or socket timeout edge cases under rapid client range/seek requests.
- Priority: Medium

---

*Concerns audit: 2026-11-03*
