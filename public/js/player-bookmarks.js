import { BOOKMARKS_STORAGE_KEY, profileStorageKey, state } from "./state.js?v=20261110v1";
import {
  displayPoster,
  displayTitle,
  hasCyrillicText,
  isEn,
  t,
  transliterateRuToEn,
} from "./i18n.js?v=20261110v1";
import {
  attachHorizontalWheelScroll,
  clampStagePopover,
  closeFloatingPopovers,
  copyTextToClipboard,
  escapeAttr,
  escapeHtml,
  formatTime,
  iconSvg,
  rememberModalTriggerFocus,
  restoreModalTriggerFocus,
  showToast,
  syncScrollTopButton,
} from "./utils.js?v=20261110v1";
import { attachSmartPosterFallback } from "./catalog.js?v=20261110v1";
import { openPersonModal } from "./modals.js?v=20261110v1";
import { buildFallbackAvatarSvg } from "./modals-person.js?v=20261110v1";
import { getEffectivePlaybackTiming } from "./player-remux.js?v=20261110v1";
import { seekEffectivePlayback } from "./player-streams.js?v=20261110v1";
import { findActiveChapterLabel, syncVcPopoverOpenClass } from "./player-ui-controls.js?v=20261110v1";
import { exitBrowserFullscreenIfNeeded } from "./features.js?v=20261110v1";
import { scheduleDesktopRemoteStatePush } from "./remote.js?v=20261110v1";

let _bookmarkDialogWasPlaying = false;
let _activeEditingMoment = null;
let _activeEditingTimeSec = null;
let _activeBookmarkModalFilter = "all";
let _editingModalMomentId = null;
let _activeXRayTab = "cast";
let _xrayPreviewAudio = null;
let _xrayPreviewBtn = null;
let _xrayDismissedSessionId = -1;
let _xrayBindingsDone = false;

function _matchesActiveTitle(m, activeItem = state.activeItem) {
  if (!m || !activeItem) return false;
  const itemId = String(activeItem.id || activeItem.kinorium_id || activeItem.title || "");
  if (itemId && String(m.itemId || "") === itemId) return true;
  if (activeItem.kinorium_id && m.kinorium_id && String(activeItem.kinorium_id) === String(m.kinorium_id)) {
    return true;
  }
  if (activeItem.rezka_id && m.rezka_id && String(activeItem.rezka_id) === String(m.rezka_id)) {
    return true;
  }
  if (activeItem.imdb_id && m.imdb_id && String(activeItem.imdb_id) === String(m.imdb_id)) {
    return true;
  }
  return false;
}

function _matchesActiveTitleAndEpisode(m, activeItem = state.activeItem) {
  if (!_matchesActiveTitle(m, activeItem)) return false;
  const isSeries = activeItem?.media_type === "series";
  if (!isSeries) return true;
  const curSeason = Number(state.activeSeason) || 1;
  const curEpisode = Number(state.activeEpisode) || 1;
  return Number(m.season || 1) === curSeason && Number(m.episode || 1) === curEpisode;
}

function _hydrateMomentFromActiveState(targetMoment) {
  if (!targetMoment || !state.activeItem) return targetMoment;
  const it = state.activeItem;
  if (it.kinorium_id && !targetMoment.kinorium_id) targetMoment.kinorium_id = String(it.kinorium_id);
  if (it.imdb_id && !targetMoment.imdb_id) targetMoment.imdb_id = String(it.imdb_id);
  if (it.rezka_id && !targetMoment.rezka_id) targetMoment.rezka_id = String(it.rezka_id);
  if (it.rezka_url && !targetMoment.rezka_url) targetMoment.rezka_url = String(it.rezka_url);
  if (state.activeSourceTab) targetMoment.source = String(state.activeSourceTab);
  return targetMoment;
}

function _buildMomentFromActiveState(curSec, noteText = "") {
  const it = state.activeItem || {};
  const itemId = String(it.id || it.kinorium_id || it.title || "");
  const curSeason = Number(state.activeSeason) || 1;
  const curEpisode = Number(state.activeEpisode) || 1;
  const now = Date.now();
  return {
    id: `moment_${now}_${Math.random().toString(36).slice(2, 6)}`,
    itemId,
    kinorium_id: String(it.kinorium_id || ""),
    imdb_id: String(it.imdb_id || ""),
    rezka_id: String(it.rezka_id || ""),
    rezka_url: String(it.rezka_url || ""),
    source: String(state.activeSourceTab || it.source || "hdrezka"),
    title: displayTitle(it) || it.title || it.orig_title || "Velarium",
    orig_title: it.orig_title || "",
    poster: displayPoster(it) || it.poster || "",
    year: it.year || "",
    media_type: it.media_type || "movie",
    season: curSeason,
    episode: curEpisode,
    time: curSec,
    label: formatTime(curSec),
    note: String(noteText || "").trim(),
    createdAt: now,
    updatedAt: now,
  };
}

function _stopXRayPreviewAudio() {
  if (_xrayPreviewAudio) {
    try {
      _xrayPreviewAudio.ontimeupdate = null;
      _xrayPreviewAudio.onended = null;
      _xrayPreviewAudio.onerror = null;
      _xrayPreviewAudio.pause();
      _xrayPreviewAudio.src = "";
    } catch (_) {}
    _xrayPreviewAudio = null;
  }
  if (_xrayPreviewBtn) {
    _xrayPreviewBtn.classList.remove("is-playing");
    _xrayPreviewBtn.closest(".atv-xray-track-card")?.classList.remove("is-playing");
    _xrayPreviewBtn.innerHTML = `${iconSvg("play", 11)}<span>${escapeHtml(t("Слушать", "Preview"))}</span>`;
    _xrayPreviewBtn = null;
  }
}

function _syncXRayControlBtnState(isVisible) {
  const xrayBtn = document.getElementById("vc-btn-xray");
  if (xrayBtn) {
    xrayBtn.classList.toggle("active", Boolean(isVisible));
    xrayBtn.setAttribute("aria-pressed", isVisible ? "true" : "false");
  }
}

export function hideXRayPauseShelf() {
  _stopXRayPreviewAudio();
  if (_xrayScrollSettleTimer) {
    clearTimeout(_xrayScrollSettleTimer);
    _xrayScrollSettleTimer = null;
  }
  if (_xrayRafSyncId) {
    cancelAnimationFrame(_xrayRafSyncId);
    _xrayRafSyncId = 0;
  }
  const shelf = document.getElementById("xray-pause-shelf");
  if (shelf) {
    shelf.classList.add("hidden");
    shelf.classList.remove("is-compact");
  }
  document.getElementById("xray-compact-pill")?.classList.add("hidden");
  _syncXRayControlBtnState(false);
  scheduleDesktopRemoteStatePush(80);
}

export function expandXRayPauseShelf() {
  const shelf = document.getElementById("xray-pause-shelf");
  if (!shelf) return;
  const compactPill = document.getElementById("xray-compact-pill");
  const wasFocusedOnPill = Boolean(compactPill && document.activeElement === compactPill);
  _updateXRaySceneMeta();
  if (state.activeItem) {
    const langKey = isEn() ? "en" : "ru";
    const cachedXRay =
      state.activeItem._xrayData && state.activeItem._xrayDataLang === langKey
        ? state.activeItem._xrayData
        : null;
    const sceneCtx = resolveActiveXRaySceneContext();
    _renderXRayCastSection(state.activeItem, sceneCtx);
    _renderXRaySoundtrackAndTrivia(state.activeItem, cachedXRay, sceneCtx);
  }
  shelf.classList.remove("is-compact", "hidden");
  compactPill?.classList.add("hidden");
  switchXRayTab(_activeXRayTab || "cast");
  _syncXRayControlBtnState(true);
  if (wasFocusedOnPill) {
    document.getElementById(`xray-tab-${_activeXRayTab || "cast"}`)?.focus({ preventScroll: true });
  }
  scheduleDesktopRemoteStatePush(80);
}

export function toggleXRayPauseShelf() {
  const shelf = document.getElementById("xray-pause-shelf");
  if (!shelf) return;
  const isVisible = !shelf.classList.contains("hidden");
  if (isVisible) {
    if (shelf.classList.contains("is-compact")) {
      expandXRayPauseShelf();
      return;
    }
    _xrayDismissedSessionId = state.playerSessionId || 0;
    hideXRayPauseShelf();
  } else {
    _xrayDismissedSessionId = -1;
    showXRayPauseShelf({ force: true });
  }
}

function _updateXRaySceneMeta() {
  const metaEl = document.getElementById("xray-scene-meta");
  if (!metaEl) return;
  const video = document.getElementById("native-video");
  const { cur, dur } = getEffectivePlaybackTiming(video);
  const parts = [];
  if (state.activeItem?.media_type === "series") {
    const sNum = Number(state.activeSeason) || 1;
    const eNum = Number(state.activeEpisode) || 1;
    parts.push(`S${sNum} · E${eNum}`);
  }
  if (cur > 0) {
    parts.push(formatTime(cur));
  }
  const chLabel = dur > 0 ? findActiveChapterLabel(cur, dur) : "";
  if (chLabel) {
    parts.push(chLabel);
  }
  if (parts.length > 0) {
    metaEl.textContent = parts.join(" · ");
    metaEl.classList.remove("hidden");
  } else {
    metaEl.textContent = "";
    metaEl.classList.add("hidden");
  }
}

function _updateXRayTabLabel(tabId, baseRu, baseEn, count) {
  const tabBtn = document.getElementById(tabId);
  if (!tabBtn) return;
  const baseText = t(baseRu, baseEn);
  tabBtn.textContent = count > 0 ? `${baseText} · ${count}` : baseText;
}

function _getActiveXRayListEl() {
  const idMap = {
    cast: "xray-cast-list",
    soundtrack: "xray-soundtrack-list",
    trivia: "xray-trivia-list",
  };
  return document.getElementById(idMap[_activeXRayTab] || "xray-cast-list");
}

function _syncXRayScrollButtons() {
  const prevBtn = document.getElementById("xray-scroll-prev");
  const nextBtn = document.getElementById("xray-scroll-next");
  if (!prevBtn || !nextBtn) return;
  const listEl = _getActiveXRayListEl();
  if (!listEl || listEl.classList.contains("hidden")) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    prevBtn.classList.add("is-hidden");
    nextBtn.classList.add("is-hidden");
    return;
  }
  const maxScroll = Math.max(0, (listEl.scrollWidth || 0) - (listEl.clientWidth || 0));
  const curScroll = Math.max(0, listEl.scrollLeft || 0);
  const hasOverflow = maxScroll > 4;
  const canLeft = hasOverflow && curScroll > 4;
  const canRight = hasOverflow && curScroll < maxScroll - 4;
  prevBtn.classList.toggle("is-hidden", !hasOverflow);
  nextBtn.classList.toggle("is-hidden", !hasOverflow);
  prevBtn.disabled = !canLeft;
  nextBtn.disabled = !canRight;
  listEl.classList.toggle("can-scroll-left", canLeft);
  listEl.classList.toggle("can-scroll-right", canRight);
}

