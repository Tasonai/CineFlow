import { state } from "./state.js?v=20261111v2";
import {
  formatRussianTypography,
  hasCyrillicText,
  isEn,
  t,
  translateCareer,
  transliterateRuToEn,
} from "./i18n.js?v=20261111v2";
import {
  attachHorizontalWheelScroll,
  closeCustomSelectMenu,
  escapeAttr,
  escapeHtml,
  expandRussianDateText,
  iconSvg,
  rememberModalTriggerFocus,
  restoreModalTriggerFocus,
  showToast,
  syncScrollTopButton,
  syncSearchInputHasQueryUI,
} from "./utils.js?v=20261111v2";
import { createPosterCardElement } from "./catalog-cards.js?v=20261111v2";
import { isServiceEnabled } from "./catalog-media-resolver.js?v=20261111v2";
import { updateActiveFiltersBadge } from "./catalog-filters.js?v=20261111v2";
import { loadCatalog } from "./catalog.js?v=20261111v2";
import { escapeEpisodeHtml } from "./player-seasons.js?v=20261111v2";
import { closePlayerModal } from "./player.js?v=20261111v2";
import {
  closeQuickPeekModal,
  goBackInModalStack,
  maybePausePlayerForOverlay,
  maybeResumePlayerAfterOverlay,
  syncModalBackButtons,
} from "./modals.js?v=20261111v2";

export function triggerPersonSearch(personName) {
  if (!personName) return;
  closePersonModal({ clearStack: true, suppressResume: true });
  closeQuickPeekModal({ clearStack: true, suppressResume: true });
  if (state.isPlayerOpen) {
    closePlayerModal(true);
  }
  document.getElementById("search-live-popover")?.classList.add("hidden");
  state.searchQuery = personName;
  state.kinoriumSection = "all";
  state.providerFilter = "all";
  state.mediaTypeFilter = "all";
  state.genreFilter = "all";
  state.yearFilter = "all";
  state.friendsFilter = false;
  state.selectedFriend = "all";
  const searchInput = document.getElementById("global-search");
  if (searchInput) searchInput.value = personName;
  const gSel = document.getElementById("select-catalog-genre");
  if (gSel) gSel.value = "all";
  const ySel = document.getElementById("select-catalog-year");
  if (ySel) ySel.value = "all";
  const fSel = document.getElementById("select-friend-filter");
  if (fSel) fSel.value = "all";
  document.getElementById("btn-friends-filter")?.classList.remove("active");
  syncSearchInputHasQueryUI();
  document.querySelectorAll(".kin-sec-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.ksec === "all");
  });
  document.querySelectorAll(".atv-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.provider === "all");
  });
  document.querySelectorAll(".type-pill").forEach((b) => {
    b.classList.toggle("active", b.dataset.type === "all");
  });
  updateActiveFiltersBadge();
  loadCatalog();
  showToast(`${t("Поиск фильмов и сериалов", "Searching movies & series")}: ${personName}`);
}

