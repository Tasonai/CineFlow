import { state } from "./state.js?v=20261110v1";
import { displayTitle, isEn, t } from "./i18n.js?v=20261110v1";
import {
  bindStarsHoverRange,
  clampFloatingPopover,
  closeFloatingPopovers,
  showToast,
  withKinoriumActionLock,
} from "./utils.js?v=20261110v1";
import {
  isServiceEnabled,
  patchCatalogItemKinoriumInPlace,
  updateKinoriumSectionCounters,
} from "./catalog.js?v=20261110v1";
import { refreshOpenPersonModalUI } from "./modals.js?v=20261110v1";
import { pushDesktopRemoteStateNow } from "./remote.js?v=20261110v1";
import { isStageFullscreen } from "./player-ui-controls.js?v=20261110v1";
import { updateModalKinoriumHeader } from "./player-meta.js?v=20261110v1";
import {
  getEpisodeDisplayMeta,
  getEpisodeRatingEntry,
  populateSeasonEpisodeSelectors,
  resolveEffectiveSeasonsMap,
  resolveSeriesCompletedFlag,
  toggleCurrentEpisodeWatched,
  updateCurrentEpisodeBar,
} from "./player-seasons.js?v=20261110v1";

export function syncPostwatchOverlayMount() {
  const overlay = document.getElementById("kinorium-postwatch-overlay");
  if (!overlay) return;
  const fsActive = isStageFullscreen();
  const endgameStack = document.getElementById("video-endgame-stack");
  const headerWrap = document.getElementById("kinorium-rate-dropdown-wrap");
  const epBarWrap = document.getElementById("ep-rate-dropdown-wrap");
  const epBarVisible = Boolean(
    epBarWrap && !document.getElementById("current-episode-bar")?.classList.contains("hidden")
  );
  if (fsActive && endgameStack) {
    if (overlay.parentElement !== endgameStack) {
      endgameStack.insertBefore(overlay, endgameStack.firstChild);
    }
    overlay.classList.remove("is-header-popover", "is-epbar-popover");
  } else if (state.postwatchAnchor === "epbar" && epBarVisible) {
    if (overlay.parentElement !== epBarWrap) {
      epBarWrap.appendChild(overlay);
    }
    overlay.classList.remove("is-header-popover");
    overlay.classList.add("is-epbar-popover");
  } else if (headerWrap) {
    if (overlay.parentElement !== headerWrap) {
      headerWrap.appendChild(overlay);
    }
    overlay.classList.remove("is-epbar-popover");
    overlay.classList.add("is-header-popover");
  }
}