let _xrayRafSyncId = 0;
let _xrayScrollSettleTimer = null;

function _syncXRayScrollButtonsRaf() {
  if (_xrayRafSyncId) return;
  _xrayRafSyncId = requestAnimationFrame(() => {
    _xrayRafSyncId = 0;
    _syncXRayScrollButtons();
  });
}

export function scrollActiveXRayList(direction = 1) {
  const listEl = _getActiveXRayListEl();
  if (!listEl) return;
  const step = Math.max(260, Math.round((listEl.clientWidth || 560) * 0.68));
  try {
    listEl.scrollBy({ left: direction * step, behavior: "smooth" });
  } catch (_) {
    listEl.scrollLeft += direction * step;
  }
  if (_xrayScrollSettleTimer) clearTimeout(_xrayScrollSettleTimer);
  _xrayScrollSettleTimer = setTimeout(_syncXRayScrollButtons, 220);
}

export function switchXRayTab(tabKey = "cast") {
  _activeXRayTab = ["cast", "soundtrack", "trivia"].includes(tabKey) ? tabKey : "cast";
  if (_activeXRayTab !== "soundtrack") {
    _stopXRayPreviewAudio();
  }
  document.querySelectorAll("#xray-pause-shelf [data-xray-tab]").forEach((btn) => {
    const isAct = btn.dataset.xrayTab === _activeXRayTab;
    btn.classList.toggle("active", isAct);
    btn.setAttribute("aria-selected", isAct ? "true" : "false");
  });
  document.getElementById("xray-cast-list")?.classList.toggle("hidden", _activeXRayTab !== "cast");
  document.getElementById("xray-soundtrack-list")?.classList.toggle("hidden", _activeXRayTab !== "soundtrack");
  document.getElementById("xray-trivia-list")?.classList.toggle("hidden", _activeXRayTab !== "trivia");
  requestAnimationFrame(_syncXRayScrollButtons);
  scheduleDesktopRemoteStatePush(80);
}

function _ensureXRayHeaderBindings() {
  if (_xrayBindingsDone) return;
  const shelf = document.getElementById("xray-pause-shelf");
  if (!shelf) return;
  _xrayBindingsDone = true;
  shelf.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  const closeBtn = document.getElementById("btn-close-xray");
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      _xrayDismissedSessionId = state.playerSessionId || 0;
      hideXRayPauseShelf();
    };
  }
  const compactPill = document.getElementById("xray-compact-pill");
  if (compactPill) {
    compactPill.onclick = (e) => {
      e.stopPropagation();
      expandXRayPauseShelf();
    };
  }
  const prevBtn = document.getElementById("xray-scroll-prev");
  if (prevBtn) {
    prevBtn.onclick = (e) => {
      e.stopPropagation();
      scrollActiveXRayList(-1);
    };
  }
  const nextBtn = document.getElementById("xray-scroll-next");
  if (nextBtn) {
    nextBtn.onclick = (e) => {
      e.stopPropagation();
      scrollActiveXRayList(1);
    };
  }
  shelf.querySelectorAll("[data-xray-tab]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      switchXRayTab(btn.dataset.xrayTab || "cast");
    };
  });
  ["xray-cast-list", "xray-soundtrack-list", "xray-trivia-list"].forEach((id) => {
    const listEl = document.getElementById(id);
    if (listEl) {
      attachHorizontalWheelScroll(listEl, { captureVerticalWheel: true });
      listEl.addEventListener("scroll", _syncXRayScrollButtonsRaf, { passive: true });
    }
  });
  window.addEventListener("resize", _syncXRayScrollButtonsRaf, { passive: true });
  shelf.addEventListener("keydown", (e) => {
    if (shelf.classList.contains("is-compact")) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      scrollActiveXRayList(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      scrollActiveXRayList(1);
    }
  });
}

function _buildXRayMonogramInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials =
    parts
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || "")
      .join("") || "CF";
  return initials.slice(0, 2);
}

const _XRAY_SCENE_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "young",
  "old",
  "kid",
  "boy",
  "girl",
  "man",
  "woman",
  "mr",
  "mrs",
  "ms",
  "dr",
  "sir",
  "lady",
  "lord",
  "detective",
  "agent",
  "officer",
  "captain",
  "general",
  "doctor",
  "cast",
  "actor",
  "director",
  "профессор",
  "доктор",
  "мистер",
  "миссис",
  "капитан",
  "детектив",
  "агент",
  "молодой",
  "старый",
  "взрослый",
  "юный",
  "ролях",
  "актёр",
  "актер",
  "режиссёр",
  "режиссер",
]);

