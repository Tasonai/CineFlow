import { WATCH_HISTORY_STORAGE_KEY, profileStorageKey, state } from "./state.js?v=20261112v1";
import {
  displayBackdrop,
  displayCountries,
  displayDescription,
  displayPoster,
  displayTitle,
  formatCriticsRating,
  getItemGenreEntries,
  hasCyrillicText,
  isEn,
  mergeIncomingItemGenres,
  secondaryTitle,
  t,
  translateCareer,
  translateStudioName,
  transliterateRuToEn,
} from "./i18n.js?v=20261112v1";
import {
  attachHorizontalWheelScroll,
  bindStarsHoverRange,
  closeCustomSelectMenu,
  cssUrl,
  escapeAttr,
  escapeHtml,
  expandRussianDateText,
  findOfflineDownloadForTitle,
  formatDurationLabel,
  formatTime,
  getSimilarReasonLabel,
  getSimilarSectionSourceLabel,
  getWatchHistoryList,
  iconSvg,
  matchCatalogItemSafe,
  pluralRu,
  rememberModalTriggerFocus,
  resolveClientSimilarBundle,
  restoreModalTriggerFocus,
  showToast,
  syncScrollTopButton,
  syncSearchInputHasQueryUI,
  withKinoriumActionLock,
} from "./utils.js?v=20261112v1";
import {
  attachSmartPosterFallback,
  createPosterCardElement,
} from "./catalog-cards.js?v=20261112v1";
import {
  applyEnabledServicesVisibility,
  getDefaultPlayableSourceTab,
  isEpisodeWatched,
  isServiceEnabled,
  patchCatalogItemKinoriumInPlace,
  resolvePreferredPlayTab,
  resolveSeriesEpisodeInfo,
} from "./catalog-media-resolver.js?v=20261112v1";
import {
  renderCatalogShelves,
  renderContinueWatching,
} from "./catalog-shelves.js?v=20261112v1";
import { renderHero, stopHeroAmbientTeaser } from "./catalog-hero.js?v=20261112v1";
import { getCatalogFranchiseItemsForItem, updateActiveFiltersBadge } from "./catalog-filters.js?v=20261112v1";
import { loadCatalog } from "./catalog.js?v=20261112v1";
import { escapeEpisodeHtml, resolveSeriesCompletedFlag } from "./player-seasons.js?v=20261112v1";
import {
  closePlayerModal,
  openPlayerModal,
} from "./player.js?v=20261112v1";
import { updateBackupSummaryStat } from "./settings.js?v=20261112v1";
import {
  closeStatsModal,
  formatRelativeWatchDate,
  openStatsModal,
  renderWatchHistoryTab,
  switchStatsModalTab,
} from "./modals-stats.js?v=20261112v1";
import {
  buildCastPeopleArray,
  buildFallbackAvatarSvg,
  buildPersonPhotoCard,
  closePersonModal,
  openPersonModal,
  refreshOpenPersonModalUI,
  renderModalCastSection,
  renderPersonFilmographyGrid,
  renderPersonProfileDetails,
  renderPersonStatsStrip,
  syncPersonModalMount,
  triggerPersonSearch,
} from "./modals-person.js?v=20261112v1";

export {
  buildCastPeopleArray,
  buildFallbackAvatarSvg,
  buildPersonPhotoCard,
  closePersonModal,
  closeStatsModal,
  formatRelativeWatchDate,
  openPersonModal,
  openStatsModal,
  refreshOpenPersonModalUI,
  renderModalCastSection,
  renderPersonFilmographyGrid,
  renderPersonProfileDetails,
  renderPersonStatsStrip,
  renderWatchHistoryTab,
  switchStatsModalTab,
  triggerPersonSearch,
};

export function syncModalBackButtons() {
  const top = state.navModalStack[state.navModalStack.length - 1] || null;
  const qpBackBtn = document.getElementById("qp-back-nav-btn");
  const qpBackLbl = document.getElementById("qp-back-nav-label");
  const personBackBtn = document.getElementById("person-back-nav-btn");
  const personBackLbl = document.getElementById("person-back-nav-label");

  if (qpBackBtn && qpBackLbl) {
    if (top && top.view === "person") {
      qpBackLbl.textContent = `${t("Назад", "Back")}: ${top.personName || t("Персона", "Person")}`;
      qpBackBtn.classList.remove("hidden");
    } else if (top && top.view === "quick-peek" && top.item) {
      qpBackLbl.textContent = `${t("Назад", "Back")}: ${displayTitle(top.item) || t("Фильм", "Title")}`;
      qpBackBtn.classList.remove("hidden");
    } else if (top && top.view === "player" && top.item) {
      qpBackLbl.textContent = `${t("К плееру", "Back to Player")}: ${displayTitle(top.item) || t("Фильм", "Title")}`;
      qpBackBtn.classList.remove("hidden");
    } else {
      qpBackBtn.classList.add("hidden");
    }
  }
  if (personBackBtn && personBackLbl) {
    if (top && (top.view === "quick-peek" || top.view === "player") && top.item) {
      personBackLbl.textContent = `${t("Назад", "Back")}: ${displayTitle(top.item) || t("Фильм", "Title")}`;
      personBackBtn.classList.remove("hidden");
    } else {
      personBackBtn.classList.add("hidden");
    }
  }
}
export function goBackInModalStack() {
  const entry = state.navModalStack.pop();
  syncModalBackButtons();
  if (!entry) return false;

  if (entry.view === "person") {
    stopQuickPeekInlineTrailer();
    state.quickPeekReqId += 1;
    document.getElementById("quick-peek-modal")?.classList.add("hidden");
    state.quickPeekItem = null;
    const personModal = document.getElementById("person-modal");
    if (personModal) {
      if (!entry.profileData) {
        openPersonModal(entry.personObj || entry.personName || "", {
          skipStackPush: true,
          restoreActiveRole: entry.activeRole || "all",
          restoreScrollTop: typeof entry.scrollTop === "number" ? entry.scrollTop : 0,
        });
        return true;
      }
      state.personModalPerson = entry.personObj || { name: entry.personName || "" };
      state.personProfileData = entry.profileData;
      state.personActiveRole = entry.activeRole || "all";
      renderPersonProfileDetails(entry.profileData);
      renderPersonFilmographyGrid();
      document.getElementById("person-modal-loading")?.classList.add("hidden");
      const photoEl = document.getElementById("person-modal-photo");
      const pName = entry.profileData?.name || entry.personName || "";
      const bestPhoto = entry.profileData?.photo || entry.personObj?.photo || "";
      if (photoEl) {
        const fallbackSvg = buildFallbackAvatarSvg(pName);
        photoEl.style.backgroundImage = `url("${fallbackSvg}")`;
        photoEl.style.backgroundSize = "cover";
        photoEl.style.backgroundPosition = "center";
        photoEl.onerror = () => {
          photoEl.onerror = null;
          photoEl.src = fallbackSvg;
        };
        photoEl.src = `/api/person-photo?name=${encodeURIComponent(pName)}${
          bestPhoto ? `&url=${encodeURIComponent(bestPhoto)}` : ""
        }&v=2`;
        photoEl.alt = pName;
      }
      const searchBtn = document.getElementById("btn-person-search-catalog");
      if (searchBtn) {
        searchBtn.onclick = () => triggerPersonSearch(pName);
      }
      personModal.classList.remove("hidden");
      syncPersonModalMount();
      syncModalBackButtons();
      requestAnimationFrame(() => {
        const scroller = personModal.querySelector(".atv-person-sheet-scroll");
        if (scroller && typeof entry.scrollTop === "number") {
          scroller.scrollTop = entry.scrollTop;
        }
      });
    }
    syncScrollTopButton();
    return true;
  }

  if (entry.view === "quick-peek" && entry.item) {
    state.personModalReqId += 1;
    document.getElementById("person-modal")?.classList.add("hidden");
    openQuickPeekModal(entry.item, {
      skipStackPush: true,
      restoreScrollTop: typeof entry.scrollTop === "number" ? entry.scrollTop : 0,
    });
    return true;
  }

  if (entry.view === "player") {
    stopQuickPeekInlineTrailer();
    state.personModalReqId += 1;
    state.quickPeekReqId += 1;
    const qpEl = document.getElementById("quick-peek-modal");
    const qpWasOpen = Boolean(qpEl && !qpEl.classList.contains("hidden"));
    document.getElementById("person-modal")?.classList.add("hidden");
    qpEl?.classList.add("hidden");
    syncPersonModalMount();
    syncModalBackButtons();
    syncScrollTopButton();
    maybeResumePlayerAfterOverlay();
    if (qpWasOpen) {
      restoreModalTriggerFocus("quick-peek-modal");
    } else {
      restoreModalTriggerFocus("person-modal");
    }
    return true;
  }
  return false;
}
export function maybePausePlayerForOverlay() {
  if (!state.isPlayerOpen || state.isMiniPlayer || state.isPipBackground) return;
  if (
    state.activeSourceTab !== "hdrezka" &&
    state.activeSourceTab !== "stremio" &&
    state.activeSourceTab !== "backup4k" &&
    state.activeSourceTab !== "offline"
  ) {
    return;
  }
  const video = document.getElementById("native-video");
  if (video && !video.paused && !video.ended) {
    state.pausedByOverlayModal = true;
    try {
      video.pause();
    } catch (err) { window.logDebug?.("Modals", err); }
  }
}
export function maybeResumePlayerAfterOverlay() {
  if (!state.pausedByOverlayModal) return;
  const qpMod = document.getElementById("quick-peek-modal");
  const personMod = document.getElementById("person-modal");
  const rouletteMod = document.getElementById("movie-roulette-modal");
  const paletteMod = document.getElementById("command-palette-modal");
  const qpOpen = Boolean(qpMod && !qpMod.classList.contains("hidden"));
  const personOpen = Boolean(personMod && !personMod.classList.contains("hidden"));
  const rouletteOpen = Boolean(rouletteMod && !rouletteMod.classList.contains("hidden"));
  const paletteOpen = Boolean(paletteMod && !paletteMod.classList.contains("hidden"));
  if (qpOpen || personOpen || rouletteOpen || paletteOpen) return;
  state.pausedByOverlayModal = false;
  if (!state.isPlayerOpen || state.isMiniPlayer || state.isPipBackground) return;
  if (
    state.activeSourceTab !== "hdrezka" &&
    state.activeSourceTab !== "stremio" &&
    state.activeSourceTab !== "backup4k" &&
    state.activeSourceTab !== "offline"
  ) {
    return;
  }
  const video = document.getElementById("native-video");
  if (video && video.paused && !video.ended && video.currentSrc) {
    video.play().catch(() => {});
  }
}
let _qpInlineTrailerAbort = null;
let _qpInlineTrailerData = null;
let _qpInlineTrailerLang = "ru";

export function stopQuickPeekInlineTrailer() {
  if (_qpInlineTrailerAbort) {
    try {
      _qpInlineTrailerAbort.abort();
    } catch (err) { window.logDebug?.("Modals", err); }
    _qpInlineTrailerAbort = null;
  }
  _qpInlineTrailerData = null;
  const stage = document.getElementById("qp-inline-trailer-stage");
  const mount = document.getElementById("qp-inline-trailer-mount");
  if (mount) {
    mount.innerHTML = "";
  }
  if (stage) {
    stage.classList.add("hidden");
  }
  const trBtn = document.getElementById("qp-btn-trailer");
  if (trBtn) {
    trBtn.classList.remove("is-active-trailer");
    trBtn.setAttribute("aria-expanded", "false");
  }
}

