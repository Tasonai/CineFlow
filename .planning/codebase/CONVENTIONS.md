---
last_mapped_commit: 0ca6949e3be2a26342beea7cbfcd591a789fea04
last_mapped_at: 2026-11-03
---
# Coding Conventions

**Analysis Date:** 2026-11-03

## Naming Patterns

**Files:**
- **Python backend & tests:** Use `snake_case.py` (`backend/storage_db.py`, `backend/kinorium_auth.py`, `backend/backup_stream.py`, `tests/test_frontend_integrity.py`).
- **Frontend JavaScript:** Use `kebab-case.js` or single-word lowercase modules inside `public/js/` (`public/js/audio-dsp.js`, `public/js/catalog.js`, `public/js/player.js`, `public/app.js`).
- **Frontend CSS:** Use descriptive `kebab-case.css` domain bundles in `public/css/` (`public/css/base-and-hero.css`, `public/css/catalog-and-player-layout.css`, `public/css/modals-and-search.css`, `public/css/settings-and-episodes.css`, `public/css/video-controls-and-person.css`).
- **macOS / Windows native wrappers:** Use `PascalCase.swift` (`macos/CineFlowApp.swift`) or `snake_case` for helpers and C launchers (`macos/kinorium_login_helper.swift`, `windows/launcher/cineflow_launcher.c`, `windows/desktop_webview2.py`).

**Functions:**
- **Python:** Use `snake_case` for all functions and methods (`resolve_original_poster_url`, `update_progress_and_scrobble`). Prefix module-private or class-internal helpers with a single leading underscore (`_ensure_safe_std_streams`, `_is_allowed_media_source_url`, `_resolve_page_metadata`).
- **JavaScript:** Use `camelCase` for exported and internal functions (`openPlayerModal`, `clampFloatingPopover`, `withKinoriumActionLock`). Prefix module-private DOM/state helpers with a leading underscore (`_resetPopoverInlineBox`, `_flushOutOfFlowLayout`, `_tryRecoverHdRezkaPlayback`).
- **Bilingual UI helper:** Always use `t(ruText, enText)` from `public/js/i18n.js` for inline localized strings.

**Variables:**
- **Python:** Use `snake_case` for local variables and instance attributes; use `UPPER_SNAKE_CASE` for module-level constants (`BASE_DIR`, `PUBLIC_DIR`, `DATA_DIR`, `SETTINGS_SAVE_LOCK` in `server.py`).
- **JavaScript:** Use `camelCase` for properties in the central `state` singleton (`public/js/state.js`) and local variables; use `UPPER_SNAKE_CASE` for storage keys and lookup tables (`UI_PREFS_STORAGE_KEY`, `GENRE_RU_TO_EN`, `PAGE_SIZE`).
- **CSS Custom Properties & Selectors:** Define design tokens on `:root` in `public/css/base-and-hero.css` (`--bg-canvas`, `--bg-elevated`, `--text-primary`, `--ease-apple`, `--z-player-modal`). Prefix component classes with `.atv-` (`.atv-cinema-sheet`, `.atv-btn-primary`, `.atv-vc-popover`, `.atv-cselect-btn`).

**Types:**
- **Python:** Use `PascalCase` for classes (`CinemaRequestHandler`, `UnifiedCinemaAggregator`, `KinoriumService`, `CineFlowStorageDB`, `LocalVaultCipher`). Annotate function signatures using standard library `typing` (`Dict[str, Any]`, `List[str]`, `Optional[str]`, `Tuple[int, int]`).
- **Test Doubles:** Prefix test-only mock/stub classes in `tests/*.py` with a leading underscore and `_Mock`, `_Fake`, or `_Dummy` (`_MockNetClient`, `_FakeNetForRezka`, `_DummyRemuxEngine`).

## Code Style

