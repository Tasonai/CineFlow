import { state } from "./state.js?v=20261105v5";
import {
  displayBackdrop,
  displayDescription,
  displayPoster,
  displayTitle,
  hasCyrillicText,
  isEn,
  mergeIncomingItemGenres,
  secondaryTitle,
  t,
  translateSizeLabel,
  translateStudioName,
} from "./i18n.js?v=20261105v5";
import {
  copyTextToClipboard,
  escapeAttr,
  escapeHtml,
  findAllOfflineDownloadsForTitle,
  findOfflineDownloadForTitle,
  formatDurationLabel,
  formatTime,
  getEpisodeProgress,
  iconSvg,
  initCustomSelects,
  showToast,
  showVideoOsd,
  supportsNativePiP,
  syncCustomSelect,
} from "./utils.js?v=20261105v5";
import {
  applyAudioBoostToVideo,
  getPlayerPrefs,
  isVideoInPiP,
  pickBestQualityKey,
  pickPreferredSubtitleIndex,
  savePlayerPrefs,
  startAmbilightLoop,
  stopAmbilightLoop,
} from "./audio-dsp.js?v=20261105v5";
import {
  getDefaultPlayableSourceTab,
  getPreferredStudioForItem,
  isEpisodeWatched,
  isServiceEnabled,
  loadCatalog,
  savePreferredStudioForItem,
} from "./catalog.js?v=20261105v5";
import { renderModalCastSection } from "./modals.js?v=20261105v5";
import {
  activateSelectedSubtitleTrack,
  buildRemuxSubtitlesList,
  clearCustomSubtitleOverlay,
  mergeCustomExternalSubtitles,
  populateSubtitlesSelector,
  refreshRemuxSubtitleTracks,
} from "./subtitles.js?v=20261105v5";
import {
  clearVideoStallWatchdog,
  getVideoForwardBufferSec,
} from "./player-watchdog.js?v=20261105v5";
import {
  buildRemuxStreamEndpoint,
  formatAudioOffsetLabel,
  getEffectivePlaybackTiming,
  prepareRemuxAudioSwitch,
  syncAudioOffsetUI,
} from "./player-remux.js?v=20261105v5";
import {
  closeAllVcPopovers,
  isStageFullscreen,
  syncCustomVideoControlsUI,
  syncVcPopoverOpenClass,
  toggleStageFullscreen,
} from "./player-ui-controls.js?v=20261105v5";
import { getNextEpisodeCoords } from "./player-autoplay.js?v=20261105v5";
import { updateMiniPlayerTitle } from "./player-pip-dock.js?v=20261105v5";
import {
  populateSeasonEpisodeSelectors,
  updateCurrentEpisodeBar,
} from "./player-seasons.js?v=20261105v5";
import {
  OFFICIAL_STREAMING_SERVICES,
  _mergeItemProviders,
  getOfficialServiceTargetUrl,
  renderModalGenresAndSubheader,
  renderModalProvidersSidebar,
  syncMediaSessionMetadata,
} from "./player-meta.js?v=20261105v5";
import {
  getDetectedCreditsStartSec,
  loadSkipIntroSegments,
} from "./player-intro-credits.js?v=20261105v5";
import { syncCustomControlPopovers } from "./player-ui-controls.js?v=20261105v5";
import {
  playVideoUrl,
  syncPlayerOfflineControlsUI,
} from "./player.js?v=20261105v5";

export function isHdRezkaStreamDeadOrExpired(video) {
  if (!video || state.activeSourceTab !== "hdrezka" || state.remuxMeta?.active) {
    return false;
  }
  const errBox = document.getElementById("video-error-state");
  if (errBox && !errBox.classList.contains("hidden")) {
    return true;
  }
  if (video.error && video.error.code !== 1) {
    return true;
  }
  if (video.networkState === 3) {
    return true;
  }
  const ageMs = state.streamMintedAt > 0 ? Date.now() - state.streamMintedAt : 0;
  if (video.readyState === 0 && ageMs > 12 * 60 * 1000) {
    return true;
  }
  return false;
}

export function _localizeOfflineSubLabel(rawLang) {
  const s = String(rawLang || "").trim() || "Subtitles";
  if (isEn()) {
    return s
      .replace(/^Русский$/i, "Russian")
      .replace(/^Українська$/i, "Ukrainian")
      .replace(/^Английский$/i, "English")
      .replace(/^Субтитры\s*#/i, "Subtitles #");
  }
  return s
    .replace(/^Russian$/i, "Русский")
    .replace(/^Ukrainian$/i, "Українська")
    .replace(/^English$/i, "Английский")
    .replace(/^Subtitles\s*#/i, "Субтитры #");
}

export async function loadOfflineStreamForActiveTitle(startSec = 0, explicitDlItem = null) {
  if (!state.activeItem || !state.isPlayerOpen) return false;
  const isSeries = state.activeItem.media_type === "series";
  const variants = findAllOfflineDownloadsForTitle(
    state.activeItem,
    isSeries ? state.activeSeason : null,
    isSeries ? state.activeEpisode : null,
    ["completed"]
  );
  const dlItem =
    explicitDlItem ||
    variants.find((v) => v.download_id === state.activeOfflineDownloadId) ||
    variants[0] ||
    null;

  if (!dlItem || !dlItem.play_url) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      showVideoStreamError(
        t("Эта серия не сохранена офлайн", "This episode is not saved offline"),
        t(
          "Выберите сохранённую серию в списке офлайн-загрузок или подключитесь к Wi-Fi",
          "Pick a downloaded episode in Offline Downloads or connect to Wi-Fi"
        )
      );
      return false;
    }
    showToast(
      t(
        "Эта серия не сохранена офлайн — включаем онлайн-поток",
        "Episode is not saved offline — switching to online stream"
      )
    );
    await switchSourceTab("hdrezka", startSec);
    return false;
  }

  const allChoices = variants.length > 0 ? variants : [dlItem];
  state.isPlayingOfflineDownload = true;
  state.activeOfflineDownloadId = dlItem.download_id;
  const qualKey = dlItem.quality || "1080p";
  const rawStudio = dlItem.studio || "HDRezka";
  const studioLabel = `${translateStudioName(rawStudio)}${allChoices.length > 1 ? ` · ${qualKey}` : ""} (${t("Офлайн", "Offline")})`;
  state.activeStudioName = studioLabel;
  state.activeStudioId = dlItem.download_id || "offline";
  state.qualities = { [qualKey]: dlItem.play_url };

  const studioSel = document.getElementById("select-studio");
  if (studioSel) {
    studioSel.innerHTML = "";
    allChoices.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.download_id || "offline";
      const vRaw = v.studio || "HDRezka";
      const vQual = v.quality || "1080p";
      opt.dataset.rawName = vRaw;
      opt.dataset.qual = vQual;
      opt.textContent = `${translateStudioName(vRaw)}${allChoices.length > 1 ? ` · ${vQual}` : ""} (${t("Офлайн", "Offline")})`;
      if (v.download_id === dlItem.download_id) opt.selected = true;
      studioSel.appendChild(opt);
    });
    studioSel.disabled = allChoices.length <= 1;
    syncCustomSelect(studioSel);
  }
  const qualSel = document.getElementById("select-quality");
  if (qualSel) {
    qualSel.innerHTML = `<option value="${escapeAttr(qualKey)}" selected>${escapeHtml(qualKey)}</option>`;
    qualSel.disabled = true;
    syncCustomSelect(qualSel);
  }

  const localSubs = Array.isArray(dlItem.subtitles)
    ? dlItem.subtitles.map((s) => ({
        rawLang: s.lang || "Subtitles",
        lang: _localizeOfflineSubLabel(s.lang || "Subtitles"),
        url: s.url,
        direct_vtt: true,
      }))
    : [];
  state.subtitles = mergeCustomExternalSubtitles(localSubs);
  const prefs = getPlayerPrefs();
  state.activeSubtitleIndex = pickPreferredSubtitleIndex(state.subtitles, prefs.preferredSubtitleLang || "off");
  populateSubtitlesSelector(state.subtitles);
  syncCustomControlPopovers();
  activateSelectedSubtitleTrack();
  syncDownloadButtonVisibility();
  playVideoUrl(dlItem.play_url, startSec, state.playerSessionId);
  syncCustomVideoControlsUI(true);
  syncMediaSessionMetadata();
  return true;
}

export function syncDownloadButtonVisibility() {
  syncPlayerOfflineControlsUI();
  const dlBtn = document.getElementById("btn-download-stream");
  if (!dlBtn) return;
  const tab = state.activeSourceTab;
  if (tab === "hdrezka" || tab === "offline") {
    dlBtn.classList.remove("hidden");
    return;
  }
  if (tab === "stremio" || tab === "backup4k") {
    const hasDownloadable = Boolean(
      (state.remuxMeta?.active && state.remuxMeta.rawSourceUrl) ||
        (/^https?:\/\//i.test(state.currentStreamUrl || "") &&
          !String(state.currentStreamUrl || "").includes(".m3u8"))
    );
    dlBtn.classList.toggle("hidden", !hasDownloadable);
    return;
  }
  dlBtn.classList.add("hidden");
}

// Hardware video playback quality & watchdog subsystems (getVideoPlaybackQuality, requestVideoFrameCallback)
// are extracted to ./player-watchdog.js and re-exported above.

