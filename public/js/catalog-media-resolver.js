import {
  PREFERRED_STUDIOS_STORAGE_KEY,
  profileStorageKey,
  state,
} from "./state.js?v=20261113v1";
import { isEn, t } from "./i18n.js?v=20261113v1";
import {
  escapeHtml,
  findOfflineDownloadForTitle,
  formatTime,
  genitiveAfterIz,
  getEpisodeProgress,
  getLocalProgressEpoch,
  iconSvg,
  pluralRu,
  syncCustomSelect,
} from "./utils.js?v=20261113v1";
import { getPlayerPrefs } from "./audio-dsp.js?v=20261113v1";
import {
  renderModalProvidersSidebar,
  switchSourceTab,
} from "./player.js?v=20261113v1";
import { renderHero } from "./catalog-hero.js?v=20261113v1";
import {
  renderCatalogShelves,
  renderContinueWatching,
} from "./catalog-shelves.js?v=20261113v1";
import {
  clearCatalogFrontendCache,
  updateKinoriumSectionCounters,
} from "./catalog.js?v=20261113v1";

const paidOfficialSet = new Set(["appletv", "netflix", "prime", "disney", "max", "playerpl"]);

function _hasOwnKeys(obj) {
  if (!obj || typeof obj !== "object") return false;
  for (const _ in obj) return true;
  return false;
}

