import {
  PREFERRED_STUDIOS_STORAGE_KEY,
  profileStorageKey,
  state,
} from "./state.js?v=20261105v5";
import { isEn, t } from "./i18n.js?v=20261105v5";
import {
  findOfflineDownloadForTitle,
  formatTime,
  getEpisodeProgress,
  pluralRu,
} from "./utils.js?v=20261105v5";
import { switchSourceTab } from "./player.js?v=20261105v5";
import { renderHero } from "./catalog-hero.js?v=20261105v5";
import {
  renderCatalogShelves,
  renderContinueWatching,
} from "./catalog-shelves.js?v=20261105v5";
import {
  clearCatalogFrontendCache,
  updateKinoriumSectionCounters,
} from "./catalog.js?v=20261105v5";

export function isEpisodeWatched(item, seasonNum, epNum) {
  if (!item || item.media_type !== "series") return false;
  const ks = item.kinorium || {};
  const weMap = ks.watched_episodes || {};
  const seasonList = weMap[String(seasonNum)];
  if (Array.isArray(seasonList)) {
    return seasonList.includes(Number(epNum));
  }
  if (Object.keys(weMap).length > 0) {
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
export function getPreferredStudioForItem(item) {
  if (!item) return null;
  try {
    const raw = localStorage.getItem(profileStorageKey(PREFERRED_STUDIOS_STORAGE_KEY));
    if (!raw) return null;
    const map = JSON.parse(raw) || {};
    const idKey = String(item.id || "").trim();
    const titleKey = String(item.title || "").trim().toLowerCase();
    const pref = (idKey && map[idKey]) || (titleKey && map[titleKey]) || null;
    if (pref && (/premium/i.test(pref.name || "") || pref.is_prem_locked || pref.is_premium)) {
      return null;
    }
    return pref;
  } catch (_) {
    return null;
  }
}
export function savePreferredStudioForItem(item, studioId, studioName) {
  if (!item || (!studioId && !studioName)) return;
  if (/premium/i.test(String(studioName || ""))) return;
  try {
    const storageKey = profileStorageKey(PREFERRED_STUDIOS_STORAGE_KEY);
    const raw = localStorage.getItem(storageKey);
    const map = raw ? JSON.parse(raw) || {} : {};
    const entry = {
      id: String(studioId || ""),
      name: String(studioName || ""),
      updated_at: Date.now(),
    };
    const idKey = String(item.id || "").trim();
    const titleKey = String(item.title || "").trim().toLowerCase();
    if (idKey) map[idKey] = entry;
    if (titleKey) map[titleKey] = entry;
    localStorage.setItem(storageKey, JSON.stringify(map));
  } catch (err) { window.logDebug?.("CatalogMediaResolver", err); }
}
let _cwIndexRef = null;
let _cwById = new Map();
let _cwByTitle = new Map();
let _catIndexRef = null;
let _catById = new Map();
let _catByTitle = new Map();

function _ensureCwLookup() {
  const arr = state.continueWatching;
  if (arr === _cwIndexRef) return;
  _cwIndexRef = arr;
  _cwById = new Map();
  _cwByTitle = new Map();
  if (!Array.isArray(arr)) return;
  for (const cw of arr) {
    if (!cw) continue;
    if (cw.id && !_cwById.has(cw.id)) _cwById.set(cw.id, cw);
    const tl = String(cw.title || "").trim().toLowerCase();
    if (tl && !_cwByTitle.has(tl)) _cwByTitle.set(tl, cw);
  }
}

function _ensureCatalogLookup() {
  const arr = state.catalogItems;
  if (arr === _catIndexRef) return;
  _catIndexRef = arr;
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
  const kid = item.kinorium?.kinorium_id ? `kin_${item.kinorium.kinorium_id}` : "";
  if (item.id && _cwById.has(item.id)) return _cwById.get(item.id);
  if (kid && _cwById.has(kid)) return _cwById.get(kid);
  const tLow = (item.title || "").trim().toLowerCase();
  if (tLow && _cwByTitle.has(tLow)) return _cwByTitle.get(tLow);
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
  if (!item) return null;
  const ks = item.kinorium || {};
  const keys = [
    item.id,
    ks.kinorium_id ? `kin_${ks.kinorium_id}` : "",
    ks.kinorium_id ? String(ks.kinorium_id) : "",
    (item.title || "").trim().toLowerCase(),
    (item.orig_title || "").trim().toLowerCase(),
  ].filter(Boolean);
  for (const k of keys) {
    if (state.liveSeriesUpdates[k]) return state.liveSeriesUpdates[k];
  }
  return null;
}
export function resolveSeriesEpisodeInfo(item) {
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
    for (let e = 1; e <= maxEpToCheck; e++) {
      if (watchedSet.has(e) || isEpisodeWatched(item, finalSeason, e)) {
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
  // 1. Top Navigation Channel Bar (#provider-filter-bar)
  // Display streaming catalogs & playback channels that are enabled in user settings (no login required to browse catalogs)
  const isTopBarProviderVisible = (prov) => {
    if (!prov || prov === "all") return true;
    return isServiceEnabled(prov);
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
  let sum = 0;
  let count = 0;
  for (const fr of list) {
    const sc = parseFloat(fr?.score);
    if (!Number.isNaN(sc) && sc > 0) {
      sum += sc;
      count += 1;
    }
  }
  return count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
}

export function patchCatalogItemKinoriumInPlace(item, kStatus) {
  if (!item || !kStatus) return;
  clearCatalogFrontendCache();
  item.kinorium = kStatus;
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
      }
    });
  };
  patchList(state.catalogItems);
  patchList(state.similarPool);
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
    renderCatalogShelves();
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

