import { WATCH_HISTORY_STORAGE_KEY, profileStorageKey, state } from "./state.js?v=20261109v1";
import {
  displayPoster,
  displayTitle,
  hasCyrillicText,
  isEn,
  t,
  translateGenre,
  translateStudioName,
  transliterateRuToEn,
} from "./i18n.js?v=20261109v1";
import {
  closeCustomSelectMenu,
  copyTextToClipboard,
  escapeAttr,
  escapeHtml,
  findOfflineDownloadForTitle,
  formatTime,
  getWatchHistoryList,
  iconSvg,
  invalidateLocalCaches,
  matchCatalogItemSafe,
  pluralRu,
  rememberModalTriggerFocus,
  restoreModalTriggerFocus,
  showToast,
  syncScrollTopButton,
} from "./utils.js?v=20261109v1";
import { attachSmartPosterFallback } from "./catalog-cards.js?v=20261109v1";
import {
  getDefaultPlayableSourceTab,
  isServiceEnabled,
} from "./catalog-media-resolver.js?v=20261109v1";
import { openPlayerModal } from "./player.js?v=20261109v1";
import { updateBackupSummaryStat } from "./settings.js?v=20261109v1";
import { openPersonModal, openQuickPeekModal } from "./modals.js?v=20261109v1";

let _timeFmtRu = null;
let _timeFmtEn = null;
let _dateFmtRu = null;
let _dateFmtEn = null;

function getTimeFmt(en) {
  if (en) {
    if (!_timeFmtEn) _timeFmtEn = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
    return _timeFmtEn;
  }
  if (!_timeFmtRu) _timeFmtRu = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return _timeFmtRu;
}

function getDateFmt(en) {
  if (en) {
    if (!_dateFmtEn) _dateFmtEn = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    return _dateFmtEn;
  }
  if (!_dateFmtRu) _dateFmtRu = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  return _dateFmtRu;
}

let _relDateDayCacheTs = 0;
let _relDateTodayStr = "";
let _relDateYestStr = "";

export function formatRelativeWatchDate(ts) {
  if (!ts) return t("Недавно", "Recently");
  const d = new Date(ts);
  const time = d.getTime();
  if (Number.isNaN(time)) return t("Недавно", "Recently");
  const nowMs = Date.now();
  if (nowMs - _relDateDayCacheTs > 60000 || !_relDateTodayStr) {
    const now = new Date(nowMs);
    const yest = new Date(nowMs - 86400000);
    _relDateTodayStr = now.toDateString();
    _relDateYestStr = yest.toDateString();
    _relDateDayCacheTs = nowMs;
  }
  const isEnLocale = isEn();
  const timeFmt = getTimeFmt(isEnLocale);
  const dStr = d.toDateString();
  const timeStr = timeFmt.format(d);
  if (dStr === _relDateTodayStr) return `${t("Сегодня", "Today")}, ${timeStr}`;
  if (dStr === _relDateYestStr) return `${t("Вчера", "Yesterday")}, ${timeStr}`;
  return getDateFmt(isEnLocale).format(d);
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
    const emptySig = `empty|${state.appLang || "ru"}`;
    if (histBody._histRenderSig === emptySig) return;
    histBody._histRenderSig = emptySig;
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

  const histRenderSig = `${state.appLang || "ru"}|${state.catalogIndexVersion || 0}|${entries.length}|${entries[0]?.key || entries[0]?.id || ""}:${entries[0]?.watched_at || 0}:${entries[0]?.current_time || 0}`;
  if (histBody._histRenderSig === histRenderSig && histBody.children.length > 0) {
    return;
  }
  histBody._histRenderSig = histRenderSig;

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
      } catch (err) { window.logDebug?.("Modals", err); }
      invalidateLocalCaches();
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
          } catch (err) { window.logDebug?.("Modals", err); }
          state.deletedWatchHistoryBackup = null;
          invalidateLocalCaches();
          renderWatchHistoryTab();
          updateBackupSummaryStat();
          showToast(t("История просмотров восстановлена", "Watch history restored"));
        },
      });
    };
  }

  const listEl = document.getElementById("watch-history-list");
  const histFrag = document.createDocumentFragment();
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
      <img class="atv-history-poster" src="${escapeAttr(hPoster)}" alt="${escapeAttr(hTitle)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
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
    histFrag.appendChild(row);
  });
  listEl?.appendChild(histFrag);
}

