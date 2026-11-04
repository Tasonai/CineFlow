# Wave 3: Smart Bookmarks, Home LAN Sync, Large List Virtualization & Player Layout Polishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Smart Video Bookmarks with editable notes & Markdown export, Local Home Device LAN Synchronization (merge watch history & bookmarks across devices), Large Catalog List rendering optimization (requestAnimationFrame batching + content-visibility), and fix the credits collision between the Episode Rating card and Next Episode toast in the player.

**Architecture:** 
- Frontend-driven layout decoupling for the player credits endgame: dock Next Episode toast to bottom-left and Rating/Endgame stack to bottom-right with responsive safe margin, preventing any visual overlap.
- Modular player bookmarks subsystem in `public/js/player-bookmarks.js` with note dialog, timeline hover tooltips, and Markdown/JSON export.
- Lightweight LAN Sync engine in `backend/routes/remote.py` exposing `/api/sync/state` and `/api/sync/merge` with deterministic timestamp-based last-write-wins merging and local peer discovery.
- Chunked DOM rendering pipeline in `public/js/catalog-cards.js` coupled with modern CSS containment (`content-visibility: auto`) for silky smooth 60–120 FPS catalog scrolling.

**Tech Stack:** Vanilla ES Modules (`public/js/*.js`), Pure CSS with Apple TV matte design tokens (`public/css/*.css`), Python 3 standard library backend (`backend/routes/remote.py`, `backend/routes/catalog.py`), Unittest test suite.

**Spec:** User feature request for Smart Bookmarks, Local Device LAN Sync, Large List Optimization, and Player Credits Rating vs Next Episode Banner deconfliction.

## Global Constraints

- Never run installer packaging scripts (`macos/build_macos_app.py`, `windows/build_windows_installer.py`) without explicit direct user command.
- Zero dotted Russian abbreviations (`сек.`, `мин.`, `эп.`, `стр.`, `г.`) in UI strings or titles.
- Zero unicode emojis in UI strings; use Apple TV matte SVG icons.
- CSS `outline:` strictly `none` or `0` across all stylesheets; focus states styled via `box-shadow`.
- 100% test pass rate across full test suite (`python3 -B run_tests.py`).
- Static asset cache token bumped and synchronized across all files upon completion.

## Review Focus

1. **Player Credits Overlay Collision**: On all viewport widths (from 768px to 4K), ensure the Next Episode banner and Episode Rating card never overlap or occlude player controls.
2. **Bookmark Note Persistence**: Notes with Cyrillic characters, quotes, and newlines must serialize safely without corrupting JSON in localStorage.
3. **Kids Mode Isolation in LAN Sync**: Syncing between devices must respect Kids Mode profile boundaries — adult watch history/ratings must never leak into a child's profile on a synced device.
4. **Offline Resilience**: LAN sync failure or timeout must gracefully degrade with a discreet toast and never block video playback or catalog browsing.
5. **DOM Batching Interruption**: When switching categories rapidly, any pending `requestAnimationFrame` render batches must be cleanly cancelled so stale cards do not contaminate the new view.

---

### Task 1: Deconflict Player Credits Endgame (Episode Rating vs Next Episode Banner)

**Files:**
- Modify: `public/css/video-controls-and-person.css:3050-3090`
- Modify: `public/css/catalog-and-player-layout.css:1140-1210`
- Modify: `public/js/player-rating.js:25-55`
- Modify: `public/js/player-autoplay.js:45-125`
- Test: `tests/test_roadmap_features.py`

**Steps:**
- [x] 1. Update `public/css/video-controls-and-person.css` for `.atv-next-ep-toast`: change positioning from center (`left: 50%; transform: translateX(-50%)`) to Apple TV bottom-left dock (`bottom: 34px; left: 34px; transform: none; max-width: 440px;`).
- [x] 2. Update `public/css/catalog-and-player-layout.css` for `.atv-endgame-stack`: position at bottom-right (`bottom: 34px; right: 34px; width: 340px;`).
- [x] 3. Add responsive breakpoint `@media (max-width: 880px)` ensuring both cards stack with a clean vertical margin or adaptively fold without overlapping.
- [x] 4. In `public/js/player-rating.js`, coordinate z-index and spacing when both are active.
- [x] 5. Write automated regression test in `tests/test_roadmap_features.py` verifying spatial separation and CSS classes.

