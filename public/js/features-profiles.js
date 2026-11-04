import { ACTIVE_PROFILE_STORAGE_KEY, state } from "./state.js?v=20261104v25";
import { isEn, t } from "./i18n.js?v=20261104v25";
import {
  clampFloatingPopover,
  closeCustomSelectMenu,
  closeFloatingPopovers,
  escapeAttr,
  escapeHtml,
  iconSvg,
  invalidateLocalCaches,
  rememberModalTriggerFocus,
  restoreModalTriggerFocus,
  showConfirmModal,
  showToast,
  syncAllCustomSelects,
  syncCustomSelect,
  syncScrollTopButton,
  syncSearchInputHasQueryUI,
} from "./utils.js?v=20261104v25";
import {
  applyAudioBoostToVideo,
  applySubtitleStylePrefs,
  applyVideoCropToVideo,
  getPlayerPrefs,
  updatePlayerGearActiveDot,
} from "./audio-dsp.js?v=20261104v25";
import {
  applyEnabledServicesVisibility,
  clearCatalogFrontendCache,
  loadCatalog,
  renderNotificationsBell,
  updateActiveFiltersBadge,
  updateKinoriumSectionCounters,
  updateKinoriumUserBadge,
} from "./catalog.js?v=20261104v25";
import {
  closePersonModal,
  closeQuickPeekModal,
  closeStatsModal,
} from "./modals.js?v=20261104v25";
import { closePlayerModal } from "./player.js?v=20261104v25";
import { pushDesktopRemoteStateNow } from "./remote.js?v=20261104v25";
import {
  renderIntegrationsList,
  updateBackupSummaryStat,
} from "./settings.js?v=20261104v25";
import {
  refreshDownloadsState,
  syncDownloadsHeaderBadge,
} from "./features-downloads.js?v=20261104v25";
import { exitBrowserFullscreenIfNeeded } from "./features.js?v=20261104v25";

export const PROFILE_COLOR_SWATCHES = [
  "#0A84FF",
  "#30D158",
  "#FF9F0A",
  "#BF5AF2",
  "#FF375F",
  "#64D2FF",
  "#5E5CE6",
  "#FFD60A",
];

export function _profileColorClass(hexColor) {
  const map = {
    "#0a84ff": "prof-color-blue",
    "#30d158": "prof-color-green",
    "#ff9f0a": "prof-color-amber",
    "#bf5af2": "prof-color-purple",
    "#ff375f": "prof-color-rose",
    "#64d2ff": "prof-color-cyan",
    "#5e5ce6": "prof-color-indigo",
    "#ffd60a": "prof-color-yellow",
  };
  return map[String(hexColor || "").trim().toLowerCase()] || "prof-color-blue";
}

// ============================================================================
// 2. HOUSEHOLD PROFILES (Personal, Family, Kids + Custom)
// ============================================================================

export function _computeInitialsFromName(nameStr) {
  const src = String(nameStr || "").trim();
  if (!src) return "CF";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
}

export function resolveProfileKinoriumInfo(prof) {
  if (!prof) {
    return { connected: false, user_id: "", display_name: "", avatar_url: "" };
  }
  const isAct = prof.id === (state.activeProfileId || "main");
  const liveAcc = isAct ? state.kinoriumAccount || null : null;
  const kSum = prof.kinorium_summary || {};
  const connected = Boolean((liveAcc && liveAcc.connected && liveAcc.user_id) || (kSum.connected && kSum.user_id));
  if (!connected) {
    return { connected: false, user_id: "", display_name: "", avatar_url: "" };
  }
  const uid = String((liveAcc && liveAcc.user_id) || kSum.user_id || "").trim();
  let rawDisp = String((liveAcc && liveAcc.display_name) || kSum.display_name || "").trim();
  if (
    rawDisp === "Не подключен" ||
    rawDisp === "Not connected" ||
    rawDisp.startsWith("http://") ||
    rawDisp.startsWith("https://") ||
    rawDisp.startsWith("user/") ||
    rawDisp.includes("kinorium.com")
  ) {
    rawDisp = "";
  }
  if (uid === "51670" && (!rawDisp || rawDisp.toLowerCase().startsWith("user_") || rawDisp === "51670")) {
    rawDisp = "Andrei Crustillio";
  } else if (rawDisp.toLowerCase().startsWith("user_")) {
    rawDisp = "";
  }
  let avatarUrl = String((liveAcc && liveAcc.avatar_url) || kSum.avatar_url || "").trim();
  if (/^\d+$/.test(uid)) {
    avatarUrl = `/api/kinorium/avatar?uid=${encodeURIComponent(uid)}`;
  } else if (avatarUrl && avatarUrl.includes("/user/180/")) {
    avatarUrl = avatarUrl.replace("/user/180/", "/user/200/");
  }
  return {
    connected: true,
    user_id: uid,
    display_name: rawDisp,
    avatar_url: avatarUrl,
  };
}

export function getProfileBaseLabel(prof) {
  if (!prof) return t("Личный", "Personal");
  if (isEn() && !prof.custom_name && prof.name_en) {
    return prof.name_en;
  }
  let base = String(prof.display_label || prof.name || "").trim();
  if (
    !base ||
    base.startsWith("http://") ||
    base.startsWith("https://") ||
    base.includes("kinorium.com") ||
    base.startsWith("user/") ||
    base.toLowerCase().startsWith("user_")
  ) {
    return isEn() ? (prof.name_en || "Personal") : "Личный";
  }
  return base || t("Профиль", "Profile");
}

