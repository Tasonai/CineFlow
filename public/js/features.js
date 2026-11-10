import { ACTIVE_PROFILE_STORAGE_KEY, state } from "./state.js?v=20261110v3";
import { displayTitle, isEn, t, translateStudioName } from "./i18n.js?v=20261110v3";
import {
  clampFloatingPopover,
  closeCustomSelectMenu,
  closeFloatingPopovers,
  copyTextToClipboard,
  escapeAttr,
  escapeHtml,
  findOfflineDownloadForTitle,
  formatTime,
  getEpisodeProgress,
  iconSvg,
  invalidateLocalCaches,
  isCustomSelectMenuOpen,
  matchCatalogItemSafe,
  rememberModalTriggerFocus,
  restoreModalTriggerFocus,
  showConfirmModal,
  showToast,
  showVideoOsd,
  syncAllCustomSelects,
  syncCustomSelect,
  syncScrollTopButton,
  syncSearchInputHasQueryUI,
} from "./utils.js?v=20261110v3";
import {
  applyAudioBoostToVideo,
  applySubtitleStylePrefs,
  applyVideoCropToVideo,
  getPlayerPrefs,
  savePlayerPrefs,
  updatePlayerGearActiveDot,
} from "./audio-dsp.js?v=20261110v3";
import {
  applyEnabledServicesVisibility,
  clearCatalogFrontendCache,
  closeCommandPalette,
  closeMovieRouletteModal,
  getDefaultPlayableSourceTab,
  loadCatalog,
  renderCatalogShelves,
  renderContinueWatching,
  renderNotificationsBell,
  resolvePreferredPlayTab,
  updateActiveFiltersBadge,
  updateKinoriumSectionCounters,
  updateKinoriumUserBadge,
} from "./catalog.js?v=20261110v3";
import {
  closePersonModal,
  closeQuickPeekModal,
  closeStatsModal,
  openQuickPeekModal,
} from "./modals.js?v=20261110v3";
import {
  closeAllVcPopovers,
  closePlayerModal,
  getEffectivePlaybackTiming,
  getEpisodeDisplayMeta,
  hasOpenVcPopover,
  isStageFullscreen,
  openPlayerModal,
  seekEffectivePlayback,
  stepEpisode,
  switchSourceTab,
  syncCustomVideoControlsUI,
  syncPlayerOfflineControlsUI,
  syncVcPopoverOpenClass,
  toggleStageFullscreen,
  toggleVideoPlayPause,
  wakeVideoControls,
} from "./player.js?v=20261110v3";
import {
  closeOnboardingModal,
  openSettingsModal,
  renderIntegrationsList,
  toggleLanAccess,
  updateBackupSummaryStat,
} from "./settings.js?v=20261110v3";
import {
  loadAndRenderRemotePairingPanel,
  pushDesktopRemoteStateNow,
  switchCastModalTab,
} from "./remote.js?v=20261110v3";

export function exitBrowserFullscreenIfNeeded() {
  if (typeof document === "undefined") return;
  if (isStageFullscreen() || document.fullscreenElement || document.webkitFullscreenElement) {
    try {
      if (isStageFullscreen()) {
        toggleStageFullscreen();
      } else if (typeof document.exitFullscreen === "function" && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else if (typeof document.webkitExitFullscreen === "function") {
        document.webkitExitFullscreen();
      }
    } catch (err) { window.logDebug?.("Features", err); }
  }
}

export function isNativeMacApp() {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.__VELARIUM_MACOS_APP__ ||
      (window.webkit &&
        window.webkit.messageHandlers &&
        window.webkit.messageHandlers.velariumNative)
  );
}

