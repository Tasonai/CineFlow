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
} from "./state.js?v=20261105v2";
import { isEn, t } from "./i18n.js?v=20261105v2";
import {
  escapeHtml,
  getWatchHistoryList,
  invalidateLocalCaches,
  showToast,
} from "./utils.js?v=20261105v2";
import { applyEnabledServicesVisibility } from "./catalog-media-resolver.js?v=20261105v2";
import { renderNotificationsBell } from "./catalog-notifications.js?v=20261105v2";
import { updateActiveFiltersBadge } from "./catalog-filters.js?v=20261105v2";
import { loadCatalog, updateKinoriumUserBadge } from "./catalog.js?v=20261105v2";
import {
  applyProfilesPayload,
  ensureKidsPinVerifiedForAdminAction,
  promptKidsPinModal,
  reloadProfileLocalPlayerPrefs,
} from "./features.js?v=20261105v2";
import {
  _adminPinPayload,
  applyAppLanguage,
  renderIntegrationsList,
  renderStremioAddonsList,
} from "./settings.js?v=20261105v2";

export function updateBackupSummaryStat() {
  const el = document.getElementById("backup-summary-stat");
  if (!el) return;
  let studiosCount = 0;
  try {
    const raw = JSON.parse(localStorage.getItem(profileStorageKey(PREFERRED_STUDIOS_STORAGE_KEY)) || "{}") || {};
    studiosCount = Object.keys(raw).length;
  } catch (err) { window.logDebug?.("Settings", err); }
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
  } catch (err) { window.logDebug?.("Settings", err); }
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
  } catch (err) { window.logDebug?.("Settings", err); }

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
    const legacyTargetPid = hasMultiProfileLocal ? "main" : state.activeProfileId || "main";
    _writeProfileLocalBundle(legacyTargetPid, cs);
    if (cs.ui_prefs && typeof cs.ui_prefs === "object") {
      try {
        localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(cs.ui_prefs));
      } catch (err) { window.logDebug?.("Settings", err); }
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
  } catch (err) { window.logDebug?.("Settings", err); }
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
  } catch (err) { window.logDebug?.("Settings", err); }
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
      } catch (err) { window.logDebug?.("Settings", err); }
    }, 750);
  } catch (_) {
    showToast(t("Не удалось начать загрузку обновления", "Could not start update download"));
  }
}

export async function handleExportBackup(btnEl) {
  if (btnEl) btnEl.disabled = true;
  try {
    const payload = await buildFullBackupPayload();
    if (!payload) return;
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `cineflow-backup-${dateStamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast(t("Резервная копия сохранена в файл JSON", "Backup saved to JSON file"));
  } catch (err) {
    console.error("Export backup error:", err);
    showToast(t("Ошибка при экспорте резервной копии", "Failed to export backup"));
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

export function openManualBackupPasteBox() {
  const parentTab = document.getElementById("stab-backup");
  if (!parentTab) return;
  let pasteBox = document.getElementById("backup-manual-paste-box");
  if (!pasteBox) {
    pasteBox = document.createElement("div");
    pasteBox.id = "backup-manual-paste-box";
    pasteBox.className = "atv-backup-paste-box";
    pasteBox.innerHTML = `
      <div class="atv-backup-paste-label">${escapeHtml(
        t(
          "Вставьте JSON резервной копии CineFlow ниже и нажмите «Восстановить»:",
          "Paste your CineFlow backup JSON below and click Restore:"
        )
      )}</div>
      <textarea id="backup-manual-paste-textarea" class="atv-backup-paste-textarea" rows="4" placeholder="{ &quot;app&quot;: &quot;CineFlow&quot;, ... }"></textarea>
      <div class="atv-backup-paste-actions">
        <button type="button" class="atv-btn-secondary atv-btn-xs" id="btn-cancel-backup-paste">${escapeHtml(
          t("Отмена", "Cancel")
        )}</button>
        <button type="button" class="atv-btn-primary atv-btn-xs" id="btn-apply-backup-paste">${escapeHtml(
          t("Восстановить", "Restore")
        )}</button>
      </div>
    `;
    parentTab.appendChild(pasteBox);
    pasteBox.querySelector("#btn-cancel-backup-paste")?.addEventListener("click", () => {
      pasteBox.classList.add("hidden");
    });
    pasteBox.querySelector("#btn-apply-backup-paste")?.addEventListener("click", async () => {
      const ta = pasteBox.querySelector("#backup-manual-paste-textarea");
      const rawText = (ta?.value || "").trim();
      if (!rawText) {
        ta?.focus();
        return;
      }
      try {
        const parsed = JSON.parse(rawText);
        const ok = await restoreFromBackupObject(parsed);
        if (ok) {
          if (ta) ta.value = "";
          pasteBox.classList.add("hidden");
        }
      } catch (_) {
        showToast(
          t(
            "Текст не является корректным JSON резервной копии CineFlow",
            "Text is not a valid CineFlow backup JSON"
          )
        );
      }
    });
  }
  pasteBox.classList.remove("hidden");
  const ta = pasteBox.querySelector("#backup-manual-paste-textarea");
  if (ta) {
    ta.focus();
  }
}
