import {
  BOOKMARKS_STORAGE_KEY,
  EPISODE_PROGRESS_STORAGE_KEY,
  PLAYER_PREFS_STORAGE_KEY,
  PREFERRED_STUDIOS_STORAGE_KEY,
  RECENT_SEARCHES_STORAGE_KEY,
  SEEN_NOTIFICATIONS_STORAGE_KEY,
  UI_PREFS_STORAGE_KEY,
  WATCH_HISTORY_STORAGE_KEY,
  profileStorageKey,
  profileStorageKeyFor,
  state,
} from "./state.js?v=20261111v5";
import {
  applyStaticDomTranslations,
  displayAddonDescription,
  isEn,
  syncLanguageSegmentedControlUI,
  t,
} from "./i18n.js?v=20261111v5";
import {
  closeCustomSelectMenu,
  copyTextToClipboard,
  escapeAttr,
  escapeHtml,
  getWatchHistoryList,
  invalidateLocalCaches,
  rememberModalTriggerFocus,
  restoreModalTriggerFocus,
  saveUiPrefs,
  showConfirmModal,
  showToast,
  syncAllCustomSelects,
  syncCustomSelect,
  syncScrollTopButton,
} from "./utils.js?v=20261111v5";
import { applyEnabledServicesVisibility, isServiceEnabled } from "./catalog-media-resolver.js?v=20261111v5";
import {
  renderCatalogShelves,
  renderContinueWatching,
} from "./catalog-shelves.js?v=20261111v5";
import { renderHero } from "./catalog-hero.js?v=20261111v5";
import { renderNotificationsBell } from "./catalog-notifications.js?v=20261111v5";
import {
  updateActiveFiltersBadge,
  updateDynamicCatalogFilters,
} from "./catalog-filters.js?v=20261111v5";
import {
  clearCatalogFrontendCache,
  loadCatalog,
  renderLoginBannerIfNeeded,
  updateFriendsFilterDropdown,
  updateKinoriumUserBadge,
} from "./catalog.js?v=20261111v5";
import { openQuickPeekModal, openStatsModal, refreshOpenPersonModalUI, syncModalBackButtons } from "./modals.js?v=20261111v5";
import { loadStremioStreams } from "./player-streams.js?v=20261111v5";
import { renderModalProvidersSidebar } from "./player-meta.js?v=20261111v5";
import {
  refreshOpenPlayerLanguageUI,
  syncPlayerOfflineControlsUI,
} from "./player.js?v=20261111v5";
import {
  applyProfilesPayload,
  ensureKidsPinVerifiedForAdminAction,
  openProfilesModal,
  promptKidsPinModal,
  refreshDownloadsState,
  reloadProfileLocalPlayerPrefs,
  renderDownloadsModalList,
  renderHeaderProfileSwitcher,
  renderProfilesModalUI,
  renderTvCastModalUI,
  startOneClickKinoriumLogin,
} from "./features.js?v=20261111v5";
import {
  loadAndRenderRemotePairingPanel,
  pushDesktopRemoteStateNow,
  syncDesktopConnectedRemotesUI,
} from "./remote.js?v=20261111v5";
import {
  changeUserCountryInstant,
  closeOnboardingModal,
  detectEuropeanCountryFromTimezone,
  openOnboardingModal,
  renderOnboardingModalUI,
  renderSettingsCountryUI,
  setOnboardingStep,
  skipOnboardingModal,
  submitOnboardingModal,
} from "./settings-onboarding.js?v=20261111v5";
import {
  buildFullBackupPayload,
  checkAppUpdates,
  handleExportBackup,
  openDownloadedInstaller,
  openManualBackupPasteBox,
  renderAppUpdaterUI,
  restoreFromBackupObject,
  saveUpdaterSettingsImmediate,
  startAppUpdateDownload,
  updateBackupSummaryStat,
} from "./settings-updater.js?v=20261111v5";

export {
  buildFullBackupPayload,
  changeUserCountryInstant,
  checkAppUpdates,
  closeOnboardingModal,
  detectEuropeanCountryFromTimezone,
  handleExportBackup,
  openDownloadedInstaller,
  openManualBackupPasteBox,
  openOnboardingModal,
  renderAppUpdaterUI,
  renderOnboardingModalUI,
  renderSettingsCountryUI,
  restoreFromBackupObject,
  saveUpdaterSettingsImmediate,
  setOnboardingStep,
  skipOnboardingModal,
  startAppUpdateDownload,
  submitOnboardingModal,
  updateBackupSummaryStat,
};

export function _adminPinPayload() {
  return state.verifiedKidsAdminPin
    ? { pin: state.verifiedKidsAdminPin, current_pin: state.verifiedKidsAdminPin }
    : {};
}

export function applyAppLanguage(nextLang, options = {}) {
  const { persistServer = true, announce = false } = options;
  const norm = String(nextLang || "").toLowerCase().startsWith("en") ? "en" : "ru";
  const changed = state.appLang !== norm;
  state.appLang = norm;
  state.trailerLang = norm;
  saveUiPrefs({ appLang: norm });

  applyStaticDomTranslations();
  syncLanguageSegmentedControlUI();
  renderHeaderProfileSwitcher();
  applyEnabledServicesVisibility();
  updateKinoriumUserBadge();
  updateDynamicCatalogFilters();
  updateFriendsFilterDropdown();
  renderLoginBannerIfNeeded();
  renderHero();
  renderContinueWatching();
  renderCatalogShelves({ skipHero: true });
  renderIntegrationsList();
  renderSettingsCountryUI();
  renderStremioAddonsList();
  renderTorrserverStatusText();
  renderSystemStatusUI();
  updateBackupSummaryStat();
  syncSettingsFooterUI();
  syncModalBackButtons();
  const obMod = document.getElementById("onboarding-modal");
  if (obMod && !obMod.classList.contains("hidden")) {
    renderOnboardingModalUI();
  }
  if (!document.getElementById("profiles-modal")?.classList.contains("hidden")) {
    renderProfilesModalUI();
  }
  if (!document.getElementById("downloads-modal")?.classList.contains("hidden")) {
    renderDownloadsModalList();
  }
  syncDesktopConnectedRemotesUI(state.remotePairInfo?.connected_remotes || []);
  if (!document.getElementById("tv-cast-modal")?.classList.contains("hidden")) {
    renderTvCastModalUI(false);
    loadAndRenderRemotePairingPanel(false);
  }
  syncPlayerOfflineControlsUI();
  syncAllCustomSelects();

  const searchPop = document.getElementById("search-live-popover");
  const searchInp = document.getElementById("global-search");
  if (searchPop && !searchPop.classList.contains("hidden") && searchInp) {
    if (searchInp.value.trim().length >= 2) {
      searchInp.dispatchEvent(new Event("input"));
    } else {
      searchInp.dispatchEvent(new Event("focus"));
    }
  }

  const qpModal = document.getElementById("quick-peek-modal");
  if (qpModal && !qpModal.classList.contains("hidden") && state.quickPeekItem) {
    openQuickPeekModal(state.quickPeekItem, { skipStackPush: true });
  }
  const statsModal = document.getElementById("stats-modal");
  if (statsModal && !statsModal.classList.contains("hidden")) {
    openStatsModal(state.statsActiveTab);
  }
  refreshOpenPersonModalUI(changed);
  if (state.isPlayerOpen && state.activeItem) {
    refreshOpenPlayerLanguageUI(changed);
  }

  try {
    window.webkit?.messageHandlers?.velariumNative?.postMessage({
      action: "appLangChanged",
      lang: norm,
    });
  } catch (err) { window.logDebug?.("Settings", err); }

  if (persistServer) {
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_lang: norm }),
    })
      .then(() => {
        pushDesktopRemoteStateNow();
      })
      .catch(() => {});
  } else {
    pushDesktopRemoteStateNow();
  }
  if (changed) {
    loadCatalog();
    refreshDownloadsState();
  }
  if (announce) {
    showToast(
      norm === "en"
        ? "English interface enabled — Original audio is now selected by default"
        : "Включён русский интерфейс — русская озвучка по умолчанию"
    );
  }
}

