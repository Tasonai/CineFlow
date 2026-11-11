// ============================================================================
// 6. TV CAST & AIRPLAY / DLNA / REMOTE LINK
// ============================================================================

import { state } from "./state.js?v=20261111v1";
import { displayTitle, t, translateStudioName } from "./i18n.js?v=20261111v1";
import {
  closeCustomSelectMenu,
  closeFloatingPopovers,
  escapeAttr,
  escapeHtml,
  formatTime,
  iconSvg,
  rememberModalTriggerFocus,
  restoreModalTriggerFocus,
  showToast,
  syncScrollTopButton,
} from "./utils.js?v=20261111v1";
import { resolvePreferredPlayTab } from "./catalog.js?v=20261111v1";
import { openQuickPeekModal } from "./modals.js?v=20261111v1";
import {
  getEffectivePlaybackTiming,
  openPlayerModal,
} from "./player.js?v=20261111v1";
import { switchCastModalTab } from "./remote.js?v=20261111v1";
import { toggleLanAccess } from "./settings.js?v=20261111v1";
import { toggleTvMode } from "./features-tv-mode.js?v=20261111v1";
import { exitBrowserFullscreenIfNeeded } from "./features.js?v=20261111v1";


export function supportsWebkitAirPlay() {
  const video = document.getElementById("native-video");
  return Boolean(video && typeof video.webkitShowPlaybackTargetPicker === "function");
}

export function triggerNativeAirPlayPicker() {
  const video = document.getElementById("native-video");
  if (video && typeof video.webkitShowPlaybackTargetPicker === "function") {
    try {
      video.webkitShowPlaybackTargetPicker();
      return true;
    } catch (err) { window.logDebug?.("FeaturesCast", err); }
  }
  showToast(
    t(
      "Системное меню AirPlay доступно в Velarium.app и Safari на macOS — используйте QR-код или DLNA ниже",
      "Native AirPlay picker is available in Velarium.app and Safari on macOS — use QR code or DLNA below"
    )
  );
  return false;
}

export async function openTvCastModal(eventOrTab = null, explicitTab = "", contextItem = null) {
  const isEventObj = Boolean(
    eventOrTab && typeof eventOrTab === "object" && ("altKey" in eventOrTab || "target" in eventOrTab)
  );
  if (isEventObj && eventOrTab.altKey && supportsWebkitAirPlay()) {
    triggerNativeAirPlayPicker();
    return;
  }
  state.tvCastContextItem =
    contextItem ||
    (state.isPlayerOpen && state.activeItem ? state.activeItem : state.quickPeekItem || null);
  const requestedTab =
    typeof eventOrTab === "string" && eventOrTab
      ? eventOrTab
      : explicitTab || state.remoteCastTab || "phone";
  const modal = document.getElementById("tv-cast-modal");
  if (!modal) return;
  closeFloatingPopovers();
  exitBrowserFullscreenIfNeeded();
  const wasHidden = modal.classList.contains("hidden");
  if (wasHidden) {
    rememberModalTriggerFocus("tv-cast-modal");
  }
  modal.classList.remove("hidden");
  if (wasHidden) {
    requestAnimationFrame(() => {
      document.getElementById("close-tv-cast-modal")?.focus({ preventScroll: true });
    });
  }
  syncScrollTopButton();
  switchCastModalTab(requestedTab);
  renderTvCastModalUI(true);
  await refreshTvDevices(false);
}

let _tvDevicesAbortController = null;
let _handoffAbortController = null;

