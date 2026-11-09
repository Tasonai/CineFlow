import { state } from "./state.js?v=20261109v2";
import { displayPoster, displayTitle, t, translateStudioName } from "./i18n.js?v=20261109v2";
import {
  copyTextToClipboard,
  escapeAttr,
  escapeHtml,
  formatTime,
  iconSvg,
  initCustomSelects,
  saveUiPrefs,
  showToast,
  showVideoOsd,
  syncCustomSelect,
} from "./utils.js?v=20261109v2";
import {
  applyAudioBoostToVideo,
  applyVideoCropToVideo,
  ensurePreservesPitch,
  getAudioPresetLabel,
  getVideoCropLabel,
  isVideoInPiP,
  savePlayerPrefs,
  startAmbilightLoop,
  stopAmbilightLoop,
  togglePictureInPicture,
} from "./audio-dsp.js?v=20261109v2";
import {
  adjustSubtitleOffset,
  formatSubtitleOffsetLabel,
  resetSubtitleOffset,
} from "./subtitles.js?v=20261109v2";
import {
  addOrUpdateRemoteBookmark,
  closePlayerModal,
  collectActiveTimelineChapters,
  deleteRemoteBookmarkByIdOrTime,
  findActiveChapterLabel,
  getEffectivePlaybackTiming,
  getEpisodeDisplayMeta,
  getEpisodeRatingEntry,
  getNextEpisodeCoords,
  isCastEntryInScene,
  isStageFullscreen,
  jumpToAdjacentTimelineMarker,
  openPlayerModal,
  rateActivePlayerTitle,
  resolveActiveXRaySceneContext,
  resolveEffectiveSeasonsMap,
  scoreTrackForScene,
  seekEffectivePlayback,
  setSleepTimer,
  stepEpisode,
  switchToSeriesSeasonEpisode,
  syncCustomVideoControlsUI,
  toggleActivePlayerWatched,
  toggleBookmarkCurrentMoment,
  toggleStageFullscreen,
  toggleVideoPlayPause,
  toggleXRayPauseShelf,
} from "./player.js?v=20261109v2";
import { openPersonModal } from "./modals.js?v=20261109v2";
import { attachSmartPosterFallback, isEpisodeWatched } from "./catalog.js?v=20261109v2";
import {
  closeTvCastModal,
  executeRemoteDpadCommand,
  exitBrowserFullscreenIfNeeded,
  isItemSafeForKidsClient,
  requestKidsPinVerification,
  setTvMode,
} from "./features.js?v=20261109v2";

export function isMobileRemoteUrl() {
  if (typeof window === "undefined") return false;
  try {
    const qs = new URLSearchParams(window.location.search || "");
    return qs.get("remote") === "1";
  } catch (_) {
    return false;
  }
}

function _isLoopbackHost() {
  if (typeof window === "undefined") return false;
  const h = String(window.location.hostname || "").toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

function _detectPhoneDeviceLabel() {
  if (typeof navigator === "undefined") return "Phone";
  const ua = String(navigator.userAgent || "");
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  return t("Смартфон", "Smartphone");
}

function _getOrCreateRemoteClientId() {
  if (typeof localStorage === "undefined") return "rm_guest";
  try {
    let cid = localStorage.getItem("velarium_remote_cid");
    if (!cid) {
      cid = `rm_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("velarium_remote_cid", cid);
    }
    return cid;
  } catch (_) {
    return "rm_guest";
  }
}

/* ==========================================================================
   1. Desktop Agent (Runs inside Velarium on Mac / Windows)
   ========================================================================== */
let _desktopAgentStarted = false;
let _desktopPushTimer = null;
let _desktopPushInFlight = false;
let _desktopPushQueued = false;
let _lastDesktopPushTs = 0;
let _cachedRemoteXrayPayload = null;
let _cachedRemoteXrayKey = "";
let _cachedRemoteXrayTs = 0;
let _cachedSeasonsSnap = null;
let _cachedSeasonsSnapKey = "";
let _cachedSeasonsSnapTs = 0;
let _cachedRemoteSelectsSig = "";
let _cachedRemoteStudios = [];
let _cachedRemoteQualities = [];
let _cachedRemoteSubtitles = [];
let _cachedRemoteChaptersKey = "";
let _cachedRemoteChapters = [];
let _cachedRemoteBookmarksKey = "";
let _cachedRemoteBookmarks = [];

function _hasActiveRemoteOrPairingModal() {
  if (Number(state.remoteConnectedCount) > 0) return true;
  if (typeof document === "undefined") return false;
  const castModal = document.getElementById("tv-cast-modal");
  return Boolean(castModal && !castModal.classList.contains("hidden"));
}

function _collectDesktopStateSnapshot() {
  const video = typeof document !== "undefined" ? document.getElementById("native-video") : null;
  const { cur, dur } = getEffectivePlaybackTiming(video);
  const item = state.activeItem;

  let desktopMode = "window";
  if (isStageFullscreen()) desktopMode = "fullscreen";
  else if (state.isMiniPlayer) desktopMode = "mini";
  else if (state.isPipBackground) desktopMode = "pip";

  let activeItemSnap = null;
  if (state.isPlayerOpen && item) {
    const isSeries = item.media_type === "series";
    const sNum = isSeries ? Number(state.activeSeason) || 1 : 1;
    const eNum = isSeries ? Number(state.activeEpisode) || 1 : 1;
    const epMeta = isSeries ? getEpisodeDisplayMeta(sNum, eNum) : null;
    const epRatingObj = isSeries ? getEpisodeRatingEntry(item, sNum, eNum) : null;
    activeItemSnap = {
      id: item.id || "",
      title: displayTitle(item) || item.title || "",
      orig_title: item.orig_title || "",
      year: item.year || "",
      media_type: item.media_type || "movie",
      poster: displayPoster(item) || item.poster || "",
      backdrop: item.backdrop || item.poster || "",
      season: sNum,
      episode: eNum,
      episode_title: epMeta?.realTitle || "",
      user_rating: Number(item.kinorium?.user_rating) || 0,
      episode_rating: isSeries ? Number(epRatingObj?.score) || 0 : 0,
      watched: Boolean(item.kinorium?.watched),
      episode_watched: isSeries ? Boolean(isEpisodeWatched(item, sNum, eNum)) : false,
    };
  }

  const studioSel = typeof document !== "undefined" ? document.getElementById("select-studio") : null;
  const qualSel = typeof document !== "undefined" ? document.getElementById("select-quality") : null;
  const subSel = typeof document !== "undefined" ? document.getElementById("select-subtitle") : null;
  const selectsSig = `${studioSel ? `${studioSel.options.length}:${studioSel.options[0]?.value || ""}:${studioSel.options[studioSel.options.length - 1]?.value || ""}` : ""}|${qualSel ? `${qualSel.options.length}:${qualSel.options[0]?.value || ""}:${qualSel.options[qualSel.options.length - 1]?.value || ""}` : ""}|${subSel ? `${subSel.options.length}:${subSel.options[0]?.textContent || ""}:${subSel.options[subSel.options.length - 1]?.textContent || ""}` : ""}|${state.appLang || "ru"}`;
  if (_cachedRemoteSelectsSig !== selectsSig) {
    _cachedRemoteSelectsSig = selectsSig;
    _cachedRemoteStudios = studioSel
      ? Array.from(studioSel.options || []).map((o) => ({
          id: String(o.value),
          label: String(o.textContent || "").trim(),
        }))
      : [];
    _cachedRemoteQualities = qualSel
      ? Array.from(qualSel.options || []).map((o) => ({
          id: String(o.value),
          label: String(o.textContent || "").trim(),
        }))
      : [];
    _cachedRemoteSubtitles = subSel
      ? Array.from(subSel.options || []).map((o) => ({
          index: parseInt(o.value, 10),
          label: String(o.textContent || "").trim(),
        }))
      : [{ index: -1, label: t("Выключены", "Off") }];
  }
  const studios = _cachedRemoteStudios;
  const qualities = _cachedRemoteQualities;
  const subtitles = _cachedRemoteSubtitles;

  const skipIntroEl = typeof document !== "undefined" ? document.getElementById("skip-intro-btn") : null;
  const hasSkipIntro = Boolean(
    state.isPlayerOpen &&
      ((skipIntroEl && !skipIntroEl.classList.contains("hidden")) ||
        (state.skipSegments?.intro &&
          cur >= Number(state.skipSegments.intro.start || 0) - 2 &&
          cur < Number(state.skipSegments.intro.end || 0)))
  );

  const prevEpBtn = typeof document !== "undefined" ? document.getElementById("btn-prev-ep") : null;
  const hasPrevEp = Boolean(
    state.isPlayerOpen &&
      item?.media_type === "series" &&
      prevEpBtn &&
      !prevEpBtn.disabled
  );
  const hasNextEp = Boolean(
    state.isPlayerOpen && item?.media_type === "series" && getNextEpisodeCoords()
  );

  const rawBookmarks = Array.isArray(state.activeItemBookmarks) ? state.activeItemBookmarks : [];
  const bmSig = `${item?.id || item?.title || ""}|${rawBookmarks.length}|${rawBookmarks[0]?.id || ""}:${rawBookmarks[0]?.note || ""}|${rawBookmarks[rawBookmarks.length - 1]?.id || ""}:${rawBookmarks[rawBookmarks.length - 1]?.note || ""}`;
  if (_cachedRemoteBookmarksKey !== bmSig) {
    _cachedRemoteBookmarksKey = bmSig;
    _cachedRemoteBookmarks = rawBookmarks.slice(0, 40).map((b) => ({
      id: String(b.id || ""),
      time: Math.round(Number(b.time) || 0),
      label: String(b.label || formatTime(b.time || 0)),
      note: String(b.note || ""),
    }));
  }
  const bookmarks = _cachedRemoteBookmarks;
  const chaptersCacheKey = `${state.isPlayerOpen ? 1 : 0}|${Math.round(Number(dur) || 0)}|${state.skipSegments?.intro?.start || 0}:${state.skipSegments?.intro?.end || 0}|${state.skipSegments?.outro?.start || 0}|${state.probeCreditsStartSec || 0}|${(state.remuxMeta?.chapters || []).length}|${state.appLang || "ru"}`;
  if (_cachedRemoteChaptersKey !== chaptersCacheKey) {
    _cachedRemoteChaptersKey = chaptersCacheKey;
    _cachedRemoteChapters =
      state.isPlayerOpen && Number(dur) > 0 ? collectActiveTimelineChapters(dur).slice(0, 40) : [];
  }
  const chapters = _cachedRemoteChapters;
  const activeChapter =
    state.isPlayerOpen && Number(dur) > 0 ? findActiveChapterLabel(cur, dur) : "";

  let seasonsMapSnap = {};
  let watchedEpisodesSnap = {};
  if (state.isPlayerOpen && item?.media_type === "series") {
    const nowSnapMs = Date.now();
    const weObj = item.kinorium?.watched_episodes;
    const weSig = weObj && typeof weObj === "object" ? Object.keys(weObj).map((k) => `${k}:${(weObj[k] || []).length}`).join(",") : "";
    const seasonsCacheKey = `${item.id || item.title || ""}|${state.activeSeason || 1}|${state.activeEpisode || 1}|${Object.keys(state.seasonsMap || {}).length}|${Object.keys(state.episodesMeta || {}).length}|${weSig}`;
    if (
      _cachedSeasonsSnap &&
      _cachedSeasonsSnapKey === seasonsCacheKey &&
      nowSnapMs - _cachedSeasonsSnapTs < 30000
    ) {
      seasonsMapSnap = _cachedSeasonsSnap.seasonsMapSnap;
      watchedEpisodesSnap = _cachedSeasonsSnap.watchedEpisodesSnap;
    } else {
      const resolvedMap = resolveEffectiveSeasonsMap(item, state.seasonsMap) || {};
      const todayIso = new Date().toISOString().slice(0, 10);
      const effLatestS = Number(item.latest_season || item.kinorium?.latest_season || 0);
      const effLatestE = Number(item.latest_episode || item.kinorium?.latest_episode || 0);
      const mapKeys = Object.keys(resolvedMap)
        .map((k) => parseInt(k, 10))
        .filter((n) => n > 0)
        .sort((a, b) => a - b);
      const curS = Math.max(1, Number(state.activeSeason) || 1);
      const curE = Math.max(1, Number(state.activeEpisode) || 1);
      const seasonNums =
        mapKeys.length > 0
          ? mapKeys
          : Array.from({ length: Math.max(curS, Number(item.seasons_count) || 1) }, (_, i) => i + 1);
      seasonNums.forEach((sNum) => {
        const sKey = String(sNum);
        const metaForSeason = state.episodesMeta?.[sKey] || {};
        const rawEps =
          Array.isArray(resolvedMap[sKey]) && resolvedMap[sKey].length > 0
            ? resolvedMap[sKey]
            : Array.from({ length: Math.max(curE, Number(item.episodes_per_season) || 1) }, (_, i) => i + 1);
        const releasedEps = rawEps.filter((eNum) => {
          const rawMeta = metaForSeason[String(eNum)] || {};
          const airDateStr = String(rawMeta.air_date || rawMeta.airDate || "");
          if (/^\d{4}-\d{2}-\d{2}/.test(airDateStr) && airDateStr.slice(0, 10) > todayIso) return false;
          if (rawMeta.is_future === true || rawMeta.is_released === false) return false;
          if (effLatestS > 0 && effLatestE > 0 && sNum === effLatestS && eNum > effLatestE) return false;
          return true;
        });
        if (releasedEps.length > 0) {
          seasonsMapSnap[sKey] = releasedEps.slice(0, 120);
          const wList = releasedEps.filter((eNum) => isEpisodeWatched(item, sNum, eNum));
          if (wList.length > 0) {
            watchedEpisodesSnap[sKey] = wList;
          }
        }
      });
      _cachedSeasonsSnapKey = seasonsCacheKey;
      _cachedSeasonsSnapTs = nowSnapMs;
      _cachedSeasonsSnap = { seasonsMapSnap, watchedEpisodesSnap };
    }
  }

  return {
    app_lang: state.appLang === "en" ? "en" : "ru",
    is_player_open: Boolean(state.isPlayerOpen),
    desktop_mode: desktopMode,
    tv_mode: Boolean(state.tvMode),
    playing: Boolean(state.isPlayerOpen && video && !video.paused && !video.ended),
    current_time: Math.round((Number(cur) || 0) * 10) / 10,
    duration: Math.round((Number(dur) || 0) * 10) / 10,
    playback_rate: Number(video?.playbackRate) || 1.0,
    volume: video ? Math.round((Number(video.volume) || 0) * 100) / 100 : 1.0,
    muted: Boolean(video?.muted),
    active_source_tab: state.activeSourceTab || "hdrezka",
    active_item: activeItemSnap,
    studios,
    active_studio: studioSel ? String(studioSel.value || "") : "",
    active_studio_name: state.activeStudioName || "",
    qualities,
    active_quality: qualSel ? String(qualSel.value || "") : "",
    subtitles,
    active_sub_idx: Number.isFinite(state.activeSubtitleIndex) ? state.activeSubtitleIndex : -1,
    sub_offset_sec: Number(state.subtitleOffsetSec) || 0,
    has_skip_intro: hasSkipIntro,
    has_prev_ep: hasPrevEp,
    has_next_ep: hasNextEp,
    bookmarks,
    chapters,
    active_chapter: activeChapter,
    xray: (() => {
      const isEnUi = state.appLang === "en";
      const nowMs = Date.now();
      const sceneCtx = resolveActiveXRaySceneContext(cur, dur);
      const xrayCacheKey = `${item?.id || item?.title || ""}|${isEnUi ? "en" : "ru"}|${sceneCtx?.memoKey || Math.floor((Number(cur) || 0) / 30)}|${Boolean(item?._xrayData)}`;
      if (
        _cachedRemoteXrayPayload &&
        _cachedRemoteXrayKey === xrayCacheKey &&
        nowMs - _cachedRemoteXrayTs < 30000
      ) {
        return _cachedRemoteXrayPayload;
      }
      const castPeopleList =
        isEnUi && Array.isArray(item?.cast_people_en) && item.cast_people_en.length > 0
          ? item.cast_people_en
          : item?.cast_people;
      const actorsList =
        isEnUi && Array.isArray(item?.actors_en) && item.actors_en.length > 0
          ? item.actors_en
          : item?.actors;
      const directorsList =
        isEnUi && Array.isArray(item?.directors_en) && item.directors_en.length > 0
          ? item.directors_en
          : item?.directors;
      const castCombined = [];
      const seenCastNames = new Set();
      const pushCastEntry = (entry, fallbackRole) => {
        if (!entry) return;
        const isObj = typeof entry === "object";
        const nm = String(isObj ? entry.name || entry.actor || "" : entry).trim();
        if (!nm || seenCastNames.has(nm.toLowerCase())) return;
        seenCastNames.add(nm.toLowerCase());
        const rawRole = isObj ? entry.role : "";
        const isDir = rawRole === "director" || Boolean(isObj && entry.is_director) || fallbackRole === "director";
        const roleLbl = isDir
          ? t("Режиссёр", "Director")
          : (isObj && entry.character) || (rawRole && rawRole !== "actor" ? rawRole : t("В ролях", "Cast"));
        const rawPhoto = isObj ? String(entry.photo || entry.image || "").trim() : "";
        const proxyPhoto = `/api/person-photo?name=${encodeURIComponent(nm)}${
          rawPhoto ? `&url=${encodeURIComponent(rawPhoto)}` : ""
        }&strict=1&v=3`;
        const personObj = isObj ? { ...entry, name: nm } : { name: nm, role: fallbackRole };
        const inScene = isCastEntryInScene(personObj, sceneCtx);
        if (isObj && personObj._xrayCompiledTokens) {
          entry._xrayCompiledTokens = personObj._xrayCompiledTokens;
          entry._xrayCompiledKey = personObj._xrayCompiledKey;
        }
        castCombined.push({
          name: nm,
          role: roleLbl,
          photo: proxyPhoto,
          in_scene: inScene,
          _idx: castCombined.length,
        });
      };
      if (Array.isArray(castPeopleList) && castPeopleList.length > 0) {
        castPeopleList.forEach((p) => pushCastEntry(p, "actor"));
      }
      if (Array.isArray(directorsList)) {
        directorsList.forEach((d) => pushCastEntry(d, "director"));
      }
      if (Array.isArray(actorsList)) {
        actorsList.forEach((a) => pushCastEntry(a, "actor"));
      }
      castCombined.sort((a, b) => (a.in_scene !== b.in_scene ? (a.in_scene ? -1 : 1) : a._idx - b._idx));
      const castSnap = castCombined.slice(0, 30).map(({ _idx, ...rest }) => rest);

      const ostRaw = Array.isArray(item?._xrayData?.soundtrack)
        ? item._xrayData.soundtrack
        : Array.isArray(item?.soundtrack)
        ? item.soundtrack
        : [];
      const soundtrackSnap = ostRaw
        .slice(0, 30)
        .map((tr, idx) => {
          const rawScene = String(tr.scene || tr.scene_hint || "").trim();
          const cleanScene = /^(официальный саундтрек|official soundtrack)$/i.test(rawScene) ? "" : rawScene;
          const match = scoreTrackForScene(tr, sceneCtx);
          return {
            title: tr.title || tr.name || "",
            artist: tr.artist || "",
            scene: cleanScene,
            in_scene: Boolean(match.inScene),
            scene_badge: match.badgeText || "",
            _score: match.score || 0,
            _idx: idx,
            artwork_url: tr.artwork_url || "",
            preview_url: tr.preview_url || "",
            listen_url: tr.listen_url || tr.spotify_url || tr.apple_music_url || "",
          };
        })
        .filter((tr) => Boolean(tr.title))
        .sort((a, b) => (b._score !== a._score ? b._score - a._score : a._idx - b._idx))
        .map(({ _score, _idx, ...rest }) => rest);

      const triviaRaw = Array.isArray(item?._xrayData?.trivia)
        ? item._xrayData.trivia
        : Array.isArray(item?.trivia)
        ? item.trivia
        : [];
      const triviaSnap = triviaRaw
        .slice(0, 30)
        .map((tr) => ({
          badge: tr.badge || "",
          text: tr.text || tr.fact || "",
        }))
        .filter((tr) => Boolean(tr.text));

      const langKey = isEnUi ? "en" : "ru";
      if (
        _hasActiveRemoteOrPairingModal() &&
        state.isPlayerOpen &&
        item &&
        (!item._xrayData || item._xrayDataLang !== langKey) &&
        !item._xrayFetching
      ) {
        item._xrayFetching = langKey;
        const q = new URLSearchParams();
        if (item.id) q.set("id", String(item.id));
        if (item.title) q.set("title", item.title);
        if (item.orig_title) q.set("orig_title", item.orig_title);
        if (item.year) q.set("year", String(item.year));
        if (item.media_type) q.set("media_type", String(item.media_type));
        if (item.kinorium?.kinorium_id || item.kinorium_id) {
          q.set("kinorium_id", String(item.kinorium?.kinorium_id || item.kinorium_id));
        }
        if (item.tmdb_id) q.set("tmdb_id", String(item.tmdb_id));
        if (item.imdb_id) q.set("imdb_id", String(item.imdb_id));
        q.set("lang", langKey);
        if (state.xrayAbortController) {
          try {
            state.xrayAbortController.abort();
          } catch (_) {}
        }
        const rmXrayAbort = new AbortController();
        state.xrayAbortController = rmXrayAbort;
        fetch(`/api/xray?${q.toString()}`, { signal: rmXrayAbort.signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            item._xrayFetching = false;
            if (state.xrayAbortController === rmXrayAbort) {
              state.xrayAbortController = null;
            }
            if (data && (Array.isArray(data.soundtrack) || Array.isArray(data.trivia))) {
              item._xrayData = data;
              item._xrayDataLang = langKey;
              scheduleDesktopRemoteStatePush(80);
            }
          })
          .catch(() => {
            item._xrayFetching = false;
          });
      }

      const builtXray = {
        cast: castSnap,
        soundtrack: soundtrackSnap,
        trivia: triviaSnap,
      };
      _cachedRemoteXrayKey = xrayCacheKey;
      _cachedRemoteXrayTs = nowMs;
      _cachedRemoteXrayPayload = builtXray;
      return builtXray;
    })(),
    seasons_map: seasonsMapSnap,
    watched_episodes: watchedEpisodesSnap,
    sleep_timer_mode: String(state.sleepTimerMode || "off"),
    sleep_timer_rem_sec: Math.max(0, Math.round(Number(state.sleepTimerSecondsLeft) || 0)),
    xray_open: (() => {
      if (!state.isPlayerOpen || typeof document === "undefined") return false;
      const xrayShelfEl = document.getElementById("xray-pause-shelf");
      return Boolean(
        xrayShelfEl &&
          !xrayShelfEl.classList.contains("hidden") &&
          !xrayShelfEl.classList.contains("is-compact")
      );
    })(),
    audio_preset: String(state.audioPreset || "flat"),
    audio_boost: Number(state.audioBoost) || 1.0,
    video_crop: String(state.videoCrop || "contain"),
    ambilight_enabled: Boolean(state.ambilightEnabled),
    official_embed_active: Boolean(state.officialEmbedActive),
    active_official_service: String(state.activeOfficialService || ""),
    native_fs_ready: true,
    native_pip_ready: true,
    active_profile_id: String(state.activeProfileId || "main"),
    kids_mode: Boolean(state.activeProfile?.kids_mode),
  };
}

export function syncDesktopConnectedRemotesUI(remotesList = []) {
  if (typeof document === "undefined") return;
  const arr = Array.isArray(remotesList) ? remotesList : [];
  const count = arr.length;
  state.remoteConnectedCount = count;

  const vcRemoteBtn = document.getElementById("vc-btn-remote");
  if (vcRemoteBtn) {
    vcRemoteBtn.classList.toggle("is-remote-active", count > 0);
  }
  const badgeEl = document.getElementById("remote-pair-connected-pill");
  if (badgeEl) {
    if (count > 0) {
      const names = arr.map((r) => r.device_name || t("Смартфон", "Smartphone")).join(", ");
      badgeEl.textContent = t(
        `Подключено: ${names}`,
        `Connected: ${names}`
      );
      badgeEl.classList.add("is-online");
    } else {
      badgeEl.textContent = t(
        "Ожидание подключения с телефона по Wi-Fi",
        "Waiting for smartphone connection over Wi-Fi"
      );
      badgeEl.classList.remove("is-online");
    }
  }
  const devListEl = document.getElementById("remote-connected-devices-list");
  if (devListEl) {
    if (count > 0) {
      devListEl.innerHTML = arr
        .map((r) => {
          const dName = escapeHtml(r.device_name || t("Смартфон", "Smartphone"));
          const statusLbl = escapeHtml(t("Активен в Wi-Fi сети", "Active on Wi-Fi"));
          return `<div class="atv-remote-device-item is-online">
            <span class="atv-remote-device-dot"></span>
            <span class="atv-remote-device-name">${dName}</span>
            <span class="atv-remote-device-meta">${statusLbl}</span>
          </div>`;
        })
        .join("");
    } else {
      devListEl.innerHTML = `<div class="atv-remote-steps-strip">
        <span class="atv-remote-step-chip"><b>1</b> ${escapeHtml(t("Камера телефона", "Phone Camera"))}</span>
        <span class="atv-remote-step-sep">→</span>
        <span class="atv-remote-step-chip"><b>2</b> ${escapeHtml(t("Наведите на QR", "Scan QR"))}</span>
        <span class="atv-remote-step-sep">→</span>
        <span class="atv-remote-step-chip"><b>3</b> ${escapeHtml(t("Пульт готов", "Remote Ready"))}</span>
      </div>`;
    }
  }
}

export async function pushDesktopRemoteStateNow(opts = {}) {
  if (!_isLoopbackHost() || isMobileRemoteUrl()) return;
  const force = Boolean(opts && opts.force);
  if (!force && !_hasActiveRemoteOrPairingModal()) return;
  if (_desktopPushInFlight) {
    _desktopPushQueued = true;
    return;
  }
  _lastDesktopPushTs = Date.now();
  if (_desktopPushTimer) {
    clearTimeout(_desktopPushTimer);
    _desktopPushTimer = null;
  }
  _desktopPushInFlight = true;
  try {
    const snap = _collectDesktopStateSnapshot();
    const res = await fetch("/api/remote/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snap),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.connected_remotes)) {
        syncDesktopConnectedRemotesUI(data.connected_remotes);
      }
    }
  } catch (err) {
    window.logDebug?.("Remote", err);
  } finally {
    _desktopPushInFlight = false;
    if (_desktopPushQueued) {
      _desktopPushQueued = false;
      scheduleDesktopRemoteStatePush(120);
    }
  }
}

export function scheduleDesktopRemoteStatePush(minIntervalMs = 950, opts = {}) {
  if (!_isLoopbackHost() || isMobileRemoteUrl()) return;
  const force = Boolean(opts && opts.force);
  if (!force && !_hasActiveRemoteOrPairingModal()) return;
  const elapsed = Date.now() - _lastDesktopPushTs;
  if (elapsed >= minIntervalMs) {
    pushDesktopRemoteStateNow(opts);
    return;
  }
  if (_desktopPushTimer) return;
  _desktopPushTimer = setTimeout(() => {
    _desktopPushTimer = null;
    pushDesktopRemoteStateNow(opts);
  }, Math.max(80, minIntervalMs - elapsed));
}

async function _executeRemoteCommandOnDesktop(cmdObj) {
  if (!cmdObj || typeof document === "undefined") return;
  const action = String(cmdObj.action || cmdObj.cmd || "").trim();
  const payload = cmdObj.payload || cmdObj.args || {};
  const video = document.getElementById("native-video");

  switch (action) {
    case "ping_desktop":
      pushDesktopRemoteStateNow({ force: true });
      return;

    case "toggle_play":
      if (state.isPlayerOpen && !state.officialEmbedActive) {
        toggleVideoPlayPause(true);
      }
      break;

    case "play":
      if (state.isPlayerOpen && !state.officialEmbedActive && video && video.paused) {
        toggleVideoPlayPause(true);
      }
      break;

    case "pause":
      if (state.isPlayerOpen && !state.officialEmbedActive && video && !video.paused) {
        toggleVideoPlayPause(true);
      }
      break;

    case "seek_rel": {
      if (!state.isPlayerOpen || !video) break;
      const delta = Number(payload.delta) || 0;
      const { cur, dur } = getEffectivePlaybackTiming(video);
      const nextSec = dur > 0 ? Math.min(dur - 0.5, Math.max(0, cur + delta)) : Math.max(0, cur + delta);
      seekEffectivePlayback(nextSec);
      showVideoOsd(
        delta >= 0 ? "fwd10" : "back10",
        `${delta >= 0 ? "+" : "−"}${Math.abs(Math.round(delta))} ${t("с", "s")}`
      );
      break;
    }

    case "seek_to":
    case "seek_abs": {
      if (!state.isPlayerOpen || !video) break;
      const target = Math.max(0, Number(payload.time ?? payload.sec) || 0);
      seekEffectivePlayback(target);
      break;
    }

    case "set_volume": {
      if (!video) break;
      const v = Math.max(0, Math.min(1, Number(payload.volume) || 0));
      state.internalMuteOverride = true;
      video.volume = v;
      video.muted = v <= 0.005;
      state.userMutedThisSession = video.muted;
      state.internalMuteOverride = false;
      if (v > 0.02) {
        savePlayerPrefs({ volume: v, muted: false });
      }
      syncCustomVideoControlsUI(true);
      showVideoOsd(v <= 0.005 ? "volMute" : "volHigh", `${Math.round(v * 100)}%`, Math.round(v * 100));
      break;
    }

    case "toggle_mute": {
      if (!video) break;
      state.internalMuteOverride = true;
      video.muted = !video.muted;
      state.userMutedThisSession = video.muted;
      state.internalMuteOverride = false;
      syncCustomVideoControlsUI(true);
      showVideoOsd(video.muted ? "volMute" : "volHigh", video.muted ? t("Без звука", "Muted") : `${Math.round(video.volume * 100)}%`);
      break;
    }

    case "set_studio": {
      const studioSel = document.getElementById("select-studio");
      const val = String(payload.id ?? payload.studio ?? "");
      if (studioSel && val && studioSel.value !== val) {
        studioSel.value = val;
        studioSel.dispatchEvent(new Event("change"));
      }
      break;
    }

    case "set_quality": {
      const qualSel = document.getElementById("select-quality");
      const val = String(payload.id ?? payload.quality ?? "");
      if (qualSel && val && qualSel.value !== val) {
        qualSel.value = val;
        qualSel.dispatchEvent(new Event("change"));
      }
      break;
    }

    case "set_subtitle": {
      const subSel = document.getElementById("select-subtitle");
      const val = String(payload.index ?? payload.id ?? "-1");
      if (subSel && subSel.value !== val) {
        subSel.value = val;
        subSel.dispatchEvent(new Event("change"));
      }
      break;
    }

    case "cycle_subtitle": {
      const subSel = document.getElementById("select-subtitle");
      if (subSel && subSel.options && subSel.options.length > 0) {
        const opts = Array.from(subSel.options);
        const curIdx = Math.max(0, opts.findIndex((o) => o.value === subSel.value));
        const nextOpt = opts[(curIdx + 1) % opts.length];
        if (nextOpt) {
          subSel.value = nextOpt.value;
          subSel.dispatchEvent(new Event("change"));
          showVideoOsd("subtitles", `${t("Субтитры", "Subtitles")}: ${nextOpt.textContent || ""}`);
        }
      }
      break;
    }

    case "cycle_audio": {
      const studioSel = document.getElementById("select-studio");
      if (studioSel && studioSel.options && studioSel.options.length > 1) {
        const opts = Array.from(studioSel.options);
        const curIdx = Math.max(0, opts.findIndex((o) => o.value === studioSel.value));
        const nextOpt = opts[(curIdx + 1) % opts.length];
        if (nextOpt) {
          studioSel.value = nextOpt.value;
          studioSel.dispatchEvent(new Event("change"));
          showVideoOsd("volHigh", `${t("Озвучка", "Audio")}: ${nextOpt.textContent || ""}`);
        }
      }
      break;
    }

    case "set_source_tab": {
      if (!state.isPlayerOpen) break;
      const tabKey = String(payload.tab || payload.source || "").trim().toLowerCase();
      if (!tabKey) break;
      const srcBtn = document.querySelector(`.source-tab[data-tab="${tabKey}"]`);
      if (srcBtn && !srcBtn.classList.contains("hidden") && state.activeSourceTab !== tabKey) {
        srcBtn.click();
      }
      break;
    }

    case "sub_offset": {
      if (payload.reset) {
        resetSubtitleOffset(true);
      } else {
        adjustSubtitleOffset(Number(payload.delta) || 0, true);
      }
      break;
    }

    case "prev_ep":
      if (state.isPlayerOpen && state.activeItem?.media_type === "series") {
        await stepEpisode(-1);
      }
      break;

    case "next_ep":
      if (state.isPlayerOpen && state.activeItem?.media_type === "series") {
        await stepEpisode(1);
      }
      break;

    case "step_episode":
      if (state.isPlayerOpen && state.activeItem?.media_type === "series") {
        await stepEpisode(Number(payload.delta) >= 0 ? 1 : -1);
      }
      break;

    case "select_episode":
      if (state.isPlayerOpen && state.activeItem?.media_type === "series") {
        const sNum = Math.max(1, Number(payload.season) || state.activeSeason || 1);
        const eNum = Math.max(1, Number(payload.episode) || 1);
        await switchToSeriesSeasonEpisode(sNum, eNum);
      }
      break;

    case "skip_intro": {
      const skipBtn = document.getElementById("skip-intro-btn");
      if (skipBtn && !skipBtn.classList.contains("hidden")) {
        skipBtn.click();
      } else if (state.skipSegments?.intro?.end) {
        seekEffectivePlayback(Number(state.skipSegments.intro.end) + 0.5);
      }
      break;
    }

    case "toggle_fullscreen": {
      const tvCastMod = document.getElementById("tv-cast-modal");
      if (tvCastMod && !tvCastMod.classList.contains("hidden") && state.remoteCastTab !== "tv") {
        closeTvCastModal();
      }
      if (state.isPlayerOpen) {
        if (state.isPipBackground || isVideoInPiP(video)) {
          await togglePictureInPicture({ fromRemote: true });
        }
        if (isStageFullscreen()) {
          toggleStageFullscreen();
        } else {
          if (video) {
            video.tabIndex = -1;
            try {
              video.focus({ preventScroll: true });
            } catch (err) { window.logDebug?.("Remote", err); }
          }
          let triggeredNative = false;
          try {
            const r = await fetch("/api/remote/native-fullscreen", { method: "POST" });
            if (r.ok) {
              const d = await r.json();
              triggeredNative = Boolean(d && d.ok);
            }
          } catch (err) { window.logDebug?.("Remote", err); }
          if (triggeredNative) {
            setTimeout(() => {
              if (state.isPlayerOpen && !isStageFullscreen()) {
                toggleStageFullscreen();
              }
            }, 260);
          } else {
            toggleStageFullscreen();
          }
        }
      }
      break;
    }

    case "rate_active":
      if (state.isPlayerOpen && state.activeItem) {
        await rateActivePlayerTitle({
          scope: payload.scope || "auto",
          score: Number(payload.score) || 0,
          clear: Boolean(payload.clear),
          comment: String(payload.comment || ""),
          season: payload.season,
          episode: payload.episode,
        });
      }
      break;

    case "toggle_watched":
      if (state.isPlayerOpen && state.activeItem) {
        await toggleActivePlayerWatched();
      }
      break;

    case "toggle_bookmark":
      if (state.isPlayerOpen && state.activeItem) {
        const noteStr = String(payload.note || "").trim();
        if (noteStr) {
          addOrUpdateRemoteBookmark(noteStr, payload.time);
        } else {
          toggleBookmarkCurrentMoment();
        }
      }
      break;

    case "add_bookmark_note":
      if (state.isPlayerOpen && state.activeItem) {
        addOrUpdateRemoteBookmark(
          String(payload.note || ""),
          payload.time !== undefined ? Number(payload.time) : null
        );
      }
      break;

    case "delete_bookmark":
      if (state.isPlayerOpen && state.activeItem) {
        deleteRemoteBookmarkByIdOrTime(
          String(payload.id || ""),
          payload.time !== undefined ? Number(payload.time) : null
        );
      }
      break;

    case "jump_marker":
      if (state.isPlayerOpen) {
        const dir = Number(payload.direction ?? payload.dir ?? 1) >= 0 ? 1 : -1;
        jumpToAdjacentTimelineMarker(dir);
      }
      break;

    case "set_playback_rate": {
      if (!video) break;
      const rate = Math.max(0.5, Math.min(2.5, Number(payload.rate) || 1.0));
      const speedSel = document.getElementById("select-speed");
      if (speedSel && String(speedSel.value) !== String(rate)) {
        speedSel.value = String(rate);
        speedSel.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        video.playbackRate = rate;
        ensurePreservesPitch(video);
        savePlayerPrefs({ playbackRate: rate });
        syncCustomVideoControlsUI(true);
      }
      showVideoOsd("play", `${rate}x`);
      break;
    }

    case "set_sleep_timer": {
      const mode = String(payload.mode || "off").trim() || "off";
      setSleepTimer(mode);
      break;
    }

    case "toggle_mini":
    case "toggle_pip": {
      const tvCastMod = document.getElementById("tv-cast-modal");
      if (tvCastMod && !tvCastMod.classList.contains("hidden") && state.remoteCastTab !== "tv") {
        closeTvCastModal();
      }
      if (state.isPlayerOpen) {
        await togglePictureInPicture({ fromRemote: true });
      }
      break;
    }

    case "toggle_tv_mode": {
      const tvCastMod = document.getElementById("tv-cast-modal");
      if (tvCastMod && !tvCastMod.classList.contains("hidden") && state.remoteCastTab !== "tv") {
        closeTvCastModal();
      }
      setTvMode(!state.tvMode);
      break;
    }

    case "close_player":
      if (state.isPlayerOpen) {
        closePlayerModal();
      }
      break;

    case "toggle_xray":
      if (state.isPlayerOpen) {
        toggleXRayPauseShelf();
      }
      break;

    case "set_audio_preset": {
      const nextPreset = ["flat", "voice", "night", "cinema"].includes(String(payload.preset || ""))
        ? String(payload.preset)
        : state.audioPreset || "flat";
      const nextBoost =
        payload.boost !== undefined
          ? Math.max(1.0, Math.min(4.0, Number(payload.boost) || 1.0))
          : Math.max(1.0, Math.min(4.0, Number(state.audioBoost) || 1.0));
      applyAudioBoostToVideo(video, nextBoost, nextPreset);
      savePlayerPrefs({ audioBoost: nextBoost, audioPreset: nextPreset });
      const boostTxt = nextBoost > 1.01 ? ` · ${Math.round(nextBoost * 100)}%` : "";
      showVideoOsd("volHigh", `${getAudioPresetLabel(nextPreset)}${boostTxt}`);
      break;
    }

    case "set_video_crop": {
      const nextCrop = ["contain", "cover", "zoom115", "fill"].includes(String(payload.crop || ""))
        ? String(payload.crop)
        : "contain";
      applyVideoCropToVideo(video, nextCrop);
      savePlayerPrefs({ videoCrop: nextCrop });
      showVideoOsd("tv", getVideoCropLabel(nextCrop));
      break;
    }

    case "toggle_ambilight": {
      state.ambilightEnabled = !state.ambilightEnabled;
      const ambChk = document.getElementById("ambilight-toggle");
      if (ambChk) ambChk.checked = state.ambilightEnabled;
      if (state.ambilightEnabled) {
        startAmbilightLoop();
      } else {
        stopAmbilightLoop(true);
      }
      savePlayerPrefs({ ambilightEnabled: state.ambilightEnabled });
      showVideoOsd(
        "sparkles",
        state.ambilightEnabled ? t("Ambilight: Вкл", "Ambilight: On") : t("Ambilight: Выкл", "Ambilight: Off")
      );
      break;
    }

    case "open_person": {
      const personName = String(payload.name || "").trim();
      if (personName) {
        openPersonModal({
          name: personName,
          role: String(payload.role || ""),
          photo: String(payload.photo || ""),
        });
        showToast(t(`Открыта персона: ${personName}`, `Opened person: ${personName}`));
      }
      break;
    }

    case "dpad": {
      const dir = String(payload.key || payload.dir || "").toLowerCase();
      executeRemoteDpadCommand(dir);
      break;
    }

    case "remote_search": {
      const qText = String(payload.query ?? "").trim();
      const globalSearchEl = document.getElementById("global-search");
      if (globalSearchEl) {
        if (state.isPlayerOpen && !state.isMiniPlayer && payload.close_player) {
          closePlayerModal();
        }
        globalSearchEl.value = qText;
        globalSearchEl.dispatchEvent(new Event("input", { bubbles: true }));
        if (qText) {
          showToast(t(`Поиск с телефона: «${qText}»`, `Search from phone: "${qText}"`));
        }
      }
      break;
    }

    case "play_item": {
      const tvCastMod = document.getElementById("tv-cast-modal");
      if (tvCastMod && !tvCastMod.classList.contains("hidden") && state.remoteCastTab !== "tv") {
        closeTvCastModal();
      }
      const itemData = payload.item;
      if (itemData && itemData.title) {
        if (Boolean(state.activeProfile?.kids_mode) && !isItemSafeForKidsClient(itemData)) {
          showToast(
            t(
              "Контент недоступен в детском профиле",
              "Content restricted in Kids Mode"
            )
          );
          break;
        }
        const sNum = Math.max(1, Number(payload.season || itemData.season) || 1);
        const eNum = Math.max(1, Number(payload.episode || itemData.episode) || 1);
        const resumeSec = Math.max(0, Number(payload.resume_time || itemData.current_time) || 0);
        await openPlayerModal(itemData, "hdrezka", sNum, eNum, resumeSec);
        showToast(
          t(
            `Запущено с телефона: «${displayTitle(itemData) || itemData.title}»`,
            `Started from phone: "${displayTitle(itemData) || itemData.title}"`
          )
        );
      }
      break;
    }

    default:
      break;
  }

  setTimeout(() => {
    pushDesktopRemoteStateNow({ force: true });
  }, 60);
}

export function bindRemoteVideoListeners(videoEl) {
  if (!videoEl || videoEl._remoteListenersBound) return;
  videoEl._remoteListenersBound = true;
  ["seeked", "volumechange", "ratechange", "loadedmetadata"].forEach((ev) => {
    videoEl.addEventListener(ev, () => {
      if (_hasActiveRemoteOrPairingModal()) {
        scheduleDesktopRemoteStatePush(120);
      }
    });
  });
  videoEl.addEventListener("timeupdate", () => {
    if (state.remoteConnectedCount > 0) {
      scheduleDesktopRemoteStatePush(950);
    }
  });
}

export function initDesktopRemoteAgent() {
  if (_desktopAgentStarted || typeof window === "undefined") return;
  if (!_isLoopbackHost() || isMobileRemoteUrl()) return;
  _desktopAgentStarted = true;

  const video = document.getElementById("native-video");
  if (video) {
    bindRemoteVideoListeners(video);
  }

  ["select-studio", "select-quality", "select-subtitle"].forEach((selId) => {
    document.getElementById(selId)?.addEventListener("change", () => {
      if (_hasActiveRemoteOrPairingModal()) {
        setTimeout(() => pushDesktopRemoteStateNow(), 120);
      }
    });
  });

  pushDesktopRemoteStateNow({ force: true });
  setInterval(() => {
    if (_hasActiveRemoteOrPairingModal()) {
      pushDesktopRemoteStateNow();
    }
  }, 10000);

  let lastSeq = -1;
  const pollCommandsLoop = async () => {
    while (true) {
      try {
        const hasRemotes = (state.remoteConnectedCount > 0);
        const timeoutSec = lastSeq < 0 ? 0 : (hasRemotes ? 15 : 0);
        const res = await fetch(`/api/remote/commands?since=${lastSeq}&timeout=${timeoutSec}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.connected_remotes)) {
            syncDesktopConnectedRemotesUI(data.connected_remotes);
          }
          if (typeof data.latest_seq === "number" && (lastSeq < 0 || data.latest_seq > lastSeq)) {
            lastSeq = data.latest_seq;
          }
          const cmds = Array.isArray(data.commands) ? data.commands : [];
          for (const c of cmds) {
            await _executeRemoteCommandOnDesktop(c);
          }
          if (!hasRemotes && !(Array.isArray(data.connected_remotes) && data.connected_remotes.length > 0)) {
            await new Promise((r) => setTimeout(r, 3500));
          }
        } else {
          await new Promise((r) => setTimeout(r, 2500));
        }
      } catch (_) {
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
  };
  pollCommandsLoop();
}