// Integrations & Service Logins Management — never mark connected until user explicitly confirms!
export async function triggerServiceLoginFlow(serviceId, customUrl = null) {
  const integ = state.integrations[serviceId];
  if (!integ) return;

  const loginUrl = String(customUrl || integ.login_url || "").trim();
  if (!/^https?:\/\//i.test(loginUrl)) return;
  window.open(loginUrl, "_blank", "noopener,noreferrer,width=1180,height=740");

  if (!integ.logged_in) {
    state.pendingServiceLogins[serviceId] = true;
    renderIntegrationsList();
    renderLoginBannerIfNeeded();
    if (state.isPlayerOpen && state.activeItem) {
      renderModalProvidersSidebar(state.activeItem);
    }
    showToast(
      t(
        `Окно входа в ${integ.name} открыто — после авторизации нажмите «Подтвердить вход»`,
        `${integ.name} sign-in opened — click "Confirm sign-in" after logging in`
      )
    );
  }
}
export async function confirmServiceLogin(serviceId) {
  const integ = state.integrations[serviceId];
  delete state.pendingServiceLogins[serviceId];
  const res = await fetch("/api/integrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: serviceId,
      logged_in: true,
      ..._adminPinPayload(),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    showToast(data?.error || t("Не удалось обновить состояние сервиса", "Failed to update service state"));
    return;
  }
  if (data.integrations) {
    state.integrations = data.integrations;
    renderIntegrationsList();
    renderLoginBannerIfNeeded();
    applyEnabledServicesVisibility();
    if (state.isPlayerOpen && state.activeItem) {
      renderModalProvidersSidebar(state.activeItem);
    }
    showToast(
      t(
        `Вход в ${integ?.name || serviceId} подтверждён`,
        `Signed in to ${integ?.name || serviceId}`
      )
    );
  }
}
export async function toggleServiceConnection(serviceId, newStatus) {
  if (!newStatus) {
    delete state.pendingServiceLogins[serviceId];
  }
  const res = await fetch("/api/integrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: serviceId,
      logged_in: newStatus,
      ..._adminPinPayload(),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    showToast(data?.error || t("Не удалось обновить состояние сервиса", "Failed to update service state"));
    return;
  }
  if (data.integrations) {
    state.integrations = data.integrations;
    renderIntegrationsList();
    renderLoginBannerIfNeeded();
    applyEnabledServicesVisibility();
    if (state.isPlayerOpen && state.activeItem) {
      renderModalProvidersSidebar(state.activeItem);
    }
  }
}
export async function toggleServiceEnabled(serviceId, isEnabled) {
  const srvName = state.integrations?.[serviceId]?.name || serviceId;
  try {
    const res = await fetch("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: serviceId,
        enabled: Boolean(isEnabled),
        ..._adminPinPayload(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      renderIntegrationsList();
      showToast(data?.error || t("Не удалось обновить состояние сервиса", "Failed to update service state"));
      return;
    }
    if (data.integrations) {
      state.integrations = data.integrations;
      applyEnabledServicesVisibility();
      renderIntegrationsList();
      renderLoginBannerIfNeeded();
      clearCatalogFrontendCache();
      await loadCatalog();
      showToast(
        isEnabled
          ? t(`Сервис «${srvName}» включён`, `Service "${srvName}" enabled`)
          : t(`Сервис «${srvName}» отключён и скрыт во всём приложении`, `Service "${srvName}" disabled and hidden`)
      );
    }
  } catch (err) {
    showToast(t("Не удалось обновить состояние сервиса", "Failed to update service state"));
  }
}
export function buildServiceToggleHtml(serviceId, isEnabled, serviceLabel = "") {
  const actionLabel = isEnabled
    ? t("Отключить сервис", "Disable service")
    : t("Включить сервис", "Enable service");
  const fullLabel = serviceLabel ? `${actionLabel}: ${serviceLabel}` : `${actionLabel}: ${serviceId}`;
  return `
    <label class="srv-toggle-wrap" title="${escapeAttr(actionLabel)}">
      <span class="srv-toggle">
        <input type="checkbox" role="switch" class="srv-enable-checkbox" data-srv="${escapeAttr(serviceId)}" aria-label="${escapeAttr(fullLabel)}" ${
    isEnabled ? "checked" : ""
  } />
        <span class="srv-toggle-slider"></span>
      </span>
    </label>
  `;
}
export function renderIntegrationsList() {
  const listEl = document.getElementById("integrations-list");
  if (!listEl) return;
  const activeAddonsCountSig = (state.stremioAddons || []).filter((a) => a && a.enabled !== false).length;
  const acc = state.kinoriumAccount || {};
  const integSig = `${state.appLang || "ru"}|${Boolean(state.kinoriumFormExpanded)}|${Boolean(state.systemStatus?.is_local_client)}|${acc.connected ? 1 : 0}:${acc.user_id || ""}:${acc.display_name || ""}:${acc.has_session_cookie ? 1 : 0}|${activeAddonsCountSig}|${Object.keys(state.pendingServiceLogins || {}).join(",")}|${JSON.stringify(state.integrations || {})}`;
  if (listEl._integrationsSig === integSig && listEl.childElementCount > 0) {
    return;
  }
  listEl._integrationsSig = integSig;
  const prevPaidDetailsOpen = Boolean(
    listEl.querySelector(".atv-paid-services-details")?.hasAttribute("open")
  );
  listEl.innerHTML = "";
  const integFrag = document.createDocumentFragment();

  const order = [
    "kinorium",
    "hdrezka",
    "stremio",
    "backup4k",
    "appletv",
    "netflix",
    "prime",
    "disney",
    "max",
    "playerpl",
  ];
  const paidKeys = new Set(["appletv", "netflix", "prime", "disney", "max", "playerpl"]);
  const anyPaidConnected = Array.from(paidKeys).some(
    (k) => Boolean(state.integrations?.[k]?.logged_in)
  );
  let renderedKinoriumGroup = false;
  let renderedVideoGroup = false;
  let paidServicesBodyEl = null;

  order.forEach((key) => {
    const integ = state.integrations[key];
    if (!integ) return;

    if (key === "kinorium" && !renderedKinoriumGroup) {
      renderedKinoriumGroup = true;
      const groupHead = document.createElement("div");
      groupHead.className = "integrations-group-label";
      groupHead.textContent = t("Профиль", "Profile");
      integFrag.appendChild(groupHead);
    } else if (key !== "kinorium" && !renderedVideoGroup) {
      renderedVideoGroup = true;
      const groupHead = document.createElement("div");
      groupHead.className = "integrations-group-label";
      groupHead.textContent = t("Источники видео", "Video Sources");
      integFrag.appendChild(groupHead);
    }

    if (paidKeys.has(key) && !paidServicesBodyEl) {
      const paidDetails = document.createElement("details");
      paidDetails.className = "atv-advanced-details atv-paid-services-details";
      if (prevPaidDetailsOpen || anyPaidConnected) {
        paidDetails.setAttribute("open", "");
      }
      const summary = document.createElement("summary");
      summary.textContent = t(
        "Официальные видеосервисы (по подписке)",
        "Official Subscription Services"
      );
      paidDetails.appendChild(summary);
      paidServicesBodyEl = document.createElement("div");
      paidServicesBodyEl.className = "atv-paid-services-list";
      paidDetails.appendChild(paidServicesBodyEl);
      integFrag.appendChild(paidDetails);
    }

    const isEnabled = integ.enabled !== false;
    const row = document.createElement("div");
    row.className = `integration-row${isEnabled ? "" : " is-disabled"}`;

    if (key === "hdrezka") {
      row.innerHTML = `
        <div class="integration-info">
          <div class="integration-name"><span>HDRezka</span></div>
          <div class="integration-status">
            ${
              isEnabled
                ? t("Прямой поток 1080p · без регистрации", "Direct 1080p stream · no account")
                : t("Скрыт в интерфейсе", "Hidden in interface")
            }
          </div>
        </div>
        <div class="integration-actions">
          ${buildServiceToggleHtml(key, isEnabled)}
        </div>
      `;
    } else if (key === "stremio") {
      const activeAddonsCount = (state.stremioAddons || []).filter((a) => a && a.enabled !== false).length;
      const addonsCountNote =
        activeAddonsCount > 0
          ? t(` · аддонов: ${activeAddonsCount}`, ` · ${activeAddonsCount} addons`)
          : "";
      row.innerHTML = `
        <div class="integration-info">
          <div class="integration-name"><span>Stremio</span></div>
          <div class="integration-status">
            ${
              isEnabled
                ? `${t("Потоки и субтитры из аддонов", "Addon streams & subtitles")}${escapeHtml(addonsCountNote)}`
                : t("Скрыт в интерфейсе", "Hidden in interface")
            }
          </div>
        </div>
        <div class="integration-actions">
          ${
            isEnabled
              ? `<button type="button" class="atv-btn-secondary atv-btn-xs btn-config-stremio">${t("Аддоны", "Addons")}</button>`
              : ""
          }
          ${buildServiceToggleHtml(key, isEnabled)}
        </div>
      `;
      const cfgStremioBtn = row.querySelector(".btn-config-stremio");
      if (cfgStremioBtn) {
        cfgStremioBtn.onclick = () => {
          switchSettingsTab("network");
          setTimeout(() => {
            const grp = document.getElementById("net-group-stremio");
            grp?.scrollIntoView({ behavior: "smooth", block: "start" });
            document.getElementById("cfg-stremio-manifest-input")?.focus();
          }, 50);
        };
      }
    } else if (key === "backup4k") {
      row.innerHTML = `
        <div class="integration-info">
          <div class="integration-name"><span>4K Remux</span></div>
          <div class="integration-status">
            ${
              isEnabled
                ? t("UHD HDR · TorrServer или Debrid", "UHD HDR · TorrServer or Debrid")
                : t("Скрыт в интерфейсе", "Hidden in interface")
            }
          </div>
        </div>
        <div class="integration-actions">
          ${buildServiceToggleHtml(key, isEnabled)}
        </div>
      `;
    } else if (key === "kinorium") {
      row.classList.add("kinorium-card");
      const acc = state.kinoriumAccount || {};
      const isConnected = Boolean(acc.connected && acc.user_id);
      const rawProfileUrl = String(
        acc.profile_url ||
          (acc.user_id ? `https://en.kinorium.com/user/${encodeURIComponent(acc.user_id)}/` : "https://en.kinorium.com/")
      ).trim();
      const profileUrl = /^https?:\/\//i.test(rawProfileUrl) ? rawProfileUrl : "https://en.kinorium.com/";
      const currentInputVal = acc.profile_url || acc.user_id || "";
      const showFullForm = !isConnected || Boolean(state.kinoriumFormExpanded);
      const cookiePlaceholder = acc.has_session_cookie
        ? t("Куки сохранены (вставьте новые для замены)", "Cookies saved (paste new to replace)")
        : t("Session Cookie (необязательно)", "Session Cookie (optional)");
      const effDispName =
        acc.user_id === "51670" && (!acc.display_name || acc.display_name.startsWith("user_"))
          ? "Andrei Crustillio"
          : acc.display_name && !acc.display_name.startsWith("user_")
          ? acc.display_name
          : acc.user_id
          ? `ID ${acc.user_id}`
          : "";
      const kinStatusText = !isEnabled
        ? t("Скрыт в интерфейсе", "Hidden in interface")
        : isConnected
        ? `${escapeHtml(effDispName || "ID " + acc.user_id)}${
            acc.has_session_cookie
              ? t(" · двусторонняя синхронизация", " · two-way sync")
              : t(" · списки и оценки", " · lists & ratings")
          }`
        : t("Профиль не подключён", "Profile not connected");

      row.innerHTML = `
        <div class="kin-card-top">
          <div class="integration-info">
            <div class="integration-name"><span>Kinorium</span></div>
            <div class="integration-status" title="${isConnected ? escapeAttr(profileUrl) : ""}">
              ${kinStatusText}
            </div>
          </div>
          <div class="integration-actions">
            ${
              isEnabled && !isConnected && !state.kinoriumFormExpanded
                ? `<button type="button" class="atv-btn-primary atv-btn-xs btn-kin-one-click">
                    <span>${t("Войти в 1 клик (авто)", "1-Click Sign In")}</span>
                  </button>`
                : ""
            }
            ${
              isEnabled && isConnected && !showFullForm
                ? `<button type="button" class="atv-btn-secondary atv-btn-xs btn-sync-kin-quick">${t("Синхронизировать", "Sync")}</button>
                   <button type="button" class="atv-btn-secondary atv-btn-xs btn-expand-kin-form">${t("Изменить", "Edit")}</button>`
                : ""
            }
            ${buildServiceToggleHtml(key, isEnabled)}
          </div>
        </div>
        ${
          !isEnabled || !showFullForm
            ? ""
            : !isConnected && !state.kinoriumFormExpanded
            ? `
        <details class="atv-advanced-details kin-manual-details">
          <summary>${t("Ввести ID или Session Cookie вручную", "Enter Profile ID or Cookie manually")}</summary>
          <div class="kin-switcher-box">
            <div class="kin-switcher-row">
              <input
                type="text"
                class="kin-switcher-input"
                id="kin-quick-user-input"
                autocomplete="off"
                aria-label="${escapeAttr(t("ID или ссылка на профиль", "Profile ID or URL"))}"
                value="${escapeAttr(currentInputVal)}"
                placeholder="${escapeAttr(t("ID или ссылка на профиль (например 51670)", "Profile ID or URL (e.g. 51670)"))}"
              />
              <input
                type="password"
                class="kin-switcher-input"
                id="kin-quick-cookie-input"
                autocomplete="off"
                spellcheck="false"
                aria-label="${escapeAttr(t("Session Cookie из браузера", "Browser Session Cookie"))}"
                placeholder="${escapeAttr(cookiePlaceholder)}"
              />
            </div>
            <div class="kin-switcher-row is-actions">
              <button type="button" class="atv-btn-secondary atv-btn-xs btn-sync-kin">
                <span>${t("По ID вручную", "Connect by ID")}</span>
              </button>
            </div>
          </div>
        </details>`
            : `
        <div class="kin-switcher-box">
          <div class="kin-switcher-row">
            <input
              type="text"
              class="kin-switcher-input"
              id="kin-quick-user-input"
              autocomplete="off"
              aria-label="${escapeAttr(t("ID или ссылка на профиль", "Profile ID or URL"))}"
              value="${escapeAttr(currentInputVal)}"
              placeholder="${escapeAttr(t("ID или ссылка на профиль (например 51670)", "Profile ID or URL (e.g. 51670)"))}"
            />
            <input
              type="password"
              class="kin-switcher-input"
              id="kin-quick-cookie-input"
              autocomplete="off"
              spellcheck="false"
              aria-label="${escapeAttr(t("Session Cookie из браузера", "Browser Session Cookie"))}"
              placeholder="${escapeAttr(cookiePlaceholder)}"
            />
          </div>
          <div class="kin-switcher-row is-actions">
            <button type="button" class="atv-btn-primary atv-btn-xs btn-kin-one-click">
              <span>${t("Войти в 1 клик (авто)", "1-Click Sign In")}</span>
            </button>
            ${
              isConnected
                ? `<button type="button" class="atv-btn-secondary atv-btn-xs btn-login-srv">
                    ${t("Профиль", "Profile")}
                  </button>
                  ${
                    state.systemStatus?.is_local_client !== false
                      ? `<button type="button" class="atv-btn-secondary atv-btn-xs atv-btn-danger-text btn-disconnect-kin">
                          ${t("Отключить", "Disconnect")}
                        </button>`
                      : ""
                  }
                  <button type="button" class="atv-btn-secondary atv-btn-xs btn-collapse-kin-form">
                    ${t("Свернуть", "Collapse")}
                  </button>`
                : ""
            }
            <button type="button" class="atv-btn-secondary atv-btn-xs btn-sync-kin">
              <span>${isConnected ? t("Сохранить вручную", "Save manually") : t("По ID вручную", "Connect by ID")}</span>
            </button>
          </div>
        </div>`
        }
      `;

      const runKinSync = async (btn, rawInput, rawCookie) => {
        if (!rawInput && !rawCookie) {
          showToast(t("Введите ID пользователя или ссылку на профиль Kinorium", "Enter your Kinorium user ID or profile URL"));
          row.querySelector("#kin-quick-user-input")?.focus();
          return;
        }
        const prevText = btn.textContent;
        btn.textContent = t("Синхронизация...", "Syncing...");
        btn.disabled = true;
        try {
          const payload = { user_id: rawInput, ..._adminPinPayload() };
          if (rawCookie) payload.session_cookie = rawCookie;
          const res = await fetch("/api/kinorium/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok) {
            if (btn.isConnected) btn.textContent = prevText;
            showToast(data?.error || t("Ошибка синхронизации с Kinorium", "Failed to sync with Kinorium"));
            return;
          }
          if (data.kinorium_account) {
            state.kinoriumAccount = data.kinorium_account;
            updateKinoriumUserBadge();
            renderHeaderProfileSwitcher();
            if (!document.getElementById("profiles-modal")?.classList.contains("hidden")) {
              renderProfilesModalUI();
            }
          }
          if (data.integrations) state.integrations = data.integrations;
          if (!data.sync?.error) {
            state.kinoriumFormExpanded = false;
          }
          renderIntegrationsList();
          syncSettingsFooterUI();
          clearCatalogFrontendCache();
          await loadCatalog();
          if (data.sync?.error) {
            showToast(`${t("Ошибка", "Error")}: ${data.sync.error}`);
          } else {
            const switchedNote = data.sync?.switched_user ? t("Профиль переключён! ", "Profile switched! ") : "";
            showToast(
              t(
                `${switchedNote}Kinorium: ${data.sync?.display_name || rawInput} (Смотрю: ${
                  data.sync?.watching_count || 0
                }, Буду смотреть: ${data.sync?.watchlist_count || 0}, Просмотрено: ${data.sync?.watched_count || 0})`,
                `${switchedNote}Kinorium: ${data.sync?.display_name || rawInput} (Watching: ${
                  data.sync?.watching_count || 0
                }, Watchlist: ${data.sync?.watchlist_count || 0}, Watched: ${data.sync?.watched_count || 0})`
              )
            );
          }
        } catch (err) {
          if (btn.isConnected) {
            btn.textContent = prevText;
          }
          showToast(t("Ошибка синхронизации с Kinorium", "Failed to sync with Kinorium"));
        } finally {
          if (btn.isConnected) {
            btn.disabled = false;
          }
        }
      };

      const expandFormBtn = row.querySelector(".btn-expand-kin-form");
      if (expandFormBtn) {
        expandFormBtn.onclick = () => {
          state.kinoriumFormExpanded = true;
          renderIntegrationsList();
          setTimeout(() => {
            row.querySelector("#kin-quick-cookie-input")?.focus();
          }, 30);
        };
      }
      row.querySelector(".btn-open-profiles-from-kin")?.addEventListener("click", () => {
        closeCustomSelectMenu({ restoreFocus: false });
        document.getElementById("settings-modal")?.classList.add("hidden");
        restoreModalTriggerFocus("settings-modal");
        state.verifiedKidsAdminPin = "";
        syncScrollTopButton();
        openProfilesModal(state.activeProfileId);
      });
      row.querySelector(".btn-kin-one-click")?.addEventListener("click", (e) => {
        startOneClickKinoriumLogin(e.currentTarget);
      });
      const collapseFormBtn = row.querySelector(".btn-collapse-kin-form");
      if (collapseFormBtn) {
        collapseFormBtn.onclick = () => {
          state.kinoriumFormExpanded = false;
          renderIntegrationsList();
          syncSettingsFooterUI();
        };
      }
      const quickSyncBtn = row.querySelector(".btn-sync-kin-quick");
      if (quickSyncBtn) {
        quickSyncBtn.onclick = (e) => runKinSync(e.currentTarget, currentInputVal, "");
      }
      const syncBtn = row.querySelector(".btn-sync-kin");
      if (syncBtn) {
        syncBtn.onclick = (e) => {
          const rawInput = (row.querySelector("#kin-quick-user-input")?.value || "").trim();
          const rawCookie = (row.querySelector("#kin-quick-cookie-input")?.value || "").trim();
          runKinSync(e.currentTarget, rawInput, rawCookie);
        };
      }
      ["#kin-quick-user-input", "#kin-quick-cookie-input"].forEach((inpSel) => {
        const inpEl = row.querySelector(inpSel);
        if (!inpEl) return;
        inpEl.addEventListener("input", () => syncSettingsFooterUI());
        inpEl.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" && syncBtn) {
            ev.preventDefault();
            syncBtn.click();
          }
        });
      });

      const disconnectBtn = row.querySelector(".btn-disconnect-kin");
      if (disconnectBtn) {
        disconnectBtn.onclick = async (e) => {
          const btn = e.currentTarget;
          const confirmed = await showConfirmModal({
            title: t("Отключить профиль Kinorium?", "Disconnect Kinorium profile?"),
            message: t(
              "Списки «Смотрю», «Буду смотреть», «Просмотрено» и сохранённые куки будут отвязаны от приложения. Вы сможете подключить профиль заново в любой момент.",
              "Your Watching, Watchlist, Watched lists and saved cookies will be unlinked from Velarium. You can reconnect your profile anytime."
            ),
            confirmLabel: t("Отключить", "Disconnect"),
            cancelLabel: t("Отмена", "Cancel"),
            danger: true,
          });
          if (!confirmed) return;
          const prevText = btn.textContent;
          btn.textContent = t("Сброс...", "Resetting...");
          btn.disabled = true;
          try {
            const res = await fetch("/api/kinorium/disconnect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ..._adminPinPayload() }),
            });
            const data = await res.json();
            if (!res.ok) {
              if (btn.isConnected) btn.textContent = prevText;
              showToast(data?.error || t("Не удалось сбросить профиль", "Failed to disconnect profile"));
              return;
            }
            if (data.kinorium_account) {
              state.kinoriumAccount = data.kinorium_account;
              updateKinoriumUserBadge();
              renderHeaderProfileSwitcher();
              if (!document.getElementById("profiles-modal")?.classList.contains("hidden")) {
                renderProfilesModalUI();
              }
            }
            if (data.integrations) state.integrations = data.integrations;
            renderIntegrationsList();
            syncSettingsFooterUI();
            clearCatalogFrontendCache();
            await loadCatalog();
            showToast(t("Профиль Kinorium отключён и очищен для нового пользователя", "Kinorium profile disconnected"));
          } catch (err) {
            if (btn.isConnected) {
              btn.textContent = prevText;
            }
            showToast(t("Не удалось сбросить профиль", "Failed to disconnect profile"));
          } finally {
            if (btn.isConnected) {
              btn.disabled = false;
            }
          }
        };
      }

      const openProfileBtn = row.querySelector(".btn-login-srv");
      if (openProfileBtn) {
        openProfileBtn.onclick = () => window.open(profileUrl, "_blank", "noopener,noreferrer");
      }
    } else {
      row.innerHTML = `
        <div class="integration-info">
          <div class="integration-name">
            <span>${escapeHtml(integ.name)}</span>
          </div>
          <div class="integration-status">
            ${
              !isEnabled
                ? t("Скрыт в интерфейсе", "Hidden in interface")
                : integ.logged_in
                ? t("Подписка подключена", "Subscription connected")
                : t("Официальный каталог по подписке", "Official subscription catalog")
            }
          </div>
        </div>
        <div class="integration-actions">
          ${
            isEnabled
              ? `
            <button type="button" class="atv-btn-secondary atv-btn-xs btn-login-srv">
              ${
                integ.logged_in
                  ? t("Открыть", "Open")
                  : state.pendingServiceLogins?.[key]
                  ? t("Открыть снова", "Open Again")
                  : t("Войти", "Sign in")
              }
            </button>
            ${
              !integ.logged_in && state.pendingServiceLogins?.[key]
                ? `<button type="button" class="atv-btn-primary atv-btn-xs btn-confirm-srv">${t("Подтвердить", "Confirm")}</button>`
                : ""
            }
            ${
              integ.logged_in
                ? `<button type="button" class="atv-btn-secondary atv-btn-xs btn-logout-srv">${t("Выйти", "Sign out")}</button>`
                : ""
            }
          `
              : ""
          }
          ${buildServiceToggleHtml(key, isEnabled)}
        </div>
      `;
      const loginBtn = row.querySelector(".btn-login-srv");
      if (loginBtn) {
        loginBtn.onclick = () => triggerServiceLoginFlow(key);
      }
      const confirmBtn = row.querySelector(".btn-confirm-srv");
      if (confirmBtn) {
        confirmBtn.onclick = () => confirmServiceLogin(key);
      }
      const logoutBtn = row.querySelector(".btn-logout-srv");
      if (logoutBtn) {
        logoutBtn.onclick = async () => {
          const confirmed = await showConfirmModal({
            title: t(`Отключить статус входа в ${integ.name}?`, `Reset sign-in status for ${integ.name}?`),
            message: t(
              `Быстрый переход в ${integ.name} будет переключён обратно в режим входа.`,
              `Quick launch for ${integ.name} will return to sign-in mode.`
            ),
            confirmLabel: t("Выйти", "Sign out"),
            cancelLabel: t("Отмена", "Cancel"),
            danger: true,
          });
          if (!confirmed) return;
          toggleServiceConnection(key, false);
        };
      }
    }

    const enableCheckbox = row.querySelector(".srv-enable-checkbox");
    if (enableCheckbox) {
      enableCheckbox.onchange = (e) => {
        toggleServiceEnabled(key, Boolean(e.target.checked));
      };
    }

    if (paidKeys.has(key) && paidServicesBodyEl) {
      paidServicesBodyEl.appendChild(row);
    } else {
      integFrag.appendChild(row);
    }
  });
  listEl.appendChild(integFrag);
}
export function getNetworkSettingsSnapshot() {
  return {
    spoof_region: document.getElementById("cfg-spoof-region")?.value || "KZ",
    custom_mirror: (document.getElementById("cfg-custom-mirror")?.value || "").trim(),
    proxy_url: (document.getElementById("cfg-proxy-url")?.value || "").trim(),
    cf_worker_relay: (document.getElementById("cfg-cf-worker")?.value || "").trim(),
    backup_mode: document.getElementById("cfg-backup-mode")?.value || "torrserver",
    torrserver_url: (document.getElementById("cfg-torrserver-url")?.value || "").trim(),
    debrid_key: (document.getElementById("cfg-debrid-key")?.value || "").trim(),
  };
}
export function isKinoriumQuickFormDirty() {
  const userInp = document.getElementById("kin-quick-user-input");
  const cookieInp = document.getElementById("kin-quick-cookie-input");
  if (!userInp && !cookieInp) return false;
  const acc = state.kinoriumAccount || {};
  const baselineUser = String(acc.profile_url || acc.user_id || "").trim();
  const curUser = (userInp?.value || "").trim();
  const curCookie = (cookieInp?.value || "").trim();
  return curUser !== baselineUser || curCookie.length > 0;
}
export function isNetworkTabFieldsDirty() {
  const base = state.settingsBaseline;
  if (!base) return false;
  const cur = getNetworkSettingsSnapshot();
  return (
    cur.spoof_region !== base.spoof_region ||
    cur.custom_mirror !== base.custom_mirror ||
    cur.proxy_url !== base.proxy_url ||
    cur.cf_worker_relay !== (base.cf_worker_relay || "") ||
    cur.backup_mode !== base.backup_mode ||
    cur.torrserver_url !== base.torrserver_url ||
    cur.debrid_key.length > 0
  );
}
export function isNetworkSettingsDirty() {
  return isNetworkTabFieldsDirty() || isKinoriumQuickFormDirty();
}
export function resetUnsavedSettingsInputs() {
  const base = state.settingsBaseline;
  if (base) {
    const spoofEl = document.getElementById("cfg-spoof-region");
    if (spoofEl) spoofEl.value = base.spoof_region || "KZ";
    const mirrorEl = document.getElementById("cfg-custom-mirror");
    if (mirrorEl) mirrorEl.value = base.custom_mirror || "";
    const proxyEl = document.getElementById("cfg-proxy-url");
    if (proxyEl) proxyEl.value = base.proxy_url || "";
    const workerEl = document.getElementById("cfg-cf-worker");
    if (workerEl) workerEl.value = base.cf_worker_relay || "";
    const backupEl = document.getElementById("cfg-backup-mode");
    if (backupEl) backupEl.value = base.backup_mode || "torrserver";
    const torrEl = document.getElementById("cfg-torrserver-url");
    if (torrEl) torrEl.value = base.torrserver_url || "";
    const debridEl = document.getElementById("cfg-debrid-key");
    if (debridEl) debridEl.value = "";
  }
  state.kinoriumFormExpanded = false;
  renderIntegrationsList();
  syncAllCustomSelects();
  syncSettingsFooterUI();
}
export function syncSettingsFooterUI() {
  const footerEl = document.getElementById("settings-footer");
  const saveBtn = document.getElementById("save-settings-btn");
  const resetBtn = document.getElementById("reset-settings-btn");
  const hintEl = document.getElementById("settings-dirty-hint");
  if (!saveBtn) return;
  const dirty = isNetworkSettingsDirty();
  if (footerEl) {
    footerEl.classList.toggle("hidden", !dirty);
  }
  if (hintEl) {
    hintEl.textContent = t("Есть несохранённые изменения", "Unsaved changes");
  }
  if (resetBtn) {
    resetBtn.textContent = t("Сбросить", "Reset");
  }
  saveBtn.textContent = dirty ? t("Сохранить изменения", "Save Changes") : t("Готово", "Done");
}
export function renderTorrserverStatusText() {
  const torrStatusEl = document.getElementById("cfg-torrserver-status");
  if (!torrStatusEl) return;
  const tConn = Boolean(state.torrserverConnected);
  const rAvail = Boolean(state.remuxAvailable);
  const hwTag = state.hwAccelSummary ? ` · ${state.hwAccelSummary}` : "";
  torrStatusEl.textContent = tConn
    ? t(
        `TorrServer подключён${rAvail ? ` · ремукс активен${hwTag}` : ""}`,
        `TorrServer connected${rAvail ? ` · remux active${hwTag}` : ""}`
      )
    : t(
        "TorrServer запускается автоматически при воспроизведении",
        "TorrServer starts automatically on playback"
      );
  torrStatusEl.classList.toggle("is-connected", tConn);
  torrStatusEl.classList.toggle("is-muted", !tConn);
}

