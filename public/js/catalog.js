import {
  NOTIF_DESKTOP_ALERTED_STORAGE_KEY,
  PREFERRED_STUDIOS_STORAGE_KEY,
  profileStorageKey,
  state,
} from "./state.js?v=20261112v1";
import {
  displayBackdrop,
  displayCountries,
  displayDescription,
  displayPoster,
  displayTitle,
  formatCriticsRating,
  getItemGenreEntries,
  hasCyrillicText,
  isEn,
  t,
  translateGenre,
  translateStudioName,
  transliterateRuToEn,
} from "./i18n.js?v=20261112v1";
import {
  attachHorizontalWheelScroll,
  copyTextToClipboard,
  cssUrl,
  escapeAttr,
  escapeHtml,
  findOfflineDownloadForTitle,
  formatTime,
  genitiveAfterIz,
  getEpisodeProgress,
  getSeenNotificationsSet,
  getSimilarReasonLabel,
  iconSvg,
  matchCatalogItemSafe,
  pluralRu,
  rememberModalTriggerFocus,
  restoreModalTriggerFocus,
  saveSeenNotificationsSet,
  saveUiPrefs,
  setAmbientColor,
  showToast,
  syncCustomSelect,
  syncScrollTopButton,
  syncSearchInputHasQueryUI,
} from "./utils.js?v=20261112v1";
import { getPlayerPrefs } from "./audio-dsp.js?v=20261112v1";
import {
  buildPersonPhotoCard,
  maybePausePlayerForOverlay,
  maybeResumePlayerAfterOverlay,
  openPersonModal,
  openQuickPeekModal,
} from "./modals.js?v=20261112v1";
import { openPlayerModal, renderModalProvidersSidebar, switchSourceTab } from "./player.js?v=20261112v1";
import { confirmServiceLogin, openSettingsModal, triggerServiceLoginFlow } from "./settings.js?v=20261112v1";
import { openTvCastModal, renderHeaderProfileSwitcher } from "./features.js?v=20261112v1";
import { getOfflineCatalogItems, setOfflineMode } from "./features-downloads.js?v=20261112v1";
import {
  renderContinueWatching,
  parseItemDurationMinutes,
  renderCuratedShelves,
  renderCatalogShelves,
} from "./catalog-shelves.js?v=20261112v1";
import {
  buildPosterBadgesHtml,
  buildFallbackPosterSvg,
  attachSmartPosterFallback,
  closeCardContextMenu,
  openCardContextMenu,
  createPosterCardElement,
  buildPageNumbers,
  getCatalogGridColumnCount,
  renderPosterCardsInto,
  cancelPendingCardBatch,
  appendPosterCardsProgressive,
} from "./catalog-cards.js?v=20261112v1";
import {
  stopHeroAmbientTeaser,
  scheduleHeroAmbientTeaser,
  stopHeroAutoTimer,
  startHeroAutoTimer,
  stepHeroSlide,
  renderHeroSlide,
  renderHero,
  resetHeroRecordedThisLaunch,
} from "./catalog-hero.js?v=20261112v1";
import {
  collectNewEpisodeNotifications,
  switchNotificationsTab,
  loadAndRenderReleaseCalendar,
  renderNotificationsBell,
} from "./catalog-notifications.js?v=20261112v1";
import {
  openMovieRouletteModal,
  closeMovieRouletteModal,
  initMovieRouletteModal,
  spinMovieRoulette,
  openCommandPalette,
  closeCommandPalette,
  initCommandPalette,
} from "./catalog-discovery.js?v=20261112v1";
import {
  updateActiveFiltersBadge,
  updateDynamicCatalogFilters,
  renderActiveFilterChips,
  filterCatalogItemsByGenreAndYear,
  _hashItemKey,
  seededShuffle,
  rerollCatalogLaunchSeed,
  getCurrentlyFilteredItems,
  sortCatalogItems,
  resetCatalogDrawerFiltersUI,
  initCatalogToolbarAndFilterBindings,
} from "./catalog-filters.js?v=20261112v1";
import {
  isEpisodeWatched,
  normalizeStudioBrand,
  getItemStudioPreferenceKeys,
  matchPreferredStudioInList,
  getPreferredStudioForItem,
  savePreferredStudioForItem,
  findSavedProgress,
  isServiceEnabled,
  isAnyOfficialPlServiceEnabled,
  getDefaultPlayableSourceTab,
  resolvePreferredPlayTab,
  getLiveSeriesUpdateForItem,
  resolveSeriesEpisodeInfo,
  isItemWatchedOrCaughtUp,
  formatRemainingTime,
  applyEnabledServicesVisibility,
  getFriendsAverageScore,
  patchCatalogItemKinoriumInPlace,
  getPrimaryRating,
} from "./catalog-media-resolver.js?v=20261112v1";

