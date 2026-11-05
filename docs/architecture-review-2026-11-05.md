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

## Top Recommendation (Round 1 — Completed ✓)

Executed **Candidate 1** (`5558cd8`), **Candidate 2** (`d6f93da`), and **Candidate 3** (`8e3d2fb`).

---

# Architecture Review — Round 2 (2026-11-05)

Повторная архитектурная ревизия (`improve-architecture`) после завершения первой волны декомпозиции (`public/app.js`: 4 316 → 864 строки; `backend/kinorium.py`: 8 623 → 3 896 строк).

## 0. Результаты повторного обследования (Survey & Hot Spots)

- **Топ файлов по частоте изменений за 30 дней (`git log --since=30.days`):**
  1. `public/app.js` (16 коммитов, теперь 864 строки ✓)
  2. `public/js/player.js` (15 коммитов, 2 291 строка)
  3. `public/js/modals.js` (14 коммитов, 2 585 строк)
  4. `public/js/utils.js` (14 коммитов, 2 102 строки)
  5. `public/js/settings.js` (13 коммитов, 3 471 строка)
- **Крупнейшие модули кодовой базы (`wc -l`):**
  1. `backend/kinorium.py` — **3 896 строк**
  2. `public/js/player-streams.js` — **3 489 строк**
  3. `public/js/settings.js` — **3 471 строка**
  4. `backend/aggregator.py` — **3 308 строк**
  5. `backend/hdrezka.py` — **2 846 строк**
  6. `public/js/modals.js` — **2 585 строк**
  7. `public/js/player.js` — **2 291 строка**

---

## Candidate 4: Settings Onboarding, Country Selector & Updater/Backup Modules  [Strong — Completed ✓]

- **Files:** [`public/js/settings.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/settings.js) (reduced from 3 471 to 1 825 lines), [`public/js/settings-onboarding.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/settings-onboarding.js) (723 lines), [`public/js/settings-updater.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/settings-updater.js) (626 lines)
- **Signal:** File size over threshold (3 471 lines, 2-й крупнейший JS-файл проекта) + высокая частота изменений (13 коммитов за 30 дней) + несвязанные фичи внутри одного модуля.
- **Problem:** В `public/js/settings.js` объединены 3 независимые подсистемы:
  1. Настройки вкладок и интеграций (`lines 1–788`, `1048–1280`, `1709–2167`, `3025–3049`, `3135–3471`).
  2. Мастер первоначальной настройки (Onboarding Wizard) и выбор из 50 европейских стран (`lines 2168–3024`, ~856 строк).
  3. Автообновление приложения (App Auto-Updater) и экспорт/импорт резервных копий профилей (`lines 789–1047`, `1281–1708`, `3050–3134`, ~770 строк).
- **Proposal:**
  ```javascript
  // public/js/settings-onboarding.js (re-exported by public/js/settings.js)
  export function detectEuropeanCountryFromTimezone() { ... }
  export function renderSettingsCountryUI() { ... }
  export async function changeUserCountryInstant(newCountryCode) { ... }
  export async function openOnboardingModal({ isFirstRun = false } = {}) { ... }
  export async function submitOnboardingModal() { ... }

  // public/js/settings-updater.js (re-exported by public/js/settings.js)
  export async function buildFullBackupPayload() { ... }
  export async function restoreFromBackupObject(parsed) { ... }
  export function renderAppUpdaterUI(updaterObj = null) { ... }
  export async function checkAppUpdates({ force = true, silent = false } = {}) { ... }
  export async function startAppUpdateDownload() { ... }
  ```
- **Benefits:**
  - **Locality & Depth:** Мастер онбординга/стран и движок автообновления/бэкапов получают собственные изолированные модули; `public/js/settings.js` сокращается с **3 471 до ~1 850 строк** (−47%).
  - **Leverage:** Полный реэкспорт из `public/js/settings.js` сохраняет 100% совместимость со всеми существующими импортами.
- **Proof of same behavior:** `node --check`, `tests/test_frontend_integrity.py`, `python3 -B run_tests.py` (120 тестов).
- **Plan:** 1 атомарный коммит (`extract settings-onboarding.js and settings-updater.js from settings.js`).

---

## Candidate 5: Person Profile & Stats/Watch-History Modals Extraction  [Strong — Completed ✓]

- **Files:** [`public/js/modals.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/modals.js) (reduced from 2 585 to 1 514 lines), [`public/js/modals-person.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/modals-person.js) (650 lines), [`public/js/modals-stats.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/modals-stats.js) (467 lines)
- **Signal:** Высокая частота изменений (14 коммитов за 30 дней, топ-3 среди UI-модулей) + 3 разных модальных окна в одном файле на 2 585 строк.
- **Problem:** В `public/js/modals.js` живут три независимых модальных экрана:
  1. **Quick Peek Modal** (карточка фильма/сериала, список серий, статусы Кинориума — `lines 421–1413` и `2301–2585`).
  2. **Person Profile & Cast Modal** (профиль актёра/режиссёра, биография, фильмография, каст — `lines 1647–2300`, ~655 строк).
  3. **Stats & Watch History Modal** (аналитика оценок/жанров и журнал истории просмотров — `lines 71–293` и `1414–1646`, ~455 строк).