export function buildFallbackAvatarSvg(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials =
    parts
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || "")
      .join("") || "CF";
  const safeInit = initials.replace(/[<>&"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160"><rect width="120" height="160" fill="#1c1c1e"/><text x="60" y="90" fill="#f5f5f7" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="36" font-weight="600" text-anchor="middle">${safeInit}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function normalizePersonForLang(p) {
  if (!p || !isEn()) return p;
  const rawName = String(p.name || "").trim();
  if (!rawName) return p;
  const enName = p.orig_name && !hasCyrillicText(p.orig_name)
    ? String(p.orig_name).trim()
    : hasCyrillicText(rawName)
    ? transliterateRuToEn(rawName)
    : rawName;
  return {
    ...p,
    name: enName,
    ru_name: p.ru_name || (hasCyrillicText(rawName) ? rawName : ""),
  };
}

export function buildCastPeopleArray(item, streamData = null) {
  const richSource = isEn()
    ? (streamData?.cast_people && !streamData.cast_people.some((p) => hasCyrillicText(p?.name)))
      ? streamData.cast_people
      : item?.cast_people_en || streamData?.cast_people || item?.cast_people || []
    : streamData?.cast_people || item?.cast_people || streamData?.cast_people_en || item?.cast_people_en || [];
  if (Array.isArray(richSource) && richSource.length > 0) {
    return isEn() ? richSource.map(normalizePersonForLang) : richSource;
  }
  const directors = isEn()
    ? streamData?.directors_en || item?.directors_en || streamData?.directors || item?.directors || []
    : streamData?.directors || item?.directors || streamData?.directors_en || item?.directors_en || [];
  const actors = isEn()
    ? streamData?.actors_en || item?.actors_en || streamData?.actors || item?.actors || []
    : streamData?.actors || item?.actors || streamData?.actors_en || item?.actors_en || [];
  const out = [];
  const seen = new Set();
  directors.slice(0, 3).forEach((d) => {
    const raw = String(d || "").trim();
    const disp = isEn() && hasCyrillicText(raw) ? transliterateRuToEn(raw) : raw;
    const key = disp.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      name: disp,
      ru_name: hasCyrillicText(raw) ? raw : "",
      role: isEn() ? "Director" : "Режиссёр",
      is_director: true,
      photo: "",
    });
  });
  actors.slice(0, 10).forEach((a) => {
    const raw = String(a || "").trim();
    const disp = isEn() && hasCyrillicText(raw) ? transliterateRuToEn(raw) : raw;
    const key = disp.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      name: disp,
      ru_name: hasCyrillicText(raw) ? raw : "",
      role: isEn() ? "Cast" : "В ролях",
      is_director: false,
      photo: "",
    });
  });
  return out;
}

export function buildPersonPhotoCard(personObj, onSelect) {
  const pName = personObj?.name || "";
  const isDir = Boolean(personObj?.is_director);
  const rawRole = isDir ? "Режиссёр" : personObj?.role || "В ролях";
  const roleText = isDir
    ? t("Режиссёр", "Director")
    : rawRole === "В ролях" || rawRole === "Актёр" || rawRole === "Cast"
    ? t("В ролях", "Cast")
    : translateCareer(rawRole);
  const hintUrl = personObj?.photo || "";
  const lookupName = personObj?.ru_name || pName;
  const photoEndpoint = `/api/person-photo?name=${encodeURIComponent(lookupName)}${
    hintUrl ? `&url=${encodeURIComponent(hintUrl)}` : ""
  }&strict=1&v=3`;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `atv-person-card${isDir ? " director" : ""}`;
  btn.title = `${isDir ? t("Режиссёр", "Director") : t("Актёр", "Actor")}: ${pName} — ${t("нажмите, чтобы открыть карточку персоны и фильмографию", "click to view profile & filmography")}`;
  btn.innerHTML = `
    <div class="atv-person-avatar-frame">
      <img class="atv-person-avatar" src="${escapeAttr(photoEndpoint)}" alt="${escapeAttr(pName)}" width="96" height="128" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
    </div>
    <div class="atv-person-name">${escapeHtml(pName)}</div>
    <div class="atv-person-role">${escapeHtml(roleText)}</div>
  `;
  const imgEl = btn.querySelector("img");
  if (imgEl) {
    imgEl.style.width = "100%";
    imgEl.style.height = "100%";
    imgEl.style.objectFit = "cover";
    imgEl.style.objectPosition = "center 14%";
    imgEl.onerror = () => {
      imgEl.onerror = null;
      const parentRow = btn.parentElement;
      btn.remove();
      if (parentRow && !parentRow.querySelector(".atv-person-card")) {
        parentRow.closest("#qp-cast-wrap, #meta-cast-section")?.classList.add("hidden");
      }
    };
  }
  btn.onclick = () => {
    if (typeof onSelect === "function") {
      onSelect(personObj);
    } else {
      openPersonModal(personObj);
    }
  };
  return btn;
}

export function syncPersonModalMount() {
  const pseudoStage = document.documentElement?.classList.contains("is-stage-pseudo-fullscreen")
    ? document.getElementById("video-stage")
    : null;
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement || pseudoStage;
  ["person-modal", "quick-peek-modal"].forEach((id) => {
    const mod = document.getElementById(id);
    if (!mod) return;
    const isOpen = !mod.classList.contains("hidden");
    const targetParent = fsEl && isOpen ? fsEl : document.body;
    if (targetParent && mod.parentElement !== targetParent) {
      targetParent.appendChild(mod);
    }
  });
}

let _personModalAbortController = null;