**Formatting:**
- **Python:** 4-space indentation, UTF-8 encoding, double quotes `"..."` for strings, trailing commas in multi-line collections and function calls, line length ~100–120 characters.
- **JavaScript & CSS:** 2-space indentation, double quotes `"..."` in JS/HTML/CSS, semicolons required in JS, trailing commas in multi-line ES module imports/exports and object literals.
- **UI Copy & Typography Rules (Enforced by Automated Tests):**
  - Never use dotted Russian abbreviations (`сек.`, `мин.`, `эп.`, `стр.`, `г.`) anywhere in `public/`, `backend/`, `windows/`, `macos/`, or `server.py` (enforced by `test_no_dotted_russian_abbreviations_or_emojis_in_ui` in `tests/test_frontend_integrity.py` and `test_frontend_dom_css_and_copy_invariants` in `tests/test_audit_fixes.py`).
  - Never use emoji characters (`[\U0001F300-\U0001FAFF\u2600-\u27BF]`) in UI markup, JS, or Swift sources; use monochrome inline SVGs via `iconSvg(name, size)` in `public/js/utils.js`.

**Linting & Aesthetic Guardrails:**
- Instead of external Node/Python linters (`eslint`/`flake8`), strict static and structural invariants are enforced directly by `tests/test_frontend_integrity.py` and `tests/test_audit_fixes.py` (including WebKit `jsc -m` module graph syntax validation).
- **Matte Neutral Design System (`test_v29_unified_matte_design_system`):**
  - Zero `backdrop-filter: blur(...)` rules in CSS.
  - Zero native browser focus outlines (`outline: none;` only; custom `:focus-visible` box-shadow rings are defined in `public/css/base-and-hero.css`).
  - All `:hover` rules in `public/css/*.css` must be wrapped inside `@media (hover: hover) and (pointer: fine)` (or `hover: none` / `prefers-reduced-motion`) so touch devices never suffer sticky hover states.
  - Every `<button>` in `public/index.html` must declare an explicit `type="..."` attribute (`type="button"` or `type="submit"`).
  - Avoid static inline `style="..."` attributes in `public/js/modals.js` and `public/js/settings.js` (except dynamic progress bar widths `style="width:${...}%"`).

## Import Organization

**Python Order (`server.py`, `backend/*.py`, `tests/*.py`):**
1. Standard library modules sorted alphabetically (`import base64`, `import json`, `import os`, `import threading`, `from typing import Any, Dict`).
2. Local application modules (`import server`, `from backend.aggregator import UnifiedCinemaAggregator`, `from backend.storage_db import get_storage_db`).
Note: Backend runs strictly on Python 3 standard library with zero third-party pip packages required at runtime.

**JavaScript ES Module Order (`public/app.js`, `public/js/*.js`):**
1. State & storage helpers from `./state.js?v=<VERSION>` (or `./js/state.js?v=<VERSION>` in `public/app.js`).
2. Localization helpers from `./i18n.js?v=<VERSION>`.
3. Shared DOM/UI utilities from `./utils.js?v=<VERSION>`.
4. Feature/domain modules (`./audio-dsp.js`, `./catalog.js`, `./modals.js`, `./player.js`, `./subtitles.js`, `./remote.js`, `./settings.js`, `./features.js`).

**Cache-Buster Version Uniformity (Critical):**
- Every `<link>` and `<script>` asset in `public/index.html` and every `import { ... } from "...?v=..."` across `public/app.js` and `public/js/*.js` MUST share the exact same `?v=<VERSION>` query string (e.g., `?v=20261103v124`).
- `test_es_module_imports_exports_and_cache_version_uniformity` in `tests/test_frontend_integrity.py` verifies that all `?v=` parameters match and every imported symbol is explicitly exported by its target module.

## Error Handling

**Python Backend Patterns:**
- **Safe Type Coercion:** Use helper functions (`_safe_int(val, default)`, `_safe_float(val, default)`, `str(val or "").strip()`) when reading external JSON payloads, query parameters, or scraped HTML attributes.
- **Defensive I/O & Fallbacks:** Wrap network, subprocess, and filesystem calls in `try ... except Exception:` blocks that degrade gracefully (returning structured dictionaries like `{"ok": False, "error": "..."}` or cached state rather than crashing the HTTP server thread).
- **Concurrency & Atomic Persistence:** Protect shared state mutations with `threading.Lock()` / `threading.RLock()` (`SETTINGS_SAVE_LOCK` in `server.py`, `_lock` in `OfflineDownloadManager` and `CineFlowStorageDB`). Write critical files via temporary files (`tmp_path = f"{path}.tmp.{os.getpid()}.{threading.get_ident()}"`), `os.fsync()`, and atomic `os.replace()` with `0600` owner-only permissions (`set_private_file_permissions` in `backend/storage_db.py`).

