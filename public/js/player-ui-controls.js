// Velarium Player UI Controls Subsystem
// Manages interactive player timeline, scrubber, volume slider, stage idle states,
// fullscreen toggling, control popovers, and responsive layout synchronization.

import { EP_VIEW_MODE_STORAGE_KEY, state } from "./state.js?v=20261113v1";
import {
  displayTitle,
  getItemGenreEntries,
  isEn,
  secondaryTitle,
  t,
} from "./i18n.js?v=20261113v1";
import {
  attachHorizontalWheelScroll,
  clampFloatingPopover,
  clampStagePopover,
  closeCustomSelectMenu,
  closeFloatingPopovers,
  escapeAttr,
  escapeHtml,
  formatTime,
  getEpisodeProgress,
  iconSvg,
  isCustomSelectMenuOpen,
  showToast,
  syncToastContainerMount,
  triggerVideoCenterIndicator,
} from "./utils.js?v=20261113v1";
import { isEpisodeWatched, isServiceEnabled, savePreferredStudioForItem } from "./catalog.js?v=20261113v1";
import {
  activateSelectedSubtitleTrack,
  adjustSubtitleOffset,
  closeSubtitleDictPopover,
  renderVcSubtitlesPopover,
  resetSubtitleOffset,
} from "./subtitles.js?v=20261113v1";
import {
  applyAudioBoostToVideo,
  applySubtitleStylePrefs,
  applyVideoCropToVideo,
  ensurePreservesPitch,
  getAudioPresetLabel,
  getVideoCropLabel,
  resumeAudioContextIfNeeded,
  sampleAmbilightFrame,
  savePlayerPrefs,
  startAmbilightLoop,
  stopAmbilightLoop,
  togglePictureInPicture,
  updatePlayerGearActiveDot,
} from "./audio-dsp.js?v=20261113v1";
import { pushDesktopRemoteStateNow, scheduleDesktopRemoteStatePush } from "./remote.js?v=20261113v1";
import { buildRemuxStreamEndpoint, getEffectivePlaybackTiming } from "./player-remux.js?v=20261113v1";
import {
  filterReleasedEpisodesForSeason,
  getEpisodeDisplayMeta,
  hasStartedWatchingCurrentEpisode,
  markEpisodesBatch,
  markOutgoingEpisodeWatched,
  populateSeasonEpisodeSelectors,
  resolveEffectiveSeasonsMap,
  stepEpisode,
  switchToSeriesSeasonEpisode,
  syncEpisodesStripDrawerUI,
} from "./player-seasons.js?v=20261113v1";
import { syncPostwatchOverlayMount } from "./player-rating.js?v=20261113v1";
import { syncPersonModalMount } from "./modals-person.js?v=20261113v1";
import {
  clearAutoplayNextTimer,
  dismissPlayerNextEpisodeToast,
  getNextEpisodeCoords,
  setSleepTimer,
} from "./player-autoplay.js?v=20261113v1";
import {
  adjustAudioOffset,
  hideVideoStreamError,
  loadBackup4KReleases,
  loadHDRezkaStream,
  loadOfflineStreamForActiveTitle,
  loadStremioStreams,
  renderStremioStreamsList,
  renderTrailerEmbed,
  resetAudioOffset,
  resetVideoElementForStreamChange,
  seekEffectivePlayback,
  switchRemuxAudioTrack,
  switchSourceTab,
  toggleErrorStudiosPanel,
} from "./player-streams.js?v=20261113v1";
import { getDetectedCreditsStartSec, loadSkipIntroSegments } from "./player-intro-credits.js?v=20261113v1";
import {
  closeBookmarkNoteDialog,
  hideXRayPauseShelf,
  renderTimelineBookmarks,
  toggleBookmarkCurrentMoment,
  toggleXRayPauseShelf,
} from "./player-bookmarks.js?v=20261113v1";
import {
  restoreFullPlayerFromPip,
  setMiniPlayerMode,
  setPipBackgroundMode,
  updateMiniPlayerTitle,
} from "./player-pip-dock.js?v=20261113v1";
import { captureVideoScreenshot, togglePlayerSidebarCollapsed } from "./player-meta.js?v=20261113v1";
import {
  captureVideoFrameBridge,
  closePlayerModal,
  playVideoUrl,
  toggleVideoPlayPause,
} from "./player.js?v=20261113v1";

export function hasOpenVcPopover() {
  return [
    "vc-episodes-popover",
    "vc-studio-popover",
    "vc-subs-popover",
    "vc-quality-popover",
    "vc-bookmarks-popover",
    "player-gear-popover",
    "atv-sub-dict-popover",
  ].some((id) => {
    const el = _getVcEl(id);
    return el && !el.classList.contains("hidden");
  });
}

export function syncVcPopoverOpenClass() {
  const stage = _getVcEl("video-stage");
  const isOpen = hasOpenVcPopover();
  if (stage) {
    stage.classList.toggle("vc-popover-open", isOpen);
    stage.parentElement?.classList.toggle("vc-popover-open", isOpen);
  }
}

export function closeAllVcPopovers({ resumeFromSubDict = true } = {}) {
  closeCustomSelectMenu({ restoreFocus: false });
  [
    ["vc-episodes-popover", "vc-btn-episodes"],
    ["vc-studio-popover", "vc-btn-studio"],
    ["vc-subs-popover", "vc-btn-subs"],
    ["vc-quality-popover", "vc-btn-quality"],
    ["vc-bookmarks-popover", "vc-btn-bookmark"],
    ["player-gear-popover", "btn-player-gear"],
  ].forEach(([id, btnId]) => {
    document.getElementById(id)?.classList.add("hidden");
    const btnEl = document.getElementById(btnId);
    btnEl?.setAttribute("aria-expanded", "false");
    if (btnId === "vc-btn-bookmark") {
      btnEl?.classList.remove("active");
    }
  });
  if (state.subDictOpen) {
    closeSubtitleDictPopover(resumeFromSubDict);
  }
  document.getElementById("btn-player-gear")?.classList.remove("active");
  syncVcPopoverOpenClass();
}

export function positionStagePopover(pop) {
  if (pop) clampStagePopover(pop);
}

export function toggleQuickOriginalAudio() {
  if (state.activeSourceTab === "offline" || (typeof navigator !== "undefined" && navigator.onLine === false)) {
    showToast(
      t(
        "В офлайн-режиме воспроизводится сохранённая аудиодорожка",
        "Offline playback uses the saved audio track"
      )
    );
    return;
  }
  const hasRemuxAudio = Boolean(
    (state.activeSourceTab === "backup4k" || state.activeSourceTab === "stremio") &&
      state.remuxMeta?.active &&
      (state.remuxMeta.audioTracks || []).length > 0
  );
  if (state.activeSourceTab !== "hdrezka" && !hasRemuxAudio) {
    if (isServiceEnabled("hdrezka")) {
      switchSourceTab("hdrezka", null);
    } else {
      showToast(
        t(
          "Переключение дорожки оригинала недоступно для текущего потока",
          "Original audio toggle is unavailable for the current stream"
        )
      );
    }
    return;
  }
  const studioSel = document.getElementById("select-studio");
  if (!studioSel) return;
  const opts = Array.from(studioSel.options || []);
  if (opts.length === 0) return;

  const isOptOrig = (o) =>
    Boolean(
      o &&
        (o.dataset.isOriginal === "1" ||
          /\b(eng|english|orig|original|оригинал)\b/i.test(String(o.textContent || "")))
    );
  const origOpt = opts.find((o) => isOptOrig(o));
  if (!origOpt) {
    showToast(
      t(
        "Дорожка оригинала для этого тайтла недоступна",
        "Original audio track is unavailable for this title"
      )
    );
    return;
  }

  const activeOpt = opts.find((o) => o.selected) || opts[0];
  const isCurrentlyOrig = isOptOrig(activeOpt);

  if (isCurrentlyOrig) {
    const fallbackOpt =
      opts.find((o) => String(o.value) === String(state.lastNonOriginalStudioId) && !isOptOrig(o)) ||
      opts.find((o) => !isOptOrig(o)) ||
      null;
    if (!fallbackOpt) {
      showToast(
        t(
          "Для этого тайтла доступна только оригинальная дорожка",
          "Only the Original audio track is available for this title"
        )
      );
      return;
    }
    studioSel.value = fallbackOpt.value;
    studioSel.dispatchEvent(new Event("change"));
    return;
  }

  if (activeOpt) {
    state.lastNonOriginalStudioId = String(activeOpt.value);
  }
  state.forceEnableRuSubtitlesOnce = true;
  studioSel.value = origOpt.value;
  studioSel.dispatchEvent(new Event("change"));
}

