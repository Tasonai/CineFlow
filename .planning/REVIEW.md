---
phase: recent-changes-review
reviewed: 2026-11-03T12:00:00Z
depth: deep
files_reviewed: 7
files_reviewed_list:
  - backend/kinorium.py
  - backend/updater.py
  - server.py
  - public/js/player.js
  - public/js/catalog.js
  - public/css/base-and-hero.css
  - public/js/settings.js
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
  previously_found: 11
  resolved: 11
  necessity: 0
status: all_resolved
---

# Code Review Report

**Reviewed:** 2026-11-03T12:00:00Z  
**Resolved:** 2026-11-03T20:05:00Z  
**Depth:** deep  
**Files Reviewed:** 7  
**Status:** all_resolved (all 11 issues resolved & verified with 90/90 tests passing)

## Summary

Reviewed the recent changes across `backend/kinorium.py`, `backend/updater.py`, `server.py`, `public/js/player.js`, `public/js/catalog.js`, `public/css/base-and-hero.css`, and `public/js/settings.js`.

Key concerns identified:
1. **Security & Updater Integrity (`backend/updater.py`, `server.py`):**
   - `POST /api/system/update/download` accepts caller-controlled `url`, `sha256`, `size`, and `filename` parameters from the request body, and `open_installer` executes/installs the downloaded file (including stripping macOS Gatekeeper quarantine attributes via `xattr -cr` and replacing `/Applications/CineFlow.app`) even when `sha256_verified` is `False` or when concurrent calls spawn duplicate detached installer processes.
   - `AppUpdater` validates URLs with `validate_safe_external_url()` prior to calling `urllib.request.build_opener`, but does not use `backend.doh._SafePublicHTTPSHandler` to pin socket connections to the verified IP, leaving a DNS-rebinding TOCTOU window.
   - `AppUpdater.check_for_updates()` releases `self._lock` during network I/O and unconditionally overwrites `self._status["state"]` upon completion, clobbering an active `"downloading"` or `"installing"` state.
2. **Kinorium Sync & Episode Reconciliation (`backend/kinorium.py`, `server.py`):**
   - `_merge_remote_episodes_into_local` overwrites unsynced local episode ratings (`remote_synced: False`) with stale remote ratings whenever `fetch_series_episodes_state` is called with `item_id` (such as at the start of `reconcile_series_episodes` and `_sync_episodes_map_to_kinorium_remote`).
   - `update_progress_and_scrobble` executes `_sync_episodes_map_to_kinorium_remote` synchronously on the `/api/kinorium/scrobble` request thread, blocking the HTTP response while mutating cached `ep_info` dicts without `self._episodes_lock`.
   - `_ip_blocked_until` checks outside `_kinorium_http_request` ignore `_ip_blocked_proxy_sig`, keeping cooldown active even after the user changes proxy settings.
   - `_start_background_watching_sync_daemon` runs `reconcile_local_statuses_to_remote` and `reconcile_all_local_episodes` *before* checking `LAST_STREAM_ACTIVITY_TS`.
3. **Player Scrobble & Hero Ambient Teaser (`public/js/player.js`, `public/js/catalog.js`):**
   - `markOutgoingEpisodeWatched` and the `video` `ended` listener check `!remoteSyncedMap[epKey]` while the 95% `reportScrobbleProgress` request is still in-flight, firing duplicate concurrent `/api/kinorium/scrobble` POSTs. Additionally, `hasStartedWatchingCurrentEpisode` triggers `markOutgoingEpisodeWatched` after only 10 seconds of playback.
   - In `scheduleHeroAmbientTeaser`, looping at trailer end (`pState === 0`) sets `state.heroTeaserUnmuted = false` and hides the video without muting the iframe or resetting `revealed = false`, leaving unmuted audio playing invisibly on loop.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Arbitrary URL/Checksum Override in `/api/system/update/download` and Unverified Execution in `open_installer`

