// CineFlow Player UI Controls Subsystem
// Manages interactive player timeline, scrubber, volume slider, stage idle states,
// fullscreen toggling, control popovers, and responsive layout synchronization.

import { state } from "./state.js?v=20261104v25";
import {
  displayTitle,
  getItemGenreEntries,
  isEn,
  secondaryTitle,
  t,
} from "./i18n.js?v=20261104v25";
import {
  escapeAttr,
  escapeHtml,
  formatTime,
  getEpisodeProgress,
  iconSvg,
  clampStagePopover,
  closeCustomSelectMenu,
  closeFloatingPopovers,
  showToast,
  syncToastContainerMount,
  triggerVideoCenterIndicator,
} from "./utils.js?v=20261104v25";
import { isEpisodeWatched, isServiceEnabled } from "./catalog.js?v=20261104v25";
import { closeSubtitleDictPopover, renderVcSubtitlesPopover } from "./subtitles.js?v=20261104v25";
import {
  resumeAudioContextIfNeeded,
  sampleAmbilightFrame,
  savePlayerPrefs,
  togglePictureInPicture,
} from "./audio-dsp.js?v=20261104v25";
import { pushDesktopRemoteStateNow } from "./remote.js?v=20261104v25";
import { getEffectivePlaybackTiming } from "./player-remux.js?v=20261104v25";
import {
  resolveEffectiveSeasonsMap,
  switchToSeriesSeasonEpisode,
  getEpisodeDisplayMeta,
} from "./player-seasons.js?v=20261104v25";
import { syncPostwatchOverlayMount } from "./player-rating.js?v=20261104v25";
import { dismissPlayerNextEpisodeToast } from "./player-autoplay.js?v=20261104v25";
import { stepEpisode } from "./player-seasons.js?v=20261104v25";
import {
  seekEffectivePlayback,
  switchSourceTab,
} from "./player-streams.js?v=20261104v25";
import { getDetectedCreditsStartSec } from "./player-intro-credits.js?v=20261104v25";
import { toggleBookmarkCurrentMoment } from "./player-bookmarks.js?v=20261104v25";
import {
  setMiniPlayerMode,
  setPipBackgroundMode,
} from "./player-pip-dock.js?v=20261104v25";
import { toggleVideoPlayPause } from "./player.js?v=20261104v25";

export function hasOpenVcPopover() {
  return [
    "vc-episodes-popover",
    "vc-studio-popover",
    "vc-subs-popover",
    "vc-quality-popover",
    "player-gear-popover",
    "atv-sub-dict-popover",
  ].some((id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains("hidden");
  });
}

export function syncVcPopoverOpenClass() {
  const stage = document.getElementById("video-stage");
  const isOpen = hasOpenVcPopover();
  if (stage) {
    stage.classList.toggle("vc-popover-open", isOpen);
    stage.parentElement?.classList.toggle("vc-popover-open", isOpen);
  }
}

