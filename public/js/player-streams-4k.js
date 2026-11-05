import { state } from "./state.js?v=20261105v4";
import {
  displayTitle,
  isEn,
  t,
  translateSizeLabel,
  translateStudioName,
} from "./i18n.js?v=20261105v4";
import {
  copyTextToClipboard,
  escapeAttr,
  escapeHtml,
  formatTime,
  iconSvg,
  initCustomSelects,
  showToast,
  showVideoOsd,
} from "./utils.js?v=20261105v4";
import {
  applyAudioBoostToVideo,
  getPlayerPrefs,
  pickPreferredSubtitleIndex,
} from "./audio-dsp.js?v=20261105v4";
import {
  buildRemuxSubtitlesList,
  mergeCustomExternalSubtitles,
  populateSubtitlesSelector,
  refreshRemuxSubtitleTracks,
} from "./subtitles.js?v=20261105v4";
import {
  buildRemuxStreamEndpoint,
  formatAudioOffsetLabel,
  getEffectivePlaybackTiming,
  prepareRemuxAudioSwitch,
  syncAudioOffsetUI,
} from "./player-remux.js?v=20261105v4";
import {
  syncCustomControlPopovers,
  syncCustomVideoControlsUI,
} from "./player-ui-controls.js?v=20261105v4";
import { updateMiniPlayerTitle } from "./player-pip-dock.js?v=20261105v4";
import {
  populateSeasonEpisodeSelectors,
  updateCurrentEpisodeBar,
} from "./player-seasons.js?v=20261105v4";
import { playVideoUrl } from "./player.js?v=20261105v4";
import {
  buildNextEpisodePreloadKey,
  hideVideoStreamError,
  isHdRezkaStreamDeadOrExpired,
  loadHDRezkaStream,
} from "./player-streams.js?v=20261105v4";

function _applyLiveAudioOffsetToCurrentStream() {
  if (state.audioOffsetReloadTimerId) {
    clearTimeout(state.audioOffsetReloadTimerId);
    state.audioOffsetReloadTimerId = null;
  }
  const video = document.getElementById("native-video");
  if (!video || !state.isPlayerOpen) return;

  if (state.remuxMeta && state.remuxMeta.active) {
    state.audioOffsetReloadTimerId = setTimeout(() => {
      state.audioOffsetReloadTimerId = null;
      if (!state.isPlayerOpen || !state.remuxMeta?.active) return;
      const vNow = document.getElementById("native-video");
      const { cur } = getEffectivePlaybackTiming(vNow);
      const remuxUrl = buildRemuxStreamEndpoint(state.remuxMeta, cur);
      playVideoUrl(remuxUrl, 0, state.playerSessionId, { keepRemuxMeta: true, newRemuxOffsetSec: cur });
    }, 360);
    return;
  }

  const canUpgradeToRemux =
    Math.abs(state.audioOffsetSec || 0) >= 0.005 &&
    state.remuxAvailable &&
    (state.activeSourceTab === "backup4k" || state.activeSourceTab === "stremio") &&
    Boolean(state.lastDirect4kSourceUrl);
  if (canUpgradeToRemux) {
    state.audioOffsetReloadTimerId = setTimeout(() => {
      state.audioOffsetReloadTimerId = null;
      if (!state.isPlayerOpen || !state.lastDirect4kSourceUrl) return;
      const vNow = document.getElementById("native-video");
      const { cur } = getEffectivePlaybackTiming(vNow);
      probeAndPlay4KStream(
        state.lastDirect4kSourceUrl,
        cur,
        "4K UHD",
        state.playerSessionId,
        {
          extraSubtitles:
            state.activeSourceTab === "stremio"
              ? state.externalStremioSubs || []
              : state.external4kSubs || [],
        }
      );
    }, 360);
    return;
  }

  applyAudioBoostToVideo(video, state.audioBoost, state.audioPreset);
}

export function adjustAudioOffset(deltaSec, showFeedback = true) {
  let nextVal = Math.max(-5, Math.min(5, Math.round(((Number(state.audioOffsetSec) || 0) + Number(deltaSec || 0)) * 100) / 100));
  const isRemuxCapable =
    Boolean(state.remuxMeta?.active) ||
    (state.remuxAvailable &&
      (state.activeSourceTab === "backup4k" || state.activeSourceTab === "stremio") &&
      Boolean(state.lastDirect4kSourceUrl));
  if (!isRemuxCapable && nextVal < -0.004) {
    nextVal = 0;
    state.audioOffsetSec = 0;
    syncAudioOffsetUI();
    _applyLiveAudioOffsetToCurrentStream();
    if (showFeedback) {
      showToast(
        t(
          "Опережение звука (−) поддерживается в потоках 4K Remux и Stremio",
          "Negative audio offset (−) is supported on 4K Remux and Stremio streams"
        )
      );
    }
    return;
  }
  state.audioOffsetSec = nextVal;
  syncAudioOffsetUI();
  _applyLiveAudioOffsetToCurrentStream();
  if (showFeedback) {
    const label = formatAudioOffsetLabel(nextVal);
    showVideoOsd("unmute", `${t("Звук", "Audio")}: ${label}`);
  }
}

export function resetAudioOffset(showFeedback = true) {
  if (Math.abs(state.audioOffsetSec || 0) < 0.005) {
    syncAudioOffsetUI();
    return;
  }
  state.audioOffsetSec = 0;
  syncAudioOffsetUI();
  _applyLiveAudioOffsetToCurrentStream();
  if (showFeedback) {
    showToast(t("Задержка звука сброшена (0.00 с)", "Audio sync reset (0.00 s)"));
  }
}

export function seekEffectivePlayback(targetSec) {
  const video = document.getElementById("native-video");
  if (!video) return;
  const { dur } = getEffectivePlaybackTiming(video);
  const clamped = dur > 0 ? Math.min(Math.max(0, dur - 0.5), Math.max(0, targetSec)) : Math.max(0, targetSec);

  if (isHdRezkaStreamDeadOrExpired(video)) {
    state.tokenRefreshTimestamps = [];
    loadHDRezkaStream(clamped, { forceRefresh: true });
    return;
  }

  if (state.remuxMeta && state.remuxMeta.active) {
    const offset = state.remuxMeta.offsetSec || 0;
    const relTarget = clamped - offset;
    if (relTarget >= 0 && video.buffered && video.buffered.length > 0) {
      for (let i = 0; i < video.buffered.length; i++) {
        if (relTarget >= video.buffered.start(i) && relTarget + 1.0 <= video.buffered.end(i)) {
          video.currentTime = relTarget;
          syncCustomVideoControlsUI(true);
          return;
        }
      }
    }
    refreshRemuxSubtitleTracks(clamped);
    const loader = document.getElementById("video-loader");
    const loaderText = document.getElementById("video-loader-text");
    if (loader && loaderText) {
      const streamTag =
        state.activeSourceTab === "stremio"
          ? t("потока Stremio", "Stremio stream")
          : state.activeSourceTab === "backup4k"
          ? t("4K потока", "4K stream")
          : t("потока Оригинал", "Original stream");
      loaderText.textContent = t(
        `Перемотка ${streamTag} на ${formatTime(clamped)}...`,
        `Seeking ${streamTag} to ${formatTime(clamped)}...`
      );
      loader.classList.remove("hidden");
    }
    const remuxUrl = buildRemuxStreamEndpoint(state.remuxMeta, clamped);
    playVideoUrl(remuxUrl, 0, state.playerSessionId, { keepRemuxMeta: true, newRemuxOffsetSec: clamped });
    syncCustomVideoControlsUI(true);
    return;
  }

  video.currentTime = clamped;
  syncCustomVideoControlsUI(true);
}

