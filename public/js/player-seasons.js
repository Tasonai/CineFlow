import { state } from "./state.js?v=20261111v3";
import { t, isEn, displayTitle, hasCyrillicText } from "./i18n.js?v=20261111v3";
import {
  escapeHtml,
  iconSvg,
  showToast,
  formatTime,
  pluralRu,
  genitiveAfterIz,
  expandRussianDateText,
  findAllOfflineDownloadsForTitle,
  findOfflineDownloadForTitle,
  getEpisodeProgress,
  saveEpisodeProgress,
  syncCustomSelect,
} from "./utils.js?v=20261111v3";
import {
  isEpisodeWatched,
  isServiceEnabled,
  patchCatalogItemKinoriumInPlace,
  updateKinoriumSectionCounters,
} from "./catalog.js?v=20261111v3";
import { refreshOpenPersonModalUI } from "./modals.js?v=20261111v3";
import { pushDesktopRemoteStateNow } from "./remote.js?v=20261111v3";
import { sweepPendingDownloadCleanups } from "./features.js?v=20261111v3";
import { syncCustomVideoControlsUI } from "./player-ui-controls.js?v=20261111v3";
import { closeSubtitleDictPopover, syncSubtitleOffsetUI } from "./subtitles.js?v=20261111v3";
import {
  getNextEpisodeCoords,
  clearAutoplayNextTimer,
  dismissPlayerNextEpisodeToast,
} from "./player-autoplay.js?v=20261111v3";

const _RU_MONTH_MAP = {
  января: "Jan",
  февраля: "Feb",
  марта: "Mar",
  апреля: "Apr",
  мая: "May",
  июня: "Jun",
  июля: "Jul",
  августа: "Aug",
  сентября: "Sep",
  октября: "Oct",
  ноября: "Nov",
  декабря: "Dec",
};
const _RU_MONTH_RE = new RegExp(Object.keys(_RU_MONTH_MAP).join("|"), "gi");
import { updateMiniPlayerTitle } from "./player-pip-dock.js?v=20261111v3";
import { getEffectivePlaybackTiming } from "./player-remux.js?v=20261111v3";
import { reportScrobbleProgress } from "./player-scrobble.js?v=20261111v3";
import {
  loadBackup4KReleases,
  loadHDRezkaStream,
  loadOfficialServiceTab,
  loadOfflineStreamForActiveTitle,
  loadStremioStreams,
  resetVideoElementForStreamChange,
  switchSourceTab,
} from "./player-streams.js?v=20261111v3";
import { loadSkipIntroSegments } from "./player-intro-credits.js?v=20261111v3";
import {
  OFFICIAL_STREAMING_SERVICES,
  syncMediaSessionMetadata,
  updateModalKinoriumHeader,
} from "./player-meta.js?v=20261111v3";
import { syncCustomControlPopovers } from "./player-ui-controls.js?v=20261111v3";
import {
  hideXRayPauseShelf,
  closeBookmarkNoteDialog,
  renderTimelineBookmarks,
} from "./player-bookmarks.js?v=20261111v3";

export function hasStartedWatchingCurrentEpisode(item, seasonNum, epNum) {
  if (state.creditsOverlayShownThisEpisode) return true;
  const video = document.getElementById("native-video");
  const { cur, dur } = getEffectivePlaybackTiming(video);
  if (cur >= 600 || (dur > 0 && cur / dur >= 0.5)) return true;
  const saved = getEpisodeProgress(item, seasonNum, epNum);
  return Boolean(saved && (saved.current_time >= 600 || saved.pct >= 50));
}

export function markOutgoingEpisodeWatched(item, prevSeason, prevEpisode) {
  if (!item || item.media_type !== "series" || item.kinorium?.not_watching) return;
  const sNum = Number(prevSeason) || 1;
  const eNum = Number(prevEpisode) || 1;
  const epKey = `${item.id || ""}:s${sNum}e${eNum}`;
  const video = document.getElementById("native-video");
  const { cur, dur } = getEffectivePlaybackTiming(video);
  const effDur = dur >= 60 ? dur : Math.max(cur, 120);
  saveEpisodeProgress(item, sNum, eNum, effDur, effDur);
  const inFlightMap = state.scrobbleInFlightEpisodes || {};
  if (inFlightMap[epKey]) return;
  const remoteSyncedMap = state.remoteSyncedEpisodesThisSession || {};
  const needsRemoteRetry = isServiceEnabled("kinorium") && !remoteSyncedMap[epKey];
  if (state.scrobbledEpisodesThisSession[epKey] && isEpisodeWatched(item, sNum, eNum) && !needsRemoteRetry) {
    return;
  }
  reportScrobbleProgress(effDur, effDur, {
    forceWatched: true,
    reason: "next_episode",
    season: sNum,
    episode: eNum,
  }).catch(() => {});
}

export function escapeEpisodeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function getEpisodeDisplayMeta(seasonNum, epNum) {
  const sKey = String(seasonNum);
  const eKey = String(epNum);
  const metaObj = state.episodesMeta?.[sKey]?.[eKey] || null;
  const rawTitle = String(metaObj?.title || state.episodesTitles?.[sKey]?.[eKey] || "").trim();
  const isGeneric = !rawTitle || /^(?:серия|эпизод|episode)\s*\d+$/i.test(rawTitle);
  const ruRealTitle = isGeneric ? "" : rawTitle;
  const rawOrigTitle = String(metaObj?.orig_title || "").trim();
  const origRealTitle = /^(?:серия|эпизод|episode)\s*\d+$/i.test(rawOrigTitle) ? "" : rawOrigTitle;
  const cleanEnTitle =
    origRealTitle && !hasCyrillicText(origRealTitle)
      ? origRealTitle
      : ruRealTitle && !hasCyrillicText(ruRealTitle)
      ? ruRealTitle
      : "";
  const realTitle = isEn() ? cleanEnTitle : ruRealTitle || origRealTitle;
  const secEpTitle = isEn()
    ? ""
    : origRealTitle && origRealTitle.toLowerCase() !== ruRealTitle.toLowerCase()
    ? origRealTitle
    : "";
  let airDate = expandRussianDateText(metaObj?.air_date || "");
  if (isEn() && airDate && hasCyrillicText(airDate)) {
    airDate = airDate.replace(_RU_MONTH_RE, (m) => _RU_MONTH_MAP[m.toLowerCase()] || m);
    airDate = airDate.replace(/\bгода\b/gi, "").replace(/\s{2,}/g, " ").trim();
    if (hasCyrillicText(airDate)) airDate = "";
  }
  return {
    code: t(`Сезон ${seasonNum} · Серия ${epNum}`, `Season ${seasonNum} · Episode ${epNum}`),
    rawTitle: realTitle || t(`Серия ${epNum}`, `Episode ${epNum}`),
    realTitle,
    origTitle: secEpTitle,
    airDate,
  };
}

export function getEpisodeRatingEntry(item, seasonNum, epNum) {
  if (!item || !item.kinorium || !item.kinorium.episode_ratings) return null;
  const key = `s${Number(seasonNum) || 1}e${Number(epNum) || 1}`;
  const entry = item.kinorium.episode_ratings[key];
  return entry && typeof entry === "object" ? entry : null;
}

