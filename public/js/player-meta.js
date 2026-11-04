import { state } from "./state.js?v=20261104v22";
import {
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
  translateGenre,
  translateStudioName,
} from "./i18n.js?v=20261104v22";
import {
  escapeAttr,
  escapeHtml,
  formatDurationLabel,
  formatTime,
  getSimilarReasonLabel,
  getSimilarSectionSourceLabel,
  iconSvg,
  resolveClientSimilarBundle,
  showToast,
  showVideoOsd,
  syncCustomSelect,
  syncSearchInputHasQueryUI,
} from "./utils.js?v=20261104v22";
import { getPlayerPrefs, savePlayerPrefs } from "./audio-dsp.js?v=20261104v22";
import {
  applyEnabledServicesVisibility,
  attachSmartPosterFallback,
  isServiceEnabled,
  loadCatalog,
  renderCatalogShelves,
  resolveSeriesEpisodeInfo,
  updateActiveFiltersBadge,
  updateDynamicCatalogFilters,
  updateKinoriumSectionCounters,
} from "./catalog.js?v=20261104v22";
import { openQuickPeekModal, renderModalCastSection } from "./modals.js?v=20261104v22";
import { confirmServiceLogin, triggerServiceLoginFlow } from "./settings.js?v=20261104v22";
import { syncNativeNowPlaying } from "./features.js?v=20261104v22";
import { getEffectivePlaybackTiming } from "./player-remux.js?v=20261104v22";
import {
  getEpisodeDisplayMeta,
  populateSeasonEpisodeSelectors,
  updateCurrentEpisodeBar,
} from "./player-seasons.js?v=20261104v22";
import { switchSourceTab } from "./player-streams.js?v=20261104v22";
import { setMiniPlayerMode } from "./player-pip-dock.js?v=20261104v22";
import { closePlayerModal } from "./player.js?v=20261104v22";

export const OFFICIAL_STREAMING_SERVICES = new Set(["appletv", "netflix", "prime", "disney", "max", "playerpl"]);

export function _mergeItemProviders(item, incomingProviders) {
  if (!item || !Array.isArray(incomingProviders)) return;
  const baseProviders = (Array.isArray(item.providers) ? item.providers : []).filter(
    (p) => p && !OFFICIAL_STREAMING_SERVICES.has(p.id)
  );
  incomingProviders.forEach((p) => {
    if (p && p.id) baseProviders.push(p);
  });
  item.providers = baseProviders;
}

