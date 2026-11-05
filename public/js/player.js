import { state } from "./state.js?v=20261105v2";
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
  mergeIncomingItemGenres,
  secondaryTitle,
  t,
  translateGenre,
  translateSizeLabel,
  translateStudioName,
} from "./i18n.js?v=20261105v2";
import {
  clampFloatingPopover,
  clampStagePopover,
  closeCustomSelectMenu,
  closeFloatingPopovers,
  copyTextToClipboard,
  escapeAttr,
  escapeHtml,
  expandRussianDateText,
  findAllOfflineDownloadsForTitle,
  findOfflineDownloadForTitle,
  formatDurationLabel,
  formatTime,
  genitiveAfterIz,
  getEpisodeProgress,
  getSimilarReasonLabel,
  getSimilarSectionSourceLabel,
  iconSvg,
  initCustomSelects,
  pluralRu,
  recordWatchHistoryEntry,
  rememberModalTriggerFocus,
  resolveClientSimilarBundle,
  restoreModalTriggerFocus,
  saveEpisodeProgress,
  setAmbientColor,
  showToast,
  showVideoOsd,
  supportsNativePiP,
  syncCustomSelect,
  syncScrollTopButton,
  syncSearchInputHasQueryUI,
  syncToastContainerMount,
  triggerVideoCenterIndicator,
} from "./utils.js?v=20261105v2";
import {
  applyAudioBoostToVideo,
  applySavedPlayerPrefsToVideo,
  ensurePreservesPitch,
  ensureUnlockedAudioContext,
  getPlayerPrefs,
  isVideoInPiP,
  pickBestQualityKey,
  pickPreferredSubtitleIndex,
  resumeAudioContextIfNeeded,
  sampleAmbilightFrame,
  savePlayerPrefs,
  startAmbilightLoop,
  stopAmbilightLoop,
  togglePictureInPicture,
  updatePlayerGearActiveDot,
} from "./audio-dsp.js?v=20261105v2";
import {
  applyEnabledServicesVisibility,
  attachSmartPosterFallback,
  getDefaultPlayableSourceTab,
  getPreferredStudioForItem,
  savePreferredStudioForItem,
  isAnyOfficialPlServiceEnabled,
  isEpisodeWatched,
  isServiceEnabled,
  loadCatalog,
  patchCatalogItemKinoriumInPlace,
  renderCatalogShelves,
  renderContinueWatching,
  resolveSeriesEpisodeInfo,
  updateActiveFiltersBadge,
  updateDynamicCatalogFilters,
  updateKinoriumSectionCounters,
} from "./catalog.js?v=20261105v2";
import {
  closePersonModal,
  closeQuickPeekModal,
  openPersonModal,
  openQuickPeekModal,
  refreshOpenPersonModalUI,
  renderModalCastSection,
} from "./modals.js?v=20261105v2";
import { confirmServiceLogin, triggerServiceLoginFlow } from "./settings.js?v=20261105v2";
import {
  refreshDownloadsState,
  sweepPendingDownloadCleanups,
  syncNativeNowPlaying,
} from "./features.js?v=20261105v2";
import {
  activateSelectedSubtitleTrack,
  adjustSubtitleOffset,
  attachVideoSubtitles,
  bindSubtitleFileAndDropListeners,
  buildRemuxSubtitlesList,
  clearCustomSubtitleOverlay,
  closeSubtitleDictPopover,
  decodeSubtitleArrayBuffer,
  formatSubtitleOffsetLabel,
  loadLocalSubtitleFile,
  mergeCustomExternalSubtitles,
  parseSubtitleCues,
  populateSubtitlesSelector,
  refreshRemuxSubtitleTracks,
  renderVcSubtitlesPopover,
  resetSubtitleOffset,
  searchOnlineSubtitlesForActiveTitle,
  syncIosFullscreenNativeSubtitles,
  syncSubtitleOffsetUI,
  triggerLocalSubtitleFilePicker,
  updateCustomSubtitleOverlay,
} from "./subtitles.js?v=20261105v2";
import { pushDesktopRemoteStateNow } from "./remote.js?v=20261105v2";
import {
  clearVideoStallWatchdog,
  getRenderedVideoFrameCount,
  initVideoFrameCounter,
  recoverFrozenVideoPlayback,
  getVideoForwardBufferSec,
  checkVideoPlaybackFreeze,
} from "./player-watchdog.js?v=20261105v2";
import {
  estimateItemDurationSec,
  buildRemuxStreamEndpoint,
  getEffectivePlaybackTiming,
  formatAudioOffsetLabel,
  syncAudioOffsetUI,
  scheduleRemuxFullDurationProbe,
  prepareRemuxAudioSwitch,
} from "./player-remux.js?v=20261105v2";
import {
  hasOpenVcPopover,
  closeAllVcPopovers,
  isStageFullscreen,
  setPseudoStageFullscreen as _setPseudoStageFullscreen,
  setVideoStageIdle,
  wakeVideoControls,
  syncCustomVideoControlsUI,
  beginFullscreenTransitionWindow,
  toggleStageFullscreen,
  getSnappingRatio,
  initCustomVideoControls,
  initPlayerStageAndGearBindings,
  syncVcPopoverOpenClass,
  positionStagePopover,
  toggleQuickOriginalAudio,
  syncCustomControlPopovers,
} from "./player-ui-controls.js?v=20261105v2";
import {
  getNextEpisodeCoords,
  showPlayerNextEpisodeToast,
  dismissPlayerNextEpisodeToast,
  setSleepTimer,
  clearAutoplayNextTimer,
  isPostwatchCardPausingAutoplay,
  startAutoplayNextCountdown,
} from "./player-autoplay.js?v=20261105v2";
import {
  syncPipDockUI,
  setPipBackgroundMode,
  restoreFullPlayerFromPip,
  updateMiniPlayerTitle,
  setMiniPlayerMode,
} from "./player-pip-dock.js?v=20261105v2";
import {
  escapeEpisodeHtml,
  getEpisodeDisplayMeta,
  getEpisodeRatingEntry,
  updateCurrentEpisodeBar,
  resolveEffectiveSeasonsMap,
  populateSeasonEpisodeSelectors,
  syncEpisodesStripDrawerUI,
  switchToSeriesSeasonEpisode,
  stepEpisode,
  resolveSeriesCompletedFlag,
  markEpisodesBatch,
  toggleCurrentEpisodeWatched,
  hasStartedWatchingCurrentEpisode,
  markOutgoingEpisodeWatched,
} from "./player-seasons.js?v=20261105v2";
import {
  isHdRezkaStreamDeadOrExpired as _isHdRezkaStreamDeadOrExpired,
  _localizeOfflineSubLabel,
  loadOfflineStreamForActiveTitle,
  syncDownloadButtonVisibility,
  abortActiveVideoListeners,
  switchSourceTab,
  loadOfficialServiceTab,
  resetVideoElementForStreamChange,
  renderTrailerEmbed,
  loadTrailerTab,
  hideVideoStreamError,
  showVideoStreamError,
  switchHdRezkaStudio,
  renderErrorStudiosPanel,
  toggleErrorStudiosPanel,
  buildNextEpisodePreloadKey,
  preloadNextEpisodeIfNeeded,
  loadHDRezkaStream,
  adjustAudioOffset,
  resetAudioOffset,
  seekEffectivePlayback,
  switchRemuxAudioTrack,
  probeAndPlay4KStream,
  renderStremioStreamsList,
  loadStremioStreams,
  loadBackup4KReleases,
  _tryRecoverHdRezkaPlayback as _tryRecoverHdRezkaPlaybackImpl,
} from "./player-streams.js?v=20261105v2";
import {
  OFFICIAL_STREAMING_SERVICES,
  _mergeItemProviders,
  fetchAndApplyPlayerTitleMeta,
  syncPlayerSidebarCollapsedUI,
  togglePlayerSidebarCollapsed,
  filterCatalogByGenreFromPlayer,
  renderModalGenresAndSubheader,
  updateModalKinoriumHeader,
  getOfficialServiceTargetUrl,
  renderModalProvidersSidebar,
  renderModalSimilarItems,
  captureVideoScreenshot,
  syncMediaSessionMetadata,
} from "./player-meta.js?v=20261105v2";
import {
  hideXRayPauseShelf,
  showXRayPauseShelf,
  getSavedMoments,
  saveMoments,
  toggleBookmarkCurrentMoment,
  renderTimelineBookmarks,
} from "./player-bookmarks.js?v=20261105v2";
import {
  syncPostwatchOverlayMount,
  renderPostWatchRatingState,
  maybeAutoOpenCreditsRatingCard,
  openPostWatchRatingOverlay,
  initPlayerStatusAndRatingBindings,
  rateActivePlayerTitle as _rateActivePlayerTitle,
  toggleActivePlayerWatched as _toggleActivePlayerWatched,
} from "./player-rating.js?v=20261105v2";

export {
  syncPostwatchOverlayMount,
  renderPostWatchRatingState,
  maybeAutoOpenCreditsRatingCard,
  openPostWatchRatingOverlay,
  initPlayerStatusAndRatingBindings,
};

export async function toggleActivePlayerWatched() {
  return _toggleActivePlayerWatched();
}

export async function rateActivePlayerTitle(options = {}) {
  return _rateActivePlayerTitle(options);
}

import {
  getDetectedCreditsStartSec,
  renderTimelineChapterMarkers,
  loadSkipIntroSegments,
} from "./player-intro-credits.js?v=20261105v2";

export {
  getDetectedCreditsStartSec,
  renderTimelineChapterMarkers,
  loadSkipIntroSegments,
};

import { reportScrobbleProgress } from "./player-scrobble.js?v=20261105v2";

export { reportScrobbleProgress };

export {
  hideXRayPauseShelf,
  showXRayPauseShelf,
  getSavedMoments,
  saveMoments,
  toggleBookmarkCurrentMoment,
  renderTimelineBookmarks,
};

export {
  OFFICIAL_STREAMING_SERVICES,
  _mergeItemProviders,
  fetchAndApplyPlayerTitleMeta,
  syncPlayerSidebarCollapsedUI,
  togglePlayerSidebarCollapsed,
  filterCatalogByGenreFromPlayer,
  renderModalGenresAndSubheader,
  updateModalKinoriumHeader,
  getOfficialServiceTargetUrl,
  renderModalProvidersSidebar,
  renderModalSimilarItems,
  captureVideoScreenshot,
  syncMediaSessionMetadata,
};

export {
  getNextEpisodeCoords,
  showPlayerNextEpisodeToast,
  dismissPlayerNextEpisodeToast,
  setSleepTimer,
  clearAutoplayNextTimer,
  isPostwatchCardPausingAutoplay,
  startAutoplayNextCountdown,
};