export function getProfileDisplayLabel(prof) {
  if (!prof) return t("Личный", "Personal");
  const kin = resolveProfileKinoriumInfo(prof);
  let disp = (kin.display_name || "").trim();
  if (kin.user_id === "51670" && (!disp || disp.toLowerCase().startsWith("user_"))) {
    disp = "Andrei Crustillio";
  }
  if (
    kin.connected &&
    disp &&
    !prof.kids_mode &&
    !disp.toLowerCase().startsWith("user_") &&
    !disp.startsWith("http://") &&
    !disp.startsWith("https://") &&
    !disp.includes("kinorium.com")
  ) {
    return disp;
  }
  return getProfileBaseLabel(prof);
}

export function getProfileAvatarUrl(prof) {
  const kin = resolveProfileKinoriumInfo(prof);
  if (kin.connected && kin.avatar_url && !prof.kids_mode) {
    return kin.avatar_url;
  }
  return "";
}

export function _renderAvatarInnerHtml(avatarUrl, initials, altText = "") {
  const initSafe = escapeHtml(initials);
  if (!avatarUrl) return initSafe;
  return `<img class="atv-profile-avatar-img" src="${escapeAttr(avatarUrl)}" alt="${escapeAttr(altText)}" referrerpolicy="no-referrer" loading="lazy" /><span class="atv-profile-avatar-fallback">${initSafe}</span>`;
}

export function _bindAvatarImgFallbacks(rootEl) {
  if (!rootEl) return;
  rootEl.querySelectorAll(".atv-profile-avatar-img").forEach((img) => {
    img.addEventListener(
      "error",
      () => {
        const wrap = img.closest(".atv-profile-avatar");
        wrap?.classList.remove("has-avatar-img");
        img.remove();
      },
      { once: true }
    );
  });
}

export function applyProfilesPayload(payload) {
  if (!payload || typeof payload !== "object") return;
  const prevPid = state.activeProfileId;
  if (Array.isArray(payload.profiles)) {
    state.profiles = payload.profiles;
  }
  if (payload.active_profile_id) {
    state.activeProfileId = String(payload.active_profile_id);
  }
  const activeObj =
    payload.active_profile ||
    (state.profiles || []).find((p) => p.id === state.activeProfileId) ||
    (state.profiles || [])[0] ||
    null;
  state.activeProfile = activeObj;
  if (activeObj && activeObj.id) {
    state.activeProfileId = activeObj.id;
  }
  if (prevPid !== state.activeProfileId || !(activeObj?.kids_mode && activeObj?.has_kids_pin)) {
    state.verifiedKidsAdminPin = "";
  }
  try {
    if (typeof localStorage !== "undefined" && state.activeProfileId) {
      localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, state.activeProfileId);
    }
  } catch (_) {}
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-profile", state.activeProfileId || "main");
    document.documentElement.classList.toggle("is-kids-profile", Boolean(activeObj?.kids_mode));
  }
  renderHeaderProfileSwitcher();
}

export function renderHeaderProfileSwitcher() {
  const btn = document.getElementById("btn-profile-switcher");
  const avatarEl = document.getElementById("header-profile-avatar");
  const nameEl = document.getElementById("header-profile-name");
  const kidsDotEl = document.getElementById("header-profile-kids-badge");
  const pop = document.getElementById("profile-switcher-popover");
  const active = state.activeProfile || {
    id: "main",
    name: "Личный",
    name_en: "Personal",
    initials: "Л",
    avatar_color: "#0A84FF",
    kids_mode: false,
  };

  const label = getProfileDisplayLabel(active);
  const avatarUrl = getProfileAvatarUrl(active);
  const initials = _computeInitialsFromName(label);
  const colorCls = _profileColorClass(active.avatar_color);

  if (avatarEl) {
    avatarEl.className = `atv-profile-avatar ${colorCls}${avatarUrl ? " has-avatar-img" : ""}`;
    if (avatarUrl) {
      avatarEl.innerHTML = _renderAvatarInnerHtml(avatarUrl, initials, label);
      _bindAvatarImgFallbacks(avatarEl);
    } else {
      avatarEl.textContent = initials;
    }
  }
  if (nameEl) {
    nameEl.textContent = label;
  }
  if (kidsDotEl) {
    kidsDotEl.classList.toggle("hidden", !active.kids_mode);
    kidsDotEl.textContent = t("Дети", "Kids");
  }
  if (btn) {
    btn.title = `${t("Профиль", "Profile")}: ${label}`;
  }

  const dynHost = document.getElementById("profile-switcher-dynamic") || pop;
  if (!dynHost) return;
  const list = Array.isArray(state.profiles) && state.profiles.length > 0 ? state.profiles : [active];
  const audioPrefText = (pref) => {
    if (pref === "original") return t("Оригинал", "Original");
    if (pref === "ru_dub") return t("Дубляж", "Dubbed");
    return t("Авто", "Auto");
  };

  dynHost.innerHTML = `
    <div class="atv-prof-pop-head">
      <span>${t("Домашние профили", "Household Profiles")}</span>
    </div>
    <div class="atv-prof-pop-list">
      ${list
        .map((p) => {
          const isAct = p.id === state.activeProfileId;
          const pName = getProfileDisplayLabel(p);
          const pAvatarUrl = getProfileAvatarUrl(p);
          const pInit = _computeInitialsFromName(pName);
          const pColorCls = _profileColorClass(p.avatar_color);
          const kinSum = resolveProfileKinoriumInfo(p);
          const subMeta = [
            p.kids_mode ? t("Детский фильтр", "Kids safe") : audioPrefText(p.default_audio_pref),
            kinSum.connected
              ? `Kinorium: ${kinSum.display_name || (kinSum.user_id === "51670" ? "Andrei Crustillio" : (kinSum.user_id ? "ID " + kinSum.user_id : ""))}`
              : t("Локальный профиль", "Local profile"),
          ]
            .filter(Boolean)
            .join(" · ");
          return `
            <button type="button" class="atv-prof-pop-item${isAct ? " active" : ""}" data-switch-prof="${escapeAttr(p.id)}">
              <span class="atv-profile-avatar ${pColorCls}${pAvatarUrl ? " has-avatar-img" : ""}">${_renderAvatarInnerHtml(pAvatarUrl, pInit, pName)}</span>
              <span class="atv-prof-pop-meta">
                <span class="atv-prof-pop-name-row">
                  <span class="atv-prof-pop-name">${escapeHtml(pName)}</span>
                  ${p.kids_mode ? `<span class="atv-kids-pill">${t("Дети", "Kids")}</span>` : ""}
                  ${p.has_kids_pin ? iconSvg("lock", 11) : ""}
                </span>
                <span class="atv-prof-pop-sub">${escapeHtml(subMeta)}</span>
              </span>
              <span class="atv-prof-pop-check">${isAct ? iconSvg("check", 13) : ""}</span>
            </button>
          `;
        })
        .join("")}
    </div>
    <div class="atv-prof-pop-foot">
      <button type="button" class="atv-btn-secondary atv-btn-xs atv-prof-manage-btn" id="btn-open-profiles-manage">
        ${iconSvg("users", 13)}
        <span>${t("Настроить профили...", "Manage Profiles...")}</span>
      </button>
    </div>
  `;
  _bindAvatarImgFallbacks(dynHost);

  dynHost.querySelectorAll("[data-switch-prof]").forEach((rowBtn) => {
    rowBtn.onclick = (ev) => {
      ev.stopPropagation();
      const pid = rowBtn.dataset.switchProf || "main";
      closeProfilePopover();
      if (pid !== state.activeProfileId) {
        switchActiveProfile(pid);
      }
    };
  });

  dynHost.querySelector("#btn-open-profiles-manage")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeProfilePopover();
    openProfilesModal(state.activeProfileId);
  });

  const tvStateEl = document.getElementById("prof-menu-tv-state");
  if (tvStateEl) {
    tvStateEl.textContent = state.tvMode ? t("Вкл", "On") : t("Выкл", "Off");
    tvStateEl.classList.toggle("is-on", Boolean(state.tvMode));
  }
  syncDownloadsHeaderBadge();
}

