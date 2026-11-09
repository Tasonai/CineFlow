import { state } from "./state.js?v=20261109v4";
import {
  displayBackdrop,
  displayCountries,
  displayDescription,
  displayTitle,
  hasCyrillicText,
  isEn,
  t,
  translateGenre,
} from "./i18n.js?v=20261109v4";
import {
  cssUrl,
  escapeHtml,
  iconSvg,
  setAmbientColor,
} from "./utils.js?v=20261109v4";
import { openQuickPeekModal } from "./modals.js?v=20261109v4";
import { openPlayerModal } from "./player.js?v=20261109v4";
import {
  _hashItemKey,
  filterCatalogItemsByGenreAndYear,
  seededShuffle,
} from "./catalog-filters.js?v=20261109v4";
import {
  isServiceEnabled,
  resolvePreferredPlayTab,
  resolveSeriesEpisodeInfo,
} from "./catalog-media-resolver.js?v=20261109v4";
import { isAnyOverlayModalOpen } from "./catalog.js?v=20261109v4";

const LAST_HERO_ID_STORAGE_KEY = "velarium_last_hero_id";
let _heroRecordedThisLaunch = false;
let _lastHeroPoolSig = "";

export function resetHeroRecordedThisLaunch() {
  _heroRecordedThisLaunch = false;
  _lastHeroPoolSig = "";
}

let _heroTeaserTimer = null;
let _heroTeaserRevealTimer = null;
let _heroTeaserAbort = null;
let _heroTeaserMsgHandler = null;

export function stopHeroAmbientTeaser() {
  if (
    !_heroTeaserTimer &&
    !_heroTeaserRevealTimer &&
    !_heroTeaserAbort &&
    !_heroTeaserMsgHandler &&
    !state.heroTeaserPlaying
  ) {
    return;
  }
  if (_heroTeaserTimer) {
    clearTimeout(_heroTeaserTimer);
    _heroTeaserTimer = null;
  }
  if (_heroTeaserRevealTimer) {
    clearTimeout(_heroTeaserRevealTimer);
    _heroTeaserRevealTimer = null;
  }
  if (_heroTeaserAbort) {
    try {
      _heroTeaserAbort.abort();
    } catch (err) { window.logDebug?.("CatalogHero", err); }
    _heroTeaserAbort = null;
  }
  if (_heroTeaserMsgHandler && typeof window !== "undefined") {
    window.removeEventListener("message", _heroTeaserMsgHandler);
    _heroTeaserMsgHandler = null;
  }
  state.heroTeaserPlaying = false;
  state.heroTeaserUnmuted = false;
  const oldSoundBtn = document.getElementById("hero-sound-toggle");
  if (oldSoundBtn) {
    oldSoundBtn.remove();
  }
  const teaserWrap = document.getElementById("hero-teaser-wrap");
  if (teaserWrap) {
    teaserWrap.classList.remove("is-playing");
    teaserWrap.classList.add("hidden");
    teaserWrap.innerHTML = "";
  }
}

