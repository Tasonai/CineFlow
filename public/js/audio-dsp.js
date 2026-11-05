import { PLAYER_PREFS_STORAGE_KEY, profileStorageKey, state } from "./state.js?v=20261105v5";
import { t } from "./i18n.js?v=20261105v5";
import { isIosOrIpadOs, showToast } from "./utils.js?v=20261105v5";
import {
  closePlayerModal,
  isStageFullscreen,
  playVideoUrl,
  setPipBackgroundMode,
  syncCustomVideoControlsUI,
  syncPipDockUI,
} from "./player.js?v=20261105v5";

export function getAudioPresetLabel(preset) {
  const map = {
    flat: t("Стандарт", "Standard"),
    voice: t("Чёткая речь", "Clear Voice"),
    night: t("Ночной режим", "Night Mode"),
    cinema: t("Кинотеатр", "Cinema"),
  };
  return map[preset] || t("Стандарт", "Standard");
}
export function getPlayerPrefs() {
  try {
    const storageKey = profileStorageKey(PLAYER_PREFS_STORAGE_KEY);
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) || {} : {};
    const rawVol = typeof parsed.volume === "number" ? Math.max(0, Math.min(1, parsed.volume)) : 1.0;
    // Self-heal if previous closePlayerModal / volumechange bug persisted volume=0 or muted=true
    const vol = rawVol <= 0.02 ? 0.85 : rawVol;
    if (parsed.muted === true || rawVol <= 0.02) {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ ...parsed, volume: vol, muted: false })
        );
      } catch (err) { window.logDebug?.("AudioDsp", err); }
    }
    const rate =
      typeof parsed.playbackRate === "number" && parsed.playbackRate >= 0.5 && parsed.playbackRate <= 3
        ? parsed.playbackRate
        : 1.0;
    const autoNext = typeof parsed.autoNextEpisode === "boolean" ? parsed.autoNextEpisode : true;
    const boost =
      typeof parsed.audioBoost === "number" && parsed.audioBoost >= 1 && parsed.audioBoost <= 4
        ? parsed.audioBoost
        : 1.0;
    const preset = ["flat", "voice", "night", "cinema"].includes(parsed.audioPreset)
      ? parsed.audioPreset
      : "flat";
    const prefQual =
      typeof parsed.preferredQuality === "string" && parsed.preferredQuality
        ? parsed.preferredQuality
        : "max";
    const prefSub =
      typeof parsed.preferredSubtitleLang === "string" ? parsed.preferredSubtitleLang : "off";
    const crop = ["contain", "cover", "zoom115", "fill"].includes(parsed.videoCrop)
      ? parsed.videoCrop
      : "contain";
    const subSize = ["small", "medium", "large", "xlarge"].includes(parsed.subSize)
      ? parsed.subSize
      : "medium";
    const subBg = ["semi", "solid", "none"].includes(parsed.subBg) ? parsed.subBg : "semi";
    const ambilight = typeof parsed.ambilightEnabled === "boolean" ? parsed.ambilightEnabled : true;
    const autoSkipIntro = typeof parsed.autoSkipIntro === "boolean" ? parsed.autoSkipIntro : true;
    const preferredSourceTab = ["hdrezka", "stremio", "backup4k"].includes(parsed.preferredSourceTab)
      ? parsed.preferredSourceTab
      : "";
    const sidebarCollapsed = Boolean(parsed.sidebarCollapsed);
    return {
      volume: vol,
      muted: false,
      playbackRate: rate,
      autoNextEpisode: autoNext,
      audioBoost: boost,
      audioPreset: preset,
      preferredQuality: prefQual,
      preferredSubtitleLang: prefSub,
      videoCrop: crop,
      subSize,
      subBg,
      ambilightEnabled: ambilight,
      autoSkipIntro,
      preferredSourceTab,
      sidebarCollapsed,
    };
  } catch (_) {
    return {
      volume: 1.0,
      muted: false,
      playbackRate: 1.0,
      autoNextEpisode: true,
      audioBoost: 1.0,
      audioPreset: "flat",
      preferredQuality: "max",
      preferredSubtitleLang: "off",
      videoCrop: "contain",
      subSize: "medium",
      subBg: "semi",
      ambilightEnabled: true,
      autoSkipIntro: true,
      preferredSourceTab: "",
    };
  }
}
export function savePlayerPrefs(patch) {
  try {
    const cur = getPlayerPrefs();
    const updated = { ...cur, ...patch };
    localStorage.setItem(profileStorageKey(PLAYER_PREFS_STORAGE_KEY), JSON.stringify(updated));
  } catch (err) { window.logDebug?.("AudioDsp", err); }
}
export function buildSoftClipLimiterCurve() {
  if (state.audioLimiterCurve) return state.audioLimiterCurve;
  // 65537 samples guarantees exact zero at midpoint index 32768 (zero DC offset).
  // Input is pre-scaled by 0.25 (-12 dB), so curve domain x in [-1, 1] maps real signal s = 4*x in [-4, 4].
  // Exact 1:1 linear identity up to |s| = 0.80 (-1.94 dBFS), C1-continuous tanh soft ceiling up to 0.96 (-0.35 dBFS).
  const n = 65537;
  const curve = new Float32Array(n);
  const threshold = 0.8;
  const ceiling = 0.96;
  const kneeSpan = ceiling - threshold;
  const half = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const x = (i - half) / half;
    const s = x * 4.0;
    const absS = Math.abs(s);
    if (absS <= threshold) {
      curve[i] = s;
    } else {
      const shaped = threshold + kneeSpan * Math.tanh((absS - threshold) / kneeSpan);
      curve[i] = s < 0 ? -shaped : shaped;
    }
  }
  curve[half] = 0;
  state.audioLimiterCurve = curve;
  return curve;
}
export function isAudioContextSuspendedLike(ctx = state.audioCtx) {
  return Boolean(ctx && (ctx.state === "suspended" || ctx.state === "interrupted"));
}

