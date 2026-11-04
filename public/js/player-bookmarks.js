import { BOOKMARKS_STORAGE_KEY, profileStorageKey, state } from "./state.js?v=20261104v25";
import { displayTitle, t } from "./i18n.js?v=20261104v25";
import { formatTime, showToast } from "./utils.js?v=20261104v25";
import { getEffectivePlaybackTiming } from "./player-remux.js?v=20261104v25";
import { seekEffectivePlayback } from "./player-streams.js?v=20261104v25";

export function hideXRayPauseShelf() {
  const shelf = document.getElementById("xray-pause-shelf");
  if (shelf) shelf.classList.add("hidden");
}

export function showXRayPauseShelf() {
  hideXRayPauseShelf();
}

export function getSavedMoments() {
  try {
    const key = profileStorageKey(BOOKMARKS_STORAGE_KEY);
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) || [] : [];
  } catch (_) {
    return [];
  }
}

export function saveMoments(moments) {
  try {
    const key = profileStorageKey(BOOKMARKS_STORAGE_KEY);
    localStorage.setItem(key, JSON.stringify(moments || []));
  } catch (_) {}
}

export function toggleBookmarkCurrentMoment() {
  const video = document.getElementById("native-video");
  if (!video || !state.activeItem || !state.isPlayerOpen) return;
  const { cur, dur } = getEffectivePlaybackTiming(video);
  if (!dur || dur <= 0) return;

  const curSec = Math.round(cur);
  const itemId = String(state.activeItem.id || state.activeItem.title || "");
  const isSeries = state.activeItem.media_type === "series";
  const curSeason = Number(state.activeSeason) || 1;
  const curEpisode = Number(state.activeEpisode) || 1;
  const moments = getSavedMoments();

  const existingIdx = moments.findIndex(
    (m) =>
      m.itemId === itemId &&
      (!isSeries || (Number(m.season || 1) === curSeason && Number(m.episode || 1) === curEpisode)) &&
      Math.abs((m.time || 0) - curSec) <= 2
  );

  if (existingIdx >= 0) {
    moments.splice(existingIdx, 1);
    saveMoments(moments);
    renderTimelineBookmarks();
    showToast(t(`Закладка на ${formatTime(curSec)} удалена`, `Bookmark at ${formatTime(curSec)} removed`));
  } else {
    const newMoment = {
      id: `moment_${Date.now()}`,
      itemId,
      title: displayTitle(state.activeItem) || state.activeItem.title,
      season: curSeason,
      episode: curEpisode,
      time: curSec,
      label: formatTime(curSec),
      createdAt: Date.now(),
    };
    moments.push(newMoment);
    saveMoments(moments);
    renderTimelineBookmarks();
    showToast(t(`Закладка сохранена на ${formatTime(curSec)}`, `Bookmark saved at ${formatTime(curSec)}`));
  }
}

export function renderTimelineBookmarks() {
  const container = document.getElementById("vc-bookmarks");
  const video = document.getElementById("native-video");
  if (!container || !video || !state.activeItem) return;
  const { dur } = getEffectivePlaybackTiming(video);
  if (!dur || dur <= 0) {
    container.innerHTML = "";
    state.activeItemBookmarks = [];
    return;
  }

  const itemId = String(state.activeItem.id || state.activeItem.title || "");
  const isSeries = state.activeItem.media_type === "series";
  const curSeason = Number(state.activeSeason) || 1;
  const curEpisode = Number(state.activeEpisode) || 1;
  const moments = getSavedMoments().filter(
    (m) =>
      m.itemId === itemId &&
      (!isSeries || (Number(m.season || 1) === curSeason && Number(m.episode || 1) === curEpisode))
  );
  state.activeItemBookmarks = moments;

  container.innerHTML = "";
  moments.forEach((m) => {
    const pct = Math.max(0, Math.min(100, (m.time / dur) * 100));
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "atv-vc-bookmark-pin";
    pin.style.left = `${pct}%`;
    const pinTitle = `${t("Закладка", "Bookmark")} ${m.label || formatTime(m.time)}`;
    pin.title = pinTitle;
    pin.setAttribute("aria-label", pinTitle);
    pin.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
    });
    pin.onclick = (e) => {
      e.stopPropagation();
      seekEffectivePlayback(m.time);
      showToast(t(`Переход к закладке ${m.label || formatTime(m.time)}`, `Jumped to bookmark ${m.label || formatTime(m.time)}`));
    };
    container.appendChild(pin);
  });
}
