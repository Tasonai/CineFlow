/**
 * Velarium — Global Keyboard Shortcuts & Media Hotkeys Controller (`public/js/app-hotkeys.js`)
 * Manages window focus/visibility tracking, modal Escape stack, Command Palette hotkey,
 * Mini-Player/PiP keyboard shortcuts, and full Player playback/audio/subtitle/crop/Ambilight hotkeys.
 */

import { state } from "./state.js?v=20261111v2";
import { t } from "./i18n.js?v=20261111v2";
import {
  closeConfirmModal,
  closeCustomSelectMenu,
  formatTime,
  isCustomSelectMenuOpen,
  showToast,
  showVideoOsd,
  trapModalTabKey,
  triggerVideoCenterIndicator,
} from "./utils.js?v=20261111v2";
import {
  applyAudioBoostToVideo,
  applyVideoCropToVideo,
  getAudioPresetLabel,
  getVideoCropLabel,
  savePlayerPrefs,
  startAmbilightLoop,
  stopAmbilightLoop,
  togglePictureInPicture,
  updatePlayerGearActiveDot,
} from "./audio-dsp.js?v=20261111v2";
import {
  closeCardContextMenu,
  closeCommandPalette,
  closeMovieRouletteModal,
  openCommandPalette,
} from "./catalog.js?v=20261111v2";
import {
  closePersonModal,
  closeQuickPeekModal,
  closeStatsModal,
} from "./modals.js?v=20261111v2";
import { jumpToAdjacentTimelineMarker } from "./player-ui-controls.js?v=20261111v2";
import {
  captureVideoScreenshot,
  clearAutoplayNextTimer,
  closeAllVcPopovers,
  closePlayerModal,
  dismissPlayerNextEpisodeToast,
  getEffectivePlaybackTiming,
  hasOpenVcPopover,
  hideXRayPauseShelf,
  isStageFullscreen,
  recoverFrozenVideoPlayback,
  restoreFullPlayerFromPip,
  seekEffectivePlayback,
  setMiniPlayerMode,
  stepEpisode,
  switchSourceTab,
  syncCustomVideoControlsUI,
  syncVcPopoverOpenClass,
  toggleBookmarkCurrentMoment,
  togglePlayerSidebarCollapsed,
  toggleQuickOriginalAudio,
  toggleStageFullscreen,
  toggleVideoPlayPause,
  toggleXRayPauseShelf,
  wakeVideoControls,
} from "./player.js?v=20261111v2";
import { closeSubtitleDictPopover, closeVocabularyModal } from "./subtitles.js?v=20261111v2";
import {
  closeBookmarkNoteDialog,
  closeBookmarksModal,
  scrollActiveXRayList,
  switchXRayTab,
} from "./player-bookmarks.js?v=20261111v2";
import { closeOnboardingModal } from "./settings.js?v=20261111v2";
import {
  closeDownloadsModal,
  closeKidsPinModal,
  closePlayerHandoffModal,
  closeProfilePopover,
  closeProfilesModal,
  closeTvCastModal,
  handleTvSpatialKeydown,
} from "./features.js?v=20261111v2";

