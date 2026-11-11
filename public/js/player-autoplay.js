import { state } from "./state.js?v=20261111v1";
import { t, isEn, displayTitle } from "./i18n.js?v=20261111v1";
import {
  pluralRu,
  showToast,
  syncCustomSelect,
} from "./utils.js?v=20261111v1";
import {
  attachSmartPosterFallback,
  buildFallbackPosterSvg,
} from "./catalog-cards.js?v=20261111v1";
import { updatePlayerGearActiveDot } from "./audio-dsp.js?v=20261111v1";
import {
  filterReleasedEpisodesForSeason,
  resolveEffectiveSeasonsMap,
  getEpisodeDisplayMeta,
  stepEpisode,
} from "./player-seasons.js?v=20261111v1";
import { scheduleDesktopRemoteStatePush } from "./remote.js?v=20261111v1";

let _nextEpTimer = null;
let _nextEpSecondsLeft = 10;
let _cachedNextEpKey = "";
let _cachedNextEpVal = null;

export function getNextEpisodeCoords() {
  if (!state.activeItem || state.activeItem.media_type !== "series") return null;
  const resolvedMap = resolveEffectiveSeasonsMap(state.activeItem, state.seasonsMap);
  const mapCurEps = resolvedMap ? (resolvedMap[String(state.activeSeason)] || []).length : 0;
  const mapSeasonsCnt = resolvedMap ? Object.keys(resolvedMap).length : 0;
  const cacheKey = `${state.activeItem.id || state.activeItem.title || ""}|${state.activeSeason}|${state.activeEpisode}|${state.liveSeriesUpdatesVersion || 0}|${mapSeasonsCnt}|${mapCurEps}|${state.activeItem.latest_season || 0}|${state.activeItem.latest_episode || 0}`;
  if (_cachedNextEpKey === cacheKey) {
    return _cachedNextEpVal;
  }

  let result = null;
  if (resolvedMap) {
    const seasonNumbers = Object.keys(resolvedMap)
      .map((k) => parseInt(k, 10))
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const curSeasonEps = filterReleasedEpisodesForSeason(
      state.activeItem,
      state.activeSeason,
      resolvedMap[String(state.activeSeason)] || []
    );
    const nextEpInCurSeason = curSeasonEps.find((ep) => ep > state.activeEpisode);
    if (nextEpInCurSeason) {
      result = { season: state.activeSeason, episode: nextEpInCurSeason };
    } else {
      for (const s of seasonNumbers) {
        if (s <= state.activeSeason) continue;
        const releasedForS = filterReleasedEpisodesForSeason(
          state.activeItem,
          s,
          resolvedMap[String(s)] || []
        );
        if (releasedForS.length > 0) {
          result = { season: s, episode: releasedForS[0] };
          break;
        }
      }
    }
    _cachedNextEpKey = cacheKey;
    _cachedNextEpVal = result;
    return result;
  }

  // Fallback only if explicit seasons_count & episodes_per_season exist on curated item while stream metadata loads
  const explicitSeasons = Number(state.activeItem.seasons_count) || 0;
  const explicitEps = Number(state.activeItem.episodes_per_season) || 0;
  if (explicitSeasons > 0 && explicitEps > 0) {
    if (state.activeEpisode < explicitEps) {
      result = { season: state.activeSeason, episode: state.activeEpisode + 1 };
    } else if (state.activeSeason < explicitSeasons) {
      result = { season: state.activeSeason + 1, episode: 1 };
    }
  }
  _cachedNextEpKey = cacheKey;
  _cachedNextEpVal = result;
  return result;
}

