import { WATCH_HISTORY_STORAGE_KEY, profileStorageKey, state } from "./state.js?v=20261104v25";
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
} from "./i18n.js?v=20261104v25";
import {
  attachHorizontalWheelScroll,
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
} from "./utils.js?v=20261104v25";
import {
  attachSmartPosterFallback,
  createPosterCardElement,
} from "./catalog-cards.js?v=20261104v25";
import {
  applyEnabledServicesVisibility,
  getDefaultPlayableSourceTab,
  isEpisodeWatched,
  isServiceEnabled,
  patchCatalogItemKinoriumInPlace,
  resolvePreferredPlayTab,
  resolveSeriesEpisodeInfo,
} from "./catalog-media-resolver.js?v=20261104v25";
import {
  renderCatalogShelves,
  renderContinueWatching,
} from "./catalog-shelves.js?v=20261104v25";
import { renderHero } from "./catalog-hero.js?v=20261104v25";
import { updateActiveFiltersBadge } from "./catalog-filters.js?v=20261104v25";
import { loadCatalog } from "./catalog.js?v=20261104v25";
import { escapeEpisodeHtml } from "./player-seasons.js?v=20261104v25";
import {
  closePlayerModal,
  openPlayerModal,
} from "./player.js?v=20261104v25";
import { updateBackupSummaryStat } from "./settings.js?v=20261104v25";