export function syncCustomControlPopovers() {
  const isHdRezka = state.activeSourceTab === "hdrezka";
  const has4kRemuxAudio = Boolean(
    (state.activeSourceTab === "backup4k" || state.activeSourceTab === "stremio") &&
      state.remuxMeta?.active &&
      (state.remuxMeta.audioTracks || []).length > 0
  );

  // In-stage Episodes & Seasons Popover (Block 2)
  const epWrap = _getVcEl("vc-episodes-wrap");
  const epLbl = _getVcEl("vc-episodes-label");
  const epPop = _getVcEl("vc-episodes-popover");
  if (epWrap && epLbl && epPop) {
    const item = state.activeItem;
    const isSeries = Boolean(item && item.media_type === "series" && state.activeSourceTab !== "trailer");
    if (!isSeries) {
      epWrap.classList.add("hidden");
      epPop.innerHTML = "";
    } else {
      epWrap.classList.remove("hidden");
      const curS = Number(state.activeSeason) || 1;
      const curE = Number(state.activeEpisode) || 1;
      epLbl.textContent = `S${curS} · E${curE}`;

      if (!epPop.classList.contains("hidden")) {
        const resolvedMap = resolveEffectiveSeasonsMap(item, state.seasonsMap);
        const mapKeys = resolvedMap
          ? Object.keys(resolvedMap)
              .map((k) => parseInt(k, 10))
              .filter((n) => n > 0)
              .sort((a, b) => a - b)
          : [];
        const fallbackSeasonsCount = Math.max(curS, Number(item.seasons_count) || 1);
        const seasonNumbers =
          mapKeys.length > 0
            ? mapKeys
            : Array.from({ length: fallbackSeasonsCount }, (_, idx) => idx + 1);

        const previewSeason = seasonNumbers.includes(Number(state.vcPreviewSeason))
          ? Number(state.vcPreviewSeason)
          : curS;
        state.vcPreviewSeason = previewSeason;

        const renderInStageEpisodesMenu = (selSeason) => {
          state.vcPreviewSeason = selSeason;
          const nowDayMs = Date.now();
          if (!state._cachedTodayIso || nowDayMs - (state._cachedTodayIsoTs || 0) > 60000) {
            state._cachedTodayIso = new Date(nowDayMs).toISOString().slice(0, 10);
            state._cachedTodayIsoTs = nowDayMs;
          }
          const todayIso = state._cachedTodayIso;
          const sKey = String(selSeason);
          const metaForSeason = state.episodesMeta?.[sKey] || {};
          const effLatestS = Number(item.latest_season || item.kinorium?.latest_season || 0);
          const effLatestE = Number(item.latest_episode || item.kinorium?.latest_episode || 0);
          const fallbackEpsCount = Math.max(curE, Number(item.episodes_per_season) || 1);
          const rawEps =
            resolvedMap && Array.isArray(resolvedMap[sKey]) && resolvedMap[sKey].length > 0
              ? resolvedMap[sKey]
              : Array.from({ length: fallbackEpsCount }, (_, idx) => idx + 1);
          const releasedEps = rawEps.filter((eNum) => {
            const rawMeta = metaForSeason[String(eNum)] || {};
            const airDateStr = String(rawMeta.air_date || rawMeta.airDate || "");
            if (/^\d{4}-\d{2}-\d{2}/.test(airDateStr) && airDateStr.slice(0, 10) > todayIso) return false;
            if (rawMeta.is_future === true || rawMeta.is_released === false) return false;
            if (effLatestS > 0 && effLatestE > 0 && selSeason === effLatestS && eNum > effLatestE) return false;
            return true;
          });
          const watchedEpsArr = releasedEps.filter((eNum) => isEpisodeWatched(item, selSeason, eNum));
          const epPopSig = `${item.id || item.title || ""}|s:${selSeason}|act:${curS}:${curE}|sn:${seasonNumbers.join(",")}|rel:${releasedEps.join(",")}|mk:${Object.keys(metaForSeason).length}|w:${watchedEpsArr.join(",")}|l:${state.appLang || "ru"}`;
          if (epPop.dataset.renderSig === epPopSig && epPop.childElementCount > 0) {
            return;
          }
          epPop.dataset.renderSig = epPopSig;

          epPop.innerHTML = `<div class="atv-vc-pop-title">${escapeHtml(
            t("Сезоны и серии", "Seasons & Episodes")
          )}</div>`;

          if (seasonNumbers.length > 1) {
            const seasonsBar = document.createElement("div");
            seasonsBar.className = "atv-vc-ep-seasons-row";
            seasonsBar.setAttribute("role", "tablist");
            seasonsBar.setAttribute("aria-label", t("Сезоны", "Seasons"));
            seasonNumbers.forEach((sNum) => {
              const isSelSeason = sNum === selSeason;
              const sBtn = document.createElement("button");
              sBtn.type = "button";
              sBtn.setAttribute("role", "tab");
              sBtn.setAttribute("aria-selected", isSelSeason ? "true" : "false");
              sBtn.className = `atv-vc-ep-season-pill${isSelSeason ? " active" : ""}`;
              sBtn.textContent = `${t("Сезон", "Season")} ${sNum}`;
              sBtn.onclick = (ev) => {
                ev.stopPropagation();
                renderInStageEpisodesMenu(sNum);
              };
              seasonsBar.appendChild(sBtn);
            });
            epPop.appendChild(seasonsBar);
          }

          const listBox = document.createElement("div");
          listBox.className = "atv-vc-ep-list";
          releasedEps.forEach((eNum) => {
            const isAct = selSeason === curS && eNum === curE;
            const isWatched = isEpisodeWatched(item, selSeason, eNum);
            const epProg = getEpisodeProgress(item, selSeason, eNum);
            const epMeta = getEpisodeDisplayMeta(selSeason, eNum);
            const rowBtn = document.createElement("button");
            rowBtn.type = "button";
            if (isAct) rowBtn.setAttribute("aria-current", "true");
            rowBtn.className = `atv-vc-pop-item atv-vc-ep-row${isAct ? " active" : ""}${
              isWatched ? " watched is-watched" : ""
            }`;
            const epSubTitle = epMeta.realTitle ? ` · ${epMeta.realTitle}` : "";
            const rightBadge = isAct
              ? iconSvg("play", 11)
              : isWatched
              ? iconSvg("check", 12)
              : epProg && epProg.pct > 0
              ? `<span class="atv-vc-ep-prog-pct">${epProg.pct}%</span>`
              : "";
            rowBtn.innerHTML = `
              <span class="atv-vc-ep-row-main atv-vc-pop-item-main">
                <span class="atv-vc-ep-num">${t(`Серия ${eNum}`, `Episode ${eNum}`)}</span>
                ${
                  epSubTitle
                    ? `<span class="atv-vc-ep-title">${escapeHtml(epMeta.realTitle)}</span>`
                    : ""
                }
              </span>
              <span class="atv-vc-ep-row-right atv-vc-ep-status">${rightBadge}</span>
            `;
            rowBtn.onclick = (ev) => {
              ev.stopPropagation();
              closeAllVcPopovers();
              switchToSeriesSeasonEpisode(selSeason, eNum);
            };
            listBox.appendChild(rowBtn);
          });
          epPop.appendChild(listBox);
        };

        renderInStageEpisodesMenu(previewSeason);
      }
    }
  }

  const studioWrap = _getVcEl("vc-studio-wrap");
  const studioLbl = _getVcEl("vc-studio-label");
  const studioPop = _getVcEl("vc-studio-popover");
  const studioSel = _getVcEl("select-studio");

  const bindPopoverQuickSearch = (container) => {
    const searchInp = container.querySelector(".atv-vc-pop-search");
    if (!searchInp) return;
    searchInp.addEventListener("click", (ev) => ev.stopPropagation());
    searchInp.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") {
        ev.stopPropagation();
      }
    });
    searchInp.addEventListener("input", () => {
      const q = String(searchInp.value || "").trim().toLowerCase();
      let visCount = 0;
      container.querySelectorAll(".atv-vc-pop-item").forEach((btn) => {
        const match = !q || btn.textContent.toLowerCase().includes(q);
        btn.classList.toggle("hidden", !match);
        if (match) visCount += 1;
      });
      container.querySelectorAll(".atv-vc-pop-divider").forEach((div) => {
        div.classList.toggle("hidden", Boolean(q));
      });
      const emptyEl = container.querySelector(".atv-vc-pop-empty");
      if (emptyEl) emptyEl.classList.toggle("hidden", visCount > 0);
    });
  };

  const renderStudioItemsInto = (container, opts, popTitle) => {
    if (!container) return;
    const studioSig = `${popTitle}|${studioSel?.value || ""}|${opts.map((o) => `${o.value}:${o.dataset.isOriginal || ""}:${o.textContent}`).join("||")}|${state.appLang || "ru"}`;
    if (container.dataset.renderSig === studioSig && container.childElementCount > 0) {
      return;
    }
    container.dataset.renderSig = studioSig;
    const showSearch = opts.length >= 12;
    const searchHtml = showSearch
      ? `<div class="atv-vc-pop-search-wrap"><input type="text" class="atv-vc-pop-search" placeholder="${escapeAttr(
          t("Поиск дорожки...", "Filter tracks...")
        )}" autocomplete="off" spellcheck="false" /></div>`
      : "";
    container.innerHTML = `<div class="atv-vc-pop-title">${escapeHtml(popTitle)}</div>${searchHtml}`;
    const containerFrag = document.createDocumentFragment();
    opts.forEach((opt, idx) => {
      const isAct = opt.value === studioSel.value;
      const isOrig = opt.dataset.isOriginal === "1";
      const b = document.createElement("button");
      b.type = "button";
      b.className = `atv-vc-pop-item${isAct ? " active" : ""}${isOrig ? " is-orig-option" : ""}`;
      const badgeHtml = isOrig ? `<span class="atv-vc-orig-badge">ORIG</span>` : "";
      b.innerHTML = `<span class="atv-vc-pop-item-main">${badgeHtml}<span>${escapeHtml(
        opt.textContent
      )}</span></span><span>${isAct ? iconSvg("check", 12) : ""}</span>`;
      b.onclick = (ev) => {
        ev.stopPropagation();
        closeAllVcPopovers();
        if (isOrig) {
          state.forceEnableRuSubtitlesOnce = true;
        }
        studioSel.value = opt.value;
        studioSel.dispatchEvent(new Event("change"));
      };
      containerFrag.appendChild(b);
      const nextOpt = opts[idx + 1];
      if (isOrig && nextOpt && nextOpt.dataset.isOriginal !== "1") {
        const div = document.createElement("div");
        div.className = "atv-vc-pop-divider";
        containerFrag.appendChild(div);
      }
    });
    container.appendChild(containerFrag);
    if (showSearch) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "atv-vc-pop-empty hidden";
      emptyDiv.textContent = t("Ничего не найдено", "No matches");
      container.appendChild(emptyDiv);
      bindPopoverQuickSearch(container);
    }
  };

  if (studioSel) {
    const opts = Array.from(studioSel.options || []);
    const activeOpt = opts.find((o) => o.selected) || opts[0] || null;
    const popTitle = has4kRemuxAudio
      ? state.activeSourceTab === "stremio"
        ? t("Аудиодорожка Stremio", "Stremio Audio Track")
        : t("Аудиодорожка 4K", "4K Audio Track")
      : t("Озвучка и оригинал", "Audio & Original");

    if (studioWrap && studioLbl && studioPop) {
      if ((!isHdRezka && !has4kRemuxAudio) || opts.length === 0) {
        studioWrap.classList.add("hidden");
        studioPop.innerHTML = "";
      } else {
        studioWrap.classList.remove("hidden");
        studioLbl.textContent = activeOpt ? activeOpt.textContent : t("Озвучка", "Audio");
        if (!studioPop.classList.contains("hidden")) {
          renderStudioItemsInto(studioPop, opts, popTitle);
        }
      }
    }
  }

  const subsWrap = _getVcEl("vc-subs-wrap");
  const subsLbl = _getVcEl("vc-subs-label");
  const subsPop = _getVcEl("vc-subs-popover");
  const subsSel = _getVcEl("select-subtitle");
  if (subsWrap && subsLbl && subsPop && subsSel) {
    renderVcSubtitlesPopover(subsWrap, subsLbl, subsPop, subsSel, bindPopoverQuickSearch);
  }

  const qualWrap = _getVcEl("vc-quality-wrap");
  const qualBtn = _getVcEl("vc-btn-quality");
  const qualLbl = _getVcEl("vc-quality-label");
  const qualPop = _getVcEl("vc-quality-popover");
  const qualSel = _getVcEl("select-quality");
  if (qualWrap && qualLbl && qualPop && qualSel) {
    const qOpts = Array.from(qualSel.options || []);
    if (isHdRezka && qOpts.length > 0) {
      qualWrap.classList.remove("hidden");
      qualBtn?.classList.remove("is-readonly-badge");
      const activeQ = qualSel.value || qOpts[0]?.value || "1080p";
      const isAbrSteppedDown = Boolean(
        state.abrAutoMode !== false &&
          state.abrTargetQuality &&
          state.abrCurrentQuality &&
          state.abrCurrentQuality === activeQ &&
          state.abrCurrentQuality !== state.abrTargetQuality
      );
      qualLbl.textContent = isAbrSteppedDown
        ? `${activeQ} · ${t("Авто", "Auto")}`
        : activeQ;
      if (!qualPop.classList.contains("hidden")) {
        const qualPopSig = `${qualSel.value || ""}|${qOpts.map((o) => `${o.value}:${o.textContent}`).join("|")}|${state.appLang || "ru"}`;
        if (qualPop.dataset.renderSig !== qualPopSig || qualPop.childElementCount === 0) {
          qualPop.dataset.renderSig = qualPopSig;
          qualPop.innerHTML = `<div class="atv-vc-pop-title">${t("Качество видео", "Video Quality")}</div>`;
          const qFrag = document.createDocumentFragment();
          qOpts.forEach((opt) => {
            const isAct = opt.value === qualSel.value;
            const b = document.createElement("button");
            b.type = "button";
            b.className = `atv-vc-pop-item${isAct ? " active" : ""}`;
            b.innerHTML = `<span>${escapeHtml(opt.textContent)}</span><span>${isAct ? iconSvg("check", 12) : ""}</span>`;
            b.onclick = (ev) => {
              ev.stopPropagation();
              closeAllVcPopovers();
              if (qualSel.value !== opt.value) {
                qualSel.value = opt.value;
                qualSel.dispatchEvent(new Event("change"));
                syncCustomControlPopovers();
              }
            };
            qFrag.appendChild(b);
          });
          qualPop.appendChild(qFrag);
        }
      }
    } else if (state.activeSourceTab === "backup4k" || state.activeSourceTab === "stremio") {
      const videoEl = document.getElementById("native-video");
      const vh = Number(videoEl?.videoHeight) || 0;
      const hintTxt = `${state.activeStudioName || ""} ${state.remuxMeta?.codecSummary || ""}`;
      let badgeLabel = "";
      if (vh >= 2000 || /\b(2160p|4k|uhd)\b/i.test(hintTxt)) {
        badgeLabel = /\b(hdr|dv|dolby\s*vision)\b/i.test(hintTxt) ? "4K HDR" : "4K UHD";
      } else if (vh >= 1000 || /\b1080p\b/i.test(hintTxt)) {
        badgeLabel = "1080p";
      } else if (vh >= 700 || /\b720p\b/i.test(hintTxt)) {
        badgeLabel = "720p";
      } else if (state.activeSourceTab === "backup4k") {
        badgeLabel = "4K UHD";
      }
      if (badgeLabel) {
        qualWrap.classList.remove("hidden");
        qualBtn?.classList.add("is-readonly-badge");
        qualLbl.textContent = badgeLabel;
        qualPop.innerHTML = "";
      } else {
        qualWrap.classList.add("hidden");
        qualBtn?.classList.remove("is-readonly-badge");
        qualPop.innerHTML = "";
      }
    } else {
      qualWrap.classList.add("hidden");
      qualBtn?.classList.remove("is-readonly-badge");
      qualPop.innerHTML = "";
    }
  }
}

export function isStageFullscreen() {
  return Boolean(
    document.fullscreenElement ||
      document.webkitFullscreenElement ||
      state.isPseudoFullscreen ||
      (typeof document !== "undefined" &&
        document.documentElement?.classList.contains("is-stage-pseudo-fullscreen"))
  );
}

export function setPseudoStageFullscreen(enable) {
  const next = Boolean(enable);
  state.isPseudoFullscreen = next;
  const stage = document.getElementById("video-stage");
  document.documentElement.classList.toggle("is-stage-pseudo-fullscreen", next);
  document.body?.classList.toggle("is-stage-pseudo-fullscreen-body", next);
  stage?.classList.toggle("is-pseudo-fullscreen", next);
  stage?.classList.toggle("is-stage-pseudo-fullscreen", next);
  const fsActive = isStageFullscreen();
  document.documentElement.classList.toggle("is-stage-fullscreen", fsActive);
  if (!fsActive) {
    document.documentElement.classList.remove("vc-fs-cursor-none");
  }
  syncPostwatchOverlayMount();
  syncToastContainerMount();
  syncPersonModalMount();
  syncCustomVideoControlsUI();
  wakeVideoControls();
  pushDesktopRemoteStateNow();
}

