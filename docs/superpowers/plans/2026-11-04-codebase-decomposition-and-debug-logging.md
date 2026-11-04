# Codebase Decomposition and Safe Debug Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose monolithic code in `backend/kinorium.py` (extracting HTML parsing into `backend/kinorium_parsers.py`) and `public/app.js` (extracting live search & recent searches into `public/js/catalog-live-search.js`), and replace silent `catch (_) {}` blocks across the frontend with a safe, developer-friendly `logDebug(...)` subsystem.

**Architecture:** 
1. `backend/kinorium_parsers.py`: Extracted pure functions and parsers for Kinorium HTML structures, ratings, premieres, and episode tables with re-exporting in `backend/kinorium.py` and method delegation on `KinoriumService`.
2. `public/js/catalog-live-search.js`: Extracted self-contained ES module managing search input debouncing, recent searches in localStorage, live search popover rendering, active item navigation, and clear button synchronization.
3. `public/js/utils.js`: New exported `logDebug(scope, ...args)` checking `window.__CINEFLOW_DEBUG__` and `localStorage.cineflow_debug === "1"`, exposed as `window.logDebug` and instrumenting frontend catch blocks.

**Tech Stack:** Python 3 standard library, Vanilla ES Modules, Pure CSS, Python unittest.

## Global Constraints

- Never run installer packaging scripts (`macos/build_macos_app.py`, `windows/build_windows_installer.py`) without explicit direct user command.
- Zero dotted Russian abbreviations (`сек.`, `мин.`, `эп.`, `стр.`, `г.`) in UI strings or titles.
- Zero unicode emojis in UI strings; use Apple TV matte SVG icons.
- CSS `outline:` strictly `none` or `0` across all stylesheets.
- No `backdrop-filter: blur(...)` (use matte colors).
- All `:hover` selectors inside `@media (hover: hover) and (pointer: fine)`.
- 100% test pass rate across full test suite (`python3 -B run_tests.py`).
- Static asset cache token bumped upon completion via `scripts/bump_cache_token.py`.
- Sync to `/Applications/CineFlow.app/Contents/Resources/app/`.

## Review Focus

1. Backward compatibility: every existing import from `backend.kinorium` (such as `_safe_year_int`, `_sanitize_kinorium_genres`, `KinoriumService.parse_movie_list_html`) must continue to work without breaking external consumers or tests.
2. Search functionality: Live search popover, keyboard navigation (ArrowUp/Down/Enter/Escape), recent searches, and filter resets must function identically after extraction to `catalog-live-search.js`.
3. Safe logging: `logDebug` must NEVER throw an exception or flood the production console; it must only output when debug mode is enabled.
4. Memory & references: No circular references or retained DOM leaks in live search event listeners.
5. Cache token integrity: All script imports must preserve valid cache-busting query strings.

---

### Task 1: Decompose Kinorium HTML Parsers into `backend/kinorium_parsers.py`

**Files:**
- Create: `backend/kinorium_parsers.py`
- Modify: `backend/kinorium.py`
- Test: `tests/test_audit_fixes.py` & `tests/test_modular_routes.py`

**Steps:**
- [x] 1. Create `backend/kinorium_parsers.py` containing:
  - Year, text, title variants and air date helpers: `_safe_year_int`, `_is_placeholder_display_name`, `_parse_episode_air_date_iso`, `_sanitize_kinorium_genres`, `_norm_title`, `_title_variants_tuple`, `_title_variants`.
  - HTML extraction functions: `extract_friends_tooltip_ratings`, `extract_critics_pct`, `extract_similar_items_html`, `_extract_balanced_block_html`, `extract_movie_description_html`, `parse_movie_list_html`, `parse_premieres_list_html`, `_extract_profile_avatar_url`, `_extract_cookie_display_name`, `_extract_profile_display_name`, `_parse_following_html`, `parse_series_episodes_html`.
- [x] 2. In `backend/kinorium.py`:
  - Import all extracted functions from `backend.kinorium_parsers`.
  - Re-export all of them in `backend/kinorium.py` (and in `__all__` if applicable) so callers of `from backend.kinorium import ...` work transparently.
  - In `KinoriumService`, delegate the corresponding methods (`parse_movie_list_html`, `extract_friends_tooltip_ratings`, etc.) to the functions in `kinorium_parsers.py` (or keep staticmethod/classmethod aliases).