export {
  syncPipDockUI,
  setPipBackgroundMode,
  restoreFullPlayerFromPip,
  updateMiniPlayerTitle,
  setMiniPlayerMode,
};

export {
  escapeEpisodeHtml,
  getEpisodeDisplayMeta,
  getEpisodeRatingEntry,
  updateCurrentEpisodeBar,
  resolveEffectiveSeasonsMap,
  populateSeasonEpisodeSelectors,
  syncEpisodesStripDrawerUI,
  switchToSeriesSeasonEpisode,
  stepEpisode,
  resolveSeriesCompletedFlag,
  markEpisodesBatch,
  toggleCurrentEpisodeWatched,
  hasStartedWatchingCurrentEpisode,
  markOutgoingEpisodeWatched,
};

export {
  _localizeOfflineSubLabel,
  loadOfflineStreamForActiveTitle,
  syncDownloadButtonVisibility,
  abortActiveVideoListeners,
  switchSourceTab,
  loadOfficialServiceTab,
  resetVideoElementForStreamChange,
  renderTrailerEmbed,
  loadTrailerTab,
  hideVideoStreamError,
  showVideoStreamError,
  switchHdRezkaStudio,
  renderErrorStudiosPanel,
  toggleErrorStudiosPanel,
  buildNextEpisodePreloadKey,
  preloadNextEpisodeIfNeeded,
  loadHDRezkaStream,
  adjustAudioOffset,
  resetAudioOffset,
  seekEffectivePlayback,
  switchRemuxAudioTrack,
  probeAndPlay4KStream,
  renderStremioStreamsList,
  loadStremioStreams,
  loadBackup4KReleases,
};

export function setPseudoStageFullscreen(nextState = null) {
  return _setPseudoStageFullscreen(nextState);
}

// Timeline scrubber and hover preview markers (rendered via player-ui-controls.js):
// atv-vc-hover-chapter, atv-vc-hover-delta, atv-vc-hover-target
export {
  hasOpenVcPopover,
  closeAllVcPopovers,
  isStageFullscreen,
  setVideoStageIdle,
  wakeVideoControls,
  syncCustomVideoControlsUI,
  beginFullscreenTransitionWindow,
  toggleStageFullscreen,
  getSnappingRatio,
  initCustomVideoControls,
  initPlayerStageAndGearBindings,
  syncVcPopoverOpenClass,
  positionStagePopover,
  toggleQuickOriginalAudio,
  syncCustomControlPopovers,
};

// Re-exported from player-watchdog.js: getRenderedVideoFrameCount uses getVideoPlaybackQuality
export {
  clearVideoStallWatchdog,
  getRenderedVideoFrameCount,
  initVideoFrameCounter,
  recoverFrozenVideoPlayback,
  getVideoForwardBufferSec,
  checkVideoPlaybackFreeze,
};

export {
  estimateItemDurationSec,
  buildRemuxStreamEndpoint,
  getEffectivePlaybackTiming,
  formatAudioOffsetLabel,
  syncAudioOffsetUI,
  scheduleRemuxFullDurationProbe,
  prepareRemuxAudioSwitch,
};

export {
  activateSelectedSubtitleTrack,
  adjustSubtitleOffset,
  attachVideoSubtitles,
  bindSubtitleFileAndDropListeners,
  buildRemuxSubtitlesList,
  clearCustomSubtitleOverlay,
  closeSubtitleDictPopover,
  decodeSubtitleArrayBuffer,
  formatSubtitleOffsetLabel,
  loadLocalSubtitleFile,
  mergeCustomExternalSubtitles,
  parseSubtitleCues,
  populateSubtitlesSelector,
  refreshRemuxSubtitleTracks,
  renderVcSubtitlesPopover,
  resetSubtitleOffset,
  searchOnlineSubtitlesForActiveTitle,
  syncIosFullscreenNativeSubtitles,
  syncSubtitleOffsetUI,
  triggerLocalSubtitleFilePicker,
  updateCustomSubtitleOverlay,
};

// Presentation, sidebar & title metadata modularized into ./player-meta.js

