---
last_mapped_commit: 0ca6949e3be2a26342beea7cbfcd591a789fea04
last_mapped_at: 2026-11-03
---
# Codebase Structure

**Analysis Date:** 2026-11-03

## Directory Layout

```text
agitated-mendeleev/
├── server.py                       # Main HTTP/1.1 server, API router, and stream proxy
├── run_tests.py                    # Zero-dependency unittest discovery runner
├── AGENTS.md                       # Project build, versioning, and release rules
├── RELEASE_NOTES.md                # Release changelog embedded into installers and GitHub Releases
├── README.md                       # Project overview and usage documentation
├── backend/                        # Python domain services, network layer, and bundled binaries
│   ├── __init__.py
│   ├── aggregator.py               # Unified catalog, search, release calendar, and person profiles
│   ├── backup_stream.py            # 4K HDR/Remux torrent search, TorrServer daemon, and Debrid resolver
│   ├── doh.py                      # DNS-over-HTTPS client, SSRF IP guard, and mirror failover
│   ├── downloads.py                # Background FFmpeg offline downloads ("Скачать в дорогу")
│   ├── en_metadata.py              # English title/cast/episode metadata resolver & transliterator
│   ├── hdrezka.py                  # HDRezka parser, Anubis PoW solver, and stream extractor
│   ├── kinorium.py                 # Kinorium account sync, watchlists, ratings, and episode state
│   ├── kinorium_auth.py            # 1-Click native WebKit/WebView2 Kinorium login orchestrator
│   ├── profiles.py                 # Multi-profile isolation, PIN lockouts, and Kids Mode content filter
│   ├── qrcode_svg.py               # Pure-Python QR Code SVG generator and LAN IPv4 detector
│   ├── regions.py                  # 50-country European registry and anti-censorship/anti-P2P profiles
│   ├── remote_control.py           # Long-polling smartphone Wi-Fi remote broker
│   ├── remuxer.py                  # Live FFmpeg fMP4 remuxer and ffprobe track analyzer
│   ├── skip_intro.py               # TheIntroDB v3 client and cold-open-safe intro/outro timestamps
│   ├── storage_db.py               # SQLite WAL engine (`cineflow.db`) and `LocalVaultCipher`
│   ├── stremio.py                  # Stremio addon manifest/stream/subtitle client
│   ├── subtitles.py                # External subtitle search and SRT/ASS/ZIP → WebVTT converter
│   ├── tv_cast.py                  # SSDP multicast discovery and DLNA/UPnP SOAP casting
│   ├── updater.py                  # GitHub Releases self-updater and SHA-256 verifier
│   └── bin/                        # Bundled native binaries (`ffmpeg`, `ffprobe`, `torrserver`, `kinorium_login_helper`)
├── public/                         # Zero-build ES Module Single-Page Application
│   ├── index.html                  # Application shell, modals, and mobile remote markup
│   ├── app.js                      # Frontend entry point, event wiring, and keyboard shortcuts
│   ├── manifest.webmanifest        # PWA web app manifest
│   ├── favicon.svg                 # Application vector icon
│   ├── icons/                      # Raster and vector app icons (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`)
│   ├── css/                        # Modular stylesheets
│   │   ├── base-and-hero.css
│   │   ├── catalog-and-player-layout.css
│   │   ├── modals-and-search.css
│   │   ├── settings-and-episodes.css
│   │   └── video-controls-and-person.css
│   └── js/                         # Frontend ES modules
│       ├── state.js                # Shared reactive state store and `localStorage` key helpers
│       ├── i18n.js                 # Bilingual RU/EN translation dictionary and localized formatters
│       ├── utils.js                # DOM utilities, custom selects, toasts, and focus management
│       ├── catalog.js              # Catalog shelves, hero slider, filters, command palette, and roulette
│       ├── player.js               # Video player, HLS/remux streaming, studios, episodes, and timeline
│       ├── subtitles.js            # WebVTT cue parser, renderer, and subtitle timing offset controls
│       ├── audio-dsp.js            # Web Audio API compressor/equalizer, video crop, PiP, and Ambilight
│       ├── modals.js               # Quick Peek, Person filmography, and Statistics modals
│       ├── features.js             # Profiles switcher, Offline Downloads UI, and DLNA TV Cast UI
│       ├── settings.js             # Settings modal, Onboarding wizard, Kinorium sync, and Self-Update UI
│       └── remote.js               # Desktop remote telemetry pusher and mobile remote controller UI
├── macos/                          # Native macOS application wrapper and DMG builder
│   ├── CineFlowApp.swift           # Native Cocoa + WKWebView macOS app (`CineFlow.app`)
│   ├── kinorium_login_helper.swift # Native macOS WebKit 1-click Kinorium login helper
│   ├── build_macos_app.py          # Universal 2 `.app` and `.dmg` packaging script
│   ├── Start-CineFlow-macOS.command# Double-clickable macOS shell launcher
│   ├── install-autostart.sh        # LaunchAgent installer
│   └── uninstall-autostart.sh      # LaunchAgent uninstaller
├── windows/                        # Native Windows launcher, WebView2 wrapper, and NSIS installer
│   ├── desktop_webview2.py         # Windows WebView2 desktop host (`pywebview` + `server.py`)
│   ├── kinorium_login_webview.py   # Windows WebView2 / browser cookie extractor for Kinorium
│   ├── apply_install_prefs.py      # Post-install language and country bootstrapper
│   ├── build_windows_installer.py  # Cross-platform Windows `.exe` installer builder (Zig + NSIS)
│   ├── build-windows-exe.bat       # Windows batch build wrapper
│   ├── Start-Cinema-Windows.bat    # Windows batch launcher
│   ├── launcher/                   # Win32 C native executable (`CineFlow.exe`)
│   │   ├── cineflow_launcher.c
│   │   ├── cineflow_launcher.rc
│   │   └── cineflow_launcher.manifest
│   ├── installer/                  # NSIS Modern UI 2 installer script and bilingual licenses
│   │   ├── cineflow.nsi
│   │   ├── license_ru.txt
│   │   └── license_en.txt
│   └── assets/                     # Windows icons and wizard bitmaps
├── scripts/                        # Release automation utilities
│   └── publish_github_release.py   # Publishes GitHub Releases with assets and `RELEASE_NOTES.md`
├── tests/                          # Automated unit and integration test suites
│   ├── test_audit_fixes.py
│   ├── test_auto_status_rules.py
│   ├── test_en_metadata.py
│   ├── test_frontend_integrity.py
│   ├── test_qrcode_and_remux.py
│   ├── test_roadmap_features.py
│   ├── test_server_live.py
│   └── test_v31_upgrades.py
└── plans/                          # UI/UX motion and micro-interaction design plans
```

## Directory Purposes

**`backend/`:**
- Purpose: Contains all server-side domain services, external provider integrations, media processing engines, and SQLite storage logic.
- Contains: Pure Python 3.11+ modules (`*.py`) with zero third-party PyPI dependencies, plus `backend/bin/` for native platform binaries.
- Key files: `backend/aggregator.py`, `backend/kinorium.py`, `backend/hdrezka.py`, `backend/remuxer.py`, `backend/storage_db.py`, `backend/doh.py`.

**`public/`:**
- Purpose: Houses all static frontend assets served by `server.py` at `/`.
- Contains: `public/index.html`, `public/app.js`, 11 ES modules in `public/js/`, 5 modular stylesheets in `public/css/`, and app icons in `public/icons/`.
- Key files: `public/index.html`, `public/app.js`, `public/js/state.js`, `public/js/catalog.js`, `public/js/player.js`.

**`macos/`:**
- Purpose: Native macOS desktop application source, WebKit auth helper, LaunchAgent scripts, and `.app`/`.dmg` packaging pipeline.
- Contains: Swift source files (`*.swift`), Python packaging script (`build_macos_app.py`), and shell scripts (`*.sh`, `*.command`).
- Key files: `macos/CineFlowApp.swift`, `macos/kinorium_login_helper.swift`, `macos/build_macos_app.py`.

**`windows/`:**
- Purpose: Native Windows launcher in C, WebView2 desktop host, Kinorium login helper, and NSIS installer build system.
- Contains: Win32 C source (`windows/launcher/`), NSIS script (`windows/installer/cineflow.nsi`), Python scripts (`desktop_webview2.py`, `build_windows_installer.py`), and `.bat` launchers.
- Key files: `windows/launcher/cineflow_launcher.c`, `windows/desktop_webview2.py`, `windows/installer/cineflow.nsi`, `windows/build_windows_installer.py`.

**`tests/`:**
- Purpose: Automated regression, security, frontend static analysis, and live HTTP server test suites.
- Contains: Python `unittest.TestCase` modules (`test_*.py`).
- Key files: `tests/test_frontend_integrity.py`, `tests/test_server_live.py`, `tests/test_audit_fixes.py`, `tests/test_roadmap_features.py`.

## Key File Locations

**Entry Points:**
- `server.py`: Backend HTTP server entry point (`run_server()` at line 7441) and request router (`CinemaRequestHandler` at line 1863).
- `public/index.html`: Single-page application HTML structure and initial asset loader.
- `public/app.js`: Frontend JavaScript bootstrapper, global event listeners, and deep-link handler.
- `macos/CineFlowApp.swift`: Native macOS app entry point (`@main` / `CineFlowAppController`).
- `windows/launcher/cineflow_launcher.c`: Native Windows GUI launcher (`wWinMain`).
- `windows/desktop_webview2.py`: Windows WebView2 Python runtime entry point (`main()`).
- `run_tests.py`: Test suite runner executing all `tests/test_*.py` files.

**Configuration:**
- `AGENTS.md`: Mandatory project rules for installer packaging and synchronized semantic versioning (`X.Y.Z`).
- `backend/regions.py`: Country-by-country DoH, mirror, P2P, and JustWatch configuration across 50 European countries.
- `public/manifest.webmanifest`: Web application manifest for mobile/PWA installation.

**Core Logic:**
- `backend/aggregator.py`: `UnifiedCinemaAggregator` — catalog assembly, search ranking, deduplication, and release calendar.
- `backend/kinorium.py`: `KinoriumService` — bidirectional Kinorium list/rating/episode synchronization and caching.
- `backend/hdrezka.py`: `HDRezkaClient` — HDRezka mirror bypass, Anubis PoW solver, and stream extraction.
- `backend/remuxer.py`: `RemuxStreamEngine` — `ffprobe` media inspection and live `ffmpeg` fMP4 streaming.
- `backend/storage_db.py`: `CineFlowStorageDB` & `LocalVaultCipher` — SQLite WAL persistence and secret encryption.
- `public/js/player.js`: Video playback lifecycle, custom controls, studio/quality/episode selector, and live remux client.
- `public/js/catalog.js`: Shelf rendering, hero carousel, filtering, notifications popover, and movie roulette.

**Testing:**
- `tests/test_frontend_integrity.py`: Verifies HTML IDs, JS ES module imports, cache-busting `?v=` synchronization, and CSS syntax.
- `tests/test_server_live.py`: End-to-end HTTP server tests against an ephemeral `CinemaThreadingHTTPServer`.
- `tests/test_audit_fixes.py`: Security, SSRF, Vault encryption, and edge-case regression tests.

## Naming Conventions

**Files:**
- Python modules (`backend/*.py`, `tests/test_*.py`): `snake_case.py` (e.g., `backup_stream.py`, `en_metadata.py`, `test_frontend_integrity.py`).
- Frontend JavaScript modules (`public/js/*.js`): `kebab-case.js` or single-word lowercase (`audio-dsp.js`, `catalog.js`, `player.js`, `state.js`).
- Stylesheets (`public/css/*.css`): Descriptive domain-grouped `kebab-case.css` (`base-and-hero.css`, `video-controls-and-person.css`).
- Swift files (`macos/*.swift`): `PascalCase.swift` for app classes (`CineFlowApp.swift`) and `snake_case.swift` for CLI helpers (`kinorium_login_helper.swift`).

**Classes & Symbols:**
- Python classes: `PascalCase` (`UnifiedCinemaAggregator`, `DoHSplitNetworkClient`, `CineFlowStorageDB`); module-private helpers prefixed with `_` (`_SafePublicHTTPConnection`, `_safe_int`).
- Python functions & variables: `snake_case` (`get_streams_for_title`, `resolve_original_audio_fallback`); constants in `UPPER_SNAKE_CASE` (`MAX_JSON_BODY_BYTES`, `DEFAULT_MIRRORS`).
- JavaScript functions & variables: `camelCase` (`openPlayerModal`, `renderCatalogShelves`, `activeStudioId`); storage constants in `UPPER_SNAKE_CASE` (`UI_PREFS_STORAGE_KEY`).
- DOM IDs & CSS classes: `kebab-case` with `atv-` prefix for Apple TV design system components (`atv-header`, `atv-pill`, `btn-open-downloads-modal`).

## Where to Add New Code

**New Backend API Endpoint:**
- Route handler: Add `if path == "/api/<endpoint>":` inside `CinemaRequestHandler.do_GET` or `CinemaRequestHandler.do_POST` in `server.py` (and register the path in `known_get_apis` inside `do_HEAD` at `server.py:2398` if `GET`/`HEAD` is supported).
- Business logic: Place domain logic in the corresponding `backend/<service>.py` module (or create a new `backend/<feature>.py` module and instantiate its singleton in `server.py`).
- Persistence: Store settings or state via `storage_db.get_kv()` / `storage_db.set_kv()` or `storage_db.get_cache_entry()` in `backend/storage_db.py`.

**New Frontend Feature / Modal / Control:**
- State properties: Add initial state fields and `localStorage` key constants to `public/js/state.js`.
- Translations: Add Russian and English strings to `I18N_DICT` in `public/js/i18n.js` and use `t("key")` in JS or `data-i18n="key"` in `public/index.html`.
- Markup: Add modal or control markup to `public/index.html`.
- Logic: Add UI logic to the matching module in `public/js/` (`features.js` for standalone tools/modals, `player.js` for video controls, `catalog.js` for shelves/search, `settings.js` for preferences) and wire top-level DOM event listeners in `public/app.js`.
- Styling: Add styles to the corresponding stylesheet in `public/css/` (`modals-and-search.css` for modals, `video-controls-and-person.css` for player controls, `settings-and-episodes.css` for settings/episodes).
- Cache busting: When modifying frontend assets, update the `?v=YYYYMMDDvNNN` query parameter consistently across `public/index.html`, `public/app.js`, and all `public/js/*.js` import statements.

**New Tests:**
- Add test methods to the relevant suite in `tests/test_*.py` (or create `tests/test_<feature>.py`) and run `python3 run_tests.py`.

## Special Directories

**`data/`:**
- Purpose: Runtime user data directory containing `cineflow.db` (SQLite WAL), `.vault_key` (256-bit secret key), `downloads/` (offline MP4/VTT files), `profiles/` (per-profile state), and `torrserver/` (local TorrServer state).
- Generated: Yes (created automatically at server startup; overridable via `CINEFLOW_DATA_DIR`).
- Committed: No (gitignored).

**`backend/bin/`:**
- Purpose: Holds platform-specific native executables (`ffmpeg`, `ffprobe`, `torrserver`, `kinorium_login_helper`) prepended to `PATH` by `server.py`.
- Generated: Partially (`kinorium_login_helper` is compiled from `macos/kinorium_login_helper.swift`; `ffmpeg`/`torrserver` are bundled binaries).
- Committed: Ignored or managed by packaging scripts.

**`build/` and `dist/`:**
- Purpose: Toolchain caches (`build/cache/`, `build/toolchain/`) and compiled installer artifacts (`dist/CineFlow.app`, `dist/CineFlow.dmg`, `dist/CineFlow-Setup-*.exe`, `dist/latest.json`, `dist/SHA256SUMS.txt`).
- Generated: Yes (by `macos/build_macos_app.py` and `windows/build_windows_installer.py` — **never** run automatically unless explicitly requested by the user per `AGENTS.md`).
- Committed: No (gitignored).

---

*Structure analysis: 2026-11-03*
