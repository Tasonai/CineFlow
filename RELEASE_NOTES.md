**Что нового в Velarium 2.7.13:**
• **Бесшовная перемотка в 4K UHD и Stremio Remux**: устранено сбрасывание воспроизведения на начало фильма (`0:00`) при перемотке назад на несколько секунд в потоках `/api/remux-stream`, увеличен буфер индексации ключевых кадров и таблицы `Cues` в FFmpeg для крупных 4K MKV-файлов.
• **Коалесцирование быстрых нажатий и удержание кадра (`Frame Bridge`)**: серия быстрых нажатий перемотки (`-10` / `+10`, стрелки влево и вправо, клавиши `J` / `L`) суммируется в единый переход (`−10`, `−20`, `−30 секунд`) без лишних перезапусков FFmpeg, а последний кадр видео удерживается на экране без чёрного мигания при перемотке и смене аудиодорожки.
• **Годовой и месячный дайджест просмотров («Velarium Wrapped»)**: интерактивная сводка в окне статистики с графиком часов просмотра по месяцам, переключением периодов («Весь период», «Этот год», «Этот месяц»), рекордами сериалов и любимыми режиссёрами, актёрами и жанрами.
• **Полировка видеоплеера и нативных оболочек macOS / Windows**: парящая карточка предпросмотра времени и глав над таймлайном, надёжная пауза по клавише `Space` в полноэкранном режиме, плавный вертикальный скролл поверх карточек каталога и исправление кнопок управления окном в Windows WebView2.

<!-- EN -->

**What's new in Velarium 2.7.13:**
• **Seamless Seeking in 4K UHD & Stremio Remux**: fixed backward seeks resetting playback to `0:00` on live `/api/remux-stream` pipelines, and increased the FFmpeg keyframe and Matroska `Cues` probe buffer for large 4K MKV files.
• **Rapid Seek Coalescing & Frame Bridge**: consecutive `-10` / `+10` seek presses (`ArrowLeft` / `ArrowRight`, `J` / `L`) coalesce into a single FFmpeg seek with cumulative OSD feedback (`−10`, `−20`, `−30 sec`), while the last rendered video frame is held on screen to prevent black flashes during seeks and audio track switches.
• **Yearly & Monthly Watch Digest ("Velarium Wrapped")**: interactive summary in the Statistics modal featuring a 12-month watch-time chart, period filters ("All Time", "This Year", "This Month"), series marathon records, and favorite directors, actors, and genres.
• **Video Player & Native macOS / Windows Shell Polish**: floating timeline scrubber preview card with chapter badges, reliable `Space` key play/pause in fullscreen mode, smooth vertical scrolling over catalog cards, and caption button fixes in Windows WebView2.