/* ==========================================================================
   2. Desktop Pairing Panel inside #tv-cast-modal
   ========================================================================== */
export async function loadAndRenderRemotePairingPanel(regenerate = false) {
  if (typeof document === "undefined") return;
  const qrBox = document.getElementById("remote-pair-qr-box");
  const urlInput = document.getElementById("remote-pair-url-text");
  if (!qrBox) return;

  try {
    let data = null;
    if (regenerate) {
      let pinHeader = "";
      if (
        (state.activeProfile?.kids_mode && state.activeProfile?.has_kids_pin) ||
        (state.activeProfile?.is_kids && state.activeProfile?.has_pin)
      ) {
        const verified = await requestKidsPinVerification(
          t("Подтвердите PIN для смены ключа пульта", "Verify PIN to rotate remote key")
        );
        if (!verified) return;
        pinHeader = verified;
      }
      const res = await fetch("/api/remote/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regenerate: true,
          enable_lan: true,
          pin: pinHeader,
          lang: state.appLang || "ru",
        }),
      });
      data = await res.json();
      if (!res.ok || data.ok === false) {
        showToast(data.error || t("Не удалось обновить ключ пульта", "Could not rotate remote key"));
        return;
      }
      showToast(t("Ключ доступа пульта обновлён", "Remote access key rotated"));
    } else {
      const res = await fetch("/api/remote/pairing?auto_lan=1", { headers: { "X-Velarium-Intent": "pair" } });
      data = await res.json();
    }

    if (!data || !data.ok) return;
    state.remotePairInfo = data;
    syncDesktopConnectedRemotesUI(data.connected_remotes || []);

    if (data.qr_svg) {
      qrBox.innerHTML = data.qr_svg;
    } else {
      qrBox.innerHTML = `<div class="atv-stream-empty-note">${escapeHtml(
        t(
          "Подключите компьютер к домашней сети Wi-Fi для генерации QR-кода",
          "Connect your computer to Wi-Fi to generate a pairing QR code"
        )
      )}</div>`;
    }
    if (urlInput) {
      urlInput.textContent = data.remote_url || "—";
    }
  } catch (_) {
    qrBox.innerHTML = `<div class="atv-stream-empty-note">${escapeHtml(
      t("Не удалось получить параметры подключения", "Could not load pairing details")
    )}</div>`;
  }
}

export function switchCastModalTab(tabKey = "phone", { focusTab = false } = {}) {
  if (typeof document === "undefined") return;
  const norm = tabKey === "tv" ? "tv" : "phone";
  state.remoteCastTab = norm;
  const phoneBtn = document.getElementById("btn-cast-tab-phone");
  const tvBtn = document.getElementById("btn-cast-tab-tv");
  if (phoneBtn) {
    phoneBtn.classList.toggle("active", norm === "phone");
    phoneBtn.setAttribute("aria-selected", norm === "phone" ? "true" : "false");
    phoneBtn.tabIndex = norm === "phone" ? 0 : -1;
  }
  if (tvBtn) {
    tvBtn.classList.toggle("active", norm === "tv");
    tvBtn.setAttribute("aria-selected", norm === "tv" ? "true" : "false");
    tvBtn.tabIndex = norm === "tv" ? 0 : -1;
  }
  document.getElementById("tv-cast-phone-pane")?.classList.toggle("hidden", norm !== "phone");
  document.getElementById("tv-cast-dlna-pane")?.classList.toggle("hidden", norm !== "tv");
  if (focusTab) {
    const activeBtn = norm === "tv" ? tvBtn : phoneBtn;
    try {
      activeBtn?.focus({ preventScroll: true });
    } catch (err) { window.logDebug?.("Remote", err); }
  }
  if (norm === "phone") {
    loadAndRenderRemotePairingPanel(false);
  }
}

/* ==========================================================================
   3. Mobile Smartphone Remote Controller (?remote=1&k=...)
   ========================================================================== */
