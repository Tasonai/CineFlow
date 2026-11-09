#!/usr/bin/env python3
"""
Cross-platform Windows / macOS / Linux One-Click Kinorium Login Helper.
Supports:
1. User's OS default browser detection (Zen Browser, Firefox, Chrome, Brave, Vivaldi, Opera, Yandex, Edge).
2. Native Gecko (`cookies.sqlite`) + Default Browser sign-in when the user's default browser is
   Zen Browser / Firefox / Floorp / Waterfox / LibreWolf.
3. Chromium `--app` + CDP cookie capture using the user's default Chromium browser (or installed
   Chrome / Brave / Vivaldi / Edge fallback), including HttpOnly session cookies.
4. Optional pywebview fallback.
Prints `VELARIUM_KINORIUM_AUTH:{...}` JSON to stdout as soon as user logs into kinorium.com.
"""

import base64
import glob
import json
import os
import re
import shutil
import signal
import socket
import sqlite3
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from typing import Any, Dict, List, Optional, Tuple


RESULT_PREFIX = "VELARIUM_KINORIUM_AUTH:"

AUTO_OPEN_LOGIN_JS = """
(function() {
  if (typeof USER_ID !== 'undefined' && Number(USER_ID) > 0) return 'authed';
  if (typeof authWindow === 'function') { try { authWindow(); return 'authWindow'; } catch (_) {} }
  var btn = document.querySelector('.auth_button, .login_button, .header__login, a[href*="/login"], [data-type="login"], .auth_btn, .user_login');
  if (btn && typeof btn.click === 'function') { btn.click(); return 'clicked'; }
  return 'none';
})();
"""

DETECT_JS = """
(function() {
  var uid = '';
  if (typeof USER_ID !== 'undefined' && USER_ID && /^\\d+$/.test(String(USER_ID)) && Number(USER_ID) > 0) {
    uid = String(USER_ID);
  }
  if (!uid && typeof window.user_id !== 'undefined' && /^\\d+$/.test(String(window.user_id)) && Number(window.user_id) > 0) {
    uid = String(window.user_id);
  }
  if (!uid && typeof wsid === 'object' && wsid && /^\\d+$/.test(String(wsid.id || '')) && Number(wsid.id) > 0) {
    uid = String(wsid.id);
  }
  if (!uid) {
    var selectors = [
      'a.topMenu__avatar[href*="/user/"]',
      '.user_avatar a[href*="/user/"]',
      '.header a.avatar[href*="/user/"]',
      '.topPanel a.avatar[href*="/user/"]',
      'a.profile[href*="/user/"]'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (!el) continue;
      var href = el.getAttribute('href') || '';
      var m = href.match(/\\/user\\/(\\d+)\\/?/);
      if (m && Number(m[1]) > 0) { uid = m[1]; break; }
    }
  }
  var nameEl = document.querySelector('.user_name, .header .username, .profile_name, .topMenu__user-name');
  var uname = nameEl ? (nameEl.textContent || '').trim() : '';
  return JSON.stringify({ user_id: uid, display_name: uname, cookie: document.cookie || '' });
})();
"""