export function closeAllVcPopovers() {
  closeCustomSelectMenu({ restoreFocus: false });
  [
    ["vc-episodes-popover", "vc-btn-episodes"],
    ["vc-studio-popover", "vc-btn-studio"],
    ["vc-subs-popover", "vc-btn-subs"],
    ["vc-quality-popover", "vc-btn-quality"],
    ["player-gear-popover", "btn-player-gear"],
  ].forEach(([id, btnId]) => {
    document.getElementById(id)?.classList.add("hidden");
    document.getElementById(btnId)?.setAttribute("aria-expanded", "false");
  });
  if (state.subDictOpen) {
    closeSubtitleDictPopover(true);
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
  const epWrap = document.getElementById("vc-episodes-wrap");
  const epLbl = document.getElementById("vc-episodes-label");
  const epPop = document.getElementById("vc-episodes-popover");
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
        const todayIso = new Date().toISOString().slice(0, 10);
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

  const studioWrap = document.getElementById("vc-studio-wrap");
  const studioLbl = document.getElementById("vc-studio-label");
  const studioPop = document.getElementById("vc-studio-popover");
  const studioSel = document.getElementById("select-studio");

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
    const showSearch = opts.length >= 12;
    const searchHtml = showSearch
      ? `<div class="atv-vc-pop-search-wrap"><input type="text" class="atv-vc-pop-search" placeholder="${escapeAttr(
          t("Поиск дорожки...", "Filter tracks...")
        )}" autocomplete="off" spellcheck="false" /></div>`
      : "";
    container.innerHTML = `<div class="atv-vc-pop-title">${escapeHtml(popTitle)}</div>${searchHtml}`;
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
      container.appendChild(b);
      const nextOpt = opts[idx + 1];
      if (isOrig && nextOpt && nextOpt.dataset.isOriginal !== "1") {
        const div = document.createElement("div");
        div.className = "atv-vc-pop-divider";
        container.appendChild(div);
      }
    });
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
        renderStudioItemsInto(studioPop, opts, popTitle);
      }
    }
  }

  const subsWrap = document.getElementById("vc-subs-wrap");
  const subsLbl = document.getElementById("vc-subs-label");
  const subsPop = document.getElementById("vc-subs-popover");
  const subsSel = document.getElementById("select-subtitle");
  if (subsWrap && subsLbl && subsPop && subsSel) {
    renderVcSubtitlesPopover(subsWrap, subsLbl, subsPop, subsSel, bindPopoverQuickSearch);
  }

  const qualWrap = document.getElementById("vc-quality-wrap");
  const qualBtn = document.getElementById("vc-btn-quality");
  const qualLbl = document.getElementById("vc-quality-label");
  const qualPop = document.getElementById("vc-quality-popover");
  const qualSel = document.getElementById("select-quality");
  if (qualWrap && qualLbl && qualPop && qualSel) {
    const qOpts = Array.from(qualSel.options || []);
    if (isHdRezka && qOpts.length > 0) {
      qualWrap.classList.remove("hidden");
      qualBtn?.classList.remove("is-readonly-badge");
      qualLbl.textContent = qualSel.value || qOpts[0]?.value || "1080p";
      qualPop.innerHTML = `<div class="atv-vc-pop-title">${t("Качество видео", "Video Quality")}</div>`;
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
        qualPop.appendChild(b);
      });
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
  stage?.classList.toggle("is-pseudo-fullscreen", next);
  const fsActive = isStageFullscreen();
  document.documentElement.classList.toggle("is-stage-fullscreen", fsActive);
  if (!fsActive) {
    document.documentElement.classList.remove("vc-fs-cursor-none");
  }
  syncPostwatchOverlayMount();
  syncToastContainerMount();
  syncCustomVideoControlsUI();
  wakeVideoControls();
  pushDesktopRemoteStateNow();
}