export function updateCurrentEpisodeBar(item, seasonNum, epNum, isPreview = false) {
  const barEl = document.getElementById("current-episode-bar");
  const codeEl = document.getElementById("current-ep-code");
  const titleEl = document.getElementById("current-ep-title");
  const subEl = document.getElementById("current-ep-sub");
  const watchBtn = document.getElementById("btn-toggle-current-ep");
  const watchLbl = document.getElementById("current-ep-watch-label");
  const rateBtn = document.getElementById("btn-rate-current-ep");
  const rateLbl = document.getElementById("current-ep-rate-label");
  if (!barEl || !codeEl || !titleEl) return;
  if (!item || item.media_type !== "series" || state.activeSourceTab === "trailer") {
    barEl.classList.add("hidden");
    return;
  }
  barEl.classList.remove("hidden");
  barEl.classList.toggle("is-preview", Boolean(isPreview));

  const epMeta = getEpisodeDisplayMeta(seasonNum, epNum);
  const isWatched = isEpisodeWatched(item, seasonNum, epNum);
  const activeIsWatched = isEpisodeWatched(item, state.activeSeason, state.activeEpisode);
  const epProg = getEpisodeProgress(item, seasonNum, epNum);
  const previewEpRating = getEpisodeRatingEntry(item, seasonNum, epNum);
  const activeEpRating = getEpisodeRatingEntry(item, state.activeSeason, state.activeEpisode);

  const codeLabel = t(`Сезон ${seasonNum} · Серия ${epNum}`, `Season ${seasonNum} · Episode ${epNum}`);
  codeEl.innerHTML = isPreview
    ? `<span>${codeLabel}</span>`
    : `${iconSvg("play", 10)}<span>${codeLabel}</span>`;
  titleEl.textContent = epMeta.realTitle
    ? isEn()
      ? `"${epMeta.realTitle}"`
      : `«${epMeta.realTitle}»`
    : "";
  titleEl.classList.toggle("hidden", !epMeta.realTitle);

  const subParts = [];
  if (isPreview && previewEpRating?.score) {
    subParts.push(t(`Оценка: ${previewEpRating.score}/10`, `Rating: ${previewEpRating.score}/10`));
  }
  if (isPreview && isWatched) {
    subParts.push(t("Просмотрено", "Watched"));
  } else if (!isWatched && epProg && epProg.current_time > 5) {
    subParts.push(`${formatTime(epProg.current_time)} (${epProg.pct || 0}%)`);
  } else if (epMeta.airDate) {
    subParts.push(epMeta.airDate);
  }
  if (subEl) {
    if (subParts.length > 0) {
      subEl.textContent = subParts.join(" · ");
      subEl.classList.remove("hidden");
    } else {
      subEl.textContent = "";
      subEl.classList.add("hidden");
    }
  }
  const kinEnabled = isServiceEnabled("kinorium");
  if (watchBtn) watchBtn.classList.toggle("hidden", !kinEnabled);
  document.getElementById("ep-rate-dropdown-wrap")?.classList.toggle("hidden", !kinEnabled);
  document.querySelector(".atv-ep-batch-group")?.classList.toggle("hidden", !kinEnabled);
  if (watchBtn && watchLbl && kinEnabled) {
    if (activeIsWatched) {
      watchLbl.textContent = t("Просмотрено", "Watched");
      watchBtn.classList.add("is-watched");
      watchBtn.title = t(
        "Серия отмечена просмотренной в Kinorium (нажмите, чтобы снять отметку)",
        "Episode marked as watched on Kinorium (click to unmark)"
      );
    } else {
      watchLbl.textContent = t("Отметить", "Mark");
      watchBtn.classList.remove("is-watched");
      watchBtn.title = t(
        "Отметить эту серию просмотренной в Kinorium",
        "Mark this episode as watched on Kinorium"
      );
    }
  }
  if (rateBtn && rateLbl) {
    if (activeEpRating && activeEpRating.score) {
      rateLbl.textContent = `${activeEpRating.score}/10`;
      rateBtn.classList.add("is-rated");
    } else {
      rateLbl.textContent = t("Оценить", "Rate");
      rateBtn.classList.remove("is-rated");
    }
  }
}

export function resolveEffectiveSeasonsMap(item, passedSeasonsMap = null) {
  if (!item && !passedSeasonsMap) return null;
  const itemKey = item?.id ? String(item.id) : (item?.title || "");
  const hasPassed = Boolean(passedSeasonsMap && typeof passedSeasonsMap === "object");
  if (!hasPassed && item && item._effSeasonsMap && item._effSeasonsEpoch === state.liveSeriesUpdatesVersion) {
    return item._effSeasonsMap;
  }
  const candidates = [
    passedSeasonsMap,
    state.seasonsMap,
    item?.id && state.liveSeriesUpdates?.[item.id]?.seasons_map,
    item?.kinorium?.kinorium_id && state.liveSeriesUpdates?.[`kin_${item.kinorium.kinorium_id}`]?.seasons_map,
    item?.title && state.liveSeriesUpdates?.[item.title.trim().toLowerCase()]?.seasons_map,
    item?.seasons_map,
  ];
  for (const cand of candidates) {
    if (!cand || typeof cand !== "object") continue;
    const valid = {};
    Object.keys(cand).forEach((k) => {
      const sNum = parseInt(k, 10);
      const eps = Array.isArray(cand[k])
        ? cand[k].map((e) => parseInt(e, 10)).filter((n) => n > 0).sort((a, b) => a - b)
        : [];
      if (sNum > 0 && eps.length > 0) {
        valid[String(sNum)] = Array.from(new Set(eps));
      }
    });
    if (Object.keys(valid).length > 0) {
      if (!hasPassed && item) {
        item._effSeasonsMap = valid;
        item._effSeasonsEpoch = state.liveSeriesUpdatesVersion || 0;
      }
      return valid;
    }
  }
  const latestEp = Number(
    item?.latest_episode ||
    item?.kinorium?.latest_episode ||
    (item?.id && state.liveSeriesUpdates?.[item.id]?.latest_episode) ||
    (item?.kinorium?.kinorium_id && state.liveSeriesUpdates?.[`kin_${item.kinorium.kinorium_id}`]?.latest_episode) ||
    0
  );
  const latestS = Number(
    item?.latest_season ||
    item?.kinorium?.latest_season ||
    (item?.id && state.liveSeriesUpdates?.[item.id]?.latest_season) ||
    1
  );
  if (latestEp > 0) {
    const fallbackRes = {
      [String(latestS || 1)]: Array.from({ length: latestEp }, (_, idx) => idx + 1),
    };
    if (!hasPassed && item) {
      item._effSeasonsMap = fallbackRes;
      item._effSeasonsEpoch = state.liveSeriesUpdatesVersion || 0;
    }
    return fallbackRes;
  }
  return null;
}

const _ISO_DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}/;
let _cachedTodayIso = "";
let _cachedTodayIsoTs = 0;

function getTodayIsoDate() {
  const now = Date.now();
  if (!_cachedTodayIso || now - _cachedTodayIsoTs > 60000) {
    _cachedTodayIso = new Date(now).toISOString().slice(0, 10);
    _cachedTodayIsoTs = now;
  }
  return _cachedTodayIso;
}