export function renderSystemStatusUI() {
  const sys = state.systemStatus;
  const lanToggle = document.getElementById("cfg-lan-toggle");
  const lanQrCard = document.getElementById("lan-qr-card");
  const lanQrBox = document.getElementById("lan-qr-box");
  const lanUrlCode = document.getElementById("lan-url-code");
  const macCard = document.getElementById("macos-autostart-card");
  const autoToggle = document.getElementById("cfg-autostart-toggle");
  if (!sys) return;

  const isLocalHost = sys.is_local_client !== false;
  const hostOnlyHint = t(
    "Управляется только локально на основном компьютере",
    "Managed only locally on the host computer"
  );
  const lanOn = Boolean(sys.lan_enabled);
  if (lanToggle) {
    lanToggle.checked = lanOn;
    lanToggle.disabled = !isLocalHost;
    lanToggle.title = isLocalHost ? "" : hostOnlyHint;
  }
  if (lanQrCard) {
    const showQr = lanOn && Boolean(sys.lan_url);
    lanQrCard.classList.toggle("hidden", !showQr);
    if (showQr) {
      if (lanUrlCode) lanUrlCode.textContent = sys.lan_url;
      if (lanQrBox && sys.qr_svg) lanQrBox.innerHTML = sys.qr_svg;
    }
  }
  if (macCard) {
    macCard.classList.toggle("hidden", !sys.autostart_supported);
  }
  if (autoToggle) {
    autoToggle.checked = Boolean(sys.autostart_enabled);
    autoToggle.disabled = !isLocalHost;
    autoToggle.title = isLocalHost ? "" : hostOnlyHint;
  }
  [
    "cfg-custom-mirror",
    "cfg-proxy-url",
    "cfg-cf-worker",
    "cfg-torrserver-url",
    "cfg-debrid-key",
    "cfg-stremio-manifest-input",
    "btn-add-stremio-addon",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = !isLocalHost;
      if (!isLocalHost) el.title = hostOnlyHint;
      else el.removeAttribute("title");
    }
  });
  if (sys.updater && typeof sys.updater === "object") {
    state.updaterStatus = sys.updater;
  }
  renderAppUpdaterUI();
}

