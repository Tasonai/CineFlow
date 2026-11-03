---
last_mapped_commit: 0ca6949e3be2a26342beea7cbfcd591a789fea04
last_mapped_at: 2026-11-03
---
<!-- refreshed: 2026-11-03 -->
# Architecture

**Analysis Date:** 2026-11-03

## System Overview

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                     Native Desktop Shells & Browsers                        │
├──────────────────────────┬─────────────────────────┬───────────────────────┤
│   macOS WKWebView App    │  Windows C + WebView2   │  Desktop / Mobile Web │
│ `macos/CineFlowApp.swift`│`windows/desktop_webview2│  `public/index.html`  │
│                          │  .py` + `launcher/*.c`  │                       │
└────────────┬─────────────┴────────────┬────────────┴───────────┬───────────┘
             │                          │                        │
             ▼                          ▼                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                     Zero-Build ES Module Frontend SPA                      │
│   `public/app.js` • `public/js/{state,catalog,player,modals,settings,      │
│     features,subtitles,audio-dsp,remote,i18n,utils}.js` • `public/css/*`   │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        │ HTTP/1.1 JSON + Byte-Range + Long-Poll
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                    Local Threaded HTTP Gateway & Router                     │
│        `server.py` (`CinemaThreadingHTTPServer` + `CinemaRequestHandler`)   │
└───────┬──────────────────┬────────────────────┬───────────────────┬────────┘
        │                  │                    │                   │
        ▼                  ▼                    ▼                   ▼
┌───────────────┐  ┌───────────────┐  ┌──────────────────┐  ┌────────────────┐
│ Catalog &     │  │ Media & Remux │  │ Kinorium &       │  │ Device &       │
│ Metadata      │  │ Pipeline      │  │ Multi-Profile    │  │ System         │
│ `aggregator`  │  │ `hdrezka`     │  │ `kinorium`       │  │ `remote_control│
│ `en_metadata` │  │ `remuxer`     │  │ `kinorium_auth`  │  │ `tv_cast`      │
│ `regions`     │  │ `backup_stream│  │ `profiles`       │  │ `downloads`    │
│               │  │ `stremio`     │  │                  │  │ `updater`      │
│               │  │ `subtitles`   │  │                  │  │                │
│               │  │ `skip_intro`  │  │                  │  │                │
└───────┬───────┘  └───────┬───────┘  └────────┬─────────┘  └────────┬───────┘
        │                  │                   │                     │
        └──────────────────┼───────────────────┼─────────────────────┘
                           ▼                   ▼