export {
  renderContinueWatching,
  parseItemDurationMinutes,
  renderCuratedShelves,
  renderCatalogShelves,
  buildPosterBadgesHtml,
  buildFallbackPosterSvg,
  attachSmartPosterFallback,
  closeCardContextMenu,
  openCardContextMenu,
  createPosterCardElement,
  buildPageNumbers,
  renderPosterCardsInto,
  cancelPendingCardBatch,
  appendPosterCardsProgressive,
  stopHeroAmbientTeaser,
  scheduleHeroAmbientTeaser,
  stopHeroAutoTimer,
  startHeroAutoTimer,
  stepHeroSlide,
  renderHeroSlide,
  renderHero,
  collectNewEpisodeNotifications,
  switchNotificationsTab,
  loadAndRenderReleaseCalendar,
  renderNotificationsBell,
  openMovieRouletteModal,
  closeMovieRouletteModal,
  initMovieRouletteModal,
  spinMovieRoulette,
  openCommandPalette,
  closeCommandPalette,
  initCommandPalette,
  updateActiveFiltersBadge,
  updateDynamicCatalogFilters,
  renderActiveFilterChips,
  filterCatalogItemsByGenreAndYear,
  _hashItemKey,
  seededShuffle,
  rerollCatalogLaunchSeed,
  getCurrentlyFilteredItems,
  sortCatalogItems,
  resetCatalogDrawerFiltersUI,
  initCatalogToolbarAndFilterBindings,
  isEpisodeWatched,
  normalizeStudioBrand,
  getItemStudioPreferenceKeys,
  matchPreferredStudioInList,
  getPreferredStudioForItem,
  savePreferredStudioForItem,
  findSavedProgress,
  isServiceEnabled,
  isAnyOfficialPlServiceEnabled,
  getDefaultPlayableSourceTab,
  resolvePreferredPlayTab,
  getLiveSeriesUpdateForItem,
  resolveSeriesEpisodeInfo,
  isItemWatchedOrCaughtUp,
  formatRemainingTime,
  applyEnabledServicesVisibility,
  getFriendsAverageScore,
  patchCatalogItemKinoriumInPlace,
  getPrimaryRating,
};

// Active filters badge, dynamic filter options and active chips
// (updateActiveFiltersBadge, updateDynamicCatalogFilters, renderActiveFilterChips)
// modularized into ./catalog-filters.js

// Media stream resolution, studio prefs and series episode progress
// (isEpisodeWatched, getPreferredStudioForItem, savePreferredStudioForItem,
//  findSavedProgress, isServiceEnabled, isAnyOfficialPlServiceEnabled,
//  getDefaultPlayableSourceTab, resolvePreferredPlayTab, getLiveSeriesUpdateForItem,
//  resolveSeriesEpisodeInfo, isItemWatchedOrCaughtUp, formatRemainingTime,
//  applyEnabledServicesVisibility, getFriendsAverageScore)
// modularized into ./catalog-media-resolver.js

// Filter by genre/year, seeded shuffle, launch seed, filtered items & sorting
// (filterCatalogItemsByGenreAndYear, _hashItemKey, seededShuffle,
//  rerollCatalogLaunchSeed, getCurrentlyFilteredItems, sortCatalogItems)
// modularized into ./catalog-filters.js

