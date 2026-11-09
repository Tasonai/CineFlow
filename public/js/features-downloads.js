import { state } from "./state.js?v=20261109v4";
import {
  displayTitle,
  hasCyrillicText,
  isEn,
  t,
  translateStudioName,
} from "./i18n.js?v=20261109v4";
import {
  closeCustomSelectMenu,
  escapeAttr,
  escapeHtml,
  findOfflineDownloadForTitle,
  formatTime,
  getEpisodeProgress,
  iconSvg,
  matchCatalogItemSafe,
  rememberModalTriggerFocus,
  restoreModalTriggerFocus,
  showToast,
  showVideoOsd,
  syncScrollTopButton,
} from "./utils.js?v=20261109v4";
import {
  getDefaultPlayableSourceTab,
  isEpisodeWatched,
  renderCatalogShelves,
  renderContinueWatching,
} from "./catalog.js?v=20261109v4";
import {
  closePlayerModal,
  getEffectivePlaybackTiming,
  getEpisodeDisplayMeta,
  openPlayerModal,
  switchSourceTab,
  syncPlayerOfflineControlsUI,
} from "./player.js?v=20261109v4";
import {
  ensureKidsPinVerifiedForAdminAction,
  exitBrowserFullscreenIfNeeded,
  formatBytesHuman,
} from "./features.js?v=20261109v4";

// ============================================================================
// 4. OFFLINE DOWNLOADS MANAGER ("Скачать в дорогу" — MP4 + Audio + RU/EN VTT)
// ============================================================================

export function syncDownloadsHeaderBadge() {
  const wrap = document.getElementById("downloads-header-wrap");
  const badge = document.getElementById("downloads-badge");
  const btn = document.getElementById("btn-open-downloads-modal");
  const menuCountEl = document.getElementById("prof-menu-dl-count");
  const activeCount = Number(state.downloadsActiveCount) || 0;
  const completedCount = (state.downloadsItems || []).filter((x) => x.status === "completed").length;
  const totalVisible = activeCount + completedCount;
  const isOffline = state.isOfflineMode || (typeof navigator !== "undefined" && navigator.onLine === false);
  const showHeaderBtn = activeCount > 0 || (isOffline && completedCount > 0);

  if (wrap) {
    wrap.classList.toggle("hidden", !showHeaderBtn);
  }
  if (menuCountEl) {
    if (totalVisible > 0) {
      menuCountEl.textContent = String(totalVisible);
      menuCountEl.classList.remove("hidden");
      menuCountEl.classList.toggle("is-active", activeCount > 0);
    } else {
      menuCountEl.classList.add("hidden");
      menuCountEl.classList.remove("is-active");
    }
  }

  const offlinePill = document.getElementById("type-pill-offline");
  if (offlinePill) {
    const showPill = completedCount > 0 || isOffline;
    offlinePill.classList.toggle("hidden", !showPill);
  }

  if (!badge) return;
  if (activeCount > 0) {
    badge.textContent = String(activeCount);
    badge.classList.remove("hidden", "is-done");
    badge.classList.add("is-active");
    btn?.classList.add("has-active-dl");
  } else if (isOffline && completedCount > 0) {
    badge.textContent = String(completedCount);
    badge.classList.remove("hidden", "is-active");
    badge.classList.add("is-done");
    btn?.classList.remove("has-active-dl");
  } else {
    badge.classList.add("hidden");
    badge.classList.remove("is-active", "is-done");
    btn?.classList.remove("has-active-dl");
  }
}

let _lastCompletedDlListRef = null;
let _lastCompletedDlCount = -1;
let _lastCompletedDlSigVal = "";

export function _completedDownloadsSignature(list) {
  if (!Array.isArray(list) || list.length === 0) return "";
  let completedCount = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i]?.status === "completed") completedCount += 1;
  }
  if (list === _lastCompletedDlListRef && completedCount === _lastCompletedDlCount) {
    return _lastCompletedDlSigVal;
  }
  const sig = list
    .filter((x) => x && x.status === "completed")
    .map((x) => String(x.download_id || ""))
    .sort()
    .join("|");
  _lastCompletedDlListRef = list;
  _lastCompletedDlCount = completedCount;
  _lastCompletedDlSigVal = sig;
  return sig;
}

export function getOfflineCatalogItems() {
  const list = Array.isArray(state.downloadsItems) ? state.downloadsItems : [];
  const completed = list.filter((it) => it && it.status === "completed");
  const grouped = [];
  const seriesMap = new Map();

  for (const it of completed) {
    if (it.media_type === "series") {
      const groupKey =
        String(it.item_id || "").trim() ||
        (it.kinorium_id ? `kin_${it.kinorium_id}` : "") ||
        (it.rezka_id ? `rezka_${it.rezka_id}` : "") ||
        String(it.title || "").trim().toLowerCase();

      let seriesItem = seriesMap.get(groupKey);
      if (!seriesItem) {
        seriesItem = {
          id: it.item_id || groupKey,
          kinorium_id: it.kinorium_id || "",
          rezka_id: it.rezka_id || "",
          title: it.title || "Velarium",
          orig_title: it.orig_title || "",
          year: it.year || "",
          media_type: "series",
          poster: it.poster || "",
          backdrop: it.backdrop || it.poster || "",
          genres: Array.isArray(it.genres) ? it.genres : [],
          age_rating: it.age_rating || "",
          ratings: it.ratings || {},
          kinorium: it.kinorium || {},
          seasons_map: {},
          is_offline: true,
          download_id: it.download_id,
          offline_count: 0,
        };
        seriesMap.set(groupKey, seriesItem);
        grouped.push(seriesItem);
      }
      const sNum = Math.max(1, Number(it.season) || 1);
      const eNum = Math.max(1, Number(it.episode) || 1);
      const sKey = String(sNum);
      if (!seriesItem.seasons_map[sKey]) {
        seriesItem.seasons_map[sKey] = [];
      }
      if (!seriesItem.seasons_map[sKey].includes(eNum)) {
        seriesItem.seasons_map[sKey].push(eNum);
        seriesItem.seasons_map[sKey].sort((a, b) => a - b);
      }
      seriesItem.offline_count += 1;
    } else {
      grouped.push({
        id: it.item_id || `dl_${it.download_id}`,
        kinorium_id: it.kinorium_id || "",
        rezka_id: it.rezka_id || "",
        title: it.title || "Velarium",
        orig_title: it.orig_title || "",
        year: it.year || "",
        media_type: "movie",
        poster: it.poster || "",
        backdrop: it.backdrop || it.poster || "",
        genres: Array.isArray(it.genres) ? it.genres : [],
        age_rating: it.age_rating || "",
        ratings: it.ratings || {},
        kinorium: it.kinorium || {},
        is_offline: true,
        download_id: it.download_id,
        offline_play_url: it.play_url || "",
      });
    }
  }

  return grouped;
}

