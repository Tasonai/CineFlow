import { BOOKMARKS_STORAGE_KEY, profileStorageKey, state } from "./state.js?v=20261105v1";
import { displayTitle, isEn, t } from "./i18n.js?v=20261105v1";
import {
  escapeAttr,
  escapeHtml,
  formatTime,
  rememberModalTriggerFocus,
  restoreModalTriggerFocus,
  showToast,
} from "./utils.js?v=20261105v1";
import { getEffectivePlaybackTiming } from "./player-remux.js?v=20261105v1";
import { seekEffectivePlayback } from "./player-streams.js?v=20261105v1";

let _bookmarkDialogWasPlaying = false;
let _activeEditingMoment = null;
let _activeEditingTimeSec = null;

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
  } catch (err) { window.logDebug?.("PlayerBookmarks", err); }
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
      id: `moment_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      itemId,
      title: displayTitle(state.activeItem) || state.activeItem.title,
      orig_title: state.activeItem.orig_title || "",
      poster: state.activeItem.poster || "",
      year: state.activeItem.year || "",
      media_type: state.activeItem.media_type || "movie",
      season: curSeason,
      episode: curEpisode,
      time: curSec,
      label: formatTime(curSec),
      note: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    moments.push(newMoment);
    saveMoments(moments);
    renderTimelineBookmarks();
    showToast(t(`Закладка сохранена на ${formatTime(curSec)}`, `Bookmark saved at ${formatTime(curSec)}`));
  }
}

export function openBookmarkNoteDialog(moment = null, targetSec = null) {
  const video = document.getElementById("native-video");
  if (!video || !state.activeItem || !state.isPlayerOpen) return;
  const dialog = document.getElementById("atv-bookmark-dialog");
  if (!dialog) return;

  _bookmarkDialogWasPlaying = !video.paused;
  if (_bookmarkDialogWasPlaying) {
    try {
      video.pause();
    } catch (err) { window.logDebug?.("PlayerBookmarks", err); }
  }

  const { cur, dur } = getEffectivePlaybackTiming(video);
  const effSec = targetSec !== null ? Math.round(targetSec) : moment ? moment.time : Math.round(cur || 0);
  _activeEditingMoment = moment;
  _activeEditingTimeSec = effSec;

  const timeBadge = document.getElementById("bookmark-dialog-time");
  if (timeBadge) {
    timeBadge.textContent = formatTime(effSec);
  }

  const input = document.getElementById("bookmark-note-input");
  if (input) {
    input.value = moment?.note || "";
  }

  const btnDelete = document.getElementById("btn-delete-bookmark");
  if (btnDelete) {
    btnDelete.classList.toggle("hidden", !moment);
  }

  dialog.classList.remove("hidden");
  dialog.setAttribute("aria-hidden", "false");
  setTimeout(() => {
    input?.focus();
    input?.select();
  }, 50);
}

export function closeBookmarkNoteDialog(resume = true) {
  const dialog = document.getElementById("atv-bookmark-dialog");
  if (dialog) {
    dialog.classList.add("hidden");
    dialog.setAttribute("aria-hidden", "true");
  }
  const video = document.getElementById("native-video");
  if (resume && _bookmarkDialogWasPlaying && video && video.paused) {
    try {
      video.play();
    } catch (err) { window.logDebug?.("PlayerBookmarks", err); }
  }
  _activeEditingMoment = null;
  _activeEditingTimeSec = null;
}

export function saveCurrentBookmarkNote() {
  const input = document.getElementById("bookmark-note-input");
  const noteText = String(input?.value || "").trim();
  const video = document.getElementById("native-video");
  if (!video || !state.activeItem || _activeEditingTimeSec === null) {
    closeBookmarkNoteDialog();
    return;
  }

  const curSec = _activeEditingTimeSec;
  const itemId = String(state.activeItem.id || state.activeItem.title || "");
  const isSeries = state.activeItem.media_type === "series";
  const curSeason = Number(state.activeSeason) || 1;
  const curEpisode = Number(state.activeEpisode) || 1;
  const moments = getSavedMoments();

  let targetMoment = _activeEditingMoment;
  if (!targetMoment) {
    targetMoment = moments.find(
      (m) =>
        m.itemId === itemId &&
        (!isSeries || (Number(m.season || 1) === curSeason && Number(m.episode || 1) === curEpisode)) &&
        Math.abs((m.time || 0) - curSec) <= 2
    );
  }

  if (targetMoment) {
    targetMoment.note = noteText;
    targetMoment.updatedAt = Date.now();
  } else {
    targetMoment = {
      id: `moment_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      itemId,
      title: displayTitle(state.activeItem) || state.activeItem.title,
      orig_title: state.activeItem.orig_title || "",
      poster: state.activeItem.poster || "",
      year: state.activeItem.year || "",
      media_type: state.activeItem.media_type || "movie",
      season: curSeason,
      episode: curEpisode,
      time: curSec,
      label: formatTime(curSec),
      note: noteText,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    moments.push(targetMoment);
  }

  saveMoments(moments);
  renderTimelineBookmarks();
  closeBookmarkNoteDialog(true);
  showToast(
    noteText
      ? t(`Заметка сохранена на ${formatTime(curSec)}`, `Note saved at ${formatTime(curSec)}`)
      : t(`Закладка сохранена на ${formatTime(curSec)}`, `Bookmark saved at ${formatTime(curSec)}`)
  );
}