export function closePersonModal(options = {}) {
  closeCustomSelectMenu({ restoreFocus: false });
  if (_personModalAbortController) {
    try {
      _personModalAbortController.abort();
    } catch (_) {}
    _personModalAbortController = null;
  }
  const { clearStack = true, suppressResume = false } = options;
  if (!clearStack) {
    const top = state.navModalStack[state.navModalStack.length - 1];
    if (top && (top.view === "quick-peek" || top.view === "player")) {
      goBackInModalStack();
      return;
    }
  }
  state.navModalStack = [];
  state.personModalReqId += 1;
  document.getElementById("person-modal")?.classList.add("hidden");
  syncPersonModalMount();
  syncModalBackButtons();
  syncScrollTopButton();
  if (!suppressResume) {
    maybeResumePlayerAfterOverlay();
    restoreModalTriggerFocus("person-modal");
  }
}

export function renderPersonStatsStrip(data) {
  const statsBox = document.getElementById("person-kinorium-stats");
  const statsWatchedEl = document.getElementById("person-stats-watched");
  const statsRatingEl = document.getElementById("person-stats-rating");
  const statsFillEl = document.getElementById("person-stats-fill");
  if (!statsBox || !statsWatchedEl || !statsRatingEl || !statsFillEl || !data) return;

  const allItems = Array.isArray(data.all_items) ? data.all_items : [];
  const totalCount = allItems.length || Number(data.stats?.total_count || 0);
  if (!isServiceEnabled("kinorium") || totalCount <= 0) {
    statsBox.classList.add("hidden");
    return;
  }

  let watchedCount = 0;
  let watchingCount = 0;
  let watchlistCount = 0;
  const userScores = [];
  allItems.forEach((it) => {
    const ks = it.kinorium || {};
    if (ks.watched) watchedCount += 1;
    if (ks.watching) watchingCount += 1;
    if (ks.in_watchlist) watchlistCount += 1;
    if (ks.user_rating) userScores.push(Number(ks.user_rating));
  });
  const watchedPct = Math.min(100, Math.round((watchedCount / totalCount) * 100));
  const avgUserRating =
    userScores.length > 0
      ? Math.round((userScores.reduce((a, b) => a + b, 0) / userScores.length) * 10) / 10
      : null;

  statsWatchedEl.innerHTML = `<span class="atv-inline-icon-label">${iconSvg("check", 12)}<span>${t(
    `Просмотрено: ${watchedCount} из ${totalCount} (${watchedPct}%)`,
    `Watched: ${watchedCount} of ${totalCount} (${watchedPct}%)`
  )}</span></span>`;
  statsRatingEl.innerHTML = avgUserRating
    ? `<span class="atv-inline-icon-label"><span>${t("Средняя оценка:", "Avg rating:")}</span>${iconSvg("star", 11)}<strong>${avgUserRating}</strong><span>(${userScores.length})</span></span>`
    : t("Оценок пока нет", "No ratings yet");
  statsFillEl.style.width = `${watchedPct}%`;
  statsBox.classList.remove("hidden");
}

const _PERSON_MONTH_MAP = {
  января: "January",
  февраля: "February",
  марта: "March",
  апреля: "April",
  мая: "May",
  июня: "June",
  июля: "July",
  августа: "August",
  сентября: "September",
  октября: "October",
  ноября: "November",
  декабря: "December",
};
const _PERSON_MONTH_RE_ENTRIES = Object.entries(_PERSON_MONTH_MAP).map(([ruM, enM]) => [new RegExp(ruM, "gi"), enM]);
const _PERSON_GODA_RE = /\bгода\b/gi;
const _PERSON_AGE_RE = /\(\s*(\d+)\s*(?:год|года|лет)\s*\)/gi;
const _PERSON_SPACES_RE = /\s{2,}/g;

function formatBirthDateForLang(rawDate) {
  const cleaned = expandRussianDateText(rawDate);
  if (!isEn() || !cleaned) return cleaned;
  let s = cleaned;
  _PERSON_MONTH_RE_ENTRIES.forEach(([re, enM]) => {
    s = s.replace(re, enM);
  });
  s = s
    .replace(_PERSON_GODA_RE, "")
    .replace(_PERSON_AGE_RE, "($1)")
    .replace(_PERSON_SPACES_RE, " ")
    .trim();
  return hasCyrillicText(s) ? "" : s;
}

