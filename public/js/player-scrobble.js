// CineFlow Player Scrobbling Subsystem
// Handles playback progress reporting to Kinorium, milestone status updates
// (watching_10, completed, series finale), continue watching synchronization,
// and offline download automation triggers.

import { state } from "./state.js?v=20261104v24";
import { t, displayTitle } from "./i18n.js?v=20261104v24";
import { saveEpisodeProgress, showToast } from "./utils.js?v=20261104v24";
import {
  isServiceEnabled,
  patchCatalogItemKinoriumInPlace,
  renderContinueWatching,
  updateKinoriumSectionCounters,
} from "./catalog.js?v=20261104v24";
import { refreshOpenPersonModalUI } from "./modals.js?v=20261104v24";
import { refreshDownloadsState } from "./features.js?v=20261104v24";
import {
  resolveEffectiveSeasonsMap,
  resolveSeriesCompletedFlag,
  populateSeasonEpisodeSelectors,
} from "./player-seasons.js?v=20261104v24";
import { updateModalKinoriumHeader } from "./player-meta.js?v=20261104v24";

export async function reportScrobbleProgress(currentTime, duration, options = {}) {
  if (!state.activeItem) return;
  const item = state.activeItem;
  if (item.is_local_file || String(item.id || "").startsWith("local_")) return;
  const reqProfileId = state.activeProfileId;
  const forceWatched = Boolean(options.forceWatched);
  const reason = String(options.reason || "");
  const reqSeason = Number(options.season || state.activeSeason) || 1;
  const reqEpisode = Number(options.episode || state.activeEpisode) || 1;

  const effectiveMap = resolveEffectiveSeasonsMap(item, state.seasonsMap);
  const sKeys = Object.keys(effectiveMap || {})
    .map((k) => parseInt(k, 10))
    .filter((n) => !Number.isNaN(n));
  const totalSeasons = sKeys.length > 0 ? Math.max(...sKeys) : 0;
  const curEps = effectiveMap?.[String(reqSeason)];
  const totalEpsInSeason = Array.isArray(curEps) && curEps.length > 0 ? Math.max(...curEps) : 0;

  const reqRatio = duration > 0 ? currentTime / duration : 0;
  const expectsWatched = forceWatched || reqRatio >= 0.95;
  const reqEpKey = `${item.id || ""}:s${reqSeason}e${reqEpisode}`;
  const wasEpNotified = Boolean(state.scrobbledEpisodesThisSession[reqEpKey]);
  const wasMovieNotified = Boolean(state.scrobbledThisSession);

  let lockedEpHere = false;
  let lockedMovieHere = false;
  if (expectsWatched) {
    if (item.media_type === "series") {
      state.scrobbleInFlightEpisodes = state.scrobbleInFlightEpisodes || {};
      state.scrobbleInFlightEpisodes[reqEpKey] = true;
      if (!state.scrobbledEpisodesThisSession[reqEpKey]) {
        state.scrobbledEpisodesThisSession[reqEpKey] = true;
        lockedEpHere = true;
      }
    } else if (!state.scrobbledThisSession) {
      state.scrobbledThisSession = true;
      lockedMovieHere = true;
    }
  }

  try {
    const res = await fetch("/api/kinorium/scrobble", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        rezka_id: String(item.rezka_id || ""),
        rezka_url: String(item.rezka_url || ""),
        year: Number(item.year || 0),
        title: item.title,
        orig_title: item.orig_title,
        poster: item.poster,
        backdrop: item.backdrop,
        media_type: item.media_type,
        season: reqSeason,
        episode: reqEpisode,
        total_seasons: totalSeasons,
        total_episodes_in_season: totalEpsInSeason,
        is_series_completed: resolveSeriesCompletedFlag(item),
        current_time: currentTime,
        duration: duration,
        force_watched: forceWatched,
        reason: reason,
        is_offline: Boolean(state.activeSourceTab === "offline" || state.isPlayingOfflineDownload),
        download_id: String(state.activeOfflineDownloadId || ""),
        source:
          state.activeSourceTab === "stremio"
            ? "Stremio"
            : state.activeSourceTab === "backup4k"
            ? "4K Remux"
            : state.activeSourceTab === "offline"
            ? "Offline MP4"
            : "HDRezka",
        studio: state.activeStudioName,
      }),
    });
    const data = await res.json();
    if (!res.ok || data?.ok === false || data?.error) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    if (reqProfileId && state.activeProfileId && reqProfileId !== state.activeProfileId) {
      return;
    }
    const offlineHook = data.offline_automation || data.offline_hook;
    if (offlineHook && (offlineHook.cleaned?.length || offlineHook.queued_next)) {
      refreshDownloadsState();
    }
    const statusMilestone = Boolean(
      data.just_scrobbled ||
        data.just_scrobbled_episode ||
        data.auto_completed_series ||
        data.promoted_to_watching
    );
    if (data.kinorium_counts) {
      state.kinoriumCounts = { ...state.kinoriumCounts, ...data.kinorium_counts };
      updateKinoriumSectionCounters();
    }
    if (data.kinorium_status) {
      item.kinorium = data.kinorium_status;
      state.catalogDirty = true;
      if (statusMilestone) {
        if (state.activeItem && String(state.activeItem.id || "") === String(item.id || "")) {
          updateModalKinoriumHeader(data.kinorium_status);
          if (item.media_type === "series") {
            populateSeasonEpisodeSelectors(item, state.seasonsMap);
          }
        }
        patchCatalogItemKinoriumInPlace(item, data.kinorium_status);
      }
    }
    if (data.continue_watching) {
      state.continueWatching = data.continue_watching;
      state.catalogDirty = true;
      if (statusMilestone || !state.isPlayerOpen || state.isMiniPlayer || state.isPipBackground) {
        renderContinueWatching();
      }
    }
    const kinSyncSuffixRu = data.remote_synced && isServiceEnabled("kinorium") ? " в Kinorium" : "";
    const kinSyncSuffixEn = data.remote_synced && isServiceEnabled("kinorium") ? " on Kinorium" : "";
    if (item.media_type === "series" && data.remote_synced) {
      const sNumSync = Number(data.scrobbled_season || reqSeason) || 1;
      const eNumSync = Number(data.scrobbled_episode || reqEpisode) || 1;
      state.remoteSyncedEpisodesThisSession = state.remoteSyncedEpisodesThisSession || {};
      state.remoteSyncedEpisodesThisSession[`${item.id || ""}:s${sNumSync}e${eNumSync}`] = true;
    }

    if (item.media_type === "series" && (data.just_scrobbled_episode || data.auto_completed_series)) {
      const sNum = Number(data.scrobbled_season || reqSeason) || 1;
      const eNum = Number(data.scrobbled_episode || reqEpisode) || 1;
      const epKey = `${item.id || ""}:s${sNum}e${eNum}`;
      state.scrobbledEpisodesThisSession[epKey] = true;
      const effDur = Math.max(Number(duration) || 0, 120);
      saveEpisodeProgress(item, sNum, eNum, effDur, effDur);
      if (data.auto_completed_series) {
        state.scrobbledThisSession = true;
        refreshOpenPersonModalUI();
        showToast(
          t(
            `Финал сериала «${displayTitle(item)}» просмотрен — статус изменён на «Просмотрено»${kinSyncSuffixRu}`,
            `Series finale of "${displayTitle(item)}" watched — status changed to Watched${kinSyncSuffixEn}`
          )
        );
      } else if (!wasEpNotified) {
        showToast(
          t(
            `Сезон ${sNum}, Серия ${eNum} отмечена просмотренной${kinSyncSuffixRu}`,
            `Season ${sNum}, Episode ${eNum} marked as watched${kinSyncSuffixEn}`
          )
        );
      }
    } else if (item.media_type !== "series" && data.just_scrobbled && !wasMovieNotified) {
      state.scrobbledThisSession = true;
      const effDur = Math.max(Number(duration) || 0, 120);
      saveEpisodeProgress(item, 1, 1, effDur, effDur);
      refreshOpenPersonModalUI();
      showToast(
        t(
          `Отмечено просмотренным${kinSyncSuffixRu}: «${displayTitle(item)}»`,
          `Marked as watched${kinSyncSuffixEn}: "${displayTitle(item)}"`
        )
      );
    } else if (data.promoted_to_watching && !data.just_scrobbled && !data.just_scrobbled_episode) {
      refreshOpenPersonModalUI();
      showToast(
        t(
          `Статус изменён на «Смотрю»${kinSyncSuffixRu}: «${displayTitle(item)}»`,
          `Status changed to "Watching"${kinSyncSuffixEn}: "${displayTitle(item)}"`
        )
      );
    }
  } catch (err) {
    if (lockedEpHere) {
      delete state.scrobbledEpisodesThisSession[reqEpKey];
    }
    if (lockedMovieHere) {
      state.scrobbledThisSession = false;
    }
    console.error("Scrobble error:", err);
  } finally {
    if (expectsWatched && item.media_type === "series" && state.scrobbleInFlightEpisodes) {
      delete state.scrobbleInFlightEpisodes[reqEpKey];
    }
  }
}