**JavaScript Frontend Patterns:**
- **AbortController Cancellation:** Store request-scoped `AbortController` instances on `state` (`state.catalogAbortController`, `state.streamAbortController`, `state.subFetchAbortController`) and ignore `err.name === "AbortError"` in `catch` blocks.
- **Action Locking:** Wrap mutating user actions (such as Kinorium status toggles or ratings) in `withKinoriumActionLock(lockKey, controls, asyncFn)` (`public/js/utils.js`) to prevent double-submission, disable trigger buttons during flight, and surface errors via `showToast(...)`.
- **Silent Storage Guards:** Wrap `localStorage` and `URLSearchParams` reads/writes in `try { ... } catch (_) {}` so Safari Private Browsing or restricted WebViews never throw uncaught exceptions.

## Logging

**Framework:** Custom stdlib stream logger (`_safe_log` and `_ensure_safe_std_streams` in `server.py`) and browser `console.warn` / `console.error`.

**Patterns:**
- In Python, `_ensure_safe_std_streams()` in `server.py` guarantees `sys.stdout` and `sys.stderr` are valid UTF-8 streams (falling back to `data/cineflow.log` when launched via windowless `pythonw.exe` on Windows).
- Use `_safe_log(message, is_error=False)` in `server.py` for server lifecycle and diagnostic output; in `--launchd` daemon mode, non-error flushes are throttled unless `CINEFLOW_VERBOSE_LOG` is set.
- Never log or expose sensitive credentials (`session_cookie`, `kids_pin`, `.vault_key`) in API responses, logs, or non-local LAN exports.

## Comments

**When to Comment:**
- Document security boundaries (SSRF media URL validation in `server.py`, XXE rejection in `backend/tv_cast.py`, cryptographic key handling in `backend/storage_db.py`).
- Document non-obvious platform quirks (e.g., why raw 32-byte keys in `LocalVaultCipher._load_or_create_key` must never call `.strip()`, or why CSS containers with `position: fixed` descendants must clear residual `transform` properties).

**Docstrings:**
- Use concise triple-quoted Python docstrings (`"""..."""`) on classes and critical infrastructure functions (`LocalVaultCipher`, `set_private_file_permissions`, `_ensure_safe_std_streams`) and on invariant test methods in `tests/test_frontend_integrity.py`.

## Function Design

**Size & Responsibilities:**
- Keep pure transformation and parsing helpers small, deterministic, and stateless (`parse_http_byte_range` in `backend/downloads.py`, `parse_ssdp_headers` in `backend/tv_cast.py`, `escapeHtml` / `escapeAttr` in `public/js/utils.js`) so they can be unit-tested directly without I/O.
- UI rendering functions in `public/js/*.js` read from the shared `state` object (`public/js/state.js`) and update specific DOM subtrees by ID.

**Parameters & Return Values:**
- Prefer keyword arguments with safe defaults for multi-parameter backend methods (`get_streams_for_title(..., translator_id="", season=1, episode=1, force_refresh=False)`).
- Return normalized dictionaries with a boolean `"ok": True/False` flag from backend service methods and HTTP JSON endpoints (`/api/title-meta`, `/api/tv/devices`, `/api/profiles/switch`).

## Module Design

**Exports:**
- Frontend JavaScript uses explicit named ES module exports (`export function ...`, `export async function ...`, `export const ...`). Never use `export default`.
- `public/app.js` acts as the top-level orchestrator that imports named functions from `./js/*.js`, initializes the application (`initCineFlowApp`), and binds global event listeners.

**Barrel Files:**
- Do not use barrel files (`index.js` re-exports). Every frontend module imports directly from the specific source module (`./state.js`, `./i18n.js`, `./utils.js`, `./player.js`, etc.) with the current `?v=` cache-buster query string.

---

*Convention analysis: 2026-11-03*
