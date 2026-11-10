// Velarium Player Remux & Stream Pipeline Subsystem
// Handles FFmpeg live remux stream endpoints, audio offset shifts, probe timing, and dynamic audio track switching.

import { state } from "./state.js?v=20261110v3";
import { isEn } from "./i18n.js?v=20261110v3";
import { updatePlayerGearActiveDot } from "./audio-dsp.js?v=20261110v3";
import { syncCustomSelect } from "./utils.js?v=20261110v3";
import { refreshRemuxSubtitleTracks } from "./subtitles.js?v=20261110v3";

export function estimateItemDurationSec(item) {
  if (!item) return 3000;
  if (typeof item._cachedEstDurSec === "number" && item._cachedEstDurSec > 0) {
    return item._cachedEstDurSec;
  }
  let res = 0;
  const numMin = Number(item.duration_min);
  if (Number.isFinite(numMin) && numMin >= 10 && numMin <= 600) {
    res = numMin * 60;
  } else {
    const lbl = String(item.duration_label || "").trim();
    if (lbl) {
      const hMatch = lbl.match(/(\d+)\s*(?:ч|час|h|hr)/i);
      const mMatch = lbl.match(/(\d+)\s*(?:мин|min|m\b)/i);
      if (hMatch || mMatch) {
        const h = hMatch ? parseInt(hMatch[1], 10) || 0 : 0;
        const m = mMatch ? parseInt(mMatch[1], 10) || 0 : 0;
        const total = h * 3600 + m * 60;
        if (total >= 600) res = total;
      }
      if (!res) {
        const pureMin = lbl.match(/^(\d{2,3})$/);
        if (pureMin) {
          res = (parseInt(pureMin[1], 10) || 48) * 60;
        }
      }
    }
  }
  if (!res) {
    res = item.media_type === "series" ? 3000 : 7200;
  }
  try {
    item._cachedEstDurSec = res;
  } catch (_) {}
  return res;
}

export function buildRemuxStreamEndpoint(meta, startSec = 0) {
  if (!meta || !meta.rawSourceUrl) return "";
  const qs = new URLSearchParams({
    src: meta.rawSourceUrl,
    audio: String(meta.audioIndex || 0),
    start: String(Math.max(0, Math.round(startSec * 10) / 10)),
    vcodec: meta.videoCodec || "",
    acodec: meta.audioCodec || "",
    ch: String(meta.channels || 2),
  });
  if (Math.abs(state.audioOffsetSec || 0) >= 0.005) {
    qs.set("ashift", String(Math.round((Number(state.audioOffsetSec) || 0) * 1000) / 1000));
  }
  if (meta.forceH264) {
    qs.set("compat", "h264");
  }
  return `/api/remux-stream?${qs.toString()}`;
}

export function getEffectivePlaybackTiming(video = typeof document !== "undefined" ? document.getElementById("native-video") : null) {
  if (!video) return { cur: 0, dur: 0 };
  const rawCur = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const rawDur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  if (state.remuxMeta && state.remuxMeta.active) {
    const hasPendingSeek =
      typeof state.pendingRemuxSeekSec === "number" && Number.isFinite(state.pendingRemuxSeekSec);
    const effCur = hasPendingSeek
      ? Math.max(0, state.pendingRemuxSeekSec)
      : Math.max(0, (state.remuxMeta.offsetSec || 0) + rawCur);
    let totalDur = state.remuxMeta.duration > 10 ? state.remuxMeta.duration : 0;
    if (!(totalDur > 10)) {
      const est = estimateItemDurationSec(state.activeItem);
      const rawPlusOffset = rawDur > 60 ? (state.remuxMeta.offsetSec || 0) + rawDur : 0;
      totalDur = Math.max(est, rawPlusOffset, effCur + 120);
    } else if (effCur > totalDur) {
      totalDur = effCur + 30;
    }
    return { cur: Math.min(totalDur, effCur), dur: totalDur };
  }
  return { cur: rawCur, dur: rawDur };
}

