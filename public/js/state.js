const _initialSetupCompleted = (() => {
  try {
    return document.documentElement?.getAttribute("data-setup-completed") !== "false";
  } catch (_) {
    return true;
  }
})();

const _initialAppLang = (() => {
  try {
    const bootLang = document.documentElement?.getAttribute("data-boot-lang");
    if (!_initialSetupCompleted && (bootLang === "en" || bootLang === "ru")) {
      return bootLang;
    }
  } catch (_) {}
  try {
    const raw = localStorage.getItem("cineflow_ui_prefs");
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && (parsed.appLang === "en" || parsed.appLang === "ru")) {
      return parsed.appLang;
    }
  } catch (_) {}
  try {
    const bootLang = document.documentElement?.getAttribute("data-boot-lang");
    if (bootLang === "en" || bootLang === "ru") {
      return bootLang;
    }
  } catch (_) {}
  return "ru";
})();

export const state = {
  appLang: _initialAppLang,
  appVersion: "2.7.0",
  launchSeed: Math.floor(Math.random() * 0x7fffffff) || 1,
  providerFilter: "all",
  mediaTypeFilter: "all",
  kinoriumSection: "all",
  kinoriumSubType: "all",
  genreFilter: "all",
  yearFilter: "all",
  hideWatched: false,
  friendsFilter: false,
  selectedFriend: "all",
  sortBy: "default",
  kinoriumCounts: { premieres: 0, watching: 0, watchlist: 0, watched: 0, never: 0 },
  kinoriumFriends: [],
  similarPool: [],
  searchSimilarItems: [],
  searchPersons: [],
  kinoriumAccount: {
    user_id: "",
    display_name: "",
    profile_url: "https://kinorium.com/",
    connected: false,
    has_session_cookie: false,
  },
  userCountry: "PL",
  setupCompleted: _initialSetupCompleted,
  countryProfile: null,
  euCountries: [],
  onboardingDraftServices: null,
  onboardingCountrySearch: "",
  onboardingUserTouchedPlayerPl: false,
  backup4kReleasesCache: {},
  searchQuery: "",
  providersMeta: {},
  integrations: {},
  catalogItems: [],
  continueWatching: [],
  cwExpanded: false,
  activeItem: null,
  activeSourceTab: "hdrezka",
  activeSeason: 1,
  activeEpisode: 1,
  seasonsMap: {},
  activeStudioId: "",
  activeStudioName: "HDRezka Studio",
  qualities: {},
  currentStreamUrl: "",
  subtitles: [],
  activeSubtitleIndex: -1,
  activeSubCues: [],
  activeSubTrackMeta: null,
  loadedSubUrl: "",
  lastRenderedSubCueText: "",
  subFetchAbortController: null,
  subFetchReqId: 0,
  subWindowAdvancing: false,
  external4kSubs: [],
  remuxDurationReprobeTimer: null,
  skipSegments: null,
  autoSkipIntro: true,
  internalMuteOverride: false,
  userMutedThisSession: false,
  userPaused: false,
  lastVcSyncTs: 0,
  autoNextEpisode: true,
  audioBoost: 1.0,
  audioPreset: "flat",
  audioCtx: null,
  audioNodes: null,
  audioLimiterCurve: null,
  fsTransitioning: false,
  fsTransitionTimerId: null,
  vcClickTimerId: null,
  trailerData: null,
  trailerLang: _initialAppLang === "en" ? "en" : "ru",
  episodesTitles: {},
  episodesMeta: {},
  liveSeriesUpdates: {},
  liveUpdatesCheckedOnce: false,
  sleepTimerMode: "off",
  sleepTimerId: null,
  sleepTimerSecondsLeft: 0,
  sleepAtEpisodeEnd: false,
  videoCrop: "contain",
  subSize: "medium",
  subBg: "semi",
  ambilightEnabled: true,
  ambilightTimerId: null,
  ambilightCanvas: null,
  ambilightCtx: null,
  ambilightTaintedUrl: "",
  heroItems: [],
  heroIndex: 0,
  heroTimerId: null,
  heroHovered: false,
  quickPeekItem: null,
  quickPeekReqId: 0,
  statsActiveTab: "analytics",
  lastHistorySaveTime: 0,
  isMiniPlayer: false,
  isPipBackground: false,
  hasPlayerHistoryEntry: false,
  ignoringSyntheticPopstate: false,
  pausedByOverlayModal: false,
  postwatchAnchor: "header",
  settingsBaseline: "",
  deletedWatchHistoryBackup: null,
  lastEpisodeSaveTime: 0,
  autoplayTimerId: null,
  autoplaySecondsLeft: 0,
  autoplayCancelledThisEpisode: false,
  introSkippedThisEpisode: false,
  hlsInstance: null,
  isPlayerOpen: false,
  playerSessionId: 0,
  catalogAbortController: null,
  streamAbortController: null,
  backup4kAbortController: null,
  stremioResolveAbortController: null,
  remuxProbeAbortController: null,
  skipIntroAbortController: null,
  trailerAbortController: null,
  videoLoadAbort: null,
  videoLoadToken: 0,
  stallWatchdogTimerId: null,
  waitingSpinnerTimerId: null,
  lastPlaybackAdvanceTs: 0,
  lastPlaybackMediaTime: -1,
  lastObservedVideoFrames: null,
  lastVideoFramesAdvanceTs: 0,
  lastFreezeCheckMediaTime: null,
  lastVideoFreezeRecoverTs: 0,
  videoFreezeCount: 0,
  recentStallTimestamps: [],
  autoReconnectTimestamps: [],
  adPollScanStarted: false,
  torrserverConnected: false,
  remuxAvailable: false,
  hwAccelSummary: "",
  systemStatus: null,
  activeConfirmResolve: null,
  confirmReturnFocusEl: null,
  active4kReleaseUrl: "",
  active4kReleaseKey: "",
  active4kRelease: null,
  stremioAddons: [],
  stremioFilter: "all",
  stremioStreamsData: null,
  activeStremioStreamKey: "",
  externalStremioSubs: [],
  pendingServiceLogins: {},
  scrobbledThisSession: false,
  lastScrobbleReportTime: 0,
  gridPages: {},
  vcShowRemaining: false,
  vcIdleTimerId: null,
  vcScrubbing: false,
  vcLastMouseX: -1,
  vcLastMouseY: -1,
  personModalReqId: 0,
  personProfileData: null,
  personActiveRole: "all",
  personFilmographyLimit: 24,
  catalogDirty: false,
  scrobbledEpisodesThisSession: {},
  promotedWatchingThisSession: {},
  probeCreditsStartSec: 0,
  ratingPromptShownThisSession: {},
  postwatchHovered: false,
  postwatchManual: false,
  postwatchScope: "movie",
  postwatchSeason: 1,
  postwatchEpisode: 1,
  postwatchSelectedScore: 0,
  onboardingStep: 1,
  onboardingReturnToSettings: false,
  pipWasPlayingRecently: false,
  isRestoringFromPip: false,
  episodesStripExpanded: true,
  epViewMode: (() => {
    try {
      return localStorage.getItem("cineflow_ep_view_mode") === "grid" ? "grid" : "strip";
    } catch (_) {
      return "strip";
    }
  })(),
  pendingKinoriumLocks: {},
  navModalStack: [],
  remuxMeta: null,
  lastNonOriginalStudioId: "",
  forceEnableRuSubtitlesOnce: false,
  preloadedNextEpisode: null,
  preloadingNextKey: "",
  bgDigestTimerId: null,
  lastBgDigestTs: 0,
  kinoriumFormExpanded: false,
  isAppWindowActive: typeof document !== "undefined" && typeof document.hasFocus === "function" ? document.hasFocus() : true,
  profiles: [],
  activeProfileId: (() => {
    try {
      const savedPid = String(localStorage.getItem("cineflow_active_profile_id") || "").trim();
      return savedPid || "main";
    } catch (_) {
      return "main";
    }
  })(),
  activeProfile: null,
  isOfflineMode: typeof navigator !== "undefined" ? !navigator.onLine : false,
  downloadsItems: [],
  downloadsActiveCount: 0,
  downloadsTotalBytes: 0,
  downloadsPollTimerId: null,
  tvMode: false,
  tvDevices: [],
  tvActiveCast: null,
  tvBurnSubtitles: true,
  activeSubDictWord: "",
  activeSubDictEntry: null,
  tvQrSvg: "",
  tvUrl: "",
  tvLanEnabled: false,
  tvIsLocalClient: true,
  kinoriumOneClickPolling: false,
  isPlayingOfflineDownload: false,
  activeOfflineDownloadId: "",
  lastNativeNowPlayingTs: 0,
  pendingTvDeepLink: null,
  pendingStudioId: null,
  verifiedKidsAdminPin: "",
  backupQualities: {},
  hlsQualities: {},
  streamMintedAt: 0,
  usedBackupUrls: null,
  tokenRefreshTimestamps: [],
  subtitleOffsetSec: 0,
  audioOffsetSec: 0,
  audioOffsetReloadTimerId: null,
  preferred4kReleaseKey: "",
  active4kVideoFiles: [],
  active4kFileIndex: 0,
  lastDirect4kSourceUrl: "",
  customExternalSubtitles: [],
  subOnlineSearching: false,
  downloadsPrefs: {
    auto_cleanup_watched: false,
    auto_download_next: false,
  },
  notifTab: "updates",
  calendarData: null,
  calendarLoading: false,
  remoteMode: false,
  remoteCastTab: "phone",
  remotePairInfo: null,
  remoteConnectedCount: 0,
  bookmarks: [],
  rouletteType: "all",
  rouletteMood: "all",
  rouletteMinRating: 0,
  pausedBySubWord: false,
  subDictOpen: false,
  updaterStatus: null,
  updaterPollTimerId: null,
  updaterAutoChecked: false,
  showCuratedShelves: (() => {
    try {
      return localStorage.getItem("cineflow_curated_shelves") !== "false";
    } catch (_) {
      return true;
    }
  })(),
};
export const ACTIVE_PROFILE_STORAGE_KEY = "cineflow_active_profile_id";
export const PREFERRED_STUDIOS_STORAGE_KEY = "cineflow_preferred_studios";
export const BOOKMARKS_STORAGE_KEY = "cineflow_moments_v1";
export const PLAYER_PREFS_STORAGE_KEY = "cineflow_player_prefs";
export const SEEN_NOTIFICATIONS_STORAGE_KEY = "cineflow_seen_notifications";
export const NOTIF_DESKTOP_ALERTED_STORAGE_KEY = "cineflow_desktop_alerted_episodes_v1";
export const UI_PREFS_STORAGE_KEY = "cineflow_ui_prefs";
export const EPISODE_PROGRESS_STORAGE_KEY = "cineflow_episode_progress_v1";
export const WATCH_HISTORY_STORAGE_KEY = "cineflow_watch_history_v1";
export const EP_VIEW_MODE_STORAGE_KEY = "cineflow_ep_view_mode";
export const RECENT_SEARCHES_STORAGE_KEY = "cineflow_recent_searches_v1";
export const CURATED_SHELVES_STORAGE_KEY = "cineflow_curated_shelves";

export function profileStorageKeyFor(baseKey, profileId = "main") {
  const pid = String(profileId || "main").trim();
  return !pid || pid === "main" ? baseKey : `${baseKey}__${pid}`;
}

export function profileStorageKey(baseKey) {
  return profileStorageKeyFor(baseKey, state.activeProfileId);
}
