import { state } from "./state.js?v=20261104v21";
import { isEn, t } from "./i18n.js?v=20261104v21";
import {
  clampStagePopover,
  escapeAttr,
  escapeHtml,
  iconSvg,
  showToast,
  showVideoOsd,
} from "./utils.js?v=20261104v21";
import { updatePlayerGearActiveDot } from "./audio-dsp.js?v=20261104v21";
import {
  closeAllVcPopovers,
  getEffectivePlaybackTiming,
  syncCustomControlPopovers,
} from "./player.js?v=20261104v21";

export function formatSubtitleOffsetLabel(sec = state.subtitleOffsetSec) {
  const num = Math.round((Number(sec) || 0) * 100) / 100;
  const unit = isEn() ? "s" : "с";
  if (Math.abs(num) < 0.005) {
    return `0.0 ${unit}`;
  }
  const sign = num > 0 ? "+" : "−";
  const absStr = Math.abs(num).toFixed(Math.abs(num * 10 - Math.round(num * 10)) > 0.01 ? 2 : 2);
  return `${sign}${absStr} ${unit}`;
}

export function syncSubtitleOffsetUI() {
  if (typeof document === "undefined") return;
  const labelText = formatSubtitleOffsetLabel(state.subtitleOffsetSec);
  const gearVal = document.getElementById("gear-sub-offset-val");
  if (gearVal) gearVal.textContent = labelText;
  const vcVal = document.getElementById("vc-sub-offset-val");
  if (vcVal) vcVal.textContent = labelText;
  const resetBtns = document.querySelectorAll(".js-sub-offset-reset");
  const hasOffset = Math.abs(Number(state.subtitleOffsetSec) || 0) >= 0.01;
  resetBtns.forEach((btn) => {
    btn.classList.toggle("is-modified", hasOffset);
  });
  updatePlayerGearActiveDot();
  state.lastRenderedSubCueText = "__force_refresh__";
  const video = document.getElementById("native-video");
  if (video?.webkitDisplayingFullscreen) {
    syncIosFullscreenNativeSubtitles(video);
  } else {
    updateCustomSubtitleOverlay(video);
  }
}

export function adjustSubtitleOffset(deltaSec, showFeedback = true) {
  const cur = Number(state.subtitleOffsetSec) || 0;
  const next = Math.max(-30, Math.min(30, Math.round((cur + (Number(deltaSec) || 0)) * 100) / 100));
  state.subtitleOffsetSec = next;
  syncSubtitleOffsetUI();
  if (showFeedback) {
    showVideoOsd(
      "subtitles",
      `${t("Задержка субтитров", "Subtitle sync")}: ${formatSubtitleOffsetLabel(next)}`
    );
  }
}

export function resetSubtitleOffset(showFeedback = true) {
  state.subtitleOffsetSec = 0;
  syncSubtitleOffsetUI();
  if (showFeedback) {
    showVideoOsd("subtitles", `${t("Задержка субтитров", "Subtitle sync")}: ${formatSubtitleOffsetLabel(0)}`);
  }
}

export function mergeCustomExternalSubtitles(baseList = []) {
  const merged = Array.isArray(baseList) ? baseList.slice() : [];
  const custom = Array.isArray(state.customExternalSubtitles) ? state.customExternalSubtitles : [];
  if (!custom.length) return merged;
  const seenUrls = new Set(merged.map((s) => String(s?.url || "")).filter(Boolean));
  custom.forEach((c) => {
    if (!c || !c.url || seenUrls.has(String(c.url))) return;
    seenUrls.add(String(c.url));
    merged.push(c);
  });
  return merged;
}

export function populateSubtitlesSelector(subtitles) {
  if (typeof document === "undefined") return;
  const subGroup = document.getElementById("subtitle-group");
  const subSel = document.getElementById("select-subtitle");
  if (!subGroup || !subSel) return;

  const list = mergeCustomExternalSubtitles(subtitles || []);
  state.subtitles = list;

  subGroup.classList.toggle("hidden", state.activeSourceTab === "trailer");
  subSel.innerHTML = `<option value="-1">${t("Выключены", "Off")}</option>`;
  list.forEach((sub, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    const rawLang = String(sub.lang || sub.label || "").trim();
    const isGeneric = !rawLang || /^(subtitles|субтитры)$/i.test(rawLang);
    opt.textContent = isGeneric
      ? t(`Субтитры #${idx + 1}`, `Subtitles #${idx + 1}`)
      : rawLang;
    if (idx === state.activeSubtitleIndex) opt.selected = true;
    subSel.appendChild(opt);
  });
  syncCustomControlPopovers();
}

function parseVttTimeSec(hStr, mStr, sStr, msStr) {
  const h = hStr ? parseInt(hStr, 10) || 0 : 0;
  const m = parseInt(mStr, 10) || 0;
  const s = parseInt(sStr, 10) || 0;
  const rawMs = String(msStr || "0").padEnd(3, "0").slice(0, 3);
  const ms = parseInt(rawMs, 10) || 0;
  return h * 3600 + m * 60 + s + ms / 1000;
}

function parseAssTimeSec(raw) {
  const m = String(raw || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return -1;
  const h = parseInt(m[1], 10) || 0;
  const mins = parseInt(m[2], 10) || 0;
  const secs = parseInt(m[3], 10) || 0;
  const fracRaw = m[4];
  const ms =
    fracRaw.length === 1
      ? parseInt(fracRaw, 10) * 100
      : fracRaw.length === 2
      ? parseInt(fracRaw, 10) * 10
      : parseInt(fracRaw.slice(0, 3), 10) || 0;
  return h * 3600 + mins * 60 + secs + ms / 1000;
}

function cleanCuePayloadText(rawCueBody) {
  if (!rawCueBody) return "";
  return String(rawCueBody)
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\h/g, " ")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/\{[^}]*\\[a-zA-Z][^}]*\}/g, "")
    .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, "")
    .replace(/<\/?(?:v|c|b|i|u|font|ruby|rt)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .split("\n")
    .map((ln) => ln.trim())
    .filter(Boolean)
    .join("\n");
}

