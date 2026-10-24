import { EP_VIEW_MODE_STORAGE_KEY, UI_PREFS_STORAGE_KEY, state } from "./js/state.js?v=20261024v4";
import {
  applyStaticDomTranslations,
  displayPoster,
  displayTitle,
  isEn,
  secondaryTitle,
  syncLanguageSegmentedControlUI,
  t,
} from "./js/i18n.js?v=20261024v4";
import {
  attachHorizontalWheelScroll,
  closeConfirmModal,
  escapeAttr,
  escapeHtml,
  formatTime,
  getEpisodeProgress,
  getSeenNotificationsSet,
  getUiPrefs,
  iconSvg,
  saveSeenNotificationsSet,
  saveUiPrefs,
  showConfirmModal,
  showToast,
  showVideoOsd,
  supportsNativePiP,
  syncScrollTopButton,
  trapModalTabKey,
  triggerVideoCenterIndicator,
  withKinoriumActionLock,
} from "./js/utils.js?v=20261024v4";
import {
  applyAudioBoostToVideo,
  applySubtitleStylePrefs,
  applyVideoCropToVideo,
  ensureUnlockedAudioContext,
  getAudioPresetLabel,
  getPlayerPrefs,
  getVideoCropLabel,
  isVideoInPiP,
  savePlayerPrefs,
  startAmbilightLoop,
  stopAmbilightLoop,
  togglePictureInPicture,
  updatePlayerGearActiveDot,
} from "./js/audio-dsp.js?v=20261024v4";
import {
  applyEnabledServicesVisibility,
  attachSmartPosterFallback,
  checkLiveRezkaSeriesUpdates,
  collectNewEpisodeNotifications,
  getCurrentlyFilteredItems,
  getDefaultPlayableSourceTab,
  isServiceEnabled,
  loadCatalog,
  patchCatalogItemKinoriumInPlace,
  renderCatalogShelves,
  renderContinueWatching,
  renderLoginBannerIfNeeded,
  renderNotificationsBell,
  resolveSeriesEpisodeInfo,
  savePreferredStudioForItem,
  startBackgroundDigestPolling,
  startHeroAutoTimer,
  stepHeroSlide,
  updateActiveFiltersBadge,
  updateKinoriumSectionCounters,
  updateKinoriumUserBadge,
} from "./js/catalog.js?v=20261024v4";
import {
  closePersonModal,
  closeQuickPeekModal,
  goBackInModalStack,
  openQuickPeekModal,
  openStatsModal,
  refreshOpenPersonModalUI,
  switchStatsModalTab,
  syncQuickPeekStatusesUI,
} from "./js/modals.js?v=20261024v4";
import {
  activateSelectedSubtitleTrack,
  captureVideoScreenshot,
  clearAutoplayNextTimer,
  closeAllVcPopovers,
  closePlayerModal,
  getEffectivePlaybackTiming,
  getEpisodeDisplayMeta,
  hasOpenVcPopover,
  hideVideoStreamError,
  isStageFullscreen,
  loadBackup4KReleases,
  loadHDRezkaStream,
  loadSkipIntroSegments,
  loadStremioStreams,
  markEpisodesBatch,
  openPlayerModal,
  openPostWatchRatingOverlay,
  playVideoUrl,
  populateSeasonEpisodeSelectors,
  renderPostWatchRatingState,
  renderStremioStreamsList,
  renderTrailerEmbed,
  resolveEffectiveSeasonsMap,
  resolveSeriesCompletedFlag,
  restoreFullPlayerFromPip,
  seekEffectivePlayback,
  setMiniPlayerMode,
  setPipBackgroundMode,
  setSleepTimer,
  setupVideoListeners,
  stepEpisode,
  switchRemuxAudioTrack,
  switchSourceTab,
  syncCustomControlPopovers,
  syncCustomVideoControlsUI,
  syncEpisodesStripDrawerUI,
  syncPipDockUI,
  syncVcPopoverOpenClass,
  toggleCurrentEpisodeWatched,
  toggleQuickOriginalAudio,
  toggleStageFullscreen,
  toggleVideoPlayPause,
  updateCurrentEpisodeBar,
  updateMiniPlayerTitle,
  updateModalKinoriumHeader,
  wakeVideoControls,
} from "./js/player.js?v=20261024v4";
import {
  addStremioAddonFromInput,
  applyAppLanguage,
  buildFullBackupPayload,
  getNetworkSettingsSnapshot,
  isKinoriumQuickFormDirty,
  isNetworkSettingsDirty,
  openSettingsModal,
  restoreFromBackupObject,
  switchSettingsTab,
  syncSettingsFooterUI,
  toggleLanAccess,
  toggleMacosAutostart,
} from "./js/settings.js?v=20261024v4";