export function formatBytesHuman(bytes) {
  const val = Number(bytes) || 0;
  if (val <= 0) return isEn() ? "0 MB" : "0 МБ";
  const gb = 1024 * 1024 * 1024;
  const mb = 1024 * 1024;
  const kb = 1024;
  if (val >= gb) {
    return `${(val / gb).toFixed(2)} ${isEn() ? "GB" : "ГБ"}`;
  }
  if (val >= mb) {
    return `${(val / mb).toFixed(val >= 100 * mb ? 0 : 1)} ${isEn() ? "MB" : "МБ"}`;
  }
  return `${Math.max(1, Math.round(val / kb))} ${isEn() ? "KB" : "КБ"}`;
}

// ============================================================================
// 1. NATIVE macOS APP BRIDGE (Now Playing + Hardware Media Keys)
// ============================================================================

export function syncNativeNowPlaying(force = false) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (!force && now - (state.lastNativeNowPlayingTs || 0) < 1800) {
    return;
  }
  state.lastNativeNowPlayingTs = now;

  const video = document.getElementById("native-video");
  const active = Boolean(
    state.isPlayerOpen &&
      state.activeItem &&
      state.activeSourceTab !== "trailer" &&
      video
  );
  const { cur, dur } = active ? getEffectivePlaybackTiming(video) : { cur: 0, dur: 0 };

  if (active && typeof navigator !== "undefined" && navigator.mediaSession?.setPositionState && dur > 0) {
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        playbackRate: Number(video.playbackRate) || 1.0,
        position: Math.min(dur, Math.max(0, cur)),
      });
    } catch (err) { window.logDebug?.("Features", err); }
  }

  const handler = window.webkit?.messageHandlers?.velariumNative;
  if (!handler || typeof handler.postMessage !== "function") return;

  if (!active) {
    try {
      handler.postMessage({ action: "nowPlaying", active: false });
    } catch (err) { window.logDebug?.("Features", err); }
    return;
  }

  const item = state.activeItem;
  const isSeries = item?.media_type === "series";
  const epMeta = isSeries ? getEpisodeDisplayMeta(state.activeSeason, state.activeEpisode) : null;
  const subtitle = isSeries
    ? `${t(
        `Сезон ${state.activeSeason}, Серия ${state.activeEpisode}`,
        `Season ${state.activeSeason}, Episode ${state.activeEpisode}`
      )}${epMeta?.realTitle ? ` — ${epMeta.realTitle}` : ""}`
    : [item?.year ? String(item.year) : "", state.activeStudioName || ""].filter(Boolean).join(" · ");

  let posterUrl = String(item?.poster || item?.backdrop || "").trim();
  if (posterUrl.startsWith("/")) {
    posterUrl = `${window.location.origin}${posterUrl}`;
  }

  try {
    handler.postMessage({
      action: "nowPlaying",
      active: true,
      title: displayTitle(item) || "Velarium",
      subtitle: subtitle || "Velarium",
      duration: Number(dur) || 0,
      currentTime: Number(cur) || 0,
      playing: Boolean(video && !video.paused && !video.ended),
      playbackRate: Number(video?.playbackRate) || 1.0,
      poster: posterUrl,
    });
  } catch (err) { window.logDebug?.("Features", err); }
}

function registerNativeBridgeCallbacks() {
  if (typeof window === "undefined") return;

  window.__velariumHandleNativeMediaCommand = (cmd, value) => {
    if (!state.isPlayerOpen) return;
    const video = document.getElementById("native-video");
    if (!video) return;
    const { cur, dur } = getEffectivePlaybackTiming(video);
    if (cmd === "togglePlayPause" || cmd === "toggle") {
      toggleVideoPlayPause(true);
    } else if (cmd === "play") {
      if (video.paused) toggleVideoPlayPause(false);
    } else if (cmd === "pause") {
      if (!video.paused) toggleVideoPlayPause(false);
    } else if (cmd === "nextTrack" || cmd === "next") {
      if (state.activeItem?.media_type === "series") stepEpisode(1);
    } else if (cmd === "prevTrack" || cmd === "prev") {
      if (state.activeItem?.media_type === "series") stepEpisode(-1);
    } else if (cmd === "skipForward" || cmd === "seekForward10") {
      const delta = Number(value) || 10;
      seekEffectivePlayback(dur > 0 ? Math.min(dur, cur + delta) : cur + delta);
    } else if (cmd === "skipBackward" || cmd === "seekBack10") {
      const delta = Number(value) || 10;
      seekEffectivePlayback(Math.max(0, cur - delta));
    } else if (cmd === "seekTo") {
      const target = Number(value);
      if (Number.isFinite(target) && target >= 0) {
        seekEffectivePlayback(target);
      }
    }
    syncNativeNowPlaying(true);
  };
}

