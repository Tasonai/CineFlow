import {
  NOTIF_DESKTOP_ALERTED_STORAGE_KEY,
  profileStorageKey,
  state,
} from "./state.js?v=20261105v1";
import {
  displayPoster,
  displayTitle,
  isEn,
  t,
  translateStudioName,
} from "./i18n.js?v=20261105v1";
import {
  attachHorizontalWheelScroll,
  escapeAttr,
  escapeHtml,
  formatTime,
  getSeenNotificationsSet,
  iconSvg,
  matchCatalogItemSafe,
  saveSeenNotificationsSet,
} from "./utils.js?v=20261105v1";
import { openQuickPeekModal } from "./modals.js?v=20261105v1";
import { openPlayerModal } from "./player.js?v=20261105v1";
import { openSettingsModal } from "./settings.js?v=20261105v1";
import { attachSmartPosterFallback } from "./catalog-cards.js?v=20261105v1";
import {
  isServiceEnabled,
  resolvePreferredPlayTab,
  resolveSeriesEpisodeInfo,
} from "./catalog-media-resolver.js?v=20261105v1";

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

function maybeSendDesktopEpisodeAlerts(notifs = []) {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  const newOnes = (Array.isArray(notifs) ? notifs : []).filter(
    (n) => n && n.is_new_episode && n.notifKey
  );
  const storageKey = profileStorageKey(NOTIF_DESKTOP_ALERTED_STORAGE_KEY);
  let alertedArr = null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) alertedArr = parsed;
    }
  } catch (err) { window.logDebug?.("CatalogNotifications", err); }

  // First boot for this profile: record baseline without spamming existing items
  if (alertedArr === null) {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify(newOnes.map((n) => String(n.notifKey)).slice(-200))
      );
    } catch (err) { window.logDebug?.("CatalogNotifications", err); }
    return;
  }

  const alertedSet = new Set(alertedArr.map(String));
  const freshToAlert = newOnes.filter((n) => !alertedSet.has(String(n.notifKey)));
  if (freshToAlert.length === 0) return;

  freshToAlert.forEach((n) => alertedSet.add(String(n.notifKey)));
  try {
    localStorage.setItem(storageKey, JSON.stringify(Array.from(alertedSet).slice(-200)));
  } catch (err) { window.logDebug?.("CatalogNotifications", err); }

  freshToAlert.slice(0, 3).forEach((n) => {
    const titleStr = displayTitle(n) || n.title || "CineFlow";
    const epStr = n.episode_verified
      ? t(`Сезон ${n.season}, Серия ${n.episode}`, `Season ${n.season}, Episode ${n.episode}`)
      : t("Вышла новая серия", "New episode available");
    const stStr = translateStudioName(n.studio || "HDRezka");
    const bodyStr = `${epStr} · ${stStr}`;

    const nativeHandler = window.webkit?.messageHandlers?.cineflowNative;
    if (nativeHandler && typeof nativeHandler.postMessage === "function") {
      try {
        nativeHandler.postMessage({
          action: "notifyEpisode",
          title: titleStr,
          body: bodyStr,
          itemId: String(n.id || ""),
          season: Number(n.season) || 1,
          episode: Number(n.episode) || 1,
        });
        return;
      } catch (err) { window.logDebug?.("CatalogNotifications", err); }
    }

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const webNotif = new Notification(titleStr, {
          body: bodyStr,
          icon: n.poster || "/favicon.svg",
          tag: `cineflow-${n.notifKey}`,
        });
        webNotif.onclick = () => {
          try {
            window.focus();
          } catch (err) { window.logDebug?.("CatalogNotifications", err); }
          const found = matchCatalogItemSafe(state.catalogItems, n) || n.rawItem;
          if (found) {
            openPlayerModal(
              found,
              resolvePreferredPlayTab(found, n.season, n.episode),
              n.season,
              n.episode,
              n.current_time || 0
            );
          }
        };
      } catch (err) { window.logDebug?.("CatalogNotifications", err); }
    }
  });
}