export function scheduleHeroAmbientTeaser(featured) {
  stopHeroAmbientTeaser();
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
    return;
  }
  const targetHeroItem =
    featured ||
    state.heroItems?.[state.heroIndex || 0] ||
    state.catalogItems?.[0] ||
    null;
  if (!targetHeroItem || state.isPlayerOpen || typeof window === "undefined") return;
  featured = targetHeroItem;

  _heroTeaserTimer = setTimeout(async () => {
    if (state.isPlayerOpen || isAnyOverlayModalOpen() || document.hidden) return;
    const heroBanner = document.getElementById("hero-banner");
    const teaserWrap = document.getElementById("hero-teaser-wrap");
    if (!heroBanner || !teaserWrap || heroBanner.classList.contains("hidden")) return;

    const rect = heroBanner.getBoundingClientRect();
    if (rect.bottom < 120) return;

    const abort = new AbortController();
    _heroTeaserAbort = abort;

    try {
      const qParams = new URLSearchParams({
        id: featured.id || "",
        rezka_id: featured.rezka_id || "",
        title: featured.title || "",
        orig_title: featured.orig_title || "",
        year: String(featured.year || ""),
        media_type: featured.media_type || "movie",
        lang: state.appLang || "ru",
      });
      const res = await fetch(`/api/trailer?${qParams.toString()}`, { signal: abort.signal });
      if (!res.ok) return;
      const data = await res.json();
      const ytId =
        (state.appLang === "en" ? (data.en_video_id || data.ru_video_id) : (data.ru_video_id || data.en_video_id)) ||
        data.youtube_id;
      if (state.isPlayerOpen || !ytId) return;

      const origin =
        typeof window !== "undefined" && /^https?:\/\//.test(window.location.origin)
          ? `&origin=${encodeURIComponent(window.location.origin)}`
          : "";
      // Omit playlist=... so YouTube never renders Prev/Next playlist buttons in the center
      const iframeSrc = `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&playsinline=1&modestbranding=1&rel=0&showinfo=0&enablejsapi=1${origin}`;

      let isMuted = true;
      let revealed = false;
      teaserWrap.classList.remove("is-playing");
      teaserWrap.innerHTML = `
        <div class="atv-hero-teaser-stage">
          <iframe
            src="${iframeSrc}"
            title="Hero Teaser"
            tabindex="-1"
            allow="autoplay; encrypted-media"
            referrerpolicy="strict-origin-when-cross-origin"
          ></iframe>
        </div>
      `;
      teaserWrap.classList.remove("hidden");

      const existingBtn = document.getElementById("hero-sound-toggle");
      if (existingBtn) existingBtn.remove();
      const soundBtn = document.createElement("button");
      soundBtn.type = "button";
      soundBtn.className = "atv-hero-sound-toggle is-hidden";
      soundBtn.id = "hero-sound-toggle";
      soundBtn.title = t("Включить звук", "Unmute");
      soundBtn.setAttribute("aria-label", t("Включить звук", "Unmute"));
      soundBtn.setAttribute("aria-pressed", "false");
      soundBtn.innerHTML = iconSvg("volMute", 14);
      heroBanner.appendChild(soundBtn);

      const ifr = teaserWrap.querySelector("iframe");
      const postYtCmd = (func, args = []) => {
        if (!ifr || !ifr.contentWindow) return;
        try {
          ifr.contentWindow.postMessage(JSON.stringify({ event: "command", func, args }), "*");
        } catch (err) { window.logDebug?.("CatalogHero", err); }
      };

      const revealWhenClean = (delayMs = 1400) => {
        if (revealed) return;
        if (_heroTeaserRevealTimer) clearTimeout(_heroTeaserRevealTimer);
        _heroTeaserRevealTimer = setTimeout(() => {
          if (
            state.isPlayerOpen ||
            isAnyOverlayModalOpen() ||
            document.hidden ||
            !teaserWrap.isConnected ||
            teaserWrap.classList.contains("hidden")
          ) {
            return;
          }
          revealed = true;
          state.heroTeaserPlaying = true;
          state.heroTeaserStartedAt = Date.now();
          teaserWrap.classList.add("is-playing");
          soundBtn.classList.remove("is-hidden");
        }, delayMs);
      };

      if (ifr) {
        ifr.addEventListener("load", () => {
          try {
            ifr.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*");
            postYtCmd("addEventListener", ["onStateChange"]);
            postYtCmd("mute");
            postYtCmd("playVideo");
          } catch (err) { window.logDebug?.("CatalogHero", err); }
          // Fallback reveal if postMessage state event is delayed
          revealWhenClean(1950);
        });
      }

      _heroTeaserMsgHandler = (ev) => {
        if (!ifr || ev.source !== ifr.contentWindow || typeof ev.data !== "string") return;
        try {
          const msg = JSON.parse(ev.data);
          const pState =
            msg.event === "onStateChange"
              ? msg.info
              : msg.event === "infoDelivery" && msg.info && typeof msg.info.playerState === "number"
              ? msg.info.playerState
              : null;
          if (pState === 1) {
            revealWhenClean(1250);
          } else if (pState === 0 || pState === 2) {
            // Hide before YouTube pause/end-screen recommendations ("Więcej filmów") appear
            revealed = false;
            teaserWrap.classList.remove("is-playing");
            soundBtn.classList.add("is-hidden");
            state.heroTeaserPlaying = false;
            if (pState === 0) {
              postYtCmd("seekTo", [1, true]);
              postYtCmd("playVideo");
            } else {
              isMuted = true;
              state.heroTeaserUnmuted = false;
              postYtCmd("mute");
              soundBtn.innerHTML = iconSvg("volMute", 14);
              soundBtn.title = t("Включить звук", "Unmute");
              soundBtn.setAttribute("aria-label", soundBtn.title);
              soundBtn.setAttribute("aria-pressed", "false");
            }
          }
          if (msg.event === "infoDelivery" && msg.info) {
            const curT = Number(msg.info.currentTime) || 0;
            const durT = Number(msg.info.duration) || 0;
            if (durT > 8 && curT > 0 && durT - curT <= 1.8) {
              postYtCmd("seekTo", [1, true]);
              postYtCmd("playVideo");
            }
          }
        } catch (err) { window.logDebug?.("CatalogHero", err); }
      };
      window.addEventListener("message", _heroTeaserMsgHandler);

      soundBtn.onclick = (e) => {
        e.stopPropagation();
        if (!ifr || !ifr.contentWindow) return;
        isMuted = !isMuted;
        state.heroTeaserUnmuted = !isMuted;
        postYtCmd(isMuted ? "mute" : "unMute");
        soundBtn.innerHTML = isMuted ? iconSvg("volMute", 14) : iconSvg("volHigh", 14);
        soundBtn.title = isMuted ? t("Включить звук", "Unmute") : t("Выключить звук", "Mute");
        soundBtn.setAttribute("aria-label", soundBtn.title);
        soundBtn.setAttribute("aria-pressed", isMuted ? "false" : "true");
      };
    } catch (err) { window.logDebug?.("CatalogHero", err); }
  }, 2400);
}

