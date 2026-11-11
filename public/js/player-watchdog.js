// Velarium Player Watchdog & Anti-Freeze Subsystem
// Monitors frame progression, detects hardware video decoder stalls (A/V desync), and performs automated recovery.

import { state } from "./state.js?v=20261111v1";

export function clearVideoStallWatchdog() {
  if (state.stallWatchdogTimerId) {
    clearInterval(state.stallWatchdogTimerId);
    state.stallWatchdogTimerId = null;
  }
  if (state.waitingSpinnerTimerId) {
    clearTimeout(state.waitingSpinnerTimerId);
    state.waitingSpinnerTimerId = null;
  }
  if (state._rebufferCushionTimerId) {
    clearInterval(state._rebufferCushionTimerId);
    state._rebufferCushionTimerId = null;
  }
  if (typeof document !== "undefined") {
    const v = document.getElementById("native-video");
    if (v && v._cfRvfcId && typeof v.cancelVideoFrameCallback === "function") {
      try {
        v.cancelVideoFrameCallback(v._cfRvfcId);
      } catch (_) {}
      v._cfRvfcId = null;
      v._cfRvfcAttached = false;
    }
  }
  state.lastRebufferWaitingTs = 0;
  cleanupAbrPreloadVideo();
  state.lastObservedVideoFrames = null;
  state.lastVideoFramesAdvanceTs = 0;
  state.lastFreezeCheckMediaTime = null;
  state.videoFreezeCount = 0;
  state.abrStableTicks = 0;
  state.abrLowBufferTicks = 0;
}

const _QUALITY_RANK_LOW_TO_HIGH = [
  "240p",
  "360p",
  "480p",
  "720p",
  "1080p",
  "1080p ultra",
  "2k",
  "1440p",
  "2160p",
  "4k",
];

const _QUALITY_NUM_RE = /(\d{3,4})p?/;
const _QUALITY_SCORE_CACHE = new Map();

function _qualityScore(qKey) {
  const norm = String(qKey || "").trim().toLowerCase();
  const cached = _QUALITY_SCORE_CACHE.get(norm);
  if (cached !== undefined) return cached;
  let score = 350;
  const exactIdx = _QUALITY_RANK_LOW_TO_HIGH.indexOf(norm);
  if (exactIdx >= 0) {
    score = exactIdx * 100;
  } else if (norm.includes("1080") && norm.includes("ultra")) {
    score = 500;
  } else {
    const numMatch = norm.match(_QUALITY_NUM_RE);
    if (numMatch) {
      const pVal = parseInt(numMatch[1], 10);
      if (pVal <= 240) score = 0;
      else if (pVal <= 360) score = 100;
      else if (pVal <= 480) score = 200;
      else if (pVal <= 720) score = 300;
      else if (pVal <= 1080) score = 400;
      else if (pVal <= 1440) score = 700;
      else score = 800;
    }
  }
  if (_QUALITY_SCORE_CACHE.size >= 200) {
    const oldestKey = _QUALITY_SCORE_CACHE.keys().next().value;
    if (oldestKey !== undefined) _QUALITY_SCORE_CACHE.delete(oldestKey);
  }
  _QUALITY_SCORE_CACHE.set(norm, score);
  return score;
}

const _QUALITIES_LADDER_CACHE = new WeakMap();

export function sortQualityKeysLowToHigh(qualitiesMap = state.qualities) {
  if (!qualitiesMap || typeof qualitiesMap !== "object") return [];
  const cached = _QUALITIES_LADDER_CACHE.get(qualitiesMap);
  if (cached) return [...cached];
  const keys = Object.keys(qualitiesMap).filter((k) => Boolean(qualitiesMap[k]));
  keys.sort((a, b) => _qualityScore(a) - _qualityScore(b));
  _QUALITIES_LADDER_CACHE.set(qualitiesMap, keys);
  return [...keys];
}

