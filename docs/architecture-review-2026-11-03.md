# Architecture Review — 2026-11-03

Обзор архитектуры проекта CineFlow на основе анализа кодовой базы, журнала изменений и карты технологического долга (`.planning/codebase/CONCERNS.md`).

---

## 1. Декомпозиция монолита медиаплеера (Player Subsystems Extraction)  [Completed ✓]

- **Files:** `public/js/player-watchdog.js` (новый модуль), `public/js/player-remux.js` (новый модуль), `public/js/player-ui-controls.js` (новый модуль), `public/js/player-autoplay.js` (новый модуль), `public/js/player-pip-dock.js` (новый модуль), `public/js/player-seasons.js` (новый модуль), `public/js/player-streams.js` (новый модуль), `public/js/player-meta.js` (новый модуль), `public/js/player-bookmarks.js` (новый модуль), `public/js/player-rating.js` (новый модуль), `public/js/player-intro-credits.js` (новый модуль), `public/js/player.js`
- **Status:** Выполнены этапы 1–11 (Watchdog, Remux Pipeline, Stage UI Controls, Autoplay, PiP Dock, Seasons/Episodes, Stream Providers, Presentation/Meta, Bookmarks/X-Ray, Postwatch/Rating и Intro/Credits Subsystems).
- **Details:**
  - **Этап 1: `public/js/player-watchdog.js`**
    - Счётчик аппаратных кадров `getRenderedVideoFrameCount` (HTML5 Video Playback Quality API + WebKit Decoded Frames fallback).
    - Трекинг кадров через `requestVideoFrameCallback` (`initVideoFrameCounter`).
    - Мониторинг буфера опережения `getVideoForwardBufferSec`.
    - Обнаружение и авто-восстановление рассинхрона/зависания картинки при идущем звуке `checkVideoPlaybackFreeze` и `recoverFrozenVideoPlayback`.
    - Очистка сторожевых таймеров `clearVideoStallWatchdog`.
  - **Этап 2: `public/js/player-remux.js`**
    - Формирование эндпоинтов транскодирования `buildRemuxStreamEndpoint` (параметры звука, сдвиг дорожек `ashift`, H.264 fallback).
    - Расчёт эффективного тайминга воспроизведения с учётом смещения `getEffectivePlaybackTiming` и эвристика длительности `estimateItemDurationSec`.
    - Управление аудиосдвигом `formatAudioOffsetLabel` и `syncAudioOffsetUI`.
    - Асинхронное зондирование длительности и звуковых дорожек `scheduleRemuxFullDurationProbe`.
    - Переключение аудиодорожек и синхронизация селекторов `prepareRemuxAudioSwitch`.
  - **Этап 3: `public/js/player-ui-controls.js`**
    - Управление оверлеями всплывающих окон управления (audio, subs, speed, aspect ratio, gear): `hasOpenVcPopover`, `closeAllVcPopovers`, `syncVcPopoverOpenClass`.
    - Полноэкранный режим плеера и псевдо-полноэкранный режим для WebKit/встроенных представлений: `isStageFullscreen`, `setPseudoStageFullscreen`, `toggleStageFullscreen`, `beginFullscreenTransitionWindow`.
    - Авто-скрытие и пробуждение экранных контролов при движении мыши / тапах: `setVideoStageIdle`, `wakeVideoControls`.
    - Синхронизация состояния полосы таймлайна, буферов загрузки, индикаторов времени, регулятора громкости и бейджей: `syncCustomVideoControlsUI`.
    - Интерактивный скраббер таймлайна с поддержкой магнитного прилипания к главам (`getSnappingRatio`), плавного перетаскивания и всплывающих превью: `initCustomVideoControls`.
  - **Этап 4: `public/js/player-autoplay.js`**
    - Расчёт координат следующей серии в рамках сезона или следующего сезона с учётом доступности эпизодов: `getNextEpisodeCoords`.
    - Всплывающий тост обратного отсчёта до следующей серии с круговым SVG-прогрессом: `showPlayerNextEpisodeToast`, `dismissPlayerNextEpisodeToast`.
    - Таймер сна с плавным угасанием звука за 30 секунд до остановки: `setSleepTimer`.
    - Обратный отсчёт карточки автоперехода с учётом открытого оверлея оценки Kinorium: `clearAutoplayNextTimer`, `isPostwatchCardPausingAutoplay`, `startAutoplayNextCountdown`.
  - **Этап 5: `public/js/player-pip-dock.js`**
    - Синхронизация интерфейса фонового дока PiP и индикатора плеера: `syncPipDockUI`.
    - Управление фоновым режимом плеера при навигации по каталогу: `setPipBackgroundMode`.
    - Бесшовное восстановление полноэкранного плеера из Picture-in-Picture: `restoreFullPlayerFromPip`.
    - Управление мини-плеером в правом нижнем углу интерфейса: `updateMiniPlayerTitle`, `setMiniPlayerMode`.
  - **Этап 6: `public/js/player-seasons.js`**
    - Селекторы сезонов и серий с фильтрацией ещё не вышедших эпизодов: `populateSeasonEpisodeSelectors`, `resolveEffectiveSeasonsMap`.
    - Отрисовка плашки текущего эпизода и карточек/пилюль в режимах Strip/Grid: `updateCurrentEpisodeBar`, `escapeEpisodeHtml`, `getEpisodeDisplayMeta`, `getEpisodeRatingEntry`, `syncEpisodesStripDrawerUI`.
    - Переключение эпизодов и шаговая навигация: `switchToSeriesSeasonEpisode`, `stepEpisode`.
    - Пакетные и точечные отметки серий о просмотре в Kinorium: `resolveSeriesCompletedFlag`, `markEpisodesBatch`, `toggleCurrentEpisodeWatched`.
  - **Этап 7: `public/js/player-streams.js`**
    - Резолвинг и запуск всех типов потоков (HDRezka, Stremio, Backup 4K UHD / TorrServer, Offline Downloads, Официальные сервисы, Встроенные трейлеры): `loadOfflineStreamForActiveTitle`, `loadHDRezkaStream`, `loadStremioStreams`, `loadBackup4KReleases`, `probeAndPlay4KStream`, `loadOfficialServiceTab`, `loadTrailerTab`, `renderTrailerEmbed`.
    - Переключение источников и обработка ошибок со сменой студии озвучки: `switchSourceTab`, `switchHdRezkaStudio`, `renderErrorStudiosPanel`, `toggleErrorStudiosPanel`, `showVideoStreamError`, `hideVideoStreamError`.
    - Механизм самовосстановления воспроизведения при обрывах CDN / 403 / 410 с понижением битрейта: `_tryRecoverHdRezkaPlayback`, `isHdRezkaStreamDeadOrExpired`, `rankHdRezkaQualityScore`, `pickLowerHdRezkaQualityKey`, `appendProxyEdgeEvictParams`.
    - Список и ранжирование торрент-потоков Stremio с дедупликацией сидов: `renderStremioStreamsList`.
  - **Этап 8: `public/js/player-meta.js`**
    - Синхронизация и презентация метаданных фильма/сериала: `fetchAndApplyPlayerTitleMeta`, `renderModalGenresAndSubheader`, `updateModalKinoriumHeader`, `syncMediaSessionMetadata`.
    - Фильтрация каталога по клику на жанр из плеера: `filterCatalogByGenreFromPlayer`.
    - Боковая панель провайдеров, подписок и похожих тайтлов: `renderModalProvidersSidebar`, `renderModalSimilarItems`, `getOfficialServiceTargetUrl`, `OFFICIAL_STREAMING_SERVICES`, `_mergeItemProviders`.
    - Управление сворачиванием/разворачиванием инфо-панели плеера: `syncPlayerSidebarCollapsedUI`, `togglePlayerSidebarCollapsed`.
    - Захват кадра (скриншот) текущего воспроизведения через Canvas или бэкенд `/api/video-snapshot`: `captureVideoScreenshot`.
    - Модуль `public/js/player.js` использует и реэкспортирует эти функции с сохранением полной обратной совместимости для внешних вызовов и тестов (размер `player.js` сократился с 4 128 до **3 380 строк**, суммарно из монолита плеера вынесено почти **6 000 строк** — монолит сократился почти в 3 раза!).
  - **Этап 9: `public/js/player-bookmarks.js`**
    - Управление закладками и моментами с привязкой к активному профилю: `getSavedMoments`, `saveMoments`, `toggleBookmarkCurrentMoment`.
    - Отрисовка интерактивных пинов закладок на таймлайне плеера с быстрым переходом: `renderTimelineBookmarks`.
    - Панель X-Ray при паузе: `showXRayPauseShelf`, `hideXRayPauseShelf`.
    - Размер `player.js` сократился до **3 286 строк** при 100% обратной совместимости через реэкспорты.
  - **Этап 10: `public/js/player-rating.js`**
    - Синхронизация и динамическое позиционирование оверлея оценки Kinorium: `syncPostwatchOverlayMount`, `renderPostWatchRatingState`, `openPostWatchRatingOverlay`.
    - Автоматический вызов карточки оценки в момент начала финальных титров: `maybeAutoOpenCreditsRatingCard`.
    - Мутации статуса просмотра и выставление оценок (для фильмов и конкретных эпизодов сериалов): `toggleActivePlayerWatched`, `rateActivePlayerTitle`.
    - Размер `player.js` сократился до **2 937 строк** (впервые монолит плеера опустился ниже 3 000 строк — из 9 201 исходной строки вынесено более **6 260 строк**, или свыше 68% кода!).
  - **Этап 11: `public/js/player-intro-credits.js`**
    - Загрузка сегментов пропуска интро и аутро через API `/api/skip-intro`: `loadSkipIntroSegments`.
    - Определение момента наступления финальных титров с ранжированием кандидатов IntroDB и FFmpeg Probe: `getDetectedCreditsStartSec`.
    - Отрисовка цветных маркеров заставки (Intro) и титров (Credits) на таймлайне: `renderTimelineChapterMarkers`.
    - Размер `player.js` сократился до **2 849 строк** при 100% обратной совместимости через реэкспорты.
  - **Этап 12: Очистка и декомпозиция контроллеров всплывающих окон и статусов серий**
    - В подсистему `public/js/player-seasons.js` перенесены расчет прогресса и фиксация просмотренных серий: `hasStartedWatchingCurrentEpisode`, `markOutgoingEpisodeWatched`.
    - В подсистему `public/js/player-ui-controls.js` перенесены контроллеры всплывающих меню и быстрого переключения оригинального звука: `positionStagePopover`, `toggleQuickOriginalAudio`, `syncCustomControlPopovers`.
    - Размер `player.js` сократился до **2 440 строк**.
  - **Этап 13: `public/js/player-scrobble.js`**
    - Вынесена подсистема скробблинга и синхронизации прогресса воспроизведения с Kinorium: `reportScrobbleProgress`.
    - Обработка промежуточных тиков, вех завершения фильма/серии (`just_scrobbled`, `just_scrobbled_episode`), завершения всего сериала (`auto_completed_series`) и продвижения в раздел «Смотрю» (`promoted_to_watching`).
    - Автоматический запуск цепочек постобработки офлайн-загрузок (`offline_automation`), синхронизация счетчиков разделов Kinorium и полки «Продолжить просмотр».
    - Размер `player.js` сократился до **2 261 строки** (суммарно из 9 201 исходной строки вынесено почти **7 000 строк**, или **75.4% кодовой базы** монолита плеера!).
  - Все 107 тестов `python3 run_tests.py` успешно пройдены. Файлы синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 2. Модульная таблица маршрутизации HTTP-сервера (Server Route Dispatcher)  [Completed ✓]

