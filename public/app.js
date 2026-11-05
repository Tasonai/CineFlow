import {
  CURATED_SHELVES_STORAGE_KEY,
  EP_VIEW_MODE_STORAGE_KEY,
  RECENT_SEARCHES_STORAGE_KEY,
  UI_PREFS_STORAGE_KEY,
  profileStorageKey,
  state,
} from "./js/state.js?v=20261104v28";
import {
  applyStaticDomTranslations,
  displayPoster,
  displayTitle,
  isEn,
  secondaryTitle,
  syncLanguageSegmentedControlUI,
  t,
} from "./js/i18n.js?v=20261104v28";
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
  syncScrollTopButton,
  syncSearchInputHasQueryUI,
  trapModalTabKey,
  triggerVideoCenterIndicator,
  withKinoriumActionLock,
} from "./js/utils.js?v=20261104v28";
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
} from "./js/audio-dsp.js?v=20261104v28";
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
} from "./js/catalog.js?v=20261104v28";
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
} from "./js/modals.js?v=20261104v28";
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
} from "./js/player.js?v=20261104v28";
import {
  adjustSubtitleOffset,
  bindSubtitleFileAndDropListeners,
  closeSubtitleDictPopover,
  resetSubtitleOffset,
  syncSubtitleOffsetUI,
} from "./js/subtitles.js?v=20261104v28";
import {
  initDesktopRemoteAgent,
  initMobileRemoteController,
  isMobileRemoteUrl,
  pushDesktopRemoteStateNow,
} from "./js/remote.js?v=20261104v28";
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
  triggerLanSync,
} from "./js/settings.js?v=20261104v28";
import {
  initBookmarksListeners,
  openBookmarksModal,
} from "./js/player-bookmarks.js?v=20261104v28";
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
} from "./js/features.js?v=20261104v28";
import { openDownloadsModal, setOfflineMode } from "./js/features-downloads.js?v=20261104v28";
import {
  initCatalogLiveSearch,
  closeLiveSearchPopover,
  resetCatalogFiltersForGlobalSearch,
  syncSearchClearButton,
} from "./js/catalog-live-search.js?v=20261104v28";
import { initGlobalHotkeys } from "./js/app-hotkeys.js?v=20261104v28";

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

  const toggleCuratedBtn = document.getElementById("btn-toggle-curated-shelves");
  if (toggleCuratedBtn) {
    toggleCuratedBtn.classList.toggle("active", state.showCuratedShelves !== false);
    toggleCuratedBtn.onclick = () => {
      state.showCuratedShelves = state.showCuratedShelves === false;
      try {
        localStorage.setItem(CURATED_SHELVES_STORAGE_KEY, state.showCuratedShelves ? "true" : "false");
      } catch (err) { window.logDebug?.("App", err); }
      toggleCuratedBtn.classList.toggle("active", state.showCuratedShelves);
      renderCatalogShelves();
      showToast(
        state.showCuratedShelves
          ? t("Персональные подборки на главной включены", "Curated shelves enabled")
          : t("Персональные подборки скрыты", "Curated shelves hidden")
      );
    };
  }

  const btnOpenRelCal = document.getElementById("btn-open-release-calendar");
  if (btnOpenRelCal) {
    btnOpenRelCal.onclick = (e) => {
      e?.stopPropagation();
      const shelf = document.getElementById("release-calendar-shelf");
      if (shelf && !shelf.classList.contains("hidden")) {
        shelf.scrollIntoView({ behavior: "smooth", block: "start" });
        const firstCard = shelf.querySelector(".atv-cal-shelf-card");
        if (firstCard) firstCard.focus();
      } else {
        closeFloatingPopovers();
        switchNotificationsTab("calendar");
        const notifPopover = document.getElementById("notifications-popover");
        const notifBellBtn = document.getElementById("notifications-bell-btn");
        if (notifPopover) {
          notifPopover.classList.remove("hidden");
          notifBellBtn?.classList.add("active");
          notifBellBtn?.setAttribute("aria-expanded", "true");
          clampFloatingPopover(notifPopover, { isHeader: true });
        }
      }
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
    } catch (err) { window.logDebug?.("App", err); }
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
            } catch (err) { window.logDebug?.("App", err); }
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
      } catch (err) { window.logDebug?.("App", err); }
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
        } catch (err) { window.logDebug?.("App", err); }
      });
      loadCatalog();
    };
  });

  // Single unified Content Type switcher (#media-type-bar): Все | Фильмы | Сериалы | Скачано
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
      if (state.kinoriumSection !== "all" || nextType === "offline") {
        renderCatalogShelves();
      } else {
        loadCatalog();
      }
    };
  });

  // Offline status banner actions
  const btnOfflineView = document.getElementById("btn-offline-banner-view");
  if (btnOfflineView) {
    btnOfflineView.onclick = () => {
      const offlinePill = document.getElementById("type-pill-offline");
      if (offlinePill && !offlinePill.classList.contains("hidden")) {
        offlinePill.click();
      } else {
        openDownloadsModal();
      }
    };
  }

  const btnOfflineRetry = document.getElementById("btn-offline-banner-retry");
  if (btnOfflineRetry) {
    btnOfflineRetry.onclick = async () => {
      showToast(t("Проверяем подключение к сети...", "Checking network connection..."));
      try {
        const res = await fetch("/api/system/status", { cache: "no-store" });
        if (res.ok) {
          setOfflineMode(false);
          showToast(t("Подключение успешно восстановлено", "Connection restored successfully"));
          loadCatalog({ showLoading: true });
        } else {
          showToast(t("Сеть пока недоступна", "Network is still unavailable"));
        }
      } catch (_) {
        showToast(t("Сеть пока недоступна", "Network is still unavailable"));
      }
    };
  }

  window.addEventListener("online", () => {
    setOfflineMode(false);
    showToast(t("Подключение к сети восстановлено", "Network connection restored"));
    loadCatalog();
  });

  window.addEventListener("offline", () => {
    setOfflineMode(true);
    showToast(t("Офлайн-режим: доступны скачанные фильмы и серии", "Offline mode: downloaded movies and series available"));
    renderCatalogShelves();
  });

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setOfflineMode(true);
  }

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
        } catch (err) { window.logDebug?.("App", err); }
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

  document.getElementById("btn-sync-lan-now")?.addEventListener("click", async () => {
    await triggerLanSync();
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
      } catch (err) { window.logDebug?.("App", err); }
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