function _formatCalendarAirDate(isoStr, todayIso = "") {
  const clean = String(isoStr || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const refIso = /^\d{4}-\d{2}-\d{2}$/.test(todayIso)
    ? todayIso
    : new Date().toISOString().slice(0, 10);
  if (clean === refIso) return t("Сегодня", "Today");

  const [y, m, d] = clean.split("-").map((v) => parseInt(v, 10));
  const [ry, rm, rd] = refIso.split("-").map((v) => parseInt(v, 10));
  const targetUtc = Date.UTC(y, m - 1, d);
  const refUtc = Date.UTC(ry, rm - 1, rd);
  const diffDays = Math.round((targetUtc - refUtc) / 86400000);
  if (diffDays === 1) return t("Завтра", "Tomorrow");
  if (diffDays === -1) return t("Вчера", "Yesterday");

  const monthsRu = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
  ];
  const monthsEn = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const mIdx = Math.max(0, Math.min(11, m - 1));
  if (isEn()) {
    return y !== ry ? `${monthsEn[mIdx]} ${d}, ${y}` : `${monthsEn[mIdx]} ${d}`;
  }
  return y !== ry ? `${d} ${monthsRu[mIdx]} ${y}` : `${d} ${monthsRu[mIdx]}`;
}

export function switchNotificationsTab(tabKey = "updates") {
  const norm = tabKey === "calendar" ? "calendar" : "updates";
  state.notifTab = norm;
  const tabUpd = document.getElementById("notif-tab-updates");
  const tabCal = document.getElementById("notif-tab-calendar");
  const listUpd = document.getElementById("notifications-list");
  const listCal = document.getElementById("notifications-calendar-list");
  const markReadBtn = document.getElementById("btn-mark-notifs-read");

  tabUpd?.classList.toggle("active", norm === "updates");
  tabUpd?.setAttribute("aria-selected", norm === "updates" ? "true" : "false");
  if (tabUpd) tabUpd.tabIndex = norm === "updates" ? 0 : -1;
  tabCal?.classList.toggle("active", norm === "calendar");
  tabCal?.setAttribute("aria-selected", norm === "calendar" ? "true" : "false");
  if (tabCal) tabCal.tabIndex = norm === "calendar" ? 0 : -1;
  listUpd?.classList.toggle("hidden", norm !== "updates");
  listCal?.classList.toggle("hidden", norm !== "calendar");
  markReadBtn?.classList.toggle("hidden", norm === "calendar");

  if (norm === "calendar") {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        Notification.requestPermission().catch(() => {});
      } catch (err) { window.logDebug?.("CatalogNotifications", err); }
    }
    loadAndRenderReleaseCalendar(false);
  }
}

export async function loadAndRenderReleaseCalendar(forceRefresh = false) {
  const calEl = document.getElementById("notifications-calendar-list");
  if (!calEl) return;

  if (!forceRefresh && state.calendarData && Array.isArray(state.calendarData.upcoming)) {
    renderReleaseCalendarDOM(state.calendarData);
    return;
  }

  if (state.calendarLoading) return;
  state.calendarLoading = true;
  calEl.innerHTML = `<div class="atv-notif-empty">${escapeHtml(
    t("Загрузка расписания серий...", "Loading episode schedule...")
  )}</div>`;

  try {
    const qs = new URLSearchParams({
      lang: state.appLang || "ru",
      days_past: "14",
      days_ahead: "45",
      ...(forceRefresh ? { force: "1" } : {}),
    });
    const res = await fetch(`/api/calendar?${qs.toString()}`);
    const data = await res.json();
    if (res.ok && data?.ok) {
      state.calendarData = data;
      renderReleaseCalendarDOM(data);
    } else {
      calEl.innerHTML = `<div class="atv-notif-empty">${escapeHtml(
        t("Не удалось загрузить календарь релизов.", "Could not load release calendar.")
      )}</div>`;
    }
  } catch (_) {
    calEl.innerHTML = `<div class="atv-notif-empty">${escapeHtml(
      t("Не удалось загрузить календарь релизов.", "Could not load release calendar.")
    )}</div>`;
  } finally {
    state.calendarLoading = false;
  }
}

