import {
  EPISODE_PROGRESS_STORAGE_KEY,
  SEEN_NOTIFICATIONS_STORAGE_KEY,
  UI_PREFS_STORAGE_KEY,
  WATCH_HISTORY_STORAGE_KEY,
  profileStorageKey,
  state,
} from "./state.js?v=20261112v4";
import { isEn, t } from "./i18n.js?v=20261112v4";
import { isAnyOverlayModalOpen } from "./catalog.js?v=20261112v4";

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

export function isIosOrIpadOs() {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "");
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  if (navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints) > 1) {
    return true;
  }
  return false;
}

export async function copyTextToClipboard(text) {
  const str = String(text ?? "");
  if (!str) return false;
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function" &&
    (typeof window === "undefined" || window.isSecureContext)
  ) {
    try {
      await navigator.clipboard.writeText(str);
      return true;
    } catch (err) { window.logDebug?.("Utils", err); }
  }
  if (typeof document === "undefined") return false;
  const prevActive = document.activeElement;
  const ta = document.createElement("textarea");
  ta.value = str;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.appendChild(ta);
  let copied = false;
  try {
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, str.length);
    copied = Boolean(document.execCommand && document.execCommand("copy"));
  } catch (_) {
    copied = false;
  } finally {
    ta.remove();
    if (prevActive && typeof prevActive.focus === "function") {
      try {
        prevActive.focus({ preventScroll: true });
      } catch (err) { window.logDebug?.("Utils", err); }
    }
  }
  return copied;
}

const modalReturnFocusMap = new Map();

export function rememberModalTriggerFocus(modalId) {
  if (typeof document === "undefined" || !modalId) return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement) {
    modalReturnFocusMap.set(modalId, active);
  }
}

export function restoreModalTriggerFocus(modalId) {
  if (typeof document === "undefined" || !modalId) return;
  const target = modalReturnFocusMap.get(modalId);
  modalReturnFocusMap.delete(modalId);
  if (!target || typeof target.focus !== "function" || !target.isConnected) return;
  if (target.closest(".hidden") || target.closest("[aria-hidden='true']")) return;
  requestAnimationFrame(() => {
    try {
      target.focus({ preventScroll: true });
    } catch (err) { window.logDebug?.("Utils", err); }
  });
}