export function filterReleasedEpisodesForSeason(item, sNum, rawSeasonEps) {
  if (!Array.isArray(rawSeasonEps)) return [];
  const todayIso = getTodayIsoDate();
  const sKey = String(sNum || 1);
  const metaForSeason = state.episodesMeta?.[sKey] || {};
  const effLatestS = Number(item?.latest_season || item?.kinorium?.latest_season || 0);
  const effLatestE = Number(item?.latest_episode || item?.kinorium?.latest_episode || 0);
  return rawSeasonEps.filter((e) => {
    const rawEpMeta = metaForSeason[String(e)] || {};
    const airDateStr = String(rawEpMeta.air_date || rawEpMeta.airDate || "");
    if (_ISO_DATE_PREFIX_RE.test(airDateStr) && airDateStr.slice(0, 10) > todayIso) return false;
    if (rawEpMeta.is_future === true || rawEpMeta.is_released === false) return false;
    if (effLatestS > 0 && effLatestE > 0 && Number(sNum) === effLatestS && e > effLatestE) {
      return false;
    }
    return true;
  });
}

export function populateSeasonEpisodeSelectors(item, seasonsMap = null) {
  const bottomPanel = document.getElementById("episodes-bottom-panel");
  const seasonGroup = document.getElementById("season-group");
  const seasonStaticVal = document.getElementById("season-static-val");
  const epNavGroup = document.getElementById("ep-nav-group");
  const btnPrevEp = document.getElementById("btn-prev-ep");
  const btnNextEp = document.getElementById("btn-next-ep");
  const seasonSel = document.getElementById("select-season");
  const curEpBar = document.getElementById("current-episode-bar");
  const epStripRow = document.getElementById("episodes-strip-row");
  const epStripBar = document.getElementById("episodes-strip-bar");
  const seasonProgBox = document.getElementById("player-season-progress");
  const seasonProgText = document.getElementById("player-season-prog-text");
  const seasonProgFill = document.getElementById("player-season-prog-fill");

  if (item.media_type !== "series") {
    if (bottomPanel) bottomPanel.classList.add("hidden");
    if (seasonGroup) seasonGroup.classList.add("hidden");
    if (epNavGroup) epNavGroup.classList.add("hidden");
    if (curEpBar) curEpBar.classList.add("hidden");
    if (epStripRow) epStripRow.classList.add("hidden");
    if (epStripBar) {
      epStripBar._epCtx = null;
      epStripBar._lastHoverEpBtn = null;
      epStripBar.classList.add("hidden");
    }
    if (seasonProgBox) seasonProgBox.classList.add("hidden");
    syncEpisodesStripDrawerUI();
    syncCustomVideoControlsUI();
    return;
  }

  if (bottomPanel) bottomPanel.classList.remove("hidden");
  if (seasonGroup) seasonGroup.classList.remove("hidden");
  if (epNavGroup) epNavGroup.classList.remove("hidden");
  syncEpisodesStripDrawerUI();

  const resolvedMap = resolveEffectiveSeasonsMap(item, seasonsMap);
  const mapKeys = resolvedMap
    ? Object.keys(resolvedMap)
        .map((k) => parseInt(k, 10))
        .filter((n) => n > 0)
        .sort((a, b) => a - b)
    : [];
  const fallbackSeasonsCount = Math.max(state.activeSeason || 1, Number(item.seasons_count) || 1);
  const seasonNumbers =
    mapKeys.length > 0
      ? mapKeys
      : Array.from({ length: fallbackSeasonsCount }, (_, idx) => idx + 1);

  if (!seasonNumbers.includes(state.activeSeason)) {
    state.activeSeason = seasonNumbers[0] || 1;
  }

  const isSingleSeason = seasonNumbers.length <= 1;
  if (seasonGroup) {
    seasonGroup.classList.toggle("is-single-season", isSingleSeason);
  }
  if (seasonStaticVal) {
    seasonStaticVal.textContent = String(seasonNumbers[0] || state.activeSeason || 1);
    seasonStaticVal.classList.toggle("hidden", !isSingleSeason);
  }

  if (seasonSel) {
    seasonSel.innerHTML = "";
    const seasonFrag = document.createDocumentFragment();
    seasonNumbers.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = String(s);
      opt.textContent = `${s}`;
      if (s === state.activeSeason) opt.selected = true;
      seasonFrag.appendChild(opt);
    });
    seasonSel.appendChild(seasonFrag);
    seasonSel.value = String(state.activeSeason);
    seasonSel.disabled = isSingleSeason;
    seasonSel.classList.toggle("hidden", isSingleSeason);
    syncCustomSelect(seasonSel);
  }

  const todayIso = getTodayIsoDate();
  const curSeasonKey = String(state.activeSeason || 1);
  const metaForActiveSeason = state.episodesMeta?.[curSeasonKey] || {};
  const effLatestS = Number(item.latest_season || item.kinorium?.latest_season || 0);
  const effLatestE = Number(item.latest_episode || item.kinorium?.latest_episode || 0);

  const fallbackEpsCount = Math.max(state.activeEpisode || 1, Number(item.episodes_per_season) || 1);
  const rawSeasonEps =
    resolvedMap && resolvedMap[curSeasonKey] && resolvedMap[curSeasonKey].length > 0
      ? resolvedMap[curSeasonKey]
      : Array.from({ length: fallbackEpsCount }, (_, idx) => idx + 1);

  const seasonEps = filterReleasedEpisodesForSeason(item, state.activeSeason, rawSeasonEps);

  if (!seasonEps.includes(state.activeEpisode)) {
    state.activeEpisode = seasonEps[0] || 1;
  }

  updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);

  const isGridMode = state.epViewMode === "grid";
  document.getElementById("btn-ep-view-strip")?.classList.toggle("active", !isGridMode);
  document.getElementById("btn-ep-view-grid")?.classList.toggle("active", isGridMode);
  const hoverTipEl = document.getElementById("ep-pill-hover-tooltip");
  if (hoverTipEl) hoverTipEl.classList.add("hidden");

  if (epStripBar) {
    epStripBar.classList.toggle("ep-grid-mode", isGridMode);
    if (epStripRow) epStripRow.classList.toggle("ep-grid-row", isGridMode);
    epStripBar.onmouseleave = () => {
      if (hoverTipEl) hoverTipEl.classList.add("hidden");
    };

    const releasedEpsSet = new Set(seasonEps);
    const allSeasonEpNumsSet = new Set(rawSeasonEps);
    Object.keys(metaForActiveSeason).forEach((ek) => {
      const en = parseInt(ek, 10);
      if (en > 0) allSeasonEpNumsSet.add(en);
    });
    const totalPlannedEpisodes = Math.max(
      Number(item.episodes_per_season) || 0,
      Number(item.kinorium?.episodes_per_season) || 0,
      rawSeasonEps.length
    );
    for (let pEp = 1; pEp <= totalPlannedEpisodes; pEp++) {
      allSeasonEpNumsSet.add(pEp);
    }
    const allSeasonEps = Array.from(allSeasonEpNumsSet).sort((a, b) => a - b);
    const offlineSavedEpsArr =
      Array.isArray(state.downloadsItems) && state.downloadsItems.length > 0
        ? findAllOfflineDownloadsForTitle(item, null, null, ["completed"])
            .filter((dl) => Number(dl.season) === Number(state.activeSeason))
            .map((dl) => Number(dl.episode))
        : [];
    const offlineSavedEpsSet = new Set(offlineSavedEpsArr);

    const watchedSigParts = [];
    const progSigParts = [];
    const epStateMap = new Map();
    allSeasonEps.forEach((epN) => {
      const w = Boolean(isEpisodeWatched(item, state.activeSeason, epN));
      if (w) watchedSigParts.push(epN);
      const pr = getEpisodeProgress(item, state.activeSeason, epN);
      if (pr && pr.pct > 0) progSigParts.push(`${epN}:${pr.pct}`);
      const rt = getEpisodeRatingEntry(item, state.activeSeason, epN);
      if (rt?.score) progSigParts.push(`${epN}r${rt.score}`);
      epStateMap.set(epN, { isWatched: w, epProg: pr, epRating: rt });
    });
    const metaKeysLen = Object.keys(metaForActiveSeason).length;
    const epStripSeasonSig = `${item.id || item.title || ""}|s:${state.activeSeason}|m:${isGridMode ? "g" : "s"}|l:${state.appLang || "ru"}|all:${allSeasonEps.join(",")}|rel:${seasonEps.join(",")}|mk:${metaKeysLen}|off:${offlineSavedEpsArr.join(",")}|w:${watchedSigParts.join(",")}|p:${progSigParts.join(",")}`;
    const epStripRenderSig = `${epStripSeasonSig}|ae:${state.activeEpisode}`;

    epStripBar._epCtx = { item, resolvedMap, hoverTipEl, epStripRow, isGridMode };
    if (!epStripBar._epStripDelegatedBound) {
      epStripBar._epStripDelegatedBound = true;
      epStripBar.addEventListener("mouseover", (ev) => {
        const ctx = epStripBar._epCtx;
        if (!ctx || ctx.isGridMode || !ctx.hoverTipEl || !ctx.epStripRow) return;
        const btn = ev.target?.closest?.("button[data-ep]");
        if (!btn || btn.disabled || !epStripBar.contains(btn)) return;
        if (epStripBar._lastHoverEpBtn === btn && !ctx.hoverTipEl.classList.contains("hidden")) return;
        epStripBar._lastHoverEpBtn = btn;
        const rowRect = ctx.epStripRow.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        const headLine = btn.dataset.tipHead || "";
        const subLine = btn.dataset.tipSub || "";
        const estChars = Math.max(headLine.length, subLine.length);
        const tipW = Math.min(280, Math.max(120, estChars * 7 + 24));
        const tipH = subLine ? 40 : 26;
        const maxLeft = Math.max(0, Math.floor(rowRect.width - tipW - 2));
        const rawLeft = btnRect.left - rowRect.left + btnRect.width / 2 - tipW / 2;
        const clampedLeft = Math.max(0, Math.min(maxLeft, Math.round(rawLeft)));
        ctx.hoverTipEl.innerHTML = `<strong>${escapeHtml(headLine)}</strong>${
          subLine ? `<span class="atv-ep-hover-tooltip-sub">${escapeHtml(subLine)}</span>` : ""
        }`;
        ctx.hoverTipEl.style.bottom = "auto";
        ctx.hoverTipEl.style.top = `${Math.round(btnRect.top - rowRect.top - tipH - 6)}px`;
        ctx.hoverTipEl.style.left = `${clampedLeft}px`;
        ctx.hoverTipEl.classList.remove("hidden");
      });
      epStripBar.addEventListener("mouseleave", () => {
        epStripBar._lastHoverEpBtn = null;
      });
      epStripBar.addEventListener("click", async (ev) => {
        const btn = ev.target?.closest?.("button[data-ep]");
        if (!btn || btn.disabled || !epStripBar.contains(btn)) return;
        const e = Number(btn.dataset.ep);
        if (!e || state.activeEpisode === e) return;
        await switchToSeriesSeasonEpisode(state.activeSeason, e);
      });
    }

    if (epStripBar.dataset.renderSig === epStripRenderSig && epStripBar.childElementCount > 0) {
      // Already rendered with identical state; skip DOM rebuild
    } else if (epStripBar.dataset.seasonSig === epStripSeasonSig && epStripBar.childElementCount > 0) {
      epStripBar.dataset.renderSig = epStripRenderSig;
      let activePillEl = null;
      const children = epStripBar.children;
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const epNum = Number(child.dataset.ep);
        const isAct = !child.disabled && epNum === state.activeEpisode;
        child.classList.toggle("active", isAct);
        if (isAct) activePillEl = child;
      }
      if (activePillEl && state.episodesStripExpanded) {
        requestAnimationFrame(() => {
          try {
            activePillEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
          } catch (err) { window.logDebug?.("PlayerSeasons", err); }
        });
      }
    } else {
      epStripBar.dataset.seasonSig = epStripSeasonSig;
      epStripBar.dataset.renderSig = epStripRenderSig;
      epStripBar.innerHTML = "";
      const epFrag = document.createDocumentFragment();

      let activePillEl = null;
      let watchedInSeasonCount = 0;
      allSeasonEps.forEach((e) => {
        const rawEpMeta = metaForActiveSeason[String(e)] || {};
        const airDateStr = String(rawEpMeta.air_date || rawEpMeta.airDate || "");
        const isDateFuture = _ISO_DATE_PREFIX_RE.test(airDateStr) && airDateStr.slice(0, 10) > todayIso;
        const isPastLatest = Boolean(effLatestS > 0 && effLatestE > 0 && state.activeSeason === effLatestS && e > effLatestE);
        const isFutureMeta = Boolean(rawEpMeta.is_future === true || rawEpMeta.is_released === false || isDateFuture || isPastLatest);
        const isUnreleased = isFutureMeta || !releasedEpsSet.has(e);
        const cachedEpState = epStateMap.get(e);
        const isWatched = !isUnreleased && Boolean(cachedEpState ? cachedEpState.isWatched : isEpisodeWatched(item, state.activeSeason, e));
        if (isWatched) watchedInSeasonCount++;
        const isActive = !isUnreleased && e === state.activeEpisode;
        const epProg = !isUnreleased ? (cachedEpState ? cachedEpState.epProg : getEpisodeProgress(item, state.activeSeason, e)) : null;
        const epMeta = getEpisodeDisplayMeta(state.activeSeason, e);
        const epRating = !isUnreleased ? (cachedEpState ? cachedEpState.epRating : getEpisodeRatingEntry(item, state.activeSeason, e)) : null;
        const epBtn = document.createElement("button");
        epBtn.type = "button";
        epBtn.dataset.ep = String(e);
        if (isUnreleased) {
          epBtn.disabled = true;
        }
        if (isActive) activePillEl = epBtn;
        const progHint =
          epProg && epProg.current_time > 5
            ? t(
                ` · Остановились на ${formatTime(epProg.current_time)} (${epProg.pct || 0}%)`,
                ` · Paused at ${formatTime(epProg.current_time)} (${epProg.pct || 0}%)`
              )
            : "";
        const tooltipTitlePart = epMeta.realTitle
          ? isEn()
            ? `Episode ${e}: "${epMeta.realTitle}"${epMeta.origTitle ? ` (${epMeta.origTitle})` : ""}`
            : `Серия ${e}: «${epMeta.realTitle}»${epMeta.origTitle ? ` (${epMeta.origTitle})` : ""}`
          : t(`Серия ${e}`, `Episode ${e}`);
        const dateHint = isUnreleased
          ? epMeta.airDate
            ? t(` · Выйдет: ${epMeta.airDate}`, ` · Airs: ${epMeta.airDate}`)
            : t(" · Ещё не вышла", " · Not released yet")
          : epMeta.airDate
          ? ` · ${epMeta.airDate}`
          : "";
        const rateHint = epRating?.score
          ? t(` · Ваша оценка: ${epRating.score}/10`, ` · Your rating: ${epRating.score}/10`)
          : "";
        const epSavedOffline = !isUnreleased && offlineSavedEpsSet.has(Number(e));
        const offlineHint = epSavedOffline ? t(" · Доступно офлайн", " · Saved offline") : "";
        epBtn.title = `${t(`Сезон ${state.activeSeason}`, `Season ${state.activeSeason}`)} · ${tooltipTitlePart}${dateHint}${
          isWatched ? t(" · Просмотрено", " · Watched") : ""
        }${offlineHint}${rateHint}${progHint}`;

        const barHtml =
          epProg && epProg.pct > 0 && !isWatched
            ? `<span class="atv-ep-pill-progress" style="width:${Math.min(100, epProg.pct)}%"></span>`
            : "";

        if (isGridMode) {
          epBtn.className = `atv-ep-card${isWatched ? " watched" : ""}${isActive ? " active" : ""}${
            epSavedOffline ? " is-saved-offline" : ""
          }${isUnreleased ? " is-unreleased" : ""}`;
          const metaRight = isUnreleased
            ? epMeta.airDate
              ? `${t("Выйдет", "Airs")}: ${epMeta.airDate}`
              : t("Скоро", "Upcoming")
            : epRating?.score
            ? `${epRating.score}/10`
            : epMeta.airDate || (isWatched ? t("Просмотрено", "Watched") : epSavedOffline ? t("Офлайн", "Offline") : "");
          const cardTitle = epMeta.realTitle || "";
          epBtn.innerHTML = `
            <div class="atv-ep-card-top">
              <span class="atv-ep-card-num">${isWatched ? iconSvg("check", 10) : ""}<span>${t(`Серия ${e}`, `Episode ${e}`)}</span></span>
              <span class="atv-ep-card-meta">${escapeHtml(metaRight)}</span>
            </div>
            ${cardTitle ? `<div class="atv-ep-card-title">${escapeHtml(cardTitle)}</div>` : ""}
            ${barHtml}
          `;
        } else {
          epBtn.className = `atv-ep-pill${isWatched ? " watched" : ""}${isActive ? " active" : ""}${
            epSavedOffline ? " is-saved-offline" : ""
          }${isUnreleased ? " is-unreleased" : ""}`;
          const unreleasedDateBadge =
            isUnreleased && epMeta.airDate
              ? `<span class="atv-ep-pill-airdate">${escapeHtml(epMeta.airDate)}</span>`
              : "";
          epBtn.innerHTML = `<span class="atv-ep-pill-num">${e}</span>${unreleasedDateBadge}${barHtml}`;
        }

        if (isUnreleased) {
          epFrag.appendChild(epBtn);
          return;
        }

        const headLine = epMeta.realTitle
          ? isEn()
            ? `Episode ${e} · "${epMeta.realTitle}"`
            : `Серия ${e} · «${epMeta.realTitle}»`
          : t(`Серия ${e}`, `Episode ${e}`);
        const subLineParts = [];
        if (epMeta.airDate) subLineParts.push(epMeta.airDate);
        if (epSavedOffline) subLineParts.push(t("Офлайн", "Offline"));
        if (isWatched) subLineParts.push(t("Просмотрено", "Watched"));
        else if (epProg && epProg.pct > 0) subLineParts.push(`${epProg.pct}%`);
        if (epRating?.score) {
          subLineParts.push(t(`Оценка ${epRating.score}/10`, `Rating ${epRating.score}/10`));
        }
        epBtn.dataset.tipHead = headLine;
        epBtn.dataset.tipSub = subLineParts.join(" · ");
        epFrag.appendChild(epBtn);
      });
      epStripBar.appendChild(epFrag);
      if (activePillEl && state.episodesStripExpanded) {
        requestAnimationFrame(() => {
          try {
            activePillEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
          } catch (err) { window.logDebug?.("PlayerSeasons", err); }
        });
      }
    }
  }

  const minSeason = seasonNumbers[0] || 1;
  const maxSeason = seasonNumbers[seasonNumbers.length - 1] || state.activeSeason;
  const minEpInSeason = seasonEps[0] || 1;
  const maxEpInSeason = seasonEps[seasonEps.length - 1] || state.activeEpisode;

  if (btnPrevEp) {
    btnPrevEp.disabled = state.activeSeason <= minSeason && state.activeEpisode <= minEpInSeason;
    btnPrevEp.title = t("Предыдущая серия (P)", "Previous episode (P)");
  }
  if (btnNextEp) {
    btnNextEp.disabled = state.activeSeason >= maxSeason && state.activeEpisode >= maxEpInSeason;
    const nextCoords = getNextEpisodeCoords();
    if (!btnNextEp.disabled && nextCoords) {
      const nextMeta = getEpisodeDisplayMeta(nextCoords.season, nextCoords.episode);
      const titleSuffix = nextMeta.realTitle
        ? isEn()
          ? ` — "${nextMeta.realTitle}"`
          : ` — «${nextMeta.realTitle}»`
        : "";
      btnNextEp.title = t(
        `Следующая серия: Сезон ${nextCoords.season}, Серия ${nextCoords.episode}${titleSuffix} (N)`,
        `Next episode: Season ${nextCoords.season}, Episode ${nextCoords.episode}${titleSuffix} (N)`
      );
    } else {
      btnNextEp.title = t("Следующая серия (N)", "Next episode (N)");
    }
  }

  if (seasonProgBox && seasonProgText && seasonProgFill) {
    if (isServiceEnabled("kinorium") && seasonEps.length > 0) {
      const releasedCount = seasonEps.length;
      const totalPlanned = Math.max(
        Number(item.episodes_per_season) || 0,
        Number(item.kinorium?.episodes_per_season) || 0,
        releasedCount
      );
      const watchedCount = seasonEps.filter((epNum) => isEpisodeWatched(item, state.activeSeason, epNum)).length;
      const progSig = `${item.id || item.title || ""}|s:${state.activeSeason}|w:${watchedCount}|r:${releasedCount}|p:${totalPlanned}|l:${state.appLang || "ru"}`;
      if (seasonProgBox.dataset.progSig !== progSig) {
        seasonProgBox.dataset.progSig = progSig;
        const pct = Math.min(100, Math.round((watchedCount / releasedCount) * 100));
        let progMsg = isEn()
          ? `Watched ${watchedCount} of ${releasedCount} ${releasedCount === 1 ? "episode" : "episodes"}`
          : `Просмотрено ${watchedCount} из ${releasedCount} ${genitiveAfterIz(
              releasedCount,
              "серии",
              "серий"
            )}`;
        if (totalPlanned > releasedCount) {
          progMsg += isEn()
            ? ` (${releasedCount} of ${totalPlanned} released)`
            : ` (вышло ${releasedCount} из ${totalPlanned})`;
        }
        seasonProgText.textContent = progMsg;
        seasonProgFill.style.width = `${pct}%`;
        seasonProgBox.title = `${t(`Сезон ${state.activeSeason}`, `Season ${state.activeSeason}`)} · ${progMsg} (${pct}%)`;
      }
      seasonProgBox.classList.remove("hidden");
    } else {
      seasonProgBox.dataset.progSig = "";
      seasonProgBox.classList.add("hidden");
    }
  }
  syncCustomControlPopovers();
  syncCustomVideoControlsUI();
}