export function fetchAndApplyPlayerTitleMeta(item, currentSess = state.playerSessionId) {
  if (!item) return Promise.resolve(null);
  const reqLang = state.appLang || "ru";
  const metaParams = new URLSearchParams({
    id: String(item.id || ""),
    item_id: String(item.id || ""),
    rezka_id: String(item.rezka_id || ""),
    kinorium_id: String(item.kinorium?.kinorium_id || item.kinorium_id || ""),
    rezka_url: item.rezka_url || "",
    title: item.title || "",
    orig_title: item.orig_title || "",
    year: String(item.year || ""),
    media_type: item.media_type || "movie",
    lang: reqLang,
  });
  return fetch(`/api/title-meta?${metaParams.toString()}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((m) => {
      const isItemMatch =
        state.activeItem === item ||
        (state.activeItem && item && String(state.activeItem.id || "") === String(item.id || ""));
      if (!state.isPlayerOpen || state.playerSessionId !== currentSess || !isItemMatch) {
        return null;
      }
      if (m.rezka_id) item.rezka_id = m.rezka_id;
      if (m.rezka_url) item.rezka_url = m.rezka_url;
      if (m.kinorium_id && !item.kinorium_id) item.kinorium_id = m.kinorium_id;
      if (m.poster_en) item.poster_en = m.poster_en;
      if (m.kinorium_status && typeof m.kinorium_status === "object") {
        item.kinorium = { ...(item.kinorium || {}), ...m.kinorium_status };
      }
      if (m.ratings && typeof m.ratings === "object") {
        const nextRatings = { ...(item.ratings || {}) };
        for (const [k, v] of Object.entries(m.ratings)) {
          if (v != null) {
            nextRatings[k] = v;
          }
        }
        item.ratings = nextRatings;
      }
      if (m.kinorium_rating != null) {
        item.ratings = { ...(item.ratings || {}), kinorium: m.kinorium_rating };
      } else if (item.kinorium?.kinorium_rating != null) {
        item.ratings = { ...(item.ratings || {}), kinorium: item.kinorium.kinorium_rating };
      }
      if (m.imdb_rating != null) {
        item.ratings = { ...(item.ratings || {}), imdb: m.imdb_rating };
      } else if (item.kinorium?.imdb_rating != null && item.ratings?.imdb == null) {
        item.ratings = { ...(item.ratings || {}), imdb: item.kinorium.imdb_rating };
      }
      const kinVal = item.kinorium?.kinorium_rating || item.ratings?.kinorium || "—";
      const imdbVal = item.ratings?.imdb || item.kinorium?.imdb_rating || "—";
      const rkEl = document.getElementById("meta-r-kinorium");
      const riEl = document.getElementById("meta-r-imdb");
      if (rkEl) rkEl.textContent = kinVal;
      if (riEl) riEl.textContent = imdbVal;
      if (m.critics_rating != null) {
        item.ratings = { ...(item.ratings || {}), critics: m.critics_rating };
        const crEl = document.getElementById("meta-r-critics");
        if (crEl) crEl.textContent = formatCriticsRating(item, m.critics_rating);
      }
      if (reqLang === "en") {
        if (m.description && m.description.length > 15 && !hasCyrillicText(m.description)) {
          item.description_en = m.description;
        }
        if (m.directors?.length) item.directors_en = m.directors;
        if (m.actors?.length) item.actors_en = m.actors;
        if (m.cast_people?.length) item.cast_people_en = m.cast_people;
        if (isEn()) {
          const descEl = document.getElementById("meta-description");
          if (descEl) descEl.textContent = displayDescription(item) || "";
        }
      } else {
        if (m.description && m.description.length > 15) {
          item.description = m.description;
          if (!isEn()) {
            const descEl = document.getElementById("meta-description");
            if (descEl) descEl.textContent = m.description;
          }
        }
        if (m.directors?.length) item.directors = m.directors;
        if (m.actors?.length) item.actors = m.actors;
        if (m.cast_people?.length) item.cast_people = m.cast_people;
      }
      const activeDescEl = document.getElementById("meta-description");
      if (activeDescEl) {
        activeDescEl.textContent = displayDescription(item) || "";
      }
      if (m.duration_label) item.duration_label = m.duration_label;
      mergeIncomingItemGenres(item, m);
      renderModalGenresAndSubheader(item, m);
      renderModalCastSection(item, m);
      if (typeof m.is_completed === "boolean") item.is_series_completed = m.is_completed;
      if (m.episodes_titles && Object.keys(m.episodes_titles).length > 0) {
        state.episodesTitles = { ...(state.episodesTitles || {}), ...m.episodes_titles };
      }
      if (m.episodes_meta && Object.keys(m.episodes_meta).length > 0) {
        state.episodesMeta = { ...(state.episodesMeta || {}), ...m.episodes_meta };
      }
      if (m.kinorium_counts) {
        state.kinoriumCounts = { ...state.kinoriumCounts, ...m.kinorium_counts };
        updateKinoriumSectionCounters();
      }
      if (m.kinorium_status) {
        item.kinorium = m.kinorium_status;
        state.catalogDirty = true;
        updateModalKinoriumHeader(m.kinorium_status);
      } else if (Array.isArray(m.friends_ratings)) {
        item.kinorium = { ...(item.kinorium || {}), friends_ratings: m.friends_ratings };
        updateModalKinoriumHeader(item.kinorium);
      }
      const isSeriesResp = Boolean(
        item.media_type !== "movie" &&
        (m.media_type === "series" ||
          (m.seasons_map && Object.keys(m.seasons_map).length > 0) ||
          (m.kinorium_status && m.kinorium_status.media_type === "series"))
      );
      if (isSeriesResp) {
        item.media_type = "series";
        if (state.activeItem) state.activeItem.media_type = "series";
        const bottomEpsPanel = document.getElementById("episodes-bottom-panel");
        if (bottomEpsPanel && state.activeSourceTab !== "trailer") {
          bottomEpsPanel.classList.remove("hidden");
        }
        document.getElementById("season-group")?.classList.remove("hidden");
        document.getElementById("ep-nav-group")?.classList.remove("hidden");
        document.getElementById("current-episode-bar")?.classList.remove("hidden");
        document.getElementById("skip-intro-footer-controls")?.classList.remove("hidden");
        if (m.seasons_map && Object.keys(m.seasons_map).length > 0) {
          if (Object.keys(state.seasonsMap || {}).length === 0) {
            state.seasonsMap = m.seasons_map;
          }
        }
        populateSeasonEpisodeSelectors(item, state.seasonsMap);
        updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);
      } else if (item.media_type === "movie") {
        const bottomEpsPanel = document.getElementById("episodes-bottom-panel");
        if (bottomEpsPanel) bottomEpsPanel.classList.add("hidden");
        document.getElementById("season-group")?.classList.add("hidden");
        document.getElementById("ep-nav-group")?.classList.add("hidden");
        document.getElementById("current-episode-bar")?.classList.add("hidden");
        document.getElementById("skip-intro-footer-controls")?.classList.add("hidden");
        populateSeasonEpisodeSelectors(item, null);
      }
      if (Array.isArray(m.studios) && m.studios.length > 0) {
        state.availableStudios = m.studios;
        if (item) item.studios = m.studios;
        const studioSel = document.getElementById("select-studio");
        if (studioSel && studioSel.options.length <= 1) {
          studioSel.innerHTML = "";
          m.studios.forEach((st) => {
            const opt = document.createElement("option");
            opt.value = String(st.id);
            opt.dataset.rawName = st.name || "";
            opt.textContent = translateStudioName(st.name);
            opt.dataset.isOriginal = st.is_original ? "1" : "0";
            if (String(st.id) === String(state.activeStudioId)) {
              opt.selected = true;
            }
            studioSel.appendChild(opt);
          });
          syncCustomSelect(studioSel);
        }
      }
      renderModalGenresAndSubheader(item, m);
      renderModalCastSection(item, m);
      if (Array.isArray(m.providers)) {
        _mergeItemProviders(item, m.providers);
      }
      applyEnabledServicesVisibility(item);
      renderModalProvidersSidebar(item);
      if (Array.isArray(m.similar_items) && m.similar_items.length > 0) {
        item._cachedSimilarItems = m.similar_items;
        item._cachedSimilarSource = m.similar_source || "kinorium";
        renderModalSimilarItems(item, m.similar_items, m.similar_source);
      } else {
        renderModalSimilarItems(item);
      }
      return m;
    })
    .catch(() => null);
}

export function syncPlayerSidebarCollapsedUI() {
  const collapsed = Boolean(getPlayerPrefs().sidebarCollapsed);
  const sheet = document.querySelector("#player-modal .atv-cinema-sheet");
  if (sheet) {
    sheet.classList.toggle("sidebar-collapsed", collapsed);
  }
  const btn = document.getElementById("btn-toggle-player-sidebar");
  if (btn) {
    btn.classList.toggle("active", collapsed);
    btn.setAttribute("aria-pressed", collapsed ? "true" : "false");
    const tip = collapsed
      ? t("Показать боковую панель с описанием (T)", "Show info sidebar (T)")
      : t("Широкий экран без боковой панели (T)", "Wide view without sidebar (T)");
    btn.title = tip;
    btn.setAttribute("aria-label", tip);
  }
}

export function togglePlayerSidebarCollapsed(showFeedback = false) {
  const cur = Boolean(getPlayerPrefs().sidebarCollapsed);
  const next = !cur;
  savePlayerPrefs({ sidebarCollapsed: next });
  syncPlayerSidebarCollapsedUI();
  if (showFeedback) {
    showVideoOsd(
      "crop",
      next ? t("Широкий экран", "Wide View") : t("Боковая панель показана", "Sidebar Visible")
    );
  }
}

export async function filterCatalogByGenreFromPlayer(entry) {
  if (!entry) return;
  const video = document.getElementById("native-video");
  const isPlayingVideo = Boolean(
    video &&
      !video.paused &&
      !video.ended &&
      video.readyState >= 2 &&
      state.activeSourceTab !== "trailer"
  );
  if (isPlayingVideo) {
    setMiniPlayerMode(true);
  } else {
    closePlayerModal(true);
  }
  document.getElementById("search-live-popover")?.classList.add("hidden");

  const hadRestrictedCatalog = Boolean(
    (state.searchQuery && state.searchQuery.trim()) ||
      state.kinoriumSection !== "all" ||
      state.providerFilter !== "all"
  );
  state.searchQuery = "";
  state.kinoriumSection = "all";
  state.providerFilter = "all";
  state.mediaTypeFilter = "all";
  state.yearFilter = "all";
  state.friendsFilter = false;
  state.selectedFriend = "all";
  state.genreFilter = isEn() ? entry.en : entry.ru;

  const searchInput = document.getElementById("global-search");
  if (searchInput) searchInput.value = "";
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

  if (hadRestrictedCatalog || !Array.isArray(state.catalogItems) || state.catalogItems.length === 0) {
    await loadCatalog();
  } else {
    updateDynamicCatalogFilters();
    renderCatalogShelves();
  }

  if (state.genreFilter === "all") {
    state.searchQuery = entry.label;
    if (searchInput) searchInput.value = entry.label;
    syncSearchInputHasQueryUI();
    await loadCatalog();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
  showToast(`${t("Жанр", "Genre")}: ${entry.label}`);
}

export function renderModalGenresAndSubheader(item, streamData = null) {
  if (!item) return;
  const entries = getItemGenreEntries(item);
  const durLabel = formatDurationLabel(streamData?.duration_label || item?.duration_label || "");
  const countryLabel = displayCountries(item, streamData);
  const origSubtitleEl = document.getElementById("modal-orig-title");
  if (origSubtitleEl) {
    const typeText = item.media_type === "series" ? t("Сериал", "Series") : t("Фильм", "Movie");
    let seriesStatusText = "";
    if (item.media_type === "series") {
      const epInfo = resolveSeriesEpisodeInfo(item);
      const isCompleted = Boolean(
        streamData?.is_completed ||
          epInfo.isCompleted ||
          item.is_series_completed ||
          item.kinorium?.is_completed
      );
      seriesStatusText = isCompleted ? t("Завершён", "Ended") : t("Продолжается", "Ongoing");
    }
    const genresInline = entries
      .slice(0, 3)
      .map((g) => g.label)
      .join(", ");
    origSubtitleEl.textContent = [secondaryTitle(item), item.year, countryLabel, typeText, seriesStatusText, genresInline, durLabel]
      .filter(Boolean)
      .join(" · ");
  }

  const countryLineEl = document.getElementById("meta-country-line");
  if (countryLineEl) {
    if (countryLabel) {
      countryLineEl.textContent = `${t("Страна", "Country")}: ${countryLabel}`;
      countryLineEl.classList.remove("hidden");
    } else {
      countryLineEl.textContent = "";
      countryLineEl.classList.add("hidden");
    }
  }

  const genresListEl = document.getElementById("meta-genres-list");
  if (!genresListEl) return;
  if (entries.length === 0) {
    genresListEl.classList.add("hidden");
    genresListEl.innerHTML = "";
    return;
  }
  genresListEl.classList.remove("hidden");
  genresListEl.innerHTML = "";
  entries.slice(0, 5).forEach((entry) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "atv-meta-genre-chip";
    btn.setAttribute("role", "listitem");
    btn.title = `${t("Показать тайтлы жанра", "Filter catalog by genre")}: ${entry.label}`;
    btn.textContent = entry.label;
    btn.onclick = () => {
      filterCatalogByGenreFromPlayer(entry);
    };
    genresListEl.appendChild(btn);
  });
}

export function updateModalKinoriumHeader(kStatus) {
  const statusMenuBtn = document.getElementById("btn-kinorium-status-menu");
  const statusSummaryLabel = document.getElementById("kinorium-status-summary-label");
  const watchingBtn = document.getElementById("btn-toggle-watching");
  const watchingText = document.getElementById("watching-text");
  const watchedBtn = document.getElementById("btn-toggle-watched");
  const watchedText = document.getElementById("watched-text");
  const rateBtn = document.getElementById("btn-open-rate");
  const rateLabel = document.getElementById("user-rating-label");
  const watchlistBtn = document.getElementById("btn-toggle-watchlist");
  const watchlistText = document.getElementById("watchlist-text");
  const neverBtn = document.getElementById("btn-toggle-never");
  const neverText = document.getElementById("never-text");

  if (watchingBtn && watchingText) {
    watchingBtn.classList.toggle("active-watching", Boolean(kStatus.watching));
    watchingText.innerHTML = `${iconSvg("play", 12)}<span>${t("Смотрю", "Watching")}</span>${
      kStatus.watching ? `<span class="atv-status-menu-check">${iconSvg("check", 12)}</span>` : ""
    }`;
  }

  if (watchedBtn && watchedText) {
    watchedBtn.classList.toggle("active-watched", Boolean(kStatus.watched));
    watchedText.innerHTML = `${iconSvg("check", 12)}<span>${
      kStatus.watched ? t("Просмотрено", "Watched") : t("Отметить просмотренным", "Mark as watched")
    }</span>${
      kStatus.watched ? `<span class="atv-status-menu-check">${iconSvg("check", 12)}</span>` : ""
    }`;
  }

  const isSeriesItem = state.activeItem?.media_type === "series";
  if (rateBtn && rateLabel) {
    rateBtn.classList.toggle("active-rated", Boolean(kStatus.user_rating));
    rateBtn.title = isSeriesItem
      ? t("Оценить весь сериал в Kinorium", "Rate entire series on Kinorium")
      : t("Оценить фильм в Kinorium", "Rate movie on Kinorium");
    rateLabel.innerHTML = kStatus.user_rating
      ? `${iconSvg("star", 12)}<span>${
          isSeriesItem
            ? t(`Сериал: ${kStatus.user_rating}/10`, `Series: ${kStatus.user_rating}/10`)
            : `${kStatus.user_rating}/10`
        }</span>`
      : `${iconSvg("star", 12)}<span>${
          isSeriesItem ? t("Оценить сериал", "Rate series") : t("Оценить фильм", "Rate movie")
        }</span>`;
  }

  if (watchlistBtn && watchlistText) {
    watchlistBtn.classList.remove("active-watched");
    watchlistBtn.classList.toggle("active-watchlist", Boolean(kStatus.in_watchlist));
    watchlistText.innerHTML = `${iconSvg(kStatus.in_watchlist ? "star" : "plus", 12)}<span>${t(
      "Буду смотреть",
      "Watchlist"
    )}</span>${
      kStatus.in_watchlist ? `<span class="atv-status-menu-check">${iconSvg("check", 12)}</span>` : ""
    }`;
  }

  if (neverBtn && neverText) {
    neverBtn.classList.toggle("active-never", Boolean(kStatus.not_watching));
    neverText.innerHTML = `${iconSvg("x", 12)}<span>${t("Не буду смотреть", "Won't watch")}</span>${
      kStatus.not_watching ? `<span class="atv-status-menu-check">${iconSvg("check", 12)}</span>` : ""
    }`;
  }

  if (statusMenuBtn && statusSummaryLabel) {
    statusMenuBtn.classList.remove("active-watching", "active-watched", "active-watchlist", "active-never");
    if (kStatus.watching) {
      statusMenuBtn.classList.add("active-watching");
      statusSummaryLabel.innerHTML = `${iconSvg("play", 12)}<span>${t("Смотрю", "Watching")}</span>`;
    } else if (kStatus.watched) {
      statusMenuBtn.classList.add("active-watched");
      statusSummaryLabel.innerHTML = `${iconSvg("check", 12)}<span>${t("Просмотрено", "Watched")}</span>`;
    } else if (kStatus.in_watchlist) {
      statusMenuBtn.classList.add("active-watchlist");
      statusSummaryLabel.innerHTML = `${iconSvg("star", 12)}<span>${t("Буду смотреть", "Watchlist")}</span>`;
    } else if (kStatus.not_watching) {
      statusMenuBtn.classList.add("active-never");
      statusSummaryLabel.innerHTML = `${iconSvg("x", 12)}<span>${t("Не смотрю", "Hidden")}</span>`;
    } else {
      statusSummaryLabel.innerHTML = `<span>${t("Статус", "Status")}</span>`;
    }
  }

  const friendsEl = document.getElementById("meta-friends-list");
  const friendsSec = document.getElementById("sidebar-friends-section");
  const frList = (Array.isArray(kStatus?.friends_ratings) && kStatus.friends_ratings.length > 0)
    ? kStatus.friends_ratings
    : (Array.isArray(state.activeItem?.kinorium?.friends_ratings) ? state.activeItem.kinorium.friends_ratings : []);
  if (frList.length > 0 && friendsEl) {
    if (friendsSec) friendsSec.classList.remove("hidden");
    friendsEl.innerHTML = frList
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
  } else {
    if (friendsSec) friendsSec.classList.add("hidden");
    if (friendsEl) friendsEl.innerHTML = "";
  }
}

export function getOfficialServiceTargetUrl(serviceId, item) {
  const q = encodeURIComponent(item?.orig_title || item?.title || "");
  const cc = String(state.userCountry || "PL").trim().toLowerCase() || "pl";
  const disneyLocaleMap = {
    gb: "en-gb",
    ie: "en-gb",
    de: "de-at",
    at: "de-at",
    ch: "de-ch",
    fr: "fr-fr",
    be: "fr-be",
    it: "it-it",
    es: "es-es",
    pt: "pt-pt",
    nl: "nl-nl",
    pl: "pl-pl",
    cz: "cs-cz",
    sk: "sk-sk",
    hu: "hu-hu",
    ro: "ro-ro",
    tr: "tr-tr",
    gr: "el-gr",
    se: "sv-se",
    no: "nb-no",
    dk: "da-dk",
    fi: "fi-fi",
  };
  const disneyLocale = disneyLocaleMap[cc] || "en-gb";
  const appleCc = /^[a-z]{2}$/.test(cc) ? cc : "us";
  const defaults = {
    appletv: `https://tv.apple.com/${appleCc}/search?term=${q}`,
    netflix: `https://www.netflix.com/search?q=${q}`,
    prime: `https://www.primevideo.com/search?phrase=${q}`,
    disney: `https://www.disneyplus.com/${disneyLocale}`,
    max: `https://play.max.com/search?q=${q}`,
    playerpl: "https://player.pl",
  };
  const matchedOffer = (item?.providers || []).find((p) => p.id === serviceId && p.available);
  return matchedOffer?.url || defaults[serviceId] || `https://tv.apple.com/${appleCc}`;
}

