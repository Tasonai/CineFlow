import { state } from "./state.js?v=20261024v4";
import {
  displayDescription,
  displayPoster,
  displayTitle,
  formatCriticsRating,
  hasCyrillicText,
  isEn,
  secondaryTitle,
  t,
  translateGenre,
  translateSizeLabel,
  translateStudioName,
} from "./i18n.js?v=20261024v4";
import {
  escapeAttr,
  escapeHtml,
  expandRussianDateText,
  formatTime,
  genitiveAfterIz,
  getEpisodeProgress,
  iconSvg,
  pluralRu,
  recordWatchHistoryEntry,
  saveEpisodeProgress,
  setAmbientColor,
  showToast,
  showVideoOsd,
  supportsNativePiP,
  syncScrollTopButton,
  syncToastContainerMount,
  triggerVideoCenterIndicator,
} from "./utils.js?v=20261024v4";
import {
  applyAudioBoostToVideo,
  applySavedPlayerPrefsToVideo,
  ensureUnlockedAudioContext,
  getPlayerPrefs,
  isVideoInPiP,
  pickBestQualityKey,
  pickPreferredSubtitleIndex,
  sampleAmbilightFrame,
  savePlayerPrefs,
  startAmbilightLoop,
  stopAmbilightLoop,
  togglePictureInPicture,
  updatePlayerGearActiveDot,
} from "./audio-dsp.js?v=20261024v4";
import {
  attachSmartPosterFallback,
  getDefaultPlayableSourceTab,
  getPreferredStudioForItem,
  isEpisodeWatched,
  isServiceEnabled,
  loadCatalog,
  patchCatalogItemKinoriumInPlace,
  renderContinueWatching,
  savePreferredStudioForItem,
  updateKinoriumSectionCounters,
} from "./catalog.js?v=20261024v4";
import {
  closePersonModal,
  closeQuickPeekModal,
  openQuickPeekModal,
  refreshOpenPersonModalUI,
  renderModalCastSection,
} from "./modals.js?v=20261024v4";
import { confirmServiceLogin, openSettingsModal, triggerServiceLoginFlow } from "./settings.js?v=20261024v4";

