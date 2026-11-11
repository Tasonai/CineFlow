import { state } from "./state.js?v=20261111v1";

export function isEn() {
  return state.appLang === "en";
}

export function t(ruText, enText) {
  return state.appLang === "en" ? enText : ruText;
}

export function displayTitle(item) {
  if (!item) return "";
  const lang = state.appLang || "ru";
  const rawT = item.title || "";
  const rawO = item.orig_title || "";
  const rawEn = item.title_en || "";
  if (
    typeof item === "object" &&
    item._dtCacheLang === lang &&
    item._dtCacheRawT === rawT &&
    item._dtCacheRawO === rawO &&
    item._dtCacheRawEn === rawEn &&
    typeof item._dtCacheVal === "string"
  ) {
    return item._dtCacheVal;
  }
  let res = "";
  if (lang === "en") {
    const explicitEn = String(rawEn).trim();
    if (explicitEn && !hasCyrillicText(explicitEn)) {
      res = explicitEn;
    } else {
      const orig = String(rawO).trim();
      if (orig && !hasCyrillicText(orig)) {
        res = orig;
      } else {
        const fallbackRaw = orig || String(rawT).trim();
        res = hasCyrillicText(fallbackRaw) ? transliterateRuToEn(fallbackRaw) : fallbackRaw;
      }
    }
  } else {
    res = formatRussianTypography(String(rawT || rawO || ""));
  }
  if (typeof item === "object") {
    item._dtCacheLang = lang;
    item._dtCacheRawT = rawT;
    item._dtCacheRawO = rawO;
    item._dtCacheRawEn = rawEn;
    item._dtCacheVal = res;
  }
  return res;
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
  "чёрная комедия": "Dark Comedy",
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

const GENRE_EN_TO_RU = {
  drama: "Драма",
  "sci-fi": "Фантастика",
  "science fiction": "Фантастика",
  "sci-fi & fantasy": "Фантастика",
  fantasy: "Фэнтези",
  action: "Боевик",
  "action & adventure": "Боевик",
  thriller: "Триллер",
  "mystery & thriller": "Триллер",
  spy: "Шпионаж",
  satire: "Сатира",
  "dark comedy": "Чёрная комедия",
  comedy: "Комедия",
  crime: "Криминал",
  mystery: "Детектив",
  adventure: "Приключения",
  horror: "Ужасы",
  romance: "Мелодрама",
  biography: "Биография",
  history: "История",
  war: "Военный",
  "war & military": "Военный",
  family: "Семейный",
  "kids & family": "Семейный",
  animation: "Мультфильм",
  anime: "Аниме",
  documentary: "Документальный",
  sport: "Спорт",
  sports: "Спорт",
  music: "Музыка",
  "music & musical": "Мюзикл",
  musical: "Мюзикл",
  western: "Вестерн",
  short: "Короткометражка",
  "reality tv": "Реальное ТВ",
  "talk show": "Ток-шоу",
  kids: "Детский",
  "film-noir": "Нуар",
  series: "Сериал",
  movie: "Фильм",
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
  "/rodzina-soprano",
  "/lalka-2026",
  "/lalka.",
  "/pingwin",
  "/mroczna-materia",
  "/ostatni-z-nas",
  "/reacher-",
];

const _POLISH_POSTER_SLUG_RE =
  /\/silos\.|\/wiedzmin|\/szogun|\/skazana|\/diuna-czesc|\/dzentelmeni|\/czas-krwawego|\/furiosa-saga|\/rozdzielenie|\/kulawe-konie|\/rod-smoka|\/rodzina-soprano|\/lalka-2026|\/lalka\.|\/pingwin|\/mroczna-materia|\/ostatni-z-nas|\/reacher-/i;

export function isLocalizedNonEnImage(rawUrl) {
  const low = String(rawUrl || "").trim().toLowerCase();
  if (!low) return true;
  return (
    low.includes("ru-images.kinorium.com") ||
    low.includes("kinopoisk") ||
    low.includes("rezka") ||
    _POLISH_POSTER_SLUG_RE.test(low)
  );
}

export function hasCyrillicText(str) {
  return /[А-Яа-яЁёІіЇїЄєҐґ]/.test(String(str || ""));
}

const _translitCache = new Map();

export function transliterateRuToEn(str) {
  const s = String(str || "");
  if (!hasCyrillicText(s)) return s;
  const cached = _translitCache.get(s);
  if (cached !== undefined) return cached;
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
  if (_translitCache.size >= 1500) _translitCache.clear();
  _translitCache.set(s, out);
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

const _RU_TYPO_PREP_RE =
  /(^|[\s«"(—–\u00A0])(в|во|на|с|со|к|ко|о|об|обо|у|и|а|но|да|или|за|из|от|по|до|не|ни|без|для|над|под|при|про)\s+/gi;
const _RU_TYPO_PARTICLE_RE = /\s+(бы|б|же|ж|ли|ль)(?=[\s.,!?;:»")\]—–]|$)/gi;
const _RU_TYPO_NUM_UNIT_RE =
  /(\d+)\s+(год[аов]?|лет|г\.|клик|сери[ияй]|сезон[аов]?|сек(?:унд[ыа]?)?|мин(?:ут[ыа]?)?|ч(?:ас[аов]?)?|дн(?:я|ей|ень)|стран[ыа]?|фильм[аов]?|тайтл[аов]?|оцен[каиок]+|друз(?:ья|ей)|ГБ|МБ|ТБ|КБ|%)/gi;
const _RU_TYPO_NO_RE = /№\s*(\d+)/g;
const _RU_TYPO_4K_RE = /\b4K\s+(UHD|HDR|Remux)\b/g;
const _RU_TYPO_DASH_RE = /\s+—/g;
const _ruTypoCache = new Map();

export function formatRussianTypography(rawText) {
  const s = String(rawText || "");
  if (!s) return "";
  const cached = _ruTypoCache.get(s);
  if (cached !== undefined) return cached;
  const formatted = s
    .replace(_RU_TYPO_PREP_RE, "$1$2\u00A0")
    .replace(_RU_TYPO_PREP_RE, "$1$2\u00A0")
    .replace(_RU_TYPO_PARTICLE_RE, "\u00A0$1")
    .replace(_RU_TYPO_NUM_UNIT_RE, "$1\u00A0$2")
    .replace(_RU_TYPO_NO_RE, "№\u00A0$1")
    .replace(_RU_TYPO_4K_RE, "4K\u00A0$1")
    .replace(_RU_TYPO_DASH_RE, "\u00A0—");
  if (_ruTypoCache.size >= 1500) _ruTypoCache.clear();
  _ruTypoCache.set(s, formatted);
  return formatted;
}

export function displayDescription(item) {
  if (!item) return "";
  if (state.appLang === "en") {
    const enDesc = String(item.description_en || "").trim();
    if (enDesc && !hasCyrillicText(enDesc)) return enDesc;
    return translateKinoriumExtraInfoToEn(item.description || "");
  }
  return formatRussianTypography(item.description || "");
}

export function displayPoster(item) {
  if (!item) return "";
  const basePoster = String(item.poster || item.backdrop || "").trim();
  if (state.appLang !== "en") {
    return basePoster;
  }
  const explicitEn = String(item.poster_en || "").trim();
  const itemId = String(item.id || "").trim();
  const kid = String(
    item.kinorium_id ||
      item.kinorium?.kinorium_id ||
      (itemId.startsWith("kin_") ? itemId.slice(4) : "") ||
      ""
  ).trim();
  const pKey = `en|${basePoster}|${explicitEn}|${itemId}|${kid}`;
  if (item._dispPosterKey === pKey && typeof item._dispPosterVal === "string") {
    return item._dispPosterVal;
  }
  if (explicitEn && !explicitEn.includes("ru-images.kinorium.com")) {
    item._dispPosterKey = pKey;
    item._dispPosterVal = explicitEn;
    return explicitEn;
  }
  const imdbId = String(item.imdb_id || (itemId.startsWith("tt") ? itemId : "") || "").trim();

  const lowPoster = basePoster.toLowerCase();
  const isLocalized =
    !basePoster ||
    lowPoster.includes("ru-images.kinorium.com") ||
    lowPoster.includes("kinopoisk") ||
    lowPoster.includes("rezka") ||
    _POLISH_POSTER_SLUG_RE.test(lowPoster);

  let outPoster = basePoster;
  if (isLocalized) {
    if (/^tt\d{5,10}$/.test(imdbId)) {
      outPoster = `https://images.metahub.space/poster/medium/${imdbId}/img`;
    } else if (/^\d+$/.test(kid)) {
      outPoster = `https://en-images.kinorium.com/movie/600/${kid}.jpg`;
    } else if (basePoster.includes("ru-images.kinorium.com/movie/")) {
      outPoster = basePoster.replace("ru-images.kinorium.com/movie/", "en-images.kinorium.com/movie/");
    }
  }
  item._dispPosterKey = pKey;
  item._dispPosterVal = outPoster;
  return outPoster;
}

function isVerticalPosterLikeUrl(url, item) {
  const u = String(url || "").trim();
  if (!u) return true;
  if (
    u.includes("/background/") ||
    u.includes("/t/p/original/") ||
    u.includes("/t/p/w1280/") ||
    u.includes("/t/p/w780/")
  ) {
    return false;
  }
  if (
    u.includes("kinorium.com/movie/") ||
    u.includes("/poster/") ||
    u.includes("/t/p/w500/") ||
    u.includes("/t/p/w342/") ||
    u.includes("statichdrezka") ||
    u.includes("rezka")
  ) {
    return true;
  }
  const pRu = String(item?.poster || "").trim();
  const pEn = String(item?.poster_en || "").trim();
  if ((pRu && u === pRu) || (pEn && u === pEn)) {
    return true;
  }
  return false;
}

export function displayBackdrop(item) {
  if (!item) return "";
  const rawBackdrop = String(item.backdrop || "").trim();
  const explicitEn = String(item.backdrop_en || "").trim();
  const itemId = String(item.id || "").trim();
  const bgKey = `${state.appLang || "ru"}|${rawBackdrop}|${explicitEn}|${itemId}|${item.poster || ""}`;
  if (item._dispBackdropKey === bgKey && typeof item._dispBackdropVal === "string") {
    return item._dispBackdropVal;
  }
  const imdbId = String(item.imdb_id || (itemId.startsWith("tt") ? itemId : "") || "").trim();
  const metahubBg = /^tt\d{5,10}$/.test(imdbId)
    ? `https://images.metahub.space/background/medium/${imdbId}/img`
    : "";

  let outBg = "";
  if (state.appLang !== "en") {
    if (rawBackdrop && !isVerticalPosterLikeUrl(rawBackdrop, item)) {
      outBg = rawBackdrop;
    } else if (explicitEn && !isVerticalPosterLikeUrl(explicitEn, item)) {
      outBg = explicitEn;
    } else if (metahubBg) {
      outBg = metahubBg;
    } else {
      outBg = rawBackdrop || explicitEn || String(item.poster || "").trim();
    }
    item._dispBackdropKey = bgKey;
    item._dispBackdropVal = outBg;
    return outBg;
  }

  if (explicitEn && !isLocalizedNonEnImage(explicitEn) && !isVerticalPosterLikeUrl(explicitEn, item)) {
    outBg = explicitEn;
  } else if (rawBackdrop && !isLocalizedNonEnImage(rawBackdrop) && !isVerticalPosterLikeUrl(rawBackdrop, item)) {
    outBg = rawBackdrop;
  } else if (metahubBg) {
    outBg = metahubBg;
  } else if (explicitEn && !isLocalizedNonEnImage(explicitEn)) {
    outBg = explicitEn;
  } else if (rawBackdrop && !isLocalizedNonEnImage(rawBackdrop)) {
    outBg = rawBackdrop;
  } else {
    const kid = String(
      item.kinorium_id ||
        item.kinorium?.kinorium_id ||
        (itemId.startsWith("kin_") ? itemId.slice(4) : "") ||
        ""
    ).trim();
    if (/^\d+$/.test(kid)) {
      outBg = `https://en-images.kinorium.com/movie/1080/${kid}.jpg`;
    } else {
      outBg = displayPoster(item);
    }
  }
  item._dispBackdropKey = bgKey;
  item._dispBackdropVal = outBg;
  return outBg;
}

const BUILTIN_ADDON_DESC_EN = {
  "com.stremio.torrentio.ru.addon":
    "4K Dolby Vision, HDR, and 1080p streams with Original English and multi-language audio tracks",
  "org.stremio.opensubtitlesv3":
    "Official Stremio subtitles addon (English, Russian, Polish, and international subtitles)",
  "com.stremio.tpbplus.addon":
    "Additional international Stremio stream catalog with original audio",
};

export function displayAddonDescription(addon) {
  if (!addon) return "";
  if (state.appLang === "en") {
    const enDesc = String(addon.description_en || "").trim();
    if (enDesc && !hasCyrillicText(enDesc)) return enDesc;
    const mapped = BUILTIN_ADDON_DESC_EN[String(addon.id || "")];
    if (mapped) return mapped;
    const raw = String(addon.description || "").trim();
    return hasCyrillicText(raw) ? transliterateRuToEn(raw) : raw;
  }
  return String(addon.description_ru || addon.description || "").trim();
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
  if (!raw) return "";
  const low = raw.toLowerCase();
  if (state.appLang === "en") {
    return GENRE_RU_TO_EN[low] || raw;
  }
  return GENRE_EN_TO_RU[low] || raw;
}

const GENERIC_GENRE_PLACEHOLDERS = new Set([
  "фильм",
  "сериал",
  "movie",
  "series",
  "зарубежные",
  "русские",
  "украинские",
  "советские",
]);

export function getItemGenreEntries(item) {
  if (!item) return [];
  const baseGenres = Array.isArray(item.genres) ? item.genres : [];
  const enGenres = Array.isArray(item.genres_en) ? item.genres_en : [];
  const cacheKey = `${state.appLang || "ru"}|${baseGenres.length}|${enGenres.length}|${baseGenres[0] || ""}|${enGenres[0] || ""}`;
  if (item._genreEntriesCacheKey === cacheKey && Array.isArray(item._genreEntriesCacheVal)) {
    return item._genreEntriesCacheVal;
  }
  const hasRealBase = baseGenres.some((g) => {
    const low = String(g || "").trim().toLowerCase();
    return low && !GENERIC_GENRE_PLACEHOLDERS.has(low);
  });
  const sourceList = isEn()
    ? enGenres.length > 0
      ? enGenres
      : baseGenres
    : hasRealBase
      ? baseGenres
      : enGenres;

  const entries = [];
  const seenKeys = new Set();
  sourceList.forEach((rawVal) => {
    const raw = String(rawVal || "").trim();
    if (!raw) return;
    const low = raw.toLowerCase();
    if (GENERIC_GENRE_PLACEHOLDERS.has(low)) return;
    const canonRu = GENRE_EN_TO_RU[low] || (hasCyrillicText(raw) ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw);
    const canonEn = GENRE_RU_TO_EN[canonRu.toLowerCase()] || GENRE_RU_TO_EN[low] || raw;
    const label = state.appLang === "en" ? canonEn : canonRu;
    const dedupeKey = label.toLowerCase();
    if (seenKeys.has(dedupeKey)) return;
    seenKeys.add(dedupeKey);
    entries.push({
      raw,
      ru: canonRu,
      en: canonEn,
      label,
    });
  });
  item._genreEntriesCacheKey = cacheKey;
  item._genreEntriesCacheVal = entries;
  return entries;
}

export function mergeIncomingItemGenres(item, payload) {
  if (!item || !payload) return false;
  let updated = false;
  if (Array.isArray(payload.genres_en) && payload.genres_en.length > 0) {
    const cleanEn = payload.genres_en.map((g) => String(g || "").trim()).filter(Boolean);
    if (cleanEn.length > 0) {
      item.genres_en = cleanEn;
      updated = true;
    }
  }
  if (Array.isArray(payload.genres) && payload.genres.length > 0) {
    const incomingReal = payload.genres
      .map((g) => String(g || "").trim())
      .filter((g) => g && !GENERIC_GENRE_PLACEHOLDERS.has(g.toLowerCase()));
    const existingRealCount = (Array.isArray(item.genres) ? item.genres : []).filter(
      (g) => g && !GENERIC_GENRE_PLACEHOLDERS.has(String(g).trim().toLowerCase())
    ).length;
    if (incomingReal.length > 0 && existingRealCount === 0) {
      item.genres = incomingReal;
      updated = true;
    }
  }
  if (Array.isArray(payload.countries_en) && payload.countries_en.length > 0) {
    const cleanCEn = payload.countries_en.map((c) => String(c || "").trim()).filter(Boolean);
    if (cleanCEn.length > 0) {
      item.countries_en = cleanCEn;
      updated = true;
    }
  }
  if (Array.isArray(payload.countries) && payload.countries.length > 0) {
    const cleanCRu = payload.countries.map((c) => String(c || "").trim()).filter(Boolean);
    if (cleanCRu.length > 0) {
      item.countries = cleanCRu;
      updated = true;
    }
  }
  if (updated) {
    item._genreEntriesCacheKey = "";
    item._genreEntriesCacheVal = null;
  }
  return updated;
}

const COUNTRY_EN_TO_RU = {
  "united states": "США",
  "united states of america": "США",
  usa: "США",
  us: "США",
  "united kingdom": "Великобритания",
  uk: "Великобритания",
  "great britain": "Великобритания",
  canada: "Канада",
  australia: "Австралия",
  "new zealand": "Новая Зеландия",
  ireland: "Ирландия",
  france: "Франция",
  germany: "Германия",
  "west germany": "ФРГ",
  italy: "Италия",
  spain: "Испания",
  portugal: "Португалия",
  netherlands: "Нидерланды",
  belgium: "Бельгия",
  switzerland: "Швейцария",
  austria: "Австрия",
  sweden: "Швеция",
  norway: "Норвегия",
  denmark: "Дания",
  finland: "Финляндия",
  iceland: "Исландия",
  poland: "Польша",
  czechia: "Чехия",
  "czech republic": "Чехия",
  slovakia: "Словакия",
  hungary: "Венгрия",
  romania: "Румыния",
  bulgaria: "Болгария",
  greece: "Греция",
  turkey: "Турция",
  ukraine: "Украина",
  russia: "Россия",
  ussr: "СССР",
  belarus: "Беларусь",
  kazakhstan: "Казахстан",
  georgia: "Грузия",
  armenia: "Армения",
  japan: "Япония",
  "south korea": "Южная Корея",
  korea: "Южная Корея",
  china: "Китай",
  "hong kong": "Гонконг",
  taiwan: "Тайвань",
  india: "Индия",
  thailand: "Таиланд",
  indonesia: "Индонезия",
  singapore: "Сингапур",
  philippines: "Филиппины",
  vietnam: "Вьетнам",
  malaysia: "Малайзия",
  israel: "Израиль",
  uae: "ОАЭ",
  "saudi arabia": "Саудовская Аравия",
  iran: "Иран",
  egypt: "Египет",
  "south africa": "ЮАР",
  morocco: "Марокко",
  mexico: "Мексика",
  brazil: "Бразилия",
  argentina: "Аргентина",
  chile: "Чили",
  colombia: "Колумбия",
  peru: "Перу",
  luxembourg: "Люксембург",
  estonia: "Эстония",
  latvia: "Латвия",
  lithuania: "Литва",
  serbia: "Сербия",
  croatia: "Хорватия",
};

const COUNTRY_RU_CANONICAL = {
  сша: "США",
  великобритания: "Великобритания",
  англия: "Великобритания",
  канада: "Канада",
  австралия: "Австралия",
  "новая зеландия": "Новая Зеландия",
  ирландия: "Ирландия",
  франция: "Франция",
  германия: "Германия",
  фрг: "ФРГ",
  италия: "Италия",
  испания: "Испания",
  португалия: "Португалия",
  нидерланды: "Нидерланды",
  бельгия: "Бельгия",
  швейцария: "Швейцария",
  австрия: "Австрия",
  швеция: "Швеция",
  норвегия: "Норвегия",
  дания: "Дания",
  финляндия: "Финляндия",
  исландия: "Исландия",
  польша: "Польша",
  чехия: "Чехия",
  словакия: "Словакия",
  венгрия: "Венгрия",
  румыния: "Румыния",
  болгария: "Болгария",
  греция: "Греция",
  турция: "Турция",
  украина: "Украина",
  россия: "Россия",
  ссср: "СССР",
  беларусь: "Беларусь",
  казахстан: "Казахстан",
  грузия: "Грузия",
  армения: "Армения",
  япония: "Япония",
  "южная корея": "Южная Корея",
  "корея южная": "Южная Корея",
  корея: "Южная Корея",
  китай: "Китай",
  гонконг: "Гонконг",
  тайвань: "Тайвань",
  индия: "Индия",
  таиланд: "Таиланд",
  индонезия: "Индонезия",
  сингапур: "Сингапур",
  филиппины: "Филиппины",
  вьетнам: "Вьетнам",
  малайзия: "Малайзия",
  израиль: "Израиль",
  оаэ: "ОАЭ",
  "саудовская аравия": "Саудовская Аравия",
  иран: "Иран",
  египет: "Египет",
  юар: "ЮАР",
  марокко: "Марокко",
  мексика: "Мексика",
  бразилия: "Бразилия",
  аргентина: "Аргентина",
  чили: "Чили",
  колумбия: "Колумбия",
  перу: "Перу",
  люксембург: "Люксембург",
  эстония: "Эстония",
  латвия: "Латвия",
  литва: "Литва",
  сербия: "Сербия",
  хорватия: "Хорватия",
};

const COUNTRY_RU_TO_EN_KEYS = Object.keys(COUNTRY_RU_TO_EN);

export function displayCountries(item, streamData = null) {
  if (!item) return "";
  const en = state.appLang === "en";
  if (!streamData) {
    const cCacheKey = `${en ? "en" : "ru"}|${(item.countries || []).length}|${(item.countries_en || []).length}|${item.countries?.[0] || ""}|${item.countries_en?.[0] || ""}`;
    if (item._dispCountriesKey === cCacheKey && typeof item._dispCountriesVal === "string") {
      return item._dispCountriesVal;
    }
    const res = _computeDisplayCountries(item, null, en);
    item._dispCountriesKey = cCacheKey;
    item._dispCountriesVal = res;
    return res;
  }
  return _computeDisplayCountries(item, streamData, en);
}

function _computeDisplayCountries(item, streamData, en) {
  const rawSources = en
    ? [streamData?.countries_en, item.countries_en, streamData?.countries, item.countries]
    : [streamData?.countries, item.countries, streamData?.countries_en, item.countries_en];
  let list = [];
  for (const src of rawSources) {
    if (Array.isArray(src) && src.length > 0) {
      list = src;
      break;
    } else if (typeof src === "string" && src.trim()) {
      list = src.split(",");
      break;
    }
  }
  if (list.length === 0) {
    const desc = String(item.description || "").trim();
    if (desc && (desc.includes("•") || desc.length < 135)) {
      const tokens = desc
        .split(/[•,]/)
        .map((t) => t.trim().replace(/\.$/, ""))
        .filter(Boolean);
      const extracted = [];
      for (const tok of tokens) {
        const low = tok.toLowerCase();
        if (COUNTRY_RU_TO_EN[low]) {
          extracted.push(tok);
          continue;
        }
        for (const ruC of COUNTRY_RU_TO_EN_KEYS) {
          if (low.endsWith(` ${ruC}`)) {
            extracted.push(ruC);
            break;
          }
        }
      }
      if (extracted.length > 0) {
        list = extracted;
      }
    }
  }
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const s = String(raw || "").trim().replace(/^[,.;:]+|[,.;:]+$/g, "");
    if (!s) continue;
    const low = s.toLowerCase();
    const mapped = en
      ? COUNTRY_RU_TO_EN[low] || (hasCyrillicText(s) ? transliterateRuToEn(s) : s)
      : COUNTRY_RU_CANONICAL[low] || COUNTRY_EN_TO_RU[low] || s;
    const k = mapped.toLowerCase();
    if (mapped && !seen.has(k)) {
      seen.add(k);
      out.push(mapped);
    }
  }
  return out.slice(0, 3).join(", ");
}

const _studioTransCache = new Map();

export function translateStudioName(name) {
  const raw = String(name || "").trim();
  if (!raw || state.appLang !== "en") return raw;
  const cached = _studioTransCache.get(raw);
  if (cached !== undefined) return cached;
  const translated = raw
    .replace(/Оригинал\s*\(\+субтитры\)/gi, "Original (+subtitles)")
    .replace(/Оригинальная\s+дорожка/gi, "Original Audio")
    .replace(/^Оригинал$/i, "Original")
    .replace(/Оригинал/gi, "Original")
    .replace(/Русская\s+дорожка/gi, "Russian Audio")
    .replace(/Профессиональный\s+перевод/gi, "Professional Dub")
    .replace(/Профессиональный\s+многоголосый/gi, "Pro Multi-voice")
    .replace(/Профессиональный\s+двухголосый/gi, "Pro Two-voice")
    .replace(/Профессиональный\s+одноголосый/gi, "Pro Single-voice")
    .replace(/Профессиональный/gi, "Professional")
    .replace(/Любительский\s+многоголосый/gi, "Indie Multi-voice")
    .replace(/Любительский\s+двухголосый/gi, "Indie Two-voice")
    .replace(/Любительский\s+одноголосый/gi, "Indie Single-voice")
    .replace(/Любительский/gi, "Amateur")
    .replace(/Авторский/gi, "Author's voice")
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
    .replace(/Русский|Русская/gi, "Russian")
    .replace(/Английский|Английская/gi, "English")
    .replace(/Українська|Украинский|Украинская/gi, "Ukrainian")
    .replace(/Укр\./gi, "UA");
  if (_studioTransCache.size >= 500) _studioTransCache.clear();
  _studioTransCache.set(raw, translated);
  return translated;
}

export function translateCareer(careerText) {
  const raw = String(careerText || "").trim();
  if (!raw) return raw;
  if (state.appLang !== "en") {
    return raw
      .replace(/Режиссер/g, "Режиссёр")
      .replace(/режиссер/g, "режиссёр")
      .replace(/Актер/g, "Актёр")
      .replace(/актер/g, "актёр");
  }
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

const _SIMPLE_ID_SEL_RE = /^#[A-Za-z0-9_-]+$/;

function setElText(sel, ru, en) {
  const el = _SIMPLE_ID_SEL_RE.test(sel)
    ? document.getElementById(sel.slice(1))
    : document.querySelector(sel);
  if (el) {
    const val =
      state.appLang === "en" ? en : ru && ru.length >= 16 ? formatRussianTypography(ru) : ru;
    if (el.textContent !== val) {
      el.textContent = val;
    }
  }
}

function setElAttr(sel, attr, ru, en) {
  const el = _SIMPLE_ID_SEL_RE.test(sel)
    ? document.getElementById(sel.slice(1))
    : document.querySelector(sel);
  if (el) {
    const val = state.appLang === "en" ? en : ru;
    if (el.getAttribute(attr) !== val) {
      el.setAttribute(attr, val);
    }
  }
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
        ? "Original audio selected by default"
        : "Русская озвучка по умолчанию";
  }
}

let _lastAppliedStaticDomLang = "";

export function applyStaticDomTranslations(force = false) {
  const en = state.appLang === "en";
  const targetLang = en ? "en" : "ru";
  if (typeof document === "undefined") return;
  document.documentElement.lang = targetLang;
  if (!force && _lastAppliedStaticDomLang === targetLang) {
    const gearAudioValEl = document.getElementById("gear-audio-offset-val");
    if (gearAudioValEl) {
      const aOff = Math.round((Number(state.audioOffsetSec) || 0) * 100) / 100;
      const aSign = aOff > 0.004 ? "+" : aOff < -0.004 ? "−" : "";
      gearAudioValEl.textContent = `${aSign}${Math.abs(aOff).toFixed(2)} ${en ? "s" : "с"}`;
    }
    return;
  }
  _lastAppliedStaticDomLang = targetLang;

  // Top Header & Navigation
  setElAttr("#brand-home", "aria-label", "Velarium — на главную", "Velarium — back to Home");
  setElText('#media-type-bar .type-pill[data-type="all"]', "Все", "All");
  setElText('#media-type-bar .type-pill[data-type="movie"]', "Фильмы", "Movies");
  setElText('#media-type-bar .type-pill[data-type="series"]', "Сериалы", "Series");
  setElText('#type-pill-offline', "Скачано", "Downloaded");
  setElText('#offline-banner-title', "Офлайн-режим", "Offline Mode");
  setElText('#offline-banner-sub', "Нет подключения к сети. Доступны скачанные фильмы и серии для просмотра без интернета.", "No network connection. Downloaded movies and series are available for offline playback.");
  setElText('#btn-offline-banner-view', "Скачанные файлы", "Downloaded Files");
  setElText('#btn-offline-banner-retry', "Повторить подключение", "Retry Connection");
  setElText('#provider-filter-bar .atv-pill[data-provider="all"]', "Все источники", "All Sources");

  setElAttr("#global-search", "placeholder", "Поиск...", "Search...");
  const isMacPlatform =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/i.test(String(navigator.platform || navigator.userAgent || ""));
  const searchKbdEl = document.getElementById("search-kbd-hint");
  if (searchKbdEl) {
    searchKbdEl.textContent = isMacPlatform ? "⌘K" : "Ctrl+K";
  }
  setElAttr("#search-kbd-hint", "title", "Быстрый поиск (Cmd+K / Ctrl+K)", "Quick search (Cmd+K / Ctrl+K)");
  setElAttr("#btn-clear-search", "title", "Очистить поиск", "Clear search");
  setElAttr("#btn-clear-search", "aria-label", "Очистить поиск", "Clear search");
  setElAttr("#btn-open-stats-modal", "title", "Моя статистика и история просмотров", "My statistics & watch history");
  setElAttr("#btn-open-stats-modal", "aria-label", "Моя статистика и история просмотров", "My statistics & watch history");
  setElAttr("#notifications-bell-btn", "title", "Новые серии и календарь релизов", "New episodes & release calendar");
  setElAttr("#notifications-bell-btn", "aria-label", "Новые серии и календарь релизов", "New episodes & release calendar");
  setElText("#notif-popover-title", "Серии и расписание", "Episodes & Schedule");
  setElText("#notif-tab-updates", "Новые серии", "New Episodes");
  setElText("#notif-tab-calendar", "Календарь релизов", "Release Calendar");
  setElAttr("#btn-check-rezka-updates", "title", "Проверить реальные вышедшие серии и озвучки на HDRezka", "Check latest released episodes & audio tracks on HDRezka");
  setElAttr("#btn-mark-notifs-read", "title", "Отметить все уведомления прочитанными", "Mark all notifications as read");
  setElText("#btn-mark-notifs-read span", "Прочитано", "Mark read");
  setElAttr("#open-settings-btn", "title", "Настройки и интеграции (⌘,)", "Settings & integrations (⌘,)");
  setElAttr("#open-settings-btn", "aria-label", "Настройки и интеграции", "Settings & integrations");

  // Service Login Banner & Hero Controls
  setElText("#banner-login-btn", "Войти в аккаунт", "Sign in");
  setElText("#banner-confirm-login-btn", "Подтвердить вход", "Confirm sign-in");
  setElText("#banner-open-integrations-btn", "Все интеграции", "All integrations");
  setElAttr("#hero-prev-btn", "title", "Предыдущий слайд", "Previous slide");
  setElAttr("#hero-prev-btn", "aria-label", "Предыдущий слайд", "Previous slide");
  setElAttr("#hero-next-btn", "title", "Следующий слайд", "Next slide");
  setElAttr("#hero-next-btn", "aria-label", "Следующий слайд", "Next slide");

  // Kinorium Sections Bar (preserve count badges)
  const ksecLabels = {
    all: en ? "All Catalog" : "Весь каталог",
    premieres: en ? "Premieres " : "Премьеры ",
    watching: en ? "Watching " : "Смотрю ",
    watchlist: en ? "Watchlist " : "Буду смотреть ",
    watched: en ? "Watched " : "Просмотрено ",
    never: en ? "Hidden " : "Скрытые ",
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
  setElText('#select-catalog-sort option[value="default"]', "По умолчанию", "Default sort");
  setElText('#select-catalog-sort option[value="user_rating"]', "По моей оценке (10 - 1)", "My Rating (10 - 1)");
  setElText('#select-catalog-sort option[value="friends_rating"]', "По оценкам друзей (10 - 1)", "Friends' Ratings (10 - 1)");
  setElText('#select-catalog-sort option[value="kinorium_rating"]', "По рейтингу Кинориума", "Kinorium Rating");
  setElText('#select-catalog-sort option[value="year_desc"]', "По году (сначала новые)", "Release Year (Newest)");

  setElAttr("#btn-toggle-catalog-filters", "title", "Показать или скрыть панель фильтров", "Show or hide filters panel");
  setElText("#btn-toggle-catalog-filters > span:not(.atv-filter-count-badge)", "Фильтры", "Filters");
  setElAttr("#btn-random-pick", "title", "Мгновенно открыть случайный тайтл из текущего отфильтрованного списка", "Instantly open a random title from the current filtered list");
  setElText("#btn-random-pick > span", "Случайный", "Random");
  setElAttr("#btn-toggle-curated-shelves", "title", "Переключить между тематическими подборками и обычной сеткой", "Switch between curated shelves and standard grid");
  setElText("#lbl-toggle-curated-shelves", "Подборки", "Collections");
  setElAttr("#btn-open-release-calendar", "title", "Календарь премьер и график выхода новых серий", "Premiere calendar and new episodes schedule");
  setElText("#lbl-open-release-calendar", "График серий", "Schedule");

  setElAttr("#select-catalog-genre", "title", "Фильтр по жанру", "Filter by genre");
  setElAttr("#select-catalog-year", "title", "Фильтр по году выпуска", "Filter by release year");
  setElAttr("#select-catalog-collection", "title", "Умные коллекции и фильтр по озвучке", "Smart collections and voiceover studio filter");
  setElAttr("#btn-hide-watched", "title", "Скрыть уже просмотренные фильмы и сериалы", "Hide already watched movies and series");
  setElText("#btn-hide-watched > span", "Скрыть просмотренные", "Hide watched");
  setElAttr("#btn-friends-filter", "title", "Показать только тайтлы, которые оценили ваши друзья на Kinorium", "Show only titles rated by your Kinorium friends");
  setElText("#btn-friends-filter > span", "Оценили друзья", "Rated by friends");
  setElAttr("#select-friend-filter", "title", "Фильтр по конкретному другу из Kinorium", "Filter by specific Kinorium friend");
  setElAttr("#btn-clear-catalog-filters", "title", "Сбросить все активные фильтры и сортировку", "Reset all active filters and sorting");
  setElText("#btn-clear-catalog-filters > span", "Сбросить", "Reset");

  // Shelves Headings
  setElText("#continue-watching-section .atv-section-header h2", "Продолжить просмотр", "Continue Watching");
  setElText("#release-calendar-shelf-heading", "Календарь новых серий", "New Episodes Schedule");
  setElText("#series-heading", "Сериалы", "Series");
  setElText("#movies-heading", "Фильмы", "Movies");
  setElText("#search-similar-heading", "Похожие тайтлы", "Similar Titles");

  // Cinema Player Modal Header & Tabs
  setElAttr('.source-tab[data-tab="hdrezka"]', "title", "Прямой поток 1080p с HDRezka без регистрации", "Direct 1080p stream from HDRezka without registration");
  setElAttr('.source-tab[data-tab="stremio"]', "title", "Потоки и субтитры из аддонов Stremio (Torrentio, OpenSubtitles и свои manifest.json)", "Streams & subtitles from Stremio addons (Torrentio, OpenSubtitles & custom manifest.json)");
  setElAttr('.source-tab[data-tab="backup4k"]', "title", "Потоки 4K UHD HDR / BDRemux", "4K UHD HDR / BDRemux streams");
  setElText("#tab-btn-trailer", "Трейлер", "Trailer");
  setElAttr("#tab-btn-trailer", "title", "Русский и оригинальный трейлер", "Original & localized trailers");

  setElAttr("#btn-kinorium-status-menu", "title", "Изменить статус фильма или сериала в Kinorium", "Change movie or series status on Kinorium");
  setElText("#kinorium-status-popover .atv-status-popover-title", "Список в Kinorium", "Kinorium List");
  setElAttr("#btn-open-rate", "title", "Поставить оценку в Kinorium", "Rate on Kinorium");
  setElText("#postwatch-scope-ep", "Эта серия", "This Episode");
  setElText("#postwatch-scope-series", "Весь сериал", "Entire Series");
  setElText("#postwatch-clear-rate-btn", "Сбросить", "Clear");
  setElAttr("#postwatch-clear-rate-btn", "title", "Удалить поставленную оценку", "Delete rating");
  setElAttr("#close-postwatch-btn", "title", "Скрыть карточку оценки", "Hide rating card");
  setElAttr("#close-postwatch-btn", "aria-label", "Скрыть карточку оценки", "Hide rating card");
  setElAttr("#postwatch-comment", "placeholder", "Комментарий к оценке (необязательно)", "Rating comment (optional)");
  setElText("#btn-save-postwatch", "Сохранить", "Save");
  setElText("#player-sidebar-btn-label", "Широкий экран", "Wide View");
  setElAttr("#meta-genres-list", "aria-label", "Жанры", "Genres");
  setElAttr("#btn-toggle-player-sidebar", "title", "Широкий экран без боковой панели (T)", "Wide theater view without sidebar (T)");
  setElAttr("#btn-toggle-player-sidebar", "aria-label", "Широкий экран без боковой панели (T)", "Wide theater view without sidebar (T)");
  setElAttr("#close-player-modal", "title", "Закрыть (Esc)", "Close (Esc)");
  setElAttr("#close-player-modal", "aria-label", "Закрыть плеер", "Close player");

  // Mini-Player Bar
  setElAttr("#mini-player-bar", "title", "Перетащите за панель в любой угол экрана (двойной клик — развернуть)", "Drag bar to any screen corner (double-click to expand)");
  setElAttr("#btn-mini-play-pause", "title", "Пауза / Воспроизведение", "Play / Pause");
  setElAttr("#btn-mini-play-pause", "aria-label", "Пауза / Воспроизведение", "Play / Pause");
  setElAttr("#btn-mini-next-ep", "title", "Следующая серия", "Next episode");
  setElText("#btn-mini-next-ep > span", "Далее", "Next");
  setElAttr("#btn-restore-mini-player", "title", "Развернуть плеер на весь экран", "Expand player");
  setElText("#btn-restore-mini-player > span", "Развернуть", "Expand");
  setElAttr("#btn-close-mini-player", "title", "Закрыть плеер", "Close player");
  setElAttr("#btn-close-mini-player", "aria-label", "Закрыть плеер", "Close player");

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
  setElText("#btn-video-err-studio > span", "Другая озвучка", "Other Audio");
  setElText("#btn-video-err-4k > span", "Открыть 4K", "Open 4K");
  setElText("#video-error-studios-title", "Выберите озвучку:", "Select Audio Track:");
  setElAttr("#btn-video-err-studios-close", "title", "Закрыть", "Close");
  setElAttr("#btn-video-err-studios-close", "aria-label", "Закрыть", "Close");

  setElText("#video-pip-placeholder .atv-pip-stage-title > span", "Видео открыто в режиме «Картинка в картинке»", "Video is playing in Picture-in-Picture");
  setElText("#video-pip-placeholder .atv-pip-stage-sub", "Переходите на главную страницу и выбирайте фильмы — воспроизведение не прервётся", "Browse the catalog freely — playback continues uninterrupted");
  setElText("#btn-pip-go-home > span", "На главную страницу", "Back to Catalog");
  setElText("#btn-pip-return-inline", "Вернуть в плеер", "Return to Player");

  setElText("#video-dropzone .atv-video-dropzone-title", "Перетащите сюда субтитры или видео", "Drop subtitles or video file here");
  setElText(
    "#video-dropzone .atv-video-dropzone-sub",
    "Поддерживаются .srt, .vtt, .ass, а также локальные .mp4, .mkv, .webm",
    "Supports .srt, .vtt, .ass, as well as local .mp4, .mkv, .webm"
  );
  setElText("#xray-pause-shelf .atv-xray-badge", "В кадре", "In Scene");
  const xrayTitleEl = document.getElementById("xray-title");
  if (xrayTitleEl && (xrayTitleEl.textContent === "Актёры" || xrayTitleEl.textContent === "Cast")) {
    xrayTitleEl.textContent = en ? "Cast" : "Актёры";
  }
  setElAttr("#btn-close-xray", "title", "Скрыть панель актёров", "Hide cast shelf");
  setElAttr("#btn-close-xray", "aria-label", "Скрыть панель актёров", "Hide cast shelf");
  setElText("#player-next-ep-toast .atv-next-ep-badge", "Следующая серия", "Next Episode");
  setElText("#next-ep-bridge-badge", "Бесшовный мост", "Seamless Bridge");
  setElText("#btn-next-ep-now > span", "Смотреть", "Watch");
  setElAttr("#btn-next-ep-cancel", "title", "Отмена", "Cancel");
  setElAttr("#btn-next-ep-cancel", "aria-label", "Отмена", "Cancel");
  setElAttr("#atv-sub-dict-popover", "aria-label", "Перевод слова", "Word translation");
  setElAttr("#btn-close-sub-dict", "title", "Закрыть и продолжить просмотр", "Close and resume playback");
  setElAttr("#btn-close-sub-dict", "aria-label", "Закрыть и продолжить просмотр", "Close and resume playback");
  setElText("#autoplay-next-card .atv-autoplay-kicker", "СЛЕДУЮЩИЙ ЭПИЗОД", "NEXT EPISODE");
  setElText("#skip-intro-btn", "Пропустить заставку", "Skip Intro");
  setElText("#skip-outro-btn", "Следующая серия", "Next Episode");
  setElText("#btn-autoplay-now > span", "Включить сейчас", "Play Now");
  setElText("#btn-autoplay-cancel", "Отмена", "Cancel");

  // Player Gear Popover
  setElText("#player-gear-popover .atv-gear-header > span", "Настройки плеера", "Player Settings");
  setElText("#btn-reset-player-gear", "Сбросить", "Reset");
  setElAttr("#btn-reset-player-gear", "title", "Сбросить все настройки плеера по умолчанию", "Reset all player settings to default");
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

  setElText("#gear-sub-sync-summary", "Субтитры и синхронизация", "Subtitles & Sync");
  setElText("#sub-size-group > span", "Размер", "Size");
  setElAttr("#select-sub-size", "title", "Размер шрифта субтитров", "Subtitle font size");
  setElText('#select-sub-size option[value="small"]', "Мелкие", "Small");
  setElText('#select-sub-size option[value="medium"]', "Средние", "Medium");
  setElText('#select-sub-size option[value="large"]', "Крупные", "Large");
  setElText('#select-sub-size option[value="xlarge"]', "Огромные", "Extra Large");

  setElText("#sub-font-group > span", "Шрифт", "Font");
  setElAttr("#select-sub-font", "title", "Гарнитура шрифта субтитров", "Subtitle font family");
  setElText('#select-sub-font option[value="sans"]', "SF Pro (Без засечек)", "SF Pro (Sans-serif)");
  setElText('#select-sub-font option[value="serif"]', "Кинотеатральный (С засечками)", "Cinema (Serif)");
  setElText('#select-sub-font option[value="mono"]', "Моноширинный", "Monospace");
  setElText('#select-sub-font option[value="rounded"]', "Мягкий скруглённый", "Rounded");

  setElText("#sub-color-group > span", "Цвет", "Color");
  setElAttr("#select-sub-color", "title", "Цвет текста субтитров", "Subtitle text color");
  setElText('#select-sub-color option[value="white"]', "Классический белый", "Classic White");
  setElText('#select-sub-color option[value="yellow"]', "Кинотеатральный жёлтый", "Cinema Yellow");
  setElText('#select-sub-color option[value="green"]', "Светло-зелёный", "Soft Green");
  setElText('#select-sub-color option[value="cyan"]', "Небесно-голубой", "Sky Cyan");

  setElText("#sub-edge-group > span", "Контур", "Outline");
  setElAttr("#select-sub-edge", "title", "Контур и тень субтитров", "Subtitle outline & shadow");
  setElText('#select-sub-edge option[value="soft"]', "Мягкая тень", "Soft Shadow");
  setElText('#select-sub-edge option[value="outline"]', "Чёткий контур", "Crisp Outline");
  setElText('#select-sub-edge option[value="heavy"]', "Глубокая тень", "Heavy Drop Shadow");
  setElText('#select-sub-edge option[value="none"]', "Без тени", "No Shadow");

  setElText("#sub-bg-group > span", "Фон", "Background");
  setElAttr("#select-sub-bg", "title", "Оформление подложки субтитров", "Subtitle background style");
  setElText('#select-sub-bg option[value="semi"]', "Полупрозрачный", "Semi-transparent");
  setElText('#select-sub-bg option[value="solid"]', "Тёмный фон", "Solid Dark");
  setElText('#select-sub-bg option[value="none"]', "Без фона (Тень)", "None (Drop Shadow)");

  setElText("#sleep-timer-group > span", "Таймер сна", "Sleep Timer");
  setElAttr("#select-sleep-timer", "title", "Таймер сна (автопауза через выбранное время или в конце серии)", "Sleep timer (auto-pause after selected time or at episode end)");
  setElText('#select-sleep-timer option[value="off"]', "Выключен", "Off");
  setElText('#select-sleep-timer option[value="15"]', "15 минут", "15 minutes");
  setElText('#select-sleep-timer option[value="30"]', "30 минут", "30 minutes");
  setElText('#select-sleep-timer option[value="45"]', "45 минут", "45 minutes");
  setElText('#select-sleep-timer option[value="60"]', "60 минут", "60 minutes");
  setElText('#select-sleep-timer option[value="episode_end"]', "Конец серии", "End of episode");

  setElText("#xray-tab-cast", "Актёры", "Cast");
  setElText("#xray-tab-soundtrack", "Саундтрек", "Soundtrack");
  setElText("#xray-tab-trivia", "Факты и пасхалки", "Trivia & Facts");
  setElText("#gear-seamless-bridge-label", "Бесшовный мост (мгновенный переход)", "Seamless Binge Bridge");
  setElText("#gear-xray-pause-label", "X-Ray при паузе", "X-Ray on pause");
  setElAttr("#xray-compact-pill", "aria-label", "Развернуть X-Ray (X)", "Expand X-Ray (X)");
  setElAttr("#xray-compact-pill", "title", "Развернуть X-Ray: актёры, музыка и факты (X)", "Expand X-Ray: cast, music & trivia (X)");
  setElAttr("#btn-close-xray", "aria-label", "Скрыть панель X-Ray", "Hide X-Ray panel");
  setElAttr("#btn-close-xray", "title", "Скрыть панель X-Ray", "Hide X-Ray panel");
  setElAttr("#xray-scroll-prev", "aria-label", "Прокрутить влево", "Scroll left");
  setElAttr("#xray-scroll-prev", "title", "Прокрутить влево (←)", "Scroll left (←)");
  setElAttr("#xray-scroll-next", "aria-label", "Прокрутить вправо", "Scroll right");
  setElAttr("#xray-scroll-next", "title", "Прокрутить вправо (→)", "Scroll right (→)");
  setElAttr("#xray-tab-cast", "title", "Актёры (1)", "Cast (1)");
  setElAttr("#xray-tab-soundtrack", "title", "Саундтрек (2)", "Soundtrack (2)");
  setElAttr("#xray-tab-trivia", "title", "Факты и пасхалки (3)", "Trivia & Facts (3)");
  setElAttr("#vc-btn-xray", "title", "X-Ray: актёры в кадре, саундтрек и факты (X)", "X-Ray: cast in scene, soundtrack & trivia (X)");
  setElAttr("#vc-btn-xray", "aria-label", "X-Ray: актёры в кадре, саундтрек и факты", "X-Ray: cast in scene, soundtrack & trivia");
  setElAttr("#btn-open-roulette-modal", "title", "Что посмотреть: рулетка и подбор по настроению", "What to watch: movie roulette and mood picker");
  setElAttr("#vc-btn-bookmark", "title", "Сохранить момент в закладки (Shift+M)", "Bookmark moment (Shift+M)");
  setElText("#roulette-modal-title", "Что посмотреть сегодня", "What to watch today");
  setElText("#spin-roulette-label", "Испытать удачу", "Spin the wheel");
  setElText("#movie-roulette-modal .atv-roulette-badge", "Случайный выбор", "Random Pick");
  setElAttr("#btn-close-roulette", "aria-label", "Закрыть", "Close");
  setElAttr("#btn-close-roulette", "title", "Закрыть", "Close");
  const rouletteFilterLabels = document.querySelectorAll("#movie-roulette-modal .atv-roulette-filter-label");
  if (rouletteFilterLabels[0]) rouletteFilterLabels[0].textContent = t("Формат:", "Format:");
  if (rouletteFilterLabels[1]) rouletteFilterLabels[1].textContent = t("Настроение:", "Mood:");
  if (rouletteFilterLabels[2]) rouletteFilterLabels[2].textContent = t("Рейтинг:", "Rating:");
  setElText('#roulette-type-pills [data-type="all"]', "Все", "All");
  setElText('#roulette-type-pills [data-type="movie"]', "Фильмы", "Movies");
  setElText('#roulette-type-pills [data-type="series"]', "Сериалы", "Series");
  setElText('#roulette-mood-pills [data-mood="all"]', "Любое", "Any");
  setElText('#roulette-mood-pills [data-mood="action"]', "Драйв и экшн", "Action & Drive");
  setElText('#roulette-mood-pills [data-mood="cozy"]', "Уютный вечер", "Cozy Evening");
  setElText('#roulette-mood-pills [data-mood="comedy"]', "Посмеяться", "Comedy");
  setElText('#roulette-mood-pills [data-mood="thriller"]', "Пощекотать нервы", "Thrills & Suspense");
  setElText('#roulette-mood-pills [data-mood="drama"]', "Глубокая драма", "Deep Drama");
  setElText('#roulette-mood-pills [data-mood="scifi"]', "Фантастика", "Sci-Fi");
  setElText('#roulette-rating-pills [data-min-rating="0"]', "Любой", "Any");
  setElText('#roulette-rating-pills [data-min-rating="7.0"]', "7.0 и выше", "7.0 and above");
  setElText('#roulette-rating-pills [data-min-rating="8.0"]', "8.0 и выше", "8.0 and above");
  setElText("#roulette-placeholder .atv-roulette-ph-text", "Выберите параметры и нажмите «Испытать удачу»", 'Choose filters and press "Spin the wheel"');

  setElAttr("#command-palette-modal", "aria-label", "Палитра команд", "Command Palette");
  setElAttr("#command-palette-input", "placeholder", "Поиск фильмов, персон, разделов и действий...", "Search movies, people, sections and actions...");
  setElAttr("#btn-close-palette", "aria-label", "Закрыть палитру", "Close palette");
  const paletteHints = document.querySelectorAll("#command-palette-modal .atv-palette-hint > span");
  if (paletteHints[0]) paletteHints[0].textContent = t("Навигация", "Navigate");
  if (paletteHints[1]) paletteHints[1].textContent = t("Выбрать", "Select");
  if (paletteHints[2]) paletteHints[2].textContent = t("Закрыть", "Close");

  setElText("#gear-audio-offset-title", "Задержка звука", "Audio Sync");
  setElAttr("#btn-gear-audio-minus", "title", "Звук раньше на 0.05 секунды", "Audio 0.05 seconds earlier");
  setElAttr("#gear-audio-offset-val", "title", "Сбросить задержку звука", "Reset audio sync");
  setElAttr("#btn-gear-audio-plus", "title", "Звук позже на 0.05 секунды", "Audio 0.05 seconds later");
  const gearAudioValEl = document.getElementById("gear-audio-offset-val");
  if (gearAudioValEl) {
    const aOff = Math.round((Number(state.audioOffsetSec) || 0) * 100) / 100;
    const aSign = aOff > 0.004 ? "+" : aOff < -0.004 ? "−" : "";
    gearAudioValEl.textContent = `${aSign}${Math.abs(aOff).toFixed(2)} ${en ? "s" : "с"}`;
  }

  setElText("#gear-sub-offset-title", "Задержка субтитров", "Subtitle Sync");
  setElAttr("#btn-gear-sub-minus", "title", "Субтитры раньше на 0.25 секунды", "Subtitles 0.25 seconds earlier");
  setElAttr("#gear-sub-offset-val", "title", "Сбросить задержку субтитров", "Reset subtitle sync");
  setElAttr("#btn-gear-sub-plus", "title", "Субтитры позже на 0.25 секунды", "Subtitles 0.25 seconds later");

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
  const introToggleLbl = document.querySelector("#auto-skip-intro-toggle")?.closest("label")?.querySelector(".atv-gear-toggle-label");
  if (introToggleLbl && introToggleLbl.childNodes[0]?.nodeType === Node.TEXT_NODE) {
    introToggleLbl.childNodes[0].nodeValue = en ? "Auto-skip intro " : "Автопропуск заставки ";
  }
  const nextToggleLbl = document.querySelector("#auto-next-ep-toggle")?.closest("label")?.querySelector(".atv-gear-toggle-label");
  if (nextToggleLbl) nextToggleLbl.textContent = en ? "Auto-play next episode" : "Автопереход на следующую серию";

  setElText("#btn-screenshot > span", "Снимок кадра", "Snapshot");
  setElAttr("#btn-screenshot", "title", "Сохранить снимок текущего кадра в полном разрешении (.png · клавиша S)", "Save full-resolution frame snapshot (.png · key S)");
  setElText("#btn-download-stream > span", "Файл .mp4", "File .mp4");
  setElAttr("#btn-download-stream", "title", "Скачать текущий поток (.mp4) в 1080p на устройство", "Download current 1080p stream (.mp4)");
  setElAttr("#btn-download-offline", "title", "Сохранить с озвучкой и субтитрами для просмотра без интернета", "Save with audio & subtitles for offline playback");
  setElText("#gear-hotkeys-box .atv-gear-hotkeys-title", "Горячие клавиши плеера:", "Keyboard Shortcuts:");
  const hkHint = document.querySelector("#gear-hotkeys-box .atv-hotkeys-hint");
  if (hkHint) {
    hkHint.innerHTML = en
      ? `<code>Space / K</code> play/pause · <code>F</code> fullscreen · <code>← / →</code> ±10 seconds · <code>↑ / ↓</code> volume · <code>X</code> X-Ray · <code>B</code> audio boost · <code>E</code> sound mode · <code>C</code> crop · <code>A</code> ambilight · <code>S</code> snapshot · <code>N / P</code> next/previous episode · <code>I</code> picture-in-picture`
      : `<code>Пробел / K</code> пауза · <code>F</code> полный экран · <code>← / →</code> ±10 секунд · <code>↑ / ↓</code> громкость · <code>X</code> X-Ray · <code>B</code> усиление звука · <code>E</code> эквалайзер · <code>C</code> формат кадра · <code>A</code> подсветка · <code>S</code> снимок кадра · <code>N / P</code> следующая или предыдущая серия · <code>I</code> картинка в картинке`;
  }

  // Video Control Bar Tooltips & Default Labels
  setElAttr("#vc-btn-play", "title", "Воспроизведение / Пауза (Space)", "Play / Pause (Space)");
  setElAttr("#vc-btn-back10", "title", "Назад на 10 секунд (←)", "Back 10 seconds (←)");
  setElAttr("#vc-btn-fwd10", "title", "Вперёд на 10 секунд (→)", "Forward 10 seconds (→)");
  setElAttr("#vc-btn-mute", "title", "Включить или выключить звук (M)", "Mute / Unmute (M)");
  setElAttr("#vc-vol-slider", "title", "Громкость", "Volume");
  setElAttr("#vc-time-label", "title", "Нажмите, чтобы переключить оставшееся / общее время", "Click to toggle remaining / total time");
  setElAttr("#vc-btn-studio", "title", "Выбрать студию озвучки", "Select audio track");
  setElAttr("#vc-btn-subs", "title", "Субтитры (C)", "Subtitles (C)");
  const studioLblEl = document.getElementById("vc-studio-label");
  if (studioLblEl && (studioLblEl.textContent === "Озвучка" || studioLblEl.textContent === "Audio")) {
    studioLblEl.textContent = en ? "Audio" : "Озвучка";
  }
  const subsLblEl = document.getElementById("vc-subs-label");
  if (subsLblEl && (subsLblEl.textContent === "Субтитры" || subsLblEl.textContent === "Subtitles")) {
    subsLblEl.textContent = en ? "Subtitles" : "Субтитры";
  }
  const loaderTxtEl = document.getElementById("video-loader-text");
  if (
    loaderTxtEl &&
    (loaderTxtEl.textContent.includes("Загрузка") || loaderTxtEl.textContent.includes("Loading"))
  ) {
    loaderTxtEl.textContent = en ? "Loading stream..." : "Загрузка потока...";
  }
  setElAttr("#vc-btn-quality", "title", "Качество потока", "Stream quality");
  setElAttr("#btn-player-gear", "title", "Настройки плеера (G)", "Player settings (G)");
  setElAttr("#vc-btn-pip", "title", "Картинка в картинке (I)", "Picture-in-Picture (I)");
  setElAttr("#vc-btn-fs", "title", "Во весь экран (F)", "Fullscreen (F)");

  // Episodes Bottom Panel
  setElText("#season-group-prefix", "Сезон", "Season");
  setElAttr("#btn-prev-ep", "title", "Предыдущая серия (P)", "Previous episode (P)");
  setElAttr("#btn-prev-ep", "aria-label", "Предыдущая серия (P)", "Previous episode (P)");
  setElAttr("#btn-next-ep", "title", "Следующая серия (N)", "Next episode (N)");
  setElAttr("#btn-next-ep", "aria-label", "Следующая серия (N)", "Next episode (N)");
  setElAttr("#ep-view-mode-switch", "aria-label", "Вид списка серий", "Episode list view");
  setElText("#btn-ep-view-strip", "Номера", "Numbers");
  setElAttr("#btn-ep-view-strip", "title", "Компактные номера серий с подсказкой при наведении", "Compact episode numbers with hover preview");
  setElText("#btn-ep-view-grid", "Карточки", "Cards");
  setElAttr("#btn-ep-view-grid", "title", "Карточки серий с названиями и датами выхода", "Episode cards with titles & air dates");
  setElText("#lbl-ep-batch-summary", "Действия с сезоном", "Season Actions");
  setElText("#lbl-dl-batch-3", "3 серии офлайн", "3 Episodes Offline");
  setElAttr("#btn-dl-batch-3", "title", "Скачать офлайн текущую и две следующие серии сезона", "Download current and next 2 episodes offline");
  setElText("#lbl-dl-batch-unwatched", "Непросмотренные офлайн", "Unwatched Offline");
  setElAttr("#btn-dl-batch-unwatched", "title", "Скачать офлайн все непросмотренные серии этого сезона", "Download all unwatched episodes in this season offline");
  setElText("#lbl-dl-batch-season", "Сезон офлайн", "Season Offline");
  setElAttr("#btn-dl-batch-season", "title", "Скачать офлайн все серии текущего сезона начиная с выбранной", "Download remaining episodes of this season offline");
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
  setElText("#meta-cast-section .atv-cast-below-head :is(h3, h4) > span", "Режиссёр и актёры", "Director & Cast");
  setElText("#sidebar-providers-section :is(h3, h4, summary)", "Где смотреть", "Where to Watch");
  setElText("#sidebar-friends-section > :is(h3, h4)", "Оценки друзей", "Friends' Ratings");
  setElText("#modal-similar-section > :is(h3, h4)", "Похожие фильмы и сериалы", "Similar Movies & Series");

  // Quick Peek Modal
  setElAttr("#qp-back-nav-btn", "title", "Вернуться назад", "Go back");
  setElAttr("#close-quick-peek-modal", "title", "Закрыть (Esc)", "Close (Esc)");
  setElAttr("#close-quick-peek-modal", "aria-label", "Закрыть карточку", "Close card");
  setElText("#qp-label-critics", "Критики", "Critics");
  setElText("#qp-friends-wrap .atv-qp-sublabel", "Оценки друзей", "Friends' Ratings");
  setElText("#qp-cast-wrap .atv-qp-sublabel", "Режиссёр и в ролях", "Director & Cast");
  setElText("#qp-similar-wrap .atv-qp-similar-title", "Похожие фильмы и сериалы", "Similar Movies & Series");
  setElText("#qp-clear-rate-btn", "Сбросить", "Clear");
  setElAttr("#qp-clear-rate-btn", "title", "Удалить мою оценку в Kinorium", "Remove my Kinorium rating");
  setElText("#qp-btn-watching > span", "Смотрю", "Watching");
  setElText("#qp-btn-watchlist > span", "Буду смотреть", "Watchlist");
  setElText("#qp-btn-watched > span", "Просмотрено", "Watched");
  setElText("#qp-btn-never > span", "Не смотрю", "Not Interested");
  setElText("#qp-btn-play > span", "Смотреть", "Watch");
  setElText("#qp-btn-trailer > span", "Трейлер", "Trailer");

  // Stats & History Modal
  setElAttr("#stats-modal", "aria-label", "Статистика и история просмотров", "Statistics & Watch History");
  setElAttr("#stats-modal-tabs", "aria-label", "Разделы статистики", "Statistics sections");
  setElText("#stats-tab-analytics", "Аналитика и вкусы", "Analytics & Taste");
  setElText("#stats-tab-history", "История просмотров", "Watch History");
  setElAttr("#close-stats-modal", "title", "Закрыть (Esc)", "Close (Esc)");
  setElAttr("#close-stats-modal", "aria-label", "Закрыть статистику", "Close statistics");

  // Settings Modal
  setElAttr("#settings-modal", "aria-label", "Настройки", "Settings");
  setElAttr("#settings-tabs", "aria-label", "Разделы настроек", "Settings sections");
  setElAttr("#notifications-tabs", "aria-label", "Разделы уведомлений", "Notifications sections");
  setElAttr("#person-role-tabs", "aria-label", "Роли в фильмографии", "Filmography roles");
  setElText('#settings-tabs .settings-tab[data-stab="integrations"]', "Сервисы", "Services");
  setElText('#settings-tabs .settings-tab[data-stab="network"]', "Сеть", "Network");
  setElText('#settings-tabs .settings-tab[data-stab="backup"]', "Копия", "Backup");
  setElText('#settings-tabs .settings-tab[data-stab="about"]', "О программе", "About");
  setElAttr("#close-settings-modal", "title", "Закрыть (Esc)", "Close (Esc)");
  setElAttr("#close-settings-modal", "aria-label", "Закрыть настройки", "Close settings");

  setElText("#settings-lang-title", "Язык интерфейса", "Interface language");
  setElText("#settings-country-title", "Страна и локализация", "Country & Localization");
  setElAttr("#settings-country-select", "aria-label", "Страна Европы", "European Country");
  setElText("#btn-open-onboarding-wizard", "Мастер настройки", "Setup Wizard");
  syncLanguageSegmentedControlUI();

  // Settings Tab 2: Network
  setElText("#net-group-hdrezka > :is(h3, h4)", "HDRezka", "HDRezka");
  setElText("#lbl-spoof-region", "Регион маршрутизации", "Routing region");
  setElText("#lbl-custom-mirror", "Персональное зеркало", "Custom mirror");
  setElText("#lbl-proxy-url", "HTTP / SOCKS5 прокси", "HTTP / SOCKS5 proxy");
  setElText("#lbl-cf-worker", "Cloudflare Worker релей", "Cloudflare Worker relay");
  setElText("#summary-net-hdrezka", "Зеркало и прокси", "Mirror & proxy");
  setElText('#cfg-spoof-region option[value="KZ"]', "Казахстан (рекомендуется)", "Kazakhstan (recommended)");
  setElText('#cfg-spoof-region option[value="AM"]', "Армения", "Armenia");
  setElText('#cfg-spoof-region option[value="MD"]', "Молдова", "Moldova");
  setElText('#cfg-spoof-region option[value="DIRECT"]', "Напрямую", "Direct");

  setElText("#net-group-stremio > :is(h3, h4)", "Stremio", "Stremio");
  setElAttr("#cfg-stremio-manifest-input", "placeholder", "Ссылка manifest.json или stremio://...", "manifest.json or stremio:// URL...");
  setElText("#btn-add-stremio-addon", "Добавить", "Add");

  setElText("#net-group-backup4k > :is(h3, h4)", "4K Remux", "4K Remux");
  setElText("#lbl-backup-mode", "Режим воспроизведения", "Playback mode");
  setElText("#lbl-torrserver-url", "Адрес TorrServer", "TorrServer URL");
  setElText("#lbl-debrid-key", "API-ключ Debrid", "Debrid API key");
  setElText("#summary-net-4k", "Адрес TorrServer и ключ Debrid", "TorrServer URL & Debrid key");
  setElText('#cfg-backup-mode option[value="torrserver"]', "TorrServer + ремукс AAC", "TorrServer + AAC remux");
  setElText('#cfg-backup-mode option[value="realdebrid"]', "Real-Debrid HTTPS", "Real-Debrid HTTPS");
  setElText('#cfg-backup-mode option[value="torbox"]', "TorBox HTTPS", "TorBox HTTPS");
  setElAttr("#cfg-debrid-key", "placeholder", "Не требуется для TorrServer", "Not needed for TorrServer");

  setElText("#net-system-heading", "Локальная сеть и система", "Local Network & System");
  setElText("#lan-toggle-title", "Доступ в домашней сети Wi-Fi", "Home Wi-Fi access");
  setElText("#lan-toggle-sub", "Просмотр на телефоне, планшете или телевизоре", "Watch on phone, tablet, or Smart TV");
  setElText("#btn-copy-lan-url", "Скопировать", "Copy");
  setElText(
    "#lan-qr-hint",
    "Отсканируйте QR-код камерой или откройте адрес в браузере устройства в той же сети Wi-Fi.",
    "Scan the QR code or open the address in any browser on the same Wi-Fi network."
  );
  setElText("#autostart-toggle-title", "Автозапуск при входе в систему", "Launch at login");
  setElText(
    "#autostart-toggle-sub",
    "Фоновый запуск локального сервера без терминала",
    "Silent background server startup without Terminal"
  );

  // Settings Tab 3: Minimalist Backup & Footer
  setElText(
    "#backup-desc-lead",
    "Сохранение и перенос списков Kinorium, истории просмотров, таймкодов, оценок и настроек приложения в формате JSON.",
    "Export and restore Kinorium lists, watch history, playback progress, ratings, and app settings in JSON format."
  );
  setElText("#backup-lbl-file", "Файл резервной копии", "Backup file");
  setElText("#backup-lbl-clipboard", "Буфер обмена", "Clipboard");
  setElText("#btn-quick-export-backup > span", "Скачать", "Download");
  setElText("#btn-quick-import-backup > span", "Загрузить", "Import");
  setElText("#btn-copy-backup-clipboard > span", "Скопировать", "Copy");
  setElAttr("#btn-copy-backup-clipboard", "title", "Скопировать JSON резервной копии в буфер обмена", "Copy backup JSON to clipboard");
  setElText("#btn-paste-backup-clipboard > span", "Вставить", "Paste");
  setElAttr("#btn-paste-backup-clipboard", "title", "Восстановить резервную копию из буфера обмена", "Restore backup JSON from clipboard");
  setElText("#settings-dirty-hint", "Есть несохранённые изменения", "Unsaved changes");
  setElText("#reset-settings-btn", "Сбросить", "Reset");
  setElText("#save-settings-btn", "Сохранить изменения", "Save Changes");

  // Settings Tab 4: Minimalist About Developer & Program Description
  setElText("#about-app-tagline", "Персональный домашний кинотеатр", "Personal Home Cinema");
  setElText(
    "#about-desc-lead",
    "Velarium — персональный домашний онлайн-кинотеатр для macOS, Windows и домашней сети. Объединяет в одном окне проекты Netflix, Apple TV+, HBO, Prime Video, Disney+ и мирового проката вплоть до 4K Dolby Vision / HDR, двустороннюю синхронизацию с Kinorium, защиту по стране проживания и управление со смартфона или ТВ без рекламы и подписок. Посвящается всем голд дигерам.",
    "Velarium is a personal home cinema for macOS, Windows, and your local network. It brings together Netflix, Apple TV+, HBO, Prime Video, Disney+, and global cinema in up to 4K Dolby Vision / HDR, two-way Kinorium sync, country-aware privacy protection, and smartphone or Smart TV control — completely ad-free. Dedicated to all gold diggers."
  );
  setElText("#about-features-heading", "Главные возможности приложения", "Key Capabilities");
  setElText(
    "#about-feat-1-title",
    "Все стриминги в одном плеере (HDRezka, 4K Торрент и Stremio)",
    "All Streaming Originals in One Player (HDRezka, 4K Torrent & Stremio)"
  );
  setElText(
    "#about-feat-1-desc",
    "Мгновенный просмотр фильмов и сериалов Netflix, Apple TV+, HBO / Max, Prime Video, Disney+ и мировых студий в 1080p и 4K UHD HDR / Dolby Vision через встроенный TorrServer (буферизация в оперативной памяти без износа SSD), аддоны Stremio и облачные ускорители Real-Debrid / TorBox.",
    "Watch movies and series from Netflix, Apple TV+, HBO / Max, Prime Video, Disney+, and global studios in 1080p and 4K UHD HDR / Dolby Vision via a built-in RAM-buffered TorrServer, Stremio addons, and Real-Debrid / TorBox cloud caching."
  );
  setElText(
    "#about-feat-2-title",
    "Приватность без сбора паролей (вход по Cookie и локальное шифрование)",
    "Zero Password Collection (Cookie-Only Auth & Local Vault Encryption)"
  );
  setElText(
    "#about-feat-2-desc",
    "Приложение никогда не запрашивает, не видит и не хранит ваши пароли: авторизация в Kinorium проходит напрямую в браузере, а для синхронизации используются только сессионные Cookie, зашифрованные локально на вашем устройстве без отправки данных на сторонние серверы.",
    "Velarium never asks for, sees, or stores your passwords: sign-in happens directly in your browser, using only session Cookies encrypted locally on your device with zero external telemetry."
  );
  setElText(
    "#about-feat-3-title",
    "Защита по стране локализации (50 стран Европы) и обход блокировок без VPN",
    "Country-Aware Privacy Protection (50 European Countries) & Built-In Geo-Bypass"
  );
  setElText(
    "#about-feat-3-desc",
    "Автоматические профили безопасности под выбранную страну: в странах со штрафами за торренты (Германия, Франция и другие) принудительно блокируется прямой P2P-обмен для защиты домашнего IP и используются только зашифрованные HTTPS-потоки, а блокировки провайдеров обходятся через встроенный DNS-over-HTTPS (DoH), локальный медиа-туннель, автопоиск зеркал и Cloudflare Worker / SOCKS5.",
    "Automatic regional safety profiles: in strict copyright countries (such as Germany or France), direct P2P BitTorrent traffic is automatically blocked to protect your home IP in favor of encrypted HTTPS streams, while ISP blocks are bypassed via DNS-over-HTTPS (DoH), local media tunneling, mirror auto-discovery, and Cloudflare Worker / SOCKS5 support."
  );
  setElText(
    "#about-feat-4-title",
    "Двусторонняя синхронизация с Kinorium (до 2 аккаунтов)",
    "Two-Way Kinorium Sync (Up to 2 Accounts)"
  );
  setElText(
    "#about-feat-4-desc",
    "Автоматическая отметка «Смотрю» (с 10%), «Просмотрено» (с 95% или на финальных титрах), выставление оценок 1–10, синхронизация списков «Буду смотреть» и «Избранное», а также полная фильмография актёров и режиссёров.",
    "Automatic scrobbling ('Watching' at 10%, 'Watched' at 95% or end credits), 1–10 ratings, watchlist and favorites sync, plus full actor and director filmographies."
  );
  setElText(
    "#about-feat-5-title",
    "Живой ремукс видео и студийная обработка звука (Audio DSP)",
    "Live Video Remux & Studio Audio DSP"
  );
  setElText(
    "#about-feat-5-desc",
    "Потоковая перепаковка MKV / HEVC / DTS / AC3 на лету через FFmpeg с выбором любой аудиодорожки, коррекцией рассинхрона и 5 пресетами звука (Стандарт, Голос, Ночной, Кинозал, Усиление до 300%).",
    "Zero-copy on-the-fly FFmpeg remuxing of MKV / HEVC / DTS / AC3 with multi-track audio switching, lip-sync offset, and 5 DSP presets (Standard, Voice, Night, Cinema, Boost up to 300%)."
  );
  setElText(
    "#about-feat-6-title",
    "Интерактивный X-Ray, автопропуск заставок и видеозакладки",
    "Interactive X-Ray, Auto-Skip Intro & Frame Bookmarks"
  );
  setElText(
    "#about-feat-6-desc",
    "Распознавание актёров, режиссёров, фактов о съёмках и саундтреков в текущей сцене с 30-секундным прослушиванием из iTunes, автопропуск интро и титров (TheIntroDB + главы MKV), а также таймкод-закладки со скриншотами кадра.",
    "Scene-aware cast, director, trivia, and soundtrack recognition with 30-second iTunes previews, automatic intro/credits skipping (TheIntroDB + MKV chapters), and frame-captured video bookmarks."
  );
  setElText(
    "#about-feat-7-title",
    "Умные субтитры со словарём и переводом по клику",
    "Smart Subtitles with Click-to-Translate Dictionary"
  );
  setElText(
    "#about-feat-7-desc",
    "Поддержка внешних и встроенных субтитров (SRT, VTT, ASS/SSA), мгновенный перевод слов и выражений по клику прямо в плеере, настройка оформления и синхронизация тайминга.",
    "Embedded and external subtitles (SRT, VTT, ASS/SSA), instant word translation and dictionary lookup on click, custom styling, and timing sync."
  );
  setElText(
    "#about-feat-8-title",
    "Мобильный пульт (?remote=1), режим ТВ и трансляция на телевизор",
    "Smartphone Remote (?remote=1), TV Mode & Big-Screen Casting"
  );
  setElText(
    "#about-feat-8-desc",
    "Управление со смартфона по QR-коду (тачпад в стиле Siri Remote, X-Ray, переключение дорожек и режимов звука), интерфейс для больших экранов (TV Mode), а также вывод на ТВ через AirPlay, DLNA / UPnP и браузер Smart TV.",
    "QR-code phone controller with Siri Remote clickpad, live X-Ray and audio controls, 10-foot TV navigation, and 1-click casting via AirPlay, DLNA / UPnP, and Smart TV web link."
  );
  setElText(
    "#about-feat-9-title",
    "Офлайн-загрузки, семейные профили с PIN-кодом и синхронизация в сети",
    "Offline Downloads, PIN Family Profiles & LAN Sync"
  );
  setElText(
    "#about-feat-9-desc",
    "Скачивание фильмов и целых сезонов в MP4 для просмотра без интернета, отдельные профили с детским режимом (Kids Mode), статистикой «Итоги кинозала» и обменом прогрессом между устройствами в домашней сети.",
    "Single-episode and full-season MP4 offline downloads, family profiles with Kids Mode, Cinema Wrap analytics, and instant local network state sync."
  );
  setElText("#about-lbl-version", "Версия", "Version");
  setElText("#about-lbl-developer", "Разработчик", "Developer");
  setElText("#about-lbl-year", "Год", "Year");
  setElText("#about-lbl-platform", "Платформы", "Platforms");
  setElText("#about-val-platform", "Windows · macOS · Web / PWA", "Windows · macOS · Web / PWA");

  // Person Modal
  setElAttr("#person-back-nav-btn", "title", "Вернуться назад", "Go back");
  setElAttr("#close-person-modal", "title", "Закрыть (Esc)", "Close (Esc)");
  setElAttr("#close-person-modal", "aria-label", "Закрыть карточку персоны", "Close person profile");
  const personCareerEl = document.getElementById("person-modal-career");
  if (personCareerEl && (personCareerEl.textContent === "Персона" || personCareerEl.textContent === "Person")) {
    personCareerEl.textContent = en ? "Person" : "Персона";
  }
  setElText("#btn-person-search-catalog > span", "Найти в основном каталоге", "Find in Catalog");
  setElText(".atv-person-filmography-head > h3", "Фильмография", "Filmography");
  setElText("#person-modal-loading > span", "Загрузка фильмографии и оценок Kinorium...", "Loading filmography & Kinorium ratings...");

  // Onboarding Setup Wizard Modal
  setElText(
    "#ob-title",
    state.onboardingIsFirstRun ? "Первичная настройка Velarium" : "Мастер настройки Velarium",
    state.onboardingIsFirstRun ? "Velarium Initial Setup" : "Velarium Setup Wizard"
  );
  setElText(
    "#ob-subtitle",
    "Выберите страну Европы для обхода блокировок, подключаемые сервисы и синхронизацию Kinorium",
    "Choose your European country for restriction bypass, connected services, and Kinorium sync"
  );
  setElAttr("#close-onboarding-modal", "title", "Закрыть (Esc)", "Close (Esc)");
  setElAttr("#close-onboarding-modal", "aria-label", "Закрыть мастер настройки", "Close setup wizard");
  setElAttr("#ob-stepper", "aria-label", "Шаги настройки", "Setup steps");
  setElText("#ob-step-lbl-1", "Страна и обход", "Country & Bypass");
  setElText("#ob-step-lbl-2", "Источники видео", "Video Sources");
  setElText("#ob-step-lbl-3", "Профиль Kinorium", "Kinorium Profile");
  setElText("#btn-onboarding-back", "Назад", "Back");
  setElText("#btn-onboarding-next", "Далее", "Next");
  setElText(
    "#ob-country-heading",
    "Локализация (все страны Европы) и обход блокировок",
    "Localization (All Countries of Europe) & Restriction Bypass"
  );
  setElText("#ob-country-count-badge", "50 стран", "50 countries");
  setElText(
    "#ob-country-desc",
    "Выбранная страна автоматически настраивает обход провайдерских DNS, DPI и IP-блокировок, защиту P2P-трафика, разблокировку оригинальной озвучки и региональные каталоги сервисов.",
    "Your selected country configures encrypted DNS/DPI/IP unblock routing, P2P swarm protection, original audio unlock, and regional streaming catalogs."
  );
  setElText("#ob-country-label", "Ваша страна", "Your country");
  setElText("#ob-kinorium-heading", "Подключение Kinorium", "Kinorium Connection");
  setElText(
    "#ob-kinorium-desc",
    "Выберите, использовать ли синхронизацию с вашим профилем Kinorium или вести списки полностью локально.",
    "Choose whether to sync with your Kinorium profile or keep watch lists strictly local."
  );
  setElText("#ob-kin-mode-on", "Подключить", "Connect");
  setElText("#ob-kin-mode-off", "Только локально", "Local Only");
  setElText(
    "#ob-kinorium-benefits-title",
    "Что даёт подключение Kinorium:",
    "What connecting Kinorium provides:"
  );
  setElText(
    "#ob-kin-ben-1",
    "Синхронизация списков «Смотрю», «Буду смотреть», «Просмотрено» и «Не буду смотреть» между устройствами",
    'Two-way sync of "Watching", "Watchlist", "Watched", and "Not Interested" lists across devices'
  );
  setElText(
    "#ob-kin-ben-2",
    "Автостатус «Смотрю» на 10% и «Просмотрено» на 95%, при титрах или переходе к следующей серии, а также календарь премьер",
    'Auto "Watching" at 10% and "Watched" at 95%, on credits, or on next episode, plus premieres calendar'
  );
  setElText(
    "#ob-kin-ben-3",
    "Оценки друзей на карточках, фильтр по друзьям, процент совпадения вкусов и подборки похожих фильмов",
    "Friends' ratings on cards, friends filter, taste match score, and accurate similar title picks"
  );
  setElText(
    "#ob-kin-ben-4",
    "Статистика просмотренной фильмографии любимых режиссёров и актёров с вашими оценками",
    "Watched filmography progress and personal ratings for directors and actors"
  );
  setElText(
    "#ob-kinorium-disabled-note",
    "Вкладки списков Kinorium и оценки друзей будут скрыты из навигации. История просмотра, прогресс серий и раздел «Продолжить просмотр» будут сохраняться автономно только на этом компьютере.",
    'Kinorium list tabs and friends ratings will be hidden from navigation. Watch history, episode progress, and "Continue Watching" will be stored locally on this computer.'
  );
  setElAttr(
    "#ob-kinorium-user",
    "placeholder",
    "ID или ссылка на профиль (например, https://kinorium.com/user/12345/)",
    "Profile ID or URL (for example, https://en.kinorium.com/user/12345/)"
  );
  setElAttr(
    "#ob-kinorium-cookie",
    "placeholder",
    "Session Cookie (необязательно — для двусторонней записи оценок и серий)",
    "Session Cookie (optional — for two-way rating & episode writeback)"
  );
  setElText(
    "#ob-kinorium-hint",
    "Поля можно оставить пустыми и привязать ID профиля позже в разделе «Настройки» — разделы списков останутся включёнными.",
    "You can leave these blank and link your Profile ID later in Settings — list sections will stay active."
  );
  setElText(
    "#ob-cookie-help-summary",
    "Где взять ID и зачем нужен Session Cookie?",
    "Where to find your ID & why Session Cookie is optional"
  );
  const cookieHelpBody = document.getElementById("ob-cookie-help-body");
  if (cookieHelpBody) {
    cookieHelpBody.innerHTML = en
      ? "<strong>Profile ID</strong> (digits from <code>kinorium.com/user/12345/</code>) imports your lists, ratings, and friends read-only without a password. <strong>Session Cookie</strong> is only needed for two-way writeback of new ratings and episodes: open <code>kinorium.com</code> in your browser, press <code>F12</code> → <code>Network</code>, click any request, and copy the <code>Cookie</code> header."
      : "<strong>ID профиля</strong> (цифры из ссылки <code>kinorium.com/user/12345/</code>) открывает чтение ваших списков, оценок и друзей без пароля. <strong>Session Cookie</strong> нужен только для двусторонней записи новых оценок и серий на сайт: откройте <code>kinorium.com</code> в браузере, нажмите <code>F12</code> → <code>Network</code>, выберите любой запрос и скопируйте заголовок <code>Cookie</code>.";
  }
  setElText("#search-persons-heading", "Персоны", "People");
  setElText("#ob-services-heading", "Подключаемые сервисы и видеоисточники", "Connected Services & Video Sources");
  setElText(
    "#ob-services-desc",
    "Выберите сервисы, которые будут отображаться в каталоге и плеере. Отключённые сервисы полностью скрываются из интерфейса.",
    "Choose which services appear in the catalog and player. Disabled services are hidden across the app."
  );
  setElText("#ob-preset-builtin", "Только встроенные", "Built-in Only");
  setElText("#ob-preset-all", "Все сервисы", "All Services");
  setElText(
    "#ob-footer-note",
    "Все параметры можно изменить в любой момент в разделе «Настройки»",
    "All preferences can be changed anytime in Settings"
  );
  const obSkipBtn = document.getElementById("btn-onboarding-skip");
  if (obSkipBtn && !obSkipBtn.disabled) {
    obSkipBtn.textContent = state.onboardingIsFirstRun
      ? en
        ? "Skip (Defaults)"
        : "Пропустить"
      : en
      ? "Cancel"
      : "Отмена";
  }
  const obFinishBtn = document.getElementById("btn-onboarding-finish");
  if (obFinishBtn && !obFinishBtn.disabled) {
    obFinishBtn.textContent = en ? "Apply & Start" : "Применить и начать";
  }

  // Confirm Modal (only when closed)
  if (document.getElementById("confirm-modal")?.classList.contains("hidden")) {
    setElText("#confirm-modal-title", "Подтвердите действие", "Confirm Action");
    setElText("#confirm-modal-cancel", "Отмена", "Cancel");
    setElText("#confirm-modal-accept", "Подтвердить", "Confirm");
  }

  // PiP Dock & Scroll-to-Top
  setElText(".atv-pip-dock-badge > span", "Мини-окно", "PiP Active");
  setElAttr("#btn-pip-dock-play", "title", "Пауза / Воспроизведение", "Play / Pause");
  setElAttr("#btn-pip-dock-play", "aria-label", "Пауза / Воспроизведение", "Play / Pause");
  setElAttr("#btn-pip-dock-next-ep", "title", "Следующая серия", "Next episode");
  setElText("#btn-pip-dock-next-ep > span", "Далее", "Next");
  setElAttr("#btn-pip-dock-restore", "title", "Развернуть окно плеера", "Restore player window");
  setElText("#btn-pip-dock-restore > span", "Плеер", "Player");
  setElAttr("#btn-pip-dock-close", "title", "Остановить видео и закрыть мини-окно", "Stop video & close PiP");
  setElAttr("#btn-pip-dock-close", "aria-label", "Остановить видео и закрыть мини-окно", "Stop video & close PiP");
  setElAttr("#scroll-top-btn", "title", "Прокрутить страницу наверх", "Scroll to top");
  setElText("#scroll-top-btn > span", "Наверх", "Top");

  // Roadmap Features: Header, Player, Onboarding, Downloads, TV Mode & Profiles
  setElAttr(
    "#btn-open-downloads-modal",
    "title",
    "Офлайн-загрузки («Скачать в дорогу»)",
    "Offline Downloads (Watch Offline)"
  );
  setElAttr(
    "#btn-open-downloads-modal",
    "aria-label",
    "Офлайн-загрузки",
    "Offline Downloads"
  );
  setElAttr(
    "#btn-toggle-tv-mode",
    "title",
    "Режим для телевизора (управление пультом и геймпадом)",
    "TV Mode (remote D-pad & gamepad navigation)"
  );
  setElAttr(
    "#btn-toggle-tv-mode",
    "aria-label",
    "Режим для телевизора",
    "TV Mode"
  );
  setElAttr(
    "#vc-btn-offline-dl",
    "title",
    "Скачать в дорогу (просмотр без интернета)",
    "Download for offline playback"
  );
  setElAttr(
    "#vc-btn-offline-dl",
    "aria-label",
    "Скачать в дорогу",
    "Download for offline"
  );
  setElText(
    "#btn-download-offline > span",
    "В дорогу",
    "Save Offline"
  );
  setElText(
    "#btn-download-stream > span",
    "Файл .mp4",
    "File .mp4"
  );
  setElText("#prof-menu-stats-lbl", "Статистика и история", "Stats & Watch History");
  setElText("#prof-menu-bookmarks-lbl", "Заметки и закладки", "Notes & Bookmarks");
  setElAttr(
    "#btn-open-bookmarks-modal",
    "title",
    "Мои заметки и закладки к моментам",
    "My notes and moment bookmarks"
  );
  setElAttr(
    "#btn-open-bookmarks-modal",
    "aria-label",
    "Мои заметки и закладки",
    "My Notes & Bookmarks"
  );
  setElText("#prof-menu-dl-lbl", "Скачать в дорогу", "Offline Downloads");
  setElText("#prof-menu-remote-lbl", "Пульт с телефона", "Phone Remote");
  setElAttr(
    "#btn-prof-menu-remote",
    "title",
    "Управление воспроизведением на компьютере со смартфона по Wi-Fi",
    "Control desktop playback from your smartphone over Wi-Fi"
  );
  setElText("#prof-menu-tv-lbl", "Режим для телевизора", "TV Mode (Remote)");
  setElText("#prof-menu-tv-state", state.tvMode ? (state.appLang === "en" ? "On" : "Вкл") : (state.appLang === "en" ? "Off" : "Выкл"), state.tvMode ? "On" : "Off");
  setElAttr(
    "#vc-btn-remote",
    "title",
    "Управлять воспроизведением с телефона по Wi-Fi (QR-код)",
    "Control playback from phone over Wi-Fi (QR code)"
  );
  setElAttr(
    "#vc-btn-remote",
    "aria-label",
    "Пульт с телефона",
    "Phone Remote"
  );
  setElAttr(
    "#vc-btn-cast",
    "title",
    "Передать на телевизор (AirPlay / Smart TV / QR)",
    "Cast to TV (AirPlay / Smart TV / QR)"
  );
  setElAttr(
    "#vc-btn-cast",
    "aria-label",
    "Передать на телевизор",
    "Cast to TV"
  );
  setElAttr(
    "#btn-gear-remote",
    "title",
    "Управлять воспроизведением со смартфона по Wi-Fi (QR-код)",
    "Control playback from smartphone over Wi-Fi (QR code)"
  );
  setElText("#lbl-gear-remote-title", "Пульт с телефона", "Phone Remote");
  setElText("#lbl-gear-remote-sub", "QR-код для управления", "QR control");
  setElAttr(
    "#btn-player-handoff",
    "title",
    "Продолжить просмотр на смартфоне с этой же секунды (QR-код)",
    "Continue watching on smartphone from this moment (QR code)"
  );
  setElAttr(
    "#btn-player-handoff",
    "aria-label",
    "Смотреть на смартфоне",
    "Watch on Phone"
  );
  setElText("#lbl-player-handoff", "Смотреть на телефоне", "Watch on Phone");
  setElText("#lbl-player-handoff-sub", "Бесшовный просмотр", "Seamless handoff");
  setElText("#lbl-handoff-to-remote", "Нужен пульт управления? Открыть пульт", "Need remote control? Open phone remote");

  // Multi-Device Handoff Modal
  setElText("#handoff-modal-title", "Продолжить на смартфоне", "Continue on Smartphone");
  setElText(
    "#handoff-modal-subtitle",
    "Отсканируйте QR-код камерой смартфона в локальной сети Wi-Fi, чтобы продолжить просмотр с этой же секунды",
    "Scan the QR code with your smartphone camera on your local Wi-Fi to continue watching from the exact same second"
  );
  setElText("#btn-handoff-copy-url > span", "Скопировать", "Copy");
  setElAttr("#btn-handoff-copy-url", "title", "Скопировать ссылку", "Copy link");
  setElAttr("#handoff-url-input", "aria-label", "Ссылка для открытия на устройстве", "Device handoff URL");
  setElAttr("#close-handoff-modal", "title", "Закрыть (Esc)", "Close (Esc)");
  setElAttr("#close-handoff-modal", "aria-label", "Закрыть", "Close");

  // Subtitle Vocabulary Modal & In-Player Word Dictionary Popover
  setElText("#vocab-modal-title", "Словарь субтитров", "Subtitle Vocabulary");
  setElAttr("#btn-vocab-export-anki", "title", "Экспорт карточек для Anki (TSV)", "Export flashcards for Anki (TSV)");
  setElText("#btn-vocab-export-anki > span", "Экспорт в Anki", "Export to Anki");
  setElAttr("#btn-vocab-clear", "title", "Очистить словарь", "Clear vocabulary");
  setElText("#btn-vocab-clear > span", "Очистить", "Clear");
  setElAttr("#close-vocab-modal", "title", "Закрыть (Esc)", "Close (Esc)");
  setElAttr("#close-vocab-modal", "aria-label", "Закрыть", "Close");
  setElAttr(
    "#vocab-search-input",
    "placeholder",
    "Поиск по сохранённым словам и переводам...",
    "Search saved words and translations..."
  );
  setElAttr("#vocab-search-input", "aria-label", "Поиск по словарю", "Search vocabulary");
  setElAttr("#atv-sub-dict-popover", "aria-label", "Перевод слова", "Word translation");
  setElAttr(
    "#btn-close-sub-dict",
    "title",
    "Закрыть и продолжить просмотр",
    "Close and resume playback"
  );
  setElAttr(
    "#btn-close-sub-dict",
    "aria-label",
    "Закрыть и продолжить просмотр",
    "Close and resume playback"
  );
  setElAttr(
    "#btn-sub-dict-save",
    "title",
    "Сохранить слово в личный словарь для изучения",
    "Save word to personal vocabulary"
  );
  setElAttr(
    "#btn-sub-dict-open-vocab",
    "title",
    "Открыть словарь и экспортировать карточки в Anki",
    "Open vocabulary and export Anki flashcards"
  );
  setElText("#btn-sub-dict-open-vocab > span:first-child", "Словарь", "Vocabulary");

  // Hybrid Official Stream Panel
  setElAttr(
    "#official-stream-panel .atv-official-mode-switch",
    "aria-label",
    "Режим воспроизведения стриминга",
    "Streaming playback mode"
  );
  setElText(
    "#btn-official-mode-native > span",
    "Встроенный плеер Velarium",
    "Velarium Native Player"
  );
  setElText(
    "#btn-official-mode-embed > span",
    "Официальный веб-плеер в рамке",
    "Official Web Player in Frame"
  );
  setElAttr("#btn-official-embed-back", "title", "Назад", "Back");
  setElAttr("#btn-official-embed-reload", "title", "Обновить", "Reload");

  // LAN Sync Card in Settings
  setElText("#lan-sync-title", "Синхронизация домашних устройств", "Home Device Sync");
  setElText(
    "#lan-sync-sub",
    "Синхронизация истории и закладок с другими устройствами Velarium в сети Wi-Fi",
    "Sync watch history and bookmarks with other Velarium devices on your Wi-Fi"
  );
  setElText("#btn-sync-lan-label", "Синхронизировать", "Sync Now");
  setElText("#lan-sync-peers-title", "Найденные устройства:", "Discovered devices:");
  setElText("#profiles-form-title", "Настройки профиля", "Profile Settings");
  setElText("#btn-prof-kinorium-oneclick", "Войти в Kinorium в 1 клик", "1-Click Sign In to Kinorium");
  setElText(
    "#btn-ob-kinorium-one-click > span",
    "Войти в Kinorium в 1 клик (автоматически)",
    "1-Click Sign In to Kinorium (Automatic)"
  );
  setElText(
    "#ob-kinorium-one-click-hint",
    "Откроется kinorium.com в вашем браузере — войдите в аккаунт, сессия и ID сохранятся сами.",
    "Opens kinorium.com in your default browser — session cookies & user ID are saved automatically."
  );
  setElText(
    "#ob-kinorium-manual-summary",
    "Ввести ID профиля или Session Cookie вручную",
    "Enter Profile ID or Session Cookie manually"
  );

  // Offline Downloads Modal
  setElText("#downloads-modal-title", "Скачать в дорогу", "Offline Downloads");
  setElText("#btn-downloads-open-folder > span", "Открыть папку", "Open Folder");
  setElText("#lbl-dl-auto-cleanup", "Автоудаление просмотренных серий", "Auto-delete watched episodes");
  setElText("#lbl-dl-auto-next", "Автозагрузка следующей серии", "Auto-download next episode");
  setElAttr("#close-downloads-modal", "title", "Закрыть (Esc)", "Close (Esc)");
  setElAttr("#close-downloads-modal", "aria-label", "Закрыть", "Close");

  // Bookmarks & Notes Modal + In-Player Bookmark Dialog
  setElAttr("#atv-bookmark-dialog", "aria-label", "Закладка с заметкой", "Bookmark with note");
  setElText("#atv-bookmark-dialog .atv-bookmark-badge", "Закладка", "Bookmark");
  setElAttr("#btn-close-bookmark-dialog", "title", "Закрыть", "Close");
  setElAttr("#btn-close-bookmark-dialog", "aria-label", "Закрыть", "Close");
  setElAttr(
    "#bookmark-note-input",
    "placeholder",
    "Заметка к этому моменту (необязательно)...",
    "Note for this moment (optional)..."
  );
  setElText("#btn-delete-bookmark", "Удалить", "Delete");
  setElText("#btn-cancel-bookmark", "Отмена", "Cancel");
  setElText("#btn-save-bookmark", "Сохранить", "Save");

  setElText("#bookmarks-modal-title", "Мои заметки и закладки", "My Notes & Bookmarks");
  setElText(
    "#bookmarks-modal-summary",
    "Сохранённые моменты фильмов и сериалов с персональными комментариями",
    "Saved movie and series moments with personal notes"
  );
  setElAttr(
    "#btn-export-bookmarks-md",
    "title",
    "Экспортировать все закладки в Markdown-файл",
    "Export all bookmarks to a Markdown file"
  );
  setElText("#btn-export-bookmarks-md > span", "Экспорт в Markdown", "Export Markdown");
  setElAttr("#close-bookmarks-modal", "title", "Закрыть (Esc)", "Close (Esc)");
  setElAttr("#close-bookmarks-modal", "aria-label", "Закрыть", "Close");
  setElAttr(
    "#bookmarks-search-input",
    "placeholder",
    "Поиск по заметкам и фильмам...",
    "Search notes and titles..."
  );
  setElAttr(
    "#bookmarks-search-input",
    "aria-label",
    "Поиск по заметкам и фильмам",
    "Search notes and titles"
  );
  setElAttr("#bookmarks-filter-pills", "aria-label", "Фильтр закладок", "Bookmark filter");
  setElText('#bookmarks-filter-pills [data-bm-filter="all"]', "Все", "All");
  setElText('#bookmarks-filter-pills [data-bm-filter="movie"]', "Фильмы", "Movies");
  setElText('#bookmarks-filter-pills [data-bm-filter="series"]', "Сериалы", "Series");
  setElText('#bookmarks-filter-pills [data-bm-filter="notes"]', "С заметками", "With Notes");

  // Phone Remote, TV Mode & Cast Modal
  setElText("#tv-cast-modal-title", "Пульт с телефона и Smart TV", "Phone Remote & Smart TV");
  setElText(
    "#tv-cast-sub",
    "Управляйте воспроизведением на компьютере со смартфона по Wi-Fi или передайте видео на Apple TV и Smart TV",
    "Control desktop playback from your phone over Wi-Fi or cast video to Apple TV and Smart TVs"
  );
  setElText("#btn-cast-tab-phone", "Пульт с телефона", "Phone Remote");
  setElText("#btn-cast-tab-tv", "Smart TV и AirPlay", "Smart TV & AirPlay");
  setElText("#remote-qr-heading", "Отсканируйте QR-код камерой телефона", "Scan QR Code with Your Phone");
  setElText(
    "#remote-qr-desc",
    "Телефон и компьютер должны быть в одной сети Wi-Fi. На телефоне откроется пульт управления Velarium без установки приложений.",
    "Make sure your phone and computer are on the same Wi-Fi network. Opens the Velarium remote directly in your browser."
  );
  setElText("#lbl-remote-copy-url", "Скопировать", "Copy");
  setElText("#remote-features-heading", "Возможности мобильного пульта", "Mobile Remote Capabilities");
  setElText(
    "#remote-features-desc",
    "Полное управление воспроизведением на компьютере в оконном и полноэкранном режиме: пауза, перемотка, громкость, переключение студий озвучки, субтитров и серий, навигация D-Pad и запуск любого фильма из каталога.",
    "Full desktop playback control in windowed and fullscreen modes: play/pause, scrubbing, volume, audio studio, subtitle & episode switching, D-Pad navigation, and launching any catalog title."
  );
  setElText("#remote-cap-1", "Сенсорный тачпад и D-Pad", "Touchpad & D-Pad");
  setElText("#remote-cap-2", "Озвучки, 4K и субтитры", "Audio, 4K & Subtitles");
  setElText("#remote-cap-3", "X-Ray, саундтреки и факты", "X-Ray, Music & Trivia");
  setElText("#remote-cap-4", "DSP эквалайзер и таймер сна", "DSP EQ & Sleep Timer");
  setElText("#remote-cap-5", "Оценка в Kinorium (1–10)", "Kinorium Rating (1–10)");
  setElText("#lbl-remote-open-preview", "Открыть веб-пульт", "Open Web Remote");
  setElText("#lbl-remote-rotate-key", "Сменить ключ доступа", "Rotate Access Key");
  setElText("#tv-airplay-heading", "Apple TV (AirPlay) и режим пульта", "Apple TV (AirPlay) & Remote Mode");
  setElText(
    "#tv-airplay-desc",
    "Нативная передача видеопотока в Apple TV через системное меню AirPlay и управление стрелками D-pad или геймпадом.",
    "Native video streaming to Apple TV via the system AirPlay picker plus D-pad arrow & gamepad navigation."
  );
  setElText("#btn-tv-airplay-picker > span", "Выбрать Apple TV (AirPlay)", "Open AirPlay Picker");
  setElText("#btn-tv-enable-dpad > span", "Включить режим ТВ (пульт / геймпад)", "Enable TV Mode (D-pad / Gamepad)");
  setElText("#tv-qr-heading", "Открыть на Smart TV по QR-коду", "Open on Smart TV via QR Code");
  setElText(
    "#tv-qr-desc",
    "Наведите камеру или браузер телевизора в вашей Wi-Fi сети — откроется ТВ-версия Velarium с текущим фильмом.",
    "Scan on your phone or Smart TV browser on the same Wi-Fi to launch Velarium in TV Mode."
  );
  setElText("#btn-tv-copy-url > span", "Скопировать адрес", "Copy LAN Link");
  setElText("#tv-dlna-heading", "Устройства DLNA / UPnP в локальной сети", "DLNA / UPnP Devices on LAN");
  setElText("#btn-tv-rescan > span", "Обновить поиск", "Rescan");
  setElText("#btn-tv-stop-cast > span", "Остановить", "Stop");
  setElAttr("#close-tv-cast-modal", "title", "Закрыть (Esc)", "Close (Esc)");
  setElAttr("#close-tv-cast-modal", "aria-label", "Закрыть", "Close");

  // Household Profiles Modal
  setElText("#profiles-modal-title", "Домашние профили", "Household Profiles");
  setElText(
    "#profiles-modal-sub",
    "Отдельная история просмотра, прогресс серий, язык озвучки по умолчанию и собственный аккаунт Kinorium для каждого профиля",
    "Separate watch history, episode progress, default audio preference, and dedicated Kinorium account per profile"
  );
  setElText("#prof-lbl-name", "Название профиля", "Profile Name");
  setElAttr("#prof-edit-name", "placeholder", "Например: Личный, Семейный, Детский", "e.g. Personal, Family, Kids");
  setElText("#prof-lbl-audio", "Язык озвучки по умолчанию", "Default Audio Language");
  setElText("#prof-opt-audio-auto", "Автоматически (по языку интерфейса)", "Auto (match UI language)");
  setElText("#prof-opt-audio-dub", "Русская озвучка / дубляж", "Russian Dub / Voiceover");
  setElText("#prof-opt-audio-orig", "Оригинальная дорожка + субтитры", "Original Audio + Subtitles");
  setElText("#prof-lbl-color", "Цвет аватара", "Avatar Color");
  setElText("#prof-kids-title", "Детский безопасный режим", "Kids Safe Mode");
  setElText(
    "#prof-kids-sub",
    "Скрывать фильмы 16+ / 18+, ужасы, триллеры и взрослый контент из каталога",
    "Hide 16+ / 18+ titles, horror, thrillers, and mature content from catalog"
  );
  setElText("#btn-prof-save", "Сохранить профиль", "Save Profile");
  setElText("#btn-prof-delete", "Удалить", "Delete");
  setElText("#prof-lbl-pin", "Родительский PIN-код (4 цифры, необязательно)", "Parental PIN (4 digits, optional)");
  setElAttr("#prof-edit-pin", "placeholder", "4 цифры (оставьте пустым без PIN)", "4 digits (leave blank for no PIN)");
  setElText("#btn-prof-clear-pin", "Убрать PIN", "Remove PIN");
  setElText("#prof-pin-status-tag", "PIN активен", "PIN active");
  setElText("#tab-btn-offline", "Офлайн", "Offline");
  setElAttr(
    "#tab-btn-offline",
    "title",
    "Воспроизведение локально сохранённого файла без интернета",
    "Play locally saved file without internet"
  );
  setElText("#prof-pin-hint", "При переключении из этого детского профиля или изменении защиты потребуется ввести этот 4-значный код", "Switching out of this Kids profile or changing protection will require this 4-digit PIN");
  setElText("#kids-pin-modal-title", "Родительский PIN-код", "Parental PIN");
  if (document.getElementById("kids-pin-modal")?.classList.contains("hidden")) {
    setElText(
      "#kids-pin-modal-desc",
      "Введите 4-значный PIN-код для выхода из детского профиля",
      "Enter the 4-digit PIN to exit the Kids profile"
    );
  }
  setElText("#kids-pin-modal-cancel", "Отмена", "Cancel");
  setElText("#kids-pin-modal-submit", "Подтвердить", "Confirm");
  setElAttr("#kids-pin-modal-input", "aria-label", "Родительский PIN-код (4 цифры)", "Parental PIN (4 digits)");
  setElAttr("#global-search", "aria-label", "Поиск фильмов, сериалов и актёров", "Search movies, series, and actors");
  setElAttr("#postwatch-comment", "aria-label", "Комментарий к оценке", "Rating comment");
  setElAttr("#select-studio", "aria-label", "Озвучка и студия", "Audio track and studio");
  setElAttr("#select-quality", "aria-label", "Качество видео", "Video quality");
  setElAttr("#select-subtitle", "aria-label", "Субтитры", "Subtitles");
  setElAttr("#select-season", "aria-label", "Выбор сезона", "Select season");
  setElAttr("#cfg-stremio-manifest-input", "aria-label", "Ссылка manifest.json или stremio://", "Stremio manifest.json or stremio:// URL");
  setElAttr("#ob-kinorium-user", "aria-label", "ID или ссылка на профиль Kinorium", "Kinorium profile ID or URL");
  setElAttr("#ob-kinorium-cookie", "aria-label", "Session Cookie Kinorium", "Kinorium Session Cookie");
  setElAttr("#command-palette-input", "aria-label", "Поиск фильмов, персон, разделов и действий", "Search movies, people, sections, and actions");
  setElAttr("#close-profiles-modal", "title", "Закрыть (Esc)", "Close (Esc)");
  setElAttr("#close-profiles-modal", "aria-label", "Закрыть", "Close");

  // Document title, meta description & Auto-Updater translations
  if (typeof document !== "undefined") {
    document.title = en
      ? "Velarium — Unified Cinema Hub"
      : "Velarium — Единый кинотеатр";
    const metaDescEl =
      document.getElementById("meta-app-description") ||
      document.querySelector('meta[name="description"]');
    if (metaDescEl) {
      metaDescEl.setAttribute(
        "content",
        en
          ? "Velarium — Unified cinema hub for macOS & Windows: HDRezka, 4K Remux, Stremio, Kinorium two-way sync, offline downloads, and Smart TV cast."
          : "Velarium — Единый кинотеатр для macOS и Windows: HDRezka, 4K Remux, Stremio, двусторонняя синхронизация Kinorium, офлайн-загрузки и Smart TV."
      );
    }
  }
  setElText("#about-update-heading", "Обновления приложения", "Software Updates");
  setElText("#summary-about-updater", "Параметры источника обновлений", "Update Source Settings");
  setElText(
    "#lbl-auto-check-updates",
    "Автоматически проверять обновления при запуске",
    "Automatically check for updates on launch"
  );
  setElText(
    "#lbl-update-repo",
    "Репозиторий GitHub (owner/repo)",
    "GitHub Repository (owner/repo)"
  );
  setElText(
    "#lbl-update-manifest-url",
    "URL манифеста (latest.json)",
    "Manifest URL (latest.json)"
  );
}