export function toggleProfilePopover(forceOpen = null) {
  const pop = document.getElementById("profile-switcher-popover");
  const btn = document.getElementById("btn-profile-switcher");
  if (!pop) return;
  const shouldOpen = forceOpen !== null ? Boolean(forceOpen) : pop.classList.contains("hidden");
  if (shouldOpen) {
    closeFloatingPopovers({ exceptId: "profile-switcher-popover" });
    renderHeaderProfileSwitcher();
    pop.classList.remove("hidden");
    clampFloatingPopover(pop, { isHeader: true });
    btn?.classList.add("active");
    btn?.setAttribute("aria-expanded", "true");
  } else {
    closeProfilePopover();
  }
}

export function closeProfilePopover() {
  document.getElementById("profile-switcher-popover")?.classList.add("hidden");
  const btn = document.getElementById("btn-profile-switcher");
  btn?.classList.remove("active");
  btn?.setAttribute("aria-expanded", "false");
}

export function reloadProfileLocalPlayerPrefs() {
  invalidateLocalCaches();
  clearCatalogFrontendCache();
  const prefs = getPlayerPrefs();
  state.autoNextEpisode = prefs.autoNextEpisode;
  state.audioBoost = prefs.audioBoost;
  state.audioPreset = prefs.audioPreset;
  state.ambilightEnabled = prefs.ambilightEnabled;
  state.videoCrop = prefs.videoCrop;
  state.subSize = prefs.subSize;
  state.subBg = prefs.subBg;
  state.autoSkipIntro = prefs.autoSkipIntro;

  const autoNextEl = document.getElementById("auto-next-ep-toggle");
  if (autoNextEl) autoNextEl.checked = Boolean(state.autoNextEpisode);
  const ambiToggle = document.getElementById("ambilight-toggle");
  if (ambiToggle) ambiToggle.checked = Boolean(state.ambilightEnabled);
  const skipIntroToggle = document.getElementById("auto-skip-intro-toggle");
  if (skipIntroToggle) skipIntroToggle.checked = Boolean(state.autoSkipIntro);

  const speedSel = document.getElementById("select-speed");
  if (speedSel) speedSel.value = String(prefs.playbackRate || 1);
  const boostSel = document.getElementById("select-audio-boost");
  if (boostSel) boostSel.value = String(state.audioBoost || 1);
  const eqSel = document.getElementById("select-audio-eq");
  if (eqSel) eqSel.value = state.audioPreset || "flat";
  const cropSel = document.getElementById("select-video-crop");
  if (cropSel) cropSel.value = state.videoCrop || "contain";
  const subSizeSel = document.getElementById("select-sub-size");
  if (subSizeSel) subSizeSel.value = state.subSize || "medium";
  const subBgSel = document.getElementById("select-sub-bg");
  if (subBgSel) subBgSel.value = state.subBg || "semi";
  document.getElementById("audio-boost-group")?.classList.toggle("boost-active", (state.audioBoost || 1) > 1.01);
  document.getElementById("audio-eq-group")?.classList.toggle("eq-active", state.audioPreset !== "flat");
  document.getElementById("video-crop-group")?.classList.toggle("crop-active", (state.videoCrop || "contain") !== "contain");

  const video = document.getElementById("native-video");
  if (video) {
    try {
      video.playbackRate = prefs.playbackRate || 1;
    } catch (_) {}
    applyAudioBoostToVideo(video, state.audioBoost, state.audioPreset);
  }
  applyVideoCropToVideo(video, state.videoCrop);
  applySubtitleStylePrefs(state.subSize, state.subBg);
  updatePlayerGearActiveDot();
  syncAllCustomSelects();
}