export async function openPlayerModal(item, initialTab = "hdrezka", season = 1, episode = 1, resumeTime = 0) {
  if (item && Array.isArray(state.catalogItems)) {
    const rawId = String(item.id || "").trim();
    const rawT = String(item.title || "").trim().toLowerCase();
    const rawOrig = String(item.orig_title || "").trim().toLowerCase();
    const match = state.catalogItems.find(
      (c) =>
        (rawId && String(c.id || "") === rawId) ||
        (rawT && String(c.title || "").trim().toLowerCase() === rawT) ||
        (rawOrig && String(c.orig_title || "").trim().toLowerCase() === rawOrig)
    );
    if (match) {
      item = { ...match, ...item };
    }
  }
  if (item && !item.media_type) {
    const isKnownSeries = Boolean(
      item.type === "series" ||
      item.type === "serial" ||
      item.seasons_map ||
      item.latest_episode ||
      (Number(item.seasons_count) > 1) ||
      Number(season) > 1 ||
      Number(episode) > 1 ||
      (item.rezka_url && item.rezka_url.includes("/series/"))
    );
    item.media_type = isKnownSeries ? "series" : "movie";
  } else if (item && item.media_type === "movie") {
    if ((item.rezka_url && item.rezka_url.includes("/series/")) || Number(season) > 1 || Number(episode) > 1) {
      item.media_type = "series";
    }
  }
  if (
    initialTab !== "offline" &&
    initialTab !== "trailer" &&
    item &&
    typeof navigator !== "undefined" &&
    navigator.onLine === false
  ) {
    const exactOffline = findOfflineDownloadForTitle(
      item,
      item.media_type === "series" ? season : null,
      item.media_type === "series" ? episode : null,
      ["completed"]
    );
    const anyOffline = exactOffline || findOfflineDownloadForTitle(item, null, null, ["completed"]);
    if (anyOffline) {
      initialTab = "offline";
      if (!exactOffline && item.media_type === "series") {
        season = Number(anyOffline.season) || season;
        episode = Number(anyOffline.episode) || episode;
      }
    }
  }
  if (
    (initialTab === "hdrezka" && !isServiceEnabled("hdrezka")) ||
    (initialTab === "stremio" && !isServiceEnabled("stremio")) ||
    (initialTab === "backup4k" && !isServiceEnabled("backup4k")) ||
    (OFFICIAL_STREAMING_SERVICES.has(initialTab) &&
      !(isServiceEnabled(initialTab) &&
        Boolean(state.integrations?.[initialTab]?.logged_in) &&
        item?.providers?.some((p) => p && p.id === initialTab && p.available))) ||
    initialTab === "official"
  ) {
    initialTab = getDefaultPlayableSourceTab();
  }
  clearAutoplayNextTimer();
  const prevOpenSameSeries =
    state.isPlayerOpen &&
    state.activeItem &&
    item &&
    state.activeItem.media_type === "series" &&
    item.media_type === "series" &&
    String(state.activeItem.id || "") === String(item.id || "");
  if (prevOpenSameSeries) {
    const prevNextCoords = getNextEpisodeCoords();
    if (
      prevNextCoords &&
      Number(season) === prevNextCoords.season &&
      Number(episode) === prevNextCoords.episode &&
      hasStartedWatchingCurrentEpisode(state.activeItem, state.activeSeason, state.activeEpisode)
    ) {
      markOutgoingEpisodeWatched(state.activeItem, state.activeSeason, state.activeEpisode);
    }
  }
  const playerModalEl = document.getElementById("player-modal");
  const wasPlayerHidden = Boolean(playerModalEl && playerModalEl.classList.contains("hidden"));
  if (wasPlayerHidden) {
    rememberModalTriggerFocus("player-modal");
  }
  closePersonModal({ suppressResume: true });
  closeQuickPeekModal({ clearStack: true, suppressResume: true });
  state.pausedByOverlayModal = false;
  dismissPlayerNextEpisodeToast(false);
  state._nextEpToastDismissed = false;
  state.postwatchAnchor = "header";
  state.playerSessionId += 1;
  state.isPlayerOpen = true;
  state.userMutedThisSession = false;
  state.catalogDirty = false;
  state.activeItem = item;
  state.activeSeason = season;
  state.activeEpisode = episode;
  state.seasonsMap = {};
  state.episodesTitles = {};
  state.episodesMeta = {};
  state.subtitles = [];
  state.activeSubtitleIndex = -1;
  state.subtitleOffsetSec = 0;
  state.audioOffsetSec = 0;
  if (state.audioOffsetReloadTimerId) {
    clearTimeout(state.audioOffsetReloadTimerId);
    state.audioOffsetReloadTimerId = null;
  }
  state.customExternalSubtitles = [];
  state.external4kSubs = [];
  state.backupQualities = {};
  state.hlsQualities = {};
  state.streamMintedAt = 0;
  state.usedBackupUrls = new Set();
  state.tokenRefreshTimestamps = [];
  clearCustomSubtitleOverlay();
  syncSubtitleOffsetUI();
  syncAudioOffsetUI();
  state.currentStreamUrl = "";
  state.active4kReleaseUrl = "";
  state.active4kReleaseKey = "";
  state.active4kRelease = null;
  state.preferred4kReleaseKey = "";
  state.active4kVideoFiles = [];
  state.active4kFileIndex = 0;
  state.lastDirect4kSourceUrl = "";
  state.stremioStreamsData = null;
  state.activeStremioStreamKey = "";
  state.externalStremioSubs = [];
  state.isPlayingOfflineDownload = initialTab === "offline";
  if (initialTab !== "offline") {
    state.activeOfflineDownloadId = "";
  }
  state.stremioFilter = "all";
  document.querySelectorAll("#stremio-filter-pills .atv-stremio-filter-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.sfilter === "all");
  });
  state.trailerData = null;
  state.trailerLang = isEn() ? "en" : "ru";
  state.trailerPlaying = false;
  state.episodesStripExpanded = true;
  state.ratingPromptShownThisSession = {};
  state.postwatchHovered = false;
  state.postwatchManual = false;
  document.getElementById("player-gear-popover")?.classList.add("hidden");
  document.getElementById("gear-hotkeys-box")?.classList.add("hidden");
  document.getElementById("btn-toggle-gear-hotkeys")?.classList.remove("active");
  document.getElementById("btn-player-gear")?.classList.remove("active");
  document.getElementById("kinorium-status-popover")?.classList.add("hidden");
  document.getElementById("video-osd-pill")?.classList.add("hidden");
  document.getElementById("video-error-state")?.classList.add("hidden");
  closeAllVcPopovers();
  setPipBackgroundMode(false);
  setMiniPlayerMode(false);
  syncPlayerSidebarCollapsedUI();
  const infoSidebar = document.querySelector("#player-modal .atv-info-sidebar");
  if (infoSidebar) {
    infoSidebar.scrollTop = 0;
    infoSidebar.classList.remove("is-scrolled");
  }
  if (!state.hasPlayerHistoryEntry) {
    try {
      window.history.pushState({ cineflowPlayerModal: true }, "");
      state.hasPlayerHistoryEntry = true;
    } catch (err) { window.logDebug?.("Player", err); }
  }
  syncScrollTopButton();
  if (resumeTime <= 0) {
    const epProg = getEpisodeProgress(item, season, episode);
    const alreadyEpDone = item.media_type === "series" && isEpisodeWatched(item, season, episode);
    if (epProg && epProg.current_time > 10 && epProg.pct < 95 && !alreadyEpDone) {
      resumeTime = epProg.current_time;
    }
  }
  const trailerBox = document.getElementById("trailer-stage-box");
  if (trailerBox) {
    trailerBox.innerHTML = "";
    trailerBox.classList.add("hidden");
  }
  const savedStudio = getPreferredStudioForItem(item);
  const profAudioPref = state.activeProfile?.default_audio_pref || "auto";
  const wantOrigDefault = profAudioPref === "original" || (profAudioPref === "auto" && isEn());
  if (state.pendingStudioId) {
    state.activeStudioId = String(state.pendingStudioId);
    state.pendingStudioId = null;
  } else {
    state.activeStudioId = savedStudio?.id || "";
  }
  state.activeStudioName = savedStudio?.name
    ? translateStudioName(savedStudio.name)
    : wantOrigDefault
    ? "Original"
    : "HDRezka Studio";
  state.lastNonOriginalStudioId = "";
  state.forceEnableRuSubtitlesOnce = false;
  state.availableStudios = [];
  state.currentStreamUrl = "";
  const selectStudioEl = document.getElementById("select-studio");
  if (selectStudioEl) {
    selectStudioEl.innerHTML = "";
  }
  state.introSkippedThisEpisode = false;
  state.autoplayCancelledThisEpisode = false;
  state.probeCreditsStartSec = 0;
  state.scrobbledThisSession = Boolean(item.kinorium?.watched);
  if (!prevOpenSameSeries) {
    state.scrobbledEpisodesThisSession = {};
    state.promotedWatchingThisSession = {};
  }

  // Stop any previous stream before starting the new session
  abortActiveVideoListeners();
  const video = document.getElementById("native-video");
  if (state.hlsInstance) {
    try {
      state.hlsInstance.destroy();
    } catch (err) { window.logDebug?.("Player", err); }
    state.hlsInstance = null;
  }
  if (video) {
    video.onloadedmetadata = null;
    try {
      video.pause();
    } catch (err) { window.logDebug?.("Player", err); }
    video.removeAttribute("src");
    try {
      video.load();
    } catch (err) { window.logDebug?.("Player", err); }
    try {
      video.currentTime = 0;
    } catch (err) { window.logDebug?.("Player", err); }
    // Synchronously unlock audible state & AudioContext inside the user's click gesture
    // so async stream playback 1-2s later never gets muted by browser autoplay policies.
    const savedPrefs = getPlayerPrefs();
    state.internalMuteOverride = true;
    try {
      video.muted = false;
      video.volume = savedPrefs.volume > 0.02 ? savedPrefs.volume : 0.85;
    } catch (err) { window.logDebug?.("Player", err); }
    state.internalMuteOverride = false;
    if ((savedPrefs.audioBoost > 1.01 || savedPrefs.audioPreset !== "flat" || video._cfSourceNode)) {
      ensureUnlockedAudioContext();
    }
  }

  setAmbientColor(item.ambient_color || "#242427");

  const modal = document.getElementById("player-modal");
  modal.classList.remove("hidden");
  if (wasPlayerHidden) {
    requestAnimationFrame(() => {
      (
        document.getElementById("vc-btn-play") ||
        document.getElementById("close-player-modal")
      )?.focus({ preventScroll: true });
    });
  }
  modal.querySelector(".atv-info-sidebar")?.scrollTo({ top: 0 });
  modal.querySelector(".atv-player-col")?.scrollTo({ top: 0 });
  document.getElementById("vc-btn-pip")?.classList.toggle("hidden", !supportsNativePiP());
  syncPostwatchOverlayMount();
  document.getElementById("kinorium-postwatch-overlay")?.classList.add("hidden");
  document.getElementById("video-stage")?.classList.remove("has-postwatch-open");
  document.getElementById("skip-intro-btn").classList.add("hidden");
  document.getElementById("skip-outro-btn").classList.add("hidden");

  const titleEl = document.getElementById("modal-title");
  if (titleEl) titleEl.textContent = displayTitle(item);

  const rKinEl = document.getElementById("meta-r-kinorium");
  if (rKinEl) rKinEl.textContent = item.kinorium?.kinorium_rating || item.ratings?.kinorium || "—";
  const rImdbEl = document.getElementById("meta-r-imdb");
  if (rImdbEl) rImdbEl.textContent = item.ratings?.imdb || item.kinorium?.imdb_rating || item.imdb_rating || "—";
  const metaCriticsEl = document.getElementById("meta-r-critics");
  if (metaCriticsEl) {
    metaCriticsEl.textContent = formatCriticsRating(item);
  }
  const metaDescEl = document.getElementById("meta-description");
  if (metaDescEl) {
    const descTxt = displayDescription(item) || "";
    metaDescEl.textContent = descTxt;
    metaDescEl.classList.remove("is-expanded");
    metaDescEl.tabIndex = descTxt.length > 160 ? 0 : -1;
    metaDescEl.setAttribute("role", "button");
    metaDescEl.setAttribute("aria-expanded", "false");
    if (!metaDescEl._cfBoundExpand) {
      metaDescEl._cfBoundExpand = true;
      metaDescEl.addEventListener("click", () => {
        const exp = metaDescEl.classList.toggle("is-expanded");
        metaDescEl.setAttribute("aria-expanded", exp ? "true" : "false");
      });
      metaDescEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          metaDescEl.click();
        }
      });
    }
  }

  // Hide Skip Intro controls on feature movies
  document.getElementById("skip-intro-footer-controls")?.classList.toggle("hidden", item.media_type === "movie");

  try { updateModalKinoriumHeader(item.kinorium || {}); } catch (err) { window.logDebug?.("Player", err); }
  try { applyEnabledServicesVisibility(item); } catch (err) { window.logDebug?.("Player", err); }
  try { renderModalProvidersSidebar(item); } catch (err) { window.logDebug?.("Player", err); }
  try { renderModalGenresAndSubheader(item); } catch (e) { console.warn("[Player] Subheader error:", e); }
  try { renderModalCastSection(item); } catch (e) { console.warn("[Player] Cast error:", e); }
  try { renderModalSimilarItems(item); } catch (e) { console.warn("[Player] Similar error:", e); }
  try { populateSeasonEpisodeSelectors(item); } catch (e) { console.warn("[Player] Season selector error:", e); }
  try { syncMediaSessionMetadata(); } catch (err) { window.logDebug?.("Player", err); }
  try { startAmbilightLoop(); } catch (err) { window.logDebug?.("Player", err); }

  const canFetchOnlineMeta = typeof navigator === "undefined" || navigator.onLine !== false;
  if (canFetchOnlineMeta) {
    fetchAndApplyPlayerTitleMeta(item, state.playerSessionId);
  }

  await switchSourceTab(initialTab, resumeTime);
  pushDesktopRemoteStateNow();
  if (canFetchOnlineMeta && initialTab !== "offline") {
    await loadSkipIntroSegments();
  }
}

// Presentation, sidebar & screenshot methods modularized into ./player-meta.js

// HDRezka stream staleness & expiration checks modularized into ./player-streams.js
export function isHdRezkaStreamDeadOrExpired(video) {
  return _isHdRezkaStreamDeadOrExpired(video);
}

export function toggleVideoPlayPause(showCenterPulse = false) {
  if (!state.isPlayerOpen) return;

  // Support Play/Pause on YouTube trailer iframe when Mini-Player is active on Trailer tab
  if (state.activeSourceTab === "trailer") {
    const iframe = document.querySelector("#trailer-stage-box iframe");
    if (iframe && iframe.contentWindow) {
      const nextPlaying = state.trailerPlaying === false;
      state.trailerPlaying = nextPlaying;
      try {
        iframe.contentWindow.postMessage(
          JSON.stringify({
            event: "command",
            func: nextPlaying ? "playVideo" : "pauseVideo",
            args: [],
          }),
          "*"
        );
      } catch (err) { window.logDebug?.("Player", err); }
      const miniBtn = document.getElementById("btn-mini-play-pause");
      if (miniBtn) {
        miniBtn.innerHTML = iconSvg(nextPlaying ? "pause" : "play", 12);
      }
    }
    return;
  }

  const video = document.getElementById("native-video");
  if (!video) return;

  resumeAudioContextIfNeeded();

  if (video.paused || video.ended || isHdRezkaStreamDeadOrExpired(video)) {
    state.userPaused = false;
    state.pipWasPlayingRecently = true;
    if (isHdRezkaStreamDeadOrExpired(video)) {
      const { cur } = getEffectivePlaybackTiming(video);
      state.tokenRefreshTimestamps = [];
      loadHDRezkaStream(cur > 2 ? cur : 0, { forceRefresh: true });
      return;
    }
    if (!video.getAttribute("src") && !state.hlsInstance && state.currentStreamUrl) {
      playVideoUrl(state.currentStreamUrl, 0, state.playerSessionId, {
        keepRemuxMeta: Boolean(state.remuxMeta?.active),
      });
    } else {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((err) => {
          if (err && (err.name === "NotAllowedError" || String(err).includes("NotAllowed"))) {
            state.internalMuteOverride = true;
            video.muted = true;
            state.internalMuteOverride = false;
            video.play().catch(() => {});
          }
        });
      }
    }
    document.getElementById("btn-mini-play-pause")?.replaceChildren();
    const miniBtn = document.getElementById("btn-mini-play-pause");
    if (miniBtn) miniBtn.innerHTML = iconSvg("pause", 12);
    syncPipDockUI();
    syncCustomVideoControlsUI(true);
    if (showCenterPulse && !state.isMiniPlayer && !state.isPipBackground) {
      triggerVideoCenterIndicator("play");
    }
  } else {
    state.userPaused = true;
    state.pipWasPlayingRecently = false;
    video.pause();
    const miniBtn = document.getElementById("btn-mini-play-pause");
    if (miniBtn) miniBtn.innerHTML = iconSvg("play", 12);
    syncPipDockUI();
    syncCustomVideoControlsUI(true);
    if (showCenterPulse && !state.isMiniPlayer && !state.isPipBackground) {
      triggerVideoCenterIndicator("pause");
    }
  }
}