export function resumeAudioContextIfNeeded(ctx = state.audioCtx) {
  if (isAudioContextSuspendedLike(ctx) && typeof ctx.resume === "function") {
    ctx.resume().catch(() => {});
  }
}

let _audioWakeListenersBound = false;
function _bindAudioContextWakeListeners() {
  if (_audioWakeListenersBound || typeof document === "undefined" || typeof window === "undefined") {
    return;
  }
  _audioWakeListenersBound = true;
  const wakeIfPlaying = () => {
    if (!state.audioCtx) return;
    const v = document.getElementById("native-video");
    if (v && !v.paused && isAudioContextSuspendedLike(state.audioCtx)) {
      resumeAudioContextIfNeeded(state.audioCtx);
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) wakeIfPlaying();
  });
  window.addEventListener("focus", wakeIfPlaying);
}

export function ensureUnlockedAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  _bindAudioContextWakeListeners();
  if (!state.audioCtx) {
    try {
      state.audioCtx = new AudioContextClass({ latencyHint: "interactive" });
    } catch (_) {
      try {
        state.audioCtx = new AudioContextClass();
      } catch (__) {
        return null;
      }
    }
    if (state.audioCtx) {
      state.audioCtx.addEventListener("statechange", () => {
        if (state.audioCtx?.state === "running") {
          const v = document.getElementById("native-video");
          if (v && !v._cfSourceNode) {
            applyAudioBoostToVideo(v, state.audioBoost, state.audioPreset);
          }
        } else if (state.audioCtx?.state === "interrupted") {
          const v = document.getElementById("native-video");
          if (v && !v.paused && (typeof document === "undefined" || !document.hidden)) {
            resumeAudioContextIfNeeded(state.audioCtx);
          }
        }
      });
    }
  }
  if (isAudioContextSuspendedLike(state.audioCtx)) {
    resumeAudioContextIfNeeded(state.audioCtx);
  }
  return state.audioCtx;
}
export function applyAudioBoostToVideo(video, boostLevel = state.audioBoost, presetMode = state.audioPreset) {
  const boost = Math.max(1.0, Math.min(4.0, Number(boostLevel) || 1.0));
  const preset = ["flat", "voice", "night", "cinema"].includes(presetMode) ? presetMode : "flat";
  state.audioBoost = boost;
  state.audioPreset = preset;

  const boostSel = document.getElementById("select-audio-boost");
  if (boostSel) {
    boostSel.value = String(boost);
  }
  const boostGroup = document.getElementById("audio-boost-group");
  if (boostGroup) {
    boostGroup.classList.toggle("boost-active", boost > 1.01);
  }
  const eqSel = document.getElementById("select-audio-eq");
  if (eqSel) {
    eqSel.value = preset;
  }
  const eqGroup = document.getElementById("audio-eq-group");
  if (eqGroup) {
    eqGroup.classList.toggle("eq-active", preset !== "flat");
  }
  updatePlayerGearActiveDot();
  if (!video) return;
  const directDelaySec = state.remuxMeta?.active
    ? 0
    : Math.max(0, Math.min(5.0, Number(state.audioOffsetSec) || 0));
  // Do not attach createMediaElementSource while audio boost, EQ & direct delay are neutral ("flat", 1.0x, 0s),
  // so streams play 100% native OS CoreAudio without WebAudio graph overhead or CORS muting.
  if (!video._cfSourceNode && boost <= 1.01 && preset === "flat" && directDelaySec < 0.005) {
    return;
  }

  if (!video._cfSourceNode && Boolean(video.webkitCurrentPlaybackTargetIsWireless)) {
    showToast(
      t(
        "Во время передачи по AirPlay обработка звука отключена для сохранения беспроводного потока",
        "Audio DSP is bypassed while streaming over AirPlay"
      )
    );
    return;
  }

  try {
    const ctx = ensureUnlockedAudioContext();
    if (!ctx) return;

    // If WebAudio node was created earlier in session and user returned to neutral 100% + Flat + 0s delay,
    // route source directly to destination so zero DSP filters/waveshapers run on CPU.
    if (video._cfSourceNode && boost <= 1.01 && preset === "flat" && directDelaySec < 0.005) {
      if (!video._cfDirectBypass) {
        try {
          video._cfSourceNode.disconnect();
          video._cfSourceNode.connect(ctx.destination);
          video._cfDirectBypass = true;
        } catch (err) { window.logDebug?.("AudioDsp", err); }
      }
      if (isAudioContextSuspendedLike(ctx)) {
        resumeAudioContextIfNeeded(ctx);
      }
      return;
    }

    // If user enabled Audio Boost / EQ while an external cross-origin stream was loaded without crossorigin="anonymous",
    // seamlessly reload current stream once with crossorigin enabled so WebAudio never outputs silence.
    // Same-origin endpoints (/api/remux-stream) do not require crossorigin and attach WebAudio immediately.
    if (!video._cfSourceNode && video._cfCorsBlocked) {
      return;
    }
    if (!video._cfSourceNode && !video.hasAttribute("crossorigin") && video.currentSrc) {
      let isCrossOriginStream = false;
      try {
        isCrossOriginStream =
          new URL(video.currentSrc, window.location.origin).origin !== window.location.origin;
      } catch (err) { window.logDebug?.("AudioDsp", err); }
      if (isCrossOriginStream) {
        if (
          !video._cfCorsBlocked &&
          state.isPlayerOpen &&
          state.currentStreamUrl &&
          /^https?:\/\//i.test(state.currentStreamUrl)
        ) {
          const curPos = Number.isFinite(video.currentTime) ? video.currentTime : 0;
          video.setAttribute("crossorigin", "anonymous");
          playVideoUrl(state.currentStreamUrl, curPos, state.playerSessionId, {
            keepRemuxMeta: Boolean(state.remuxMeta?.active),
          });
        }
        return;
      }
    }

    // Never hijack <video> into a suspended AudioContext before first user gesture;
    // statechange listener above automatically connects the moment ctx reaches "running".
    if (!video._cfSourceNode && ctx.state !== "running") {
      ctx.resume().catch(() => {});
      return;
    }

    let justCreated = false;
    if (!video._cfSourceNode) {
      const source = ctx.createMediaElementSource(video);
      const prePadGain = ctx.createGain();
      const dryBypassGain = ctx.createGain();
      const compDriveGain = ctx.createGain();
      const compressor = ctx.createDynamicsCompressor();
      const compTrimGain = ctx.createGain();
      const dynSumGain = ctx.createGain();

      // Fixed-type 7-stage post-dynamics EQ (never mutates .type, zero filter-state clicks)
      const hpFilter = ctx.createBiquadFilter();
      hpFilter.type = "highpass";
      const lowShelfFilter = ctx.createBiquadFilter();
      lowShelfFilter.type = "lowshelf";
      const subPunchFilter = ctx.createBiquadFilter();
      subPunchFilter.type = "peaking";
      const lowMidFilter = ctx.createBiquadFilter();
      lowMidFilter.type = "peaking";
      const vocalBodyFilter = ctx.createBiquadFilter();
      vocalBodyFilter.type = "peaking";
      const presenceFilter = ctx.createBiquadFilter();
      presenceFilter.type = "peaking";
      const airFilter = ctx.createBiquadFilter();
      airFilter.type = "highshelf";

      const postGain = ctx.createGain();
      const limiterIn = ctx.createGain();
      limiterIn.gain.value = 0.25;
      const limiterShaper = ctx.createWaveShaper();
      limiterShaper.curve = buildSoftClipLimiterCurve();
      limiterShaper.oversample = "2x";
      const syncDelayNode = ctx.createDelay(5.0);
      syncDelayNode.delayTime.value = 0;

      source.connect(prePadGain);
      prePadGain.connect(dryBypassGain);
      dryBypassGain.connect(dynSumGain);

      prePadGain.connect(compDriveGain);
      compDriveGain.connect(compressor);
      compressor.connect(compTrimGain);
      compTrimGain.connect(dynSumGain);

      dynSumGain.connect(hpFilter);
      hpFilter.connect(lowShelfFilter);
      lowShelfFilter.connect(subPunchFilter);
      subPunchFilter.connect(lowMidFilter);
      lowMidFilter.connect(vocalBodyFilter);
      vocalBodyFilter.connect(presenceFilter);
      presenceFilter.connect(airFilter);
      airFilter.connect(postGain);
      postGain.connect(limiterIn);
      limiterIn.connect(limiterShaper);
      limiterShaper.connect(syncDelayNode);
      syncDelayNode.connect(ctx.destination);

      video._cfSourceNode = source;
      video._cfDirectBypass = false;
      if (isIosOrIpadOs() && !state._iosWebAudioNoticeShown) {
        state._iosWebAudioNoticeShown = true;
        showToast(
          t(
            "Эквалайзер и усиление включены (на iOS / iPadOS для AirPlay используйте Стандарт 100%)",
            "Equalizer & boost active (on iOS / iPadOS, use Standard 100% for AirPlay)"
          )
        );
      }
      state.audioNodes = {
        prePadGain,
        dryBypassGain,
        compDriveGain,
        compressor,
        compTrimGain,
        dynSumGain,
        hpFilter,
        lowShelfFilter,
        subPunchFilter,
        lowMidFilter,
        vocalBodyFilter,
        presenceFilter,
        airFilter,
        postGain,
        limiterIn,
        limiterShaper,
        syncDelayNode,
      };
      justCreated = true;
    }

    const n = state.audioNodes;
    if (!n) return;
    if (video._cfDirectBypass) {
      try {
        video._cfSourceNode.disconnect();
        video._cfSourceNode.connect(n.prePadGain);
        video._cfDirectBypass = false;
      } catch (err) { window.logDebug?.("AudioDsp", err); }
    }
    if (isAudioContextSuspendedLike(ctx)) {
      resumeAudioContextIfNeeded(ctx);
    }

    const now = ctx.currentTime;
    const tau = 0.024;
    const setParam = (audioParam, val) => {
      if (justCreated) {
        audioParam.cancelScheduledValues(now);
        audioParam.setValueAtTime(val, now);
      } else {
        audioParam.setTargetAtTime(val, now, tau);
      }
    };
    if (n.syncDelayNode) {
      setParam(n.syncDelayNode.delayTime, directDelaySec);
    }

    const isBoosted = boost > 1.01;
    // Gentle perceptual curve for user boost (100%..400%) paired with dynamic leveling so dialogue rises without clipping
    const boostLift = isBoosted ? 1 + (boost - 1) * 0.68 : 1.0;

    if (preset === "voice") {
      // Чёткая речь: Studio vocal isolator & leveler — cuts rumble (<155Hz) and music mud (280Hz -6dB),
      // lifts vocal fundamentals (1.45kHz +3.8dB) & consonants (3.2kHz +6.5dB), tames sibilance (>8kHz -3.5dB).
      setParam(n.prePadGain.gain, 0.8);
      setParam(n.dryBypassGain.gain, 0.0);
      setParam(n.compDriveGain.gain, 1.35 * (isBoosted ? 1 + (boost - 1) * 0.35 : 1));
      setParam(n.compressor.threshold, -24);
      setParam(n.compressor.knee, 14);
      setParam(n.compressor.ratio, 4.2);
      setParam(n.compressor.attack, 0.003);
      setParam(n.compressor.release, 0.18);
      setParam(n.compTrimGain.gain, 0.64);

      setParam(n.hpFilter.frequency, 155);
      setParam(n.hpFilter.Q, 0.71);
      setParam(n.lowShelfFilter.frequency, 120);
      setParam(n.lowShelfFilter.gain, 0);
      setParam(n.subPunchFilter.frequency, 68);
      setParam(n.subPunchFilter.Q, 1.1);
      setParam(n.subPunchFilter.gain, 0);
      setParam(n.lowMidFilter.frequency, 280);
      setParam(n.lowMidFilter.Q, 1.05);
      setParam(n.lowMidFilter.gain, -6.0);
      setParam(n.vocalBodyFilter.frequency, 1450);
      setParam(n.vocalBodyFilter.Q, 0.9);
      setParam(n.vocalBodyFilter.gain, 3.8);
      setParam(n.presenceFilter.frequency, 3200);
      setParam(n.presenceFilter.Q, 0.95);
      setParam(n.presenceFilter.gain, 6.5);
      setParam(n.airFilter.frequency, 8000);
      setParam(n.airFilter.gain, -3.5);

      setParam(n.postGain.gain, Math.min(3.4, 0.96 * boostLift));
    } else if (preset === "night") {
      // Ночной режим: Midnight whisper-lifter + explosion clamp — strips wall-penetrating bass (<185Hz),
      // lifts quiet whispers (+8dB drive into 14:1 fast compressor), clamps loud blasts (-9dB trim), warm highs (-6dB).
      setParam(n.prePadGain.gain, 0.84);
      setParam(n.dryBypassGain.gain, 0.0);
      setParam(n.compDriveGain.gain, 2.5 * (isBoosted ? 1 + (boost - 1) * 0.3 : 1));
      setParam(n.compressor.threshold, -30);
      setParam(n.compressor.knee, 10);
      setParam(n.compressor.ratio, 14);
      setParam(n.compressor.attack, 0.001);
      setParam(n.compressor.release, 0.16);
      setParam(n.compTrimGain.gain, 0.36);

      setParam(n.hpFilter.frequency, 185);
      setParam(n.hpFilter.Q, 0.72);
      setParam(n.lowShelfFilter.frequency, 120);
      setParam(n.lowShelfFilter.gain, 0);
      setParam(n.subPunchFilter.frequency, 68);
      setParam(n.subPunchFilter.Q, 1.1);
      setParam(n.subPunchFilter.gain, 0);
      setParam(n.lowMidFilter.frequency, 250);
      setParam(n.lowMidFilter.Q, 0.95);
      setParam(n.lowMidFilter.gain, -5.0);
      setParam(n.vocalBodyFilter.frequency, 1300);
      setParam(n.vocalBodyFilter.Q, 0.85);
      setParam(n.vocalBodyFilter.gain, 3.0);
      setParam(n.presenceFilter.frequency, 2600);
      setParam(n.presenceFilter.Q, 0.85);
      setParam(n.presenceFilter.gain, 4.5);
      setParam(n.airFilter.frequency, 6000);
      setParam(n.airFilter.gain, -6.0);

      setParam(n.postGain.gain, Math.min(3.4, 1.26 * boostLift));
    } else if (preset === "cinema") {
      // Кинотеатр: Wide uncompressed theater soundstage — -6dB internal headroom for rich bass (+7dB @ 120Hz + +3.5dB @ 68Hz),
      // anti-boxiness scoop (-4dB @ 380Hz), spatial theater depth (-1.8dB @ 2.6kHz), and crisp air (+6dB @ 7.5kHz).
      setParam(n.prePadGain.gain, 0.5);
      if (isBoosted) {
        setParam(n.dryBypassGain.gain, 0.0);
        setParam(n.compDriveGain.gain, 1.2 + (boost - 1) * 0.45);
        setParam(n.compressor.threshold, -22);
        setParam(n.compressor.knee, 16);
        setParam(n.compressor.ratio, 4.0);
        setParam(n.compressor.attack, 0.004);
        setParam(n.compressor.release, 0.24);
        setParam(n.compTrimGain.gain, 0.68);
      } else {
        setParam(n.dryBypassGain.gain, 1.0);
        setParam(n.compDriveGain.gain, 0.0);
        setParam(n.compTrimGain.gain, 0.0);
      }

      setParam(n.hpFilter.frequency, 22);
      setParam(n.hpFilter.Q, 0.707);
      setParam(n.lowShelfFilter.frequency, 120);
      setParam(n.lowShelfFilter.gain, 7.0);
      setParam(n.subPunchFilter.frequency, 68);
      setParam(n.subPunchFilter.Q, 1.1);
      setParam(n.subPunchFilter.gain, 3.5);
      setParam(n.lowMidFilter.frequency, 380);
      setParam(n.lowMidFilter.Q, 0.95);
      setParam(n.lowMidFilter.gain, -4.0);
      setParam(n.vocalBodyFilter.frequency, 1400);
      setParam(n.vocalBodyFilter.Q, 0.9);
      setParam(n.vocalBodyFilter.gain, 0);
      setParam(n.presenceFilter.frequency, 2600);
      setParam(n.presenceFilter.Q, 1.0);
      setParam(n.presenceFilter.gain, -1.8);
      setParam(n.airFilter.frequency, 7500);
      setParam(n.airFilter.gain, 6.0);

      setParam(n.postGain.gain, Math.min(3.2, 1.28 * boostLift));
    } else {
      // Стандарт (Flat): 100% pure uncolored dry signal at 100% boost with -1.5dB true-peak headroom
      // + C1 brickwall ceiling so hot Russian dubs never clip; engages smooth leveler only when Boost > 100%.
      setParam(n.prePadGain.gain, 0.84);
      if (isBoosted) {
        setParam(n.dryBypassGain.gain, 0.0);
        setParam(n.compDriveGain.gain, 1.1 + (boost - 1) * 0.5);
        setParam(n.compressor.threshold, -22);
        setParam(n.compressor.knee, 16);
        setParam(n.compressor.ratio, 4.5);
        setParam(n.compressor.attack, 0.002);
        setParam(n.compressor.release, 0.2);
        setParam(n.compTrimGain.gain, 0.66);
      } else {
        setParam(n.dryBypassGain.gain, 1.0);
        setParam(n.compDriveGain.gain, 0.0);
        setParam(n.compTrimGain.gain, 0.0);
      }

      setParam(n.hpFilter.frequency, 16);
      setParam(n.hpFilter.Q, 0.707);
      setParam(n.lowShelfFilter.frequency, 120);
      setParam(n.lowShelfFilter.gain, 0);
      setParam(n.subPunchFilter.frequency, 68);
      setParam(n.subPunchFilter.Q, 1.1);
      setParam(n.subPunchFilter.gain, 0);
      setParam(n.lowMidFilter.frequency, 300);
      setParam(n.lowMidFilter.Q, 1.0);
      setParam(n.lowMidFilter.gain, 0);
      setParam(n.vocalBodyFilter.frequency, 1400);
      setParam(n.vocalBodyFilter.Q, 0.9);
      setParam(n.vocalBodyFilter.gain, 0);
      setParam(n.presenceFilter.frequency, 3000);
      setParam(n.presenceFilter.Q, 1.0);
      setParam(n.presenceFilter.gain, 0);
      setParam(n.airFilter.frequency, 8000);
      setParam(n.airFilter.gain, 0);

      setParam(n.postGain.gain, isBoosted ? Math.min(3.5, 1.08 * boostLift) : 1.0);
    }
  } catch (err) {
    console.warn("Audio DSP init notice:", err);
  }
}
export function updatePlayerGearActiveDot() {
  const dot = document.getElementById("player-gear-active-dot");
  const resetBtn = document.getElementById("btn-reset-player-gear");
  const speedBadge = document.getElementById("vc-gear-speed-label");
  const speedSel = document.getElementById("select-speed");
  const curRate = speedSel ? parseFloat(speedSel.value) || 1 : 1;
  const hasCustomSpeed = Math.abs(curRate - 1) > 0.01;
  if (speedBadge) {
    speedBadge.textContent = `${curRate}x`;
    speedBadge.classList.toggle("hidden", !hasCustomSpeed);
  }
  document.querySelectorAll("#gear-speed-pills .gear-speed-pill").forEach((pill) => {
    const pRate = parseFloat(pill.dataset.speed) || 1;
    pill.classList.toggle("active", Math.abs(pRate - curRate) < 0.01);
  });

  const modSpeed = hasCustomSpeed;
  const modBoost = (state.audioBoost || 1) > 1.01;
  const modEq = Boolean(state.audioPreset && state.audioPreset !== "flat");
  const modCrop = Boolean(state.videoCrop && state.videoCrop !== "contain");
  const modSubSize = Boolean(state.subSize && state.subSize !== "medium");
  const modSubBg = Boolean(state.subBg && state.subBg !== "semi");
  const modAudioOffset = Math.abs(state.audioOffsetSec || 0) > 0.005;
  const modSubOffset = Math.abs(state.subtitleOffsetSec || 0) > 0.01;
  const modSleep = Boolean(state.sleepTimerMode && state.sleepTimerMode !== "off");
  const modAmbilight = state.ambilightEnabled === false;
  const modSkipIntro = state.autoSkipIntro === false;
  const modAutoNext = state.autoNextEpisode === false;

  document.getElementById("speed-group")?.classList.toggle("is-modified", modSpeed);
  document.getElementById("audio-boost-group")?.classList.toggle("is-modified", modBoost);
  document.getElementById("audio-eq-group")?.classList.toggle("is-modified", modEq);
  document.getElementById("video-crop-group")?.classList.toggle("is-modified", modCrop);
  document.getElementById("sub-size-group")?.classList.toggle("is-modified", modSubSize);
  document.getElementById("sub-bg-group")?.classList.toggle("is-modified", modSubBg);
  document.getElementById("sleep-timer-group")?.classList.toggle("is-modified", modSleep);
  document.getElementById("gear-audio-offset-row")?.classList.toggle("is-modified", modAudioOffset);
  document.getElementById("gear-sub-offset-row")?.classList.toggle("is-modified", modSubOffset);
  document.getElementById("gear-ambilight-row")?.classList.toggle("is-modified", modAmbilight);
  document.getElementById("gear-skip-intro-row")?.classList.toggle("is-modified", modSkipIntro);
  document.getElementById("gear-auto-next-row")?.classList.toggle("is-modified", modAutoNext);

  const isModified =
    modSpeed ||
    modBoost ||
    modEq ||
    modCrop ||
    modSubSize ||
    modSubBg ||
    modAudioOffset ||
    modSubOffset ||
    modSleep ||
    modAmbilight ||
    modSkipIntro ||
    modAutoNext;
  dot?.classList.toggle("hidden", !isModified);
  resetBtn?.classList.toggle("hidden", !isModified);
}
export function applySubtitleStylePrefs(subSize = state.subSize, subBg = state.subBg) {
  const sizeKey = ["small", "medium", "large", "xlarge"].includes(subSize) ? subSize : "medium";
  const bgKey = ["semi", "solid", "none"].includes(subBg) ? subBg : "semi";
  state.subSize = sizeKey;
  state.subBg = bgKey;

  const sizePxMap = {
    small: "17px",
    medium: "21px",
    large: "26px",
    xlarge: "32px",
  };
  const root = document.documentElement;
  root.style.setProperty("--sub-font-size", sizePxMap[sizeKey] || "21px");

  if (bgKey === "solid") {
    root.style.setProperty("--sub-bg-color", "rgba(10, 10, 12, 0.94)");
    root.style.setProperty("--sub-text-shadow", "none");
  } else if (bgKey === "none") {
    root.style.setProperty("--sub-bg-color", "transparent");
    root.style.setProperty(
      "--sub-text-shadow",
      "0 2px 6px rgba(0, 0, 0, 0.98), 0 0 3px rgba(0, 0, 0, 0.95)"
    );
  } else {
    root.style.setProperty("--sub-bg-color", "rgba(10, 10, 12, 0.74)");
    root.style.setProperty("--sub-text-shadow", "0 1px 3px rgba(0, 0, 0, 0.85)");
  }

  const sizeSel = document.getElementById("select-sub-size");
  if (sizeSel) sizeSel.value = sizeKey;
  const bgSel = document.getElementById("select-sub-bg");
  if (bgSel) bgSel.value = bgKey;
  updatePlayerGearActiveDot();
}
export function sampleAmbilightFrame() {
  if (state.fsTransitioning || isStageFullscreen() || document.hidden) {
    return;
  }
  const glowEl = document.getElementById("video-ambilight-glow");
  if (
    !glowEl ||
    !state.isPlayerOpen ||
    !state.ambilightEnabled ||
    state.isMiniPlayer ||
    state.isPipBackground ||
    state.activeSourceTab === "trailer"
  ) {
    glowEl?.classList.add("hidden");
    return;
  }
  const baseCol = state.activeItem?.ambient_color || "#242427";
  const nextBg = `radial-gradient(circle at 24% 50%, ${baseCol} 0%, transparent 64%), radial-gradient(circle at 76% 50%, ${baseCol} 0%, transparent 64%)`;
  if (glowEl.dataset.appliedColor !== baseCol) {
    glowEl.style.background = nextBg;
    glowEl.dataset.appliedColor = baseCol;
  }
  glowEl.classList.remove("hidden");
}
export function startAmbilightLoop() {
  stopAmbilightLoop(false);
  if (!state.ambilightEnabled || !state.isPlayerOpen) return;
  sampleAmbilightFrame();
}
export function stopAmbilightLoop(hideElement = true) {
  if (state.ambilightTimerId) {
    clearInterval(state.ambilightTimerId);
    state.ambilightTimerId = null;
  }
  if (hideElement) {
    document.getElementById("video-ambilight-glow")?.classList.add("hidden");
  }
}
export function getVideoCropLabel(cropMode) {
  const map = {
    contain: t("16:9 Стандарт", "16:9 Fit"),
    cover: t("21:9 Без чёрных полос (Заполнить)", "21:9 Crop Black Bars"),
    zoom115: t("Масштаб 115%", "Zoom 115%"),
    fill: t("Растянуть на весь экран", "Stretch to Fill"),
  };
  return map[cropMode] || t("16:9 Стандарт", "16:9 Fit");
}
export function applyVideoCropToVideo(video, cropMode = state.videoCrop) {
  const mode = ["contain", "cover", "zoom115", "fill"].includes(cropMode) ? cropMode : "contain";
  state.videoCrop = mode;
  const sel = document.getElementById("select-video-crop");
  if (sel) sel.value = mode;
  document.getElementById("video-crop-group")?.classList.toggle("crop-active", mode !== "contain");
  updatePlayerGearActiveDot();
  if (!video) return;
  video.classList.remove("crop-contain", "crop-cover", "crop-zoom115", "crop-fill");
  video.classList.add(`crop-${mode}`);
}
export function ensurePreservesPitch(video) {
  if (!video) return;
  try {
    if ("preservesPitch" in video) video.preservesPitch = true;
    if ("webkitPreservesPitch" in video) video.webkitPreservesPitch = true;
    if ("mozPreservesPitch" in video) video.mozPreservesPitch = true;
  } catch (err) { window.logDebug?.("AudioDsp", err); }
}

