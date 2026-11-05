# CineFlow Backlog & User Stories (`docs/STORIES.md`)

Prioritized engineering and UX stories for the CineFlow macOS/Windows desktop media center, tracked by the autonomous `improve-loop` workflow.

---

## Milestone M1: Deep Modularity, Log Hygiene & Event Architecture

### S-001 Gate verbose HDRezka stream debug logging in production
As a user running CineFlow daily, I want `/api/hdrezka/streams` requests not to write raw `[CineFlow-DEBUG]` lines to stdout and `data/cineflow.log` unless `CINEFLOW_VERBOSE_LOG` is enabled, keeping log files compact and clean.
Screens: backend/routes/streams.py
Acceptance:
- [unit] `backend/routes/streams.py` gates `[CineFlow-DEBUG] streams req:` and `[CineFlow-DEBUG] streams resp:` behind `if getattr(ctx, "verbose_log", False):`.
- [self] Running `python3 -B run_tests.py` completes with zero `[CineFlow-DEBUG]` spam in test output when `CINEFLOW_VERBOSE_LOG` is unset.
- [unit] Entry recorded in `docs/FIXLOG.md` with a `Rule:` line.
Status: done

### S-002 Extract Kinorium HTTP client, JS challenge solver & cookie utilities (`backend/kinorium_http.py`)
As a developer maintaining Kinorium connectivity, I want HTTP transport, cookie sanitization, domain failover, and the JS PoW/challenge solver isolated in `backend/kinorium_http.py` while keeping 100% backward-compatible methods on `KinoriumService`.
Screens: backend/kinorium_http.py, backend/kinorium.py
Depends: S-001
Acceptance:
- [unit] `backend/kinorium_http.py` encapsulates `_read_resp_bounded`, `_decompress_gzip_bounded`, `extract_user_path`, `extract_cookie_user_id`, `sanitize_session_cookie`, `solve_kinorium_js_challenge`, `kinorium_candidate_domains`, `is_ip_cooldown_active`, `kinorium_http_request`, `get_active_sync_cookie`, `ensure_kinorium_cookies`, and `fetch_kinorium_html`.
- [unit] `KinoriumService` delegates all transport and cookie methods seamlessly so existing callers and tests (`test_audit_fixes.py`, `test_v31_upgrades.py`) pass unchanged.
- [self] `backend/kinorium.py` shrinks by ~600+ lines.
Status: done

### S-003 Extract Kinorium bidirectional episode & status sync engine (`backend/kinorium_sync.py`)
As a developer maintaining two-way Kinorium synchronization, I want remote status pushing and episode reconciliation isolated in `backend/kinorium_sync.py` with full method delegation on `KinoriumService`.
Screens: backend/kinorium_sync.py, backend/kinorium.py
Depends: S-002
Acceptance:
- [unit] `backend/kinorium_sync.py` encapsulates `_is_episode_cached_remote_done`, `_merge_remote_episodes_into_local`, `fetch_series_episodes_state`, `_post_episode_status_remote`, `_sync_episodes_map_to_kinorium_remote`, `reconcile_series_episodes`, `reconcile_local_statuses_to_remote`, `reconcile_all_local_episodes`, and `_sync_to_kinorium_remote`.
- [unit] `KinoriumService` delegates all sync/reconciliation methods with zero behavioral drift and full thread-lock safety (`_state_lock`, `_episodes_lock`).
- [self] `backend/kinorium.py` shrinks by ~1,000+ lines (bringing total size below 5,900 lines).
Status: done

### S-004 Extract global keyboard & media hotkeys controller (`public/js/app-hotkeys.js`)
As a user navigating CineFlow with keyboard shortcuts on macOS and Windows, I want global hotkeys (Escape modal stack, Cmd/Ctrl+K search, mini-player controls, full player playback/audio/subtitle/chapter shortcuts) managed by a dedicated `public/js/app-hotkeys.js` module.
Screens: public/js/app-hotkeys.js, public/app.js
Depends: S-003
Acceptance:
- [unit] `public/js/app-hotkeys.js` exports `initGlobalHotkeys` and passes `node --check` and `jsc -m` validation.
- [unit] `public/app.js` imports and calls `initGlobalHotkeys()`, reducing `public/app.js` by ~470 lines.
- [self] All static frontend integrity checks in `tests/test_frontend_integrity.py` pass.
Status: done

### S-005 Extract player status & post-watch rating bindings (`public/js/player-rating.js` & `public/js/modals.js`)
As a user rating episodes/movies or toggling Kinorium statuses in Quick Peek and the player, I want Quick Peek status/rating bindings in `public/js/modals.js` and player status/post-watch bindings in `public/js/player-rating.js` instead of inside monolithic `public/app.js`.
Screens: public/js/player-rating.js, public/js/modals.js, public/app.js
Depends: S-004
Acceptance:
- [unit] `public/js/modals.js` exports `initQuickPeekBindings` and `public/js/player-rating.js` exports `initPlayerStatusAndRatingBindings`.
- [unit] `public/app.js` delegates to both initializers, reducing `public/app.js` by ~850 lines.
- [self] All tests in `tests/test_frontend_integrity.py` and `tests/test_roadmap_features.py` pass.
Status: done