// Rating and watched state mutations modularized into ./player-rating.js

export function syncPlayerOfflineControlsUI() {
  const item = state.activeItem;
  const isSeries = item?.media_type === "series";
  const completedDl = item
    ? findOfflineDownloadForTitle(
        item,
        isSeries ? state.activeSeason : null,
        isSeries ? state.activeEpisode : null,
        ["completed"]
      )
    : null;
  const activeDl = item
    ? findOfflineDownloadForTitle(
        item,
        isSeries ? state.activeSeason : null,
        isSeries ? state.activeEpisode : null,
        ["downloading", "queued"]
      )
    : null;

  const offlineTabBtn = document.getElementById("tab-btn-offline");
  if (offlineTabBtn) {
    const anyCompletedForSeries =
      !completedDl && isSeries && item ? findOfflineDownloadForTitle(item, null, null, ["completed"]) : null;
    const showOfflineTab = Boolean(completedDl || anyCompletedForSeries || state.activeSourceTab === "offline");
    offlineTabBtn.textContent = t("Офлайн", "Offline");
    offlineTabBtn.title = t(
      "Воспроизведение локально сохранённого файла без интернета",
      "Play locally saved file without internet"
    );
    offlineTabBtn.classList.toggle("hidden", !showOfflineTab);
    offlineTabBtn.classList.toggle("active", state.activeSourceTab === "offline");
  }

  const gearOfflineBtn = document.getElementById("btn-download-offline");
  const vcOfflineBtn = document.getElementById("vc-btn-offline-dl");
  const isSaved = Boolean(completedDl || state.activeSourceTab === "offline");
  const isDownloading = Boolean(!isSaved && activeDl);

  if (gearOfflineBtn) {
    gearOfflineBtn.classList.toggle("is-saved-offline", isSaved);
    gearOfflineBtn.classList.toggle("is-downloading-offline", isDownloading);
    const spanEl = gearOfflineBtn.querySelector("span");
    if (spanEl) {
      spanEl.textContent = isSaved
        ? t("Скачано офлайн", "Saved Offline")
        : isDownloading
        ? t("Загружается...", "Downloading...")
        : t("В дорогу (Офлайн)", "Save Offline");
    }
  }
  if (vcOfflineBtn) {
    vcOfflineBtn.classList.toggle("is-saved-offline", isSaved);
    vcOfflineBtn.classList.toggle("is-downloading-offline", isDownloading);
    const tip = isSaved
      ? t("Скачано в память — открыть офлайн-загрузки", "Saved offline — open Downloads")
      : isDownloading
      ? t("Идёт сохранение в дорогу — открыть загрузки", "Downloading for offline — open Downloads")
      : t("Скачать в дорогу (просмотр без интернета)", "Save offline (watch without internet)");
    vcOfflineBtn.title = tip;
    vcOfflineBtn.setAttribute("aria-label", tip);
  }
}

// Stream resolvers, providers & formats modularized into ./player-streams.js
// HDRezka playback recovery: fresh Voidboost token minting (nocache=1) and edge evict (_evict_edge=1)
export function _tryRecoverHdRezkaPlayback(resumeAt, sessionId, currentUrl, options = {}) {
  return _tryRecoverHdRezkaPlaybackImpl(resumeAt, sessionId, currentUrl, options);
}