┌────────────────────────────────────┐ ┌─────────────────────────────────────┐
│   DoH Split-Network & Subprocess   │ │    SQLite WAL + Vault Persistence    │
│   `backend/doh.py`                 │ │    `backend/storage_db.py`          │
│   `backend/bin/{ffmpeg,torrserver}`│ │    `data/cineflow.db` + `.vault_key`│
└────────────────────────────────────┘ └─────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| HTTP Gateway & Router | Serves static SPA assets, exposes `/api/*` REST endpoints, proxies HLS/MP4 media streams with SSRF/DNS-rebinding guards, and manages background sync daemons | `server.py` |
| Unified Catalog Aggregator | Merges curated titles, Kinorium user lists, HDRezka live search, JustWatch Poland/EU GraphQL offers, and Stremio streams into a unified catalog with deduplication and release calendar | `backend/aggregator.py` |
| DoH Split-Network Client | Performs DNS-over-HTTPS resolution (Cloudflare `1.1.1.1` / Google `8.8.8.8`), enforces public-IP-only SSRF validation, manages country-specific bypass profiles, and rotates mirrors | `backend/doh.py` |
| HDRezka Stream Extractor | Solves Anubis PoW challenges, bypasses geo-blocks, deobfuscates `#h` base64 stream manifests, filters 15s Premium QR promo stubs, and extracts multi-studio MP4/HLS streams | `backend/hdrezka.py` |
| Kinorium Sync Service | Synchronizes user watchlists, watched history, ratings, per-episode progress, friends' activity, and curated collections with `kinorium.com`, backed by local optimistic reconciliation | `backend/kinorium.py` |
| Kinorium 1-Click Auth | Orchestrates native WebKit (`macos/kinorium_login_helper.swift`) and WebView2 (`windows/kinorium_login_webview.py`) login windows to capture session cookies without DevTools | `backend/kinorium_auth.py` |
| Live FFmpeg Remux Engine | Probes MKV/BDRemux/Torrent streams via `ffprobe` and live-remuxes video (`-c:v copy` or HW-accelerated HEVC→H.264) + multi-channel audio (`AC3/DTS/TrueHD` → stereo AAC) into fragmented MP4 (`fMP4`) | `backend/remuxer.py` |
| 4K Backup & TorrServer Engine | Manages the bundled local `torrserver` daemon, searches 4K HDR/Remux torrents (TorrServer/Jackett/RuTracker/YTS/EZTV), and resolves Real-Debrid/TorBox magnet streams | `backend/backup_stream.py` |
| Stremio Addon Engine | Installs Stremio manifest addons (`Torrentio`, `OpenSubtitles`, custom URLs), resolves IMDb IDs, and normalizes addon streams and subtitles | `backend/stremio.py` |
| Offline Download Manager | Queues background FFmpeg downloads (`Скачать в дорогу`) with selected audio track, embedded/sidecar WebVTT subtitles, local poster cache, and HTTP Byte-Range playback | `backend/downloads.py` |
| SQLite WAL Storage & Vault | Thread-safe SQLite WAL database (`data/cineflow.db`) with savepoint transactions and `LocalVaultCipher` (`HMAC-SHA256` CTR + tag using `data/.vault_key`) for encrypting credentials at rest | `backend/storage_db.py` |
| Multi-Profile & Kids Guard | Manages isolated user profiles (`main`, `family`, `kids`, custom), PIN verification with brute-force lockouts, and strict Kids Mode content/genre/keyword filtering | `backend/profiles.py` |
| English Metadata Resolver | Resolves English titles, descriptions, cast/crew names, episode titles, and non-Cyrillic posters via IMDb/Cinemeta/TVMaze/Wikipedia when UI language is set to English | `backend/en_metadata.py` |
| Subtitle Search & Converter | Searches external subtitles and converts SRT, ASS/SSA (with linear-time tag/drawing stripping), and ZIP/GZIP archives into clean UTF-8 WebVTT | `backend/subtitles.py` |
| Skip Intro Engine | Queries TheIntroDB v3 API and verified cold-open tables for episode-accurate intro/recap/outro timestamps | `backend/skip_intro.py` |
| Smartphone Remote Broker | Condition-variable long-polling broker (`DesktopRemoteBroker`) synchronizing desktop playback state with mobile Wi-Fi remotes (`?remote=1`) | `backend/remote_control.py` |
| DLNA / UPnP Cast Manager | Discovers LAN Smart TVs via SSDP multicast (`239.255.255.250:1900`) and controls playback via SOAP `AVTransport` commands | `backend/tv_cast.py` |
| Self-Updater Engine | Checks GitHub Releases / `latest.json`, verifies SHA-256 digests, downloads `.dmg` / `Setup.exe` atomically, and launches the installer | `backend/updater.py` |
| Frontend Application Entry | Bootstraps the SPA, binds global DOM/keyboard shortcuts, initializes deep-link routing, and coordinates UI modules | `public/app.js` |
| Frontend Player & DSP | Drives HTML5 `<video>` + `hls.js` playback, studio/quality/episode switching, Web Audio API compressor/EQ (`audio-dsp.js`), and Canvas Ambilight | `public/js/player.js`, `public/js/audio-dsp.js` |
| Native Desktop Wrappers | Provide native app windowing, MediaPlayer Now Playing integration, menu bar / system tray controls, and server lifecycle management on macOS and Windows | `macos/CineFlowApp.swift`, `windows/desktop_webview2.py`, `windows/launcher/cineflow_launcher.c` |

## Pattern Overview

**Overall:** Local-First Client-Server Desktop & Home-Theater Architecture (Zero-Dependency Python Backend + Zero-Build ES Module SPA + Native OS WebView Shells)

