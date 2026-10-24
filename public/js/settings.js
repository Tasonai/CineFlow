import {
  EPISODE_PROGRESS_STORAGE_KEY,
  PLAYER_PREFS_STORAGE_KEY,
  PREFERRED_STUDIOS_STORAGE_KEY,
  SEEN_NOTIFICATIONS_STORAGE_KEY,
  UI_PREFS_STORAGE_KEY,
  WATCH_HISTORY_STORAGE_KEY,
  state,
} from "./state.js?v=20261024v4";
import {
  applyStaticDomTranslations,
  syncLanguageSegmentedControlUI,
  t,
} from "./i18n.js?v=20261024v4";
import {
  escapeAttr,
  escapeHtml,
  getWatchHistoryList,
  iconSvg,
  saveUiPrefs,
  showConfirmModal,
  showToast,
  syncScrollTopButton,
} from "./utils.js?v=20261024v4";
import { applyAudioBoostToVideo, applySubtitleStylePrefs, getPlayerPrefs } from "./audio-dsp.js?v=20261024v4";
import {
  applyEnabledServicesVisibility,
  loadCatalog,
  renderCatalogShelves,
  renderContinueWatching,
  renderHero,
  renderLoginBannerIfNeeded,
  updateActiveFiltersBadge,
  updateDynamicCatalogFilters,
  updateFriendsFilterDropdown,
  updateKinoriumUserBadge,
} from "./catalog.js?v=20261024v4";
import { openQuickPeekModal, openStatsModal, refreshOpenPersonModalUI, syncModalBackButtons } from "./modals.js?v=20261024v4";
import { loadStremioStreams, refreshOpenPlayerLanguageUI, renderModalProvidersSidebar } from "./player.js?v=20261024v4";

