import { WATCH_HISTORY_STORAGE_KEY, state } from "./state.js?v=20261024v4";
import {
  displayDescription,
  displayPoster,
  displayTitle,
  formatCriticsRating,
  hasCyrillicText,
  isEn,
  secondaryTitle,
  t,
  translateCareer,
  translateGenre,
  translateStudioName,
  transliterateRuToEn,
} from "./i18n.js?v=20261024v4";
import {
  attachHorizontalWheelScroll,
  cssUrl,
  escapeAttr,
  escapeHtml,
  expandRussianDateText,
  formatDurationLabel,
  formatTime,
  getWatchHistoryList,
  iconSvg,
  pluralRu,
  showToast,
  syncScrollTopButton,
} from "./utils.js?v=20261024v4";
import {
  applyEnabledServicesVisibility,
  attachSmartPosterFallback,
  createPosterCardElement,
  getDefaultPlayableSourceTab,
  isServiceEnabled,
  loadCatalog,
  resolveSeriesEpisodeInfo,
} from "./catalog.js?v=20261024v4";
import { closePlayerModal, escapeEpisodeHtml, openPlayerModal } from "./player.js?v=20261024v4";
import { updateBackupSummaryStat } from "./settings.js?v=20261024v4";

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
  document.getElementById("stats-tab-analytics")?.classList.toggle("active", state.statsActiveTab === "analytics");
  document.getElementById("stats-tab-history")?.classList.toggle("active", state.statsActiveTab === "history");
  document.getElementById("stats-modal-body")?.classList.toggle("hidden", state.statsActiveTab !== "analytics");
  document.getElementById("stats-history-body")?.classList.toggle("hidden", state.statsActiveTab !== "history");
  if (state.statsActiveTab === "history") {
    renderWatchHistoryTab();
  }
}
export function renderWatchHistoryTab() {
  const histBody = document.getElementById("stats-history-body");
  if (!histBody) return;

  let entries = getWatchHistoryList();
  // Seed initial timeline from continueWatching if local watch history is empty
  if (entries.length === 0 && Array.isArray(state.continueWatching) && state.continueWatching.length > 0) {
    entries = state.continueWatching.map((cw, idx) => ({
      key: `${cw.id}:seed${idx}`,
      id: cw.id,
      title: cw.title,
      orig_title: cw.orig_title || "",
      year: cw.year || 2024,
      media_type: cw.media_type || "movie",
      poster: cw.poster || cw.backdrop || "",
      poster_en: cw.poster_en || "",
      kinorium_id: cw.kinorium_id || cw.kinorium?.kinorium_id || "",
      backdrop: cw.backdrop || cw.poster || "",
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
      <div style="padding:36px 16px;text-align:center;color:rgba(235,235,245,0.58);font-size:13.5px;">
        <div style="margin-bottom:8px;opacity:0.7;">${iconSvg("clock", 22)}</div>
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
      <span style="font-size:12.5px;color:rgba(235,235,245,0.65);">
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
      const backupRaw = localStorage.getItem(WATCH_HISTORY_STORAGE_KEY);
      state.deletedWatchHistoryBackup = backupRaw;
      localStorage.removeItem(WATCH_HISTORY_STORAGE_KEY);
      renderWatchHistoryTab();
      updateBackupSummaryStat();
      showToast(t("История просмотров очищена", "Watch history cleared"), {
        actionLabel: t("Отменить", "Undo"),
        durationMs: 8000,
        onAction: () => {
          if (state.deletedWatchHistoryBackup) {
            try {
              localStorage.setItem(WATCH_HISTORY_STORAGE_KEY, state.deletedWatchHistoryBackup);
            } catch (_) {}
            state.deletedWatchHistoryBackup = null;
            renderWatchHistoryTab();
            updateBackupSummaryStat();
            showToast(t("История просмотров восстановлена", "Watch history restored"));
          }
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
    const hTitle = displayTitle(h);
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
    const hPoster = displayPoster(h);
    row.innerHTML = `
      <img class="atv-history-poster" src="${escapeAttr(hPoster)}" alt="${escapeAttr(hTitle)}" loading="lazy" referrerpolicy="no-referrer" />
      <div class="atv-history-info">
        <div class="atv-history-title">${escapeHtml(hTitle)} <span style="font-weight:400;color:rgba(235,235,245,0.48);">(${escapeHtml(h.year || "")})</span></div>
        <div class="atv-history-sub">${escapeHtml(epTag)}${escapeHtml(translateStudioName(h.studio || "HDRezka"))} · ${escapeHtml(posTag)}</div>
      </div>
      <div class="atv-history-time">${escapeHtml(formatRelativeWatchDate(h.watched_at))}</div>
    `;
    attachSmartPosterFallback(row.querySelector("img"), hTitle, h.year, h.poster);
    row.onclick = () => {
      document.getElementById("stats-modal")?.classList.add("hidden");
      syncScrollTopButton();
      const catalogMatch =
        state.catalogItems.find((i) => i.id === h.id || i.title === h.title) || {
          id: h.id || h.title,
          rezka_id: h.rezka_id || "",
          rezka_url: h.rezka_url || "",
          kinorium_id: h.kinorium_id || "",
          title: h.title,
          orig_title: h.orig_title || h.title,
          year: h.year || 2024,
          media_type: h.media_type || "movie",
          poster: h.poster,
          poster_en: h.poster_en || "",
          backdrop: h.backdrop || h.poster,
          providers: [{ id: "hdrezka", available: true, quality: "1080p" }],
          kinorium: {},
          ratings: {},
        };
      openPlayerModal(
        catalogMatch,
        getDefaultPlayableSourceTab(),
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
    openQuickPeekModal(entry.item, { skipStackPush: true });
    return true;
  }

  if (entry.view === "player") {
    state.personModalReqId += 1;
    document.getElementById("person-modal")?.classList.add("hidden");
    syncModalBackButtons();
    syncScrollTopButton();
    maybeResumePlayerAfterOverlay();
    return true;
  }
  return false;
}
function maybePausePlayerForOverlay() {
  if (!state.isPlayerOpen || state.isMiniPlayer || state.isPipBackground) return;
  if (
    state.activeSourceTab !== "hdrezka" &&
    state.activeSourceTab !== "stremio" &&
    state.activeSourceTab !== "backup4k"
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
function maybeResumePlayerAfterOverlay() {
  if (!state.pausedByOverlayModal) return;
  const qpMod = document.getElementById("quick-peek-modal");
  const personMod = document.getElementById("person-modal");
  const qpOpen = Boolean(qpMod && !qpMod.classList.contains("hidden"));
  const personOpen = Boolean(personMod && !personMod.classList.contains("hidden"));
  if (qpOpen || personOpen) return;
  state.pausedByOverlayModal = false;
  if (!state.isPlayerOpen || state.isMiniPlayer || state.isPipBackground) return;
  if (
    state.activeSourceTab !== "hdrezka" &&
    state.activeSourceTab !== "stremio" &&
    state.activeSourceTab !== "backup4k"
  ) {
    return;
  }
  const video = document.getElementById("native-video");
  if (video && video.paused && !video.ended && video.currentSrc) {
    video.play().catch(() => {});
  }
}
export function closeQuickPeekModal(options = {}) {
  const { clearStack = false, suppressResume = false } = options;
  if (clearStack) {
    state.navModalStack = [];
    syncModalBackButtons();
  } else {
    const top = state.navModalStack[state.navModalStack.length - 1];
    if (top && top.view === "person") {
      goBackInModalStack();
      return;
    }
  }
  state.quickPeekReqId += 1;
  document.getElementById("quick-peek-modal")?.classList.add("hidden");
  syncModalBackButtons();
  syncScrollTopButton();
  if (!suppressResume) {
    maybeResumePlayerAfterOverlay();
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
  const rateLbl = document.getElementById("qp-rate-label");
  if (rateLbl) {
    rateLbl.innerHTML = curScore
      ? t(
          `Ваша оценка в Kinorium: <span class="atv-inline-icon-label">${iconSvg("star", 11)}<strong>${curScore}/10</strong></span> (нажмите для изменения)`,
          `Your Kinorium rating: <span class="atv-inline-icon-label">${iconSvg("star", 11)}<strong>${curScore}/10</strong></span> (click to change)`
        )
      : t("Быстрая оценка в Kinorium (1–10):", "Quick Rate on Kinorium (1–10):");
  }
  document.querySelectorAll("#qp-stars button").forEach((b) => {
    const sc = parseInt(b.dataset.score, 10);
    b.classList.toggle("active-star", curScore > 0 && sc === curScore);
    b.classList.toggle("in-score-range", curScore > 0 && sc < curScore);
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
export async function openQuickPeekModal(item, options = {}) {
  if (!item) return;
  const modal = document.getElementById("quick-peek-modal");
  if (!modal) return;
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
          "Персона",
        profileData: state.personProfileData,
        activeRole: state.personActiveRole || "all",
        scrollTop: scroller ? scroller.scrollTop : 0,
      });
      state.personModalReqId += 1;
      personMod.classList.add("hidden");
    } else {
      state.navModalStack = [];
    }
  }
  syncModalBackButtons();
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
    const qpBgSrc = isEn()
      ? item.backdrop && !item.backdrop.includes("ru-images.kinorium.com")
        ? item.backdrop
        : qpPosterSrc
      : item.backdrop || item.poster || "";
    backdropEl.style.backgroundImage = cssUrl(qpBgSrc);
  }

  const typeLabel = item.media_type === "series" ? t("Сериал", "Series") : t("Фильм", "Movie");
  const genresText = (item.genres || []).map(translateGenre).join(" · ");
  document.getElementById("qp-kicker").textContent = [typeLabel, item.year, genresText]
    .filter(Boolean)
    .join(" · ");
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

  const initQpDesc = displayDescription(item);
  document.getElementById("qp-description").textContent =
    initQpDesc || t("Загрузка полного описания и состава актёров...", "Loading synopsis and cast...");

  syncQuickPeekStatusesUI(item);
  syncQuickPeekSeasonProgress(item);

  const qpFriendsWrap = document.getElementById("qp-friends-wrap");
  const qpFriendsList = document.getElementById("qp-friends-list");
  if (qpFriendsWrap && qpFriendsList) {
    const frList = isServiceEnabled("kinorium") ? item.kinorium?.friends_ratings || [] : [];
    if (frList.length > 0) {
      qpFriendsList.innerHTML = frList
        .map(
          (f) =>
            `<span class="friend-pill"><span>${escapeHtml(f.name)}</span> · ${iconSvg("star", 10)}<span>${escapeHtml(f.score)}</span></span>`
        )
        .join("");
      qpFriendsWrap.classList.remove("hidden");
    } else {
      qpFriendsList.innerHTML = "";
      qpFriendsWrap.classList.add("hidden");
    }
  }

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

  const epInfo = resolveSeriesEpisodeInfo(item);
  const primaryTab = getDefaultPlayableSourceTab();
  const playBtn = document.getElementById("qp-btn-play");
  if (playBtn) {
    if (primaryTab !== "trailer") {
      let labelText = t("Смотреть", "Watch");
      if (epInfo.isMidEpisodeResume) {
        labelText =
          item.media_type === "series"
            ? t(
                `Продолжить · Сезон ${epInfo.season}, Серия ${epInfo.episode}`,
                `Resume · Season ${epInfo.season}, Episode ${epInfo.episode}`
              )
            : t("Продолжить просмотр", "Resume Watching");
      } else if (item.media_type === "series" && epInfo.hasNewEpisode && epInfo.episodeVerified) {
        labelText = t(
          `Смотреть · Сезон ${epInfo.season}, Серия ${epInfo.episode}`,
          `Watch · Season ${epInfo.season}, Episode ${epInfo.episode}`
        );
      }
      playBtn.innerHTML = `${iconSvg("play", 12)}<span>${labelText}</span>`;
      playBtn.classList.remove("hidden");
    } else {
      playBtn.classList.add("hidden");
    }
    playBtn.onclick = () => {
      closeQuickPeekModal({ clearStack: true, suppressResume: true });
      const info = resolveSeriesEpisodeInfo(item);
      openPlayerModal(item, primaryTab, info.season, info.episode, info.currentTime);
    };
  }
  const trBtn = document.getElementById("qp-btn-trailer");
  if (trBtn) {
    trBtn.onclick = () => {
      closeQuickPeekModal({ clearStack: true, suppressResume: true });
      const info = resolveSeriesEpisodeInfo(item);
      openPlayerModal(item, "trailer", info.season, info.episode, info.currentTime);
    };
  }
  document.getElementById("qp-btn-stremio")?.classList.add("hidden");
  document.getElementById("qp-btn-4k")?.classList.add("hidden");

  maybePausePlayerForOverlay();
  applyEnabledServicesVisibility();
  modal.classList.remove("hidden");
  modal.querySelector(".atv-quickpeek-sheet")?.scrollTo({ top: 0 });
  requestAnimationFrame(() => {
    (playBtn && !playBtn.classList.contains("hidden")
      ? playBtn
      : document.getElementById("close-quick-peek-modal")
    )?.focus({ preventScroll: true });
  });
  syncScrollTopButton();

  try {
    const reqLang = state.appLang || "ru";
    const params = new URLSearchParams({
      id: item.rezka_id || item.id || "",
      item_id: String(item.id || ""),
      kinorium_id: String(item.kinorium_id || item.kinorium?.kinorium_id || ""),
      rezka_url: item.rezka_url || "",
      title: item.title || "",
      orig_title: item.orig_title || "",
      year: String(item.year || 2024),
      media_type: item.media_type || "movie",
      lang: reqLang,
    });
    const res = await fetch(`/api/title-meta?${params.toString()}`);
    const meta = await res.json();
    if (reqId !== state.quickPeekReqId) return;
    if (meta.rezka_id) item.rezka_id = meta.rezka_id;
    if (meta.rezka_url) item.rezka_url = meta.rezka_url;
    if (typeof meta.is_completed === "boolean") item.is_series_completed = meta.is_completed;
    if (meta.critics_rating != null) {
      item.ratings = { ...(item.ratings || {}), critics: meta.critics_rating };
      const crEl = document.getElementById("qp-r-critics");
      if (crEl) crEl.textContent = formatCriticsRating(item, meta.critics_rating);
    }
    if (meta.poster_en) {
      item.poster_en = meta.poster_en;
      if (isEn() && posterEl) {
        posterEl.src = displayPoster(item);
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
        document.getElementById("qp-description").textContent =
          finalEnDesc || "Synopsis temporarily unavailable.";
      }
    } else {
      if (meta.description && meta.description.length > 20) {
        item.description = meta.description;
        if (!isEn()) {
          document.getElementById("qp-description").textContent = meta.description;
        }
      } else if (!item.description && !isEn()) {
        document.getElementById("qp-description").textContent = "Описание временно недоступно.";
      }
      if (meta.directors?.length) item.directors = meta.directors;
      if (meta.actors?.length) item.actors = meta.actors;
      if (meta.cast_people?.length) item.cast_people = meta.cast_people;
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
  } catch (_) {}
}
export async function openStatsModal(initialTab = "analytics") {
  const modal = document.getElementById("stats-modal");
  const bodyEl = document.getElementById("stats-modal-body");
  const badgeEl = document.getElementById("stats-profile-badge");
  if (!modal || !bodyEl) return;
  modal.classList.remove("hidden");
  syncScrollTopButton();
  if (!isServiceEnabled("kinorium")) {
    switchStatsModalTab("history");
    return;
  }
  switchStatsModalTab(initialTab);
  bodyEl.innerHTML = `<div style="font-size:13px;color:rgba(235,235,245,0.6);">${t("Загрузка статистики профиля...", "Loading profile statistics...")}</div>`;

  try {
    const res = await fetch("/api/kinorium/stats");
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
            <span class="atv-hist-label" style="width:76px">${escapeHtml(dispLabel)}</span>
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
        : `<div style="font-size:12px;color:rgba(235,235,245,0.5)">${t("Нет данных по общим оценкам с друзьями", "No shared ratings with friends yet")}</div>`;

    const favs = st.top_favorites || [];
    const favsHtml =
      favs.length > 0
        ? `<div class="atv-fav-grid" id="stats-fav-grid">
            ${favs
              .map(
                (fv, idx) => `
                <div class="atv-fav-item" tabindex="0" role="button" data-fav-idx="${idx}" title="${escapeAttr(displayTitle(fv))} (${escapeAttr(fv.year)}) · ${t("Ваша оценка", "Your rating")} ${escapeAttr(fv.score)}/10">
                  <img src="${escapeAttr(displayPoster(fv))}" alt="${escapeAttr(displayTitle(fv))}" loading="lazy" />
                  <div class="atv-fav-item-title">${iconSvg("star", 10)}<span>${escapeHtml(fv.score)} · ${escapeHtml(displayTitle(fv))}</span></div>
                </div>
              `
              )
              .join("")}
          </div>`
        : `<div style="font-size:12px;color:rgba(235,235,245,0.5)">${t("Пока нет оценок 9–10", "No 9–10 ratings yet")}</div>`;

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
          <h4 style="margin-top:14px;">${t("Совпадение вкусов с друзьями Kinorium", "Taste Match with Kinorium Friends")}</h4>
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
        modal.classList.add("hidden");
        syncScrollTopButton();
        const matchedFav =
          state.catalogItems.find(
            (i) =>
              i.id === fv.id ||
              (fv.title && (i.title || "").trim().toLowerCase() === fv.title.trim().toLowerCase())
          ) || {
            id: fv.id,
            title: fv.title,
            orig_title: fv.orig_title || fv.title,
            year: fv.year || 2024,
            media_type: fv.media_type || "movie",
            poster: fv.poster,
            poster_en: fv.poster_en || "",
            backdrop: fv.poster,
            kinorium: { watched: true, user_rating: fv.score, kinorium_rating: fv.score },
            ratings: { kinorium: fv.score, imdb: fv.score },
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
    bodyEl.innerHTML = `<div style="font-size:13px;color:#fca5a5;">${t("Не удалось загрузить статистику профиля", "Failed to load profile statistics")}</div>`;
  }
}
export function triggerPersonSearch(personName) {
  if (!personName) return;
  closePersonModal();
  closeQuickPeekModal();
  if (state.isPlayerOpen) {
    closePlayerModal(true);
  }
  document.getElementById("search-live-popover")?.classList.add("hidden");
  state.searchQuery = personName;
  state.kinoriumSection = "all";
  state.providerFilter = "all";
  state.mediaTypeFilter = "all";
  const searchInput = document.getElementById("global-search");
  if (searchInput) searchInput.value = personName;
  document.getElementById("btn-clear-search")?.classList.remove("hidden");
  document.getElementById("search-kbd-hint")?.classList.add("hidden");
  document.querySelectorAll(".kin-sec-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.ksec === "all");
  });
  document.querySelectorAll(".atv-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.provider === "all");
  });
  document.querySelectorAll(".type-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.type === "all");
  });
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160"><rect width="120" height="160" fill="#26262a"/><text x="60" y="90" fill="#e5e5ea" font-family="-apple-system,sans-serif" font-size="36" font-weight="600" text-anchor="middle">${safeInit}</text></svg>`;
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
    : streamData?.cast_people || item?.cast_people || [];
  if (Array.isArray(richSource) && richSource.length > 0) {
    return isEn() ? richSource.map(normalizePersonForLang) : richSource;
  }
  const directors = isEn()
    ? streamData?.directors_en || item?.directors_en || streamData?.directors || item?.directors || []
    : streamData?.directors || item?.directors || [];
  const actors = isEn()
    ? streamData?.actors_en || item?.actors_en || streamData?.actors || item?.actors || []
    : streamData?.actors || item?.actors || [];
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
    imgEl.onerror = () => {
      imgEl.onerror = null;
      imgEl.src = buildFallbackAvatarSvg(pName);
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
    tabsEl.innerHTML = "";
    const makeTab = (roleKey, label) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `atv-person-role-tab${state.personActiveRole === roleKey ? " active" : ""}`;
      btn.textContent = label;
      btn.onclick = () => {
        state.personActiveRole = roleKey;
        renderPersonFilmographyGrid();
        btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
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
  if (itemsToShow.length === 0) {
    gridEl.innerHTML = `<div style="grid-column:1/-1;padding:24px 4px;font-size:13px;color:rgba(235,235,245,0.55)">${t("Фильмы для выбранной роли не найдены — нажмите «Найти в основном каталоге» выше.", "No titles found for this role — click \"Find in Catalog\" above.")}</div>`;
    return;
  }

  itemsToShow.forEach((filmItem) => {
    gridEl.appendChild(createPosterCardElement(filmItem));
  });
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
  const qpMod = document.getElementById("quick-peek-modal");
  const cameFromQuickPeek = Boolean(qpMod && !qpMod.classList.contains("hidden") && state.quickPeekItem);
  const ctxItem = cameFromQuickPeek
    ? state.quickPeekItem
    : state.isPlayerOpen && state.activeItem
    ? state.activeItem
    : null;
  if (!skipStackPush) {
    if (cameFromQuickPeek) {
      state.navModalStack.push({
        view: "quick-peek",
        item: state.quickPeekItem,
      });
      state.quickPeekReqId += 1;
      qpMod.classList.add("hidden");
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
  syncModalBackButtons();

  state.personModalReqId += 1;
  const reqId = state.personModalReqId;
  state.personProfileData = null;
  state.personActiveRole = "all";

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
    photoEl.src = `/api/person-photo?name=${encodeURIComponent(lookupPersonName)}${
      initPhotoHint ? `&url=${encodeURIComponent(initPhotoHint)}` : ""
    }`;
    photoEl.alt = pName;
    photoEl.onerror = () => {
      photoEl.onerror = null;
      photoEl.src = buildFallbackAvatarSvg(pName);
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
    const data = await res.json();
    if (reqId !== state.personModalReqId) return;

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
      gridEl.innerHTML = `<div style="grid-column:1/-1;padding:20px 4px;font-size:13px;color:#fca5a5">${t("Не удалось загрузить карточку персоны — нажмите «Найти в основном каталоге».", "Failed to load person profile — click \"Find in Catalog\" above.")}</div>`;
    }
  }
}
export function renderModalCastSection(item, streamData = null) {
  const secEl = document.getElementById("meta-cast-section");
  const listEl = document.getElementById("meta-cast-list");
  const durBadge = document.getElementById("meta-duration-badge");
  if (!secEl || !listEl) return;

  const people = buildCastPeopleArray(item, streamData);
  const durLabel = formatDurationLabel(streamData?.duration_label || item?.duration_label || "");

  if (durBadge) {
    durBadge.classList.add("hidden");
  }
  const origSubtitleEl = document.getElementById("modal-orig-title");
  if (origSubtitleEl && item) {
    const typeText = item.media_type === "series" ? t("Сериал", "Series") : t("Фильм", "Movie");
    origSubtitleEl.textContent = [secondaryTitle(item), item.year, typeText, durLabel]
      .filter(Boolean)
      .join(" · ");
  }

  if (people.length === 0) {
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