export async function switchToSeriesSeasonEpisode(targetSeason, targetEpisode) {
  const item = state.activeItem;
  if (!item || item.media_type !== "series") return;
  const sNum = Number(targetSeason) || state.activeSeason || 1;
  const eNum = Number(targetEpisode) || 1;
  if (state.activeSeason === sNum && state.activeEpisode === eNum) return;

  const prevSeason = state.activeSeason;
  const prevEpisode = state.activeEpisode;
  const nextCoords = getNextEpisodeCoords();
  if (
    nextCoords &&
    sNum === nextCoords.season &&
    eNum === nextCoords.episode &&
    hasStartedWatchingCurrentEpisode(item, prevSeason, prevEpisode)
  ) {
    markOutgoingEpisodeWatched(item, prevSeason, prevEpisode);
  }
  document.getElementById("ep-pill-hover-tooltip")?.classList.add("hidden");
  document.getElementById("kinorium-postwatch-overlay")?.classList.add("hidden");
  document.getElementById("video-stage")?.classList.remove("has-postwatch-open");
  state.postwatchManual = false;
  state.postwatchHovered = false;
  document.getElementById("skip-intro-btn")?.classList.add("hidden");
  const skipOutroEl = document.getElementById("skip-outro-btn");
  if (skipOutroEl) {
    skipOutroEl.classList.add("hidden");
    skipOutroEl.classList.remove("is-preloaded");
    skipOutroEl.removeAttribute("title");
    skipOutroEl.querySelector(".atv-preload-ready-dot")?.remove();
  }
  clearAutoplayNextTimer();
  if (state.remuxSeekDebounceTimer) {
    clearTimeout(state.remuxSeekDebounceTimer);
    state.remuxSeekDebounceTimer = null;
  }
  if (state.audioOffsetReloadTimerId) {
    clearTimeout(state.audioOffsetReloadTimerId);
    state.audioOffsetReloadTimerId = null;
  }
  state._nextEpToastDismissed = false;
  state.autoplayCancelledThisEpisode = false;
  state.introSkippedThisEpisode = false;
  state.postwatchShownThisEpisode = false;
  state.postwatchDismissedThisEpisode = false;
  state.creditsOverlayShownThisEpisode = false;
  state.probeCreditsStartSec = 0;
  state._lastPreloadDoneKey = "";
  state.subtitleOffsetSec = 0;
  state.customExternalSubtitles = [];
  closeSubtitleDictPopover(false);
  hideXRayPauseShelf();
  closeBookmarkNoteDialog(false);
  syncSubtitleOffsetUI();
  state.activeSeason = sNum;
  state.activeEpisode = eNum;
  state.vcPreviewSeason = sNum;
  renderTimelineBookmarks();
  const resolvedMap = resolveEffectiveSeasonsMap(item, state.seasonsMap);
  populateSeasonEpisodeSelectors(item, resolvedMap);
  updateMiniPlayerTitle();
  syncMediaSessionMetadata();
  sweepPendingDownloadCleanups();
  pushDesktopRemoteStateNow();
  const savedEpProg = getEpisodeProgress(item, sNum, eNum);
  const startSec =
    savedEpProg &&
    savedEpProg.current_time > 10 &&
    savedEpProg.pct < 95 &&
    !isEpisodeWatched(item, sNum, eNum)
      ? savedEpProg.current_time
      : 0;
  if (state.officialEmbedActive && OFFICIAL_STREAMING_SERVICES.has(state.activeSourceTab)) {
    await loadOfficialServiceTab(state.activeSourceTab, { embedMode: true });
    return;
  }
  const hasPreloadedTarget = Boolean(
    state.preloadedNextEpisode &&
      state.preloadedNextEpisode.key &&
      nextCoords &&
      sNum === nextCoords.season &&
      eNum === nextCoords.episode
  );
  if (
    !hasPreloadedTarget &&
    (state.activeSourceTab === "hdrezka" ||
      state.activeSourceTab === "stremio" ||
      state.activeSourceTab === "backup4k" ||
      state.activeSourceTab === "offline")
  ) {
    resetVideoElementForStreamChange();
  }
  if (state.activeSourceTab === "offline") {
    await loadOfflineStreamForActiveTitle(startSec);
  } else if (state.activeSourceTab === "stremio") {
    await loadStremioStreams(startSec);
  } else if (state.activeSourceTab === "backup4k") {
    await loadBackup4KReleases(startSec);
  } else {
    const offlineEp = findOfflineDownloadForTitle(item, sNum, eNum);
    if (offlineEp && typeof navigator !== "undefined" && navigator.onLine === false) {
      await switchSourceTab("offline", startSec);
      return;
    }
    await loadHDRezkaStream(startSec);
  }
  if (state.activeOfficialService && !state.officialEmbedActive) {
    loadOfficialServiceTab(state.activeOfficialService, { embedMode: false }).catch(() => {});
  }
  if (state.activeSourceTab !== "offline" && (typeof navigator === "undefined" || navigator.onLine !== false)) {
    await loadSkipIntroSegments();
  }
}