export function isEpisodeWatched(item, seasonNum, epNum) {
  if (!item || item.media_type !== "series") return false;
  const ks = item.kinorium || {};
  const weMap = ks.watched_episodes || {};
  const seasonList = weMap[String(seasonNum)];
  if (Array.isArray(seasonList)) {
    return seasonList.includes(Number(epNum));
  }
  if (_hasOwnKeys(weMap)) {
    return false;
  }
  if (ks.watched && !ks.has_new_episode && !ks.watching) return true;
  if (ks.watching || ks.has_new_episode) {
    const nextS = Number(ks.next_season || 1);
    const nextE = Number(ks.next_episode || 1);
    if (seasonNum < nextS || (seasonNum === nextS && epNum < nextE)) {
      return true;
    }
  }
  return false;
}
export function normalizeStudioBrand(studioName) {
  let s = String(studioName || "").trim().toLowerCase();
  if (!s) return "";
  s = s
    .replace(/\b(hdrezka\s*studio|rezka\s*studio|hdrezka)\b/gi, "hdrezka studio")
    .replace(/\((?:субтитры|subtitles|subs|1080p|4k|uhd|original|оригинал)\)/gi, "")
    .replace(/\[(?:субтитры|subtitles|subs|1080p|4k|uhd)\]/gi, "")
    .replace(/[^\p{L}\p{N}\s+.&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const knownBrands = [
    ["red head sound", "red head sound"],
    ["rhs", "red head sound"],
    ["lostfilm", "lostfilm"],
    ["лостфильм", "lostfilm"],
    ["tvshows", "tvshows"],
    ["hdrezka studio", "hdrezka studio"],
    ["newstudio", "newstudio"],
    ["ньюстудио", "newstudio"],
    ["кубик в кубе", "кубик в кубе"],
    ["kubik v kube", "кубик в кубе"],
    ["jaskier", "jaskier"],
    ["яскьер", "jaskier"],
    ["alexfilm", "alexfilm"],
    ["алексфильм", "alexfilm"],
    ["пифагор", "пифагор"],
    ["pifagor", "пифагор"],
    ["apple tv", "apple tv"],
    ["дубляж", "дубляж"],
    ["оригинал", "оригинал"],
    ["original", "оригинал"],
  ];
  for (const [needle, canonical] of knownBrands) {
    if (s === needle || s.includes(needle)) {
      return canonical;
    }
  }
  return s;
}

export function getItemStudioPreferenceKeys(item) {
  if (!item || typeof item !== "object") return [];
  const keys = [];
  const addKey = (k) => {
    const clean = String(k || "").trim();
    if (clean && !keys.includes(clean)) keys.push(clean);
  };
  addKey(item.id);
  const kid = String(item.kinorium_id || item.kinorium?.kinorium_id || "").trim();
  if (kid) addKey(kid.startsWith("kin_") ? kid : `kin_${kid}`);
  const rid = String(item.rezka_id || "").trim();
  if (rid) addKey(rid.startsWith("rezka_") ? rid : `rezka_${rid}`);
  const imdb = String(item.imdb_id || "").trim();
  if (imdb) addKey(imdb);
  const titleLow = String(item.title || "").trim().toLowerCase();
  if (titleLow) addKey(titleLow);
  const origLow = String(item.orig_title || "").trim().toLowerCase();
  if (origLow) addKey(origLow);
  return keys;
}

export function matchPreferredStudioInList(studiosList, savedPref) {
  if (!savedPref || !Array.isArray(studiosList) || studiosList.length === 0) return null;
  const prefId = String(savedPref.id || "").trim();
  const prefNameLow = String(savedPref.name || "").trim().toLowerCase();
  const prefBrand = String(savedPref.brand || normalizeStudioBrand(savedPref.name || "")).trim();
  if (prefId) {
    const byId = studiosList.find((st) => st && String(st.id || "").trim() === prefId);
    if (byId) return byId;
  }
  if (prefNameLow) {
    const byExactName = studiosList.find(
      (st) => st && String(st.name || "").trim().toLowerCase() === prefNameLow
    );
    if (byExactName) return byExactName;
  }
  if (prefBrand) {
    const byBrand = studiosList.find(
      (st) => st && normalizeStudioBrand(st.name || "") === prefBrand
    );
    if (byBrand) return byBrand;
  }
  return null;
}

let _preferredStudiosCache = null;
let _preferredStudiosCacheKey = "";
let _preferredStudiosCacheRaw = null;
if (typeof window !== "undefined") {
  window.addEventListener("storage", (ev) => {
    if (!ev || !ev.key || ev.key.includes(PREFERRED_STUDIOS_STORAGE_KEY)) {
      _preferredStudiosCache = null;
      _preferredStudiosCacheKey = "";
      _preferredStudiosCacheRaw = null;
    }
  });
}

function _getPreferredStudiosMap() {
  const storageKey = profileStorageKey(PREFERRED_STUDIOS_STORAGE_KEY);
  const raw = typeof localStorage !== "undefined" ? localStorage.getItem(storageKey) : null;
  if (_preferredStudiosCache && _preferredStudiosCacheKey === storageKey && _preferredStudiosCacheRaw === raw) {
    return _preferredStudiosCache;
  }
  const parsed = raw ? JSON.parse(raw) || {} : {};
  const map = parsed && typeof parsed === "object" ? parsed : {};
  _preferredStudiosCacheKey = storageKey;
  _preferredStudiosCacheRaw = raw;
  _preferredStudiosCache = map;
  return map;
}

export function getPreferredStudioForItem(item) {
  if (!item) return null;
  try {
    const map = _getPreferredStudiosMap();
    const candidateKeys = getItemStudioPreferenceKeys(item);
    let bestPref = null;
    for (const k of candidateKeys) {
      const candidate = map[k];
      if (!candidate || typeof candidate !== "object") continue;
      if (/premium/i.test(candidate.name || "") || candidate.is_prem_locked || candidate.is_premium) {
        continue;
      }
      if (!bestPref || (Number(candidate.updated_at) || 0) > (Number(bestPref.updated_at) || 0)) {
        bestPref = candidate;
      }
    }
    return bestPref;
  } catch (_) {
    return null;
  }
}
export function savePreferredStudioForItem(item, studioId, studioName) {
  if (!item || (!studioId && !studioName)) return;
  if (/premium/i.test(String(studioName || ""))) return;
  try {
    const storageKey = profileStorageKey(PREFERRED_STUDIOS_STORAGE_KEY);
    const map = { ..._getPreferredStudiosMap() };
    const entry = {
      id: String(studioId || ""),
      name: String(studioName || ""),
      brand: normalizeStudioBrand(studioName),
      updated_at: Date.now(),
    };
    const candidateKeys = getItemStudioPreferenceKeys(item);
    for (const k of candidateKeys) {
      map[k] = entry;
    }
    const serialized = JSON.stringify(map);
    _preferredStudiosCacheKey = storageKey;
    _preferredStudiosCacheRaw = serialized;
    _preferredStudiosCache = map;
    localStorage.setItem(storageKey, serialized);
  } catch (err) { window.logDebug?.("CatalogMediaResolver", err); }
}
let _cwIndexRef = null;
let _cwById = new Map();
let _cwByTitle = new Map();
let _cwIndexLen = -1;
let _cwIndexTopStamp = "";
let _catIndexRef = null;
let _catIndexVer = -1;
let _catById = new Map();
let _catByTitle = new Map();

let _cwFastArrRef = null;
let _cwFastLen = -1;
let _cwFastFirstKey = "";
let _cwFastLastKey = "";
let _cwFastStampVal = "";

function _computeCwStamp(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "0";
  const first = arr[0];
  const last = arr[arr.length - 1];
  const firstKey = first
    ? `${first.id || first.title || ""}:${first.season || 0}:${first.episode || 0}:${Math.floor(Number(first.current_time || 0))}:${first.updated_at || 0}`
    : "";
  const lastKey = last
    ? `${last.id || last.title || ""}:${last.season || 0}:${last.episode || 0}:${Math.floor(Number(last.current_time || 0))}:${last.updated_at || 0}`
    : "";
  if (
    arr === _cwFastArrRef &&
    arr.length === _cwFastLen &&
    firstKey === _cwFastFirstKey &&
    lastKey === _cwFastLastKey &&
    _cwFastStampVal
  ) {
    return _cwFastStampVal;
  }
  let stamp = `${arr.length}`;
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    if (c) {
      stamp += `|${c.id || c.title || ""}:${c.season || 0}:${c.episode || 0}:${Math.floor(Number(c.current_time || 0))}:${c.updated_at || 0}`;
    }
  }
  _cwFastArrRef = arr;
  _cwFastLen = arr.length;
  _cwFastFirstKey = firstKey;
  _cwFastLastKey = lastKey;
  _cwFastStampVal = stamp;
  return stamp;
}

function _ensureCwLookup() {
  const arr = state.continueWatching;
  const curLen = Array.isArray(arr) ? arr.length : -1;
  const topStamp = _computeCwStamp(arr);
  if (arr === _cwIndexRef && curLen === _cwIndexLen && topStamp === _cwIndexTopStamp) return;
  _cwIndexRef = arr;
  _cwIndexLen = curLen;
  _cwIndexTopStamp = topStamp;
  _cwById = new Map();
  _cwByTitle = new Map();
  if (!Array.isArray(arr)) return;
  for (const cw of arr) {
    if (!cw) continue;
    if (cw.id && !_cwById.has(cw.id)) _cwById.set(cw.id, cw);
    const kId = cw.kinorium_id || cw.kinorium?.kinorium_id;
    if (kId) {
      const kPref = `kin_${kId}`;
      if (!_cwById.has(kPref)) _cwById.set(kPref, cw);
    }
    const tl = String(cw.title || "").trim().toLowerCase();
    if (tl && !_cwByTitle.has(tl)) _cwByTitle.set(tl, cw);
    const ol = String(cw.orig_title || "").trim().toLowerCase();
    if (ol && !_cwByTitle.has(ol)) _cwByTitle.set(ol, cw);
  }
}

function _ensureCatalogLookup() {
  const arr = state.catalogItems;
  const curVer = Number(state.catalogIndexVersion) || 0;
  if (arr === _catIndexRef && curVer === _catIndexVer) return;
  _catIndexRef = arr;
  _catIndexVer = curVer;
  _catById = new Map();
  _catByTitle = new Map();
  if (!Array.isArray(arr)) return;
  for (const ci of arr) {
    if (!ci) continue;
    if (ci.id && !_catById.has(ci.id)) _catById.set(ci.id, ci);
    const tl = String(ci.title || "").trim().toLowerCase();
    if (tl && !_catByTitle.has(tl)) _catByTitle.set(tl, ci);
  }
}

export function findSavedProgress(item) {
  if (!item || !state.continueWatching || state.continueWatching.length === 0) return null;
  _ensureCwLookup();
  const kidRaw = item.kinorium?.kinorium_id || item.kinorium_id;
  const kid = kidRaw ? `kin_${kidRaw}` : "";
  if (item.id && _cwById.has(item.id)) return _cwById.get(item.id);
  if (kid && _cwById.has(kid)) return _cwById.get(kid);
  const tLow = (item.title || "").trim().toLowerCase();
  if (tLow && _cwByTitle.has(tLow)) return _cwByTitle.get(tLow);
  const oLow = (item.orig_title || "").trim().toLowerCase();
  if (oLow && _cwByTitle.has(oLow)) return _cwByTitle.get(oLow);
  return null;
}
export function isServiceEnabled(serviceId) {
  if (!serviceId || serviceId === "all") return true;
  const integ = state.integrations?.[serviceId];
  if (!integ) return true;
  return integ.enabled !== false;
}
export function isAnyOfficialPlServiceEnabled() {
  return ["appletv", "netflix", "prime", "disney", "max", "playerpl"].some((k) =>
    isServiceEnabled(k)
  );
}
export function getDefaultPlayableSourceTab() {
  if (state.providerFilter === "stremio" && isServiceEnabled("stremio")) return "stremio";
  if (state.providerFilter === "backup4k" && isServiceEnabled("backup4k")) return "backup4k";
  const prefTab = getPlayerPrefs()?.preferredSourceTab || "";
  if (prefTab && isServiceEnabled(prefTab)) return prefTab;
  if (isServiceEnabled("hdrezka")) return "hdrezka";
  if (isServiceEnabled("stremio")) return "stremio";
  if (isServiceEnabled("backup4k")) return "backup4k";
  return "trailer";
}
export function resolvePreferredPlayTab(item, season = null, episode = null) {
  if (
    item &&
    (item.is_offline ||
      state.isOfflineMode ||
      (typeof navigator !== "undefined" && navigator.onLine === false))
  ) {
    const offlineHit =
      findOfflineDownloadForTitle(
        item,
        item.media_type === "series" ? season : null,
        item.media_type === "series" ? episode : null,
        ["completed"]
      ) || findOfflineDownloadForTitle(item, null, null, ["completed"]);
    if (offlineHit || item.is_offline) return "offline";
  }
  return getDefaultPlayableSourceTab();
}
export function getLiveSeriesUpdateForItem(item) {
  if (!item || !state.liveSeriesUpdates) return null;
  const su = state.liveSeriesUpdates;
  if (item.id && su[item.id]) return su[item.id];
  const ks = item.kinorium || {};
  if (ks.kinorium_id) {
    const kinK = `kin_${ks.kinorium_id}`;
    if (su[kinK]) return su[kinK];
    const sKin = String(ks.kinorium_id);
    if (su[sKin]) return su[sKin];
  }
  if (item.title) {
    const tLow = item.title.trim().toLowerCase();
    if (tLow && su[tLow]) return su[tLow];
  }
  if (item.orig_title) {
    const oLow = item.orig_title.trim().toLowerCase();
    if (oLow && su[oLow]) return su[oLow];
  }
  return null;
}
let _epInfoCacheEpoch = "";
let _epInfoWeakMap = new WeakMap();

function _computeEpInfoEpochKey() {
  const cwStamp = _computeCwStamp(state.continueWatching);
  const liveEpoch = state.liveSeriesUpdatesVersion || 0;
  const locEpoch = getLocalProgressEpoch();
  return `${state.appLang || "ru"}|${state.catalogReqId || 0}|${state.catalogIndexVersion || 0}|${cwStamp}|${liveEpoch}|${locEpoch}`;
}

export function resolveSeriesEpisodeInfo(item) {
  if (!item || typeof item !== "object") {
    return {
      season: 1,
      episode: 1,
      currentTime: 0,
      hasNewEpisode: false,
      isMidEpisodeResume: false,
      episodeVerified: true,
      studio: "HDRezka",
      watchedInSeasonCount: 0,
      totalSeasonEpisodes: 0,
      seasonPct: 0,
      hasSeasonProgress: false,
      seasonProgressText: "",
      seasonShortText: "",
    };
  }
  const curEpoch = _computeEpInfoEpochKey();
  if (curEpoch !== _epInfoCacheEpoch) {
    _epInfoCacheEpoch = curEpoch;
    _epInfoWeakMap = new WeakMap();
  }
  const ks = item.kinorium || {};
  let weCount = 0;
  if (ks.watched_episodes && typeof ks.watched_episodes === "object") {
    if (typeof ks.watched_episodes._weTotal === "number") {
      weCount = ks.watched_episodes._weTotal;
    } else {
      for (const sKey in ks.watched_episodes) {
        if (Object.prototype.hasOwnProperty.call(ks.watched_episodes, sKey)) {
          const arr = ks.watched_episodes[sKey];
          if (Array.isArray(arr)) weCount += arr.length;
        }
      }
      ks.watched_episodes._weTotal = weCount;
    }
  }
  let seasonsMapCount = 0;
  if (item.seasons_map && typeof item.seasons_map === "object") {
    if (typeof item.seasons_map._keysCount === "number") {
      seasonsMapCount = item.seasons_map._keysCount;
    } else {
      seasonsMapCount = Object.keys(item.seasons_map).length;
      item.seasons_map._keysCount = seasonsMapCount;
    }
  }
  const compFlag = item.is_series_completed === true || ks.is_completed === true ? 1 : 0;
  const isActiveInPlayer =
    state.isPlayerOpen &&
    state.activeItem &&
    (state.activeItem === item || (item.id && state.activeItem.id === item.id));
  const activePlayerStamp = isActiveInPlayer ? `:${state.activeSeason || 1}:${state.activeEpisode || 1}` : "";
  const itemStamp = `${item.media_type || "movie"}:${ks.watched ? 1 : 0}:${ks.watching ? 1 : 0}:${ks.has_new_episode ? 1 : 0}:${ks.next_season || 0}:${ks.next_episode || 0}:${ks.latest_season || 0}:${ks.latest_episode || 0}:${weCount}:${seasonsMapCount}:${compFlag}${activePlayerStamp}`;
  const cachedEntry = !isActiveInPlayer ? _epInfoWeakMap.get(item) : null;
  if (cachedEntry && cachedEntry.stamp === itemStamp) {
    return cachedEntry.value;
  }
  const computed = _resolveSeriesEpisodeInfoUncached(item);
  if (!isActiveInPlayer) {
    _epInfoWeakMap.set(item, { stamp: itemStamp, value: computed });
  }
  return computed;
}

function _resolveSeriesEpisodeInfoUncached(item) {
  if (!item || item.media_type !== "series") {
    const cw = findSavedProgress(item);
    const localProg = !cw && item ? getEpisodeProgress(item, 1, 1) : null;
    const effectiveCur = Number(
      cw?.current_time || (localProg && Number(localProg.pct || 0) < 92 ? localProg.current_time : 0) || 0
    );
    return {
      season: 1,
      episode: 1,
      currentTime: effectiveCur,
      hasNewEpisode: false,
      isMidEpisodeResume: effectiveCur >= 15,
      episodeVerified: true,
      studio: cw?.studio || localProg?.studio || "HDRezka",
      watchedInSeasonCount: 0,
      totalSeasonEpisodes: 0,
      seasonPct: 0,
      hasSeasonProgress: false,
      seasonProgressText: "",
      seasonShortText: "",
    };
  }

  let catMatch = null;
  if (!item.kinorium && Array.isArray(state.catalogItems)) {
    _ensureCatalogLookup();
    const tLow = String(item.title || "").trim().toLowerCase();
    catMatch = (item.id && _catById.get(item.id)) || (tLow && _catByTitle.get(tLow)) || null;
  }

  const ks = item.kinorium || catMatch?.kinorium || {};
  const live = getLiveSeriesUpdateForItem(item) || (catMatch ? getLiveSeriesUpdateForItem(catMatch) : null);
  const savedCw = findSavedProgress(item);
  const isMidEpisodeResume = Boolean(
    savedCw && !savedCw.is_new_episode && Number(savedCw.current_time || 0) >= 15
  );
  const weMap = ks.watched_episodes || {};

  const isCompleted = Boolean(
    (live && !live.not_found && live.is_completed) ||
      ks.is_completed ||
      item.is_series_completed ||
      catMatch?.is_series_completed
  );

  const lSeasonMeta = Number(live && !live.not_found ? live.latest_season : ks.latest_season) || 0;
  const lEpMeta = Number(live && !live.not_found ? live.latest_episode : ks.latest_episode) || 0;
  const numericSeasonsAll = Object.keys(weMap)
    .filter((k) => /^\d+$/.test(k) && Array.isArray(weMap[k]) && weMap[k].length > 0)
    .map((k) => Number(k))
    .sort((a, b) => a - b);

  const hasFinishedPriorSeason = Boolean(
    !isCompleted &&
      numericSeasonsAll.length > 0 &&
      lSeasonMeta > 0 &&
      numericSeasonsAll[numericSeasonsAll.length - 1] < lSeasonMeta &&
      (ks.watching || item.watching)
  );

  let allReleasedEpisodesWatched = Boolean(
    (ks.watched && !ks.watching && !ks.has_new_episode && ks.status_code !== "new_ep") ||
    ks.all_released_episodes_watched
  );
  let hasNewEpisode = Boolean(
    !isCompleted &&
      !ks.not_watching &&
      !allReleasedEpisodesWatched &&
      (item.is_new_episode === true ||
        ks.has_new_episode === true ||
        ks.status_code === "new_ep" ||
        (savedCw?.is_new_episode === true && !isMidEpisodeResume))
  );
  let season = Number(ks.next_season || item.season || catMatch?.season || 1);
  let episode = Number(ks.next_episode || item.episode || 1);
  let currentTime = isMidEpisodeResume ? Number(savedCw.current_time || 0) : 0;
  let episodeVerified = Boolean(ks.episode_verified || item.episode_verified || isMidEpisodeResume);
  let studio =
    live?.studios_summary ||
    ks.studios_summary ||
    (savedCw?.studio && savedCw.studio !== "Новая серия" ? savedCw.studio : "") ||
    (item.studio && item.studio !== "Новая серия" ? item.studio : "") ||
    "HDRezka";

  if (lSeasonMeta > 0 && lEpMeta > 0) {
    const watchedInLatest = Array.isArray(weMap[String(lSeasonMeta)]) ? weMap[String(lSeasonMeta)] : [];
    const maxWLatest = watchedInLatest.length > 0 ? Math.max(...watchedInLatest.map((n) => Number(n) || 0)) : 0;
    const maxSeasonWatched = numericSeasonsAll.length > 0 ? numericSeasonsAll[numericSeasonsAll.length - 1] : 0;
    if (maxWLatest >= lEpMeta || maxSeasonWatched > lSeasonMeta) {
      allReleasedEpisodesWatched = true;
      hasNewEpisode = false;
      currentTime = 0;
    } else if (ks.watched && !ks.has_new_episode && ks.status_code !== "new_ep") {
      allReleasedEpisodesWatched = true;
      hasNewEpisode = false;
      currentTime = 0;
    } else if ((ks.watching || ks.has_new_episode || ks.status_code === "new_ep" || item.watching) && !ks.not_watching) {
      allReleasedEpisodesWatched = false;
      if (maxWLatest < lEpMeta && (!numericSeasonsAll.length || numericSeasonsAll[numericSeasonsAll.length - 1] <= lSeasonMeta)) {
        hasNewEpisode = true;
      }
    }
  }

  if (hasNewEpisode && !isMidEpisodeResume) {
    if (Number(ks.next_season) > 0 && Number(ks.next_episode) > 0) {
      season = Number(ks.next_season);
      episode = Number(ks.next_episode);
      episodeVerified = true;
    } else if (lSeasonMeta > 0 && lEpMeta > 0) {
      const watchedInLatest = Array.isArray(weMap[String(lSeasonMeta)]) ? weMap[String(lSeasonMeta)] : [];
      const maxWLatest = watchedInLatest.length > 0 ? Math.max(...watchedInLatest.map((n) => Number(n) || 0)) : 0;
      season = lSeasonMeta;
      episode = maxWLatest + 1;
      episodeVerified = true;
    }
  }

  if (isMidEpisodeResume && savedCw && !allReleasedEpisodesWatched) {
    season = Number(savedCw.season || season || 1);
    episode = Number(savedCw.episode || 1);
    episodeVerified = true;
  } else if (live && !live.not_found && live.latest_season && live.latest_episode) {
    const lSeason = Number(live.latest_season || 1);
    const lEp = Number(live.latest_episode || 1);
    const watchedInSeason = Array.isArray(weMap[String(lSeason)]) ? weMap[String(lSeason)] : [];
    if (numericSeasonsAll.length > 0 && numericSeasonsAll[numericSeasonsAll.length - 1] > lSeason) {
      const maxS = numericSeasonsAll[numericSeasonsAll.length - 1];
      hasNewEpisode = false;
      allReleasedEpisodesWatched = true;
      season = maxS;
      episode = Math.max(...weMap[String(maxS)].map((n) => Number(n) || 0), 1);
    } else if (watchedInSeason.length > 0) {
      const maxW = Math.max(...watchedInSeason.map((n) => Number(n) || 0));
      if (maxW >= lEp) {
        hasNewEpisode = false;
        allReleasedEpisodesWatched = true;
        season = lSeason;
        episode = lEp;
      } else {
        season = lSeason;
        episode = maxW + 1;
      }
    } else {
      if (numericSeasonsAll.length > 0) {
        const maxPrevS = numericSeasonsAll[numericSeasonsAll.length - 1];
        const maxPrevEp = Math.max(...weMap[String(maxPrevS)].map((n) => Number(n) || 0));
        const prevSeasonMap = live.seasons_map?.[String(maxPrevS)];
        if (
          Array.isArray(prevSeasonMap) &&
          prevSeasonMap.length > 0 &&
          maxPrevEp < Math.max(...prevSeasonMap.map((n) => Number(n) || 0))
        ) {
          season = maxPrevS;
          episode = maxPrevEp + 1;
        } else {
          season = Math.min(lSeason, maxPrevS + 1);
          episode = 1;
        }
      } else if (savedCw && !savedCw.is_new_episode && (savedCw.season || savedCw.episode)) {
        season = Number(savedCw.season || 1);
        episode = Number(savedCw.episode || 1);
      } else {
        season = 1;
        episode = 1;
      }
    }
    episodeVerified = true;
  } else if (live && live.not_found && !isMidEpisodeResume) {
    hasNewEpisode = false;
    episodeVerified = false;
  }

  const finalSeason = Math.max(1, season || 1);
  const finalEpisode = Math.max(1, episode || 1);

  // Compute per-season episode progress (watchedInSeasonCount / totalSeasonEpisodes)
  // totalSeasonEpisodes reflects AVAILABLE (released) episodes in finalSeason
  let totalSeasonEpisodes = 0;
  if (live && !live.not_found) {
    const mapForS = live.seasons_map?.[String(finalSeason)];
    if (Array.isArray(mapForS) && mapForS.length > 0) {
      totalSeasonEpisodes = mapForS.length;
    }
    if (Number(live.latest_season) === finalSeason && Number(live.latest_episode) > 0) {
      totalSeasonEpisodes = Number(live.latest_episode);
    }
  }
  if (!totalSeasonEpisodes && Number(ks.latest_season) === finalSeason && Number(ks.latest_episode) > 0) {
    totalSeasonEpisodes = Number(ks.latest_episode);
  }
  if (!totalSeasonEpisodes) {
    const fallbackEps = Number(item.episodes_per_season || catMatch?.episodes_per_season || 0);
    if (fallbackEps > 0) totalSeasonEpisodes = fallbackEps;
  }

  const rawSeasonWatched = Array.isArray(weMap[String(finalSeason)]) ? weMap[String(finalSeason)] : [];
  const watchedSet = new Set(
    rawSeasonWatched.map((n) => Number(n) || 0).filter((n) => n > 0)
  );
  let watchedInSeasonCount = 0;
  if (
    (((ks.watched && !hasNewEpisode) || (ks.watched && !ks.watching)) || allReleasedEpisodesWatched) &&
    totalSeasonEpisodes > 0
  ) {
    watchedInSeasonCount = totalSeasonEpisodes;
  } else {
    const maxEpToCheck = Math.max(totalSeasonEpisodes, watchedSet.size, finalEpisode);
    let countWatched = 0;
    for (const epNum of watchedSet) {
      if (epNum >= 1 && epNum <= maxEpToCheck) {
        countWatched++;
      }
    }
    if (countWatched > 0) {
      watchedInSeasonCount = totalSeasonEpisodes > 0 ? Math.min(totalSeasonEpisodes, countWatched) : countWatched;
    } else if (isMidEpisodeResume && episodeVerified && finalEpisode > 1) {
      watchedInSeasonCount = finalEpisode - 1;
    } else if ((ks.watching || hasNewEpisode) && episodeVerified && finalEpisode > 1) {
      watchedInSeasonCount = Math.min(totalSeasonEpisodes || finalEpisode - 1, finalEpisode - 1);
    }
  }

  if (totalSeasonEpisodes > 0 && watchedInSeasonCount > totalSeasonEpisodes) {
    totalSeasonEpisodes = watchedInSeasonCount;
  } else if (!totalSeasonEpisodes && watchedInSeasonCount > 0 && finalEpisode > watchedInSeasonCount) {
    totalSeasonEpisodes = finalEpisode;
  }

  if (totalSeasonEpisodes > 0 && watchedInSeasonCount < totalSeasonEpisodes && !isCompleted && !ks.not_watching) {
    hasNewEpisode = true;
    allReleasedEpisodesWatched = false;
  }
  if (totalSeasonEpisodes > 0 && watchedInSeasonCount >= totalSeasonEpisodes && (!lSeasonMeta || finalSeason >= lSeasonMeta)) {
    allReleasedEpisodesWatched = true;
    hasNewEpisode = false;
  }
  if (isCompleted || allReleasedEpisodesWatched) {
    hasNewEpisode = false;
  }

  const kinEnabled = isServiceEnabled("kinorium");
  const hasSeasonProgress = Boolean(
    kinEnabled &&
      !ks.not_watching &&
      (watchedInSeasonCount > 0 || ((ks.watching || hasNewEpisode) && totalSeasonEpisodes > 0))
  );
  const seasonPct =
    totalSeasonEpisodes > 0
      ? Math.min(100, Math.round((watchedInSeasonCount / totalSeasonEpisodes) * 100))
      : 0;
  const seasonProgressText =
    totalSeasonEpisodes > 0
      ? isEn()
        ? `Watched ${watchedInSeasonCount} of ${totalSeasonEpisodes} ${totalSeasonEpisodes === 1 ? "episode" : "episodes"}`
        : `Просмотрено ${watchedInSeasonCount} из ${totalSeasonEpisodes} ${genitiveAfterIz(
            totalSeasonEpisodes,
            "серии",
            "серий"
          )}`
      : watchedInSeasonCount > 0
      ? isEn()
        ? `Watched ${watchedInSeasonCount} ${watchedInSeasonCount === 1 ? "episode" : "episodes"}`
        : `Просмотрено ${watchedInSeasonCount} ${pluralRu(watchedInSeasonCount, "серия", "серии", "серий")}`
      : "";
  const seasonShortText =
    totalSeasonEpisodes > 0
      ? isEn()
        ? `${watchedInSeasonCount} of ${totalSeasonEpisodes} ${totalSeasonEpisodes === 1 ? "episode" : "episodes"}`
        : `${watchedInSeasonCount} из ${totalSeasonEpisodes} ${genitiveAfterIz(
            totalSeasonEpisodes,
            "серии",
            "серий"
          )}`
      : watchedInSeasonCount > 0
      ? isEn()
        ? `${watchedInSeasonCount} ${watchedInSeasonCount === 1 ? "episode" : "episodes"}`
        : `${watchedInSeasonCount} ${pluralRu(watchedInSeasonCount, "серия", "серии", "серий")}`
      : "";

  return {
    season: finalSeason,
    episode: finalEpisode,
    currentTime,
    hasNewEpisode,
    allReleasedEpisodesWatched,
    isCompleted,
    isMidEpisodeResume: isMidEpisodeResume && !allReleasedEpisodesWatched,
    episodeVerified,
    studio,
    watchedInSeasonCount,
    totalSeasonEpisodes,
    seasonPct,
    hasSeasonProgress,
    seasonProgressText,
    seasonShortText,
  };
}

export function isItemWatchedOrCaughtUp(item) {
  if (!item || !isServiceEnabled("kinorium")) return false;
  const ks = item.kinorium || {};
  if (ks.not_watching) return true;
  if (item.media_type !== "series") {
    return Boolean(ks.watched);
  }
  const epInfo = resolveSeriesEpisodeInfo(item);
  if (epInfo.allReleasedEpisodesWatched) return true;
  if (ks.watched && !epInfo.hasNewEpisode) return true;
  return false;
}

export function formatRemainingTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const totalMins = Math.max(1, Math.round(s / 60));
  if (totalMins < 60) {
    return isEn()
      ? `${totalMins} min left`
      : `Осталось ${totalMins} мин`;
  }
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (mins === 0) {
    return isEn()
      ? `${hours} hr left`
      : `Остался ${hours} ч`;
  }
  return isEn()
    ? `${hours} hr ${mins} min left`
    : `Осталось ${hours} ч ${mins} мин`;
}