function renderReleaseCalendarDOM(calData) {
  const calEl = document.getElementById("notifications-calendar-list");
  if (!calEl) return;
  const upcoming = Array.isArray(calData?.upcoming) ? calData.upcoming : [];
  const recent = Array.isArray(calData?.recent) ? calData.recent : [];
  const todayIso = String(calData?.today || "");

  if (upcoming.length === 0 && recent.length === 0) {
    calEl.innerHTML = `<div class="atv-notif-empty">${escapeHtml(
      t(
        "В ближайшие недели нет запланированных серий для отслеживаемых сериалов.",
        "No upcoming or recent episodes found for your tracked series."
      )
    )}</div>`;
    return;
  }

  calEl.innerHTML = "";
  const appendSection = (headingText, eventsList, isUpcomingSection) => {
    if (!eventsList.length) return;
    const secHead = document.createElement("div");
    secHead.className = "atv-cal-section-head";
    secHead.textContent = headingText;
    calEl.appendChild(secHead);

    eventsList.slice(0, 24).forEach((ev) => {
      const row = document.createElement("div");
      row.className = `atv-notif-item atv-cal-row${ev.is_today ? " unread" : ""}`;
      row.tabIndex = 0;
      row.setAttribute("role", "button");

      const evTitle = isEn()
        ? ev.orig_title || ev.title || "Series"
        : ev.ru_title || ev.title || ev.orig_title || "Сериал";
      const epCode = `S${String(ev.season || 1).padStart(2, "0")}E${String(ev.episode || 1).padStart(2, "0")}`;
      const epLine = ev.episode_title ? `${epCode} · ${ev.episode_title}` : epCode;
      const dateLabel = _formatCalendarAirDate(ev.air_date, todayIso);

      let statusChip = "";
      if (ev.watched) {
        statusChip = `<span class="atv-cal-chip is-watched">${escapeHtml(t("Просмотрено", "Watched"))}</span>`;
      } else if (ev.dub_available) {
        statusChip = `<span class="atv-cal-chip is-dub">${escapeHtml(t("В озвучке", "Dubbed"))}</span>`;
      } else if (ev.is_released) {
        statusChip = `<span class="atv-cal-chip is-released">${escapeHtml(t("Вышла", "Aired"))}</span>`;
      } else if (isUpcomingSection) {
        statusChip = `<span class="atv-cal-chip">${escapeHtml(dateLabel)}</span>`;
      }

      row.innerHTML = `
        <img class="atv-notif-poster" src="${escapeAttr(ev.poster || "")}" alt="${escapeAttr(evTitle)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
        <div class="atv-notif-info">
          <div class="atv-notif-title">${escapeHtml(evTitle)}</div>
          <div class="atv-notif-ep">${escapeHtml(epLine)}</div>
          <div class="atv-notif-sub">${escapeHtml(dateLabel)}</div>
        </div>
        ${statusChip}
      `;
      const imgEl = row.querySelector("img");
      attachSmartPosterFallback(imgEl, evTitle, "", ev.poster);

      row.onclick = () => {
        document.getElementById("notifications-popover")?.classList.add("hidden");
        const synthCandidate = {
          id: ev.id || ev.imdb_id || "",
          kinorium_id: ev.kinorium_id || "",
          rezka_id: ev.rezka_id || "",
          rezka_url: ev.rezka_url || "",
          title: ev.ru_title || ev.title || "",
          orig_title: ev.orig_title || "",
          year: ev.year || "",
          media_type: "series",
          poster: ev.poster || "",
        };
        const target = matchCatalogItemSafe(state.catalogItems, synthCandidate) || synthCandidate;
        openQuickPeekModal(target);
      };
      row.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          row.click();
        }
      };
      calEl.appendChild(row);
    });
  };

  appendSection(t("Скоро выходят", "Upcoming Episodes"), upcoming, true);
  appendSection(t("Недавно вышедшие", "Recently Aired"), recent, false);
}