---

### Task 2: Smart Video Bookmarks with Editable Notes & Catalog Drawer

**Files:**
- Modify: `public/js/player-bookmarks.js`
- Modify: `public/js/state.js`
- Modify: `public/index.html`
- Modify: `public/css/video-controls-and-person.css`
- Modify: `public/css/modals-and-search.css`
- Modify: `public/js/i18n.js`
- Test: `tests/test_roadmap_features.py`

**Steps:**
- [x] 1. Expand `Bookmark` data model in `public/js/player-bookmarks.js` to include `note: string`, `updatedAt: number`, and `tags: string[]`.
- [x] 2. Add an interactive modal/popover `#atv-bookmark-note-dialog` to edit/save notes when adding a bookmark with shortcut `M` (or clicking marker).
- [x] 3. Enhance timeline markers to show note snippet in hover tooltip alongside time.
- [x] 4. Add "Список закладок" (Bookmarks Drawer) inside the player and a global "Мои заметки и закладки" modal in the main catalog with Markdown export (`exportBookmarksMarkdown()`).
- [x] 5. Write automated tests in `tests/test_roadmap_features.py` for note creation, editing, Markdown export, and profile isolation.

---

### Task 3: Local Home Device LAN Synchronization (LAN Sync)

**Files:**
- Create/Modify: `backend/routes/remote.py` (add `handle_sync_state`, `handle_sync_merge`, `handle_sync_peers`)
- Modify: `backend/server_lifecycle.py` / `backend/request_handler.py`
- Modify: `public/js/remote.js`
- Modify: `public/js/settings.js`
- Modify: `public/index.html`
- Modify: `public/css/modals-and-search.css`
- Modify: `public/js/i18n.js`
- Test: `tests/test_roadmap_features.py`

**Steps:**
- [x] 1. Implement `handle_sync_state` in `backend/routes/remote.py`: exports sanitized watch progress, bookmarks, and ratings for the active profile with timestamps.
- [x] 2. Implement `handle_sync_merge` in `backend/routes/remote.py`: merges remote device state using deterministic last-write-wins timestamp comparison, respecting Kids Mode restrictions.
- [x] 3. Implement `handle_sync_peers` in `backend/routes/remote.py`: returns discovered CineFlow peers on the LAN.
- [x] 4. Build "Локальная синхронизация" (LAN Sync) UI in Settings (`public/js/settings.js` and `public/index.html`) with discovered peers list, "Синхронизировать сейчас" button, and sync status indicator.
- [x] 5. Write comprehensive automated tests for LAN sync state generation, merge logic, conflict resolution, and Kids Mode safety.

---

### Task 4: Profiling & Large Catalog List Rendering Optimization

**Files:**
- Modify: `public/js/catalog-cards.js`
- Modify: `public/css/catalog-and-player-layout.css`
- Test: `tests/test_frontend_integrity.py`
- Test: `tests/test_roadmap_features.py`

**Steps:**
- [x] 1. Add `content-visibility: auto` and `contain-intrinsic-size: 180px 270px` for `.atv-card` in `public/css/catalog-and-player-layout.css` to eliminate off-screen render cost.
- [x] 2. Implement chunked progressive rendering in `public/js/catalog-cards.js` using `requestAnimationFrame` (48 items per chunk) with cancellation of in-flight renders on category change.
- [x] 3. Verify zero layout jank on 1000+ item mock catalogs.
- [x] 4. Write regression tests verifying progressive rendering and CSS containment invariants.

---

### Task 5: Full Suite Verification, Cache Token Bump, and App Sync

**Files:**
- Run: `python3 scripts/bump_cache_token.py`
- Run: `python3 -B run_tests.py`
- Sync: `/Applications/CineFlow.app/Contents/Resources/app/`
- Git: Atomic commit

**Steps:**
- [x] 1. Bump static asset cache token across public assets (`20261104v25` -> `20261104v26`).
- [x] 2. Run full test suite (`python3 -B run_tests.py`): 117 tests passing (100% pass rate).
- [x] 3. Sync updated resources to `/Applications/CineFlow.app/Contents/Resources/app/`.
- [x] 4. Create atomic Git commit.
