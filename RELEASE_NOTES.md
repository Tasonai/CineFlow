**Что нового в CineFlow 2.7.1:**
• **Бесшовный переход между сериями (Zero-Wait Binge-Watching)**: в финале эпизода плеер заранее резолвит и прогревает в фоновом буфере видеопоток следующей серии, сегменты заставок/титров (`Skip Intro`) и субтитры для мгновенного старта без ожидания и спиннера.
• **Умный таймлайн плеера и быстрый переход по меткам**: добавлены визуальные засечки глав, показ текста ваших заметок при наведении на закладки на полосе прогресса и быстрые переходы между заставкой, закладками, главами и титрами клавишами `[` и `]`.
• **Умные коллекции, фильтр по озвучке и «Кино-итоги года»**: в панель фильтров каталога добавлен быстрый фильтр по топовым подборкам (`8.0+`, `4K UHD`, фавориты друзей) и студиям озвучки, а в окно статистики — детальная сводка по любимым жанрам и годам релиза.
• **Глубокая модульная декомпозиция ядра (Раунды 1–3)**: монолитные модули разделены на 14 специализированных подсистем (`kinorium.py` сокращён на 72%, `app.js` — на 80%, выделены `player-streams-4k.js`, `settings-onboarding.js`, `settings-updater.js`, `modals-person.js`, `modals-stats.js`, `aggregator_discovery.py`, `hdrezka_extras.py`), добавлена диагностика `logDebug`.

<!-- EN -->

**What's new in CineFlow 2.7.1:**
• **Zero-Wait Seamless Episode Transitions**: near the end of an episode, the player pre-resolves and pre-buffers the next episode stream, Skip Intro/Credits segments, and subtitles in the background for an instant spinner-free transition.
• **Smart Timeline Chapter Ticks & Bookmark Previews**: added visual chapter markers, inline bookmark note previews on timeline scrub hover, and instant marker jumping (`[` and `]`) across intro, bookmarks, chapters, and credits.
• **Smart Collections, Voiceover Filter & Year in Review**: added a quick collection & voiceover studio selector (`8.0+`, `4K UHD`, Friends' Favorites, Studios) in the catalog filter drawer, plus Favorite Genres and Year-in-Review breakdowns in Profile Statistics.
• **Deep Core Modularization (Rounds 1–3)**: split large modules into 14 focused subsystems (`kinorium.py` reduced by 72%, `app.js` by 80%, extracted `player-streams-4k.js`, `settings-onboarding.js`, `settings-updater.js`, `modals-person.js`, `modals-stats.js`, `aggregator_discovery.py`, `hdrezka_extras.py`) with `logDebug` diagnostics.