export let _activePinResolver = null;
export let _kidsPinTriggerEl = null;

export function closeKidsPinModal(resultPin = null) {
  closeCustomSelectMenu({ restoreFocus: false });
  const modal = document.getElementById("kids-pin-modal");
  const resolver = _activePinResolver;
  _activePinResolver = null;
  const triggerEl = _kidsPinTriggerEl;
  _kidsPinTriggerEl = null;
  if (modal && !modal.classList.contains("hidden")) {
    modal.classList.add("hidden");
    syncScrollTopButton();
    restoreModalTriggerFocus("kids-pin-modal");
    requestAnimationFrame(() => {
      try {
        if (
          triggerEl &&
          typeof triggerEl.focus === "function" &&
          triggerEl.isConnected &&
          !triggerEl.closest(".hidden") &&
          !triggerEl.closest("[aria-hidden='true']")
        ) {
          triggerEl.focus({ preventScroll: true });
          return;
        }
        const profModal = document.getElementById("profiles-modal");
        if (profModal && !profModal.classList.contains("hidden")) {
          const activeCard =
            profModal.querySelector(`[data-prof-card="${CSS.escape(String(state.activeProfileId || "main"))}"]`) ||
            profModal.querySelector("[data-prof-card]");
          activeCard?.focus({ preventScroll: true });
        }
      } catch (_) {}
    });
  }
  if (typeof resolver === "function") {
    resolver(resultPin);
  }
}

export function promptKidsPinModal({ desc = "", profileId = "" } = {}) {
  exitBrowserFullscreenIfNeeded();
  const modal = document.getElementById("kids-pin-modal");
  const input = document.getElementById("kids-pin-modal-input");
  const descEl = document.getElementById("kids-pin-modal-desc");
  const errEl = document.getElementById("kids-pin-modal-error");
  const cancelBtn = document.getElementById("kids-pin-modal-cancel");
  const submitBtn = document.getElementById("kids-pin-modal-submit");
  if (!modal || !input || !cancelBtn || !submitBtn) {
    return Promise.resolve("");
  }
  if (typeof _activePinResolver === "function") {
    _activePinResolver(null);
    _activePinResolver = null;
  }
  exitBrowserFullscreenIfNeeded();
  if (
    typeof document !== "undefined" &&
    document.activeElement &&
    document.activeElement !== document.body &&
    document.activeElement !== document.documentElement
  ) {
    _kidsPinTriggerEl = document.activeElement;
  }
  rememberModalTriggerFocus("kids-pin-modal");
  if (descEl) {
    descEl.textContent =
      desc ||
      t(
        "Введите 4-значный PIN-код для выхода из детского профиля",
        "Enter the 4-digit PIN to exit the Kids profile"
      );
  }
  if (errEl) {
    errEl.textContent = "";
    errEl.classList.add("hidden");
  }
  input.value = "";
  input.classList.remove("is-invalid");
  input.removeAttribute("aria-invalid");
  modal.classList.remove("hidden");
  syncScrollTopButton();

  const triggerPinShake = () => {
    input.setAttribute("aria-invalid", "true");
    input.classList.remove("is-invalid");
    void input.offsetWidth;
    input.classList.add("is-invalid");
  };

  return new Promise((resolve) => {
    _activePinResolver = resolve;
    const trySubmit = async () => {
      const code = String(input.value || "").replace(/\D+/g, "");
      if (code.length !== 4) {
        if (errEl) {
          errEl.textContent = t("Введите ровно 4 цифры", "Enter all 4 digits");
          errEl.classList.remove("hidden");
        }
        triggerPinShake();
        input.focus();
        return;
      }
      try {
        const verifyPayload = { pin: code };
        if (profileId) verifyPayload.profile_id = profileId;
        const vRes = await fetch("/api/profiles/verify-pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(verifyPayload),
        });
        const vData = await vRes.json();
        if (!vRes.ok || vData.ok === false) {
          if (errEl) {
            errEl.textContent = vData.error || t("Неверный PIN-код", "Incorrect PIN");
            errEl.classList.remove("hidden");
          }
          triggerPinShake();
          input.select();
          return;
        }
      } catch (_) {}
      closeKidsPinModal(code);
    };

    cancelBtn.onclick = () => closeKidsPinModal(null);
    submitBtn.onclick = () => trySubmit();
    input.onkeydown = (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        trySubmit();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        closeKidsPinModal(null);
      }
    };
    input.oninput = () => {
      input.value = String(input.value || "").replace(/\D+/g, "").slice(0, 4);
      input.classList.remove("is-invalid");
      input.removeAttribute("aria-invalid");
      errEl?.classList.add("hidden");
    };
    modal.onclick = (ev) => {
      if (ev.target === modal) closeKidsPinModal(null);
    };
    requestAnimationFrame(() => {
      try {
        input.focus({ preventScroll: true });
      } catch (_) {}
    });
  });
}

export async function ensureKidsPinVerifiedForAdminAction(descText = "") {
  if (!(state.activeProfile?.kids_mode && state.activeProfile?.has_kids_pin)) {
    return "";
  }
  if (state.verifiedKidsAdminPin) {
    return state.verifiedKidsAdminPin;
  }
  const entered = await promptKidsPinModal({
    desc:
      descText ||
      t(
        "Введите родительский 4-значный PIN-код для доступа к настройкам",
        "Enter the 4-digit parental PIN to access settings"
      ),
  });
  if (!entered) return null;
  state.verifiedKidsAdminPin = entered;
  return entered;
}

export const requestKidsPinVerification = ensureKidsPinVerifiedForAdminAction;