// ============================================================================
// 2. HOUSEHOLD PROFILES (Personal, Family, Kids + Custom)
// ============================================================================

import {
  PROFILE_COLOR_SWATCHES,
  _profileColorClass,
  _computeInitialsFromName,
  resolveProfileKinoriumInfo,
  getProfileBaseLabel,
  getProfileDisplayLabel,
  getProfileAvatarUrl,
  _renderAvatarInnerHtml,
  _bindAvatarImgFallbacks,
  applyProfilesPayload,
  renderHeaderProfileSwitcher,
  toggleProfilePopover,
  closeProfilePopover,
  reloadProfileLocalPlayerPrefs,
  closeKidsPinModal,
  promptKidsPinModal,
  ensureKidsPinVerifiedForAdminAction,
  requestKidsPinVerification,
  isItemSafeForKidsClient,
  switchActiveProfile,
  openProfilesModal,
  closeProfilesModal,
  renderProfilesModalUI,
  saveProfileFromModal,
  deleteProfileById,
  _activePinResolver,
  _kidsPinTriggerEl,
  _editingProfileId,
  _editingProfileColor,
  _clearKidsPinRequested,
} from "./features-profiles.js?v=20261110v3";

export {
  PROFILE_COLOR_SWATCHES,
  _profileColorClass,
  _computeInitialsFromName,
  resolveProfileKinoriumInfo,
  getProfileBaseLabel,
  getProfileDisplayLabel,
  getProfileAvatarUrl,
  _renderAvatarInnerHtml,
  _bindAvatarImgFallbacks,
  applyProfilesPayload,
  renderHeaderProfileSwitcher,
  toggleProfilePopover,
  closeProfilePopover,
  reloadProfileLocalPlayerPrefs,
  closeKidsPinModal,
  promptKidsPinModal,
  ensureKidsPinVerifiedForAdminAction,
  requestKidsPinVerification,
  isItemSafeForKidsClient,
  switchActiveProfile,
  openProfilesModal,
  closeProfilesModal,
  renderProfilesModalUI,
  saveProfileFromModal,
  deleteProfileById,
  _activePinResolver,
  _kidsPinTriggerEl,
  _editingProfileId,
  _editingProfileColor,
  _clearKidsPinRequested,
};

// ============================================================================
// 3. ONE-CLICK KINORIUM LOGIN (No Manual Cookie Copy from DevTools)
// ============================================================================

async function finalizeKinoriumOneClickSuccess(resultPayload) {
  if (!resultPayload) return;
  const acc = resultPayload.account || resultPayload.kinorium_account || null;
  if (acc) {
    state.kinoriumAccount = acc;
  }
  state.kinoriumFormExpanded = false;
  if (resultPayload.integrations) {
    state.integrations = resultPayload.integrations;
  } else if (state.integrations?.kinorium) {
    state.integrations.kinorium.enabled = true;
    state.integrations.kinorium.logged_in = true;
  }

  const obUserInp = document.getElementById("ob-kinorium-user");
  if (obUserInp && acc?.user_id) {
    obUserInp.value = String(acc.user_id);
  }
  if (state.onboardingDraftServices) {
    state.onboardingDraftServices.kinorium = true;
  }

  try {
    const profRes = await fetch(`/api/profiles?lang=${encodeURIComponent(state.appLang || "ru")}`);
    if (profRes.ok) {
      applyProfilesPayload(await profRes.json());
    }
  } catch (err) { window.logDebug?.("Features", err); }

  applyEnabledServicesVisibility();
  updateKinoriumUserBadge();
  renderIntegrationsList();
  updateBackupSummaryStat();
  if (!document.getElementById("profiles-modal")?.classList.contains("hidden")) {
    renderProfilesModalUI(_editingProfileId);
  }

  const disp = acc?.display_name || (acc?.user_id ? `ID ${acc.user_id}` : "Kinorium");
  showToast(
    t(
      `Kinorium подключён автоматически: ${disp} (списки и сессия сохранены)`,
      `Kinorium connected automatically: ${disp} (lists & session saved)`
    )
  );
  await loadCatalog();
}

