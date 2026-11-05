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
Status: doing