export async function renderReleaseCalendarShelf(forceRefresh = false) {
  const shelf = document.getElementById("release-calendar-shelf");
  const row = document.getElementById("release-calendar-row");
  const countEl = document.getElementById("release-calendar-count");
  if (!shelf || !row) return;

  if (
    state.searchQuery.trim() ||
    state.kinoriumSection !== "all" ||
    state.mediaTypeFilter === "offline" ||
    state.isOfflineMode
  ) {
    shelf.classList.add("hidden");
    return;
  }

  attachHorizontalWheelScroll(row);

  if (!state.calendarData || forceRefresh) {
    try {
      const qs = new URLSearchParams({
        lang: state.appLang || "ru",
        days_past: "7",
        days_ahead: "45",
        ...(forceRefresh ? { force: "1" } : {}),
      });
      const res = await fetch(`/api/calendar?${qs.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.ok) {
          state.calendarData = data;
        }
      }
    } catch (err) { window.logDebug?.("CatalogNotifications", err); }
  }

  const calData = state.calendarData;
  const upcoming = Array.isArray(calData?.upcoming) ? calData.upcoming : [];
  const todayIso = String(calData?.today || new Date().toISOString().slice(0, 10));

  const visibleEvents = upcoming.filter((ev) => ev && !ev.watched);

  if (visibleEvents.length === 0) {
    shelf.classList.add("hidden");
    return;
  }

  shelf.classList.remove("hidden");
  if (countEl) {
    countEl.textContent = String(visibleEvents.length);
  }

  row.innerHTML = "";
  visibleEvents.slice(0, 24).forEach((ev) => {
    const card = document.createElement("div");
    card.className = "atv-cal-shelf-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");

    const evTitle = isEn()
      ? ev.orig_title || ev.title || "Series"
      : ev.ru_title || ev.title || ev.orig_title || "Сериал";
    const sNum = Number(ev.season) || 1;
    const eNum = Number(ev.episode) || 1;
    const epCode = `S${String(sNum).padStart(2, "0")} · E${String(eNum).padStart(2, "0")}`;
    const dateLabel = _formatCalendarAirDate(ev.air_date, todayIso);

    const isToday = Boolean(ev.is_today || ev.air_date === todayIso);
    const badgeCls = isToday ? "atv-cal-badge is-today" : "atv-cal-badge";

    card.innerHTML = `
      <div class="atv-cal-poster-wrap">
        <img class="atv-cal-poster" src="${escapeAttr(ev.poster || "")}" alt="${escapeAttr(evTitle)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
        <div class="${badgeCls}">${escapeHtml(dateLabel)}</div>
      </div>
      <div class="atv-cal-meta">
        <div class="atv-cal-title" title="${escapeAttr(evTitle)}">${escapeHtml(evTitle)}</div>
        <div class="atv-cal-ep-code">${escapeHtml(epCode)}</div>
        ${ev.episode_title ? `<div class="atv-cal-ep-name" title="${escapeAttr(ev.episode_title)}">${escapeHtml(ev.episode_title)}</div>` : ""}
      </div>
    `;

    const imgEl = card.querySelector("img");
    attachSmartPosterFallback(imgEl, evTitle, "", ev.poster);

    card.onclick = () => {
      const synthCandidate = {
        id: ev.id || ev.imdb_id || "",
        kinorium_id: ev.kinorium_id || "",
        rezka_id: ev.rezka_id || "",
        rezka_url: ev.rezka_url || "",
        title: ev.ru_title || ev.title || "",
        orig_title: ev.orig_title || "",
        year: ev.year || "",
        media_type: "series",
        poster: ev.poster || "",
      };
      const target = matchCatalogItemSafe(state.catalogItems, synthCandidate) || synthCandidate;
      openQuickPeekModal(target);
    };

    card.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        card.click();
      }
    };

    row.appendChild(card);
  });
}

export function renderNotificationsBell() {
  const badgeEl = document.getElementById("notifications-badge");
  const listEl = document.getElementById("notifications-list");
  if (!badgeEl || !listEl) return;

  const notifs = collectNewEpisodeNotifications();
  maybeSendDesktopEpisodeAlerts(notifs);
  const seenSet = getSeenNotificationsSet();
  const upd = state.updaterStatus || state.systemStatus?.updater || null;
  const hasAppUpdate = Boolean(upd?.update_available && upd?.latest_version);
  const updNotifKey = hasAppUpdate ? `app_update::${upd.latest_version}` : "";
  const isUpdUnread = Boolean(hasAppUpdate && !seenSet.has(updNotifKey));
  const unreadCount = notifs.filter((n) => !seenSet.has(n.notifKey)).length + (isUpdUnread ? 1 : 0);

  badgeEl.textContent = String(unreadCount);
  badgeEl.classList.toggle("hidden", unreadCount === 0);

  listEl.innerHTML = "";
  if (hasAppUpdate) {
    const updRow = document.createElement("div");
    updRow.className = `atv-notif-item atv-notif-update-row${isUpdUnread ? " unread" : ""}`;
    updRow.tabIndex = 0;
    updRow.setAttribute("role", "button");
    const verLabel = escapeHtml(String(upd.latest_version));
    const readyLabel =
      upd.download_state === "ready"
        ? t("Установщик скачан · Нажмите для запуска", "Installer ready · Click to launch")
        : t("Нажмите, чтобы скачать и установить в 1 клик", "Click to download & install in 1 click");
    updRow.innerHTML = `
      <div class="atv-notif-info">
        <div class="atv-notif-title">${escapeHtml(
          t(`Доступно обновление CineFlow v${upd.latest_version}`, `CineFlow v${upd.latest_version} Update Available`)
        )}</div>
        <div class="atv-notif-ep atv-inline-icon-label">${iconSvg("bolt", 11)}<span>v${verLabel}</span></div>
        <div class="atv-notif-sub">${escapeHtml(readyLabel)}</div>
      </div>
      <span class="atv-notif-play atv-inline-icon-label">${iconSvg("download", 11)}<span>${escapeHtml(
      t("Обновить", "Update")
    )}</span></span>
    `;
    updRow.onclick = () => {
      const updatedSeen = getSeenNotificationsSet();
      updatedSeen.add(updNotifKey);
      saveSeenNotificationsSet(updatedSeen);
      renderNotificationsBell();
      document.getElementById("notifications-popover")?.classList.add("hidden");
      openSettingsModal("about");
    };
    updRow.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        updRow.click();
      }
    };
    listEl.appendChild(updRow);
  }
  if (notifs.length === 0 && !hasAppUpdate) {
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
    row.tabIndex = 0;
    row.setAttribute("role", "button");
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

    const baseItem = n.rawItem || n;
    const catMatch = matchCatalogItemSafe(state.catalogItems, baseItem);
    const enrichedNotif = catMatch
      ? {
          ...catMatch,
          ...baseItem,
          poster: baseItem.poster || catMatch.poster || catMatch.backdrop || "",
          poster_en: baseItem.poster_en || catMatch.poster_en || "",
          imdb_id: baseItem.imdb_id || catMatch.imdb_id || "",
          kinorium_id:
            baseItem.kinorium_id || catMatch.kinorium_id || catMatch.kinorium?.kinorium_id || "",
        }
      : baseItem;
    const notifPoster =
      displayPoster(enrichedNotif) || enrichedNotif.poster || enrichedNotif.backdrop || "";
    row.innerHTML = `
      <img class="atv-notif-poster" src="${escapeAttr(notifPoster)}" alt="${escapeAttr(nTitle)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
      <div class="atv-notif-info">
        <div class="atv-notif-title">${escapeHtml(nTitle)}</div>
        <div class="atv-notif-ep atv-inline-icon-label">${statusHtml}</div>
        <div class="atv-notif-sub">${escapeHtml(subText)}</div>
      </div>
      <span class="atv-notif-play atv-inline-icon-label">${iconSvg("play", 10)}<span>${t("Смотреть", "Watch")}</span></span>
    `;
    const imgEl = row.querySelector("img");
    attachSmartPosterFallback(
      imgEl,
      nTitle,
      catMatch?.year || baseItem.year || "",
      catMatch?.poster_en || catMatch?.poster || n.poster || ""
    );
    row.onclick = () => {
      const updatedSeen = getSeenNotificationsSet();
      updatedSeen.add(n.notifKey);
      saveSeenNotificationsSet(updatedSeen);
      renderNotificationsBell();
      document.getElementById("notifications-popover")?.classList.add("hidden");
      const found = matchCatalogItemSafe(state.catalogItems, n) || n.rawItem;
      openQuickPeekModal(found);
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