export function deleteCurrentBookmark() {
  if (!_activeEditingMoment && _activeEditingTimeSec === null) {
    closeBookmarkNoteDialog();
    return;
  }
  const moments = getSavedMoments();
  const curSec = _activeEditingTimeSec;
  const itemId = String(state.activeItem?.id || state.activeItem?.title || "");
  const isSeries = state.activeItem?.media_type === "series";
  const curSeason = Number(state.activeSeason) || 1;
  const curEpisode = Number(state.activeEpisode) || 1;

  const idx = moments.findIndex((m) => {
    if (_activeEditingMoment && m.id === _activeEditingMoment.id) return true;
    return (
      m.itemId === itemId &&
      (!isSeries || (Number(m.season || 1) === curSeason && Number(m.episode || 1) === curEpisode)) &&
      Math.abs((m.time || 0) - curSec) <= 2
    );
  });

  if (idx >= 0) {
    moments.splice(idx, 1);
    saveMoments(moments);
    renderTimelineBookmarks();
    showToast(t("Закладка удалена", "Bookmark deleted"));
  }
  closeBookmarkNoteDialog(true);
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
    pin.className = `atv-vc-bookmark-pin${m.note ? " has-note" : ""}`;
    pin.style.left = `${pct}%`;
    const noteSuffix = m.note ? ` · ${m.note}` : "";
    const pinTitle = `${t("Закладка", "Bookmark")} ${m.label || formatTime(m.time)}${noteSuffix}`;
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
    pin.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openBookmarkNoteDialog(m, m.time);
    };
    container.appendChild(pin);
  });
}

export function toggleBookmarksPopover() {
  const popover = document.getElementById("vc-bookmarks-popover");
  const btn = document.getElementById("vc-btn-bookmark");
  if (!popover || !state.activeItem) return;

  const isHidden = popover.classList.contains("hidden");
  if (!isHidden) {
    popover.classList.add("hidden");
    btn?.classList.remove("active");
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

  let html = `
    <div class="atv-vc-popover-header">
      <div class="atv-vc-popover-title">${escapeHtml(t("Закладки и заметки", "Bookmarks & Notes"))}</div>
      <button type="button" class="atv-btn-primary atv-btn-xs" id="btn-pop-add-bookmark">+ ${escapeHtml(t("Добавить", "Add"))}</button>
    </div>
  `;

  if (!moments.length) {
    html += `
      <div class="atv-vc-bookmarks-empty">
        <p>${escapeHtml(t("Нет закладок для этой серии", "No bookmarks for this episode"))}</p>
        <span class="atv-vc-hint">${escapeHtml(t("Нажмите M или кнопку выше, чтобы сохранить момент с заметкой", "Press M or the button above to bookmark this moment with a note"))}</span>
      </div>
    `;
  } else {
    html += '<div class="atv-vc-bookmarks-list">';
    moments.forEach((m) => {
      html += `
        <div class="atv-vc-bookmark-row" data-time="${m.time}">
          <button type="button" class="atv-vc-bm-jump" data-time="${m.time}">
            <span class="atv-vc-bm-time">${escapeHtml(m.label || formatTime(m.time))}</span>
            <span class="atv-vc-bm-note">${escapeHtml(m.note || t("(Без заметки)", "(No note)"))}</span>
          </button>
          <div class="atv-vc-bm-actions">
            <button type="button" class="atv-vc-bm-edit" data-id="${escapeAttr(m.id)}" title="${escapeAttr(t("Редактировать заметку", "Edit note"))}">
              <svg class="atv-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button type="button" class="atv-vc-bm-del" data-id="${escapeAttr(m.id)}" title="${escapeAttr(t("Удалить", "Delete"))}">
              <svg class="atv-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      `;
    });
    html += "</div>";
  }

  html += `
    <div class="atv-vc-popover-footer">
      <button type="button" class="atv-btn-secondary atv-btn-xs" id="btn-open-all-bookmarks">
        ${escapeHtml(t("Все закладки в медиатеке", "All bookmarks in library"))}
      </button>
    </div>
  `;

  popover.innerHTML = html;
  popover.classList.remove("hidden");
  btn?.classList.add("active");

  popover.querySelector("#btn-pop-add-bookmark")?.addEventListener("click", () => {
    popover.classList.add("hidden");
    btn?.classList.remove("active");
    openBookmarkNoteDialog();
  });

  popover.querySelectorAll(".atv-vc-bm-jump").forEach((jumpBtn) => {
    jumpBtn.addEventListener("click", (e) => {
      const sec = Number(jumpBtn.getAttribute("data-time") || 0);
      seekEffectivePlayback(sec);
      popover.classList.add("hidden");
      btn?.classList.remove("active");
    });
  });

  popover.querySelectorAll(".atv-vc-bm-edit").forEach((editBtn) => {
    editBtn.addEventListener("click", (e) => {
      const id = editBtn.getAttribute("data-id");
      const m = moments.find((it) => it.id === id);
      if (m) {
        popover.classList.add("hidden");
        btn?.classList.remove("active");
        openBookmarkNoteDialog(m, m.time);
      }
    });
  });

  popover.querySelectorAll(".atv-vc-bm-del").forEach((delBtn) => {
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = delBtn.getAttribute("data-id");
      const allMoments = getSavedMoments();
      const idx = allMoments.findIndex((it) => it.id === id);
      if (idx >= 0) {
        allMoments.splice(idx, 1);
        saveMoments(allMoments);
        renderTimelineBookmarks();
        toggleBookmarksPopover();
      }
    });
  });

  popover.querySelector("#btn-open-all-bookmarks")?.addEventListener("click", () => {
    popover.classList.add("hidden");
    btn?.classList.remove("active");
    openBookmarksModal();
  });
}