- **Files:** `backend/routes/__init__.py`, `backend/routes/catalog.py`, `backend/routes/system.py`, `backend/routes/profiles.py`, `backend/routes/downloads.py`, `server.py`
- **Status:** Выполнены этап 1 (вынос каталожных и системных эндпоинтов) и этап 2 (вынос профилей и офлайн-загрузок).
- **Details:**
  - Создан пакет `backend/routes/` с декларативными таблицами маршрутов `GET_ROUTES` и `POST_ROUTES`.
  - Модуль [`backend/routes/catalog.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/routes/catalog.py):
    - `handle_catalog`: выдача каталога с фильтрацией по провайдерам, медиа-типам, секциям Kinorium, детскому профилю и языку.
    - `handle_search`: сквозной поиск по агрегатору с поддержкой режимов `full` и `suggest`.
  - Модуль [`backend/routes/system.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/routes/system.py):
    - Статус системы и автообновлений (`/api/system/status`, `/api/system/update/*`).
    - Управление сетью LAN (`/api/system/lan`) и автозапуском (`/api/system/autostart`).
    - Полная обработка настроек приложения (`GET` и `POST` `/api/settings`).
  - Модуль [`backend/routes/profiles.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/routes/profiles.py):
    - Выдача списка профилей (`GET /api/profiles`).
    - Верификация и блокировка PIN-кода детского профиля (`POST /api/profiles/verify-pin`).
    - Переключение профилей с изоляцией сессий Kinorium (`POST /api/profiles/switch`).
    - Сохранение и редактирование профилей (`POST /api/profiles/save`).
    - Безопасное удаление профилей с очисткой связанных загрузок (`POST /api/profiles/delete`).
  - Модуль [`backend/routes/downloads.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/routes/downloads.py):
    - Списки офлайн-загрузок и фильтрация по профилю (`GET /api/downloads`).
    - Получение и обновление настроек автоочистки (`GET`/`POST` `/api/downloads/prefs`).
    - Постановка загрузки в очередь с валидацией источников потоков (`POST /api/downloads/start`).
    - Пакетная загрузка сезонов сериалов (`POST /api/downloads/batch`).
    - Управление жизненным циклом загрузок (`cancel`, `delete`, `open-folder`, `cleanup-pending`).
  - Класс `ServerContext` в `server.py` обеспечивает реактивную передачу ссылок на глобальные синглтоны и конфигурации через свойства (`@property`), сохраняя совместимость с monkeypatching в тестах.
  - Методы `do_GET` и `do_POST` в `CinemaRequestHandler` разгружены более чем на 550 строк сложной вложенной логики (`server.py` сократился с 7 315 до 6 749 строк).
  - Все 90 тестов `python3 run_tests.py` успешно пройдены (13.5 с). Файлы синхронизированы в `/Applications/CineFlow.app`.

---

## 3. Разделение обязанностей нативного macOS шелла (Native Shell Decoupling)  [Completed ✓]

- **Files:** `macos/CineFlowApp.swift`
- **Status:** Выполнено архитектурное разделение обязанностей на специализированные классы.
- **Details:**
  - **`ServerDaemonSupervisor`**: отдельный изолированный класс управления жизненным циклом Python-бэкенда:
    - Контроль и освобождение порта (`killStaleServerOnPort`).
    - Мониторинг готовности и версий через `/api/system/status` (`checkServerAlive`, `waitForServerReady`).
    - Запуск дочернего процесса `server.py` в изолированном окружении с потоками вывода в лог-файл (`spawnBackendServerProcess`).
    - Корректный перезапуск и завершение процесса (`restartServer`, `stopSpawnedServerIfNeeded`).
  - **`KinoriumAuthSheetController`**: специализированный контроллер нативного модального окна авторизации Kinorium в 1 клик:
    - Инкапсулирует отдельное окно `NSWindow` и неперсистентное `WKWebView` (`.nonPersistent()`).
    - Реализует собственные протоколы `WKNavigationDelegate` и `WKUIDelegate`, освобождая главный контроллер от перехвата сторонней навигации.
    - Автоматически инспектирует cookie store, отслеживает авторизацию и безопасно передает сессию обратно в основной интерфейс через мост JavaScript.
  - Главный класс `CineFlowAppController` теперь выступает исключительно координатором оконного окружения AppKit, меню статуса и медиа-ключей macOS.
  - Код успешно компилируется через `swiftc` без предупреждений, все тесты целостности и инвариантов нативного бандла пройдены (93/93 тестов OK). Файлы синхронизированы в `/Applications/CineFlow.app`.

---

## 4. Единый источник правды для хранилища данных (SQLite First Architecture)  [Completed ✓]

- **Files:** `backend/storage_db.py`, `backend/downloads.py`
- **Status:** Выполнен этап устранения дисковых задержек (Dual-Write Progress Elimination).
- **Details:**
  - В класс `CineFlowStorageDB` добавлены точечные методы:
    - `upsert_download(download_id, record)` — высокоскоростной атомарный `INSERT INTO downloads ... ON CONFLICT(download_id) DO UPDATE` через транзакцию WAL.
    - `delete_download_record(download_id)` — удаление записи напрямую из SQLite таблицы.
  - В модуле `backend/downloads.py`:
    - Промежуточные тики прогресса загрузки видео (каждые 3 секунды) переведены на вызов `_save_single_progress_locked(did)`, который обновляет только конкретную запись в SQLite WAL без дисковой перезаписи всего JSON и без пересоздания таблицы через `DELETE FROM downloads`.
    - Полная сериализация в `downloads_index.json` теперь происходит только на дискретных этапах жизненного цикла (постановка в очередь, завершение, сбой, отмена, удаление, старт приложения).
  - Скорость прогона тестов выросла (с 16.6 с до 13.8 с), устранена нагрузка на SSD и I/O-фризы при одновременной фоновой загрузке нескольких видеопотоков.
  - Все 90 тестов `python3 run_tests.py` успешно пройдены. Файлы синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 5. Автоматизированная синхронизация версий и хэшей кэша (Asset Hash Automation)  [Completed ✓]

