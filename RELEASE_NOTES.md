**Что нового в Velarium 2.7.11:**
• **Глубокая оптимизация производительности и памяти (14 раундов аудита)**: сквозное ускорение видеоплеера, каталога, сетевого медиа-прокси, локального хранилища SQLite WAL и фоновых задач для абсолютно плавного отклика без микро-фризов даже на огромных библиотеках.
• **Мгновенный отклик плеера и разгрузка горячего цикла `timeupdate`**: оптимизация проверок в 4 Гц цикле воспроизведения, O(1) ранний выход при завершении предзагрузки серий, сброс отложенных сетевых запросов через `AbortController` и мемоизация DOM-структур X-Ray, таймлайна и WebAudio DSP.
• **Быстрый каталог, поиск и кеширование офлайн-статусов**: оптимизированный поиск по командной палитре без аллокаций памяти, статус-зависимая O(1) индексация загруженных тайтлов, мемоизация динамических фильтров студий/жанров и CSS-изоляция модальных окон (`contain: layout style`).
• **Восстановление HTTP Keep-Alive в стриминг-прокси и оптимизация SQLite**: устранение повторных TLS-рукопожатий при частых Range-запросах медиапотока, точечный `upsert` изменённых загрузок в БД вместо перезаписи всей таблицы, безопасные HTTPS-хэндлеры с кешированием DNS и мемоизация статистики профиля Кинориума.

<!-- EN -->

**What's new in Velarium 2.7.11:**
• **Deep Performance & Memory Optimization (14-Pass Audit)**: end-to-end acceleration across the video player, catalog grid, media proxy, and SQLite WAL storage for zero micro-freezes even on multi-thousand-title libraries.
• **Instant Player Response & `timeupdate` Loop Diet**: optimized checks in the 4 Hz playback loop, O(1) early-return when next-episode preloading finishes, `AbortController` cancellation for background requests, and memoized DOM updates for X-Ray, scrubber, and WebAudio DSP.
• **Fast Catalog, Search & Download Status Caching**: memory-allocation-free palette search, status-aware O(1) offline download lookups, memoized dynamic studio/genre filter counters, and CSS containment (`contain: layout style`).
• **HTTP Keep-Alive Restoration in Streaming Proxy & SQLite Tuning**: eliminated redundant TLS handshakes on Range streaming requests, single-row download status updates instead of full-table rewrites, secure HTTPS handlers with DNS caching, and Kinorium profile stats memoization.
