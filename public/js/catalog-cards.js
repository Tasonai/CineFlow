// Velarium Catalog Cards & Context Menu Subsystem
// Handles poster card rendering, poster image fallbacks, smart badges,
// live trailer hover previews, and the card action context menu.

import { state } from "./state.js?v=20261108v19";
import {
  displayPoster,
  displayTitle,
  formatCriticsRating,
  isEn,
  t,
} from "./i18n.js?v=20261108v19";
import {
  copyTextToClipboard,
  escapeAttr,
  escapeHtml,
  findOfflineDownloadForTitle,
  getSimilarReasonLabel,
  iconSvg,
  pluralRu,
  showToast,
} from "./utils.js?v=20261108v19";
import {
  openPlayerModal,
} from "./player.js?v=20261108v19";
import {
  openTvCastModal,
} from "./features.js?v=20261108v19";
import {
  openQuickPeekModal,
} from "./modals.js?v=20261108v19";
import {
  isServiceEnabled,
  resolveSeriesEpisodeInfo,
  resolvePreferredPlayTab,
  getFriendsAverageScore,
  patchCatalogItemKinoriumInPlace,
} from "./catalog-media-resolver.js?v=20261108v19";
import { stopHeroAmbientTeaser } from "./catalog-hero.js?v=20261108v19";

export function buildPosterBadgesHtml(item, precomputedEpInfo = null) {
  const offlineSaved = findOfflineDownloadForTitle(item);
  if (!isServiceEnabled("kinorium")) {
    return offlineSaved
      ? `<div class="atv-poster-badges"><div class="atv-status-badge st-offline" title="${escapeAttr(t("Доступно офлайн без интернета", "Saved for offline playback"))}">${iconSvg("download", 10)}<span>${t("Офлайн", "Offline")}</span></div></div>`
      : "";
  }
  const kStatus = item?.kinorium || {};
  const epInfo = precomputedEpInfo || resolveSeriesEpisodeInfo(item);
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
  } else if (item.media_type === "series" && epInfo.hasNewEpisode) {
    const epBadgeText = epInfo.episodeVerified && epInfo.episode > 0
      ? isEn()
        ? `New S${epInfo.season}E${epInfo.episode}`
        : `Новая ${epInfo.episode} серия`
      : t("Новая серия", "New Episode");
    const epTooltip = epInfo.episodeVerified
      ? t(
          `Вышла новая серия: сезон ${epInfo.season}, серия ${epInfo.episode}${seasonTooltipSuffix}`,
          `New episode available: Season ${epInfo.season}, Episode ${epInfo.episode}${seasonTooltipSuffix}`
        )
      : t(
          `Доступна новая непросмотренная серия${seasonTooltipSuffix}`,
          `New unwatched episode available${seasonTooltipSuffix}`
        );
    statusBadge = `<div class="atv-status-badge st-new-ep" title="${escapeAttr(epTooltip)}">${iconSvg("bolt", 10)}<span>${escapeHtml(epBadgeText)}</span></div>`;
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

  const offlineBadge = offlineSaved
    ? `<div class="atv-status-badge st-offline" title="${escapeAttr(t("Доступно офлайн без интернета", "Saved for offline playback"))}">${iconSvg("download", 10)}${
        statusBadge ? "" : `<span>${t("Офлайн", "Offline")}</span>`
      }</div>`
    : "";

  const scoreBadge = kStatus.user_rating
    ? `<div class="atv-user-score-badge" title="${t("Ваша оценка в Kinorium", "Your Kinorium rating")}">${iconSvg("star", 10)}<span>${kStatus.user_rating}</span></div>`
    : "";

  const leftBadges = statusBadge && offlineBadge
    ? `<div class="atv-poster-badges-left">${statusBadge}${offlineBadge}</div>`
    : statusBadge || offlineBadge;

  if (!leftBadges && !scoreBadge) return "";
  return `<div class="atv-poster-badges">${leftBadges}${scoreBadge}</div>`;
}

