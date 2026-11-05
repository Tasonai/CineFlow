import { CURATED_SHELVES_STORAGE_KEY, state } from "./state.js?v=20261105v4";
import {
  displayTitle,
  getItemGenreEntries,
  t,
  translateGenre,
} from "./i18n.js?v=20261105v4";
import {
  clampFloatingPopover,
  closeFloatingPopovers,
  escapeHtml,
  iconSvg,
  pluralRu,
  saveUiPrefs,
  showToast,
  syncCustomSelect,
  syncSearchInputHasQueryUI,
} from "./utils.js?v=20261105v4";
import {
  renderHero,
  resetHeroRecordedThisLaunch,
} from "./catalog-hero.js?v=20261105v4";
import {
  applyEnabledServicesVisibility,
  getFriendsAverageScore,
  isItemWatchedOrCaughtUp,
  isServiceEnabled,
} from "./catalog-media-resolver.js?v=20261105v4";
import {
  renderCatalogShelves,
  renderContinueWatching,
} from "./catalog-shelves.js?v=20261105v4";
import { switchNotificationsTab } from "./catalog-notifications.js?v=20261105v4";
import { syncSearchClearButton } from "./catalog-live-search.js?v=20261105v4";
import { openDownloadsModal, setOfflineMode } from "./features-downloads.js?v=20261105v4";
import { openQuickPeekModal } from "./modals.js?v=20261105v4";
import { loadCatalog } from "./catalog.js?v=20261105v4";