function parseAssDialogueCues(normText) {
  const lines = normText.split("\n");
  let inEvents = false;
  let formatCols = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"];
  const cues = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith(";")) continue;
    if (/^\[events\]$/i.test(trimmed)) {
      inEvents = true;
      continue;
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inEvents = false;
      continue;
    }
    if (!inEvents) continue;
    const low = trimmed.toLowerCase();
    if (low.startsWith("format:")) {
      const cols = trimmed
        .slice(7)
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      if (cols.includes("start") && cols.includes("end") && cols.includes("text")) {
        formatCols = cols;
      }
      continue;
    }
    if (!low.startsWith("dialogue:")) continue;
    const payload = trimmed.slice(9).trimStart();
    const parts = [];
    let rest = payload;
    for (let c = 0; c < formatCols.length - 1; c++) {
      const commaIdx = rest.indexOf(",");
      if (commaIdx < 0) break;
      parts.push(rest.slice(0, commaIdx));
      rest = rest.slice(commaIdx + 1);
    }
    parts.push(rest);
    if (parts.length < formatCols.length) continue;
    const startIdx = formatCols.indexOf("start");
    const endIdx = formatCols.indexOf("end");
    const textIdx = formatCols.indexOf("text");
    if (startIdx < 0 || endIdx < 0 || textIdx < 0) continue;
    const startSec = parseAssTimeSec(parts[startIdx]);
    const endSec = parseAssTimeSec(parts[endIdx]);
    if (startSec < 0 || !(endSec > startSec)) continue;
    const text = cleanCuePayloadText(parts[textIdx]);
    if (!text) continue;
    cues.push({ start: startSec, end: endSec, text });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

export function parseSubtitleCues(rawText) {
  if (!rawText) return [];
  const norm = String(rawText).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/\[events\]/i.test(norm) && /\ndialogue:/i.test(norm)) {
    const assCues = parseAssDialogueCues(norm);
    if (assCues.length > 0) return assCues;
  }
  const blocks = norm.split(/\n{2,}/);
  const cues = [];
  const timeRe =
    /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split("\n").map((l) => l.trim());
    if (!lines.length) continue;
    if (/^(?:WEBVTT|NOTE|STYLE|REGION)\b/i.test(lines[0])) continue;
    let timeLineIdx = -1;
    let match = null;
    for (let j = 0; j < Math.min(3, lines.length); j++) {
      const m = lines[j].match(timeRe);
      if (m) {
        timeLineIdx = j;
        match = m;
        break;
      }
    }
    if (timeLineIdx < 0 || !match) continue;
    const startSec = parseVttTimeSec(match[1], match[2], match[3], match[4]);
    const endSec = parseVttTimeSec(match[5], match[6], match[7], match[8]);
    if (!(endSec > startSec)) continue;
    const text = cleanCuePayloadText(lines.slice(timeLineIdx + 1).join("\n"));
    if (!text) continue;
    cues.push({ start: startSec, end: endSec, text });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

export function clearCustomSubtitleOverlay(keepLoadedCache = false) {
  if (!keepLoadedCache) {
    if (state.subFetchAbortController) {
      try {
        state.subFetchAbortController.abort();
      } catch (_) {}
      state.subFetchAbortController = null;
    }
    state.subFetchReqId = (state.subFetchReqId || 0) + 1;
    state.activeSubCues = [];
    state.activeSubTrackMeta = null;
    state.loadedSubUrl = "";
    state.subWindowAdvancing = false;
  }
  state.lastRenderedSubCueText = "";
  if (typeof document === "undefined") return;
  const overlay = document.getElementById("atv-subtitle-overlay");
  if (overlay) {
    overlay.innerHTML = "";
    overlay.classList.add("hidden");
  }
}

function advanceWindowedSubtitleIfNeeded(subMeta, curSec) {
  if (
    !subMeta ||
    !subMeta.isWindowedEmbedded ||
    !subMeta.rawSourceUrl ||
    state.subWindowAdvancing
  ) {
    return;
  }
  const winStart = Number(subMeta.windowStartSec) || 0;
  const winDur = Number(subMeta.windowDurSec) || 420;
  const relPos = curSec - winStart;
  if (relPos < winDur - 38 && relPos >= -2) return;

  const nextStart = Math.max(0, Math.floor(curSec - 4));
  if (Math.abs(nextStart - winStart) < 15) return;

  state.subWindowAdvancing = true;
  const qs = new URLSearchParams({
    src: subMeta.rawSourceUrl,
    si: String(subMeta.streamIndex),
    ss: String(nextStart),
    dur: String(winDur),
  });
  const nextUrl = `/api/remux-subtitle?${qs.toString()}`;
  const reqToken = state.subFetchReqId;
  fetch(nextUrl)
    .then((r) => (r.ok ? r.text() : ""))
    .then((txt) => {
      if (!state.isPlayerOpen || state.subFetchReqId !== reqToken || state.activeSubTrackMeta !== subMeta) return;
      const parsed = parseSubtitleCues(txt);
      subMeta.windowStartSec = nextStart;
      subMeta.url = nextUrl;
      state.loadedSubUrl = nextUrl;
      state.activeSubCues = parsed;
      const vEl = typeof document !== "undefined" ? document.getElementById("native-video") : null;
      if (vEl && Boolean(vEl.webkitDisplayingFullscreen)) {
        syncIosFullscreenNativeSubtitles(vEl);
      } else {
        updateCustomSubtitleOverlay(vEl);
      }
    })
    .catch(() => {})
    .finally(() => {
      state.subWindowAdvancing = false;
    });
}