**Key Characteristics:**
- **Zero-External-Pip Backend:** The Python server (`server.py` and `backend/*.py`) uses exclusively the Python 3.11+ standard library plus bundled native binaries in `backend/bin/` (`ffmpeg`, `ffprobe`, `torrserver`, `kinorium_login_helper`).
- **Zero-Build Modular Frontend:** The browser client (`public/index.html`, `public/app.js`, `public/js/*.js`, `public/css/*.css`) runs native ES modules directly in the browser with cache-busted query strings (`?v=YYYYMMDDvNNN`) and no bundler/transpiler step.
- **Loopback + Optional LAN Dual Listener:** Binds to `127.0.0.1:8765` by default and dynamically starts/stops a secondary `CinemaThreadingHTTPServer` bound to the LAN IPv4 address (`sync_lan_listener` in `server.py`) when home Wi-Fi access (`lan_access`) is enabled for Smart TV DLNA casting or smartphone remote control.
- **Optimistic Local State with Background Reconciliation:** User actions (marking watched, rating, updating episode progress) write immediately to `CineFlowStorageDB` (`data/cineflow.db`) and reconcile asynchronously with `kinorium.com`.

## Layers

**Presentation & Native Shell Layer:**
- Purpose: Renders the Apple TV-inspired interface, manages video/audio playback, and integrates with macOS/Windows desktop windowing and media keys.
- Location: `public/index.html`, `public/app.js`, `public/js/*.js`, `public/css/*.css`, `macos/CineFlowApp.swift`, `windows/desktop_webview2.py`, `windows/launcher/cineflow_launcher.c`
- Contains: ES module UI controllers, reactive-style shared `state` store (`public/js/state.js`), bilingual dictionary (`public/js/i18n.js`), Web Audio DSP pipeline (`public/js/audio-dsp.js`), and native WKWebView/WebView2 hosts.
- Depends on: HTTP REST/streaming endpoints served by `server.py` on `http://127.0.0.1:8765`.
- Used by: End users on macOS, Windows, and LAN mobile/TV browsers.

**HTTP Gateway & Security Boundary Layer:**
- Purpose: Routes incoming HTTP `GET`, `POST`, `HEAD`, and `OPTIONS` requests, enforces DNS-rebinding/CSRF/CORS/PIN security checks, and streams media or JSON responses.
- Location: `server.py` (`CinemaRequestHandler`, `CinemaThreadingHTTPServer`)
- Contains: Route dispatchers (`do_GET`, `do_POST`, `do_HEAD`, `do_OPTIONS`), static asset cache with GZIP compression (`_load_cached_static_file`), media stream proxy (`_handle_proxy_stream`), and offline file byte-range streamer (`_serve_offline_video_file`).
- Depends on: Domain service singletons in `backend/*.py`.
- Used by: Presentation & Native Shell Layer, Smartphone Remote UI, and DLNA Smart TVs.

**Domain & Media Aggregation Layer:**
- Purpose: Implements business logic for catalog aggregation, stream extraction, live FFmpeg remuxing, subtitle conversion, profile isolation, and device casting.
- Location: `backend/aggregator.py`, `backend/hdrezka.py`, `backend/kinorium.py`, `backend/remuxer.py`, `backend/backup_stream.py`, `backend/stremio.py`, `backend/downloads.py`, `backend/subtitles.py`, `backend/skip_intro.py`, `backend/en_metadata.py`, `backend/profiles.py`, `backend/remote_control.py`, `backend/tv_cast.py`, `backend/updater.py`
- Contains: Service classes instantiated as module-level singletons in `server.py` (lines 105–314).
- Depends on: `backend/doh.py` for outbound network I/O, `backend/storage_db.py` for persistence, and `backend/bin/*` for media processing.
- Used by: `server.py`.

