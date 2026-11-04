import {
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
} from "./state.js?v=20261104v27";
import {
  applyStaticDomTranslations,
  displayAddonDescription,
  isEn,
  syncLanguageSegmentedControlUI,
  t,
} from "./i18n.js?v=20261104v27";
import {
  closeCustomSelectMenu,
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
} from "./utils.js?v=20261104v27";
import { applyEnabledServicesVisibility } from "./catalog-media-resolver.js?v=20261104v27";
import {
  renderCatalogShelves,
  renderContinueWatching,
} from "./catalog-shelves.js?v=20261104v27";
import { renderHero } from "./catalog-hero.js?v=20261104v27";
import { renderNotificationsBell } from "./catalog-notifications.js?v=20261104v27";
import {
  updateActiveFiltersBadge,
  updateDynamicCatalogFilters,
} from "./catalog-filters.js?v=20261104v27";
import {
  loadCatalog,
  renderLoginBannerIfNeeded,
  updateFriendsFilterDropdown,
  updateKinoriumUserBadge,
} from "./catalog.js?v=20261104v27";
import { openQuickPeekModal, openStatsModal, refreshOpenPersonModalUI, syncModalBackButtons } from "./modals.js?v=20261104v27";
import { loadStremioStreams } from "./player-streams.js?v=20261104v27";
import { renderModalProvidersSidebar } from "./player-meta.js?v=20261104v27";
import {
  refreshOpenPlayerLanguageUI,
  syncPlayerOfflineControlsUI,
} from "./player.js?v=20261104v27";
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
} from "./features.js?v=20261104v27";
import {
  loadAndRenderRemotePairingPanel,
  pushDesktopRemoteStateNow,
  syncDesktopConnectedRemotesUI,
} from "./remote.js?v=20261104v27";

function _adminPinPayload() {
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
  renderCatalogShelves();
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
    window.webkit?.messageHandlers?.cineflowNative?.postMessage({
      action: "appLangChanged",
      lang: norm,
    });
  } catch (_) {}

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

  const loginUrl = customUrl || integ.login_url;
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
      await loadCatalog();
      showToast(
        isEnabled
          ? t(`Сервис «${srvName}» включен`, `Service "${srvName}" enabled`)
          : t(`Сервис «${srvName}» отключен и скрыт во всём приложении`, `Service "${srvName}" disabled and hidden`)
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
  listEl.innerHTML = "";

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
  let renderedKinoriumGroup = false;
  let renderedVideoGroup = false;

  order.forEach((key) => {
    const integ = state.integrations[key];
    if (!integ) return;

    if (key === "kinorium" && !renderedKinoriumGroup) {
      renderedKinoriumGroup = true;
      const groupHead = document.createElement("div");
      groupHead.className = "integrations-group-label";
      groupHead.textContent = t("Профиль", "Profile");
      listEl.appendChild(groupHead);
    } else if (key !== "kinorium" && !renderedVideoGroup) {
      renderedVideoGroup = true;
      const groupHead = document.createElement("div");
      groupHead.className = "integrations-group-label";
      groupHead.textContent = t("Источники видео", "Video Sources");
      listEl.appendChild(groupHead);
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
      const profileUrl =
        acc.profile_url ||
        (acc.user_id ? `https://en.kinorium.com/user/${acc.user_id}/` : "https://en.kinorium.com/");
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
        : t("Профиль не подключен", "Profile not connected");

      row.innerHTML = `
        <div class="kin-card-top">
          <div class="integration-info">
            <div class="integration-name"><span>Kinorium</span></div>
            <div class="integration-status" title="${isConnected ? escapeAttr(profileUrl) : ""}">
              ${kinStatusText}
            </div>
          </div>
          <div class="integration-actions">
            <button type="button" class="atv-btn-secondary atv-btn-xs btn-open-profiles-from-kin">${t("Домашние профили", "Profiles")}</button>
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
            : `
        <div class="kin-switcher-box">
          <div class="kin-switcher-row">
            <input
              type="text"
              class="kin-switcher-input"
              id="kin-quick-user-input"
              value="${escapeAttr(currentInputVal)}"
              placeholder="${t("ID или ссылка на профиль (например 51670)", "Profile ID or URL (e.g. 51670)")}"
            />
            <input
              type="password"
              class="kin-switcher-input"
              id="kin-quick-cookie-input"
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
          await loadCatalog();
          if (data.sync?.error) {
            showToast(`${t("Ошибка", "Error")}: ${data.sync.error}`);
          } else {
            const switchedNote = data.sync?.switched_user ? t("Профиль переключен! ", "Profile switched! ") : "";
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
              "Your Watching, Watchlist, Watched lists and saved cookies will be unlinked from CineFlow. You can reconnect your profile anytime."
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
            await loadCatalog();
            showToast(t("Профиль Kinorium отключен и очищен для нового пользователя", "Kinorium profile disconnected"));
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

    listEl.appendChild(row);
  });
}
export function updateBackupSummaryStat() {
  const el = document.getElementById("backup-summary-stat");
  if (!el) return;
  let studiosCount = 0;
  try {
    const raw = JSON.parse(localStorage.getItem(profileStorageKey(PREFERRED_STUDIOS_STORAGE_KEY)) || "{}") || {};
    studiosCount = Object.keys(raw).length;
  } catch (_) {}
  let histCount = getWatchHistoryList().length;
  if (histCount === 0 && Array.isArray(state.continueWatching) && state.continueWatching.length > 0) {
    try {
      if (localStorage.getItem(profileStorageKey(WATCH_HISTORY_STORAGE_KEY)) === null) {
        histCount = state.continueWatching.length;
      }
    } catch (_) {
      histCount = state.continueWatching.length;
    }
  }
  const c = state.kinoriumCounts || {};
  const dismissedCount = Number(state.kinoriumAccount?.cw_dismissed_count || 0);
  const parts = [
    `${t("Просмотрено", "Watched")}: ${c.watched || 0}`,
    `${t("Смотрю", "Watching")}: ${c.watching || 0}`,
    `${t("Буду смотреть", "Watchlist")}: ${c.watchlist || 0}`,
    `${t("История", "History")}: ${histCount}`,
  ];
  if (studiosCount > 0) {
    parts.push(`${t("Озвучек", "Audio choices")}: ${studiosCount}`);
  }
  const summaryText = parts.join(" · ");
  if (dismissedCount > 0) {
    el.innerHTML = `<span>${escapeHtml(summaryText)}</span> <button type="button" class="atv-btn-secondary atv-btn-xs atv-cw-restore-inline" id="btn-settings-restore-cw">${escapeHtml(
      t(
        `Вернуть скрытые (${dismissedCount})`,
        `Restore hidden (${dismissedCount})`
      )
    )}</button>`;
    const restoreBtn = document.getElementById("btn-settings-restore-cw");
    if (restoreBtn) {
      restoreBtn.onclick = async () => {
        restoreBtn.disabled = true;
        try {
          const res = await fetch("/api/kinorium/continue-watching/restore", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ restore_all: true }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data?.ok === false || data?.error) {
            restoreBtn.disabled = false;
            showToast(data?.error || t("Не удалось вернуть скрытые карточки", "Could not restore hidden items"));
            return;
          }
          if (state.kinoriumAccount && typeof data.cw_dismissed_count === "number") {
            state.kinoriumAccount.cw_dismissed_count = data.cw_dismissed_count;
          } else if (state.kinoriumAccount) {
            state.kinoriumAccount.cw_dismissed_count = 0;
          }
          await loadCatalog();
          updateBackupSummaryStat();
          showToast(t("Скрытые карточки возвращены", "Hidden items restored"));
        } catch (_) {
          restoreBtn.disabled = false;
        }
      };
    }
  } else {
    el.textContent = summaryText;
  }
}
function _readProfileLocalBundle(pid) {
  const safeParse = (k, fb) => {
    try {
      const raw = localStorage.getItem(profileStorageKeyFor(k, pid));
      return raw ? JSON.parse(raw) ?? fb : fb;
    } catch (_) {
      return fb;
    }
  };
  return {
    preferred_studios: safeParse(PREFERRED_STUDIOS_STORAGE_KEY, {}),
    player_prefs: safeParse(PLAYER_PREFS_STORAGE_KEY, {}),
    seen_notifications: safeParse(SEEN_NOTIFICATIONS_STORAGE_KEY, []),
    episode_progress: safeParse(EPISODE_PROGRESS_STORAGE_KEY, {}),
    watch_history: safeParse(WATCH_HISTORY_STORAGE_KEY, []),
    recent_searches: safeParse(RECENT_SEARCHES_STORAGE_KEY, []),
  };
}

function _writeProfileLocalBundle(pid, cs) {
  if (!cs || typeof cs !== "object") return;
  try {
    if (cs.preferred_studios && typeof cs.preferred_studios === "object") {
      localStorage.setItem(profileStorageKeyFor(PREFERRED_STUDIOS_STORAGE_KEY, pid), JSON.stringify(cs.preferred_studios));
    }
    if (cs.player_prefs && typeof cs.player_prefs === "object") {
      localStorage.setItem(profileStorageKeyFor(PLAYER_PREFS_STORAGE_KEY, pid), JSON.stringify(cs.player_prefs));
    }
    if (Array.isArray(cs.seen_notifications)) {
      localStorage.setItem(profileStorageKeyFor(SEEN_NOTIFICATIONS_STORAGE_KEY, pid), JSON.stringify(cs.seen_notifications));
    }
    if (cs.episode_progress && typeof cs.episode_progress === "object") {
      localStorage.setItem(profileStorageKeyFor(EPISODE_PROGRESS_STORAGE_KEY, pid), JSON.stringify(cs.episode_progress));
    }
    if (Array.isArray(cs.watch_history)) {
      localStorage.setItem(profileStorageKeyFor(WATCH_HISTORY_STORAGE_KEY, pid), JSON.stringify(cs.watch_history.slice(0, 150)));
    }
    if (Array.isArray(cs.recent_searches)) {
      localStorage.setItem(profileStorageKeyFor(RECENT_SEARCHES_STORAGE_KEY, pid), JSON.stringify(cs.recent_searches.slice(0, 8)));
    }
  } catch (_) {}
}

export async function buildFullBackupPayload() {
  let exportUrl = "/api/backup/export";
  if (state.activeProfile?.kids_mode && state.activeProfile?.has_kids_pin) {
    const pin = await ensureKidsPinVerifiedForAdminAction(
      t(
        "Введите 4-значный PIN-код для экспорта резервной копии",
        "Enter the 4-digit PIN to export backup"
      )
    );
    if (!pin) return null;
    exportUrl += `?pin=${encodeURIComponent(pin)}`;
  }
  const res = await fetch(exportUrl);
  const payload = await res.json();
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.error || "Export failed");
  }
  let uiPrefs = {};
  try {
    uiPrefs = JSON.parse(localStorage.getItem(UI_PREFS_STORAGE_KEY) || "{}") || {};
  } catch (_) {}

  const mainLocal = _readProfileLocalBundle("main");
  payload.client_storage = {
    ...mainLocal,
    ui_prefs: uiPrefs,
  };

  const knownPids = new Set(["main", "family", "kids"]);
  (state.profiles || []).forEach((p) => {
    if (p && p.id) knownPids.add(String(p.id));
  });
  (payload.profiles_bundle?.profiles || []).forEach((p) => {
    if (p && p.id) knownPids.add(String(p.id));
  });
  const profilesClientStorage = {};
  knownPids.forEach((pid) => {
    profilesClientStorage[pid] = _readProfileLocalBundle(pid);
  });
  payload.profiles_client_storage = profilesClientStorage;
  return payload;
}