export function applyAppLanguage(nextLang, options = {}) {
  const { persistServer = true, announce = false } = options;
  const norm = String(nextLang || "").toLowerCase().startsWith("en") ? "en" : "ru";
  const changed = state.appLang !== norm;
  state.appLang = norm;
  state.trailerLang = norm;
  saveUiPrefs({ appLang: norm });

  applyStaticDomTranslations();
  syncLanguageSegmentedControlUI();
  applyEnabledServicesVisibility();
  updateKinoriumUserBadge();
  updateDynamicCatalogFilters();
  updateFriendsFilterDropdown();
  renderLoginBannerIfNeeded();
  renderHero();
  renderContinueWatching();
  renderCatalogShelves();
  renderIntegrationsList();
  renderStremioAddonsList();
  renderTorrserverStatusText();
  renderSystemStatusUI();
  updateBackupSummaryStat();
  syncSettingsFooterUI();
  syncModalBackButtons();

  const searchPop = document.getElementById("search-live-popover");
  const searchInp = document.getElementById("global-search");
  if (searchPop && !searchPop.classList.contains("hidden") && searchInp && searchInp.value.trim().length >= 2) {
    searchInp.dispatchEvent(new Event("input"));
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

  if (persistServer) {
    fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_lang: norm }),
    }).catch(() => {});
  }
  if (changed) {
    loadCatalog();
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
    }),
  });
  const data = await res.json();
  if (data.integrations) {
    state.integrations = data.integrations;
    renderIntegrationsList();
    renderLoginBannerIfNeeded();
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
    }),
  });
  const data = await res.json();
  if (data.integrations) {
    state.integrations = data.integrations;
    renderIntegrationsList();
    renderLoginBannerIfNeeded();
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
      }),
    });
    const data = await res.json();
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
export function buildServiceToggleHtml(serviceId, isEnabled) {
  return `
    <label class="srv-toggle-wrap" title="${
      isEnabled
        ? t("Отключить сервис (скрыть во всём приложении)", "Disable service (hide across app)")
        : t("Включить отображение сервиса в приложении", "Enable service in app")
    }">
      <span class="srv-toggle-label">${isEnabled ? t("Включён", "On") : t("Выключен", "Off")}</span>
      <span class="srv-toggle">
        <input type="checkbox" class="srv-enable-checkbox" data-srv="${serviceId}" ${
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
      groupHead.textContent = t("Профиль и синхронизация", "Profile & Sync");
      listEl.appendChild(groupHead);
    } else if (key !== "kinorium" && !renderedVideoGroup) {
      renderedVideoGroup = true;
      const groupHead = document.createElement("div");
      groupHead.className = "integrations-group-label";
      groupHead.textContent = t("Сервисы для просмотра видео", "Video Streaming Services");
      listEl.appendChild(groupHead);
    }

    const isEnabled = integ.enabled !== false;
    const row = document.createElement("div");
    row.className = `integration-row${isEnabled ? "" : " is-disabled"}`;

    if (key === "hdrezka") {
      row.innerHTML = `
        <div class="integration-info">
          <div class="integration-name">
            <span>HDRezka</span>
            <span class="${isEnabled ? "status-badge-ok" : "status-badge-muted"}">
              ${isEnabled ? t("Без регистрации", "No account needed") : t("Отключено", "Disabled")}
            </span>
          </div>
          <div class="integration-status">
            ${
              isEnabled
                ? t(
                    "Встроенный обход Anubis PoW + фильтр заглушек Premium + прямой 1080p поток",
                    "Built-in Anubis PoW solver + Original audio + direct 1080p stream"
                  )
                : t(
                    "Сервис скрыт из верхнего меню, карточек, Hero и видеоплеера",
                    "Service hidden from navigation, cards, Hero, and video player"
                  )
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
          ? t(` · активно аддонов: ${activeAddonsCount}`, ` · ${activeAddonsCount} active addons`)
          : "";
      row.innerHTML = `
        <div class="integration-info">
          <div class="integration-name">
            <span>Stremio</span>
            <span class="${isEnabled ? "status-badge-ok" : "status-badge-muted"}">
              ${isEnabled ? t("Аддоны · Без регистрации", "Addons · No account needed") : t("Отключено", "Disabled")}
            </span>
          </div>
          <div class="integration-status">
            ${
              isEnabled
                ? `${t(
                    "Torrentio (RU + EN · 4K / 1080p), OpenSubtitles и свои manifest.json прямо внутри плеера",
                    "Torrentio (EN + RU · 4K / 1080p), OpenSubtitles & custom manifest.json inside native player"
                  )}${escapeHtml(addonsCountNote)}`
                : t(
                    "Вкладка Stremio и управление аддонами скрыты во всём приложении",
                    "Stremio tab and addon controls hidden across the app"
                  )
            }
          </div>
        </div>
        <div class="integration-actions">
          ${
            isEnabled
              ? `<button type="button" class="atv-btn-secondary atv-btn-xs btn-config-stremio">${t("Настроить аддоны", "Configure Addons")}</button>`
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
          <div class="integration-name">
            <span>4K Remux</span>
            <span class="${isEnabled ? "status-badge-ok" : "status-badge-muted"}">
              ${isEnabled ? "UHD HDR / TorrServer" : t("Отключено", "Disabled")}
            </span>
          </div>
          <div class="integration-status">
            ${
              isEnabled
                ? t(
                    "Прямые потоки 4K UHD HDR / BDRemux и подключение TorrServer без регистрации",
                    "Direct 4K UHD HDR / BDRemux streams via TorrServer or Cloud Debrid"
                  )
                : t(
                    "Кнопки и вкладки 4K Remux скрыты во всём приложении",
                    "4K Remux buttons and tabs hidden across the app"
                  )
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
      const shortProfileUrl = profileUrl.replace(/^https?:\/\//i, "").replace(/\/$/, "");
      const currentInputVal = acc.profile_url || acc.user_id || "";
      const cookieBadge =
        isEnabled && acc.has_session_cookie
          ? `<span class="status-badge-ok" title="${t("Оценки и статусы синхронизируются в облако Kinorium", "Ratings and statuses sync two-way with Kinorium cloud")}">${t("Куки активны", "Cookies active")}</span>`
          : "";
      const showFullForm = !isConnected || Boolean(state.kinoriumFormExpanded);
      const cookiePlaceholder = acc.has_session_cookie
        ? t("Куки активны (вставьте новые для замены)", "Cookies active (paste new to replace)")
        : t("Session Cookie (необязательно, для двусторонней записи)", "Session Cookie (optional, for two-way cloud write)");

      row.innerHTML = `
        <div class="kin-card-top">
          <div class="integration-info">
            <div class="integration-name">
              <span>Kinorium</span>
              <span class="${
                !isEnabled
                  ? "status-badge-muted"
                  : isConnected
                  ? "status-badge-ok"
                  : "status-badge-warn"
              }">
                ${
                  !isEnabled
                    ? t("Отключено", "Disabled")
                    : isConnected
                    ? `${t("Подключен", "Connected")}: ${escapeHtml(acc.display_name || "ID " + acc.user_id)}`
                    : t("Профиль не подключен", "Not connected")
                }
              </span>
              ${cookieBadge}
            </div>
            <div class="integration-status" title="${isConnected ? escapeAttr(profileUrl) : ""}">
              ${
                !isEnabled
                  ? t("Списки, оценки, друзья и кнопки Kinorium скрыты во всём приложении", "Kinorium lists, ratings, friends, and controls hidden across the app")
                  : isConnected
                  ? `${t("Профиль", "Profile")}: ${escapeHtml(shortProfileUrl)}`
                  : t("Введите ваш ID или ссылку на профиль Kinorium ниже, чтобы загрузить ваши списки и оценки", "Enter your Kinorium user ID or profile URL below to load your lists and ratings")
              }
            </div>
          </div>
          <div class="integration-actions">
            ${
              isEnabled && isConnected
                ? `<button class="atv-btn-secondary atv-btn-xs btn-login-srv"><span>${t("Открыть профиль", "Open Profile")}</span>${iconSvg("external", 11)}</button>`
                : ""
            }
            ${buildServiceToggleHtml(key, isEnabled)}
          </div>
        </div>
        ${
          !isEnabled
            ? ""
            : !showFullForm
            ? `
        <div class="kin-switcher-box is-compact">
          <div class="kin-compact-summary">
            <span>${t(
              "Списки «Смотрю», «Буду смотреть», «Просмотрено» и оценки друзей подключены",
              "Watching, Watchlist, Watched lists & friends' ratings connected"
            )}${
              acc.has_session_cookie ? t(" · двусторонняя запись включена", " · two-way sync enabled") : ""
            }</span>
            <div class="kin-compact-actions">
              <button type="button" class="atv-btn-secondary atv-btn-xs btn-expand-kin-form">
                ${t("Изменить профиль / куки", "Edit Profile / Cookies")}
              </button>
              <button type="button" class="atv-btn-primary atv-btn-xs btn-sync-kin-quick">
                ${iconSvg("refresh", 12)}<span>${t("Синхронизировать", "Sync Now")}</span>
              </button>
            </div>
          </div>
        </div>`
            : `
        <div class="kin-switcher-box">
          <div class="kin-switcher-hint">
            <strong>${t("Профиль и куки Kinorium:", "Kinorium Profile & Cookies:")}</strong> ${t(
              "укажите числовой ID (например, <code>51670</code>) или ссылку на профиль (<code>https://ru.kinorium.com/user/51670/</code>).",
              "enter your numeric ID (e.g. <code>51670</code>) or profile URL (<code>https://en.kinorium.com/user/51670/</code>)."
            )}${
              acc.has_session_cookie
                ? t(
                    " Сессионные куки уже сохранены и активны — оставьте второе поле пустым или вставьте новые куки для замены.",
                    " Session cookies are saved and active — leave the second field empty or paste new cookies to replace them."
                  )
                : ""
            }
          </div>
          <div class="kin-switcher-row">
            <input
              type="text"
              class="kin-switcher-input"
              id="kin-quick-user-input"
              value="${escapeAttr(currentInputVal)}"
              placeholder="${t("ID или ссылка, например 51670 или https://kinorium.com/user/51670/", "ID or URL, e.g. 51670 or https://en.kinorium.com/user/51670/")}"
            />
            <input
              type="password"
              class="kin-switcher-input"
              id="kin-quick-cookie-input"
              placeholder="${escapeAttr(cookiePlaceholder)}"
            />
          </div>
          <div class="kin-switcher-row" style="justify-content:flex-end;margin-top:2px;">
            ${
              isConnected
                ? `<button type="button" class="atv-btn-secondary atv-btn-xs btn-collapse-kin-form">
                    ${t("Свернуть", "Collapse")}
                  </button>
                  <button type="button" class="atv-btn-secondary atv-btn-xs atv-btn-danger-text btn-disconnect-kin">
                    ${t("Отключить профиль", "Disconnect Profile")}
                  </button>`
                : ""
            }
            <button type="button" class="atv-btn-primary atv-btn-xs btn-sync-kin">
              ${iconSvg("refresh", 12)}<span>${isConnected ? t("Сохранить и синхронизировать", "Save & Sync") : t("Подключить профиль Kinorium", "Connect Kinorium Profile")}</span>
            </button>
          </div>
        </div>`
        }
      `;

      const runKinSync = async (btn, rawInput, rawCookie) => {
        if (!rawInput) {
          showToast(t("Введите ID пользователя или ссылку на профиль Kinorium", "Enter your Kinorium user ID or profile URL"));
          row.querySelector("#kin-quick-user-input")?.focus();
          return;
        }
        const prevHtml = btn.innerHTML;
        btn.innerHTML = `${iconSvg("refresh", 12)}<span>${t("Синхронизация...", "Syncing...")}</span>`;
        btn.disabled = true;
        try {
          const payload = { user_id: rawInput };
          if (rawCookie) payload.session_cookie = rawCookie;
          const res = await fetch("/api/kinorium/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (data.kinorium_account) {
            state.kinoriumAccount = data.kinorium_account;
            updateKinoriumUserBadge();
          }
          if (data.integrations) state.integrations = data.integrations;
          if (!data.sync?.error) {
            state.kinoriumFormExpanded = false;
          }
          renderIntegrationsList();
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
            btn.innerHTML = prevHtml;
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
          const prevHtml = btn.innerHTML;
          btn.textContent = t("Сброс...", "Resetting...");
          btn.disabled = true;
          try {
            const res = await fetch("/api/kinorium/disconnect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            });
            const data = await res.json();
            if (data.kinorium_account) {
              state.kinoriumAccount = data.kinorium_account;
              updateKinoriumUserBadge();
            }
            if (data.integrations) state.integrations = data.integrations;
            renderIntegrationsList();
            syncSettingsFooterUI();
            await loadCatalog();
            showToast(t("Профиль Kinorium отключен и очищен для нового пользователя", "Kinorium profile disconnected"));
          } catch (err) {
            if (btn.isConnected) {
              btn.innerHTML = prevHtml;
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
            <span class="${
              !isEnabled
                ? "status-badge-muted"
                : integ.logged_in
                ? "status-badge-ok"
                : "status-badge-warn"
            }">
              ${!isEnabled ? t("Отключено", "Disabled") : integ.logged_in ? t("Подключено", "Connected") : t("Не выполнен вход", "Not signed in")}
            </span>
          </div>
          <div class="integration-status">
            ${
              !isEnabled
                ? t(
                    `Сервис ${escapeHtml(integ.name)} скрыт из верхнего меню, карточек и плеера`,
                    `${escapeHtml(integ.name)} is hidden from navigation, cards, and player`
                  )
                : integ.logged_in
                ? t("Подписка подтверждена — доступен быстрый переход из каталога и шапки", "Subscription active — quick launch enabled across catalog & header")
                : t("Официальный каталог и быстрый переход к просмотру по подписке", "Official catalog & quick subscription launch")
            }
          </div>
        </div>
        <div class="integration-actions">
          ${
            isEnabled
              ? `
            <button class="${
              !integ.logged_in && state.pendingServiceLogins?.[key] ? "atv-btn-secondary" : "atv-btn-primary"
            } atv-btn-xs btn-login-srv">
              ${
                integ.logged_in
                  ? t("Открыть сайт", "Open Site")
                  : state.pendingServiceLogins?.[key]
                  ? t("Открыть снова", "Open Again")
                  : t("Войти в аккаунт", "Sign in")
              }
            </button>
            ${
              !integ.logged_in && state.pendingServiceLogins?.[key]
                ? `<button class="atv-btn-primary atv-btn-xs btn-confirm-srv">${t("Подтвердить вход", "Confirm Sign-in")}</button>`
                : ""
            }
            ${
              integ.logged_in
                ? `<button class="atv-btn-secondary atv-btn-xs btn-logout-srv">${t("Выйти", "Sign out")}</button>`
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
    const raw = JSON.parse(localStorage.getItem(PREFERRED_STUDIOS_STORAGE_KEY) || "{}") || {};
    studiosCount = Object.keys(raw).length;
  } catch (_) {}
  const histCount = getWatchHistoryList().length;
  const c = state.kinoriumCounts || {};
  const cwCount = (state.continueWatching || []).length;
  el.textContent = t(
    `В текущей базе: просмотрено ${c.watched || 0}, смотрю ${c.watching || 0}, буду смотреть ${c.watchlist || 0}, продолжить просмотр ${cwCount}, история ${histCount}, сохранённых озвучек ${studiosCount}.`,
    `Current database: watched ${c.watched || 0}, watching ${c.watching || 0}, watchlist ${c.watchlist || 0}, continue watching ${cwCount}, history ${histCount}, saved audio choices ${studiosCount}.`
  );
}
export async function buildFullBackupPayload() {
  const res = await fetch("/api/backup/export");
  const payload = await res.json();
  let preferredStudios = {};
  let playerPrefs = {};
  let seenNotifications = [];
  let uiPrefs = {};
  let episodeProgress = {};
  let watchHistory = [];
  try {
    preferredStudios = JSON.parse(localStorage.getItem(PREFERRED_STUDIOS_STORAGE_KEY) || "{}") || {};
  } catch (_) {}
  try {
    playerPrefs = JSON.parse(localStorage.getItem(PLAYER_PREFS_STORAGE_KEY) || "{}") || {};
  } catch (_) {}
  try {
    seenNotifications = JSON.parse(localStorage.getItem(SEEN_NOTIFICATIONS_STORAGE_KEY) || "[]") || [];
  } catch (_) {}
  try {
    uiPrefs = JSON.parse(localStorage.getItem(UI_PREFS_STORAGE_KEY) || "{}") || {};
  } catch (_) {}
  try {
    episodeProgress = JSON.parse(localStorage.getItem(EPISODE_PROGRESS_STORAGE_KEY) || "{}") || {};
  } catch (_) {}
  try {
    watchHistory = getWatchHistoryList();
  } catch (_) {}
  payload.client_storage = {
    preferred_studios: preferredStudios,
    player_prefs: playerPrefs,
    seen_notifications: seenNotifications,
    ui_prefs: uiPrefs,
    episode_progress: episodeProgress,
    watch_history: watchHistory,
  };
  return payload;
}
export async function restoreFromBackupObject(parsed) {
  if (!parsed || typeof parsed !== "object") {
    showToast(t("Неверный формат резервной копии", "Invalid backup format"));
    return false;
  }
  if (parsed.client_storage && typeof parsed.client_storage === "object") {
    const cs = parsed.client_storage;
    if (cs.preferred_studios && typeof cs.preferred_studios === "object") {
      localStorage.setItem(PREFERRED_STUDIOS_STORAGE_KEY, JSON.stringify(cs.preferred_studios));
    }
    if (cs.player_prefs && typeof cs.player_prefs === "object") {
      localStorage.setItem(PLAYER_PREFS_STORAGE_KEY, JSON.stringify(cs.player_prefs));
      const prefs = getPlayerPrefs();
      state.autoNextEpisode = prefs.autoNextEpisode;
      state.audioBoost = prefs.audioBoost;
      state.audioPreset = prefs.audioPreset;
      state.ambilightEnabled = prefs.ambilightEnabled;
      const autoNextEl = document.getElementById("auto-next-ep-toggle");
      if (autoNextEl) autoNextEl.checked = Boolean(state.autoNextEpisode);
      const ambiToggle = document.getElementById("ambilight-toggle");
      if (ambiToggle) ambiToggle.checked = Boolean(state.ambilightEnabled);
      const video = document.getElementById("native-video");
      applyAudioBoostToVideo(video, state.audioBoost, state.audioPreset);
      applySubtitleStylePrefs(prefs.subSize, prefs.subBg);
    }
    if (Array.isArray(cs.seen_notifications)) {
      localStorage.setItem(SEEN_NOTIFICATIONS_STORAGE_KEY, JSON.stringify(cs.seen_notifications));
    }
    if (cs.ui_prefs && typeof cs.ui_prefs === "object") {
      localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(cs.ui_prefs));
      state.hideWatched = Boolean(cs.ui_prefs.hideWatched);
      document.getElementById("btn-hide-watched")?.classList.toggle("active", state.hideWatched);
      if (cs.ui_prefs.appLang === "en" || cs.ui_prefs.appLang === "ru") {
        applyAppLanguage(cs.ui_prefs.appLang, { persistServer: false, announce: false });
      }
      updateActiveFiltersBadge();
    }
    if (cs.episode_progress && typeof cs.episode_progress === "object") {
      localStorage.setItem(EPISODE_PROGRESS_STORAGE_KEY, JSON.stringify(cs.episode_progress));
    }
    if (Array.isArray(cs.watch_history)) {
      localStorage.setItem(WATCH_HISTORY_STORAGE_KEY, JSON.stringify(cs.watch_history.slice(0, 150)));
    }
  }
  if (parsed.app_lang === "en" || parsed.app_lang === "ru") {
    applyAppLanguage(parsed.app_lang, { persistServer: false, announce: false });
  }
  const res = await fetch("/api/backup/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    showToast(`${t("Ошибка импорта", "Import error")}: ${data.error || t("Неверный формат файла", "Invalid file")}`);
    return false;
  }
  if (data.kinorium_account) {
    state.kinoriumAccount = data.kinorium_account;
    updateKinoriumUserBadge();
  }
  await loadCatalog();
  try {
    const aRes = await fetch("/api/stremio/addons");
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
export function isNetworkSettingsDirty() {
  const base = state.settingsBaseline;
  if (!base) return isKinoriumQuickFormDirty();
  const cur = getNetworkSettingsSnapshot();
  return (
    cur.spoof_region !== base.spoof_region ||
    cur.custom_mirror !== base.custom_mirror ||
    cur.proxy_url !== base.proxy_url ||
    cur.backup_mode !== base.backup_mode ||
    cur.torrserver_url !== base.torrserver_url ||
    cur.debrid_key.length > 0 ||
    isKinoriumQuickFormDirty()
  );
}
export function syncSettingsFooterUI() {
  const saveBtn = document.getElementById("save-settings-btn");
  if (!saveBtn) return;
  const dirty = isNetworkSettingsDirty();
  saveBtn.textContent = dirty ? t("Сохранить изменения", "Save Changes") : t("Готово", "Done");
}
export function renderTorrserverStatusText() {
  const torrStatusEl = document.getElementById("cfg-torrserver-status");
  if (!torrStatusEl) return;
  const tConn = Boolean(state.torrserverConnected);
  const rAvail = Boolean(state.remuxAvailable);
  const hwTag = state.hwAccelSummary ? ` (${state.hwAccelSummary})` : "";
  torrStatusEl.textContent = tConn
    ? t(
        `TorrServer подключен${rAvail ? ` · Аппаратный ремукс звука активен${hwTag}` : ""}`,
        `TorrServer connected${rAvail ? ` · Hardware audio remux active${hwTag}` : ""}`
      )
    : t(
        "TorrServer запускается автоматически при открытии вкладки Stremio или 4K",
        "TorrServer starts automatically when opening Stremio or 4K"
      );
  torrStatusEl.style.color = tConn ? "#6ee7b7" : "rgba(235, 235, 245, 0.65)";
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

  const lanOn = Boolean(sys.lan_enabled);
  if (lanToggle) lanToggle.checked = lanOn;
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
  }
}