export function getAdjacentQualityKey(qualitiesMap, currentKey, direction = "down", ceilingKey = "") {
  const ladder = sortQualityKeysLowToHigh(qualitiesMap);
  if (ladder.length < 2) return null;
  const curIdx = ladder.indexOf(currentKey);
  if (curIdx < 0) return null;
  if (direction === "down") {
    return curIdx > 0 ? ladder[curIdx - 1] : null;
  }
  if (direction === "up") {
    if (curIdx + 1 >= ladder.length) return null;
    const nextKey = ladder[curIdx + 1];
    if (ceilingKey && _qualityScore(nextKey) > _qualityScore(ceilingKey)) {
      return null;
    }
    return nextKey;
  }
  return null;
}

export function cleanupAbrPreloadVideo() {
  state.abrSwitching = false;
  if (state.abrPreloadVideo) {
    try {
      state.abrPreloadVideo.onloadedmetadata = null;
      state.abrPreloadVideo.oncanplay = null;
      state.abrPreloadVideo.onerror = null;
      state.abrPreloadVideo.pause();
      state.abrPreloadVideo.removeAttribute("src");
      state.abrPreloadVideo.load();
    } catch (err) { window.logDebug?.("PlayerWatchdog", err); }
    state.abrPreloadVideo = null;
  }
}

export function evaluateAbrStepDecision(video, stalledMs = 0, nowMs = Date.now()) {
  if (
    !video ||
    state.abrAutoMode === false ||
    state.abrSwitching ||
    state.activeSourceTab !== "hdrezka" ||
    state.remuxMeta?.active
  ) {
    return null;
  }
  const qualities = state.qualities || {};
  const ladder = sortQualityKeysLowToHigh(qualities);
  if (ladder.length < 2) return null;

  const qualSel = typeof document !== "undefined" ? document.getElementById("select-quality") : null;
  const curKey = state.abrCurrentQuality || qualSel?.value || ladder[ladder.length - 1];
  const targetKey = state.abrTargetQuality || curKey;
  const fwdBuf = getVideoForwardBufferSec(video);
  state.abrLastForwardBufferSec = fwdBuf;

  const sinceLastSwitchMs = nowMs - (Number(state.abrLastSwitchTs) || 0);
  const curUrl = String(qualities[curKey] || state.currentStreamUrl || "");
  const isHlsStream = curUrl.includes(".m3u8") || Boolean(state.hlsInstance);

  // 1. Step-Down ONLY on genuine playback stall (never while frames are advancing smoothly!)
  // Progressive MP4 streams in WKWebView naturally keep a 1.8-2.5s forward buffer while playing smoothly;
  // stepping down when stalledMs === 0 causes false downshifts and 360p <-> 480p oscillation.
  const isGenuinelyStalling = stalledMs >= 2400 && fwdBuf < 0.9;

  if (isGenuinelyStalling) {
    state.abrLowBufferTicks = (state.abrLowBufferTicks || 0) + 1;
    state.abrStableTicks = 0;
    const minCooldownMs = isHlsStream ? 6500 : 12000;
    if (sinceLastSwitchMs >= minCooldownMs) {
      const lowerKey = getAdjacentQualityKey(qualities, curKey, "down", targetKey);
      if (lowerKey && qualities[lowerKey]) {
        state.abrLowBufferTicks = 0;
        if (!(state.abrDownshiftedQualities instanceof Set)) {
          state.abrDownshiftedQualities = new Set();
        }
        state.abrDownshiftedQualities.add(curKey);
        return {
          action: "downshift",
          targetKey: lowerKey,
          fromKey: curKey,
          fwdBuf,
        };
      }
    }
    return null;
  }

  state.abrLowBufferTicks = 0;

  // 2. Smooth Automatic Step-Up:
  // Never auto-upshift progressive MP4 streams mid-playback because replacing video.src wipes the browser buffer,
  // causes a brief freeze, and shifts encoded dimensions (360p <-> 480p ping-pong).
  if (!isHlsStream) {
    state.abrStableTicks = 0;
    return null;
  }

  if (_qualityScore(curKey) < _qualityScore(targetKey)) {
    const isBufferHealthy =
      stalledMs === 0 && (fwdBuf >= 18.0 || (video.readyState === 4 && fwdBuf >= 14.0));
    if (isBufferHealthy) {
      state.abrStableTicks = (state.abrStableTicks || 0) + 1;
      if (state.abrStableTicks >= 16 && sinceLastSwitchMs >= 25000) {
        const higherKey = getAdjacentQualityKey(qualities, curKey, "up", targetKey);
        const downshiftedSet =
          state.abrDownshiftedQualities instanceof Set ? state.abrDownshiftedQualities : null;
        if (higherKey && qualities[higherKey] && (!downshiftedSet || !downshiftedSet.has(higherKey))) {
          state.abrStableTicks = 0;
          return {
            action: "upshift",
            targetKey: higherKey,
            fromKey: curKey,
            fwdBuf,
          };
        }
      }
    } else if (fwdBuf < 8.0) {
      state.abrStableTicks = 0;
    }
  } else {
    state.abrStableTicks = 0;
  }

  return null;
}