export function abortActiveVideoListeners() {
  clearVideoStallWatchdog();
  state.videoLoadToken = (state.videoLoadToken || 0) + 1;
  if (state.videoLoadAbort) {
    try {
      state.videoLoadAbort.abort();
    } catch (err) { window.logDebug?.("PlayerStreams", err); }
    state.videoLoadAbort = null;
  }
}
export async function switchSourceTab(tabName, resumeTime = null, options = {}) {
  if (tabName === "official") {
    tabName = getDefaultPlayableSourceTab();
  }
  if (OFFICIAL_STREAMING_SERVICES.has(tabName)) {
    const isAvail = Boolean(
      state.activeItem &&
      Array.isArray(state.activeItem.providers) &&
      state.activeItem.providers.some((p) => p && p.id === tabName && p.available)
    );
    if (!isAvail) {
      tabName = getDefaultPlayableSourceTab();
    }
  }
  const isOfficialServiceTab = OFFICIAL_STREAMING_SERVICES.has(tabName);
  const video = document.getElementById("native-video");
  let effectiveResumeTime = 0;
  const effTiming = getEffectivePlaybackTiming(video);
  if (typeof resumeTime === "number" && Number.isFinite(resumeTime) && resumeTime > 0) {
    effectiveResumeTime = resumeTime;
  } else if (effTiming.cur > 5) {
    effectiveResumeTime = effTiming.cur;
  } else if (state.activeItem?.media_type === "series") {
    const epProg = getEpisodeProgress(state.activeItem, state.activeSeason, state.activeEpisode);
    if (
      epProg &&
      epProg.current_time > 10 &&
      epProg.pct < 95 &&
      !isEpisodeWatched(state.activeItem, state.activeSeason, state.activeEpisode)
    ) {
      effectiveResumeTime = epProg.current_time;
    }
  } else if (state.activeItem) {
    const cwMatch = (state.continueWatching || []).find((c) => c.id === state.activeItem.id);
    if (cwMatch && Number(cwMatch.current_time) > 10 && Number(cwMatch.progress || 0) < 0.95) {
      effectiveResumeTime = Number(cwMatch.current_time);
    } else {
      const localMovieProg = getEpisodeProgress(state.activeItem, state.activeSeason, state.activeEpisode);
      if (localMovieProg && localMovieProg.current_time > 10 && localMovieProg.pct < 95 && !state.activeItem.kinorium?.watched) {
        effectiveResumeTime = localMovieProg.current_time;
      }
    }
  }

  const prevTab = state.activeSourceTab;
  state.activeSourceTab = tabName;
  if (tabName !== "offline") {
    state.isPlayingOfflineDownload = false;
    state.activeOfflineDownloadId = "";
    const studioSel = document.getElementById("select-studio");
    if (studioSel && studioSel.disabled) {
      studioSel.disabled = false;
      syncCustomSelect(studioSel);
    }
    const qualSel = document.getElementById("select-quality");
    if (qualSel && qualSel.disabled) {
      qualSel.disabled = false;
      syncCustomSelect(qualSel);
    }
  }
  if (prevTab !== tabName && ["hdrezka", "stremio", "backup4k"].includes(tabName)) {
    savePlayerPrefs({ preferredSourceTab: tabName });
  }
  if (tabName !== "hdrezka" && tabName !== "offline" && isStageFullscreen()) {
    toggleStageFullscreen();
  }
  document.querySelectorAll(".source-tab").forEach((btn) => {
    const isSelected = btn.dataset.tab === tabName;
    btn.classList.toggle("active", isSelected);
    btn.setAttribute("aria-selected", isSelected ? "true" : "false");
  });

  document.getElementById("player-gear-popover")?.classList.add("hidden");
  document.getElementById("btn-player-gear")?.classList.remove("active");
  document.getElementById("video-error-state")?.classList.add("hidden");
  closeAllVcPopovers();
  syncVcPopoverOpenClass();
  document.getElementById("rezka-controls-bar")?.classList.add("hidden");
  document.getElementById("stremio-streams-panel")?.classList.toggle("hidden", tabName !== "stremio");
  document.getElementById("backup-releases-panel")?.classList.toggle("hidden", tabName !== "backup4k");
  document.getElementById("trailer-panel")?.classList.toggle("hidden", tabName !== "trailer");
  syncDownloadButtonVisibility();
  const customVc = document.getElementById("atv-custom-controls");
  if (customVc) {
    const showVc = tabName === "hdrezka" || tabName === "stremio" || tabName === "backup4k" || tabName === "offline";
    customVc.classList.toggle("hidden", !showVc);
  }
  syncCustomControlPopovers();
  const bottomEpsPanel = document.getElementById("episodes-bottom-panel");
  const showEps =
    state.activeItem?.media_type === "series" &&
    (tabName === "hdrezka" || tabName === "stremio" || tabName === "backup4k" || tabName === "offline");
  if (bottomEpsPanel) {
    bottomEpsPanel.classList.toggle("hidden", !showEps);
  }
  document.getElementById("current-episode-bar")?.classList.toggle("hidden", !showEps);

  if (state.activeItem) {
    renderModalProvidersSidebar(state.activeItem);
  }

  // Stop previous video/HLS stream cleanly when switching source tabs so background audio never leaks
  // and detach old error listeners BEFORE clearing src so MEDIA_ERR_SRC_NOT_SUPPORTED never flashes!
  if (prevTab !== tabName || tabName !== "hdrezka") {
    state.remuxMeta = null;
    state.activeStremioStreamKey = "";
    state.active4kReleaseKey = "";
    state.active4kReleaseUrl = "";
    state.active4kRelease = null;
    abortActiveVideoListeners();
    [
      "streamAbortController",
      "backup4kAbortController",
      "stremioResolveAbortController",
      "remuxProbeAbortController",
      "trailerAbortController",
    ].forEach((ctrlKey) => {
      if (state[ctrlKey]) {
        try {
          state[ctrlKey].abort();
        } catch (err) { window.logDebug?.("PlayerStreams", err); }
        state[ctrlKey] = null;
      }
    });
    if (state.hlsInstance) {
      try {
        state.hlsInstance.destroy();
      } catch (err) { window.logDebug?.("PlayerStreams", err); }
      state.hlsInstance = null;
    }
    if (video) {
      video.onloadedmetadata = null;
      try {
        video.pause();
      } catch (err) { window.logDebug?.("PlayerStreams", err); }
      video.querySelectorAll("track").forEach((tr) => tr.remove());
      if (!isVideoInPiP(video)) {
        video.removeAttribute("src");
        try {
          video.load();
        } catch (err) { window.logDebug?.("PlayerStreams", err); }
      }
    }
    clearCustomSubtitleOverlay(true);
    syncDownloadButtonVisibility();
    document.getElementById("video-loader")?.classList.add("hidden");
  }

  const trailerStage = document.getElementById("trailer-stage-box");
  if (tabName !== "trailer" && !isOfficialServiceTab && trailerStage) {
    trailerStage.innerHTML = "";
    trailerStage.classList.add("hidden");
  }

  if (tabName === "trailer" || isOfficialServiceTab) {
    stopAmbilightLoop(true);
  } else {
    startAmbilightLoop();
  }

  if (tabName === "hdrezka") {
    await loadHDRezkaStream(effectiveResumeTime);
  } else if (tabName === "offline") {
    await loadOfflineStreamForActiveTitle(effectiveResumeTime);
  } else if (tabName === "stremio") {
    await loadStremioStreams(effectiveResumeTime);
  } else if (tabName === "backup4k") {
    await loadBackup4KReleases(effectiveResumeTime);
  } else if (tabName === "trailer") {
    await loadTrailerTab();
  } else if (isOfficialServiceTab) {
    await loadOfficialServiceTab(tabName, options);
  }
}

function _isDirectOfficialOfferUrl(urlStr) {
  const u = String(urlStr || "").trim();
  if (!u) return false;
  if (u.includes("/search?") || u.includes("/wyszukiwa") || u.endsWith("/search")) return false;
  const genericRoots = new Set([
    "https://player.pl",
    "https://www.netflix.com",
    "https://tv.apple.com/pl",
    "https://tv.apple.com/us",
    "https://www.primevideo.com",
    "https://www.disneyplus.com",
    "https://play.max.com",
    "https://www.justwatch.com/pl",
  ]);
  return !genericRoots.has(u.replace(/\/+$/, ""));
}