export async function toggleLanAccess(enabled) {
  try {
    const res = await fetch("/api/system/lan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: Boolean(enabled) }),
    });
    const data = await res.json();
    if (data?.system) {
      state.systemStatus = data.system;
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
  try {
    const res = await fetch("/api/system/autostart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: Boolean(enabled) }),
    });
    const data = await res.json();
    if (data?.system) {
      state.systemStatus = data.system;
      renderSystemStatusUI();
    }
    showToast(
      enabled
        ? t("Автозапуск CineFlow при входе в macOS включен", "CineFlow macOS login autostart enabled")
        : t("Автозапуск CineFlow при входе в macOS отключен", "CineFlow macOS login autostart disabled")
    );
  } catch (_) {
    showToast(t("Не удалось обновить LaunchAgent macOS", "Failed to update macOS LaunchAgent"));
    renderSystemStatusUI();
  }
}
export async function openSettingsModal(initialTab = "integrations", focusKinoriumInput = false) {
  const res = await fetch("/api/settings");
  const cfg = await res.json();
  if (cfg.integrations) {
    state.integrations = cfg.integrations;
  }
  if (Array.isArray(cfg.stremio_addons)) {
    state.stremioAddons = cfg.stremio_addons;
  }
  if (cfg.kinorium) {
    state.kinoriumAccount = {
      user_id: cfg.kinorium.user_id || "",
      display_name: cfg.kinorium.display_name || cfg.kinorium.username || "",
      profile_url: cfg.kinorium.profile_url || "",
      connected: Boolean((cfg.kinorium.logged_in ?? cfg.kinorium.connected) && cfg.kinorium.user_id),
      has_session_cookie: Boolean(cfg.kinorium.has_session_cookie || cfg.kinorium.session_cookie),
    };
    updateKinoriumUserBadge();
  }
  document.getElementById("cfg-spoof-region").value = cfg.hdrezka?.spoof_region || "KZ";
  document.getElementById("cfg-custom-mirror").value = cfg.hdrezka?.custom_mirror || "";
  document.getElementById("cfg-proxy-url").value = cfg.hdrezka?.proxy_url || "";
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
      (cfg.hdrezka?.custom_mirror || "").trim() || (cfg.hdrezka?.proxy_url || "").trim()
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
      ? t("Ключ Debrid сохранен (вставьте новый для замены)", "Debrid key saved (paste new to replace)")
      : t("Оставьте пустым при работе через встроенный TorrServer", "Leave empty when using built-in TorrServer");
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
  }
}

