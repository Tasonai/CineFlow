import {
  EPISODE_PROGRESS_STORAGE_KEY,
  SEEN_NOTIFICATIONS_STORAGE_KEY,
  UI_PREFS_STORAGE_KEY,
  WATCH_HISTORY_STORAGE_KEY,
  state,
} from "./state.js?v=20261024v4";
import { isEn, t } from "./i18n.js?v=20261024v4";
import { isAnyOverlayModalOpen } from "./catalog.js?v=20261024v4";

export function escapeAttr(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
export function escapeHtml(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
export async function withKinoriumActionLock(lockKey, controls, asyncFn) {
  const key = String(lockKey || "kinorium_action");
  if (state.pendingKinoriumLocks[key]) return;
  state.pendingKinoriumLocks[key] = true;
  const btnList = (Array.isArray(controls) ? controls : [controls]).filter(Boolean);
  btnList.forEach((b) => {
    b.disabled = true;
  });
  try {
    await asyncFn();
  } finally {
    delete state.pendingKinoriumLocks[key];
    btnList.forEach((b) => {
      b.disabled = false;
    });
  }
}
export function getTopOpenModalSheet() {
  const orderedModals = [
    ["confirm-modal", ".atv-confirm-sheet"],
    ["person-modal", ".atv-person-sheet"],
    ["quick-peek-modal", ".atv-quickpeek-sheet"],
    ["stats-modal", ".atv-settings-sheet"],
    ["settings-modal", ".atv-settings-sheet"],
    ["player-modal", ".atv-cinema-sheet"],
  ];
  for (const [modalId, sheetSel] of orderedModals) {
    const mod = document.getElementById(modalId);
    if (!mod || mod.classList.contains("hidden")) continue;
    if (
      modalId === "player-modal" &&
      (mod.classList.contains("mini-player-mode") || mod.classList.contains("pip-background-mode"))
    ) {
      continue;
    }
    return mod.querySelector(sheetSel) || mod;
  }
  return null;
}
export function trapModalTabKey(e) {
  if (e.key !== "Tab") return false;
  const sheet = getTopOpenModalSheet();
  if (!sheet) return false;
  const focusables = Array.from(
    sheet.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => {
    if (el.closest(".hidden") || el.closest("[aria-hidden='true']")) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  if (focusables.length === 0) return false;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || !sheet.contains(active)) {
      e.preventDefault();
      last.focus();
      return true;
    }
  } else if (active === last || !sheet.contains(active)) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
export function iconSvg(name, size = 14) {
  const s = Number(size) || 14;
  const base = `class="atv-ico" width="${s}" height="${s}" viewBox="0 0 24 24"`;
  const stroke = `${base} fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"`;
  const icons = {
    play: `<svg ${base} fill="currentColor"><path d="M6.2 4.85v14.3a1 1 0 0 0 1.53.85l11.2-7.15a1 1 0 0 0 0-1.7L7.73 4a1 1 0 0 0-1.53.85z"/></svg>`,
    pause: `<svg ${base} fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`,
    star: `<svg ${base} fill="currentColor"><path d="M12 2.6l2.9 5.88 6.5.95-4.7 4.58 1.1 6.47L12 17.42l-5.8 3.06 1.1-6.47-4.7-4.58 6.5-.95L12 2.6z"/></svg>`,
    check: `<svg ${stroke} stroke-width="2.2"><path d="M20 6 9 17l-5-5"/></svg>`,
    x: `<svg ${stroke} stroke-width="2.1"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
    plus: `<svg ${stroke} stroke-width="2.1"><path d="M12 5v14M5 12h14"/></svg>`,
    info: `<svg ${stroke}><circle cx="12" cy="12" r="9.5"/><line x1="12" y1="16" x2="12" y2="11.5"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    film: `<svg ${stroke}><rect x="2" y="3" width="20" height="18" rx="2.5"/><line x1="7" y1="3" x2="7" y2="21"/><line x1="17" y1="3" x2="17" y2="21"/></svg>`,
    refresh: `<svg ${stroke}><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`,
    clock: `<svg ${stroke}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>`,
    chart: `<svg ${stroke}><path d="M18 20V10M12 20V4M6 20v-6"/></svg>`,
    eyeOff: `<svg ${stroke}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
    users: `<svg ${stroke}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    user: `<svg ${stroke}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    volHigh: `<svg ${stroke}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
    volLow: `<svg ${stroke}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
    volMute: `<svg ${stroke}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
    fsEnter: `<svg ${stroke}><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`,
    fsExit: `<svg ${stroke}><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>`,
    eq: `<svg ${stroke}><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
    camera: `<svg ${stroke}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
    crop: `<svg ${stroke}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h3M7 9v3M17 15h-3M17 15v-3"/></svg>`,
    glow: `<svg ${stroke}><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>`,
    external: `<svg ${stroke}><path d="M7 17 17 7M7 7h10v10"/></svg>`,
    calendar: `<svg ${stroke}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    pin: `<svg ${stroke}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    bolt: `<svg ${base} fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>`,
    chevronLeft: `<svg ${stroke}><path d="m15 18-6-6 6-6"/></svg>`,
    chevronRight: `<svg ${stroke}><path d="m9 18 6-6-6-6"/></svg>`,
  };
  return icons[name] || icons.film;
}
export function getWatchHistoryList() {
  try {
    const raw = localStorage.getItem(WATCH_HISTORY_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}
export function recordWatchHistoryEntry(item, season = 1, episode = 1, currentTime = 0, duration = 0, studioName = "") {
  if (!item || !item.title) return;
  try {
    const list = getWatchHistoryList();
    const isSeries = item.media_type === "series";
    const entryKey = `${item.id || item.title.trim().toLowerCase()}:${isSeries ? `S${season}E${episode}` : "movie"}`;
    const pct = duration > 30 ? Math.min(100, Math.max(0, Math.round((currentTime / duration) * 100))) : 0;
    const newEntry = {
      key: entryKey,
      id: item.id || "",
      kinorium_id: item.kinorium_id || item.kinorium?.kinorium_id || "",
      rezka_id: item.rezka_id || "",
      rezka_url: item.rezka_url || "",
      title: item.title,
      orig_title: item.orig_title || "",
      year: item.year || 2024,
      media_type: item.media_type || "movie",
      poster: item.poster || item.backdrop || "",
      poster_en: item.poster_en || "",
      backdrop: item.backdrop || item.poster || "",
      season: isSeries ? Number(season || 1) : 1,
      episode: isSeries ? Number(episode || 1) : 1,
      current_time: Math.round(currentTime || 0),
      duration: Math.round(duration || 0),
      pct,
      studio: studioName || state.activeStudioName || "HDRezka",
      watched_at: Date.now(),
    };
    const filtered = list.filter((x) => x && x.key !== entryKey);
    filtered.unshift(newEntry);
    localStorage.setItem(WATCH_HISTORY_STORAGE_KEY, JSON.stringify(filtered.slice(0, 150)));
  } catch (_) {}
}
export function getEpisodeProgressMap() {
  try {
    const raw = localStorage.getItem(EPISODE_PROGRESS_STORAGE_KEY);
    return raw ? JSON.parse(raw) || {} : {};
  } catch (_) {
    return {};
  }
}
export function getEpisodeProgress(item, season = 1, episode = 1) {
  if (!item) return null;
  const map = getEpisodeProgressMap();
  const idKey = String(item.id || "").trim();
  const titleKey = String(item.title || "").trim().toLowerCase();
  const itemData = (idKey && map[idKey]) || (titleKey && map[titleKey]);
  if (!itemData) return null;
  const epKey = item.media_type === "series" ? `S${season}E${episode}` : "movie";
  return itemData[epKey] || null;
}
export function saveEpisodeProgress(item, season = 1, episode = 1, currentTime = 0, duration = 0) {
  if (!item || !duration || duration < 60) return;
  try {
    const map = getEpisodeProgressMap();
    const idKey = String(item.id || "").trim();
    const titleKey = String(item.title || "").trim().toLowerCase();
    const pct = Math.min(100, Math.max(0, Math.round((currentTime / duration) * 100)));
    const epKey = item.media_type === "series" ? `S${season}E${episode}` : "movie";
    const entry = {
      current_time: Math.round(currentTime),
      duration: Math.round(duration),
      pct,
      updated_at: Date.now(),
    };
    if (idKey) {
      map[idKey] = map[idKey] || {};
      map[idKey][epKey] = entry;
    }
    if (titleKey) {
      map[titleKey] = map[titleKey] || {};
      map[titleKey][epKey] = entry;
    }
    localStorage.setItem(EPISODE_PROGRESS_STORAGE_KEY, JSON.stringify(map));
  } catch (_) {}
}
export function getUiPrefs() {
  try {
    const raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) || {} : {};
    return {
      hideWatched: Boolean(parsed.hideWatched),
      appLang: parsed.appLang === "en" ? "en" : "ru",
    };
  } catch (_) {
    return { hideWatched: false, appLang: "ru" };
  }
}
export function saveUiPrefs(patch) {
  try {
    const cur = getUiPrefs();
    localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch (_) {}
}
export function getSeenNotificationsSet() {
  try {
    const raw = localStorage.getItem(SEEN_NOTIFICATIONS_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (_) {
    return new Set();
  }
}
export function saveSeenNotificationsSet(seenSet) {
  try {
    localStorage.setItem(SEEN_NOTIFICATIONS_STORAGE_KEY, JSON.stringify(Array.from(seenSet)));
  } catch (_) {}
}
export function pluralRu(n, one, few, many) {
  const abs = Math.abs(Math.trunc(Number(n) || 0));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
export function genitiveAfterIz(n, singularGen, pluralGen) {
  const abs = Math.abs(Math.trunc(Number(n) || 0));
  if (abs % 100 !== 11 && abs % 10 === 1) return singularGen;
  return pluralGen;
}
export function formatDurationLabel(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const hMatch = s.match(/(\d+)\s*(?:ч\.?|час(?:а|ов)?|h(?:r|ours?)?)(?![А-Яа-яЁёA-Za-z])/i);
  const mMatch = s.match(/(\d+)\s*(?:мин\.?|минуты?|минут|m(?:in(?:utes?)?)?)(?![А-Яа-яЁёA-Za-z])/i);
  const colonMatch = !hMatch && !mMatch ? s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/) : null;
  const parsedHours = hMatch ? parseInt(hMatch[1], 10) || 0 : colonMatch ? parseInt(colonMatch[1], 10) || 0 : 0;
  const parsedMins = mMatch ? parseInt(mMatch[1], 10) || 0 : colonMatch ? parseInt(colonMatch[2], 10) || 0 : 0;
  const totalMin = parsedHours * 60 + parsedMins;
  if (totalMin > 0) {
    const h = Math.floor(totalMin / 60);
    const rem = totalMin % 60;
    if (isEn()) {
      let enFmt = "";
      if (h > 0 && rem > 0) enFmt = `${h} hr ${rem} min`;
      else if (h > 0) enFmt = `${h} ${h === 1 ? "hour" : "hours"}`;
      else enFmt = `${rem} min`;
      if (/серия|эпизод|episode/i.test(s)) return `${enFmt} · episode`;
      return enFmt;
    }
    let formatted = "";
    if (h > 0 && rem > 0) {
      formatted = `${h} ${pluralRu(h, "час", "часа", "часов")} ${rem} ${pluralRu(
        rem,
        "минута",
        "минуты",
        "минут"
      )}`;
    } else if (h > 0) {
      formatted = `${h} ${pluralRu(h, "час", "часа", "часов")}`;
    } else {
      formatted = `${rem} ${pluralRu(rem, "минута", "минуты", "минут")}`;
    }
    if (/серия|эпизод|episode/i.test(s)) {
      return `${formatted} · серия`;
    }
    return formatted;
  }
  if (isEn()) {
    return s
      .replace(/(?<![А-Яа-яЁё])мин\.?(?![А-Яа-яЁё])/gi, "min")
      .replace(/(?<![А-Яа-яЁё])ч\.?(?![А-Яа-яЁё])/gi, "hr")
      .replace(/серия|эпизод/gi, "episode");
  }
  return s
    .replace(/(?<![А-Яа-яЁё])мин\.?(?![А-Яа-яЁё])/gi, "минут")
    .replace(/(?<![А-Яа-яЁё])ч\.?(?![А-Яа-яЁё])/gi, "часов");
}
export function expandRussianDateText(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (isEn()) {
    return s
      .replace(/(?<![А-Яа-яЁё])(?:янв\.|января|январь)/gi, "Jan")
      .replace(/(?<![А-Яа-яЁё])(?:февр?\.|февраля|февраль)/gi, "Feb")
      .replace(/(?<![А-Яа-яЁё])(?:мар\.|марта|март)/gi, "Mar")
      .replace(/(?<![А-Яа-яЁё])(?:апр\.|апреля|апрель)/gi, "Apr")
      .replace(/(?<![А-Яа-яЁё])(?:мая|май)/gi, "May")
      .replace(/(?<![А-Яа-яЁё])(?:июн\.|июня|июнь)/gi, "Jun")
      .replace(/(?<![А-Яа-яЁё])(?:июл\.|июля|июль)/gi, "Jul")
      .replace(/(?<![А-Яа-яЁё])(?:авг\.|августа|август)/gi, "Aug")
      .replace(/(?<![А-Яа-яЁё])(?:сент?\.|сентября|сентябрь)/gi, "Sep")
      .replace(/(?<![А-Яа-яЁё])(?:окт\.|октября|октябрь)/gi, "Oct")
      .replace(/(?<![А-Яа-яЁё])(?:нояб?\.|ноября|ноябрь)/gi, "Nov")
      .replace(/(?<![А-Яа-яЁё])(?:дек\.|декабря|декабрь)/gi, "Dec")
      .replace(/\s+г\.(?=\s|$|,|\))/gi, "")
      .replace(/\s+года(?=\s|$|,|\))/gi, "");
  }
  return s
    .replace(/(?<![А-Яа-яЁё])янв\./gi, "января")
    .replace(/(?<![А-Яа-яЁё])февр?\./gi, "февраля")
    .replace(/(?<![А-Яа-яЁё])мар\./gi, "марта")
    .replace(/(?<![А-Яа-яЁё])апр\./gi, "апреля")
    .replace(/(?<![А-Яа-яЁё])июн\./gi, "июня")
    .replace(/(?<![А-Яа-яЁё])июл\./gi, "июля")
    .replace(/(?<![А-Яа-яЁё])авг\./gi, "августа")
    .replace(/(?<![А-Яа-яЁё])сент?\./gi, "сентября")
    .replace(/(?<![А-Яа-яЁё])окт\./gi, "октября")
    .replace(/(?<![А-Яа-яЁё])нояб?\./gi, "ноября")
    .replace(/(?<![А-Яа-яЁё])дек\./gi, "декабря")
    .replace(/\s+г\.(?=\s|$|,|\))/gi, "");
}
export function formatTime(sec) {
  const num = Number(sec);
  const s = Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  }
  return `${m}:${String(rem).padStart(2, "0")}`;
}
export function syncToastContainerMount() {
  const container = document.getElementById("toast-container");
  if (!container) return null;
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  const targetParent = fsEl || document.body;
  if (targetParent && container.parentElement !== targetParent) {
    targetParent.appendChild(container);
  }
  return container;
}
export function showToast(message, options = {}) {
  const container = syncToastContainerMount();
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  const textSpan = document.createElement("span");
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  let durationMs = Number(options?.durationMs) > 0 ? Number(options.durationMs) : 3800;
  if (options && options.actionLabel && typeof options.onAction === "function") {
    toast.classList.add("has-action");
    durationMs = Number(options.durationMs) > 0 ? Number(options.durationMs) : 7500;
    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = "toast-action-btn";
    actionBtn.textContent = String(options.actionLabel);
    actionBtn.onclick = (e) => {
      e.stopPropagation();
      toast.remove();
      options.onAction();
    };
    toast.appendChild(actionBtn);
  }

  container.appendChild(toast);
  setTimeout(() => toast.remove(), durationMs);
}
export function closeConfirmModal(result = false) {
  const modal = document.getElementById("confirm-modal");
  if (modal) {
    modal.classList.add("hidden");
  }
  const resolver = state.activeConfirmResolve;
  state.activeConfirmResolve = null;
  syncScrollTopButton();
  const prevFocus = state.confirmReturnFocusEl;
  state.confirmReturnFocusEl = null;
  if (prevFocus && typeof prevFocus.focus === "function") {
    try {
      prevFocus.focus({ preventScroll: true });
    } catch (_) {}
  }
  if (typeof resolver === "function") {
    resolver(Boolean(result));
  }
}
export function showConfirmModal({
  title = "",
  message = "",
  confirmLabel = "",
  cancelLabel = "",
  danger = true,
} = {}) {
  const modal = document.getElementById("confirm-modal");
  const titleEl = document.getElementById("confirm-modal-title");
  const descEl = document.getElementById("confirm-modal-desc");
  const cancelBtn = document.getElementById("confirm-modal-cancel");
  const acceptBtn = document.getElementById("confirm-modal-accept");
  if (!modal || !titleEl || !descEl || !cancelBtn || !acceptBtn) {
    return Promise.resolve(true);
  }
  if (typeof state.activeConfirmResolve === "function") {
    state.activeConfirmResolve(false);
    state.activeConfirmResolve = null;
  }
  state.confirmReturnFocusEl = document.activeElement;
  titleEl.textContent = title || t("Подтвердите действие", "Confirm Action");
  descEl.textContent = message || "";
  cancelBtn.textContent = cancelLabel || t("Отмена", "Cancel");
  acceptBtn.textContent = confirmLabel || t("Подтвердить", "Confirm");
  acceptBtn.classList.toggle("atv-btn-danger", Boolean(danger));
  acceptBtn.classList.toggle("atv-btn-primary", !danger);

  return new Promise((resolve) => {
    state.activeConfirmResolve = resolve;
    cancelBtn.onclick = () => closeConfirmModal(false);
    acceptBtn.onclick = () => closeConfirmModal(true);
    modal.onclick = (e) => {
      if (e.target === modal) {
        closeConfirmModal(false);
      }
    };
    modal.classList.remove("hidden");
    syncScrollTopButton();
    requestAnimationFrame(() => {
      try {
        acceptBtn.focus({ preventScroll: true });
      } catch (_) {}
    });
  });
}
export function cssUrl(rawUrl) {
  const clean = String(rawUrl || "").trim();
  if (!clean) return "none";
  const escaped = clean
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r|\n/g, "");
  return `url("${escaped}")`;
}
export function supportsNativePiP() {
  if (typeof document === "undefined") return false;
  const proto = typeof HTMLVideoElement !== "undefined" ? HTMLVideoElement.prototype : null;
  if (document.pictureInPictureEnabled && proto && typeof proto.requestPictureInPicture === "function") {
    return true;
  }
  if (proto && typeof proto.webkitSetPresentationMode === "function") {
    return true;
  }
  return false;
}
export function attachHorizontalWheelScroll(el) {
  if (!el || el._cfWheelBound) return;
  el._cfWheelBound = true;
  el.addEventListener(
    "wheel",
    (e) => {
      if (el.classList.contains("ep-grid-mode")) return;
      if (el.scrollWidth <= el.clientWidth + 2) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    },
    { passive: false }
  );
}
let videoCenterTimer = null;
export function triggerVideoCenterIndicator(kind, captionText = "") {
  const wrap = document.getElementById("video-center-indicator");
  const iconBox = document.getElementById("video-center-icon");
  const capEl = document.getElementById("video-center-caption");
  if (!wrap || !iconBox) return;

  const svgMap = {
    play: `<svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M6.2 4.85v14.3a1 1 0 0 0 1.53.85l11.2-7.15a1 1 0 0 0 0-1.7L7.73 4a1 1 0 0 0-1.53.85z"/></svg>`,
    pause: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>`,
    back10: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>`,
    fwd10: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>`,
    mute: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
    unmute: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
  };

  iconBox.innerHTML = svgMap[kind] || svgMap.play;
  if (capEl) {
    if (captionText) {
      capEl.textContent = captionText;
      capEl.classList.remove("hidden");
    } else {
      capEl.textContent = "";
      capEl.classList.add("hidden");
    }
  }

  wrap.classList.remove("hidden", "is-pulsing");
  void wrap.offsetWidth;
  wrap.classList.add("is-pulsing");

  if (videoCenterTimer) clearTimeout(videoCenterTimer);
  videoCenterTimer = setTimeout(() => {
    wrap.classList.remove("is-pulsing");
    wrap.classList.add("hidden");
  }, 560);
}
let videoOsdTimer = null;
export function showVideoOsd(iconKey, text, progressPct = null) {
  const pill = document.getElementById("video-osd-pill");
  const iconEl = document.getElementById("video-osd-icon");
  const textEl = document.getElementById("video-osd-text");
  const barEl = document.getElementById("video-osd-bar");
  const fillEl = document.getElementById("video-osd-fill");
  if (!pill || !iconEl || !textEl) return;

  iconEl.innerHTML = iconKey && iconKey.startsWith("<svg") ? iconKey : iconSvg(iconKey || "film", 15);
  textEl.textContent = text || "";
  if (barEl && fillEl) {
    if (typeof progressPct === "number" && Number.isFinite(progressPct)) {
      barEl.classList.remove("hidden");
      fillEl.style.width = `${Math.max(0, Math.min(100, Math.round(progressPct)))}%`;
    } else {
      barEl.classList.add("hidden");
    }
  }
  pill.classList.remove("hidden");
  if (videoOsdTimer) clearTimeout(videoOsdTimer);
  videoOsdTimer = setTimeout(() => {
    pill.classList.add("hidden");
  }, 1450);
}
let lastAppliedAmbientColor = "";

export function setAmbientColor(hexColor) {
  if (!hexColor || hexColor === lastAppliedAmbientColor) return;
  lastAppliedAmbientColor = hexColor;
  document.documentElement.style.setProperty("--ambient-color", hexColor);
  const glowEl = document.getElementById("ambient-glow");
  if (glowEl) {
    glowEl.style.setProperty("--ambient-color", hexColor);
  }
}
export function syncScrollTopButton() {
  const anyOverlayOpen = isAnyOverlayModalOpen();
  const fullPlayerOpen = Boolean(state.isPlayerOpen && !state.isMiniPlayer && !state.isPipBackground);
  if (document.body.classList.contains("player-modal-open") !== fullPlayerOpen) {
    document.body.classList.toggle("player-modal-open", fullPlayerOpen);
  }
  if (document.body.classList.contains("modal-scroll-locked") !== anyOverlayOpen) {
    document.body.classList.toggle("modal-scroll-locked", anyOverlayOpen);
  }
  const btn = document.getElementById("scroll-top-btn");
  if (!btn) return;
  const shouldHide = !(window.scrollY > 440 && !anyOverlayOpen);
  if (btn.classList.contains("hidden") !== shouldHide) {
    btn.classList.toggle("hidden", shouldHide);
  }
  const shiftForMini = Boolean(state.isPlayerOpen && (state.isMiniPlayer || state.isPipBackground));
  if (btn.classList.contains("shift-for-mini") !== shiftForMini) {
    btn.classList.toggle("shift-for-mini", shiftForMini);
  }
}