export function getRenderedVideoFrameCount(v) {
  if (!v) return -1;
  // 1. Standard HTML5 Video Playback Quality API (Chrome, Edge, Safari 8+)
  if (typeof v.getVideoPlaybackQuality === "function") {
    try {
      const q = v.getVideoPlaybackQuality();
      if (q && typeof q.totalVideoFrames === "number" && q.totalVideoFrames > 0) {
        return q.totalVideoFrames;
      }
      if (typeof v.webkitDecodedFrameCount === "number" && v.webkitDecodedFrameCount > 0) {
        return v.webkitDecodedFrameCount;
      }
      if (q && typeof q.totalVideoFrames === "number") {
        return q.totalVideoFrames;
      }
    } catch (err) { window.logDebug?.("PlayerWatchdog", err); }
  }
  // 2. WebKit legacy decoded frame counter
  if (typeof v.webkitDecodedFrameCount === "number") {
    return v.webkitDecodedFrameCount;
  }
  // 3. Fallback to requestVideoFrameCallback counter
  if (typeof v._cfPresentedFrames === "number") {
    return v._cfPresentedFrames;
  }
  return -1;
}

export function stopVideoFrameCounter(
  v = typeof document !== "undefined" ? document.getElementById("native-video") : null
) {
  if (!v) return;
  if (v._cfRvfcId && typeof v.cancelVideoFrameCallback === "function") {
    try {
      v.cancelVideoFrameCallback(v._cfRvfcId);
    } catch (_) {}
  }
  v._cfRvfcId = null;
  v._cfRvfcAttached = false;
}

export function initVideoFrameCounter(v) {
  if (!v || v._cfRvfcAttached) return;
  if (
    typeof v.getVideoPlaybackQuality === "function" ||
    typeof v.webkitDecodedFrameCount === "number"
  ) {
    return;
  }
  v._cfRvfcAttached = true;
  v._cfPresentedFrames = 0;
  if (typeof v.requestVideoFrameCallback === "function") {
    const onFrame = () => {
      if (!state.isPlayerOpen && !state.isMiniPlayer && !state.isPipBackground) {
        v._cfRvfcAttached = false;
        v._cfRvfcId = null;
        return;
      }
      v._cfPresentedFrames = (v._cfPresentedFrames || 0) + 1;
      v._cfLastFrameTs = Date.now();
      if (typeof v.requestVideoFrameCallback === "function") {
        try {
          v._cfRvfcId = v.requestVideoFrameCallback(onFrame);
        } catch (err) { window.logDebug?.("PlayerWatchdog", err); }
      }
    };
    try {
      v._cfRvfcId = v.requestVideoFrameCallback(onFrame);
    } catch (err) { window.logDebug?.("PlayerWatchdog", err); }
  }
}