export async function restoreFromBackupObject(parsed) {
  if (!parsed || typeof parsed !== "object") {
    showToast(t("Неверный формат резервной копии", "Invalid backup format"));
    return false;
  }
  let importBody = { ...parsed };
  if (state.verifiedKidsAdminPin && !importBody.current_pin) {
    importBody.current_pin = state.verifiedKidsAdminPin;
  }
  if (state.activeProfile?.kids_mode && state.activeProfile?.has_kids_pin && !importBody.current_pin) {
    const entered = await promptKidsPinModal({
      desc: t(
        "Введите 4-значный PIN-код для восстановления резервной копии",
        "Enter the 4-digit PIN to restore backup"
      ),
    });
    if (!entered) return false;
    importBody.current_pin = entered;
  }
  let res = await fetch("/api/backup/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(importBody),
  });
  let data = await res.json();
  if (res.status === 403 && data.pin_required && !importBody.current_pin) {
    const entered = await promptKidsPinModal({ desc: data.error || "" });
    if (!entered) return false;
    importBody.current_pin = entered;
    res = await fetch("/api/backup/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(importBody),
    });
    data = await res.json();
  }
  if (!res.ok || data.error) {
    showToast(`${t("Ошибка импорта", "Import error")}: ${data.error || t("Неверный формат файла", "Invalid file")}`);
    return false;
  }

  const hasMultiProfileLocal = Boolean(parsed.profiles_client_storage && typeof parsed.profiles_client_storage === "object");
  if (parsed.client_storage && typeof parsed.client_storage === "object") {
    const cs = parsed.client_storage;
    // Legacy backups store client_storage on active/main; v2.6 stores main in client_storage + all profiles in profiles_client_storage
    const legacyTargetPid = hasMultiProfileLocal ? "main" : state.activeProfileId || "main";
    _writeProfileLocalBundle(legacyTargetPid, cs);
    if (cs.ui_prefs && typeof cs.ui_prefs === "object") {
      try {
        localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(cs.ui_prefs));
      } catch (_) {}
      state.hideWatched = Boolean(cs.ui_prefs.hideWatched);
      document.getElementById("btn-hide-watched")?.classList.toggle("active", state.hideWatched);
      if (cs.ui_prefs.appLang === "en" || cs.ui_prefs.appLang === "ru") {
        applyAppLanguage(cs.ui_prefs.appLang, { persistServer: false, announce: false });
      }
      updateActiveFiltersBadge();
    }
  }
  if (hasMultiProfileLocal) {
    Object.entries(parsed.profiles_client_storage).forEach(([pid, profData]) => {
      _writeProfileLocalBundle(pid, profData);
    });
  }
  invalidateLocalCaches();
  if (parsed.app_lang === "en" || parsed.app_lang === "ru") {
    applyAppLanguage(parsed.app_lang, { persistServer: false, announce: false });
  }
  if (data.profiles) {
    applyProfilesPayload(data.profiles);
  }
  reloadProfileLocalPlayerPrefs();
  if (data.integrations) {
    state.integrations = data.integrations;
    applyEnabledServicesVisibility();
  }
  if (data.kinorium_account) {
    state.kinoriumAccount = data.kinorium_account;
    updateKinoriumUserBadge();
  }
  await loadCatalog();
  try {
    const aRes = await fetch(`/api/stremio/addons?lang=${encodeURIComponent(state.appLang || "ru")}`);
    const aJson = await aRes.json();
    if (Array.isArray(aJson.addons)) {
      state.stremioAddons = aJson.addons;
    }
  } catch (_) {}
  updateBackupSummaryStat();
  renderIntegrationsList();
  renderStremioAddonsList();
  showToast(
    t(
      `Резервная копия восстановлена (Оценок: ${data.restored?.ratings_count || 0}, Продолжить просмотр: ${
        data.restored?.continue_watching_count || 0
      })`,
      `Backup restored (Ratings: ${data.restored?.ratings_count || 0}, Continue Watching: ${
        data.restored?.continue_watching_count || 0
      })`
    )
  );
  return true;
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
    hintEl.textContent = t("Есть несохраненные изменения", "Unsaved changes");
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
        `TorrServer подключен${rAvail ? ` · ремукс активен${hwTag}` : ""}`,
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
      const stored = localStorage.getItem("cineflow_watch_progress") || localStorage.getItem("watch_history");
      if (stored) localHistory = JSON.parse(stored);
    } catch (_) {}

    let localBookmarks = [];
    try {
      const bms = localStorage.getItem("cineflow_moments") || localStorage.getItem("saved_moments");
      if (bms) localBookmarks = JSON.parse(bms);
    } catch (_) {}

    let peers = [];
    try {
      const pRes = await fetch("/api/sync/peers");
      if (pRes.ok) {
        const pJson = await pRes.json();
        peers = pJson.peers || [];
      }
    } catch (_) {}

    const mergeRes = await fetch("/api/sync/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile_id: activeProf,
        watch_history: Array.isArray(localHistory) ? localHistory : [],
        bookmarks: Array.isArray(localBookmarks) ? localBookmarks : [],
      }),
    });

    const mergeData = mergeRes.ok ? await mergeRes.json() : {};

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
            <span class="atv-lan-sync-peer-name">${escapeHtml(p.name || p.device || "CineFlow Device")}</span>
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

function _formatUpdaterBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return "0 MB";
  const mb = n / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

function _renderUpdateNotesMarkdown(rawMd) {
  const escaped = String(rawMd || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\r?\n/g, "<br>");
}

