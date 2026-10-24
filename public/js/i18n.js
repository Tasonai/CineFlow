import { state } from "./state.js?v=20261024v4";

export function isEn() {
  return state.appLang === "en";
}

export function t(ruText, enText) {
  return state.appLang === "en" ? enText : ruText;
}

export function displayTitle(item) {
  if (!item) return "";
  if (state.appLang === "en") {
    const orig = String(item.orig_title || "").trim();
    if (orig) return orig;
  }
  return String(item.title || item.orig_title || "");
}

export function secondaryTitle(item) {
  if (!item) return "";
  if (state.appLang === "en") return "";
  const ru = String(item.title || "").trim();
  const orig = String(item.orig_title || "").trim();
  if (!ru || !orig) return "";
  if (ru.toLowerCase() === orig.toLowerCase()) return "";
  return orig;
}

const GENRE_RU_TO_EN = {
  драма: "Drama",
  фантастика: "Sci-Fi",
  фэнтези: "Fantasy",
  боевик: "Action",
  триллер: "Thriller",
  шпионаж: "Spy",
  сатира: "Satire",
  "черная комедия": "Dark Comedy",
  комедия: "Comedy",
  криминал: "Crime",
  детектив: "Mystery",
  приключения: "Adventure",
  ужасы: "Horror",
  мелодрама: "Romance",
  биография: "Biography",
  история: "History",
  военный: "War",
  семейный: "Family",
  мультфильм: "Animation",
  аниме: "Anime",
  документальный: "Documentary",
  спорт: "Sport",
  музыка: "Music",
  мюзикл: "Musical",
  вестерн: "Western",
  короткометражка: "Short",
  реальное: "Reality TV",
  "реальное тв": "Reality TV",
  токшоу: "Talk Show",
  "ток-шоу": "Talk Show",
  детский: "Kids",
  нуар: "Film-Noir",
  сериал: "Series",
  фильм: "Movie",
};

const COUNTRY_RU_TO_EN = {
  сша: "United States",
  великобритания: "United Kingdom",
  англия: "United Kingdom",
  канада: "Canada",
  австралия: "Australia",
  "новая зеландия": "New Zealand",
  ирландия: "Ireland",
  франция: "France",
  германия: "Germany",
  фрг: "West Germany",
  италия: "Italy",
  испания: "Spain",
  португалия: "Portugal",
  нидерланды: "Netherlands",
  бельгия: "Belgium",
  швейцария: "Switzerland",
  австрия: "Austria",
  швеция: "Sweden",
  норвегия: "Norway",
  дания: "Denmark",
  финляндия: "Finland",
  исландия: "Iceland",
  польша: "Poland",
  чехия: "Czechia",
  словакия: "Slovakia",
  венгрия: "Hungary",
  румыния: "Romania",
  болгария: "Bulgaria",
  греция: "Greece",
  турция: "Turkey",
  украина: "Ukraine",
  россия: "Russia",
  ссср: "USSR",
  беларусь: "Belarus",
  казахстан: "Kazakhstan",
  грузия: "Georgia",
  армения: "Armenia",
  япония: "Japan",
  "южная корея": "South Korea",
  "корея южная": "South Korea",
  корея: "South Korea",
  китай: "China",
  гонконг: "Hong Kong",
  тайвань: "Taiwan",
  индия: "India",
  таиланд: "Thailand",
  индонезия: "Indonesia",
  сингапур: "Singapore",
  филиппины: "Philippines",
  вьетнам: "Vietnam",
  малайзия: "Malaysia",
  израиль: "Israel",
  оаэ: "UAE",
  "саудовская аравия": "Saudi Arabia",
  иран: "Iran",
  египет: "Egypt",
  юар: "South Africa",
  марокко: "Morocco",
  мексика: "Mexico",
  бразилия: "Brazil",
  аргентина: "Argentina",
  чили: "Chile",
  колумбия: "Colombia",
  перу: "Peru",
  люксембург: "Luxembourg",
  эстония: "Estonia",
  латвия: "Latvia",
  литва: "Lithuania",
  сербия: "Serbia",
  хорватия: "Croatia",
};

const CYR_TO_LAT_MAP = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo",
  ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  і: "i", ї: "yi", є: "ye", ґ: "g",
};

const POLISH_POSTER_SLUGS = [
  "/silos.",
  "/wiedzmin",
  "/szogun",
  "/skazana",
  "/diuna-czesc",
  "/dzentelmeni",
  "/czas-krwawego",
  "/furiosa-saga",
  "/rozdzielenie",
  "/kulawe-konie",
  "/rod-smoka",
];

export function hasCyrillicText(str) {
  return /[А-Яа-яЁёІіЇїЄєҐґ]/.test(String(str || ""));
}

export function transliterateRuToEn(str) {
  const s = String(str || "");
  if (!hasCyrillicText(s)) return s;
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    const low = ch.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CYR_TO_LAT_MAP, low)) {
      const rep = CYR_TO_LAT_MAP[low];
      out += ch !== low && rep ? rep[0].toUpperCase() + rep.slice(1) : rep;
    } else {
      out += ch;
    }
  }
  return out;
}