export function syncEpisodesStripDrawerUI() {
  const isSeries = state.activeItem?.media_type === "series";
  const expanded = Boolean(isSeries && state.episodesStripExpanded);
  const epStripRow = document.getElementById("episodes-strip-row");
  const epStripBar = document.getElementById("episodes-strip-bar");
  const toggleBtn = document.getElementById("btn-toggle-episodes-strip");
  if (epStripRow) epStripRow.classList.toggle("hidden", !expanded);
  if (epStripBar) epStripBar.classList.toggle("hidden", !expanded);
  if (toggleBtn) {
    toggleBtn.classList.toggle("hidden", !isSeries);
    toggleBtn.classList.toggle("expanded", expanded);
    toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
  }
}

export async function stepEpisode(delta) {
  if (!state.activeItem || state.activeItem.media_type !== "series") return;
  dismissPlayerNextEpisodeToast(false);
  if (state.remuxSeekDebounceTimer) {
    clearTimeout(state.remuxSeekDebounceTimer);
    state.remuxSeekDebounceTimer = null;
  }
  if (state.audioOffsetReloadTimerId) {
    clearTimeout(state.audioOffsetReloadTimerId);
    state.audioOffsetReloadTimerId = null;
  }
  state._nextEpToastDismissed = false;
  const prevSeason = state.activeSeason;
  const prevEpisode = state.activeEpisode;
  clearAutoplayNextTimer();
  state.autoplayCancelledThisEpisode = false;
  const resolvedMap = resolveEffectiveSeasonsMap(state.activeItem, state.seasonsMap);
  const mapKeys = resolvedMap
    ? Object.keys(resolvedMap)
        .map((k) => parseInt(k, 10))
        .filter((n) => n > 0)
        .sort((a, b) => a - b)
    : [];
  const fallbackSeasonsCount = Math.max(state.activeSeason || 1, Number(state.activeItem.seasons_count) || 1);
  const seasonNumbers =
    mapKeys.length > 0
      ? mapKeys
      : Array.from({ length: fallbackSeasonsCount }, (_, idx) => idx + 1);

  const fallbackEpsCount = Math.max(state.activeEpisode || 1, Number(state.activeItem.episodes_per_season) || 1);
  const rawCurSeasonEps =
    resolvedMap && resolvedMap[String(state.activeSeason)] && resolvedMap[String(state.activeSeason)].length > 0
      ? resolvedMap[String(state.activeSeason)]
      : Array.from({ length: fallbackEpsCount }, (_, idx) => idx + 1);
  const curSeasonEps = filterReleasedEpisodesForSeason(state.activeItem, state.activeSeason, rawCurSeasonEps);

  const epIdx = curSeasonEps.indexOf(state.activeEpisode);
  const seasonIdx = seasonNumbers.indexOf(state.activeSeason);

  if (delta > 0) {
    const shouldMarkOutgoingWatched = hasStartedWatchingCurrentEpisode(
      state.activeItem,
      prevSeason,
      prevEpisode
    );
    const nextInCurSeason =
      epIdx >= 0
        ? epIdx + 1 < curSeasonEps.length
          ? curSeasonEps[epIdx + 1]
          : undefined
        : curSeasonEps.find((ep) => ep > state.activeEpisode);
    if (nextInCurSeason !== undefined) {
      state.activeEpisode = nextInCurSeason;
    } else if (seasonIdx >= 0 && seasonIdx + 1 < seasonNumbers.length) {
      const nextS = seasonNumbers[seasonIdx + 1];
      const nextSeasonEps = filterReleasedEpisodesForSeason(
        state.activeItem,
        nextS,
        resolvedMap?.[String(nextS)] || []
      );
      if (nextSeasonEps.length === 0 && resolvedMap?.[String(nextS)]) {
        return;
      }
      state.activeSeason = nextS;
      state.activeEpisode = nextSeasonEps.length > 0 ? nextSeasonEps[0] : 1;
    } else {
      return;
    }
    if (shouldMarkOutgoingWatched) {
      markOutgoingEpisodeWatched(state.activeItem, prevSeason, prevEpisode);
    }
  } else if (delta < 0) {
    const prevInCurSeason =
      epIdx > 0
        ? curSeasonEps[epIdx - 1]
        : epIdx === -1
        ? [...curSeasonEps].reverse().find((ep) => ep < state.activeEpisode)
        : undefined;
    if (prevInCurSeason !== undefined) {
      state.activeEpisode = prevInCurSeason;
    } else if (seasonIdx > 0) {
      const prevS = seasonNumbers[seasonIdx - 1];
      const prevSeasonEps = filterReleasedEpisodesForSeason(
        state.activeItem,
        prevS,
        resolvedMap?.[String(prevS)] || []
      );
      state.activeSeason = prevS;
      state.activeEpisode =
        prevSeasonEps.length > 0
          ? prevSeasonEps[prevSeasonEps.length - 1]
          : Math.max(1, Number(state.activeItem.episodes_per_season) || 1);
    } else {
      return;
    }
  }

  if (state.remuxSeekDebounceTimer) {
    clearTimeout(state.remuxSeekDebounceTimer);
    state.remuxSeekDebounceTimer = null;
  }
  if (state.audioOffsetReloadTimerId) {
    clearTimeout(state.audioOffsetReloadTimerId);
    state.audioOffsetReloadTimerId = null;
  }
  state.introSkippedThisEpisode = false;
  state.postwatchShownThisEpisode = false;
  state.postwatchDismissedThisEpisode = false;
  state.creditsOverlayShownThisEpisode = false;
  state.probeCreditsStartSec = 0;
  state._lastPreloadDoneKey = "";
  state.subtitleOffsetSec = 0;
  state.customExternalSubtitles = [];
  closeSubtitleDictPopover(false);
  hideXRayPauseShelf();
  closeBookmarkNoteDialog(false);
  syncSubtitleOffsetUI();
  renderTimelineBookmarks();
  populateSeasonEpisodeSelectors(state.activeItem, state.seasonsMap);
  updateMiniPlayerTitle();
  syncMediaSessionMetadata();
  sweepPendingDownloadCleanups();
  pushDesktopRemoteStateNow();
  document.getElementById("skip-intro-btn")?.classList.add("hidden");
  const skipOutroEl = document.getElementById("skip-outro-btn");
  if (skipOutroEl) {
    skipOutroEl.classList.add("hidden");
    skipOutroEl.classList.remove("is-preloaded");
    skipOutroEl.removeAttribute("title");
    skipOutroEl.querySelector(".atv-preload-ready-dot")?.remove();
  }
  document.getElementById("kinorium-postwatch-overlay")?.classList.add("hidden");
  document.getElementById("video-stage")?.classList.remove("has-postwatch-open");
  state.postwatchManual = false;
  state.postwatchHovered = false;
  const curEpMeta = getEpisodeDisplayMeta(state.activeSeason, state.activeEpisode);
  showToast(
    curEpMeta.realTitle
      ? isEn()
        ? `Season ${state.activeSeason}, Episode ${state.activeEpisode} — "${curEpMeta.realTitle}"`
        : `Сезон ${state.activeSeason}, Серия ${state.activeEpisode} — «${curEpMeta.realTitle}»`
      : t(
          `Сезон ${state.activeSeason}, Серия ${state.activeEpisode}`,
          `Season ${state.activeSeason}, Episode ${state.activeEpisode}`
        )
  );
  const savedEpProg = getEpisodeProgress(state.activeItem, state.activeSeason, state.activeEpisode);
  const startSec =
    savedEpProg &&
    savedEpProg.current_time > 10 &&
    savedEpProg.pct < 95 &&
    !isEpisodeWatched(state.activeItem, state.activeSeason, state.activeEpisode)
      ? savedEpProg.current_time
      : 0;
  const hasPreloadedNext =
    delta > 0 &&
    state.preloadedNextEpisode &&
    state.preloadedNextEpisode.key &&
    (state.activeSourceTab === "hdrezka" ||
      state.activeSourceTab === "stremio" ||
      state.activeSourceTab === "backup4k");

  if (!hasPreloadedNext && (state.activeSourceTab === "stremio" || state.activeSourceTab === "backup4k" || state.activeSourceTab === "hdrezka" || state.activeSourceTab === "offline")) {
    resetVideoElementForStreamChange();
  }
  if (state.activeSourceTab === "offline") {
    await loadOfflineStreamForActiveTitle(startSec);
  } else if (state.activeSourceTab === "stremio") {
    await loadStremioStreams(startSec, { isInstantSwap: Boolean(hasPreloadedNext) });
  } else if (state.activeSourceTab === "backup4k") {
    await loadBackup4KReleases(startSec, false, { isInstantSwap: Boolean(hasPreloadedNext) });
  } else {
    const offlineEp = findOfflineDownloadForTitle(state.activeItem, state.activeSeason, state.activeEpisode);
    if (offlineEp && typeof navigator !== "undefined" && navigator.onLine === false) {
      await switchSourceTab("offline", startSec);
      return;
    }
    await loadHDRezkaStream(startSec, { isInstantSwap: Boolean(hasPreloadedNext) });
  }
  if (state.activeSourceTab !== "offline" && (typeof navigator === "undefined" || navigator.onLine !== false)) {
    await loadSkipIntroSegments();
  }
}