let _statsFetchAbortController = null;

export function closeStatsModal(options = {}) {
  const { suppressFocusRestore = false } = options;
  if (_statsFetchAbortController) {
    try {
      _statsFetchAbortController.abort();
    } catch (_) {}
    _statsFetchAbortController = null;
  }
  closeCustomSelectMenu({ restoreFocus: false });
  document.getElementById("stats-modal")?.classList.add("hidden");
  syncScrollTopButton();
  if (!suppressFocusRestore) {
    restoreModalTriggerFocus("stats-modal");
  }
}

let _lastWatchWrapStRef = null;
let _lastWatchWrapSig = "";
let _lastWatchWrapVal = null;

export function computeClientWatchWrapAnalytics(st = {}) {
  const histEntries = getWatchHistoryList();
  const wrapSig = `${Number(state.catalogIndexVersion) || 0}|${state.appLang || "ru"}|${(state.catalogItems || []).length}|${histEntries.length}|${histEntries[0]?.watched_at || histEntries[0]?.updatedAt || 0}|${st?.counts?.watched || 0}|${st?.counts?.rated || 0}|${(st?.favorites || []).length}|${(st?.top_directors || []).length}|${(st?.top_actors || []).length}`;
  if (wrapSig === _lastWatchWrapSig && _lastWatchWrapVal) {
    return _lastWatchWrapVal;
  }
  const dirMap = new Map();
  const actMap = new Map();
  const addPerson = (map, rawName, scoreVal) => {
    const nm = String(rawName || "").trim();
    if (!nm || nm.length < 2) return;
    const key = nm.toLowerCase();
    const cur = map.get(key) || { name: nm, count: 0, scoreSum: 0, rated: 0 };
    cur.count += 1;
    if (typeof scoreVal === "number" && scoreVal > 0) {
      cur.scoreSum += scoreVal;
      cur.rated += 1;
    }
    map.set(key, cur);
  };

  (Array.isArray(st.top_directors) ? st.top_directors : []).forEach((d) => {
    if (!d?.name) return;
    const rawNm = String(d.name).trim();
    const dispNm = isEn() && hasCyrillicText(rawNm) ? transliterateRuToEn(rawNm) : rawNm;
    const key = dispNm.toLowerCase();
    dirMap.set(key, {
      name: dispNm,
      count: Number(d.count) || 1,
      scoreSum: d.avg_score ? Number(d.avg_score) * (Number(d.count) || 1) : 0,
      rated: d.avg_score ? Number(d.count) || 1 : 0,
    });
  });

  (Array.isArray(st.top_actors) ? st.top_actors : []).forEach((a) => {
    if (!a?.name) return;
    const rawNm = String(a.name).trim();
    const dispNm = isEn() && hasCyrillicText(rawNm) ? transliterateRuToEn(rawNm) : rawNm;
    const key = dispNm.toLowerCase();
    actMap.set(key, {
      name: dispNm,
      count: Number(a.count) || 1,
      scoreSum: a.avg_score ? Number(a.avg_score) * (Number(a.count) || 1) : 0,
      rated: a.avg_score ? Number(a.count) || 1 : 0,
    });
  });

  const catList = Array.isArray(state.catalogItems) ? state.catalogItems : [];
  catList.forEach((it) => {
    if (!it) return;
    const ks = it.kinorium || {};
    const isWatchedOrRated = Boolean(ks.watched || ks.watching || Number(ks.user_rating) > 0);
    if (!isWatchedOrRated) return;
    const uScore = Number(ks.user_rating) || 0;
    const dirs = (isEn() && it.directors_en?.length ? it.directors_en : it.directors) || [];
    const acts = (isEn() && it.actors_en?.length ? it.actors_en : it.actors) || [];
    dirs.forEach((d) => addPerson(dirMap, d, uScore));
    acts.slice(0, 6).forEach((a) => addPerson(actMap, a, uScore));
  });

  const timeOfDay = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  const dayBuckets = new Map();
  let weekendCount = 0;
  let weekdayCount = 0;

  histEntries.forEach((h) => {
    const ts = Number(h?.watched_at || h?.updatedAt || 0);
    if (!ts) return;
    const dt = new Date(ts);
    if (Number.isNaN(dt.getTime())) return;
    const hr = dt.getHours();
    if (hr >= 6 && hr < 12) timeOfDay.morning += 1;
    else if (hr >= 12 && hr < 18) timeOfDay.afternoon += 1;
    else if (hr >= 18 && hr <= 23) timeOfDay.evening += 1;
    else timeOfDay.night += 1;

    const dow = dt.getDay();
    if (dow === 0 || dow === 6) weekendCount += 1;
    else weekdayCount += 1;

    const dayKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    dayBuckets.set(dayKey, (dayBuckets.get(dayKey) || 0) + 1);
  });

  const localMaxBinge = dayBuckets.size > 0 ? Math.max(...dayBuckets.values()) : 0;
  const serverMarathon = Number(st.cinema_wrap?.longest_marathon_episodes) || 0;
  const longestMarathon = Math.max(localMaxBinge, serverMarathon, histEntries.length > 0 ? 1 : 0);

  const topDirectors = Array.from(dirMap.values())
    .sort((a, b) => b.count - a.count || (b.rated ? b.scoreSum / b.rated : 0) - (a.rated ? a.scoreSum / a.rated : 0))
    .slice(0, 6)
    .map((d) => ({
      name: d.name,
      count: d.count,
      avg_score: d.rated > 0 ? Math.round((d.scoreSum / d.rated) * 10) / 10 : null,
    }));

  const topActors = Array.from(actMap.values())
    .sort((a, b) => b.count - a.count || (b.rated ? b.scoreSum / b.rated : 0) - (a.rated ? a.scoreSum / a.rated : 0))
    .slice(0, 8)
    .map((a) => ({
      name: a.name,
      count: a.count,
      avg_score: a.rated > 0 ? Math.round((a.scoreSum / a.rated) * 10) / 10 : null,
    }));

  const cwObj = st.cinema_wrap || {};
  const personaLabel = isEn()
    ? cwObj.persona_en || "True Cinephile"
    : cwObj.persona_ru || "Истинный синефил";
  const topGenreRaw = cwObj.top_genre || st.top_genres?.[0]?.genre || "";
  const topGenreLabel = topGenreRaw ? translateGenre(topGenreRaw) : t("Драма и триллер", "Drama & Thriller");
  const favDecade = cwObj.favorite_decade || "2020–2026";
  const episodesWatched = Math.max(
    Number(st.watched_episodes_count || cwObj.watched_episodes_count || 0),
    histEntries.filter((h) => h?.media_type === "series").length
  );

  const result = {
    personaLabel,
    topGenreLabel,
    favDecade,
    episodesWatched,
    longestMarathon,
    topDirectors,
    topActors,
    timeOfDay,
    weekendCount,
    weekdayCount,
  };
  _lastWatchWrapStRef = st;
  _lastWatchWrapSig = wrapSig;
  _lastWatchWrapVal = result;
  return result;
}