export function isItemSafeForKidsClient(item) {
  if (!item || typeof item !== "object") return false;
  if (item.kids_safe === false) return false;
  if (item.kids_safe === true) return true;
  const ageRaw = String(item.age_rating || item.age || "").trim();
  const ageMatch = ageRaw.match(/(\d{1,2})/);
  if (ageMatch && Number(ageMatch[1]) >= 16) return false;
  const badGenres = ["ужасы", "триллер", "криминал", "эротика", "horror", "thriller", "crime", "erotic", "adult"];
  const genres = Array.isArray(item.genres) ? item.genres : [];
  for (const g of genres) {
    const gStr = String(typeof g === "object" && g ? g.ru || g.en || g.name || "" : g).toLowerCase();
    if (badGenres.some((bg) => gStr.includes(bg))) return false;
  }
  return true;
}

export async function switchActiveProfile(profileId, verifiedPin = "") {
  const pid = String(profileId || "main").trim();
  if (!pid) return;
  let pinToSend = String(verifiedPin || "").trim();
  if (
    !pinToSend &&
    state.activeProfile?.kids_mode &&
    state.activeProfile?.has_kids_pin &&
    pid !== state.activeProfileId
  ) {
    const entered = await promptKidsPinModal();
    if (!entered) return;
    pinToSend = entered;
  }
  try {
    const res = await fetch("/api/profiles/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: pid, pin: pinToSend, lang: state.appLang || "ru" }),
    });
    const data = await res.json();
    if (res.status === 403 && data.pin_required && !pinToSend) {
      const entered = await promptKidsPinModal({ desc: data.error || "" });
      if (entered) {
        return switchActiveProfile(pid, entered);
      }
      return;
    }
    if (!res.ok || data.ok === false) {
      showToast(data.error || t("Не удалось переключить профиль", "Could not switch profile"));
      return;
    }
    if (state.isPlayerOpen) {
      closePlayerModal(true, true);
    }
    closeQuickPeekModal({ clearStack: true, suppressResume: true });
    closePersonModal({ clearStack: true, suppressResume: true });
    closeStatsModal();
    applyProfilesPayload(data);
    reloadProfileLocalPlayerPrefs();

    if (data.kinorium_account) {
      state.kinoriumAccount = data.kinorium_account;
    }
    if (data.integrations) {
      state.integrations = data.integrations;
    }
    if (data.kinorium_counts) {
      state.kinoriumCounts = data.kinorium_counts;
    }
    state.liveSeriesUpdates = {};
    state.liveUpdatesCheckedOnce = false;
    state.selectedFriend = "all";
    state.friendsFilter = false;
    document.getElementById("btn-friends-filter")?.classList.remove("active");
    state.searchQuery = "";
    state.similarPool = [];
    state.searchSimilarItems = [];
    state.searchPersons = [];
    const searchInput = document.getElementById("global-search");
    if (searchInput) searchInput.value = "";
    document.getElementById("search-live-popover")?.classList.add("hidden");
    document.getElementById("notifications-popover")?.classList.add("hidden");
    syncSearchInputHasQueryUI();

    if (!state.kinoriumAccount?.connected && ["watching", "watchlist", "watched", "never"].includes(state.kinoriumSection)) {
      state.kinoriumSection = "all";
      document.querySelectorAll("#kinorium-sections-bar .kin-sec-pill").forEach((pill) => {
        pill.classList.toggle("active", pill.dataset.ksec === "all");
      });
    }

    applyEnabledServicesVisibility();
    updateKinoriumUserBadge();
    updateKinoriumSectionCounters();
    updateActiveFiltersBadge();
    renderIntegrationsList();
    updateBackupSummaryStat();
    renderNotificationsBell();
    if (!document.getElementById("profiles-modal")?.classList.contains("hidden")) {
      renderProfilesModalUI(state.activeProfileId);
    }

    const activeLabel = getProfileDisplayLabel(state.activeProfile);
    showToast(
      state.activeProfile?.kids_mode
        ? t(`Включён детский профиль «${activeLabel}» (безопасный каталог)`, `Kids profile "${activeLabel}" active (safe catalog)`)
        : t(`Профиль переключён: «${activeLabel}»`, `Switched profile: "${activeLabel}"`)
    );
    await loadCatalog();
    refreshDownloadsState();
    pushDesktopRemoteStateNow();
  } catch (_) {
    showToast(t("Ошибка при переключении профиля", "Error switching profile"));
  }
}

export let _editingProfileId = "main";
export let _editingProfileColor = "#0A84FF";
export let _clearKidsPinRequested = false;

export async function openProfilesModal(editProfileId = "") {
  const modal = document.getElementById("profiles-modal");
  if (!modal) return;
  exitBrowserFullscreenIfNeeded();
  const wasHidden = modal.classList.contains("hidden");
  if (wasHidden) {
    rememberModalTriggerFocus("profiles-modal");
  }
  try {
    const res = await fetch(`/api/profiles?lang=${encodeURIComponent(state.appLang || "ru")}`);
    if (res.ok) {
      const data = await res.json();
      applyProfilesPayload(data);
    }
  } catch (_) {}

  _editingProfileId = editProfileId || state.activeProfileId || "main";
  renderProfilesModalUI(_editingProfileId);
  modal.classList.remove("hidden");
  if (wasHidden) {
    requestAnimationFrame(() => {
      (
        document.getElementById("prof-edit-name") ||
        document.getElementById("close-profiles-modal")
      )?.focus({ preventScroll: true });
    });
  }
  syncScrollTopButton();
}