export function switchRemuxAudioTrack(newAudioIdx) {
  const switchData = prepareRemuxAudioSwitch(newAudioIdx);
  if (!switchData) return;
  const { remuxUrl, cur, trObj, srcPrefix } = switchData;
  syncCustomControlPopovers();

  const loader = document.getElementById("video-loader");
  const loaderText = document.getElementById("video-loader-text");
  if (loader && loaderText) {
    loaderText.textContent = t(
      `Переключение аудиодорожки ${srcPrefix} (${trObj?.label || "AAC"})...`,
      `Switching ${srcPrefix} audio track (${trObj?.label || "AAC"})...`
    );
    loader.classList.remove("hidden");
  }
  playVideoUrl(remuxUrl, 0, state.playerSessionId, { keepRemuxMeta: true, newRemuxOffsetSec: cur });
  showToast(
    t(
      `Аудиодорожка ${srcPrefix}: ${trObj?.label || `#${newAudioIdx + 1}`}`,
      `${srcPrefix} audio track: ${trObj?.label || `#${newAudioIdx + 1}`}`
    )
  );
}

export async function probeAndPlay4KStream(
  rawStreamUrl,
  startSec = 0,
  relQuality = "4K UHD",
  sessionId = state.playerSessionId,
  options = {}
) {
  if (!rawStreamUrl || !state.isPlayerOpen || sessionId !== state.playerSessionId) return;
  const {
    targetListId = "backup-releases-list",
    audioBarId = "b4k-audio-tracks-bar",
    inlineSelectId = "b4k-inline-audio-select",
    sourcePrefix = "4K",
    extraSubtitles = [],
  } = options;
  const loader = document.getElementById("video-loader");
  const loaderText = document.getElementById("video-loader-text");
  hideVideoStreamError();
  if (loader && loaderText) {
    loaderText.textContent = t(
      `Подключение к ${relQuality} и подготовка звуковых дорожек (DTS/AC3 -> AAC)...`,
      `Connecting to ${relQuality} and preparing audio tracks (DTS/AC3 -> AAC)...`
    );
    loader.classList.remove("hidden");
  }

  if (state.remuxProbeAbortController) {
    try {
      state.remuxProbeAbortController.abort();
    } catch (err) { window.logDebug?.("PlayerStreams", err); }
  }
  const probeAbort = new AbortController();
  state.remuxProbeAbortController = probeAbort;

  let probe = null;
  try {
    const res = await fetch(
      `/api/remux-probe?src=${encodeURIComponent(rawStreamUrl)}&lang=${encodeURIComponent(
        state.appLang || "ru"
      )}`,
      { signal: probeAbort.signal }
    );
    if (res.ok) {
      probe = await res.json();
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;
  }

  if (probeAbort.signal.aborted || !state.isPlayerOpen || sessionId !== state.playerSessionId) return;

  if (Number(probe?.credits_start_sec) > 0) {
    state.probeCreditsStartSec = Number(probe.credits_start_sec);
  }

  const existingAudioBar = document.getElementById(audioBarId);
  if (existingAudioBar) existingAudioBar.remove();

  state.lastDirect4kSourceUrl = rawStreamUrl;
  const isRemoteLanClient = !["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
  const isLoopbackStream = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(rawStreamUrl);
  const hasCustomAudioShift = Math.abs(state.audioOffsetSec || 0) >= 0.005;

  if (probe && probe.ok && (probe.needs_remux || hasCustomAudioShift || (isRemoteLanClient && isLoopbackStream))) {
    const tracks = probe.audio_tracks || [];
    const chosenIdx = Number(probe.default_audio_index) || 0;
    const chosenTrack = tracks.find((t) => Number(t.audio_index) === chosenIdx) || tracks[0] || null;
    state.remuxMeta = {
      active: true,
      rawSourceUrl: rawStreamUrl,
      duration: Number(probe.duration) || 0,
      offsetSec: Math.max(0, Number(startSec) || 0),
      audioIndex: chosenIdx,
      videoCodec: probe.video_codec || "",
      audioCodec: chosenTrack?.codec || "",
      forceH264: false,
      channels: chosenTrack?.channels || 2,
      audioTracks: tracks,
      subtitleTracks: probe.subtitle_tracks || [],
      externalSubtitles: Array.isArray(extraSubtitles) ? extraSubtitles : [],
    };

    const studioSel = document.getElementById("select-studio");
    if (studioSel) {
      studioSel.innerHTML = "";
      tracks.forEach((tr) => {
        const opt = document.createElement("option");
        opt.value = String(tr.audio_index);
        opt.dataset.rawName = tr.raw_label || tr.label || "";
        opt.textContent = tr.label;
        if (Number(tr.audio_index) === chosenIdx) opt.selected = true;
        studioSel.appendChild(opt);
      });
    }
    if (chosenTrack?.label) {
      state.activeStudioName = `${sourcePrefix} (${relQuality}) · ${chosenTrack.label}`;
    } else {
      state.activeStudioName = `${sourcePrefix} (${relQuality})`;
    }

    state.subtitles = buildRemuxSubtitlesList(state.remuxMeta, state.remuxMeta.offsetSec);
    state.activeSubtitleIndex = pickPreferredSubtitleIndex(
      state.subtitles,
      getPlayerPrefs().preferredSubtitleLang
    );
    populateSubtitlesSelector(state.subtitles);
    syncCustomControlPopovers();
    document.getElementById(audioBarId)?.remove();

    const remuxUrl = buildRemuxStreamEndpoint(state.remuxMeta, state.remuxMeta.offsetSec);
    playVideoUrl(remuxUrl, 0, sessionId, { keepRemuxMeta: true });
    return;
  }

  const canUseRemuxFallback = Boolean(probe?.remux_available ?? state.remuxAvailable);
  if (
    canUseRemuxFallback &&
    (/\/stream\//i.test(rawStreamUrl) ||
      /\.mkv(\?|$)/i.test(rawStreamUrl) ||
      (isRemoteLanClient && isLoopbackStream))
  ) {
    state.remuxMeta = {
      active: true,
      rawSourceUrl: rawStreamUrl,
      duration: 0,
      offsetSec: Math.max(0, Number(startSec) || 0),
      audioIndex: 0,
      videoCodec: "",
      channels: 6,
      audioTracks: [],
      subtitleTracks: [],
      externalSubtitles: Array.isArray(extraSubtitles) ? extraSubtitles : [],
    };
    state.subtitles = buildRemuxSubtitlesList(state.remuxMeta, state.remuxMeta.offsetSec);
    state.activeSubtitleIndex = pickPreferredSubtitleIndex(
      state.subtitles,
      getPlayerPrefs().preferredSubtitleLang
    );
    populateSubtitlesSelector(state.subtitles);
    syncCustomControlPopovers();
    const remuxUrl = buildRemuxStreamEndpoint(state.remuxMeta, state.remuxMeta.offsetSec);
    playVideoUrl(remuxUrl, 0, sessionId, {
      keepRemuxMeta: true,
      isInstantSwap: Boolean(options?.isInstantSwap),
    });
    return;
  }

  state.remuxMeta = null;
  if (Array.isArray(extraSubtitles) && extraSubtitles.length > 0) {
    const mappedExtra = extraSubtitles.map((s) => ({
      lang: s.lang,
      url: s.url,
      direct_vtt: Boolean(s.direct_vtt || String(s.url || "").startsWith("/api/proxy-vtt?")),
    }));
    state.subtitles = mergeCustomExternalSubtitles(mappedExtra);
    state.activeSubtitleIndex = pickPreferredSubtitleIndex(
      state.subtitles,
      getPlayerPrefs().preferredSubtitleLang
    );
    populateSubtitlesSelector(state.subtitles);
  } else {
    state.subtitles = mergeCustomExternalSubtitles([]);
    state.activeSubtitleIndex = state.subtitles.length > 0 ? state.activeSubtitleIndex : -1;
    populateSubtitlesSelector(state.subtitles);
  }
  syncCustomControlPopovers();
  playVideoUrl(rawStreamUrl, startSec, sessionId, {
    isInstantSwap: Boolean(options?.isInstantSwap),
  });
}

export function renderStremioStreamsList(resumeTime = 0, autoLaunchFirst = false) {
  const data = state.stremioStreamsData;
  const listEl = document.getElementById("stremio-streams-list");
  const item = state.activeItem;
  if (!listEl || !data || !item) return;

  const sessionId = state.playerSessionId;
  const savedAudioBar = document.getElementById("stremio-audio-tracks-bar");
  listEl.innerHTML = "";

  const torrOnline = Boolean(data.torrserver_connected);
  const debridReady = Boolean(data.debrid_ready);
  const remuxAvail = Boolean(data.remux_available);
  const modeLabel = data.mode === "torbox" ? "TorBox HTTPS" : "Real-Debrid HTTPS";
  const torrAddr = String(data.torrserver_url || "http://127.0.0.1:8090");
  const allStreams = Array.isArray(data.streams) ? data.streams : [];
  const video = document.getElementById("native-video");

  const statusBanner = document.createElement("div");
  statusBanner.className = `atv-b4k-status-banner ${torrOnline || debridReady ? "is-online" : "is-offline"}`;
  if (debridReady) {
    statusBanner.innerHTML = `
      <span><strong>${escapeHtml(modeLabel)} ${t("активен", "active")}</strong>${
      remuxAvail ? t(" · ремукс звука DTS/AC3 -> AAC включен", " · DTS/AC3 -> AAC remux active") : ""
    } — ${t(
      "потоки аддонов Stremio и субтитры OpenSubtitles готовы",
      "Stremio addon streams and OpenSubtitles are ready"
    )}</span>
      <div class="atv-b4k-banner-actions">
        <button type="button" class="atv-btn-secondary atv-btn-xs btn-recheck-stremio">${t(
          "Обновить",
          "Refresh"
        )}</button>
      </div>
    `;
  } else if (torrOnline) {
    statusBanner.innerHTML = `
      <span><strong>${t("TorrServer подключен", "TorrServer connected")}</strong> (${escapeHtml(torrAddr)})${
      remuxAvail ? t(" · ремукс звука DTS/AC3 -> AAC активен", " · DTS/AC3 -> AAC remux active") : ""
    } — ${t(
      "прямое воспроизведение потоков Stremio с выбором дорожек и субтитров",
      "direct playback of Stremio streams with audio tracks and subtitles"
    )}</span>
      <div class="atv-b4k-banner-actions">
        <button type="button" class="atv-btn-secondary atv-btn-xs btn-recheck-stremio">${t(
          "Обновить",
          "Refresh"
        )}</button>
      </div>
    `;
  } else {
    statusBanner.innerHTML = `
      <span><strong>${t("TorrServer не запущен", "TorrServer not running")}</strong> (${escapeHtml(
      torrAddr
    )}). ${t(
      "Прямые HTTP-аддоны работают сразу; для торрент-аддонов запустите TorrServer или подключите Debrid.",
      "Direct HTTP addons work immediately; for P2P torrent addons start TorrServer or configure Debrid."
    )}</span>
      <div class="atv-b4k-banner-actions">
        <button type="button" class="atv-btn-secondary atv-btn-xs btn-recheck-stremio">${t(
          "Проверить снова",
          "Check again"
        )}</button>
      </div>
    `;
  }
  statusBanner.querySelector(".btn-recheck-stremio")?.addEventListener("click", () => {
    const { cur } = getEffectivePlaybackTiming(video);
    loadStremioStreams(cur > 5 ? cur : resumeTime);
  });
  listEl.appendChild(statusBanner);

  if (savedAudioBar && state.activeStremioStreamKey) {
    listEl.appendChild(savedAudioBar);
  }

  const filterMode = state.stremioFilter || "all";
  let filtered = allStreams.filter((st) => {
    const langs = Array.isArray(st.languages) ? st.languages : [];
    const voices = Array.isArray(st.detected_voices) ? st.detected_voices : [];
    const qual = String(st.quality || "");
    if (filterMode === "ru") {
      return langs.includes("RU") || voices.length > 0 || /rus|рус|дубляж|rezka|lostfilm/i.test(st.title || "");
    }
    if (filterMode === "orig") {
      return langs.includes("EN") || !langs.includes("RU");
    }
    if (filterMode === "4k") {
      return /4k|2160/i.test(qual);
    }
    if (filterMode === "1080p") {
      return /1080/i.test(qual);
    }
    return true;
  });

  if (filterMode === "orig") {
    filtered = filtered.slice().sort((a, b) => {
      const aPureEn = !(a.languages || []).includes("RU") ? 1 : 0;
      const bPureEn = !(b.languages || []).includes("RU") ? 1 : 0;
      if (bPureEn !== aPureEn) return bPureEn - aPureEn;
      return (Number(b.seeders) || 0) - (Number(a.seeders) || 0);
    });
  }

  if (filtered.length === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "atv-stream-empty-note";
    emptyEl.textContent =
      allStreams.length === 0
        ? data.error ||
          t(
            "Потоки в активных аддонах Stremio для этого тайтла не найдены. Вы можете подключить дополнительные manifest.json в настройках.",
            "No streams found in active Stremio addons for this title. You can add more manifest.json addons in Settings."
          )
        : t(
            "В выбранном фильтре нет раздач — переключите фильтр на «Все».",
            'No streams match the selected filter — switch the filter to "All".'
          );
    listEl.appendChild(emptyEl);
    return;
  }

  const syncActiveStremioRows = () => {
    listEl.querySelectorAll(".release-row").forEach((rEl) => {
      const rKey = rEl.dataset.releaseKey || "";
      const isPlaying = Boolean(rKey && rKey === state.activeStremioStreamKey);
      rEl.classList.toggle("active-release", isPlaying);
      const btn = rEl.querySelector(".btn-play-stremio-rel");
      if (btn) {
        btn.className = `${isPlaying ? "atv-btn-playing" : "atv-btn-primary"} atv-btn-xs btn-play-stremio-rel`;
        btn.innerHTML = isPlaying
          ? `${iconSvg("check", 11)}<span>${t("Сейчас играет", "Playing")}</span>`
          : `${iconSvg("play", 11)}<span>${t("Смотреть", "Watch")}</span>`;
      }
    });
  };

  const launchStremioStream = async (st, stKey, startAtSec) => {
    const loader = document.getElementById("video-loader");
    const loaderText = document.getElementById("video-loader-text");
    const addonLabel = st.addon_name || "Stremio";
    const qualLabel = st.quality || "1080p";

    if (st.stream_kind === "direct_http" && st.direct_url) {
      state.activeStremioStreamKey = stKey;
      state.activeStudioName = `${addonLabel} (${qualLabel})`;
      syncActiveStremioRows();
      await probeAndPlay4KStream(st.direct_url, startAtSec, qualLabel, sessionId, {
        targetListId: "stremio-streams-list",
        audioBarId: "stremio-audio-tracks-bar",
        inlineSelectId: "stremio-inline-audio-select",
        sourcePrefix: addonLabel,
        extraSubtitles: state.externalStremioSubs,
      });
      return;
    }

    if (!st.magnet && !st.info_hash) return;
    if (state.stremioResolveAbortController) {
      try {
        state.stremioResolveAbortController.abort();
      } catch (err) { window.logDebug?.("PlayerStreams", err); }
    }
    const resolveAbort = new AbortController();
    state.stremioResolveAbortController = resolveAbort;
    if (loader && loaderText) {
      loaderText.textContent = t(
        `Подключение к потоку ${addonLabel} (${qualLabel})...`,
        `Connecting to ${addonLabel} stream (${qualLabel})...`
      );
      loader.classList.remove("hidden");
    }
    try {
      const rRes = await fetch("/api/stremio/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: resolveAbort.signal,
        body: JSON.stringify({
          id: item.id || "",
          magnet: st.magnet || "",
          info_hash: st.info_hash || "",
          file_idx: st.file_idx,
          filename_hint: st.filename_hint || "",
          title: item.title || item.orig_title || "",
          orig_title: item.orig_title || "",
          genres: item.genres || state.activeMeta?.genres || [],
          age_rating: item.age_rating || state.activeMeta?.age_rating || "",
          media_type: item.media_type || "movie",
          season: state.activeSeason,
          episode: state.activeEpisode,
        }),
      });
      const rJson = await rRes.json();
      if (!state.isPlayerOpen || sessionId !== state.playerSessionId || state.activeSourceTab !== "stremio") return;
      if (!rJson.ok || !rJson.stream_url) {
        if (!state.failedStremioKeys) state.failedStremioKeys = new Set();
        state.failedStremioKeys.add(stKey);
        if (state.failedStremioKeys.size <= 2 && Array.isArray(state._filteredStremioCandidates)) {
          const nextCand = state._filteredStremioCandidates.find(
            (c) => c.playable && !state.failedStremioKeys.has(c.stKey)
          );
          if (nextCand) {
            showToast(
              t(
                "Переключение на следующую доступную раздачу Stremio...",
                "Switching to the next available Stremio stream..."
              )
            );
            return await launchStremioStream(nextCand.st, nextCand.stKey, startAtSec);
          }
        }
        loader?.classList.add("hidden");
        showToast(rJson.error || t("Не удалось подготовить поток Stremio", "Could not prepare Stremio stream"));
        return;
      }
      state.activeStremioStreamKey = stKey;
      state.activeStudioName = `${addonLabel} (${qualLabel})`;
      syncActiveStremioRows();
      await probeAndPlay4KStream(rJson.stream_url, startAtSec, qualLabel, sessionId, {
        targetListId: "stremio-streams-list",
        audioBarId: "stremio-audio-tracks-bar",
        inlineSelectId: "stremio-inline-audio-select",
        sourcePrefix: addonLabel,
        extraSubtitles: state.externalStremioSubs,
      });
    } catch (err) {
      if (err && err.name === "AbortError") return;
      loader?.classList.add("hidden");
      showToast(t("Ошибка при подключении к потоку Stremio", "Error connecting to Stremio stream"));
    }
  };

  filtered.forEach((st, idx) => {
    const stKey = String(st.id || st.info_hash || `st_${idx}_${st.title || ""}`);
    const canPlayDirect = Boolean(
      (st.stream_kind === "direct_http" && st.direct_url) ||
        ((torrOnline || debridReady) && (st.magnet || st.info_hash))
    );
    const magnetUri = String(st.magnet || "");
    const langs = Array.isArray(st.languages) ? st.languages : [];
    const voices = Array.isArray(st.detected_voices) ? st.detected_voices.slice(0, 3) : [];
    const is4k = /4k|2160/i.test(st.quality || "");

    const metaParts = [st.quality || "1080p"];
    if (st.size) {
      const szText = isEn()
        ? String(st.size).replace(/ГБ/g, "GB").replace(/МБ/g, "MB").replace(/ТБ/g, "TB")
        : String(st.size);
      metaParts.push(szText);
    }
    if (st.stream_kind === "direct_http") {
      metaParts.push(t("Прямой HTTPS", "Direct HTTPS"));
    } else if (Number(st.seeders) > 0) {
      metaParts.push(`${t("Сиды:", "Seeders:")} ${st.seeders}`);
    }
    if (st.tracker) metaParts.push(st.tracker);

    const badgesHtml = [
      `<span class="atv-stremio-badge is-addon">${escapeHtml(st.addon_name || "Stremio")}</span>`,
      is4k ? `<span class="atv-stremio-badge is-4k">${escapeHtml(st.quality)}</span>` : "",
      langs.length > 0
        ? `<span class="atv-stremio-badge is-ru">${escapeHtml(langs.join(" + "))}</span>`
        : "",
      ...voices.map((v) => `<span class="atv-stremio-badge is-voice">${escapeHtml(translateStudioName(v))}</span>`),
    ]
      .filter(Boolean)
      .join("");

    const row = document.createElement("div");
    row.className = "release-row";
    row.dataset.releaseKey = stKey;
    row.innerHTML = `
      <div class="release-info">
        <div class="release-title">${escapeHtml(st.title || displayTitle(item))}</div>
        <div class="release-meta">${escapeHtml(metaParts.join(" · "))}</div>
        <div class="atv-stremio-badges-row">${badgesHtml}</div>
      </div>
      <div class="release-actions">
        ${
          magnetUri
            ? `<button type="button" class="atv-btn-secondary atv-btn-xs btn-copy-magnet" title="${escapeAttr(
                t("Скопировать Magnet-ссылку", "Copy Magnet link")
              )}">Magnet</button>`
            : ""
        }
        ${
          canPlayDirect
            ? `<button type="button" class="atv-btn-primary atv-btn-xs btn-play-stremio-rel">${iconSvg(
                "play",
                11
              )}<span>${t("Смотреть", "Watch")}</span></button>`
            : magnetUri
            ? `<button type="button" class="atv-btn-primary atv-btn-xs btn-open-magnet" title="${escapeAttr(
                t("Открыть Magnet-ссылку", "Open Magnet link")
              )}">${iconSvg("external", 11)}<span>${t("Открыть Magnet", "Open Magnet")}</span></button>`
            : ""
        }
      </div>
    `;

    row.querySelector(".btn-copy-magnet")?.addEventListener("click", async () => {
      const ok = await copyTextToClipboard(magnetUri);
      if (ok) {
        showToast(
          t(
            `Magnet-ссылка скопирована (${st.quality || "Stremio"})`,
            `Magnet link copied (${st.quality || "Stremio"})`
          )
        );
      } else {
        showToast(t("Не удалось скопировать Magnet-ссылку", "Could not copy Magnet link"));
      }
    });
    row.querySelector(".btn-open-magnet")?.addEventListener("click", () => {
      window.location.href = magnetUri;
    });
    row.querySelector(".btn-play-stremio-rel")?.addEventListener("click", () => {
      if (state.activeStremioStreamKey === stKey && video && video.getAttribute("src")) {
        if (video.paused) video.play().catch(() => {});
        return;
      }
      const { cur } = getEffectivePlaybackTiming(video);
      launchStremioStream(st, stKey, cur > 5 ? cur : resumeTime);
    });
    listEl.appendChild(row);
  });

  const failedSet = state.failedStremioKeys instanceof Set ? state.failedStremioKeys : new Set();
  state._filteredStremioCandidates = filtered.map((st, idx) => ({
    st,
    stKey: String(st.id || st.info_hash || `st_${idx}_${st.title || ""}`),
    playable: Boolean(
      (st.stream_kind === "direct_http" && st.direct_url) ||
        ((torrOnline || debridReady) && (st.magnet || st.info_hash))
    ),
  }));
  state._launchStremioStreamCandidate = (st, stKey, startAtSec) =>
    launchStremioStream(st, stKey, startAtSec);

  const firstPlayableEntry = state._filteredStremioCandidates.find(
    (c) => c.playable && !failedSet.has(c.stKey)
  );
  const shouldAutoLaunchStremio = Boolean(
    autoLaunchFirst &&
      firstPlayableEntry &&
      video &&
      ((!video.getAttribute("src") && !state.hlsInstance) || state.forceAutoLaunchNextStream)
  );
  if (shouldAutoLaunchStremio) {
    state.forceAutoLaunchNextStream = false;
    launchStremioStream(firstPlayableEntry.st, firstPlayableEntry.stKey, resumeTime);
  } else {
    syncActiveStremioRows();
  }
}

export async function loadStremioStreams(resumeTime = 0, options = {}) {
  if (!state.activeItem || !state.isPlayerOpen) return;
  const sessionId = state.playerSessionId;
  const item = state.activeItem;
  hideVideoStreamError();
  state.remuxMeta = null;
  state.activeStremioStreamKey = "";
  state.failedStremioKeys = new Set();

  const listEl = document.getElementById("stremio-streams-list");
  const imdbBadge = document.getElementById("stremio-imdb-badge");
  const subsBadge = document.getElementById("stremio-subs-badge");
  if (imdbBadge) imdbBadge.classList.add("hidden");
  if (subsBadge) subsBadge.classList.add("hidden");
  if (listEl) {
    listEl.innerHTML = `<div class="atv-stream-empty-note">${escapeHtml(
      t(
        `Запрос потоков и субтитров из аддонов Stremio для «${displayTitle(item)}»...`,
        `Fetching Stremio streams and subtitles for "${displayTitle(item)}"...`
      )
    )}</div>`;
  }

  if (state.streamAbortController) {
    try {
      state.streamAbortController.abort();
    } catch (err) { window.logDebug?.("PlayerStreams", err); }
  }
  const abortController = new AbortController();
  state.streamAbortController = abortController;

  const preloadCandidateKey =
    item.media_type === "series"
      ? buildNextEpisodePreloadKey(item, state.activeSeason, state.activeEpisode, "stremio")
      : "";
  const hasWarmPreload = Boolean(
    preloadCandidateKey &&
      state.preloadedNextEpisode &&
      state.preloadedNextEpisode.tab === "stremio" &&
      state.preloadedNextEpisode.key === preloadCandidateKey &&
      state.preloadedNextEpisode.data &&
      Date.now() - (state.preloadedNextEpisode.fetchedAt || 0) < 900000
  );

  try {
    let data;
    if (hasWarmPreload) {
      data = state.preloadedNextEpisode.data;
      state.preloadedNextEpisode = null;
    } else {
      const params = new URLSearchParams({
        id: item.id || "",
        title: item.title || "",
        orig_title: item.orig_title || "",
        imdb_id: item.imdb_id || "",
        year: String(item.year || ""),
        media_type: item.media_type || "movie",
        season: String(state.activeSeason || 1),
        episode: String(state.activeEpisode || 1),
        lang: state.appLang || "ru",
      });
      const res = await fetch(`/api/stremio/streams?${params.toString()}`, {
        signal: abortController.signal,
      });
      data = await res.json();
      if (!res.ok || data?.ok === false || data?.error) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
    }
    if (!state.isPlayerOpen || sessionId !== state.playerSessionId || state.activeSourceTab !== "stremio") {
      return;
    }

    if (data.imdb_id) {
      item.imdb_id = data.imdb_id;
      if (imdbBadge) {
        imdbBadge.textContent = `IMDb ${data.imdb_id}`;
        imdbBadge.classList.remove("hidden");
      }
    }
    const extSubs = Array.isArray(data.subtitles) ? data.subtitles : [];
    state.externalStremioSubs = extSubs;
    if (subsBadge && extSubs.length > 0) {
      subsBadge.textContent = t(`Субтитры: ${extSubs.length}`, `Subtitles: ${extSubs.length}`);
      subsBadge.classList.remove("hidden");
    }

    if (item.media_type === "series") {
      if (data.episodes_titles && Object.keys(data.episodes_titles).length > 0) {
        state.episodesTitles = { ...data.episodes_titles, ...(state.episodesTitles || {}) };
      }
      if (data.episodes_meta && Object.keys(data.episodes_meta).length > 0) {
        state.episodesMeta = { ...data.episodes_meta, ...(state.episodesMeta || {}) };
      }
      if (data.seasons_map && Object.keys(data.seasons_map).length > 0) {
        const curSeasonKey = String(state.activeSeason || 1);
        const existingCurCount = state.seasonsMap?.[curSeasonKey]?.length || 0;
        const incomingCurCount = data.seasons_map?.[curSeasonKey]?.length || 0;
        if (Object.keys(state.seasonsMap || {}).length === 0 || incomingCurCount > existingCurCount) {
          state.seasonsMap = data.seasons_map;
        }
      }
      populateSeasonEpisodeSelectors(item, state.seasonsMap);
      updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);
    }

    state.torrserverConnected = Boolean(data.torrserver_connected);
    state.remuxAvailable = Boolean(data.remux_available);
    state.stremioStreamsData = data;
    renderStremioStreamsList(resumeTime, true);
  } catch (err) {
    if (err && err.name === "AbortError") return;
    console.error("Stremio streams error:", err);
    if (listEl) {
      listEl.innerHTML = `<div class="atv-stream-empty-note">${t(
        "Не удалось получить ответ от аддонов Stremio. Проверьте соединение или настройки аддонов.",
        "Could not reach Stremio addons. Check your connection or addon settings."
      )}</div>`;
    }
  }
}

export async function loadBackup4KReleases(resumeTime = 0, forceRefresh = false, options = {}) {
  if (!state.activeItem || !state.isPlayerOpen) return;
  const sessionId = state.playerSessionId;
  const item = state.activeItem;
  hideVideoStreamError();
  const listEl = document.getElementById("backup-releases-list");
  const cacheKey = `${item.rezka_id || item.id || item.title}:${state.activeSeason}:${state.activeEpisode}:${
    state.appLang || "ru"
  }`;
  const cachedEntry =
    !forceRefresh && state.backup4kReleasesCache ? state.backup4kReleasesCache[cacheKey] : null;
  const hasFreshCache = Boolean(
    cachedEntry && cachedEntry.data && Date.now() - Number(cachedEntry.ts || 0) < 300000
  );

  const preloadCandidateKey =
    item.media_type === "series"
      ? buildNextEpisodePreloadKey(
          item,
          state.activeSeason,
          state.activeEpisode,
          `backup4k:${state.active4kReleaseKey || state.preferred4kReleaseKey || "auto"}`
        )
      : "";
  const hasWarmPreload = Boolean(
    !forceRefresh &&
      preloadCandidateKey &&
      state.preloadedNextEpisode &&
      state.preloadedNextEpisode.tab === "backup4k" &&
      state.preloadedNextEpisode.key === preloadCandidateKey &&
      state.preloadedNextEpisode.streamUrl &&
      Date.now() - (state.preloadedNextEpisode.fetchedAt || 0) < 900000
  );

  let warmDirectPlayed = false;
  if (hasWarmPreload) {
    const preloaded = state.preloadedNextEpisode;
    state.preloadedNextEpisode = null;
    state.active4kReleaseUrl = preloaded.streamUrl;
    state.active4kReleaseKey = preloaded.releaseKey;
    state.active4kRelease = preloaded.release;
    if (Array.isArray(preloaded.videoFiles) && preloaded.videoFiles.length > 0) {
      state.active4kVideoFiles = preloaded.videoFiles;
      state.active4kFileIndex = preloaded.fileIndex || 1;
    }
    state.activeStudioName = `4K Remux (${preloaded.quality || "4K"})`;
    warmDirectPlayed = true;
    probeAndPlay4KStream(preloaded.streamUrl, resumeTime, preloaded.quality || "4K", sessionId, {
      extraSubtitles: state.external4kSubs || [],
      isInstantSwap: Boolean(options?.isInstantSwap),
    });
  }

  if (!hasFreshCache && !warmDirectPlayed) {
    listEl.innerHTML = `<div class="atv-stream-empty-note atv-stream-loading-row"><div class="atv-spinner atv-spinner-inline"></div><span>${escapeHtml(
      t(
        `Поиск 4K UHD / BDRemux раздач для «${displayTitle(item)}»...`,
        `Searching 4K UHD / BDRemux releases for "${displayTitle(item)}"...`
      )
    )}</span></div>`;
  }

  const syncActiveReleaseRows = () => {
    listEl.querySelectorAll(".release-row").forEach((rEl) => {
      const rKey = rEl.dataset.releaseKey || "";
      const isPlaying = Boolean(rKey && rKey === state.active4kReleaseKey);
      rEl.classList.toggle("active-release", isPlaying);
      const btn = rEl.querySelector(".btn-play-4k-rel");
      if (btn) {
        btn.className = `${isPlaying ? "atv-btn-playing" : "atv-btn-primary"} atv-btn-xs btn-play-4k-rel`;
        btn.innerHTML = isPlaying
          ? `${iconSvg("check", 11)}<span>${t("Сейчас играет", "Playing")}</span>`
          : `${iconSvg("play", 11)}<span>${t("Смотреть 4K", "Watch 4K")}</span>`;
      }
    });
  };

  if (state.backup4kAbortController) {
    try {
      state.backup4kAbortController.abort();
    } catch (err) { window.logDebug?.("PlayerStreams", err); }
  }
  const b4kAbort = new AbortController();
  state.backup4kAbortController = b4kAbort;

  try {
    let data;
    if (hasFreshCache) {
      data = cachedEntry.data;
    } else {
      const params = new URLSearchParams({
        id: String(item.id || ""),
        imdb_id: String(item.imdb_id || ""),
        rezka_id: String(item.rezka_id || ""),
        rezka_url: item.rezka_url || "",
        title: item.title,
        orig_title: item.orig_title || "",
        year: String(item.year || ""),
        media_type: item.media_type || "movie",
        season: String(state.activeSeason),
        episode: String(state.activeEpisode),
        lang: state.appLang || "ru",
      });
      const res = await fetch(`/api/backup-streams?${params.toString()}`, {
        signal: b4kAbort.signal,
      });
      data = await res.json();
      if (!res.ok || data?.ok === false || data?.error) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      if (!state.backup4kReleasesCache) state.backup4kReleasesCache = {};
      if (Array.isArray(data?.releases)) {
        state.backup4kReleasesCache[cacheKey] = { ts: Date.now(), data };
      }
    }

    if (!state.isPlayerOpen || sessionId !== state.playerSessionId || state.activeSourceTab !== "backup4k") return;

    if (data.imdb_id && !item.imdb_id) {
      item.imdb_id = data.imdb_id;
    }
    if (item.media_type === "series") {
      if (data.episodes_titles && Object.keys(data.episodes_titles).length > 0) {
        state.episodesTitles = { ...data.episodes_titles, ...(state.episodesTitles || {}) };
      }
      if (data.episodes_meta && Object.keys(data.episodes_meta).length > 0) {
        state.episodesMeta = { ...data.episodes_meta, ...(state.episodesMeta || {}) };
      }
      if (data.seasons_map && Object.keys(data.seasons_map).length > 0) {
        const curSeasonKey = String(state.activeSeason || 1);
        const existingCurCount = state.seasonsMap?.[curSeasonKey]?.length || 0;
        const incomingCurCount = data.seasons_map?.[curSeasonKey]?.length || 0;
        if (Object.keys(state.seasonsMap || {}).length === 0 || incomingCurCount > existingCurCount) {
          state.seasonsMap = data.seasons_map;
        }
      }
      populateSeasonEpisodeSelectors(item, state.seasonsMap);
      updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);
    }

    state.external4kSubs = Array.isArray(data.subtitles) ? data.subtitles : [];
    listEl.innerHTML = "";
    const torrOnline = Boolean(data.torrserver_connected);
    const debridReady = Boolean(data.debrid_ready);
    const remuxAvail = Boolean(data.remux_available);
    const p2pStrict = Boolean(data.p2p_strict || state.countryProfile?.p2p_strict);
    state.torrserverConnected = torrOnline;
    state.remuxAvailable = remuxAvail;
    const modeLabel = data.mode === "torbox" ? "TorBox HTTPS" : "Real-Debrid HTTPS";
    const torrAddr = String(data.torrserver_url || "http://127.0.0.1:8090");
    const fallbackUrl = String(data.fallback_stream_url || "");
    const releases = data.releases || [];
    const video = document.getElementById("native-video");
    const p2pStrictSuffix =
      p2pStrict && !debridReady
        ? ` · ${t(
            "В вашей стране строгий мониторинг P2P: рекомендуется облако Real-Debrid / TorBox или VPN",
            "Strict P2P monitoring in your country: Real-Debrid / TorBox cloud or VPN recommended"
          )}`
        : "";

    const statusBanner = document.createElement("div");
    statusBanner.className = `atv-b4k-status-banner ${torrOnline || debridReady ? "is-online" : "is-offline"}`;
    if (debridReady) {
      statusBanner.innerHTML = `
        <span><strong>${escapeHtml(modeLabel)} ${t("активен", "active")}</strong>${
        remuxAvail ? t(" · ремукс звука DTS/AC3 -> AAC включен", " · DTS/AC3 -> AAC remux active") : ""
      } — ${t(
        "прямое облачное воспроизведение 4K без P2P",
        "direct cloud 4K playback without P2P"
      )}</span>
        <div class="atv-b4k-banner-actions">
          <button type="button" class="atv-btn-secondary atv-btn-xs btn-recheck-torr">${t("Обновить", "Refresh")}</button>
        </div>
      `;
    } else if (torrOnline) {
      statusBanner.innerHTML = `
        <span><strong>${t("TorrServer подключен", "TorrServer connected")}</strong> (${escapeHtml(torrAddr)})${
        remuxAvail ? t(" · ремукс звука DTS/AC3 -> AAC активен", " · DTS/AC3 -> AAC remux active") : ""
      } — ${t(
        "прямое воспроизведение 4K UHD BDRemux со звуком и выбором дорожек",
        "direct 4K UHD BDRemux playback with audio track selection"
      )}${escapeHtml(p2pStrictSuffix)}</span>
        <div class="atv-b4k-banner-actions">
          <button type="button" class="atv-btn-secondary atv-btn-xs btn-recheck-torr">${t("Обновить", "Refresh")}</button>
        </div>
      `;
    } else {
      statusBanner.innerHTML = `
        <span><strong>${t("TorrServer не запущен", "TorrServer not running")}</strong> (${escapeHtml(
        torrAddr
      )}). ${t(
        "Запустите TorrServer или укажите ключ Real-Debrid / TorBox в настройках сети.",
        "Start TorrServer or enter a Real-Debrid / TorBox API key in Network settings."
      )}${escapeHtml(p2pStrictSuffix)}</span>
        <div class="atv-b4k-banner-actions">
          ${
            fallbackUrl
              ? `<button type="button" class="atv-btn-secondary atv-btn-xs btn-play-hdrezka-fallback">${iconSvg(
                  "play",
                  10
                )}<span>${t("Резервный 1080p (HDRezka)", "Fallback 1080p (HDRezka)")}</span></button>`
              : ""
          }
          <button type="button" class="atv-btn-secondary atv-btn-xs btn-recheck-torr">${t(
            "Проверить снова",
            "Check again"
          )}</button>
        </div>
      `;
    }
    statusBanner.querySelector(".btn-recheck-torr")?.addEventListener("click", () => {
      const { cur } = getEffectivePlaybackTiming(video);
      loadBackup4KReleases(cur > 5 ? cur : resumeTime, true);
    });
    statusBanner.querySelector(".btn-play-hdrezka-fallback")?.addEventListener("click", () => {
      const { cur } = getEffectivePlaybackTiming(video);
      state.active4kReleaseUrl = fallbackUrl;
      state.active4kReleaseKey = "hdrezka_fallback";
      state.activeStudioName = t("HDRezka 1080p (Резерв)", "HDRezka 1080p (Fallback)");
      syncActiveReleaseRows();
      playVideoUrl(fallbackUrl, cur > 5 ? cur : resumeTime, sessionId);
      showToast(t("Запущен резервный поток 1080p (HDRezka)", "Started 1080p fallback stream (HDRezka)"));
    });
    listEl.appendChild(statusBanner);

    if (releases.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "atv-stream-empty-note";
      emptyEl.textContent = t(
        "Проверенные 4K / BDRemux раздачи не найдены (низкокачественные CamRip и TS отфильтрованы).",
        "No verified 4K / BDRemux releases found (low-quality CamRip and TS streams are filtered out)."
      );
      listEl.appendChild(emptyEl);
      return;
    }

    const renderTorrentFilesBar = (activeRel, activeRelKey) => {
      document.getElementById("b4k-files-bar")?.remove();
      const vFiles = Array.isArray(state.active4kVideoFiles) ? state.active4kVideoFiles : [];
      if (vFiles.length <= 1) return;
      const filesBar = document.createElement("div");
      filesBar.className = "atv-b4k-files-bar";
      filesBar.id = "b4k-files-bar";
      const curFid = Number(state.active4kFileIndex) || Number(vFiles[0]?.id) || 1;
      const optionsHtml = vFiles
        .map((vf, i) => {
          const fid = Number(vf.id) || i + 1;
          const epTag =
            Number(vf.episode) > 0
              ? `${t(`Серия ${vf.episode}`, `Episode ${vf.episode}`)} · `
              : "";
          const szTag = vf.size ? ` · ${vf.size}` : "";
          const label = `${epTag}${vf.name || `#${fid}`}${szTag}`;
          return `<option value="${fid}"${fid === curFid ? " selected" : ""}>${escapeHtml(label)}</option>`;
        })
        .join("");
      filesBar.innerHTML = `
        <span class="atv-b4k-files-label">${escapeHtml(
          t(`Файл в раздаче (${vFiles.length}):`, `File in release (${vFiles.length}):`)
        )}</span>
        <div class="atv-select-group atv-b4k-files-select-group">
          <select id="b4k-file-select" title="${escapeAttr(
            t("Выбрать видеофайл внутри 4K раздачи", "Choose video file inside 4K release")
          )}">${optionsHtml}</select>
        </div>
      `;
      statusBanner.insertAdjacentElement("afterend", filesBar);
      initCustomSelects(filesBar);
      const selEl = filesBar.querySelector("#b4k-file-select");
      if (selEl) {
        selEl.onchange = () => {
          const pickedFid = parseInt(selEl.value, 10) || 1;
          const pickedObj = vFiles.find((f) => Number(f.id) === pickedFid);
          if (pickedObj && Number(pickedObj.episode) > 0 && item.media_type === "series") {
            state.activeEpisode = Number(pickedObj.episode);
            populateSeasonEpisodeSelectors(item, state.seasonsMap);
            updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);
            updateMiniPlayerTitle();
          }
          launchRelease(activeRel, activeRelKey, 0, pickedFid);
        };
      }
    };

    const launchRelease = async (rel, relKey, startAtSec, explicitFileIndex = null) => {
      let rawUrl = String(rel.stream_url || "");
      state.preferred4kReleaseKey = relKey;
      if (rel.stream_kind === "torrserver" && rel.magnet && torrOnline) {
        if (state.stremioResolveAbortController) {
          try {
            state.stremioResolveAbortController.abort();
          } catch (err) { window.logDebug?.("PlayerStreams", err); }
        }
        const torrAbort = new AbortController();
        state.stremioResolveAbortController = torrAbort;
        const loader = document.getElementById("video-loader");
        const loaderText = document.getElementById("video-loader-text");
        if (loader && loaderText) {
          loaderText.textContent = t(
            item.media_type === "series"
              ? `Подключение к файлу Серии ${state.activeEpisode} (${rel.quality})...`
              : `Подключение к раздаче ${rel.quality}...`,
            item.media_type === "series"
              ? `Connecting to Episode ${state.activeEpisode} file (${rel.quality})...`
              : `Connecting to ${rel.quality} release...`
          );
          loader.classList.remove("hidden");
        }
        try {
          const tres = await fetch("/api/backup-streams/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: torrAbort.signal,
            body: JSON.stringify({
              id: item.id || "",
              title: item.title || "",
              orig_title: item.orig_title || "",
              genres: item.genres || state.activeMeta?.genres || [],
              age_rating: item.age_rating || state.activeMeta?.age_rating || "",
              magnet: rel.magnet,
              media_type: item.media_type || "movie",
              season: state.activeSeason,
              episode: state.activeEpisode,
              file_index: explicitFileIndex,
              filename_hint: rel.title || "",
              lang: state.appLang || "ru",
            }),
          });
          const tjson = await tres.json();
          if (!state.isPlayerOpen || sessionId !== state.playerSessionId || state.activeSourceTab !== "backup4k") return;
          if (!tres.ok || !tjson || !tjson.ok || !tjson.stream_url) {
            loader?.classList.add("hidden");
            showToast(
              tjson?.error ||
                t("Не удалось запустить поток TorrServer 4K", "Could not start TorrServer 4K stream")
            );
            return;
          }
          if (tjson && tjson.ok && tjson.stream_url) {
            rawUrl = tjson.stream_url;
            state.active4kVideoFiles = Array.isArray(tjson.video_files) ? tjson.video_files : [];
            state.active4kFileIndex = Number(tjson.file_index) || 1;
            if (
              item.media_type === "series" &&
              state.active4kVideoFiles.length > 1 &&
              (state.seasonsMap?.[String(state.activeSeason)]?.length || 0) <= 1
            ) {
              const synthEps = Array.from(
                new Set(
                  state.active4kVideoFiles.map((vf, idxPos) =>
                    Number(vf.episode) > 0 ? Number(vf.episode) : idxPos + 1
                  )
                )
              ).sort((a, b) => a - b);
              if (synthEps.length > 1) {
                state.seasonsMap = {
                  ...(state.seasonsMap || {}),
                  [String(state.activeSeason)]: synthEps,
                };
                populateSeasonEpisodeSelectors(item, state.seasonsMap);
                updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);
              }
            }
          }
        } catch (err) {
          if (err && err.name === "AbortError") return;
          loader?.classList.add("hidden");
          showToast(
            t("Ошибка подключения к локальному TorrServer", "Error connecting to local TorrServer")
          );
          return;
        }
      } else if (rel.stream_kind === "debrid" && rel.magnet) {
        state.active4kVideoFiles = [];
        document.getElementById("b4k-files-bar")?.remove();
        if (state.stremioResolveAbortController) {
          try {
            state.stremioResolveAbortController.abort();
          } catch (err) { window.logDebug?.("PlayerStreams", err); }
        }
        const debridAbort = new AbortController();
        state.stremioResolveAbortController = debridAbort;
        const loader = document.getElementById("video-loader");
        const loaderText = document.getElementById("video-loader-text");
        if (loader && loaderText) {
          loaderText.textContent = t(
            `Получение облачного потока 4K (${modeLabel})...`,
            `Resolving 4K cloud stream (${modeLabel})...`
          );
          loader.classList.remove("hidden");
        }
        try {
          const dres = await fetch("/api/debrid/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: debridAbort.signal,
            body: JSON.stringify({
              id: item.id || "",
              title: item.title || "",
              orig_title: item.orig_title || "",
              genres: item.genres || state.activeMeta?.genres || [],
              age_rating: item.age_rating || state.activeMeta?.age_rating || "",
              magnet: rel.magnet,
              media_type: item.media_type || "movie",
              season: state.activeSeason,
              episode: state.activeEpisode,
              provider: data.mode,
            }),
          });
          const djson = await dres.json();
          if (!state.isPlayerOpen || sessionId !== state.playerSessionId || state.activeSourceTab !== "backup4k") return;
          if (!djson.ok || !djson.stream_url) {
            loader?.classList.add("hidden");
            showToast(djson.error || t("Не удалось получить ссылку Debrid", "Could not resolve Debrid link"));
            return;
          }
          rawUrl = djson.stream_url;
        } catch (err) {
          if (err && err.name === "AbortError") return;
          loader?.classList.add("hidden");
          showToast(t("Ошибка соединения с сервисом Debrid", "Error connecting to Debrid service"));
          return;
        }
      } else {
        state.active4kVideoFiles = [];
        document.getElementById("b4k-files-bar")?.remove();
      }
      if (!rawUrl) return;
      state.active4kReleaseUrl = rawUrl;
      state.active4kReleaseKey = relKey;
      state.active4kRelease = rel;
      state.activeStudioName = `4K Remux (${rel.quality})`;
      syncActiveReleaseRows();
      renderTorrentFilesBar(rel, relKey);
      await probeAndPlay4KStream(rawUrl, startAtSec, rel.quality, sessionId, {
        extraSubtitles: state.external4kSubs || [],
      });
    };

    releases.forEach((rel, idx) => {
      const relKey = String(rel.info_hash || `rel_${idx}_${rel.title || ""}`);
      const canPlayDirect = Boolean(
        (torrOnline && rel.stream_url) || (debridReady && rel.stream_kind === "debrid" && rel.magnet)
      );
      const magnetUri = String(rel.magnet || "");
      const sizeText = translateSizeLabel(rel.size || "");
      const row = document.createElement("div");
      row.className = "release-row";
      row.dataset.streamUrl = rel.stream_url || "";
      row.dataset.releaseKey = relKey;
      row.innerHTML = `
        <div class="release-info">
          <div class="release-title">${escapeHtml(rel.title)}</div>
          <div class="release-meta">
            ${escapeHtml(rel.quality)} · ${escapeHtml(sizeText)} · ${t("Сиды:", "Seeders:")} ${escapeHtml(
        rel.seeders
      )} · ${escapeHtml(rel.tracker)}
          </div>
        </div>
        <div class="release-actions">
          ${
            magnetUri
              ? `<button type="button" class="atv-btn-secondary atv-btn-xs btn-copy-magnet" title="${escapeAttr(
                  t("Скопировать Magnet-ссылку раздачи", "Copy Magnet link")
                )}">Magnet</button>`
              : ""
          }
          ${
            canPlayDirect
              ? `<button type="button" class="atv-btn-primary atv-btn-xs btn-play-4k-rel">${iconSvg(
                  "play",
                  11
                )}<span>${t("Смотреть 4K", "Watch 4K")}</span></button>`
              : magnetUri
              ? `<button type="button" class="atv-btn-primary atv-btn-xs btn-open-magnet" title="${escapeAttr(
                  t(
                    "Открыть Magnet-ссылку в торрент-клиенте или TorrServer",
                    "Open Magnet link in torrent client or TorrServer"
                  )
                )}">${iconSvg("external", 11)}<span>${t("Открыть Magnet", "Open Magnet")}</span></button>`
              : ""
          }
        </div>
      `;

      row.querySelector(".btn-copy-magnet")?.addEventListener("click", async () => {
        const ok = await copyTextToClipboard(magnetUri);
        if (ok) {
          showToast(t(`Magnet-ссылка скопирована (${rel.quality})`, `Magnet link copied (${rel.quality})`));
        } else {
          showToast(t("Не удалось скопировать Magnet-ссылку", "Could not copy Magnet link"));
        }
      });

      row.querySelector(".btn-open-magnet")?.addEventListener("click", () => {
        window.location.href = magnetUri;
      });

      const playBtn = row.querySelector(".btn-play-4k-rel");
      if (playBtn) {
        playBtn.onclick = () => {
          if (state.active4kReleaseKey === relKey && video && video.getAttribute("src")) {
            if (video.paused) video.play().catch(() => {});
            return;
          }
          const { cur } = getEffectivePlaybackTiming(video);
          launchRelease(rel, relKey, cur > 5 ? cur : resumeTime);
        };
      }
      listEl.appendChild(row);
    });

    const preferredIdx = state.preferred4kReleaseKey
      ? releases.findIndex(
          (r, i) => String(r.info_hash || `rel_${i}_${r.title || ""}`) === state.preferred4kReleaseKey
        )
      : -1;
    const autoIdx = preferredIdx >= 0 ? preferredIdx : 0;
    const autoRel = releases[autoIdx] || null;
    const canAutoLaunch =
      Boolean(autoRel) &&
      ((torrOnline && !debridReady && Boolean(autoRel.stream_url)) ||
        (preferredIdx >= 0 && debridReady && autoRel.stream_kind === "debrid" && Boolean(autoRel.magnet)));

    if (
      !warmDirectPlayed &&
      state.activeSourceTab === "backup4k" &&
      canAutoLaunch &&
      video &&
      ((!video.getAttribute("src") && !state.hlsInstance) || state.forceAutoLaunchNextStream)
    ) {
      state.forceAutoLaunchNextStream = false;
      const targetKey = String(autoRel.info_hash || `rel_${autoIdx}_${autoRel.title || ""}`);
      launchRelease(autoRel, targetKey, resumeTime);
    } else {
      syncActiveReleaseRows();
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;
    console.error("Backup stream error:", err);
  }
}