const _subDictClientCache = new Map();

function renderInteractiveSubtitleLineHtml(line) {
  const parts = String(line || "").split(/([A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9''’-]{2,})/g);
  return parts
    .map((part) => {
      if (/^[A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9''’-]{2,}$/.test(part) && /[A-Za-zА-Яа-яЁёІіЇїЄєҐґ]/.test(part)) {
        return `<span class="atv-sub-word" data-word="${escapeAttr(part)}">${escapeHtml(part)}</span>`;
      }
      return escapeHtml(part);
    })
    .join("");
}

export function closeSubtitleDictPopover(resumePlayback = true) {
  if (typeof document === "undefined") return;
  const pop = document.getElementById("atv-sub-dict-popover");
  if (pop) {
    pop.classList.add("hidden");
  }
  document.querySelectorAll("#atv-subtitle-overlay .atv-sub-word.is-active-word").forEach((el) => {
    el.classList.remove("is-active-word");
  });
  state.subDictOpen = false;
  if (resumePlayback && state.pausedBySubWord) {
    state.pausedBySubWord = false;
    const video = document.getElementById("native-video");
    if (video && video.paused && state.isPlayerOpen) {
      video.play().catch(() => {});
    }
  } else if (!resumePlayback) {
    state.pausedBySubWord = false;
  }
}

export async function openSubtitleDictPopover(rawWord, contextText = "", wordEl = null) {
  if (typeof document === "undefined") return;
  const cleanWord = String(rawWord || "").replace(/^[^A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9]+|[^A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9]+$/g, "").trim();
  if (!cleanWord) return;
  const pop = document.getElementById("atv-sub-dict-popover");
  const wordNode = document.getElementById("sub-dict-word");
  const primaryNode = document.getElementById("sub-dict-primary");
  const altsNode = document.getElementById("sub-dict-alts");
  const ctxNode = document.getElementById("sub-dict-ctx");
  if (!pop || !wordNode || !primaryNode) return;

  const video = document.getElementById("native-video");
  if (video && !video.paused) {
    video.pause();
    state.pausedBySubWord = true;
  }

  document.querySelectorAll("#atv-subtitle-overlay .atv-sub-word.is-active-word").forEach((el) => {
    el.classList.remove("is-active-word");
  });
  if (wordEl) {
    wordEl.classList.add("is-active-word");
  }

  const isCyrillic = /[А-Яа-яЁёІіЇїЄєҐґ]/.test(cleanWord);
  const targetLang = isCyrillic ? "en" : "ru";
  wordNode.textContent = cleanWord;
  primaryNode.textContent = t("Перевод...", "Translating...");
  if (altsNode) {
    altsNode.innerHTML = "";
    altsNode.classList.add("hidden");
  }
  if (ctxNode) {
    ctxNode.textContent = "";
    ctxNode.classList.add("hidden");
  }
  pop.classList.remove("hidden");
  state.subDictOpen = true;

  const sessionSnap = state.playerSessionId;
  const cacheKey = `${cleanWord.toLowerCase()}|${targetLang}|${String(contextText || "").slice(0, 120)}`;
  let result = _subDictClientCache.get(cacheKey);
  if (!result) {
    try {
      const qs = new URLSearchParams({
        word: cleanWord,
        context: String(contextText || "").replace(/\s+/g, " ").trim().slice(0, 220),
        target_lang: targetLang,
      });
      const res = await fetch(`/api/subtitles/translate?${qs.toString()}`);
      if (res.ok) {
        result = await res.json();
        if (result && result.ok) {
          if (_subDictClientCache.size > 200) {
            const firstKey = _subDictClientCache.keys().next().value;
            _subDictClientCache.delete(firstKey);
          }
          _subDictClientCache.set(cacheKey, result);
        }
      }
    } catch (_) {}
  }

  if (
    !state.isPlayerOpen ||
    sessionSnap !== state.playerSessionId ||
    !state.subDictOpen ||
    wordNode.textContent !== cleanWord
  ) {
    return;
  }
  const primaryText = String(result?.translation || "").trim();
  primaryNode.textContent = primaryText || t("Перевод не найден", "Translation unavailable");

  const alts = Array.isArray(result?.alternatives)
    ? result.alternatives.map((a) => String(a || "").trim()).filter((a) => a && a.toLowerCase() !== primaryText.toLowerCase())
    : [];
  if (altsNode && alts.length > 0) {
    altsNode.innerHTML = alts
      .slice(0, 5)
      .map((a) => `<span class="atv-sub-dict-alt-pill">${escapeHtml(a)}</span>`)
      .join("");
    altsNode.classList.remove("hidden");
  }

  const ctxTrans = String(result?.context_translation || "").trim();
  if (ctxNode && ctxTrans && ctxTrans.toLowerCase() !== primaryText.toLowerCase()) {
    ctxNode.textContent = ctxTrans;
    ctxNode.classList.remove("hidden");
  }
}

