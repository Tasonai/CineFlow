import { state } from "./state.js?v=20261104v24";
import {
  displayDescription,
  displayPoster,
  displayTitle,
  hasCyrillicText,
  isEn,
  t,
  translateGenre,
  transliterateRuToEn,
} from "./i18n.js?v=20261104v24";
import {
  escapeAttr,
  escapeHtml,
  iconSvg,
  rememberModalTriggerFocus,
  restoreModalTriggerFocus,
  syncScrollTopButton,
} from "./utils.js?v=20261104v24";
import {
  maybePausePlayerForOverlay,
  maybeResumePlayerAfterOverlay,
  openPersonModal,
  openQuickPeekModal,
} from "./modals.js?v=20261104v24";
import { openPlayerModal } from "./player.js?v=20261104v24";
import {
  getPrimaryRating,
  resolvePreferredPlayTab,
  resolveSeriesEpisodeInfo,
} from "./catalog-media-resolver.js?v=20261104v24";
import {
  scheduleHeroAmbientTeaser,
  stopHeroAmbientTeaser,
} from "./catalog-hero.js?v=20261104v24";

export function openMovieRouletteModal() {
  const modal = document.getElementById("movie-roulette-modal");
  if (!modal) return;
  if (modal.classList.contains("hidden")) {
    rememberModalTriggerFocus("movie-roulette-modal");
  }
  maybePausePlayerForOverlay();
  modal.classList.remove("hidden");
  stopHeroAmbientTeaser();
  initMovieRouletteModal();
  syncScrollTopButton();
  requestAnimationFrame(() => {
    (
      document.getElementById("btn-spin-roulette") ||
      document.getElementById("btn-close-roulette")
    )?.focus({ preventScroll: true });
  });
}

export function closeMovieRouletteModal() {
  if (state.rouletteIntervalId) {
    clearInterval(state.rouletteIntervalId);
    state.rouletteIntervalId = null;
  }
  const spinBtn = document.getElementById("btn-spin-roulette");
  if (spinBtn) spinBtn.disabled = false;
  const stage = document.querySelector(".atv-roulette-stage");
  if (stage) stage.classList.remove("atv-roulette-spinning");
  const modal = document.getElementById("movie-roulette-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  syncScrollTopButton();
  maybeResumePlayerAfterOverlay();
  restoreModalTriggerFocus("movie-roulette-modal");
  scheduleHeroAmbientTeaser();
}

let _rouletteInitDone = false;
export function initMovieRouletteModal() {
  if (_rouletteInitDone) return;
  _rouletteInitDone = true;

  document.querySelectorAll("#roulette-type-pills .atv-roulette-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#roulette-type-pills .atv-roulette-pill").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      state.rouletteType = btn.dataset.type || "all";
    });
  });

  document.querySelectorAll("#roulette-mood-pills .atv-roulette-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#roulette-mood-pills .atv-roulette-pill").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      state.rouletteMood = btn.dataset.mood || "all";
    });
  });

  document.querySelectorAll("#roulette-rating-pills .atv-roulette-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#roulette-rating-pills .atv-roulette-pill").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      state.rouletteMinRating = parseFloat(btn.dataset.minRating || "0") || 0;
    });
  });

  const spinBtn = document.getElementById("btn-spin-roulette");
  if (spinBtn) {
    spinBtn.addEventListener("click", () => {
      spinMovieRoulette();
    });
  }

  const closeBtn = document.getElementById("btn-close-roulette");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      closeMovieRouletteModal();
    });
  }

  const modal = document.getElementById("movie-roulette-modal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target.id === "movie-roulette-modal") {
        closeMovieRouletteModal();
      }
    });
  }
}