export function fetchAndApplyPlayerTitleMeta(item, currentSess = state.playerSessionId) {
  if (!item) return Promise.resolve(null);
  const reqLang = state.appLang || "ru";
  const metaParams = new URLSearchParams({
    id: item.rezka_id || item.id || "",
    item_id: item.id || "",
    kinorium_id: String(item.kinorium?.kinorium_id || item.kinorium_id || ""),
    rezka_url: item.rezka_url || "",
    title: item.title || "",
    orig_title: item.orig_title || "",
    year: String(item.year || 2024),
    media_type: item.media_type || "movie",
    lang: reqLang,
  });
  return fetch(`/api/title-meta?${metaParams.toString()}`)
    .then((r) => r.json())
    .then((m) => {
      if (!state.isPlayerOpen || state.playerSessionId !== currentSess || state.activeItem !== item) {
        return null;
      }
      if (m.rezka_id) item.rezka_id = m.rezka_id;
      if (m.rezka_url) item.rezka_url = m.rezka_url;
      if (m.poster_en) item.poster_en = m.poster_en;
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
        if (m.description && m.description.length > 25) {
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
      if (m.duration_label) item.duration_label = m.duration_label;
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
      }
      if (item.media_type === "series" && m.seasons_map && Object.keys(m.seasons_map).length > 0) {
        if (Object.keys(state.seasonsMap || {}).length === 0) {
          state.seasonsMap = m.seasons_map;
        }
        populateSeasonEpisodeSelectors(item, state.seasonsMap);
        updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);
      } else if (item.media_type === "series" && (m.kinorium_status || m.episodes_titles || m.episodes_meta)) {
        populateSeasonEpisodeSelectors(item, state.seasonsMap);
        updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);
      }
      renderModalCastSection(item, m);
      return m;
    })
    .catch(() => null);
}
export async function openPlayerModal(item, initialTab = "hdrezka", season = 1, episode = 1, resumeTime = 0) {
  if (
    (initialTab === "hdrezka" && !isServiceEnabled("hdrezka")) ||
    (initialTab === "stremio" && !isServiceEnabled("stremio")) ||
    (initialTab === "backup4k" && !isServiceEnabled("backup4k")) ||
    initialTab === "official"
  ) {
    initialTab = getDefaultPlayableSourceTab();
  }
  clearAutoplayNextTimer();
  closePersonModal({ suppressResume: true });
  closeQuickPeekModal({ clearStack: true, suppressResume: true });
  state.pausedByOverlayModal = false;
  state.postwatchAnchor = "header";
  state.playerSessionId += 1;
  state.isPlayerOpen = true;
  state.userMutedThisSession = false;
  state.catalogDirty = false;
  state.activeItem = item;
  state.activeSeason = season;
  state.activeEpisode = episode;
  state.seasonsMap = {};
  state.episodesTitles = {};
  state.episodesMeta = {};
  state.subtitles = [];
  state.activeSubtitleIndex = -1;
  state.external4kSubs = [];
  clearCustomSubtitleOverlay();
  state.currentStreamUrl = "";
  state.active4kReleaseUrl = "";
  state.active4kReleaseKey = "";
  state.stremioStreamsData = null;
  state.activeStremioStreamKey = "";
  state.externalStremioSubs = [];
  state.stremioFilter = "all";
  document.querySelectorAll("#stremio-filter-pills .atv-stremio-filter-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.sfilter === "all");
  });
  state.trailerData = null;
  state.trailerLang = isEn() ? "en" : "ru";
  state.trailerPlaying = false;
  state.episodesStripExpanded = true;
  state.ratingPromptShownThisSession = {};
  state.postwatchHovered = false;
  state.postwatchManual = false;
  document.getElementById("player-gear-popover")?.classList.add("hidden");
  document.getElementById("gear-hotkeys-box")?.classList.add("hidden");
  document.getElementById("btn-toggle-gear-hotkeys")?.classList.remove("active");
  document.getElementById("btn-player-gear")?.classList.remove("active");
  document.getElementById("kinorium-status-popover")?.classList.add("hidden");
  document.getElementById("video-osd-pill")?.classList.add("hidden");
  document.getElementById("video-error-state")?.classList.add("hidden");
  closeAllVcPopovers();
  setPipBackgroundMode(false);
  setMiniPlayerMode(false);
  if (!state.hasPlayerHistoryEntry) {
    try {
      window.history.pushState({ cineflowPlayerModal: true }, "");
      state.hasPlayerHistoryEntry = true;
    } catch (_) {}
  }
  syncScrollTopButton();
  if (resumeTime <= 0) {
    const epProg = getEpisodeProgress(item, season, episode);
    if (epProg && epProg.current_time > 10 && epProg.pct < 92) {
      resumeTime = epProg.current_time;
    }
  }
  const trailerBox = document.getElementById("trailer-stage-box");
  if (trailerBox) {
    trailerBox.innerHTML = "";
    trailerBox.classList.add("hidden");
  }
  const savedStudio = getPreferredStudioForItem(item);
  state.activeStudioId = savedStudio?.id || "";
  state.activeStudioName = savedStudio?.name
    ? translateStudioName(savedStudio.name)
    : isEn()
    ? "Original"
    : "HDRezka Studio";
  state.lastNonOriginalStudioId = "";
  state.forceEnableRuSubtitlesOnce = false;
  const hdrStudioLbl = document.getElementById("hdr-studio-label");
  if (hdrStudioLbl) {
    hdrStudioLbl.textContent = savedStudio?.name
      ? translateStudioName(savedStudio.name)
      : t("Озвучка...", "Audio...");
  }
  const selectStudioEl = document.getElementById("select-studio");
  if (selectStudioEl) {
    selectStudioEl.innerHTML = "";
  }
  state.introSkippedThisEpisode = false;
  state.autoplayCancelledThisEpisode = false;
  state.scrobbledThisSession = Boolean(item.kinorium?.watched);
  state.scrobbledEpisodesThisSession = {};

  // Stop any previous stream before starting the new session
  abortActiveVideoListeners();
  const video = document.getElementById("native-video");
  if (state.hlsInstance) {
    try {
      state.hlsInstance.destroy();
    } catch (_) {}
    state.hlsInstance = null;
  }
  if (video) {
    video.onloadedmetadata = null;
    try {
      video.pause();
    } catch (_) {}
    if (!isVideoInPiP(video)) {
      video.removeAttribute("src");
    }
    // Synchronously unlock audible state & AudioContext inside the user's click gesture
    // so async stream playback 1-2s later never gets muted by browser autoplay policies.
    const savedPrefs = getPlayerPrefs();
    state.internalMuteOverride = true;
    try {
      video.muted = false;
      video.volume = savedPrefs.volume > 0.02 ? savedPrefs.volume : 0.85;
    } catch (_) {}
    state.internalMuteOverride = false;
    if ((savedPrefs.audioBoost > 1.01 || savedPrefs.audioPreset !== "flat" || video._cfSourceNode)) {
      ensureUnlockedAudioContext();
    }
  }

  setAmbientColor(item.ambient_color || "#334155");

  const modal = document.getElementById("player-modal");
  modal.classList.remove("hidden");
  modal.querySelector(".atv-info-sidebar")?.scrollTo({ top: 0 });
  modal.querySelector(".atv-player-col")?.scrollTo({ top: 0 });
  document.getElementById("vc-btn-pip")?.classList.toggle("hidden", !supportsNativePiP());
  syncPostwatchOverlayMount();
  document.getElementById("kinorium-postwatch-overlay").classList.add("hidden");
  document.getElementById("skip-intro-btn").classList.add("hidden");
  document.getElementById("skip-outro-btn").classList.add("hidden");

  const typeText = item.media_type === "series" ? t("Сериал", "Series") : t("Фильм", "Movie");
  document.getElementById("modal-title").textContent = displayTitle(item);
  document.getElementById("modal-orig-title").textContent = [secondaryTitle(item), item.year, typeText]
    .filter(Boolean)
    .join(" · ");

  document.getElementById("meta-r-kinorium").textContent = item.kinorium?.kinorium_rating || item.ratings?.kinorium || "—";
  document.getElementById("meta-r-imdb").textContent = item.ratings?.imdb || "—";
  const metaCriticsEl = document.getElementById("meta-r-critics");
  if (metaCriticsEl) {
    metaCriticsEl.textContent = formatCriticsRating(item);
  }
  document.getElementById("meta-description").textContent = displayDescription(item) || "";

  // Hide Skip Intro controls on feature movies
  document.getElementById("skip-intro-footer-controls").classList.toggle("hidden", item.media_type === "movie");

  updateModalKinoriumHeader(item.kinorium || {});
  renderModalProvidersSidebar(item);
  renderModalCastSection(item);
  renderModalSimilarItems(item);
  populateSeasonEpisodeSelectors(item);
  syncMediaSessionMetadata();
  startAmbilightLoop();

  if (
    initialTab !== "hdrezka" ||
    isEn() ||
    formatCriticsRating(item) === "—" ||
    !item.cast_people ||
    item.cast_people.length === 0
  ) {
    fetchAndApplyPlayerTitleMeta(item, state.playerSessionId);
  }

  await switchSourceTab(initialTab, resumeTime);
  await loadSkipIntroSegments();
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

  watchedBtn.classList.toggle("active-watched", Boolean(kStatus.watched));
  watchedText.innerHTML = `${iconSvg("check", 12)}<span>${
    kStatus.watched ? t("Просмотрено", "Watched") : t("Отметить просмотренным", "Mark as watched")
  }</span>${
    kStatus.watched ? `<span class="atv-status-menu-check">${iconSvg("check", 12)}</span>` : ""
  }`;

  const isSeriesItem = state.activeItem?.media_type === "series";
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

  watchlistBtn.classList.remove("active-watched");
  watchlistBtn.classList.toggle("active-watchlist", Boolean(kStatus.in_watchlist));
  watchlistText.innerHTML = `${iconSvg(kStatus.in_watchlist ? "star" : "plus", 12)}<span>${t(
    "Буду смотреть",
    "Watchlist"
  )}</span>${
    kStatus.in_watchlist ? `<span class="atv-status-menu-check">${iconSvg("check", 12)}</span>` : ""
  }`;

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
  const frList = kStatus.friends_ratings || [];
  if (frList.length > 0) {
    friendsEl.innerHTML = frList
      .map((f) => `<span class="friend-pill"><span>${escapeHtml(f.name)}</span> · ${iconSvg("star", 10)}<span>${escapeHtml(f.score)}</span></span>`)
      .join("");
  } else {
    friendsEl.innerHTML = `<span style="font-size:12px;color:rgba(235,235,245,0.42)">${t(
      "Никто из ваших друзей еще не оценил",
      "None of your friends have rated this yet"
    )}</span>`;
  }
}
export function getOfficialServiceTargetUrl(serviceId, item) {
  const q = encodeURIComponent(item?.orig_title || item?.title || "");
  const qPl = encodeURIComponent(item?.title_pl || item?.orig_title || item?.title || "");
  const defaults = {
    appletv: `https://tv.apple.com/pl/search?term=${q}`,
    netflix: `https://www.netflix.com/search?q=${q}`,
    prime: `https://www.primevideo.com/search?phrase=${q}`,
    disney: `https://www.disneyplus.com/pl-pl`,
    max: `https://play.max.com/search?q=${q}`,
    playerpl: `https://player.pl/wyszukiwanie?keyword=${qPl}`,
  };
  const matchedOffer = (item?.providers || []).find((p) => p.id === serviceId && p.available);
  return matchedOffer?.url || defaults[serviceId] || "https://tv.apple.com/pl";
}
export function renderModalProvidersSidebar(item) {
  const secEl = document.getElementById("sidebar-providers-section");
  const listEl = document.getElementById("meta-providers-list");
  if (!listEl || !item) return;
  const allKeys = ["appletv", "netflix", "prime", "disney", "max", "playerpl"].filter((k) =>
    isServiceEnabled(k)
  );
  listEl.innerHTML = "";
  if (secEl) {
    secEl.classList.toggle("hidden", allKeys.length === 0);
  }
  if (allKeys.length === 0) return;

  allKeys.forEach((key) => {
    const meta = state.providersMeta[key] || state.integrations?.[key] || { name: key };
    const found = (item.providers || []).find((p) => p.id === key && p.available);
    const integ = state.integrations?.[key] || { logged_in: false };
    const isPendingLogin = Boolean(state.pendingServiceLogins?.[key]);

    const row = document.createElement("button");
    row.type = "button";
    row.className = "meta-prov-item is-clickable";

    let rightHtml = "";
    if (integ.logged_in) {
      rightHtml = `<span class="meta-prov-action">${escapeHtml(
        found ? found.quality || t("В подписке", "Included") : t("Открыть", "Open")
      )} ${iconSvg("external", 11)}</span>`;
    } else if (isPendingLogin) {
      rightHtml = `<span class="meta-prov-action">${iconSvg("check", 11)} ${t(
        "Подтвердить вход",
        "Confirm sign-in"
      )}</span>`;
    } else {
      rightHtml = `<span class="meta-prov-action muted">${escapeHtml(
        found
          ? `${found.quality || t("Доступно", "Available")} · ${t("Войти", "Sign in")}`
          : t("Войти", "Sign in")
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
        window.open(targetUrl, "_blank", "noopener,noreferrer,width=1280,height=760");
      }
    };

    listEl.appendChild(row);
  });
}
export function renderModalSimilarItems(item) {
  const listEl = document.getElementById("modal-similar-list");
  const secEl = document.getElementById("modal-similar-section");
  if (!listEl || !secEl || !item) return;

  const poolMap = new Map();
  const addCandidate = (cand) => {
    if (!cand || !cand.title) return;
    if (cand.id === item.id || cand.title.trim().toLowerCase() === item.title.trim().toLowerCase()) {
      return;
    }
    const key = cand.id || cand.title.trim().toLowerCase();
    if (!poolMap.has(key)) {
      poolMap.set(key, cand);
    }
  };
  (state.similarPool || []).forEach(addCandidate);
  (state.catalogItems || []).forEach(addCandidate);

  const itemGenres = new Set((item.genres || []).map((g) => String(g || "").trim().toLowerCase()).filter(Boolean));
  const scored = Array.from(poolMap.values()).map((cand) => {
    let score = 0;
    if (cand.media_type === item.media_type) score += 4;
    (cand.genres || []).forEach((g) => {
      if (itemGenres.has(String(g || "").trim().toLowerCase())) {
        score += 3;
      }
    });
    if (!cand.kinorium?.watched) score += 1.5;
    const kr = parseFloat(cand.kinorium?.kinorium_rating || cand.ratings?.kinorium) || 7.5;
    score += kr * 0.25;
    return { cand, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const topSimilar = scored.slice(0, 6).map((x) => x.cand);

  if (topSimilar.length === 0) {
    secEl.classList.add("hidden");
    return;
  }
  secEl.classList.remove("hidden");
  listEl.innerHTML = "";

  topSimilar.forEach((sim) => {
    const kinOn = isServiceEnabled("kinorium");
    const kRat = kinOn
      ? sim.kinorium?.kinorium_rating || sim.ratings?.kinorium || sim.ratings?.imdb || ""
      : sim.ratings?.imdb || sim.kinorium?.kinorium_rating || "";
    const ratHtml = kRat
      ? ` · <span class="atv-meta-rating">${iconSvg("star", 10)}<span>${escapeHtml(kRat)}</span></span>`
      : "";
    const gText = (sim.genres || [])
      .slice(0, 2)
      .map((g) => translateGenre(g))
      .join(", ");
    const simTitle = displayTitle(sim);
    const simPoster = displayPoster(sim);
    const card = document.createElement("div");
    card.className = "atv-similar-card";
    card.innerHTML = `
      <img class="atv-similar-poster" src="${escapeAttr(simPoster)}" alt="${escapeAttr(simTitle)}" loading="lazy" referrerpolicy="no-referrer" />
      <div class="atv-similar-info">
        <div class="atv-similar-title">${escapeHtml(simTitle)}</div>
        <div class="atv-similar-meta"><span>${escapeHtml(sim.year)}</span>${ratHtml}${gText ? " · " + escapeHtml(gText) : ""}</div>
      </div>
    `;
    const imgEl = card.querySelector("img");
    attachSmartPosterFallback(imgEl, simTitle, sim.year, sim.poster);
    card.onclick = () => {
      openQuickPeekModal(sim);
    };
    listEl.appendChild(card);
  });
}
export function escapeEpisodeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
export function getEpisodeDisplayMeta(seasonNum, epNum) {
  const sKey = String(seasonNum);
  const eKey = String(epNum);
  const metaObj = state.episodesMeta?.[sKey]?.[eKey] || null;
  const rawTitle = String(metaObj?.title || state.episodesTitles?.[sKey]?.[eKey] || "").trim();
  const isGeneric = !rawTitle || /^(?:серия|эпизод|episode)\s*\d+$/i.test(rawTitle);
  const ruRealTitle = isGeneric ? "" : rawTitle;
  const rawOrigTitle = String(metaObj?.orig_title || "").trim();
  const origRealTitle = /^(?:серия|эпизод|episode)\s*\d+$/i.test(rawOrigTitle) ? "" : rawOrigTitle;
  const cleanEnTitle =
    origRealTitle && !hasCyrillicText(origRealTitle)
      ? origRealTitle
      : ruRealTitle && !hasCyrillicText(ruRealTitle)
      ? ruRealTitle
      : "";
  const realTitle = isEn() ? cleanEnTitle : ruRealTitle || origRealTitle;
  const secEpTitle = isEn()
    ? ""
    : origRealTitle && origRealTitle.toLowerCase() !== ruRealTitle.toLowerCase()
    ? origRealTitle
    : "";
  let airDate = expandRussianDateText(metaObj?.air_date || "");
  if (isEn() && airDate && hasCyrillicText(airDate)) {
    const ruMonths = {
      января: "Jan",
      февраля: "Feb",
      марта: "Mar",
      апреля: "Apr",
      мая: "May",
      июня: "Jun",
      июля: "Jul",
      августа: "Aug",
      сентября: "Sep",
      октября: "Oct",
      ноября: "Nov",
      декабря: "Dec",
    };
    Object.entries(ruMonths).forEach(([ruM, enM]) => {
      airDate = airDate.replace(new RegExp(ruM, "gi"), enM);
    });
    airDate = airDate.replace(/\bгода\b/gi, "").replace(/\s{2,}/g, " ").trim();
    if (hasCyrillicText(airDate)) airDate = "";
  }
  return {
    code: t(`Сезон ${seasonNum} · Серия ${epNum}`, `Season ${seasonNum} · Episode ${epNum}`),
    rawTitle: realTitle || t(`Серия ${epNum}`, `Episode ${epNum}`),
    realTitle,
    origTitle: secEpTitle,
    airDate,
  };
}
export function getEpisodeRatingEntry(item, seasonNum, epNum) {
  if (!item || !item.kinorium || !item.kinorium.episode_ratings) return null;
  const key = `s${Number(seasonNum) || 1}e${Number(epNum) || 1}`;
  const entry = item.kinorium.episode_ratings[key];
  return entry && typeof entry === "object" ? entry : null;
}
export function updateCurrentEpisodeBar(item, seasonNum, epNum, isPreview = false) {
  const barEl = document.getElementById("current-episode-bar");
  const codeEl = document.getElementById("current-ep-code");
  const titleEl = document.getElementById("current-ep-title");
  const subEl = document.getElementById("current-ep-sub");
  const watchBtn = document.getElementById("btn-toggle-current-ep");
  const watchLbl = document.getElementById("current-ep-watch-label");
  const rateBtn = document.getElementById("btn-rate-current-ep");
  const rateLbl = document.getElementById("current-ep-rate-label");
  if (!barEl || !codeEl || !titleEl) return;
  if (!item || item.media_type !== "series" || state.activeSourceTab === "trailer") {
    barEl.classList.add("hidden");
    return;
  }
  barEl.classList.remove("hidden");
  barEl.classList.toggle("is-preview", Boolean(isPreview));

  const epMeta = getEpisodeDisplayMeta(seasonNum, epNum);
  const isWatched = isEpisodeWatched(item, seasonNum, epNum);
  const activeIsWatched = isEpisodeWatched(item, state.activeSeason, state.activeEpisode);
  const epProg = getEpisodeProgress(item, seasonNum, epNum);
  const previewEpRating = getEpisodeRatingEntry(item, seasonNum, epNum);
  const activeEpRating = getEpisodeRatingEntry(item, state.activeSeason, state.activeEpisode);

  const codeLabel = t(`Сезон ${seasonNum} · Серия ${epNum}`, `Season ${seasonNum} · Episode ${epNum}`);
  codeEl.innerHTML = isPreview
    ? `<span>${codeLabel}</span>`
    : `${iconSvg("play", 10)}<span>${codeLabel}</span>`;
  titleEl.textContent = epMeta.realTitle
    ? isEn()
      ? `"${epMeta.realTitle}"`
      : `«${epMeta.realTitle}»`
    : "";
  titleEl.classList.toggle("hidden", !epMeta.realTitle);

  const subParts = [];
  if (epMeta.origTitle) subParts.push(epMeta.origTitle);
  if (epMeta.airDate) subParts.push(epMeta.airDate);
  if (isPreview && previewEpRating?.score) {
    subParts.push(t(`Оценка: ${previewEpRating.score}/10`, `Rating: ${previewEpRating.score}/10`));
  }
  if (isPreview && isWatched) {
    subParts.push(t("Просмотрено", "Watched"));
  } else if (!isWatched && epProg && epProg.current_time > 5) {
    subParts.push(
      t(
        `Остановились на ${formatTime(epProg.current_time)} (${epProg.pct || 0}%)`,
        `Paused at ${formatTime(epProg.current_time)} (${epProg.pct || 0}%)`
      )
    );
  }
  if (subEl) {
    if (subParts.length > 0) {
      subEl.textContent = subParts.join(" · ");
      subEl.classList.remove("hidden");
    } else {
      subEl.textContent = "";
      subEl.classList.add("hidden");
    }
  }
  if (watchBtn && watchLbl) {
    if (activeIsWatched) {
      watchLbl.textContent = t("Просмотрено", "Watched");
      watchBtn.classList.add("is-watched");
      watchBtn.title = t(
        "Серия отмечена просмотренной в Kinorium (нажмите, чтобы снять отметку)",
        "Episode marked as watched on Kinorium (click to unmark)"
      );
    } else {
      watchLbl.textContent = t("Отметить серию", "Mark episode");
      watchBtn.classList.remove("is-watched");
      watchBtn.title = t(
        "Отметить эту серию просмотренной в Kinorium",
        "Mark this episode as watched on Kinorium"
      );
    }
  }
  if (rateBtn && rateLbl) {
    if (activeEpRating && activeEpRating.score) {
      rateLbl.textContent = t(
        `Серия: ${activeEpRating.score}/10`,
        `Episode: ${activeEpRating.score}/10`
      );
      rateBtn.classList.add("is-rated");
    } else {
      rateLbl.textContent = t("Оценить серию", "Rate episode");
      rateBtn.classList.remove("is-rated");
    }
  }
}
export function resolveEffectiveSeasonsMap(item, passedSeasonsMap = null) {
  const candidates = [
    passedSeasonsMap,
    state.seasonsMap,
    item?.id && state.liveSeriesUpdates?.[item.id]?.seasons_map,
    item?.kinorium?.kinorium_id && state.liveSeriesUpdates?.[`kin_${item.kinorium.kinorium_id}`]?.seasons_map,
    item?.title && state.liveSeriesUpdates?.[item.title.trim().toLowerCase()]?.seasons_map,
    item?.seasons_map,
  ];
  for (const cand of candidates) {
    if (!cand || typeof cand !== "object") continue;
    const valid = {};
    Object.keys(cand).forEach((k) => {
      const sNum = parseInt(k, 10);
      const eps = Array.isArray(cand[k])
        ? cand[k].map((e) => parseInt(e, 10)).filter((n) => n > 0).sort((a, b) => a - b)
        : [];
      if (sNum > 0 && eps.length > 0) {
        valid[String(sNum)] = Array.from(new Set(eps));
      }
    });
    if (Object.keys(valid).length > 0) {
      return valid;
    }
  }
  return null;
}
export function populateSeasonEpisodeSelectors(item, seasonsMap = null) {
  const bottomPanel = document.getElementById("episodes-bottom-panel");
  const seasonGroup = document.getElementById("season-group");
  const epNavGroup = document.getElementById("ep-nav-group");
  const btnPrevEp = document.getElementById("btn-prev-ep");
  const btnNextEp = document.getElementById("btn-next-ep");
  const seasonSel = document.getElementById("select-season");
  const curEpBar = document.getElementById("current-episode-bar");
  const epStripRow = document.getElementById("episodes-strip-row");
  const epStripBar = document.getElementById("episodes-strip-bar");
  const seasonProgBox = document.getElementById("player-season-progress");
  const seasonProgText = document.getElementById("player-season-prog-text");
  const seasonProgFill = document.getElementById("player-season-prog-fill");

  if (item.media_type !== "series") {
    if (bottomPanel) bottomPanel.classList.add("hidden");
    if (seasonGroup) seasonGroup.classList.add("hidden");
    if (epNavGroup) epNavGroup.classList.add("hidden");
    if (curEpBar) curEpBar.classList.add("hidden");
    if (epStripRow) epStripRow.classList.add("hidden");
    if (epStripBar) epStripBar.classList.add("hidden");
    if (seasonProgBox) seasonProgBox.classList.add("hidden");
    syncEpisodesStripDrawerUI();
    syncCustomVideoControlsUI();
    return;
  }

  if (bottomPanel) bottomPanel.classList.remove("hidden");
  if (seasonGroup) seasonGroup.classList.remove("hidden");
  if (epNavGroup) epNavGroup.classList.remove("hidden");
  syncEpisodesStripDrawerUI();

  const resolvedMap = resolveEffectiveSeasonsMap(item, seasonsMap);
  const mapKeys = resolvedMap
    ? Object.keys(resolvedMap)
        .map((k) => parseInt(k, 10))
        .filter((n) => n > 0)
        .sort((a, b) => a - b)
    : [];
  const fallbackSeasonsCount = Math.max(state.activeSeason || 1, Number(item.seasons_count) || 1);
  const seasonNumbers =
    mapKeys.length > 0
      ? mapKeys
      : Array.from({ length: fallbackSeasonsCount }, (_, idx) => idx + 1);

  if (!seasonNumbers.includes(state.activeSeason)) {
    state.activeSeason = seasonNumbers[0] || 1;
  }

  if (seasonSel) {
    seasonSel.innerHTML = "";
    seasonNumbers.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = String(s);
      opt.textContent = `${s}`;
      if (s === state.activeSeason) opt.selected = true;
      seasonSel.appendChild(opt);
    });
  }

  const fallbackEpsCount = Math.max(state.activeEpisode || 1, Number(item.episodes_per_season) || 1);
  const seasonEps =
    resolvedMap && resolvedMap[String(state.activeSeason)] && resolvedMap[String(state.activeSeason)].length > 0
      ? resolvedMap[String(state.activeSeason)]
      : Array.from({ length: fallbackEpsCount }, (_, idx) => idx + 1);

  if (!seasonEps.includes(state.activeEpisode)) {
    state.activeEpisode = seasonEps[0] || 1;
  }

  updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);

  const isGridMode = state.epViewMode === "grid";
  document.getElementById("btn-ep-view-strip")?.classList.toggle("active", !isGridMode);
  document.getElementById("btn-ep-view-grid")?.classList.toggle("active", isGridMode);
  const hoverTipEl = document.getElementById("ep-pill-hover-tooltip");
  if (hoverTipEl) hoverTipEl.classList.add("hidden");

  if (epStripBar) {
    epStripBar.innerHTML = "";
    epStripBar.classList.toggle("ep-grid-mode", isGridMode);
    if (epStripRow) epStripRow.classList.toggle("ep-grid-row", isGridMode);
    epStripBar.onmouseleave = () => {
      if (hoverTipEl) hoverTipEl.classList.add("hidden");
      updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);
    };

    let activePillEl = null;
    seasonEps.forEach((e) => {
      const isWatched = isEpisodeWatched(item, state.activeSeason, e);
      const isActive = e === state.activeEpisode;
      const epProg = getEpisodeProgress(item, state.activeSeason, e);
      const epMeta = getEpisodeDisplayMeta(state.activeSeason, e);
      const epRating = getEpisodeRatingEntry(item, state.activeSeason, e);
      const epBtn = document.createElement("button");
      epBtn.type = "button";
      if (isActive) activePillEl = epBtn;
      const progHint =
        epProg && epProg.current_time > 5
          ? t(
              ` · Остановились на ${formatTime(epProg.current_time)} (${epProg.pct || 0}%)`,
              ` · Paused at ${formatTime(epProg.current_time)} (${epProg.pct || 0}%)`
            )
          : "";
      const tooltipTitlePart = epMeta.realTitle
        ? isEn()
          ? `Episode ${e}: "${epMeta.realTitle}"${epMeta.origTitle ? ` (${epMeta.origTitle})` : ""}`
          : `Серия ${e}: «${epMeta.realTitle}»${epMeta.origTitle ? ` (${epMeta.origTitle})` : ""}`
        : t(`Серия ${e}`, `Episode ${e}`);
      const dateHint = epMeta.airDate ? ` · ${epMeta.airDate}` : "";
      const rateHint = epRating?.score
        ? t(` · Ваша оценка: ${epRating.score}/10`, ` · Your rating: ${epRating.score}/10`)
        : "";
      epBtn.title = `${t(`Сезон ${state.activeSeason}`, `Season ${state.activeSeason}`)} · ${tooltipTitlePart}${dateHint}${
        isWatched ? t(" · Просмотрено", " · Watched") : ""
      }${rateHint}${progHint}`;

      const barHtml =
        epProg && epProg.pct > 0 && !isWatched
          ? `<span class="atv-ep-pill-progress" style="width:${Math.min(100, epProg.pct)}%"></span>`
          : "";

      if (isGridMode) {
        epBtn.className = `atv-ep-card${isWatched ? " watched" : ""}${isActive ? " active" : ""}`;
        const metaRight = epRating?.score
          ? `${epRating.score}/10`
          : epMeta.airDate || (isWatched ? t("Просмотрено", "Watched") : "");
        const cardTitle = epMeta.realTitle || t(`Эпизод ${e}`, `Episode ${e}`);
        epBtn.innerHTML = `
          <div class="atv-ep-card-top">
            <span class="atv-ep-card-num">${isWatched ? iconSvg("check", 10) : ""}<span>${t(`Серия ${e}`, `Episode ${e}`)}</span></span>
            <span class="atv-ep-card-meta">${escapeHtml(metaRight)}</span>
          </div>
          <div class="atv-ep-card-title">${escapeHtml(cardTitle)}</div>
          ${barHtml}
        `;
      } else {
        epBtn.className = `atv-ep-pill${isWatched ? " watched" : ""}${isActive ? " active" : ""}`;
        epBtn.innerHTML = `<span class="atv-ep-pill-num">${e}</span>${barHtml}`;
      }

      epBtn.onmouseenter = () => {
        updateCurrentEpisodeBar(item, state.activeSeason, e, e !== state.activeEpisode);
        if (!isGridMode && hoverTipEl && epStripRow) {
          const rowRect = epStripRow.getBoundingClientRect();
          const btnRect = epBtn.getBoundingClientRect();
          const centerX = Math.max(
            90,
            Math.min(rowRect.width - 90, btnRect.left - rowRect.left + btnRect.width / 2)
          );
          const headLine = epMeta.realTitle
            ? isEn()
              ? `Episode ${e} · "${epMeta.realTitle}"`
              : `Серия ${e} · «${epMeta.realTitle}»`
            : t(`Серия ${e}`, `Episode ${e}`);
          const subLineParts = [];
          if (epMeta.airDate) subLineParts.push(epMeta.airDate);
          if (isWatched) subLineParts.push(t("Просмотрено", "Watched"));
          else if (epProg && epProg.pct > 0) subLineParts.push(`${epProg.pct}%`);
          if (epRating?.score) {
            subLineParts.push(t(`Оценка ${epRating.score}/10`, `Rating ${epRating.score}/10`));
          }
          hoverTipEl.innerHTML = `<strong>${escapeHtml(headLine)}</strong>${
            subLineParts.length
              ? `<span class="atv-ep-hover-tooltip-sub">${escapeHtml(subLineParts.join(" · "))}</span>`
              : ""
          }`;
          hoverTipEl.style.left = `${Math.round(centerX)}px`;
          hoverTipEl.classList.remove("hidden");
        }
      };
      epBtn.onclick = async () => {
        if (state.activeEpisode === e) return;
        if (hoverTipEl) hoverTipEl.classList.add("hidden");
        document.getElementById("kinorium-postwatch-overlay")?.classList.add("hidden");
        clearAutoplayNextTimer();
        state.autoplayCancelledThisEpisode = false;
        state.activeEpisode = e;
        populateSeasonEpisodeSelectors(item, resolvedMap);
        updateMiniPlayerTitle();
        const savedEpProg = getEpisodeProgress(item, state.activeSeason, e);
        const startSec =
          savedEpProg && savedEpProg.current_time > 10 && savedEpProg.pct < 92
            ? savedEpProg.current_time
            : 0;
        if (state.activeSourceTab === "stremio") {
          await loadStremioStreams(startSec);
        } else if (state.activeSourceTab === "backup4k") {
          await loadBackup4KReleases(startSec);
        } else {
          await loadHDRezkaStream(startSec);
        }
        await loadSkipIntroSegments();
      };
      epStripBar.appendChild(epBtn);
    });
    if (activePillEl && state.episodesStripExpanded) {
      requestAnimationFrame(() => {
        try {
          activePillEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        } catch (_) {}
      });
    }
  }

  const minSeason = seasonNumbers[0] || 1;
  const maxSeason = seasonNumbers[seasonNumbers.length - 1] || state.activeSeason;
  const minEpInSeason = seasonEps[0] || 1;
  const maxEpInSeason = seasonEps[seasonEps.length - 1] || state.activeEpisode;

  if (btnPrevEp) {
    btnPrevEp.disabled = state.activeSeason <= minSeason && state.activeEpisode <= minEpInSeason;
    btnPrevEp.title = t("Предыдущая серия (P)", "Previous episode (P)");
  }
  if (btnNextEp) {
    btnNextEp.disabled = state.activeSeason >= maxSeason && state.activeEpisode >= maxEpInSeason;
    const nextCoords = getNextEpisodeCoords();
    if (!btnNextEp.disabled && nextCoords) {
      const nextMeta = getEpisodeDisplayMeta(nextCoords.season, nextCoords.episode);
      const titleSuffix = nextMeta.realTitle
        ? isEn()
          ? ` — "${nextMeta.realTitle}"`
          : ` — «${nextMeta.realTitle}»`
        : "";
      btnNextEp.title = t(
        `Следующая серия: Сезон ${nextCoords.season}, Серия ${nextCoords.episode}${titleSuffix} (N)`,
        `Next episode: Season ${nextCoords.season}, Episode ${nextCoords.episode}${titleSuffix} (N)`
      );
    } else {
      btnNextEp.title = t("Следующая серия (N)", "Next episode (N)");
    }
  }

  if (seasonProgBox && seasonProgText && seasonProgFill) {
    if (isServiceEnabled("kinorium") && seasonEps.length > 0) {
      const watchedCount = seasonEps.filter((epNum) => isEpisodeWatched(item, state.activeSeason, epNum)).length;
      const totalCount = seasonEps.length;
      const pct = Math.min(100, Math.round((watchedCount / totalCount) * 100));
      const progMsg = isEn()
        ? `Watched ${watchedCount} of ${totalCount} ${totalCount === 1 ? "episode" : "episodes"}`
        : `Просмотрено ${watchedCount} из ${totalCount} ${genitiveAfterIz(
            totalCount,
            "серии",
            "серий"
          )}`;
      seasonProgText.textContent = progMsg;
      seasonProgFill.style.width = `${pct}%`;
      seasonProgBox.title = `${t(`Сезон ${state.activeSeason}`, `Season ${state.activeSeason}`)} · ${progMsg} (${pct}%)`;
      seasonProgBox.classList.remove("hidden");
    } else {
      seasonProgBox.classList.add("hidden");
    }
  }
  syncCustomVideoControlsUI();
}
export function syncEpisodesStripDrawerUI() {
  const isSeries = state.activeItem?.media_type === "series";
  const expanded = Boolean(isSeries && state.episodesStripExpanded);
  const epStripRow = document.getElementById("episodes-strip-row");
  const epStripBar = document.getElementById("episodes-strip-bar");
  const toggleBtn = document.getElementById("btn-toggle-episodes-strip");
  if (epStripRow) epStripRow.classList.toggle("hidden", !expanded);
  if (epStripBar) epStripBar.classList.toggle("hidden", !expanded);
  if (toggleBtn) {
    toggleBtn.classList.toggle("hidden", !isSeries);
    toggleBtn.classList.toggle("expanded", expanded);
    toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
  }
}
export function getNextEpisodeCoords() {
  if (!state.activeItem || state.activeItem.media_type !== "series") return null;
  const resolvedMap = resolveEffectiveSeasonsMap(state.activeItem, state.seasonsMap);
  if (resolvedMap) {
    const seasonNumbers = Object.keys(resolvedMap)
      .map((k) => parseInt(k, 10))
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const curSeasonEps = resolvedMap[String(state.activeSeason)] || [];
    const nextEpInCurSeason = curSeasonEps.find((ep) => ep > state.activeEpisode);
    if (nextEpInCurSeason) {
      return { season: state.activeSeason, episode: nextEpInCurSeason };
    }
    const nextSeason = seasonNumbers.find((s) => s > state.activeSeason && resolvedMap[String(s)]?.length > 0);
    if (nextSeason) {
      return { season: nextSeason, episode: resolvedMap[String(nextSeason)][0] };
    }
    return null;
  }

  // Fallback only if explicit seasons_count & episodes_per_season exist on curated item while stream metadata loads
  const explicitSeasons = Number(state.activeItem.seasons_count) || 0;
  const explicitEps = Number(state.activeItem.episodes_per_season) || 0;
  if (explicitSeasons > 0 && explicitEps > 0) {
    if (state.activeEpisode < explicitEps) {
      return { season: state.activeSeason, episode: state.activeEpisode + 1 };
    }
    if (state.activeSeason < explicitSeasons) {
      return { season: state.activeSeason + 1, episode: 1 };
    }
  }
  return null;
}
export function setSleepTimer(mode) {
  if (state.sleepTimerId) {
    clearInterval(state.sleepTimerId);
    state.sleepTimerId = null;
  }
  state.sleepTimerMode = mode || "off";
  state.sleepAtEpisodeEnd = mode === "episode_end";
  state.sleepTimerSecondsLeft = 0;

  const groupEl = document.getElementById("sleep-timer-group");
  const selectEl = document.getElementById("select-sleep-timer");
  if (selectEl && selectEl.value !== state.sleepTimerMode) {
    selectEl.value = state.sleepTimerMode;
  }
  if (groupEl) {
    groupEl.classList.toggle("sleep-active", state.sleepTimerMode !== "off");
  }
  updatePlayerGearActiveDot();

  if (state.sleepTimerMode === "off") {
    return;
  }
  if (state.sleepTimerMode === "episode_end") {
    showToast(
      t(
        "Таймер сна: воспроизведение остановится в конце текущей серии",
        "Sleep timer: playback will stop at the end of the current episode"
      )
    );
    return;
  }

  const minutes = parseInt(state.sleepTimerMode, 10) || 0;
  if (minutes <= 0) return;
  state.sleepTimerSecondsLeft = minutes * 60;
  showToast(
    isEn()
      ? `Sleep timer set for ${minutes} ${minutes === 1 ? "minute" : "minutes"}`
      : `Таймер сна запущен на ${minutes} ${pluralRu(minutes, "минуту", "минуты", "минут")}`
  );

  state.sleepTimerId = setInterval(() => {
    state.sleepTimerSecondsLeft -= 1;
    if (state.sleepTimerSecondsLeft <= 0) {
      clearInterval(state.sleepTimerId);
      state.sleepTimerId = null;
      state.sleepTimerMode = "off";
      state.sleepAtEpisodeEnd = false;
      if (selectEl) selectEl.value = "off";
      if (groupEl) groupEl.classList.remove("sleep-active");
      updatePlayerGearActiveDot();
      const video = document.getElementById("native-video");
      if (video && !video.paused) {
        video.pause();
      }
      clearAutoplayNextTimer();
      showToast(
        t(
          "Таймер сна сработал — воспроизведение поставлено на паузу",
          "Sleep timer reached — playback paused"
        )
      );
    }
  }, 1000);
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

  if (video.hasAttribute("crossorigin") && video.videoWidth > 0 && video.videoHeight > 0) {
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
export function clearAutoplayNextTimer() {
  if (state.autoplayTimerId) {
    clearInterval(state.autoplayTimerId);
    state.autoplayTimerId = null;
  }
  state.autoplaySecondsLeft = 0;
  const card = document.getElementById("autoplay-next-card");
  if (card) card.classList.add("hidden");
}
export function isPostwatchCardPausingAutoplay() {
  const overlay = document.getElementById("kinorium-postwatch-overlay");
  if (!overlay || overlay.classList.contains("hidden")) return false;
  if (state.postwatchManual || state.postwatchHovered) return true;
  const activeEl = document.activeElement;
  if (activeEl && overlay.contains(activeEl)) return true;
  return false;
}
export function startAutoplayNextCountdown() {
  clearAutoplayNextTimer();
  if (state.sleepAtEpisodeEnd) {
    setSleepTimer("off");
    const video = document.getElementById("native-video");
    if (video && !video.paused) video.pause();
    showToast(
      t(
        "Таймер сна («Конец серии»): автопереход остановлен",
        'Sleep timer ("End of episode"): auto-play stopped'
      )
    );
    return;
  }
  if (!state.isPlayerOpen || !state.autoNextEpisode || state.autoplayCancelledThisEpisode) return;
  const nextCoords = getNextEpisodeCoords();
  if (!nextCoords) return;

  const card = document.getElementById("autoplay-next-card");
  const textEl = document.getElementById("autoplay-next-text");
  if (!card || !textEl) return;

  const postwatchOpen = !document.getElementById("kinorium-postwatch-overlay")?.classList.contains("hidden");
  state.autoplaySecondsLeft = postwatchOpen ? 7 : 5;
  const nextEpMeta = getEpisodeDisplayMeta(nextCoords.season, nextCoords.episode);
  const nextEpTitleSuffix = nextEpMeta.realTitle
    ? isEn()
      ? ` "${nextEpMeta.realTitle}"`
      : ` «${nextEpMeta.realTitle}»`
    : "";
  const updateLabel = (paused = false) => {
    if (isEn()) {
      const pauseNote = paused ? " (paused)" : "";
      textEl.textContent = `Next episode · Season ${nextCoords.season}, Episode ${nextCoords.episode}${nextEpTitleSuffix} — in ${
        state.autoplaySecondsLeft
      } ${state.autoplaySecondsLeft === 1 ? "second" : "seconds"}${pauseNote}`;
      return;
    }
    const pauseNote = paused ? " (на паузе)" : "";
    textEl.textContent = `Следующая серия · Сезон ${nextCoords.season}, Серия ${
      nextCoords.episode
    }${nextEpTitleSuffix} — через ${state.autoplaySecondsLeft} ${pluralRu(
      state.autoplaySecondsLeft,
      "секунду",
      "секунды",
      "секунд"
    )}${pauseNote}`;
  };
  updateLabel(isPostwatchCardPausingAutoplay());
  card.classList.remove("hidden");
  document.getElementById("skip-outro-btn")?.classList.add("hidden");

  state.autoplayTimerId = setInterval(async () => {
    if (!state.isPlayerOpen || !state.autoNextEpisode) {
      clearAutoplayNextTimer();
      return;
    }
    if (isPostwatchCardPausingAutoplay()) {
      updateLabel(true);
      return;
    }
    state.autoplaySecondsLeft -= 1;
    if (state.autoplaySecondsLeft <= 0) {
      clearAutoplayNextTimer();
      await stepEpisode(1);
    } else {
      updateLabel(false);
    }
  }, 1000);
}
export async function stepEpisode(delta) {
  if (!state.activeItem || state.activeItem.media_type !== "series") return;
  clearAutoplayNextTimer();
  state.autoplayCancelledThisEpisode = false;
  const resolvedMap = resolveEffectiveSeasonsMap(state.activeItem, state.seasonsMap);
  const mapKeys = resolvedMap
    ? Object.keys(resolvedMap)
        .map((k) => parseInt(k, 10))
        .filter((n) => n > 0)
        .sort((a, b) => a - b)
    : [];
  const fallbackSeasonsCount = Math.max(state.activeSeason || 1, Number(state.activeItem.seasons_count) || 1);
  const seasonNumbers =
    mapKeys.length > 0
      ? mapKeys
      : Array.from({ length: fallbackSeasonsCount }, (_, idx) => idx + 1);

  const fallbackEpsCount = Math.max(state.activeEpisode || 1, Number(state.activeItem.episodes_per_season) || 1);
  const curSeasonEps =
    resolvedMap && resolvedMap[String(state.activeSeason)] && resolvedMap[String(state.activeSeason)].length > 0
      ? resolvedMap[String(state.activeSeason)]
      : Array.from({ length: fallbackEpsCount }, (_, idx) => idx + 1);

  const epIdx = curSeasonEps.indexOf(state.activeEpisode);
  const seasonIdx = seasonNumbers.indexOf(state.activeSeason);

  if (delta > 0) {
    if (epIdx >= 0 && epIdx + 1 < curSeasonEps.length) {
      state.activeEpisode = curSeasonEps[epIdx + 1];
    } else if (seasonIdx >= 0 && seasonIdx + 1 < seasonNumbers.length) {
      state.activeSeason = seasonNumbers[seasonIdx + 1];
      const nextSeasonEps = resolvedMap?.[String(state.activeSeason)];
      state.activeEpisode = Array.isArray(nextSeasonEps) && nextSeasonEps.length > 0 ? nextSeasonEps[0] : 1;
    } else {
      return;
    }
  } else if (delta < 0) {
    if (epIdx > 0) {
      state.activeEpisode = curSeasonEps[epIdx - 1];
    } else if (seasonIdx > 0) {
      state.activeSeason = seasonNumbers[seasonIdx - 1];
      const prevSeasonEps = resolvedMap?.[String(state.activeSeason)];
      state.activeEpisode =
        Array.isArray(prevSeasonEps) && prevSeasonEps.length > 0
          ? prevSeasonEps[prevSeasonEps.length - 1]
          : Math.max(1, Number(state.activeItem.episodes_per_season) || 1);
    } else {
      return;
    }
  }

  populateSeasonEpisodeSelectors(state.activeItem, state.seasonsMap);
  updateMiniPlayerTitle();
  syncMediaSessionMetadata();
  document.getElementById("skip-outro-btn")?.classList.add("hidden");
  document.getElementById("kinorium-postwatch-overlay")?.classList.add("hidden");
  state.postwatchManual = false;
  const curEpMeta = getEpisodeDisplayMeta(state.activeSeason, state.activeEpisode);
  showToast(
    curEpMeta.realTitle
      ? isEn()
        ? `Season ${state.activeSeason}, Episode ${state.activeEpisode} — "${curEpMeta.realTitle}"`
        : `Сезон ${state.activeSeason}, Серия ${state.activeEpisode} — «${curEpMeta.realTitle}»`
      : t(
          `Сезон ${state.activeSeason}, Серия ${state.activeEpisode}`,
          `Season ${state.activeSeason}, Episode ${state.activeEpisode}`
        )
  );
  const savedEpProg = getEpisodeProgress(state.activeItem, state.activeSeason, state.activeEpisode);
  const startSec =
    savedEpProg && savedEpProg.current_time > 10 && savedEpProg.pct < 92
      ? savedEpProg.current_time
      : 0;
  if (state.activeSourceTab === "stremio") {
    await loadStremioStreams(startSec);
  } else if (state.activeSourceTab === "backup4k") {
    await loadBackup4KReleases(startSec);
  } else {
    await loadHDRezkaStream(startSec);
  }
  await loadSkipIntroSegments();
}
export function syncMediaSessionMetadata() {
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
export function toggleVideoPlayPause(showCenterPulse = false) {
  if (!state.isPlayerOpen) return;

  // Support Play/Pause on YouTube trailer iframe when Mini-Player is active on Trailer tab
  if (state.activeSourceTab === "trailer") {
    const iframe = document.querySelector("#trailer-stage-box iframe");
    if (iframe && iframe.contentWindow) {
      const nextPlaying = state.trailerPlaying === false;
      state.trailerPlaying = nextPlaying;
      try {
        iframe.contentWindow.postMessage(
          JSON.stringify({
            event: "command",
            func: nextPlaying ? "playVideo" : "pauseVideo",
            args: [],
          }),
          "*"
        );
      } catch (_) {}
      const miniBtn = document.getElementById("btn-mini-play-pause");
      if (miniBtn) {
        miniBtn.innerHTML = iconSvg(nextPlaying ? "pause" : "play", 12);
      }
    }
    return;
  }

  const video = document.getElementById("native-video");
  if (!video) return;

  if (state.audioCtx && state.audioCtx.state === "suspended") {
    state.audioCtx.resume().catch(() => {});
  }

  if (video.paused || video.ended) {
    state.pipWasPlayingRecently = true;
    if (!video.getAttribute("src") && !state.hlsInstance && state.currentStreamUrl) {
      playVideoUrl(state.currentStreamUrl, 0, state.playerSessionId, {
        keepRemuxMeta: Boolean(state.remuxMeta?.active),
      });
    } else {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((err) => {
          if (err && (err.name === "NotAllowedError" || String(err).includes("NotAllowed"))) {
            state.internalMuteOverride = true;
            video.muted = true;
            state.internalMuteOverride = false;
            video.play().catch(() => {});
          }
        });
      }
    }
    document.getElementById("btn-mini-play-pause")?.replaceChildren();
    const miniBtn = document.getElementById("btn-mini-play-pause");
    if (miniBtn) miniBtn.innerHTML = iconSvg("pause", 12);
    syncPipDockUI();
    syncCustomVideoControlsUI(true);
    if (showCenterPulse && !state.isMiniPlayer && !state.isPipBackground) {
      triggerVideoCenterIndicator("play");
    }
  } else {
    state.pipWasPlayingRecently = false;
    video.pause();
    const miniBtn = document.getElementById("btn-mini-play-pause");
    if (miniBtn) miniBtn.innerHTML = iconSvg("play", 12);
    syncPipDockUI();
    syncCustomVideoControlsUI(true);
    if (showCenterPulse && !state.isMiniPlayer && !state.isPipBackground) {
      triggerVideoCenterIndicator("pause");
    }
  }
}
export function syncPipDockUI() {
  const video = document.getElementById("native-video");
  const pipActive = isVideoInPiP(video);
  const stageNotice = document.getElementById("video-pip-placeholder");
  if (stageNotice) {
    stageNotice.classList.toggle(
      "hidden",
      !(pipActive && state.isPlayerOpen && !state.isPipBackground && !state.isMiniPlayer)
    );
  }
  const pipBtn = document.getElementById("vc-btn-pip");
  if (pipBtn) {
    pipBtn.classList.toggle("hidden", !supportsNativePiP());
    pipBtn.classList.toggle("active-pip", pipActive);
  }
  document.getElementById("btn-toggle-mini-player")?.classList.toggle("active", Boolean(state.isMiniPlayer));

  const dock = document.getElementById("pip-status-dock");
  if (dock) {
    dock.classList.toggle("hidden", !(state.isPlayerOpen && state.isPipBackground));
  }
  const dockTitle = document.getElementById("pip-dock-title");
  const dockNextBtn = document.getElementById("btn-pip-dock-next-ep");
  const dockPlayBtn = document.getElementById("btn-pip-dock-play");
  if (state.activeItem && dockTitle) {
    const isSeries = state.activeItem.media_type === "series";
    const hasNextEp = isSeries && Boolean(getNextEpisodeCoords());
    const epSuffix = isSeries
      ? t(
          ` · Сезон ${state.activeSeason}, Серия ${state.activeEpisode}`,
          ` · S${state.activeSeason} E${state.activeEpisode}`
        )
      : "";
    dockTitle.textContent = `${displayTitle(state.activeItem)}${epSuffix}`;
    if (dockNextBtn) {
      dockNextBtn.classList.toggle("hidden", !hasNextEp);
    }
  }
  if (dockPlayBtn && video) {
    dockPlayBtn.innerHTML = iconSvg(video.paused ? "play" : "pause", 12);
  }
}
export function setPipBackgroundMode(active) {
  const next = Boolean(active);
  const wasBackground = state.isPipBackground;
  state.isPipBackground = next;
  const modal = document.getElementById("player-modal");
  if (next) {
    if (state.isMiniPlayer) {
      setMiniPlayerMode(false);
    }
    closeAllVcPopovers();
    document.getElementById("player-gear-popover")?.classList.add("hidden");
    document.getElementById("btn-player-gear")?.classList.remove("active");
    document.getElementById("kinorium-status-popover")?.classList.add("hidden");
    document.getElementById("kinorium-postwatch-overlay")?.classList.add("hidden");
    if (modal) {
      modal.classList.remove("hidden");
      modal.classList.add("pip-background-mode");
    }
    if (!wasBackground) {
      loadCatalog();
    }
  } else {
    if (modal) {
      modal.classList.remove("pip-background-mode");
      if (state.isPlayerOpen) {
        modal.classList.remove("hidden");
      }
    }
    if (state.isPlayerOpen && !state.hasPlayerHistoryEntry) {
      try {
        window.history.pushState({ cineflowPlayerModal: true }, "");
        state.hasPlayerHistoryEntry = true;
      } catch (_) {}
    }
    if (state.isPlayerOpen && state.ambilightEnabled) {
      startAmbilightLoop();
    }
  }
  syncPipDockUI();
  syncScrollTopButton();
}
export async function restoreFullPlayerFromPip() {
  const video = document.getElementById("native-video");
  const shouldKeepPlaying = Boolean(video && (!video.paused || state.pipWasPlayingRecently));
  state.isRestoringFromPip = true;
  setPipBackgroundMode(false);
  setMiniPlayerMode(false);
  if (video && isVideoInPiP(video)) {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (
        typeof video.webkitSetPresentationMode === "function" &&
        video.webkitPresentationMode === "picture-in-picture"
      ) {
        video.webkitSetPresentationMode("inline");
      }
    } catch (_) {}
  }
  syncPipDockUI();
  if (video && shouldKeepPlaying && video.paused) {
    video.play().catch(() => {});
  }
  setTimeout(() => {
    state.isRestoringFromPip = false;
    if (video && shouldKeepPlaying && video.paused && state.isPlayerOpen) {
      video.play().catch(() => {});
    }
    syncPipDockUI();
  }, 220);
}
export function updateMiniPlayerTitle() {
  const titleEl = document.getElementById("mini-player-title");
  const nextEpBtn = document.getElementById("btn-mini-next-ep");
  syncPipDockUI();
  if (!titleEl || !state.activeItem) return;
  const isSeries = state.activeItem.media_type === "series";
  const hasNextEp = isSeries && Boolean(getNextEpisodeCoords());
  const epSuffix = isSeries
    ? t(
        ` · Сезон ${state.activeSeason}, Серия ${state.activeEpisode}`,
        ` · S${state.activeSeason} E${state.activeEpisode}`
      )
    : "";
  titleEl.textContent = `${displayTitle(state.activeItem)}${epSuffix}`;
  if (nextEpBtn) {
    nextEpBtn.classList.toggle("hidden", !hasNextEp);
  }
}
export function setMiniPlayerMode(isMini) {
  const nextMini = Boolean(isMini);
  const video = document.getElementById("native-video");
  if (nextMini) {
    if (state.isPipBackground) {
      state.isPipBackground = false;
      document.getElementById("player-modal")?.classList.remove("pip-background-mode");
    }
    if (video && isVideoInPiP(video)) {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
      } else if (
        typeof video.webkitSetPresentationMode === "function" &&
        video.webkitPresentationMode === "picture-in-picture"
      ) {
        try {
          video.webkitSetPresentationMode("inline");
        } catch (_) {}
      }
    }
  }
  state.isMiniPlayer = nextMini;
  const modal = document.getElementById("player-modal");
  const sheet = modal?.querySelector(".atv-cinema-sheet");
  const miniBar = document.getElementById("mini-player-bar");
  if (modal) {
    modal.classList.toggle("mini-player-mode", state.isMiniPlayer);
  }
  if (miniBar) {
    miniBar.classList.toggle("hidden", !state.isMiniPlayer);
  }
  syncScrollTopButton();
  if (state.isMiniPlayer) {
    closeAllVcPopovers();
    document.getElementById("player-gear-popover")?.classList.add("hidden");
    document.getElementById("btn-player-gear")?.classList.remove("active");
    document.getElementById("kinorium-status-popover")?.classList.add("hidden");
    document.getElementById("kinorium-postwatch-overlay")?.classList.add("hidden");
    updateMiniPlayerTitle();
    const playPauseBtn = document.getElementById("btn-mini-play-pause");
    if (playPauseBtn) {
      const isPaused =
        state.activeSourceTab === "trailer"
          ? state.trailerPlaying === false
          : Boolean(!video || video.paused);
      playPauseBtn.innerHTML = iconSvg(isPaused ? "play" : "pause", 12);
    }
  } else if (sheet) {
    sheet.style.position = "";
    sheet.style.left = "";
    sheet.style.top = "";
    sheet.style.right = "";
    sheet.style.bottom = "";
  }
  syncPipDockUI();
}
export function resolveSeriesCompletedFlag(item) {
  if (!item || item.media_type !== "series") return null;
  if (typeof item.is_series_completed === "boolean") return item.is_series_completed;
  const live =
    (item.id && state.liveSeriesUpdates?.[item.id]) ||
    (item.kinorium?.kinorium_id && state.liveSeriesUpdates?.[`kin_${item.kinorium.kinorium_id}`]) ||
    (item.title && state.liveSeriesUpdates?.[item.title.trim().toLowerCase()]) ||
    null;
  if (live && typeof live.is_completed === "boolean") return live.is_completed;
  if (typeof item.kinorium?.is_completed === "boolean") return item.kinorium.is_completed;
  return null;
}
export async function markEpisodesBatch(mode = "upto") {
  if (!state.activeItem || state.activeItem.media_type !== "series") return;
  const item = state.activeItem;
  const resolvedMap = resolveEffectiveSeasonsMap(item, state.seasonsMap);
  const sKeys = Object.keys(resolvedMap || {})
    .map((k) => parseInt(k, 10))
    .filter((n) => !Number.isNaN(n));
  const totalSeasons = sKeys.length > 0 ? Math.max(...sKeys) : 0;
  const fallbackCount = Math.max(state.activeEpisode || 1, Number(item.episodes_per_season) || 1);
  const seasonEps =
    resolvedMap && Array.isArray(resolvedMap[String(state.activeSeason)]) && resolvedMap[String(state.activeSeason)].length > 0
      ? resolvedMap[String(state.activeSeason)]
      : Array.from({ length: fallbackCount }, (_, idx) => idx + 1);
  const totalEpsInSeason = seasonEps.length > 0 ? Math.max(...seasonEps) : 0;
  const targetEps =
    mode === "season"
      ? seasonEps
      : seasonEps.filter((e) => e <= state.activeEpisode);
  if (targetEps.length === 0) return;

  try {
    const res = await fetch("/api/kinorium/watched-episodes-batch", {
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
        season: state.activeSeason,
        episodes: targetEps,
        mark_season_complete: mode === "season",
        total_seasons: totalSeasons,
        total_episodes_in_season: totalEpsInSeason,
        is_series_completed: resolveSeriesCompletedFlag(item),
      }),
    });
    const kStatus = await res.json();
    item.kinorium = kStatus;
    state.catalogDirty = true;
    if (kStatus.kinorium_counts) {
      state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
      updateKinoriumSectionCounters();
    }
    updateModalKinoriumHeader(kStatus);
    populateSeasonEpisodeSelectors(item, state.seasonsMap);
    updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);
    const kinSuffix = kStatus.remote_synced ? t(" в Kinorium", " on Kinorium") : "";
    if (kStatus.auto_completed_series) {
      state.scrobbledThisSession = true;
      refreshOpenPersonModalUI();
      showToast(
        t(
          `Финал сериала «${displayTitle(item)}» просмотрен — статус изменён с «Смотрю» на «Просмотрено»${kinSuffix}`,
          `Series finale of "${displayTitle(item)}" watched — status changed to Watched${kinSuffix}`
        )
      );
    } else {
      showToast(
        mode === "season"
          ? isEn()
            ? `Season ${state.activeSeason} marked as watched${kinSuffix} (${targetEps.length} ${
                targetEps.length === 1 ? "episode" : "episodes"
              })`
            : `Сезон ${state.activeSeason} отмечен просмотренным${kinSuffix} (${targetEps.length} ${pluralRu(
                targetEps.length,
                "серия",
                "серии",
                "серий"
              )})`
          : t(
              `Отмечены просмотренными${kinSuffix} серии с 1 по ${state.activeEpisode} (Сезон ${state.activeSeason})`,
              `Episodes 1–${state.activeEpisode} (Season ${state.activeSeason}) marked as watched${kinSuffix}`
            )
      );
    }
  } catch (err) {
    showToast(t("Не удалось выполнить пакетную отметку серий", "Could not mark episodes in batch"));
  }
}
export async function toggleCurrentEpisodeWatched() {
  if (!state.activeItem || state.activeItem.media_type !== "series") return;
  const item = state.activeItem;
  const sNum = Number(state.activeSeason) || 1;
  const eNum = Number(state.activeEpisode) || 1;
  const resolvedMap = resolveEffectiveSeasonsMap(item, state.seasonsMap);
  const sKeys = Object.keys(resolvedMap || {})
    .map((k) => parseInt(k, 10))
    .filter((n) => !Number.isNaN(n));
  const totalSeasons = sKeys.length > 0 ? Math.max(...sKeys) : 0;
  const seasonEps = resolvedMap?.[String(sNum)];
  const totalEpsInSeason = Array.isArray(seasonEps) && seasonEps.length > 0 ? Math.max(...seasonEps) : 0;

  try {
    const res = await fetch("/api/kinorium/episode-watched", {
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
        season: sNum,
        episode: eNum,
        total_seasons: totalSeasons,
        total_episodes_in_season: totalEpsInSeason,
        is_series_completed: resolveSeriesCompletedFlag(item),
      }),
    });
    const kStatus = await res.json();
    item.kinorium = kStatus;
    state.catalogDirty = true;
    if (kStatus.kinorium_counts) {
      state.kinoriumCounts = { ...state.kinoriumCounts, ...kStatus.kinorium_counts };
      updateKinoriumSectionCounters();
    }
    updateModalKinoriumHeader(kStatus);
    populateSeasonEpisodeSelectors(item, state.seasonsMap);
    updateCurrentEpisodeBar(item, sNum, eNum, false);
    const kinSuffix = kStatus.remote_synced ? t(" в Kinorium", " on Kinorium") : "";
    if (kStatus.auto_completed_series) {
      state.scrobbledThisSession = true;
      refreshOpenPersonModalUI();
      showToast(
        t(
          `Финал сериала «${displayTitle(item)}» просмотрен — статус изменён на «Просмотрено»${kinSuffix}`,
          `Series finale of "${displayTitle(item)}" watched — marked as Watched${kinSuffix}`
        )
      );
    } else if (kStatus.episode_watched) {
      showToast(
        t(
          `Сезон ${sNum}, Серия ${eNum} отмечена просмотренной${kinSuffix}`,
          `Season ${sNum}, Episode ${eNum} marked as watched${kinSuffix}`
        )
      );
    } else {
      showToast(
        t(
          `Отметка просмотра снята${kinSuffix} · Сезон ${sNum}, Серия ${eNum}`,
          `Unmarked as watched${kinSuffix} · Season ${sNum}, Episode ${eNum}`
        )
      );
    }
  } catch (err) {
    showToast(t("Не удалось изменить отметку серии", "Could not update episode watched status"));
  }
}
export function populateSubtitlesSelector(subtitles) {
  const subGroup = document.getElementById("subtitle-group");
  const subSel = document.getElementById("select-subtitle");
  if (!subGroup || !subSel) return;

  if (!subtitles || subtitles.length === 0) {
    subGroup.classList.add("hidden");
    subSel.innerHTML = "";
    syncCustomControlPopovers();
    return;
  }

  subGroup.classList.remove("hidden");
  subSel.innerHTML = `<option value="-1">${t("Выключены", "Off")}</option>`;
  subtitles.forEach((sub, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = sub.lang || t(`Субтитры #${idx + 1}`, `Subtitles #${idx + 1}`);
    if (idx === state.activeSubtitleIndex) opt.selected = true;
    subSel.appendChild(opt);
  });
  syncCustomControlPopovers();
}
function parseVttTimeSec(hStr, mStr, sStr, msStr) {
  const h = hStr ? parseInt(hStr, 10) || 0 : 0;
  const m = parseInt(mStr, 10) || 0;
  const s = parseInt(sStr, 10) || 0;
  const rawMs = String(msStr || "0").padEnd(3, "0").slice(0, 3);
  const ms = parseInt(rawMs, 10) || 0;
  return h * 3600 + m * 60 + s + ms / 1000;
}
function cleanCuePayloadText(rawCueBody) {
  if (!rawCueBody) return "";
  return String(rawCueBody)
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, "")
    .replace(/<\/?(?:v|c|b|i|u|font|ruby|rt)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .split("\n")
    .map((ln) => ln.trim())
    .filter(Boolean)
    .join("\n");
}
export function parseSubtitleCues(rawText) {
  if (!rawText) return [];
  const norm = String(rawText).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = norm.split(/\n{2,}/);
  const cues = [];
  const timeRe =
    /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split("\n").map((l) => l.trim());
    if (!lines.length) continue;
    if (/^(?:WEBVTT|NOTE|STYLE|REGION)\b/i.test(lines[0])) continue;
    let timeLineIdx = -1;
    let match = null;
    for (let j = 0; j < Math.min(3, lines.length); j++) {
      const m = lines[j].match(timeRe);
      if (m) {
        timeLineIdx = j;
        match = m;
        break;
      }
    }
    if (timeLineIdx < 0 || !match) continue;
    const startSec = parseVttTimeSec(match[1], match[2], match[3], match[4]);
    const endSec = parseVttTimeSec(match[5], match[6], match[7], match[8]);
    if (!(endSec > startSec)) continue;
    const text = cleanCuePayloadText(lines.slice(timeLineIdx + 1).join("\n"));
    if (!text) continue;
    cues.push({ start: startSec, end: endSec, text });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}
export function clearCustomSubtitleOverlay(keepLoadedCache = false) {
  if (!keepLoadedCache) {
    if (state.subFetchAbortController) {
      try {
        state.subFetchAbortController.abort();
      } catch (_) {}
      state.subFetchAbortController = null;
    }
    state.subFetchReqId = (state.subFetchReqId || 0) + 1;
    state.activeSubCues = [];
    state.activeSubTrackMeta = null;
    state.loadedSubUrl = "";
    state.subWindowAdvancing = false;
  }
  state.lastRenderedSubCueText = "";
  const overlay = document.getElementById("atv-subtitle-overlay");
  if (overlay) {
    overlay.innerHTML = "";
    overlay.classList.add("hidden");
  }
}
function advanceWindowedSubtitleIfNeeded(subMeta, curSec) {
  if (
    !subMeta ||
    !subMeta.isWindowedEmbedded ||
    !subMeta.rawSourceUrl ||
    state.subWindowAdvancing
  ) {
    return;
  }
  const winStart = Number(subMeta.windowStartSec) || 0;
  const winDur = Number(subMeta.windowDurSec) || 420;
  const relPos = curSec - winStart;
  if (relPos < winDur - 38 && relPos >= -2) return;

  const nextStart = Math.max(0, Math.floor(curSec - 4));
  if (Math.abs(nextStart - winStart) < 15) return;

  state.subWindowAdvancing = true;
  const qs = new URLSearchParams({
    src: subMeta.rawSourceUrl,
    si: String(subMeta.streamIndex),
    ss: String(nextStart),
    dur: String(winDur),
  });
  const nextUrl = `/api/remux-subtitle?${qs.toString()}`;
  const reqToken = state.subFetchReqId;
  fetch(nextUrl)
    .then((r) => (r.ok ? r.text() : ""))
    .then((txt) => {
      if (!state.isPlayerOpen || state.subFetchReqId !== reqToken) return;
      const parsed = parseSubtitleCues(txt);
      subMeta.windowStartSec = nextStart;
      subMeta.url = nextUrl;
      state.loadedSubUrl = nextUrl;
      state.activeSubCues = parsed;
      updateCustomSubtitleOverlay();
    })
    .catch(() => {})
    .finally(() => {
      state.subWindowAdvancing = false;
    });
}
export function updateCustomSubtitleOverlay(video = document.getElementById("native-video")) {
  const overlay = document.getElementById("atv-subtitle-overlay");
  if (!overlay) return;
  if (
    !video ||
    !state.isPlayerOpen ||
    state.activeSourceTab === "trailer" ||
    state.activeSubtitleIndex < 0 ||
    !Array.isArray(state.activeSubCues) ||
    state.activeSubCues.length === 0
  ) {
    if (state.lastRenderedSubCueText !== "") {
      state.lastRenderedSubCueText = "";
      overlay.innerHTML = "";
      overlay.classList.add("hidden");
    }
    return;
  }

  const { cur } = getEffectivePlaybackTiming(video);
  const trackMeta = state.activeSubTrackMeta;
  let cueLookupSec = cur;
  if (trackMeta?.isWindowedEmbedded) {
    cueLookupSec = Math.max(0, cur - (Number(trackMeta.windowStartSec) || 0));
    advanceWindowedSubtitleIfNeeded(trackMeta, cur);
  }

  const cues = state.activeSubCues;
  const activeLines = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.start > cueLookupSec + 0.08) break;
    if (cueLookupSec >= c.start - 0.06 && cueLookupSec <= c.end + 0.06) {
      activeLines.push(c.text);
    }
  }
  const combined = activeLines.join("\n").trim();
  if (combined === state.lastRenderedSubCueText) return;
  state.lastRenderedSubCueText = combined;

  if (!combined) {
    overlay.innerHTML = "";
    overlay.classList.add("hidden");
    return;
  }
  const htmlLines = combined
    .split("\n")
    .map((ln) => escapeHtml(ln))
    .join("<br/>");
  overlay.innerHTML = `<span class="atv-subtitle-cue-line">${htmlLines}</span>`;
  overlay.classList.remove("hidden");
}
export function syncIosFullscreenNativeSubtitles(videoEl = null) {
  const video = videoEl || document.getElementById("native-video");
  if (!video) return;
  const inNativeIosFs = Boolean(video.webkitDisplayingFullscreen);
  if (!inNativeIosFs) {
    if (video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        try {
          video.textTracks[i].mode = "disabled";
        } catch (_) {}
      }
    }
    updateCustomSubtitleOverlay(video);
    return;
  }

  const cues = Array.isArray(state.activeSubCues) ? state.activeSubCues : [];
  const sub =
    state.activeSubtitleIndex >= 0 ? (state.subtitles || [])[state.activeSubtitleIndex] : null;
  if (!sub || !cues.length || typeof window.VTTCue !== "function") {
    if (video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        try {
          video.textTracks[i].mode = "disabled";
        } catch (_) {}
      }
    }
    return;
  }

  const offset = state.remuxMeta?.active ? Number(state.remuxMeta.offsetSec) || 0 : 0;
  let targetTrack = null;
  if (video.textTracks) {
    for (let i = 0; i < video.textTracks.length; i++) {
      if (video.textTracks[i].label === "CineFlow Native FS") {
        targetTrack = video.textTracks[i];
      } else {
        try {
          video.textTracks[i].mode = "disabled";
        } catch (_) {}
      }
    }
  }
  if (!targetTrack && typeof video.addTextTrack === "function") {
    targetTrack = video.addTextTrack("subtitles", "CineFlow Native FS", "en");
  }
  if (!targetTrack) return;

  try {
    while (targetTrack.cues && targetTrack.cues.length > 0) {
      targetTrack.removeCue(targetTrack.cues[0]);
    }
  } catch (_) {}

  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const s = c.start - offset;
    const e = c.end - offset;
    if (e <= 0 || e <= s) continue;
    try {
      targetTrack.addCue(new window.VTTCue(Math.max(0, s), e, c.text));
    } catch (_) {}
  }
  try {
    targetTrack.mode = "showing";
  } catch (_) {}
  document.getElementById("atv-subtitle-overlay")?.classList.add("hidden");
}
export function syncDownloadButtonVisibility() {
  const dlBtn = document.getElementById("btn-download-stream");
  if (!dlBtn) return;
  const tab = state.activeSourceTab;
  if (tab === "hdrezka") {
    dlBtn.classList.remove("hidden");
    return;
  }
  if (tab === "stremio" || tab === "backup4k") {
    const hasDownloadable = Boolean(
      (state.remuxMeta?.active && state.remuxMeta.rawSourceUrl) ||
        (/^https?:\/\//i.test(state.currentStreamUrl || "") &&
          !String(state.currentStreamUrl || "").includes(".m3u8"))
    );
    dlBtn.classList.toggle("hidden", !hasDownloadable);
    return;
  }
  dlBtn.classList.add("hidden");
}
export function activateSelectedSubtitleTrack() {
  const video = document.getElementById("native-video");
  if (video) {
    video.querySelectorAll("track").forEach((tr) => tr.remove());
    if (video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        try {
          video.textTracks[i].mode = "disabled";
        } catch (_) {}
      }
    }
  }

  const sub =
    state.activeSubtitleIndex >= 0 ? (state.subtitles || [])[state.activeSubtitleIndex] : null;
  if (!sub || !sub.url || !state.isPlayerOpen) {
    clearCustomSubtitleOverlay(false);
    syncIosFullscreenNativeSubtitles(video);
    return;
  }

  const fetchUrl =
    sub.direct_vtt || String(sub.url).startsWith("/")
      ? sub.url
      : `/api/proxy-vtt?url=${encodeURIComponent(sub.url)}`;

  if (
    state.loadedSubUrl === fetchUrl &&
    Array.isArray(state.activeSubCues) &&
    state.activeSubCues.length > 0
  ) {
    state.activeSubTrackMeta = sub;
    if (video?.webkitDisplayingFullscreen) {
      syncIosFullscreenNativeSubtitles(video);
    } else {
      updateCustomSubtitleOverlay(video);
    }
    return;
  }

  if (state.subFetchAbortController) {
    try {
      state.subFetchAbortController.abort();
    } catch (_) {}
  }
  const subAbort = new AbortController();
  state.subFetchAbortController = subAbort;
  state.subFetchReqId = (state.subFetchReqId || 0) + 1;
  const reqId = state.subFetchReqId;
  state.activeSubTrackMeta = sub;
  clearCustomSubtitleOverlay(true);

  fetch(fetchUrl, { signal: subAbort.signal })
    .then((r) => (r.ok ? r.text() : ""))
    .then((rawVtt) => {
      if (!state.isPlayerOpen || reqId !== state.subFetchReqId) return;
      const parsedCues = parseSubtitleCues(rawVtt);
      state.loadedSubUrl = fetchUrl;
      state.activeSubCues = parsedCues;
      state.activeSubTrackMeta = sub;
      const curVid = document.getElementById("native-video");
      if (curVid?.webkitDisplayingFullscreen) {
        syncIosFullscreenNativeSubtitles(curVid);
      } else {
        updateCustomSubtitleOverlay(curVid);
      }
    })
    .catch((err) => {
      if (err && err.name === "AbortError") return;
    });
}
export function attachVideoSubtitles() {
  activateSelectedSubtitleTrack();
}
export function abortActiveVideoListeners() {
  state.videoLoadToken = (state.videoLoadToken || 0) + 1;
  if (state.videoLoadAbort) {
    try {
      state.videoLoadAbort.abort();
    } catch (_) {}
    state.videoLoadAbort = null;
  }
}
export async function switchSourceTab(tabName, resumeTime = null) {
  if (tabName === "official") {
    tabName = getDefaultPlayableSourceTab();
  }
  const video = document.getElementById("native-video");
  let effectiveResumeTime = 0;
  const effTiming = getEffectivePlaybackTiming(video);
  if (typeof resumeTime === "number" && Number.isFinite(resumeTime) && resumeTime > 0) {
    effectiveResumeTime = resumeTime;
  } else if (effTiming.cur > 5) {
    effectiveResumeTime = effTiming.cur;
  } else if (state.activeItem?.media_type === "series") {
    const epProg = getEpisodeProgress(state.activeItem, state.activeSeason, state.activeEpisode);
    if (epProg && epProg.current_time > 10 && epProg.pct < 92) {
      effectiveResumeTime = epProg.current_time;
    }
  } else if (state.activeItem) {
    const cwMatch = (state.continueWatching || []).find((c) => c.id === state.activeItem.id);
    if (cwMatch && Number(cwMatch.current_time) > 10 && Number(cwMatch.progress || 0) < 0.92) {
      effectiveResumeTime = Number(cwMatch.current_time);
    } else {
      const localMovieProg = getEpisodeProgress(state.activeItem, state.activeSeason, state.activeEpisode);
      if (localMovieProg && localMovieProg.current_time > 10 && localMovieProg.pct < 92) {
        effectiveResumeTime = localMovieProg.current_time;
      }
    }
  }

  const prevTab = state.activeSourceTab;
  state.activeSourceTab = tabName;
  if (prevTab !== tabName && ["hdrezka", "stremio", "backup4k"].includes(tabName)) {
    savePlayerPrefs({ preferredSourceTab: tabName });
  }
  document.querySelectorAll(".source-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  document.getElementById("player-gear-popover")?.classList.add("hidden");
  document.getElementById("btn-player-gear")?.classList.remove("active");
  document.getElementById("video-error-state")?.classList.add("hidden");
  closeAllVcPopovers();
  syncVcPopoverOpenClass();
  document.getElementById("rezka-controls-bar")?.classList.add("hidden");
  document.getElementById("hdr-rezka-audio-bar")?.classList.add("hidden");
  document.getElementById("stremio-streams-panel")?.classList.toggle("hidden", tabName !== "stremio");
  document.getElementById("backup-releases-panel")?.classList.toggle("hidden", tabName !== "backup4k");
  document.getElementById("trailer-panel")?.classList.toggle("hidden", tabName !== "trailer");
  syncDownloadButtonVisibility();
  const customVc = document.getElementById("atv-custom-controls");
  if (customVc) {
    const showVc = tabName === "hdrezka" || tabName === "stremio" || tabName === "backup4k";
    customVc.classList.toggle("hidden", !showVc);
  }
  syncCustomControlPopovers();
  const bottomEpsPanel = document.getElementById("episodes-bottom-panel");
  const showEps =
    state.activeItem?.media_type === "series" &&
    (tabName === "hdrezka" || tabName === "stremio" || tabName === "backup4k");
  if (bottomEpsPanel) {
    bottomEpsPanel.classList.toggle("hidden", !showEps);
  }
  document.getElementById("current-episode-bar")?.classList.toggle("hidden", !showEps);

  if (state.activeItem) {
    renderModalProvidersSidebar(state.activeItem);
  }

  // Stop previous video/HLS stream cleanly when switching source tabs so background audio never leaks
  // and detach old error listeners BEFORE clearing src so MEDIA_ERR_SRC_NOT_SUPPORTED never flashes!
  if (prevTab !== tabName || tabName !== "hdrezka") {
    abortActiveVideoListeners();
    [
      "streamAbortController",
      "backup4kAbortController",
      "stremioResolveAbortController",
      "remuxProbeAbortController",
      "trailerAbortController",
    ].forEach((ctrlKey) => {
      if (state[ctrlKey]) {
        try {
          state[ctrlKey].abort();
        } catch (_) {}
        state[ctrlKey] = null;
      }
    });
    if (state.hlsInstance) {
      try {
        state.hlsInstance.destroy();
      } catch (_) {}
      state.hlsInstance = null;
    }
    if (video) {
      video.onloadedmetadata = null;
      try {
        video.pause();
      } catch (_) {}
      video.querySelectorAll("track").forEach((tr) => tr.remove());
      if (!isVideoInPiP(video)) {
        video.removeAttribute("src");
        try {
          video.load();
        } catch (_) {}
      }
    }
    clearCustomSubtitleOverlay(true);
    syncDownloadButtonVisibility();
    document.getElementById("video-loader")?.classList.add("hidden");
  }

  const trailerStage = document.getElementById("trailer-stage-box");
  if (tabName !== "trailer" && trailerStage) {
    trailerStage.innerHTML = "";
    trailerStage.classList.add("hidden");
  }

  if (tabName === "trailer") {
    stopAmbilightLoop(true);
  } else {
    startAmbilightLoop();
  }

  if (tabName === "hdrezka") {
    await loadHDRezkaStream(effectiveResumeTime);
  } else if (tabName === "stremio") {
    await loadStremioStreams(effectiveResumeTime);
  } else if (tabName === "backup4k") {
    await loadBackup4KReleases(effectiveResumeTime);
  } else if (tabName === "trailer") {
    await loadTrailerTab();
  }
}
export function renderTrailerEmbed(lang = "ru") {
  state.trailerLang = lang;
  const trailerStage = document.getElementById("trailer-stage-box");
  const btnRu = document.getElementById("btn-trailer-ru");
  const btnEn = document.getElementById("btn-trailer-en");
  const btnYt = document.getElementById("btn-trailer-yt");
  if (!trailerStage || !state.trailerData) return;

  if (btnRu) btnRu.classList.toggle("active", lang === "ru");
  if (btnEn) btnEn.classList.toggle("active", lang === "en");

  const embedUrl =
    lang === "en"
      ? state.trailerData.en_embed_url || state.trailerData.default_embed_url
      : state.trailerData.ru_embed_url || state.trailerData.default_embed_url;
  const ytUrl =
    lang === "en"
      ? state.trailerData.en_youtube_url || state.trailerData.ru_youtube_url
      : state.trailerData.ru_youtube_url || state.trailerData.en_youtube_url;

  if (btnYt && ytUrl) {
    btnYt.onclick = () => window.open(ytUrl, "_blank", "noopener,noreferrer");
  }

  trailerStage.classList.remove("hidden");
  if (embedUrl) {
    let apiEmbedUrl = embedUrl;
    if (/youtube\.com\/embed\//i.test(apiEmbedUrl) && !/enablejsapi=1/i.test(apiEmbedUrl)) {
      const sep = apiEmbedUrl.includes("?") ? "&" : "?";
      const originParam =
        typeof window !== "undefined" && /^https?:\/\//i.test(window.location.origin)
          ? `&origin=${encodeURIComponent(window.location.origin)}`
          : "";
      apiEmbedUrl = `${apiEmbedUrl}${sep}enablejsapi=1${originParam}`;
    }
    state.trailerPlaying = true;
    trailerStage.innerHTML = `
      <iframe
        src="${apiEmbedUrl}"
        title="${escapeAttr(t("Трейлер", "Trailer"))}"
        referrerpolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
      ></iframe>
    `;
    const miniPlayBtn = document.getElementById("btn-mini-play-pause");
    if (miniPlayBtn) miniPlayBtn.innerHTML = iconSvg("pause", 12);
  } else {
    state.trailerPlaying = false;
    trailerStage.innerHTML = `
      <div style="text-align:center;padding:24px;color:rgba(235,235,245,0.75)">
        <div style="margin-bottom:12px;font-size:15px;font-weight:600">${t(
          "Встроенный трейлер недоступен",
          "Embedded trailer unavailable"
        )}</div>
        <button class="atv-btn-primary atv-btn-sm" id="fallback-yt-trailer-btn">
          <span>${t("Открыть трейлер на YouTube", "Open trailer on YouTube")}</span>
          ${iconSvg("external", 13)}
        </button>
      </div>
    `;
    const fbBtn = document.getElementById("fallback-yt-trailer-btn");
    if (fbBtn && ytUrl) {
      fbBtn.onclick = () => window.open(ytUrl, "_blank", "noopener,noreferrer");
    }
  }
}
export async function loadTrailerTab() {
  if (!state.activeItem || !state.isPlayerOpen) return;
  const sessionId = state.playerSessionId;
  const item = state.activeItem;
  const loader = document.getElementById("video-loader");
  const loaderText = document.getElementById("video-loader-text");
  const defaultTrailerLang = state.trailerLang || (isEn() ? "en" : "ru");
  if (state.trailerData && state.trailerData.title === item.title) {
    renderTrailerEmbed(defaultTrailerLang);
    return;
  }
  if (state.trailerAbortController) {
    try {
      state.trailerAbortController.abort();
    } catch (_) {}
  }
  const abortController = new AbortController();
  state.trailerAbortController = abortController;
  if (loader && loaderText) {
    loaderText.textContent = t(
      `Поиск официального трейлера «${displayTitle(item)}»...`,
      `Searching official trailer for "${displayTitle(item)}"...`
    );
    loader.classList.remove("hidden");
  }
  try {
    const params = new URLSearchParams({
      id: item.rezka_id || item.id,
      rezka_url: item.rezka_url || "",
      title: item.title,
      orig_title: item.orig_title || "",
      year: String(item.year || 2024),
      media_type: item.media_type || "movie",
    });
    const res = await fetch(`/api/trailer?${params.toString()}`, {
      signal: abortController.signal,
    });
    const data = await res.json();
    if (!state.isPlayerOpen || sessionId !== state.playerSessionId) return;
    state.trailerData = data;
    if (state.activeSourceTab === "trailer") {
      renderTrailerEmbed(state.trailerLang || (isEn() ? "en" : "ru"));
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;
    console.error("Trailer load error:", err);
  } finally {
    if (loader && sessionId === state.playerSessionId && state.activeSourceTab === "trailer") {
      loader.classList.add("hidden");
    }
  }
}
export function hideVideoStreamError() {
  document.getElementById("video-error-state")?.classList.add("hidden");
}
export function showVideoStreamError(
  title = t("Поток временно недоступен", "Stream temporarily unavailable"),
  sub = t(
    "Попробуйте повторить подключение, выбрать другую студию озвучки или переключиться на 4K",
    "Try reconnecting, choosing another audio track, or switching to Stremio / 4K"
  )
) {
  const errBox = document.getElementById("video-error-state");
  const titleEl = document.getElementById("video-error-title");
  const subEl = document.getElementById("video-error-sub");
  const studioBtn = document.getElementById("btn-video-err-studio");
  const b4kBtn = document.getElementById("btn-video-err-4k");
  if (!errBox) return;
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = sub;
  const studioCount = document.getElementById("select-studio")?.options?.length || 0;
  if (studioBtn) studioBtn.classList.toggle("hidden", studioCount <= 1 || state.activeSourceTab !== "hdrezka");
  if (b4kBtn) b4kBtn.classList.toggle("hidden", !isServiceEnabled("backup4k") || state.activeSourceTab === "backup4k");
  errBox.classList.remove("hidden");
}
export function buildNextEpisodePreloadKey(item, season, episode, studioId) {
  return `${item?.id || ""}:s${season}e${episode}:tr${studioId || "auto"}:${state.appLang || "ru"}`;
}
export async function preloadNextEpisodeIfNeeded(curSec, durSec) {
  if (
    !state.isPlayerOpen ||
    state.activeSourceTab !== "hdrezka" ||
    state.activeItem?.media_type !== "series" ||
    !(durSec >= 180)
  ) {
    return;
  }
  const remain = durSec - curSec;
  const ratio = curSec / durSec;
  if (ratio < 0.84 && remain > 95) return;

  const nextCoords = getNextEpisodeCoords();
  if (!nextCoords) return;

  const item = state.activeItem;
  const preloadKey = buildNextEpisodePreloadKey(
    item,
    nextCoords.season,
    nextCoords.episode,
    state.activeStudioId
  );
  if (
    state.preloadingNextKey === preloadKey ||
    (state.preloadedNextEpisode && state.preloadedNextEpisode.key === preloadKey)
  ) {
    return;
  }
  state.preloadingNextKey = preloadKey;
  try {
    const savedPrefForNext = getPreferredStudioForItem(item);
    const params = new URLSearchParams({
      id: item.rezka_id || item.id,
      rezka_url: item.rezka_url || "",
      title: item.title,
      orig_title: item.orig_title || "",
      year: String(item.year || 2024),
      media_type: "series",
      translator_id: state.activeStudioId || "",
      season: String(nextCoords.season),
      episode: String(nextCoords.episode),
      lang: state.appLang || "ru",
      prefer_original: !state.activeStudioId && !savedPrefForNext && isEn() ? "1" : "0",
    });
    const res = await fetch(`/api/hdrezka/streams?${params.toString()}`);
    if (!res.ok) return;
    const data = await res.json();
    const prefs = getPlayerPrefs();
    const qKey = pickBestQualityKey(
      data.qualities || {},
      prefs.preferredQuality,
      data.default_quality
    );
    const nextUrl = (data.qualities || {})[qKey] || data.default_stream_url || "";
    if (!nextUrl) return;

    state.preloadedNextEpisode = {
      key: preloadKey,
      data,
      streamUrl: nextUrl,
      qualityKey: qKey,
      fetchedAt: Date.now(),
    };

    // Warm up TCP/TLS + initial segment in background without disturbing active playback
    if (nextUrl.includes(".m3u8")) {
      fetch(nextUrl, { mode: "cors" }).catch(() => {});
    } else {
      fetch(nextUrl, { headers: { Range: "bytes=0-262143" }, mode: "no-cors" }).catch(() => {});
    }

    const skipOutroBtn = document.getElementById("skip-outro-btn");
    if (skipOutroBtn) {
      skipOutroBtn.innerHTML = `${t("Следующая серия", "Next episode")} <span class="atv-preload-ready-dot" title="${escapeAttr(
        t("Поток следующей серии предзагружен", "Next episode stream preloaded")
      )}"></span>`;
    }
  } catch (_) {
  } finally {
    if (state.preloadingNextKey === preloadKey) {
      state.preloadingNextKey = "";
    }
  }
}
export async function loadHDRezkaStream(resumeTime = 0) {
  if (!state.activeItem || !state.isPlayerOpen) return;
  const sessionId = state.playerSessionId;
  const item = state.activeItem;
  const loader = document.getElementById("video-loader");
  const loaderText = document.getElementById("video-loader-text");
  hideVideoStreamError();
  state.remuxMeta = null;

  const skipOutroEl = document.getElementById("skip-outro-btn");
  if (skipOutroEl) {
    skipOutroEl.textContent = t("Следующая серия", "Next episode");
  }

  const preloadCandidateKey =
    item.media_type === "series"
      ? buildNextEpisodePreloadKey(item, state.activeSeason, state.activeEpisode, state.activeStudioId)
      : "";
  const hasWarmPreload = Boolean(
    preloadCandidateKey &&
      state.preloadedNextEpisode &&
      state.preloadedNextEpisode.key === preloadCandidateKey &&
      Date.now() - (state.preloadedNextEpisode.fetchedAt || 0) < 1200000
  );

  if (!hasWarmPreload) {
    loaderText.textContent = t(
      `Загрузка полного 1080p потока «${displayTitle(item)}» (Без регистрации)...`,
      `Loading full 1080p stream for "${displayTitle(item)}"...`
    );
    loader.classList.remove("hidden");
  }

  if (state.streamAbortController) {
    try {
      state.streamAbortController.abort();
    } catch (_) {}
  }
  const abortController = new AbortController();
  state.streamAbortController = abortController;
  let requestTimedOut = false;
  const requestTimeoutId = setTimeout(() => {
    requestTimedOut = true;
    try {
      abortController.abort();
    } catch (_) {}
  }, 18000);

  const savedPrefForReq = getPreferredStudioForItem(item);
  const preferOriginalFlag = !state.activeStudioId && !savedPrefForReq && isEn() ? "1" : "0";
  const params = new URLSearchParams({
    id: item.rezka_id || item.id,
    rezka_url: item.rezka_url || "",
    title: item.title,
    orig_title: item.orig_title || "",
    year: String(item.year || 2024),
    media_type: item.media_type || "movie",
    translator_id: state.activeStudioId,
    season: String(state.activeSeason),
    episode: String(state.activeEpisode),
    lang: state.appLang || "ru",
    prefer_original: preferOriginalFlag,
  });

  try {
    let data;
    if (hasWarmPreload) {
      data = state.preloadedNextEpisode.data;
      state.preloadedNextEpisode = null;
      clearTimeout(requestTimeoutId);
    } else {
      const res = await fetch(`/api/hdrezka/streams?${params.toString()}`, {
        signal: abortController.signal,
      });
      clearTimeout(requestTimeoutId);
      data = await res.json();
    }

    // If modal was closed while stream request was in-flight, abort immediately!
    if (!state.isPlayerOpen || sessionId !== state.playerSessionId) {
      loader.classList.add("hidden");
      return;
    }

    if (data.rezka_id) item.rezka_id = data.rezka_id;
    if (data.rezka_url) item.rezka_url = data.rezka_url;

    if (isEn()) {
      if (data.description && data.description.length > 15 && !hasCyrillicText(data.description)) {
        item.description_en = data.description;
      }
      const descEl = document.getElementById("meta-description");
      if (descEl) {
        descEl.textContent = displayDescription(item) || "";
      }
      if (data.directors?.length) item.directors_en = data.directors;
      if (data.actors?.length) item.actors_en = data.actors;
      if (data.cast_people?.length) item.cast_people_en = data.cast_people;
    } else {
      if (data.description && data.description.length > 25) {
        item.description = data.description;
        document.getElementById("meta-description").textContent = data.description;
      }
      if (data.directors?.length) item.directors = data.directors;
      if (data.actors?.length) item.actors = data.actors;
      if (data.cast_people?.length) item.cast_people = data.cast_people;
    }
    if (data.duration_label) item.duration_label = data.duration_label;
    renderModalCastSection(item, data);

    if (data.episodes_titles) {
      state.episodesTitles = data.episodes_titles;
    }
    if (data.episodes_meta) {
      state.episodesMeta = data.episodes_meta;
    }

    if (item.media_type === "series") {
      if (typeof data.is_completed === "boolean") {
        item.is_series_completed = data.is_completed;
      }
      if (data.seasons_map && Object.keys(data.seasons_map).length > 0) {
        state.seasonsMap = data.seasons_map;
        if (Number(data.season) > 0) state.activeSeason = Number(data.season);
        if (Number(data.episode) > 0) state.activeEpisode = Number(data.episode);
      }
      populateSeasonEpisodeSelectors(item, state.seasonsMap);
      if (data.latest_season && data.latest_episode && data.seasons_map && Object.keys(data.seasons_map).length > 0) {
        const stSummary = (data.studios || [])
          .map((s) => s.name)
          .filter(Boolean)
          .slice(0, 4)
          .join(", ");
        const liveEntry = {
          id: item.id,
          kinorium_id: item.kinorium?.kinorium_id || "",
          title: item.title,
          orig_title: item.orig_title || "",
          rezka_id: data.rezka_id || item.rezka_id || "",
          rezka_url: data.rezka_url || item.rezka_url || "",
          latest_season: data.latest_season,
          latest_episode: data.latest_episode,
          seasons_map: data.seasons_map,
          is_completed: Boolean(data.is_completed),
          studios_summary: stSummary || "HDRezka",
          not_found: false,
        };
        if (item.id) state.liveSeriesUpdates[item.id] = liveEntry;
        if (item.kinorium?.kinorium_id) {
          state.liveSeriesUpdates[`kin_${item.kinorium.kinorium_id}`] = liveEntry;
        }
        if (item.title) state.liveSeriesUpdates[item.title.trim().toLowerCase()] = liveEntry;
      }
    }

    const studioSel = document.getElementById("select-studio");
    studioSel.innerHTML = "";
    const studiosList = data.studios || [];
    const savedPref = getPreferredStudioForItem(item);
    let matchedPrefStudio = null;
    if (savedPref && studiosList.length > 1) {
      matchedPrefStudio =
        studiosList.find((st) => String(st.id) === String(savedPref.id)) ||
        studiosList.find(
          (st) =>
            savedPref.name &&
            String(st.name || "")
              .trim()
              .toLowerCase() === String(savedPref.name).trim().toLowerCase()
        ) ||
        null;
    }

    // If user had a saved studio by name whose ID differed from the initial request, reload once with that studio ID
    if (
      matchedPrefStudio &&
      String(matchedPrefStudio.id) !== String(data.selected_studio?.id) &&
      String(state.activeStudioId) !== String(matchedPrefStudio.id)
    ) {
      state.activeStudioId = String(matchedPrefStudio.id);
      state.activeStudioName = matchedPrefStudio.name;
      return await loadHDRezkaStream(resumeTime);
    }

    studiosList.forEach((st) => {
      const opt = document.createElement("option");
      opt.value = st.id;
      opt.dataset.rawName = st.name || "";
      const localizedStudioName = translateStudioName(st.name);
      opt.textContent = localizedStudioName;
      opt.dataset.isOriginal = st.is_original ? "1" : "0";
      if (st.id === data.selected_studio?.id) {
        opt.selected = true;
        state.activeStudioName = localizedStudioName;
        state.activeStudioId = st.id;
        if (!st.is_original) {
          state.lastNonOriginalStudioId = String(st.id);
        }
      }
      studioSel.appendChild(opt);
    });
    if (!state.lastNonOriginalStudioId) {
      const firstRu = studiosList.find((st) => !st.is_original);
      if (firstRu) {
        state.lastNonOriginalStudioId = String(firstRu.id);
      }
    }

    const rSess = data.remux_session || null;
    if (rSess && rSess.rawSourceUrl) {
      state.remuxMeta = {
        active: true,
        rawSourceUrl: rSess.rawSourceUrl,
        duration: Number(rSess.duration) || 0,
        offsetSec: Math.max(0, Number(resumeTime) || 0),
        audioIndex: Number(rSess.audioIndex) || 0,
        videoCodec: rSess.videoCodec || "",
        channels: Number(rSess.channels) || 2,
        audioTracks: rSess.audioTracks || [],
        subtitleTracks: rSess.subtitleTracks || [],
        externalSubtitles: Array.isArray(data.subtitles) ? data.subtitles : [],
      };
      const remuxUrl = buildRemuxStreamEndpoint(state.remuxMeta, state.remuxMeta.offsetSec);
      const qLabel = data.default_quality || "1080p";
      state.qualities = { [qLabel]: remuxUrl };
    } else {
      state.remuxMeta = null;
      state.qualities = data.qualities || {};
    }

    const prefs = getPlayerPrefs();
    const chosenQualKey = pickBestQualityKey(
      state.qualities,
      prefs.preferredQuality,
      data.default_quality
    );
    const qualSel = document.getElementById("select-quality");
    qualSel.innerHTML = "";
    Object.keys(state.qualities).forEach((qKey) => {
      const opt = document.createElement("option");
      opt.value = qKey;
      opt.textContent = qKey;
      if (qKey === chosenQualKey) opt.selected = true;
      qualSel.appendChild(opt);
    });

    if (state.remuxMeta?.active) {
      state.subtitles = buildRemuxSubtitlesList(state.remuxMeta, state.remuxMeta.offsetSec);
    } else {
      state.subtitles = (data.subtitles || []).map((s) => {
        const rawSubLang = String(s.lang || "").trim();
        let dispSubLang = rawSubLang;
        if (isEn()) {
          dispSubLang = rawSubLang
            .replace(/^Русский$/i, "Russian")
            .replace(/^Українська$/i, "Ukrainian")
            .replace(/^Английский$/i, "English");
        }
        return { ...s, lang: dispSubLang };
      });
    }
    let subIdx = pickPreferredSubtitleIndex(
      state.subtitles,
      prefs.preferredSubtitleLang
    );
    const selectedIsOriginal = Boolean(
      data.selected_studio?.is_original ||
        studiosList.find((st) => String(st.id) === String(state.activeStudioId))?.is_original
    );
    if (isEn()) {
      if (state.forceEnableRuSubtitlesOnce && subIdx < 0 && state.subtitles.length > 0) {
        const enSubIdx = state.subtitles.findIndex((s) => /eng|англ/i.test(String(s.lang || "")));
        if (enSubIdx >= 0) subIdx = enSubIdx;
      }
    } else if (
      (selectedIsOriginal || state.forceEnableRuSubtitlesOnce) &&
      subIdx < 0 &&
      state.subtitles.length > 0 &&
      (state.forceEnableRuSubtitlesOnce || prefs.preferredSubtitleLang !== "off")
    ) {
      const ruSubIdx = state.subtitles.findIndex((s) => /рус|rus|russian/i.test(String(s.lang || "")));
      subIdx = ruSubIdx >= 0 ? ruSubIdx : 0;
    }
    state.forceEnableRuSubtitlesOnce = false;
    state.activeSubtitleIndex = subIdx;
    populateSubtitlesSelector(state.subtitles);
    syncCustomControlPopovers();

    document.getElementById("geo-bypass-indicator").textContent =
      data.geo_bypass?.status_text || t("1080p Без регистрации", "1080p Direct Stream");

    const chosenStreamUrl = state.qualities[chosenQualKey] || data.default_stream_url;
    if (!chosenStreamUrl) {
      loader.classList.add("hidden");
      document.getElementById("geo-bypass-indicator").textContent = t(
        "Поток недоступен — смените озвучку или 4K",
        "Stream unavailable — switch audio or try Stremio / 4K"
      );
      showVideoStreamError(
        t("Поток в этой озвучке временно недоступен", "Stream unavailable for this audio track"),
        t(
          "Выберите другую студию озвучки, повторите попытку или переключитесь на вкладку 4K",
          "Choose another audio studio, retry, or switch to the Stremio / 4K tab"
        )
      );
      return;
    }
    if (state.remuxMeta?.active) {
      initAdSkipSession(null, "");
      playVideoUrl(chosenStreamUrl, 0, sessionId, { keepRemuxMeta: true });
    } else {
      initAdSkipSession(data.ad_skip || null, chosenStreamUrl);
      playVideoUrl(chosenStreamUrl, resumeTime, sessionId);
    }
  } catch (err) {
    clearTimeout(requestTimeoutId);
    if (err && err.name === "AbortError" && !requestTimedOut) return;
    console.error("HDRezka stream error:", err);
    loader.classList.add("hidden");
    const statusEl = document.getElementById("geo-bypass-indicator");
    if (statusEl) {
      statusEl.textContent = t(
        "Ошибка соединения — попробуйте другую озвучку или 4K",
        "Connection error — try another audio track or Stremio / 4K"
      );
    }
    showVideoStreamError(
      t("Не удалось подключиться к потоку HDRezka", "Could not connect to HDRezka stream"),
      t(
        "Проверьте соединение, выберите другую студию озвучки или откройте вкладку 4K",
        "Check your connection, choose another studio, or switch to Stremio / 4K"
      )
    );
  }
}
function estimateItemDurationSec(item) {
  if (!item) return 3000;
  const numMin = Number(item.duration_min);
  if (Number.isFinite(numMin) && numMin >= 10 && numMin <= 600) {
    return numMin * 60;
  }
  const lbl = String(item.duration_label || "").trim();
  if (lbl) {
    const hMatch = lbl.match(/(\d+)\s*(?:ч|час|h|hr)/i);
    const mMatch = lbl.match(/(\d+)\s*(?:мин|min|m\b)/i);
    if (hMatch || mMatch) {
      const h = hMatch ? parseInt(hMatch[1], 10) || 0 : 0;
      const m = mMatch ? parseInt(mMatch[1], 10) || 0 : 0;
      const total = h * 3600 + m * 60;
      if (total >= 600) return total;
    }
    const pureMin = lbl.match(/^(\d{2,3})$/);
    if (pureMin) {
      return (parseInt(pureMin[1], 10) || 48) * 60;
    }
  }
  return item.media_type === "series" ? 3000 : 7200;
}
function scheduleRemuxFullDurationProbe(sessionId = state.playerSessionId) {
  if (state.remuxDurationReprobeTimer) {
    clearTimeout(state.remuxDurationReprobeTimer);
    state.remuxDurationReprobeTimer = null;
  }
  if (!state.remuxMeta?.active || !state.remuxMeta.rawSourceUrl || state.remuxMeta.duration > 10) {
    return;
  }
  const targetRawUrl = state.remuxMeta.rawSourceUrl;
  state.remuxDurationReprobeTimer = setTimeout(async () => {
    state.remuxDurationReprobeTimer = null;
    if (
      !state.isPlayerOpen ||
      sessionId !== state.playerSessionId ||
      !state.remuxMeta?.active ||
      state.remuxMeta.rawSourceUrl !== targetRawUrl ||
      state.remuxMeta.duration > 10
    ) {
      return;
    }
    try {
      const res = await fetch(
        `/api/remux-probe?src=${encodeURIComponent(targetRawUrl)}&full=1&lang=${encodeURIComponent(
          state.appLang || "ru"
        )}`
      );
      if (!res.ok) return;
      const probe = await res.json();
      if (
        !state.isPlayerOpen ||
        sessionId !== state.playerSessionId ||
        !state.remuxMeta?.active ||
        state.remuxMeta.rawSourceUrl !== targetRawUrl
      ) {
        return;
      }
      if (Number(probe?.duration) > 10) {
        state.remuxMeta.duration = Number(probe.duration);
      }
      if (
        (!state.remuxMeta.audioTracks || state.remuxMeta.audioTracks.length === 0) &&
        Array.isArray(probe?.audio_tracks) &&
        probe.audio_tracks.length > 0
      ) {
        state.remuxMeta.audioTracks = probe.audio_tracks;
        const studioSel = document.getElementById("select-studio");
        if (studioSel) {
          studioSel.innerHTML = "";
          probe.audio_tracks.forEach((tr) => {
            const opt = document.createElement("option");
            opt.value = String(tr.audio_index);
            opt.textContent = tr.label;
            if (Number(tr.audio_index) === Number(state.remuxMeta.audioIndex)) opt.selected = true;
            studioSel.appendChild(opt);
          });
        }
      }
      if (
        (!state.remuxMeta.subtitleTracks || state.remuxMeta.subtitleTracks.length === 0) &&
        Array.isArray(probe?.subtitle_tracks) &&
        probe.subtitle_tracks.length > 0
      ) {
        state.remuxMeta.subtitleTracks = probe.subtitle_tracks;
        refreshRemuxSubtitleTracks(state.remuxMeta.offsetSec || 0);
      }
      syncCustomControlPopovers();
      syncCustomVideoControlsUI(true);
    } catch (_) {}
  }, 2600);
}
export function getEffectivePlaybackTiming(video = document.getElementById("native-video")) {
  if (!video) return { cur: 0, dur: 0 };
  const rawCur = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const rawDur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  if (state.remuxMeta && state.remuxMeta.active) {
    const effCur = Math.max(0, (state.remuxMeta.offsetSec || 0) + rawCur);
    let totalDur = state.remuxMeta.duration > 10 ? state.remuxMeta.duration : 0;
    if (!(totalDur > 10)) {
      const est = estimateItemDurationSec(state.activeItem);
      const rawPlusOffset = rawDur > 60 ? (state.remuxMeta.offsetSec || 0) + rawDur : 0;
      totalDur = Math.max(est, rawPlusOffset, effCur + 120);
    } else if (effCur > totalDur) {
      totalDur = effCur + 30;
    }
    return { cur: Math.min(totalDur, effCur), dur: totalDur };
  }
  return { cur: rawCur, dur: rawDur };
}
export function buildRemuxStreamEndpoint(meta, startSec = 0) {
  const qs = new URLSearchParams({
    src: meta.rawSourceUrl,
    audio: String(meta.audioIndex || 0),
    start: String(Math.max(0, Math.round(startSec * 10) / 10)),
    vcodec: meta.videoCodec || "",
    acodec: meta.audioCodec || "",
    ch: String(meta.channels || 2),
  });
  if (meta.forceH264) {
    qs.set("compat", "h264");
  }
  return `/api/remux-stream?${qs.toString()}`;
}
export function buildRemuxSubtitlesList(meta, offsetSec = 0) {
  if (!meta) return [];
  const ssVal = Math.max(0, Math.round((Number(offsetSec) || 0) * 10) / 10);
  const out = [];
  if (Array.isArray(meta.externalSubtitles)) {
    meta.externalSubtitles.forEach((ext) => {
      const rawSubUrl = ext?.raw_url || ext?.url || "";
      if (!rawSubUrl) return;
      let cleanProxied = String(rawSubUrl);
      if (cleanProxied.startsWith("/api/proxy-vtt?")) {
        cleanProxied = cleanProxied.replace(/([?&])ss=[^&]*/g, "");
        cleanProxied += cleanProxied.includes("?") ? "&ss=0" : "?ss=0";
      } else {
        cleanProxied = `/api/proxy-vtt?url=${encodeURIComponent(cleanProxied)}&ss=0`;
      }
      let dispLang = String(ext.lang || "OpenSubtitles").trim();
      if (isEn()) {
        dispLang = dispLang
          .replace(/^Русский$/i, "Russian")
          .replace(/^Українська$/i, "Ukrainian")
          .replace(/^Английский$/i, "English");
      }
      out.push({
        lang: dispLang,
        url: cleanProxied,
        direct_vtt: true,
        isFullTimeline: true,
      });
    });
  }
  if (Array.isArray(meta.subtitleTracks)) {
    const winDurSec = 420;
    meta.subtitleTracks.forEach((st) => {
      const qs = new URLSearchParams({
        src: meta.rawSourceUrl,
        si: String(st.stream_index),
        ss: String(ssVal),
        dur: String(winDurSec),
      });
      out.push({
        lang: st.label ? `${st.label} (MKV)` : `Track #${st.stream_index} (MKV)`,
        url: `/api/remux-subtitle?${qs.toString()}`,
        direct_vtt: true,
        isWindowedEmbedded: true,
        rawSourceUrl: meta.rawSourceUrl,
        streamIndex: st.stream_index,
        windowStartSec: ssVal,
        windowDurSec: winDurSec,
      });
    });
  }
  return out;
}
export function refreshRemuxSubtitleTracks(offsetSec = 0) {
  if (!state.remuxMeta || !state.remuxMeta.active) return;
  const prevSub =
    state.activeSubtitleIndex >= 0 ? (state.subtitles || [])[state.activeSubtitleIndex] : null;
  state.subtitles = buildRemuxSubtitlesList(state.remuxMeta, offsetSec);
  if (state.activeSubtitleIndex >= state.subtitles.length) {
    state.activeSubtitleIndex = -1;
  }
  populateSubtitlesSelector(state.subtitles);
  syncCustomControlPopovers();
  if (state.activeSubtitleIndex >= 0) {
    if (prevSub?.isFullTimeline && state.subtitles[state.activeSubtitleIndex]?.isFullTimeline) {
      state.activeSubTrackMeta = state.subtitles[state.activeSubtitleIndex];
      updateCustomSubtitleOverlay();
    } else {
      activateSelectedSubtitleTrack();
    }
  } else {
    clearCustomSubtitleOverlay(false);
  }
}
export function seekEffectivePlayback(targetSec) {
  const video = document.getElementById("native-video");
  if (!video) return;
  const { dur } = getEffectivePlaybackTiming(video);
  const clamped = dur > 0 ? Math.min(Math.max(0, dur - 0.5), Math.max(0, targetSec)) : Math.max(0, targetSec);

  if (state.remuxMeta && state.remuxMeta.active) {
    const offset = state.remuxMeta.offsetSec || 0;
    const relTarget = clamped - offset;
    if (relTarget >= 0 && video.buffered && video.buffered.length > 0) {
      for (let i = 0; i < video.buffered.length; i++) {
        if (relTarget >= video.buffered.start(i) && relTarget + 1.0 <= video.buffered.end(i)) {
          video.currentTime = relTarget;
          syncCustomVideoControlsUI(true);
          return;
        }
      }
    }
    refreshRemuxSubtitleTracks(clamped);
    const loader = document.getElementById("video-loader");
    const loaderText = document.getElementById("video-loader-text");
    if (loader && loaderText) {
      const streamTag =
        state.activeSourceTab === "stremio"
          ? t("потока Stremio", "Stremio stream")
          : state.activeSourceTab === "backup4k"
          ? t("4K потока", "4K stream")
          : t("потока Оригинал", "Original stream");
      loaderText.textContent = t(
        `Перемотка ${streamTag} на ${formatTime(clamped)}...`,
        `Seeking ${streamTag} to ${formatTime(clamped)}...`
      );
      loader.classList.remove("hidden");
    }
    const remuxUrl = buildRemuxStreamEndpoint(state.remuxMeta, clamped);
    playVideoUrl(remuxUrl, 0, state.playerSessionId, { keepRemuxMeta: true, newRemuxOffsetSec: clamped });
    syncCustomVideoControlsUI(true);
    return;
  }

  video.currentTime = clamped;
  syncCustomVideoControlsUI(true);
}
export function switchRemuxAudioTrack(newAudioIdx) {
  if (!state.remuxMeta || !state.remuxMeta.active) return;
  const video = document.getElementById("native-video");
  const { cur } = getEffectivePlaybackTiming(video);
  const trObj = (state.remuxMeta.audioTracks || []).find((t) => Number(t.audio_index) === Number(newAudioIdx));
  state.remuxMeta.audioIndex = Number(newAudioIdx) || 0;
  state.remuxMeta.channels = trObj?.channels || 2;
  state.remuxMeta.audioCodec = trObj?.codec || "";
  refreshRemuxSubtitleTracks(cur);
  const srcPrefix = state.activeSourceTab === "stremio" ? "Stremio" : "4K";
  if (trObj?.label) {
    state.activeStudioName = `${srcPrefix} · ${trObj.label}`;
  }
  const inlineSel = document.getElementById("b4k-inline-audio-select");
  if (inlineSel) inlineSel.value = String(state.remuxMeta.audioIndex);
  const stremioInlineSel = document.getElementById("stremio-inline-audio-select");
  if (stremioInlineSel) stremioInlineSel.value = String(state.remuxMeta.audioIndex);
  const studioSel = document.getElementById("select-studio");
  if (studioSel) studioSel.value = String(state.remuxMeta.audioIndex);
  syncCustomControlPopovers();

  const loader = document.getElementById("video-loader");
  const loaderText = document.getElementById("video-loader-text");
  if (loader && loaderText) {
    loaderText.textContent = t(
      `Переключение аудиодорожки ${srcPrefix} (${trObj?.label || "AAC"})...`,
      `Switching ${srcPrefix} audio track (${trObj?.label || "AAC"})...`
    );
    loader.classList.remove("hidden");
  }
  const remuxUrl = buildRemuxStreamEndpoint(state.remuxMeta, cur);
  playVideoUrl(remuxUrl, 0, state.playerSessionId, { keepRemuxMeta: true, newRemuxOffsetSec: cur });
  showToast(
    t(
      `Аудиодорожка ${srcPrefix}: ${trObj?.label || `#${newAudioIdx + 1}`}`,
      `${srcPrefix} audio track: ${trObj?.label || `#${newAudioIdx + 1}`}`
    )
  );
}
export async function probeAndPlay4KStream(
  rawStreamUrl,
  startSec = 0,
  relQuality = "4K UHD",
  sessionId = state.playerSessionId,
  options = {}
) {
  if (!rawStreamUrl || !state.isPlayerOpen || sessionId !== state.playerSessionId) return;
  const {
    targetListId = "backup-releases-list",
    audioBarId = "b4k-audio-tracks-bar",
    inlineSelectId = "b4k-inline-audio-select",
    sourcePrefix = "4K",
    extraSubtitles = [],
  } = options;
  const loader = document.getElementById("video-loader");
  const loaderText = document.getElementById("video-loader-text");
  hideVideoStreamError();
  if (loader && loaderText) {
    loaderText.textContent = t(
      `Подключение к ${relQuality} и подготовка звуковых дорожек (DTS/AC3 -> AAC)...`,
      `Connecting to ${relQuality} and preparing audio tracks (DTS/AC3 -> AAC)...`
    );
    loader.classList.remove("hidden");
  }

  if (state.remuxProbeAbortController) {
    try {
      state.remuxProbeAbortController.abort();
    } catch (_) {}
  }
  const probeAbort = new AbortController();
  state.remuxProbeAbortController = probeAbort;

  let probe = null;
  try {
    const res = await fetch(
      `/api/remux-probe?src=${encodeURIComponent(rawStreamUrl)}&lang=${encodeURIComponent(
        state.appLang || "ru"
      )}`,
      { signal: probeAbort.signal }
    );
    probe = await res.json();
  } catch (err) {
    if (err && err.name === "AbortError") return;
  }

  if (!state.isPlayerOpen || sessionId !== state.playerSessionId) return;

  const existingAudioBar = document.getElementById(audioBarId);
  if (existingAudioBar) existingAudioBar.remove();

  const isRemoteLanClient = !["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
  const isLoopbackStream = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(rawStreamUrl);

  if (probe && probe.ok && (probe.needs_remux || (isRemoteLanClient && isLoopbackStream))) {
    const tracks = probe.audio_tracks || [];
    const chosenIdx = Number(probe.default_audio_index) || 0;
    const chosenTrack = tracks.find((t) => Number(t.audio_index) === chosenIdx) || tracks[0] || null;
    state.remuxMeta = {
      active: true,
      rawSourceUrl: rawStreamUrl,
      duration: Number(probe.duration) || 0,
      offsetSec: Math.max(0, Number(startSec) || 0),
      audioIndex: chosenIdx,
      videoCodec: probe.video_codec || "",
      audioCodec: chosenTrack?.codec || "",
      forceH264: false,
      channels: chosenTrack?.channels || 2,
      audioTracks: tracks,
      subtitleTracks: probe.subtitle_tracks || [],
      externalSubtitles: Array.isArray(extraSubtitles) ? extraSubtitles : [],
    };

    const studioSel = document.getElementById("select-studio");
    if (studioSel) {
      studioSel.innerHTML = "";
      tracks.forEach((tr) => {
        const opt = document.createElement("option");
        opt.value = String(tr.audio_index);
        opt.dataset.rawName = tr.raw_label || tr.label || "";
        opt.textContent = tr.label;
        if (Number(tr.audio_index) === chosenIdx) opt.selected = true;
        studioSel.appendChild(opt);
      });
    }
    if (chosenTrack?.label) {
      state.activeStudioName = `${sourcePrefix} (${relQuality}) · ${chosenTrack.label}`;
    } else {
      state.activeStudioName = `${sourcePrefix} (${relQuality})`;
    }

    state.subtitles = buildRemuxSubtitlesList(state.remuxMeta, state.remuxMeta.offsetSec);
    state.activeSubtitleIndex = pickPreferredSubtitleIndex(
      state.subtitles,
      getPlayerPrefs().preferredSubtitleLang
    );
    populateSubtitlesSelector(state.subtitles);
    syncCustomControlPopovers();
    document.getElementById(audioBarId)?.remove();

    const remuxUrl = buildRemuxStreamEndpoint(state.remuxMeta, state.remuxMeta.offsetSec);
    playVideoUrl(remuxUrl, 0, sessionId, { keepRemuxMeta: true });
    return;
  }

  // Fallback: if container is MKV/TorrServer and remux engine is available even when quick probe timed out on cold swarm
  if (probe?.remux_available && (/\/stream\//i.test(rawStreamUrl) || /\.mkv(\?|$)/i.test(rawStreamUrl))) {
    state.remuxMeta = {
      active: true,
      rawSourceUrl: rawStreamUrl,
      duration: 0,
      offsetSec: Math.max(0, Number(startSec) || 0),
      audioIndex: 0,
      videoCodec: "hevc",
      channels: 6,
      audioTracks: [],
      subtitleTracks: [],
      externalSubtitles: Array.isArray(extraSubtitles) ? extraSubtitles : [],
    };
    state.subtitles = buildRemuxSubtitlesList(state.remuxMeta, state.remuxMeta.offsetSec);
    state.activeSubtitleIndex = pickPreferredSubtitleIndex(
      state.subtitles,
      getPlayerPrefs().preferredSubtitleLang
    );
    populateSubtitlesSelector(state.subtitles);
    syncCustomControlPopovers();
    const remuxUrl = buildRemuxStreamEndpoint(state.remuxMeta, state.remuxMeta.offsetSec);
    playVideoUrl(remuxUrl, 0, sessionId, { keepRemuxMeta: true });
    return;
  }

  state.remuxMeta = null;
  if (Array.isArray(extraSubtitles) && extraSubtitles.length > 0) {
    state.subtitles = extraSubtitles.map((s) => ({
      lang: s.lang,
      url: s.url,
      direct_vtt: Boolean(s.direct_vtt || String(s.url || "").startsWith("/api/proxy-vtt?")),
    }));
    state.activeSubtitleIndex = pickPreferredSubtitleIndex(
      state.subtitles,
      getPlayerPrefs().preferredSubtitleLang
    );
    populateSubtitlesSelector(state.subtitles);
  } else {
    state.subtitles = [];
    state.activeSubtitleIndex = -1;
    populateSubtitlesSelector([]);
  }
  syncCustomControlPopovers();
  playVideoUrl(rawStreamUrl, startSec, sessionId);
}
export function renderStremioStreamsList(resumeTime = 0, autoLaunchFirst = false) {
  const data = state.stremioStreamsData;
  const listEl = document.getElementById("stremio-streams-list");
  const item = state.activeItem;
  if (!listEl || !data || !item) return;

  const sessionId = state.playerSessionId;
  const savedAudioBar = document.getElementById("stremio-audio-tracks-bar");
  listEl.innerHTML = "";

  const torrOnline = Boolean(data.torrserver_connected);
  const debridReady = Boolean(data.debrid_ready);
  const remuxAvail = Boolean(data.remux_available);
  const modeLabel = data.mode === "torbox" ? "TorBox HTTPS" : "Real-Debrid HTTPS";
  const torrAddr = String(data.torrserver_url || "http://127.0.0.1:8090");
  const allStreams = Array.isArray(data.streams) ? data.streams : [];
  const video = document.getElementById("native-video");

  const statusBanner = document.createElement("div");
  statusBanner.className = `atv-b4k-status-banner ${torrOnline || debridReady ? "is-online" : "is-offline"}`;
  if (debridReady) {
    statusBanner.innerHTML = `
      <span><strong>${escapeHtml(modeLabel)} ${t("активен", "active")}</strong>${
      remuxAvail ? t(" · ремукс звука DTS/AC3 -> AAC включен", " · DTS/AC3 -> AAC remux active") : ""
    } — ${t(
      "потоки аддонов Stremio и субтитры OpenSubtitles готовы",
      "Stremio addon streams and OpenSubtitles are ready"
    )}</span>
      <div class="atv-b4k-banner-actions">
        <button type="button" class="atv-btn-secondary atv-btn-xs btn-recheck-stremio">${t(
          "Обновить",
          "Refresh"
        )}</button>
      </div>
    `;
  } else if (torrOnline) {
    statusBanner.innerHTML = `
      <span><strong>${t("TorrServer подключен", "TorrServer connected")}</strong> (${escapeHtml(torrAddr)})${
      remuxAvail ? t(" · ремукс звука DTS/AC3 -> AAC активен", " · DTS/AC3 -> AAC remux active") : ""
    } — ${t(
      "прямое воспроизведение потоков Stremio с выбором дорожек и субтитров",
      "direct playback of Stremio streams with audio tracks and subtitles"
    )}</span>
      <div class="atv-b4k-banner-actions">
        <button type="button" class="atv-btn-secondary atv-btn-xs btn-recheck-stremio">${t(
          "Обновить",
          "Refresh"
        )}</button>
      </div>
    `;
  } else {
    statusBanner.innerHTML = `
      <span><strong>${t("TorrServer не запущен", "TorrServer not running")}</strong> (${escapeHtml(
      torrAddr
    )}). ${t(
      "Прямые HTTP-аддоны работают сразу; для торрент-аддонов запустите TorrServer или подключите Debrid.",
      "Direct HTTP addons work immediately; for P2P torrent addons start TorrServer or configure Debrid."
    )}</span>
      <div class="atv-b4k-banner-actions">
        <button type="button" class="atv-btn-secondary atv-btn-xs btn-recheck-stremio">${t(
          "Проверить снова",
          "Check again"
        )}</button>
      </div>
    `;
  }
  statusBanner.querySelector(".btn-recheck-stremio")?.addEventListener("click", () => {
    const { cur } = getEffectivePlaybackTiming(video);
    loadStremioStreams(cur > 5 ? cur : resumeTime);
  });
  listEl.appendChild(statusBanner);

  if (savedAudioBar && state.activeStremioStreamKey) {
    listEl.appendChild(savedAudioBar);
  }

  const filterMode = state.stremioFilter || "all";
  let filtered = allStreams.filter((st) => {
    const langs = Array.isArray(st.languages) ? st.languages : [];
    const voices = Array.isArray(st.detected_voices) ? st.detected_voices : [];
    const qual = String(st.quality || "");
    if (filterMode === "ru") {
      return langs.includes("RU") || voices.length > 0 || /rus|рус|дубляж|rezka|lostfilm/i.test(st.title || "");
    }
    if (filterMode === "orig") {
      return langs.includes("EN") || !langs.includes("RU");
    }
    if (filterMode === "4k") {
      return /4k|2160/i.test(qual);
    }
    if (filterMode === "1080p") {
      return /1080/i.test(qual);
    }
    return true;
  });

  if (filterMode === "orig") {
    filtered = filtered.slice().sort((a, b) => {
      const aPureEn = !(a.languages || []).includes("RU") ? 1 : 0;
      const bPureEn = !(b.languages || []).includes("RU") ? 1 : 0;
      if (bPureEn !== aPureEn) return bPureEn - aPureEn;
      return (Number(b.seeders) || 0) - (Number(a.seeders) || 0);
    });
  }

  if (filtered.length === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.style.cssText = "padding:14px 4px;font-size:12.5px;color:rgba(235,235,245,0.6);";
    emptyEl.textContent =
      allStreams.length === 0
        ? data.error ||
          t(
            "Потоки в активных аддонах Stremio для этого тайтла не найдены. Вы можете подключить дополнительные manifest.json в настройках.",
            "No streams found in active Stremio addons for this title. You can add more manifest.json addons in Settings."
          )
        : t(
            "В выбранном фильтре нет раздач — переключите фильтр на «Все».",
            'No streams match the selected filter — switch the filter to "All".'
          );
    listEl.appendChild(emptyEl);
    return;
  }

  const syncActiveStremioRows = () => {
    listEl.querySelectorAll(".release-row").forEach((rEl) => {
      const rKey = rEl.dataset.releaseKey || "";
      const isPlaying = Boolean(rKey && rKey === state.activeStremioStreamKey);
      rEl.classList.toggle("active-release", isPlaying);
      const btn = rEl.querySelector(".btn-play-stremio-rel");
      if (btn) {
        btn.className = `${isPlaying ? "atv-btn-playing" : "atv-btn-primary"} atv-btn-xs btn-play-stremio-rel`;
        btn.innerHTML = isPlaying
          ? `${iconSvg("check", 11)}<span>${t("Сейчас играет", "Playing")}</span>`
          : `${iconSvg("play", 11)}<span>${t("Смотреть", "Watch")}</span>`;
      }
    });
  };

  const launchStremioStream = async (st, stKey, startAtSec) => {
    const loader = document.getElementById("video-loader");
    const loaderText = document.getElementById("video-loader-text");
    const addonLabel = st.addon_name || "Stremio";
    const qualLabel = st.quality || "1080p";

    if (st.stream_kind === "direct_http" && st.direct_url) {
      state.activeStremioStreamKey = stKey;
      state.activeStudioName = `${addonLabel} (${qualLabel})`;
      syncActiveStremioRows();
      await probeAndPlay4KStream(st.direct_url, startAtSec, qualLabel, sessionId, {
        targetListId: "stremio-streams-list",
        audioBarId: "stremio-audio-tracks-bar",
        inlineSelectId: "stremio-inline-audio-select",
        sourcePrefix: addonLabel,
        extraSubtitles: state.externalStremioSubs,
      });
      return;
    }

    if (!st.magnet && !st.info_hash) return;
    if (state.stremioResolveAbortController) {
      try {
        state.stremioResolveAbortController.abort();
      } catch (_) {}
    }
    const resolveAbort = new AbortController();
    state.stremioResolveAbortController = resolveAbort;
    if (loader && loaderText) {
      loaderText.textContent = t(
        `Подключение к потоку ${addonLabel} (${qualLabel})...`,
        `Connecting to ${addonLabel} stream (${qualLabel})...`
      );
      loader.classList.remove("hidden");
    }
    try {
      const rRes = await fetch("/api/stremio/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: resolveAbort.signal,
        body: JSON.stringify({
          magnet: st.magnet || "",
          info_hash: st.info_hash || "",
          file_idx: st.file_idx,
          filename_hint: st.filename_hint || "",
          title: item.orig_title || item.title || "",
          media_type: item.media_type || "movie",
          season: state.activeSeason,
          episode: state.activeEpisode,
        }),
      });
      const rJson = await rRes.json();
      if (!state.isPlayerOpen || sessionId !== state.playerSessionId) return;
      if (!rJson.ok || !rJson.stream_url) {
        loader?.classList.add("hidden");
        showToast(rJson.error || t("Не удалось подготовить поток Stremio", "Could not prepare Stremio stream"));
        return;
      }
      state.activeStremioStreamKey = stKey;
      state.activeStudioName = `${addonLabel} (${qualLabel})`;
      syncActiveStremioRows();
      await probeAndPlay4KStream(rJson.stream_url, startAtSec, qualLabel, sessionId, {
        targetListId: "stremio-streams-list",
        audioBarId: "stremio-audio-tracks-bar",
        inlineSelectId: "stremio-inline-audio-select",
        sourcePrefix: addonLabel,
        extraSubtitles: state.externalStremioSubs,
      });
    } catch (err) {
      if (err && err.name === "AbortError") return;
      loader?.classList.add("hidden");
      showToast(t("Ошибка при подключении к потоку Stremio", "Error connecting to Stremio stream"));
    }
  };

  filtered.forEach((st, idx) => {
    const stKey = String(st.id || st.info_hash || `st_${idx}_${st.title || ""}`);
    const canPlayDirect = Boolean(
      (st.stream_kind === "direct_http" && st.direct_url) ||
        ((torrOnline || debridReady) && (st.magnet || st.info_hash))
    );
    const magnetUri = String(st.magnet || "");
    const langs = Array.isArray(st.languages) ? st.languages : [];
    const voices = Array.isArray(st.detected_voices) ? st.detected_voices.slice(0, 3) : [];
    const is4k = /4k|2160/i.test(st.quality || "");

    const metaParts = [st.quality || "1080p"];
    if (st.size) {
      const szText = isEn()
        ? String(st.size).replace(/ГБ/g, "GB").replace(/МБ/g, "MB").replace(/ТБ/g, "TB")
        : String(st.size);
      metaParts.push(szText);
    }
    if (st.stream_kind === "direct_http") {
      metaParts.push(t("Прямой HTTPS", "Direct HTTPS"));
    } else if (Number(st.seeders) > 0) {
      metaParts.push(`${t("Сиды:", "Seeders:")} ${st.seeders}`);
    }
    if (st.tracker) metaParts.push(st.tracker);

    const badgesHtml = [
      `<span class="atv-stremio-badge is-addon">${escapeHtml(st.addon_name || "Stremio")}</span>`,
      is4k ? `<span class="atv-stremio-badge is-4k">${escapeHtml(st.quality)}</span>` : "",
      langs.length > 0
        ? `<span class="atv-stremio-badge is-ru">${escapeHtml(langs.join(" + "))}</span>`
        : "",
      ...voices.map((v) => `<span class="atv-stremio-badge is-voice">${escapeHtml(translateStudioName(v))}</span>`),
    ]
      .filter(Boolean)
      .join("");

    const row = document.createElement("div");
    row.className = "release-row";
    row.dataset.releaseKey = stKey;
    row.innerHTML = `
      <div style="min-width:0;flex:1 1 0;">
        <div class="release-title">${escapeHtml(st.title || displayTitle(item))}</div>
        <div class="release-meta">${escapeHtml(metaParts.join(" · "))}</div>
        <div class="atv-stremio-badges-row">${badgesHtml}</div>
      </div>
      <div class="release-actions">
        ${
          magnetUri
            ? `<button type="button" class="atv-btn-secondary atv-btn-xs btn-copy-magnet" title="${escapeAttr(
                t("Скопировать Magnet-ссылку", "Copy Magnet link")
              )}">Magnet</button>`
            : ""
        }
        ${
          canPlayDirect
            ? `<button type="button" class="atv-btn-primary atv-btn-xs btn-play-stremio-rel">${iconSvg(
                "play",
                11
              )}<span>${t("Смотреть", "Watch")}</span></button>`
            : magnetUri
            ? `<button type="button" class="atv-btn-primary atv-btn-xs btn-open-magnet" title="${escapeAttr(
                t("Открыть Magnet-ссылку", "Open Magnet link")
              )}">${iconSvg("external", 11)}<span>${t("Открыть Magnet", "Open Magnet")}</span></button>`
            : ""
        }
      </div>
    `;

    row.querySelector(".btn-copy-magnet")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(magnetUri);
        showToast(
          t(
            `Magnet-ссылка скопирована (${st.quality || "Stremio"})`,
            `Magnet link copied (${st.quality || "Stremio"})`
          )
        );
      } catch (_) {
        window.open(magnetUri, "_self");
      }
    });
    row.querySelector(".btn-open-magnet")?.addEventListener("click", () => {
      window.location.href = magnetUri;
    });
    row.querySelector(".btn-play-stremio-rel")?.addEventListener("click", () => {
      if (state.activeStremioStreamKey === stKey && video && video.getAttribute("src")) {
        if (video.paused) video.play().catch(() => {});
        return;
      }
      const { cur } = getEffectivePlaybackTiming(video);
      launchStremioStream(st, stKey, cur > 5 ? cur : resumeTime);
    });
    listEl.appendChild(row);
  });

  const firstPlayable = filtered.find(
    (s) =>
      (s.stream_kind === "direct_http" && s.direct_url) ||
      (torrOnline && !debridReady && (s.magnet || s.info_hash))
  );
  if (
    autoLaunchFirst &&
    firstPlayable &&
    video &&
    !video.getAttribute("src") &&
    !state.hlsInstance
  ) {
    const firstKey = String(
      firstPlayable.id || firstPlayable.info_hash || `st_0_${firstPlayable.title || ""}`
    );
    launchStremioStream(firstPlayable, firstKey, resumeTime);
  } else {
    syncActiveStremioRows();
  }
}
export async function loadStremioStreams(resumeTime = 0) {
  if (!state.activeItem || !state.isPlayerOpen) return;
  const sessionId = state.playerSessionId;
  const item = state.activeItem;
  hideVideoStreamError();
  state.remuxMeta = null;
  state.activeStremioStreamKey = "";

  const listEl = document.getElementById("stremio-streams-list");
  const imdbBadge = document.getElementById("stremio-imdb-badge");
  const subsBadge = document.getElementById("stremio-subs-badge");
  if (imdbBadge) imdbBadge.classList.add("hidden");
  if (subsBadge) subsBadge.classList.add("hidden");
  if (listEl) {
    listEl.innerHTML = `<div style="font-size:12px;color:rgba(235,235,245,0.5)">${escapeHtml(
      t(
        `Запрос потоков и субтитров из аддонов Stremio для «${displayTitle(item)}»...`,
        `Fetching Stremio streams and subtitles for "${displayTitle(item)}"...`
      )
    )}</div>`;
  }

  if (state.streamAbortController) {
    try {
      state.streamAbortController.abort();
    } catch (_) {}
  }
  const abortController = new AbortController();
  state.streamAbortController = abortController;

  try {
    const params = new URLSearchParams({
      id: item.id || "",
      title: item.title || "",
      orig_title: item.orig_title || "",
      imdb_id: item.imdb_id || "",
      year: String(item.year || ""),
      media_type: item.media_type || "movie",
      season: String(state.activeSeason || 1),
      episode: String(state.activeEpisode || 1),
      lang: state.appLang || "ru",
    });
    const res = await fetch(`/api/stremio/streams?${params.toString()}`, {
      signal: abortController.signal,
    });
    const data = await res.json();
    if (!state.isPlayerOpen || sessionId !== state.playerSessionId || state.activeSourceTab !== "stremio") {
      return;
    }

    if (data.imdb_id) {
      item.imdb_id = data.imdb_id;
      if (imdbBadge) {
        imdbBadge.textContent = `IMDb ${data.imdb_id}`;
        imdbBadge.classList.remove("hidden");
      }
    }
    const extSubs = Array.isArray(data.subtitles) ? data.subtitles : [];
    state.externalStremioSubs = extSubs;
    if (subsBadge && extSubs.length > 0) {
      subsBadge.textContent = t(`Субтитры: ${extSubs.length}`, `Subtitles: ${extSubs.length}`);
      subsBadge.classList.remove("hidden");
    }

    if (
      item.media_type === "series" &&
      data.seasons_map &&
      Object.keys(data.seasons_map).length > 0 &&
      Object.keys(state.seasonsMap || {}).length === 0
    ) {
      state.seasonsMap = data.seasons_map;
      if (data.episodes_titles && Object.keys(data.episodes_titles).length > 0) {
        state.episodesTitles = { ...data.episodes_titles, ...(state.episodesTitles || {}) };
      }
      populateSeasonEpisodeSelectors(item, state.seasonsMap);
      updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);
    }

    state.torrserverConnected = Boolean(data.torrserver_connected);
    state.remuxAvailable = Boolean(data.remux_available);
    state.stremioStreamsData = data;
    renderStremioStreamsList(resumeTime, true);
  } catch (err) {
    if (err && err.name === "AbortError") return;
    console.error("Stremio streams error:", err);
    if (listEl) {
      listEl.innerHTML = `<div style="padding:12px 4px;font-size:12.5px;color:rgba(235,235,245,0.6);">${t(
        "Не удалось получить ответ от аддонов Stremio. Проверьте соединение или настройки аддонов.",
        "Could not reach Stremio addons. Check your connection or addon settings."
      )}</div>`;
    }
  }
}
export async function loadBackup4KReleases(resumeTime = 0) {
  if (!state.activeItem || !state.isPlayerOpen) return;
  const sessionId = state.playerSessionId;
  const item = state.activeItem;
  hideVideoStreamError();
  const listEl = document.getElementById("backup-releases-list");
  listEl.innerHTML = `<div style="font-size:12px;color:rgba(235,235,245,0.5)">${escapeHtml(
    t(
      `Загрузка и сортировка 4K UHD / BDRemux раздач для «${displayTitle(item)}»...`,
      `Loading and ranking 4K UHD / BDRemux releases for "${displayTitle(item)}"...`
    )
  )}</div>`;

  const syncActiveReleaseRows = () => {
    listEl.querySelectorAll(".release-row").forEach((rEl) => {
      const rKey = rEl.dataset.releaseKey || "";
      const isPlaying = Boolean(rKey && rKey === state.active4kReleaseKey);
      rEl.classList.toggle("active-release", isPlaying);
      const btn = rEl.querySelector(".btn-play-4k-rel");
      if (btn) {
        btn.className = `${isPlaying ? "atv-btn-playing" : "atv-btn-primary"} atv-btn-xs btn-play-4k-rel`;
        btn.innerHTML = isPlaying
          ? `${iconSvg("check", 11)}<span>${t("Сейчас играет", "Playing")}</span>`
          : `${iconSvg("play", 11)}<span>${t("Смотреть 4K", "Watch 4K")}</span>`;
      }
    });
  };

  if (state.backup4kAbortController) {
    try {
      state.backup4kAbortController.abort();
    } catch (_) {}
  }
  const b4kAbort = new AbortController();
  state.backup4kAbortController = b4kAbort;

  try {
    const params = new URLSearchParams({
      id: item.rezka_id || item.id,
      rezka_url: item.rezka_url || "",
      title: item.title,
      orig_title: item.orig_title || "",
      year: String(item.year || 2024),
      media_type: item.media_type || "movie",
      season: String(state.activeSeason),
      episode: String(state.activeEpisode),
      lang: state.appLang || "ru",
    });
    const res = await fetch(`/api/backup-streams?${params.toString()}`, {
      signal: b4kAbort.signal,
    });
    const data = await res.json();

    if (!state.isPlayerOpen || sessionId !== state.playerSessionId) return;

    state.external4kSubs = Array.isArray(data.subtitles) ? data.subtitles : [];
    listEl.innerHTML = "";
    const torrOnline = Boolean(data.torrserver_connected);
    const debridReady = Boolean(data.debrid_ready);
    const remuxAvail = Boolean(data.remux_available);
    state.torrserverConnected = torrOnline;
    state.remuxAvailable = remuxAvail;
    const modeLabel = data.mode === "torbox" ? "TorBox HTTPS" : "Real-Debrid HTTPS";
    const torrAddr = String(data.torrserver_url || "http://127.0.0.1:8090");
    const fallbackUrl = String(data.fallback_stream_url || "");
    const releases = data.releases || [];
    const video = document.getElementById("native-video");

    const statusBanner = document.createElement("div");
    statusBanner.className = `atv-b4k-status-banner ${torrOnline || debridReady ? "is-online" : "is-offline"}`;
    if (debridReady) {
      statusBanner.innerHTML = `
        <span><strong>${escapeHtml(modeLabel)} ${t("активен", "active")}</strong>${
        remuxAvail ? t(" · ремукс звука DTS/AC3 -> AAC включен", " · DTS/AC3 -> AAC remux active") : ""
      } — ${t(
        "прямое облачное воспроизведение 4K без P2P",
        "direct cloud 4K playback without P2P"
      )}</span>
        <div class="atv-b4k-banner-actions">
          <button type="button" class="atv-btn-secondary atv-btn-xs btn-recheck-torr">${t("Обновить", "Refresh")}</button>
        </div>
      `;
    } else if (torrOnline) {
      statusBanner.innerHTML = `
        <span><strong>${t("TorrServer подключен", "TorrServer connected")}</strong> (${escapeHtml(torrAddr)})${
        remuxAvail ? t(" · ремукс звука DTS/AC3 -> AAC активен", " · DTS/AC3 -> AAC remux active") : ""
      } — ${t(
        "прямое воспроизведение 4K UHD BDRemux со звуком и выбором дорожек",
        "direct 4K UHD BDRemux playback with audio track selection"
      )}</span>
        <div class="atv-b4k-banner-actions">
          <button type="button" class="atv-btn-secondary atv-btn-xs btn-recheck-torr">${t("Обновить", "Refresh")}</button>
        </div>
      `;
    } else {
      statusBanner.innerHTML = `
        <span><strong>${t("TorrServer не запущен", "TorrServer not running")}</strong> (${escapeHtml(
        torrAddr
      )}). ${t(
        "Запустите TorrServer или укажите ключ Real-Debrid / TorBox в настройках сети.",
        "Start TorrServer or enter a Real-Debrid / TorBox API key in Network settings."
      )}</span>
        <div class="atv-b4k-banner-actions">
          ${
            fallbackUrl
              ? `<button type="button" class="atv-btn-secondary atv-btn-xs btn-play-hdrezka-fallback">${iconSvg(
                  "play",
                  10
                )}<span>${t("Резервный 1080p (HDRezka)", "Fallback 1080p (HDRezka)")}</span></button>`
              : ""
          }
          <button type="button" class="atv-btn-secondary atv-btn-xs btn-recheck-torr">${t(
            "Проверить снова",
            "Check again"
          )}</button>
        </div>
      `;
    }
    statusBanner.querySelector(".btn-recheck-torr")?.addEventListener("click", () => {
      const { cur } = getEffectivePlaybackTiming(video);
      loadBackup4KReleases(cur > 5 ? cur : resumeTime);
    });
    statusBanner.querySelector(".btn-play-hdrezka-fallback")?.addEventListener("click", () => {
      const { cur } = getEffectivePlaybackTiming(video);
      state.active4kReleaseUrl = fallbackUrl;
      state.active4kReleaseKey = "hdrezka_fallback";
      state.activeStudioName = t("HDRezka 1080p (Резерв)", "HDRezka 1080p (Fallback)");
      syncActiveReleaseRows();
      playVideoUrl(fallbackUrl, cur > 5 ? cur : resumeTime, sessionId);
      showToast(t("Запущен резервный поток 1080p (HDRezka)", "Started 1080p fallback stream (HDRezka)"));
    });
    listEl.appendChild(statusBanner);

    if (releases.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.style.cssText = "padding:14px 4px;font-size:12.5px;color:rgba(235,235,245,0.6);";
      emptyEl.textContent = t(
        "Проверенные 4K / BDRemux раздачи не найдены (низкокачественные CamRip и TS отфильтрованы).",
        "No verified 4K / BDRemux releases found (low-quality CamRip and TS streams are filtered out)."
      );
      listEl.appendChild(emptyEl);
      return;
    }

    const launchRelease = async (rel, relKey, startAtSec) => {
      let rawUrl = String(rel.stream_url || "");
      if (rel.stream_kind === "debrid" && rel.magnet) {
        if (state.stremioResolveAbortController) {
          try {
            state.stremioResolveAbortController.abort();
          } catch (_) {}
        }
        const debridAbort = new AbortController();
        state.stremioResolveAbortController = debridAbort;
        const loader = document.getElementById("video-loader");
        const loaderText = document.getElementById("video-loader-text");
        if (loader && loaderText) {
          loaderText.textContent = t(
            `Получение облачного потока 4K (${modeLabel})...`,
            `Resolving 4K cloud stream (${modeLabel})...`
          );
          loader.classList.remove("hidden");
        }
        try {
          const dres = await fetch("/api/debrid/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: debridAbort.signal,
            body: JSON.stringify({
              magnet: rel.magnet,
              media_type: item.media_type || "movie",
              season: state.activeSeason,
              episode: state.activeEpisode,
              provider: data.mode,
            }),
          });
          const djson = await dres.json();
          if (!state.isPlayerOpen || sessionId !== state.playerSessionId) return;
          if (!djson.ok || !djson.stream_url) {
            loader?.classList.add("hidden");
            showToast(djson.error || t("Не удалось получить ссылку Debrid", "Could not resolve Debrid link"));
            return;
          }
          rawUrl = djson.stream_url;
        } catch (err) {
          if (err && err.name === "AbortError") return;
          loader?.classList.add("hidden");
          showToast(t("Ошибка соединения с сервисом Debrid", "Error connecting to Debrid service"));
          return;
        }
      }
      if (!rawUrl) return;
      state.active4kReleaseUrl = rawUrl;
      state.active4kReleaseKey = relKey;
      state.activeStudioName = `4K Remux (${rel.quality})`;
      syncActiveReleaseRows();
      await probeAndPlay4KStream(rawUrl, startAtSec, rel.quality, sessionId, {
        extraSubtitles: state.external4kSubs || [],
      });
    };

    releases.forEach((rel, idx) => {
      const relKey = String(rel.info_hash || `rel_${idx}_${rel.title || ""}`);
      const canPlayDirect = Boolean(
        (torrOnline && rel.stream_url) || (debridReady && rel.stream_kind === "debrid" && rel.magnet)
      );
      const magnetUri = String(rel.magnet || "");
      const sizeText = translateSizeLabel(rel.size || "");
      const row = document.createElement("div");
      row.className = "release-row";
      row.dataset.streamUrl = rel.stream_url || "";
      row.dataset.releaseKey = relKey;
      row.innerHTML = `
        <div style="min-width:0;flex:1 1 0;">
          <div class="release-title">${escapeHtml(rel.title)}</div>
          <div class="release-meta">
            ${escapeHtml(rel.quality)} · ${escapeHtml(sizeText)} · ${t("Сиды:", "Seeders:")} ${escapeHtml(
        rel.seeders
      )} · ${escapeHtml(rel.tracker)}
          </div>
        </div>
        <div class="release-actions">
          ${
            magnetUri
              ? `<button type="button" class="atv-btn-secondary atv-btn-xs btn-copy-magnet" title="${escapeAttr(
                  t("Скопировать Magnet-ссылку раздачи", "Copy Magnet link")
                )}">Magnet</button>`
              : ""
          }
          ${
            canPlayDirect
              ? `<button type="button" class="atv-btn-primary atv-btn-xs btn-play-4k-rel">${iconSvg(
                  "play",
                  11
                )}<span>${t("Смотреть 4K", "Watch 4K")}</span></button>`
              : magnetUri
              ? `<button type="button" class="atv-btn-primary atv-btn-xs btn-open-magnet" title="${escapeAttr(
                  t(
                    "Открыть Magnet-ссылку в торрент-клиенте или TorrServer",
                    "Open Magnet link in torrent client or TorrServer"
                  )
                )}">${iconSvg("external", 11)}<span>${t("Открыть Magnet", "Open Magnet")}</span></button>`
              : ""
          }
        </div>
      `;

      row.querySelector(".btn-copy-magnet")?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(magnetUri);
          showToast(t(`Magnet-ссылка скопирована (${rel.quality})`, `Magnet link copied (${rel.quality})`));
        } catch (_) {
          window.open(magnetUri, "_self");
        }
      });

      row.querySelector(".btn-open-magnet")?.addEventListener("click", () => {
        window.location.href = magnetUri;
      });

      const playBtn = row.querySelector(".btn-play-4k-rel");
      if (playBtn) {
        playBtn.onclick = () => {
          if (state.active4kReleaseKey === relKey && video && video.getAttribute("src")) {
            if (video.paused) video.play().catch(() => {});
            return;
          }
          const { cur } = getEffectivePlaybackTiming(video);
          launchRelease(rel, relKey, cur > 5 ? cur : resumeTime);
        };
      }
      listEl.appendChild(row);
    });

    if (
      state.activeSourceTab === "backup4k" &&
      torrOnline &&
      !debridReady &&
      releases.length > 0 &&
      releases[0].stream_url &&
      video &&
      !video.getAttribute("src") &&
      !state.hlsInstance
    ) {
      const firstKey = String(releases[0].info_hash || `rel_0_${releases[0].title || ""}`);
      launchRelease(releases[0], firstKey, resumeTime);
    } else {
      syncActiveReleaseRows();
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;
    console.error("Backup stream error:", err);
  }
}
export function playVideoUrl(streamUrl, startTime = 0, sessionId = state.playerSessionId, options = {}) {
  const { keepRemuxMeta = false, newRemuxOffsetSec } = options;
  if (!keepRemuxMeta) {
    state.remuxMeta = null;
  }
  let video = document.getElementById("native-video");
  const loader = document.getElementById("video-loader");
  if (!video || !streamUrl || !state.isPlayerOpen || sessionId !== state.playerSessionId) {
    loader?.classList.add("hidden");
    return;
  }

  // Detach any listeners from a previous stream BEFORE resetting HLS / video.src
  abortActiveVideoListeners();
  const loadToken = state.videoLoadToken;
  const loadAbort = new AbortController();
  state.videoLoadAbort = loadAbort;

  hideVideoStreamError();
  clearAutoplayNextTimer();
  state.currentStreamUrl = streamUrl;
  syncDownloadButtonVisibility();
  state.introSkippedThisEpisode = false;
  state.autoplayCancelledThisEpisode = false;
  if (state.activeSourceTab !== "hdrezka") {
    initAdSkipSession(null, streamUrl);
  } else {
    state.active4kReleaseUrl = "";
    state.active4kReleaseKey = "";
    state.activeStremioStreamKey = "";
  }
  if (state.hlsInstance) {
    try {
      state.hlsInstance.destroy();
    } catch (_) {}
    state.hlsInstance = null;
  }
  video.onloadedmetadata = null;
  try {
    video.pause();
  } catch (_) {}
  video.querySelectorAll("track").forEach((tr) => tr.remove());
  if (keepRemuxMeta && state.remuxMeta?.active && typeof newRemuxOffsetSec === "number") {
    try {
      video.currentTime = 0;
    } catch (_) {}
    state.remuxMeta.offsetSec = newRemuxOffsetSec;
  }

  if (video._cfLastCorsUrl !== streamUrl) {
    video._cfLastCorsUrl = streamUrl;
    video._cfCorsBlocked = false;
  }

  const isSameOriginUrl =
    String(streamUrl).startsWith("/") ||
    (typeof window !== "undefined" &&
      window.location?.origin &&
      String(streamUrl).startsWith(window.location.origin));

  // Only enable crossorigin="anonymous" on external streams when WebAudio DSP is active or already bound.
  const needsCorsForWebAudio = Boolean(
    !isSameOriginUrl &&
      !video._cfCorsBlocked &&
      (video._cfSourceNode ||
        (state.audioBoost && state.audioBoost > 1.01) ||
        (state.audioPreset && state.audioPreset !== "flat"))
  );
  if (needsCorsForWebAudio) {
    if (!video.hasAttribute("crossorigin")) {
      video.setAttribute("crossorigin", "anonymous");
    }
  } else if (video.hasAttribute("crossorigin")) {
    video.removeAttribute("crossorigin");
  }
  applySavedPlayerPrefsToVideo(video);
  let corsRetried = false;

  const isStaleLoad = () =>
    !state.isPlayerOpen ||
    sessionId !== state.playerSessionId ||
    loadToken !== state.videoLoadToken ||
    loadAbort.signal.aborted;

  const attemptAudiblePlay = () => {
    if (isStaleLoad()) return;
    if (state.audioCtx && state.audioCtx.state === "suspended") {
      state.audioCtx.resume().catch(() => {});
    }
    if (!state.userMutedThisSession && video.muted) {
      state.internalMuteOverride = true;
      video.muted = false;
      state.internalMuteOverride = false;
    }
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((err) => {
        if (isStaleLoad()) return;
        // If browser blocked unmuted autoplay after async network fetch, start muted and unmute on first click/key
        if (err && (err.name === "NotAllowedError" || String(err).includes("NotAllowed"))) {
          state.internalMuteOverride = true;
          video.muted = true;
          state.internalMuteOverride = false;
          syncCustomVideoControlsUI(true);
          video.play().catch(() => {});
          showToast(
            t(
              "Браузер приглушил автозапуск — кликните по видео для включения звука",
              "Browser muted autoplay — click the video to enable sound"
            )
          );
          const unlockOnce = () => {
            document.removeEventListener("pointerdown", unlockOnce, true);
            document.removeEventListener("keydown", unlockOnce, true);
            if (!state.userMutedThisSession && video) {
              state.internalMuteOverride = true;
              video.muted = false;
              if (video.volume <= 0.02) video.volume = 0.85;
              state.internalMuteOverride = false;
              if (state.audioCtx && state.audioCtx.state === "suspended") {
                state.audioCtx.resume().catch(() => {});
              }
              syncCustomVideoControlsUI(true);
            }
          };
          document.addEventListener("pointerdown", unlockOnce, { capture: true, once: true });
          document.addEventListener("keydown", unlockOnce, { capture: true, once: true });
        }
      });
    }
  };

  const hideLoader = () => {
    if (isStaleLoad()) return;
    loader.classList.add("hidden");
    hideVideoStreamError();
    if (keepRemuxMeta && state.remuxMeta?.active && !(state.remuxMeta.duration > 10)) {
      scheduleRemuxFullDurationProbe(sessionId);
    }
  };
  const onVideoError = () => {
    if (isStaleLoad()) return;
    const errCode = video.error?.code || 0;
    const curAttrSrc = video.getAttribute("src") || "";
    // Ignore aborted loads (code 1) or empty src resets during rapid switching
    if (errCode === 1 || (!curAttrSrc && !state.hlsInstance)) {
      return;
    }
    // Automatic Apple VideoToolbox H.264 transcode fallback if client cannot decode raw HEVC / AV1 / DV video
    if (
      keepRemuxMeta &&
      state.remuxMeta?.active &&
      !state.remuxMeta.forceH264 &&
      (errCode === 3 || errCode === 4)
    ) {
      state.remuxMeta.forceH264 = true;
      const fallbackUrl = buildRemuxStreamEndpoint(state.remuxMeta, state.remuxMeta.offsetSec || 0);
      showToast(
        t(
          "Включено аппаратное перекодирование видео H.264 для совместимости с браузером",
          "Switched to hardware H.264 video transcoding for browser compatibility"
        )
      );
      playVideoUrl(fallbackUrl, 0, sessionId, { keepRemuxMeta: true });
      return;
    }
    // Automatic fallback if an external CDN omits Access-Control-Allow-Origin
    if (
      !corsRetried &&
      video.hasAttribute("crossorigin") &&
      /^https?:\/\//i.test(streamUrl)
    ) {
      corsRetried = true;
      if (video._cfSourceNode) {
        try {
          video._cfSourceNode.disconnect();
        } catch (_) {}
        const freshVideo = video.cloneNode(false);
        freshVideo.removeAttribute("crossorigin");
        freshVideo.removeAttribute("src");
        freshVideo._cfLastCorsUrl = streamUrl;
        freshVideo._cfCorsBlocked = true;
        video.replaceWith(freshVideo);
        video = freshVideo;
        bindNativeVideoElementListeners(video);
        applySavedPlayerPrefsToVideo(video);
      } else {
        video._cfCorsBlocked = true;
        video.removeAttribute("crossorigin");
      }
      if (state.hlsInstance) {
        try {
          state.hlsInstance.destroy();
        } catch (_) {}
        state.hlsInstance = null;
        if (window.Hls && window.Hls.isSupported()) {
          const retryHls = new window.Hls({ enableWorker: true });
          state.hlsInstance = retryHls;
          retryHls.loadSource(streamUrl);
          retryHls.attachMedia(video);
          attachVideoSubtitles();
          retryHls.on(window.Hls.Events.MANIFEST_PARSED, () => {
            if (isStaleLoad()) {
              video.pause();
              return;
            }
            hideLoader();
            applySavedPlayerPrefsToVideo(video);
            if (startTime > 0) video.currentTime = startTime;
            attemptAudiblePlay();
          });
          retryHls.on(window.Hls.Events.ERROR, (_, errData) => {
            if (errData && errData.fatal && !isStaleLoad()) {
              onVideoError();
            }
          });
          return;
        }
      }
      video.addEventListener("error", onVideoError, { once: true, signal: loadAbort.signal });
      video.src = streamUrl;
      video.addEventListener(
        "loadedmetadata",
        () => {
          if (isStaleLoad()) {
            video.pause();
            return;
          }
          hideLoader();
          applySavedPlayerPrefsToVideo(video);
          if (startTime > 0) video.currentTime = startTime;
          attemptAudiblePlay();
        },
        { once: true, signal: loadAbort.signal }
      );
      video.load();
      return;
    }
    loader.classList.add("hidden");
    if (state.activeSourceTab !== "trailer") {
      showVideoStreamError(
        t("Не удалось воспроизвести видеопоток", "Could not play video stream"),
        t(
          "Попробуйте повторить подключение, выбрать другую студию озвучки или переключиться на 4K",
          "Try reconnecting, choosing another audio track, or switching to Stremio / 4K"
        )
      );
    }
  };
  video.addEventListener("loadeddata", hideLoader, { once: true, signal: loadAbort.signal });
  video.addEventListener("canplay", hideLoader, { once: true, signal: loadAbort.signal });
  video.addEventListener("error", onVideoError, { once: true, signal: loadAbort.signal });

  if (streamUrl.includes(".m3u8") && window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({ enableWorker: true });
    state.hlsInstance = hls;
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
    attachVideoSubtitles();
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      if (isStaleLoad()) {
        video.pause();
        return;
      }
      hideLoader();
      applySavedPlayerPrefsToVideo(video);
      if (startTime > 0) video.currentTime = startTime;
      attemptAudiblePlay();
    });
    hls.on(window.Hls.Events.ERROR, (_, errData) => {
      if (errData && errData.fatal && !isStaleLoad()) {
        onVideoError();
      }
    });
  } else {
    video.src = streamUrl;
    attachVideoSubtitles();
    video.addEventListener(
      "loadedmetadata",
      () => {
        if (isStaleLoad()) {
          video.pause();
          return;
        }
        hideLoader();
        applySavedPlayerPrefsToVideo(video);
        if (startTime > 0) video.currentTime = startTime;
        attemptAudiblePlay();
      },
      { once: true, signal: loadAbort.signal }
    );
  }
}
export function stopAdSkipSession(notifyBackend = false) {
  if (state.adPollStartDelayId) {
    clearTimeout(state.adPollStartDelayId);
    state.adPollStartDelayId = null;
  }
  if (state.adPollTimerId) {
    clearInterval(state.adPollTimerId);
    state.adPollTimerId = null;
  }
  if (state.adLiveCheckTimerId) {
    clearInterval(state.adLiveCheckTimerId);
    state.adLiveCheckTimerId = null;
  }
  state.adLiveCheckBusy = false;
  state.adSteppingActive = false;
  state.activeManualAdSeg = null;
  document.getElementById("skip-ad-btn")?.classList.add("hidden");
  const markersEl = document.getElementById("vc-ad-markers");
  if (markersEl) markersEl.innerHTML = "";
  if (notifyBackend) {
    fetch("/api/ad-scan-stop", { method: "POST" }).catch(() => {});
  }
}
export function renderAdTimelineMarkers(video) {
  const markersEl = document.getElementById("vc-ad-markers");
  if (!markersEl) return;
  const dur = video && Number.isFinite(video.duration) && video.duration > 30 ? video.duration : 0;
  const segs = Array.isArray(state.adSegments) ? state.adSegments : [];
  if (!dur || segs.length === 0) {
    markersEl.innerHTML = "";
    return;
  }
  markersEl.innerHTML = segs
    .map((s) => {
      const st = Math.max(0, Number(s.start) || 0);
      const en = Math.min(dur, Math.max(st + 1, Number(s.end) || st + 1));
      const leftPct = Math.min(99.5, Math.max(0, (st / dur) * 100));
      const widthPct = Math.max(0.35, Math.min(100 - leftPct, ((en - st) / dur) * 100));
      const titleTxt = t(
        `Рекламная вставка (${formatTime(st)}–${formatTime(en)})`,
        `Embedded ad (${formatTime(st)}–${formatTime(en)})`
      );
      return `<div class="atv-vc-ad-seg" style="left:${leftPct.toFixed(2)}%;width:${widthPct.toFixed(2)}%" title="${escapeAttr(titleTxt)}"></div>`;
    })
    .join("");
}
export function checkAndSkipActiveAd(video) {
  const skipAdBtn = document.getElementById("skip-ad-btn");
  if (
    !video ||
    !state.isPlayerOpen ||
    state.activeSourceTab === "trailer" ||
    state.adSteppingActive
  ) {
    skipAdBtn?.classList.add("hidden");
    state.activeManualAdSeg = null;
    return;
  }

  const segs = Array.isArray(state.adSegments) ? state.adSegments : [];
  if (segs.length === 0) {
    skipAdBtn?.classList.add("hidden");
    state.activeManualAdSeg = null;
    return;
  }

  const cur = video.currentTime || 0;
  const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const activeSeg = segs.find(
    (s) => cur >= Math.max(0, (Number(s.start) || 0) - 0.15) && cur < (Number(s.end) || 0) - 0.55
  );

  if (!activeSeg) {
    skipAdBtn?.classList.add("hidden");
    state.activeManualAdSeg = null;
    return;
  }

  const segStart = Number(activeSeg.start) || 0;
  const segEnd = Number(activeSeg.end) || 0;
  const segKey = `${segStart.toFixed(1)}_${segEnd.toFixed(1)}`;
  const isSplice = activeSeg.kind !== "banner";

  if (state.autoSkipAds && isSplice && !video.seeking) {
    const lastSkippedAt = state.adSkippedIds[segKey] || 0;
    if (Date.now() - lastSkippedAt > 6500) {
      state.adSkippedIds[segKey] = Date.now();
      const targetSec = dur > 0 ? Math.min(dur - 0.4, segEnd + 0.2) : segEnd + 0.2;
      video.currentTime = targetSec;
      skipAdBtn?.classList.add("hidden");
      state.activeManualAdSeg = null;
      showToast(
        t(
          `Реклама пропущена (${formatTime(segStart)}–${formatTime(segEnd)})`,
          `Ad skipped (${formatTime(segStart)}–${formatTime(segEnd)})`
        )
      );
      return;
    }
  }

  state.activeManualAdSeg = activeSeg;
  if (skipAdBtn) {
    const remSec = Math.max(1, Math.round(segEnd - cur));
    skipAdBtn.textContent = isEn()
      ? `Skip ad (${remSec} ${remSec === 1 ? "second" : "seconds"})`
      : `Пропустить рекламу (${remSec} ${pluralRu(remSec, "секунда", "секунды", "секунд")})`;
    skipAdBtn.classList.remove("hidden");
  }
}
export function captureLiveFrameJpegB64(video) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return "";
  try {
    if (!state.adCaptureCanvas) {
      const c = document.createElement("canvas");
      c.width = 480;
      c.height = 270;
      state.adCaptureCanvas = c;
      state.adCaptureCtx = c.getContext("2d", { willReadFrequently: false });
    }
    const ctx = state.adCaptureCtx;
    if (!ctx) return "";
    ctx.drawImage(video, 0, 0, 480, 270);
    return state.adCaptureCanvas.toDataURL("image/jpeg", 0.72);
  } catch (_) {
    return "";
  }
}
export async function stepPastLiveHlsAd(video, initialStartSec) {
  if (!video || state.adSteppingActive) return;
  state.adSteppingActive = true;
  const sessionId = state.playerSessionId;
  const wasMuted = video.muted;
  state.internalMuteOverride = true;
  video.muted = true;

  let curTarget = initialStartSec;
  let lastAdSec = initialStartSec;
  try {
    for (let step = 0; step < 8; step++) {
      if (!state.isPlayerOpen || sessionId !== state.playerSessionId) break;
      const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      curTarget += 6.0;
      if (dur > 0 && curTarget >= dur - 2) break;

      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(tid);
          resolve();
        };
        const tid = setTimeout(done, 1200);
        video.addEventListener("seeked", done, { once: true });
        video.currentTime = curTarget;
      });
      await new Promise((r) => setTimeout(r, 140));

      const b64 = captureLiveFrameJpegB64(video);
      if (!b64) break;
      const res = await fetch("/api/ad-detect-frame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jpeg_b64: b64,
          timestamp: video.currentTime || curTarget,
          stream_key: state.adStreamKey,
        }),
      });
      const out = await res.json();
      if (out && out.is_ad) {
        lastAdSec = video.currentTime || curTarget;
      } else {
        const cleanSec = video.currentTime || curTarget;
        const startClean = initialStartSec <= 4.5 ? 0 : Math.max(0, initialStartSec - 0.5);
        state.adSegments = [
          ...state.adSegments,
          { start: startClean, end: cleanSec, kind: "splice", brand: "Реклама ставок" },
        ];
        state.adSkippedIds[`${startClean.toFixed(1)}_${cleanSec.toFixed(1)}`] = Date.now();
        renderAdTimelineMarkers(video);
        showToast(
          t(
            `Реклама пропущена (${formatTime(startClean)}–${formatTime(cleanSec)})`,
            `Ad skipped (${formatTime(startClean)}–${formatTime(cleanSec)})`
          )
        );
        break;
      }
      if (lastAdSec - initialStartSec >= 44) break;
    }
  } catch (_) {
  } finally {
    video.muted = wasMuted;
    state.internalMuteOverride = false;
    state.adSteppingActive = false;
  }
}
export async function runLiveAdFrameCheck(forceImmediate = false) {
  // Never perform synchronous main-thread canvas drawImage + JPEG encoding when an out-of-process MP4 scanner URL exists
  if (
    state.adScanMp4Url ||
    !state.autoSkipAds ||
    state.adLiveCheckBusy ||
    state.adSteppingActive ||
    state.fsTransitioning ||
    !state.isPlayerOpen ||
    state.activeSourceTab === "trailer" ||
    document.hidden
  ) {
    return;
  }
  const video = document.getElementById("native-video");
  if (
    !video ||
    !video.hasAttribute("crossorigin") ||
    video.paused ||
    video.ended ||
    video.seeking ||
    video.readyState < 2
  ) {
    return;
  }

  const cur = video.currentTime || 0;
  // Only inspect initial pre-roll window on external HLS streams
  if (cur > 35) return;
  const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;

  // Skip canvas OCR completely if background 360p keyframe scanner already verified past this point
  if (!forceImmediate && (state.adScanComplete || (state.adScannedUntil > cur + 10 && cur > 6))) {
    return;
  }
  if (
    Array.isArray(state.adSegments) &&
    state.adSegments.some((s) => cur >= (Number(s.start) || 0) - 1 && cur <= (Number(s.end) || 0) + 1)
  ) {
    return;
  }

  const b64 = captureLiveFrameJpegB64(video);
  if (!b64) return;

  state.adLiveCheckBusy = true;
  const sessionId = state.playerSessionId;
  try {
    const res = await fetch("/api/ad-detect-frame", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jpeg_b64: b64,
        timestamp: cur,
        stream_key: state.adStreamKey,
        mp4_url: state.adScanMp4Url,
        duration: dur,
      }),
    });
    const data = await res.json();
    if (!state.isPlayerOpen || sessionId !== state.playerSessionId) return;

    if (Array.isArray(data?.segments) && data.segments.length > 0) {
      state.adSegments = data.segments;
      renderAdTimelineMarkers(video);
      checkAndSkipActiveAd(video);
    } else if (data?.is_ad && !state.adScanMp4Url && data.kind === "splice" && state.autoSkipAds) {
      await stepPastLiveHlsAd(video, cur);
    }
  } catch (_) {
  } finally {
    state.adLiveCheckBusy = false;
  }
}
export function initAdSkipSession(adSkipPayload, fallbackStreamUrl = "") {
  stopAdSkipSession(false);
  const item = state.activeItem;
  const fallbackKey = item
    ? `${item.rezka_id || item.id}_s${state.activeSeason || 1}_e${state.activeEpisode || 1}_tr${state.activeStudioId || "ext"}`
    : "stream_default";

  state.adStreamKey = adSkipPayload?.stream_key || fallbackKey;
  state.adScanMp4Url =
    adSkipPayload?.scan_mp4_url ||
    (fallbackStreamUrl && !fallbackStreamUrl.includes(".m3u8") ? fallbackStreamUrl : "");
  state.adSegments = Array.isArray(adSkipPayload?.segments) ? adSkipPayload.segments : [];
  state.adScannedUntil = Number(adSkipPayload?.scanned_until) || 0;
  state.adScanComplete = Boolean(adSkipPayload?.complete);
  state.adSkippedIds = {};

  const video = document.getElementById("native-video");
  renderAdTimelineMarkers(video);

  if (state.adScanMp4Url && !state.adScanComplete && state.autoSkipAds) {
    const sessionId = state.playerSessionId;
    const pollOnce = async () => {
      if (
        !state.isPlayerOpen ||
        sessionId !== state.playerSessionId ||
        state.adScanComplete ||
        !state.autoSkipAds
      ) {
        if (state.adPollTimerId) {
          clearInterval(state.adPollTimerId);
          state.adPollTimerId = null;
        }
        return;
      }
      const v = document.getElementById("native-video");
      if (!v || v.paused || v.seeking || v.readyState < 3) return;
      const playhead = v.currentTime || 0;
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      try {
        const qs = new URLSearchParams({
          stream_key: state.adStreamKey,
          mp4_url: state.adScanMp4Url,
          playhead: playhead.toFixed(1),
          duration: dur.toFixed(1),
        });
        const r = await fetch(`/api/ad-segments?${qs.toString()}`);
        const info = await r.json();
        if (!state.isPlayerOpen || sessionId !== state.playerSessionId) return;
        if (Array.isArray(info.segments)) {
          state.adSegments = info.segments;
        }
        state.adScannedUntil = Number(info.scanned_until) || state.adScannedUntil;
        state.adScanComplete = Boolean(info.complete);
        renderAdTimelineMarkers(v);
        checkAndSkipActiveAd(v);
      } catch (_) {}
    };
    // Wait 9s so initial 1080p/4K stream buffering gets 100% exclusive CDN bandwidth & VideoToolbox decoder
    state.adPollStartDelayId = setTimeout(() => {
      state.adPollStartDelayId = null;
      if (!state.isPlayerOpen || sessionId !== state.playerSessionId || state.adScanComplete) return;
      pollOnce();
      state.adPollTimerId = setInterval(pollOnce, 6000);
    }, 9000);
  }
}
export async function loadSkipIntroSegments() {
  if (!state.activeItem) return;
  const sessionId = state.playerSessionId;
  const item = state.activeItem;
  const infoEl = document.getElementById("intro-window-info");
  if (item.media_type === "movie") {
    state.skipSegments = null;
    if (infoEl) infoEl.textContent = "";
    return;
  }

  if (state.skipIntroAbortController) {
    try {
      state.skipIntroAbortController.abort();
    } catch (_) {}
  }
  const skipAbort = new AbortController();
  state.skipIntroAbortController = skipAbort;

  try {
    const params = new URLSearchParams({
      imdb_id: item.imdb_id || item.id || "",
      season: String(state.activeSeason),
      episode: String(state.activeEpisode),
      media_type: item.media_type || "series",
      title: item.title || "",
      orig_title: item.orig_title || "",
      year: String(item.year || 0),
    });
    const res = await fetch(`/api/skip-intro?${params.toString()}`, {
      signal: skipAbort.signal,
    });
    const data = await res.json();
    if (!state.isPlayerOpen || sessionId !== state.playerSessionId) return;
    state.skipSegments = data;

    if (infoEl) {
      infoEl.textContent = data.intro
        ? `(${formatTime(data.intro.start)}–${formatTime(data.intro.end)})`
        : "";
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;
    console.error("Skip intro error:", err);
  }
}
export function hasOpenVcPopover() {
  return [
    "vc-studio-popover",
    "vc-subs-popover",
    "vc-quality-popover",
    "player-gear-popover",
    "hdr-studio-popover",
  ].some((id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains("hidden");
  });
}
export function syncVcPopoverOpenClass() {
  const stage = document.getElementById("video-stage");
  if (stage) {
    stage.classList.toggle("vc-popover-open", hasOpenVcPopover());
  }
}
export function closeAllVcPopovers() {
  [
    "vc-studio-popover",
    "vc-subs-popover",
    "vc-quality-popover",
    "player-gear-popover",
    "hdr-studio-popover",
  ].forEach((id) => {
    document.getElementById(id)?.classList.add("hidden");
  });
  document.getElementById("btn-player-gear")?.classList.remove("active");
  syncVcPopoverOpenClass();
}
export function isStageFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}
export function setVideoStageIdle(isIdle) {
  const stage = document.getElementById("video-stage");
  if (isIdle) {
    stage?.classList.add("vc-idle");
    if (isStageFullscreen()) {
      document.documentElement.classList.add("vc-fs-cursor-none");
    } else {
      document.documentElement.classList.remove("vc-fs-cursor-none");
    }
  } else {
    stage?.classList.remove("vc-idle");
    document.documentElement.classList.remove("vc-fs-cursor-none");
  }
}
export function wakeVideoControls() {
  const stage = document.getElementById("video-stage");
  const video = document.getElementById("native-video");
  if (!stage) return;
  setVideoStageIdle(false);
  if (state.vcIdleTimerId) {
    clearTimeout(state.vcIdleTimerId);
    state.vcIdleTimerId = null;
  }
  if (!video || video.paused || video.ended) return;
  state.vcIdleTimerId = setTimeout(() => {
    if (
      !video.paused &&
      !video.ended &&
      !state.vcScrubbing &&
      !hasOpenVcPopover()
    ) {
      setVideoStageIdle(true);
    }
  }, 2200);
}
export function syncCustomVideoControlsUI(forceSync = false) {
  const video = document.getElementById("native-video");
  if (!video) return;
  // Skip redundant DOM style mutations when controls bar is hidden in idle playback
  if (!forceSync && !state.vcScrubbing) {
    const stage = document.getElementById("video-stage");
    if (stage && stage.classList.contains("vc-idle")) {
      const nowMs = Date.now();
      if (nowMs - (state.lastVcSyncTs || 0) < 1200) {
        return;
      }
      state.lastVcSyncTs = nowMs;
    }
  }
  const { cur, dur } = getEffectivePlaybackTiming(video);
  const rawCur = Number.isFinite(video.currentTime) ? video.currentTime : 0;

  const playBtn = document.getElementById("vc-btn-play");
  if (playBtn) {
    const playKey = video.paused ? "play" : "pause";
    if (playBtn.dataset.icoKey !== playKey) {
      playBtn.dataset.icoKey = playKey;
      playBtn.innerHTML = iconSvg(playKey, 14);
    }
  }

  if (!state.vcScrubbing) {
    const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
    const playedEl = document.getElementById("vc-played");
    const thumbEl = document.getElementById("vc-thumb");
    if (playedEl) playedEl.style.width = `${pct}%`;
    if (thumbEl) thumbEl.style.left = `${pct}%`;
  }

  const bufferedEl = document.getElementById("vc-buffered");
  if (bufferedEl) {
    let bufPct = 0;
    if (dur > 0 && video.buffered && video.buffered.length > 0) {
      let bufEnd = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= rawCur + 0.5 && video.buffered.end(i) >= rawCur) {
          bufEnd = Math.max(bufEnd, video.buffered.end(i));
        }
      }
      if (!bufEnd) {
        bufEnd = video.buffered.end(video.buffered.length - 1);
      }
      const effBufEnd = (state.remuxMeta?.active ? state.remuxMeta.offsetSec || 0 : 0) + bufEnd;
      bufPct = Math.min(100, Math.max(0, (effBufEnd / dur) * 100));
    }
    bufferedEl.style.width = `${bufPct}%`;
  }

  const timeBtn = document.getElementById("vc-time-label");
  if (timeBtn) {
    if (dur > 0 && state.vcShowRemaining) {
      timeBtn.textContent = `${formatTime(cur)} / -${formatTime(Math.max(0, dur - cur))}`;
    } else {
      timeBtn.textContent = `${formatTime(cur)} / ${dur > 0 ? formatTime(dur) : "0:00"}`;
    }
  }

  const muteBtn = document.getElementById("vc-btn-mute");
  const volSlider = document.getElementById("vc-vol-slider");
  const isMuted = Boolean(video.muted || video.volume === 0);
  if (muteBtn) {
    const muteKey = isMuted ? "volMute" : video.volume < 0.5 ? "volLow" : "volHigh";
    if (muteBtn.dataset.icoKey !== muteKey) {
      muteBtn.dataset.icoKey = muteKey;
      muteBtn.innerHTML = iconSvg(muteKey, 15);
    }
  }
  if (volSlider && document.activeElement !== volSlider) {
    volSlider.value = String(video.muted ? 0 : video.volume);
  }

  const fsBtn = document.getElementById("vc-btn-fs");
  if (fsBtn) {
    const fsActive = isStageFullscreen();
    const fsKey = fsActive ? "fsExit" : "fsEnter";
    const fsTitle = fsActive
      ? t("Выйти из полного экрана (F / Esc)", "Exit fullscreen (F / Esc)")
      : t("Во весь экран (F)", "Fullscreen (F)");
    if (fsBtn.dataset.icoKey !== fsKey) {
      fsBtn.dataset.icoKey = fsKey;
      fsBtn.innerHTML = iconSvg(fsKey, 14);
    }
    if (fsBtn.title !== fsTitle) {
      fsBtn.title = fsTitle;
    }
  }

  const fsTitleEl = document.getElementById("vc-fs-title");
  const fsMetaEl = document.getElementById("vc-fs-meta");
  if (fsTitleEl && fsMetaEl && state.activeItem) {
    const item = state.activeItem;
    const mainTitle = displayTitle(item);
    let nextTitle = "";
    let nextMeta = "";
    if (item.media_type === "series") {
      const epMeta = getEpisodeDisplayMeta(state.activeSeason, state.activeEpisode);
      const epNamePart = epMeta.realTitle
        ? isEn()
          ? ` — "${epMeta.realTitle}"`
          : ` — «${epMeta.realTitle}»`
        : "";
      nextTitle = mainTitle || "";
      nextMeta = [
        `${t(
          `Сезон ${state.activeSeason}, Серия ${state.activeEpisode}`,
          `Season ${state.activeSeason}, Episode ${state.activeEpisode}`
        )}${epNamePart}`,
        state.activeStudioName || "",
      ]
        .filter(Boolean)
        .join(" · ");
    } else {
      nextTitle = item.year ? `${mainTitle} (${item.year})` : mainTitle || "";
      nextMeta = [secondaryTitle(item) || "", state.activeStudioName || ""]
        .filter(Boolean)
        .join(" · ");
    }
    if (fsTitleEl.textContent !== nextTitle) fsTitleEl.textContent = nextTitle;
    if (fsMetaEl.textContent !== nextMeta) fsMetaEl.textContent = nextMeta;
  }
}
export function toggleQuickOriginalAudio() {
  if (state.activeSourceTab !== "hdrezka") {
    switchSourceTab("hdrezka", null);
    return;
  }
  const studioSel = document.getElementById("select-studio");
  if (!studioSel) return;
  const opts = Array.from(studioSel.options || []);
  if (opts.length === 0) return;

  const origOpt = opts.find((o) => o.dataset.isOriginal === "1");
  if (!origOpt) {
    showToast(
      t(
        "Дорожка оригинала для этого тайтла недоступна",
        "Original audio track is unavailable for this title"
      )
    );
    return;
  }

  const activeOpt = opts.find((o) => o.selected) || opts[0];
  const isCurrentlyOrig = Boolean(activeOpt && activeOpt.dataset.isOriginal === "1");

  if (isCurrentlyOrig) {
    const fallbackOpt =
      opts.find((o) => String(o.value) === String(state.lastNonOriginalStudioId) && o.dataset.isOriginal !== "1") ||
      opts.find((o) => o.dataset.isOriginal !== "1") ||
      null;
    if (!fallbackOpt) {
      showToast(
        t(
          "Для этого тайтла доступна только оригинальная дорожка",
          "Only the Original audio track is available for this title"
        )
      );
      return;
    }
    studioSel.value = fallbackOpt.value;
    studioSel.dispatchEvent(new Event("change"));
    return;
  }

  if (activeOpt) {
    state.lastNonOriginalStudioId = String(activeOpt.value);
  }
  state.forceEnableRuSubtitlesOnce = true;
  studioSel.value = origOpt.value;
  studioSel.dispatchEvent(new Event("change"));
}
export function syncCustomControlPopovers() {
  const isHdRezka = state.activeSourceTab === "hdrezka";
  const has4kRemuxAudio = Boolean(
    (state.activeSourceTab === "backup4k" || state.activeSourceTab === "stremio") &&
      state.remuxMeta?.active &&
      (state.remuxMeta.audioTracks || []).length > 0
  );
  const studioWrap = document.getElementById("vc-studio-wrap");
  const studioLbl = document.getElementById("vc-studio-label");
  const studioPop = document.getElementById("vc-studio-popover");
  const studioSel = document.getElementById("select-studio");
  const hdrAudioBar = document.getElementById("hdr-rezka-audio-bar");
  const hdrStudioLbl = document.getElementById("hdr-studio-label");
  const hdrStudioPop = document.getElementById("hdr-studio-popover");
  const btnQuickOrig = document.getElementById("btn-quick-original");
  const hdrOrigLbl = document.getElementById("hdr-orig-label");

  const renderStudioItemsInto = (container, opts, popTitle) => {
    if (!container) return;
    container.innerHTML = `<div class="atv-vc-pop-title">${escapeHtml(popTitle)}</div>`;
    opts.forEach((opt, idx) => {
      const isAct = opt.value === studioSel.value;
      const isOrig = opt.dataset.isOriginal === "1";
      const b = document.createElement("button");
      b.type = "button";
      b.className = `atv-vc-pop-item${isAct ? " active" : ""}${isOrig ? " is-orig-option" : ""}`;
      const badgeHtml = isOrig ? `<span class="atv-vc-orig-badge">ORIG</span>` : "";
      b.innerHTML = `<span class="atv-vc-pop-item-main">${badgeHtml}<span>${escapeHtml(
        opt.textContent
      )}</span></span><span>${isAct ? iconSvg("check", 12) : ""}</span>`;
      b.onclick = (ev) => {
        ev.stopPropagation();
        closeAllVcPopovers();
        if (studioSel.value !== opt.value) {
          if (isOrig) {
            state.forceEnableRuSubtitlesOnce = true;
          }
          studioSel.value = opt.value;
          studioSel.dispatchEvent(new Event("change"));
        }
      };
      container.appendChild(b);
      const nextOpt = opts[idx + 1];
      if (isOrig && nextOpt && nextOpt.dataset.isOriginal !== "1") {
        const div = document.createElement("div");
        div.className = "atv-vc-pop-divider";
        container.appendChild(div);
      }
    });
  };

  if (studioSel) {
    const opts = Array.from(studioSel.options || []);
    const activeOpt = opts.find((o) => o.selected) || opts[0] || null;
    const popTitle = has4kRemuxAudio
      ? state.activeSourceTab === "stremio"
        ? t("Аудиодорожка Stremio", "Stremio Audio Track")
        : t("Аудиодорожка 4K", "4K Audio Track")
      : t("Озвучка и оригинал", "Audio & Original");

    if (studioWrap && studioLbl && studioPop) {
      if ((!isHdRezka && !has4kRemuxAudio) || opts.length === 0) {
        studioWrap.classList.add("hidden");
        studioPop.innerHTML = "";
      } else {
        studioWrap.classList.remove("hidden");
        studioLbl.textContent = activeOpt ? activeOpt.textContent : t("Озвучка", "Audio");
        renderStudioItemsInto(studioPop, opts, popTitle);
      }
    }

    if (hdrAudioBar) {
      hdrAudioBar.classList.add("hidden");
    }
  }

  const subsWrap = document.getElementById("vc-subs-wrap");
  const subsLbl = document.getElementById("vc-subs-label");
  const subsPop = document.getElementById("vc-subs-popover");
  const subsSel = document.getElementById("select-subtitle");
  if (subsWrap && subsLbl && subsPop && subsSel) {
    const subsList = state.subtitles || [];
    if (!subsList.length) {
      subsWrap.classList.add("hidden");
      subsPop.innerHTML = "";
    } else {
      subsWrap.classList.remove("hidden");
      const activeSub = state.activeSubtitleIndex >= 0 ? subsList[state.activeSubtitleIndex] : null;
      subsLbl.textContent = activeSub ? activeSub.lang || t("Включены", "On") : t("Субтитры", "Subtitles");
      subsPop.innerHTML = `<div class="atv-vc-pop-title">${t("Субтитры", "Subtitles")}</div>`;
      Array.from(subsSel.options || []).forEach((opt) => {
        const isAct = String(state.activeSubtitleIndex) === String(opt.value);
        const b = document.createElement("button");
        b.type = "button";
        b.className = `atv-vc-pop-item${isAct ? " active" : ""}`;
        b.innerHTML = `<span>${escapeHtml(opt.textContent)}</span><span>${isAct ? iconSvg("check", 12) : ""}</span>`;
        b.onclick = (ev) => {
          ev.stopPropagation();
          closeAllVcPopovers();
          subsSel.value = opt.value;
          subsSel.dispatchEvent(new Event("change"));
          syncCustomControlPopovers();
        };
        subsPop.appendChild(b);
      });
    }
  }

  const qualWrap = document.getElementById("vc-quality-wrap");
  const qualLbl = document.getElementById("vc-quality-label");
  const qualPop = document.getElementById("vc-quality-popover");
  const qualSel = document.getElementById("select-quality");
  if (qualWrap && qualLbl && qualPop && qualSel) {
    const qOpts = Array.from(qualSel.options || []);
    if (!isHdRezka || qOpts.length === 0) {
      qualWrap.classList.add("hidden");
      qualPop.innerHTML = "";
    } else {
      qualWrap.classList.remove("hidden");
      qualLbl.textContent = qualSel.value || qOpts[0]?.value || "1080p";
      qualPop.innerHTML = `<div class="atv-vc-pop-title">${t("Качество видео", "Video Quality")}</div>`;
      qOpts.forEach((opt) => {
        const isAct = opt.value === qualSel.value;
        const b = document.createElement("button");
        b.type = "button";
        b.className = `atv-vc-pop-item${isAct ? " active" : ""}`;
        b.innerHTML = `<span>${escapeHtml(opt.textContent)}</span><span>${isAct ? iconSvg("check", 12) : ""}</span>`;
        b.onclick = (ev) => {
          ev.stopPropagation();
          closeAllVcPopovers();
          if (qualSel.value !== opt.value) {
            qualSel.value = opt.value;
            qualSel.dispatchEvent(new Event("change"));
            syncCustomControlPopovers();
          }
        };
        qualPop.appendChild(b);
      });
    }
  }
}
export function beginFullscreenTransitionWindow(durationMs = 560) {
  state.fsTransitioning = true;
  document.documentElement.classList.add("fs-transitioning");
  if (state.fsTransitionTimerId) {
    clearTimeout(state.fsTransitionTimerId);
  }
  state.fsTransitionTimerId = setTimeout(() => {
    state.fsTransitioning = false;
    state.fsTransitionTimerId = null;
    document.documentElement.classList.remove("fs-transitioning");
    if (!isStageFullscreen() && state.isPlayerOpen && state.ambilightEnabled) {
      sampleAmbilightFrame();
    }
  }, durationMs);
}
export function toggleStageFullscreen() {
  const video = document.getElementById("native-video");
  const stage = document.getElementById("video-stage") || video;
  if (!stage) return;
  if (state.vcClickTimerId) {
    clearTimeout(state.vcClickTimerId);
    state.vcClickTimerId = null;
  }
  beginFullscreenTransitionWindow(580);
  if (isStageFullscreen()) {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  } else if (stage.requestFullscreen) {
    stage.requestFullscreen().catch(() => {});
  } else if (stage.webkitRequestFullscreen) {
    stage.webkitRequestFullscreen();
  } else if (video && video.webkitEnterFullscreen) {
    video.webkitEnterFullscreen();
  }
}
export function bindNativeVideoElementListeners(video) {
  if (!video || video._cfListenersBound) return;
  video._cfListenersBound = true;

  const skipIntroBtn = document.getElementById("skip-intro-btn");
  const skipOutroBtn = document.getElementById("skip-outro-btn");

  ["loadedmetadata", "durationchange", "progress", "volumechange"].forEach((evName) => {
    video.addEventListener(evName, () => {
      syncCustomVideoControlsUI(evName !== "progress");
    });
  });

  ["play", "pause", "ended"].forEach((evName) => {
    video.addEventListener(evName, () => {
      const miniPlayPauseBtn = document.getElementById("btn-mini-play-pause");
      if (evName === "play") {
        state.pipWasPlayingRecently = true;
        if (miniPlayPauseBtn) miniPlayPauseBtn.innerHTML = iconSvg("pause", 12);
        syncPipDockUI();
        if (state.audioCtx && state.audioCtx.state === "suspended") {
          state.audioCtx.resume().catch(() => {});
        }
        applyAudioBoostToVideo(video, state.audioBoost, state.audioPreset);
        if (state.ambilightEnabled && state.isPlayerOpen) {
          startAmbilightLoop();
        }
        if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
          try {
            navigator.mediaSession.playbackState = "playing";
          } catch (_) {}
        }
      } else {
        if (evName === "pause") {
          if (miniPlayPauseBtn) miniPlayPauseBtn.innerHTML = iconSvg("play", 12);
          syncPipDockUI();
          setTimeout(() => {
            if (video.paused && isVideoInPiP(video)) {
              state.pipWasPlayingRecently = false;
            }
          }, 320);
        }
        stopAmbilightLoop(false);
        if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
          try {
            navigator.mediaSession.playbackState = "paused";
          } catch (_) {}
        }
        if (evName === "pause" && state.isPlayerOpen && state.activeItem) {
          const { cur, dur } = getEffectivePlaybackTiming(video);
          const nowPause = Date.now();
          if (dur >= 120 && cur >= 15 && nowPause - state.lastScrobbleReportTime > 4000) {
            state.lastScrobbleReportTime = nowPause;
            reportScrobbleProgress(cur, dur);
          }
        }
      }
      syncCustomVideoControlsUI(true);
      wakeVideoControls();
    });
  });

  const handlePiPStateChange = () => {
    const active = isVideoInPiP(video);
    syncPipDockUI();
    if (active) {
      if (!video.paused) {
        state.pipWasPlayingRecently = true;
      }
      if (state.isPlayerOpen && !state.isPipBackground) {
        setPipBackgroundMode(true);
      }
    } else if (state.isPlayerOpen && !state.isRestoringFromPip) {
      const shouldResume = state.pipWasPlayingRecently;
      if (state.isPipBackground) {
        setPipBackgroundMode(false);
      }
      syncPipDockUI();
      if (shouldResume && video.paused && !state.streamAbortController) {
        video.play().catch(() => {});
      }
    }
  };
  video.addEventListener("enterpictureinpicture", handlePiPStateChange);
  video.addEventListener("leavepictureinpicture", handlePiPStateChange);
  video.addEventListener("webkitpresentationmodechanged", handlePiPStateChange);

  video.addEventListener("click", (e) => {
    e.stopPropagation();
    if (hasOpenVcPopover()) {
      closeAllVcPopovers();
      return;
    }
    if (e.detail > 1) {
      if (state.vcClickTimerId) {
        clearTimeout(state.vcClickTimerId);
        state.vcClickTimerId = null;
      }
      return;
    }
    if (state.vcClickTimerId) {
      clearTimeout(state.vcClickTimerId);
    }
    state.vcClickTimerId = setTimeout(() => {
      state.vcClickTimerId = null;
      toggleVideoPlayPause(true);
    }, 190);
  });
  video.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (state.vcClickTimerId) {
      clearTimeout(state.vcClickTimerId);
      state.vcClickTimerId = null;
    }
    toggleStageFullscreen();
  });

  video.addEventListener("loadedmetadata", () => {
    renderAdTimelineMarkers(video);
  });
  video.addEventListener("loadeddata", () => {
    checkAndSkipActiveAd(video);
  });
  video.addEventListener("seeked", () => {
    checkAndSkipActiveAd(video);
    if (video.webkitDisplayingFullscreen) {
      syncIosFullscreenNativeSubtitles(video);
    } else {
      updateCustomSubtitleOverlay(video);
    }
  });
  video.addEventListener("webkitbeginfullscreen", () => {
    syncIosFullscreenNativeSubtitles(video);
  });
  video.addEventListener("webkitendfullscreen", () => {
    syncIosFullscreenNativeSubtitles(video);
  });

  video.addEventListener("timeupdate", () => {
    if (!video.paused) {
      state.pipWasPlayingRecently = true;
    }
    syncCustomVideoControlsUI();
    updateCustomSubtitleOverlay(video);
    checkAndSkipActiveAd(video);
    const { cur, dur } = getEffectivePlaybackTiming(video);

    if (
      dur >= 300 &&
      state.activeItem?.media_type === "series" &&
      state.skipSegments &&
      state.skipSegments.intro
    ) {
      const { start, end } = state.skipSegments.intro;
      const inIntro = cur >= start && cur <= end && end < dur;

      if (inIntro) {
        if (state.autoSkipIntro && !state.introSkippedThisEpisode && !video.seeking) {
          state.introSkippedThisEpisode = true;
          seekEffectivePlayback(Math.min(dur - 10, end + 0.5));
          skipIntroBtn?.classList.add("hidden");
          showToast(
            t(
              `Заставка пропущена (${formatTime(start)}–${formatTime(end)})`,
              `Intro skipped (${formatTime(start)}–${formatTime(end)})`
            )
          );
        } else if (!state.autoSkipIntro && skipIntroBtn) {
          skipIntroBtn.textContent = t(
            `Пропустить заставку (${formatTime(start)}–${formatTime(end)})`,
            `Skip intro (${formatTime(start)}–${formatTime(end)})`
          );
          skipIntroBtn.classList.remove("hidden");
        }
      } else {
        skipIntroBtn?.classList.add("hidden");
      }
    } else {
      skipIntroBtn?.classList.add("hidden");
    }

    if (dur >= 120) {
      preloadNextEpisodeIfNeeded(cur, dur);
      const ratio = cur / dur;

      const now = Date.now();
      if (state.activeItem && cur >= 5 && now - state.lastEpisodeSaveTime > 3000) {
        state.lastEpisodeSaveTime = now;
        saveEpisodeProgress(state.activeItem, state.activeSeason, state.activeEpisode, cur, dur);
        state.catalogDirty = true;
      }
      if (state.activeItem && cur >= 10 && now - state.lastHistorySaveTime > 8000) {
        state.lastHistorySaveTime = now;
        recordWatchHistoryEntry(
          state.activeItem,
          state.activeSeason,
          state.activeEpisode,
          cur,
          dur,
          state.activeStudioName
        );
      }

      const nextCoordsForOutro = getNextEpisodeCoords();
      const outroStartSec = state.skipSegments?.outro?.start_sec;
      const isOutro =
        state.activeItem?.media_type === "series" &&
        Boolean(nextCoordsForOutro) &&
        !state.autoplayTimerId &&
        ((outroStartSec && outroStartSec < dur && cur >= outroStartSec) || ratio >= 0.92);

      if (isOutro) {
        skipOutroBtn?.classList.remove("hidden");
      } else {
        skipOutroBtn?.classList.add("hidden");
      }

      const epScrobbleKey = `${state.activeItem?.id || ""}:s${state.activeSeason}e${state.activeEpisode}`;
      const needsEpisodeScrobble =
        !state.scrobbledEpisodesThisSession[epScrobbleKey] &&
        (!isEpisodeWatched(state.activeItem, state.activeSeason, state.activeEpisode) ||
          Boolean(state.activeItem?.kinorium?.watching && !state.scrobbledThisSession));
      const crossed85 =
        state.activeItem?.media_type === "series"
          ? ratio >= 0.85 && needsEpisodeScrobble
          : ratio >= 0.85 && !state.scrobbledThisSession;
      if (crossed85 || (cur >= 15 && now - state.lastScrobbleReportTime > 20000)) {
        state.lastScrobbleReportTime = now;
        reportScrobbleProgress(cur, dur);
      }

      if (ratio >= 0.96 && isServiceEnabled("kinorium") && state.activeItem) {
        maybeAutoOpenCreditsRatingCard();
      }
    }
  });

  video.addEventListener("ended", () => {
    const { dur } = getEffectivePlaybackTiming(video);
    if (state.isPlayerOpen && state.activeItem && dur > 0) {
      const epKey = `${state.activeItem.id || ""}:s${state.activeSeason}e${state.activeEpisode}`;
      const shouldFinalize =
        state.activeItem.media_type === "series"
          ? !state.scrobbledEpisodesThisSession[epKey] ||
            Boolean(state.activeItem.kinorium?.watching && !state.scrobbledThisSession)
          : !state.scrobbledThisSession;
      if (shouldFinalize) {
        state.lastScrobbleReportTime = Date.now();
        reportScrobbleProgress(dur, dur);
      }
    }
    if (isServiceEnabled("kinorium") && state.activeItem) {
      maybeAutoOpenCreditsRatingCard();
    }
    if (state.sleepAtEpisodeEnd) {
      setSleepTimer("off");
      showToast(
        t(
          "Таймер сна («Конец серии»): воспроизведение завершено",
          'Sleep timer ("End of episode"): playback finished'
        )
      );
      return;
    }
    if (
      state.isPlayerOpen &&
      state.activeItem?.media_type === "series" &&
      state.autoNextEpisode &&
      !state.autoplayCancelledThisEpisode &&
      Boolean(getNextEpisodeCoords())
    ) {
      startAutoplayNextCountdown();
    }
  });

  video.addEventListener("volumechange", () => {
    if (!state.isPlayerOpen || state.internalMuteOverride) return;
    if (video.volume > 0.02) {
      savePlayerPrefs({ volume: video.volume, muted: false });
    }
  });

  video.addEventListener("ratechange", () => {
    if (!state.isPlayerOpen) return;
    if (video.playbackRate && video.playbackRate >= 0.5 && video.playbackRate <= 3) {
      savePlayerPrefs({ playbackRate: video.playbackRate });
      const speedSel = document.getElementById("select-speed");
      if (speedSel) {
        speedSel.value = String(video.playbackRate);
      }
    }
  });
}
export function initCustomVideoControls() {
  const stage = document.getElementById("video-stage");
  const getVideoEl = () => document.getElementById("native-video");
  const timeline = document.getElementById("vc-timeline");
  const hoverTimeEl = document.getElementById("vc-hover-time");
  const playedEl = document.getElementById("vc-played");
  const thumbEl = document.getElementById("vc-thumb");
  if (!stage || !getVideoEl()) return;

  const handleRealPointerMove = (e) => {
    const x = typeof e.clientX === "number" ? e.clientX : -1;
    const y = typeof e.clientY === "number" ? e.clientY : -1;
    if (x >= 0 && y >= 0) {
      const dx = Math.abs(x - state.vcLastMouseX);
      const dy = Math.abs(y - state.vcLastMouseY);
      if (state.vcLastMouseX >= 0 && dx < 2 && dy < 2) {
        return;
      }
      state.vcLastMouseX = x;
      state.vcLastMouseY = y;
    }
    wakeVideoControls();
  };

  stage.addEventListener("mousemove", handleRealPointerMove, { passive: true });
  document.addEventListener(
    "mousemove",
    (e) => {
      if (isStageFullscreen()) {
        handleRealPointerMove(e);
      }
    },
    { passive: true }
  );
  ["pointerdown", "touchstart"].forEach((evName) => {
    stage.addEventListener(evName, () => wakeVideoControls(), { passive: true });
  });
  stage.addEventListener("mouseleave", () => {
    const v = getVideoEl();
    if (v && !v.paused && !v.ended && !state.vcScrubbing && !hasOpenVcPopover()) {
      setVideoStageIdle(true);
    }
  });

  const handleFullscreenChange = () => {
    const fsActive = isStageFullscreen();
    document.documentElement.classList.toggle("is-stage-fullscreen", fsActive);
    beginFullscreenTransitionWindow(540);
    if (!fsActive) {
      document.documentElement.classList.remove("vc-fs-cursor-none");
    }
    syncPostwatchOverlayMount();
    syncToastContainerMount();
    syncCustomVideoControlsUI();
    wakeVideoControls();
  };
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);

  // Interactive Timeline Scrubber + Hover Time
  if (timeline) {
    const computeRatio = (clientX) => {
      const rect = timeline.getBoundingClientRect();
      if (!rect.width) return 0;
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    };

    const updateHoverPreview = (clientX) => {
      const { dur } = getEffectivePlaybackTiming(getVideoEl());
      if (!dur || !hoverTimeEl) return;
      const ratio = computeRatio(clientX);
      const clampedLeft = Math.min(94, Math.max(6, ratio * 100));
      hoverTimeEl.style.left = `${clampedLeft}%`;
      hoverTimeEl.textContent = formatTime(ratio * dur);
      hoverTimeEl.classList.remove("hidden");
    };

    timeline.addEventListener("pointermove", (e) => {
      updateHoverPreview(e.clientX);
      if (state.vcScrubbing) {
        const v = getVideoEl();
        const ratio = computeRatio(e.clientX);
        const pct = ratio * 100;
        if (playedEl) playedEl.style.width = `${pct}%`;
        if (thumbEl) thumbEl.style.left = `${pct}%`;
        if (v && !state.remuxMeta?.active) {
          const { dur } = getEffectivePlaybackTiming(v);
          if (dur > 0) {
            v.currentTime = ratio * dur;
          }
        }
      }
    });

    timeline.addEventListener("pointerleave", () => {
      if (!state.vcScrubbing && hoverTimeEl) {
        hoverTimeEl.classList.add("hidden");
      }
    });

    timeline.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const v = getVideoEl();
      const { dur } = getEffectivePlaybackTiming(v);
      if (!dur) return;
      state.vcScrubbing = true;
      timeline.classList.add("scrubbing");
      try {
        timeline.setPointerCapture(e.pointerId);
      } catch (_) {}
      const ratio = computeRatio(e.clientX);
      const pct = ratio * 100;
      if (playedEl) playedEl.style.width = `${pct}%`;
      if (thumbEl) thumbEl.style.left = `${pct}%`;
      if (v && !state.remuxMeta?.active) {
        v.currentTime = ratio * dur;
      }
      updateHoverPreview(e.clientX);
    });

    const finishScrub = (e) => {
      if (!state.vcScrubbing) return;
      state.vcScrubbing = false;
      timeline.classList.remove("scrubbing");
      const { dur } = getEffectivePlaybackTiming(getVideoEl());
      if (dur > 0 && typeof e.clientX === "number") {
        const ratio = computeRatio(e.clientX);
        seekEffectivePlayback(ratio * dur);
      }
      hoverTimeEl?.classList.add("hidden");
      syncCustomVideoControlsUI();
      wakeVideoControls();
    };
    timeline.addEventListener("pointerup", finishScrub);
    timeline.addEventListener("pointercancel", finishScrub);
  }

  document.getElementById("vc-btn-play")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleVideoPlayPause(true);
  });

  document.getElementById("vc-btn-back10")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const { cur } = getEffectivePlaybackTiming(getVideoEl());
    const target = Math.max(0, cur - 10);
    seekEffectivePlayback(target);
    triggerVideoCenterIndicator("back10", `−10 ${t("секунд", "sec")} · ${formatTime(target)}`);
  });

  document.getElementById("vc-btn-fwd10")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const { cur, dur } = getEffectivePlaybackTiming(getVideoEl());
    const maxDur = dur > 0 ? dur : cur + 10;
    const target = Math.min(maxDur, cur + 10);
    seekEffectivePlayback(target);
    triggerVideoCenterIndicator("fwd10", `+10 ${t("секунд", "sec")} · ${formatTime(target)}`);
  });

  document.getElementById("vc-btn-mute")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const video = getVideoEl();
    if (!video) return;
    state.userMutedThisSession = !video.muted;
    video.muted = state.userMutedThisSession;
    if (!video.muted && video.volume <= 0.02) {
      video.volume = 0.85;
      savePlayerPrefs({ volume: 0.85, muted: false });
    }
    if (state.audioCtx && state.audioCtx.state === "suspended") {
      state.audioCtx.resume().catch(() => {});
    }
    triggerVideoCenterIndicator(
      video.muted ? "mute" : "unmute",
      video.muted ? t("Без звука", "Muted") : `${Math.round(video.volume * 100)}%`
    );
    syncCustomVideoControlsUI(true);
  });

  const volSlider = document.getElementById("vc-vol-slider");
  if (volSlider) {
    volSlider.addEventListener("input", (e) => {
      e.stopPropagation();
      const video = getVideoEl();
      if (!video) return;
      const v = Math.min(1, Math.max(0, parseFloat(e.target.value) || 0));
      video.volume = v;
      state.userMutedThisSession = v === 0;
      video.muted = state.userMutedThisSession;
      if (v > 0.02) {
        savePlayerPrefs({ volume: v, muted: false });
      }
      if (state.audioCtx && state.audioCtx.state === "suspended") {
        state.audioCtx.resume().catch(() => {});
      }
      syncCustomVideoControlsUI(true);
    });
  }

  document.getElementById("vc-time-label")?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.vcShowRemaining = !state.vcShowRemaining;
    syncCustomVideoControlsUI();
  });

  const bindVcPopBtn = (btnId, popId) => {
    const btn = document.getElementById(btnId);
    const pop = document.getElementById(popId);
    if (!btn || !pop) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasHidden = pop.classList.contains("hidden");
      closeAllVcPopovers();
      if (wasHidden) {
        syncCustomControlPopovers();
        pop.classList.remove("hidden");
      }
      syncVcPopoverOpenClass();
      wakeVideoControls();
    });
  };
  bindVcPopBtn("vc-btn-studio", "vc-studio-popover");
  bindVcPopBtn("vc-btn-subs", "vc-subs-popover");
  bindVcPopBtn("vc-btn-quality", "vc-quality-popover");
  bindVcPopBtn("btn-hdr-studio", "hdr-studio-popover");

  document.getElementById("btn-quick-original")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAllVcPopovers();
    toggleQuickOriginalAudio();
  });

  document.getElementById("vc-btn-pip")?.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePictureInPicture();
  });

  document.getElementById("vc-btn-fs")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleStageFullscreen();
  });

  syncCustomVideoControlsUI();
}
export function setupVideoListeners() {
  initCustomVideoControls();
  const getVideoEl = () => document.getElementById("native-video");
  bindNativeVideoElementListeners(getVideoEl());
  if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
    const safeBindMediaAction = (action, handler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (_) {}
    };
    safeBindMediaAction("play", () => {
      const v = getVideoEl();
      if (state.isPlayerOpen && v?.paused) {
        toggleVideoPlayPause(false);
      }
    });
    safeBindMediaAction("pause", () => {
      const v = getVideoEl();
      if (state.isPlayerOpen && v && !v.paused) {
        toggleVideoPlayPause(false);
      }
    });
    safeBindMediaAction("seekbackward", (details) => {
      if (!state.isPlayerOpen) return;
      const offset = Number(details?.seekOffset) || 10;
      const { cur } = getEffectivePlaybackTiming(getVideoEl());
      seekEffectivePlayback(Math.max(0, cur - offset));
    });
    safeBindMediaAction("seekforward", (details) => {
      if (!state.isPlayerOpen) return;
      const offset = Number(details?.seekOffset) || 10;
      const { cur, dur } = getEffectivePlaybackTiming(getVideoEl());
      seekEffectivePlayback(dur > 0 ? Math.min(dur, cur + offset) : cur + offset);
    });
    safeBindMediaAction("previoustrack", () => {
      if (state.isPlayerOpen && state.activeItem?.media_type === "series") {
        stepEpisode(-1);
      }
    });
    safeBindMediaAction("nexttrack", () => {
      if (state.isPlayerOpen && state.activeItem?.media_type === "series") {
        stepEpisode(1);
      }
    });
  }
  const skipIntroBtn = document.getElementById("skip-intro-btn");
  const skipAdBtn = document.getElementById("skip-ad-btn");
  const skipOutroBtn = document.getElementById("skip-outro-btn");

  const btnAutoNow = document.getElementById("btn-autoplay-now");
  if (btnAutoNow) {
    btnAutoNow.onclick = async () => {
      clearAutoplayNextTimer();
      await stepEpisode(1);
    };
  }

  const btnAutoCancel = document.getElementById("btn-autoplay-cancel");
  if (btnAutoCancel) {
    btnAutoCancel.onclick = () => {
      state.autoplayCancelledThisEpisode = true;
      clearAutoplayNextTimer();
      showToast(t("Автопереход к следующей серии отменен", "Auto-play next episode cancelled"));
    };
  }

  if (skipIntroBtn) {
    skipIntroBtn.onclick = () => {
      const { dur } = getEffectivePlaybackTiming(getVideoEl());
      if (state.skipSegments?.intro && dur > state.skipSegments.intro.end) {
        state.introSkippedThisEpisode = true;
        seekEffectivePlayback(state.skipSegments.intro.end + 0.5);
        skipIntroBtn.classList.add("hidden");
      }
    };
  }

  if (skipAdBtn) {
    skipAdBtn.onclick = () => {
      const seg = state.activeManualAdSeg;
      if (!seg) return;
      const { cur, dur } = getEffectivePlaybackTiming(getVideoEl());
      const segStart = Number(seg.start) || 0;
      const segEnd = Number(seg.end) || cur + 15;
      state.adSkippedIds[`${segStart.toFixed(1)}_${segEnd.toFixed(1)}`] = Date.now();
      const targetSec = dur > 0 ? Math.min(dur - 0.4, segEnd + 0.2) : segEnd + 0.2;
      seekEffectivePlayback(targetSec);
      skipAdBtn.classList.add("hidden");
      state.activeManualAdSeg = null;
      showToast(
        t(
          `Реклама пропущена (${formatTime(segStart)}–${formatTime(segEnd)})`,
          `Ad skipped (${formatTime(segStart)}–${formatTime(segEnd)})`
        )
      );
    };
  }

  if (skipOutroBtn) {
    skipOutroBtn.onclick = async () => {
      await stepEpisode(1);
    };
  }
}
export async function reportScrobbleProgress(currentTime, duration) {
  if (!state.activeItem) return;
  const item = state.activeItem;

  const effectiveMap = resolveEffectiveSeasonsMap(item, state.seasonsMap);
  const sKeys = Object.keys(effectiveMap || {})
    .map((k) => parseInt(k, 10))
    .filter((n) => !Number.isNaN(n));
  const totalSeasons = sKeys.length > 0 ? Math.max(...sKeys) : 0;
  const curEps = effectiveMap?.[String(state.activeSeason)];
  const totalEpsInSeason = Array.isArray(curEps) && curEps.length > 0 ? Math.max(...curEps) : 0;

  try {
    const res = await fetch("/api/kinorium/scrobble", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        title: item.title,
        orig_title: item.orig_title,
        poster: item.poster,
        backdrop: item.backdrop,
        media_type: item.media_type,
        season: state.activeSeason,
        episode: state.activeEpisode,
        total_seasons: totalSeasons,
        total_episodes_in_season: totalEpsInSeason,
        is_series_completed: resolveSeriesCompletedFlag(item),
        current_time: currentTime,
        duration: duration,
        source:
          state.activeSourceTab === "stremio"
            ? "Stremio"
            : state.activeSourceTab === "backup4k"
            ? "4K Remux"
            : "HDRezka",
        studio: state.activeStudioName,
      }),
    });
    const data = await res.json();
    const statusMilestone = Boolean(
      data.just_scrobbled || data.just_scrobbled_episode || data.auto_completed_series
    );
    if (data.kinorium_counts) {
      state.kinoriumCounts = { ...state.kinoriumCounts, ...data.kinorium_counts };
      updateKinoriumSectionCounters();
    }
    if (data.kinorium_status) {
      item.kinorium = data.kinorium_status;
      state.catalogDirty = true;
      if (statusMilestone) {
        updateModalKinoriumHeader(data.kinorium_status);
        if (item.media_type === "series") {
          populateSeasonEpisodeSelectors(item, state.seasonsMap);
        }
      }
    }
    if (data.continue_watching) {
      state.continueWatching = data.continue_watching;
      state.catalogDirty = true;
      if (statusMilestone || !state.isPlayerOpen || state.isMiniPlayer || state.isPipBackground) {
        renderContinueWatching();
      }
    }
    if (item.media_type === "series" && (data.just_scrobbled_episode || data.auto_completed_series)) {
      const sNum = Number(data.scrobbled_season || state.activeSeason) || 1;
      const eNum = Number(data.scrobbled_episode || state.activeEpisode) || 1;
      const epKey = `${item.id}:s${sNum}e${eNum}`;
      const wasEpNotified = Boolean(state.scrobbledEpisodesThisSession[epKey]);
      state.scrobbledEpisodesThisSession[epKey] = true;
      if (data.auto_completed_series) {
        state.scrobbledThisSession = true;
        refreshOpenPersonModalUI();
        showToast(
          t(
            `Финал сериала «${displayTitle(item)}» просмотрен — статус изменён с «Смотрю» на «Просмотрено»${
              data.remote_synced ? " в Kinorium" : ""
            }`,
            `Series finale of "${displayTitle(item)}" watched — status changed to Watched${
              data.remote_synced ? " on Kinorium" : ""
            }`
          )
        );
      } else if (!wasEpNotified) {
        showToast(
          t(
            `Сезон ${sNum}, Серия ${eNum} отмечена просмотренной${data.remote_synced ? " в Kinorium" : ""}`,
            `Season ${sNum}, Episode ${eNum} marked as watched${data.remote_synced ? " on Kinorium" : ""}`
          )
        );
      }
    } else if (item.media_type !== "series" && data.just_scrobbled && !state.scrobbledThisSession) {
      state.scrobbledThisSession = true;
      showToast(
        t(
          `Отмечено просмотренным в Kinorium: «${displayTitle(item)}»`,
          `Marked as watched on Kinorium: "${displayTitle(item)}"`
        )
      );
      patchCatalogItemKinoriumInPlace(item, data.kinorium_status || item.kinorium);
    }
  } catch (err) {
    console.error("Scrobble error:", err);
  }
}
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
    document.querySelectorAll("#postwatch-stars button").forEach((btn) => {
      const sc = parseInt(btn.dataset.score, 10);
      btn.classList.toggle("active-star", num > 0 && sc === num);
      btn.classList.toggle("in-score-range", num > 0 && sc < num);
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
          "Комментарий к этой серии (необязательно)",
          "Comment on this episode (optional)"
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
      commentEl.placeholder = t("Комментарий к сериалу (необязательно)", "Comment on series (optional)");
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
    commentEl.placeholder = t("Комментарий к оценке (необязательно)", "Comment on rating (optional)");
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
  state.postwatchAnchor = anchor || "header";
  syncPostwatchOverlayMount();
  document.getElementById("kinorium-status-popover")?.classList.add("hidden");
  document.getElementById("player-gear-popover")?.classList.add("hidden");
  document.getElementById("btn-player-gear")?.classList.remove("active");
  state.postwatchManual = Boolean(isManual);
  if (state.activeItem.media_type === "series") {
    state.postwatchScope = preferredScope === "series" ? "series" : "episode";
    state.postwatchSeason = Number(seasonNum) || state.activeSeason || 1;
    state.postwatchEpisode = Number(epNum) || state.activeEpisode || 1;
  } else {
    state.postwatchScope = "movie";
  }
  renderPostWatchRatingState();
  overlay.classList.remove("hidden");
}
export function closePlayerModal(skipCatalogReload = false, forceStop = false, fromPopState = false) {
  if (!forceStop && state.isPlayerOpen && isVideoInPiP()) {
    setPipBackgroundMode(true);
    showToast(
      t(
        "Видео продолжает играть в режиме «Картинка в картинке»",
        "Video continues playing in Picture-in-Picture"
      )
    );
    return;
  }

  state.pausedByOverlayModal = false;
  if (state.hasPlayerHistoryEntry) {
    state.hasPlayerHistoryEntry = false;
    if (!fromPopState && window.history.state?.cineflowPlayerModal) {
      state.ignoringSyntheticPopstate = true;
      try {
        window.history.back();
      } catch (_) {
        state.ignoringSyntheticPopstate = false;
      }
    }
  }

  const video = document.getElementById("native-video");
  if (state.isPlayerOpen && state.activeItem && video) {
    const { cur, dur } = getEffectivePlaybackTiming(video);
    if (dur >= 120 && cur >= 10) {
      saveEpisodeProgress(state.activeItem, state.activeSeason, state.activeEpisode, cur, dur);
      recordWatchHistoryEntry(
        state.activeItem,
        state.activeSeason,
        state.activeEpisode,
        cur,
        dur,
        state.activeStudioName
      );
      reportScrobbleProgress(cur, dur).catch(() => {});
      state.catalogDirty = true;
    }
  }

  document.getElementById("player-gear-popover")?.classList.add("hidden");
  document.getElementById("btn-player-gear")?.classList.remove("active");
  clearAutoplayNextTimer();
  clearCustomSubtitleOverlay(false);
  if (state.remuxDurationReprobeTimer) {
    clearTimeout(state.remuxDurationReprobeTimer);
    state.remuxDurationReprobeTimer = null;
  }
  stopAdSkipSession(true);
  stopAmbilightLoop(true);
  closeAllVcPopovers();
  syncVcPopoverOpenClass();
  hideVideoStreamError();
  if (state.vcIdleTimerId) {
    clearTimeout(state.vcIdleTimerId);
    state.vcIdleTimerId = null;
  }
  if (state.vcClickTimerId) {
    clearTimeout(state.vcClickTimerId);
    state.vcClickTimerId = null;
  }
  document.documentElement.classList.remove("is-stage-fullscreen", "fs-transitioning");
  state.fsTransitioning = false;
  setVideoStageIdle(false);
  syncToastContainerMount();
  state.isPipBackground = false;
  document.getElementById("pip-status-dock")?.classList.add("hidden");
  document.getElementById("video-pip-placeholder")?.classList.add("hidden");
  setMiniPlayerMode(false);
  document.getElementById("player-gear-popover")?.classList.add("hidden");
  document.getElementById("btn-player-gear")?.classList.remove("active");
  state.isPlayerOpen = false;
  state.remuxMeta = null;
  state.preloadedNextEpisode = null;
  state.preloadingNextKey = "";
  state.playerSessionId += 1;
  syncScrollTopButton();

  const trailerStage = document.getElementById("trailer-stage-box");
  if (trailerStage) {
    trailerStage.innerHTML = "";
    trailerStage.classList.add("hidden");
  }

  [
    "streamAbortController",
    "backup4kAbortController",
    "stremioResolveAbortController",
    "remuxProbeAbortController",
    "skipIntroAbortController",
    "trailerAbortController",
  ].forEach((ctrlKey) => {
    if (state[ctrlKey]) {
      try {
        state[ctrlKey].abort();
      } catch (_) {}
      state[ctrlKey] = null;
    }
  });

  const modal = document.getElementById("player-modal");
  modal?.classList.remove("pip-background-mode");
  const loader = document.getElementById("video-loader");
  if (loader) loader.classList.add("hidden");

  abortActiveVideoListeners();
  if (state.hlsInstance) {
    try {
      state.hlsInstance.destroy();
    } catch (_) {}
    state.hlsInstance = null;
  }

  if (video) {
    if (document.pictureInPictureElement) {
      try {
        document.exitPictureInPicture();
      } catch (_) {}
    } else if (
      typeof video.webkitSetPresentationMode === "function" &&
      video.webkitPresentationMode === "picture-in-picture"
    ) {
      try {
        video.webkitSetPresentationMode("inline");
      } catch (_) {}
    }
    video.onloadedmetadata = null;
    try {
      video.pause();
    } catch (_) {}
    video.querySelectorAll("track").forEach((tr) => tr.remove());
    video.removeAttribute("src");
    video.srcObject = null;
    try {
      video.load();
    } catch (_) {}
  }

  if (modal && !modal.classList.contains("hidden")) {
    modal.classList.add("hidden");
    if (!skipCatalogReload && state.catalogDirty) {
      state.catalogDirty = false;
      loadCatalog();
    }
  }
}
export function refreshOpenPlayerLanguageUI(langChanged = false) {
  if (!state.isPlayerOpen || !state.activeItem) return;
  const item = state.activeItem;
  const modalTitleEl = document.getElementById("modal-title");
  if (modalTitleEl) {
    modalTitleEl.textContent = displayTitle(item);
  }
  const descEl = document.getElementById("meta-description");
  if (descEl) {
    descEl.textContent = displayDescription(item) || "";
  }
  const critEl = document.getElementById("meta-r-critics");
  if (critEl) {
    critEl.textContent = formatCriticsRating(item);
  }
  renderModalCastSection(item);
  updateModalKinoriumHeader(item.kinorium || {});
  renderModalProvidersSidebar(item);
  renderModalSimilarItems(item);
  updateMiniPlayerTitle();
  syncPipDockUI();
  syncMediaSessionMetadata();

  if (item.media_type === "series") {
    const effMap = resolveEffectiveSeasonsMap(item, state.seasonsMap);
    populateSeasonEpisodeSelectors(item, effMap);
    updateCurrentEpisodeBar(item, state.activeSeason, state.activeEpisode, false);
  }

  const studioSel = document.getElementById("select-studio");
  if (studioSel) {
    Array.from(studioSel.options || []).forEach((opt) => {
      if (opt.dataset?.rawName) {
        opt.textContent = translateStudioName(opt.dataset.rawName);
        if (opt.selected) {
          state.activeStudioName = opt.textContent;
        }
      }
    });
  }
  populateSubtitlesSelector(state.subtitles);
  syncCustomControlPopovers();
  syncCustomVideoControlsUI(true);

  if (!document.getElementById("kinorium-postwatch-overlay")?.classList.contains("hidden")) {
    renderPostWatchRatingState();
  }

  if (!langChanged) return;

  fetchAndApplyPlayerTitleMeta(item, state.playerSessionId);
  state.preloadedNextEpisode = null;
  const video = document.getElementById("native-video");
  const { cur } = getEffectivePlaybackTiming(video);
  const resumePos = cur > 3 ? cur : 0;

  if (state.activeSourceTab === "trailer") {
    state.trailerLang = isEn() ? "en" : "ru";
    if (state.trailerData) {
      renderTrailerEmbed(state.trailerLang);
    }
  } else if (state.activeSourceTab === "hdrezka") {
    if (!getPreferredStudioForItem(item)) {
      state.activeStudioId = "";
      loadHDRezkaStream(resumePos);
    }
  } else if (state.activeSourceTab === "stremio") {
    loadStremioStreams(resumePos);
  } else if (state.activeSourceTab === "backup4k") {
    const activeRelUrl = state.active4kReleaseUrl;
    loadBackup4KReleases(resumePos).then(() => {
      if (activeRelUrl && state.isPlayerOpen && state.activeSourceTab === "backup4k") {
        probeAndPlay4KStream(activeRelUrl, resumePos, "4K UHD", state.playerSessionId, {
          extraSubtitles: state.external4kSubs || [],
        });
      }
    });
  }
}