export function updateCustomSubtitleOverlay(
  video = typeof document !== "undefined" ? document.getElementById("native-video") : null
) {
  if (typeof document === "undefined") return;
  const overlay = document.getElementById("atv-subtitle-overlay");
  if (!overlay) return;
  if (
    !video ||
    !state.isPlayerOpen ||
    state.activeSourceTab === "trailer" ||
    state.activeSubtitleIndex < 0 ||
    !Array.isArray(state.activeSubCues) ||
    state.activeSubCues.length === 0
  ) {
    if (state.lastRenderedSubCueText !== "") {
      state.lastRenderedSubCueText = "";
      overlay.innerHTML = "";
      overlay.classList.add("hidden");
    }
    return;
  }

  const { cur } = getEffectivePlaybackTiming(video);
  const trackMeta = state.activeSubTrackMeta;
  let cueLookupSec = cur - (Number(state.subtitleOffsetSec) || 0);
  if (trackMeta?.isWindowedEmbedded) {
    cueLookupSec =
      cur - (Number(trackMeta.windowStartSec) || 0) - (Number(state.subtitleOffsetSec) || 0);
    advanceWindowedSubtitleIfNeeded(trackMeta, cur);
  }

  const cues = state.activeSubCues;
  const activeLines = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.start > cueLookupSec + 0.08) break;
    if (cueLookupSec >= c.start - 0.06 && cueLookupSec <= c.end + 0.06) {
      activeLines.push(c.text);
    }
  }
  const combined = activeLines.join("\n").trim();
  if (combined === state.lastRenderedSubCueText) return;
  state.lastRenderedSubCueText = combined;

  if (!combined) {
    overlay.innerHTML = "";
    overlay.classList.add("hidden");
    return;
  }
  const htmlLines = combined
    .split("\n")
    .map((ln) => renderInteractiveSubtitleLineHtml(ln))
    .join("<br/>");
  overlay.innerHTML = `<span class="atv-subtitle-cue-line" data-cue-context="${escapeAttr(
    combined.replace(/\n+/g, " ")
  )}">${htmlLines}</span>`;
  overlay.classList.remove("hidden");
}

export function syncIosFullscreenNativeSubtitles(videoEl = null) {
  if (typeof document === "undefined") return;
  const video = videoEl || document.getElementById("native-video");
  if (!video) return;
  const inNativeIosFs = Boolean(video.webkitDisplayingFullscreen);
  if (!inNativeIosFs) {
    if (video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        try {
          video.textTracks[i].mode = "disabled";
        } catch (_) {}
      }
    }
    updateCustomSubtitleOverlay(video);
    return;
  }

  const cues = Array.isArray(state.activeSubCues) ? state.activeSubCues : [];
  const sub =
    state.activeSubtitleIndex >= 0 ? (state.subtitles || [])[state.activeSubtitleIndex] : null;
  if (!sub || !cues.length || typeof window.VTTCue !== "function") {
    if (video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        try {
          video.textTracks[i].mode = "disabled";
        } catch (_) {}
      }
    }
    return;
  }

  const offset = state.remuxMeta?.active ? Number(state.remuxMeta.offsetSec) || 0 : 0;
  const userDelay = Number(state.subtitleOffsetSec) || 0;
  const baseShift = sub?.isWindowedEmbedded
    ? offset - (Number(sub.windowStartSec) || 0)
    : sub?.isFullTimeline
    ? offset
    : 0;
  let targetTrack = null;
  if (video.textTracks) {
    for (let i = 0; i < video.textTracks.length; i++) {
      if (video.textTracks[i].label === "CineFlow Native FS") {
        targetTrack = video.textTracks[i];
      } else {
        try {
          video.textTracks[i].mode = "disabled";
        } catch (_) {}
      }
    }
  }
  if (!targetTrack && typeof video.addTextTrack === "function") {
    targetTrack = video.addTextTrack("subtitles", "CineFlow Native FS", "en");
  }
  if (!targetTrack) return;

  try {
    while (targetTrack.cues && targetTrack.cues.length > 0) {
      targetTrack.removeCue(targetTrack.cues[0]);
    }
  } catch (_) {}

  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const s = c.start - baseShift + userDelay;
    const e = c.end - baseShift + userDelay;
    if (e <= 0 || e <= s) continue;
    try {
      targetTrack.addCue(new window.VTTCue(Math.max(0, s), e, c.text));
    } catch (_) {}
  }
  try {
    targetTrack.mode = "showing";
  } catch (_) {}
  document.getElementById("atv-subtitle-overlay")?.classList.add("hidden");
}