export function buildFallbackPosterSvg(title, year) {
  const rawTitle = String(title || "Velarium").trim();
  const safeTitle = rawTitle
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .slice(0, 24);
  const initials = rawTitle
    .split(/[\s:.\-–—]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("")
    .replace(/[^A-ZА-ЯЁ0-9]/gi, "") || "CF";
  const safeYear = String(year || "").replace(/[^0-9–-]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#282a32"/><stop offset="100%" stop-color="#15161b"/></linearGradient></defs><rect width="400" height="600" fill="url(#g)"/><circle cx="200" cy="215" r="78" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" stroke-width="3"/><text x="200" y="242" fill="#f5f5f7" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="76" font-weight="700" text-anchor="middle">${initials}</text><text x="200" y="362" fill="#e5e5ea" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="24" font-weight="600" text-anchor="middle">${safeTitle}</text><text x="200" y="402" fill="#8e8e93" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="18" text-anchor="middle">${safeYear}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function attachSmartPosterFallback(imgEl, title, year = "", altUrl = "") {
  if (!imgEl) return;
  if (title && typeof title === "object") {
    const itemObj = title;
    title = displayTitle(itemObj) || itemObj.title || itemObj.orig_title || "Velarium";
    year = year || itemObj.year || "";
    altUrl = altUrl || itemObj.poster || itemObj.poster_ru || itemObj.poster_en || "";
  }
  imgEl.referrerPolicy = "no-referrer";
  let fallbackSvg = null;
  const getFallbackSvg = () => {
    if (!fallbackSvg) {
      fallbackSvg = buildFallbackPosterSvg(title, year);
    }
    return fallbackSvg;
  };
  let tried = null;
  const initialSrc = imgEl.getAttribute("src") || "";
  const tryNext = (candidate) => {
    if (!candidate) return false;
    if (!tried) {
      tried = new Set();
      if (initialSrc) tried.add(initialSrc);
    }
    if (tried.has(candidate)) return false;
    tried.add(candidate);
    imgEl.src = candidate;
    return true;
  };
  if (!initialSrc) {
    if (!tryNext(altUrl)) {
      imgEl.src = getFallbackSvg();
    }
  }
  imgEl.onerror = () => {
    const cur = imgEl.src || "";
    if (!tried) {
      tried = new Set();
      if (initialSrc) tried.add(initialSrc);
    }
    if (cur) tried.add(cur);
    const candidates = [];
    if (cur.includes("ru-images.kinorium.com/movie/600/")) {
      candidates.push(cur.replace("ru-images.kinorium.com/movie/600/", "en-images.kinorium.com/movie/600/"));
      candidates.push(cur.replace("ru-images.kinorium.com/movie/600/", "ru-images.kinorium.com/movie/300/"));
      candidates.push(cur.replace("ru-images.kinorium.com/movie/600/", "en-images.kinorium.com/movie/300/"));
    } else if (cur.includes("en-images.kinorium.com/movie/600/")) {
      candidates.push(cur.replace("en-images.kinorium.com/movie/600/", "en-images.kinorium.com/movie/300/"));
      candidates.push(cur.replace("en-images.kinorium.com/movie/600/", "ru-images.kinorium.com/movie/600/"));
      candidates.push(cur.replace("en-images.kinorium.com/movie/600/", "ru-images.kinorium.com/movie/300/"));
    } else if (cur.includes("en-images.kinorium.com/movie/300/")) {
      candidates.push(cur.replace("en-images.kinorium.com/movie/300/", "ru-images.kinorium.com/movie/300/"));
      candidates.push(cur.replace("en-images.kinorium.com/movie/300/", "ru-images.kinorium.com/movie/600/"));
    } else if (cur.includes("/movie/600/")) {
      candidates.push(cur.replace("/movie/600/", "/movie/300/"));
    }
    if (altUrl) {
      candidates.push(altUrl);
      if (altUrl.includes("/movie/600/")) {
        candidates.push(altUrl.replace("/movie/600/", "/movie/300/"));
      }
    }
    for (const c of candidates) {
      if (tryNext(c)) return;
    }
    imgEl.onerror = null;
    imgEl.src = getFallbackSvg();
  };
}

let _activeContextMenuEl = null;
let _activeContextTriggerBtn = null;

export function closeCardContextMenu({ restoreFocus = false } = {}) {
  if (!_activeContextTriggerBtn && !_activeContextMenuEl) return;
  const prevTrigger = _activeContextTriggerBtn;
  _activeContextTriggerBtn = null;
  if (prevTrigger) {
    prevTrigger.setAttribute("aria-expanded", "false");
  }
  if (_activeContextMenuEl) {
    _activeContextMenuEl.classList.add("hidden");
    _activeContextMenuEl.innerHTML = "";
    _activeContextMenuEl = null;
  }
  if (restoreFocus && prevTrigger && typeof prevTrigger.focus === "function") {
    prevTrigger.focus({ preventScroll: true });
  }
}

export function openCardContextMenu(e, item, cardEl) {
  if (!item) return;
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (_activeContextTriggerBtn) {
    _activeContextTriggerBtn.setAttribute("aria-expanded", "false");
    _activeContextTriggerBtn = null;
  }

  let menu = document.getElementById("atv-card-context-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "atv-card-context-menu";
    menu.className = "atv-context-menu hidden";
    menu.setAttribute("role", "menu");
    menu.onkeydown = (ev) => {
      const items = Array.from(menu.querySelectorAll('.atv-context-menu-item[role="menuitem"]'));
      if (!items.length) return;
      const curIdx = items.indexOf(document.activeElement);
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        items[(curIdx + 1) % items.length]?.focus();
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        items[(curIdx - 1 + items.length) % items.length]?.focus();
      } else if (ev.key === "Home") {
        ev.preventDefault();
        items[0]?.focus();
      } else if (ev.key === "End") {
        ev.preventDefault();
        items[items.length - 1]?.focus();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        closeCardContextMenu({ restoreFocus: true });
      }
    };
    document.body.appendChild(menu);
  }

  const kStatus = item.kinorium || {};
  const inWatchlist = Boolean(kStatus.in_watchlist);
  const isWatched = Boolean(kStatus.watched);
  const cardTitle = displayTitle(item);
  const frCount =
    Number(item._franchiseCount) ||
    (Array.isArray(item._cachedFranchiseItems) ? item._cachedFranchiseItems.length : 0);
  const franchiseMenuHtml =
    frCount >= 2
      ? `<button type="button" role="menuitem" class="atv-context-menu-item" data-act="franchise">
          ${iconSvg("layers", 14)}<span>${escapeHtml(
            t(`Все части франшизы (${frCount})`, `Franchise Chronology (${frCount})`)
          )}</span>
        </button>`
      : "";

  menu.innerHTML = `
    <div class="atv-context-menu-header" title="${escapeAttr(cardTitle)}">${escapeHtml(cardTitle)}</div>
    <button type="button" role="menuitem" class="atv-context-menu-item" data-act="peek">
      ${iconSvg("info", 14)}<span>${t("Быстрый просмотр", "Quick Details")}</span>
    </button>
    ${franchiseMenuHtml}
    <button type="button" role="menuitem" class="atv-context-menu-item" data-act="trailer">
      ${iconSvg("film", 14)}<span>${t("Смотреть трейлер", "Watch Trailer")}</span>
    </button>
    <div class="atv-context-menu-divider" role="separator"></div>
    <button type="button" role="menuitem" class="atv-context-menu-item" data-act="watchlist">
      ${iconSvg(inWatchlist ? "check" : "star", 14)}<span>${inWatchlist ? t("В списке «Буду смотреть»", "In Watchlist") : t("Буду смотреть", "Add to Watchlist")}</span>
    </button>
    <button type="button" role="menuitem" class="atv-context-menu-item" data-act="watched">
      ${iconSvg(isWatched ? "check" : "eye", 14)}<span>${isWatched ? t("Просмотрено", "Watched") : t("Отметить просмотренным", "Mark as Watched")}</span>
    </button>
    <div class="atv-context-menu-divider" role="separator"></div>
    <button type="button" role="menuitem" class="atv-context-menu-item" data-act="tv">
      ${iconSvg("tv", 14)}<span>${t("Передать на ТВ", "Send to TV")}</span>
    </button>
    <button type="button" role="menuitem" class="atv-context-menu-item" data-act="share">
      ${iconSvg("share", 14)}<span>${t("Копировать ссылку", "Copy Link")}</span>
    </button>
  `;

  const menuWidth = 220;
  const menuHeight = 240;
  let posX = (e && e.clientX) || 0;
  let posY = (e && e.clientY) || 0;

  const moreBtn =
    (e?.target?.closest ? e.target.closest(".atv-poster-more-btn") : null) ||
    cardEl?.querySelector?.(".atv-poster-more-btn") ||
    null;
  if (moreBtn) {
    moreBtn.setAttribute("aria-expanded", "true");
    _activeContextTriggerBtn = moreBtn;
  }
  if (e?.target?.closest && e.target.closest(".atv-poster-more-btn")) {
    const rect = moreBtn.getBoundingClientRect();
    posX = rect.right - menuWidth;
    posY = rect.bottom + 6;
  } else if (!posX && !posY && cardEl) {
    const rect = cardEl.getBoundingClientRect();
    posX = rect.right - menuWidth - 8;
    posY = rect.top + 36;
  }

  const winW = window.innerWidth || document.documentElement.clientWidth || 1024;
  const winH = window.innerHeight || document.documentElement.clientHeight || 768;
  if (posX + menuWidth > winW - 12) posX = Math.max(12, winW - menuWidth - 12);
  if (posX < 12) posX = 12;
  if (posY + menuHeight > winH - 12) posY = Math.max(12, posY - menuHeight - 10);
  if (posY < 12) posY = 12;

  menu.style.left = `${Math.round(posX)}px`;
  menu.style.top = `${Math.round(posY)}px`;
  menu.classList.remove("hidden");
  _activeContextMenuEl = menu;
  if (!e || e.detail === 0 || (!e.clientX && !e.clientY)) {
    menu.querySelector('.atv-context-menu-item[role="menuitem"]')?.focus({ preventScroll: true });
  }

  menu.querySelectorAll(".atv-context-menu-item").forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      const act = btn.getAttribute("data-act");
      closeCardContextMenu();

      if (act === "peek") {
        openQuickPeekModal(item);
      } else if (act === "franchise") {
        openQuickPeekModal(item, { scrollToFranchise: true });
      } else if (act === "trailer") {
        const info = resolveSeriesEpisodeInfo(item);
        openPlayerModal(item, "trailer", info.season, info.episode, info.currentTime);
      } else if (act === "watchlist") {
        try {
          const payload = {
            id: item.id || "",
            kinorium_id: String(item.kinorium?.kinorium_id || item.kinorium_id || ""),
            rezka_id: String(item.rezka_id || ""),
            rezka_url: String(item.rezka_url || ""),
            title: item.title || "",
            orig_title: item.orig_title || "",
            year: item.year || "",
            media_type: item.media_type || "movie",
            in_watchlist: !inWatchlist,
          };
          const res = await fetch("/api/kinorium/watchlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const kRes = await res.json();
          if (!res.ok || kRes?.ok === false || kRes?.error) {
            throw new Error(kRes?.error || `HTTP ${res.status}`);
          }
          patchCatalogItemKinoriumInPlace(item, kRes);
          showToast(
            !inWatchlist
              ? t("Добавлено в список «Буду смотреть»", "Added to Watchlist")
              : t("Удалено из списка «Буду смотреть»", "Removed from Watchlist"),
            {
              undoText: t("Отменить", "Undo"),
              durationMs: 5000,
              onUndo: async () => {
                try {
                  const uRes = await fetch("/api/kinorium/watchlist", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...payload, in_watchlist: inWatchlist }),
                  });
                  const uData = await uRes.json();
                  if (uRes.ok && uData?.ok !== false && !uData?.error) {
                    patchCatalogItemKinoriumInPlace(item, uData);
                  }
                } catch (err) { window.logDebug?.("CatalogCards", err); }
              },
            }
          );
        } catch (err) {
          showToast(err?.message || t("Ошибка связи с Kinorium", "Kinorium connection error"));
        }
      } else if (act === "watched") {
        try {
          const payload = {
            id: item.id || "",
            kinorium_id: String(item.kinorium?.kinorium_id || item.kinorium_id || ""),
            rezka_id: String(item.rezka_id || ""),
            rezka_url: String(item.rezka_url || ""),
            title: item.title || "",
            orig_title: item.orig_title || "",
            year: item.year || "",
            media_type: item.media_type || "movie",
            watched: !isWatched,
          };
          const res = await fetch("/api/kinorium/watched", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const kRes = await res.json();
          if (!res.ok || kRes?.ok === false || kRes?.error) {
            throw new Error(kRes?.error || `HTTP ${res.status}`);
          }
          patchCatalogItemKinoriumInPlace(item, kRes);
          showToast(
            !isWatched
              ? t("Отмечено просмотренным", "Marked as watched")
              : t("Снята отметка просмотра", "Unmarked as watched"),
            {
              undoText: t("Отменить", "Undo"),
              durationMs: 5000,
              onUndo: async () => {
                try {
                  const uRes = await fetch("/api/kinorium/watched", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...payload, watched: isWatched }),
                  });
                  const uData = await uRes.json();
                  if (uRes.ok && uData?.ok !== false && !uData?.error) {
                    patchCatalogItemKinoriumInPlace(item, uData);
                  }
                } catch (err) { window.logDebug?.("CatalogCards", err); }
              },
            }
          );
        } catch (err) {
          showToast(err?.message || t("Ошибка связи с Kinorium", "Kinorium connection error"));
        }
      } else if (act === "tv") {
        openTvCastModal(null, "tv", item);
      } else if (act === "share") {
        const shareUrl = `${window.location.origin}/?id=${encodeURIComponent(item.id || "")}&title=${encodeURIComponent(cardTitle)}`;
        const copied = await copyTextToClipboard(shareUrl);
        if (copied) {
          showToast(t("Ссылка скопирована в буфер обмена", "Link copied to clipboard"));
        } else {
          showToast(t("Не удалось скопировать ссылку", "Could not copy link"));
        }
      }
    };
  });
}

