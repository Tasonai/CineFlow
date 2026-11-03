---
last_mapped_commit: 0ca6949e3be2a26342beea7cbfcd591a789fea04
last_mapped_at: 2026-11-03
---
# External Integrations

**Analysis Date:** 2026-11-03

## APIs & External Services

**DNS-over-HTTPS (DoH) & Anti-Censorship Routing:**
- Cloudflare DoH (`https://1.1.1.1/dns-query`), Google DoH (`https://8.8.8.8/resolve`), Quad9 DoH (`https://9.9.9.9:5053/dns-query`) - Resolves domain names to verified public IPv4/IPv6 addresses to bypass ISP DNS blocking while pinning TCP sockets to verified public IPs (anti-SSRF / anti-DNS-rebinding).
  - SDK/Client: Custom `DoHSplitNetworkClient` and `_DoHHTTPSConnection` in `backend/doh.py`.
  - Auth: None (public DoH endpoints; optional user-configured `cf_worker_relay` Cloudflare Worker URL or HTTP/HTTPS `proxy_url` in `data/server_settings.json`).

**Primary Streaming & Video Extraction:**
- HDRezka (`https://hdrezka-home.tv`, `https://hdrezka.ag`, `https://rezka.ag`, `https://hdrezka.me`, plus custom mirrors) - Fetches movie/series metadata, studio voiceover lists, seasons/episodes maps, `.m3u8` / `.mp4` CDN video streams (`ajax/get_cdn_series`), subtitles, and person filmographies. Includes an Anubis Proof-of-Work (SHA-256 PoW) challenge solver and Split-Proxy regional header spoofing (`X-Forwarded-For` / `CF-Connecting-IP` for `KZ`, `AM`, `MD`).
  - SDK/Client: `HDRezkaClient` in `backend/hdrezka.py`.
  - Auth: Optional session cookies or mirror configuration in `data/server_settings.json`.

**Movie Tracking & Social Sync:**
- Kinorium (`https://ru.kinorium.com`, `https://en.kinorium.com`, `https://ua.kinorium.com`, images via `https://images.kinorium.com` and `https://en-images.kinorium.com`) - Two-way synchronization of user watchlists ("Watchlist", "Watching", "Watched"), episode watch progress, 85% playback scrobbling, personal ratings (1–10), friends' ratings/reviews, release calendar, and cast/crew X-Ray metadata. Includes rate limiting and a 10-minute circuit breaker on HTTP `403`.
  - SDK/Client: `KinoriumService` in `backend/kinorium.py` and `KinoriumOneClickAuthManager` in `backend/kinorium_auth.py`.
  - Auth: `user_id` and encrypted `session_cookie` / `auth_token` stored per profile in `data/cineflow.db` (`profile_state` table, `account` section).

**Regional Streaming Availability & Metadata Catalogs:**
- JustWatch GraphQL API (`https://apis.justwatch.com/graphql`, images via `https://images.justwatch.com`) - Queries regional streaming offers across European countries (default Poland `PL`) for Netflix, Apple TV+, Amazon Prime Video, Disney+, Max (HBO), and Player.pl, as well as English/localized synopses, posters, and backdrops.
  - SDK/Client: `UnifiedCinemaAggregator` in `backend/aggregator.py` and `EnglishMetadataResolver` in `backend/en_metadata.py`.
  - Auth: None (public GraphQL API).
- Stremio Cinemeta & Metahub (`https://v3-cinemeta.strem.io`, `https://images.metahub.space`) - Resolves canonical IMDb IDs (`tt...`), English titles, episode air dates, posters, and backdrops.
  - SDK/Client: `StremioAddonEngine` in `backend/stremio.py`, `EnglishMetadataResolver` in `backend/en_metadata.py`, and `SkipIntroEngine` in `backend/skip_intro.py`.
  - Auth: None.
- Wikipedia MediaWiki & REST v1 API (`https://ru.wikipedia.org/api/rest_v1/page/summary/`, `https://en.wikipedia.org/api/rest_v1/page/summary/`, `https://ru.wikipedia.org/w/api.php`, `https://en.wikipedia.org/w/api.php`) - Resolves actor/director biographies, localized names via interlanguage links, and high-resolution portrait photos.
  - SDK/Client: `HDRezkaClient` in `backend/hdrezka.py`.
  - Auth: None.
- YouTube (`https://www.youtube.com/results`, `https://www.youtube.com/embed/`) - Searches and embeds official Russian and English trailers for catalog titles and the Split-Stage Hero banner.
  - SDK/Client: `HDRezkaClient` in `backend/hdrezka.py` and frontend player in `public/js/player.js` / `public/js/catalog.js`.
  - Auth: None.

**4K HDR Backup Streaming, Torrents & Debrid Services:**
- JacRed Torrent Indexer (`https://jacred.xyz`, `https://jac.red`) - Searches 4K UHD, HDR10, Dolby Vision, and BDRemux releases by IMDb ID or title/year.
  - SDK/Client: `BackupStreamingEngine` in `backend/backup_stream.py`.
  - Auth: None.