export function translateKinoriumExtraInfoToEn(rawDesc) {
  const s = String(rawDesc || "").trim();
  if (!s) return "";
  if (!hasCyrillicText(s)) return s;

  const parenOnly = s.match(/^[^•,]+?\(([^()]+)\)\s*$/);
  if (parenOnly && !hasCyrillicText(parenOnly[1])) {
    return parenOnly[1].trim();
  }

  // Only auto-translate compact Kinorium metadata lines (genres/duration • countries • director).
  // Long Russian plot synopses return empty until `/api/title-meta?lang=en` resolves the English plot.
  const looksLikeMetaLine =
    s.includes("•") ||
    (s.length < 135 && (/\d+\s*(?:ч|мин)/i.test(s) || s.split(",").length >= 2));
  if (!looksLikeMetaLine) {
    return "";
  }

  const chunks = s.split("•").map((c) => c.trim()).filter(Boolean);
  const outChunks = chunks.map((chunk) => {
    const durFixed = chunk
      .replace(/(\d+)\s*ч\.?\s*(\d+)\s*мин\.?/gi, "$1 hr $2 min")
      .replace(/(\d+)\s*ч\.?(?![А-Яа-яЁё])/gi, "$1 hr")
      .replace(/(\d+)\s*мин\.?(?![А-Яа-яЁё])/gi, "$1 min")
      .replace(/(\d+)\s*сезон[а-я]*/gi, "$1 seasons")
      .replace(/(\d+)\s*(?:эпизод|сери)[а-я]*/gi, "$1 episodes");

    const tokens = durFixed.split(",").map((tok) => tok.trim().replace(/\.$/, "")).filter(Boolean);
    const mappedTokens = tokens.map((tok) => {
      const low = tok.toLowerCase();
      if (GENRE_RU_TO_EN[low]) return GENRE_RU_TO_EN[low];
      if (COUNTRY_RU_TO_EN[low]) return COUNTRY_RU_TO_EN[low];
      for (const [ruC, enC] of Object.entries(COUNTRY_RU_TO_EN)) {
        if (low.endsWith(` ${ruC}`)) {
          const pref = low.slice(0, -(ruC.length + 1)).trim();
          const prefEn = GENRE_RU_TO_EN[pref] || transliterateRuToEn(pref);
          return prefEn ? `${prefEn}, ${enC}` : enC;
        }
      }
      return hasCyrillicText(tok) ? transliterateRuToEn(tok) : tok;
    });
    return mappedTokens.join(", ");
  });
  return outChunks.filter(Boolean).join(" • ");
}

export function displayDescription(item) {
  if (!item) return "";
  if (state.appLang === "en") {
    const enDesc = String(item.description_en || "").trim();
    if (enDesc && !hasCyrillicText(enDesc)) return enDesc;
    return translateKinoriumExtraInfoToEn(item.description || "");
  }
  return String(item.description || "");
}

export function displayPoster(item) {
  if (!item) return "";
  const basePoster = String(item.poster || item.backdrop || "").trim();
  if (state.appLang !== "en") {
    return basePoster;
  }
  const explicitEn = String(item.poster_en || "").trim();
  if (explicitEn && !explicitEn.includes("ru-images.kinorium.com")) {
    return explicitEn;
  }
  const itemId = String(item.id || "").trim();
  const imdbId = String(item.imdb_id || (itemId.startsWith("tt") ? itemId : "") || "").trim();
  const kid = String(
    item.kinorium_id ||
      item.kinorium?.kinorium_id ||
      (itemId.startsWith("kin_") ? itemId.slice(4) : "") ||
      ""
  ).trim();

  const lowPoster = basePoster.toLowerCase();
  const isLocalized =
    !basePoster ||
    lowPoster.includes("ru-images.kinorium.com") ||
    lowPoster.includes("kinopoisk") ||
    lowPoster.includes("rezka") ||
    POLISH_POSTER_SLUGS.some((slug) => lowPoster.includes(slug));

  if (!isLocalized) {
    return basePoster;
  }
  if (/^tt\d{5,10}$/.test(imdbId)) {
    return `https://images.metahub.space/poster/medium/${imdbId}/img`;
  }
  if (/^\d+$/.test(kid)) {
    return `https://en-images.kinorium.com/movie/600/${kid}.jpg`;
  }
  if (basePoster.includes("ru-images.kinorium.com/movie/")) {
    return basePoster.replace("ru-images.kinorium.com/movie/", "en-images.kinorium.com/movie/");
  }
  return basePoster;
}

export function formatCriticsRating(item, overrideVal = null) {
  const raw =
    overrideVal !== null && overrideVal !== undefined
      ? overrideVal
      : item?.ratings?.critics ?? item?.critics_rating ?? item?.kinorium?.critics_rating ?? null;
  if (raw === null || raw === undefined || raw === "" || raw === "—") return "—";
  const str = String(raw).trim().replace(/%$/, "");
  const num = Number(str);
  if (!Number.isFinite(num) || num <= 0 || num > 100) return "—";
  return `${Math.round(num)}%`;
}

export function translateSizeLabel(sizeStr) {
  const s = String(sizeStr || "").trim();
  if (!s || state.appLang !== "en") return s;
  return s.replace(/ГБ/g, "GB").replace(/МБ/g, "MB").replace(/ТБ/g, "TB");
}

export function translateGenre(genre) {
  const raw = String(genre || "").trim();
  if (!raw || state.appLang !== "en") return raw;
  const mapped = GENRE_RU_TO_EN[raw.toLowerCase()];
  if (mapped) return mapped;
  return raw;
}

export function translateStudioName(name) {
  const raw = String(name || "").trim();
  if (!raw || state.appLang !== "en") return raw;
  return raw
    .replace(/Оригинал\s*\(\+субтитры\)/gi, "Original (+subtitles)")
    .replace(/^Оригинал$/i, "Original")
    .replace(/Оригинал/gi, "Original")
    .replace(/Дубляж/gi, "Dubbing")
    .replace(/Многоголосый/gi, "Multi-voice")
    .replace(/Двухголосый/gi, "Two-voice")
    .replace(/Одноголосый/gi, "Single-voice")
    .replace(/Субтитры/gi, "Subtitles")
    .replace(/Кубик в Кубе/gi, "Kubik v Kube")
    .replace(/Пифагор/gi, "Pifagor")
    .replace(/Мосфильм/gi, "Mosfilm")
    .replace(/Кириллица/gi, "Kirillitsa")
    .replace(/Яскьер/gi, "Jaskier")
    .replace(/Русский/gi, "Russian")
    .replace(/Английский/gi, "English")
    .replace(/Українська|Украинский/gi, "Ukrainian")
    .replace(/Укр\./gi, "UA");
}