export function spinMovieRoulette() {
  const placeholder = document.getElementById("roulette-placeholder");
  const winnerCard = document.getElementById("roulette-winner-card");
  const spinBtn = document.getElementById("btn-spin-roulette");
  const stage = document.querySelector(".atv-roulette-stage");
  if (!winnerCard || !stage) return;

  let candidates = Array.isArray(state.catalogItems) && state.catalogItems.length > 0
    ? [...state.catalogItems]
    : [];

  if (candidates.length === 0 && Array.isArray(state.heroItems) && state.heroItems.length > 0) {
    candidates = [...state.heroItems];
  }

  if (state.rouletteType && state.rouletteType !== "all") {
    candidates = candidates.filter((it) => it.media_type === state.rouletteType);
  }

  if (state.rouletteMinRating > 0) {
    candidates = candidates.filter((it) => {
      const rating = Number(getPrimaryRating(it) || it.rating || it.vote_average || it.kinorium?.rating || 0);
      return rating >= state.rouletteMinRating;
    });
  }

  const moodMap = {
    action: ["боевик", "приключения", "криминал", "action", "adventure", "crime"],
    cozy: ["семейный", "мультфильм", "фэнтези", "family", "animation", "fantasy"],
    comedy: ["комедия", "comedy"],
    thriller: ["триллер", "ужасы", "детектив", "thriller", "horror", "mystery"],
    drama: ["драма", "биография", "история", "drama", "biography", "history"],
    scifi: ["фантастика", "sci-fi", "science fiction"],
  };

  if (state.rouletteMood && state.rouletteMood !== "all" && moodMap[state.rouletteMood]) {
    const targetKeywords = moodMap[state.rouletteMood];
    const moodFiltered = candidates.filter((it) => {
      const genres = getItemGenreEntries(it).flatMap((g) => {
        if (typeof g === "string") return [g.toLowerCase()];
        return [g.ru, g.en, g.raw, g.label, g.name]
          .filter(Boolean)
          .map((s) => String(s).toLowerCase());
      });
      return targetKeywords.some((kw) => genres.some((g) => g.includes(kw)));
    });
    if (moodFiltered.length > 0) {
      candidates = moodFiltered;
    }
  }

  if (candidates.length === 0) {
    showToast(t("Нет подходящих фильмов по выбранным параметрам", "No matching titles found for selected filters"));
    return;
  }

  if (spinBtn) spinBtn.disabled = true;
  if (placeholder) placeholder.classList.add("hidden");
  winnerCard.classList.remove("hidden");

  if (state.rouletteIntervalId) {
    clearInterval(state.rouletteIntervalId);
    state.rouletteIntervalId = null;
  }

  const prefersReducedMotion =
    typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  if (prefersReducedMotion) {
    stage.classList.remove("atv-roulette-spinning");
    if (spinBtn) spinBtn.disabled = false;
    const winner = candidates[Math.floor(Math.random() * candidates.length)];
    renderRouletteCard(winnerCard, winner, true);
    requestAnimationFrame(() => {
      (document.getElementById("btn-roulette-watch") || spinBtn)?.focus({ preventScroll: true });
    });
    return;
  }

  stage.classList.add("atv-roulette-spinning");
  let counter = 0;
  const maxTicks = 16;
  const interval = setInterval(() => {
    const randomPick = candidates[Math.floor(Math.random() * candidates.length)];
    renderRouletteCard(winnerCard, randomPick, false);
    counter += 1;
    if (counter >= maxTicks) {
      clearInterval(interval);
      if (state.rouletteIntervalId === interval) {
        state.rouletteIntervalId = null;
      }
      stage.classList.remove("atv-roulette-spinning");
      if (spinBtn) spinBtn.disabled = false;
      const winner = candidates[Math.floor(Math.random() * candidates.length)];
      renderRouletteCard(winnerCard, winner, true);
      requestAnimationFrame(() => {
        (document.getElementById("btn-roulette-watch") || spinBtn)?.focus({ preventScroll: true });
      });
    }
  }, 75);
  state.rouletteIntervalId = interval;
}

function renderRouletteCard(container, item, isFinal = false) {
  if (!container || !item) return;
  const title = displayTitle(item) || item.title || "";
  const year = item.year || "";
  const ratingNum = Number(getPrimaryRating(item) || item.rating || item.vote_average || item.kinorium?.rating || 0);
  const rating = ratingNum > 0 ? ratingNum.toFixed(1) : "";
  const poster = displayPoster(item) || "/icons/poster-placeholder.png";
  const genres = getItemGenreEntries(item)
    .slice(0, 3)
    .map((g) => (typeof g === "string" ? translateGenre(g) : g.label || g.en || g.ru || g.raw || g.name || ""))
    .filter(Boolean)
    .join(", ");
  const overview = displayDescription(item) || item.overview || "";

  container.innerHTML = `
    <img class="atv-roulette-poster" src="${escapeAttr(poster)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
    <div class="atv-roulette-info">
      <div class="atv-roulette-title">${escapeHtml(title)}</div>
      <div class="atv-roulette-meta-row">
        ${rating > 0 ? `<span class="atv-roulette-score">${escapeHtml(rating)}</span>` : ""}
        ${year ? `<span>${escapeHtml(String(year))}</span>` : ""}
        ${genres ? `<span class="atv-roulette-genres">${escapeHtml(genres)}</span>` : ""}
      </div>
      ${overview ? `<div class="atv-roulette-overview">${escapeHtml(overview)}</div>` : ""}
      ${
        isFinal
          ? `
        <div class="atv-roulette-card-actions">
          <button type="button" class="atv-btn-primary atv-btn-sm" id="btn-roulette-watch">
            <svg class="atv-ico" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M6.2 4.85v14.3a1 1 0 0 0 1.53.85l11.2-7.15a1 1 0 0 0 0-1.7L7.73 4a1 1 0 0 0-1.53.85z"/></svg>
            <span>${t("Смотреть", "Watch")}</span>
          </button>
          <button type="button" class="atv-btn-secondary atv-btn-sm" id="btn-roulette-details">
            ${t("Подробнее", "Details")}
          </button>
        </div>`
          : ""
      }
    </div>
  `;

  if (isFinal) {
    const watchBtn = container.querySelector("#btn-roulette-watch");
    if (watchBtn) {
      watchBtn.onclick = () => {
        closeMovieRouletteModal();
        const info = resolveSeriesEpisodeInfo(item);
        openPlayerModal(item, resolvePreferredPlayTab(item, info.season, info.episode), info.season, info.episode, info.currentTime);
      };
    }
    const detailsBtn = container.querySelector("#btn-roulette-details");
    if (detailsBtn) {
      detailsBtn.onclick = () => {
        closeMovieRouletteModal();
        openQuickPeekModal(item);
      };
    }
  }
}