export function setVideoStageIdle(isIdle) {
  state.vcIsIdle = Boolean(isIdle);
  const stage = _getVcEl("video-stage");
  if (isIdle) {
    stage?.classList.add("vc-idle");
    if (!state.vcScrubbing) {
      _getVcEl("vc-hover-time")?.classList.add("hidden");
    }
    if (isStageFullscreen()) {
      document.documentElement.classList.add("vc-fs-cursor-none");
    } else {
      document.documentElement.classList.remove("vc-fs-cursor-none");
    }
  } else {
    stage?.classList.remove("vc-idle");
    document.documentElement.classList.remove("vc-fs-cursor-none");
  }
}

function _onVcIdleTimeout() {
  state.vcIdleTimerId = null;
  const video = _getVcEl("native-video");
  if (!video) return;
  const controlsBar = _getVcEl("atv-custom-controls");
  const activeEl = typeof document !== "undefined" ? document.activeElement : null;
  const isFocusInsideControls = Boolean(
    controlsBar && activeEl && activeEl !== video && controlsBar.contains(activeEl)
  );
  if (
    !video.paused &&
    !video.ended &&
    !state.vcScrubbing &&
    !hasOpenVcPopover() &&
    !isFocusInsideControls
  ) {
    setVideoStageIdle(true);
  }
}

export function wakeVideoControls() {
  const nowMs = Date.now();
  if (!state.vcIsIdle && nowMs - (state._lastVcWakeTs || 0) < 220) {
    return;
  }
  const stage = _getVcEl("video-stage");
  const video = _getVcEl("native-video");
  if (!stage) return;
  if (state.vcIsIdle || stage.classList.contains("vc-idle")) {
    setVideoStageIdle(false);
  }
  state._lastVcWakeTs = nowMs;
  if (state.vcIdleTimerId) {
    clearTimeout(state.vcIdleTimerId);
    state.vcIdleTimerId = null;
  }
  if (!video || video.paused || video.ended) return;
  state.vcIdleTimerId = setTimeout(_onVcIdleTimeout, 2200);
}

let _lastFsHeaderKey = "";
const _vcDom = {};

function _getVcEl(id) {
  let el = _vcDom[id];
  if (!el || !el.isConnected) {
    el = document.getElementById(id);
    if (el) _vcDom[id] = el;
  }
  return el;
}

export function syncCustomVideoControlsUI(forceSync = false) {
  const video = _getVcEl("native-video");
  if (!video) return;
  // Skip redundant DOM style mutations when controls bar is hidden in idle playback
  // and throttle high-frequency active timeupdate calls (up to 60Hz in WebKit)
  if (!forceSync && !state.vcScrubbing) {
    const nowMs = Date.now();
    const stage = _getVcEl("video-stage");
    if (stage && (stage.classList.contains("vc-idle") || state.vcIsIdle)) {
      if (nowMs - (state.lastVcSyncTs || 0) < 1200) {
        return;
      }
      state.lastVcSyncTs = nowMs;
    } else if (nowMs - (state._lastVcActiveSyncTs || 0) < 90) {
      return;
    }
    state._lastVcActiveSyncTs = nowMs;
  }
  const { cur, dur } = getEffectivePlaybackTiming(video);
  const rawCur = Number.isFinite(video.currentTime) ? video.currentTime : 0;

  const curLang = state.appLang || "ru";
  const playBtn = _getVcEl("vc-btn-play");
  if (playBtn) {
    const playKey = video.paused ? "play" : "pause";
    if (forceSync || playBtn.dataset.icoKey !== playKey || playBtn.dataset.lang !== curLang) {
      if (playBtn.dataset.icoKey !== playKey) {
        playBtn.dataset.icoKey = playKey;
        playBtn.innerHTML = iconSvg(playKey, 14);
      }
      playBtn.dataset.lang = curLang;
      const playLabel = video.paused
        ? t("Воспроизвести (Space)", "Play (Space)")
        : t("Пауза (Space)", "Pause (Space)");
      if (playBtn.getAttribute("aria-label") !== playLabel) {
        playBtn.setAttribute("aria-label", playLabel);
      }
    }
  }

  const curSecInt = Math.floor(cur);
  const durSecInt = Math.floor(dur);

  if (!state.vcScrubbing) {
    const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
    const playedEl = _getVcEl("vc-played");
    const thumbEl = _getVcEl("vc-thumb");
    const timelineEl = _getVcEl("vc-timeline");
    const pctStr = `${pct.toFixed(2)}%`;
    if (playedEl && playedEl.style.width !== pctStr) playedEl.style.width = pctStr;
    if (thumbEl && thumbEl.style.left !== pctStr) thumbEl.style.left = pctStr;
    if (timelineEl && (forceSync || timelineEl._lastAriaSec !== curSecInt || timelineEl._lastAriaDur !== durSecInt)) {
      timelineEl._lastAriaSec = curSecInt;
      timelineEl._lastAriaDur = durSecInt;
      timelineEl.setAttribute("aria-valuenow", String(Math.round(pct)));
      timelineEl.setAttribute(
        "aria-valuetext",
        dur > 0 ? `${formatTime(cur)} / ${formatTime(dur)}` : "0:00"
      );
    }
  }

  const bufferedEl = _getVcEl("vc-buffered");
  if (bufferedEl) {
    let bufPct = 0;
    if (dur > 0 && video.buffered && video.buffered.length > 0) {
      let bufEnd = 0;
      for (let i = 0; i < video.buffered.length; i++) {
        if (video.buffered.start(i) <= rawCur + 0.5 && video.buffered.end(i) >= rawCur) {
          bufEnd = Math.max(bufEnd, video.buffered.end(i));
        }
      }
      if (!bufEnd) {
        bufEnd = video.buffered.end(video.buffered.length - 1);
      }
      const effBufEnd = (state.remuxMeta?.active ? state.remuxMeta.offsetSec || 0 : 0) + bufEnd;
      bufPct = Math.min(100, Math.max(0, (effBufEnd / dur) * 100));
    }
    const bufStr = `${bufPct.toFixed(1)}%`;
    if (bufferedEl.style.width !== bufStr) {
      bufferedEl.style.width = bufStr;
    }
  }

  const timeBtn = _getVcEl("vc-time-label");
  if (
    timeBtn &&
    (forceSync ||
      timeBtn._lastCurSec !== curSecInt ||
      timeBtn._lastDurSec !== durSecInt ||
      timeBtn._lastRemMode !== Boolean(state.vcShowRemaining))
  ) {
    timeBtn._lastCurSec = curSecInt;
    timeBtn._lastDurSec = durSecInt;
    timeBtn._lastRemMode = Boolean(state.vcShowRemaining);
    if (dur > 0 && state.vcShowRemaining) {
      timeBtn.textContent = `${formatTime(cur)} / -${formatTime(Math.max(0, dur - cur))}`;
    } else {
      timeBtn.textContent = `${formatTime(cur)} / ${dur > 0 ? formatTime(dur) : "0:00"}`;
    }
  }

  const muteBtn = _getVcEl("vc-btn-mute");
  const volSlider = _getVcEl("vc-vol-slider");
  const isMuted = Boolean(video.muted || video.volume === 0);
  if (muteBtn) {
    const muteKey = isMuted ? "volMute" : video.volume < 0.5 ? "volLow" : "volHigh";
    if (forceSync || muteBtn.dataset.icoKey !== muteKey || muteBtn.dataset.lang !== curLang) {
      if (muteBtn.dataset.icoKey !== muteKey) {
        muteBtn.dataset.icoKey = muteKey;
        muteBtn.innerHTML = iconSvg(muteKey, 15);
      }
      muteBtn.dataset.lang = curLang;
      const muteLabel = isMuted
        ? t("Включить звук (M)", "Unmute (M)")
        : t("Выключить звук (M)", "Mute (M)");
      if (muteBtn.getAttribute("aria-label") !== muteLabel) {
        muteBtn.setAttribute("aria-label", muteLabel);
      }
    }
  }
  if (volSlider && document.activeElement !== volSlider) {
    const nextVolStr = String(video.muted ? 0 : video.volume);
    if (volSlider.value !== nextVolStr) {
      volSlider.value = nextVolStr;
    }
  }

  const fsBtn = _getVcEl("vc-btn-fs");
  if (fsBtn) {
    const fsActive = isStageFullscreen();
    const fsKey = fsActive ? "fsExit" : "fsEnter";
    if (forceSync || fsBtn.dataset.icoKey !== fsKey || fsBtn.dataset.lang !== curLang) {
      if (fsBtn.dataset.icoKey !== fsKey) {
        fsBtn.dataset.icoKey = fsKey;
        fsBtn.innerHTML = iconSvg(fsKey, 14);
      }
      fsBtn.dataset.lang = curLang;
      const fsTitle = fsActive
        ? t("Выйти из полного экрана (F / Esc)", "Exit fullscreen (F / Esc)")
        : t("Во весь экран (F)", "Fullscreen (F)");
      if (fsBtn.title !== fsTitle) {
        fsBtn.title = fsTitle;
        fsBtn.setAttribute("aria-label", fsTitle);
      }
    }
  }

  const fsTitleEl = _getVcEl("vc-fs-title");
  const fsMetaEl = _getVcEl("vc-fs-meta");
  if (fsTitleEl && fsMetaEl && state.activeItem) {
    const item = state.activeItem;
    const curSeasonTitlesObj = state.episodesTitles
      ? state.episodesTitles[String(state.activeSeason)]
      : null;
    const epTitleSample = curSeasonTitlesObj ? curSeasonTitlesObj[String(state.activeEpisode)] || "" : "";
    const fsHeaderKey = `${item.id || item.title}:${state.activeSeason}:${state.activeEpisode}:${state.activeStudioName || ""}:${curLang}:${epTitleSample}`;
    if (forceSync || _lastFsHeaderKey !== fsHeaderKey) {
      _lastFsHeaderKey = fsHeaderKey;
      const mainTitle = displayTitle(item);
      let nextTitle = "";
      let nextMeta = "";
      if (item.media_type === "series") {
        const epMeta = getEpisodeDisplayMeta(state.activeSeason, state.activeEpisode);
        const epNamePart = epMeta.realTitle
          ? isEn()
            ? ` — "${epMeta.realTitle}"`
            : ` — «${epMeta.realTitle}»`
          : "";
        nextTitle = mainTitle || "";
        nextMeta = [
          `${t(
            `Сезон ${state.activeSeason}, Серия ${state.activeEpisode}`,
            `Season ${state.activeSeason}, Episode ${state.activeEpisode}`
          )}${epNamePart}`,
          state.activeStudioName || "",
        ]
          .filter(Boolean)
          .join(" · ");
      } else {
        const fsGenres = getItemGenreEntries(item)
          .slice(0, 2)
          .map((g) => g.label)
          .join(", ");
        nextTitle = item.year ? `${mainTitle} (${item.year})` : mainTitle || "";
        nextMeta = [secondaryTitle(item) || "", fsGenres, state.activeStudioName || ""]
          .filter(Boolean)
          .join(" · ");
      }
      if (fsTitleEl.textContent !== nextTitle) fsTitleEl.textContent = nextTitle;
      if (fsMetaEl.textContent !== nextMeta) fsMetaEl.textContent = nextMeta;
    }
  }
}

export function beginFullscreenTransitionWindow(durationMs = 560) {
  state.fsTransitioning = true;
  document.documentElement.classList.add("fs-transitioning");
  if (state.fsTransitionTimerId) {
    clearTimeout(state.fsTransitionTimerId);
  }
  state.fsTransitionTimerId = setTimeout(() => {
    state.fsTransitioning = false;
    state.fsTransitionTimerId = null;
    document.documentElement.classList.remove("fs-transitioning");
    if (!isStageFullscreen() && state.isPlayerOpen && state.ambilightEnabled) {
      sampleAmbilightFrame();
    }
  }, durationMs);
}