export function resolveSeriesCompletedFlag(item) {
  if (!item || item.media_type !== "series") return null;
  if (typeof item.is_series_completed === "boolean") return item.is_series_completed;
  const live =
    (item.id && state.liveSeriesUpdates?.[item.id]) ||
    (item.kinorium?.kinorium_id && state.liveSeriesUpdates?.[`kin_${item.kinorium.kinorium_id}`]) ||
    (item.title && state.liveSeriesUpdates?.[item.title.trim().toLowerCase()]) ||
    null;
  if (live && typeof live.is_completed === "boolean") return live.is_completed;
  if (typeof item.kinorium?.is_completed === "boolean") return item.kinorium.is_completed;
  return null;
}

export async function markEpisodesBatch(mode = "upto") {
  if (!state.activeItem || state.activeItem.media_type !== "series") return;
  const item = state.activeItem;
  const resolvedMap = resolveEffectiveSeasonsMap(item, state.seasonsMap);
  const sKeys = Object.keys(resolvedMap || {})
    .map((k) => parseInt(k, 10))
    .filter((n) => !Number.isNaN(n));
  const totalSeasons = sKeys.length > 0 ? Math.max(...sKeys) : 0;
  const fallbackCount = Math.max(state.activeEpisode || 1, Number(item.episodes_per_season) || 1);
  const seasonEps =
    resolvedMap && Array.isArray(resolvedMap[String(state.activeSeason)]) && resolvedMap[String(state.activeSeason)].length > 0
      ? resolvedMap[String(state.activeSeason)]
      : Array.from({ length: fallbackCount }, (_, idx) => idx + 1);
  const totalEpsInSeason = seasonEps.length > 0 ? Math.max(...seasonEps) : 0;
  const targetEps =
    mode === "season"
      ? seasonEps
      : seasonEps.filter((e) => e <= state.activeEpisode);
  if (targetEps.length === 0) return;
  const reqProfileId = state.activeProfileId || "main";

  try {
    const res = await fetch("/api/kinorium/watched-episodes-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        title: item.title,
        orig_title: item.orig_title,
        poster: item.poster,
        backdrop: item.backdrop,
        year: item.year,
        media_type: item.media_type,
        rezka_id: item.rezka_id,
        rezka_url: item.rezka_url,
        season: state.activeSeason,
        episodes: targetEps,
        mark_season_complete: mode === "season",
        total_seasons: totalSeasons,
        total_episodes_in_season: totalEpsInSeason,
        is_series_completed: resolveSeriesCompletedFlag(item),
      }),
    });
    const kStatus = await res.json();
    if (!res.ok || kStatus?.ok === false || kStatus?.error) {
      throw new Error(kStatus?.error || `HTTP ${res.status}`);
    }
    if ((state.activeProfileId || "main") !== reqProfileId) return;
    item.kinorium = kStatus;
    state.catalogDirty = true;
    patchCatalogItemKinoriumInPlace(item, kStatus);
    if (kStatus.kinorium_counts) {
      state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
      updateKinoriumSectionCounters();
    }
    if (state.activeItem && String(state.activeItem.id || "") === String(item.id || "")) {
      updateModalKinoriumHeader(kStatus);
      populateSeasonEpisodeSelectors(item, state.seasonsMap);
      updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);
    }
    pushDesktopRemoteStateNow();
    const kinSuffix = kStatus.remote_synced ? t(" в Kinorium", " on Kinorium") : "";
    if (kStatus.auto_completed_series) {
      state.scrobbledThisSession = true;
      refreshOpenPersonModalUI();
      showToast(
        t(
          `Финал сериала «${displayTitle(item)}» просмотрен — статус изменён с «Смотрю» на «Просмотрено»${kinSuffix}`,
          `Series finale of "${displayTitle(item)}" watched — status changed to Watched${kinSuffix}`
        )
      );
    } else {
      showToast(
        mode === "season"
          ? isEn()
            ? `Season ${state.activeSeason} marked as watched${kinSuffix} (${targetEps.length} ${
                targetEps.length === 1 ? "episode" : "episodes"
              })`
            : `Сезон ${state.activeSeason} отмечен просмотренным${kinSuffix} (${targetEps.length} ${pluralRu(
                targetEps.length,
                "серия",
                "серии",
                "серий"
              )})`
          : t(
              `Отмечены просмотренными${kinSuffix} серии с 1 по ${state.activeEpisode} (Сезон ${state.activeSeason})`,
              `Episodes 1–${state.activeEpisode} (Season ${state.activeSeason}) marked as watched${kinSuffix}`
            )
      );
    }
  } catch (err) {
    showToast(t("Не удалось выполнить пакетную отметку серий", "Could not mark episodes in batch"));
  }
}

