"""Cross-platform system autostart management for Velarium.

Supports:
- macOS LaunchAgent (~/Library/LaunchAgents/app.velarium.cinema.plist)
- Windows Registry Run key (HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run)
"""

from __future__ import annotations

import os
import subprocess
import sys
from typing import Any, Dict, Optional

LAUNCH_AGENT_LABEL = "app.velarium.cinema"
LEGACY_LAUNCH_AGENT_LABEL = "app.cineflow.cinema"
WINDOWS_RUN_REG_PATH = r"Software\Microsoft\Windows\CurrentVersion\Run"
WINDOWS_RUN_VALUE_NAME = "Velarium"
LEGACY_WINDOWS_RUN_VALUE_NAME = "CineFlow"

_DEFAULT_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DEFAULT_DATA_DIR = os.path.join(_DEFAULT_BASE_DIR, "data")


def _launch_agent_plist_path() -> str:
    return os.path.expanduser(f"~/Library/LaunchAgents/{LAUNCH_AGENT_LABEL}.plist")


def _legacy_launch_agent_plist_path() -> str:
    return os.path.expanduser(f"~/Library/LaunchAgents/{LEGACY_LAUNCH_AGENT_LABEL}.plist")


def _build_windows_autostart_command(
    base_dir: Optional[str] = None, py_exe: Optional[str] = None
) -> str:
    b_dir = base_dir or _DEFAULT_BASE_DIR
    for exe_name in ("Velarium.exe", "CineFlow.exe"):
        launcher_exe = os.path.join(b_dir, exe_name)
        if os.path.isfile(launcher_exe):
            return f'"{launcher_exe}" --background'
    runtime_pyw = os.path.join(b_dir, "runtime", "pythonw.exe")
    script_path = os.path.join(b_dir, "server.py")
    if os.path.isfile(runtime_pyw):
        return f'"{runtime_pyw}" "{script_path}" --launchd'
    eff_py = py_exe or sys.executable or "pythonw.exe"
    if eff_py.lower().endswith("python.exe"):
        cand_pyw = eff_py[:-10] + "pythonw.exe"
        if os.path.isfile(cand_pyw):
            eff_py = cand_pyw
    return f'"{eff_py}" "{script_path}" --launchd'


def is_macos_autostart_enabled() -> bool:
    if sys.platform != "darwin":
        return False
    return os.path.isfile(_launch_agent_plist_path()) or os.path.isfile(_legacy_launch_agent_plist_path())


def is_windows_autostart_enabled() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import winreg  # type: ignore

        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, WINDOWS_RUN_REG_PATH, 0, winreg.KEY_READ
        ) as key:
            for val_name in (WINDOWS_RUN_VALUE_NAME, LEGACY_WINDOWS_RUN_VALUE_NAME):
                try:
                    val, _ = winreg.QueryValueEx(key, val_name)
                    if bool(str(val or "").strip()):
                        return True
                except FileNotFoundError:
                    continue
            return False
    except Exception:
        return False


def is_system_autostart_supported(platform_name: Optional[str] = None) -> bool:
    plat = platform_name or sys.platform
    return plat in ("darwin", "win32")


def is_system_autostart_enabled() -> bool:
    if sys.platform == "darwin":
        return is_macos_autostart_enabled()
    if sys.platform == "win32":
        return is_windows_autostart_enabled()
    return False


def set_macos_autostart(
    enabled: bool,
    base_dir: Optional[str] = None,
    data_dir: Optional[str] = None,
    script_path: Optional[str] = None,
) -> Dict[str, Any]:
    if sys.platform != "darwin":
        return {"ok": False, "error": "macOS LaunchAgent supported on darwin only"}
    plist_path = _launch_agent_plist_path()
    legacy_plist_path = _legacy_launch_agent_plist_path()
    if enabled:
        b_dir = base_dir or _DEFAULT_BASE_DIR
        d_dir = data_dir or _DEFAULT_DATA_DIR
        s_path = script_path or os.path.join(b_dir, "server.py")
        os.makedirs(os.path.dirname(plist_path), exist_ok=True)
        os.makedirs(d_dir, exist_ok=True)
        py_bin = sys.executable or "/usr/bin/python3"
        log_path = os.path.join(d_dir, "velarium-launchd.log")
        plist_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{py_bin}</string>
    <string>{s_path}</string>
    <string>--launchd</string>
  </array>
  <key>WorkingDirectory</key>
  <string>{b_dir}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>{log_path}</string>
  <key>StandardErrorPath</key>
  <string>{log_path}</string>
</dict>
</plist>
"""
        with open(plist_path, "w", encoding="utf-8") as f:
            f.write(plist_xml)
        if os.path.isfile(legacy_plist_path):
            try:
                os.remove(legacy_plist_path)
            except OSError:
                pass
    else:
        for p in (plist_path, legacy_plist_path):
            if os.path.isfile(p):
                try:
                    subprocess.run(
                        ["launchctl", "unload", p],
                        capture_output=True,
                        timeout=3.0,
                    )
                except Exception:
                    pass
                try:
                    os.remove(p)
                except OSError:
                    pass
    return {"ok": True, "autostart_enabled": is_macos_autostart_enabled()}


def set_windows_autostart(
    enabled: bool, base_dir: Optional[str] = None
) -> Dict[str, Any]:
    if sys.platform != "win32":
        return {"ok": False, "error": "Windows Registry autostart supported on win32 only"}
    try:
        import winreg  # type: ignore

        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, WINDOWS_RUN_REG_PATH) as key:
            if enabled:
                cmd_val = _build_windows_autostart_command(base_dir=base_dir)
                winreg.SetValueEx(key, WINDOWS_RUN_VALUE_NAME, 0, winreg.REG_SZ, cmd_val)
                try:
                    winreg.DeleteValue(key, LEGACY_WINDOWS_RUN_VALUE_NAME)
                except FileNotFoundError:
                    pass
            else:
                for val_name in (WINDOWS_RUN_VALUE_NAME, LEGACY_WINDOWS_RUN_VALUE_NAME):
                    try:
                        winreg.DeleteValue(key, val_name)
                    except FileNotFoundError:
                        pass
        return {"ok": True, "autostart_enabled": is_windows_autostart_enabled()}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def set_system_autostart(
    enabled: bool,
    base_dir: Optional[str] = None,
    data_dir: Optional[str] = None,
    script_path: Optional[str] = None,
) -> Dict[str, Any]:
    if sys.platform == "darwin":
        return set_macos_autostart(
            enabled, base_dir=base_dir, data_dir=data_dir, script_path=script_path
        )
    if sys.platform == "win32":
        return set_windows_autostart(enabled, base_dir=base_dir)
    return {"ok": False, "error": "Autostart is supported on macOS and Windows"}
