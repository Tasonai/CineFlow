import {
  NOTIF_DESKTOP_ALERTED_STORAGE_KEY,
  PREFERRED_STUDIOS_STORAGE_KEY,
  profileStorageKey,
  state,
} from "./state.js?v=20261104v22";
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
} from "./i18n.js?v=20261104v22";
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
} from "./utils.js?v=20261104v22";
import { getPlayerPrefs } from "./audio-dsp.js?v=20261104v22";
import {
  buildPersonPhotoCard,
  maybePausePlayerForOverlay,
  maybeResumePlayerAfterOverlay,
  openPersonModal,
  openQuickPeekModal,
} from "./modals.js?v=20261104v22";
import { openPlayerModal, renderModalProvidersSidebar, switchSourceTab } from "./player.js?v=20261104v22";
import { confirmServiceLogin, openSettingsModal, triggerServiceLoginFlow } from "./settings.js?v=20261104v22";
import { openTvCastModal, renderHeaderProfileSwitcher } from "./features.js?v=20261104v22";
import {
  renderContinueWatching,
  parseItemDurationMinutes,
  renderCuratedShelves,
  renderCatalogShelves,
} from "./catalog-shelves.js?v=20261104v22";
import {
  buildPosterBadgesHtml,
  buildFallbackPosterSvg,
  attachSmartPosterFallback,
  closeCardContextMenu,
  openCardContextMenu,
  createPosterCardElement,
  buildPageNumbers,
  renderPosterCardsInto,
} from "./catalog-cards.js?v=20261104v22";
import {
  stopHeroAmbientTeaser,
  scheduleHeroAmbientTeaser,
  stopHeroAutoTimer,
  startHeroAutoTimer,
  stepHeroSlide,
  renderHeroSlide,
  renderHero,
  resetHeroRecordedThisLaunch,
} from "./catalog-hero.js?v=20261104v22";
import {
  collectNewEpisodeNotifications,
  switchNotificationsTab,
  loadAndRenderReleaseCalendar,
  renderNotificationsBell,
} from "./catalog-notifications.js?v=20261104v22";
import {
  openMovieRouletteModal,
  closeMovieRouletteModal,
  initMovieRouletteModal,
  spinMovieRoulette,
  openCommandPalette,
  closeCommandPalette,
  initCommandPalette,
} from "./catalog-discovery.js?v=20261104v22";
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
} from "./catalog-filters.js?v=20261104v22";
import {
  isEpisodeWatched,
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
} from "./catalog-media-resolver.js?v=20261104v22";

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
  isEpisodeWatched,
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

  if (state.kinoriumSection !== "all") {
    const unifiedSec = document.getElementById("unified-kinorium-section");
    const unifiedGrid = document.getElementById("unified-kinorium-grid");
    if (unifiedSec && unifiedGrid) {
      unifiedSec.classList.remove("hidden");
      unifiedGrid.innerHTML = buildSkeletonCards(count);
    }
  } else {
    const sGrid = document.getElementById("series-grid");
    const mGrid = document.getElementById("movies-grid");
    if (sGrid && (forceShelves || !state.catalogItems || state.catalogItems.length === 0)) {
      sGrid.innerHTML = buildSkeletonCards(6);
    }
    if (mGrid && (forceShelves || !state.catalogItems || state.catalogItems.length === 0)) {
      mGrid.innerHTML = buildSkeletonCards(6);
    }
  }
}
const _catalogEndpointCache = new Map();
const WARM_CATALOG_STORAGE_KEY = "cineflow_warm_catalog_v1";

export function clearCatalogFrontendCache() {
  _catalogEndpointCache.clear();
  try {
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(WARM_CATALOG_STORAGE_KEY)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch (_) {}
}

function _applyCatalogResponsePayload(data, q = "") {
  if (!data || typeof data !== "object") return;
  state.providersMeta = data.providers_meta || state.providersMeta;
  state.integrations = data.integrations || state.integrations;
  state.catalogItems = data.items || [];
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
  }
  applyEnabledServicesVisibility();
  updateFriendsFilterDropdown();
  updateDynamicCatalogFilters();
  renderLoginBannerIfNeeded();
  renderHero();
  renderContinueWatching();
  renderCatalogShelves();
}

