import {
  CURATED_SHELVES_STORAGE_KEY,
  EP_VIEW_MODE_STORAGE_KEY,
  RECENT_SEARCHES_STORAGE_KEY,
  UI_PREFS_STORAGE_KEY,
  profileStorageKey,
  state,
} from "./js/state.js?v=20261104v21";
import {
  applyStaticDomTranslations,
  displayPoster,
  displayTitle,
  isEn,
  secondaryTitle,
  syncLanguageSegmentedControlUI,
  t,
} from "./js/i18n.js?v=20261104v21";
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
  restoreModalTriggerFocus,
  saveSeenNotificationsSet,
  saveUiPrefs,
  showConfirmModal,
  showToast,
  showVideoOsd,
  supportsNativePiP,
  syncScrollTopButton,
  syncSearchInputHasQueryUI,
  trapModalTabKey,
  triggerVideoCenterIndicator,
  withKinoriumActionLock,
} from "./js/utils.js?v=20261104v21";
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
} from "./js/audio-dsp.js?v=20261104v21";
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
} from "./js/catalog.js?v=20261104v21";
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
  syncQuickPeekStatusesUI,
} from "./js/modals.js?v=20261104v21";
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
} from "./js/player.js?v=20261104v21";
import {
  adjustSubtitleOffset,
  bindSubtitleFileAndDropListeners,
  closeSubtitleDictPopover,
  resetSubtitleOffset,
  syncSubtitleOffsetUI,
} from "./js/subtitles.js?v=20261104v21";
import {
  initDesktopRemoteAgent,
  initMobileRemoteController,
  isMobileRemoteUrl,
  pushDesktopRemoteStateNow,
} from "./js/remote.js?v=20261104v21";
import {
  addStremioAddonFromInput,
  applyAppLanguage,
  buildFullBackupPayload,
  changeUserCountryInstant,
  checkAppUpdates,
  closeOnboardingModal,
  getNetworkSettingsSnapshot,
  isKinoriumQuickFormDirty,
  isNetworkSettingsDirty,
  openOnboardingModal,
  openSettingsModal,
  renderAppUpdaterUI,
  renderOnboardingModalUI,
  renderSettingsCountryUI,
  resetUnsavedSettingsInputs,
  restoreFromBackupObject,
  saveUpdaterSettingsImmediate,
  setOnboardingStep,
  skipOnboardingModal,
  startAppUpdateDownload,
  submitOnboardingModal,
  switchSettingsTab,
  syncSettingsFooterUI,
  toggleLanAccess,
  toggleMacosAutostart,
} from "./js/settings.js?v=20261104v21";
import {
  applyPendingTvDeepLinkIfReady,
  applyProfilesPayload,
  closeDownloadsModal,
  closeKidsPinModal,
  closeProfilePopover,
  closeProfilesModal,
  closeTvCastModal,
  handleTvSpatialKeydown,
  initRoadmapFeatures,
  reloadProfileLocalPlayerPrefs,
  renderHeaderProfileSwitcher,
} from "./js/features.js?v=20261104v21";