export async function startOneClickKinoriumLogin(triggerBtn = null) {
  if (state.kinoriumOneClickPolling) {
    showToast(
      t(
        "Окно входа в Kinorium уже открыто — завершите авторизацию в нём",
        "Kinorium sign-in window is already open — complete sign-in there"
      )
    );
    return;
  }

  let verifiedPin = "";
  if (state.activeProfile?.kids_mode && state.activeProfile?.has_kids_pin) {
    const entered = await ensureKidsPinVerifiedForAdminAction(
      t(
        "Введите родительский 4-значный PIN-код для привязки Kinorium",
        "Enter the 4-digit parental PIN to link Kinorium"
      )
    );
    if (!entered) return;
    verifiedPin = entered;
  }

  const getLiveButtons = () => {
    const list = Array.from(document.querySelectorAll(".btn-kin-one-click, #btn-ob-kinorium-one-click"));
    if (triggerBtn && !list.includes(triggerBtn)) list.push(triggerBtn);
    return list;
  };
  const setBtnBusy = (busy, customLabel = "") => {
    const labelText =
      customLabel || t("Ожидание входа в браузере...", "Waiting for browser sign-in...");
    getLiveButtons().forEach((btn) => {
      if (!btn) return;
      btn.disabled = busy;
      if (busy) {
        if (!btn.dataset.origHtml) {
          btn.dataset.origHtml = btn.innerHTML;
        }
        btn.innerHTML = `<span class="spinner-xs"></span> <span>${labelText}</span>`;
      } else if (btn.dataset.origHtml) {
        btn.innerHTML = btn.dataset.origHtml;
        delete btn.dataset.origHtml;
      } else {
        btn.innerHTML = `<span>${t("Войти в 1 клик (авто)", "1-Click Sign In")}</span>`;
      }
    });
  };

  state.kinoriumOneClickPolling = true;
  setBtnBusy(true);

  try {
    const startRes = await fetch("/api/kinorium/one-click-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang: state.appLang || "ru", pin: verifiedPin }),
    });
    const startData = await startRes.json();
    if (!startRes.ok || !startData.ok) {
      state.kinoriumOneClickPolling = false;
      setBtnBusy(false);
      if (!document.getElementById("profiles-modal")?.classList.contains("hidden")) {
        closeProfilesModal();
        state.kinoriumFormExpanded = true;
        openSettingsModal("integrations");
      }
      showToast(
        startData.error ||
          t(
            "Автоматический вход недоступен на этой системе — укажите ID профиля вручную",
            "Automatic sign-in is unavailable on this system — enter profile ID manually"
          )
      );
      return;
    }

    showToast(
      t(
        "Открыт браузер по умолчанию — войдите в Kinorium, профиль подключится автоматически",
        "Default browser opened — sign in to Kinorium and your profile will link automatically"
      )
    );

    if (state.kinoriumOneClickPollTimer) {
      clearInterval(state.kinoriumOneClickPollTimer);
      state.kinoriumOneClickPollTimer = null;
    }
    const pollStartTs = Date.now();
    let announcedSyncing = false;
    const checkOneClickStatus = async () => {
      if (Date.now() - pollStartTs > 310000) {
        if (state.kinoriumOneClickPollTimer) {
          clearInterval(state.kinoriumOneClickPollTimer);
          state.kinoriumOneClickPollTimer = null;
        }
        state.kinoriumOneClickPolling = false;
        setBtnBusy(false);
        return;
      }
      try {
        const stRes = await fetch("/api/kinorium/one-click-status");
        if (!stRes.ok) return;
        const stData = await stRes.json();
        if (stData.status === "syncing") {
          if (stData.kinorium_account) {
            state.kinoriumAccount = stData.kinorium_account;
            updateKinoriumUserBadge();
          }
          if (stData.integrations) {
            state.integrations = stData.integrations;
          }
          const dispName =
            stData.display_name ||
            stData.kinorium_account?.display_name ||
            (stData.user_id ? `ID ${stData.user_id}` : "Kinorium");
          setBtnBusy(
            true,
            t(`Вход выполнен (${dispName}) · синхронизация...`, `Signed in (${dispName}) · syncing...`)
          );
          const statusEl = document.querySelector(".kinorium-card .integration-status");
          if (statusEl) {
            statusEl.textContent = t(
              `${dispName} · синхронизация списков и оценок...`,
              `${dispName} · syncing lists & ratings...`
            );
          }
          if (!announcedSyncing) {
            announcedSyncing = true;
            showToast(
              t(
                `Вход выполнен (${dispName}) — синхронизируем списки Kinorium...`,
                `Signed in (${dispName}) — syncing Kinorium lists...`
              )
            );
          }
          return;
        }
        if (stData.status === "waiting" || stData.status === "running") {
          return;
        }

        if (state.kinoriumOneClickPollTimer) {
          clearInterval(state.kinoriumOneClickPollTimer);
          state.kinoriumOneClickPollTimer = null;
        }
        state.kinoriumOneClickPolling = false;
        setBtnBusy(false);

        if (stData.status === "done" || stData.status === "completed") {
          await finalizeKinoriumOneClickSuccess(stData.result || stData);
        } else if (stData.status === "cancelled") {
          showToast(t("Окно входа в Kinorium закрыто", "Kinorium sign-in window closed"));
        } else if (stData.status === "error") {
          showToast(stData.error || t("Не удалось выполнить вход в Kinorium", "Kinorium sign-in failed"));
        }
      } catch (err) { window.logDebug?.("Features", err); }
    };
    const pollTimer = setInterval(checkOneClickStatus, 650);
    state.kinoriumOneClickPollTimer = pollTimer;
    setTimeout(checkOneClickStatus, 350);
  } catch (_) {
    state.kinoriumOneClickPolling = false;
    setBtnBusy(false);
    showToast(t("Не удалось запустить окно входа Kinorium", "Could not launch Kinorium sign-in window"));
  }
}