- Real-Debrid REST API (`https://api.real-debrid.com/rest/1.0/torrents/*`, `https://api.real-debrid.com/rest/1.0/unrestrict/link`) - Converts magnet links into direct high-speed HTTPS streams with zero P2P swarm exposure.
  - SDK/Client: `BackupStreamingEngine` in `backend/backup_stream.py`.
  - Auth: Bearer token (`backup_stream.debrid_api_key`) encrypted at rest in `data/cineflow.db`.
- TorBox API (`https://api.torbox.app/v1/api/torrents/*`) - Alternative Debrid provider for cached magnet-to-HTTPS streaming.
  - SDK/Client: `BackupStreamingEngine` in `backend/backup_stream.py`.
  - Auth: Bearer token (`backup_stream.debrid_api_key`) encrypted at rest in `data/cineflow.db`.
- Stremio Addon Ecosystem (`https://torrentio.strem.fun/language=russian/manifest.json`, `https://thepiratebay-plus.strem.fun/manifest.json`, plus user-installed `manifest.json` addons) - Queries external Stremio stream providers.
  - SDK/Client: `StremioAddonEngine` in `backend/stremio.py`.
  - Auth: Optional addon-specific path tokens configured in `data/stremio_addons.json` / `data/cineflow.db`.

**Subtitles, Dictionary & Intro Timestamps:**
- TheIntroDB v3 API (`https://api.theintrodb.org/v3/media`) - Provides millisecond-accurate opening intro and end-credits timestamps per episode (`imdb_id`, `season`, `episode`).
  - SDK/Client: `SkipIntroEngine` in `backend/skip_intro.py`.
  - Auth: None.
- OpenSubtitles v3 Stremio Addon (`https://opensubtitles-v3.strem.io`) - Fetches external multi-language subtitle tracks by IMDb ID and episode.
  - SDK/Client: `SubtitleSearchService` in `backend/subtitles.py`.
  - Auth: None.
- Google Translate API (`https://translate.googleapis.com/translate_a/single`) - Powers instant word/phrase click translation and contextual dictionary lookup inside interactive video subtitles.
  - SDK/Client: `SubtitleSearchService.translate_word_or_phrase` in `backend/subtitles.py` (exposed via `/api/subtitles/translate`).
  - Auth: None (`client=gtx` public endpoint).

**Local Network & Hardware Integrations:**
- UPnP / DLNA Smart TV Casting (`239.255.255.250:1900` SSDP multicast + SOAP `AVTransport:1` control URLs) - Discovers Smart TVs and media renderers on the local LAN and pushes live HTTP media streams (`SetAVTransportURI`, `Play`, `Pause`, `Stop`, `Seek`).
  - SDK/Client: `DlnaCastManager` in `backend/tv_cast.py`.
  - Auth: Restricted to verified RFC1918 / link-local LAN IPv4 hosts.
- Smartphone Wi-Fi Remote Control - Bidirectional long-polling / state broker between desktop CineFlow and mobile browsers paired via SVG QR code (`backend/qrcode_svg.py`).
  - SDK/Client: `DesktopRemoteBroker` in `backend/remote_control.py` and `public/js/remote.js`.
  - Auth: 16-hex-character `remote_pair_token` verified with constant-time `hmac.compare_digest` and brute-force lockout protection.

**Over-The-Air (OTA) App Updates & Release Publishing:**
- GitHub Releases API & CDN (`https://api.github.com/repos/tasonai/CineFlow/releases/latest`, `https://github.com/tasonai/CineFlow/releases/latest/download/latest.json`, `https://uploads.github.com`) - Checks for new app versions, downloads `.dmg` / `Setup.exe` installers, and verifies SHA-256 checksums.
  - SDK/Client: `AppUpdater` in `backend/updater.py` and release publisher in `scripts/publish_github_release.py`.
  - Auth: Public unauthenticated reads for client OTA updates; Bearer token (`GITHUB_TOKEN` / `GITHUB_PERSONAL_ACCESS_TOKEN`) for `scripts/publish_github_release.py`.

## Data Storage

**Databases:**
- SQLite 3 (WAL mode)
  - Connection: Local file `data/cineflow.db` (or `~/Library/Application Support/CineFlow/data/cineflow.db` when running standalone `CineFlow.app`; overridable via `CINEFLOW_DATA_DIR`).
  - Client: Custom thread-safe `CineFlowStorageDB` wrapper using Python's built-in `sqlite3` module in `backend/storage_db.py`.
  - Schema tables:
    - `kv_store` (`namespace`, `key`, `value_json`, `updated_at`) - Server settings, profiles manifest, Stremio addons, download index.
    - `profile_state` (`profile_id`, `section_key`, `value_json`, `updated_at`) - Isolated per-profile Kinorium state, watch history, ratings, and sync queues.
    - `cache_entries` (`cache_name`, `entry_key`, `value_json`, `updated_at`) - Persistent metadata caches (`en_meta_cache`, `kinorium_similar_cache`, `online_premieres_cache`, `stremio_imdb_cache`).
    - `downloads` (`download_id`, `status`, `created_at`, `payload_json`) - Offline download queue state.

