# Architecture Review — 2026-11-05

Архитектурная ревизия (`improve-architecture`) кодовой базы CineFlow после завершения Milestone `M1`.

---

## 0. Результаты обследования (Survey & Hot Spots)

- **Топ файлов по частоте изменений за 30 дней (`git log --since=30.days`):**
  1. `public/app.js` (14 коммитов, 2 014 строк)
  2. `public/js/player.js` (13 коммитов, 2 289 строк)
  3. `public/js/modals.js` (13 коммитов, 2 585 строк)
  4. `public/js/utils.js` (13 коммитов, 2 102 строки)
  5. `public/js/settings.js` (12 коммитов, 3 471 строка)
  6. `public/js/player-rating.js` (12 коммитов, 824 строки)
- **Крупнейшие модули кодовой базы (`wc -l`):**
  1. `backend/kinorium.py` — **5 734 строки** (после выделения `kinorium_persons.py`, `kinorium_parsers.py`, `kinorium_http.py`, `kinorium_sync.py`)
  2. `public/js/player-streams.js` — **3 489 строк**
  3. `public/js/settings.js` — **3 471 строка**
  4. `backend/aggregator.py` — **3 308 строк**
  5. `backend/hdrezka.py` — **2 846 строк**
  6. `public/js/modals.js` — **2 585 строк**
  7. `public/js/player.js` — **2 289 строк**
  8. `public/app.js` — **2 014 строк**

---

## Candidate 1: Player Stage, Gear & Selector Bindings Module  [Completed ✓]

- **Files:** [`public/app.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/app.js) (2 014 → 1 209 lines), [`public/js/player-ui-controls.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/player-ui-controls.js) (1 974 lines), [`public/js/player.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/player.js)
- **Commit:** `5558cd8` (`refactor(player): extract initPlayerStageAndGearBindings to player-ui-controls.js`)
- **Signal:** Highest commit churn (`public/app.js` — 14 commits in 30 days) + feature controls living far from their feature folder (`lines 903–1428` and `1556–1955` in `public/app.js`).
- **Problem:** Nearly half of `public/app.js` (~810 lines) bound DOM events for the video player (gear popover, audio/subtitle sync offset buttons, playback speed, quality/studio/season/episode selectors, sleep timer, screenshot, mini-player drag/resize, Ru/En trailer toggle, and Stremio filter pills). Modifying any player control required editing both `public/js/player-*.js` and `public/app.js`, hurting **Locality**.
- **Outcome:**
  - `initPlayerStageAndGearBindings()` extracted to `public/js/player-ui-controls.js` and re-exported by `public/js/player.js`.
  - `public/app.js` dropped from **2 014 lines to 1 209 lines**.

---

## Candidate 2: Kinorium Status, Episode & Rating Mutations Engine  [Completed ✓]

- **Files:** [`backend/kinorium.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium.py) (5 734 → 3 896 lines), [`backend/kinorium_mutations.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium_mutations.py) (1 907 lines)
- **Commit:** `d6f93da` (`refactor(kinorium): extract status, rating & episode mutations into backend/kinorium_mutations.py`)
- **Signal:** File size over threshold (`backend/kinorium.py` was 5 734 lines, the largest file in the project).
- **Problem:** Lines `3845–5687` of `backend/kinorium.py` (~1 840 lines) implemented user mutations (`dismiss_continue_watching`, `restore_continue_watching`, `_ensure_remote_entry_template`, `_record_episode_watched`, `_unrecord_episode_watched`, `mark_episodes_batch`, `toggle_episode_watched`, `mark_watched`, `set_rating`, `set_episode_rating`, `toggle_watchlist`, `toggle_watching`, `toggle_not_watching`, `_promote_to_watching_with_status`, `configure_account`, `get_profile_stats`) mixed with profile syncing and read-only catalog queries.
- **Outcome:**
  - All optimistic local state mutations + remote Kinorium writebacks extracted into `backend/kinorium_mutations.py` with 100% backward-compatible delegation on `KinoriumService`.
  - `backend/kinorium.py` shrunk from **5 734 lines to 3 896 lines** (a total reduction of **54.8%** from the original 8 623 lines).

---

## Candidate 3: Catalog Toolbar, Filter Reset & Notifications Bindings  [Completed ✓]

- **Files:** [`public/app.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/app.js) (1 209 → 864 lines), [`public/js/catalog-filters.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog-filters.js) (768 lines), [`public/js/catalog.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog.js)
- **Signal:** Drifted duplicate filter-reset block in `public/app.js` (`brand-home` click and `btn-clear-catalog-filters` click) + ~350 lines of catalog toolbar/filter/pill/notification bindings sitting in `public/app.js`.
- **Outcome:**
  - `resetCatalogDrawerFiltersUI()` and `initCatalogToolbarAndFilterBindings()` extracted to `public/js/catalog-filters.js` (and re-exported by `public/js/catalog.js`), eliminating duplicate filter-reset logic.
  - `public/app.js` shrunk from **1 209 lines to 864 lines** (a total reduction of **80.0%** from the original 4 316 lines!).

---

## Considered, Not Recommended Right Now

- **Splitting `public/js/player-streams.js` (3 489 lines) by provider (`Speculative`)**: Passes the **Deletion test** as a cohesive stream-switching engine (`switchSourceTab`, `loadHDRezkaStream`, `loadStremioStreams`, `loadBackup4KReleases` share tightly coupled fallback and recovery state). Splitting it now would create shallow pass-through wrappers.

---

## Top Recommendation

Execute **Candidate 1** (`Player Stage, Gear & Selector Bindings -> public/js/player-ui-controls.js`) and **Candidate 2** (`Kinorium Mutations Engine -> backend/kinorium_mutations.py`), optionally followed by **Candidate 3** (`Catalog Toolbar & Filter Reset -> public/js/catalog-filters.js`).