export function translateCareer(careerText) {
  const raw = String(careerText || "").trim();
  if (!raw || state.appLang !== "en") return raw;
  return raw
    .replace(/Режисс[её]ры?/gi, "Director")
    .replace(/Акт[её]ры?/gi, "Actor")
    .replace(/Актрисы?/gi, "Actress")
    .replace(/Сценаристы?/gi, "Writer")
    .replace(/Продюсеры?/gi, "Producer")
    .replace(/Композиторы?/gi, "Composer")
    .replace(/Операторы?/gi, "Cinematographer")
    .replace(/Персона/gi, "Person");
}

export function translateSeriesStatus(statusText) {
  const raw = String(statusText || "").trim();
  if (!raw || state.appLang !== "en") return raw;
  return raw
    .replace(/заверш[её]н/gi, "Completed")
    .replace(/выходит/gi, "Ongoing")
    .replace(/продолжается/gi, "Ongoing")
    .replace(/закрыт/gi, "Ended")
    .replace(/пауза/gi, "On hiatus");
}

function setElText(sel, ru, en) {
  const el = document.querySelector(sel);
  if (el) el.textContent = state.appLang === "en" ? en : ru;
}

function setElAttr(sel, attr, ru, en) {
  const el = document.querySelector(sel);
  if (el) el.setAttribute(attr, state.appLang === "en" ? en : ru);
}