export function applySavedPlayerPrefsToVideo(video) {
  if (!video) return;
  const prefs = getPlayerPrefs();
  state.internalMuteOverride = true;
  try {
    video.volume = prefs.volume;
    video.muted = Boolean(state.userMutedThisSession);
    ensurePreservesPitch(video);
    video.playbackRate = prefs.playbackRate;
  } catch (err) { window.logDebug?.("AudioDsp", err); }
  state.internalMuteOverride = false;
  const speedSel = document.getElementById("select-speed");
  if (speedSel) {
    speedSel.value = String(prefs.playbackRate);
  }
  applyAudioBoostToVideo(video, prefs.audioBoost, prefs.audioPreset);
  applyVideoCropToVideo(video, prefs.videoCrop);
  applySubtitleStylePrefs(prefs.subSize, prefs.subBg);
  syncCustomVideoControlsUI(true);
}
export function pickBestQualityKey(qualitiesMap, preferredQuality, serverDefault) {
  const keys = Object.keys(qualitiesMap || {});
  if (keys.length === 0) return serverDefault || "1080p";
  if (preferredQuality && preferredQuality !== "max" && qualitiesMap[preferredQuality]) {
    return preferredQuality;
  }
  const rankOrder = ["4K", "2160p", "1440p", "2K", "1080p Ultra", "1080p", "720p", "480p", "360p"];
  for (const r of rankOrder) {
    const found = keys.find((k) => k.toLowerCase() === r.toLowerCase() || k.toLowerCase().includes(r.toLowerCase()));
    if (found) return found;
  }
  return (serverDefault && qualitiesMap[serverDefault] ? serverDefault : null) || keys[0];
}
export function pickPreferredSubtitleIndex(subtitles, preferredLang) {
  if (!preferredLang || preferredLang === "off" || !Array.isArray(subtitles) || subtitles.length === 0) {
    return -1;
  }
  const target = preferredLang.trim().toLowerCase();
  const exactIdx = subtitles.findIndex((s) => String(s.lang || "").trim().toLowerCase() === target);
  if (exactIdx >= 0) return exactIdx;
  if (target === "ru" || target.includes("рус") || target.includes("russian")) {
    const ruIdx = subtitles.findIndex((s) => {
      const l = String(s.lang || "").toLowerCase();
      return l.includes("рус") || l.includes("russian");
    });
    if (ruIdx >= 0) return ruIdx;
  }
  if (target === "en" || target.includes("англ") || target.includes("eng")) {
    const enIdx = subtitles.findIndex((s) => {
      const l = String(s.lang || "").toLowerCase();
      return l.includes("англ") || l.includes("eng");
    });
    if (enIdx >= 0) return enIdx;
  }
  return -1;
}
export function isVideoInPiP(videoEl = document.getElementById("native-video")) {
  if (!videoEl) return false;
  if (document.pictureInPictureElement && document.pictureInPictureElement === videoEl) {
    return true;
  }
  if (
    typeof videoEl.webkitPresentationMode === "string" &&
    videoEl.webkitPresentationMode === "picture-in-picture"
  ) {
    return true;
  }
  try {
    if (typeof videoEl.matches === "function" && videoEl.matches(":picture-in-picture")) {
      return true;
    }
  } catch (err) { window.logDebug?.("AudioDsp", err); }
  return false;
}
export async function togglePictureInPicture(options = {}) {
  const video = document.getElementById("native-video");
  if (!video) return;
  const isGecko = typeof navigator !== "undefined" && /Firefox\//i.test(navigator.userAgent || "");
  const currentlyInPip = isVideoInPiP(video) || Boolean(state.isPipBackground);

  if (currentlyInPip) {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (
        typeof video.webkitSetPresentationMode === "function" &&
        video.webkitPresentationMode === "picture-in-picture"
      ) {
        video.webkitSetPresentationMode("inline");
      } else if (isGecko || (typeof video.matches === "function" && video.matches(":picture-in-picture"))) {
        video.tabIndex = -1;
        try {
          video.focus({ preventScroll: true });
        } catch (err) { window.logDebug?.("AudioDsp", err); }
        await fetch("/api/remote/native-pip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ engine: "gecko" }),
        }).catch(() => {});
      }
    } catch (err) { window.logDebug?.("AudioDsp", err); }
    setPipBackgroundMode(false);
    showToast(t("Выход из режима «Картинка в картинке»", "Exited Picture-in-Picture"));
    syncPipDockUI();
    return;
  }

  const hasLoadedStream = Boolean(video.readyState >= 1 || video.currentTime > 0 || video.videoWidth > 0);
  if (!hasLoadedStream) {
    showToast(
      t(
        "Для включения режима «Картинка в картинке» дождитесь начала воспроизведения",
        "Wait for video playback to start before enabling Picture-in-Picture"
      )
    );
    return;
  }

  if (state.isPseudoFullscreen || document.documentElement?.classList.contains("is-stage-pseudo-fullscreen")) {
    state.isPseudoFullscreen = false;
    document.documentElement.classList.remove("is-stage-fullscreen", "is-stage-pseudo-fullscreen");
    document.getElementById("video-stage")?.classList.remove("is-pseudo-fullscreen");
  }
  if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
    try {
      await document.exitFullscreen();
    } catch (err) { window.logDebug?.("AudioDsp", err); }
  } else if (document.webkitFullscreenElement && typeof document.webkitExitFullscreen === "function") {
    try {
      document.webkitExitFullscreen();
    } catch (err) { window.logDebug?.("AudioDsp", err); }
  }

  const triggerNativeMacPip = async (engineHint) => {
    video.tabIndex = -1;
    try {
      video.focus({ preventScroll: true });
    } catch (err) { window.logDebug?.("AudioDsp", err); }
    try {
      const r = await fetch("/api/remote/native-pip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine: engineHint }),
      });
      if (r.ok) {
        const d = await r.json();
        return Boolean(d && d.ok);
      }
    } catch (err) { window.logDebug?.("AudioDsp", err); }
    return false;
  };

  if (isGecko) {
    const okGecko = await triggerNativeMacPip("gecko");
    if (okGecko) {
      setPipBackgroundMode(true);
      showToast(
        t(
          "Режим «Картинка в картинке» включён — окно плеера свёрнуто",
          "Picture-in-Picture enabled — player window minimized"
        )
      );
      syncPipDockUI();
      return;
    }
  }

  const lacksGesture =
    Boolean(options?.fromRemote) ||
    Boolean(typeof navigator !== "undefined" && navigator.userActivation && !navigator.userActivation.isActive);
  if (lacksGesture && !options?.fromNativeKey) {
    const okNative = await triggerNativeMacPip(isGecko ? "gecko" : "standard");
    if (okNative) {
      setTimeout(() => {
        if (state.isPlayerOpen && isVideoInPiP(video) && !state.isPipBackground) {
          setPipBackgroundMode(true);
          syncPipDockUI();
        }
      }, 260);
      return;
    }
  }

  try {
    if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === "function") {
      await video.requestPictureInPicture();
      setPipBackgroundMode(true);
      showToast(
        t(
          "Режим «Картинка в картинке» включён — окно плеера свёрнуто",
          "Picture-in-Picture enabled — player window minimized"
        )
      );
    } else if (typeof video.webkitSetPresentationMode === "function") {
      video.webkitSetPresentationMode("picture-in-picture");
      setPipBackgroundMode(true);
      showToast(
        t(
          "Режим «Картинка в картинке» включён — окно плеера свёрнуто",
          "Picture-in-Picture enabled — player window minimized"
        )
      );
    } else {
      const okFallback = !options?.fromNativeKey ? await triggerNativeMacPip(isGecko ? "gecko" : "standard") : false;
      if (okFallback) {
        setPipBackgroundMode(true);
        showToast(
          t(
            "Режим «Картинка в картинке» включён — окно плеера свёрнуто",
            "Picture-in-Picture enabled — player window minimized"
          )
        );
      } else {
        showToast(
          t(
            "Режим «Картинка в картинке» не поддерживается браузером",
            "Picture-in-Picture is not supported by this browser"
          )
        );
      }
    }
    syncPipDockUI();
  } catch (err) {
    if (!options?.fromNativeKey) {
      const okRetry = await triggerNativeMacPip(isGecko ? "gecko" : "standard");
      if (okRetry) {
        if (isGecko) {
          setPipBackgroundMode(true);
          showToast(
            t(
              "Режим «Картинка в картинке» включён — окно плеера свёрнуто",
              "Picture-in-Picture enabled — player window minimized"
            )
          );
          syncPipDockUI();
        }
        return;
      }
    }
    showToast(
      t(
        "Поток ещё загружается — подождите начала воспроизведения видео",
        "Stream is still loading — wait for video playback to start"
      )
    );
    syncPipDockUI();
  }
}
