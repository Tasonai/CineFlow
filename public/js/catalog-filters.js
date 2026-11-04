import { state } from "./state.js?v=20261104v23";
import {
  getItemGenreEntries,
  t,
  translateGenre,
} from "./i18n.js?v=20261104v23";
import {
  escapeHtml,
  iconSvg,
  pluralRu,
  syncCustomSelect,
} from "./utils.js?v=20261104v23";
import {
  renderHero,
  resetHeroRecordedThisLaunch,
} from "./catalog-hero.js?v=20261104v23";
import {
  getFriendsAverageScore,
  isItemWatchedOrCaughtUp,
  isServiceEnabled,
} from "./catalog-media-resolver.js?v=20261104v23";
import {
  renderCatalogShelves,
  renderContinueWatching,
} from "./catalog-shelves.js?v=20261104v23";
import { loadCatalog } from "./catalog.js?v=20261104v23";

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
