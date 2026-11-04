import json
import os
import re
import subprocess
import sys
import threading
import time
from typing import Any, Callable, Dict, Optional


_SUBPROC_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


class KinoriumOneClickAuthManager:
    """
    One-click Kinorium Authentication Manager (zero DevTools / manual cookie copying).
    Launches a native WebKit / WebView2 login window (`kinorium_login_helper` on macOS
    or `kinorium_login_webview.py` on Windows), captures the authenticated session cookie
    and `user_id` upon sign-in, saves them to the active profile, and syncs all lists.
    """

    RESULT_PREFIX = "CINEFLOW_KINORIUM_AUTH:"

    def __init__(
        self,
        base_dir: str,
        kinorium_service: Any,
        on_sync_complete: Optional[Callable[[], None]] = None,
    ):
        self.base_dir = os.path.abspath(base_dir)
        self.kinorium = kinorium_service
        self.on_sync_complete = on_sync_complete
        self._lock = threading.RLock()
        self._proc: Optional[subprocess.Popen] = None
        self._session_id: int = 0
        self._state: Dict[str, Any] = {
            "status": "idle",
            "session_id": 0,
            "user_id": "",
            "display_name": "",
            "error": "",
            "updated_at": 0.0,
            "sync": None,
        }

    def macos_helper_path(self) -> str:
        return os.path.join(self.base_dir, "backend", "bin", "kinorium_login_helper")

    def windows_helper_script_path(self) -> str:
        return os.path.join(self.base_dir, "windows", "kinorium_login_webview.py")

    def _resolve_windows_python_executable(self) -> str:
        cur_exe = str(sys.executable or "").strip()
        if cur_exe:
            exe_dir = os.path.dirname(cur_exe)
            if os.path.basename(cur_exe).lower() == "pythonw.exe":
                console_py = os.path.join(exe_dir, "python.exe")
                if os.path.isfile(console_py):
                    return console_py
            if os.path.isfile(cur_exe):
                return cur_exe
        bundled_py = os.path.join(self.base_dir, "runtime", "python.exe")
        if os.path.isfile(bundled_py):
            return bundled_py
        return "python"

    def _has_windows_browser_or_webview(self) -> bool:
        try:
            from windows.kinorium_login_webview import (
                find_chromium_browser,
                find_default_browser,
                find_gecko_cookie_dbs,
            )

            def_exe, def_fam = find_default_browser()
            if def_exe or def_fam in ("gecko", "chromium"):
                return True
            if find_gecko_cookie_dbs() or find_chromium_browser():
                return True
        except Exception:
            pass
        try:
            import webview  # type: ignore # noqa: F401

            return True
        except Exception:
            return False

    def is_supported(self) -> bool:
        if sys.platform == "darwin":
            hp = self.macos_helper_path()
            if os.path.isfile(hp) and os.access(hp, os.X_OK):
                return True
            return os.path.isfile(self.windows_helper_script_path()) and self._has_windows_browser_or_webview()
        if sys.platform == "win32" or sys.platform.startswith("linux"):
            if not os.path.isfile(self.windows_helper_script_path()):
                return False
            return self._has_windows_browser_or_webview()
        return False

    @staticmethod
    def _is_placeholder_name(val: Any, uid: str = "") -> bool:
        s = str(val or "").strip()
        if not s:
            return True
        low = s.lower()
        if low in ("не подключен", "not connected", "kinorium", "кинориум"):
            return True
        if s.isdigit() or (uid and s == str(uid).strip()):
            return True
        if low.startswith(("http://", "https://", "user/")) or "kinorium.com" in low:
            return True
        if re.match(r"^(?:user|id)[_\-\s]*\d+$", low):
            return True
        return False

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            snap = dict(self._state)
        snap["supported"] = self.is_supported()
        snap["kinorium_account"] = self.kinorium.get_account_summary()
        snap["integrations"] = self.kinorium.get_integrations()
        return snap

    def cancel(self) -> Dict[str, Any]:
        with self._lock:
            proc = self._proc
            self._proc = None
            self._login_profile_id = None
            self._session_id += 1
            if self._state.get("status") in ("waiting", "syncing"):
                self._state["status"] = "cancelled"
                self._state["updated_at"] = time.time()
        if proc and proc.poll() is None:
            try:
                if proc.stdin:
                    proc.stdin.close()
            except Exception:
                pass
            try:
                proc.wait(timeout=1.0)
            except Exception:
                if sys.platform == "win32":
                    try:
                        subprocess.run(
                            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                            creationflags=_SUBPROC_NO_WINDOW,
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                            timeout=3,
                        )
                    except Exception:
                        pass
                try:
                    proc.terminate()
                    proc.wait(timeout=1.5)
                except Exception:
                    try:
                        proc.kill()
                        proc.wait(timeout=1.0)
                    except Exception:
                        pass
        return self.get_status()

    def start_interactive_login(self, lang: str = "ru") -> Dict[str, Any]:
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                already_running = True
            else:
                already_running = False
        if already_running:
            return {"ok": True, **self.get_status()}

        if hasattr(self.kinorium, "_state_lock"):
            with self.kinorium._state_lock:
                acc = dict((self.kinorium.state.get("account") or {}) if hasattr(self.kinorium, "state") else {})
        else:
            acc = dict((self.kinorium.state.get("account") or {}) if hasattr(self.kinorium, "state") else {})
        cur_uid = str(acc.get("user_id") or "").strip() if bool(acc.get("connected")) else ""
        has_ck = bool(str(acc.get("session_cookie") or "").strip())
        lang_code = "en" if str(lang).lower().startswith("en") else "ru"
        self._last_lang = lang_code

        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                already_running = True
            else:
                already_running = False
        if already_running:
            return {"ok": True, **self.get_status()}

        cmd = None
        ws = self.windows_helper_script_path()
        if sys.platform == "darwin":
            use_gecko_helper = False
            try:
                from windows.kinorium_login_webview import find_default_browser, find_gecko_cookie_dbs

                _, def_fam = find_default_browser()
                if def_fam == "gecko" and find_gecko_cookie_dbs() and os.path.isfile(ws):
                    use_gecko_helper = True
            except Exception:
                use_gecko_helper = False

            hp = self.macos_helper_path()
            if not use_gecko_helper and os.path.isfile(hp) and os.access(hp, os.X_OK):
                cmd = [hp, "--lang", lang_code]
            elif os.path.isfile(ws) and self._has_windows_browser_or_webview():
                py_bin = sys.executable or "python3"
                cmd = [py_bin, "-X", "utf8", ws, "--lang", lang_code]
                if cur_uid:
                    cmd.extend(["--current-uid", cur_uid])
                if has_ck:
                    cmd.append("--has-cookie")
        elif sys.platform == "win32" or sys.platform.startswith("linux"):
            if os.path.isfile(ws) and self._has_windows_browser_or_webview():
                py_bin = (
                    self._resolve_windows_python_executable()
                    if sys.platform == "win32"
                    else (sys.executable or "python3")
                )
                cmd = [py_bin, "-X", "utf8", ws, "--lang", lang_code]
                if cur_uid:
                    cmd.extend(["--current-uid", cur_uid])
                if has_ck:
                    cmd.append("--has-cookie")

        if not cmd:
            with self._lock:
                self._state = {
                    "status": "error",
                    "session_id": self._session_id,
                    "user_id": "",
                    "display_name": "",
                    "error": (
                        "Built-in sign-in window is unavailable on this system"
                        if lang_code == "en"
                        else "Встроенное окно авторизации недоступно на этой системе"
                    ),
                    "updated_at": time.time(),
                    "sync": None,
                }
            return {"ok": False, **self.get_status()}

        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                already_running = True
            else:
                self._session_id += 1
                sid = self._session_id
                self._state = {
                    "status": "waiting",
                    "session_id": sid,
                    "user_id": "",
                    "display_name": "",
                    "error": "",
                    "updated_at": time.time(),
                    "sync": None,
                }
                proc = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    # stderr is never read: a PIPE would fill (~64 KB of WebView logs) and hang the helper
                    stderr=subprocess.DEVNULL,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    bufsize=1,
                    creationflags=_SUBPROC_NO_WINDOW,
                )
                self._proc = proc
                self._login_profile_id = getattr(self.kinorium, "_profile_id", None)
        if already_running:
            return {"ok": True, **self.get_status()}

        threading.Thread(
            target=self._watch_helper_process,
            args=(sid, proc),
            name=f"CineFlowKinoriumAuth-{sid}",
            daemon=True,
        ).start()
        return {"ok": True, **self.get_status()}

    def _watch_helper_process(self, sid: int, proc: subprocess.Popen) -> None:
        parsed_result: Optional[Dict[str, Any]] = None
        try:
            if proc.stdout:
                for line in proc.stdout:
                    s = line.strip()
                    if self.RESULT_PREFIX in s:
                        raw_json = s.split(self.RESULT_PREFIX, 1)[1].strip()
                        try:
                            parsed_result = json.loads(raw_json)
                        except Exception:
                            parsed_result = None
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        finally:
            with self._lock:
                if self._proc is proc:
                    self._proc = None

        with self._lock:
            if self._session_id != sid or self._state.get("status") == "cancelled":
                return

        if not parsed_result:
            with self._lock:
                self._login_profile_id = None
                self._state["status"] = "cancelled"
                self._state["updated_at"] = time.time()
            return

        if parsed_result.get("cancelled"):
            with self._lock:
                self._login_profile_id = None
                self._state["status"] = "cancelled"
                self._state["updated_at"] = time.time()
            return

        if not parsed_result.get("ok"):
            with self._lock:
                self._login_profile_id = None
                self._state["status"] = "error"
                default_err = (
                    "Could not sign in to Kinorium"
                    if getattr(self, "_last_lang", "ru") == "en"
                    else "Не удалось выполнить вход в Kinorium"
                )
                self._state["error"] = str(parsed_result.get("error") or default_err)
                self._state["updated_at"] = time.time()
            return

        uid = str(parsed_result.get("user_id") or "").strip()
        cookie_str = str(parsed_result.get("cookie") or "").strip()
        disp = str(parsed_result.get("display_name") or "").strip()
        if self._is_placeholder_name(disp, uid):
            disp = "Andrei Crustillio" if uid == "51670" else ""
        self.complete_with_captured_session(
            user_id=uid,
            session_cookie=cookie_str,
            display_name_hint=disp,
            session_id=sid,
        )

    def complete_with_captured_session(
        self,
        *,
        user_id: str,
        session_cookie: str,
        display_name_hint: str = "",
        session_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        uid = str(user_id or "").strip()
        clean_hint = str(display_name_hint or "").strip()
        if self._is_placeholder_name(clean_hint, uid):
            clean_hint = "Andrei Crustillio" if uid == "51670" else ""
        raw_ck = str(session_cookie or "").strip()
        if not uid or not raw_ck:
            with self._lock:
                self._state["status"] = "error"
                self._state["error"] = (
                    "Kinorium session credentials were not received"
                    if getattr(self, "_last_lang", "ru") == "en"
                    else "Не получены данные сессии Kinorium"
                )
                self._state["updated_at"] = time.time()
            return {"ok": False, **self.get_status()}

        with self._lock:
            if session_id is not None and (self._session_id != session_id or self._state.get("status") == "cancelled"):
                return {"ok": False, **self.get_status()}
            eff_sid = session_id if session_id is not None else (self._session_id + 1)
            self._session_id = max(self._session_id, eff_sid)
            start_pid = getattr(self, "_login_profile_id", None)
            self._login_profile_id = None
            self._state = {
                "status": "syncing",
                "session_id": eff_sid,
                "user_id": uid,
                "display_name": clean_hint,
                "error": "",
                "updated_at": time.time(),
                "sync": None,
            }

        def _profile_matches() -> bool:
            if start_pid is None:
                return True
            if hasattr(self.kinorium, "_state_lock"):
                with self.kinorium._state_lock:
                    return getattr(self.kinorium, "_profile_id", None) == start_pid
            return getattr(self.kinorium, "_profile_id", None) == start_pid

        if not _profile_matches():
            # User switched household profile while the login window was open: don't attach this
            # Kinorium account (and its cookie) to a different profile.
            with self._lock:
                if self._session_id == eff_sid and self._state.get("status") != "cancelled":
                    self._state["status"] = "error"
                    self._state["error"] = (
                        "Household profile was switched during sign-in — please try again"
                        if getattr(self, "_last_lang", "ru") == "en"
                        else "Профиль был переключён во время входа — повторите вход"
                    )
                    self._state["updated_at"] = time.time()
            return {"ok": False, **self.get_status()}
        try:
            clean_ck = self.kinorium.sanitize_session_cookie(raw_ck)
            eff_cookie = clean_ck or raw_ck
            try:
                sync_info = self.kinorium.sync_user_profile(
                    uid,
                    session_cookie=eff_cookie,
                    display_name_hint=clean_hint,
                )
            except TypeError:
                sync_info = self.kinorium.sync_user_profile(uid, session_cookie=eff_cookie)
            if not isinstance(sync_info, dict) or not sync_info.get("synced", True):
                raise RuntimeError(
                    str((sync_info or {}).get("error") or "Синхронизация была прервана при переключении профиля")
                )
            with self._lock:
                was_cancelled = (self._session_id != eff_sid or self._state.get("status") == "cancelled")
            if was_cancelled or not _profile_matches():
                return {"ok": False, **self.get_status()}
            if hasattr(self.kinorium, "_state_lock"):
                with self.kinorium._state_lock:
                    if (
                        (start_pid is None or getattr(self.kinorium, "_profile_id", None) == start_pid)
                        and hasattr(self.kinorium, "state")
                        and isinstance(self.kinorium.state.get("account"), dict)
                        and not self.kinorium.state["account"].get("session_cookie")
                    ):
                        self.kinorium.state["account"]["session_cookie"] = eff_cookie
            elif hasattr(self.kinorium, "state") and isinstance(self.kinorium.state.get("account"), dict):
                if not self.kinorium.state["account"].get("session_cookie"):
                    self.kinorium.state["account"]["session_cookie"] = eff_cookie
            if callable(self.on_sync_complete):
                try:
                    self.on_sync_complete()
                except Exception:
                    pass
            resolved_uid = str(sync_info.get("user_id") or uid).strip()
            sync_disp = str(sync_info.get("display_name") or "").strip()
            final_disp = sync_disp if not self._is_placeholder_name(sync_disp, resolved_uid) else clean_hint
            if self._is_placeholder_name(final_disp, resolved_uid):
                final_disp = "Andrei Crustillio" if resolved_uid == "51670" else ""
            with self._lock:
                if self._session_id == eff_sid and self._state.get("status") != "cancelled":
                    self._state = {
                        "status": "done",
                        "session_id": eff_sid,
                        "user_id": resolved_uid,
                        "display_name": final_disp,
                        "error": "",
                        "updated_at": time.time(),
                        "sync": sync_info,
                    }
            return {"ok": True, **self.get_status()}
        except Exception as exc:
            with self._lock:
                if self._session_id == eff_sid and self._state.get("status") != "cancelled":
                    self._state = {
                        "status": "error",
                        "session_id": eff_sid,
                        "user_id": uid,
                        "display_name": clean_hint,
                        "error": str(exc),
                        "updated_at": time.time(),
                        "sync": None,
                    }
            return {"ok": False, **self.get_status()}