// ============================================================================
// Apple TV Command Palette (Cmd+K / Ctrl+K)
// ============================================================================

let _paletteInitDone = false;
let _paletteActiveIdx = 0;
let _paletteDebounceTimer = null;
let _paletteAbortCtrl = null;

export function openCommandPalette(options = {}) {
  const modal = document.getElementById("command-palette-modal");
  if (!modal) return;
  if (modal.classList.contains("hidden")) {
    rememberModalTriggerFocus("command-palette-modal");
  }
  maybePausePlayerForOverlay();
  modal.classList.toggle("is-instant-open", Boolean(options?.instant));
  modal.classList.remove("hidden");
  initCommandPalette();
  syncScrollTopButton();
  const input = document.getElementById("command-palette-input");
  if (input) {
    input.value = "";
    input.setAttribute("aria-expanded", "true");
    input.focus({ preventScroll: true });
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }
  renderCommandPaletteDefaultResults();
}

export function closeCommandPalette() {
  const modal = document.getElementById("command-palette-modal");
  if (!modal) return;
  modal.classList.remove("is-instant-open");
  modal.classList.add("hidden");
  const input = document.getElementById("command-palette-input");
  if (input) {
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  syncScrollTopButton();
  maybeResumePlayerAfterOverlay();
  restoreModalTriggerFocus("command-palette-modal");
  if (_paletteAbortCtrl) {
    _paletteAbortCtrl.abort();
    _paletteAbortCtrl = null;
  }
}

export function initCommandPalette() {
  if (_paletteInitDone) return;
  _paletteInitDone = true;

  const modal = document.getElementById("command-palette-modal");
  const input = document.getElementById("command-palette-input");
  const closeBtn = document.getElementById("btn-close-palette");

  closeBtn?.addEventListener("click", () => {
    closeCommandPalette();
  });

  modal?.addEventListener("click", (e) => {
    if (e.target.id === "command-palette-modal") {
      closeCommandPalette();
    }
  });

  input?.addEventListener("input", () => {
    const q = (input.value || "").trim();
    if (_paletteDebounceTimer) {
      clearTimeout(_paletteDebounceTimer);
    }
    if (!q) {
      renderCommandPaletteDefaultResults();
      return;
    }
    _paletteDebounceTimer = setTimeout(() => {
      searchCommandPalette(q);
    }, 180);
  });

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeCommandPalette();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      stepCommandPaletteActive(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      stepCommandPaletteActive(-1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const activeEl = document.querySelector(".atv-palette-item.is-active");
      if (activeEl) {
        activeEl.click();
      }
    }
  });
}