export function showPlayerNextEpisodeToast(coords) {
  const toast = document.getElementById("player-next-ep-toast");
  if (!toast || !toast.classList.contains("hidden")) return;
  const nextCoords = coords || getNextEpisodeCoords();
  if (!nextCoords) return;

  const nextSeason = nextCoords.season;
  const nextEpisode = nextCoords.episode;
  const epMeta = getEpisodeDisplayMeta(nextSeason, nextEpisode);
  const thumb =
    epMeta?.still_path ||
    epMeta?.thumbnail ||
    state.activeItem?.backdrop ||
    state.activeItem?.poster ||
    "";
  const title =
    epMeta?.realTitle ||
    epMeta?.rawTitle ||
    epMeta?.name ||
    `${t("Серия", "Episode")} ${nextEpisode}`;
  const sub = `${t("Сезон", "Season")} ${nextSeason} · ${t("Серия", "Episode")} ${nextEpisode}`;

  const thumbEl = document.getElementById("next-ep-thumb");
  const titleEl = document.getElementById("next-ep-title");
  const subEl = document.getElementById("next-ep-sub");
  const secEl = document.getElementById("next-ep-countdown-sec");
  const ringFill = document.getElementById("next-ep-ring-fill");
  const ringWrap = toast.querySelector(".atv-next-ep-ring-wrap");

  if (thumbEl) {
    thumbEl.src =
      thumb ||
      buildFallbackPosterSvg(
        displayTitle(state.activeItem),
        state.activeItem?.year
      );
    if (state.activeItem) {
      attachSmartPosterFallback(thumbEl, state.activeItem);
    }
  }
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = sub;

  const bridgeBadge = document.getElementById("next-ep-bridge-badge");
  const isPreloaded = Boolean(state.preloadedNextEpisode && state.preloadedNextEpisode.key);
  if (bridgeBadge) {
    bridgeBadge.classList.toggle("hidden", !isPreloaded || !state.seamlessEpisodeBridge);
  }

  document.getElementById("xray-pause-shelf")?.classList.add("hidden");
  document.getElementById("skip-outro-btn")?.classList.add("hidden");
  toast.classList.remove("hidden");

  if (_nextEpTimer) {
    clearInterval(_nextEpTimer);
    _nextEpTimer = null;
  }

  if (!state.autoNextEpisode) {
    if (ringWrap) ringWrap.classList.add("hidden");
    return;
  }

  if (ringWrap) ringWrap.classList.remove("hidden");
  _nextEpSecondsLeft = 10;
  if (secEl) secEl.textContent = "10";
  if (ringFill) ringFill.style.strokeDashoffset = "0";

  _nextEpTimer = setInterval(async () => {
    const videoEl = document.getElementById("native-video");
    if (
      !state.isPlayerOpen ||
      !state.autoNextEpisode ||
      state.sleepAtEpisodeEnd ||
      isPostwatchCardPausingAutoplay()
    ) {
      dismissPlayerNextEpisodeToast(false);
      return;
    }
    if (videoEl && videoEl.paused && !videoEl.ended) {
      return;
    }
    _nextEpSecondsLeft -= 1;
    if (secEl) secEl.textContent = String(Math.max(0, _nextEpSecondsLeft));
    if (ringFill) {
      const offset = ((10 - _nextEpSecondsLeft) / 10) * 100;
      ringFill.style.strokeDashoffset = String(offset);
    }
    if (_nextEpSecondsLeft <= 0) {
      dismissPlayerNextEpisodeToast(false);
      await stepEpisode(1);
    }
  }, 1000);
}