**Infrastructure, Network & Persistence Layer:**
- Purpose: Provides encrypted local SQLite persistence, censorship-resistant DoH networking with SSRF guards, and subprocess management for `ffmpeg`/`torrserver`.
- Location: `backend/storage_db.py`, `backend/doh.py`, `backend/regions.py`, `backend/qrcode_svg.py`, `backend/bin/`
- Contains: `CineFlowStorageDB`, `LocalVaultCipher`, `DoHSplitNetworkClient`, country bypass profiles, and pure-Python QR SVG generator.
- Depends on: Python standard library (`sqlite3`, `http.client`, `ssl`, `socket`, `subprocess`) and `data/` filesystem directory.
- Used by: All domain services and `server.py`.

## Data Flow

### Primary Request Path: Catalog & Title Metadata Loading

1. Frontend startup (`public/app.js` → `loadCatalog()` in `public/js/catalog.js`) issues `GET /api/catalog?provider=...&type=...&kinorium_section=...&lang=...`.
2. `CinemaRequestHandler.do_GET` (`server.py:2623`) validates `Host`/`Origin` headers and delegates to `aggregator.get_catalog()` (`backend/aggregator.py:1523`).
3. `UnifiedCinemaAggregator.get_catalog()` combines `CURATED_CATALOG`, Kinorium remote/local lists (`kinorium_service.get_section_catalog_items()`), JustWatch GraphQL offers (`_fetch_justwatch_by_provider()`), and online premieres (`_get_online_premieres()`), filtering out adult/blocked items if `profile_manager.is_kids_mode_active()` is true.
4. If `ui_lang == "en"`, `EnglishMetadataResolver` (`backend/en_metadata.py`) enriches items with English titles, descriptions, genres, and posters, warming missing entries asynchronously in a background thread (`_prewarm_en_metadata_for_items`).
5. `CinemaRequestHandler._send_json` (`server.py:2021`) serializes and GZIP-compresses the JSON payload back to `public/js/catalog.js`, which updates `state.catalogItems` (`public/js/state.js`) and renders the hero banner and horizontal shelves.

### Video Playback & Live Remux Flow

1. User clicks Play on a title (`openPlayerModal()` in `public/js/player.js`), triggering `GET /api/hdrezka/streams` (`server.py:2663`) or `GET /api/backup-streams` (`server.py:4357`) / `GET /api/stremio/streams` (`server.py:4418`).
2. For HDRezka streams, `HDRezkaClient.get_streams_for_title()` (`backend/hdrezka.py`) fetches the mirror page via `DoHSplitNetworkClient` (`backend/doh.py`), decodes obfuscated `#h` stream URLs, verifies they are not Premium promo stubs, and wraps CDN URLs in `/api/proxy-stream?url=...` when required by the country profile or Voidboost CDN rules.
3. For 4K Remux / MKV / multi-audio streams (`backup4k` or `stremio`), the frontend requests `GET /api/remux-probe` (`server.py:4469` → `RemuxStreamEngine.probe_media()` in `backend/remuxer.py`) to inspect video/audio/subtitle tracks via `ffprobe`, then points `<video src="/api/remux-stream?...">` (`server.py:4503`).
4. `CinemaRequestHandler` spawns an `ffmpeg` subprocess via `RemuxStreamEngine.build_ffmpeg_remux_cmd()` (`backend/remuxer.py`), piping fragmented MP4 (`-movflags +frag_keyframe+empty_moov+default_base_moof`) chunks directly to the HTTP response socket while tracking active processes in `_ACTIVE_REMUX_PROCS` (`server.py:1859`).

### Smartphone Wi-Fi Remote Control Flow

1. Desktop client polls `GET /api/remote/commands?since=<seq>&wait=1` (`server.py:5015`) while pushing playback telemetry to `POST /api/remote/state` (`server.py:7129`) via `public/js/remote.js`.
2. Paired smartphone (`http://<lan-ip>:8765/?remote=1&k=<pair_token>`) sends commands (`toggle_play`, `seek_rel`, `set_studio`, `dpad`, `play_item`) to `POST /api/remote/command` (`server.py:7152`) with constant-time token verification (`DesktopRemoteBroker.verify_key()` in `backend/remote_control.py`).
3. `DesktopRemoteBroker` (`backend/remote_control.py`) wakes waiting condition-variable listeners (`self._cond.notify_all()`), delivering the command in real time to the desktop browser.