export function renderPostWatchRatingState() {
  if (!state.activeItem) return;
  const item = state.activeItem;
  const tagEl = document.getElementById("postwatch-tag");
  const titleEl = document.getElementById("postwatch-title");
  const commentEl = document.getElementById("postwatch-comment");
  const scopeSwitch = document.getElementById("postwatch-scope-switch");
  const epScopeBtn = document.getElementById("postwatch-scope-ep");
  const seriesScopeBtn = document.getElementById("postwatch-scope-series");
  const clearRateBtn = document.getElementById("postwatch-clear-rate-btn");
  const ks = item.kinorium || {};

  const syncStarsScoreUI = (scoreVal) => {
    const num = Number(scoreVal || 0);
    state.postwatchSelectedScore = num;
    document.querySelectorAll("#postwatch-stars button").forEach((btn) => {
      const sc = parseInt(btn.dataset.score, 10);
      const isSelected = num > 0 && sc === num;
      btn.classList.toggle("active-star", isSelected);
      btn.classList.toggle("in-score-range", num > 0 && sc < num);
      btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
      btn.setAttribute("aria-label", t(`Оценка ${sc} из 10`, `Rate ${sc} out of 10`));
    });
    if (clearRateBtn) {
      clearRateBtn.classList.toggle("hidden", !(num > 0));
    }
  };

  if (item.media_type === "series") {
    scopeSwitch?.classList.remove("hidden");
    const sNum = state.postwatchSeason || state.activeSeason || 1;
    const eNum = state.postwatchEpisode || state.activeEpisode || 1;
    if (epScopeBtn) {
      epScopeBtn.textContent = t(`Сезон ${sNum} · Серия ${eNum}`, `Season ${sNum} · Episode ${eNum}`);
      epScopeBtn.classList.toggle("active", state.postwatchScope === "episode");
    }
    if (seriesScopeBtn) {
      seriesScopeBtn.classList.toggle("active", state.postwatchScope === "series");
    }
    if (state.postwatchScope === "episode") {
      const epMeta = getEpisodeDisplayMeta(sNum, eNum);
      const epRating = getEpisodeRatingEntry(item, sNum, eNum);
      if (tagEl) {
        tagEl.textContent = t(
          `${displayTitle(item)} · Оценка конкретного эпизода`,
          `${displayTitle(item)} · Episode Rating`
        );
      }
      if (titleEl) {
        titleEl.textContent = epMeta.realTitle
          ? isEn()
            ? `Season ${sNum} · Episode ${eNum} — "${epMeta.realTitle}"`
            : `Сезон ${sNum} · Серия ${eNum} — «${epMeta.realTitle}»`
          : t(`Сезон ${sNum} · Серия ${eNum}`, `Season ${sNum} · Episode ${eNum}`);
      }
      if (commentEl) {
        commentEl.placeholder = t(
          "Комментарий к серии (необязательно)",
          "Episode comment (optional)"
        );
        commentEl.value = epRating?.comment || "";
      }
      syncStarsScoreUI(epRating?.score || 0);
      return;
    }
    if (tagEl) {
      tagEl.textContent = t("Оценка всего сериала в Kinorium", "Rate entire series on Kinorium");
    }
    if (titleEl) {
      titleEl.textContent = displayTitle(item);
    }
    if (commentEl) {
      commentEl.placeholder = t("Комментарий (необязательно)", "Series comment (optional)");
      commentEl.value = ks.user_comment || ks.comment || "";
    }
    syncStarsScoreUI(ks.user_rating || 0);
    return;
  }

  scopeSwitch?.classList.add("hidden");
  if (tagEl) {
    tagEl.textContent = ks.watched
      ? t("Отмечено просмотренным в Kinorium", "Marked as watched on Kinorium")
      : t("Ваша оценка в Kinorium", "Your rating on Kinorium");
  }
  if (titleEl) {
    titleEl.textContent = displayTitle(item);
  }
  if (commentEl) {
    commentEl.placeholder = t("Комментарий (необязательно)", "Rating comment (optional)");
    commentEl.value = ks.user_comment || ks.comment || "";
  }
  syncStarsScoreUI(ks.user_rating || 0);
}

export function maybeAutoOpenCreditsRatingCard() {
  if (!state.activeItem || !isServiceEnabled("kinorium") || state.isMiniPlayer || state.isPipBackground) {
    return;
  }
  const item = state.activeItem;
  if (item.media_type === "series") {
    const sNum = state.activeSeason || 1;
    const eNum = state.activeEpisode || 1;
    const promptKey = `${item.id}:s${sNum}e${eNum}`;
    if (state.ratingPromptShownThisSession[promptKey]) return;
    const existingEpRating = getEpisodeRatingEntry(item, sNum, eNum);
    if (existingEpRating && Number(existingEpRating.score) > 0) return;
    state.ratingPromptShownThisSession[promptKey] = true;
    openPostWatchRatingOverlay("episode", sNum, eNum, false);
  } else {
    const promptKey = `${item.id}:movie`;
    if (state.ratingPromptShownThisSession[promptKey]) return;
    if (Number(item.kinorium?.user_rating) > 0) return;
    state.ratingPromptShownThisSession[promptKey] = true;
    openPostWatchRatingOverlay("movie", 1, 1, false);
  }
}

export function openPostWatchRatingOverlay(
  preferredScope = null,
  seasonNum = state.activeSeason,
  epNum = state.activeEpisode,
  isManual = true,
  anchor = "header"
) {
  if (!state.activeItem) return;
  const overlay = document.getElementById("kinorium-postwatch-overlay");
  if (!overlay) return;
  closeFloatingPopovers({ exceptId: "kinorium-postwatch-overlay" });
  state.postwatchAnchor = anchor || "header";
  syncPostwatchOverlayMount();
  state.postwatchManual = Boolean(isManual);
  if (state.activeItem.media_type === "series") {
    state.postwatchScope = preferredScope === "series" ? "series" : "episode";
    state.postwatchSeason = Number(seasonNum) || state.activeSeason || 1;
    state.postwatchEpisode = Number(epNum) || state.activeEpisode || 1;
  } else {
    state.postwatchScope = "movie";
  }
  renderPostWatchRatingState();
  document.getElementById("xray-pause-shelf")?.classList.add("hidden");
  overlay.classList.remove("hidden");
  document.getElementById("video-stage")?.classList.add("has-postwatch-open");
  clampFloatingPopover(overlay);
}

export function closePostWatchRatingOverlay() {
  const overlay = document.getElementById("kinorium-postwatch-overlay");
  if (overlay) {
    overlay.classList.add("hidden");
  }
  document.getElementById("video-stage")?.classList.remove("has-postwatch-open");
  state.postwatchManual = false;
  state.postwatchHovered = false;
}