export function toggleStageFullscreen() {
  const video = document.getElementById("native-video");
  const stage = document.getElementById("video-stage") || video;
  if (!stage) return;
  const blurActiveStageControl = () => {
    const activeEl = typeof document !== "undefined" ? document.activeElement : null;
    if (
      activeEl &&
      activeEl !== document.body &&
      activeEl !== video &&
      typeof activeEl.blur === "function"
    ) {
      try {
        activeEl.blur();
      } catch (_) {}
    }
  };
  blurActiveStageControl();
  setTimeout(blurActiveStageControl, 80);
  if (state.vcClickTimerId) {
    clearTimeout(state.vcClickTimerId);
    state.vcClickTimerId = null;
  }
  beginFullscreenTransitionWindow(580);
  const hasMacNativeFullscreen = Boolean(
    window.webkit?.messageHandlers?.velariumNative?.postMessage
  );
  if (isStageFullscreen()) {
    const hadPseudo = Boolean(
      state.isPseudoFullscreen ||
        document.documentElement?.classList.contains("is-stage-pseudo-fullscreen")
    );
    if (hadPseudo) {
      setPseudoStageFullscreen(false);
    }
    if (hasMacNativeFullscreen) {
      try {
        window.webkit.messageHandlers.velariumNative.postMessage({
          action: "setWindowFullscreen",
          fullscreen: false,
        });
      } catch (err) { window.logDebug?.("PlayerUiControls", err); }
    }
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
    return;
  }

  if (state.isMiniPlayer) {
    setMiniPlayerMode(false);
  }
  if (state.isPipBackground) {
    setPipBackgroundMode(false);
  }
  if (hasMacNativeFullscreen) {
    setPseudoStageFullscreen(true);
    try {
      window.webkit.messageHandlers.velariumNative.postMessage({
        action: "setWindowFullscreen",
        fullscreen: true,
      });
    } catch (err) { window.logDebug?.("PlayerUiControls", err); }
    return;
  }

  if (stage.requestFullscreen) {
    try {
      const p = stage.requestFullscreen();
      if (p && typeof p.then === "function") {
        p.catch(() => {
          setPseudoStageFullscreen(true);
        });
      }
    } catch (_) {
      setPseudoStageFullscreen(true);
    }
  } else if (stage.webkitRequestFullscreen) {
    try {
      stage.webkitRequestFullscreen();
      setTimeout(() => {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
          setPseudoStageFullscreen(true);
        }
      }, 120);
    } catch (_) {
      setPseudoStageFullscreen(true);
    }
  } else if (video && video.webkitEnterFullscreen) {
    try {
      video.webkitEnterFullscreen();
    } catch (_) {
      setPseudoStageFullscreen(true);
    }
  } else {
    setPseudoStageFullscreen(true);
  }
}

let _cachedSnapCandidates = null;
let _cachedSnapCandidatesKey = "";

export function getSnappingRatio(rawRatio, dur, timelineWidthPx = 0) {
  if (!dur || dur <= 0) return { ratio: rawRatio, snapped: null };
  let width = Number(timelineWidthPx) || 0;
  if (!width) {
    const timeline = document.getElementById("vc-timeline");
    width = timeline?.getBoundingClientRect()?.width || 0;
  }
  if (!width) return { ratio: rawRatio, snapped: null };
  const snapThresholdRatio = Math.max(0.006, 8 / width);

  const introStart = Number(state.skipSegments?.intro?.start) || Number(state.skipSegments?.intro?.start_sec) || 0;
  const introEnd = Number(state.skipSegments?.intro?.end) || Number(state.skipSegments?.intro?.end_sec) || 0;
  const creditsStart = getDetectedCreditsStartSec(dur) || 0;
  const bmLen = Array.isArray(state.activeItemBookmarks) ? state.activeItemBookmarks.length : 0;
  const bmLastId = bmLen > 0 ? state.activeItemBookmarks[bmLen - 1]?.id || state.activeItemBookmarks[bmLen - 1]?.time : 0;
  const extraChapters = Array.isArray(state.remuxMeta?.chapters)
    ? state.remuxMeta.chapters
    : Array.isArray(state.skipSegments?.chapters)
    ? state.skipSegments.chapters
    : [];
  const snapKey = `${Math.round(dur)}:${introStart}:${introEnd}:${creditsStart}:${bmLen}:${bmLastId}:${extraChapters.length}:${state.appLang || "ru"}`;

  let candidates = _cachedSnapCandidates;
  if (!candidates || _cachedSnapCandidatesKey !== snapKey) {
    candidates = [];
    if (introStart > 0 && introStart < dur) {
      candidates.push({ r: introStart / dur, label: t("Заставка: начало", "Intro start") });
    }
    if (introEnd > 0 && introEnd < dur) {
      candidates.push({ r: introEnd / dur, label: t("Заставка: конец", "Intro end") });
    }
    if (creditsStart > 0 && creditsStart < dur) {
      candidates.push({ r: creditsStart / dur, label: t("Титры", "Credits") });
    }
    if (Array.isArray(state.activeItemBookmarks)) {
      state.activeItemBookmarks.forEach((bm) => {
        if (bm && typeof bm.time === "number" && bm.time > 0 && bm.time < dur) {
          const bmNote = String(bm.note || "").trim();
          const bmLabel = bmNote
            ? `${t("Закладка", "Bookmark")}: ${bmNote}`
            : `${t("Закладка", "Bookmark")} (${formatTime(bm.time)})`;
          candidates.push({ r: bm.time / dur, label: bmLabel });
        }
      });
    }
    extraChapters.forEach((ch) => {
      const chSec = Number(ch?.start ?? ch?.time ?? ch?.start_sec) || 0;
      if (chSec > 0 && chSec < dur) {
        candidates.push({
          r: chSec / dur,
          label: String(ch?.title || ch?.label || `${t("Глава", "Chapter")} (${formatTime(chSec)})`),
        });
      }
    });
    _cachedSnapCandidates = candidates;
    _cachedSnapCandidatesKey = snapKey;
  }

  for (const cand of candidates) {
    if (Math.abs(rawRatio - cand.r) <= snapThresholdRatio) {
      return { ratio: cand.r, snapped: cand.label };
    }
  }
  return { ratio: rawRatio, snapped: null };
}

export function collectActiveTimelineChapters(dur) {
  const effDur = Number(dur) || 0;
  if (effDur <= 0) return [];
  const chapters = [];
  const introStart = Number(state.skipSegments?.intro?.start) || Number(state.skipSegments?.intro?.start_sec) || 0;
  const introEnd = Number(state.skipSegments?.intro?.end) || Number(state.skipSegments?.intro?.end_sec) || 0;
  const creditsStart = getDetectedCreditsStartSec(effDur) || 0;

  if (introEnd > 1 && introEnd < effDur) {
    chapters.push({
      time: Math.max(0, Math.round(introStart)),
      end: Math.round(introEnd),
      label: t("Заставка", "Intro"),
      kind: "intro",
    });
    chapters.push({
      time: Math.round(introEnd),
      end: 0,
      label: t("Конец заставки", "Intro end"),
      kind: "intro_end",
    });
  }

  const extraChapters = Array.isArray(state.remuxMeta?.chapters)
    ? state.remuxMeta.chapters
    : Array.isArray(state.skipSegments?.chapters)
    ? state.skipSegments.chapters
    : [];
  extraChapters.forEach((ch, idx) => {
    const chSec = Number(ch?.start ?? ch?.time ?? ch?.start_sec) || 0;
    const chEnd = Number(ch?.end ?? ch?.end_sec) || 0;
    if (chSec >= 0 && chSec < effDur) {
      chapters.push({
        time: Math.round(chSec),
        end: chEnd > chSec ? Math.round(chEnd) : 0,
        label: String(ch?.title || ch?.label || `${t("Глава", "Chapter")} ${idx + 1}`),
        kind: "chapter",
      });
    }
  });

  if (creditsStart > 1 && creditsStart < effDur) {
    chapters.push({
      time: Math.round(creditsStart),
      end: Math.round(effDur),
      label: t("Титры", "Credits"),
      kind: "credits",
    });
  }

  chapters.sort((a, b) => a.time - b.time);
  const deduped = [];
  for (const ch of chapters) {
    if (!deduped.length || Math.abs(deduped[deduped.length - 1].time - ch.time) > 1) {
      deduped.push(ch);
    }
  }
  return deduped;
}

let _lastActiveChapterKey = "";
let _lastActiveChapterVal = "";

export function findActiveChapterLabel(cur, dur) {
  const effDur = Number(dur) || 0;
  const effCur = Number(cur) || 0;
  if (effDur <= 0 || effCur < 0) return "";
  const extraChapters = Array.isArray(state.remuxMeta?.chapters)
    ? state.remuxMeta.chapters
    : Array.isArray(state.skipSegments?.chapters)
    ? state.skipSegments.chapters
    : [];
  const introStart = Number(state.skipSegments?.intro?.start) || Number(state.skipSegments?.intro?.start_sec) || 0;
  const introEnd = Number(state.skipSegments?.intro?.end) || Number(state.skipSegments?.intro?.end_sec) || 0;
  const chMemoKey = `${state.activeItem?.id || ""}:${state.activeSeason || 1}:${state.activeEpisode || 1}:${Math.floor(effCur)}:${Math.round(effDur)}:${introStart}:${introEnd}:${extraChapters.length}:${state.appLang || "ru"}`;
  if (_lastActiveChapterKey === chMemoKey) {
    return _lastActiveChapterVal;
  }
  _lastActiveChapterKey = chMemoKey;

  const creditsStart = getDetectedCreditsStartSec(effDur) || 0;

  if (introEnd > 0 && effCur >= introStart && effCur <= introEnd) {
    _lastActiveChapterVal = t("Заставка", "Intro");
    return _lastActiveChapterVal;
  }
  if (creditsStart > 0 && effCur >= creditsStart) {
    _lastActiveChapterVal = t("Титры", "Credits");
    return _lastActiveChapterVal;
  }
  if (!extraChapters.length) {
    _lastActiveChapterVal = "";
    return "";
  }
  let activeTitle = "";
  let bestStart = -1;
  extraChapters.forEach((ch, idx) => {
    const chSec = Number(ch?.start ?? ch?.time ?? ch?.start_sec) || 0;
    const chEnd = Number(ch?.end ?? ch?.end_sec) || 0;
    if (chSec <= effCur && chSec >= bestStart && (!chEnd || effCur < chEnd)) {
      bestStart = chSec;
      activeTitle = String(ch?.title || ch?.label || `${t("Глава", "Chapter")} ${idx + 1}`);
    }
  });
  _lastActiveChapterVal = activeTitle;
  return activeTitle;
}

export function jumpToAdjacentTimelineMarker(direction = 1) {
  const video = document.getElementById("native-video");
  if (!video || !state.isPlayerOpen) return false;
  const { cur, dur } = getEffectivePlaybackTiming(video);
  if (!dur || dur <= 0) return false;

  const points = [{ sec: 0, label: t("Начало", "Start") }];
  const introStart = Number(state.skipSegments?.intro?.start) || Number(state.skipSegments?.intro?.start_sec) || 0;
  const introEnd = Number(state.skipSegments?.intro?.end) || Number(state.skipSegments?.intro?.end_sec) || 0;
  const creditsStart = getDetectedCreditsStartSec(dur) || 0;

  if (introStart > 1 && introStart < dur) {
    points.push({ sec: introStart, label: t("Заставка: начало", "Intro start") });
  }
  if (introEnd > 1 && introEnd < dur) {
    points.push({ sec: introEnd, label: t("Заставка: конец", "Intro end") });
  }
  if (creditsStart > 1 && creditsStart < dur) {
    points.push({ sec: creditsStart, label: t("Титры", "Credits") });
  }
  if (Array.isArray(state.activeItemBookmarks)) {
    state.activeItemBookmarks.forEach((bm) => {
      if (bm && typeof bm.time === "number" && bm.time > 0 && bm.time < dur) {
        points.push({
          sec: bm.time,
          label: bm.note
            ? `${t("Закладка", "Bookmark")}: ${bm.note}`
            : `${t("Закладка", "Bookmark")} (${formatTime(bm.time)})`,
        });
      }
    });
  }
  const extraChapters = Array.isArray(state.remuxMeta?.chapters)
    ? state.remuxMeta.chapters
    : Array.isArray(state.skipSegments?.chapters)
    ? state.skipSegments.chapters
    : [];
  extraChapters.forEach((ch) => {
    const chSec = Number(ch?.start ?? ch?.time ?? ch?.start_sec) || 0;
    if (chSec > 1 && chSec < dur) {
      points.push({
        sec: chSec,
        label: String(ch?.title || ch?.label || `${t("Глава", "Chapter")} (${formatTime(chSec)})`),
      });
    }
  });

  points.sort((a, b) => a.sec - b.sec);
  const target =
    direction > 0
      ? points.find((p) => p.sec > cur + 2.5)
      : [...points].reverse().find((p) => p.sec < cur - 3.5);
  if (!target) return false;
  seekEffectivePlayback(target.sec);
  triggerVideoCenterIndicator(
    direction > 0 ? "fwd10" : "back10",
    `${target.label} · ${formatTime(target.sec)}`
  );
  return true;
}