export function updateActiveFiltersBadge() {
  let drawerCount = 0;
  if (state.genreFilter && state.genreFilter !== "all") drawerCount += 1;
  if (state.yearFilter && state.yearFilter !== "all") drawerCount += 1;
  if (state.collectionFilter && state.collectionFilter !== "all") drawerCount += 1;
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
        if (!g || g === "Фильм" || g === "Сериал" || g === "Movie" || g === "Series") return;
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

  const collSel = document.getElementById("select-catalog-collection");
  if (collSel) {
    const validColl = new Set(["all", "rating_8", "rating_75", "uhd_4k", "friends_8"]);
    collSel.innerHTML = "";
    const baseOpts = [
      ["all", t("Все подборки", "All collections")],
      ["rating_8", t("Шедевры 8.0+ (IMDb / Kinorium)", "Masterpieces 8.0+ (IMDb / Kinorium)")],
      ["rating_75", t("Высокий рейтинг 7.5+", "High Rating 7.5+")],
      ["uhd_4k", t("В 4K UHD / BDRemux", "In 4K UHD / BDRemux")],
      ["friends_8", t("Фавориты друзей (8.0+)", "Friends' Favorites (8.0+)")],
    ];
    baseOpts.forEach(([val, label]) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      collSel.appendChild(opt);
    });

    const studioCounts = new Map();
    items.forEach((it) => {
      const stStr = String(it.studios_summary || it.preferred_studio || "").trim();
      if (stStr) {
        stStr.split(",").forEach((rawS) => {
          const sName = rawS.trim();
          if (sName && sName.toLowerCase() !== "hdrezka") {
            studioCounts.set(sName, (studioCounts.get(sName) || 0) + 1);
          }
        });
      }
    });
    Array.from(studioCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .forEach(([sName, cnt]) => {
        const val = `studio:${sName}`;
        validColl.add(val);
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = `${t("Озвучка", "Studio")}: ${sName} (${cnt})`;
        collSel.appendChild(opt);
      });

    if (state.collectionFilter && !validColl.has(state.collectionFilter)) {
      state.collectionFilter = "all";
    }
    collSel.value = state.collectionFilter || "all";
  }

  updateActiveFiltersBadge();
}
export function renderActiveFilterChips() {
  const chipsBar = document.getElementById("active-filter-chips-bar");
  if (!chipsBar) return;
  chipsBar.innerHTML = "";
  const chips = [];

  if (state.searchQuery && String(state.searchQuery).trim()) {
    chips.push({
      label: `${t("Поиск", "Search")}: ${String(state.searchQuery).trim()}`,
      reloadCatalog: true,
      clear: () => {
        state.searchQuery = "";
        state.searchResults = null;
        const inp = document.getElementById("global-search");
        if (inp) inp.value = "";
        document.getElementById("search-persons-section")?.classList.add("hidden");
        syncSearchInputHasQueryUI();
      },
    });
  }
  if (state.mediaTypeFilter && state.mediaTypeFilter !== "all") {
    chips.push({
      label: `${t("Тип", "Type")}: ${
        state.mediaTypeFilter === "series" ? t("Сериалы", "Series") : t("Фильмы", "Movies")
      }`,
      refreshHero: true,
      clear: () => {
        state.mediaTypeFilter = "all";
        document.querySelectorAll("#media-type-bar .type-pill").forEach((b) => {
          b.classList.toggle("active", b.dataset.type === "all");
        });
      },
    });
  }
  if (state.providerFilter && state.providerFilter !== "all") {
    const providerLabels = {
      hdrezka: "HDRezka",
      stremio: "Stremio",
      backup4k: "4K Remux",
      appletv: "Apple TV+",
      netflix: "Netflix",
      prime: "Prime Video",
      disney: "Disney+",
      max: "Max",
      playerpl: "Player.pl",
    };
    chips.push({
      label: `${t("Источник", "Source")}: ${providerLabels[state.providerFilter] || state.providerFilter}`,
      reloadCatalog: true,
      clear: () => {
        state.providerFilter = "all";
        document.querySelectorAll("#provider-filter-bar .atv-pill").forEach((b) => {
          b.classList.toggle("active", b.dataset.provider === "all");
        });
      },
    });
  }
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
  if (state.collectionFilter && state.collectionFilter !== "all") {
    const collLabels = {
      rating_8: t("Шедевры 8.0+", "Masterpieces 8.0+"),
      rating_75: t("Рейтинг 7.5+", "Rating 7.5+"),
      uhd_4k: "4K UHD",
      friends_8: t("Фавориты друзей 8+", "Friends 8+"),
    };
    const lbl = state.collectionFilter.startsWith("studio:")
      ? `${t("Озвучка", "Studio")}: ${state.collectionFilter.slice(7)}`
      : collLabels[state.collectionFilter] || state.collectionFilter;
    chips.push({
      label: lbl,
      clear: () => {
        state.collectionFilter = "all";
        const sel = document.getElementById("select-catalog-collection");
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
      if (ch.reloadCatalog) {
        loadCatalog();
      } else {
        if (ch.refreshHero) {
          renderHero();
          renderContinueWatching();
        }
        renderCatalogShelves();
      }
    };
    chipsBar.appendChild(btn);
  });
}

export function filterCatalogItemsByGenreAndYear(items, options = {}) {
  const { bypassWatchedOnSearch = true } = options;
  const isSearchActive = bypassWatchedOnSearch && Boolean(state.searchQuery.trim());
  let out = items;
  if (
    !isSearchActive &&
    (state.kinoriumSection === "premieres" ||
      state.kinoriumSection === "watching" ||
      (state.hideWatched && state.kinoriumSection !== "watched"))
  ) {
    out = out.filter((it) => !isItemWatchedOrCaughtUp(it));
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
  if (state.collectionFilter && state.collectionFilter !== "all") {
    const cf = String(state.collectionFilter);
    out = out.filter((it) => {
      const kScore = parseFloat(it.kinorium?.kinorium_rating || it.ratings?.kinorium) || 0;
      const iScore = parseFloat(it.ratings?.imdb) || 0;
      const bestScore = Math.max(kScore, iScore);
      if (cf === "rating_8") return bestScore >= 8.0;
      if (cf === "rating_75") return bestScore >= 7.5;
      if (cf === "uhd_4k") {
        return (it.providers || []).some(
          (p) => p && p.available && (p.id === "backup4k" || /4k|2160/i.test(String(p.quality || "")))
        );
      }
      if (cf === "friends_8") {
        return getFriendsAverageScore(it) >= 8.0;
      }
      if (cf.startsWith("studio:")) {
        const targetSt = cf.slice(7).trim().toLowerCase();
        const stSummary = String(it.studios_summary || it.preferred_studio || "").toLowerCase();
        return stSummary.includes(targetSt);
      }
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
export function _hashItemKey(str, salt = 0) {
  let h = (Number(state.launchSeed || 1) ^ (salt * 0x9e3779b1)) >>> 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x5bd1e995) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
  }
  return h >>> 0;
}

export function seededShuffle(items, salt = 0) {
  return items
    .slice()
    .sort((a, b) => {
      const ha = _hashItemKey(a?.id || a?.title || "", salt);
      const hb = _hashItemKey(b?.id || b?.title || "", salt);
      return ha - hb;
    });
}

export function rerollCatalogLaunchSeed() {
  state.launchSeed = Math.floor(Math.random() * 0x7fffffff) || 1;
  state.heroIndex = 0;
  state.gridPages = {};
  resetHeroRecordedThisLaunch();
}

export function getCurrentlyFilteredItems() {
  const base = sortCatalogItems(filterCatalogItemsByGenreAndYear(state.catalogItems));
  const effectiveType = state.mediaTypeFilter || "all";
  if (effectiveType === "movie") return base.filter((i) => i.media_type === "movie");
  if (effectiveType === "series") return base.filter((i) => i.media_type === "series");
  return base;
}
export function sortCatalogItems(items) {
  if (!state.sortBy || state.sortBy === "default") {
    if (state.providerFilter && state.providerFilter !== "all" && !state.searchQuery.trim()) {
      const prov = state.providerFilter;
      const primary = items
        .filter((it) => it && it.primary_provider === prov)
        .sort((a, b) => (a._provider_rank ?? 9999) - (b._provider_rank ?? 9999));
      const secondary = seededShuffle(
        items.filter((it) => it && it.primary_provider !== prov),
        202
      );
      return [...primary, ...secondary];
    }
    if (state.kinoriumSection === "all" && !state.searchQuery.trim() && items.length > 1) {
      const shuffled = seededShuffle(items, 202);
      const leadHeroId = state.heroItems?.[0]?.id;
      if (leadHeroId && shuffled.length > 12) {
        const idx = shuffled.findIndex((it) => it && it.id === leadHeroId);
        if (idx >= 0 && idx < 12) {
          const [heroDup] = shuffled.splice(idx, 1);
          shuffled.splice(12, 0, heroDup);
        }
      }
      return shuffled;
    }
    return items;
  }
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

export function resetCatalogDrawerFiltersUI() {
  state.genreFilter = "all";
  state.yearFilter = "all";
  state.collectionFilter = "all";
  state.sortBy = "default";
  state.hideWatched = false;
  state.friendsFilter = false;
  state.selectedFriend = "all";
  saveUiPrefs({ hideWatched: false });
  const sortSel = document.getElementById("select-catalog-sort");
  if (sortSel) sortSel.value = "default";
  const genreSel = document.getElementById("select-catalog-genre");
  if (genreSel) genreSel.value = "all";
  const yearSel = document.getElementById("select-catalog-year");
  if (yearSel) yearSel.value = "all";
  const collSel = document.getElementById("select-catalog-collection");
  if (collSel) collSel.value = "all";
  const friendSel = document.getElementById("select-friend-filter");
  if (friendSel) friendSel.value = "all";
  document.getElementById("btn-hide-watched")?.classList.remove("active");
  document.getElementById("btn-friends-filter")?.classList.remove("active");
  updateActiveFiltersBadge();
}

export function initCatalogToolbarAndFilterBindings() {
  const searchInput = document.getElementById("global-search");
  const brandHomeEl = document.getElementById("brand-home");
  if (brandHomeEl) {
    brandHomeEl.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        brandHomeEl.click();
      }
    };
    brandHomeEl.onclick = () => {
      rerollCatalogLaunchSeed();
      state.searchQuery = "";
      state.providerFilter = "all";
      state.mediaTypeFilter = "all";
      state.kinoriumSection = "all";
      state.kinoriumSubType = "all";
      if (searchInput) searchInput.value = "";
      syncSearchClearButton();
      resetCatalogDrawerFiltersUI();
      document.querySelectorAll(".atv-pill").forEach((b) => {
        b.classList.toggle("active", b.dataset.provider === "all");
      });
      document.querySelectorAll(".type-pill").forEach((b) => {
        b.classList.toggle("active", b.dataset.type === "all");
      });
      document.querySelectorAll(".kin-sec-pill").forEach((b) => {
        b.classList.toggle("active", b.dataset.ksec === "all");
      });
      loadCatalog();
    };
  }

  const toggleCatalogFiltersBtn = document.getElementById("btn-toggle-catalog-filters");
  const catalogFiltersDrawer = document.getElementById("catalog-filters-drawer");
  if (toggleCatalogFiltersBtn && catalogFiltersDrawer) {
    toggleCatalogFiltersBtn.onclick = () => {
      const isHidden = catalogFiltersDrawer.classList.toggle("hidden");
      toggleCatalogFiltersBtn.setAttribute("aria-expanded", isHidden ? "false" : "true");
      toggleCatalogFiltersBtn.setAttribute("aria-pressed", isHidden ? "false" : "true");
      updateActiveFiltersBadge();
    };
  }

  const clearCatalogFiltersBtn = document.getElementById("btn-clear-catalog-filters");
  if (clearCatalogFiltersBtn) {
    clearCatalogFiltersBtn.onclick = () => {
      resetCatalogDrawerFiltersUI();
      renderCatalogShelves();
      showToast(t("Фильтры и сортировка сброшены", "Filters and sorting reset"));
    };
  }

  const toggleCuratedBtn = document.getElementById("btn-toggle-curated-shelves");
  if (toggleCuratedBtn) {
    toggleCuratedBtn.classList.toggle("active", state.showCuratedShelves !== false);
    toggleCuratedBtn.onclick = () => {
      state.showCuratedShelves = state.showCuratedShelves === false;
      try {
        localStorage.setItem(CURATED_SHELVES_STORAGE_KEY, state.showCuratedShelves ? "true" : "false");
      } catch (err) {
        window.logDebug?.("CatalogFilters", err);
      }
      toggleCuratedBtn.classList.toggle("active", state.showCuratedShelves);
      renderCatalogShelves();
      showToast(
        state.showCuratedShelves
          ? t("Персональные подборки на главной включены", "Curated shelves enabled")
          : t("Персональные подборки скрыты", "Curated shelves hidden")
      );
    };
  }

  const btnOpenRelCal = document.getElementById("btn-open-release-calendar");
  if (btnOpenRelCal) {
    btnOpenRelCal.onclick = (e) => {
      e?.stopPropagation();
      const shelf = document.getElementById("release-calendar-shelf");
      if (shelf && !shelf.classList.contains("hidden")) {
        shelf.scrollIntoView({ behavior: "smooth", block: "start" });
        const firstCard = shelf.querySelector(".atv-cal-shelf-card");
        if (firstCard) firstCard.focus();
      } else {
        closeFloatingPopovers();
        switchNotificationsTab("calendar");
        const notifPopover = document.getElementById("notifications-popover");
        const notifBellBtn = document.getElementById("notifications-bell-btn");
        if (notifPopover) {
          notifPopover.classList.remove("hidden");
          notifBellBtn?.classList.add("active");
          notifBellBtn?.setAttribute("aria-expanded", "true");
          clampFloatingPopover(notifPopover, { isHeader: true });
        }
      }
    };
  }

  const hideWatchedBtn = document.getElementById("btn-hide-watched");
  if (hideWatchedBtn) {
    hideWatchedBtn.onclick = () => {
      state.hideWatched = !state.hideWatched;
      saveUiPrefs({ hideWatched: state.hideWatched });
      hideWatchedBtn.classList.toggle("active", state.hideWatched);
      updateActiveFiltersBadge();
      renderCatalogShelves();
      showToast(
        state.hideWatched
          ? t("Просмотренные фильмы и сериалы скрыты", "Watched movies and series hidden")
          : t("Отображение просмотренных фильмов включено", "Showing watched titles")
      );
    };
  }

  const friendSelect = document.getElementById("select-friend-filter");
  const friendsFilterBtn = document.getElementById("btn-friends-filter");
  if (friendsFilterBtn) {
    friendsFilterBtn.onclick = () => {
      state.friendsFilter = !state.friendsFilter;
      if (!state.friendsFilter) {
        state.selectedFriend = "all";
        if (friendSelect) friendSelect.value = "all";
      }
      friendsFilterBtn.classList.toggle("active", state.friendsFilter);
      updateActiveFiltersBadge();
      renderCatalogShelves();
      showToast(
        state.friendsFilter
          ? t(
              "Показаны только фильмы и сериалы с оценками друзей",
              "Showing only movies and series rated by friends"
            )
          : t("Фильтр «Оценили друзья» отключен", '"Rated by friends" filter disabled')
      );
    };
  }
  if (friendSelect) {
    friendSelect.onchange = (e) => {
      const val = e.target.value || "all";
      state.selectedFriend = val;
      if (val !== "all") {
        state.friendsFilter = true;
        friendsFilterBtn?.classList.add("active");
        showToast(t(`Показаны тайтлы, которые оценил(а) ${val}`, `Showing titles rated by ${val}`));
      } else {
        showToast(t("Показаны оценки всех друзей", "Showing ratings from all friends"));
      }
      updateActiveFiltersBadge();
      renderCatalogShelves();
    };
  }

  const genreSelect = document.getElementById("select-catalog-genre");
  if (genreSelect) {
    genreSelect.onchange = (e) => {
      state.genreFilter = e.target.value || "all";
      updateActiveFiltersBadge();
      renderCatalogShelves();
    };
  }

  const yearSelect = document.getElementById("select-catalog-year");
  if (yearSelect) {
    yearSelect.onchange = (e) => {
      state.yearFilter = e.target.value || "all";
      updateActiveFiltersBadge();
      renderCatalogShelves();
    };
  }

  const collSelect = document.getElementById("select-catalog-collection");
  if (collSelect) {
    collSelect.onchange = (e) => {
      state.collectionFilter = e.target.value || "all";
      updateActiveFiltersBadge();
      renderCatalogShelves();
    };
  }

  const sortSelect = document.getElementById("select-catalog-sort");
  if (sortSelect) {
    sortSelect.onchange = (e) => {
      state.sortBy = e.target.value || "default";
      updateActiveFiltersBadge();
      renderCatalogShelves();
    };
  }

  const randomPickBtn = document.getElementById("btn-random-pick");
  if (randomPickBtn) {
    randomPickBtn.onclick = () => {
      const pool = getCurrentlyFilteredItems();
      if (!pool || pool.length === 0) {
        showToast(
          t(
            "В текущем разделе или фильтре нет подходящих тайтлов",
            "No matching titles in the current section or filter"
          )
        );
        return;
      }
      const picked = pool[Math.floor(Math.random() * pool.length)];
      showToast(
        t(
          `Случайный выбор: «${displayTitle(picked)}» (${picked.year})`,
          `Random pick: "${displayTitle(picked)}" (${picked.year})`
        )
      );
      openQuickPeekModal(picked);
    };
  }

  document.querySelectorAll(".kin-sec-pill").forEach((btn) => {
    btn.onclick = () => {
      state.kinoriumSection = btn.dataset.ksec;
      state.kinoriumSubType = state.mediaTypeFilter || "all";
      document.querySelectorAll(".kin-sec-pill").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      requestAnimationFrame(() => {
        try {
          btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        } catch (err) {
          window.logDebug?.("CatalogFilters", err);
        }
      });
      loadCatalog();
    };
  });

  document.querySelectorAll(".type-pill").forEach((btn) => {
    btn.onclick = () => {
      const nextType = btn.dataset.type || "all";
      state.mediaTypeFilter = nextType;
      state.kinoriumSubType = nextType;
      document.querySelectorAll(".type-pill").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      renderContinueWatching();
      if (state.kinoriumSection !== "all" || nextType === "offline") {
        renderCatalogShelves();
      } else {
        loadCatalog();
      }
    };
  });

  const btnOfflineView = document.getElementById("btn-offline-banner-view");
  if (btnOfflineView) {
    btnOfflineView.onclick = () => {
      const offlinePill = document.getElementById("type-pill-offline");
      if (offlinePill && !offlinePill.classList.contains("hidden")) {
        offlinePill.click();
      } else {
        openDownloadsModal();
      }
    };
  }

  const btnOfflineRetry = document.getElementById("btn-offline-banner-retry");
  if (btnOfflineRetry) {
    btnOfflineRetry.onclick = async () => {
      showToast(t("Проверяем подключение к сети...", "Checking network connection..."));
      try {
        const res = await fetch("/api/system/status", { cache: "no-store" });
        if (res.ok) {
          setOfflineMode(false);
          showToast(t("Подключение успешно восстановлено", "Connection restored successfully"));
          loadCatalog({ showLoading: true });
        } else {
          showToast(t("Сеть пока недоступна", "Network is still unavailable"));
        }
      } catch (_) {
        showToast(t("Сеть пока недоступна", "Network is still unavailable"));
      }
    };
  }

  window.addEventListener("online", () => {
    setOfflineMode(false);
    showToast(t("Подключение к сети восстановлено", "Network connection restored"));
    loadCatalog();
  });

  window.addEventListener("offline", () => {
    setOfflineMode(true);
    showToast(t("Офлайн-режим: доступны скачанные фильмы и серии", "Offline mode: downloaded movies and series available"));
    renderCatalogShelves();
  });

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setOfflineMode(true);
  }

  document.querySelectorAll(".atv-pill").forEach((btn) => {
    btn.onclick = () => {
      const nextProv = btn.dataset.provider || "all";
      if (state.providerFilter === nextProv && nextProv !== "all") {
        state.providerFilter = "all";
      } else {
        state.providerFilter = nextProv;
      }
      if (state.providerFilter && state.providerFilter !== "all") {
        state.kinoriumSection = "all";
        document.querySelectorAll(".kin-sec-pill").forEach((b) => {
          const isAll = b.dataset.ksec === "all";
          b.classList.toggle("active", isAll);
          b.setAttribute("aria-selected", isAll ? "true" : "false");
        });
      }
      document.querySelectorAll(".atv-pill").forEach((b) => {
        const isCur = b.dataset.provider === state.providerFilter;
        b.classList.toggle("active", isCur);
        b.setAttribute("aria-pressed", isCur ? "true" : "false");
      });
      applyEnabledServicesVisibility();
      loadCatalog();
    };
  });
}