- **Proposal:**
  ```javascript
  // public/js/modals-person.js (re-exported by public/js/modals.js)
  export async function openPersonModal(personInput, options = {}) { ... }
  export function closePersonModal(options = {}) { ... }
  export function renderPersonFilmographyGrid() { ... }
  export function renderModalCastSection(item, streamData = null) { ... }

  // public/js/modals-stats.js (re-exported by public/js/modals.js)
  export async function openStatsModal(initialTab = "analytics") { ... }
  export function closeStatsModal(options = {}) { ... }
  export function renderWatchHistoryTab() { ... }
  ```
- **Benefits:**
  - **Locality:** Каждое модальное окно (`Quick Peek`, `Person`, `Stats/History`) живёт в своём модуле.
  - **Depth:** `public/js/modals.js` сокращается с **2 585 до ~1 460 строк** (−43.5%).
- **Proof of same behavior:** `node --check`, `tests/test_frontend_integrity.py`, `python3 -B run_tests.py` (120 тестов).
- **Plan:** 1 атомарный коммит (`extract modals-person.js and modals-stats.js from modals.js`).

---

## Candidate 6: Kinorium Profile Sync, Discovery & Backup Engine  [Strong — Completed ✓]

- **Files:** [`backend/kinorium.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium.py) (reduced from 3 896 to 2 436 lines), [`backend/kinorium_profile.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium_profile.py) (1 511 lines)
- **Signal:** Крупнейший файл в репозитории (`backend/kinorium.py` — 3 896 строк).
- **Problem:** Строки `957–2465` в `backend/kinorium.py` (~1 510 строк) реализуют синхронизацию профиля и друзей (`sync_user_profile`, `disconnect_user_profile`, `_resolve_friend_user_by_name_ajax`, `_verify_recent_watchlist_online_availability`, `fetch_status_list_ajax`, `get_account_summary`), дискавери (`fetch_movie_page_extras`, `get_similar_catalog_items`, `_refresh_online_premieres_sync`, `get_online_premieres_count`, `fetch_online_premieres`) и экспорт/импорт бэкапов и интеграций (`export_backup_state`, `import_backup_state`, `get_integrations`, `set_services_enabled_bulk`, `apply_country_localization`, `set_service_login`).
- **Proposal:**
  ```python
  # backend/kinorium_profile.py
  def sync_user_profile(svc, user_url_or_id: Optional[str] = None, ...) -> Dict[str, Any]: ...
  def disconnect_user_profile(svc) -> Dict[str, Any]: ...
  def fetch_movie_page_extras(svc, kinorium_id: int, ...) -> Dict[str, Any]: ...
  def get_similar_catalog_items(svc, kinorium_id: int, ...) -> List[Dict[str, Any]]: ...
  def fetch_online_premieres(svc, force_refresh: bool = False) -> List[Dict[str, Any]]: ...
  def export_backup_state(svc) -> Dict[str, Any]: ...
  def import_backup_state(svc, backup_data: Dict[str, Any]) -> Dict[str, Any]: ...
  ```
- **Benefits:**
  - **Locality & Depth:** Вся синхронизация профиля, лент друзей, онлайн-премьер и бэкапов выделяется в `backend/kinorium_profile.py`, а `backend/kinorium.py` сокращается с **3 896 до ~2 450 строк** (общее сокращение на **71.6%** от исходных 8 623 строк!).
- **Proof of same behavior:** `tests/test_audit_fixes.py`, `tests/test_v31_upgrades.py`, `tests/test_roadmap_features.py`, `python3 -B run_tests.py` (120 тестов).
- **Plan:** 1 атомарный коммит (`extract Kinorium profile sync, discovery & backup engine into backend/kinorium_profile.py`).

---

## Top Recommendation (Round 2)

Выполнить все 3 сильных кандидата по очереди (**Candidate 4 + Candidate 5 + Candidate 6**) по одному атомарному коммиту на шаг.