export async function loadOfficialServiceTab(serviceId, options = {}) {
  const item = state.activeItem;
  const trailerStage = document.getElementById("trailer-stage-box");
  if (!item || !trailerStage) return;
  const sessionId = state.playerSessionId;

  const srvNames = {
    appletv: "Apple TV+",
    netflix: "Netflix",
    prime: "Prime Video",
    disney: "Disney+",
    max: "Max",
    playerpl: "Player.pl",
  };
  const serviceName =
    state.providersMeta?.[serviceId]?.name ||
    state.integrations?.[serviceId]?.name ||
    srvNames[serviceId] ||
    serviceId;

  const renderStage = (resolvedUrl, isDirect, qualityText = "", isResolving = false) => {
    if (!state.isPlayerOpen || state.playerSessionId !== sessionId || state.activeSourceTab !== serviceId) {
      return;
    }
    const bgUrl = displayBackdrop(item) || displayPoster(item) || "";
    const titleStr = displayTitle(item);
    const subStr = [secondaryTitle(item), item.year].filter(Boolean).join(" · ");
    const statusBadgeText = isResolving
      ? t(`Поиск прямой ссылки на ${serviceName}...`, `Finding direct link on ${serviceName}...`)
      : isDirect
      ? qualityText
        ? `${serviceName} · ${qualityText}`
        : t(`Доступно в подписке ${serviceName}`, `Available on ${serviceName}`)
      : t(`Переход в каталог ${serviceName}`, `Open in ${serviceName} catalog`);
    const fallbackInternalTab = getDefaultPlayableSourceTab();
    const fallbackTabNames = {
      hdrezka: "HDRezka",
      stremio: "Stremio",
      backup4k: "4K",
    };
    const internalLabel = fallbackTabNames[fallbackInternalTab] || "HDRezka";

    trailerStage.classList.remove("hidden");
    trailerStage.innerHTML = `
      <div class="atv-official-stage" style="${bgUrl ? `--official-bg: url('${escapeAttr(bgUrl)}')` : ""}">
        <div class="atv-official-stage-backdrop"></div>
        <div class="atv-official-stage-card">
          <div class="atv-official-stage-badges">
            <span class="atv-official-srv-pill">${escapeHtml(serviceName)}</span>
            <span class="atv-official-status-pill${isDirect ? " is-direct" : ""}">${escapeHtml(statusBadgeText)}</span>
          </div>
          <h3 class="atv-official-stage-title">${escapeHtml(titleStr)}</h3>
          ${subStr ? `<div class="atv-official-stage-sub">${escapeHtml(subStr)}</div>` : ""}
          <p class="atv-official-stage-desc">${escapeHtml(
            isDirect
              ? t(
                  `Тайтл найден в каталоге ${serviceName}. Нажмите кнопку ниже, чтобы запустить воспроизведение в официальном плеере ${serviceName}.`,
                  `This title is available on ${serviceName}. Click below to start playback in the official ${serviceName} player.`
                )
              : t(
                  `Откройте ${serviceName} для просмотра или выберите встроенный поток (${internalLabel}) в верхней панели плеера.`,
                  `Open ${serviceName} to watch, or switch to the built-in stream (${internalLabel}) in the top bar.`
                )
          )}</p>
          <div class="atv-official-stage-actions">
            <button type="button" class="atv-btn-primary atv-official-watch-btn" id="btn-official-stage-watch">
              ${iconSvg("play", 14)}
              <span>${escapeHtml(t(`Смотреть на ${serviceName}`, `Watch on ${serviceName}`))}</span>
              ${iconSvg("external", 12)}
            </button>
            ${
              fallbackInternalTab !== "trailer"
                ? `<button type="button" class="atv-btn-secondary atv-official-internal-btn" id="btn-official-stage-internal">
                    <span>${escapeHtml(
                      t(`Встроенный плеер (${internalLabel})`, `Built-in player (${internalLabel})`)
                    )}</span>
                  </button>`
                : ""
            }
          </div>
        </div>
      </div>
    `;

    const watchBtn = document.getElementById("btn-official-stage-watch");
    if (watchBtn) {
      watchBtn.onclick = () => {
        const finalTarget = getOfficialServiceTargetUrl(serviceId, item);
        window.open(finalTarget, "_blank", "noopener,noreferrer,width=1280,height=760");
      };
    }
    const internalBtn = document.getElementById("btn-official-stage-internal");
    if (internalBtn) {
      internalBtn.onclick = () => {
        switchSourceTab(fallbackInternalTab);
      };
    }
  };

  const existingOffer = (item.providers || []).find((p) => p && p.id === serviceId && p.available);
  const initialUrl = getOfficialServiceTargetUrl(serviceId, item);
  const alreadyDirect = Boolean(existingOffer && _isDirectOfficialOfferUrl(existingOffer.url));

  renderStage(initialUrl, alreadyDirect, existingOffer?.quality || "", !alreadyDirect);

  if (!alreadyDirect) {
    try {
      const params = new URLSearchParams({
        service: serviceId,
        title: item.title || "",
        orig_title: item.orig_title || "",
        year: String(item.year || ""),
        media_type: item.media_type || "",
      });
      const res = await fetch(`/api/provider-link?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!state.isPlayerOpen || state.playerSessionId !== sessionId) return;
      if (Array.isArray(data.providers) && data.providers.length > 0) {
        _mergeItemProviders(item, data.providers);
        renderModalProvidersSidebar(item);
      }
      if (state.activeSourceTab === serviceId) {
        const updatedOffer = (item.providers || []).find((p) => p && p.id === serviceId && p.available);
        const nextUrl = data.url || getOfficialServiceTargetUrl(serviceId, item);
        const isNowDirect = Boolean(data.direct_offer || (updatedOffer && _isDirectOfficialOfferUrl(updatedOffer.url)));
        renderStage(nextUrl, isNowDirect, data.quality || updatedOffer?.quality || "", false);
      }
    } catch (_) {
      if (state.isPlayerOpen && state.playerSessionId === sessionId && state.activeSourceTab === serviceId) {
        renderStage(initialUrl, alreadyDirect, existingOffer?.quality || "", false);
      }
    }
  }
}
export function resetVideoElementForStreamChange() {
  const video = document.getElementById("native-video");
  if (state.videoListenerAbortController) {
    try {
      state.videoListenerAbortController.abort();
    } catch (err) { window.logDebug?.("PlayerStreams", err); }
    state.videoListenerAbortController = null;
  }
  if (state.remuxProbeAbortController) {
    try {
      state.remuxProbeAbortController.abort();
    } catch (err) { window.logDebug?.("PlayerStreams", err); }
    state.remuxProbeAbortController = null;
  }
  if (state.stremioResolveAbortController) {
    try {
      state.stremioResolveAbortController.abort();
    } catch (err) { window.logDebug?.("PlayerStreams", err); }
    state.stremioResolveAbortController = null;
  }
  if (state.skipIntroAbortController) {
    try {
      state.skipIntroAbortController.abort();
    } catch (err) { window.logDebug?.("PlayerStreams", err); }
    state.skipIntroAbortController = null;
  }
  state.remuxMeta = null;
  state.currentStreamUrl = "";
  state.activeStremioStreamKey = "";
  state.active4kReleaseKey = "";
  state.active4kReleaseUrl = "";
  state.active4kRelease = null;
  state.forceAutoLaunchNextStream = true;
  if (state.hlsInstance) {
    try {
      state.hlsInstance.destroy();
    } catch (err) { window.logDebug?.("PlayerStreams", err); }
    state.hlsInstance = null;
  }
  if (video) {
    video.onloadedmetadata = null;
    try {
      video.pause();
    } catch (err) { window.logDebug?.("PlayerStreams", err); }
    video.querySelectorAll("track").forEach((tr) => tr.remove());
    if (!isVideoInPiP(video)) {
      video.removeAttribute("src");
      try {
        video.load();
      } catch (err) { window.logDebug?.("PlayerStreams", err); }
    }
  }
  clearCustomSubtitleOverlay(true);
  syncDownloadButtonVisibility();
}

export function renderTrailerEmbed(lang = "ru") {
  state.trailerLang = lang;
  const trailerStage = document.getElementById("trailer-stage-box");
  const btnRu = document.getElementById("btn-trailer-ru");
  const btnEn = document.getElementById("btn-trailer-en");
  const btnYt = document.getElementById("btn-trailer-yt");
  if (!trailerStage || !state.trailerData) return;

  if (btnRu) btnRu.classList.toggle("active", lang === "ru");
  if (btnEn) btnEn.classList.toggle("active", lang === "en");

  const embedUrl =
    lang === "en"
      ? state.trailerData.en_embed_url || state.trailerData.default_embed_url
      : state.trailerData.ru_embed_url || state.trailerData.default_embed_url;
  const ytUrl =
    lang === "en"
      ? state.trailerData.en_youtube_url || state.trailerData.ru_youtube_url
      : state.trailerData.ru_youtube_url || state.trailerData.en_youtube_url;

  if (btnYt && ytUrl) {
    btnYt.onclick = () => window.open(ytUrl, "_blank", "noopener,noreferrer");
  }

  trailerStage.classList.remove("hidden");
  if (embedUrl) {
    let apiEmbedUrl = embedUrl;
    if (/youtube\.com\/embed\//i.test(apiEmbedUrl) && !/enablejsapi=1/i.test(apiEmbedUrl)) {
      const sep = apiEmbedUrl.includes("?") ? "&" : "?";
      const originParam =
        typeof window !== "undefined" && /^https?:\/\//i.test(window.location.origin)
          ? `&origin=${encodeURIComponent(window.location.origin)}`
          : "";
      apiEmbedUrl = `${apiEmbedUrl}${sep}enablejsapi=1${originParam}`;
    }
    state.trailerPlaying = true;
    trailerStage.innerHTML = `
      <iframe
        src="${apiEmbedUrl}"
        title="${escapeAttr(t("Трейлер", "Trailer"))}"
        referrerpolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
      ></iframe>
    `;
    const miniPlayBtn = document.getElementById("btn-mini-play-pause");
    if (miniPlayBtn) miniPlayBtn.innerHTML = iconSvg("pause", 12);
  } else {
    state.trailerPlaying = false;
    trailerStage.innerHTML = `
      <div class="atv-trailer-fallback">
        <div class="atv-trailer-fallback-title">${t(
          "Встроенный трейлер недоступен",
          "Embedded trailer unavailable"
        )}</div>
        <button type="button" class="atv-btn-primary atv-btn-sm" id="fallback-yt-trailer-btn">
          <span>${t("Открыть трейлер на YouTube", "Open trailer on YouTube")}</span>
          ${iconSvg("external", 13)}
        </button>
      </div>
    `;
    const fbBtn = document.getElementById("fallback-yt-trailer-btn");
    if (fbBtn && ytUrl) {
      fbBtn.onclick = () => window.open(ytUrl, "_blank", "noopener,noreferrer");
    }
  }
}
export async function loadTrailerTab() {
  if (!state.activeItem || !state.isPlayerOpen) return;
  const sessionId = state.playerSessionId;
  const item = state.activeItem;
  const loader = document.getElementById("video-loader");
  const loaderText = document.getElementById("video-loader-text");
  const defaultTrailerLang = state.trailerLang || (isEn() ? "en" : "ru");
  if (state.trailerData && state.trailerData.title === item.title) {
    renderTrailerEmbed(defaultTrailerLang);
    return;
  }
  if (state.trailerAbortController) {
    try {
      state.trailerAbortController.abort();
    } catch (err) { window.logDebug?.("PlayerStreams", err); }
  }
  const abortController = new AbortController();
  state.trailerAbortController = abortController;
  if (loader && loaderText) {
    loaderText.textContent = t(
      `Поиск официального трейлера «${displayTitle(item)}»...`,
      `Searching official trailer for "${displayTitle(item)}"...`
    );
    loader.classList.remove("hidden");
  }
  try {
    const params = new URLSearchParams({
      id: String(item.id || ""),
      rezka_id: String(item.rezka_id || ""),
      rezka_url: item.rezka_url || "",
      title: item.title,
      orig_title: item.orig_title || "",
      year: String(item.year || ""),
      media_type: item.media_type || "movie",
    });
    const res = await fetch(`/api/trailer?${params.toString()}`, {
      signal: abortController.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (abortController.signal.aborted || !state.isPlayerOpen || sessionId !== state.playerSessionId) return;
    state.trailerData = data;
    if (state.activeSourceTab === "trailer") {
      renderTrailerEmbed(state.trailerLang || (isEn() ? "en" : "ru"));
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;
    console.error("Trailer load error:", err);
  } finally {
    if (loader && sessionId === state.playerSessionId && state.activeSourceTab === "trailer") {
      loader.classList.add("hidden");
    }
  }
}
export function hideVideoStreamError() {
  document.getElementById("video-error-state")?.classList.add("hidden");
  document.getElementById("video-error-studios-panel")?.classList.add("hidden");
}
export function showVideoStreamError(
  title = t("Поток временно недоступен", "Stream temporarily unavailable"),
  sub = t(
    "Попробуйте повторить подключение, выбрать другую студию озвучки или переключиться на 4K",
    "Try reconnecting, choosing another audio track, or switching to Stremio / 4K"
  )
) {
  const errBox = document.getElementById("video-error-state");
  const titleEl = document.getElementById("video-error-title");
  const subEl = document.getElementById("video-error-sub");
  const studioBtn = document.getElementById("btn-video-err-studio");
  const b4kBtn = document.getElementById("btn-video-err-4k");
  document.getElementById("video-error-studios-panel")?.classList.add("hidden");
  if (!errBox) return;
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = sub;
  const isOfflineNow =
    state.activeSourceTab === "offline" || (typeof navigator !== "undefined" && navigator.onLine === false);
  if (studioBtn) {
    studioBtn.classList.toggle("hidden", isOfflineNow || state.activeSourceTab !== "hdrezka");
    studioBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await toggleErrorStudiosPanel();
    };
  }
  const retryBtn = document.getElementById("btn-video-err-retry");
  if (retryBtn) {
    retryBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideVideoStreamError();
      const v = document.getElementById("native-video");
      const { cur: effCur } = getEffectivePlaybackTiming(v);
      const savedMediaTime = Number(state.lastPlaybackMediaTime) > 5 ? Number(state.lastPlaybackMediaTime) : 0;
      const curPos = effCur > 5 ? effCur : savedMediaTime;
      if (state.activeSourceTab === "backup4k") {
        loadBackup4KReleases(curPos, true);
      } else if (state.activeSourceTab === "stremio") {
        loadStremioStreams(curPos);
      } else if (state.activeSourceTab === "offline") {
        loadOfflineStreamForActiveTitle(curPos);
      } else {
        const loader = document.getElementById("video-loader");
        const loaderText = document.getElementById("video-loader-text");
        if (loaderText) {
          loaderText.textContent = t("Повторное подключение к HDRezka...", "Reconnecting to HDRezka...");
        }
        loader?.classList.remove("hidden");
        loadHDRezkaStream(curPos, { forceRefresh: true });
      }
    };
  }
  if (b4kBtn) {
    b4kBtn.classList.toggle("hidden", isOfflineNow || !isServiceEnabled("backup4k") || state.activeSourceTab === "backup4k");
    b4kBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      switchSourceTab("backup4k");
    };
  }
  const btnErrStudiosClose = document.getElementById("btn-video-err-studios-close");
  if (btnErrStudiosClose) {
    btnErrStudiosClose.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.getElementById("video-error-studios-panel")?.classList.add("hidden");
    };
  }
  errBox.classList.remove("hidden");
}

export function switchHdRezkaStudio(studioId, rawStudioName = "") {
  if (!studioId) return;
  state.activeStudioId = String(studioId);
  const locName = translateStudioName(rawStudioName || state.activeStudioName || studioId);
  state.activeStudioName = locName;

  const studioSel = document.getElementById("select-studio");
  if (studioSel) {
    let opt = Array.from(studioSel.options).find((o) => String(o.value) === String(studioId));
    if (!opt && rawStudioName) {
      opt = document.createElement("option");
      opt.value = String(studioId);
      opt.dataset.rawName = rawStudioName;
      opt.textContent = locName;
      studioSel.appendChild(opt);
    }
    if (opt) {
      opt.selected = true;
      studioSel.value = String(studioId);
      if (opt.dataset.isOriginal !== "1") {
        state.lastNonOriginalStudioId = String(studioId);
      }
    }
  }

  if (state.activeItem) {
    savePreferredStudioForItem(state.activeItem, studioId, rawStudioName || locName);
  }

  hideVideoStreamError();
  showToast(t(`Переключение на озвучку «${locName}»...`, `Switching to audio "${locName}"...`));

  const v = document.getElementById("native-video");
  const { cur: effCur } = getEffectivePlaybackTiming(v);
  const savedMediaTime = Number(state.lastPlaybackMediaTime) > 5 ? Number(state.lastPlaybackMediaTime) : 0;
  const curPos = effCur > 5 ? effCur : savedMediaTime;
  loadHDRezkaStream(curPos, { forceRefresh: true });
}

export async function renderErrorStudiosPanel() {
  const panel = document.getElementById("video-error-studios-panel");
  const listEl = document.getElementById("video-error-studios-list");
  if (!panel || !listEl) return;

  const item = state.activeItem;
  let studios = [];

  const studioSel = document.getElementById("select-studio");
  if (studioSel && studioSel.options.length > 0) {
    studios = Array.from(studioSel.options).map((opt) => ({
      id: String(opt.value),
      name: opt.dataset.rawName || opt.textContent,
      is_original: opt.dataset.isOriginal === "1",
    }));
  }

  if (studios.length === 0 && Array.isArray(state.availableStudios) && state.availableStudios.length > 0) {
    studios = state.availableStudios;
  } else if (studios.length === 0 && Array.isArray(item?.studios) && item.studios.length > 0) {
    studios = item.studios;
  }

  if (studios.length === 0 && item) {
    listEl.innerHTML = `
      <div class="atv-video-error-studios-loading">
        <div class="atv-spinner atv-spinner-sm"></div>
        <span>${escapeHtml(t("Загрузка списка студий озвучки...", "Loading audio tracks..."))}</span>
      </div>
    `;
    try {
      const p = new URLSearchParams({
        id: String(item.id || ""),
        title: item.title || "",
        orig_title: item.orig_title || "",
        year: String(item.year || ""),
        media_type: item.media_type || "movie",
        lang: state.appLang || "ru",
      });
      if (item.rezka_url) p.set("rezka_url", item.rezka_url);
      const res = await fetch(`/api/title-meta?${p.toString()}`);
      if (res.ok) {
        const meta = await res.json();
        if (Array.isArray(meta.studios) && meta.studios.length > 0) {
          studios = meta.studios;
          state.availableStudios = meta.studios;
          if (item) item.studios = meta.studios;
          if (studioSel && studioSel.options.length === 0) {
            meta.studios.forEach((st) => {
              const opt = document.createElement("option");
              opt.value = String(st.id);
              opt.dataset.rawName = st.name || "";
              opt.textContent = translateStudioName(st.name);
              opt.dataset.isOriginal = st.is_original ? "1" : "0";
              if (String(st.id) === String(state.activeStudioId)) {
                opt.selected = true;
              }
              studioSel.appendChild(opt);
            });
          }
        }
      }
    } catch (err) { window.logDebug?.("PlayerStreams", err); }
  }

  if (studios.length === 0) {
    listEl.innerHTML = `
      <div class="atv-video-error-studios-empty">
        ${escapeHtml(t("Дополнительные студии озвучки не найдены", "No alternative audio tracks found"))}
      </div>
    `;
    return;
  }

  // Strictly exclude paid / locked HDRezka Premium tracks when free options exist
  const freeStudios = studios.filter(
    (st) => !st.is_prem_locked && !st.is_premium && !/premium/i.test(st.name || "")
  );
  if (freeStudios.length > 0) {
    studios = freeStudios;
  }

  listEl.innerHTML = "";
  studios.forEach((st) => {
    const isCur = String(st.id) === String(state.activeStudioId);
    const isOrig = Boolean(st.is_original || String(st.id) === "238");
    const rawNm = st.name || "";
    const locNm = translateStudioName(rawNm);

    const row = document.createElement("button");
    row.type = "button";
    row.className = `atv-video-error-studio-row${isCur ? " is-current" : ""}`;
    row.innerHTML = `
      <div class="atv-video-error-studio-name">
        <span>${escapeHtml(locNm)}</span>
        ${isOrig ? '<span class="atv-vc-orig-badge">ORIG</span>' : ""}
      </div>
      <div class="atv-video-error-studio-meta">
        ${isCur ? `<span class="atv-video-error-studio-cur">${escapeHtml(t("(текущая)", "(current)"))}</span>` : ""}
      </div>
    `;
    row.onclick = (e) => {
      e.stopPropagation();
      switchHdRezkaStudio(st.id, rawNm);
    };
    listEl.appendChild(row);
  });
}

export async function toggleErrorStudiosPanel() {
  const panel = document.getElementById("video-error-studios-panel");
  if (!panel) return;
  const isHidden = panel.classList.contains("hidden");
  if (!isHidden) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  await renderErrorStudiosPanel();
}
export async function warmUpStreamBuffer(url) {
  if (!url || typeof fetch !== "function") return;
  try {
    const isM3u8OrProxy = url.includes(".m3u8") || url.startsWith("/api/proxy-stream");
    if (isM3u8OrProxy) {
      const res = await fetch(url, { priority: "low" });
      if (!res.ok) return;
      const text = await res.text();
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      const subUrls = lines.filter((l) => !l.startsWith("#"));
      if (subUrls.length > 0) {
        const firstSub = subUrls[0];
        const absSubUrl = firstSub.startsWith("http") || firstSub.startsWith("/")
          ? firstSub
          : new URL(firstSub, url).href;
        const subRes = await fetch(absSubUrl, { priority: "low" });
        if (subRes.ok && absSubUrl.includes(".m3u8")) {
          const subText = await subRes.text();
          const chunkLines = subText.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
          if (chunkLines.length > 0) {
            const firstChunk = chunkLines[0];
            const absChunkUrl = firstChunk.startsWith("http") || firstChunk.startsWith("/")
              ? firstChunk
              : new URL(firstChunk, absSubUrl).href;
            fetch(absChunkUrl, { priority: "low" }).catch(() => {});
          }
        }
      }
    } else {
      fetch(url, {
        headers: { Range: "bytes=0-524287" },
        priority: "low",
      }).catch(() => {});
    }
  } catch (err) { window.logDebug?.("PlayerStreams", err); }
}

export function buildNextEpisodePreloadKey(item, season, episode, studioId) {
  return `${item?.id || ""}:s${season}e${episode}:tr${studioId || "auto"}:${state.appLang || "ru"}`;
}
export async function preloadNextEpisodeIfNeeded(curSec, durSec) {
  if (
    !state.isPlayerOpen ||
    !["hdrezka", "backup4k", "stremio"].includes(state.activeSourceTab) ||
    state.activeItem?.media_type !== "series" ||
    !(durSec >= 120)
  ) {
    return;
  }
  const creditsStartSec = getDetectedCreditsStartSec(durSec) || 0;
  const creditsActive = Boolean(creditsStartSec && curSec >= creditsStartSec - 5);
  const remain = durSec - curSec;
  const ratio = curSec / durSec;
  const shouldPreload = creditsActive || ratio >= 0.82 || remain <= 150;
  if (!shouldPreload) return;

  const activeVid = document.getElementById("native-video");
  if (activeVid && activeVid.readyState < 3 && getVideoForwardBufferSec(activeVid) < 6) return;

  const nextCoords = getNextEpisodeCoords();
  if (!nextCoords) return;

  const item = state.activeItem;
  const sourceTab = state.activeSourceTab;
  const preloadStudioOrTab =
    sourceTab === "hdrezka"
      ? state.activeStudioId || "auto"
      : `${sourceTab}:${state.active4kReleaseKey || state.preferred4kReleaseKey || "auto"}`;
  const preloadKey = buildNextEpisodePreloadKey(
    item,
    nextCoords.season,
    nextCoords.episode,
    preloadStudioOrTab
  );
  if (
    state.preloadingNextKey === preloadKey ||
    (state.preloadedNextEpisode && state.preloadedNextEpisode.key === preloadKey)
  ) {
    return;
  }
  state.preloadingNextKey = preloadKey;
  try {
    if (sourceTab === "hdrezka") {
      const savedPrefForNext = getPreferredStudioForItem(item);
      const nextProfAudio = state.activeProfile?.default_audio_pref || "auto";
      const wantOrigNext = nextProfAudio === "original" || (nextProfAudio === "auto" && isEn());
      const params = new URLSearchParams({
        id: String(item.id || ""),
        rezka_id: String(item.rezka_id || ""),
        rezka_url: item.rezka_url || "",
        title: item.title,
        orig_title: item.orig_title || "",
        year: String(item.year || ""),
        media_type: "series",
        translator_id: state.activeStudioId || "",
        season: String(nextCoords.season),
        episode: String(nextCoords.episode),
        lang: state.appLang || "ru",
        prefer_original: !state.activeStudioId && !savedPrefForNext && wantOrigNext ? "1" : "0",
      });
      const res = await fetch(`/api/hdrezka/streams?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      const prefs = getPlayerPrefs();
      const qKey = pickBestQualityKey(
        data.qualities || {},
        prefs.preferredQuality,
        data.default_quality
      );
      const nextUrl = (data.qualities || {})[qKey] || data.default_stream_url || "";
      if (!nextUrl) return;

      state.preloadedNextEpisode = {
        key: preloadKey,
        tab: "hdrezka",
        data,
        streamUrl: nextUrl,
        qualityKey: qKey,
        fetchedAt: Date.now(),
      };

      if (String(nextUrl).startsWith("/api/proxy-stream")) {
        fetch(nextUrl, { method: "HEAD" }).catch(() => {});
      } else if (nextUrl.includes(".m3u8")) {
        fetch(nextUrl, { mode: "cors" }).catch(() => {});
      }
    } else if (sourceTab === "backup4k") {
      const currentFiles = Array.isArray(state.active4kVideoFiles) ? state.active4kVideoFiles : [];
      const nextFile = currentFiles.find((vf) => Number(vf.episode) === nextCoords.episode);
      const activeRel = state.active4kRelease;
      const torrOnline = Boolean(state.torrserverConnected);

      if (nextFile && activeRel) {
        if (activeRel.stream_kind === "torrserver" && activeRel.magnet && torrOnline) {
          const tres = await fetch("/api/backup-streams/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: item.id || "",
              title: item.title || "",
              orig_title: item.orig_title || "",
              genres: item.genres || state.activeMeta?.genres || [],
              age_rating: item.age_rating || state.activeMeta?.age_rating || "",
              magnet: activeRel.magnet,
              media_type: "series",
              season: nextCoords.season,
              episode: nextCoords.episode,
              file_index: nextFile.id,
              filename_hint: nextFile.name || activeRel.title || "",
              lang: state.appLang || "ru",
            }),
          });
          const tjson = await tres.json();
          if (tjson && tjson.ok && tjson.stream_url) {
            const warmUrl = tjson.stream_url.includes("&play")
              ? tjson.stream_url.replace("&play", "&preload")
              : `${tjson.stream_url}&preload`;
            fetch(warmUrl, { method: "HEAD" }).catch(() => {});
            state.preloadedNextEpisode = {
              key: preloadKey,
              tab: "backup4k",
              data: null,
              streamUrl: tjson.stream_url,
              fileIndex: Number(tjson.file_index) || nextFile.id,
              videoFiles: Array.isArray(tjson.video_files) && tjson.video_files.length ? tjson.video_files : currentFiles,
              release: activeRel,
              releaseKey: state.active4kReleaseKey || String(activeRel.info_hash || ""),
              quality: activeRel.quality || "4K",
              fetchedAt: Date.now(),
            };
          }
        } else if (activeRel.stream_kind === "debrid" && activeRel.magnet) {
          const dres = await fetch("/api/debrid/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: item.id || "",
              title: item.title || "",
              orig_title: item.orig_title || "",
              genres: item.genres || state.activeMeta?.genres || [],
              age_rating: item.age_rating || state.activeMeta?.age_rating || "",
              magnet: activeRel.magnet,
              media_type: "series",
              season: nextCoords.season,
              episode: nextCoords.episode,
            }),
          });
          const djson = await dres.json();
          if (djson && djson.ok && djson.stream_url) {
            fetch(djson.stream_url, { method: "HEAD" }).catch(() => {});
            state.preloadedNextEpisode = {
              key: preloadKey,
              tab: "backup4k",
              data: null,
              streamUrl: djson.stream_url,
              fileIndex: null,
              videoFiles: [],
              release: activeRel,
              releaseKey: state.active4kReleaseKey || String(activeRel.info_hash || ""),
              quality: activeRel.quality || "4K",
              fetchedAt: Date.now(),
            };
          }
        }
      } else {
        const params = new URLSearchParams({
          id: String(item.id || ""),
          imdb_id: String(item.imdb_id || ""),
          rezka_id: String(item.rezka_id || ""),
          rezka_url: item.rezka_url || "",
          title: item.title,
          orig_title: item.orig_title || "",
          year: String(item.year || ""),
          media_type: "series",
          season: String(nextCoords.season),
          episode: String(nextCoords.episode),
          lang: state.appLang || "ru",
        });
        const res = await fetch(`/api/backup-streams?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data || data.ok === false) return;
        const nextCacheKey = `${item?.id || ""}:s${nextCoords.season}e${nextCoords.episode}:${state.appLang || "ru"}`;
        if (!state.backup4kReleasesCache) state.backup4kReleasesCache = {};
        if (Array.isArray(data?.releases)) {
          state.backup4kReleasesCache[nextCacheKey] = { ts: Date.now(), data };
        }
        const releases = data.releases || [];
        const preferredIdx = state.preferred4kReleaseKey
          ? releases.findIndex(
              (r, i) => String(r.info_hash || `rel_${i}_${r.title || ""}`) === state.preferred4kReleaseKey
            )
          : -1;
        const autoIdx = preferredIdx >= 0 ? preferredIdx : 0;
        const autoRel = releases[autoIdx] || null;
        if (autoRel) {
          let warmStreamUrl = autoRel.stream_url || "";
          let preFileIdx = 1;
          let preFiles = [];
          if (autoRel.stream_kind === "torrserver" && autoRel.magnet && data.torrserver_connected) {
            const tres = await fetch("/api/backup-streams/resolve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: item.id || "",
                title: item.title || "",
                orig_title: item.orig_title || "",
                genres: item.genres || state.activeMeta?.genres || [],
                age_rating: item.age_rating || state.activeMeta?.age_rating || "",
                magnet: autoRel.magnet,
                media_type: "series",
                season: nextCoords.season,
                episode: nextCoords.episode,
                filename_hint: autoRel.title || "",
                lang: state.appLang || "ru",
              }),
            });
            const tjson = await tres.json();
            if (tjson && tjson.ok && tjson.stream_url) {
              warmStreamUrl = tjson.stream_url;
              preFileIdx = Number(tjson.file_index) || 1;
              preFiles = Array.isArray(tjson.video_files) ? tjson.video_files : [];
              const warmUrl = tjson.stream_url.includes("&play")
                ? tjson.stream_url.replace("&play", "&preload")
                : `${tjson.stream_url}&preload`;
              fetch(warmUrl, { method: "HEAD" }).catch(() => {});
            }
          }
          if (warmStreamUrl) {
            state.preloadedNextEpisode = {
              key: preloadKey,
              tab: "backup4k",
              data,
              streamUrl: warmStreamUrl,
              fileIndex: preFileIdx,
              videoFiles: preFiles,
              release: autoRel,
              releaseKey: String(autoRel.info_hash || `rel_${autoIdx}_${autoRel.title || ""}`),
              quality: autoRel.quality || "4K",
              fetchedAt: Date.now(),
            };
          }
        }
      }
    } else if (sourceTab === "stremio") {
      const params = new URLSearchParams({
        id: item.id || "",
        title: item.title || "",
        orig_title: item.orig_title || "",
        imdb_id: item.imdb_id || "",
        year: String(item.year || ""),
        media_type: "series",
        season: String(nextCoords.season),
        episode: String(nextCoords.episode),
        lang: state.appLang || "ru",
      });
      const res = await fetch(`/api/stremio/streams?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data || data.ok === false) return;
      state.preloadedNextEpisode = {
        key: preloadKey,
        tab: "stremio",
        data,
        fetchedAt: Date.now(),
      };
      const firstStream = (data.streams || [])[0];
      if (firstStream?.url && !firstStream.url.startsWith("magnet:")) {
        fetch(firstStream.url, { method: "HEAD" }).catch(() => {});
      }
    }

    if (state.preloadedNextEpisode) {
      if (state.preloadedNextEpisode.streamUrl) {
        warmUpStreamBuffer(state.preloadedNextEpisode.streamUrl);
      }
      try {
        const skipParams = new URLSearchParams({
          id: String(item.id || ""),
          title: item.title || "",
          season: String(nextCoords.season),
          episode: String(nextCoords.episode),
        });
        fetch(`/api/skip-intro?${skipParams.toString()}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((skipData) => {
            if (state.preloadedNextEpisode && state.preloadedNextEpisode.key === preloadKey) {
              state.preloadedNextEpisode.skipIntroSegments = skipData;
              state.preloadedSkipSegments = skipData;
            }
          })
          .catch(() => {});
      } catch (err) { window.logDebug?.("PlayerStreams", err); }

      try {
        const subParams = new URLSearchParams({
          id: String(item.id || ""),
          title: item.title || "",
          orig_title: item.orig_title || "",
          season: String(nextCoords.season),
          episode: String(nextCoords.episode),
        });
        fetch(`/api/subtitles/list?${subParams.toString()}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((subData) => {
            if (state.preloadedNextEpisode && state.preloadedNextEpisode.key === preloadKey) {
              state.preloadedNextEpisode.subtitles = subData?.subtitles || [];
              state.preloadedNextSubtitles = subData?.subtitles || [];
            }
          })
          .catch(() => {});
      } catch (err) { window.logDebug?.("PlayerStreams", err); }

      const skipOutroBtn = document.getElementById("skip-outro-btn");
      if (skipOutroBtn) {
        skipOutroBtn.classList.add("is-preloaded");
        skipOutroBtn.setAttribute(
          "title",
          t("Следующая серия готова к мгновенному воспроизведению", "Next episode ready for instant playback")
        );
        if (!skipOutroBtn.querySelector(".atv-preload-ready-dot")) {
          skipOutroBtn.insertAdjacentHTML(
            "beforeend",
            ` <span class="atv-preload-ready-dot" title="${escapeAttr(
              t("Поток следующей серии предзагружен", "Next episode stream preloaded")
            )}"></span>`
          );
        }
      }
    }
  } catch (err) { window.logDebug?.("PlayerStreams", err); } finally {
    if (state.preloadingNextKey === preloadKey) {
      state.preloadingNextKey = "";
    }
  }
}
export async function loadHDRezkaStream(resumeTime = 0, options = {}) {
  if (!state.activeItem || !state.isPlayerOpen) return;
  const forceRefresh = Boolean(options?.forceRefresh);
  const sessionId = state.playerSessionId;
  const item = state.activeItem;
  const loader = document.getElementById("video-loader");
  const loaderText = document.getElementById("video-loader-text");
  hideVideoStreamError();
  state.remuxMeta = null;

  const skipOutroEl = document.getElementById("skip-outro-btn");
  if (skipOutroEl) {
    skipOutroEl.textContent = t("Следующая серия", "Next episode");
  }

  const preloadCandidateKey =
    item.media_type === "series"
      ? buildNextEpisodePreloadKey(item, state.activeSeason, state.activeEpisode, state.activeStudioId)
      : "";
  const hasWarmPreload = Boolean(
    !forceRefresh &&
      preloadCandidateKey &&
      state.preloadedNextEpisode &&
      state.preloadedNextEpisode.key === preloadCandidateKey &&
      Date.now() - (state.preloadedNextEpisode.fetchedAt || 0) < 900000
  );

  if (!hasWarmPreload) {
    loaderText.textContent = forceRefresh
      ? t(
          `Обновление сессии потока «${displayTitle(item)}»...`,
          `Refreshing stream session for "${displayTitle(item)}"...`
        )
      : t(
          `Загрузка полного 1080p потока «${displayTitle(item)}» (Без регистрации)...`,
          `Loading full 1080p stream for "${displayTitle(item)}"...`
        );
    loader.classList.remove("hidden");
  }

  if (state.streamAbortController) {
    try {
      state.streamAbortController.abort();
    } catch (err) { window.logDebug?.("PlayerStreams", err); }
  }
  const abortController = new AbortController();
  state.streamAbortController = abortController;
  let requestTimedOut = false;
  const requestTimeoutId = setTimeout(() => {
    requestTimedOut = true;
    try {
      abortController.abort();
    } catch (err) { window.logDebug?.("PlayerStreams", err); }
  }, 45000);

  const savedPrefForReq = getPreferredStudioForItem(item);
  const rawTranslatorId = state.activeStudioId || (savedPrefForReq?.id ? String(savedPrefForReq.id) : "");
  const reqTranslatorId = /^\d+$/.test(String(rawTranslatorId).trim()) ? String(rawTranslatorId).trim() : "";
  const profAudioPref = state.activeProfile?.default_audio_pref || "auto";
  const wantOrig = profAudioPref === "original" || (profAudioPref === "auto" && isEn());
  const preferOriginalFlag = !reqTranslatorId && !savedPrefForReq && wantOrig ? "1" : "0";
  const params = new URLSearchParams({
    id: String(item.id || ""),
    rezka_id: String(item.rezka_id || ""),
    rezka_url: item.rezka_url || "",
    title: item.title,
    orig_title: item.orig_title || "",
    year: String(item.year || ""),
    media_type: item.media_type || "movie",
    translator_id: reqTranslatorId,
    season: String(state.activeSeason),
    episode: String(state.activeEpisode),
    lang: state.appLang || "ru",
    prefer_original: preferOriginalFlag,
    nocache: forceRefresh ? "1" : "0",
  });

  try {
    let data;
    if (hasWarmPreload) {
      data = state.preloadedNextEpisode.data;
      state.preloadedNextEpisode = null;
      clearTimeout(requestTimeoutId);
    } else {
      let res;
      try {
        res = await fetch(`/api/hdrezka/streams?${params.toString()}`, {
          signal: abortController.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (firstErr) {
        if (abortController.signal.aborted) throw firstErr;
        await new Promise((r) => setTimeout(r, 650));
        if (abortController.signal.aborted) throw firstErr;
        params.set("nocache", "1");
        res = await fetch(`/api/hdrezka/streams?${params.toString()}`, {
          signal: abortController.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      clearTimeout(requestTimeoutId);
      data = await res.json();
    }

    // If modal was closed while stream request was in-flight, abort immediately!
    if (!state.isPlayerOpen || sessionId !== state.playerSessionId) {
      loader.classList.add("hidden");
      return;
    }

    if (data.rezka_id) item.rezka_id = data.rezka_id;
    if (data.rezka_url) item.rezka_url = data.rezka_url;

    if (isEn()) {
      if (data.description && data.description.length > 15 && !hasCyrillicText(data.description)) {
        item.description_en = data.description;
      }
      const descEl = document.getElementById("meta-description");
      if (descEl) {
        descEl.textContent = displayDescription(item) || "";
      }
      if (data.directors?.length) item.directors_en = data.directors;
      if (data.actors?.length) item.actors_en = data.actors;
      if (data.cast_people?.length) item.cast_people_en = data.cast_people;
    } else {
      if (data.description && data.description.length > 25) {
        item.description = data.description;
        document.getElementById("meta-description").textContent = data.description;
      }
      if (data.directors?.length) item.directors = data.directors;
      if (data.actors?.length) item.actors = data.actors;
      if (data.cast_people?.length) item.cast_people = data.cast_people;
    }
    try {
      if (data.duration_label) item.duration_label = data.duration_label;
      mergeIncomingItemGenres(item, data);
      renderModalGenresAndSubheader(item, data);
      renderModalCastSection(item, data);
    } catch (uiErr) {
      console.warn("[Player] Non-fatal HDRezka UI update error:", uiErr);
    }

    if (data.episodes_titles) {
      state.episodesTitles = data.episodes_titles;
    }
    if (data.episodes_meta) {
      state.episodesMeta = data.episodes_meta;
    }

    const isSeriesData = Boolean(
      item.media_type !== "movie" &&
      (item.media_type === "series" ||
        data.media_type === "series" ||
        (data.seasons_map && Object.keys(data.seasons_map).length > 0))
    );
    if (isSeriesData) {
      item.media_type = "series";
      if (state.activeItem) state.activeItem.media_type = "series";
      if (typeof data.is_completed === "boolean") {
        item.is_series_completed = data.is_completed;
      }
      if (data.seasons_map && Object.keys(data.seasons_map).length > 0) {
        state.seasonsMap = data.seasons_map;
        if (Number(data.season) > 0) state.activeSeason = Number(data.season);
        if (Number(data.episode) > 0) state.activeEpisode = Number(data.episode);
      }
      try {
        populateSeasonEpisodeSelectors(item, state.seasonsMap);
      } catch (selErr) {
        console.warn("[Player] Non-fatal season selector error:", selErr);
      }
      const bottomEpsPanel = document.getElementById("episodes-bottom-panel");
      if (bottomEpsPanel) {
        bottomEpsPanel.classList.remove("hidden");
      }
      document.getElementById("current-episode-bar")?.classList.remove("hidden");
      document.getElementById("skip-intro-footer-controls")?.classList.remove("hidden");
      if (data.latest_season && data.latest_episode && data.seasons_map && Object.keys(data.seasons_map).length > 0) {
        const stSummary = (data.studios || [])
          .map((s) => s.name)
          .filter(Boolean)
          .slice(0, 4)
          .join(", ");
        const liveEntry = {
          id: item.id,
          kinorium_id: item.kinorium?.kinorium_id || "",
          title: item.title,
          orig_title: item.orig_title || "",
          rezka_id: data.rezka_id || item.rezka_id || "",
          rezka_url: data.rezka_url || item.rezka_url || "",
          latest_season: data.latest_season,
          latest_episode: data.latest_episode,
          seasons_map: data.seasons_map,
          is_completed: Boolean(data.is_completed),
          studios_summary: stSummary || "HDRezka",
          not_found: false,
        };
        if (item.id) state.liveSeriesUpdates[item.id] = liveEntry;
        if (item.kinorium?.kinorium_id) {
          state.liveSeriesUpdates[`kin_${item.kinorium.kinorium_id}`] = liveEntry;
        }
        if (item.title) state.liveSeriesUpdates[item.title.trim().toLowerCase()] = liveEntry;
      }
    } else {
      const bottomEpsPanel = document.getElementById("episodes-bottom-panel");
      if (bottomEpsPanel) bottomEpsPanel.classList.add("hidden");
      document.getElementById("season-group")?.classList.add("hidden");
      document.getElementById("ep-nav-group")?.classList.add("hidden");
      document.getElementById("current-episode-bar")?.classList.add("hidden");
      document.getElementById("skip-intro-footer-controls")?.classList.add("hidden");
      populateSeasonEpisodeSelectors(item, null);
    }

    const studioSel = document.getElementById("select-studio");
    studioSel.innerHTML = "";
    const rawStudiosList = (Array.isArray(data.studios) && data.studios.length > 0)
      ? data.studios
      : (Array.isArray(state.availableStudios) && state.availableStudios.length > 0)
      ? state.availableStudios
      : (Array.isArray(item.studios) && item.studios.length > 0)
      ? item.studios
      : [];
    const freeOnlyStudios = rawStudiosList.filter(
      (st) => !st.is_prem_locked && !st.is_premium && !/premium/i.test(st.name || "")
    );
    const studiosList = freeOnlyStudios.length > 0 ? freeOnlyStudios : rawStudiosList;
    if (studiosList.length > 0) {
      state.availableStudios = studiosList;
      if (item) item.studios = studiosList;
    }
    const savedPref = getPreferredStudioForItem(item);
    let matchedPrefStudio = null;
    if (savedPref && studiosList.length > 1) {
      matchedPrefStudio =
        studiosList.find((st) => String(st.id) === String(savedPref.id)) ||
        studiosList.find(
          (st) =>
            savedPref.name &&
            String(st.name || "")
              .trim()
              .toLowerCase() === String(savedPref.name).trim().toLowerCase()
        ) ||
        null;
    }

    // If user had a saved studio by name whose ID differed from the initial request, reload once with that studio ID
    if (
      matchedPrefStudio &&
      !data.studio_auto_switched_from &&
      String(matchedPrefStudio.id) !== String(data.selected_studio?.id) &&
      String(reqTranslatorId) !== String(matchedPrefStudio.id)
    ) {
      state.activeStudioId = String(matchedPrefStudio.id);
      state.activeStudioName = matchedPrefStudio.name;
      return await loadHDRezkaStream(resumeTime);
    }

    if (data.studio_auto_switched_from && data.selected_studio?.name) {
      const fromLbl = translateStudioName(data.studio_auto_switched_from);
      const toLbl = translateStudioName(data.selected_studio.name);
      showToast(
        t(
          `В озвучке «${fromLbl}» эта серия ещё не вышла — включена «${toLbl}»`,
          `This episode is not out yet in "${fromLbl}" — switched to "${toLbl}"`
        )
      );
    }

    studiosList.forEach((st) => {
      const opt = document.createElement("option");
      opt.value = String(st.id);
      opt.dataset.rawName = st.name || "";
      const localizedStudioName = translateStudioName(st.name);
      opt.textContent = localizedStudioName;
      opt.dataset.isOriginal = st.is_original ? "1" : "0";
      if (String(st.id) === String(data.selected_studio?.id)) {
        opt.selected = true;
        state.activeStudioName = localizedStudioName;
        state.activeStudioId = String(st.id);
        if (!st.is_original) {
          state.lastNonOriginalStudioId = String(st.id);
        }
      }
      studioSel.appendChild(opt);
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
    if (!state.lastNonOriginalStudioId) {
      const firstRu = studiosList.find((st) => !st.is_original);
      if (firstRu) {
        state.lastNonOriginalStudioId = String(firstRu.id);
      }
    }

    const rSess = data.remux_session || null;
    state.backupQualities =
      data.backup_qualities && typeof data.backup_qualities === "object" ? data.backup_qualities : {};
    state.hlsQualities =
      data.hls_qualities && typeof data.hls_qualities === "object" ? data.hls_qualities : {};
    state.streamMintedAt =
      Number(data.minted_at) > 0 ? Number(data.minted_at) * 1000 : Date.now();
    state.usedBackupUrls = new Set();

    if (rSess && rSess.rawSourceUrl) {
      state.probeCreditsStartSec = Number(rSess.creditsStartSec) || 0;
      state.remuxMeta = {
        active: true,
        rawSourceUrl: rSess.rawSourceUrl,
        duration: Number(rSess.duration) || 0,
        creditsStartSec: Number(rSess.creditsStartSec) || 0,
        offsetSec: Math.max(0, Number(resumeTime) || 0),
        audioIndex: Number(rSess.audioIndex) || 0,
        videoCodec: rSess.videoCodec || "",
        audioCodec: rSess.audioCodec || "",
        channels: Number(rSess.channels) || 2,
        audioTracks: rSess.audioTracks || [],
        subtitleTracks: rSess.subtitleTracks || [],
        externalSubtitles: Array.isArray(data.subtitles) ? data.subtitles : [],
      };
      const remuxUrl = buildRemuxStreamEndpoint(state.remuxMeta, state.remuxMeta.offsetSec);
      const qLabel = data.default_quality || "1080p";
      state.qualities = { [qLabel]: remuxUrl };
    } else {
      state.remuxMeta = null;
      state.qualities = data.qualities || {};
    }

    const prefs = getPlayerPrefs();
    const chosenQualKey = pickBestQualityKey(
      state.qualities,
      prefs.preferredQuality,
      data.default_quality
    );
    const qualSel = document.getElementById("select-quality");
    qualSel.innerHTML = "";
    Object.keys(state.qualities).forEach((qKey) => {
      const opt = document.createElement("option");
      opt.value = qKey;
      opt.textContent = qKey;
      if (qKey === chosenQualKey) opt.selected = true;
      qualSel.appendChild(opt);
    });

    if (state.remuxMeta?.active) {
      state.subtitles = buildRemuxSubtitlesList(state.remuxMeta, state.remuxMeta.offsetSec);
    } else {
      const baseSubs = (data.subtitles || []).map((s) => {
        const rawSubLang = String(s.lang || s.label || "").trim();
        let dispSubLang = rawSubLang;
        if (isEn()) {
          dispSubLang = rawSubLang
            .replace(/^Русский\b/i, "Russian")
            .replace(/^(Українська|Украинский)\b/i, "Ukrainian")
            .replace(/^Английский\b/i, "English")
            .replace(/^Польский\b/i, "Polish")
            .replace(/^Немецкий\b/i, "German")
            .replace(/^Французский\b/i, "French")
            .replace(/^Испанский\b/i, "Spanish");
        }
        return { ...s, lang: dispSubLang };
      });
      state.subtitles = mergeCustomExternalSubtitles(baseSubs);
    }
    let subIdx = pickPreferredSubtitleIndex(
      state.subtitles,
      prefs.preferredSubtitleLang
    );
    const selectedIsOriginal = Boolean(
      data.selected_studio?.is_original ||
        studiosList.find((st) => String(st.id) === String(state.activeStudioId))?.is_original
    );
    if (isEn()) {
      if (state.forceEnableRuSubtitlesOnce && subIdx < 0 && state.subtitles.length > 0) {
        const enSubIdx = state.subtitles.findIndex((s) => /eng|англ/i.test(String(s.lang || "")));
        if (enSubIdx >= 0) subIdx = enSubIdx;
      }
    } else if (
      (selectedIsOriginal || state.forceEnableRuSubtitlesOnce) &&
      subIdx < 0 &&
      state.subtitles.length > 0 &&
      (state.forceEnableRuSubtitlesOnce || prefs.preferredSubtitleLang !== "off")
    ) {
      const ruSubIdx = state.subtitles.findIndex((s) => /рус|rus|russian/i.test(String(s.lang || "")));
      subIdx = ruSubIdx >= 0 ? ruSubIdx : 0;
    }
    state.forceEnableRuSubtitlesOnce = false;
    state.activeSubtitleIndex = subIdx;
    populateSubtitlesSelector(state.subtitles);
    syncCustomControlPopovers();

    document.getElementById("geo-bypass-indicator").textContent =
      data.geo_bypass?.status_text || t("1080p Без регистрации", "1080p Direct Stream");

    const chosenStreamUrl = state.qualities[chosenQualKey] || data.default_stream_url;
    if (!chosenStreamUrl) {
      const freeAlternative = studiosList.find(
        (st) =>
          !st.is_prem_locked &&
          !st.is_premium &&
          !/premium/i.test(st.name || "") &&
          String(st.id) !== String(state.activeStudioId)
      );
      if (freeAlternative && !options?._autoStudioTried) {
        state.activeStudioId = String(freeAlternative.id);
        state.activeStudioName = translateStudioName(freeAlternative.name);
        return loadHDRezkaStream(resumeTime, { ...options, _autoStudioTried: true, forceRefresh: true });
      }
      loader.classList.add("hidden");
      document.getElementById("geo-bypass-indicator").textContent = t(
        "Поток недоступен — смените озвучку или 4K",
        "Stream unavailable — switch audio or try Stremio / 4K"
      );
      showVideoStreamError(
        t("Поток в этой озвучке временно недоступен", "Stream unavailable for this audio track"),
        t(
          "Выберите другую студию озвучки, повторите попытку или переключитесь на вкладку 4K",
          "Choose another audio studio, retry, or switch to the Stremio / 4K tab"
        )
      );
      return;
    }
    state.recentStallTimestamps = [];
    state.autoReconnectTimestamps = [];
    if (state.remuxMeta?.active) {
      playVideoUrl(chosenStreamUrl, 0, sessionId, { keepRemuxMeta: true });
    } else {
      playVideoUrl(chosenStreamUrl, resumeTime, sessionId);
    }
  } catch (err) {
    clearTimeout(requestTimeoutId);
    if (err && err.name === "AbortError" && !requestTimedOut) return;
    if (!options?._autoStudioTried && item) {
      let candStudios = state.availableStudios || item?.studios || [];
      if (!candStudios.length && item.title) {
        try {
          const p = new URLSearchParams({
            id: String(item.id || ""),
            title: item.title || "",
            orig_title: item.orig_title || "",
            year: String(item.year || ""),
            media_type: item.media_type || "movie",
            lang: state.appLang || "ru",
          });
          const mRes = await fetch(`/api/title-meta?${p.toString()}`, {
            signal: abortController.signal,
          });
          if (!state.isPlayerOpen || sessionId !== state.playerSessionId || state.activeSourceTab !== "hdrezka") return;
          if (mRes.ok) {
            const mData = await mRes.json();
            if (Array.isArray(mData.studios) && mData.studios.length > 0) {
              candStudios = mData.studios;
              state.availableStudios = mData.studios;
              item.studios = mData.studios;
            }
          }
        } catch (err) { window.logDebug?.("PlayerStreams", err); }
      }
      const freeAlternative = candStudios.find(
        (st) =>
          !st.is_prem_locked &&
          !st.is_premium &&
          !/premium/i.test(st.name || "") &&
          String(st.id) !== String(state.activeStudioId)
      );
      if (freeAlternative) {
        state.activeStudioId = String(freeAlternative.id);
        state.activeStudioName = translateStudioName(freeAlternative.name);
        return loadHDRezkaStream(resumeTime, { ...options, _autoStudioTried: true, forceRefresh: true });
      }
    }
    console.error("HDRezka stream error:", err);
    loader.classList.add("hidden");
    const statusEl = document.getElementById("geo-bypass-indicator");
    if (statusEl) {
      statusEl.textContent = t(
        "Ошибка соединения — попробуйте другую озвучку или 4K",
        "Connection error — try another audio track or Stremio / 4K"
      );
    }
    const studioSel = document.getElementById("select-studio");
    if (studioSel && studioSel.options.length === 0) {
      const fallbackStudios = state.availableStudios || item?.studios || [];
      if (fallbackStudios.length > 0) {
        fallbackStudios.forEach((st) => {
          const opt = document.createElement("option");
          opt.value = String(st.id);
          opt.dataset.rawName = st.name || "";
          opt.textContent = translateStudioName(st.name);
          opt.dataset.isOriginal = st.is_original ? "1" : "0";
          if (String(st.id) === String(state.activeStudioId)) {
            opt.selected = true;
          }
          studioSel.appendChild(opt);
        });
        syncCustomSelect(studioSel);
      }
    }
    if (item && item.media_type === "series") {
      try {
        populateSeasonEpisodeSelectors(item, state.seasonsMap);
        updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);
      } catch (err) { window.logDebug?.("PlayerStreams", err); }
    }
    showVideoStreamError(
      t("Не удалось подключиться к потоку HDRezka", "Could not connect to HDRezka stream"),
      t(
        "Проверьте соединение, выберите другую студию озвучки или откройте вкладку 4K",
        "Check your connection, choose another studio, or switch to Stremio / 4K"
      )
    );
  }
}

// Remux duration estimation, full probe, effective playback timing, and audio offset labels
// are extracted to ./player-remux.js and re-exported above.

import {
  adjustAudioOffset,
  loadBackup4KReleases,
  loadStremioStreams,
  probeAndPlay4KStream,
  renderStremioStreamsList,
  resetAudioOffset,
  seekEffectivePlayback,
  switchRemuxAudioTrack,
} from "./player-streams-4k.js?v=20261105v5";
export {
  adjustAudioOffset,
  loadBackup4KReleases,
  loadStremioStreams,
  probeAndPlay4KStream,
  renderStremioStreamsList,
  resetAudioOffset,
  seekEffectivePlayback,
  switchRemuxAudioTrack,
};
function rankHdRezkaQualityScore(qLabel) {
  const low = String(qLabel || "").trim().toLowerCase();
  if (low.includes("2160") || low.includes("4k")) return 2160;
  if (low.includes("1440") || low.includes("2k")) return 1440;
  if (low.includes("1080") && low.includes("ultra")) return 1085;
  if (low.includes("1080")) return 1080;
  if (low.includes("720")) return 720;
  if (low.includes("480")) return 480;
  if (low.includes("360")) return 360;
  return parseInt(low, 10) || 0;
}
function pickLowerHdRezkaQualityKey() {
  const qualSel = document.getElementById("select-quality");
  const curKey = qualSel?.value || "";
  const curRank = rankHdRezkaQualityScore(curKey);
  if (!curRank || !state.qualities) return "";
  const candidates = Object.keys(state.qualities)
    .filter((k) => state.qualities[k])
    .map((k) => ({ key: k, rank: rankHdRezkaQualityScore(k) }))
    .filter((item) => item.rank > 0 && item.rank < curRank)
    .sort((a, b) => b.rank - a.rank);
  if (candidates.length === 0) return "";
  const above480 = candidates.find((c) => c.rank >= 480);
  return (above480 || candidates[0]).key;
}
function appendProxyEdgeEvictParams(urlStr) {
  const clean = String(urlStr || "")
    .replace(/([?&])_r=\d+/g, "")
    .replace(/([?&])_evict_edge=[^&]*/g, "")
    .replace(/[?&]+$/, "");
  const sep = clean.includes("?") ? "&" : "?";
  return `${clean}${sep}_evict_edge=1&_r=${Date.now()}`;
}
export function _tryRecoverHdRezkaPlayback(resumeAt, sessionId, currentUrl, options = {}) {
  if (!state.isPlayerOpen || sessionId !== state.playerSessionId) return false;
  const loader = document.getElementById("video-loader");
  const loaderTextEl = document.getElementById("video-loader-text");
  if (!(state.usedBackupUrls instanceof Set)) {
    state.usedBackupUrls = new Set();
  }
  if (currentUrl) {
    state.usedBackupUrls.add(String(currentUrl));
  }

  // Stage 0a: Reconnect fragmented MP4 remux stream (4K / Stremio) from current playback position
  if (
    options.keepRemuxMeta &&
    state.remuxMeta?.active &&
    !options.remuxTransientRetried &&
    resumeAt > 2
  ) {
    const remuxRetryUrl = buildRemuxStreamEndpoint(state.remuxMeta, resumeAt);
    if (loaderTextEl) {
      loaderTextEl.textContent = t(
        "Восстановление потока с текущей позиции...",
        "Reconnecting stream at current position..."
      );
    }
    loader?.classList.remove("hidden");
    playVideoUrl(remuxRetryUrl, 0, sessionId, {
      ...options,
      keepRemuxMeta: true,
      newRemuxOffsetSec: resumeAt,
      remuxTransientRetried: true,
    });
    return true;
  }

  // Stage 0: Switch direct external MP4 stream to local proxy-stream
  if (
    !options.proxyRetried &&
    !options.keepRemuxMeta &&
    /^https?:\/\//i.test(String(currentUrl || "")) &&
    !String(currentUrl || "").includes(".m3u8")
  ) {
    const proxiedFallback = `/api/proxy-stream?url=${encodeURIComponent(currentUrl)}`;
    loader?.classList.remove("hidden");
    playVideoUrl(proxiedFallback, resumeAt, sessionId, {
      ...options,
      proxyRetried: true,
    });
    return true;
  }

  // Stage 1: Evict dead CDN edge connection on proxied MP4 streams
  if (
    !options.transientRetried &&
    !options.keepRemuxMeta &&
    String(currentUrl || "").startsWith("/api/proxy-stream") &&
    !String(currentUrl || "").includes(".m3u8")
  ) {
    const retryUrl = appendProxyEdgeEvictParams(currentUrl);
    if (loaderTextEl) {
      loaderTextEl.textContent = t(
        "Переподключение к более быстрому узлу CDN...",
        "Switching to a faster CDN node..."
      );
    }
    loader?.classList.remove("hidden");
    playVideoUrl(retryUrl, resumeAt, sessionId, {
      ...options,
      transientRetried: true,
    });
    return true;
  }

  if (state.activeSourceTab === "hdrezka") {
    const qualSel = document.getElementById("select-quality");
    const curQual = qualSel?.value || Object.keys(state.qualities || {})[0] || "";

    // Stage 2: Alternate MP4 mirror or HLS (.m3u8) manifest for current quality
    const altCandidates = [];
    const addAlt = (val) => {
      if (!val) return;
      if (Array.isArray(val)) {
        val.forEach((u) => {
          if (u && typeof u === "string") altCandidates.push(u);
        });
      } else if (typeof val === "string") {
        altCandidates.push(val);
      }
    };
    if (curQual) {
      addAlt(state.backupQualities?.[curQual]);
      addAlt(state.hlsQualities?.[curQual]);
    }
    Object.values(state.hlsQualities || {}).forEach((u) => addAlt(u));

    const nextAltUrl = altCandidates.find(
      (u) => u && u !== currentUrl && !state.usedBackupUrls.has(u)
    );
    if (nextAltUrl) {
      state.usedBackupUrls.add(nextAltUrl);
      if (loaderTextEl) {
        loaderTextEl.textContent = t(
          "Переключение на резервное зеркало потока...",
          "Switching to backup stream mirror..."
        );
      }
      loader?.classList.remove("hidden");
      playVideoUrl(nextAltUrl, resumeAt, sessionId, {
        transientRetried: false,
        backupRetried: true,
      });
      return true;
    }

    // Stage 3: Force fresh Voidboost token minting (nocache=1), max 2 times per 3 minutes
    const nowMs = Date.now();
    state.tokenRefreshTimestamps = (state.tokenRefreshTimestamps || []).filter(
      (ts) => nowMs - ts < 180000
    );
    if (state.tokenRefreshTimestamps.length < 2) {
      state.tokenRefreshTimestamps.push(nowMs);
      if (loaderTextEl) {
        loaderTextEl.textContent = t(
          "Обновление токена видеопотока HDRezka...",
          "Refreshing HDRezka stream token..."
        );
      }
      loader?.classList.remove("hidden");
      loadHDRezkaStream(resumeAt, { forceRefresh: true });
      return true;
    }

    // Stage 4: Automatic step-down to lower quality tier if unused
    const lowerQ = pickLowerHdRezkaQualityKey();
    const lowerTag = lowerQ ? `qual:${lowerQ}` : "";
    if (lowerQ && state.qualities?.[lowerQ] && !state.usedBackupUrls.has(lowerTag)) {
      state.usedBackupUrls.add(lowerTag);
      if (qualSel) qualSel.value = lowerQ;
      syncCustomControlPopovers();
      const rawLowerUrl = state.qualities[lowerQ];
      const nextLowerUrl = String(rawLowerUrl).startsWith("/api/proxy-stream")
        ? appendProxyEdgeEvictParams(rawLowerUrl)
        : rawLowerUrl;
      if (loaderTextEl) {
        loaderTextEl.textContent = t(
          `Переключение на стабильный поток ${lowerQ}...`,
          `Switching to stable ${lowerQ} stream...`
        );
      }
      loader?.classList.remove("hidden");
      showToast(
        t(
          `Высокая нагрузка на сервер — переключено на ${lowerQ} без потери позиции`,
          `High server load — switched to ${lowerQ} seamlessly`
        )
      );
      playVideoUrl(nextLowerUrl, resumeAt, sessionId);
      return true;
    }
  }

  if (
    state.activeSourceTab === "stremio" &&
    state.activeStremioStreamKey &&
    typeof state._launchStremioStreamCandidate === "function" &&
    Array.isArray(state._filteredStremioCandidates)
  ) {
    if (!state.failedStremioKeys) state.failedStremioKeys = new Set();
    state.failedStremioKeys.add(state.activeStremioStreamKey);
    if (state.failedStremioKeys.size <= 2) {
      const nextCand = state._filteredStremioCandidates.find(
        (c) => c.playable && !state.failedStremioKeys.has(c.stKey)
      );
      if (nextCand) {
        showToast(
          t(
            "Раздача не отвечает — автоматический переход к следующему потоку Stremio...",
            "Stream unresponsive — switching to the next Stremio release..."
          )
        );
        state._launchStremioStreamCandidate(nextCand.st, nextCand.stKey, resumeAt);
        return true;
      }
    }
  }

  // Final Stage: Exhausted automatic recovery — show actionable stream error UI
  loader?.classList.add("hidden");
  if (state.activeSourceTab !== "trailer") {
    showVideoStreamError(
      t("Не удалось воспроизвести видеопоток", "Could not play video stream"),
      t(
        "Попробуйте повторить подключение, выбрать другую студию озвучки или переключиться на 4K",
        "Try reconnecting, choosing another audio track, or switching to Stremio / 4K"
      )
    );
  }
  return false;
}