export function formatAudioOffsetLabel(sec = state.audioOffsetSec) {
  const v = Math.round((Number(sec) || 0) * 100) / 100;
  const sign = v > 0.004 ? "+" : v < -0.004 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(2)} ${isEn() ? "s" : "с"}`;
}

export function syncAudioOffsetUI() {
  if (typeof document === "undefined") return;
  const val = Math.round((Number(state.audioOffsetSec) || 0) * 100) / 100;
  const lbl = formatAudioOffsetLabel(val);
  const el = document.getElementById("gear-audio-offset-val");
  if (el) {
    el.textContent = lbl;
    el.classList.toggle("is-offset-active", Math.abs(val) >= 0.005);
  }
  updatePlayerGearActiveDot();
}

export function clearRemuxDurationPoll() {
  if (state.remuxDurationReprobeTimer) {
    clearTimeout(state.remuxDurationReprobeTimer);
    state.remuxDurationReprobeTimer = null;
  }
  if (state.remuxDurationReprobeAbort) {
    try {
      state.remuxDurationReprobeAbort.abort();
    } catch (_) {}
    state.remuxDurationReprobeAbort = null;
  }
}

export function scheduleRemuxFullDurationProbe(sessionId = state.playerSessionId, onSync = null) {
  if (typeof document === "undefined") return;
  clearRemuxDurationPoll();
  if (!state.remuxMeta?.active || !state.remuxMeta.rawSourceUrl || state.remuxMeta.duration > 10) {
    return;
  }
  const targetRawUrl = state.remuxMeta.rawSourceUrl;
  const isLoopbackTorr = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(targetRawUrl);
  if (
    isLoopbackTorr &&
    Array.isArray(state.remuxMeta.audioTracks) &&
    state.remuxMeta.audioTracks.length > 0
  ) {
    // Never spawn a second concurrent ffprobe against a live loopback TorrServer stream mid-playback
    // when tracks are already known, because ffprobe seeks to the MKV tail and starves the video pipe.
    return;
  }
  const delayMs = isLoopbackTorr ? 6500 : 2600;
  state.remuxDurationReprobeTimer = setTimeout(async () => {
    state.remuxDurationReprobeTimer = null;
    if (
      !state.isPlayerOpen ||
      sessionId !== state.playerSessionId ||
      !state.remuxMeta?.active ||
      state.remuxMeta.rawSourceUrl !== targetRawUrl ||
      state.remuxMeta.duration > 10
    ) {
      return;
    }
    const reprobeAbort = new AbortController();
    state.remuxDurationReprobeAbort = reprobeAbort;
    try {
      const fullParam = isLoopbackTorr ? "" : "&full=1";
      const res = await fetch(
        `/api/remux-probe?src=${encodeURIComponent(targetRawUrl)}${fullParam}&lang=${encodeURIComponent(
          state.appLang || "ru"
        )}`,
        { signal: reprobeAbort.signal }
      );
      if (!res.ok) return;
      const probe = await res.json();
      if (
        !state.isPlayerOpen ||
        sessionId !== state.playerSessionId ||
        !state.remuxMeta?.active ||
        state.remuxMeta.rawSourceUrl !== targetRawUrl
      ) {
        return;
      }
      if (Number(probe?.duration) > 10) {
        state.remuxMeta.duration = Number(probe.duration);
      }
      if (Number(probe?.credits_start_sec) > 0) {
        state.remuxMeta.creditsStartSec = Number(probe.credits_start_sec);
        state.probeCreditsStartSec = Number(probe.credits_start_sec);
      }
      if (
        (!state.remuxMeta.audioTracks || state.remuxMeta.audioTracks.length === 0) &&
        Array.isArray(probe?.audio_tracks) &&
        probe.audio_tracks.length > 0
      ) {
        state.remuxMeta.audioTracks = probe.audio_tracks;
        const studioSel = document.getElementById("select-studio");
        if (studioSel) {
          studioSel.innerHTML = "";
          probe.audio_tracks.forEach((tr) => {
            const opt = document.createElement("option");
            opt.value = String(tr.audio_index);
            opt.textContent = tr.label;
            if (Number(tr.audio_index) === Number(state.remuxMeta.audioIndex)) opt.selected = true;
            studioSel.appendChild(opt);
          });
          syncCustomSelect(studioSel);
        }
      }
      if (
        (!state.remuxMeta.subtitleTracks || state.remuxMeta.subtitleTracks.length === 0) &&
        Array.isArray(probe?.subtitle_tracks) &&
        probe.subtitle_tracks.length > 0
      ) {
        state.remuxMeta.subtitleTracks = probe.subtitle_tracks;
        refreshRemuxSubtitleTracks(state.remuxMeta.offsetSec || 0);
      }
      if (typeof onSync === "function") {
        onSync();
      }
    } catch (err) { window.logDebug?.("PlayerRemux", err); }
  }, delayMs);
}

export function prepareRemuxAudioSwitch(newAudioIdx) {
  if (!state.remuxMeta || !state.remuxMeta.active) return null;
  const video = typeof document !== "undefined" ? document.getElementById("native-video") : null;
  const { cur } = getEffectivePlaybackTiming(video);
  const trObj = (state.remuxMeta.audioTracks || []).find((t) => Number(t.audio_index) === Number(newAudioIdx));
  state.remuxMeta.audioIndex = Number(newAudioIdx) || 0;
  state.remuxMeta.channels = trObj?.channels || 2;
  state.remuxMeta.audioCodec = trObj?.codec || "";
  refreshRemuxSubtitleTracks(cur);
  const srcPrefix = state.activeSourceTab === "stremio" ? "Stremio" : "4K";
  if (trObj?.label) {
    state.activeStudioName = `${srcPrefix} · ${trObj.label}`;
  }
  if (typeof document !== "undefined") {
    const inlineSel = document.getElementById("b4k-inline-audio-select");
    if (inlineSel) inlineSel.value = String(state.remuxMeta.audioIndex);
    const stremioInlineSel = document.getElementById("stremio-inline-audio-select");
    if (stremioInlineSel) stremioInlineSel.value = String(state.remuxMeta.audioIndex);
    const studioSel = document.getElementById("select-studio");
    if (studioSel) studioSel.value = String(state.remuxMeta.audioIndex);
  }
  const remuxUrl = buildRemuxStreamEndpoint(state.remuxMeta, cur);
  return { remuxUrl, cur, trObj, srcPrefix };
}