export function renderPersonProfileDetails(data) {
  if (!data) return;
  const careerEl = document.getElementById("person-modal-career");
  const nameEl = document.getElementById("person-modal-name");
  const origEl = document.getElementById("person-modal-orig");
  const metaEl = document.getElementById("person-modal-meta");
  const bioEl = document.getElementById("person-modal-bio");

  if (nameEl) {
    if (isEn()) {
      const enName =
        data.orig_name ||
        (!hasCyrillicText(data.name) ? data.name : transliterateRuToEn(data.name || ""));
      if (enName) nameEl.textContent = enName;
    } else if (data.name) {
      nameEl.textContent = data.name;
    }
  }
  if (origEl) {
    origEl.textContent = isEn() ? "" : data.orig_name || "";
  }
  if (careerEl) {
    const cList =
      Array.isArray(data.career) && data.career.length > 0
        ? data.career.map(translateCareer).join(" · ")
        : "";
    if (cList) careerEl.textContent = cList;
  }

  if (metaEl) {
    const chips = [];
    if (data.birth_date) {
      const bDate = formatBirthDateForLang(data.birth_date);
      if (bDate) {
        chips.push(`${iconSvg("calendar", 12)}<span>${escapeEpisodeHtml(bDate)}</span>`);
      }
    }
    if (data.birth_place && (!isEn() || !/[А-Яа-яЁё]/.test(data.birth_place))) {
      chips.push(`${iconSvg("pin", 12)}<span>${escapeEpisodeHtml(data.birth_place)}</span>`);
    }
    metaEl.innerHTML = chips
      .map((c) => `<span class="atv-person-chip atv-inline-icon-label">${c}</span>`)
      .join("");
  }

  if (bioEl) {
    const activeBio = isEn() ? data.bio_en || "" : data.bio || data.bio_en || "";
    if (activeBio && String(activeBio).trim().length > 15) {
      bioEl.textContent = isEn() ? activeBio : formatRussianTypography(activeBio);
      bioEl.classList.remove("hidden");
    } else {
      bioEl.textContent = "";
      bioEl.classList.add("hidden");
    }
  }

  renderPersonStatsStrip(data);
}

export function refreshOpenPersonModalUI(langChanged = false) {
  const modal = document.getElementById("person-modal");
  if (!modal || modal.classList.contains("hidden") || !state.personProfileData) return;
  if (langChanged) {
    const cur = state.personProfileData;
    openPersonModal(
      {
        name: isEn() ? cur.orig_name || cur.name : cur.ru_name || cur.name,
        ru_name: cur.ru_name || "",
        person_url: cur.person_url || "",
        photo: cur.photo || "",
      },
      { skipStackPush: true }
    );
    return;
  }
  renderPersonProfileDetails(state.personProfileData);
  renderPersonFilmographyGrid();
}