export function renderAppUpdaterUI(updaterObj = null) {
  if (updaterObj && typeof updaterObj === "object") {
    state.updaterStatus = updaterObj;
  }
  const sys = state.systemStatus || {};
  const upd = state.updaterStatus || sys.updater || {};
  const isAvailable = Boolean(upd.update_available && upd.latest_version);
  const rawState = String(upd.download_state || upd.state || "idle");
  const dlState = rawState === "downloaded" ? "ready" : rawState;
  const isChecking = Boolean(upd.checking || upd.state === "checking");
  const dlPath = String(upd.downloaded_path || upd.file_path || "");
  const dlProgress = Number(upd.download_progress ?? upd.progress_pct) || 0;
  const curVer = String(upd.current_version || state.appVersion || "");
  const latestVer = String(upd.latest_version || curVer);
  const isLocalHost = sys.is_local_client !== false;

  const dotEl = document.getElementById("settings-update-dot");
  if (dotEl) {
    dotEl.classList.toggle("hidden", !isAvailable);
  }
  const aboutTabBtn = document.getElementById("stab-btn-about");
  if (aboutTabBtn) {
    aboutTabBtn.classList.toggle("has-update-badge", isAvailable);
  }

  const autoCheckEl = document.getElementById("cfg-auto-check-updates");
  if (autoCheckEl && typeof sys.auto_check_updates === "boolean") {
    autoCheckEl.checked = sys.auto_check_updates;
    autoCheckEl.disabled = !isLocalHost;
  }
  const repoEl = document.getElementById("cfg-update-repo");
  if (repoEl && document.activeElement !== repoEl) {
    repoEl.value = String(sys.update_repo ?? upd.update_repo ?? "");
    repoEl.disabled = !isLocalHost;
  }
  const manifestEl = document.getElementById("cfg-update-manifest-url");
  if (manifestEl && document.activeElement !== manifestEl) {
    manifestEl.value = String(sys.update_manifest_url ?? upd.update_manifest_url ?? "");
    manifestEl.disabled = !isLocalHost;
  }

  const badgeEl = document.getElementById("about-update-badge");
  const sublineEl = document.getElementById("about-update-subline");
  const actionBtn = document.getElementById("about-update-action-btn");
  const checkBtn = document.getElementById("about-update-check-btn");
  const progWrap = document.getElementById("about-update-progress-wrap");
  const progFill = document.getElementById("about-update-progress-fill");
  const progText = document.getElementById("about-update-progress-text");
  const notesEl = document.getElementById("about-update-notes");

  if (checkBtn) {
    checkBtn.disabled = isChecking || dlState === "downloading" || !isLocalHost;
    checkBtn.textContent = isChecking
      ? t("Проверка...", "Checking...")
      : t("Проверить обновления", "Check for Updates");
  }

  if (badgeEl) {
    badgeEl.className = "atv-about-update-badge";
    if (dlState === "ready") {
      badgeEl.classList.add("is-ready");
      badgeEl.textContent = t(`Готово к установке v${latestVer}`, `Ready to install v${latestVer}`);
    } else if (isAvailable) {
      badgeEl.classList.add("is-available");
      badgeEl.textContent = t(`Доступна v${latestVer}`, `Update v${latestVer} available`);
    } else {
      badgeEl.textContent = `v${curVer}`;
    }
  }

  if (sublineEl) {
    if (isChecking) {
      sublineEl.textContent = t(
        "Связываемся с сервером релизов CineFlow...",
        "Checking CineFlow release feed..."
      );
    } else if (dlState === "downloading") {
      const dlBytes = _formatUpdaterBytes(upd.downloaded_bytes);
      const totBytes = upd.total_bytes > 0 ? ` / ${_formatUpdaterBytes(upd.total_bytes)}` : "";
      sublineEl.textContent = t(
        `Скачивание установщика CineFlow v${latestVer} (${dlBytes}${totBytes})...`,
        `Downloading CineFlow v${latestVer} installer (${dlBytes}${totBytes})...`
      );
    } else if (dlState === "ready" && dlPath) {
      sublineEl.textContent = t(
        `Установщик v${latestVer} скачан и проверен — нажмите кнопку, чтобы запустить обновление в 1 клик.`,
        `Installer v${latestVer} downloaded & verified — click to launch the 1-click upgrade.`
      );
    } else if (isAvailable) {
      const sizeNote = upd.asset_size > 0 ? ` · ${_formatUpdaterBytes(upd.asset_size)}` : "";
      sublineEl.textContent = t(
        `Доступна новая версия CineFlow v${latestVer} (у вас v${curVer})${sizeNote}`,
        `A new version CineFlow v${latestVer} is available (current v${curVer})${sizeNote}`
      );
    } else if (upd.error) {
      const errCode = String(upd.error);
      if (errCode === "update_source_not_configured") {
        sublineEl.textContent = t(
          `Установлена версия v${curVer}. Укажите GitHub-репозиторий или URL манифеста в параметрах ниже для автообновления.`,
          `Version v${curVer} installed. Configure a GitHub repository or manifest URL below to enable auto-updates.`
        );
      } else {
        sublineEl.textContent = t(
          `Установлена версия v${curVer} · ${errCode}`,
          `Version v${curVer} installed · ${errCode}`
        );
      }
    } else if (upd.last_checked_at) {
      sublineEl.textContent = t(
        `Установлена актуальная версия CineFlow v${curVer}`,
        `CineFlow v${curVer} is up to date`
      );
    } else {
      sublineEl.textContent = t(
        `Установлена версия CineFlow v${curVer}`,
        `Installed version: CineFlow v${curVer}`
      );
    }
  }

  if (progWrap && progFill && progText) {
    const showProg = dlState === "downloading";
    progWrap.classList.toggle("hidden", !showProg);
    if (showProg) {
      const pct = Math.max(2, Math.min(100, dlProgress));
      progFill.style.width = `${pct}%`;
      progText.textContent = `${pct}% · ${_formatUpdaterBytes(upd.downloaded_bytes)}${
        upd.total_bytes > 0 ? ` / ${_formatUpdaterBytes(upd.total_bytes)}` : ""
      }`;
    }
  }

  if (actionBtn) {
    if (!isLocalHost) {
      actionBtn.classList.add("hidden");
    } else if (dlState === "ready" && dlPath) {
      actionBtn.classList.remove("hidden");
      actionBtn.disabled = false;
      actionBtn.textContent = t(
        `Запустить установщик v${latestVer}`,
        `Launch Installer v${latestVer}`
      );
    } else if (dlState === "downloading") {
      actionBtn.classList.remove("hidden");
      actionBtn.disabled = true;
      actionBtn.textContent = t("Скачивание...", "Downloading...");
    } else if (isAvailable) {
      actionBtn.classList.remove("hidden");
      actionBtn.disabled = false;
      actionBtn.textContent = upd.asset_url
        ? t(`Скачать и установить v${latestVer}`, `Download & Install v${latestVer}`)
        : t(`Открыть страницу v${latestVer}`, `Open Release Page v${latestVer}`);
    } else {
      actionBtn.classList.add("hidden");
    }
  }

  if (notesEl) {
    let rawNotes = String(
      (isEn() ? upd.release_notes_en || upd.release_notes : upd.release_notes_ru || upd.release_notes) || ""
    ).trim();
    if (rawNotes.includes("<!-- EN -->")) {
      const parts = rawNotes.split("<!-- EN -->");
      rawNotes = (isEn() ? parts[1] || parts[0] : parts[0]).trim();
    }
    if (isAvailable && rawNotes) {
      notesEl.classList.remove("hidden");
      notesEl.innerHTML = _renderUpdateNotesMarkdown(rawNotes);
    } else {
      notesEl.classList.add("hidden");
      notesEl.textContent = "";
    }
  }
}

export async function saveUpdaterSettingsImmediate() {
  const autoCheckEl = document.getElementById("cfg-auto-check-updates");
  const repoEl = document.getElementById("cfg-update-repo");
  const manifestEl = document.getElementById("cfg-update-manifest-url");
  const body = {
    auto_check_updates: autoCheckEl ? Boolean(autoCheckEl.checked) : true,
    update_repo: (repoEl?.value || "").trim(),
    update_manifest_url: (manifestEl?.value || "").trim(),
    ..._adminPinPayload(),
  };
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.system) {
      state.systemStatus = data.system;
      if (data.system.updater) {
        state.updaterStatus = data.system.updater;
      }
      renderAppUpdaterUI();
    }
  } catch (_) {}
}

export async function checkAppUpdates({ force = true, silent = false } = {}) {
  const autoCheckEl = document.getElementById("cfg-auto-check-updates");
  const repoEl = document.getElementById("cfg-update-repo");
  const manifestEl = document.getElementById("cfg-update-manifest-url");
  const payload = {
    force: Boolean(force),
    ..._adminPinPayload(),
  };
  if (autoCheckEl) payload.auto_check_updates = Boolean(autoCheckEl.checked);
  if (repoEl) payload.update_repo = (repoEl.value || "").trim();
  if (manifestEl) payload.update_manifest_url = (manifestEl.value || "").trim();

  state.updaterStatus = {
    ...(state.updaterStatus || {}),
    checking: true,
    error: "",
  };
  renderAppUpdaterUI();

  try {
    const res = await fetch("/api/system/update/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      state.updaterStatus = {
        ...(state.updaterStatus || {}),
        checking: false,
        error: data?.error || `HTTP ${res.status}`,
      };
      renderAppUpdaterUI();
      if (!silent) {
        showToast(data?.error || t("Не удалось проверить обновления", "Could not check for updates"));
      }
      return null;
    }
    const upd = data?.updater && typeof data.updater === "object" ? data.updater : data || {};
    state.updaterStatus = upd;
    if (state.systemStatus) {
      state.systemStatus.updater = upd;
    }
    renderAppUpdaterUI(upd);
    renderNotificationsBell();

    if (upd.update_available && upd.latest_version) {
      if (!silent) {
        showToast(
          t(
            `Доступно обновление CineFlow v${upd.latest_version}!`,
            `CineFlow v${upd.latest_version} is available!`
          )
        );
      }
    } else if (!silent) {
      if (upd.error === "update_source_not_configured") {
        const detEl = document.getElementById("details-about-updater");
        if (detEl) detEl.open = true;
        document.getElementById("cfg-update-repo")?.focus();
        showToast(
          t(
            "Укажите GitHub-репозиторий (owner/repo) или URL манифеста для проверки релизов",
            "Enter a GitHub repository (owner/repo) or manifest URL to check for releases"
          )
        );
      } else if (upd.error) {
        showToast(`${t("Проверка обновлений", "Update check")}: ${upd.error}`);
      } else {
        showToast(
          t(
            `У вас установлена самая последняя версия (v${upd.current_version || state.appVersion})`,
            `You are running the latest version (v${upd.current_version || state.appVersion})`
          )
        );
      }
    }
    return upd;
  } catch (_) {
    state.updaterStatus = {
      ...(state.updaterStatus || {}),
      checking: false,
      error: "network_error",
    };
    renderAppUpdaterUI();
    if (!silent) {
      showToast(t("Не удалось связаться с сервером обновлений", "Failed to reach update server"));
    }
    return null;
  }
}