function _renderQuickPeekTrailerFrame(data, lang) {
  const stage = document.getElementById("qp-inline-trailer-stage");
  const mount = document.getElementById("qp-inline-trailer-mount");
  const btnRu = document.getElementById("qp-trailer-lang-ru");
  const btnEn = document.getElementById("qp-trailer-lang-en");
  const ytBtn = document.getElementById("qp-trailer-yt-link");
  const closeBtn = document.getElementById("qp-trailer-close-btn");
  if (!stage || !mount || !data) return;

  _qpInlineTrailerLang = lang === "en" ? "en" : "ru";
  if (btnRu) {
    btnRu.textContent = t("Дубляж (RU)", "Russian (RU)");
    btnRu.classList.toggle("active", _qpInlineTrailerLang === "ru");
    btnRu.onclick = () => _renderQuickPeekTrailerFrame(data, "ru");
  }
  if (btnEn) {
    btnEn.textContent = t("Оригинал (EN)", "Original (EN)");
    btnEn.classList.toggle("active", _qpInlineTrailerLang === "en");
    btnEn.onclick = () => _renderQuickPeekTrailerFrame(data, "en");
  }
  if (closeBtn) {
    closeBtn.innerHTML = `${iconSvg("x", 11)}<span>${escapeHtml(t("Свернуть", "Close"))}</span>`;
    closeBtn.onclick = () => stopQuickPeekInlineTrailer();
  }

  const rawEmbedUrl =
    _qpInlineTrailerLang === "en"
      ? data.en_embed_url || data.ru_embed_url || data.embed_url || ""
      : data.ru_embed_url || data.en_embed_url || data.embed_url || "";
  const embedUrl = /^https?:\/\//i.test(String(rawEmbedUrl || "").trim()) ? String(rawEmbedUrl).trim() : "";
  const rawYtUrl =
    _qpInlineTrailerLang === "en"
      ? data.en_youtube_url || data.ru_youtube_url || ""
      : data.ru_youtube_url || data.en_youtube_url || "";
  const ytUrl = /^https?:\/\//i.test(String(rawYtUrl || "").trim()) ? String(rawYtUrl).trim() : "";

  if (ytBtn) {
    if (ytUrl) {
      ytBtn.classList.remove("hidden");
      ytBtn.innerHTML = `${iconSvg("external", 11)}<span>YouTube</span>`;
      ytBtn.onclick = () => window.open(ytUrl, "_blank", "noopener,noreferrer");
    } else {
      ytBtn.classList.add("hidden");
    }
  }

  if (embedUrl) {
    mount.innerHTML = `<iframe class="atv-qp-trailer-iframe" src="${escapeAttr(embedUrl)}" title="${escapeAttr(
      t("Официальный трейлер", "Official Trailer")
    )}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  } else {
    mount.innerHTML = `<div class="atv-qp-trailer-empty">${escapeHtml(
      t("Трейлер временно недоступен для встраивания", "Trailer embed temporarily unavailable")
    )}</div>`;
  }
}

export async function openQuickPeekInlineTrailer(item, lang = "") {
  if (!item) return;
  const stage = document.getElementById("qp-inline-trailer-stage");
  const mount = document.getElementById("qp-inline-trailer-mount");
  const trBtn = document.getElementById("qp-btn-trailer");
  if (!stage || !mount) return;

  if (!stage.classList.contains("hidden") && !lang && _qpInlineTrailerData) {
    stopQuickPeekInlineTrailer();
    return;
  }

  stopHeroAmbientTeaser();
  maybePausePlayerForOverlay();
  const targetLang = lang || (isEn() ? "en" : "ru");

  if (_qpInlineTrailerData && _qpInlineTrailerData._itemKey === String(item.id || item.title || "")) {
    stage.classList.remove("hidden");
    if (trBtn) {
      trBtn.classList.add("is-active-trailer");
      trBtn.setAttribute("aria-expanded", "true");
    }
    _renderQuickPeekTrailerFrame(_qpInlineTrailerData, targetLang);
    return;
  }

  if (_qpInlineTrailerAbort) {
    try {
      _qpInlineTrailerAbort.abort();
    } catch (_) {}
  }
  const abortController = new AbortController();
  _qpInlineTrailerAbort = abortController;

  stage.classList.remove("hidden");
  if (trBtn) {
    trBtn.classList.add("is-active-trailer");
    trBtn.setAttribute("aria-expanded", "true");
  }
  mount.innerHTML = `<div class="atv-qp-trailer-loading">${escapeHtml(
    t("Загрузка официального трейлера...", "Loading official trailer...")
  )}</div>`;
  const closeBtn = document.getElementById("qp-trailer-close-btn");
  if (closeBtn) {
    closeBtn.innerHTML = `${iconSvg("x", 11)}<span>${escapeHtml(t("Свернуть", "Close"))}</span>`;
    closeBtn.onclick = () => stopQuickPeekInlineTrailer();
  }

  try {
    const params = new URLSearchParams({
      id: String(item.id || ""),
      rezka_id: String(item.rezka_id || ""),
      rezka_url: item.rezka_url || "",
      title: item.title || "",
      orig_title: item.orig_title || "",
      year: String(item.year || ""),
      media_type: item.media_type || "movie",
      lang: targetLang,
    });
    const res = await fetch(`/api/trailer?${params.toString()}`, {
      signal: abortController.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (abortController.signal.aborted) return;
    data._itemKey = String(item.id || item.title || "");
    _qpInlineTrailerData = data;
    _renderQuickPeekTrailerFrame(data, targetLang);
  } catch (err) {
    if (err && err.name === "AbortError") return;
    mount.innerHTML = `<div class="atv-qp-trailer-empty">${escapeHtml(
      t("Не удалось загрузить трейлер", "Could not load trailer")
    )}</div>`;
  }
}

let _qpMetaAbortController = null;

export function closeQuickPeekModal(options = {}) {
  if (_qpMetaAbortController) {
    try {
      _qpMetaAbortController.abort();
    } catch (_) {}
    _qpMetaAbortController = null;
  }
  stopQuickPeekInlineTrailer();
  closeCustomSelectMenu({ restoreFocus: false });
  const { clearStack = false, suppressResume = false } = options;
  if (clearStack) {
    state.navModalStack = [];
    syncModalBackButtons();
  } else {
    const top = state.navModalStack[state.navModalStack.length - 1];
    if (top && (top.view === "person" || top.view === "player" || top.view === "quick-peek")) {
      goBackInModalStack();
      return;
    }
  }
  state.quickPeekReqId += 1;
  document.getElementById("quick-peek-modal")?.classList.add("hidden");
  syncPersonModalMount();
  syncModalBackButtons();
  syncScrollTopButton();
  if (
    state.catalogDirty &&
    !(state.isPlayerOpen && !state.isMiniPlayer && !state.isPipBackground)
  ) {
    state.catalogDirty = false;
    renderHero();
    renderContinueWatching();
    renderCatalogShelves({ skipHero: true });
  }
  if (!suppressResume) {
    maybeResumePlayerAfterOverlay();
    restoreModalTriggerFocus("quick-peek-modal");
  }
}
export function renderQuickPeekSeriesStatusChip(item) {
  const chip = document.getElementById("qp-series-status-chip");
  if (!chip) return;
  if (!item || item.media_type !== "series") {
    chip.classList.add("hidden");
    chip.textContent = "";
    chip.classList.remove("is-ended", "is-ongoing");
    return;
  }
  const epInfo = resolveSeriesEpisodeInfo(item);
  const isCompleted = Boolean(
    epInfo.isCompleted || item.is_series_completed || item.kinorium?.is_completed
  );
  chip.classList.remove("hidden");
  chip.classList.toggle("is-ended", isCompleted);
  chip.classList.toggle("is-ongoing", !isCompleted);
  chip.textContent = isCompleted ? t("Завершён", "Ended") : t("Продолжается", "Ongoing");
}
export function renderQuickPeekEpisodes(item, metaObj = null) {
  const wrap = document.getElementById("qp-episodes-wrap");
  if (!wrap) return;
  if (!item || item.media_type !== "series") {
    wrap.classList.add("hidden");
    wrap.innerHTML = "";
    return;
  }
  const live =
    (item.id && state.liveSeriesUpdates?.[item.id]) ||
    (item.kinorium?.kinorium_id && state.liveSeriesUpdates?.[`kin_${item.kinorium.kinorium_id}`]) ||
    (item.title && state.liveSeriesUpdates?.[item.title.trim().toLowerCase()]) ||
    null;
  const seasonsMap =
    metaObj?.seasons_map ||
    item._cachedSeasonsMap ||
    live?.seasons_map ||
    item.seasons_map ||
    {};
  const episodesMeta =
    metaObj?.episodes_meta ||
    item._cachedEpisodesMeta ||
    {};
  const episodesTitles =
    metaObj?.episodes_titles ||
    item._cachedEpisodesTitles ||
    {};

  const seasonNumsSet = new Set();
  Object.keys(seasonsMap || {}).forEach((k) => {
    const n = parseInt(k, 10);
    if (n > 0) seasonNumsSet.add(n);
  });
  Object.keys(episodesMeta || {}).forEach((k) => {
    const n = parseInt(k, 10);
    if (n > 0) seasonNumsSet.add(n);
  });
  const weMap = item.kinorium?.watched_episodes || {};
  Object.keys(weMap || {}).forEach((k) => {
    const n = parseInt(k, 10);
    if (n > 0) seasonNumsSet.add(n);
  });
  const latestS = Number(live?.latest_season || item.kinorium?.latest_season || item.seasons_count || 0);
  if (latestS > 0 && seasonNumsSet.size === 0) {
    for (let s = 1; s <= latestS; s++) seasonNumsSet.add(s);
  }
  const seasonNums = Array.from(seasonNumsSet).sort((a, b) => a - b);
  if (seasonNums.length === 0) {
    wrap.classList.add("hidden");
    wrap.innerHTML = "";
    wrap._lastQpEpSig = "";
    return;
  }

  const epInfo = resolveSeriesEpisodeInfo(item);
  let expandedSeason =
    state.qpExpandedSeason && seasonNums.includes(state.qpExpandedSeason)
      ? state.qpExpandedSeason
      : seasonNums.includes(epInfo.season)
      ? epInfo.season
      : seasonNums[seasonNums.length - 1] || null;

  const buildQpEpSig = (expS) => {
    const smKeys = Object.keys(seasonsMap || {})
      .map((k) => `${k}:${Array.isArray(seasonsMap[k]) ? seasonsMap[k].length : 0}`)
      .join(",");
    const emKeys = Object.keys(episodesMeta || {})
      .map((k) => `${k}:${Object.keys(episodesMeta[k] || {}).length}`)
      .join(",");
    const etKeys = Object.keys(episodesTitles || {})
      .map((k) => `${k}:${Object.keys(episodesTitles[k] || {}).length}`)
      .join(",");
    const weKeys = Object.keys(weMap)
      .map((k) => `${k}:${Array.isArray(weMap[k]) ? weMap[k].join(".") : ""}`)
      .join(",");
    return `${item.id || item.title || ""}|${state.appLang || "ru"}|${seasonNums.join(",")}|${expS || 0}|${smKeys}|${emKeys}|${etKeys}|${weKeys}|${item.kinorium?.watched ? 1 : 0}|${epInfo.season}:${epInfo.episode}:${epInfo.hasNewEpisode ? 1 : 0}`;
  };

  const qpEpSig = buildQpEpSig(expandedSeason);
  if (wrap._lastQpEpSig === qpEpSig && wrap.childElementCount > 0 && !wrap.classList.contains("hidden")) {
    return;
  }
  wrap._lastQpEpSig = qpEpSig;

  wrap.classList.remove("hidden");
  wrap.innerHTML = "";

  const headRow = document.createElement("div");
  headRow.className = "atv-qp-episodes-head";
  headRow.innerHTML = `
    <span class="atv-qp-sublabel">${escapeHtml(t("Сезоны и эпизоды", "Seasons & Episodes"))}</span>
  `;
  wrap.appendChild(headRow);

  const seasonsBar = document.createElement("div");
  seasonsBar.className = "atv-qp-seasons-bar";
  const listContainer = document.createElement("div");
  listContainer.id = "qp-ep-list";
  listContainer.className = "atv-qp-ep-list hidden";

  const renderSeasonList = (sNum) => {
    listContainer.innerHTML = "";
    if (!sNum) {
      listContainer.classList.add("hidden");
      return;
    }
    listContainer.classList.remove("hidden");
    const sKey = String(sNum);
    const releasedArr = Array.isArray(seasonsMap?.[sKey])
      ? seasonsMap[sKey].map((x) => parseInt(x, 10)).filter((n) => n > 0)
      : [];
    const releasedSet = new Set(releasedArr);
    const metaForS = episodesMeta?.[sKey] || {};
    const titlesForS = episodesTitles?.[sKey] || {};
    const watchedArr = Array.isArray(item.kinorium?.watched_episodes?.[sKey])
      ? item.kinorium.watched_episodes[sKey].map((x) => parseInt(x, 10)).filter((n) => n > 0)
      : [];
    const watchedSet = new Set(watchedArr);

    const allEpNumsSet = new Set([...releasedArr, ...watchedArr]);
    Object.keys(metaForS).forEach((ek) => {
      const en = parseInt(ek, 10);
      if (en > 0) allEpNumsSet.add(en);
    });
    if (allEpNumsSet.size === 0) {
      const fallbackCount =
        Number(live?.latest_season) === sNum && Number(live?.latest_episode) > 0
          ? Number(live.latest_episode)
          : Number(item.kinorium?.latest_season) === sNum && Number(item.kinorium?.latest_episode) > 0
          ? Number(item.kinorium.latest_episode)
          : Number(item.episodes_per_season) || 1;
      for (let e = 1; e <= fallbackCount; e++) {
        allEpNumsSet.add(e);
        releasedSet.add(e);
      }
    }
    const allEpNums = Array.from(allEpNumsSet).sort((a, b) => a - b);
    const epListFrag = document.createDocumentFragment();
    const hasExplicitWatchedEpisodes = Boolean(
      item.kinorium?.watched_episodes && Object.keys(item.kinorium.watched_episodes).length > 0
    );
    const isAllWatchedGlobally = Boolean(
      !hasExplicitWatchedEpisodes &&
      ((item.kinorium?.watched && !item.kinorium?.has_new_episode) ||
      (item.kinorium?.watched && !item.kinorium?.watching) ||
      item.kinorium?.all_released_episodes_watched)
    );

    allEpNums.forEach((eNum) => {
      const eKey = String(eNum);
      const mEntry = metaForS[eKey] || {};
      const isFutureMeta = Boolean(mEntry.is_future === true || mEntry.is_released === false);
      const isReleased = !isFutureMeta && (releasedSet.size === 0 || releasedSet.has(eNum));
      const isWatched = Boolean(
        watchedSet.has(eNum) ||
        isEpisodeWatched(item, sNum, eNum) ||
        (isAllWatchedGlobally && isReleased)
      );
      const rawTitle = String(mEntry.title || titlesForS[eKey] || "").trim();
      const origTitle = String(mEntry.orig_title || "").trim();
      const isGeneric = !rawTitle || /^(?:серия|эпизод|episode)\s*\d+$/i.test(rawTitle);
      const cleanTitle = isGeneric ? "" : rawTitle;
      const dispEpTitle = isEn()
        ? (origTitle && !hasCyrillicText(origTitle) ? origTitle : cleanTitle && !hasCyrillicText(cleanTitle) ? cleanTitle : t(`Episode ${eNum}`, `Episode ${eNum}`))
        : cleanTitle || origTitle || t(`Серия ${eNum}`, `Episode ${eNum}`);
      const airDateRaw = expandRussianDateText(mEntry.air_date || "");

      const row = document.createElement("div");
      row.className = `atv-qp-ep-row${isWatched ? " is-watched" : ""}${!isReleased ? " is-unreleased" : ""}`;

      const playArea = document.createElement("button");
      playArea.type = "button";
      playArea.className = "atv-qp-ep-main";
      playArea.disabled = !isReleased;
      const dateBadgeHtml = !isReleased
        ? `<span class="atv-qp-ep-airdate is-future-date">${escapeHtml(
            airDateRaw ? `${t("Выйдет", "Airs")}: ${airDateRaw}` : t("Скоро выйдет", "Upcoming")
          )}</span>`
        : airDateRaw
        ? `<span class="atv-qp-ep-airdate">${escapeHtml(airDateRaw)}</span>`
        : "";
      const isCurNewEp = Boolean(epInfo.hasNewEpisode && epInfo.season === sNum && epInfo.episode === eNum);
      const newEpPill = isCurNewEp
        ? `<span class="atv-qp-ep-new-pill">${iconSvg("bolt", 9)}<span>${t("Новая", "New")}</span></span>`
        : "";
      playArea.innerHTML = `
        <span class="atv-qp-ep-num">${eNum}</span>
        <span class="atv-qp-ep-title">${escapeHtml(dispEpTitle)}</span>
        ${newEpPill}
        ${dateBadgeHtml}
      `;
      if (isReleased) {
        playArea.title = t(`Смотреть: Сезон ${sNum}, Серия ${eNum}`, `Play: Season ${sNum}, Episode ${eNum}`);
        playArea.onclick = () => {
          closeQuickPeekModal({ clearStack: true, suppressResume: true });
          openPlayerModal(item, resolvePreferredPlayTab(item, sNum, eNum), sNum, eNum, 0);
        };
      } else {
        playArea.title = airDateRaw
          ? t(`Серия ещё не вышла (${airDateRaw})`, `Episode not released yet (${airDateRaw})`)
          : t("Серия ещё не вышла", "Episode not released yet");
      }
      row.appendChild(playArea);

      if (isServiceEnabled("kinorium") && isReleased) {
        const watchBtn = document.createElement("button");
        watchBtn.type = "button";
        watchBtn.className = `atv-qp-ep-watch-btn${isWatched ? " active" : ""}`;
        watchBtn.title = isWatched
          ? t("Просмотрено (нажмите, чтобы снять отметку)", "Watched (click to unmark)")
          : t("Отметить серию просмотренной", "Mark episode as watched");
        watchBtn.innerHTML = `${iconSvg("check", 11)}<span>${
          isWatched ? t("Просмотрено", "Watched") : t("Не просмотрено", "Unwatched")
        }</span>`;
        watchBtn.onclick = (ev) => {
          ev.stopPropagation();
          const reqProfileId = state.activeProfileId || "main";
          withKinoriumActionLock(`qp-ep-watch:${item.id}:${sNum}:${eNum}`, watchBtn, async () => {
            const totalSeasons = seasonNums.length > 0 ? Math.max(...seasonNums) : 1;
            const totalEpsInSeason = releasedArr.length > 0 ? Math.max(...releasedArr) : allEpNums.length;
            const res = await fetch("/api/kinorium/episode-watched", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: item.id,
                title: item.title,
                orig_title: item.orig_title,
                year: item.year,
                media_type: "series",
                season: sNum,
                episode: eNum,
                watched: !isWatched,
                episode_title: cleanTitle || origTitle || "",
                total_seasons: totalSeasons,
                total_episodes_in_season: totalEpsInSeason,
                is_series_completed: Boolean(epInfo.isCompleted || metaObj?.is_completed || item.is_series_completed),
              }),
            });
            const kStatus = await res.json();
            if (!res.ok || kStatus?.ok === false || kStatus?.error) {
              throw new Error(kStatus?.error || `HTTP ${res.status}`);
            }
            if ((state.activeProfileId || "main") !== reqProfileId) return;
            item.kinorium = kStatus;
            patchCatalogItemKinoriumInPlace(item, kStatus);
            if (state.quickPeekItem === item) {
              syncQuickPeekStatusesUI(item);
              syncQuickPeekSeasonProgress(item);
              renderQuickPeekSeriesStatusChip(item);
              renderQuickPeekEpisodes(item, metaObj);
              updateQuickPeekPlayButton(item);
            }
          });
        };
        row.appendChild(watchBtn);
      }

      epListFrag.appendChild(row);
    });
    listContainer.appendChild(epListFrag);
  };

  const seasonsBarFrag = document.createDocumentFragment();
  seasonNums.forEach((sNum) => {
    const sKey = String(sNum);
    const releasedArr = Array.isArray(seasonsMap?.[sKey]) ? seasonsMap[sKey] : [];
    const watchedArr = Array.isArray(item.kinorium?.watched_episodes?.[sKey])
      ? item.kinorium.watched_episodes[sKey]
      : [];
    const metaForS = episodesMeta?.[sKey] || {};
    const allEpNumsSet = new Set([...releasedArr, ...watchedArr]);
    Object.keys(metaForS).forEach((ek) => {
      const en = parseInt(ek, 10);
      if (en > 0) allEpNumsSet.add(en);
    });
    if (allEpNumsSet.size === 0) {
      const fallbackCount =
        Number(live?.latest_season) === sNum && Number(live?.latest_episode) > 0
          ? Number(live.latest_episode)
          : Number(item.kinorium?.latest_season) === sNum && Number(item.kinorium?.latest_episode) > 0
          ? Number(item.kinorium.latest_episode)
          : Number(item.episodes_per_season) || 1;
      for (let e = 1; e <= fallbackCount; e++) {
        allEpNumsSet.add(e);
      }
    }
    const allEpNums = Array.from(allEpNumsSet).sort((a, b) => a - b);
    const watchedSet = new Set(watchedArr.map((n) => Number(n) || 0).filter((n) => n > 0));

    const hasExplicitWatchedEpisodes = Boolean(
      item.kinorium?.watched_episodes && Object.keys(item.kinorium.watched_episodes).length > 0
    );
    const isAllWatchedGlobally = Boolean(
      !hasExplicitWatchedEpisodes &&
      ((item.kinorium?.watched && !item.kinorium?.has_new_episode) ||
      (item.kinorium?.watched && !item.kinorium?.watching) ||
      item.kinorium?.all_released_episodes_watched)
    );

    const effectiveWatchedCount = isAllWatchedGlobally
      ? (releasedArr.length || allEpNums.length)
      : allEpNums.filter((eNum) =>
          Boolean(
            watchedSet.has(eNum) ||
            isEpisodeWatched(item, sNum, eNum)
          )
        ).length;

    const totalReleasedCount = releasedArr.length || (allEpNums.length > 0 ? allEpNums.length : 0);
    const btn = document.createElement("button");
    btn.type = "button";
    const isExp = expandedSeason === sNum;
    btn.className = `atv-qp-season-btn${isExp ? " active" : ""}`;
    btn.setAttribute("aria-expanded", isExp ? "true" : "false");
    btn.setAttribute("aria-controls", "qp-ep-list");
    const countSuffix =
      totalReleasedCount > 0
        ? ` (${effectiveWatchedCount}/${totalReleasedCount})`
        : effectiveWatchedCount > 0
        ? ` (${effectiveWatchedCount})`
        : "";
    const labelHtml = `<span>${escapeHtml(t(`Сезон ${sNum}`, `Season ${sNum}`))}${escapeHtml(countSuffix)}</span>`;
    btn._cfLabelHtml = labelHtml;
    btn.innerHTML = `${labelHtml}${iconSvg(isExp ? "chevronUp" : "chevronDown", 11)}`;
    btn.onclick = () => {
      if (expandedSeason === sNum) {
        expandedSeason = null;
        state.qpExpandedSeason = null;
      } else {
        expandedSeason = sNum;
        state.qpExpandedSeason = sNum;
      }
      seasonsBar.querySelectorAll(".atv-qp-season-btn").forEach((b, idx) => {
        const sn = seasonNums[idx];
        const act = sn === expandedSeason;
        b.classList.toggle("active", act);
        b.setAttribute("aria-expanded", act ? "true" : "false");
        if (b._cfLabelHtml) {
          b.innerHTML = `${b._cfLabelHtml}${iconSvg(act ? "chevronUp" : "chevronDown", 11)}`;
        }
      });
      wrap._lastQpEpSig = buildQpEpSig(expandedSeason);
      renderSeasonList(expandedSeason);
    };
    seasonsBarFrag.appendChild(btn);
  });
  seasonsBar.appendChild(seasonsBarFrag);

  wrap.appendChild(seasonsBar);
  attachHorizontalWheelScroll(seasonsBar);
  wrap.appendChild(listContainer);
  if (expandedSeason) {
    renderSeasonList(expandedSeason);
    requestAnimationFrame(() => {
      const actBtn = seasonsBar.querySelector(".atv-qp-season-btn.active");
      if (actBtn) {
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        try {
          actBtn.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest", inline: "center" });
        } catch (err) { window.logDebug?.("Modals", err); }
      }
    });
  }
}
export function syncQuickPeekSeasonProgress(item) {
  const progBox = document.getElementById("qp-season-progress-box");
  const progLabel = document.getElementById("qp-season-prog-label");
  const progPct = document.getElementById("qp-season-prog-pct");
  const progFill = document.getElementById("qp-season-prog-fill");
  if (!progBox || !progLabel || !progPct || !progFill) return;
  if (!item || item.media_type !== "series" || !isServiceEnabled("kinorium")) {
    progBox.classList.add("hidden");
    return;
  }
  const epInfo = resolveSeriesEpisodeInfo(item);
  if (!epInfo.hasSeasonProgress || !epInfo.seasonProgressText) {
    progBox.classList.add("hidden");
    return;
  }
  progLabel.textContent = `${t("Сезон", "Season")} ${epInfo.season} · ${epInfo.seasonProgressText}`;
  progPct.textContent = epInfo.totalSeasonEpisodes > 0 ? `${epInfo.seasonPct}%` : "";
  progFill.style.width = `${epInfo.seasonPct}%`;
  progBox.classList.remove("hidden");
}
export function syncQuickPeekStatusesUI(item) {
  const ks = item?.kinorium || {};
  const curScore = Number(ks.user_rating || 0);
  const hasRemoteWrite = Boolean(
    (state.kinoriumAccount?.connected && state.kinoriumAccount?.has_session_cookie) ||
      ks.remote_synced
  );
  const rateLbl = document.getElementById("qp-rate-label");
  if (rateLbl) {
    if (curScore) {
      rateLbl.innerHTML = hasRemoteWrite
        ? t(
            `Ваша оценка: <span class="atv-inline-icon-label">${iconSvg("star", 11)}<strong>${curScore}/10</strong></span>`,
            `Your rating: <span class="atv-inline-icon-label">${iconSvg("star", 11)}<strong>${curScore}/10</strong></span>`
          )
        : t(
            `Ваша оценка (локально): <span class="atv-inline-icon-label">${iconSvg("star", 11)}<strong>${curScore}/10</strong></span>`,
            `Local rating: <span class="atv-inline-icon-label">${iconSvg("star", 11)}<strong>${curScore}/10</strong></span>`
          );
    } else {
      rateLbl.innerHTML = hasRemoteWrite
        ? t("Ваша оценка", "Your rating")
        : t("Ваша оценка (локально)", "Your rating (local)");
    }
  }
  document.querySelectorAll("#qp-stars button").forEach((b) => {
    const sc = parseInt(b.dataset.score, 10);
    const isSelected = curScore > 0 && sc === curScore;
    b.classList.toggle("active-star", isSelected);
    b.classList.toggle("in-score-range", curScore > 0 && sc < curScore);
    b.setAttribute("aria-pressed", isSelected ? "true" : "false");
    b.setAttribute("aria-label", t(`Оценка ${sc} из 10`, `Rate ${sc} out of 10`));
  });
  const qpClearRateBtn = document.getElementById("qp-clear-rate-btn");
  if (qpClearRateBtn) {
    qpClearRateBtn.classList.toggle("hidden", !(curScore > 0));
  }

  const btnW = document.getElementById("qp-btn-watching");
  const btnWl = document.getElementById("qp-btn-watchlist");
  const btnDone = document.getElementById("qp-btn-watched");
  const btnNev = document.getElementById("qp-btn-never");
  if (btnW) {
    btnW.classList.toggle("active-watching", Boolean(ks.watching));
    btnW.innerHTML = `${iconSvg("play", 12)}<span>${t("Смотрю", "Watching")}</span>${ks.watching ? iconSvg("check", 12) : ""}`;
  }
  if (btnWl) {
    btnWl.classList.remove("active-watched");
    btnWl.classList.toggle("active-watchlist", Boolean(ks.in_watchlist));
    btnWl.innerHTML = `${iconSvg(ks.in_watchlist ? "star" : "plus", 12)}<span>${t("Буду смотреть", "Watchlist")}</span>${ks.in_watchlist ? iconSvg("check", 12) : ""}`;
  }
  if (btnDone) {
    btnDone.classList.toggle("active-watched", Boolean(ks.watched));
    btnDone.innerHTML = `${iconSvg("check", 12)}<span>${t("Просмотрено", "Watched")}</span>`;
  }
  if (btnNev) {
    btnNev.classList.toggle("active-never", Boolean(ks.not_watching));
    btnNev.innerHTML = `${iconSvg("x", 12)}<span>${t("Не смотрю", "Not Interested")}</span>${ks.not_watching ? iconSvg("check", 12) : ""}`;
  }
  syncQuickPeekSeasonProgress(item);
}
export function updateQuickPeekPlayButton(item) {
  if (!item) return;
  const epInfo = resolveSeriesEpisodeInfo(item);
  const primaryTab = resolvePreferredPlayTab(item, epInfo.season, epInfo.episode);
  const playBtn = document.getElementById("qp-btn-play");
  if (!playBtn) return;
  if (primaryTab !== "trailer") {
    let labelText = primaryTab === "offline" ? t("Смотреть офлайн", "Watch Offline") : t("Смотреть", "Watch");
    if (primaryTab !== "offline" && epInfo.allReleasedEpisodesWatched) {
      labelText = t("Смотреть сначала", "Play from Start");
    } else if (primaryTab !== "offline" && epInfo.isMidEpisodeResume) {
      labelText =
        item.media_type === "series"
          ? t(
              `Продолжить · С${epInfo.season}:Э${epInfo.episode}`,
              `Resume · S${epInfo.season}:E${epInfo.episode}`
            )
          : t("Продолжить просмотр", "Resume Watching");
    } else if (primaryTab !== "offline" && item.media_type === "series" && epInfo.hasNewEpisode && epInfo.episodeVerified) {
      labelText = t(
        `Смотреть · С${epInfo.season}:Э${epInfo.episode}`,
        `Watch · S${epInfo.season}:E${epInfo.episode}`
      );
    } else if (primaryTab !== "offline" && item.media_type === "series" && (item.kinorium?.watching || epInfo.watchedInSeasonCount > 0)) {
      labelText = t(
        `Смотреть · С${epInfo.season}:Э${epInfo.episode}`,
        `Watch · S${epInfo.season}:E${epInfo.episode}`
      );
    }
    playBtn.innerHTML = `${iconSvg(primaryTab === "offline" ? "download" : "play", 12)}<span>${labelText}</span>`;
    playBtn.classList.remove("hidden");
  } else {
    playBtn.classList.add("hidden");
  }
  playBtn.onclick = () => {
    closeQuickPeekModal({ clearStack: true, suppressResume: true });
    const info = resolveSeriesEpisodeInfo(item);
    const startS = info.allReleasedEpisodesWatched ? 1 : info.season;
    const startE = info.allReleasedEpisodesWatched ? 1 : info.episode;
    const startCur = info.allReleasedEpisodesWatched ? 0 : info.currentTime;
    openPlayerModal(
      item,
      resolvePreferredPlayTab(item, startS, startE),
      startS,
      startE,
      startCur
    );
  };
}
export async function openQuickPeekModal(item, options = {}) {
  if (!item) return;
  const modal = document.getElementById("quick-peek-modal");
  if (!modal) return;
  const wasQpHidden = modal.classList.contains("hidden");
  if (wasQpHidden) {
    rememberModalTriggerFocus("quick-peek-modal");
  }
  const personMod = document.getElementById("person-modal");
  const personWasOpen = Boolean(personMod && !personMod.classList.contains("hidden"));
  if (!options.skipStackPush) {
    if (personWasOpen) {
      if (state.navModalStack.length >= 12) {
        state.navModalStack.shift();
      }
      const scroller = personMod.querySelector(".atv-person-sheet-scroll");
      state.navModalStack.push({
        view: "person",
        personName:
          state.personProfileData?.name ||
          document.getElementById("person-modal-name")?.textContent ||
          t("Персона", "Person"),
        personObj: state.personModalPerson || null,
        profileData: state.personProfileData,
        activeRole: state.personActiveRole || "all",
        scrollTop: scroller ? scroller.scrollTop : 0,
      });
    } else if (
      !wasQpHidden &&
      state.quickPeekItem &&
      String(state.quickPeekItem.id || state.quickPeekItem.kinorium_id || state.quickPeekItem.title || "") !==
        String(item.id || item.kinorium_id || item.title || "")
    ) {
      if (state.navModalStack.length >= 12) {
        state.navModalStack.shift();
      }
      const prevQpSheet = modal.querySelector(".atv-quickpeek-sheet");
      state.navModalStack.push({
        view: "quick-peek",
        item: state.quickPeekItem,
        scrollTop: prevQpSheet ? prevQpSheet.scrollTop : 0,
      });
    } else if (
      wasQpHidden &&
      state.isPlayerOpen &&
      !state.isMiniPlayer &&
      !state.isPipBackground &&
      state.activeItem
    ) {
      state.navModalStack = [{ view: "player", item: state.activeItem }];
    } else if (wasQpHidden) {
      state.navModalStack = [];
    }
  }
  if (personWasOpen && personMod) {
    state.personModalReqId += 1;
    personMod.classList.add("hidden");
  }
  syncModalBackButtons();
  stopQuickPeekInlineTrailer();
  state.quickPeekItem = item;
  state.quickPeekReqId += 1;
  const reqId = state.quickPeekReqId;

  const posterEl = document.getElementById("qp-poster");
  const qpTitleText = displayTitle(item);
  const qpPosterSrc = displayPoster(item) || item.backdrop || "";
  if (posterEl) {
    posterEl.src = qpPosterSrc;
    posterEl.alt = qpTitleText || "";
    attachSmartPosterFallback(posterEl, qpTitleText, item.year, item.poster);
  }
  const backdropEl = document.getElementById("qp-backdrop");
  if (backdropEl) {
    backdropEl.style.backgroundImage = cssUrl(displayBackdrop(item));
  }

  const renderQpKicker = () => {
    const typeLabel = item.media_type === "series" ? t("Сериал", "Series") : t("Фильм", "Movie");
    const countryLabel = displayCountries(item);
    const genresText = getItemGenreEntries(item)
      .map((g) => g.label)
      .join(" · ");
    const kickerEl = document.getElementById("qp-kicker");
    if (kickerEl) {
      kickerEl.textContent = [typeLabel, item.year, countryLabel, genresText].filter(Boolean).join(" · ");
    }
  };
  renderQpKicker();
  document.getElementById("qp-title").textContent = qpTitleText;
  document.getElementById("qp-orig").textContent = secondaryTitle(item);
  document.getElementById("qp-r-kinorium").textContent =
    item.kinorium?.kinorium_rating || item.ratings?.kinorium || "—";
  document.getElementById("qp-r-imdb").textContent = item.ratings?.imdb || "—";
  const qpCriticsEl = document.getElementById("qp-r-critics");
  if (qpCriticsEl) {
    qpCriticsEl.textContent = formatCriticsRating(item);
  }

  const durChip = document.getElementById("qp-duration-chip");
  if (durChip) {
    const cleanDur = formatDurationLabel(item.duration_label);
    if (cleanDur) {
      durChip.innerHTML = `${iconSvg("clock", 12)}<span>${escapeHtml(cleanDur)}</span>`;
      durChip.classList.remove("hidden");
    } else {
      durChip.classList.add("hidden");
    }
  }

  const setQpDescription = (rawTxt) => {
    const descEl = document.getElementById("qp-description");
    if (!descEl) return;
    const cleanTxt = String(rawTxt || "").trim();
    descEl.textContent = cleanTxt;
    const isLong = cleanTxt.length > 220;
    descEl.classList.toggle("is-clamped", isLong);
    descEl.classList.toggle("is-expandable", isLong);
    if (isLong) {
      descEl.tabIndex = 0;
      descEl.setAttribute("role", "button");
      descEl.setAttribute("aria-expanded", "false");
      descEl.title = t("Нажмите, чтобы развернуть описание", "Click to expand synopsis");
      descEl.onclick = () => {
        const nowClamped = descEl.classList.toggle("is-clamped");
        descEl.setAttribute("aria-expanded", nowClamped ? "false" : "true");
        descEl.title = nowClamped
          ? t("Нажмите, чтобы развернуть описание", "Click to expand synopsis")
          : t("Нажмите, чтобы свернуть описание", "Click to collapse synopsis");
      };
      descEl.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          descEl.click();
        }
      };
    } else {
      descEl.removeAttribute("tabindex");
      descEl.removeAttribute("role");
      descEl.removeAttribute("aria-expanded");
      descEl.removeAttribute("title");
      descEl.onclick = null;
      descEl.onkeydown = null;
    }
  };

  const initQpDesc = displayDescription(item);
  setQpDescription(
    initQpDesc || t("Загрузка полного описания и состава актёров...", "Loading synopsis and cast...")
  );

  syncQuickPeekStatusesUI(item);
  syncQuickPeekSeasonProgress(item);
  renderQuickPeekSeriesStatusChip(item);
  renderQuickPeekEpisodes(item, null);

  const renderQpFriendsList = (frListRaw) => {
    const qpFriendsWrap = document.getElementById("qp-friends-wrap");
    const qpFriendsList = document.getElementById("qp-friends-list");
    if (!qpFriendsWrap || !qpFriendsList) return;
    const frList = isServiceEnabled("kinorium") ? frListRaw || [] : [];
    if (frList.length > 0) {
      qpFriendsList.innerHTML = frList
        .map((f) => {
          const commentText = String(f.comment || "").trim();
          if (commentText) {
            return `<span class="friend-pill has-comment"><span class="friend-pill-head"><span>${escapeHtml(
              f.name
            )}</span> · ${iconSvg("star", 10)}<span>${escapeHtml(
              f.score
            )}</span></span><span class="friend-pill-comment">«${escapeHtml(commentText)}»</span></span>`;
          }
          return `<span class="friend-pill"><span>${escapeHtml(f.name)}</span> · ${iconSvg("star", 10)}<span>${escapeHtml(
            f.score
          )}</span></span>`;
        })
        .join("");
      qpFriendsWrap.classList.remove("hidden");
    } else {
      qpFriendsList.innerHTML = "";
      qpFriendsWrap.classList.add("hidden");
    }
  };
  renderQpFriendsList(item.kinorium?.friends_ratings || []);

  const bindQpHorizontalScrollControls = (rowEl, prevBtnId, nextBtnId) => {
    if (!rowEl) return () => {};
    const prevBtn = document.getElementById(prevBtnId);
    const nextBtn = document.getElementById(nextBtnId);
    const syncState = () => {
      if (!prevBtn || !nextBtn) return;
      const maxScroll = Math.max(0, rowEl.scrollWidth - rowEl.clientWidth);
      prevBtn.disabled = rowEl.scrollLeft <= 4;
      nextBtn.disabled = maxScroll <= 4 || rowEl.scrollLeft >= maxScroll - 4;
    };
    if (prevBtn) {
      prevBtn.onclick = (e) => {
        e.stopPropagation();
        const step = Math.max(220, Math.round(rowEl.clientWidth * 0.76));
        rowEl.scrollBy({ left: -step, behavior: "smooth" });
      };
    }
    if (nextBtn) {
      nextBtn.onclick = (e) => {
        e.stopPropagation();
        const step = Math.max(220, Math.round(rowEl.clientWidth * 0.76));
        rowEl.scrollBy({ left: step, behavior: "smooth" });
      };
    }
    if (!rowEl._cfQpScrollBound) {
      rowEl._cfQpScrollBound = true;
      rowEl.addEventListener("scroll", syncState, { passive: true });
    }
    const scheduleSyncState = () => {
      if (rowEl._cfQpScrollRaf) return;
      rowEl._cfQpScrollRaf = requestAnimationFrame(() => {
        rowEl._cfQpScrollRaf = 0;
        syncState();
      });
    };
    scheduleSyncState();
    return scheduleSyncState;
  };

  const castWrap = document.getElementById("qp-cast-wrap");
  const castRow = document.getElementById("qp-cast-row");
  if (castRow) {
    attachHorizontalWheelScroll(castRow);
  }
  const syncCastScrollNav = bindQpHorizontalScrollControls(
    castRow,
    "qp-cast-scroll-prev",
    "qp-cast-scroll-next"
  );
  const renderQpCast = (metaObj) => {
    if (!castWrap || !castRow) return;
    const people = buildCastPeopleArray(item, metaObj);
    if (people.length === 0) {
      castWrap.classList.add("hidden");
      castRow.innerHTML = "";
      castRow._qpCastSig = "";
      return;
    }
    castWrap.classList.remove("hidden");
    const slicedPeople = people.slice(0, 9);
    const castSig = `${state.appLang || "ru"}|${item.id || item.title || ""}|${slicedPeople.map((p) => `${p.name || ""}:${p.role || ""}:${p.photo || ""}`).join("|")}`;
    if (castRow._qpCastSig === castSig && castRow.children.length > 0) {
      syncCastScrollNav();
      return;
    }
    castRow._qpCastSig = castSig;
    castRow.innerHTML = "";
    slicedPeople.forEach((p) => {
      castRow.appendChild(
        buildPersonPhotoCard(p, (personObj) => {
          openPersonModal(personObj);
        })
      );
    });
    syncCastScrollNav();
  };
  renderQpCast(null);

  const frWrap = document.getElementById("qp-franchise-wrap");
  const frList = document.getElementById("qp-franchise-list");
  const frTitleEl = document.getElementById("qp-franchise-title");
  const frProgressEl = document.getElementById("qp-franchise-progress");

  const extractClientFranchiseKey = (it) => {
    if (!it) return "";
    if (typeof it._baseFranchiseKey === "string") return it._baseFranchiseKey;
    if (it._franchiseKey) return String(it._franchiseKey);
    const raw = String(it.orig_title || it.title || "").trim().toLowerCase().replace(/ё/g, "е");
    if (!raw) {
      it._baseFranchiseKey = "";
      return "";
    }
    let cleaned = raw
      .replace(/\(\s*(?:19|20)\d{2}\s*\)\s*$/i, "")
      .replace(/\s*[:\-–—]\s*(?:part|chapter|volume|часть|глава|фильм)\s+(?:one|two|three|four|five|первая|вторая|третья|четвертая|\d+|[ivx]+).*$/i, "")
      .replace(/\s+(?:part|chapter|часть|глава)\s+(?:one|two|three|four|five|первая|вторая|третья|четвертая|\d+|[ivx]+).*$/i, "")
      .trim();
    if (cleaned.includes(":")) {
      const head = cleaned.split(":")[0].replace(/\s+(?:[2-9]|1[0-5]|ii|iii|iv|v|vi|vii|viii|ix|x)\s*$/i, "").trim();
      if (head.length >= 3 && !["the", "movie", "film", "фильм", "кино", "история"].includes(head)) {
        cleaned = head;
      }
    }
    cleaned = cleaned
      .replace(/\s+(?:[2-9]|1[0-5]|ii|iii|iv|v|vi|vii|viii|ix|x)\s*$/i, "")
      .replace(/^(?:the|a|an)\s+/i, "")
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    const res = cleaned.length >= 3 ? cleaned : "";
    it._baseFranchiseKey = res;
    return res;
  };

  const resolveClientFranchiseItems = () => {
    if (Array.isArray(item._cachedFranchiseItems) && item._cachedFranchiseItems.length >= 2) {
      return item._cachedFranchiseItems;
    }
    const pool = Array.isArray(state.catalogItems) ? state.catalogItems : [];
    const curVer = Number(state.catalogIndexVersion) || 0;
    if (
      Array.isArray(item._cachedClientFranchise) &&
      item._cachedClientFranchiseLen === pool.length &&
      item._cachedClientFranchiseVer === curVer
    ) {
      return item._cachedClientFranchise;
    }
    const rootKey = item._baseFranchiseKey || (item._baseFranchiseKey = extractClientFranchiseKey(item));
    if (!rootKey) {
      item._cachedClientFranchise = [];
      item._cachedClientFranchiseLen = pool.length;
      item._cachedClientFranchiseVer = curVer;
      return [];
    }
    const preGrouped = getCatalogFranchiseItemsForItem(item);
    let matches = [];
    if (Array.isArray(preGrouped)) {
      matches = preGrouped.slice();
    } else {
      const targetType = item.media_type || "movie";
      const seen = new Set();
      pool.forEach((cand) => {
        if (!cand || (cand.media_type || "movie") !== targetType) return;
        const candKey = cand._baseFranchiseKey || (cand._baseFranchiseKey = extractClientFranchiseKey(cand));
        if (candKey !== rootKey) return;
        const dedupKey = `${String(cand.orig_title || cand.title || "").toLowerCase()}|${cand.year || ""}`;
        if (seen.has(dedupKey)) return;
        seen.add(dedupKey);
        matches.push(cand);
      });
    }
    if (matches.length < 2) {
      item._cachedClientFranchise = [];
      item._cachedClientFranchiseLen = pool.length;
      item._cachedClientFranchiseVer = curVer;
      return [];
    }
    matches.sort((a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999));
    const resolvedList = matches.map((m, idx) => ({
      ...m,
      num: idx + 1,
      is_current:
        String(m.id || "") === String(item.id || "") ||
        (String(m.title || "") === String(item.title || "") && String(m.year || "") === String(item.year || "")),
    }));
    item._cachedClientFranchise = resolvedList;
    item._cachedClientFranchiseLen = pool.length;
    item._cachedClientFranchiseVer = curVer;
    return resolvedList;
  };

  const renderQpFranchise = (overrideItems = null) => {
    if (!frWrap || !frList) return;
    const frItems =
      Array.isArray(overrideItems) && overrideItems.length >= 2
        ? overrideItems
        : resolveClientFranchiseItems();
    if (!Array.isArray(frItems) || frItems.length < 2) {
      frWrap.classList.add("hidden");
      frList.innerHTML = "";
      frList._qpFranchiseSig = "";
      return;
    }
    frWrap.classList.remove("hidden");
    if (frTitleEl) {
      frTitleEl.textContent = t("Все части франшизы", "Franchise Chronology");
    }
    const kinOn = isServiceEnabled("kinorium");
    let watchedCount = 0;
    const resolvedFrParts = frItems.map((part) => {
      const matchedCat = matchCatalogItemSafe(state.catalogItems, part);
      const ks = part.kinorium || matchedCat?.kinorium || {};
      if (ks.watched || Number(ks.user_rating || 0) > 0) {
        watchedCount += 1;
      }
      return { part, matchedCat };
    });
    if (frProgressEl) {
      const total = frItems.length;
      if (kinOn && watchedCount > 0) {
        frProgressEl.textContent = t(
          `Просмотрено ${watchedCount} из ${total}`,
          `Watched ${watchedCount} of ${total}`
        );
      } else {
        frProgressEl.textContent = isEn()
          ? `${total} parts`
          : `${total} ${pluralRu(total, "часть", "части", "частей")}`;
      }
    }
    const frSig = `${state.appLang || "ru"}|${kinOn ? 1 : 0}|${item.id || item.title || ""}|${resolvedFrParts.map(({ part, matchedCat }) => {
      const ks = part.kinorium || matchedCat?.kinorium || {};
      return `${part.id || part.title || ""}:${part.year || ""}:${ks.watched ? 1 : 0}:${ks.user_rating || 0}:${ks.in_watchlist ? 1 : 0}`;
    }).join("|")}`;
    if (frList._qpFranchiseSig === frSig && frList.children.length > 0) {
      return;
    }
    frList._qpFranchiseSig = frSig;
    frList.innerHTML = "";
    const frFrag = document.createDocumentFragment();
    resolvedFrParts.forEach(({ part, matchedCat }, idx) => {
      const mergedPart = matchedCat ? { ...matchedCat, ...part, kinorium: part.kinorium || matchedCat.kinorium } : part;
      const partTitle = displayTitle(mergedPart) || part.title || "";
      const partNum = Number(part.num) || idx + 1;
      const partYear = part.year || mergedPart.year || "";
      const ratingVal =
        part.rating ||
        mergedPart.ratings?.kinorium ||
        mergedPart.ratings?.imdb ||
        mergedPart.kinorium?.kinorium_rating ||
        "";
      const ks = mergedPart.kinorium || {};
      const isCurrent = Boolean(
        part.is_current ||
          (item.id && mergedPart.id && String(mergedPart.id) === String(item.id)) ||
          (item.rezka_id && mergedPart.rezka_id && String(mergedPart.rezka_id) === String(item.rezka_id))
      );
      const isWatched = Boolean(ks.watched || Number(ks.user_rating || 0) > 0);
      const userScore = Number(ks.user_rating || 0);

      const row = document.createElement("div");
      row.className = `atv-qp-franchise-row${isCurrent ? " is-current-part" : ""}${isWatched ? " is-watched-part" : ""}`;
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute(
        "aria-label",
        `${partNum}. ${partTitle}${partYear ? ` (${partYear})` : ""}${isCurrent ? ` — ${t("текущая часть", "current part")}` : ""}`
      );

      let statusHtml = "";
      if (isCurrent) {
        statusHtml = `<span class="atv-qp-fr-chip is-current">${escapeHtml(t("Текущая часть", "Current"))}</span>`;
      } else if (kinOn && userScore > 0) {
        statusHtml = `<span class="atv-qp-fr-chip is-rated">${iconSvg("star", 10)}<span>${escapeHtml(userScore)}/10</span></span>`;
      } else if (kinOn && isWatched) {
        statusHtml = `<span class="atv-qp-fr-chip is-watched">${iconSvg("check", 10)}<span>${escapeHtml(t("Просмотрено", "Watched"))}</span></span>`;
      } else if (kinOn && ks.in_watchlist) {
        statusHtml = `<span class="atv-qp-fr-chip is-watchlist">${escapeHtml(t("Буду смотреть", "Watchlist"))}</span>`;
      }

      row.innerHTML = `
        <span class="atv-qp-fr-num">${escapeHtml(partNum)}</span>
        <div class="atv-qp-fr-main">
          <div class="atv-qp-fr-name">${escapeHtml(partTitle)}</div>
          <div class="atv-qp-fr-sub">
            ${partYear ? `<span>${escapeHtml(partYear)}</span>` : ""}
            ${ratingVal ? `<span class="atv-meta-rating">${iconSvg("star", 9)}<span>${escapeHtml(ratingVal)}</span></span>` : ""}
          </div>
        </div>
        <div class="atv-qp-fr-right">
          ${statusHtml}
          <button type="button" class="atv-qp-fr-play-btn" title="${escapeAttr(t("Смотреть эту часть", "Play this part"))}" aria-label="${escapeAttr(t("Смотреть", "Play"))} ${escapeAttr(partTitle)}">
            ${iconSvg("play", 11)}
          </button>
        </div>
      `;

      const playPartBtn = row.querySelector(".atv-qp-fr-play-btn");
      if (playPartBtn) {
        playPartBtn.onclick = (ev) => {
          ev.stopPropagation();
          closeQuickPeekModal({ clearStack: true, suppressResume: true });
          const targetItem = matchedCat || {
            id: mergedPart.id || `rz_${mergedPart.rezka_id || idx}`,
            title: mergedPart.title || partTitle,
            orig_title: mergedPart.orig_title || "",
            year: partYear,
            media_type: mergedPart.media_type || item.media_type || "movie",
            poster: mergedPart.poster || item.poster || "",
            backdrop: mergedPart.backdrop || item.backdrop || "",
            rezka_id: mergedPart.rezka_id || "",
            rezka_url: mergedPart.rezka_url || "",
            ratings: mergedPart.ratings || (ratingVal ? { kinorium: ratingVal } : {}),
            kinorium: ks,
          };
          const info = resolveSeriesEpisodeInfo(targetItem);
          openPlayerModal(
            targetItem,
            resolvePreferredPlayTab(targetItem, info.season, info.episode),
            info.season,
            info.episode,
            info.currentTime
          );
        };
      }

      const activateRow = () => {
        if (isCurrent) return;
        const targetItem = matchedCat || {
          id: mergedPart.id || `rz_${mergedPart.rezka_id || idx}`,
          title: mergedPart.title || partTitle,
          orig_title: mergedPart.orig_title || "",
          year: partYear,
          media_type: mergedPart.media_type || item.media_type || "movie",
          poster: mergedPart.poster || item.poster || "",
          backdrop: mergedPart.backdrop || item.backdrop || "",
          rezka_id: mergedPart.rezka_id || "",
          rezka_url: mergedPart.rezka_url || "",
          ratings: mergedPart.ratings || (ratingVal ? { kinorium: ratingVal } : {}),
          kinorium: ks,
        };
        openQuickPeekModal(targetItem);
      };
      row.onclick = activateRow;
      row.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activateRow();
        }
      };
      frFrag.appendChild(row);
    });
    frList.appendChild(frFrag);
  };
  renderQpFranchise();

  const simWrap = document.getElementById("qp-similar-wrap");
  const simList = document.getElementById("qp-similar-list");
  const simSourceEl = document.getElementById("qp-similar-source");
  if (simList) {
    attachHorizontalWheelScroll(simList);
  }
  const syncSimScrollNav = bindQpHorizontalScrollControls(
    simList,
    "qp-sim-scroll-prev",
    "qp-sim-scroll-next"
  );
  const renderQpSimilar = (overrideItems = null, overrideSource = "") => {
    if (!simWrap || !simList) return;
    let simItems = [];
    let simSource = "curated";
    if (Array.isArray(overrideItems) && overrideItems.length > 0) {
      simItems = overrideItems.slice(0, 10);
      simSource = overrideSource || "kinorium";
    } else {
      const bundle = resolveClientSimilarBundle(item, 8);
      simItems = bundle.items;
      simSource = bundle.source;
    }
    if (simItems.length === 0) {
      simWrap.classList.add("hidden");
      simList.innerHTML = "";
      simList._qpSimilarSig = "";
      return;
    }
    simWrap.classList.remove("hidden");
    if (simSourceEl) {
      simSourceEl.textContent = getSimilarSectionSourceLabel(simSource);
    }
    const kinOn = isServiceEnabled("kinorium");
    const simSig = `${state.appLang || "ru"}|${kinOn ? 1 : 0}|${simSource}|${item.id || item.title || ""}|${simItems.map((s) => `${s.id || s.title || ""}:${s.kinorium?.watched ? 1 : 0}:${s.kinorium?.user_rating || 0}:${s.kinorium?.in_watchlist ? 1 : 0}`).join("|")}`;
    if (simList._qpSimilarSig === simSig && simList.children.length > 0) {
      syncSimScrollNav();
      return;
    }
    simList._qpSimilarSig = simSig;
    simList.innerHTML = "";
    const simFrag = document.createDocumentFragment();
    simItems.forEach((sim) => {
      const matchedCat = matchCatalogItemSafe(state.catalogItems, sim);
      if (matchedCat?.kinorium && !sim.kinorium) {
        sim.kinorium = matchedCat.kinorium;
      }
      const simTitle = displayTitle(sim);
      const simPoster = displayPoster(sim);
      const kRat = kinOn
        ? sim.kinorium?.kinorium_rating || sim.ratings?.kinorium || sim.ratings?.imdb || ""
        : sim.ratings?.imdb || sim.kinorium?.kinorium_rating || "";
      const reasonTxt = getSimilarReasonLabel(sim);
      const metaParts = [];
      if (sim.year) metaParts.push(escapeHtml(sim.year));
      if (kRat) {
        metaParts.push(`<span class="atv-meta-rating">${iconSvg("star", 9)}<span>${escapeHtml(kRat)}</span></span>`);
      }
      const ks = sim.kinorium || {};
      const userScore = Number(ks.user_rating || 0);
      const isWatched = Boolean(ks.watched || userScore > 0);
      const inWatchlist = Boolean(ks.in_watchlist);

      let statusBadgeHtml = "";
      if (kinOn && userScore > 0) {
        statusBadgeHtml = `<span class="atv-qp-sim-status-badge is-rated">${iconSvg("star", 9)}<span>${escapeHtml(userScore)}</span></span>`;
      } else if (kinOn && isWatched) {
        statusBadgeHtml = `<span class="atv-qp-sim-status-badge is-watched">${iconSvg("check", 9)}</span>`;
      }

      const wlBtnHtml = kinOn
        ? `<button type="button" class="atv-qp-sim-wl-btn${inWatchlist ? " is-active" : ""}" title="${escapeAttr(
            inWatchlist ? t("В списке «Буду смотреть»", "In Watchlist") : t("Добавить в «Буду смотреть»", "Add to Watchlist")
          )}" aria-label="${escapeAttr(t("Буду смотреть", "Watchlist"))}">${iconSvg(inWatchlist ? "check" : "plus", 11)}</button>`
        : "";

      const card = document.createElement("div");
      card.className = "atv-qp-sim-card";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.title = reasonTxt ? `${simTitle} · ${reasonTxt}` : simTitle;
      card.innerHTML = `
        <div class="atv-qp-sim-poster-wrap">
          <img class="atv-qp-sim-poster" src="${escapeAttr(simPoster)}" alt="${escapeAttr(simTitle)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
          ${statusBadgeHtml}
          ${wlBtnHtml}
        </div>
        <div class="atv-qp-sim-title">${escapeHtml(simTitle)}</div>
        <div class="atv-qp-sim-meta">${metaParts.join(" · ") || "&nbsp;"}</div>
        ${reasonTxt ? `<div class="atv-qp-sim-reason">${escapeHtml(reasonTxt)}</div>` : ""}
      `;
      attachSmartPosterFallback(card.querySelector("img"), simTitle, sim.year, sim.poster);
      const wlBtn = card.querySelector(".atv-qp-sim-wl-btn");
      if (wlBtn) {
        wlBtn.onclick = (ev) => {
          ev.stopPropagation();
          withKinoriumActionLock(`qp-sim-wl:${sim.id || simTitle}`, wlBtn, async () => {
            const res = await fetch("/api/kinorium/watchlist", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: sim.id,
                title: sim.title,
                orig_title: sim.orig_title,
                poster: sim.poster,
                backdrop: sim.backdrop,
                year: sim.year,
                media_type: sim.media_type || "movie",
              }),
            });
            const updated = await res.json();
            if (!res.ok || updated?.ok === false || updated?.error) {
              throw new Error(updated?.error || `HTTP ${res.status}`);
            }
            sim.kinorium = updated;
            patchCatalogItemKinoriumInPlace(sim, updated);
            const nowWl = Boolean(updated.in_watchlist);
            wlBtn.classList.toggle("is-active", nowWl);
            wlBtn.innerHTML = iconSvg(nowWl ? "check" : "plus", 11);
            showToast(
              nowWl
                ? t(`«${simTitle}» в списке Буду смотреть`, `"${simTitle}" added to Watchlist`)
                : t(`«${simTitle}» убрано из Буду смотреть`, `"${simTitle}" removed from Watchlist`)
            );
          });
        };
      }
      card.onclick = () => {
        openQuickPeekModal(sim);
      };
      card.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openQuickPeekModal(sim);
        }
      };
      simFrag.appendChild(card);
    });
    simList.appendChild(simFrag);
    syncSimScrollNav();
  };
  renderQpSimilar();

  updateQuickPeekPlayButton(item);
  const trBtn = document.getElementById("qp-btn-trailer");
  if (trBtn) {
    trBtn.setAttribute("aria-expanded", "false");
    trBtn.onclick = () => {
      openQuickPeekInlineTrailer(item);
    };
  }
  const stremioBtn = document.getElementById("qp-btn-stremio");
  if (stremioBtn) {
    stremioBtn.onclick = () => {
      closeQuickPeekModal({ clearStack: true, suppressResume: true });
      const info = resolveSeriesEpisodeInfo(item);
      openPlayerModal(item, "stremio", info.season, info.episode, info.currentTime);
    };
  }
  const b4kBtn = document.getElementById("qp-btn-4k");
  if (b4kBtn) {
    b4kBtn.onclick = () => {
      closeQuickPeekModal({ clearStack: true, suppressResume: true });
      const info = resolveSeriesEpisodeInfo(item);
      openPlayerModal(item, "backup4k", info.season, info.episode, info.currentTime);
    };
  }
  const qpOfflineBtn = document.getElementById("qp-btn-offline");
  if (qpOfflineBtn) {
    const epHint = resolveSeriesEpisodeInfo(item);
    const primaryTab = resolvePreferredPlayTab(item, epHint.season, epHint.episode);
    const dlHit =
      findOfflineDownloadForTitle(
        item,
        item.media_type === "series" ? epHint.season : null,
        item.media_type === "series" ? epHint.episode : null
      ) || findOfflineDownloadForTitle(item);
    qpOfflineBtn.classList.toggle("is-saved-offline", Boolean(dlHit && dlHit.status === "completed"));
    if (dlHit && primaryTab !== "offline") {
      const epSuffix =
        dlHit.media_type === "series"
          ? ` · S${dlHit.season || 1}E${dlHit.episode || 1}`
          : "";
      qpOfflineBtn.innerHTML = `${iconSvg("download", 12)}<span>${t("Смотреть офлайн", "Watch Offline")}${escapeHtml(epSuffix)}</span>`;
      qpOfflineBtn.classList.remove("hidden");
      qpOfflineBtn.onclick = () => {
        closeQuickPeekModal({ clearStack: true, suppressResume: true });
        openPlayerModal(
          item,
          "offline",
          dlHit.media_type === "series" ? Number(dlHit.season) || epHint.season : 1,
          dlHit.media_type === "series" ? Number(dlHit.episode) || epHint.episode : 1,
          epHint.currentTime
        );
      };
    } else {
      qpOfflineBtn.classList.add("hidden");
      qpOfflineBtn.onclick = null;
    }
  }

  maybePausePlayerForOverlay();
  const qpKinEnabled = isServiceEnabled("kinorium");
  const qpStremioEnabled = isServiceEnabled("stremio");
  const qpB4kEnabled = isServiceEnabled("backup4k");
  const qpPrimaryPlayTab = getDefaultPlayableSourceTab();
  document.getElementById("qp-score-kinorium")?.classList.toggle("hidden", !qpKinEnabled);
  document.querySelector(".atv-qp-rate-box")?.classList.toggle("hidden", !qpKinEnabled);
  document.getElementById("qp-status-pills")?.classList.toggle("hidden", !qpKinEnabled);
  document
    .getElementById("qp-btn-stremio")
    ?.classList.toggle("hidden", !qpStremioEnabled || qpPrimaryPlayTab === "stremio");
  document
    .getElementById("qp-btn-4k")
    ?.classList.toggle("hidden", !qpB4kEnabled || qpPrimaryPlayTab === "backup4k");
  modal.classList.remove("hidden");
  syncPersonModalMount();
  const qpSheetEl = modal.querySelector(".atv-quickpeek-sheet");
  if (qpSheetEl) {
    qpSheetEl.scrollTo({
      top: typeof options.restoreScrollTop === "number" ? options.restoreScrollTop : 0,
    });
  }
  const scrollFranchiseIntoViewIfRequested = () => {
    if (options.scrollToFranchise && frWrap && !frWrap.classList.contains("hidden")) {
      requestAnimationFrame(() => {
        try {
          frWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (err) { window.logDebug?.("Modals", err); }
      });
    }
  };
  scrollFranchiseIntoViewIfRequested();
  requestAnimationFrame(() => {
    const qpPlayBtn = document.getElementById("qp-btn-play");
    (qpPlayBtn && !qpPlayBtn.classList.contains("hidden")
      ? qpPlayBtn
      : document.getElementById("close-quick-peek-modal")
    )?.focus({ preventScroll: true });
  });
  syncScrollTopButton();

  try {
    const reqLang = state.appLang || "ru";
    const reqProfileId = state.activeProfileId || state.activeProfile?.id || "main";
    const params = new URLSearchParams({
      id: String(item.id || ""),
      rezka_id: String(item.rezka_id || ""),
      item_id: String(item.id || ""),
      kinorium_id: String(item.kinorium_id || item.kinorium?.kinorium_id || ""),
      rezka_url: item.rezka_url || "",
      title: item.title || "",
      orig_title: item.orig_title || "",
      year: String(item.year || ""),
      media_type: item.media_type || "movie",
      lang: reqLang,
    });
    if (_qpMetaAbortController) {
      try {
        _qpMetaAbortController.abort();
      } catch (_) {}
    }
    const metaAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
    _qpMetaAbortController = metaAbort;
    const res = await fetch(
      `/api/title-meta?${params.toString()}`,
      metaAbort ? { signal: metaAbort.signal } : undefined
    );
    if (!res.ok) return;
    const meta = await res.json();
    if (
      reqId !== state.quickPeekReqId ||
      (state.activeProfileId || state.activeProfile?.id || "main") !== reqProfileId
    ) {
      return;
    }
    if (meta.rezka_id) item.rezka_id = meta.rezka_id;
    if (meta.rezka_url) item.rezka_url = meta.rezka_url;
    if (meta.kinorium_id && !item.kinorium_id) item.kinorium_id = meta.kinorium_id;
    if (Array.isArray(meta.providers) && meta.providers.length > 0) {
      const existingProvs = Array.isArray(item.providers) ? item.providers.slice() : [];
      meta.providers.forEach((p) => {
        if (!p || !p.id) return;
        const idx = existingProvs.findIndex((ep) => ep && ep.id === p.id);
        if (idx >= 0) {
          existingProvs[idx] = { ...existingProvs[idx], ...p };
        } else {
          existingProvs.push(p);
        }
      });
      item.providers = existingProvs;
    }
    if (typeof meta.is_completed === "boolean") item.is_series_completed = meta.is_completed;
    if (meta.seasons_map && typeof meta.seasons_map === "object" && Object.keys(meta.seasons_map).length > 0) {
      item._cachedSeasonsMap = meta.seasons_map;
      item.seasons_map = meta.seasons_map;
    }
    if (meta.episodes_meta && typeof meta.episodes_meta === "object" && Object.keys(meta.episodes_meta).length > 0) {
      item._cachedEpisodesMeta = meta.episodes_meta;
    }
    if (meta.episodes_titles && typeof meta.episodes_titles === "object" && Object.keys(meta.episodes_titles).length > 0) {
      item._cachedEpisodesTitles = meta.episodes_titles;
    }
    if (Array.isArray(meta.studios) && meta.studios.length > 0) {
      item.studios = meta.studios;
    }
    if (meta.kinorium_status && typeof meta.kinorium_status === "object") {
      item.kinorium = { ...(item.kinorium || {}), ...meta.kinorium_status };
      syncQuickPeekStatusesUI(item);
      renderQpFriendsList(item.kinorium?.friends_ratings || []);
    }
    syncQuickPeekSeasonProgress(item);
    renderQuickPeekSeriesStatusChip(item);
    renderQuickPeekEpisodes(item, meta);
    updateQuickPeekPlayButton(item);
    if (meta.kinorium_rating != null || meta.ratings?.kinorium != null) {
      const kVal = meta.kinorium_rating ?? meta.ratings?.kinorium;
      item.ratings = { ...(item.ratings || {}), kinorium: kVal };
      const krEl = document.getElementById("qp-r-kinorium");
      if (krEl) krEl.textContent = String(kVal);
    }
    if (meta.imdb_rating != null || meta.ratings?.imdb != null) {
      const imVal = meta.imdb_rating ?? meta.ratings?.imdb;
      item.ratings = { ...(item.ratings || {}), imdb: imVal };
      const imEl = document.getElementById("qp-r-imdb");
      if (imEl) imEl.textContent = String(imVal);
    }
    if (meta.critics_rating != null || meta.ratings?.critics != null) {
      const crVal = meta.critics_rating ?? meta.ratings?.critics;
      item.ratings = { ...(item.ratings || {}), critics: crVal };
      const crEl = document.getElementById("qp-r-critics");
      if (crEl) crEl.textContent = formatCriticsRating(item, crVal);
    }
    if (meta.poster_en) {
      item.poster_en = meta.poster_en;
      if (isEn()) {
        if (posterEl) posterEl.src = displayPoster(item);
        if (backdropEl) backdropEl.style.backgroundImage = cssUrl(displayBackdrop(item));
      }
    }
    if (reqLang === "en") {
      if (meta.description && meta.description.length > 15 && !hasCyrillicText(meta.description)) {
        item.description_en = meta.description;
      }
      if (meta.directors?.length) item.directors_en = meta.directors;
      if (meta.actors?.length) item.actors_en = meta.actors;
      if (meta.cast_people?.length) item.cast_people_en = meta.cast_people;
      if (isEn()) {
        const finalEnDesc = displayDescription(item);
        setQpDescription(finalEnDesc || "Synopsis temporarily unavailable.");
      }
    } else {
      if (meta.description && meta.description.length > 20) {
        item.description = meta.description;
        if (!isEn()) {
          setQpDescription(meta.description);
        }
      } else if (!item.description && !isEn()) {
        setQpDescription("Описание временно недоступно.");
      }
      if (meta.directors?.length) item.directors = meta.directors;
      if (meta.actors?.length) item.actors = meta.actors;
      if (meta.cast_people?.length) item.cast_people = meta.cast_people;
    }
    if (mergeIncomingItemGenres(item, meta)) {
      renderQpKicker();
    }
    if (meta.duration_label) {
      item.duration_label = meta.duration_label;
      const cleanDur = formatDurationLabel(meta.duration_label);
      if (durChip && cleanDur) {
        durChip.innerHTML = `${iconSvg("clock", 12)}<span>${escapeHtml(cleanDur)}</span>`;
        durChip.classList.remove("hidden");
      }
    }
    renderQpCast(meta);
    if (Array.isArray(meta.franchise_items) && meta.franchise_items.length >= 2) {
      item._cachedFranchiseItems = meta.franchise_items;
      renderQpFranchise(meta.franchise_items);
      scrollFranchiseIntoViewIfRequested();
    } else {
      renderQpFranchise();
    }
    if (Array.isArray(meta.similar_items) && meta.similar_items.length > 0) {
      item._cachedSimilarItems = meta.similar_items;
      item._cachedSimilarSource = meta.similar_source || "kinorium";
      renderQpSimilar(meta.similar_items, meta.similar_source);
    } else {
      renderQpSimilar();
    }
  } catch (err) { window.logDebug?.("Modals", err); }
}
export function initQuickPeekBindings() {
  document.getElementById("qp-back-nav-btn")?.addEventListener("click", () => goBackInModalStack());
  document.getElementById("close-quick-peek-modal")?.addEventListener("click", () =>
    closeQuickPeekModal({ clearStack: true })
  );
  document.getElementById("quick-peek-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "quick-peek-modal") {
      closeQuickPeekModal({ clearStack: true });
    }
  });

  const buildQpPayload = (item) => ({
    id: item.id,
    title: item.title,
    orig_title: item.orig_title,
    poster: item.poster,
    backdrop: item.backdrop,
    year: item.year,
    media_type: item.media_type,
    rezka_id: item.rezka_id,
    rezka_url: item.rezka_url,
    is_series_completed: resolveSeriesCompletedFlag(item),
  });

  const qpStarsWrap = document.getElementById("qp-stars");
  bindStarsHoverRange(qpStarsWrap);
  document.querySelectorAll("#qp-stars button").forEach((btn) => {
    btn.onclick = () => {
      const item = state.quickPeekItem;
      if (!item) return;
      const reqProfileId = state.activeProfileId || "main";
      const score = parseInt(btn.dataset.score, 10) || 0;
      const prevKin = item.kinorium ? { ...item.kinorium } : null;
      const optimisticKin = {
        ...(item.kinorium || {}),
        user_rating: score,
        watched: item.media_type === "movie" ? true : Boolean(item.kinorium?.watched),
        in_watchlist: false,
        not_watching: false,
      };
      item.kinorium = optimisticKin;
      syncQuickPeekStatusesUI(item);
      withKinoriumActionLock(`qp-rate:${item.id}`, qpStarsWrap || btn, async () => {
        if ((state.activeProfileId || "main") !== reqProfileId) return;
        try {
          const res = await fetch("/api/kinorium/rate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...buildQpPayload(item),
              score,
              comment: item.kinorium?.comment || "",
            }),
          });
          const updated = await res.json();
          if (!res.ok || updated?.ok === false || updated?.error) {
            throw new Error(updated?.error || `HTTP ${res.status}`);
          }
          if ((state.activeProfileId || "main") !== reqProfileId) return;
          item.kinorium = updated;
          if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
          patchCatalogItemKinoriumInPlace(item, updated);
          const syncNote = updated.remote_synced
            ? t("синхронизировано с Kinorium", "synced to Kinorium")
            : t("сохранено локально", "saved locally");
          showToast(
            t(
              `Оценка ${score}/10 (${syncNote}) · «${displayTitle(item)}»`,
              `Rating ${score}/10 (${syncNote}) · "${displayTitle(item)}"`
            )
          );
        } catch (err) {
          if ((state.activeProfileId || "main") === reqProfileId) {
            item.kinorium = prevKin;
            if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
          }
          throw err;
        }
      });
    };
  });
  const qpClearRateBtn = document.getElementById("qp-clear-rate-btn");
  if (qpClearRateBtn) {
    qpClearRateBtn.onclick = () => {
      const item = state.quickPeekItem;
      if (!item || !item.kinorium?.user_rating) return;
      const reqProfileId = state.activeProfileId || "main";
      withKinoriumActionLock(`qp-rate:${item.id}`, qpClearRateBtn, async () => {
        if ((state.activeProfileId || "main") !== reqProfileId) return;
        const res = await fetch("/api/kinorium/rate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...buildQpPayload(item),
            score: 0,
            clear: true,
          }),
        });
        const updated = await res.json();
        if (!res.ok || updated?.ok === false || updated?.error) {
          throw new Error(updated?.error || `HTTP ${res.status}`);
        }
        if ((state.activeProfileId || "main") !== reqProfileId) return;
        item.kinorium = updated;
        if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
        patchCatalogItemKinoriumInPlace(item, updated);
        showToast(
          t(
            `Оценка удалена для «${displayTitle(item)}»`,
            `Rating removed for "${displayTitle(item)}"`
          )
        );
      });
    };
  }

  const qpBtnWatching = document.getElementById("qp-btn-watching");
  qpBtnWatching?.addEventListener("click", () => {
    const item = state.quickPeekItem;
    if (!item) return;
    const reqProfileId = state.activeProfileId || "main";
    withKinoriumActionLock(`qp-watching:${item.id}`, qpBtnWatching, async () => {
      if ((state.activeProfileId || "main") !== reqProfileId) return;
      const res = await fetch("/api/kinorium/watching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildQpPayload(item)),
      });
      const updated = await res.json();
      if (!res.ok || updated?.ok === false || updated?.error) {
        throw new Error(updated?.error || `HTTP ${res.status}`);
      }
      if ((state.activeProfileId || "main") !== reqProfileId) return;
      item.kinorium = updated;
      if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
      patchCatalogItemKinoriumInPlace(item, updated);
      showToast(
        updated.watching
          ? t(`«${displayTitle(item)}» в разделе Смотрю`, `"${displayTitle(item)}" added to Watching`)
          : t("Убрано из Смотрю", "Removed from Watching"),
        {
          undoText: t("Отменить", "Undo"),
          durationMs: 5000,
          onUndo: () =>
            withKinoriumActionLock(`qp-watching:${item.id}`, qpBtnWatching, async () => {
              if ((state.activeProfileId || "main") !== reqProfileId) return;
              try {
                const uRes = await fetch("/api/kinorium/watching", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(buildQpPayload(item)),
                });
                const uData = await uRes.json();
                if (
                  uRes.ok &&
                  uData?.ok !== false &&
                  !uData?.error &&
                  (state.activeProfileId || "main") === reqProfileId
                ) {
                  item.kinorium = uData;
                  if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
                  patchCatalogItemKinoriumInPlace(item, uData);
                }
              } catch (err) { window.logDebug?.("Modals", err); }
            }),
        }
      );
    });
  });

  const qpBtnWatchlist = document.getElementById("qp-btn-watchlist");
  qpBtnWatchlist?.addEventListener("click", () => {
    const item = state.quickPeekItem;
    if (!item) return;
    const reqProfileId = state.activeProfileId || "main";
    withKinoriumActionLock(`qp-watchlist:${item.id}`, qpBtnWatchlist, async () => {
      if ((state.activeProfileId || "main") !== reqProfileId) return;
      const res = await fetch("/api/kinorium/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildQpPayload(item)),
      });
      const updated = await res.json();
      if (!res.ok || updated?.ok === false || updated?.error) {
        throw new Error(updated?.error || `HTTP ${res.status}`);
      }
      if ((state.activeProfileId || "main") !== reqProfileId) return;
      item.kinorium = updated;
      if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
      patchCatalogItemKinoriumInPlace(item, updated);
      showToast(
        updated.in_watchlist
          ? t(`«${displayTitle(item)}» в Буду смотреть`, `"${displayTitle(item)}" added to Watchlist`)
          : t("Убрано из Буду смотреть", "Removed from Watchlist"),
        {
          undoText: t("Отменить", "Undo"),
          durationMs: 5000,
          onUndo: () =>
            withKinoriumActionLock(`qp-watchlist:${item.id}`, qpBtnWatchlist, async () => {
              if ((state.activeProfileId || "main") !== reqProfileId) return;
              try {
                const uRes = await fetch("/api/kinorium/watchlist", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(buildQpPayload(item)),
                });
                const uData = await uRes.json();
                if (
                  uRes.ok &&
                  uData?.ok !== false &&
                  !uData?.error &&
                  (state.activeProfileId || "main") === reqProfileId
                ) {
                  item.kinorium = uData;
                  if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
                  patchCatalogItemKinoriumInPlace(item, uData);
                }
              } catch (err) { window.logDebug?.("Modals", err); }
            }),
        }
      );
    });
  });

  const qpBtnWatched = document.getElementById("qp-btn-watched");
  qpBtnWatched?.addEventListener("click", () => {
    const item = state.quickPeekItem;
    if (!item) return;
    const reqProfileId = state.activeProfileId || "main";
    withKinoriumActionLock(`qp-watched:${item.id}`, qpBtnWatched, async () => {
      if ((state.activeProfileId || "main") !== reqProfileId) return;
      const curWatched = Boolean(item.kinorium?.watched);
      const res = await fetch("/api/kinorium/watched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildQpPayload(item), watched: !curWatched }),
      });
      const updated = await res.json();
      if (!res.ok || updated?.ok === false || updated?.error) {
        throw new Error(updated?.error || `HTTP ${res.status}`);
      }
      if ((state.activeProfileId || "main") !== reqProfileId) return;
      item.kinorium = updated;
      if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
      patchCatalogItemKinoriumInPlace(item, updated);
      showToast(
        updated.watched
          ? t(`«${displayTitle(item)}» отмечено просмотренным`, `"${displayTitle(item)}" marked as watched`)
          : t("Снята отметка просмотренного", "Unmarked as watched"),
        {
          undoText: t("Отменить", "Undo"),
          durationMs: 5000,
          onUndo: () =>
            withKinoriumActionLock(`qp-watched:${item.id}`, qpBtnWatched, async () => {
              if ((state.activeProfileId || "main") !== reqProfileId) return;
              try {
                const uRes = await fetch("/api/kinorium/watched", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ...buildQpPayload(item), watched: curWatched }),
                });
                const uData = await uRes.json();
                if (
                  uRes.ok &&
                  uData?.ok !== false &&
                  !uData?.error &&
                  (state.activeProfileId || "main") === reqProfileId
                ) {
                  item.kinorium = uData;
                  if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
                  patchCatalogItemKinoriumInPlace(item, uData);
                }
              } catch (err) { window.logDebug?.("Modals", err); }
            }),
        }
      );
    });
  });

  const qpBtnNever = document.getElementById("qp-btn-never");
  qpBtnNever?.addEventListener("click", () => {
    const item = state.quickPeekItem;
    if (!item) return;
    const reqProfileId = state.activeProfileId || "main";
    withKinoriumActionLock(`qp-never:${item.id}`, qpBtnNever, async () => {
      if ((state.activeProfileId || "main") !== reqProfileId) return;
      const res = await fetch("/api/kinorium/never", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildQpPayload(item)),
      });
      const updated = await res.json();
      if (!res.ok || updated?.ok === false || updated?.error) {
        throw new Error(updated?.error || `HTTP ${res.status}`);
      }
      if ((state.activeProfileId || "main") !== reqProfileId) return;
      item.kinorium = updated;
      if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
      patchCatalogItemKinoriumInPlace(item, updated);
      showToast(
        updated.not_watching
          ? t(`«${displayTitle(item)}» в Не буду смотреть`, `"${displayTitle(item)}" added to Won't watch`)
          : t("Убрано из Не буду смотреть", "Removed from Won't watch"),
        {
          undoText: t("Отменить", "Undo"),
          durationMs: 5000,
          onUndo: () =>
            withKinoriumActionLock(`qp-never:${item.id}`, qpBtnNever, async () => {
              if ((state.activeProfileId || "main") !== reqProfileId) return;
              try {
                const uRes = await fetch("/api/kinorium/never", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(buildQpPayload(item)),
                });
                const uData = await uRes.json();
                if (
                  uRes.ok &&
                  uData?.ok !== false &&
                  !uData?.error &&
                  (state.activeProfileId || "main") === reqProfileId
                ) {
                  item.kinorium = uData;
                  if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
                  patchCatalogItemKinoriumInPlace(item, uData);
                }
              } catch (err) { window.logDebug?.("Modals", err); }
            }),
        }
      );
    });
  });
}