export function renderPersonFilmographyGrid({ appendFrom = 0 } = {}) {
  const data = state.personProfileData;
  const gridEl = document.getElementById("person-filmography-grid");
  const tabsEl = document.getElementById("person-role-tabs");
  if (!gridEl || !data) return;

  const rolesList = Array.isArray(data.roles) ? data.roles : [];
  const allItems = Array.isArray(data.all_items) ? data.all_items : [];

  if (tabsEl && appendFrom <= 0) {
    tabsEl.setAttribute("aria-label", t("Роли в фильмографии", "Filmography roles"));
    tabsEl.innerHTML = "";
    const makeTab = (roleKey, label) => {
      const btn = document.createElement("button");
      btn.type = "button";
      const isAct = state.personActiveRole === roleKey;
      const safeKey = String(roleKey || "all").replace(/[^a-zA-Z0-9_-]/g, "_");
      btn.id = `person-role-tab-${safeKey}`;
      btn.dataset.roleKey = String(roleKey || "all");
      btn.className = `atv-person-role-tab${isAct ? " active" : ""}`;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", isAct ? "true" : "false");
      btn.setAttribute("aria-controls", "person-filmography-grid");
      btn.tabIndex = isAct ? 0 : -1;
      if (isAct && gridEl) {
        gridEl.setAttribute("aria-labelledby", btn.id);
      }
      btn.textContent = label;
      btn.onclick = () => {
        state.personActiveRole = roleKey;
        state.personFilmographyLimit = 24;
        renderPersonFilmographyGrid();
        const nextBtn = document.getElementById(`person-role-tab-${safeKey}`);
        nextBtn?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      };
      return btn;
    };
    tabsEl.appendChild(makeTab("all", `${t("Все", "All")} (${allItems.length})`));
    rolesList.forEach((r) => {
      const cnt = Array.isArray(r.items) ? r.items.length : 0;
      if (cnt > 0) {
        tabsEl.appendChild(makeTab(r.role_key || r.role_label, `${translateCareer(r.role_label)} (${cnt})`));
      }
    });
    if (!tabsEl._cfKeyBound) {
      tabsEl._cfKeyBound = true;
      tabsEl.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
        const tabs = Array.from(tabsEl.querySelectorAll("[role='tab']:not(.hidden)"));
        if (tabs.length < 2) return;
        const curIdx = tabs.indexOf(document.activeElement);
        if (curIdx < 0) return;
        e.preventDefault();
        let nextIdx = curIdx;
        if (e.key === "ArrowRight") nextIdx = (curIdx + 1) % tabs.length;
        else if (e.key === "ArrowLeft") nextIdx = (curIdx - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") nextIdx = 0;
        else if (e.key === "End") nextIdx = tabs.length - 1;
        const target = tabs[nextIdx];
        if (target) {
          const targetId = target.id;
          target.click();
          if (targetId) {
            document.getElementById(targetId)?.focus({ preventScroll: true });
          }
        }
      });
    }
  }

  let itemsToShow = allItems;
  if (state.personActiveRole !== "all") {
    const matchedRole = rolesList.find(
      (r) => (r.role_key || r.role_label) === state.personActiveRole
    );
    if (matchedRole && Array.isArray(matchedRole.items)) {
      itemsToShow = matchedRole.items;
    }
  }

  const startIdx = appendFrom > 0 ? appendFrom : 0;
  if (startIdx === 0) {
    gridEl.innerHTML = "";
  }
  const prevMore = document.getElementById("person-load-more-row");
  if (prevMore) prevMore.remove();
  if (itemsToShow.length === 0) {
    gridEl.innerHTML = `<div class="atv-grid-empty-note">${t("Фильмы для выбранной роли не найдены — нажмите «Найти в основном каталоге» выше.", "No titles found for this role — click \"Find in Catalog\" above.")}</div>`;
    return;
  }

  const limit = Math.max(24, Number(state.personFilmographyLimit) || 24);
  const visibleSlice = itemsToShow.slice(startIdx, limit);
  if (visibleSlice.length > 0) {
    const frag = document.createDocumentFragment();
    visibleSlice.forEach((filmItem) => {
      frag.appendChild(createPosterCardElement(filmItem));
    });
    gridEl.appendChild(frag);
  }

  if (itemsToShow.length > limit && gridEl.parentElement) {
    const moreRow = document.createElement("div");
    moreRow.id = "person-load-more-row";
    moreRow.className = "atv-person-load-more-row";
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "atv-btn-secondary atv-person-load-more-btn";
    const remaining = itemsToShow.length - limit;
    const nextBatch = Math.min(24, remaining);
    moreBtn.textContent = t(
      `Показать ещё ${nextBatch} из ${remaining}`,
      `Show ${nextBatch} more of ${remaining}`
    );
    moreBtn.onclick = () => {
      state.personFilmographyLimit = limit + 24;
      renderPersonFilmographyGrid({ appendFrom: limit });
    };
    moreRow.appendChild(moreBtn);
    gridEl.parentElement.appendChild(moreRow);
  }
}

