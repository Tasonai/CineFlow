# Architecture Review — 2026-11-05 (Milestone M1 Check-in)

Milestone `M1` check-in (`improve-loop` + `improve-architecture`), фиксирующий декомпозицию `backend/kinorium.py` и `public/app.js`, а также гигиену продакшн-логов.

---

## 1. Декомпозиция `backend/kinorium.py` (Transport & Sync Submodules)  [Completed ✓]

- **Files:** `backend/kinorium_http.py` (774 строки), `backend/kinorium_sync.py` (1 141 строка), `backend/kinorium_parsers.py` (1 146 строк), `backend/kinorium_persons.py` (665 строк), `backend/kinorium.py` (5 734 строки)
- **Status:** Выполнены истории `S-002` и `S-003`.
- **Details:**
  - **`backend/kinorium_http.py`**:
    - Выделены лимитированное чтение ответов `_read_resp_bounded`, `_decompress_gzip_bounded`, нормализация путей и кук `extract_user_path`, `extract_cookie_user_id`, `sanitize_session_cookie`.
    - Выделен решатель антибот-вызовов `solve_kinorium_js_challenge`, ротация зеркал и кулдауны `kinorium_candidate_domains`, `is_ip_cooldown_active`, а также HTTP-транспорт `kinorium_http_request`, `get_active_sync_cookie`, `ensure_kinorium_cookies`, `fetch_kinorium_html`.
  - **`backend/kinorium_sync.py`**:
    - Выделен движок двусторонней сверки эпизодов и статусов: `_is_episode_cached_remote_done`, `_merge_remote_episodes_into_local`, `fetch_series_episodes_state`, `_post_episode_status_remote`, `_sync_episodes_map_to_kinorium_remote`, `reconcile_series_episodes`, `reconcile_local_statuses_to_remote`, `reconcile_all_local_episodes`, `_sync_to_kinorium_remote`.
  - **Результат:** Размер `backend/kinorium.py` сократился с **8 623 строк** (до начала декомпозиции) до **5 734 строк** (−2 889 строк, или **−33.5%**) при 100% обратной совместимости всех методов `KinoriumService`.

---

## 2. Декомпозиция `public/app.js` (Controllers Extraction)  [Completed ✓]

- **Files:** `public/js/app-hotkeys.js` (475 строк), `public/js/catalog-live-search.js` (534 строки), `public/js/player-rating.js`, `public/js/modals.js`, `public/js/settings.js`, `public/app.js` (2 011 строк)
- **Status:** Выполнены истории `S-004`, `S-005` и `S-006`.
- **Details:**
  - **`public/js/app-hotkeys.js` (`initGlobalHotkeys`)**:
    - Изолированы глобальные клавиатурные сокращения (стек модальных окон `Escape`, `Cmd/Ctrl+K`, управление мини-плеером и полноэкранным плеером).
  - **`public/js/modals.js` (`initQuickPeekBindings`) & `public/js/player-rating.js` (`initPlayerStatusAndRatingBindings`)**:
    - Вынесены обработчики статусов Kinorium, звёздного рейтинга и пост-просмотровой карточки оценки фильма/серии.
  - **`public/js/settings.js` (`initSettingsAndBackupBindings`, `requestCloseSettingsModal`, `handleExportBackup`, `openManualBackupPasteBox`)**:
    - Вынесены обработчики настроек сети, Stremio-аддонов, LAN/Autostart, автообновлений, мастера первого запуска (Onboarding) и экспорта/импорта резервных копий.
  - **Результат:** Размер `public/app.js` сократился с **4 316 строк** (до начала декомпозиции) до **2 011 строк** (−2 305 строк, или **−53.4%**).

---

## 3. Гигиена логов в продакшене (`S-001`)  [Completed ✓]

- **Files:** `backend/routes/context.py`, `backend/routes/streams.py`, `docs/FIXLOG.md`
- **Status:** Выполнена история `S-001`.
- **Details:**
  - В `ServerContext` добавлено свойство `verbose_log`, считывающее переменную окружения `CINEFLOW_VERBOSE_LOG`.
  - В `backend/routes/streams.py` подробное логирование запросов и ответов `/api/hdrezka/streams` (`[CineFlow-DEBUG]`) закрыто проверкой `if getattr(ctx, "verbose_log", False):`.