export function setOfflineMode(isOffline) {
  state.isOfflineMode = Boolean(isOffline);
  const banner = document.getElementById("offline-status-banner");
  if (banner) {
    banner.classList.toggle("hidden", !state.isOfflineMode);
  }
  syncDownloadsHeaderBadge();
  if (state.isOfflineMode) {
    if (!Array.isArray(state.catalogItems) || state.catalogItems.length === 0) {
      state.catalogItems = getOfflineCatalogItems();
      renderCatalogShelves();
    }
  }
}

export function _syncOfflineSurfacesAfterDownloadsChange(prevCompletedSig) {
  syncPlayerOfflineControlsUI();
  const nextCompletedSig = _completedDownloadsSignature(state.downloadsItems);
  if (
    nextCompletedSig !== prevCompletedSig &&
    Array.isArray(state.catalogItems) &&
    state.catalogItems.length > 0 &&
    (!state.isPlayerOpen || state.isMiniPlayer || state.isPipBackground)
  ) {
    renderContinueWatching();
    renderCatalogShelves();
  }
}

export function syncDownloadsPrefsCheckboxes() {
  if (typeof document === "undefined") return;
  const prefs = state.downloadsPrefs || {};
  const cleanEl = document.getElementById("dl-pref-auto-cleanup");
  if (cleanEl) cleanEl.checked = Boolean(prefs.auto_cleanup_watched);
  const nextEl = document.getElementById("dl-pref-auto-next");
  if (nextEl) nextEl.checked = Boolean(prefs.auto_download_next);
}

export async function saveDownloadsPrefs(patch = {}) {
  let verifiedPin = "";
  if (state.activeProfile?.kids_mode && state.activeProfile?.has_kids_pin) {
    const entered = await ensureKidsPinVerifiedForAdminAction(
      t(
        "Введите родительский PIN-код для изменения правил офлайн-загрузок",
        "Enter parental PIN to update offline download preferences"
      )
    );
    if (!entered) {
      syncDownloadsPrefsCheckboxes();
      return;
    }
    verifiedPin = entered;
  }
  try {
    const res = await fetch("/api/downloads/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...patch,
        pin: verifiedPin,
        lang: state.appLang || "ru",
      }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      showToast(data.error || t("Не удалось сохранить настройки загрузок", "Could not save download settings"));
      syncDownloadsPrefsCheckboxes();
      return;
    }
    if (data.prefs) {
      state.downloadsPrefs = { ...state.downloadsPrefs, ...data.prefs };
    }
    syncDownloadsPrefsCheckboxes();
    showToast(t("Правила офлайн-загрузок сохранены", "Offline download rules saved"));
  } catch (_) {
    syncDownloadsPrefsCheckboxes();
  }
}

export async function sweepPendingDownloadCleanups() {
  try {
    const exclId =
      state.isPlayerOpen && (state.activeSourceTab === "offline" || state.isPlayingOfflineDownload)
        ? String(state.activeOfflineDownloadId || "")
        : "";
    const res = await fetch("/api/downloads/cleanup-pending", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exclude_download_id: exclId }),
    });
    const data = await res.json().catch(() => ({}));
    if (Array.isArray(data.deleted_ids) && data.deleted_ids.length > 0) {
      await refreshDownloadsState();
    }
  } catch (err) { window.logDebug?.("FeaturesDownloads", err); }
}