export function playVideoUrl(streamUrl, startTime = 0, sessionId = state.playerSessionId, options = {}) {
  const {
    keepRemuxMeta = false,
    newRemuxOffsetSec,
    proxyRetried = false,
    transientRetried = false,
    isInstantSwap = false,
  } = options;
  if (!keepRemuxMeta) {
    state.remuxMeta = null;
  }
  let video = document.getElementById("native-video");
  const loader = document.getElementById("video-loader");
  if (!video || !streamUrl || !state.isPlayerOpen || sessionId !== state.playerSessionId) {
    loader?.classList.add("hidden");
    return;
  }

  // Detach any listeners from a previous stream BEFORE resetting HLS / video.src
  abortActiveVideoListeners();
  const loadToken = state.videoLoadToken;
  const loadAbort = new AbortController();
  state.videoLoadAbort = loadAbort;

  hideVideoStreamError();
  clearAutoplayNextTimer();
  state.currentStreamUrl = streamUrl;
  if (loader) {
    if (state.instantSwapLoaderTimer) {
      clearTimeout(state.instantSwapLoaderTimer);
      state.instantSwapLoaderTimer = null;
    }
    if (isInstantSwap) {
      state.instantSwapLoaderTimer = setTimeout(() => {
        state.instantSwapLoaderTimer = null;
        if (video.paused && !video.ended && !state.userPaused) {
          loader.classList.remove("hidden");
        }
      }, 420);
    } else {
      loader.classList.remove("hidden");
    }
  }
  syncDownloadButtonVisibility();
  state.introSkippedThisEpisode = false;
  state.autoplayCancelledThisEpisode = false;
  if (state.activeSourceTab === "hdrezka") {
    state.active4kReleaseUrl = "";
    state.active4kReleaseKey = "";
    state.active4kRelease = null;
    state.activeStremioStreamKey = "";
  }
  if (state.hlsInstance) {
    try {
      state.hlsInstance.destroy();
    } catch (err) { window.logDebug?.("Player", err); }
    state.hlsInstance = null;
  }
  video.onloadedmetadata = null;
  try {
    video.pause();
  } catch (err) { window.logDebug?.("Player", err); }
  video.querySelectorAll("track").forEach((tr) => tr.remove());
  if (keepRemuxMeta && state.remuxMeta?.active && typeof newRemuxOffsetSec === "number") {
    try {
      video.currentTime = 0;
    } catch (err) { window.logDebug?.("Player", err); }
    state.remuxMeta.offsetSec = newRemuxOffsetSec;
  }

  if (video._cfLastCorsUrl !== streamUrl) {
    video._cfLastCorsUrl = streamUrl;
    video._cfCorsBlocked = false;
  }

  const isSameOriginUrl =
    String(streamUrl).startsWith("/") ||
    (typeof window !== "undefined" &&
      window.location?.origin &&
      String(streamUrl).startsWith(window.location.origin));

  // Only enable crossorigin="anonymous" on external streams when WebAudio DSP is active or already bound.
  const needsCorsForWebAudio = Boolean(
    !isSameOriginUrl &&
      !video._cfCorsBlocked &&
      !options.isCorsFallback &&
      (video._cfSourceNode ||
        (state.audioBoost && state.audioBoost > 1.01) ||
        (state.audioPreset && state.audioPreset !== "flat") ||
        (!state.remuxMeta?.active && (Number(state.audioOffsetSec) || 0) >= 0.005))
  );
  if (needsCorsForWebAudio) {
    if (!video.hasAttribute("crossorigin")) {
      video.setAttribute("crossorigin", "anonymous");
    }
  } else if (video.hasAttribute("crossorigin")) {
    video.removeAttribute("crossorigin");
  }
  applySavedPlayerPrefsToVideo(video);
  let corsRetried = false;

  const isStaleLoad = () =>
    !state.isPlayerOpen ||
    sessionId !== state.playerSessionId ||
    loadToken !== state.videoLoadToken ||
    loadAbort.signal.aborted;

  const attemptAudiblePlay = () => {
    if (isStaleLoad()) return;
    resumeAudioContextIfNeeded();
    if (!state.userMutedThisSession && video.muted) {
      state.internalMuteOverride = true;
      video.muted = false;
      state.internalMuteOverride = false;
    }
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((err) => {
        if (isStaleLoad()) return;
        // If browser blocked unmuted autoplay after async network fetch, start muted and unmute on first click/key
        if (err && (err.name === "NotAllowedError" || String(err).includes("NotAllowed"))) {
          state.internalMuteOverride = true;
          video.muted = true;
          state.internalMuteOverride = false;
          syncCustomVideoControlsUI(true);
          video.play().catch(() => {});
          showToast(
            t(
              "Браузер приглушил автозапуск — кликните по видео для включения звука",
              "Browser muted autoplay — click the video to enable sound"
            )
          );
          const unlockOnce = () => {
            document.removeEventListener("pointerdown", unlockOnce, true);
            document.removeEventListener("keydown", unlockOnce, true);
            if (!state.userMutedThisSession && video) {
              state.internalMuteOverride = true;
              video.muted = false;
              if (video.volume <= 0.02) video.volume = 0.85;
              state.internalMuteOverride = false;
              resumeAudioContextIfNeeded();
              syncCustomVideoControlsUI(true);
            }
          };
          document.addEventListener("pointerdown", unlockOnce, { capture: true, once: true });
          document.addEventListener("keydown", unlockOnce, { capture: true, once: true });
        }
      });
    }
  };

  const hideLoader = () => {
    if (state.instantSwapLoaderTimer) {
      clearTimeout(state.instantSwapLoaderTimer);
      state.instantSwapLoaderTimer = null;
    }
    if (isStaleLoad()) return;
    loader.classList.add("hidden");
    hideVideoStreamError();
    if (keepRemuxMeta && state.remuxMeta?.active && !(state.remuxMeta.duration > 10)) {
      scheduleRemuxFullDurationProbe(sessionId, () => {
        syncCustomControlPopovers();
        syncCustomVideoControlsUI(true);
      });
    }
  };
  const onVideoError = () => {
    if (isStaleLoad()) return;
    const errCode = video.error?.code || 0;
    const curAttrSrc = video.getAttribute("src") || "";
    // Ignore aborted loads (code 1) or empty src resets during rapid switching
    if (errCode === 1 || (!curAttrSrc && !state.hlsInstance)) {
      return;
    }
    // Automatic Apple VideoToolbox H.264 transcode fallback if client cannot decode raw HEVC / AV1 / DV video
    if (
      keepRemuxMeta &&
      state.remuxMeta?.active &&
      !state.remuxMeta.forceH264 &&
      (errCode === 3 || errCode === 4)
    ) {
      state.remuxMeta.forceH264 = true;
      const fallbackUrl = buildRemuxStreamEndpoint(state.remuxMeta, state.remuxMeta.offsetSec || 0);
      showToast(
        t(
          "Включено аппаратное перекодирование видео H.264 для совместимости с браузером",
          "Switched to hardware H.264 video transcoding for browser compatibility"
        )
      );
      playVideoUrl(fallbackUrl, 0, sessionId, { keepRemuxMeta: true });
      return;
    }
    // Automatic fallback if an external CDN omits Access-Control-Allow-Origin
    if (
      !corsRetried &&
      !options.isCorsFallback &&
      video.hasAttribute("crossorigin") &&
      /^https?:\/\//i.test(streamUrl)
    ) {
      corsRetried = true;
      if (video._cfSourceNode) {
        try {
          video._cfSourceNode.disconnect();
        } catch (err) { window.logDebug?.("Player", err); }
        const freshVideo = video.cloneNode(false);
        freshVideo.removeAttribute("crossorigin");
        freshVideo.removeAttribute("src");
        freshVideo._cfLastCorsUrl = streamUrl;
        freshVideo._cfCorsBlocked = true;
        video.replaceWith(freshVideo);
        video = freshVideo;
        bindNativeVideoElementListeners(video);
        applySavedPlayerPrefsToVideo(video);
      } else {
        video._cfCorsBlocked = true;
        video.removeAttribute("crossorigin");
      }
      playVideoUrl(streamUrl, startTime, sessionId, {
        ...options,
        isCorsFallback: true,
      });
      return;
    }
    const { cur: effCur } = getEffectivePlaybackTiming(video);
    const resumeAt = Math.max(Number(startTime) || 0, effCur > 2 ? effCur : 0);
    _tryRecoverHdRezkaPlayback(resumeAt, sessionId, streamUrl, options);
  };
  let hasStartedPlayingOnce = false;
  state.userPaused = false;
  state.lastPlaybackMediaTime = -1;
  state.lastPlaybackAdvanceTs = Date.now();
  const loaderTextEl = document.getElementById("video-loader-text");

  const markPlayingHealthy = () => {
    if (isStaleLoad()) return;
    if (video.seeking) return;
    hasStartedPlayingOnce = true;
    state.lastPlaybackAdvanceTs = Date.now();
    if (state.waitingSpinnerTimerId) {
      clearTimeout(state.waitingSpinnerTimerId);
      state.waitingSpinnerTimerId = null;
    }
    if (video.paused && !state.userPaused && !video.ended) {
      attemptAudiblePlay();
    }
    hideLoader();
  };

  video.addEventListener("canplay", markPlayingHealthy, { signal: loadAbort.signal });
  video.addEventListener("canplaythrough", markPlayingHealthy, { signal: loadAbort.signal });
  video.addEventListener("playing", markPlayingHealthy, { signal: loadAbort.signal });
  video.addEventListener(
    "seeked",
    () => {
      if (isStaleLoad()) return;
      if (video.readyState >= 3) {
        markPlayingHealthy();
      }
    },
    { signal: loadAbort.signal }
  );
  video.addEventListener(
    "seeking",
    () => {
      if (isStaleLoad() || video.ended) return;
      if (state.waitingSpinnerTimerId) clearTimeout(state.waitingSpinnerTimerId);
      state.waitingSpinnerTimerId = setTimeout(() => {
        state.waitingSpinnerTimerId = null;
        if (isStaleLoad() || video.ended || (!video.seeking && video.readyState >= 3)) return;
        if (loaderTextEl) {
          loaderTextEl.textContent = t("Буферизация видеопотока...", "Buffering video stream...");
        }
        loader?.classList.remove("hidden");
      }, 220);
    },
    { signal: loadAbort.signal }
  );
  video.addEventListener(
    "waiting",
    () => {
      if (isStaleLoad() || video.paused || video.ended) return;
      if (state.waitingSpinnerTimerId) clearTimeout(state.waitingSpinnerTimerId);
      state.waitingSpinnerTimerId = setTimeout(() => {
        state.waitingSpinnerTimerId = null;
        if (isStaleLoad() || video.paused || video.ended || (!video.seeking && video.readyState >= 3)) return;
        if (loaderTextEl) {
          loaderTextEl.textContent = t("Буферизация видеопотока...", "Buffering video stream...");
        }
        loader?.classList.remove("hidden");
      }, 250);
    },
    { signal: loadAbort.signal }
  );
  video.addEventListener("error", onVideoError, { signal: loadAbort.signal });

  initVideoFrameCounter(video);

  state.stallWatchdogTimerId = setInterval(() => {
    if (isStaleLoad()) {
      clearVideoStallWatchdog();
      return;
    }
    if (
      !hasStartedPlayingOnce ||
      video.paused ||
      video.ended ||
      video.seeking ||
      state.vcScrubbing ||
      state.adSteppingActive ||
      state.activeSourceTab === "trailer"
    ) {
      state.lastPlaybackAdvanceTs = Date.now();
      state.lastPlaybackMediaTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      state.lastObservedVideoFrames = getRenderedVideoFrameCount(video);
      state.lastVideoFramesAdvanceTs = Date.now();
      state.lastFreezeCheckMediaTime = state.lastPlaybackMediaTime;
      return;
    }

    const curT = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const nowMs = Date.now();

    // 1. Anti-Freeze Video Frame & A/V Desync Watchdog:
    // Detects when audio is playing (curT is advancing) but hardware video decoder (VideoToolbox/DXVA) is frozen
    if (checkVideoPlaybackFreeze(video, curT, nowMs)) {
      return;
    }

    if (Math.abs(curT - state.lastPlaybackMediaTime) > 0.08) {
      state.lastPlaybackMediaTime = curT;
      state.lastPlaybackAdvanceTs = Date.now();
      if (loader && !loader.classList.contains("hidden") && !state.streamAbortController) {
        loader.classList.add("hidden");
      }
      return;
    }

    const stalledMs = nowMs - state.lastPlaybackAdvanceTs;
    const fwdBuf = getVideoForwardBufferSec(video);

    // Unstick pipeline gaps when RAM buffer already has >=3s ahead of playhead
    if (fwdBuf >= 3.0 && stalledMs >= 3500) {
      try {
        video.currentTime = curT + 0.06;
        video.play().catch(() => {});
      } catch (err) { window.logDebug?.("Player", err); }
      state.lastPlaybackAdvanceTs = nowMs;
      return;
    }

    // FFmpeg live remux pipe stall recovery
    if ((keepRemuxMeta || state.remuxMeta?.active) && fwdBuf < 2.0 && stalledMs >= 14000) {
      state.lastPlaybackAdvanceTs = nowMs;
      if (state.remuxMeta?.rawSourceUrl) {
        const { cur: remuxPos } = getEffectivePlaybackTiming(video);
        const nextOffset = Math.max(0, remuxPos);
        const reopenUrl = buildRemuxStreamEndpoint(state.remuxMeta, nextOffset);
        if (loaderTextEl) {
          loaderTextEl.textContent = t(
            "Перезапуск конвейера ремукса без потери позиции...",
            "Restarting remux pipeline seamlessly..."
          );
        }
        loader?.classList.remove("hidden");
        playVideoUrl(reopenUrl, 0, sessionId, {
          keepRemuxMeta: true,
          newRemuxOffsetSec: nextOffset,
        });
      }
      return;
    }

    // Multi-stage network & token stall recovery on MP4 and HLS streams
    if (fwdBuf < 3.0 && stalledMs >= 8000 && !keepRemuxMeta && !state.remuxMeta?.active) {
      state.lastPlaybackAdvanceTs = nowMs;
      const { cur: resumePos } = getEffectivePlaybackTiming(video);
      _tryRecoverHdRezkaPlayback(resumePos, sessionId, streamUrl, options);
    }
  }, 1000);

  if (streamUrl.includes(".m3u8") && window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({
      enableWorker: true,
      maxBufferLength: 45,
      maxMaxBufferLength: 90,
      backBufferLength: 30,
      fragLoadingMaxRetry: 4,
      manifestLoadingMaxRetry: 3,
      maxBufferHole: 0.3,
      nudgeMaxRetry: 5,
      highBufferWatchdogPeriod: 2,
    });
    state.hlsInstance = hls;
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
    attachVideoSubtitles();
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      if (isStaleLoad()) {
        video.pause();
        return;
      }
      applySavedPlayerPrefsToVideo(video);
      if (startTime > 0) video.currentTime = startTime;
      attemptAudiblePlay();
    });
    hls.on(window.Hls.Events.ERROR, (_, errData) => {
      if (!errData || isStaleLoad()) return;
      if (errData.details === "bufferStalledError" || errData.details === "bufferNudgeOnStall") {
        try {
          const cur = video.currentTime;
          video.currentTime = cur + 0.04;
          video.play().catch(() => {});
        } catch (err) { window.logDebug?.("Player", err); }
        return;
      }
      if (errData.fatal) {
        if (!hls._cfFatalRecovered) {
          hls._cfFatalRecovered = true;
          if (errData.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
            try {
              hls.startLoad();
              return;
            } catch (err) { window.logDebug?.("Player", err); }
          } else if (errData.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
            try {
              hls.recoverMediaError();
              return;
            } catch (err) { window.logDebug?.("Player", err); }
          }
        }
        onVideoError();
      }
    });
  } else {
    const onMeta = () => {
      if (isStaleLoad()) {
        video.pause();
        return;
      }
      applySavedPlayerPrefsToVideo(video);
      if (startTime > 0) video.currentTime = startTime;
      attemptAudiblePlay();
    };
    if (video.readyState >= 1) {
      onMeta();
    } else {
      video.addEventListener("loadedmetadata", onMeta, { once: true, signal: loadAbort.signal });
    }
    video.autoplay = true;
    video.src = streamUrl;
    video.load();
    attachVideoSubtitles();
    video.addEventListener(
      "canplay",
      () => {
        if (!isStaleLoad() && video.paused && !state.userPaused && !video.ended) {
          attemptAudiblePlay();
        }
      },
      { once: true, signal: loadAbort.signal }
    );
  }
}

// Skip intro and credits chapter markers modularized into ./player-intro-credits.js
// hasStartedWatchingCurrentEpisode and markOutgoingEpisodeWatched modularized into ./player-seasons.js
// syncVcPopoverOpenClass, positionStagePopover, toggleQuickOriginalAudio, syncCustomControlPopovers modularized into ./player-ui-controls.js