export function formatRelativeWatchDate(ts) {
  if (!ts) return t("Недавно", "Recently");
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return t("Недавно", "Recently");
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const locale = isEn() ? "en-GB" : "ru-RU";
  const timeStr = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `${t("Сегодня", "Today")}, ${timeStr}`;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `${t("Вчера", "Yesterday")}, ${timeStr}`;
  return d.toLocaleDateString(locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}
export function switchStatsModalTab(tabKey = "analytics") {
  state.statsActiveTab = tabKey === "history" ? "history" : "analytics";
  const tabAn = document.getElementById("stats-tab-analytics");
  const tabHi = document.getElementById("stats-tab-history");
  tabAn?.classList.toggle("active", state.statsActiveTab === "analytics");
  tabAn?.setAttribute("aria-selected", state.statsActiveTab === "analytics" ? "true" : "false");
  if (tabAn) tabAn.tabIndex = state.statsActiveTab === "analytics" ? 0 : -1;
  tabHi?.classList.toggle("active", state.statsActiveTab === "history");
  tabHi?.setAttribute("aria-selected", state.statsActiveTab === "history" ? "true" : "false");
  if (tabHi) tabHi.tabIndex = state.statsActiveTab === "history" ? 0 : -1;
  document.getElementById("stats-modal-body")?.classList.toggle("hidden", state.statsActiveTab !== "analytics");
  document.getElementById("stats-history-body")?.classList.toggle("hidden", state.statsActiveTab !== "history");
  if (state.statsActiveTab === "history") {
    renderWatchHistoryTab();
  }
}
export function renderWatchHistoryTab() {
  const histBody = document.getElementById("stats-history-body");
  if (!histBody) return;

  const histStorageKey = profileStorageKey(WATCH_HISTORY_STORAGE_KEY);
  const hasExplicitHistoryState = (() => {
    try {
      return localStorage.getItem(histStorageKey) !== null;
    } catch (_) {
      return false;
    }
  })();
  let entries = getWatchHistoryList();
  // Seed initial timeline from continueWatching only when local watch history has never been initialized or cleared
  if (
    !hasExplicitHistoryState &&
    entries.length === 0 &&
    Array.isArray(state.continueWatching) &&
    state.continueWatching.length > 0
  ) {
    entries = state.continueWatching.map((cw, idx) => ({
      key: `${cw.id}:seed${idx}`,
      id: cw.id,
      title: cw.title,
      orig_title: cw.orig_title || "",
      year: cw.year || "",
      media_type: cw.media_type || "movie",
      poster: cw.poster || cw.backdrop || "",
      poster_en: cw.poster_en || "",
      kinorium_id: cw.kinorium_id || cw.kinorium?.kinorium_id || "",
      backdrop: cw.backdrop || cw.poster || "",
      backdrop_en: cw.backdrop_en || "",
      imdb_id: cw.imdb_id || "",
      season: cw.season || 1,
      episode: cw.episode || 1,
      current_time: cw.current_time || 0,
      duration: cw.duration || 0,
      pct: Math.round((cw.progress || 0) * 100),
      studio: cw.studio || "HDRezka",
      watched_at: cw.updated_at ? cw.updated_at * 1000 : 0,
    }));
  }

  if (entries.length === 0) {
    histBody.innerHTML = `
      <div class="atv-history-empty">
        <div class="atv-history-empty-icon">${iconSvg("clock", 22)}</div>
        ${t(
          "Хронологическая история просмотров пока пуста.<br/>Откройте любой фильм или сериал — время просмотра, серия и озвучка сохранятся автоматически.",
          "Your watch history is empty.<br/>Open any movie or series — playback position, episode, and audio track are saved automatically."
        )}
      </div>
    `;
    return;
  }

  histBody.innerHTML = `
    <div class="atv-history-toolbar">
      <span class="atv-history-count-note">
        ${t(
          `Последние просмотренные фильмы и серии (${entries.length}) · нажмите для продолжения`,
          `Recently watched movies & episodes (${entries.length}) · click to resume`
        )}
      </span>
      <button type="button" class="atv-btn-secondary atv-btn-xs" id="btn-clear-watch-history">
        ${t("Очистить историю", "Clear History")}
      </button>
    </div>
    <div class="atv-history-list" id="watch-history-list"></div>
  `;

  const clearBtn = document.getElementById("btn-clear-watch-history");
  if (clearBtn) {
    clearBtn.onclick = () => {
      const storageKey = profileStorageKey(WATCH_HISTORY_STORAGE_KEY);
      const backupRaw = localStorage.getItem(storageKey);
      state.deletedWatchHistoryBackup = backupRaw;
      try {
        localStorage.setItem(storageKey, "[]");
      } catch (_) {}
      renderWatchHistoryTab();
      updateBackupSummaryStat();
      showToast(t("История просмотров очищена", "Watch history cleared"), {
        actionLabel: t("Отменить", "Undo"),
        durationMs: 8000,
        onAction: () => {
          try {
            if (state.deletedWatchHistoryBackup !== null) {
              localStorage.setItem(storageKey, state.deletedWatchHistoryBackup);
            } else {
              localStorage.removeItem(storageKey);
            }
          } catch (_) {}
          state.deletedWatchHistoryBackup = null;
          renderWatchHistoryTab();
          updateBackupSummaryStat();
          showToast(t("История просмотров восстановлена", "Watch history restored"));
        },
      });
    };
  }

  const listEl = document.getElementById("watch-history-list");
  entries.forEach((h) => {
    const row = document.createElement("div");
    row.className = "atv-history-row";
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    const catMatch = matchCatalogItemSafe(state.catalogItems, h);
    const enrichedItem = catMatch
      ? {
          ...catMatch,
          ...h,
          orig_title: h.orig_title || catMatch.orig_title || "",
          poster: h.poster || catMatch.poster || catMatch.backdrop || "",
          poster_en: h.poster_en || catMatch.poster_en || "",
          backdrop: h.backdrop || catMatch.backdrop || "",
          backdrop_en: h.backdrop_en || catMatch.backdrop_en || "",
          imdb_id: h.imdb_id || catMatch.imdb_id || "",
          kinorium_id: h.kinorium_id || catMatch.kinorium_id || catMatch.kinorium?.kinorium_id || "",
        }
      : h;
    const hTitle = displayTitle(enrichedItem);
    const epTag =
      h.media_type === "series"
        ? t(`Сезон ${h.season || 1}, Серия ${h.episode || 1} · `, `Season ${h.season || 1}, Episode ${h.episode || 1} · `)
        : "";
    const posTag =
      h.current_time > 10
        ? t(
            `Остановились на ${formatTime(h.current_time)}${h.pct ? ` (${h.pct}%)` : ""}`,
            `Stopped at ${formatTime(h.current_time)}${h.pct ? ` (${h.pct}%)` : ""}`
          )
        : t("Просмотр начат", "Started watching");
    const hPoster = displayPoster(enrichedItem) || enrichedItem.poster || enrichedItem.backdrop || "";
    const yrVal = h.year || catMatch?.year || "";
    const yrHtml = yrVal ? ` <span class="atv-muted-year">(${escapeHtml(yrVal)})</span>` : "";
    row.innerHTML = `
      <img class="atv-history-poster" src="${escapeAttr(hPoster)}" alt="${escapeAttr(hTitle)}" decoding="async" referrerpolicy="no-referrer" />
      <div class="atv-history-info">
        <div class="atv-history-title">${escapeHtml(hTitle)}${yrHtml}</div>
        <div class="atv-history-sub">${escapeHtml(epTag)}${escapeHtml(translateStudioName(h.studio || "HDRezka"))} · ${escapeHtml(posTag)}</div>
      </div>
      <div class="atv-history-time">${escapeHtml(formatRelativeWatchDate(h.watched_at))}</div>
    `;
    attachSmartPosterFallback(
      row.querySelector("img"),
      hTitle,
      yrVal,
      catMatch?.poster_en || catMatch?.poster || h.poster || h.backdrop || ""
    );
    row.onclick = () => {
      closeStatsModal({ suppressFocusRestore: true });
      const catalogMatch =
        matchCatalogItemSafe(state.catalogItems, h) || {
          id: h.id || h.title,
          rezka_id: h.rezka_id || "",
          rezka_url: h.rezka_url || "",
          kinorium_id: h.kinorium_id || "",
          title: h.title,
          orig_title: h.orig_title || h.title,
          year: h.year || "",
          media_type: h.media_type || "movie",
          poster: h.poster,
          poster_en: h.poster_en || "",
          backdrop: h.backdrop || h.poster,
          providers: [{ id: "hdrezka", available: true, quality: "1080p" }],
          kinorium: {},
          ratings: {},
        };
      const offlineHistHit = findOfflineDownloadForTitle(
        catalogMatch,
        catalogMatch.media_type === "series" ? h.season || 1 : null,
        catalogMatch.media_type === "series" ? h.episode || 1 : null
      );
      const useOfflineHist = Boolean(offlineHistHit && typeof navigator !== "undefined" && navigator.onLine === false);
      openPlayerModal(
        catalogMatch,
        useOfflineHist ? "offline" : getDefaultPlayableSourceTab(),
        h.season || 1,
        h.episode || 1,
        h.current_time || 0
      );
    };
    row.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        row.click();
      }
    };
    listEl.appendChild(row);
  });
}
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
    state.quickPeekReqId += 1;
    document.getElementById("quick-peek-modal")?.classList.add("hidden");
    const personModal = document.getElementById("person-modal");
    if (personModal) {
      if (entry.profileData) {
        state.personProfileData = entry.profileData;
        state.personActiveRole = entry.activeRole || "all";
        renderPersonStatsStrip(entry.profileData);
        renderPersonFilmographyGrid();
      }
      personModal.classList.remove("hidden");
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
    state.personModalReqId += 1;
    state.quickPeekReqId += 1;
    document.getElementById("person-modal")?.classList.add("hidden");
    document.getElementById("quick-peek-modal")?.classList.add("hidden");
    syncModalBackButtons();
    syncScrollTopButton();
    maybeResumePlayerAfterOverlay();
    restoreModalTriggerFocus("quick-peek-modal");
    restoreModalTriggerFocus("person-modal");
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
    } catch (_) {}
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
export function closeQuickPeekModal(options = {}) {
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
  syncModalBackButtons();
  syncScrollTopButton();
  if (
    state.catalogDirty &&
    !(state.isPlayerOpen && !state.isMiniPlayer && !state.isPipBackground)
  ) {
    state.catalogDirty = false;
    renderHero();
    renderContinueWatching();
    renderCatalogShelves();
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
    return;
  }

  wrap.classList.remove("hidden");
  wrap.innerHTML = "";

  const headRow = document.createElement("div");
  headRow.className = "atv-qp-episodes-head";
  const epInfo = resolveSeriesEpisodeInfo(item);
  const isCompleted = Boolean(epInfo.isCompleted || item.is_series_completed || item.kinorium?.is_completed);
  const statusBadgeText = isCompleted ? t("Сериал завершён", "Series Ended") : t("Сериал продолжается", "Ongoing Series");
  headRow.innerHTML = `
    <span class="atv-qp-sublabel">${escapeHtml(t("Сезоны и эпизоды", "Seasons & Episodes"))}</span>
    <span class="atv-qp-episodes-status ${isCompleted ? "is-ended" : "is-ongoing"}">${escapeHtml(statusBadgeText)}</span>
  `;
  wrap.appendChild(headRow);

  const seasonsBar = document.createElement("div");
  seasonsBar.className = "atv-qp-seasons-bar";
  const listContainer = document.createElement("div");
  listContainer.id = "qp-ep-list";
  listContainer.className = "atv-qp-ep-list hidden";

  let expandedSeason =
    state.qpExpandedSeason && seasonNums.includes(state.qpExpandedSeason)
      ? state.qpExpandedSeason
      : seasonNums.includes(epInfo.season)
      ? epInfo.season
      : seasonNums[seasonNums.length - 1] || null;

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

    allEpNums.forEach((eNum) => {
      const eKey = String(eNum);
      const mEntry = metaForS[eKey] || {};
      const isFutureMeta = Boolean(mEntry.is_future === true || mEntry.is_released === false);
      const isReleased = !isFutureMeta && (releasedSet.size === 0 || releasedSet.has(eNum));
      const hasExplicitWatchedEpisodes = Boolean(
        item.kinorium?.watched_episodes && Object.keys(item.kinorium.watched_episodes).length > 0
      );
      const isAllWatchedGlobally = Boolean(
        !hasExplicitWatchedEpisodes &&
        ((item.kinorium?.watched && !item.kinorium?.has_new_episode) ||
        (item.kinorium?.watched && !item.kinorium?.watching) ||
        item.kinorium?.all_released_episodes_watched)
      );
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
        watchBtn.onclick = async (ev) => {
          ev.stopPropagation();
          watchBtn.disabled = true;
          try {
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
                is_series_completed: isCompleted,
              }),
            });
            const kStatus = await res.json();
            if (!res.ok || kStatus?.ok === false || kStatus?.error) {
              throw new Error(kStatus?.error || `HTTP ${res.status}`);
            }
            item.kinorium = kStatus;
            syncQuickPeekStatusesUI(item);
            syncQuickPeekSeasonProgress(item);
            renderQuickPeekSeriesStatusChip(item);
            patchCatalogItemKinoriumInPlace(item, kStatus);
            renderQuickPeekEpisodes(item, metaObj);
            updateQuickPeekPlayButton(item);
          } catch (err) {
            watchBtn.disabled = false;
            showToast(err?.message || t("Ошибка синхронизации с Kinorium", "Kinorium sync error"));
          }
        };
        row.appendChild(watchBtn);
      }

      listContainer.appendChild(row);
    });
  };

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
      renderSeasonList(expandedSeason);
    };
    seasonsBar.appendChild(btn);
  });

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
        } catch (_) {}
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
            `Ваша оценка в Kinorium: <span class="atv-inline-icon-label">${iconSvg("star", 11)}<strong>${curScore}/10</strong></span> (нажмите для изменения)`,
            `Your Kinorium rating: <span class="atv-inline-icon-label">${iconSvg("star", 11)}<strong>${curScore}/10</strong></span> (click to change)`
          )
        : t(
            `Ваша локальная оценка: <span class="atv-inline-icon-label">${iconSvg("star", 11)}<strong>${curScore}/10</strong></span> (нажмите для изменения)`,
            `Your local rating: <span class="atv-inline-icon-label">${iconSvg("star", 11)}<strong>${curScore}/10</strong></span> (click to change)`
          );
    } else {
      rateLbl.innerHTML = hasRemoteWrite
        ? t("Быстрая оценка в Kinorium (1–10):", "Quick Rate on Kinorium (1–10):")
        : t("Быстрая оценка (1–10 · локально):", "Quick Rate (1–10 · saved locally):");
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
    btnDone.innerHTML = `${iconSvg("check", 12)}<span>${ks.watched ? t("Просмотрено", "Watched") : t("Отметить просмотренным", "Mark Watched")}</span>`;
  }
  if (btnNev) {
    btnNev.classList.toggle("active-never", Boolean(ks.not_watching));
    btnNev.innerHTML = `${iconSvg("x", 12)}<span>${t("Не буду смотреть", "Not Interested")}</span>${ks.not_watching ? iconSvg("check", 12) : ""}`;
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
      const scroller = personMod.querySelector(".atv-person-sheet-scroll");
      state.navModalStack.push({
        view: "person",
        personName:
          state.personProfileData?.name ||
          document.getElementById("person-modal-name")?.textContent ||
          t("Персона", "Person"),
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
  const qpSheetEl = modal.querySelector(".atv-quickpeek-sheet");
  if (qpSheetEl) {
    qpSheetEl.scrollTop = typeof options.restoreScrollTop === "number" ? options.restoreScrollTop : 0;
  }
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
      durChip.innerHTML = `${iconSvg("clock", 12)}<span>${cleanDur}</span>`;
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

  const castWrap = document.getElementById("qp-cast-wrap");
  const castRow = document.getElementById("qp-cast-row");
  if (castRow) {
    attachHorizontalWheelScroll(castRow);
  }
  const renderQpCast = (metaObj) => {
    if (!castWrap || !castRow) return;
    const people = buildCastPeopleArray(item, metaObj);
    if (people.length === 0) {
      castWrap.classList.add("hidden");
      castRow.innerHTML = "";
      return;
    }
    castWrap.classList.remove("hidden");
    castRow.innerHTML = "";
    people.slice(0, 9).forEach((p) => {
      castRow.appendChild(
        buildPersonPhotoCard(p, (personObj) => {
          openPersonModal(personObj);
        })
      );
    });
  };
  renderQpCast(null);

  const simWrap = document.getElementById("qp-similar-wrap");
  const simList = document.getElementById("qp-similar-list");
  const simSourceEl = document.getElementById("qp-similar-source");
  if (simList) {
    attachHorizontalWheelScroll(simList);
  }
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
      return;
    }
    simWrap.classList.remove("hidden");
    if (simSourceEl) {
      simSourceEl.textContent = getSimilarSectionSourceLabel(simSource);
    }
    simList.innerHTML = "";
    const kinOn = isServiceEnabled("kinorium");
    simItems.forEach((sim) => {
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
      const card = document.createElement("div");
      card.className = "atv-qp-sim-card";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.title = reasonTxt ? `${simTitle} · ${reasonTxt}` : simTitle;
      card.innerHTML = `
        <img class="atv-qp-sim-poster" src="${escapeAttr(simPoster)}" alt="${escapeAttr(simTitle)}" loading="lazy" referrerpolicy="no-referrer" />
        <div class="atv-qp-sim-title">${escapeHtml(simTitle)}</div>
        <div class="atv-qp-sim-meta">${metaParts.join(" · ") || "&nbsp;"}</div>
        ${reasonTxt ? `<div class="atv-qp-sim-reason">${escapeHtml(reasonTxt)}</div>` : ""}
      `;
      attachSmartPosterFallback(card.querySelector("img"), simTitle, sim.year, sim.poster);
      card.onclick = () => {
        openQuickPeekModal(sim);
      };
      card.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openQuickPeekModal(sim);
        }
      };
      simList.appendChild(card);
    });
  };
  renderQpSimilar();

  updateQuickPeekPlayButton(item);
  const trBtn = document.getElementById("qp-btn-trailer");
  if (trBtn) {
    trBtn.onclick = () => {
      closeQuickPeekModal({ clearStack: true, suppressResume: true });
      const info = resolveSeriesEpisodeInfo(item);
      openPlayerModal(item, "trailer", info.season, info.episode, info.currentTime);
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
  applyEnabledServicesVisibility();
  modal.classList.remove("hidden");
  modal.querySelector(".atv-quickpeek-sheet")?.scrollTo({ top: 0 });
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
    const res = await fetch(`/api/title-meta?${params.toString()}`);
    if (!res.ok) return;
    const meta = await res.json();
    if (reqId !== state.quickPeekReqId) return;
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
        durChip.innerHTML = `${iconSvg("clock", 12)}<span>${cleanDur}</span>`;
        durChip.classList.remove("hidden");
      }
    }
    renderQpCast(meta);
    if (Array.isArray(meta.similar_items) && meta.similar_items.length > 0) {
      item._cachedSimilarItems = meta.similar_items;
      item._cachedSimilarSource = meta.similar_source || "kinorium";
      renderQpSimilar(meta.similar_items, meta.similar_source);
    } else {
      renderQpSimilar();
    }
  } catch (_) {}
}
export function closeStatsModal(options = {}) {
  const { suppressFocusRestore = false } = options;
  closeCustomSelectMenu({ restoreFocus: false });
  document.getElementById("stats-modal")?.classList.add("hidden");
  syncScrollTopButton();
  if (!suppressFocusRestore) {
    restoreModalTriggerFocus("stats-modal");
  }
}
export async function openStatsModal(initialTab = "analytics") {
  const modal = document.getElementById("stats-modal");
  const bodyEl = document.getElementById("stats-modal-body");
  const badgeEl = document.getElementById("stats-profile-badge");
  if (!modal || !bodyEl) return;
  const wasHidden = modal.classList.contains("hidden");
  if (wasHidden) {
    rememberModalTriggerFocus("stats-modal");
  }
  modal.classList.remove("hidden");
  if (wasHidden) {
    requestAnimationFrame(() => {
      document.getElementById("close-stats-modal")?.focus({ preventScroll: true });
    });
  }
  syncScrollTopButton();
  if (!isServiceEnabled("kinorium")) {
    switchStatsModalTab("history");
    return;
  }
  switchStatsModalTab(initialTab);
  bodyEl.innerHTML = `<div class="atv-stats-loading-note">${t("Загрузка статистики профиля...", "Loading profile statistics...")}</div>`;

  try {
    const res = await fetch("/api/kinorium/stats");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const st = await res.json();
    if (badgeEl) {
      const profName =
        st.profile_name === "Киноман"
          ? t("Киноман", "Cinephile")
          : st.profile_name || "Kinorium";
      badgeEl.textContent = `${profName}${st.user_id ? " · ID " + st.user_id : ""}`;
    }
    const hist = st.ratings_histogram || {};
    const maxHistCount = Math.max(1, ...Object.values(hist).map((n) => Number(n) || 0));
    const histHtml = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
      .map((score) => {
        const cnt = Number(hist[String(score)] || 0);
        const pct = Math.round((cnt / maxHistCount) * 100);
        return `
          <div class="atv-hist-row">
            <span class="atv-hist-label atv-inline-icon-label">${iconSvg("star", 10)}<span>${score}</span></span>
            <div class="atv-hist-bar-wrap">
              <div class="atv-hist-bar-fill" style="width:${pct}%"></div>
            </div>
            <span class="atv-hist-count">${cnt}</span>
          </div>
        `;
      })
      .join("");

    const dec = st.decades || {};
    const maxDec = Math.max(1, ...Object.values(dec).map((n) => Number(n) || 0));
    const decHtml = Object.entries(dec)
      .map(([label, cnt]) => {
        const pct = Math.round(((Number(cnt) || 0) / maxDec) * 100);
        const dispLabel = label === "До 1990" ? t("До 1990", "Pre-1990") : label;
        return `
          <div class="atv-hist-row">
            <span class="atv-hist-label is-wide">${escapeHtml(dispLabel)}</span>
            <div class="atv-hist-bar-wrap">
              <div class="atv-hist-bar-fill" style="width:${pct}%"></div>
            </div>
            <span class="atv-hist-count">${cnt}</span>
          </div>
        `;
      })
      .join("");

    const friendsHtml =
      (st.friends_comparison || []).length > 0
        ? st.friends_comparison
            .map((f) => {
              const simPct = Number(f.similarity_pct) || 0;
              const tierClass = simPct >= 75 ? "tier-high" : simPct >= 60 ? "tier-mid" : "tier-low";
              const simSub =
                typeof f.similar_count === "number"
                  ? ` · ${t("похожих", "similar")}: ${escapeHtml(f.similar_count)}`
                  : "";
              return `
              <div class="atv-friend-stat-row">
                <div class="atv-friend-stat-info">
                  <div class="atv-friend-stat-name">${escapeHtml(f.name)}</div>
                  <div class="atv-friend-stat-sub">${t("общих оценок", "shared ratings")}: ${escapeHtml(f.common_count)}${simSub}</div>
                </div>
                <div class="atv-friend-stat-metrics">
                  <span class="atv-inline-icon-label atv-friend-avg-score">${iconSvg("star", 11)}<span>${escapeHtml(f.avg_friend_score)}</span></span>
                  <span class="atv-similarity-badge ${tierClass}">${t("Сходство", "Match")} ${escapeHtml(simPct)}%</span>
                </div>
              </div>
            `;
            })
            .join("")
        : `<div class="atv-stats-empty-sub">${t("Нет данных по общим оценкам с друзьями", "No shared ratings with friends yet")}</div>`;

    const rawFavs = st.top_favorites || [];
    const favs = rawFavs.map((fv) => {
      const catMatch = matchCatalogItemSafe(state.catalogItems, fv);
      return catMatch
        ? {
            ...catMatch,
            ...fv,
            poster: catMatch.poster || fv.poster,
            poster_en: catMatch.poster_en || fv.poster_en || "",
            orig_title: catMatch.orig_title || fv.orig_title || fv.title,
          }
        : fv;
    });
    const favsHtml =
      favs.length > 0
        ? `<div class="atv-fav-grid" id="stats-fav-grid">
            ${favs
              .map(
                (fv, idx) => `
                <div class="atv-fav-item" tabindex="0" role="button" data-fav-idx="${idx}" title="${escapeAttr(displayTitle(fv))}${fv.year ? ` (${escapeAttr(fv.year)})` : ""} · ${t("Ваша оценка", "Your rating")} ${escapeAttr(fv.score)}/10">
                  <img src="${escapeAttr(displayPoster(fv))}" alt="${escapeAttr(displayTitle(fv))}" />
                  <div class="atv-fav-item-title">${iconSvg("star", 10)}<span>${escapeHtml(fv.score)} · ${escapeHtml(displayTitle(fv))}</span></div>
                </div>
              `
              )
              .join("")}
          </div>`
        : `<div class="atv-stats-empty-sub">${t("Пока нет оценок 9–10", "No 9–10 ratings yet")}</div>`;

    const moviesCount = st.watched_movies || 0;
    const seriesCount = st.watched_series || 0;
    const hoursCount = st.estimated_hours || 0;
    const daysCount = st.estimated_days || 0;
    const ratedCount = st.rated_count || 0;

    bodyEl.innerHTML = `
      <div class="atv-stats-kpi-grid">
        <div class="atv-stats-kpi">
          <div class="atv-stats-kpi-val">${st.total_watched || 0}</div>
          <div class="atv-stats-kpi-sub">${t(
            `Всего просмотрено · ${moviesCount} ${pluralRu(moviesCount, "фильм", "фильма", "фильмов")} и ${seriesCount} ${pluralRu(seriesCount, "сериал", "сериала", "сериалов")}`,
            `Total watched · ${moviesCount} ${moviesCount === 1 ? "movie" : "movies"} & ${seriesCount} series`
          )}</div>
        </div>
        <div class="atv-stats-kpi">
          <div class="atv-stats-kpi-val">${t(
            `${hoursCount} ${pluralRu(hoursCount, "час", "часа", "часов")}`,
            `${hoursCount} ${hoursCount === 1 ? "hour" : "hours"}`
          )}</div>
          <div class="atv-stats-kpi-sub">${t(
            `Время у экрана · около ${daysCount} суток`,
            `Screen time · ~${daysCount} ${daysCount === 1 ? "day" : "days"}`
          )}</div>
        </div>
        <div class="atv-stats-kpi">
          <div class="atv-stats-kpi-val atv-inline-icon-label">${iconSvg("star", 18)}<span>${st.avg_user_rating || "—"}</span></div>
          <div class="atv-stats-kpi-sub">${t(
            `Ваша средняя оценка (${ratedCount} ${pluralRu(ratedCount, "оценка", "оценки", "оценок")}, Kinorium: ${st.avg_kinorium_rating || "—"})`,
            `Your avg rating (${ratedCount} ${ratedCount === 1 ? "rating" : "ratings"}, Kinorium avg: ${st.avg_kinorium_rating || "—"})`
          )}</div>
        </div>
        <div class="atv-stats-kpi">
          <div class="atv-stats-kpi-val">${st.watching_count || 0} / ${st.watchlist_count || 0}</div>
          <div class="atv-stats-kpi-sub">${t("Смотрю сейчас / Буду смотреть", "Watching Now / Watchlist")}</div>
        </div>
      </div>

      <div class="atv-stats-columns">
        <div class="atv-stats-card">
          <h4>${t("Распределение ваших оценок (10 – 1)", "Your Ratings Distribution (10 – 1)")}</h4>
          ${histHtml}
        </div>
        <div class="atv-stats-card">
          <h4>${t("Просмотрено по десятилетиям", "Watched by Decade")}</h4>
          ${decHtml}
          <h4 class="atv-stats-subhead">${t("Совпадение вкусов с друзьями Kinorium", "Taste Match with Kinorium Friends")}</h4>
          ${friendsHtml}
        </div>
      </div>

      <div class="atv-stats-card">
        <h4>${t("Ваши любимые фильмы и сериалы (9–10 · клик для просмотра)", "Your Top Favorites (9–10 · click to open)")}</h4>
        ${favsHtml}
      </div>
    `;

    bodyEl.querySelectorAll(".atv-fav-item").forEach((el) => {
      const idx = parseInt(el.getAttribute("data-fav-idx"), 10);
      const fv = favs[idx];
      if (!fv) return;
      attachSmartPosterFallback(el.querySelector("img"), displayTitle(fv), fv.year, fv.poster);
      el.onclick = () => {
        closeStatsModal({ suppressFocusRestore: true });
        const matchedFav =
          matchCatalogItemSafe(state.catalogItems, fv) || {
            id: fv.id,
            kinorium_id: fv.kinorium_id || "",
            title: fv.title,
            orig_title: fv.orig_title || fv.title,
            year: fv.year || "",
            media_type: fv.media_type || "movie",
            poster: fv.poster,
            poster_en: fv.poster_en || "",
            backdrop: fv.poster,
            kinorium: {
              watched: true,
              user_rating: fv.score,
              kinorium_rating: fv.kinorium_rating || null,
            },
            ratings: {
              kinorium: fv.kinorium_rating || null,
              imdb: fv.imdb_rating || fv.kinorium_rating || null,
            },
            providers: [{ id: "hdrezka", available: true, quality: "1080p" }],
          };
        openQuickPeekModal(matchedFav);
      };
      el.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          el.click();
        }
      };
    });
  } catch (err) {
    bodyEl.innerHTML = `<div class="atv-error-note">${t("Не удалось загрузить статистику профиля", "Failed to load profile statistics")}</div>`;
  }
}
export function triggerPersonSearch(personName) {
  if (!personName) return;
  closePersonModal({ clearStack: true, suppressResume: true });
  closeQuickPeekModal({ clearStack: true, suppressResume: true });
  if (state.isPlayerOpen) {
    closePlayerModal(true);
  }
  document.getElementById("search-live-popover")?.classList.add("hidden");
  state.searchQuery = personName;
  state.kinoriumSection = "all";
  state.providerFilter = "all";
  state.mediaTypeFilter = "all";
  state.genreFilter = "all";
  state.yearFilter = "all";
  state.friendsFilter = false;
  state.selectedFriend = "all";
  const searchInput = document.getElementById("global-search");
  if (searchInput) searchInput.value = personName;
  const gSel = document.getElementById("select-catalog-genre");
  if (gSel) gSel.value = "all";
  const ySel = document.getElementById("select-catalog-year");
  if (ySel) ySel.value = "all";
  const fSel = document.getElementById("select-friend-filter");
  if (fSel) fSel.value = "all";
  document.getElementById("btn-friends-filter")?.classList.remove("active");
  syncSearchInputHasQueryUI();
  document.querySelectorAll(".kin-sec-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.ksec === "all");
  });
  document.querySelectorAll(".atv-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.provider === "all");
  });
  document.querySelectorAll(".type-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.type === "all");
  });
  updateActiveFiltersBadge();
  loadCatalog();
  showToast(`${t("Поиск фильмов и сериалов", "Searching movies & series")}: ${personName}`);
}
export function buildFallbackAvatarSvg(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials =
    parts
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || "")
      .join("") || "CF";
  const safeInit = initials.replace(/[<>&"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160"><rect width="120" height="160" fill="#1c1c1e"/><text x="60" y="90" fill="#f5f5f7" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="36" font-weight="600" text-anchor="middle">${safeInit}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function normalizePersonForLang(p) {
  if (!p || !isEn()) return p;
  const rawName = String(p.name || "").trim();
  if (!rawName) return p;
  const enName = p.orig_name && !hasCyrillicText(p.orig_name)
    ? String(p.orig_name).trim()
    : hasCyrillicText(rawName)
    ? transliterateRuToEn(rawName)
    : rawName;
  return {
    ...p,
    name: enName,
    ru_name: p.ru_name || (hasCyrillicText(rawName) ? rawName : ""),
  };
}
export function buildCastPeopleArray(item, streamData = null) {
  const richSource = isEn()
    ? (streamData?.cast_people && !streamData.cast_people.some((p) => hasCyrillicText(p?.name)))
      ? streamData.cast_people
      : item?.cast_people_en || streamData?.cast_people || item?.cast_people || []
    : streamData?.cast_people || item?.cast_people || streamData?.cast_people_en || item?.cast_people_en || [];
  if (Array.isArray(richSource) && richSource.length > 0) {
    return isEn() ? richSource.map(normalizePersonForLang) : richSource;
  }
  const directors = isEn()
    ? streamData?.directors_en || item?.directors_en || streamData?.directors || item?.directors || []
    : streamData?.directors || item?.directors || streamData?.directors_en || item?.directors_en || [];
  const actors = isEn()
    ? streamData?.actors_en || item?.actors_en || streamData?.actors || item?.actors || []
    : streamData?.actors || item?.actors || streamData?.actors_en || item?.actors_en || [];
  const out = [];
  const seen = new Set();
  directors.slice(0, 3).forEach((d) => {
    const raw = String(d || "").trim();
    const disp = isEn() && hasCyrillicText(raw) ? transliterateRuToEn(raw) : raw;
    const key = disp.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      name: disp,
      ru_name: hasCyrillicText(raw) ? raw : "",
      role: isEn() ? "Director" : "Режиссёр",
      is_director: true,
      photo: "",
    });
  });
  actors.slice(0, 10).forEach((a) => {
    const raw = String(a || "").trim();
    const disp = isEn() && hasCyrillicText(raw) ? transliterateRuToEn(raw) : raw;
    const key = disp.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      name: disp,
      ru_name: hasCyrillicText(raw) ? raw : "",
      role: isEn() ? "Cast" : "В ролях",
      is_director: false,
      photo: "",
    });
  });
  return out;
}
export function buildPersonPhotoCard(personObj, onSelect) {
  const pName = personObj?.name || "";
  const isDir = Boolean(personObj?.is_director);
  const rawRole = isDir ? "Режиссёр" : personObj?.role || "В ролях";
  const roleText = isDir
    ? t("Режиссёр", "Director")
    : rawRole === "В ролях" || rawRole === "Актёр" || rawRole === "Cast"
    ? t("В ролях", "Cast")
    : translateCareer(rawRole);
  const hintUrl = personObj?.photo || "";
  const lookupName = personObj?.ru_name || pName;
  const photoEndpoint = `/api/person-photo?name=${encodeURIComponent(lookupName)}${
    hintUrl ? `&url=${encodeURIComponent(hintUrl)}` : ""
  }`;

  const fallbackAvatarUri = buildFallbackAvatarSvg(pName);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `atv-person-card${isDir ? " director" : ""}`;
  btn.title = `${isDir ? t("Режиссёр", "Director") : t("Актёр", "Actor")}: ${pName} — ${t("нажмите, чтобы открыть карточку персоны и фильмографию", "click to view profile & filmography")}`;
  btn.innerHTML = `
    <img class="atv-person-avatar" src="${escapeAttr(photoEndpoint)}" alt="${escapeAttr(pName)}" loading="lazy" referrerpolicy="no-referrer" />
    <div class="atv-person-name">${escapeHtml(pName)}</div>
    <div class="atv-person-role">${escapeHtml(roleText)}</div>
  `;
  const imgEl = btn.querySelector("img");
  if (imgEl) {
    imgEl.style.backgroundImage = `url("${fallbackAvatarUri}")`;
    imgEl.style.backgroundSize = "cover";
    imgEl.style.backgroundPosition = "center";
    imgEl.onerror = () => {
      imgEl.onerror = null;
      imgEl.src = fallbackAvatarUri;
    };
  }
  btn.onclick = () => {
    if (typeof onSelect === "function") {
      onSelect(personObj);
    } else {
      openPersonModal(personObj);
    }
  };
  return btn;
}
export function closePersonModal(options = {}) {
  closeCustomSelectMenu({ restoreFocus: false });
  const { clearStack = true, suppressResume = false } = options;
  if (!clearStack) {
    const top = state.navModalStack[state.navModalStack.length - 1];
    if (top && (top.view === "quick-peek" || top.view === "player")) {
      goBackInModalStack();
      return;
    }
  }
  state.navModalStack = [];
  state.personModalReqId += 1;
  document.getElementById("person-modal")?.classList.add("hidden");
  syncModalBackButtons();
  syncScrollTopButton();
  if (!suppressResume) {
    maybeResumePlayerAfterOverlay();
    restoreModalTriggerFocus("person-modal");
  }
}
export function renderPersonStatsStrip(data) {
  const statsBox = document.getElementById("person-kinorium-stats");
  const statsWatchedEl = document.getElementById("person-stats-watched");
  const statsRatingEl = document.getElementById("person-stats-rating");
  const statsFillEl = document.getElementById("person-stats-fill");
  if (!statsBox || !statsWatchedEl || !statsRatingEl || !statsFillEl || !data) return;

  const allItems = Array.isArray(data.all_items) ? data.all_items : [];
  const totalCount = allItems.length || Number(data.stats?.total_count || 0);
  if (!isServiceEnabled("kinorium") || totalCount <= 0) {
    statsBox.classList.add("hidden");
    return;
  }

  let watchedCount = 0;
  let watchingCount = 0;
  let watchlistCount = 0;
  const userScores = [];
  allItems.forEach((it) => {
    const ks = it.kinorium || {};
    if (ks.watched) watchedCount += 1;
    if (ks.watching) watchingCount += 1;
    if (ks.in_watchlist) watchlistCount += 1;
    if (ks.user_rating) userScores.push(Number(ks.user_rating));
  });
  const watchedPct = Math.min(100, Math.round((watchedCount / totalCount) * 100));
  const avgUserRating =
    userScores.length > 0
      ? Math.round((userScores.reduce((a, b) => a + b, 0) / userScores.length) * 10) / 10
      : null;

  const extraParts = [];
  if (watchingCount > 0) extraParts.push(`${t("Смотрю", "Watching")}: ${watchingCount}`);
  if (watchlistCount > 0) extraParts.push(`${t("Буду смотреть", "Watchlist")}: ${watchlistCount}`);
  const extraSuffix = extraParts.length > 0 ? ` · ${extraParts.join(" · ")}` : "";
  statsWatchedEl.innerHTML = `<span class="atv-inline-icon-label">${iconSvg("check", 12)}<span>${t(
    `Просмотрено в Kinorium: ${watchedCount} из ${totalCount} (${watchedPct}%)`,
    `Watched on Kinorium: ${watchedCount} of ${totalCount} (${watchedPct}%)`
  )}${extraSuffix}</span></span>`;
  statsRatingEl.innerHTML = avgUserRating
    ? `<span class="atv-inline-icon-label"><span>${t("Ваша средняя оценка:", "Your avg rating:")}</span>${iconSvg("star", 11)}<strong>${avgUserRating}</strong><span>(${userScores.length})</span></span>`
    : t("Ваших оценок пока нет", "No user ratings yet");
  statsFillEl.style.width = `${watchedPct}%`;
  statsBox.classList.remove("hidden");
}
function formatBirthDateForLang(rawDate) {
  const cleaned = expandRussianDateText(rawDate);
  if (!isEn() || !cleaned) return cleaned;
  const monthMap = {
    января: "January",
    февраля: "February",
    марта: "March",
    апреля: "April",
    мая: "May",
    июня: "June",
    июля: "July",
    августа: "August",
    сентября: "September",
    октября: "October",
    ноября: "November",
    декабря: "December",
  };
  let s = cleaned;
  Object.entries(monthMap).forEach(([ruM, enM]) => {
    s = s.replace(new RegExp(ruM, "gi"), enM);
  });
  s = s
    .replace(/\bгода\b/gi, "")
    .replace(/\(\s*(\d+)\s*(?:год|года|лет)\s*\)/gi, "($1)")
    .replace(/\s{2,}/g, " ")
    .trim();
  return hasCyrillicText(s) ? "" : s;
}
export function renderPersonProfileDetails(data) {
  if (!data) return;
  const careerEl = document.getElementById("person-modal-career");
  const nameEl = document.getElementById("person-modal-name");
  const origEl = document.getElementById("person-modal-orig");
  const metaEl = document.getElementById("person-modal-meta");
  const bioEl = document.getElementById("person-modal-bio");

  if (nameEl) {
    if (isEn()) {
      const enName =
        data.orig_name ||
        (!hasCyrillicText(data.name) ? data.name : transliterateRuToEn(data.name || ""));
      if (enName) nameEl.textContent = enName;
    } else if (data.name) {
      nameEl.textContent = data.name;
    }
  }
  if (origEl) {
    origEl.textContent = isEn() ? "" : data.orig_name || "";
  }
  if (careerEl) {
    const cList =
      Array.isArray(data.career) && data.career.length > 0
        ? data.career.map(translateCareer).join(" · ")
        : "";
    if (cList) careerEl.textContent = cList;
  }

  if (metaEl) {
    const chips = [];
    if (data.birth_date) {
      const bDate = formatBirthDateForLang(data.birth_date);
      if (bDate) {
        chips.push(`${iconSvg("calendar", 12)}<span>${escapeEpisodeHtml(bDate)}</span>`);
      }
    }
    if (data.birth_place && (!isEn() || !/[А-Яа-яЁё]/.test(data.birth_place))) {
      chips.push(`${iconSvg("pin", 12)}<span>${escapeEpisodeHtml(data.birth_place)}</span>`);
    }
    const totalWorks = Number(data.stats?.total_count || data.all_items?.length || 0);
    if (totalWorks > 0) {
      chips.push(`${iconSvg("film", 12)}<span>${t("Тайтлов в базе", "Titles")}: ${totalWorks}</span>`);
    }
    metaEl.innerHTML = chips
      .map((c) => `<span class="atv-person-chip atv-inline-icon-label">${c}</span>`)
      .join("");
  }

  if (bioEl) {
    const activeBio = isEn() ? data.bio_en || "" : data.bio || data.bio_en || "";
    if (activeBio && String(activeBio).trim().length > 15) {
      bioEl.textContent = activeBio;
      bioEl.classList.remove("hidden");
    } else {
      bioEl.textContent = "";
      bioEl.classList.add("hidden");
    }
  }

  renderPersonStatsStrip(data);
}
export function refreshOpenPersonModalUI(langChanged = false) {
  const modal = document.getElementById("person-modal");
  if (!modal || modal.classList.contains("hidden") || !state.personProfileData) return;
  if (langChanged) {
    const cur = state.personProfileData;
    openPersonModal(
      {
        name: isEn() ? cur.orig_name || cur.name : cur.ru_name || cur.name,
        ru_name: cur.ru_name || "",
        person_url: cur.person_url || "",
        photo: cur.photo || "",
      },
      { skipStackPush: true }
    );
    return;
  }
  renderPersonProfileDetails(state.personProfileData);
  renderPersonFilmographyGrid();
}
export function renderPersonFilmographyGrid() {
  const data = state.personProfileData;
  const gridEl = document.getElementById("person-filmography-grid");
  const tabsEl = document.getElementById("person-role-tabs");
  if (!gridEl || !data) return;

  const rolesList = Array.isArray(data.roles) ? data.roles : [];
  const allItems = Array.isArray(data.all_items) ? data.all_items : [];

  if (tabsEl) {
    tabsEl.setAttribute("aria-label", t("Роли в фильмографии", "Filmography roles"));
    tabsEl.innerHTML = "";
    const makeTab = (roleKey, label) => {
      const btn = document.createElement("button");
      btn.type = "button";
      const isAct = state.personActiveRole === roleKey;
      const safeKey = String(roleKey || "all").replace(/[^a-zA-Z0-9_-]/g, "_");
      btn.id = `person-role-tab-${safeKey}`;
      btn.dataset.roleKey = String(roleKey || "all");
      btn.className = `atv-person-role-tab${isAct ? " active" : ""}`;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", isAct ? "true" : "false");
      btn.setAttribute("aria-controls", "person-filmography-grid");
      btn.tabIndex = isAct ? 0 : -1;
      if (isAct && gridEl) {
        gridEl.setAttribute("aria-labelledby", btn.id);
      }
      btn.textContent = label;
      btn.onclick = () => {
        state.personActiveRole = roleKey;
        state.personFilmographyLimit = 24;
        renderPersonFilmographyGrid();
        const nextBtn = document.getElementById(`person-role-tab-${safeKey}`);
        nextBtn?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      };
      return btn;
    };
    tabsEl.appendChild(makeTab("all", `${t("Все", "All")} (${allItems.length})`));
    rolesList.forEach((r) => {
      const cnt = Array.isArray(r.items) ? r.items.length : 0;
      if (cnt > 0) {
        tabsEl.appendChild(makeTab(r.role_key || r.role_label, `${translateCareer(r.role_label)} (${cnt})`));
      }
    });
    if (!tabsEl._cfKeyBound) {
      tabsEl._cfKeyBound = true;
      tabsEl.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
        const tabs = Array.from(tabsEl.querySelectorAll("[role='tab']:not(.hidden)"));
        if (tabs.length < 2) return;
        const curIdx = tabs.indexOf(document.activeElement);
        if (curIdx < 0) return;
        e.preventDefault();
        let nextIdx = curIdx;
        if (e.key === "ArrowRight") nextIdx = (curIdx + 1) % tabs.length;
        else if (e.key === "ArrowLeft") nextIdx = (curIdx - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") nextIdx = 0;
        else if (e.key === "End") nextIdx = tabs.length - 1;
        const target = tabs[nextIdx];
        if (target) {
          const targetId = target.id;
          target.click();
          if (targetId) {
            document.getElementById(targetId)?.focus({ preventScroll: true });
          }
        }
      });
    }
  }

  let itemsToShow = allItems;
  if (state.personActiveRole !== "all") {
    const matchedRole = rolesList.find(
      (r) => (r.role_key || r.role_label) === state.personActiveRole
    );
    if (matchedRole && Array.isArray(matchedRole.items)) {
      itemsToShow = matchedRole.items;
    }
  }

  gridEl.innerHTML = "";
  const prevMore = document.getElementById("person-load-more-row");
  if (prevMore) prevMore.remove();
  if (itemsToShow.length === 0) {
    gridEl.innerHTML = `<div class="atv-grid-empty-note">${t("Фильмы для выбранной роли не найдены — нажмите «Найти в основном каталоге» выше.", "No titles found for this role — click \"Find in Catalog\" above.")}</div>`;
    return;
  }

  const limit = Math.max(24, Number(state.personFilmographyLimit) || 24);
  const visibleSlice = itemsToShow.slice(0, limit);
  visibleSlice.forEach((filmItem) => {
    gridEl.appendChild(createPosterCardElement(filmItem));
  });

  if (itemsToShow.length > limit && gridEl.parentElement) {
    const moreRow = document.createElement("div");
    moreRow.id = "person-load-more-row";
    moreRow.className = "atv-person-load-more-row";
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "atv-btn-secondary atv-person-load-more-btn";
    const remaining = itemsToShow.length - limit;
    const nextBatch = Math.min(24, remaining);
    moreBtn.textContent = t(
      `Показать ещё ${nextBatch} из ${remaining}`,
      `Show ${nextBatch} more of ${remaining}`
    );
    moreBtn.onclick = () => {
      state.personFilmographyLimit = limit + 24;
      renderPersonFilmographyGrid();
    };
    moreRow.appendChild(moreBtn);
    gridEl.parentElement.appendChild(moreRow);
  }
}
export async function openPersonModal(personInput, options = {}) {
  const { skipStackPush = false } = options;
  const personObj =
    typeof personInput === "string"
      ? { name: personInput, person_url: "", photo: "", role: "" }
      : personInput || {};
  const pName = (personObj.name || "").trim();
  if (!pName) return;

  const modal = document.getElementById("person-modal");
  if (!modal) {
    triggerPersonSearch(pName);
    return;
  }

  const wasPersonHidden = modal.classList.contains("hidden");
  if (wasPersonHidden) {
    rememberModalTriggerFocus("person-modal");
  }
  const qpMod = document.getElementById("quick-peek-modal");
  const qpWasOpen = Boolean(qpMod && !qpMod.classList.contains("hidden"));
  const cameFromQuickPeek = Boolean(qpWasOpen && state.quickPeekItem);
  const ctxItem = cameFromQuickPeek
    ? state.quickPeekItem
    : state.isPlayerOpen && state.activeItem
    ? state.activeItem
    : null;
  if (!skipStackPush) {
    if (cameFromQuickPeek) {
      const qpSheetEl = qpMod.querySelector(".atv-quickpeek-sheet");
      state.navModalStack.push({
        view: "quick-peek",
        item: state.quickPeekItem,
        scrollTop: qpSheetEl ? qpSheetEl.scrollTop : 0,
      });
    } else if (
      wasPersonHidden &&
      state.isPlayerOpen &&
      !state.isMiniPlayer &&
      !state.isPipBackground &&
      state.activeItem
    ) {
      state.navModalStack.push({
        view: "player",
        item: state.activeItem,
      });
    }
  }
  if (qpWasOpen && qpMod) {
    state.quickPeekReqId += 1;
    qpMod.classList.add("hidden");
  }
  syncModalBackButtons();

  state.personModalReqId += 1;
  const reqId = state.personModalReqId;
  state.personProfileData = null;
  state.personActiveRole = "all";
  state.personFilmographyLimit = 24;

  const photoEl = document.getElementById("person-modal-photo");
  const careerEl = document.getElementById("person-modal-career");
  const nameEl = document.getElementById("person-modal-name");
  const origEl = document.getElementById("person-modal-orig");
  const metaEl = document.getElementById("person-modal-meta");
  const bioEl = document.getElementById("person-modal-bio");
  const statsBox = document.getElementById("person-kinorium-stats");
  const statsWatchedEl = document.getElementById("person-stats-watched");
  const statsRatingEl = document.getElementById("person-stats-rating");
  const statsFillEl = document.getElementById("person-stats-fill");
  const searchBtn = document.getElementById("btn-person-search-catalog");
  const tabsEl = document.getElementById("person-role-tabs");
  const loadingEl = document.getElementById("person-modal-loading");
  const gridEl = document.getElementById("person-filmography-grid");

  const initPhotoHint = personObj.photo || "";
  const lookupPersonName = personObj.ru_name || pName;
  if (photoEl) {
    const fallbackPersonSvg = buildFallbackAvatarSvg(pName);
    photoEl.style.backgroundImage = `url("${fallbackPersonSvg}")`;
    photoEl.style.backgroundSize = "cover";
    photoEl.style.backgroundPosition = "center";
    photoEl.src = `/api/person-photo?name=${encodeURIComponent(lookupPersonName)}${
      initPhotoHint ? `&url=${encodeURIComponent(initPhotoHint)}` : ""
    }`;
    photoEl.alt = pName;
    photoEl.onerror = () => {
      photoEl.onerror = null;
      photoEl.src = fallbackPersonSvg;
    };
  }
  if (careerEl) {
    careerEl.textContent = personObj.is_director
      ? t("Режиссёр", "Director")
      : translateCareer(personObj.role || t("Актёр / Режиссёр", "Actor / Director"));
  }
  if (nameEl) nameEl.textContent = pName;
  if (origEl) origEl.textContent = "";
  if (metaEl) metaEl.innerHTML = "";
  if (bioEl) {
    bioEl.textContent = "";
    bioEl.classList.add("hidden");
  }
  if (statsBox) statsBox.classList.add("hidden");
  if (tabsEl) tabsEl.innerHTML = "";
  if (gridEl) gridEl.innerHTML = "";
  if (loadingEl) loadingEl.classList.remove("hidden");
  if (searchBtn) {
    searchBtn.onclick = () => triggerPersonSearch(pName);
  }

  maybePausePlayerForOverlay();
  modal.classList.remove("hidden");
  modal.querySelector(".atv-person-sheet-scroll")?.scrollTo({ top: 0 });
  requestAnimationFrame(() => {
    document.getElementById("close-person-modal")?.focus({ preventScroll: true });
  });
  syncScrollTopButton();

  try {
    const params = new URLSearchParams({
      name: personObj.person_url ? lookupPersonName : pName,
      url: personObj.person_url || "",
      hint_title: ctxItem?.title || "",
      hint_orig: ctxItem?.orig_title || "",
      lang: state.appLang || "ru",
    });
    const res = await fetch(`/api/person?${params.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (reqId !== state.personModalReqId) return;
    if (data?.error) throw new Error(data.error);

    if (!data.orig_name && !hasCyrillicText(pName)) {
      data.orig_name = pName;
    }
    state.personProfileData = data;
    if (loadingEl) loadingEl.classList.add("hidden");

    const bestPhoto = data.photo || initPhotoHint;
    if (photoEl && bestPhoto) {
      photoEl.src = `/api/person-photo?name=${encodeURIComponent(data.name || pName)}&url=${encodeURIComponent(bestPhoto)}`;
      photoEl.onerror = () => {
        photoEl.onerror = null;
        photoEl.src = buildFallbackAvatarSvg(data.name || pName);
      };
    }

    renderPersonProfileDetails(data);

    // Default to "director" tab if person was clicked as a Director and has directed items, else "all"
    if (
      personObj.is_director &&
      Array.isArray(data.roles) &&
      data.roles.some((r) => r.role_key === "director" && r.items?.length > 0) &&
      data.roles.length > 1
    ) {
      state.personActiveRole = "director";
    } else {
      state.personActiveRole = "all";
    }
    renderPersonFilmographyGrid();
  } catch (err) {
    if (reqId !== state.personModalReqId) return;
    if (loadingEl) loadingEl.classList.add("hidden");
    if (gridEl) {
      gridEl.innerHTML = `<div class="atv-grid-error-note">${t("Не удалось загрузить карточку персоны — нажмите «Найти в основном каталоге».", "Failed to load person profile — click \"Find in Catalog\" above.")}</div>`;
    }
  }
}
export function renderModalCastSection(item, streamData = null) {
  const secEl = document.getElementById("meta-cast-section");
  const listEl = document.getElementById("meta-cast-list");
  const durBadge = document.getElementById("meta-duration-badge");
  if (!secEl || !listEl) return;

  const people = buildCastPeopleArray(item, streamData);

  if (durBadge) {
    durBadge.classList.add("hidden");
  }

  if (people.length === 0) {
    if (!streamData && item && (item.title || item.orig_title)) {
      secEl.classList.remove("hidden");
      listEl.innerHTML = `
        <div class="atv-cast-card-skeleton"></div>
        <div class="atv-cast-card-skeleton"></div>
        <div class="atv-cast-card-skeleton"></div>
        <div class="atv-cast-card-skeleton"></div>
      `;
      return;
    }
    secEl.classList.add("hidden");
    listEl.innerHTML = "";
    return;
  }
  secEl.classList.remove("hidden");
  listEl.innerHTML = "";
  attachHorizontalWheelScroll(listEl);

  people.slice(0, 14).forEach((p) => {
    listEl.appendChild(buildPersonPhotoCard(p, (personObj) => openPersonModal(personObj)));
  });
}