let _statsPayloadCache = null;
let _statsPayloadCacheTs = 0;
let _statsPayloadCacheProfKey = "";

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

  const profCacheKey = `${state.activeProfileId || "main"}|${state.kinoriumAccount?.user_id || ""}|${state.catalogIndexVersion || 0}`;
  const nowStatsMs = Date.now();
  const hasFreshCache =
    _statsPayloadCache &&
    _statsPayloadCacheProfKey === profCacheKey &&
    nowStatsMs - _statsPayloadCacheTs < 45000;
  const renderedDomKey = `${profCacheKey}|${state.appLang || "ru"}|${(getWatchHistory() || []).length}`;
  if (hasFreshCache && bodyEl._statsRenderedKey === renderedDomKey && bodyEl.childElementCount > 0) {
    return;
  }

  if (!hasFreshCache) {
    bodyEl.innerHTML = `<div class="atv-stats-loading-note">${t("Загрузка статистики профиля...", "Loading profile statistics...")}</div>`;
  }

  if (_statsFetchAbortController) {
    try {
      _statsFetchAbortController.abort();
    } catch (_) {}
  }
  const statsAbort = new AbortController();
  _statsFetchAbortController = statsAbort;

  try {
    let st = hasFreshCache ? _statsPayloadCache : null;
    if (!st) {
      const res = await fetch("/api/kinorium/stats", { signal: statsAbort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      st = await res.json();
      _statsPayloadCache = st;
      _statsPayloadCacheTs = Date.now();
      _statsPayloadCacheProfKey = profCacheKey;
    }
    if (statsAbort.signal.aborted || modal.classList.contains("hidden")) return;
    bodyEl._statsRenderedKey = renderedDomKey;
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
                  <img src="${escapeAttr(displayPoster(fv))}" alt="${escapeAttr(displayTitle(fv))}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
                  <div class="atv-fav-item-title">${iconSvg("star", 10)}<span>${escapeHtml(fv.score)} · ${escapeHtml(displayTitle(fv))}</span></div>
                </div>
              `
              )
              .join("")}
          </div>`
        : `<div class="atv-stats-empty-sub">${t("Пока нет оценок 9–10", "No 9–10 ratings yet")}</div>`;

    const topGenres = Array.isArray(st.top_genres) ? st.top_genres : [];
    const maxGenreCnt = Math.max(1, ...topGenres.map((g) => Number(g.count) || 0));
    const topGenresHtml =
      topGenres.length > 0
        ? topGenres
            .map((g) => {
              const pct = Math.round(((Number(g.count) || 0) / maxGenreCnt) * 100);
              const avgPart = g.avg_score ? ` (${escapeHtml(g.avg_score)}/10)` : "";
              return `
                <div class="atv-hist-row">
                  <span class="atv-hist-label is-wide">${escapeHtml(translateGenre(g.genre))}</span>
                  <div class="atv-hist-bar-wrap">
                    <div class="atv-hist-bar-fill" style="width:${pct}%"></div>
                  </div>
                  <span class="atv-hist-count">${escapeHtml(g.count)}${avgPart}</span>
                </div>
              `;
            })
            .join("")
        : "";

    const yearlyList = Array.isArray(st.yearly_summary) ? st.yearly_summary : [];
    const yearlyHtml =
      yearlyList.length > 0
        ? yearlyList
            .map((yb) => {
              const avgBadge = yb.avg_score
                ? `<span class="atv-inline-icon-label atv-friend-avg-score">${iconSvg("star", 11)}<span>${escapeHtml(yb.avg_score)}</span></span>`
                : "";
              const mCnt = Number(yb.movies) || 0;
              const sCnt = Number(yb.series) || 0;
              const hCnt = Number(yb.hours) || 0;
              const totCnt = Number(yb.total) || 0;
              return `
                <div class="atv-friend-stat-row">
                  <div class="atv-friend-stat-info">
                    <div class="atv-friend-stat-name">${escapeHtml(yb.year)}</div>
                    <div class="atv-friend-stat-sub">${escapeHtml(mCnt)} ${t(pluralRu(mCnt, "фильм", "фильма", "фильмов"), "movies")} · ${escapeHtml(sCnt)} ${t(pluralRu(sCnt, "сериал", "сериала", "сериалов"), "series")} · ~${escapeHtml(hCnt)} ${t(pluralRu(hCnt, "час", "часа", "часов"), "hours")}</div>
                  </div>
                  <div class="atv-friend-stat-metrics">
                    ${avgBadge}
                    <span class="atv-similarity-badge tier-high">${escapeHtml(totCnt)} ${t(pluralRu(totCnt, "тайтл", "тайтла", "тайтлов"), "titles")}</span>
                  </div>
                </div>
              `;
            })
            .join("")
        : "";

    const moviesCount = st.watched_movies || 0;
    const seriesCount = st.watched_series || 0;
    const hoursCount = st.estimated_hours || 0;
    const daysCount = st.estimated_days || 0;
    const ratedCount = st.rated_count || 0;
    const wrap = computeClientWatchWrapAnalytics(st);

    const renderPersonChips = (list, roleType) => {
      if (!Array.isArray(list) || list.length === 0) {
        return `<div class="atv-stats-empty-sub">${escapeHtml(
          t("Отмечайте просмотренные фильмы, чтобы сформировать топ", "Watch & rate titles to build your top list")
        )}</div>`;
      }
      return `<div class="atv-wrap-person-grid">
        ${list
          .map(
            (p) => `
            <button type="button" class="atv-wrap-person-chip" data-person-name="${escapeAttr(
              p.name
            )}" data-person-role="${escapeAttr(roleType)}">
              <span class="atv-wrap-person-name">${escapeHtml(p.name)}</span>
              <span class="atv-wrap-person-meta">${escapeHtml(p.count)} ${escapeHtml(
              t(pluralRu(p.count, "тайтл", "тайтла", "тайтлов"), p.count === 1 ? "title" : "titles")
            )}${p.avg_score ? ` · ${escapeHtml(p.avg_score)}/10` : ""}</span>
            </button>
          `
          )
          .join("")}
      </div>`;
    };

    const todTotal =
      wrap.timeOfDay.morning + wrap.timeOfDay.afternoon + wrap.timeOfDay.evening + wrap.timeOfDay.night;
    const todMax = Math.max(
      1,
      wrap.timeOfDay.morning,
      wrap.timeOfDay.afternoon,
      wrap.timeOfDay.evening,
      wrap.timeOfDay.night
    );
    const todRows = [
      { label: t("Утро (06–12)", "Morning (06–12)"), cnt: wrap.timeOfDay.morning },
      { label: t("День (12–18)", "Afternoon (12–18)"), cnt: wrap.timeOfDay.afternoon },
      { label: t("Вечер (18–24)", "Evening (18–24)"), cnt: wrap.timeOfDay.evening },
      { label: t("Ночь (00–06)", "Night (00–06)"), cnt: wrap.timeOfDay.night },
    ]
      .map((r) => {
        const pct = todTotal > 0 ? Math.round((r.cnt / todMax) * 100) : 0;
        return `
          <div class="atv-hist-row">
            <span class="atv-hist-label is-wide">${escapeHtml(r.label)}</span>
            <div class="atv-hist-bar-wrap">
              <div class="atv-hist-bar-fill" style="width:${pct}%"></div>
            </div>
            <span class="atv-hist-count">${r.cnt}</span>
          </div>
        `;
      })
      .join("");

    bodyEl.innerHTML = `
      <div class="atv-cinema-wrap-card" id="cinema-wrap-banner">
        <div class="atv-cinema-wrap-top">
          <div class="atv-cinema-wrap-title-group">
            <span class="atv-cinema-wrap-eyebrow">${escapeHtml(t("Кино-итоги · Cinema Wrap", "Cinema Wrap · Personal Analytics"))}</span>
            <h3 class="atv-cinema-wrap-persona">${escapeHtml(wrap.personaLabel)}</h3>
          </div>
          <button type="button" class="atv-btn-secondary atv-btn-xs" id="btn-copy-cinema-wrap">
            ${escapeHtml(t("Скопировать итоги", "Copy Wrap"))}
          </button>
        </div>
        <div class="atv-cinema-wrap-pills">
          <div class="atv-cinema-wrap-pill">
            <span class="atv-cinema-wrap-pill-lbl">${escapeHtml(t("Главный жанр", "Top Genre"))}</span>
            <span class="atv-cinema-wrap-pill-val">${escapeHtml(wrap.topGenreLabel)}</span>
          </div>
          <div class="atv-cinema-wrap-pill">
            <span class="atv-cinema-wrap-pill-lbl">${escapeHtml(t("Просмотрено серий", "Episodes Watched"))}</span>
            <span class="atv-cinema-wrap-pill-val">${escapeHtml(wrap.episodesWatched)}</span>
          </div>
          <div class="atv-cinema-wrap-pill">
            <span class="atv-cinema-wrap-pill-lbl">${escapeHtml(t("Рекорд марафона за день", "Longest Daily Marathon"))}</span>
            <span class="atv-cinema-wrap-pill-val">${escapeHtml(wrap.longestMarathon)} ${escapeHtml(
      t(pluralRu(wrap.longestMarathon, "сеанс", "сеанса", "сеансов"), wrap.longestMarathon === 1 ? "session" : "sessions")
    )}</span>
          </div>
          <div class="atv-cinema-wrap-pill">
            <span class="atv-cinema-wrap-pill-lbl">${escapeHtml(t("Любимая эпоха", "Favorite Era"))}</span>
            <span class="atv-cinema-wrap-pill-val">${escapeHtml(wrap.favDecade)}</span>
          </div>
        </div>
      </div>

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
          ${
            topGenresHtml
              ? `<h4 class="atv-stats-subhead">${t("Любимые жанры", "Favorite Genres")}</h4>${topGenresHtml}`
              : ""
          }
          <h4 class="atv-stats-subhead">${t("Ритм просмотра по времени суток", "Watch Activity by Time of Day")}</h4>
          ${todRows}
        </div>
        <div class="atv-stats-card">
          <h4>${t("Просмотрено по десятилетиям", "Watched by Decade")}</h4>
          ${decHtml}
          ${
            yearlyHtml
              ? `<h4 class="atv-stats-subhead">${t("Кино-итоги по годам релиза", "Year in Review (by Release Year)")}</h4>${yearlyHtml}`
              : ""
          }
          <h4 class="atv-stats-subhead">${t("Совпадение вкусов с друзьями Kinorium", "Taste Match with Kinorium Friends")}</h4>
          ${friendsHtml}
        </div>
      </div>

      <div class="atv-stats-columns">
        <div class="atv-stats-card" id="wrap-top-directors">
          <h4>${t("Любимые режиссёры", "Favorite Directors")}</h4>
          ${renderPersonChips(wrap.topDirectors, "director")}
        </div>
        <div class="atv-stats-card" id="wrap-top-actors">
          <h4>${t("Любимые актёры", "Favorite Actors")}</h4>
          ${renderPersonChips(wrap.topActors, "actor")}
        </div>
      </div>

      <div class="atv-stats-card">
        <h4>${t("Любимые фильмы и сериалы", "Top Favorites")}</h4>
        ${favsHtml}
      </div>
    `;

    const copyWrapBtn = document.getElementById("btn-copy-cinema-wrap");
    if (copyWrapBtn) {
      copyWrapBtn.onclick = async () => {
        const textSummary = isEn()
          ? `Velarium Wrap — ${wrap.personaLabel}: ${st.total_watched || 0} titles (${moviesCount} movies, ${seriesCount} series, ${wrap.episodesWatched} episodes), ~${hoursCount} hours (${daysCount} days), Top Genre: ${wrap.topGenreLabel}, Avg Rating: ${st.avg_user_rating || "—"}/10`
          : `Кино-итоги Velarium — ${wrap.personaLabel}: ${st.total_watched || 0} тайтлов (${moviesCount} фильмов, ${seriesCount} сериалов, ${wrap.episodesWatched} серий), ~${hoursCount} часов (${daysCount} суток), Главный жанр: ${wrap.topGenreLabel}, Средняя оценка: ${st.avg_user_rating || "—"}/10`;
        const ok = await copyTextToClipboard(textSummary);
        if (ok) {
          showToast(t("Кино-итоги скопированы в буфер обмена", "Cinema Wrap summary copied to clipboard"));
        }
      };
    }

    bodyEl.querySelectorAll(".atv-wrap-person-chip").forEach((chip) => {
      chip.onclick = () => {
        const pName = chip.getAttribute("data-person-name") || "";
        const pRole = chip.getAttribute("data-person-role") || "actor";
        if (!pName) return;
        closeStatsModal({ suppressFocusRestore: true });
        openPersonModal({ name: pName, role: pRole });
      };
    });

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
