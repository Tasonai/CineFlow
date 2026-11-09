// Velarium Catalog Shelves & Carousels Subsystem
// Manages "Continue Watching", "Curated Collections" (Friends' picks, In your taste,
// Short movies tonight, Top Kinorium/IMDb), and separated/unified catalog shelves.

import { state } from "./state.js?v=20261109v3";
import {
  displayBackdrop,
  displayPoster,
  displayTitle,
  formatRussianTypography,
  isEn,
  t,
  translateStudioName,
} from "./i18n.js?v=20261109v3";
import {
  attachHorizontalWheelScroll,
  escapeAttr,
  escapeHtml,
  formatTime,
  getEpisodeProgress,
  getLocalProgressEpoch,
  iconSvg,
  matchCatalogItemSafe,
  showToast,
  syncSearchInputHasQueryUI,
} from "./utils.js?v=20261109v3";
import {
  buildPersonPhotoCard,
  openPersonModal,
  openQuickPeekModal,
} from "./modals.js?v=20261109v3";
import {
  attachSmartPosterFallback,
  createPosterCardElement,
  renderPosterCardsInto,
} from "./catalog-cards.js?v=20261109v3";
import {
  filterCatalogItemsByGenreAndYear,
  sortCatalogItems,
} from "./catalog-filters.js?v=20261109v3";
import {
  formatRemainingTime,
  getFriendsAverageScore,
  isItemWatchedOrCaughtUp,
  isServiceEnabled,
  resolveSeriesEpisodeInfo,
} from "./catalog-media-resolver.js?v=20261109v3";
import { renderHero } from "./catalog-hero.js?v=20261109v3";
import { renderNotificationsBell, renderReleaseCalendarShelf } from "./catalog-notifications.js?v=20261109v3";
import {
  clearCatalogFrontendCache,
  loadCatalog,
  updateKinoriumSectionCounters,
} from "./catalog.js?v=20261109v3";
import { getOfflineCatalogItems } from "./features-downloads.js?v=20261109v3";