function _normalizeSceneMatchText(str) {
  return ` ${String(str || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

let _lastXRaySceneCtxKey = "";
let _lastXRaySceneCtxVal = null;

export function resolveActiveXRaySceneContext(curSec = null, durSec = null) {
  const video = typeof document !== "undefined" ? document.getElementById("native-video") : null;
  const timing = getEffectivePlaybackTiming(video);
  const cur = Number.isFinite(Number(curSec)) && curSec !== null ? Number(curSec) : Number(timing.cur) || 0;
  const dur = Number.isFinite(Number(durSec)) && durSec !== null ? Number(durSec) : Number(timing.dur) || 0;
  const cues = Array.isArray(state.activeSubCues) ? state.activeSubCues : [];
  const sceneMemoKey = `${state.activeItem?.id || ""}:${state.activeSeason || 1}:${state.activeEpisode || 1}:${Math.floor(cur / 2)}:${Math.round(dur)}:${cues.length}:${state.subtitleOffsetSec || 0}:${state.appLang || "ru"}`;
  if (_lastXRaySceneCtxVal && _lastXRaySceneCtxKey === sceneMemoKey) {
    return _lastXRaySceneCtxVal;
  }

  const introStart = Number(state.skipSegments?.intro?.start) || Number(state.skipSegments?.intro?.start_sec) || 0;
  const introEnd = Number(state.skipSegments?.intro?.end) || Number(state.skipSegments?.intro?.end_sec) || 0;
  const creditsStart = Number(state.skipSegments?.outro?.start) || Number(state.skipSegments?.outro?.start_sec) || 0;

  let phase = "mid";
  if ((introEnd > 0 && cur >= introStart && cur <= introEnd + 18) || (dur > 180 && cur > 0 && cur / dur <= 0.14)) {
    phase = "intro";
  } else if ((creditsStart > 0 && cur >= creditsStart - 30) || (dur > 180 && cur / dur >= 0.82)) {
    phase = "finale";
  } else if (dur > 180 && cur / dur >= 0.6) {
    phase = "climax";
  }

  const chapterLabel = dur > 0 ? String(findActiveChapterLabel(cur, dur) || "").trim() : "";
  const chapterNorm = chapterLabel.length >= 4 ? _normalizeSceneMatchText(chapterLabel).trim() : "";
  const trackMeta = state.activeSubTrackMeta;
  let cueLookupSec = cur - (Number(state.subtitleOffsetSec) || 0);
  if (trackMeta?.isWindowedEmbedded) {
    cueLookupSec = cur - (Number(trackMeta.windowStartSec) || 0) - (Number(state.subtitleOffsetSec) || 0);
  }

  const winStart = Math.max(0, cueLookupSec - 45);
  const winEnd = cueLookupSec + 20;
  const windowLines = [];
  const musicLines = [];

  let lo = 0;
  let hi = cues.length - 1;
  let startIdx = cues.length;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if ((Number(cues[mid]?.end) || 0) >= winStart) {
      startIdx = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  for (let i = startIdx; i < cues.length; i++) {
    const c = cues[i];
    if (!c || typeof c.start !== "number") continue;
    if (c.start > winEnd) break;
    if (c.end >= winStart && c.start <= winEnd) {
      const rawTxt = String(c.text || "").trim();
      if (!rawTxt) continue;
      windowLines.push(rawTxt);
      if (/[\u266a\u266b]|\[(music|song|playing|играет|музыка|песня)/i.test(rawTxt)) {
        musicLines.push(rawTxt);
      }
    }
  }

  const builtCtx = {
    cur,
    dur,
    phase,
    chapterLabel,
    chapterNorm,
    dialogueText: windowLines.length > 0 ? _normalizeSceneMatchText(windowLines.join(" ")) : "",
    musicText: musicLines.length > 0 ? _normalizeSceneMatchText(musicLines.join(" ")) : "",
    hasSubWindow: windowLines.length > 0,
  };
  _lastXRaySceneCtxKey = sceneMemoKey;
  _lastXRaySceneCtxVal = builtCtx;
  return builtCtx;
}

export function isCastEntryInScene(personEntry, sceneCtx) {
  if (!personEntry || !sceneCtx || !sceneCtx.dialogueText) return false;
  if (personEntry.role === "director" || personEntry.is_director) return false;

  const rawChar = String(personEntry.character || "").trim();
  const rawName = String(personEntry.name || "").trim();
  const rawOrigName = String(personEntry.orig_name || "").trim();
  const cacheKey = `${rawChar}|${rawName}|${rawOrigName}`;

  let compiled = personEntry._xrayCompiledTokens;
  if (!compiled || personEntry._xrayCompiledKey !== cacheKey) {
    const sources = rawChar ? [rawChar, rawName, rawOrigName] : [rawName, rawOrigName];
    const seen = new Set();
    compiled = [];
    sources.forEach((src) => {
      const norm = _normalizeSceneMatchText(src).trim();
      if (!norm) return;
      norm.split(/\s+/).forEach((tok) => {
        if (tok.length >= 3 && !_XRAY_SCENE_STOPWORDS.has(tok) && !seen.has(tok)) {
          seen.add(tok);
          let stemRe = null;
          if (/^[а-я]+$/i.test(tok) && tok.length >= 4) {
            const stem = tok.length >= 5 && /[аяыиое]$/.test(tok) ? tok.slice(0, -1) : tok;
            if (stem.length >= 4) {
              stemRe = new RegExp(`\\s${stem}[а-я]{0,3}\\s`, "i");
            }
          }
          compiled.push({ exact: ` ${tok} `, stemRe });
        }
      });
    });
    personEntry._xrayCompiledKey = cacheKey;
    personEntry._xrayCompiledTokens = compiled;
  }

  if (compiled.length === 0) return false;
  const hay = sceneCtx.dialogueText;
  for (let i = 0; i < compiled.length; i++) {
    const item = compiled[i];
    if (hay.includes(item.exact)) return true;
    if (item.stemRe && item.stemRe.test(hay)) return true;
  }
  return false;
}

export function scoreTrackForScene(track, sceneCtx) {
  if (!track || track.is_search_fallback || !sceneCtx) {
    return { score: 0, inScene: false, badgeText: "" };
  }
  const rawTitle = String(track.title || "");
  const rawArtist = String(track.artist || "");
  const rawScene = String(track.scene || "").trim();
  const trackCacheKey = `${rawTitle}|${rawArtist}|${rawScene}`;
  let compiledTrack = track._xrayCompiledTrack;
  if (!compiledTrack || track._xrayCompiledTrackKey !== trackCacheKey) {
    const isGeneric = /^(официальный саундтрек|official soundtrack)$/i.test(rawScene);
    const scLower = isGeneric ? "" : rawScene.toLowerCase();
    compiledTrack = {
      titleNorm: _normalizeSceneMatchText(rawTitle).trim(),
      artistNorm: _normalizeSceneMatchText(rawArtist).trim(),
      scLower,
      scNorm: scLower ? _normalizeSceneMatchText(scLower) : "",
    };
    track._xrayCompiledTrackKey = trackCacheKey;
    track._xrayCompiledTrack = compiledTrack;
  }
  const { titleNorm, artistNorm, scLower, scNorm } = compiledTrack;
  if (titleNorm.length >= 4) {
    if (sceneCtx.musicText && sceneCtx.musicText.includes(` ${titleNorm} `)) {
      return { score: 100, inScene: true, badgeText: t("Звучит в сцене", "Playing in Scene") };
    }
    if (sceneCtx.dialogueText && sceneCtx.dialogueText.includes(` ${titleNorm} `)) {
      return { score: 95, inScene: true, badgeText: t("Звучит в сцене", "Playing in Scene") };
    }
  }
  if (artistNorm.length >= 4 && sceneCtx.musicText && sceneCtx.musicText.includes(` ${artistNorm} `)) {
    return { score: 90, inScene: true, badgeText: t("Звучит в сцене", "Playing in Scene") };
  }

  if (!scLower) {
    return { score: 0, inScene: false, badgeText: "" };
  }

  const chNorm =
    typeof sceneCtx.chapterNorm === "string"
      ? sceneCtx.chapterNorm
      : sceneCtx.chapterLabel && sceneCtx.chapterLabel.length >= 4
      ? _normalizeSceneMatchText(sceneCtx.chapterLabel).trim()
      : "";
  if (chNorm && scNorm.includes(` ${chNorm} `)) {
    return { score: 88, inScene: true, badgeText: t("Тема главы", "Chapter Theme") };
  }

  if (
    sceneCtx.phase === "intro" &&
    /(открывающ|вступительн|заставк|главная тема|пролог|в начале|opening|main title|intro|theme|prologue)/i.test(scLower)
  ) {
    return { score: 85, inScene: true, badgeText: t("Тема начала", "Opening Theme") };
  }
  if (
    sceneCtx.phase === "finale" &&
    /(финал|концовк|титр|прощани|конце|finale|final|ending|credits|farewell|outro)/i.test(scLower)
  ) {
    return { score: 85, inScene: true, badgeText: t("Тема финала", "Finale Theme") };
  }
  if (
    sceneCtx.phase === "climax" &&
    /(кульминац|погон|стыковк|испытани|битва|бой|перестрелк|побег|climax|chase|docking|test|duel|shootout|escape)/i.test(
      scLower
    )
  ) {
    return { score: 75, inScene: true, badgeText: t("Ключевая сцена", "Key Scene") };
  }

  return { score: 0, inScene: false, badgeText: "" };
}

function _renderXRayCastSection(item, sceneCtx = resolveActiveXRaySceneContext()) {
  const castEl = document.getElementById("xray-cast-list");
  if (!castEl || !item) return;
  const castPeople = (isEn() && item.cast_people_en?.length ? item.cast_people_en : item.cast_people) || [];
  const rawDirectors = (isEn() && item.directors_en?.length ? item.directors_en : item.directors) || [];
  const rawActors = (isEn() && item.actors_en?.length ? item.actors_en : item.actors) || [];
  const cards = [];
  const seenNames = new Set();

  castPeople.forEach((p, idx) => {
    const rawNm = String(p?.name || "").trim();
    const nm =
      isEn() && hasCyrillicText(rawNm)
        ? String(p?.orig_name || transliterateRuToEn(rawNm)).trim()
        : rawNm;
    if (!nm || seenNames.has(nm.toLowerCase())) return;
    seenNames.add(nm.toLowerCase());
    const isDir = p.role === "director" || Boolean(p.is_director);
    const charLabel =
      p.character && (!isEn() || !hasCyrillicText(p.character)) ? p.character : "";
    const roleLbl = isDir
      ? t("Режиссёр", "Director")
      : charLabel || t("В ролях", "Cast");
    const personObj = { ...p, name: nm };
    const inScene = isCastEntryInScene(personObj, sceneCtx);
    if (personObj._xrayCompiledTokens) {
      p._xrayCompiledTokens = personObj._xrayCompiledTokens;
      p._xrayCompiledKey = personObj._xrayCompiledKey;
    }
    cards.push({
      name: nm,
      lookupName: rawNm || nm,
      role: roleLbl,
      isDirector: isDir,
      inScene,
      orderIdx: idx,
      photoUrl: String(p?.photo || "").trim(),
      personObj,
    });
  });
  rawDirectors.forEach((nm, idx) => {
    const rawStr = String(nm || "").trim();
    const clean = isEn() && hasCyrillicText(rawStr) ? transliterateRuToEn(rawStr) : rawStr;
    if (!clean || seenNames.has(clean.toLowerCase())) return;
    seenNames.add(clean.toLowerCase());
    cards.push({
      name: clean,
      lookupName: rawStr || clean,
      role: t("Режиссёр", "Director"),
      isDirector: true,
      inScene: false,
      orderIdx: 100 + idx,
      photoUrl: "",
      personObj: { name: clean, role: "director" },
    });
  });
  rawActors.forEach((nm, idx) => {
    const rawStr = String(nm || "").trim();
    const clean = isEn() && hasCyrillicText(rawStr) ? transliterateRuToEn(rawStr) : rawStr;
    if (!clean || seenNames.has(clean.toLowerCase())) return;
    seenNames.add(clean.toLowerCase());
    const personObj = { name: clean, orig_name: rawStr, role: "actor" };
    cards.push({
      name: clean,
      lookupName: rawStr || clean,
      role: t("Актёр", "Actor"),
      isDirector: false,
      inScene: isCastEntryInScene(personObj, sceneCtx),
      orderIdx: 200 + idx,
      photoUrl: "",
      personObj,
    });
  });

  cards.sort((a, b) => {
    if (a.inScene !== b.inScene) return a.inScene ? -1 : 1;
    return a.orderIdx - b.orderIdx;
  });

  const visibleCards = cards.slice(0, 16);
  _updateXRayTabLabel("xray-tab-cast", "Актёры", "Cast", visibleCards.length);

  const castSig = `${item.id || item.title || ""}|${state.appLang || "ru"}|${sceneCtx?.memoKey || ""}|${visibleCards.map((c) => `${c.name}:${c.role}:${c.inScene ? 1 : 0}:${c.photoUrl}`).join(",")}`;
  if (castEl.dataset.renderSig === castSig && castEl.childElementCount > 0) {
    return;
  }
  castEl.dataset.renderSig = castSig;

  if (visibleCards.length === 0) {
    castEl.innerHTML = `<div class="atv-xray-empty">${escapeHtml(
      t("Информация об актёрах загружается...", "Cast details loading...")
    )}</div>`;
    return;
  }

  castEl.innerHTML = "";
  const castFrag = document.createDocumentFragment();
  visibleCards.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `atv-xray-actor-card${c.isDirector ? " is-director" : ""}${c.inScene ? " is-in-scene" : ""}`;
    const proxyPhotoSrc = `/api/person-photo?name=${encodeURIComponent(c.lookupName || c.name)}${
      c.photoUrl ? `&url=${encodeURIComponent(c.photoUrl)}` : ""
    }&strict=1&v=3`;
    const sceneBadgeHtml = c.inScene
      ? `<span class="atv-xray-scene-pill">${escapeHtml(t("В этой сцене", "In Scene"))}</span>`
      : "";
    btn.innerHTML = `
      <img class="atv-xray-actor-avatar" src="${escapeAttr(proxyPhotoSrc)}" alt="${escapeAttr(
      c.name
    )}" width="48" height="48" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
      <div class="atv-xray-actor-info">
        <div class="atv-xray-actor-name-row">
          <span class="atv-xray-actor-name">${escapeHtml(c.name)}</span>
          ${sceneBadgeHtml}
        </div>
        <span class="atv-xray-actor-role">${escapeHtml(c.role)}</span>
      </div>
    `;
    const avatarImg = btn.querySelector(".atv-xray-actor-avatar");
    if (avatarImg) {
      avatarImg.onerror = () => {
        avatarImg.onerror = null;
        const mono = document.createElement("span");
        mono.className = "atv-xray-actor-monogram";
        mono.setAttribute("aria-hidden", "true");
        mono.textContent = _buildXRayMonogramInitials(c.name);
        avatarImg.replaceWith(mono);
      };
    }
    btn.onclick = (e) => {
      e.stopPropagation();
      hideXRayPauseShelf();
      openPersonModal(c.personObj || { name: c.name });
    };
    castFrag.appendChild(btn);
  });
  castEl.appendChild(castFrag);
  requestAnimationFrame(_syncXRayScrollButtons);
}

let _xraySoundtrackViewMode = "title"; // "title" | "saved"

function _renderXRaySoundtrackAndTrivia(item, xrayPayload, sceneCtx = resolveActiveXRaySceneContext()) {
  const ostEl = document.getElementById("xray-soundtrack-list");
  const trivEl = document.getElementById("xray-trivia-list");
  const rawTracks = Array.isArray(xrayPayload?.soundtrack)
    ? xrayPayload.soundtrack
    : Array.isArray(item?.soundtrack)
    ? item.soundtrack
    : [];
  const savedTracks = Array.isArray(xrayPayload?.saved_tracks)
    ? xrayPayload.saved_tracks
    : Array.isArray(item?._xrayData?.saved_tracks)
    ? item._xrayData.saved_tracks
    : [];
  const savedTrackIds = new Set(
    savedTracks.map((st) => String(st.track_id || `${st.artist || ""}--${st.title || ""}`).toLowerCase())
  );
  if (_xraySoundtrackViewMode === "saved" && savedTracks.length === 0) {
    _xraySoundtrackViewMode = "title";
  }
  const sourceTracks =
    _xraySoundtrackViewMode === "saved"
      ? savedTracks.map((st) => ({ ...st, is_saved: true }))
      : rawTracks;
  const tracks = sourceTracks
    .map((tr, idx) => {
      const match =
        _xraySoundtrackViewMode === "saved"
          ? {
              score: 0,
              inScene: Boolean(tr.media_title),
              badgeText: tr.media_title ? String(tr.media_title) : "",
            }
          : scoreTrackForScene(tr, sceneCtx);
      return { tr, idx, score: match.score, inScene: match.inScene, badgeText: match.badgeText };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.idx - b.idx;
    });
  const triviaList = Array.isArray(xrayPayload?.trivia)
    ? xrayPayload.trivia
    : Array.isArray(item?.trivia)
    ? item.trivia
    : [];

  _updateXRayTabLabel("xray-tab-soundtrack", "Саундтрек", "Soundtrack", rawTracks.length || tracks.length);
  _updateXRayTabLabel("xray-tab-trivia", "Факты и пасхалки", "Trivia & Facts", triviaList.length);

  if (ostEl) {
    const ostSig = `${item?.id || item?.title || ""}|${state.appLang || "ru"}|${_xraySoundtrackViewMode}|${savedTracks.length}|${sceneCtx?.memoKey || ""}|${tracks.map(({ tr, inScene, badgeText }) => `${tr.title || ""}:${tr.artist || ""}:${tr.is_saved ? 1 : 0}:${inScene ? 1 : 0}:${badgeText || ""}`).join(",")}`;
    if (ostEl.dataset.renderSig === ostSig && ostEl.childElementCount > 0) {
      // Already rendered with identical scene soundtrack state
    } else if (tracks.length === 0 && savedTracks.length === 0) {
      ostEl.dataset.renderSig = ostSig;
      ostEl.innerHTML = `<div class="atv-xray-empty">${escapeHtml(
        t("Поиск саундтрека сцены...", "Searching scene soundtrack...")
      )}</div>`;
    } else {
      ostEl.dataset.renderSig = ostSig;
      ostEl.innerHTML = "";
      const ostFrag = document.createDocumentFragment();
      if (savedTracks.length > 0 || _xraySoundtrackViewMode === "saved") {
        const modeCard = document.createElement("div");
        modeCard.className = "atv-xray-ost-mode-bar";
        modeCard.innerHTML = `
          <button type="button" class="atv-xray-ost-mode-btn${_xraySoundtrackViewMode === "title" ? " is-active" : ""}" data-ost-mode="title">
            ${iconSvg("music", 12)}
            <span>${escapeHtml(t("В этом тайтле", "In This Title"))} (${rawTracks.length})</span>
          </button>
          <button type="button" class="atv-xray-ost-mode-btn${_xraySoundtrackViewMode === "saved" ? " is-active" : ""}" data-ost-mode="saved">
            ${iconSvg("heartFilled", 12)}
            <span>${escapeHtml(t("Избранные треки", "Saved Tracks"))} (${savedTracks.length})</span>
          </button>
        `;
        modeCard.querySelectorAll("[data-ost-mode]").forEach((mBtn) => {
          mBtn.onclick = (e) => {
            e.stopPropagation();
            const nextMode = mBtn.getAttribute("data-ost-mode") || "title";
            if (_xraySoundtrackViewMode !== nextMode) {
              _xraySoundtrackViewMode = nextMode;
              ostEl.dataset.renderSig = "";
              _renderXRaySoundtrackAndTrivia(item, xrayPayload, sceneCtx);
            }
          };
        });
        ostFrag.appendChild(modeCard);
      }
      tracks.forEach(({ tr, inScene, badgeText }) => {
        const card = document.createElement("div");
        card.className = `atv-xray-track-card${inScene ? " is-in-scene" : ""}`;
        const trackTitle = String(tr.title || "");
        const trackArtist = String(tr.artist || "");
        const trackIdKey = String(tr.track_id || `${trackArtist}--${trackTitle}`).toLowerCase();
        const isTrackSaved = Boolean(tr.is_saved || savedTrackIds.has(trackIdKey));
        const rawScene = String(tr.scene || "").trim();
        const isGenericScene = /^(официальный саундтрек|official soundtrack)$/i.test(rawScene);
        const sceneHint = isGenericScene ? "" : rawScene;
        const copyLabel = `${trackArtist} — ${trackTitle}`;
        const extUrl = tr.apple_music_url || tr.spotify_url || tr.youtube_url || "";
        const spotifyUrl = tr.spotify_url && tr.apple_music_url ? tr.spotify_url : "";
        const hasPreview = Boolean(tr.preview_url);
        const artworkUrl = String(tr.artwork_url || "").trim();
        const scenePillHtml =
          inScene && badgeText
            ? `<span class="atv-xray-scene-pill">${escapeHtml(badgeText)}</span>`
            : "";
        const saveTitleText = isTrackSaved
          ? t("Убрать из избранных треков", "Remove from saved tracks")
          : t("Сохранить трек в избранное", "Save track to favorites");
        card.innerHTML = `
          <div class="atv-xray-track-main" title="${escapeAttr(`${trackTitle} — ${trackArtist}`)}">
            <div class="atv-xray-track-icon">${
              artworkUrl
                ? `<img src="${escapeAttr(artworkUrl)}" alt="" class="atv-xray-track-cover" loading="lazy" />`
                : iconSvg("music", 15)
            }</div>
            <div class="atv-xray-track-meta">
              <div class="atv-xray-track-title-row">
                <div class="atv-xray-track-title">${escapeHtml(trackTitle)}</div>
                ${scenePillHtml}
              </div>
              <div class="atv-xray-track-artist">${escapeHtml(trackArtist)}${
          sceneHint ? ` · <span class="atv-xray-track-scene">${escapeHtml(sceneHint)}</span>` : ""
        }</div>
            </div>
          </div>
          <div class="atv-xray-track-actions">
            ${
              hasPreview
                ? `<button type="button" class="atv-xray-action-pill btn-xray-preview" title="${escapeAttr(
                    t("Прослушать отрывок трека", "Listen to track preview")
                  )}">${iconSvg("play", 11)}<span>${escapeHtml(t("Слушать", "Preview"))}</span></button>`
                : ""
            }
            <button type="button" class="atv-xray-action-pill btn-xray-save-track${
              isTrackSaved ? " is-saved" : ""
            }" title="${escapeAttr(saveTitleText)}" aria-label="${escapeAttr(saveTitleText)}" aria-pressed="${
              isTrackSaved ? "true" : "false"
            }">${iconSvg(isTrackSaved ? "heartFilled" : "heart", 12)}<span>${escapeHtml(
              isTrackSaved ? t("В избранном", "Saved") : t("В избранное", "Save")
            )}</span></button>
            <button type="button" class="atv-xray-action-pill btn-xray-copy" title="${escapeAttr(
              t("Скопировать исполнителя и название трека", "Copy artist and track name")
            )}" aria-label="${escapeAttr(
              t("Скопировать исполнителя и название трека", "Copy artist and track name")
            )}">${iconSvg("copy", 12)}<span>${escapeHtml(t("Скопировать", "Copy"))}</span></button>
            ${
              extUrl
                ? `<a class="atv-xray-action-pill btn-xray-open" href="${escapeAttr(
                    extUrl
                  )}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(
                    t("Открыть в музыкальном плеере", "Open in Music Player")
                  )}" aria-label="${escapeAttr(
                    t("Открыть в музыкальном плеере", "Open in Music Player")
                  )}">${iconSvg("external", 12)}<span>${escapeHtml(t("В плеере", "In Player"))}</span></a>`
                : ""
            }
            ${
              spotifyUrl
                ? `<a class="atv-xray-action-pill btn-xray-spotify" href="${escapeAttr(
                    spotifyUrl
                  )}" target="_blank" rel="noopener noreferrer" title="Spotify">${iconSvg(
                    "external",
                    11
                  )}<span>Spotify</span></a>`
                : ""
            }
          </div>
        `;
        const coverImg = card.querySelector(".atv-xray-track-cover");
        if (coverImg) {
          coverImg.onerror = () => {
            const iconWrap = coverImg.parentElement;
            if (iconWrap) iconWrap.innerHTML = iconSvg("music", 15);
          };
        }
        const saveBtn = card.querySelector(".btn-xray-save-track");
        if (saveBtn) {
          saveBtn.onclick = async (e) => {
            e.stopPropagation();
            try {
              const res = await apiJson("/api/xray/saved-tracks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "toggle",
                  media_title: item?.title || "",
                  media_id: item?.id || "",
                  track: {
                    track_id: tr.track_id || "",
                    title: trackTitle,
                    artist: trackArtist,
                    album: tr.album || "",
                    scene: tr.scene || "",
                    preview_url: tr.preview_url || "",
                    artwork_url: tr.artwork_url || "",
                    apple_music_url: tr.apple_music_url || "",
                    spotify_url: tr.spotify_url || "",
                    youtube_url: tr.youtube_url || "",
                  },
                }),
              });
              if (res && res.ok) {
                tr.is_saved = Boolean(res.is_saved);
                if (res.track_id) tr.track_id = res.track_id;
                if (xrayPayload && typeof xrayPayload === "object") {
                  xrayPayload.saved_tracks = Array.isArray(res.items) ? res.items : [];
                  if (Array.isArray(xrayPayload.soundtrack)) {
                    xrayPayload.soundtrack.forEach((oTr) => {
                      if (
                        (oTr.track_id && oTr.track_id === res.track_id) ||
                        (oTr.title === trackTitle && oTr.artist === trackArtist)
                      ) {
                        oTr.is_saved = Boolean(res.is_saved);
                      }
                    });
                  }
                }
                if (item?._xrayData && typeof item._xrayData === "object") {
                  item._xrayData.saved_tracks = Array.isArray(res.items) ? res.items : [];
                }
                showToast(
                  res.is_saved
                    ? t(`Трек сохранён: ${copyLabel}`, `Saved track: ${copyLabel}`)
                    : t(`Убрано из избранного: ${copyLabel}`, `Removed track: ${copyLabel}`)
                );
                ostEl.dataset.renderSig = "";
                _renderXRaySoundtrackAndTrivia(item, xrayPayload, sceneCtx);
              }
            } catch (_) {}
          };
        }
        const copyBtn = card.querySelector(".btn-xray-copy");
        if (copyBtn) {
          copyBtn.onclick = async (e) => {
            e.stopPropagation();
            const ok = await copyTextToClipboard(copyLabel);
            if (ok) {
              showToast(t(`Скопировано: ${copyLabel}`, `Copied: ${copyLabel}`));
            }
          };
        }
        const prevBtn = card.querySelector(".btn-xray-preview");
        if (prevBtn && tr.preview_url) {
          prevBtn.onclick = (e) => {
            e.stopPropagation();
            if (_xrayPreviewBtn === prevBtn && _xrayPreviewAudio) {
              _stopXRayPreviewAudio();
              return;
            }
            _stopXRayPreviewAudio();
            const audio = new Audio(tr.preview_url);
            audio.volume = 0.75;
            _xrayPreviewAudio = audio;
            _xrayPreviewBtn = prevBtn;
            prevBtn.classList.add("is-playing");
            card.classList.add("is-playing");
            prevBtn.innerHTML = `${iconSvg("pause", 11)}<span>${escapeHtml(t("Стоп", "Stop"))}</span>`;
            const spanEl = prevBtn.querySelector("span");
            let lastRemSec = -1;
            audio.ontimeupdate = () => {
              if (_xrayPreviewAudio !== audio || _xrayPreviewBtn !== prevBtn) return;
              const dur = Number(audio.duration) || 30;
              const rem = Math.max(0, Math.ceil(dur - (Number(audio.currentTime) || 0)));
              if (rem === lastRemSec) return;
              lastRemSec = rem;
              if (spanEl) {
                spanEl.textContent = `${t("Стоп", "Stop")} · 0:${String(rem).padStart(2, "0")}`;
              }
            };
            audio.onended = () => _stopXRayPreviewAudio();
            audio.onerror = () => _stopXRayPreviewAudio();
            audio.play().catch(() => _stopXRayPreviewAudio());
          };
        }
        ostFrag.appendChild(card);
      });
      ostEl.appendChild(ostFrag);
    }
  }

  if (trivEl) {
    const trivSig = `${item?.id || item?.title || ""}|${state.appLang || "ru"}|${triviaList.length}:${triviaList[0]?.text || ""}`;
    if (trivEl.dataset.renderSig === trivSig && trivEl.childElementCount > 0) {
      // Already rendered with identical trivia state
    } else if (triviaList.length === 0) {
      trivEl.dataset.renderSig = trivSig;
      trivEl.innerHTML = `<div class="atv-xray-empty">${escapeHtml(
        t("Загрузка интересных фактов и деталей съёмок...", "Loading behind-the-scenes trivia...")
      )}</div>`;
    } else {
      trivEl.dataset.renderSig = trivSig;
      trivEl.innerHTML = "";
      const trivFrag = document.createDocumentFragment();
      triviaList.forEach((fc) => {
        const card = document.createElement("div");
        card.className = "atv-xray-trivia-card";
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.setAttribute("aria-expanded", "false");
        const factText = String(fc.text || "");
        const badgeText = String(fc.badge || t("Факт", "Trivia"));
        card.title = t("Нажмите, чтобы развернуть полностью", "Click to expand full fact");
        card.innerHTML = `
          <div class="atv-xray-trivia-head">
            <span class="atv-xray-trivia-badge">${escapeHtml(badgeText)}</span>
            <button type="button" class="atv-xray-trivia-copy" title="${escapeAttr(
              t("Скопировать факт", "Copy fact")
            )}" aria-label="${escapeAttr(t("Скопировать факт", "Copy fact"))}">${iconSvg("copy", 11)}</button>
          </div>
          <p class="atv-xray-trivia-text">${escapeHtml(factText)}</p>
        `;
        const toggleFactExpanded = () => {
          const isExp = card.classList.toggle("is-expanded");
          card.setAttribute("aria-expanded", isExp ? "true" : "false");
          _syncXRayScrollButtonsRaf();
          setTimeout(_syncXRayScrollButtonsRaf, 200);
        };
        card.onclick = (e) => {
          e.stopPropagation();
          toggleFactExpanded();
        };
        card.onkeydown = (e) => {
          if (e.target !== card) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            toggleFactExpanded();
          }
        };
        const copyFactBtn = card.querySelector(".atv-xray-trivia-copy");
        if (copyFactBtn) {
          copyFactBtn.onclick = async (e) => {
            e.stopPropagation();
            const ok = await copyTextToClipboard(factText);
            if (ok) {
              showToast(t("Факт скопирован в буфер обмена", "Trivia fact copied to clipboard"));
            }
          };
        }
        trivFrag.appendChild(card);
      });
      trivEl.appendChild(trivFrag);
    }
  }
  requestAnimationFrame(_syncXRayScrollButtons);
}

function _updateXRayCompactPill(item, xrayPayload, sceneCtx = resolveActiveXRaySceneContext()) {
  const pill = document.getElementById("xray-compact-pill");
  const avatarsEl = document.getElementById("xray-compact-avatars");
  const summaryEl = document.getElementById("xray-compact-summary");
  if (!pill || !summaryEl) return;

  const castPeople = (isEn() && item?.cast_people_en?.length ? item.cast_people_en : item?.cast_people) || [];
  const rawActors = (isEn() && item?.actors_en?.length ? item.actors_en : item?.actors) || [];
  const orderedActors = castPeople
    .filter((p) => p && String(p.name || "").trim() && p.role !== "director" && !p.is_director)
    .map((p, idx) => ({ p, idx, inScene: isCastEntryInScene(p, sceneCtx) }))
    .sort((a, b) => (a.inScene !== b.inScene ? (a.inScene ? -1 : 1) : a.idx - b.idx));

  const names = [];
  const avatarUrls = [];
  orderedActors.forEach(({ p }) => {
    const nm = String(p?.name || "").trim();
    if (!nm) return;
    if (names.length < 2) names.push(nm);
    if (avatarUrls.length < 3) {
      const photoUrl = String(p?.photo || "").trim();
      avatarUrls.push(
        `/api/person-photo?name=${encodeURIComponent(nm)}${
          photoUrl ? `&url=${encodeURIComponent(photoUrl)}` : ""
        }&strict=1&v=3`
      );
    }
  });
  if (names.length === 0) {
    rawActors.slice(0, 2).forEach((nm) => {
      const clean = String(nm || "").trim();
      if (clean) names.push(clean);
    });
  }
  const rawTracks = Array.isArray(xrayPayload?.soundtrack)
    ? xrayPayload.soundtrack
    : Array.isArray(item?.soundtrack)
    ? item.soundtrack
    : [];
  const orderedTracks = rawTracks
    .map((tr, idx) => ({ tr, idx, score: scoreTrackForScene(tr, sceneCtx).score }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.idx - b.idx));
  const parts = [];
  if (names.length > 0) {
    parts.push(names.join(", "));
  } else {
    parts.push(t("В кадре", "In Scene"));
  }
  if (orderedTracks.length > 0 && orderedTracks[0]?.tr?.title) {
    parts.push(String(orderedTracks[0].tr.title));
  }
  const summaryTxt = parts.join(" · ");
  const pillSig = `${item?.id || item?.title || ""}|${state.appLang || "ru"}|${avatarUrls.slice(0, 3).join(",")}|${summaryTxt}`;
  if (pill.dataset.renderSig === pillSig) {
    return;
  }
  pill.dataset.renderSig = pillSig;
  if (avatarsEl) {
    avatarsEl.innerHTML = "";
    const avFrag = document.createDocumentFragment();
    avatarUrls.slice(0, 3).forEach((src) => {
      const img = document.createElement("img");
      img.className = "atv-xray-compact-avatar";
      img.src = src;
      img.alt = "";
      img.width = 20;
      img.height = 20;
      img.loading = "lazy";
      img.decoding = "async";
      img.onerror = () => img.remove();
      avFrag.appendChild(img);
    });
    avatarsEl.appendChild(avFrag);
  }
  summaryEl.textContent = summaryTxt;
}

export function showXRayPauseShelf({ force = false } = {}) {
  const shelf = document.getElementById("xray-pause-shelf");
  if (!shelf) return;
  if (!force && state.showXrayOnPause === false) {
    hideXRayPauseShelf();
    return;
  }
  const nextEpToastOpen = !document.getElementById("player-next-ep-toast")?.classList.contains("hidden");
  const autoplayCardOpen = !document.getElementById("autoplay-next-card")?.classList.contains("hidden");
  const postwatchOpen = !document.getElementById("kinorium-postwatch-overlay")?.classList.contains("hidden");
  const bookmarkDialogOpen = !document.getElementById("atv-bookmark-dialog")?.classList.contains("hidden");
  const subDictOpen = !document.getElementById("atv-sub-dict-popover")?.classList.contains("hidden");
  if (
    !state.isPlayerOpen ||
    !state.activeItem ||
    state.isMiniPlayer ||
    state.isPipBackground ||
    state.officialEmbedActive ||
    state.activeSourceTab === "trailer" ||
    nextEpToastOpen ||
    autoplayCardOpen ||
    postwatchOpen ||
    bookmarkDialogOpen ||
    subDictOpen ||
    (!force && _xrayDismissedSessionId === (state.playerSessionId || 0))
  ) {
    hideXRayPauseShelf();
    return;
  }
  _stopXRayPreviewAudio();
  _ensureXRayHeaderBindings();
  _updateXRaySceneMeta();
  const item = state.activeItem;
  const langKey = isEn() ? "en" : "ru";
  const cachedXRay = item._xrayData && item._xrayDataLang === langKey ? item._xrayData : null;
  const sceneCtx = resolveActiveXRaySceneContext();
  _updateXRayCompactPill(item, cachedXRay, sceneCtx);
  const compactPill = document.getElementById("xray-compact-pill");
  if (!force) {
    shelf.classList.add("is-compact");
    compactPill?.classList.remove("hidden");
    _syncXRayControlBtnState(false);
  } else {
    _renderXRayCastSection(item, sceneCtx);
    _renderXRaySoundtrackAndTrivia(item, cachedXRay, sceneCtx);
    switchXRayTab(_activeXRayTab || "cast");
    shelf.classList.remove("is-compact");
    compactPill?.classList.add("hidden");
    _syncXRayControlBtnState(true);
    requestAnimationFrame(_syncXRayScrollButtons);
  }
  shelf.classList.remove("hidden");
  scheduleDesktopRemoteStatePush(80);

  if (!cachedXRay && item._xrayFetching !== langKey) {
    item._xrayFetching = langKey;
    const reqSess = state.playerSessionId;
    if (state.xrayAbortController) {
      try {
        state.xrayAbortController.abort();
      } catch (_) {}
    }
    const xrayAbort = new AbortController();
    state.xrayAbortController = xrayAbort;
    const q = new URLSearchParams({
      id: String(item.id || ""),
      kinorium_id: String(item.kinorium_id || item.kinorium?.kinorium_id || ""),
      title: String(item.title || ""),
      orig_title: String(item.orig_title || ""),
      year: String(item.year || ""),
      media_type: String(item.media_type || "movie"),
      lang: langKey,
    });
    fetch(`/api/xray?${q.toString()}`, { signal: xrayAbort.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        item._xrayFetching = false;
        if (state.xrayAbortController === xrayAbort) {
          state.xrayAbortController = null;
        }
        if (xrayAbort.signal.aborted || !data || !state.isPlayerOpen || state.playerSessionId !== reqSess || state.activeItem !== item) {
          return;
        }
        item._xrayData = data;
        item._xrayDataLang = langKey;
        if (Array.isArray(data.soundtrack) && data.soundtrack.length > 0) {
          item.soundtrack = data.soundtrack;
        }
        if (Array.isArray(data.trivia) && data.trivia.length > 0) {
          if (!isEn()) item.trivia = data.trivia;
        } else if (!isEn() && Array.isArray(item.trivia) && item.trivia.length > 0) {
          data.trivia = item.trivia;
        }
        let castUpdated = false;
        if (Array.isArray(data.cast_people) && (!item.cast_people || item.cast_people.length === 0)) {
          item.cast_people = data.cast_people;
          castUpdated = true;
        }
        if (Array.isArray(data.cast_people_en) && (!item.cast_people_en || item.cast_people_en.length === 0)) {
          item.cast_people_en = data.cast_people_en;
          castUpdated = true;
        }
        if (Array.isArray(data.directors) && (!item.directors || item.directors.length === 0)) {
          item.directors = data.directors;
          castUpdated = true;
        }
        if (Array.isArray(data.actors) && (!item.actors || item.actors.length === 0)) {
          item.actors = data.actors;
          castUpdated = true;
        }
        const freshSceneCtx = resolveActiveXRaySceneContext();
        if (!shelf.classList.contains("is-compact")) {
          if (castUpdated) {
            _renderXRayCastSection(item, freshSceneCtx);
          }
          _renderXRaySoundtrackAndTrivia(item, data, freshSceneCtx);
        }
        _updateXRayCompactPill(item, data, freshSceneCtx);
        scheduleDesktopRemoteStatePush();
      })
      .catch(() => {
        item._xrayFetching = false;
      });
  }
}

let _momentsCacheList = null;
let _momentsCacheKey = "";
if (typeof window !== "undefined") {
  window.addEventListener("storage", (ev) => {
    if (!ev || !ev.key || ev.key.includes(BOOKMARKS_STORAGE_KEY)) {
      _momentsCacheList = null;
      _momentsCacheKey = "";
    }
  });
}

export function getSavedMoments() {
  try {
    const key = profileStorageKey(BOOKMARKS_STORAGE_KEY);
    if (_momentsCacheList && _momentsCacheKey === key) {
      return _momentsCacheList.slice();
    }
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) || [] : [];
    const list = Array.isArray(parsed) ? parsed : [];
    _momentsCacheKey = key;
    _momentsCacheList = list;
    return list.slice();
  } catch (_) {
    return [];
  }
}

export function saveMoments(moments) {
  try {
    const safeList = Array.isArray(moments) ? moments : [];
    const key = profileStorageKey(BOOKMARKS_STORAGE_KEY);
    _momentsCacheKey = key;
    _momentsCacheList = safeList.slice();
    localStorage.setItem(key, JSON.stringify(safeList));
  } catch (err) { window.logDebug?.("PlayerBookmarks", err); }
}

export function toggleBookmarkCurrentMoment() {
  const video = document.getElementById("native-video");
  if (!video || !state.activeItem || !state.isPlayerOpen) return;
  const { cur, dur } = getEffectivePlaybackTiming(video);
  if (!dur || dur <= 0) return;

  const curSec = Math.round(cur);
  const moments = getSavedMoments();

  const existingIdx = moments.findIndex(
    (m) => _matchesActiveTitleAndEpisode(m) && Math.abs((m.time || 0) - curSec) <= 2
  );

  if (existingIdx >= 0) {
    moments.splice(existingIdx, 1);
    saveMoments(moments);
    renderTimelineBookmarks();
    showToast(t(`Закладка на ${formatTime(curSec)} удалена`, `Bookmark at ${formatTime(curSec)} removed`));
  } else {
    const newMoment = _buildMomentFromActiveState(curSec, "");
    moments.push(newMoment);
    saveMoments(moments);
    renderTimelineBookmarks();
    showToast(t(`Закладка сохранена на ${formatTime(curSec)}`, `Bookmark saved at ${formatTime(curSec)}`));
  }
}

export function openBookmarkNoteDialog(moment = null, targetSec = null) {
  const video = document.getElementById("native-video");
  if (!video || !state.activeItem || !state.isPlayerOpen) return;
  const dialog = document.getElementById("atv-bookmark-dialog");
  if (!dialog) return;

  hideXRayPauseShelf();
  _bookmarkDialogWasPlaying = !video.paused;
  if (_bookmarkDialogWasPlaying) {
    try {
      video.pause();
    } catch (err) { window.logDebug?.("PlayerBookmarks", err); }
  }

  const { cur, dur } = getEffectivePlaybackTiming(video);
  const effSec = targetSec !== null ? Math.round(targetSec) : moment ? moment.time : Math.round(cur || 0);
  _activeEditingMoment = moment;
  _activeEditingTimeSec = effSec;

  const timeBadge = document.getElementById("bookmark-dialog-time");
  if (timeBadge) {
    timeBadge.textContent = formatTime(effSec);
  }

  const input = document.getElementById("bookmark-note-input");
  if (input) {
    input.value = moment?.note || "";
  }

  const btnDelete = document.getElementById("btn-delete-bookmark");
  if (btnDelete) {
    btnDelete.classList.toggle("hidden", !moment);
  }

  dialog.classList.remove("hidden");
  dialog.setAttribute("aria-hidden", "false");
  setTimeout(() => {
    input?.focus();
    input?.select();
  }, 50);
}

export function closeBookmarkNoteDialog(resume = true) {
  const dialog = document.getElementById("atv-bookmark-dialog");
  if (dialog) {
    dialog.classList.add("hidden");
    dialog.setAttribute("aria-hidden", "true");
  }
  const video = document.getElementById("native-video");
  if (
    resume &&
    _bookmarkDialogWasPlaying &&
    video &&
    video.paused &&
    state.isPlayerOpen &&
    state.activeSourceTab !== "trailer" &&
    !state.officialEmbedActive
  ) {
    try {
      video.play();
    } catch (err) { window.logDebug?.("PlayerBookmarks", err); }
  }
  _bookmarkDialogWasPlaying = false;
  _activeEditingMoment = null;
  _activeEditingTimeSec = null;
}

export function saveCurrentBookmarkNote() {
  const input = document.getElementById("bookmark-note-input");
  const noteText = String(input?.value || "").trim();
  const video = document.getElementById("native-video");
  if (!video || !state.activeItem || _activeEditingTimeSec === null) {
    closeBookmarkNoteDialog();
    return;
  }

  const curSec = _activeEditingTimeSec;
  const moments = getSavedMoments();

  let targetMoment = _activeEditingMoment
    ? moments.find((m) => m.id === _activeEditingMoment.id)
    : null;
  if (!targetMoment) {
    targetMoment = moments.find(
      (m) => _matchesActiveTitleAndEpisode(m) && Math.abs((m.time || 0) - curSec) <= 2
    );
  }

  if (targetMoment) {
    _hydrateMomentFromActiveState(targetMoment);
    targetMoment.note = noteText;
    targetMoment.updatedAt = Date.now();
  } else {
    targetMoment = _buildMomentFromActiveState(curSec, noteText);
    moments.push(targetMoment);
  }

  saveMoments(moments);
  renderTimelineBookmarks();
  closeBookmarkNoteDialog(true);
  showToast(
    noteText
      ? t(`Заметка сохранена на ${formatTime(curSec)}`, `Note saved at ${formatTime(curSec)}`)
      : t(`Закладка сохранена на ${formatTime(curSec)}`, `Bookmark saved at ${formatTime(curSec)}`)
  );
}

export function deleteCurrentBookmark() {
  if (!_activeEditingMoment && _activeEditingTimeSec === null) {
    closeBookmarkNoteDialog();
    return;
  }
  const moments = getSavedMoments();
  const curSec = _activeEditingTimeSec;

  const idx = moments.findIndex((m) => {
    if (_activeEditingMoment && m.id === _activeEditingMoment.id) return true;
    return _matchesActiveTitleAndEpisode(m) && Math.abs((m.time || 0) - curSec) <= 2;
  });

  if (idx >= 0) {
    moments.splice(idx, 1);
    saveMoments(moments);
    renderTimelineBookmarks();
    showToast(t("Закладка удалена", "Bookmark deleted"));
  }
  closeBookmarkNoteDialog(true);
}

export function addOrUpdateRemoteBookmark(noteText = "", targetTimeSec = null) {
  const video = document.getElementById("native-video");
  if (!video || !state.activeItem || !state.isPlayerOpen) return null;
  const { cur, dur } = getEffectivePlaybackTiming(video);
  if (!dur || dur <= 0) return null;

  const hasExplicitTime = targetTimeSec !== null && targetTimeSec !== undefined && Number.isFinite(Number(targetTimeSec));
  const curSec = Math.max(0, Math.min(Math.round(dur), hasExplicitTime ? Math.round(Number(targetTimeSec)) : Math.round(cur || 0)));
  const cleanNote = String(noteText || "").trim();
  const moments = getSavedMoments();

  let targetMoment = moments.find(
    (m) => _matchesActiveTitleAndEpisode(m) && Math.abs((m.time || 0) - curSec) <= 2
  );

  if (targetMoment) {
    _hydrateMomentFromActiveState(targetMoment);
    targetMoment.note = cleanNote;
    targetMoment.updatedAt = Date.now();
  } else {
    targetMoment = _buildMomentFromActiveState(curSec, cleanNote);
    moments.push(targetMoment);
  }

  saveMoments(moments);
  renderTimelineBookmarks();
  showToast(
    cleanNote
      ? t(`Заметка сохранена на ${formatTime(curSec)}`, `Note saved at ${formatTime(curSec)}`)
      : t(`Закладка сохранена на ${formatTime(curSec)}`, `Bookmark saved at ${formatTime(curSec)}`)
  );
  return targetMoment;
}

export function deleteRemoteBookmarkByIdOrTime(bookmarkId = "", targetTimeSec = null) {
  const moments = getSavedMoments();
  const cleanId = String(bookmarkId || "").trim();
  const hasTime = targetTimeSec !== null && targetTimeSec !== undefined && Number.isFinite(Number(targetTimeSec));
  const curSec = hasTime ? Math.round(Number(targetTimeSec)) : -1;

  const idx = moments.findIndex((m) => {
    if (cleanId && m.id === cleanId) return true;
    if (hasTime && state.activeItem) {
      return _matchesActiveTitleAndEpisode(m) && Math.abs((m.time || 0) - curSec) <= 2;
    }
    return false;
  });

  if (idx < 0) return false;
  moments.splice(idx, 1);
  saveMoments(moments);
  renderTimelineBookmarks();
  showToast(t("Закладка удалена", "Bookmark deleted"));
  return true;
}

export function renderTimelineBookmarks() {
  const container = document.getElementById("vc-bookmarks");
  if (!container) return;
  const video = document.getElementById("native-video");
  if (!video || !state.activeItem) {
    container.innerHTML = "";
    state.activeItemBookmarks = [];
    return;
  }
  const moments = getSavedMoments().filter((m) => _matchesActiveTitleAndEpisode(m));
  state.activeItemBookmarks = moments;
  const { dur } = getEffectivePlaybackTiming(video);
  if (!dur || dur <= 0 || moments.length === 0) {
    if (container._lastBookmarkSig !== "empty") {
      container._lastBookmarkSig = "empty";
      container.innerHTML = "";
      scheduleDesktopRemoteStatePush(120);
    }
    return;
  }

  const bmSig = `${state.activeItem?.id || ""}:${state.activeSeason || 1}:${state.activeEpisode || 1}:${Math.round(dur)}:${moments.map((m) => `${m.id}:${Math.round(m.time)}:${m.note || ""}`).join("|")}`;
  if (container._lastBookmarkSig === bmSig && container.children.length === moments.length) {
    return;
  }
  container._lastBookmarkSig = bmSig;

  container.innerHTML = "";
  const bmFrag = document.createDocumentFragment();
  moments.forEach((m) => {
    const pct = Math.max(0, Math.min(100, (m.time / dur) * 100));
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = `atv-vc-bookmark-pin${m.note ? " has-note" : ""}`;
    pin.style.left = `${pct}%`;
    const noteSuffix = m.note ? ` · ${m.note}` : "";
    const pinTitle = `${t("Закладка", "Bookmark")} ${m.label || formatTime(m.time)}${noteSuffix}`;
    pin.title = pinTitle;
    pin.setAttribute("aria-label", pinTitle);
    pin.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
    });
    pin.onclick = (e) => {
      e.stopPropagation();
      seekEffectivePlayback(m.time);
      showToast(t(`Переход к закладке ${m.label || formatTime(m.time)}`, `Jumped to bookmark ${m.label || formatTime(m.time)}`));
    };
    pin.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openBookmarkNoteDialog(m, m.time);
    };
    bmFrag.appendChild(pin);
  });
  container.appendChild(bmFrag);
  scheduleDesktopRemoteStatePush(120);
}

export function toggleBookmarksPopover() {
  const popover = document.getElementById("vc-bookmarks-popover");
  const btn = document.getElementById("vc-btn-bookmark");
  if (!popover || !state.activeItem) return;

  const isHidden = popover.classList.contains("hidden");
  if (!isHidden) {
    popover.classList.add("hidden");
    btn?.classList.remove("active");
    btn?.setAttribute("aria-expanded", "false");
    syncVcPopoverOpenClass();
    return;
  }

  closeFloatingPopovers({ exceptId: "vc-bookmarks-popover" });

  const moments = getSavedMoments().filter((m) => _matchesActiveTitleAndEpisode(m));

  let html = `
    <div class="atv-vc-popover-header">
      <div class="atv-vc-popover-title">${escapeHtml(t("Закладки и заметки", "Bookmarks & Notes"))}</div>
      <button type="button" class="atv-btn-primary atv-btn-xs" id="btn-pop-add-bookmark">+ ${escapeHtml(t("Добавить", "Add"))}</button>
    </div>
  `;

  if (!moments.length) {
    const emptyText =
      state.activeItem?.media_type === "series"
        ? t("Нет закладок для этой серии", "No bookmarks for this episode")
        : t("Нет закладок для этого фильма", "No bookmarks for this movie");
    html += `
      <div class="atv-vc-bookmarks-empty">
        <p>${escapeHtml(emptyText)}</p>
        <span class="atv-vc-hint">${escapeHtml(t("Нажмите M или кнопку выше, чтобы сохранить момент с заметкой", "Press M or the button above to bookmark this moment with a note"))}</span>
      </div>
    `;
  } else {
    html += '<div class="atv-vc-bookmarks-list">';
    moments.forEach((m) => {
      html += `
        <div class="atv-vc-bookmark-row" data-time="${m.time}">
          <button type="button" class="atv-vc-bm-jump" data-time="${m.time}">
            <span class="atv-vc-bm-time">${escapeHtml(m.label || formatTime(m.time))}</span>
            <span class="atv-vc-bm-note">${escapeHtml(m.note || t("(Без заметки)", "(No note)"))}</span>
          </button>
          <div class="atv-vc-bm-actions">
            <button type="button" class="atv-vc-bm-edit" data-id="${escapeAttr(m.id)}" title="${escapeAttr(t("Редактировать заметку", "Edit note"))}" aria-label="${escapeAttr(t("Редактировать заметку", "Edit note"))}">
              <svg class="atv-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button type="button" class="atv-vc-bm-del" data-id="${escapeAttr(m.id)}" title="${escapeAttr(t("Удалить", "Delete"))}" aria-label="${escapeAttr(t("Удалить", "Delete"))}">
              <svg class="atv-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      `;
    });
    html += "</div>";
  }

  html += `
    <div class="atv-vc-popover-footer">
      <button type="button" class="atv-btn-secondary atv-btn-xs" id="btn-open-all-bookmarks">
        ${escapeHtml(t("Все закладки в медиатеке", "All bookmarks in library"))}
      </button>
    </div>
  `;

  popover.innerHTML = html;
  popover.classList.remove("hidden");
  btn?.classList.add("active");
  btn?.setAttribute("aria-expanded", "true");
  clampStagePopover(popover);
  syncVcPopoverOpenClass();

  popover.querySelector("#btn-pop-add-bookmark")?.addEventListener("click", () => {
    popover.classList.add("hidden");
    btn?.classList.remove("active");
    btn?.setAttribute("aria-expanded", "false");
    syncVcPopoverOpenClass();
    openBookmarkNoteDialog();
  });

  popover.querySelectorAll(".atv-vc-bm-jump").forEach((jumpBtn) => {
    jumpBtn.addEventListener("click", () => {
      const sec = Number(jumpBtn.getAttribute("data-time") || 0);
      seekEffectivePlayback(sec);
      popover.classList.add("hidden");
      btn?.classList.remove("active");
      btn?.setAttribute("aria-expanded", "false");
      syncVcPopoverOpenClass();
    });
  });

  popover.querySelectorAll(".atv-vc-bm-edit").forEach((editBtn) => {
    editBtn.addEventListener("click", () => {
      const id = editBtn.getAttribute("data-id");
      const m = moments.find((it) => it.id === id);
      if (m) {
        popover.classList.add("hidden");
        btn?.classList.remove("active");
        btn?.setAttribute("aria-expanded", "false");
        syncVcPopoverOpenClass();
        openBookmarkNoteDialog(m, m.time);
      }
    });
  });

  popover.querySelectorAll(".atv-vc-bm-del").forEach((delBtn) => {
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = delBtn.getAttribute("data-id");
      const allMoments = getSavedMoments();
      const idx = allMoments.findIndex((it) => it.id === id);
      if (idx >= 0) {
        allMoments.splice(idx, 1);
        saveMoments(allMoments);
        renderTimelineBookmarks();
        popover.classList.add("hidden");
        toggleBookmarksPopover();
      }
    });
  });

  popover.querySelector("#btn-open-all-bookmarks")?.addEventListener("click", () => {
    popover.classList.add("hidden");
    btn?.classList.remove("active");
    btn?.setAttribute("aria-expanded", "false");
    syncVcPopoverOpenClass();
    openBookmarksModal();
  });
}