export async function triggerLanSync() {
  const statusEl = document.getElementById("lan-sync-status");
  const btn = document.getElementById("btn-sync-lan-now");
  const peersCont = document.getElementById("lan-sync-peers-container");
  const peersList = document.getElementById("lan-sync-peers-list");

  if (statusEl) statusEl.textContent = t("Синхронизация...", "Syncing...");
  if (btn) btn.disabled = true;

  try {
    const activeProf = state.activeProfileId || "main";
    let localHistory = [];
    try {
      localHistory = getWatchHistoryList();
    } catch (err) { window.logDebug?.("Settings", err); }

    let localBookmarks = [];
    try {
      const bms =
        localStorage.getItem(profileStorageKeyFor(BOOKMARKS_STORAGE_KEY, activeProf)) ||
        (activeProf === "main"
          ? localStorage.getItem("velarium_moments") || localStorage.getItem("saved_moments")
          : null);
      if (bms) localBookmarks = JSON.parse(bms);
    } catch (err) { window.logDebug?.("Settings", err); }

    let localPreferredStudios = {};
    try {
      const rawStudios = localStorage.getItem(profileStorageKeyFor(PREFERRED_STUDIOS_STORAGE_KEY, activeProf));
      if (rawStudios) localPreferredStudios = JSON.parse(rawStudios) || {};
    } catch (err) { window.logDebug?.("Settings", err); }

    let peers = [];
    try {
      const pRes = await fetch("/api/sync/peers");
      if (pRes.ok) {
        const pJson = await pRes.json();
        peers = pJson.peers || [];
      }
    } catch (err) { window.logDebug?.("Settings", err); }

    const mergeRes = await fetch("/api/sync/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile_id: activeProf,
        watch_history: Array.isArray(localHistory) ? localHistory : [],
        bookmarks: Array.isArray(localBookmarks) ? localBookmarks : [],
        preferred_studios:
          localPreferredStudios && typeof localPreferredStudios === "object" ? localPreferredStudios : {},
      }),
    });

    const mergeData = mergeRes.ok ? await mergeRes.json() : {};
    try {
      if (Array.isArray(mergeData.watch_history) && mergeData.watch_history.length > 0) {
        localStorage.setItem(
          profileStorageKeyFor(WATCH_HISTORY_STORAGE_KEY, activeProf),
          JSON.stringify(mergeData.watch_history.slice(0, 150))
        );
      }
      if (Array.isArray(mergeData.bookmarks) && mergeData.bookmarks.length > 0) {
        localStorage.setItem(
          profileStorageKeyFor(BOOKMARKS_STORAGE_KEY, activeProf),
          JSON.stringify(mergeData.bookmarks.slice(0, 500))
        );
      }
      if (mergeData.preferred_studios && typeof mergeData.preferred_studios === "object") {
        localStorage.setItem(
          profileStorageKeyFor(PREFERRED_STUDIOS_STORAGE_KEY, activeProf),
          JSON.stringify(mergeData.preferred_studios)
        );
      }
      invalidateLocalCaches();
    } catch (err) { window.logDebug?.("Settings", err); }

    if (statusEl) {
      const countHist = mergeData.merged_history || 0;
      const countBm = mergeData.merged_bookmarks || 0;
      statusEl.textContent = t(
        `Синхронизировано: ${countHist} просмотров, ${countBm} закладок`,
        `Synchronized: ${countHist} history, ${countBm} bookmarks`
      );
    }

    if (peersCont && peersList) {
      if (peers.length > 0) {
        peersCont.classList.remove("hidden");
        peersList.innerHTML = peers.map(p => `
          <div class="atv-lan-sync-peer-item">
            <span class="atv-lan-sync-peer-name">${escapeHtml(p.name || p.device || "Velarium Device")}</span>
            <span class="atv-lan-sync-peer-ip">${escapeHtml(p.ip || "")}</span>
          </div>
        `).join("");
      } else {
        peersCont.classList.add("hidden");
      }
    }

    showToast(t("Синхронизация с домашними устройствами завершена", "LAN device sync completed"));
  } catch (err) {
    if (statusEl) statusEl.textContent = t("Ошибка синхронизации", "Sync error");
    showToast(t("Не удалось завершить синхронизацию", "Could not complete sync"));
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function toggleLanAccess(enabled) {
  try {
    const res = await fetch("/api/system/lan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: Boolean(enabled), ..._adminPinPayload() }),
    });
    const data = await res.json();
    if (!res.ok) {
      renderSystemStatusUI();
      showToast(data?.error || t("Управляется только на основном компьютере", "Managed only on the host computer"));
      return;
    }
    if (data?.system) {
      state.systemStatus = data.system;
      state.tvLanEnabled = Boolean(data.system.lan_enabled);
      renderSystemStatusUI();
    }
    showToast(
      enabled
        ? t(
            `Доступ в домашней сети включён${data?.system?.lan_url ? `: ${data.system.lan_url}` : ""}`,
            `Home Wi-Fi access enabled${data?.system?.lan_url ? `: ${data.system.lan_url}` : ""}`
          )
        : t("Доступ ограничен только этим компьютером (127.0.0.1)", "Access restricted to this computer (127.0.0.1)")
    );
  } catch (_) {
    showToast(t("Не удалось переключить режим домашней сети", "Failed to toggle home network mode"));
    renderSystemStatusUI();
  }
}