export function activateSelectedSubtitleTrack() {
  if (typeof document === "undefined") return;
  const video = document.getElementById("native-video");
  if (video) {
    video.querySelectorAll("track").forEach((tr) => tr.remove());
    if (video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        try {
          video.textTracks[i].mode = "disabled";
        } catch (_) {}
      }
    }
  }

  const sub =
    state.activeSubtitleIndex >= 0 ? (state.subtitles || [])[state.activeSubtitleIndex] : null;
  if (state.subFetchAbortController) {
    try {
      state.subFetchAbortController.abort();
    } catch (_) {}
    state.subFetchAbortController = null;
  }
  state.subFetchReqId = (state.subFetchReqId || 0) + 1;
  state.subWindowAdvancing = false;
  if (!sub || (!sub.url && !Array.isArray(sub.inlineCues)) || !state.isPlayerOpen) {
    clearCustomSubtitleOverlay(false);
    syncIosFullscreenNativeSubtitles(video);
    return;
  }

  if (Array.isArray(sub.inlineCues) && sub.inlineCues.length > 0) {
    state.loadedSubUrl = String(sub.url || "local://inline");
    state.activeSubCues = sub.inlineCues;
    state.activeSubTrackMeta = sub;
    state.lastRenderedSubCueText = "__force_refresh__";
    if (video?.webkitDisplayingFullscreen) {
      syncIosFullscreenNativeSubtitles(video);
    } else {
      updateCustomSubtitleOverlay(video);
    }
    return;
  }

  const fetchUrl =
    sub.direct_vtt || String(sub.url).startsWith("/")
      ? sub.url
      : `/api/proxy-vtt?url=${encodeURIComponent(sub.url)}`;

  if (
    state.loadedSubUrl === fetchUrl &&
    Array.isArray(state.activeSubCues) &&
    state.activeSubCues.length > 0
  ) {
    state.activeSubTrackMeta = sub;
    if (video?.webkitDisplayingFullscreen) {
      syncIosFullscreenNativeSubtitles(video);
    } else {
      updateCustomSubtitleOverlay(video);
    }
    return;
  }

  const subAbort = new AbortController();
  state.subFetchAbortController = subAbort;
  const reqId = state.subFetchReqId;
  state.activeSubTrackMeta = sub;
  clearCustomSubtitleOverlay(true);

  fetch(fetchUrl, { signal: subAbort.signal })
    .then((r) => (r.ok ? r.text() : ""))
    .then((rawVtt) => {
      if (!state.isPlayerOpen || reqId !== state.subFetchReqId) return;
      const parsedCues = parseSubtitleCues(rawVtt);
      state.loadedSubUrl = fetchUrl;
      state.activeSubCues = parsedCues;
      state.activeSubTrackMeta = sub;
      const curVid = document.getElementById("native-video");
      if (curVid?.webkitDisplayingFullscreen) {
        syncIosFullscreenNativeSubtitles(curVid);
      } else {
        updateCustomSubtitleOverlay(curVid);
      }
    })
    .catch((err) => {
      if (err && err.name === "AbortError") return;
    });
}

export function attachVideoSubtitles() {
  activateSelectedSubtitleTrack();
}

export function buildRemuxSubtitlesList(meta, offsetSec = 0) {
  if (!meta) return mergeCustomExternalSubtitles([]);
  const ssVal = Math.max(0, Math.round((Number(offsetSec) || 0) * 10) / 10);
  const out = [];
  if (Array.isArray(meta.externalSubtitles)) {
    meta.externalSubtitles.forEach((ext) => {
      const rawSubUrl = ext?.raw_url || ext?.url || "";
      if (!rawSubUrl) return;
      let cleanProxied = String(rawSubUrl);
      if (cleanProxied.startsWith("/api/proxy-vtt?")) {
        cleanProxied = cleanProxied.replace(/([?&])ss=[^&]*/g, "");
        cleanProxied += cleanProxied.includes("?") ? "&ss=0" : "?ss=0";
      } else {
        cleanProxied = `/api/proxy-vtt?url=${encodeURIComponent(cleanProxied)}&ss=0`;
      }
      let dispLang = String(ext.lang || ext.label || "OpenSubtitles").trim();
      if (isEn()) {
        dispLang = dispLang
          .replace(/^Русский\b/i, "Russian")
          .replace(/^(Українська|Украинский)\b/i, "Ukrainian")
          .replace(/^Английский\b/i, "English")
          .replace(/^Польский\b/i, "Polish");
      }
      out.push({
        lang: dispLang,
        url: cleanProxied,
        direct_vtt: true,
        isFullTimeline: true,
      });
    });
  }
  if (Array.isArray(meta.subtitleTracks)) {
    const winDurSec = 420;
    meta.subtitleTracks.forEach((st) => {
      const qs = new URLSearchParams({
        src: meta.rawSourceUrl,
        si: String(st.stream_index),
        ss: String(ssVal),
        dur: String(winDurSec),
      });
      out.push({
        lang: st.label ? `${st.label} (MKV)` : `Track #${st.stream_index} (MKV)`,
        url: `/api/remux-subtitle?${qs.toString()}`,
        direct_vtt: true,
        isWindowedEmbedded: true,
        rawSourceUrl: meta.rawSourceUrl,
        streamIndex: st.stream_index,
        windowStartSec: ssVal,
        windowDurSec: winDurSec,
      });
    });
  }
  return mergeCustomExternalSubtitles(out);
}

export function refreshRemuxSubtitleTracks(offsetSec = 0) {
  if (!state.remuxMeta || !state.remuxMeta.active) return;
  const prevSub =
    state.activeSubtitleIndex >= 0 ? (state.subtitles || [])[state.activeSubtitleIndex] : null;
  state.subtitles = buildRemuxSubtitlesList(state.remuxMeta, offsetSec);
  if (state.activeSubtitleIndex >= state.subtitles.length) {
    state.activeSubtitleIndex = -1;
  }
  populateSubtitlesSelector(state.subtitles);
  syncCustomControlPopovers();
  if (state.activeSubtitleIndex >= 0) {
    if (
      (prevSub?.isFullTimeline && state.subtitles[state.activeSubtitleIndex]?.isFullTimeline) ||
      Array.isArray(state.subtitles[state.activeSubtitleIndex]?.inlineCues)
    ) {
      state.activeSubTrackMeta = state.subtitles[state.activeSubtitleIndex];
      updateCustomSubtitleOverlay();
    } else {
      activateSelectedSubtitleTrack();
    }
  } else {
    clearCustomSubtitleOverlay(false);
  }
}

export function decodeSubtitleArrayBuffer(buffer) {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    try {
      return new TextDecoder("windows-1251").decode(bytes);
    } catch (__) {
      return new TextDecoder("utf-8").decode(bytes);
    }
  }
}