export function syncLanguageSegmentedControlUI() {
  const lang = state.appLang === "en" ? "en" : "ru";
  document.querySelectorAll(".atv-lang-seg-btn[data-app-lang]").forEach((btn) => {
    const active = btn.dataset.appLang === lang;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const hintEl = document.getElementById("settings-lang-audio-hint");
  if (hintEl) {
    hintEl.textContent =
      lang === "en"
        ? "English interface active — Original / English audio is selected by default across HDRezka, Stremio, and 4K Remux."
        : "Активен русский интерфейс — по умолчанию выбирается русская озвучка (переключение на English включает оригинальную озвучку по умолчанию).";
  }
}

export function applyStaticDomTranslations() {
  const en = state.appLang === "en";
  if (typeof document === "undefined") return;
  document.documentElement.lang = en ? "en" : "ru";

  // Top Header & Navigation
  setElAttr("#brand-home", "aria-label", "CineFlow — на главную", "CineFlow — back to Home");
  setElText('#media-type-bar .type-pill[data-type="all"]', "Все", "All");
  setElText('#media-type-bar .type-pill[data-type="movie"]', "Фильмы", "Movies");
  setElText('#media-type-bar .type-pill[data-type="series"]', "Сериалы", "Series");
  setElText('#provider-filter-bar .atv-pill[data-provider="all"]', "Главная", "Home");

  setElAttr("#global-search", "placeholder", "Поиск фильмов, сериалов и актёров...", "Search movies, series & actors...");
  setElAttr("#search-kbd-hint", "title", "Быстрый поиск (Cmd+K / Ctrl+K)", "Quick search (Cmd+K / Ctrl+K)");
  setElAttr("#btn-clear-search", "title", "Очистить поиск", "Clear search");
  setElAttr("#btn-open-stats-modal", "title", "Моя статистика и история просмотров", "My statistics & watch history");
  setElAttr("#notifications-bell-btn", "title", "Уведомления о новых сериях («Смотрю»)", "New episode notifications (Watching)");
  setElText("#notifications-popover .atv-notif-header .atv-inline-icon-label span", "Новые серии («Смотрю»)", "New Episodes (Watching)");
  setElAttr("#btn-check-rezka-updates", "title", "Проверить реальные вышедшие серии и озвучки на HDRezka", "Check latest released episodes & audio tracks on HDRezka");
  setElAttr("#btn-mark-notifs-read", "title", "Отметить все уведомления прочитанными", "Mark all notifications as read");
  setElText("#btn-mark-notifs-read span", "Прочитано", "Mark read");
  setElAttr("#open-settings-btn", "title", "Настройки и интеграции", "Settings & integrations");

  // Service Login Banner & Hero Controls
  setElText("#banner-login-btn", "Войти в аккаунт", "Sign in");
  setElText("#banner-confirm-login-btn", "Подтвердить вход", "Confirm sign-in");
  setElText("#banner-open-integrations-btn", "Все интеграции", "All integrations");
  setElAttr("#hero-prev-btn", "title", "Предыдущий слайд", "Previous slide");
  setElAttr("#hero-next-btn", "title", "Следующий слайд", "Next slide");

  // Kinorium Sections Bar (preserve count badges)
  const ksecLabels = {
    all: en ? "All Catalog" : "Весь каталог",
    premieres: en ? "Online Premieres " : "Премьеры онлайн ",
    watching: en ? "Watching " : "Смотрю ",
    watchlist: en ? "Watchlist " : "Буду смотреть ",
    watched: en ? "Watched " : "Просмотрено ",
    never: en ? "Not Interested " : "Не буду смотреть ",
  };
  document.querySelectorAll("#kinorium-sections-bar .kin-sec-pill").forEach((pill) => {
    const ksec = pill.dataset.ksec;
    const label = ksecLabels[ksec];
    if (!label) return;
    const countSpan = pill.querySelector(".kin-sec-count");
    if (!countSpan) {
      pill.textContent = label.trim();
    } else {
      const firstNode = pill.childNodes[0];
      if (firstNode && firstNode.nodeType === Node.TEXT_NODE) {
        firstNode.nodeValue = label;
      }
    }
  });

  // Sort & Filters Bar
  setElAttr("#select-catalog-sort", "title", "Сортировка каталога", "Sort catalog");
  setElText('#select-catalog-sort option[value="default"]', "Сортировка: По умолчанию", "Sort: Default");
  setElText('#select-catalog-sort option[value="user_rating"]', "По моей оценке (10 - 1)", "My Rating (10 - 1)");
  setElText('#select-catalog-sort option[value="friends_rating"]', "По оценкам друзей (10 - 1)", "Friends' Ratings (10 - 1)");
  setElText('#select-catalog-sort option[value="kinorium_rating"]', "По рейтингу Кинориума", "Kinorium Rating");
  setElText('#select-catalog-sort option[value="year_desc"]', "По году (сначала новые)", "Release Year (Newest)");

  setElAttr("#btn-toggle-catalog-filters", "title", "Показать или скрыть панель фильтров", "Show or hide filters panel");
  setElText("#btn-toggle-catalog-filters > span:not(.atv-filter-count-badge)", "Фильтры", "Filters");
  setElAttr("#btn-random-pick", "title", "Выбрать случайный фильм или сериал из текущего списка", "Pick a random movie or series from current list");
  setElText("#btn-random-pick > span", "Что посмотреть?", "Surprise Me");

  setElAttr("#select-catalog-genre", "title", "Фильтр по жанру", "Filter by genre");
  setElAttr("#select-catalog-year", "title", "Фильтр по году выпуска", "Filter by release year");
  setElAttr("#btn-hide-watched", "title", "Скрыть уже просмотренные фильмы и сериалы", "Hide already watched movies and series");
  setElText("#btn-hide-watched > span", "Скрыть просмотренные", "Hide watched");
  setElAttr("#btn-friends-filter", "title", "Показать только тайтлы, которые оценили ваши друзья на Kinorium", "Show only titles rated by your Kinorium friends");
  setElText("#btn-friends-filter > span", "Оценили друзья", "Rated by friends");
  setElAttr("#select-friend-filter", "title", "Фильтр по конкретному другу из Kinorium", "Filter by specific Kinorium friend");
  setElAttr("#btn-clear-catalog-filters", "title", "Сбросить все активные фильтры и сортировку", "Reset all active filters and sorting");
  setElText("#btn-clear-catalog-filters > span", "Сбросить", "Reset");

  // Shelves Headings
  setElText("#continue-watching-section .atv-section-header h2", "Новые серии и продолжить просмотр", "New Episodes & Continue Watching");
  setElText("#series-heading", "Сериалы", "Series");
  setElText("#movies-heading", "Фильмы", "Movies");
  setElText("#search-similar-heading", "Похожие тайтлы", "Similar Titles");

  // Cinema Player Modal Header & Tabs
  setElAttr('.source-tab[data-tab="hdrezka"]', "title", "Прямой поток 1080p с HDRezka без регистрации", "Direct 1080p stream from HDRezka without registration");
  setElAttr('.source-tab[data-tab="stremio"]', "title", "Потоки и субтитры из аддонов Stremio (Torrentio, OpenSubtitles и свои manifest.json)", "Streams & subtitles from Stremio addons (Torrentio, OpenSubtitles & custom manifest.json)");
  setElAttr('.source-tab[data-tab="backup4k"]', "title", "Потоки 4K UHD HDR / BDRemux", "4K UHD HDR / BDRemux streams");
  setElText("#tab-btn-trailer", "Трейлер", "Trailer");
  setElAttr("#tab-btn-trailer", "title", "Русский и оригинальный трейлер", "Original & localized trailers");

  setElText(".atv-hdr-studio-prefix", "Озвучка:", "Audio:");
  setElAttr("#btn-hdr-studio", "title", "Выбрать студию озвучки или Оригинал", "Choose audio track or Original");
  setElAttr("#btn-kinorium-status-menu", "title", "Изменить статус фильма или сериала в Kinorium", "Change movie or series status on Kinorium");
  setElText("#kinorium-status-popover .atv-status-popover-title", "Список в Kinorium", "Kinorium List");
  setElAttr("#btn-open-rate", "title", "Поставить оценку в Kinorium", "Rate on Kinorium");
  setElText("#postwatch-scope-ep", "Эта серия", "This Episode");
  setElText("#postwatch-scope-series", "Весь сериал", "Entire Series");
  setElText("#postwatch-clear-rate-btn", "Сбросить", "Clear");
  setElAttr("#postwatch-clear-rate-btn", "title", "Удалить поставленную оценку", "Delete rating");
  setElAttr("#close-postwatch-btn", "title", "Скрыть карточку оценки", "Hide rating card");
  setElAttr("#postwatch-comment", "placeholder", "Комментарий к оценке (необязательно)", "Rating comment (optional)");
  setElText("#btn-toggle-mini-player > span", "Мини-плеер", "Mini Player");
  setElAttr("#btn-toggle-mini-player", "title", "Свернуть в плавающий мини-плеер в углу страницы", "Minimize to floating corner mini player");
  setElAttr("#close-player-modal", "title", "Закрыть (Esc)", "Close (Esc)");

  // Mini-Player Bar
  setElAttr("#mini-player-bar", "title", "Перетащите за панель в любой угол экрана (двойной клик — развернуть)", "Drag bar to any screen corner (double-click to expand)");
  setElAttr("#btn-mini-play-pause", "title", "Пауза / Воспроизведение", "Play / Pause");
  setElAttr("#btn-mini-next-ep", "title", "Следующая серия", "Next episode");
  setElText("#btn-mini-next-ep > span", "Далее", "Next");
  setElAttr("#btn-restore-mini-player", "title", "Развернуть плеер на весь экран", "Expand player");
  setElText("#btn-restore-mini-player > span", "Развернуть", "Expand");
  setElAttr("#btn-close-mini-player", "title", "Закрыть плеер", "Close player");

  // Trailer Panel
  setElText("#trailer-panel .atv-trailer-bar > span", "Трейлер к фильму / сериалу:", "Trailer:");
  setElText("#btn-trailer-ru", "Русский трейлер", "Russian Trailer");
  setElText("#btn-trailer-en", "В оригинале", "Original (English)");
  setElText("#btn-trailer-yt > span", "Открыть на YouTube", "Open on YouTube");
  setElAttr("#btn-trailer-yt", "title", "Открыть трейлер в новой вкладке YouTube", "Open trailer in a new YouTube tab");

  // Current Episode Bar & Video Error / PiP Placeholders
  setElAttr("#btn-toggle-current-ep", "title", "Отметить или снять отметку просмотра серии в Kinorium", "Toggle episode watched status on Kinorium");
  setElAttr("#btn-rate-current-ep", "title", "Оценить эту серию", "Rate this episode");
  setElText("#video-error-title", "Поток временно недоступен", "Stream temporarily unavailable");
  setElText("#video-error-sub", "Попробуйте повторить подключение, выбрать другую студию озвучки или переключиться на 4K", "Try reconnecting, picking another audio track, or switching to Stremio / 4K");
  setElText("#btn-video-err-retry > span", "Повторить", "Retry");
  setElText("#btn-video-err-studio", "Другая озвучка", "Other Audio");
  setElText("#btn-video-err-4k", "Открыть 4K", "Open 4K");

  setElText("#video-pip-placeholder .atv-pip-stage-title > span", "Видео открыто в режиме «Картинка в картинке»", "Video is playing in Picture-in-Picture");
  setElText("#video-pip-placeholder .atv-pip-stage-sub", "Переходите на главную страницу и выбирайте фильмы — воспроизведение не прервётся", "Browse the catalog freely — playback continues uninterrupted");
  setElText("#btn-pip-go-home > span", "На главную страницу", "Back to Catalog");
  setElText("#btn-pip-return-inline", "Вернуть в плеер", "Return to Player");

  setElText("#skip-intro-btn", "Пропустить заставку", "Skip Intro");
  setElText("#skip-ad-btn", "Пропустить рекламу", "Skip Ad");
  setElText("#skip-outro-btn", "Следующая серия", "Next Episode");
  setElText("#btn-autoplay-now > span", "Включить сейчас", "Play Now");
  setElText("#btn-autoplay-cancel", "Отмена", "Cancel");

  // Player Gear Popover
  setElText("#player-gear-popover .atv-gear-header > span", "Настройки плеера", "Player Settings");
  setElText("#btn-toggle-gear-hotkeys > span", "Клавиши", "Shortcuts");
  setElAttr("#btn-toggle-gear-hotkeys", "title", "Показать горячие клавиши плеера", "Show keyboard shortcuts");
  setElText("#btn-close-player-gear", "Готово", "Done");
  setElText("#speed-group .atv-gear-speed-title", "Скорость", "Speed");
  setElText("#audio-boost-group > span", "Усиление", "Volume Boost");
  setElAttr("#select-audio-boost", "title", "Усиление громкости и чёткости речи (клавиша B)", "Audio boost & speech clarity (key B)");
  setElText("#audio-eq-group > span", "Звук", "Sound Mode");
  setElAttr("#select-audio-eq", "title", "Эквалайзер и ночной режим (клавиша E)", "Equalizer & night mode (key E)");
  setElText('#select-audio-eq option[value="flat"]', "Стандарт", "Standard");
  setElText('#select-audio-eq option[value="voice"]', "Чёткая речь", "Clear Voice");
  setElText('#select-audio-eq option[value="night"]', "Ночной режим", "Night Mode");
  setElText('#select-audio-eq option[value="cinema"]', "Кинотеатр", "Cinema");

  setElText("#video-crop-group > span", "Кадр", "Aspect / Crop");
  setElAttr("#select-video-crop", "title", "Масштабирование и обрезка чёрных полос (клавиша C)", "Zoom & ultrawide black-bar crop (key C)");
  setElText('#select-video-crop option[value="contain"]', "16:9 Стандарт", "16:9 Fit");
  setElText('#select-video-crop option[value="cover"]', "21:9 Без полос", "21:9 Crop Bars");
  setElText('#select-video-crop option[value="zoom115"]', "Масштаб 115%", "Zoom 115%");
  setElText('#select-video-crop option[value="fill"]', "Растянуть", "Stretch");

  setElText("#sub-size-group > span", "Размер субтитров", "Subtitle Size");
  setElText('#select-sub-size option[value="small"]', "Мелкие", "Small");
  setElText('#select-sub-size option[value="medium"]', "Средние", "Medium");
  setElText('#select-sub-size option[value="large"]', "Крупные", "Large");
  setElText('#select-sub-size option[value="xlarge"]', "Огромные", "Extra Large");

  setElText("#sub-bg-group > span", "Фон субтитров", "Subtitle Background");
  setElText('#select-sub-bg option[value="semi"]', "Полупрозрачный", "Semi-transparent");
  setElText('#select-sub-bg option[value="solid"]', "Тёмный фон", "Solid Dark");
  setElText('#select-sub-bg option[value="none"]', "Без фона (Тень)", "None (Drop Shadow)");

  setElText("#sleep-timer-group > span", "Таймер сна", "Sleep Timer");
  setElText('#select-sleep-timer option[value="off"]', "Выключен", "Off");
  setElText('#select-sleep-timer option[value="15"]', "15 минут", "15 minutes");
  setElText('#select-sleep-timer option[value="30"]', "30 минут", "30 minutes");
  setElText('#select-sleep-timer option[value="45"]', "45 минут", "45 minutes");
  setElText('#select-sleep-timer option[value="60"]', "60 минут", "60 minutes");
  setElText('#select-sleep-timer option[value="episode_end"]', "Конец серии", "End of episode");

  const ambLabelWrap = document.querySelector("#ambilight-toggle")?.closest("label");
  if (ambLabelWrap) {
    ambLabelWrap.setAttribute(
      "title",
      en
        ? "Dynamic ambient glow around the player (key A)"
        : "Мягкая фоновая подсветка вокруг экрана в тон сцены (клавиша A)"
    );
  }
  const ambToggleLbl = ambLabelWrap?.querySelector(".atv-gear-toggle-label");
  if (ambToggleLbl) ambToggleLbl.textContent = en ? "Ambilight Glow" : "Подсветка Ambilight";
  const adLabelWrap = document.querySelector("#auto-skip-ads-toggle")?.closest("label");
  if (adLabelWrap) {
    adLabelWrap.setAttribute(
      "title",
      en
        ? "Automatically detect and skip embedded sponsor or betting ads"
        : "Автоматическое распознавание и пропуск вшитых рекламных вставок в видеопотоке"
    );
  }
  const adToggleLbl = adLabelWrap?.querySelector(".atv-gear-toggle-label");
  if (adToggleLbl) adToggleLbl.textContent = en ? "Auto-skip embedded ads" : "Автопропуск рекламы";
  const introToggleLbl = document.querySelector("#auto-skip-intro-toggle")?.closest("label")?.querySelector(".atv-gear-toggle-label");
  if (introToggleLbl && introToggleLbl.childNodes[0]?.nodeType === Node.TEXT_NODE) {
    introToggleLbl.childNodes[0].nodeValue = en ? "Auto-skip intro " : "Автопропуск заставки ";
  }
  const nextToggleLbl = document.querySelector("#auto-next-ep-toggle")?.closest("label")?.querySelector(".atv-gear-toggle-label");
  if (nextToggleLbl) nextToggleLbl.textContent = en ? "Auto-play next episode" : "Автопереход на следующую серию";

  setElText("#btn-screenshot > span", "Снимок кадра (.png)", "Save Frame (.png)");
  setElAttr("#btn-screenshot", "title", "Сохранить снимок текущего кадра в полном разрешении (.png · клавиша S)", "Save full-resolution frame snapshot (.png · key S)");
  setElText("#btn-download-stream > span", "Скачать (.mp4)", "Download (.mp4)");
  setElAttr("#btn-download-stream", "title", "Скачать текущий поток (.mp4) в 1080p на устройство", "Download current 1080p stream (.mp4)");
  setElText("#gear-hotkeys-box .atv-gear-hotkeys-title", "Горячие клавиши плеера:", "Keyboard Shortcuts:");
  const hkHint = document.querySelector("#gear-hotkeys-box .atv-hotkeys-hint");
  if (hkHint) {
    hkHint.innerHTML = en
      ? `<code>Space / K</code> play/pause · <code>F</code> fullscreen · <code>← / →</code> ±10 seconds · <code>↑ / ↓</code> volume · <code>B</code> audio boost · <code>E</code> sound mode · <code>C</code> crop · <code>A</code> ambilight · <code>S</code> snapshot · <code>N / P</code> next/previous episode · <code>I</code> picture-in-picture`
      : `<code>Пробел / K</code> пауза · <code>F</code> полный экран · <code>← / →</code> ±10 секунд · <code>↑ / ↓</code> громкость · <code>B</code> усиление звука · <code>E</code> эквалайзер · <code>C</code> формат кадра · <code>A</code> подсветка · <code>S</code> снимок кадра · <code>N / P</code> следующая или предыдущая серия · <code>I</code> картинка в картинке`;
  }

  // Video Control Bar Tooltips
  setElAttr("#vc-btn-play", "title", "Воспроизведение / Пауза (Space)", "Play / Pause (Space)");
  setElAttr("#vc-btn-back10", "title", "Назад на 10 секунд (←)", "Back 10 seconds (←)");
  setElAttr("#vc-btn-fwd10", "title", "Вперёд на 10 секунд (→)", "Forward 10 seconds (→)");
  setElAttr("#vc-btn-mute", "title", "Включить или выключить звук (M)", "Mute / Unmute (M)");
  setElAttr("#vc-vol-slider", "title", "Громкость", "Volume");
  setElAttr("#vc-time-label", "title", "Нажмите, чтобы переключить оставшееся / общее время", "Click to toggle remaining / total time");
  setElAttr("#vc-btn-studio", "title", "Выбрать студию озвучки", "Select audio track");
  setElAttr("#vc-btn-subs", "title", "Субтитры", "Subtitles");
  setElAttr("#vc-btn-quality", "title", "Качество потока", "Stream quality");
  setElAttr("#btn-player-gear", "title", "Настройки плеера: скорость, звук, формат кадра, таймер сна, снимок и скачать", "Player settings: speed, sound, crop, sleep timer, snapshot & download");
  setElAttr("#vc-btn-pip", "title", "Картинка в картинке (I)", "Picture-in-Picture (I)");
  setElAttr("#vc-btn-fs", "title", "Во весь экран (F)", "Fullscreen (F)");

  // Episodes Bottom Panel
  setElText("#season-group > span", "Сезон", "Season");
  setElAttr("#btn-prev-ep", "title", "Предыдущая серия (P)", "Previous episode (P)");
  setElAttr("#btn-next-ep", "title", "Следующая серия (N)", "Next episode (N)");
  setElAttr("#ep-view-mode-switch", "aria-label", "Вид списка серий", "Episode list view");
  setElText("#btn-ep-view-strip", "Номера", "Numbers");
  setElAttr("#btn-ep-view-strip", "title", "Компактные номера серий с подсказкой при наведении", "Compact episode numbers with hover preview");
  setElText("#btn-ep-view-grid", "Карточки", "Cards");
  setElAttr("#btn-ep-view-grid", "title", "Карточки серий с названиями и датами выхода", "Episode cards with titles & air dates");
  setElText("#btn-mark-ep-upto > span", "По текущую", "Up to current");
  setElAttr("#btn-mark-ep-upto", "title", "Отметить просмотренными серии с первой по текущую в этом сезоне", "Mark episodes from 1 up to current as watched");
  setElText("#btn-mark-season-watched > span", "Весь сезон", "Full season");
  setElAttr("#btn-mark-season-watched", "title", "Отметить весь выбранный сезон просмотренным", "Mark entire season as watched");
  setElText("#episodes-toggle-label", "Эпизоды", "Episodes");
  setElAttr("#btn-toggle-episodes-strip", "title", "Показать или скрыть список эпизодов", "Show or hide episodes list");

  // Stremio & 4K Subpanels
  setElText(".atv-stremio-title-label", "Потоки Stremio", "Stremio Streams");
  setElText('#stremio-filter-pills [data-sfilter="all"]', "Все", "All");
  setElText('#stremio-filter-pills [data-sfilter="ru"]', "Русский", "Russian");
  setElText('#stremio-filter-pills [data-sfilter="orig"]', "Оригинал", "English / Original");
  setElText("#btn-open-stremio-addons > span", "Аддоны", "Addons");
  setElAttr("#btn-open-stremio-addons", "title", "Управление аддонами Stremio и добавление manifest.json", "Manage Stremio addons & install manifest.json");
  setElText("#backup-releases-panel .atv-subpanel-head > span", "Выберите поток 4K UHD / 1080p High-Bitrate для этого тайтла:", "Choose a 4K UHD / 1080p high-bitrate stream for this title:");

  // Right Info Sidebar
  setElText("#meta-label-critics", "Критики", "Critics");
  setElText("#meta-cast-section .atv-cast-below-head h4 > span", "Режиссёр и актёры", "Director & Cast");
  setElText("#sidebar-providers-section > h4", "Где смотреть", "Where to Watch");
  setElText("#sidebar-friends-section > h4", "Оценки друзей", "Friends' Ratings");
  setElText("#modal-similar-section > h4", "Похожие фильмы и сериалы", "Similar Movies & Series");

  // Quick Peek Modal
  setElAttr("#qp-back-nav-btn", "title", "Вернуться назад", "Go back");
  setElAttr("#close-quick-peek-modal", "title", "Закрыть (Esc)", "Close (Esc)");
  setElText("#qp-label-critics", "Критики", "Critics");
  setElText("#qp-friends-wrap .atv-qp-sublabel", "Оценки друзей", "Friends' Ratings");
  setElText("#qp-cast-wrap .atv-qp-sublabel", "Режиссёр и в ролях", "Director & Cast");
  setElText("#qp-clear-rate-btn", "Сбросить оценку", "Clear rating");
  setElAttr("#qp-clear-rate-btn", "title", "Удалить мою оценку в Kinorium", "Remove my Kinorium rating");
  setElText("#qp-btn-watching > span", "Смотрю", "Watching");
  setElText("#qp-btn-watchlist > span", "Буду смотреть", "Watchlist");
  setElText("#qp-btn-watched > span", "Просмотрено", "Watched");
  setElText("#qp-btn-never > span", "Не буду смотреть", "Not Interested");
  setElText("#qp-btn-play > span", "Смотреть (HDRezka)", "Watch (HDRezka)");
  setElText("#qp-btn-trailer > span", "Трейлер", "Trailer");

  // Stats & History Modal
  setElText("#stats-tab-analytics > span", "Аналитика и вкусы", "Analytics & Taste");
  setElText("#stats-tab-history > span", "История просмотров", "Watch History");
  setElAttr("#close-stats-modal", "title", "Закрыть (Esc)", "Close (Esc)");

  // Settings Modal
  setElText('#settings-tabs .settings-tab[data-stab="integrations"]', "Kinorium и сервисы", "General & Services");
  setElText('#settings-tabs .settings-tab[data-stab="network"]', "Сеть и потоки", "Network & Streams");
  setElText('#settings-tabs .settings-tab[data-stab="backup"]', "Резервная копия", "Backup & Restore");
  setElAttr("#close-settings-modal", "title", "Закрыть (Esc)", "Close (Esc)");

  setElText("#settings-lang-title", "Язык интерфейса и озвучки по умолчанию", "App Language & Default Audio");
  syncLanguageSegmentedControlUI();

  setElText(
    "#stab-integrations-desc",
    "Сверху настраивается язык приложения, профиль и синхронизация Kinorium, а ниже — сервисы для просмотра видео. Отключённый переключателем сервис полностью скрывается во всём приложении.",
    "Configure app language, Kinorium profile sync, and streaming sources below. Disabling a service hides it across the entire interface."
  );

  // Settings Tab 2: Network
  setElText("#net-group-hdrezka > h4", "HDRezka (Работа без регистрации и обход региона)", "HDRezka (No-Account Direct Streams & Geo Relay)");
  const rezkaLabels = document.querySelectorAll("#net-group-hdrezka label");
  if (rezkaLabels[0]) rezkaLabels[0].textContent = en ? "Request routing region" : "Регион маршрутизации запросов";
  if (rezkaLabels[1]) rezkaLabels[1].textContent = en ? "Custom HDRezka mirror (optional)" : "Персональное зеркало HDRezka (необязательно)";
  if (rezkaLabels[2]) rezkaLabels[2].textContent = en ? "Proxy or Cloudflare Worker (optional)" : "Прокси или Cloudflare Worker (необязательно)";
  setElText("#summary-net-hdrezka", "Дополнительно: персональное зеркало и прокси", "Advanced: custom mirror & proxy");
  setElText('#cfg-spoof-region option[value="KZ"]', "Казахстан (Рекомендуется для Польши/ЕС)", "Kazakhstan (Recommended for EU)");
  setElText('#cfg-spoof-region option[value="AM"]', "Армения", "Armenia");
  setElText('#cfg-spoof-region option[value="MD"]', "Молдова", "Moldova");
  setElText('#cfg-spoof-region option[value="DIRECT"]', "Напрямую (Польша)", "Direct (Local IP)");

  setElText("#net-group-stremio > h4", "Аддоны Stremio (Torrentio, OpenSubtitles и свои manifest.json)", "Stremio Addons (Torrentio, OpenSubtitles & custom manifest.json)");
  setElText(
    "#net-group-stremio > .atv-settings-subnote",
    "Потоки и субтитры из включённых аддонов Stremio воспроизводятся прямо во встроенном плеере CineFlow с выбором звуковых дорожек и синхронизацией прогресса с Kinorium.",
    "Streams and subtitles from enabled Stremio addons play directly inside CineFlow's native player with multi-audio switching and Kinorium scrobbling."
  );
  const stremioLbl = document.querySelector("#net-group-stremio > label");
  if (stremioLbl) stremioLbl.textContent = en ? "Install addon via URL (manifest.json or stremio://)" : "Установить аддон по ссылке (manifest.json или stremio://)";
  setElAttr("#cfg-stremio-manifest-input", "placeholder", "https://torrentio.strem.fun/manifest.json или stremio://...", "https://torrentio.strem.fun/manifest.json or stremio://...");
  setElText("#btn-add-stremio-addon", "Добавить аддон", "Add Addon");

  setElText("#net-group-backup4k > h4", "4K Remux Стриминг (TorrServer, FFmpeg ремукс звука и Debrid)", "4K Remux Streaming (TorrServer, FFmpeg Audio Remux & Debrid)");
  const bkpLabels = document.querySelectorAll("#net-group-backup4k label");
  if (bkpLabels[0]) bkpLabels[0].textContent = en ? "4K playback mode" : "Режим воспроизведения 4K";
  if (bkpLabels[1]) bkpLabels[1].textContent = en ? "TorrServer URL" : "Адрес TorrServer";
  if (bkpLabels[2]) bkpLabels[2].textContent = en ? "Real-Debrid or TorBox API key (cloud mode only)" : "API-ключ Real-Debrid или TorBox (только для облачного режима)";
  setElText("#summary-net-4k", "Дополнительно: адрес TorrServer и ключ Debrid", "Advanced: TorrServer URL & Debrid API key");
  setElText('#cfg-backup-mode option[value="torrserver"]', "Встроенный TorrServer + ремукс звука AAC (Рекомендуется)", "Built-in TorrServer + AAC Audio Remux (Recommended)");
  setElText('#cfg-backup-mode option[value="realdebrid"]', "Real-Debrid HTTPS (Облачный кэш без P2P)", "Real-Debrid HTTPS (Cloud Cache, No P2P)");
  setElText('#cfg-backup-mode option[value="torbox"]', "TorBox HTTPS (Облачный кэш без P2P)", "TorBox HTTPS (Cloud Cache, No P2P)");
  setElAttr("#cfg-debrid-key", "placeholder", "Оставьте пустым при работе через встроенный TorrServer", "Leave empty when using built-in TorrServer");

  setElText("#net-system-heading", "Домашняя сеть Wi-Fi (iPhone / iPad / Smart TV) и macOS", "Home Wi-Fi (iPhone / iPad / Smart TV) & macOS");
  setElText("#lan-toggle-title", "Доступ к кинотеатру в домашней сети Wi-Fi", "Allow access on home Wi-Fi network");
  setElText("#lan-toggle-sub", "Открывайте CineFlow на телефоне, планшете или телевизоре в одной сети Wi-Fi", "Open CineFlow on your phone, tablet, or Smart TV on the same Wi-Fi network");
  setElText("#btn-copy-lan-url", "Скопировать адрес", "Copy URL");
  setElText(
    "#lan-qr-hint",
    "Наведите камеру iPhone или iPad на QR-код либо введите адрес в браузере телевизора. Потоки TorrServer и аудиоремукс транслируются напрямую с вашего Mac.",
    "Point your iPhone or iPad camera at the QR code or enter the URL in your TV browser. TorrServer streams and audio remuxing stream directly from your Mac."
  );
  setElText("#autostart-toggle-title", "Автозапуск сервера при входе в macOS (LaunchAgent)", "Start server automatically at macOS login (LaunchAgent)");
  setElText(
    "#autostart-toggle-sub",
    "Фоновый старт без терминала · для иконки в Dock выберите «Файл -> Добавить в Dock» в Safari",
    "Silent background startup without Terminal · to add to Dock, choose File -> Add to Dock in Safari"
  );

  // Settings Tab 3: Backup & Footer
  setElText("#quick-backup-card .atv-backup-quick-head h4 > span", "Резервная копия истории и настроек", "Backup Watch History & Settings");
  setElText("#btn-quick-export-backup > span", "Скачать копию (.json)", "Export Backup (.json)");
  setElText("#btn-quick-import-backup > span", "Восстановить из файла (.json)", "Import File (.json)");
  setElText("#btn-copy-backup-clipboard > span", "Скопировать", "Copy JSON");
  setElAttr("#btn-copy-backup-clipboard", "title", "Скопировать JSON резервной копии в буфер обмена", "Copy backup JSON to clipboard");
  setElText("#btn-paste-backup-clipboard > span", "Вставить", "Paste JSON");
  setElAttr("#btn-paste-backup-clipboard", "title", "Восстановить резервную копию из буфера обмена", "Restore backup JSON from clipboard");
  setElText("#save-settings-btn", "Готово", "Done");

  // Person Modal
  setElAttr("#person-back-nav-btn", "title", "Вернуться назад", "Go back");
  setElAttr("#close-person-modal", "title", "Закрыть (Esc)", "Close (Esc)");
  setElText("#btn-person-search-catalog > span", "Найти в основном каталоге", "Find in Catalog");
  setElText(".atv-person-filmography-head > h3", "Фильмография", "Filmography");
  setElText("#person-modal-loading > span", "Загрузка фильмографии и оценок Kinorium...", "Loading filmography & Kinorium ratings...");

  // Confirm Modal (only when closed)
  if (document.getElementById("confirm-modal")?.classList.contains("hidden")) {
    setElText("#confirm-modal-title", "Подтвердите действие", "Confirm Action");
    setElText("#confirm-modal-cancel", "Отмена", "Cancel");
    setElText("#confirm-modal-accept", "Подтвердить", "Confirm");
  }

  // PiP Dock & Scroll-to-Top
  setElText(".atv-pip-dock-badge > span", "Мини-окно", "PiP Active");
  setElAttr("#btn-pip-dock-play", "title", "Пауза / Воспроизведение", "Play / Pause");
  setElAttr("#btn-pip-dock-next-ep", "title", "Следующая серия", "Next episode");
  setElText("#btn-pip-dock-next-ep > span", "Далее", "Next");
  setElAttr("#btn-pip-dock-restore", "title", "Развернуть окно плеера", "Restore player window");
  setElText("#btn-pip-dock-restore > span", "Плеер", "Player");
  setElAttr("#btn-pip-dock-close", "title", "Остановить видео и закрыть мини-окно", "Stop video & close PiP");
  setElAttr("#scroll-top-btn", "title", "Прокрутить страницу наверх", "Scroll to top");
  setElText("#scroll-top-btn > span", "Наверх", "Top");
}