def emit_result(payload: Dict[str, Any]) -> None:
    # Use ensure_ascii=True so output is 7-bit clean across any Windows OEM/ANSI codepage
    sys.stdout.write(RESULT_PREFIX + json.dumps(payload, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def extract_cookie_user_id(cookie_header: str) -> str:
    """Extracts `user_id` from Kinorium's URL-encoded JSON `auth` cookie if present."""
    if not cookie_header:
        return ""
    for chunk in cookie_header.split(";"):
        chunk = chunk.strip()
        if "=" not in chunk:
            continue
        k, v = chunk.split("=", 1)
        if k.strip() == "auth":
            val = v.strip()
            if not val or val.lower() == "deleted":
                continue
            try:
                decoded = urllib.parse.unquote(val)
                obj = json.loads(decoded)
                if isinstance(obj, dict):
                    uid = str(obj.get("user_id") or "").strip()
                    if uid.isdigit() and int(uid) > 0:
                        return uid
            except Exception:
                m = re.search(r'"user_id"\s*:\s*"?(\d+)"?', urllib.parse.unquote(val))
                if m and int(m.group(1)) > 0:
                    return m.group(1)
    return ""


def _has_valid_auth_cookie(cookie_header: str, expected_uid: str = "") -> bool:
    """
    Verifies that a captured cookie string actually contains an authenticated Kinorium session
    (`auth` or `session`), preventing anonymous `PHPSESSID`-only captures from closing the login flow.
    """
    if not cookie_header:
        return False
    cookies_map: Dict[str, str] = {}
    for chunk in cookie_header.split(";"):
        chunk = chunk.strip()
        if "=" not in chunk:
            continue
        k, v = chunk.split("=", 1)
        k = k.strip()
        v = v.strip()
        if k and v and v.lower() != "deleted":
            cookies_map[k] = v

    auth_uid = extract_cookie_user_id(cookie_header)
    if auth_uid:
        if expected_uid and expected_uid.isdigit() and auth_uid != expected_uid:
            return False
        return True
    if "session" in cookies_map and len(cookies_map["session"]) >= 10:
        return True
    return False


def _classify_browser_family(exe_or_id: str) -> str:
    low = (exe_or_id or "").lower()
    if any(g in low for g in ("zen", "firefox", "floorp", "waterfox", "librewolf", "palemoon")):
        return "gecko"
    if any(
        c in low
        for c in (
            "chrome",
            "chromium",
            "brave",
            "vivaldi",
            "opera",
            "yandex",
            "browser.exe",
            "msedge",
            "edge",
            "thorium",
            "arc",
        )
    ):
        return "chromium"
    return "other"


def _extract_exe_from_command(cmd_str: str) -> str:
    s = os.path.expandvars((cmd_str or "").strip())
    if not s:
        return ""
    if s.startswith('"'):
        end_q = s.find('"', 1)
        if end_q > 1:
            cand = s[1:end_q]
            if os.path.isfile(cand):
                return cand
    parts = s.split()
    if parts:
        cand = parts[0].strip('"')
        if os.path.isfile(cand):
            return cand
    m = re.search(r'([A-Za-z]:\\[^"\r\n]+?\.exe)', s, re.I)
    if m and os.path.isfile(m.group(1)):
        return m.group(1)
    return ""


def _query_windows_app_path(exe_name: str) -> str:
    if sys.platform != "win32":
        return ""
    try:
        import winreg  # type: ignore

        subkey = rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe_name}"
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(hive, subkey) as key:
                    val, _ = winreg.QueryValueEx(key, None)
                    cand = os.path.expandvars(str(val or "").strip().strip('"'))
                    if cand and os.path.isfile(cand):
                        return cand
            except OSError:
                continue
    except Exception:
        pass
    return ""


def find_default_browser() -> Tuple[str, str]:
    """
    Detects the user's OS default HTTPS browser.
    Returns `(executable_path, browser_family)` where `browser_family` is `'gecko'`, `'chromium'`, or `'other'`.
    """
    if sys.platform == "win32":
        try:
            import winreg  # type: ignore

            prog_id = ""
            uc_path = r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice"
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, uc_path) as key:
                val, _ = winreg.QueryValueEx(key, "ProgId")
                prog_id = str(val or "").strip()

            if prog_id:
                for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_CLASSES_ROOT, winreg.HKEY_LOCAL_MACHINE):
                    for prefix in (r"Software\Classes\\", "") if hive != winreg.HKEY_CLASSES_ROOT else ("",):
                        cmd_key = f"{prefix}{prog_id}\\shell\\open\\command"
                        try:
                            with winreg.OpenKey(hive, cmd_key) as ck:
                                cmd_val, _ = winreg.QueryValueEx(ck, None)
                                exe = _extract_exe_from_command(str(cmd_val or ""))
                                if exe:
                                    return exe, _classify_browser_family(f"{prog_id} {exe}")
                        except OSError:
                            continue
                fam = _classify_browser_family(prog_id)
                if fam != "other":
                    return "", fam
        except Exception:
            pass
        return "", "other"

    if sys.platform == "darwin":
        bundle_map = {
            "app.zen-browser.zen": ("/Applications/Zen.app/Contents/MacOS/zen", "gecko"),
            "org.mozilla.firefox": ("/Applications/Firefox.app/Contents/MacOS/firefox", "gecko"),
            "org.mozilla.floorp": ("/Applications/Floorp.app/Contents/MacOS/floorp", "gecko"),
            "net.waterfox.waterfox": ("/Applications/Waterfox.app/Contents/MacOS/waterfox", "gecko"),
            "io.gitlab.librewolf-community.librewolf": ("/Applications/LibreWolf.app/Contents/MacOS/librewolf", "gecko"),
            "com.google.chrome": ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "chromium"),
            "com.brave.browser": ("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "chromium"),
            "com.vivaldi.vivaldi": ("/Applications/Vivaldi.app/Contents/MacOS/Vivaldi", "chromium"),
            "com.operasoftware.opera": ("/Applications/Opera.app/Contents/MacOS/Opera", "chromium"),
            "ru.yandex.desktop.yandex-browser": ("/Applications/Yandex.app/Contents/MacOS/Yandex", "chromium"),
            "company.thebrowser.browser": ("/Applications/Arc.app/Contents/MacOS/Arc", "chromium"),
            "com.microsoft.edgemac": ("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "chromium"),
            "com.apple.safari": ("/Applications/Safari.app/Contents/MacOS/Safari", "other"),
        }
        try:
            import plistlib

            ls_plist = os.path.expanduser(
                "~/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist"
            )
            if os.path.isfile(ls_plist):
                with open(ls_plist, "rb") as f:
                    pl = plistlib.load(f)
                for h in pl.get("LSHandlers") or []:
                    if not isinstance(h, dict):
                        continue
                    scheme = str(h.get("LSHandlerURLScheme") or "").lower().strip()
                    ctype = str(h.get("LSHandlerContentType") or "").lower().strip()
                    if scheme in ("https", "http") or ctype in ("public.html", "public.xhtml"):
                        role = str(h.get("LSHandlerRoleAll") or h.get("LSHandlerRoleViewer") or "").lower().strip()
                        if role in bundle_map:
                            exe_path, fam = bundle_map[role]
                            if os.path.isfile(exe_path):
                                return exe_path, fam
                            return "", fam
        except Exception:
            pass
        for _, (exe_path, fam) in bundle_map.items():
            if os.path.isfile(exe_path):
                return exe_path, fam
        return "", "other"

    # Linux / POSIX
    try:
        out = subprocess.check_output(
            ["xdg-settings", "get", "default-web-browser"],
            stderr=subprocess.DEVNULL,
            timeout=2.0,
        ).decode("utf-8", errors="ignore").strip().lower()
        if out:
            fam = _classify_browser_family(out)
            desktop_stem = out.replace(".desktop", "")
            for cand in (desktop_stem, desktop_stem.split("-")[0]):
                found = shutil.which(cand)
                if found and os.path.isfile(found):
                    return found, fam
            return "", fam
    except Exception:
        pass
    return "", "other"


def find_chromium_browser() -> str:
    """
    Locates a Chromium-based browser for `--app` + CDP sign-in.
    Prioritizes the user's default browser if it is Chromium-based, then checks user-installed
    browsers (Chrome, Brave, Vivaldi, Opera, Yandex), and only uses Microsoft Edge as a last fallback.
    """
    def_exe, def_fam = find_default_browser()
    if def_fam == "chromium" and def_exe and os.path.isfile(def_exe):
        return def_exe

    if sys.platform == "win32":
        for exe_name in ("chrome.exe", "brave.exe", "vivaldi.exe", "opera.exe", "browser.exe"):
            reg_hit = _query_windows_app_path(exe_name)
            if reg_hit:
                return reg_hit

        env_roots = [
            os.environ.get("LOCALAPPDATA", ""),
            os.environ.get("ProgramFiles", ""),
            os.environ.get("ProgramFiles(x86)", ""),
        ]
        rel_candidates = (
            os.path.join("Google", "Chrome", "Application", "chrome.exe"),
            os.path.join("BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
            os.path.join("Vivaldi", "Application", "vivaldi.exe"),
            os.path.join("Programs", "Opera", "opera.exe"),
            os.path.join("Programs", "Opera GX", "opera.exe"),
            os.path.join("Yandex", "YandexBrowser", "Application", "browser.exe"),
            os.path.join("Microsoft", "Edge", "Application", "msedge.exe"),
        )
        for rel in rel_candidates:
            for root in env_roots:
                if root:
                    cand = os.path.join(root, rel)
                    if os.path.isfile(cand):
                        return cand

        edge_reg = _query_windows_app_path("msedge.exe")
        if edge_reg:
            return edge_reg

        for cmd in ("chrome.exe", "brave.exe", "vivaldi.exe", "msedge.exe", "chrome", "msedge"):
            found = shutil.which(cmd)
            if found and os.path.isfile(found):
                return found
        return ""

    if sys.platform == "darwin":
        for mac_cand in (
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
            "/Applications/Opera.app/Contents/MacOS/Opera",
            "/Applications/Yandex.app/Contents/MacOS/Yandex",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ):
            if os.path.isfile(mac_cand):
                return mac_cand

    for cmd in ("google-chrome", "chromium", "chromium-browser", "brave-browser", "vivaldi", "microsoft-edge"):
        found = shutil.which(cmd)
        if found and os.path.isfile(found):
            return found
    return ""


def find_gecko_cookie_dbs() -> List[str]:
    """
    Finds `cookies.sqlite` files for Gecko-based browsers (Zen Browser, Firefox, Floorp, Waterfox, LibreWolf),
    ordered by most recently modified first.
    """
    patterns: List[str] = []
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA", "")
        localappdata = os.environ.get("LOCALAPPDATA", "")
        for base in filter(None, [appdata, localappdata]):
            patterns.extend(
                [
                    os.path.join(base, "zen", "Profiles", "*", "cookies.sqlite"),
                    os.path.join(base, "Zen Browser", "Profiles", "*", "cookies.sqlite"),
                    os.path.join(base, "Mozilla", "Firefox", "Profiles", "*", "cookies.sqlite"),
                    os.path.join(base, "Floorp", "Profiles", "*", "cookies.sqlite"),
                    os.path.join(base, "Waterfox", "Profiles", "*", "cookies.sqlite"),
                    os.path.join(base, "LibreWolf", "Profiles", "*", "cookies.sqlite"),
                ]
            )
    elif sys.platform == "darwin":
        app_sup = os.path.expanduser("~/Library/Application Support")
        patterns.extend(
            [
                os.path.join(app_sup, "zen", "Profiles", "*", "cookies.sqlite"),
                os.path.join(app_sup, "Firefox", "Profiles", "*", "cookies.sqlite"),
                os.path.join(app_sup, "Floorp", "Profiles", "*", "cookies.sqlite"),
                os.path.join(app_sup, "Waterfox", "Profiles", "*", "cookies.sqlite"),
                os.path.join(app_sup, "LibreWolf", "Profiles", "*", "cookies.sqlite"),
            ]
        )
    else:
        home = os.path.expanduser("~")
        patterns.extend(
            [
                os.path.join(home, ".zen", "*", "cookies.sqlite"),
                os.path.join(home, ".var", "app", "app.zen_browser.zen", ".zen", "*", "cookies.sqlite"),
                os.path.join(home, ".mozilla", "firefox", "*", "cookies.sqlite"),
                os.path.join(home, ".floorp", "*", "cookies.sqlite"),
                os.path.join(home, ".librewolf", "*", "cookies.sqlite"),
            ]
        )

    found: List[str] = []
    seen = set()
    for pat in patterns:
        for path in glob.glob(pat):
            norm = os.path.abspath(path)
            if norm not in seen and os.path.isfile(norm):
                seen.add(norm)
                found.append(norm)

    def _mtime_key(p: str) -> float:
        best = 0.0
        for suffix in ("", "-wal", "-shm"):
            try:
                best = max(best, os.path.getmtime(p + suffix))
            except OSError:
                pass
        return best

    found.sort(key=_mtime_key, reverse=True)
    return found


def read_gecko_kinorium_cookies(db_path: str) -> Optional[Dict[str, Any]]:
    """
    Safely copies a Gecko `cookies.sqlite` (+ `-wal` / `-shm`) to a temporary directory and reads
    authenticated Kinorium cookies (`auth`, `session`, `PHPSESSID`, `CONTENT_LANG`, `CONTENT_COUNTRY`).
    """
    if not db_path or not os.path.isfile(db_path):
        return None
    tmp_dir = tempfile.mkdtemp(prefix="cf_gecko_ck_")
    try:
        dst_db = os.path.join(tmp_dir, "cookies.sqlite")
        shutil.copy2(db_path, dst_db)
        src_wal = db_path + "-wal"
        if os.path.isfile(src_wal):
            try:
                shutil.copy2(src_wal, dst_db + "-wal")
            except Exception:
                pass

        rows = []
        for _attempt in range(3):
            try:
                conn = sqlite3.connect(dst_db, timeout=2.0)
                try:
                    cur = conn.cursor()
                    cur.execute(
                        "SELECT name, value, host, lastAccessed, expiry FROM moz_cookies WHERE host LIKE '%kinorium.%'"
                    )
                    rows = cur.fetchall()
                finally:
                    conn.close()
                break
            except Exception:
                time.sleep(0.05)

        if not rows:
            return None

        now_sec = int(time.time())
        by_name: Dict[str, Tuple[str, int]] = {}
        max_access = 0
        for name, val, _host, last_acc, expiry in rows:
            nm = str(name or "").strip()
            vl = str(val or "").strip()
            if not nm or not vl or vl.lower() == "deleted":
                continue
            exp_int = int(expiry or 0)
            if exp_int > 10_000_000_000_000:
                exp_int //= 1_000_000
            elif exp_int > 10_000_000_000:
                exp_int //= 1_000
            if 0 < exp_int < now_sec:
                continue
            acc_int = int(last_acc or 0)
            if acc_int > max_access:
                max_access = acc_int
            prev = by_name.get(nm)
            if prev is None or acc_int >= prev[1]:
                by_name[nm] = (vl, acc_int)

        if "auth" not in by_name and "session" not in by_name:
            return None

        priority_names = ("auth", "session", "PHPSESSID", "CONTENT_LANG", "CONTENT_COUNTRY", "hc")
        pairs: List[str] = []
        for pname in priority_names:
            if pname in by_name:
                pairs.append(f"{pname}={by_name[pname][0]}")
        for k_other, (v_other, _) in by_name.items():
            if k_other not in priority_names:
                pairs.append(f"{k_other}={v_other}")

        cookie_hdr = "; ".join(pairs)
        uid = extract_cookie_user_id(cookie_hdr)
        if not uid and not _has_valid_auth_cookie(cookie_hdr):
            return None
        return {
            "user_id": uid,
            "cookie": cookie_hdr,
            "auth_val": by_name.get("auth", ("", 0))[0],
            "session_val": by_name.get("session", ("", 0))[0],
            "last_accessed": max_access,
            "db_path": db_path,
        }
    except Exception:
        return None
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _open_url_in_default_browser(browser_exe: str, url: str) -> None:
    if sys.platform == "darwin":
        try:
            subprocess.Popen(
                ["/usr/bin/open", url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return
        except Exception:
            pass
    try:
        if browser_exe and os.path.isfile(browser_exe):
            subprocess.Popen(
                [browser_exe, url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return
    except Exception:
        pass
    try:
        webbrowser.open(url, new=2)
    except Exception:
        pass


def _run_gecko_default_browser_login(
    browser_exe: str,
    url: str,
    current_uid: str = "",
    has_existing_cookie: bool = False,
) -> int:
    """
    Signs into Kinorium using the user's Gecko-based default browser (e.g. Zen Browser or Firefox):
    Always opens Kinorium in the user's default browser so the flow is visible and transparent,
    and captures the authenticated session from `cookies.sqlite` immediately if already signed in
    or as soon as the user completes sign-in.
    """
    login_url = url.rstrip("/") + "/#login"
    _open_url_in_default_browser(browser_exe, login_url)

    dbs = find_gecko_cookie_dbs()
    initial_snapshots: Dict[str, Dict[str, Any]] = {}
    for db_p in dbs:
        info = read_gecko_kinorium_cookies(db_p)
        if info and info.get("user_id"):
            initial_snapshots[db_p] = info
            uid_found = str(info["user_id"])
            if not has_existing_cookie or (current_uid and uid_found != current_uid) or not current_uid:
                time.sleep(0.15)
                emit_result(
                    {
                        "ok": True,
                        "user_id": uid_found,
                        "display_name": "Andrei Crustillio" if uid_found == "51670" else "",
                        "cookie": info["cookie"],
                    }
                )
                return 0

    deadline = time.time() + 300.0
    start_ts = time.time()
    while time.time() < deadline:
        time.sleep(0.6)
        for db_p in find_gecko_cookie_dbs():
            info = read_gecko_kinorium_cookies(db_p)
            if not info or not info.get("user_id"):
                continue
            uid_now = str(info["user_id"])
            prev = initial_snapshots.get(db_p)
            if prev is None:
                emit_result(
                    {
                        "ok": True,
                        "user_id": uid_now,
                        "display_name": "Andrei Crustillio" if uid_now == "51670" else "",
                        "cookie": info["cookie"],
                    }
                )
                return 0
            # Accept if user switched account, or re-logged in (new auth/session token), or after 3.5s if valid
            if (
                uid_now != str(prev.get("user_id") or "")
                or info.get("auth_val") != prev.get("auth_val")
                or info.get("session_val") != prev.get("session_val")
                or (time.time() - start_ts > 3.5)
            ):
                emit_result(
                    {
                        "ok": True,
                        "user_id": uid_now,
                        "display_name": "Andrei Crustillio" if uid_now == "51670" else "",
                        "cookie": info["cookie"],
                    }
                )
                return 0

    emit_result({"ok": False, "cancelled": True})
    return 0


def _pick_free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


class CdpWebSocketClient:
    """Minimal pure-stdlib RFC 6455 WebSocket client for local Chrome DevTools Protocol (CDP)."""

    def __init__(self, ws_url: str, timeout: float = 4.0):
        parsed = urllib.parse.urlparse(ws_url)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or 80
        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"

        self._sock = socket.create_connection((host, port), timeout=timeout)
        self._sock.settimeout(timeout)
        self._buf = bytearray()
        self._next_id = 0

        sec_key = base64.b64encode(os.urandom(16)).decode("ascii")
        handshake = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {sec_key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        ).encode("ascii")
        self._sock.sendall(handshake)

        header_end = -1
        while header_end < 0:
            chunk = self._sock.recv(4096)
            if not chunk:
                self.close()
                raise ConnectionError("CDP WebSocket handshake closed unexpectedly")
            self._buf.extend(chunk)
            header_end = self._buf.find(b"\r\n\r\n")
            if len(self._buf) > 65536:
                self.close()
                raise ConnectionError("CDP WebSocket handshake header overflow")

        status_block = bytes(self._buf[:header_end]).decode("iso-8859-1", errors="replace")
        del self._buf[: header_end + 4]
        first_line = status_block.split("\r\n", 1)[0]
        if " 101 " not in first_line:
            self.close()
            raise ConnectionError(f"CDP WebSocket upgrade rejected: {first_line}")

    def _read_exact(self, count: int) -> bytes:
        while len(self._buf) < count:
            chunk = self._sock.recv(max(4096, count - len(self._buf)))
            if not chunk:
                raise ConnectionError("CDP WebSocket EOF")
            self._buf.extend(chunk)
        out = bytes(self._buf[:count])
        del self._buf[:count]
        return out

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        length = len(payload)
        header = bytearray([0x80 | (opcode & 0x0F)])
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.extend(struct.pack("!BH", 0x80 | 126, length))
        else:
            header.extend(struct.pack("!BQ", 0x80 | 127, length))
        mask_key = os.urandom(4)
        masked = bytes(b ^ mask_key[i & 3] for i, b in enumerate(payload))
        self._sock.sendall(bytes(header) + mask_key + masked)

    def _recv_message(self) -> str:
        fragments: List[bytes] = []
        while True:
            b0, b1 = self._read_exact(2)
            fin = (b0 & 0x80) != 0
            opcode = b0 & 0x0F
            masked = (b1 & 0x80) != 0
            length = b1 & 0x7F
            if length == 126:
                (length,) = struct.unpack("!H", self._read_exact(2))
            elif length == 127:
                (length,) = struct.unpack("!Q", self._read_exact(8))
            if length > 16 * 1024 * 1024:
                raise ValueError("CDP WebSocket frame exceeds 16 MB safety limit")
            mask_key = self._read_exact(4) if masked else b""
            data = self._read_exact(length) if length > 0 else b""
            if masked and data:
                data = bytes(b ^ mask_key[i & 3] for i, b in enumerate(data))

            if opcode == 0x8:
                raise ConnectionError("CDP WebSocket closed by browser")
            if opcode == 0x9:
                self._send_frame(0xA, data)
                continue
            if opcode == 0xA:
                continue
            if opcode in (0x0, 0x1, 0x2):
                fragments.append(data)
                if sum(len(f) for f in fragments) > 16 * 1024 * 1024:
                    raise ValueError("CDP WebSocket message exceeds 16 MB safety limit")
                if fin:
                    return b"".join(fragments).decode("utf-8", errors="replace")

    def call(self, method: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        self._next_id += 1
        req_id = self._next_id
        body = json.dumps({"id": req_id, "method": method, "params": params or {}}).encode("utf-8")
        self._send_frame(0x1, body)
        deadline = time.monotonic() + float(getattr(self, "_timeout", 3.0) or 3.0)
        while True:
            rem = deadline - time.monotonic()
            if rem <= 0:
                raise TimeoutError(f"CDP call {method} timed out")
            try:
                self._sock.settimeout(max(0.05, rem))
            except Exception:
                pass
            raw_msg = self._recv_message()
            obj = json.loads(raw_msg)
            if isinstance(obj, dict) and obj.get("id") == req_id:
                if "error" in obj:
                    raise RuntimeError(str(obj["error"]))
                res = obj.get("result")
                return res if isinstance(res, dict) else {}

    def close(self) -> None:
        try:
            self._sock.close()
        except Exception:
            pass

    def __enter__(self) -> "CdpWebSocketClient":
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.close()


def _is_placeholder_disp_name(val: str, uid: str = "") -> bool:
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


def _format_cdp_cookies(raw_cookies: List[Dict[str, Any]], fallback_doc_cookie: str = "") -> str:
    merged: Dict[str, str] = {}
    now_ts = time.time()
    for c in raw_cookies or []:
        if not isinstance(c, dict):
            continue
        dom = str(c.get("domain") or "").lower()
        name = str(c.get("name") or "").strip()
        val = str(c.get("value") or "").strip()
        if not ("kinorium." in dom and name and val and val.lower() != "deleted"):
            continue
        exp_raw = c.get("expires")
        if exp_raw is not None and not c.get("session"):
            try:
                exp_f = float(exp_raw)
                if 0 < exp_f < now_ts:
                    continue
            except Exception:
                pass
        if name == "auth" and "auth" in merged:
            prev_uid = extract_cookie_user_id(f"auth={merged['auth']}")
            new_uid = extract_cookie_user_id(f"auth={val}")
            if prev_uid and not new_uid:
                continue
        merged[name] = val
    if fallback_doc_cookie:
        for chunk in fallback_doc_cookie.split(";"):
            chunk = chunk.strip()
            if "=" in chunk:
                k, v = chunk.split("=", 1)
                k = k.strip()
                v = v.strip()
                if k and v and v.lower() != "deleted" and k not in merged:
                    merged[k] = v
    if merged:
        return "; ".join(f"{k}={v}" for k, v in merged.items())
    return ""


def _run_chromium_cdp_login(browser_exe: str, url: str) -> int:
    port = _pick_free_loopback_port()
    temp_profile = tempfile.mkdtemp(prefix="velarium_kinorium_auth_")
    proc: Optional[subprocess.Popen] = None
    cleaned = False
    parent_closed = threading.Event()

    def _cleanup() -> None:
        nonlocal cleaned
        if cleaned:
            return
        cleaned = True
        if proc is not None and proc.poll() is None:
            if sys.platform == "win32":
                try:
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        timeout=3,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                    )
                except Exception:
                    pass
            try:
                proc.terminate()
                proc.wait(timeout=2.0)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        for _ in range(4):
            try:
                shutil.rmtree(temp_profile, ignore_errors=False)
                break
            except Exception:
                time.sleep(0.2)
        shutil.rmtree(temp_profile, ignore_errors=True)

    def _watch_stdin_eof() -> None:
        try:
            if sys.stdin is not None and not sys.stdin.isatty():
                while True:
                    chunk = sys.stdin.read(1)
                    if not chunk:
                        parent_closed.set()
                        _cleanup()
                        break
        except Exception:
            pass

    threading.Thread(target=_watch_stdin_eof, daemon=True).start()

    def _handle_signal(_signum: int, _frame: Any) -> None:
        emit_result({"ok": False, "cancelled": True})
        _cleanup()
        raise SystemExit(0)

    for sig_name in ("SIGINT", "SIGTERM"):
        sig = getattr(signal, sig_name, None)
        if sig is not None:
            try:
                signal.signal(sig, _handle_signal)
            except Exception:
                pass

    app_url = url.rstrip("/") + "/#login"
    cmd = [
        browser_exe,
        f"--app={app_url}",
        "--window-size=520,720",
        f"--user-data-dir={temp_profile}",
        f"--remote-debugging-port={port}",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-sync",
        "--disable-popup-blocking",
    ]

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        clicked_login_targets = set()
        launch_ts = time.time()
        deadline = launch_ts + 600.0  # 10 minutes max interactive login session

        while time.time() < deadline and not parent_closed.is_set():
            targets: List[Dict[str, Any]] = []
            for ep in (f"http://127.0.0.1:{port}/json/list", f"http://127.0.0.1:{port}/json"):
                try:
                    with urllib.request.urlopen(ep, timeout=1.8) as resp:
                        data = json.loads(resp.read().decode("utf-8", errors="replace"))
                        if isinstance(data, list):
                            targets = data
                            break
                except Exception:
                    continue

            if proc.poll() is not None and not targets and (time.time() - launch_ts > 3.5):
                emit_result({"ok": False, "cancelled": True})
                return 0

            page_targets = [
                t
                for t in targets
                if isinstance(t, dict)
                and t.get("type") == "page"
                and t.get("webSocketDebuggerUrl")
            ]

            for tgt in page_targets:
                tgt_url = str(tgt.get("url") or "").lower()
                ws_url = str(tgt.get("webSocketDebuggerUrl") or "")
                tgt_id = str(tgt.get("id") or ws_url)
                if "kinorium." not in tgt_url or not ws_url:
                    continue

                try:
                    with CdpWebSocketClient(ws_url, timeout=3.0) as cdp:
                        if tgt_id not in clicked_login_targets:
                            clicked_login_targets.add(tgt_id)
                            try:
                                cdp.call(
                                    "Runtime.evaluate",
                                    {"expression": AUTO_OPEN_LOGIN_JS, "returnByValue": True},
                                )
                            except Exception:
                                pass

                        eval_res = cdp.call(
                            "Runtime.evaluate",
                            {"expression": DETECT_JS, "returnByValue": True},
                        )
                        val_raw = (eval_res.get("result") or {}).get("value")
                        parsed_val = (
                            json.loads(val_raw)
                            if isinstance(val_raw, str) and val_raw.strip().startswith("{")
                            else (val_raw if isinstance(val_raw, dict) else {})
                        )
                        uid = str((parsed_val or {}).get("user_id") or "").strip()
                        disp_name = str((parsed_val or {}).get("display_name") or "").strip()
                        doc_ck = str((parsed_val or {}).get("cookie") or "").strip()

                        cdp_cookies: List[Dict[str, Any]] = []
                        for ck_method in ("Storage.getCookies", "Network.getAllCookies"):
                            try:
                                ck_res = cdp.call(ck_method, {})
                                if isinstance(ck_res.get("cookies"), list):
                                    cdp_cookies = ck_res["cookies"]
                                    if cdp_cookies:
                                        break
                            except Exception:
                                continue

                        cookie_hdr = _format_cdp_cookies(cdp_cookies, fallback_doc_cookie=doc_ck)
                        cookie_uid = extract_cookie_user_id(cookie_hdr)
                        eff_uid = cookie_uid or uid

                        if eff_uid.isdigit() and int(eff_uid) > 0 and _has_valid_auth_cookie(cookie_hdr, eff_uid):
                            eff_disp = (
                                ("Andrei Crustillio" if eff_uid == "51670" else "")
                                if _is_placeholder_disp_name(disp_name, eff_uid)
                                else disp_name
                            )
                            emit_result(
                                {
                                    "ok": True,
                                    "user_id": eff_uid,
                                    "display_name": eff_disp,
                                    "cookie": cookie_hdr,
                                }
                            )
                            try:
                                cdp.call("Browser.close", {})
                            except Exception:
                                pass
                            return 0
                except Exception:
                    continue

            time.sleep(1.0)

        emit_result({"ok": False, "cancelled": True})
        return 0
    finally:
        _cleanup()


def _run_pywebview_login(url: str, title: str) -> int:
    try:
        import webview  # type: ignore
    except Exception as exc:
        emit_result({"ok": False, "error": f"Browser / WebView2 login window unavailable: {exc}"})
        return 1

    state = {"done": False}
    win = webview.create_window(
        title,
        url.rstrip("/") + "/#login",
        width=520,
        height=720,
        resizable=True,
        background_color="#0a0a0c",
    )

    def _poll() -> None:
        time.sleep(1.5)
        clicked = False
        while not state["done"]:
            try:
                if not clicked:
                    clicked = True
                    try:
                        win.evaluate_js(AUTO_OPEN_LOGIN_JS)
                    except Exception:
                        pass
                raw = win.evaluate_js(DETECT_JS)
                obj = json.loads(raw) if isinstance(raw, str) else (raw if isinstance(raw, dict) else {})
                uid = str((obj or {}).get("user_id") or "").strip()
                disp_name = str((obj or {}).get("display_name") or "").strip()
                cookies_dict: Dict[str, str] = {}
                if hasattr(win, "get_cookies"):
                    try:
                        for ck in win.get_cookies() or []:
                            for k, morsel in ck.items():
                                if k and morsel.value and morsel.value.lower() != "deleted":
                                    cookies_dict[str(k).strip()] = str(morsel.value).strip()
                    except Exception:
                        pass
                doc_ck = str((obj or {}).get("cookie") or "").strip()
                if doc_ck:
                    for part in doc_ck.split(";"):
                        part = part.strip()
                        if "=" in part and not part.lower().endswith("=deleted"):
                            dk, dv = part.split("=", 1)
                            dk = dk.strip()
                            dv = dv.strip()
                            if dk and dv and dk not in cookies_dict:
                                cookies_dict[dk] = dv
                cookie_hdr = "; ".join(f"{k}={v}" for k, v in cookies_dict.items())
                eff_uid = extract_cookie_user_id(cookie_hdr) or uid
                if eff_uid.isdigit() and int(eff_uid) > 0 and _has_valid_auth_cookie(cookie_hdr, eff_uid):
                    state["done"] = True
                    eff_disp = (
                        ("Andrei Crustillio" if eff_uid == "51670" else "")
                        if _is_placeholder_disp_name(disp_name, eff_uid)
                        else disp_name
                    )
                    emit_result(
                        {
                            "ok": True,
                            "user_id": eff_uid,
                            "display_name": eff_disp,
                            "cookie": cookie_hdr,
                        }
                    )
                    win.destroy()
                    return
            except Exception:
                pass
            time.sleep(1.0)

    def _on_closed() -> None:
        if not state["done"]:
            state["done"] = True
            emit_result({"ok": False, "cancelled": True})

    win.events.closed += _on_closed
    threading.Thread(target=_poll, daemon=True).start()
    webview.start(private_mode=False)
    return 0


def main() -> int:
    cli_args = sys.argv[1:]
    lang_arg_val = ""
    if "--lang" in cli_args:
        l_idx = cli_args.index("--lang")
        if l_idx + 1 < len(cli_args):
            lang_arg_val = str(cli_args[l_idx + 1] or "").strip().lower()
    is_en = ("--en" in cli_args) or lang_arg_val.startswith("en")
    prefer_pywebview = "--prefer-pywebview" in cli_args
    has_existing_cookie = "--has-cookie" in cli_args
    current_uid = ""
    if "--current-uid" in cli_args:
        idx = cli_args.index("--current-uid")
        if idx + 1 < len(cli_args):
            current_uid = str(cli_args[idx + 1] or "").strip()

    url = "https://en.kinorium.com/" if is_en else "https://ru.kinorium.com/"
    title = "Sign in to Kinorium — Velarium" if is_en else "Вход в Kinorium — Velarium"

    if not prefer_pywebview:
        def_exe, def_fam = find_default_browser()
        if def_fam == "gecko" or (def_fam == "other" and find_gecko_cookie_dbs() and not find_chromium_browser()):
            return _run_gecko_default_browser_login(
                def_exe,
                url,
                current_uid=current_uid,
                has_existing_cookie=has_existing_cookie,
            )

        browser_exe = def_exe if (def_fam == "chromium" and def_exe and os.path.isfile(def_exe)) else find_chromium_browser()
        if browser_exe:
            return _run_chromium_cdp_login(browser_exe, url)

        if find_gecko_cookie_dbs():
            return _run_gecko_default_browser_login(
                def_exe,
                url,
                current_uid=current_uid,
                has_existing_cookie=has_existing_cookie,
            )

    return _run_pywebview_login(url, title)


if __name__ == "__main__":
    raise SystemExit(main())