export async function toggleMacosAutostart(enabled) {
  const isWinHost = Boolean(state.systemStatus?.is_windows);
  try {
    const res = await fetch("/api/system/autostart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: Boolean(enabled), ..._adminPinPayload() }),
    });
    const data = await res.json();
    if (!res.ok) {
      renderSystemStatusUI();
      showToast(data?.error || t("Управляется только на основном компьютере", "Managed only on the host computer"));
      return;
    }
    if (data?.system) {
      state.systemStatus = data.system;
      state.tvLanEnabled = Boolean(data.system.lan_enabled);
      renderSystemStatusUI();
    }
    const osLabel = isWinHost ? "Windows" : "macOS";
    showToast(
      enabled
        ? t(`Автозапуск Velarium при входе в ${osLabel} включён`, `Velarium ${osLabel} login autostart enabled`)
        : t(`Автозапуск Velarium при входе в ${osLabel} отключён`, `Velarium ${osLabel} login autostart disabled`)
    );
  } catch (_) {
    showToast(t("Не удалось обновить настройку автозапуска", "Failed to update login autostart setting"));
    renderSystemStatusUI();
  }
}
let _settingsLoadAbort = null;

export async function openSettingsModal(initialTab = "integrations", focusKinoriumInput = false) {
  const settingsModEl = document.getElementById("settings-modal");
  const wasHidden = Boolean(settingsModEl && settingsModEl.classList.contains("hidden"));
  if (wasHidden && state.activeProfile?.kids_mode && state.activeProfile?.has_kids_pin) {
    const pin = await ensureKidsPinVerifiedForAdminAction(
      t(
        "Введите 4-значный PIN-код для доступа к настройкам из детского профиля",
        "Enter the 4-digit PIN to open Settings from Kids Mode"
      )
    );
    if (!pin) return;
  }
  if (wasHidden) {
    rememberModalTriggerFocus("settings-modal");
  }
  if (focusKinoriumInput) {
    state.kinoriumFormExpanded = true;
  }
  syncLanguageSegmentedControlUI();
  renderSettingsCountryUI();
  renderIntegrationsList();
  renderStremioAddonsList();
  switchSettingsTab(initialTab);
  syncSettingsFooterUI();
  document.getElementById("settings-modal")?.classList.remove("hidden");
  syncScrollTopButton();

  if (_settingsLoadAbort) {
    try {
      _settingsLoadAbort.abort();
    } catch (_) {}
  }
  const settingsAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
  _settingsLoadAbort = settingsAbort;
  const reqProfileId = state.activeProfileId || "main";
  let res;
  try {
    res = await fetch(
      `/api/settings?lang=${encodeURIComponent(state.appLang || "ru")}`,
      settingsAbort ? { signal: settingsAbort.signal } : undefined
    );
  } catch (err) {
    if (err && err.name === "AbortError") return;
    res = { ok: false };
  }
  if ((settingsAbort && settingsAbort.signal.aborted) || (state.activeProfileId || "main") !== reqProfileId) return;
  const cfg = res.ok ? await res.json().catch(() => ({})) : {};
  if ((state.activeProfileId || "main") !== reqProfileId) return;
  if (cfg.integrations) {
    state.integrations = cfg.integrations;
  }
  if (Array.isArray(cfg.stremio_addons)) {
    state.stremioAddons = cfg.stremio_addons;
  }
  if (cfg.kinorium) {
    const kUid = cfg.kinorium.user_id || "";
    let kDisp = cfg.kinorium.display_name || cfg.kinorium.username || "";
    if (kUid === "51670" && (!kDisp || kDisp.startsWith("user_"))) {
      kDisp = "Andrei Crustillio";
    }
    state.kinoriumAccount = {
      user_id: kUid,
      display_name: kDisp,
      avatar_url: cfg.kinorium.avatar_url || "",
      profile_url: cfg.kinorium.profile_url || "",
      connected: Boolean((cfg.kinorium.logged_in ?? cfg.kinorium.connected) && cfg.kinorium.user_id),
      has_session_cookie: Boolean(cfg.kinorium.has_session_cookie || cfg.kinorium.session_cookie),
      cw_dismissed_count: Number(cfg.kinorium.cw_dismissed_count || 0),
    };
    updateKinoriumUserBadge();
    renderHeaderProfileSwitcher();
  }
  if (cfg.user_country) {
    state.userCountry = String(cfg.user_country);
  }
  if (cfg.country_profile) {
    state.countryProfile = cfg.country_profile;
  }
  if (Array.isArray(cfg.eu_countries) && cfg.eu_countries.length > 0) {
    state.euCountries = cfg.eu_countries;
  }
  if (typeof cfg.setup_completed === "boolean") {
    state.setupCompleted = cfg.setup_completed;
  }
  const spoofRegionEl = document.getElementById("cfg-spoof-region");
  if (spoofRegionEl) spoofRegionEl.value = cfg.hdrezka?.spoof_region || "KZ";
  const customMirrorEl = document.getElementById("cfg-custom-mirror");
  if (customMirrorEl) customMirrorEl.value = cfg.hdrezka?.custom_mirror || "";
  const proxyUrlEl = document.getElementById("cfg-proxy-url");
  if (proxyUrlEl) proxyUrlEl.value = cfg.hdrezka?.proxy_url || "";
  const cfWorkerEl = document.getElementById("cfg-cf-worker");
  if (cfWorkerEl) cfWorkerEl.value = cfg.hdrezka?.cf_worker_relay || "";
  const rawMode = cfg.backup_stream?.mode || "torrserver";
  const normMode =
    rawMode === "debrid_https"
      ? cfg.backup_stream?.debrid_configured
        ? "realdebrid"
        : "torrserver"
      : rawMode;
  const backupModeEl = document.getElementById("cfg-backup-mode");
  if (backupModeEl) backupModeEl.value = normMode;
  const torrUrlVal = cfg.backup_stream?.torrserver_url || "http://127.0.0.1:8090";
  const torrUrlEl = document.getElementById("cfg-torrserver-url");
  if (torrUrlEl) torrUrlEl.value = torrUrlVal;
  const detRezka = document.getElementById("details-net-hdrezka");
  if (detRezka) {
    detRezka.open = Boolean(
      (cfg.hdrezka?.custom_mirror || "").trim() ||
        (cfg.hdrezka?.proxy_url || "").trim() ||
        (cfg.hdrezka?.cf_worker_relay || "").trim()
    );
  }
  const det4k = document.getElementById("details-net-4k");
  if (det4k) {
    det4k.open = Boolean(
      normMode !== "torrserver" || (torrUrlVal.trim() && torrUrlVal.trim() !== "http://127.0.0.1:8090")
    );
  }
  const debridInp = document.getElementById("cfg-debrid-key");
  if (debridInp) {
    debridInp.value = "";
    debridInp.placeholder = cfg.backup_stream?.debrid_configured
      ? t("Ключ сохранён (вставьте новый для замены)", "Key saved (paste new to replace)")
      : t("Не требуется для TorrServer", "Not needed for TorrServer");
  }
  state.settingsBaseline = getNetworkSettingsSnapshot();
  state.torrserverConnected = Boolean(cfg.backup_stream?.torrserver_connected);
  state.remuxAvailable = Boolean(cfg.backup_stream?.remux_available);
  state.hwAccelSummary = cfg.backup_stream?.hw_accel?.active ? String(cfg.backup_stream.hw_accel.summary || "") : "";
  if (cfg.system) {
    state.systemStatus = cfg.system;
  }
  renderTorrserverStatusText();
  renderSystemStatusUI();

  if (focusKinoriumInput) {
    state.kinoriumFormExpanded = true;
  }
  syncLanguageSegmentedControlUI();
  renderSettingsCountryUI();
  renderIntegrationsList();
  renderStremioAddonsList();
  syncSettingsFooterUI();

  if (focusKinoriumInput) {
    setTimeout(() => {
      const inp = document.getElementById("kin-quick-user-input");
      if (inp) {
        inp.focus();
        inp.select();
      }
    }, 80);
  } else if (wasHidden) {
    requestAnimationFrame(() => {
      document.getElementById("close-settings-modal")?.focus({ preventScroll: true });
    });
  }
}