export function renderModalProvidersSidebar(item) {
  const secEl = document.getElementById("sidebar-providers-section");
  const listEl = document.getElementById("meta-providers-list");
  if (!listEl || !item) return;
  const allKeys = ["appletv", "netflix", "prime", "disney", "max", "playerpl"].filter((k) =>
    isServiceEnabled(k)
  );
  listEl.innerHTML = "";

  // Strictly filter to services where this title is ACTUALLY available!
  const availableKeys = allKeys.filter((key) => {
    const found = (item.providers || []).find((p) => p && p.id === key && p.available);
    return Boolean(found);
  });

  if (secEl) {
    secEl.classList.toggle("hidden", availableKeys.length === 0);
  }
  if (availableKeys.length === 0) {
    listEl.innerHTML = "";
    return;
  }

  availableKeys.forEach((key) => {
    const meta = state.providersMeta[key] || state.integrations?.[key] || { name: key };
    const found = (item.providers || []).find((p) => p && p.id === key && p.available);
    const integ = state.integrations?.[key] || { logged_in: false };
    const isPendingLogin = Boolean(state.pendingServiceLogins?.[key]);

    const row = document.createElement("button");
    row.type = "button";
    row.className = `meta-prov-item is-clickable${state.activeSourceTab === key ? " is-active-source" : ""}`;

    let rightHtml = "";
    if (integ.logged_in) {
      rightHtml = `<span class="meta-prov-action">${escapeHtml(
        found?.quality || t("В подписке", "Included")
      )} ${iconSvg("external", 11)}</span>`;
    } else if (isPendingLogin) {
      rightHtml = `<span class="meta-prov-action">${iconSvg("check", 11)} ${t(
        "Подтвердить вход",
        "Confirm sign-in"
      )}</span>`;
    } else {
      rightHtml = `<span class="meta-prov-action muted">${escapeHtml(
        `${found?.quality || t("Доступно", "Available")} · ${t("Войти", "Sign in")}`
      )}</span>`;
    }

    row.innerHTML = `
      <span class="meta-prov-name">${escapeHtml(meta.name)}</span>
      ${rightHtml}
    `;

    row.onclick = () => {
      const targetUrl = getOfficialServiceTargetUrl(key, item);
      if (!integ.logged_in) {
        if (isPendingLogin) {
          confirmServiceLogin(key);
        } else {
          triggerServiceLoginFlow(key, targetUrl);
        }
      } else {
        switchSourceTab(key, null, { fromUserClick: true });
        window.open(targetUrl, "_blank", "noopener,noreferrer,width=1280,height=760");
      }
    };

    listEl.appendChild(row);
  });
}