export function renderCatalogSkeletons(count = 12, forceShelves = false) {
  const simSec = document.getElementById("search-similar-section");
  if (simSec) simSec.classList.add("hidden");
  const buildSkeletonCards = (n) =>
    Array.from({ length: n })
      .map(
        () => `
        <div class="atv-skeleton-card">
          <div class="atv-skeleton-poster"></div>
          <div class="atv-skeleton-line"></div>
          <div class="atv-skeleton-line short"></div>
        </div>
      `
      )
      .join("");

  const gridCols = Math.max(6, getCatalogGridColumnCount());
  if (state.kinoriumSection !== "all") {
    const unifiedSec = document.getElementById("unified-kinorium-section");
    const unifiedGrid = document.getElementById("unified-kinorium-grid");
    if (unifiedSec && unifiedGrid) {
      unifiedSec.classList.remove("hidden");
      unifiedGrid.innerHTML = buildSkeletonCards(Math.max(count, gridCols * 2));
    }
  } else {
    const sGrid = document.getElementById("series-grid");
    const mGrid = document.getElementById("movies-grid");
    if (sGrid && (forceShelves || !state.catalogItems || state.catalogItems.length === 0)) {
      sGrid.innerHTML = buildSkeletonCards(gridCols);
    }
    if (mGrid && (forceShelves || !state.catalogItems || state.catalogItems.length === 0)) {
      mGrid.innerHTML = buildSkeletonCards(gridCols);
    }
  }
}
const _catalogEndpointCache = new Map();
const WARM_CATALOG_STORAGE_KEY = "velarium_warm_catalog_v1";