function initCineFlowApp() {
  const initPrefs = getPlayerPrefs();
  const initUi = getUiPrefs();
  let hadLocalLangPref = false;
  try {
    const rawSavedUi = localStorage.getItem(UI_PREFS_STORAGE_KEY);
    const parsedSavedUi = rawSavedUi ? JSON.parse(rawSavedUi) : null;
    hadLocalLangPref = Boolean(parsedSavedUi && (parsedSavedUi.appLang === "en" || parsedSavedUi.appLang === "ru"));
  } catch (_) {}
  state.autoNextEpisode = initPrefs.autoNextEpisode;
  state.audioBoost = initPrefs.audioBoost;
  state.audioPreset = initPrefs.audioPreset || "flat";
  state.videoCrop = initPrefs.videoCrop || "contain";
  state.subSize = initPrefs.subSize || "medium";
  state.subBg = initPrefs.subBg || "semi";
  state.ambilightEnabled = initPrefs.ambilightEnabled !== false;
  state.autoSkipAds = initPrefs.autoSkipAds !== false;
  state.autoSkipIntro = initPrefs.autoSkipIntro !== false;
  state.hideWatched = Boolean(initUi.hideWatched);
  applyStaticDomTranslations();
  syncLanguageSegmentedControlUI();
  document.querySelectorAll(".atv-lang-seg-btn[data-app-lang]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextLang = btn.dataset.appLang || "ru";
      if (nextLang !== state.appLang) {
        applyAppLanguage(nextLang, { persistServer: true, announce: true });
      } else {
        syncLanguageSegmentedControlUI();
      }
    });
  });
  fetch("/api/settings")
    .then((r) => r.json())
    .then((cfg) => {
      const srvLang = cfg?.app_lang === "en" ? "en" : "ru";
      if (!hadLocalLangPref && srvLang !== state.appLang) {
        applyAppLanguage(srvLang, { persistServer: false, announce: false });
      } else if (hadLocalLangPref && srvLang !== state.appLang) {
        fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ app_lang: state.appLang }),
        }).catch(() => {});
      }
    })
    .catch(() => {});
  const boostSelInit = document.getElementById("select-audio-boost");
  if (boostSelInit) boostSelInit.value = String(state.audioBoost);
  document.getElementById("audio-boost-group")?.classList.toggle("boost-active", state.audioBoost > 1.01);
  const eqSelInit = document.getElementById("select-audio-eq");
  if (eqSelInit) eqSelInit.value = state.audioPreset;
  document.getElementById("audio-eq-group")?.classList.toggle("eq-active", state.audioPreset !== "flat");
  const cropSelInit = document.getElementById("select-video-crop");
  if (cropSelInit) cropSelInit.value = state.videoCrop;
  document.getElementById("video-crop-group")?.classList.toggle("crop-active", state.videoCrop !== "contain");
  const ambiToggleInit = document.getElementById("ambilight-toggle");
  if (ambiToggleInit) ambiToggleInit.checked = Boolean(state.ambilightEnabled);
  const autoAdsInit = document.getElementById("auto-skip-ads-toggle");
  if (autoAdsInit) {
    autoAdsInit.checked = Boolean(state.autoSkipAds);
    autoAdsInit.onchange = (e) => {
      state.autoSkipAds = Boolean(e.target.checked);
      savePlayerPrefs({ autoSkipAds: state.autoSkipAds });
      showToast(
        state.autoSkipAds
          ? t("Автопропуск вшитой рекламы включен", "Embedded ad auto-skip enabled")
          : t("Автопропуск вшитой рекламы выключен", "Embedded ad auto-skip disabled")
      );
    };
  }
  applySubtitleStylePrefs(state.subSize, state.subBg);
  document.getElementById("btn-hide-watched")?.classList.toggle("active", state.hideWatched);
  updateActiveFiltersBadge();
  updatePlayerGearActiveDot();
  loadCatalog();
  setupVideoListeners();
  startBackgroundDigestPolling();
  document.getElementById("vc-btn-pip")?.classList.toggle("hidden", !supportsNativePiP());
  [
    "provider-filter-bar",
    "kinorium-sections-bar",
    "settings-tabs",
    "continue-watching-grid",
    "qp-cast-row",
    "meta-cast-list",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) attachHorizontalWheelScroll(el);
  });

  // Hero Carousel hover pause & prev/next controls
  const heroBannerEl = document.getElementById("hero-banner");
  if (heroBannerEl) {
    heroBannerEl.addEventListener("mouseenter", () => {
      state.heroHovered = true;
    });
    heroBannerEl.addEventListener("mouseleave", () => {
      state.heroHovered = false;
    });
  }
  const heroPrevBtn = document.getElementById("hero-prev-btn");
  if (heroPrevBtn) {
    heroPrevBtn.onclick = (e) => {
      e.stopPropagation();
      stepHeroSlide(-1, true);
      startHeroAutoTimer();
    };
  }
  const heroNextBtn = document.getElementById("hero-next-btn");
  if (heroNextBtn) {
    heroNextBtn.onclick = (e) => {
      e.stopPropagation();
      stepHeroSlide(1, true);
      startHeroAutoTimer();
    };
  }

  const notifBellBtn = document.getElementById("notifications-bell-btn");
  const notifPopover = document.getElementById("notifications-popover");
  const markNotifsReadBtn = document.getElementById("btn-mark-notifs-read");
  const checkRezkaUpdatesBtn = document.getElementById("btn-check-rezka-updates");
  if (notifBellBtn && notifPopover) {
    notifBellBtn.onclick = (e) => {
      e.stopPropagation();
      renderNotificationsBell();
      notifPopover.classList.toggle("hidden");
    };
  }
  if (checkRezkaUpdatesBtn) {
    checkRezkaUpdatesBtn.onclick = async (e) => {
      e.stopPropagation();
      checkRezkaUpdatesBtn.disabled = true;
      checkRezkaUpdatesBtn.innerHTML = `${iconSvg("refresh", 12)}<span>${t("Проверка...", "Checking...")}</span>`;
      await checkLiveRezkaSeriesUpdates(true, true);
      checkRezkaUpdatesBtn.disabled = false;
      checkRezkaUpdatesBtn.innerHTML = `${iconSvg("refresh", 12)}<span>HDRezka</span>`;
    };
  }
  if (markNotifsReadBtn) {
    markNotifsReadBtn.onclick = (e) => {
      e.stopPropagation();
      const notifs = collectNewEpisodeNotifications();
      const seenSet = getSeenNotificationsSet();
      notifs.forEach((n) => seenSet.add(n.notifKey));
      saveSeenNotificationsSet(seenSet);
      renderNotificationsBell();
      showToast(
        t(
          "Все уведомления о новых сериях отмечены прочитанными",
          "All new episode notifications marked as read"
        )
      );
    };
  }
  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("notifications-wrap");
    if (notifPopover && !notifPopover.classList.contains("hidden") && wrap && !wrap.contains(e.target)) {
      notifPopover.classList.add("hidden");
    }
    const gearWrap = document.getElementById("player-gear-wrap");
    const gearPopover = document.getElementById("player-gear-popover");
    if (
      gearPopover &&
      !gearPopover.classList.contains("hidden") &&
      !gearPopover.contains(e.target) &&
      !(gearWrap && gearWrap.contains(e.target))
    ) {
      gearPopover.classList.add("hidden");
      document.getElementById("btn-player-gear")?.classList.remove("active");
      syncVcPopoverOpenClass();
    }
    const statusWrap = document.getElementById("kinorium-status-dropdown-wrap");
    const statusPopover = document.getElementById("kinorium-status-popover");
    if (statusPopover && !statusPopover.classList.contains("hidden") && statusWrap && !statusWrap.contains(e.target)) {
      statusPopover.classList.add("hidden");
    }
    const rateWrap = document.getElementById("kinorium-rate-dropdown-wrap");
    const epRateWrap = document.getElementById("ep-rate-dropdown-wrap");
    const postwatchPop = document.getElementById("kinorium-postwatch-overlay");
    const rateEpBtn = document.getElementById("btn-rate-current-ep");
    if (
      postwatchPop &&
      !postwatchPop.classList.contains("hidden") &&
      (postwatchPop.classList.contains("is-header-popover") ||
        postwatchPop.classList.contains("is-epbar-popover")) &&
      !(rateWrap && rateWrap.contains(e.target)) &&
      !(epRateWrap && epRateWrap.contains(e.target)) &&
      !(rateEpBtn && rateEpBtn.contains(e.target))
    ) {
      state.postwatchManual = false;
      state.postwatchHovered = false;
      postwatchPop.classList.add("hidden");
    }
    const searchWrap = document.getElementById("global-search-wrap");
    const searchPop = document.getElementById("search-live-popover");
    if (searchPop && !searchPop.classList.contains("hidden") && searchWrap && !searchWrap.contains(e.target)) {
      searchPop.classList.add("hidden");
    }
    if (
      hasOpenVcPopover() &&
      !e.target.closest(".atv-vc-pop-wrap") &&
      !e.target.closest("#hdr-studio-wrap") &&
      !(gearPopover && gearPopover.contains(e.target))
    ) {
      closeAllVcPopovers();
    }
  });

  const searchInput = document.getElementById("global-search");
  const clearSearchBtn = document.getElementById("btn-clear-search");
  const searchKbdHint = document.getElementById("search-kbd-hint");
  if (searchKbdHint) {
    const platformStr = String(
      navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || ""
    );
    const isApplePlatform = /Mac|iPhone|iPad|iPod/i.test(platformStr);
    searchKbdHint.textContent = isApplePlatform ? "⌘K" : "Ctrl+K";
  }
  const searchLivePopover = document.getElementById("search-live-popover");
  const searchWrapEl = document.getElementById("global-search-wrap");
  const syncSearchClearButton = () => {
    const hasVal = Boolean(searchInput && searchInput.value.trim().length > 0);
    clearSearchBtn?.classList.toggle("hidden", !hasVal);
    searchKbdHint?.classList.toggle("hidden", hasVal);
    searchWrapEl?.classList.toggle("has-query", hasVal);
  };

  let liveSearchReqId = 0;
  let debounceTimer = null;
  let liveSearchHitsState = [];
  let liveSearchActiveIdx = -1;

  const syncLiveSearchActiveHighlight = () => {
    if (!searchLivePopover) return;
    const rows = searchLivePopover.querySelectorAll(".atv-search-hit");
    rows.forEach((r, idx) => {
      r.classList.toggle("active-hit", idx === liveSearchActiveIdx);
    });
  };

  const renderLiveSearchHits = (queryText, itemsList, isLoading = false) => {
    if (!searchLivePopover) return;
    const qClean = queryText.trim();
    if (qClean.length < 2) {
      liveSearchHitsState = [];
      liveSearchActiveIdx = -1;
      searchLivePopover.classList.add("hidden");
      searchLivePopover.innerHTML = "";
      return;
    }
    searchLivePopover.classList.remove("hidden");
    searchLivePopover.innerHTML = `<div class="atv-search-popover-head">${
      isLoading
        ? t("Поиск по каталогу и HDRezka...", "Searching catalog and HDRezka...")
        : t("Быстрый переход (стрелки и Enter)", "Quick jump (Arrow keys and Enter)")
    }</div>`;

    const topHits = (itemsList || []).slice(0, 6);
    liveSearchHitsState = topHits;
    if (liveSearchActiveIdx >= topHits.length) {
      liveSearchActiveIdx = -1;
    }
    if (topHits.length === 0 && !isLoading) {
      const emptyDiv = document.createElement("div");
      emptyDiv.style.cssText = "padding:10px 8px;font-size:12px;color:rgba(235,235,245,0.55);";
      emptyDiv.textContent = t(
        "Совпадений не найдено — нажмите Enter для полного поиска",
        "No matches found — press Enter for full search"
      );
      searchLivePopover.appendChild(emptyDiv);
    } else {
      const kinOn = isServiceEnabled("kinorium");
      topHits.forEach((hit, idx) => {
        const kRat = kinOn
          ? hit.kinorium?.kinorium_rating || hit.ratings?.kinorium || hit.ratings?.imdb || ""
          : hit.ratings?.imdb || hit.kinorium?.kinorium_rating || "";
        const ratPartHtml = kRat
          ? ` · <span class="atv-meta-rating">${iconSvg("star", 10)}<span>${escapeHtml(kRat)}</span></span>`
          : "";
        const tLabel = hit.media_type === "series" ? t("Сериал", "Series") : t("Фильм", "Movie");
        const hitTitle = displayTitle(hit);
        const secTitle = secondaryTitle(hit);
        const hitPoster = displayPoster(hit);
        const row = document.createElement("div");
        row.className = `atv-search-hit${idx === liveSearchActiveIdx ? " active-hit" : ""}`;
        row.innerHTML = `
          <img class="atv-search-hit-poster" src="${escapeAttr(hitPoster)}" alt="${escapeAttr(hitTitle)}" loading="lazy" referrerpolicy="no-referrer" />
          <div class="atv-search-hit-info">
            <div class="atv-search-hit-title">${escapeHtml(hitTitle)}</div>
            <div class="atv-search-hit-sub">${escapeHtml(hit.year || "")} · ${tLabel}${ratPartHtml}${
          secTitle ? " · " + escapeHtml(secTitle) : ""
        }</div>
          </div>
          <div class="atv-search-hit-actions">
            <button type="button" class="atv-search-hit-play" title="${escapeAttr(t("Смотреть сразу", "Watch now"))}">${iconSvg("play", 12)}</button>
          </div>
        `;
        attachSmartPosterFallback(row.querySelector("img"), hitTitle, hit.year, hit.poster);
        const playBtn = row.querySelector(".atv-search-hit-play");
        if (playBtn) {
          playBtn.onclick = (ev) => {
            ev.stopPropagation();
            searchLivePopover.classList.add("hidden");
            const info = resolveSeriesEpisodeInfo(hit);
            openPlayerModal(
              hit,
              getDefaultPlayableSourceTab(),
              info.season,
              info.episode,
              info.currentTime
            );
          };
        }
        row.onclick = () => {
          searchLivePopover.classList.add("hidden");
          openQuickPeekModal(hit);
        };
        searchLivePopover.appendChild(row);
      });
    }

    const showAllBtn = document.createElement("button");
    showAllBtn.type = "button";
    showAllBtn.className = "atv-search-all-btn";
    showAllBtn.textContent = t(
      `Показать все результаты по запросу «${qClean}»`,
      `Show all results for "${qClean}"`
    );
    showAllBtn.onclick = () => {
      searchLivePopover.classList.add("hidden");
      state.searchQuery = qClean;
      loadCatalog();
    };
    searchLivePopover.appendChild(showAllBtn);
  };

  searchInput.addEventListener("input", (e) => {
    const val = e.target.value || "";
    liveSearchActiveIdx = -1;
    syncSearchClearButton();
    clearTimeout(debounceTimer);
    const trimmed = val.trim();
    if (!trimmed) {
      searchLivePopover?.classList.add("hidden");
      if (state.searchQuery) {
        state.searchQuery = "";
        loadCatalog();
      }
      return;
    }
    if (trimmed.length < 2) {
      searchLivePopover?.classList.add("hidden");
      if (state.searchQuery) {
        state.searchQuery = "";
        loadCatalog();
      }
      return;
    }
    const qLow = trimmed.toLowerCase();
    const localMatches = (state.catalogItems || []).filter(
      (it) =>
        (it.title || "").toLowerCase().includes(qLow) ||
        (it.orig_title || "").toLowerCase().includes(qLow)
    );
    renderLiveSearchHits(trimmed, localMatches, true);

    debounceTimer = setTimeout(async () => {
      liveSearchReqId += 1;
      const rId = liveSearchReqId;
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}&provider=all&media_type=all&kinorium_section=all&lang=${encodeURIComponent(state.appLang || "ru")}`
        );
        const data = await res.json();
        if (rId !== liveSearchReqId) return;
        renderLiveSearchHits(trimmed, data.items || localMatches, false);
      } catch (_) {
        if (rId !== liveSearchReqId) return;
        renderLiveSearchHits(trimmed, localMatches, false);
      }
    }, 200);
  });

  searchInput.addEventListener("keydown", (e) => {
    const popOpen = Boolean(searchLivePopover && !searchLivePopover.classList.contains("hidden"));
    if (popOpen && liveSearchHitsState.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      if (e.key === "ArrowDown") {
        liveSearchActiveIdx =
          liveSearchActiveIdx + 1 >= liveSearchHitsState.length ? -1 : liveSearchActiveIdx + 1;
      } else {
        liveSearchActiveIdx =
          liveSearchActiveIdx <= -1 ? liveSearchHitsState.length - 1 : liveSearchActiveIdx - 1;
      }
      syncLiveSearchActiveHighlight();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(debounceTimer);
      if (popOpen && liveSearchActiveIdx >= 0 && liveSearchHitsState[liveSearchActiveIdx]) {
        const chosen = liveSearchHitsState[liveSearchActiveIdx];
        searchLivePopover?.classList.add("hidden");
        openQuickPeekModal(chosen);
        return;
      }
      searchLivePopover?.classList.add("hidden");
      state.searchQuery = searchInput.value.trim();
      loadCatalog();
    }
  });

  searchInput.addEventListener("focus", () => {
    const trimmed = (searchInput.value || "").trim();
    if (trimmed.length >= 2 && searchLivePopover && searchLivePopover.innerHTML.trim()) {
      searchLivePopover.classList.remove("hidden");
    }
  });

  if (clearSearchBtn) {
    clearSearchBtn.onclick = () => {
      searchInput.value = "";
      searchLivePopover?.classList.add("hidden");
      const hadSearch = Boolean(state.searchQuery);
      state.searchQuery = "";
      syncSearchClearButton();
      searchInput.focus();
      if (hadSearch) {
        loadCatalog();
      }
    };
  }

  window.addEventListener("focus", () => {
    state.isAppWindowActive = true;
  });
  window.addEventListener("blur", () => {
    state.isAppWindowActive = false;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || document.visibilityState !== "visible") {
      state.isAppWindowActive = false;
    } else if (typeof document.hasFocus === "function") {
      state.isAppWindowActive = document.hasFocus();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (
      !e.isTrusted ||
      !state.isAppWindowActive ||
      (typeof document.hasFocus === "function" && !document.hasFocus()) ||
      document.hidden ||
      document.visibilityState !== "visible"
    ) {
      return;
    }
    if (trapModalTabKey(e)) {
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      const confirmMod = document.getElementById("confirm-modal");
      if (confirmMod && !confirmMod.classList.contains("hidden")) {
        return;
      }
      e.preventDefault();
      if (isStageFullscreen()) {
        toggleStageFullscreen();
      }
      const personMod = document.getElementById("person-modal");
      if (personMod && !personMod.classList.contains("hidden")) {
        closePersonModal();
      }
      const qpMod = document.getElementById("quick-peek-modal");
      if (qpMod && !qpMod.classList.contains("hidden")) {
        closeQuickPeekModal();
      }
      document.getElementById("stats-modal")?.classList.add("hidden");
      document.getElementById("settings-modal")?.classList.add("hidden");
      if (state.isPlayerOpen && !state.isMiniPlayer && !state.isPipBackground) {
        setMiniPlayerMode(true);
      }
      syncScrollTopButton();
      searchInput.focus();
      searchInput.select();
      return;
    }
    if (e.key === "Escape") {
      const confirmMod = document.getElementById("confirm-modal");
      if (confirmMod && !confirmMod.classList.contains("hidden")) {
        e.preventDefault();
        closeConfirmModal(false);
        return;
      }
      if (isStageFullscreen()) {
        toggleStageFullscreen();
        return;
      }
      const settingsMod = document.getElementById("settings-modal");
      if (settingsMod && !settingsMod.classList.contains("hidden")) {
        e.preventDefault();
        requestCloseSettingsModal();
        return;
      }
      const statsMod = document.getElementById("stats-modal");
      if (statsMod && !statsMod.classList.contains("hidden")) {
        statsMod.classList.add("hidden");
        syncScrollTopButton();
        return;
      }
      const personMod = document.getElementById("person-modal");
      if (personMod && !personMod.classList.contains("hidden")) {
        closePersonModal({ clearStack: false });
        return;
      }
      const qpMod = document.getElementById("quick-peek-modal");
      if (qpMod && !qpMod.classList.contains("hidden")) {
        closeQuickPeekModal({ clearStack: false });
        return;
      }
      const liveSearchPop = document.getElementById("search-live-popover");
      if (liveSearchPop && !liveSearchPop.classList.contains("hidden")) {
        liveSearchPop.classList.add("hidden");
        return;
      }
      const notifPop = document.getElementById("notifications-popover");
      if (notifPop && !notifPop.classList.contains("hidden")) {
        notifPop.classList.add("hidden");
        return;
      }
      if (hasOpenVcPopover()) {
        closeAllVcPopovers();
        syncVcPopoverOpenClass();
        return;
      }
      const gearPop = document.getElementById("player-gear-popover");
      if (gearPop && !gearPop.classList.contains("hidden")) {
        gearPop.classList.add("hidden");
        document.getElementById("btn-player-gear")?.classList.remove("active");
        syncVcPopoverOpenClass();
        return;
      }
      const statusPop = document.getElementById("kinorium-status-popover");
      if (statusPop && !statusPop.classList.contains("hidden")) {
        statusPop.classList.add("hidden");
        return;
      }
      const postWatch = document.getElementById("kinorium-postwatch-overlay");
      if (postWatch && !postWatch.classList.contains("hidden")) {
        state.postwatchManual = false;
        state.postwatchHovered = false;
        postWatch.classList.add("hidden");
        return;
      }
      if (state.isPlayerOpen && !state.isMiniPlayer && !state.isPipBackground) {
        closePlayerModal();
      }
      return;
    }

    const tag = (e.target?.tagName || "").toUpperCase();
    const isTypingTarget =
      tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(e.target?.isContentEditable);
    const isInteractiveBtnTarget =
      tag === "BUTTON" || tag === "A" || tag === "SUMMARY" || Boolean(e.target?.closest?.('[role="button"]'));

    const hasTopCatalogModalOpen = [
      "confirm-modal",
      "person-modal",
      "quick-peek-modal",
      "stats-modal",
      "settings-modal",
    ].some((id) => {
      const el = document.getElementById(id);
      return el && !el.classList.contains("hidden");
    });

    // Hotkeys when floating Mini-Player or System PiP background mode is active
    if (
      state.isPlayerOpen &&
      (state.isMiniPlayer || state.isPipBackground) &&
      !hasTopCatalogModalOpen &&
      !isTypingTarget &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      const miniKey = (e.key || "").toLowerCase();
      if (miniKey === "i" || miniKey === "ш") {
        e.preventDefault();
        if (state.isMiniPlayer) {
          setMiniPlayerMode(false);
        } else {
          restoreFullPlayerFromPip();
        }
        return;
      }
      if (
        miniKey === "k" ||
        miniKey === "л" ||
        (e.code === "Space" && !isInteractiveBtnTarget)
      ) {
        e.preventDefault();
        toggleVideoPlayPause(false);
        return;
      }
    }

    // Player keyboard shortcuts ONLY when full Player Modal is active on a video tab and no top overlay is open
    if (
      !state.isPlayerOpen ||
      state.isPipBackground ||
      state.isMiniPlayer ||
      (state.activeSourceTab !== "hdrezka" &&
        state.activeSourceTab !== "stremio" &&
        state.activeSourceTab !== "backup4k") ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey
    ) {
      return;
    }
    const blockingOverlays = [
      "confirm-modal",
      "person-modal",
      "quick-peek-modal",
      "stats-modal",
      "settings-modal",
      "kinorium-postwatch-overlay",
    ];
    if (
      blockingOverlays.some((id) => {
        const el = document.getElementById(id);
        return el && !el.classList.contains("hidden");
      })
    ) {
      return;
    }
    if (isTypingTarget) {
      return;
    }

    const video = document.getElementById("native-video");
    if (!video) return;
    wakeVideoControls();
    const keyLow = (e.key || "").toLowerCase();
    const inScrollablePlayerPanel = Boolean(
      e.target?.closest?.(
        ".atv-info-sidebar, .atv-releases-list, .atv-episodes-strip, .atv-vc-popover, .atv-gear-popover"
      )
    );

    if ((e.code === "Space" && !isInteractiveBtnTarget) || keyLow === "k" || keyLow === "л") {
      e.preventDefault();
      toggleVideoPlayPause(true);
    } else if (keyLow === "f" || keyLow === "а") {
      e.preventDefault();
      toggleStageFullscreen();
    } else if (e.key === "ArrowLeft" || keyLow === "j" || keyLow === "о") {
      e.preventDefault();
      const { cur } = getEffectivePlaybackTiming(video);
      const target = Math.max(0, cur - 10);
      seekEffectivePlayback(target);
      triggerVideoCenterIndicator("back10", `−10 ${t("секунд", "sec")} · ${formatTime(target)}`);
    } else if (e.key === "ArrowRight" || keyLow === "l" || keyLow === "д") {
      e.preventDefault();
      const { cur, dur } = getEffectivePlaybackTiming(video);
      const maxDur = dur > 0 ? dur : cur + 10;
      const target = Math.min(maxDur, cur + 10);
      seekEffectivePlayback(target);
      triggerVideoCenterIndicator("fwd10", `+10 ${t("секунд", "sec")} · ${formatTime(target)}`);
    } else if (e.key === "ArrowUp" && !inScrollablePlayerPanel) {
      e.preventDefault();
      state.userMutedThisSession = false;
      video.muted = false;
      video.volume = Math.min(1, Math.round((video.volume + 0.1) * 100) / 100);
      savePlayerPrefs({ volume: video.volume, muted: false });
      if (state.audioCtx && state.audioCtx.state === "suspended") {
        state.audioCtx.resume().catch(() => {});
      }
      const volPct = Math.round(video.volume * 100);
      showVideoOsd("volHigh", t(`Громкость ${volPct}%`, `Volume ${volPct}%`), volPct);
    } else if (e.key === "ArrowDown" && !inScrollablePlayerPanel) {
      e.preventDefault();
      video.volume = Math.max(0, Math.round((video.volume - 0.1) * 100) / 100);
      state.userMutedThisSession = video.volume === 0;
      video.muted = state.userMutedThisSession;
      if (video.volume > 0.02) {
        savePlayerPrefs({ volume: video.volume, muted: false });
      }
      const volPct = Math.round(video.volume * 100);
      showVideoOsd(volPct === 0 ? "volMute" : "volLow", t(`Громкость ${volPct}%`, `Volume ${volPct}%`), volPct);
    } else if (keyLow === "m" || keyLow === "ь") {
      e.preventDefault();
      state.userMutedThisSession = !video.muted;
      video.muted = state.userMutedThisSession;
      if (!video.muted && video.volume <= 0.02) {
        video.volume = 0.85;
        savePlayerPrefs({ volume: 0.85, muted: false });
      }
      if (state.audioCtx && state.audioCtx.state === "suspended") {
        state.audioCtx.resume().catch(() => {});
      }
      triggerVideoCenterIndicator(
        video.muted ? "mute" : "unmute",
        video.muted ? t("Без звука", "Muted") : `${Math.round(video.volume * 100)}%`
      );
      syncCustomVideoControlsUI(true);
    } else if ((keyLow === "n" || keyLow === "т") && state.activeItem?.media_type === "series") {
      e.preventDefault();
      stepEpisode(1);
    } else if ((keyLow === "p" || keyLow === "з") && state.activeItem?.media_type === "series") {
      e.preventDefault();
      stepEpisode(-1);
    } else if (keyLow === "i" || keyLow === "ш") {
      e.preventDefault();
      togglePictureInPicture();
    } else if (keyLow === "b" || keyLow === "и") {
      e.preventDefault();
      const levels = [1, 1.5, 2, 3, 4];
      const curIdx = levels.findIndex((lv) => Math.abs(lv - (state.audioBoost || 1)) < 0.1);
      const nextBoost = levels[(curIdx + 1) % levels.length];
      applyAudioBoostToVideo(video, nextBoost, state.audioPreset);
      savePlayerPrefs({ audioBoost: nextBoost });
      showVideoOsd(
        "volHigh",
        nextBoost > 1
          ? t(`Усиление ${Math.round(nextBoost * 100)}%`, `Audio Boost ${Math.round(nextBoost * 100)}%`)
          : t("Звук 100% (Стандарт)", "Volume 100% (Standard)"),
        (nextBoost / 4) * 100
      );
    } else if (keyLow === "e" || keyLow === "у") {
      e.preventDefault();
      const presets = ["flat", "voice", "night", "cinema"];
      const curIdx = presets.indexOf(state.audioPreset || "flat");
      const nextPreset = presets[(curIdx + 1) % presets.length];
      applyAudioBoostToVideo(video, state.audioBoost, nextPreset);
      savePlayerPrefs({ audioPreset: nextPreset });
      showVideoOsd("eq", getAudioPresetLabel(nextPreset));
    } else if (keyLow === "s" || keyLow === "ы") {
      e.preventDefault();
      captureVideoScreenshot();
    } else if (keyLow === "o" || keyLow === "щ") {
      e.preventDefault();
      toggleQuickOriginalAudio();
    } else if (keyLow === "c" || keyLow === "с") {
      e.preventDefault();
      const modes = ["contain", "cover", "zoom115", "fill"];
      const curIdx = modes.indexOf(state.videoCrop || "contain");
      const nextCrop = modes[(curIdx + 1) % modes.length];
      applyVideoCropToVideo(video, nextCrop);
      savePlayerPrefs({ videoCrop: nextCrop });
      showVideoOsd("crop", getVideoCropLabel(nextCrop));
    } else if (keyLow === "a" || keyLow === "ф") {
      e.preventDefault();
      state.ambilightEnabled = !state.ambilightEnabled;
      const ambiToggle = document.getElementById("ambilight-toggle");
      if (ambiToggle) ambiToggle.checked = Boolean(state.ambilightEnabled);
      savePlayerPrefs({ ambilightEnabled: state.ambilightEnabled });
      if (state.ambilightEnabled) {
        startAmbilightLoop();
        showVideoOsd("glow", t("Ambilight подсветка включена", "Ambilight glow enabled"));
      } else {
        stopAmbilightLoop(true);
        showVideoOsd("glow", t("Ambilight подсветка выключена", "Ambilight glow disabled"));
      }
    }
  });

  const brandHomeEl = document.getElementById("brand-home");
  brandHomeEl.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      brandHomeEl.click();
    }
  };
  brandHomeEl.onclick = () => {
    state.searchQuery = "";
    state.providerFilter = "all";
    state.mediaTypeFilter = "all";
    state.kinoriumSection = "all";
    state.kinoriumSubType = "all";
    state.genreFilter = "all";
    state.yearFilter = "all";
    state.hideWatched = false;
    saveUiPrefs({ hideWatched: false });
    state.friendsFilter = false;
    state.selectedFriend = "all";
    state.sortBy = "default";
    searchInput.value = "";
    syncSearchClearButton();
    const sortSel = document.getElementById("select-catalog-sort");
    if (sortSel) sortSel.value = "default";
    const genreSel = document.getElementById("select-catalog-genre");
    if (genreSel) genreSel.value = "all";
    const yearSel = document.getElementById("select-catalog-year");
    if (yearSel) yearSel.value = "all";
    const friendSel = document.getElementById("select-friend-filter");
    if (friendSel) friendSel.value = "all";
    document.getElementById("btn-hide-watched")?.classList.remove("active");
    document.getElementById("btn-friends-filter")?.classList.remove("active");
    updateActiveFiltersBadge();
    document.querySelectorAll(".atv-pill").forEach((b) => {
      b.classList.toggle("active", b.dataset.provider === "all");
    });
    document.querySelectorAll(".type-pill").forEach((b) => {
      b.classList.toggle("active", b.dataset.type === "all");
    });
    document.querySelectorAll(".kin-sec-pill").forEach((b) => {
      b.classList.toggle("active", b.dataset.ksec === "all");
    });
    loadCatalog();
  };

  const toggleCatalogFiltersBtn = document.getElementById("btn-toggle-catalog-filters");
  const catalogFiltersDrawer = document.getElementById("catalog-filters-drawer");
  if (toggleCatalogFiltersBtn && catalogFiltersDrawer) {
    toggleCatalogFiltersBtn.onclick = () => {
      catalogFiltersDrawer.classList.toggle("hidden");
      updateActiveFiltersBadge();
    };
  }

  const clearCatalogFiltersBtn = document.getElementById("btn-clear-catalog-filters");
  if (clearCatalogFiltersBtn) {
    clearCatalogFiltersBtn.onclick = () => {
      state.genreFilter = "all";
      state.yearFilter = "all";
      state.sortBy = "default";
      state.hideWatched = false;
      state.friendsFilter = false;
      state.selectedFriend = "all";
      saveUiPrefs({ hideWatched: false });
      const sortSel = document.getElementById("select-catalog-sort");
      if (sortSel) sortSel.value = "default";
      const genreSel = document.getElementById("select-catalog-genre");
      if (genreSel) genreSel.value = "all";
      const yearSel = document.getElementById("select-catalog-year");
      if (yearSel) yearSel.value = "all";
      const friendSel = document.getElementById("select-friend-filter");
      if (friendSel) friendSel.value = "all";
      document.getElementById("btn-hide-watched")?.classList.remove("active");
      document.getElementById("btn-friends-filter")?.classList.remove("active");
      updateActiveFiltersBadge();
      renderCatalogShelves();
      showToast(t("Фильтры и сортировка сброшены", "Filters and sorting reset"));
    };
  }

  const openStatsBtn = document.getElementById("btn-open-stats-modal");
  if (openStatsBtn) {
    openStatsBtn.onclick = () => openStatsModal("analytics");
  }
  document.getElementById("stats-tab-analytics")?.addEventListener("click", () => {
    switchStatsModalTab("analytics");
  });
  document.getElementById("stats-tab-history")?.addEventListener("click", () => {
    switchStatsModalTab("history");
  });
  const closeStatsBtn = document.getElementById("close-stats-modal");
  if (closeStatsBtn) {
    closeStatsBtn.onclick = () => {
      document.getElementById("stats-modal")?.classList.add("hidden");
      syncScrollTopButton();
    };
  }
  document.getElementById("stats-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "stats-modal") {
      document.getElementById("stats-modal")?.classList.add("hidden");
      syncScrollTopButton();
    }
  });

  // Quick Peek Modal listeners (back, rate 1-10, status toggles, close)
  document.getElementById("qp-back-nav-btn")?.addEventListener("click", () => goBackInModalStack());
  document.getElementById("close-quick-peek-modal")?.addEventListener("click", () =>
    closeQuickPeekModal({ clearStack: true })
  );
  document.getElementById("quick-peek-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "quick-peek-modal") {
      closeQuickPeekModal({ clearStack: true });
    }
  });

  const buildQpPayload = (item) => ({
    id: item.id,
    title: item.title,
    orig_title: item.orig_title,
    poster: item.poster,
    backdrop: item.backdrop,
    year: item.year,
    media_type: item.media_type,
    rezka_id: item.rezka_id,
    rezka_url: item.rezka_url,
    is_series_completed: resolveSeriesCompletedFlag(item),
  });

  const bindStarsHoverRange = (starsContainer) => {
    if (!starsContainer) return;
    const buttons = Array.from(starsContainer.querySelectorAll("button[data-score]"));
    const clearHover = () => {
      starsContainer.classList.remove("is-hovering");
      buttons.forEach((b) => {
        b.classList.remove("hover-range", "hover-target");
      });
    };
    buttons.forEach((btn) => {
      const targetScore = parseInt(btn.dataset.score, 10) || 0;
      btn.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "touch") return;
        starsContainer.classList.add("is-hovering");
        buttons.forEach((b) => {
          const sc = parseInt(b.dataset.score, 10) || 0;
          b.classList.toggle("hover-range", sc > 0 && sc <= targetScore);
          b.classList.toggle("hover-target", sc === targetScore);
        });
      });
    });
    starsContainer.addEventListener("pointerleave", clearHover);
    starsContainer.addEventListener("click", clearHover);
  };

  const qpStarsWrap = document.getElementById("qp-stars");
  bindStarsHoverRange(qpStarsWrap);
  document.querySelectorAll("#qp-stars button").forEach((btn) => {
    btn.onclick = () => {
      const item = state.quickPeekItem;
      if (!item) return;
      withKinoriumActionLock(`qp-rate:${item.id}`, qpStarsWrap || btn, async () => {
        const score = parseInt(btn.dataset.score, 10);
        const res = await fetch("/api/kinorium/rate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...buildQpPayload(item),
            score,
            comment: item.kinorium?.comment || "",
          }),
        });
        const updated = await res.json();
        syncQuickPeekStatusesUI({ ...item, kinorium: updated });
        patchCatalogItemKinoriumInPlace(item, updated);
        showToast(
          t(
            `Оценка ${score}/10 сохранена для «${displayTitle(item)}»`,
            `Rating ${score}/10 saved for "${displayTitle(item)}"`
          )
        );
      });
    };
  });
  const qpClearRateBtn = document.getElementById("qp-clear-rate-btn");
  if (qpClearRateBtn) {
    qpClearRateBtn.onclick = () => {
      const item = state.quickPeekItem;
      if (!item || !item.kinorium?.user_rating) return;
      withKinoriumActionLock(`qp-rate:${item.id}`, qpClearRateBtn, async () => {
        const res = await fetch("/api/kinorium/rate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...buildQpPayload(item),
            score: 0,
            clear: true,
          }),
        });
        const updated = await res.json();
        syncQuickPeekStatusesUI({ ...item, kinorium: updated });
        patchCatalogItemKinoriumInPlace(item, updated);
        showToast(
          t(
            `Оценка удалена для «${displayTitle(item)}»`,
            `Rating removed for "${displayTitle(item)}"`
          )
        );
      });
    };
  }

  const qpBtnWatching = document.getElementById("qp-btn-watching");
  qpBtnWatching?.addEventListener("click", () => {
    const item = state.quickPeekItem;
    if (!item) return;
    withKinoriumActionLock(`qp-watching:${item.id}`, qpBtnWatching, async () => {
      const res = await fetch("/api/kinorium/watching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildQpPayload(item)),
      });
      const updated = await res.json();
      item.kinorium = updated;
      syncQuickPeekStatusesUI(item);
      patchCatalogItemKinoriumInPlace(item, updated);
      showToast(
        updated.watching
          ? t(`«${displayTitle(item)}» в разделе Смотрю`, `"${displayTitle(item)}" added to Watching`)
          : t("Убрано из Смотрю", "Removed from Watching")
      );
    });
  });

  const qpBtnWatchlist = document.getElementById("qp-btn-watchlist");
  qpBtnWatchlist?.addEventListener("click", () => {
    const item = state.quickPeekItem;
    if (!item) return;
    withKinoriumActionLock(`qp-watchlist:${item.id}`, qpBtnWatchlist, async () => {
      const res = await fetch("/api/kinorium/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildQpPayload(item)),
      });
      const updated = await res.json();
      item.kinorium = updated;
      syncQuickPeekStatusesUI(item);
      patchCatalogItemKinoriumInPlace(item, updated);
      showToast(
        updated.in_watchlist
          ? t(`«${displayTitle(item)}» в Буду смотреть`, `"${displayTitle(item)}" added to Watchlist`)
          : t("Убрано из Буду смотреть", "Removed from Watchlist")
      );
    });
  });

  const qpBtnWatched = document.getElementById("qp-btn-watched");
  qpBtnWatched?.addEventListener("click", () => {
    const item = state.quickPeekItem;
    if (!item) return;
    withKinoriumActionLock(`qp-watched:${item.id}`, qpBtnWatched, async () => {
      const curWatched = Boolean(item.kinorium?.watched);
      const res = await fetch("/api/kinorium/watched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildQpPayload(item), watched: !curWatched }),
      });
      const updated = await res.json();
      item.kinorium = updated;
      syncQuickPeekStatusesUI(item);
      patchCatalogItemKinoriumInPlace(item, updated);
      showToast(
        updated.watched
          ? t(`«${displayTitle(item)}» отмечено просмотренным`, `"${displayTitle(item)}" marked as watched`)
          : t("Снята отметка просмотренного", "Unmarked as watched")
      );
    });
  });

  const qpBtnNever = document.getElementById("qp-btn-never");
  qpBtnNever?.addEventListener("click", () => {
    const item = state.quickPeekItem;
    if (!item) return;
    withKinoriumActionLock(`qp-never:${item.id}`, qpBtnNever, async () => {
      const res = await fetch("/api/kinorium/never", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildQpPayload(item)),
      });
      const updated = await res.json();
      item.kinorium = updated;
      syncQuickPeekStatusesUI(item);
      patchCatalogItemKinoriumInPlace(item, updated);
      showToast(
        updated.not_watching
          ? t(`«${displayTitle(item)}» в Не буду смотреть`, `"${displayTitle(item)}" added to Won't watch`)
          : t("Убрано из Не буду смотреть", "Removed from Won't watch")
      );
    });
  });

  const hideWatchedBtn = document.getElementById("btn-hide-watched");
  if (hideWatchedBtn) {
    hideWatchedBtn.onclick = () => {
      state.hideWatched = !state.hideWatched;
      saveUiPrefs({ hideWatched: state.hideWatched });
      hideWatchedBtn.classList.toggle("active", state.hideWatched);
      updateActiveFiltersBadge();
      renderCatalogShelves();
      showToast(
        state.hideWatched
          ? t("Просмотренные фильмы и сериалы скрыты", "Watched movies and series hidden")
          : t("Отображение просмотренных фильмов включено", "Showing watched titles")
      );
    };
  }

  const friendSelect = document.getElementById("select-friend-filter");
  const friendsFilterBtn = document.getElementById("btn-friends-filter");
  if (friendsFilterBtn) {
    friendsFilterBtn.onclick = () => {
      state.friendsFilter = !state.friendsFilter;
      if (!state.friendsFilter) {
        state.selectedFriend = "all";
        if (friendSelect) friendSelect.value = "all";
      }
      friendsFilterBtn.classList.toggle("active", state.friendsFilter);
      updateActiveFiltersBadge();
      renderCatalogShelves();
      showToast(
        state.friendsFilter
          ? t(
              "Показаны только фильмы и сериалы с оценками друзей",
              "Showing only movies and series rated by friends"
            )
          : t("Фильтр «Оценили друзья» отключен", '"Rated by friends" filter disabled')
      );
    };
  }
  if (friendSelect) {
    friendSelect.onchange = (e) => {
      const val = e.target.value || "all";
      state.selectedFriend = val;
      if (val !== "all") {
        state.friendsFilter = true;
        friendsFilterBtn?.classList.add("active");
        showToast(t(`Показаны тайтлы, которые оценил(а) ${val}`, `Showing titles rated by ${val}`));
      } else {
        showToast(t("Показаны оценки всех друзей", "Showing ratings from all friends"));
      }
      updateActiveFiltersBadge();
      renderCatalogShelves();
    };
  }

  const genreSelect = document.getElementById("select-catalog-genre");
  if (genreSelect) {
    genreSelect.onchange = (e) => {
      state.genreFilter = e.target.value || "all";
      updateActiveFiltersBadge();
      renderCatalogShelves();
    };
  }

  const yearSelect = document.getElementById("select-catalog-year");
  if (yearSelect) {
    yearSelect.onchange = (e) => {
      state.yearFilter = e.target.value || "all";
      updateActiveFiltersBadge();
      renderCatalogShelves();
    };
  }

  const randomPickBtn = document.getElementById("btn-random-pick");
  if (randomPickBtn) {
    randomPickBtn.onclick = () => {
      const pool = getCurrentlyFilteredItems();
      if (!pool || pool.length === 0) {
        showToast(
          t(
            "В текущем разделе или фильтре нет подходящих тайтлов",
            "No matching titles in the current section or filter"
          )
        );
        return;
      }
      const picked = pool[Math.floor(Math.random() * pool.length)];
      showToast(
        t(
          `Случайный выбор: «${displayTitle(picked)}» (${picked.year})`,
          `Random pick: "${displayTitle(picked)}" (${picked.year})`
        )
      );
      openQuickPeekModal(picked);
    };
  }

  const toggleMiniPlayerBtn = document.getElementById("btn-toggle-mini-player");
  if (toggleMiniPlayerBtn) {
    toggleMiniPlayerBtn.onclick = (e) => {
      e.stopPropagation();
      setMiniPlayerMode(!state.isMiniPlayer);
    };
  }

  const playerGearBtn = document.getElementById("btn-player-gear");
  const playerGearPopover = document.getElementById("player-gear-popover");
  const closePlayerGearBtn = document.getElementById("btn-close-player-gear");
  if (playerGearBtn && playerGearPopover) {
    playerGearPopover.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    playerGearBtn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = playerGearPopover.classList.contains("hidden");
      closeAllVcPopovers();
      if (willOpen) {
        playerGearPopover.classList.remove("hidden");
        playerGearBtn.classList.add("active");
      }
      syncVcPopoverOpenClass();
      wakeVideoControls();
    };
  }
  if (closePlayerGearBtn && playerGearPopover) {
    closePlayerGearBtn.onclick = (e) => {
      e.stopPropagation();
      playerGearPopover.classList.add("hidden");
      playerGearBtn?.classList.remove("active");
      syncVcPopoverOpenClass();
      wakeVideoControls();
    };
  }

  const toggleGearHotkeysBtn = document.getElementById("btn-toggle-gear-hotkeys");
  const gearHotkeysBox = document.getElementById("gear-hotkeys-box");
  if (toggleGearHotkeysBtn && gearHotkeysBox) {
    toggleGearHotkeysBtn.onclick = (e) => {
      e.stopPropagation();
      const willShow = gearHotkeysBox.classList.contains("hidden");
      gearHotkeysBox.classList.toggle("hidden", !willShow);
      toggleGearHotkeysBtn.classList.toggle("active", willShow);
    };
  }

  document.querySelectorAll("#gear-speed-pills .gear-speed-pill").forEach((pill) => {
    pill.onclick = (e) => {
      e.stopPropagation();
      const rate = parseFloat(pill.dataset.speed) || 1.0;
      const video = document.getElementById("native-video");
      if (video) {
        video.playbackRate = rate;
      }
      const speedSel = document.getElementById("select-speed");
      if (speedSel) {
        speedSel.value = String(rate);
      }
      savePlayerPrefs({ playbackRate: rate });
      updatePlayerGearActiveDot();
      showToast(t(`Скорость: ${rate}x`, `Speed: ${rate}x`));
    };
  });

  document.getElementById("btn-video-err-retry")?.addEventListener("click", (e) => {
    e.stopPropagation();
    hideVideoStreamError();
    const v = document.getElementById("native-video");
    const { cur } = getEffectivePlaybackTiming(v);
    const curPos = cur > 5 ? cur : 0;
    if (state.activeSourceTab === "stremio") {
      loadStremioStreams(curPos);
    } else if (state.activeSourceTab === "backup4k") {
      loadBackup4KReleases(curPos);
    } else {
      loadHDRezkaStream(curPos);
    }
  });
  document.getElementById("btn-video-err-studio")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const studioPop = document.getElementById("vc-studio-popover");
    const studioSel = document.getElementById("select-studio");
    if (studioPop && studioSel && studioSel.options.length > 1) {
      closeAllVcPopovers();
      syncCustomControlPopovers();
      studioPop.classList.remove("hidden");
      wakeVideoControls();
    }
  });
  document.getElementById("btn-video-err-4k")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isServiceEnabled("backup4k")) {
      switchSourceTab("backup4k", null);
    }
  });

  const setEpisodeViewMode = (mode) => {
    state.epViewMode = mode;
    try {
      localStorage.setItem(EP_VIEW_MODE_STORAGE_KEY, mode);
    } catch (_) {}
    if (state.activeItem) {
      const effMap = resolveEffectiveSeasonsMap(state.activeItem, state.seasonsMap);
      populateSeasonEpisodeSelectors(state.activeItem, effMap);
    }
  };
  document.getElementById("btn-ep-view-grid")?.addEventListener("click", () => setEpisodeViewMode("grid"));
  document.getElementById("btn-ep-view-strip")?.addEventListener("click", () => setEpisodeViewMode("strip"));
  const toggleEpStripBtn = document.getElementById("btn-toggle-episodes-strip");
  if (toggleEpStripBtn) {
    toggleEpStripBtn.onclick = () => {
      state.episodesStripExpanded = !state.episodesStripExpanded;
      syncEpisodesStripDrawerUI();
      if (state.episodesStripExpanded) {
        const activePill = document.querySelector("#episodes-strip-bar .atv-ep-pill.active");
        if (activePill) {
          requestAnimationFrame(() => {
            try {
              activePill.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
            } catch (_) {}
          });
        }
      }
    };
  }
  const epStripWheelEl = document.getElementById("episodes-strip-bar");
  if (epStripWheelEl) {
    attachHorizontalWheelScroll(epStripWheelEl);
  }

  const kinStatusMenuBtn = document.getElementById("btn-kinorium-status-menu");
  const kinStatusPopover = document.getElementById("kinorium-status-popover");
  if (kinStatusMenuBtn && kinStatusPopover) {
    kinStatusMenuBtn.onclick = (e) => {
      e.stopPropagation();
      kinStatusPopover.classList.toggle("hidden");
    };
  }

  const restoreMiniBtn = document.getElementById("btn-restore-mini-player");
  if (restoreMiniBtn) {
    restoreMiniBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    restoreMiniBtn.onclick = (e) => {
      e.stopPropagation();
      restoreFullPlayerFromPip();
    };
  }
  const closeMiniBtn = document.getElementById("btn-close-mini-player");
  if (closeMiniBtn) {
    closeMiniBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    closeMiniBtn.onclick = (e) => {
      e.stopPropagation();
      closePlayerModal(false, true);
    };
  }
  const miniPlayPauseBtn = document.getElementById("btn-mini-play-pause");
  if (miniPlayPauseBtn) {
    miniPlayPauseBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    miniPlayPauseBtn.onclick = (e) => {
      e.stopPropagation();
      toggleVideoPlayPause(false);
    };
  }
  const miniNextEpBtn = document.getElementById("btn-mini-next-ep");
  if (miniNextEpBtn) {
    miniNextEpBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    miniNextEpBtn.onclick = (e) => {
      e.stopPropagation();
      stepEpisode(1);
    };
  }

  document.getElementById("btn-pip-go-home")?.addEventListener("click", (e) => {
    e.stopPropagation();
    setPipBackgroundMode(true);
    showToast(
      t(
        "Вы на главной странице — видео продолжает играть в режиме «Картинка в картинке»",
        "Back on Home — video continues playing in Picture-in-Picture"
      )
    );
  });
  document.getElementById("btn-pip-return-inline")?.addEventListener("click", (e) => {
    e.stopPropagation();
    restoreFullPlayerFromPip();
  });
  document.getElementById("btn-pip-dock-play")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleVideoPlayPause(false);
  });
  document.getElementById("btn-pip-dock-next-ep")?.addEventListener("click", (e) => {
    e.stopPropagation();
    stepEpisode(1);
  });
  document.getElementById("btn-pip-dock-restore")?.addEventListener("click", (e) => {
    e.stopPropagation();
    restoreFullPlayerFromPip();
  });
  document.getElementById("pip-dock-title")?.addEventListener("click", (e) => {
    e.stopPropagation();
    restoreFullPlayerFromPip();
  });
  document.querySelector("#pip-status-dock .atv-pip-dock-badge")?.addEventListener("click", (e) => {
    e.stopPropagation();
    restoreFullPlayerFromPip();
  });
  document.getElementById("btn-pip-dock-close")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closePlayerModal(false, true);
  });

  const preservePlayerHistoryIfNeeded = () => {
    if (
      state.isPlayerOpen &&
      state.hasPlayerHistoryEntry &&
      !window.history.state?.cineflowPlayerModal
    ) {
      try {
        window.history.pushState({ cineflowPlayerModal: true }, "");
      } catch (_) {}
    }
  };

  window.addEventListener("popstate", () => {
    if (state.ignoringSyntheticPopstate) {
      state.ignoringSyntheticPopstate = false;
      return;
    }
    const confirmMod = document.getElementById("confirm-modal");
    if (confirmMod && !confirmMod.classList.contains("hidden")) {
      closeConfirmModal(false);
      preservePlayerHistoryIfNeeded();
      return;
    }
    const settingsMod = document.getElementById("settings-modal");
    if (settingsMod && !settingsMod.classList.contains("hidden")) {
      settingsMod.classList.add("hidden");
      syncScrollTopButton();
      preservePlayerHistoryIfNeeded();
      return;
    }
    const statsMod = document.getElementById("stats-modal");
    if (statsMod && !statsMod.classList.contains("hidden")) {
      statsMod.classList.add("hidden");
      syncScrollTopButton();
      preservePlayerHistoryIfNeeded();
      return;
    }
    const personMod = document.getElementById("person-modal");
    if (personMod && !personMod.classList.contains("hidden")) {
      closePersonModal({ clearStack: false });
      preservePlayerHistoryIfNeeded();
      return;
    }
    const qpMod = document.getElementById("quick-peek-modal");
    if (qpMod && !qpMod.classList.contains("hidden")) {
      closeQuickPeekModal({ clearStack: false });
      preservePlayerHistoryIfNeeded();
      return;
    }
    if (state.hasPlayerHistoryEntry) {
      state.hasPlayerHistoryEntry = false;
      if (state.isPlayerOpen && !state.isPipBackground) {
        if (isVideoInPiP()) {
          setPipBackgroundMode(true);
          showToast(
            t(
              "Видео продолжает играть в режиме «Картинка в картинке»",
              "Video continues playing in Picture-in-Picture"
            )
          );
        } else {
          closePlayerModal(false, true, true);
        }
      }
    }
  });

  const miniBarEl = document.getElementById("mini-player-bar");
  const cinemaSheetEl = document.querySelector("#player-modal .atv-cinema-sheet");
  if (miniBarEl && cinemaSheetEl) {
    let isDraggingMini = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    miniBarEl.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      setMiniPlayerMode(false);
    });

    miniBarEl.addEventListener("pointerdown", (e) => {
      if (!state.isMiniPlayer || e.target.closest("button")) return;
      isDraggingMini = true;
      miniBarEl.classList.add("dragging");
      const rect = cinemaSheetEl.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      cinemaSheetEl.style.position = "fixed";
      cinemaSheetEl.style.left = `${rect.left}px`;
      cinemaSheetEl.style.top = `${rect.top}px`;
      cinemaSheetEl.style.right = "auto";
      cinemaSheetEl.style.bottom = "auto";
      try {
        miniBarEl.setPointerCapture(e.pointerId);
      } catch (_) {}
    });

    miniBarEl.addEventListener("pointermove", (e) => {
      if (!isDraggingMini || !state.isMiniPlayer) return;
      const rect = cinemaSheetEl.getBoundingClientRect();
      const maxX = Math.max(12, window.innerWidth - rect.width - 12);
      const maxY = Math.max(12, window.innerHeight - rect.height - 12);
      const nextX = Math.min(maxX, Math.max(12, e.clientX - dragOffsetX));
      const nextY = Math.min(maxY, Math.max(12, e.clientY - dragOffsetY));
      cinemaSheetEl.style.left = `${Math.round(nextX)}px`;
      cinemaSheetEl.style.top = `${Math.round(nextY)}px`;
    });

    const stopMiniDrag = () => {
      if (!isDraggingMini) return;
      isDraggingMini = false;
      miniBarEl.classList.remove("dragging");
    };
    miniBarEl.addEventListener("pointerup", stopMiniDrag);
    miniBarEl.addEventListener("pointercancel", stopMiniDrag);

    window.addEventListener("resize", () => {
      if (!state.isMiniPlayer || cinemaSheetEl.style.position !== "fixed") return;
      const rect = cinemaSheetEl.getBoundingClientRect();
      const maxX = Math.max(12, window.innerWidth - rect.width - 12);
      const maxY = Math.max(12, window.innerHeight - rect.height - 12);
      const curX = parseFloat(cinemaSheetEl.style.left) || rect.left;
      const curY = parseFloat(cinemaSheetEl.style.top) || rect.top;
      cinemaSheetEl.style.left = `${Math.round(Math.min(maxX, Math.max(12, curX)))}px`;
      cinemaSheetEl.style.top = `${Math.round(Math.min(maxY, Math.max(12, curY)))}px`;
    });
  }

  const videoCropSelect = document.getElementById("select-video-crop");
  if (videoCropSelect) {
    videoCropSelect.onchange = (e) => {
      const mode = e.target.value || "contain";
      const video = document.getElementById("native-video");
      applyVideoCropToVideo(video, mode);
      savePlayerPrefs({ videoCrop: mode });
      showToast(t(`Экран: ${getVideoCropLabel(mode)}`, `Aspect: ${getVideoCropLabel(mode)}`));
    };
  }

  const markEpUptoBtn = document.getElementById("btn-mark-ep-upto");
  if (markEpUptoBtn) {
    markEpUptoBtn.onclick = () => markEpisodesBatch("upto");
  }
  const markSeasonWatchedBtn = document.getElementById("btn-mark-season-watched");
  if (markSeasonWatchedBtn) {
    markSeasonWatchedBtn.onclick = () => markEpisodesBatch("season");
  }

  const sleepTimerSelect = document.getElementById("select-sleep-timer");
  if (sleepTimerSelect) {
    sleepTimerSelect.onchange = (e) => {
      const val = e.target.value || "off";
      setSleepTimer(val);
      if (val === "off") {
        showToast(t("Таймер сна выключен", "Sleep timer off"));
      }
    };
  }

  const screenshotBtn = document.getElementById("btn-screenshot");
  if (screenshotBtn) {
    screenshotBtn.onclick = () => captureVideoScreenshot();
  }

  const sortSelect = document.getElementById("select-catalog-sort");
  if (sortSelect) {
    sortSelect.onchange = (e) => {
      state.sortBy = e.target.value || "default";
      updateActiveFiltersBadge();
      renderCatalogShelves();
    };
  }

  // Kinorium Sections switcher: Весь каталог | Смотрю | Буду смотреть | Просмотрено | Не буду смотреть
  document.querySelectorAll(".kin-sec-pill").forEach((btn) => {
    btn.onclick = () => {
      state.kinoriumSection = btn.dataset.ksec;
      state.kinoriumSubType = state.mediaTypeFilter || "all";
      document.querySelectorAll(".kin-sec-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      requestAnimationFrame(() => {
        try {
          btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        } catch (_) {}
      });
      loadCatalog();
    };
  });

  // Single unified Content Type switcher (#media-type-bar): Все | Фильмы | Сериалы
  document.querySelectorAll(".type-pill").forEach((btn) => {
    btn.onclick = () => {
      const nextType = btn.dataset.type || "all";
      state.mediaTypeFilter = nextType;
      state.kinoriumSubType = nextType;
      document.querySelectorAll(".type-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderContinueWatching();
      if (state.kinoriumSection !== "all") {
        renderCatalogShelves();
      } else {
        loadCatalog();
      }
    };
  });

  // Service filter bar
  document.querySelectorAll(".atv-pill").forEach((btn) => {
    btn.onclick = () => {
      state.providerFilter = btn.dataset.provider;
      document.querySelectorAll(".atv-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadCatalog();
    };
  });

  document.querySelectorAll(".source-tab").forEach((tab) => {
    tab.onclick = () => switchSourceTab(tab.dataset.tab);
  });

  document.querySelectorAll("#settings-tabs .settings-tab").forEach((tab) => {
    tab.onclick = () => switchSettingsTab(tab.dataset.stab);
  });

  const subSizeSelect = document.getElementById("select-sub-size");
  if (subSizeSelect) {
    subSizeSelect.onchange = (e) => {
      const val = e.target.value || "medium";
      applySubtitleStylePrefs(val, state.subBg);
      savePlayerPrefs({ subSize: val });
      showToast(t("Размер шрифта субтитров обновлён", "Subtitle font size updated"));
    };
  }

  const subBgSelect = document.getElementById("select-sub-bg");
  if (subBgSelect) {
    subBgSelect.onchange = (e) => {
      const val = e.target.value || "semi";
      applySubtitleStylePrefs(state.subSize, val);
      savePlayerPrefs({ subBg: val });
      showToast(t("Оформление подложки субтитров обновлено", "Subtitle background style updated"));
    };
  }

  const ambilightToggle = document.getElementById("ambilight-toggle");
  if (ambilightToggle) {
    ambilightToggle.onchange = (e) => {
      state.ambilightEnabled = Boolean(e.target.checked);
      savePlayerPrefs({ ambilightEnabled: state.ambilightEnabled });
      if (state.ambilightEnabled) {
        startAmbilightLoop();
        showToast(t("Динамическая подсветка Ambilight включена", "Dynamic Ambilight glow enabled"));
      } else {
        stopAmbilightLoop(true);
        showToast(t("Подсветка Ambilight выключена", "Ambilight glow disabled"));
      }
    };
  }

  document.getElementById("select-studio").onchange = (e) => {
    if (
      (state.activeSourceTab === "backup4k" || state.activeSourceTab === "stremio") &&
      state.remuxMeta?.active
    ) {
      switchRemuxAudioTrack(parseInt(e.target.value, 10) || 0);
      return;
    }
    state.activeStudioId = e.target.value;
    const selectedOpt = e.target.options?.[e.target.selectedIndex];
    const studioName = selectedOpt ? selectedOpt.textContent : state.activeStudioName;
    const rawStudioName = selectedOpt?.dataset?.rawName || studioName;
    state.activeStudioName = studioName;
    if (selectedOpt && selectedOpt.dataset.isOriginal !== "1") {
      state.lastNonOriginalStudioId = String(state.activeStudioId);
    }
    if (state.activeItem) {
      savePreferredStudioForItem(state.activeItem, state.activeStudioId, rawStudioName);
      showToast(t(`Озвучка сохранена: ${studioName}`, `Audio track saved: ${studioName}`));
    }
    const video = document.getElementById("native-video");
    const { cur } = getEffectivePlaybackTiming(video);
    loadHDRezkaStream(cur || 0);
  };

  const seasonSelectEl = document.getElementById("select-season");
  if (seasonSelectEl) {
    seasonSelectEl.onchange = async (e) => {
      clearAutoplayNextTimer();
      state.autoplayCancelledThisEpisode = false;
      state.activeSeason = parseInt(e.target.value, 10) || 1;
      const effMap = resolveEffectiveSeasonsMap(state.activeItem, state.seasonsMap);
      const epsForSeason = effMap?.[String(state.activeSeason)];
      state.activeEpisode = Array.isArray(epsForSeason) && epsForSeason.length > 0 ? epsForSeason[0] : 1;
      if (state.activeItem) {
        populateSeasonEpisodeSelectors(state.activeItem, effMap);
      }
      updateMiniPlayerTitle();
      const savedEpProg = getEpisodeProgress(state.activeItem, state.activeSeason, state.activeEpisode);
      const startSec =
        savedEpProg && savedEpProg.current_time > 10 && savedEpProg.pct < 92
          ? savedEpProg.current_time
          : 0;
      if (state.activeSourceTab === "stremio") {
        await loadStremioStreams(startSec);
      } else if (state.activeSourceTab === "backup4k") {
        await loadBackup4KReleases(startSec);
      } else {
        await loadHDRezkaStream(startSec);
      }
      await loadSkipIntroSegments();
    };
  }

  const btnPrevEp = document.getElementById("btn-prev-ep");
  if (btnPrevEp) {
    btnPrevEp.onclick = () => stepEpisode(-1);
  }
  const btnNextEp = document.getElementById("btn-next-ep");
  if (btnNextEp) {
    btnNextEp.onclick = () => stepEpisode(1);
  }

  document.getElementById("select-quality").onchange = (e) => {
    const qKey = e.target.value;
    const url = state.qualities[qKey];
    const video = document.getElementById("native-video");
    savePlayerPrefs({ preferredQuality: qKey });
    if (url) {
      const { cur } = getEffectivePlaybackTiming(video);
      if (state.remuxMeta?.active) {
        playVideoUrl(url, 0, state.playerSessionId, { keepRemuxMeta: true, newRemuxOffsetSec: cur });
      } else {
        playVideoUrl(url, cur || 0, state.playerSessionId);
      }
      showToast(t(`Качество сохранено по умолчанию: ${qKey}`, `Default quality saved: ${qKey}`));
    }
  };

  const speedSelect = document.getElementById("select-speed");
  if (speedSelect) {
    speedSelect.onchange = (e) => {
      const rate = parseFloat(e.target.value) || 1.0;
      const video = document.getElementById("native-video");
      if (video) {
        video.playbackRate = rate;
      }
      savePlayerPrefs({ playbackRate: rate });
      updatePlayerGearActiveDot();
      showToast(t(`Скорость: ${rate}x`, `Speed: ${rate}x`));
    };
  }

  const audioBoostSelect = document.getElementById("select-audio-boost");
  if (audioBoostSelect) {
    audioBoostSelect.onchange = (e) => {
      const boost = parseFloat(e.target.value) || 1.0;
      const video = document.getElementById("native-video");
      applyAudioBoostToVideo(video, boost, state.audioPreset);
      savePlayerPrefs({ audioBoost: boost });
      showToast(
        boost > 1
          ? t(`Усиление звука: ${Math.round(boost * 100)}%`, `Audio Boost: ${Math.round(boost * 100)}%`)
          : t("Усиление звука: 100% (Стандарт)", "Audio Boost: 100% (Standard)")
      );
    };
  }

  const audioEqSelect = document.getElementById("select-audio-eq");
  if (audioEqSelect) {
    audioEqSelect.onchange = (e) => {
      const preset = e.target.value || "flat";
      const video = document.getElementById("native-video");
      applyAudioBoostToVideo(video, state.audioBoost, preset);
      savePlayerPrefs({ audioPreset: preset });
      showToast(t(`Режим звука: ${getAudioPresetLabel(preset)}`, `Audio mode: ${getAudioPresetLabel(preset)}`));
    };
  }

  const subSelect = document.getElementById("select-subtitle");
  if (subSelect) {
    subSelect.onchange = (e) => {
      state.activeSubtitleIndex = parseInt(e.target.value, 10);
      activateSelectedSubtitleTrack();
      syncCustomControlPopovers();
      const chosenSub = state.subtitles[state.activeSubtitleIndex];
      savePlayerPrefs({ preferredSubtitleLang: chosenSub ? chosenSub.lang : "off" });
      updatePlayerGearActiveDot();
      showToast(
        chosenSub
          ? t(`Субтитры по умолчанию: ${chosenSub.lang}`, `Default subtitles: ${chosenSub.lang}`)
          : t("Субтитры выключены", "Subtitles off")
      );
    };
  }

  const downloadBtn = document.getElementById("btn-download-stream");
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      if (!state.activeItem) return;
      const item = state.activeItem;
      const itemTitle = displayTitle(item) || item.title;
      const qualSel = document.getElementById("select-quality");
      const qKey = qualSel?.value || "1080p";
      const epTag =
        item.media_type === "series"
          ? ` - S${String(state.activeSeason).padStart(2, "0")}E${String(state.activeEpisode).padStart(2, "0")}`
          : ` (${item.year || 2024})`;
      if (state.remuxMeta?.active && state.remuxMeta.rawSourceUrl) {
        const mkvFilename = `${itemTitle}${epTag} [${qKey}, ${state.activeStudioName || "Original"}].mkv`;
        const a = document.createElement("a");
        a.href = state.remuxMeta.rawSourceUrl;
        a.download = mkvFilename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast(t(`Начато скачивание: ${mkvFilename}`, `Download started: ${mkvFilename}`));
        return;
      }
      const streamUrl = state.qualities[qKey] || state.currentStreamUrl;
      if (!streamUrl || streamUrl.includes(".m3u8") || !/^https?:\/\//i.test(streamUrl)) {
        showToast(
          t(
            "Прямой поток загружается — подождите пару секунд и нажмите снова",
            "Direct stream is loading — wait a couple of seconds and try again"
          )
        );
        return;
      }
      if (state.activeSourceTab === "stremio" || state.activeSourceTab === "backup4k") {
        const ext = /\.mp4(\?|$)/i.test(streamUrl) ? "mp4" : "mkv";
        const directName = `${itemTitle}${epTag} [${state.activeStudioName || state.activeSourceTab}].${ext}`;
        const a = document.createElement("a");
        a.href = streamUrl;
        a.download = directName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast(t(`Начато скачивание: ${directName}`, `Download started: ${directName}`));
        return;
      }
      const filename = `${itemTitle}${epTag} [${qKey}, ${state.activeStudioName || "HDRezka"}].mp4`;
      const dlEndpoint = `/api/download-mp4?url=${encodeURIComponent(streamUrl)}&filename=${encodeURIComponent(filename)}`;
      const a = document.createElement("a");
      a.href = dlEndpoint;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast(t(`Начато скачивание: ${filename}`, `Download started: ${filename}`));
    };
  }

  const btnTrailerRu = document.getElementById("btn-trailer-ru");
  if (btnTrailerRu) {
    btnTrailerRu.onclick = () => renderTrailerEmbed("ru");
  }
  const btnTrailerEn = document.getElementById("btn-trailer-en");
  if (btnTrailerEn) {
    btnTrailerEn.onclick = () => renderTrailerEmbed("en");
  }

  const autoIntroToggle = document.getElementById("auto-skip-intro-toggle");
  if (autoIntroToggle) {
    autoIntroToggle.checked = Boolean(state.autoSkipIntro);
    autoIntroToggle.onchange = (e) => {
      state.autoSkipIntro = Boolean(e.target.checked);
      state.introSkippedThisEpisode = false;
      savePlayerPrefs({ autoSkipIntro: state.autoSkipIntro });
      updatePlayerGearActiveDot();
    };
  }

  const autoNextToggle = document.getElementById("auto-next-ep-toggle");
  if (autoNextToggle) {
    autoNextToggle.checked = Boolean(state.autoNextEpisode);
    autoNextToggle.onchange = (e) => {
      state.autoNextEpisode = Boolean(e.target.checked);
      savePlayerPrefs({ autoNextEpisode: state.autoNextEpisode });
      if (!state.autoNextEpisode) {
        clearAutoplayNextTimer();
      }
      showToast(
        state.autoNextEpisode
          ? t("Автопереход на следующую серию включен", "Auto-play next episode enabled")
          : t("Автопереход на следующую серию выключен", "Auto-play next episode disabled")
      );
    };
  }

  const getActiveItemMetaPayload = () => ({
    id: state.activeItem.id,
    title: state.activeItem.title,
    orig_title: state.activeItem.orig_title,
    poster: state.activeItem.poster,
    backdrop: state.activeItem.backdrop,
    year: state.activeItem.year,
    media_type: state.activeItem.media_type,
    rezka_id: state.activeItem.rezka_id,
    rezka_url: state.activeItem.rezka_url,
    is_series_completed: resolveSeriesCompletedFlag(state.activeItem),
  });

  const watchingBtn = document.getElementById("btn-toggle-watching");
  if (watchingBtn) {
    watchingBtn.onclick = () => {
      if (!state.activeItem) return;
      document.getElementById("kinorium-status-popover")?.classList.add("hidden");
      withKinoriumActionLock(`pl-watching:${state.activeItem.id}`, watchingBtn, async () => {
        const res = await fetch("/api/kinorium/watching", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(getActiveItemMetaPayload()),
        });
        const kStatus = await res.json();
        state.activeItem.kinorium = kStatus;
        updateModalKinoriumHeader(kStatus);
        patchCatalogItemKinoriumInPlace(state.activeItem, kStatus);
      });
    };
  }

  const plWatchedBtn = document.getElementById("btn-toggle-watched");
  if (plWatchedBtn) {
    plWatchedBtn.onclick = () => {
      if (!state.activeItem) return;
      document.getElementById("kinorium-status-popover")?.classList.add("hidden");
      withKinoriumActionLock(`pl-watched:${state.activeItem.id}`, plWatchedBtn, async () => {
        const curWatched = Boolean(state.activeItem.kinorium?.watched);
        const res = await fetch("/api/kinorium/watched", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...getActiveItemMetaPayload(),
            watched: !curWatched,
            season: state.activeSeason,
            episode: state.activeEpisode,
          }),
        });
        const kStatus = await res.json();
        state.activeItem.kinorium = kStatus;
        updateModalKinoriumHeader(kStatus);
        if (state.activeItem.media_type === "series") {
          populateSeasonEpisodeSelectors(
            state.activeItem,
            resolveEffectiveSeasonsMap(state.activeItem, state.seasonsMap)
          );
        }
        patchCatalogItemKinoriumInPlace(state.activeItem, kStatus);
      });
    };
  }

  const postwatchOverlayEl = document.getElementById("kinorium-postwatch-overlay");
  if (postwatchOverlayEl) {
    postwatchOverlayEl.addEventListener("mouseenter", () => {
      state.postwatchHovered = true;
    });
    postwatchOverlayEl.addEventListener("mouseleave", () => {
      state.postwatchHovered = false;
    });
  }

  document.getElementById("btn-open-rate").onclick = (e) => {
    e.stopPropagation();
    const scope = state.activeItem?.media_type === "series" ? "series" : "movie";
    if (
      postwatchOverlayEl &&
      !postwatchOverlayEl.classList.contains("hidden") &&
      state.postwatchAnchor === "header" &&
      state.postwatchScope === scope
    ) {
      state.postwatchManual = false;
      state.postwatchHovered = false;
      postwatchOverlayEl.classList.add("hidden");
      return;
    }
    openPostWatchRatingOverlay(scope, state.activeSeason, state.activeEpisode, true, "header");
  };
  const epWatchToggleBtn = document.getElementById("btn-toggle-current-ep");
  if (epWatchToggleBtn) {
    epWatchToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!state.activeItem) return;
      withKinoriumActionLock(
        `pl-ep-watch:${state.activeItem.id}:s${state.activeSeason}e${state.activeEpisode}`,
        epWatchToggleBtn,
        async () => {
          await toggleCurrentEpisodeWatched();
        }
      );
    });
  }
  document.getElementById("btn-rate-current-ep")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (
      postwatchOverlayEl &&
      !postwatchOverlayEl.classList.contains("hidden") &&
      state.postwatchAnchor === "epbar" &&
      state.postwatchScope === "episode"
    ) {
      state.postwatchManual = false;
      state.postwatchHovered = false;
      postwatchOverlayEl.classList.add("hidden");
      return;
    }
    openPostWatchRatingOverlay("episode", state.activeSeason, state.activeEpisode, true, "epbar");
  });
  document.getElementById("postwatch-scope-ep")?.addEventListener("click", () => {
    state.postwatchScope = "episode";
    renderPostWatchRatingState();
  });
  document.getElementById("postwatch-scope-series")?.addEventListener("click", () => {
    state.postwatchScope = "series";
    renderPostWatchRatingState();
  });

  const plWatchlistBtn = document.getElementById("btn-toggle-watchlist");
  if (plWatchlistBtn) {
    plWatchlistBtn.onclick = () => {
      if (!state.activeItem) return;
      document.getElementById("kinorium-status-popover")?.classList.add("hidden");
      withKinoriumActionLock(`pl-watchlist:${state.activeItem.id}`, plWatchlistBtn, async () => {
        const res = await fetch("/api/kinorium/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(getActiveItemMetaPayload()),
        });
        const kStatus = await res.json();
        state.activeItem.kinorium = kStatus;
        updateModalKinoriumHeader(kStatus);
        if (state.activeItem.media_type === "series") {
          populateSeasonEpisodeSelectors(
            state.activeItem,
            resolveEffectiveSeasonsMap(state.activeItem, state.seasonsMap)
          );
        }
        patchCatalogItemKinoriumInPlace(state.activeItem, kStatus);
      });
    };
  }

  const neverBtn = document.getElementById("btn-toggle-never");
  if (neverBtn) {
    neverBtn.onclick = () => {
      if (!state.activeItem) return;
      document.getElementById("kinorium-status-popover")?.classList.add("hidden");
      withKinoriumActionLock(`pl-never:${state.activeItem.id}`, neverBtn, async () => {
        const res = await fetch("/api/kinorium/never", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(getActiveItemMetaPayload()),
        });
        const kStatus = await res.json();
        state.activeItem.kinorium = kStatus;
        updateModalKinoriumHeader(kStatus);
        patchCatalogItemKinoriumInPlace(state.activeItem, kStatus);
      });
    };
  }

  const postwatchStarsWrap = document.getElementById("postwatch-stars");
  bindStarsHoverRange(postwatchStarsWrap);
  document.querySelectorAll("#postwatch-stars button").forEach((btn) => {
    btn.onclick = () => {
      if (!state.activeItem) return;
      withKinoriumActionLock(`pl-rate:${state.activeItem.id}`, postwatchStarsWrap || btn, async () => {
        const score = parseInt(btn.dataset.score, 10);
        const comment = document.getElementById("postwatch-comment").value;
        const isEpisodeScope =
          state.activeItem.media_type === "series" && state.postwatchScope === "episode";

        if (isEpisodeScope) {
          const sNum = state.postwatchSeason || state.activeSeason || 1;
          const eNum = state.postwatchEpisode || state.activeEpisode || 1;
          const epMeta = getEpisodeDisplayMeta(sNum, eNum);
          const effMap = resolveEffectiveSeasonsMap(state.activeItem, state.seasonsMap);
          const sKeys = Object.keys(effMap || {})
            .map((k) => parseInt(k, 10))
            .filter((n) => !Number.isNaN(n));
          const totalSeasons = sKeys.length > 0 ? Math.max(...sKeys) : 0;
          const sEps = effMap?.[String(sNum)];
          const totalEpsInSeason = Array.isArray(sEps) && sEps.length > 0 ? Math.max(...sEps) : 0;
          const res = await fetch("/api/kinorium/rate-episode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...getActiveItemMetaPayload(),
              season: sNum,
              episode: eNum,
              episode_title: epMeta.realTitle || "",
              total_seasons: totalSeasons,
              total_episodes_in_season: totalEpsInSeason,
              is_series_completed: resolveSeriesCompletedFlag(state.activeItem),
              score: score,
              comment: comment,
            }),
          });
          const kStatus = await res.json();
          state.activeItem.kinorium = kStatus;
          state.catalogDirty = true;
          if (kStatus.kinorium_counts) {
            state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
            updateKinoriumSectionCounters();
          }
          updateModalKinoriumHeader(kStatus);
          populateSeasonEpisodeSelectors(state.activeItem, effMap);
          updateCurrentEpisodeBar(state.activeItem, state.activeSeason, state.activeEpisode, false);
          state.postwatchManual = false;
          state.postwatchHovered = false;
          document.getElementById("kinorium-postwatch-overlay").classList.add("hidden");
          const epKinSuffix = kStatus.remote_synced ? t(" в Kinorium", " on Kinorium") : "";
          if (kStatus.auto_completed_series) {
            state.scrobbledThisSession = true;
            refreshOpenPersonModalUI();
            showToast(
              t(
                `Оценка (${score}/10) сохранена${epKinSuffix} · финал просмотрен, статус изменён на «Просмотрено»`,
                `Rating (${score}/10) saved${epKinSuffix} · series finale watched, marked as Watched`
              )
            );
          } else {
            showToast(
              t(
                `Оценка (${score}/10) сохранена${epKinSuffix} · Сезон ${sNum}, Серия ${eNum}`,
                `Rating (${score}/10) saved${epKinSuffix} · Season ${sNum}, Episode ${eNum}`
              )
            );
          }
          return;
        }

        const res = await fetch("/api/kinorium/rate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...getActiveItemMetaPayload(),
            score: score,
            comment: comment,
          }),
        });
        const kStatus = await res.json();
        state.activeItem.kinorium = kStatus;
        if (kStatus.kinorium_counts) {
          state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
          updateKinoriumSectionCounters();
        }
        updateModalKinoriumHeader(kStatus);
        state.postwatchManual = false;
        state.postwatchHovered = false;
        document.getElementById("kinorium-postwatch-overlay").classList.add("hidden");
        patchCatalogItemKinoriumInPlace(state.activeItem, kStatus);
        showToast(t(`Оценка ${score}/10 сохранена в Kinorium`, `Rating ${score}/10 saved on Kinorium`));
      });
    };
  });

  const postwatchClearBtn = document.getElementById("postwatch-clear-rate-btn");
  if (postwatchClearBtn) {
    postwatchClearBtn.onclick = () => {
      if (!state.activeItem) return;
      withKinoriumActionLock(`pl-rate:${state.activeItem.id}`, postwatchClearBtn, async () => {
        const isEpisodeScope =
          state.activeItem.media_type === "series" && state.postwatchScope === "episode";
        if (isEpisodeScope) {
          const sNum = state.postwatchSeason || state.activeSeason || 1;
          const eNum = state.postwatchEpisode || state.activeEpisode || 1;
          const effMap = resolveEffectiveSeasonsMap(state.activeItem, state.seasonsMap);
          const res = await fetch("/api/kinorium/rate-episode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...getActiveItemMetaPayload(),
              season: sNum,
              episode: eNum,
              score: 0,
              clear: true,
            }),
          });
          const kStatus = await res.json();
          state.activeItem.kinorium = kStatus;
          state.catalogDirty = true;
          if (kStatus.kinorium_counts) {
            state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
            updateKinoriumSectionCounters();
          }
          updateModalKinoriumHeader(kStatus);
          populateSeasonEpisodeSelectors(state.activeItem, effMap);
          updateCurrentEpisodeBar(state.activeItem, state.activeSeason, state.activeEpisode, false);
          renderPostWatchRatingState();
          showToast(
            t(
              `Оценка удалена · Сезон ${sNum}, Серия ${eNum}`,
              `Rating removed · Season ${sNum}, Episode ${eNum}`
            )
          );
          return;
        }
        const res = await fetch("/api/kinorium/rate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...getActiveItemMetaPayload(),
            score: 0,
            clear: true,
          }),
        });
        const kStatus = await res.json();
        state.activeItem.kinorium = kStatus;
        if (kStatus.kinorium_counts) {
          state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
          updateKinoriumSectionCounters();
        }
        updateModalKinoriumHeader(kStatus);
        renderPostWatchRatingState();
        patchCatalogItemKinoriumInPlace(state.activeItem, kStatus);
        showToast(t("Оценка удалена в Kinorium", "Rating removed on Kinorium"));
      });
    };
  }

  document.getElementById("close-postwatch-btn").onclick = () => {
    state.postwatchManual = false;
    state.postwatchHovered = false;
    document.getElementById("kinorium-postwatch-overlay").classList.add("hidden");
  };

  document.getElementById("close-player-modal").onclick = () => closePlayerModal(false);
  document.getElementById("player-modal").addEventListener("click", (e) => {
    if (e.target.id === "player-modal" && !state.isMiniPlayer) {
      closePlayerModal(false);
    }
  });

  // Person Profile & Filmography Modal listeners
  document.getElementById("person-back-nav-btn")?.addEventListener("click", () => goBackInModalStack());
  document.getElementById("close-person-modal")?.addEventListener("click", () =>
    closePersonModal({ clearStack: true })
  );
  document.getElementById("person-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "person-modal") {
      closePersonModal({ clearStack: true });
    }
  });

  // Floating Scroll-to-Top button + scroll listener
  const scrollTopBtn = document.getElementById("scroll-top-btn");
  if (scrollTopBtn) {
    scrollTopBtn.onclick = () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
  }
  let scrollRafPending = false;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollRafPending) return;
      scrollRafPending = true;
      requestAnimationFrame(() => {
        scrollRafPending = false;
        syncScrollTopButton();
      });
    },
    { passive: true }
  );
  syncScrollTopButton();

  document.querySelectorAll("#stremio-filter-pills .atv-stremio-filter-pill").forEach((pill) => {
    pill.onclick = () => {
      state.stremioFilter = pill.dataset.sfilter || "all";
      document.querySelectorAll("#stremio-filter-pills .atv-stremio-filter-pill").forEach((b) => {
        b.classList.toggle("active", b === pill);
      });
      if (state.stremioStreamsData) {
        const video = document.getElementById("native-video");
        const { cur } = getEffectivePlaybackTiming(video);
        renderStremioStreamsList(cur > 5 ? cur : 0, false);
      }
    };
  });

  document.getElementById("btn-open-stremio-addons")?.addEventListener("click", async () => {
    await openSettingsModal("network");
    setTimeout(() => {
      document.getElementById("net-group-stremio")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("cfg-stremio-manifest-input")?.focus();
    }, 60);
  });

  document.getElementById("btn-add-stremio-addon")?.addEventListener("click", () => {
    addStremioAddonFromInput();
  });
  document.getElementById("cfg-stremio-manifest-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addStremioAddonFromInput();
    }
  });

  document.getElementById("cfg-lan-toggle")?.addEventListener("change", (e) => {
    toggleLanAccess(Boolean(e.target.checked));
  });
  document.getElementById("cfg-autostart-toggle")?.addEventListener("change", (e) => {
    toggleMacosAutostart(Boolean(e.target.checked));
  });
  document.getElementById("btn-copy-lan-url")?.addEventListener("click", async () => {
    const urlText = state.systemStatus?.lan_url || document.getElementById("lan-url-code")?.textContent || "";
    if (!urlText) return;
    try {
      await navigator.clipboard.writeText(urlText);
      showToast(t(`Адрес скопирован: ${urlText}`, `Copied URL: ${urlText}`));
    } catch (_) {}
  });

  async function requestCloseSettingsModal() {
    const settingsModEl = document.getElementById("settings-modal");
    if (!settingsModEl || settingsModEl.classList.contains("hidden")) return;
    if (isNetworkSettingsDirty()) {
      const discard = await showConfirmModal({
        title: t("Несохраненные изменения", "Unsaved changes"),
        message: t(
          "Вы изменили настройки, но еще не нажали «Сохранить изменения». Закрыть без сохранения?",
          "You have unsaved settings changes. Close without saving?"
        ),
        confirmLabel: t("Закрыть без сохранения", "Discard & Close"),
        cancelLabel: t("Остаться", "Keep Editing"),
        danger: true,
      });
      if (!discard) return;
    }
    settingsModEl.classList.add("hidden");
    syncScrollTopButton();
  }

  document.getElementById("open-settings-btn").onclick = () => openSettingsModal("integrations");
  document.getElementById("close-settings-modal").onclick = () => {
    requestCloseSettingsModal();
  };
  document.getElementById("settings-modal").addEventListener("click", (e) => {
    if (e.target.id === "settings-modal") {
      requestCloseSettingsModal();
    }
  });

  [
    "cfg-spoof-region",
    "cfg-custom-mirror",
    "cfg-proxy-url",
    "cfg-backup-mode",
    "cfg-torrserver-url",
    "cfg-debrid-key",
  ].forEach((fieldId) => {
    const fieldEl = document.getElementById(fieldId);
    if (!fieldEl) return;
    fieldEl.addEventListener("input", () => syncSettingsFooterUI());
    fieldEl.addEventListener("change", () => {
      if (fieldId === "cfg-backup-mode" && (fieldEl.value === "realdebrid" || fieldEl.value === "torbox")) {
        const details4k = document.getElementById("details-net-4k");
        if (details4k) details4k.open = true;
      }
      syncSettingsFooterUI();
    });
  });

  document.getElementById("save-settings-btn").onclick = async () => {
    if (!isNetworkSettingsDirty()) {
      document.getElementById("settings-modal").classList.add("hidden");
      syncScrollTopButton();
      return;
    }
    const kinDirty = isKinoriumQuickFormDirty();
    const spoofRegion = document.getElementById("cfg-spoof-region").value;
    const kinQuickUser = (document.getElementById("kin-quick-user-input")?.value || "").trim();
    const kinQuickCookie = (document.getElementById("kin-quick-cookie-input")?.value || "").trim();
    const debridKeyVal = (document.getElementById("cfg-debrid-key")?.value || "").trim();
    const payload = {
      hdrezka: {
        spoof_region: spoofRegion,
        custom_mirror: document.getElementById("cfg-custom-mirror").value,
        proxy_url: document.getElementById("cfg-proxy-url").value,
      },
      backup_stream: {
        mode: document.getElementById("cfg-backup-mode").value,
        torrserver_url: document.getElementById("cfg-torrserver-url").value,
        ...(debridKeyVal ? { debrid_api_key: debridKeyVal } : {}),
      },
    };
    if (isServiceEnabled("kinorium") && (kinQuickUser || kinQuickCookie)) {
      payload.kinorium = {
        username: kinQuickUser,
        session_cookie: kinQuickCookie,
        auto_scrobble_threshold: 0.85,
      };
    }
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.integrations) state.integrations = data.integrations;
    if (kinDirty && isServiceEnabled("kinorium") && kinQuickUser) {
      try {
        const syncPayload = { user_id: kinQuickUser };
        if (kinQuickCookie) syncPayload.session_cookie = kinQuickCookie;
        const syncRes = await fetch("/api/kinorium/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(syncPayload),
        });
        const syncData = await syncRes.json();
        if (syncData.kinorium_account) {
          state.kinoriumAccount = syncData.kinorium_account;
          updateKinoriumUserBadge();
        }
        if (syncData.integrations) state.integrations = syncData.integrations;
        if (!syncData.sync?.error) {
          state.kinoriumFormExpanded = false;
        }
      } catch (_) {}
    }
    const keyInput = document.getElementById("cfg-debrid-key");
    if (keyInput && debridKeyVal) {
      keyInput.value = "";
      keyInput.placeholder = t(
        "Ключ сохранён (оставьте пустым или введите новый)",
        "API key saved (leave blank or enter a new key)"
      );
    }
    state.settingsBaseline = getNetworkSettingsSnapshot();
    syncSettingsFooterUI();
    document.getElementById("settings-modal").classList.add("hidden");
    syncScrollTopButton();
    applyEnabledServicesVisibility();
    renderLoginBannerIfNeeded();
    loadCatalog();
    showToast(t("Настройки сохранены", "Settings saved"));
  };

  const quickExportBackupBtn = document.getElementById("btn-quick-export-backup");
  const handleExportBackup = async (btnEl) => {
    if (btnEl) btnEl.disabled = true;
    try {
      const payload = await buildFullBackupPayload();
      const jsonStr = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateStamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `cineflow-backup-${dateStamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      showToast(t("Резервная копия сохранена в файл JSON", "Backup saved to JSON file"));
    } catch (err) {
      console.error("Export backup error:", err);
      showToast(t("Ошибка при экспорте резервной копии", "Failed to export backup"));
    } finally {
      if (btnEl) btnEl.disabled = false;
    }
  };
  if (quickExportBackupBtn) {
    quickExportBackupBtn.onclick = () => handleExportBackup(quickExportBackupBtn);
  }

  const copyBackupClipboardBtn = document.getElementById("btn-copy-backup-clipboard");
  if (copyBackupClipboardBtn) {
    copyBackupClipboardBtn.onclick = async () => {
      copyBackupClipboardBtn.disabled = true;
      try {
        const payload = await buildFullBackupPayload();
        const jsonStr = JSON.stringify(payload, null, 2);
        await navigator.clipboard.writeText(jsonStr);
        showToast(t("Резервная копия скопирована в буфер обмена", "Backup copied to clipboard"));
      } catch (err) {
        showToast(
          t(
            "Не удалось скопировать в буфер — используйте «Скачать Backup (.json)»",
            'Could not copy to clipboard — use "Download Backup (.json)"'
          )
        );
      } finally {
        copyBackupClipboardBtn.disabled = false;
      }
    };
  }

  const pasteBackupClipboardBtn = document.getElementById("btn-paste-backup-clipboard");
  if (pasteBackupClipboardBtn) {
    pasteBackupClipboardBtn.onclick = async () => {
      pasteBackupClipboardBtn.disabled = true;
      try {
        const rawText = await navigator.clipboard.readText();
        const parsed = JSON.parse(rawText);
        await restoreFromBackupObject(parsed);
      } catch (err) {
        showToast(
          t(
            "В буфере обмена нет корректного JSON резервной копии CineFlow",
            "Clipboard does not contain a valid CineFlow backup JSON"
          )
        );
      } finally {
        pasteBackupClipboardBtn.disabled = false;
      }
    };
  }

  const quickImportBackupBtn = document.getElementById("btn-quick-import-backup");
  const importBackupInput = document.getElementById("input-import-backup");
  if (importBackupInput) {
    if (quickImportBackupBtn) {
      quickImportBackupBtn.onclick = () => importBackupInput.click();
    }
    importBackupInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (quickImportBackupBtn) quickImportBackupBtn.disabled = true;
      try {
        const rawText = await file.text();
        const parsed = JSON.parse(rawText);
        await restoreFromBackupObject(parsed);
      } catch (err) {
        console.error("Import backup error:", err);
        showToast(t("Не удалось прочитать JSON-файл резервной копии", "Failed to read backup JSON file"));
      } finally {
        if (quickImportBackupBtn) quickImportBackupBtn.disabled = false;
        importBackupInput.value = "";
      }
    };
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCineFlowApp);
} else {
  initCineFlowApp();
}
