import { WATCH_HISTORY_STORAGE_KEY, profileStorageKey, state } from "./state.js?v=20261105v5";
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
} from "./i18n.js?v=20261105v5";
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
} from "./utils.js?v=20261105v5";
import {
  attachSmartPosterFallback,
  createPosterCardElement,
} from "./catalog-cards.js?v=20261105v5";
import {
  applyEnabledServicesVisibility,
  getDefaultPlayableSourceTab,
  isEpisodeWatched,
  isServiceEnabled,
  patchCatalogItemKinoriumInPlace,
  resolvePreferredPlayTab,
  resolveSeriesEpisodeInfo,
} from "./catalog-media-resolver.js?v=20261105v5";
import {
  renderCatalogShelves,
  renderContinueWatching,
} from "./catalog-shelves.js?v=20261105v5";
import { renderHero } from "./catalog-hero.js?v=20261105v5";
import { updateActiveFiltersBadge } from "./catalog-filters.js?v=20261105v5";
import { loadCatalog } from "./catalog.js?v=20261105v5";
import { escapeEpisodeHtml, resolveSeriesCompletedFlag } from "./player-seasons.js?v=20261105v5";
import {
  closePlayerModal,
  openPlayerModal,
} from "./player.js?v=20261105v5";
import { updateBackupSummaryStat } from "./settings.js?v=20261105v5";
import {
  closeStatsModal,
  formatRelativeWatchDate,
  openStatsModal,
  renderWatchHistoryTab,
  switchStatsModalTab,
} from "./modals-stats.js?v=20261105v5";
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
  triggerPersonSearch,
} from "./modals-person.js?v=20261105v5";

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
          item.kinorium = prevKin;
          if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
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
      withKinoriumActionLock(`qp-rate:${item.id}`, qpClearRateBtn, async () => {
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
    withKinoriumActionLock(`qp-watching:${item.id}`, qpBtnWatching, async () => {
      const res = await fetch("/api/kinorium/watching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildQpPayload(item)),
      });
      const updated = await res.json();
      if (!res.ok || updated?.ok === false || updated?.error) {
        throw new Error(updated?.error || `HTTP ${res.status}`);
      }
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
          onUndo: async () => {
            try {
              const uRes = await fetch("/api/kinorium/watching", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildQpPayload(item)),
              });
              const uData = await uRes.json();
              if (uRes.ok && uData?.ok !== false && !uData?.error) {
                item.kinorium = uData;
                if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
                patchCatalogItemKinoriumInPlace(item, uData);
              }
            } catch (err) { window.logDebug?.("Modals", err); }
          },
        }
      );
    });
  });

  const qpBtnWatchlist = document.getElementById("qp-btn-watchlist");
  qpBtnWatchlist?.addEventListener("click", () => {
    const item = state.quickPeekItem;
    if (!item) return;
    withKinoriumActionLock(`qp-watchlist:${item.id}`, qpBtnWatchlist, async () => {
      const res = await fetch("/api/kinorium/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildQpPayload(item)),
      });
      const updated = await res.json();
      if (!res.ok || updated?.ok === false || updated?.error) {
        throw new Error(updated?.error || `HTTP ${res.status}`);
      }
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
          onUndo: async () => {
            try {
              const uRes = await fetch("/api/kinorium/watchlist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildQpPayload(item)),
              });
              const uData = await uRes.json();
              if (uRes.ok && uData?.ok !== false && !uData?.error) {
                item.kinorium = uData;
                if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
                patchCatalogItemKinoriumInPlace(item, uData);
              }
            } catch (err) { window.logDebug?.("Modals", err); }
          },
        }
      );
    });
  });

  const qpBtnWatched = document.getElementById("qp-btn-watched");
  qpBtnWatched?.addEventListener("click", () => {
    const item = state.quickPeekItem;
    if (!item) return;
    withKinoriumActionLock(`qp-watched:${item.id}`, qpBtnWatched, async () => {
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
          onUndo: async () => {
            try {
              const uRes = await fetch("/api/kinorium/watched", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...buildQpPayload(item), watched: curWatched }),
              });
              const uData = await uRes.json();
              if (uRes.ok && uData?.ok !== false && !uData?.error) {
                item.kinorium = uData;
                if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
                patchCatalogItemKinoriumInPlace(item, uData);
              }
            } catch (err) { window.logDebug?.("Modals", err); }
          },
        }
      );
    });
  });

  const qpBtnNever = document.getElementById("qp-btn-never");
  qpBtnNever?.addEventListener("click", () => {
    const item = state.quickPeekItem;
    if (!item) return;
    withKinoriumActionLock(`qp-never:${item.id}`, qpBtnNever, async () => {
      const res = await fetch("/api/kinorium/never", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildQpPayload(item)),
      });
      const updated = await res.json();
      if (!res.ok || updated?.ok === false || updated?.error) {
        throw new Error(updated?.error || `HTTP ${res.status}`);
      }
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
          onUndo: async () => {
            try {
              const uRes = await fetch("/api/kinorium/never", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildQpPayload(item)),
              });
              const uData = await uRes.json();
              if (uRes.ok && uData?.ok !== false && !uData?.error) {
                item.kinorium = uData;
                if (state.quickPeekItem === item) syncQuickPeekStatusesUI(item);
                patchCatalogItemKinoriumInPlace(item, uData);
              }
            } catch (err) { window.logDebug?.("Modals", err); }
          },
        }
      );
    });
  });
}