**State Management:**
- **Backend State:** Persisted in SQLite WAL (`data/cineflow.db` via `backend/storage_db.py`) across 4 tables: `kv_store` (server settings, profiles manifest, Stremio addons), `profile_state` (per-profile Kinorium lists, ratings, episode progress), `cache_entries` (English metadata, similar titles, IMDb mappings), and `downloads` (offline download queue). Legacy JSON files in `data/*.json` are automatically migrated and mirrored.
- **Frontend State:** Centralized in the exported `state` singleton object (`public/js/state.js`), supplemented by profile-scoped `localStorage` keys generated via `profileStorageKey(baseKey)` (`public/js/state.js:295`).

## Key Abstractions

**`CineFlowStorageDB` & `LocalVaultCipher`:**
- Purpose: Thread-safe SQLite WAL persistence with nested savepoint support and transparent at-rest encryption for secrets (`session_cookie`, `auth_token`, `debrid_api_key`, `remote_pair_token`, `kids_pin`).
- Examples: `backend/storage_db.py`
- Pattern: Registry-backed Singleton per `storage_dir` (`get_storage_db(storage_dir)`) + Decorator/Interceptor encryption (`enc:v1:...` prefix).

**`DoHSplitNetworkClient`:**
- Purpose: Censorship-resistant HTTP/HTTPS client with DNS-over-HTTPS resolution, per-country bypass profiles (`backend/regions.py`), IP literal validation to block SSRF against loopback/RFC1918/link-local addresses, and mirror health tracking.
- Examples: `backend/doh.py`, `backend/regions.py`
- Pattern: Strategy / Adapter wrapping `http.client` and `urllib.request`.

**`RemuxStreamEngine`:**
- Purpose: Abstracts hardware-accelerated (`videotoolbox`, `nvenc`, `qsv`, `amf`) and software (`libx264`) FFmpeg pipelines for real-time HTTP streaming of MKV/HEVC/Dolby Vision/multi-audio containers to browser `<video>` elements.
- Examples: `backend/remuxer.py`, `backend/downloads.py`
- Pattern: Builder / Subprocess Pipeline.

**Profile-Scoped Frontend State (`state` + `profileStorageKey`):**
- Purpose: Holds all active UI, catalog, player, audio DSP, and remote control state in a single shared ES module object while isolating `localStorage` preferences per profile.
- Examples: `public/js/state.js`, `public/app.js`
- Pattern: Shared Observable/Singleton Store.

## Entry Points

**Local HTTP Server (`server.py`):**
- Location: `server.py` (`if __name__ == "__main__":` at line 7519, calling `run_server(port)`)
- Triggers: Direct CLI execution (`python3 server.py`), macOS LaunchAgent (`--launchd`), `macos/CineFlowApp.swift`, or `windows/desktop_webview2.py`.
- Responsibilities: Initializes all backend service singletons, stops stale server instances on port `8765`, binds `CinemaThreadingHTTPServer`, boots local `torrserver` and background sync daemons, and serves HTTP traffic.

**Browser Single-Page Application (`public/index.html` + `public/app.js`):**
- Location: `public/index.html` → `<script type="module" src="/app.js?v=...">` (`public/app.js`)
- Triggers: Opening `http://127.0.0.1:8765` in a browser or native desktop WebView, or `http://<lan-ip>:8765/?remote=1` on a smartphone.
- Responsibilities: Bootstraps i18n, loads server settings and active profile, initializes catalog/search/player/modals/remote listeners, and manages keyboard/D-pad navigation.

**Native macOS App Wrapper (`macos/CineFlowApp.swift`):**
- Location: `macos/CineFlowApp.swift` (`@main` / `CineFlowAppController`)
- Triggers: Launching `CineFlow.app` on macOS (or login item with `--background`).
- Responsibilities: Spawns or attaches to `server.py`, hosts the UI in a borderless/full-size `WKWebView`, bridges `window.webkit.messageHandlers.cineflowNative` for Now Playing (`MPNowPlayingInfoCenter`), native notifications, and 1-click Kinorium WebKit auth sheet.