export function setVideoStageIdle(isIdle) {
  const stage = document.getElementById("video-stage");
  if (isIdle) {
    stage?.classList.add("vc-idle");
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

export function wakeVideoControls() {
  const stage = document.getElementById("video-stage");
  const video = document.getElementById("native-video");
  if (!stage) return;
  setVideoStageIdle(false);
  if (state.vcIdleTimerId) {
    clearTimeout(state.vcIdleTimerId);
    state.vcIdleTimerId = null;
  }
  if (!video || video.paused || video.ended) return;
  state.vcIdleTimerId = setTimeout(() => {
    const controlsBar = document.getElementById("atv-custom-controls");
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
  }, 2200);
}

export function syncCustomVideoControlsUI(forceSync = false) {
  const video = document.getElementById("native-video");
  if (!video) return;
  // Skip redundant DOM style mutations when controls bar is hidden in idle playback
  if (!forceSync && !state.vcScrubbing) {
    const stage = document.getElementById("video-stage");
    if (stage && stage.classList.contains("vc-idle")) {
      const nowMs = Date.now();
      if (nowMs - (state.lastVcSyncTs || 0) < 1200) {
        return;
      }
      state.lastVcSyncTs = nowMs;
    }
  }
  const { cur, dur } = getEffectivePlaybackTiming(video);
  const rawCur = Number.isFinite(video.currentTime) ? video.currentTime : 0;

  const playBtn = document.getElementById("vc-btn-play");
  if (playBtn) {
    const playKey = video.paused ? "play" : "pause";
    const playLabel = video.paused
      ? t("Воспроизвести (Space)", "Play (Space)")
      : t("Пауза (Space)", "Pause (Space)");
    if (playBtn.dataset.icoKey !== playKey) {
      playBtn.dataset.icoKey = playKey;
      playBtn.innerHTML = iconSvg(playKey, 14);
    }
    if (playBtn.getAttribute("aria-label") !== playLabel) {
      playBtn.setAttribute("aria-label", playLabel);
    }
  }

  if (!state.vcScrubbing) {
    const pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
    const playedEl = document.getElementById("vc-played");
    const thumbEl = document.getElementById("vc-thumb");
    const timelineEl = document.getElementById("vc-timeline");
    if (playedEl) playedEl.style.width = `${pct}%`;
    if (thumbEl) thumbEl.style.left = `${pct}%`;
    if (timelineEl) {
      timelineEl.setAttribute("aria-valuenow", String(Math.round(pct)));
      timelineEl.setAttribute(
        "aria-valuetext",
        dur > 0 ? `${formatTime(cur)} / ${formatTime(dur)}` : "0:00"
      );
    }
  }

  const bufferedEl = document.getElementById("vc-buffered");
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
    bufferedEl.style.width = `${bufPct}%`;
  }

  const timeBtn = document.getElementById("vc-time-label");
  if (timeBtn) {
    if (dur > 0 && state.vcShowRemaining) {
      timeBtn.textContent = `${formatTime(cur)} / -${formatTime(Math.max(0, dur - cur))}`;
    } else {
      timeBtn.textContent = `${formatTime(cur)} / ${dur > 0 ? formatTime(dur) : "0:00"}`;
    }
  }

  const muteBtn = document.getElementById("vc-btn-mute");
  const volSlider = document.getElementById("vc-vol-slider");
  const isMuted = Boolean(video.muted || video.volume === 0);
  if (muteBtn) {
    const muteKey = isMuted ? "volMute" : video.volume < 0.5 ? "volLow" : "volHigh";
    const muteLabel = isMuted
      ? t("Включить звук (M)", "Unmute (M)")
      : t("Выключить звук (M)", "Mute (M)");
    if (muteBtn.dataset.icoKey !== muteKey) {
      muteBtn.dataset.icoKey = muteKey;
      muteBtn.innerHTML = iconSvg(muteKey, 15);
    }
    if (muteBtn.getAttribute("aria-label") !== muteLabel) {
      muteBtn.setAttribute("aria-label", muteLabel);
    }
  }
  if (volSlider && document.activeElement !== volSlider) {
    volSlider.value = String(video.muted ? 0 : video.volume);
  }

  const fsBtn = document.getElementById("vc-btn-fs");
  if (fsBtn) {
    const fsActive = isStageFullscreen();
    const fsKey = fsActive ? "fsExit" : "fsEnter";
    const fsTitle = fsActive
      ? t("Выйти из полного экрана (F / Esc)", "Exit fullscreen (F / Esc)")
      : t("Во весь экран (F)", "Fullscreen (F)");
    if (fsBtn.dataset.icoKey !== fsKey) {
      fsBtn.dataset.icoKey = fsKey;
      fsBtn.innerHTML = iconSvg(fsKey, 14);
    }
    if (fsBtn.title !== fsTitle) {
      fsBtn.title = fsTitle;
      fsBtn.setAttribute("aria-label", fsTitle);
    }
  }

  const fsTitleEl = document.getElementById("vc-fs-title");
  const fsMetaEl = document.getElementById("vc-fs-meta");
  if (fsTitleEl && fsMetaEl && state.activeItem) {
    const item = state.activeItem;
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
  if (state.vcClickTimerId) {
    clearTimeout(state.vcClickTimerId);
    state.vcClickTimerId = null;
  }
  beginFullscreenTransitionWindow(580);
  if (isStageFullscreen()) {
    const hadPseudo = Boolean(
      state.isPseudoFullscreen ||
        document.documentElement?.classList.contains("is-stage-pseudo-fullscreen")
    );
    if (hadPseudo) {
      setPseudoStageFullscreen(false);
    }
    try {
      window.webkit?.messageHandlers?.cineflowNative?.postMessage({
        action: "setWindowFullscreen",
        fullscreen: false,
      });
    } catch (_) {}
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
  try {
    window.webkit?.messageHandlers?.cineflowNative?.postMessage({
      action: "setWindowFullscreen",
      fullscreen: true,
    });
  } catch (_) {}

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

export function getSnappingRatio(rawRatio, dur, timeline = document.getElementById("vc-timeline")) {
  if (!dur || dur <= 0) return { ratio: rawRatio, snapped: null };
  const rect = timeline?.getBoundingClientRect();
  const width = rect?.width || 0;
  if (!width) return { ratio: rawRatio, snapped: null };
  const snapThresholdRatio = Math.max(0.006, 8 / width);
  const candidates = [];

  const introStart = Number(state.skipSegments?.intro?.start) || Number(state.skipSegments?.intro?.start_sec) || 0;
  const introEnd = Number(state.skipSegments?.intro?.end) || Number(state.skipSegments?.intro?.end_sec) || 0;
  const creditsStart = getDetectedCreditsStartSec(dur) || 0;

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
        candidates.push({ r: bm.time / dur, label: `${t("Закладка", "Bookmark")} (${formatTime(bm.time)})` });
      }
    });
  }

  for (const cand of candidates) {
    if (Math.abs(rawRatio - cand.r) <= snapThresholdRatio) {
      return { ratio: cand.r, snapped: cand.label };
    }
  }
  return { ratio: rawRatio, snapped: null };
}

