import { state } from "./state.js?v=20261105v1";
import { t } from "./i18n.js?v=20261105v1";
import { formatTime } from "./utils.js?v=20261105v1";
import { getEffectivePlaybackTiming } from "./player-remux.js?v=20261105v1";

export function getDetectedCreditsStartSec(dur) {
  if (!dur || dur < 120) return null;
  const minValidSec = dur * 0.70;
  const maxValidSec = dur - 1;
  const candidates = [];
  const outroSec =
    Number(state.skipSegments?.outro?.start) ||
    Number(state.skipSegments?.outro?.start_sec) ||
    0;
  if (outroSec >= minValidSec && outroSec < maxValidSec) {
    candidates.push(outroSec);
  }
  const probeSec = Number(state.probeCreditsStartSec || state.remuxMeta?.creditsStartSec) || 0;
  if (probeSec >= minValidSec && probeSec < maxValidSec) {
    candidates.push(probeSec);
  }
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

export function renderTimelineChapterMarkers(dur) {
  const container = document.getElementById("vc-chapters");
  if (!container || !dur || dur < 60) {
    if (container) container.innerHTML = "";
    return;
  }
  let html = "";
  const introStart = Number(state.skipSegments?.intro?.start) || Number(state.skipSegments?.intro?.start_sec) || 0;
  const introEnd = Number(state.skipSegments?.intro?.end) || Number(state.skipSegments?.intro?.end_sec) || 0;
  const creditsStart = getDetectedCreditsStartSec(dur) || 0;

  if (introEnd > 0 && introEnd < dur) {
    const leftPct = Math.max(0, (introStart / dur) * 100).toFixed(2);
    const widthPct = Math.min(100 - Number(leftPct), Math.max(0.6, ((introEnd - introStart) / dur) * 100)).toFixed(2);
    html += `<div class="atv-vc-chapter-segment is-intro" style="left:${leftPct}%; width:${widthPct}%" title="${t("Заставка", "Intro")}"></div>`;
  }
  if (creditsStart > 0 && creditsStart < dur) {
    const leftPct = Math.max(0, (creditsStart / dur) * 100).toFixed(2);
    const widthPct = Math.max(0.6, 100 - Number(leftPct)).toFixed(2);
    html += `<div class="atv-vc-chapter-segment is-credits" style="left:${leftPct}%; width:${widthPct}%" title="${t("Титры", "Credits")}"></div>`;
  }
  container.innerHTML = html;
}

export async function loadSkipIntroSegments() {
  if (!state.activeItem) return;
  const sessionId = state.playerSessionId;
  const item = state.activeItem;
  const infoEl = document.getElementById("intro-window-info");
  state.skipSegments = null;
  if (infoEl) infoEl.textContent = "";

  if (state.skipIntroAbortController) {
    try {
      state.skipIntroAbortController.abort();
    } catch (err) { window.logDebug?.("PlayerIntroCredits", err); }
  }
  const skipAbort = new AbortController();
  state.skipIntroAbortController = skipAbort;

  try {
    const reqSeason = Number(state.activeSeason) || 1;
    const reqEpisode = Number(state.activeEpisode) || 1;

    if (state.preloadedSkipSegments && state.preloadedSkipSegments.ok) {
      const pData = state.preloadedSkipSegments;
      if (
        (pData.season === undefined || Number(pData.season) === reqSeason) &&
        (pData.episode === undefined || Number(pData.episode) === reqEpisode)
      ) {
        state.skipSegments = pData;
        if (pData.intro_start !== undefined && pData.intro_end !== undefined) {
          const s = Math.round(pData.intro_start);
          const e = Math.round(pData.intro_end);
          if (infoEl) {
            infoEl.textContent = `${t("Заставка", "Intro")}: ${formatTime(s)} – ${formatTime(e)}`;
          }
        }
        state.preloadedSkipSegments = null;
        return;
      }
    }

    const rawImdbCandidate = String(item.imdb_id || item.id || "").trim();
    const safeImdbId = /^tt\d+$/i.test(rawImdbCandidate) ? rawImdbCandidate : "";
    const params = new URLSearchParams({
      imdb_id: safeImdbId,
      season: String(reqSeason),
      episode: String(reqEpisode),
      media_type: item.media_type || "series",
      title: item.title || "",
      orig_title: item.orig_title || "",
      year: String(item.year || 0),
    });
    const res = await fetch(`/api/skip-intro?${params.toString()}`, {
      signal: skipAbort.signal,
    });
    if (!res.ok) return;
    const data = await res.json();
    if (
      !state.isPlayerOpen ||
      sessionId !== state.playerSessionId ||
      state.activeSourceTab === "trailer" ||
      String(state.activeItem?.id || "") !== String(item.id || "") ||
      (item.media_type === "series" &&
        (Number(state.activeSeason) !== reqSeason || Number(state.activeEpisode) !== reqEpisode))
    ) {
      return;
    }
    state.skipSegments = data;

    if (infoEl) {
      infoEl.textContent =
        item.media_type !== "movie" && data.intro
          ? `(${formatTime(data.intro.start)}–${formatTime(data.intro.end)})`
          : "";
    }
    const video = document.getElementById("native-video");
    const { dur } = getEffectivePlaybackTiming(video);
    if (dur > 0) renderTimelineChapterMarkers(dur);
  } catch (err) {
    if (err && err.name === "AbortError") return;
    console.error("Skip intro error:", err);
  }
}