export function renderModalSimilarItems(item, overrideSimilarItems = null, overrideSource = "") {
  const listEl = document.getElementById("modal-similar-list");
  const secEl = document.getElementById("modal-similar-section");
  const sourceNoteEl = document.getElementById("modal-similar-source");
  if (!listEl || !secEl || !item) return;

  let topSimilar = [];
  let sourceType = "curated";
  if (Array.isArray(overrideSimilarItems) && overrideSimilarItems.length > 0) {
    topSimilar = overrideSimilarItems.slice(0, 8);
    sourceType = overrideSource || "kinorium";
  } else {
    const bundle = resolveClientSimilarBundle(item, 6);
    topSimilar = bundle.items;
    sourceType = bundle.source;
  }

  if (topSimilar.length === 0) {
    secEl.classList.add("hidden");
    if (sourceNoteEl) sourceNoteEl.classList.add("hidden");
    listEl.innerHTML = "";
    return;
  }
  secEl.classList.remove("hidden");
  if (sourceNoteEl) {
    sourceNoteEl.textContent = getSimilarSectionSourceLabel(sourceType);
    sourceNoteEl.classList.remove("hidden");
  }
  listEl.innerHTML = "";

  topSimilar.forEach((sim) => {
    const kinOn = isServiceEnabled("kinorium");
    const kRat = kinOn
      ? sim.kinorium?.kinorium_rating || sim.ratings?.kinorium || sim.ratings?.imdb || ""
      : sim.ratings?.imdb || sim.kinorium?.kinorium_rating || "";
    const reasonText = getSimilarReasonLabel(sim);
    const gText = reasonText
      ? reasonText
      : (sim.genres || [])
          .filter((g) => g !== "Сериал" && g !== "Фильм")
          .slice(0, 2)
          .map((g) => translateGenre(g))
          .join(", ");
    const metaSegments = [];
    if (sim.year) metaSegments.push(`<span>${escapeHtml(sim.year)}</span>`);
    if (kRat) {
      metaSegments.push(`<span class="atv-meta-rating">${iconSvg("star", 10)}<span>${escapeHtml(kRat)}</span></span>`);
    }
    if (gText) {
      metaSegments.push(`<span class="atv-similar-reason-tag">${escapeHtml(gText)}</span>`);
    }
    const simTitle = displayTitle(sim);
    const simPoster = displayPoster(sim);
    const card = document.createElement("div");
    card.className = "atv-similar-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.innerHTML = `
      <img class="atv-similar-poster" src="${escapeAttr(simPoster)}" alt="${escapeAttr(simTitle)}" loading="lazy" referrerpolicy="no-referrer" />
      <div class="atv-similar-info">
        <div class="atv-similar-title">${escapeHtml(simTitle)}</div>
        <div class="atv-similar-meta">${metaSegments.join(" · ")}</div>
      </div>
    `;
    const imgEl = card.querySelector("img");
    attachSmartPosterFallback(imgEl, simTitle, sim.year, sim.poster);
    card.onclick = () => {
      openQuickPeekModal(sim);
    };
    card.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openQuickPeekModal(sim);
      }
    };
    listEl.appendChild(card);
  });
}

export async function captureVideoScreenshot() {
  const video = document.getElementById("native-video");
  if (!video || (!video.videoWidth && !state.currentStreamUrl)) {
    showToast(
      t(
        "Подождите начала воспроизведения видео для снимка кадра",
        "Wait for video playback to start before capturing a frame"
      )
    );
    return;
  }
  const { cur } = getEffectivePlaybackTiming(video);
  const item = state.activeItem;
  const titlePart = (displayTitle(item) || item?.title || "CineFlow").replace(/[\\/:*?"<>|]+/g, "");
  const timeStamp = formatTime(cur || 0).replace(/:/g, "-");
  const epTag =
    item?.media_type === "series"
      ? `_S${String(state.activeSeason).padStart(2, "0")}E${String(state.activeEpisode).padStart(2, "0")}`
      : "";
  const filename = `${titlePart}${epTag}_${timeStamp}.png`;

  const savePngBlob = (blob, dimLabel = "") => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showVideoOsd("camera", t("Снимок кадра сохранён", "Frame snapshot saved"));
    showToast(
      t(
        `Снимок кадра сохранён: ${filename}${dimLabel}`,
        `Frame snapshot saved: ${filename}${dimLabel}`
      )
    );
  };

  const curSrc = String(video.currentSrc || video.getAttribute("src") || "");
  const isSameOriginVideo =
    video.hasAttribute("crossorigin") ||
    curSrc.startsWith("/") ||
    (typeof window !== "undefined" && window.location?.origin && curSrc.startsWith(window.location.origin));

  if (isSameOriginVideo && video.videoWidth > 0 && video.videoHeight > 0) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const localBlob = await new Promise((resolve) => {
        try {
          canvas.toBlob((b) => resolve(b || null), "image/png");
        } catch (_) {
          resolve(null);
        }
      });
      if (localBlob && localBlob.size > 200) {
        savePngBlob(localBlob, ` (${canvas.width}×${canvas.height})`);
        return;
      }
    } catch (_) {}
  }

  const rawUrl = state.remuxMeta?.active ? state.remuxMeta.rawSourceUrl : state.currentStreamUrl;
  if (!rawUrl) {
    showToast(t("Не удалось сделать снимок кадра для этого потока", "Could not capture a frame from this stream"));
    return;
  }
  try {
    showToast(t("Создание снимка кадра...", "Capturing frame..."));
    const qs = new URLSearchParams({
      url: rawUrl,
      ss: String(Math.max(0, Math.round(cur * 100) / 100)),
    });
    const res = await fetch(`/api/video-snapshot?${qs.toString()}`);
    if (!res.ok) {
      showToast(t("Не удалось сохранить кадр для текущего потока", "Could not save frame from current stream"));
      return;
    }
    const serverBlob = await res.blob();
    if (!serverBlob || serverBlob.size < 200) {
      showToast(t("Не удалось сохранить кадр для текущего потока", "Could not save frame from current stream"));
      return;
    }
    const dimLabel = video.videoWidth ? ` (${video.videoWidth}×${video.videoHeight})` : "";
    savePngBlob(serverBlob, dimLabel);
  } catch (_) {
    showToast(t("Не удалось сделать снимок кадра для этого потока", "Could not capture a frame from this stream"));
  }
}

export function syncMediaSessionMetadata() {
  syncNativeNowPlaying(true);
  if (typeof navigator === "undefined" || !("mediaSession" in navigator) || !state.activeItem) {
    return;
  }
  try {
    const item = state.activeItem;
    const isSeries = item.media_type === "series";
    const epMeta = isSeries ? getEpisodeDisplayMeta(state.activeSeason, state.activeEpisode) : null;
    const subtitle = isSeries
      ? `${t(
          `Сезон ${state.activeSeason}, Серия ${state.activeEpisode}`,
          `Season ${state.activeSeason}, Episode ${state.activeEpisode}`
        )}${epMeta?.realTitle ? ` — ${epMeta.realTitle}` : ""}`
      : String(item.year || "");
    const artworkUrl = item.poster || item.backdrop || "";
    navigator.mediaSession.metadata = new MediaMetadata({
      title: displayTitle(item) || "CineFlow",
      artist: subtitle || state.activeStudioName || "CineFlow",
      album: state.activeStudioName || "CineFlow",
      artwork: artworkUrl ? [{ src: artworkUrl }] : [],
    });
  } catch (_) {}
}