**Native Windows App Wrapper (`windows/launcher/cineflow_launcher.c` + `windows/desktop_webview2.py`):**
- Location: `windows/launcher/cineflow_launcher.c` (`wWinMain`) → `windows/desktop_webview2.py` (`main()`)
- Triggers: Launching `CineFlow.exe` or `windows/Start-Cinema-Windows.bat` on Windows.
- Responsibilities: Resolves bundled `runtime/pythonw.exe`, starts `server.py` in a daemon thread, and opens a native Edge WebView2 window (`pywebview`) with browser fallback.

## Architectural Constraints

- **Threading:** Multi-threaded synchronous I/O on the backend. `CinemaThreadingHTTPServer` (`server.py:7237`) spawns a daemon thread per HTTP request (`request_queue_size = 128`). Background daemon threads run for TorrServer boot (`CineFlowTorrServerBoot`), Kinorium watching reconciliation (`CineFlowWatchingSync`), LAN IP changes (`CineFlowLanWatchdog`), and offline download workers (`OfflineDownloadManager`). All shared mutable structures are protected by `threading.Lock`, `threading.RLock`, or `threading.Condition`.
- **Global state:** `server.py` initializes module-level singletons at import time (`storage_db`, `net_client`, `rezka_client`, `profile_manager`, `kinorium_service`, `skip_intro_engine`, `backup_stream_engine`, `remux_engine`, `stremio_engine`, `subtitle_service`, `remote_broker`, `en_meta_resolver`, `aggregator`, `download_manager`, `dlna_manager`, `kinorium_auth_manager`, `APP_PREFS`, `SERVER_RUNTIME`). Importing `server` immediately initializes `data/cineflow.db`.
- **Circular imports:**
  - **Backend (`backend/`):** Strictly acyclic DAG (`storage_db`, `regions`, `qrcode_svg` → `doh` → `en_metadata`, `profiles`, `hdrezka` → `kinorium`, `backup_stream`, `stremio`, `subtitles` → `aggregator` → `server.py`). Only `kinorium_service._rezka_client = rezka_client` is injected post-init in `server.py:110`.
  - **Frontend (`public/js/`):** Multiple intentional ES module circular dependencies exist across function-exporting modules (`catalog.js` ↔ `utils.js`, `catalog.js` ↔ `player.js`, `catalog.js` ↔ `modals.js`, `catalog.js` ↔ `settings.js`, `catalog.js` ↔ `features.js`, `player.js` ↔ `audio-dsp.js`, `player.js` ↔ `subtitles.js`, `player.js` ↔ `remote.js`). These work at runtime because imports are only referenced inside function bodies after module evaluation completes, and all import specifiers share the exact same `?v=YYYYMMDDvNNN` query string.
- **Static Cache-Busting Synchronization:** Every ES module `import ... from "./...js?v=..."` across `public/app.js` and `public/js/*.js` as well as `<link>` / `<script>` tags in `public/index.html` must use the exact same `?v=` version token; mismatched query strings cause the browser to instantiate duplicate module instances and split `state`.

## Anti-Patterns

### Evaluating Imported Functions at ES Module Top Level

**What happens:** Calling an imported function from `catalog.js`, `player.js`, `modals.js`, or `settings.js` at the top level of another `public/js/*.js` file during module evaluation.
**Why it's wrong:** Because `public/js/*.js` modules form a circular dependency graph, top-level execution during module evaluation can hit uninitialized bindings or incomplete state before `public/app.js` finishes bootstrapping.
**Do this instead:** Keep top-level code in `public/js/*.js` restricted to constants and pure declarations (`public/js/state.js`), and invoke cross-module functions only inside exported functions or event handlers triggered after initialization (`public/app.js`).

### Bypassing `DoHSplitNetworkClient` or `_open_safe_public_url` for External URLs

**What happens:** Using raw `urllib.request.urlopen()` directly on user-supplied or addon-supplied URLs (e.g., proxy streams, subtitle URLs, Stremio manifests, update manifests).
**Why it's wrong:** Raw `urllib.request.urlopen()` follows redirects blindly to loopback (`127.0.0.1`), RFC1918 LAN hosts, or cloud metadata IPs (`169.254.169.254`), opening SSRF vulnerabilities and failing under ISP DNS blocks.
**Do this instead:** Always route outbound requests through `DoHSplitNetworkClient` (`backend/doh.py`), `_open_safe_public_url()` (`server.py:839`), or `validate_safe_external_url()` (`backend/doh.py`), which validate resolved IPs at socket connection time.