export function openBookmarksModal() {
  const modal = document.getElementById("bookmarks-modal");
  if (!modal) return;
  exitBrowserFullscreenIfNeeded();
  _editingModalMomentId = null;
  rememberModalTriggerFocus("bookmarks-modal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  syncScrollTopButton();
  const searchInput = document.getElementById("bookmarks-search-input");
  renderBookmarksModalList(searchInput ? searchInput.value : "");
}

export function closeBookmarksModal() {
  const modal = document.getElementById("bookmarks-modal");
  if (!modal) return;
  _editingModalMomentId = null;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  syncScrollTopButton();
  restoreModalTriggerFocus("bookmarks-modal");
}

export function renderBookmarksModalList(filterQuery = null) {
  const listEl = document.getElementById("bookmarks-modal-list");
  const countEl = document.getElementById("bookmarks-total-count");
  if (!listEl) return;

  const searchInput = document.getElementById("bookmarks-search-input");
  const effectiveQuery =
    filterQuery !== null && filterQuery !== undefined
      ? String(filterQuery)
      : String(searchInput?.value || "");

  const moments = getSavedMoments();
  if (countEl) countEl.textContent = String(moments.length);

  const q = effectiveQuery.trim().toLowerCase();
  const filtered = moments.filter((m) => {
    if (_activeBookmarkModalFilter === "movie" && m.media_type === "series") return false;
    if (_activeBookmarkModalFilter === "series" && m.media_type !== "series") return false;
    if (_activeBookmarkModalFilter === "notes" && !String(m.note || "").trim()) return false;
    if (!q) return true;
    return (
      String(m.title || "").toLowerCase().includes(q) ||
      String(m.orig_title || "").toLowerCase().includes(q) ||
      String(m.note || "").toLowerCase().includes(q)
    );
  });

  if (!filtered.length) {
    const hasFilterOrQuery = Boolean(q || _activeBookmarkModalFilter !== "all");
    listEl.innerHTML = `
      <div class="atv-bookmarks-empty-state">
        <p>${escapeHtml(
          hasFilterOrQuery
            ? t("Ничего не найдено по выбранному фильтру", "No bookmarks match the selected filter")
            : t("У вас пока нет сохранённых закладок", "No saved bookmarks yet")
        )}</p>
        <span class="atv-bookmarks-empty-hint">${escapeHtml(
          t(
            "Во время просмотра нажимайте M для сохранения момента с заметкой",
            "Press M during playback to save a moment with a note"
          )
        )}</span>
      </div>
    `;
    return;
  }

  // Sort by updatedAt desc
  filtered.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

  let html = "";
  filtered.forEach((m) => {
    const isSeries = m.media_type === "series";
    const subMeta = isSeries
      ? `${t("Сезон", "Season")} ${m.season || 1} · ${t("Серия", "Episode")} ${m.episode || 1}`
      : m.year
      ? String(m.year)
      : "";
    const isEditing = _editingModalMomentId === m.id;
    const displayCardTitle = displayTitle(m) || m.title || m.orig_title || "Velarium";
    const displayCardPoster = displayPoster(m) || m.poster || "";

    html += `
      <div class="atv-bookmark-card-item" data-id="${escapeAttr(m.id)}">
        <div class="atv-bm-item-left">
          ${
            displayCardPoster
              ? `<img class="atv-bm-thumb" src="${escapeAttr(displayCardPoster)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
              : '<div class="atv-bm-thumb-ph"></div>'
          }
          <div class="atv-bm-item-info">
            <div class="atv-bm-item-title-row">
              <strong class="atv-bm-title">${escapeHtml(displayCardTitle)}</strong>
              <span class="atv-bm-time-tag">${escapeHtml(m.label || formatTime(m.time))}</span>
            </div>
            ${subMeta ? `<span class="atv-bm-subline">${escapeHtml(subMeta)}</span>` : ""}
            ${
              isEditing
                ? `
                  <div class="atv-bm-inline-edit-row">
                    <input type="text" class="atv-input atv-bm-inline-input" data-edit-input="${escapeAttr(m.id)}" value="${escapeAttr(m.note || "")}" maxlength="300" placeholder="${escapeAttr(t("Текст заметки к моменту...", "Note for this moment..."))}" aria-label="${escapeAttr(t("Текст заметки к моменту", "Note for this moment"))}" autocomplete="off" />
                    <button type="button" class="atv-btn-primary atv-btn-xs atv-bm-btn-save-edit" data-id="${escapeAttr(m.id)}">${escapeHtml(t("Сохранить", "Save"))}</button>
                    <button type="button" class="atv-btn-secondary atv-btn-xs atv-bm-btn-cancel-edit" data-id="${escapeAttr(m.id)}">${escapeHtml(t("Отмена", "Cancel"))}</button>
                  </div>
                `
                : m.note
                ? `<p class="atv-bm-note-text">${escapeHtml(m.note)}</p>`
                : `<p class="atv-bm-note-empty">${escapeHtml(t("(Без заметки)", "(No note)"))}</p>`
            }
          </div>
        </div>
        <div class="atv-bm-item-actions">
          <button type="button" class="atv-btn-primary atv-btn-xs atv-bm-btn-play" data-id="${escapeAttr(m.id)}">
            <svg class="atv-ico" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <span>${escapeHtml(t("Смотреть", "Play"))}</span>
          </button>
          <button type="button" class="atv-btn-secondary atv-btn-xs atv-bm-btn-edit" data-id="${escapeAttr(m.id)}" title="${escapeAttr(t("Изменить заметку", "Edit note"))}" aria-label="${escapeAttr(t("Изменить заметку", "Edit note"))}">
            <svg class="atv-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button type="button" class="atv-btn-secondary atv-btn-xs atv-bm-btn-del" data-id="${escapeAttr(m.id)}" title="${escapeAttr(t("Удалить закладку", "Delete bookmark"))}" aria-label="${escapeAttr(t("Удалить закладку", "Delete bookmark"))}">
            <svg class="atv-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
    `;
  });

  listEl.innerHTML = html;

  listEl.querySelectorAll(".atv-bookmark-card-item").forEach((cardEl, idx) => {
    const id = cardEl.getAttribute("data-id");
    const m = filtered[idx] || filtered.find((it) => it.id === id);
    const imgEl = cardEl.querySelector(".atv-bm-thumb");
    if (imgEl && m) {
      attachSmartPosterFallback(imgEl, m.title || m.orig_title || "Velarium", m.year || "", m.poster || "");
    }
  });

  if (_editingModalMomentId) {
    const editInp = listEl.querySelector(`[data-edit-input="${CSS.escape(_editingModalMomentId)}"]`);
    if (editInp) {
      setTimeout(() => {
        try {
          editInp.focus();
          editInp.select();
        } catch (_) {}
      }, 20);
    }
  }

  const commitInlineEdit = (id) => {
    const inp = listEl.querySelector(`[data-edit-input="${CSS.escape(id)}"]`);
    if (!inp) return;
    const newNote = String(inp.value || "").trim();
    const allMoments = getSavedMoments();
    const target = allMoments.find((it) => it.id === id);
    if (target) {
      target.note = newNote;
      target.updatedAt = Date.now();
      saveMoments(allMoments);
      renderTimelineBookmarks();
      showToast(t("Заметка обновлена", "Note updated"));
    }
    _editingModalMomentId = null;
    renderBookmarksModalList(effectiveQuery);
  };

  listEl.querySelectorAll(".atv-bm-btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      _editingModalMomentId = _editingModalMomentId === id ? null : id;
      renderBookmarksModalList(effectiveQuery);
    });
  });

  listEl.querySelectorAll(".atv-bm-btn-save-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      if (id) commitInlineEdit(id);
    });
  });

  listEl.querySelectorAll(".atv-bm-btn-cancel-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      _editingModalMomentId = null;
      renderBookmarksModalList(effectiveQuery);
    });
  });

  listEl.querySelectorAll(".atv-bm-inline-input").forEach((inp) => {
    inp.addEventListener("keydown", (e) => {
      const id = inp.getAttribute("data-edit-input");
      if (e.key === "Enter") {
        e.preventDefault();
        if (id) commitInlineEdit(id);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        _editingModalMomentId = null;
        renderBookmarksModalList(effectiveQuery);
      }
    });
  });

  listEl.querySelectorAll(".atv-bm-btn-play").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const m = filtered.find((it) => it.id === id);
      if (!m) return;
      closeBookmarksModal();
      if (state.isPlayerOpen && _matchesActiveTitleAndEpisode(m)) {
        seekEffectivePlayback(m.time || 0);
        showToast(
          t(
            `Переход к закладке ${m.label || formatTime(m.time || 0)}`,
            `Jumped to bookmark ${m.label || formatTime(m.time || 0)}`
          )
        );
        return;
      }
      const targetItem = {
        id: m.itemId || m.kinorium_id || m.rezka_id || m.title,
        kinorium_id: m.kinorium_id || "",
        imdb_id: m.imdb_id || "",
        rezka_id: m.rezka_id || "",
        rezka_url: m.rezka_url || "",
        title: m.title,
        orig_title: m.orig_title,
        year: m.year,
        media_type: m.media_type || "movie",
        poster: m.poster,
      };
      const sourceTab = m.source || "hdrezka";
      const { openPlayerModal } = await import("./player.js?v=20261110v1");
      openPlayerModal(targetItem, sourceTab, m.season || 1, m.episode || 1, m.time || 0);
    });
  });

  listEl.querySelectorAll(".atv-bm-btn-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const allMoments = getSavedMoments();
      const idx = allMoments.findIndex((it) => it.id === id);
      if (idx >= 0) {
        allMoments.splice(idx, 1);
        saveMoments(allMoments);
        renderTimelineBookmarks();
        renderBookmarksModalList(effectiveQuery);
      }
    });
  });
}

export function exportBookmarksMarkdown() {
  const moments = getSavedMoments();
  if (!moments.length) {
    showToast(t("Нет закладок для экспорта", "No bookmarks to export"));
    return;
  }

  // Group by localized title
  const grouped = {};
  moments.forEach((m) => {
    const key = displayTitle(m) || m.title || m.orig_title || t("Без названия", "Untitled");
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  });

  const nowStr = new Date().toISOString().slice(0, 10);
  let md = isEn()
    ? `# Velarium Bookmarks & Notes\n*Exported: ${nowStr}*\n\n`
    : `# Заметки и закладки Velarium\n*Экспортировано: ${nowStr}*\n\n`;

  for (const [title, list] of Object.entries(grouped)) {
    md += `## ${title}\n`;
    list.sort((a, b) => (a.time || 0) - (b.time || 0));
    list.forEach((m) => {
      const timeStr = m.label || formatTime(m.time);
      const isSeries = m.media_type === "series";
      const epPrefix = isSeries ? `(S${m.season || 1}·E${m.episode || 1}) ` : "";
      const noteStr = m.note ? ` — ${m.note}` : "";
      md += `- **${timeStr}** ${epPrefix}${noteStr}\n`;
    });
    md += "\n";
  }

  try {
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Velarium_Bookmarks_${nowStr}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(t("Файл закладок Markdown сохранён", "Markdown bookmarks file saved"));
  } catch (_) {
    showToast(t("Не удалось экспортировать закладки", "Could not export bookmarks"));
  }
}

export function initBookmarksListeners() {
  document.getElementById("btn-close-bookmark-dialog")?.addEventListener("click", () => {
    closeBookmarkNoteDialog(true);
  });
  document.getElementById("btn-cancel-bookmark")?.addEventListener("click", () => {
    closeBookmarkNoteDialog(true);
  });
  document.getElementById("btn-save-bookmark")?.addEventListener("click", () => {
    saveCurrentBookmarkNote();
  });
  document.getElementById("btn-delete-bookmark")?.addEventListener("click", () => {
    deleteCurrentBookmark();
  });

  const noteInput = document.getElementById("bookmark-note-input");
  noteInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveCurrentBookmarkNote();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeBookmarkNoteDialog(true);
    }
  });

  document.getElementById("vc-btn-bookmark")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleBookmarksPopover();
  });

  document.getElementById("close-bookmarks-modal")?.addEventListener("click", () => {
    closeBookmarksModal();
  });
  document.getElementById("bookmarks-modal")?.addEventListener("click", (e) => {
    if (e.target && e.target.id === "bookmarks-modal") {
      closeBookmarksModal();
    }
  });
  document.getElementById("btn-export-bookmarks-md")?.addEventListener("click", () => {
    exportBookmarksMarkdown();
  });
  document.getElementById("bookmarks-search-input")?.addEventListener("input", (e) => {
    renderBookmarksModalList(e.target.value);
  });
  document.getElementById("bookmarks-filter-pills")?.addEventListener("click", (e) => {
    const pill = e.target?.closest?.("[data-bm-filter]");
    if (!pill) return;
    const filterVal = pill.getAttribute("data-bm-filter") || "all";
    _activeBookmarkModalFilter = filterVal;
    document.querySelectorAll("#bookmarks-filter-pills [data-bm-filter]").forEach((btn) => {
      const isAct = btn.getAttribute("data-bm-filter") === filterVal;
      btn.classList.toggle("active", isAct);
      btn.setAttribute("aria-pressed", isAct ? "true" : "false");
    });
    renderBookmarksModalList();
  });
}