export async function enqueueBatchSeriesDownload(mode = "next3") {
  if (!state.isPlayerOpen || !state.activeItem || state.activeItem.media_type !== "series") {
    return;
  }
  const item = state.activeItem;
  const sNum = Math.max(1, Number(state.activeSeason) || 1);
  const curEp = Math.max(1, Number(state.activeEpisode) || 1);

  const rawSeasonList =
    (state.seasonsMap && (state.seasonsMap[String(sNum)] || state.seasonsMap[sNum])) ||
    (item.seasons_map && (item.seasons_map[String(sNum)] || item.seasons_map[sNum])) ||
    [];
  const sortedSeasonEps = Array.from(
    new Set(rawSeasonList.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n > 0))
  ).sort((a, b) => a - b);

  let targetEpisodes = [];
  if (mode === "season") {
    targetEpisodes = sortedSeasonEps.filter((ep) => ep >= curEp);
    if (!targetEpisodes.length) {
      targetEpisodes = [curEp];
    }
  } else if (mode === "unwatched") {
    const candidateEps = sortedSeasonEps.length ? sortedSeasonEps : [curEp];
    targetEpisodes = candidateEps.filter((ep) => !isEpisodeWatched(item, sNum, ep));
    if (!targetEpisodes.length) {
      showToast(
        t(
          "Все серии этого сезона уже отмечены просмотренными",
          "All episodes in this season are already marked as watched"
        )
      );
      return;
    }
  } else {
    targetEpisodes = sortedSeasonEps.filter((ep) => ep >= curEp).slice(0, 3);
    if (!targetEpisodes.length) {
      targetEpisodes = [curEp, curEp + 1, curEp + 2];
    }
  }

  const maxSeasonEp = sortedSeasonEps.length
    ? sortedSeasonEps[sortedSeasonEps.length - 1]
    : targetEpisodes[targetEpisodes.length - 1] || curEp;

  const epTitlesMap = {};
  targetEpisodes.forEach((epNo) => {
    const meta = getEpisodeDisplayMeta(sNum, epNo);
    if (meta?.realTitle) {
      epTitlesMap[String(epNo)] = meta.realTitle;
    }
  });

  const qualSel = document.getElementById("select-quality");
  const studioSel = document.getElementById("select-studio");
  const qualityLabel = (qualSel && qualSel.value) || "1080p";
  const isRezkaSource = state.activeSourceTab === "hdrezka";
  const translatorId =
    isRezkaSource && studioSel && studioSel.value ? String(studioSel.value) : String(state.activeStudioId || "");
  const studioNameForBatch = isRezkaSource ? state.activeStudioName || "HDRezka" : "HDRezka";

  try {
    const res = await fetch("/api/downloads/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id || "",
        kinorium_id: String(item.kinorium?.kinorium_id || item.kinorium_id || ""),
        rezka_id: String(item.rezka_id || ""),
        rezka_url: String(item.rezka_url || ""),
        title: item.title || displayTitle(item) || "Velarium",
        orig_title: item.orig_title || "",
        year: item.year || "",
        season: sNum,
        episodes: targetEpisodes,
        episode_titles: epTitlesMap,
        max_season_episode: maxSeasonEp,
        poster: item.poster || item.backdrop || "",
        backdrop: item.backdrop || item.poster || "",
        quality: qualityLabel,
        studio: studioNameForBatch,
        translator_id: translatorId,
        source_tab: "hdrezka",
        genres: Array.isArray(item.genres) ? item.genres : [],
        age_rating: String(item.age_rating || item.mpaa || ""),
        lang: state.appLang || "ru",
      }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      showToast(data.error || t("Не удалось поставить серии в очередь", "Could not queue episodes"));
      return;
    }
    if (data.downloads) {
      const prevCompletedSig = _completedDownloadsSignature(state.downloadsItems);
      state.downloadsItems = data.downloads.items || [];
      state.downloadsActiveCount = Number(data.downloads.active_count) || 0;
      state.downloadsTotalBytes = Number(data.downloads.total_disk_bytes) || 0;
      if (data.downloads.prefs) {
        state.downloadsPrefs = { ...state.downloadsPrefs, ...data.downloads.prefs };
      }
      syncDownloadsPrefsCheckboxes();
      syncDownloadsHeaderBadge();
      _syncOfflineSurfacesAfterDownloadsChange(prevCompletedSig);
    }
    const addedCount = Number(data.queued_count ?? (data.queued || []).length) || 0;
    const skippedCount = Number(data.skipped_count) || 0;
    if (addedCount > 0) {
      startDownloadsPollingIfNeeded();
      showVideoOsd("download", t(`В очереди: ${addedCount}`, `Queued: ${addedCount}`));
      showToast(
        t(
          `Поставлено в очередь офлайн-загрузки: ${addedCount} (Сезон ${sNum})`,
          `Queued ${addedCount} episodes of Season ${sNum} for offline playback`
        ),
        {
          actionLabel: t("Загрузки", "Downloads"),
          onAction: () => openDownloadsModal(),
        }
      );
    } else if (skippedCount > 0) {
      showToast(
        t(
          "Выбранные серии уже сохранены или загружаются офлайн",
          "Selected episodes are already saved or downloading offline"
        ),
        {
          actionLabel: t("Загрузки", "Downloads"),
          onAction: () => openDownloadsModal(),
        }
      );
    }
  } catch (_) {
    showToast(t("Ошибка при пакетной постановке серий в очередь", "Failed to batch-queue episodes"));
  }
}

let _downloadsRefreshInFlight = false;

export async function refreshDownloadsState() {
  if (_downloadsRefreshInFlight) return;
  if (typeof document !== "undefined" && document.hidden && !state.isPlayerOpen) return;
  _downloadsRefreshInFlight = true;
  try {
    const res = await fetch(`/api/downloads?lang=${encodeURIComponent(state.appLang || "ru")}`);
    if (!res.ok) return;
    const data = await res.json();
    const prevActive = state.downloadsActiveCount || 0;
    const prevCompletedSig = _completedDownloadsSignature(state.downloadsItems);
    state.downloadsItems = Array.isArray(data.items) ? data.items : [];
    state.downloadsActiveCount = Number(data.active_count) || 0;
    state.downloadsTotalBytes = Number(data.total_disk_bytes) || 0;
    if (data.prefs) {
      state.downloadsPrefs = { ...state.downloadsPrefs, ...data.prefs };
      syncDownloadsPrefsCheckboxes();
    }
    syncDownloadsHeaderBadge();
    _syncOfflineSurfacesAfterDownloadsChange(prevCompletedSig);

    if (!document.getElementById("downloads-modal")?.classList.contains("hidden")) {
      renderDownloadsModalList(data.downloads_dir || "");
    }

    if (prevActive > 0 && state.downloadsActiveCount === 0) {
      const latestDone = state.downloadsItems.find(
        (it) => it.status === "completed" && Date.now() - (Number(it.completed_at) || 0) * 1000 < 8000
      );
      if (latestDone) {
        showToast(
          t(
            `Загрузка завершена: «${latestDone.title}» доступна офлайн`,
            `Download finished: "${latestDone.title}" is ready offline`
          ),
          {
            actionLabel: t("Открыть", "Open"),
            onAction: () => openDownloadsModal(),
          }
        );
      }
    }

    if (state.downloadsActiveCount > 0) {
      startDownloadsPollingIfNeeded();
    } else if (state.downloadsPollTimerId) {
      clearInterval(state.downloadsPollTimerId);
      state.downloadsPollTimerId = null;
    }
  } catch (err) { window.logDebug?.("FeaturesDownloads", err); }
  finally {
    _downloadsRefreshInFlight = false;
  }
}

