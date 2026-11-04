import { state } from "./state.js?v=20261104v20";
import { t, displayTitle } from "./i18n.js?v=20261104v20";
import { supportsNativePiP, syncScrollTopButton, iconSvg } from "./utils.js?v=20261104v20";
import { isVideoInPiP, startAmbilightLoop } from "./audio-dsp.js?v=20261104v20";
import { closeAllVcPopovers } from "./player-ui-controls.js?v=20261104v20";
import { loadCatalog } from "./catalog.js?v=20261104v20";
import { getNextEpisodeCoords } from "./player-autoplay.js?v=20261104v20";

export function syncPipDockUI() {
  const video = document.getElementById("native-video");
  const pipActive = isVideoInPiP(video);
  const stageNotice = document.getElementById("video-pip-placeholder");
  if (stageNotice) {
    stageNotice.classList.toggle(
      "hidden",
      !(pipActive && state.isPlayerOpen && !state.isPipBackground && !state.isMiniPlayer)
    );
  }
  const pipBtn = document.getElementById("vc-btn-pip");
  if (pipBtn) {
    pipBtn.classList.toggle("hidden", !supportsNativePiP());
    pipBtn.classList.toggle("active-pip", pipActive);
  }
  document.getElementById("btn-toggle-mini-player")?.classList.toggle("active", Boolean(state.isMiniPlayer));

  const dock = document.getElementById("pip-status-dock");
  if (dock) {
    dock.classList.toggle("hidden", !(state.isPlayerOpen && state.isPipBackground));
  }
  const dockTitle = document.getElementById("pip-dock-title");
  const dockNextBtn = document.getElementById("btn-pip-dock-next-ep");
  const dockPlayBtn = document.getElementById("btn-pip-dock-play");
  if (state.activeItem && dockTitle) {
    const isSeries = state.activeItem.media_type === "series";
    const hasNextEp = isSeries && Boolean(getNextEpisodeCoords());
    const epSuffix = isSeries
      ? t(
          ` · Сезон ${state.activeSeason}, Серия ${state.activeEpisode}`,
          ` · S${state.activeSeason} E${state.activeEpisode}`
        )
      : "";
    dockTitle.textContent = `${displayTitle(state.activeItem)}${epSuffix}`;
    if (dockNextBtn) {
      dockNextBtn.classList.toggle("hidden", !hasNextEp);
    }
  }
  if (dockPlayBtn && video) {
    dockPlayBtn.innerHTML = iconSvg(video.paused ? "play" : "pause", 12);
  }
}

export function setPipBackgroundMode(active) {
  const next = Boolean(active);
  const wasBackground = state.isPipBackground;
  state.isPipBackground = next;
  const modal = document.getElementById("player-modal");
  if (next) {
    if (state.isPseudoFullscreen || document.documentElement?.classList.contains("is-stage-pseudo-fullscreen")) {
      state.isPseudoFullscreen = false;
      document.documentElement.classList.remove("is-stage-fullscreen", "is-stage-pseudo-fullscreen");
      document.getElementById("video-stage")?.classList.remove("is-pseudo-fullscreen");
    }
    if (state.isMiniPlayer) {
      setMiniPlayerMode(false);
    }
    closeAllVcPopovers();
    document.getElementById("player-gear-popover")?.classList.add("hidden");
    document.getElementById("btn-player-gear")?.classList.remove("active");
    document.getElementById("kinorium-status-popover")?.classList.add("hidden");
    document.getElementById("kinorium-postwatch-overlay")?.classList.add("hidden");
    if (modal) {
      modal.classList.remove("hidden");
      modal.classList.add("pip-background-mode");
    }
    if (!wasBackground) {
      loadCatalog();
    }
  } else {
    if (modal) {
      modal.classList.remove("pip-background-mode");
      if (state.isPlayerOpen) {
        modal.classList.remove("hidden");
      }
    }
    if (state.isPlayerOpen && !state.hasPlayerHistoryEntry) {
      try {
        window.history.pushState({ cineflowPlayerModal: true }, "");
        state.hasPlayerHistoryEntry = true;
      } catch (_) {}
    }
    if (state.isPlayerOpen && state.ambilightEnabled) {
      startAmbilightLoop();
    }
  }
  syncPipDockUI();
  syncScrollTopButton();
}

