import {
  RECENT_SEARCHES_STORAGE_KEY,
  profileStorageKey,
  state,
} from "./state.js?v=20261105v3";
import {
  displayPoster,
  displayTitle,
  isEn,
  secondaryTitle,
  t,
} from "./i18n.js?v=20261105v3";
import {
  clampFloatingPopover,
  closeFloatingPopovers,
  escapeAttr,
  escapeHtml,
  iconSvg,
  logDebug,
  syncSearchInputHasQueryUI,
} from "./utils.js?v=20261105v3";
import {
  attachSmartPosterFallback,
  getDefaultPlayableSourceTab,
  isServiceEnabled,
  loadCatalog,
  resolveSeriesEpisodeInfo,
  updateActiveFiltersBadge,
} from "./catalog.js?v=20261105v3";
import {
  buildFallbackAvatarSvg,
  openPersonModal,
  openQuickPeekModal,
} from "./modals.js?v=20261105v3";
import { openPlayerModal } from "./player.js?v=20261105v3";

let liveSearchReqId = 0;
let debounceTimer = null;
let liveSearchAbortCtrl = null;
let liveSearchHitsState = [];
let liveSearchActiveIdx = -1;

export const syncSearchClearButton = () => {
  syncSearchInputHasQueryUI();
};

export const abortLiveSearchInFlight = () => {
  if (liveSearchAbortCtrl) {
    try {
      liveSearchAbortCtrl.abort();
    } catch (err) {
      logDebug("LiveSearchAbort", err);
    }
    liveSearchAbortCtrl = null;
  }
};

export const closeLiveSearchPopover = () => {
  const searchLivePopover = document.getElementById("search-live-popover");
  const searchInput = document.getElementById("global-search");
  if (searchLivePopover) {
    searchLivePopover.classList.add("hidden");
  }
  if (searchInput) {
    searchInput.setAttribute("aria-expanded", "false");
    searchInput.removeAttribute("aria-activedescendant");
  }
};

export const syncLiveSearchActiveHighlight = () => {
  const searchLivePopover = document.getElementById("search-live-popover");
  const searchInput = document.getElementById("global-search");
  if (!searchLivePopover) return;
  const rows = searchLivePopover.querySelectorAll(
    ".atv-search-hit, .atv-search-recent-row, .atv-search-quick-random, .atv-search-all-btn"
  );
  let activeId = "";
  rows.forEach((r, idx) => {
    const isAct = idx === liveSearchActiveIdx;
    const optId = r.id || `live-search-opt-${idx}`;
    r.id = optId;
    r.setAttribute("role", "option");
    r.setAttribute("aria-selected", isAct ? "true" : "false");
    r.classList.toggle("active-hit", isAct);
    if (isAct) {
      activeId = optId;
      try {
        r.scrollIntoView({ block: "nearest" });
      } catch (err) {
        logDebug("ScrollIntoView", err);
      }
    }
  });
  if (searchInput) {
    if (activeId) {
      searchInput.setAttribute("aria-activedescendant", activeId);
    } else {
      searchInput.removeAttribute("aria-activedescendant");
    }
  }
};

export const getRecentSearches = () => {
  try {
    const raw = localStorage.getItem(profileStorageKey(RECENT_SEARCHES_STORAGE_KEY));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => String(x || "").trim())
      .filter((x) => x.length >= 2)
      .slice(0, 7);
  } catch (err) {
    logDebug("GetRecentSearches", err);
    return [];
  }
};

export const saveRecentSearchQuery = (rawQuery) => {
  const clean = String(rawQuery || "").trim();
  if (clean.length < 2) return;
  try {
    const lower = clean.toLowerCase();
    const next = [clean, ...getRecentSearches().filter((q) => q.toLowerCase() !== lower)].slice(0, 7);
    localStorage.setItem(profileStorageKey(RECENT_SEARCHES_STORAGE_KEY), JSON.stringify(next));
  } catch (err) {
    logDebug("SaveRecentSearch", err);
  }
};

