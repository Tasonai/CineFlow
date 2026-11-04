# Seamless Next-Episode Pre-Buffering & Instant Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement seamless zero-freeze next-episode transitions in CineFlow for series. When nearing the end of an episode (credits detected or 2.5 minutes remaining), automatically pre-resolve stream URLs, pre-warm HLS manifests and initial video segments into cache with low network priority, pre-fetch skip-intro timestamps and subtitles, and perform an instant seamless stream swap without black frames or loading spinner flicker.

**Tech Stack:** Vanilla ES Modules (`public/js/*.js`), Pure CSS with Apple TV matte design tokens (`public/css/*.css`), Python 3 standard library backend, Unittest test suite.

## Global Constraints

- Never run installer packaging scripts (`macos/build_macos_app.py`, `windows/build_windows_installer.py`) without explicit direct user command.
- Zero dotted Russian abbreviations (`сек.`, `мин.`, `эп.`, `стр.`, `г.`) in UI strings or titles.
- Zero unicode emojis in UI strings; use Apple TV matte SVG icons.
- CSS `outline:` strictly `none` or `0` across all stylesheets.
- No `backdrop-filter: blur(...)` (use matte colors).
- All `:hover` selectors inside `@media (hover: hover) and (pointer: fine)`.
- 100% test pass rate across full test suite (`python3 -B run_tests.py`).
- Static asset cache token bumped upon completion.

---

### Task 1: Smart Preload Trigger & Multi-Tier Stream Pre-Buffering

**Files:**
- Modify: `public/js/state.js`
- Modify: `public/js/player-streams.js`
- Modify: `public/js/player-intro-credits.js`
- Test: `tests/test_roadmap_features.py`

**Steps:**
- [x] 1. Expand `state.js` with `preloadedSkipSegments` and `preloadedNextSubtitles`.
- [x] 2. In `public/js/player-streams.js`: update `preloadNextEpisodeIfNeeded(curSec, durSec)`:
  - Trigger when credits start (`getDetectedCreditsStartSec(durSec)`), or `ratio >= 0.82 || remain <= 150`.
  - Implement `warmUpStreamBuffer(url)` to pre-fetch manifest, media playlist, and initial video transport segments with `priority: "low"` so playback bandwidth is never starved.
  - Pre-fetch `/api/skip-intro` segments and `/api/subtitles/list` for the next episode.
- [x] 3. In `public/js/player-intro-credits.js`: when credits start or when `#player-next-ep-toast` appears, trigger `preloadNextEpisodeIfNeeded`.
- [x] 4. In `public/js/player-intro-credits.js`: in `loadSkipIntroSegments()`, check if `state.preloadedSkipSegments` is available and use it immediately.

---

### Task 2: Zero-Freeze Instant Swap in Player and Season Stepper

**Files:**
- Modify: `public/js/player.js`
- Modify: `public/js/player-seasons.js`
- Test: `tests/test_roadmap_features.py`

**Steps:**
- [x] 1. In `public/js/player.js`: enhance `playVideoUrl(streamUrl, startTime, sessionId, options)`:
  - Add `options.isInstantSwap` flag.
  - If `isInstantSwap` is true, avoid unhiding `#video-loader` immediately. Instead, delay spinner by 400ms: if prebuffered chunks play immediately on the first frame, the spinner never flashes.
- [x] 2. In `public/js/player-seasons.js`: in `stepEpisode(delta)`:
  - When `delta > 0` and preloaded stream is ready, pass `isInstantSwap: true` to `loadHDRezkaStream` / `loadStremioStreams` / `loadBackup4KReleases`.
  - Instantly mount preloaded skip-intro markers and subtitles without blanking the stage.

---

### Task 3: Preload Status Indicator & Apple TV Styling

**Files:**
- Modify: `public/css/video-controls-and-person.css`
- Modify: `public/js/player-streams.js`

**Steps:**
- [x] 1. In `public/css/video-controls-and-person.css`: add styles for `.atv-preload-ready-dot` and `#skip-outro-btn.is-preloaded`.
  - Cyan/emerald matte pulse indicator on the button.
  - Wrap `:hover` selectors in `@media (hover: hover) and (pointer: fine)`.
  - Strict `outline: none;`.
- [x] 2. In `public/js/player-streams.js`: set class `.is-preloaded` and inject indicator on `#skip-outro-btn` when preloaded.

---

### Task 4: Automated Testing

**Files:**
- Modify: `tests/test_roadmap_features.py`
- Test: `tests/test_frontend_integrity.py`

**Steps:**
- [x] 1. Add unit and regression tests in `tests/test_roadmap_features.py` for:
  - Next-episode preloading condition calculation (ratio, remain, credits detection).
  - Preloaded stream metadata, skip segments, and subtitles caching.
  - `isInstantSwap` option in stream loader.
  - Preload ready indicator CSS and DOM presence.
- [x] 2. Run `python3 -m unittest tests/test_roadmap_features.py` and `tests/test_frontend_integrity.py`.

---

### Task 5: Full Suite Verification, Cache Token Bump, and App Sync

**Files:**
- Run: `python3 scripts/bump_cache_token.py`
- Run: `python3 -B run_tests.py`
- Sync: `/Applications/CineFlow.app/Contents/Resources/app/`
- Git: Atomic commit

**Steps:**
- [x] 1. Bump cache token with `scripts/bump_cache_token.py`.
- [x] 2. Run full test suite (`python3 -B run_tests.py`) ensuring 100% pass rate.
- [x] 3. Sync files to local `/Applications/CineFlow.app/Contents/Resources/app/`.
- [x] 4. Commit git changes atomically.
- [ ] 4. Commit changes with atomic commit message.