export function initCustomVideoControls() {
  const stage = document.getElementById("video-stage");
  const controlsBar = document.getElementById("atv-custom-controls");
  const getVideoEl = () => _getVcEl("native-video");
  const timeline = document.getElementById("vc-timeline");
  const hoverTimeEl = document.getElementById("vc-hover-time");
  const playedEl = document.getElementById("vc-played");
  const thumbEl = document.getElementById("vc-thumb");
  if (!stage || !getVideoEl()) return;

  controlsBar?.addEventListener("focusin", () => {
    wakeVideoControls();
  });

  const handleRealPointerMove = (e) => {
    const x = typeof e.clientX === "number" ? e.clientX : -1;
    const y = typeof e.clientY === "number" ? e.clientY : -1;
    if (x >= 0 && y >= 0) {
      const dx = Math.abs(x - state.vcLastMouseX);
      const dy = Math.abs(y - state.vcLastMouseY);
      if (state.vcLastMouseX >= 0 && dx < 2 && dy < 2) {
        return;
      }
      state.vcLastMouseX = x;
      state.vcLastMouseY = y;
    }
    wakeVideoControls();
  };

  stage.addEventListener("mousemove", handleRealPointerMove, { passive: true });
  document.addEventListener(
    "mousemove",
    (e) => {
      if (!state.isPlayerOpen) return;
      if (!isStageFullscreen()) return;
      if (!state.vcIsIdle && Date.now() - (state._lastVcWakeTs || 0) < 220) return;
      if (!stage || !stage.contains(e.target)) {
        handleRealPointerMove(e);
      }
    },
    { passive: true }
  );
  ["pointerdown", "touchstart"].forEach((evName) => {
    stage.addEventListener(evName, () => wakeVideoControls(), { passive: true });
  });
  stage.addEventListener("mouseleave", () => {
    const v = getVideoEl();
    if (v && !v.paused && !v.ended && !state.vcScrubbing && !hasOpenVcPopover()) {
      setVideoStageIdle(true);
    }
  });

  const handleFullscreenChange = () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      state.isPseudoFullscreen = false;
      document.documentElement.classList.remove("is-stage-pseudo-fullscreen");
      document.getElementById("video-stage")?.classList.remove("is-pseudo-fullscreen");
    }
    const fsActive = isStageFullscreen();
    document.documentElement.classList.toggle("is-stage-fullscreen", fsActive);
    beginFullscreenTransitionWindow(540);
    if (!fsActive) {
      document.documentElement.classList.remove("vc-fs-cursor-none");
    }
    syncPostwatchOverlayMount();
    syncToastContainerMount();
    syncPersonModalMount();
    syncCustomVideoControlsUI();
    wakeVideoControls();
    pushDesktopRemoteStateNow();
  };
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);

  // Interactive Timeline Scrubber + Hover Time
  if (timeline) {
    let cachedTimelineRect = null;
    let cachedTimelineRectTs = 0;
    const getTimelineRect = () => {
      const nowRectMs = Date.now();
      if (!cachedTimelineRect || (!state.vcScrubbing && nowRectMs - cachedTimelineRectTs > 250)) {
        cachedTimelineRect = timeline.getBoundingClientRect();
        cachedTimelineRectTs = nowRectMs;
      }
      return cachedTimelineRect;
    };
    const computeRatio = (clientX) => {
      const rect = getTimelineRect();
      if (!rect.width) return 0;
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    };

    window.addEventListener(
      "resize",
      () => {
        cachedTimelineRect = null;
        if (
          state.isPseudoFullscreen &&
          window.webkit?.messageHandlers?.velariumNative &&
          stage &&
          !stage.classList.contains("is-stage-pseudo-fullscreen")
        ) {
          setPseudoStageFullscreen(false);
        }
      },
      { passive: true }
    );

    const updateHoverPreview = (clientX, precomputedRatio = null) => {
      const { cur, dur } = getEffectivePlaybackTiming(getVideoEl());
      if (!dur || !hoverTimeEl) return { ratio: precomputedRatio || 0, snapped: null };
      const rect = getTimelineRect();
      const rawRatio = typeof precomputedRatio === "number" ? precomputedRatio : computeRatio(clientX);
      const snapInfo = getSnappingRatio(rawRatio, dur, rect.width);
      const effectiveRatio = snapInfo.ratio;
      const clampedLeft = Math.min(94, Math.max(6, effectiveRatio * 100));
      const clampedLeftStr = `${clampedLeft.toFixed(2)}%`;
      if (hoverTimeEl._lastHoverLeftPct !== clampedLeftStr) {
        hoverTimeEl._lastHoverLeftPct = clampedLeftStr;
        hoverTimeEl.style.left = clampedLeftStr;
      }
      const hoverSec = effectiveRatio * dur;
      let chapterBadge = "";
      if (snapInfo.snapped) {
        chapterBadge = snapInfo.snapped;
      } else {
        const introStart = Number(state.skipSegments?.intro?.start) || Number(state.skipSegments?.intro?.start_sec) || 0;
        const introEnd = Number(state.skipSegments?.intro?.end) || Number(state.skipSegments?.intro?.end_sec) || 0;
        const creditsStart = getDetectedCreditsStartSec(dur) || 0;

        if (introEnd > 0 && hoverSec >= introStart && hoverSec <= introEnd) {
          chapterBadge = t("Заставка", "Intro");
        } else if (creditsStart > 0 && hoverSec >= creditsStart) {
          chapterBadge = t("Титры", "Credits");
        }
      }
      const deltaSec = Math.round(hoverSec - (Number(cur) || 0));
      const hoverSecInt = Math.floor(hoverSec);
      const remSec = Math.max(0, Math.round(dur - hoverSec));
      const hoverKey = `${hoverSecInt}|${deltaSec}|${remSec}|${chapterBadge}`;
      if (hoverTimeEl._lastHoverKey !== hoverKey) {
        hoverTimeEl._lastHoverKey = hoverKey;
        const deltaText =
          Math.abs(deltaSec) >= 1
            ? `${deltaSec > 0 ? "+" : "−"}${formatTime(Math.abs(deltaSec))}`
            : "";
        const remText = `−${formatTime(remSec)}`;
        const nextHtml = `${
          chapterBadge ? `<span class="atv-vc-hover-chapter">${escapeHtml(chapterBadge)}</span>` : ""
        }<span class="atv-vc-hover-main"><span class="atv-vc-hover-target">${escapeHtml(
          formatTime(hoverSec)
        )}</span>${
          deltaText ? `<span class="atv-vc-hover-delta">${escapeHtml(deltaText)}</span>` : ""
        }<span class="atv-vc-hover-rem">${escapeHtml(remText)}</span></span>`;
        if (hoverTimeEl._lastHoverHtml !== nextHtml) {
          hoverTimeEl._lastHoverHtml = nextHtml;
          hoverTimeEl.innerHTML = nextHtml;
        }
      }
      if (hoverTimeEl.classList.contains("hidden")) {
        hoverTimeEl.classList.remove("hidden");
      }
      return snapInfo;
    };

    timeline.addEventListener("pointermove", (e) => {
      const rawRatio = computeRatio(e.clientX);
      const snapInfo = updateHoverPreview(e.clientX, rawRatio);
      if (state.vcScrubbing) {
        const v = getVideoEl();
        const { dur } = getEffectivePlaybackTiming(v);
        const ratio = snapInfo ? snapInfo.ratio : rawRatio;
        const pct = ratio * 100;
        const pctStr = `${pct.toFixed(2)}%`;
        if (playedEl && playedEl.style.width !== pctStr) playedEl.style.width = pctStr;
        if (thumbEl && thumbEl.style.left !== pctStr) thumbEl.style.left = pctStr;
        const timeBtn = _getVcEl("vc-time-label");
        if (timeBtn && dur > 0) {
          const previewSec = ratio * dur;
          const scrubSecInt = Math.floor(previewSec);
          if (timeBtn._lastScrubSec !== scrubSecInt) {
            timeBtn._lastScrubSec = scrubSecInt;
            timeBtn.textContent = state.vcShowRemaining
              ? `${formatTime(previewSec)} / -${formatTime(Math.max(0, dur - previewSec))}`
              : `${formatTime(previewSec)} / ${formatTime(dur)}`;
          }
        }
      }
    });

    const hideTimelineHoverPreview = () => {
      cachedTimelineRect = null;
      if (!state.vcScrubbing && hoverTimeEl) {
        hoverTimeEl.classList.add("hidden");
      }
    };
    timeline.addEventListener("pointerleave", hideTimelineHoverPreview);
    timeline.addEventListener("mouseleave", hideTimelineHoverPreview);

    timeline.addEventListener("pointerdown", (e) => {
      if (e.target && e.target.closest && e.target.closest(".atv-vc-bookmark-pin")) {
        return;
      }
      e.stopPropagation();
      cachedTimelineRect = timeline.getBoundingClientRect();
      const v = getVideoEl();
      const { dur } = getEffectivePlaybackTiming(v);
      if (!dur) return;
      state.vcScrubbing = true;
      timeline.classList.add("scrubbing");
      try {
        timeline.setPointerCapture(e.pointerId);
      } catch (err) { window.logDebug?.("PlayerUiControls", err); }
      const rawRatio = computeRatio(e.clientX);
      const snapInfo = updateHoverPreview(e.clientX, rawRatio);
      const ratio = snapInfo ? snapInfo.ratio : rawRatio;
      const pct = ratio * 100;
      if (playedEl) playedEl.style.width = `${pct}%`;
      if (thumbEl) thumbEl.style.left = `${pct}%`;
      const timeBtn = document.getElementById("vc-time-label");
      if (timeBtn && dur > 0) {
        const previewSec = ratio * dur;
        timeBtn.textContent = state.vcShowRemaining
          ? `${formatTime(previewSec)} / -${formatTime(Math.max(0, dur - previewSec))}`
          : `${formatTime(previewSec)} / ${formatTime(dur)}`;
      }
    });

    const finishScrub = (e) => {
      const widthPx = cachedTimelineRect?.width || 0;
      cachedTimelineRect = null;
      if (!state.vcScrubbing) return;
      state.vcScrubbing = false;
      timeline.classList.remove("scrubbing");
      const { dur } = getEffectivePlaybackTiming(getVideoEl());
      if (dur > 0 && typeof e.clientX === "number") {
        const rawRatio = computeRatio(e.clientX);
        const { ratio } = getSnappingRatio(rawRatio, dur, widthPx);
        seekEffectivePlayback(ratio * dur, { immediate: true });
      }
      hoverTimeEl?.classList.add("hidden");
      syncCustomVideoControlsUI();
      wakeVideoControls();
    };
    timeline.addEventListener("pointerup", finishScrub);
    timeline.addEventListener("pointercancel", finishScrub);
    timeline.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        const { cur, dur } = getEffectivePlaybackTiming(getVideoEl());
        const step = e.key === "ArrowRight" ? 10 : -10;
        const maxDur = dur > 0 ? dur : cur + 10;
        const target = Math.max(0, Math.min(maxDur, cur + step));
        seekEffectivePlayback(target);
        wakeVideoControls();
      }
    });
  }

  document.getElementById("btn-next-ep-now")?.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissPlayerNextEpisodeToast(false);
    stepEpisode(1);
  });

  document.getElementById("btn-next-ep-cancel")?.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissPlayerNextEpisodeToast(true);
  });

  document.getElementById("vc-btn-play")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.detail > 0) e.currentTarget?.blur?.();
    toggleVideoPlayPause(true);
  });

  document.getElementById("vc-btn-back10")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.detail > 0) e.currentTarget?.blur?.();
    const { cur } = getEffectivePlaybackTiming(getVideoEl());
    const target = Math.max(0, cur - 10);
    const nowBurst = Date.now();
    if (nowBurst - (state.seekBurstLastTs || 0) < 950 && (state.seekBurstAccumSec || 0) < 0) {
      state.seekBurstAccumSec -= 10;
    } else {
      state.seekBurstAccumSec = -10;
    }
    state.seekBurstLastTs = nowBurst;
    const absBurst = Math.abs(state.seekBurstAccumSec);
    seekEffectivePlayback(target);
    triggerVideoCenterIndicator("back10", `−${absBurst} ${t("секунд", "sec")} · ${formatTime(target)}`);
  });

  document.getElementById("vc-btn-fwd10")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.detail > 0) e.currentTarget?.blur?.();
    const { cur, dur } = getEffectivePlaybackTiming(getVideoEl());
    const maxDur = dur > 0 ? dur : cur + 10;
    const target = Math.min(maxDur, cur + 10);
    const nowBurst = Date.now();
    if (nowBurst - (state.seekBurstLastTs || 0) < 950 && (state.seekBurstAccumSec || 0) > 0) {
      state.seekBurstAccumSec += 10;
    } else {
      state.seekBurstAccumSec = 10;
    }
    state.seekBurstLastTs = nowBurst;
    seekEffectivePlayback(target);
    triggerVideoCenterIndicator("fwd10", `+${state.seekBurstAccumSec} ${t("секунд", "sec")} · ${formatTime(target)}`);
  });

  document.getElementById("vc-btn-mute")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.detail > 0) e.currentTarget?.blur?.();
    const video = getVideoEl();
    if (!video) return;
    state.userMutedThisSession = !video.muted;
    video.muted = state.userMutedThisSession;
    if (!video.muted && video.volume <= 0.02) {
      video.volume = 0.85;
      savePlayerPrefs({ volume: 0.85, muted: false });
    }
    resumeAudioContextIfNeeded();
    triggerVideoCenterIndicator(
      video.muted ? "mute" : "unmute",
      video.muted ? t("Без звука", "Muted") : `${Math.round(video.volume * 100)}%`
    );
    syncCustomVideoControlsUI(true);
    pushDesktopRemoteStateNow();
  });

  const volSlider = document.getElementById("vc-vol-slider");
  let _volPrefTimer = null;
  if (volSlider) {
    volSlider.addEventListener("input", (e) => {
      e.stopPropagation();
      const video = getVideoEl();
      if (!video) return;
      const v = Math.min(1, Math.max(0, parseFloat(e.target.value) || 0));
      video.volume = v;
      state.userMutedThisSession = v === 0;
      video.muted = state.userMutedThisSession;
      if (v > 0.02) {
        if (_volPrefTimer) clearTimeout(_volPrefTimer);
        _volPrefTimer = setTimeout(() => {
          savePlayerPrefs({ volume: v, muted: false });
        }, 200);
      }
      resumeAudioContextIfNeeded();
      syncCustomVideoControlsUI(true);
      scheduleDesktopRemoteStatePush(120);
    });
  }

  document.getElementById("vc-time-label")?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.vcShowRemaining = !state.vcShowRemaining;
    syncCustomVideoControlsUI();
  });

  const bindVcPopBtn = (btnId, popId) => {
    const btn = document.getElementById(btnId);
    const pop = document.getElementById(popId);
    if (!btn || !pop) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.classList.contains("is-readonly-badge")) return;
      const wasHidden = pop.classList.contains("hidden");
      closeFloatingPopovers();
      if (wasHidden) {
        pop.classList.remove("hidden");
        syncCustomControlPopovers();
        btn.setAttribute("aria-expanded", "true");
        clampStagePopover(pop);
        requestAnimationFrame(() => {
          pop.querySelector(".atv-vc-pop-item.active")?.scrollIntoView({ block: "nearest" });
        });
      }
      syncVcPopoverOpenClass();
      wakeVideoControls();
    });
  };
  bindVcPopBtn("vc-btn-episodes", "vc-episodes-popover");
  bindVcPopBtn("vc-btn-studio", "vc-studio-popover");
  bindVcPopBtn("vc-btn-subs", "vc-subs-popover");
  bindVcPopBtn("vc-btn-quality", "vc-quality-popover");

  document.getElementById("vc-btn-xray")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAllVcPopovers({ resumeFromSubDict: false });
    toggleXRayPauseShelf();
    wakeVideoControls();
  });

  document.getElementById("vc-btn-pip")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.detail > 0) e.currentTarget?.blur?.();
    togglePictureInPicture();
  });

  const fsBtnEl = document.getElementById("vc-btn-fs");
  if (fsBtnEl) {
    fsBtnEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    fsBtnEl.addEventListener("keydown", (e) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget?.blur?.();
        toggleVideoPlayPause(true);
      }
    });
    fsBtnEl.addEventListener("keyup", (e) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    fsBtnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      e.currentTarget?.blur?.();
      toggleStageFullscreen();
    });
  }

  syncCustomVideoControlsUI();
}