export async function loadLocalSubtitleFile(file) {
  if (!file || !state.isPlayerOpen) return false;
  const sessionSnap = state.playerSessionId;
  const name = String(file.name || "subtitles.srt").trim();
  if (!/\.(srt|vtt|ass|ssa|sub)$/i.test(name)) {
    showToast(
      t(
        "Поддерживаются файлы субтитров .srt, .vtt, .ass и .ssa",
        "Supported subtitle formats: .srt, .vtt, .ass, .ssa"
      )
    );
    return false;
  }
  try {
    const buf = await file.arrayBuffer();
    if (!state.isPlayerOpen || sessionSnap !== state.playerSessionId) return false;
    const rawText = decodeSubtitleArrayBuffer(buf);
    const cues = parseSubtitleCues(rawText);
    if (!cues.length) {
      showToast(
        t(
          "Не удалось распознать таймкоды в выбранном файле субтитров",
          "Could not parse subtitle cues from the selected file"
        )
      );
      return false;
    }
    const shortName = name.replace(/\.(srt|vtt|ass|ssa|sub)$/i, "").slice(0, 34);
    const entry = {
      lang: `${shortName} (${t("Файл", "File")})`,
      url: `local://${Date.now()}_${encodeURIComponent(name)}`,
      direct_vtt: true,
      isFullTimeline: true,
      isCustomExternal: true,
      inlineCues: cues,
    };
    state.customExternalSubtitles = [...(state.customExternalSubtitles || []), entry];
    const nextSubs = mergeCustomExternalSubtitles(state.subtitles || []);
    state.subtitles = nextSubs;
    state.activeSubtitleIndex = nextSubs.findIndex((s) => s.url === entry.url);
    populateSubtitlesSelector(nextSubs);
    activateSelectedSubtitleTrack();
    const subSel = document.getElementById("select-subtitle");
    if (subSel) {
      subSel.value = String(state.activeSubtitleIndex);
    }
    syncCustomControlPopovers();
    showVideoOsd("subtitles", `${t("Субтитры подключены", "Subtitles loaded")}: ${shortName}`);
    showToast(
      t(
        `Подключён файл субтитров «${shortName}» (${cues.length} реплик)`,
        `Loaded subtitle file "${shortName}" (${cues.length} cues)`
      )
    );
    return true;
  } catch (err) {
    console.warn("Local subtitle file error:", err);
    showToast(t("Ошибка при чтении файла субтитров", "Failed to read subtitle file"));
    return false;
  }
}

export function triggerLocalSubtitleFilePicker() {
  if (typeof document === "undefined") return;
  const inp = document.getElementById("input-local-subtitle-file");
  if (!inp) return;
  inp.value = "";
  inp.click();
}