export function clearCatalogFrontendCache() {
  _catalogEndpointCache.clear();
  state.gridPages = {};
  state.liveSeriesUpdates = {};
  state.liveSeriesUpdatesVersion = (Number(state.liveSeriesUpdatesVersion) || 0) + 1;
  state.calendarData = null;
  state.calendarDataLang = "";
  try {
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(WARM_CATALOG_STORAGE_KEY)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch (err) { window.logDebug?.("Catalog", err); }
}

function _applyCatalogResponsePayload(data, q = "") {
  if (!data || typeof data !== "object") return;
  state.providersMeta = data.providers_meta || state.providersMeta;
  state.integrations = data.integrations || state.integrations;
  state.catalogItems = data.items || [];
  state.catalogIndexVersion = (Number(state.catalogIndexVersion) || 0) + 1;
  if (Array.isArray(data.kinorium_friends)) {
    state.kinoriumFriends = data.kinorium_friends;
  }
  if (Array.isArray(data.similar_pool)) {
    state.similarPool = data.similar_pool;
  }
  state.searchSimilarItems = q && Array.isArray(data.similar_items) ? data.similar_items : [];
  state.searchPersons = q && Array.isArray(data.persons) ? data.persons : [];
  if (data.kinorium_account) {
    state.kinoriumAccount = data.kinorium_account;
    updateKinoriumUserBadge();
    renderHeaderProfileSwitcher();
  }
  if (data.kinorium_counts) {
    state.kinoriumCounts = data.kinorium_counts;
    updateKinoriumSectionCounters();
  }
  if (data.continue_watching) {
    state.continueWatching = data.continue_watching;
  }
  if (Array.isArray(data.live_series_updates)) {
    data.live_series_updates.forEach((u) => {
      if (!u) return;
      if (u.id) state.liveSeriesUpdates[u.id] = u;
      if (u.kinorium_id) {
        state.liveSeriesUpdates[String(u.kinorium_id)] = u;
        state.liveSeriesUpdates[`kin_${u.kinorium_id}`] = u;
      }
      if (u.title) state.liveSeriesUpdates[u.title.trim().toLowerCase()] = u;
      if (u.orig_title) state.liveSeriesUpdates[u.orig_title.trim().toLowerCase()] = u;
    });
    state.liveSeriesUpdatesVersion = (Number(state.liveSeriesUpdatesVersion) || 0) + 1;
  }
  applyEnabledServicesVisibility();
  updateFriendsFilterDropdown();
  updateDynamicCatalogFilters();
  renderLoginBannerIfNeeded();
  renderContinueWatching();
  renderCatalogShelves({ skipHero: false });
}

export async function loadCatalog(options = {}) {
  if (state.catalogAbortController) {
    try {
      state.catalogAbortController.abort();
    } catch (err) { window.logDebug?.("Catalog", err); }
  }
  const abortController = new AbortController();
  state.catalogAbortController = abortController;
  state.catalogReqId = (state.catalogReqId || 0) + 1;
  const reqId = state.catalogReqId;
  const q = state.searchQuery.trim();
  const params = new URLSearchParams({
    provider: state.providerFilter,
    media_type: state.kinoriumSection !== "all" ? "all" : state.mediaTypeFilter,
    kinorium_section: state.kinoriumSection,
    lang: state.appLang || "ru",
  });
  if (q) params.set("q", q);

  if (state.mediaTypeFilter === "offline") {
    const offlineItems = getOfflineCatalogItems();
    const qNorm = q.toLowerCase();
    const filtered = qNorm
      ? offlineItems.filter(
          (it) =>
            (it.title && it.title.toLowerCase().includes(qNorm)) ||
            (it.orig_title && it.orig_title.toLowerCase().includes(qNorm))
        )
      : offlineItems;
    state.catalogItems = filtered;
    renderHero();
    renderContinueWatching();
    renderCatalogShelves({ skipHero: true });
    return;
  }

  const endpoint = q ? `/api/search?${params.toString()}` : `/api/catalog?${params.toString()}`;
  const activeProfId = state.activeProfileId || state.activeProfile?.id || "main";
  const cacheKey = `${activeProfId}::${endpoint}`;

  let warmHit = _catalogEndpointCache.get(cacheKey);
  if (
    !warmHit &&
    !q &&
    state.kinoriumSection === "all" &&
    state.providerFilter === "all" &&
    !state.activeProfile?.kids_mode
  ) {
    try {
      const rawWarm = sessionStorage.getItem(`${WARM_CATALOG_STORAGE_KEY}_${activeProfId}`);
      if (rawWarm) {
        const parsedWarm = JSON.parse(rawWarm);
        if (parsedWarm && Array.isArray(parsedWarm.items) && parsedWarm.items.length > 0) {
          warmHit = parsedWarm;
        }
      }
    } catch (err) { window.logDebug?.("Catalog", err); }
  }

  if (warmHit && (!state.catalogItems || state.catalogItems.length === 0 || !options?.showLoading)) {
    _applyCatalogResponsePayload(warmHit, q);
  } else if (options && options.showLoading) {
    renderCatalogSkeletons(12, true);
  }
  const skeletonTimer = setTimeout(() => {
    if (reqId === state.catalogReqId && !warmHit) {
      renderCatalogSkeletons(12, Boolean(q));
    }
  }, 85);

  try {
    const res = await fetch(endpoint, { signal: abortController.signal });
    const data = await res.json();
    clearTimeout(skeletonTimer);
    if (
      reqId !== state.catalogReqId ||
      (state.activeProfileId || state.activeProfile?.id || "main") !== activeProfId
    )
      return;
    if (!res.ok || data?.ok === false || data?.error || !Array.isArray(data?.items)) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    _catalogEndpointCache.set(cacheKey, data);
    if (_catalogEndpointCache.size > 24) {
      const oldestKey = _catalogEndpointCache.keys().next().value;
      if (oldestKey) _catalogEndpointCache.delete(oldestKey);
    }
    setOfflineMode(false);
    try {
      _applyCatalogResponsePayload(data, q);
    } catch (renderErr) {
      console.error("Catalog render error:", renderErr);
    }
    if (!q && state.kinoriumSection === "all" && state.providerFilter === "all") {
      const saveWarmCache = () => {
        try {
          sessionStorage.setItem(`${WARM_CATALOG_STORAGE_KEY}_${activeProfId}`, JSON.stringify(data));
        } catch (err) { window.logDebug?.("Catalog", err); }
      };
      if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(saveWarmCache, { timeout: 1000 });
      } else {
        setTimeout(saveWarmCache, 120);
      }
    }
    if (!state.liveUpdatesCheckedOnce && isServiceEnabled("hdrezka") && isServiceEnabled("kinorium")) {
      state.liveUpdatesCheckedOnce = true;
      setTimeout(() => checkLiveRezkaSeriesUpdates(false), 3200);
    }
  } catch (err) {
    clearTimeout(skeletonTimer);
    if (abortController.signal.aborted || reqId !== state.catalogReqId || (err && err.name === "AbortError")) return;
    console.error("Failed to load catalog:", err);
    if (!state.catalogItems || state.catalogItems.length === 0) {
      let backendAlive = false;
      try {
        const probe = await fetch("/api/system/status", { cache: "no-store" });
        backendAlive = Boolean(probe && probe.ok);
      } catch (_) {}
      const offlineItems = getOfflineCatalogItems();
      if (!backendAlive || offlineItems.length > 0) {
        setOfflineMode(!backendAlive);
      }
      if (offlineItems.length > 0) {
        state.catalogItems = offlineItems;
      }
      renderHero();
      renderContinueWatching();
      renderCatalogShelves({ skipHero: true });
    }
  }
}
let _liveSeriesRetryTimer = null;