export function stopHeroAutoTimer() {
  if (state.heroTimerId) {
    clearInterval(state.heroTimerId);
    state.heroTimerId = null;
  }
  if (state.heroSlideFadeTimer) {
    clearTimeout(state.heroSlideFadeTimer);
    state.heroSlideFadeTimer = null;
  }
  if (typeof document !== "undefined") {
    document.getElementById("hero-banner")?.classList.remove("hero-fading");
  }
  stopHeroAmbientTeaser();
}

export function startHeroAutoTimer() {
  if (state.heroTimerId) {
    clearInterval(state.heroTimerId);
    state.heroTimerId = null;
  }
  if (!state.heroItems || state.heroItems.length <= 1) return;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
    return;
  }
  state.heroTimerId = setInterval(() => {
    if (state.heroHovered || isAnyOverlayModalOpen() || document.hidden) return;
    if (state.heroTeaserPlaying) {
      if (state.heroTeaserUnmuted) return;
      if (Date.now() - (state.heroTeaserStartedAt || 0) < 16000) return;
    }
    const heroSection = document.getElementById("hero-banner");
    if (!heroSection || heroSection.classList.contains("hidden")) return;
    stepHeroSlide(1, true);
  }, 7500);
}

export function stepHeroSlide(delta, smooth = true) {
  if (!state.heroItems || state.heroItems.length <= 1) return;
  const total = state.heroItems.length;
  state.heroIndex = (state.heroIndex + delta + total) % total;
  renderHeroSlide(state.heroIndex, smooth);
}