export async function restoreFullPlayerFromPip() {
  const video = document.getElementById("native-video");
  const shouldKeepPlaying = Boolean(video && (!video.paused || state.pipWasPlayingRecently));
  state.isRestoringFromPip = true;
  setPipBackgroundMode(false);
  setMiniPlayerMode(false);
  if (video && isVideoInPiP(video)) {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (
        typeof video.webkitSetPresentationMode === "function" &&
        video.webkitPresentationMode === "picture-in-picture"
      ) {
        video.webkitSetPresentationMode("inline");
      } else if (typeof video.matches === "function" && video.matches(":picture-in-picture")) {
        video.tabIndex = -1;
        try {
          video.focus({ preventScroll: true });
        } catch (_) {}
        await fetch("/api/remote/native-pip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ engine: "gecko" }),
        }).catch(() => {});
      }
    } catch (_) {}
  }
  syncPipDockUI();
  if (video && shouldKeepPlaying && video.paused) {
    video.play().catch(() => {});
  }
  setTimeout(() => {
    state.isRestoringFromPip = false;
    if (video && shouldKeepPlaying && video.paused && state.isPlayerOpen) {
      video.play().catch(() => {});
    }
    syncPipDockUI();
  }, 220);
}

export function updateMiniPlayerTitle() {
  const titleEl = document.getElementById("mini-player-title");
  const nextEpBtn = document.getElementById("btn-mini-next-ep");
  syncPipDockUI();
  if (!titleEl || !state.activeItem) return;
  const isSeries = state.activeItem.media_type === "series";
  const hasNextEp = isSeries && Boolean(getNextEpisodeCoords());
  const epSuffix = isSeries
    ? t(
        ` · Сезон ${state.activeSeason}, Серия ${state.activeEpisode}`,
        ` · S${state.activeSeason} E${state.activeEpisode}`
      )
    : "";
  titleEl.textContent = `${displayTitle(state.activeItem)}${epSuffix}`;
  if (nextEpBtn) {
    nextEpBtn.classList.toggle("hidden", !hasNextEp);
  }
}

export function setMiniPlayerMode(isMini) {
  const nextMini = Boolean(isMini);
  const video = document.getElementById("native-video");
  if (nextMini) {
    if (state.isPseudoFullscreen || document.documentElement?.classList.contains("is-stage-pseudo-fullscreen")) {
      state.isPseudoFullscreen = false;
      document.documentElement.classList.remove("is-stage-fullscreen", "is-stage-pseudo-fullscreen");
      document.getElementById("video-stage")?.classList.remove("is-pseudo-fullscreen");
    }
    if (state.isPipBackground) {
      state.isPipBackground = false;
      document.getElementById("player-modal")?.classList.remove("pip-background-mode");
    }
    if (video && isVideoInPiP(video)) {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
      } else if (
        typeof video.webkitSetPresentationMode === "function" &&
        video.webkitPresentationMode === "picture-in-picture"
      ) {
        try {
          video.webkitSetPresentationMode("inline");
        } catch (_) {}
      }
    }
  }
  state.isMiniPlayer = nextMini;
  const modal = document.getElementById("player-modal");
  const sheet = modal?.querySelector(".atv-cinema-sheet");
  const miniBar = document.getElementById("mini-player-bar");
  if (modal) {
    modal.classList.toggle("mini-player-mode", state.isMiniPlayer);
  }
  if (miniBar) {
    miniBar.classList.toggle("hidden", !state.isMiniPlayer);
  }
  syncScrollTopButton();
  if (state.isMiniPlayer) {
    closeAllVcPopovers();
    document.getElementById("player-gear-popover")?.classList.add("hidden");
    document.getElementById("btn-player-gear")?.classList.remove("active");
    document.getElementById("kinorium-status-popover")?.classList.add("hidden");
    document.getElementById("kinorium-postwatch-overlay")?.classList.add("hidden");
    updateMiniPlayerTitle();
    const playPauseBtn = document.getElementById("btn-mini-play-pause");
    if (playPauseBtn) {
      const isPaused =
        state.activeSourceTab === "trailer"
          ? state.trailerPlaying === false
          : Boolean(!video || video.paused);
      playPauseBtn.innerHTML = iconSvg(isPaused ? "play" : "pause", 12);
    }
  } else if (sheet) {
    sheet.style.position = "";
    sheet.style.left = "";
    sheet.style.top = "";
    sheet.style.right = "";
    sheet.style.bottom = "";
  }
  syncPipDockUI();
}