export function startDownloadsPollingIfNeeded() {
  if (state.downloadsPollTimerId) return;
  state.downloadsPollTimerId = setInterval(() => {
    refreshDownloadsState();
  }, 1500);
}

export async function downloadCurrentPlayerStreamOffline() {
  if (!state.isPlayerOpen || !state.activeItem) return;
  document.getElementById("player-gear-popover")?.classList.add("hidden");
  const gearBtn = document.getElementById("btn-player-gear");
  gearBtn?.classList.remove("active");
  gearBtn?.setAttribute("aria-expanded", "false");
  document.getElementById("video-stage")?.classList.remove("vc-popover-open");
  document.getElementById("video-stage")?.parentElement?.classList.remove("vc-popover-open");
  if (state.isPlayingOfflineDownload || state.activeSourceTab === "offline") {
    showToast(t("Это видео уже воспроизводится из офлайн-папки", "This video is already playing from offline storage"));
    openDownloadsModal();
    return;
  }

  const item = state.activeItem;
  const existingDl = findOfflineDownloadForTitle(
    item,
    item.media_type === "series" ? state.activeSeason : null,
    item.media_type === "series" ? state.activeEpisode : null,
    ["completed", "downloading", "queued"]
  );
  if (existingDl) {
    showToast(
      existingDl.status === "completed"
        ? t("Уже сохранено в офлайн-папке — открываем загрузки", "Already saved offline — opening Downloads")
        : t("Это видео уже сохраняется в дорогу — открываем загрузки", "Already downloading for offline — opening Downloads")
    );
    openDownloadsModal();
    return;
  }

  const video = document.getElementById("native-video");
  const { dur } = getEffectivePlaybackTiming(video);
  const isRemux = Boolean(state.remuxMeta?.active && state.remuxMeta.rawSourceUrl);
  const streamUrl = isRemux ? state.remuxMeta.rawSourceUrl : state.currentStreamUrl;

  if (!streamUrl || state.activeSourceTab === "trailer") {
    showToast(
      t(
        "Дождитесь запуска видеопотока перед сохранением в дорогу",
        "Wait for the video stream to start before saving offline"
      )
    );
    return;
  }

  const qualSel = document.getElementById("select-quality");
  const qualityLabel =
    state.activeSourceTab === "backup4k"
      ? "4K UHD"
      : (qualSel && qualSel.value) || "1080p";
  const epMeta =
    item.media_type === "series" ? getEpisodeDisplayMeta(state.activeSeason, state.activeEpisode) : null;

  const subsPayload = (state.subtitles || []).map((s) => ({
    lang: s.lang || "",
    url: s.url || "",
    stream_index: typeof s.streamIndex === "number" ? s.streamIndex : undefined,
  }));

  document.getElementById("player-gear-popover")?.classList.add("hidden");
  document.getElementById("btn-player-gear")?.classList.remove("active");

  try {
    const res = await fetch("/api/downloads/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id || "",
        kinorium_id: String(item.kinorium?.kinorium_id || item.kinorium_id || ""),
        rezka_id: String(item.rezka_id || ""),
        rezka_url: String(item.rezka_url || ""),
        title: item.title || displayTitle(item) || "Velarium",
        orig_title: item.orig_title || "",
        year: item.year || "",
        media_type: item.media_type || "movie",
        season: state.activeSeason || 1,
        episode: state.activeEpisode || 1,
        episode_title: epMeta?.realTitle || "",
        poster: item.poster || item.backdrop || "",
        backdrop: item.backdrop || item.poster || "",
        stream_url: streamUrl,
        quality: qualityLabel,
        studio: state.activeStudioName || "HDRezka",
        source_tab: state.activeSourceTab || "hdrezka",
        is_remux_source: isRemux,
        audio_index: isRemux ? Number(state.remuxMeta.audioIndex) || 0 : 0,
        video_codec: isRemux ? String(state.remuxMeta.videoCodec || "") : "",
        audio_codec: isRemux ? String(state.remuxMeta.audioCodec || "") : "",
        channels: isRemux ? Number(state.remuxMeta.channels) || 2 : 2,
        duration: Number(dur) || 0,
        genres: Array.isArray(item.genres) ? item.genres : [],
        age_rating: String(item.age_rating || item.mpaa || ""),
        subtitles: subsPayload,
        lang: state.appLang || "ru",
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showToast(data.error || t("Не удалось поставить загрузку в очередь", "Could not start offline download"));
      return;
    }

    if (data.downloads) {
      const prevCompletedSig = _completedDownloadsSignature(state.downloadsItems);
      state.downloadsItems = data.downloads.items || [];
      state.downloadsActiveCount = Number(data.downloads.active_count) || 0;
      state.downloadsTotalBytes = Number(data.downloads.total_disk_bytes) || 0;
      syncDownloadsHeaderBadge();
      _syncOfflineSurfacesAfterDownloadsChange(prevCompletedSig);
    } else {
      syncPlayerOfflineControlsUI();
    }
    startDownloadsPollingIfNeeded();
    showVideoOsd("download", t("Сохраняется в дорогу", "Saving for offline"));
    showToast(
      item.media_type === "series"
        ? t(
            `Добавлено в «Скачать в дорогу»: Сезон ${state.activeSeason}, Серия ${state.activeEpisode} (${qualityLabel})`,
            `Added to Offline Downloads: Season ${state.activeSeason}, Episode ${state.activeEpisode} (${qualityLabel})`
          )
        : t(
            `Добавлено в «Скачать в дорогу»: «${displayTitle(item)}» (${qualityLabel})`,
            `Added to Offline Downloads: "${displayTitle(item)}" (${qualityLabel})`
          ),
      {
        actionLabel: t("Загрузки", "Downloads"),
        onAction: () => openDownloadsModal(),
      }
    );
  } catch (_) {
    showToast(t("Ошибка при запуске офлайн-загрузки", "Error starting offline download"));
  }
}