export function renderContinueWatching() {
  renderNotificationsBell();
  const section = document.getElementById("continue-watching-section");
  const grid = document.getElementById("continue-watching-grid");
  const headerWrap = section?.querySelector(".atv-section-header");
  const headingEl = headerWrap?.querySelector("h2");
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
      if (info.allReleasedEpisodesWatched) {
        return false;
      }
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
    grid._cwRenderSig = "";
    return;
  }
  if (headingEl) {
    headingEl.textContent =
      state.mediaTypeFilter === "movie"
        ? t("Продолжить просмотр фильмов", "Continue Watching Movies")
        : t("Продолжить просмотр", "Continue Watching");
  }
  if (headerWrap) {
    let restoreBtn = document.getElementById("btn-restore-cw-hidden");
    const dismissedCount = Number(state.kinoriumAccount?.cw_dismissed_count || 0);
    if (dismissedCount > 0) {
      if (!restoreBtn) {
        restoreBtn = document.createElement("button");
        restoreBtn.type = "button";
        restoreBtn.id = "btn-restore-cw-hidden";
        restoreBtn.className = "atv-btn-secondary atv-btn-xs atv-cw-restore-btn";
        headerWrap.appendChild(restoreBtn);
      }
      restoreBtn.textContent = t(
        `Вернуть скрытые (${dismissedCount})`,
        `Restore hidden (${dismissedCount})`
      );
      restoreBtn.onclick = async () => {
        restoreBtn.disabled = true;
        try {
          const res = await fetch("/api/kinorium/continue-watching/restore", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ restore_all: true }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data?.ok === false || data?.error) {
            restoreBtn.disabled = false;
            showToast(data?.error || t("Не удалось вернуть скрытые карточки", "Could not restore hidden items"));
            return;
          }
          if (state.kinoriumAccount && typeof data.cw_dismissed_count === "number") {
            state.kinoriumAccount.cw_dismissed_count = data.cw_dismissed_count;
          }
          if (data.kinorium_counts) {
            state.kinoriumCounts = data.kinorium_counts;
            updateKinoriumSectionCounters();
          }
          await loadCatalog();
          showToast(t("Скрытые карточки возвращены", "Hidden items restored"));
        } catch (_) {
          restoreBtn.disabled = false;
        }
      };
    } else if (restoreBtn) {
      restoreBtn.remove();
    }
  }
  section.classList.remove("hidden");
  const CW_INITIAL_LIMIT = 12;
  const renderedCw = state.cwExpanded ? visibleCw : visibleCw.slice(0, CW_INITIAL_LIMIT);
  const cwRenderSig = `${state.appLang || "ru"}|${state.mediaTypeFilter || "all"}|${state.cwExpanded ? 1 : 0}|${visibleCw.length}|${state.catalogIndexVersion || 0}|${state.liveSeriesUpdatesVersion || 0}|${getLocalProgressEpoch()}|${renderedCw.map((c) => `${c.id || c.title}:${Math.round((c.progress || 0) * 100)}:${c.current_time || 0}:${c.season || 0}:${c.episode || 0}:${c.is_new_episode ? 1 : 0}:${c.studio || ""}`).join(",")}`;
  if (grid._cwRenderSig === cwRenderSig && grid.children.length > 0) {
    return;
  }
  grid._cwRenderSig = cwRenderSig;
  grid.innerHTML = "";
  const cwFrag = document.createDocumentFragment();

  renderedCw.forEach((cw) => {
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
    const savedProg =
      getEpisodeProgress(cw, dispSeason, dispEp) ||
      (cw.media_type !== "series" ? getEpisodeProgress(cw, 1, 1) : null);
    const curSec = Number(info.currentTime || cw.current_time || savedProg?.current_time || 0);
    const durSec = Number(
      cw.duration ||
      savedProg?.duration ||
      (parseItemDurationMinutes(cw) > 0 ? parseItemDurationMinutes(cw) * 60 : 0) ||
      0
    );
    const remSec = (durSec > curSec && curSec > 0) ? (durSec - curSec) : 0;

    let timeOrStatus = "";
    if (info.hasNewEpisode && (!curSec || curSec < 5)) {
      timeOrStatus = cw.media_type === "series"
        ? (info.episodeVerified ? (isEn() ? `New · S${dispSeason}E${dispEp}` : `Новая серия · S${dispSeason}E${dispEp}`) : t("Новая серия", "New Episode"))
        : t("Готов к просмотру", "Ready to watch");
    } else if (remSec >= 45) {
      timeOrStatus = formatRemainingTime(remSec);
    } else if (curSec > 0) {
      timeOrStatus = formatTime(curSec);
    } else {
      timeOrStatus = t("Готов к просмотру", "Ready to watch");
    }

    const pct =
      rawPct > 0
        ? rawPct
        : (savedProg?.pct && savedProg.pct > 0)
        ? savedProg.pct
        : (durSec > 0 && curSec > 0)
        ? Math.min(100, Math.max(0, Math.round((curSec / durSec) * 100)))
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
    const cwImgSrc = displayBackdrop(cw);
    const removeTitle = t("Убрать из «Продолжить просмотр»", "Remove from Continue Watching");
    const card = document.createElement("div");
    card.className = "atv-upnext-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.innerHTML = `
      <img src="${escapeAttr(cwImgSrc)}" alt="${escapeAttr(cwTitle)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
      <div class="atv-upnext-shade"></div>
      ${newEpBadge}
      <button type="button" class="atv-upnext-remove" aria-label="${escapeAttr(removeTitle)}" title="${escapeAttr(removeTitle)}">${iconSvg("x", 11)}</button>
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
          const res = await fetch("/api/kinorium/continue-watching/remove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: cw.id, title: cw.title }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data?.ok === false || data?.error) {
            throw new Error(data?.error || `HTTP ${res.status}`);
          }
          clearCatalogFrontendCache();
          if (state.kinoriumAccount && typeof data.cw_dismissed_count === "number") {
            state.kinoriumAccount.cw_dismissed_count = data.cw_dismissed_count;
          } else if (state.kinoriumAccount) {
            state.kinoriumAccount.cw_dismissed_count = (state.kinoriumAccount.cw_dismissed_count || 0) + 1;
          }
          if (data.kinorium_counts) {
            state.kinoriumCounts = data.kinorium_counts;
            updateKinoriumSectionCounters();
          }
          state.continueWatching = (state.continueWatching || []).filter(
            (x) => x.id !== cw.id
          );
          renderContinueWatching();
          showToast(
            t(
              `Убрано из «Продолжить просмотр»: «${cwTitle}»`,
              `Removed from Continue Watching: "${cwTitle}"`
            ),
            {
              actionLabel: t("Отменить", "Undo"),
              durationMs: 8000,
              onAction: async () => {
                try {
                  const rRes = await fetch("/api/kinorium/continue-watching/restore", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: cw.id, title: cw.title }),
                  });
                  const rData = await rRes.json().catch(() => ({}));
                  if (!rRes.ok || rData?.ok === false || rData?.error) {
                    throw new Error(rData?.error || `HTTP ${rRes.status}`);
                  }
                  clearCatalogFrontendCache();
                  if (state.kinoriumAccount && typeof rData.cw_dismissed_count === "number") {
                    state.kinoriumAccount.cw_dismissed_count = rData.cw_dismissed_count;
                  }
                  if (rData.kinorium_counts) {
                    state.kinoriumCounts = rData.kinorium_counts;
                    updateKinoriumSectionCounters();
                  }
                  await loadCatalog();
                  showToast(t(`Возвращено: «${cwTitle}»`, `Restored: "${cwTitle}"`));
                } catch (_) {
                  showToast(t("Не удалось восстановить тайтл", "Failed to restore item"));
                }
              },
            }
          );
        } catch (err) {
          showToast(t("Не удалось убрать из списка", "Failed to remove item"));
        }
      };
    }
    const openUpNextItem = () => {
      const found = matchCatalogItemSafe(state.catalogItems, cw) || cw;
      openQuickPeekModal(found);
    };
    card.onclick = openUpNextItem;
    card.onkeydown = (e) => {
      if (e.target === card && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        openUpNextItem();
      }
    };
    cwFrag.appendChild(card);
  });

  if (!state.cwExpanded && visibleCw.length > CW_INITIAL_LIMIT) {
    const extraCount = visibleCw.length - CW_INITIAL_LIMIT;
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "atv-upnext-more-card";
    moreBtn.innerHTML = `
      <span class="atv-upnext-more-count">+${extraCount}</span>
      <span class="atv-upnext-more-label">${t("Показать все", "Show All")}</span>
    `;
    moreBtn.onclick = () => {
      state.cwExpanded = true;
      renderContinueWatching();
    };
    cwFrag.appendChild(moreBtn);
  }
  grid.appendChild(cwFrag);
}