export function renderStremioAddonsList() {
  const listEl = document.getElementById("stremio-addons-list");
  if (!listEl) return;
  const addons = Array.isArray(state.stremioAddons) ? state.stremioAddons : [];
  const addonsSig = `${state.appLang || "ru"}|${Boolean(state.systemStatus?.is_local_client)}|${addons.map((a) => `${a?.id}:${a?.enabled !== false ? 1 : 0}:${a?.name || ""}`).join("||")}`;
  if (listEl._addonsSig === addonsSig && listEl.childElementCount > 0) {
    return;
  }
  listEl._addonsSig = addonsSig;
  listEl.innerHTML = "";
  if (addons.length === 0) {
    listEl.innerHTML = `<div class="atv-stremio-empty-addons">${t("Нет установленных аддонов", "No addons installed")}</div>`;
    return;
  }
  const addonsFrag = document.createDocumentFragment();
  const isLocalHost = state.systemStatus?.is_local_client !== false;
  const resMap = {
    stream: t("Потоки", "Streams"),
    subtitles: t("Субтитры", "Subtitles"),
    catalog: t("Каталог", "Catalog"),
    meta: t("Метаданные", "Metadata"),
  };
  addons.forEach((addon) => {
    if (!addon || !addon.id) return;
    const isEnabled = addon.enabled !== false;
    const resourcesText = (addon.resources || [])
      .map((r) => resMap[r] || r)
      .filter(Boolean)
      .join(" · ");
    const addonDesc = displayAddonDescription(addon);
    const subParts = [resourcesText, addonDesc].filter(Boolean);
    const row = document.createElement("div");
    row.className = `atv-stremio-addon-row${isEnabled ? "" : " is-disabled"}`;
    row.innerHTML = `
      <div class="atv-stremio-addon-info">
        <div class="atv-stremio-addon-title">
          <span>${escapeHtml(addon.name || addon.id)}</span>
        </div>
        <div class="atv-stremio-addon-sub" title="${escapeAttr(addon.manifest_url || "")}">
          ${escapeHtml(subParts.join(" · "))}
        </div>
      </div>
      <div class="atv-stremio-addon-actions">
        ${
          !addon.builtin && isLocalHost
            ? `<button type="button" class="atv-btn-secondary atv-btn-xs atv-btn-danger-text btn-remove-stremio-addon" title="${escapeAttr(t("Удалить аддон", "Remove addon"))}">${t("Удалить", "Remove")}</button>`
            : ""
        }
        <label class="srv-toggle-wrap" title="${escapeAttr(isEnabled ? t("Отключить аддон", "Disable addon") : t("Включить аддон", "Enable addon"))}">
          <span class="srv-toggle">
            <input type="checkbox" role="switch" class="stremio-addon-toggle" aria-label="${escapeAttr(addon.name || addon.id || t("Аддон Stremio", "Stremio addon"))}" ${isEnabled ? "checked" : ""} />
            <span class="srv-toggle-slider"></span>
          </span>
        </label>
      </div>
    `;
    const toggleInp = row.querySelector(".stremio-addon-toggle");
    if (toggleInp) {
      toggleInp.onchange = async (e) => {
        const nextVal = Boolean(e.target.checked);
        try {
          const res = await fetch("/api/stremio/addons", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "toggle",
              id: addon.id,
              enabled: nextVal,
              lang: state.appLang || "ru",
              ..._adminPinPayload(),
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            renderStremioAddonsList();
            showToast(data?.error || t("Не удалось изменить статус аддона", "Failed to toggle addon"));
            return;
          }
          if (Array.isArray(data.addons)) {
            state.stremioAddons = data.addons;
            renderStremioAddonsList();
            renderIntegrationsList();
            if (state.isPlayerOpen && state.activeSourceTab === "stremio") {
              loadStremioStreams(0);
            }
          }
          showToast(
            nextVal
              ? t(`Аддон «${addon.name}» включён`, `Addon "${addon.name}" enabled`)
              : t(`Аддон «${addon.name}» отключён`, `Addon "${addon.name}" disabled`)
          );
        } catch (_) {
          showToast(t("Не удалось изменить статус аддона", "Failed to toggle addon"));
        }
      };
    }
    const removeBtn = row.querySelector(".btn-remove-stremio-addon");
    if (removeBtn) {
      removeBtn.onclick = async () => {
        const confirmed = await showConfirmModal({
          title: t(`Удалить аддон «${addon.name}»?`, `Remove addon "${addon.name}"?`),
          message: t(
            "Потоки и субтитры этого аддона больше не будут отображаться во вкладке Stremio.",
            "Streams and subtitles from this addon will no longer appear in the Stremio tab."
          ),
          confirmLabel: t("Удалить", "Remove"),
          cancelLabel: t("Отмена", "Cancel"),
          danger: true,
        });
        if (!confirmed) return;
        removeBtn.disabled = true;
        try {
          const res = await fetch("/api/stremio/addons", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "remove",
              id: addon.id,
              lang: state.appLang || "ru",
              ..._adminPinPayload(),
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            removeBtn.disabled = false;
            showToast(data?.error || t("Не удалось удалить аддон", "Failed to remove addon"));
            return;
          }
          if (Array.isArray(data.addons)) {
            state.stremioAddons = data.addons;
            renderStremioAddonsList();
            renderIntegrationsList();
            if (state.isPlayerOpen && state.activeSourceTab === "stremio") {
              loadStremioStreams(0);
            }
          }
          showToast(t(`Аддон «${addon.name}» удалён`, `Addon "${addon.name}" removed`));
        } catch (_) {
          removeBtn.disabled = false;
          showToast(t("Не удалось удалить аддон", "Failed to remove addon"));
        }
      };
    }
    addonsFrag.appendChild(row);
  });
  listEl.appendChild(addonsFrag);
}