export function initGlobalHotkeys({ onRequestCloseSettings } = {}) {
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

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.isTrusted && !document.hidden && document.visibilityState === "visible") {
        state.isAppWindowActive = true;
      }
      if (!e.isTrusted || document.hidden || document.visibilityState !== "visible") {
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
        showToast(t("Автопереход к следующей серии отменён", "Auto-play next episode cancelled"));
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
      const handoffMod = document.getElementById("handoff-modal");
      if (handoffMod && !handoffMod.classList.contains("hidden")) {
        e.preventDefault();
        closePlayerHandoffModal();
        return;
      }
      const vocabMod = document.getElementById("vocab-modal");
      if (vocabMod && !vocabMod.classList.contains("hidden")) {
        e.preventDefault();
        closeVocabularyModal();
        return;
      }
      const bmNoteDialog = document.getElementById("atv-bookmark-dialog");
      if (bmNoteDialog && !bmNoteDialog.classList.contains("hidden")) {
        e.preventDefault();
        closeBookmarkNoteDialog(true);
        return;
      }
      const bookmarksMod = document.getElementById("bookmarks-modal");
      if (bookmarksMod && !bookmarksMod.classList.contains("hidden")) {
        e.preventDefault();
        closeBookmarksModal();
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
        if (typeof onRequestCloseSettings === "function") {
          onRequestCloseSettings();
        }
        return;
      }
      const rouletteMod = document.getElementById("movie-roulette-modal");
      if (rouletteMod && !rouletteMod.classList.contains("hidden")) {
        e.preventDefault();
        closeMovieRouletteModal();
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
      if (xrayShelf && !xrayShelf.classList.contains("hidden") && !xrayShelf.classList.contains("is-compact")) {
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
        document.getElementById("video-stage")?.classList.remove("has-postwatch-open");
        return;
      }
      if (isStageFullscreen()) {
        e.preventDefault();
        toggleStageFullscreen();
        return;
      }
      if (state.isPlayerOpen && state.officialEmbedActive) {
        e.preventDefault();
        switchSourceTab(state.activeOfficialService || state.activeSourceTab, null, { embedMode: false });
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

    if (isTypingTarget || e.ctrlKey || e.metaKey || e.altKey || !state.isPlayerOpen) {
      return;
    }

    if (!window._hotkeyModalDomCache) {
      window._hotkeyModalDomCache = {};
    }
    const _getHotkeyModalEl = (id) => {
      let el = window._hotkeyModalDomCache[id];
      if (!el || !el.isConnected) {
        el = document.getElementById(id);
        if (el) window._hotkeyModalDomCache[id] = el;
      }
      return el;
    };
    const hasTopCatalogModalOpen = [
      "kids-pin-modal",
      "confirm-modal",
      "command-palette-modal",
      "onboarding-modal",
      "profiles-modal",
      "tv-cast-modal",
      "handoff-modal",
      "vocab-modal",
      "bookmarks-modal",
      "downloads-modal",
      "person-modal",
      "quick-peek-modal",
      "stats-modal",
      "settings-modal",
      "movie-roulette-modal",
    ].some((id) => {
      const el = _getHotkeyModalEl(id);
      return el && !el.classList.contains("hidden");
    });
    if (hasTopCatalogModalOpen) {
      return;
    }

    // Hotkeys when floating Mini-Player or System PiP background mode is active
    if (state.isMiniPlayer || state.isPipBackground) {
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
      return;
    }

    // Stage layout hotkeys (Fullscreen F / Wide Sidebar T) work on all Player tabs
    const stageKey = (e.key || "").toLowerCase();
    if (stageKey === "t" || stageKey === "е" || e.code === "KeyT") {
      e.preventDefault();
      togglePlayerSidebarCollapsed(true);
      return;
    }
    if ((stageKey === "f" || stageKey === "а" || e.code === "KeyF") && !state.officialEmbedActive) {
      e.preventDefault();
      toggleStageFullscreen();
      return;
    }

    // Player keyboard shortcuts ONLY when full Player Modal is active on a video tab and no top overlay is open
    if (
      state.activeSourceTab !== "hdrezka" &&
      state.activeSourceTab !== "stremio" &&
      state.activeSourceTab !== "backup4k" &&
      state.activeSourceTab !== "offline"
    ) {
      return;
    }
    if (
      ["kinorium-postwatch-overlay", "atv-bookmark-dialog"].some((id) => {
        const el = _getHotkeyModalEl(id);
        return el && !el.classList.contains("hidden");
      })
    ) {
      return;
    }

    const video = _getHotkeyModalEl("native-video");
    if (!video) return;
    wakeVideoControls();
    const keyLow = (e.key || "").toLowerCase();
    const inScrollablePlayerPanel = Boolean(
      e.target?.closest?.(
        ".atv-info-sidebar, .atv-releases-list, .atv-episodes-strip, .atv-vc-popover, .atv-gear-popover"
      )
    );
    const xrayShelfEl = _getHotkeyModalEl("xray-pause-shelf");
    const isXRayExpanded = Boolean(
      xrayShelfEl &&
        !xrayShelfEl.classList.contains("hidden") &&
        !xrayShelfEl.classList.contains("is-compact")
    );
    if (isXRayExpanded && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      if (e.key === "ArrowLeft" && tag !== "SELECT") {
        e.preventDefault();
        scrollActiveXRayList(-1);
        return;
      }
      if (e.key === "ArrowRight" && tag !== "SELECT") {
        e.preventDefault();
        scrollActiveXRayList(1);
        return;
      }
      if (e.key === "1") {
        e.preventDefault();
        switchXRayTab("cast");
        return;
      }
      if (e.key === "2") {
        e.preventDefault();
        switchXRayTab("soundtrack");
        return;
      }
      if (e.key === "3") {
        e.preventDefault();
        switchXRayTab("trivia");
        return;
      }
    }

    const isOverlayActionBtn = Boolean(
      e.target?.closest?.(
        ".atv-vc-popover, .atv-gear-popover, #xray-pause-shelf, #atv-sub-dict-popover, #autoplay-next-card, #player-next-ep-toast, #skip-intro-btn, #skip-credits-btn, #skip-outro-btn, #video-error"
      )
    );
    const isStageTransportControl =
      !isOverlayActionBtn &&
      (isStageFullscreen() || Boolean(e.target?.closest?.("#atv-custom-controls, #video-stage")));

    if (
      ((e.code === "Space" || e.key === " ") && (!isInteractiveBtnTarget || isStageTransportControl)) ||
      keyLow === "k" ||
      keyLow === "л"
    ) {
      e.preventDefault();
      if (e.code === "Space" || e.key === " ") {
        e.stopPropagation();
      }
      if (isStageTransportControl && typeof e.target?.blur === "function") {
        try {
          e.target.blur();
        } catch (_) {}
      }
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
      const nowBurst = Date.now();
      if (nowBurst - (state.seekBurstLastTs || 0) < 950 && (state.seekBurstAccumSec || 0) < 0) {
        state.seekBurstAccumSec -= 10;
      } else {
        state.seekBurstAccumSec = -10;
      }
      state.seekBurstLastTs = nowBurst;
      const absBurst = Math.abs(state.seekBurstAccumSec);
      seekEffectivePlayback(target);
      triggerVideoCenterIndicator("back10", `−${absBurst} ${t("секунд", "sec")} · ${formatTime(target)}`);
    } else if ((e.key === "ArrowRight" && tag !== "SELECT") || keyLow === "l" || keyLow === "д") {
      e.preventDefault();
      const { cur, dur } = getEffectivePlaybackTiming(video);
      const maxDur = dur > 0 ? dur : cur + 10;
      const target = Math.min(maxDur, cur + 10);
      const nowBurst = Date.now();
      if (nowBurst - (state.seekBurstLastTs || 0) < 950 && (state.seekBurstAccumSec || 0) > 0) {
        state.seekBurstAccumSec += 10;
      } else {
        state.seekBurstAccumSec = 10;
      }
      state.seekBurstLastTs = nowBurst;
      seekEffectivePlayback(target);
      triggerVideoCenterIndicator("fwd10", `+${state.seekBurstAccumSec} ${t("секунд", "sec")} · ${formatTime(target)}`);
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
    } else if (keyLow === "x" || keyLow === "ч" || e.code === "KeyX") {
      e.preventDefault();
      toggleXRayPauseShelf();
    } else if (e.code === "BracketRight") {
      if (jumpToAdjacentTimelineMarker(1)) {
        e.preventDefault();
      }
    } else if (e.code === "BracketLeft") {
      if (jumpToAdjacentTimelineMarker(-1)) {
        e.preventDefault();
      }
    }
    },
    true
  );

  window.addEventListener(
    "keyup",
    (e) => {
      if (!state.isPlayerOpen || (e.code !== "Space" && e.key !== " ")) return;
      const tag = e.target?.tagName || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) {
        return;
      }
      const isOverlayActionBtn = Boolean(
        e.target?.closest?.(
          ".atv-vc-popover, .atv-gear-popover, #xray-pause-shelf, #atv-sub-dict-popover, #autoplay-next-card, #player-next-ep-toast, #skip-intro-btn, #skip-credits-btn, #skip-outro-btn, #video-error"
        )
      );
      if (
        !isOverlayActionBtn &&
        (isStageFullscreen() || Boolean(e.target?.closest?.("#atv-custom-controls, #video-stage")))
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );
}
