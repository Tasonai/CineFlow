import { state } from "./state.js?v=20261104v25";
import { displayPoster, displayTitle, t, translateStudioName } from "./i18n.js?v=20261104v25";
import {
  escapeAttr,
  escapeHtml,
  formatTime,
  iconSvg,
  initCustomSelects,
  saveUiPrefs,
  showToast,
  showVideoOsd,
  syncCustomSelect,
} from "./utils.js?v=20261104v25";
import { isVideoInPiP, savePlayerPrefs, togglePictureInPicture } from "./audio-dsp.js?v=20261104v25";
import {
  adjustSubtitleOffset,
  formatSubtitleOffsetLabel,
  resetSubtitleOffset,
} from "./subtitles.js?v=20261104v25";
import {
  closePlayerModal,
  getEffectivePlaybackTiming,
  getEpisodeDisplayMeta,
  getEpisodeRatingEntry,
  getNextEpisodeCoords,
  isStageFullscreen,
  openPlayerModal,
  rateActivePlayerTitle,
  seekEffectivePlayback,
  stepEpisode,
  switchToSeriesSeasonEpisode,
  syncCustomVideoControlsUI,
  toggleActivePlayerWatched,
  toggleStageFullscreen,
  toggleVideoPlayPause,
} from "./player.js?v=20261104v25";
import { attachSmartPosterFallback, isEpisodeWatched } from "./catalog.js?v=20261104v25";
import {
  closeTvCastModal,
  executeRemoteDpadCommand,
  isItemSafeForKidsClient,
  requestKidsPinVerification,
  setTvMode,
} from "./features.js?v=20261104v25";

export function isMobileRemoteUrl() {
  if (typeof window === "undefined") return false;
  try {
    const qs = new URLSearchParams(window.location.search || "");
    return qs.get("remote") === "1";
  } catch (_) {
    return false;
  }
}