export function closeProfilesModal() {
  const modal = document.getElementById("profiles-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  closeCustomSelectMenu({ restoreFocus: false });
  modal.classList.add("hidden");
  syncScrollTopButton();
  restoreModalTriggerFocus("profiles-modal");
}

export function renderProfilesModalUI(editProfileId = _editingProfileId) {
  _editingProfileId = editProfileId || "new";
  _clearKidsPinRequested = false;
  const cardsEl = document.getElementById("profiles-modal-cards");
  const formTitleEl = document.getElementById("profiles-form-title");
  const nameInput = document.getElementById("prof-edit-name");
  const audioSelect = document.getElementById("prof-edit-audio");
  const kidsToggle = document.getElementById("prof-edit-kids");
  const pinBox = document.getElementById("prof-kids-pin-box");
  const pinInput = document.getElementById("prof-edit-pin");
  const pinStatusTag = document.getElementById("prof-pin-status-tag");
  const clearPinBtn = document.getElementById("btn-prof-clear-pin");
  const swatchesEl = document.getElementById("prof-edit-swatches");
  const deleteBtn = document.getElementById("btn-prof-delete");
  const kinNoteEl = document.getElementById("prof-edit-kinorium-note");
  const kinOneClickBtn = document.getElementById("btn-prof-kinorium-oneclick");
  if (!cardsEl || !nameInput || !audioSelect || !kidsToggle || !swatchesEl) return;

  const list = Array.isArray(state.profiles) ? state.profiles : [];
  const editingExisting = _editingProfileId !== "new" ? list.find((p) => p.id === _editingProfileId) : null;
  if (!editingExisting && _editingProfileId !== "new" && list.length > 0) {
    _editingProfileId = list[0].id;
  }
  const target = _editingProfileId === "new" ? null : list.find((p) => p.id === _editingProfileId) || null;
  _editingProfileColor = target?.avatar_color || PROFILE_COLOR_SWATCHES[list.length % PROFILE_COLOR_SWATCHES.length];

  cardsEl.innerHTML =
    list
      .map((p) => {
        const isAct = p.id === state.activeProfileId;
        const isSel = p.id === _editingProfileId;
        const pLabel = getProfileDisplayLabel(p);
        const pAvatarUrl = getProfileAvatarUrl(p);
        const pInit = _computeInitialsFromName(pLabel);
        const cCls = _profileColorClass(p.avatar_color);
        return `
          <div class="atv-prof-card${isSel ? " is-editing" : ""}${isAct ? " is-active-prof" : ""}" data-prof-card="${escapeAttr(p.id)}" tabindex="0" role="button">
            <div class="atv-profile-avatar is-lg ${cCls}${pAvatarUrl ? " has-avatar-img" : ""}">${_renderAvatarInnerHtml(pAvatarUrl, pInit, pLabel)}</div>
            <div class="atv-prof-card-name">${escapeHtml(pLabel)}</div>
            <div class="atv-prof-card-badges">
              ${isAct ? `<span class="atv-prof-active-tag">${t("Активен", "Active")}</span>` : ""}
              ${p.kids_mode ? `<span class="atv-kids-pill">${t("Дети", "Kids")}${p.has_kids_pin ? ` ${iconSvg("lock", 10)}` : ""}</span>` : ""}
            </div>
            <div class="atv-prof-card-actions">
              ${
                isAct
                  ? `<button type="button" class="atv-btn-secondary atv-btn-xs" data-edit-prof="${escapeAttr(p.id)}">${t("Изменить", "Edit")}</button>`
                  : `<button type="button" class="atv-btn-primary atv-btn-xs" data-use-prof="${escapeAttr(p.id)}">${t("Выбрать", "Switch")}</button>
                     <button type="button" class="atv-btn-secondary atv-btn-xs" data-edit-prof="${escapeAttr(p.id)}">${t("Изменить", "Edit")}</button>`
              }
            </div>
          </div>
        `;
      })
      .join("") +
    `
      <button type="button" class="atv-prof-card is-add-card${_editingProfileId === "new" ? " is-editing" : ""}" id="btn-prof-card-new">
        <div class="atv-profile-avatar is-lg is-plus">${iconSvg("plus", 18)}</div>
        <div class="atv-prof-card-name">${t("Новый профиль", "New Profile")}</div>
        <div class="atv-prof-card-badges"><span class="atv-prof-sub-hint">${t("Добавить", "Create")}</span></div>
      </button>
    `;
  _bindAvatarImgFallbacks(cardsEl);

  cardsEl.querySelectorAll("[data-use-prof]").forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      switchActiveProfile(b.dataset.useProf);
    };
  });
  cardsEl.querySelectorAll("[data-edit-prof]").forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      renderProfilesModalUI(b.dataset.editProf);
    };
  });
  cardsEl.querySelectorAll("[data-prof-card]").forEach((c) => {
    c.onclick = () => {
      renderProfilesModalUI(c.dataset.profCard);
    };
    c.onkeydown = (ev) => {
      if (ev.target === c && (ev.key === "Enter" || ev.key === " ")) {
        ev.preventDefault();
        renderProfilesModalUI(c.dataset.profCard);
      }
    };
  });
  cardsEl.querySelector("#btn-prof-card-new")?.addEventListener("click", () => {
    renderProfilesModalUI("new");
    nameInput.focus();
  });

  if (formTitleEl) {
    formTitleEl.textContent = target
      ? `${t("Настройки профиля", "Profile Settings")}: ${getProfileDisplayLabel(target)}`
      : t("Создание нового профиля", "Create New Profile");
  }
  nameInput.value = target ? getProfileBaseLabel(target) : "";
  audioSelect.value = target?.default_audio_pref || "auto";
  syncCustomSelect(audioSelect);
  kidsToggle.checked = Boolean(target?.kids_mode);
  kidsToggle.disabled = Boolean(target?.id === "main");

  const hasExistingPin = Boolean(target?.kids_mode && target?.has_kids_pin);
  if (pinBox) {
    pinBox.classList.toggle("hidden", !kidsToggle.checked);
  }
  if (pinInput) {
    pinInput.value = "";
    pinInput.placeholder = hasExistingPin
      ? t("Новый PIN (4 цифры) или оставьте пустым", "New PIN (4 digits) or leave blank")
      : t("4 цифры (оставьте пустым без PIN)", "4 digits (leave blank for no PIN)");
    pinInput.oninput = () => {
      pinInput.value = String(pinInput.value || "").replace(/\D+/g, "").slice(0, 4);
      if (pinInput.value) _clearKidsPinRequested = false;
    };
  }
  if (pinStatusTag) {
    pinStatusTag.textContent = t("PIN активен", "PIN active");
    pinStatusTag.classList.toggle("hidden", !hasExistingPin);
  }
  if (clearPinBtn) {
    clearPinBtn.classList.toggle("hidden", !hasExistingPin);
    clearPinBtn.onclick = () => {
      _clearKidsPinRequested = true;
      if (pinInput) {
        pinInput.value = "";
        pinInput.placeholder = t("PIN будет удалён при сохранении", "PIN will be cleared on save");
      }
      pinStatusTag?.classList.add("hidden");
      clearPinBtn.classList.add("hidden");
    };
  }
  kidsToggle.onchange = () => {
    pinBox?.classList.toggle("hidden", !kidsToggle.checked);
  };

  const swatchColorNames = {
    "#0a84ff": t("Синий", "Blue"),
    "#30d158": t("Изумрудный", "Green"),
    "#ff9f0a": t("Янтарный", "Amber"),
    "#bf5af2": t("Фиолетовый", "Purple"),
    "#ff375f": t("Алый", "Coral"),
    "#64d2ff": t("Бирюзовый", "Cyan"),
    "#ffd60a": t("Золотистый", "Gold"),
    "#5e5ce6": t("Индиго", "Indigo"),
  };
  swatchesEl.setAttribute("role", "group");
  swatchesEl.setAttribute("aria-label", t("Цвет аватара", "Avatar color"));
  swatchesEl.innerHTML = PROFILE_COLOR_SWATCHES.map((hex) => {
    const cls = _profileColorClass(hex);
    const activeSw = hex.toLowerCase() === String(_editingProfileColor || "").toLowerCase();
    const colorLbl = swatchColorNames[hex.toLowerCase()] || hex;
    return `<button type="button" class="atv-prof-swatch ${cls}${activeSw ? " active" : ""}" data-swatch="${escapeAttr(hex)}" aria-pressed="${activeSw ? "true" : "false"}" aria-label="${escapeAttr(colorLbl)}" title="${escapeAttr(colorLbl)}"></button>`;
  }).join("");

  swatchesEl.querySelectorAll("[data-swatch]").forEach((sw) => {
    sw.onclick = () => {
      _editingProfileColor = sw.dataset.swatch || "#0A84FF";
      swatchesEl.querySelectorAll("[data-swatch]").forEach((x) => {
        const isSel = x === sw;
        x.classList.toggle("active", isSel);
        x.setAttribute("aria-pressed", isSel ? "true" : "false");
      });
    };
  });

  if (deleteBtn) {
    const canDelete = Boolean(target && !target.builtin && target.id !== "main");
    deleteBtn.classList.toggle("hidden", !canDelete);
  }

  if (kinNoteEl && kinOneClickBtn) {
    if (target) {
      const kSum = target.kinorium_summary || {};
      const watchedCount =
        (target.id === state.activeProfileId ? Number(state.kinoriumCounts?.watched || 0) : 0) ||
        Number(kSum.watched_count || 0);
      const kDisp = kSum.display_name || (kSum.user_id === "51670" ? "Andrei Crustillio" : (kSum.user_id ? "ID " + kSum.user_id : ""));
      kinNoteEl.textContent = kSum.connected
        ? t(
            `Kinorium привязан: ${kDisp} (просмотрено: ${watchedCount})`,
            `Kinorium linked: ${kDisp} (watched: ${watchedCount})`
          )
        : t(
            "У каждого профиля свой отдельный аккаунт Kinorium и собственная локальная история.",
            "Each profile has its own isolated Kinorium account and local watch history."
          );
      kinOneClickBtn.classList.remove("hidden");
      kinOneClickBtn.textContent =
        target.id === state.activeProfileId
          ? kSum.connected
            ? t("Переподключить Kinorium в 1 клик", "Reconnect Kinorium in 1 Click")
            : t("Войти в Kinorium в 1 клик", "1-Click Sign In to Kinorium")
          : t("Сделать активным и войти в Kinorium", "Switch & Sign In to Kinorium");
    } else {
      kinNoteEl.textContent = t(
        "Сохраните профиль, чтобы привязать к нему отдельный аккаунт Kinorium.",
        "Save the profile first to link a dedicated Kinorium account."
      );
      kinOneClickBtn.classList.add("hidden");
    }
  }
}

