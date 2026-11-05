// CineFlow Player Watchdog & Anti-Freeze Subsystem
// Monitors frame progression, detects hardware video decoder stalls (A/V desync), and performs automated recovery.

import { state } from "./state.js?v=20261105v2";

export function clearVideoStallWatchdog() {
  if (state.stallWatchdogTimerId) {
    clearInterval(state.stallWatchdogTimerId);
    state.stallWatchdogTimerId = null;
  }
  if (state.waitingSpinnerTimerId) {
    clearTimeout(state.waitingSpinnerTimerId);
    state.waitingSpinnerTimerId = null;
  }
  state.lastObservedVideoFrames = null;
  state.lastVideoFramesAdvanceTs = 0;
  state.lastFreezeCheckMediaTime = null;
  state.videoFreezeCount = 0;
}

export function getRenderedVideoFrameCount(v) {
  if (!v) return -1;
  // 1. Standard HTML5 Video Playback Quality API (Chrome, Edge, Safari 8+)
  if (typeof v.getVideoPlaybackQuality === "function") {
    try {
      const q = v.getVideoPlaybackQuality();
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

export function initVideoFrameCounter(v) {
  if (!v || v._cfRvfcAttached) return;
  v._cfRvfcAttached = true;
  v._cfPresentedFrames = 0;
  if (typeof v.requestVideoFrameCallback === "function") {
    const onFrame = () => {
      v._cfPresentedFrames = (v._cfPresentedFrames || 0) + 1;
      v._cfLastFrameTs = Date.now();
      if (typeof v.requestVideoFrameCallback === "function") {
        try {
          v.requestVideoFrameCallback(onFrame);
        } catch (err) { window.logDebug?.("PlayerWatchdog", err); }
      }
    };
    try {
      v.requestVideoFrameCallback(onFrame);
    } catch (err) { window.logDebug?.("PlayerWatchdog", err); }
  }
}

export function recoverFrozenVideoPlayback(video, curT, attemptCount = 1) {
  if (!video || !state.isPlayerOpen) return;
  console.warn(
    `[CineFlow] Video picture freeze detected (audio playing, 0 frames presented for >1.7s). Auto-recovering (attempt ${attemptCount}) at ${Number(curT || 0).toFixed(2)}s`
  );

  // If HLS instance is active, attempt HLS internal recovery first
  if (state.hlsInstance && typeof state.hlsInstance.recoverMediaError === "function") {
    try {
      state.hlsInstance.recoverMediaError();
    } catch (err) { window.logDebug?.("PlayerWatchdog", err); }
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
    console.error("[CineFlow] Error recovering frozen video playback:", err);
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
