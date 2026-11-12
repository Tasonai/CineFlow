import {
  CURATED_SHELVES_STORAGE_KEY,
  EP_VIEW_MODE_STORAGE_KEY,
  RECENT_SEARCHES_STORAGE_KEY,
  UI_PREFS_STORAGE_KEY,
  profileStorageKey,
  state,
} from "./js/state.js?v=20261112v3";
import {
  applyStaticDomTranslations,
  displayPoster,
  displayTitle,
  isEn,
  secondaryTitle,
  syncLanguageSegmentedControlUI,
  t,
} from "./js/i18n.js?v=20261112v3";
import {
  attachHorizontalWheelScroll,
  clampFloatingPopover,
  clampStagePopover,
  closeConfirmModal,
  closeCustomSelectMenu,
  closeFloatingPopovers,
  copyTextToClipboard,
  escapeAttr,
  escapeHtml,
  formatTime,
  getEpisodeProgress,
  getSeenNotificationsSet,
  getUiPrefs,
  iconSvg,
  initCustomSelects,
  isCustomSelectMenuOpen,
  isIosOrIpadOs,
  logDebug,
  restoreModalTriggerFocus,
  saveSeenNotificationsSet,
  saveUiPrefs,
  showConfirmModal,
  showToast,
  showVideoOsd,
  supportsNativePiP,
  syncAllCustomSelects,
  syncScrollTopButton,
  syncSearchInputHasQueryUI,
  trapModalTabKey,
  triggerVideoCenterIndicator,
  withKinoriumActionLock,
} from "./js/utils.js?v=20261112v3";
import {
  applyAudioBoostToVideo,
  applySubtitleStylePrefs,
  applyVideoCropToVideo,
  ensurePreservesPitch,
  getAudioPresetLabel,
  getPlayerPrefs,
  getVideoCropLabel,
  isVideoInPiP,
  savePlayerPrefs,
  startAmbilightLoop,
  stopAmbilightLoop,
  togglePictureInPicture,
  updatePlayerGearActiveDot,
} from "./js/audio-dsp.js?v=20261112v3";
import {
  applyEnabledServicesVisibility,
  attachSmartPosterFallback,
  checkLiveRezkaSeriesUpdates,
  closeCardContextMenu,
  closeCommandPalette,
  closeMovieRouletteModal,
  collectNewEpisodeNotifications,
  getCurrentlyFilteredItems,
  getDefaultPlayableSourceTab,
  initCatalogToolbarAndFilterBindings,
  initCommandPalette,
  initMovieRouletteModal,
  isEpisodeWatched,
  isServiceEnabled,
  loadAndRenderReleaseCalendar,
  loadCatalog,
  openCommandPalette,
  openMovieRouletteModal,
  patchCatalogItemKinoriumInPlace,
  renderCatalogShelves,
  renderContinueWatching,
  renderLoginBannerIfNeeded,
  renderNotificationsBell,
  rerollCatalogLaunchSeed,
  resolveSeriesEpisodeInfo,
  savePreferredStudioForItem,
  startBackgroundDigestPolling,
  startHeroAutoTimer,
  stepHeroSlide,
  switchNotificationsTab,
  updateActiveFiltersBadge,
  updateKinoriumSectionCounters,
  updateKinoriumUserBadge,
} from "./js/catalog.js?v=20261112v3";
import {
  buildFallbackAvatarSvg,
  closePersonModal,
  closeQuickPeekModal,
  closeStatsModal,
  goBackInModalStack,
  openPersonModal,
  openQuickPeekModal,
  openStatsModal,
  refreshOpenPersonModalUI,
  switchStatsModalTab,
  initQuickPeekBindings,
  syncQuickPeekStatusesUI,
} from "./js/modals.js?v=20261112v3";
import {
  activateSelectedSubtitleTrack,
  adjustAudioOffset,
  buildRemuxStreamEndpoint,
  captureVideoScreenshot,
  clearAutoplayNextTimer,
  closeAllVcPopovers,
  closePlayerModal,
  dismissPlayerNextEpisodeToast,
  getEffectivePlaybackTiming,
  getEpisodeDisplayMeta,
  getNextEpisodeCoords,
  hasOpenVcPopover,
  hasStartedWatchingCurrentEpisode,
  hideVideoStreamError,
  hideXRayPauseShelf,
  initPlayerStageAndGearBindings,
  initPlayerStatusAndRatingBindings,
  isStageFullscreen,
  loadBackup4KReleases,
  loadHDRezkaStream,
  loadOfflineStreamForActiveTitle,
  loadSkipIntroSegments,
  loadStremioStreams,
  markEpisodesBatch,
  markOutgoingEpisodeWatched,
  openPlayerModal,
  openPostWatchRatingOverlay,
  playVideoUrl,
  populateSeasonEpisodeSelectors,
  recoverFrozenVideoPlayback,
  renderPostWatchRatingState,
  renderStremioStreamsList,
  renderTrailerEmbed,
  resetAudioOffset,
  resetVideoElementForStreamChange,
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
  syncVcPopoverOpenClass,
  switchHdRezkaStudio,
  toggleBookmarkCurrentMoment,
  toggleCurrentEpisodeWatched,
  toggleErrorStudiosPanel,
  togglePlayerSidebarCollapsed,
  toggleQuickOriginalAudio,
  toggleStageFullscreen,
  toggleVideoPlayPause,
  updateCurrentEpisodeBar,
  updateMiniPlayerTitle,
  updateModalKinoriumHeader,
  wakeVideoControls,
} from "./js/player.js?v=20261112v3";
import {
  adjustSubtitleOffset,
  bindSubtitleFileAndDropListeners,
  closeSubtitleDictPopover,
  resetSubtitleOffset,
  syncSubtitleOffsetUI,
} from "./js/subtitles.js?v=20261112v3";
import {
  initDesktopRemoteAgent,
  initMobileRemoteController,
  isMobileRemoteUrl,
  pushDesktopRemoteStateNow,
} from "./js/remote.js?v=20261112v3";
import {
  applyAppLanguage,
  checkAppUpdates,
  closeOnboardingModal,
  initSettingsAndBackupBindings,
  openOnboardingModal,
  openSettingsModal,
  renderAppUpdaterUI,
  renderOnboardingModalUI,
  renderSettingsCountryUI,
  requestCloseSettingsModal,
  switchSettingsTab,
} from "./js/settings.js?v=20261112v3";
import {
  initBookmarksListeners,
  openBookmarksModal,
} from "./js/player-bookmarks.js?v=20261112v3";
import {
  applyPendingTvDeepLinkIfReady,
  applyProfilesPayload,
  closeDownloadsModal,
  closeKidsPinModal,
  closePlayerHandoffModal,
  closeProfilePopover,
  closeProfilesModal,
  closeTvCastModal,
  handleTvSpatialKeydown,
  initRoadmapFeatures,
  reloadProfileLocalPlayerPrefs,
  renderHeaderProfileSwitcher,
} from "./js/features.js?v=20261112v3";
import { openDownloadsModal, setOfflineMode } from "./js/features-downloads.js?v=20261112v3";
import {
  initCatalogLiveSearch,
  closeLiveSearchPopover,
  resetCatalogFiltersForGlobalSearch,
  syncSearchClearButton,
} from "./js/catalog-live-search.js?v=20261112v3";
import { initGlobalHotkeys } from "./js/app-hotkeys.js?v=20261112v3";

