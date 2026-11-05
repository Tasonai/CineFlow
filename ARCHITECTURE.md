# CineFlow Architecture (`ARCHITECTURE.md`)

## 1. System Overview & Targets

CineFlow is a cross-platform desktop cinema center for **macOS** (`WKWebView` + Swift native wrapper in `macos/`) and **Windows** (`WebView2` / C launcher + NSIS installer in `windows/`), powered by a zero-dependency local Python `ThreadingHTTPServer` backend (`server.py` + `backend/`) and a modular ES6 frontend (`public/`).

---

## 2. Layers & Dependency Direction

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Native Shells: macos/CineFlowApp.swift  |  windows/launcher/              │
│ (Window management, traffic lights, fullscreen, tray, local server spawn) │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │ HTTP / SSE (127.0.0.1:8765)
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ Frontend Coordinator: public/app.js (864 lines)                           │
│   ├── Feature Subsystems (public/js/):                                    │
│   │   ├── Catalog: catalog.js, catalog-shelves.js, catalog-cards.js,      │
│   │   │            catalog-filters.js, catalog-hero.js, catalog-grid.js   │
│   │   ├── Player:  player.js, player-streams.js, player-ui-controls.js,   │
│   │   │            player-rating.js, player-hls.js, player-subtitles.js,  │
│   │   │            player-audio.js, player-chapters.js                    │
│   │   ├── Modals:   modals.js (1,514 lines), modals-person.js (650 lines),  │
│   │   │            modals-stats.js (467 lines)                              │
│   │   ├── Settings: settings.js (1,825 lines), settings-onboarding.js (723),│
│   │   │            settings-updater.js (626 lines)                          │
│   │   ├── Hotkeys:  app-hotkeys.js (465 lines)                              │
│   │   └── Shared Foundation: state.js, api.js, utils.js                     │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │ JSON REST API + HLS/MP4 Proxy
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ HTTP Router & Server: server.py + backend/routes/                         │
│   ├── backend/routes/catalog.py   (Catalog, search, recommendations)      │
│   ├── backend/routes/kinorium.py  (Kinorium sync, statuses, episodes)     │
│   ├── backend/routes/streams.py   (HDRezka, Stremio, HLS/MP4 proxy, Torr) │
│   ├── backend/routes/profiles.py  (Multi-profile, backups, settings)      │
│   └── backend/routes/system.py    (Health, diagnostics, auto-updater)     │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │ Service Layer Calls
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ Domain Services (backend/):                                               │
│   ├── Kinorium Engine:                                                    │
│   │   ├── kinorium.py (2,436 lines) — Core state, indices & catalog lists │
│   │   ├── kinorium_http.py (762 lines) — Transport, failover, PoW solver  │
│   │   ├── kinorium_parsers.py (1,120 lines) — HTML list/episode parsers   │
│   │   ├── kinorium_persons.py (665 lines) — Actor/director profiles       │
│   │   ├── kinorium_sync.py (1,141 lines) — Bidirectional remote sync      │
│   │   ├── kinorium_mutations.py (1,907 lines) — Status/rating/ep actions  │
│   │   └── kinorium_profile.py (1,511 lines) — Profile sync, premieres,    │
│   │                                           friends, backups & services │
│   ├── Media Providers:                                                    │
│   │   ├── hdrezka.py — HDRezka mirror resolver, parser & stream extractor │
│   │   ├── aggregator.py — Multi-source metadata & catalog aggregator      │
│   │   └── torrserve.py — TorrServe 4K / BitTorrent integration            │
│   └── Storage & Infra:                                                    │
│       └── database.py — SQLite WAL persistence & JSON state migration     │
└───────────────────────────────────────────────────────────────────────────┘
```

### Dependency Rules
1. **Frontend (`public/js/`)**:
   - `state.js` and `utils.js` are the bottom layer; they must not import feature modules (`player-*.js`, `catalog-*.js`, `modals.js`, `settings.js`).
   - Feature barrels (`player.js`, `catalog.js`) aggregate and re-export their domain submodules (`player-*.js`, `catalog-*.js`).
   - `public/app.js` acts strictly as the top-level coordinator: it wires domain initializers (`initGlobalHotkeys`, `initQuickPeekBindings`, `initPlayerStatusAndRatingBindings`, `initPlayerStageAndGearBindings`, `initCatalogToolbarAndFilterBindings`, `initSettingsAndBackupBindings`) and runs startup orchestration (`initCineFlowApp`).
2. **Backend (`backend/`)**:
   - Route handlers in `backend/routes/*.py` depend on `ServerContext` (`ctx`) and delegate business logic to domain services (`ctx.kinorium`, `ctx.hdrezka`, `ctx.aggregator`, `ctx.torrserve`).
   - `KinoriumService` (`backend/kinorium.py`) owns thread locks (`_state_lock`, `_episodes_lock`, `_cache_lock`) and delegates specialized operations to pure/functional submodules (`kinorium_http.py`, `kinorium_parsers.py`, `kinorium_persons.py`, `kinorium_sync.py`, `kinorium_mutations.py`), preserving a single cohesive service interface for routes and tests.

---

## 3. Key Seams for Testing & Extension

- **Kinorium Transport Seam (`backend/kinorium_http.py`)**: All HTTP requests and challenge solving go through `kinorium_http_request(svc, ...)` and `fetch_kinorium_html(svc, ...)`, allowing unit tests to mock network responses without touching parser or mutation logic.
- **Kinorium Sync & Mutation Seams (`backend/kinorium_sync.py`, `backend/kinorium_mutations.py`)**: Optimistic local state updates and background remote synchronization (`_run_remote_sync_bg`) are separated from HTML parsing and HTTP transport, tested in `tests/test_auto_status_rules.py`, `tests/test_audit_fixes.py`, and `tests/test_v31_upgrades.py`.
- **Frontend Diagnostics Seam (`logDebug` in `public/js/utils.js`)**: Non-critical browser `try/catch` blocks route through `logDebug(scope, err)`, staying silent in production while inspectable via `localStorage.getItem('cineflow_debug') === '1'` or `window.__CINEFLOW_DEBUG__ = true`.