export function parseItemDurationMinutes(item) {
  if (!item) return 0;
  if (typeof item._parsedDurationMins === "number") {
    return item._parsedDurationMins;
  }
  const direct = Number(item.duration_minutes || item.runtime || 0);
  if (direct > 0) {
    item._parsedDurationMins = direct;
    return direct;
  }
  const lbl = String(item.duration_label || item.duration || "").trim();
  if (!lbl) {
    item._parsedDurationMins = 0;
    return 0;
  }
  const hmMatch = lbl.match(/(\d+)\s*(?:ч|h|hr|ч\.)\s*(\d+)?/i);
  if (hmMatch) {
    const hrs = parseInt(hmMatch[1], 10) || 0;
    const mins = parseInt(hmMatch[2] || "0", 10) || 0;
    const total = hrs * 60 + mins;
    item._parsedDurationMins = total;
    return total;
  }
  const minMatch = lbl.match(/(\d{2,3})\s*(?:мин|min|m\b)/i);
  if (minMatch) {
    const total = parseInt(minMatch[1], 10) || 0;
    item._parsedDurationMins = total;
    return total;
  }
  item._parsedDurationMins = 0;
  return 0;
}

const _CURATED_MOOD_PRESETS = [
  {
    id: "all",
    icon: "sparkles",
    ru: "Все подборки",
    en: "All Collections",
    genres: null,
  },
  {
    id: "action",
    icon: "bolt",
    ru: "Драйв и экшен",
    en: "Action & Drive",
    genres: new Set(["боевик", "приключения", "криминал", "вестерн", "военный", "action", "adventure", "crime", "western"]),
  },
  {
    id: "mindbender",
    icon: "sliders",
    ru: "Интеллектуальный триллер",
    en: "Mind-Bending Thriller",
    genres: new Set(["триллер", "детектив", "драма", "ужасы", "нуар", "thriller", "mystery", "drama", "horror"]),
  },
  {
    id: "cozy",
    icon: "heart",
    ru: "Уютный вечер",
    en: "Cozy Evening",
    genres: new Set(["комедия", "мелодрама", "семейный", "мультфильм", "музыка", "comedy", "romance", "family", "animation", "music"]),
  },
  {
    id: "scifi",
    icon: "tv",
    ru: "Миры и фантастика",
    en: "Sci-Fi & Worlds",
    genres: new Set(["фантастика", "фэнтези", "аниме", "sci-fi", "science fiction", "fantasy", "anime"]),
  },
];