export function initPlayerStageAndGearBindings() {
  const togglePlayerSidebarBtn = document.getElementById("btn-toggle-player-sidebar");
  if (togglePlayerSidebarBtn) {
    togglePlayerSidebarBtn.onclick = (e) => {
      e.stopPropagation();
      togglePlayerSidebarCollapsed(true);
    };
  }

  const playerGearBtn = document.getElementById("btn-player-gear");
  const playerGearPopover = document.getElementById("player-gear-popover");
  const closePlayerGearBtn = document.getElementById("btn-close-player-gear");
  if (playerGearBtn && playerGearPopover) {
    playerGearPopover.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isCustomSelectMenuOpen() && !e.target?.closest?.(".atv-cselect-btn, label[for]")) {
        closeCustomSelectMenu({ restoreFocus: false });
      }
    });
    playerGearBtn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = playerGearPopover.classList.contains("hidden");
      closeFloatingPopovers();
      if (willOpen) {
        playerGearPopover.classList.remove("hidden");
        playerGearBtn.classList.add("active");
        playerGearBtn.setAttribute("aria-expanded", "true");
        clampStagePopover(playerGearPopover);
      }
      syncVcPopoverOpenClass();
      wakeVideoControls();
    };
  }
  if (closePlayerGearBtn && playerGearPopover) {
    closePlayerGearBtn.onclick = (e) => {
      e.stopPropagation();
      closeCustomSelectMenu({ restoreFocus: false });
      playerGearPopover.classList.add("hidden");
      playerGearBtn?.classList.remove("active");
      playerGearBtn?.setAttribute("aria-expanded", "false");
      syncVcPopoverOpenClass();
      wakeVideoControls();
    };
  }
  const gearSubSyncDetails = document.getElementById("gear-sub-sync-details");
  if (gearSubSyncDetails && playerGearPopover) {
    gearSubSyncDetails.addEventListener("toggle", () => {
      if (!playerGearPopover.classList.contains("hidden")) {
        clampStagePopover(playerGearPopover);
      }
    });
  }
  const resetPlayerGearBtn = document.getElementById("btn-reset-player-gear");
  if (resetPlayerGearBtn) {
    resetPlayerGearBtn.onclick = (e) => {
      e.stopPropagation();
      const video = document.getElementById("native-video");
      if (video) {
        ensurePreservesPitch(video);
        video.playbackRate = 1.0;
      }
      const speedSel = document.getElementById("select-speed");
      if (speedSel) speedSel.value = "1";
      applyAudioBoostToVideo(video, 1.0, "flat");
      applyVideoCropToVideo(video, "contain");
      applySubtitleStylePrefs("medium", "semi", "sans", "white", "soft");
      setSleepTimer("off");
      resetAudioOffset(false);
      resetSubtitleOffset(false);
      state.ambilightEnabled = true;
      state.autoSkipIntro = true;
      state.autoNextEpisode = true;
      const ambiToggle = document.getElementById("ambilight-toggle");
      if (ambiToggle) ambiToggle.checked = true;
      const introToggle = document.getElementById("auto-skip-intro-toggle");
      if (introToggle) introToggle.checked = true;
      const nextToggle = document.getElementById("auto-next-ep-toggle");
      if (nextToggle) nextToggle.checked = true;
      startAmbilightLoop();
      savePlayerPrefs({
        playbackRate: 1.0,
        audioBoost: 1.0,
        audioPreset: "flat",
        videoCrop: "contain",
        subSize: "medium",
        subBg: "semi",
        subFont: "sans",
        subColor: "white",
        subEdge: "soft",
        ambilightEnabled: true,
        autoSkipIntro: true,
        autoNextEpisode: true,
      });
      updatePlayerGearActiveDot();
      pushDesktopRemoteStateNow();
      showToast(t("Настройки плеера сброшены по умолчанию", "Player settings reset to defaults"));
    };
  }
  const playerInfoSidebar = document.querySelector("#player-modal .atv-info-sidebar");
  if (playerInfoSidebar) {
    playerInfoSidebar.addEventListener(
      "scroll",
      () => {
        playerInfoSidebar.classList.toggle("is-scrolled", playerInfoSidebar.scrollTop > 8);
      },
      { passive: true }
    );
  }

  const toggleGearHotkeysBtn = document.getElementById("btn-toggle-gear-hotkeys");
  const gearHotkeysBox = document.getElementById("gear-hotkeys-box");
  if (toggleGearHotkeysBtn && gearHotkeysBox) {
    toggleGearHotkeysBtn.onclick = (e) => {
      e.stopPropagation();
      const willShow = gearHotkeysBox.classList.contains("hidden");
      gearHotkeysBox.classList.toggle("hidden", !willShow);
      toggleGearHotkeysBtn.classList.toggle("active", willShow);
      toggleGearHotkeysBtn.setAttribute("aria-expanded", willShow ? "true" : "false");
      if (willShow && playerGearPopover) {
        requestAnimationFrame(() => {
          const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
          try {
            playerGearPopover.scrollTo({ top: playerGearPopover.scrollHeight, behavior: reduced ? "auto" : "smooth" });
          } catch (_) {
            playerGearPopover.scrollTop = playerGearPopover.scrollHeight;
          }
        });
      }
    };
  }

  document.querySelectorAll("#gear-speed-pills .gear-speed-pill").forEach((pill) => {
    pill.onclick = (e) => {
      e.stopPropagation();
      const rate = parseFloat(pill.dataset.speed) || 1.0;
      const video = document.getElementById("native-video");
      if (video) {
        ensurePreservesPitch(video);
        video.playbackRate = rate;
      }
      const speedSel = document.getElementById("select-speed");
      if (speedSel) {
        speedSel.value = String(rate);
      }
      savePlayerPrefs({ playbackRate: rate });
      updatePlayerGearActiveDot();
      pushDesktopRemoteStateNow();
      showToast(t(`Скорость: ${rate}x`, `Speed: ${rate}x`));
    };
  });

  document.getElementById("btn-gear-audio-minus")?.addEventListener("click", (e) => {
    e.stopPropagation();
    adjustAudioOffset(-0.05, true);
  });
  document.getElementById("gear-audio-offset-val")?.addEventListener("click", (e) => {
    e.stopPropagation();
    resetAudioOffset(true);
  });
  document.getElementById("btn-gear-audio-plus")?.addEventListener("click", (e) => {
    e.stopPropagation();
    adjustAudioOffset(0.05, true);
  });

  document.getElementById("btn-gear-sub-minus")?.addEventListener("click", (e) => {
    e.stopPropagation();
    adjustSubtitleOffset(-0.25, true);
  });
  document.getElementById("gear-sub-offset-val")?.addEventListener("click", (e) => {
    e.stopPropagation();
    resetSubtitleOffset(true);
  });
  document.getElementById("btn-gear-sub-plus")?.addEventListener("click", (e) => {
    e.stopPropagation();
    adjustSubtitleOffset(0.25, true);
  });

  const setEpisodeViewMode = (mode) => {
    state.epViewMode = mode;
    try {
      localStorage.setItem(EP_VIEW_MODE_STORAGE_KEY, mode);
    } catch (err) {
      window.logDebug?.("PlayerControls", err);
    }
    if (state.activeItem) {
      const effMap = resolveEffectiveSeasonsMap(state.activeItem, state.seasonsMap);
      populateSeasonEpisodeSelectors(state.activeItem, effMap);
    }
  };
  document.getElementById("btn-ep-view-grid")?.addEventListener("click", () => setEpisodeViewMode("grid"));
  document.getElementById("btn-ep-view-strip")?.addEventListener("click", () => setEpisodeViewMode("strip"));
  const toggleEpStripBtn = document.getElementById("btn-toggle-episodes-strip");
  if (toggleEpStripBtn) {
    toggleEpStripBtn.onclick = () => {
      state.episodesStripExpanded = !state.episodesStripExpanded;
      syncEpisodesStripDrawerUI();
      if (state.episodesStripExpanded) {
        const activePill = document.querySelector("#episodes-strip-bar .atv-ep-pill.active");
        if (activePill) {
          requestAnimationFrame(() => {
            try {
              activePill.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
            } catch (err) {
              window.logDebug?.("PlayerControls", err);
            }
          });
        }
      }
    };
  }
  const epStripWheelEl = document.getElementById("episodes-strip-bar");
  if (epStripWheelEl) {
    attachHorizontalWheelScroll(epStripWheelEl);
  }

  const kinStatusMenuBtn = document.getElementById("btn-kinorium-status-menu");
  const kinStatusPopover = document.getElementById("kinorium-status-popover");
  if (kinStatusMenuBtn && kinStatusPopover) {
    kinStatusMenuBtn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = kinStatusPopover.classList.contains("hidden");
      closeFloatingPopovers({ exceptId: "kinorium-status-popover" });
      if (willOpen) {
        kinStatusPopover.classList.remove("hidden");
        kinStatusMenuBtn.setAttribute("aria-expanded", "true");
        clampFloatingPopover(kinStatusPopover);
      } else {
        kinStatusPopover.classList.add("hidden");
        kinStatusMenuBtn.setAttribute("aria-expanded", "false");
      }
    };
  }

  const restoreMiniBtn = document.getElementById("btn-restore-mini-player");
  if (restoreMiniBtn) {
    restoreMiniBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    restoreMiniBtn.onclick = (e) => {
      e.stopPropagation();
      restoreFullPlayerFromPip();
    };
  }
  const closeMiniBtn = document.getElementById("btn-close-mini-player");
  if (closeMiniBtn) {
    closeMiniBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    closeMiniBtn.onclick = (e) => {
      e.stopPropagation();
      closePlayerModal(false, true);
    };
  }
  const miniPlayPauseBtn = document.getElementById("btn-mini-play-pause");
  if (miniPlayPauseBtn) {
    miniPlayPauseBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    miniPlayPauseBtn.onclick = (e) => {
      e.stopPropagation();
      toggleVideoPlayPause(false);
    };
  }
  const miniNextEpBtn = document.getElementById("btn-mini-next-ep");
  if (miniNextEpBtn) {
    miniNextEpBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    miniNextEpBtn.onclick = (e) => {
      e.stopPropagation();
      stepEpisode(1);
    };
  }

  document.getElementById("btn-pip-go-home")?.addEventListener("click", (e) => {
    e.stopPropagation();
    setPipBackgroundMode(true);
    showToast(
      t(
        "Вы на главной странице — видео продолжает играть в режиме «Картинка в картинке»",
        "Back on Home — video continues playing in Picture-in-Picture"
      )
    );
  });
  document.getElementById("btn-pip-return-inline")?.addEventListener("click", (e) => {
    e.stopPropagation();
    restoreFullPlayerFromPip();
  });
  document.getElementById("btn-pip-dock-play")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleVideoPlayPause(false);
  });
  document.getElementById("btn-pip-dock-next-ep")?.addEventListener("click", (e) => {
    e.stopPropagation();
    stepEpisode(1);
  });
  document.getElementById("btn-pip-dock-restore")?.addEventListener("click", (e) => {
    e.stopPropagation();
    restoreFullPlayerFromPip();
  });
  document.getElementById("pip-dock-title")?.addEventListener("click", (e) => {
    e.stopPropagation();
    restoreFullPlayerFromPip();
  });
  document.querySelector("#pip-status-dock .atv-pip-dock-badge")?.addEventListener("click", (e) => {
    e.stopPropagation();
    restoreFullPlayerFromPip();
  });
  document.getElementById("btn-pip-dock-close")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closePlayerModal(false, true);
  });

  const miniBarEl = document.getElementById("mini-player-bar");
  const cinemaSheetEl = document.querySelector("#player-modal .atv-cinema-sheet");
  if (miniBarEl && cinemaSheetEl) {
    let isDraggingMini = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let dragSheetW = 0;
    let dragSheetH = 0;

    miniBarEl.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      setMiniPlayerMode(false);
    });

    miniBarEl.addEventListener("pointerdown", (e) => {
      if (!state.isMiniPlayer || e.target.closest("button")) return;
      isDraggingMini = true;
      miniBarEl.classList.add("dragging");
      const rect = cinemaSheetEl.getBoundingClientRect();
      dragSheetW = rect.width;
      dragSheetH = rect.height;
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      cinemaSheetEl.style.position = "fixed";
      cinemaSheetEl.style.left = `${rect.left}px`;
      cinemaSheetEl.style.top = `${rect.top}px`;
      cinemaSheetEl.style.right = "auto";
      cinemaSheetEl.style.bottom = "auto";
      try {
        miniBarEl.setPointerCapture(e.pointerId);
      } catch (err) {
        window.logDebug?.("PlayerControls", err);
      }
    });

    miniBarEl.addEventListener("pointermove", (e) => {
      if (!isDraggingMini || !state.isMiniPlayer) return;
      const maxX = Math.max(12, window.innerWidth - dragSheetW - 12);
      const maxY = Math.max(12, window.innerHeight - dragSheetH - 12);
      const nextX = Math.min(maxX, Math.max(12, e.clientX - dragOffsetX));
      const nextY = Math.min(maxY, Math.max(12, e.clientY - dragOffsetY));
      cinemaSheetEl.style.left = `${Math.round(nextX)}px`;
      cinemaSheetEl.style.top = `${Math.round(nextY)}px`;
    });

    const stopMiniDrag = () => {
      if (!isDraggingMini) return;
      isDraggingMini = false;
      miniBarEl.classList.remove("dragging");
    };
    miniBarEl.addEventListener("pointerup", stopMiniDrag);
    miniBarEl.addEventListener("pointercancel", stopMiniDrag);

    window.addEventListener("resize", () => {
      if (!state.isMiniPlayer || cinemaSheetEl.style.position !== "fixed") return;
      const rect = cinemaSheetEl.getBoundingClientRect();
      const maxX = Math.max(12, window.innerWidth - rect.width - 12);
      const maxY = Math.max(12, window.innerHeight - rect.height - 12);
      const curX = parseFloat(cinemaSheetEl.style.left) || rect.left;
      const curY = parseFloat(cinemaSheetEl.style.top) || rect.top;
      cinemaSheetEl.style.left = `${Math.round(Math.min(maxX, Math.max(12, curX)))}px`;
      cinemaSheetEl.style.top = `${Math.round(Math.min(maxY, Math.max(12, curY)))}px`;
    });
  }

  const videoCropSelect = document.getElementById("select-video-crop");
  if (videoCropSelect) {
    videoCropSelect.onchange = (e) => {
      const mode = e.target.value || "contain";
      const video = document.getElementById("native-video");
      applyVideoCropToVideo(video, mode);
      savePlayerPrefs({ videoCrop: mode });
      showToast(t(`Экран: ${getVideoCropLabel(mode)}`, `Aspect: ${getVideoCropLabel(mode)}`));
    };
  }

  const markEpUptoBtn = document.getElementById("btn-mark-ep-upto");
  if (markEpUptoBtn) {
    markEpUptoBtn.onclick = () => markEpisodesBatch("upto");
  }
  const markSeasonWatchedBtn = document.getElementById("btn-mark-season-watched");
  if (markSeasonWatchedBtn) {
    markSeasonWatchedBtn.onclick = () => markEpisodesBatch("season");
  }

  const sleepTimerSelect = document.getElementById("select-sleep-timer");
  if (sleepTimerSelect) {
    sleepTimerSelect.onchange = (e) => {
      const val = e.target.value || "off";
      setSleepTimer(val);
      if (val === "off") {
        showToast(t("Таймер сна выключен", "Sleep timer off"));
      }
    };
  }

  const screenshotBtn = document.getElementById("btn-screenshot");
  if (screenshotBtn) {
    screenshotBtn.onclick = () => captureVideoScreenshot();
  }

  document.querySelectorAll(".source-tab").forEach((tab) => {
    tab.onclick = () => switchSourceTab(tab.dataset.tab, null, { fromUserClick: true });
  });

  const subSizeSelect = document.getElementById("select-sub-size");
  if (subSizeSelect) {
    subSizeSelect.onchange = (e) => {
      const val = e.target.value || "medium";
      applySubtitleStylePrefs(val, state.subBg, state.subFont, state.subColor, state.subEdge);
      savePlayerPrefs({ subSize: val });
      showToast(t("Размер шрифта субтитров обновлён", "Subtitle font size updated"));
    };
  }

  const subBgSelect = document.getElementById("select-sub-bg");
  if (subBgSelect) {
    subBgSelect.onchange = (e) => {
      const val = e.target.value || "semi";
      applySubtitleStylePrefs(state.subSize, val, state.subFont, state.subColor, state.subEdge);
      savePlayerPrefs({ subBg: val });
      showToast(t("Оформление подложки субтитров обновлено", "Subtitle background style updated"));
    };
  }

  const subFontSelect = document.getElementById("select-sub-font");
  if (subFontSelect) {
    subFontSelect.onchange = (e) => {
      const val = e.target.value || "sans";
      applySubtitleStylePrefs(state.subSize, state.subBg, val, state.subColor, state.subEdge);
      savePlayerPrefs({ subFont: val });
      showToast(t("Шрифт субтитров обновлён", "Subtitle font updated"));
    };
  }

  const subColorSelect = document.getElementById("select-sub-color");
  if (subColorSelect) {
    subColorSelect.onchange = (e) => {
      const val = e.target.value || "white";
      applySubtitleStylePrefs(state.subSize, state.subBg, state.subFont, val, state.subEdge);
      savePlayerPrefs({ subColor: val });
      showToast(t("Цвет текста субтитров обновлён", "Subtitle text color updated"));
    };
  }

  const subEdgeSelect = document.getElementById("select-sub-edge");
  if (subEdgeSelect) {
    subEdgeSelect.onchange = (e) => {
      const val = e.target.value || "soft";
      applySubtitleStylePrefs(state.subSize, state.subBg, state.subFont, state.subColor, val);
      savePlayerPrefs({ subEdge: val });
      showToast(t("Контур и тень субтитров обновлены", "Subtitle outline & shadow updated"));
    };
  }

  const ambilightToggle = document.getElementById("ambilight-toggle");
  if (ambilightToggle) {
    ambilightToggle.onchange = (e) => {
      state.ambilightEnabled = Boolean(e.target.checked);
      savePlayerPrefs({ ambilightEnabled: state.ambilightEnabled });
      if (state.ambilightEnabled) {
        startAmbilightLoop();
        showToast(t("Динамическая подсветка Ambilight включена", "Dynamic Ambilight glow enabled"));
      } else {
        stopAmbilightLoop(true);
        showToast(t("Подсветка Ambilight выключена", "Ambilight glow disabled"));
      }
    };
  }

  const studioSelEl = document.getElementById("select-studio");
  if (studioSelEl) {
    studioSelEl.onchange = (e) => {
      if (state.activeSourceTab === "offline") {
        const chosenDl = (state.downloadsItems || []).find(
          (x) => String(x?.download_id || "") === String(e.target.value || "") && x.status === "completed"
        );
        if (chosenDl) {
          const video = document.getElementById("native-video");
          const { cur } = getEffectivePlaybackTiming(video);
          loadOfflineStreamForActiveTitle(cur || 0, chosenDl);
        }
        return;
      }
      if (
        (state.activeSourceTab === "backup4k" || state.activeSourceTab === "stremio") &&
        state.remuxMeta?.active
      ) {
        switchRemuxAudioTrack(parseInt(e.target.value, 10) || 0);
        return;
      }
      state.activeStudioId = String(e.target.value || "");
      const selectedOpt =
        e.target.options?.[e.target.selectedIndex] ||
        Array.from(e.target.options || []).find((o) => String(o.value) === String(e.target.value));
      const studioName = selectedOpt ? selectedOpt.textContent : state.activeStudioName;
      const rawStudioName = selectedOpt?.dataset?.rawName || studioName;
      state.activeStudioName = studioName;
      if (selectedOpt && selectedOpt.dataset.isOriginal !== "1") {
        state.lastNonOriginalStudioId = String(state.activeStudioId);
      }
      if (state.activeItem) {
        savePreferredStudioForItem(state.activeItem, state.activeStudioId, rawStudioName);
        showToast(t(`Озвучка сохранена: ${studioName}`, `Audio track saved: ${studioName}`));
      }
      const video = document.getElementById("native-video");
      const { cur: rawCur } = getEffectivePlaybackTiming(video);
      const cur = Math.max(
        rawCur > 2 ? rawCur : 0,
        Number(state.lastPlaybackMediaTime) > 2 ? Number(state.lastPlaybackMediaTime) : 0,
        Number(state.lastKnownPlaybackTime) > 2 ? Number(state.lastKnownPlaybackTime) : 0
      );
      loadHDRezkaStream(cur || 0, { forceRefresh: true });
    };
  }

  const seasonSelectEl = document.getElementById("select-season");
  if (seasonSelectEl) {
    seasonSelectEl.onchange = async (e) => {
      if (seasonSelectEl.disabled) return;
      const targetSeason = parseInt(e.target.value, 10) || 1;
      const effMap = resolveEffectiveSeasonsMap(state.activeItem, state.seasonsMap);
      const rawEps = effMap?.[String(targetSeason)] || [1];
      const epsForSeason = filterReleasedEpisodesForSeason(
        state.activeItem,
        targetSeason,
        rawEps
      );
      const targetEpisode = Array.isArray(epsForSeason) && epsForSeason.length > 0 ? epsForSeason[0] : 1;
      await switchToSeriesSeasonEpisode(targetSeason, targetEpisode);
    };
  }

  const btnPrevEp = document.getElementById("btn-prev-ep");
  if (btnPrevEp) {
    btnPrevEp.onclick = () => stepEpisode(-1);
  }
  const btnNextEp = document.getElementById("btn-next-ep");
  if (btnNextEp) {
    btnNextEp.onclick = () => stepEpisode(1);
  }

  const qualitySelEl = document.getElementById("select-quality");
  if (qualitySelEl) {
    qualitySelEl.onchange = (e) => {
      const qKey = e.target.value;
      const url = state.qualities[qKey];
      const video = document.getElementById("native-video");
      state.abrTargetQuality = qKey;
      state.abrCurrentQuality = qKey;
      state.abrSwitching = false;
      state.abrStableTicks = 0;
      state.abrLowBufferTicks = 0;
      state.abrLastSwitchTs = Date.now();
      state.abrDownshiftedQualities = new Set();
      savePlayerPrefs({ preferredQuality: qKey });
      const { cur: rawCur } = getEffectivePlaybackTiming(video);
      const cur = Math.max(
        rawCur > 2 ? rawCur : 0,
        Number(state.lastPlaybackMediaTime) > 2 ? Number(state.lastPlaybackMediaTime) : 0,
        Number(state.lastKnownPlaybackTime) > 2 ? Number(state.lastKnownPlaybackTime) : 0
      );
      const tokenStale =
        state.activeSourceTab === "hdrezka" &&
        (Boolean(video?.error) ||
          !url ||
          (state.streamMintedAt > 0 && Date.now() - Number(state.streamMintedAt || 0) > 12 * 60 * 1000));
      if (tokenStale) {
        state.tokenRefreshTimestamps = [];
        state.usedBackupUrls = new Set();
        loadHDRezkaStream(cur || 0, { forceRefresh: true });
        showToast(t(`Качество сохранено по умолчанию: ${qKey}`, `Default quality saved: ${qKey}`));
        pushDesktopRemoteStateNow();
        return;
      }
      if (url) {
        if (state.remuxMeta?.active) {
          const freshRemuxUrl = buildRemuxStreamEndpoint(state.remuxMeta, cur || 0);
          playVideoUrl(freshRemuxUrl, 0, state.playerSessionId, {
            keepRemuxMeta: true,
            newRemuxOffsetSec: cur || 0,
          });
        } else {
          captureVideoFrameBridge(video);
          playVideoUrl(url, cur || 0, state.playerSessionId, { silentAbrSwitch: true });
        }
        showToast(t(`Качество сохранено по умолчанию: ${qKey}`, `Default quality saved: ${qKey}`));
        pushDesktopRemoteStateNow();
      }
    };
  }

  const speedSelect = document.getElementById("select-speed");
  if (speedSelect) {
    speedSelect.onchange = (e) => {
      const rate = parseFloat(e.target.value) || 1.0;
      const video = document.getElementById("native-video");
      if (video) {
        ensurePreservesPitch(video);
        video.playbackRate = rate;
      }
      savePlayerPrefs({ playbackRate: rate });
      updatePlayerGearActiveDot();
      pushDesktopRemoteStateNow();
      showToast(t(`Скорость: ${rate}x`, `Speed: ${rate}x`));
    };
  }

  const audioBoostSelect = document.getElementById("select-audio-boost");
  if (audioBoostSelect) {
    audioBoostSelect.onchange = (e) => {
      const boost = parseFloat(e.target.value) || 1.0;
      const video = document.getElementById("native-video");
      applyAudioBoostToVideo(video, boost, state.audioPreset);
      savePlayerPrefs({ audioBoost: boost });
      showToast(
        boost > 1
          ? t(`Усиление звука: ${Math.round(boost * 100)}%`, `Audio Boost: ${Math.round(boost * 100)}%`)
          : t("Усиление звука: 100% (Стандарт)", "Audio Boost: 100% (Standard)")
      );
    };
  }

  const audioEqSelect = document.getElementById("select-audio-eq");
  if (audioEqSelect) {
    audioEqSelect.onchange = (e) => {
      const preset = e.target.value || "flat";
      const video = document.getElementById("native-video");
      applyAudioBoostToVideo(video, state.audioBoost, preset);
      savePlayerPrefs({ audioPreset: preset });
      showToast(t(`Режим звука: ${getAudioPresetLabel(preset)}`, `Audio mode: ${getAudioPresetLabel(preset)}`));
    };
  }

  const subSelect = document.getElementById("select-subtitle");
  if (subSelect) {
    subSelect.onchange = (e) => {
      state.activeSubtitleIndex = parseInt(e.target.value, 10);
      activateSelectedSubtitleTrack();
      syncCustomControlPopovers();
      const chosenSub = state.subtitles[state.activeSubtitleIndex];
      savePlayerPrefs({ preferredSubtitleLang: chosenSub ? chosenSub.lang : "off" });
      updatePlayerGearActiveDot();
      pushDesktopRemoteStateNow();
      showToast(
        chosenSub
          ? t(`Субтитры по умолчанию: ${chosenSub.lang}`, `Default subtitles: ${chosenSub.lang}`)
          : t("Субтитры выключены", "Subtitles off")
      );
    };
  }

  const downloadBtn = document.getElementById("btn-download-stream");
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      if (!state.activeItem) return;
      const item = state.activeItem;
      const itemTitle = displayTitle(item) || item.title;
      const qualSel = document.getElementById("select-quality");
      const qKey = qualSel?.value || "1080p";
      const epTag =
        item.media_type === "series"
          ? ` - S${String(state.activeSeason).padStart(2, "0")}E${String(state.activeEpisode).padStart(2, "0")}`
          : item.year
          ? ` (${item.year})`
          : "";
      if (state.remuxMeta?.active && state.remuxMeta.rawSourceUrl) {
        const activeTrack =
          (state.remuxMeta.audioTracks || []).find(
            (tr) => Number(tr.audio_index ?? tr.index) === Number(state.remuxMeta.audioIndex)
          ) ||
          state.remuxMeta.audioTracks?.[0] ||
          null;
        const mp4Filename = `${itemTitle}${epTag} [${qKey}, ${state.activeStudioName || "Original"}].mp4`;
        const dlParams = new URLSearchParams({
          url: state.remuxMeta.rawSourceUrl,
          filename: mp4Filename,
          remux: "1",
          audio: String(state.remuxMeta.audioIndex ?? 0),
          vcodec: String(state.remuxMeta.videoCodec || ""),
          acodec: String(activeTrack?.codec || state.remuxMeta.audioCodec || ""),
          ch: String(activeTrack?.channels || state.remuxMeta.channels || 2),
          id: String(item.id || ""),
          kinorium_id: String(item.kinorium?.kinorium_id || item.kinorium_id || ""),
          title: String(item.title || ""),
          orig_title: String(item.orig_title || ""),
          media_type: String(item.media_type || "movie"),
        });
        const dlEndpoint = `/api/download-mp4?${dlParams.toString()}`;
        const a = document.createElement("a");
        a.href = dlEndpoint;
        a.download = mp4Filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast(t(`Начато скачивание: ${mp4Filename}`, `Download started: ${mp4Filename}`));
        return;
      }
      let streamUrl = state.qualities[qKey] || state.currentStreamUrl;
      if (streamUrl && streamUrl.startsWith("/api/downloads/stream/")) {
        const studioTag = state.activeStudioName || "Offline";
        const filename = `${itemTitle}${epTag} [${qKey}, ${studioTag}].mp4`;
        const sep = streamUrl.includes("?") ? "&" : "?";
        const a = document.createElement("a");
        a.href = `${streamUrl}${sep}download=1`;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast(t(`Сохранение копии файла: ${filename}`, `Saving file copy: ${filename}`));
        return;
      }
      if (
        streamUrl &&
        (streamUrl.startsWith("/api/remux-stream?") || streamUrl.startsWith("/api/proxy-stream?"))
      ) {
        try {
          const innerParams = new URLSearchParams(streamUrl.split("?")[1] || "");
          const innerSrc = innerParams.get("url") || innerParams.get("src") || "";
          if (innerSrc) streamUrl = innerSrc;
        } catch (err) {
          window.logDebug?.("PlayerControls", err);
        }
      }
      if (!streamUrl || streamUrl.includes(".m3u8") || !/^https?:\/\//i.test(streamUrl)) {
        showToast(
          t(
            "Прямой поток загружается — подождите пару секунд и нажмите снова",
            "Direct stream is loading — wait a couple of seconds and try again"
          )
        );
        return;
      }
      const studioTag = state.activeStudioName || state.activeSourceTab || "HDRezka";
      const filename = `${itemTitle}${epTag} [${qKey}, ${studioTag}].mp4`;
      const directParams = new URLSearchParams({
        url: streamUrl,
        filename,
        id: String(item.id || ""),
        kinorium_id: String(item.kinorium?.kinorium_id || item.kinorium_id || ""),
        title: String(item.title || ""),
        orig_title: String(item.orig_title || ""),
        media_type: String(item.media_type || "movie"),
      });
      const dlEndpoint = `/api/download-mp4?${directParams.toString()}`;
      const a = document.createElement("a");
      a.href = dlEndpoint;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast(t(`Начато скачивание: ${filename}`, `Download started: ${filename}`));
    };
  }

  const btnTrailerRu = document.getElementById("btn-trailer-ru");
  if (btnTrailerRu) {
    btnTrailerRu.onclick = () => renderTrailerEmbed("ru");
  }
  const btnTrailerEn = document.getElementById("btn-trailer-en");
  if (btnTrailerEn) {
    btnTrailerEn.onclick = () => renderTrailerEmbed("en");
  }

  const autoIntroToggle = document.getElementById("auto-skip-intro-toggle");
  if (autoIntroToggle) {
    autoIntroToggle.checked = Boolean(state.autoSkipIntro);
    autoIntroToggle.onchange = (e) => {
      state.autoSkipIntro = Boolean(e.target.checked);
      state.introSkippedThisEpisode = false;
      savePlayerPrefs({ autoSkipIntro: state.autoSkipIntro });
      updatePlayerGearActiveDot();
    };
  }

  const autoNextToggle = document.getElementById("auto-next-ep-toggle");
  if (autoNextToggle) {
    autoNextToggle.checked = Boolean(state.autoNextEpisode);
    autoNextToggle.onchange = (e) => {
      state.autoNextEpisode = Boolean(e.target.checked);
      savePlayerPrefs({ autoNextEpisode: state.autoNextEpisode });
      updatePlayerGearActiveDot();
      if (!state.autoNextEpisode) {
        clearAutoplayNextTimer();
      } else {
        const toast = document.getElementById("player-next-ep-toast");
        if (toast && !toast.classList.contains("hidden")) {
          dismissPlayerNextEpisodeToast(false);
        }
      }
      showToast(
        state.autoNextEpisode
          ? t("Автопереход на следующую серию включён", "Auto-play next episode enabled")
          : t("Автопереход на следующую серию выключен", "Auto-play next episode disabled")
      );
    };
  }

  const seamlessBridgeToggle = document.getElementById("seamless-bridge-toggle");
  if (seamlessBridgeToggle) {
    seamlessBridgeToggle.checked = Boolean(state.seamlessEpisodeBridge);
    seamlessBridgeToggle.onchange = (e) => {
      state.seamlessEpisodeBridge = Boolean(e.target.checked);
      try {
        localStorage.setItem("velarium_seamless_bridge", state.seamlessEpisodeBridge ? "true" : "false");
      } catch (_) {}
      savePlayerPrefs({ seamlessEpisodeBridge: state.seamlessEpisodeBridge });
      updatePlayerGearActiveDot();
      showToast(
        state.seamlessEpisodeBridge
          ? t("Бесшовный мост серий включён", "Seamless binge bridge enabled")
          : t("Бесшовный мост серий выключен", "Seamless binge bridge disabled")
      );
    };
  }

  const xrayPauseToggle = document.getElementById("xray-on-pause-toggle");
  if (xrayPauseToggle) {
    xrayPauseToggle.checked = state.showXrayOnPause !== false;
    xrayPauseToggle.onchange = (e) => {
      state.showXrayOnPause = Boolean(e.target.checked);
      try {
        localStorage.setItem("velarium_xray_on_pause", state.showXrayOnPause ? "true" : "false");
      } catch (_) {}
      savePlayerPrefs({ showXrayOnPause: state.showXrayOnPause });
      if (!state.showXrayOnPause) {
        const shelf = document.getElementById("xray-pause-shelf");
        if (shelf && shelf.classList.contains("is-compact")) {
          hideXRayPauseShelf();
        }
      }
      showToast(
        state.showXrayOnPause
          ? t("X-Ray при паузе включён", "X-Ray on pause enabled")
          : t("X-Ray при паузе выключен (вызов по клавише X)", "X-Ray on pause disabled (press X to open)")
      );
    };
  }

  document.querySelectorAll("#stremio-filter-pills .atv-stremio-filter-pill").forEach((pill) => {
    pill.onclick = () => {
      state.stremioFilter = pill.dataset.sfilter || "all";
      document.querySelectorAll("#stremio-filter-pills .atv-stremio-filter-pill").forEach((b) => {
        b.classList.toggle("active", b === pill);
      });
      if (state.stremioStreamsData) {
        const video = document.getElementById("native-video");
        const { cur } = getEffectivePlaybackTiming(video);
        renderStremioStreamsList(cur > 5 ? cur : 0, false);
      }
    };
  });
}