### Editing Version Strings or Static Assets Without Updating Synced Files

**What happens:** Changing a `?v=` query parameter in only one file under `public/`, or bumping `APP_VERSION` in `server.py` without updating the other versioned files.
**Why it's wrong:** Mismatched `?v=` query strings duplicate ES module evaluations in the browser, and mismatched version numbers fail `tests/test_frontend_integrity.py` and `tests/test_audit_fixes.py`.
**Do this instead:** Keep all `?v=` query parameters identical across `public/index.html`, `public/app.js`, and `public/js/*.js`, and follow the version synchronization list enforced by `tests/test_frontend_integrity.py`.

## Error Handling

**Strategy:** Defensive boundary recovery with structured JSON error payloads (`{"ok": false, "error": "..."}` or `{"error": "..."}`) and automatic fallback chains.

**Patterns:**
- **Graceful Upstream Degradation:** When a primary mirror or stream fails (e.g., HDRezka mirror timeout or dead Voidboost CDN edge), `DoHSplitNetworkClient` (`backend/doh.py`) and `_open_resilient_media_upstream` (`server.py:1129`) automatically evict the dead edge (`_evict_voidboost_edge_and_mark_dead`), rotate mirrors, or fall back to `BackupStreamingEngine` / `StremioAddonEngine`.
- **Safe Type Coercion at Boundaries:** Query parameters and JSON fields are coerced through `_safe_int`, `_safe_float`, `_qs_int`, and `_qs_float` (`server.py:329-358`) to prevent uncaught `ValueError`/`TypeError` on malformed requests.
- **Socket Disconnect Suppression:** Streaming and JSON responses wrap socket writes in `try ... except (BrokenPipeError, ConnectionResetError): pass` (`server.py:2043`, `2206`, `2294`) so client seeks and tab closures never crash worker threads.

## Cross-Cutting Concerns

**Logging:** Custom UTF-8 safe stream writer `_safe_log()` (`server.py:92`) with `_ensure_safe_std_streams()` (`server.py:58`) that redirects `stdout`/`stderr` to `data/cineflow.log` when running windowless under `pythonw.exe` or `launchd`, stripping query strings from HTTP request logs (`server.py:1880`) to avoid leaking pairing keys or PINs.
**Validation:** Strict input bounds (`MAX_JSON_BODY_BYTES = 512 KB`, `MAX_IMPORT_BODY_BYTES = 10 MB` in `server.py:1867`), regex validation on `Range` headers (`server.py:2107`), path traversal resolution checks (`_resolve_safe_public_static_path` in `server.py:2047`), and FFmpeg URL protocol whitelisting (`_FFMPEG_NET_WHITELIST = "http,https,tcp,tls,crypto,data,httpproxy"` in `backend/remuxer.py:14`).
**Authentication & Access Control:**
- **DNS-Rebinding & CSRF Protection:** `_is_allowed_host_header()` (`server.py:1926`) and `_is_trusted_origin()` (`server.py:1959`) reject cross-origin or rebind requests from external domains or other local ports.
- **Loopback vs. LAN Privilege Separation:** `_is_loopback_client()` restricts administrative endpoints (settings mutation, backup import/export, system update, Stremio addon secrets) to `127.0.0.1` / `::1`, while LAN clients require a valid pairing token (`X-CineFlow-Key` / `?k=`) verified via `hmac.compare_digest` in `DesktopRemoteBroker` (`backend/remote_control.py`).
- **Kids Mode & Parental PIN Guard:** `ProfileManager` (`backend/profiles.py`) enforces PBKDF2/HMAC PIN verification (`X-CineFlow-Pin`) with exponential lockout on failed attempts and filters all catalog, search, playback, download, and remote-control endpoints when a Kids profile is active.

---

*Architecture analysis: 2026-11-03*