// ============================================================================
// 4. OFFLINE DOWNLOADS MANAGER ("Скачать в дорогу" — MP4 + Audio + RU/EN VTT)
// ============================================================================

import {
  syncDownloadsHeaderBadge,
  _completedDownloadsSignature,
  _syncOfflineSurfacesAfterDownloadsChange,
  syncDownloadsPrefsCheckboxes,
  saveDownloadsPrefs,
  sweepPendingDownloadCleanups,
  enqueueBatchSeriesDownload,
  refreshDownloadsState,
  startDownloadsPollingIfNeeded,
  downloadCurrentPlayerStreamOffline,
  openDownloadsModal,
  closeDownloadsModal,
  renderDownloadsModalList,
  playOfflineDownload,
  cancelOfflineDownload,
  retryOfflineDownload,
  deleteOfflineDownload,
  deleteSeasonOfflineDownloads,
  openDownloadsFolder,
} from "./features-downloads.js?v=20261110v3";

export {
  syncDownloadsHeaderBadge,
  _completedDownloadsSignature,
  _syncOfflineSurfacesAfterDownloadsChange,
  syncDownloadsPrefsCheckboxes,
  saveDownloadsPrefs,
  sweepPendingDownloadCleanups,
  enqueueBatchSeriesDownload,
  refreshDownloadsState,
  startDownloadsPollingIfNeeded,
  downloadCurrentPlayerStreamOffline,
  openDownloadsModal,
  closeDownloadsModal,
  renderDownloadsModalList,
  playOfflineDownload,
  cancelOfflineDownload,
  retryOfflineDownload,
  deleteOfflineDownload,
  deleteSeasonOfflineDownloads,
  openDownloadsFolder,
};