let _scrollCloseCtxRaf = 0;
if (typeof window !== "undefined" && !window._velariumContextMenuGlobalBound) {
  window._velariumContextMenuGlobalBound = true;
  window.addEventListener("click", (e) => {
    if (!e.target.closest("#atv-card-context-menu") && !e.target.closest(".atv-poster-more-btn")) {
      closeCardContextMenu();
    }
  });
  window.addEventListener(
    "scroll",
    () => {
      if (_scrollCloseCtxRaf) return;
      _scrollCloseCtxRaf = requestAnimationFrame(() => {
        _scrollCloseCtxRaf = 0;
        closeCardContextMenu();
        if (window.scrollY > 350) {
          stopHeroAmbientTeaser();
        }
      });
    },
    { passive: true }
  );
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const ctxMenu = document.getElementById("atv-card-context-menu");
      if (ctxMenu && !ctxMenu.classList.contains("hidden")) {
        e.preventDefault();
        e.stopPropagation();
        closeCardContextMenu({ restoreFocus: true });
      }
    }
  });
}

export function createPosterCardElement(item) {
  const kinEnabled = isServiceEnabled("kinorium");
  const kStatus = item.kinorium || {};
  const criticsStr = formatCriticsRating(item);
  const mainRating = kinEnabled
    ? kStatus.kinorium_rating || item.ratings?.kinorium || item.ratings?.imdb || (criticsStr !== "—" ? criticsStr : "")
    : item.ratings?.imdb || kStatus.kinorium_rating || (criticsStr !== "—" ? criticsStr : "");
  const friendsAvg = kinEnabled && state.friendsFilter ? getFriendsAverageScore(item) : 0;
  const metaChunks = [];
  if (item.year) {
    metaChunks.push(`<span>${escapeHtml(item.year)}</span>`);
  }
  if (mainRating) {
    metaChunks.push(`<span class="atv-meta-rating">${iconSvg("star", 10)}<span>${escapeHtml(mainRating)}</span></span>`);
  }
  if (friendsAvg > 0) {
    metaChunks.push(`<span class="atv-meta-friend">${iconSvg("users", 10)}<span>${friendsAvg}</span></span>`);
  }
  const simReasonLabel = getSimilarReasonLabel(item);
  if (
    simReasonLabel &&
    simReasonLabel !== "Подборка Kinorium" &&
    simReasonLabel !== "Kinorium similar"
  ) {
    metaChunks.push(`<span class="atv-poster-sim-reason">${escapeHtml(simReasonLabel)}</span>`);
  }
  const epInfo = resolveSeriesEpisodeInfo(item);
  const badgesHtml = buildPosterBadgesHtml(item, epInfo);
  const hasNewEpBadge = badgesHtml.includes("st-new-ep");
  const showBottomSeriesProgress =
    item.media_type === "series" &&
    !kStatus.watched &&
    !kStatus.not_watching &&
    epInfo.hasSeasonProgress &&
    epInfo.totalSeasonEpisodes > 0 &&
    (epInfo.watchedInSeasonCount > 0 || kStatus.watching || epInfo.hasNewEpisode);
  const bottomEpCounterText = showBottomSeriesProgress
    ? `${isEn() ? `S${epInfo.season}` : `С${epInfo.season}`} · ${epInfo.watchedInSeasonCount}/${epInfo.totalSeasonEpisodes}`
    : "";

  if (item.media_type === "series" && epInfo.hasNewEpisode && epInfo.episode && !hasNewEpBadge && !bottomEpCounterText) {
    metaChunks.push(
      `<span class="atv-meta-new-ep">${escapeHtml(
        isEn()
          ? `Episode ${epInfo.episode} available`
          : `Вышла ${epInfo.episode} серия`
      )}</span>`
    );
  } else if (item.media_type === "series" && epInfo.isCompleted) {
    metaChunks.push(`<span class="atv-meta-ended">${escapeHtml(t("Завершён", "Ended"))}</span>`);
  }
  const counterTooltip = epInfo.hasNewEpisode && epInfo.episode
    ? t(
        `Сезон ${epInfo.season}: просмотрено ${epInfo.watchedInSeasonCount} из ${epInfo.totalSeasonEpisodes}. Вышла серия ${epInfo.episode}!`,
        `Season ${epInfo.season}: watched ${epInfo.watchedInSeasonCount} of ${epInfo.totalSeasonEpisodes}. Episode ${epInfo.episode} is ready!`
      )
    : epInfo.seasonProgressText || bottomEpCounterText;
  const posterBottomCounterHtml = bottomEpCounterText
    ? `<div class="atv-poster-ep-counter${epInfo.hasNewEpisode ? " has-new-ep" : ""}" title="${escapeAttr(counterTooltip)}">${escapeHtml(bottomEpCounterText)}</div>`
    : "";
  const posterSeasonBarHtml =
    item.media_type === "series" &&
    epInfo.hasSeasonProgress &&
    epInfo.seasonPct > 0 &&
    !kStatus.watched
      ? `<div class="atv-poster-season-bar" title="${escapeAttr(epInfo.seasonProgressText)} (${epInfo.seasonPct}%)"><div class="atv-poster-season-fill" style="width:${epInfo.seasonPct}%"></div></div>`
      : "";
  const frCount =
    Number(item._franchiseCount) ||
    (Array.isArray(item._cachedFranchiseItems) ? item._cachedFranchiseItems.length : 0);
  const franchiseBadgeLabel =
    frCount >= 2
      ? isEn()
        ? `${frCount} parts`
        : `${frCount} ${pluralRu(frCount, "часть", "части", "частей")}`
      : "";
  const posterFranchiseBadgeHtml =
    frCount >= 2 && !posterBottomCounterHtml
      ? `<button type="button" class="atv-poster-franchise-badge" title="${escapeAttr(
          t("Открыть хронологию всех частей франшизы", "Open franchise chronology")
        )}">${escapeHtml(franchiseBadgeLabel)}</button>`
      : "";

  const cardTitle = displayTitle(item);
  const posterSrc = displayPoster(item);
  const card = document.createElement("div");
  card.className = "atv-poster-item";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.innerHTML = `
    <div class="atv-poster-frame">
      <img src="${escapeAttr(posterSrc)}" alt="${escapeAttr(cardTitle)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
      ${badgesHtml}
      ${posterBottomCounterHtml}
      ${posterFranchiseBadgeHtml}
      ${posterSeasonBarHtml}
      <button
        type="button"
        class="atv-poster-more-btn"
        aria-haspopup="menu"
        aria-expanded="false"
        title="${t("Действия", "Actions")}"
        aria-label="${t("Меню действий", "Action menu")}"
      >
        ${iconSvg("moreHoriz", 14)}
      </button>
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
      <div class="atv-poster-meta">${metaChunks.slice(0, 3).join(" · ") || "&nbsp;"}</div>
    </div>
  `;
  const imgEl = card.querySelector("img");
  attachSmartPosterFallback(imgEl, cardTitle, item.year, item.poster);

  const moreBtn = card.querySelector(".atv-poster-more-btn");
  if (moreBtn) {
    moreBtn.onclick = (e) => {
      e.stopPropagation();
      openCardContextMenu(e, item, card);
    };
  }
  const frBadgeBtn = card.querySelector(".atv-poster-franchise-badge");
  if (frBadgeBtn) {
    frBadgeBtn.onclick = (e) => {
      e.stopPropagation();
      openQuickPeekModal(item, { scrollToFranchise: true });
    };
  }

  card.oncontextmenu = (e) => {
    openCardContextMenu(e, item, card);
  };

  const playCenterBtn = card.querySelector(".atv-poster-play-center");
  if (playCenterBtn) {
    playCenterBtn.onclick = (e) => {
      e.stopPropagation();
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

  card.onclick = () => {
    stopActiveCardHoverPreview();
    openQuickPeekModal(item);
  };
  card.onkeydown = (e) => {
    if (e.target === card && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      stopActiveCardHoverPreview();
      openQuickPeekModal(item);
    }
  };

  // Live Hover Preview Video in Poster Frames (600ms debounce, strictly muted, loop, singleton)
  card.addEventListener("pointerenter", () => {
    if (
      state.isPlayerOpen ||
      state.tvMode ||
      (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches)
    ) {
      return;
    }
    stopActiveCardHoverPreview();
    const hoverAbort = new AbortController();
    _activeHoverAbort = hoverAbort;
    hoverPreviewTimer = setTimeout(async () => {
      if (hoverAbort.signal.aborted || !card.isConnected || !card.matches(":hover")) return;
      const frameEl = card.querySelector(".atv-poster-frame");
      if (!frameEl || frameEl.querySelector(".atv-poster-preview-video")) return;

      let trailerUrl = item.trailer_url || (Array.isArray(item.trailers) && item.trailers[0]?.url) || "";
      if (!trailerUrl && item.id) {
        try {
          const res = await fetch(
            `/api/trailer?id=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title || "")}&year=${encodeURIComponent(item.year || 0)}&media_type=${encodeURIComponent(item.media_type || "movie")}`,
            { signal: hoverAbort.signal }
          );
          if (res.ok) {
            const data = await res.json();
            if (data.ok && (data.stream_url || data.trailer_url)) {
              trailerUrl = data.stream_url || data.trailer_url;
            }
          }
        } catch (err) { window.logDebug?.("CatalogCards", err); }
      }

      if (trailerUrl && !hoverAbort.signal.aborted && card.isConnected && card.matches(":hover") && !state.isPlayerOpen) {
        const previewVideoEl = document.createElement("video");
        previewVideoEl.className = "atv-poster-preview-video";
        previewVideoEl.muted = true;
        previewVideoEl.playsInline = true;
        previewVideoEl.loop = true;
        previewVideoEl.preload = "auto";
        previewVideoEl.src = trailerUrl;
        _activeHoverVideoEl = previewVideoEl;
        frameEl.appendChild(previewVideoEl);
        previewVideoEl
          .play()
          .then(() => {
            if (!hoverAbort.signal.aborted && _activeHoverVideoEl === previewVideoEl) {
              previewVideoEl.classList.add("is-visible");
            }
          })
          .catch(() => {});
      }
    }, 600);
  });

  card.addEventListener("pointerleave", stopActiveCardHoverPreview);
  card.addEventListener("pointercancel", stopActiveCardHoverPreview);

  return card;
}

let hoverPreviewTimer = null;
let _activeHoverAbort = null;
let _activeHoverVideoEl = null;

export function stopActiveCardHoverPreview() {
  if (hoverPreviewTimer) {
    clearTimeout(hoverPreviewTimer);
    hoverPreviewTimer = null;
  }
  if (_activeHoverAbort) {
    try {
      _activeHoverAbort.abort();
    } catch (_) {}
    _activeHoverAbort = null;
  }
  if (_activeHoverVideoEl) {
    try {
      _activeHoverVideoEl.pause();
      _activeHoverVideoEl.removeAttribute("src");
      _activeHoverVideoEl.load();
      _activeHoverVideoEl.remove();
    } catch (err) { window.logDebug?.("CatalogCards", err); }
    _activeHoverVideoEl = null;
  }
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
  const PAGE_SIZE = 12;
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageStateKey = `${gridEl.id}:${state.kinoriumSection}:${state.kinoriumSubType}:${state.mediaTypeFilter}:${state.providerFilter}:${state.genreFilter}:${state.yearFilter}:${state.collectionFilter || "all"}:${state.hideWatched}:${state.friendsFilter}:${state.selectedFriend}:${state.sortBy}:${state.searchQuery.trim()}`;
  let currentPage = Math.max(1, Math.min(totalPages, state.gridPages[pageStateKey] || 1));

  const pagerContainerId = `${gridEl.id}-pagination`;

  function renderPage(pageNum, scrollToTop = false) {
    stopActiveCardHoverPreview();
    currentPage = Math.max(1, Math.min(totalPages, pageNum));
    const gpKeys = Object.keys(state.gridPages || {});
    if (gpKeys.length > 60) {
      delete state.gridPages[gpKeys[0]];
    }
    state.gridPages[pageStateKey] = currentPage;

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const slice = items.slice(startIdx, startIdx + PAGE_SIZE);
    const sliceSig = slice
      .map((it) => {
        const ks = it?.kinorium || {};
        const hasOff = findOfflineDownloadForTitle(it) ? 1 : 0;
        return `${it?.id || it?.title || ""}:${ks.watched ? 1 : 0}:${ks.in_watchlist ? 1 : 0}:${ks.watching ? 1 : 0}:${ks.has_new_episode ? 1 : 0}:${ks.user_rating || 0}:${ks.next_season || 0}:${ks.next_episode || 0}:${hasOff}`;
      })
      .join("|");
    const gridRenderSig = `${pageStateKey}|p:${currentPage}/${totalPages}|n:${items.length}|l:${state.appLang || "ru"}|lv:${state.liveSeriesUpdatesVersion || 0}|${sliceSig}`;
    if (gridEl._gridRenderSig === gridRenderSig && gridEl.childElementCount > 0) {
      if (scrollToTop) {
        const sectionEl = gridEl.closest(".atv-section");
        if (sectionEl) {
          sectionEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
      return;
    }
    gridEl._gridRenderSig = gridRenderSig;
    gridEl.innerHTML = "";

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

let _pendingCardBatchRaf = 0;

export function cancelPendingCardBatch() {
  if (_pendingCardBatchRaf) {
    cancelAnimationFrame(_pendingCardBatchRaf);
    _pendingCardBatchRaf = 0;
  }
}

export function appendPosterCardsProgressive(containerEl, items, { chunkSize = 24, onDone } = {}) {
  cancelPendingCardBatch();
  stopActiveCardHoverPreview();
  if (!containerEl || !Array.isArray(items) || !items.length) {
    if (typeof onDone === "function") onDone();
    return;
  }

  let index = 0;
  function processChunk() {
    const end = Math.min(index + chunkSize, items.length);
    const frag = document.createDocumentFragment();
    for (let i = index; i < end; i++) {
      frag.appendChild(createPosterCardElement(items[i]));
    }
    containerEl.appendChild(frag);
    index = end;

    if (index < items.length) {
      _pendingCardBatchRaf = requestAnimationFrame(processChunk);
    } else {
      _pendingCardBatchRaf = 0;
      if (typeof onDone === "function") onDone();
    }
  }

  processChunk();
}