function stepCommandPaletteActive(delta) {
  const items = Array.from(document.querySelectorAll(".atv-palette-item"));
  if (items.length === 0) return;
  _paletteActiveIdx = Math.max(0, Math.min(items.length - 1, _paletteActiveIdx + delta));
  const input = document.getElementById("command-palette-input");
  items.forEach((it, idx) => {
    const active = idx === _paletteActiveIdx;
    it.classList.toggle("is-active", active);
    it.setAttribute("aria-selected", active ? "true" : "false");
    if (active) {
      if (input && it.id) input.setAttribute("aria-activedescendant", it.id);
      it.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
}

function renderCommandPaletteDefaultResults() {
  const container = document.getElementById("command-palette-results");
  if (!container) return;
  _paletteActiveIdx = 0;

  const defaultActions = [
    {
      title: t("Буду смотреть", "Watchlist"),
      meta: t("Ваш сохранённый список фильмов и сериалов", "Your saved movies and TV shows"),
      icon: iconSvg("bookmark", 16),
      action: () => {
        closeCommandPalette();
        const tab =
          document.querySelector('.kin-sec-pill[data-ksec="watchlist"]') ||
          document.querySelector('.media-type-btn[data-type="watchlist"]') ||
          document.querySelector('.media-type-btn[data-type="kinorium_watchlist"]');
        if (tab) tab.click();
      },
    },
    {
      title: t("Загрузки в дорогу", "Offline Downloads"),
      meta: t("Офлайн-фильмы и серии на диске", "Offline saved movies and episodes"),
      icon: iconSvg("download", 16),
      action: () => {
        closeCommandPalette();
        document.getElementById("btn-open-downloads-modal")?.click();
      },
    },
    {
      title: t("История и статистика", "History and Stats"),
      meta: t("Статистика просмотров и оценки", "Watch statistics and ratings"),
      icon: iconSvg("star", 16),
      action: () => {
        closeCommandPalette();
        document.getElementById("btn-open-stats-modal")?.click();
      },
    },
    {
      title: t("Что посмотреть сегодня (Рулетка)", "Random Picker (Roulette)"),
      meta: t("Случайный подбор по настроению и рейтингу", "Mood and rating movie roulette"),
      icon: iconSvg("shuffle", 16),
      action: () => {
        closeCommandPalette();
        openMovieRouletteModal();
      },
    },
    {
      title: t("Настройки приложения", "Settings"),
      meta: t("Сервисы, сеть, озвучки и плеер", "Services, network, audio and player"),
      icon: iconSvg("settings", 16),
      action: () => {
        closeCommandPalette();
        document.getElementById("open-settings-btn")?.click();
      },
    },
  ];

  let html = `<div class="atv-palette-group-title">${t("Быстрый переход", "Quick Navigation")}</div>`;
  defaultActions.forEach((item, idx) => {
    html += `
      <button type="button" role="option" aria-selected="${idx === 0 ? "true" : "false"}" id="palette-opt-${idx}" class="atv-palette-item ${idx === 0 ? "is-active" : ""}" data-idx="${idx}">
        <div class="atv-palette-item-icon">${item.icon}</div>
        <div class="atv-palette-item-text">
          <div class="atv-palette-item-title">${escapeHtml(item.title)}</div>
          <div class="atv-palette-item-meta">${escapeHtml(item.meta)}</div>
        </div>
      </button>
    `;
  });
  container.innerHTML = html;
  const input = document.getElementById("command-palette-input");
  if (input && defaultActions.length > 0) {
    input.setAttribute("aria-activedescendant", "palette-opt-0");
  }

  container.querySelectorAll(".atv-palette-item").forEach((btn, idx) => {
    btn.addEventListener("click", () => {
      defaultActions[idx]?.action();
    });
    btn.addEventListener("pointerenter", () => {
      _paletteActiveIdx = idx;
      container.querySelectorAll(".atv-palette-item").forEach((b, i) => {
        const act = i === idx;
        b.classList.toggle("is-active", act);
        b.setAttribute("aria-selected", act ? "true" : "false");
      });
      if (input && btn.id) input.setAttribute("aria-activedescendant", btn.id);
    });
  });
}

async function searchCommandPalette(query) {
  const container = document.getElementById("command-palette-results");
  if (!container) return;
  if (_paletteAbortCtrl) {
    _paletteAbortCtrl.abort();
  }
  _paletteAbortCtrl = new AbortController();

  _paletteActiveIdx = 0;
  const qLower = query.toLowerCase();

  const localCandidates = (Array.isArray(state.catalogItems) ? state.catalogItems : []).concat(
    Array.isArray(state.heroItems) ? state.heroItems : []
  );
  const seenIds = new Set();
  const localMatched = [];
  for (const it of localCandidates) {
    if (!it || seenIds.has(it.id)) continue;
    const tRu = (it.title || "").toLowerCase();
    const tOrig = (it.orig_title || "").toLowerCase();
    if (tRu.includes(qLower) || tOrig.includes(qLower)) {
      seenIds.add(it.id);
      localMatched.push(it);
      if (localMatched.length >= 8) break;
    }
  }

  let networkTitles = [];
  let networkPersons = [];
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&lang=${state.appLang || "ru"}`, {
      signal: _paletteAbortCtrl.signal,
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.items)) {
        for (const it of data.items) {
          if (it && !seenIds.has(it.id)) {
            seenIds.add(it.id);
            networkTitles.push(it);
          }
        }
      }
      const personsArr = Array.isArray(data.persons)
        ? data.persons
        : Array.isArray(data.matched_persons)
        ? data.matched_persons
        : [];
      if (personsArr.length > 0) {
        networkPersons = personsArr.slice(0, 4);
      }
    }
  } catch (_) {}

  const allTitles = localMatched.concat(networkTitles).slice(0, 10);

  if (allTitles.length === 0 && networkPersons.length === 0) {
    container.innerHTML = `<div class="atv-palette-empty">${t("Ничего не найдено", "No results found")}</div>`;
    return;
  }

  let html = "";
  const actionsList = [];

  if (allTitles.length > 0) {
    html += `<div class="atv-palette-group-title">${t("Фильмы и сериалы", "Movies and Series")}</div>`;
    allTitles.forEach((item) => {
      const idx = actionsList.length;
      actionsList.push({ type: "item", data: item });
      const pTitle = displayTitle(item);
      const poster = displayPoster(item) || "/icons/poster-placeholder.png";
      const ratingNum = Number(getPrimaryRating(item) || item.rating || item.vote_average || item.kinorium?.rating || 0);
      const rating = ratingNum > 0 ? ratingNum.toFixed(1) : "";
      const metaStr = [item.year, item.media_type === "series" ? t("Сериал", "Series") : t("Фильм", "Movie")]
        .filter(Boolean)
        .join(" · ");

      html += `
        <button type="button" role="option" aria-selected="${idx === 0 ? "true" : "false"}" id="palette-opt-${idx}" class="atv-palette-item ${idx === 0 ? "is-active" : ""}" data-idx="${idx}">
          <img class="atv-palette-item-poster" src="${escapeAttr(poster)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
          <div class="atv-palette-item-text">
            <div class="atv-palette-item-title">${escapeHtml(pTitle)}</div>
            <div class="atv-palette-item-meta">
              <span>${escapeHtml(metaStr)}</span>
              ${rating > 0 ? `<span class="atv-palette-item-badge">${iconSvg("star", 11)} <span>${escapeHtml(rating)}</span></span>` : ""}
            </div>
          </div>
        </button>
      `;
    });
  }

  if (networkPersons.length > 0) {
    html += `<div class="atv-palette-group-title">${t("Персоны", "People")}</div>`;
    networkPersons.forEach((person) => {
      const idx = actionsList.length;
      actionsList.push({ type: "person", data: person });
      const rawName = person.name || person.orig_name || "";
      const pName =
        isEn()
          ? person.orig_name || (hasCyrillicText(rawName) ? transliterateRuToEn(rawName) : rawName)
          : rawName;
      const photoSrc =
        person.photo_endpoint ||
        `/api/person-photo?name=${encodeURIComponent(rawName)}&person_url=${encodeURIComponent(
          person.person_url || ""
        )}&url=${encodeURIComponent(person.photo || person.avatar || "")}&hint=${encodeURIComponent(
          person.photo || person.avatar || ""
        )}`;
      const pRole = person.role || t("Актёр", "Actor");

      html += `
        <button type="button" role="option" aria-selected="${idx === 0 ? "true" : "false"}" id="palette-opt-${idx}" class="atv-palette-item ${idx === 0 ? "is-active" : ""}" data-idx="${idx}">
          <img class="atv-palette-item-poster is-person-avatar" src="${escapeAttr(photoSrc)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
          <div class="atv-palette-item-text">
            <div class="atv-palette-item-title">${escapeHtml(pName)}</div>
            <div class="atv-palette-item-meta">${escapeHtml(pRole)}</div>
          </div>
        </button>
      `;
    });
  }

  container.innerHTML = html;
  const input = document.getElementById("command-palette-input");
  if (input && actionsList.length > 0) {
    input.setAttribute("aria-activedescendant", "palette-opt-0");
  }

  container.querySelectorAll(".atv-palette-item").forEach((btn, idx) => {
    btn.addEventListener("click", () => {
      closeCommandPalette();
      const target = actionsList[idx];
      if (!target) return;
      if (target.type === "item") {
        openQuickPeekModal(target.data);
      } else if (target.type === "person") {
        openPersonModal(target.data);
      }
    });
    btn.addEventListener("pointerenter", () => {
      _paletteActiveIdx = idx;
      container.querySelectorAll(".atv-palette-item").forEach((b, i) => {
        const act = i === idx;
        b.classList.toggle("is-active", act);
        b.setAttribute("aria-selected", act ? "true" : "false");
      });
      if (input && btn.id) input.setAttribute("aria-activedescendant", btn.id);
    });
  });
}