export async function searchOnlineSubtitlesForActiveTitle() {
  if (!state.activeItem || !state.isPlayerOpen || state.subOnlineSearching) return;
  const item = state.activeItem;
  const sessionId = state.playerSessionId;
  state.subOnlineSearching = true;
  syncCustomControlPopovers();
  const subsPop = typeof document !== "undefined" ? document.getElementById("vc-subs-popover") : null;
  if (subsPop && !subsPop.classList.contains("hidden")) {
    clampStagePopover(subsPop);
  }

  try {
    const rawImdb =
      item.imdb_id && /^tt\d{5,10}$/i.test(String(item.imdb_id))
        ? String(item.imdb_id)
        : /^tt\d{5,10}$/i.test(String(item.id || ""))
        ? String(item.id)
        : "";
    const qs = new URLSearchParams({
      id: item.id || "",
      imdb_id: rawImdb,
      title: item.title || "",
      orig_title: item.orig_title || "",
      year: String(item.year || ""),
      media_type: item.media_type || "movie",
      season: String(state.activeSeason || 1),
      episode: String(state.activeEpisode || 1),
      lang: state.appLang || "ru",
    });
    const res = await fetch(`/api/subtitles/search?${qs.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!state.isPlayerOpen || sessionId !== state.playerSessionId) return;
    if (!res.ok || data?.ok === false) {
      showToast(
        data?.error ||
          t(
            "Онлайн-субтитры в базе OpenSubtitles для этого тайтла не найдены",
            "No online subtitles found on OpenSubtitles for this title"
          )
      );
      return;
    }
    if (data.imdb_id && !item.imdb_id) {
      item.imdb_id = data.imdb_id;
    }
    const found = Array.isArray(data.subtitles) ? data.subtitles : [];
    if (!found.length) {
      showToast(
        t(
          "Онлайн-субтитры в базе OpenSubtitles для этого тайтла не найдены",
          "No online subtitles found on OpenSubtitles for this title"
        )
      );
      return;
    }
    const mapped = found.map((s) => ({
      lang: String(s.lang || "OpenSubtitles").trim(),
      url: String(s.url || ""),
      direct_vtt: Boolean(s.direct_vtt || String(s.url || "").startsWith("/api/proxy-vtt?")),
      isFullTimeline: true,
      isCustomExternal: true,
    }));
    const prevCount = (state.subtitles || []).length;
    state.customExternalSubtitles = mergeCustomExternalSubtitles([
      ...(state.customExternalSubtitles || []),
      ...mapped,
    ]);
    const nextSubs = mergeCustomExternalSubtitles(state.subtitles || []);
    state.subtitles = nextSubs;
    const addedCount = Math.max(0, nextSubs.length - prevCount);
    if (state.activeSubtitleIndex < 0 && nextSubs.length > 0) {
      const wantEn = isEn();
      const prefIdx = nextSubs.findIndex((s) =>
        wantEn
          ? /eng|англ|english/i.test(String(s.lang || ""))
          : /рус|rus|russian/i.test(String(s.lang || ""))
      );
      state.activeSubtitleIndex = prefIdx >= 0 ? prefIdx : prevCount < nextSubs.length ? prevCount : 0;
      activateSelectedSubtitleTrack();
    }
    populateSubtitlesSelector(nextSubs);
    const subSel = document.getElementById("select-subtitle");
    if (subSel) subSel.value = String(state.activeSubtitleIndex);
    syncCustomControlPopovers();
    if (subsPop && !subsPop.classList.contains("hidden")) {
      clampStagePopover(subsPop);
    }
    showToast(
      addedCount > 0
        ? t(
            `Найдено и добавлено онлайн-субтитров: ${addedCount}`,
            `Found and added ${addedCount} online subtitle tracks`
          )
        : t("Все доступные онлайн-субтитры уже в списке", "All available online subtitles are already listed")
    );
  } catch (err) {
    console.warn("Online subtitle search error:", err);
    showToast(t("Не удалось выполнить онлайн-поиск субтитров", "Online subtitle search failed"));
  } finally {
    state.subOnlineSearching = false;
    syncCustomControlPopovers();
  }
}

export function renderVcSubtitlesPopover(subsWrap, subsLbl, subsPop, subsSel, bindPopoverQuickSearch) {
  if (!subsWrap || !subsLbl || !subsPop || !subsSel) return;
  if (state.activeSourceTab === "trailer") {
    subsWrap.classList.add("hidden");
    subsPop.innerHTML = "";
    return;
  }

  subsWrap.classList.remove("hidden");
  const subsList = state.subtitles || [];
  const activeSub = state.activeSubtitleIndex >= 0 ? subsList[state.activeSubtitleIndex] : null;
  subsLbl.textContent = activeSub ? activeSub.lang || t("Включены", "On") : t("Субтитры", "Subtitles");

  const subOpts = Array.from(subsSel.options || []);
  const showSubSearch = subOpts.length >= 10;
  const subSearchHtml = showSubSearch
    ? `<div class="atv-vc-pop-search-wrap"><input type="text" class="atv-vc-pop-search" placeholder="${escapeAttr(
        t("Поиск субтитров...", "Filter subtitles...")
      )}" autocomplete="off" spellcheck="false" /></div>`
    : "";

  subsPop.innerHTML = `<div class="atv-vc-pop-title">${t("Субтитры", "Subtitles")}</div>${subSearchHtml}`;

  const tracksBox = document.createElement("div");
  tracksBox.className = "atv-vc-subs-tracks-list";
  if (subOpts.length === 0) {
    const offBtn = document.createElement("button");
    offBtn.type = "button";
    offBtn.className = "atv-vc-pop-item active";
    offBtn.innerHTML = `<span>${t("Выключены", "Off")}</span><span>${iconSvg("check", 12)}</span>`;
    offBtn.onclick = (ev) => {
      ev.stopPropagation();
      closeAllVcPopovers();
    };
    tracksBox.appendChild(offBtn);
  } else {
    subOpts.forEach((opt) => {
      const isAct = String(state.activeSubtitleIndex) === String(opt.value);
      const b = document.createElement("button");
      b.type = "button";
      b.className = `atv-vc-pop-item${isAct ? " active" : ""}`;
      b.innerHTML = `<span class="atv-vc-pop-item-main"><span>${escapeHtml(
        opt.textContent
      )}</span></span><span>${isAct ? iconSvg("check", 12) : ""}</span>`;
      b.onclick = (ev) => {
        ev.stopPropagation();
        closeAllVcPopovers();
        subsSel.value = opt.value;
        subsSel.dispatchEvent(new Event("change"));
        syncCustomControlPopovers();
      };
      tracksBox.appendChild(b);
    });
  }
  subsPop.appendChild(tracksBox);

  if (showSubSearch) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "atv-vc-pop-empty hidden";
    emptyDiv.textContent = t("Ничего не найдено", "No matches");
    subsPop.appendChild(emptyDiv);
    if (typeof bindPopoverQuickSearch === "function") {
      bindPopoverQuickSearch(subsPop);
    }
  }

  const toolsSection = document.createElement("div");
  toolsSection.className = "atv-vc-subs-tools";
  const offsetFormatted = formatSubtitleOffsetLabel(state.subtitleOffsetSec);
  const hasOffset = Math.abs(Number(state.subtitleOffsetSec) || 0) >= 0.01;
  toolsSection.innerHTML = `
    <div class="atv-vc-pop-divider"></div>
    <div class="atv-vc-subs-sync-row">
      <span class="atv-vc-subs-sync-lbl">${t("Синхронизация", "Timing Sync")}</span>
      <div class="atv-sub-offset-stepper">
        <button type="button" class="atv-sub-step-btn js-vc-sub-minus" title="${escapeAttr(
          t("Субтитры раньше на 0.25 секунды", "Subtitles 0.25 seconds earlier")
        )}">−0.25</button>
        <button type="button" class="atv-sub-step-val js-sub-offset-reset${
          hasOffset ? " is-modified" : ""
        }" id="vc-sub-offset-val" title="${escapeAttr(
    t("Сбросить задержку субтитров", "Reset subtitle timing offset")
  )}">${escapeHtml(offsetFormatted)}</button>
        <button type="button" class="atv-sub-step-btn js-vc-sub-plus" title="${escapeAttr(
          t("Субтитры позже на 0.25 секунды", "Subtitles 0.25 seconds later")
        )}">+0.25</button>
      </div>
    </div>
    <div class="atv-vc-subs-actions-row">
      <button type="button" class="atv-vc-subs-action-btn js-vc-sub-search-online"${
        state.subOnlineSearching ? " disabled" : ""
      }>
        ${iconSvg("search", 13)}
        <span>${
          state.subOnlineSearching
            ? t("Поиск OpenSubtitles...", "Searching OpenSubtitles...")
            : t("Найти онлайн", "Find Online")
        }</span>
      </button>
      <button type="button" class="atv-vc-subs-action-btn js-vc-sub-upload-file">
        ${iconSvg("upload", 13)}
        <span>${t("Файл .srt / .ass", "Load .srt / .ass")}</span>
      </button>
    </div>
  `;

  toolsSection.querySelector(".js-vc-sub-minus")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    adjustSubtitleOffset(-0.25, true);
  });
  toolsSection.querySelector(".js-sub-offset-reset")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    resetSubtitleOffset(true);
  });
  toolsSection.querySelector(".js-vc-sub-plus")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    adjustSubtitleOffset(0.25, true);
  });
  toolsSection.querySelector(".js-vc-sub-search-online")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    searchOnlineSubtitlesForActiveTitle();
  });
  toolsSection.querySelector(".js-vc-sub-upload-file")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeAllVcPopovers();
    triggerLocalSubtitleFilePicker();
  });

  subsPop.appendChild(toolsSection);
}