export async function toggleCurrentEpisodeWatched() {
  if (!state.activeItem || state.activeItem.media_type !== "series") return;
  const item = state.activeItem;
  const sNum = Number(state.activeSeason) || 1;
  const eNum = Number(state.activeEpisode) || 1;
  const resolvedMap = resolveEffectiveSeasonsMap(item, state.seasonsMap);
  const sKeys = Object.keys(resolvedMap || {})
    .map((k) => parseInt(k, 10))
    .filter((n) => !Number.isNaN(n));
  const totalSeasons = sKeys.length > 0 ? Math.max(...sKeys) : 0;
  const seasonEps = resolvedMap?.[String(sNum)];
  const totalEpsInSeason = Array.isArray(seasonEps) && seasonEps.length > 0 ? Math.max(...seasonEps) : 0;
  const reqProfileId = state.activeProfileId || "main";

  try {
    const res = await fetch("/api/kinorium/episode-watched", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        title: item.title,
        orig_title: item.orig_title,
        poster: item.poster,
        backdrop: item.backdrop,
        year: item.year,
        media_type: item.media_type,
        rezka_id: item.rezka_id,
        rezka_url: item.rezka_url,
        season: sNum,
        episode: eNum,
        total_seasons: totalSeasons,
        total_episodes_in_season: totalEpsInSeason,
        is_series_completed: resolveSeriesCompletedFlag(item),
      }),
    });
    const kStatus = await res.json();
    if (!res.ok || kStatus?.ok === false || kStatus?.error) {
      throw new Error(kStatus?.error || `HTTP ${res.status}`);
    }
    if ((state.activeProfileId || "main") !== reqProfileId) return;
    item.kinorium = kStatus;
    state.catalogDirty = true;
    patchCatalogItemKinoriumInPlace(item, kStatus);
    if (kStatus.kinorium_counts) {
      state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
      updateKinoriumSectionCounters();
    }
    if (state.activeItem && String(state.activeItem.id || "") === String(item.id || "")) {
      updateModalKinoriumHeader(kStatus);
      populateSeasonEpisodeSelectors(item, state.seasonsMap);
      updateCurrentEpisodeBar(item, sNum, eNum, false);
    }
    pushDesktopRemoteStateNow();
    const kinSuffix = kStatus.remote_synced ? t(" в Kinorium", " on Kinorium") : "";
    if (kStatus.auto_completed_series) {
      state.scrobbledThisSession = true;
      refreshOpenPersonModalUI();
      showToast(
        t(
          `Финал сериала «${displayTitle(item)}» просмотрен — статус изменён на «Просмотрено»${kinSuffix}`,
          `Series finale of "${displayTitle(item)}" watched — marked as Watched${kinSuffix}`
        )
      );
    } else if (kStatus.episode_watched) {
      showToast(
        t(
          `Сезон ${sNum}, Серия ${eNum} отмечена просмотренной${kinSuffix}`,
          `Season ${sNum}, Episode ${eNum} marked as watched${kinSuffix}`
        )
      );
    } else {
      showToast(
        t(
          `Отметка просмотра снята${kinSuffix} · Сезон ${sNum}, Серия ${eNum}`,
          `Unmarked as watched${kinSuffix} · Season ${sNum}, Episode ${eNum}`
        )
      );
    }
  } catch (err) {
    showToast(t("Не удалось изменить отметку серии", "Could not update episode watched status"));
  }
}
