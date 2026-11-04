import { state } from "./state.js?v=20261104v27";
import { t } from "./i18n.js?v=20261104v27";
import {
  closeCustomSelectMenu,
  isCustomSelectMenuOpen,
  showToast,
  showVideoOsd,
} from "./utils.js?v=20261104v27";
import { savePlayerPrefs } from "./audio-dsp.js?v=20261104v27";
import {
  closeCommandPalette,
  closeMovieRouletteModal,
} from "./catalog.js?v=20261104v27";
import {
  closePersonModal,
  closeQuickPeekModal,
  closeStatsModal,
} from "./modals.js?v=20261104v27";
import {
  closeAllVcPopovers,
  closePlayerModal,
  getEffectivePlaybackTiming,
  hasOpenVcPopover,
  isStageFullscreen,
  seekEffectivePlayback,
  syncCustomVideoControlsUI,
  syncVcPopoverOpenClass,
  toggleStageFullscreen,
  toggleVideoPlayPause,
  wakeVideoControls,
} from "./player.js?v=20261104v27";
import { closeOnboardingModal } from "./settings.js?v=20261104v27";
import { closeDownloadsModal } from "./features-downloads.js?v=20261104v27";
import { closeTvCastModal } from "./features-cast.js?v=20261104v27";
import {
  closeKidsPinModal,
  closeProfilePopover,
  closeProfilesModal,
} from "./features.js?v=20261104v27";

// ============================================================================
// 5. TV MODE (D-Pad / Gamepad Spatial Navigation + AirPlay / DLNA / QR)
// ============================================================================

export function clearTvFocusClass() {
  document.querySelectorAll(".tv-focused").forEach((el) => el.classList.remove("tv-focused"));
}

export function setTvFocusedElement(el) {
  if (!el) return;
  clearTvFocusClass();
  el.classList.add("tv-focused");
  try {
    el.focus({ preventScroll: true });
  } catch (_) {}
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  } catch (_) {}
}