export async function toggleActivePlayerWatched() {
  if (!state.activeItem) return;
  if (state.activeItem.media_type === "series") {
    await toggleCurrentEpisodeWatched();
    return;
  }
  const item = state.activeItem;
  const curWatched = Boolean(item.kinorium?.watched);
  try {
    const res = await fetch("/api/kinorium/watched", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
        watched: !curWatched,
        season: state.activeSeason,
        episode: state.activeEpisode,
      }),
    });
    const kStatus = await res.json();
    if (!res.ok || kStatus?.ok === false || kStatus?.error) {
      throw new Error(kStatus?.error || `HTTP ${res.status}`);
    }
    item.kinorium = kStatus;
    state.catalogDirty = true;
    if (kStatus.kinorium_counts) {
      state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
      updateKinoriumSectionCounters();
    }
    updateModalKinoriumHeader(kStatus);
    renderPostWatchRatingState();
    patchCatalogItemKinoriumInPlace(item, kStatus);
    pushDesktopRemoteStateNow();
    const kinSuffix = kStatus.remote_synced ? t(" в Kinorium", " on Kinorium") : "";
    showToast(
      kStatus.watched
        ? t(`Отмечено просмотренным${kinSuffix}`, `Marked as watched${kinSuffix}`)
        : t(`Отметка просмотра снята${kinSuffix}`, `Unmarked as watched${kinSuffix}`)
    );
  } catch (_) {
    showToast(t("Не удалось изменить статус просмотра", "Could not update watched status"));
  }
}

export async function rateActivePlayerTitle({
  scope = "auto",
  score = 0,
  clear = false,
  comment = "",
  season = null,
  episode = null,
} = {}) {
  if (!state.activeItem) return null;
  const item = state.activeItem;
  const isSeries = item.media_type === "series";
  const resolvedScope =
    scope === "episode" || scope === "series" || scope === "movie"
      ? scope
      : isSeries
      ? "episode"
      : "movie";
  const numScore = clear ? 0 : Math.max(0, Math.min(10, parseInt(score, 10) || 0));
  if (!clear && numScore <= 0) return null;

  const basePayload = {
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
  };

  try {
    if (isSeries && resolvedScope === "episode") {
      const sNum = Number(season) || Number(state.activeSeason) || 1;
      const eNum = Number(episode) || Number(state.activeEpisode) || 1;
      const epMeta = getEpisodeDisplayMeta(sNum, eNum);
      const effMap = resolveEffectiveSeasonsMap(item, state.seasonsMap);
      const sKeys = Object.keys(effMap || {})
        .map((k) => parseInt(k, 10))
        .filter((n) => !Number.isNaN(n));
      const totalSeasons = sKeys.length > 0 ? Math.max(...sKeys) : 0;
      const sEps = effMap?.[String(sNum)];
      const totalEpsInSeason = Array.isArray(sEps) && sEps.length > 0 ? Math.max(...sEps) : 0;
      const res = await fetch("/api/kinorium/rate-episode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...basePayload,
          season: sNum,
          episode: eNum,
          episode_title: epMeta.realTitle || "",
          total_seasons: totalSeasons,
          total_episodes_in_season: totalEpsInSeason,
          score: numScore,
          clear: Boolean(clear),
          comment: String(comment || ""),
        }),
      });
      const kStatus = await res.json();
      if (!res.ok || kStatus?.ok === false || kStatus?.error) {
        throw new Error(kStatus?.error || `HTTP ${res.status}`);
      }
      item.kinorium = kStatus;
      state.catalogDirty = true;
      patchCatalogItemKinoriumInPlace(item, kStatus);
      if (kStatus.kinorium_counts) {
        state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
        updateKinoriumSectionCounters();
      }
      if (state.activeItem && String(state.activeItem.id || "") === String(item.id || "")) {
        updateModalKinoriumHeader(kStatus);
        populateSeasonEpisodeSelectors(item, effMap);
        updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);
        renderPostWatchRatingState();
      }
      pushDesktopRemoteStateNow();
      const epKinSuffix = kStatus.remote_synced ? t(" в Kinorium", " on Kinorium") : "";
      if (clear) {
        showToast(
          t(
            `Оценка удалена · Сезон ${sNum}, Серия ${eNum}`,
            `Rating removed · Season ${sNum}, Episode ${eNum}`
          )
        );
      } else if (kStatus.auto_completed_series) {
        state.scrobbledThisSession = true;
        refreshOpenPersonModalUI();
        showToast(
          t(
            `Оценка (${numScore}/10) сохранена${epKinSuffix} · финал просмотрен, статус изменён на «Просмотрено»`,
            `Rating (${numScore}/10) saved${epKinSuffix} · series finale watched, marked as Watched`
          )
        );
      } else {
        showToast(
          t(
            `Оценка (${numScore}/10) сохранена${epKinSuffix} · Сезон ${sNum}, Серия ${eNum}`,
            `Rating (${numScore}/10) saved${epKinSuffix} · Season ${sNum}, Episode ${eNum}`
          )
        );
      }
      return kStatus;
    }

    const res = await fetch("/api/kinorium/rate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...basePayload,
        score: numScore,
        clear: Boolean(clear),
        comment: String(comment || ""),
      }),
    });
    const kStatus = await res.json();
    if (!res.ok || kStatus?.ok === false || kStatus?.error) {
      throw new Error(kStatus?.error || `HTTP ${res.status}`);
    }
    item.kinorium = kStatus;
    state.catalogDirty = true;
    if (kStatus.kinorium_counts) {
      state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
      updateKinoriumSectionCounters();
    }
    updateModalKinoriumHeader(kStatus);
    renderPostWatchRatingState();
    patchCatalogItemKinoriumInPlace(item, kStatus);
    pushDesktopRemoteStateNow();
    if (clear) {
      showToast(
        kStatus.remote_synced
          ? t("Оценка удалена в Kinorium", "Rating removed on Kinorium")
          : t("Локальная оценка удалена", "Local rating removed")
      );
    } else {
      showToast(
        kStatus.remote_synced
          ? t(
              `Оценка ${numScore}/10 синхронизирована с Kinorium`,
              `Rating ${numScore}/10 synced to Kinorium`
            )
          : t(`Оценка ${numScore}/10 сохранена локально`, `Rating ${numScore}/10 saved locally`)
      );
    }
    return kStatus;
  } catch (err) {
    window.logDebug?.("PlayerRating", err);
    showToast(t("Не удалось сохранить оценку", "Could not save rating"));
    return null;
  }
}