export function recoverFrozenVideoPlayback(video, curT, attemptCount = 1) {
  if (!video || !state.isPlayerOpen) return;
  console.warn(
    `[Velarium] Video picture freeze detected (audio playing, 0 frames presented for >1.7s). Auto-recovering (attempt ${attemptCount}) at ${Number(curT || 0).toFixed(2)}s`
  );

  // If HLS instance is active and gentle nudge already failed, attempt HLS internal recovery
  if (
    attemptCount >= 2 &&
    state.hlsInstance &&
    typeof state.hlsInstance.recoverMediaError === "function"
  ) {
    try {
      state.hlsInstance.recoverMediaError();
      return;
    } catch (err) { window.logDebug?.("PlayerWatchdog", err); }
  }

  if (state.remuxMeta && state.remuxMeta.active) {
    try {
      video.play().catch(() => {});
    } catch (_) {}
    return;
  }

  // Perform targeted seek to flush hardware video decoder queue and force keyframe resync
  try {
    const rawCur = Number.isFinite(curT)
      ? curT
      : (Number.isFinite(video.currentTime) ? video.currentTime : 0);
    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    let targetTime = rawCur;
    if (attemptCount === 1) {
      // First attempt: micro-nudge forward 40ms to flush pipeline without breaking audio continuity
      targetTime = dur > 0 && rawCur + 0.04 >= dur ? Math.max(0, rawCur - 0.05) : rawCur + 0.04;
    } else {
      // Subsequent attempts: jump backward 0.4s to re-sync from previous IDR keyframe
      targetTime = Math.max(0, rawCur - 0.4);
    }

    if (typeof video.fastSeek === "function" && attemptCount > 1) {
      video.fastSeek(targetTime);
    } else {
      video.currentTime = targetTime;
    }

    video.play().catch(() => {});
  } catch (err) {
    console.error("[Velarium] Error recovering frozen video playback:", err);
  }
}

export function getVideoForwardBufferSec(video) {
  if (!video || !video.buffered || video.buffered.length === 0) return 0;
  const cur = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  let ahead = 0;
  for (let i = 0; i < video.buffered.length; i++) {
    const bStart = video.buffered.start(i);
    const bEnd = video.buffered.end(i);
    if (bStart <= cur + 0.75 && bEnd >= cur) {
      ahead = Math.max(ahead, bEnd - cur);
    }
  }
  return ahead;
}

export function checkVideoPlaybackFreeze(video, curT, nowMs = Date.now()) {
  if (!video || video.readyState < 2) return false;
  const renderedFrames = getRenderedVideoFrameCount(video);
  if (renderedFrames < 0) return false;

  if (state.lastObservedVideoFrames == null) {
    state.lastObservedVideoFrames = renderedFrames;
    state.lastVideoFramesAdvanceTs = nowMs;
    state.lastFreezeCheckMediaTime = curT;
    return false;
  }

  if (renderedFrames > state.lastObservedVideoFrames) {
    state.lastObservedVideoFrames = renderedFrames;
    state.lastVideoFramesAdvanceTs = nowMs;
    state.lastFreezeCheckMediaTime = curT;
    state.videoFreezeCount = 0;
    return false;
  }

  const mediaAdvSec = curT - (state.lastFreezeCheckMediaTime ?? curT);
  const freezeDurationMs = nowMs - (state.lastVideoFramesAdvanceTs || nowMs);
  if (mediaAdvSec >= 0.75 && freezeDurationMs >= 1700) {
    const timeSinceLastRecover = nowMs - (state.lastVideoFreezeRecoverTs || 0);
    if (timeSinceLastRecover >= 2200) {
      state.lastVideoFreezeRecoverTs = nowMs;
      state.videoFreezeCount = (state.videoFreezeCount || 0) + 1;
      state.lastVideoFramesAdvanceTs = nowMs;
      state.lastFreezeCheckMediaTime = curT;
      recoverFrozenVideoPlayback(video, curT, state.videoFreezeCount);
      return true;
    }
  }
  return false;
}