**File Storage:**
- Local filesystem only (`data/`):
  - `data/downloads/` - Offline downloaded `.mp4` video files and `.vtt` subtitle files managed by `OfflineDownloadManager` in `backend/downloads.py`.
  - `data/torrserver/` - Local TorrServer MatriX configuration (`settings.json`, `config.db`).
  - `data/profiles/<profile_id>/` - Legacy/mirrored per-profile state directory managed by `backend/profiles.py`.
  - JSON mirror/fallback files (`data/server_settings.json`, `data/profiles.json`, `data/kinorium_state.json`, `data/stremio_addons.json`) automatically synchronized with `data/cineflow.db`.

**Caching:**
- Two-tier caching:
  - In-memory thread-safe dictionaries with TTL eviction across `backend/doh.py`, `backend/hdrezka.py`, `backend/skip_intro.py`, `backend/remuxer.py`, and `backend/aggregator.py`.
  - Persistent SQLite `cache_entries` table in `data/cineflow.db` (pruned to 4,000 entries per namespace in `backend/storage_db.py`).
  - Browser `localStorage` for client-side UI preferences, player settings, and recent searches (`public/js/state.js`).

## Authentication & Identity

**Auth Provider:**
- Custom Local Multi-Profile + Kinorium Session Auth
  - Implementation:
    - Household profiles (`main`, `family`, `kids` with optional 4-digit PIN lock, plus custom profiles) managed by `ProfileManager` in `backend/profiles.py`.
    - Kinorium 1-Click OAuth/Session capture via native WebKit helper on macOS (`macos/kinorium_login_helper.swift` / `macos/CineFlowApp.swift`) and WebView2 / browser cookie extraction on Windows (`windows/kinorium_login_webview.py`), orchestrated by `KinoriumOneClickAuthManager` in `backend/kinorium_auth.py`.

## Monitoring & Observability

**Error Tracking:**
- None (strict zero-telemetry local privacy architecture; no Sentry, Datadog, or external analytics).

**Logs:**
- Local file and standard stream logging:
  - `data/cineflow.log` (Windows / daemon fallback via `_ensure_safe_std_streams()` in `server.py` and `windows/launcher/cineflow_launcher.c`).
  - `data/cineflow-macos.log` (macOS background server log managed by `macos/CineFlowApp.swift`).

## CI/CD & Deployment

**Hosting:**
- Local desktop execution (`127.0.0.1:8765`, with optional user-toggled LAN listener on `0.0.0.0:8765`).
- Binary installers and OTA update manifests (`CineFlow.dmg`, `CineFlow-Setup-X.Y.Z-x64.exe`, `SHA256SUMS.txt`, `latest.json`) are hosted on GitHub Releases (`https://github.com/Tasonai/CineFlow/releases`).

**CI Pipeline:**
- GitHub Actions (`.github/workflows/build-windows.yml`) - Runs on `windows-latest` with Python 3.11 and Zig 0.13.0 to build and upload the Windows x64 Setup installer artifact.

## Environment Configuration

**Required env vars:**
- None required for standard runtime (all settings have sensible defaults and are configurable via the in-app Settings UI).
- Optional runtime overrides: `PORT`, `CINEFLOW_DATA_DIR`, `CINEFLOW_ROOT`, `CINEFLOW_UPDATE_REPO`, `CINEFLOW_UPDATE_MANIFEST_URL`, `CINEFLOW_VERBOSE_LOG`.

**Secrets location:**
- All user secrets (`session_cookie`, `auth_token`, `debrid_api_key`, `remote_pair_token`, `kids_pin`) are encrypted at rest with `enc:v1:` tokens inside `data/cineflow.db` using `LocalVaultCipher` (`HMAC-SHA256` stream cipher + `HMAC-SHA256` authentication tag) in `backend/storage_db.py`.
- Per-installation 256-bit master key is generated via `secrets.token_bytes(32)` and stored locally in `data/.vault_key` with `0600` owner-only permissions.

## Webhooks & Callbacks

**Incoming:**
- None from external cloud services. Local loopback/LAN endpoints in `server.py` receive state updates from the paired smartphone remote (`/api/remote/command`, `/api/remote/state`) and native desktop shell bridges (`window.webkit.messageHandlers.cineflowNative` in `macos/CineFlowApp.swift`).

**Outgoing:**
- Outgoing UPnP/DLNA SOAP XML actions (`SetAVTransportURI`, `Play`, `Pause`, `Stop`, `Seek`, `GetPositionInfo`) sent directly to LAN Smart TV control URLs in `backend/tv_cast.py`.
- Outgoing scrobble, status, and rating sync requests sent to `https://ru.kinorium.com` in `backend/kinorium.py`.

---

*Integration audit: 2026-11-03*