export function openBookmarksModal() {
  const modal = document.getElementById("bookmarks-modal");
  if (!modal) return;
  rememberModalTriggerFocus("bookmarks-modal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  renderBookmarksModalList();
}

export function closeBookmarksModal() {
  const modal = document.getElementById("bookmarks-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  restoreModalTriggerFocus("bookmarks-modal");
}

export function renderBookmarksModalList(filterQuery = "") {
  const listEl = document.getElementById("bookmarks-modal-list");
  const countEl = document.getElementById("bookmarks-total-count");
  if (!listEl) return;

  const moments = getSavedMoments();
  if (countEl) countEl.textContent = String(moments.length);

  const q = String(filterQuery || "").trim().toLowerCase();
  const filtered = moments.filter((m) => {
    if (!q) return true;
    return (
      String(m.title || "").toLowerCase().includes(q) ||
      String(m.orig_title || "").toLowerCase().includes(q) ||
      String(m.note || "").toLowerCase().includes(q)
    );
  });

  if (!filtered.length) {
    listEl.innerHTML = `
      <div class="atv-bookmarks-empty-state">
        <p>${escapeHtml(q ? t("Ничего не найдено по запросу", "No bookmarks found for query") : t("У вас пока нет сохранённых закладок", "No saved bookmarks yet"))}</p>
        <span class="atv-bookmarks-empty-hint">${escapeHtml(t("Во время просмотра нажимайте M для сохранения момента с заметкой", "Press M during playback to save a moment with a note"))}</span>
      </div>
    `;
    return;
  }

  // Sort by updatedAt desc
  filtered.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

  let html = "";
  filtered.forEach((m) => {
    const isSeries = m.media_type === "series";
    const subMeta = isSeries
      ? `${t("Сезон", "Season")} ${m.season || 1} · ${t("Серия", "Episode")} ${m.episode || 1}`
      : m.year ? String(m.year) : "";

    html += `
      <div class="atv-bookmark-card-item" data-id="${escapeAttr(m.id)}">
        <div class="atv-bm-item-left">
          ${m.poster ? `<img class="atv-bm-thumb" src="${escapeAttr(m.poster)}" alt="" loading="lazy" />` : '<div class="atv-bm-thumb-ph"></div>'}
          <div class="atv-bm-item-info">
            <div class="atv-bm-item-title-row">
              <strong class="atv-bm-title">${escapeHtml(m.title || "CineFlow")}</strong>
              <span class="atv-bm-time-tag">${escapeHtml(m.label || formatTime(m.time))}</span>
            </div>
            ${subMeta ? `<span class="atv-bm-subline">${escapeHtml(subMeta)}</span>` : ""}
            ${m.note ? `<p class="atv-bm-note-text">${escapeHtml(m.note)}</p>` : `<p class="atv-bm-note-empty">${escapeHtml(t("(Без заметки)", "(No note)"))}</p>`}
          </div>
        </div>
        <div class="atv-bm-item-actions">
          <button type="button" class="atv-btn-primary atv-btn-xs atv-bm-btn-play" data-id="${escapeAttr(m.id)}">
            <svg class="atv-ico" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <span>${escapeHtml(t("Смотреть", "Play"))}</span>
          </button>
          <button type="button" class="atv-btn-secondary atv-btn-xs atv-bm-btn-del" data-id="${escapeAttr(m.id)}" title="${escapeAttr(t("Удалить закладку", "Delete bookmark"))}">
            <svg class="atv-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
    `;
  });

  listEl.innerHTML = html;

  listEl.querySelectorAll(".atv-bm-btn-play").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const m = filtered.find((it) => it.id === id);
      if (!m) return;
      closeBookmarksModal();
      const targetItem = {
        id: m.itemId,
        title: m.title,
        orig_title: m.orig_title,
        year: m.year,
        media_type: m.media_type || "movie",
        poster: m.poster,
      };
      const { openPlayerModal } = await import("./player.js?v=20261105v1");
      openPlayerModal(
        targetItem,
        "hdrezka",
        m.season || 1,
        m.episode || 1,
        m.time || 0
      );
    });
  });

  listEl.querySelectorAll(".atv-bm-btn-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const allMoments = getSavedMoments();
      const idx = allMoments.findIndex((it) => it.id === id);
      if (idx >= 0) {
        allMoments.splice(idx, 1);
        saveMoments(allMoments);
        renderTimelineBookmarks();
        renderBookmarksModalList(filterQuery);
      }
    });
  });
}