let _subDropListenersBound = false;
export function bindSubtitleFileAndDropListeners() {
  if (_subDropListenersBound || typeof document === "undefined") return;
  _subDropListenersBound = true;

  const fileInput = document.getElementById("input-local-subtitle-file");
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) {
        loadLocalSubtitleFile(f);
      }
      fileInput.value = "";
    });
  }

  const subOverlay = document.getElementById("atv-subtitle-overlay");
  if (subOverlay) {
    subOverlay.addEventListener("click", (e) => {
      const wordEl = e.target.closest(".atv-sub-word");
      if (!wordEl) return;
      e.preventDefault();
      e.stopPropagation();
      const rawWord = wordEl.getAttribute("data-word") || wordEl.textContent || "";
      const lineEl = wordEl.closest(".atv-subtitle-cue-line");
      const ctxText = lineEl?.getAttribute("data-cue-context") || lineEl?.textContent || "";
      openSubtitleDictPopover(rawWord, ctxText, wordEl);
    });
  }

  const dictPop = document.getElementById("atv-sub-dict-popover");
  if (dictPop) {
    dictPop.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }
  const btnCloseDict = document.getElementById("btn-close-sub-dict");
  if (btnCloseDict) {
    btnCloseDict.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeSubtitleDictPopover(true);
    });
  }

  const stage = document.getElementById("video-stage");
  const dropzone = document.getElementById("video-dropzone");
  if (stage) {
    let dragDepth = 0;
    stage.addEventListener("dragenter", (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      dragDepth += 1;
      stage.classList.add("is-sub-drop-target");
      if (dropzone) dropzone.classList.remove("hidden");
    });
    stage.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (dropzone && dropzone.classList.contains("hidden")) {
        dropzone.classList.remove("hidden");
      }
    });
    stage.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        stage.classList.remove("is-sub-drop-target");
        if (dropzone) dropzone.classList.add("hidden");
      }
    });
    stage.addEventListener("drop", (e) => {
      dragDepth = 0;
      stage.classList.remove("is-sub-drop-target");
      if (dropzone) dropzone.classList.add("hidden");
      const files = Array.from(e.dataTransfer?.files || []);
      const subFile = files.find((f) => /\.(srt|vtt|ass|ssa|sub)$/i.test(String(f.name || "")));
      if (subFile) {
        e.preventDefault();
        e.stopPropagation();
        loadLocalSubtitleFile(subFile);
        return;
      }
      const videoFile = files.find((f) => /\.(mp4|mkv|webm|mov|m4v)$/i.test(String(f.name || "")));
      if (videoFile) {
        e.preventDefault();
        e.stopPropagation();
        const video = document.getElementById("native-video");
        if (video) {
          if (video._cfLocalBlobUrl) {
            try {
              URL.revokeObjectURL(video._cfLocalBlobUrl);
            } catch (_) {}
            video._cfLocalBlobUrl = null;
          }
          const cleanName = videoFile.name.replace(/\.[^/.]+$/, "");
          const objUrl = URL.createObjectURL(videoFile);
          video._cfLocalBlobUrl = objUrl;
          state.playerSessionId = (Number(state.playerSessionId) || 0) + 1;
          state.videoLoadToken = (Number(state.videoLoadToken) || 0) + 1;
          if (state.videoLoadAbort) {
            try {
              state.videoLoadAbort.abort();
            } catch (_) {}
            state.videoLoadAbort = null;
          }
          if (state.videoLoadAbortController) {
            try {
              state.videoLoadAbortController.abort();
            } catch (_) {}
            state.videoLoadAbortController = null;
          }
          if (state.hlsInstance) {
            try {
              state.hlsInstance.destroy();
            } catch (_) {}
            state.hlsInstance = null;
          }
          state.remuxMeta = {
            active: false,
            rawSourceUrl: "",
            audioIndex: 0,
            offsetSec: 0,
            duration: 0,
            audioTracks: [],
            subtitleTracks: [],
          };
          state.activeItem = {
            id: `local_${Date.now()}`,
            title: cleanName,
            media_type: "movie",
            year: new Date().getFullYear(),
          };
          state.currentStreamUrl = objUrl;
          video.src = objUrl;
          video.play().catch(() => {});
          showToast(t(`Воспроизведение файла «${cleanName}»`, `Playing file "${cleanName}"`));
        }
      }
    });
  }
}