export function initCustomVideoControls() {
  const stage = document.getElementById("video-stage");
  const controlsBar = document.getElementById("atv-custom-controls");
  const getVideoEl = () => document.getElementById("native-video");
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
      if (isStageFullscreen()) {
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
    syncCustomVideoControlsUI();
    wakeVideoControls();
    pushDesktopRemoteStateNow();
  };
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);

  // Interactive Timeline Scrubber + Hover Time
  if (timeline) {
    let cachedTimelineRect = null;
    const getTimelineRect = () => {
      if (!cachedTimelineRect) {
        cachedTimelineRect = timeline.getBoundingClientRect();
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
      },
      { passive: true }
    );

    const updateHoverPreview = (clientX, precomputedRatio = null) => {
      const { cur, dur } = getEffectivePlaybackTiming(getVideoEl());
      if (!dur || !hoverTimeEl) return;
      const rawRatio = typeof precomputedRatio === "number" ? precomputedRatio : computeRatio(clientX);
      const snapInfo = getSnappingRatio(rawRatio, dur);
      const effectiveRatio = snapInfo.ratio;
      const clampedLeft = Math.min(94, Math.max(6, effectiveRatio * 100));
      hoverTimeEl.style.left = `${clampedLeft}%`;
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
      const deltaText =
        Math.abs(deltaSec) >= 1
          ? `${deltaSec > 0 ? "+" : "−"}${formatTime(Math.abs(deltaSec))}`
          : "";
      const remSec = Math.max(0, Math.round(dur - hoverSec));
      const remText = `−${formatTime(remSec)}`;
      hoverTimeEl.innerHTML = `${
        chapterBadge ? `<span class="atv-vc-hover-chapter">${escapeHtml(chapterBadge)}</span>` : ""
      }<span class="atv-vc-hover-main"><span class="atv-vc-hover-target">${escapeHtml(
        formatTime(hoverSec)
      )}</span>${
        deltaText ? `<span class="atv-vc-hover-delta">${escapeHtml(deltaText)}</span>` : ""
      }<span class="atv-vc-hover-rem">${escapeHtml(remText)}</span></span>`;
      hoverTimeEl.classList.remove("hidden");
    };

    timeline.addEventListener("pointermove", (e) => {
      const rawRatio = computeRatio(e.clientX);
      updateHoverPreview(e.clientX, rawRatio);
      if (state.vcScrubbing) {
        const v = getVideoEl();
        const { dur } = getEffectivePlaybackTiming(v);
        const { ratio } = getSnappingRatio(rawRatio, dur);
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
      }
    });

    timeline.addEventListener("pointerleave", () => {
      cachedTimelineRect = null;
      if (!state.vcScrubbing && hoverTimeEl) {
        hoverTimeEl.classList.add("hidden");
      }
    });

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
      } catch (_) {}
      const rawRatio = computeRatio(e.clientX);
      const { ratio } = getSnappingRatio(rawRatio, dur);
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
      updateHoverPreview(e.clientX, rawRatio);
    });

    const finishScrub = (e) => {
      cachedTimelineRect = null;
      if (!state.vcScrubbing) return;
      state.vcScrubbing = false;
      timeline.classList.remove("scrubbing");
      const { dur } = getEffectivePlaybackTiming(getVideoEl());
      if (dur > 0 && typeof e.clientX === "number") {
        const rawRatio = computeRatio(e.clientX);
        const { ratio } = getSnappingRatio(rawRatio, dur);
        seekEffectivePlayback(ratio * dur);
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
    toggleVideoPlayPause(true);
  });

  document.getElementById("vc-btn-back10")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const { cur } = getEffectivePlaybackTiming(getVideoEl());
    const target = Math.max(0, cur - 10);
    seekEffectivePlayback(target);
    triggerVideoCenterIndicator("back10", `−10 ${t("секунд", "sec")} · ${formatTime(target)}`);
  });

  document.getElementById("vc-btn-fwd10")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const { cur, dur } = getEffectivePlaybackTiming(getVideoEl());
    const maxDur = dur > 0 ? dur : cur + 10;
    const target = Math.min(maxDur, cur + 10);
    seekEffectivePlayback(target);
    triggerVideoCenterIndicator("fwd10", `+10 ${t("секунд", "sec")} · ${formatTime(target)}`);
  });

  document.getElementById("vc-btn-mute")?.addEventListener("click", (e) => {
    e.stopPropagation();
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
        savePlayerPrefs({ volume: v, muted: false });
      }
      resumeAudioContextIfNeeded();
      syncCustomVideoControlsUI(true);
      pushDesktopRemoteStateNow();
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
        syncCustomControlPopovers();
        pop.classList.remove("hidden");
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

  document.getElementById("vc-btn-pip")?.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePictureInPicture();
  });

  document.getElementById("vc-btn-fs")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleStageFullscreen();
  });

  document.getElementById("vc-btn-bookmark")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleBookmarkCurrentMoment();
  });

  syncCustomVideoControlsUI();
}