export function syncSearchInputHasQueryUI() {
  if (typeof document === "undefined") return;
  const inputEl = document.getElementById("global-search");
  const wrapEl = document.getElementById("global-search-wrap");
  const clearBtn = document.getElementById("btn-clear-search");
  const kbdHint = document.getElementById("search-kbd-hint");
  const hasVal = Boolean(inputEl && String(inputEl.value || "").trim().length > 0);
  if (wrapEl) {
    wrapEl.classList.toggle("has-query", hasVal);
  }
  if (clearBtn) {
    clearBtn.classList.toggle("hidden", !hasVal);
  }
  if (kbdHint) {
    const isFocused = typeof document !== "undefined" && document.activeElement === inputEl;
    kbdHint.classList.toggle("hidden", hasVal || isFocused);
  }
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
  } catch (err) {
    if (err && err.name === "AbortError") return;
    console.warn(`[Velarium] Kinorium action error (${key}):`, err);
    showToast(err?.message || t("Ошибка выполнения действия", "Action failed"));
  } finally {
    delete state.pendingKinoriumLocks[key];
    btnList.forEach((b) => {
      b.disabled = false;
    });
  }
}
export function getTopOpenModalSheet() {
  const orderedModals = [
    ["kids-pin-modal", ".atv-kids-pin-sheet"],
    ["confirm-modal", ".atv-confirm-sheet"],
    ["command-palette-modal", ".atv-palette-sheet"],
    ["handoff-modal", ".atv-handoff-card"],
    ["vocab-modal", ".atv-vocab-card"],
    ["bookmarks-modal", ".atv-bookmarks-sheet"],
    ["movie-roulette-modal", ".atv-roulette-dialog"],
    ["onboarding-modal", ".atv-onboarding-sheet"],
    ["profiles-modal", ".atv-settings-sheet"],
    ["tv-cast-modal", ".atv-settings-sheet"],
    ["downloads-modal", ".atv-settings-sheet"],
    ["stats-modal", ".atv-settings-sheet"],
    ["settings-modal", ".atv-settings-sheet"],
    ["person-modal", ".atv-person-sheet"],
    ["quick-peek-modal", ".atv-quickpeek-sheet"],
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
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
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
  const base = `class="atv-ico" width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true"`;
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
    eye: `<svg ${stroke}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
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
    download: `<svg ${stroke}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    fileDown: `<svg ${stroke}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>`,
    lock: `<svg ${stroke}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    tv: `<svg ${stroke}><rect x="2" y="4" width="20" height="13" rx="2.2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
    share: `<svg ${stroke}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
    copy: `<svg ${stroke}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
    moreHoriz: `<svg ${stroke}><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>`,
    airplay: `<svg ${stroke}><path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1"/><polygon points="12 15 17 21 7 21 12 15"/></svg>`,
    cast: `<svg ${stroke}><path d="M2 16.1A5 5 0 0 1 5.9 20"/><path d="M2 12.05A9 9 0 0 1 9.95 20"/><path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><line x1="2" y1="20" x2="2.01" y2="20"/></svg>`,
    wifi: `<svg ${stroke}><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`,
    wifiOff: `<svg ${stroke}><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`,
    folder: `<svg ${stroke}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    trash: `<svg ${stroke}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    shield: `<svg ${stroke}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    chevronLeft: `<svg ${stroke}><path d="m15 18-6-6 6-6"/></svg>`,
    chevronRight: `<svg ${stroke}><path d="m9 18 6-6-6-6"/></svg>`,
    chevronDown: `<svg ${stroke} stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>`,
    chevronUp: `<svg ${stroke} stroke-width="2"><path d="m18 15-6-6-6 6"/></svg>`,
    smartphone: `<svg ${stroke}><rect x="6" y="2" width="12" height="20" rx="2.4"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
    subtitles: `<svg ${stroke}><rect x="2" y="4" width="20" height="16" rx="2.2"/><path d="M7 15h4M13 15h4M7 11h2M11 11h6"/></svg>`,
    upload: `<svg ${stroke}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    search: `<svg ${stroke}><circle cx="11" cy="11" r="7.5"/><line x1="20.5" y1="20.5" x2="16.4" y2="16.4"/></svg>`,
    sliders: `<svg ${stroke}><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></svg>`,
    skipFwd: `<svg ${stroke}><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>`,
    skipBack: `<svg ${stroke}><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>`,
    bookmark: `<svg ${stroke}><path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
    edit: `<svg ${stroke}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
    music: `<svg ${stroke}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
    settings: `<svg ${stroke}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    shuffle: `<svg ${stroke}><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`,
    sparkles: `<svg ${stroke}><path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z"/></svg>`,
    heart: `<svg ${stroke}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
    heartFilled: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  };
  return icons[name] || icons.film;
}

export function isSameCatalogWork(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && String(a.id) === String(b.id)) return true;
  const aKid = String(a.kinorium_id || a.kinorium?.kinorium_id || "").trim();
  const bKid = String(b.kinorium_id || b.kinorium?.kinorium_id || "").trim();
  if (aKid && bKid && aKid === bKid) return true;
  const aRid = String(a.rezka_id || "").trim();
  const bRid = String(b.rezka_id || "").trim();
  if (aRid && bRid && aRid === bRid) return true;
  if (a.media_type && b.media_type && a.media_type !== b.media_type) return false;
  const aYear = parseInt(String(a.year || "").slice(0, 4), 10);
  const bYear = parseInt(String(b.year || "").slice(0, 4), 10);
  if (Number.isFinite(aYear) && Number.isFinite(bYear) && Math.abs(aYear - bYear) > 1) {
    return false;
  }
  const aTitle = String(a.title || "").trim().toLowerCase();
  const bTitle = String(b.title || "").trim().toLowerCase();
  if (aTitle && bTitle && aTitle === bTitle) return true;
  const aOrig = String(a.orig_title || "").trim().toLowerCase();
  const bOrig = String(b.orig_title || "").trim().toLowerCase();
  if (aOrig && bOrig && aOrig === bOrig) return true;
  return false;
}

let _safeCatalogMapRef = null;
let _safeCatalogMapLen = -1;
let _safeCatalogMapVer = -1;
let _safeCatById = new Map();
let _safeCatByKinId = new Map();
let _safeCatByRezkaId = new Map();
let _safeCatByTitle = new Map();
const _YEAR_SUFFIX_RE = /\(\d{4}\)$/;

function _ensureSafeCatalogMap(list) {
  const curVer = Number(state.catalogIndexVersion) || 0;
  const curLen = Array.isArray(list) ? list.length : -1;
  if (list === _safeCatalogMapRef && curLen === _safeCatalogMapLen && curVer === _safeCatalogMapVer) return;
  _safeCatalogMapRef = list;
  _safeCatalogMapLen = curLen;
  _safeCatalogMapVer = curVer;
  _safeCatById = new Map();
  _safeCatByKinId = new Map();
  _safeCatByRezkaId = new Map();
  _safeCatByTitle = new Map();
  if (!Array.isArray(list)) return;
  const addByTitle = (key, it) => {
    if (!key) return;
    if (!_safeCatByTitle.has(key)) _safeCatByTitle.set(key, it);
  };
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!it) continue;
    if (it.id) _safeCatById.set(String(it.id), it);
    const kId = String(it.kinorium?.kinorium_id || it.kinorium_id || "").trim();
    if (kId) _safeCatByKinId.set(kId, it);
    const rId = String(it.rezka_id || "").trim();
    if (rId) _safeCatByRezkaId.set(rId, it);
    const mType = it.media_type || "movie";
    const yr = Number(it.year) || 0;
    const tLow = String(it.title || "").trim().toLowerCase();
    if (tLow) {
      if (yr) addByTitle(`${mType}|${tLow}|${yr}`, it);
      addByTitle(`${mType}|${tLow}|0`, it);
      addByTitle(`any|${tLow}`, it);
      const tStripped = tLow.replace(_YEAR_SUFFIX_RE, "").trim();
      if (tStripped && tStripped !== tLow) {
        addByTitle(`${mType}|${tStripped}|0`, it);
        addByTitle(`any|${tStripped}`, it);
      }
    }
    const oLow = String(it.orig_title || "").trim().toLowerCase();
    if (oLow) {
      if (yr) addByTitle(`${mType}|${oLow}|${yr}`, it);
      addByTitle(`${mType}|${oLow}|0`, it);
      addByTitle(`any|${oLow}`, it);
      const oStripped = oLow.replace(_YEAR_SUFFIX_RE, "").trim();
      if (oStripped && oStripped !== oLow) {
        addByTitle(`${mType}|${oStripped}|0`, it);
        addByTitle(`any|${oStripped}`, it);
      }
    }
  }
}

export function matchCatalogItemSafe(listOrCandidate, maybeCandidate = null) {
  const hasExplicitList = Array.isArray(listOrCandidate);
  const list = hasExplicitList
    ? listOrCandidate
    : Array.isArray(state.catalogItems)
    ? state.catalogItems
    : [];
  const candidate = hasExplicitList ? maybeCandidate : listOrCandidate;
  if (!Array.isArray(list) || list.length === 0 || !candidate) return null;

  if (list === state.catalogItems) {
    _ensureSafeCatalogMap(list);
    if (candidate.id) {
      const hitId = _safeCatById.get(String(candidate.id));
      if (hitId) return hitId;
    }
    const cKinId = String(candidate.kinorium?.kinorium_id || candidate.kinorium_id || "").trim();
    if (cKinId && _safeCatByKinId.has(cKinId)) return _safeCatByKinId.get(cKinId);
    const cRezkaId = String(candidate.rezka_id || "").trim();
    if (cRezkaId && _safeCatByRezkaId.has(cRezkaId)) return _safeCatByRezkaId.get(cRezkaId);
    const mType = candidate.media_type || "movie";
    const yr = Number(candidate.year) || 0;
    const tLow = String(candidate.title || "").trim().toLowerCase();
    if (tLow) {
      const tClean = tLow.replace(_YEAR_SUFFIX_RE, "").trim();
      const hitT =
        (yr && _safeCatByTitle.get(`${mType}|${tLow}|${yr}`)) ||
        _safeCatByTitle.get(`${mType}|${tLow}|0`) ||
        _safeCatByTitle.get(`any|${tLow}`) ||
        (tClean !== tLow ? _safeCatByTitle.get(`${mType}|${tClean}|0`) || _safeCatByTitle.get(`any|${tClean}`) : null);
      if (hitT && isSameCatalogWork(hitT, candidate)) return hitT;
    }
    const oLow = String(candidate.orig_title || "").trim().toLowerCase();
    if (oLow) {
      const oClean = oLow.replace(_YEAR_SUFFIX_RE, "").trim();
      const hitO =
        (yr && _safeCatByTitle.get(`${mType}|${oLow}|${yr}`)) ||
        _safeCatByTitle.get(`${mType}|${oLow}|0`) ||
        _safeCatByTitle.get(`any|${oLow}`) ||
        (oClean !== oLow ? _safeCatByTitle.get(`${mType}|${oClean}|0`) || _safeCatByTitle.get(`any|${oClean}`) : null);
      if (hitO && isSameCatalogWork(hitO, candidate)) return hitO;
    }
    return null;
  }

  if (candidate.id) {
    const byId = list.find((i) => i && i.id && String(i.id) === String(candidate.id));
    if (byId) return byId;
  }
  return list.find((i) => isSameCatalogWork(i, candidate)) || null;
}
let _watchHistoryCache = null;
let _watchHistoryCacheKey = "";

export function getWatchHistoryList() {
  try {
    const storageKey = profileStorageKey(WATCH_HISTORY_STORAGE_KEY);
    if (_watchHistoryCache && _watchHistoryCacheKey === storageKey) {
      return _watchHistoryCache.slice();
    }
    const raw = localStorage.getItem(storageKey);
    const arr = raw ? JSON.parse(raw) : [];
    const res = Array.isArray(arr) ? arr : [];
    _watchHistoryCache = res;
    _watchHistoryCacheKey = storageKey;
    return res.slice();
  } catch (_) {
    return [];
  }
}
export function recordWatchHistoryEntry(item, season = 1, episode = 1, currentTime = 0, duration = 0, studioName = "") {
  if (!item || !item.title) return;
  try {
    const storageKey = profileStorageKey(WATCH_HISTORY_STORAGE_KEY);
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
      year: item.year || "",
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
    const capped = filtered.slice(0, 150);
    _watchHistoryCache = capped;
    _watchHistoryCacheKey = storageKey;
    localStorage.setItem(storageKey, JSON.stringify(capped));
  } catch (err) { window.logDebug?.("Utils", err); }
}
let _episodeProgressCache = null;
let _episodeProgressCacheKey = "";
let _localProgressEpoch = 0;
let _seenNotificationsCache = null;
let _seenNotificationsCacheKey = "";
let _uiPrefsCache = null;

export function getLocalProgressEpoch() {
  return _localProgressEpoch;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (ev) => {
    if (!ev || !ev.key || ev.key.startsWith(EPISODE_PROGRESS_STORAGE_KEY)) {
      _episodeProgressCache = null;
      _episodeProgressCacheKey = "";
      _localProgressEpoch += 1;
    }
    if (!ev || !ev.key || ev.key.startsWith(SEEN_NOTIFICATIONS_STORAGE_KEY)) {
      _seenNotificationsCache = null;
      _seenNotificationsCacheKey = "";
    }
    if (!ev || !ev.key || ev.key.startsWith(WATCH_HISTORY_STORAGE_KEY)) {
      _watchHistoryCache = null;
      _watchHistoryCacheKey = "";
    }
    if (!ev || !ev.key || ev.key === UI_PREFS_STORAGE_KEY) {
      _uiPrefsCache = null;
    }
  });
}

export function invalidateLocalCaches() {
  _episodeProgressCache = null;
  _episodeProgressCacheKey = "";
  _localProgressEpoch += 1;
  _seenNotificationsCache = null;
  _seenNotificationsCacheKey = "";
  _watchHistoryCache = null;
  _watchHistoryCacheKey = "";
  _uiPrefsCache = null;
}

export function getEpisodeProgressMap() {
  const storageKey = profileStorageKey(EPISODE_PROGRESS_STORAGE_KEY);
  if (_episodeProgressCache && _episodeProgressCacheKey === storageKey) return _episodeProgressCache;
  try {
    const raw = localStorage.getItem(storageKey);
    _episodeProgressCache = raw ? JSON.parse(raw) || {} : {};
    _episodeProgressCacheKey = storageKey;
    return _episodeProgressCache;
  } catch (_) {
    _episodeProgressCache = {};
    _episodeProgressCacheKey = storageKey;
    return _episodeProgressCache;
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
    const existing =
      (idKey && map[idKey] && map[idKey][epKey]) ||
      (titleKey && map[titleKey] && map[titleKey][epKey]) ||
      null;
    if (
      existing &&
      Number(existing.current_time) > 120 &&
      Number(existing.pct) < 92 &&
      currentTime < 15 &&
      !state.vcScrubbing
    ) {
      return;
    }
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
    const storageKey = profileStorageKey(EPISODE_PROGRESS_STORAGE_KEY);
    _episodeProgressCache = map;
    _episodeProgressCacheKey = storageKey;
    _localProgressEpoch += 1;
    localStorage.setItem(storageKey, JSON.stringify(map));
  } catch (err) { window.logDebug?.("Utils", err); }
}
export function getUiPrefs() {
  if (_uiPrefsCache) return _uiPrefsCache;
  try {
    const raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) || {} : {};
    _uiPrefsCache = {
      hideWatched: Boolean(parsed.hideWatched),
      appLang: parsed.appLang === "en" ? "en" : "ru",
    };
    return _uiPrefsCache;
  } catch (_) {
    _uiPrefsCache = { hideWatched: false, appLang: "ru" };
    return _uiPrefsCache;
  }
}
export function saveUiPrefs(patch) {
  try {
    const cur = getUiPrefs();
    const next = { ...cur, ...patch };
    _uiPrefsCache = {
      hideWatched: Boolean(next.hideWatched),
      appLang: next.appLang === "en" ? "en" : "ru",
    };
    localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(_uiPrefsCache));
  } catch (err) { window.logDebug?.("Utils", err); }
}
export function getSeenNotificationsSet() {
  const storageKey = profileStorageKey(SEEN_NOTIFICATIONS_STORAGE_KEY);
  if (_seenNotificationsCache && _seenNotificationsCacheKey === storageKey) return _seenNotificationsCache;
  try {
    const raw = localStorage.getItem(storageKey);
    const arr = raw ? JSON.parse(raw) : [];
    _seenNotificationsCache = new Set(Array.isArray(arr) ? arr : []);
    _seenNotificationsCacheKey = storageKey;
    return _seenNotificationsCache;
  } catch (_) {
    _seenNotificationsCache = new Set();
    _seenNotificationsCacheKey = storageKey;
    return _seenNotificationsCache;
  }
}
export function saveSeenNotificationsSet(seenSet) {
  const storageKey = profileStorageKey(SEEN_NOTIFICATIONS_STORAGE_KEY);
  _seenNotificationsCache = seenSet instanceof Set ? seenSet : new Set(seenSet || []);
  _seenNotificationsCacheKey = storageKey;
  try {
    localStorage.setItem(storageKey, JSON.stringify(Array.from(_seenNotificationsCache)));
  } catch (err) { window.logDebug?.("Utils", err); }
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

const _durationLabelCache = new Map();
export function formatDurationLabel(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const cacheKey = `${isEn() ? "en" : "ru"}:${s}`;
  const cached = _durationLabelCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const hMatch = s.match(/(\d+)\s*(?:ч\.?|час(?:а|ов)?|h(?:r|ours?)?)(?![А-Яа-яЁёA-Za-z])/i);
  const mMatch = s.match(/(\d+)\s*(?:мин\.?|минуты?|минут|m(?:in(?:utes?)?)?)(?![А-Яа-яЁёA-Za-z])/i);
  const colonMatch = !hMatch && !mMatch ? s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/) : null;
  const parsedHours = hMatch ? parseInt(hMatch[1], 10) || 0 : colonMatch ? parseInt(colonMatch[1], 10) || 0 : 0;
  const parsedMins = mMatch ? parseInt(mMatch[1], 10) || 0 : colonMatch ? parseInt(colonMatch[2], 10) || 0 : 0;
  const totalMin = parsedHours * 60 + parsedMins;
  let result = "";
  if (totalMin > 0) {
    const h = Math.floor(totalMin / 60);
    const rem = totalMin % 60;
    if (isEn()) {
      let enFmt = "";
      if (h > 0 && rem > 0) enFmt = `${h} hr ${rem} min`;
      else if (h > 0) enFmt = `${h} ${h === 1 ? "hour" : "hours"}`;
      else enFmt = `${rem} min`;
      result = /серия|эпизод|episode/i.test(s) ? `${enFmt} · episode` : enFmt;
    } else {
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
      result = /серия|эпизод|episode/i.test(s) ? `${formatted} · серия` : formatted;
    }
  } else if (isEn()) {
    result = s
      .replace(/(?<![А-Яа-яЁё])мин\.?(?![А-Яа-яЁё])/gi, "min")
      .replace(/(?<![А-Яа-яЁё])ч\.?(?![А-Яа-яЁё])/gi, "hr")
      .replace(/серия|эпизод/gi, "episode");
  } else {
    result = s
      .replace(/(?<![А-Яа-яЁё])мин\.?(?![А-Яа-яЁё])/gi, "минут")
      .replace(/(?<![А-Яа-яЁё])ч\.?(?![А-Яа-яЁё])/gi, "часов");
  }
  if (_durationLabelCache.size >= 500) _durationLabelCache.clear();
  _durationLabelCache.set(cacheKey, result);
  return result;
}

const _dateExpandCache = new Map();
export function expandRussianDateText(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const cacheKey = `${isEn() ? "en" : "ru"}:${s}`;
  const cached = _dateExpandCache.get(cacheKey);
  if (cached !== undefined) return cached;
  let result = "";
  if (isEn()) {
    result = s
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
  } else {
    result = s
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
  if (_dateExpandCache.size >= 500) _dateExpandCache.clear();
  _dateExpandCache.set(cacheKey, result);
  return result;
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
  const pseudoStage = document.documentElement?.classList.contains("is-stage-pseudo-fullscreen")
    ? document.getElementById("video-stage")
    : null;
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement || pseudoStage;
  const targetParent = fsEl || document.body;
  if (targetParent && container.parentElement !== targetParent) {
    targetParent.appendChild(container);
  }
  const inFs = Boolean(fsEl);
  if (container.classList.contains("in-fullscreen") !== inFs) {
    container.classList.toggle("in-fullscreen", inFs);
  }
  const shiftForMini = !inFs && Boolean(state.isPlayerOpen && (state.isMiniPlayer || state.isPipBackground));
  if (container.classList.contains("shift-for-mini") !== shiftForMini) {
    container.classList.toggle("shift-for-mini", shiftForMini);
  }
  return container;
}
export function showToast(message, options = {}) {
  const container = syncToastContainerMount();
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  const textSpan = document.createElement("span");
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  let hideTimer = null;
  const dismissToast = () => {
    if (toast._isDismissing) return;
    toast._isDismissing = true;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    toast.classList.add("toast-hiding");
    setTimeout(() => {
      try {
        toast.remove();
      } catch (err) { window.logDebug?.("Utils", err); }
    }, 160);
  };

  const effLabel = options?.undoText || options?.actionLabel;
  const effHandler = typeof options?.onUndo === "function" ? options.onUndo : options?.onAction;
  let durationMs = Number(options?.durationMs) > 0 ? Number(options.durationMs) : 3800;
  if (effLabel && typeof effHandler === "function") {
    toast.classList.add("has-action");
    durationMs = Number(options.durationMs) > 0 ? Number(options.durationMs) : (options?.onUndo ? 5000 : 7500);
    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = "toast-action-btn atv-toast-undo-btn";
    actionBtn.textContent = String(effLabel);
    actionBtn.onclick = (e) => {
      e.stopPropagation();
      dismissToast();
      effHandler();
    };
    toast.appendChild(actionBtn);
  }

  const startTimer = (ms = durationMs) => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => dismissToast(), ms);
  };
  const pauseTimer = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };
  toast.addEventListener("pointerenter", pauseTimer);
  toast.addEventListener("focusin", pauseTimer);
  toast.addEventListener("pointerleave", () => startTimer(Math.max(2200, Math.round(durationMs * 0.6))));
  toast.addEventListener("focusout", (ev) => {
    if (!toast.contains(ev.relatedTarget)) {
      startTimer(Math.max(2200, Math.round(durationMs * 0.6)));
    }
  });

  container.appendChild(toast);
  startTimer(durationMs);
}
export function closeConfirmModal(result = false) {
  closeCustomSelectMenu({ restoreFocus: false });
  const modal = document.getElementById("confirm-modal");
  if (modal) {
    modal.classList.add("hidden");
  }
  const resolver = state.activeConfirmResolve;
  state.activeConfirmResolve = null;
  syncScrollTopButton();
  restoreModalTriggerFocus("confirm-modal");
  const prevFocus = state.confirmReturnFocusEl;
  state.confirmReturnFocusEl = null;
  if (
    prevFocus &&
    typeof prevFocus.focus === "function" &&
    prevFocus.isConnected &&
    !prevFocus.closest(".hidden") &&
    !prevFocus.closest("[aria-hidden='true']")
  ) {
    try {
      prevFocus.focus({ preventScroll: true });
    } catch (err) { window.logDebug?.("Utils", err); }
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
  rememberModalTriggerFocus("confirm-modal");
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
      } catch (err) { window.logDebug?.("Utils", err); }
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
  if (
    typeof navigator !== "undefined" &&
    /Macintosh|Mac OS X/i.test(navigator.userAgent || "") &&
    /Firefox\//i.test(navigator.userAgent || "")
  ) {
    return true;
  }
  return false;
}
const _CHEVRON_STRIP_IDS = new Set([
  "continue-watching-grid",
  "release-calendar-row",
  "search-persons-row",
  "meta-cast-list",
  "meta-similar-list",
]);

function _resolveVerticalScrollContainer(el) {
  let cur = el ? el.parentElement : null;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    const st = window.getComputedStyle(cur);
    const oy = st ? st.overflowY : "";
    if ((oy === "auto" || oy === "scroll" || oy === "overlay") && cur.scrollHeight > cur.clientHeight + 2) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

export function attachHorizontalWheelScroll(el, options = {}) {
  if (!el) return;
  if (!el._cfWheelBound) {
    el._cfWheelBound = true;
    const captureVertical = Boolean(options.captureVerticalWheel);
    el.addEventListener(
      "wheel",
      (e) => {
        if (el.classList.contains("ep-grid-mode")) return;
        const absY = Math.abs(e.deltaY);
        const absX = Math.abs(e.deltaX);
        if (absY <= absX) return;

        if (e.shiftKey || captureVertical) {
          if (el.scrollWidth <= el.clientWidth + 2) return;
          e.preventDefault();
          if (absY >= 40) {
            el.scrollBy({ left: e.deltaY, behavior: "smooth" });
          } else {
            el.scrollLeft += e.deltaY;
          }
          return;
        }

        if ((absX > 0 || el.scrollHeight > el.clientHeight) && absY > absX * 1.2) {
          const vScroller = _resolveVerticalScrollContainer(el);
          if (vScroller && vScroller !== el) {
            e.preventDefault();
            const mult = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight || 600 : 1;
            vScroller.scrollTop += e.deltaY * mult;
          }
        }
      },
      { passive: false }
    );
  }

  const wantChevrons = Boolean(
    options.showChevrons ||
      el.classList.contains("atv-curated-row") ||
      (el.id && _CHEVRON_STRIP_IDS.has(el.id))
  );
  if (wantChevrons && !el._cfChevronsMounted && el.parentElement) {
    el._cfChevronsMounted = true;
    const host = el.parentElement;
    host.classList.add("atv-hscroll-host");

    const mkBtn = (dir) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `atv-hscroll-nav-btn ${dir} hidden`;
      btn.setAttribute(
        "aria-label",
        dir === "prev" ? t("Прокрутить влево", "Scroll left") : t("Прокрутить вправо", "Scroll right")
      );
      btn.innerHTML = iconSvg(dir === "prev" ? "chevronLeft" : "chevronRight", 14);
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const step = Math.max(240, Math.round(el.clientWidth * 0.72));
        el.scrollBy({ left: dir === "prev" ? -step : step, behavior: "smooth" });
      });
      return btn;
    };

    const prevBtn = mkBtn("prev");
    const nextBtn = mkBtn("next");
    host.appendChild(prevBtn);
    host.appendChild(nextBtn);

    const syncChevronState = () => {
      if (el.classList.contains("ep-grid-mode") || el.classList.contains("hidden")) {
        prevBtn.classList.add("hidden");
        nextBtn.classList.add("hidden");
        return;
      }
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 8) {
        prevBtn.classList.add("hidden");
        nextBtn.classList.add("hidden");
        return;
      }
      prevBtn.classList.toggle("hidden", el.scrollLeft <= 6);
      nextBtn.classList.toggle("hidden", el.scrollLeft >= maxScroll - 6);
    };

    let chevronRaf = 0;
    const scheduleSyncChevronState = () => {
      if (chevronRaf) return;
      chevronRaf = requestAnimationFrame(() => {
        chevronRaf = 0;
        syncChevronState();
      });
    };

    const resizeEntry = _registerHscrollResizeEntry(el, scheduleSyncChevronState);
    el.addEventListener("scroll", scheduleSyncChevronState, { passive: true });
    if (typeof MutationObserver !== "undefined") {
      const mo = new MutationObserver(() => {
        if (!el.isConnected) {
          mo.disconnect();
          _hscrollChevronResizeCallbacks.delete(resizeEntry);
          return;
        }
        scheduleSyncChevronState();
      });
      mo.observe(el, { childList: true });
    }
    scheduleSyncChevronState();
  }
}

let videoCenterTimer = null;
const _hscrollChevronResizeCallbacks = new Set();
let _hscrollWindowResizeBound = false;
function _registerHscrollResizeEntry(el, syncFn) {
  const ref = typeof WeakRef === "function" ? new WeakRef(el) : null;
  const entry = { ref, el: ref ? null : el, syncFn };
  _hscrollChevronResizeCallbacks.add(entry);
  if (!_hscrollWindowResizeBound && typeof window !== "undefined") {
    _hscrollWindowResizeBound = true;
    const onWindowResize = () => {
      for (const item of Array.from(_hscrollChevronResizeCallbacks)) {
        const node = item.ref ? item.ref.deref() : item.el;
        if (!node || !node.isConnected) {
          _hscrollChevronResizeCallbacks.delete(item);
          continue;
        }
        item.syncFn();
      }
    };
    window.addEventListener("resize", onWindowResize, { passive: true });
  }
  return entry;
}
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
  const glowEl = document.getElementById("ambient-glow");
  if (glowEl) {
    glowEl.style.setProperty("--ambient-color", hexColor);
  }
  const videoGlowEl = document.getElementById("video-ambilight-glow");
  if (videoGlowEl) {
    videoGlowEl.style.setProperty("--ambient-color", hexColor);
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
  syncToastContainerMount();
}

const BROAD_CLIENT_GENRES = new Set(["драма", "комедия", "мелодрама", "drama", "comedy", "romance"]);
const GENERIC_FRANCHISE_STOP = new Set([
  "фильм",
  "сериал",
  "сезон",
  "часть",
  "история",
  "жизнь",
  "любовь",
  "война",
  "город",
  "время",
  "черный",
  "белый",
  "новый",
  "последний",
  "первый",
  "большой",
  "movie",
  "series",
  "story",
  "world",
  "house",
  "black",
  "white",
  "night",
  "first",
]);

export function resolveClientSimilarBundle(item, limit = 8) {
  if (!item) return { items: [], source: "curated" };
  if (Array.isArray(item._cachedSimilarItems) && item._cachedSimilarItems.length > 0) {
    return {
      items: item._cachedSimilarItems.slice(0, limit),
      source: item._cachedSimilarSource || "kinorium",
    };
  }
  const curPoolSig = `${state.catalogItems?.length || 0}:${state.similarPool?.length || 0}:${state.catalogIndexVersion || 0}`;
  if (
    item._cachedClientSimilarBundle &&
    item._cachedClientSimilarPoolSig === curPoolSig &&
    Array.isArray(item._cachedClientSimilarBundle.items) &&
    (item._cachedClientSimilarLimit || 0) >= limit
  ) {
    return {
      items: item._cachedClientSimilarBundle.items.slice(0, limit),
      source: item._cachedClientSimilarBundle.source,
    };
  }

  const poolMap = new Map();
  const selfId = String(item.id || "");
  const selfKid = String(item.kinorium_id || item.kinorium?.kinorium_id || "");
  const selfTitleLow = String(item.title || "").trim().toLowerCase();
  const selfOrigLow = String(item.orig_title || "").trim().toLowerCase();

  const addCandidate = (cand) => {
    if (!cand || !cand.title) return;
    if (cand.kinorium?.not_watching) return;
    const cId = String(cand.id || "");
    const cKid = String(cand.kinorium_id || cand.kinorium?.kinorium_id || "");
    const cTitleLow = String(cand.title || "").trim().toLowerCase();
    const cOrigLow = String(cand.orig_title || "").trim().toLowerCase();
    if (
      (selfId && cId === selfId) ||
      (selfKid && cKid === selfKid) ||
      (selfTitleLow && cTitleLow === selfTitleLow) ||
      (selfOrigLow && cOrigLow && cOrigLow === selfOrigLow)
    ) {
      return;
    }
    const key = cId || cTitleLow;
    if (key && !poolMap.has(key)) {
      poolMap.set(key, cand);
    }
  };
  (state.similarPool || []).forEach(addCandidate);
  (state.catalogItems || []).forEach(addCandidate);

  const seedDirectors = new Map();
  (item.directors || []).forEach((d) => {
    const s = String(d || "").trim();
    if (s) seedDirectors.set(s.toLowerCase(), s);
  });
  const seedActors = new Map();
  (item.actors || []).slice(0, 6).forEach((a) => {
    const s = String(a || "").trim();
    if (s) seedActors.set(s.toLowerCase(), s);
  });

  const itemGenresMap = new Map();
  (item.genres || []).forEach((g) => {
    const raw = String(g || "").trim();
    const low = raw.toLowerCase();
    if (low && low !== "фильм" && low !== "сериал") {
      itemGenresMap.set(low, raw);
    }
  });

  const franchiseWords = new Set();
  [item.title, item.orig_title].forEach((str) => {
    String(str || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .forEach((w) => {
        if (w.length >= 5 && !GENERIC_FRANCHISE_STOP.has(w)) {
          franchiseWords.add(w);
        }
      });
  });

  const scored = [];
  poolMap.forEach((cand) => {
    let simMeta = cand._simMeta;
    if (!simMeta) {
      const dirsLow = (cand.directors || [])
        .map((d) => String(d || "").trim().toLowerCase())
        .filter(Boolean);
      const actsLow = (cand.actors || [])
        .map((a) => String(a || "").trim().toLowerCase())
        .filter(Boolean);
      const genresLow = (cand.genres || [])
        .map((g) => String(g || "").trim().toLowerCase())
        .filter(Boolean);
      const tokens =
        cand._simTokens ||
        `${cand.title || ""} ${cand.orig_title || ""}`
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]+/gu, " ")
          .split(/\s+/);
      cand._simTokens = tokens;
      simMeta = { dirsLow, actsLow, genresLow, tokens };
      cand._simMeta = simMeta;
    }

    let sharedDir = "";
    for (let i = 0; i < simMeta.dirsLow.length; i++) {
      const k = simMeta.dirsLow[i];
      if (seedDirectors.has(k)) {
        sharedDir = seedDirectors.get(k);
        break;
      }
    }
    let sharedAct = "";
    for (let i = 0; i < simMeta.actsLow.length; i++) {
      const k = simMeta.actsLow[i];
      if (seedActors.has(k)) {
        sharedAct = seedActors.get(k);
        break;
      }
    }

    let hasFranchise = false;
    if (franchiseWords.size > 0) {
      hasFranchise = simMeta.tokens.some((w) => franchiseWords.has(w));
    }

    const matchedGenres = [];
    let specificCount = 0;
    let genreScore = 0;
    for (let i = 0; i < simMeta.genresLow.length; i++) {
      const low = simMeta.genresLow[i];
      if (itemGenresMap.has(low)) {
        matchedGenres.push(itemGenresMap.get(low));
        if (BROAD_CLIENT_GENRES.has(low)) {
          genreScore += 1.2;
        } else {
          specificCount += 1;
          genreScore += 5.0;
        }
      }
    }

    const strongMatch = Boolean(
      sharedDir ||
        sharedAct ||
        hasFranchise ||
        matchedGenres.length >= 2 ||
        (specificCount >= 1 && cand.media_type === item.media_type)
    );
    if (!strongMatch) return;

    let score = genreScore;
    if (sharedDir) score += 18;
    if (sharedAct) score += 10;
    if (hasFranchise) score += 13;
    if (matchedGenres.length >= 2) score += 4;
    if (cand.media_type === item.media_type) score += 3.5;
    if (!cand.kinorium?.watched) score += 1.5;
    const kr = parseFloat(cand.kinorium?.kinorium_rating || cand.ratings?.kinorium || cand.ratings?.imdb) || 7.4;
    score += Math.min(9.5, kr) * 0.4;

    const enrichedCand = { ...cand };
    if (sharedDir) {
      const enDir = hasCyrillicText(sharedDir) ? transliterateRuToEn(sharedDir) : sharedDir;
      enrichedCand.similar_reason = `Режиссёр: ${sharedDir}`;
      enrichedCand.similar_reason_en = `Director: ${enDir}`;
    } else if (sharedAct) {
      const enAct = hasCyrillicText(sharedAct) ? transliterateRuToEn(sharedAct) : sharedAct;
      enrichedCand.similar_reason = `В ролях: ${sharedAct}`;
      enrichedCand.similar_reason_en = `Cast: ${enAct}`;
    } else if (hasFranchise) {
      enrichedCand.similar_reason = "Одна франшиза";
      enrichedCand.similar_reason_en = "Same franchise";
    } else if (matchedGenres.length > 0) {
      enrichedCand.similar_reason = `Жанры: ${matchedGenres.slice(0, 2).join(", ")}`;
      enrichedCand.similar_reason_en = "Shared genres";
    }
    enrichedCand.similar_source = "curated";
    scored.push({ cand: enrichedCand, score });
  });

  scored.sort((a, b) => b.score - a.score);
  const computedLimit = Math.max(limit, 12);
  const result = {
    items: scored.slice(0, computedLimit).map((x) => x.cand),
    source: "curated",
  };
  item._cachedClientSimilarBundle = result;
  item._cachedClientSimilarPoolSig = curPoolSig;
  item._cachedClientSimilarLimit = computedLimit;
  return {
    items: result.items.slice(0, limit),
    source: result.source,
  };
}

export function getSimilarReasonLabel(sim) {
  if (!sim) return "";
  if (isEn()) {
    const rawEn = String(
      sim.similar_reason_en || (sim.similar_source === "kinorium" ? "Kinorium similar" : "")
    ).trim();
    return hasCyrillicText(rawEn) ? transliterateRuToEn(rawEn) : rawEn;
  }
  return String(
    sim.similar_reason || (sim.similar_source === "kinorium" ? "Подборка Kinorium" : "")
  )
    .trim()
    .replace(/\bРежиссер\b/g, "Режиссёр")
    .replace(/\bАктер\b/g, "Актёр");
}

export function getSimilarSectionSourceLabel(source) {
  if (source === "kinorium") {
    return t("На основе подборки похожих Kinorium", "Based on Kinorium similar picks");
  }
  return t("По общим создателям и жанрам", "By shared creators & genres");
}

/* ==========================================================================
   Flat Matte Custom Select Dropdown (Replaces macOS Liquid Glass OS <select>)
   ========================================================================== */
let _cselectPortal = null;
let _cselectActiveSelect = null;
let _cselectActiveBtn = null;
let _cselectGlobalBound = false;
let _cselectLastVw = 0;

function _ensureCustomSelectPortal() {
  if (typeof document === "undefined") return null;
  if (!_cselectPortal) {
    _cselectPortal = document.getElementById("atv-cselect-portal");
    if (!_cselectPortal) {
      _cselectPortal = document.createElement("div");
      _cselectPortal.id = "atv-cselect-portal";
      _cselectPortal.className = "atv-cselect-menu hidden";
      _cselectPortal.setAttribute("role", "listbox");
      document.body.appendChild(_cselectPortal);
    }
  }
  const pseudoStage =
    document.documentElement?.classList.contains("is-stage-pseudo-fullscreen") &&
    _cselectActiveSelect?.closest("#video-stage")
      ? document.getElementById("video-stage")
      : null;
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement || pseudoStage;
  const desiredParent =
    fsEl && fsEl !== document.documentElement && fsEl !== document.body ? fsEl : document.body;
  if (_cselectPortal.parentElement !== desiredParent) {
    desiredParent.appendChild(_cselectPortal);
  }
  return _cselectPortal;
}

export function isCustomSelectMenuOpen() {
  return Boolean(_cselectPortal && !_cselectPortal.classList.contains("hidden") && _cselectActiveSelect);
}

export function closeCustomSelectMenu({ restoreFocus = false } = {}) {
  const prevBtn = _cselectActiveBtn;
  if (_cselectPortal) {
    _cselectPortal.classList.add("hidden");
    _cselectPortal.innerHTML = "";
  }
  if (_cselectActiveBtn) {
    _cselectActiveBtn.classList.remove("is-open");
    _cselectActiveBtn.setAttribute("aria-expanded", "false");
    _cselectActiveBtn.removeAttribute("aria-activedescendant");
  }
  _cselectActiveSelect = null;
  _cselectActiveBtn = null;
  if (restoreFocus && prevBtn && prevBtn.isConnected && !prevBtn.closest(".hidden")) {
    requestAnimationFrame(() => {
      try {
        prevBtn.focus({ preventScroll: true });
      } catch (err) { window.logDebug?.("Utils", err); }
    });
  }
}

function _resetPopoverInlineBox(el) {
  if (!el || !el.style) return;
  el.style.left = "";
  el.style.right = "";
  el.style.top = "";
  el.style.bottom = "";
  el.style.width = "";
  el.style.maxWidth = "";
  el.style.maxHeight = "";
}

function _flushOutOfFlowLayout(el) {
  if (!el || el.classList.contains("hidden") || typeof document === "undefined") return;
}

export function closeFloatingPopovers({
  exceptId = "",
  keepGearPopover = false,
  keepCustomSelect = false,
} = {}) {
  if (typeof document === "undefined") return;
  if (!keepCustomSelect && exceptId !== "atv-cselect-portal") {
    closeCustomSelectMenu({ restoreFocus: false });
  }
  if (exceptId !== "notifications-popover") {
    const el = document.getElementById("notifications-popover");
    if (el) {
      el.classList.add("hidden");
      _resetPopoverInlineBox(el);
    }
    const notifBtn = document.getElementById("notifications-bell-btn");
    notifBtn?.classList.remove("active");
    notifBtn?.setAttribute("aria-expanded", "false");
  }
  if (exceptId !== "profile-switcher-popover") {
    const el = document.getElementById("profile-switcher-popover");
    if (el) {
      el.classList.add("hidden");
      _resetPopoverInlineBox(el);
    }
    const profBtn = document.getElementById("btn-profile-switcher");
    profBtn?.classList.remove("active");
    profBtn?.setAttribute("aria-expanded", "false");
  }
  if (exceptId !== "search-live-popover") {
    const el = document.getElementById("search-live-popover");
    if (el) {
      el.classList.add("hidden");
      _resetPopoverInlineBox(el);
    }
    const searchInp = document.getElementById("global-search");
    searchInp?.setAttribute("aria-expanded", "false");
    searchInp?.removeAttribute("aria-activedescendant");
  }
  if (exceptId !== "kinorium-status-popover") {
    const el = document.getElementById("kinorium-status-popover");
    if (el) {
      el.classList.add("hidden");
      _resetPopoverInlineBox(el);
    }
    document.getElementById("btn-kinorium-status-menu")?.setAttribute("aria-expanded", "false");
  }
  if (exceptId !== "kinorium-postwatch-overlay") {
    const postwatchPop = document.getElementById("kinorium-postwatch-overlay");
    if (
      postwatchPop &&
      !postwatchPop.classList.contains("hidden") &&
      (postwatchPop.classList.contains("is-header-popover") ||
        postwatchPop.classList.contains("is-epbar-popover"))
    ) {
      state.postwatchManual = false;
      state.postwatchHovered = false;
      postwatchPop.classList.add("hidden");
      _resetPopoverInlineBox(postwatchPop);
    }
  }
  if (exceptId !== "ep-pill-hover-tooltip") {
    const el = document.getElementById("ep-pill-hover-tooltip");
    if (el) {
      el.classList.add("hidden");
      _resetPopoverInlineBox(el);
    }
  }
  [
    ["vc-episodes-popover", "vc-btn-episodes"],
    ["vc-studio-popover", "vc-btn-studio"],
    ["vc-subs-popover", "vc-btn-subs"],
    ["vc-quality-popover", "vc-btn-quality"],
    ["vc-bookmarks-popover", "vc-btn-bookmark"],
  ].forEach(([id, btnId]) => {
    if (id !== exceptId) {
      const el = document.getElementById(id);
      if (el) {
        el.classList.add("hidden");
        _resetPopoverInlineBox(el);
      }
      const btnEl = document.getElementById(btnId);
      btnEl?.setAttribute("aria-expanded", "false");
      if (btnId === "vc-btn-bookmark") {
        btnEl?.classList.remove("active");
      }
    }
  });
  if (!keepGearPopover && exceptId !== "player-gear-popover") {
    const gearEl = document.getElementById("player-gear-popover");
    if (gearEl) {
      gearEl.classList.add("hidden");
      _resetPopoverInlineBox(gearEl);
    }
    const gearBtn = document.getElementById("btn-player-gear");
    gearBtn?.classList.remove("active");
    gearBtn?.setAttribute("aria-expanded", "false");
  }
  const stage = document.getElementById("video-stage");
  if (stage) {
    const anyStagePop = [
      "vc-episodes-popover",
      "vc-studio-popover",
      "vc-subs-popover",
      "vc-quality-popover",
      "vc-bookmarks-popover",
      "player-gear-popover",
    ].some((id) => {
      const el = document.getElementById(id);
      return el && !el.classList.contains("hidden");
    });
    stage.classList.toggle("vc-popover-open", anyStagePop);
    stage.parentElement?.classList.toggle("vc-popover-open", anyStagePop);
  }
}

export function clampFloatingPopover(popoverEl, { isHeader = false } = {}) {
  if (!popoverEl || popoverEl.classList.contains("hidden") || typeof window === "undefined") return;
  if (isHeader) {
    const headerEl = document.querySelector(".atv-header");
    if (headerEl) {
      const hb = Math.max(48, Math.round(headerEl.getBoundingClientRect().bottom + 8));
      popoverEl.style.setProperty("--header-bottom-y", `${hb}px`);
    }
  }
  _resetPopoverInlineBox(popoverEl);
  _flushOutOfFlowLayout(popoverEl);

  const cs = getComputedStyle(popoverEl);
  if (cs.position !== "absolute") return;

  const vw = Math.min(
    window.innerWidth || 99999,
    document.documentElement.clientWidth || window.innerWidth || 1024
  );
  const vh = Math.min(
    window.innerHeight || 99999,
    document.documentElement.clientHeight || window.innerHeight || 768
  );
  let r = popoverEl.getBoundingClientRect();
  if (r.width <= 0 && r.height <= 0) return;

  let mutated = false;
  let effWidth = r.width;
  const maxAllowedW = Math.max(180, vw - 20);
  if (effWidth > maxAllowedW) {
    popoverEl.style.maxWidth = `${maxAllowedW}px`;
    effWidth = maxAllowedW;
    mutated = true;
  }
  if (r.left < 10 || r.left + effWidth > vw - 10) {
    let targetLeft = r.left;
    if (targetLeft + effWidth > vw - 10) targetLeft = vw - 10 - effWidth;
    if (targetLeft < 10) targetLeft = 10;
    const offsetParentRect = popoverEl.offsetParent
      ? popoverEl.offsetParent.getBoundingClientRect()
      : { left: 0 };
    popoverEl.style.right = "auto";
    popoverEl.style.left = `${Math.round(targetLeft - offsetParentRect.left)}px`;
    mutated = true;
  }
  if (r.bottom > vh - 10 && r.top > 0) {
    popoverEl.style.maxHeight = `${Math.max(120, Math.floor(vh - r.top - 12))}px`;
    popoverEl.style.overflowY = "auto";
    mutated = true;
  }
}

export function clampStagePopover(popoverEl) {
  if (!popoverEl || popoverEl.classList.contains("hidden") || typeof window === "undefined") return;
  const stage = document.getElementById("video-stage");
  if (stage) {
    stage.classList.add("vc-popover-open");
    stage.parentElement?.classList.add("vc-popover-open");
  }
  const scrollContainers = [
    document.querySelector("#player-modal .atv-sheet-body"),
    document.querySelector("#player-modal .atv-player-col"),
  ].filter(Boolean);
  let activeScrollEl = null;
  for (const sc of scrollContainers) {
    const oy = getComputedStyle(sc).overflowY;
    if (oy === "auto" || oy === "scroll") {
      activeScrollEl = sc;
      break;
    }
  }
  if (
    stage &&
    activeScrollEl &&
    !document.fullscreenElement &&
    !document.webkitFullscreenElement &&
    !document.documentElement?.classList.contains("is-stage-pseudo-fullscreen")
  ) {
    const stR = stage.getBoundingClientRect();
    const scR = activeScrollEl.getBoundingClientRect();
    if (stR.bottom > scR.bottom - 2) {
      const maxShift = Math.max(0, stR.top - (scR.top + 8));
      const delta = Math.min(maxShift, Math.ceil(stR.bottom - scR.bottom + 8));
      if (delta > 0) activeScrollEl.scrollTop += delta;
    } else if (stR.top < scR.top + 2) {
      activeScrollEl.scrollTop = Math.max(0, activeScrollEl.scrollTop - Math.ceil(scR.top + 8 - stR.top));
    }
  }

  _resetPopoverInlineBox(popoverEl);
  _flushOutOfFlowLayout(popoverEl);

  const cs = getComputedStyle(popoverEl);
  if (cs.position !== "absolute" || !stage) return;

  const vw = Math.min(
    window.innerWidth || 99999,
    document.documentElement.clientWidth || window.innerWidth || 1024
  );
  const vh = Math.min(
    window.innerHeight || 99999,
    document.documentElement.clientHeight || window.innerHeight || 768
  );
  const stR = stage.getBoundingClientRect();
  const scR = activeScrollEl ? activeScrollEl.getBoundingClientRect() : null;
  const topBound = Math.max(8, stR.top + 8, scR ? scR.top + 8 : 8);
  const leftBound = Math.max(8, stR.left + 8);
  const rightBound = Math.min(vw - 8, stR.right - 8);

  let r = popoverEl.getBoundingClientRect();
  if (r.width <= 0 && r.height <= 0) return;

  let mutated = false;
  let effWidth = r.width;
  const availW = Math.max(160, Math.floor(rightBound - leftBound));
  if (effWidth > availW) {
    popoverEl.style.maxWidth = `${availW}px`;
    effWidth = availW;
    mutated = true;
  }
  if (r.top < topBound && r.bottom > topBound + 80) {
    popoverEl.style.maxHeight = `${Math.max(110, Math.floor(r.bottom - topBound))}px`;
    mutated = true;
  } else if (r.bottom > vh - 8 && r.top > 0) {
    popoverEl.style.maxHeight = `${Math.max(110, Math.floor(vh - r.top - 10))}px`;
    mutated = true;
  }
  if (r.left < leftBound || r.left + effWidth > rightBound) {
    let targetLeft = r.left;
    if (targetLeft + effWidth > rightBound) targetLeft = rightBound - effWidth;
    if (targetLeft < leftBound) targetLeft = leftBound;
    const offsetParentRect = popoverEl.offsetParent
      ? popoverEl.offsetParent.getBoundingClientRect()
      : stR;
    popoverEl.style.right = "auto";
    popoverEl.style.left = `${Math.round(targetLeft - offsetParentRect.left)}px`;
    mutated = true;
  }
}

function _positionCustomSelectPortal() {
  if (!_cselectPortal || _cselectPortal.classList.contains("hidden") || !_cselectActiveBtn) return;
  const rect = _cselectActiveBtn.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) {
    closeCustomSelectMenu();
    return;
  }
  const vw = Math.min(
    window.innerWidth || 99999,
    document.documentElement.clientWidth || window.innerWidth || 1024
  );
  const vh = Math.min(
    window.innerHeight || 99999,
    document.documentElement.clientHeight || window.innerHeight || 768
  );

  const safeMaxW = Math.max(140, Math.min(360, vw - 20));
  const minW = Math.min(Math.max(Math.round(rect.width), 168), safeMaxW);
  _cselectPortal.style.left = "0px";
  _cselectPortal.style.right = "auto";
  _cselectPortal.style.top = "0px";
  _cselectPortal.style.bottom = "auto";
  _cselectPortal.style.width = "auto";
  _cselectPortal.style.minWidth = `${minW}px`;
  _cselectPortal.style.maxWidth = `${safeMaxW}px`;

  const spaceBelow = vh - rect.bottom - 10;
  const spaceAbove = rect.top - 10;
  const openAbove = spaceBelow < 260 && spaceAbove > spaceBelow;
  const availSpace = Math.max(110, Math.floor((openAbove ? spaceAbove : spaceBelow) - 6));
  const maxMenuH = Math.min(340, availSpace);
  _cselectPortal.style.maxHeight = `${maxMenuH}px`;

  const listEl = _cselectPortal.querySelector(".atv-cselect-list");
  const searchWrap = _cselectPortal.querySelector(".atv-cselect-search-wrap");
  const searchH = searchWrap ? 42 : 0;
  if (listEl) {
    listEl.style.maxHeight = `${Math.max(76, maxMenuH - searchH - 12)}px`;
  }

  _flushOutOfFlowLayout(_cselectPortal);
  const rawRect = _cselectPortal.getBoundingClientRect();
  const finalW = Math.min(
    safeMaxW,
    Math.max(minW, Math.ceil(rawRect.width) || _cselectPortal.offsetWidth || minW)
  );
  const finalH = Math.min(
    maxMenuH,
    Math.max(36, Math.ceil(rawRect.height) || _cselectPortal.offsetHeight || 120)
  );

  let left = Math.round(rect.left);
  if (left + finalW > vw - 10) {
    left = Math.max(10, vw - finalW - 10);
  }
  if (left < 10) left = 10;

  _cselectPortal.style.width = `${finalW}px`;
  _cselectPortal.style.left = `${left}px`;
  if (openAbove) {
    let bottomPx = Math.max(8, Math.round(vh - rect.top + 6));
    if (vh - bottomPx - finalH < 8) {
      bottomPx = Math.max(8, vh - finalH - 8);
    }
    _cselectPortal.style.top = "auto";
    _cselectPortal.style.bottom = `${bottomPx}px`;
  } else {
    let topPx = Math.max(8, Math.round(rect.bottom + 6));
    if (topPx + finalH > vh - 8) {
      topPx = Math.max(8, vh - finalH - 8);
    }
    _cselectPortal.style.bottom = "auto";
    _cselectPortal.style.top = `${topPx}px`;
  }
}

function _renderOpenCustomSelectPortal() {
  if (!_cselectActiveSelect || !_cselectActiveBtn) return;
  const selectEl = _cselectActiveSelect;
  const portal = _ensureCustomSelectPortal();
  if (!portal) return;

  const allOptions = Array.from(selectEl.options || []);
  const visibleOptions = allOptions.filter((o) => !o.hidden);
  const showFilter = visibleOptions.length >= 15;
  const selectedIdx = selectEl.selectedIndex;

  let html = "";
  if (showFilter) {
    const ph = escapeAttr(t("Быстрый поиск...", "Quick filter..."));
    html += `<div class="atv-cselect-search-wrap"><input type="search" class="atv-cselect-search" enterkeyhint="search" aria-label="${ph}" placeholder="${ph}" autocomplete="off" spellcheck="false" /></div>`;
  }
  html += `<div class="atv-cselect-list">`;

  let optCursor = 0;
  const renderOptionBtn = (opt, idx, groupId = "") => {
    const isSel = idx === selectedIdx;
    const isDis = Boolean(opt.disabled);
    const txt = String(opt.textContent || "").trim();
    const optVal = String(opt.value ?? "");
    return `<button type="button" id="atv-cselect-opt-${idx}" role="option" class="atv-cselect-item${isSel ? " active focused-opt" : ""}${
      isDis ? " is-disabled" : ""
    }" data-opt-index="${idx}" data-opt-value="${escapeAttr(optVal)}" data-group-id="${groupId}" aria-selected="${isSel ? "true" : "false"}" ${
      isDis ? "disabled" : ""
    }><span class="atv-cselect-item-text">${escapeHtml(txt)}</span><span class="atv-cselect-item-check">${
      isSel ? iconSvg("check", 13) : ""
    }</span></button>`;
  };

  let groupSeq = 0;
  Array.from(selectEl.children || []).forEach((child) => {
    const tag = (child.tagName || "").toUpperCase();
    if (tag === "OPTGROUP") {
      groupSeq += 1;
      const gid = `g${groupSeq}`;
      const glabel = String(child.getAttribute("label") || "").trim();
      let groupItemsHtml = "";
      Array.from(child.children || []).forEach((sub) => {
        if ((sub.tagName || "").toUpperCase() === "OPTION") {
          if (!child.hidden && !sub.hidden) {
            groupItemsHtml += renderOptionBtn(sub, optCursor, gid);
          }
          optCursor += 1;
        }
      });
      if (groupItemsHtml) {
        if (glabel) {
          html += `<div class="atv-cselect-group-head" data-group-head="${gid}">${escapeHtml(glabel)}</div>`;
        }
        html += groupItemsHtml;
      }
    } else if (tag === "OPTION") {
      if (!child.hidden) {
        html += renderOptionBtn(child, optCursor, "");
      }
      optCursor += 1;
    }
  });

  html += `<div class="atv-cselect-empty hidden">${escapeHtml(t("Ничего не найдено", "No matches"))}</div>`;
  html += `</div>`;

  portal.innerHTML = html;
  portal.classList.remove("hidden");
  _positionCustomSelectPortal();

  const listEl = portal.querySelector(".atv-cselect-list");
  if (listEl) {
    listEl.addEventListener("click", (ev) => {
      const itemBtn = ev.target.closest(".atv-cselect-item");
      if (!itemBtn || itemBtn.disabled || itemBtn.classList.contains("is-disabled")) return;
      ev.stopPropagation();
      const val = itemBtn.dataset.optValue;
      let targetIdx = Number(itemBtn.dataset.optIndex);
      if (val !== undefined) {
        const foundIdx = Array.from(selectEl.options).findIndex((o) => String(o.value) === String(val));
        if (foundIdx >= 0) targetIdx = foundIdx;
      }
      if (!Number.isFinite(targetIdx) || targetIdx < 0 || targetIdx >= selectEl.options.length) return;
      selectEl.selectedIndex = targetIdx;
      syncCustomSelect(selectEl);
      closeCustomSelectMenu({ restoreFocus: true });
      selectEl.dispatchEvent(new Event("input", { bubbles: true }));
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  const searchInp = portal.querySelector(".atv-cselect-search");
  if (searchInp && listEl) {
    const itemBtns = Array.from(listEl.querySelectorAll(".atv-cselect-item"));
    itemBtns.forEach((b) => {
      b._searchLower = (b.textContent || "").toLowerCase();
    });
    const groupHeads = Array.from(listEl.querySelectorAll(".atv-cselect-group-head"));
    const emptyEl = listEl.querySelector(".atv-cselect-empty");
    searchInp.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape" && ev.key !== "ArrowDown" && ev.key !== "ArrowUp" && ev.key !== "Enter" && ev.key !== "Tab") {
        ev.stopPropagation();
      }
    });
    searchInp.addEventListener("input", () => {
      const q = String(searchInp.value || "").trim().toLowerCase();
      const visibleGroups = new Set();
      let visCount = 0;
      itemBtns.forEach((b) => {
        const match = !q || b._searchLower.includes(q);
        b.classList.toggle("hidden", !match);
        if (match) {
          visCount += 1;
          if (b.dataset.groupId) visibleGroups.add(b.dataset.groupId);
        }
      });
      groupHeads.forEach((gh) => {
        const gid = gh.dataset.groupHead || "";
        gh.classList.toggle("hidden", Boolean(q && !visibleGroups.has(gid)));
      });
      if (emptyEl) emptyEl.classList.toggle("hidden", visCount > 0);
      itemBtns.forEach((b) => b.classList.remove("focused-opt"));
      const firstVis = itemBtns.find((b) => !b.classList.contains("hidden") && !b.disabled);
      if (firstVis) {
        firstVis.classList.add("focused-opt");
        if (firstVis.id) {
          searchInp.setAttribute("aria-activedescendant", firstVis.id);
          _cselectActiveBtn?.setAttribute("aria-activedescendant", firstVis.id);
        }
      } else {
        searchInp.removeAttribute("aria-activedescendant");
        _cselectActiveBtn?.removeAttribute("aria-activedescendant");
      }
      _positionCustomSelectPortal();
    });
  }

  requestAnimationFrame(() => {
    const activeItem =
      portal.querySelector(".atv-cselect-item.active") ||
      portal.querySelector(".atv-cselect-item:not(.hidden):not([disabled])");
    if (activeItem?.id) {
      _cselectActiveBtn?.setAttribute("aria-activedescendant", activeItem.id);
      searchInp?.setAttribute("aria-activedescendant", activeItem.id);
    }
    if (activeItem && listEl) {
      activeItem.scrollIntoView({ block: "nearest" });
    }
    const isCoarsePointer = Boolean(
      typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches
    );
    if (!isIosOrIpadOs() && !state.tvMode && !isCoarsePointer) {
      try {
        if (searchInp) {
          searchInp.focus({ preventScroll: true });
        } else if (activeItem) {
          activeItem.focus({ preventScroll: true });
        }
      } catch (err) { window.logDebug?.("Utils", err); }
    }
  });
}

function _openCustomSelectMenu(selectEl, btn) {
  if (!selectEl || !btn || selectEl.disabled || selectEl.options.length === 0) return;
  if (_cselectActiveSelect === selectEl && isCustomSelectMenuOpen()) {
    closeCustomSelectMenu({ restoreFocus: true });
    return;
  }
  const insideGear = Boolean(selectEl.closest("#player-gear-popover"));
  closeFloatingPopovers({ keepGearPopover: insideGear, keepCustomSelect: true });
  closeCustomSelectMenu({ restoreFocus: false });
  _cselectActiveSelect = selectEl;
  _cselectActiveBtn = btn;
  _cselectLastVw = typeof window !== "undefined" ? window.innerWidth || 0 : 0;
  btn.classList.add("is-open");
  btn.setAttribute("aria-expanded", "true");
  _renderOpenCustomSelectPortal();
}

export function syncCustomSelect(selectEl) {
  if (!selectEl || !selectEl._cfTriggerBtn) return;
  const btn = selectEl._cfTriggerBtn;
  const labelEl = selectEl._cfLabelEl;
  const wasOpen = _cselectActiveSelect === selectEl && isCustomSelectMenuOpen();

  if (selectEl.options && selectEl.options.length > 0 && selectEl.selectedIndex < 0) {
    selectEl.selectedIndex = 0;
  }
  const selOpt =
    (selectEl.selectedIndex >= 0 ? selectEl.options[selectEl.selectedIndex] : null) || selectEl.options[0] || null;
  const nextText = selOpt ? String(selOpt.textContent || "").trim() : "—";
  const titleVal = selectEl.getAttribute("title") || "";
  const ariaLbl = selectEl.getAttribute("aria-label") || titleVal || "";
  const syncSig = `${selectEl.className}|${wasOpen ? 1 : 0}|${selectEl.disabled ? 1 : 0}|${selectEl.selectedIndex}|${nextText}|${titleVal}|${ariaLbl}`;
  if (selectEl._cfSyncSig === syncSig) return;
  selectEl._cfSyncSig = syncSig;

  const nextClasses = ["atv-cselect-btn"];
  Array.from(selectEl.classList || []).forEach((cls) => {
    if (cls !== "atv-native-select-hidden") {
      nextClasses.push(cls);
    }
  });
  if (wasOpen) nextClasses.push("is-open");
  const nextClassStr = nextClasses.join(" ");
  if (btn.className !== nextClassStr) {
    btn.className = nextClassStr;
  }

  const isDis = Boolean(selectEl.disabled);
  if (btn.disabled !== isDis) btn.disabled = isDis;

  if ((btn.getAttribute("title") || "") !== titleVal) {
    if (titleVal) btn.setAttribute("title", titleVal);
    else btn.removeAttribute("title");
  }
  if (ariaLbl && (btn.getAttribute("aria-label") || "") !== ariaLbl) {
    btn.setAttribute("aria-label", ariaLbl);
  }

  if (labelEl && labelEl.textContent !== nextText) {
    labelEl.textContent = nextText;
  }
}

export function syncAllCustomSelects() {
  if (typeof document === "undefined") return;
  document.querySelectorAll("select").forEach((sel) => {
    if (sel._cfTriggerBtn) syncCustomSelect(sel);
  });
}

export function upgradeCustomSelect(selectEl) {
  if (!selectEl || selectEl._cfTriggerBtn) return;
  if (
    selectEl.getAttribute("aria-hidden") === "true" ||
    Boolean(selectEl.closest("#rezka-controls-bar"))
  ) {
    return;
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "atv-cselect-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "atv-cselect-portal");
  if (selectEl.id) {
    btn.dataset.forSelect = selectEl.id;
  }

  const labelSpan = document.createElement("span");
  labelSpan.className = "atv-cselect-label";
  const caretSpan = document.createElement("span");
  caretSpan.className = "atv-cselect-caret";
  caretSpan.setAttribute("aria-hidden", "true");
  caretSpan.innerHTML = iconSvg("chevronDown", 11);
  btn.appendChild(labelSpan);
  btn.appendChild(caretSpan);

  selectEl._cfTriggerBtn = btn;
  selectEl._cfLabelEl = labelSpan;
  selectEl.classList.add("atv-native-select-hidden");
  selectEl.tabIndex = -1;
  selectEl.insertAdjacentElement("afterend", btn);

  const proto = typeof HTMLSelectElement !== "undefined" ? HTMLSelectElement.prototype : null;
  if (proto) {
    ["value", "selectedIndex", "disabled"].forEach((prop) => {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (desc && desc.get && desc.set) {
        try {
          Object.defineProperty(selectEl, prop, {
            configurable: true,
            enumerable: desc.enumerable,
            get() {
              return desc.get.call(this);
            },
            set(v) {
              desc.set.call(this, v);
              syncCustomSelect(this);
            },
          });
        } catch (err) { window.logDebug?.("Utils", err); }
      }
    });
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    _openCustomSelectMenu(selectEl, btn);
  });

  const groupWrap = selectEl.closest(".atv-select-group");
  if (groupWrap && !groupWrap._cfSelectGroupBound) {
    groupWrap._cfSelectGroupBound = true;
    groupWrap.addEventListener("click", (e) => {
      if (e.target && btn.contains(e.target)) return;
      if (selectEl.disabled || groupWrap.classList.contains("is-single-season")) return;
      e.preventDefault();
      e.stopPropagation();
      _openCustomSelectMenu(selectEl, btn);
    });
  }

  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      if (!isCustomSelectMenuOpen() || _cselectActiveSelect !== selectEl) {
        e.preventDefault();
        e.stopPropagation();
        _openCustomSelectMenu(selectEl, btn);
      }
    }
  });

  selectEl.addEventListener("change", () => syncCustomSelect(selectEl));

  if (typeof MutationObserver !== "undefined") {
    const mo = new MutationObserver(() => {
      if (!selectEl.isConnected) {
        mo.disconnect();
        return;
      }
      syncCustomSelect(selectEl);
      if (_cselectActiveSelect === selectEl && isCustomSelectMenuOpen()) {
        _renderOpenCustomSelectPortal();
      }
    });
    mo.observe(selectEl, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "disabled", "title", "aria-label"],
    });
  }

  syncCustomSelect(selectEl);
}

export function initCustomSelects(root = null) {
  if (typeof document === "undefined") return;
  const scope = root && typeof root.querySelectorAll === "function" ? root : document;
  scope.querySelectorAll("select").forEach((sel) => upgradeCustomSelect(sel));

  if (_cselectGlobalBound) return;
  _cselectGlobalBound = true;

  document.addEventListener("click", (e) => {
    const lbl = e.target?.closest?.("label[for]");
    if (lbl) {
      const targetId = lbl.getAttribute("for");
      const targetSel = targetId ? document.getElementById(targetId) : null;
      if (targetSel && targetSel._cfTriggerBtn && !targetSel.disabled) {
        e.preventDefault();
        _openCustomSelectMenu(targetSel, targetSel._cfTriggerBtn);
        return;
      }
    }
    if (!isCustomSelectMenuOpen()) return;
    if (_cselectPortal && _cselectPortal.contains(e.target)) return;
    if (_cselectActiveBtn && _cselectActiveBtn.contains(e.target)) return;
    closeCustomSelectMenu({ restoreFocus: false });
  });

  let _cselectScrollRaf = false;
  document.addEventListener(
    "scroll",
    (e) => {
      if (!isCustomSelectMenuOpen()) return;
      if (_cselectPortal && e.target && _cselectPortal.contains(e.target)) return;
      if (_cselectScrollRaf) return;
      _cselectScrollRaf = true;
      requestAnimationFrame(() => {
        _cselectScrollRaf = false;
        if (!isCustomSelectMenuOpen()) return;
        if (_cselectActiveBtn && _cselectActiveBtn.isConnected) {
          const rect = _cselectActiveBtn.getBoundingClientRect();
          const vh = window.innerHeight || document.documentElement.clientHeight || 0;
          if (rect.width > 0 && rect.bottom > 12 && rect.top < vh - 12) {
            _positionCustomSelectPortal();
            return;
          }
        }
        closeCustomSelectMenu({ restoreFocus: false });
      });
    },
    true
  );

  let _cselectResizeRaf = false;
  window.addEventListener(
    "resize",
    () => {
      if (_cselectResizeRaf) return;
      _cselectResizeRaf = true;
      requestAnimationFrame(() => {
        _cselectResizeRaf = false;
        ["notifications-popover", "profile-switcher-popover", "search-live-popover"].forEach((id) => {
          const el = document.getElementById(id);
          if (el && !el.classList.contains("hidden")) {
            clampFloatingPopover(el, { isHeader: true });
          }
        });
        ["kinorium-status-popover", "kinorium-postwatch-overlay"].forEach((id) => {
          const el = document.getElementById(id);
          if (el && !el.classList.contains("hidden")) {
            clampFloatingPopover(el);
          }
        });
        [
          "player-gear-popover",
          "vc-studio-popover",
          "vc-subs-popover",
          "vc-quality-popover",
          "vc-bookmarks-popover",
        ].forEach((id) => {
          const el = document.getElementById(id);
          if (el && !el.classList.contains("hidden")) {
            clampStagePopover(el);
          }
        });
        if (!isCustomSelectMenuOpen()) return;
        const curVw = window.innerWidth || 0;
        const searchFocused = Boolean(
          _cselectPortal && document.activeElement && _cselectPortal.contains(document.activeElement)
        );
        if (searchFocused || Math.abs(curVw - _cselectLastVw) < 4) {
          _positionCustomSelectPortal();
          return;
        }
        _cselectLastVw = curVw;
        closeCustomSelectMenu({ restoreFocus: false });
      });
    },
    { passive: true }
  );

  const onFsChange = () => {
    if (isCustomSelectMenuOpen()) closeCustomSelectMenu({ restoreFocus: false });
  };
  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("webkitfullscreenchange", onFsChange);

  document.addEventListener(
    "keydown",
    (e) => {
      if (!isCustomSelectMenuOpen() || !_cselectPortal || !_cselectActiveSelect) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeCustomSelectMenu({ restoreFocus: true });
        return;
      }
      if (e.key === "Tab") {
        closeCustomSelectMenu({ restoreFocus: true });
        return;
      }
      if (state.tvMode && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        if (document.activeElement?.tagName !== "INPUT") {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const items = Array.from(
          _cselectPortal.querySelectorAll(".atv-cselect-item:not(.hidden):not([disabled])")
        );
        if (items.length === 0) return;
        let curIdx = items.findIndex((el) => el.classList.contains("focused-opt"));
        if (curIdx < 0) curIdx = items.findIndex((el) => el.classList.contains("active"));
        const nextIdx =
          e.key === "ArrowDown"
            ? Math.min(items.length - 1, curIdx + 1)
            : Math.max(0, curIdx <= 0 ? 0 : curIdx - 1);
        items.forEach((el) => el.classList.remove("focused-opt"));
        const nextEl = items[nextIdx];
        if (nextEl) {
          nextEl.classList.add("focused-opt");
          nextEl.scrollIntoView({ block: "nearest" });
          if (nextEl.id) {
            _cselectActiveBtn?.setAttribute("aria-activedescendant", nextEl.id);
            const sInp = _cselectPortal.querySelector(".atv-cselect-search");
            sInp?.setAttribute("aria-activedescendant", nextEl.id);
          }
          if (document.activeElement?.tagName !== "INPUT") {
            try {
              nextEl.focus({ preventScroll: true });
            } catch (err) { window.logDebug?.("Utils", err); }
          }
        }
        return;
      }
      if (e.key === "Enter") {
        const focused = _cselectPortal.querySelector(
          ".atv-cselect-item.focused-opt:not(.hidden):not([disabled])"
        );
        if (focused) {
          e.preventDefault();
          e.stopPropagation();
          focused.click();
        }
      }
    },
    true
  );
}

let _dlIndexRef = null;
let _dlIndexLen = -1;
let _dlIndexSig = "";
let _dlIndexVer = 0;
let _dlByKeyMap = new Map();

function _ensureDownloadsLookup(list) {
  let sig = `${list.length}`;
  if (list.length > 0) {
    const first = list[0];
    const last = list[list.length - 1];
    let completedCnt = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i]?.status === "completed") completedCnt += 1;
    }
    sig = `${list.length}:${completedCnt}:${first?.id || ""}:${first?.status || ""}:${last?.id || ""}:${last?.status || ""}`;
  }
  if (list === _dlIndexRef && list.length === _dlIndexLen && sig === _dlIndexSig) return;
  _dlIndexRef = list;
  _dlIndexLen = list.length;
  _dlIndexSig = sig;
  _dlIndexVer += 1;
  _dlByKeyMap = new Map();
  const addHit = (key, dl) => {
    if (!key) return;
    let bucket = _dlByKeyMap.get(key);
    if (!bucket) {
      bucket = [];
      _dlByKeyMap.set(key, bucket);
    }
    if (!bucket.includes(dl)) bucket.push(dl);
  };
  for (let i = 0; i < list.length; i++) {
    const dl = list[i];
    if (!dl) continue;
    if (dl.item_id) addHit(`id:${String(dl.item_id).trim()}`, dl);
    if (dl.kinorium_id) addHit(`kin:${String(dl.kinorium_id).trim()}`, dl);
    if (dl.rezka_id) addHit(`rz:${String(dl.rezka_id).trim()}`, dl);
    const tNorm = String(dl.title || "").trim().toLowerCase();
    if (tNorm) addHit(`t:${tNorm}`, dl);
    const oNorm = String(dl.orig_title || "").trim().toLowerCase();
    if (oNorm) addHit(`o:${oNorm}`, dl);
  }
}

export function findAllOfflineDownloadsForTitle(item, season = null, episode = null, statuses = ["completed"]) {
  if (!item) return [];
  const list = Array.isArray(state.downloadsItems) ? state.downloadsItems : [];
  if (list.length === 0) return [];
  _ensureDownloadsLookup(list);

  const allowed = Array.isArray(statuses) && statuses.length > 0 ? new Set(statuses) : null;
  const itemId = String(item.id || item.item_id || "").trim();
  const kinId = String(item.kinorium?.kinorium_id || item.kinorium_id || "").trim();
  const rezkaId = String(item.rezka_id || "").trim();
  const titleNorm = String(item.title || "").trim().toLowerCase();
  const origNorm = String(item.orig_title || "").trim().toLowerCase();
  const isSeries = item.media_type === "series";
  const wantEp = isSeries && season != null && episode != null;
  const sNum = Number(season) || 1;
  const eNum = Number(episode) || 1;

  const candidates = [];
  const seen = new Set();
  const collectBucket = (key) => {
    const bucket = _dlByKeyMap.get(key);
    if (!bucket) return;
    for (let i = 0; i < bucket.length; i++) {
      const dl = bucket[i];
      if (!seen.has(dl)) {
        seen.add(dl);
        candidates.push(dl);
      }
    }
  };
  if (itemId) collectBucket(`id:${itemId}`);
  if (kinId) collectBucket(`kin:${kinId}`);
  if (rezkaId) collectBucket(`rz:${rezkaId}`);
  if (titleNorm) collectBucket(`t:${titleNorm}`);
  if (origNorm) collectBucket(`o:${origNorm}`);
  if (candidates.length === 0) return [];

  const matchesTitle = (dl) => {
    if (!dl || (allowed && !allowed.has(dl.status))) return false;
    if (itemId && dl.item_id && String(dl.item_id) === itemId) return true;
    if (kinId && dl.kinorium_id && String(dl.kinorium_id) === kinId) return true;
    if (rezkaId && dl.rezka_id && String(dl.rezka_id) === rezkaId) return true;
    if (item.media_type && dl.media_type && item.media_type !== dl.media_type) return false;
    if (titleNorm && String(dl.title || "").trim().toLowerCase() === titleNorm) return true;
    if (origNorm && String(dl.orig_title || "").trim().toLowerCase() === origNorm) return true;
    return false;
  };

  if (wantEp) {
    return candidates.filter(
      (dl) =>
        matchesTitle(dl) &&
        dl.media_type === "series" &&
        (Number(dl.season) || 1) === sNum &&
        (Number(dl.episode) || 1) === eNum
    );
  }
  return candidates.filter(matchesTitle);
}

export function findOfflineDownloadForTitle(item, season = null, episode = null, statuses = ["completed"]) {
  if (!item) return null;
  const list = Array.isArray(state.downloadsItems) ? state.downloadsItems : [];
  if (list.length === 0) return null;
  _ensureDownloadsLookup(list);
  const isDefaultCompletedCheck =
    season == null &&
    episode == null &&
    Array.isArray(statuses) &&
    statuses.length === 1 &&
    statuses[0] === "completed";
  if (isDefaultCompletedCheck && item._dlCacheVer === _dlIndexVer) {
    return item._dlCacheVal || null;
  }
  const hits = findAllOfflineDownloadsForTitle(item, season, episode, statuses);
  const hit = hits.length > 0 ? hits[0] : null;
  if (isDefaultCompletedCheck) {
    item._dlCacheVer = _dlIndexVer;
    item._dlCacheVal = hit;
  }
  return hit;
}

let _velariumDebugCached = null;

export function logDebug(scope, ...args) {
  try {
    if (_velariumDebugCached === null && typeof window !== "undefined") {
      _velariumDebugCached = Boolean(
        window.__VELARIUM_DEBUG__ ||
          (typeof localStorage !== "undefined" && localStorage.getItem("velarium_debug") === "1")
      );
    }
    if (
      typeof window !== "undefined" &&
      (window.__VELARIUM_DEBUG__ || _velariumDebugCached)
    ) {
      console.debug(`[Velarium:${scope}]`, ...args);
    }
  } catch (err) { window.logDebug?.("Utils", err); }
}

if (typeof globalThis !== "undefined") {
  globalThis.logDebug = logDebug;
}
if (typeof window !== "undefined") {
  window.logDebug = logDebug;
}

export function bindStarsHoverRange(starsContainer) {
  if (!starsContainer) return;
  const buttons = Array.from(starsContainer.querySelectorAll("button[data-score]"));
  const clearHover = () => {
    starsContainer.classList.remove("is-hovering");
    buttons.forEach((b) => {
      b.classList.remove("hover-range", "hover-target");
    });
  };
  buttons.forEach((btn) => {
    const targetScore = parseInt(btn.dataset.score, 10) || 0;
    btn.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "touch") return;
      starsContainer.classList.add("is-hovering");
      buttons.forEach((b) => {
        const sc = parseInt(b.dataset.score, 10) || 0;
        b.classList.toggle("hover-range", sc > 0 && sc <= targetScore);
        b.classList.toggle("hover-target", sc === targetScore);
      });
    });
  });
  starsContainer.addEventListener("pointerleave", clearHover);
  starsContainer.addEventListener("click", clearHover);
}