function initCineFlowApp() {
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
    } catch (_) {}
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
  } catch (_) {}
  state.autoNextEpisode = initPrefs.autoNextEpisode;
  state.audioBoost = initPrefs.audioBoost;
  state.audioPreset = initPrefs.audioPreset || "flat";
  state.videoCrop = initPrefs.videoCrop || "contain";
  state.subSize = initPrefs.subSize || "medium";
  state.subBg = initPrefs.subBg || "semi";
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
        renderNotificationsBell();
        renderContinueWatching();
        if (Boolean(state.activeProfile?.kids_mode) !== prevKidsMode) {
          loadCatalog();
        } else if (Array.isArray(state.catalogItems) && state.catalogItems.length > 0) {
          renderCatalogShelves();
        }
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
  applySubtitleStylePrefs(state.subSize, state.subBg);
  document.getElementById("btn-hide-watched")?.classList.toggle("active", state.hideWatched);
  updateActiveFiltersBadge();
  updatePlayerGearActiveDot();
  loadCatalog().then(() => applyPendingTvDeepLinkIfReady());
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
  const searchLivePopover = document.getElementById("search-live-popover");
  const syncSearchClearButton = () => {
    syncSearchInputHasQueryUI();
  };

  let liveSearchReqId = 0;
  let debounceTimer = null;
  let liveSearchAbortCtrl = null;
  let liveSearchHitsState = [];
  let liveSearchActiveIdx = -1;

  const abortLiveSearchInFlight = () => {
    if (liveSearchAbortCtrl) {
      try {
        liveSearchAbortCtrl.abort();
      } catch (_) {}
      liveSearchAbortCtrl = null;
    }
  };

  const closeLiveSearchPopover = () => {
    if (searchLivePopover) {
      searchLivePopover.classList.add("hidden");
    }
    if (searchInput) {
      searchInput.setAttribute("aria-expanded", "false");
      searchInput.removeAttribute("aria-activedescendant");
    }
  };

  const syncLiveSearchActiveHighlight = () => {
    if (!searchLivePopover) return;
    const rows = searchLivePopover.querySelectorAll(
      ".atv-search-hit, .atv-search-recent-row, .atv-search-quick-random, .atv-search-all-btn"
    );
    let activeId = "";
    rows.forEach((r, idx) => {
      const isAct = idx === liveSearchActiveIdx;
      const optId = r.id || `live-search-opt-${idx}`;
      r.id = optId;
      r.setAttribute("role", "option");
      r.setAttribute("aria-selected", isAct ? "true" : "false");
      r.classList.toggle("active-hit", isAct);
      if (isAct) {
        activeId = optId;
        try {
          r.scrollIntoView({ block: "nearest" });
        } catch (_) {}
      }
    });
    if (searchInput) {
      if (activeId) {
        searchInput.setAttribute("aria-activedescendant", activeId);
      } else {
        searchInput.removeAttribute("aria-activedescendant");
      }
    }
  };

  const getRecentSearches = () => {
    try {
      const raw = localStorage.getItem(profileStorageKey(RECENT_SEARCHES_STORAGE_KEY));
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((x) => String(x || "").trim())
        .filter((x) => x.length >= 2)
        .slice(0, 7);
    } catch (_) {
      return [];
    }
  };

  const saveRecentSearchQuery = (rawQuery) => {
    const clean = String(rawQuery || "").trim();
    if (clean.length < 2) return;
    try {
      const lower = clean.toLowerCase();
      const next = [clean, ...getRecentSearches().filter((q) => q.toLowerCase() !== lower)].slice(0, 7);
      localStorage.setItem(profileStorageKey(RECENT_SEARCHES_STORAGE_KEY), JSON.stringify(next));
    } catch (_) {}
  };

  const removeRecentSearchQuery = (rawQuery) => {
    const lower = String(rawQuery || "").trim().toLowerCase();
    if (!lower) return;
    try {
      const next = getRecentSearches().filter((q) => q.toLowerCase() !== lower);
      localStorage.setItem(profileStorageKey(RECENT_SEARCHES_STORAGE_KEY), JSON.stringify(next));
    } catch (_) {}
  };

  const clearRecentSearches = () => {
    try {
      localStorage.removeItem(profileStorageKey(RECENT_SEARCHES_STORAGE_KEY));
    } catch (_) {}
  };

  const runSubmittedRecentSearch = (queryStr) => {
    const clean = String(queryStr || "").trim();
    if (!clean) return;
    abortLiveSearchInFlight();
    searchInput.value = clean;
    syncSearchClearButton();
    saveRecentSearchQuery(clean);
    closeLiveSearchPopover();
    resetCatalogFiltersForGlobalSearch();
    state.searchQuery = clean;
    loadCatalog({ showLoading: true });
  };

  const renderEmptySearchSuggestions = () => {
    if (!searchLivePopover) return;
    closeFloatingPopovers({ exceptId: "search-live-popover" });
    const recent = getRecentSearches();
    liveSearchHitsState = [
      ...recent.map((q) => ({ _hitKind: "recent", query: q })),
      { _hitKind: "random" },
    ];
    liveSearchActiveIdx = -1;
    searchLivePopover.innerHTML = "";
    searchLivePopover.classList.remove("hidden");
    searchInput?.setAttribute("aria-expanded", "true");
    searchInput?.removeAttribute("aria-activedescendant");

    if (recent.length > 0) {
      const head = document.createElement("div");
      head.className = "atv-search-recent-head";
      head.innerHTML = `
        <span>${escapeHtml(t("Недавние запросы", "Recent searches"))}</span>
        <button type="button" class="atv-search-recent-clear">${escapeHtml(t("Очистить", "Clear"))}</button>
      `;
      head.querySelector(".atv-search-recent-clear")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        clearRecentSearches();
        renderEmptySearchSuggestions();
        searchInput.focus();
      });
      searchLivePopover.appendChild(head);

      const listEl = document.createElement("div");
      listEl.className = "atv-search-recent-list";
      recent.forEach((q, idx) => {
        const row = document.createElement("div");
        row.id = `live-search-opt-${idx}`;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", "false");
        row.className = "atv-search-recent-row";
        row.innerHTML = `
          <button type="button" class="atv-search-recent-btn">
            ${iconSvg("clock", 13)}
            <span class="atv-search-recent-q">${escapeHtml(q)}</span>
          </button>
          <button type="button" class="atv-search-recent-del" title="${escapeAttr(t("Удалить из истории", "Remove from history"))}" aria-label="${escapeAttr(t("Удалить из истории", "Remove from history"))}">
            ${iconSvg("x", 11)}
          </button>
        `;
        row.querySelector(".atv-search-recent-btn")?.addEventListener("click", () => {
          runSubmittedRecentSearch(q);
        });
        row.querySelector(".atv-search-recent-del")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          removeRecentSearchQuery(q);
          renderEmptySearchSuggestions();
          searchInput.focus();
        });
        listEl.appendChild(row);
      });
      searchLivePopover.appendChild(listEl);
    }

    const randomBtn = document.createElement("button");
    randomBtn.type = "button";
    randomBtn.id = `live-search-opt-${recent.length}`;
    randomBtn.setAttribute("role", "option");
    randomBtn.setAttribute("aria-selected", "false");
    randomBtn.className = "atv-search-quick-random";
    randomBtn.innerHTML = `${iconSvg("star", 12)}<span>${escapeHtml(
      t("Случайный выбор на вечер", "Random pick for tonight")
    )}</span>`;
    randomBtn.onclick = () => {
      closeLiveSearchPopover();
      searchInput.blur();
      document.getElementById("btn-random-pick")?.click();
    };
    searchLivePopover.appendChild(randomBtn);
    clampFloatingPopover(searchLivePopover, { isHeader: true });
  };

  const renderLiveSearchHits = (queryText, itemsList, isLoading = false, personsList = []) => {
    if (!searchLivePopover) return;
    const qClean = queryText.trim();
    const currentInputClean = String(searchInput?.value || "").trim();
    if (qClean.length < 2 || currentInputClean.toLowerCase() !== qClean.toLowerCase()) {
      liveSearchHitsState = [];
      liveSearchActiveIdx = -1;
      closeLiveSearchPopover();
      searchLivePopover.innerHTML = "";
      return;
    }
    closeFloatingPopovers({ exceptId: "search-live-popover" });
    searchLivePopover.classList.remove("hidden");
    searchInput?.setAttribute("aria-expanded", "true");
    searchLivePopover.innerHTML = `<div class="atv-search-popover-head">${
      isLoading
        ? t("Поиск по каталогу, персонам и источникам...", "Searching catalog, people & sources...")
        : t("Быстрый переход (стрелки и Enter)", "Quick jump (Arrow keys and Enter)")
    }</div>`;

    const topPersons = (personsList || []).slice(0, 3);
    const maxItems = topPersons.length > 0 ? Math.max(4, 7 - topPersons.length) : 6;
    const topHits = (itemsList || []).slice(0, maxItems);
    const hasMatchRows = topPersons.length + topHits.length > 0;
    liveSearchHitsState = [
      ...topPersons.map((p) => ({ _hitKind: "person", data: p })),
      ...topHits.map((it) => ({ _hitKind: "item", data: it })),
      { _hitKind: "show_all", query: qClean },
    ];
    if (liveSearchActiveIdx >= liveSearchHitsState.length) {
      liveSearchActiveIdx = -1;
    }
    if (!hasMatchRows && !isLoading) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "atv-search-empty-hit";
      emptyDiv.textContent = t(
        "Совпадений не найдено — нажмите Enter для полного поиска",
        "No matches found — press Enter for full search"
      );
      searchLivePopover.appendChild(emptyDiv);
    } else {
      let rowCursor = 0;
      topPersons.forEach((p) => {
        const idx = rowCursor++;
        const isAct = idx === liveSearchActiveIdx;
        const pName = p.name || p.orig_name || "";
        const pSub =
          p.orig_name && p.orig_name.toLowerCase() !== pName.toLowerCase()
            ? `${p.role || t("Персона", "Person")} · ${p.orig_name}`
            : p.role || t("Персона", "Person");
        const photoSrc =
          p.photo_endpoint ||
          (p.photo ? `/api/person-photo?name=${encodeURIComponent(pName)}&url=${encodeURIComponent(p.photo)}` : `/api/person-photo?name=${encodeURIComponent(pName)}`);
        const row = document.createElement("div");
        row.id = `live-search-opt-${idx}`;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", isAct ? "true" : "false");
        row.className = `atv-search-hit atv-search-person-hit${isAct ? " active-hit" : ""}`;
        row.innerHTML = `
          <img class="atv-search-hit-avatar" src="${escapeAttr(photoSrc)}" alt="${escapeAttr(pName)}" decoding="async" referrerpolicy="no-referrer" />
          <div class="atv-search-hit-info">
            <div class="atv-search-hit-title">${escapeHtml(pName)}</div>
            <div class="atv-search-hit-sub">${escapeHtml(pSub)}</div>
          </div>
          <div class="atv-search-hit-actions">
            <span class="atv-search-person-tag">${escapeHtml(t("Фильмография", "Filmography"))}</span>
          </div>
        `;
        const avImg = row.querySelector("img");
        if (avImg) {
          avImg.onerror = () => {
            avImg.onerror = null;
            avImg.src = buildFallbackAvatarSvg(pName);
          };
        }
        row.onclick = () => {
          saveRecentSearchQuery(qClean);
          closeLiveSearchPopover();
          openPersonModal(p);
        };
        searchLivePopover.appendChild(row);
      });

      const kinOn = isServiceEnabled("kinorium");
      topHits.forEach((hit) => {
        const idx = rowCursor++;
        const isAct = idx === liveSearchActiveIdx;
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
        row.id = `live-search-opt-${idx}`;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", isAct ? "true" : "false");
        row.className = `atv-search-hit${isAct ? " active-hit" : ""}`;
        row.innerHTML = `
          <img class="atv-search-hit-poster" src="${escapeAttr(hitPoster)}" alt="${escapeAttr(hitTitle)}" decoding="async" referrerpolicy="no-referrer" />
          <div class="atv-search-hit-info">
            <div class="atv-search-hit-title">${escapeHtml(hitTitle)}</div>
            <div class="atv-search-hit-sub">${escapeHtml(hit.year || "")} · ${tLabel}${ratPartHtml}${
          secTitle ? " · " + escapeHtml(secTitle) : ""
        }</div>
          </div>
          <div class="atv-search-hit-actions">
            <button type="button" class="atv-search-hit-play" title="${escapeAttr(t("Смотреть сразу", "Watch now"))}" aria-label="${escapeAttr(t("Смотреть сразу", "Watch now"))}">${iconSvg("play", 12)}</button>
          </div>
        `;
        attachSmartPosterFallback(row.querySelector("img"), hitTitle, hit.year, hit.poster || hitPoster);
        const playBtn = row.querySelector(".atv-search-hit-play");
        if (playBtn) {
          playBtn.onclick = (ev) => {
            ev.stopPropagation();
            saveRecentSearchQuery(qClean);
            closeLiveSearchPopover();
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
          saveRecentSearchQuery(qClean);
          closeLiveSearchPopover();
          openQuickPeekModal(hit);
        };
        searchLivePopover.appendChild(row);
      });
    }

    const showAllIdx = liveSearchHitsState.length - 1;
    const isShowAllAct = showAllIdx === liveSearchActiveIdx;
    const showAllBtn = document.createElement("button");
    showAllBtn.type = "button";
    showAllBtn.id = `live-search-opt-${showAllIdx}`;
    showAllBtn.setAttribute("role", "option");
    showAllBtn.setAttribute("aria-selected", isShowAllAct ? "true" : "false");
    showAllBtn.className = `atv-search-all-btn${isShowAllAct ? " active-hit" : ""}`;
    showAllBtn.textContent = t(
      `Показать все результаты по запросу «${qClean}»`,
      `Show all results for "${qClean}"`
    );
    showAllBtn.onclick = () => {
      abortLiveSearchInFlight();
      saveRecentSearchQuery(qClean);
      closeLiveSearchPopover();
      resetCatalogFiltersForGlobalSearch();
      state.searchQuery = qClean;
      loadCatalog({ showLoading: true });
    };
    searchLivePopover.appendChild(showAllBtn);
    syncLiveSearchActiveHighlight();
    clampFloatingPopover(searchLivePopover, { isHeader: true });
  };

  function resetCatalogFiltersForGlobalSearch() {
    state.kinoriumSection = "all";
    state.providerFilter = "all";
    state.mediaTypeFilter = "all";
    state.genreFilter = "all";
    state.yearFilter = "all";
    state.friendsFilter = false;
    state.selectedFriend = "all";
    document.querySelectorAll(".kin-sec-pill").forEach((b) => {
      b.classList.toggle("active", b.dataset.ksec === "all");
    });
    document.querySelectorAll(".atv-pill").forEach((b) => {
      b.classList.toggle("active", b.dataset.provider === "all");
    });
    document.querySelectorAll(".type-pill").forEach((b) => {
      b.classList.toggle("active", b.dataset.type === "all");
    });
    const gSel = document.getElementById("select-catalog-genre");
    if (gSel) gSel.value = "all";
    const ySel = document.getElementById("select-catalog-year");
    if (ySel) ySel.value = "all";
    const fSel = document.getElementById("select-friend-filter");
    if (fSel) fSel.value = "all";
    document.getElementById("btn-friends-filter")?.classList.remove("active");
    updateActiveFiltersBadge();
  }

  searchInput.addEventListener("input", (e) => {
    const val = e.target.value || "";
    liveSearchActiveIdx = -1;
    syncSearchClearButton();
    clearTimeout(debounceTimer);
    abortLiveSearchInFlight();
    const trimmed = val.trim();
    if (!trimmed) {
      if (document.activeElement === searchInput) {
        renderEmptySearchSuggestions();
      } else {
        closeLiveSearchPopover();
      }
      if (state.searchQuery) {
        state.searchQuery = "";
        loadCatalog();
      }
      return;
    }
    if (trimmed.length < 2) {
      closeLiveSearchPopover();
      if (state.searchQuery) {
        state.searchQuery = "";
        loadCatalog();
      }
      return;
    }
    const qLow = trimmed.toLowerCase();
    const localPersons = [];
    const seenLocalPerson = new Set();
    const localMatches = (state.catalogItems || []).filter((it) => {
      const titleHit =
        (it.title || "").toLowerCase().includes(qLow) ||
        (it.orig_title || "").toLowerCase().includes(qLow);
      let castHit = false;
      if (trimmed.length >= 3) {
        const dirs = isEn() && it.directors_en?.length ? it.directors_en : it.directors || [];
        const acts = isEn() && it.actors_en?.length ? it.actors_en : it.actors || [];
        dirs.forEach((d) => {
          if (String(d || "").toLowerCase().includes(qLow)) {
            castHit = true;
            const k = String(d).trim().toLowerCase();
            if (!seenLocalPerson.has(k)) {
              seenLocalPerson.add(k);
              localPersons.push({ name: d, role: t("Режиссёр", "Director"), hint_title: it.title || "" });
            }
          }
        });
        acts.forEach((a) => {
          if (String(a || "").toLowerCase().includes(qLow)) {
            castHit = true;
            const k = String(a).trim().toLowerCase();
            if (!seenLocalPerson.has(k)) {
              seenLocalPerson.add(k);
              localPersons.push({ name: a, role: t("Актёр", "Actor"), hint_title: it.title || "" });
            }
          }
        });
      }
      return titleHit || castHit;
    });
    renderLiveSearchHits(trimmed, localMatches, true, localPersons);

    debounceTimer = setTimeout(async () => {
      liveSearchReqId += 1;
      const rId = liveSearchReqId;
      const profSnap = state.activeProfile?.id || "main";
      abortLiveSearchInFlight();
      const ctrl = new AbortController();
      liveSearchAbortCtrl = ctrl;
      try {
        const res = await fetch(
          `/api/search?mode=suggest&q=${encodeURIComponent(trimmed)}&provider=all&media_type=all&kinorium_section=all&lang=${encodeURIComponent(state.appLang || "ru")}`,
          { signal: ctrl.signal }
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (rId !== liveSearchReqId || (state.activeProfile?.id || "main") !== profSnap) return;
        const mergedPersons =
          Array.isArray(data.persons) && data.persons.length > 0 ? data.persons : localPersons;
        renderLiveSearchHits(trimmed, data.items || localMatches, false, mergedPersons);
      } catch (err) {
        if (err && err.name === "AbortError") return;
        if (rId !== liveSearchReqId || (state.activeProfile?.id || "main") !== profSnap) return;
        renderLiveSearchHits(trimmed, localMatches, false, localPersons);
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
      abortLiveSearchInFlight();
      if (popOpen && liveSearchActiveIdx >= 0 && liveSearchHitsState[liveSearchActiveIdx]) {
        const chosen = liveSearchHitsState[liveSearchActiveIdx];
        if (chosen._hitKind === "recent" || chosen._hitKind === "show_all") {
          runSubmittedRecentSearch(chosen.query);
          return;
        }
        if (chosen._hitKind === "random") {
          closeLiveSearchPopover();
          searchInput.blur();
          document.getElementById("btn-random-pick")?.click();
          return;
        }
        saveRecentSearchQuery(searchInput.value);
        closeLiveSearchPopover();
        if (chosen._hitKind === "person") {
          openPersonModal(chosen.data);
        } else {
          openQuickPeekModal(chosen.data);
        }
        return;
      }
      closeLiveSearchPopover();
      const nextQ = searchInput.value.trim();
      if (nextQ) {
        saveRecentSearchQuery(nextQ);
        resetCatalogFiltersForGlobalSearch();
      }
      state.searchQuery = nextQ;
      loadCatalog({ showLoading: true });
    }
  });

  searchInput.addEventListener("focus", () => {
    closeFloatingPopovers({ exceptId: "search-live-popover" });
    const trimmed = (searchInput.value || "").trim();
    if (!trimmed) {
      renderEmptySearchSuggestions();
      return;
    }
    if (trimmed.length >= 2 && searchLivePopover && searchLivePopover.innerHTML.trim()) {
      searchLivePopover.classList.remove("hidden");
      searchInput.setAttribute("aria-expanded", "true");
      syncLiveSearchActiveHighlight();
      clampFloatingPopover(searchLivePopover, { isHeader: true });
    }
  });

  if (clearSearchBtn) {
    clearSearchBtn.onclick = () => {
      clearTimeout(debounceTimer);
      liveSearchReqId += 1;
      abortLiveSearchInFlight();
      searchInput.value = "";
      const hadSearch = Boolean(state.searchQuery);
      state.searchQuery = "";
      syncSearchClearButton();
      renderEmptySearchSuggestions();
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
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "л")) {
      const kidsPinMod = document.getElementById("kids-pin-modal");
      const confirmMod = document.getElementById("confirm-modal");
      const onboardingMod = document.getElementById("onboarding-modal");
      if (
        (kidsPinMod && !kidsPinMod.classList.contains("hidden")) ||
        (confirmMod && !confirmMod.classList.contains("hidden")) ||
        (onboardingMod && !onboardingMod.classList.contains("hidden"))
      ) {
        return;
      }
      e.preventDefault();
      const paletteMod = document.getElementById("command-palette-modal");
      if (paletteMod && !paletteMod.classList.contains("hidden")) {
        closeCommandPalette();
      } else {
        openCommandPalette({ instant: true });
      }
      return;
    }
    if (e.key === "Enter" && !e.repeat && state.isPlayerOpen) {
      const autoplayCard = document.getElementById("autoplay-next-card");
      if (autoplayCard && !autoplayCard.classList.contains("hidden")) {
        e.preventDefault();
        clearAutoplayNextTimer();
        stepEpisode(1);
        return;
      }
    }
    if (e.key === "Escape") {
      const ctxMenu = document.getElementById("atv-card-context-menu");
      if (ctxMenu && !ctxMenu.classList.contains("hidden")) {
        e.preventDefault();
        closeCardContextMenu({ restoreFocus: true });
        return;
      }
      const autoplayCard = document.getElementById("autoplay-next-card");
      if (autoplayCard && !autoplayCard.classList.contains("hidden")) {
        e.preventDefault();
        state.autoplayCancelledThisEpisode = true;
        clearAutoplayNextTimer();
        showToast(t("Автопереход к следующей серии отменен", "Auto-play next episode cancelled"));
        return;
      }
      const nextEpToast = document.getElementById("player-next-ep-toast");
      if (nextEpToast && !nextEpToast.classList.contains("hidden")) {
        e.preventDefault();
        dismissPlayerNextEpisodeToast(true);
        return;
      }
      const paletteMod = document.getElementById("command-palette-modal");
      if (paletteMod && !paletteMod.classList.contains("hidden")) {
        e.preventDefault();
        closeCommandPalette();
        return;
      }
      if (isCustomSelectMenuOpen()) {
        e.preventDefault();
        closeCustomSelectMenu({ restoreFocus: true });
        return;
      }
      const kidsPinMod = document.getElementById("kids-pin-modal");
      if (kidsPinMod && !kidsPinMod.classList.contains("hidden")) {
        e.preventDefault();
        closeKidsPinModal(null);
        return;
      }
      const confirmMod = document.getElementById("confirm-modal");
      if (confirmMod && !confirmMod.classList.contains("hidden")) {
        e.preventDefault();
        closeConfirmModal(false);
        return;
      }
      const onboardingMod = document.getElementById("onboarding-modal");
      if (onboardingMod && !onboardingMod.classList.contains("hidden")) {
        e.preventDefault();
        if (!state.onboardingIsFirstRun) {
          closeOnboardingModal({ reopenSettings: true });
        }
        return;
      }
      const profilesMod = document.getElementById("profiles-modal");
      if (profilesMod && !profilesMod.classList.contains("hidden")) {
        e.preventDefault();
        closeProfilesModal();
        return;
      }
      const tvCastMod = document.getElementById("tv-cast-modal");
      if (tvCastMod && !tvCastMod.classList.contains("hidden")) {
        e.preventDefault();
        closeTvCastModal();
        return;
      }
      const downloadsMod = document.getElementById("downloads-modal");
      if (downloadsMod && !downloadsMod.classList.contains("hidden")) {
        e.preventDefault();
        closeDownloadsModal();
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
        e.preventDefault();
        closeStatsModal();
        return;
      }
      const personMod = document.getElementById("person-modal");
      if (personMod && !personMod.classList.contains("hidden")) {
        e.preventDefault();
        closePersonModal({ clearStack: false });
        return;
      }
      const qpMod = document.getElementById("quick-peek-modal");
      if (qpMod && !qpMod.classList.contains("hidden")) {
        e.preventDefault();
        closeQuickPeekModal({ clearStack: false });
        return;
      }
      const rouletteMod = document.getElementById("movie-roulette-modal");
      if (rouletteMod && !rouletteMod.classList.contains("hidden")) {
        e.preventDefault();
        closeMovieRouletteModal();
        return;
      }
      const liveSearchPop = document.getElementById("search-live-popover");
      if (liveSearchPop && !liveSearchPop.classList.contains("hidden")) {
        e.preventDefault();
        liveSearchPop.classList.add("hidden");
        const sInp = document.getElementById("global-search");
        sInp?.setAttribute("aria-expanded", "false");
        sInp?.removeAttribute("aria-activedescendant");
        return;
      }
      const notifPop = document.getElementById("notifications-popover");
      if (notifPop && !notifPop.classList.contains("hidden")) {
        e.preventDefault();
        notifPop.classList.add("hidden");
        const bellBtn = document.getElementById("notifications-bell-btn");
        bellBtn?.classList.remove("active");
        bellBtn?.setAttribute("aria-expanded", "false");
        return;
      }
      const profPopEsc = document.getElementById("profile-switcher-popover");
      if (profPopEsc && !profPopEsc.classList.contains("hidden")) {
        e.preventDefault();
        closeProfilePopover();
        return;
      }
      const subDictPop = document.getElementById("atv-sub-dict-popover");
      if (subDictPop && !subDictPop.classList.contains("hidden")) {
        e.preventDefault();
        closeSubtitleDictPopover(true);
        syncVcPopoverOpenClass();
        return;
      }
      if (hasOpenVcPopover()) {
        e.preventDefault();
        closeAllVcPopovers();
        syncVcPopoverOpenClass();
        return;
      }
      const gearPop = document.getElementById("player-gear-popover");
      if (gearPop && !gearPop.classList.contains("hidden")) {
        e.preventDefault();
        gearPop.classList.add("hidden");
        const gearBtn = document.getElementById("btn-player-gear");
        gearBtn?.classList.remove("active");
        gearBtn?.setAttribute("aria-expanded", "false");
        syncVcPopoverOpenClass();
        return;
      }
      const errStudiosPanel = document.getElementById("video-error-studios-panel");
      if (errStudiosPanel && !errStudiosPanel.classList.contains("hidden")) {
        e.preventDefault();
        errStudiosPanel.classList.add("hidden");
        return;
      }
      const xrayShelf = document.getElementById("xray-pause-shelf");
      if (xrayShelf && !xrayShelf.classList.contains("hidden")) {
        e.preventDefault();
        hideXRayPauseShelf();
        return;
      }
      const statusPop = document.getElementById("kinorium-status-popover");
      if (statusPop && !statusPop.classList.contains("hidden")) {
        e.preventDefault();
        statusPop.classList.add("hidden");
        document.getElementById("btn-kinorium-status-menu")?.setAttribute("aria-expanded", "false");
        return;
      }
      const postWatch = document.getElementById("kinorium-postwatch-overlay");
      if (postWatch && !postWatch.classList.contains("hidden")) {
        e.preventDefault();
        state.postwatchManual = false;
        state.postwatchHovered = false;
        postWatch.classList.add("hidden");
        return;
      }
      if (isStageFullscreen()) {
        e.preventDefault();
        toggleStageFullscreen();
        return;
      }
      if (state.isPlayerOpen && !state.isMiniPlayer && !state.isPipBackground) {
        e.preventDefault();
        closePlayerModal();
      }
      return;
    }

    const tag = (e.target?.tagName || "").toUpperCase();
    const isTypingTarget =
      tag === "INPUT" || tag === "TEXTAREA" || Boolean(e.target?.isContentEditable);
    const isInteractiveBtnTarget =
      tag === "BUTTON" || tag === "A" || tag === "SUMMARY" || tag === "SELECT" || Boolean(e.target?.closest?.('[role="button"]'));

    if (state.tvMode && handleTvSpatialKeydown(e)) {
      return;
    }

    const hasTopCatalogModalOpen = [
      "kids-pin-modal",
      "confirm-modal",
      "onboarding-modal",
      "profiles-modal",
      "downloads-modal",
      "person-modal",
      "quick-peek-modal",
      "stats-modal",
      "settings-modal",
      "movie-roulette-modal",
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
      if (miniKey === "i" || miniKey === "ш" || e.code === "KeyI") {
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
        state.activeSourceTab !== "backup4k" &&
        state.activeSourceTab !== "offline") ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey
    ) {
      return;
    }
    const blockingOverlays = [
      "kids-pin-modal",
      "confirm-modal",
      "onboarding-modal",
      "profiles-modal",
      "downloads-modal",
      "person-modal",
      "quick-peek-modal",
      "stats-modal",
      "settings-modal",
      "movie-roulette-modal",
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
    } else if (e.code === "KeyR" && !e.ctrlKey && !e.metaKey && !e.altKey && !isInteractiveBtnTarget) {
      e.preventDefault();
      const { cur } = getEffectivePlaybackTiming(video);
      recoverFrozenVideoPlayback(video, cur, 1);
      triggerVideoCenterIndicator("refresh", t("Синхронизация видеопотока", "Video Resync"));
    } else if (keyLow === "f" || keyLow === "а" || e.code === "KeyF") {
      e.preventDefault();
      toggleStageFullscreen();
    } else if (keyLow === "t" || keyLow === "е") {
      e.preventDefault();
      togglePlayerSidebarCollapsed(true);
    } else if ((e.key === "ArrowLeft" && tag !== "SELECT") || keyLow === "j" || keyLow === "о") {
      e.preventDefault();
      const { cur } = getEffectivePlaybackTiming(video);
      const target = Math.max(0, cur - 10);
      seekEffectivePlayback(target);
      triggerVideoCenterIndicator("back10", `−10 ${t("секунд", "sec")} · ${formatTime(target)}`);
    } else if ((e.key === "ArrowRight" && tag !== "SELECT") || keyLow === "l" || keyLow === "д") {
      e.preventDefault();
      const { cur, dur } = getEffectivePlaybackTiming(video);
      const maxDur = dur > 0 ? dur : cur + 10;
      const target = Math.min(maxDur, cur + 10);
      seekEffectivePlayback(target);
      triggerVideoCenterIndicator("fwd10", `+10 ${t("секунд", "sec")} · ${formatTime(target)}`);
    } else if (e.key === "ArrowUp" && tag !== "SELECT" && !inScrollablePlayerPanel) {
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
    } else if (e.key === "ArrowDown" && tag !== "SELECT" && !inScrollablePlayerPanel) {
      e.preventDefault();
      video.volume = Math.max(0, Math.round((video.volume - 0.1) * 100) / 100);
      state.userMutedThisSession = video.volume === 0;
      video.muted = state.userMutedThisSession;
      if (video.volume > 0.02) {
        savePlayerPrefs({ volume: video.volume, muted: false });
      }
      const volPct = Math.round(video.volume * 100);
      showVideoOsd(volPct === 0 ? "volMute" : "volLow", t(`Громкость ${volPct}%`, `Volume ${volPct}%`), volPct);
    } else if (e.shiftKey && (keyLow === "m" || keyLow === "ь" || e.code === "KeyM")) {
      e.preventDefault();
      toggleBookmarkCurrentMoment();
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
    } else if (keyLow === "i" || keyLow === "ш" || e.code === "KeyI") {
      e.preventDefault();
      togglePictureInPicture({ fromNativeKey: true });
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
      updatePlayerGearActiveDot();
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
    rerollCatalogLaunchSeed();
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
      const isHidden = catalogFiltersDrawer.classList.toggle("hidden");
      toggleCatalogFiltersBtn.setAttribute("aria-expanded", isHidden ? "false" : "true");
      toggleCatalogFiltersBtn.setAttribute("aria-pressed", isHidden ? "false" : "true");
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
      const score = parseInt(btn.dataset.score, 10) || 0;
      const prevKin = item.kinorium ? { ...item.kinorium } : null;
      const optimisticKin = {
        ...(item.kinorium || {}),
        user_rating: score,
        watched: item.media_type === "movie" ? true : Boolean(item.kinorium?.watched),
        in_watchlist: false,
        not_watching: false,
      };
      item.kinorium = optimisticKin;
      syncQuickPeekStatusesUI(item);
      withKinoriumActionLock(`qp-rate:${item.id}`, qpStarsWrap || btn, async () => {
        try {
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
          if (!res.ok || updated?.ok === false || updated?.error) {
            throw new Error(updated?.error || `HTTP ${res.status}`);
          }
          item.kinorium = updated;
          if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
          patchCatalogItemKinoriumInPlace(item, updated);
          const syncNote = updated.remote_synced
            ? t("синхронизировано с Kinorium", "synced to Kinorium")
            : t("сохранено локально", "saved locally");
          showToast(
            t(
              `Оценка ${score}/10 (${syncNote}) · «${displayTitle(item)}»`,
              `Rating ${score}/10 (${syncNote}) · "${displayTitle(item)}"`
            )
          );
        } catch (err) {
          item.kinorium = prevKin;
          if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
          throw err;
        }
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
        if (!res.ok || updated?.ok === false || updated?.error) {
          throw new Error(updated?.error || `HTTP ${res.status}`);
        }
        item.kinorium = updated;
        if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
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
      if (!res.ok || updated?.ok === false || updated?.error) {
        throw new Error(updated?.error || `HTTP ${res.status}`);
      }
      item.kinorium = updated;
      if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
      patchCatalogItemKinoriumInPlace(item, updated);
      showToast(
        updated.watching
          ? t(`«${displayTitle(item)}» в разделе Смотрю`, `"${displayTitle(item)}" added to Watching`)
          : t("Убрано из Смотрю", "Removed from Watching"),
        {
          undoText: t("Отменить", "Undo"),
          durationMs: 5000,
          onUndo: async () => {
            try {
              const uRes = await fetch("/api/kinorium/watching", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildQpPayload(item)),
              });
              const uData = await uRes.json();
              if (uRes.ok && uData?.ok !== false && !uData?.error) {
                item.kinorium = uData;
                if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
                patchCatalogItemKinoriumInPlace(item, uData);
              }
            } catch (_) {}
          },
        }
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
      if (!res.ok || updated?.ok === false || updated?.error) {
        throw new Error(updated?.error || `HTTP ${res.status}`);
      }
      item.kinorium = updated;
      if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
      patchCatalogItemKinoriumInPlace(item, updated);
      showToast(
        updated.in_watchlist
          ? t(`«${displayTitle(item)}» в Буду смотреть`, `"${displayTitle(item)}" added to Watchlist`)
          : t("Убрано из Буду смотреть", "Removed from Watchlist"),
        {
          undoText: t("Отменить", "Undo"),
          durationMs: 5000,
          onUndo: async () => {
            try {
              const uRes = await fetch("/api/kinorium/watchlist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildQpPayload(item)),
              });
              const uData = await uRes.json();
              if (uRes.ok && uData?.ok !== false && !uData?.error) {
                item.kinorium = uData;
                if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
                patchCatalogItemKinoriumInPlace(item, uData);
              }
            } catch (_) {}
          },
        }
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
      if (!res.ok || updated?.ok === false || updated?.error) {
        throw new Error(updated?.error || `HTTP ${res.status}`);
      }
      item.kinorium = updated;
      if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
      patchCatalogItemKinoriumInPlace(item, updated);
      showToast(
        updated.watched
          ? t(`«${displayTitle(item)}» отмечено просмотренным`, `"${displayTitle(item)}" marked as watched`)
          : t("Снята отметка просмотренного", "Unmarked as watched"),
        {
          undoText: t("Отменить", "Undo"),
          durationMs: 5000,
          onUndo: async () => {
            try {
              const uRes = await fetch("/api/kinorium/watched", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...buildQpPayload(item), watched: curWatched }),
              });
              const uData = await uRes.json();
              if (uRes.ok && uData?.ok !== false && !uData?.error) {
                item.kinorium = uData;
                if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
                patchCatalogItemKinoriumInPlace(item, uData);
              }
            } catch (_) {}
          },
        }
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
      if (!res.ok || updated?.ok === false || updated?.error) {
        throw new Error(updated?.error || `HTTP ${res.status}`);
      }
      item.kinorium = updated;
      if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
      patchCatalogItemKinoriumInPlace(item, updated);
      showToast(
        updated.not_watching
          ? t(`«${displayTitle(item)}» в Не буду смотреть`, `"${displayTitle(item)}" added to Won't watch`)
          : t("Убрано из Не буду смотреть", "Removed from Won't watch"),
        {
          undoText: t("Отменить", "Undo"),
          durationMs: 5000,
          onUndo: async () => {
            try {
              const uRes = await fetch("/api/kinorium/never", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildQpPayload(item)),
              });
              const uData = await uRes.json();
              if (uRes.ok && uData?.ok !== false && !uData?.error) {
                item.kinorium = uData;
                if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
                patchCatalogItemKinoriumInPlace(item, uData);
              }
            } catch (_) {}
          },
        }
      );
    });
  });

  const toggleCuratedBtn = document.getElementById("btn-toggle-curated-shelves");
  if (toggleCuratedBtn) {
    toggleCuratedBtn.classList.toggle("active", state.showCuratedShelves !== false);
    toggleCuratedBtn.onclick = () => {
      state.showCuratedShelves = state.showCuratedShelves === false;
      try {
        localStorage.setItem(CURATED_SHELVES_STORAGE_KEY, state.showCuratedShelves ? "true" : "false");
      } catch (_) {}
      toggleCuratedBtn.classList.toggle("active", state.showCuratedShelves);
      renderCatalogShelves();
      showToast(
        state.showCuratedShelves
          ? t("Персональные подборки на главной включены", "Curated shelves enabled")
          : t("Персональные подборки скрыты", "Curated shelves hidden")
      );
    };
  }

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

  const togglePlayerSidebarBtn = document.getElementById("btn-toggle-player-sidebar");
  if (togglePlayerSidebarBtn) {
    togglePlayerSidebarBtn.onclick = (e) => {
      e.stopPropagation();
      togglePlayerSidebarCollapsed(true);
    };
  }

  const playerGearBtn = document.getElementById("btn-player-gear");
  const playerGearPopover = document.getElementById("player-gear-popover");
  const closePlayerGearBtn = document.getElementById("btn-close-player-gear");
  if (playerGearBtn && playerGearPopover) {
    playerGearPopover.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isCustomSelectMenuOpen() && !e.target?.closest?.(".atv-cselect-btn, label[for]")) {
        closeCustomSelectMenu({ restoreFocus: false });
      }
    });
    playerGearBtn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = playerGearPopover.classList.contains("hidden");
      closeFloatingPopovers();
      if (willOpen) {
        playerGearPopover.classList.remove("hidden");
        playerGearBtn.classList.add("active");
        playerGearBtn.setAttribute("aria-expanded", "true");
        clampStagePopover(playerGearPopover);
      }
      syncVcPopoverOpenClass();
      wakeVideoControls();
    };
  }
  if (closePlayerGearBtn && playerGearPopover) {
    closePlayerGearBtn.onclick = (e) => {
      e.stopPropagation();
      closeCustomSelectMenu({ restoreFocus: false });
      playerGearPopover.classList.add("hidden");
      playerGearBtn?.classList.remove("active");
      playerGearBtn?.setAttribute("aria-expanded", "false");
      syncVcPopoverOpenClass();
      wakeVideoControls();
    };
  }
  const resetPlayerGearBtn = document.getElementById("btn-reset-player-gear");
  if (resetPlayerGearBtn) {
    resetPlayerGearBtn.onclick = (e) => {
      e.stopPropagation();
      const video = document.getElementById("native-video");
      if (video) {
        ensurePreservesPitch(video);
        video.playbackRate = 1.0;
      }
      const speedSel = document.getElementById("select-speed");
      if (speedSel) speedSel.value = "1";
      applyAudioBoostToVideo(video, 1.0, "flat");
      applyVideoCropToVideo(video, "contain");
      applySubtitleStylePrefs("medium", "semi");
      setSleepTimer("off");
      resetAudioOffset(false);
      resetSubtitleOffset(false);
      state.ambilightEnabled = true;
      state.autoSkipIntro = true;
      state.autoNextEpisode = true;
      const ambiToggle = document.getElementById("ambilight-toggle");
      if (ambiToggle) ambiToggle.checked = true;
      const introToggle = document.getElementById("auto-skip-intro-toggle");
      if (introToggle) introToggle.checked = true;
      const nextToggle = document.getElementById("auto-next-ep-toggle");
      if (nextToggle) nextToggle.checked = true;
      startAmbilightLoop();
      savePlayerPrefs({
        playbackRate: 1.0,
        audioBoost: 1.0,
        audioPreset: "flat",
        videoCrop: "contain",
        subSize: "medium",
        subBg: "semi",
        ambilightEnabled: true,
        autoSkipIntro: true,
        autoNextEpisode: true,
      });
      updatePlayerGearActiveDot();
      pushDesktopRemoteStateNow();
      showToast(t("Настройки плеера сброшены по умолчанию", "Player settings reset to defaults"));
    };
  }
  const playerInfoSidebar = document.querySelector("#player-modal .atv-info-sidebar");
  if (playerInfoSidebar) {
    playerInfoSidebar.addEventListener(
      "scroll",
      () => {
        playerInfoSidebar.classList.toggle("is-scrolled", playerInfoSidebar.scrollTop > 8);
      },
      { passive: true }
    );
  }

  const toggleGearHotkeysBtn = document.getElementById("btn-toggle-gear-hotkeys");
  const gearHotkeysBox = document.getElementById("gear-hotkeys-box");
  if (toggleGearHotkeysBtn && gearHotkeysBox) {
    toggleGearHotkeysBtn.onclick = (e) => {
      e.stopPropagation();
      const willShow = gearHotkeysBox.classList.contains("hidden");
      gearHotkeysBox.classList.toggle("hidden", !willShow);
      toggleGearHotkeysBtn.classList.toggle("active", willShow);
      toggleGearHotkeysBtn.setAttribute("aria-expanded", willShow ? "true" : "false");
      if (willShow && playerGearPopover) {
        requestAnimationFrame(() => {
          const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
          try {
            playerGearPopover.scrollTo({ top: playerGearPopover.scrollHeight, behavior: reduced ? "auto" : "smooth" });
          } catch (_) {
            playerGearPopover.scrollTop = playerGearPopover.scrollHeight;
          }
        });
      }
    };
  }

  document.querySelectorAll("#gear-speed-pills .gear-speed-pill").forEach((pill) => {
    pill.onclick = (e) => {
      e.stopPropagation();
      const rate = parseFloat(pill.dataset.speed) || 1.0;
      const video = document.getElementById("native-video");
      if (video) {
        ensurePreservesPitch(video);
        video.playbackRate = rate;
      }
      const speedSel = document.getElementById("select-speed");
      if (speedSel) {
        speedSel.value = String(rate);
      }
      savePlayerPrefs({ playbackRate: rate });
      updatePlayerGearActiveDot();
      pushDesktopRemoteStateNow();
      showToast(t(`Скорость: ${rate}x`, `Speed: ${rate}x`));
    };
  });

  document.getElementById("btn-gear-audio-minus")?.addEventListener("click", (e) => {
    e.stopPropagation();
    adjustAudioOffset(-0.05, true);
  });
  document.getElementById("gear-audio-offset-val")?.addEventListener("click", (e) => {
    e.stopPropagation();
    resetAudioOffset(true);
  });
  document.getElementById("btn-gear-audio-plus")?.addEventListener("click", (e) => {
    e.stopPropagation();
    adjustAudioOffset(0.05, true);
  });

  document.getElementById("btn-gear-sub-minus")?.addEventListener("click", (e) => {
    e.stopPropagation();
    adjustSubtitleOffset(-0.25, true);
  });
  document.getElementById("gear-sub-offset-val")?.addEventListener("click", (e) => {
    e.stopPropagation();
    resetSubtitleOffset(true);
  });
  document.getElementById("btn-gear-sub-plus")?.addEventListener("click", (e) => {
    e.stopPropagation();
    adjustSubtitleOffset(0.25, true);
  });

  document.getElementById("btn-video-err-retry")?.addEventListener("click", (e) => {
    e.stopPropagation();
    hideVideoStreamError();
    const v = document.getElementById("native-video");
    const { cur } = getEffectivePlaybackTiming(v);
    const curPos = cur > 5 ? cur : 0;
    if (state.activeSourceTab === "offline") {
      loadOfflineStreamForActiveTitle(curPos);
    } else if (state.activeSourceTab === "stremio") {
      loadStremioStreams(curPos);
    } else if (state.activeSourceTab === "backup4k") {
      loadBackup4KReleases(curPos);
    } else {
      state.tokenRefreshTimestamps = [];
      state.usedBackupUrls = new Set();
      loadHDRezkaStream(curPos, { forceRefresh: true });
    }
  });
  document.getElementById("btn-video-err-studio")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleErrorStudiosPanel();
  });
  document.getElementById("btn-video-err-studios-close")?.addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("video-error-studios-panel")?.classList.add("hidden");
  });
  document.getElementById("btn-video-err-4k")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isServiceEnabled("backup4k")) {
      state.forceAutoLaunchNextStream = true;
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
      const willOpen = kinStatusPopover.classList.contains("hidden");
      closeFloatingPopovers({ exceptId: "kinorium-status-popover" });
      if (willOpen) {
        kinStatusPopover.classList.remove("hidden");
        kinStatusMenuBtn.setAttribute("aria-expanded", "true");
        clampFloatingPopover(kinStatusPopover);
      } else {
        kinStatusPopover.classList.add("hidden");
        kinStatusMenuBtn.setAttribute("aria-expanded", "false");
      }
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
      document.querySelectorAll(".kin-sec-pill").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
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
      document.querySelectorAll(".type-pill").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      renderContinueWatching();
      if (state.kinoriumSection !== "all") {
        renderCatalogShelves();
      } else {
        loadCatalog();
      }
    };
  });

  // Service filter bar (#provider-filter-bar)
  document.querySelectorAll(".atv-pill").forEach((btn) => {
    btn.onclick = () => {
      const nextProv = btn.dataset.provider || "all";
      if (state.providerFilter === nextProv && nextProv !== "all") {
        state.providerFilter = "all";
      } else {
        state.providerFilter = nextProv;
      }
      if (state.providerFilter && state.providerFilter !== "all") {
        state.kinoriumSection = "all";
        document.querySelectorAll(".kin-sec-pill").forEach((b) => {
          const isAll = b.dataset.ksec === "all";
          b.classList.toggle("active", isAll);
          b.setAttribute("aria-selected", isAll ? "true" : "false");
        });
      }
      document.querySelectorAll(".atv-pill").forEach((b) => {
        const isCur = b.dataset.provider === state.providerFilter;
        b.classList.toggle("active", isCur);
        b.setAttribute("aria-pressed", isCur ? "true" : "false");
      });
      applyEnabledServicesVisibility();
      loadCatalog();
    };
  });

  document.querySelectorAll(".source-tab").forEach((tab) => {
    tab.onclick = () => switchSourceTab(tab.dataset.tab, null, { fromUserClick: true });
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
    if (state.activeSourceTab === "offline") {
      const chosenDl = (state.downloadsItems || []).find(
        (x) => String(x?.download_id || "") === String(e.target.value || "") && x.status === "completed"
      );
      if (chosenDl) {
        const video = document.getElementById("native-video");
        const { cur } = getEffectivePlaybackTiming(video);
        loadOfflineStreamForActiveTitle(cur || 0, chosenDl);
      }
      return;
    }
    if (
      (state.activeSourceTab === "backup4k" || state.activeSourceTab === "stremio") &&
      state.remuxMeta?.active
    ) {
      switchRemuxAudioTrack(parseInt(e.target.value, 10) || 0);
      return;
    }
    state.activeStudioId = String(e.target.value || "");
    const selectedOpt =
      e.target.options?.[e.target.selectedIndex] ||
      Array.from(e.target.options || []).find((o) => String(o.value) === String(e.target.value));
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
    loadHDRezkaStream(cur || 0, { forceRefresh: true });
  };

  const seasonSelectEl = document.getElementById("select-season");
  if (seasonSelectEl) {
    seasonSelectEl.onchange = async (e) => {
      if (seasonSelectEl.disabled) return;
      const prevSeason = state.activeSeason;
      const prevEpisode = state.activeEpisode;
      const prevNextCoords = getNextEpisodeCoords();
      const targetSeason = parseInt(e.target.value, 10) || 1;
      const effMap = resolveEffectiveSeasonsMap(state.activeItem, state.seasonsMap);
      const epsForSeason = effMap?.[String(targetSeason)];
      const targetEpisode = Array.isArray(epsForSeason) && epsForSeason.length > 0 ? epsForSeason[0] : 1;
      if (
        state.activeItem &&
        prevNextCoords &&
        targetSeason === prevNextCoords.season &&
        targetEpisode === prevNextCoords.episode &&
        hasStartedWatchingCurrentEpisode(state.activeItem, prevSeason, prevEpisode)
      ) {
        markOutgoingEpisodeWatched(state.activeItem, prevSeason, prevEpisode);
      }
      clearAutoplayNextTimer();
      state.autoplayCancelledThisEpisode = false;
      state.introSkippedThisEpisode = false;
      state.probeCreditsStartSec = 0;
      state.activeSeason = targetSeason;
      state.activeEpisode = targetEpisode;
      if (state.activeItem) {
        populateSeasonEpisodeSelectors(state.activeItem, effMap);
      }
      updateMiniPlayerTitle();
      const savedEpProg = getEpisodeProgress(state.activeItem, state.activeSeason, state.activeEpisode);
      const startSec =
        savedEpProg &&
        savedEpProg.current_time > 10 &&
        savedEpProg.pct < 95 &&
        !isEpisodeWatched(state.activeItem, state.activeSeason, state.activeEpisode)
          ? savedEpProg.current_time
          : 0;
      if (state.activeSourceTab === "offline") {
        resetVideoElementForStreamChange();
        await loadOfflineStreamForActiveTitle(startSec);
      } else if (state.activeSourceTab === "stremio") {
        resetVideoElementForStreamChange();
        await loadStremioStreams(startSec);
      } else if (state.activeSourceTab === "backup4k") {
        resetVideoElementForStreamChange();
        await loadBackup4KReleases(startSec);
      } else {
        await loadHDRezkaStream(startSec);
      }
      if (state.activeSourceTab !== "offline" && (typeof navigator === "undefined" || navigator.onLine !== false)) {
        await loadSkipIntroSegments();
      }
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
    const { cur } = getEffectivePlaybackTiming(video);
    const tokenStale =
      state.activeSourceTab === "hdrezka" &&
      (Boolean(video?.error) ||
        !url ||
        (state.streamMintedAt > 0 && Date.now() - Number(state.streamMintedAt || 0) > 12 * 60 * 1000));
    if (tokenStale) {
      state.tokenRefreshTimestamps = [];
      state.usedBackupUrls = new Set();
      loadHDRezkaStream(cur || 0, { forceRefresh: true });
      showToast(t(`Качество сохранено по умолчанию: ${qKey}`, `Default quality saved: ${qKey}`));
      pushDesktopRemoteStateNow();
      return;
    }
    if (url) {
      if (state.remuxMeta?.active) {
        const freshRemuxUrl = buildRemuxStreamEndpoint(state.remuxMeta, cur || 0);
        playVideoUrl(freshRemuxUrl, 0, state.playerSessionId, {
          keepRemuxMeta: true,
          newRemuxOffsetSec: cur || 0,
        });
      } else {
        playVideoUrl(url, cur || 0, state.playerSessionId);
      }
      showToast(t(`Качество сохранено по умолчанию: ${qKey}`, `Default quality saved: ${qKey}`));
      pushDesktopRemoteStateNow();
    }
  };

  const speedSelect = document.getElementById("select-speed");
  if (speedSelect) {
    speedSelect.onchange = (e) => {
      const rate = parseFloat(e.target.value) || 1.0;
      const video = document.getElementById("native-video");
      if (video) {
        ensurePreservesPitch(video);
        video.playbackRate = rate;
      }
      savePlayerPrefs({ playbackRate: rate });
      updatePlayerGearActiveDot();
      pushDesktopRemoteStateNow();
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
      pushDesktopRemoteStateNow();
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
          : item.year
          ? ` (${item.year})`
          : "";
      if (state.remuxMeta?.active && state.remuxMeta.rawSourceUrl) {
        const activeTrack =
          (state.remuxMeta.audioTracks || []).find(
            (tr) => Number(tr.audio_index ?? tr.index) === Number(state.remuxMeta.audioIndex)
          ) ||
          state.remuxMeta.audioTracks?.[0] ||
          null;
        const mp4Filename = `${itemTitle}${epTag} [${qKey}, ${state.activeStudioName || "Original"}].mp4`;
        const dlParams = new URLSearchParams({
          url: state.remuxMeta.rawSourceUrl,
          filename: mp4Filename,
          remux: "1",
          audio: String(state.remuxMeta.audioIndex ?? 0),
          vcodec: String(state.remuxMeta.videoCodec || ""),
          acodec: String(activeTrack?.codec || state.remuxMeta.audioCodec || ""),
          ch: String(activeTrack?.channels || state.remuxMeta.channels || 2),
          id: String(item.id || ""),
          kinorium_id: String(item.kinorium?.kinorium_id || item.kinorium_id || ""),
          title: String(item.title || ""),
          orig_title: String(item.orig_title || ""),
          media_type: String(item.media_type || "movie"),
        });
        const dlEndpoint = `/api/download-mp4?${dlParams.toString()}`;
        const a = document.createElement("a");
        a.href = dlEndpoint;
        a.download = mp4Filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast(t(`Начато скачивание: ${mp4Filename}`, `Download started: ${mp4Filename}`));
        return;
      }
      let streamUrl = state.qualities[qKey] || state.currentStreamUrl;
      if (streamUrl && streamUrl.startsWith("/api/downloads/stream/")) {
        const studioTag = state.activeStudioName || "Offline";
        const filename = `${itemTitle}${epTag} [${qKey}, ${studioTag}].mp4`;
        const sep = streamUrl.includes("?") ? "&" : "?";
        const a = document.createElement("a");
        a.href = `${streamUrl}${sep}download=1`;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast(t(`Сохранение копии файла: ${filename}`, `Saving file copy: ${filename}`));
        return;
      }
      if (
        streamUrl &&
        (streamUrl.startsWith("/api/remux-stream?") || streamUrl.startsWith("/api/proxy-stream?"))
      ) {
        try {
          const innerParams = new URLSearchParams(streamUrl.split("?")[1] || "");
          const innerSrc = innerParams.get("url") || innerParams.get("src") || "";
          if (innerSrc) streamUrl = innerSrc;
        } catch (_) {}
      }
      if (!streamUrl || streamUrl.includes(".m3u8") || !/^https?:\/\//i.test(streamUrl)) {
        showToast(
          t(
            "Прямой поток загружается — подождите пару секунд и нажмите снова",
            "Direct stream is loading — wait a couple of seconds and try again"
          )
        );
        return;
      }
      const studioTag = state.activeStudioName || state.activeSourceTab || "HDRezka";
      const filename = `${itemTitle}${epTag} [${qKey}, ${studioTag}].mp4`;
      const directParams = new URLSearchParams({
        url: streamUrl,
        filename,
        id: String(item.id || ""),
        kinorium_id: String(item.kinorium?.kinorium_id || item.kinorium_id || ""),
        title: String(item.title || ""),
        orig_title: String(item.orig_title || ""),
        media_type: String(item.media_type || "movie"),
      });
      const dlEndpoint = `/api/download-mp4?${directParams.toString()}`;
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
      updatePlayerGearActiveDot();
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

  const getItemMetaPayload = (it = state.activeItem) => ({
    id: it?.id,
    title: it?.title,
    orig_title: it?.orig_title,
    poster: it?.poster,
    backdrop: it?.backdrop,
    year: it?.year,
    media_type: it?.media_type,
    rezka_id: it?.rezka_id,
    rezka_url: it?.rezka_url,
    is_series_completed: resolveSeriesCompletedFlag(it),
  });
  const getActiveItemMetaPayload = () => getItemMetaPayload(state.activeItem);

  const watchingBtn = document.getElementById("btn-toggle-watching");
  if (watchingBtn) {
    watchingBtn.onclick = () => {
      if (!state.activeItem) return;
      const itemRef = state.activeItem;
      const metaSnapshot = getItemMetaPayload(itemRef);
      document.getElementById("kinorium-status-popover")?.classList.add("hidden");
      withKinoriumActionLock(`pl-watching:${itemRef.id}`, watchingBtn, async () => {
        const res = await fetch("/api/kinorium/watching", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metaSnapshot),
        });
        const kStatus = await res.json();
        if (!res.ok || kStatus?.ok === false || kStatus?.error) {
          throw new Error(kStatus?.error || `HTTP ${res.status}`);
        }
        itemRef.kinorium = kStatus;
        if (state.activeItem === itemRef) updateModalKinoriumHeader(kStatus);
        patchCatalogItemKinoriumInPlace(itemRef, kStatus);
        showToast(
          kStatus.watching
            ? t(`«${displayTitle(itemRef)}» в разделе Смотрю`, `"${displayTitle(itemRef)}" added to Watching`)
            : t("Убрано из Смотрю", "Removed from Watching"),
          {
            undoText: t("Отменить", "Undo"),
            durationMs: 5000,
            onUndo: async () => {
              try {
                const uRes = await fetch("/api/kinorium/watching", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(metaSnapshot),
                });
                const uData = await uRes.json();
                if (uRes.ok && uData?.ok !== false && !uData?.error) {
                  itemRef.kinorium = uData;
                  if (state.activeItem === itemRef) updateModalKinoriumHeader(uData);
                  patchCatalogItemKinoriumInPlace(itemRef, uData);
                }
              } catch (_) {}
            },
          }
        );
      });
    };
  }

  const plWatchedBtn = document.getElementById("btn-toggle-watched");
  if (plWatchedBtn) {
    plWatchedBtn.onclick = () => {
      if (!state.activeItem) return;
      const itemRef = state.activeItem;
      const metaSnapshot = getItemMetaPayload(itemRef);
      document.getElementById("kinorium-status-popover")?.classList.add("hidden");
      withKinoriumActionLock(`pl-watched:${itemRef.id}`, plWatchedBtn, async () => {
        const curWatched = Boolean(itemRef.kinorium?.watched);
        const sSnap = state.activeSeason;
        const eSnap = state.activeEpisode;
        const res = await fetch("/api/kinorium/watched", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...metaSnapshot,
            watched: !curWatched,
            season: sSnap,
            episode: eSnap,
          }),
        });
        const kStatus = await res.json();
        if (!res.ok || kStatus?.ok === false || kStatus?.error) {
          throw new Error(kStatus?.error || `HTTP ${res.status}`);
        }
        itemRef.kinorium = kStatus;
        if (state.activeItem === itemRef) {
          updateModalKinoriumHeader(kStatus);
          if (itemRef.media_type === "series") {
            populateSeasonEpisodeSelectors(
              itemRef,
              resolveEffectiveSeasonsMap(itemRef, state.seasonsMap)
            );
          }
        }
        patchCatalogItemKinoriumInPlace(itemRef, kStatus);
        pushDesktopRemoteStateNow();
        showToast(
          kStatus.watched
            ? t(`«${displayTitle(itemRef)}» отмечено просмотренным`, `"${displayTitle(itemRef)}" marked as watched`)
            : t("Снята отметка просмотренного", "Unmarked as watched"),
          {
            undoText: t("Отменить", "Undo"),
            durationMs: 5000,
            onUndo: async () => {
              try {
                const uRes = await fetch("/api/kinorium/watched", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    ...metaSnapshot,
                    watched: curWatched,
                    season: sSnap,
                    episode: eSnap,
                  }),
                });
                const uData = await uRes.json();
                if (uRes.ok && uData?.ok !== false && !uData?.error) {
                  itemRef.kinorium = uData;
                  if (state.activeItem === itemRef) {
                    updateModalKinoriumHeader(uData);
                    if (itemRef.media_type === "series") {
                      populateSeasonEpisodeSelectors(
                        itemRef,
                        resolveEffectiveSeasonsMap(itemRef, state.seasonsMap)
                      );
                    }
                  }
                  patchCatalogItemKinoriumInPlace(itemRef, uData);
                  pushDesktopRemoteStateNow();
                }
              } catch (_) {}
            },
          }
        );
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
      const itemRef = state.activeItem;
      const metaSnapshot = getItemMetaPayload(itemRef);
      document.getElementById("kinorium-status-popover")?.classList.add("hidden");
      withKinoriumActionLock(`pl-watchlist:${itemRef.id}`, plWatchlistBtn, async () => {
        const res = await fetch("/api/kinorium/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metaSnapshot),
        });
        const kStatus = await res.json();
        if (!res.ok || kStatus?.ok === false || kStatus?.error) {
          throw new Error(kStatus?.error || `HTTP ${res.status}`);
        }
        itemRef.kinorium = kStatus;
        if (state.activeItem === itemRef) {
          updateModalKinoriumHeader(kStatus);
          if (itemRef.media_type === "series") {
            populateSeasonEpisodeSelectors(
              itemRef,
              resolveEffectiveSeasonsMap(itemRef, state.seasonsMap)
            );
          }
        }
        patchCatalogItemKinoriumInPlace(itemRef, kStatus);
        pushDesktopRemoteStateNow();
        showToast(
          kStatus.in_watchlist
            ? t(`«${displayTitle(itemRef)}» в Буду смотреть`, `"${displayTitle(itemRef)}" added to Watchlist`)
            : t("Убрано из Буду смотреть", "Removed from Watchlist"),
          {
            undoText: t("Отменить", "Undo"),
            durationMs: 5000,
            onUndo: async () => {
              try {
                const uRes = await fetch("/api/kinorium/watchlist", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(metaSnapshot),
                });
                const uData = await uRes.json();
                if (uRes.ok && uData?.ok !== false && !uData?.error) {
                  itemRef.kinorium = uData;
                  if (state.activeItem === itemRef) {
                    updateModalKinoriumHeader(uData);
                  }
                  patchCatalogItemKinoriumInPlace(itemRef, uData);
                  pushDesktopRemoteStateNow();
                }
              } catch (_) {}
            },
          }
        );
      });
    };
  }

  const neverBtn = document.getElementById("btn-toggle-never");
  if (neverBtn) {
    neverBtn.onclick = () => {
      if (!state.activeItem) return;
      const itemRef = state.activeItem;
      const metaSnapshot = getItemMetaPayload(itemRef);
      document.getElementById("kinorium-status-popover")?.classList.add("hidden");
      withKinoriumActionLock(`pl-never:${itemRef.id}`, neverBtn, async () => {
        const res = await fetch("/api/kinorium/never", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metaSnapshot),
        });
        const kStatus = await res.json();
        if (!res.ok || kStatus?.ok === false || kStatus?.error) {
          throw new Error(kStatus?.error || `HTTP ${res.status}`);
        }
        itemRef.kinorium = kStatus;
        if (state.activeItem === itemRef) updateModalKinoriumHeader(kStatus);
        patchCatalogItemKinoriumInPlace(itemRef, kStatus);
        showToast(
          kStatus.not_watching
            ? t(`«${displayTitle(itemRef)}» в Не буду смотреть`, `"${displayTitle(itemRef)}" added to Won't watch`)
            : t("Убрано из Не буду смотреть", "Removed from Won't watch"),
          {
            undoText: t("Отменить", "Undo"),
            durationMs: 5000,
            onUndo: async () => {
              try {
                const uRes = await fetch("/api/kinorium/never", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(metaSnapshot),
                });
                const uData = await uRes.json();
                if (uRes.ok && uData?.ok !== false && !uData?.error) {
                  itemRef.kinorium = uData;
                  if (state.activeItem === itemRef) updateModalKinoriumHeader(uData);
                  patchCatalogItemKinoriumInPlace(itemRef, uData);
                }
              } catch (_) {}
            },
          }
        );
      });
    };
  }

  const postwatchStarsWrap = document.getElementById("postwatch-stars");
  const postwatchSaveBtn = document.getElementById("btn-save-postwatch");
  const postwatchCommentInp = document.getElementById("postwatch-comment");
  bindStarsHoverRange(postwatchStarsWrap);

  const submitPostWatchRating = (scoreVal, triggerCtrl, closeAfterSave = true) => {
    if (!state.activeItem) return;
    const itemRef = state.activeItem;
    const metaSnapshot = getItemMetaPayload(itemRef);
    const score = parseInt(scoreVal, 10) || 0;
    if (score <= 0) {
      showToast(t("Сначала выберите оценку от 1 до 10", "Choose a rating from 1 to 10 first"));
      return;
    }
    withKinoriumActionLock(`pl-rate:${itemRef.id}`, triggerCtrl, async () => {
      const comment = postwatchCommentInp ? postwatchCommentInp.value : "";
      const isEpisodeScope =
        itemRef.media_type === "series" && state.postwatchScope === "episode";

      if (isEpisodeScope) {
        const sNum = state.postwatchSeason || state.activeSeason || 1;
        const eNum = state.postwatchEpisode || state.activeEpisode || 1;
        const epMeta = getEpisodeDisplayMeta(sNum, eNum);
        const effMap = resolveEffectiveSeasonsMap(itemRef, state.seasonsMap);
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
            ...metaSnapshot,
            season: sNum,
            episode: eNum,
            episode_title: epMeta.realTitle || "",
            total_seasons: totalSeasons,
            total_episodes_in_season: totalEpsInSeason,
            is_series_completed: resolveSeriesCompletedFlag(itemRef),
            score: score,
            comment: comment,
          }),
        });
        const kStatus = await res.json();
        if (!res.ok || kStatus?.ok === false || kStatus?.error) {
          throw new Error(kStatus?.error || `HTTP ${res.status}`);
        }
        itemRef.kinorium = kStatus;
        state.catalogDirty = true;
        if (kStatus.kinorium_counts) {
          state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
          updateKinoriumSectionCounters();
        }
        if (state.activeItem === itemRef) {
          updateModalKinoriumHeader(kStatus);
          populateSeasonEpisodeSelectors(itemRef, effMap);
          updateCurrentEpisodeBar(itemRef, state.activeSeason, state.activeEpisode, false);
          renderPostWatchRatingState();
        }
        patchCatalogItemKinoriumInPlace(itemRef, kStatus);
        pushDesktopRemoteStateNow();
        if (closeAfterSave) {
          state.postwatchManual = false;
          state.postwatchHovered = false;
          document.getElementById("kinorium-postwatch-overlay")?.classList.add("hidden");
        }
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
          ...metaSnapshot,
          score: score,
          comment: comment,
        }),
      });
      const kStatus = await res.json();
      if (!res.ok || kStatus?.ok === false || kStatus?.error) {
        throw new Error(kStatus?.error || `HTTP ${res.status}`);
      }
      itemRef.kinorium = kStatus;
      if (kStatus.kinorium_counts) {
        state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
        updateKinoriumSectionCounters();
      }
      if (state.activeItem === itemRef) {
        updateModalKinoriumHeader(kStatus);
        renderPostWatchRatingState();
      }
      if (closeAfterSave) {
        state.postwatchManual = false;
        state.postwatchHovered = false;
        document.getElementById("kinorium-postwatch-overlay")?.classList.add("hidden");
      }
      patchCatalogItemKinoriumInPlace(itemRef, kStatus);
      pushDesktopRemoteStateNow();
      showToast(
        kStatus.remote_synced
          ? t(`Оценка ${score}/10 синхронизирована с Kinorium`, `Rating ${score}/10 synced to Kinorium`)
          : t(`Оценка ${score}/10 сохранена локально`, `Rating ${score}/10 saved locally`)
      );
    });
  };

  document.querySelectorAll("#postwatch-stars button").forEach((btn) => {
    btn.onclick = () => {
      const score = parseInt(btn.dataset.score, 10) || 0;
      state.postwatchSelectedScore = score;
      document.querySelectorAll("#postwatch-stars button").forEach((b) => {
        const sc = parseInt(b.dataset.score, 10) || 0;
        b.classList.toggle("active-star", sc === score);
        b.classList.toggle("in-score-range", sc > 0 && sc < score);
      });
      const hasTypedComment = Boolean((postwatchCommentInp?.value || "").trim());
      submitPostWatchRating(score, postwatchStarsWrap || btn, hasTypedComment);
    };
  });

  if (postwatchSaveBtn) {
    postwatchSaveBtn.onclick = () => {
      submitPostWatchRating(state.postwatchSelectedScore, postwatchSaveBtn, true);
    };
  }
  if (postwatchCommentInp) {
    postwatchCommentInp.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") {
        e.stopPropagation();
      }
      if (e.key === "Enter") {
        e.preventDefault();
        submitPostWatchRating(state.postwatchSelectedScore, postwatchSaveBtn || postwatchCommentInp, true);
      }
    });
  }

  const postwatchClearBtn = document.getElementById("postwatch-clear-rate-btn");
  if (postwatchClearBtn) {
    postwatchClearBtn.onclick = () => {
      if (!state.activeItem) return;
      const itemRef = state.activeItem;
      const metaSnapshot = getItemMetaPayload(itemRef);
      withKinoriumActionLock(`pl-rate:${itemRef.id}`, postwatchClearBtn, async () => {
        const isEpisodeScope =
          itemRef.media_type === "series" && state.postwatchScope === "episode";
        if (isEpisodeScope) {
          const sNum = state.postwatchSeason || state.activeSeason || 1;
          const eNum = state.postwatchEpisode || state.activeEpisode || 1;
          const effMap = resolveEffectiveSeasonsMap(itemRef, state.seasonsMap);
          const res = await fetch("/api/kinorium/rate-episode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...metaSnapshot,
              season: sNum,
              episode: eNum,
              score: 0,
              clear: true,
            }),
          });
          const kStatus = await res.json();
          if (!res.ok || kStatus?.ok === false || kStatus?.error) {
            throw new Error(kStatus?.error || `HTTP ${res.status}`);
          }
          itemRef.kinorium = kStatus;
          state.catalogDirty = true;
          if (kStatus.kinorium_counts) {
            state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
            updateKinoriumSectionCounters();
          }
          if (state.activeItem === itemRef) {
            updateModalKinoriumHeader(kStatus);
            populateSeasonEpisodeSelectors(itemRef, effMap);
            updateCurrentEpisodeBar(itemRef, state.activeSeason, state.activeEpisode, false);
            renderPostWatchRatingState();
          }
          patchCatalogItemKinoriumInPlace(itemRef, kStatus);
          pushDesktopRemoteStateNow();
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
            ...metaSnapshot,
            score: 0,
            clear: true,
          }),
        });
        const kStatus = await res.json();
        if (!res.ok || kStatus?.ok === false || kStatus?.error) {
          throw new Error(kStatus?.error || `HTTP ${res.status}`);
        }
        itemRef.kinorium = kStatus;
        if (kStatus.kinorium_counts) {
          state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
          updateKinoriumSectionCounters();
        }
        if (state.activeItem === itemRef) {
          updateModalKinoriumHeader(kStatus);
          renderPostWatchRatingState();
        }
        patchCatalogItemKinoriumInPlace(itemRef, kStatus);
        pushDesktopRemoteStateNow();
        showToast(
          kStatus.remote_synced
            ? t("Оценка удалена в Kinorium", "Rating removed on Kinorium")
            : t("Локальная оценка удалена", "Local rating removed")
        );
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
  document.getElementById("about-update-check-btn")?.addEventListener("click", () => {
    checkAppUpdates({ force: true, silent: false });
  });
  document.getElementById("about-update-action-btn")?.addEventListener("click", () => {
    startAppUpdateDownload();
  });
  document.getElementById("cfg-auto-check-updates")?.addEventListener("change", () => {
    saveUpdaterSettingsImmediate();
  });
  ["cfg-update-repo", "cfg-update-manifest-url"].forEach((id) => {
    const inp = document.getElementById(id);
    if (!inp) return;
    inp.addEventListener("change", () => {
      saveUpdaterSettingsImmediate();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        checkAppUpdates({ force: true, silent: false });
      }
    });
  });
  document.getElementById("btn-copy-lan-url")?.addEventListener("click", async () => {
    const urlText = state.systemStatus?.lan_url || document.getElementById("lan-url-code")?.textContent || "";
    if (!urlText) return;
    const copied = await copyTextToClipboard(urlText);
    if (copied) {
      showToast(t(`Адрес скопирован: ${urlText}`, `Copied URL: ${urlText}`));
    }
  });

  async function requestCloseSettingsModal() {
    const settingsModEl = document.getElementById("settings-modal");
    if (!settingsModEl || settingsModEl.classList.contains("hidden")) return true;
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
      if (!discard) return false;
      resetUnsavedSettingsInputs();
    }
    closeCustomSelectMenu({ restoreFocus: false });
    settingsModEl.classList.add("hidden");
    state.verifiedKidsAdminPin = "";
    syncScrollTopButton();
    restoreModalTriggerFocus("settings-modal");
    return true;
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
  document.getElementById("settings-country-select")?.addEventListener("change", (e) => {
    changeUserCountryInstant(e.target.value);
  });
  document.getElementById("btn-open-onboarding-wizard")?.addEventListener("click", () => {
    openOnboardingModal({ isFirstRun: false });
  });
  document.getElementById("close-onboarding-modal")?.addEventListener("click", () => {
    closeOnboardingModal({ reopenSettings: true });
  });
  document.getElementById("btn-onboarding-skip")?.addEventListener("click", () => {
    skipOnboardingModal();
  });
  document.getElementById("btn-onboarding-back")?.addEventListener("click", () => {
    setOnboardingStep((state.onboardingStep || 1) - 1);
  });
  document.getElementById("btn-onboarding-next")?.addEventListener("click", () => {
    setOnboardingStep((state.onboardingStep || 1) + 1);
  });
  document.querySelectorAll("#ob-stepper [data-ob-step-btn]").forEach((stepBtn) => {
    stepBtn.addEventListener("click", () => {
      setOnboardingStep(Number(stepBtn.dataset.obStepBtn) || 1);
    });
  });
  document.getElementById("btn-onboarding-finish")?.addEventListener("click", () => {
    submitOnboardingModal();
  });
  document.getElementById("onboarding-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "onboarding-modal" && !state.onboardingIsFirstRun) {
      closeOnboardingModal({ reopenSettings: true });
    }
  });
  document.getElementById("reset-settings-btn")?.addEventListener("click", () => {
    resetUnsavedSettingsInputs();
    showToast(t("Изменения сброшены", "Unsaved changes reset"));
  });

  [
    "cfg-spoof-region",
    "cfg-custom-mirror",
    "cfg-proxy-url",
    "cfg-cf-worker",
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
      closeCustomSelectMenu({ restoreFocus: false });
      document.getElementById("settings-modal").classList.add("hidden");
      state.verifiedKidsAdminPin = "";
      syncScrollTopButton();
      restoreModalTriggerFocus("settings-modal");
      return;
    }
    const adminPinFields = state.verifiedKidsAdminPin
      ? { pin: state.verifiedKidsAdminPin, current_pin: state.verifiedKidsAdminPin }
      : {};
    const kinDirty = isKinoriumQuickFormDirty();
    const spoofRegion = document.getElementById("cfg-spoof-region").value;
    const kinQuickUser = (document.getElementById("kin-quick-user-input")?.value || "").trim();
    const kinQuickCookie = (document.getElementById("kin-quick-cookie-input")?.value || "").trim();
    const debridKeyVal = (document.getElementById("cfg-debrid-key")?.value || "").trim();
    const payload = {
      ...adminPinFields,
      hdrezka: {
        spoof_region: spoofRegion,
        custom_mirror: document.getElementById("cfg-custom-mirror").value,
        proxy_url: document.getElementById("cfg-proxy-url").value,
        cf_worker_relay: document.getElementById("cfg-cf-worker")?.value || "",
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
        auto_scrobble_threshold: 0.95,
      };
    }
    let res;
    let data = {};
    try {
      res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      data = await res.json().catch(() => ({}));
    } catch (_) {
      showToast(t("Не удалось сохранить настройки", "Failed to save settings"));
      return;
    }
    if (!res.ok || data?.ok === false || data?.error) {
      showToast(data?.error || t("Не удалось сохранить настройки", "Failed to save settings"));
      return;
    }
    if (data.integrations) state.integrations = data.integrations;
    if (kinDirty && isServiceEnabled("kinorium") && kinQuickUser) {
      try {
        const syncPayload = { user_id: kinQuickUser, ...adminPinFields };
        if (kinQuickCookie) syncPayload.session_cookie = kinQuickCookie;
        const syncRes = await fetch("/api/kinorium/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(syncPayload),
        });
        const syncData = await syncRes.json();
        if (!syncRes.ok || syncData?.ok === false || syncData?.error) {
          showToast(
            syncData?.error ||
              syncData?.sync?.error ||
              t("Ошибка синхронизации Kinorium", "Kinorium sync error")
          );
        } else {
          if (syncData.kinorium_account) {
            state.kinoriumAccount = syncData.kinorium_account;
            updateKinoriumUserBadge();
            renderHeaderProfileSwitcher();
          }
          if (syncData.integrations) state.integrations = syncData.integrations;
          if (!syncData.sync?.error) {
            state.kinoriumFormExpanded = false;
          }
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
    closeCustomSelectMenu({ restoreFocus: false });
    document.getElementById("settings-modal").classList.add("hidden");
    state.verifiedKidsAdminPin = "";
    syncScrollTopButton();
    restoreModalTriggerFocus("settings-modal");
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
      if (!payload) return;
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
        if (!payload) return;
        const jsonStr = JSON.stringify(payload, null, 2);
        const copied = await copyTextToClipboard(jsonStr);
        if (copied) {
          showToast(t("Резервная копия скопирована в буфер обмена", "Backup copied to clipboard"));
        } else {
          showToast(
            t(
              "Не удалось скопировать в буфер — используйте «Скачать Backup (.json)»",
              'Could not copy to clipboard — use "Download Backup (.json)"'
            )
          );
        }
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

  const openManualBackupPasteBox = () => {
    const parentTab = document.getElementById("stab-backup");
    if (!parentTab) return;
    let pasteBox = document.getElementById("backup-manual-paste-box");
    if (!pasteBox) {
      pasteBox = document.createElement("div");
      pasteBox.id = "backup-manual-paste-box";
      pasteBox.className = "atv-backup-paste-box";
      pasteBox.innerHTML = `
        <div class="atv-backup-paste-label">${escapeHtml(
          t(
            "Вставьте JSON резервной копии CineFlow ниже и нажмите «Восстановить»:",
            "Paste your CineFlow backup JSON below and click Restore:"
          )
        )}</div>
        <textarea id="backup-manual-paste-textarea" class="atv-backup-paste-textarea" rows="4" placeholder="{ &quot;app&quot;: &quot;CineFlow&quot;, ... }"></textarea>
        <div class="atv-backup-paste-actions">
          <button type="button" class="atv-btn-secondary atv-btn-xs" id="btn-cancel-backup-paste">${escapeHtml(
            t("Отмена", "Cancel")
          )}</button>
          <button type="button" class="atv-btn-primary atv-btn-xs" id="btn-apply-backup-paste">${escapeHtml(
            t("Восстановить", "Restore")
          )}</button>
        </div>
      `;
      parentTab.appendChild(pasteBox);
      pasteBox.querySelector("#btn-cancel-backup-paste")?.addEventListener("click", () => {
        pasteBox.classList.add("hidden");
      });
      pasteBox.querySelector("#btn-apply-backup-paste")?.addEventListener("click", async () => {
        const ta = pasteBox.querySelector("#backup-manual-paste-textarea");
        const rawText = (ta?.value || "").trim();
        if (!rawText) {
          ta?.focus();
          return;
        }
        try {
          const parsed = JSON.parse(rawText);
          const ok = await restoreFromBackupObject(parsed);
          if (ok) {
            if (ta) ta.value = "";
            pasteBox.classList.add("hidden");
          }
        } catch (_) {
          showToast(
            t(
              "Текст не является корректным JSON резервной копии CineFlow",
              "Text is not a valid CineFlow backup JSON"
            )
          );
        }
      });
    }
    pasteBox.classList.remove("hidden");
    const ta = pasteBox.querySelector("#backup-manual-paste-textarea");
    if (ta) {
      ta.focus();
    }
  };

  const pasteBackupClipboardBtn = document.getElementById("btn-paste-backup-clipboard");
  if (pasteBackupClipboardBtn) {
    pasteBackupClipboardBtn.onclick = async () => {
      if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
        openManualBackupPasteBox();
        return;
      }
      pasteBackupClipboardBtn.disabled = true;
      try {
        const rawText = await navigator.clipboard.readText();
        if (!rawText || !rawText.trim()) {
          openManualBackupPasteBox();
          return;
        }
        const parsed = JSON.parse(rawText);
        await restoreFromBackupObject(parsed);
      } catch (err) {
        if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
          openManualBackupPasteBox();
        } else {
          showToast(
            t(
              "В буфере обмена нет корректного JSON резервной копии CineFlow",
              "Clipboard does not contain a valid CineFlow backup JSON"
            )
          );
        }
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

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCineFlowApp);
  } else {
    initCineFlowApp();
  }
}