export function exportBookmarksMarkdown() {
  const moments = getSavedMoments();
  if (!moments.length) {
    showToast(t("Нет закладок для экспорта", "No bookmarks to export"));
    return;
  }

  // Group by title
  const grouped = {};
  moments.forEach((m) => {
    const key = m.title || "Без названия";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  });

  const nowStr = new Date().toISOString().slice(0, 10);
  let md = `# Заметки и закладки CineFlow\n*Экспортировано: ${nowStr}*\n\n`;

  for (const [title, list] of Object.entries(grouped)) {
    md += `## ${title}\n`;
    list.sort((a, b) => (a.time || 0) - (b.time || 0));
    list.forEach((m) => {
      const timeStr = m.label || formatTime(m.time);
      const isSeries = m.media_type === "series";
      const epPrefix = isSeries ? `(S${m.season || 1}·E${m.episode || 1}) ` : "";
      const noteStr = m.note ? ` — ${m.note}` : "";
      md += `- **${timeStr}** ${epPrefix}${noteStr}\n`;
    });
    md += "\n";
  }

  try {
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CineFlow_Bookmarks_${nowStr}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(t("Файл закладок Markdown сохранён", "Markdown bookmarks file saved"));
  } catch (_) {
    showToast(t("Не удалось экспортировать закладки", "Could not export bookmarks"));
  }
}

export function initBookmarksListeners() {
  document.getElementById("btn-close-bookmark-dialog")?.addEventListener("click", () => {
    closeBookmarkNoteDialog(true);
  });
  document.getElementById("btn-cancel-bookmark")?.addEventListener("click", () => {
    closeBookmarkNoteDialog(true);
  });
  document.getElementById("btn-save-bookmark")?.addEventListener("click", () => {
    saveCurrentBookmarkNote();
  });
  document.getElementById("btn-delete-bookmark")?.addEventListener("click", () => {
    deleteCurrentBookmark();
  });

  const noteInput = document.getElementById("bookmark-note-input");
  noteInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveCurrentBookmarkNote();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeBookmarkNoteDialog(true);
    }
  });

  document.getElementById("vc-btn-bookmark")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleBookmarksPopover();
  });

  document.getElementById("close-bookmarks-modal")?.addEventListener("click", () => {
    closeBookmarksModal();
  });
  document.getElementById("btn-export-bookmarks-md")?.addEventListener("click", () => {
    exportBookmarksMarkdown();
  });
  document.getElementById("bookmarks-search-input")?.addEventListener("input", (e) => {
    renderBookmarksModalList(e.target.value);
  });
}