function _isLoopbackHost() {
  if (typeof window === "undefined") return false;
  const h = String(window.location.hostname || "").toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

function _detectPhoneDeviceLabel() {
  if (typeof navigator === "undefined") return "Phone";
  const ua = String(navigator.userAgent || "");
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  return t("Смартфон", "Smartphone");
}

function _getOrCreateRemoteClientId() {
  if (typeof localStorage === "undefined") return "rm_guest";
  try {
    let cid = localStorage.getItem("cineflow_remote_cid");
    if (!cid) {
      cid = `rm_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("cineflow_remote_cid", cid);
    }
    return cid;
  } catch (_) {
    return "rm_guest";
  }
}

/* ==========================================================================
   1. Desktop Agent (Runs inside CineFlow on Mac / Windows)
   ========================================================================== */
let _desktopAgentStarted = false;
let _desktopPushTimer = null;
let _lastDesktopPushTs = 0;

function _collectDesktopStateSnapshot() {
  const video = typeof document !== "undefined" ? document.getElementById("native-video") : null;
  const { cur, dur } = getEffectivePlaybackTiming(video);
  const item = state.activeItem;

  let desktopMode = "window";
  if (isStageFullscreen()) desktopMode = "fullscreen";
  else if (state.isMiniPlayer) desktopMode = "mini";
  else if (state.isPipBackground) desktopMode = "pip";

  let activeItemSnap = null;
  if (state.isPlayerOpen && item) {
    const isSeries = item.media_type === "series";
    const sNum = isSeries ? Number(state.activeSeason) || 1 : 1;
    const eNum = isSeries ? Number(state.activeEpisode) || 1 : 1;
    const epMeta = isSeries ? getEpisodeDisplayMeta(sNum, eNum) : null;
    const epRatingObj = isSeries ? getEpisodeRatingEntry(item, sNum, eNum) : null;
    activeItemSnap = {
      id: item.id || "",
      title: displayTitle(item) || item.title || "",
      orig_title: item.orig_title || "",
      year: item.year || "",
      media_type: item.media_type || "movie",
      poster: displayPoster(item) || item.poster || "",
      backdrop: item.backdrop || item.poster || "",
      season: sNum,
      episode: eNum,
      episode_title: epMeta?.realTitle || "",
      user_rating: Number(item.kinorium?.user_rating) || 0,
      episode_rating: isSeries ? Number(epRatingObj?.score) || 0 : 0,
      watched: Boolean(item.kinorium?.watched),
      episode_watched: isSeries ? Boolean(isEpisodeWatched(item, sNum, eNum)) : false,
    };
  }

  const studioSel = typeof document !== "undefined" ? document.getElementById("select-studio") : null;
  const studios = studioSel
    ? Array.from(studioSel.options || []).map((o) => ({
        id: String(o.value),
        label: String(o.textContent || "").trim(),
      }))
    : [];

  const qualSel = typeof document !== "undefined" ? document.getElementById("select-quality") : null;
  const qualities = qualSel
    ? Array.from(qualSel.options || []).map((o) => ({
        id: String(o.value),
        label: String(o.textContent || "").trim(),
      }))
    : [];

  const subSel = typeof document !== "undefined" ? document.getElementById("select-subtitle") : null;
  const subtitles = subSel
    ? Array.from(subSel.options || []).map((o) => ({
        index: parseInt(o.value, 10),
        label: String(o.textContent || "").trim(),
      }))
    : [{ index: -1, label: t("Выключены", "Off") }];

  const skipIntroEl = typeof document !== "undefined" ? document.getElementById("skip-intro-btn") : null;
  const hasSkipIntro = Boolean(
    state.isPlayerOpen &&
      ((skipIntroEl && !skipIntroEl.classList.contains("hidden")) ||
        (state.skipSegments?.intro &&
          cur >= Number(state.skipSegments.intro.start || 0) - 2 &&
          cur < Number(state.skipSegments.intro.end || 0)))
  );

  const prevEpBtn = typeof document !== "undefined" ? document.getElementById("btn-prev-ep") : null;
  const hasPrevEp = Boolean(
    state.isPlayerOpen &&
      item?.media_type === "series" &&
      prevEpBtn &&
      !prevEpBtn.disabled
  );
  const hasNextEp = Boolean(
    state.isPlayerOpen && item?.media_type === "series" && getNextEpisodeCoords()
  );

  return {
    app_lang: state.appLang === "en" ? "en" : "ru",
    is_player_open: Boolean(state.isPlayerOpen),
    desktop_mode: desktopMode,
    tv_mode: Boolean(state.tvMode),
    playing: Boolean(state.isPlayerOpen && video && !video.paused && !video.ended),
    current_time: Math.round((Number(cur) || 0) * 10) / 10,
    duration: Math.round((Number(dur) || 0) * 10) / 10,
    playback_rate: Number(video?.playbackRate) || 1.0,
    volume: video ? Math.round((Number(video.volume) || 0) * 100) / 100 : 1.0,
    muted: Boolean(video?.muted),
    active_source_tab: state.activeSourceTab || "hdrezka",
    active_item: activeItemSnap,
    studios,
    active_studio: studioSel ? String(studioSel.value || "") : "",
    active_studio_name: state.activeStudioName || "",
    qualities,
    active_quality: qualSel ? String(qualSel.value || "") : "",
    subtitles,
    active_sub_idx: Number.isFinite(state.activeSubtitleIndex) ? state.activeSubtitleIndex : -1,
    sub_offset_sec: Number(state.subtitleOffsetSec) || 0,
    has_skip_intro: hasSkipIntro,
    has_prev_ep: hasPrevEp,
    has_next_ep: hasNextEp,
    native_fs_ready: true,
    native_pip_ready: true,
    active_profile_id: String(state.activeProfileId || "main"),
    kids_mode: Boolean(state.activeProfile?.kids_mode),
  };
}

export function syncDesktopConnectedRemotesUI(remotesList = []) {
  if (typeof document === "undefined") return;
  const arr = Array.isArray(remotesList) ? remotesList : [];
  const count = arr.length;
  state.remoteConnectedCount = count;

  const vcRemoteBtn = document.getElementById("vc-btn-remote");
  if (vcRemoteBtn) {
    vcRemoteBtn.classList.toggle("is-remote-active", count > 0);
  }
  const badgeEl = document.getElementById("remote-pair-connected-pill");
  if (badgeEl) {
    if (count > 0) {
      const names = arr.map((r) => r.device_name || t("Смартфон", "Smartphone")).join(", ");
      badgeEl.textContent = t(
        `Подключено: ${names}`,
        `Connected: ${names}`
      );
      badgeEl.classList.add("is-online");
    } else {
      badgeEl.textContent = t(
        "Ожидание подключения с телефона по Wi-Fi",
        "Waiting for smartphone connection over Wi-Fi"
      );
      badgeEl.classList.remove("is-online");
    }
  }
}

export async function pushDesktopRemoteStateNow() {
  if (!_isLoopbackHost() || isMobileRemoteUrl()) return;
  _lastDesktopPushTs = Date.now();
  if (_desktopPushTimer) {
    clearTimeout(_desktopPushTimer);
    _desktopPushTimer = null;
  }
  try {
    const snap = _collectDesktopStateSnapshot();
    const res = await fetch("/api/remote/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snap),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.connected_remotes)) {
        syncDesktopConnectedRemotesUI(data.connected_remotes);
      }
    }
  } catch (_) {}
}

export function scheduleDesktopRemoteStatePush(minIntervalMs = 950) {
  if (!_isLoopbackHost() || isMobileRemoteUrl()) return;
  const elapsed = Date.now() - _lastDesktopPushTs;
  if (elapsed >= minIntervalMs) {
    pushDesktopRemoteStateNow();
    return;
  }
  if (_desktopPushTimer) return;
  _desktopPushTimer = setTimeout(() => {
    _desktopPushTimer = null;
    pushDesktopRemoteStateNow();
  }, Math.max(80, minIntervalMs - elapsed));
}

async function _executeRemoteCommandOnDesktop(cmdObj) {
  if (!cmdObj || typeof document === "undefined") return;
  const action = String(cmdObj.action || cmdObj.cmd || "").trim();
  const payload = cmdObj.payload || cmdObj.args || {};
  const video = document.getElementById("native-video");

  switch (action) {
    case "ping_desktop":
      pushDesktopRemoteStateNow();
      return;

    case "toggle_play":
      if (state.isPlayerOpen) {
        toggleVideoPlayPause(true);
      }
      break;

    case "play":
      if (state.isPlayerOpen && video && video.paused) {
        toggleVideoPlayPause(true);
      }
      break;

    case "pause":
      if (state.isPlayerOpen && video && !video.paused) {
        toggleVideoPlayPause(true);
      }
      break;

    case "seek_rel": {
      if (!state.isPlayerOpen || !video) break;
      const delta = Number(payload.delta) || 0;
      const { cur, dur } = getEffectivePlaybackTiming(video);
      const nextSec = dur > 0 ? Math.min(dur - 0.5, Math.max(0, cur + delta)) : Math.max(0, cur + delta);
      seekEffectivePlayback(nextSec);
      showVideoOsd(
        delta >= 0 ? "fwd10" : "back10",
        `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta))} ${t("с", "s")}`
      );
      break;
    }

    case "seek_to":
    case "seek_abs": {
      if (!state.isPlayerOpen || !video) break;
      const target = Math.max(0, Number(payload.time ?? payload.sec) || 0);
      seekEffectivePlayback(target);
      break;
    }

    case "set_volume": {
      if (!video) break;
      const v = Math.max(0, Math.min(1, Number(payload.volume) || 0));
      state.internalMuteOverride = true;
      video.volume = v;
      video.muted = v <= 0.005;
      state.userMutedThisSession = video.muted;
      state.internalMuteOverride = false;
      if (v > 0.02) {
        savePlayerPrefs({ volume: v, muted: false });
      }
      syncCustomVideoControlsUI(true);
      showVideoOsd(v <= 0.005 ? "volMute" : "volHigh", `${Math.round(v * 100)}%`, Math.round(v * 100));
      break;
    }

    case "toggle_mute": {
      if (!video) break;
      state.internalMuteOverride = true;
      video.muted = !video.muted;
      state.userMutedThisSession = video.muted;
      state.internalMuteOverride = false;
      syncCustomVideoControlsUI(true);
      showVideoOsd(video.muted ? "volMute" : "volHigh", video.muted ? t("Без звука", "Muted") : `${Math.round(video.volume * 100)}%`);
      break;
    }

    case "set_studio": {
      const studioSel = document.getElementById("select-studio");
      const val = String(payload.id ?? payload.studio ?? "");
      if (studioSel && val && studioSel.value !== val) {
        studioSel.value = val;
        studioSel.dispatchEvent(new Event("change"));
      }
      break;
    }

    case "set_quality": {
      const qualSel = document.getElementById("select-quality");
      const val = String(payload.id ?? payload.quality ?? "");
      if (qualSel && val && qualSel.value !== val) {
        qualSel.value = val;
        qualSel.dispatchEvent(new Event("change"));
      }
      break;
    }

    case "set_subtitle": {
      const subSel = document.getElementById("select-subtitle");
      const val = String(payload.index ?? payload.id ?? "-1");
      if (subSel && subSel.value !== val) {
        subSel.value = val;
        subSel.dispatchEvent(new Event("change"));
      }
      break;
    }

    case "sub_offset": {
      if (payload.reset) {
        resetSubtitleOffset(true);
      } else {
        adjustSubtitleOffset(Number(payload.delta) || 0, true);
      }
      break;
    }

    case "prev_ep":
      if (state.isPlayerOpen && state.activeItem?.media_type === "series") {
        await stepEpisode(-1);
      }
      break;

    case "next_ep":
      if (state.isPlayerOpen && state.activeItem?.media_type === "series") {
        await stepEpisode(1);
      }
      break;

    case "step_episode":
      if (state.isPlayerOpen && state.activeItem?.media_type === "series") {
        await stepEpisode(Number(payload.delta) >= 0 ? 1 : -1);
      }
      break;

    case "select_episode":
      if (state.isPlayerOpen && state.activeItem?.media_type === "series") {
        const sNum = Math.max(1, Number(payload.season) || state.activeSeason || 1);
        const eNum = Math.max(1, Number(payload.episode) || 1);
        await switchToSeriesSeasonEpisode(sNum, eNum);
      }
      break;

    case "skip_intro": {
      const skipBtn = document.getElementById("skip-intro-btn");
      if (skipBtn && !skipBtn.classList.contains("hidden")) {
        skipBtn.click();
      } else if (state.skipSegments?.intro?.end) {
        seekEffectivePlayback(Number(state.skipSegments.intro.end) + 0.5);
      }
      break;
    }

    case "toggle_fullscreen": {
      const tvCastMod = document.getElementById("tv-cast-modal");
      if (tvCastMod && !tvCastMod.classList.contains("hidden") && state.remoteCastTab !== "tv") {
        closeTvCastModal();
      }
      if (state.isPlayerOpen) {
        if (state.isPipBackground || isVideoInPiP(video)) {
          await togglePictureInPicture({ fromRemote: true });
        }
        if (isStageFullscreen()) {
          toggleStageFullscreen();
        } else {
          if (video) {
            video.tabIndex = -1;
            try {
              video.focus({ preventScroll: true });
            } catch (_) {}
          }
          let triggeredNative = false;
          try {
            const r = await fetch("/api/remote/native-fullscreen", { method: "POST" });
            if (r.ok) {
              const d = await r.json();
              triggeredNative = Boolean(d && d.ok);
            }
          } catch (_) {}
          if (triggeredNative) {
            setTimeout(() => {
              if (state.isPlayerOpen && !isStageFullscreen()) {
                toggleStageFullscreen();
              }
            }, 260);
          } else {
            toggleStageFullscreen();
          }
        }
      }
      break;
    }

    case "rate_active":
      if (state.isPlayerOpen && state.activeItem) {
        await rateActivePlayerTitle({
          scope: payload.scope || "auto",
          score: Number(payload.score) || 0,
          clear: Boolean(payload.clear),
          comment: String(payload.comment || ""),
          season: payload.season,
          episode: payload.episode,
        });
      }
      break;

    case "toggle_watched":
      if (state.isPlayerOpen && state.activeItem) {
        await toggleActivePlayerWatched();
      }
      break;

    case "toggle_mini":
    case "toggle_pip": {
      const tvCastMod = document.getElementById("tv-cast-modal");
      if (tvCastMod && !tvCastMod.classList.contains("hidden") && state.remoteCastTab !== "tv") {
        closeTvCastModal();
      }
      if (state.isPlayerOpen) {
        await togglePictureInPicture({ fromRemote: true });
      }
      break;
    }

    case "toggle_tv_mode": {
      const tvCastMod = document.getElementById("tv-cast-modal");
      if (tvCastMod && !tvCastMod.classList.contains("hidden") && state.remoteCastTab !== "tv") {
        closeTvCastModal();
      }
      setTvMode(!state.tvMode);
      break;
    }

    case "close_player":
      if (state.isPlayerOpen) {
        closePlayerModal();
      }
      break;

    case "dpad": {
      const dir = String(payload.key || payload.dir || "").toLowerCase();
      executeRemoteDpadCommand(dir);
      break;
    }

    case "play_item": {
      const tvCastMod = document.getElementById("tv-cast-modal");
      if (tvCastMod && !tvCastMod.classList.contains("hidden") && state.remoteCastTab !== "tv") {
        closeTvCastModal();
      }
      const itemData = payload.item;
      if (itemData && itemData.title) {
        if (Boolean(state.activeProfile?.kids_mode) && !isItemSafeForKidsClient(itemData)) {
          showToast(
            t(
              "Контент недоступен в детском профиле",
              "Content restricted in Kids Mode"
            )
          );
          break;
        }
        const sNum = Math.max(1, Number(payload.season || itemData.season) || 1);
        const eNum = Math.max(1, Number(payload.episode || itemData.episode) || 1);
        const resumeSec = Math.max(0, Number(payload.resume_time || itemData.current_time) || 0);
        await openPlayerModal(itemData, "hdrezka", sNum, eNum, resumeSec);
        showToast(
          t(
            `Запущено с телефона: «${displayTitle(itemData) || itemData.title}»`,
            `Started from phone: "${displayTitle(itemData) || itemData.title}"`
          )
        );
      }
      break;
    }

    default:
      break;
  }

  setTimeout(() => {
    pushDesktopRemoteStateNow();
  }, 60);
}

export function initDesktopRemoteAgent() {
  if (_desktopAgentStarted || typeof window === "undefined") return;
  if (!_isLoopbackHost() || isMobileRemoteUrl()) return;
  _desktopAgentStarted = true;

  const video = document.getElementById("native-video");
  if (video) {
    ["play", "pause", "seeked", "volumechange", "ratechange", "loadedmetadata"].forEach((ev) => {
      video.addEventListener(ev, () => scheduleDesktopRemoteStatePush(120));
    });
    video.addEventListener("timeupdate", () => {
      if (state.remoteConnectedCount > 0) {
        scheduleDesktopRemoteStatePush(950);
      }
    });
  }

  ["select-studio", "select-quality", "select-subtitle"].forEach((selId) => {
    document.getElementById(selId)?.addEventListener("change", () => {
      setTimeout(() => pushDesktopRemoteStateNow(), 120);
    });
  });

  pushDesktopRemoteStateNow();
  setInterval(() => {
    if (!document.hidden || state.isPlayerOpen || state.remoteConnectedCount > 0) {
      pushDesktopRemoteStateNow();
    }
  }, 10000);

  let lastSeq = -1;
  const pollCommandsLoop = async () => {
    while (true) {
      try {
        const hasRemotes = (state.remoteConnectedCount > 0);
        const timeoutSec = lastSeq < 0 ? 0 : (hasRemotes ? 15 : 0);
        const res = await fetch(`/api/remote/commands?since=${lastSeq}&timeout=${timeoutSec}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.connected_remotes)) {
            syncDesktopConnectedRemotesUI(data.connected_remotes);
          }
          if (typeof data.latest_seq === "number" && (lastSeq < 0 || data.latest_seq > lastSeq)) {
            lastSeq = data.latest_seq;
          }
          const cmds = Array.isArray(data.commands) ? data.commands : [];
          for (const c of cmds) {
            await _executeRemoteCommandOnDesktop(c);
          }
          if (!hasRemotes && !(Array.isArray(data.connected_remotes) && data.connected_remotes.length > 0)) {
            await new Promise((r) => setTimeout(r, 3500));
          }
        } else {
          await new Promise((r) => setTimeout(r, 2500));
        }
      } catch (_) {
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
  };
  pollCommandsLoop();
}