export function bindNativeVideoElementListeners(video) {
  if (!video || video._cfListenersBound) return;
  video._cfListenersBound = true;

  const skipIntroBtn = document.getElementById("skip-intro-btn");
  const skipOutroBtn = document.getElementById("skip-outro-btn");

  ["loadedmetadata", "durationchange", "progress", "volumechange"].forEach((evName) => {
    video.addEventListener(evName, () => {
      syncCustomVideoControlsUI(evName !== "progress");
    });
  });

  ["play", "pause", "ended"].forEach((evName) => {
    video.addEventListener(evName, () => {
      const miniPlayPauseBtn = document.getElementById("btn-mini-play-pause");
      if (evName === "play") {
        state.pipWasPlayingRecently = true;
        if (miniPlayPauseBtn) miniPlayPauseBtn.innerHTML = iconSvg("pause", 12);
        syncPipDockUI();
        resumeAudioContextIfNeeded();
        applyAudioBoostToVideo(video, state.audioBoost, state.audioPreset);
        if (state.ambilightEnabled && state.isPlayerOpen) {
          startAmbilightLoop();
        }
        if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
          try {
            navigator.mediaSession.playbackState = "playing";
          } catch (err) { window.logDebug?.("Player", err); }
        }
      } else {
        if (evName === "pause") {
          if (miniPlayPauseBtn) miniPlayPauseBtn.innerHTML = iconSvg("play", 12);
          syncPipDockUI();
          setTimeout(() => {
            if (video.paused && isVideoInPiP(video)) {
              state.pipWasPlayingRecently = false;
            }
          }, 320);
        }
        stopAmbilightLoop(false);
        if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
          try {
            navigator.mediaSession.playbackState = "paused";
          } catch (err) { window.logDebug?.("Player", err); }
        }
        if (evName === "pause" && state.isPlayerOpen && state.activeItem) {
          const { cur, dur } = getEffectivePlaybackTiming(video);
          const nowPause = Date.now();
          const epPauseKey = `${state.activeItem.id || ""}:s${state.activeSeason}e${state.activeEpisode}`;
          const alreadyDoneHere =
            state.activeItem.media_type === "series"
              ? Boolean(state.scrobbledEpisodesThisSession[epPauseKey])
              : Boolean(state.scrobbledThisSession);
          if (
            dur >= 60 &&
            cur >= 15 &&
            !(alreadyDoneHere && cur / dur >= 0.70) &&
            nowPause - state.lastScrobbleReportTime > 4000
          ) {
            state.lastScrobbleReportTime = nowPause;
            reportScrobbleProgress(cur, dur);
          }
        }
      }
      syncCustomVideoControlsUI(true);
      syncNativeNowPlaying(true);
      wakeVideoControls();
      pushDesktopRemoteStateNow();
    });
  });

  const handlePiPStateChange = () => {
    const active = isVideoInPiP(video);
    state._lastKnownVideoInPip = active;
    syncPipDockUI();
    if (active) {
      if (!video.paused) {
        state.pipWasPlayingRecently = true;
      }
      if (state.isPlayerOpen && !state.isPipBackground) {
        setPipBackgroundMode(true);
      }
    } else if (state.isPlayerOpen && !state.isRestoringFromPip) {
      const shouldResume = state.pipWasPlayingRecently;
      if (state.isPipBackground) {
        setPipBackgroundMode(false);
      }
      syncPipDockUI();
      if (shouldResume && video.paused && !state.streamAbortController) {
        video.play().catch(() => {});
      }
    }
  };
  video.addEventListener("enterpictureinpicture", handlePiPStateChange);
  video.addEventListener("leavepictureinpicture", handlePiPStateChange);
  video.addEventListener("webkitpresentationmodechanged", handlePiPStateChange);

  video.addEventListener("click", (e) => {
    e.stopPropagation();
    if (hasOpenVcPopover()) {
      closeAllVcPopovers();
      return;
    }
    if (e.detail > 1) {
      if (state.vcClickTimerId) {
        clearTimeout(state.vcClickTimerId);
        state.vcClickTimerId = null;
      }
      return;
    }
    if (state.vcClickTimerId) {
      clearTimeout(state.vcClickTimerId);
    }
    state.vcClickTimerId = setTimeout(() => {
      state.vcClickTimerId = null;
      toggleVideoPlayPause(true);
    }, 190);
  });
  video.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (state.vcClickTimerId) {
      clearTimeout(state.vcClickTimerId);
      state.vcClickTimerId = null;
    }
    toggleStageFullscreen();
  });

  initVideoFrameCounter(video);

  video.addEventListener("seeking", () => {
    state.lastPlaybackAdvanceTs = Date.now();
    state.lastVideoFramesAdvanceTs = Date.now();
    state.lastObservedVideoFrames = getRenderedVideoFrameCount(video);
    state.lastFreezeCheckMediaTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  });

  video.addEventListener("playing", () => {
    state.lastPlaybackAdvanceTs = Date.now();
    state.lastVideoFramesAdvanceTs = Date.now();
    state.lastObservedVideoFrames = getRenderedVideoFrameCount(video);
    state.lastFreezeCheckMediaTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    state.videoFreezeCount = 0;
  });

  video.addEventListener("loadedmetadata", () => {
    initVideoFrameCounter(video);
    state.lastPlaybackAdvanceTs = Date.now();
    state.lastVideoFramesAdvanceTs = Date.now();
    state.lastObservedVideoFrames = getRenderedVideoFrameCount(video);
    state.lastFreezeCheckMediaTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    syncNativeNowPlaying(true);
    renderTimelineBookmarks();
  });
  video.addEventListener("seeked", () => {
    state.lastPlaybackAdvanceTs = Date.now();
    state.lastVideoFramesAdvanceTs = Date.now();
    state.lastObservedVideoFrames = getRenderedVideoFrameCount(video);
    state.lastFreezeCheckMediaTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    state.videoFreezeCount = 0;
    syncNativeNowPlaying(true);
    pushDesktopRemoteStateNow();
    if (video.webkitDisplayingFullscreen) {
      syncIosFullscreenNativeSubtitles(video);
    } else {
      updateCustomSubtitleOverlay(video);
    }
  });
  video.addEventListener("webkitbeginfullscreen", () => {
    syncIosFullscreenNativeSubtitles(video);
  });
  video.addEventListener("webkitendfullscreen", () => {
    syncIosFullscreenNativeSubtitles(video);
  });

  video.addEventListener("timeupdate", () => {
    const curPip = isVideoInPiP(video);
    if (Boolean(state._lastKnownVideoInPip) !== curPip) {
      handlePiPStateChange();
    }
    if (!video.paused) {
      state.pipWasPlayingRecently = true;
    }
    syncCustomVideoControlsUI();
    syncNativeNowPlaying(false);
    updateCustomSubtitleOverlay(video);
    const { cur, dur } = getEffectivePlaybackTiming(video);

    if (
      dur >= 300 &&
      state.activeItem?.media_type === "series" &&
      state.skipSegments &&
      state.skipSegments.intro
    ) {
      const { start, end } = state.skipSegments.intro;
      const inIntro = cur >= start && cur <= end && end < dur;

      if (inIntro) {
        if (state.autoSkipIntro && !state.introSkippedThisEpisode && !video.seeking) {
          state.introSkippedThisEpisode = true;
          seekEffectivePlayback(Math.min(dur - 10, end + 0.5));
          skipIntroBtn?.classList.add("hidden");
          showToast(
            t(
              `Заставка пропущена (${formatTime(start)}–${formatTime(end)})`,
              `Intro skipped (${formatTime(start)}–${formatTime(end)})`
            )
          );
        } else if (!state.autoSkipIntro && skipIntroBtn) {
          skipIntroBtn.textContent = t(
            `Пропустить заставку (${formatTime(start)}–${formatTime(end)})`,
            `Skip intro (${formatTime(start)}–${formatTime(end)})`
          );
          skipIntroBtn.classList.remove("hidden");
        }
      } else {
        skipIntroBtn?.classList.add("hidden");
      }
    } else {
      skipIntroBtn?.classList.add("hidden");
    }

    if (dur >= 60) {
      const minExpectedDur =
        state.remuxMeta?.duration && state.remuxMeta.duration > 60
          ? state.remuxMeta.duration
          : estimateItemDurationSec(state.activeItem);
      const isStreamedSource = Boolean(
        state.remuxMeta?.active ||
          state.activeSourceTab === "backup4k" ||
          state.activeSourceTab === "stremio"
      );
      const safeDur = isStreamedSource
        ? Math.max(dur, minExpectedDur * 0.85)
        : dur;
      if (safeDur >= 120) {
        preloadNextEpisodeIfNeeded(cur, safeDur);
      }
      const ratio = cur / safeDur;
      const creditsStartSec = getDetectedCreditsStartSec(safeDur);
      const creditsStarted = Boolean(creditsStartSec && cur >= creditsStartSec);
      const reachedWatchedPoint = creditsStarted || ratio >= 0.95;

      const now = Date.now();
      const epScrobbleKey = `${state.activeItem?.id || ""}:s${state.activeSeason}e${state.activeEpisode}`;
      const alreadyDoneThisSession =
        state.activeItem?.media_type === "series"
          ? Boolean(state.scrobbledEpisodesThisSession[epScrobbleKey])
          : Boolean(state.scrobbledThisSession);

      if (
        state.activeItem &&
        cur >= 5 &&
        !(alreadyDoneThisSession && ratio >= 0.70) &&
        now - state.lastEpisodeSaveTime > 3000
      ) {
        state.lastEpisodeSaveTime = now;
        saveEpisodeProgress(state.activeItem, state.activeSeason, state.activeEpisode, cur, safeDur);
        state.catalogDirty = true;
      }
      if (state.activeItem && cur >= 10 && now - state.lastHistorySaveTime > 8000) {
        state.lastHistorySaveTime = now;
        recordWatchHistoryEntry(
          state.activeItem,
          state.activeSeason,
          state.activeEpisode,
          cur,
          safeDur,
          state.activeStudioName
        );
      }

      const nextCoordsForOutro = getNextEpisodeCoords();
      const isOutro =
        state.activeItem?.media_type === "series" &&
        Boolean(nextCoordsForOutro) &&
        !state.autoplayTimerId &&
        (creditsStarted || (safeDur > 60 && safeDur - cur <= 18) || ratio >= 0.95);

      if (
        creditsStarted &&
        state.activeItem?.media_type === "series" &&
        nextCoordsForOutro &&
        !state.autoNextEpisode &&
        !state._nextEpToastDismissed &&
        !state.isMiniPlayer &&
        !state.isPipBackground
      ) {
        showPlayerNextEpisodeToast(nextCoordsForOutro);
      }

      const nextToastEl = document.getElementById("player-next-ep-toast");
      const nextToastVisible = Boolean(nextToastEl && !nextToastEl.classList.contains("hidden"));
      if (isOutro && !state.autoplayCancelledThisEpisode && state.autoNextEpisode) {
        startAutoplayNextCountdown();
      } else if (isOutro && !nextToastVisible) {
        skipOutroBtn?.classList.remove("hidden");
      } else {
        skipOutroBtn?.classList.add("hidden");
      }

      const watchKey = String(state.activeItem?.id || state.activeItem?.title || "");
      const needsPromoteWatching = Boolean(
        state.activeItem &&
          !video.paused &&
          ratio >= 0.10 &&
          !reachedWatchedPoint &&
          !state.activeItem.kinorium?.watching &&
          !state.activeItem.kinorium?.watched &&
          !state.activeItem.kinorium?.not_watching &&
          !state.promotedWatchingThisSession[watchKey]
      );

      const needsEpisodeScrobble =
        !state.scrobbledEpisodesThisSession[epScrobbleKey] &&
        (!isEpisodeWatched(state.activeItem, state.activeSeason, state.activeEpisode) ||
          Boolean(state.activeItem?.kinorium?.watching && !state.scrobbledThisSession));
      const crossedWatched =
        state.activeItem?.media_type === "series"
          ? reachedWatchedPoint && needsEpisodeScrobble
          : reachedWatchedPoint && !state.scrobbledThisSession;

      if (crossedWatched) {
        state.lastScrobbleReportTime = now;
        reportScrobbleProgress(cur, safeDur, {
          forceWatched: creditsStarted,
          reason: creditsStarted && ratio < 0.95 ? "credits" : "progress_95",
        });
      } else if (needsPromoteWatching) {
        state.promotedWatchingThisSession[watchKey] = true;
        state.lastScrobbleReportTime = now;
        reportScrobbleProgress(cur, safeDur, { reason: "watching_10" });
      } else if (
        cur >= 15 &&
        !(alreadyDoneThisSession && ratio >= 0.70) &&
        now - state.lastScrobbleReportTime > 20000
      ) {
        state.lastScrobbleReportTime = now;
        reportScrobbleProgress(cur, safeDur);
      }

      if (reachedWatchedPoint && isServiceEnabled("kinorium") && state.activeItem) {
        maybeAutoOpenCreditsRatingCard();
      }
    }
  });

  video.addEventListener("ended", () => {
    const { cur, dur } = getEffectivePlaybackTiming(video);
    const minExpectedDur =
      state.remuxMeta?.duration && state.remuxMeta.duration > 60
        ? state.remuxMeta.duration
        : estimateItemDurationSec(state.activeItem);
    const isStreamedSource = Boolean(
      state.remuxMeta?.active ||
        state.activeSourceTab === "backup4k" ||
        state.activeSourceTab === "stremio"
    );
    const safeDur = isStreamedSource ? Math.max(dur, minExpectedDur * 0.85) : dur;
    const creditsStartSec = getDetectedCreditsStartSec(safeDur);
    const isGenuineEnd =
      safeDur >= 60 &&
      ((creditsStartSec && cur >= creditsStartSec) || cur / safeDur >= 0.90);

    if (!isGenuineEnd) {
      if (state.isPlayerOpen && state.activeItem && cur >= 5) {
        saveEpisodeProgress(state.activeItem, state.activeSeason, state.activeEpisode, cur, safeDur);
        reportScrobbleProgress(cur, safeDur);
        if (isStreamedSource) {
          const now = Date.now();
          if (!state._lastPrematureEndReconnectTs || now - state._lastPrematureEndReconnectTs > 8000) {
            state._lastPrematureEndReconnectTs = now;
            showToast(
              t(
                "Поток прервался — восстанавливаем воспроизведение с текущей позиции...",
                "Stream interrupted — resuming from current position..."
              )
            );
            if (state.remuxMeta?.active) {
              seekEffectivePlayback(cur);
            } else {
              _tryRecoverHdRezkaPlayback(cur, state.playerSessionId, video.currentSrc || "", {
                keepRemuxMeta: Boolean(state.remuxMeta?.active),
              });
            }
          }
        }
      }
      return;
    }

    if (state.isPlayerOpen && state.activeItem && safeDur > 0) {
      const epKey = `${state.activeItem.id || ""}:s${state.activeSeason}e${state.activeEpisode}`;
      const inFlightMap = state.scrobbleInFlightEpisodes || {};
      const remoteSyncedMap = state.remoteSyncedEpisodesThisSession || {};
      const shouldFinalize =
        state.activeItem.media_type === "series"
          ? !inFlightMap[epKey] &&
            (!state.scrobbledEpisodesThisSession[epKey] ||
              (isServiceEnabled("kinorium") && !remoteSyncedMap[epKey]) ||
              Boolean(state.activeItem.kinorium?.watching && !state.scrobbledThisSession))
          : !state.scrobbledThisSession;
      if (shouldFinalize) {
        state.lastScrobbleReportTime = Date.now();
        reportScrobbleProgress(safeDur, safeDur);
      }
    }
    if (isServiceEnabled("kinorium") && state.activeItem) {
      maybeAutoOpenCreditsRatingCard();
    }
    if (state.sleepAtEpisodeEnd) {
      setSleepTimer("off");
      showToast(
        t(
          "Таймер сна («Конец серии»): воспроизведение завершено",
          'Sleep timer ("End of episode"): playback finished'
        )
      );
      return;
    }
    if (
      state.isPlayerOpen &&
      state.activeItem?.media_type === "series" &&
      state.autoNextEpisode &&
      !state.autoplayCancelledThisEpisode &&
      Boolean(getNextEpisodeCoords())
    ) {
      startAutoplayNextCountdown();
    }
  });

  video.addEventListener("volumechange", () => {
    if (!state.isPlayerOpen || state.internalMuteOverride) return;
    if (video.volume > 0.02) {
      savePlayerPrefs({ volume: video.volume, muted: false });
    }
  });

  video.addEventListener("pause", () => {
    syncCustomVideoControlsUI(true);
    pushDesktopRemoteStateNow();
    hideXRayPauseShelf();
  });

  video.addEventListener("play", () => {
    syncCustomVideoControlsUI(true);
    pushDesktopRemoteStateNow();
    hideXRayPauseShelf();
  });

  video.addEventListener("ratechange", () => {
    if (!state.isPlayerOpen) return;
    ensurePreservesPitch(video);
    if (video.playbackRate && video.playbackRate >= 0.5 && video.playbackRate <= 3) {
      savePlayerPrefs({ playbackRate: video.playbackRate });
      const speedSel = document.getElementById("select-speed");
      if (speedSel) {
        speedSel.value = String(video.playbackRate);
      }
    }
  });
}