export function renderCuratedShelves(allItemsSorted = []) {
  const section = document.getElementById("curated-shelves-section");
  const stack = document.getElementById("curated-shelves-stack");
  const toggleBtn = document.getElementById("btn-toggle-curated-shelves");
  const toggleLbl = document.getElementById("lbl-toggle-curated-shelves");
  if (toggleLbl) {
    toggleLbl.textContent = t("Подборки", "Collections");
  }
  const isMainCatalog =
    state.kinoriumSection === "all" &&
    !state.searchQuery.trim() &&
    state.providerFilter === "all";
  if (toggleBtn) {
    toggleBtn.classList.toggle("active", state.showCuratedShelves !== false);
    toggleBtn.classList.toggle("hidden", !isMainCatalog);
  }
  if (!section || !stack) return;
  if (!isMainCatalog || state.showCuratedShelves === false || !Array.isArray(allItemsSorted) || allItemsSorted.length === 0) {
    section.classList.add("hidden");
    stack.innerHTML = "";
    stack._lastCuratedShelvesSig = "";
    stack._lastCuratedInputSig = "";
    return;
  }

  const activeMood = String(state.curatedMoodFilter || "all");
  const activeMoodObj = _CURATED_MOOD_PRESETS.find((m) => m.id === activeMood) || _CURATED_MOOD_PRESETS[0];

  const inputSig = `${allItemsSorted.length}|${allItemsSorted[0]?.id || ""}|${allItemsSorted[allItemsSorted.length - 1]?.id || ""}|${state.catalogIndexVersion || 0}|${state.liveSeriesUpdatesVersion || 0}|${state.mediaTypeFilter || "all"}|${state.appLang || "ru"}|${state.activeProfile?.id || "main"}|${activeMood}`;
  if (stack._lastCuratedInputSig === inputSig && stack.children.length > 0) {
    section.classList.remove("hidden");
    return;
  }

  const _getNormGenres = (it) => {
    if (!it || typeof it !== "object") return [];
    if (Array.isArray(it._normGenres)) return it._normGenres;
    const raw = Array.isArray(it.genres) ? it.genres : [];
    it._normGenres = raw.map((g) => String(g || "").trim().toLowerCase()).filter(Boolean);
    return it._normGenres;
  };

  const baseUnwatchedPool = allItemsSorted.filter((it) => {
    if (!it || isItemWatchedOrCaughtUp(it)) return false;
    if (state.mediaTypeFilter === "movie" && it.media_type !== "movie") return false;
    if (state.mediaTypeFilter === "series" && it.media_type !== "series") return false;
    return true;
  });

  const unwatchedPool = activeMoodObj.genres
    ? baseUnwatchedPool.filter((it) => _getNormGenres(it).some((g) => activeMoodObj.genres.has(g)))
    : baseUnwatchedPool;

  if (baseUnwatchedPool.length === 0) {
    section.classList.add("hidden");
    stack.innerHTML = "";
    stack._lastCuratedShelvesSig = "";
    stack._lastCuratedInputSig = "";
    return;
  }

  const scoreMemo = new WeakMap();
  const getBestScore = (it) => {
    if (!it || typeof it !== "object") return 0;
    const cached = scoreMemo.get(it);
    if (cached !== undefined) return cached;
    const k = parseFloat(it?.kinorium?.kinorium_rating || it?.ratings?.kinorium || 0) || 0;
    const im = parseFloat(it?.ratings?.imdb || 0) || 0;
    const val = Math.max(k, im);
    scoreMemo.set(it, val);
    return val;
  };

  const shelves = [];

  if (activeMoodObj.genres && unwatchedPool.length >= 2) {
    const moodSorted = [...unwatchedPool]
      .sort((a, b) => getBestScore(b) - getBestScore(a))
      .slice(0, 14);
    shelves.push({
      id: `curated-mood-${activeMoodObj.id}`,
      title: t(`Под настроение: ${activeMoodObj.ru}`, `Mood Pick: ${activeMoodObj.en}`),
      sub: t("Лучшие непросмотренные тайтлы выбранного настроения", "Top unwatched titles matching your mood"),
      items: moodSorted,
    });
  }

  // 1. Высоко оценили друзья
  if (isServiceEnabled("kinorium")) {
    const friendsScored = [];
    for (let i = 0; i < unwatchedPool.length; i++) {
      const it = unwatchedPool[i];
      const avg = getFriendsAverageScore(it);
      const hasHighFriend = (it.kinorium?.friends_ratings || []).some((fr) => parseFloat(fr?.score) >= 8);
      if (avg >= 7.5 || hasHighFriend) {
        friendsScored.push({ it, avg });
      }
    }
    const friendsPicks = friendsScored
      .sort((a, b) => b.avg - a.avg || getBestScore(b.it) - getBestScore(a.it))
      .slice(0, 14)
      .map((entry) => entry.it);
    if (friendsPicks.length >= 3) {
      shelves.push({
        id: "curated-friends-top",
        title: t("Высоко оценили друзья", "Friends' Top Picks"),
        sub: t("Непросмотренные тайтлы с оценками друзей 8+", "Unwatched titles rated 8+ by friends"),
        items: friendsPicks,
      });
    }
  }

  // 2. В вашем вкусе + Потому что вам понравилось + Любимые режиссёры
  const catPool = state.catalogItems || [];
  const favVer = `${Number(state.catalogIndexVersion) || 0}|${catPool.length}`;
  let favGenreWeights = state._cachedFavGenreWeights;
  if (!(favGenreWeights instanceof Map) || state._cachedFavGenreWeightsVer !== favVer) {
    favGenreWeights = new Map();
    catPool.forEach((it) => {
      const uScore = Number(it?.kinorium?.user_rating || 0);
      const weight = uScore >= 8 ? 3 : it?.kinorium?.watching || it?.kinorium?.in_watchlist ? 1 : 0;
      if (weight > 0) {
        _getNormGenres(it).forEach((cleanG) => {
          if (cleanG && cleanG !== "фильм" && cleanG !== "сериал" && cleanG !== "movie" && cleanG !== "series") {
            favGenreWeights.set(cleanG, (favGenreWeights.get(cleanG) || 0) + weight);
          }
        });
      }
    });
    state._cachedFavGenreWeights = favGenreWeights;
    state._cachedFavGenreWeightsVer = favVer;
  }

  const highRatedAnchors = catPool
    .filter((it) => Number(it?.kinorium?.user_rating || 0) >= 8)
    .sort((a, b) => Number(b?.kinorium?.user_rating || 0) - Number(a?.kinorium?.user_rating || 0) || getBestScore(b) - getBestScore(a));

  if (highRatedAnchors.length > 0) {
    const anchor = highRatedAnchors[0];
    const anchorTitle = displayTitle(anchor) || anchor.title || "";
    const anchorGenres = new Set(
      _getNormGenres(anchor).filter((g) => g && g !== "фильм" && g !== "сериал" && g !== "movie" && g !== "series")
    );
    const anchorDirs = new Set((anchor.directors || []).map((d) => String(d || "").trim().toLowerCase()).filter(Boolean));
    if (anchorTitle && (anchorGenres.size > 0 || anchorDirs.size > 0)) {
      const becausePicks = unwatchedPool
        .filter((it) => it.id !== anchor.id)
        .map((it) => {
          const gOverlap = _getNormGenres(it).filter((g) => anchorGenres.has(g)).length;
          const dOverlap = (it.directors || []).some((d) => anchorDirs.has(String(d || "").trim().toLowerCase())) ? 1 : 0;
          return { it, sim: gOverlap * 3 + dOverlap * 5 + getBestScore(it) };
        })
        .filter((x) => x.sim >= 10.5 && getBestScore(x.it) >= 7.0)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 14)
        .map((x) => x.it);
      if (becausePicks.length >= 3) {
        shelves.push({
          id: "curated-because-liked",
          title: t(`Потому что вам понравилось «${anchorTitle}»`, `Because You Liked "${anchorTitle}"`),
          sub: t("Похожие по жанрам, атмосфере и создателям", "Similar genres, atmosphere, and creators"),
          items: becausePicks,
        });
      }
    }

    const favDirectorsMap = new Map();
    highRatedAnchors.forEach((it) => {
      (it.directors || []).forEach((d) => {
        const clean = String(d || "").trim();
        if (clean) favDirectorsMap.set(clean.toLowerCase(), clean);
      });
    });
    if (favDirectorsMap.size > 0) {
      const dirPicks = unwatchedPool
        .filter((it) => (it.directors || []).some((d) => favDirectorsMap.has(String(d || "").trim().toLowerCase())))
        .sort((a, b) => getBestScore(b) - getBestScore(a))
        .slice(0, 14);
      if (dirPicks.length >= 2) {
        const sampleDirs = Array.from(favDirectorsMap.values()).slice(0, 2).join(", ");
        shelves.push({
          id: "curated-favorite-directors",
          title: t("Любимые режиссёры и авторы", "Favorite Directors & Creators"),
          sub: sampleDirs
            ? t(`Новые работы: ${sampleDirs} и другие`, `Works by ${sampleDirs} and more`)
            : t("Тайтлы от режиссёров ваших любимых фильмов", "Titles from directors of your top-rated films"),
          items: dirPicks,
        });
      }
    }
  }

  if (favGenreWeights.size > 0) {
    const tastePicks = unwatchedPool
      .map((it) => {
        let gScore = 0;
        _getNormGenres(it).forEach((cleanG) => {
          const w = favGenreWeights.get(cleanG) || 0;
          gScore += w;
        });
        return { item: it, score: gScore * 2 + getBestScore(it) };
      })
      .filter((entry) => entry.score > 9 && getBestScore(entry.item) >= 7.0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item)
      .slice(0, 14);
    if (tastePicks.length >= 3) {
      shelves.push({
        id: "curated-taste",
        title: t("В вашем вкусе", "For Your Taste"),
        sub: t("По вашим любимым жанрам и высоким оценкам", "Based on your favorite genres and ratings"),
        items: tastePicks,
      });
    }
  }

  // 3. Короткие на вечер (до 100 минут)
  if (state.mediaTypeFilter !== "series") {
    const unwatchedMovies = unwatchedPool.filter((it) => it.media_type === "movie");
    let shortMovies = unwatchedMovies
      .filter((it) => {
        const mins = parseItemDurationMinutes(it);
        return mins >= 45 && mins <= 105 && getBestScore(it) >= 6.8;
      })
      .sort((a, b) => getBestScore(b) - getBestScore(a));
    if (shortMovies.length < 4) {
      const compactGenres = new Set(["комедия", "триллер", "мультфильм", "семейный", "детектив", "ужасы", "comedy", "thriller", "animation", "mystery"]);
      const fallbackShort = unwatchedMovies
        .filter((it) => {
          const mins = parseItemDurationMinutes(it);
          if (mins > 105) return false;
          const hasCompactG = _getNormGenres(it).some((g) => compactGenres.has(g));
          return hasCompactG && getBestScore(it) >= 7.2;
        })
        .sort((a, b) => getBestScore(b) - getBestScore(a));
      const seenIds = new Set(shortMovies.map((m) => m.id));
      fallbackShort.forEach((m) => {
        if (!seenIds.has(m.id)) {
          seenIds.add(m.id);
          shortMovies.push(m);
        }
      });
    }
    shortMovies = shortMovies.slice(0, 14);
    if (shortMovies.length >= 3) {
      shelves.push({
        id: "curated-short-evening",
        title: t("Короткие на вечер (до 100 минут)", "Short Movies Tonight (under 100 min)"),
        sub: t("Динамичные фильмы без затянутого хронометража", "Crisp movies for a single evening"),
        items: shortMovies,
      });
    }
  }

  // 4. Топ Кинориума и IMDb (8.0+)
  const topRated = unwatchedPool
    .filter((it) => getBestScore(it) >= 8.0)
    .sort((a, b) => getBestScore(b) - getBestScore(a))
    .slice(0, 14);
  if (topRated.length >= 3) {
    shelves.push({
      id: "curated-top-8",
      title: t("Топ Кинориума и IMDb (8.0+)", "Top Rated on Kinorium & IMDb (8.0+)"),
      sub: t("Признанные шедевры с рейтингом от 8.0", "Acclaimed titles rated 8.0 and above"),
      items: topRated,
    });
  }

  if (shelves.length === 0 && activeMood === "all") {
    section.classList.add("hidden");
    stack.innerHTML = "";
    stack._lastCuratedShelvesSig = "";
    return;
  }

  const curSig = `${activeMood}|${shelves.map((s) => `${s.id}:${s.items.map((it) => it.id || it.kinorium_id || it.title).join(",")}`).join("|")}`;
  stack._lastCuratedInputSig = inputSig;
  if (stack._lastCuratedShelvesSig === curSig && stack.children.length > 0) {
    section.classList.remove("hidden");
    return;
  }
  stack._lastCuratedShelvesSig = curSig;

  section.classList.remove("hidden");
  stack.innerHTML = "";
  const stackFrag = document.createDocumentFragment();

  const moodBar = document.createElement("div");
  moodBar.className = "atv-curated-mood-bar";
  moodBar.setAttribute("role", "tablist");
  moodBar.setAttribute("aria-label", t("Фильтр подборок по настроению", "Filter collections by mood"));
  _CURATED_MOOD_PRESETS.forEach((mp) => {
    const isAct = mp.id === activeMood;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.role = "tab";
    chip.className = `atv-curated-mood-chip${isAct ? " is-active" : ""}`;
    chip.setAttribute("data-mood-chip", mp.id);
    chip.setAttribute("aria-selected", isAct ? "true" : "false");
    chip.innerHTML = `${iconSvg(mp.icon, 13)}<span>${escapeHtml(t(mp.ru, mp.en))}</span>`;
    chip.onclick = () => {
      state.curatedMoodFilter = state.curatedMoodFilter === mp.id && mp.id !== "all" ? "all" : mp.id;
      stack._lastCuratedInputSig = "";
      stack._lastCuratedShelvesSig = "";
      renderCuratedShelves(allItemsSorted);
    };
    moodBar.appendChild(chip);
  });
  stackFrag.appendChild(moodBar);

  shelves.forEach((shelf) => {
    const block = document.createElement("div");
    block.className = "atv-curated-shelf";
    block.id = shelf.id;
    block.innerHTML = `
      <div class="atv-section-header">
        <div class="atv-section-title-group atv-shelf-title-wrap" title="${escapeAttr(shelf.sub || "")}">
          <h2>${escapeHtml(formatRussianTypography(shelf.title))}</h2>
          <span class="atv-section-count atv-shelf-count">${shelf.items.length}</span>
          <span class="atv-section-breakdown atv-shelf-breakdown hidden">${escapeHtml(formatRussianTypography(shelf.sub))}</span>
        </div>
      </div>
    `;
    const row = document.createElement("div");
    row.className = "atv-curated-row";
    const rowFrag = document.createDocumentFragment();
    shelf.items.forEach((item) => {
      rowFrag.appendChild(createPosterCardElement(item));
    });
    row.appendChild(rowFrag);
    block.appendChild(row);
    attachHorizontalWheelScroll(row, { showChevrons: true });
    stackFrag.appendChild(block);
  });
  stack.appendChild(stackFrag);
}