// ============================================================================
// 5. TV MODE (D-Pad / Gamepad Spatial Navigation)
// ============================================================================

import {
  clearTvFocusClass,
  setTvFocusedElement,
  collectTvNavigableElements,
  getPreferredInitialTvFocus,
  moveSpatialFocus,
  toggleTvMode,
  setTvMode,
  executeRemoteBackAction as _executeRemoteBackAction,
  _syncTvFocusAfterSurfaceChange,
  executeRemoteDpadCommand as _executeRemoteDpadCommand,
  handleTvSpatialKeydown,
  startGamepadPollingLoop,
} from "./features-tv-mode.js?v=20261110v3";

export {
  clearTvFocusClass,
  setTvFocusedElement,
  collectTvNavigableElements,
  getPreferredInitialTvFocus,
  moveSpatialFocus,
  toggleTvMode,
  setTvMode,
  _syncTvFocusAfterSurfaceChange,
  handleTvSpatialKeydown,
  startGamepadPollingLoop,
};

export function executeRemoteDpadCommand(direction) {
  return _executeRemoteDpadCommand(direction);
}

export function executeRemoteBackAction() {
  return _executeRemoteBackAction();
}

// ============================================================================
// 6. TV CAST & AIRPLAY / DLNA / REMOTE LINK
// ============================================================================

import {
  supportsWebkitAirPlay,
  triggerNativeAirPlayPicker,
  openTvCastModal,
  closeTvCastModal,
  refreshTvDevices,
  renderTvCastModalUI,
  castCurrentStreamToDlna,
  stopActiveDlnaCast,
  parseInitialTvUrlParams,
  applyPendingTvDeepLinkIfReady,
  openPlayerHandoffModal,
  closePlayerHandoffModal,
} from "./features-cast.js?v=20261110v3";

export {
  supportsWebkitAirPlay,
  triggerNativeAirPlayPicker,
  openTvCastModal,
  closeTvCastModal,
  refreshTvDevices,
  renderTvCastModalUI,
  castCurrentStreamToDlna,
  stopActiveDlnaCast,
  parseInitialTvUrlParams,
  applyPendingTvDeepLinkIfReady,
  openPlayerHandoffModal,
  closePlayerHandoffModal,
};

// ============================================================================
// 6. UNIFIED BOOT INITIALIZER
// ============================================================================