/* ==========================================================================
   2. Desktop Pairing Panel inside #tv-cast-modal
   ========================================================================== */
export async function loadAndRenderRemotePairingPanel(regenerate = false) {
  if (typeof document === "undefined") return;
  const qrBox = document.getElementById("remote-pair-qr-box");
  const urlInput = document.getElementById("remote-pair-url-text");
  if (!qrBox) return;

  try {
    let data = null;
    if (regenerate) {
      let pinHeader = "";
      if (
        (state.activeProfile?.kids_mode && state.activeProfile?.has_kids_pin) ||
        (state.activeProfile?.is_kids && state.activeProfile?.has_pin)
      ) {
        const verified = await requestKidsPinVerification(
          t("Подтвердите PIN для смены ключа пульта", "Verify PIN to rotate remote key")
        );
        if (!verified) return;
        pinHeader = verified;
      }
      const res = await fetch("/api/remote/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regenerate: true,
          enable_lan: true,
          pin: pinHeader,
          lang: state.appLang || "ru",
        }),
      });
      data = await res.json();
      if (!res.ok || data.ok === false) {
        showToast(data.error || t("Не удалось обновить ключ пульта", "Could not rotate remote key"));
        return;
      }
      showToast(t("Ключ доступа пульта обновлён", "Remote access key rotated"));
    } else {
      const res = await fetch("/api/remote/pairing?auto_lan=1", { headers: { "X-CineFlow-Intent": "pair" } });
      data = await res.json();
    }

    if (!data || !data.ok) return;
    state.remotePairInfo = data;
    syncDesktopConnectedRemotesUI(data.connected_remotes || []);

    if (data.qr_svg) {
      qrBox.innerHTML = data.qr_svg;
    } else {
      qrBox.innerHTML = `<div class="atv-stream-empty-note">${escapeHtml(
        t(
          "Подключите компьютер к домашней сети Wi-Fi для генерации QR-кода",
          "Connect your computer to Wi-Fi to generate a pairing QR code"
        )
      )}</div>`;
    }
    if (urlInput) {
      urlInput.textContent = data.remote_url || "—";
    }
  } catch (_) {
    qrBox.innerHTML = `<div class="atv-stream-empty-note">${escapeHtml(
      t("Не удалось получить параметры подключения", "Could not load pairing details")
    )}</div>`;
  }
}

export function switchCastModalTab(tabKey = "phone", { focusTab = false } = {}) {
  if (typeof document === "undefined") return;
  const norm = tabKey === "tv" ? "tv" : "phone";
  state.remoteCastTab = norm;
  const phoneBtn = document.getElementById("btn-cast-tab-phone");
  const tvBtn = document.getElementById("btn-cast-tab-tv");
  if (phoneBtn) {
    phoneBtn.classList.toggle("active", norm === "phone");
    phoneBtn.setAttribute("aria-selected", norm === "phone" ? "true" : "false");
    phoneBtn.tabIndex = norm === "phone" ? 0 : -1;
  }
  if (tvBtn) {
    tvBtn.classList.toggle("active", norm === "tv");
    tvBtn.setAttribute("aria-selected", norm === "tv" ? "true" : "false");
    tvBtn.tabIndex = norm === "tv" ? 0 : -1;
  }
  document.getElementById("tv-cast-phone-pane")?.classList.toggle("hidden", norm !== "phone");
  document.getElementById("tv-cast-dlna-pane")?.classList.toggle("hidden", norm !== "tv");
  if (focusTab) {
    const activeBtn = norm === "tv" ? tvBtn : phoneBtn;
    try {
      activeBtn?.focus({ preventScroll: true });
    } catch (_) {}
  }
  if (norm === "phone") {
    loadAndRenderRemotePairingPanel(false);
  }
}

/* ==========================================================================
   3. Mobile Smartphone Remote Controller (?remote=1&k=...)
   ========================================================================== */
