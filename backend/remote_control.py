import collections
import copy
import hmac
import secrets
import threading
import time
from typing import Any, Deque, Dict, List, Optional


class DesktopRemoteBroker:
    """
    Zero-dependency, low-latency bidirectional broker between the desktop Velarium
    instance (normal window, fullscreen, miniplayer, PiP, or TV Mode) and one or more
    paired smartphones on the home Wi-Fi network.
    """

    ALLOWED_COMMANDS = {
        "toggle_play",
        "play",
        "pause",
        "seek_rel",
        "seek_to",
        "seek_abs",
        "set_volume",
        "toggle_mute",
        "set_studio",
        "set_quality",
        "set_subtitle",
        "set_source_tab",
        "sub_offset",
        "step_episode",
        "prev_ep",
        "next_ep",
        "select_episode",
        "skip_intro",
        "toggle_fullscreen",
        "toggle_mini",
        "toggle_pip",
        "toggle_tv_mode",
        "close_player",
        "dpad",
        "play_item",
        "ping_desktop",
        "rate_active",
        "toggle_watched",
        "toggle_bookmark",
        "add_bookmark_note",
        "delete_bookmark",
        "jump_marker",
        "set_playback_rate",
        "set_sleep_timer",
        "open_person",
        "toggle_xray",
        "set_audio_preset",
        "set_video_crop",
        "toggle_ambilight",
        "cycle_subtitle",
        "cycle_audio",
    }

    def __init__(self, initial_token: str = "") -> None:
        self._cond = threading.Condition()
        clean_tok = str(initial_token or "").strip().lower()
        if len(clean_tok) < 6 or not all(c in "0123456789abcdef" for c in clean_tok):
            clean_tok = secrets.token_hex(8)
        self._pair_token: str = clean_tok[:16]
        self._token_epoch: int = 0
        self._failed_key_ts: Deque[float] = collections.deque(maxlen=64)
        self._key_lockout_until: float = 0.0
        self._state_version: int = 1
        self._desktop_last_seen: float = 0.0
        self._connected_clients: Dict[str, Dict[str, Any]] = {}
        self._cmd_seq: int = 0
        self._commands: Deque[Dict[str, Any]] = collections.deque(maxlen=64)
        self._state: Dict[str, Any] = {
            "app_lang": "ru",
            "is_player_open": False,
            "desktop_mode": "window",
            "tv_mode": False,
            "playing": False,
            "current_time": 0.0,
            "duration": 0.0,
            "playback_rate": 1.0,
            "volume": 1.0,
            "muted": False,
            "active_source_tab": "hdrezka",
            "active_item": None,
            "studios": [],
            "active_studio": "",
            "active_studio_name": "",
            "qualities": [],
            "active_quality": "",
            "subtitles": [],
            "active_sub_idx": -1,
            "sub_offset_sec": 0.0,
            "has_skip_intro": False,
            "has_next_ep": False,
            "has_prev_ep": False,
            "bookmarks": [],
            "chapters": [],
            "active_chapter": "",
            "seasons_map": {},
            "watched_episodes": {},
            "sleep_timer_mode": "off",
            "sleep_timer_rem_sec": 0,
            "xray_open": False,
            "audio_preset": "flat",
            "audio_boost": 1.0,
            "video_crop": "contain",
            "ambilight_enabled": True,
            "native_fs_ready": False,
            "native_pip_ready": False,
            "active_profile_id": "main",
            "kids_mode": False,
            "updated_at_ms": int(time.time() * 1000),
        }

    @property
    def pair_token(self) -> str:
        with self._cond:
            return self._pair_token

    @pair_token.setter
    def pair_token(self, value: str) -> None:
        clean = str(value or "").strip().lower()
        if len(clean) >= 6 and all(c in "0123456789abcdef" for c in clean):
            with self._cond:
                if self._pair_token != clean[:16]:
                    self._token_epoch += 1
                self._pair_token = clean[:16]
                self._failed_key_ts.clear()
                self._key_lockout_until = 0.0

    def rotate_pair_token(self) -> str:
        with self._cond:
            self._pair_token = secrets.token_hex(8)
            self._token_epoch += 1
            self._connected_clients.clear()
            self._commands.clear()
            self._failed_key_ts.clear()
            self._key_lockout_until = 0.0
            self._state_version += 1
            self._cond.notify_all()
            return self._pair_token

    def rotate_token(self) -> str:
        return self.rotate_pair_token()

    def verify_key(self, provided_key: str, is_loopback: bool = False) -> bool:
        if is_loopback:
            return True
        cand = str(provided_key or "").strip().lower()
        if not cand or len(cand) > 64:
            return False
        mono_now = time.monotonic()
        with self._cond:
            expected = self._pair_token
            locked_out = mono_now < self._key_lockout_until
        if locked_out:
            return False
        ok = hmac.compare_digest(cand.encode("utf-8"), expected.encode("utf-8"))
        if not ok:
            with self._cond:
                self._failed_key_ts.append(mono_now)
                recent = [t for t in self._failed_key_ts if mono_now - t < 60.0]
                if len(recent) >= 30:
                    # Brute-force guard: freeze wrong guesses for a minute
                    self._key_lockout_until = mono_now + 60.0
                    self._failed_key_ts.clear()
        return ok

    def _prune_clients_locked(self, now: float) -> List[Dict[str, Any]]:
        stale = [
            cid
            for cid, meta in self._connected_clients.items()
            if (now - float(meta.get("last_seen", 0.0))) > 35.0
        ]
        for cid in stale:
            self._connected_clients.pop(cid, None)
        return [dict(v) for v in self._connected_clients.values()]

    def get_connected_remotes(self) -> List[Dict[str, Any]]:
        now = time.time()
        with self._cond:
            return self._prune_clients_locked(now)

    def _touch_remote_client_locked(
        self,
        now: float,
        client_id: str = "",
        device_name: str = "",
        client_ip: str = "",
    ) -> bool:
        key = str(client_id or "").strip()[:64]
        if not key:
            if not client_ip or client_ip in ("127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"):
                return False
            key = f"ip:{str(client_ip)[:48]}"
        was_new = key not in self._connected_clients
        if was_new and len(self._connected_clients) >= 64:
            self._prune_clients_locked(now)
            if len(self._connected_clients) >= 64:
                oldest_cid = min(
                    self._connected_clients.keys(),
                    key=lambda k: float(self._connected_clients[k].get("last_seen", 0.0)),
                )
                self._connected_clients.pop(oldest_cid, None)
        prev = self._connected_clients.get(key) or {}
        self._connected_clients[key] = {
            "client_id": key,
            "device_name": str(device_name or prev.get("device_name") or "Phone").strip()[:64],
            "client_ip": str(client_ip or prev.get("client_ip") or ""),
            "last_seen": now,
        }
        self._prune_clients_locked(now)
        if was_new:
            self._state_version += 1
            self._cond.notify_all()
        return was_new

    def touch_remote_client(
        self,
        client_id: str = "",
        device_name: str = "",
        client_ip: str = "",
    ) -> None:
        now = time.time()
        with self._cond:
            self._touch_remote_client_locked(now, client_id=client_id, device_name=device_name, client_ip=client_ip)

    def set_app_lang(self, lang: str) -> None:
        norm = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        with self._cond:
            if self._state.get("app_lang") != norm:
                self._state["app_lang"] = norm
                self._state["updated_at_ms"] = int(time.time() * 1000)
                self._state_version += 1
                self._cond.notify_all()

    ALLOWED_STATE_KEYS = {
        "app_lang",
        "is_player_open",
        "desktop_mode",
        "tv_mode",
        "playing",
        "current_time",
        "duration",
        "playback_rate",
        "volume",
        "muted",
        "active_source_tab",
        "active_item",
        "studios",
        "active_studio",
        "active_studio_name",
        "qualities",
        "active_quality",
        "subtitles",
        "active_sub_idx",
        "sub_offset_sec",
        "has_skip_intro",
        "has_next_ep",
        "has_prev_ep",
        "audio_tracks",
        "active_audio_idx",
        "season",
        "episode",
        "title",
        "poster",
        "watched",
        "user_rating",
        "bookmarks",
        "chapters",
        "active_chapter",
        "seasons_map",
        "watched_episodes",
        "sleep_timer_mode",
        "sleep_timer_rem_sec",
        "native_fs_ready",
        "native_pip_ready",
        "active_profile_id",
        "kids_mode",
    }

    def update_desktop_state(self, patch: Dict[str, Any], include_state: bool = True) -> Dict[str, Any]:
        if not isinstance(patch, dict):
            return self.get_snapshot()
        now = time.time()
        now_ms = int(now * 1000)
        with self._cond:
            prev_seen = self._desktop_last_seen
            self._desktop_last_seen = now
            state_changed = False
            for key, val in patch.items():
                k_str = str(key or "")
                if not k_str or k_str in ("k", "pin", "pair_token", "session_cookie"):
                    continue
                if k_str in self.ALLOWED_STATE_KEYS:
                    if self._state.get(k_str) != val:
                        self._state[k_str] = copy.deepcopy(val)
                        state_changed = True
            if state_changed or (now - prev_seen) >= 1.5:
                self._state["updated_at_ms"] = now_ms
                self._state_version += 1
                self._cond.notify_all()
            return self._snapshot_locked(now, include_state=include_state)

    def _snapshot_locked(self, now: Optional[float] = None, include_state: bool = True) -> Dict[str, Any]:
        ts = now if now is not None else time.time()
        remotes = self._prune_clients_locked(ts)
        desktop_online = (ts - self._desktop_last_seen) < 30.0
        snap: Dict[str, Any] = {
            "ok": True,
            "seq": self._state_version,
            "state_version": self._state_version,
            "desktop_online": desktop_online,
            "connected_remotes": remotes,
            "connected_count": len(remotes),
            "server_now_ms": int(ts * 1000),
        }
        if include_state:
            snap["state"] = copy.deepcopy(self._state)
        return snap

    def get_snapshot(self) -> Dict[str, Any]:
        with self._cond:
            return self._snapshot_locked()

    def get_state_flags(self) -> Dict[str, Any]:
        with self._cond:
            return {
                "native_fs_ready": bool(self._state.get("native_fs_ready")),
                "native_pip_ready": bool(self._state.get("native_pip_ready")),
            }

    def wait_for_state(
        self,
        since_seq: Optional[int] = None,
        after_ver: int = -1,
        timeout: float = 15.0,
        client_id: str = "",
        device_name: str = "",
        client_ip: str = "",
    ) -> Dict[str, Any]:
        target_ver = int(since_seq) if since_seq is not None else int(after_ver)
        wait_s = max(0.0, min(25.0, float(timeout or 0.0)))
        is_local_wait = not client_ip or client_ip in ("127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost")
        deadline = time.monotonic() + wait_s
        now = time.time()
        with self._cond:
            ver_before_touch = self._state_version
            if client_id or not is_local_wait:
                self._touch_remote_client_locked(now, client_id=client_id, device_name=device_name, client_ip=client_ip)
            if target_ver == ver_before_touch and self._state_version == ver_before_touch + 1:
                target_ver = self._state_version
            start_epoch = self._token_epoch
            # If server restarted and client's cached version is ahead of _state_version, resync immediately
            if target_ver > self._state_version:
                return self._snapshot_locked()
            while self._state_version <= target_ver and self._token_epoch == start_epoch:
                rem = deadline - time.monotonic()
                if rem <= 0:
                    break
                self._cond.wait(timeout=rem)
            if not is_local_wait and self._token_epoch != start_epoch:
                return {
                    "ok": False,
                    "error": "Unauthorized remote key",
                    "token_rotated": True,
                    "seq": 0,
                    "state": {},
                }
            return self._snapshot_locked()

    def _prune_commands_locked(self, now: float) -> None:
        while self._commands and (now - float(self._commands[0].get("created_at") or 0.0)) > 30.0:
            self._commands.popleft()

    def enqueue_command(
        self,
        cmd: str = "",
        args: Optional[Dict[str, Any]] = None,
        action: str = "",
        payload: Optional[Dict[str, Any]] = None,
        client_id: str = "",
        device_name: str = "",
        client_ip: str = "",
    ) -> Dict[str, Any]:
        clean_cmd = str(action or cmd or "").strip()
        if clean_cmd not in self.ALLOWED_COMMANDS:
            return {"ok": False, "error": f"Unsupported remote command: {clean_cmd}"}
        cmd_args = payload if isinstance(payload, dict) else (args if isinstance(args, dict) else {})
        if client_id or (client_ip and client_ip not in ("127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost")):
            self.touch_remote_client(client_id=client_id, device_name=device_name, client_ip=client_ip)
        now = time.time()
        with self._cond:
            self._prune_commands_locked(now)
            self._cmd_seq += 1
            entry = {
                "id": self._cmd_seq,
                "seq": self._cmd_seq,
                "action": clean_cmd,
                "cmd": clean_cmd,
                "payload": copy.deepcopy(cmd_args),
                "args": copy.deepcopy(cmd_args),
                "device_name": str(device_name or "Phone")[:64],
                "created_at": now,
            }
            self._commands.append(entry)
            self._cond.notify_all()
            return {"ok": True, "seq": self._cmd_seq, "id": self._cmd_seq}

    def wait_for_commands(
        self,
        since_id: Optional[int] = None,
        after_seq: int = 0,
        timeout: float = 18.0,
    ) -> Dict[str, Any]:
        target_seq = int(since_id) if since_id is not None else int(after_seq)
        wait_s = max(0.0, min(25.0, float(timeout or 0.0)))
        deadline = time.monotonic() + wait_s
        with self._cond:
            now_init = time.time()
            self._desktop_last_seen = now_init
            self._prune_commands_locked(now_init)
            # If desktop is syncing initial cursor (target_seq < 0) or server restarted (target_seq > _cmd_seq),
            # return latest_seq immediately without replaying historical commands.
            if target_seq < 0 or target_seq > self._cmd_seq:
                remotes = self._prune_clients_locked(now_init)
                return {
                    "ok": True,
                    "latest_seq": self._cmd_seq,
                    "connected_remotes": remotes,
                    "connected_count": len(remotes),
                    "commands": [],
                }
            while self._cmd_seq <= target_seq:
                rem = deadline - time.monotonic()
                if rem <= 0:
                    break
                self._cond.wait(timeout=rem)
            now_end = time.time()
            self._desktop_last_seen = now_end
            self._prune_commands_locked(now_end)
            pending: List[Dict[str, Any]] = [
                copy.deepcopy(c) for c in self._commands if int(c.get("seq", 0)) > target_seq
            ]
            remotes = self._prune_clients_locked(now_end)
            return {
                "ok": True,
                "latest_seq": self._cmd_seq,
                "connected_remotes": remotes,
                "connected_count": len(remotes),
                "commands": pending,
            }