export async function openPersonModal(personInput, options = {}) {
  const { skipStackPush = false } = options;
  const personObj =
    typeof personInput === "string"
      ? { name: personInput, person_url: "", photo: "", role: "" }
      : personInput || {};
  const pName = (personObj.name || personObj.orig_name || "").trim();
  if (!pName) return;

  const modal = document.getElementById("person-modal");
  if (!modal) {
    triggerPersonSearch(pName);
    return;
  }

  const wasPersonHidden = modal.classList.contains("hidden");
  if (wasPersonHidden) {
    rememberModalTriggerFocus("person-modal");
  }
  const qpMod = document.getElementById("quick-peek-modal");
  const qpWasOpen = Boolean(qpMod && !qpMod.classList.contains("hidden"));
  const cameFromQuickPeek = Boolean(qpWasOpen && state.quickPeekItem);
  const ctxItem = cameFromQuickPeek
    ? state.quickPeekItem
    : state.isPlayerOpen && state.activeItem
    ? state.activeItem
    : null;
  if (!skipStackPush) {
    if (cameFromQuickPeek) {
      if (state.navModalStack.length >= 12) {
        state.navModalStack.shift();
      }
      const qpSheetEl = qpMod.querySelector(".atv-quickpeek-sheet");
      state.navModalStack.push({
        view: "quick-peek",
        item: state.quickPeekItem,
        scrollTop: qpSheetEl ? qpSheetEl.scrollTop : 0,
      });
    } else if (
      wasPersonHidden &&
      state.isPlayerOpen &&
      !state.isMiniPlayer &&
      !state.isPipBackground &&
      state.activeItem
    ) {
      state.navModalStack.push({
        view: "player",
        item: state.activeItem,
      });
    }
  }
  if (qpWasOpen && qpMod) {
    state.quickPeekReqId += 1;
    qpMod.classList.add("hidden");
  }
  syncModalBackButtons();

  state.personModalReqId += 1;
  const reqId = state.personModalReqId;
  if (_personModalAbortController) {
    try {
      _personModalAbortController.abort();
    } catch (_) {}
  }
  _personModalAbortController = typeof AbortController !== "undefined" ? new AbortController() : null;
  const personAbortSignal = _personModalAbortController ? _personModalAbortController.signal : undefined;
  state.personModalPerson = personObj;
  state.personProfileData = null;
  state.personActiveRole = options.restoreActiveRole || "all";
  state.personFilmographyLimit = 24;

  const photoEl = document.getElementById("person-modal-photo");
  const careerEl = document.getElementById("person-modal-career");
  const nameEl = document.getElementById("person-modal-name");
  const origEl = document.getElementById("person-modal-orig");
  const metaEl = document.getElementById("person-modal-meta");
  const bioEl = document.getElementById("person-modal-bio");
  const statsBox = document.getElementById("person-kinorium-stats");
  const searchBtn = document.getElementById("btn-person-search-catalog");
  const tabsEl = document.getElementById("person-role-tabs");
  const loadingEl = document.getElementById("person-modal-loading");
  const gridEl = document.getElementById("person-filmography-grid");

  const initPhotoHint = personObj.photo || personObj.avatar || "";
  const lookupPersonName = personObj.ru_name || pName;
  if (photoEl) {
    const fallbackPersonSvg = buildFallbackAvatarSvg(pName);
    photoEl.style.backgroundImage = `url("${fallbackPersonSvg}")`;
    photoEl.style.backgroundSize = "cover";
    photoEl.style.backgroundPosition = "center";
    photoEl.src = `/api/person-photo?name=${encodeURIComponent(lookupPersonName)}${
      initPhotoHint ? `&url=${encodeURIComponent(initPhotoHint)}` : ""
    }&v=2`;
    photoEl.alt = pName;
    photoEl.onerror = () => {
      photoEl.onerror = null;
      photoEl.src = fallbackPersonSvg;
    };
  }
  if (careerEl) {
    careerEl.textContent = personObj.is_director
      ? t("Режиссёр", "Director")
      : translateCareer(personObj.role || t("Актёр / Режиссёр", "Actor / Director"));
  }
  if (nameEl) nameEl.textContent = pName;
  if (origEl) origEl.textContent = "";
  if (metaEl) metaEl.innerHTML = "";
  if (bioEl) {
    bioEl.textContent = "";
    bioEl.classList.add("hidden");
  }
  if (statsBox) statsBox.classList.add("hidden");
  if (tabsEl) tabsEl.innerHTML = "";
  if (gridEl) gridEl.innerHTML = "";
  if (loadingEl) loadingEl.classList.remove("hidden");
  if (searchBtn) {
    searchBtn.onclick = () => triggerPersonSearch(pName);
  }

  maybePausePlayerForOverlay();
  modal.classList.remove("hidden");
  syncPersonModalMount();
  modal.querySelector(".atv-person-sheet-scroll")?.scrollTo({ top: 0 });
  requestAnimationFrame(() => {
    document.getElementById("close-person-modal")?.focus({ preventScroll: true });
  });
  syncScrollTopButton();

  try {
    const params = new URLSearchParams({
      name: personObj.person_url ? lookupPersonName : pName,
      url: personObj.person_url || "",
      hint_title: ctxItem?.title || "",
      hint_orig: ctxItem?.orig_title || "",
      lang: state.appLang || "ru",
    });
    const res = await fetch(
      `/api/person?${params.toString()}`,
      personAbortSignal ? { signal: personAbortSignal } : undefined
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (reqId !== state.personModalReqId) return;
    if (data?.error) throw new Error(data.error);

    if (!data.orig_name && !hasCyrillicText(pName)) {
      data.orig_name = pName;
    }
    state.personProfileData = data;
    if (loadingEl) loadingEl.classList.add("hidden");

    const bestPhoto = data.photo || initPhotoHint;
    if (photoEl && bestPhoto) {
      photoEl.src = `/api/person-photo?name=${encodeURIComponent(data.name || pName)}&url=${encodeURIComponent(bestPhoto)}&v=2`;
      photoEl.onerror = () => {
        photoEl.onerror = null;
        photoEl.src = buildFallbackAvatarSvg(data.name || pName);
      };
    }

    renderPersonProfileDetails(data);

    // Default to "director" tab if person was clicked as a Director and has directed items, else "all"
    if (options.restoreActiveRole) {
      state.personActiveRole = options.restoreActiveRole;
    } else if (
      personObj.is_director &&
      Array.isArray(data.roles) &&
      data.roles.some((r) => r.role_key === "director" && r.items?.length > 0) &&
      data.roles.length > 1
    ) {
      state.personActiveRole = "director";
    } else {
      state.personActiveRole = "all";
    }
    renderPersonFilmographyGrid();
    if (typeof options.restoreScrollTop === "number") {
      requestAnimationFrame(() => {
        const scroller = modal.querySelector(".atv-person-sheet-scroll");
        if (scroller) scroller.scrollTop = options.restoreScrollTop;
      });
    }
  } catch (err) {
    if (reqId !== state.personModalReqId) return;
    if (loadingEl) loadingEl.classList.add("hidden");
    if (gridEl) {
      gridEl.innerHTML = `<div class="atv-grid-error-note">${t("Не удалось загрузить карточку персоны — нажмите «Найти в основном каталоге».", "Failed to load person profile — click \"Find in Catalog\" above.")}</div>`;
    }
  }
}

export function renderModalCastSection(item, streamData = null) {
  const secEl = document.getElementById("meta-cast-section");
  const listEl = document.getElementById("meta-cast-list");
  const durBadge = document.getElementById("meta-duration-badge");
  if (!secEl || !listEl) return;

  const people = buildCastPeopleArray(item, streamData);

  if (durBadge) {
    durBadge.classList.add("hidden");
  }

  if (people.length === 0) {
    if (!streamData && item && (item.title || item.orig_title)) {
      secEl.classList.remove("hidden");
      listEl.innerHTML = `
        <div class="atv-cast-card-skeleton"></div>
        <div class="atv-cast-card-skeleton"></div>
        <div class="atv-cast-card-skeleton"></div>
        <div class="atv-cast-card-skeleton"></div>
      `;
      return;
    }
    secEl.classList.add("hidden");
    listEl.innerHTML = "";
    return;
  }
  const visiblePeople = people.slice(0, 14);
  const castRenderSig = `${item?.id || item?.title || ""}|${state.appLang || "ru"}|${visiblePeople.map((p) => `${p.name || ""}:${p.role || ""}:${p.photo || ""}`).join(",")}`;
  secEl.classList.remove("hidden");
  if (listEl._castRenderSig === castRenderSig && listEl.childElementCount > 0) {
    return;
  }
  listEl._castRenderSig = castRenderSig;
  listEl.innerHTML = "";
  attachHorizontalWheelScroll(listEl);

  const frag = document.createDocumentFragment();
  visiblePeople.forEach((p) => {
    frag.appendChild(buildPersonPhotoCard(p, (personObj) => openPersonModal(personObj)));
  });
  listEl.appendChild(frag);
}
