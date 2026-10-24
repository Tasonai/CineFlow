import { PREFERRED_STUDIOS_STORAGE_KEY, state } from "./state.js?v=20261024v4";
import {
  displayDescription,
  displayPoster,
  displayTitle,
  formatCriticsRating,
  hasCyrillicText,
  isEn,
  t,
  translateGenre,
  translateStudioName,
} from "./i18n.js?v=20261024v4";
import {
  attachHorizontalWheelScroll,
  cssUrl,
  escapeAttr,
  escapeHtml,
  formatTime,
  genitiveAfterIz,
  getEpisodeProgress,
  getSeenNotificationsSet,
  iconSvg,
  pluralRu,
  saveSeenNotificationsSet,
  saveUiPrefs,
  setAmbientColor,
  showToast,
} from "./utils.js?v=20261024v4";
import { getPlayerPrefs } from "./audio-dsp.js?v=20261024v4";
import { openQuickPeekModal } from "./modals.js?v=20261024v4";
import { openPlayerModal, renderModalProvidersSidebar, switchSourceTab } from "./player.js?v=20261024v4";
import { confirmServiceLogin, openSettingsModal, triggerServiceLoginFlow } from "./settings.js?v=20261024v4";

export function updateActiveFiltersBadge() {
  let drawerCount = 0;
  if (state.genreFilter && state.genreFilter !== "all") drawerCount += 1;
  if (state.yearFilter && state.yearFilter !== "all") drawerCount += 1;
  if (state.hideWatched) drawerCount += 1;
  if (state.friendsFilter) drawerCount += 1;
  const badge = document.getElementById("active-filters-badge");
  const btn = document.getElementById("btn-toggle-catalog-filters");
  const sortSel = document.getElementById("select-catalog-sort");
  const drawer = document.getElementById("catalog-filters-drawer");
  const isOpen = Boolean(drawer && !drawer.classList.contains("hidden"));
  if (badge) {
    badge.textContent = String(drawerCount);
    badge.classList.toggle("hidden", drawerCount === 0);
  }
  if (btn) {
    btn.classList.toggle("active", drawerCount > 0 || isOpen);
  }
  if (sortSel) {
    sortSel.classList.toggle("active-sort", Boolean(state.sortBy && state.sortBy !== "default"));
  }
  renderActiveFilterChips();
}
export function updateDynamicCatalogFilters() {
  const genreSel = document.getElementById("select-catalog-genre");
  const yearSel = document.getElementById("select-catalog-year");
  const items = Array.isArray(state.catalogItems) ? state.catalogItems : [];

  if (genreSel) {
    const genreCounts = new Map();
    items.forEach((it) => {
      (it.genres || []).forEach((rawG) => {
        const g = String(rawG || "").trim();
        if (!g || g === "Фильм" || g === "Сериал") return;
        genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
      });
    });
    const sortedGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
      .map(([g]) => g);

    if (state.genreFilter !== "all" && items.length > 0 && !sortedGenres.some((g) => g.toLowerCase() === state.genreFilter.toLowerCase())) {
      state.genreFilter = "all";
    }

    genreSel.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = t("Все жанры", "All genres");
    genreSel.appendChild(allOpt);

    sortedGenres.forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = `${translateGenre(g)} (${genreCounts.get(g)})`;
      if (state.genreFilter.toLowerCase() === g.toLowerCase()) {
        opt.selected = true;
        state.genreFilter = g;
      }
      genreSel.appendChild(opt);
    });
    if (state.genreFilter === "all") {
      genreSel.value = "all";
    }
  }

  if (yearSel) {
    const yearCounts = new Map();
    let count2010_2019 = 0;
    let countBefore2010 = 0;
    items.forEach((it) => {
      const y = parseInt(it.year, 10) || 0;
      if (y <= 0) return;
      yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
      if (y >= 2010 && y <= 2019) count2010_2019 += 1;
      if (y < 2010) countBefore2010 += 1;
    });

    const sortedYears = Array.from(yearCounts.keys()).sort((a, b) => b - a);
    const validValues = new Set(["all"]);

    yearSel.innerHTML = "";
    const allYOpt = document.createElement("option");
    allYOpt.value = "all";
    allYOpt.textContent = t("Все годы", "All years");
    yearSel.appendChild(allYOpt);

    sortedYears.forEach((y) => {
      const val = String(y);
      validValues.add(val);
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = `${y} (${yearCounts.get(y)})`;
      yearSel.appendChild(opt);
    });

    if (count2010_2019 > 1) {
      validValues.add("2010_2019");
      const opt = document.createElement("option");
      opt.value = "2010_2019";
      opt.textContent = `2010–2019 (${count2010_2019})`;
      yearSel.appendChild(opt);
    }
    if (countBefore2010 > 0) {
      validValues.add("before_2010");
      const opt = document.createElement("option");
      opt.value = "before_2010";
      opt.textContent = `${t("До 2010", "Before 2010")} (${countBefore2010})`;
      yearSel.appendChild(opt);
    }

    if (state.yearFilter !== "all" && items.length > 0 && !validValues.has(state.yearFilter)) {
      state.yearFilter = "all";
    }
    yearSel.value = validValues.has(state.yearFilter) ? state.yearFilter : "all";
  }

  updateActiveFiltersBadge();
}
export function renderActiveFilterChips() {
  const chipsBar = document.getElementById("active-filter-chips-bar");
  if (!chipsBar) return;
  chipsBar.innerHTML = "";
  const chips = [];

  if (state.genreFilter && state.genreFilter !== "all") {
    chips.push({
      label: `${t("Жанр", "Genre")}: ${translateGenre(state.genreFilter)}`,
      clear: () => {
        state.genreFilter = "all";
        const sel = document.getElementById("select-catalog-genre");
        if (sel) sel.value = "all";
      },
    });
  }
  if (state.yearFilter && state.yearFilter !== "all") {
    const yearLabels = {
      "2026": "2026",
      "2025": "2025",
      "2024": "2024",
      "2020_2023": "2020–2023",
      "2010_2019": "2010–2019",
      before_2010: t("До 2010", "Before 2010"),
    };
    chips.push({
      label: `${t("Год", "Year")}: ${yearLabels[state.yearFilter] || state.yearFilter}`,
      clear: () => {
        state.yearFilter = "all";
        const sel = document.getElementById("select-catalog-year");
        if (sel) sel.value = "all";
      },
    });
  }
  if (state.sortBy && state.sortBy !== "default") {
    const sortLabels = {
      user_rating: t("Моя оценка", "My Rating"),
      friends_rating: t("Оценки друзей", "Friends' Ratings"),
      kinorium_rating: t("Рейтинг Кинориума", "Kinorium Rating"),
      year_desc: t("Сначала новые", "Newest First"),
    };
    chips.push({
      label: `${t("Сортировка", "Sort")}: ${sortLabels[state.sortBy] || state.sortBy}`,
      clear: () => {
        state.sortBy = "default";
        const sel = document.getElementById("select-catalog-sort");
        if (sel) sel.value = "default";
      },
    });
  }
  if (state.hideWatched) {
    chips.push({
      icon: "eyeOff",
      label: t("Без просмотренных", "Hide watched"),
      clear: () => {
        state.hideWatched = false;
        saveUiPrefs({ hideWatched: false });
        document.getElementById("btn-hide-watched")?.classList.remove("active");
      },
    });
  }
  if (state.friendsFilter) {
    const isSpecific = Boolean(state.selectedFriend && state.selectedFriend !== "all");
    chips.push({
      icon: isSpecific ? "user" : "users",
      label: isSpecific ? state.selectedFriend.split(" ")[0] : t("Оценили друзья", "Rated by friends"),
      clear: () => {
        state.friendsFilter = false;
        state.selectedFriend = "all";
        document.getElementById("btn-friends-filter")?.classList.remove("active");
        const sel = document.getElementById("select-friend-filter");
        if (sel) sel.value = "all";
      },
    });
  }

  chipsBar.classList.toggle("hidden", chips.length === 0);
  chips.forEach((ch) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "atv-filter-chip";
    btn.title = t("Нажмите, чтобы сбросить этот фильтр", "Click to clear filter");
    btn.innerHTML = `${ch.icon ? iconSvg(ch.icon, 12) : ""}<span>${escapeHtml(ch.label)}</span>${iconSvg("x", 11)}`;
    btn.onclick = () => {
      ch.clear();
      updateActiveFiltersBadge();
      renderCatalogShelves();
    };
    chipsBar.appendChild(btn);
  });
}
export function isEpisodeWatched(item, seasonNum, epNum) {
  if (!item || item.media_type !== "series") return false;
  const ks = item.kinorium || {};
  if (ks.watched && !ks.has_new_episode) return true;
  const weMap = ks.watched_episodes || {};
  const seasonList = weMap[String(seasonNum)];
  if (Array.isArray(seasonList) && seasonList.includes(Number(epNum))) {
    return true;
  }
  if (ks.watching || ks.has_new_episode) {
    const nextS = Number(ks.next_season || 1);
    const nextE = Number(ks.next_episode || 1);
    if (seasonNum < nextS || (seasonNum === nextS && epNum < nextE)) {
      return true;
    }
  }
  return false;
}
export function getPreferredStudioForItem(item) {
  if (!item) return null;
  try {
    const raw = localStorage.getItem(PREFERRED_STUDIOS_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) || {};
    const idKey = String(item.id || "").trim();
    const titleKey = String(item.title || "").trim().toLowerCase();
    return (idKey && map[idKey]) || (titleKey && map[titleKey]) || null;
  } catch (_) {
    return null;
  }
}
export function savePreferredStudioForItem(item, studioId, studioName) {
  if (!item || (!studioId && !studioName)) return;
  try {
    const raw = localStorage.getItem(PREFERRED_STUDIOS_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) || {} : {};
    const entry = {
      id: String(studioId || ""),
      name: String(studioName || ""),
      updated_at: Date.now(),
    };
    const idKey = String(item.id || "").trim();
    const titleKey = String(item.title || "").trim().toLowerCase();
    if (idKey) map[idKey] = entry;
    if (titleKey) map[titleKey] = entry;
    localStorage.setItem(PREFERRED_STUDIOS_STORAGE_KEY, JSON.stringify(map));
  } catch (_) {}
}
export function findSavedProgress(item) {
  if (!item || !state.continueWatching || state.continueWatching.length === 0) return null;
  const tLow = (item.title || "").trim().toLowerCase();
  const kid = item.kinorium?.kinorium_id ? `kin_${item.kinorium.kinorium_id}` : "";
  return (
    state.continueWatching.find(
      (cw) =>
        cw.id === item.id ||
        (kid && cw.id === kid) ||
        (tLow && (cw.title || "").trim().toLowerCase() === tLow)
    ) || null
  );
}
export function isServiceEnabled(serviceId) {
  if (!serviceId || serviceId === "all") return true;
  const integ = state.integrations?.[serviceId];
  if (!integ) return true;
  return integ.enabled !== false;
}
export function isAnyOfficialPlServiceEnabled() {
  return ["appletv", "netflix", "prime", "disney", "max", "playerpl"].some((k) =>
    isServiceEnabled(k)
  );
}
export function getDefaultPlayableSourceTab() {
  if (state.providerFilter === "stremio" && isServiceEnabled("stremio")) return "stremio";
  if (state.providerFilter === "backup4k" && isServiceEnabled("backup4k")) return "backup4k";
  const prefTab = getPlayerPrefs()?.preferredSourceTab || "";
  if (prefTab && isServiceEnabled(prefTab)) return prefTab;
  if (isServiceEnabled("hdrezka")) return "hdrezka";
  if (isServiceEnabled("stremio")) return "stremio";
  if (isServiceEnabled("backup4k")) return "backup4k";
  return "trailer";
}
export function getLiveSeriesUpdateForItem(item) {
  if (!item) return null;
  const ks = item.kinorium || {};
  const keys = [
    item.id,
    ks.kinorium_id ? `kin_${ks.kinorium_id}` : "",
    ks.kinorium_id ? String(ks.kinorium_id) : "",
    (item.title || "").trim().toLowerCase(),
    (item.orig_title || "").trim().toLowerCase(),
  ].filter(Boolean);
  for (const k of keys) {
    if (state.liveSeriesUpdates[k]) return state.liveSeriesUpdates[k];
  }
  return null;
}
export function resolveSeriesEpisodeInfo(item) {
  if (!item || item.media_type !== "series") {
    const cw = findSavedProgress(item);
    const localProg = !cw && item ? getEpisodeProgress(item, 1, 1) : null;
    const effectiveCur = Number(
      cw?.current_time || (localProg && Number(localProg.pct || 0) < 92 ? localProg.current_time : 0) || 0
    );
    return {
      season: 1,
      episode: 1,
      currentTime: effectiveCur,
      hasNewEpisode: false,
      isMidEpisodeResume: effectiveCur >= 15,
      episodeVerified: true,
      studio: cw?.studio || localProg?.studio || "HDRezka",
      watchedInSeasonCount: 0,
      totalSeasonEpisodes: 0,
      seasonPct: 0,
      hasSeasonProgress: false,
      seasonProgressText: "",
      seasonShortText: "",
    };
  }

  const catMatch =
    !item.kinorium && Array.isArray(state.catalogItems)
      ? state.catalogItems.find(
          (ci) =>
            ci.id === item.id ||
            (item.title && (ci.title || "").trim().toLowerCase() === item.title.trim().toLowerCase())
        )
      : null;

  const ks = item.kinorium || catMatch?.kinorium || {};
  const live = getLiveSeriesUpdateForItem(item) || (catMatch ? getLiveSeriesUpdateForItem(catMatch) : null);
  const savedCw = findSavedProgress(item);
  const isMidEpisodeResume = Boolean(
    savedCw && !savedCw.is_new_episode && Number(savedCw.current_time || 0) >= 15
  );
  const weMap = ks.watched_episodes || {};

  let hasNewEpisode = Boolean(
    item.is_new_episode || (ks.has_new_episode && !ks.watched && !ks.not_watching)
  );
  let season = Number(ks.next_season || item.season || catMatch?.season || 1);
  let episode = Number(ks.next_episode || item.episode || 1);
  let currentTime = isMidEpisodeResume ? Number(savedCw.current_time || 0) : 0;
  let episodeVerified = Boolean(ks.episode_verified || item.episode_verified || isMidEpisodeResume);
  let studio =
    live?.studios_summary ||
    ks.studios_summary ||
    (savedCw?.studio && savedCw.studio !== "Новая серия" ? savedCw.studio : "") ||
    (item.studio && item.studio !== "Новая серия" ? item.studio : "") ||
    "HDRezka";

  if (isMidEpisodeResume && savedCw) {
    season = Number(savedCw.season || season || 1);
    episode = Number(savedCw.episode || 1);
    episodeVerified = true;
  } else if (live && !live.not_found && live.latest_season && live.latest_episode) {
    const lSeason = Number(live.latest_season || 1);
    const lEp = Number(live.latest_episode || 1);
    const watchedInSeason = Array.isArray(weMap[String(lSeason)]) ? weMap[String(lSeason)] : [];
    if (watchedInSeason.length > 0) {
      const maxW = Math.max(...watchedInSeason.map((n) => Number(n) || 0));
      if (maxW >= lEp) {
        hasNewEpisode = false;
        season = lSeason;
        episode = lEp;
      } else {
        season = lSeason;
        episode = maxW + 1;
      }
    } else {
      const numericSeasons = Object.keys(weMap)
        .filter((k) => /^\d+$/.test(k) && Array.isArray(weMap[k]) && weMap[k].length > 0)
        .map((k) => Number(k))
        .sort((a, b) => a - b);
      if (numericSeasons.length > 0) {
        const maxPrevS = numericSeasons[numericSeasons.length - 1];
        const maxPrevEp = Math.max(...weMap[String(maxPrevS)].map((n) => Number(n) || 0));
        const prevSeasonMap = live.seasons_map?.[String(maxPrevS)];
        if (
          Array.isArray(prevSeasonMap) &&
          prevSeasonMap.length > 0 &&
          maxPrevEp < Math.max(...prevSeasonMap.map((n) => Number(n) || 0))
        ) {
          season = maxPrevS;
          episode = maxPrevEp + 1;
        } else {
          season = Math.min(lSeason, maxPrevS + 1);
          episode = 1;
        }
      } else if (savedCw && !savedCw.is_new_episode && (savedCw.season || savedCw.episode)) {
        season = Number(savedCw.season || 1);
        episode = Number(savedCw.episode || 1);
      } else {
        season = 1;
        episode = 1;
      }
    }
    episodeVerified = true;
  } else if (live && live.not_found && !isMidEpisodeResume) {
    hasNewEpisode = false;
    episodeVerified = false;
  }

  const finalSeason = Math.max(1, season || 1);
  const finalEpisode = Math.max(1, episode || 1);

  // Compute per-season episode progress (watchedInSeasonCount / totalSeasonEpisodes)
  let totalSeasonEpisodes = 0;
  if (live && !live.not_found) {
    const mapForS = live.seasons_map?.[String(finalSeason)];
    if (Array.isArray(mapForS) && mapForS.length > 0) {
      totalSeasonEpisodes = mapForS.length;
    } else if (Number(live.latest_season) === finalSeason && Number(live.latest_episode) > 0) {
      totalSeasonEpisodes = Number(live.latest_episode);
    }
  }
  if (!totalSeasonEpisodes && Number(ks.latest_season) === finalSeason && Number(ks.latest_episode) > 0) {
    totalSeasonEpisodes = Number(ks.latest_episode);
  }
  if (!totalSeasonEpisodes) {
    const fallbackEps = Number(item.episodes_per_season || catMatch?.episodes_per_season || 0);
    if (fallbackEps > 0) totalSeasonEpisodes = fallbackEps;
  }

  const rawSeasonWatched = Array.isArray(weMap[String(finalSeason)]) ? weMap[String(finalSeason)] : [];
  const watchedSet = new Set(
    rawSeasonWatched.map((n) => Number(n) || 0).filter((n) => n > 0)
  );
  let watchedInSeasonCount = 0;
  if (ks.watched && !hasNewEpisode && totalSeasonEpisodes > 0) {
    watchedInSeasonCount = totalSeasonEpisodes;
  } else if (watchedSet.size > 0) {
    watchedInSeasonCount =
      totalSeasonEpisodes > 0
        ? Math.min(
            totalSeasonEpisodes,
            [...watchedSet].filter((n) => n <= totalSeasonEpisodes).length || watchedSet.size
          )
        : watchedSet.size;
  } else if (isMidEpisodeResume && episodeVerified && finalEpisode > 1) {
    watchedInSeasonCount = finalEpisode - 1;
  }

  if (totalSeasonEpisodes > 0 && watchedInSeasonCount > totalSeasonEpisodes) {
    totalSeasonEpisodes = watchedInSeasonCount;
  } else if (!totalSeasonEpisodes && watchedInSeasonCount > 0 && finalEpisode > watchedInSeasonCount) {
    totalSeasonEpisodes = finalEpisode;
  }

  const kinEnabled = isServiceEnabled("kinorium");
  const hasSeasonProgress = Boolean(
    kinEnabled &&
      !ks.not_watching &&
      (watchedInSeasonCount > 0 || ((ks.watching || hasNewEpisode) && totalSeasonEpisodes > 0))
  );
  const seasonPct =
    totalSeasonEpisodes > 0
      ? Math.min(100, Math.round((watchedInSeasonCount / totalSeasonEpisodes) * 100))
      : 0;
  const seasonProgressText =
    totalSeasonEpisodes > 0
      ? isEn()
        ? `Watched ${watchedInSeasonCount} of ${totalSeasonEpisodes} ${totalSeasonEpisodes === 1 ? "episode" : "episodes"}`
        : `Просмотрено ${watchedInSeasonCount} из ${totalSeasonEpisodes} ${genitiveAfterIz(
            totalSeasonEpisodes,
            "серии",
            "серий"
          )}`
      : watchedInSeasonCount > 0
      ? isEn()
        ? `Watched ${watchedInSeasonCount} ${watchedInSeasonCount === 1 ? "episode" : "episodes"}`
        : `Просмотрено ${watchedInSeasonCount} ${pluralRu(watchedInSeasonCount, "серия", "серии", "серий")}`
      : "";
  const seasonShortText =
    totalSeasonEpisodes > 0
      ? isEn()
        ? `${watchedInSeasonCount} of ${totalSeasonEpisodes} ${totalSeasonEpisodes === 1 ? "episode" : "episodes"}`
        : `${watchedInSeasonCount} из ${totalSeasonEpisodes} ${genitiveAfterIz(
            totalSeasonEpisodes,
            "серии",
            "серий"
          )}`
      : watchedInSeasonCount > 0
      ? isEn()
        ? `${watchedInSeasonCount} ${watchedInSeasonCount === 1 ? "episode" : "episodes"}`
        : `${watchedInSeasonCount} ${pluralRu(watchedInSeasonCount, "серия", "серии", "серий")}`
      : "";

  return {
    season: finalSeason,
    episode: finalEpisode,
    currentTime,
    hasNewEpisode,
    isMidEpisodeResume,
    episodeVerified,
    studio,
    watchedInSeasonCount,
    totalSeasonEpisodes,
    seasonPct,
    hasSeasonProgress,
    seasonProgressText,
    seasonShortText,
  };
}
export function applyEnabledServicesVisibility() {
  // 1. Top Navigation Channel Bar (#provider-filter-bar)
  // Keep catalog navigation strictly focused on actual content channels (paid streaming catalogs),
  // separating playback engines (HDRezka / Stremio / 4K Remux) into the Player source switcher.
  const paidOfficialSet = new Set(["appletv", "netflix", "prime", "disney", "max", "playerpl"]);
  const playbackEngineSet = new Set(["hdrezka", "stremio", "backup4k"]);
  const isTopBarProviderVisible = (prov) => {
    if (!prov || prov === "all") return true;
    if (playbackEngineSet.has(prov)) return false;
    if (!isServiceEnabled(prov)) return false;
    if (paidOfficialSet.has(prov)) {
      return Boolean(state.integrations?.[prov]?.logged_in);
    }
    return true;
  };
  let visibleChannelsCount = 0;
  document.querySelectorAll("#provider-filter-bar .atv-pill").forEach((pill) => {
    const prov = pill.dataset.provider;
    if (!prov || prov === "all") return;
    const isVis = isTopBarProviderVisible(prov);
    pill.classList.toggle("hidden", !isVis);
    if (isVis) visibleChannelsCount += 1;
  });
  document
    .getElementById("provider-filter-bar")
    ?.classList.toggle("hidden", visibleChannelsCount === 0);
  if (state.providerFilter !== "all" && !isTopBarProviderVisible(state.providerFilter)) {
    state.providerFilter = "all";
    document.querySelectorAll("#provider-filter-bar .atv-pill").forEach((pill) => {
      pill.classList.toggle("active", pill.dataset.provider === "all");
    });
  }

  // 2. Kinorium UI across main page, filters, notifications, stats, quick peek & player
  const kinEnabled = isServiceEnabled("kinorium");
  const rezkaEnabled = isServiceEnabled("hdrezka");
  const stremioEnabled = isServiceEnabled("stremio");
  const b4kEnabled = isServiceEnabled("backup4k");
  const primaryPlayTab = getDefaultPlayableSourceTab();
  const officialAny = isAnyOfficialPlServiceEnabled();

  document.querySelectorAll("#kinorium-sections-bar .kin-sec-pill").forEach((pill) => {
    const ksec = pill.dataset.ksec;
    if (ksec && ["watching", "watchlist", "watched", "never"].includes(ksec)) {
      pill.classList.toggle("hidden", !kinEnabled);
    }
  });
  if (!kinEnabled && ["watching", "watchlist", "watched", "never"].includes(state.kinoriumSection)) {
    state.kinoriumSection = "all";
    document.querySelectorAll("#kinorium-sections-bar .kin-sec-pill").forEach((pill) => {
      pill.classList.toggle("active", pill.dataset.ksec === "all");
    });
  }

  document
    .getElementById("notifications-wrap")
    ?.classList.toggle("hidden", !kinEnabled || (!rezkaEnabled && !stremioEnabled));
  document.getElementById("btn-check-rezka-updates")?.classList.toggle("hidden", !rezkaEnabled);

  document.getElementById("btn-hide-watched")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("btn-friends-filter")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("select-friend-filter")?.classList.toggle("hidden", !kinEnabled);
  if (!kinEnabled) {
    state.hideWatched = false;
    state.friendsFilter = false;
    state.selectedFriend = "all";
  }

  const sortSel = document.getElementById("select-catalog-sort");
  if (sortSel) {
    Array.from(sortSel.options).forEach((opt) => {
      if (["user_rating", "friends_rating", "kinorium_rating"].includes(opt.value)) {
        opt.hidden = !kinEnabled;
      }
    });
    if (!kinEnabled && ["user_rating", "friends_rating", "kinorium_rating"].includes(state.sortBy)) {
      state.sortBy = "default";
      sortSel.value = "default";
    }
  }

  const statsBtn = document.getElementById("btn-open-stats-modal");
  if (statsBtn) {
    statsBtn.innerHTML = iconSvg(kinEnabled ? "chart" : "clock", 15);
    statsBtn.title = kinEnabled
      ? t("Моя статистика и история просмотров", "My statistics & watch history")
      : t("Локальная история просмотров", "Local watch history");
  }
  document.getElementById("stats-tab-analytics")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("stats-profile-badge")?.classList.toggle("hidden", !kinEnabled);

  // Player modal tabs & Kinorium controls
  document.querySelector('.source-tab[data-tab="hdrezka"]')?.classList.toggle("hidden", !rezkaEnabled);
  document.querySelector('.source-tab[data-tab="stremio"]')?.classList.toggle("hidden", !stremioEnabled);
  document.querySelector('.source-tab[data-tab="backup4k"]')?.classList.toggle("hidden", !b4kEnabled);

  document.getElementById("kinorium-status-dropdown-wrap")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("kinorium-rate-dropdown-wrap")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("btn-open-rate")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("score-box-kinorium")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("sidebar-friends-section")?.classList.toggle("hidden", !kinEnabled);

  // Quick Peek modal controls
  document.getElementById("qp-score-kinorium")?.classList.toggle("hidden", !kinEnabled);
  document.querySelector(".atv-qp-rate-box")?.classList.toggle("hidden", !kinEnabled);
  document.getElementById("qp-status-pills")?.classList.toggle("hidden", !kinEnabled);
  document
    .getElementById("qp-btn-stremio")
    ?.classList.toggle("hidden", !stremioEnabled || primaryPlayTab === "stremio");
  document
    .getElementById("qp-btn-4k")
    ?.classList.toggle("hidden", !b4kEnabled || primaryPlayTab === "backup4k");

  // Settings Tab 2 network groups
  document.getElementById("net-group-hdrezka")?.classList.toggle("hidden", !rezkaEnabled);
  document.getElementById("net-group-stremio")?.classList.toggle("hidden", !stremioEnabled);
  document.getElementById("net-group-backup4k")?.classList.toggle("hidden", !b4kEnabled);

  if (state.isPlayerOpen && state.activeItem) {
    renderModalProvidersSidebar(state.activeItem);
    if (
      (state.activeSourceTab === "hdrezka" && !rezkaEnabled) ||
      (state.activeSourceTab === "stremio" && !stremioEnabled) ||
      (state.activeSourceTab === "backup4k" && !b4kEnabled)
    ) {
      switchSourceTab(getDefaultPlayableSourceTab(), 0);
    }
  }
}
export function getFriendsAverageScore(item) {
  const list = item?.kinorium?.friends_ratings;
  if (!Array.isArray(list) || list.length === 0) return 0;
  if (state.selectedFriend && state.selectedFriend !== "all") {
    const matched = list.find((f) => f?.name === state.selectedFriend);
    const sc = parseFloat(matched?.score);
    return !Number.isNaN(sc) && sc > 0 ? Math.round(sc * 10) / 10 : 0;
  }
  let sum = 0;
  let count = 0;
  for (const fr of list) {
    const sc = parseFloat(fr?.score);
    if (!Number.isNaN(sc) && sc > 0) {
      sum += sc;
      count += 1;
    }
  }
  return count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
}
export function filterCatalogItemsByGenreAndYear(items) {
  let out = items;
  if (state.hideWatched && state.kinoriumSection !== "watched") {
    out = out.filter((it) => !(it.kinorium?.watched && !it.kinorium?.has_new_episode));
  }
  if (state.genreFilter && state.genreFilter !== "all") {
    const gTarget = state.genreFilter.trim().toLowerCase();
    out = out.filter((it) =>
      (it.genres || []).some((g) => String(g || "").trim().toLowerCase() === gTarget)
    );
  }
  if (state.yearFilter && state.yearFilter !== "all") {
    const yf = String(state.yearFilter);
    const exactYear = /^\d{4}$/.test(yf) ? parseInt(yf, 10) : 0;
    out = out.filter((it) => {
      const y = parseInt(it.year, 10) || 0;
      if (exactYear > 0) return y === exactYear;
      if (yf === "2020_2023") return y >= 2020 && y <= 2023;
      if (yf === "2010_2019") return y >= 2010 && y <= 2019;
      if (yf === "before_2010") return y > 0 && y < 2010;
      return true;
    });
  }
  if (state.selectedFriend && state.selectedFriend !== "all") {
    out = out.filter((it) =>
      (it.kinorium?.friends_ratings || []).some((f) => f?.name === state.selectedFriend)
    );
  } else if (state.friendsFilter) {
    out = out.filter(
      (it) => Array.isArray(it.kinorium?.friends_ratings) && it.kinorium.friends_ratings.length > 0
    );
  }
  return out;
}
export function getCurrentlyFilteredItems() {
  const base = sortCatalogItems(filterCatalogItemsByGenreAndYear(state.catalogItems));
  const effectiveType = state.mediaTypeFilter || "all";
  if (effectiveType === "movie") return base.filter((i) => i.media_type === "movie");
  if (effectiveType === "series") return base.filter((i) => i.media_type === "series");
  return base;
}
export function sortCatalogItems(items) {
  if (!state.sortBy || state.sortBy === "default") return items;
  const copy = items.slice();
  if (state.sortBy === "user_rating") {
    copy.sort((a, b) => (b.kinorium?.user_rating || 0) - (a.kinorium?.user_rating || 0));
  } else if (state.sortBy === "friends_rating") {
    copy.sort((a, b) => {
      const diff = getFriendsAverageScore(b) - getFriendsAverageScore(a);
      if (diff !== 0) return diff;
      return (b.kinorium?.friends_ratings?.length || 0) - (a.kinorium?.friends_ratings?.length || 0);
    });
  } else if (state.sortBy === "kinorium_rating") {
    copy.sort(
      (a, b) =>
        (parseFloat(b.kinorium?.kinorium_rating || b.ratings?.kinorium) || 0) -
        (parseFloat(a.kinorium?.kinorium_rating || a.ratings?.kinorium) || 0)
    );
  } else if (state.sortBy === "year_desc") {
    copy.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
  }
  return copy;
}
export function renderCatalogSkeletons(count = 12) {
  const simSec = document.getElementById("search-similar-section");
  if (simSec) simSec.classList.add("hidden");
  const buildSkeletonCards = (n) =>
    Array.from({ length: n })
      .map(
        () => `
        <div class="atv-skeleton-card">
          <div class="atv-skeleton-poster"></div>
          <div class="atv-skeleton-line"></div>
          <div class="atv-skeleton-line short"></div>
        </div>
      `
      )
      .join("");

  if (state.kinoriumSection !== "all") {
    const unifiedSec = document.getElementById("unified-kinorium-section");
    const unifiedGrid = document.getElementById("unified-kinorium-grid");
    if (unifiedSec && unifiedGrid) {
      unifiedSec.classList.remove("hidden");
      unifiedGrid.innerHTML = buildSkeletonCards(count);
    }
  } else {
    const sGrid = document.getElementById("series-grid");
    const mGrid = document.getElementById("movies-grid");
    if (sGrid && (!state.catalogItems || state.catalogItems.length === 0)) {
      sGrid.innerHTML = buildSkeletonCards(6);
    }
    if (mGrid && (!state.catalogItems || state.catalogItems.length === 0)) {
      mGrid.innerHTML = buildSkeletonCards(6);
    }
  }
}
export async function loadCatalog() {
  if (state.catalogAbortController) {
    try {
      state.catalogAbortController.abort();
    } catch (_) {}
  }
  const abortController = new AbortController();
  state.catalogAbortController = abortController;
  state.catalogReqId = (state.catalogReqId || 0) + 1;
  const reqId = state.catalogReqId;
  const q = state.searchQuery.trim();
  const params = new URLSearchParams({
    provider: state.providerFilter,
    media_type: state.kinoriumSection !== "all" ? "all" : state.mediaTypeFilter,
    kinorium_section: state.kinoriumSection,
    lang: state.appLang || "ru",
  });
  if (q) params.set("q", q);

  const endpoint = q ? `/api/search?${params.toString()}` : `/api/catalog?${params.toString()}`;
  const skeletonTimer = setTimeout(() => {
    if (reqId === state.catalogReqId) {
      renderCatalogSkeletons(12);
    }
  }, 85);

  try {
    const res = await fetch(endpoint, { signal: abortController.signal });
    const data = await res.json();
    clearTimeout(skeletonTimer);
    if (reqId !== state.catalogReqId) return;
    state.providersMeta = data.providers_meta || state.providersMeta;
    state.integrations = data.integrations || state.integrations;
    state.catalogItems = data.items || [];
    if (Array.isArray(data.kinorium_friends)) {
      state.kinoriumFriends = data.kinorium_friends;
    }
    if (Array.isArray(data.similar_pool)) {
      state.similarPool = data.similar_pool;
    }
    state.searchSimilarItems = q && Array.isArray(data.similar_items) ? data.similar_items : [];
    if (data.kinorium_account) {
      state.kinoriumAccount = data.kinorium_account;
      updateKinoriumUserBadge();
    }
    if (data.kinorium_counts) {
      state.kinoriumCounts = data.kinorium_counts;
      updateKinoriumSectionCounters();
    }
    if (data.continue_watching) {
      state.continueWatching = data.continue_watching;
    }
    applyEnabledServicesVisibility();
    updateFriendsFilterDropdown();
    updateDynamicCatalogFilters();
    renderLoginBannerIfNeeded();
    renderHero();
    renderContinueWatching();
    renderCatalogShelves();
    if (!state.liveUpdatesCheckedOnce && isServiceEnabled("hdrezka") && isServiceEnabled("kinorium")) {
      state.liveUpdatesCheckedOnce = true;
      setTimeout(() => checkLiveRezkaSeriesUpdates(false), 900);
    }
  } catch (err) {
    clearTimeout(skeletonTimer);
    if (err && err.name === "AbortError") return;
    console.error("Failed to load catalog:", err);
  }
}
export async function checkLiveRezkaSeriesUpdates(showFeedback = false, forceRefresh = false) {
  if (!isServiceEnabled("hdrezka") || !isServiceEnabled("kinorium")) return;
  if (!showFeedback && !forceRefresh && state.isPlayerOpen && !state.isMiniPlayer && !state.isPipBackground) {
    setTimeout(() => checkLiveRezkaSeriesUpdates(false, false), 5000);
    return;
  }
  const btn = document.getElementById("btn-check-rezka-updates");
  if (btn && showFeedback) {
    btn.innerHTML = `${iconSvg("refresh", 12)}<span>${t("Проверка...", "Checking...")}</span>`;
    btn.disabled = true;
  }
  try {
    const url = forceRefresh
      ? "/api/hdrezka/check-watching-updates?force=1"
      : "/api/hdrezka/check-watching-updates";
    const res = await fetch(url);
    const data = await res.json();
    const updates = data.updates || [];
    let hasChanges = false;
    updates.forEach((u) => {
      const prev =
        (u.id && state.liveSeriesUpdates[u.id]) ||
        (u.kinorium_id && state.liveSeriesUpdates[String(u.kinorium_id)]) ||
        (u.title && state.liveSeriesUpdates[u.title.trim().toLowerCase()]) ||
        null;
      if (
        !prev ||
        prev.latest_season !== u.latest_season ||
        prev.latest_episode !== u.latest_episode ||
        prev.studios_summary !== u.studios_summary
      ) {
        hasChanges = true;
      }
      if (u.id) state.liveSeriesUpdates[u.id] = u;
      if (u.kinorium_id) {
        state.liveSeriesUpdates[String(u.kinorium_id)] = u;
        state.liveSeriesUpdates[`kin_${u.kinorium_id}`] = u;
      }
      if (u.title) state.liveSeriesUpdates[u.title.trim().toLowerCase()] = u;
      if (u.orig_title) state.liveSeriesUpdates[u.orig_title.trim().toLowerCase()] = u;
    });

    if (hasChanges || showFeedback) {
      renderContinueWatching();
      renderCatalogShelves();
      if (showFeedback) {
        renderHero();
      }
    }

    if (showFeedback) {
      showToast(
        updates.length > 0
          ? t(
              `HDRezka: актуальные серии и озвучки обновлены (${updates.length})`,
              `HDRezka: updated episodes & audio tracks (${updates.length})`
            )
          : t("HDRezka: статус серий проверен", "HDRezka: episode status verified")
      );
    }

    if (Number(data.remaining_unchecked || 0) > 0) {
      setTimeout(() => checkLiveRezkaSeriesUpdates(false, false), 6000);
    }
  } catch (err) {
    if (showFeedback) {
      showToast(t("Не удалось проверить обновления серий на HDRezka", "Failed to check HDRezka episode updates"));
    }
  } finally {
    if (btn) {
      btn.innerHTML = `${iconSvg("refresh", 12)}<span>HDRezka</span>`;
      btn.disabled = false;
    }
  }
}
export async function pollLiveKinoriumDigest() {
  if (document.hidden || !isServiceEnabled("kinorium")) return;
  try {
    const res = await fetch("/api/kinorium/live-digest");
    if (!res.ok) return;
    const data = await res.json();
    let changed = false;
    (data.updates || []).forEach((u) => {
      const prev = u.id ? state.liveSeriesUpdates[u.id] : null;
      if (
        !prev ||
        prev.latest_season !== u.latest_season ||
        prev.latest_episode !== u.latest_episode
      ) {
        changed = true;
      }
      if (u.id) state.liveSeriesUpdates[u.id] = u;
      if (u.kinorium_id) {
        state.liveSeriesUpdates[String(u.kinorium_id)] = u;
        state.liveSeriesUpdates[`kin_${u.kinorium_id}`] = u;
      }
      if (u.title) state.liveSeriesUpdates[u.title.trim().toLowerCase()] = u;
      if (u.orig_title) state.liveSeriesUpdates[u.orig_title.trim().toLowerCase()] = u;
    });
    if (data.kinorium_counts) {
      state.kinoriumCounts = { ...state.kinoriumCounts, ...data.kinorium_counts };
      updateKinoriumSectionCounters();
    }
    if (changed) {
      renderNotificationsBell();
      if (!state.isPlayerOpen) {
        renderContinueWatching();
        renderCatalogShelves();
      }
    }
  } catch (_) {}
}
export function startBackgroundDigestPolling() {
  if (state.bgDigestTimerId) {
    clearInterval(state.bgDigestTimerId);
  }
  state.bgDigestTimerId = setInterval(() => {
    pollLiveKinoriumDigest();
  }, 180000);
}
export function updateFriendsFilterDropdown() {
  const sel = document.getElementById("select-friend-filter");
  if (!sel) return;
  const namesSet = new Set();
  (state.kinoriumFriends || []).forEach((f) => {
    if (f?.name) namesSet.add(f.name);
  });
  (state.catalogItems || []).forEach((it) => {
    (it.kinorium?.friends_ratings || []).forEach((fr) => {
      if (fr?.name) namesSet.add(fr.name);
    });
  });
  const sortedNames = Array.from(namesSet).sort((a, b) => a.localeCompare(b, isEn() ? "en" : "ru"));
  const curVal = state.selectedFriend || "all";
  sel.innerHTML = `<option value="all">${t("Друг: Все друзья", "Friend: All friends")}</option>`;
  sortedNames.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === curVal) opt.selected = true;
    sel.appendChild(opt);
  });
  if (curVal !== "all" && !namesSet.has(curVal)) {
    state.selectedFriend = "all";
    sel.value = "all";
  }
}
export function updateKinoriumUserBadge() {
  const acc = state.kinoriumAccount || {};
  const statsBadge = document.getElementById("stats-profile-badge");
  if (statsBadge) {
    if (acc.connected && acc.user_id) {
      const displayName = acc.display_name || "Kinorium";
      statsBadge.textContent = displayName.includes(acc.user_id)
        ? displayName
        : `${displayName} · ID ${acc.user_id}`;
    } else {
      statsBadge.textContent = t("Профиль не подключен", "Not connected");
    }
  }
}
export function updateKinoriumSectionCounters() {
  const c = state.kinoriumCounts || {};
  const elPremieres = document.getElementById("kcount-premieres");
  const elWatching = document.getElementById("kcount-watching");
  const elWatchlist = document.getElementById("kcount-watchlist");
  const elWatched = document.getElementById("kcount-watched");
  const elNever = document.getElementById("kcount-never");
  if (elPremieres) elPremieres.textContent = String(c.premieres || 0);
  if (elWatching) elWatching.textContent = String(c.watching || 0);
  if (elWatchlist) elWatchlist.textContent = String(c.watchlist || 0);
  if (elWatched) elWatched.textContent = String(c.watched || 0);
  if (elNever) elNever.textContent = String(c.never || 0);
}
// Show prompt when user selects a paid streaming service where they are not logged in yet
// (HDRezka and 4K Remux work without login)
export function renderLoginBannerIfNeeded() {
  const banner = document.getElementById("service-login-banner");
  const prov = state.providerFilter;

  if (
    prov === "all" ||
    prov === "hdrezka" ||
    prov === "stremio" ||
    prov === "backup4k" ||
    !isServiceEnabled(prov)
  ) {
    banner.classList.add("hidden");
    return;
  }

  const integ = state.integrations[prov];
  if (!integ || integ.logged_in || !integ.requires_login) {
    banner.classList.add("hidden");
    return;
  }

  const isPending = Boolean(state.pendingServiceLogins?.[prov]);
  banner.classList.remove("hidden");
  document.getElementById("login-banner-title").textContent = isPending
    ? t(
        `Завершите вход в аккаунт ${integ.name} в открытой вкладке`,
        `Complete ${integ.name} sign-in in the opened browser tab`
      )
    : t(
        `Вы еще не вошли в аккаунт ${integ.name}`,
        `You are not signed in to ${integ.name}`
      );
  document.getElementById("login-banner-sub").textContent = isPending
    ? t(
        `После авторизации на сайте ${integ.name} нажмите «Подтвердить вход» — или смотрите бесплатно через HDRezka.`,
        `After signing in to ${integ.name}, click "Confirm sign-in" — or watch directly via HDRezka / Stremio.`
      )
    : t(
        `Авторизуйтесь в ${integ.name}, чтобы смотреть по подписке — или открывайте любой фильм и смотрите бесплатно без регистрации через HDRezka.`,
        `Sign in to ${integ.name} for subscription playback — or open any title to watch directly via HDRezka / Stremio.`
      );

  const loginBtn = document.getElementById("banner-login-btn");
  const confirmBtn = document.getElementById("banner-confirm-login-btn");
  if (loginBtn) {
    loginBtn.textContent = isPending ? t("Открыть окно снова", "Open Window Again") : t("Войти в аккаунт", "Sign in");
    loginBtn.className = isPending ? "atv-btn-secondary atv-btn-sm" : "atv-btn-primary atv-btn-sm";
    loginBtn.onclick = () => {
      triggerServiceLoginFlow(prov);
    };
  }
  if (confirmBtn) {
    confirmBtn.classList.toggle("hidden", !isPending);
    confirmBtn.onclick = () => {
      confirmServiceLogin(prov);
    };
  }
  document.getElementById("banner-open-integrations-btn").onclick = () => {
    openSettingsModal("integrations");
  };
}
export function isAnyOverlayModalOpen() {
  if (state.isPlayerOpen && !state.isMiniPlayer && !state.isPipBackground) return true;
  const ids = ["confirm-modal", "person-modal", "quick-peek-modal", "stats-modal", "settings-modal"];
  return ids.some((id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains("hidden");
  });
}
export function stopHeroAutoTimer() {
  if (state.heroTimerId) {
    clearInterval(state.heroTimerId);
    state.heroTimerId = null;
  }
}
export function startHeroAutoTimer() {
  stopHeroAutoTimer();
  if (!state.heroItems || state.heroItems.length <= 1) return;
  state.heroTimerId = setInterval(() => {
    if (state.heroHovered || isAnyOverlayModalOpen() || document.hidden) return;
    const heroSection = document.getElementById("hero-banner");
    if (!heroSection || heroSection.classList.contains("hidden")) return;
    stepHeroSlide(1, true);
  }, 7500);
}
export function stepHeroSlide(delta, smooth = true) {
  if (!state.heroItems || state.heroItems.length <= 1) return;
  const total = state.heroItems.length;
  state.heroIndex = (state.heroIndex + delta + total) % total;
  renderHeroSlide(state.heroIndex, smooth);
}
export function renderHeroSlide(idx, smooth = false) {
  const heroSection = document.getElementById("hero-banner");
  const heroBackdrop = document.getElementById("hero-backdrop");
  const heroContent = document.getElementById("hero-content");
  const controlsWrap = document.getElementById("hero-carousel-controls");
  const dotsWrap = document.getElementById("hero-dots");
  if (!heroSection || !heroBackdrop || !heroContent) return;

  const list = state.heroItems || [];
  const featured = list[idx] || list[0];
  if (!featured) return;

  const applyContent = () => {
    setAmbientColor(featured.ambient_color || "#3f6212");
    const heroBgUrl = isEn()
      ? featured.backdrop && !featured.backdrop.includes("ru-images.kinorium.com")
        ? featured.backdrop
        : displayPoster(featured)
      : featured.backdrop || featured.poster;
    heroBackdrop.style.backgroundImage = cssUrl(heroBgUrl);

    const kinEnabled = isServiceEnabled("kinorium");
    const rezkaEnabled = isServiceEnabled("hdrezka");
    const stremioEnabled = isServiceEnabled("stremio");
    const b4kEnabled = isServiceEnabled("backup4k");
    const primaryTab = getDefaultPlayableSourceTab();

    const kRating = featured.kinorium?.kinorium_rating || featured.ratings?.kinorium || "";
    const imdbRating = featured.ratings?.imdb || kRating || "";
    const scorePart = kinEnabled
      ? kRating
        ? `Kinorium ${kRating}`
        : ""
      : imdbRating
      ? `IMDb ${imdbRating}`
      : "";
    const typeLabel = featured.media_type === "series" ? t("Сериал", "Series") : t("Фильм", "Movie");
    const genresText = (featured.genres || []).slice(0, 2).map(translateGenre).join(", ");
    const kickerParts = [typeLabel, genresText, featured.year, scorePart].filter(Boolean);

    const epInfo = resolveSeriesEpisodeInfo(featured);
    let heroPrimaryHtml = `${iconSvg("play", 13)}<span>${t("Смотреть", "Watch")}</span>`;
    if (primaryTab === "hdrezka" && rezkaEnabled) {
      if (epInfo.isMidEpisodeResume) {
        heroPrimaryHtml =
          featured.media_type === "series"
            ? `${iconSvg("play", 13)}<span>${t(
                `Продолжить · Сезон ${epInfo.season}, Серия ${epInfo.episode}`,
                `Resume · Season ${epInfo.season}, Episode ${epInfo.episode}`
              )}</span>`
            : `${iconSvg("play", 13)}<span>${t("Продолжить просмотр", "Resume Watching")}</span>`;
      } else if (featured.media_type === "series" && epInfo.hasNewEpisode && epInfo.episodeVerified) {
        heroPrimaryHtml = `${iconSvg("play", 13)}<span>${t(
          `Смотреть · Сезон ${epInfo.season}, Серия ${epInfo.episode}`,
          `Watch · Season ${epInfo.season}, Episode ${epInfo.episode}`
        )}</span>`;
      } else {
        heroPrimaryHtml = `${iconSvg("play", 13)}<span>${t("Смотреть", "Watch")}</span>`;
      }
    } else if (primaryTab === "stremio" && stremioEnabled) {
      heroPrimaryHtml = `${iconSvg("play", 13)}<span>${t("Смотреть (Stremio)", "Watch (Stremio)")}</span>`;
    } else if (primaryTab === "backup4k" && b4kEnabled) {
      heroPrimaryHtml = `${iconSvg("play", 13)}<span>${t("Смотреть в 4K", "Watch in 4K")}</span>`;
    } else {
      heroPrimaryHtml = `${iconSvg("film", 14)}<span>${t("Смотреть трейлер", "Watch Trailer")}</span>`;
    }

    const peekLabel = featured.media_type === "series" ? t("О сериале", "Details") : t("О фильме", "Details");
    const heroTitle = displayTitle(featured);
    const heroDesc = displayDescription(featured);

    heroContent.innerHTML = `
      <div class="atv-hero-kicker">
        ${escapeHtml(kickerParts.join(" · "))}
      </div>
      <h1 class="atv-hero-title">${escapeHtml(heroTitle)}</h1>
      <p class="atv-hero-desc" id="hero-desc-text">${escapeHtml(heroDesc)}</p>
      <div class="atv-hero-buttons">
        <button class="atv-btn-primary" id="hero-play-rezka">
          ${heroPrimaryHtml}
        </button>
        ${
          primaryTab !== "trailer"
            ? `<button class="atv-btn-secondary" id="hero-play-trailer">${iconSvg("film", 13)}<span>${t("Трейлер", "Trailer")}</span></button>`
            : ""
        }
        <button class="atv-btn-secondary" id="hero-quick-peek" title="${t("Быстрый просмотр описания, актёров и оценка", "Synopsis, cast & rating")}">
          ${iconSvg("info", 14)}<span>${peekLabel}</span>
        </button>
      </div>
    `;

    const btnPlay = document.getElementById("hero-play-rezka");
    if (btnPlay) {
      btnPlay.onclick = () => {
        const info = resolveSeriesEpisodeInfo(featured);
        openPlayerModal(featured, primaryTab, info.season, info.episode, info.currentTime);
      };
    }
    const btnTrailer = document.getElementById("hero-play-trailer");
    if (btnTrailer) {
      btnTrailer.onclick = () => {
        const info = resolveSeriesEpisodeInfo(featured);
        openPlayerModal(featured, "trailer", info.season, info.episode, info.currentTime);
      };
    }
    const btnPeek = document.getElementById("hero-quick-peek");
    if (btnPeek) {
      btnPeek.onclick = () => openQuickPeekModal(featured);
    }

    if (
      isEn() &&
      (!featured.description_en ||
        featured.description_en.includes("•") ||
        hasCyrillicText(featured.description_en)) &&
      !featured._enHeroFetching
    ) {
      featured._enHeroFetching = true;
      const metaParams = new URLSearchParams({
        id: String(featured.rezka_id || featured.id || ""),
        item_id: String(featured.id || ""),
        kinorium_id: String(featured.kinorium_id || featured.kinorium?.kinorium_id || ""),
        title: String(featured.title || ""),
        orig_title: String(featured.orig_title || ""),
        year: String(featured.year || 2024),
        media_type: String(featured.media_type || "movie"),
        lang: "en",
      });
      fetch(`/api/title-meta?${metaParams.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((meta) => {
          if (!meta || !meta.ok) return;
          if (meta.description && !hasCyrillicText(meta.description)) {
            featured.description_en = meta.description;
          }
          if (meta.poster_en) {
            featured.poster_en = meta.poster_en;
          }
          if (meta.critics_rating != null) {
            featured.ratings = { ...(featured.ratings || {}), critics: meta.critics_rating };
          }
          if ((state.heroItems || [])[state.heroIndex] === featured && isEn()) {
            const descEl = document.getElementById("hero-desc-text");
            if (descEl) {
              descEl.textContent = displayDescription(featured);
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          featured._enHeroFetching = false;
        });
    }

    if (controlsWrap && dotsWrap) {
      controlsWrap.classList.toggle("hidden", list.length <= 1);
      dotsWrap.innerHTML = "";
      list.forEach((itemSlide, dotIdx) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = `atv-hero-dot${dotIdx === idx ? " active" : ""}`;
        dot.title = displayTitle(itemSlide);
        dot.onclick = (e) => {
          e.stopPropagation();
          if (state.heroIndex === dotIdx) return;
          state.heroIndex = dotIdx;
          renderHeroSlide(dotIdx, true);
          startHeroAutoTimer();
        };
        dotsWrap.appendChild(dot);
      });
    }
  };

  if (smooth) {
    heroSection.classList.add("hero-fading");
    setTimeout(() => {
      applyContent();
      requestAnimationFrame(() => heroSection.classList.remove("hero-fading"));
    }, 150);
  } else {
    heroSection.classList.remove("hero-fading");
    applyContent();
  }
}
export function renderHero() {
  const heroSection = document.getElementById("hero-banner");
  if (!heroSection) return;

  if (state.searchQuery.trim() || state.kinoriumSection !== "all" || state.catalogItems.length === 0) {
    heroSection.classList.add("hidden");
    stopHeroAutoTimer();
    return;
  }
  heroSection.classList.remove("hidden");

  const picked = [];
  const seen = new Set();
  const pushUnique = (it) => {
    if (!it || !it.title) return;
    const k = it.id || it.title.trim().toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    picked.push(it);
  };

  state.catalogItems.filter((i) => i.featured).forEach(pushUnique);
  const sortedByScore = state.catalogItems
    .slice()
    .sort(
      (a, b) =>
        (parseFloat(b.kinorium?.kinorium_rating || b.ratings?.kinorium) || 0) -
        (parseFloat(a.kinorium?.kinorium_rating || a.ratings?.kinorium) || 0)
    );
  sortedByScore.filter((i) => i.backdrop).forEach(pushUnique);
  sortedByScore.forEach(pushUnique);

  state.heroItems = picked.slice(0, 5);
  if (state.heroIndex >= state.heroItems.length) {
    state.heroIndex = 0;
  }
  renderHeroSlide(state.heroIndex, false);
  startHeroAutoTimer();
}
export function collectNewEpisodeNotifications() {
  if (!isServiceEnabled("kinorium") || (!isServiceEnabled("hdrezka") && !isServiceEnabled("stremio"))) {
    return [];
  }
  const out = [];
  const seenTitles = new Set();

  const appendIfSeriesNotif = (srcItem) => {
    if (!srcItem || srcItem.media_type !== "series") return;
    const tKey = (srcItem.title || "").trim().toLowerCase() || srcItem.id;
    if (!tKey || seenTitles.has(tKey)) return;
    const info = resolveSeriesEpisodeInfo(srcItem);
    if (!info.hasNewEpisode && !info.isMidEpisodeResume) return;
    const notifKey = info.episodeVerified
      ? `${srcItem.id}:S${info.season}E${info.episode}`
      : `${srcItem.id}:NEW`;
    seenTitles.add(tKey);
    out.push({
      id: srcItem.id,
      title: srcItem.title,
      orig_title: srcItem.orig_title || "",
      poster: srcItem.poster || srcItem.backdrop || "",
      season: info.season,
      episode: info.episode,
      episode_verified: info.episodeVerified,
      current_time: info.currentTime,
      studio: info.studio || "HDRezka",
      is_new_episode: info.hasNewEpisode,
      notifKey,
      rawItem: srcItem,
    });
  };

  (state.continueWatching || []).forEach(appendIfSeriesNotif);
  (state.catalogItems || []).forEach((it) => {
    if (it.media_type === "series" && it.kinorium?.has_new_episode) {
      appendIfSeriesNotif(it);
    }
  });

  return out;
}
export function renderNotificationsBell() {
  const badgeEl = document.getElementById("notifications-badge");
  const listEl = document.getElementById("notifications-list");
  if (!badgeEl || !listEl) return;

  const notifs = collectNewEpisodeNotifications();
  const seenSet = getSeenNotificationsSet();
  const unreadCount = notifs.filter((n) => !seenSet.has(n.notifKey)).length;

  badgeEl.textContent = String(unreadCount);
  badgeEl.classList.toggle("hidden", unreadCount === 0);

  listEl.innerHTML = "";
  if (notifs.length === 0) {
    listEl.innerHTML = `
      <div class="atv-notif-empty">
        ${t(
          "Все просмотренные сериалы из раздела «Смотрю» актуальны — новых непросмотренных серий пока нет.",
          "All series in your Watching list are up to date — no new episodes right now."
        )}
      </div>
    `;
    return;
  }

  notifs.forEach((n) => {
    const isUnread = !seenSet.has(n.notifKey);
    const row = document.createElement("div");
    row.className = `atv-notif-item${isUnread ? " unread" : ""}`;
    const nTitle = displayTitle(n);
    const epTag = n.episode_verified
      ? t(` · Сезон ${n.season}, Серия ${n.episode}`, ` · Season ${n.season}, Episode ${n.episode}`)
      : "";
    const statusHtml = n.is_new_episode
      ? `${iconSvg("bolt", 11)}<span>${t("Новая серия", "New Episode")}${epTag}</span>`
      : `${iconSvg("play", 10)}<span>${t("Продолжить", "Resume")}${epTag}</span>`;
    const stName = translateStudioName(n.studio || "HDRezka");
    const subText =
      n.current_time > 10
        ? `${stName} · ${t("с", "at")} ${formatTime(n.current_time)}`
        : `${stName} · ${t("Доступно в 1080p", "Available in 1080p")}`;

    const notifPoster = displayPoster(n.rawItem || n);
    row.innerHTML = `
      <img class="atv-notif-poster" src="${escapeAttr(notifPoster)}" alt="${escapeAttr(nTitle)}" loading="lazy" referrerpolicy="no-referrer" />
      <div class="atv-notif-info">
        <div class="atv-notif-title">${escapeHtml(nTitle)}</div>
        <div class="atv-notif-ep atv-inline-icon-label">${statusHtml}</div>
        <div class="atv-notif-sub">${escapeHtml(subText)}</div>
      </div>
      <span class="atv-notif-play atv-inline-icon-label">${iconSvg("play", 10)}<span>${t("Смотреть", "Watch")}</span></span>
    `;
    const imgEl = row.querySelector("img");
    attachSmartPosterFallback(imgEl, nTitle, "", n.poster);
    row.onclick = () => {
      const updatedSeen = getSeenNotificationsSet();
      updatedSeen.add(n.notifKey);
      saveSeenNotificationsSet(updatedSeen);
      renderNotificationsBell();
      document.getElementById("notifications-popover")?.classList.add("hidden");
      const found =
        state.catalogItems.find(
          (i) =>
            i.id === n.id ||
            (n.title && (i.title || "").trim().toLowerCase() === n.title.trim().toLowerCase())
        ) || n.rawItem;
      openPlayerModal(found, getDefaultPlayableSourceTab(), n.season, n.episode, n.current_time || 0);
    };
    listEl.appendChild(row);
  });
}
export function renderContinueWatching() {
  renderNotificationsBell();
  const section = document.getElementById("continue-watching-section");
  const grid = document.getElementById("continue-watching-grid");
  const headingEl = section?.querySelector(".atv-section-header h2");
  if (grid) {
    attachHorizontalWheelScroll(grid);
  }

  const visibleCw = (state.continueWatching || []).filter((cw) => {
    if (!isServiceEnabled("hdrezka") && !isServiceEnabled("stremio") && !isServiceEnabled("backup4k")) {
      return false;
    }
    if (state.mediaTypeFilter !== "all" && cw.media_type !== state.mediaTypeFilter) {
      return false;
    }
    if (cw.media_type === "series") {
      const info = resolveSeriesEpisodeInfo(cw);
      if (cw.is_new_episode && !info.hasNewEpisode && !info.isMidEpisodeResume) {
        return false;
      }
    }
    return true;
  });

  if (
    state.searchQuery.trim() ||
    state.kinoriumSection !== "all" ||
    state.providerFilter !== "all" ||
    visibleCw.length === 0
  ) {
    section.classList.add("hidden");
    return;
  }
  if (headingEl) {
    headingEl.textContent =
      state.mediaTypeFilter === "movie"
        ? t("Продолжить просмотр фильмов", "Continue Watching Movies")
        : t("Новые серии и продолжить просмотр", "New Episodes & Continue Watching");
  }
  section.classList.remove("hidden");
  grid.innerHTML = "";

  visibleCw.forEach((cw) => {
    const rawPct = Math.round((cw.progress || 0) * 100);
    const info = resolveSeriesEpisodeInfo(cw);
    const dispSeason = info.season;
    const dispEp = info.episode;
    const cwTitle = displayTitle(cw);
    const epLabel =
      cw.media_type === "series" && info.episodeVerified && !info.hasNewEpisode
        ? t(`Сезон ${dispSeason}, Серия ${dispEp} · `, `Season ${dispSeason}, Episode ${dispEp} · `)
        : "";
    const seasonProgPart =
      cw.media_type === "series" && info.hasSeasonProgress && info.seasonProgressText
        ? `${info.seasonProgressText} · `
        : "";
    const studioLabel = translateStudioName(info.studio || "HDRezka");
    const timeOrStatus =
      info.hasNewEpisode && (!info.currentTime || info.currentTime < 5)
        ? t("Доступна к просмотру", "Ready to watch")
        : formatTime(info.currentTime || cw.current_time || 0);
    const pct =
      rawPct > 0
        ? rawPct
        : cw.media_type === "series" && info.hasSeasonProgress && info.seasonPct > 0
        ? info.seasonPct
        : 0;
    const newEpBadge = info.hasNewEpisode
      ? `<div class="atv-upnext-badge">${iconSvg("bolt", 11)}<span>${
          info.episodeVerified
            ? t(
                `Новая серия · Сезон ${dispSeason}, Серия ${dispEp}`,
                `New Episode · Season ${dispSeason}, Episode ${dispEp}`
              )
            : t("Новая серия", "New Episode")
        }</span></div>`
      : "";

    const cwPoster = displayPoster(cw);
    const cwImgSrc = isEn()
      ? cw.backdrop && !cw.backdrop.includes("ru-images.kinorium.com")
        ? cw.backdrop
        : cwPoster
      : cw.backdrop || cwPoster;
    const card = document.createElement("div");
    card.className = "atv-upnext-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.innerHTML = `
      <img src="${escapeAttr(cwImgSrc)}" alt="${escapeAttr(cwTitle)}" loading="lazy" referrerpolicy="no-referrer" />
      <div class="atv-upnext-shade"></div>
      ${newEpBadge}
      <button class="atv-upnext-remove" title="${t("Убрать из «Продолжить просмотр»", "Remove from Continue Watching")}">${iconSvg("x", 11)}</button>
      <div class="atv-upnext-meta">
        <div class="atv-upnext-title">${escapeHtml(cwTitle)}</div>
        <div class="atv-upnext-sub">${escapeHtml(`${epLabel}${seasonProgPart}${studioLabel} · ${timeOrStatus}`)}</div>
        <div class="atv-upnext-progress">
          <div class="atv-upnext-fill" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
    const imgEl = card.querySelector("img");
    attachSmartPosterFallback(imgEl, cwTitle, "", cwPoster || cw.poster);
    const removeBtn = card.querySelector(".atv-upnext-remove");
    if (removeBtn) {
      removeBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
          await fetch("/api/kinorium/continue-watching/remove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: cw.id, title: cw.title }),
          });
          state.continueWatching = (state.continueWatching || []).filter(
            (x) => x.id !== cw.id && x.title !== cw.title
          );
          renderContinueWatching();
          showToast(
            t(
              `Убрано из «Продолжить просмотр»: «${cwTitle}»`,
              `Removed from Continue Watching: "${cwTitle}"`
            )
          );
        } catch (err) {
          showToast(t("Не удалось убрать из списка", "Failed to remove item"));
        }
      };
    }
    const openUpNextItem = () => {
      const found =
        state.catalogItems.find(
          (i) =>
            i.id === cw.id ||
            (cw.title && (i.title || "").trim().toLowerCase() === cw.title.trim().toLowerCase())
        ) || cw;
      const latestInfo = resolveSeriesEpisodeInfo(found);
      openPlayerModal(
        found,
        getDefaultPlayableSourceTab(),
        latestInfo.season,
        latestInfo.episode,
        latestInfo.currentTime
      );
    };
    card.onclick = openUpNextItem;
    card.onkeydown = (e) => {
      if (e.target === card && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        openUpNextItem();
      }
    };
    grid.appendChild(card);
  });
}
// Render separated Series ("Сериалы") and Movies ("Фильмы") shelves on Main Screen,
// or a unified 30-per-page paginated grid when viewing a Kinorium section
export function renderCatalogShelves() {
  const unifiedSection = document.getElementById("unified-kinorium-section");
  const unifiedGrid = document.getElementById("unified-kinorium-grid");
  const unifiedHeading = document.getElementById("unified-kinorium-heading");
  const unifiedCount = document.getElementById("unified-kinorium-count");

  const seriesSection = document.getElementById("series-section");
  const moviesSection = document.getElementById("movies-section");
  const seriesGrid = document.getElementById("series-grid");
  const moviesGrid = document.getElementById("movies-grid");
  const seriesHeading = document.getElementById("series-heading");
  const moviesHeading = document.getElementById("movies-heading");
  const seriesCount = document.getElementById("series-count");
  const moviesCount = document.getElementById("movies-count");

  const isSearching = Boolean(state.searchQuery.trim());
  const baseItems = filterCatalogItemsByGenreAndYear(state.catalogItems);
  const allItemsSorted = sortCatalogItems(baseItems);
  const seriesItems = allItemsSorted.filter((i) => i.media_type === "series");
  const movieItems = allItemsSorted.filter((i) => i.media_type === "movie");

  const ksecTitles = {
    all: "",
    premieres: t("Премьеры онлайн", "Online Premieres"),
    watching: t("Смотрю", "Watching"),
    watchlist: t("Буду смотреть", "Watchlist"),
    watched: t("Просмотрено", "Watched"),
    never: t("Не буду смотреть", "Not Interested"),
  };
  const provName =
    state.providerFilter === "all"
      ? ""
      : ` · ${state.providersMeta[state.providerFilter]?.name || state.providerFilter}`;
  const searchSuffix = state.searchQuery.trim()
    ? t(` по запросу «${state.searchQuery.trim()}»`, ` for "${state.searchQuery.trim()}"`)
    : "";

  const topTypeAllBtn = document.querySelector('#media-type-bar .type-pill[data-type="all"]');
  const topTypeMovieBtn = document.querySelector('#media-type-bar .type-pill[data-type="movie"]');
  const topTypeSeriesBtn = document.querySelector('#media-type-bar .type-pill[data-type="series"]');
  if (topTypeAllBtn) topTypeAllBtn.textContent = t("Все", "All");
  if (topTypeMovieBtn) topTypeMovieBtn.textContent = t("Фильмы", "Movies");
  if (topTypeSeriesBtn) topTypeSeriesBtn.textContent = t("Сериалы", "Series");

  const unifiedBreakdown = document.getElementById("unified-kinorium-breakdown");

  let hasVisibleItems = false;

  if (state.kinoriumSection !== "all" && unifiedSection && unifiedGrid) {
    // Hide separated shelves so strictly 30 cards are displayed per page
    seriesSection.classList.add("hidden");
    moviesSection.classList.add("hidden");
    const sp = document.getElementById("series-grid-pagination");
    if (sp) sp.remove();
    const mp = document.getElementById("movies-grid-pagination");
    if (mp) mp.remove();

    const effectiveSub = state.mediaTypeFilter || "all";

    const filteredUnified =
      effectiveSub === "movie"
        ? movieItems
        : effectiveSub === "series"
        ? seriesItems
        : allItemsSorted;

    const secTitle = ksecTitles[state.kinoriumSection] || t("Список Kinorium", "Kinorium List");
    if (unifiedHeading) unifiedHeading.textContent = `${secTitle}${provName}${searchSuffix}`;
    if (unifiedCount) unifiedCount.textContent = `${filteredUnified.length}`;
    if (unifiedBreakdown) {
      if (allItemsSorted.length > 0) {
        unifiedBreakdown.textContent = t(
          `Фильмы ${movieItems.length} · Сериалы ${seriesItems.length}`,
          `Movies ${movieItems.length} · Series ${seriesItems.length}`
        );
        unifiedBreakdown.classList.remove("hidden");
      } else {
        unifiedBreakdown.textContent = "";
        unifiedBreakdown.classList.add("hidden");
      }
    }

    if (filteredUnified.length > 0) {
      unifiedSection.classList.remove("hidden");
      renderPosterCardsInto(unifiedGrid, filteredUnified);
      hasVisibleItems = true;
    } else {
      unifiedSection.classList.add("hidden");
      const up = document.getElementById("unified-kinorium-grid-pagination");
      if (up) up.remove();
    }
  } else {
    if (unifiedBreakdown) {
      unifiedBreakdown.textContent = "";
      unifiedBreakdown.classList.add("hidden");
    }

    if (unifiedSection) {
      unifiedSection.classList.add("hidden");
      const up = document.getElementById("unified-kinorium-grid-pagination");
      if (up) up.remove();
    }

    seriesHeading.textContent = `${t("Сериалы", "Series")}${provName}${searchSuffix}`;
    moviesHeading.textContent = `${t("Фильмы", "Movies")}${provName}${searchSuffix}`;

    seriesCount.textContent = `${seriesItems.length}`;
    moviesCount.textContent = `${movieItems.length}`;

    const showSeries = state.mediaTypeFilter !== "movie" && seriesItems.length > 0;
    const showMovies = state.mediaTypeFilter !== "series" && movieItems.length > 0;

    if (!showSeries) {
      seriesSection.classList.add("hidden");
      const sp = document.getElementById("series-grid-pagination");
      if (sp) sp.remove();
    } else {
      seriesSection.classList.remove("hidden");
      renderPosterCardsInto(seriesGrid, seriesItems);
    }

    if (!showMovies) {
      moviesSection.classList.add("hidden");
      const mp = document.getElementById("movies-grid-pagination");
      if (mp) mp.remove();
    } else {
      moviesSection.classList.remove("hidden");
      renderPosterCardsInto(moviesGrid, movieItems);
    }

    hasVisibleItems = showSeries || showMovies;
  }

  const searchSimilarSection = document.getElementById("search-similar-section");
  const searchSimilarGrid = document.getElementById("search-similar-grid");
  const searchSimilarHeading = document.getElementById("search-similar-heading");
  const searchSimilarSub = document.getElementById("search-similar-sub");
  const searchSimilarCount = document.getElementById("search-similar-count");

  if (searchSimilarSection && searchSimilarGrid) {
    const activeQ = state.searchQuery.trim();
    if (activeQ && hasVisibleItems && Array.isArray(state.searchSimilarItems) && state.searchSimilarItems.length > 0) {
      const visibleIds = new Set(allItemsSorted.map((it) => it.id));
      const visibleTitles = new Set(allItemsSorted.map((it) => (it.title || "").trim().toLowerCase()));
      const similarFiltered = filterCatalogItemsByGenreAndYear(state.searchSimilarItems).filter(
        (sim) =>
          !visibleIds.has(sim.id) &&
          !visibleTitles.has((sim.title || "").trim().toLowerCase())
      );

      if (similarFiltered.length > 0) {
        if (searchSimilarHeading) {
          searchSimilarHeading.textContent = t("Похожие тайтлы", "Similar Titles");
        }
        if (searchSimilarSub) {
          if (allItemsSorted.length === 1) {
            searchSimilarSub.textContent = t(
              `в духе «${displayTitle(allItemsSorted[0])}»`,
              `like "${displayTitle(allItemsSorted[0])}"`
            );
          } else {
            const topGenres = (allItemsSorted[0]?.genres || [])
              .filter((g) => g !== "Сериал" && g !== "Фильм")
              .slice(0, 2)
              .map(translateGenre)
              .join(" · ");
            searchSimilarSub.textContent = topGenres
              ? t(`по жанрам: ${topGenres}`, `by genre: ${topGenres}`)
              : t("рекомендации", "recommended");
          }
        }
        if (searchSimilarCount) {
          searchSimilarCount.textContent = `${similarFiltered.length}`;
        }
        searchSimilarSection.classList.remove("hidden");
        renderPosterCardsInto(searchSimilarGrid, similarFiltered);
      } else {
        searchSimilarSection.classList.add("hidden");
        const ssp = document.getElementById("search-similar-grid-pagination");
        if (ssp) ssp.remove();
      }
    } else {
      searchSimilarSection.classList.add("hidden");
      const ssp = document.getElementById("search-similar-grid-pagination");
      if (ssp) ssp.remove();
    }
  }

  let emptyEl = document.getElementById("catalog-empty-state");
  if (!hasVisibleItems) {
    if (!emptyEl) {
      emptyEl = document.createElement("div");
      emptyEl.id = "catalog-empty-state";
      emptyEl.style.cssText =
        "padding: 56px 24px; text-align: center; color: rgba(235, 235, 245, 0.55);";
      moviesSection.parentNode.appendChild(emptyEl);
    }
    emptyEl.classList.remove("hidden");
    const acc = state.kinoriumAccount || {};
    const disconnectedHint =
      state.kinoriumSection !== "all" && state.kinoriumSection !== "premieres" && !acc.connected
        ? `<div style="font-size: 13px; margin-bottom: 16px;">${t(
            "Профиль Kinorium сейчас не подключен. Откройте Настройки в правом верхнем углу, чтобы ввести ваш ID или ссылку на профиль Kinorium.",
            "Kinorium profile is not connected. Open Settings in the top-right corner to enter your Kinorium ID or profile URL."
          )}</div>`
        : `<div style="font-size: 13px; margin-bottom: 16px;">${t(
            "Попробуйте изменить поисковый запрос или переключить раздел каталога",
            "Try adjusting your search query or switching catalog filters"
          )}</div>`;
    emptyEl.innerHTML = `
      <div style="font-size: 16px; font-weight: 600; color: #f5f5f7; margin-bottom: 8px;">
        ${t("По выбранным фильтрам ничего не найдено", "No titles match the active filters")}
      </div>
      ${disconnectedHint}
      <button class="atv-btn-secondary atv-btn-sm" id="reset-catalog-filters-btn">
        ${t("Сбросить фильтры", "Reset Filters")}
      </button>
    `;
    const resetBtn = document.getElementById("reset-catalog-filters-btn");
    if (resetBtn) {
      resetBtn.onclick = () => {
        state.mediaTypeFilter = "all";
        state.kinoriumSubType = "all";
        document.querySelectorAll(".type-pill").forEach((b) => {
          b.classList.toggle("active", b.dataset.type === "all");
        });
        if (state.searchQuery) {
          state.searchQuery = "";
          const sInp = document.getElementById("global-search");
          if (sInp) sInp.value = "";
          document.getElementById("btn-clear-search")?.classList.add("hidden");
          document.getElementById("search-kbd-hint")?.classList.remove("hidden");
        }
        document.getElementById("btn-clear-catalog-filters")?.click();
        loadCatalog();
      };
    }
  } else if (emptyEl) {
    emptyEl.classList.add("hidden");
  }
}
export function buildPosterBadgesHtml(item) {
  if (!isServiceEnabled("kinorium")) return "";
  const kStatus = item?.kinorium || {};
  const epInfo = resolveSeriesEpisodeInfo(item);
  const activeSec = state.kinoriumSection || "all";
  let statusBadge = "";
  const seasonTooltipSuffix =
    epInfo.hasSeasonProgress && epInfo.seasonProgressText
      ? ` (${epInfo.seasonProgressText})`
      : "";
  if (kStatus.not_watching) {
    if (activeSec !== "never") {
      statusBadge = `<div class="atv-status-badge st-never" title="${t("Не буду смотреть в Kinorium", "Not Interested on Kinorium")}">${iconSvg("x", 10)}<span>${t("Не буду", "Hidden")}</span></div>`;
    }
  } else if (epInfo.hasNewEpisode) {
    const epTooltip = epInfo.episodeVerified
      ? t(
          `Доступна новая серия: сезон ${epInfo.season}, серия ${epInfo.episode}${seasonTooltipSuffix}`,
          `New episode available: Season ${epInfo.season}, Episode ${epInfo.episode}${seasonTooltipSuffix}`
        )
      : t(
          `Доступна новая непросмотренная серия${seasonTooltipSuffix}`,
          `New unwatched episode available${seasonTooltipSuffix}`
        );
    statusBadge = `<div class="atv-status-badge st-new-ep" title="${escapeAttr(epTooltip)}">${iconSvg("bolt", 10)}<span>${t("Новая серия", "New Episode")}</span></div>`;
  } else if (kStatus.watching) {
    if (activeSec !== "watching") {
      statusBadge = `<div class="atv-status-badge st-now" title="${t("Смотрю в Kinorium", "Watching on Kinorium")}${escapeAttr(seasonTooltipSuffix)}">${iconSvg("play", 9)}<span>${t("Смотрю", "Watching")}</span></div>`;
    }
  } else if (kStatus.watched) {
    if (activeSec !== "watched") {
      statusBadge = `<div class="atv-status-badge st-done" title="${t("Просмотрено в Kinorium", "Watched on Kinorium")}">${iconSvg("check", 11)}</div>`;
    }
  } else if (kStatus.in_watchlist) {
    if (activeSec !== "watchlist") {
      statusBadge = `<div class="atv-status-badge st-future" title="${t("Буду смотреть в Kinorium", "Watchlist on Kinorium")}"><span>${t("В планах", "Watchlist")}</span></div>`;
    }
  }

  const scoreBadge = kStatus.user_rating
    ? `<div class="atv-user-score-badge" title="${t("Ваша оценка в Kinorium", "Your Kinorium rating")}">${iconSvg("star", 10)}<span>${kStatus.user_rating}</span></div>`
    : "";

  if (!statusBadge && !scoreBadge) return "";
  return `<div class="atv-poster-badges">${statusBadge}${scoreBadge}</div>`;
}
export function buildFallbackPosterSvg(title, year) {
  const safeTitle = String(title || "CineFlow")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .slice(0, 28);
  const safeYear = String(year || "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"><rect width="400" height="600" fill="#161922"/><text x="200" y="290" fill="#f5f5f7" font-family="-apple-system,sans-serif" font-size="22" font-weight="600" text-anchor="middle">${safeTitle}</text><text x="200" y="330" fill="#8e8e93" font-family="-apple-system,sans-serif" font-size="16" text-anchor="middle">${safeYear}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
export function attachSmartPosterFallback(imgEl, title, year = "", altUrl = "") {
  if (!imgEl) return;
  imgEl.referrerPolicy = "no-referrer";
  imgEl.onerror = () => {
    const cur = imgEl.src || "";
    if (cur.includes("ru-images.kinorium.com/movie/600/")) {
      imgEl.src = cur.replace("ru-images.kinorium.com/movie/600/", "en-images.kinorium.com/movie/600/");
    } else if (cur.includes("en-images.kinorium.com/movie/600/")) {
      imgEl.src = cur.replace("en-images.kinorium.com/movie/600/", "en-images.kinorium.com/movie/300/");
    } else if (cur.includes("en-images.kinorium.com/movie/300/") && !isEn()) {
      imgEl.src = cur.replace("en-images.kinorium.com/movie/300/", "ru-images.kinorium.com/movie/300/");
    } else if (cur.includes("/movie/600/")) {
      imgEl.src = cur.replace("/movie/600/", "/movie/300/");
    } else if (
      altUrl &&
      cur !== altUrl &&
      !imgEl.dataset.triedAlt &&
      !(isEn() && altUrl.includes("ru-images.kinorium.com"))
    ) {
      imgEl.dataset.triedAlt = "1";
      imgEl.src = altUrl;
    } else if (altUrl && cur !== altUrl && !imgEl.dataset.triedAlt2) {
      imgEl.dataset.triedAlt2 = "1";
      imgEl.src = altUrl;
    } else {
      imgEl.onerror = null;
      imgEl.src = buildFallbackPosterSvg(title, year);
    }
  };
}
export function createPosterCardElement(item) {
  const kinEnabled = isServiceEnabled("kinorium");
  const kStatus = item.kinorium || {};
  const criticsStr = formatCriticsRating(item);
  const mainRating = kinEnabled
    ? kStatus.kinorium_rating || item.ratings?.kinorium || item.ratings?.imdb || (criticsStr !== "—" ? criticsStr : "")
    : item.ratings?.imdb || kStatus.kinorium_rating || (criticsStr !== "—" ? criticsStr : "");
  const ratingMetaHtml = mainRating
    ? ` · <span class="atv-meta-rating">${iconSvg("star", 10)}<span>${escapeHtml(mainRating)}</span></span>`
    : "";
  const friendsAvg = kinEnabled && state.friendsFilter ? getFriendsAverageScore(item) : 0;
  const friendsHtml =
    friendsAvg > 0
      ? ` · <span class="atv-meta-friend">${iconSvg("users", 10)}<span>${friendsAvg}</span></span>`
      : "";
  const epInfo = resolveSeriesEpisodeInfo(item);
  const showBottomSeriesProgress =
    item.media_type === "series" &&
    !kStatus.watched &&
    !kStatus.not_watching &&
    (epInfo.hasSeasonProgress || epInfo.hasNewEpisode);
  const bottomEpCounterText =
    epInfo.hasSeasonProgress && epInfo.totalSeasonEpisodes > 0 && epInfo.watchedInSeasonCount > 0
      ? isEn()
        ? `S${epInfo.season}: ${epInfo.watchedInSeasonCount} of ${epInfo.totalSeasonEpisodes}`
        : `${epInfo.season}: ${epInfo.watchedInSeasonCount} из ${epInfo.totalSeasonEpisodes}`
      : epInfo.hasNewEpisode && epInfo.episodeVerified
      ? isEn()
        ? `S${epInfo.season} · E${epInfo.episode}`
        : `С${epInfo.season} · Е${epInfo.episode}`
      : "";
  const posterBottomCounterHtml =
    showBottomSeriesProgress && bottomEpCounterText
      ? `<div class="atv-poster-ep-counter" title="${escapeAttr(epInfo.seasonProgressText || bottomEpCounterText)}">${escapeHtml(bottomEpCounterText)}</div>`
      : "";
  const posterSeasonBarHtml =
    item.media_type === "series" &&
    epInfo.hasSeasonProgress &&
    epInfo.seasonPct > 0 &&
    !kStatus.watched
      ? `<div class="atv-poster-season-bar" title="${escapeAttr(epInfo.seasonProgressText)} (${epInfo.seasonPct}%)"><div class="atv-poster-season-fill" style="width:${epInfo.seasonPct}%"></div></div>`
      : "";

  const cardTitle = displayTitle(item);
  const posterSrc = displayPoster(item);
  const card = document.createElement("div");
  card.className = "atv-poster-item";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.onmouseenter = () => setAmbientColor(item.ambient_color || "#334155");
  card.innerHTML = `
    <div class="atv-poster-frame">
      <img src="${escapeAttr(posterSrc)}" alt="${escapeAttr(cardTitle)}" loading="lazy" referrerpolicy="no-referrer" />
      ${buildPosterBadgesHtml(item)}
      ${posterBottomCounterHtml}
      ${posterSeasonBarHtml}
      <button
        type="button"
        class="atv-poster-play-center"
        title="${t("Смотреть сразу", "Play Now")}"
        aria-label="${t("Смотреть", "Play")} ${escapeAttr(cardTitle)}"
      >
        ${iconSvg("play", 18)}
      </button>
    </div>
    <div class="atv-poster-caption">
      <div class="atv-poster-title" title="${escapeAttr(cardTitle)}">${escapeHtml(cardTitle)}</div>
      <div class="atv-poster-meta"><span>${escapeHtml(item.year)}</span>${ratingMetaHtml}${friendsHtml}</div>
    </div>
  `;
  const imgEl = card.querySelector("img");
  attachSmartPosterFallback(imgEl, cardTitle, item.year, item.poster);

  const playCenterBtn = card.querySelector(".atv-poster-play-center");
  if (playCenterBtn) {
    playCenterBtn.onclick = (e) => {
      e.stopPropagation();
      const info = resolveSeriesEpisodeInfo(item);
      openPlayerModal(
        item,
        getDefaultPlayableSourceTab(),
        info.season,
        info.episode,
        info.currentTime
      );
    };
  }

  card.onclick = () => {
    openQuickPeekModal(item);
  };
  card.onkeydown = (e) => {
    if (e.target === card && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      openQuickPeekModal(item);
    }
  };
  return card;
}
export function buildPageNumbers(currentPage, totalPages) {
  if (totalPages <= 9) {
    return Array.from({ length: totalPages }, (_, idx) => idx + 1);
  }
  const pages = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1, currentPage - 2, currentPage + 2]);
  const sorted = Array.from(pages)
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
      result.push("...");
    }
    result.push(sorted[i]);
  }
  return result;
}
export function renderPosterCardsInto(gridEl, items) {
  const PAGE_SIZE = 30;
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageStateKey = `${gridEl.id}:${state.kinoriumSection}:${state.kinoriumSubType}:${state.mediaTypeFilter}:${state.providerFilter}:${state.genreFilter}:${state.yearFilter}:${state.hideWatched}:${state.friendsFilter}:${state.selectedFriend}:${state.sortBy}:${state.searchQuery.trim()}`;
  let currentPage = Math.max(1, Math.min(totalPages, state.gridPages[pageStateKey] || 1));

  const pagerContainerId = `${gridEl.id}-pagination`;
  let existingPager = document.getElementById(pagerContainerId);
  if (existingPager) existingPager.remove();

  function renderPage(pageNum, scrollToTop = false) {
    currentPage = Math.max(1, Math.min(totalPages, pageNum));
    state.gridPages[pageStateKey] = currentPage;
    gridEl.innerHTML = "";

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const slice = items.slice(startIdx, startIdx + PAGE_SIZE);
    const frag = document.createDocumentFragment();
    slice.forEach((item) => {
      frag.appendChild(createPosterCardElement(item));
    });
    gridEl.appendChild(frag);

    const oldPager = document.getElementById(pagerContainerId);
    if (oldPager) oldPager.remove();

    if (totalPages > 1) {
      const pager = document.createElement("div");
      pager.id = pagerContainerId;
      pager.className = "atv-pagination";

      const prevBtn = document.createElement("button");
      prevBtn.className = "atv-page-btn";
      prevBtn.innerHTML = `${iconSvg("chevronLeft", 13)}<span>${t("Назад", "Prev")}</span>`;
      prevBtn.disabled = currentPage === 1;
      prevBtn.onclick = () => renderPage(currentPage - 1, true);
      pager.appendChild(prevBtn);

      const pageNums = buildPageNumbers(currentPage, totalPages);
      pageNums.forEach((p) => {
        if (p === "...") {
          const span = document.createElement("span");
          span.className = "atv-page-ellipsis";
          span.textContent = "…";
          pager.appendChild(span);
        } else {
          const btn = document.createElement("button");
          btn.className = `atv-page-btn${p === currentPage ? " active" : ""}`;
          btn.textContent = String(p);
          btn.onclick = () => {
            if (p !== currentPage) renderPage(p, true);
          };
          pager.appendChild(btn);
        }
      });

      const nextBtn = document.createElement("button");
      nextBtn.className = "atv-page-btn";
      nextBtn.innerHTML = `<span>${t("Далее", "Next")}</span>${iconSvg("chevronRight", 13)}`;
      nextBtn.disabled = currentPage === totalPages;
      nextBtn.onclick = () => renderPage(currentPage + 1, true);
      pager.appendChild(nextBtn);

      const info = document.createElement("span");
      info.className = "atv-page-info";
      info.textContent = isEn()
        ? `Page ${currentPage} of ${totalPages} · ${items.length} ${items.length === 1 ? "title" : "titles"}`
        : `Страница ${currentPage} из ${totalPages} · ${items.length} ${pluralRu(
            items.length,
            "тайтл",
            "тайтла",
            "тайтлов"
          )}`;
      pager.appendChild(info);

      gridEl.parentNode.appendChild(pager);
    }

    if (scrollToTop) {
      const sectionEl = gridEl.closest(".atv-section");
      if (sectionEl) {
        sectionEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }

  renderPage(currentPage, false);
}

export function patchCatalogItemKinoriumInPlace(item, kStatus) {
  if (!item || !kStatus) return;
  item.kinorium = kStatus;
  if (kStatus.kinorium_counts) {
    state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
    updateKinoriumSectionCounters();
  }
  const matchId = item.id || "";
  const matchTitle = (item.title || "").trim().toLowerCase();
  const patchList = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((entry) => {
      if (!entry) return;
      if ((matchId && entry.id === matchId) || (matchTitle && (entry.title || "").trim().toLowerCase() === matchTitle)) {
        entry.kinorium = { ...(entry.kinorium || {}), ...kStatus };
      }
    });
  };
  patchList(state.catalogItems);
  patchList(state.similarPool);
  if (state.isPlayerOpen && !state.isMiniPlayer && !state.isPipBackground) {
    state.catalogDirty = true;
  } else {
    loadCatalog();
  }
}