export async function checkLiveRezkaSeriesUpdates(showFeedback = false, forceRefresh = false) {
  if (!isServiceEnabled("hdrezka") || !isServiceEnabled("kinorium")) return;
  if (_liveSeriesRetryTimer) {
    clearTimeout(_liveSeriesRetryTimer);
    _liveSeriesRetryTimer = null;
  }
  if (!showFeedback && !forceRefresh && state.isPlayerOpen) {
    _liveSeriesRetryTimer = setTimeout(() => {
      _liveSeriesRetryTimer = null;
      checkLiveRezkaSeriesUpdates(false, false);
    }, 15000);
    return;
  }
  const btn = document.getElementById("btn-check-rezka-updates");
  if (btn && showFeedback) {
    btn.innerHTML = `${iconSvg("refresh", 12)}<span>${t("Проверка...", "Checking...")}</span>`;
    btn.disabled = true;
  }
  try {
    const reqProfileId = state.activeProfileId || state.activeProfile?.id || "main";
    const url = forceRefresh
      ? "/api/hdrezka/check-watching-updates?force=1"
      : "/api/hdrezka/check-watching-updates";
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || data?.ok === false || data?.error) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    if ((state.activeProfileId || state.activeProfile?.id || "main") !== reqProfileId) return;
    const updates = data.updates || [];
    let hasChanges = false;
    updates.forEach((u) => {
      const prev =
        (u.id && state.liveSeriesUpdates[u.id]) ||
        (u.kinorium_id && state.liveSeriesUpdates[String(u.kinorium_id)]) ||
        (u.title && state.liveSeriesUpdates[u.title.trim().toLowerCase()]) ||
        null;
      if (
        !prev ||
        prev.latest_season !== u.latest_season ||
        prev.latest_episode !== u.latest_episode ||
        prev.studios_summary !== u.studios_summary
      ) {
        hasChanges = true;
      }
      if (u.id) state.liveSeriesUpdates[u.id] = u;
      if (u.kinorium_id) {
        state.liveSeriesUpdates[String(u.kinorium_id)] = u;
        state.liveSeriesUpdates[`kin_${u.kinorium_id}`] = u;
      }
      if (u.title) state.liveSeriesUpdates[u.title.trim().toLowerCase()] = u;
      if (u.orig_title) state.liveSeriesUpdates[u.orig_title.trim().toLowerCase()] = u;
    });
    if (Array.isArray(data.updates) && data.updates.length > 0) {
      state.liveSeriesUpdatesVersion = (Number(state.liveSeriesUpdatesVersion) || 0) + 1;
    }
    if (data.kinorium_counts) {
      state.kinoriumCounts = { ...state.kinoriumCounts, ...data.kinorium_counts };
      updateKinoriumSectionCounters();
    }

    if (hasChanges || showFeedback) {
      if (!showFeedback && state.isPlayerOpen) {
        state.catalogDirty = true;
      } else {
        renderContinueWatching();
        renderCatalogShelves({ skipHero: Boolean(showFeedback) });
        if (showFeedback) {
          renderHero();
        }
      }
    }

    if (showFeedback) {
      showToast(
        updates.length > 0
          ? t(
              `HDRezka: актуальные серии и озвучки обновлены (${updates.length})`,
              `HDRezka: updated episodes & audio tracks (${updates.length})`
            )
          : t("HDRezka: статус серий проверен", "HDRezka: episode status verified")
      );
    }

    if (showFeedback && Number(data.remaining_unchecked || 0) > 0) {
      if (_liveSeriesRetryTimer) clearTimeout(_liveSeriesRetryTimer);
      _liveSeriesRetryTimer = setTimeout(() => {
        _liveSeriesRetryTimer = null;
        checkLiveRezkaSeriesUpdates(false, false);
      }, 6000);
    }
  } catch (err) {
    if (showFeedback) {
      showToast(t("Не удалось проверить обновления серий на HDRezka", "Failed to check HDRezka episode updates"));
    }
  } finally {
    if (btn) {
      btn.innerHTML = `${iconSvg("refresh", 12)}<span>HDRezka</span>`;
      btn.disabled = false;
    }
  }
}
export async function pollLiveKinoriumDigest() {
  if (document.hidden || state.isPlayerOpen || !isServiceEnabled("kinorium")) return;
  try {
    const reqProfileId = state.activeProfileId || state.activeProfile?.id || "main";
    const res = await fetch("/api/kinorium/live-digest");
    if (!res.ok) return;
    const data = await res.json();
    if ((state.activeProfileId || state.activeProfile?.id || "main") !== reqProfileId) return;
    let changed = false;
    (data.updates || []).forEach((u) => {
      const prev = u.id ? state.liveSeriesUpdates[u.id] : null;
      if (
        !prev ||
        prev.latest_season !== u.latest_season ||
        prev.latest_episode !== u.latest_episode
      ) {
        changed = true;
      }
      if (u.id) state.liveSeriesUpdates[u.id] = u;
      if (u.kinorium_id) {
        state.liveSeriesUpdates[String(u.kinorium_id)] = u;
        state.liveSeriesUpdates[`kin_${u.kinorium_id}`] = u;
      }
      if (u.title) state.liveSeriesUpdates[u.title.trim().toLowerCase()] = u;
      if (u.orig_title) state.liveSeriesUpdates[u.orig_title.trim().toLowerCase()] = u;
    });
    if (Array.isArray(data.updates) && data.updates.length > 0) {
      state.liveSeriesUpdatesVersion = (Number(state.liveSeriesUpdatesVersion) || 0) + 1;
    }
    if (data.kinorium_counts) {
      state.kinoriumCounts = { ...state.kinoriumCounts, ...data.kinorium_counts };
      updateKinoriumSectionCounters();
    }
    if (changed) {
      state.liveSeriesUpdatesVersion = (Number(state.liveSeriesUpdatesVersion) || 0) + 1;
      renderNotificationsBell();
      if (!state.isPlayerOpen) {
        renderContinueWatching();
        renderCatalogShelves();
      }
    }
  } catch (err) { window.logDebug?.("Catalog", err); }
}
export function startBackgroundDigestPolling() {
  if (state.bgDigestTimerId) {
    clearInterval(state.bgDigestTimerId);
  }
  state.bgDigestTimerId = setInterval(() => {
    pollLiveKinoriumDigest();
  }, 180000);
}
export function updateFriendsFilterDropdown() {
  const sel = document.getElementById("select-friend-filter");
  if (!sel) return;
  const namesSet = new Set();
  (state.kinoriumFriends || []).forEach((f) => {
    if (f?.name) namesSet.add(f.name);
  });
  (state.catalogItems || []).forEach((it) => {
    (it.kinorium?.friends_ratings || []).forEach((fr) => {
      if (fr?.name) namesSet.add(fr.name);
    });
  });
  const sortedNames = Array.from(namesSet).sort((a, b) => a.localeCompare(b, isEn() ? "en" : "ru"));
  let curVal = state.selectedFriend || "all";
  if (curVal !== "all" && !namesSet.has(curVal)) {
    state.selectedFriend = "all";
    curVal = "all";
  }
  const friendsSig = `${state.appLang || "ru"}|${curVal}|${sortedNames.join(",")}`;
  if (sel._optionsSig === friendsSig) {
    return;
  }
  sel._optionsSig = friendsSig;
  sel.innerHTML = `<option value="all">${t("Все друзья", "All friends")}</option>`;
  const frag = document.createDocumentFragment();
  sortedNames.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === curVal) opt.selected = true;
    frag.appendChild(opt);
  });
  sel.appendChild(frag);
  sel.value = curVal;
}
export function updateKinoriumUserBadge() {
  const acc = state.kinoriumAccount || {};
  const statsBadge = document.getElementById("stats-profile-badge");
  if (statsBadge) {
    if (acc.connected && acc.user_id) {
      const displayName = acc.display_name || "Kinorium";
      statsBadge.textContent = displayName.includes(acc.user_id)
        ? displayName
        : `${displayName} · ID ${acc.user_id}`;
    } else {
      statsBadge.textContent = t("Профиль не подключён", "Not connected");
    }
  }
}
export function updateKinoriumSectionCounters() {
  const c = state.kinoriumCounts || {};
  const pairs = [
    ["kcount-premieres", Number(c.premieres) || 0],
    ["kcount-watching", Number(c.watching) || 0],
    ["kcount-watchlist", Number(c.watchlist) || 0],
    ["kcount-watched", Number(c.watched) || 0],
    ["kcount-never", Number(c.never) || 0],
  ];
  pairs.forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(val);
    el.classList.toggle("hidden", val <= 0);
  });
}
// Show prompt when user selects a paid streaming service where they are not logged in yet
// (HDRezka and 4K Remux work without login)
export function renderLoginBannerIfNeeded() {
  const banner = document.getElementById("service-login-banner");
  const prov = state.providerFilter;

  if (
    prov === "all" ||
    prov === "hdrezka" ||
    prov === "stremio" ||
    prov === "backup4k" ||
    !isServiceEnabled(prov)
  ) {
    banner.classList.add("hidden");
    return;
  }

  const integ = state.integrations[prov];
  if (!integ || integ.logged_in || !integ.requires_login) {
    banner.classList.add("hidden");
    return;
  }

  const isPending = Boolean(state.pendingServiceLogins?.[prov]);
  banner.classList.remove("hidden");
  document.getElementById("login-banner-title").textContent = isPending
    ? t(
        `Завершите вход в аккаунт ${integ.name} в открытой вкладке`,
        `Complete ${integ.name} sign-in in the opened browser tab`
      )
    : t(
        `Вы ещё не вошли в аккаунт ${integ.name}`,
        `You are not signed in to ${integ.name}`
      );
  document.getElementById("login-banner-sub").textContent = isPending
    ? t(
        `После авторизации на сайте ${integ.name} нажмите «Подтвердить вход» — или смотрите бесплатно через HDRezka.`,
        `After signing in to ${integ.name}, click "Confirm sign-in" — or watch directly via HDRezka / Stremio.`
      )
    : t(
        `Авторизуйтесь в ${integ.name}, чтобы смотреть по подписке — или открывайте любой фильм и смотрите бесплатно без регистрации через HDRezka.`,
        `Sign in to ${integ.name} for subscription playback — or open any title to watch directly via HDRezka / Stremio.`
      );

  const loginBtn = document.getElementById("banner-login-btn");
  const confirmBtn = document.getElementById("banner-confirm-login-btn");
  if (loginBtn) {
    loginBtn.textContent = isPending ? t("Открыть окно снова", "Open Window Again") : t("Войти в аккаунт", "Sign in");
    loginBtn.className = isPending ? "atv-btn-secondary atv-btn-sm" : "atv-btn-primary atv-btn-sm";
    loginBtn.onclick = () => {
      triggerServiceLoginFlow(prov);
    };
  }
  if (confirmBtn) {
    confirmBtn.classList.toggle("hidden", !isPending);
    confirmBtn.onclick = () => {
      confirmServiceLogin(prov);
    };
  }
  document.getElementById("banner-open-integrations-btn").onclick = () => {
    openSettingsModal("integrations");
  };
}
export function isAnyOverlayModalOpen() {
  if (state.isPlayerOpen && !state.isMiniPlayer && !state.isPipBackground) return true;
  const ids = [
    "kids-pin-modal",
    "confirm-modal",
    "command-palette-modal",
    "movie-roulette-modal",
    "onboarding-modal",
    "profiles-modal",
    "handoff-modal",
    "vocab-modal",
    "bookmarks-modal",
    "tv-cast-modal",
    "downloads-modal",
    "person-modal",
    "quick-peek-modal",
    "stats-modal",
    "settings-modal",
  ];
  return ids.some((id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains("hidden");
  });
}