export function closeTvCastModal() {
  if (_tvDevicesAbortController) {
    try {
      _tvDevicesAbortController.abort();
    } catch (_) {}
    _tvDevicesAbortController = null;
  }
  const modal = document.getElementById("tv-cast-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  closeCustomSelectMenu({ restoreFocus: false });
  modal.classList.add("hidden");
  syncScrollTopButton();
  restoreModalTriggerFocus("tv-cast-modal");
}

export async function refreshTvDevices(forceScan = false) {
  if (_tvDevicesAbortController) {
    try {
      _tvDevicesAbortController.abort();
    } catch (_) {}
  }
  const tvAbort = new AbortController();
  _tvDevicesAbortController = tvAbort;
  renderTvCastModalUI(true);
  try {
    const qs = new URLSearchParams();
    if (forceScan) qs.set("force", "1");
    const castItem =
      (state.isPlayerOpen && state.activeItem?.id ? state.activeItem : null) ||
      (state.tvCastContextItem?.id ? state.tvCastContextItem : null);
    if (castItem?.id) {
      const it = castItem;
      qs.set("id", String(it.id));
      qs.set("title", String(it.title || displayTitle(it) || "Velarium"));
      if (it.orig_title) qs.set("orig_title", String(it.orig_title));
      if (it.year) qs.set("year", String(it.year));
      if (it.media_type) qs.set("media_type", String(it.media_type));
      const kinId = it.kinorium?.kinorium_id || it.kinorium_id || "";
      if (kinId) qs.set("kinorium_id", String(kinId));
      if (it.rezka_id) qs.set("rezka_id", String(it.rezka_id));
      if (it.rezka_url) qs.set("rezka_url", String(it.rezka_url));
      if (it.poster) qs.set("poster", String(it.poster));
      if (it.backdrop) qs.set("backdrop", String(it.backdrop));
      if (Array.isArray(it.genres) && it.genres.length > 0) {
        qs.set("genres", it.genres.join(","));
      }
      const ageRating = String(it.age_rating || it.mpaa || "").trim();
      if (ageRating) {
        qs.set("age_rating", ageRating);
      }
      if (it.media_type === "series") {
        qs.set("season", String(state.activeSeason || 1));
        qs.set("episode", String(state.activeEpisode || 1));
      }
    }
    const res = await fetch(`/api/tv/devices?${qs.toString()}`, {
      signal: tvAbort.signal,
    });
    if (!res.ok) return;
    const data = await res.json();
    state.tvDevices = Array.isArray(data.devices) ? data.devices : [];
    state.tvActiveCast = data.active_cast || null;
    state.tvQrSvg = data.qr_svg || "";
    state.tvUrl = data.tv_url || "";
    state.tvLanEnabled = Boolean(data.lan_enabled);
    state.tvIsLocalClient = data.is_local_client !== false;
    renderTvCastModalUI(false);
  } catch (err) {
    if (err && err.name === "AbortError") return;
    renderTvCastModalUI(false);
  }
}

export function renderTvCastModalUI(scanning = false) {
  const airplayBtn = document.getElementById("btn-tv-airplay-picker");
  const qrBox = document.getElementById("tv-cast-qr-box");
  const urlLabel = document.getElementById("tv-cast-lan-url");
  const lanCallout = document.getElementById("tv-cast-lan-callout");
  const devListEl = document.getElementById("tv-cast-devices-list");
  const activeBar = document.getElementById("tv-cast-active-bar");
  const activeText = document.getElementById("tv-cast-active-text");

  if (airplayBtn) {
    airplayBtn.classList.toggle("is-supported", supportsWebkitAirPlay());
  }

  if (qrBox) {
    qrBox.innerHTML = state.tvQrSvg
      ? state.tvQrSvg
      : `<div class="atv-tv-qr-placeholder">${t("Генерация QR...", "Generating QR...")}</div>`;
  }
  if (urlLabel) {
    urlLabel.textContent = state.tvUrl || window.location.origin;
  }

  if (lanCallout) {
    const lanActive = Boolean(state.tvLanEnabled || state.systemStatus?.lan_enabled);
    lanCallout.classList.remove("hidden");
    lanCallout.classList.toggle("is-ready", lanActive);
    if (lanActive) {
      lanCallout.innerHTML = `
        <span>${t(
          "Доступ по Wi-Fi включён — сканируйте QR-код камерой телефона или Smart TV",
          "Wi-Fi access is active — scan the QR code with your phone or Smart TV"
        )}</span>
      `;
    } else {
      const canEnable = state.tvIsLocalClient !== false && state.systemStatus?.is_local_client !== false;
      lanCallout.innerHTML = `
        <span>${t(
          "Доступ по Wi-Fi сейчас выключен (сервер открыт только на этом компьютере). Включите его, чтобы телевизор или телефон открыл QR-ссылку:",
          "Home Wi-Fi access is currently off (server listens on 127.0.0.1 only). Enable it so your TV or phone can open the QR link:"
        )}</span>
        ${
          canEnable
            ? `<button type="button" class="atv-btn-primary atv-btn-xs" id="btn-tv-enable-lan">
                 ${iconSvg("wifi", 12)}
                 <span>${t("Включить доступ по Wi-Fi", "Enable Wi-Fi Access")}</span>
               </button>`
            : ""
        }
      `;
      lanCallout.querySelector("#btn-tv-enable-lan")?.addEventListener("click", async (ev) => {
        ev.currentTarget.disabled = true;
        await toggleLanAccess(true);
        state.tvLanEnabled = Boolean(state.systemStatus?.lan_enabled);
        await refreshTvDevices(false);
      });
    }
  }

  if (activeBar && activeText) {
    if (state.tvActiveCast && state.tvActiveCast.device_name) {
      activeBar.classList.remove("hidden");
      activeText.textContent = t(
        `Активна передача на ${state.tvActiveCast.device_name}: «${state.tvActiveCast.title || "Velarium"}»`,
        `Casting to ${state.tvActiveCast.device_name}: "${state.tvActiveCast.title || "Velarium"}"`
      );
    } else {
      activeBar.classList.add("hidden");
    }
  }

  if (!devListEl) return;
  if (scanning && (!state.tvDevices || state.tvDevices.length === 0)) {
    devListEl.innerHTML = `
      <div class="atv-tv-empty">
        ${t("Поиск телевизоров Smart TV (DLNA / UPnP) в вашей Wi-Fi сети...", "Scanning Wi-Fi network for Smart TVs (DLNA / UPnP)...")}
      </div>
    `;
    return;
  }

  if (!state.tvDevices || state.tvDevices.length === 0) {
    devListEl.innerHTML = `
      <div class="atv-tv-empty">
        ${t(
          "Устройства DLNA не ответили — наведите камеру телефона или браузер Smart TV на QR-код слева либо используйте AirPlay для Apple TV.",
          "No DLNA renderers responded — scan the QR code on your Smart TV / phone or use AirPlay for Apple TV."
        )}
      </div>
    `;
    return;
  }

  const canCastStream = Boolean(
    state.isPlayerOpen &&
      state.activeItem &&
      state.activeSourceTab !== "trailer" &&
      (state.currentStreamUrl || state.remuxMeta?.rawSourceUrl)
  );

  devListEl.innerHTML = state.tvDevices
    .map((dev, idx) => {
      const subInfo = [dev.manufacturer, dev.model, dev.host].filter(Boolean).join(" · ");
      return `
        <div class="atv-tv-dev-row">
          <div class="atv-tv-dev-info">
            <div class="atv-tv-dev-name">${iconSvg("tv", 14)}<span>${escapeHtml(dev.name || "Smart TV")}</span></div>
            <div class="atv-tv-dev-sub">${escapeHtml(subInfo || "UPnP AVTransport")}</div>
          </div>
          <button
            type="button"
            class="atv-btn-primary atv-btn-xs"
            data-cast-dev-idx="${idx}"
            ${canCastStream ? "" : "disabled"}
            title="${escapeAttr(
              canCastStream
                ? t("Передать текущий видеопоток напрямую на телевизор", "Cast current video stream directly to TV")
                : t("Сначала откройте фильм или серию в плеере", "Open a movie or episode in the player first")
            )}"
          >
            ${iconSvg("cast", 12)}
            <span>${canCastStream ? t("Передать поток", "Cast Stream") : t("Откройте видео", "Open Video")}</span>
          </button>
        </div>
      `;
    })
    .join("");

  devListEl.querySelectorAll("[data-cast-dev-idx]").forEach((btn) => {
    btn.onclick = () => {
      const dev = state.tvDevices[Number(btn.dataset.castDevIdx)];
      if (dev) castCurrentStreamToDlna(dev, btn);
    };
  });
}

export async function castCurrentStreamToDlna(device, btn = null) {
  if (!device || !state.isPlayerOpen || !state.activeItem) return;
  const video = document.getElementById("native-video");
  const { cur } = getEffectivePlaybackTiming(video);
  const streamUrl = state.currentStreamUrl;
  if (!streamUrl) {
    showToast(t("Поток ещё загружается — подождите секунду", "Stream is still loading — wait a moment"));
    return;
  }

  const activeSub =
    state.activeSubtitleIndex >= 0 ? (state.subtitles || [])[state.activeSubtitleIndex] : null;
  const rawSubUrl = String(activeSub?.url || "").trim();
  const subUrl =
    rawSubUrl &&
    !activeSub?.direct_vtt &&
    !rawSubUrl.startsWith("/api/proxy-vtt?") &&
    !rawSubUrl.startsWith("/api/remux-subtitle?") &&
    !rawSubUrl.startsWith("/api/downloads/sub/")
      ? `/api/proxy-vtt?url=${encodeURIComponent(rawSubUrl)}`
      : rawSubUrl;
  const titleLabel =
    state.activeItem.media_type === "series"
      ? `${displayTitle(state.activeItem)} · S${state.activeSeason}E${state.activeEpisode}`
      : displayTitle(state.activeItem);

  const wantBurnSubs = Boolean(subUrl && state.tvBurnSubtitles !== false);
  if (btn) btn.disabled = true;
  try {
    const res = await fetch("/api/tv/cast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: state.activeItem.id || "",
        item_title: state.activeItem.title || "",
        orig_title: state.activeItem.orig_title || "",
        media_type: state.activeItem.media_type || "movie",
        control_url: device.control_url,
        service_type: device.service_type || "",
        device_name: device.name || "Smart TV",
        stream_url: streamUrl,
        subtitle_url: subUrl,
        burn_subtitles: wantBurnSubs,
        title: titleLabel,
        start_sec: cur > 5 ? cur : 0,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showToast(data.error || t("Телевизор отклонил поток DLNA", "TV rejected DLNA stream"));
      return;
    }
    state.tvActiveCast = data.active_cast || data.cast || {
      device_name: device.name,
      control_url: device.control_url,
      title: titleLabel,
    };
    if (video && !video.paused) {
      video.pause();
    }
    renderTvCastModalUI(false);
    showToast(
      t(
        `Поток отправлен на телевизор «${device.name}»`,
        `Stream sent to "${device.name}"`
      )
    );
  } catch (_) {
    showToast(t("Не удалось отправить поток на Smart TV", "Failed to send stream to Smart TV"));
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function stopActiveDlnaCast() {
  try {
    const res = await fetch("/api/tv/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ control_url: state.tvActiveCast?.control_url || "" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      showToast(data?.error || t("Не удалось остановить трансляцию", "Could not stop TV cast"));
      return;
    }
    state.tvActiveCast = null;
    renderTvCastModalUI(false);
    showToast(t("Воспроизведение на телевизоре остановлено", "TV playback stopped"));
  } catch (err) { window.logDebug?.("FeaturesCast", err); }
}

export function parseInitialTvUrlParams() {
  if (typeof window === "undefined") return;
  try {
    const qs = new URLSearchParams(window.location.search || "");
    const pairKey = (qs.get("k") || "").trim();
    if (pairKey) {
      try {
        window.sessionStorage.setItem("velarium_remote_key", pairKey);
      } catch (err) { window.logDebug?.("FeaturesCast", err); }
    }
    if (qs.get("tv") === "1") {
      toggleTvMode(true, true);
    }
    const playId = (qs.get("p") || "").trim();
    const sharedId = (qs.get("id") || "").trim();
    const sharedTitle = (qs.get("title") || "").trim();
    if (playId || sharedId || sharedTitle || pairKey) {
      if (playId || sharedId || sharedTitle) {
        state.pendingTvDeepLink = {
          id: playId || sharedId,
          title: sharedTitle,
          mode: playId ? "play" : "peek",
          season: Math.max(1, parseInt(qs.get("s") || "1", 10) || 1),
          episode: Math.max(1, parseInt(qs.get("e") || "1", 10) || 1),
          startSec: Math.max(0, parseFloat(qs.get("t") || "0") || 0),
          tab: (qs.get("tab") || "").trim(),
          studioId: (qs.get("tr") || "").trim(),
          tr: (qs.get("tr") || "").trim(),
        };
      }
      const cleanUrl = window.location.pathname + (qs.get("tv") === "1" ? "?tv=1" : "");
      window.history.replaceState({}, "", cleanUrl);
    }
  } catch (err) { window.logDebug?.("FeaturesCast", err); }
}

export async function applyPendingTvDeepLinkIfReady() {
  const req = state.pendingTvDeepLink;
  if (!req || (!req.id && !req.title)) {
    return;
  }
  state.pendingTvDeepLink = null;
  const cleanReq = String(req.id || "").replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 24);
  const normReqTitle = String(req.title || "").trim().toLowerCase();
  const matchesId = (it) => {
    const rawId = String(it?.id || "");
    if (req.id && rawId) {
      if (rawId === req.id || (cleanReq && rawId.replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 24) === cleanReq)) {
        return true;
      }
    }
    if (normReqTitle) {
      const tRu = String(it?.title || "").trim().toLowerCase();
      const tEn = String(it?.orig_title || "").trim().toLowerCase();
      if (tRu === normReqTitle || tEn === normReqTitle) return true;
    }
    return false;
  };
  const catalogList = Array.isArray(state.catalogItems) ? state.catalogItems : [];
  let target =
    catalogList.find(matchesId) ||
    (state.continueWatching || []).find(matchesId) ||
    null;

  if (!target && req.id) {
    try {
      const res = await fetch(`/api/tv/deep-link?p=${encodeURIComponent(req.id)}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.ok && data.item) {
          target = data.item;
        }
      }
    } catch (err) { window.logDebug?.("FeaturesCast", err); }
  }

  if (target) {
    if (req.studioId && !req.tr) req.tr = req.studioId;
    if (req.tr) {
      state.pendingStudioId = String(req.tr);
    }
    if (req.mode === "peek" && !state.tvMode) {
      await openQuickPeekModal(target);
    } else {
      await openPlayerModal(
        target,
        req.tab || resolvePreferredPlayTab(target, req.season, req.episode),
        req.season,
        req.episode,
        req.startSec || 0
      );
    }
  }
}

export async function openPlayerHandoffModal() {
  if (!state.isPlayerOpen || !state.activeItem) {
    showToast(t("Сначала откройте видео в плеере", "Open a video in the player first"));
    return;
  }
  const modal = document.getElementById("handoff-modal");
  if (!modal) return;

  closeFloatingPopovers();
  exitBrowserFullscreenIfNeeded();
  if (modal.classList.contains("hidden")) {
    rememberModalTriggerFocus("handoff-modal");
  }

  const item = state.activeItem;
  const video = document.getElementById("native-video");
  if (video && !video.paused) {
    try {
      video.pause();
    } catch (err) { window.logDebug?.("FeaturesCast", err); }
  }
  const { cur } = getEffectivePlaybackTiming(video);
  const curTime = Math.max(0, Math.floor(cur || (video ? video.currentTime : 0) || 0));
  const sNum = item.media_type === "series" ? Number(state.activeSeason) || 1 : 1;
  const eNum = item.media_type === "series" ? Number(state.activeEpisode) || 1 : 1;
  const title = displayTitle(item);
  const timeFormatted = formatTime(curTime);

  const titleEl = document.getElementById("handoff-item-title");
  const timeEl = document.getElementById("handoff-item-time");
  const metaEl = document.getElementById("handoff-item-meta");
  const qrFrame = document.getElementById("handoff-qr-frame");
  const urlInput = document.getElementById("handoff-url-input");

  if (titleEl) titleEl.textContent = title;
  if (timeEl) timeEl.textContent = `${t("Момент:", "Time:")} ${timeFormatted}`;
  if (metaEl) {
    const metaParts = [];
    if (item.media_type === "series") {
      metaParts.push(`${t("Сезон", "Season")} ${sNum} · ${t("Серия", "Episode")} ${eNum}`);
    }
    if (state.activeStudioName) {
      metaParts.push(translateStudioName(state.activeStudioName));
    }
    metaEl.textContent = metaParts.join(" · ");
  }

  if (qrFrame) {
    qrFrame.innerHTML = `<div class="atv-handoff-loading">${escapeHtml(
      t("Создаём QR-код...", "Generating QR code...")
    )}</div>`;
  }
  if (urlInput) urlInput.value = "";

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  syncScrollTopButton();
  setTimeout(() => {
    const focusTarget = document.getElementById("btn-handoff-copy-url") || document.getElementById("close-handoff-modal");
    focusTarget?.focus?.({ preventScroll: true });
  }, 20);

  if (_handoffAbortController) {
    try {
      _handoffAbortController.abort();
    } catch (_) {}
  }
  const handoffAbort = new AbortController();
  _handoffAbortController = handoffAbort;

  try {
    const params = new URLSearchParams({
      id: item.id || "",
      title: item.title || "",
      orig_title: item.orig_title || "",
      year: item.year || "",
      media_type: item.media_type || "movie",
      poster: item.poster || "",
      season: String(sNum),
      episode: String(eNum),
      t: String(curTime),
      tab: state.activeSourceTab || "hdrezka",
      tr: state.activeStudioId || "",
    });
    const res = await fetch(`/api/handoff?${params.toString()}`, {
      signal: handoffAbort.signal,
    });
    const data = await res.json();
    if (res.ok && data?.ok) {
      if (qrFrame && data.qr_svg) {
        qrFrame.innerHTML = data.qr_svg;
      }
      if (urlInput && data.handoff_url) {
        urlInput.value = data.handoff_url;
      }
    } else {
      if (qrFrame) {
        qrFrame.innerHTML = `<div class="atv-handoff-err">${escapeHtml(
          t("Не удалось сгенерировать QR-код", "Could not generate QR code")
        )}</div>`;
      }
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;
    if (qrFrame) {
      qrFrame.innerHTML = `<div class="atv-handoff-err">${escapeHtml(
        t("Ошибка подключения к серверу", "Server connection error")
      )}</div>`;
    }
  }
}

export function closePlayerHandoffModal() {
  if (_handoffAbortController) {
    try {
      _handoffAbortController.abort();
    } catch (_) {}
    _handoffAbortController = null;
  }
  const modal = document.getElementById("handoff-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  syncScrollTopButton();
  restoreModalTriggerFocus("handoff-modal");
}