export async function addStremioAddonFromInput() {
  const inp = document.getElementById("cfg-stremio-manifest-input");
  const btn = document.getElementById("btn-add-stremio-addon");
  if (!inp || !btn) return;
  const rawUrl = (inp.value || "").trim();
  if (!rawUrl) {
    showToast(t("Вставьте ссылку на manifest.json или stremio:// аддона", "Paste a manifest.json or stremio:// addon URL"));
    inp.focus();
    return;
  }
  const prevText = btn.textContent;
  btn.textContent = t("Проверка...", "Checking...");
  btn.disabled = true;
  try {
    const res = await fetch("/api/stremio/addons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        manifest_url: rawUrl,
        lang: state.appLang || "ru",
        ..._adminPinPayload(),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showToast(data.error || t("Не удалось подключить аддон Stremio", "Failed to add Stremio addon"));
      return;
    }
    inp.value = "";
    if (Array.isArray(data.addons)) {
      state.stremioAddons = data.addons;
      renderStremioAddonsList();
      renderIntegrationsList();
      if (state.isPlayerOpen && state.activeSourceTab === "stremio") {
        loadStremioStreams(0);
      }
    }
    showToast(t(`Аддон подключён: ${data.addon?.name || "Stremio"}`, `Addon installed: ${data.addon?.name || "Stremio"}`));
  } catch (_) {
    showToast(t("Ошибка сети при подключении аддона Stremio", "Network error installing Stremio addon"));
  } finally {
    btn.textContent = prevText;
    btn.disabled = false;
  }
}
export function switchSettingsTab(stab) {
  const target = ["integrations", "network", "backup", "about"].includes(stab) ? stab : "integrations";
  state.activeSettingsTab = target;
  document.querySelectorAll("#settings-tabs .settings-tab").forEach((b) => {
    const isSelected = b.dataset.stab === target;
    b.classList.toggle("active", isSelected);
    b.setAttribute("aria-selected", isSelected ? "true" : "false");
    b.tabIndex = isSelected ? 0 : -1;
  });
  document.getElementById("stab-integrations")?.classList.toggle("hidden", target !== "integrations");
  document.getElementById("stab-network")?.classList.toggle("hidden", target !== "network");
  document.getElementById("stab-backup")?.classList.toggle("hidden", target !== "backup");
  document.getElementById("stab-about")?.classList.toggle("hidden", target !== "about");
  if (target === "backup") {
    updateBackupSummaryStat();
  } else if (target === "about") {
    renderAppUpdaterUI();
  }
  syncSettingsFooterUI();
}

export async function requestCloseSettingsModal() {
  const settingsModEl = document.getElementById("settings-modal");
  if (!settingsModEl || settingsModEl.classList.contains("hidden")) return true;
  if (isNetworkSettingsDirty()) {
    const discard = await showConfirmModal({
      title: t("Несохранённые изменения", "Unsaved changes"),
      message: t(
        "Вы изменили настройки, но ещё не нажали «Сохранить изменения». Закрыть без сохранения?",
        "You have unsaved settings changes. Close without saving?"
      ),
      confirmLabel: t("Закрыть без сохранения", "Discard & Close"),
      cancelLabel: t("Остаться", "Keep Editing"),
      danger: true,
    });
    if (!discard) return false;
    resetUnsavedSettingsInputs();
  }
  if (_settingsLoadAbort) {
    try {
      _settingsLoadAbort.abort();
    } catch (_) {}
    _settingsLoadAbort = null;
  }
  closeCustomSelectMenu({ restoreFocus: false });
  settingsModEl.classList.add("hidden");
  state.verifiedKidsAdminPin = "";
  syncScrollTopButton();
  restoreModalTriggerFocus("settings-modal");
  return true;
}