export const removeRecentSearchQuery = (rawQuery) => {
  const lower = String(rawQuery || "").trim().toLowerCase();
  if (!lower) return;
  try {
    const next = getRecentSearches().filter((q) => q.toLowerCase() !== lower);
    localStorage.setItem(profileStorageKey(RECENT_SEARCHES_STORAGE_KEY), JSON.stringify(next));
  } catch (err) {
    logDebug("RemoveRecentSearch", err);
  }
};

export const clearRecentSearches = () => {
  try {
    localStorage.removeItem(profileStorageKey(RECENT_SEARCHES_STORAGE_KEY));
  } catch (err) {
    logDebug("ClearRecentSearches", err);
  }
};

export const runSubmittedRecentSearch = (queryStr) => {
  const searchInput = document.getElementById("global-search");
  const clean = String(queryStr || "").trim();
  if (!clean) return;
  abortLiveSearchInFlight();
  if (searchInput) searchInput.value = clean;
  syncSearchClearButton();
  saveRecentSearchQuery(clean);
  closeLiveSearchPopover();
  resetCatalogFiltersForGlobalSearch();
  state.searchQuery = clean;
  loadCatalog({ showLoading: true });
};

export const renderEmptySearchSuggestions = () => {
  const searchLivePopover = document.getElementById("search-live-popover");
  const searchInput = document.getElementById("global-search");
  if (!searchLivePopover) return;
  closeFloatingPopovers({ exceptId: "search-live-popover" });
  const recent = getRecentSearches();
  liveSearchHitsState = [
    ...recent.map((q) => ({ _hitKind: "recent", query: q })),
    { _hitKind: "random" },
  ];
  liveSearchActiveIdx = -1;
  searchLivePopover.innerHTML = "";
  searchLivePopover.classList.remove("hidden");
  searchInput?.setAttribute("aria-expanded", "true");
  searchInput?.removeAttribute("aria-activedescendant");

  if (recent.length > 0) {
    const head = document.createElement("div");
    head.className = "atv-search-recent-head";
    head.innerHTML = `
      <span>${escapeHtml(t("Недавние запросы", "Recent searches"))}</span>
      <button type="button" class="atv-search-recent-clear">${escapeHtml(t("Очистить", "Clear"))}</button>
    `;
    head.querySelector(".atv-search-recent-clear")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      clearRecentSearches();
      renderEmptySearchSuggestions();
      searchInput?.focus();
    });
    searchLivePopover.appendChild(head);

    const listEl = document.createElement("div");
    listEl.className = "atv-search-recent-list";
    recent.forEach((q, idx) => {
      const row = document.createElement("div");
      row.id = `live-search-opt-${idx}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", "false");
      row.className = "atv-search-recent-row";
      row.innerHTML = `
        <button type="button" class="atv-search-recent-btn">
          ${iconSvg("clock", 13)}
          <span class="atv-search-recent-q">${escapeHtml(q)}</span>
        </button>
        <button type="button" class="atv-search-recent-del" title="${escapeAttr(t("Удалить из истории", "Remove from history"))}" aria-label="${escapeAttr(t("Удалить из истории", "Remove from history"))}">
          ${iconSvg("x", 11)}
        </button>
      `;
      row.querySelector(".atv-search-recent-btn")?.addEventListener("click", () => {
        runSubmittedRecentSearch(q);
      });
      row.querySelector(".atv-search-recent-del")?.addEventListener("click", (ev) => {
        ev.stopPropagation();
        removeRecentSearchQuery(q);
        renderEmptySearchSuggestions();
        searchInput?.focus();
      });
      listEl.appendChild(row);
    });
    searchLivePopover.appendChild(listEl);
  }

  const randomBtn = document.createElement("button");
  randomBtn.type = "button";
  randomBtn.id = `live-search-opt-${recent.length}`;
  randomBtn.setAttribute("role", "option");
  randomBtn.setAttribute("aria-selected", "false");
  randomBtn.className = "atv-search-quick-random";
  randomBtn.innerHTML = `${iconSvg("star", 12)}<span>${escapeHtml(
    t("Случайный выбор на вечер", "Random pick for tonight")
  )}</span>`;
  randomBtn.onclick = () => {
    closeLiveSearchPopover();
    searchInput?.blur();
    document.getElementById("btn-random-pick")?.click();
  };
  searchLivePopover.appendChild(randomBtn);
  clampFloatingPopover(searchLivePopover, { isHeader: true });
};

export const renderLiveSearchHits = (queryText, itemsList, isLoading = false, personsList = []) => {
  const searchLivePopover = document.getElementById("search-live-popover");
  const searchInput = document.getElementById("global-search");
  if (!searchLivePopover) return;
  const qClean = queryText.trim();
  const currentInputClean = String(searchInput?.value || "").trim();
  if (qClean.length < 2 || currentInputClean.toLowerCase() !== qClean.toLowerCase()) {
    liveSearchHitsState = [];
    liveSearchActiveIdx = -1;
    closeLiveSearchPopover();
    searchLivePopover.innerHTML = "";
    return;
  }
  closeFloatingPopovers({ exceptId: "search-live-popover" });
  searchLivePopover.classList.remove("hidden");
  searchInput?.setAttribute("aria-expanded", "true");
  searchLivePopover.innerHTML = `<div class="atv-search-popover-head">${
    isLoading
      ? t("Поиск по каталогу, персонам и источникам...", "Searching catalog, people & sources...")
      : t("Быстрый переход (стрелки и Enter)", "Quick jump (Arrow keys and Enter)")
  }</div>`;

  const topPersons = (personsList || []).slice(0, 3);
  const maxItems = topPersons.length > 0 ? Math.max(4, 7 - topPersons.length) : 6;
  const topHits = (itemsList || []).slice(0, maxItems);
  const hasMatchRows = topPersons.length + topHits.length > 0;
  liveSearchHitsState = [
    ...topPersons.map((p) => ({ _hitKind: "person", data: p })),
    ...topHits.map((it) => ({ _hitKind: "item", data: it })),
    { _hitKind: "show_all", query: qClean },
  ];
  if (liveSearchActiveIdx >= liveSearchHitsState.length) {
    liveSearchActiveIdx = -1;
  }
  if (!hasMatchRows && !isLoading) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "atv-search-empty-hit";
    emptyDiv.textContent = t(
      "Совпадений не найдено — нажмите Enter для полного поиска",
      "No matches found — press Enter for full search"
    );
    searchLivePopover.appendChild(emptyDiv);
  } else {
    let rowCursor = 0;
    topPersons.forEach((p) => {
      const idx = rowCursor++;
      const isAct = idx === liveSearchActiveIdx;
      const pName = p.name || p.orig_name || "";
      const pSub =
        p.orig_name && p.orig_name.toLowerCase() !== pName.toLowerCase()
          ? `${p.role || t("Персона", "Person")} · ${p.orig_name}`
          : p.role || t("Персона", "Person");
      const photoSrc =
        p.photo_endpoint ||
        (p.photo ? `/api/person-photo?name=${encodeURIComponent(pName)}&url=${encodeURIComponent(p.photo)}` : `/api/person-photo?name=${encodeURIComponent(pName)}`);
      const row = document.createElement("div");
      row.id = `live-search-opt-${idx}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", isAct ? "true" : "false");
      row.className = `atv-search-hit atv-search-person-hit${isAct ? " active-hit" : ""}`;
      row.innerHTML = `
        <img class="atv-search-hit-avatar" src="${escapeAttr(photoSrc)}" alt="${escapeAttr(pName)}" decoding="async" referrerpolicy="no-referrer" />
        <div class="atv-search-hit-info">
          <div class="atv-search-hit-title">${escapeHtml(pName)}</div>
          <div class="atv-search-hit-sub">${escapeHtml(pSub)}</div>
        </div>
        <div class="atv-search-hit-actions">
          <span class="atv-search-person-tag">${escapeHtml(t("Фильмография", "Filmography"))}</span>
        </div>
      `;
      const avImg = row.querySelector("img");
      if (avImg) {
        avImg.onerror = () => {
          avImg.onerror = null;
          avImg.src = buildFallbackAvatarSvg(pName);
        };
      }
      row.onclick = () => {
        saveRecentSearchQuery(qClean);
        closeLiveSearchPopover();
        openPersonModal(p);
      };
      searchLivePopover.appendChild(row);
    });

    const kinOn = isServiceEnabled("kinorium");
    topHits.forEach((hit) => {
      const idx = rowCursor++;
      const isAct = idx === liveSearchActiveIdx;
      const kRat = kinOn
        ? hit.kinorium?.kinorium_rating || hit.ratings?.kinorium || hit.ratings?.imdb || ""
        : hit.ratings?.imdb || hit.kinorium?.kinorium_rating || "";
      const ratPartHtml = kRat
        ? ` · <span class="atv-meta-rating">${iconSvg("star", 10)}<span>${escapeHtml(kRat)}</span></span>`
        : "";
      const tLabel = hit.media_type === "series" ? t("Сериал", "Series") : t("Фильм", "Movie");
      const hitTitle = displayTitle(hit);
      const secTitle = secondaryTitle(hit);
      const hitPoster = displayPoster(hit);
      const row = document.createElement("div");
      row.id = `live-search-opt-${idx}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", isAct ? "true" : "false");
      row.className = `atv-search-hit${isAct ? " active-hit" : ""}`;
      row.innerHTML = `
        <img class="atv-search-hit-poster" src="${escapeAttr(hitPoster)}" alt="${escapeAttr(hitTitle)}" decoding="async" referrerpolicy="no-referrer" />
        <div class="atv-search-hit-info">
          <div class="atv-search-hit-title">${escapeHtml(hitTitle)}</div>
          <div class="atv-search-hit-sub">${escapeHtml(hit.year || "")} · ${tLabel}${ratPartHtml}${
        secTitle ? " · " + escapeHtml(secTitle) : ""
      }</div>
        </div>
        <div class="atv-search-hit-actions">
          <button type="button" class="atv-search-hit-play" title="${escapeAttr(t("Смотреть сразу", "Watch now"))}" aria-label="${escapeAttr(t("Смотреть сразу", "Watch now"))}">${iconSvg("play", 12)}</button>
        </div>
      `;
      attachSmartPosterFallback(row.querySelector("img"), hitTitle, hit.year, hit.poster || hitPoster);
      const playBtn = row.querySelector(".atv-search-hit-play");
      if (playBtn) {
        playBtn.onclick = (ev) => {
          ev.stopPropagation();
          saveRecentSearchQuery(qClean);
          closeLiveSearchPopover();
          const info = resolveSeriesEpisodeInfo(hit);
          openPlayerModal(
            hit,
            getDefaultPlayableSourceTab(),
            info.season,
            info.episode,
            info.currentTime
          );
        };
      }
      row.onclick = () => {
        saveRecentSearchQuery(qClean);
        closeLiveSearchPopover();
        openQuickPeekModal(hit);
      };
      searchLivePopover.appendChild(row);
    });
  }

  const showAllIdx = liveSearchHitsState.length - 1;
  const isShowAllAct = showAllIdx === liveSearchActiveIdx;
  const showAllBtn = document.createElement("button");
  showAllBtn.type = "button";
  showAllBtn.id = `live-search-opt-${showAllIdx}`;
  showAllBtn.setAttribute("role", "option");
  showAllBtn.setAttribute("aria-selected", isShowAllAct ? "true" : "false");
  showAllBtn.className = `atv-search-all-btn${isShowAllAct ? " active-hit" : ""}`;
  showAllBtn.textContent = t(
    `Показать все результаты по запросу «${qClean}»`,
    `Show all results for "${qClean}"`
  );
  showAllBtn.onclick = () => {
    abortLiveSearchInFlight();
    saveRecentSearchQuery(qClean);
    closeLiveSearchPopover();
    resetCatalogFiltersForGlobalSearch();
    state.searchQuery = qClean;
    loadCatalog({ showLoading: true });
  };
  searchLivePopover.appendChild(showAllBtn);
  syncLiveSearchActiveHighlight();
  clampFloatingPopover(searchLivePopover, { isHeader: true });
};

export function resetCatalogFiltersForGlobalSearch() {
  state.kinoriumSection = "all";
  state.providerFilter = "all";
  state.mediaTypeFilter = "all";
  state.genreFilter = "all";
  state.yearFilter = "all";
  state.friendsFilter = false;
  state.selectedFriend = "all";
  document.querySelectorAll(".kin-sec-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.ksec === "all");
  });
  document.querySelectorAll(".atv-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.provider === "all");
  });
  document.querySelectorAll(".type-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.type === "all");
  });
  const gSel = document.getElementById("select-catalog-genre");
  if (gSel) gSel.value = "all";
  const ySel = document.getElementById("select-catalog-year");
  if (ySel) ySel.value = "all";
  const fSel = document.getElementById("select-friend-filter");
  if (fSel) fSel.value = "all";
  document.getElementById("btn-friends-filter")?.classList.remove("active");
  updateActiveFiltersBadge();
}

export function initCatalogLiveSearch() {
  const searchInput = document.getElementById("global-search");
  const clearSearchBtn = document.getElementById("btn-clear-search");
  const searchLivePopover = document.getElementById("search-live-popover");
  if (!searchInput) return;

  searchInput.addEventListener("input", (e) => {
    const val = e.target.value || "";
    liveSearchActiveIdx = -1;
    syncSearchClearButton();
    clearTimeout(debounceTimer);
    abortLiveSearchInFlight();
    const trimmed = val.trim();
    if (!trimmed) {
      if (document.activeElement === searchInput) {
        renderEmptySearchSuggestions();
      } else {
        closeLiveSearchPopover();
      }
      if (state.searchQuery) {
        state.searchQuery = "";
        loadCatalog();
      }
      return;
    }
    if (trimmed.length < 2) {
      closeLiveSearchPopover();
      if (state.searchQuery) {
        state.searchQuery = "";
        loadCatalog();
      }
      return;
    }
    const qLow = trimmed.toLowerCase();
    const localPersons = [];
    const seenLocalPerson = new Set();
    const localMatches = (state.catalogItems || []).filter((it) => {
      const titleHit =
        (it.title || "").toLowerCase().includes(qLow) ||
        (it.orig_title || "").toLowerCase().includes(qLow);
      let castHit = false;
      if (trimmed.length >= 3) {
        const dirs = isEn() && it.directors_en?.length ? it.directors_en : it.directors || [];
        const acts = isEn() && it.actors_en?.length ? it.actors_en : it.actors || [];
        dirs.forEach((d) => {
          if (String(d || "").toLowerCase().includes(qLow)) {
            castHit = true;
            const k = String(d).trim().toLowerCase();
            if (!seenLocalPerson.has(k)) {
              seenLocalPerson.add(k);
              localPersons.push({ name: d, role: t("Режиссёр", "Director"), hint_title: it.title || "" });
            }
          }
        });
        acts.forEach((a) => {
          if (String(a || "").toLowerCase().includes(qLow)) {
            castHit = true;
            const k = String(a).trim().toLowerCase();
            if (!seenLocalPerson.has(k)) {
              seenLocalPerson.add(k);
              localPersons.push({ name: a, role: t("Актёр", "Actor"), hint_title: it.title || "" });
            }
          }
        });
      }
      return titleHit || castHit;
    });
    renderLiveSearchHits(trimmed, localMatches, true, localPersons);

    debounceTimer = setTimeout(async () => {
      liveSearchReqId += 1;
      const rId = liveSearchReqId;
      const profSnap = state.activeProfile?.id || "main";
      abortLiveSearchInFlight();
      const ctrl = new AbortController();
      liveSearchAbortCtrl = ctrl;
      try {
        const res = await fetch(
          `/api/search?mode=suggest&q=${encodeURIComponent(trimmed)}&provider=all&media_type=all&kinorium_section=all&lang=${encodeURIComponent(state.appLang || "ru")}`,
          { signal: ctrl.signal }
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (rId !== liveSearchReqId || (state.activeProfile?.id || "main") !== profSnap) return;
        const mergedPersons =
          Array.isArray(data.persons) && data.persons.length > 0 ? data.persons : localPersons;
        renderLiveSearchHits(trimmed, data.items || localMatches, false, mergedPersons);
      } catch (err) {
        if (err && err.name === "AbortError") return;
        if (rId !== liveSearchReqId || (state.activeProfile?.id || "main") !== profSnap) return;
        renderLiveSearchHits(trimmed, localMatches, false, localPersons);
      }
    }, 200);
  });

  searchInput.addEventListener("keydown", (e) => {
    const popOpen = Boolean(searchLivePopover && !searchLivePopover.classList.contains("hidden"));
    if (popOpen && liveSearchHitsState.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      if (e.key === "ArrowDown") {
        liveSearchActiveIdx =
          liveSearchActiveIdx + 1 >= liveSearchHitsState.length ? -1 : liveSearchActiveIdx + 1;
      } else {
        liveSearchActiveIdx =
          liveSearchActiveIdx <= -1 ? liveSearchHitsState.length - 1 : liveSearchActiveIdx - 1;
      }
      syncLiveSearchActiveHighlight();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(debounceTimer);
      abortLiveSearchInFlight();
      if (popOpen && liveSearchActiveIdx >= 0 && liveSearchHitsState[liveSearchActiveIdx]) {
        const chosen = liveSearchHitsState[liveSearchActiveIdx];
        if (chosen._hitKind === "recent" || chosen._hitKind === "show_all") {
          runSubmittedRecentSearch(chosen.query);
          return;
        }
        if (chosen._hitKind === "random") {
          closeLiveSearchPopover();
          searchInput.blur();
          document.getElementById("btn-random-pick")?.click();
          return;
        }
        saveRecentSearchQuery(searchInput.value);
        closeLiveSearchPopover();
        if (chosen._hitKind === "person") {
          openPersonModal(chosen.data);
        } else {
          openQuickPeekModal(chosen.data);
        }
        return;
      }
      closeLiveSearchPopover();
      const nextQ = searchInput.value.trim();
      if (nextQ) {
        saveRecentSearchQuery(nextQ);
        resetCatalogFiltersForGlobalSearch();
      }
      state.searchQuery = nextQ;
      loadCatalog({ showLoading: true });
    }
  });

  searchInput.addEventListener("focus", () => {
    closeFloatingPopovers({ exceptId: "search-live-popover" });
    const trimmed = (searchInput.value || "").trim();
    if (!trimmed) {
      renderEmptySearchSuggestions();
      return;
    }
    if (trimmed.length >= 2 && searchLivePopover && searchLivePopover.innerHTML.trim()) {
      searchLivePopover.classList.remove("hidden");
      searchInput.setAttribute("aria-expanded", "true");
      syncLiveSearchActiveHighlight();
      clampFloatingPopover(searchLivePopover, { isHeader: true });
    }
  });

  if (clearSearchBtn) {
    clearSearchBtn.onclick = () => {
      clearTimeout(debounceTimer);
      liveSearchReqId += 1;
      abortLiveSearchInFlight();
      searchInput.value = "";
      const hadSearch = Boolean(state.searchQuery);
      state.searchQuery = "";
      syncSearchClearButton();
      renderEmptySearchSuggestions();
      searchInput.focus();
      if (hadSearch) {
        loadCatalog();
      }
    };
  }
}