export function dismissPlayerNextEpisodeToast(manual = true) {
  if (_nextEpTimer) {
    clearInterval(_nextEpTimer);
    _nextEpTimer = null;
  }
  const toast = document.getElementById("player-next-ep-toast");
  if (toast) {
    toast.classList.add("hidden");
  }
  if (manual) {
    state._nextEpToastDismissed = true;
  }
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
    syncCustomSelect(selectEl);
  }
  if (groupEl) {
    groupEl.classList.toggle("sleep-active", state.sleepTimerMode !== "off");
  }
  updatePlayerGearActiveDot();
  scheduleDesktopRemoteStatePush(120);

  if (state.sleepTimerMode === "off") {
    if (state._preSleepVolume !== undefined && state._preSleepVolume !== null) {
      const vid = document.getElementById("native-video");
      const restoredVol = state._preSleepVolume;
      state._preSleepVolume = null;
      if (vid) {
        state.internalMuteOverride = true;
        try {
          vid.volume = restoredVol;
        } finally {
          setTimeout(() => {
            state.internalMuteOverride = false;
          }, 50);
        }
      }
    }
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
    if (state.sleepTimerSecondsLeft <= 30 && state.sleepTimerSecondsLeft > 0) {
      const vid = document.getElementById("native-video");
      if (vid) {
        if (state._preSleepVolume === undefined || state._preSleepVolume === null) {
          state._preSleepVolume = vid.volume;
        }
        state.internalMuteOverride = true;
        try {
          vid.volume = Math.max(0, state._preSleepVolume * (state.sleepTimerSecondsLeft / 30));
        } finally {
          setTimeout(() => {
            state.internalMuteOverride = false;
          }, 50);
        }
      }
    }
    if (state.sleepTimerSecondsLeft <= 0) {
      clearInterval(state.sleepTimerId);
      state.sleepTimerId = null;
      state.sleepTimerMode = "off";
      state.sleepAtEpisodeEnd = false;
      if (selectEl) {
        selectEl.value = "off";
        syncCustomSelect(selectEl);
      }
      if (groupEl) groupEl.classList.remove("sleep-active");
      updatePlayerGearActiveDot();
      scheduleDesktopRemoteStatePush(120);
      const video = document.getElementById("native-video");
      if (video && !video.paused) {
        video.pause();
      }
      if (video && state._preSleepVolume !== undefined && state._preSleepVolume !== null) {
        const restoredVol = state._preSleepVolume;
        state._preSleepVolume = null;
        state.internalMuteOverride = true;
        try {
          video.volume = restoredVol;
        } finally {
          setTimeout(() => {
            state.internalMuteOverride = false;
          }, 50);
        }
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

export function clearAutoplayNextTimer() {
  dismissPlayerNextEpisodeToast(false);
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
  const titleEl = document.getElementById("autoplay-next-title");
  const textEl = document.getElementById("autoplay-next-text");
  const fillEl = document.getElementById("autoplay-next-fill");
  const btnNowLabel = document.getElementById("btn-autoplay-now-label");
  const btnCancelLabel = document.getElementById("btn-autoplay-cancel-label");
  if (!card || !textEl) return;

  const postwatchOpen = !document.getElementById("kinorium-postwatch-overlay")?.classList.contains("hidden");
  const totalSeconds = postwatchOpen ? 7 : 5;
  state.autoplaySecondsLeft = totalSeconds;
  const nextEpMeta = getEpisodeDisplayMeta(nextCoords.season, nextCoords.episode);
  const nextEpTitle = nextEpMeta.realTitle ? `«${nextEpMeta.realTitle}»` : "";
  const nextEpTitleEn = nextEpMeta.realTitle ? `"${nextEpMeta.realTitle}"` : "";

  if (titleEl) {
    titleEl.textContent = isEn()
      ? `Season ${nextCoords.season}, Episode ${nextCoords.episode} ${nextEpTitleEn}`.trim()
      : `Сезон ${nextCoords.season}, Серия ${nextCoords.episode} ${nextEpTitle}`.trim();
  }
  if (btnNowLabel) {
    btnNowLabel.textContent = isEn() ? "Watch Now" : "Смотреть сейчас";
  }
  if (btnCancelLabel) {
    btnCancelLabel.textContent = isEn() ? "Watch Credits" : "Остаться на титрах";
  }

  const updateLabel = (paused = false) => {
    const isPreloaded = Boolean(
      state.preloadedNextEpisode && state.preloadedNextEpisode.key && state.seamlessEpisodeBridge
    );
    const bridgeNote = isPreloaded ? (isEn() ? " (seamless)" : " (бесшовно)") : "";
    if (fillEl) {
      const ratio = Math.max(0, Math.min(1, state.autoplaySecondsLeft / totalSeconds));
      fillEl.style.transform = `scaleX(${ratio.toFixed(4)})`;
    }
    if (isEn()) {
      const pauseNote = paused ? " (paused)" : "";
      textEl.textContent = `Auto-playing in ${state.autoplaySecondsLeft} ${state.autoplaySecondsLeft === 1 ? "second" : "seconds"}${bridgeNote}${pauseNote}...`;
      return;
    }
    const pauseNote = paused ? " (на паузе)" : "";
    textEl.textContent = `Автопереход через ${state.autoplaySecondsLeft} ${pluralRu(
      state.autoplaySecondsLeft,
      "секунду",
      "секунды",
      "секунд"
    )}${bridgeNote}${pauseNote}...`;
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