- [x] 3. Run `python3 -m unittest tests/test_audit_fixes.py tests/test_modular_routes.py` and verify all tests pass.

---

### Task 2: Decompose `public/app.js` into `public/js/catalog-live-search.js`

**Files:**
- Create: `public/js/catalog-live-search.js`
- Modify: `public/app.js`
- Test: `tests/test_frontend_integrity.py`

**Steps:**
- [x] 1. Create `public/js/catalog-live-search.js`:
  - State and storage: `RECENT_SEARCHES_STORAGE_KEY`, `MAX_RECENT_SEARCHES = 6`, `liveSearchHitsState = []`, `liveSearchActiveIdx = -1`, `liveSearchInFlight = null`.
  - Functions: `syncSearchClearButton`, `abortLiveSearchInFlight`, `closeLiveSearchPopover`, `syncLiveSearchActiveHighlight`, `getRecentSearches`, `saveRecentSearchQuery`, `removeRecentSearchQuery`, `clearRecentSearches`, `runSubmittedRecentSearch`, `renderEmptySearchSuggestions`, `renderLiveSearchHits`, `resetCatalogFiltersForGlobalSearch`, `initCatalogLiveSearch`.
  - Export: `initCatalogLiveSearch`, `closeLiveSearchPopover`, `resetCatalogFiltersForGlobalSearch`.
- [x] 2. In `public/app.js`:
  - Import `{ initCatalogLiveSearch, closeLiveSearchPopover, resetCatalogFiltersForGlobalSearch } from "./js/catalog-live-search.js?v=20261104v27"`.
  - Remove duplicate internal definitions of live search functions from `public/app.js`.
  - Invoke `initCatalogLiveSearch()` inside `initCineFlowApp()`.
- [x] 3. Run `node --check public/js/catalog-live-search.js` and `node --check public/app.js`.
- [x] 4. Run `python3 -m unittest tests/test_frontend_integrity.py`.

---

### Task 3: Implement `logDebug` and Instrument Frontend `catch` Blocks

**Files:**
- Modify: `public/js/utils.js`
- Modify: `public/app.js`
- Modify: `public/js/state.js`, `public/js/catalog.js`, `public/js/settings.js`, `public/js/player.js`
- Test: `tests/test_frontend_integrity.py`

**Steps:**
- [x] 1. In `public/js/utils.js`:
  - Implement and export `logDebug(scope, ...args)`:
    - Safely checks `typeof window !== "undefined" && (window.__CINEFLOW_DEBUG__ || (typeof localStorage !== "undefined" && localStorage.getItem("cineflow_debug") === "1"))`.
    - If true, calls `console.debug("[CineFlow:" + scope + "]", ...args)`.
  - Attach `if (typeof window !== "undefined") window.logDebug = logDebug;`.
- [x] 2. In `public/app.js` and major modules:
  - Replace raw `catch (_) {}` blocks around localStorage, JSON parsing, and MediaSession with `catch (err) { logDebug("scope", err); }`.
- [x] 3. Verify with `node --check` across all updated files.

---

### Task 4: Automated Testing & Regression Verification

**Files:**
- Modify: `tests/test_roadmap_features.py`
- Test: `run_tests.py`

**Steps:**
- [x] 1. Add verification test in `tests/test_roadmap_features.py`:
  - Verify `backend.kinorium_parsers` exports required parsers and `KinoriumService` delegates correctly.
  - Verify `public/js/catalog-live-search.js` exists and exports `initCatalogLiveSearch`.
  - Verify `logDebug` is present in `public/js/utils.js` and is non-intrusive by default.
- [x] 2. Run `python3 -m unittest tests/test_roadmap_features.py`.
- [x] 3. Run full test suite `python3 -B run_tests.py` ensuring 118+ tests pass.

---

### Task 5: Cache Token Bump, App Sync, and Git Commit

**Files:**
- Run: `python3 scripts/bump_cache_token.py`
- Sync: `/Applications/CineFlow.app/Contents/Resources/app/`
- Git: Commit changes

**Steps:**
- [x] 1. Run `python3 scripts/bump_cache_token.py` to bump cache token.
- [x] 2. Run full test suite `python3 -B run_tests.py` ensuring 100% pass rate.
- [x] 3. Sync files to `/Applications/CineFlow.app/Contents/Resources/app/`.
- [x] 4. Commit git changes atomically.
