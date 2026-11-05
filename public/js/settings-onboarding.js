import { state } from "./state.js?v=20261105v4";
import {
  applyStaticDomTranslations,
  isEn,
  syncLanguageSegmentedControlUI,
  t,
} from "./i18n.js?v=20261105v4";
import {
  closeCustomSelectMenu,
  escapeAttr,
  escapeHtml,
  rememberModalTriggerFocus,
  restoreModalTriggerFocus,
  showToast,
  syncAllCustomSelects,
  syncCustomSelect,
  syncScrollTopButton,
} from "./utils.js?v=20261105v4";
import { applyEnabledServicesVisibility } from "./catalog-media-resolver.js?v=20261105v4";
import {
  loadCatalog,
  renderLoginBannerIfNeeded,
  updateKinoriumUserBadge,
} from "./catalog.js?v=20261105v4";
import {
  ensureKidsPinVerifiedForAdminAction,
  renderHeaderProfileSwitcher,
} from "./features.js?v=20261105v4";
import {
  _adminPinPayload,
  getNetworkSettingsSnapshot,
  renderIntegrationsList,
} from "./settings.js?v=20261105v4";

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
  } catch (err) { window.logDebug?.("Settings", err); }
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
    } catch (err) { window.logDebug?.("Settings", err); }
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