export function initRoadmapFeatures() {
  registerNativeBridgeCallbacks();
  parseInitialTvUrlParams();

  // Header & profile menu buttons
  document.getElementById("btn-profile-switcher")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleProfilePopover();
  });
  document.getElementById("btn-open-downloads-modal")?.addEventListener("click", () => {
    openDownloadsModal();
  });
  document.getElementById("btn-prof-menu-downloads")?.addEventListener("click", () => {
    closeProfilePopover();
    openDownloadsModal();
  });
  document.getElementById("btn-prof-menu-remote")?.addEventListener("click", () => {
    closeProfilePopover();
    openTvCastModal("phone");
  });
  document.getElementById("btn-open-stats-modal")?.addEventListener("click", () => {
    closeProfilePopover();
  });
  document.getElementById("btn-toggle-tv-mode")?.addEventListener("click", () => {
    closeProfilePopover();
    toggleTvMode();
  });

  // Player controls: Offline Download, Phone Remote & AirPlay / Smart TV Cast
  document.getElementById("vc-btn-offline-dl")?.addEventListener("click", (e) => {
    e.stopPropagation();
    downloadCurrentPlayerStreamOffline();
  });
  document.getElementById("btn-download-offline")?.addEventListener("click", (e) => {
    e.stopPropagation();
    downloadCurrentPlayerStreamOffline();
  });
  document.getElementById("btn-dl-batch-3")?.addEventListener("click", (e) => {
    e.stopPropagation();
    enqueueBatchSeriesDownload("next3");
  });
  document.getElementById("btn-dl-batch-unwatched")?.addEventListener("click", (e) => {
    e.stopPropagation();
    enqueueBatchSeriesDownload("unwatched");
  });
  document.getElementById("btn-dl-batch-season")?.addEventListener("click", (e) => {
    e.stopPropagation();
    enqueueBatchSeriesDownload("season");
  });
  document.getElementById("vc-btn-remote")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openTvCastModal("phone");
  });
  document.getElementById("vc-btn-cast")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openTvCastModal(e, "tv");
  });

  // Onboarding 1-click Kinorium button
  document.getElementById("btn-ob-kinorium-one-click")?.addEventListener("click", (e) => {
    startOneClickKinoriumLogin(e.currentTarget);
  });

  // Downloads modal buttons & automation toggles
  document.getElementById("close-downloads-modal")?.addEventListener("click", closeDownloadsModal);
  document.getElementById("btn-downloads-open-folder")?.addEventListener("click", () => openDownloadsFolder(""));
  document.getElementById("dl-pref-auto-cleanup")?.addEventListener("change", (e) => {
    saveDownloadsPrefs({ auto_cleanup_watched: Boolean(e.target.checked) });
  });
  document.getElementById("dl-pref-auto-next")?.addEventListener("change", (e) => {
    saveDownloadsPrefs({ auto_download_next: Boolean(e.target.checked) });
  });
  document.getElementById("downloads-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "downloads-modal") closeDownloadsModal();
  });

  // Phone Remote & TV Cast modal buttons
  document.getElementById("close-tv-cast-modal")?.addEventListener("click", closeTvCastModal);
  document.getElementById("btn-cast-tab-phone")?.addEventListener("click", () => {
    switchCastModalTab("phone");
  });
  document.getElementById("btn-cast-tab-tv")?.addEventListener("click", () => {
    switchCastModalTab("tv");
  });
  document.getElementById("tv-cast-tabs-bar")?.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      ev.preventDefault();
      const nextTab = state.remoteCastTab === "tv" ? "phone" : "tv";
      switchCastModalTab(nextTab, { focusTab: true });
    } else if (ev.key === "Home") {
      ev.preventDefault();
      switchCastModalTab("phone", { focusTab: true });
    } else if (ev.key === "End") {
      ev.preventDefault();
      switchCastModalTab("tv", { focusTab: true });
    }
  });
  document.getElementById("btn-remote-copy-url")?.addEventListener("click", async () => {
    const urlStr =
      state.remotePairInfo?.remote_url ||
      document.getElementById("remote-pair-url-text")?.textContent ||
      "";
    if (urlStr && urlStr !== "—") {
      const ok = await copyTextToClipboard(urlStr);
      if (ok) {
        showToast(t("Ссылка мобильного пульта скопирована", "Phone remote link copied"));
      }
    }
  });
  document.getElementById("btn-remote-rotate-key")?.addEventListener("click", () => {
    loadAndRenderRemotePairingPanel(true);
  });
  document.getElementById("btn-remote-open-preview")?.addEventListener("click", async () => {
    const urlStr =
      state.remotePairInfo?.remote_url ||
      document.getElementById("remote-pair-url-text")?.textContent ||
      "";
    if (urlStr && urlStr !== "—") {
      try {
        window.open(urlStr, "_blank", "noopener,noreferrer,width=430,height=840");
      } catch (_) {}
      const ok = await copyTextToClipboard(urlStr);
      if (ok) {
        showToast(t("Ссылка веб-пульта скопирована", "Web remote link copied"));
      }
    }
  });
  document.getElementById("btn-tv-airplay-picker")?.addEventListener("click", () => {
    triggerNativeAirPlayPicker();
  });
  document.getElementById("btn-tv-rescan")?.addEventListener("click", () => {
    refreshTvDevices(true);
  });
  document.getElementById("btn-tv-copy-url")?.addEventListener("click", async () => {
    const ok = await copyTextToClipboard(state.tvUrl || window.location.origin);
    if (ok) {
      showToast(t("Ссылка для Smart TV скопирована", "Smart TV link copied"));
    }
  });
  document.getElementById("btn-tv-enable-dpad")?.addEventListener("click", () => {
    toggleTvMode(true);
    closeTvCastModal();
  });
  document.getElementById("btn-tv-stop-cast")?.addEventListener("click", () => {
    stopActiveDlnaCast();
  });
  document.getElementById("tv-cast-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "tv-cast-modal") closeTvCastModal();
  });

  // Handoff modal buttons & remote switch
  document.getElementById("btn-gear-remote")?.addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("player-gear-popover")?.classList.add("hidden");
    document.getElementById("btn-player-gear")?.classList.remove("active");
    openTvCastModal("phone");
  });
  document.getElementById("btn-handoff-to-remote")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closePlayerHandoffModal();
    openTvCastModal("phone");
  });
  document.getElementById("btn-player-handoff")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openPlayerHandoffModal();
  });
  document.getElementById("close-handoff-modal")?.addEventListener("click", closePlayerHandoffModal);
  document.getElementById("handoff-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "handoff-modal") closePlayerHandoffModal();
  });
  document.getElementById("btn-handoff-copy-url")?.addEventListener("click", async () => {
    const input = document.getElementById("handoff-url-input");
    const val = input?.value || "";
    if (val) {
      const ok = await copyTextToClipboard(val);
      if (ok) {
        showToast(t("Ссылка для продолжения скопирована", "Handoff link copied"));
      }
    }
  });

  // Profiles modal buttons
  document.getElementById("close-profiles-modal")?.addEventListener("click", closeProfilesModal);
  document.getElementById("btn-prof-save")?.addEventListener("click", saveProfileFromModal);
  document.getElementById("btn-prof-delete")?.addEventListener("click", () => {
    deleteProfileById(_editingProfileId);
  });
  document.getElementById("btn-prof-kinorium-oneclick")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (_editingProfileId === "new") {
      const savedOk = await saveProfileFromModal();
      if (!savedOk || _editingProfileId === "new") return;
    } else if (_editingProfileId !== state.activeProfileId) {
      await switchActiveProfile(_editingProfileId);
      if (state.activeProfileId !== _editingProfileId) return;
    }
    startOneClickKinoriumLogin(btn);
  });
  document.getElementById("profiles-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "profiles-modal") closeProfilesModal();
  });

  // Gamepad auto-detection
  if (typeof window !== "undefined") {
    window.addEventListener("gamepadconnected", () => {
      if (!state.tvMode) {
        toggleTvMode(true, true);
        showToast(
          t(
            "Геймпад подключён — автоматически включён режим ТВ",
            "Gamepad connected — TV Mode enabled automatically"
          )
        );
      }
      startGamepadPollingLoop();
    });
    const existingPads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    if (existingPads.length > 0) {
      startGamepadPollingLoop();
    }

    window.addEventListener("offline", async () => {
      try {
        const probe = await fetch("/api/system/status", { cache: "no-store" });
        if (probe && probe.ok) return;
      } catch (_) {}
      syncDownloadsHeaderBadge();
      const readyCount = (state.downloadsItems || []).filter((x) => x.status === "completed").length;
      if (readyCount > 0) {
        showToast(
          t(
            `Нет подключения к сети — доступно офлайн-загрузок: ${readyCount}`,
            `Offline — ${readyCount} saved downloads ready to watch`
          ),
          {
            actionLabel: t("Смотреть офлайн", "Watch Offline"),
            onAction: () => openDownloadsModal(),
          }
        );
      }
    });
    window.addEventListener("online", () => {
      syncDownloadsHeaderBadge();
    });
  }

  renderHeaderProfileSwitcher();
  refreshDownloadsState();
}