function _stopUpdaterPolling() {
  if (state.updaterPollTimerId) {
    clearInterval(state.updaterPollTimerId);
    state.updaterPollTimerId = null;
  }
}

export async function openDownloadedInstaller({ reveal = false } = {}) {
  try {
    const res = await fetch("/api/system/update/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reveal: Boolean(reveal), ..._adminPinPayload() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      showToast(data?.error || t("Не удалось открыть установщик", "Failed to launch installer"));
      return false;
    }
    const updObj = data?.updater || data?.status;
    if (updObj && typeof updObj === "object") {
      state.updaterStatus = updObj;
      renderAppUpdaterUI(updObj);
    }
    const isMac = Boolean(state.systemStatus?.is_macos);
    showToast(
      isMac
        ? t(
            "Установка обновления запущена — CineFlow сейчас автоматически перезапустится",
            "Update installation started — CineFlow will automatically restart in a moment"
          )
        : t(
            "Установщик CineFlow запущен — следуйте инструкциям на экране",
            "CineFlow Setup launched — follow the on-screen instructions"
          )
    );
    return true;
  } catch (_) {
    showToast(t("Не удалось открыть установщик", "Failed to launch installer"));
    return false;
  }
}

export async function startAppUpdateDownload() {
  const upd = state.updaterStatus || state.systemStatus?.updater || {};
  const rawState = String(upd.download_state || upd.state || "idle");
  const dlState = rawState === "downloaded" ? "ready" : rawState;
  const dlPath = String(upd.downloaded_path || upd.file_path || "");
  const relPageUrl = String(upd.release_page_url || upd.html_url || "");
  if (dlState === "ready" && dlPath) {
    await openDownloadedInstaller({ reveal: false });
    return;
  }
  if (!upd.asset_url && relPageUrl) {
    window.open(relPageUrl, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    const res = await fetch("/api/system/update/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ..._adminPinPayload() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      showToast(data?.error || t("Не удалось начать загрузку обновления", "Could not start update download"));
      return;
    }
    const updPayload = data?.updater && typeof data.updater === "object" ? data.updater : data;
    if (updPayload && typeof updPayload === "object") {
      state.updaterStatus = updPayload;
      if (state.systemStatus) {
        state.systemStatus.updater = updPayload;
      }
      renderAppUpdaterUI(updPayload);
    }
    const nextPath = String(updPayload?.downloaded_path || updPayload?.file_path || "");
    const nextState = String(updPayload?.download_state || updPayload?.state || "");
    if ((data?.already_downloaded || nextState === "ready" || nextState === "downloaded") && nextPath) {
      await openDownloadedInstaller({ reveal: false });
      return;
    }
    _stopUpdaterPolling();
    state.updaterPollTimerId = setInterval(async () => {
      try {
        const sRes = await fetch("/api/system/update/status");
        if (!sRes.ok) return;
        const sData = await sRes.json().catch(() => ({}));
        const nextUpd = sData?.updater && typeof sData.updater === "object" ? sData.updater : sData;
        if (!nextUpd || typeof nextUpd !== "object") return;
        state.updaterStatus = nextUpd;
        if (state.systemStatus) {
          state.systemStatus.updater = nextUpd;
        }
        renderAppUpdaterUI(nextUpd);
        const pollState = String(nextUpd.download_state || nextUpd.state || "");
        if (pollState === "ready" || pollState === "downloaded") {
          _stopUpdaterPolling();
          renderNotificationsBell();
          await openDownloadedInstaller({ reveal: false });
        } else if (pollState === "error") {
          _stopUpdaterPolling();
          showToast(
            `${t("Ошибка загрузки обновления", "Update download error")}: ${
              nextUpd.download_error || nextUpd.error || "failed"
            }`
          );
        }
      } catch (_) {}
    }, 750);
  } catch (_) {
    showToast(t("Не удалось начать загрузку обновления", "Could not start update download"));
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
            `Доступ в домашней сети включен${data?.system?.lan_url ? `: ${data.system.lan_url}` : ""}`,
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
        ? t(`Автозапуск CineFlow при входе в ${osLabel} включен`, `CineFlow ${osLabel} login autostart enabled`)
        : t(`Автозапуск CineFlow при входе в ${osLabel} отключен`, `CineFlow ${osLabel} login autostart disabled`)
    );
  } catch (_) {
    showToast(t("Не удалось обновить настройку автозапуска", "Failed to update login autostart setting"));
    renderSystemStatusUI();
  }
}
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
  const res = await fetch(`/api/settings?lang=${encodeURIComponent(state.appLang || "ru")}`);
  const cfg = res.ok ? await res.json().catch(() => ({})) : {};
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
  document.getElementById("cfg-spoof-region").value = cfg.hdrezka?.spoof_region || "KZ";
  document.getElementById("cfg-custom-mirror").value = cfg.hdrezka?.custom_mirror || "";
  document.getElementById("cfg-proxy-url").value = cfg.hdrezka?.proxy_url || "";
  const cfWorkerEl = document.getElementById("cfg-cf-worker");
  if (cfWorkerEl) cfWorkerEl.value = cfg.hdrezka?.cf_worker_relay || "";
  const rawMode = cfg.backup_stream?.mode || "torrserver";
  const normMode =
    rawMode === "debrid_https"
      ? cfg.backup_stream?.debrid_configured
        ? "realdebrid"
        : "torrserver"
      : rawMode;
  document.getElementById("cfg-backup-mode").value = normMode;
  const torrUrlVal = cfg.backup_stream?.torrserver_url || "http://127.0.0.1:8090";
  document.getElementById("cfg-torrserver-url").value = torrUrlVal;
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
      ? t("Ключ сохранен (вставьте новый для замены)", "Key saved (paste new to replace)")
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
  updateBackupSummaryStat();
  switchSettingsTab(initialTab);
  syncSettingsFooterUI();
  document.getElementById("settings-modal").classList.remove("hidden");
  syncScrollTopButton();

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
  listEl.innerHTML = "";
  const addons = Array.isArray(state.stremioAddons) ? state.stremioAddons : [];
  if (addons.length === 0) {
    listEl.innerHTML = `<div class="atv-stremio-empty-addons">${t("Нет установленных аддонов", "No addons installed")}</div>`;
    return;
  }
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
            ? `<button type="button" class="atv-btn-secondary atv-btn-xs atv-btn-danger-text btn-remove-stremio-addon" title="${t("Удалить аддон", "Remove addon")}">${t("Удалить", "Remove")}</button>`
            : ""
        }
        <label class="srv-toggle-wrap" title="${isEnabled ? t("Отключить аддон", "Disable addon") : t("Включить аддон", "Enable addon")}">
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
              ? t(`Аддон «${addon.name}» включен`, `Addon "${addon.name}" enabled`)
              : t(`Аддон «${addon.name}» отключен`, `Addon "${addon.name}" disabled`)
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
    listEl.appendChild(row);
  });
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
    showToast(t(`Аддон подключен: ${data.addon?.name || "Stremio"}`, `Addon installed: ${data.addon?.name || "Stremio"}`));
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

const _TZ_TO_EU_COUNTRY = {
  "Europe/Warsaw": "PL",
  "Europe/Berlin": "DE",
  "Europe/Busingen": "DE",
  "Europe/Kyiv": "UA",
  "Europe/Kiev": "UA",
  "Europe/Uzhgorod": "UA",
  "Europe/Zaporozhye": "UA",
  "Europe/London": "GB",
  "Europe/Paris": "FR",
  "Europe/Rome": "IT",
  "Europe/Madrid": "ES",
  "Atlantic/Canary": "ES",
  "Europe/Prague": "CZ",
  "Europe/Vienna": "AT",
  "Europe/Amsterdam": "NL",
  "Europe/Brussels": "BE",
  "Europe/Zurich": "CH",
  "Europe/Stockholm": "SE",
  "Europe/Oslo": "NO",
  "Europe/Copenhagen": "DK",
  "Europe/Helsinki": "FI",
  "Europe/Riga": "LV",
  "Europe/Vilnius": "LT",
  "Europe/Tallinn": "EE",
  "Europe/Minsk": "BY",
  "Europe/Chisinau": "MD",
  "Europe/Lisbon": "PT",
  "Europe/Dublin": "IE",
  "Europe/Athens": "GR",
  "Europe/Bucharest": "RO",
  "Europe/Sofia": "BG",
  "Europe/Budapest": "HU",
  "Europe/Bratislava": "SK",
  "Europe/Belgrade": "RS",
  "Europe/Zagreb": "HR",
  "Europe/Ljubljana": "SI",
  "Europe/Sarajevo": "BA",
  "Europe/Skopje": "MK",
  "Europe/Podgorica": "ME",
  "Europe/Tirane": "AL",
  "Atlantic/Reykjavik": "IS",
  "Europe/Luxembourg": "LU",
  "Europe/Malta": "MT",
  "Asia/Nicosia": "CY",
  "Europe/Nicosia": "CY",
  "Europe/Monaco": "MC",
  "Europe/Andorra": "AD",
  "Europe/Vaduz": "LI",
  "Europe/San_Marino": "SM",
  "Europe/Vatican": "VA",
  "Europe/Moscow": "RU",
  "Europe/Kaliningrad": "RU",
  "Europe/Samara": "RU",
  "Europe/Volgograd": "RU",
  "Europe/Istanbul": "TR",
  "Asia/Istanbul": "TR",
  "Asia/Tbilisi": "GE",
  "Asia/Yerevan": "AM",
  "Asia/Baku": "AZ",
};

export function detectEuropeanCountryFromTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (tz && _TZ_TO_EU_COUNTRY[tz]) {
      return _TZ_TO_EU_COUNTRY[tz];
    }
  } catch (_) {}
  return "PL";
}

function getSortedEuCountries() {
  const en = isEn();
  const list = Array.isArray(state.euCountries) ? [...state.euCountries] : [];
  list.sort((a, b) => {
    const la = String(en ? a.name_en || a.name : a.name_ru || a.name);
    const lb = String(en ? b.name_en || b.name : b.name_ru || b.name);
    return la.localeCompare(lb, en ? "en" : "ru");
  });
  return list;
}

function getCountryEntryByCode(code) {
  const norm = String(code || state.userCountry || "PL").toUpperCase();
  const found = (state.euCountries || []).find((c) => c.code === norm);
  if (found) return found;
  if (state.countryProfile && state.countryProfile.code === norm) return state.countryProfile;
  return null;
}

const _POPULAR_EU_CODES = ["PL", "DE", "UA", "CZ", "LT", "LV", "EE", "IT", "ES", "FR", "GB", "NL", "RU", "TR", "BY"];

function filterEuCountriesList(sorted, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return sorted;
  return sorted.filter((c) => {
    const code = String(c.code || "").toLowerCase();
    const ru = String(c.name_ru || c.name || "").toLowerCase();
    const en = String(c.name_en || c.name || "").toLowerCase();
    return code === q || code.includes(q) || ru.includes(q) || en.includes(q);
  });
}

function buildCountryOptionsHtml(sorted, curCode, en, searchQuery = "") {
  const filtered = filterEuCountriesList(sorted, searchQuery);
  const effectiveList = filtered.length > 0 ? filtered : sorted;
  const renderOpt = (c) => {
    const label = en ? c.name_en || c.name : c.name_ru || c.name;
    const selected = c.code === curCode ? " selected" : "";
    return `<option value="${escapeAttr(c.code)}"${selected}>${escapeHtml(label)} (${escapeHtml(c.code)})</option>`;
  };

  if (String(searchQuery || "").trim()) {
    return effectiveList.map(renderOpt).join("");
  }

  const popSet = new Set(_POPULAR_EU_CODES);
  const byCode = new Map(effectiveList.map((c) => [c.code, c]));
  const popularItems = _POPULAR_EU_CODES.map((code) => byCode.get(code)).filter(Boolean);
  const restItems = effectiveList.filter((c) => !popSet.has(c.code));

  if (popularItems.length === 0 || restItems.length === 0) {
    return effectiveList.map(renderOpt).join("");
  }
  const popLabel = en ? "Popular Countries" : "Часто выбираемые";
  const allLabel = en ? "All Other European Countries" : "Остальные страны Европы";
  return `<optgroup label="${escapeAttr(popLabel)}">${popularItems.map(renderOpt).join("")}</optgroup><optgroup label="${escapeAttr(allLabel)}">${restItems.map(renderOpt).join("")}</optgroup>`;
}

export function renderSettingsCountryUI() {
  const sel = document.getElementById("settings-country-select");
  const hint = document.getElementById("settings-country-bypass-hint");
  const en = isEn();
  const sorted = getSortedEuCountries();
  const curCode = String(state.userCountry || "PL").toUpperCase();
  if (sel && sorted.length > 0) {
    sel.innerHTML = buildCountryOptionsHtml(sorted, curCode, en);
    sel.value = curCode;
    syncAllCustomSelects();
  }
  const activeEntry = getCountryEntryByCode(curCode);
  if (hint) {
    if (activeEntry) {
      const restr = en
        ? activeEntry.restrictions_en || activeEntry.restrictions || ""
        : activeEntry.restrictions_ru || activeEntry.restrictions || "";
      const summary = en
        ? activeEntry.bypass_summary_en || activeEntry.bypass_summary || ""
        : activeEntry.bypass_summary_ru || activeEntry.bypass_summary || "";
      hint.textContent = restr ? `${restr} — ${summary}` : summary;
    } else {
      hint.textContent = t(
        "Обход блокировок и региональные каталоги",
        "Restriction bypass and regional catalogs"
      );
    }
  }
}

export async function changeUserCountryInstant(newCountryCode) {
  const cleanCode = String(newCountryCode || "").trim().toUpperCase();
  if (!cleanCode) return;
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_country: cleanCode,
        auto_adjust_bypass: true,
        ..._adminPinPayload(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      renderSettingsCountryUI();
      showToast(data?.error || t("Не удалось применить страну", "Failed to update country"));
      return;
    }
    if (data.user_country) state.userCountry = data.user_country;
    if (data.country_profile) state.countryProfile = data.country_profile;
    if (data.integrations) state.integrations = data.integrations;
    if (data.hdrezka?.spoof_region) {
      const spoofEl = document.getElementById("cfg-spoof-region");
      if (spoofEl) spoofEl.value = data.hdrezka.spoof_region;
    }
    if (data.backup_stream?.mode) {
      const bkpEl = document.getElementById("cfg-backup-mode");
      if (bkpEl) {
        const rawM = data.backup_stream.mode;
        bkpEl.value =
          rawM === "debrid" || rawM === "debrid_https"
            ? data.backup_stream?.debrid_configured
              ? "realdebrid"
              : "torrserver"
            : rawM;
        syncCustomSelect(bkpEl);
      }
    }
    state.settingsBaseline = getNetworkSettingsSnapshot();
    renderSettingsCountryUI();
    renderIntegrationsList();
    applyEnabledServicesVisibility();
    loadCatalog();
    const prof = data.country_profile || getCountryEntryByCode(cleanCode);
    const cname = prof ? (isEn() ? prof.name_en || prof.name : prof.name_ru || prof.name) : cleanCode;
    showToast(
      t(
        `Локализация и обход блокировок применены: ${cname}`,
        `Localization and restriction bypass applied: ${cname}`
      )
    );
  } catch (_) {
    showToast(t("Не удалось применить страну", "Failed to update country"));
  }
}