// X-Ray pause shelf and moment bookmarks modularized into ./player-bookmarks.js

export function setupVideoListeners() {
  initCustomVideoControls();
  const getVideoEl = () => document.getElementById("native-video");
  bindNativeVideoElementListeners(getVideoEl());
  if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
    const safeBindMediaAction = (action, handler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (err) { window.logDebug?.("Player", err); }
    };
    safeBindMediaAction("play", () => {
      const v = getVideoEl();
      if (state.isPlayerOpen && v?.paused) {
        toggleVideoPlayPause(false);
      }
    });
    safeBindMediaAction("pause", () => {
      const v = getVideoEl();
      if (state.isPlayerOpen && v && !v.paused) {
        toggleVideoPlayPause(false);
      }
    });
    safeBindMediaAction("seekbackward", (details) => {
      if (!state.isPlayerOpen) return;
      const offset = Number(details?.seekOffset) || 10;
      const { cur } = getEffectivePlaybackTiming(getVideoEl());
      seekEffectivePlayback(Math.max(0, cur - offset));
    });
    safeBindMediaAction("seekforward", (details) => {
      if (!state.isPlayerOpen) return;
      const offset = Number(details?.seekOffset) || 10;
      const { cur, dur } = getEffectivePlaybackTiming(getVideoEl());
      seekEffectivePlayback(dur > 0 ? Math.min(dur, cur + offset) : cur + offset);
    });
    safeBindMediaAction("previoustrack", () => {
      if (state.isPlayerOpen && state.activeItem?.media_type === "series") {
        stepEpisode(-1);
      }
    });
    safeBindMediaAction("nexttrack", () => {
      if (state.isPlayerOpen && state.activeItem?.media_type === "series") {
        stepEpisode(1);
      }
    });
  }
  const skipIntroBtn = document.getElementById("skip-intro-btn");
  const skipOutroBtn = document.getElementById("skip-outro-btn");

  const btnAutoNow = document.getElementById("btn-autoplay-now");
  if (btnAutoNow) {
    btnAutoNow.onclick = async () => {
      clearAutoplayNextTimer();
      await stepEpisode(1);
    };
  }

  const btnAutoCancel = document.getElementById("btn-autoplay-cancel");
  if (btnAutoCancel) {
    btnAutoCancel.onclick = () => {
      state.autoplayCancelledThisEpisode = true;
      clearAutoplayNextTimer();
      showToast(t("Автопереход к следующей серии отменен", "Auto-play next episode cancelled"));
    };
  }

  if (skipIntroBtn) {
    skipIntroBtn.onclick = () => {
      const { dur } = getEffectivePlaybackTiming(getVideoEl());
      if (state.skipSegments?.intro && dur > state.skipSegments.intro.end) {
        state.introSkippedThisEpisode = true;
        seekEffectivePlayback(state.skipSegments.intro.end + 0.5);
        skipIntroBtn.classList.add("hidden");
      }
    };
  }

  if (skipOutroBtn) {
    skipOutroBtn.onclick = async () => {
      await stepEpisode(1);
    };
  }

  const btnErrRetry = document.getElementById("btn-video-err-retry");
  if (btnErrRetry) {
    btnErrRetry.onclick = (e) => {
      e.stopPropagation();
      hideVideoStreamError();
      const v = getVideoEl();
      const { cur: effCur } = getEffectivePlaybackTiming(v);
      const savedMediaTime = Number(state.lastPlaybackMediaTime) > 5 ? Number(state.lastPlaybackMediaTime) : 0;
      const curPos = effCur > 5 ? effCur : savedMediaTime;
      if (state.activeSourceTab === "hdrezka") {
        const loader = document.getElementById("video-loader");
        const loaderText = document.getElementById("video-loader-text");
        if (loaderText) {
          loaderText.textContent = t("Повторное подключение к HDRezka...", "Reconnecting to HDRezka...");
        }
        loader?.classList.remove("hidden");
        loadHDRezkaStream(curPos, { forceRefresh: true });
      } else if (state.activeSourceTab === "backup4k") {
        loadBackup4KReleases(curPos, true);
      } else if (state.activeSourceTab === "stremio") {
        loadStremioStreams(curPos);
      }
    };
  }

  const btnErrStudio = document.getElementById("btn-video-err-studio");
  if (btnErrStudio) {
    btnErrStudio.onclick = async (e) => {
      e.stopPropagation();
      await toggleErrorStudiosPanel();
    };
  }

  const btnErrStudiosClose = document.getElementById("btn-video-err-studios-close");
  if (btnErrStudiosClose) {
    btnErrStudiosClose.onclick = (e) => {
      e.stopPropagation();
      document.getElementById("video-error-studios-panel")?.classList.add("hidden");
    };
  }

  const btnErr4k = document.getElementById("btn-video-err-4k");
  if (btnErr4k) {
    btnErr4k.onclick = (e) => {
      e.stopPropagation();
      hideVideoStreamError();
      switchSourceTab("backup4k");
    };
  }
}