function initVelariumApp() {
  document.documentElement.classList.toggle("is-ios-device", isIosOrIpadOs());
  document.documentElement.classList.toggle(
    "is-windows",
    typeof navigator !== "undefined" && /Win/i.test(navigator.platform || navigator.userAgent || ""),
  );
  if (isMobileRemoteUrl()) {
    const remoteUi = getUiPrefs();
    const bootAttrLang = String(document.documentElement.dataset?.bootLang || "").trim().toLowerCase();
    let urlLang = "";
    try {
      const qs = new URLSearchParams(window.location.search || "");
      const rawLang = String(qs.get("lang") || "").trim().toLowerCase();
      if (rawLang === "en" || rawLang === "ru") {
        urlLang = rawLang;
      }
    } catch (err) { window.logDebug?.("App", err); }
    if (urlLang === "en" || urlLang === "ru") {
      state.appLang = urlLang;
    } else if (bootAttrLang === "en" || bootAttrLang === "ru") {
      state.appLang = bootAttrLang;
    } else if (remoteUi.appLang === "en" || remoteUi.appLang === "ru") {
      state.appLang = remoteUi.appLang;
    }
    document.documentElement.lang = state.appLang === "en" ? "en" : "ru";
    applyStaticDomTranslations();
    syncLanguageSegmentedControlUI();
    initMobileRemoteController();
    return;
  }
  const initPrefs = getPlayerPrefs();
  const initUi = getUiPrefs();
  let hadLocalLangPref = false;
  try {
    const rawSavedUi = localStorage.getItem(UI_PREFS_STORAGE_KEY);
    const parsedSavedUi = rawSavedUi ? JSON.parse(rawSavedUi) : null;
    hadLocalLangPref = Boolean(parsedSavedUi && (parsedSavedUi.appLang === "en" || parsedSavedUi.appLang === "ru"));
  } catch (err) { window.logDebug?.("App", err); }
  state.autoNextEpisode = initPrefs.autoNextEpisode;
  state.audioBoost = initPrefs.audioBoost;
  state.audioPreset = initPrefs.audioPreset || "flat";
  state.videoCrop = initPrefs.videoCrop || "contain";
  state.subSize = initPrefs.subSize || "medium";
  state.subBg = initPrefs.subBg || "semi";
  state.subFont = initPrefs.subFont || "sans";
  state.subColor = initPrefs.subColor || "white";
  state.subEdge = initPrefs.subEdge || "soft";
  state.ambilightEnabled = initPrefs.ambilightEnabled !== false;
  state.autoSkipIntro = initPrefs.autoSkipIntro !== false;
  state.hideWatched = Boolean(initUi.hideWatched);
  applyStaticDomTranslations();
  syncLanguageSegmentedControlUI();
  initCustomSelects();
  initRoadmapFeatures();
  bindSubtitleFileAndDropListeners();
  syncSubtitleOffsetUI();
  initDesktopRemoteAgent();
  if (state.setupCompleted === false) {
    openOnboardingModal({ isFirstRun: true });
  }
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
  fetch(`/api/settings?lang=${encodeURIComponent(state.appLang || "ru")}`)
    .then((r) => r.json())
    .then((cfg) => {
      if (cfg?.system) {
        state.systemStatus = cfg.system;
        if (cfg.system.version) {
          state.appVersion = String(cfg.system.version);
          const verEl = document.getElementById("about-val-version");
          if (verEl) verEl.textContent = state.appVersion;
        }
        if (cfg.system.updater) {
          state.updaterStatus = cfg.system.updater;
        }
        renderAppUpdaterUI();
      }
      if (cfg?.integrations) {
        state.integrations = cfg.integrations;
      }
      if (cfg?.user_country) {
        state.userCountry = cfg.user_country;
      }
      if (cfg?.country_profile) {
        state.countryProfile = cfg.country_profile;
      }
      if (Array.isArray(cfg?.eu_countries)) {
        state.euCountries = cfg.eu_countries;
      }
      if (typeof cfg?.setup_completed === "boolean") {
        state.setupCompleted = cfg.setup_completed;
      }
      const prevProfId = state.activeProfileId;
      const prevKidsMode = Boolean(state.activeProfile?.kids_mode);
      if (cfg?.profiles) {
        applyProfilesPayload(cfg.profiles);
      }
      const profChangedOnBoot =
        state.activeProfileId !== prevProfId ||
        Boolean(state.activeProfile?.kids_mode) !== prevKidsMode;
      if (profChangedOnBoot) {
        reloadProfileLocalPlayerPrefs();
      }
      if (cfg?.kinorium) {
        const kUid = cfg.kinorium.user_id || "";
        let kDisp = cfg.kinorium.display_name || "";
        if (kUid === "51670" && (!kDisp || kDisp.startsWith("user_"))) {
          kDisp = "Andrei Crustillio";
        }
        state.kinoriumAccount = {
          user_id: kUid,
          display_name: kDisp,
          avatar_url: cfg.kinorium.avatar_url || "",
          profile_url: cfg.kinorium.profile_url || "",
          connected: Boolean(cfg.kinorium.connected && cfg.kinorium.user_id),
          has_session_cookie: Boolean(cfg.kinorium.has_session_cookie),
          cw_dismissed_count: Number(cfg.kinorium.cw_dismissed_count || 0),
        };
      }
      applyEnabledServicesVisibility();
      updateKinoriumUserBadge();
      renderHeaderProfileSwitcher();
      renderSettingsCountryUI();
      if (profChangedOnBoot) {
        state.calendarData = null;
        state.calendarDataProfileId = "";
        renderNotificationsBell();
        loadCatalog();
      } else if (Array.isArray(state.catalogItems) && state.catalogItems.length > 0) {
        renderCatalogShelves();
      }
      const srvLang = cfg?.app_lang === "en" ? "en" : "ru";
      const isCleanInstallBoot = cfg?.setup_completed === false;
      if ((isCleanInstallBoot || !hadLocalLangPref) && srvLang !== state.appLang) {
        applyAppLanguage(srvLang, { persistServer: false, announce: false });
      } else if (isCleanInstallBoot || (!hadLocalLangPref && srvLang === state.appLang)) {
        saveUiPrefs({ appLang: srvLang });
      } else if (hadLocalLangPref && srvLang !== state.appLang) {
        fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ app_lang: state.appLang }),
        }).catch(() => {});
      }
      if (isCleanInstallBoot) {
        const obMod = document.getElementById("onboarding-modal");
        if (obMod && !obMod.classList.contains("hidden")) {
          renderOnboardingModalUI();
        } else {
          openOnboardingModal({ isFirstRun: true });
        }
      } else if (
        !state.updaterAutoChecked &&
        cfg?.system?.auto_check_updates !== false &&
        cfg?.system?.is_local_client !== false &&
        (cfg?.system?.update_repo || cfg?.system?.update_manifest_url || cfg?.system?.updater?.update_repo || cfg?.system?.updater?.update_manifest_url || cfg?.system?.updater?.source_configured !== false)
      ) {
        state.updaterAutoChecked = true;
        setTimeout(() => {
          checkAppUpdates({ force: false, silent: true });
        }, 3500);
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
  applySubtitleStylePrefs(state.subSize, state.subBg, state.subFont, state.subColor, state.subEdge);
  syncAllCustomSelects();
  document.getElementById("btn-hide-watched")?.classList.toggle("active", state.hideWatched);
  updateActiveFiltersBadge();
  updatePlayerGearActiveDot();
  loadCatalog().then(() => applyPendingTvDeepLinkIfReady());
  setupVideoListeners();
  initBookmarksListeners();
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
  document.getElementById("notif-tab-updates")?.addEventListener("click", (e) => {
    e.stopPropagation();
    switchNotificationsTab("updates");
  });
  document.getElementById("notif-tab-calendar")?.addEventListener("click", (e) => {
    e.stopPropagation();
    switchNotificationsTab("calendar");
  });
  document.getElementById("notifications-tabs")?.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    const tabs = Array.from(document.querySelectorAll("#notifications-tabs [role='tab']:not(.hidden)"));
    if (tabs.length < 2) return;
    e.preventDefault();
    e.stopPropagation();
    const curIdx = Math.max(
      0,
      tabs.findIndex((b) => b === document.activeElement || b.classList.contains("active"))
    );
    let nextIdx = curIdx;
    if (e.key === "ArrowRight") nextIdx = (curIdx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") nextIdx = (curIdx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = tabs.length - 1;
    const nextTab = tabs[nextIdx];
    if (nextTab) {
      switchNotificationsTab(nextTab.dataset.ntab);
      nextTab.focus();
    }
  });
  if (notifBellBtn && notifPopover) {
    notifBellBtn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = notifPopover.classList.contains("hidden");
      closeFloatingPopovers();
      if (willOpen) {
        renderNotificationsBell();
        if (state.notifTab === "calendar") {
          loadAndRenderReleaseCalendar(false);
        }
        notifPopover.classList.remove("hidden");
        notifBellBtn.classList.add("active");
        notifBellBtn.setAttribute("aria-expanded", "true");
        clampFloatingPopover(notifPopover, { isHeader: true });
      }
    };
  }
  if (checkRezkaUpdatesBtn) {
    checkRezkaUpdatesBtn.onclick = async (e) => {
      e.stopPropagation();
      checkRezkaUpdatesBtn.disabled = true;
      checkRezkaUpdatesBtn.innerHTML = `${iconSvg("refresh", 12)}<span>${t("Проверка...", "Checking...")}</span>`;
      await checkLiveRezkaSeriesUpdates(true, true);
      if (state.notifTab === "calendar") {
        await loadAndRenderReleaseCalendar(true);
      }
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
      const bellBtn = document.getElementById("notifications-bell-btn");
      bellBtn?.classList.remove("active");
      bellBtn?.setAttribute("aria-expanded", "false");
    }
    const profWrap = document.getElementById("profile-switcher-wrap");
    const profPop = document.getElementById("profile-switcher-popover");
    if (profPop && !profPop.classList.contains("hidden") && profWrap && !profWrap.contains(e.target)) {
      closeProfilePopover();
    }
    const inCustomSelectPortal = Boolean(e.target?.closest?.("#atv-cselect-portal"));
    const gearWrap = document.getElementById("player-gear-wrap");
    const gearPopover = document.getElementById("player-gear-popover");
    if (
      !inCustomSelectPortal &&
      gearPopover &&
      !gearPopover.classList.contains("hidden") &&
      !gearPopover.contains(e.target) &&
      !(gearWrap && gearWrap.contains(e.target))
    ) {
      gearPopover.classList.add("hidden");
      const gearBtn = document.getElementById("btn-player-gear");
      gearBtn?.classList.remove("active");
      gearBtn?.setAttribute("aria-expanded", "false");
      syncVcPopoverOpenClass();
    }
    const statusWrap = document.getElementById("kinorium-status-dropdown-wrap");
    const statusPopover = document.getElementById("kinorium-status-popover");
    if (statusPopover && !statusPopover.classList.contains("hidden") && statusWrap && !statusWrap.contains(e.target)) {
      statusPopover.classList.add("hidden");
      document.getElementById("btn-kinorium-status-menu")?.setAttribute("aria-expanded", "false");
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
      const sInp = document.getElementById("global-search");
      sInp?.setAttribute("aria-expanded", "false");
      sInp?.removeAttribute("aria-activedescendant");
    }
    if (
      !inCustomSelectPortal &&
      hasOpenVcPopover() &&
      !e.target.closest(".atv-vc-pop-wrap") &&
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
    searchKbdHint.onclick = (e) => {
      e.stopPropagation();
      openCommandPalette();
    };
  }
  initCatalogLiveSearch();

  initGlobalHotkeys({ onRequestCloseSettings: () => requestCloseSettingsModal() });
  initCatalogToolbarAndFilterBindings();

  const openStatsBtn = document.getElementById("btn-open-stats-modal");
  if (openStatsBtn) {
    openStatsBtn.onclick = () => openStatsModal("analytics");
  }
  const openBookmarksBtn = document.getElementById("btn-open-bookmarks-modal");
  if (openBookmarksBtn) {
    openBookmarksBtn.onclick = () => {
      closeProfilePopover();
      openBookmarksModal();
    };
  }
  const openRouletteBtn = document.getElementById("btn-open-roulette-modal");
  if (openRouletteBtn) {
    openRouletteBtn.onclick = () => openMovieRouletteModal();
  }
  document.getElementById("stats-tab-analytics")?.addEventListener("click", () => {
    switchStatsModalTab("analytics");
  });
  document.getElementById("stats-tab-history")?.addEventListener("click", () => {
    switchStatsModalTab("history");
  });
  document.getElementById("stats-modal-tabs")?.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    const tabs = Array.from(document.querySelectorAll("#stats-modal-tabs [role='tab']:not(.hidden)"));
    if (tabs.length < 2) return;
    e.preventDefault();
    e.stopPropagation();
    const curIdx = Math.max(
      0,
      tabs.findIndex((b) => b === document.activeElement || b.classList.contains("active"))
    );
    let nextIdx = curIdx;
    if (e.key === "ArrowRight") nextIdx = (curIdx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") nextIdx = (curIdx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = tabs.length - 1;
    const nextTab = tabs[nextIdx];
    if (nextTab) {
      switchStatsModalTab(nextTab.dataset.statstab);
      nextTab.focus();
    }
  });
  const closeStatsBtn = document.getElementById("close-stats-modal");
  if (closeStatsBtn) {
    closeStatsBtn.onclick = () => {
      closeStatsModal();
    };
  }
  document.getElementById("stats-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "stats-modal") {
      closeStatsModal();
    }
  });

  // Quick Peek Modal listeners (back, rate 1-10, status toggles, close)
  initQuickPeekBindings();
  initPlayerStageAndGearBindings();

  const preservePlayerHistoryIfNeeded = () => {
    if (
      state.isPlayerOpen &&
      state.hasPlayerHistoryEntry &&
      !window.history.state?.velariumPlayerModal
    ) {
      try {
        window.history.pushState({ velariumPlayerModal: true }, "");
      } catch (err) { window.logDebug?.("App", err); }
    }
  };

  window.addEventListener("popstate", () => {
    if (state.ignoringSyntheticPopstate) {
      state.ignoringSyntheticPopstate = false;
      return;
    }
    const kidsPinMod = document.getElementById("kids-pin-modal");
    if (kidsPinMod && !kidsPinMod.classList.contains("hidden")) {
      closeKidsPinModal(null);
      preservePlayerHistoryIfNeeded();
      return;
    }
    const confirmMod = document.getElementById("confirm-modal");
    if (confirmMod && !confirmMod.classList.contains("hidden")) {
      closeConfirmModal(false);
      preservePlayerHistoryIfNeeded();
      return;
    }
    const cmdPaletteMod = document.getElementById("command-palette-modal");
    if (cmdPaletteMod && !cmdPaletteMod.classList.contains("hidden")) {
      closeCommandPalette();
      preservePlayerHistoryIfNeeded();
      return;
    }
    const rouletteMod = document.getElementById("movie-roulette-modal");
    if (rouletteMod && !rouletteMod.classList.contains("hidden")) {
      closeMovieRouletteModal();
      preservePlayerHistoryIfNeeded();
      return;
    }
    const onboardingMod = document.getElementById("onboarding-modal");
    if (onboardingMod && !onboardingMod.classList.contains("hidden")) {
      if (!state.onboardingIsFirstRun) {
        closeOnboardingModal({ reopenSettings: true });
      }
      preservePlayerHistoryIfNeeded();
      return;
    }
    const profilesMod = document.getElementById("profiles-modal");
    if (profilesMod && !profilesMod.classList.contains("hidden")) {
      closeProfilesModal();
      preservePlayerHistoryIfNeeded();
      return;
    }
    const tvCastMod = document.getElementById("tv-cast-modal");
    if (tvCastMod && !tvCastMod.classList.contains("hidden")) {
      closeTvCastModal();
      preservePlayerHistoryIfNeeded();
      return;
    }
    const downloadsMod = document.getElementById("downloads-modal");
    if (downloadsMod && !downloadsMod.classList.contains("hidden")) {
      closeDownloadsModal();
      preservePlayerHistoryIfNeeded();
      return;
    }
    const settingsMod = document.getElementById("settings-modal");
    if (settingsMod && !settingsMod.classList.contains("hidden")) {
      requestCloseSettingsModal();
      preservePlayerHistoryIfNeeded();
      return;
    }
    const statsMod = document.getElementById("stats-modal");
    if (statsMod && !statsMod.classList.contains("hidden")) {
      closeStatsModal();
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

  document.querySelectorAll("#settings-tabs .settings-tab").forEach((tab) => {
    tab.onclick = () => switchSettingsTab(tab.dataset.stab);
  });
  document.getElementById("settings-tabs")?.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    const tabs = Array.from(document.querySelectorAll("#settings-tabs .settings-tab:not(.hidden)"));
    if (tabs.length < 2) return;
    e.preventDefault();
    e.stopPropagation();
    const curIdx = Math.max(
      0,
      tabs.findIndex((b) => b === document.activeElement || b.classList.contains("active"))
    );
    let nextIdx = curIdx;
    if (e.key === "ArrowRight") nextIdx = (curIdx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") nextIdx = (curIdx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = tabs.length - 1;
    const nextTab = tabs[nextIdx];
    if (nextTab) {
      switchSettingsTab(nextTab.dataset.stab);
      nextTab.focus();
    }
  });

  initPlayerStatusAndRatingBindings({ onClosePlayerModal: (keepMini) => closePlayerModal(keepMini) });

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

  initSettingsAndBackupBindings();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initVelariumApp);
  } else {
    initVelariumApp();
  }
}