export function renderHeroSlide(idx, smooth = false) {
  stopHeroAmbientTeaser();
  const heroSection = document.getElementById("hero-banner");
  const heroBackdrop = document.getElementById("hero-backdrop");
  const heroContent = document.getElementById("hero-content");
  const controlsWrap = document.getElementById("hero-carousel-controls");
  const dotsWrap = document.getElementById("hero-dots");
  if (!heroSection || !heroBackdrop || !heroContent) return;

  const list = state.heroItems || [];
  const featured = list[idx] || list[0];
  if (!featured) return;

  const applyContent = () => {
    setAmbientColor(featured.ambient_color || "#242427");
    const heroBgUrl = displayBackdrop(featured);
    heroBackdrop.style.backgroundImage = cssUrl(heroBgUrl);

    const kinEnabled = isServiceEnabled("kinorium");
    const rezkaEnabled = isServiceEnabled("hdrezka");
    const stremioEnabled = isServiceEnabled("stremio");
    const b4kEnabled = isServiceEnabled("backup4k");
    const epInfo = resolveSeriesEpisodeInfo(featured);
    const primaryTab = resolvePreferredPlayTab(featured, epInfo.season, epInfo.episode);

    const kRating = featured.kinorium?.kinorium_rating || featured.ratings?.kinorium || "";
    const imdbRating = featured.ratings?.imdb || kRating || "";
    const scorePart = kinEnabled
      ? kRating
        ? `Kinorium ${kRating}`
        : ""
      : imdbRating
      ? `IMDb ${imdbRating}`
      : "";
    const typeLabel = featured.media_type === "series" ? t("Сериал", "Series") : t("Фильм", "Movie");
    const genresText = (featured.genres || []).slice(0, 2).map(translateGenre).join(", ");
    const kickerParts = [typeLabel, genresText, featured.year, scorePart].filter(Boolean);

    let heroPrimaryHtml = `${iconSvg("play", 13)}<span>${t("Смотреть", "Watch")}</span>`;
    if (primaryTab === "offline") {
      heroPrimaryHtml = `${iconSvg("download", 13)}<span>${t("Смотреть офлайн", "Watch Offline")}</span>`;
    } else if (primaryTab === "hdrezka" && rezkaEnabled) {
      if (epInfo.isMidEpisodeResume) {
        heroPrimaryHtml =
          featured.media_type === "series"
            ? `${iconSvg("play", 13)}<span>${t(
                `Продолжить · С${epInfo.season}:Э${epInfo.episode}`,
                `Resume · S${epInfo.season}:E${epInfo.episode}`
              )}</span>`
            : `${iconSvg("play", 13)}<span>${t("Продолжить просмотр", "Resume Watching")}</span>`;
      } else if (featured.media_type === "series" && epInfo.hasNewEpisode && epInfo.episodeVerified) {
        heroPrimaryHtml = `${iconSvg("play", 13)}<span>${t(
          `Смотреть · С${epInfo.season}:Э${epInfo.episode}`,
          `Watch · S${epInfo.season}:E${epInfo.episode}`
        )}</span>`;
      } else {
        heroPrimaryHtml = `${iconSvg("play", 13)}<span>${t("Смотреть", "Watch")}</span>`;
      }
    } else if (primaryTab === "stremio" && stremioEnabled) {
      heroPrimaryHtml = `${iconSvg("play", 13)}<span>${t("Смотреть (Stremio)", "Watch (Stremio)")}</span>`;
    } else if (primaryTab === "backup4k" && b4kEnabled) {
      heroPrimaryHtml = `${iconSvg("play", 13)}<span>${t("Смотреть в 4K", "Watch in 4K")}</span>`;
    } else {
      heroPrimaryHtml = `${iconSvg("film", 14)}<span>${t("Смотреть трейлер", "Watch Trailer")}</span>`;
    }

    const peekLabel = featured.media_type === "series" ? t("О сериале", "Details") : t("О фильме", "Details");
    const heroTitle = displayTitle(featured);
    const heroDesc = displayDescription(featured);

    heroContent.innerHTML = `
      <div class="atv-hero-kicker">
        ${escapeHtml(kickerParts.join(" · "))}
      </div>
      <h1 class="atv-hero-title">${escapeHtml(heroTitle)}</h1>
      <p class="atv-hero-desc" id="hero-desc-text">${escapeHtml(heroDesc)}</p>
      <div class="atv-hero-buttons">
        <button type="button" class="atv-btn-primary" id="hero-play-rezka">
          ${heroPrimaryHtml}
        </button>
        ${
          primaryTab !== "trailer"
            ? `<button type="button" class="atv-btn-secondary" id="hero-play-trailer">${iconSvg("film", 13)}<span>${t("Трейлер", "Trailer")}</span></button>`
            : ""
        }
        <button type="button" class="atv-btn-secondary" id="hero-quick-peek" title="${t("Быстрый просмотр описания, актёров и оценка", "Synopsis, cast & rating")}">
          ${iconSvg("info", 14)}<span>${peekLabel}</span>
        </button>
      </div>
    `;

    const btnPlay = document.getElementById("hero-play-rezka");
    if (btnPlay) {
      btnPlay.onclick = () => {
        const info = resolveSeriesEpisodeInfo(featured);
        openPlayerModal(featured, resolvePreferredPlayTab(featured, info.season, info.episode), info.season, info.episode, info.currentTime);
      };
    }
    const btnTrailer = document.getElementById("hero-play-trailer");
    if (btnTrailer) {
      btnTrailer.onclick = () => {
        const info = resolveSeriesEpisodeInfo(featured);
        openPlayerModal(featured, "trailer", info.season, info.episode, info.currentTime);
      };
    }
    const btnPeek = document.getElementById("hero-quick-peek");
    if (btnPeek) {
      btnPeek.onclick = () => openQuickPeekModal(featured);
    }

    if (
      isEn() &&
      (!featured.description_en ||
        featured.description_en.includes("•") ||
        hasCyrillicText(featured.description_en)) &&
      !featured._enHeroFetching
    ) {
      featured._enHeroFetching = true;
      const metaParams = new URLSearchParams({
        id: String(featured.rezka_id || featured.id || ""),
        item_id: String(featured.id || ""),
        kinorium_id: String(featured.kinorium_id || featured.kinorium?.kinorium_id || ""),
        title: String(featured.title || ""),
        orig_title: String(featured.orig_title || ""),
        year: String(featured.year || ""),
        media_type: String(featured.media_type || "movie"),
        lang: "en",
      });
      fetch(`/api/title-meta?${metaParams.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((meta) => {
          if (!meta || meta.error) return;
          if (meta.description && !hasCyrillicText(meta.description)) {
            featured.description_en = meta.description;
          }
          if (meta.poster_en) {
            featured.poster_en = meta.poster_en;
          }
          if (meta.critics_rating != null) {
            featured.ratings = { ...(featured.ratings || {}), critics: meta.critics_rating };
          }
          if ((state.heroItems || [])[state.heroIndex] === featured && isEn()) {
            const descEl = document.getElementById("hero-desc-text");
            if (descEl) {
              descEl.textContent = displayDescription(featured);
            }
            heroBackdrop.style.backgroundImage = cssUrl(displayBackdrop(featured));
          }
        })
        .catch(() => {})
        .finally(() => {
          featured._enHeroFetching = false;
        });
    }

    if (controlsWrap && dotsWrap) {
      controlsWrap.classList.toggle("hidden", list.length <= 1);
      dotsWrap.setAttribute("role", "tablist");
      dotsWrap.setAttribute("aria-label", t("Слайды витрины", "Hero slides"));
      if (dotsWrap.childElementCount === list.length) {
        const dotBtns = dotsWrap.children;
        for (let dotIdx = 0; dotIdx < dotBtns.length; dotIdx++) {
          const dot = dotBtns[dotIdx];
          const isAct = dotIdx === idx;
          dot.classList.toggle("active", isAct);
          dot.setAttribute("aria-selected", isAct ? "true" : "false");
          const slideTitle = displayTitle(list[dotIdx]) || `${t("Слайд", "Slide")} ${dotIdx + 1}`;
          dot.setAttribute("aria-label", slideTitle);
          dot.title = slideTitle;
        }
      } else {
        dotsWrap.innerHTML = "";
        list.forEach((itemSlide, dotIdx) => {
          const dot = document.createElement("button");
          dot.type = "button";
          dot.setAttribute("role", "tab");
          dot.setAttribute("aria-selected", dotIdx === idx ? "true" : "false");
          const slideTitle = displayTitle(itemSlide) || `${t("Слайд", "Slide")} ${dotIdx + 1}`;
          dot.setAttribute("aria-label", slideTitle);
          dot.className = `atv-hero-dot${dotIdx === idx ? " active" : ""}`;
          dot.title = slideTitle;
          dot.onclick = (e) => {
            e.stopPropagation();
            if (state.heroIndex === dotIdx) return;
            state.heroIndex = dotIdx;
            renderHeroSlide(dotIdx, true);
            startHeroAutoTimer();
          };
          dotsWrap.appendChild(dot);
        });
      }
    }
  };

  if (state.heroSlideFadeTimer) {
    clearTimeout(state.heroSlideFadeTimer);
    state.heroSlideFadeTimer = null;
  }
  const slideSigNow = `${featured.id || ""}|${state.appLang || "ru"}|${featured.kinorium?.in_watchlist ? 1 : 0}|${featured.kinorium?.watched ? 1 : 0}|${featured.kinorium?.watching ? 1 : 0}|${featured.kinorium?.user_rating || 0}`;
  state._lastHeroSlideSig = slideSigNow;

  if (smooth) {
    heroSection.classList.add("hero-fading");
    state.heroSlideFadeTimer = setTimeout(() => {
      state.heroSlideFadeTimer = null;
      try {
        applyContent();
      } finally {
        heroSection.classList.remove("hero-fading");
      }
      scheduleHeroAmbientTeaser(featured);
    }, 140);
  } else {
    heroSection.classList.remove("hero-fading");
    try {
      applyContent();
    } finally {
      heroSection.classList.remove("hero-fading");
    }
    scheduleHeroAmbientTeaser(featured);
  }
}

export function renderHero(preFilteredItems = null) {
  const heroSection = document.getElementById("hero-banner");
  if (!heroSection) return;

  if (state.searchQuery.trim() || state.kinoriumSection !== "all" || state.catalogItems.length === 0) {
    heroSection.classList.add("hidden");
    heroSection.classList.remove("hero-fading");
    stopHeroAutoTimer();
    return;
  }
  heroSection.classList.remove("hidden");

  const picked = [];
  const seen = new Set();
  const pushUnique = (it) => {
    if (!it || !it.title) return;
    const k = it.id || it.title.trim().toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    picked.push(it);
  };

  const hasTrueWidescreenBackdrop = (it) => {
    const bg = String(displayBackdrop(it) || "").toLowerCase();
    return Boolean(
      bg &&
        !bg.includes("kinorium.com/movie/") &&
        !bg.includes("/poster/")
    );
  };

  const filteredCandidates = Array.isArray(preFilteredItems)
    ? preFilteredItems
    : filterCatalogItemsByGenreAndYear(state.catalogItems);
  const activePool = filteredCandidates.filter((it) => {
    if (state.mediaTypeFilter === "movie") return it.media_type === "movie";
    if (state.mediaTypeFilter === "series") return it.media_type === "series";
    return true;
  });
  const basePool = activePool.length > 0 ? activePool : state.catalogItems;
  const provPrimaryPool =
    state.providerFilter && state.providerFilter !== "all"
      ? basePool.filter((it) => it && it.primary_provider === state.providerFilter)
      : [];
  const sourcePool = provPrimaryPool.length > 0 ? provPrimaryPool : basePool;

  const poolSig = `${state.appLang || "ru"}:${sourcePool.length}:${sourcePool[0]?.id || ""}:${sourcePool[sourcePool.length - 1]?.id || ""}:${state.mediaTypeFilter}:${state.providerFilter}:${state.genreFilter}:${state.yearFilter}:${state.collectionFilter || "all"}:${state.kinoriumSection || "all"}:${state.hideWatched ? 1 : 0}:${state.friendsFilter ? 1 : 0}:${state.selectedFriend || ""}`;
  if (poolSig === _lastHeroPoolSig && Array.isArray(state.heroItems) && state.heroItems.length > 0) {
    if (state.heroIndex >= state.heroItems.length) {
      state.heroIndex = 0;
    }
    const curHero = state.heroItems[state.heroIndex];
    const slideSig = curHero
      ? `${curHero.id || ""}|${state.appLang || "ru"}|${curHero.kinorium?.in_watchlist ? 1 : 0}|${curHero.kinorium?.watched ? 1 : 0}|${curHero.kinorium?.watching ? 1 : 0}|${curHero.kinorium?.user_rating || 0}`
      : "";
    const heroContentEl = document.getElementById("hero-content");
    const heroIsBlank = !heroContentEl || heroContentEl.children.length === 0 || heroSection.classList.contains("hero-fading");
    if (state._lastHeroSlideSig !== slideSig || heroIsBlank) {
      state._lastHeroSlideSig = slideSig;
      renderHeroSlide(state.heroIndex, false);
    }
    if (!state.heroTimerId) {
      startHeroAutoTimer();
    }
    return;
  }
  _lastHeroPoolSig = poolSig;

  const widescreenCandidates = seededShuffle(
    sourcePool.filter(hasTrueWidescreenBackdrop),
    101
  );
  const widescreenMovies = widescreenCandidates.filter((i) => i.media_type === "movie");
  const widescreenSeries = widescreenCandidates.filter((i) => i.media_type === "series");

  // Interleave freshly shuffled movies & series so every launch opens with varied cinema
  const startWithMovie = (_hashItemKey("hero_lead_type", 77) & 1) === 1;
  const maxLen = Math.max(widescreenMovies.length, widescreenSeries.length);
  for (let idx = 0; idx < maxLen; idx++) {
    if (picked.length >= 6) break;
    if (startWithMovie) {
      if (widescreenMovies[idx]) pushUnique(widescreenMovies[idx]);
      if (widescreenSeries[idx]) pushUnique(widescreenSeries[idx]);
    } else {
      if (widescreenSeries[idx]) pushUnique(widescreenSeries[idx]);
      if (widescreenMovies[idx]) pushUnique(widescreenMovies[idx]);
    }
  }

  if (picked.length < 6) {
    seededShuffle(sourcePool.filter((i) => i.backdrop), 103).forEach(pushUnique);
  }
  if (picked.length < 6) {
    seededShuffle(sourcePool, 105).forEach(pushUnique);
  }

  if (picked.length > 1) {
    try {
      const lastHeroId = localStorage.getItem(LAST_HERO_ID_STORAGE_KEY) || "";
      if (!_heroRecordedThisLaunch && lastHeroId && picked[0]?.id === lastHeroId) {
        const tmp = picked[0];
        picked[0] = picked[1];
        picked[1] = tmp;
      }
      if (!_heroRecordedThisLaunch && picked[0]?.id) {
        localStorage.setItem(LAST_HERO_ID_STORAGE_KEY, String(picked[0].id));
        _heroRecordedThisLaunch = true;
      }
    } catch (err) { window.logDebug?.("CatalogHero", err); }
  }

  state.heroItems = picked.slice(0, 6);
  if (state.heroIndex >= state.heroItems.length) {
    state.heroIndex = 0;
  }
  renderHeroSlide(state.heroIndex, false);
  startHeroAutoTimer();
}