// Scrobbling and Kinorium watch progress synchronization modularized into ./player-scrobble.js
// Post-watch rating overlay and credits prompt modularized into ./player-rating.js

export function closePlayerModal(skipCatalogReload = false, forceStop = false, fromPopState = false) {
  if (!forceStop && state.isPlayerOpen && isVideoInPiP()) {
    setPipBackgroundMode(true);
    showToast(
      t(
        "Видео продолжает играть в режиме «Картинка в картинке»",
        "Video continues playing in Picture-in-Picture"
      )
    );
    return;
  }

  state.pausedByOverlayModal = false;
  dismissPlayerNextEpisodeToast(false);
  state._nextEpToastDismissed = false;
  if (state.hasPlayerHistoryEntry) {
    state.hasPlayerHistoryEntry = false;
    if (!fromPopState && window.history.state?.cineflowPlayerModal) {
      state.ignoringSyntheticPopstate = true;
      try {
        window.history.back();
      } catch (_) {
        state.ignoringSyntheticPopstate = false;
      }
    }
  }

  const video = document.getElementById("native-video");
  if (state.isPlayerOpen && state.activeItem && video) {
    const { cur, dur } = getEffectivePlaybackTiming(video);
    const epCloseKey = `${state.activeItem.id || ""}:s${state.activeSeason}e${state.activeEpisode}`;
    const alreadyDoneOnClose =
      state.activeItem.media_type === "series"
        ? Boolean(state.scrobbledEpisodesThisSession[epCloseKey])
        : Boolean(state.scrobbledThisSession);
    if (dur >= 60 && cur >= 10) {
      if (!(alreadyDoneOnClose && cur / dur >= 0.70)) {
        saveEpisodeProgress(state.activeItem, state.activeSeason, state.activeEpisode, cur, dur);
        reportScrobbleProgress(cur, dur).catch(() => {});
      }
      recordWatchHistoryEntry(
        state.activeItem,
        state.activeSeason,
        state.activeEpisode,
        cur,
        dur,
        state.activeStudioName
      );
      state.catalogDirty = true;
    }
  }

  document.getElementById("player-gear-popover")?.classList.add("hidden");
  document.getElementById("btn-player-gear")?.classList.remove("active");
  if (state.sleepTimerId || (state.sleepTimerMode && state.sleepTimerMode !== "off")) {
    setSleepTimer("off");
  }
  clearAutoplayNextTimer();
  clearCustomSubtitleOverlay(false);
  if (state.remuxDurationReprobeTimer) {
    clearTimeout(state.remuxDurationReprobeTimer);
    state.remuxDurationReprobeTimer = null;
  }
  stopAmbilightLoop(true);
  closeCustomSelectMenu({ restoreFocus: false });
  closeAllVcPopovers();
  syncVcPopoverOpenClass();
  hideVideoStreamError();
  if (state.vcIdleTimerId) {
    clearTimeout(state.vcIdleTimerId);
    state.vcIdleTimerId = null;
  }
  if (state.vcClickTimerId) {
    clearTimeout(state.vcClickTimerId);
    state.vcClickTimerId = null;
  }
  state.isPseudoFullscreen = false;
  document.getElementById("video-stage")?.classList.remove("is-pseudo-fullscreen");
  document.documentElement.classList.remove(
    "is-stage-fullscreen",
    "is-stage-pseudo-fullscreen",
    "fs-transitioning"
  );
  state.fsTransitioning = false;
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
  setVideoStageIdle(false);
  syncToastContainerMount();
  state.isPipBackground = false;
  document.getElementById("pip-status-dock")?.classList.add("hidden");
  document.getElementById("video-pip-placeholder")?.classList.add("hidden");
  setMiniPlayerMode(false);
  document.getElementById("player-gear-popover")?.classList.add("hidden");
  document.getElementById("btn-player-gear")?.classList.remove("active");
  state.isPlayerOpen = false;
  state.isPlayingOfflineDownload = false;
  state.activeOfflineDownloadId = "";
  if (state.activeSourceTab === "offline") {
    state.activeSourceTab = "hdrezka";
  }
  const studioSelOnClose = document.getElementById("select-studio");
  if (studioSelOnClose && studioSelOnClose.disabled) studioSelOnClose.disabled = false;
  const qualSelOnClose = document.getElementById("select-quality");
  if (qualSelOnClose && qualSelOnClose.disabled) qualSelOnClose.disabled = false;
  state.remuxMeta = null;
  state.preloadedNextEpisode = null;
  state.preloadingNextKey = "";
  state.playerSessionId += 1;
  syncNativeNowPlaying(true);
  syncScrollTopButton();

  const trailerStage = document.getElementById("trailer-stage-box");
  if (trailerStage) {
    trailerStage.innerHTML = "";
    trailerStage.classList.add("hidden");
  }

  [
    "streamAbortController",
    "backup4kAbortController",
    "stremioResolveAbortController",
    "remuxProbeAbortController",
    "skipIntroAbortController",
    "trailerAbortController",
  ].forEach((ctrlKey) => {
    if (state[ctrlKey]) {
      try {
        state[ctrlKey].abort();
      } catch (err) { window.logDebug?.("Player", err); }
      state[ctrlKey] = null;
    }
  });

  const modal = document.getElementById("player-modal");
  modal?.classList.remove("pip-background-mode");
  const loader = document.getElementById("video-loader");
  if (loader) loader.classList.add("hidden");

  abortActiveVideoListeners();
  if (state.hlsInstance) {
    try {
      state.hlsInstance.destroy();
    } catch (err) { window.logDebug?.("Player", err); }
    state.hlsInstance = null;
  }

  if (video) {
    if (document.pictureInPictureElement) {
      try {
        document.exitPictureInPicture();
      } catch (err) { window.logDebug?.("Player", err); }
    } else if (
      typeof video.webkitSetPresentationMode === "function" &&
      video.webkitPresentationMode === "picture-in-picture"
    ) {
      try {
        video.webkitSetPresentationMode("inline");
      } catch (err) { window.logDebug?.("Player", err); }
    }
    video.onloadedmetadata = null;
    try {
      video.pause();
    } catch (err) { window.logDebug?.("Player", err); }
    video.querySelectorAll("track").forEach((tr) => tr.remove());
    video.removeAttribute("src");
    video.srcObject = null;
    try {
      video.load();
    } catch (err) { window.logDebug?.("Player", err); }
  }

  if (modal && !modal.classList.contains("hidden")) {
    modal.classList.add("hidden");
    restoreModalTriggerFocus("player-modal");
  }
  if (!skipCatalogReload && state.catalogDirty) {
    state.catalogDirty = false;
    loadCatalog();
  }
  sweepPendingDownloadCleanups();
  pushDesktopRemoteStateNow();
}
export function refreshOpenPlayerLanguageUI(langChanged = false) {
  if (!state.isPlayerOpen || !state.activeItem) return;
  const item = state.activeItem;
  const modalTitleEl = document.getElementById("modal-title");
  if (modalTitleEl) {
    modalTitleEl.textContent = displayTitle(item);
  }
  renderModalGenresAndSubheader(item);
  const descEl = document.getElementById("meta-description");
  if (descEl) {
    descEl.textContent = displayDescription(item) || "";
  }
  const critEl = document.getElementById("meta-r-critics");
  if (critEl) {
    critEl.textContent = formatCriticsRating(item);
  }
  renderModalCastSection(item);
  updateModalKinoriumHeader(item.kinorium || {});
  renderModalProvidersSidebar(item);
  renderModalSimilarItems(item);
  updateMiniPlayerTitle();
  syncPipDockUI();
  syncMediaSessionMetadata();

  if (item.media_type === "series") {
    const effMap = resolveEffectiveSeasonsMap(item, state.seasonsMap);
    populateSeasonEpisodeSelectors(item, effMap);
    updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);
  }

  const studioSel = document.getElementById("select-studio");
  if (studioSel) {
    const multiOffline = state.activeSourceTab === "offline" && studioSel.options.length > 1;
    Array.from(studioSel.options || []).forEach((opt) => {
      if (opt.dataset?.rawName) {
        const baseName = translateStudioName(opt.dataset.rawName);
        opt.textContent =
          state.activeSourceTab === "offline"
            ? `${baseName}${multiOffline && opt.dataset.qual ? ` · ${opt.dataset.qual}` : ""} (${t("Офлайн", "Offline")})`
            : baseName;
        if (opt.selected) {
          state.activeStudioName = opt.textContent;
        }
      }
    });
    if (studioSel.options.length > 0 && !Array.from(studioSel.options).some((o) => o.selected)) {
      const firstFreeOpt = Array.from(studioSel.options).find((o) => o.dataset.isOriginal !== "1") || studioSel.options[0];
      if (firstFreeOpt) {
        firstFreeOpt.selected = true;
        state.activeStudioId = String(firstFreeOpt.value);
        state.activeStudioName = firstFreeOpt.textContent;
      }
    }
    syncCustomSelect(studioSel);
  }
  if (state.activeSourceTab === "offline" && Array.isArray(state.subtitles)) {
    state.subtitles = state.subtitles.map((s) => ({
      ...s,
      lang: _localizeOfflineSubLabel(s.rawLang || s.lang || "Subtitles"),
    }));
  }
  populateSubtitlesSelector(state.subtitles);
  syncCustomControlPopovers();
  syncCustomVideoControlsUI(true);

  if (!document.getElementById("kinorium-postwatch-overlay")?.classList.contains("hidden")) {
    renderPostWatchRatingState();
  }

  if (!langChanged) return;

  fetchAndApplyPlayerTitleMeta(item, state.playerSessionId);
  state.preloadedNextEpisode = null;
  const video = document.getElementById("native-video");
  const { cur } = getEffectivePlaybackTiming(video);
  const resumePos = cur > 3 ? cur : 0;

  if (state.activeSourceTab === "trailer") {
    state.trailerLang = isEn() ? "en" : "ru";
    if (state.trailerData) {
      renderTrailerEmbed(state.trailerLang);
    }
  } else if (state.activeSourceTab === "hdrezka") {
    if (!getPreferredStudioForItem(item)) {
      state.activeStudioId = "";
      loadHDRezkaStream(resumePos);
    }
  } else if (state.activeSourceTab === "stremio") {
    loadStremioStreams(resumePos);
  } else if (state.activeSourceTab === "backup4k") {
    const activeRelUrl = state.active4kReleaseUrl;
    loadBackup4KReleases(resumePos).then(() => {
      if (activeRelUrl && state.isPlayerOpen && state.activeSourceTab === "backup4k") {
        probeAndPlay4KStream(activeRelUrl, resumePos, "4K UHD", state.playerSessionId, {
          extraSubtitles: state.external4kSubs || [],
        });
      }
    });
  }
}