export function applyEnabledServicesVisibility(activeItem = state.activeItem) {
  // 1. Source Channel Bar (#provider-filter-bar inside #catalog-filters-drawer)
  // Core sources are visible when enabled; paid subscription services only appear once connected/logged in.
  const isTopBarProviderVisible = (prov) => {
    if (!prov || prov === "all") return true;
    if (!isServiceEnabled(prov)) return false;
    if (paidOfficialSet.has(prov)) {
      return Boolean(state.integrations?.[prov]?.logged_in);
    }
    return true;
  };
  let visibleChannelsCount = 0;
  document.querySelectorAll("#provider-filter-bar .atv-pill").forEach((pill) => {
    const prov = pill.dataset.provider;
    if (!prov || prov === "all") return;
    const isVis = isTopBarProviderVisible(prov);
    pill.classList.toggle("hidden", !isVis);
    if (isVis) visibleChannelsCount += 1;
  });
  document
    .getElementById("provider-filter-bar")
    ?.classList.toggle("hidden", visibleChannelsCount === 0);
  if (state.providerFilter !== "all" && !isTopBarProviderVisible(state.providerFilter)) {
    state.providerFilter = "all";
    document.querySelectorAll("#provider-filter-bar .atv-pill").forEach((pill) => {
      const isAll = pill.dataset.provider === "all";
      pill.classList.toggle("active", isAll);
      pill.setAttribute("aria-pressed", isAll ? "true" : "false");
    });
  }

  // 2. Kinorium UI across main page, filters, notifications, stats, quick peek & player
  const kinEnabled = isServiceEnabled("kinorium");
  const rezkaEnabled = isServiceEnabled("hdrezka");
  const stremioEnabled = isServiceEnabled("stremio");
  const b4kEnabled = isServiceEnabled("backup4k");
  const primaryPlayTab = getDefaultPlayableSourceTab();
  const officialAny = isAnyOfficialPlServiceEnabled();

  const isDedicatedProviderChannel = Boolean(state.providerFilter && state.providerFilter !== "all");
  document
    .getElementById("kinorium-sections-bar")
    ?.classList.toggle("hidden", isDedicatedProviderChannel);
  document.querySelectorAll("#kinorium-sections-bar .kin-sec-pill").forEach((pill) => {
    const ksec = pill.dataset.ksec;
    if (ksec && ["watching", "watchlist", "watched", "never"].includes(ksec)) {
      pill.classList.toggle("hidden", !kinEnabled);
    }
  });
  if (
    (!kinEnabled || isDedicatedProviderChannel) &&
    ["watching", "watchlist", "watched", "never"].includes(state.kinoriumSection)
  ) {
    state.kinoriumSection = "all";
    document.querySelectorAll("#kinorium-sections-bar .kin-sec-pill").forEach((pill) => {
      pill.classList.toggle("active", pill.dataset.ksec === "all");
    });
  }

  document
    .getElementById("notifications-wrap")
    ?.classList.toggle("hidden", !kinEnabled || (!rezkaEnabled && !stremioEnabled));
  document.getElementById("btn-check-rezka-updates")?.classList.toggle("hidden", !rezkaEnabled);

  document.getElementById("btn-hide-watched")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("btn-friends-filter")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("select-friend-filter")?.classList.toggle("hidden", !kinEnabled);
  if (!kinEnabled) {
    state.hideWatched = false;
    state.friendsFilter = false;
    state.selectedFriend = "all";
  }

  const sortSel = document.getElementById("select-catalog-sort");
  if (sortSel) {
    Array.from(sortSel.options).forEach((opt) => {
      if (["user_rating", "friends_rating", "kinorium_rating"].includes(opt.value)) {
        opt.hidden = !kinEnabled;
      }
    });
    if (!kinEnabled && ["user_rating", "friends_rating", "kinorium_rating"].includes(state.sortBy)) {
      state.sortBy = "default";
      sortSel.value = "default";
    }
    syncCustomSelect(sortSel);
  }

  const statsBtn = document.getElementById("btn-open-stats-modal");
  if (statsBtn) {
    const statsLbl = kinEnabled
      ? t("Статистика и история", "Stats & Watch History")
      : t("История просмотров", "Watch History");
    statsBtn.innerHTML = `${iconSvg(kinEnabled ? "chart" : "clock", 15)}<span class="atv-prof-util-label" id="prof-menu-stats-lbl">${escapeHtml(statsLbl)}</span>`;
    statsBtn.title = kinEnabled
      ? t("Моя статистика и история просмотров", "My statistics & watch history")
      : t("Локальная история просмотров", "Local watch history");
  }
  document.getElementById("stats-tab-analytics")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("stats-profile-badge")?.classList.toggle("hidden", !kinEnabled);

  // Player modal tabs & Kinorium controls
  document.querySelector('.source-tab[data-tab="hdrezka"]')?.classList.toggle("hidden", !rezkaEnabled);
  document.querySelector('.source-tab[data-tab="stremio"]')?.classList.toggle("hidden", !stremioEnabled);
  document.querySelector('.source-tab[data-tab="backup4k"]')?.classList.toggle("hidden", !b4kEnabled);
  paidOfficialSet.forEach((srv) => {
    const isConnected = isServiceEnabled(srv) && Boolean(state.integrations?.[srv]?.logged_in);
    const hasOffer = Boolean(
      activeItem &&
      Array.isArray(activeItem.providers) &&
      activeItem.providers.some((p) => p && p.id === srv && p.available)
    );
    const tabBtn = document.querySelector(`.source-tab[data-tab="${srv}"]`);
    if (tabBtn) {
      tabBtn.classList.toggle("hidden", !isConnected || !hasOffer);
    }
  });
  if (
    state.isPlayerOpen &&
    paidOfficialSet.has(state.activeSourceTab) &&
    (!isServiceEnabled(state.activeSourceTab) ||
      !Boolean(state.integrations?.[state.activeSourceTab]?.logged_in) ||
      !activeItem?.providers?.some((p) => p && p.id === state.activeSourceTab && p.available))
  ) {
    switchSourceTab(getDefaultPlayableSourceTab());
  }

  document.getElementById("kinorium-status-dropdown-wrap")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("kinorium-rate-dropdown-wrap")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("btn-open-rate")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("score-box-kinorium")?.classList.toggle("hidden", !kinEnabled);
  const hasFriendsRatings = Boolean(state.activeItem?.kinorium?.friends_ratings?.length);
  document.getElementById("sidebar-friends-section")?.classList.toggle("hidden", !kinEnabled || !hasFriendsRatings);
  document.getElementById("btn-toggle-current-ep")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("ep-rate-dropdown-wrap")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("btn-mark-ep-upto")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("btn-mark-season-watched")?.classList.toggle("hidden", !kinEnabled);
  document.querySelector(".atv-ep-batch-group")?.classList.toggle("hidden", !kinEnabled);

  // Quick Peek modal controls
  document.getElementById("qp-score-kinorium")?.classList.toggle("hidden", !kinEnabled);
  document.querySelector(".atv-qp-rate-box")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("qp-status-pills")?.classList.toggle("hidden", !kinEnabled);
  document
    .getElementById("qp-btn-stremio")
    ?.classList.toggle("hidden", !stremioEnabled || primaryPlayTab === "stremio");
  document
    .getElementById("qp-btn-4k")
    ?.classList.toggle("hidden", !b4kEnabled || primaryPlayTab === "backup4k");

  // Settings Tab 2 network groups
  document.getElementById("net-group-hdrezka")?.classList.toggle("hidden", !rezkaEnabled);
  document.getElementById("net-group-stremio")?.classList.toggle("hidden", !stremioEnabled);
  document.getElementById("net-group-backup4k")?.classList.toggle("hidden", !b4kEnabled);

  if (state.isPlayerOpen && state.activeItem) {
    renderModalProvidersSidebar(state.activeItem);
    const activeOfficialDisabled =
      paidOfficialSet.has(state.activeSourceTab) &&
      !(isServiceEnabled(state.activeSourceTab) && Boolean(state.integrations?.[state.activeSourceTab]?.logged_in));
    if (
      (state.activeSourceTab === "hdrezka" && !rezkaEnabled) ||
      (state.activeSourceTab === "stremio" && !stremioEnabled) ||
      (state.activeSourceTab === "backup4k" && !b4kEnabled) ||
      activeOfficialDisabled
    ) {
      switchSourceTab(getDefaultPlayableSourceTab(), 0);
    }
  }
}
export function getFriendsAverageScore(item) {
  const list = item?.kinorium?.friends_ratings;
  if (!Array.isArray(list) || list.length === 0) return 0;
  if (state.selectedFriend && state.selectedFriend !== "all") {
    const matched = list.find((f) => f?.name === state.selectedFriend);
    const sc = parseFloat(matched?.score);
    return !Number.isNaN(sc) && sc > 0 ? Math.round(sc * 10) / 10 : 0;
  }
  if (typeof item._cachedFriendsAvg === "number") {
    return item._cachedFriendsAvg;
  }
  let sum = 0;
  let count = 0;
  for (const fr of list) {
    const sc = parseFloat(fr?.score);
    if (!Number.isNaN(sc) && sc > 0) {
      sum += sc;
      count += 1;
    }
  }
  const avg = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
  item._cachedFriendsAvg = avg;
  return avg;
}