export function initMobileRemoteController() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  state.remoteMode = true;
  document.body.classList.add("is-mobile-remote-mode");

  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (viewportMeta) {
    viewportMeta.setAttribute(
      "content",
      "width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"
    );
  }

  const qs = new URLSearchParams(window.location.search || "");
  const pairKey = String(qs.get("k") || "").trim();
  const qsLang = String(qs.get("lang") || "").trim().toLowerCase();
  if (qsLang === "en" || qsLang === "ru") {
    state.appLang = qsLang;
    saveUiPrefs({ appLang: qsLang });
  }
  const clientId = _getOrCreateRemoteClientId();

  ["ambient-glow", "pip-status-dock", "scroll-top-btn"].forEach((id) => {
    document.getElementById(id)?.classList.add("hidden");
  });
  document.querySelector(".atv-header")?.classList.add("hidden");
  document.querySelector(".atv-main")?.classList.add("hidden");

  let shell = document.getElementById("remote-control-shell");
  if (!shell) {
    shell = document.createElement("div");
    shell.id = "remote-control-shell";
    shell.className = "atv-remote-shell";
    document.body.appendChild(shell);
  }

  if (!shell._doubleTapZoomGuardBound) {
    shell._doubleTapZoomGuardBound = true;
    let lastTouchStartX = 0;
    let lastTouchStartY = 0;
    let lastTouchEndTs = 0;
    let suppressTrustedClickUntil = 0;

    shell.addEventListener(
      "dblclick",
      (e) => {
        e.preventDefault();
      },
      { passive: false }
    );
    shell.addEventListener(
      "gesturestart",
      (e) => {
        e.preventDefault();
      },
      { passive: false }
    );
    shell.addEventListener(
      "click",
      (e) => {
        if (e.isTrusted && Date.now() < suppressTrustedClickUntil) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      },
      true
    );
    shell.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches && e.touches.length > 1) {
          e.preventDefault();
          return;
        }
        if (e.touches && e.touches.length === 1) {
          lastTouchStartX = e.touches[0].clientX;
          lastTouchStartY = e.touches[0].clientY;
        }
      },
      { passive: false }
    );
    shell.addEventListener(
      "touchend",
      (e) => {
        if (!e.changedTouches || e.changedTouches.length !== 1) return;
        const t0 = e.changedTouches[0];
        const moved = Math.hypot(t0.clientX - lastTouchStartX, t0.clientY - lastTouchStartY);
        if (moved > 14) return;
        const target = e.target;
        if (target && target.closest && target.closest("input, textarea, select")) {
          return;
        }
        const now = Date.now();
        const delta = now - lastTouchEndTs;
        lastTouchEndTs = now;
        if (delta > 0 && delta <= 340) {
          e.preventDefault();
          suppressTrustedClickUntil = now + 80;
          const interactive = target?.closest?.("button, [role='button'], [data-rm-open-id]");
          if (interactive && !interactive.disabled) {
            interactive.click();
          }
        }
      },
      { passive: false }
    );
  }

  const rState = {
    activeTab: "player",
    rateScope: "episode",
    desktopOnline: false,
    authFailed: false,
    scrubbing: false,
    lastSeq: 0,
    lastSyncPerfMs: 0,
    snap: {
      app_lang: state.appLang === "en" ? "en" : "ru",
      is_player_open: false,
      desktop_mode: "window",
      tv_mode: false,
      playing: false,
      current_time: 0,
      duration: 0,
      volume: 1,
      muted: false,
      active_item: null,
      studios: [],
      active_studio: "",
      active_studio_name: "",
      qualities: [],
      active_quality: "",
      subtitles: [],
      active_sub_idx: -1,
      sub_offset_sec: 0,
      has_skip_intro: false,
      has_prev_ep: false,
      has_next_ep: false,
    },
    catalogLoaded: false,
    catalogCW: [],
    catalogItems: [],
    searchResults: null,
    searchQuery: "",
  };

  const sendCmd = async (action, payload = {}) => {
    try {
      if (navigator.vibrate) {
        try {
          navigator.vibrate(10);
        } catch (_) {}
      }
      const res = await fetch("/api/remote/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          k: pairKey,
          cid: clientId,
          device: _detectPhoneDeviceLabel(),
          action,
          payload,
        }),
      });
      if (res.status === 403) {
        rState.authFailed = true;
        renderAuthState();
      }
    } catch (_) {}
  };

  shell.innerHTML = `
    <header class="atv-remote-topbar">
      <div class="atv-remote-brand">
        <span class="atv-remote-dot" id="rm-conn-dot"></span>
        <div>
          <div class="atv-remote-brand-title" id="rm-brand-title">${t("Пульт CineFlow", "CineFlow Remote")}</div>
          <div class="atv-remote-brand-sub" id="rm-conn-label">${t("Подключение к компьютеру...", "Connecting to computer...")}</div>
        </div>
      </div>
      <button type="button" class="atv-remote-icon-btn" id="rm-btn-close-pc-player" aria-label="${escapeAttr(
        t("Закрыть плеер на компьютере", "Close player on computer")
      )}" title="${escapeAttr(
        t("Закрыть плеер на компьютере", "Close player on computer")
      )}">${iconSvg("x", 16)}</button>
    </header>

    <div class="atv-remote-auth-error hidden" id="rm-auth-error">
      <div class="atv-remote-empty-title" id="rm-auth-error-title">${t("Ключ пульта недействителен", "Remote key expired")}</div>
      <div class="atv-remote-empty-sub" id="rm-auth-error-sub">${t(
        "Отсканируйте актуальный QR-код в окне «Пульт и ТВ» на компьютере.",
        "Scan the current QR code in the Remote & TV window on your computer."
      )}</div>
    </div>

    <main class="atv-remote-body" id="rm-main-body">
      <section class="atv-remote-pane" id="rm-pane-player">
        <div class="atv-remote-now-card" id="rm-now-card">
          <img class="atv-remote-poster hidden" id="rm-poster" alt="" referrerpolicy="no-referrer" />
          <div class="atv-remote-now-meta">
            <div class="atv-remote-now-badge" id="rm-source-badge">CineFlow</div>
            <div class="atv-remote-now-title" id="rm-now-title">${t("На компьютере ничего не воспроизводится", "Nothing playing on computer")}</div>
            <div class="atv-remote-now-sub" id="rm-now-sub">${t("Выберите фильм во вкладке «Каталог» или запустите плеер на ПК", "Pick a title in the Catalog tab or start playback on PC")}</div>
          </div>
        </div>

        <div class="atv-remote-timeline-box" id="rm-timeline-box">
          <input type="range" class="atv-remote-scrubber" id="rm-scrubber" min="0" max="1000" step="1" value="0" aria-label="${escapeAttr(t("Позиция воспроизведения", "Playback position"))}" />
          <div class="atv-remote-time-row">
            <span id="rm-time-cur">0:00</span>
            <span id="rm-time-dur">0:00</span>
          </div>
        </div>

        <div class="atv-remote-transport-row">
          <button type="button" class="atv-remote-sec-btn" id="rm-btn-back10">
            ${iconSvg("chevronLeft", 16)}
            <span id="rm-lbl-back10">10 ${t("с", "s")}</span>
          </button>
          <button type="button" class="atv-remote-play-btn" id="rm-btn-play" aria-label="${escapeAttr(
            t("Пауза / Пуск", "Play / Pause")
          )}">
            ${iconSvg("play", 24)}
          </button>
          <button type="button" class="atv-remote-sec-btn" id="rm-btn-fwd10">
            <span id="rm-lbl-fwd10">10 ${t("с", "s")}</span>
            ${iconSvg("chevronRight", 16)}
          </button>
        </div>

        <div class="atv-remote-ep-row hidden" id="rm-ep-row">
          <button type="button" class="atv-remote-pill-btn" id="rm-btn-prev-ep">${iconSvg("skipBack", 14)}<span id="rm-lbl-prev-ep">${t("Пред серия", "Prev Ep")}</span></button>
          <button type="button" class="atv-remote-pill-btn is-accent hidden" id="rm-btn-skip-intro">${t("Пропустить заставку", "Skip Intro")}</button>
          <button type="button" class="atv-remote-pill-btn" id="rm-btn-next-ep"><span id="rm-lbl-next-ep">${t("След серия", "Next Ep")}</span>${iconSvg("skipFwd", 14)}</button>
        </div>

        <div class="atv-remote-card-group">
          <div class="atv-remote-vol-row">
            <button type="button" class="atv-remote-icon-btn" id="rm-btn-mute" aria-label="${escapeAttr(t("Включить или выключить звук", "Mute or unmute"))}">${iconSvg("volHigh", 16)}</button>
            <input type="range" class="atv-remote-vol-slider" id="rm-vol-slider" min="0" max="100" step="1" value="100" aria-label="${escapeAttr(t("Громкость", "Volume"))}" />
            <span class="atv-remote-vol-val" id="rm-vol-val">100%</span>
          </div>
        </div>

        <div class="atv-remote-card-group" id="rm-tracks-group">
          <div class="atv-remote-field-row" id="rm-studio-row">
            <label for="rm-sel-studio" id="rm-lbl-studio">${t("Озвучка", "Audio")}</label>
            <select id="rm-sel-studio" class="atv-remote-native-select" data-native-select="1"></select>
          </div>
          <div class="atv-remote-field-row" id="rm-quality-row">
            <label for="rm-sel-quality" id="rm-lbl-quality">${t("Качество", "Quality")}</label>
            <select id="rm-sel-quality" class="atv-remote-native-select" data-native-select="1"></select>
          </div>
          <div class="atv-remote-field-row" id="rm-sub-row">
            <label for="rm-sel-sub" id="rm-lbl-sub">${t("Субтитры", "Subtitles")}</label>
            <select id="rm-sel-sub" class="atv-remote-native-select" data-native-select="1"></select>
          </div>
          <div class="atv-remote-field-row">
            <span id="rm-lbl-sub-sync">${t("Синхронизация субтитров", "Subtitle Sync")}</span>
            <div class="atv-sub-offset-stepper">
              <button type="button" class="atv-sub-step-btn" id="rm-sub-minus">−0.25</button>
              <button type="button" class="atv-sub-step-val" id="rm-sub-val">0.0 ${t("с", "s")}</button>
              <button type="button" class="atv-sub-step-btn" id="rm-sub-plus">+0.25</button>
            </div>
          </div>
        </div>

        <div class="atv-remote-card-group hidden" id="rm-rating-group">
          <div class="atv-remote-rate-head">
            <div class="atv-remote-rate-title-wrap">
              <span class="atv-remote-rate-title" id="rm-lbl-rate-title">${t("Оценка в Kinorium", "Kinorium Rating")}</span>
              <span class="atv-remote-rate-badge" id="rm-rate-current-badge">${t("Не оценено", "Not rated")}</span>
            </div>
            <div class="atv-remote-rate-actions">
              <button type="button" class="atv-remote-rate-action-btn" id="rm-btn-watch-toggle" aria-pressed="false">${t("Отметить просмотр", "Mark Watched")}</button>
              <button type="button" class="atv-remote-rate-action-btn is-subtle hidden" id="rm-btn-clear-rate">${t("Сбросить", "Clear")}</button>
            </div>
          </div>
          <div class="atv-remote-rate-scope hidden" id="rm-rate-scope-row">
            <button type="button" class="atv-remote-scope-btn active" id="rm-rate-scope-ep" data-rscope="episode" aria-pressed="true">${t("Эта серия", "This Episode")}</button>
            <button type="button" class="atv-remote-scope-btn" id="rm-rate-scope-series" data-rscope="series" aria-pressed="false">${t("Весь сериал", "Entire Series")}</button>
          </div>
          <div class="atv-remote-rate-grid" id="rm-rate-stars-grid">
            ${Array.from({ length: 10 }, (_, idx) => {
              const sc = idx + 1;
              return `<button type="button" class="atv-remote-rate-btn" data-rscore="${sc}" aria-pressed="false" aria-label="${escapeAttr(t(`Оценка ${sc} из 10`, `Rate ${sc} out of 10`))}">${sc}</button>`;
            }).join("")}
          </div>
        </div>

        <div class="atv-remote-modes-grid">
          <button type="button" class="atv-remote-mode-btn" id="rm-btn-fs" aria-pressed="false">${iconSvg("fsEnter", 15)}<span id="rm-lbl-fs">${t("Полный экран", "Fullscreen")}</span></button>
          <button type="button" class="atv-remote-mode-btn" id="rm-btn-pip" aria-pressed="false">${iconSvg("airplay", 15)}<span id="rm-lbl-pip">${t("Картинка в картинке", "PiP")}</span></button>
          <button type="button" class="atv-remote-mode-btn" id="rm-btn-tvmode" aria-pressed="false">${iconSvg("tv", 15)}<span id="rm-lbl-tvmode">${t("Режим ТВ", "TV Mode")}</span></button>
        </div>
      </section>

      <section class="atv-remote-pane hidden" id="rm-pane-dpad">
        <div class="atv-remote-dpad-mode-switch">
          <button type="button" class="atv-remote-scope-btn active" id="rm-mode-touchpad" aria-pressed="true">${t("Тачпад", "Touchpad")}</button>
          <button type="button" class="atv-remote-scope-btn" id="rm-mode-buttons" aria-pressed="false">${t("Кнопки", "Buttons")}</button>
        </div>
        <div class="atv-remote-dpad-hint" id="rm-dpad-hint">${t(
          "Свайп влево и вправо для перемотки, вверх и вниз для громкости, касание для выбора",
          "Swipe left/right to seek, up/down for volume, tap to select"
        )}</div>
        <div class="atv-remote-touchpad-wrap" id="rm-touchpad-box">
          <div class="atv-remote-touchpad-surface" id="rm-touchpad-surface" role="application" aria-label="${escapeAttr(t("Сенсорная панель навигации: свайп для перемещения, касание для выбора", "Touchpad navigation surface: swipe to move, tap to select"))}">
            <div class="atv-remote-touchpad-arrow is-up" aria-hidden="true">${iconSvg("chevronUp", 14)}</div>
            <div class="atv-remote-touchpad-arrow is-down" aria-hidden="true">${iconSvg("chevronDown", 14)}</div>
            <div class="atv-remote-touchpad-arrow is-left" aria-hidden="true">${iconSvg("chevronLeft", 14)}</div>
            <div class="atv-remote-touchpad-arrow is-right" aria-hidden="true">${iconSvg("chevronRight", 14)}</div>
            <div class="atv-remote-touchpad-puck" id="rm-touchpad-puck" aria-hidden="true"></div>
          </div>
        </div>
        <div class="atv-remote-dpad-pad hidden" id="rm-buttons-box">
          <div></div>
          <button type="button" class="atv-remote-dpad-btn" data-dpad="up" aria-label="${escapeAttr(t("Вверх", "Up"))}" title="${escapeAttr(t("Вверх", "Up"))}">${iconSvg("chevronUp", 22)}</button>
          <div></div>
          <button type="button" class="atv-remote-dpad-btn" data-dpad="left" aria-label="${escapeAttr(t("Влево", "Left"))}" title="${escapeAttr(t("Влево", "Left"))}">${iconSvg("chevronLeft", 22)}</button>
          <button type="button" class="atv-remote-dpad-ok" data-dpad="ok" aria-label="${escapeAttr(t("Выбрать (OK)", "Select (OK)"))}" title="${escapeAttr(t("Выбрать (OK)", "Select (OK)"))}">OK</button>
          <button type="button" class="atv-remote-dpad-btn" data-dpad="right" aria-label="${escapeAttr(t("Вправо", "Right"))}" title="${escapeAttr(t("Вправо", "Right"))}">${iconSvg("chevronRight", 22)}</button>
          <div></div>
          <button type="button" class="atv-remote-dpad-btn" data-dpad="down" aria-label="${escapeAttr(t("Вниз", "Down"))}" title="${escapeAttr(t("Вниз", "Down"))}">${iconSvg("chevronDown", 22)}</button>
          <div></div>
        </div>
        <div class="atv-remote-dpad-actions">
          <button type="button" class="atv-remote-pill-btn" data-dpad="back" id="rm-dpad-back">${t("Назад (Esc)", "Back (Esc)")}</button>
          <button type="button" class="atv-remote-pill-btn" id="rm-dpad-playpause">${t("Пауза / Пуск", "Play / Pause")}</button>
          <button type="button" class="atv-remote-pill-btn" id="rm-dpad-tvtoggle" aria-pressed="false">${t("Режим ТВ", "TV Mode")}</button>
        </div>
      </section>

      <section class="atv-remote-pane hidden" id="rm-pane-catalog">
        <div class="atv-remote-search-bar">
          <input type="search" id="rm-catalog-search" enterkeyhint="search" aria-label="${escapeAttr(
            t("Найти фильм или сериал для запуска на ПК...", "Search movies or series to play on PC...")
          )}" placeholder="${escapeAttr(
            t("Найти фильм или сериал для запуска на ПК...", "Search movies or series to play on PC...")
          )}" autocomplete="off" />
        </div>
        <div id="rm-catalog-results" class="atv-remote-catalog-list"></div>
      </section>
    </main>

    <nav class="atv-remote-bottom-tabs" role="tablist" aria-label="${escapeAttr(t("Разделы пульта", "Remote sections"))}">
      <button type="button" role="tab" aria-selected="true" class="atv-remote-tab active" data-rtab="player">${iconSvg("play", 16)}<span id="rm-tab-lbl-player">${t("Плеер", "Player")}</span></button>
      <button type="button" role="tab" aria-selected="false" class="atv-remote-tab" data-rtab="dpad">${iconSvg("tv", 16)}<span id="rm-tab-lbl-dpad">${t("Пульт", "D-Pad")}</span></button>
      <button type="button" role="tab" aria-selected="false" class="atv-remote-tab" data-rtab="catalog">${iconSvg("search", 16)}<span id="rm-tab-lbl-catalog">${t("Каталог", "Catalog")}</span></button>
    </nav>
  `;

  const localizeRemoteShellStaticDOM = () => {
    document.documentElement.lang = state.appLang === "en" ? "en" : "ru";
    document.title = t("Пульт CineFlow", "CineFlow Remote");
    const setTxt = (id, ru, en) => {
      const el = document.getElementById(id);
      if (el) el.textContent = t(ru, en);
    };
    setTxt("rm-brand-title", "Пульт CineFlow", "CineFlow Remote");
    setTxt("rm-auth-error-title", "Ключ пульта недействителен", "Remote key expired");
    setTxt(
      "rm-auth-error-sub",
      "Отсканируйте актуальный QR-код в окне «Пульт и ТВ» на компьютере.",
      "Scan the current QR code in the Remote & TV window on your computer."
    );
    setTxt("rm-lbl-back10", "10 с", "10 s");
    setTxt("rm-lbl-fwd10", "10 с", "10 s");
    setTxt("rm-lbl-prev-ep", "Пред серия", "Prev Ep");
    setTxt("rm-btn-skip-intro", "Пропустить заставку", "Skip Intro");
    setTxt("rm-lbl-next-ep", "След серия", "Next Ep");
    setTxt("rm-lbl-studio", "Озвучка", "Audio");
    setTxt("rm-lbl-quality", "Качество", "Quality");
    setTxt("rm-lbl-sub", "Субтитры", "Subtitles");
    setTxt("rm-lbl-sub-sync", "Синхронизация субтитров", "Subtitle Sync");
    setTxt("rm-lbl-rate-title", "Оценка в Kinorium", "Kinorium Rating");
    setTxt("rm-btn-clear-rate", "Сбросить", "Clear");
    setTxt("rm-rate-scope-series", "Весь сериал", "Entire Series");
    setTxt("rm-lbl-fs", "Полный экран", "Fullscreen");
    setTxt("rm-lbl-pip", "Картинка в картинке", "PiP");
    setTxt("rm-lbl-tvmode", "Режим ТВ", "TV Mode");
    const isTouchpadMode =
      !document.getElementById("rm-touchpad-surface")?.classList.contains("hidden") &&
      document.getElementById("rm-mode-touchpad")?.classList.contains("active");
    if (isTouchpadMode) {
      setTxt(
        "rm-dpad-hint",
        "Свайп в любом направлении — перемещение курсора, одиночное касание — выбор (OK)",
        "Swipe in any direction to move focus, single tap to select (OK)"
      );
    } else {
      setTxt(
        "rm-dpad-hint",
        "Управляйте курсором в Режиме ТВ и диалоговыми окнами на компьютере",
        "Navigate TV Mode cards and modals on your computer"
      );
    }
    setTxt("rm-dpad-back", "Назад (Esc)", "Back (Esc)");
    setTxt("rm-dpad-playpause", "Пауза / Пуск", "Play / Pause");
    setTxt("rm-dpad-tvtoggle", "Режим ТВ", "TV Mode");
    setTxt("rm-tab-lbl-player", "Плеер", "Player");
    setTxt("rm-tab-lbl-dpad", "Пульт", "D-Pad");
    setTxt("rm-tab-lbl-catalog", "Каталог", "Catalog");

    const closeBtn = document.getElementById("rm-btn-close-pc-player");
    if (closeBtn) {
      const closeLbl = t("Закрыть плеер на компьютере", "Close player on computer");
      closeBtn.title = closeLbl;
      closeBtn.setAttribute("aria-label", closeLbl);
    }
    const playBtn = document.getElementById("rm-btn-play");
    if (playBtn) {
      playBtn.setAttribute("aria-label", t("Пауза / Пуск", "Play / Pause"));
    }
    const searchEl = document.getElementById("rm-catalog-search");
    if (searchEl) {
      const searchPh = t(
        "Найти фильм или сериал для запуска на ПК...",
        "Search movies or series to play on PC..."
      );
      searchEl.placeholder = searchPh;
      searchEl.setAttribute("aria-label", searchPh);
    }
    const dpadLabels = {
      up: t("Вверх", "Up"),
      left: t("Влево", "Left"),
      ok: t("Выбрать (OK)", "Select (OK)"),
      right: t("Вправо", "Right"),
      down: t("Вниз", "Down"),
    };
    Object.entries(dpadLabels).forEach(([dir, lbl]) => {
      const btn = shell.querySelector(`#rm-buttons-box [data-dpad="${dir}"]`);
      if (btn) {
        btn.title = lbl;
        btn.setAttribute("aria-label", lbl);
      }
    });
  };

  const renderAuthState = () => {
    document.getElementById("rm-auth-error")?.classList.toggle("hidden", !rState.authFailed);
    document.getElementById("rm-main-body")?.classList.toggle("hidden", rState.authFailed);
  };

  const syncSelectOptions = (selEl, items, valKey, labelKey, activeVal) => {
    if (!selEl) return;
    const sig = JSON.stringify(items);
    if (selEl.dataset.sig !== sig) {
      selEl.dataset.sig = sig;
      selEl.innerHTML = "";
      items.forEach((it) => {
        const opt = document.createElement("option");
        opt.value = String(it[valKey]);
        opt.textContent = String(it[labelKey] || "");
        selEl.appendChild(opt);
      });
    }
    if (document.activeElement !== selEl && String(selEl.value) !== String(activeVal)) {
      selEl.value = String(activeVal);
    }
    syncCustomSelect(selEl);
  };

  const renderRemoteUI = () => {
    renderAuthState();
    const s = rState.snap;
    const dot = document.getElementById("rm-conn-dot");
    const connLbl = document.getElementById("rm-conn-label");
    if (dot) dot.classList.toggle("is-online", rState.desktopOnline && !rState.authFailed);
    if (connLbl) {
      connLbl.textContent = rState.authFailed
        ? t("Доступ отклонён", "Access denied")
        : rState.desktopOnline
        ? s.is_player_open
          ? t("Подключено к ПК · Воспроизведение", "Connected to PC · Active")
          : t("Подключено к ПК · Ожидание", "Connected to PC · Idle")
        : t("Ожидание отклика CineFlow на ПК...", "Waiting for CineFlow on PC...");
    }

    const closeBtn = document.getElementById("rm-btn-close-pc-player");
    if (closeBtn) closeBtn.classList.toggle("hidden", !s.is_player_open);

    const posterEl = document.getElementById("rm-poster");
    const badgeEl = document.getElementById("rm-source-badge");
    const titleEl = document.getElementById("rm-now-title");
    const subEl = document.getElementById("rm-now-sub");

    if (s.is_player_open && s.active_item) {
      const it = s.active_item;
      if (posterEl && it.poster) {
        if (posterEl.getAttribute("src") !== it.poster) posterEl.src = it.poster;
        posterEl.classList.remove("hidden");
      } else if (posterEl) {
        posterEl.classList.add("hidden");
      }
      if (badgeEl) {
        badgeEl.textContent = s.active_studio_name
          ? translateStudioName(s.active_studio_name)
          : String(s.active_source_tab || "HDRezka").toUpperCase();
      }
      if (titleEl) {
        const dispNowTitle = displayTitle(it) || it.title || it.orig_title || "";
        titleEl.textContent = it.year ? `${dispNowTitle} (${it.year})` : dispNowTitle;
      }
      if (subEl) {
        if (it.media_type === "series") {
          const epPart = t(`Сезон ${it.season}, Серия ${it.episode}`, `Season ${it.season}, Episode ${it.episode}`);
          subEl.textContent = it.episode_title ? `${epPart} · ${it.episode_title}` : epPart;
        } else {
          subEl.textContent = it.orig_title || t("Художественный фильм", "Feature Film");
        }
      }
    } else {
      posterEl?.classList.add("hidden");
      if (badgeEl) badgeEl.textContent = "CineFlow";
      if (titleEl) titleEl.textContent = t("Плеер на компьютере закрыт", "Desktop player is closed");
      if (subEl) {
        subEl.textContent = t(
          "Откройте вкладку «Каталог», чтобы запустить любой фильм на компьютере",
          "Open the Catalog tab to launch any movie or series on your computer"
        );
      }
    }

    const playBtn = document.getElementById("rm-btn-play");
    if (playBtn) {
      const ico = s.playing ? "pause" : "play";
      if (playBtn.dataset.ico !== ico) {
        playBtn.dataset.ico = ico;
        playBtn.innerHTML = iconSvg(ico, 24);
      }
    }

    const dur = Math.max(0, Number(s.duration) || 0);
    let interpCur = Math.max(0, Number(s.current_time) || 0);
    if (s.playing && rState.lastSyncPerfMs > 0) {
      const dtSec = Math.max(0, (performance.now() - rState.lastSyncPerfMs) / 1000);
      interpCur = dur > 0 ? Math.min(dur, interpCur + dtSec * (Number(s.playback_rate) || 1)) : interpCur + dtSec;
    }

    const scrubber = document.getElementById("rm-scrubber");
    if (scrubber && !rState.scrubbing) {
      scrubber.disabled = !s.is_player_open || dur <= 0;
      scrubber.value = dur > 0 ? String(Math.round((interpCur / dur) * 1000)) : "0";
    }
    const curEl = document.getElementById("rm-time-cur");
    const durEl = document.getElementById("rm-time-dur");
    if (curEl && !rState.scrubbing) curEl.textContent = formatTime(interpCur);
    if (durEl) durEl.textContent = formatTime(dur);

    const epRow = document.getElementById("rm-ep-row");
    const isSeries = Boolean(s.is_player_open && s.active_item?.media_type === "series");
    if (epRow) {
      epRow.classList.toggle("hidden", !(isSeries || s.has_skip_intro));
      const prevBtn = document.getElementById("rm-btn-prev-ep");
      const nextBtn = document.getElementById("rm-btn-next-ep");
      const skipBtn = document.getElementById("rm-btn-skip-intro");
      if (prevBtn) {
        prevBtn.classList.toggle("hidden", !isSeries);
        prevBtn.disabled = !s.has_prev_ep;
      }
      if (nextBtn) {
        nextBtn.classList.toggle("hidden", !isSeries);
        nextBtn.disabled = !s.has_next_ep;
      }
      if (skipBtn) {
        skipBtn.classList.toggle("hidden", !s.has_skip_intro);
      }
    }

    const volPct = s.muted ? 0 : Math.round((Number(s.volume) || 0) * 100);
    const volSlider = document.getElementById("rm-vol-slider");
    const volVal = document.getElementById("rm-vol-val");
    const muteBtn = document.getElementById("rm-btn-mute");
    if (volSlider && document.activeElement !== volSlider) {
      volSlider.value = String(volPct);
    }
    if (volVal) volVal.textContent = `${volPct}%`;
    if (muteBtn) {
      muteBtn.innerHTML = iconSvg(volPct === 0 ? "volMute" : volPct < 50 ? "volLow" : "volHigh", 16);
    }

    const studioRow = document.getElementById("rm-studio-row");
    if (studioRow) {
      const hasSt = Array.isArray(s.studios) && s.studios.length > 0;
      studioRow.classList.toggle("hidden", !hasSt);
      if (hasSt) {
        const localizedStudios = s.studios.map((stIt) => ({
          ...stIt,
          label: translateStudioName(stIt.label || ""),
        }));
        syncSelectOptions(document.getElementById("rm-sel-studio"), localizedStudios, "id", "label", s.active_studio);
      }
    }

    const qualRow = document.getElementById("rm-quality-row");
    if (qualRow) {
      const hasQ = Array.isArray(s.qualities) && s.qualities.length > 0;
      qualRow.classList.toggle("hidden", !hasQ);
      if (hasQ) {
        syncSelectOptions(document.getElementById("rm-sel-quality"), s.qualities, "id", "label", s.active_quality);
      }
    }

    const subRow = document.getElementById("rm-sub-row");
    if (subRow) {
      const subsArr =
        Array.isArray(s.subtitles) && s.subtitles.length > 0
          ? s.subtitles.map((subIt) =>
              Number(subIt.index) === -1 &&
              (subIt.label === "Выключены" || subIt.label === "Off" || !subIt.label)
                ? { ...subIt, label: t("Выключены", "Off") }
                : subIt
            )
          : [{ index: -1, label: t("Выключены", "Off") }];
      syncSelectOptions(document.getElementById("rm-sel-sub"), subsArr, "index", "label", s.active_sub_idx);
    }
    const subValEl = document.getElementById("rm-sub-val");
    if (subValEl) {
      subValEl.textContent = formatSubtitleOffsetLabel(s.sub_offset_sec);
    }

    const ratingGroup = document.getElementById("rm-rating-group");
    if (ratingGroup) {
      const hasActiveTitle = Boolean(s.is_player_open && s.active_item);
      ratingGroup.classList.toggle("hidden", !hasActiveTitle);
      if (hasActiveTitle) {
        const it = s.active_item;
        const isSeriesItem = it.media_type === "series";
        const effScope = isSeriesItem ? (rState.rateScope === "series" ? "series" : "episode") : "movie";
        const scopeRow = document.getElementById("rm-rate-scope-row");
        const epScopeBtn = document.getElementById("rm-rate-scope-ep");
        const serScopeBtn = document.getElementById("rm-rate-scope-series");
        const rateTitleEl = document.getElementById("rm-lbl-rate-title");
        const rateBadgeEl = document.getElementById("rm-rate-current-badge");
        const clearRateBtn = document.getElementById("rm-btn-clear-rate");
        const watchToggleBtn = document.getElementById("rm-btn-watch-toggle");

        if (scopeRow) scopeRow.classList.toggle("hidden", !isSeriesItem);
        if (isSeriesItem) {
          if (epScopeBtn) {
            epScopeBtn.textContent = t(
              `Эта серия (S${it.season || 1}E${it.episode || 1})`,
              `This Episode (S${it.season || 1}E${it.episode || 1})`
            );
            epScopeBtn.classList.toggle("active", effScope === "episode");
            epScopeBtn.setAttribute("aria-pressed", effScope === "episode" ? "true" : "false");
          }
          if (serScopeBtn) {
            serScopeBtn.textContent = t("Весь сериал", "Entire Series");
            serScopeBtn.classList.toggle("active", effScope === "series");
            serScopeBtn.setAttribute("aria-pressed", effScope === "series" ? "true" : "false");
          }
        }

        const activeScore =
          effScope === "episode" ? Number(it.episode_rating) || 0 : Number(it.user_rating) || 0;
        if (rateTitleEl) {
          rateTitleEl.textContent = isSeriesItem
            ? effScope === "episode"
              ? t("Оценка серии", "Episode Rating")
              : t("Оценка сериала", "Series Rating")
            : t("Оценка фильма", "Movie Rating");
        }
        if (rateBadgeEl) {
          rateBadgeEl.textContent =
            activeScore > 0 ? `${activeScore}/10` : t("Не оценено", "Not rated");
          rateBadgeEl.classList.toggle("is-rated", activeScore > 0);
        }
        if (clearRateBtn) {
          clearRateBtn.textContent = t("Сбросить", "Clear");
          clearRateBtn.classList.toggle("hidden", activeScore <= 0);
        }
        if (watchToggleBtn) {
          const isWatchedNow = isSeriesItem ? Boolean(it.episode_watched) : Boolean(it.watched);
          watchToggleBtn.classList.toggle("is-watched", isWatchedNow);
          watchToggleBtn.setAttribute("aria-pressed", isWatchedNow ? "true" : "false");
          watchToggleBtn.textContent = isWatchedNow
            ? t("Просмотрено", "Watched")
            : isSeriesItem
            ? t("Отметить серию", "Mark Episode")
            : t("Отметить фильм", "Mark Movie");
        }
        document.querySelectorAll("#rm-rate-stars-grid .atv-remote-rate-btn").forEach((btn) => {
          const sc = parseInt(btn.getAttribute("data-rscore") || "0", 10);
          const isExact = activeScore > 0 && sc === activeScore;
          btn.classList.toggle("active", isExact);
          btn.classList.toggle("in-range", activeScore > 0 && sc < activeScore);
          btn.setAttribute("aria-pressed", isExact ? "true" : "false");
        });
      }
    }

    const syncTogglePressed = (id, active) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle("active", Boolean(active));
      el.setAttribute("aria-pressed", active ? "true" : "false");
    };
    syncTogglePressed("rm-btn-fs", s.desktop_mode === "fullscreen");
    syncTogglePressed("rm-btn-pip", s.desktop_mode === "pip");
    syncTogglePressed("rm-btn-tvmode", Boolean(s.tv_mode));
    syncTogglePressed("rm-dpad-tvtoggle", Boolean(s.tv_mode));
  };

  const renderRemoteCatalog = () => {
    const box = document.getElementById("rm-catalog-results");
    if (!box) return;
    const list = rState.searchQuery ? rState.searchResults || [] : [...rState.catalogCW, ...rState.catalogItems];
    if (!list.length) {
      box.innerHTML = `<div class="atv-remote-empty-sub">${escapeHtml(
        rState.catalogLoaded
          ? t("Ничего не найдено", "No titles found")
          : t("Загрузка каталога...", "Loading catalog...")
      )}</div>`;
      return;
    }
    box.innerHTML = "";
    const seen = new Set();
    list.forEach((it) => {
      const itemTitle = displayTitle(it) || it.title || it.orig_title || t("Без названия", "Untitled");
      const itemPoster = displayPoster(it) || it.poster || it.backdrop || "";
      const key = `${it.id || ""}:${itemTitle}:${it.season || 1}:${it.episode || 1}`;
      if (seen.has(key)) return;
      seen.add(key);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "atv-remote-cat-row";
      const epInfo =
        it.media_type === "series" && (it.season > 1 || it.episode > 1 || it.current_time > 0)
          ? ` · S${it.season || 1}E${it.episode || 1}`
          : "";
      card.innerHTML = `
        <img class="atv-remote-cat-poster" src="${escapeAttr(itemPoster)}" alt="" loading="lazy" referrerpolicy="no-referrer" />
        <div class="atv-remote-cat-info">
          <div class="atv-remote-cat-title">${escapeHtml(itemTitle)}</div>
          <div class="atv-remote-cat-sub">${escapeHtml(
            [
              it.year || "",
              it.media_type === "series" ? t("Сериал", "Series") : t("Фильм", "Movie"),
            ]
              .filter(Boolean)
              .join(" · ") + epInfo
          )}</div>
        </div>
        <span class="atv-remote-cat-play">${iconSvg("play", 13)}</span>
      `;
      attachSmartPosterFallback(card.querySelector(".atv-remote-cat-poster"), itemTitle, it.year || "", it.poster || itemPoster);
      card.onclick = () => {
        sendCmd("play_item", {
          item: it,
          season: it.season || 1,
          episode: it.episode || 1,
          resume_time: it.current_time || 0,
        });
        switchTab("player");
      };
      box.appendChild(card);
    });
  };

  let catalogReqSeq = 0;
  const loadRemoteCatalog = async (q = "") => {
    const reqSeq = ++catalogReqSeq;
    try {
      const params = new URLSearchParams({
        k: pairKey,
        lang: state.appLang || "ru",
      });
      if (q) params.set("q", q);
      const res = await fetch(`/api/remote/catalog?${params.toString()}`);
      if (!res.ok || reqSeq !== catalogReqSeq) return;
      const data = await res.json();
      if (reqSeq !== catalogReqSeq) return;
      rState.catalogLoaded = true;
      if (q) {
        rState.searchResults = Array.isArray(data.items) ? data.items : [];
      } else {
        rState.catalogCW = Array.isArray(data.continue_watching) ? data.continue_watching : [];
        rState.catalogItems = Array.isArray(data.items) ? data.items : [];
      }
      renderRemoteCatalog();
    } catch (_) {}
  };

  const switchTab = (tabName) => {
    rState.activeTab = tabName;
    shell.querySelectorAll(".atv-remote-tab").forEach((b) => {
      const isSelected = b.dataset.rtab === tabName;
      b.classList.toggle("active", isSelected);
      b.setAttribute("aria-selected", isSelected ? "true" : "false");
    });
    document.getElementById("rm-pane-player")?.classList.toggle("hidden", tabName !== "player");
    document.getElementById("rm-pane-dpad")?.classList.toggle("hidden", tabName !== "dpad");
    document.getElementById("rm-pane-catalog")?.classList.toggle("hidden", tabName !== "catalog");
    if (tabName === "catalog" && !rState.catalogLoaded) {
      loadRemoteCatalog("");
    }
  };

  shell.querySelectorAll(".atv-remote-tab").forEach((b) => {
    b.addEventListener("click", () => switchTab(b.dataset.rtab || "player"));
  });

  document.getElementById("rm-btn-play")?.addEventListener("click", () => sendCmd("toggle_play"));
  document.getElementById("rm-btn-back10")?.addEventListener("click", () => sendCmd("seek_rel", { delta: -10 }));
  document.getElementById("rm-btn-fwd10")?.addEventListener("click", () => sendCmd("seek_rel", { delta: 10 }));
  document.getElementById("rm-btn-prev-ep")?.addEventListener("click", () => sendCmd("prev_ep"));
  document.getElementById("rm-btn-next-ep")?.addEventListener("click", () => sendCmd("next_ep"));
  document.getElementById("rm-btn-skip-intro")?.addEventListener("click", () => sendCmd("skip_intro"));
  document.getElementById("rm-btn-close-pc-player")?.addEventListener("click", () => sendCmd("close_player"));

  const scrubberEl = document.getElementById("rm-scrubber");
  if (scrubberEl) {
    scrubberEl.addEventListener("input", () => {
      rState.scrubbing = true;
      const dur = Math.max(0, Number(rState.snap.duration) || 0);
      const target = (Number(scrubberEl.value) / 1000) * dur;
      const curEl = document.getElementById("rm-time-cur");
      if (curEl) curEl.textContent = formatTime(target);
    });
    scrubberEl.addEventListener("change", () => {
      const dur = Math.max(0, Number(rState.snap.duration) || 0);
      const target = (Number(scrubberEl.value) / 1000) * dur;
      rState.scrubbing = false;
      sendCmd("seek_to", { time: Math.round(target * 10) / 10 });
    });
    const cancelScrubbing = () => {
      if (!rState.scrubbing) return;
      rState.scrubbing = false;
    };
    scrubberEl.addEventListener("pointercancel", cancelScrubbing);
    scrubberEl.addEventListener("touchcancel", cancelScrubbing);
    scrubberEl.addEventListener("blur", cancelScrubbing);
  }

  let volTimer = null;
  const volSliderEl = document.getElementById("rm-vol-slider");
  if (volSliderEl) {
    volSliderEl.addEventListener("input", () => {
      const pct = Number(volSliderEl.value) || 0;
      const valEl = document.getElementById("rm-vol-val");
      if (valEl) valEl.textContent = `${pct}%`;
      if (volTimer) clearTimeout(volTimer);
      volTimer = setTimeout(() => {
        sendCmd("set_volume", { volume: pct / 100 });
      }, 90);
    });
  }
  document.getElementById("rm-btn-mute")?.addEventListener("click", () => sendCmd("toggle_mute"));

  document.getElementById("rm-sel-studio")?.addEventListener("change", (e) => {
    sendCmd("set_studio", { id: e.target.value });
  });
  document.getElementById("rm-sel-quality")?.addEventListener("change", (e) => {
    sendCmd("set_quality", { id: e.target.value });
  });
  document.getElementById("rm-sel-sub")?.addEventListener("change", (e) => {
    sendCmd("set_subtitle", { index: parseInt(e.target.value, 10) });
  });
  document.getElementById("rm-sub-minus")?.addEventListener("click", () => sendCmd("sub_offset", { delta: -0.25 }));
  document.getElementById("rm-sub-val")?.addEventListener("click", () => sendCmd("sub_offset", { reset: true }));
  document.getElementById("rm-sub-plus")?.addEventListener("click", () => sendCmd("sub_offset", { delta: 0.25 }));

  document.getElementById("rm-rate-scope-ep")?.addEventListener("click", () => {
    rState.rateScope = "episode";
    renderRemoteUI();
  });
  document.getElementById("rm-rate-scope-series")?.addEventListener("click", () => {
    rState.rateScope = "series";
    renderRemoteUI();
  });
  document.querySelectorAll("#rm-rate-stars-grid .atv-remote-rate-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const score = parseInt(btn.getAttribute("data-rscore") || "0", 10);
      if (score <= 0 || !rState.snap.active_item) return;
      const it = rState.snap.active_item;
      const scope = it.media_type === "series" ? (rState.rateScope === "series" ? "series" : "episode") : "movie";
      if (scope === "episode") {
        it.episode_rating = score;
        it.episode_watched = true;
      } else {
        it.user_rating = score;
        if (it.media_type !== "series") it.watched = true;
      }
      renderRemoteUI();
      sendCmd("rate_active", {
        scope,
        score,
        season: it.season || 1,
        episode: it.episode || 1,
      });
    });
  });
  document.getElementById("rm-btn-clear-rate")?.addEventListener("click", () => {
    if (!rState.snap.active_item) return;
    const it = rState.snap.active_item;
    const scope = it.media_type === "series" ? (rState.rateScope === "series" ? "series" : "episode") : "movie";
    if (scope === "episode") {
      it.episode_rating = 0;
    } else {
      it.user_rating = 0;
    }
    renderRemoteUI();
    sendCmd("rate_active", {
      scope,
      score: 0,
      clear: true,
      season: it.season || 1,
      episode: it.episode || 1,
    });
  });
  document.getElementById("rm-btn-watch-toggle")?.addEventListener("click", () => {
    if (!rState.snap.active_item) return;
    const it = rState.snap.active_item;
    if (it.media_type === "series") {
      it.episode_watched = !it.episode_watched;
    } else {
      it.watched = !it.watched;
    }
    renderRemoteUI();
    sendCmd("toggle_watched");
  });

  document.getElementById("rm-btn-fs")?.addEventListener("click", () => sendCmd("toggle_fullscreen"));
  document.getElementById("rm-btn-pip")?.addEventListener("click", () => sendCmd("toggle_pip"));
  document.getElementById("rm-btn-tvmode")?.addEventListener("click", () => sendCmd("toggle_tv_mode"));

  shell.querySelectorAll("[data-dpad]").forEach((btn) => {
    btn.addEventListener("click", () => sendCmd("dpad", { key: btn.dataset.dpad }));
  });
  document.getElementById("rm-dpad-playpause")?.addEventListener("click", () => sendCmd("toggle_play"));
  document.getElementById("rm-dpad-tvtoggle")?.addEventListener("click", () => sendCmd("toggle_tv_mode"));

  const modeTouchpadBtn = document.getElementById("rm-mode-touchpad");
  const modeButtonsBtn = document.getElementById("rm-mode-buttons");
  const touchpadBox = document.getElementById("rm-touchpad-box");
  const buttonsBox = document.getElementById("rm-buttons-box");

  if (modeTouchpadBtn && modeButtonsBtn) {
    modeTouchpadBtn.onclick = () => {
      modeTouchpadBtn.classList.add("active");
      modeTouchpadBtn.setAttribute("aria-pressed", "true");
      modeButtonsBtn.classList.remove("active");
      modeButtonsBtn.setAttribute("aria-pressed", "false");
      touchpadBox?.classList.remove("hidden");
      buttonsBox?.classList.add("hidden");
    };
    modeButtonsBtn.onclick = () => {
      modeButtonsBtn.classList.add("active");
      modeButtonsBtn.setAttribute("aria-pressed", "true");
      modeTouchpadBtn.classList.remove("active");
      modeTouchpadBtn.setAttribute("aria-pressed", "false");
      buttonsBox?.classList.remove("hidden");
      touchpadBox?.classList.add("hidden");
    };
  }

  const surface = document.getElementById("rm-touchpad-surface");
  const puck = document.getElementById("rm-touchpad-puck");
  if (surface) {
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let isDown = false;
    let hasMoved = false;
    let touchStartTime = 0;

    const onPointerDown = (e) => {
      isDown = true;
      hasMoved = false;
      touchStartTime = Date.now();
      const pt = e.touches ? e.touches[0] : e;
      startX = pt.clientX;
      startY = pt.clientY;
      lastX = startX;
      lastY = startY;
      if (surface.setPointerCapture && e.pointerId != null) {
        try {
          surface.setPointerCapture(e.pointerId);
        } catch (_) {}
      }
    };

    const onPointerMove = (e) => {
      if (!isDown) return;
      const pt = e.touches ? e.touches[0] : e;
      lastX = pt.clientX;
      lastY = pt.clientY;
      const dx = pt.clientX - startX;
      const dy = pt.clientY - startY;
      const dist = Math.hypot(dx, dy);
      if (dist > 10) hasMoved = true;

      const maxR = 36;
      const clampedDist = Math.min(maxR, dist);
      const angle = Math.atan2(dy, dx);
      const px = Math.cos(angle) * clampedDist;
      const py = Math.sin(angle) * clampedDist;
      if (puck) {
        puck.style.transform = `translate(${px}px, ${py}px)`;
      }
    };

    const onPointerCancel = () => {
      if (!isDown) return;
      isDown = false;
      hasMoved = false;
      if (puck) {
        puck.style.transform = "translate(0, 0)";
      }
    };

    const onPointerUp = (e) => {
      if (!isDown) return;
      isDown = false;
      const elapsed = Date.now() - touchStartTime;
      const pt = e.changedTouches ? e.changedTouches[0] : (e.touches ? e.touches[0] : e);
      const totalDx = (pt ? pt.clientX : lastX) - startX;
      const totalDy = (pt ? pt.clientY : lastY) - startY;
      const totalDist = Math.hypot(totalDx, totalDy);

      if (puck) {
        puck.style.transform = "translate(0, 0)";
      }

      if (!hasMoved || (totalDist < 14 && elapsed < 320)) {
        if (rState.snap?.is_player_open) {
          sendCmd("toggle_play");
        } else {
          sendCmd("dpad", { key: "ok" });
        }
        return;
      }

      if (totalDist >= 22) {
        const isHorizontal = Math.abs(totalDx) > Math.abs(totalDy);
        if (isHorizontal) {
          const isRight = totalDx > 0;
          if (rState.snap?.is_player_open) {
            sendCmd("seek_rel", { delta: isRight ? 10 : -10 });
          } else {
            sendCmd("dpad", { key: isRight ? "right" : "left" });
          }
        } else {
          const isDownSwipe = totalDy > 0;
          if (rState.snap?.is_player_open) {
            const rawVol = Number(rState.snap.volume);
            const curVol = Number.isFinite(rawVol) ? rawVol : 1;
            const nextVol = Math.max(0, Math.min(1, curVol + (isDownSwipe ? -0.1 : 0.1)));
            sendCmd("set_volume", { volume: nextVol });
          } else {
            sendCmd("dpad", { key: isDownSwipe ? "down" : "up" });
          }
        }
      }
    };

    surface.addEventListener("pointerdown", onPointerDown);
    surface.addEventListener("pointermove", onPointerMove);
    surface.addEventListener("pointerup", onPointerUp);
    surface.addEventListener("pointercancel", onPointerCancel);
    surface.addEventListener("lostpointercapture", onPointerCancel);
  }

  let searchDebounce = null;
  const searchInp = document.getElementById("rm-catalog-search");
  if (searchInp) {
    searchInp.addEventListener("input", () => {
      rState.searchQuery = String(searchInp.value || "").trim();
      if (searchDebounce) clearTimeout(searchDebounce);
      if (!rState.searchQuery) {
        rState.searchResults = null;
        renderRemoteCatalog();
        return;
      }
      searchDebounce = setTimeout(() => {
        loadRemoteCatalog(rState.searchQuery);
      }, 280);
    });
  }

  setInterval(() => {
    if (rState.snap.playing && !rState.scrubbing) {
      renderRemoteUI();
    }
  }, 500);

  sendCmd("ping_desktop");

  const syncRemoteLanguageWithDesktop = (rawLang) => {
    const normLang = String(rawLang || "").trim().toLowerCase().startsWith("en") ? "en" : "ru";
    if (state.appLang === normLang) return;
    state.appLang = normLang;
    saveUiPrefs({ appLang: normLang });
    localizeRemoteShellStaticDOM();
    if (rState.catalogLoaded || rState.activeTab === "catalog") {
      loadRemoteCatalog(rState.searchQuery);
    } else {
      renderRemoteCatalog();
    }
  };

  const pollStateLoop = async () => {
    while (true) {
      try {
        const params = new URLSearchParams({
          k: pairKey,
          since: String(rState.lastSeq),
          timeout: "14",
          cid: clientId,
          device: _detectPhoneDeviceLabel(),
        });
        const res = await fetch(`/api/remote/state?${params.toString()}`);
        if (res.status === 403) {
          rState.authFailed = true;
          renderRemoteUI();
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        if (res.ok) {
          const data = await res.json();
          rState.authFailed = false;
          rState.desktopOnline = Boolean(data.desktop_online);
          rState.lastSeq = Number(data.seq || data.state_version || rState.lastSeq);
          rState.lastSyncPerfMs = performance.now();
          const prevProfileId = rState.snap?.active_profile_id || "main";
          if (data.state && typeof data.state === "object") {
            rState.snap = { ...rState.snap, ...data.state };
          }
          const nextProfileId = rState.snap?.active_profile_id || "main";
          if (nextProfileId !== prevProfileId && (rState.catalogLoaded || rState.activeTab === "catalog")) {
            loadRemoteCatalog(rState.searchQuery);
          }
          const srvLang = data.app_lang || rState.snap?.app_lang;
          if (srvLang) {
            syncRemoteLanguageWithDesktop(srvLang);
          }
          renderRemoteUI();
        } else {
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (_) {
        rState.desktopOnline = false;
        renderRemoteUI();
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };
  localizeRemoteShellStaticDOM();
  initCustomSelects();
  renderRemoteUI();
  pollStateLoop();
}