// Hero banner, teaser and auto-carousel
// (stopHeroAmbientTeaser, scheduleHeroAmbientTeaser, stopHeroAutoTimer,
//  startHeroAutoTimer, stepHeroSlide, renderHeroSlide, renderHero)
// modularized into ./catalog-hero.js

// Notifications and release calendar
// (collectNewEpisodeNotifications, switchNotificationsTab,
//  loadAndRenderReleaseCalendar, renderNotificationsBell)
// modularized into ./catalog-notifications.js

// Shelves and carousels (renderContinueWatching, parseItemDurationMinutes, renderCuratedShelves, renderCatalogShelves)
// modularized into ./catalog-shelves.js

// Catalog cards, context menu, and pagination
// (buildPosterBadgesHtml, buildFallbackPosterSvg, attachSmartPosterFallback,
//  closeCardContextMenu, openCardContextMenu, createPosterCardElement,
//  buildPageNumbers, renderPosterCardsInto)
// modularized into ./catalog-cards.js

// In-place Kinorium status patch & primary rating extraction
// (patchCatalogItemKinoriumInPlace, getPrimaryRating)
// modularized into ./catalog-media-resolver.js

// Movie roulette and command palette discovery
// (openMovieRouletteModal, closeMovieRouletteModal, initMovieRouletteModal,
//  spinMovieRoulette, openCommandPalette, closeCommandPalette, initCommandPalette)
// modularized into ./catalog-discovery.js