const _ONBOARDING_SERVICES_META = [
  {
    id: "hdrezka",
    group: "builtin",
    name: "HDRezka",
    tagsRu: ["Встроенный плеер", "1080p", "Дубляж + Оригинал", "Без регистрации"],
    tagsEn: ["Built-in Player", "1080p", "Dubs + Original", "No Account"],
    ru: "Мгновенный запуск фильмов и сериалов во встроенном плеере CineFlow: выбор студий озвучки, автоматическая разблокировка оригинала с субтитрами и пропуск вступительных заставок",
    en: "Instant movie and series playback inside CineFlow: studio dubbing selector, automatic unlock of original audio with subtitles, and intro skip",
  },
  {
    id: "stremio",
    group: "builtin",
    name: "Stremio",
    tagsRu: ["Встроенный плеер", "4K + 1080p", "Субтитры OpenSubtitles", "Без регистрации"],
    tagsEn: ["Built-in Player", "4K + 1080p", "OpenSubtitles", "No Account"],
    ru: "Международные и русскоязычные потоки 4K и 1080p через встроенные аддоны Torrentio с автоподгрузкой многоязычных субтитров OpenSubtitles v3",
    en: "International and Russian 4K and 1080p streams via built-in Torrentio addons with automatic multi-language OpenSubtitles v3 tracks",
    p2pStrictNoteRu: "Для выбранной страны прямой BitTorrent P2P заблокирован защитой от штрафов — работают прямые HTTPS-источники и облако Debrid",
    p2pStrictNoteEn: "For the selected country, bare BitTorrent P2P is locked for anti-fine protection — direct HTTPS streams and Debrid cloud remain active",
  },
  {
    id: "backup4k",
    group: "builtin",
    name: "4K Remux",
    tagsRu: ["Встроенный плеер", "4K UHD HDR / BDRemux", "FFmpeg ремукс звука", "Без регистрации"],
    tagsEn: ["Built-in Player", "4K UHD HDR / BDRemux", "FFmpeg Audio Remux", "No Account"],
    ru: "Максимальный битрейт 4K UHD HDR, Dolby Vision и BDRemux через встроенный движок TorrServer или облако Real-Debrid / TorBox с аппаратным ремуксом всех звуковых дорожек",
    en: "Maximum-bitrate 4K UHD HDR, Dolby Vision, and BDRemux via bundled TorrServer or Real-Debrid / TorBox cloud with live multi-track audio remuxing",
    p2pStrictNoteRu: "Для Германии и стран со строгим контролем P2P движок автоматически переведён в безопасный режим HTTPS (Debrid) без запуска локального торрент-клиента",
    p2pStrictNoteEn: "Automatically switched to safe HTTPS (Debrid) mode without spawning a local BitTorrent swarm in strict anti-P2P jurisdictions",
  },
  {
    id: "appletv",
    group: "official",
    name: "Apple TV+",
    tagsRu: ["Каталог региона", "4K Dolby Vision", "По подписке", "Внешний плеер"],
    tagsEn: ["Regional Catalog", "4K Dolby Vision", "Subscription", "External Player"],
    ru: "Отображает оригинальные фильмы и сериалы Apple TV+ вашего европейского региона на полках каталога и открывает просмотр в официальном приложении или браузере",
    en: "Shows Apple TV+ Originals available in your European country on catalog shelves and opens playback in the official app or browser",
  },
  {
    id: "netflix",
    group: "official",
    name: "Netflix",
    tagsRu: ["Каталог региона", "4K HDR", "По подписке", "Внешний плеер"],
    tagsEn: ["Regional Catalog", "4K HDR", "Subscription", "External Player"],
    ru: "Подключает региональную библиотеку премьер, сериалов и фильмов Netflix выбранной страны Европы с прямым переходом к официальному плееру",
    en: "Adds the regional Netflix library of movies, series, and premieres for your selected European country with direct official player launch",
  },
  {
    id: "prime",
    group: "official",
    name: "Prime Video",
    tagsRu: ["Каталог региона", "4K HDR", "По подписке", "Внешний плеер"],
    tagsEn: ["Regional Catalog", "4K HDR", "Subscription", "External Player"],
    ru: "Добавляет фильмы и сериалы Amazon Prime Video, доступные в выбранной стране Европы, с фильтром по сервису и переходом на официальный сайт",
    en: "Includes Amazon Prime Video movies and series licensed in your selected European country with provider filtering and official launch",
  },
  {
    id: "disney",
    group: "official",
    name: "Disney+",
    tagsRu: ["Каталог региона", "4K Dolby Vision", "По подписке", "Внешний плеер"],
    tagsEn: ["Regional Catalog", "4K Dolby Vision", "Subscription", "External Player"],
    ru: "Показывает релизы Disney, Pixar, Marvel, Star Wars и FX / Star в вашей стране Европы с быстрым запуском во внешнем плеере",
    en: "Surfaces Disney, Pixar, Marvel, Star Wars, and FX / Star titles in your European country with quick external player launch",
  },
  {
    id: "max",
    group: "official",
    name: "Max (HBO)",
    tagsRu: ["Каталог региона", "4K Dolby Vision", "По подписке", "Внешний плеер"],
    tagsEn: ["Regional Catalog", "4K Dolby Vision", "Subscription", "External Player"],
    ru: "Интегрирует флагманские сериалы HBO, фильмы Warner Bros и европейские премьеры платформы Max с переходом в официальный плеер",
    en: "Integrates flagship HBO series, Warner Bros movies, and European Max premieres with direct official player handoff",
  },
  {
    id: "playerpl",
    group: "official",
    name: "Player.pl",
    tagsRu: ["Локальный сервис PL", "TVN / VOD", "По подписке", "Внешний плеер"],
    tagsEn: ["Poland Local VOD", "TVN Catalog", "Subscription", "External Player"],
    ru: "Локальный польский стриминг группы TVN Warner Bros Discovery: фильмы, сериалы и пакеты каналов (автоматически рекомендуется при выборе Польши)",
    en: "Polish local TVN Warner Bros Discovery streaming service: VOD movies, series, and channel packages (recommended when Poland is selected)",
  },
];

function syncKinoriumChoiceUI(enabled) {
  const isOn = Boolean(enabled);
  const kinToggle = document.getElementById("ob-kinorium-enable");
  const btnOn = document.getElementById("ob-kin-mode-on");
  const btnOff = document.getElementById("ob-kin-mode-off");
  const fields = document.getElementById("ob-kinorium-fields");
  const disabledNote = document.getElementById("ob-kinorium-disabled-note");
  const benefitsBox = document.getElementById("ob-kinorium-benefits-box");
  if (kinToggle) kinToggle.checked = isOn;
  if (btnOn) {
    btnOn.classList.toggle("active", isOn);
    btnOn.setAttribute("aria-pressed", isOn ? "true" : "false");
  }
  if (btnOff) {
    btnOff.classList.toggle("active", !isOn);
    btnOff.setAttribute("aria-pressed", !isOn ? "true" : "false");
  }
  if (fields) fields.classList.toggle("hidden", !isOn);
  if (disabledNote) disabledNote.classList.toggle("hidden", isOn);
  if (benefitsBox) benefitsBox.classList.toggle("is-muted", !isOn);
}

function updateOnboardingBypassSummary(countryCode) {
  const noteEl = document.getElementById("ob-country-bypass-note");
  const countBadge = document.getElementById("ob-country-count-badge");
  const en = isEn();
  if (countBadge) {
    const total = Array.isArray(state.euCountries) && state.euCountries.length > 0 ? state.euCountries.length : 50;
    countBadge.textContent = en ? `${total} countries` : `${total} стран`;
  }
  if (!noteEl) return;
  const entry = getCountryEntryByCode(countryCode);
  if (!entry) {
    noteEl.innerHTML = "";
    return;
  }
  const restrictions = en
    ? entry.restrictions_en || entry.restrictions || ""
    : entry.restrictions_ru || entry.restrictions || "";
  const summary = en
    ? entry.bypass_summary_en || entry.bypass_summary || ""
    : entry.bypass_summary_ru || entry.bypass_summary || "";
  const tags = (en ? entry.bypass_tags_en : entry.bypass_tags_ru) || entry.bypass_tags || [];
  const restrTitle = en ? "Country restrictions" : "Ограничения в выбранной стране";
  const bypassTitle = en ? "Active CineFlow bypass profile" : "Активный профиль обхода CineFlow";

  const tagsHtml = Array.isArray(tags) && tags.length > 0
    ? `<div class="atv-ob-bypass-tags">${tags
        .map((tag) => `<span class="atv-ob-bypass-chip">${escapeHtml(String(tag))}</span>`)
        .join("")}</div>`
    : "";

  noteEl.innerHTML = `
    ${
      restrictions
        ? `<div class="atv-ob-bypass-row">
            <span class="atv-ob-bypass-kicker">${escapeHtml(restrTitle)}:</span>
            <span class="atv-ob-bypass-val">${escapeHtml(restrictions)}</span>
          </div>`
        : ""
    }
    <div class="atv-ob-bypass-row">
      <span class="atv-ob-bypass-kicker">${escapeHtml(bypassTitle)}:</span>
      <span class="atv-ob-bypass-val is-primary">${escapeHtml(summary)}</span>
    </div>
    ${tagsHtml}
  `;
}

function applyCountryDrivenServiceDefaults(countryCode) {
  if (!state.onboardingIsFirstRun || !state.onboardingDraftServices) return;
  if (!state.onboardingUserTouchedPlayerPl) {
    state.onboardingDraftServices.playerpl = String(countryCode || "").toUpperCase() === "PL";
  }
}