export function initMobileRemoteController() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window._velariumMobileRemoteInitialized) return;
  window._velariumMobileRemoteInitialized = true;
  state.remoteMode = true;
  document.body.classList.add("is-mobile-remote-mode");

  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (viewportMeta) {
    viewportMeta.setAttribute(
      "content",
      "width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"
    );
  }

  const qs = new URLSearchParams(window.location.search || "");
  const pairKey = String(qs.get("k") || "").trim();
  const qsLang = String(qs.get("lang") || "").trim().toLowerCase();
  if (qsLang === "en" || qsLang === "ru") {
    state.appLang = qsLang;
    saveUiPrefs({ appLang: qsLang });
  }
  const clientId = _getOrCreateRemoteClientId();

  ["ambient-glow", "pip-status-dock", "scroll-top-btn"].forEach((id) => {
    document.getElementById(id)?.classList.add("hidden");
  });
  document.querySelector(".atv-header")?.classList.add("hidden");
  document.querySelector(".atv-main")?.classList.add("hidden");

  let shell = document.getElementById("remote-control-shell");
  if (!shell) {
    shell = document.createElement("div");
    shell.id = "remote-control-shell";
    shell.className = "atv-remote-shell";
    document.body.appendChild(shell);
  }

  if (!shell._doubleTapZoomGuardBound) {
    shell._doubleTapZoomGuardBound = true;
    let lastTouchStartX = 0;
    let lastTouchStartY = 0;
    let lastTouchEndTs = 0;
    let suppressTrustedClickUntil = 0;

    shell.addEventListener(
      "dblclick",
      (e) => {
        e.preventDefault();
      },
      { passive: false }
    );
    shell.addEventListener(
      "gesturestart",
      (e) => {
        e.preventDefault();
      },
      { passive: false }
    );
    shell.addEventListener(
      "click",
      (e) => {
        if (e.isTrusted && Date.now() < suppressTrustedClickUntil) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      },
      true
    );
    shell.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches && e.touches.length > 1) {
          e.preventDefault();
          return;
        }
        if (e.touches && e.touches.length === 1) {
          lastTouchStartX = e.touches[0].clientX;
          lastTouchStartY = e.touches[0].clientY;
        }
      },
      { passive: false }
    );
    shell.addEventListener(
      "touchend",
      (e) => {
        if (!e.changedTouches || e.changedTouches.length !== 1) return;
        const t0 = e.changedTouches[0];
        const moved = Math.hypot(t0.clientX - lastTouchStartX, t0.clientY - lastTouchStartY);
        if (moved > 14) return;
        const target = e.target;
        if (target && target.closest && target.closest("input, textarea, select")) {
          return;
        }
        const now = Date.now();
        const delta = now - lastTouchEndTs;
        lastTouchEndTs = now;
        if (delta > 0 && delta <= 340) {
          e.preventDefault();
          suppressTrustedClickUntil = now + 80;
          const interactive = target?.closest?.("button, [role='button'], [data-rm-open-id]");
          if (interactive && !interactive.disabled) {
            interactive.click();
          }
        }
      },
      { passive: false }
    );
  }

  const rState = {
    activeTab: "player",
    activeXrayTab: "cast",
    rateScope: "episode",
    desktopOnline: false,
    authFailed: false,
    scrubbing: false,
    showRemainingTime: false,
    lastSeq: 0,
    lastSyncPerfMs: 0,
    snap: {
      app_lang: state.appLang === "en" ? "en" : "ru",
      is_player_open: false,
      desktop_mode: "window",
      tv_mode: false,
      playing: false,
      current_time: 0,
      duration: 0,
      playback_rate: 1,
      volume: 1,
      muted: false,
      active_item: null,
      seasons_map: {},
      watched_episodes: {},
      studios: [],
      active_studio: "",
      active_studio_name: "",
      qualities: [],
      active_quality: "",
      subtitles: [],
      active_sub_idx: -1,
      sub_offset_sec: 0,
      has_skip_intro: false,
      has_prev_ep: false,
      has_next_ep: false,
      bookmarks: [],
      chapters: [],
      active_chapter: "",
      xray: { cast: [], soundtrack: [], trivia: [] },
      sleep_timer_mode: "off",
      sleep_timer_rem_sec: 0,
      xray_open: false,
      audio_preset: "flat",
      audio_boost: 1,
      video_crop: "contain",
      ambilight_enabled: true,
    },
    previewSeason: 0,
    epGridSig: "",
    lastActiveSeriesKey: "",
    lastStudioAutoScrollSig: "",
    lastSubAutoScrollSig: "",
    scrubberMarkersSig: "",
    editingBookmarkTime: null,
    bookmarksListSig: "",
    idleCwSig: "",
    catalogLoaded: false,
    catalogFilter: "all",
    catalogCW: [],
    catalogItems: [],
    searchResults: null,
    searchQuery: "",
    previewAudio: null,
    previewTrackUrl: "",
  };

  const getInterpolatedTime = () => {
    const s = rState.snap;
    const dur = Math.max(0, Number(s.duration) || 0);
    let interpCur = Math.max(0, Number(s.current_time) || 0);
    if (s.playing && rState.lastSyncPerfMs > 0) {
      const dtSec = Math.max(0, (performance.now() - rState.lastSyncPerfMs) / 1000);
      interpCur =
        dur > 0
          ? Math.min(dur, interpCur + dtSec * (Number(s.playback_rate) || 1))
          : interpCur + dtSec;
    }
    return interpCur;
  };

  const updateRangeSliderFill = (inputEl) => {
    if (!inputEl) return;
    const min = Number(inputEl.min) || 0;
    const max = Number(inputEl.max) || 100;
    const val = Number(inputEl.value) || 0;
    const pct = max > min ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100)) : 0;
    inputEl.style.setProperty("--range-pct", `${pct.toFixed(1)}%`);
  };

  const sendCmd = async (action, payload = {}) => {
    try {
      if (navigator.vibrate) {
        try {
          navigator.vibrate(10);
        } catch (err) { window.logDebug?.("Remote", err); }
      }
      const res = await fetch("/api/remote/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          k: pairKey,
          cid: clientId,
          device: _detectPhoneDeviceLabel(),
          action,
          payload,
        }),
      });
      if (res.status === 403) {
        rState.authFailed = true;
        renderAuthState();
      }
    } catch (err) { window.logDebug?.("Remote", err); }
  };

  shell.innerHTML = `
    <header class="atv-remote-topbar">
      <div class="atv-remote-brand">
        <span class="atv-remote-dot" id="rm-conn-dot"></span>
        <div>
          <div class="atv-remote-brand-title" id="rm-brand-title">${t("Пульт Velarium", "Velarium Remote")}</div>
          <div class="atv-remote-brand-sub" id="rm-conn-label">${t("Подключение к компьютеру...", "Connecting to computer...")}</div>
        </div>
      </div>
      <button type="button" class="atv-remote-icon-btn" id="rm-btn-close-pc-player" aria-label="${escapeAttr(
        t("Закрыть плеер на компьютере", "Close player on computer")
      )}" title="${escapeAttr(
        t("Закрыть плеер на компьютере", "Close player on computer")
      )}">${iconSvg("x", 16)}</button>
    </header>

    <div class="atv-remote-auth-error hidden" id="rm-auth-error">
      <div class="atv-remote-empty-title" id="rm-auth-error-title">${t("Ключ пульта недействителен", "Remote key expired")}</div>
      <div class="atv-remote-empty-sub" id="rm-auth-error-sub">${t(
        "Отсканируйте актуальный QR-код в окне «Пульт и ТВ» на компьютере.",
        "Scan the current QR code in the Remote & TV window on your computer."
      )}</div>
    </div>

    <main class="atv-remote-body" id="rm-main-body">
      <section class="atv-remote-pane" id="rm-pane-player">
        <div class="atv-remote-now-card" id="rm-now-card">
          <img class="atv-remote-poster hidden" id="rm-poster" alt="" referrerpolicy="no-referrer" />
          <div class="atv-remote-now-meta">
            <div class="atv-remote-now-badges-row">
              <div class="atv-remote-now-badge" id="rm-source-badge">Velarium</div>
              <div class="atv-remote-now-badge is-subtle hidden" id="rm-quality-badge"></div>
              <div class="atv-remote-now-badge is-status hidden" id="rm-playback-state-badge"></div>
            </div>
            <div class="atv-remote-now-title" id="rm-now-title">${t("На компьютере ничего не воспроизводится", "Nothing playing on computer")}</div>
            <div class="atv-remote-now-sub" id="rm-now-sub">${t("Выберите фильм во вкладке «Каталог» или запустите плеер на ПК", "Pick a title in the Catalog tab or start playback on PC")}</div>
            <button type="button" class="atv-remote-pill-btn is-accent atv-remote-idle-cta" id="rm-btn-idle-browse">
              ${iconSvg("search", 14)}
              <span id="rm-lbl-idle-browse">${t("Открыть каталог", "Browse Catalog")}</span>
            </button>
          </div>
        </div>

        <div class="atv-remote-card-group hidden" id="rm-idle-cw-group">
          <div class="atv-remote-bm-head">
            <span class="atv-remote-rate-title" id="rm-lbl-idle-cw-title">${t("Продолжить просмотр", "Continue Watching")}</span>
          </div>
          <div class="atv-remote-idle-cw-list" id="rm-idle-cw-list"></div>
        </div>

        <div class="atv-remote-transport-deck" id="rm-transport-deck">
          <div class="atv-remote-timeline-box" id="rm-timeline-box">
            <div class="atv-remote-scrubber-wrap">
              <div class="atv-remote-scrubber-markers" id="rm-scrubber-markers" aria-hidden="true"></div>
              <input type="range" class="atv-remote-scrubber" id="rm-scrubber" min="0" max="1000" step="1" value="0" aria-label="${escapeAttr(t("Позиция воспроизведения", "Playback position"))}" />
            </div>
            <div class="atv-remote-time-row">
              <span id="rm-time-cur">0:00</span>
              <span class="atv-remote-time-chapter" id="rm-time-chapter"></span>
              <button type="button" class="atv-remote-time-dur-btn" id="rm-time-dur" title="${escapeAttr(t("Переключить оставшееся время", "Toggle remaining time"))}" aria-label="${escapeAttr(t("Переключить оставшееся время", "Toggle remaining time"))}">0:00</button>
            </div>
          </div>

          <div class="atv-remote-transport-row">
            <button type="button" class="atv-remote-sec-btn is-compact" id="rm-btn-back30" aria-label="${escapeAttr(t("Назад на 30 секунд", "Rewind 30 seconds"))}">
              <span id="rm-lbl-back30">−30 ${t("с", "s")}</span>
            </button>
            <button type="button" class="atv-remote-sec-btn" id="rm-btn-back10" aria-label="${escapeAttr(t("Назад на 10 секунд", "Rewind 10 seconds"))}">
              ${iconSvg("chevronLeft", 16)}
              <span id="rm-lbl-back10">10 ${t("с", "s")}</span>
            </button>
            <button type="button" class="atv-remote-play-btn" id="rm-btn-play" aria-label="${escapeAttr(
              t("Пауза / Пуск", "Play / Pause")
            )}">
              ${iconSvg("play", 24)}
            </button>
            <button type="button" class="atv-remote-sec-btn" id="rm-btn-fwd10" aria-label="${escapeAttr(t("Вперёд на 10 секунд", "Forward 10 seconds"))}">
              <span id="rm-lbl-fwd10">10 ${t("с", "s")}</span>
              ${iconSvg("chevronRight", 16)}
            </button>
            <button type="button" class="atv-remote-sec-btn is-compact" id="rm-btn-fwd30" aria-label="${escapeAttr(t("Вперёд на 30 секунд", "Forward 30 seconds"))}">
              <span id="rm-lbl-fwd30">+30 ${t("с", "s")}</span>
            </button>
          </div>

          <div class="atv-remote-ep-row hidden" id="rm-ep-row">
            <button type="button" class="atv-remote-pill-btn" id="rm-btn-prev-ep">${iconSvg("skipBack", 14)}<span id="rm-lbl-prev-ep">${t("Пред серия", "Prev Ep")}</span></button>
            <button type="button" class="atv-remote-pill-btn is-accent hidden" id="rm-btn-skip-intro">${t("Пропустить заставку", "Skip Intro")}</button>
            <button type="button" class="atv-remote-pill-btn" id="rm-btn-next-ep"><span id="rm-lbl-next-ep">${t("След серия", "Next Ep")}</span>${iconSvg("skipFwd", 14)}</button>
          </div>
        </div>

        <div class="atv-remote-card-group atv-remote-vol-card">
          <div class="atv-remote-vol-row">
            <button type="button" class="atv-remote-icon-btn" id="rm-btn-mute" aria-label="${escapeAttr(t("Включить или выключить звук", "Mute or unmute"))}">${iconSvg("volHigh", 16)}</button>
            <button type="button" class="atv-remote-vol-step-btn" id="rm-btn-vol-down" aria-label="${escapeAttr(t("Тише на 10%", "Volume down 10%"))}">−10%</button>
            <input type="range" class="atv-remote-vol-slider" id="rm-vol-slider" min="0" max="100" step="1" value="100" aria-label="${escapeAttr(t("Громкость", "Volume"))}" />
            <button type="button" class="atv-remote-vol-step-btn" id="rm-btn-vol-up" aria-label="${escapeAttr(t("Громче на 10%", "Volume up 10%"))}">+10%</button>
            <span class="atv-remote-vol-val" id="rm-vol-val">100%</span>
          </div>
          <div class="atv-remote-quick-dsp-row" id="rm-quick-dsp-row" role="group" aria-label="${escapeAttr(t("Быстрый режим звука", "Quick sound preset"))}">
            <button type="button" class="atv-remote-quick-dsp-pill active" data-quick-preset="flat" id="rm-quick-preset-flat" aria-pressed="true">${t("Стандарт", "Standard")}</button>
            <button type="button" class="atv-remote-quick-dsp-pill" data-quick-preset="voice" id="rm-quick-preset-voice" aria-pressed="false">${t("Голос", "Voice")}</button>
            <button type="button" class="atv-remote-quick-dsp-pill" data-quick-preset="night" id="rm-quick-preset-night" aria-pressed="false">${t("Ночной", "Night")}</button>
            <button type="button" class="atv-remote-quick-dsp-pill" data-quick-preset="cinema" id="rm-quick-preset-cinema" aria-pressed="false">${t("Кинозал", "Cinema")}</button>
            <button type="button" class="atv-remote-quick-dsp-pill is-boost" id="rm-quick-boost-btn" aria-pressed="false" title="${escapeAttr(t("Усиление диалогов и звука до 200%", "Boost dialogue & volume up to 200%"))}">Boost 200%</button>
          </div>
        </div>

        <div class="atv-remote-modes-grid">
          <button type="button" class="atv-remote-mode-btn" id="rm-btn-fs" aria-pressed="false">${iconSvg("fsEnter", 15)}<span id="rm-lbl-fs">${t("Полный экран", "Fullscreen")}</span></button>
          <button type="button" class="atv-remote-mode-btn" id="rm-btn-xray-pc" aria-pressed="false">${iconSvg("sparkles", 15)}<span id="rm-lbl-xray-pc">${t("X-Ray на ПК", "X-Ray on PC")}</span></button>
          <button type="button" class="atv-remote-mode-btn" id="rm-btn-pip" aria-pressed="false">${iconSvg("airplay", 15)}<span id="rm-lbl-pip">${t("Картинка в картинке", "PiP")}</span></button>
          <button type="button" class="atv-remote-mode-btn" id="rm-btn-tvmode" aria-pressed="false">${iconSvg("tv", 15)}<span id="rm-lbl-tvmode">${t("Режим ТВ", "TV Mode")}</span></button>
        </div>

        <div class="atv-remote-card-group" id="rm-tracks-group">
          <div class="atv-remote-field-row atv-remote-source-row" id="rm-source-tabs-row">
            <span class="atv-remote-field-lbl" id="rm-lbl-source-tab">${t("Источник", "Source")}</span>
            <div class="atv-remote-source-seg" id="rm-source-seg" role="radiogroup" aria-label="${escapeAttr(t("Источник видеопотока", "Playback source"))}">
              <button type="button" role="radio" aria-checked="true" class="atv-remote-source-pill active" data-source-tab="hdrezka">HDRezka</button>
              <button type="button" role="radio" aria-checked="false" class="atv-remote-source-pill" data-source-tab="stremio">Stremio</button>
              <button type="button" role="radio" aria-checked="false" class="atv-remote-source-pill" data-source-tab="backup4k">4K UHD</button>
            </div>
          </div>
          <div class="atv-remote-field-row is-stacked" id="rm-studio-row">
            <div class="atv-remote-track-header">
              <label for="rm-sel-studio" id="rm-lbl-studio">${t("Озвучка", "Audio")}</label>
              <span class="atv-remote-active-badge" id="rm-studio-active-badge"></span>
            </div>
            <div class="atv-remote-chips-scroll" id="rm-studio-chips" role="radiogroup" aria-label="${escapeAttr(t("Выбор озвучки", "Audio track selection"))}"></div>
            <select id="rm-sel-studio" class="atv-remote-native-select atv-remote-fallback-select" data-native-select="1"></select>
          </div>
          <div class="atv-remote-field-row is-stacked" id="rm-quality-row">
            <div class="atv-remote-track-header">
              <label for="rm-sel-quality" id="rm-lbl-quality">${t("Качество", "Quality")}</label>
              <span class="atv-remote-active-badge" id="rm-quality-active-badge"></span>
            </div>
            <div class="atv-remote-chips-scroll" id="rm-quality-chips" role="radiogroup" aria-label="${escapeAttr(t("Выбор качества видео", "Video quality selection"))}"></div>
            <select id="rm-sel-quality" class="atv-remote-native-select atv-remote-fallback-select" data-native-select="1"></select>
          </div>
          <div class="atv-remote-field-row is-stacked" id="rm-sub-row">
            <div class="atv-remote-track-header">
              <label for="rm-sel-sub" id="rm-lbl-sub">${t("Субтитры", "Subtitles")}</label>
              <span class="atv-remote-active-badge" id="rm-sub-active-badge"></span>
            </div>
            <div class="atv-remote-chips-scroll" id="rm-sub-chips" role="radiogroup" aria-label="${escapeAttr(t("Выбор субтитров", "Subtitle track selection"))}"></div>
            <select id="rm-sel-sub" class="atv-remote-native-select atv-remote-fallback-select" data-native-select="1"></select>
          </div>

          <details class="atv-remote-tuning-drawer" id="rm-tuning-drawer">
            <summary class="atv-remote-tuning-summary">
              <div class="atv-remote-tuning-summary-left">
                ${iconSvg("sliders", 14)}
                <span id="rm-lbl-tuning-title">${t("Звук, скорость и таймер сна", "Audio DSP, Speed & Sleep")}</span>
              </div>
              <div class="atv-remote-tuning-summary-right">
                <span class="atv-remote-active-badge" id="rm-tuning-summary-badge">1× · ${t("Стандарт", "Standard")}</span>
                <span class="atv-remote-tuning-caret" aria-hidden="true">${iconSvg("chevronDown", 13)}</span>
              </div>
            </summary>
            <div class="atv-remote-tuning-body">
              <div class="atv-remote-field-row is-stacked" id="rm-audio-preset-row">
                <div class="atv-remote-track-header">
                  <span id="rm-lbl-audio-preset">${t("Режим звука (DSP)", "Sound Mode (DSP)")}</span>
                  <span class="atv-remote-active-badge" id="rm-audio-preset-badge">${t("Стандарт", "Standard")}</span>
                </div>
                <div class="atv-remote-chips-scroll" id="rm-audio-preset-chips" role="radiogroup" aria-label="${escapeAttr(t("Режим звука", "Sound mode"))}">
                  <button type="button" role="radio" aria-checked="true" class="atv-remote-chip active" data-audio-preset="flat" id="rm-preset-flat">${t("Стандарт", "Standard")}</button>
                  <button type="button" role="radio" aria-checked="false" class="atv-remote-chip" data-audio-preset="voice" id="rm-preset-voice">${t("Чёткая речь", "Clear Voice")}</button>
                  <button type="button" role="radio" aria-checked="false" class="atv-remote-chip" data-audio-preset="night" id="rm-preset-night">${t("Ночной", "Night")}</button>
                  <button type="button" role="radio" aria-checked="false" class="atv-remote-chip" data-audio-preset="cinema" id="rm-preset-cinema">${t("Кинотеатр", "Cinema")}</button>
                </div>
                <div class="atv-remote-chips-scroll" id="rm-audio-boost-chips" role="radiogroup" aria-label="${escapeAttr(t("Усиление громкости", "Audio boost"))}">
                  <button type="button" role="radio" aria-checked="true" class="atv-remote-chip active" data-audio-boost="1">100%</button>
                  <button type="button" role="radio" aria-checked="false" class="atv-remote-chip" data-audio-boost="1.5">150% Boost</button>
                  <button type="button" role="radio" aria-checked="false" class="atv-remote-chip" data-audio-boost="2">200% Boost</button>
                  <button type="button" role="radio" aria-checked="false" class="atv-remote-chip" data-audio-boost="3">300% Max</button>
                </div>
              </div>

              <div class="atv-remote-field-row is-stacked" id="rm-speed-row">
                <div class="atv-remote-track-header">
                  <label for="rm-sel-speed" id="rm-lbl-speed">${t("Скорость", "Speed")}</label>
                  <span class="atv-remote-active-badge" id="rm-speed-active-badge">1×</span>
                </div>
                <div class="atv-remote-chips-scroll" id="rm-speed-chips" role="radiogroup" aria-label="${escapeAttr(t("Скорость воспроизведения", "Playback speed"))}"></div>
                <select id="rm-sel-speed" class="atv-remote-native-select atv-remote-fallback-select" data-native-select="1"></select>
              </div>

              <div class="atv-remote-field-row is-stacked" id="rm-sleep-row">
                <div class="atv-remote-track-header">
                  <label for="rm-sel-sleep" id="rm-lbl-sleep">${t("Таймер сна", "Sleep Timer")}</label>
                  <span class="atv-remote-active-badge" id="rm-sleep-active-badge">${t("Выключен", "Off")}</span>
                </div>
                <div class="atv-remote-chips-scroll" id="rm-sleep-chips" role="radiogroup" aria-label="${escapeAttr(t("Таймер сна", "Sleep timer"))}"></div>
                <select id="rm-sel-sleep" class="atv-remote-native-select atv-remote-fallback-select" data-native-select="1"></select>
              </div>

              <div class="atv-remote-field-row is-stacked" id="rm-crop-row">
                <div class="atv-remote-track-header">
                  <span id="rm-lbl-crop">${t("Кадр и подсветка", "Aspect Ratio & Ambilight")}</span>
                </div>
                <div class="atv-remote-chips-scroll" id="rm-crop-chips">
                  <button type="button" class="atv-remote-chip active" data-video-crop="contain" id="rm-crop-contain">${t("16:9 Стандарт", "16:9 Fit")}</button>
                  <button type="button" class="atv-remote-chip" data-video-crop="cover" id="rm-crop-cover">${t("21:9 Без полос", "21:9 Crop")}</button>
                  <button type="button" class="atv-remote-chip" data-video-crop="zoom115" id="rm-crop-zoom">115% Zoom</button>
                  <button type="button" class="atv-remote-chip active" id="rm-btn-ambilight" aria-pressed="true">${iconSvg("sparkles", 12)}<span>Ambilight</span></button>
                </div>
              </div>

              <div class="atv-remote-field-row">
                <span id="rm-lbl-sub-sync">${t("Синхронизация субтитров", "Subtitle Sync")}</span>
                <div class="atv-sub-offset-stepper">
                  <button type="button" class="atv-sub-step-btn" id="rm-sub-minus">−0.25</button>
                  <button type="button" class="atv-sub-step-val" id="rm-sub-val">0.0 ${t("с", "s")}</button>
                  <button type="button" class="atv-sub-step-btn" id="rm-sub-plus">+0.25</button>
                </div>
              </div>
            </div>
          </details>
        </div>

        <div class="atv-remote-card-group hidden" id="rm-ep-picker-group">
          <div class="atv-remote-field-row">
            <label for="rm-sel-season" id="rm-lbl-season">${t("Сезон и серия", "Season & Episode")}</label>
            <select id="rm-sel-season" class="atv-remote-native-select" data-native-select="1"></select>
          </div>
          <div class="atv-remote-ep-grid" id="rm-ep-grid"></div>
        </div>

        <div class="atv-remote-card-group hidden" id="rm-bookmarks-group">
          <div class="atv-remote-bm-head">
            <span class="atv-remote-rate-title" id="rm-lbl-bookmarks-title">${t("Главы и закладки", "Chapters & Bookmarks")}</span>
            <span class="atv-remote-rate-badge hidden" id="rm-active-chapter-pill"></span>
          </div>
          <div class="atv-remote-bm-actions-row">
            <button type="button" class="atv-remote-pill-btn atv-remote-bm-action-btn" id="rm-btn-prev-marker" title="${escapeAttr(t("Предыдущая глава или закладка", "Previous chapter or bookmark"))}">${iconSvg("chevronLeft", 13)}<span id="rm-lbl-prev-marker">${t("Пред метка", "Prev Marker")}</span></button>
            <button type="button" class="atv-remote-pill-btn atv-remote-bm-action-btn" id="rm-btn-bookmark-toggle">${iconSvg("bookmark", 13)}<span id="rm-lbl-bookmark-toggle">${t("Закладка", "Bookmark")}</span></button>
            <button type="button" class="atv-remote-pill-btn atv-remote-bm-action-btn" id="rm-btn-bookmark-note-open"><span id="rm-lbl-bookmark-note-open">${t("+ Заметка", "+ Note")}</span></button>
            <button type="button" class="atv-remote-pill-btn atv-remote-bm-action-btn" id="rm-btn-next-marker" title="${escapeAttr(t("Следующая глава или закладка", "Next chapter or bookmark"))}"><span id="rm-lbl-next-marker">${t("След метка", "Next Marker")}</span>${iconSvg("chevronRight", 13)}</button>
          </div>
          <div class="atv-remote-bm-note-form hidden" id="rm-bookmark-note-form">
            <input type="text" class="atv-remote-bm-note-input" id="rm-bookmark-note-input" maxlength="160" placeholder="${escapeAttr(t("Текст заметки к моменту...", "Note for this moment..."))}" aria-label="${escapeAttr(t("Текст заметки к моменту", "Note for this moment"))}" autocomplete="off" />
            <div class="atv-remote-bm-note-btns">
              <button type="button" class="atv-remote-rate-action-btn is-watched" id="rm-btn-bookmark-note-save">${t("Сохранить", "Save")}</button>
              <button type="button" class="atv-remote-rate-action-btn is-subtle" id="rm-btn-bookmark-note-cancel">${t("Отмена", "Cancel")}</button>
            </div>
          </div>
          <div class="atv-remote-bm-list hidden" id="rm-bookmarks-list"></div>
        </div>

        <div class="atv-remote-card-group hidden" id="rm-rating-group">
          <div class="atv-remote-rate-head">
            <div class="atv-remote-rate-title-wrap">
              <span class="atv-remote-rate-title" id="rm-lbl-rate-title">${t("Оценка в Kinorium", "Kinorium Rating")}</span>
              <span class="atv-remote-rate-badge" id="rm-rate-current-badge">${t("Не оценено", "Not rated")}</span>
            </div>
            <div class="atv-remote-rate-actions">
              <button type="button" class="atv-remote-rate-action-btn" id="rm-btn-watch-toggle" aria-pressed="false">${t("Отметить просмотр", "Mark Watched")}</button>
              <button type="button" class="atv-remote-rate-action-btn is-subtle hidden" id="rm-btn-clear-rate">${t("Сбросить", "Clear")}</button>
            </div>
          </div>
          <div class="atv-remote-rate-scope hidden" id="rm-rate-scope-row">
            <button type="button" class="atv-remote-scope-btn active" id="rm-rate-scope-ep" data-rscope="episode" aria-pressed="true">${t("Эта серия", "This Episode")}</button>
            <button type="button" class="atv-remote-scope-btn" id="rm-rate-scope-series" data-rscope="series" aria-pressed="false">${t("Весь сериал", "Entire Series")}</button>
          </div>
          <div class="atv-remote-rate-grid" id="rm-rate-stars-grid">
            ${Array.from({ length: 10 }, (_, idx) => {
              const sc = idx + 1;
              return `<button type="button" class="atv-remote-rate-btn" data-rscore="${sc}" aria-pressed="false" aria-label="${escapeAttr(t(`Оценка ${sc} из 10`, `Rate ${sc} out of 10`))}">${sc}</button>`;
            }).join("")}
          </div>
        </div>
      </section>

      <section class="atv-remote-pane hidden" id="rm-pane-dpad">
        <div class="atv-remote-dpad-chassis" id="rm-dpad-chassis">
          <div class="atv-remote-dpad-mode-switch">
            <button type="button" class="atv-remote-scope-btn active" id="rm-mode-touchpad" aria-pressed="true">${t("Тачпад", "Touchpad")}</button>
            <button type="button" class="atv-remote-scope-btn" id="rm-mode-buttons" aria-pressed="false">${t("Кнопки", "Buttons")}</button>
          </div>
          <div class="atv-remote-dpad-hint" id="rm-dpad-hint">${t(
            "Свайп влево и вправо для перемотки, вверх и вниз для громкости, касание для выбора",
            "Swipe left/right to seek, up/down for volume, tap to select"
          )}</div>
          <div class="atv-remote-touchpad-wrap" id="rm-touchpad-box">
            <div class="atv-remote-touchpad-surface" id="rm-touchpad-surface" role="application" aria-label="${escapeAttr(t("Сенсорная панель навигации: свайп для перемещения, касание для выбора", "Touchpad navigation surface: swipe to move, tap to select"))}">
              <div class="atv-remote-touchpad-arrow is-up" data-tp-dir="up" aria-hidden="true">${iconSvg("chevronUp", 14)}</div>
              <div class="atv-remote-touchpad-arrow is-down" data-tp-dir="down" aria-hidden="true">${iconSvg("chevronDown", 14)}</div>
              <div class="atv-remote-touchpad-arrow is-left" data-tp-dir="left" aria-hidden="true">${iconSvg("chevronLeft", 14)}</div>
              <div class="atv-remote-touchpad-arrow is-right" data-tp-dir="right" aria-hidden="true">${iconSvg("chevronRight", 14)}</div>
              <div class="atv-remote-touchpad-puck" id="rm-touchpad-puck" aria-hidden="true"></div>
              <div class="atv-remote-touchpad-hud hidden" id="rm-touchpad-hud" aria-live="polite"></div>
            </div>
          </div>
          <div class="atv-remote-dpad-pad hidden" id="rm-buttons-box">
            <div></div>
            <button type="button" class="atv-remote-dpad-btn" data-dpad="up" aria-label="${escapeAttr(t("Вверх", "Up"))}" title="${escapeAttr(t("Вверх", "Up"))}">${iconSvg("chevronUp", 22)}</button>
            <div></div>
            <button type="button" class="atv-remote-dpad-btn" data-dpad="left" aria-label="${escapeAttr(t("Влево", "Left"))}" title="${escapeAttr(t("Влево", "Left"))}">${iconSvg("chevronLeft", 22)}</button>
            <button type="button" class="atv-remote-dpad-ok" data-dpad="ok" aria-label="${escapeAttr(t("Выбрать (OK)", "Select (OK)"))}" title="${escapeAttr(t("Выбрать (OK)", "Select (OK)"))}">OK</button>
            <button type="button" class="atv-remote-dpad-btn" data-dpad="right" aria-label="${escapeAttr(t("Вправо", "Right"))}" title="${escapeAttr(t("Вправо", "Right"))}">${iconSvg("chevronRight", 22)}</button>
            <div></div>
            <button type="button" class="atv-remote-dpad-btn" data-dpad="down" aria-label="${escapeAttr(t("Вниз", "Down"))}" title="${escapeAttr(t("Вниз", "Down"))}">${iconSvg("chevronDown", 22)}</button>
            <div></div>
          </div>
          <div class="atv-remote-dpad-actions">
            <button type="button" class="atv-remote-pill-btn" data-dpad="back" id="rm-dpad-back">${t("Назад (Esc)", "Back (Esc)")}</button>
            <button type="button" class="atv-remote-pill-btn" id="rm-dpad-playpause">${t("Пауза / Пуск", "Play / Pause")}</button>
            <button type="button" class="atv-remote-pill-btn" id="rm-dpad-xray" aria-pressed="false">${iconSvg("sparkles", 13)}<span id="rm-lbl-dpad-xray">X-Ray</span></button>
            <button type="button" class="atv-remote-pill-btn" id="rm-dpad-fs" aria-pressed="false">${iconSvg("fsEnter", 13)}<span id="rm-lbl-dpad-fs">${t("Экран", "Screen")}</span></button>
            <button type="button" class="atv-remote-pill-btn" id="rm-dpad-tvtoggle" aria-pressed="false">${t("Режим ТВ", "TV Mode")}</button>
            <button type="button" class="atv-remote-pill-btn" id="rm-dpad-sub-cycle" aria-pressed="false"><span id="rm-lbl-dpad-sub">${t("Субтитры", "Subtitles")}</span></button>
          </div>
          <div class="atv-remote-dpad-vol-bar">
            <button type="button" class="atv-remote-pill-btn" id="rm-dpad-vol-down" aria-label="${escapeAttr(t("Тише", "Volume down"))}">${iconSvg("volLow", 14)}<span>−10%</span></button>
            <button type="button" class="atv-remote-pill-btn" id="rm-dpad-mute" aria-label="${escapeAttr(t("Без звука", "Mute"))}">${iconSvg("volMute", 14)}<span id="rm-dpad-vol-lbl">100%</span></button>
            <button type="button" class="atv-remote-pill-btn" id="rm-dpad-vol-up" aria-label="${escapeAttr(t("Громче", "Volume up"))}">${iconSvg("volHigh", 14)}<span>+10%</span></button>
          </div>
        </div>
      </section>

      <section class="atv-remote-pane hidden" id="rm-pane-xray">
        <div class="atv-remote-xray-head">
          <div class="atv-remote-xray-header-row">
            <div class="atv-remote-xray-badge">${iconSvg("sparkles", 13)}<span>X-Ray</span></div>
            <div class="atv-remote-xray-title" id="rm-xray-title">${t("О фильме", "About Title")}</div>
          </div>
          <div class="atv-remote-xray-tabs-bar" role="tablist" aria-label="${escapeAttr(t("Категории X-Ray", "X-Ray categories"))}">
            <button type="button" role="tab" class="atv-remote-xray-tab active" data-rxray-tab="cast" id="rm-xray-tab-cast">${t("В кадре", "In Scene")}</button>
            <button type="button" role="tab" class="atv-remote-xray-tab" data-rxray-tab="soundtrack" id="rm-xray-tab-soundtrack">${t("Музыка", "Music")}</button>
            <button type="button" role="tab" class="atv-remote-xray-tab" data-rxray-tab="trivia" id="rm-xray-tab-trivia">${t("Факты", "Trivia")}</button>
          </div>
        </div>
        <div class="atv-remote-xray-body">
          <div class="atv-remote-xray-sec" id="rm-xray-sec-cast"></div>
          <div class="atv-remote-xray-sec hidden" id="rm-xray-sec-soundtrack"></div>
          <div class="atv-remote-xray-sec hidden" id="rm-xray-sec-trivia"></div>
        </div>
      </section>

      <section class="atv-remote-pane hidden" id="rm-pane-catalog">
        <div class="atv-remote-search-bar">
          <span class="atv-remote-search-ico" aria-hidden="true">${iconSvg("search", 15)}</span>
          <input type="search" id="rm-catalog-search" enterkeyhint="search" aria-label="${escapeAttr(
            t("Найти фильм или сериал для запуска на ПК...", "Search movies or series to play on PC...")
          )}" placeholder="${escapeAttr(
            t("Найти фильм или сериал для запуска на ПК...", "Search movies or series to play on PC...")
          )}" autocomplete="off" />
          <button type="button" class="atv-remote-search-clear hidden" id="rm-catalog-search-clear" aria-label="${escapeAttr(t("Очистить поиск", "Clear search"))}">${iconSvg("x", 14)}</button>
          <button type="button" class="atv-remote-pill-btn hidden" id="rm-catalog-search-tv" title="${escapeAttr(t("Передать поисковый запрос на экран ПК", "Send search query to PC screen"))}">${iconSvg("tv", 13)}<span id="rm-lbl-search-tv">${t("На экран", "To PC")}</span></button>
        </div>
        <div class="atv-remote-chips-scroll atv-remote-cat-filters" id="rm-catalog-filter-chips" role="tablist" aria-label="${escapeAttr(t("Фильтры каталога", "Catalog filters"))}">
          <button type="button" role="tab" aria-selected="true" class="atv-remote-chip active" data-rcat-filter="all" id="rm-cat-flt-all">${t("Все", "All")}</button>
          <button type="button" role="tab" aria-selected="false" class="atv-remote-chip" data-rcat-filter="cw" id="rm-cat-flt-cw">${t("Продолжить", "Continue")}</button>
          <button type="button" role="tab" aria-selected="false" class="atv-remote-chip" data-rcat-filter="movie" id="rm-cat-flt-movie">${t("Фильмы", "Movies")}</button>
          <button type="button" role="tab" aria-selected="false" class="atv-remote-chip" data-rcat-filter="series" id="rm-cat-flt-series">${t("Сериалы", "Series")}</button>
        </div>
        <div id="rm-catalog-results" class="atv-remote-catalog-list"></div>
      </section>
    </main>

    <div class="atv-remote-mini-transport hidden" id="rm-mini-transport" role="region" aria-label="${escapeAttr(t("Мини-плеер", "Mini player"))}">
      <div class="atv-remote-mini-progress"><div class="atv-remote-mini-progress-fill" id="rm-mini-progress-fill"></div></div>
      <div class="atv-remote-mini-inner">
        <button type="button" class="atv-remote-mini-info-btn" id="rm-mini-open-player">
          <img class="atv-remote-mini-poster hidden" id="rm-mini-poster" alt="" referrerpolicy="no-referrer" />
          <div class="atv-remote-mini-meta">
            <div class="atv-remote-mini-title" id="rm-mini-title"></div>
            <div class="atv-remote-mini-sub" id="rm-mini-sub"></div>
          </div>
        </button>
        <div class="atv-remote-mini-actions">
          <button type="button" class="atv-remote-mini-btn" id="rm-mini-back10" aria-label="${escapeAttr(t("Назад 10 с", "Back 10s"))}">−10</button>
          <button type="button" class="atv-remote-mini-btn is-play" id="rm-mini-play" aria-label="${escapeAttr(t("Пауза / Пуск", "Play / Pause"))}">${iconSvg("play", 15)}</button>
          <button type="button" class="atv-remote-mini-btn" id="rm-mini-fwd10" aria-label="${escapeAttr(t("Вперёд 10 с", "Fwd 10s"))}">+10</button>
        </div>
      </div>
    </div>

    <nav class="atv-remote-bottom-tabs" role="tablist" aria-label="${escapeAttr(t("Разделы пульта", "Remote sections"))}">
      <button type="button" role="tab" aria-selected="true" class="atv-remote-tab active" data-rtab="player">${iconSvg("play", 16)}<span id="rm-tab-lbl-player">${t("Плеер", "Player")}</span></button>
      <button type="button" role="tab" aria-selected="false" class="atv-remote-tab" data-rtab="xray">${iconSvg("sparkles", 16)}<span id="rm-tab-lbl-xray">X-Ray</span><span class="atv-remote-tab-badge hidden" id="rm-tab-xray-badge"></span></button>
      <button type="button" role="tab" aria-selected="false" class="atv-remote-tab" data-rtab="dpad">${iconSvg("tv", 16)}<span id="rm-tab-lbl-dpad">${t("Пульт", "D-Pad")}</span></button>
      <button type="button" role="tab" aria-selected="false" class="atv-remote-tab" data-rtab="catalog">${iconSvg("search", 16)}<span id="rm-tab-lbl-catalog">${t("Каталог", "Catalog")}</span></button>
    </nav>
  `;

  const localizeRemoteShellStaticDOM = () => {
    document.documentElement.lang = state.appLang === "en" ? "en" : "ru";
    document.title = t("Пульт Velarium", "Velarium Remote");
    const setTxt = (id, ru, en) => {
      const el = document.getElementById(id);
      if (el) el.textContent = t(ru, en);
    };
    setTxt("rm-brand-title", "Пульт Velarium", "Velarium Remote");
    setTxt("rm-auth-error-title", "Ключ пульта недействителен", "Remote key expired");
    setTxt(
      "rm-auth-error-sub",
      "Отсканируйте актуальный QR-код в окне «Пульт и ТВ» на компьютере.",
      "Scan the current QR code in the Remote & TV window on your computer."
    );
    setTxt("rm-lbl-idle-browse", "Открыть каталог", "Browse Catalog");
    setTxt("rm-lbl-idle-cw-title", "Продолжить просмотр", "Continue Watching");
    setTxt("rm-lbl-back30", "−30 с", "−30 s");
    setTxt("rm-lbl-back10", "10 с", "10 s");
    setTxt("rm-lbl-fwd10", "10 с", "10 s");
    setTxt("rm-lbl-fwd30", "+30 с", "+30 s");
    setTxt("rm-lbl-prev-ep", "Пред серия", "Prev Ep");
    setTxt("rm-btn-skip-intro", "Пропустить заставку", "Skip Intro");
    setTxt("rm-lbl-next-ep", "След серия", "Next Ep");
    setTxt("rm-lbl-season", "Сезон и серия", "Season & Episode");
    setTxt("rm-lbl-bookmarks-title", "Главы и закладки", "Chapters & Bookmarks");
    setTxt("rm-lbl-prev-marker", "Пред метка", "Prev Marker");
    setTxt("rm-lbl-bookmark-toggle", "Закладка", "Bookmark");
    setTxt("rm-lbl-bookmark-note-open", "+ Заметка", "+ Note");
    setTxt("rm-lbl-next-marker", "След метка", "Next Marker");
    setTxt("rm-btn-bookmark-note-save", "Сохранить", "Save");
    setTxt("rm-btn-bookmark-note-cancel", "Отмена", "Cancel");
    const bmNoteInp = document.getElementById("rm-bookmark-note-input");
    if (bmNoteInp) {
      const bmPh = t("Текст заметки к моменту...", "Note for this moment...");
      bmNoteInp.placeholder = bmPh;
      bmNoteInp.setAttribute("aria-label", t("Текст заметки к моменту", "Note for this moment"));
    }
    setTxt("rm-lbl-studio", "Озвучка", "Audio");
    setTxt("rm-lbl-source-tab", "Источник", "Source");
    setTxt("rm-lbl-quality", "Качество", "Quality");
    setTxt("rm-lbl-sub", "Субтитры", "Subtitles");
    setTxt("rm-lbl-sub-sync", "Синхронизация субтитров", "Subtitle Sync");
    setTxt("rm-lbl-tuning-title", "Звук, скорость и таймер сна", "Audio DSP, Speed & Sleep");
    setTxt("rm-lbl-audio-preset", "Режим звука (DSP)", "Sound Mode (DSP)");
    setTxt("rm-preset-flat", "Стандарт", "Standard");
    setTxt("rm-preset-voice", "Чёткая речь", "Clear Voice");
    setTxt("rm-preset-night", "Ночной", "Night");
    setTxt("rm-preset-cinema", "Кинотеатр", "Cinema");
    setTxt("rm-quick-preset-flat", "Стандарт", "Standard");
    setTxt("rm-quick-preset-voice", "Голос", "Voice");
    setTxt("rm-quick-preset-night", "Ночной", "Night");
    setTxt("rm-quick-preset-cinema", "Кинозал", "Cinema");
    setTxt("rm-lbl-dpad-sub", "Субтитры", "Subtitles");
    setTxt("rm-lbl-crop", "Кадр и подсветка", "Aspect Ratio & Ambilight");
    setTxt("rm-crop-contain", "16:9 Стандарт", "16:9 Fit");
    setTxt("rm-crop-cover", "21:9 Без полос", "21:9 Crop");
    setTxt("rm-lbl-speed", "Скорость", "Speed");
    setTxt("rm-lbl-sleep", "Таймер сна", "Sleep Timer");
    setTxt("rm-lbl-rate-title", "Оценка в Kinorium", "Kinorium Rating");
    setTxt("rm-btn-clear-rate", "Сбросить", "Clear");
    setTxt("rm-rate-scope-series", "Весь сериал", "Entire Series");
    setTxt("rm-lbl-fs", "Полный экран", "Fullscreen");
    setTxt("rm-lbl-xray-pc", "X-Ray на ПК", "X-Ray on PC");
    setTxt("rm-lbl-pip", "Картинка в картинке", "PiP");
    setTxt("rm-lbl-tvmode", "Режим ТВ", "TV Mode");
    setTxt("rm-lbl-dpad-fs", "Экран", "Screen");
    setTxt("rm-mode-touchpad", "Тачпад", "Touchpad");
    setTxt("rm-mode-buttons", "Кнопки", "Buttons");
    const isTouchpadMode =
      !document.getElementById("rm-touchpad-box")?.classList.contains("hidden") &&
      document.getElementById("rm-mode-touchpad")?.classList.contains("active");
    if (isTouchpadMode) {
      if (rState.snap?.is_player_open) {
        setTxt(
          "rm-dpad-hint",
          "Свайп влево и вправо — перемотка ±10 с · вверх и вниз — громкость · касание — пауза",
          "Swipe left/right to seek ±10 s · up/down for volume · tap to play/pause"
        );
      } else {
        setTxt(
          "rm-dpad-hint",
          "Свайп в любом направлении — перемещение курсора, одиночное касание — выбор (OK)",
          "Swipe in any direction to move focus, single tap to select (OK)"
        );
      }
    } else {
      setTxt(
        "rm-dpad-hint",
        "Управляйте курсором в Режиме ТВ и диалоговыми окнами на компьютере",
        "Navigate TV Mode cards and modals on your computer"
      );
    }
    setTxt("rm-dpad-back", "Назад (Esc)", "Back (Esc)");
    setTxt("rm-dpad-playpause", "Пауза / Пуск", "Play / Pause");
    setTxt("rm-dpad-tvtoggle", "Режим ТВ", "TV Mode");
    setTxt("rm-tab-lbl-player", "Плеер", "Player");
    setTxt("rm-tab-lbl-xray", "X-Ray", "X-Ray");
    setTxt("rm-tab-lbl-dpad", "Пульт", "D-Pad");
    setTxt("rm-tab-lbl-catalog", "Каталог", "Catalog");
    setTxt("rm-xray-tab-cast", "В кадре", "In Scene");
    setTxt("rm-xray-tab-soundtrack", "Музыка", "Music");
    setTxt("rm-xray-tab-trivia", "Факты", "Trivia");
    setTxt("rm-cat-flt-all", "Все", "All");
    setTxt("rm-cat-flt-cw", "Продолжить", "Continue");
    setTxt("rm-cat-flt-movie", "Фильмы", "Movies");
    setTxt("rm-cat-flt-series", "Сериалы", "Series");

    const closeBtn = document.getElementById("rm-btn-close-pc-player");
    if (closeBtn) {
      const closeLbl = t("Закрыть плеер на компьютере", "Close player on computer");
      closeBtn.title = closeLbl;
      closeBtn.setAttribute("aria-label", closeLbl);
    }
    const playBtn = document.getElementById("rm-btn-play");
    if (playBtn) {
      playBtn.setAttribute("aria-label", t("Пауза / Пуск", "Play / Pause"));
    }
    const searchEl = document.getElementById("rm-catalog-search");
    if (searchEl) {
      const searchPh = t(
        "Найти фильм или сериал для запуска на ПК...",
        "Search movies or series to play on PC..."
      );
      searchEl.placeholder = searchPh;
      searchEl.setAttribute("aria-label", searchPh);
    }
    const dpadLabels = {
      up: t("Вверх", "Up"),
      left: t("Влево", "Left"),
      ok: t("Выбрать (OK)", "Select (OK)"),
      right: t("Вправо", "Right"),
      down: t("Вниз", "Down"),
    };
    Object.entries(dpadLabels).forEach(([dir, lbl]) => {
      const btn = shell.querySelector(`#rm-buttons-box [data-dpad="${dir}"]`);
      if (btn) {
        btn.title = lbl;
        btn.setAttribute("aria-label", lbl);
      }
    });
  };

  const renderAuthState = () => {
    document.getElementById("rm-auth-error")?.classList.toggle("hidden", !rState.authFailed);
    document.getElementById("rm-main-body")?.classList.toggle("hidden", rState.authFailed);
  };

  const syncSelectOptions = (selEl, items, valKey, labelKey, activeVal) => {
    if (!selEl) return;
    const sig = items.map((it) => `${it[valKey]}:${it[labelKey] || ""}`).join("|");
    let sigChanged = false;
    if (selEl.dataset.sig !== sig) {
      selEl.dataset.sig = sig;
      sigChanged = true;
      selEl.innerHTML = "";
      const frag = document.createDocumentFragment();
      items.forEach((it) => {
        const opt = document.createElement("option");
        opt.value = String(it[valKey]);
        opt.textContent = String(it[labelKey] || "");
        frag.appendChild(opt);
      });
      selEl.appendChild(frag);
    }
    let valChanged = false;
    if (document.activeElement !== selEl && String(selEl.value) !== String(activeVal)) {
      selEl.value = String(activeVal);
      valChanged = true;
    }
    if (sigChanged || valChanged) {
      syncCustomSelect(selEl);
    }
  };

  const renderIdleContinueWatching = () => {
    const cwGroup = document.getElementById("rm-idle-cw-group");
    const cwListEl = document.getElementById("rm-idle-cw-list");
    if (!cwGroup || !cwListEl) return;
    const s = rState.snap;
    const isIdle = !s.is_player_open && !rState.authFailed;
    if (isIdle && !rState.catalogLoaded) {
      loadRemoteCatalog("");
    }
    const cwItems = Array.isArray(rState.catalogCW) ? rState.catalogCW.slice(0, 6) : [];
    const showShelf = isIdle && cwItems.length > 0;
    cwGroup.classList.toggle("hidden", !showShelf);
    if (!showShelf) return;

    const sig = `${state.appLang}:${cwItems.map((it) => `${it.id}:${it.season || 1}:${it.episode || 1}:${Math.round(it.current_time || 0)}`).join("|")}`;
    if (rState.idleCwSig === sig) return;
    rState.idleCwSig = sig;

    cwListEl.innerHTML = "";
    cwItems.forEach((it) => {
      const itemTitle = displayTitle(it) || it.title || it.orig_title || t("Без названия", "Untitled");
      const itemPoster = displayPoster(it) || it.poster || it.backdrop || "";
      const card = document.createElement("button");
      card.type = "button";
      card.className = "atv-remote-cat-row is-compact";
      const epMeta =
        it.media_type === "series"
          ? `S${it.season || 1}E${it.episode || 1}`
          : it.year || t("Фильм", "Movie");
      const timeMeta = it.current_time > 10 ? ` · ${formatTime(it.current_time)}` : "";
      card.innerHTML = `
        <img class="atv-remote-cat-poster" src="${escapeAttr(itemPoster)}" alt="" loading="lazy" referrerpolicy="no-referrer" />
        <div class="atv-remote-cat-info">
          <div class="atv-remote-cat-title">${escapeHtml(itemTitle)}</div>
          <div class="atv-remote-cat-sub">${escapeHtml(String(epMeta) + timeMeta)}</div>
        </div>
        <span class="atv-remote-cat-play">${iconSvg("play", 13)}</span>
      `;
      attachSmartPosterFallback(card.querySelector(".atv-remote-cat-poster"), itemTitle, it.year || "", it.poster || itemPoster);
      card.onclick = () => {
        sendCmd("play_item", {
          item: it,
          season: it.season || 1,
          episode: it.episode || 1,
          resume_time: it.current_time || 0,
        });
      };
      cwListEl.appendChild(card);
    });
  };

  const renderRemoteUI = () => {
    renderAuthState();
    const s = rState.snap;
    const dot = document.getElementById("rm-conn-dot");
    const connLbl = document.getElementById("rm-conn-label");
    if (dot) dot.classList.toggle("is-online", rState.desktopOnline && !rState.authFailed);
    if (connLbl) {
      connLbl.textContent = rState.authFailed
        ? t("Доступ отклонён", "Access denied")
        : rState.desktopOnline
        ? s.is_player_open
          ? t("Подключено к ПК · Воспроизведение", "Connected to PC · Active")
          : t("Подключено к ПК · Ожидание", "Connected to PC · Idle")
        : t("Ожидание отклика Velarium на ПК...", "Waiting for Velarium on PC...");
    }

    const closeBtn = document.getElementById("rm-btn-close-pc-player");
    if (closeBtn) closeBtn.classList.toggle("hidden", !s.is_player_open);

    const nowCardEl = document.getElementById("rm-now-card");
    const posterEl = document.getElementById("rm-poster");
    const badgeEl = document.getElementById("rm-source-badge");
    const qualBadgeEl = document.getElementById("rm-quality-badge");
    const stateBadgeEl = document.getElementById("rm-playback-state-badge");
    const titleEl = document.getElementById("rm-now-title");
    const subEl = document.getElementById("rm-now-sub");
    const idleBrowseBtn = document.getElementById("rm-btn-idle-browse");

    if (nowCardEl) {
      nowCardEl.classList.toggle("is-active-player", Boolean(s.is_player_open && s.active_item));
      nowCardEl.classList.toggle("is-playing", Boolean(s.is_player_open && s.playing));
    }

    if (s.is_player_open && s.active_item) {
      const it = s.active_item;
      const dispNowTitle = displayTitle(it) || it.title || it.orig_title || "";
      if (posterEl && it.poster) {
        if (posterEl.getAttribute("src") !== it.poster) {
          posterEl.src = it.poster;
          attachSmartPosterFallback(posterEl, dispNowTitle, it.year || "", it.poster);
        }
        posterEl.classList.remove("hidden");
      } else if (posterEl) {
        posterEl.classList.add("hidden");
      }
      if (badgeEl) {
        badgeEl.textContent = s.active_studio_name
          ? translateStudioName(s.active_studio_name)
          : String(s.active_source_tab || "HDRezka").toUpperCase();
      }
      if (qualBadgeEl) {
        const qTxt = String(s.active_quality || "").trim();
        qualBadgeEl.textContent = qTxt;
        qualBadgeEl.classList.toggle("hidden", !qTxt);
      }
      if (stateBadgeEl) {
        stateBadgeEl.textContent = s.playing ? t("Идёт показ", "Playing") : t("На паузе", "Paused");
        stateBadgeEl.classList.toggle("is-live", Boolean(s.playing));
        stateBadgeEl.classList.remove("hidden");
      }
      if (titleEl) {
        titleEl.textContent = it.year ? `${dispNowTitle} (${it.year})` : dispNowTitle;
      }
      if (subEl) {
        if (it.media_type === "series") {
          const epPart = t(`Сезон ${it.season}, Серия ${it.episode}`, `Season ${it.season}, Episode ${it.episode}`);
          subEl.textContent = it.episode_title ? `${epPart} · ${it.episode_title}` : epPart;
        } else {
          subEl.textContent = it.orig_title || t("Художественный фильм", "Feature Film");
        }
      }
      idleBrowseBtn?.classList.add("hidden");
    } else {
      posterEl?.classList.add("hidden");
      qualBadgeEl?.classList.add("hidden");
      stateBadgeEl?.classList.add("hidden");
      if (badgeEl) badgeEl.textContent = "Velarium";
      if (titleEl) titleEl.textContent = t("Плеер на компьютере закрыт", "Desktop player is closed");
      if (subEl) {
        subEl.textContent = t(
          "Откройте вкладку «Каталог», чтобы запустить любой фильм на компьютере",
          "Open the Catalog tab to launch any movie or series on your computer"
        );
      }
      idleBrowseBtn?.classList.remove("hidden");
    }

    const dpadHintEl = document.getElementById("rm-dpad-hint");
    if (dpadHintEl) {
      const isTouchpadMode =
        !document.getElementById("rm-touchpad-box")?.classList.contains("hidden") &&
        document.getElementById("rm-mode-touchpad")?.classList.contains("active");
      if (isTouchpadMode) {
        dpadHintEl.textContent = s.is_player_open
          ? t(
              "Свайп влево и вправо — перемотка ±10 с · вверх и вниз — громкость · касание — пауза",
              "Swipe left/right to seek ±10 s · up/down for volume · tap to play/pause"
            )
          : t(
              "Свайп в любом направлении — перемещение курсора, одиночное касание — выбор (OK)",
              "Swipe in any direction to move focus, single tap to select (OK)"
            );
      }
    }

    renderIdleContinueWatching();

    const playBtn = document.getElementById("rm-btn-play");
    if (playBtn) {
      const ico = s.playing ? "pause" : "play";
      if (playBtn.dataset.ico !== ico) {
        playBtn.dataset.ico = ico;
        playBtn.innerHTML = iconSvg(ico, 24);
      }
    }

    const dur = Math.max(0, Number(s.duration) || 0);
    const interpCur = getInterpolatedTime();

    const scrubber = document.getElementById("rm-scrubber");
    if (scrubber && !rState.scrubbing) {
      scrubber.disabled = !s.is_player_open || dur <= 0;
      scrubber.value = dur > 0 ? String(Math.round((interpCur / dur) * 1000)) : "0";
      updateRangeSliderFill(scrubber);
    }
    const markersEl = document.getElementById("rm-scrubber-markers");
    if (markersEl) {
      if (s.is_player_open && dur > 0) {
        const chs = Array.isArray(s.chapters) ? s.chapters : [];
        const bms = Array.isArray(s.bookmarks) ? s.bookmarks : [];
        const mSig = `${Math.round(dur)}:${chs.map((c) => Math.round(Number(c.time) || 0)).join(",")}:${bms.map((b) => Math.round(Number(b.time) || 0)).join(",")}`;
        if (rState.scrubberMarkersSig !== mSig) {
          rState.scrubberMarkersSig = mSig;
          const ticks = [
            ...chs
              .map((c) => Number(c.time) || 0)
              .filter((tSec) => tSec > 3 && tSec < dur - 3)
              .map((tSec) => ({ pct: (tSec / dur) * 100, cls: "is-chapter" })),
            ...bms
              .map((b) => Number(b.time) || 0)
              .filter((tSec) => tSec > 1 && tSec < dur - 1)
              .map((tSec) => ({ pct: (tSec / dur) * 100, cls: "is-bookmark" })),
          ];
          markersEl.innerHTML = ticks
            .map((tk) => `<span class="atv-remote-scrubber-tick ${tk.cls}" style="left:${tk.pct.toFixed(2)}%"></span>`)
            .join("");
        }
      } else if (rState.scrubberMarkersSig !== "") {
        rState.scrubberMarkersSig = "";
        markersEl.innerHTML = "";
      }
    }
    const curEl = document.getElementById("rm-time-cur");
    const durEl = document.getElementById("rm-time-dur");
    const timeChapterEl = document.getElementById("rm-time-chapter");
    if (curEl && !rState.scrubbing) curEl.textContent = formatTime(interpCur);
    if (durEl) {
      if (rState.showRemainingTime && dur > 0) {
        const rem = Math.max(0, dur - interpCur);
        durEl.textContent = `−${formatTime(rem)}`;
      } else {
        durEl.textContent = formatTime(dur);
      }
    }
    if (timeChapterEl && !rState.scrubbing) {
      timeChapterEl.classList.remove("is-scrubbing");
      const actCh = String(s.active_chapter || "").trim();
      const rateNum = Math.round((Number(s.playback_rate) || 1) * 100) / 100;
      if (actCh) {
        timeChapterEl.textContent = actCh;
      } else if (rateNum !== 1 && s.is_player_open) {
        timeChapterEl.textContent = `${rateNum}×`;
      } else {
        timeChapterEl.textContent = "";
      }
    }

    const epRow = document.getElementById("rm-ep-row");
    const isSeries = Boolean(s.is_player_open && s.active_item?.media_type === "series");
    if (epRow) {
      epRow.classList.toggle("hidden", !(isSeries || s.has_skip_intro));
      const prevBtn = document.getElementById("rm-btn-prev-ep");
      const nextBtn = document.getElementById("rm-btn-next-ep");
      const skipBtn = document.getElementById("rm-btn-skip-intro");
      if (prevBtn) {
        prevBtn.classList.toggle("hidden", !isSeries);
        prevBtn.disabled = !s.has_prev_ep;
      }
      if (nextBtn) {
        nextBtn.classList.toggle("hidden", !isSeries);
        nextBtn.disabled = !s.has_next_ep;
      }
      if (skipBtn) {
        skipBtn.classList.toggle("hidden", !s.has_skip_intro);
      }
    }

    const epPickerGroup = document.getElementById("rm-ep-picker-group");
    if (epPickerGroup) {
      const seasonsObj = s.seasons_map && typeof s.seasons_map === "object" ? s.seasons_map : {};
      const seasonNums = Object.keys(seasonsObj)
        .map((k) => parseInt(k, 10))
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);
      const hasSeasonPicker = isSeries && seasonNums.length > 0;
      epPickerGroup.classList.toggle("hidden", !hasSeasonPicker);
      if (hasSeasonPicker) {
        const it = s.active_item || {};
        const curSeason = Math.max(1, parseInt(it.season, 10) || seasonNums[0] || 1);
        const curEpisode = Math.max(1, parseInt(it.episode, 10) || 1);
        const seriesKey = `${it.id || ""}:${it.title || ""}:${curSeason}:${curEpisode}`;
        if (rState.lastActiveSeriesKey !== seriesKey) {
          rState.lastActiveSeriesKey = seriesKey;
          rState.previewSeason = curSeason;
        }
        const activeSeason = seasonNums.includes(rState.previewSeason) ? rState.previewSeason : curSeason;
        rState.previewSeason = activeSeason;

        const seasonItems = seasonNums.map((sNum) => ({
          id: String(sNum),
          label: t(`Сезон ${sNum}`, `Season ${sNum}`),
        }));
        syncSelectOptions(document.getElementById("rm-sel-season"), seasonItems, "id", "label", String(activeSeason));

        const epListRaw = seasonsObj[String(activeSeason)] || seasonsObj[activeSeason] || [];
        const epNums = (Array.isArray(epListRaw) ? epListRaw : [])
          .map((e) => parseInt(e, 10))
          .filter((n) => Number.isFinite(n) && n > 0)
          .sort((a, b) => a - b);
        const watchedMap = s.watched_episodes && typeof s.watched_episodes === "object" ? s.watched_episodes : {};
        const epGridEl = document.getElementById("rm-ep-grid");
        if (epGridEl) {
          const gridSig = `${state.appLang}:${activeSeason}:${curSeason}:${curEpisode}:${epNums.join(",")}:${JSON.stringify(watchedMap)}`;
          if (rState.epGridSig !== gridSig) {
            rState.epGridSig = gridSig;
            epGridEl.innerHTML = epNums
              .map((eNum) => {
                const isCurEp = activeSeason === curSeason && eNum === curEpisode;
                const seasonWatchedList = watchedMap[String(activeSeason)] || watchedMap[activeSeason];
                const isWatchedEp = Array.isArray(seasonWatchedList)
                  ? seasonWatchedList.includes(Number(eNum))
                  : Boolean(watchedMap[`${activeSeason}:${eNum}`]);
                const cls = [
                  "atv-remote-ep-pill",
                  isCurEp ? "active" : "",
                  isWatchedEp ? "is-watched" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                const epLabel = t(`Серия ${eNum}`, `Episode ${eNum}`);
                return `<button type="button" class="${cls}" data-rm-ep="${eNum}" aria-pressed="${isCurEp ? "true" : "false"}" title="${escapeAttr(epLabel)}">${eNum}</button>`;
              })
              .join("");
            const actEpBtn = epGridEl.querySelector(".atv-remote-ep-pill.active");
            if (actEpBtn && actEpBtn.scrollIntoView) {
              requestAnimationFrame(() => {
                try {
                  actEpBtn.scrollIntoView({ block: "nearest", inline: "nearest" });
                } catch (_) {}
              });
            }
          }
        }
      }
    }

    const bmGroup = document.getElementById("rm-bookmarks-group");
    if (bmGroup) {
      const hasPlayer = Boolean(s.is_player_open && s.active_item);
      bmGroup.classList.toggle("hidden", !hasPlayer);
      if (hasPlayer) {
        const chPill = document.getElementById("rm-active-chapter-pill");
        const actChapter = String(s.active_chapter || "").trim();
        if (chPill) {
          chPill.textContent = actChapter;
          chPill.classList.toggle("hidden", !actChapter);
          chPill.classList.toggle("is-rated", Boolean(actChapter));
        }

        const bms = Array.isArray(s.bookmarks) ? s.bookmarks : [];
        const chs = Array.isArray(s.chapters) ? s.chapters : [];
        const bmToggleBtn = document.getElementById("rm-btn-bookmark-toggle");
        const hasNearBookmark = bms.some((b) => Math.abs((Number(b.time) || 0) - interpCur) <= 2.5);
        if (bmToggleBtn) {
          bmToggleBtn.classList.toggle("active", hasNearBookmark);
          bmToggleBtn.setAttribute("aria-pressed", hasNearBookmark ? "true" : "false");
        }

        const listEl = document.getElementById("rm-bookmarks-list");
        if (listEl) {
          const combined = [
            ...chs.map((c) => ({
              rowType: "chapter",
              id: `ch_${c.time}_${c.label || ""}`,
              time: Math.max(0, Math.round(Number(c.time) || 0)),
              label: String(c.label || t("Глава", "Chapter")),
              note: "",
            })),
            ...bms.map((b) => ({
              rowType: "bookmark",
              id: String(b.id || `bm_${b.time}`),
              time: Math.max(0, Math.round(Number(b.time) || 0)),
              label: String(b.label || formatTime(b.time || 0)),
              note: String(b.note || ""),
            })),
          ].sort((a, b) => a.time - b.time);

          listEl.classList.toggle("hidden", combined.length === 0);
          const nextSig = `${state.appLang}:${combined.map((r) => `${r.id}:${r.time}:${r.label}:${r.note}`).join("|")}`;
          if (rState.bookmarksListSig !== nextSig) {
            rState.bookmarksListSig = nextSig;
            listEl.innerHTML = combined
              .map((row) => {
                const timeBadge = formatTime(row.time);
                if (row.rowType === "chapter") {
                  return `
                    <div class="atv-remote-bm-row is-chapter">
                      <button type="button" class="atv-remote-bm-jump" data-bm-seek="${row.time}">
                        <span class="atv-remote-bm-time">${escapeHtml(timeBadge)}</span>
                        <span class="atv-remote-bm-text">${escapeHtml(row.label)}</span>
                      </button>
                    </div>
                  `;
                }
                const displayNote = row.note || t("Закладка без заметки", "Bookmark without note");
                return `
                  <div class="atv-remote-bm-row is-bookmark">
                    <button type="button" class="atv-remote-bm-jump" data-bm-seek="${row.time}">
                      <span class="atv-remote-bm-time">${escapeHtml(timeBadge)}</span>
                      <span class="atv-remote-bm-text${row.note ? "" : " is-muted"}">${escapeHtml(displayNote)}</span>
                    </button>
                    <div class="atv-remote-bm-row-actions">
                      <button type="button" class="atv-remote-bm-icon-btn" data-bm-edit-time="${row.time}" data-bm-edit-note="${escapeAttr(row.note)}" aria-label="${escapeAttr(t("Изменить заметку", "Edit note"))}" title="${escapeAttr(t("Изменить заметку", "Edit note"))}">${iconSvg("edit", 13)}</button>
                      <button type="button" class="atv-remote-bm-icon-btn" data-bm-del-id="${escapeAttr(row.id)}" data-bm-del-time="${row.time}" aria-label="${escapeAttr(t("Удалить закладку", "Delete bookmark"))}" title="${escapeAttr(t("Удалить закладку", "Delete bookmark"))}">${iconSvg("x", 13)}</button>
                    </div>
                  </div>
                `;
              })
              .join("");
          }
        }
      }
    }

    const volPct = s.muted ? 0 : Math.round((Number(s.volume) || 0) * 100);
    const volSlider = document.getElementById("rm-vol-slider");
    const volVal = document.getElementById("rm-vol-val");
    const muteBtn = document.getElementById("rm-btn-mute");
    const dpadVolLbl = document.getElementById("rm-dpad-vol-lbl");
    const dpadMuteBtn = document.getElementById("rm-dpad-mute");
    if (volSlider && document.activeElement !== volSlider) {
      volSlider.value = String(volPct);
      updateRangeSliderFill(volSlider);
    }
    if (volVal) volVal.textContent = `${volPct}%`;
    if (dpadVolLbl) dpadVolLbl.textContent = s.muted ? t("Выкл", "Muted") : `${volPct}%`;
    if (dpadMuteBtn) dpadMuteBtn.classList.toggle("active", Boolean(s.muted));
    if (muteBtn) {
      const muteIcoKey = volPct === 0 ? "volMute" : volPct < 50 ? "volLow" : "volHigh";
      if (muteBtn.dataset.ico !== muteIcoKey) {
        muteBtn.dataset.ico = muteIcoKey;
        muteBtn.innerHTML = iconSvg(muteIcoKey, 16);
      }
    }

    const sourceTabsRow = document.getElementById("rm-source-tabs-row");
    if (sourceTabsRow) {
      const hasActiveTitle = Boolean(s.is_player_open && s.active_item);
      sourceTabsRow.classList.toggle("hidden", !hasActiveTitle);
      if (hasActiveTitle) {
        const curSrc = String(s.active_source_tab || "hdrezka").toLowerCase();
        sourceTabsRow.querySelectorAll("[data-source-tab]").forEach((btn) => {
          const isAct = btn.getAttribute("data-source-tab") === curSrc;
          btn.classList.toggle("active", isAct);
          btn.setAttribute("aria-checked", isAct ? "true" : "false");
        });
      }
    }

    const studioRow = document.getElementById("rm-studio-row");
    if (studioRow) {
      const hasSt = Array.isArray(s.studios) && s.studios.length > 0;
      studioRow.classList.toggle("hidden", !hasSt);
      if (hasSt) {
        const localizedStudios = s.studios.map((stIt) => ({
          ...stIt,
          label: translateStudioName(stIt.label || ""),
        }));
        syncSelectOptions(document.getElementById("rm-sel-studio"), localizedStudios, "id", "label", s.active_studio);

        const chipsWrap = document.getElementById("rm-studio-chips");
        const badgeEl = document.getElementById("rm-studio-active-badge");
        if (chipsWrap) {
          const stChipsSig = `${s.active_studio}:${localizedStudios.map((st) => `${st.id}:${st.label}`).join("|")}`;
          if (chipsWrap.dataset.sig !== stChipsSig) {
            chipsWrap.dataset.sig = stChipsSig;
            chipsWrap.innerHTML = localizedStudios
              .map((st) => {
                const isAct = String(st.id) === String(s.active_studio);
                return `<button type="button" role="radio" aria-checked="${isAct ? "true" : "false"}" class="atv-remote-chip ${isAct ? "active" : ""}" data-studio-id="${escapeAttr(st.id)}">${escapeHtml(st.label)}</button>`;
              })
              .join("");
          }
          const stAutoSig = `${s.active_studio}:${localizedStudios.length}`;
          if (rState.lastStudioAutoScrollSig !== stAutoSig) {
            rState.lastStudioAutoScrollSig = stAutoSig;
            const actChip = chipsWrap.querySelector(".atv-remote-chip.active");
            if (actChip && actChip.scrollIntoView) {
              requestAnimationFrame(() => {
                try {
                  actChip.scrollIntoView({ block: "nearest", inline: "center" });
                } catch (_) {}
              });
            }
          }
        }
        if (badgeEl) {
          const actObj = localizedStudios.find((st) => String(st.id) === String(s.active_studio));
          badgeEl.textContent = actObj ? actObj.label : "";
        }
      }
    }

    const qualRow = document.getElementById("rm-quality-row");
    if (qualRow) {
      const hasQ = Array.isArray(s.qualities) && s.qualities.length > 0;
      qualRow.classList.toggle("hidden", !hasQ);
      if (hasQ) {
        syncSelectOptions(document.getElementById("rm-sel-quality"), s.qualities, "id", "label", s.active_quality);
        const qChipsWrap = document.getElementById("rm-quality-chips");
        const qBadgeEl = document.getElementById("rm-quality-active-badge");
        if (qChipsWrap) {
          const qChipsSig = `${s.active_quality}:${s.qualities.map((q) => `${q.id}:${q.label}`).join("|")}`;
          if (qChipsWrap.dataset.sig !== qChipsSig) {
            qChipsWrap.dataset.sig = qChipsSig;
            qChipsWrap.innerHTML = s.qualities
              .map((q) => {
                const isAct = String(q.id) === String(s.active_quality);
                return `<button type="button" role="radio" aria-checked="${isAct ? "true" : "false"}" class="atv-remote-chip ${isAct ? "active" : ""}" data-quality-id="${escapeAttr(q.id)}">${escapeHtml(q.label)}</button>`;
              })
              .join("");
          }
        }
        if (qBadgeEl) {
          const actQ = s.qualities.find((q) => String(q.id) === String(s.active_quality));
          qBadgeEl.textContent = actQ ? actQ.label : "";
        }
      }
    }

    const subRow = document.getElementById("rm-sub-row");
    if (subRow) {
      const subsArr =
        Array.isArray(s.subtitles) && s.subtitles.length > 0
          ? s.subtitles.map((subIt) =>
              Number(subIt.index) === -1 &&
              (subIt.label === "Выключены" || subIt.label === "Off" || !subIt.label)
                ? { ...subIt, label: t("Выключены", "Off") }
                : subIt
            )
          : [{ index: -1, label: t("Выключены", "Off") }];
      syncSelectOptions(document.getElementById("rm-sel-sub"), subsArr, "index", "label", s.active_sub_idx);

      const subChipsWrap = document.getElementById("rm-sub-chips");
      const subBadgeEl = document.getElementById("rm-sub-active-badge");
      if (subChipsWrap) {
        const subChipsSig = `${s.active_sub_idx}:${subsArr.map((sub) => `${sub.index}:${sub.label}`).join("|")}`;
        if (subChipsWrap.dataset.sig !== subChipsSig) {
          subChipsWrap.dataset.sig = subChipsSig;
          subChipsWrap.innerHTML = subsArr
            .map((sub) => {
              const isAct = Number(sub.index) === Number(s.active_sub_idx);
              return `<button type="button" role="radio" aria-checked="${isAct ? "true" : "false"}" class="atv-remote-chip ${isAct ? "active" : ""}" data-sub-idx="${sub.index}">${escapeHtml(sub.label)}</button>`;
            })
            .join("");
        }
        const subAutoSig = `${s.active_sub_idx}:${subsArr.length}`;
        if (rState.lastSubAutoScrollSig !== subAutoSig) {
          rState.lastSubAutoScrollSig = subAutoSig;
          const actSubChip = subChipsWrap.querySelector(".atv-remote-chip.active");
          if (actSubChip && actSubChip.scrollIntoView) {
            requestAnimationFrame(() => {
              try {
                actSubChip.scrollIntoView({ block: "nearest", inline: "center" });
              } catch (_) {}
            });
          }
        }
      }
      if (subBadgeEl) {
        const actSub = subsArr.find((sub) => Number(sub.index) === Number(s.active_sub_idx));
        subBadgeEl.textContent = actSub ? actSub.label : "";
      }
    }
    const subValEl = document.getElementById("rm-sub-val");
    if (subValEl) {
      subValEl.textContent = formatSubtitleOffsetLabel(s.sub_offset_sec);
    }

    const rateNum = Math.round((Number(s.playback_rate) || 1) * 100) / 100;
    const activeRateStr = String(rateNum);
    const speedSel = document.getElementById("rm-sel-speed");
    const speedItems = [
      { id: "0.75", label: "0.75×", shortLabel: "0.75×" },
      { id: "1", label: t("1× (Обычная)", "1× (Normal)"), shortLabel: "1×" },
      { id: "1.25", label: "1.25×", shortLabel: "1.25×" },
      { id: "1.5", label: "1.5×", shortLabel: "1.5×" },
      { id: "2", label: "2×", shortLabel: "2×" },
    ];
    if (!speedItems.some((it) => it.id === activeRateStr)) {
      speedItems.push({ id: activeRateStr, label: `${activeRateStr}×`, shortLabel: `${activeRateStr}×` });
    }
    if (speedSel) {
      syncSelectOptions(speedSel, speedItems, "id", "label", activeRateStr);
    }
    const speedChipsWrap = document.getElementById("rm-speed-chips");
    const speedBadgeEl = document.getElementById("rm-speed-active-badge");
    if (speedChipsWrap) {
      const spChipsSig = `${activeRateStr}:${speedItems.map((sp) => sp.id).join(",")}`;
      if (speedChipsWrap.dataset.sig !== spChipsSig) {
        speedChipsWrap.dataset.sig = spChipsSig;
        speedChipsWrap.innerHTML = speedItems
          .map((sp) => {
            const isAct = sp.id === activeRateStr;
            return `<button type="button" role="radio" aria-checked="${isAct ? "true" : "false"}" class="atv-remote-chip ${isAct ? "active" : ""}" data-speed-rate="${escapeAttr(sp.id)}">${escapeHtml(sp.shortLabel || sp.label)}</button>`;
          })
          .join("");
      }
    }
    if (speedBadgeEl) {
      speedBadgeEl.textContent = `${activeRateStr}×`;
    }

    const sleepMode = String(s.sleep_timer_mode || "off");
    const sleepRemMin = Math.max(1, Math.ceil((Number(s.sleep_timer_rem_sec) || 0) / 60));
    const sleepItems = [
      { id: "off", label: t("Выключен", "Off"), shortLabel: t("Выкл", "Off") },
      {
        id: "15",
        label:
          sleepMode === "15" && s.sleep_timer_rem_sec > 0
            ? t(`15 минут (ост ${sleepRemMin} м)`, `15 min (${sleepRemMin}m left)`)
            : t("15 минут", "15 minutes"),
        shortLabel:
          sleepMode === "15" && s.sleep_timer_rem_sec > 0
            ? t(`15 м (${sleepRemMin} м)`, `15m (${sleepRemMin}m)`)
            : t("15 мин", "15 min"),
      },
      {
        id: "30",
        label:
          sleepMode === "30" && s.sleep_timer_rem_sec > 0
            ? t(`30 минут (ост ${sleepRemMin} м)`, `30 min (${sleepRemMin}m left)`)
            : t("30 минут", "30 minutes"),
        shortLabel:
          sleepMode === "30" && s.sleep_timer_rem_sec > 0
            ? t(`30 м (${sleepRemMin} м)`, `30m (${sleepRemMin}m)`)
            : t("30 мин", "30 min"),
      },
      {
        id: "60",
        label:
          sleepMode === "60" && s.sleep_timer_rem_sec > 0
            ? t(`60 минут (ост ${sleepRemMin} м)`, `60 min (${sleepRemMin}m left)`)
            : t("60 минут", "60 minutes"),
        shortLabel:
          sleepMode === "60" && s.sleep_timer_rem_sec > 0
            ? t(`60 м (${sleepRemMin} м)`, `60m (${sleepRemMin}m)`)
            : t("60 мин", "60 min"),
      },
    ];
    if (isSeries || sleepMode === "episode_end") {
      sleepItems.push({
        id: "episode_end",
        label: t("До конца серии", "End of episode"),
        shortLabel: t("Конец серии", "Episode end"),
      });
    }
    const sleepSel = document.getElementById("rm-sleep-row") ? document.getElementById("rm-sel-sleep") : null;
    if (sleepSel) {
      syncSelectOptions(sleepSel, sleepItems, "id", "label", sleepMode);
    }
    const sleepChipsWrap = document.getElementById("rm-sleep-chips");
    const sleepBadgeEl = document.getElementById("rm-sleep-active-badge");
    if (sleepChipsWrap) {
      const slChipsSig = `${sleepMode}:${sleepItems.map((sl) => `${sl.id}:${sl.shortLabel || sl.label}`).join("|")}`;
      if (sleepChipsWrap.dataset.sig !== slChipsSig) {
        sleepChipsWrap.dataset.sig = slChipsSig;
        sleepChipsWrap.innerHTML = sleepItems
          .map((sl) => {
            const isAct = sl.id === sleepMode;
            return `<button type="button" role="radio" aria-checked="${isAct ? "true" : "false"}" class="atv-remote-chip ${isAct ? "active" : ""}" data-sleep-mode="${escapeAttr(sl.id)}">${escapeHtml(sl.shortLabel || sl.label)}</button>`;
          })
          .join("");
      }
    }
    const actSleepObj = sleepItems.find((sl) => sl.id === sleepMode);
    if (sleepBadgeEl) {
      sleepBadgeEl.textContent = actSleepObj ? actSleepObj.label : t("Выключен", "Off");
    }

    const activePreset = String(s.audio_preset || "flat").toLowerCase();
    const activeBoost = Number(s.audio_boost) || 1;
    const activeCrop = String(s.video_crop || "contain").toLowerCase();
    const ambilightOn = s.ambilight_enabled !== false;
    const presetLabelsMap = {
      flat: t("Стандарт", "Standard"),
      voice: t("Чёткая речь", "Clear Voice"),
      night: t("Ночной", "Night"),
      cinema: t("Кинотеатр", "Cinema"),
    };
    const presetLabel = presetLabelsMap[activePreset] || presetLabelsMap.flat;
    const dspRenderSig = `${activePreset}|${activeBoost.toFixed(2)}|${activeCrop}|${ambilightOn ? 1 : 0}|${state.appLang || "ru"}`;
    if (rState.dspRenderSig !== dspRenderSig) {
      rState.dspRenderSig = dspRenderSig;
      document.querySelectorAll("#rm-audio-preset-chips [data-audio-preset]").forEach((btn) => {
        const match = btn.getAttribute("data-audio-preset") === activePreset;
        btn.classList.toggle("active", match);
        btn.setAttribute("aria-checked", match ? "true" : "false");
      });
      document.querySelectorAll("#rm-quick-dsp-row [data-quick-preset]").forEach((btn) => {
        const match = btn.getAttribute("data-quick-preset") === activePreset;
        btn.classList.toggle("active", match);
        btn.setAttribute("aria-pressed", match ? "true" : "false");
      });
      const quickBoostBtn = document.getElementById("rm-quick-boost-btn");
      if (quickBoostBtn) {
        const isBoostActive = activeBoost >= 1.45;
        quickBoostBtn.classList.toggle("active", isBoostActive);
        quickBoostBtn.setAttribute("aria-pressed", isBoostActive ? "true" : "false");
        quickBoostBtn.textContent = isBoostActive ? `Boost ${Math.round(activeBoost * 100)}%` : "Boost 200%";
      }
      document.querySelectorAll("#rm-audio-boost-chips [data-audio-boost]").forEach((btn) => {
        const bVal = parseFloat(btn.getAttribute("data-audio-boost") || "1");
        const match = Math.abs(bVal - activeBoost) < 0.08;
        btn.classList.toggle("active", match);
        btn.setAttribute("aria-checked", match ? "true" : "false");
      });
      const audioPresetBadge = document.getElementById("rm-audio-preset-badge");
      if (audioPresetBadge) {
        audioPresetBadge.textContent =
          activeBoost > 1.05 ? `${presetLabel} · ${Math.round(activeBoost * 100)}%` : presetLabel;
      }
      document.querySelectorAll("#rm-crop-chips [data-video-crop]").forEach((btn) => {
        const match = btn.getAttribute("data-video-crop") === activeCrop;
        btn.classList.toggle("active", match);
        btn.setAttribute("aria-pressed", match ? "true" : "false");
      });
      const ambilightBtn = document.getElementById("rm-btn-ambilight");
      if (ambilightBtn) {
        ambilightBtn.classList.toggle("active", ambilightOn);
        ambilightBtn.setAttribute("aria-pressed", ambilightOn ? "true" : "false");
      }
    }

    const tuningSummaryBadge = document.getElementById("rm-tuning-summary-badge");
    if (tuningSummaryBadge) {
      const parts = [`${activeRateStr}×`, presetLabel];
      if (activeBoost > 1.05) parts.push(`${Math.round(activeBoost * 100)}%`);
      if (sleepMode !== "off" && actSleepObj) parts.push(actSleepObj.shortLabel || actSleepObj.label);
      tuningSummaryBadge.textContent = parts.join(" · ");
    }

    const ratingGroup = document.getElementById("rm-rating-group");
    if (ratingGroup) {
      const hasActiveTitle = Boolean(s.is_player_open && s.active_item);
      ratingGroup.classList.toggle("hidden", !hasActiveTitle);
      if (hasActiveTitle) {
        const it = s.active_item;
        const isSeriesItem = it.media_type === "series";
        const effScope = isSeriesItem ? (rState.rateScope === "series" ? "series" : "episode") : "movie";
        const scopeRow = document.getElementById("rm-rate-scope-row");
        const epScopeBtn = document.getElementById("rm-rate-scope-ep");
        const serScopeBtn = document.getElementById("rm-rate-scope-series");
        const rateTitleEl = document.getElementById("rm-lbl-rate-title");
        const rateBadgeEl = document.getElementById("rm-rate-current-badge");
        const clearRateBtn = document.getElementById("rm-btn-clear-rate");
        const watchToggleBtn = document.getElementById("rm-btn-watch-toggle");

        if (scopeRow) scopeRow.classList.toggle("hidden", !isSeriesItem);
        if (isSeriesItem) {
          if (epScopeBtn) {
            epScopeBtn.textContent = t(
              `Эта серия (S${it.season || 1}E${it.episode || 1})`,
              `This Episode (S${it.season || 1}E${it.episode || 1})`
            );
            epScopeBtn.classList.toggle("active", effScope === "episode");
            epScopeBtn.setAttribute("aria-pressed", effScope === "episode" ? "true" : "false");
          }
          if (serScopeBtn) {
            serScopeBtn.textContent = t("Весь сериал", "Entire Series");
            serScopeBtn.classList.toggle("active", effScope === "series");
            serScopeBtn.setAttribute("aria-pressed", effScope === "series" ? "true" : "false");
          }
        }

        const activeScore =
          effScope === "episode" ? Number(it.episode_rating) || 0 : Number(it.user_rating) || 0;
        if (rateTitleEl) {
          rateTitleEl.textContent = isSeriesItem
            ? effScope === "episode"
              ? t("Оценка серии", "Episode Rating")
              : t("Оценка сериала", "Series Rating")
            : t("Оценка фильма", "Movie Rating");
        }
        if (rateBadgeEl) {
          rateBadgeEl.textContent =
            activeScore > 0 ? `${activeScore}/10` : t("Не оценено", "Not rated");
          rateBadgeEl.classList.toggle("is-rated", activeScore > 0);
        }
        if (clearRateBtn) {
          clearRateBtn.textContent = t("Сбросить", "Clear");
          clearRateBtn.classList.toggle("hidden", activeScore <= 0);
        }
        if (watchToggleBtn) {
          const isWatchedNow = isSeriesItem ? Boolean(it.episode_watched) : Boolean(it.watched);
          watchToggleBtn.classList.toggle("is-watched", isWatchedNow);
          watchToggleBtn.setAttribute("aria-pressed", isWatchedNow ? "true" : "false");
          watchToggleBtn.textContent = isWatchedNow
            ? t("Просмотрено", "Watched")
            : isSeriesItem
            ? t("Отметить серию", "Mark Episode")
            : t("Отметить фильм", "Mark Movie");
        }
        const rateRenderSig = `${activeScore}`;
        if (rState.rateRenderSig !== rateRenderSig) {
          rState.rateRenderSig = rateRenderSig;
          document.querySelectorAll("#rm-rate-stars-grid .atv-remote-rate-btn").forEach((btn) => {
            const sc = parseInt(btn.getAttribute("data-rscore") || "0", 10);
            const isExact = activeScore > 0 && sc === activeScore;
            btn.classList.toggle("active", isExact);
            btn.classList.toggle("in-range", activeScore > 0 && sc < activeScore);
            btn.setAttribute("aria-pressed", isExact ? "true" : "false");
          });
        }
      }
    }

    const syncTogglePressed = (id, active) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle("active", Boolean(active));
      el.setAttribute("aria-pressed", active ? "true" : "false");
    };
    syncTogglePressed("rm-btn-fs", s.desktop_mode === "fullscreen");
    syncTogglePressed("rm-btn-xray-pc", Boolean(s.xray_open));
    syncTogglePressed("rm-btn-pip", s.desktop_mode === "pip");
    syncTogglePressed("rm-btn-tvmode", Boolean(s.tv_mode));
    syncTogglePressed("rm-dpad-tvtoggle", Boolean(s.tv_mode));
    syncTogglePressed("rm-dpad-xray", Boolean(s.xray_open));
    syncTogglePressed("rm-dpad-fs", s.desktop_mode === "fullscreen");
    syncTogglePressed("rm-dpad-sub-cycle", Number(s.active_sub_idx) >= 0);

    const xrayBadgeEl = document.getElementById("rm-tab-xray-badge");
    if (xrayBadgeEl) {
      const xr = s.xray || {};
      const xrTotal =
        (Array.isArray(xr.cast) ? xr.cast.length : 0) +
        (Array.isArray(xr.soundtrack) ? xr.soundtrack.length : 0) +
        (Array.isArray(xr.trivia) ? xr.trivia.length : 0);
      const showXrBadge = Boolean(s.is_player_open && s.active_item && xrTotal > 0);
      xrayBadgeEl.classList.toggle("hidden", !showXrBadge);
      if (showXrBadge) xrayBadgeEl.textContent = String(xrTotal);
    }

    const miniBar = document.getElementById("rm-mini-transport");
    if (miniBar) {
      const activeTab = rState.activeTab || "player";
      const showMini = Boolean(s.is_player_open && s.active_item && activeTab !== "player");
      miniBar.classList.toggle("hidden", !showMini);
      shell.classList.toggle("has-mini-transport", showMini);
      if (showMini) {
        const it = s.active_item;
        const mTitle = document.getElementById("rm-mini-title");
        const mSub = document.getElementById("rm-mini-sub");
        const mPoster = document.getElementById("rm-mini-poster");
        const mPlayBtn = document.getElementById("rm-mini-play");
        const mProgFill = document.getElementById("rm-mini-progress-fill");
        if (mTitle) mTitle.textContent = it.title || it.orig_title || "";
        if (mSub) {
          const epTag = it.media_type === "series" && it.episode ? `S${it.season || 1}E${it.episode} · ` : "";
          const durSec = Math.max(0, Number(s.duration) || 0);
          mSub.textContent = `${epTag}${formatTime(interpCur)}${durSec > 0 ? ` / ${formatTime(durSec)}` : ""}`;
        }
        if (mPoster) {
          if (it.poster) {
            mPoster.classList.remove("hidden");
            if (mPoster.getAttribute("src") !== it.poster) mPoster.src = it.poster;
          } else {
            mPoster.classList.add("hidden");
          }
        }
        if (mPlayBtn) {
          const mPlayIcoKey = s.playing ? "pause" : "play";
          if (mPlayBtn.dataset.ico !== mPlayIcoKey) {
            mPlayBtn.dataset.ico = mPlayIcoKey;
            mPlayBtn.innerHTML = iconSvg(mPlayIcoKey, 15);
          }
          mPlayBtn.setAttribute("aria-label", s.playing ? t("Пауза", "Pause") : t("Пуск", "Play"));
        }
        if (mProgFill) {
          const durSec = Math.max(0, Number(s.duration) || 0);
          const pct = durSec > 0 ? Math.min(100, Math.max(0, (interpCur / durSec) * 100)) : 0;
          mProgFill.style.width = `${pct.toFixed(1)}%`;
        }
      }
    }

    if (rState.activeTab === "xray") {
      renderRemoteXRay();
    }
  };

  const stopRemoteTrackPreview = () => {
    if (rState.previewAudio) {
      try {
        rState.previewAudio.pause();
        rState.previewAudio.removeAttribute("src");
        rState.previewAudio.load();
      } catch (_) {}
      rState.previewAudio = null;
    }
    rState.previewTrackUrl = "";
    shell.querySelectorAll(".rm-preview-track").forEach((btn) => {
      btn.classList.remove("is-playing");
      const sp = btn.querySelector("span");
      if (sp) sp.textContent = t("Слушать", "Preview");
    });
  };

  const renderRemoteXRay = () => {
    const s = rState.snap;
    const it = s.active_item;
    const titleEl = document.getElementById("rm-xray-title");
    if (titleEl) {
      if (it && it.title) {
        titleEl.textContent =
          it.media_type === "series" && it.episode
            ? `${it.title} · S${it.season}E${it.episode}`
            : it.title;
      } else {
        titleEl.textContent = t("О фильме", "About Title");
      }
    }

    const castSec = document.getElementById("rm-xray-sec-cast");
    const ostSec = document.getElementById("rm-xray-sec-soundtrack");
    const triviaSec = document.getElementById("rm-xray-sec-trivia");
    if (!castSec || !ostSec || !triviaSec) return;

    const xray = s.xray || {};
    const cast = Array.isArray(xray.cast) ? xray.cast : [];
    const soundtrack = Array.isArray(xray.soundtrack) ? xray.soundtrack : [];
    const trivia = Array.isArray(xray.trivia) ? xray.trivia : [];

    const setXrayTabTxt = (id, baseRu, baseEn, count) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      const base = t(baseRu, baseEn);
      btn.textContent = s.is_player_open && it && count > 0 ? `${base} (${count})` : base;
    };
    setXrayTabTxt("rm-xray-tab-cast", "В кадре", "In Scene", cast.length);
    setXrayTabTxt("rm-xray-tab-soundtrack", "Музыка", "Music", soundtrack.length);
    setXrayTabTxt("rm-xray-tab-trivia", "Факты", "Trivia", trivia.length);

    const xrayRenderSig = `${state.appLang}|${Boolean(s.is_player_open && it)}|${it?.id || it?.title || ""}|${rState.previewTrackUrl || ""}|${cast.map((c) => `${c.name}:${c.in_scene ? 1 : 0}`).join(",")}|${soundtrack.map((tr) => `${tr.title}:${tr.in_scene ? 1 : 0}:${tr.scene_badge || ""}`).join(",")}|${trivia.length}`;
    if (rState.xrayDomSig === xrayRenderSig) {
      return;
    }
    rState.xrayDomSig = xrayRenderSig;

    if (!s.is_player_open || !it) {
      stopRemoteTrackPreview();
      const emptyHtml = `<div class="atv-remote-xray-empty">
        <div class="atv-remote-xray-empty-icon">${iconSvg("sparkles", 32)}</div>
        <div class="atv-remote-xray-empty-title">${escapeHtml(t("Плеер не активен", "Player is Idle"))}</div>
        <div class="atv-remote-xray-empty-sub">${escapeHtml(
          t(
            "Запустите фильм или сериал на компьютере, чтобы увидеть актёров в сцене, музыку и интересные факты.",
            "Play a movie or series on PC to see actors in scene, music, and trivia."
          )
        )}</div>
      </div>`;
      castSec.innerHTML = emptyHtml;
      ostSec.innerHTML = emptyHtml;
      triviaSec.innerHTML = emptyHtml;
      return;
    }

    // 1. Cast
    if (cast.length === 0) {
      castSec.innerHTML = `<div class="atv-remote-xray-empty">
        <div class="atv-remote-xray-empty-title">${escapeHtml(t("Список актёров загружается...", "Loading cast list..."))}</div>
      </div>`;
    } else {
      castSec.innerHTML = `<div class="atv-remote-cast-grid">
        ${cast
          .map((c) => {
            const photoSrc = c.photo || `/api/person-photo?name=${encodeURIComponent(c.name || "")}&strict=1&v=3`;
            const avatarHtml = `<img class="atv-remote-actor-avatar" src="${escapeAttr(photoSrc)}" alt="${escapeAttr(c.name)}" width="44" height="44" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;
            const inSceneBadge = c.in_scene
              ? `<span class="atv-xray-scene-pill">${escapeHtml(t("В этой сцене", "In Scene"))}</span>`
              : "";
            return `<button type="button" class="atv-remote-actor-card${c.in_scene ? " is-in-scene" : ""}" data-person-name="${escapeAttr(
              c.name
            )}" data-person-role="${escapeAttr(c.role || "")}" title="${escapeAttr(
              t("Открыть фильмографию на компьютере", "Open filmography on computer")
            )}">
              ${avatarHtml}
              <div class="atv-remote-actor-meta">
                <span class="atv-remote-actor-name">${escapeHtml(c.name)} ${inSceneBadge}</span>
                ${c.role ? `<span class="atv-remote-actor-role">${escapeHtml(c.role)}</span>` : ""}
              </div>
            </button>`;
          })
          .join("")}
      </div>`;
      castSec.querySelectorAll("img.atv-remote-actor-avatar").forEach((imgEl) => {
        imgEl.onerror = () => {
          imgEl.onerror = null;
          const cardEl = imgEl.closest(".atv-remote-actor-card");
          const nm = cardEl?.dataset?.personName || "";
          const initials =
            String(nm)
              .trim()
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase() || "")
              .join("") || "CF";
          const mono = document.createElement("span");
          mono.className = "atv-xray-actor-monogram";
          mono.setAttribute("aria-hidden", "true");
          mono.textContent = initials.slice(0, 2);
          imgEl.replaceWith(mono);
        };
      });
    }

    // 2. Soundtrack
    if (soundtrack.length === 0) {
      ostSec.innerHTML = `<div class="atv-remote-xray-empty">
        <div class="atv-remote-xray-empty-icon">${iconSvg("music", 28)}</div>
        <div class="atv-remote-xray-empty-title">${escapeHtml(t("Саундтреки для сцены", "Scene Soundtracks"))}</div>
        <div class="atv-remote-xray-empty-sub">${escapeHtml(
          t(
            "Музыкальные треки для этого релиза загружаются или отсутствуют.",
            "Soundtracks for this title are loading or not available."
          )
        )}</div>
      </div>`;
    } else {
      ostSec.innerHTML = `<div class="atv-remote-ost-list">
        ${soundtrack
          .map((tr) => {
            const trackQuery = encodeURIComponent(`${tr.artist || ""} ${tr.title || ""}`.trim());
            const appleMusicUrl = `https://music.apple.com/search?term=${trackQuery}`;
            const spotifyUrl = `https://open.spotify.com/search/${trackQuery}`;
            const previewUrl = String(tr.preview_url || "").trim();
            const artworkUrl = String(tr.artwork_url || "").trim();
            const isPreviewPlaying = Boolean(previewUrl && rState.previewTrackUrl === previewUrl);
            const previewBtnHtml = previewUrl
              ? `<button type="button" class="atv-remote-track-btn rm-preview-track${isPreviewPlaying ? " is-playing" : ""}" data-preview-url="${escapeAttr(previewUrl)}" title="${escapeAttr(t("Прослушать отрывок", "Play 30s preview"))}">
                  ${iconSvg(isPreviewPlaying ? "pause" : "play", 13)}<span>${isPreviewPlaying ? t("Стоп", "Stop") : t("Слушать", "Preview")}</span>
                </button>`
              : "";
            const coverHtml = artworkUrl
              ? `<img class="atv-remote-track-cover" src="${escapeAttr(artworkUrl)}" alt="" loading="lazy" />`
              : `<div class="atv-remote-track-cover is-placeholder">${iconSvg("music", 15)}</div>`;
            const scenePillHtml = tr.in_scene
              ? `<span class="atv-xray-scene-pill">${escapeHtml(tr.scene_badge || t("В этой сцене", "In Scene"))}</span>`
              : "";
            return `<div class="atv-remote-track-card${tr.in_scene ? " is-in-scene" : ""}" data-track-title="${escapeAttr(tr.title)}" data-track-artist="${escapeAttr(tr.artist)}">
              <div class="atv-remote-track-top">
                ${coverHtml}
                <div class="atv-remote-track-info">
                  <div class="atv-remote-track-head">
                    <span class="atv-remote-track-name">${escapeHtml(tr.title)}</span>
                    ${scenePillHtml}
                    ${tr.scene ? `<span class="atv-remote-track-scene">${escapeHtml(tr.scene)}</span>` : ""}
                  </div>
                  <div class="atv-remote-track-artist">${escapeHtml(tr.artist || t("Неизвестный исполнитель", "Unknown Artist"))}</div>
                </div>
              </div>
              <div class="atv-remote-track-actions">
                ${previewBtnHtml}
                <button type="button" class="atv-remote-track-btn rm-copy-track" title="${escapeAttr(t("Скопировать название", "Copy title"))}" aria-label="${escapeAttr(t("Скопировать", "Copy"))}">
                  ${iconSvg("copy", 14)}<span>${t("Копировать", "Copy")}</span>
                </button>
                <a href="${appleMusicUrl}" target="_blank" rel="noopener noreferrer" class="atv-remote-track-btn" title="Apple Music">
                  ${iconSvg("music", 14)}<span>Apple</span>
                </a>
                <a href="${spotifyUrl}" target="_blank" rel="noopener noreferrer" class="atv-remote-track-btn" title="Spotify">
                  ${iconSvg("external", 14)}<span>Spotify</span>
                </a>
              </div>
            </div>`;
          })
          .join("")}
      </div>`;
    }

    // 3. Trivia
    if (trivia.length === 0) {
      triviaSec.innerHTML = `<div class="atv-remote-xray-empty">
        <div class="atv-remote-xray-empty-icon">${iconSvg("info", 28)}</div>
        <div class="atv-remote-xray-empty-title">${escapeHtml(t("Факты и пасхалки", "Trivia & Easter Eggs"))}</div>
        <div class="atv-remote-xray-empty-sub">${escapeHtml(
          t(
            "Интересные факты о съёмках и скрытые пасхалки загружаются.",
            "Behind-the-scenes trivia and easter eggs are loading."
          )
        )}</div>
      </div>`;
    } else {
      triviaSec.innerHTML = `<div class="atv-remote-trivia-list">
        ${trivia
          .map(
            (fc) => `
            <div class="atv-remote-trivia-card">
              <div class="atv-remote-trivia-badge">${escapeHtml(fc.badge || t("Интересный факт", "Trivia"))}</div>
              <p class="atv-remote-trivia-text">${escapeHtml(fc.text)}</p>
            </div>
          `
          )
          .join("")}
      </div>`;
    }
  };

  const renderRemoteCatalog = () => {
    const box = document.getElementById("rm-catalog-results");
    if (!box) return;
    const cwIds = new Set(
      (rState.catalogCW || []).map((it) => `${it.id || ""}:${displayTitle(it) || it.title || ""}`)
    );
    let rawList = [];
    if (rState.searchQuery) {
      rawList = rState.searchResults || [];
    } else if (rState.catalogFilter === "cw") {
      rawList = [...rState.catalogCW];
    } else {
      rawList = [...rState.catalogCW, ...rState.catalogItems];
    }
    const list = rawList.filter((it) => {
      if (rState.catalogFilter === "movie") return it.media_type !== "series";
      if (rState.catalogFilter === "series") return it.media_type === "series";
      return true;
    });
    if (!list.length) {
      box.innerHTML = `<div class="atv-remote-empty-sub">${escapeHtml(
        rState.catalogLoaded
          ? t("Ничего не найдено", "No titles found")
          : t("Загрузка каталога...", "Loading catalog...")
      )}</div>`;
      return;
    }
    box.innerHTML = "";
    const seen = new Set();
    list.forEach((it) => {
      const itemTitle = displayTitle(it) || it.title || it.orig_title || t("Без названия", "Untitled");
      const itemPoster = displayPoster(it) || it.poster || it.backdrop || "";
      const key = `${it.id || ""}:${itemTitle}:${it.season || 1}:${it.episode || 1}`;
      if (seen.has(key)) return;
      seen.add(key);
      const isCwItem = Boolean(it.current_time > 10 || cwIds.has(`${it.id || ""}:${itemTitle}`));
      const card = document.createElement("button");
      card.type = "button";
      card.className = "atv-remote-cat-row";
      const epInfo =
        it.media_type === "series" && (it.season > 1 || it.episode > 1 || it.current_time > 0)
          ? ` · S${it.season || 1}E${it.episode || 1}`
          : "";
      const resumeMeta = it.current_time > 10 ? ` · ${formatTime(it.current_time)}` : "";
      const cwBadgeHtml = isCwItem
        ? `<span class="atv-remote-cat-cw-pill">${escapeHtml(t("Продолжить", "Resume"))}</span>`
        : "";
      card.innerHTML = `
        <img class="atv-remote-cat-poster" src="${escapeAttr(itemPoster)}" alt="" loading="lazy" referrerpolicy="no-referrer" />
        <div class="atv-remote-cat-info">
          <div class="atv-remote-cat-title-row">
            <div class="atv-remote-cat-title">${escapeHtml(itemTitle)}</div>
            ${cwBadgeHtml}
          </div>
          <div class="atv-remote-cat-sub">${escapeHtml(
            [
              it.year || "",
              it.media_type === "series" ? t("Сериал", "Series") : t("Фильм", "Movie"),
            ]
              .filter(Boolean)
              .join(" · ") +
              epInfo +
              resumeMeta
          )}</div>
        </div>
        <span class="atv-remote-cat-play">${iconSvg("play", 13)}</span>
      `;
      attachSmartPosterFallback(card.querySelector(".atv-remote-cat-poster"), itemTitle, it.year || "", it.poster || itemPoster);
      card.onclick = () => {
        sendCmd("play_item", {
          item: it,
          season: it.season || 1,
          episode: it.episode || 1,
          resume_time: it.current_time || 0,
        });
        switchTab("player");
      };
      box.appendChild(card);
    });
  };

  let catalogReqSeq = 0;
  const loadRemoteCatalog = async (q = "") => {
    const reqSeq = ++catalogReqSeq;
    try {
      const params = new URLSearchParams({
        k: pairKey,
        lang: state.appLang || "ru",
      });
      if (q) params.set("q", q);
      const res = await fetch(`/api/remote/catalog?${params.toString()}`);
      if (!res.ok || reqSeq !== catalogReqSeq) return;
      const data = await res.json();
      if (reqSeq !== catalogReqSeq) return;
      rState.catalogLoaded = true;
      if (q) {
        rState.searchResults = Array.isArray(data.items) ? data.items : [];
      } else {
        rState.catalogCW = Array.isArray(data.continue_watching) ? data.continue_watching : [];
        rState.catalogItems = Array.isArray(data.items) ? data.items : [];
      }
      renderRemoteCatalog();
      renderIdleContinueWatching();
    } catch (err) { window.logDebug?.("Remote", err); }
  };

  const switchTab = (tabName) => {
    rState.activeTab = tabName;
    if (tabName !== "xray") {
      stopRemoteTrackPreview();
    }
    shell.querySelectorAll(".atv-remote-tab").forEach((b) => {
      const isSelected = b.dataset.rtab === tabName;
      b.classList.toggle("active", isSelected);
      b.setAttribute("aria-selected", isSelected ? "true" : "false");
    });
    document.getElementById("rm-pane-player")?.classList.toggle("hidden", tabName !== "player");
    document.getElementById("rm-pane-xray")?.classList.toggle("hidden", tabName !== "xray");
    document.getElementById("rm-pane-dpad")?.classList.toggle("hidden", tabName !== "dpad");
    document.getElementById("rm-pane-catalog")?.classList.toggle("hidden", tabName !== "catalog");
    if (tabName === "catalog" && !rState.catalogLoaded) {
      loadRemoteCatalog("");
    }
    if (tabName === "xray") {
      renderRemoteXRay();
    }
    renderRemoteUI();
  };

  const switchXraySubtab = (subtabName) => {
    rState.activeXrayTab = subtabName;
    if (subtabName !== "soundtrack") {
      stopRemoteTrackPreview();
    }
    shell.querySelectorAll(".atv-remote-xray-tab").forEach((b) => {
      const isSelected = b.dataset.rxrayTab === subtabName;
      b.classList.toggle("active", isSelected);
      b.setAttribute("aria-selected", isSelected ? "true" : "false");
    });
    document.getElementById("rm-xray-sec-cast")?.classList.toggle("hidden", subtabName !== "cast");
    document.getElementById("rm-xray-sec-soundtrack")?.classList.toggle("hidden", subtabName !== "soundtrack");
    document.getElementById("rm-xray-sec-trivia")?.classList.toggle("hidden", subtabName !== "trivia");
  };

  shell.querySelectorAll(".atv-remote-xray-tab").forEach((b) => {
    b.addEventListener("click", () => switchXraySubtab(b.dataset.rxrayTab || "cast"));
  });

  shell.querySelectorAll(".atv-remote-tab").forEach((b) => {
    b.addEventListener("click", () => switchTab(b.dataset.rtab || "player"));
  });

  document.getElementById("rm-btn-idle-browse")?.addEventListener("click", () => {
    switchTab("catalog");
    setTimeout(() => {
      try {
        document.getElementById("rm-catalog-search")?.focus();
      } catch (_) {}
    }, 60);
  });

  document.getElementById("rm-time-dur")?.addEventListener("click", () => {
    rState.showRemainingTime = !rState.showRemainingTime;
    renderRemoteUI();
  });

  const applyOptimisticSeek = (deltaSec) => {
    if (!rState.snap.is_player_open) return;
    const dur = Math.max(0, Number(rState.snap.duration) || 0);
    const cur = getInterpolatedTime();
    const nextSec = dur > 0 ? Math.min(dur, Math.max(0, cur + deltaSec)) : Math.max(0, cur + deltaSec);
    rState.snap.current_time = nextSec;
    rState.lastSyncPerfMs = performance.now();
    renderRemoteUI();
  };

  document.getElementById("rm-btn-play")?.addEventListener("click", () => {
    if (rState.snap.is_player_open) {
      rState.snap.current_time = getInterpolatedTime();
      rState.snap.playing = !rState.snap.playing;
      rState.lastSyncPerfMs = performance.now();
      renderRemoteUI();
    }
    sendCmd("toggle_play");
  });
  document.getElementById("rm-btn-back30")?.addEventListener("click", () => {
    applyOptimisticSeek(-30);
    sendCmd("seek_rel", { delta: -30 });
  });
  document.getElementById("rm-btn-back10")?.addEventListener("click", () => {
    applyOptimisticSeek(-10);
    sendCmd("seek_rel", { delta: -10 });
  });
  document.getElementById("rm-btn-fwd10")?.addEventListener("click", () => {
    applyOptimisticSeek(10);
    sendCmd("seek_rel", { delta: 10 });
  });
  document.getElementById("rm-btn-fwd30")?.addEventListener("click", () => {
    applyOptimisticSeek(30);
    sendCmd("seek_rel", { delta: 30 });
  });
  document.getElementById("rm-btn-prev-ep")?.addEventListener("click", () => sendCmd("prev_ep"));
  document.getElementById("rm-btn-next-ep")?.addEventListener("click", () => sendCmd("next_ep"));
  document.getElementById("rm-btn-skip-intro")?.addEventListener("click", () => sendCmd("skip_intro"));
  document.getElementById("rm-btn-close-pc-player")?.addEventListener("click", () => sendCmd("close_player"));

  document.getElementById("rm-btn-prev-marker")?.addEventListener("click", () => {
    sendCmd("jump_marker", { direction: -1 });
  });
  document.getElementById("rm-btn-next-marker")?.addEventListener("click", () => {
    sendCmd("jump_marker", { direction: 1 });
  });
  document.getElementById("rm-btn-bookmark-toggle")?.addEventListener("click", () => {
    sendCmd("toggle_bookmark");
  });

  const noteFormEl = document.getElementById("rm-bookmark-note-form");
  const noteInputEl = document.getElementById("rm-bookmark-note-input");
  const openNoteEditor = (targetTime = null, initialNote = "") => {
    if (!noteFormEl || !noteInputEl) return;
    const effTime =
      targetTime !== null && Number.isFinite(Number(targetTime))
        ? Math.max(0, Math.round(Number(targetTime)))
        : Math.max(0, Math.round(getInterpolatedTime()));
    rState.editingBookmarkTime = effTime;
    noteInputEl.value = String(initialNote || "");
    noteFormEl.classList.remove("hidden");
    try {
      noteInputEl.focus();
    } catch (err) { window.logDebug?.("Remote", err); }
  };
  const closeNoteEditor = () => {
    rState.editingBookmarkTime = null;
    if (noteInputEl) noteInputEl.value = "";
    noteFormEl?.classList.add("hidden");
  };
  const submitBookmarkNote = () => {
    if (!noteInputEl) return;
    const noteText = String(noteInputEl.value || "").trim();
    const targetTime =
      rState.editingBookmarkTime !== null
        ? rState.editingBookmarkTime
        : Math.max(0, Math.round(getInterpolatedTime()));
    sendCmd("add_bookmark_note", { time: targetTime, note: noteText });
    closeNoteEditor();
  };

  document.getElementById("rm-btn-bookmark-note-open")?.addEventListener("click", () => {
    if (noteFormEl && !noteFormEl.classList.contains("hidden")) {
      closeNoteEditor();
    } else {
      const curSec = Math.max(0, Math.round(getInterpolatedTime()));
      const existing = (Array.isArray(rState.snap.bookmarks) ? rState.snap.bookmarks : []).find(
        (b) => Math.abs((Number(b.time) || 0) - curSec) <= 2
      );
      openNoteEditor(existing ? existing.time : curSec, existing?.note || "");
    }
  });
  document.getElementById("rm-btn-bookmark-note-save")?.addEventListener("click", submitBookmarkNote);
  document.getElementById("rm-btn-bookmark-note-cancel")?.addEventListener("click", closeNoteEditor);
  noteInputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitBookmarkNote();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeNoteEditor();
    }
  });

  document.getElementById("rm-bookmarks-list")?.addEventListener("click", (e) => {
    const target = e.target;
    if (!target || !target.closest) return;
    const seekBtn = target.closest("[data-bm-seek]");
    if (seekBtn) {
      const sec = Math.max(0, Number(seekBtn.getAttribute("data-bm-seek")) || 0);
      sendCmd("seek_to", { time: sec });
      return;
    }
    const editBtn = target.closest("[data-bm-edit-time]");
    if (editBtn) {
      const sec = Math.max(0, Number(editBtn.getAttribute("data-bm-edit-time")) || 0);
      const note = editBtn.getAttribute("data-bm-edit-note") || "";
      openNoteEditor(sec, note);
      return;
    }
    const delBtn = target.closest("[data-bm-del-id]");
    if (delBtn) {
      const id = delBtn.getAttribute("data-bm-del-id") || "";
      const sec = Math.max(0, Number(delBtn.getAttribute("data-bm-del-time")) || 0);
      sendCmd("delete_bookmark", { id, time: sec });
    }
  });

  const scrubberEl = document.getElementById("rm-scrubber");
  if (scrubberEl) {
    scrubberEl.addEventListener("input", () => {
      rState.scrubbing = true;
      updateRangeSliderFill(scrubberEl);
      const dur = Math.max(0, Number(rState.snap.duration) || 0);
      const target = (Number(scrubberEl.value) / 1000) * dur;
      const curEl = document.getElementById("rm-time-cur");
      if (curEl) curEl.textContent = formatTime(target);
      const chEl = document.getElementById("rm-time-chapter");
      if (chEl && dur > 0) {
        const diff = Math.round(target - getInterpolatedTime());
        const diffTxt = diff === 0 ? "" : `${diff > 0 ? "+" : "−"}${formatTime(Math.abs(diff))}`;
        const chs = Array.isArray(rState.snap.chapters) ? rState.snap.chapters : [];
        let targetChapter = "";
        for (let i = chs.length - 1; i >= 0; i -= 1) {
          const ct = Number(chs[i]?.time) || 0;
          if (target >= ct) {
            targetChapter = String(chs[i]?.label || "").trim();
            break;
          }
        }
        chEl.classList.add("is-scrubbing");
        chEl.textContent = [targetChapter, diffTxt].filter(Boolean).join(" · ");
      }
    });
    scrubberEl.addEventListener("change", () => {
      const dur = Math.max(0, Number(rState.snap.duration) || 0);
      const target = (Number(scrubberEl.value) / 1000) * dur;
      rState.scrubbing = false;
      document.getElementById("rm-time-chapter")?.classList.remove("is-scrubbing");
      updateRangeSliderFill(scrubberEl);
      sendCmd("seek_to", { time: Math.round(target * 10) / 10 });
    });
    const cancelScrubbing = () => {
      if (!rState.scrubbing) return;
      rState.scrubbing = false;
      document.getElementById("rm-time-chapter")?.classList.remove("is-scrubbing");
    };
    scrubberEl.addEventListener("pointercancel", cancelScrubbing);
    scrubberEl.addEventListener("touchcancel", cancelScrubbing);
    scrubberEl.addEventListener("blur", cancelScrubbing);
  }

  document.getElementById("rm-now-card")?.addEventListener("click", (e) => {
    if (!rState.snap?.is_player_open || !rState.snap?.active_item) return;
    if (e.target.closest("button, input, select, a, label")) return;
    switchTab("xray");
  });

  document.getElementById("rm-quick-dsp-row")?.addEventListener("click", (e) => {
    const presetBtn = e.target.closest("[data-quick-preset]");
    if (presetBtn) {
      const preset = String(presetBtn.getAttribute("data-quick-preset") || "flat");
      rState.snap.audio_preset = preset;
      renderRemoteUI();
      sendCmd("set_audio_preset", { preset });
      return;
    }
    const boostBtn = e.target.closest("#rm-quick-boost-btn");
    if (boostBtn) {
      const curBoost = Number(rState.snap.audio_boost) || 1;
      const nextBoost = curBoost >= 1.45 ? 1 : 2;
      rState.snap.audio_boost = nextBoost;
      renderRemoteUI();
      sendCmd("set_audio_preset", { boost: nextBoost });
    }
  });

  let volTimer = null;
  const volSliderEl = document.getElementById("rm-vol-slider");
  if (volSliderEl) {
    volSliderEl.addEventListener("input", () => {
      updateRangeSliderFill(volSliderEl);
      const pct = Number(volSliderEl.value) || 0;
      const valEl = document.getElementById("rm-vol-val");
      if (valEl) valEl.textContent = `${pct}%`;
      if (volTimer) clearTimeout(volTimer);
      volTimer = setTimeout(() => {
        sendCmd("set_volume", { volume: pct / 100 });
      }, 90);
    });
  }
  document.getElementById("rm-btn-mute")?.addEventListener("click", () => {
    rState.snap.muted = !rState.snap.muted;
    renderRemoteUI();
    sendCmd("toggle_mute");
  });
  const stepPlayerVolume = (deltaVol) => {
    const curVol = Number.isFinite(Number(rState.snap.volume)) ? Number(rState.snap.volume) : 1;
    const nextVol = Math.max(0, Math.min(1, Math.round((curVol + deltaVol) * 100) / 100));
    rState.snap.volume = nextVol;
    rState.snap.muted = nextVol <= 0.005;
    renderRemoteUI();
    sendCmd("set_volume", { volume: nextVol });
  };
  document.getElementById("rm-btn-vol-down")?.addEventListener("click", () => stepPlayerVolume(-0.1));
  document.getElementById("rm-btn-vol-up")?.addEventListener("click", () => stepPlayerVolume(0.1));

  document.getElementById("rm-source-seg")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-source-tab]");
    if (!btn) return;
    const tabKey = String(btn.getAttribute("data-source-tab") || "").trim().toLowerCase();
    if (!tabKey) return;
    rState.snap.active_source_tab = tabKey;
    renderRemoteUI();
    sendCmd("set_source_tab", { tab: tabKey });
  });

  document.getElementById("rm-sel-studio")?.addEventListener("change", (e) => {
    sendCmd("set_studio", { id: e.target.value });
  });
  document.getElementById("rm-studio-chips")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-studio-id]");
    if (!chip) return;
    const stId = chip.getAttribute("data-studio-id") || "";
    rState.snap.active_studio = stId;
    const sel = document.getElementById("rm-sel-studio");
    if (sel) sel.value = stId;
    document.querySelectorAll("#rm-studio-chips .atv-remote-chip").forEach((c) => {
      const match = c.getAttribute("data-studio-id") === stId;
      c.classList.toggle("active", match);
      c.setAttribute("aria-checked", match ? "true" : "false");
    });
    const badgeEl = document.getElementById("rm-studio-active-badge");
    if (badgeEl) badgeEl.textContent = chip.textContent.trim();
    sendCmd("set_studio", { id: stId });
  });

  document.getElementById("rm-sel-quality")?.addEventListener("change", (e) => {
    sendCmd("set_quality", { id: e.target.value });
  });
  document.getElementById("rm-quality-chips")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-quality-id]");
    if (!chip) return;
    const qId = chip.getAttribute("data-quality-id") || "";
    rState.snap.active_quality = qId;
    const sel = document.getElementById("rm-sel-quality");
    if (sel) sel.value = qId;
    document.querySelectorAll("#rm-quality-chips .atv-remote-chip").forEach((c) => {
      const match = c.getAttribute("data-quality-id") === qId;
      c.classList.toggle("active", match);
      c.setAttribute("aria-checked", match ? "true" : "false");
    });
    const badgeEl = document.getElementById("rm-quality-active-badge");
    if (badgeEl) badgeEl.textContent = chip.textContent.trim();
    sendCmd("set_quality", { id: qId });
  });
  document.getElementById("rm-sel-sub")?.addEventListener("change", (e) => {
    sendCmd("set_subtitle", { index: parseInt(e.target.value, 10) });
  });
  document.getElementById("rm-sub-chips")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-sub-idx]");
    if (!chip) return;
    const sIdx = parseInt(chip.getAttribute("data-sub-idx"), 10);
    rState.snap.active_sub_idx = sIdx;
    const subSel = document.getElementById("rm-sel-sub");
    if (subSel) subSel.value = String(sIdx);
    document.querySelectorAll("#rm-sub-chips .atv-remote-chip").forEach((c) => {
      const match = parseInt(c.getAttribute("data-sub-idx"), 10) === sIdx;
      c.classList.toggle("active", match);
      c.setAttribute("aria-checked", match ? "true" : "false");
    });
    const badgeEl = document.getElementById("rm-sub-active-badge");
    if (badgeEl) badgeEl.textContent = chip.textContent.trim();
    sendCmd("set_subtitle", { index: sIdx });
  });
  document.getElementById("rm-xray-sec-cast")?.addEventListener("click", (e) => {
    const card = e.target.closest("[data-person-name]");
    if (!card) return;
    const personName = String(card.getAttribute("data-person-name") || "").trim();
    const personRole = String(card.getAttribute("data-person-role") || "").trim();
    if (!personName) return;
    sendCmd("open_person", { name: personName, role: personRole });
    const roleEl = card.querySelector(".atv-remote-actor-role");
    if (roleEl) {
      const prevTxt = roleEl.textContent;
      roleEl.textContent = t("Открыто на ПК", "Opened on PC");
      setTimeout(() => {
        roleEl.textContent = prevTxt;
      }, 1600);
    }
  });
  document.getElementById("rm-xray-sec-soundtrack")?.addEventListener("click", async (e) => {
    const previewBtn = e.target.closest(".rm-preview-track");
    if (previewBtn) {
      const url = String(previewBtn.getAttribute("data-preview-url") || "").trim();
      if (!url) return;
      if (rState.previewTrackUrl === url && rState.previewAudio) {
        stopRemoteTrackPreview();
        return;
      }
      stopRemoteTrackPreview();
      try {
        const audio = new Audio(url);
        audio.volume = 0.85;
        rState.previewAudio = audio;
        rState.previewTrackUrl = url;
        previewBtn.classList.add("is-playing");
        const sp = previewBtn.querySelector("span");
        if (sp) sp.textContent = t("Стоп", "Stop");
        audio.addEventListener("ended", () => stopRemoteTrackPreview());
        audio.addEventListener("error", () => stopRemoteTrackPreview());
        await audio.play();
      } catch (_) {
        stopRemoteTrackPreview();
      }
      return;
    }

    const copyBtn = e.target.closest(".rm-copy-track");
    if (!copyBtn) return;
    const card = copyBtn.closest(".atv-remote-track-card");
    if (!card) return;
    const trackTitle = card.getAttribute("data-track-title") || "";
    const trackArtist = card.getAttribute("data-track-artist") || "";
    const copyText = trackArtist ? `${trackArtist} — ${trackTitle}` : trackTitle;
    try {
      const ok = await copyTextToClipboard(copyText);
      if (ok) {
        const span = copyBtn.querySelector("span");
        if (span) {
          const orig = span.textContent;
          span.textContent = t("Скопировано!", "Copied!");
          setTimeout(() => {
            span.textContent = orig;
          }, 1800);
        }
      }
    } catch (_) {
      // Fallback
    }
  });
  document.getElementById("rm-sub-minus")?.addEventListener("click", () => sendCmd("sub_offset", { delta: -0.25 }));
  document.getElementById("rm-sub-val")?.addEventListener("click", () => sendCmd("sub_offset", { reset: true }));
  document.getElementById("rm-sub-plus")?.addEventListener("click", () => sendCmd("sub_offset", { delta: 0.25 }));

  document.getElementById("rm-sel-season")?.addEventListener("change", (e) => {
    const sNum = Math.max(1, parseInt(e.target.value, 10) || 1);
    rState.previewSeason = sNum;
    renderRemoteUI();
  });
  document.getElementById("rm-ep-grid")?.addEventListener("click", (e) => {
    const target = e.target;
    if (!target || !target.closest) return;
    const epBtn = target.closest("[data-rm-ep]");
    if (!epBtn) return;
    const eNum = Math.max(1, parseInt(epBtn.getAttribute("data-rm-ep") || "1", 10) || 1);
    const sNum = Math.max(1, parseInt(rState.previewSeason, 10) || parseInt(rState.snap.active_item?.season, 10) || 1);
    sendCmd("select_episode", { season: sNum, episode: eNum });
  });
  document.getElementById("rm-sel-speed")?.addEventListener("change", (e) => {
    const rate = parseFloat(e.target.value);
    if (Number.isFinite(rate) && rate >= 0.25 && rate <= 4) {
      rState.snap.playback_rate = rate;
      renderRemoteUI();
      sendCmd("set_playback_rate", { rate });
    }
  });
  document.getElementById("rm-speed-chips")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-speed-rate]");
    if (!chip) return;
    const rate = parseFloat(chip.getAttribute("data-speed-rate") || "1");
    if (!Number.isFinite(rate) || rate < 0.25 || rate > 4) return;
    rState.snap.playback_rate = rate;
    renderRemoteUI();
    sendCmd("set_playback_rate", { rate });
  });
  document.getElementById("rm-sel-sleep")?.addEventListener("change", (e) => {
    const mode = String(e.target.value || "off");
    rState.snap.sleep_timer_mode = mode;
    renderRemoteUI();
    sendCmd("set_sleep_timer", { mode });
  });
  document.getElementById("rm-sleep-chips")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-sleep-mode]");
    if (!chip) return;
    const mode = String(chip.getAttribute("data-sleep-mode") || "off");
    rState.snap.sleep_timer_mode = mode;
    renderRemoteUI();
    sendCmd("set_sleep_timer", { mode });
  });
  document.getElementById("rm-audio-preset-chips")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-audio-preset]");
    if (!chip) return;
    const preset = String(chip.getAttribute("data-audio-preset") || "flat");
    rState.snap.audio_preset = preset;
    renderRemoteUI();
    sendCmd("set_audio_preset", { preset });
  });
  document.getElementById("rm-audio-boost-chips")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-audio-boost]");
    if (!chip) return;
    const boost = parseFloat(chip.getAttribute("data-audio-boost") || "1");
    if (!Number.isFinite(boost)) return;
    rState.snap.audio_boost = boost;
    renderRemoteUI();
    sendCmd("set_audio_preset", { boost });
  });
  document.getElementById("rm-crop-chips")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-video-crop]");
    if (!chip) return;
    const crop = String(chip.getAttribute("data-video-crop") || "contain");
    rState.snap.video_crop = crop;
    renderRemoteUI();
    sendCmd("set_video_crop", { crop });
  });
  document.getElementById("rm-btn-ambilight")?.addEventListener("click", () => {
    rState.snap.ambilight_enabled = rState.snap.ambilight_enabled === false;
    renderRemoteUI();
    sendCmd("toggle_ambilight");
  });

  document.getElementById("rm-rate-scope-ep")?.addEventListener("click", () => {
    rState.rateScope = "episode";
    renderRemoteUI();
  });
  document.getElementById("rm-rate-scope-series")?.addEventListener("click", () => {
    rState.rateScope = "series";
    renderRemoteUI();
  });
  document.querySelectorAll("#rm-rate-stars-grid .atv-remote-rate-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const score = parseInt(btn.getAttribute("data-rscore") || "0", 10);
      if (score <= 0 || !rState.snap.active_item) return;
      const it = rState.snap.active_item;
      const scope = it.media_type === "series" ? (rState.rateScope === "series" ? "series" : "episode") : "movie";
      if (scope === "episode") {
        it.episode_rating = score;
        it.episode_watched = true;
      } else {
        it.user_rating = score;
        if (it.media_type !== "series") it.watched = true;
      }
      renderRemoteUI();
      sendCmd("rate_active", {
        scope,
        score,
        season: it.season || 1,
        episode: it.episode || 1,
      });
    });
  });
  document.getElementById("rm-btn-clear-rate")?.addEventListener("click", () => {
    if (!rState.snap.active_item) return;
    const it = rState.snap.active_item;
    const scope = it.media_type === "series" ? (rState.rateScope === "series" ? "series" : "episode") : "movie";
    if (scope === "episode") {
      it.episode_rating = 0;
    } else {
      it.user_rating = 0;
    }
    renderRemoteUI();
    sendCmd("rate_active", {
      scope,
      score: 0,
      clear: true,
      season: it.season || 1,
      episode: it.episode || 1,
    });
  });
  document.getElementById("rm-btn-watch-toggle")?.addEventListener("click", () => {
    if (!rState.snap.active_item) return;
    const it = rState.snap.active_item;
    if (it.media_type === "series") {
      it.episode_watched = !it.episode_watched;
    } else {
      it.watched = !it.watched;
    }
    renderRemoteUI();
    sendCmd("toggle_watched");
  });

  document.getElementById("rm-btn-fs")?.addEventListener("click", () => sendCmd("toggle_fullscreen"));
  document.getElementById("rm-btn-xray-pc")?.addEventListener("click", () => {
    rState.snap.xray_open = !rState.snap.xray_open;
    renderRemoteUI();
    sendCmd("toggle_xray");
  });
  document.getElementById("rm-btn-pip")?.addEventListener("click", () => sendCmd("toggle_pip"));
  document.getElementById("rm-btn-tvmode")?.addEventListener("click", () => sendCmd("toggle_tv_mode"));

  shell.querySelectorAll("[data-dpad]").forEach((btn) => {
    btn.addEventListener("click", () => sendCmd("dpad", { key: btn.dataset.dpad }));
  });
  document.getElementById("rm-dpad-playpause")?.addEventListener("click", () => sendCmd("toggle_play"));
  document.getElementById("rm-dpad-xray")?.addEventListener("click", () => {
    rState.snap.xray_open = !rState.snap.xray_open;
    renderRemoteUI();
    sendCmd("toggle_xray");
  });
  document.getElementById("rm-dpad-fs")?.addEventListener("click", () => sendCmd("toggle_fullscreen"));
  document.getElementById("rm-dpad-tvtoggle")?.addEventListener("click", () => sendCmd("toggle_tv_mode"));
  document.getElementById("rm-dpad-sub-cycle")?.addEventListener("click", () => sendCmd("cycle_subtitle"));
  document.getElementById("rm-dpad-mute")?.addEventListener("click", () => sendCmd("toggle_mute"));
  document.getElementById("rm-dpad-vol-down")?.addEventListener("click", () => {
    const curVol = Number.isFinite(Number(rState.snap.volume)) ? Number(rState.snap.volume) : 1;
    const nextVol = Math.max(0, Math.min(1, Math.round((curVol - 0.1) * 100) / 100));
    rState.snap.volume = nextVol;
    rState.snap.muted = false;
    renderRemoteUI();
    sendCmd("set_volume", { volume: nextVol });
  });
  document.getElementById("rm-dpad-vol-up")?.addEventListener("click", () => {
    const curVol = Number.isFinite(Number(rState.snap.volume)) ? Number(rState.snap.volume) : 1;
    const nextVol = Math.max(0, Math.min(1, Math.round((curVol + 0.1) * 100) / 100));
    rState.snap.volume = nextVol;
    rState.snap.muted = false;
    renderRemoteUI();
    sendCmd("set_volume", { volume: nextVol });
  });

  document.getElementById("rm-mini-open-player")?.addEventListener("click", () => {
    switchTab("player");
  });
  document.getElementById("rm-mini-back10")?.addEventListener("click", () => {
    applyOptimisticSeek(-10);
    sendCmd("seek_rel", { delta: -10 });
  });
  document.getElementById("rm-mini-play")?.addEventListener("click", () => {
    if (rState.snap.is_player_open) {
      rState.snap.current_time = getInterpolatedTime();
      rState.snap.playing = !rState.snap.playing;
      rState.lastSyncPerfMs = performance.now();
      renderRemoteUI();
    }
    sendCmd("toggle_play");
  });
  document.getElementById("rm-mini-fwd10")?.addEventListener("click", () => {
    applyOptimisticSeek(10);
    sendCmd("seek_rel", { delta: 10 });
  });

  const modeTouchpadBtn = document.getElementById("rm-mode-touchpad");
  const modeButtonsBtn = document.getElementById("rm-mode-buttons");
  const touchpadBox = document.getElementById("rm-touchpad-box");
  const buttonsBox = document.getElementById("rm-buttons-box");

  if (modeTouchpadBtn && modeButtonsBtn) {
    modeTouchpadBtn.onclick = () => {
      modeTouchpadBtn.classList.add("active");
      modeTouchpadBtn.setAttribute("aria-pressed", "true");
      modeButtonsBtn.classList.remove("active");
      modeButtonsBtn.setAttribute("aria-pressed", "false");
      touchpadBox?.classList.remove("hidden");
      buttonsBox?.classList.add("hidden");
      localizeRemoteShellStaticDOM();
    };
    modeButtonsBtn.onclick = () => {
      modeButtonsBtn.classList.add("active");
      modeButtonsBtn.setAttribute("aria-pressed", "true");
      modeTouchpadBtn.classList.remove("active");
      modeTouchpadBtn.setAttribute("aria-pressed", "false");
      buttonsBox?.classList.remove("hidden");
      touchpadBox?.classList.add("hidden");
      localizeRemoteShellStaticDOM();
    };
  }

  const surface = document.getElementById("rm-touchpad-surface");
  const puck = document.getElementById("rm-touchpad-puck");
  const touchpadHud = document.getElementById("rm-touchpad-hud");
  let touchpadHudTimer = null;
  const flashTouchpadHud = (label) => {
    if (!touchpadHud || !label) return;
    touchpadHud.textContent = label;
    touchpadHud.classList.remove("hidden");
    if (touchpadHudTimer) clearTimeout(touchpadHudTimer);
    touchpadHudTimer = setTimeout(() => {
      touchpadHud.classList.add("hidden");
    }, 680);
  };

  if (surface) {
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let isDown = false;
    let hasMoved = false;
    let longPressTriggered = false;
    let longPressTimer = null;
    let touchStartTime = 0;
    let activePointerId = null;
    let activeArrowCls = "";
    const clearLongPressTimer = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };
    const arrowMap = {
      "is-up": surface.querySelector(".atv-remote-touchpad-arrow.is-up"),
      "is-down": surface.querySelector(".atv-remote-touchpad-arrow.is-down"),
      "is-left": surface.querySelector(".atv-remote-touchpad-arrow.is-left"),
      "is-right": surface.querySelector(".atv-remote-touchpad-arrow.is-right"),
    };

    const clearArrowHighlights = () => {
      if (activeArrowCls && arrowMap[activeArrowCls]) {
        arrowMap[activeArrowCls].classList.remove("is-active");
      }
      activeArrowCls = "";
    };

    const triggerDirectionalAction = (dirKey) => {
      try {
        navigator.vibrate?.(15);
      } catch (_) {}
      if (dirKey === "left" || dirKey === "right") {
        const isRight = dirKey === "right";
        if (rState.snap?.is_player_open) {
          applyOptimisticSeek(isRight ? 10 : -10);
          sendCmd("seek_rel", { delta: isRight ? 10 : -10 });
          flashTouchpadHud(isRight ? `+10 ${t("с", "s")}` : `−10 ${t("с", "s")}`);
        } else {
          sendCmd("dpad", { key: isRight ? "right" : "left" });
          flashTouchpadHud(isRight ? t("Вправо", "Right") : t("Влево", "Left"));
        }
      } else if (dirKey === "up" || dirKey === "down") {
        const isDownDir = dirKey === "down";
        if (rState.snap?.is_player_open) {
          const rawVol = Number(rState.snap.volume);
          const curVol = Number.isFinite(rawVol) ? rawVol : 1;
          const nextVol = Math.max(0, Math.min(1, curVol + (isDownDir ? -0.1 : 0.1)));
          rState.snap.volume = nextVol;
          renderRemoteUI();
          sendCmd("set_volume", { volume: nextVol });
          flashTouchpadHud(`${Math.round(nextVol * 100)}%`);
        } else {
          sendCmd("dpad", { key: isDownDir ? "down" : "up" });
          flashTouchpadHud(isDownDir ? t("Вниз", "Down") : t("Вверх", "Up"));
        }
      }
    };

    const onPointerDown = (e) => {
      if (isDown && activePointerId !== null && e.pointerId !== activePointerId) return;
      isDown = true;
      activePointerId = e.pointerId ?? null;
      hasMoved = false;
      longPressTriggered = false;
      clearLongPressTimer();
      touchStartTime = Date.now();
      const pt = e.touches ? e.touches[0] : e;
      startX = pt.clientX;
      startY = pt.clientY;
      lastX = startX;
      lastY = startY;
      surface.classList.add("is-dragging");
      puck?.classList.add("is-dragging");
      longPressTimer = setTimeout(() => {
        if (!isDown || hasMoved) return;
        longPressTriggered = true;
        try {
          navigator.vibrate?.(25);
        } catch (_) {}
        rState.snap.xray_open = !rState.snap.xray_open;
        renderRemoteUI();
        sendCmd("toggle_xray");
        flashTouchpadHud("X-Ray");
      }, 480);
      if (surface.setPointerCapture && e.pointerId != null) {
        try {
          surface.setPointerCapture(e.pointerId);
        } catch (err) { window.logDebug?.("Remote", err); }
      }
    };

    const onPointerMove = (e) => {
      if (!isDown || (activePointerId !== null && e.pointerId != null && e.pointerId !== activePointerId)) return;
      const pt = e.touches ? e.touches[0] : e;
      lastX = pt.clientX;
      lastY = pt.clientY;
      const dx = pt.clientX - startX;
      const dy = pt.clientY - startY;
      const dist = Math.hypot(dx, dy);
      if (dist > 10) {
        hasMoved = true;
        clearLongPressTimer();
      }

      const nextArrowCls =
        dist >= 20
          ? Math.abs(dx) > Math.abs(dy)
            ? dx > 0
              ? "is-right"
              : "is-left"
            : dy > 0
            ? "is-down"
            : "is-up"
          : "";
      if (nextArrowCls !== activeArrowCls) {
        if (activeArrowCls && arrowMap[activeArrowCls]) {
          arrowMap[activeArrowCls].classList.remove("is-active");
        }
        activeArrowCls = nextArrowCls;
        if (activeArrowCls && arrowMap[activeArrowCls]) {
          arrowMap[activeArrowCls].classList.add("is-active");
        }
      }

      const maxR = 42;
      const dampedDist = maxR * Math.tanh(dist / (maxR * 1.35));
      const scale = dist > 0 ? dampedDist / dist : 0;
      const px = dx * scale;
      const py = dy * scale;
      if (puck) {
        puck.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
      }
    };

    const onPointerCancel = (e) => {
      if (!isDown || (activePointerId !== null && e?.pointerId != null && e.pointerId !== activePointerId)) return;
      isDown = false;
      activePointerId = null;
      hasMoved = false;
      clearLongPressTimer();
      surface.classList.remove("is-dragging");
      puck?.classList.remove("is-dragging");
      clearArrowHighlights();
      if (puck) {
        puck.style.transform = "translate3d(0, 0, 0)";
      }
    };

    const onPointerUp = (e) => {
      if (!isDown || (activePointerId !== null && e.pointerId != null && e.pointerId !== activePointerId)) return;
      isDown = false;
      activePointerId = null;
      clearLongPressTimer();
      surface.classList.remove("is-dragging");
      puck?.classList.remove("is-dragging");
      clearArrowHighlights();
      if (puck) {
        puck.style.transform = "translate3d(0, 0, 0)";
      }
      if (longPressTriggered) {
        longPressTriggered = false;
        return;
      }
      const elapsed = Date.now() - touchStartTime;
      const pt = e.changedTouches ? e.changedTouches[0] : (e.touches ? e.touches[0] : e);
      const endX = pt ? pt.clientX : lastX;
      const endY = pt ? pt.clientY : lastY;
      const totalDx = endX - startX;
      const totalDy = endY - startY;
      const totalDist = Math.hypot(totalDx, totalDy);

      if (!hasMoved || (totalDist < 14 && elapsed < 320)) {
        const rect = surface.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          const relX = endX - (rect.left + rect.width / 2);
          const relY = endY - (rect.top + rect.height / 2);
          const distFromCenter = Math.hypot(relX, relY);
          const edgeThreshold = Math.min(rect.width, rect.height) * 0.24;
          if (distFromCenter >= edgeThreshold) {
            const tapDir = Math.abs(relX) > Math.abs(relY) ? (relX > 0 ? "right" : "left") : relY > 0 ? "down" : "up";
            triggerDirectionalAction(tapDir);
            return;
          }
        }
        if (rState.snap?.is_player_open) {
          sendCmd("toggle_play");
          flashTouchpadHud(rState.snap.playing ? t("Пауза", "Pause") : t("Пуск", "Play"));
        } else {
          sendCmd("dpad", { key: "ok" });
          flashTouchpadHud("OK");
        }
        return;
      }

      if (totalDist >= 22) {
        const isHorizontal = Math.abs(totalDx) > Math.abs(totalDy);
        if (isHorizontal) {
          triggerDirectionalAction(totalDx > 0 ? "right" : "left");
        } else {
          triggerDirectionalAction(totalDy > 0 ? "down" : "up");
        }
      }
    };

    surface.addEventListener("pointerdown", onPointerDown);
    surface.addEventListener("pointermove", onPointerMove);
    surface.addEventListener("pointerup", onPointerUp);
    surface.addEventListener("pointercancel", onPointerCancel);
    surface.addEventListener("lostpointercapture", onPointerCancel);
  }

  let searchDebounce = null;
  const searchInp = document.getElementById("rm-catalog-search");
  const searchClearBtn = document.getElementById("rm-catalog-search-clear");
  const searchSendTvBtn = document.getElementById("rm-catalog-search-tv");
  if (searchInp) {
    searchInp.addEventListener("input", () => {
      rState.searchQuery = String(searchInp.value || "").trim();
      searchClearBtn?.classList.toggle("hidden", !rState.searchQuery);
      searchSendTvBtn?.classList.toggle("hidden", !rState.searchQuery);
      if (searchDebounce) clearTimeout(searchDebounce);
      if (!rState.searchQuery) {
        rState.searchResults = null;
        renderRemoteCatalog();
        return;
      }
      searchDebounce = setTimeout(() => {
        loadRemoteCatalog(rState.searchQuery);
      }, 280);
    });
    searchInp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && rState.searchQuery) {
        sendCmd("remote_search", { query: rState.searchQuery });
      }
    });
  }
  searchSendTvBtn?.addEventListener("click", () => {
    if (!rState.searchQuery) return;
    sendCmd("remote_search", { query: rState.searchQuery, close_player: false });
  });
  searchClearBtn?.addEventListener("click", () => {
    if (!searchInp) return;
    searchInp.value = "";
    rState.searchQuery = "";
    rState.searchResults = null;
    searchClearBtn.classList.add("hidden");
    searchSendTvBtn?.classList.add("hidden");
    sendCmd("remote_search", { query: "" });
    renderRemoteCatalog();
    try {
      searchInp.focus();
    } catch (_) {}
  });
  document.getElementById("rm-catalog-filter-chips")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-rcat-filter]");
    if (!chip) return;
    const flt = chip.getAttribute("data-rcat-filter") || "all";
    rState.catalogFilter = flt;
    shell.querySelectorAll("#rm-catalog-filter-chips .atv-remote-chip").forEach((c) => {
      const match = c.getAttribute("data-rcat-filter") === flt;
      c.classList.toggle("active", match);
      c.setAttribute("aria-selected", match ? "true" : "false");
    });
    renderRemoteCatalog();
  });

  const _rmTickEls = {};
  const _getRmTickEl = (id) => {
    let el = _rmTickEls[id];
    if (!el || !el.isConnected) {
      el = document.getElementById(id);
      if (el) _rmTickEls[id] = el;
    }
    return el;
  };

  const tickRemotePlaybackTimeUI = () => {
    const s = rState.snap;
    const dur = Math.max(0, Number(s.duration) || 0);
    const interpCur = getInterpolatedTime();
    const interpCurSec = Math.floor(interpCur);
    const scrubber = _getRmTickEl("rm-scrubber");
    if (scrubber && !rState.scrubbing) {
      const nextDis = !s.is_player_open || dur <= 0;
      if (scrubber.disabled !== nextDis) scrubber.disabled = nextDis;
      const nextVal = dur > 0 ? String(Math.round((interpCur / dur) * 1000)) : "0";
      if (scrubber._lastTickVal !== nextVal) {
        scrubber._lastTickVal = nextVal;
        scrubber.value = nextVal;
        updateRangeSliderFill(scrubber);
      }
    }
    const curEl = _getRmTickEl("rm-time-cur");
    const durEl = _getRmTickEl("rm-time-dur");
    if (curEl && !rState.scrubbing && curEl._lastTickSec !== interpCurSec) {
      curEl._lastTickSec = interpCurSec;
      curEl.textContent = formatTime(interpCur);
    }
    if (durEl) {
      const nextDurTxt =
        rState.showRemainingTime && dur > 0
          ? `−${formatTime(Math.max(0, dur - interpCur))}`
          : formatTime(dur);
      if (durEl.textContent !== nextDurTxt) {
        durEl.textContent = nextDurTxt;
      }
    }
    const bms = Array.isArray(s.bookmarks) ? s.bookmarks : [];
    const bmToggleBtn = _getRmTickEl("rm-btn-bookmark-toggle");
    if (bmToggleBtn) {
      const hasNearBookmark = bms.some((b) => Math.abs((Number(b.time) || 0) - interpCur) <= 2.5);
      if (bmToggleBtn._lastNearBm !== hasNearBookmark) {
        bmToggleBtn._lastNearBm = hasNearBookmark;
        bmToggleBtn.classList.toggle("active", hasNearBookmark);
        bmToggleBtn.setAttribute("aria-pressed", hasNearBookmark ? "true" : "false");
      }
    }
    const miniBar = _getRmTickEl("rm-mini-transport");
    if (miniBar && !miniBar.classList.contains("hidden") && s.active_item) {
      const it = s.active_item;
      const mSub = _getRmTickEl("rm-mini-sub");
      const mProgFill = _getRmTickEl("rm-mini-progress-fill");
      if (mSub) {
        const epTag = it.media_type === "series" && it.episode ? `S${it.season || 1}E${it.episode} · ` : "";
        const nextSubTxt = `${epTag}${formatTime(interpCur)}${dur > 0 ? ` / ${formatTime(dur)}` : ""}`;
        if (mSub.textContent !== nextSubTxt) mSub.textContent = nextSubTxt;
      }
      if (mProgFill) {
        const pct = dur > 0 ? Math.min(100, Math.max(0, (interpCur / dur) * 100)) : 0;
        const pctStr = `${pct.toFixed(1)}%`;
        if (mProgFill.style.width !== pctStr) mProgFill.style.width = pctStr;
      }
    }
  };

  setInterval(() => {
    if (rState.snap.playing && !rState.scrubbing) {
      tickRemotePlaybackTimeUI();
    }
  }, 500);

  sendCmd("ping_desktop");

  const syncRemoteLanguageWithDesktop = (rawLang) => {
    const normLang = String(rawLang || "").trim().toLowerCase().startsWith("en") ? "en" : "ru";
    if (state.appLang === normLang) return;
    state.appLang = normLang;
    saveUiPrefs({ appLang: normLang });
    localizeRemoteShellStaticDOM();
    if (rState.catalogLoaded || rState.activeTab === "catalog") {
      loadRemoteCatalog(rState.searchQuery);
    } else {
      renderRemoteCatalog();
    }
  };

  const pollStateLoop = async () => {
    while (true) {
      try {
        const params = new URLSearchParams({
          k: pairKey,
          since: String(rState.lastSeq),
          timeout: "14",
          cid: clientId,
          device: _detectPhoneDeviceLabel(),
        });
        const res = await fetch(`/api/remote/state?${params.toString()}`);
        if (res.status === 403) {
          rState.authFailed = true;
          renderRemoteUI();
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        if (res.ok) {
          const data = await res.json();
          rState.authFailed = false;
          rState.desktopOnline = Boolean(data.desktop_online);
          rState.lastSeq = Number(data.seq || data.state_version || rState.lastSeq);
          rState.lastSyncPerfMs = performance.now();
          const prevProfileId = rState.snap?.active_profile_id || "main";
          if (data.state && typeof data.state === "object") {
            rState.snap = { ...rState.snap, ...data.state };
          }
          const nextProfileId = rState.snap?.active_profile_id || "main";
          if (nextProfileId !== prevProfileId && (rState.catalogLoaded || rState.activeTab === "catalog")) {
            loadRemoteCatalog(rState.searchQuery);
          }
          const srvLang = data.app_lang || rState.snap?.app_lang;
          if (srvLang) {
            syncRemoteLanguageWithDesktop(srvLang);
          }
          renderRemoteUI();
        } else {
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (_) {
        rState.desktopOnline = false;
        renderRemoteUI();
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };
  localizeRemoteShellStaticDOM();
  initCustomSelects();
  renderRemoteUI();
  pollStateLoop();
}