export function patchCatalogItemKinoriumInPlace(item, kStatus) {
  if (!item || !kStatus) return;
  clearCatalogFrontendCache();
  item.kinorium = kStatus;
  delete item._cachedFriendsAvg;
  if (kStatus.kinorium_counts) {
    state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
    updateKinoriumSectionCounters();
  }
  const matchId = item.id || "";
  const matchTitle = (item.title || "").trim().toLowerCase();
  const isSameEntry = (entry) =>
    Boolean(
      entry &&
        ((matchId && (entry.id === matchId || entry.item_id === matchId)) ||
          (matchTitle && (entry.title || "").trim().toLowerCase() === matchTitle))
    );
  const patchList = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((entry) => {
      if (isSameEntry(entry)) {
        entry.kinorium = { ...(entry.kinorium || {}), ...kStatus };
        delete entry._cachedFriendsAvg;
      }
    });
  };
  patchList(state.catalogItems);
  patchList(state.similarPool);
  state.catalogIndexVersion = (state.catalogIndexVersion || 0) + 1;
  if (
    Array.isArray(state.continueWatching) &&
    (kStatus.watched || kStatus.not_watching || kStatus.all_released_episodes_watched || (item.media_type === "series" && !kStatus.watching && !kStatus.has_new_episode))
  ) {
    state.continueWatching = state.continueWatching.filter((cw) => !isSameEntry(cw));
  }
  if (state.kinoriumSection !== "all" && Array.isArray(state.catalogItems)) {
    const keepInSec =
      (state.kinoriumSection === "watching" && kStatus.watching && !kStatus.watched && !kStatus.not_watching && !kStatus.all_released_episodes_watched) ||
      (state.kinoriumSection === "watchlist" && kStatus.in_watchlist && !kStatus.watched && !kStatus.not_watching) ||
      (state.kinoriumSection === "watched" && kStatus.watched && !kStatus.not_watching) ||
      (state.kinoriumSection === "never" && kStatus.not_watching && !kStatus.watched && !kStatus.user_rating);
    if (!keepInSec) {
      state.catalogItems = state.catalogItems.filter((entry) => !isSameEntry(entry));
    }
  }
  if (state.isPlayerOpen && !state.isMiniPlayer && !state.isPipBackground) {
    state.catalogDirty = true;
  } else {
    renderHero();
    renderContinueWatching();
    renderCatalogShelves({ skipHero: true });
  }
}

export function getPrimaryRating(item) {
  if (!item || typeof item !== "object") return 0;
  const r = item.ratings && typeof item.ratings === "object" ? item.ratings : {};
  const candidates = [
    r.kinorium,
    r.imdb,
    item.kinorium?.kinorium_rating,
    item.kinorium?.imdb_rating,
    item.kinorium_rating,
    item.imdb_rating,
    item.rating,
    item.vote_average,
  ];
  for (const c of candidates) {
    const num = Number(c);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
}