export function initPlayerStatusAndRatingBindings({ onClosePlayerModal } = {}) {
  const getItemMetaPayload = (it = state.activeItem) => ({
    id: it?.id,
    title: it?.title,
    orig_title: it?.orig_title,
    poster: it?.poster,
    backdrop: it?.backdrop,
    year: it?.year,
    media_type: it?.media_type,
    rezka_id: it?.rezka_id,
    rezka_url: it?.rezka_url,
    is_series_completed: resolveSeriesCompletedFlag(it),
  });

  const watchingBtn = document.getElementById("btn-toggle-watching");
  if (watchingBtn) {
    watchingBtn.onclick = () => {
      if (!state.activeItem) return;
      const itemRef = state.activeItem;
      const metaSnapshot = getItemMetaPayload(itemRef);
      document.getElementById("kinorium-status-popover")?.classList.add("hidden");
      withKinoriumActionLock(`pl-watching:${itemRef.id}`, watchingBtn, async () => {
        const res = await fetch("/api/kinorium/watching", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metaSnapshot),
        });
        const kStatus = await res.json();
        if (!res.ok || kStatus?.ok === false || kStatus?.error) {
          throw new Error(kStatus?.error || `HTTP ${res.status}`);
        }
        itemRef.kinorium = kStatus;
        if (state.activeItem === itemRef) updateModalKinoriumHeader(kStatus);
        patchCatalogItemKinoriumInPlace(itemRef, kStatus);
        showToast(
          kStatus.watching
            ? t(`«${displayTitle(itemRef)}» в разделе Смотрю`, `"${displayTitle(itemRef)}" added to Watching`)
            : t("Убрано из Смотрю", "Removed from Watching"),
          {
            undoText: t("Отменить", "Undo"),
            durationMs: 5000,
            onUndo: async () => {
              try {
                const uRes = await fetch("/api/kinorium/watching", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(metaSnapshot),
                });
                const uData = await uRes.json();
                if (uRes.ok && uData?.ok !== false && !uData?.error) {
                  itemRef.kinorium = uData;
                  if (state.activeItem === itemRef) updateModalKinoriumHeader(uData);
                  patchCatalogItemKinoriumInPlace(itemRef, uData);
                }
              } catch (err) { window.logDebug?.("PlayerRating", err); }
            },
          }
        );
      });
    };
  }

  const plWatchedBtn = document.getElementById("btn-toggle-watched");
  if (plWatchedBtn) {
    plWatchedBtn.onclick = () => {
      if (!state.activeItem) return;
      const itemRef = state.activeItem;
      const metaSnapshot = getItemMetaPayload(itemRef);
      document.getElementById("kinorium-status-popover")?.classList.add("hidden");
      withKinoriumActionLock(`pl-watched:${itemRef.id}`, plWatchedBtn, async () => {
        const curWatched = Boolean(itemRef.kinorium?.watched);
        const sSnap = state.activeSeason;
        const eSnap = state.activeEpisode;
        const res = await fetch("/api/kinorium/watched", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...metaSnapshot,
            watched: !curWatched,
            season: sSnap,
            episode: eSnap,
          }),
        });
        const kStatus = await res.json();
        if (!res.ok || kStatus?.ok === false || kStatus?.error) {
          throw new Error(kStatus?.error || `HTTP ${res.status}`);
        }
        itemRef.kinorium = kStatus;
        if (state.activeItem === itemRef) {
          updateModalKinoriumHeader(kStatus);
          if (itemRef.media_type === "series") {
            populateSeasonEpisodeSelectors(
              itemRef,
              resolveEffectiveSeasonsMap(itemRef, state.seasonsMap)
            );
          }
        }
        patchCatalogItemKinoriumInPlace(itemRef, kStatus);
        pushDesktopRemoteStateNow();
        showToast(
          kStatus.watched
            ? t(`«${displayTitle(itemRef)}» отмечено просмотренным`, `"${displayTitle(itemRef)}" marked as watched`)
            : t("Снята отметка просмотренного", "Unmarked as watched"),
          {
            undoText: t("Отменить", "Undo"),
            durationMs: 5000,
            onUndo: async () => {
              try {
                const uRes = await fetch("/api/kinorium/watched", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    ...metaSnapshot,
                    watched: curWatched,
                    season: sSnap,
                    episode: eSnap,
                  }),
                });
                const uData = await uRes.json();
                if (uRes.ok && uData?.ok !== false && !uData?.error) {
                  itemRef.kinorium = uData;
                  if (state.activeItem === itemRef) {
                    updateModalKinoriumHeader(uData);
                    if (itemRef.media_type === "series") {
                      populateSeasonEpisodeSelectors(
                        itemRef,
                        resolveEffectiveSeasonsMap(itemRef, state.seasonsMap)
                      );
                    }
                  }
                  patchCatalogItemKinoriumInPlace(itemRef, uData);
                  pushDesktopRemoteStateNow();
                }
              } catch (err) { window.logDebug?.("PlayerRating", err); }
            },
          }
        );
      });
    };
  }

  const postwatchOverlayEl = document.getElementById("kinorium-postwatch-overlay");
  if (postwatchOverlayEl) {
    postwatchOverlayEl.addEventListener("mouseenter", () => {
      state.postwatchHovered = true;
    });
    postwatchOverlayEl.addEventListener("mouseleave", () => {
      state.postwatchHovered = false;
    });
  }

  const openRateBtn = document.getElementById("btn-open-rate");
  if (openRateBtn) {
    openRateBtn.onclick = (e) => {
      e.stopPropagation();
      const scope = state.activeItem?.media_type === "series" ? "series" : "movie";
      if (
        postwatchOverlayEl &&
        !postwatchOverlayEl.classList.contains("hidden") &&
        state.postwatchAnchor === "header" &&
        state.postwatchScope === scope
      ) {
        closePostWatchRatingOverlay();
        return;
      }
      openPostWatchRatingOverlay(scope, state.activeSeason, state.activeEpisode, true, "header");
    };
  }
  const epWatchToggleBtn = document.getElementById("btn-toggle-current-ep");
  if (epWatchToggleBtn) {
    epWatchToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!state.activeItem) return;
      withKinoriumActionLock(
        `pl-ep-watch:${state.activeItem.id}:s${state.activeSeason}e${state.activeEpisode}`,
        epWatchToggleBtn,
        async () => {
          await toggleCurrentEpisodeWatched();
        }
      );
    });
  }
  document.getElementById("btn-rate-current-ep")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (
      postwatchOverlayEl &&
      !postwatchOverlayEl.classList.contains("hidden") &&
      state.postwatchAnchor === "epbar" &&
      state.postwatchScope === "episode"
    ) {
      closePostWatchRatingOverlay();
      return;
    }
    openPostWatchRatingOverlay("episode", state.activeSeason, state.activeEpisode, true, "epbar");
  });
  document.getElementById("postwatch-scope-ep")?.addEventListener("click", () => {
    state.postwatchScope = "episode";
    renderPostWatchRatingState();
  });
  document.getElementById("postwatch-scope-series")?.addEventListener("click", () => {
    state.postwatchScope = "series";
    renderPostWatchRatingState();
  });

  const plWatchlistBtn = document.getElementById("btn-toggle-watchlist");
  if (plWatchlistBtn) {
    plWatchlistBtn.onclick = () => {
      if (!state.activeItem) return;
      const itemRef = state.activeItem;
      const metaSnapshot = getItemMetaPayload(itemRef);
      document.getElementById("kinorium-status-popover")?.classList.add("hidden");
      withKinoriumActionLock(`pl-watchlist:${itemRef.id}`, plWatchlistBtn, async () => {
        const res = await fetch("/api/kinorium/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metaSnapshot),
        });
        const kStatus = await res.json();
        if (!res.ok || kStatus?.ok === false || kStatus?.error) {
          throw new Error(kStatus?.error || `HTTP ${res.status}`);
        }
        itemRef.kinorium = kStatus;
        if (state.activeItem === itemRef) {
          updateModalKinoriumHeader(kStatus);
          if (itemRef.media_type === "series") {
            populateSeasonEpisodeSelectors(
              itemRef,
              resolveEffectiveSeasonsMap(itemRef, state.seasonsMap)
            );
          }
        }
        patchCatalogItemKinoriumInPlace(itemRef, kStatus);
        pushDesktopRemoteStateNow();
        showToast(
          kStatus.in_watchlist
            ? t(`«${displayTitle(itemRef)}» в Буду смотреть`, `"${displayTitle(itemRef)}" added to Watchlist`)
            : t("Убрано из Буду смотреть", "Removed from Watchlist"),
          {
            undoText: t("Отменить", "Undo"),
            durationMs: 5000,
            onUndo: async () => {
              try {
                const uRes = await fetch("/api/kinorium/watchlist", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(metaSnapshot),
                });
                const uData = await uRes.json();
                if (uRes.ok && uData?.ok !== false && !uData?.error) {
                  itemRef.kinorium = uData;
                  if (state.activeItem === itemRef) {
                    updateModalKinoriumHeader(uData);
                  }
                  patchCatalogItemKinoriumInPlace(itemRef, uData);
                  pushDesktopRemoteStateNow();
                }
              } catch (err) { window.logDebug?.("PlayerRating", err); }
            },
          }
        );
      });
    };
  }

  const neverBtn = document.getElementById("btn-toggle-never");
  if (neverBtn) {
    neverBtn.onclick = () => {
      if (!state.activeItem) return;
      const itemRef = state.activeItem;
      const metaSnapshot = getItemMetaPayload(itemRef);
      document.getElementById("kinorium-status-popover")?.classList.add("hidden");
      withKinoriumActionLock(`pl-never:${itemRef.id}`, neverBtn, async () => {
        const res = await fetch("/api/kinorium/never", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metaSnapshot),
        });
        const kStatus = await res.json();
        if (!res.ok || kStatus?.ok === false || kStatus?.error) {
          throw new Error(kStatus?.error || `HTTP ${res.status}`);
        }
        itemRef.kinorium = kStatus;
        if (state.activeItem === itemRef) updateModalKinoriumHeader(kStatus);
        patchCatalogItemKinoriumInPlace(itemRef, kStatus);
        showToast(
          kStatus.not_watching
            ? t(`«${displayTitle(itemRef)}» в Не буду смотреть`, `"${displayTitle(itemRef)}" added to Won't watch`)
            : t("Убрано из Не буду смотреть", "Removed from Won't watch"),
          {
            undoText: t("Отменить", "Undo"),
            durationMs: 5000,
            onUndo: async () => {
              try {
                const uRes = await fetch("/api/kinorium/never", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(metaSnapshot),
                });
                const uData = await uRes.json();
                if (uRes.ok && uData?.ok !== false && !uData?.error) {
                  itemRef.kinorium = uData;
                  if (state.activeItem === itemRef) updateModalKinoriumHeader(uData);
                  patchCatalogItemKinoriumInPlace(itemRef, uData);
                }
              } catch (err) { window.logDebug?.("PlayerRating", err); }
            },
          }
        );
      });
    };
  }

  const postwatchStarsWrap = document.getElementById("postwatch-stars");
  const postwatchSaveBtn = document.getElementById("btn-save-postwatch");
  const postwatchCommentInp = document.getElementById("postwatch-comment");
  bindStarsHoverRange(postwatchStarsWrap);

  const submitPostWatchRating = (scoreVal, triggerCtrl, closeAfterSave = true) => {
    if (!state.activeItem) return;
    const itemRef = state.activeItem;
    const metaSnapshot = getItemMetaPayload(itemRef);
    const score = parseInt(scoreVal, 10) || 0;
    if (score <= 0) {
      showToast(t("Сначала выберите оценку от 1 до 10", "Choose a rating from 1 to 10 first"));
      return;
    }
    withKinoriumActionLock(`pl-rate:${itemRef.id}`, triggerCtrl, async () => {
      const comment = postwatchCommentInp ? postwatchCommentInp.value : "";
      const isEpisodeScope =
        itemRef.media_type === "series" && state.postwatchScope === "episode";

      if (isEpisodeScope) {
        const sNum = state.postwatchSeason || state.activeSeason || 1;
        const eNum = state.postwatchEpisode || state.activeEpisode || 1;
        const epMeta = getEpisodeDisplayMeta(sNum, eNum);
        const effMap = resolveEffectiveSeasonsMap(itemRef, state.seasonsMap);
        const sKeys = Object.keys(effMap || {})
          .map((k) => parseInt(k, 10))
          .filter((n) => !Number.isNaN(n));
        const totalSeasons = sKeys.length > 0 ? Math.max(...sKeys) : 0;
        const sEps = effMap?.[String(sNum)];
        const totalEpsInSeason = Array.isArray(sEps) && sEps.length > 0 ? Math.max(...sEps) : 0;
        const res = await fetch("/api/kinorium/rate-episode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...metaSnapshot,
            season: sNum,
            episode: eNum,
            episode_title: epMeta.realTitle || "",
            total_seasons: totalSeasons,
            total_episodes_in_season: totalEpsInSeason,
            is_series_completed: resolveSeriesCompletedFlag(itemRef),
            score: score,
            comment: comment,
          }),
        });
        const kStatus = await res.json();
        if (!res.ok || kStatus?.ok === false || kStatus?.error) {
          throw new Error(kStatus?.error || `HTTP ${res.status}`);
        }
        itemRef.kinorium = kStatus;
        state.catalogDirty = true;
        if (kStatus.kinorium_counts) {
          state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
          updateKinoriumSectionCounters();
        }
        if (state.activeItem === itemRef) {
          updateModalKinoriumHeader(kStatus);
          populateSeasonEpisodeSelectors(itemRef, effMap);
          updateCurrentEpisodeBar(itemRef, state.activeSeason, state.activeEpisode, false);
          renderPostWatchRatingState();
        }
        patchCatalogItemKinoriumInPlace(itemRef, kStatus);
        pushDesktopRemoteStateNow();
        if (closeAfterSave) {
          closePostWatchRatingOverlay();
        }
        const epKinSuffix = kStatus.remote_synced ? t(" в Kinorium", " on Kinorium") : "";
        if (kStatus.auto_completed_series) {
          state.scrobbledThisSession = true;
          refreshOpenPersonModalUI();
          showToast(
            t(
              `Оценка (${score}/10) сохранена${epKinSuffix} · финал просмотрен, статус изменён на «Просмотрено»`,
              `Rating (${score}/10) saved${epKinSuffix} · series finale watched, marked as Watched`
            )
          );
        } else {
          showToast(
            t(
              `Оценка (${score}/10) сохранена${epKinSuffix} · Сезон ${sNum}, Серия ${eNum}`,
              `Rating (${score}/10) saved${epKinSuffix} · Season ${sNum}, Episode ${eNum}`
            )
          );
        }
        return;
      }

      const res = await fetch("/api/kinorium/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...metaSnapshot,
          score: score,
          comment: comment,
        }),
      });
      const kStatus = await res.json();
      if (!res.ok || kStatus?.ok === false || kStatus?.error) {
        throw new Error(kStatus?.error || `HTTP ${res.status}`);
      }
      itemRef.kinorium = kStatus;
      if (kStatus.kinorium_counts) {
        state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
        updateKinoriumSectionCounters();
      }
      if (state.activeItem === itemRef) {
        updateModalKinoriumHeader(kStatus);
        renderPostWatchRatingState();
      }
      if (closeAfterSave) {
        closePostWatchRatingOverlay();
      }
      patchCatalogItemKinoriumInPlace(itemRef, kStatus);
      pushDesktopRemoteStateNow();
      showToast(
        kStatus.remote_synced
          ? t(`Оценка ${score}/10 синхронизирована с Kinorium`, `Rating ${score}/10 synced to Kinorium`)
          : t(`Оценка ${score}/10 сохранена локально`, `Rating ${score}/10 saved locally`)
      );
    });
  };

  document.querySelectorAll("#postwatch-stars button").forEach((btn) => {
    btn.onclick = () => {
      const score = parseInt(btn.dataset.score, 10) || 0;
      state.postwatchSelectedScore = score;
      document.querySelectorAll("#postwatch-stars button").forEach((b) => {
        const sc = parseInt(b.dataset.score, 10) || 0;
        b.classList.toggle("active-star", sc === score);
        b.classList.toggle("in-score-range", sc > 0 && sc < score);
      });
      const hasTypedComment = Boolean((postwatchCommentInp?.value || "").trim());
      submitPostWatchRating(score, postwatchStarsWrap || btn, hasTypedComment);
    };
  });

  if (postwatchSaveBtn) {
    postwatchSaveBtn.onclick = () => {
      submitPostWatchRating(state.postwatchSelectedScore, postwatchSaveBtn, true);
    };
  }
  if (postwatchCommentInp) {
    postwatchCommentInp.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") {
        e.stopPropagation();
      }
      if (e.key === "Enter") {
        e.preventDefault();
        submitPostWatchRating(state.postwatchSelectedScore, postwatchSaveBtn || postwatchCommentInp, true);
      }
    });
  }

  const postwatchClearBtn = document.getElementById("postwatch-clear-rate-btn");
  if (postwatchClearBtn) {
    postwatchClearBtn.onclick = () => {
      if (!state.activeItem) return;
      const itemRef = state.activeItem;
      const metaSnapshot = getItemMetaPayload(itemRef);
      withKinoriumActionLock(`pl-rate:${itemRef.id}`, postwatchClearBtn, async () => {
        const isEpisodeScope =
          itemRef.media_type === "series" && state.postwatchScope === "episode";
        if (isEpisodeScope) {
          const sNum = state.postwatchSeason || state.activeSeason || 1;
          const eNum = state.postwatchEpisode || state.activeEpisode || 1;
          const effMap = resolveEffectiveSeasonsMap(itemRef, state.seasonsMap);
          const res = await fetch("/api/kinorium/rate-episode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...metaSnapshot,
              season: sNum,
              episode: eNum,
              score: 0,
              clear: true,
            }),
          });
          const kStatus = await res.json();
          if (!res.ok || kStatus?.ok === false || kStatus?.error) {
            throw new Error(kStatus?.error || `HTTP ${res.status}`);
          }
          itemRef.kinorium = kStatus;
          state.catalogDirty = true;
          if (kStatus.kinorium_counts) {
            state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
            updateKinoriumSectionCounters();
          }
          if (state.activeItem === itemRef) {
            updateModalKinoriumHeader(kStatus);
            populateSeasonEpisodeSelectors(itemRef, effMap);
            updateCurrentEpisodeBar(itemRef, state.activeSeason, state.activeEpisode, false);
            renderPostWatchRatingState();
          }
          patchCatalogItemKinoriumInPlace(itemRef, kStatus);
          pushDesktopRemoteStateNow();
          showToast(
            t(
              `Оценка удалена · Сезон ${sNum}, Серия ${eNum}`,
              `Rating removed · Season ${sNum}, Episode ${eNum}`
            )
          );
          return;
        }
        const res = await fetch("/api/kinorium/rate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...metaSnapshot,
            score: 0,
            clear: true,
          }),
        });
        const kStatus = await res.json();
        if (!res.ok || kStatus?.ok === false || kStatus?.error) {
          throw new Error(kStatus?.error || `HTTP ${res.status}`);
        }
        itemRef.kinorium = kStatus;
        if (kStatus.kinorium_counts) {
          state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
          updateKinoriumSectionCounters();
        }
        if (state.activeItem === itemRef) {
          updateModalKinoriumHeader(kStatus);
          renderPostWatchRatingState();
        }
        patchCatalogItemKinoriumInPlace(itemRef, kStatus);
        pushDesktopRemoteStateNow();
        showToast(
          kStatus.remote_synced
            ? t("Оценка удалена в Kinorium", "Rating removed on Kinorium")
            : t("Локальная оценка удалена", "Local rating removed")
        );
      });
    };
  }

  const closePwBtn = document.getElementById("close-postwatch-btn");
  if (closePwBtn) {
    closePwBtn.onclick = () => {
      state.postwatchManual = false;
      state.postwatchHovered = false;
      document.getElementById("kinorium-postwatch-overlay")?.classList.add("hidden");
      document.getElementById("video-stage")?.classList.remove("has-postwatch-open");
    };
  }

  const closePlBtn = document.getElementById("close-player-modal");
  if (closePlBtn) {
    closePlBtn.onclick = () => {
      if (typeof onClosePlayerModal === "function") {
        onClosePlayerModal(false);
      }
    };
  }
  document.getElementById("player-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "player-modal" && !state.isMiniPlayer) {
      if (typeof onClosePlayerModal === "function") {
        onClosePlayerModal(false);
      }
    }
  });
}