### S-006 Extract settings, onboarding & backup bindings (`public/js/settings.js`)
As a user configuring settings, running the onboarding wizard, or exporting/importing backups, I want the DOM event bindings for settings, onboarding, and backup paste/export encapsulated in `public/js/settings.js` (`initSettingsAndBackupBindings`).
Screens: public/js/settings.js, public/app.js
Depends: S-005
Acceptance:
- [unit] `public/js/settings.js` exports `initSettingsAndBackupBindings`, `handleExportBackup`, and `openManualBackupPasteBox`.
- [unit] `public/app.js` calls `initSettingsAndBackupBindings()`, bringing `public/app.js` down below 2,100 lines (a >45% reduction from 3,814 lines).
- [self] Cache token bumped via `scripts/bump_cache_token.py`, full test suite (`120/120` tests) passes, and `/Applications/CineFlow.app/Contents/Resources/app/` is synced.
Status: done

---

## Milestone M2: Architecture Deepening (`improve-architecture`)

### S-007 Extract player stage & video controls event bindings (`public/js/player-ui-controls.js`)
As a developer maintaining the video player UI, I want the player stage click/wheel/popover/fullscreen/studio/source tab bindings in `public/app.js` extracted into `initPlayerStageAndGearBindings()` in `public/js/player-ui-controls.js`, bringing `public/app.js` below 1,300 lines.
Screens: public/js/player-ui-controls.js, public/app.js
Depends: S-006
Acceptance:
- [unit] `public/js/player-ui-controls.js` exports `initPlayerStageAndGearBindings` and `public/app.js` invokes it.
- [self] `public/app.js` shrinks to 1,209 lines and all `tests/test_frontend_integrity.py` checks pass.
Status: done

### S-008 Extract Kinorium status, rating & episode mutations (`backend/kinorium_mutations.py`)
As a developer maintaining Kinorium state mutations, I want optimistic local state updates and remote writebacks (`mark_watched`, `set_rating`, `set_episode_rating`, `toggle_episode_watched`, `mark_episodes_batch`, `toggle_watchlist`, `toggle_watching`, `toggle_not_watching`, `get_profile_stats`, `configure_account`) isolated in `backend/kinorium_mutations.py` with delegation on `KinoriumService`.
Screens: backend/kinorium_mutations.py, backend/kinorium.py
Depends: S-003
Acceptance:
- [unit] `backend/kinorium_mutations.py` encapsulates all status, rating, and episode mutation methods.
- [self] `backend/kinorium.py` shrinks below 3,900 lines and all unit tests pass.
Status: done

### S-009 Consolidate catalog toolbar, filter reset & notifications bindings (`public/js/catalog-filters.js`)
As a developer maintaining catalog filters, I want filter-reset UI logic and catalog toolbar/notification event bindings consolidated in `public/js/catalog-filters.js` (`resetCatalogDrawerFiltersUI`, `initCatalogToolbarAndFilterBindings`), eliminating duplicated reset code and bringing `public/app.js` below 900 lines.
Screens: public/js/catalog-filters.js, public/js/catalog.js, public/app.js
Depends: S-007
Acceptance:
- [unit] `public/js/catalog-filters.js` exports `resetCatalogDrawerFiltersUI` and `initCatalogToolbarAndFilterBindings`.
- [self] `public/app.js` shrinks to 864 lines (80% smaller than original 4,316 lines) and all 120 unit tests pass.
Status: done

### S-010 Extract Settings Onboarding/Country selector & Auto-Updater/Backup subsystems (`public/js/settings-onboarding.js`, `public/js/settings-updater.js`)
As a developer maintaining settings, onboarding, and auto-updates, I want the Onboarding Wizard + 50-country selector in `public/js/settings-onboarding.js` and the Auto-Updater + Profile Backup engine in `public/js/settings-updater.js`, re-exported by `public/js/settings.js`.
Screens: public/js/settings-onboarding.js, public/js/settings-updater.js, public/js/settings.js
Depends: S-009
Acceptance:
- [unit] `public/js/settings-onboarding.js` and `public/js/settings-updater.js` pass `node --check` and are re-exported by `public/js/settings.js`.
- [self] `public/js/settings.js` shrinks from 3,471 lines to 1,825 lines (−47.4%) and all frontend integrity checks pass.
Status: done

### S-011 Extract Person Profile & Stats/Watch-History modals (`public/js/modals-person.js`, `public/js/modals-stats.js`)
As a developer maintaining modal views, I want the Person Profile / Cast modal in `public/js/modals-person.js` and the Analytics / Watch History modal in `public/js/modals-stats.js`, leaving `public/js/modals.js` focused on Quick Peek and modal coordination while re-exporting all symbols.
Screens: public/js/modals-person.js, public/js/modals-stats.js, public/js/modals.js
Depends: S-010
Acceptance:
- [unit] `public/js/modals-person.js` and `public/js/modals-stats.js` pass `node --check` and are re-exported by `public/js/modals.js`.
- [self] `public/js/modals.js` shrinks from 2,585 lines to 1,514 lines (−41.4%) and all unit tests pass.
Status: done

### S-012 Extract Kinorium profile sync, discovery & backup engine (`backend/kinorium_profile.py`)
As a developer maintaining Kinorium profile synchronization, friends feed, online premieres, and backup export/import, I want these cohesive responsibilities isolated in `backend/kinorium_profile.py` with full delegation on `KinoriumService`.
Screens: backend/kinorium_profile.py, backend/kinorium.py
Depends: S-008
Acceptance:
- [unit] `backend/kinorium_profile.py` encapsulates `sync_user_profile`, `disconnect_user_profile`, `fetch_status_list_ajax`, `fetch_movie_page_extras`, `get_similar_catalog_items`, `fetch_online_premieres`, `export_backup_state`, `import_backup_state`, and service integration helpers.
- [self] `backend/kinorium.py` shrinks from 3,896 lines to 2,436 lines (71.8% smaller than original 8,623 lines) and all 120 unit tests pass.
Status: done