export function setOnboardingStep(step) {
  const targetStep = Math.max(1, Math.min(3, Number(step) || 1));
  state.onboardingStep = targetStep;
  closeCustomSelectMenu();

  document.querySelectorAll("#onboarding-modal [data-ob-step]").forEach((sec) => {
    const secStep = Number(sec.getAttribute("data-ob-step")) || 1;
    sec.classList.toggle("hidden", secStep !== targetStep);
  });

  document.querySelectorAll("#ob-stepper [data-ob-step-btn]").forEach((btn) => {
    const btnStep = Number(btn.getAttribute("data-ob-step-btn")) || 1;
    const isActive = btnStep === targetStep;
    btn.classList.toggle("active", isActive);
    btn.classList.toggle("is-completed", btnStep < targetStep);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  const backBtn = document.getElementById("btn-onboarding-back");
  const nextBtn = document.getElementById("btn-onboarding-next");
  const finishBtn = document.getElementById("btn-onboarding-finish");
  if (backBtn) backBtn.classList.toggle("hidden", targetStep <= 1);
  if (nextBtn) nextBtn.classList.toggle("hidden", targetStep >= 3);
  if (finishBtn) finishBtn.classList.toggle("hidden", targetStep < 3);

  const bodyEl = document.getElementById("onboarding-body");
  if (bodyEl) bodyEl.scrollTop = 0;
}

export function renderOnboardingModalUI() {
  const en = isEn();
  const sel = document.getElementById("ob-country-select");
  const sorted = getSortedEuCountries();
  const activeCountry = String(
    state.onboardingDraftCountry || state.userCountry || "PL"
  ).toUpperCase();

  if (sel && sorted.length > 0) {
    sel.innerHTML = buildCountryOptionsHtml(sorted, activeCountry, en, "");
    sel.value = activeCountry;
    syncAllCustomSelects();
    sel.onchange = () => {
      const nextCode = String(sel.value || "PL").toUpperCase();
      state.onboardingDraftCountry = nextCode;
      applyCountryDrivenServiceDefaults(nextCode);
      updateOnboardingBypassSummary(nextCode);
      renderOnboardingServicesRows();
    };
  }
  updateOnboardingBypassSummary(activeCountry);

  const skipBtn = document.getElementById("btn-onboarding-skip");
  if (skipBtn && !skipBtn.disabled) {
    skipBtn.textContent = state.onboardingIsFirstRun
      ? t("Пропустить", "Skip (Defaults)")
      : t("Отмена", "Cancel");
  }
  const backBtn = document.getElementById("btn-onboarding-back");
  if (backBtn) backBtn.textContent = t("Назад", "Back");
  const nextBtn = document.getElementById("btn-onboarding-next");
  if (nextBtn) nextBtn.textContent = t("Далее", "Next");
  const finishBtn = document.getElementById("btn-onboarding-finish");
  if (finishBtn && !finishBtn.disabled) {
    finishBtn.textContent = t("Применить и начать", "Apply & Start");
  }

  if (!state.onboardingDraftServices) {
    const draft = {};
    _ONBOARDING_SERVICES_META.forEach((m) => {
      const curInteg = state.integrations?.[m.id];
      draft[m.id] = curInteg ? curInteg.enabled !== false : m.group === "builtin";
    });
    state.onboardingDraftServices = draft;
    applyCountryDrivenServiceDefaults(activeCountry);
  }

  if (typeof state.onboardingDraftKinorium !== "boolean") {
    state.onboardingDraftKinorium = state.integrations?.kinorium
      ? state.integrations.kinorium.enabled !== false
      : true;
  }
  syncKinoriumChoiceUI(state.onboardingDraftKinorium);

  const kinToggle = document.getElementById("ob-kinorium-enable");
  const btnKinOn = document.getElementById("ob-kin-mode-on");
  const btnKinOff = document.getElementById("ob-kin-mode-off");
  if (kinToggle) {
    kinToggle.onchange = () => {
      state.onboardingDraftKinorium = Boolean(kinToggle.checked);
      syncKinoriumChoiceUI(state.onboardingDraftKinorium);
    };
  }
  if (btnKinOn) {
    btnKinOn.onclick = () => {
      state.onboardingDraftKinorium = true;
      syncKinoriumChoiceUI(true);
    };
  }
  if (btnKinOff) {
    btnKinOff.onclick = () => {
      state.onboardingDraftKinorium = false;
      syncKinoriumChoiceUI(false);
    };
  }

  const presetBuiltinBtn = document.getElementById("ob-preset-builtin");
  const presetAllBtn = document.getElementById("ob-preset-all");
  if (presetBuiltinBtn) {
    presetBuiltinBtn.onclick = () => {
      _ONBOARDING_SERVICES_META.forEach((m) => {
        state.onboardingDraftServices[m.id] = m.group === "builtin";
      });
      state.onboardingUserTouchedPlayerPl = true;
      renderOnboardingServicesRows();
    };
  }
  if (presetAllBtn) {
    presetAllBtn.onclick = () => {
      const curC = String(state.onboardingDraftCountry || state.userCountry || "PL").toUpperCase();
      _ONBOARDING_SERVICES_META.forEach((m) => {
        state.onboardingDraftServices[m.id] = m.id === "playerpl" ? curC === "PL" : true;
      });
      renderOnboardingServicesRows();
    };
  }

  renderOnboardingServicesRows();
  setOnboardingStep(state.onboardingStep || 1);
}

function renderOnboardingServicesRows() {
  const srvList = document.getElementById("ob-services-list");
  if (!srvList || !state.onboardingDraftServices) return;
  const en = isEn();
  const activeCountry = String(
    state.onboardingDraftCountry || state.userCountry || "PL"
  ).toUpperCase();
  const countryEntry = getCountryEntryByCode(activeCountry);
  const isP2pStrict = Boolean(countryEntry?.p2p_strict);

  srvList.innerHTML = "";
  let renderedBuiltinHead = false;
  let renderedOfficialHead = false;
  let officialToggleAllBtn = null;

  const officialIds = _ONBOARDING_SERVICES_META.filter((x) => x.group === "official").map((x) => x.id);
  const syncOfficialToggleLabel = () => {
    if (!officialToggleAllBtn) return;
    const relevantOfficialIds = officialIds.filter((id) => id !== "playerpl" || activeCountry === "PL");
    const allOn = relevantOfficialIds.every((id) => Boolean(state.onboardingDraftServices?.[id]));
    officialToggleAllBtn.textContent = allOn
      ? t("Снять все", "Clear all")
      : t("Выбрать все", "Select all");
  };

  _ONBOARDING_SERVICES_META.forEach((srv) => {
    if (srv.group === "builtin" && !renderedBuiltinHead) {
      renderedBuiltinHead = true;
      const gh = document.createElement("div");
      gh.className = "integrations-group-label";
      gh.textContent = t(
        "Встроенные видеоисточники (плеер CineFlow · без регистрации · рекомендуется)",
        "Built-in Video Sources (CineFlow Player · No Account Needed · Recommended)"
      );
      srvList.appendChild(gh);
    } else if (srv.group === "official" && !renderedOfficialHead) {
      renderedOfficialHead = true;
      const gh = document.createElement("div");
      gh.className = "integrations-group-label integrations-group-label-row";
      const spanLbl = document.createElement("span");
      spanLbl.textContent = t(
        "Официальные стриминговые сервисы (региональный каталог · внешний плеер по подписке)",
        "Official Streaming Services (Regional Catalog · External Player · Subscription)"
      );
      officialToggleAllBtn = document.createElement("button");
      officialToggleAllBtn.type = "button";
      officialToggleAllBtn.className = "atv-ob-group-action-btn";
      officialToggleAllBtn.onclick = () => {
        const relevantOfficialIds = officialIds.filter((id) => id !== "playerpl" || activeCountry === "PL");
        const allOn = relevantOfficialIds.every((id) => Boolean(state.onboardingDraftServices?.[id]));
        const nextState = !allOn;
        officialIds.forEach((id) => {
          if (id === "playerpl" && nextState && activeCountry !== "PL") {
            state.onboardingDraftServices[id] = false;
          } else {
            state.onboardingDraftServices[id] = nextState;
          }
        });
        renderOnboardingServicesRows();
      };
      gh.appendChild(spanLbl);
      gh.appendChild(officialToggleAllBtn);
      srvList.appendChild(gh);
    }

    const checked = Boolean(state.onboardingDraftServices[srv.id]);
    const tags = en ? srv.tagsEn || [] : srv.tagsRu || [];
    const tagsHtml = tags
      .map((tg) => `<span class="atv-ob-srv-tag">${escapeHtml(tg)}</span>`)
      .join("");
    const policyNote =
      isP2pStrict && (en ? srv.p2pStrictNoteEn : srv.p2pStrictNoteRu)
        ? `<div class="atv-ob-srv-policy">${escapeHtml(en ? srv.p2pStrictNoteEn : srv.p2pStrictNoteRu)}</div>`
        : "";

    const row = document.createElement("label");
    row.className = `atv-ob-srv-row${checked ? "" : " is-disabled"}`;
    row.innerHTML = `
      <div class="atv-ob-srv-info">
        <div class="atv-ob-srv-head">
          <span class="atv-ob-srv-name">${escapeHtml(srv.name)}</span>
          <div class="atv-ob-srv-tags">${tagsHtml}</div>
        </div>
        <div class="atv-ob-srv-desc">${escapeHtml(en ? srv.en : srv.ru)}</div>
        ${policyNote}
      </div>
      <span class="srv-toggle">
        <input type="checkbox" role="switch" data-ob-srv="${escapeAttr(srv.id)}" aria-label="${escapeAttr(srv.name || srv.id)}" ${checked ? "checked" : ""} />
        <span class="srv-toggle-slider"></span>
      </span>
    `;
    const cb = row.querySelector("input[data-ob-srv]");
    if (cb) {
      cb.onchange = () => {
        state.onboardingDraftServices[srv.id] = Boolean(cb.checked);
        if (srv.id === "playerpl") {
          state.onboardingUserTouchedPlayerPl = true;
        }
        row.classList.toggle("is-disabled", !cb.checked);
        syncOfficialToggleLabel();
      };
    }
    srvList.appendChild(row);
  });
  syncOfficialToggleLabel();
}

export async function openOnboardingModal({ isFirstRun = false } = {}) {
  const obMod = document.getElementById("onboarding-modal");
  if (!obMod) return;
  const wasHidden = obMod.classList.contains("hidden");
  if (!isFirstRun && wasHidden && state.activeProfile?.kids_mode && state.activeProfile?.has_kids_pin) {
    const pin = await ensureKidsPinVerifiedForAdminAction(
      t(
        "Введите 4-значный PIN-код для запуска мастера настройки",
        "Enter the 4-digit PIN to open the Setup Wizard"
      )
    );
    if (!pin) return;
  }
  const settingsMod = document.getElementById("settings-modal");
  const cameFromSettings = Boolean(!isFirstRun && settingsMod && !settingsMod.classList.contains("hidden"));
  if (wasHidden && !isFirstRun) {
    rememberModalTriggerFocus("onboarding-modal");
  }
  if (wasHidden) {
    state.onboardingStep = 1;
    state.onboardingReturnToSettings = cameFromSettings;
  }
  state.onboardingIsFirstRun = Boolean(isFirstRun);
  state.onboardingCountrySearch = "";
  state.onboardingUserTouchedPlayerPl = false;

  if (!Array.isArray(state.euCountries) || state.euCountries.length === 0) {
    try {
      const res = await fetch(`/api/settings?lang=${encodeURIComponent(state.appLang || "ru")}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cfg = await res.json();
      if (cfg.integrations) state.integrations = cfg.integrations;
      if (cfg.user_country) state.userCountry = cfg.user_country;
      if (cfg.country_profile) state.countryProfile = cfg.country_profile;
      if (Array.isArray(cfg.eu_countries)) state.euCountries = cfg.eu_countries;
      if (cfg.kinorium) {
        const kUid = cfg.kinorium.user_id || "";
        let kDisp = cfg.kinorium.display_name || "";
        if (kUid === "51670" && (!kDisp || kDisp.startsWith("user_"))) {
          kDisp = "Andrei Crustillio";
        }
        state.kinoriumAccount = {
          user_id: kUid,
          display_name: kDisp,
          avatar_url: cfg.kinorium.avatar_url || "",
          profile_url: cfg.kinorium.profile_url || "",
          connected: Boolean(cfg.kinorium.connected && cfg.kinorium.user_id),
          has_session_cookie: Boolean(cfg.kinorium.has_session_cookie),
          cw_dismissed_count: Number(cfg.kinorium.cw_dismissed_count || 0),
        };
      }
    } catch (_) {}
  }

  const initialCountry = isFirstRun
    ? detectEuropeanCountryFromTimezone()
    : String(state.userCountry || "PL").toUpperCase();
  state.onboardingDraftCountry = initialCountry;

  const draftServices = {};
  _ONBOARDING_SERVICES_META.forEach((m) => {
    if (isFirstRun) {
      draftServices[m.id] = m.group === "builtin" || (m.id === "playerpl" && initialCountry === "PL");
    } else {
      const curInteg = state.integrations?.[m.id];
      draftServices[m.id] = curInteg ? curInteg.enabled !== false : m.group === "builtin";
    }
  });
  state.onboardingDraftServices = draftServices;
  state.onboardingDraftKinorium = isFirstRun
    ? true
    : state.integrations?.kinorium
    ? state.integrations.kinorium.enabled !== false
    : true;

  const userInp = document.getElementById("ob-kinorium-user");
  const cookieInp = document.getElementById("ob-kinorium-cookie");
  if (userInp) {
    const acc = state.kinoriumAccount || {};
    userInp.value = acc.connected && acc.user_id ? acc.profile_url || acc.user_id : "";
  }
  if (cookieInp) {
    cookieInp.value = "";
  }

  const closeBtn = document.getElementById("close-onboarding-modal");
  if (closeBtn) {
    closeBtn.classList.toggle("hidden", Boolean(isFirstRun));
  }

  applyStaticDomTranslations();
  syncLanguageSegmentedControlUI();
  renderOnboardingModalUI();

  if (settingsMod && !settingsMod.classList.contains("hidden")) {
    settingsMod.classList.add("hidden");
  }

  obMod.classList.remove("hidden");
  if (wasHidden) {
    requestAnimationFrame(() => {
      (
        document.getElementById("btn-onboarding-next") ||
        document.getElementById("close-onboarding-modal")
      )?.focus({ preventScroll: true });
    });
  }
  syncScrollTopButton();
}

export function closeOnboardingModal({ reopenSettings = false } = {}) {
  const obMod = document.getElementById("onboarding-modal");
  if (!obMod || obMod.classList.contains("hidden")) return;
  closeCustomSelectMenu();
  obMod.classList.add("hidden");
  const shouldReopenSettings = Boolean(reopenSettings && state.onboardingReturnToSettings);
  state.onboardingReturnToSettings = false;
  if (shouldReopenSettings) {
    const settingsMod = document.getElementById("settings-modal");
    if (settingsMod) {
      settingsMod.classList.remove("hidden");
    }
  }
  syncScrollTopButton();
  restoreModalTriggerFocus("onboarding-modal");
}

export async function skipOnboardingModal() {
  if (!state.onboardingIsFirstRun) {
    closeOnboardingModal({ reopenSettings: true });
    return;
  }
  const skipBtn = document.getElementById("btn-onboarding-skip");
  if (skipBtn && skipBtn.disabled) return;
  const autoCountry = String(detectEuropeanCountryFromTimezone() || "PL").toUpperCase();
  const defaultServices = {
    hdrezka: true,
    stremio: true,
    backup4k: true,
    kinorium: true,
    appletv: false,
    netflix: false,
    prime: false,
    disney: false,
    max: false,
    playerpl: autoCountry === "PL",
  };
  if (skipBtn) skipBtn.disabled = true;
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_lang: state.appLang || "ru",
        user_country: autoCountry,
        setup_completed: true,
        auto_adjust_bypass: true,
        enabled_services: defaultServices,
        ..._adminPinPayload(),
      }),
    });
    const data = await res.json();
    if (!res.ok || data?.ok === false || data?.error) {
      showToast(data?.error || t("Не удалось сохранить настройки", "Failed to save setup"));
      return;
    }
    state.setupCompleted = true;
    if (data.user_country) state.userCountry = data.user_country;
    if (data.country_profile) state.countryProfile = data.country_profile;
    if (data.integrations) state.integrations = data.integrations;
    if (data.backup_stream?.mode) {
      const bkpEl = document.getElementById("cfg-backup-mode");
      if (bkpEl) {
        const rawM = data.backup_stream.mode;
        bkpEl.value =
          rawM === "debrid" || rawM === "debrid_https"
            ? data.backup_stream?.debrid_configured
              ? "realdebrid"
              : "torrserver"
            : rawM;
        syncCustomSelect(bkpEl);
      }
    }
    renderSettingsCountryUI();
    renderIntegrationsList();
    applyEnabledServicesVisibility();
    renderLoginBannerIfNeeded();
    closeOnboardingModal();
    await loadCatalog();
    showToast(t("Применены настройки по умолчанию", "Default settings applied"));
  } catch (_) {
    closeOnboardingModal();
  } finally {
    if (skipBtn) skipBtn.disabled = false;
  }
}

export async function submitOnboardingModal() {
  const btn = document.getElementById("btn-onboarding-finish");
  if (!btn || btn.disabled) return;
  const chosenCountry = String(
    document.getElementById("ob-country-select")?.value || state.onboardingDraftCountry || "PL"
  ).toUpperCase();
  const kinEnabled = Boolean(document.getElementById("ob-kinorium-enable")?.checked);
  const kinUserRaw = (document.getElementById("ob-kinorium-user")?.value || "").trim();
  const kinCookieRaw = (document.getElementById("ob-kinorium-cookie")?.value || "").trim();

  const enabledMap = {
    ...(state.onboardingDraftServices || {}),
    kinorium: kinEnabled,
  };
  const anyPlayableSource = Boolean(enabledMap.hdrezka || enabledMap.stremio || enabledMap.backup4k);
  if (!anyPlayableSource) {
    enabledMap.hdrezka = true;
  }

  btn.disabled = true;
  btn.textContent = t("Сохранение...", "Applying...");

  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_lang: state.appLang || "ru",
        user_country: chosenCountry,
        setup_completed: true,
        auto_adjust_bypass: true,
        enabled_services: enabledMap,
        ..._adminPinPayload(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data?.error || t("Не удалось сохранить настройки", "Failed to save setup"));
      return;
    }
    state.setupCompleted = true;
    if (data.user_country) state.userCountry = data.user_country;
    if (data.country_profile) state.countryProfile = data.country_profile;
    if (data.integrations) state.integrations = data.integrations;
    if (data.backup_stream?.mode) {
      const bkpEl = document.getElementById("cfg-backup-mode");
      if (bkpEl) {
        const rawM = data.backup_stream.mode;
        bkpEl.value =
          rawM === "debrid" || rawM === "debrid_https"
            ? data.backup_stream?.debrid_configured
              ? "realdebrid"
              : "torrserver"
            : rawM;
        syncCustomSelect(bkpEl);
      }
    }

    if (kinEnabled && (kinUserRaw || kinCookieRaw)) {
      btn.textContent = t("Синхронизация Kinorium...", "Syncing Kinorium...");
      const syncBody = { ..._adminPinPayload() };
      if (kinUserRaw) syncBody.user_id = kinUserRaw;
      if (kinCookieRaw) syncBody.session_cookie = kinCookieRaw;
      const syncRes = await fetch("/api/kinorium/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(syncBody),
      });
      const syncData = await syncRes.json();
      if (!syncRes.ok || syncData?.ok === false || syncData?.error) {
        showToast(
          syncData?.error ||
            syncData?.sync?.error ||
            t("Ошибка синхронизации Kinorium", "Kinorium sync error")
        );
      }
      if (syncData.kinorium_account) {
        state.kinoriumAccount = syncData.kinorium_account;
      }
      if (syncData.integrations) {
        state.integrations = syncData.integrations;
      }
      if (syncData.sync?.error) {
        showToast(`${t("Kinorium", "Kinorium")}: ${syncData.sync.error}`);
      }
    }

    updateKinoriumUserBadge();
    renderHeaderProfileSwitcher();
    renderSettingsCountryUI();
    renderIntegrationsList();
    applyEnabledServicesVisibility();
    renderLoginBannerIfNeeded();
    closeOnboardingModal();
    await loadCatalog();
    showToast(t("Настройка CineFlow завершена", "CineFlow setup completed"));
  } catch (_) {
    showToast(t("Не удалось сохранить настройки", "Failed to save setup"));
  } finally {
    btn.disabled = false;
    btn.textContent = t("Применить и начать", "Apply & Start");
  }
}