export function initSettingsAndBackupBindings() {
  document.getElementById("btn-open-stremio-addons")?.addEventListener("click", async () => {
    await openSettingsModal("network");
    setTimeout(() => {
      document.getElementById("net-group-stremio")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("cfg-stremio-manifest-input")?.focus();
    }, 60);
  });

  document.getElementById("btn-add-stremio-addon")?.addEventListener("click", () => {
    addStremioAddonFromInput();
  });
  document.getElementById("cfg-stremio-manifest-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addStremioAddonFromInput();
    }
  });

  document.getElementById("cfg-lan-toggle")?.addEventListener("change", (e) => {
    toggleLanAccess(Boolean(e.target.checked));
  });
  document.getElementById("cfg-autostart-toggle")?.addEventListener("change", (e) => {
    toggleMacosAutostart(Boolean(e.target.checked));
  });
  document.getElementById("about-update-check-btn")?.addEventListener("click", () => {
    checkAppUpdates({ force: true, silent: false });
  });
  document.getElementById("about-update-action-btn")?.addEventListener("click", () => {
    startAppUpdateDownload();
  });
  document.getElementById("cfg-auto-check-updates")?.addEventListener("change", () => {
    saveUpdaterSettingsImmediate();
  });
  ["cfg-update-repo", "cfg-update-manifest-url"].forEach((id) => {
    const inp = document.getElementById(id);
    if (!inp) return;
    inp.addEventListener("change", () => {
      saveUpdaterSettingsImmediate();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        checkAppUpdates({ force: true, silent: false });
      }
    });
  });
  document.getElementById("btn-copy-lan-url")?.addEventListener("click", async () => {
    const urlText = state.systemStatus?.lan_url || document.getElementById("lan-url-code")?.textContent || "";
    if (!urlText) return;
    const copied = await copyTextToClipboard(urlText);
    if (copied) {
      showToast(t(`Адрес скопирован: ${urlText}`, `Copied URL: ${urlText}`));
    }
  });

  document.getElementById("btn-sync-lan-now")?.addEventListener("click", async () => {
    await triggerLanSync();
  });

  const openSettingsBtn = document.getElementById("open-settings-btn");
  if (openSettingsBtn) {
    openSettingsBtn.onclick = () => openSettingsModal("integrations");
  }
  const closeSettingsBtn = document.getElementById("close-settings-modal");
  if (closeSettingsBtn) {
    closeSettingsBtn.onclick = () => {
      requestCloseSettingsModal();
    };
  }
  document.getElementById("settings-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "settings-modal") {
      requestCloseSettingsModal();
    }
  });
  document.getElementById("settings-country-select")?.addEventListener("change", (e) => {
    changeUserCountryInstant(e.target.value);
  });
  document.getElementById("btn-open-onboarding-wizard")?.addEventListener("click", () => {
    openOnboardingModal({ isFirstRun: false });
  });
  document.getElementById("close-onboarding-modal")?.addEventListener("click", () => {
    closeOnboardingModal({ reopenSettings: true });
  });
  document.getElementById("btn-onboarding-skip")?.addEventListener("click", () => {
    skipOnboardingModal();
  });
  document.getElementById("btn-onboarding-back")?.addEventListener("click", () => {
    setOnboardingStep((state.onboardingStep || 1) - 1);
  });
  document.getElementById("btn-onboarding-next")?.addEventListener("click", () => {
    setOnboardingStep((state.onboardingStep || 1) + 1);
  });
  document.querySelectorAll("#ob-stepper [data-ob-step-btn]").forEach((stepBtn) => {
    stepBtn.addEventListener("click", () => {
      setOnboardingStep(Number(stepBtn.dataset.obStepBtn) || 1);
    });
  });
  document.getElementById("btn-onboarding-finish")?.addEventListener("click", () => {
    submitOnboardingModal();
  });
  document.getElementById("onboarding-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "onboarding-modal" && !state.onboardingIsFirstRun) {
      closeOnboardingModal({ reopenSettings: true });
    }
  });
  document.getElementById("reset-settings-btn")?.addEventListener("click", () => {
    resetUnsavedSettingsInputs();
    showToast(t("Изменения сброшены", "Unsaved changes reset"));
  });

  [
    "cfg-spoof-region",
    "cfg-custom-mirror",
    "cfg-proxy-url",
    "cfg-cf-worker",
    "cfg-backup-mode",
    "cfg-torrserver-url",
    "cfg-debrid-key",
  ].forEach((fieldId) => {
    const fieldEl = document.getElementById(fieldId);
    if (!fieldEl) return;
    fieldEl.addEventListener("input", () => syncSettingsFooterUI());
    fieldEl.addEventListener("change", () => {
      if (fieldId === "cfg-backup-mode" && (fieldEl.value === "realdebrid" || fieldEl.value === "torbox")) {
        const details4k = document.getElementById("details-net-4k");
        if (details4k) details4k.open = true;
      }
      syncSettingsFooterUI();
    });
  });

  const saveSettingsBtn = document.getElementById("save-settings-btn");
  if (saveSettingsBtn) {
    saveSettingsBtn.onclick = async () => {
      if (!isNetworkSettingsDirty()) {
        closeCustomSelectMenu({ restoreFocus: false });
        document.getElementById("settings-modal")?.classList.add("hidden");
        state.verifiedKidsAdminPin = "";
        syncScrollTopButton();
        restoreModalTriggerFocus("settings-modal");
        return;
      }
      const adminPinFields = state.verifiedKidsAdminPin
        ? { pin: state.verifiedKidsAdminPin, current_pin: state.verifiedKidsAdminPin }
        : {};
      const kinDirty = isKinoriumQuickFormDirty();
      const spoofRegion = document.getElementById("cfg-spoof-region").value;
      const kinQuickUser = (document.getElementById("kin-quick-user-input")?.value || "").trim();
      const kinQuickCookie = (document.getElementById("kin-quick-cookie-input")?.value || "").trim();
      const debridKeyVal = (document.getElementById("cfg-debrid-key")?.value || "").trim();
      const payload = {
        ...adminPinFields,
        hdrezka: {
          spoof_region: spoofRegion,
          custom_mirror: document.getElementById("cfg-custom-mirror").value,
          proxy_url: document.getElementById("cfg-proxy-url").value,
          cf_worker_relay: document.getElementById("cfg-cf-worker")?.value || "",
        },
        backup_stream: {
          mode: document.getElementById("cfg-backup-mode").value,
          torrserver_url: document.getElementById("cfg-torrserver-url").value,
          ...(debridKeyVal ? { debrid_api_key: debridKeyVal } : {}),
        },
      };
      if (isServiceEnabled("kinorium") && (kinQuickUser || kinQuickCookie)) {
        payload.kinorium = {
          username: kinQuickUser,
          session_cookie: kinQuickCookie,
          auto_scrobble_threshold: 0.95,
        };
      }
      let res;
      let data = {};
      try {
        res = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        data = await res.json().catch(() => ({}));
      } catch (_) {
        showToast(t("Не удалось сохранить настройки", "Failed to save settings"));
        return;
      }
      if (!res.ok || data?.ok === false || data?.error) {
        showToast(data?.error || t("Не удалось сохранить настройки", "Failed to save settings"));
        return;
      }
      if (data.integrations) state.integrations = data.integrations;
      const effKinUser = kinQuickUser || state.kinoriumAccount?.user_id || "";
      if (kinDirty && isServiceEnabled("kinorium") && (effKinUser || kinQuickCookie)) {
        try {
          const syncPayload = { ...adminPinFields };
          if (effKinUser) syncPayload.user_id = effKinUser;
          if (kinQuickCookie) syncPayload.session_cookie = kinQuickCookie;
          const syncRes = await fetch("/api/kinorium/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(syncPayload),
          });
          const syncData = await syncRes.json();
          if (!syncRes.ok || syncData?.ok === false || syncData?.error) {
            showToast(
              syncData?.error ||
                syncData?.sync?.error ||
                t("Ошибка синхронизации Kinorium", "Kinorium sync error")
            );
          } else {
            if (syncData.kinorium_account) {
              state.kinoriumAccount = syncData.kinorium_account;
              updateKinoriumUserBadge();
              renderHeaderProfileSwitcher();
            }
            if (syncData.integrations) state.integrations = syncData.integrations;
            if (!syncData.sync?.error) {
              state.kinoriumFormExpanded = false;
            }
          }
        } catch (err) {
          window.logDebug?.("Settings", err);
        }
      }
      const keyInput = document.getElementById("cfg-debrid-key");
      if (keyInput && debridKeyVal) {
        keyInput.value = "";
        keyInput.placeholder = t(
          "Ключ сохранён (оставьте пустым или введите новый)",
          "API key saved (leave blank or enter a new key)"
        );
      }
      state.settingsBaseline = getNetworkSettingsSnapshot();
      syncSettingsFooterUI();
      closeCustomSelectMenu({ restoreFocus: false });
      document.getElementById("settings-modal")?.classList.add("hidden");
      state.verifiedKidsAdminPin = "";
      syncScrollTopButton();
      restoreModalTriggerFocus("settings-modal");
      applyEnabledServicesVisibility();
      renderLoginBannerIfNeeded();
      clearCatalogFrontendCache();
      loadCatalog();
      showToast(t("Настройки сохранены", "Settings saved"));
    };
  }

  const quickExportBackupBtn = document.getElementById("btn-quick-export-backup");
  if (quickExportBackupBtn) {
    quickExportBackupBtn.onclick = () => handleExportBackup(quickExportBackupBtn);
  }

  const copyBackupClipboardBtn = document.getElementById("btn-copy-backup-clipboard");
  if (copyBackupClipboardBtn) {
    copyBackupClipboardBtn.onclick = async () => {
      copyBackupClipboardBtn.disabled = true;
      try {
        const payload = await buildFullBackupPayload();
        if (!payload) return;
        const jsonStr = JSON.stringify(payload, null, 2);
        const copied = await copyTextToClipboard(jsonStr);
        if (copied) {
          showToast(t("Резервная копия скопирована в буфер обмена", "Backup copied to clipboard"));
        } else {
          showToast(
            t(
              "Не удалось скопировать в буфер — используйте «Скачать Backup (.json)»",
              'Could not copy to clipboard — use "Download Backup (.json)"'
            )
          );
        }
      } catch (_) {
        showToast(
          t(
            "Не удалось скопировать в буфер — используйте «Скачать Backup (.json)»",
            'Could not copy to clipboard — use "Download Backup (.json)"'
          )
        );
      } finally {
        copyBackupClipboardBtn.disabled = false;
      }
    };
  }

  const pasteBackupClipboardBtn = document.getElementById("btn-paste-backup-clipboard");
  if (pasteBackupClipboardBtn) {
    pasteBackupClipboardBtn.onclick = async () => {
      if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
        openManualBackupPasteBox();
        return;
      }
      pasteBackupClipboardBtn.disabled = true;
      try {
        const rawText = await navigator.clipboard.readText();
        if (!rawText || !rawText.trim()) {
          openManualBackupPasteBox();
          return;
        }
        const parsed = JSON.parse(rawText);
        await restoreFromBackupObject(parsed);
      } catch (err) {
        if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
          openManualBackupPasteBox();
        } else {
          showToast(
            t(
              "В буфере обмена нет корректного JSON резервной копии Velarium",
              "Clipboard does not contain a valid Velarium backup JSON"
            )
          );
        }
      } finally {
        pasteBackupClipboardBtn.disabled = false;
      }
    };
  }

  const quickImportBackupBtn = document.getElementById("btn-quick-import-backup");
  const importBackupInput = document.getElementById("input-import-backup");
  if (importBackupInput) {
    if (quickImportBackupBtn) {
      quickImportBackupBtn.onclick = () => importBackupInput.click();
    }
    importBackupInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (quickImportBackupBtn) quickImportBackupBtn.disabled = true;
      try {
        const rawText = await file.text();
        const parsed = JSON.parse(rawText);
        await restoreFromBackupObject(parsed);
      } catch (err) {
        console.error("Import backup error:", err);
        showToast(t("Не удалось прочитать JSON-файл резервной копии", "Failed to read backup JSON file"));
      } finally {
        if (quickImportBackupBtn) quickImportBackupBtn.disabled = false;
        importBackupInput.value = "";
      }
    };
  }
}