export async function loadCatalog(options = {}) {
  if (state.catalogAbortController) {
    try {
      state.catalogAbortController.abort();
    } catch (_) {}
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

  const endpoint = q ? `/api/search?${params.toString()}` : `/api/catalog?${params.toString()}`;
  const activeProfId = state.activeProfile?.id || "main";
  const cacheKey = `${activeProfId}::${endpoint}`;

  let warmHit = _catalogEndpointCache.get(cacheKey);
  if (!warmHit && !q && state.kinoriumSection === "all" && state.providerFilter === "all") {
    try {
      const rawWarm = sessionStorage.getItem(`${WARM_CATALOG_STORAGE_KEY}_${activeProfId}`);
      if (rawWarm) {
        const parsedWarm = JSON.parse(rawWarm);
        if (parsedWarm && Array.isArray(parsedWarm.items) && parsedWarm.items.length > 0) {
          warmHit = parsedWarm;
        }
      }
    } catch (_) {}
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
    if (reqId !== state.catalogReqId || (state.activeProfile?.id || "main") !== activeProfId) return;
    if (!res.ok || data?.ok === false || data?.error || !Array.isArray(data?.items)) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    _catalogEndpointCache.set(cacheKey, data);
    if (_catalogEndpointCache.size > 24) {
      const oldestKey = _catalogEndpointCache.keys().next().value;
      if (oldestKey) _catalogEndpointCache.delete(oldestKey);
    }
    if (!q && state.kinoriumSection === "all" && state.providerFilter === "all") {
      try {
        sessionStorage.setItem(`${WARM_CATALOG_STORAGE_KEY}_${activeProfId}`, JSON.stringify(data));
      } catch (_) {}
    }
    _applyCatalogResponsePayload(data, q);
    if (!state.liveUpdatesCheckedOnce && isServiceEnabled("hdrezka") && isServiceEnabled("kinorium")) {
      state.liveUpdatesCheckedOnce = true;
      setTimeout(() => checkLiveRezkaSeriesUpdates(false), 3200);
    }
  } catch (err) {
    clearTimeout(skeletonTimer);
    if (err && err.name === "AbortError") return;
    console.error("Failed to load catalog:", err);
  }
}
export async function checkLiveRezkaSeriesUpdates(showFeedback = false, forceRefresh = false) {
  if (!isServiceEnabled("hdrezka") || !isServiceEnabled("kinorium")) return;
  if (!showFeedback && !forceRefresh && state.isPlayerOpen) {
    setTimeout(() => checkLiveRezkaSeriesUpdates(false, false), 15000);
    return;
  }
  const btn = document.getElementById("btn-check-rezka-updates");
  if (btn && showFeedback) {
    btn.innerHTML = `${iconSvg("refresh", 12)}<span>${t("Проверка...", "Checking...")}</span>`;
    btn.disabled = true;
  }
  try {
    const reqProfileId = state.activeProfile?.id || "main";
    const url = forceRefresh
      ? "/api/hdrezka/check-watching-updates?force=1"
      : "/api/hdrezka/check-watching-updates";
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || data?.ok === false || data?.error) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    if ((state.activeProfile?.id || "main") !== reqProfileId) return;
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
    if (data.kinorium_counts) {
      state.kinoriumCounts = { ...state.kinoriumCounts, ...data.kinorium_counts };
      updateKinoriumSectionCounters();
    }

    if (hasChanges || showFeedback) {
      if (!showFeedback && state.isPlayerOpen) {
        state.catalogDirty = true;
      } else {
        renderContinueWatching();
        renderCatalogShelves();
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
      setTimeout(() => checkLiveRezkaSeriesUpdates(false, false), 6000);
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
    const reqProfileId = state.activeProfile?.id || "main";
    const res = await fetch("/api/kinorium/live-digest");
    if (!res.ok) return;
    const data = await res.json();
    if ((state.activeProfile?.id || "main") !== reqProfileId) return;
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
    if (data.kinorium_counts) {
      state.kinoriumCounts = { ...state.kinoriumCounts, ...data.kinorium_counts };
      updateKinoriumSectionCounters();
    }
    if (changed) {
      renderNotificationsBell();
      if (!state.isPlayerOpen) {
        renderContinueWatching();
        renderCatalogShelves();
      }
    }
  } catch (_) {}
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
  const curVal = state.selectedFriend || "all";
  sel.innerHTML = `<option value="all">${t("Друг: Все друзья", "Friend: All friends")}</option>`;
  sortedNames.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === curVal) opt.selected = true;
    sel.appendChild(opt);
  });
  if (curVal !== "all" && !namesSet.has(curVal)) {
    state.selectedFriend = "all";
    sel.value = "all";
  }
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
      statsBadge.textContent = t("Профиль не подключен", "Not connected");
    }
  }
}
export function updateKinoriumSectionCounters() {
  const c = state.kinoriumCounts || {};
  const elPremieres = document.getElementById("kcount-premieres");
  const elWatching = document.getElementById("kcount-watching");
  const elWatchlist = document.getElementById("kcount-watchlist");
  const elWatched = document.getElementById("kcount-watched");
  const elNever = document.getElementById("kcount-never");
  if (elPremieres) elPremieres.textContent = String(c.premieres || 0);
  if (elWatching) elWatching.textContent = String(c.watching || 0);
  if (elWatchlist) elWatchlist.textContent = String(c.watchlist || 0);
  if (elWatched) elWatched.textContent = String(c.watched || 0);
  if (elNever) elNever.textContent = String(c.never || 0);
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
        `Вы еще не вошли в аккаунт ${integ.name}`,
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