export async function openDownloadsModal() {
  const modal = document.getElementById("downloads-modal");
  if (!modal) return;
  exitBrowserFullscreenIfNeeded();
  const wasHidden = modal.classList.contains("hidden");
  if (wasHidden) {
    rememberModalTriggerFocus("downloads-modal");
  }
  modal.classList.remove("hidden");
  if (wasHidden) {
    requestAnimationFrame(() => {
      document.getElementById("close-downloads-modal")?.focus({ preventScroll: true });
    });
  }
  syncScrollTopButton();
  renderDownloadsModalList();
  await refreshDownloadsState();
}

export function closeDownloadsModal() {
  const modal = document.getElementById("downloads-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  closeCustomSelectMenu({ restoreFocus: false });
  modal.classList.add("hidden");
  syncScrollTopButton();
  restoreModalTriggerFocus("downloads-modal");
}

export function renderDownloadsModalList(downloadsDir = "") {
  const listEl = document.getElementById("downloads-modal-list");
  const summaryEl = document.getElementById("downloads-modal-summary");
  if (!listEl) return;

  const items = Array.isArray(state.downloadsItems) ? state.downloadsItems : [];
  const completedCount = items.filter((x) => x.status === "completed").length;
  const activeCount = items.filter((x) => x.status === "downloading" || x.status === "queued").length;

  if (summaryEl) {
    const parts = [];
    if (completedCount > 0) {
      parts.push(
        isEn()
          ? `${completedCount} saved offline`
          : `Готово офлайн: ${completedCount}`
      );
    }
    if (activeCount > 0) {
      parts.push(
        isEn()
          ? `${activeCount} downloading`
          : `В загрузке: ${activeCount}`
      );
    }
    parts.push(`${t("Занято на диске", "Disk usage")}: ${formatBytesHuman(state.downloadsTotalBytes)}`);
    if (downloadsDir) {
      summaryEl.title = downloadsDir;
    }
    summaryEl.textContent = parts.join(" · ");
  }

  if (items.length === 0) {
    listEl.dataset.dlStructureKey = "empty";
    listEl.innerHTML = `
      <div class="atv-dl-empty">
        <div class="atv-dl-empty-ico">${iconSvg("download", 24)}</div>
        <div class="atv-dl-empty-title">${t("Список офлайн-загрузок пуст", "No Offline Downloads Yet")}</div>
        <div class="atv-dl-empty-sub">
          ${t(
            "Откройте любой фильм или серию и нажмите кнопку со стрелкой «Скачать в дорогу» в нижней панели плеера — видео 1080p / 4K, выбранная озвучка и субтитры сохранятся в MP4 для просмотра без интернета.",
            "Open any movie or episode and click the Download button in the player bar — 1080p / 4K video, selected audio track, and subtitles are remuxed into a local MP4 for offline playback."
          )}
        </div>
      </div>
    `;
    return;
  }

  const formatDlStatusLine = (dl) => {
    const st = dl.status;
    const pct = Math.min(100, Math.max(0, Math.round(Number(dl.progress_pct) || 0)));
    if (st === "completed") {
      return `${t("Доступно без интернета", "Ready for offline playback")} · ${formatBytesHuman(dl.file_size)}`;
    }
    if (st === "downloading") {
      const speedPart = dl.speed_label ? ` · ${dl.speed_label}` : "";
      const etaPart =
        Number(dl.eta_sec) > 0
          ? ` · ${t("осталось", "left")} ${formatTime(dl.eta_sec)}`
          : "";
      return `${t("Сохранение MP4", "Saving MP4")}: ${pct}% (${formatBytesHuman(dl.downloaded_bytes)})${speedPart}${etaPart}`;
    }
    if (st === "queued") {
      return t("В очереди на ремукс...", "Queued for remux...");
    }
    if (st === "cancelled") {
      return t("Загрузка отменена", "Download cancelled");
    }
    return dl.error || t("Ошибка сохранения потока", "Stream download failed");
  };

  const structureKey = `${state.appLang || "ru"}|${items
    .map((dl) => `${dl.download_id}:${dl.status}:${dl.quality || ""}:${dl.studio || ""}`)
    .join("|")}`;
  if (listEl.dataset.dlStructureKey === structureKey) {
    const rowMap = listEl._cfDlRowMap;
    if (rowMap instanceof Map) {
      items.forEach((dl) => {
        const entry = rowMap.get(String(dl.download_id || ""));
        if (!entry) return;
        const pct = Math.min(100, Math.max(0, Math.round(Number(dl.progress_pct) || 0)));
        if (entry.fillEl) {
          entry.fillEl.style.width = `${Math.max(3, pct)}%`;
        }
        if (entry.noteEl) {
          const nextNote = formatDlStatusLine(dl);
          if (entry.noteEl.textContent !== nextNote) {
            entry.noteEl.textContent = nextNote;
          }
        }
      });
      return;
    }
  }
  listEl.dataset.dlStructureKey = structureKey;

  const seasonGroupCounts = new Map();
  items.forEach((dl) => {
    if (dl.media_type === "series") {
      const sKey = `${dl.item_id || dl.kinorium_id || dl.rezka_id || (dl.title || "").trim().toLowerCase()}|s${Number(dl.season) || 1}`;
      seasonGroupCounts.set(sKey, (seasonGroupCounts.get(sKey) || 0) + 1);
    }
  });
  const renderedSeasonGroups = new Set();

  listEl.innerHTML = items
    .map((dl) => {
      const did = dl.download_id;
      const isSeries = dl.media_type === "series";
      const sKey = isSeries
        ? `${dl.item_id || dl.kinorium_id || dl.rezka_id || (dl.title || "").trim().toLowerCase()}|s${Number(dl.season) || 1}`
        : "";
      const showDeleteSeasonBtn =
        isSeries && (seasonGroupCounts.get(sKey) || 0) >= 2 && !renderedSeasonGroups.has(sKey);
      if (showDeleteSeasonBtn) {
        renderedSeasonGroups.add(sKey);
      }
      const titleDisp = isEn() && dl.orig_title ? dl.orig_title : dl.title || "Velarium";
      const rawEpTitle = String(dl.episode_title || "").trim();
      const locEpTitle = isEn() && hasCyrillicText(rawEpTitle) ? "" : rawEpTitle;
      const epLine = isSeries
        ? `${t(`Сезон ${dl.season}, Серия ${dl.episode}`, `Season ${dl.season}, Episode ${dl.episode}`)}${
            locEpTitle ? ` — ${locEpTitle}` : ""
          }`
        : dl.year
        ? String(dl.year)
        : "";
      const subsCount = Array.isArray(dl.subtitles) ? dl.subtitles.length : 0;
      const metaTags = [
        dl.quality || "1080p",
        translateStudioName(dl.studio || "HDRezka"),
        subsCount > 0
          ? isEn()
            ? `${subsCount} sub ${subsCount === 1 ? "track" : "tracks"}`
            : `Субтитры: ${subsCount}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");

      const st = dl.status;
      const pct = Math.min(100, Math.max(0, Math.round(Number(dl.progress_pct) || 0)));
      let statusLine = "";
      if (st === "completed") {
        statusLine = `${t("Доступно без интернета", "Ready for offline playback")} · ${formatBytesHuman(dl.file_size)}`;
      } else if (st === "downloading") {
        const speedPart = dl.speed_label ? ` · ${dl.speed_label}` : "";
        const etaPart =
          Number(dl.eta_sec) > 0
            ? ` · ${t("осталось", "left")} ${formatTime(dl.eta_sec)}`
            : "";
        statusLine = `${t("Сохранение MP4", "Saving MP4")}: ${pct}% (${formatBytesHuman(dl.downloaded_bytes)})${speedPart}${etaPart}`;
      } else if (st === "queued") {
        statusLine = t("В очереди на ремукс...", "Queued for remux...");
      } else if (st === "cancelled") {
        statusLine = t("Загрузка отменена", "Download cancelled");
      } else {
        statusLine = dl.error || t("Ошибка сохранения потока", "Stream download failed");
      }

      const posterHtml = dl.poster
        ? `<img class="atv-dl-poster" src="${escapeAttr(dl.poster)}" alt="${escapeAttr(titleDisp)}" loading="lazy" />`
        : `<div class="atv-dl-poster is-placeholder">${iconSvg("film", 18)}</div>`;

      return `
        <div class="atv-dl-row is-${escapeAttr(st)}" data-dl-id="${escapeAttr(did)}">
          ${posterHtml}
          <div class="atv-dl-info">
            <div class="atv-dl-title-row">
              <span class="atv-dl-title">${escapeHtml(titleDisp)}</span>
              <span class="atv-dl-qual-pill">${escapeHtml(dl.quality || "1080p")}</span>
            </div>
            ${epLine ? `<div class="atv-dl-ep">${escapeHtml(epLine)}</div>` : ""}
            <div class="atv-dl-meta">${escapeHtml(metaTags)}</div>
            ${
              st === "downloading" || st === "queued"
                ? `<div class="atv-dl-progress-track"><div class="atv-dl-progress-fill" style="width:${Math.max(3, pct)}%"></div></div>`
                : ""
            }
            <div class="atv-dl-status-note">${escapeHtml(statusLine)}</div>
          </div>
          <div class="atv-dl-actions">
            ${
              st === "completed"
                ? `<button type="button" class="atv-btn-primary atv-btn-xs" data-play-dl="${escapeAttr(did)}">
                    ${iconSvg("play", 11)}
                    <span>${t("Смотреть", "Watch")}</span>
                  </button>
                  <a class="atv-btn-secondary atv-btn-xs" href="${escapeAttr(dl.export_url || `${dl.play_url}?download=1`)}" download title="${escapeAttr(t("Сохранить копию файла .mp4", "Save .mp4 file copy"))}" aria-label="${escapeAttr(t("Сохранить копию файла .mp4", "Save .mp4 file copy"))}">
                    ${iconSvg("fileDown", 12)}
                  </a>
                  <button type="button" class="atv-btn-secondary atv-btn-xs" data-reveal-dl="${escapeAttr(did)}" title="${escapeAttr(t("Показать MP4 в папке", "Show MP4 in folder"))}" aria-label="${escapeAttr(t("Показать MP4 в папке", "Show MP4 in folder"))}">
                    ${iconSvg("folder", 12)}
                  </button>`
                : ""
            }
            ${
              st === "downloading" || st === "queued"
                ? `<button type="button" class="atv-btn-secondary atv-btn-xs" data-cancel-dl="${escapeAttr(did)}">
                    ${t("Стоп", "Cancel")}
                  </button>`
                : ""
            }
            ${
              st === "failed" || st === "cancelled"
                ? `<button type="button" class="atv-btn-secondary atv-btn-xs" data-retry-dl="${escapeAttr(did)}" title="${escapeAttr(t("Повторить загрузку", "Retry download"))}">
                    ${iconSvg("refresh", 11)}
                    <span>${t("Повторить", "Retry")}</span>
                  </button>`
                : ""
            }
            ${
              showDeleteSeasonBtn
                ? `<button type="button" class="atv-btn-secondary atv-btn-xs atv-btn-danger-text" data-delete-season-dl="${escapeAttr(did)}" title="${escapeAttr(t(`Удалить все скачанные серии ${dl.season} сезона`, `Delete all Season ${dl.season} downloads`))}">
                    <span>${t(`Сезон ${dl.season}`, `Season ${dl.season}`)}</span>
                    ${iconSvg("trash", 11)}
                  </button>`
                : ""
            }
            <button type="button" class="atv-btn-secondary atv-btn-xs atv-btn-danger-text" data-delete-dl="${escapeAttr(did)}" title="${escapeAttr(t("Удалить файл с диска", "Delete from disk"))}" aria-label="${escapeAttr(t("Удалить файл с диска", "Delete from disk"))}">
              ${iconSvg("trash", 12)}
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  const newRowMap = new Map();
  listEl.querySelectorAll(".atv-dl-row[data-dl-id]").forEach((r) => {
    newRowMap.set(r.dataset.dlId, {
      fillEl: r.querySelector(".atv-dl-progress-fill"),
      noteEl: r.querySelector(".atv-dl-status-note"),
    });
  });
  listEl._cfDlRowMap = newRowMap;

  listEl.querySelectorAll("img.atv-dl-poster").forEach((imgEl) => {
    imgEl.onerror = () => {
      const ph = document.createElement("div");
      ph.className = "atv-dl-poster is-placeholder";
      ph.innerHTML = iconSvg("film", 18);
      imgEl.replaceWith(ph);
    };
  });

  listEl.querySelectorAll("[data-play-dl]").forEach((b) => {
    b.onclick = () => {
      const found = items.find((x) => x.download_id === b.dataset.playDl);
      if (found) playOfflineDownload(found);
    };
  });
  listEl.querySelectorAll("[data-reveal-dl]").forEach((b) => {
    b.onclick = () => openDownloadsFolder(b.dataset.revealDl);
  });
  listEl.querySelectorAll("[data-cancel-dl]").forEach((b) => {
    b.onclick = () => cancelOfflineDownload(b.dataset.cancelDl);
  });
  listEl.querySelectorAll("[data-retry-dl]").forEach((b) => {
    b.onclick = () => retryOfflineDownload(b.dataset.retryDl);
  });
  listEl.querySelectorAll("[data-delete-dl]").forEach((b) => {
    b.onclick = () => deleteOfflineDownload(b.dataset.deleteDl);
  });
  listEl.querySelectorAll("[data-delete-season-dl]").forEach((b) => {
    b.onclick = () => {
      const found = items.find((x) => x.download_id === b.dataset.deleteSeasonDl);
      if (found) deleteSeasonOfflineDownloads(found);
    };
  });
}

export async function playOfflineDownload(dlItem) {
  if (!dlItem || !dlItem.play_url) return;
  closeDownloadsModal();

  if (Array.isArray(state.downloadsItems) && !state.downloadsItems.some((x) => x.download_id === dlItem.download_id)) {
    state.downloadsItems = [dlItem, ...state.downloadsItems];
  }

  const dlTitleNorm = String(dlItem.title || "").trim().toLowerCase();
  const existingCat = matchCatalogItemSafe(state.catalogItems || [], {
    id: dlItem.item_id || "",
    kinorium_id: dlItem.kinorium_id || "",
    rezka_id: dlItem.rezka_id || "",
    title: dlItem.title || "",
    orig_title: dlItem.orig_title || "",
    year: dlItem.year || "",
    media_type: dlItem.media_type || "movie",
  });

  let offlineSeasonsMap = existingCat?.seasons_map || null;
  if (dlItem.media_type === "series" && (!offlineSeasonsMap || Object.keys(offlineSeasonsMap).length === 0)) {
    const mapAcc = {};
    (state.downloadsItems || []).forEach((cand) => {
      if (!cand || cand.status !== "completed" || cand.media_type !== "series") return;
      const sameSeries =
        (dlItem.item_id && cand.item_id === dlItem.item_id) ||
        (dlItem.kinorium_id && String(cand.kinorium_id || "") === String(dlItem.kinorium_id)) ||
        (dlItem.rezka_id && String(cand.rezka_id || "") === String(dlItem.rezka_id)) ||
        (dlTitleNorm && String(cand.title || "").trim().toLowerCase() === dlTitleNorm);
      if (!sameSeries) return;
      const sKey = String(Math.max(1, Number(cand.season) || 1));
      const epVal = Math.max(1, Number(cand.episode) || 1);
      if (!mapAcc[sKey]) mapAcc[sKey] = [];
      if (!mapAcc[sKey].includes(epVal)) mapAcc[sKey].push(epVal);
    });
    Object.keys(mapAcc).forEach((k) => mapAcc[k].sort((a, b) => a - b));
    if (Object.keys(mapAcc).length > 0) offlineSeasonsMap = mapAcc;
  }

  const stableFallbackId =
    dlItem.item_id ||
    (dlItem.kinorium_id ? `kin_${dlItem.kinorium_id}` : "") ||
    (dlItem.rezka_id ? `rezka_${dlItem.rezka_id}` : "") ||
    dlItem.download_id;

  const synthItem = existingCat
    ? {
        ...existingCat,
        poster: dlItem.poster || existingCat.poster,
        ...(offlineSeasonsMap ? { seasons_map: offlineSeasonsMap } : {}),
      }
    : {
        id: stableFallbackId,
        kinorium_id: dlItem.kinorium_id || "",
        rezka_id: dlItem.rezka_id || "",
        rezka_url: dlItem.rezka_url || "",
        title: dlItem.title || "Velarium",
        orig_title: dlItem.orig_title || "",
        year: dlItem.year || "",
        media_type: dlItem.media_type || "movie",
        poster: dlItem.poster || "",
        backdrop: dlItem.backdrop || dlItem.poster || "",
        genres: Array.isArray(dlItem.genres) ? dlItem.genres : [],
        age_rating: dlItem.age_rating || "",
        ratings: {},
        kinorium: {},
        ...(offlineSeasonsMap ? { seasons_map: offlineSeasonsMap } : {}),
      };

  const sNum = dlItem.media_type === "series" ? Number(dlItem.season) || 1 : 1;
  const eNum = dlItem.media_type === "series" ? Number(dlItem.episode) || 1 : 1;
  const savedProg = getEpisodeProgress(synthItem, sNum, eNum);
  const startSec =
    savedProg && savedProg.current_time > 10 && savedProg.pct < 95 ? savedProg.current_time : 0;

  state.activeOfflineDownloadId = dlItem.download_id;
  await openPlayerModal(synthItem, "offline", sNum, eNum, startSec);
}

export async function cancelOfflineDownload(downloadId) {
  if (!downloadId) return;
  try {
    const prevCompletedSig = _completedDownloadsSignature(state.downloadsItems);
    const res = await fetch("/api/downloads/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ download_id: downloadId, lang: state.appLang || "ru" }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      showToast(data.error || t("Не удалось остановить загрузку", "Could not cancel download"));
      return;
    }
    if (data.downloads) {
      state.downloadsItems = data.downloads.items || [];
      state.downloadsActiveCount = Number(data.downloads.active_count) || 0;
      state.downloadsTotalBytes = Number(data.downloads.total_disk_bytes) || 0;
      syncDownloadsHeaderBadge();
      renderDownloadsModalList(data.downloads.downloads_dir || "");
      _syncOfflineSurfacesAfterDownloadsChange(prevCompletedSig);
    }
    showToast(t("Загрузка остановлена", "Download cancelled"));
  } catch (err) { window.logDebug?.("FeaturesDownloads", err); }
}

export async function retryOfflineDownload(downloadId) {
  if (!downloadId) return;
  try {
    const res = await fetch("/api/downloads/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ download_id: downloadId, lang: state.appLang || "ru" }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      showToast(data.error || t("Не удалось повторить загрузку", "Could not retry download"));
      return;
    }
    await refreshDownloadsState();
    showToast(t("Загрузка возвращена в очередь", "Download returned to queue"));
  } catch (err) { window.logDebug?.("FeaturesDownloads", err); }
}

export async function deleteOfflineDownload(downloadId) {
  if (!downloadId) return;
  try {
    const prevCompletedSig = _completedDownloadsSignature(state.downloadsItems);
    const res = await fetch("/api/downloads/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ download_id: downloadId, lang: state.appLang || "ru" }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      showToast(data.error || t("Не удалось удалить офлайн-файл", "Could not delete offline file"));
      return;
    }
    const wasPlayingDeletedOffline = Boolean(
      state.isPlayerOpen &&
        (state.activeSourceTab === "offline" || state.isPlayingOfflineDownload) &&
        String(state.activeOfflineDownloadId || "") === String(downloadId)
    );
    if (data.downloads) {
      state.downloadsItems = data.downloads.items || [];
      state.downloadsActiveCount = Number(data.downloads.active_count) || 0;
      state.downloadsTotalBytes = Number(data.downloads.total_disk_bytes) || 0;
      syncDownloadsHeaderBadge();
      renderDownloadsModalList(data.downloads.downloads_dir || "");
      _syncOfflineSurfacesAfterDownloadsChange(prevCompletedSig);
    }
    if (wasPlayingDeletedOffline && state.activeItem) {
      state.isPlayingOfflineDownload = false;
      state.activeOfflineDownloadId = "";
      const fallbackTab = getDefaultPlayableSourceTab();
      if (fallbackTab && fallbackTab !== "offline") {
        const videoEl = document.getElementById("native-video");
        const { cur } = getEffectivePlaybackTiming(videoEl);
        switchSourceTab(fallbackTab, cur > 5 ? cur : 0);
      } else {
        closePlayerModal();
      }
    }
    showToast(t("Офлайн-файл удалён с диска", "Offline file deleted from disk"));
  } catch (err) { window.logDebug?.("FeaturesDownloads", err); }
}

export async function deleteSeasonOfflineDownloads(dlSample) {
  if (!dlSample) return;
  try {
    const prevCompletedSig = _completedDownloadsSignature(state.downloadsItems);
    const sNum = Math.max(1, Number(dlSample.season) || 1);
    const res = await fetch("/api/downloads/delete-season", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_id: dlSample.item_id || "",
        kinorium_id: dlSample.kinorium_id || "",
        rezka_id: dlSample.rezka_id || "",
        title: dlSample.title || "",
        season: sNum,
        lang: state.appLang || "ru",
      }),
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) {
      showToast(data.error || t("Не удалось удалить сезон", "Could not delete season downloads"));
      return;
    }
    if (data.downloads) {
      state.downloadsItems = data.downloads.items || [];
      state.downloadsActiveCount = Number(data.downloads.active_count) || 0;
      state.downloadsTotalBytes = Number(data.downloads.total_disk_bytes) || 0;
      syncDownloadsHeaderBadge();
      renderDownloadsModalList(data.downloads.downloads_dir || "");
      _syncOfflineSurfacesAfterDownloadsChange(prevCompletedSig);
    }
    const delCnt = Number(data.deleted_count) || 0;
    showToast(
      t(
        `Удалено серий ${sNum} сезона с диска: ${delCnt}`,
        `Deleted ${delCnt} episodes of Season ${sNum} from disk`
      )
    );
  } catch (err) { window.logDebug?.("FeaturesDownloads", err); }
}

export async function openDownloadsFolder(downloadId = "") {
  try {
    let pin = "";
    if (state.activeProfile?.kids_mode && state.activeProfile?.has_kids_pin) {
      pin = await ensureKidsPinVerifiedForAdminAction(
        t(
          "Введите 4-значный PIN-код для открытия папки загрузок на диске",
          "Enter the 4-digit PIN to open the downloads folder on disk"
        )
      );
      if (!pin) return;
    }
    const res = await fetch("/api/downloads/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        download_id: downloadId || "",
        ...(pin ? { pin, current_pin: pin } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showToast(data.error || t("Не удалось открыть папку загрузок", "Could not open downloads folder"));
    }
  } catch (err) { window.logDebug?.("FeaturesDownloads", err); }
}