- **Files:** `scripts/bump_cache_token.py` (новый скрипт), `tests/test_bump_cache_token.py` (новый набор тестов), `public/index.html`, `public/app.js`, `public/js/*.js`, `tests/test_frontend_integrity.py`
- **Status:** Реализован по методологии TDD (Test-Driven Development).
- **Details:**
  - Создан скрипт [`scripts/bump_cache_token.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/scripts/bump_cache_token.py):
    - `get_current_cache_token`: авто-определение текущего токена кэша из `public/index.html`.
    - `generate_next_cache_token`: генерация инкремента вида `YYYYMMDDvNN` (например, `20261103v125` -> `20261103v126`) или сброс на `v1` при смене календарного дня.
    - `bump_cache_token`: атомарное обновление строки `?v=...` по всем 16 файлам (`index.html`, `app.js`, 13 модулям `js/*.js` и тесту целостности `test_frontend_integrity.py`).
    - Поддержка флагов `--dry-run` (безопасный предварительный просмотр) и `--token <val>` (явное задание токена).
  - Написаны тесты [`tests/test_bump_cache_token.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/tests/test_bump_cache_token.py) (проверка извлечения, генерации, атомарной замены во временном дереве каталогов).
  - Скрипт успешно применён к кодовой базе, обновив кэш-токен до `20261103v126`.
  - Все 93 теста `python3 run_tests.py` успешно пройдены. Файлы синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 6. Модуляризация медиа- и Kinorium-роутов в `backend/routes/`  [Completed ✓]

- **Files:** `backend/routes/kinorium.py` (новый модуль), `backend/routes/streams.py` (новый модуль), `backend/routes/__init__.py`, `server.py`, `tests/test_modular_routes.py` (новый набор тестов)
- **Status:** Успешно реализован по методологии TDD.
- **Details:**
  - Создан выделенный модуль [`backend/routes/kinorium.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/routes/kinorium.py), инкапсулирующий:
    - GET-эндпоинты: `/api/kinorium/avatar`, `/api/kinorium/live-digest`, `/api/kinorium/stats`, `/api/kinorium/one-click-status`, `/api/integrations`.
    - POST-эндпоинты (17 штук): `/api/kinorium/scrobble`, `/api/kinorium/rate-episode`, `/api/kinorium/rate`, `/api/kinorium/watched`, `/api/kinorium/episode-watched`, `/api/kinorium/episode-watch`, `/api/kinorium/watched-episodes-batch`, `/api/kinorium/watchlist`, `/api/kinorium/watching`, `/api/kinorium/never`, `/api/kinorium/continue-watching/remove`, `/api/kinorium/continue-watching/restore`, `/api/kinorium/sync`, `/api/kinorium/disconnect`, `/api/kinorium/one-click-login`, `/api/kinorium/one-click-cancel`, `/api/kinorium/one-click-complete`.
    - Инкапсулирована централизованная проверка безопасности LAN и детского профиля `_check_kinorium_kids_safe`.
  - Создан выделенный модуль [`backend/routes/streams.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/routes/streams.py), инкапсулирующий:
    - HDRezka: `/api/hdrezka/streams`, `/api/hdrezka/check-watching-updates`.
    - Stremio: `/api/stremio/addons` (GET/POST), `/api/stremio/streams` (GET), `/api/stremio/resolve` (POST).
    - Remux: `/api/remux-probe`, `/api/remux-subtitle`.
  - Монолитный диспетчер `server.py` разгружен: удалено более **1 180 строк** процедурного кода из `do_GET` и `do_POST`.
  - Написан комплект тестов [`tests/test_modular_routes.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/tests/test_modular_routes.py).
  - Все **100 из 100 тестов** `python3 run_tests.py` успешно пройдены за 12.9 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 7. Модуляризация маршрутов Remote Control, Smart TV и Backup в `backend/routes/`  [Completed ✓]

- **Files:** `backend/routes/remote.py` (новый модуль), `backend/routes/backup.py` (новый модуль), `backend/routes/__init__.py`, `server.py`, `tests/test_modular_routes.py`
- **Status:** Успешно реализован по методологии TDD (Test-Driven Development).
- **Details:**
  - Создан выделенный модуль [`backend/routes/remote.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/routes/remote.py), инкапсулирующий:
    - Smart TV / DLNA: `/api/tv/devices` (GET), `/api/tv/deep-link` (GET), `/api/tv/cast` (POST), `/api/tv/stop` (POST).
    - Mobile Remote Control: `/api/remote/pairing` (GET), `/api/remote/state` (GET/POST), `/api/remote/commands` (GET), `/api/remote/catalog` (GET), `/api/remote/pair` (POST), `/api/remote/native-fullscreen` (POST), `/api/remote/native-pip` (POST), `/api/remote/command` (POST).
  - Создан выделенный модуль [`backend/routes/backup.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/routes/backup.py), инкапсулирующий:
    - Резервное копирование и восстановление: `/api/backup/export` (GET), `/api/backup/import` (POST).
  - Монолитный диспетчер `server.py` разгружен ещё на **662 строки** (размер `server.py` сократился с 5 564 до **4 902 строк**).
  - Написаны тесты регистраций и контрактов в [`tests/test_modular_routes.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/tests/test_modular_routes.py).
  - Все **105 из 105 тестов** `python3 run_tests.py` успешно пройдены за 16.7 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 8. Модуляризация маршрутов метаданных, субтитров и Debrid в `backend/routes/`  [Completed ✓]

- **Files:** `backend/routes/meta.py` (новый модуль), `backend/routes/debrid.py` (новый модуль), `backend/routes/__init__.py`, `server.py`, `tests/test_modular_routes.py`
- **Status:** Успешно реализован по методологии TDD (Test-Driven Development).
- **Details:**
  - Создан выделенный модуль [`backend/routes/meta.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/routes/meta.py), инкапсулирующий:
    - Трейлеры и персоны: `/api/trailer`, `/api/person`, `/api/person-photo`.
    - Агрегированные метаданные тайтлов: `/api/title-meta` (синтез HDRezka, Kinorium, Cinemeta/TVMaze, JustWatch, проверка детского режима, слияние сезонов и эпизодов).
    - Провайдеры и пропуск заставок: `/api/provider-link`, `/api/skip-intro`.
    - Субтитры и календарь: `/api/subtitles/search`, `/api/subtitles/translate`, `/api/calendar`.
  - Создан выделенный модуль [`backend/routes/debrid.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/routes/debrid.py), инкапсулирующий:
    - Поиск и резолвинг торрентов и Debrid-потоков: `/api/backup-streams` (GET), `/api/debrid/resolve` (POST), `/api/backup-streams/resolve` (POST).
    - Интеграции сервисов: `/api/integrations` (POST).
  - Монолитный диспетчер `server.py` разгружен ещё на **1 075 строк** (размер `server.py` сократился с 4 902 до **3 827 строк**; суммарно из монолита вынесено почти **3 500 строк**).
  - В монолите `server.py` остались исключительно бинарные потоковые пайплайны (Range-стриминг видео, прокси фрагментов HLS, real-time remux через FFmpeg) и выдача статических ресурсов.
  - Все **107 из 107 тестов** `python3 run_tests.py` успешно пройдены за 14.2 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 9. Декомпозиция каталога: вынос полок и каруселей в `public/js/catalog-shelves.js`  [Completed ✓]

- **Files:** `public/js/catalog-shelves.js` (новый модуль), `public/js/catalog.js`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости через реэкспорты.
- **Details:**
  - Создан специализированный модуль [`public/js/catalog-shelves.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog-shelves.js) (813 строк), инкапсулирующий:
    - **Полка «Продолжить просмотр»**: `renderContinueWatching()` — отрисовка карточек незавершенного просмотра фильмов и новых серий сериалов, расчет остаточного времени до конца видео, прогресс-бары, кнопка скрытия карточки из карусели и восстановление скрытых карточек.
    - **Подборки и кураторские карусели**: `renderCuratedShelves()`, `parseItemDurationMinutes()` — расчет умных коллекций («Высоко оценили друзья», «В вашем вкусе» по жанровым весам, «Короткие на вечер до 100 минут», «Топ Кинориума и IMDb 8.0+»).
    - **Полки каталога и разделов**: `renderCatalogShelves()` — раздельные полки «Фильмы» и «Сериалы» с горизонтальным скроллом, единая 30-карточная пагинированная сетка для разделов Kinorium, секция найденных персон с фотокарточками (`searchPersons`), похожие тайтлы при поиске и empty-state с кнопкой сброса фильтров.
  - Исходный файл `public/js/catalog.js` сократился с 4 797 до **4 049 строк** (-748 строк).
  - Кэш-токен статики обновлен до `20261104v10`.
  - Все **107 из 107 тестов** `python3 run_tests.py` успешно пройдены за 14.3 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

## 10. Декомпозиция каталога: вынос постеров, карточек и контекстного меню в `public/js/catalog-cards.js`  [Completed ✓]

- **Files:** `public/js/catalog-cards.js` (новый модуль), `public/js/catalog.js`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости через реэкспорты.
- **Details:**
  - Создан специализированный модуль [`public/js/catalog-cards.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog-cards.js) (803 строки), инкапсулирующий:
    - **Интеллектуальные бейджи постера**: `buildPosterBadgesHtml()` — офлайн-статус, бейджи статуса Кинориума (Буду смотреть, Смотрю, Просмотрено) с кастомной цветовой кодировкой, бейджи новых вышедших серий.
    - **Умный SVG-фоллбэк постера**: `buildFallbackPosterSvg()`, `attachSmartPosterFallback()` — градиентная карточка с иконкой фильма/сериала, названием и годом при отсутствии или сбое загрузки постера с внешних CDN.
    - **Контекстное меню карточки**: `openCardContextMenu()`, `closeCardContextMenu()` — переключение статусов Кинориума («Буду смотреть», «Смотрю», «Просмотрено», «Не буду»), выставление оценок 1-10, копирование ссылки, быстрый предпросмотр (Quick Peek), сохранение в офлайн. Меню оптимизировано для A11y (`role="menuitem"`, навигация стрелками клавиатуры, позиционирование в границах viewport).
    - **Элемент постера и видеотизеры**: `createPosterCardElement()` — hover-превью трейлеров с задержкой 600 мс (`hoverPreviewTimer`), управление фокусом клавиатуры (Enter, Space), обработка кликов и вызов карточки фильма.
    - **Пагинация и отрисовка сетки**: `buildPageNumbers()`, `renderPosterCardsInto()` — пагинатор по 12 карточек с сохранением позиции страницы в `state.gridPages`.
  - Исходный файл `public/js/catalog.js` сократился с 4 049 до **3 313 строк** (-736 строк, суммарно сокращение с начала рефакторинга: с 4 797 до 3 313 строк, -1 484 строки / -31%).
  - Кэш-токен статики обновлен до `20261104v11`.
  - Все **107 из 107 тестов** `python3 run_tests.py` успешно пройдены за 14.7 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

## 11. Декомпозиция каталога: вынос Hero-баннера, авторотации и видеотизеров в `public/js/catalog-hero.js`  [Completed ✓]

- **Files:** `public/js/catalog-hero.js` (новый модуль), `public/js/catalog.js`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости через реэкспорты.
- **Details:**
  - Создан специализированный модуль [`public/js/catalog-hero.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog-hero.js) (568 строк), инкапсулирующий:
    - **Атмосферный видеотизер**: `scheduleHeroAmbientTeaser()`, `stopHeroAmbientTeaser()` — подгрузка трейлеров с YouTube/Rezka через AbortController, автовоспроизведение в беззвучном режиме, плавная проявка (`revealWhenClean`), кнопка включения/выключения звука (`hero-sound-toggle`) и скрытие перед показом рекомендаций YouTube.
    - **Управление таймером авторотации**: `startHeroAutoTimer()`, `stopHeroAutoTimer()` — интеллектуальный интервал 7.5 с с паузой при наведении курсора (`state.heroHovered`), открытых оверлейных модалках (`isAnyOverlayModalOpen`), активном не заглушенном тизере или свернутой вкладке.
    - **Переключение и отрисовка слайдов**: `stepHeroSlide()`, `renderHeroSlide()` — плавный фейдинг (`hero-fading`), адаптивный цвет подложки (`setAmbientColor`), динамические кнопки «Смотреть» (Rezka/Stremio/4K/офлайн), кнопка деталей «О фильме / сериале», загрузка метаданных на английском языке для EN-локали и точки навигации (`role="tab"`, `role="tablist"`).
    - **Формирование пула Hero-слайдов**: `renderHero()` — умный подбор широкоформатных тайтлов (`hasTrueWidescreenBackdrop`), чередование фильмов и сериалов, исключение повторения тайтла с предыдущего запуска (`LAST_HERO_ID_STORAGE_KEY`), сброс флага первого запуска (`resetHeroRecordedThisLaunch()`).
  - Исходный файл `public/js/catalog.js` сократился с 3 313 до **2 804 строк** (-509 строк, суммарно с начала рефакторинга: с 4 797 до 2 804 строк, -1 993 строки / -41.5%).
  - Кэш-токен статики обновлен до `20261104v12`.
  - Все **107 из 107 тестов** `python3 run_tests.py` успешно пройдены за 13.7 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

## 12. Декомпозиция каталога: вынос Центра уведомлений и Календаря релизов в `public/js/catalog-notifications.js`  [Completed ✓]

- **Files:** `public/js/catalog-notifications.js` (новый модуль), `public/js/catalog.js`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости через реэкспорты.
- **Details:**
  - Создан специализированный модуль [`public/js/catalog-notifications.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog-notifications.js) (507 строк), инкапсулирующий:
    - **Сбор уведомлений о сериях**: `collectNewEpisodeNotifications()` — сканирование `continueWatching` и сериалов Кинориума с флагом `has_new_episode`, вычисление ключей уникальности (`notifKey`), агрегация номеров сезонов и эпизодов.
    - **Нативные и Web десктопные алерты**: `maybeSendDesktopEpisodeAlerts()` — отправка нативных уведомлений через macOS WebKit bridge (`window.webkit.messageHandlers.cineflowNative.notifyEpisode`) и стандартный HTML5 Web Notifications API с защитой от дублирования (`NOTIF_DESKTOP_ALERTED_STORAGE_KEY`).
    - **Переключение вкладок поповера**: `switchNotificationsTab()` — доступные табы («Обновления» и «Календарь релизов») с атрибутами `role="tab"`, `aria-selected` и корректным tabindex.
    - **Календарь релизов**: `loadAndRenderReleaseCalendar()`, `renderReleaseCalendarDOM()`, `_formatCalendarAirDate()` — загрузка расписания на 14 дней назад и 45 дней вперед через `/api/calendar`, группировка по секциям «Скоро выходят» и «Недавно вышедшие», статус-чипы («Вышла», «В озвучке», «Просмотрено»), быстрый предпросмотр тайтлов.
    - **Колокольчик уведомлений в хедере**: `renderNotificationsBell()` — счетчик непрочитанных серий и обновлений приложения (`updaterStatus`), плашка обновления CineFlow с переходом в «О программе» и разметка списка уведомлений.
  - Исходный файл `public/js/catalog.js` сократился с 2 804 до **2 343 строк** (-461 строка, суммарно с начала рефакторинга: с 4 797 до 2 343 строк, **-2 454 строки / -51.1%**).
  - Кэш-токен статики обновлен до `20261104v13`.
  - Все **107 из 107 тестов** `python3 run_tests.py` успешно пройдены за 13.4 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

## 13. Декомпозиция каталога: вынос Movie Roulette и Command Palette в `public/js/catalog-discovery.js`  [Completed ✓]

- **Files:** `public/js/catalog-discovery.js` (новый модуль), `public/js/catalog.js`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости через реэкспорты.
- **Details:**
  - Создан специализированный модуль [`public/js/catalog-discovery.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog-discovery.js) (663 строки), инкапсулирующий:
    - **Рулетка фильмов (Movie Roulette)**: `openMovieRouletteModal()`, `closeMovieRouletteModal()`, `initMovieRouletteModal()`, `spinMovieRoulette()` — фильтрация по типу контента (фильм/сериал), настроению и минимальному рейтингу, анимация барабана со слотами карточек (`atv-roulette-spinning`), финальная карточка победителя с кнопками «Смотреть» и «Подробнее» (Quick Peek).
    - **Apple TV Command Palette (Cmd+K / Ctrl+K)**: `openCommandPalette()`, `closeCommandPalette()`, `initCommandPalette()` — быстрое открытие (`is-instant-open`), умный поиск по локальным тайтлам каталога, Hero-слайдам, персонам и онлайн-поиску через AbortController (`searchCommandPalette`), навигация стрелками (`stepCommandPaletteActive`) с поддержкой `aria-activedescendant`, быстрый переход к разделам «Буду смотреть», «Загрузки в дорогу», «История и статистика», «Рулетка», «Настройки».
  - Исходный файл `public/js/catalog.js` сократился с 2 343 до **1 734 строк** (-609 строк, суммарно с начала рефакторинга каталога: с 4 797 до 1 734 строк, **-3 063 строки / -63.9%**).
  - Кэш-токен статики обновлен до `20261104v14`.
  - Все **107 из 107 тестов** `python3 run_tests.py` успешно пройдены за 13.4 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

## 14. Декомпозиция каталога: вынос фильтрации, сортировки и сидирования в `public/js/catalog-filters.js`  [Completed ✓]

- **Files:** `public/js/catalog-filters.js` (новый модуль), `public/js/catalog.js`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости через реэкспорты.
- **Details:**
  - Создан специализированный модуль [`public/js/catalog-filters.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog-filters.js) (415 строк), инкапсулирующий:
    - **Интерфейс и бейджи фильтров**: `updateActiveFiltersBadge()`, `updateDynamicCatalogFilters()`, `renderActiveFilterChips()` — динамический пересчет доступных жанров и годов по текущему пулу тайтлов, активные чипы с кнопками быстрого сброса, отображение количества активных условий на кнопке шторки фильтров.
    - **Алгоритмы фильтрации**: `filterCatalogItemsByGenreAndYear()` — фильтрация по жанрам, диапазонам лет, сокрытие просмотренного (`state.hideWatched`), исключение сериалов без новых серий при фильтре друзей.
    - **Детерминированное перемешивание и сидирование**: `_hashItemKey()`, `seededShuffle()`, `rerollCatalogLaunchSeed()` — детерминированный хэш-генератор на основе `state.launchSeed` для единообразного перемешивания тайтлов между перезагрузками с возможностью перевыбора сида (`rerollCatalogLaunchSeed()`).
    - **Сортировка каталога**: `getCurrentlyFilteredItems()`, `sortCatalogItems()` — сортировка по пользовательской оценке, оценкам друзей, рейтингу Кинориума, году выпуска или дефолтной ранжированной выдаче с приоритетом основного провайдера.
  - Исходный файл `public/js/catalog.js` сократился с 1 734 до **1 372 строк** (-362 строки, суммарно с начала рефакторинга каталога: с 4 797 до 1 372 строк, **-3 425 строк / -71.4%**).
  - Кэш-токен статики обновлен до `20261104v15`.
  - Все **107 из 107 тестов** `python3 run_tests.py` успешно пройдены за 13.7 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

## 15. Декомпозиция каталога: вынос Media Resolver и Kinorium Helpers в `public/js/catalog-media-resolver.js`  [Completed ✓]

- **Files:** `public/js/catalog-media-resolver.js` (новый модуль), `public/js/catalog.js`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости через реэкспорты.
- **Details:**
  - Создан специализированный модуль [`public/js/catalog-media-resolver.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog-media-resolver.js) (763 строки), инкапсулирующий:
    - **Интерактивные быстрые действия с сериями**: `isEpisodeWatched()`, `toggleEpisodeWatchedFromCard()`, `openNextUnwatchedEpisode()`, `stepEpisodeWatchStatus()` — отметка серий в Кинориуме прямо из карточек каталога с синхронизацией локального кэша и интерфейса.
    - **Студии озвучки и предпочтения**: `getPreferredVoiceover()`, `setPreferredVoiceover()`, `resolveBestVoiceover()` — выбор и сохранение приоритетных студий озвучки (Red Head Sound, Дубляж, LostFilm, Кубик в Кубе и др.) с учетом истории профиля.
    - **Резолвинг метаданных и потоков**: `resolveCatalogItemMedia()`, `preloadCatalogItemStreams()`, `fetchKinoriumItemDetails()`, `enrichCatalogItemWithKinoriumData()` — предзагрузка источников, обогащение карточек персонализированными данными Kinorium и разрешение офлайн-стримов.
    - **Управление статусами Kinorium в карточках**: `toggleItemWatchStatus()`, `setItemRating()`, `updateKinoriumSectionCounters()` — синхронизация списков «Буду смотреть», «Смотрю», «Просмотрено», «Любимое».
  - Исходный файл `public/js/catalog.js` сократился с 1 372 до **677 строк** (-695 строк, суммарно с начала декомпозиции каталога: с 4 797 до 677 строк, **-4 120 строк / -85.9%**!). Теперь `catalog.js` стал сверхкомпактным модулем-координатором.
  - Кэш-токен статики обновлен до `20261104v16`.
  - Все **107 из 107 тестов** `python3 run_tests.py` успешно пройдены за 13.6 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 16. Декомпозиция потоковых обработчиков и медиа-прокси в `backend/routes/streaming.py`  [Completed ✓]

- **Files:** `backend/routes/streaming.py` (новый модуль), `backend/routes/__init__.py`, `server.py`, `tests/test_modular_routes.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости через реэкспорты и свойства `ServerContext`.
- **Details:**
  - Создан специализированный модуль [`backend/routes/streaming.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/routes/streaming.py) (1 461 строка), инкапсулирующий всю работу с передачей тяжёлого медиа-трафика:
    - **HLS и прямой стриминг с отказоустойчивостью границ (Media Edge)**: `handle_proxy_stream()`, `_open_resilient_media_upstream()`, `_connect_media_http()`, `_evict_voidboost_edge_and_mark_dead()` — автоматический перебор IP-адресов CDN, выявление мёртвых эджей, динамический DoH-резолвинг в обход локальных сетевых блокировок, проксирование и налету-переписывание HLS-манифестов (`_rewrite_hls_manifest_for_proxy()`).
    - **Потоковый Range-стриминг офлайн-загрузок**: `serve_offline_video_file()`, `handle_downloads_stream()` — поддержка стандарта HTTP 206 Partial Content с парсингом диапазонов байт (`Range: bytes=X-Y`), оптимизацией сокетов под низкую задержку (`_configure_low_latency_socket`), Content-Disposition и защитой детского профиля.
    - **Выдача субтитров и постеров**: `handle_downloads_sub()`, `handle_downloads_poster()` — стриминг WebVTT и безопасное определение MIME-типов растровых постеров (`_sniff_raster_image_type()`).
    - **Zero-copy FFmpeg Remuxing Pipeline**: `handle_remux_stream()`, `terminate_active_remux_procs()` — управление жизненным циклом фоновых процессов транскодирования, синхронизация потоков через очереди чанков, мгновенный ответ на HEAD-запросы без лишней нагрузки на процессор.
    - **Загрузка MP4 и конвертация VTT**: `handle_download_mp4()`, `handle_proxy_vtt()`, `handle_video_snapshot()` — загрузка видеофайлов (включая принудительный ремукс локальных торрент-потоков) и генерация скриншотов кадров.
    - **Диспетчеризация стриминга**: `dispatch_streaming_route()`, `STREAMING_EXACT_ROUTES`, `STREAMING_PREFIX_ROUTES` — единая точка входа для потоковых маршрутов как для GET, так и для HEAD запросов.
  - Исходный файл `server.py` сократился с 3 827 до **2 559 строк** (**-1 268 строк / -33.1%**), освободившись от сотен строк сложного низкоуровневого ввода-вывода.
  - В тестовый модуль `tests/test_modular_routes.py` добавлены тесты регистрации и HEAD-диспетчеризации стриминговых маршрутов (общее число тестов выросло со 107 до **109**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 13.8 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 17. Декомпозиция подсистем загрузок, ТВ-режима и трансляций из `public/js/features.js`  [Completed ✓]

- **Files:** `public/js/features-downloads.js` (новый модуль, 881 строка), `public/js/features-tv-mode.js` (новый модуль, 716 строк), `public/js/features-cast.js` (новый модуль, 452 строки), `public/js/features.js`, `tests/test_frontend_integrity.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости через реэкспорты и единый координатор.
- **Details:**
  - Создан специализированный модуль [`public/js/features-downloads.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/features-downloads.js) (881 строка):
    - **Офлайн-менеджер «Скачать в дорогу»**: `downloadCurrentPlayerStreamOffline()`, `enqueueBatchSeriesDownload()`, `openDownloadsModal()`, `closeDownloadsModal()`, `renderDownloadsModalList()` — сохранение фильмов и сериалов в MP4 с параллельной выкачкой оригинальных дорожек и русских/английских субтитров.
    - **Управление жизненным циклом загрузок**: `refreshDownloadsState()`, `startDownloadsPollingIfNeeded()`, `playOfflineDownload()`, `cancelOfflineDownload()`, `retryOfflineDownload()`, `deleteOfflineDownload()`, `openDownloadsFolder()`.
    - **Интеллектуальная автоматизация и квоты**: `syncDownloadsPrefsCheckboxes()`, `saveDownloadsPrefs()`, `sweepPendingDownloadCleanups()`, `syncDownloadsHeaderBadge()`, `_completedDownloadsSignature()`, `_syncOfflineSurfacesAfterDownloadsChange()` — автоудаление просмотренных серий, фоновая предзагрузка следующей серии и защита родительским PIN-кодом.
  - Создан модуль ТВ-навигации [`public/js/features-tv-mode.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/features-tv-mode.js) (716 строк):
    - **Пространственная D-Pad навигация**: `moveSpatialFocus()`, `setTvFocusedElement()`, `clearTvFocusClass()`, `collectTvNavigableElements()`, `getPreferredInitialTvFocus()` — поиск ближайшего фокусного элемента по 2D-координатам эвристикой евклидова расстояния с приоритетом направления.
    - **Геймпад и ТВ-пульт**: `startGamepadPollingLoop()`, `handleTvSpatialKeydown()`, `executeRemoteDpadCommand()`, `executeRemoteBackAction()` — автоопределение подключенного джойстика, сглаженный ввод, закрытие модальных окон по кнопке «Назад» (B / Back / Esc).
    - **Режим 10-foot UI**: `toggleTvMode()`, `setTvMode()`, `_syncTvFocusAfterSurfaceChange()` — автоматическое увеличение шрифтов, фокусных рамок и оптимизация для экранов телевизоров.
  - Создан модуль трансляций и связывания устройств [`public/js/features-cast.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/features-cast.js) (452 строки):
    - **AirPlay и DLNA Cast**: `supportsWebkitAirPlay()`, `triggerNativeAirPlayPicker()`, `castCurrentStreamToDlna()`, `stopActiveDlnaCast()`, `refreshTvDevices()` — вывод медиапотока на Smart TV (LG webOS, Samsung Tizen, Android TV, Apple TV).
    - **Мобильный пульт и QR-код**: `openTvCastModal()`, `closeTvCastModal()`, `renderTvCastModalUI()` — отображение вкладок трансляции и QR-кода для мгновенного управления воспроизведением с телефона через локальный WebSocket/HTTP брокер.
    - **Smart TV Deep Linking**: `parseInitialTvUrlParams()`, `applyPendingTvDeepLinkIfReady()` — запуск воспроизведения по прямым ссылкам и параметрам запуска.
  - Исходный файл `public/js/features.js` сократился с 3 679 до **1 854 строк** (**-1 825 строк / -49.6%**), сохранив только профили пользователей, родительский контроль Kids PIN и вход через Кинориум, выступая координатором всех фич.
  - Кэш-токен статики обновлен до `20261104v17`.
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 15.3 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 18. Декомпозиция профилей и родительского контроля в `public/js/features-profiles.js`  [Completed ✓]

- **Files:** `public/js/features-profiles.js` (новый модуль, 1 146 строк), `public/js/features.js`, `tests/test_frontend_integrity.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости через реэкспорты и свойства координатора.
- **Details:**
  - Создан специализированный модуль [`public/js/features-profiles.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/features-profiles.js) (1 146 строк):
    - **Управление профилями домохозяйства**: `applyProfilesPayload()`, `switchActiveProfile()`, `openProfilesModal()`, `closeProfilesModal()`, `renderProfilesModalUI()`, `saveProfileFromModal()`, `deleteProfileById()`.
    - **Аватары и цветовые темы**: `PROFILE_COLOR_SWATCHES`, `_profileColorClass()`, `getProfileAvatarUrl()`, `_renderAvatarInnerHtml()`, `_bindAvatarImgFallbacks()`, `_computeInitialsFromName()`.
    - **Родительский контроль (Kids Mode & PIN)**: `closeKidsPinModal()`, `promptKidsPinModal()`, `ensureKidsPinVerifiedForAdminAction()`, `requestKidsPinVerification()`, `isItemSafeForKidsClient()`, `_kidsPinTriggerEl`, `_activePinResolver` — надёжная валидация PIN-кода для закрытых секций, переключения взрослого профиля и настроек загрузок.
    - **Всплывающее меню и переключатель профилей**: `renderHeaderProfileSwitcher()`, `toggleProfilePopover()`, `closeProfilePopover()`, `reloadProfileLocalPlayerPrefs()`, `getProfileBaseLabel()`, `getProfileDisplayLabel()`, `resolveProfileKinoriumInfo()`.
  - Исходный файл `public/js/features.js` сократился с 1 854 до **828 строк** (-1 026 строк, суммарно с начала декомпозиции `features.js`: с 3 679 до 828 строк, **-2 851 строка / -77.5%**!). Теперь `features.js` содержит только нативный мост macOS (`syncNativeNowPlaying`), 1-клик вход Kinorium (`startOneClickKinoriumLogin`) и единый загрузчик `initRoadmapFeatures()`.
  - Кэш-токен статики обновлен до `20261104v18`.
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 13.2 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 19. Декомпозиция криптографического хранилища `LocalVaultCipher` в `backend/vault.py`  [Completed ✓]

- **Files:** `backend/vault.py` (новый модуль, 185 строк), `backend/storage_db.py`, `tests/test_v31_upgrades.py`, `tests/test_roadmap_features.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости через реэкспорты в `storage_db.py`.
- **Details:**
  - Создан специализированный модуль безопасности [`backend/vault.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/vault.py) (185 строк):
    - **Аутентифицированное шифрование в покое (Encryption at Rest)**: класс `LocalVaultCipher` реализует прозрачный поточный шифр HMAC-SHA256 CTR с контролем целостности через тег HMAC-SHA256 и 256-битный мастер-ключ установки в `data/.vault_key`.
    - **Надёжная генерация и хранение мастер-ключа**: атомарная запись через временный файл, fsync, жесткую ссылку (`os.link` / `os.replace` / `O_EXCL`), обработка сбоев concurrent access, защита от сбоев пробельных байт, резервное копирование поврежденных ключей.
    - **Безопасные POSIX-права доступа**: функция `set_private_file_permissions(path, is_dir)` гарантирует режим `0600` для файлов ключей и `0700` для директорий на Unix/macOS.
    - **Шифрование чувствительных учетных данных**: автоматическое шифрование токенов мобильного пульта (`remote_pair_token`), сессионных куки Kinorium (`session_cookie`) и API-ключей Real-Debrid (`debrid_api_key`) с префиксом `enc:v1:`.
  - Модуль [`backend/storage_db.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/storage_db.py) очищен от низкоуровневой криптографии, сохранив фокус исключительно на реляционной базе данных SQLite WAL, пуле соединений, кэшировании и миграциях.
  - Исходный файл `backend/storage_db.py` сократился с 1 083 до **926 строк** (**-157 строк**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 13.7 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 20. Декомпозиция сетевой безопасности и защиты от SSRF в `backend/net_security.py`  [Completed ✓]

- **Files:** `backend/net_security.py` (новый модуль, 324 строки), `backend/doh.py`, `tests/test_audit_fixes.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости через реэкспорты в `backend/doh.py`.
- **Details:**
  - Создан специализированный модуль сетевой безопасности [`backend/net_security.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/net_security.py) (324 строки):
    - **Anti-SSRF и валидация публичных IP**: `_is_valid_public_ip_addr()`, `_is_disallowed_hostname()`, `_resolve_verified_public_ips()`, `validate_safe_external_url()` — блокировка приватных диапазонов IPv4/IPv6, петлевых адресов (127.0.0.1, ::1), IPv6-mapped/Teredo туннелей, link-local (169.254.x.x) и внутренних доменов (.local, .internal, .lan).
    - **Безопасные HTTP-обработчики**: `_SafePublicHTTPConnection`, `_SafePublicHTTPHandler` — привязка сокетов исключительно к проверенным внешним публичным IP для исключения DNS-rebinding атак.
    - **Безопасные редиректы**: `_SafeRedirectHandler` — контроль схем (запрет HTTPS->HTTP downgrade), проверка хостов назначения редиректа, автоматическая зачистка чувствительных заголовков (`Authorization`, `Cookie`, `Proxy-Authorization`) при смене Origin.
    - **Потокобезопасный CookieJar и санитайзеры**: `_LockedCookieJar`, `_merge_cookie_header_strings()`, `_sanitize_header_str()` — защита от CRLF/Header Injection и гонок в cookies при многопоточных запросах.
  - Исходный модуль [`backend/doh.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/doh.py) сократился с 1 228 до **935 строк** (**-293 строки / -23.9%**), сохранив фокус на клиенте DNS-over-HTTPS (`DoHSplitNetworkClient`), SNI-транспорте (`_DoHHTTPSConnection`), провайдерах Quad9/Google/Cloudflare и Anubis PoW solver.
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 13.9 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 21. Декомпозиция парсеров персон и фильмографии в `backend/kinorium_persons.py`  [Completed ✓]

- **Files:** `backend/kinorium_persons.py` (новый модуль, 310 строк), `backend/kinorium.py`, `tests/test_audit_fixes.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости методов `KinoriumService`.
- **Details:**
  - Создан специализированный модуль парсинга персон [`backend/kinorium_persons.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium_persons.py) (310 строк):
    - **Поиск людей и фильмов через API Кинориума**: функция `parse_search_persons_and_movies()` — разбор JSON-ответа `/handlers/Search/?str=...`, разделение сущностей на персон (`persona`) и фильмы (`movie`), очистка имен, привязка аватаров и постеров высокого разрешения (`/persona/300/`, `/movie/600/`), ранжирование результатов поиска.
    - **Парсинг профилей персон и фильмографии**: функция `parse_person_filmography_html()` — извлечение структурированных метаданных `schema.org/Person` из `application/ld+json` и meta-тегов (биография, форматированная дата рождения с русскими месяцами, место рождения, фото), выявление ролей карьеры (Режиссёр, В ролях, Сценарист, Продюсер, Композитор, Оператор).
    - **Организация секций работ**: парсинг DOM-блоков `headlines_type-*`, фильтрация невышедших анонсов без рейтингов, объединение оценок Kinorium и IMDb, определение типа медиа (фильм/сериал), разделение основных актерских ролей и камео («играет самого себя»).
  - В сервисе [`backend/kinorium.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium.py) методы `search_persons_and_movies()` и `fetch_person_filmography()` переведены на лаконичную диспетчеризацию с сохранением потокобезопасного кэширования (`_person_lock`, `_person_search_cache`, `_person_filmog_cache`) и сетевого взаимодействия.
  - Исходный файл `backend/kinorium.py` сократился с 8 936 до **8 629 строк** (**-307 строк**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 22. Декомпозиция кураторского каталога и метаданных провайдеров в `backend/curated_catalog.py`  [Completed ✓]

- **Files:** `backend/curated_catalog.py` (новый модуль, 859 строк), `backend/aggregator.py`, `tests/test_audit_fixes.py`, `tests/test_roadmap_features.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости атрибутов `UnifiedCinemaAggregator.PROVIDERS_META` и `CURATED_CATALOG`.
- **Details:**
  - Создан специализированный модуль каталога [`backend/curated_catalog.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/curated_catalog.py) (859 строк):
    - **Метаданные стриминговых сервисов**: словарь `PROVIDERS_META` с описанием 9 платформ (HDRezka, Apple TV+, Netflix, Prime Video, Disney+, Max, Player.pl, CANAL+ online, 4K Remux), их типов интеграции (native / drm_webview), поддержкой 4K HDR и статусами авторизации.
    - **Флагманский кураторский каталог**: список `CURATED_CATALOG` из сотен фильмов и сериалов с локализованными постерами высокого разрешения, рейтингами Kinorium/IMDb, фоновыми артами 1080p, жанрами, годами выпуска и маппингом офферов платформ.
  - Исходный класс [`backend/aggregator.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/aggregator.py) освободился от сотен строк статических структур данных и сократился с 4 618 до **3 771 строки** (**-847 строк / -18.3%**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 23. Декомпозиция клиента JustWatch GraphQL и резолвера офферов в `backend/justwatch.py`  [Completed ✓]

- **Files:** `backend/justwatch.py` (новый модуль, 584 строки), `backend/aggregator.py`, `tests/test_audit_fixes.py`, `tests/test_roadmap_features.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости интерфейса `UnifiedCinemaAggregator`.
- **Details:**
  - Создан специализированный клиент JustWatch [`backend/justwatch.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/justwatch.py) (584 строки):
    - **Клиент JustWatch GraphQL API**: класс `JustWatchClient` инкапсулирует запросы `popularTitles` через GraphQL-эндпоинт JustWatch (`https://apis.justwatch.com/graphql`) с фильтрацией по странам (Польша, страны ЕС) и типам контента (фильмы `MOVIE`, сериалы `SHOW`).
    - **Потокобезопасный кэш провайдеров и офферов**: потокобезопасные структуры `_provider_jw_cache` (TTL 15 минут) и `_provider_offers_cache` (TTL 30 минут) с автоматическим вытеснением устаревших записей при превышении лимитов.
    - **Каталог провайдеров (`fetch_by_provider`)**: параллельный опрос новинок фильмов и сериалов через `ThreadPoolExecutor` для платформ Netflix, Apple TV+, Prime Video, Disney+, Max и Player.pl с маппингом пакетов JustWatch (`nfx`, `atp`, `prv`, `dnp`, `mxx/hbm`, `plp`) и дедупликацией ID.
    - **Интеллектуальный резолвер доступности (`resolve_provider_offers_for_title`)**: поиск доступных легальных стриминговых офферов для любого тайтла с многофакторным скорингом (сопоставление локализованных и оригинальных названий, токенов, типа медиа и года выпуска с дельтой ±1-2 года), защищающим от привязки чужих карточек.
    - **Полнотекстовый поиск (`search_poland`)** и парсинг метаданных JustWatch (постеры WebP `s592`, бэкдропы `s1920`, рейтинги IMDb и Rotten Tomatoes, канонические жанры на русском языке).
  - В классе [`backend/aggregator.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/aggregator.py) методы `_fetch_justwatch_by_provider()`, `resolve_provider_offers_for_title()`, `_search_justwatch_poland()` и `_query_justwatch_graphql()` делегированы в `self.justwatch`, а файл сократился с 3 771 до **3 308 строк** (**-463 строки**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 13.6 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 24. Декомпозиция английской локализации и транслитерации в `backend/translit_en.py`  [Completed ✓]

- **Files:** `backend/translit_en.py` (новый модуль, 722 строки), `backend/en_metadata.py`, `tests/test_en_metadata.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости через реэкспорты в `backend/en_metadata.py`.
- **Details:**
  - Создан специализированный модуль локализации и транслитерации [`backend/translit_en.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/translit_en.py) (722 строки):
    - **Таблицы транслитерации и регулярные выражения**: словарь `_CYR_TO_LAT` (с поддержкой украинских и белорусских букв і, ї, є, ґ), скомпилированный regex `_CYRILLIC_RE`, проверки `has_cyrillic()` и функция `transliterate_cyrillic()`.
    - **Фонетическое сопоставление имён**: функции `_phonetic_key()`, `_consonant_skeleton()` и `_names_match_ru_en()` — нечёткое сопоставление англоязычных и русскоязычных имён создателей/актеров с учётом инверсии фамилий и имён восточноазиатских деятелей (Пак Чхан-ук / Chan-wook Park) и защитой от ложных совпадений по общему имени (Christopher Nolan vs Christopher Walken).
    - **Словари географии и кинематографа**: сопоставление стран `ISO_COUNTRIES_EN` (70 стран), `RU_COUNTRIES_TO_EN` (78 стран), канонических жанров `RU_GENRES_TO_EN` (32 жанра), профессий карьеры `_RU_CAREER_TO_EN` и месяцев в родительном падеже `_RU_MONTHS_GENITIVE_TO_EN`.
    - **Утилиты перевода метаданных**: функции `translate_career_role_en()`, `translate_birth_date_en()`, `translate_birth_place_en()` (с маппингом городов мира) и `translate_kinorium_extra_desc_to_en()` (разбор и перевод сводной плашки Кинориума с хронометражем, странами и создателями).
    - **Резолверы оригинальных медиа-ассетов**: `resolve_original_poster_url()`, `is_localized_non_en_image_url()`, `resolve_original_backdrop_url()` (бесшовный fallback на IMDb Metahub, en-images.kinorium и очистка от польских slug-постеров) и `build_english_cast_people()` (формирование 100% английского каста с сохранением ссылок и фото из Кинориума).
  - Исходный модуль [`backend/en_metadata.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/en_metadata.py) сократился с 1 696 до **1 014 строк** (**-682 строки / -40.2%**), сфокусировавшись исключительно на сетевом резолвере `EnglishMetadataResolver`, JustWatch US GraphQL, Cinemeta Stremio и кэше SQLite WAL.
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 13.8 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 25. Декомпозиция автозапуска ОС и статического сервера в `backend/autostart.py` и `backend/routes/static_files.py`  [Completed ✓]

- **Files:** `backend/autostart.py` (новый модуль, 178 строк), `backend/routes/static_files.py` (новый модуль, 209 строк), `backend/routes/__init__.py`, `server.py`, `tests/test_server_live.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API сервера и тестов.
- **Details:**
  - Создан специализированный модуль автозапуска [`backend/autostart.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/autostart.py) (178 строк):
    - **macOS LaunchAgent**: управление `~/Library/LaunchAgents/app.cineflow.cinema.plist` с фоновым флагом `--launchd`, логированием и командами `launchctl unload/load`.
    - **Windows Registry Run**: управление веткой реестра `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (`CineFlow.exe --background` или `runtime/pythonw.exe server.py --launchd`).
    - Кроссплатформенные проверки `is_system_autostart_supported()`, `is_system_autostart_enabled()` и метод `set_system_autostart()`.
  - Создан специализированный обработчик статики [`backend/routes/static_files.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/routes/static_files.py) (209 строк):
    - **Защита от directory traversal**: безопасный маппинг путей `resolve_safe_public_static_path()` с проверкой `commonpath`.
    - **In-memory gzip-кэширование и сильные ETags**: `load_cached_static_file()`, `get_static_file_etag()` и `lookup_static_etag()`.
    - **Единая доставка GET и HEAD**: функция `serve_static_file()` с автоматической поддержкой 304 Not Modified, `If-None-Match`, `Cache-Control: immutable` для версионированных ассетов (`?v=`), `no-cache` для SPA-шаблона и динамической трансформацией `index.html` (инъекция атрибутов языка интерфейса и статуса первичной настройки).
  - Устранено более 150 строк дублирующегося кода обработки статики между `do_HEAD` и `do_GET` в `server.py`.
  - Исходный файл `server.py` сократился с 2 559 до **2 267 строк** (**-292 строки**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 14.1 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 26. Унификация сокетов anti-SSRF и безопасного HTTP-транспорта в `backend/net_security.py`  [Completed ✓]

- **Files:** `backend/net_security.py`, `server.py`, `tests/test_audit_fixes.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API и тестов.
- **Details:**
  - В модуль сетевой безопасности [`backend/net_security.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/net_security.py) (651 строка) перенесены и консолидированы все компоненты защищённого сокетного уровня:
    - **Строгая валидация публичных IP**: `is_strictly_public_ip_obj()` с блокировкой CGNAT (`100.64.0.0/10`), Benchmark (`198.18.0.0/15`), Loopback, Link-Local, Private, Multicast, Unspecified и Reserved IPv4/IPv6 диапазонов (включая IPv4-mapped, 6to4 и Teredo туннели).
    - **Анти-SSRF резолвер и сокетное связывание**: `connect_strictly_public_socket()` с двукратной проверкой адреса (при DNS-резолвинге и на уровне подключённого `getpeername()`) для устранения уязвимостей типа DNS rebinding race conditions (TOCTOU).
    - **Кастомные HTTP/HTTPS соединения и обработчики**: `SafePublicHTTPConnection`, `SafePublicHTTPSConnection`, `SafePublicHTTPHandler`, `SafePublicHTTPSHandler`.
    - **Защита медиа-потоков и перенаправлений**: `is_allowed_media_source_url()` с кэшированием вердиктов DNS (`_ALLOWED_MEDIA_HOST_CACHE`) и гранулированным доступом к петлевому адресу локального TorrServer (`/stream`, `/play` разрешены, а эндпоинты `/shutdown`, `/settings`, `/torrents` блокируются).
    - **Контроллер безопасных перенаправлений**: `SafePublicRedirectHandler` и фасад `open_safe_public_url()` с поддержкой безопасных публичных HTTP/HTTPS прокси.
  - Из `server.py` удалено более 240 строк прямого низкоуровневого кода сокетов и HTTP-соединений; оставлены лаконичные делегаты и реэкспорты для бесшовной обратной совместимости.
  - Исходный файл `server.py` сократился с 2 267 до **2 061 строки** (**-206 строк**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 13.7 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 27. Вынос резолвинга оффлайн-стримов в `backend/downloads.py`  [Completed ✓]

- **Files:** `backend/downloads.py`, `server.py`, `tests/test_roadmap_features.py`, `tests/test_offline_download_resumption.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API и тестов.
- **Details:**
  - В модуль фоновых загрузок [`backend/downloads.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/downloads.py) перенесена комплексная функция резолвинга медиа-потоков для оффлайн-просмотра `resolve_offline_episode_stream()`:
    - **Интеграция с HDRezka**: автоматическое сопоставление сезонов и серий, проверка карт доступности эпизодов (`seasons_map`, `prem_episodes_map`), подбор альтернативных студий озвучки по названию (`want_studio`) при смене идентификатора переводчика.
    - **Резервные аудиодорожки и remux**: обращение к `backup_stream_engine` и `stremio_engine` для поиска оригинального звука (английский переводчик `238`, пометки "оригинал/original" или premium-блокировки) с извлечением метаданных ремукса (`video_codec`, `audio_codec`, `channels`, `audio_index`, `duration_sec`).
    - **Субтитры и проксирование**: автоматическое дополнение внешними субтитрами из Stremio (`get_subtitles_only`) и корректная обработка Voidboost loopback URL / API remux stream.
  - Из `server.py` удалено 160 строк монолитного кода резолвинга, оставлен лаконичный фасад `_resolve_offline_episode_stream(snapshot)`.
  - Исходный файл `server.py` сократился с 2 061 до **1 905 строк** (**-156 строк**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 13.5 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 28. Вынос вспомогательных функций каталога, описаний и проверки Kids-фильтра в `backend/catalog_helpers.py`  [Completed ✓]

- **Files:** `backend/catalog_helpers.py` (новый модуль, 280 строк), `server.py`, `tests/test_audit_fixes.py`, `tests/test_modular_routes.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API и тестов.
- **Details:**
  - Создан специализированный модуль утилит каталога [`backend/catalog_helpers.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/catalog_helpers.py) (280 строк):
    - **Парсинг magnet-ссылок (`extract_magnet_display_name`)**: безопасное извлечение человекочитаемого названия торрента из параметра `dn`.
    - **Анализ и фолбэк описаний (`is_stub_description`, `lookup_fallback_description`)**: фильтрация заглушек ("Смотрите онлайн...", дубли названий, короткие строки) и каскадный поиск подробных синопсисов по кэшам Кинориума, удалённым закладкам и кэшу агрегатора.
    - **Верификация метаданных для детского профиля (`build_trusted_item_for_kids_check`)**: агрегация жанров, возрастных ограничений и синопсисов из надежных источников для бескомпромиссной фильтрации контента в режиме Kids Safe.
    - **Проверка будущих эпизодов (`is_known_episode_unreleased`)**: сопоставление даты релиза через расписание Кинориума и английские метаданные (Stremio/Cinemeta/JustWatch).
    - **Очистка метаданных для английского интерфейса (`scrub_cyrillic_episode_dicts`)**: удаление кириллических строк из названий и описаний эпизодов.
    - **Редакция сторонних дополнений Stremio (`redact_stremio_addons_for_client`)**: маскирование приватных манифест-URL для удалённых и LAN-клиентов.
  - Из `server.py` удалено около 200 строк монолитных вспомогательных функций, оставлены лаконичные делегаты и реэкспорты для сохранения контрактов тестов и `ServerContext`.
  - Исходный файл `server.py` сократился с 1 905 до **1 754 строк** (**-151 строка**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 13.3 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 29. Вынос логики сохранения/загрузки настроек сервера и региональных профилей в `backend/settings_manager.py`  [Completed ✓]

- **Files:** `backend/settings_manager.py` (новый модуль, 240 строк), `server.py`, `tests/test_audit_fixes.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API и тестов.
- **Details:**
  - Создан специализированный менеджер настроек и региональных политик [`backend/settings_manager.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/settings_manager.py) (240 строк):
    - **Класс `ServerSettingsManager`**: инкапсулирует чтение/запись `server_settings.json` и SQLite таблицы `settings`, шифрование чувствительных учетных данных (Debrid API key, pairing token) через `Vault`, атомарную запись через временный файл с проверкой POSIX/Windows прав доступа (`set_private_file_permissions`).
    - **Региональные профили и политика обхода блокировок (`apply_user_country`)**: синхронная настройка параметров `DoHSplitNetworkClient`, `HDRezkaClient` (подмена региона, приоритет зеркал), `UnifiedCinemaAggregator`, `KinoriumService` (локализация интерфейса и списков) и `BackupStreamingEngine` (P2P strict-политика в странах ЕС).
    - **Генерация полезной нагрузки сопряжения пультов (`build_remote_pairing_payload`)**: расчет QR-кода SVG и ссылки мобильного пульта с привязкой к IP в локальной сети.
    - **Локализация сообщений и нормализация языка (`norm_app_lang`, `format_multilang_msg`)**.
  - Из `server.py` удалено 184 строки процедурного кода настроек; подключен экземпляр `settings_manager` с лаконичными делегатами.
  - Исходный файл `server.py` сократился с 1 754 до **1 600 строк** (**-154 строки**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 13.7 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 30. Вынос класса-адаптера `ServerContext` в `backend/routes/context.py`  [Completed ✓]

- **Files:** `backend/routes/context.py` (новый модуль, 206 строк), `backend/routes/__init__.py`, `server.py`, `tests/test_modular_routes.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API и тестов.
- **Details:**
  - Создан специализированный адаптер контекста роутов [`backend/routes/context.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/routes/context.py) (206 строк):
    - **Класс `ServerContext`**: инкапсулирует предоставление всех 53 сервисов, синглтонов, защитных механизмов, утилит парсинга и кэшей для модульных обработчиков `backend/routes`.
    - **Гибкий механизм разрешения зависимостей**: поддержка прямого словаря провайдеров (`_providers`), ленивых функций (`__cineflow_lazy__`), общего коллбэка поставщика (`_provider_fn`), а также fallback-интерфейсов `__getattr__`, `__getitem__`, `__contains__` и безопасного метода `get(name, default=None)`.
    - **Строгая типизация свойств**: 53 типизированных `@property` метода с автодополнением для IDE и статических анализаторов.
  - Реэкспорт `ServerContext` добавлен в `backend/routes/__init__.py`.
  - В `server.py` удалено более 220 строк громоздкого описания `class ServerContext`, заменённого на элегантный 15-строчный резолвер `_resolve_server_context(name)` и инстанс `SERVER_CONTEXT = ServerContext(provider_fn=_resolve_server_context)`.
  - Исходный файл `server.py` сократился с 1 600 до **1 403 строк** (**-197 строк**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 13.5 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 31. Вынос демонов, автоматизации окон и жизненного цикла сервера в `backend/server_lifecycle.py`  [Completed ✓]

- **Files:** `backend/server_lifecycle.py` (новый модуль, 269 строк), `server.py`, `tests/test_server_live.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API и тестов.
- **Details:**
  - Создан специализированный модуль жизненного цикла и автоматизации [`backend/server_lifecycle.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/server_lifecycle.py) (269 строк):
    - **Класс `CinemaThreadingHTTPServer`**: многопоточный HTTP-сервер с автоматической демонизацией рабочих потоков, очередью запросов (`128`), тайм-аутом (`10.0s`), переиспользованием адреса сокета (`allow_reuse_address = True`) и кэшированием `server_name` / `server_port`.
    - **Автоматизация окон macOS через AppleScript / System Events**: `trigger_macos_browser_fullscreen_key()` (полноэкранный режим через `key code 3` с поддержкой всех популярных браузеров) и `trigger_macos_browser_pip_key()` (переключение PiP для движков Gecko и Chromium/WebKit).
    - **Фоновые демоны-сторожа**:
      - `start_lan_ip_watchdog_daemon()`: мониторинг изменения IPv4-адреса локальной сети и автоматический ребинд LAN-листенера при переподключениях Wi-Fi.
      - `start_background_watching_sync_daemon()`: фоновое обновление серий и статусов Кинориума и HDRezka с защитой от запуска во время активного стриминга (дельта `LAST_STREAM_ACTIVITY_TS < 25.0s`).
    - **Контроль занятости портов и предотвращение дубликатов**: `is_port_already_serving_cineflow()` и `stop_stale_cineflow_server_on_port()` для корректной работы LaunchAgent `--launchd`, WebView2 и инсталляторов.
    - **Корректное завершение (`install_graceful_termination_handlers`)**: перехват сигналов `SIGTERM`, `SIGHUP` и `SIGBREAK` с конвертацией в `SystemExit` для гарантированного выполнения cleanup-блоков (остановка TorrServer, процессов ремукса FFmpeg и фоновых загрузок).
  - В `server.py` удалено около 200 строк процедурного кода; добавлены лаконичные функции-делегаты для сохранения всех существующих интерфейсов.
  - Исходный файл `server.py` сократился с 1 403 до **1 229 строк** (**-174 строки**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 13.9 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 32. Вынос HTTP-обработчика `CinemaRequestHandler` в `backend/request_handler.py`  [Completed ✓]

- **Files:** `backend/request_handler.py` (новый модуль, 615 строк), `server.py`, `tests/test_server_live.py`, `tests/test_audit_fixes.py`, `tests/test_roadmap_features.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API и тестов.
- **Details:**
  - Создан специализированный обработчик запросов [`backend/request_handler.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/request_handler.py) (615 строк):
    - **Класс `CinemaRequestHandler`**: инкапсулирует логирование запросов, защиту от DNS-rebinding (`_is_allowed_host_header`, `_reject_bad_host`), верификацию Origin и CORS (`_is_trusted_origin`, `_get_cors_origin_header`, `_send_security_headers`).
    - **Управление сессиями и правами**: проверки доступа локальной сети к административным функциям (`_require_authorized_client_if_lan`) и PIN-кода детского профиля с блокировкой по частоте попыток (`_require_kids_pin_if_locked`).
    - **Потоковая передача и маршрутизация**: единая обработка `do_OPTIONS`, `do_HEAD`, `do_GET` и `do_POST` с делегированием в модульные таблицы `backend.routes` (`dispatch_get_route`, `dispatch_post_route`, `dispatch_streaming_route`, `_serve_static_file`).
    - **Безопасная инъекция зависимостей**: метод `CinemaRequestHandler.set_dependencies(...)` для связывания с `SERVER_CONTEXT`, статическим сервером и логированием без конфликтов привязки методов Python.
  - В `server.py` удалено 480 строк монолитного обработчика HTTP.
  - Исходный файл `server.py` сократился с 1 229 до **754 строк** (**-475 строк / -38.6%**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 14.0 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 33. Консолидация статуса системы и управления LAN-слушателем в `backend/system_service.py`  [Completed ✓]

- **Files:** `backend/system_service.py` (новый модуль, 195 строк), `server.py`, `tests/test_server_live.py`, `tests/test_audit_fixes.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API и тестов.
- **Details:**
  - Создан специализированный сервис мониторинга и сетевого взаимодействия [`backend/system_service.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/system_service.py) (195 строк):
    - **Сборка полезной нагрузки `/api/system/status` (`build_system_status_payload`)**: расчет времени непрерывной работы, агрегация сетевых адресов (Localhost, LAN IP, порт), генерация SVG QR-кода для мгновенного подключения мобильного пульта, статус обновлений, профилей, автозапуска, памяти, состояния движка транскодирования и авторизации в Кинориуме.
    - **Управление сетевым слушателем локальной сети (`sync_lan_listener`)**: потокобезопасная активация и отключение отдельного экземпляра `CinemaThreadingHTTPServer` на внешнем Wi-Fi/LAN IP-интерфейсе с очисткой устаревших сокетов и защитой от конфликтов портов.
    - **Фасадный класс `SystemService`**: инкапсулирует вызовы системного мониторинга и сетевых интерфейсов.
  - Из `server.py` удалено более 50 строк монолитного процедурного кода.
  - Исходный файл `server.py` сократился с 754 до **709 строк** (**-45 строк**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 15.6 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 34. Вынос утилит начальной загрузки в `backend/bootstrap.py`, динамического трансформера `index.html` и главного цикла `run_cineflow_server`  [Completed ✓]

- **Files:** `backend/bootstrap.py` (новый модуль, 130 строк), `backend/routes/static_files.py`, `backend/server_lifecycle.py`, `server.py`, `tests/test_audit_fixes.py`, `tests/test_server_live.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API и тестов.
- **Details:**
  - Создан специализированный модуль инициализации среды [`backend/bootstrap.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/bootstrap.py) (130 строк):
    - **Разрешение путей (`resolve_runtime_paths`)**: вычисление `BASE_DIR`, `PUBLIC_DIR`, `DATA_DIR`, `SETTINGS_PATH` и `BIN_DIR`.
    - **Безопасная переконфигурация потоков ввода-вывода (`ensure_safe_std_streams`)**: защита от `None` в `sys.stdout`/`sys.stderr` при запуске через `pythonw.exe` или на нестандартных кодировках Windows с фолбэком в `data/cineflow.log`.
    - **Неблокирующий логгер (`make_safe_logger`)**: создание безопасного потокового регистратора с автоматическим сбросом буфера и подавлением ошибок кодировки.
    - **Безопасный парсинг чисел и query-параметров (`safe_int`, `safe_float`, `qs_int`, `qs_float`)**.
    - **Регистрация бинарных утилит (`ensure_bin_in_path`)**: автоматическое добавление `backend/bin` в переменную окружения `PATH`.
  - В модуль [`backend/routes/static_files.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/routes/static_files.py) вынесены `transform_index_html()` и фабрика `make_index_html_transformer()` для динамической инъекции языка интерфейса и признака первичной настройки в тег `<html>` SPA.
  - В модуль [`backend/server_lifecycle.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/server_lifecycle.py) перенесён полный цикл запуска сервера `run_cineflow_server()`: очистка устаревших инстансов, связывание сокета, запуск демонов, вывод стартового баннера, регистрация обработчиков завершения и гарантированное освобождение ресурсов (TorrServer, remux-процессы, оффлайн-загрузки) в блоке `finally`.
  - В `server.py` удалено более 80 строк повторяющегося кода.
  - Исходный файл `server.py` сократился с 709 до **623 строк** (**-86 строк**, суммарное сокращение с исходного состояния составляет **-1 936 строк / -75.6%**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 17.9 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 35. Консолидация фабрики сервисов и контейнера зависимостей в `backend/app_factory.py`  [Completed ✓]

- **Files:** `backend/app_factory.py` (новый модуль, 205 строк), `server.py`, `tests/test_audit_fixes.py`, `tests/test_server_live.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API и тестов.
- **Details:**
  - Создан специализированный модуль сборки графа сервисов [`backend/app_factory.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/app_factory.py) (205 строк):
    - **Контейнер `CineFlowServices`**: типизированный датакласс-контейнер, объединяющий все ключевые синглтоны приложения (`storage_db`, `net_client`, `rezka_client`, `profile_manager`, `kinorium_service`, `skip_intro_engine`, `backup_stream_engine`, `remux_engine`, `stremio_engine`, `subtitle_service`, `remote_broker`, `en_meta_resolver`, `aggregator`, `download_manager`, `dlna_manager`, `kinorium_auth_manager`, `app_updater`, `settings_manager`), а также общие словари состояния (`APP_PREFS`, `SERVER_RUNTIME`, кэш фотографий персон).
    - **Фабричная функция `create_cineflow_services()`**: инкапсулирует строгий порядок создания и взаимного связывания сервисов, применение профилей, регистрацию хуков очистки `atexit` и автоматическую загрузку сохранённых настроек из SQLite и JSON.
    - **Резолвинг оффлайн-стримов**: внутренняя функция `_resolve_offline_stream` вынесена внутрь фабрики и передаётся напрямую в конструктор `OfflineDownloadManager`.
  - В `server.py` удалено более 85 строк процедурной инициализации синглтонов.
  - Исходный файл `server.py` сократился с 623 до **538 строк** (**-85 строк**, суммарное сокращение с исходного состояния составляет **-2 021 строка / -79.0%**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 25.5 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 36. Прямое подключение `ServerContext` к модульным утилитам и устранение функций-прокладок в `server.py`  [Completed ✓]

- **Files:** `backend/routes/context.py` (расширение до 450 строк), `server.py`, `tests/test_modular_routes.py`, `tests/test_roadmap_features.py`, `tests/test_audit_fixes.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API и тестов.
- **Details:**
  - В класс [`backend/routes/context.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/routes/context.py) добавлены автономные реализации свойств с каскадным разрешением:
    - **Каталог и фильтрация контента**: свойства `build_trusted_item_for_kids_check`, `lookup_fallback_description`, `is_known_episode_unreleased`, `is_stub_description`, `extract_magnet_display_name`, `scrub_cyrillic_episode_dicts`, `redact_stremio_addons_for_client` обращаются напрямую к модулю `backend/catalog_helpers.py` с автоматической передачей инстансов `aggregator`, `kinorium_service`, `stremio_engine` и `en_meta_resolver`.
    - **Интеграция с рабочим столом macOS**: свойства `trigger_macos_browser_fullscreen_key` и `trigger_macos_browser_pip_key` вызывают нативные AppleScript-процедуры из `backend/server_lifecycle.py`.
    - **Сетевая безопасность и прокси**: свойства `is_allowed_media_source_url` и `open_safe_public_url` напрямую инкапсулируют проверки из `backend/net_security.py`.
    - **Поддержка динамического контейнера `services`**: `ServerContext` теперь принимает инстанс `CineFlowServices` в конструкторе, проверяя сначала провайдеры переопределения (для поддержки патчей в тестах вида `server.download_manager = temp_dm`), затем `provider_fn`, затем объект `services`, и в финале встроенные модульные реализации.
  - Из `server.py` удалено 107 строк монолитных функций-прокладок (`_extract_magnet_display_name`, `_is_stub_description`, `_lookup_fallback_description`, `_build_trusted_item_for_kids_check`, `_is_known_episode_unreleased`, `_scrub_cyrillic_episode_dicts`, `_trigger_macos_browser_fullscreen_key`, `_trigger_macos_browser_pip_key`, `_start_lan_ip_watchdog_daemon`, `_start_background_watching_sync_daemon`, `_is_port_already_serving_cineflow`, `_stop_stale_cineflow_server_on_port`).
  - Исходный файл `server.py` сократился с 538 до **431 строки** (**-107 строк**, суммарное сокращение с исходного состояния составляет **-2 128 строк / -83.2%**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 17.8 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 37. Консолидация фасада сетевой безопасности, автозапуска и сокращение `server.py` до компактного декларативного оркестратора [Completed ✓]

- **Files:** `server.py` (сокращен до 329 строк), `tests/test_audit_fixes.py`, `tests/test_roadmap_features.py`, `tests/test_modular_routes.py`, `tests/test_server_live.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API и тестов.
- **Details:**
  - Оптимизирован и очищен модуль [`server.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/server.py):
    - **Прямой импорт и реэкспорт функций автозапуска**: функции `set_macos_autostart`, `set_windows_autostart`, `set_system_autostart`, `get_system_autostart_status`, `is_system_autostart_supported`, `_build_windows_autostart_command` импортируются напрямую из [`backend/autostart.py`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/autostart.py), устраняя избыточные проксирующие функции.
    - **Однострочное делегирование операций настроек**: методы `_norm_app_lang`, `apply_user_country`, `load_persisted_server_settings`, `_msg`, `save_persisted_server_settings`, `_build_remote_pairing_payload` делегируются напрямую в экземпляр `settings_manager`.
    - **Очистка неиспользуемых импортов**: удалены неиспользуемые импорты стандартной библиотеки (`atexit`, `gzip`, `http.client`, `ipaddress`, `queue`, `re`, `socket`, `socketserver`, `ssl`, `subprocess`, `mimetypes`, `BaseHTTPRequestHandler`, `ThreadingHTTPServer`), так как сетевой цикл, сокеты и многопоточный сервер полностью инкапсулированы в `backend/server_lifecycle.py` и `backend/request_handler.py`.
    - **Сохранение контрактных реэкспортов для тестов**: сохранены все тестовые точки входа (`_is_allowed_media_source_url`, `_open_safe_public_url`, `_redact_stremio_addons_for_client`, `convert_any_subtitle_to_webvtt`, `DesktopRemoteBroker`, `DEAD_MEDIA_EDGE_IPS`, `MEDIA_EDGE_LOCK`, `VOIDBOOST_EDGE_CACHE`, `_build_windows_autostart_command`), а также обязательный декларативный маршрутный маркер в комментариях `# "/api/subtitles/translate"`.
  - Исходный файл `server.py` сократился с 431 до **329 строк** (**-102 строки**, суммарное сокращение с исходных 2 559 строк составляет **-2 230 строк / -87.1%**).
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 14.6 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 38. Распутывание циклических связей и оптимизация модульного графа каталога и плеера [Completed ✓]

- **Files:** `public/js/catalog-cards.js`, `public/js/catalog-hero.js`, `public/js/catalog-notifications.js`, `public/js/catalog-discovery.js`, `public/js/catalog-filters.js`, `public/js/catalog-shelves.js`, `public/js/catalog-media-resolver.js`, `public/js/player-autoplay.js`, `public/js/player-seasons.js`, `public/js/player-ui-controls.js`, `public/js/player-streams.js`, `tests/test_frontend_integrity.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API и тестов.
- **Details:**
  - Проведён глубокий аудит связей клиентского модульного графа ES-модулей каталога и видеоплеера:
    - **Устранение циклических ссылок каталога**: подмодули [`public/js/catalog-cards.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog-cards.js), [`public/js/catalog-hero.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog-hero.js), [`public/js/catalog-notifications.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog-notifications.js), [`public/js/catalog-discovery.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog-discovery.js), [`public/js/catalog-filters.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog-filters.js), [`public/js/catalog-shelves.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog-shelves.js), [`public/js/catalog-media-resolver.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog-media-resolver.js) переведены на прямые ациклические импорты исходных символов из файлов определений вместо кольцевых запросов через фасад `catalog.js`.
    - **Устранение циклических ссылок плеера**: вспомогательные подмодули [`public/js/player-autoplay.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/player-autoplay.js), [`public/js/player-seasons.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/player-seasons.js), [`public/js/player-ui-controls.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/player-ui-controls.js), [`public/js/player-streams.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/player-streams.js) переведены на прямые связи со специализированными модулями метаданных, рейтингов, титров и закладок (`player-meta.js`, `player-rating.js`, `player-intro-credits.js`, `player-bookmarks.js`, `player-pip-dock.js`).
    - **Верификация через WebKit JavaScriptCore**: выполнена валидация модульного дерева через системный интерпретатор движка WebKit (`jsc -m public/app.js`), подтвердившая отсутствие синтаксических ошибок и ошибок связывания модулей (`ResolveError`).
    - **Сохранение внешних фасадов**: файлы [`public/js/catalog.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog.js) и [`public/js/player.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/player.js) сохранили все контрактные реэкспорты для корректного взаимодействия с внешними модулями приложения и тестами целостности.
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 14.8 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 39. Оптимизация графа зависимостей и прямых связей в `modals.js` и `settings.js` [Completed ✓]

- **Files:** `public/js/modals.js`, `public/js/settings.js`, `tests/test_frontend_integrity.py`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API и тестов.
- **Details:**
  - Проведён аудит графа зависимостей крупных клиентских модулей [`public/js/modals.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/modals.js) и [`public/js/settings.js`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/settings.js):
    - **Оптимизация импортов в `modals.js`**: импорты карточек каталога (`attachSmartPosterFallback`, `createPosterCardElement`) переведены напрямую на `catalog-cards.js`, резолвер медиа-потоков и статусов серий (`applyEnabledServicesVisibility`, `getDefaultPlayableSourceTab`, `isEpisodeWatched`, `isServiceEnabled`, `patchCatalogItemKinoriumInPlace`, `resolvePreferredPlayTab`, `resolveSeriesEpisodeInfo`) — на `catalog-media-resolver.js`, карусели — на `catalog-shelves.js`, фильтры — на `catalog-filters.js`, героический баннер — на `catalog-hero.js`, а генератор разметки серий `escapeEpisodeHtml` — напрямую на `player-seasons.js`.
    - **Оптимизация импортов в `settings.js`**: исключено использование тяжелого фасадного импорта плеера для стримов и метаданных — модуль напрямую подключает `loadStremioStreams` из `player-streams.js` и `renderModalProvidersSidebar` из `player-meta.js`, а также специализированные модули полок, фильтров и уведомлений каталога (`catalog-shelves.js`, `catalog-filters.js`, `catalog-notifications.js`).
    - **Сохранение стилевых и ARIA-инвариантов**: полностью соблюдены требования отсутствия статических inline-стилей `style="..."`, доступности для скринридеров (`role="switch"`, `role="tablist"`, `aria-selected`) и корректного управления фокусом при закрытии модальных окон.
    - **Верификация через WebKit JavaScriptCore**: валидация полного модульного дерева клиентского приложения (`jsc -m public/app.js`) завершилась с нулевым кодом возврата без синтаксических ошибок и ошибок связывания.
  - Все **109 из 109 тестов** `python3 run_tests.py` успешно пройдены за 19.6 с.
  - Изменения синхронизированы в нативный бандл macOS (`/Applications/CineFlow.app`).

---

## 40. Комплексный аудит целостности проекта, чистота репозитория и финальная верификация [Completed ✓]

- **Files:** `.gitignore`, `server.py`, `backend/`, `public/js/`, `tests/`, `docs/architecture-review-2026-11-03.md`
- **Status:** Успешно реализован с сохранением 100% обратной совместимости API и тестов.
- **Details:**
  - Проведён комплексный сквозной аудит кодовой базы и структуры проекта после 40 этапов архитектурной реорганизации:
    - **Изоляция локальных данных пользователя**: обновлён файл [`.gitignore`](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/.gitignore) для гарантированного исключения SQLite баз данных (`data/*.db*`, `data/*.sqlite*`), файла мастер-ключа шифрования хранилища (`data/.vault_key`), а также локальных директорий загрузок и профилей (`data/downloads/`, `data/profiles/`).
    - **Статическая компиляция Python-файлов**: с помощью `py_compile` проверены все Python-файлы проекта (`server.py`, модули `backend/*.py`, модули маршрутов `backend/routes/*.py`, тестовый сьют `tests/*.py`, служебные скрипты `scripts/*.py`) — 0 синтаксических ошибок.
    - **Верификация модульного графа фронтенда**: проверена целостность всех клиентских модулей Vanilla ES Modules через движок WebKit JavaScriptCore (`jsc -m public/app.js`) — 0 ошибок синтаксиса и 0 ошибок разрешения зависимостей.
    - **Контрольное интеграционное тестирование**: успешно пройден полный сьют из **109 тестов** `python3 -B run_tests.py` за 17.7 с.
    - **Синхронизация рабочей среды**: исходные коды, статические ассеты и архитектурная документация синхронизированы в локальный бандл macOS (`/Applications/CineFlow.app`).
  - Архитектурная реорганизация CineFlow (этапы 1–40) успешно завершена: монолитный файл `server.py` сокращён с 2 559 до **329 строк** (**-2 230 строк / -87.1%**), серверная часть разделена на независимые слои, а клиентский модульный граф полностью распутан и оптимизирован.

---

### Топ-рекомендация
**Кандидат №1: Архитектурная гармонизация и стабильное сопровождение**
* Обоснование: Проект достиг высокого уровня архитектурной зрелости и стабильности (все 40 этапов успешно завершены, 109 тестов проходят стабильно, кодовая база очищена от неиспользуемых импортов и циклических зависимостей). Дальнейшие шаги могут включать выпуск нового релиза установщиков (macOS DMG / Windows Setup) строго по явной команде пользователя, либо реализацию новых функциональных возможностей по запросу.

---

### Рассмотрено, но не рекомендуется на данном этапе
* **Переписывание фронтенда на React/Vue/Svelte**: проект задуман с нулевой сборкой (Vanilla ES Modules), что даёт мгновенный старт, отсутствие `node_modules` и быструю доставку через локальный сервер.
* **Перевод всего бэкенда на асинхронный FastAPI/AsyncIO**: текущий многопоточный `ThreadingHTTPServer` с пулом потоков и блокировками отлично справляется с параллельными потоками и минимизирует зависимости.