**File:** [server.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/server.py#L6250-L6255), [updater.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/updater.py#L513-L757)
**Classification:** BLOCKER
**Issue:**
1. `POST /api/system/update/download` ([server.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/server.py#L6250-L6255)) passes caller-supplied `url`, `sha256`, `size`, and `filename` from the JSON request body directly into `app_updater.start_download(...)`. Any local process or request without an `Origin` header can force `AppUpdater` to download an arbitrary `.dmg` or `.exe` from any public HTTPS server into `~/Downloads`, supply its own SHA-256 (or omit `sha256` entirely), and then trigger `POST /api/system/update/open`.
2. In `AppUpdater.start_download` ([updater.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/updater.py#L658-L667)), if `target_sha` is empty, the file is still promoted to `dest_path` with `"state": "downloaded"` and `"sha256_verified": False`.
3. In `AppUpdater.open_installer` ([updater.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/updater.py#L718-L750)), the macOS auto-installer mounts the DMG, deletes `/Applications/CineFlow.app`, copies the new bundle, **strips Gatekeeper quarantine attributes (`xattr -cr /Applications/CineFlow.app`)**, and launches the app without requiring `self._status.get("sha256_verified") is True`. Furthermore, `open_installer` has no re-entrancy guard: if called twice (e.g., overlapping poll timer and button click in `settings.js`), two detached Python processes concurrently run `shutil.rmtree('/Applications/CineFlow.app')` and `ditto`, corrupting the application bundle.

**Fix:**
1. In `server.py`, do not accept `url`, `sha256`, `size`, or `filename` from the request body in `/api/system/update/download`:
```python
res_dl = app_updater.start_download()
```
2. In `backend/updater.py`, require `sha256_verified` before running the automated silent `/Applications/CineFlow.app` replacement and `xattr -cr`, and guard `open_installer` against concurrent invocations while already `"installing"`:
```python
with self._lock:
    if self._status.get("state") == "installing" and (time.time() - float(self._status.get("install_started_at") or 0.0)) < 15.0:
        st = self.get_status()
        return {"ok": True, "already_installing": True, "file_path": str(self._status.get("file_path") or ""), "status": st, "updater": st}
    file_path = str(self._status.get("file_path") or "").strip()
    sha256_verified = bool(self._status.get("sha256_verified"))
```
Only run the automated `ditto` + `xattr -cr` replacement when `sha256_verified` is `True`; otherwise fall back to `subprocess.Popen(["open", file_path])` so macOS Gatekeeper verifies the disk image normally.

---

### CR-02: DNS Rebinding TOCTOU in `AppUpdater` HTTP Opener

**File:** [updater.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/updater.py#L80-L91), [updater.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/updater.py#L208-L235), [updater.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/updater.py#L625-L633)
**Classification:** BLOCKER
**Issue:** `AppUpdater._http_get_json`, `_http_get_text`, and `start_download._worker` call `validate_safe_external_url(url)` before calling `urllib.request.build_opener(_SafeUpdateRedirectHandler()).open(...)`. Because `build_opener` uses standard `urllib.request.HTTPSHandler` instead of `backend.doh._SafePublicHTTPSHandler`, `http.client` performs a second, unpinned OS DNS lookup when connecting the socket. A malicious `update_manifest_url` or redirect host with `TTL=0` can resolve to a public IP during `validate_safe_external_url()` and rebind to `127.0.0.1` or a private LAN address on socket connect.

**Fix:** Include `_SafePublicHTTPSHandler` from `backend.doh` when building the opener in `backend/updater.py`:
```python
from backend.doh import _SafePublicHTTPSHandler, validate_safe_external_url

def _build_safe_update_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        _SafePublicHTTPSHandler(),
        _SafeUpdateRedirectHandler(),
    )
```

---

### CR-03: Race Condition in `AppUpdater.check_for_updates` Clobbering Active Download State

**File:** [updater.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/updater.py#L401-L503)
**Classification:** BLOCKER
**Issue:** `check_for_updates()` checks `if self._status.get("state") == "downloading": return self.get_status()` at line 404, sets `self._status["state"] = "checking"`, and then releases `self._lock` while performing network requests (lines 439–450). If `start_download()` starts while `check_for_updates()` is awaiting network I/O, `start_download()` sets `state = "downloading"` and launches `_worker`. When `check_for_updates()` finishes and re-acquires `self._lock` at line 452, it unconditionally overwrites `self._status["state"]` to `"available"`, `"up_to_date"`, or `"error"`, wiping out the active download state while `_worker` is still running.

**Fix:** Re-check the current state after re-acquiring `self._lock` at line 452:
```python
with self._lock:
    if self._status.get("state") in ("downloading", "installing"):
        return self.get_status()
    self._status["last_checked_at"] = now
```

---

## Warnings

### WR-01: `_merge_remote_episodes_into_local` Overwrites Unsynced Local Episode Ratings With Stale Remote Ratings

**File:** [kinorium.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium.py#L7831-L7850)
**Classification:** WARNING
**Issue:** Both `_sync_episodes_map_to_kinorium_remote` (line 8009) and `reconcile_series_episodes` (line 8158) call `self.fetch_series_episodes_state(kid, item_id=item_id)` **before** pushing local episode ratings to Kinorium. When `item_id` is passed, `fetch_series_episodes_state` calls `_merge_remote_episodes_into_local` (lines 7885, 7917). At lines 7836–7849:
```python
if not isinstance(existing_r, dict) or existing_r.get("score") != int(r_val):
    r_map[ep_key] = {
        "season": s_num,
        "episode": e_num,
        "score": int(r_val),
        ...
    }
```
If the user updated an episode's rating locally (so `existing_r` has `{"score": new_score, "remote_synced": False}`) and Kinorium still has an older rating `r_val != new_score`, `_merge_remote_episodes_into_local` overwrites the user's unsynced local rating with the stale remote `r_val` before `reconcile_series_episodes` or `_sync_episodes_map_to_kinorium_remote` can push `new_score`. Furthermore, the dict constructed at lines 7837–7848 omits `"remote_synced": True`, causing subsequent checks `ep_entry.get("remote_synced") is not True` (lines 5603, 5666, 8663) to treat already-synced remote ratings as unsynced!

**Fix:** Skip overwriting `existing_r` when `isinstance(existing_r, dict) and existing_r.get("remote_synced") is False`, and include `"remote_synced": True` when saving remote ratings into `er_root`:
```python
if isinstance(existing_r, dict) and existing_r.get("remote_synced") is False:
    continue
if not isinstance(existing_r, dict) or existing_r.get("score") != int(r_val) or existing_r.get("remote_synced") is not True:
    r_map[ep_key] = {
        "season": s_num,
        "episode": e_num,
        "score": int(r_val),
        "comment": str(existing_r.get("comment") or "") if isinstance(existing_r, dict) else "",
        "episode_title": str(
            (existing_r.get("episode_title") if isinstance(existing_r, dict) else "")
            or ep_info.get("ru_title")
            or ""
        ),
        "updated_at": now_str,
        "remote_synced": True,
    }
    changed = True
```

---

### WR-02: Synchronous Multi-Episode Remote Sync in `update_progress_and_scrobble` Blocks Scrobble Responses and Causes Duplicate Requests

**File:** [kinorium.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium.py#L5606-L5624), [kinorium.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium.py#L8076-L8106), [player.js](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/player.js#L6852-L6862), [player.js](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/player.js#L7957-L7968)
**Classification:** WARNING
**Issue:**
1. In `update_progress_and_scrobble` ([kinorium.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium.py#L5589-L5615)), when an episode reaches the watched threshold, `target_by_season` is populated with **all** watched episodes across **all** seasons for that series, and `self._sync_episodes_map_to_kinorium_remote(...)` is called synchronously on the HTTP request thread. On a cold episode cache or when prior episodes are unsynced, this performs multiple rate-limited HTTP requests (0.28s minimum spacing + up to 12s HTML fetch) before `/api/kinorium/scrobble` returns.
2. In `public/js/player.js`, `reportScrobbleProgress` sets `state.scrobbledEpisodesThisSession[reqEpKey] = true` immediately (line 8676), but only sets `state.remoteSyncedEpisodesThisSession[epKey] = true` **after** `await fetch("/api/kinorium/scrobble")` resolves (line 8768). When `timeupdate` triggers `reportScrobbleProgress` at 95% (line 7889) and the user then clicks "Next Episode" (`markOutgoingEpisodeWatched`, line 6853) or the video fires `ended` (line 7962) while the first request is still awaiting the backend's Kinorium network I/O, `!remoteSyncedMap[epKey]` evaluates to `true` and fires a **second concurrent** `/api/kinorium/scrobble` POST for the same episode.
3. Mutations to cached `ep_info["watched"]` and `ep_info["rating"]` in `_sync_episodes_map_to_kinorium_remote` (lines 8077, 8098, 8100) and `reconcile_series_episodes` (lines 8241, 8284, 8315) happen without acquiring `self._episodes_lock`.

**Fix:**
1. In `public/js/player.js`, track in-flight scrobble requests per `reqEpKey` (e.g., `state.scrobbleInFlightEpisodes[reqEpKey]`) so `markOutgoingEpisodeWatched` and `ended` do not fire a duplicate request while one is already in flight.
2. In `backend/kinorium.py` (`update_progress_and_scrobble`), only sync the current `(int(season), int(episode))` synchronously (or via `_run_remote_sync_bg`), and leave multi-episode catch-up of older dirty episodes to the background `reconcile_series_episodes` worker. Protect `ep_info` mutations with `with self._episodes_lock:`.

---

### WR-03: `markOutgoingEpisodeWatched` Marks Entire Episode Watched After Only 10 Seconds of Playback

**File:** [player.js](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/player.js#L6836-L6863)
**Classification:** WARNING
**Issue:** `hasStartedWatchingCurrentEpisode` ([player.js](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/player.js#L6836-L6842)) returns `true` as soon as `cur >= 10` seconds (or `cur / dur >= 0.10`). When a user opens an episode, watches 10–15 seconds (e.g., checking audio track or realizing they clicked the wrong episode), and then clicks the next episode pill or presses "Next Episode", `markOutgoingEpisodeWatched` unconditionally marks the outgoing episode as 100% watched (`saveEpisodeProgress(item, sNum, eNum, effDur, effDur)` and `reportScrobbleProgress(..., { forceWatched: true })`) and pushes a `"done"` status to Kinorium.

**Fix:** Require meaningful playback progress (e.g., `cur / dur >= 0.50` or `cur >= 600` when `dur` is unknown, or `creditsStarted`) in `hasStartedWatchingCurrentEpisode` before auto-marking an outgoing episode as 100% watched on episode switch; for shorter playback (`>= 10s`), save the partial resume progress (`saveEpisodeProgress(item, sNum, eNum, cur, dur)`) without `forceWatched: true`.

---

### WR-04: IP Block Cooldown Checks Ignore Proxy Configuration Changes Outside `_kinorium_http_request`

**File:** [kinorium.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium.py#L1550), [kinorium.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium.py#L2807), [kinorium.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium.py#L5654), [kinorium.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium.py#L8641), [server.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/server.py#L7344)
**Classification:** WARNING
**Issue:** `_kinorium_http_request` ([kinorium.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium.py#L1550)) scopes the 10-minute HTTP 403/429 circuit breaker to the proxy signature (`now_req < self._ip_blocked_until and proxy_sig == self._ip_blocked_proxy_sig`) so that configuring or changing a proxy immediately bypasses the cooldown. However, `fetch_online_premieres` (line 2807), `update_progress_and_scrobble` (line 5654), `reconcile_all_local_episodes` (line 8641), and `_start_background_watching_sync_daemon` ([server.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/server.py#L7344)) check raw `time.time() < self._ip_blocked_until` without comparing `_ip_blocked_proxy_sig`. If a user adds a proxy after a 403 block, these callers remain blocked for up to 10 minutes.

**Fix:** Add a method `is_ip_cooldown_active(self) -> bool` on `KinoriumService`:
```python
def is_ip_cooldown_active(self) -> bool:
    proxy_sig = str(getattr(self, "proxy_url", None) or "")
    return time.time() < self._ip_blocked_until and proxy_sig == self._ip_blocked_proxy_sig
```
and use `self.is_ip_cooldown_active()` / `kinorium_service.is_ip_cooldown_active()` at all call sites.

---

### WR-05: `_start_background_watching_sync_daemon` Runs Kinorium Sync Before Checking `LAST_STREAM_ACTIVITY_TS` and `reconcile_local_statuses_to_remote` Drops Dirty State on Mid-Run Profile Switch

**File:** [server.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/server.py#L7338-L7351), [kinorium.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium.py#L8398-L8634)
**Classification:** WARNING
**Issue:**
1. In `_start_background_watching_sync_daemon` ([server.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/server.py#L7341-L7350)), `reconcile_local_statuses_to_remote()` and `reconcile_all_local_episodes(pull_watching_limit=4)` are executed *before* the active-playback guard `while time.time() - LAST_STREAM_ACTIVITY_TS < 25.0: time.sleep(10.0)`. If the user is actively streaming when the daemon wakes up (e.g., 45s after app launch), it immediately runs multi-threaded Kinorium network calls and SQLite state writes during playback.
2. In `reconcile_local_statuses_to_remote()` ([kinorium.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/backend/kinorium.py#L8528-L8556)), `_sync_to_kinorium_remote(...)` runs outside `self._state_lock`. If `switch_state_file()` is called on another thread while `_sync_to_kinorium_remote` is in flight, `switch_state_file` flushes the old profile's state, and even though line 8538 checks `if self._profile_id == start_pid:`, any earlier iterations that incremented `pushed` and mutated `self.state` in memory (without calling `_save_state(immediate=False)`) were not marked `_save_dirty = True`, so `switch_state_file` (which only flushes `if self._save_dirty`) did not persist them before switching profiles!

**Fix:**
1. Move `while time.time() - LAST_STREAM_ACTIVITY_TS < 25.0: time.sleep(10.0)` to the top of the `while True:` loop in `_start_background_watching_sync_daemon` before `reconcile_local_statuses_to_remote()`.
2. In `reconcile_local_statuses_to_remote()`, set `self._save_dirty = True` inside each `with self._state_lock:` block whenever in-memory state is updated after a remote push, so `switch_state_file()` flushes those updates if a profile switch occurs mid-reconciliation.

---

### WR-06: Hero Ambient Teaser Loops Invisible Unmuted Audio and Reveals Behind Open Modals

**File:** [catalog.js](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog.js#L1678-L1736)
**Classification:** WARNING
**Issue:**
1. `revealWhenClean` ([catalog.js](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog.js#L1678-L1689)) checks `if (state.isPlayerOpen || !teaserWrap.isConnected || teaserWrap.classList.contains("hidden")) return;`, but does not check `isAnyOverlayModalOpen() || document.hidden`. If a user opens Quick Peek, Person Modal, or Settings during the 1.25s–1.95s reveal delay, the teaser reveals and plays behind the open modal.
2. In `_heroTeaserMsgHandler` ([catalog.js](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog.js#L1716-L1726)), when the trailer reaches the end (`pState === 0`), the handler removes `is-playing` from `teaserWrap`, hides `soundBtn`, sets `state.heroTeaserPlaying = false` and `state.heroTeaserUnmuted = false`, and then loops playback via `postYtCmd("seekTo", [1, true]); postYtCmd("playVideo");`. However:
   - Because `revealed` remains `true` (`if (revealed) return;` at line 1679), when the looped video emits `pState === 1`, `revealWhenClean(1250)` returns immediately and **never re-adds `is-playing` or unhides `soundBtn`**.
   - Worse, if the user had unmuted the trailer (`isMuted === false`), `pState === 0` sets `state.heroTeaserUnmuted = false` without calling `postYtCmd("mute")` or resetting `isMuted = true`, leaving the looped trailer playing **with sound** while `teaserWrap` is invisible (`opacity: 0`) and `soundBtn` is hidden!

**Fix:**
1. In `revealWhenClean`, check `isAnyOverlayModalOpen() || document.hidden`:
```javascript
if (state.isPlayerOpen || isAnyOverlayModalOpen() || document.hidden || !teaserWrap.isConnected || teaserWrap.classList.contains("hidden")) return;
```
2. On `pState === 0 || pState === 2`, reset `revealed = false;`, and if muting/resetting on pause/end, also reset `isMuted = true; postYtCmd("mute");` and update `soundBtn` icon/title (or preserve `isMuted` across loop and let `revealWhenClean` re-reveal `teaserWrap` and `soundBtn`).

---

## Info

### IN-01: Unredacted Host Paths and Updater Config in `app_updater.get_status()` for Non-Loopback Clients

**File:** [server.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/server.py#L559-L561), [server.py](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/server.py#L4895-L4902)
**Classification:** INFO
**Issue:** `get_system_status_payload(is_local_client)` redacts top-level `update_repo` and `update_manifest_url` when `is_local_client=False`, but embeds `"updater": app_updater.get_status()`, which still contains `update_repo`, `update_manifest_url`, `file_path`, and `downloaded_path` (exposing the host OS username via `/Users/<user>/Downloads/...`). Additionally, `GET /api/system/update/check` does not check `_require_authorized_client_if_lan()`.

**Fix:** Pass `redact_local_paths=not is_local_client` (or strip `file_path`, `downloaded_path`, `update_repo`, and `update_manifest_url` for non-loopback clients) in `get_system_status_payload` and `/api/system/update/status`, and add `if not self._require_authorized_client_if_lan(): return` to `GET /api/system/update/check`.

---

### IN-02: Hero Sound Toggle Accessibility Attributes & Minor Formatting

**File:** [catalog.js](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog.js#L1666), [catalog.js](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog.js#L1721), [catalog.js](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/catalog.js#L1745-L1746), [settings.js](file:///Users/tasonai/Documents/antigravity/agitated-mendeleev/public/js/settings.js#L1231)
**Classification:** INFO
**Issue:**
1. `#hero-sound-toggle` in `public/js/catalog.js` does not update `aria-label` or `aria-pressed` when toggled (`soundBtn.onclick` at line 1745 only updates `soundBtn.title`), and line 1721 has misaligned indentation.
2. `public/js/settings.js:1231` hardcodes `"2.6.11"` as a fallback version string (`upd.current_version || state.appVersion || "2.6.11"`), duplicating the version constant already imported via `state.appVersion`.

**Fix:** Update `aria-pressed` and `aria-label` in `soundBtn.onclick`, fix indentation at `catalog.js:1721`, and rely on `state.appVersion` in `settings.js:1231`.

---

_Reviewed: 2026-11-03T12:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
