import { PLAYER_PREFS_STORAGE_KEY, state } from "./state.js?v=20261024v4";
import { t } from "./i18n.js?v=20261024v4";
import { showToast } from "./utils.js?v=20261024v4";
import {
  closePlayerModal,
  isStageFullscreen,
  playVideoUrl,
  setMiniPlayerMode,
  setPipBackgroundMode,
  syncCustomVideoControlsUI,
  syncPipDockUI,
} from "./player.js?v=20261024v4";

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
    const raw = localStorage.getItem(PLAYER_PREFS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) || {} : {};
    const rawVol = typeof parsed.volume === "number" ? Math.max(0, Math.min(1, parsed.volume)) : 1.0;
    // Self-heal if previous closePlayerModal / volumechange bug persisted volume=0 or muted=true
    const vol = rawVol <= 0.02 ? 0.85 : rawVol;
    if (parsed.muted === true || rawVol <= 0.02) {
      try {
        localStorage.setItem(
          PLAYER_PREFS_STORAGE_KEY,
          JSON.stringify({ ...parsed, volume: vol, muted: false })
        );
      } catch (_) {}
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
    const autoSkipAds = typeof parsed.autoSkipAds === "boolean" ? parsed.autoSkipAds : true;
    const autoSkipIntro = typeof parsed.autoSkipIntro === "boolean" ? parsed.autoSkipIntro : true;
    const preferredSourceTab = ["hdrezka", "stremio", "backup4k"].includes(parsed.preferredSourceTab)
      ? parsed.preferredSourceTab
      : "";
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
      autoSkipAds,
      autoSkipIntro,
      preferredSourceTab,
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
      autoSkipAds: true,
      autoSkipIntro: true,
      preferredSourceTab: "",
    };
  }
}
export function savePlayerPrefs(patch) {
  try {
    const cur = getPlayerPrefs();
    const updated = { ...cur, ...patch };
    localStorage.setItem(PLAYER_PREFS_STORAGE_KEY, JSON.stringify(updated));
  } catch (_) {}
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
export function ensureUnlockedAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!state.audioCtx) {
    try {
      state.audioCtx = new AudioContextClass({ latencyHint: "playback" });
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
        }
      });
    }
  }
  if (state.audioCtx && state.audioCtx.state === "suspended") {
    state.audioCtx.resume().catch(() => {});
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
  // Do not attach createMediaElementSource while audio boost & EQ are neutral ("flat", 1.0x),
  // so streams play 100% native OS CoreAudio without WebAudio graph overhead or CORS muting.
  if (!video._cfSourceNode && boost <= 1.01 && preset === "flat") {
    return;
  }

  try {
    const ctx = ensureUnlockedAudioContext();
    if (!ctx) return;

    // If WebAudio node was created earlier in session and user returned to neutral 100% + Flat,
    // route source directly to destination so zero DSP filters/waveshapers run on CPU.
    if (video._cfSourceNode && boost <= 1.01 && preset === "flat") {
      if (!video._cfDirectBypass) {
        try {
          video._cfSourceNode.disconnect();
          video._cfSourceNode.connect(ctx.destination);
          video._cfDirectBypass = true;
        } catch (_) {}
      }
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      return;
    }

    // If user enabled Audio Boost / EQ while an external cross-origin stream was loaded without crossorigin="anonymous",
    // seamlessly reload current stream once with crossorigin enabled so WebAudio never outputs silence.
    // Same-origin endpoints (/api/remux-stream) do not require crossorigin and attach WebAudio immediately.
    if (!video._cfSourceNode && !video.hasAttribute("crossorigin") && video.currentSrc) {
      let isCrossOriginStream = false;
      try {
        isCrossOriginStream =
          new URL(video.currentSrc, window.location.origin).origin !== window.location.origin;
      } catch (_) {}
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
      limiterShaper.connect(ctx.destination);

      video._cfSourceNode = source;
      video._cfDirectBypass = false;
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
      } catch (_) {}
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
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
  if (!dot) return;
  const isModified =
    hasCustomSpeed ||
    (state.audioBoost || 1) > 1.01 ||
    (state.audioPreset && state.audioPreset !== "flat") ||
    (state.videoCrop && state.videoCrop !== "contain") ||
    (state.subSize && state.subSize !== "medium") ||
    (state.subBg && state.subBg !== "semi") ||
    (state.sleepTimerMode && state.sleepTimerMode !== "off");
  dot.classList.toggle("hidden", !isModified);
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
    root.style.setProperty("--sub-bg-color", "rgba(6, 7, 10, 0.94)");
    root.style.setProperty("--sub-text-shadow", "none");
  } else if (bgKey === "none") {
    root.style.setProperty("--sub-bg-color", "transparent");
    root.style.setProperty(
      "--sub-text-shadow",
      "0 2px 6px rgba(0, 0, 0, 0.98), 0 0 3px rgba(0, 0, 0, 0.95)"
    );
  } else {
    root.style.setProperty("--sub-bg-color", "rgba(10, 11, 15, 0.72)");
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
  const baseCol = state.activeItem?.ambient_color || "#334155";
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
export function applySavedPlayerPrefsToVideo(video) {
  if (!video) return;
  const prefs = getPlayerPrefs();
  state.internalMuteOverride = true;
  try {
    video.volume = prefs.volume;
    video.muted = Boolean(state.userMutedThisSession);
    video.playbackRate = prefs.playbackRate;
  } catch (_) {}
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
  return false;
}
export async function togglePictureInPicture() {
  const video = document.getElementById("native-video");
  if (!video) return;
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      setPipBackgroundMode(false);
      showToast(t("Выход из режима «Картинка в картинке»", "Exited Picture-in-Picture"));
    } else if (typeof video.webkitSetPresentationMode === "function") {
      const curMode = video.webkitPresentationMode;
      const nextMode = curMode === "picture-in-picture" ? "inline" : "picture-in-picture";
      video.webkitSetPresentationMode(nextMode);
      if (nextMode === "picture-in-picture") {
        setPipBackgroundMode(true);
        showToast(t("Режим «Картинка в картинке» включён — окно плеера свёрнуто", "Picture-in-Picture enabled — player window minimized"));
      } else {
        setPipBackgroundMode(false);
        showToast(t("Выход из режима «Картинка в картинке»", "Exited Picture-in-Picture"));
      }
    } else if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === "function") {
      await video.requestPictureInPicture();
      setPipBackgroundMode(true);
      showToast(t("Режим «Картинка в картинке» включён — окно плеера свёрнуто", "Picture-in-Picture enabled — player window minimized"));
    } else {
      const nextMini = !state.isMiniPlayer;
      setMiniPlayerMode(nextMini);
      showToast(
        nextMini
          ? t("Плавающий мини-плеер включён — перетащите окно в удобный угол", "Floating mini player enabled — drag to any corner")
          : t("Возврат в полный плеер", "Returned to full player")
      );
    }
    syncPipDockUI();
  } catch (err) {
    if (!document.pictureInPictureEnabled || typeof video.requestPictureInPicture !== "function") {
      const nextMini = !state.isMiniPlayer;
      setMiniPlayerMode(nextMini);
      syncPipDockUI();
      return;
    }
    showToast(t("Для включения режима «Картинка в картинке» дождитесь начала воспроизведения", "Wait for video playback to start before enabling Picture-in-Picture"));
  }
}