export function collectTvNavigableElements() {
  let scopeRoot = document.body;
  if (isCustomSelectMenuOpen()) {
    const portal = document.getElementById("atv-cselect-portal");
    if (portal && !portal.classList.contains("hidden")) {
      scopeRoot = portal;
    }
  } else {
    const popoverOrder = [
      "vc-episodes-popover",
      "vc-studio-popover",
      "vc-subs-popover",
      "vc-quality-popover",
      "atv-sub-dict-popover",
      "player-gear-popover",
      "kinorium-status-popover",
      "kinorium-postwatch-overlay",
      "atv-card-context-menu",
      "profile-switcher-popover",
      "notifications-popover",
      "search-live-popover",
    ];
    let foundPopover = null;
    for (const popId of popoverOrder) {
      const p = document.getElementById(popId);
      if (p && !p.classList.contains("hidden")) {
        foundPopover = p;
        break;
      }
    }
    if (foundPopover) {
      scopeRoot = foundPopover;
    } else {
      const modalOrder = [
        "kids-pin-modal",
        "confirm-modal",
        "command-palette-modal",
        "movie-roulette-modal",
        "onboarding-modal",
        "profiles-modal",
        "handoff-modal",
        "tv-cast-modal",
        "downloads-modal",
        "stats-modal",
        "settings-modal",
        "person-modal",
        "quick-peek-modal",
        "player-modal",
      ];
      for (const id of modalOrder) {
        const m = document.getElementById(id);
        if (!m || m.classList.contains("hidden")) continue;
        if (
          id === "player-modal" &&
          (m.classList.contains("mini-player-mode") || m.classList.contains("pip-background-mode"))
        ) {
          continue;
        }
        scopeRoot = m;
        break;
      }
    }
  }

  const selector = [
    "button:not([disabled])",
    "[role='button']:not([aria-disabled='true'])",
    ".atv-poster-item",
    ".atv-upnext-card",
    ".atv-upnext-more-card",
    ".atv-similar-card",
    ".atv-prof-card",
    "input:not([disabled]):not([type='hidden'])",
    "select:not([disabled])",
    "[tabindex='0']",
  ].join(", ");

  return Array.from(scopeRoot.querySelectorAll(selector)).filter((el) => {
    if (el.closest(".hidden") || el.closest("[aria-hidden='true']")) return false;
    // Skip hover-only nested card buttons so D-pad focuses the poster/card container cleanly
    if (
      el.classList.contains("atv-poster-play-center") ||
      el.classList.contains("atv-upnext-remove") ||
      (el.closest(".atv-poster-item") && !el.classList.contains("atv-poster-item")) ||
      (el.closest(".atv-upnext-card") && !el.classList.contains("atv-upnext-card"))
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width >= 16 && rect.height >= 16;
  });
}

export function getPreferredInitialTvFocus(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const qpMod = document.getElementById("quick-peek-modal");
  if (qpMod && !qpMod.classList.contains("hidden")) {
    const qpPlay = document.getElementById("qp-btn-play");
    if (qpPlay && candidates.includes(qpPlay)) return qpPlay;
  }
  if (state.isPlayerOpen && !state.isMiniPlayer && !state.isPipBackground) {
    const activeEp = document.querySelector("#episodes-strip-bar .atv-ep-pill.active");
    if (activeEp && candidates.includes(activeEp)) return activeEp;
    const vcPlay = document.getElementById("vc-btn-play");
    if (vcPlay && candidates.includes(vcPlay)) return vcPlay;
  }
  const firstCard = candidates.find(
    (el) =>
      el.classList.contains("atv-upnext-card") ||
      el.classList.contains("atv-poster-item") ||
      el.classList.contains("atv-similar-card") ||
      el.id === "hero-play-rezka" ||
      el.id === "hero-play-btn"
  );
  return firstCard || candidates[0];
}

export function moveSpatialFocus(direction) {
  const candidates = collectTvNavigableElements();
  if (candidates.length === 0) return false;

  const current =
    document.querySelector(".tv-focused") ||
    (candidates.includes(document.activeElement) ? document.activeElement : null);

  if (!current || !candidates.includes(current)) {
    setTvFocusedElement(getPreferredInitialTvFocus(candidates));
    return true;
  }

  const curRect = current.getBoundingClientRect();
  const cx = curRect.left + curRect.width / 2;
  const cy = curRect.top + curRect.height / 2;

  let bestEl = null;
  let bestScore = Infinity;

  for (const cand of candidates) {
    if (cand === current) continue;
    const r = cand.getBoundingClientRect();
    const tx = r.left + r.width / 2;
    const ty = r.top + r.height / 2;
    const dx = tx - cx;
    const dy = ty - cy;

    let primary = 0;
    let ortho = 0;
    if (direction === "left") {
      if (dx >= -6) continue;
      primary = -dx;
      ortho = Math.abs(dy);
    } else if (direction === "right") {
      if (dx <= 6) continue;
      primary = dx;
      ortho = Math.abs(dy);
    } else if (direction === "up") {
      if (dy >= -6) continue;
      primary = -dy;
      ortho = Math.abs(dx);
    } else if (direction === "down") {
      if (dy <= 6) continue;
      primary = dy;
      ortho = Math.abs(dx);
    } else {
      continue;
    }

    const conePenalty = ortho > primary * 1.65 ? ortho * 3.4 : ortho * 1.75;
    const score = primary + conePenalty;
    if (score < bestScore) {
      bestScore = score;
      bestEl = cand;
    }
  }

  if (bestEl) {
    setTvFocusedElement(bestEl);
    return true;
  }
  return false;
}

export function toggleTvMode(forceBool = null, silent = false) {
  const next = forceBool !== null ? Boolean(forceBool) : !state.tvMode;
  state.tvMode = next;
  document.documentElement.classList.toggle("is-tv-mode", next);
  const btn = document.getElementById("btn-toggle-tv-mode");
  if (btn) {
    btn.classList.toggle("active", next);
    btn.setAttribute("aria-pressed", next ? "true" : "false");
  }
  const tvStateLbl = document.getElementById("prof-menu-tv-state");
  if (tvStateLbl) {
    tvStateLbl.textContent = next ? t("Вкл", "On") : t("Выкл", "Off");
    tvStateLbl.classList.toggle("is-on", next);
  }
  if (next) {
    const candidates = collectTvNavigableElements();
    const current = document.querySelector(".tv-focused");
    const first =
      current && candidates.includes(current)
        ? current
        : getPreferredInitialTvFocus(candidates);
    if (first) setTvFocusedElement(first);
    if (!silent) {
      showToast(
        t(
          "Режим ТВ включён: управление стрелками пульта, Enter и геймпадом",
          "TV Mode enabled: navigate with remote D-pad arrows, Enter, or gamepad"
        )
      );
    }
  } else {
    clearTvFocusClass();
    if (!silent) {
      showToast(t("Режим ТВ выключен", "TV Mode disabled"));
    }
  }
}

export const setTvMode = toggleTvMode;

export function executeRemoteBackAction() {
  if (typeof document === "undefined") return false;
  if (isCustomSelectMenuOpen()) {
    closeCustomSelectMenu({ restoreFocus: true });
    return true;
  }
  if (!document.getElementById("kids-pin-modal")?.classList.contains("hidden")) {
    closeKidsPinModal(null);
    return true;
  }
  if (!document.getElementById("confirm-modal")?.classList.contains("hidden")) {
    document.getElementById("confirm-modal-cancel")?.click();
    return true;
  }
  if (!document.getElementById("command-palette-modal")?.classList.contains("hidden")) {
    closeCommandPalette();
    return true;
  }
  if (!document.getElementById("movie-roulette-modal")?.classList.contains("hidden")) {
    closeMovieRouletteModal();
    return true;
  }
  if (!document.getElementById("onboarding-modal")?.classList.contains("hidden")) {
    if (!state.onboardingIsFirstRun) {
      closeOnboardingModal({ reopenSettings: true });
      return true;
    }
    return false;
  }
  if (!document.getElementById("profiles-modal")?.classList.contains("hidden")) {
    closeProfilesModal();
    return true;
  }
  if (!document.getElementById("tv-cast-modal")?.classList.contains("hidden")) {
    closeTvCastModal();
    return true;
  }
  if (!document.getElementById("downloads-modal")?.classList.contains("hidden")) {
    closeDownloadsModal();
    return true;
  }
  if (!document.getElementById("stats-modal")?.classList.contains("hidden")) {
    closeStatsModal();
    return true;
  }
  if (!document.getElementById("settings-modal")?.classList.contains("hidden")) {
    document.getElementById("close-settings-modal")?.click();
    return true;
  }
  if (!document.getElementById("person-modal")?.classList.contains("hidden")) {
    closePersonModal({ clearStack: false });
    return true;
  }
  if (!document.getElementById("quick-peek-modal")?.classList.contains("hidden")) {
    closeQuickPeekModal({ clearStack: false });
    return true;
  }
  if (hasOpenVcPopover()) {
    closeAllVcPopovers();
    syncVcPopoverOpenClass();
    return true;
  }
  const gearPop = document.getElementById("player-gear-popover");
  if (gearPop && !gearPop.classList.contains("hidden")) {
    gearPop.classList.add("hidden");
    const gearBtn = document.getElementById("btn-player-gear");
    gearBtn?.classList.remove("active");
    gearBtn?.setAttribute("aria-expanded", "false");
    syncVcPopoverOpenClass();
    return true;
  }
  const statusPop = document.getElementById("kinorium-status-popover");
  if (statusPop && !statusPop.classList.contains("hidden")) {
    statusPop.classList.add("hidden");
    document.getElementById("btn-kinorium-status-menu")?.setAttribute("aria-expanded", "false");
    return true;
  }
  const postWatch = document.getElementById("kinorium-postwatch-overlay");
  if (postWatch && !postWatch.classList.contains("hidden")) {
    document.getElementById("close-postwatch-btn")?.click();
    return true;
  }
  if (state.isPlayerOpen && isStageFullscreen()) {
    toggleStageFullscreen();
    return true;
  }
  if (state.isPlayerOpen && !state.isMiniPlayer && !state.isPipBackground) {
    closePlayerModal();
    return true;
  }
  if (!document.getElementById("profile-switcher-popover")?.classList.contains("hidden")) {
    closeProfilePopover();
    return true;
  }
  if (!document.getElementById("notifications-popover")?.classList.contains("hidden")) {
    document.getElementById("notifications-popover")?.classList.add("hidden");
    return true;
  }
  if (!document.getElementById("search-live-popover")?.classList.contains("hidden")) {
    document.getElementById("search-live-popover")?.classList.add("hidden");
    return true;
  }
  return false;
}

export function _syncTvFocusAfterSurfaceChange() {
  if (!state.tvMode) return;
  const candidates = collectTvNavigableElements();
  if (candidates.length === 0) return;
  const current = document.querySelector(".tv-focused");
  if (!current || !candidates.includes(current)) {
    const preferred = getPreferredInitialTvFocus(candidates);
    if (preferred) setTvFocusedElement(preferred);
  }
}

export function executeRemoteDpadCommand(rawDir) {
  if (typeof document === "undefined") return false;
  const dir = String(rawDir || "").trim().toLowerCase();
  if (!dir) return false;

  if (dir === "back" || dir === "escape") {
    const handled = executeRemoteBackAction();
    if (state.tvMode) {
      setTimeout(_syncTvFocusAfterSurfaceChange, 70);
    }
    return handled;
  }

  // If the QR pairing dialog (#tv-cast-modal) is open on the Phone tab, close it automatically
  // when the user starts navigating with the remote D-Pad
  const tvCastMod = document.getElementById("tv-cast-modal");
  if (tvCastMod && !tvCastMod.classList.contains("hidden") && state.remoteCastTab !== "tv") {
    closeTvCastModal();
  }

  // Release focus from any text input so D-Pad navigation is never blocked
  const activeTag = (document.activeElement?.tagName || "").toUpperCase();
  if (
    (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") &&
    document.getElementById("kids-pin-modal")?.classList.contains("hidden")
  ) {
    try {
      document.activeElement.blur();
    } catch (_) {}
  }

  const hasOpenOverlayAbovePlayer =
    isCustomSelectMenuOpen() ||
    hasOpenVcPopover() ||
    [
      "kids-pin-modal",
      "confirm-modal",
      "onboarding-modal",
      "profiles-modal",
      "tv-cast-modal",
      "downloads-modal",
      "stats-modal",
      "settings-modal",
      "person-modal",
      "quick-peek-modal",
      "player-gear-popover",
      "kinorium-status-popover",
      "kinorium-postwatch-overlay",
    ].some((id) => {
      const el = document.getElementById(id);
      return Boolean(el && !el.classList.contains("hidden"));
    });

  // Direct player control when video is open (and either TV mode is off or stage is in fullscreen)
  if (
    state.isPlayerOpen &&
    !state.isMiniPlayer &&
    !state.isPipBackground &&
    !hasOpenOverlayAbovePlayer &&
    (!state.tvMode || isStageFullscreen())
  ) {
    const video = document.getElementById("native-video");
    wakeVideoControls();
    if (dir === "left") {
      if (!video) return false;
      const { cur } = getEffectivePlaybackTiming(video);
      const nextSec = Math.max(0, cur - 10);
      seekEffectivePlayback(nextSec);
      showVideoOsd("back10", `−10 ${t("с", "s")}`);
      return true;
    }
    if (dir === "right") {
      if (!video) return false;
      const { cur, dur } = getEffectivePlaybackTiming(video);
      const nextSec = dur > 0 ? Math.min(dur - 0.5, cur + 10) : cur + 10;
      seekEffectivePlayback(nextSec);
      showVideoOsd("fwd10", `+10 ${t("с", "s")}`);
      return true;
    }
    if (dir === "up") {
      if (!video) return false;
      const v = Math.min(1, Math.round(((Number(video.volume) || 0) + 0.1) * 100) / 100);
      state.internalMuteOverride = true;
      video.volume = v;
      video.muted = false;
      state.userMutedThisSession = false;
      state.internalMuteOverride = false;
      savePlayerPrefs({ volume: v, muted: false });
      syncCustomVideoControlsUI(true);
      const pct = Math.round(v * 100);
      showVideoOsd("volHigh", `${pct}%`, pct);
      return true;
    }
    if (dir === "down") {
      if (!video) return false;
      const v = Math.max(0, Math.round(((Number(video.volume) || 0) - 0.1) * 100) / 100);
      state.internalMuteOverride = true;
      video.volume = v;
      video.muted = v <= 0.005;
      state.userMutedThisSession = video.muted;
      state.internalMuteOverride = false;
      if (v > 0.02) {
        savePlayerPrefs({ volume: v, muted: false });
      }
      syncCustomVideoControlsUI(true);
      const pct = Math.round(v * 100);
      showVideoOsd(pct === 0 ? "volMute" : "volLow", `${pct}%`, pct);
      return true;
    }
    if (dir === "ok" || dir === "enter" || dir === "space") {
      const skipBtn = document.getElementById("skip-intro-btn");
      if (skipBtn && !skipBtn.classList.contains("hidden")) {
        skipBtn.click();
        return true;
      }
      const autoCard = document.getElementById("autoplay-next-card");
      const autoBtn = document.getElementById("btn-autoplay-now");
      if (autoCard && !autoCard.classList.contains("hidden") && autoBtn) {
        autoBtn.click();
        return true;
      }
      toggleVideoPlayPause(true);
      return true;
    }
  }

  // Spatial TV Mode navigation across catalog cards, modals, and popovers
  if (!state.tvMode) {
    toggleTvMode(true, true);
  }
  if (state.isPlayerOpen) {
    wakeVideoControls();
  }

  if (dir === "up" || dir === "down" || dir === "left" || dir === "right") {
    return moveSpatialFocus(dir);
  }

  if (dir === "ok" || dir === "enter" || dir === "space") {
    const candidates = collectTvNavigableElements();
    let target = document.querySelector(".tv-focused");
    if (!target || !candidates.includes(target)) {
      target = getPreferredInitialTvFocus(candidates);
    }
    if (target && typeof target.click === "function") {
      setTvFocusedElement(target);
      target.click();
      setTimeout(_syncTvFocusAfterSurfaceChange, 90);
      return true;
    }
    if (state.isPlayerOpen) {
      toggleVideoPlayPause(true);
      return true;
    }
  }
  return false;
}

export function handleTvSpatialKeydown(e) {
  if (!state.tvMode) return false;
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) {
    return false;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return false;

  // When fullscreen video is actively playing with controls hidden, let Left/Right seek smoothly
  const isFsStage = Boolean(isStageFullscreen() || document.fullscreenElement || document.webkitFullscreenElement);
  const stageIdle = document.getElementById("video-stage")?.classList.contains("vc-idle");
  if (state.isPlayerOpen && isFsStage && stageIdle && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    return false;
  }

  const dirMap = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
  };
  if (dirMap[e.key]) {
    e.preventDefault();
    moveSpatialFocus(dirMap[e.key]);
    return true;
  }
  if (e.key === "Enter") {
    const focused = document.querySelector(".tv-focused") || document.activeElement;
    if (focused && focused !== document.body) {
      e.preventDefault();
      focused.click();
      return true;
    }
  }
  return false;
}

let _gamepadLoopStarted = false;
let _lastGamepadActionTs = 0;
let _prevGpButtons = [];

export function startGamepadPollingLoop() {
  if (_gamepadLoopStarted || typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
    return;
  }
  _gamepadLoopStarted = true;

  const tick = () => {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    if (pads.length === 0) {
      _gamepadLoopStarted = false;
      return;
    }
    const gp = pads[0];
    const now = Date.now();
    const btns = (gp.buttons || []).map((b) => Boolean(b && (b.pressed || b.value > 0.55)));
    const wasPressed = (idx) => Boolean(btns[idx] && !_prevGpButtons[idx]);

    const axX = Number(gp.axes?.[0]) || 0;
    const axY = Number(gp.axes?.[1]) || 0;
    let dpadDir = "";
    if (btns[14] || axX < -0.58) dpadDir = "left";
    else if (btns[15] || axX > 0.58) dpadDir = "right";
    else if (btns[12] || axY < -0.58) dpadDir = "up";
    else if (btns[13] || axY > 0.58) dpadDir = "down";

    if (dpadDir && now - _lastGamepadActionTs > 185) {
      _lastGamepadActionTs = now;
      if (!state.tvMode) toggleTvMode(true, true);
      moveSpatialFocus(dpadDir);
    }

    // A (0): Select / Click
    if (wasPressed(0)) {
      const target = document.querySelector(".tv-focused") || document.activeElement;
      if (target && target !== document.body) {
        target.click();
      } else if (state.isPlayerOpen) {
        toggleVideoPlayPause(true);
      }
    }
    // B (1): Back / Close top overlay, popover, fullscreen, or player
    if (wasPressed(1)) {
      if (isCustomSelectMenuOpen()) {
        closeCustomSelectMenu({ restoreFocus: true });
      } else if (!document.getElementById("kids-pin-modal")?.classList.contains("hidden")) {
        closeKidsPinModal(null);
      } else if (!document.getElementById("confirm-modal")?.classList.contains("hidden")) {
        document.getElementById("confirm-modal-cancel")?.click();
      } else if (!document.getElementById("command-palette-modal")?.classList.contains("hidden")) {
        closeCommandPalette();
      } else if (!document.getElementById("movie-roulette-modal")?.classList.contains("hidden")) {
        closeMovieRouletteModal();
      } else if (!document.getElementById("onboarding-modal")?.classList.contains("hidden")) {
        if (!state.onboardingIsFirstRun) {
          closeOnboardingModal({ reopenSettings: true });
        }
      } else if (!document.getElementById("profiles-modal")?.classList.contains("hidden")) {
        closeProfilesModal();
      } else if (!document.getElementById("handoff-modal")?.classList.contains("hidden")) {
        document.getElementById("close-handoff-modal")?.click();
      } else if (!document.getElementById("tv-cast-modal")?.classList.contains("hidden")) {
        closeTvCastModal();
      } else if (!document.getElementById("downloads-modal")?.classList.contains("hidden")) {
        closeDownloadsModal();
      } else if (!document.getElementById("vocab-modal")?.classList.contains("hidden")) {
        document.getElementById("close-vocab-modal")?.click();
      } else if (!document.getElementById("stats-modal")?.classList.contains("hidden")) {
        document.getElementById("close-stats-modal")?.click();
      } else if (!document.getElementById("settings-modal")?.classList.contains("hidden")) {
        document.getElementById("close-settings-modal")?.click();
      } else if (!document.getElementById("person-modal")?.classList.contains("hidden")) {
        document.getElementById("close-person-modal")?.click();
      } else if (!document.getElementById("quick-peek-modal")?.classList.contains("hidden")) {
        document.getElementById("close-quick-peek-modal")?.click();
      } else if (hasOpenVcPopover()) {
        closeAllVcPopovers();
        syncVcPopoverOpenClass();
      } else if (!document.getElementById("player-gear-popover")?.classList.contains("hidden")) {
        document.getElementById("player-gear-popover")?.classList.add("hidden");
        const gearBtn = document.getElementById("btn-player-gear");
        gearBtn?.classList.remove("active");
        gearBtn?.setAttribute("aria-expanded", "false");
        syncVcPopoverOpenClass();
      } else if (!document.getElementById("kinorium-status-popover")?.classList.contains("hidden")) {
        document.getElementById("kinorium-status-popover")?.classList.add("hidden");
        document.getElementById("btn-kinorium-status-menu")?.setAttribute("aria-expanded", "false");
      } else if (!document.getElementById("kinorium-postwatch-overlay")?.classList.contains("hidden")) {
        document.getElementById("close-postwatch-btn")?.click();
      } else if (state.isPlayerOpen && isStageFullscreen()) {
        toggleStageFullscreen();
      } else if (state.isPlayerOpen && !state.isMiniPlayer && !state.isPipBackground) {
        closePlayerModal();
      } else if (!document.getElementById("profile-switcher-popover")?.classList.contains("hidden")) {
        closeProfilePopover();
      } else if (!document.getElementById("notifications-popover")?.classList.contains("hidden")) {
        document.getElementById("notifications-popover")?.classList.add("hidden");
      } else if (!document.getElementById("search-live-popover")?.classList.contains("hidden")) {
        document.getElementById("search-live-popover")?.classList.add("hidden");
      }
    }
    // X (2): Play / Pause in Player
    if (wasPressed(2) && state.isPlayerOpen) {
      toggleVideoPlayPause(true);
    }
    // Y (3): Toggle Picture-in-Picture or Fullscreen
    if (wasPressed(3) && state.isPlayerOpen) {
      document.getElementById("vc-btn-fs")?.click();
    }
    // LB (4) / RB (5): Seek -15s / +15s or Prev/Next episode
    if (wasPressed(4) && state.isPlayerOpen) {
      const { cur } = getEffectivePlaybackTiming(document.getElementById("native-video"));
      seekEffectivePlayback(Math.max(0, cur - 15));
    }
    if (wasPressed(5) && state.isPlayerOpen) {
      const { cur, dur } = getEffectivePlaybackTiming(document.getElementById("native-video"));
      seekEffectivePlayback(dur > 0 ? Math.min(dur, cur + 15) : cur + 15);
    }

    _prevGpButtons = btns;
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}