export async function saveProfileFromModal() {
  const nameInput = document.getElementById("prof-edit-name");
  const audioSelect = document.getElementById("prof-edit-audio");
  const kidsToggle = document.getElementById("prof-edit-kids");
  const pinInput = document.getElementById("prof-edit-pin");
  const rawName = String(nameInput?.value || "").trim();
  if (!rawName) {
    showToast(t("Введите название профиля", "Enter a profile name"));
    nameInput?.focus();
    return;
  }
  const kidsChecked = Boolean(kidsToggle?.checked);
  const rawPin = String(pinInput?.value || "").trim();
  if (kidsChecked && rawPin && !/^\d{4}$/.test(rawPin)) {
    showToast(t("PIN-код должен состоять ровно из 4 цифр", "PIN must be exactly 4 digits"));
    pinInput?.focus();
    return;
  }

  const isNew = _editingProfileId === "new";
  let kidsPinField;
  if (!kidsChecked) {
    kidsPinField = "";
  } else if (rawPin) {
    kidsPinField = rawPin;
  } else if (_clearKidsPinRequested) {
    kidsPinField = "__clear__";
  }

  let currentPin = "";
  const activeLockedKids = Boolean(state.activeProfile?.kids_mode && state.activeProfile?.has_kids_pin);
  if (activeLockedKids) {
    const entered = await ensureKidsPinVerifiedForAdminAction(
      t(
        "Введите текущий 4-значный PIN-код для изменения профилей",
        "Enter the current 4-digit PIN to modify profiles"
      )
    );
    if (!entered) return;
    currentPin = entered;
  }

  const reqBody = {
    id: isNew ? "" : _editingProfileId,
    name: rawName,
    avatar_color: _editingProfileColor,
    default_audio_pref: audioSelect?.value || "auto",
    kids_mode: kidsChecked,
    activate: isNew,
    current_pin: currentPin,
    lang: state.appLang || "ru",
  };
  if (kidsPinField !== undefined) {
    reqBody.kids_pin = kidsPinField;
  }

  try {
    let res = await fetch("/api/profiles/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });
    let data = await res.json();
    if (res.status === 403 && data.pin_required && !currentPin) {
      const pinTargetId =
        state.activeProfile?.kids_mode && state.activeProfile?.has_kids_pin
          ? state.activeProfile.id
          : isNew
          ? ""
          : _editingProfileId;
      const entered = await promptKidsPinModal({ desc: data.error || "", profileId: pinTargetId });
      if (!entered) return;
      reqBody.current_pin = entered;
      res = await fetch("/api/profiles/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });
      data = await res.json();
    }
    if (!res.ok || data.ok === false) {
      showToast(data.error || t("Не удалось сохранить профиль", "Could not save profile"));
      return false;
    }
    applyProfilesPayload(data);
    if (isNew && data.saved_profile?.id) {
      _editingProfileId = data.saved_profile.id;
      reloadProfileLocalPlayerPrefs();
      if (data.kinorium_account) state.kinoriumAccount = data.kinorium_account;
      if (data.integrations) state.integrations = data.integrations;
      applyEnabledServicesVisibility();
      updateKinoriumUserBadge();
      renderNotificationsBell();
    }
    renderProfilesModalUI(_editingProfileId);
    showToast(
      isNew
        ? t(`Профиль «${rawName}» создан и активирован`, `Profile "${rawName}" created and activated`)
        : t(`Профиль «${rawName}» сохранён`, `Profile "${rawName}" saved`)
    );
    await loadCatalog();
    refreshDownloadsState();
    return true;
  } catch (_) {
    showToast(t("Ошибка при сохранении профиля", "Error saving profile"));
    return false;
  }
}

export async function deleteProfileById(profileId = _editingProfileId) {
  const target = (state.profiles || []).find((p) => p.id === profileId);
  if (!target || target.builtin || target.id === "main") return;
  let pinToSend = "";
  const activeLocked = Boolean(state.activeProfile?.kids_mode && state.activeProfile?.has_kids_pin);
  const targetLocked = Boolean(target.kids_mode && target.has_kids_pin);
  if (activeLocked || targetLocked) {
    const pinTargetId = activeLocked ? state.activeProfile.id : target.id;
    const entered = await promptKidsPinModal({
      desc: t(
        "Введите 4-значный PIN-код для удаления профиля",
        "Enter the 4-digit PIN to delete this profile"
      ),
      profileId: pinTargetId,
    });
    if (!entered) return;
    pinToSend = entered;
  }
  const confirmed = await showConfirmModal({
    title: t("Удалить профиль?", "Delete Profile?"),
    message: t(
      `Профиль «${getProfileDisplayLabel(target)}» и его отдельные списки будут удалены. Основной профиль «Личный» не затрагивается.`,
      `Profile "${getProfileDisplayLabel(target)}" and its separate lists will be removed. Your Personal profile will remain untouched.`
    ),
    confirmLabel: t("Удалить профиль", "Delete Profile"),
    danger: true,
  });
  if (!confirmed) return;

  try {
    let res = await fetch("/api/profiles/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: target.id, pin: pinToSend, lang: state.appLang || "ru" }),
    });
    let data = await res.json();
    if (res.status === 403 && data.pin_required && !pinToSend) {
      const pinTargetId =
        state.activeProfile?.kids_mode && state.activeProfile?.has_kids_pin
          ? state.activeProfile.id
          : target.id;
      const entered = await promptKidsPinModal({ desc: data.error || "", profileId: pinTargetId });
      if (!entered) return;
      pinToSend = entered;
      res = await fetch("/api/profiles/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id, pin: pinToSend, lang: state.appLang || "ru" }),
      });
      data = await res.json();
    }
    if (!res.ok || data.ok === false) {
      showToast(data.error || t("Не удалось удалить профиль", "Could not delete profile"));
      return;
    }
    applyProfilesPayload(data);
    reloadProfileLocalPlayerPrefs();
    if (data.kinorium_account) state.kinoriumAccount = data.kinorium_account;
    if (data.integrations) state.integrations = data.integrations;
    applyEnabledServicesVisibility();
    updateKinoriumUserBadge();
    renderProfilesModalUI(state.activeProfileId);
    showToast(t("Профиль удалён", "Profile deleted"));
    await loadCatalog();
    refreshDownloadsState();
  } catch (_) {
    showToast(t("Ошибка при удалении профиля", "Error deleting profile"));
  }
}