// Render separated Series ("Сериалы") and Movies ("Фильмы") shelves on Main Screen (12 per page each),
// or a unified 12-per-page paginated grid when viewing a Kinorium section
export function renderCatalogShelves({ skipHero = false } = {}) {
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
  let sourceItems = state.catalogItems;
  if (state.mediaTypeFilter === "offline") {
    sourceItems = getOfflineCatalogItems();
  }
  const baseItems = filterCatalogItemsByGenreAndYear(sourceItems);
  if (!skipHero) {
    renderHero(sourceItems === state.catalogItems ? baseItems : null);
  }
  const allItemsSorted = sortCatalogItems(baseItems);
  const seriesItems = allItemsSorted.filter((i) => i.media_type === "series");
  const movieItems = allItemsSorted.filter((i) => i.media_type === "movie");

  renderCuratedShelves(allItemsSorted);
  renderReleaseCalendarShelf();

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
  const topTypeOfflineBtn = document.getElementById("type-pill-offline");
  if (topTypeAllBtn) topTypeAllBtn.textContent = t("Все", "All");
  if (topTypeMovieBtn) topTypeMovieBtn.textContent = t("Фильмы", "Movies");
  if (topTypeSeriesBtn) topTypeSeriesBtn.textContent = t("Сериалы", "Series");
  if (topTypeOfflineBtn) topTypeOfflineBtn.textContent = t("Скачано", "Downloaded");

  const unifiedBreakdown = document.getElementById("unified-kinorium-breakdown");

  let hasVisibleItems = false;

  const searchPersonsSection = document.getElementById("search-persons-section");
  const searchPersonsRow = document.getElementById("search-persons-row");
  const searchPersonsHeading = document.getElementById("search-persons-heading");
  const searchPersonsCount = document.getElementById("search-persons-count");
  if (searchPersonsSection && searchPersonsRow) {
    const activeQ = state.searchQuery.trim();
    const matchedPersons = activeQ && state.kinoriumSection === "all" && Array.isArray(state.searchPersons)
      ? state.searchPersons
      : [];
    if (matchedPersons.length > 0) {
      if (searchPersonsHeading) {
        searchPersonsHeading.textContent = t("Персоны", "People");
      }
      if (searchPersonsCount) {
        searchPersonsCount.textContent = `${matchedPersons.length}`;
      }
      const personsSig = `${state.appLang || "ru"}|${matchedPersons.map((p) => `${p.name || ""}:${p.photo || ""}`).join(",")}`;
      if (searchPersonsRow._personsSig !== personsSig) {
        searchPersonsRow._personsSig = personsSig;
        searchPersonsRow.innerHTML = "";
        const personsFrag = document.createDocumentFragment();
        matchedPersons.forEach((p) => {
          personsFrag.appendChild(
            buildPersonPhotoCard(p, (personObj) => {
              openPersonModal(personObj);
            })
          );
        });
        searchPersonsRow.appendChild(personsFrag);
        attachHorizontalWheelScroll(searchPersonsRow);
      }
      searchPersonsSection.classList.remove("hidden");
      hasVisibleItems = true;
    } else {
      searchPersonsRow._personsSig = "";
      searchPersonsRow.innerHTML = "";
      searchPersonsSection.classList.add("hidden");
    }
  }

  if ((state.kinoriumSection !== "all" || state.mediaTypeFilter === "offline") && unifiedSection && unifiedGrid) {
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

    const secTitle =
      state.mediaTypeFilter === "offline"
        ? t("Скачано на устройство", "Downloaded on this device")
        : (ksecTitles[state.kinoriumSection] || t("Список Kinorium", "Kinorium List"));
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
      const similarFiltered = filterCatalogItemsByGenreAndYear(state.searchSimilarItems, {
        bypassWatchedOnSearch: false,
      }).filter(
        (sim) =>
          !visibleIds.has(sim.id) &&
          !visibleTitles.has((sim.title || "").trim().toLowerCase())
      );

      if (similarFiltered.length > 0) {
        if (searchSimilarHeading) {
          searchSimilarHeading.textContent = t("Похожие тайтлы", "Similar Titles");
        }
        if (searchSimilarSub) {
          const hasKinSimilar = similarFiltered.some((s) => s.similar_source === "kinorium");
          if (hasKinSimilar && allItemsSorted[0]) {
            searchSimilarSub.textContent = t(
              `подборка Kinorium к «${displayTitle(allItemsSorted[0])}»`,
              `Kinorium similar for "${displayTitle(allItemsSorted[0])}"`
            );
          } else if (allItemsSorted.length === 1) {
            searchSimilarSub.textContent = t(
              `по создателям и жанрам к «${displayTitle(allItemsSorted[0])}»`,
              `by creators & genres for "${displayTitle(allItemsSorted[0])}"`
            );
          } else {
            searchSimilarSub.textContent = t(
              "по общим создателям и жанрам",
              "by shared creators & genres"
            );
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
      emptyEl.className = "atv-catalog-empty-state";
      moviesSection.parentNode.appendChild(emptyEl);
    }
    emptyEl.classList.remove("hidden");
    const isOffline = state.isOfflineMode || (typeof navigator !== "undefined" && !navigator.onLine);
    const acc = state.kinoriumAccount || {};
    let disconnectedHint = "";
    if (isOffline || state.mediaTypeFilter === "offline") {
      disconnectedHint = `<div class="atv-catalog-empty-sub">${t(
        "Нет подключения к сети и пока нет скачанных фильмов или серий. Подключитесь к интернету для загрузки контента.",
        "No network connection and no downloaded media found. Connect to the internet to download movies and series."
      )}</div>`;
    } else if (state.kinoriumSection !== "all" && state.kinoriumSection !== "premieres" && !acc.connected) {
      disconnectedHint = `<div class="atv-catalog-empty-sub">${t(
        "Профиль Kinorium сейчас не подключён. Откройте Настройки в правом верхнем углу, чтобы ввести ваш ID или ссылку на профиль Kinorium.",
        "Kinorium profile is not connected. Open Settings in the top-right corner to enter your Kinorium ID or profile URL."
      )}</div>`;
    } else {
      disconnectedHint = `<div class="atv-catalog-empty-sub">${t(
        "Попробуйте изменить поисковый запрос или переключить раздел каталога",
        "Try adjusting your search query or switching catalog filters"
      )}</div>`;
    }
    const emptyTitle =
      isOffline || state.mediaTypeFilter === "offline"
        ? t("Офлайн-режим: нет скачанных файлов", "Offline Mode: No downloaded files")
        : t("По выбранным фильтрам ничего не найдено", "No titles match the active filters");
    emptyEl.innerHTML = `
      <div class="atv-catalog-empty-title">
        ${emptyTitle}
      </div>
      ${disconnectedHint}
      <button type="button" class="atv-btn-secondary atv-btn-sm" id="reset-catalog-filters-btn">
        ${t("Сбросить фильтры", "Reset Filters")}
      </button>
    `;
    const resetBtn = document.getElementById("reset-catalog-filters-btn");
    if (resetBtn) {
      resetBtn.onclick = () => {
        state.mediaTypeFilter = "all";
        state.kinoriumSubType = "all";
        document.querySelectorAll(".type-pill").forEach((b) => {
          const isAll = b.dataset.type === "all";
          b.classList.toggle("active", isAll);
          b.setAttribute("aria-selected", isAll ? "true" : "false");
        });
        if (state.searchQuery) {
          state.searchQuery = "";
          const sInp = document.getElementById("global-search");
          if (sInp) sInp.value = "";
          syncSearchInputHasQueryUI();
        }
        document.getElementById("btn-clear-catalog-filters")?.click();
        loadCatalog();
      };
    }
  } else if (emptyEl) {
    emptyEl.classList.add("hidden");
  }
}