export function renderStremioAddonsList() {
  const listEl = document.getElementById("stremio-addons-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  const addons = Array.isArray(state.stremioAddons) ? state.stremioAddons : [];
  if (addons.length === 0) {
    listEl.innerHTML = `<div style="font-size:12px;color:rgba(235,235,245,0.5);">${t("Нет установленных аддонов Stremio. Добавьте ссылку на manifest.json выше.", "No Stremio addons installed. Add a manifest.json URL above.")}</div>`;
    return;
  }
  const resMap = {
    stream: t("Видеопотоки", "Streams"),
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
    const row = document.createElement("div");
    row.className = `atv-stremio-addon-row${isEnabled ? "" : " is-disabled"}`;
    row.innerHTML = `
      <div class="atv-stremio-addon-info">
        <div class="atv-stremio-addon-title">
          <span>${escapeHtml(addon.name || addon.id)}</span>
          ${
            resourcesText
              ? `<span class="atv-stremio-badge is-addon">${escapeHtml(resourcesText)}</span>`
              : ""
          }
          ${
            addon.builtin
              ? `<span class="atv-stremio-badge">${t("Встроенный", "Built-in")}</span>`
              : `<span class="atv-stremio-badge is-ru">${t("Пользовательский", "Custom")}</span>`
          }
        </div>
        <div class="atv-stremio-addon-sub" title="${escapeAttr(addon.manifest_url || "")}">
          ${escapeHtml(addon.description || addon.manifest_url || "")}
        </div>
      </div>
      <div class="atv-stremio-addon-actions">
        ${
          !addon.builtin
            ? `<button type="button" class="atv-btn-secondary atv-btn-xs atv-btn-danger-text btn-remove-stremio-addon" title="${t("Удалить аддон", "Remove addon")}">${t("Удалить", "Remove")}</button>`
            : ""
        }
        <label class="srv-toggle-wrap" title="${isEnabled ? t("Отключить аддон", "Disable addon") : t("Включить аддон", "Enable addon")}">
          <span class="srv-toggle">
            <input type="checkbox" class="stremio-addon-toggle" ${isEnabled ? "checked" : ""} />
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
            body: JSON.stringify({ action: "toggle", id: addon.id, enabled: nextVal }),
          });
          const data = await res.json();
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
            body: JSON.stringify({ action: "remove", id: addon.id }),
          });
          const data = await res.json();
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
      body: JSON.stringify({ action: "add", manifest_url: rawUrl }),
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
  const target = ["integrations", "network", "backup"].includes(stab) ? stab : "integrations";
  state.activeSettingsTab = target;
  document.querySelectorAll("#settings-tabs .settings-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.stab === target);
  });
  document.getElementById("stab-integrations")?.classList.toggle("hidden", target !== "integrations");
  document.getElementById("stab-network")?.classList.toggle("hidden", target !== "network");
  document.getElementById("stab-backup")?.classList.toggle("hidden", target !== "backup");
  if (target === "backup") {
    updateBackupSummaryStat();
  }
  syncSettingsFooterUI();
}
