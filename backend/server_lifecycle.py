"""
Velarium Server Lifecycle & Desktop Automation
Encapsulates threading HTTP server, macOS AppleScript UI automation,
background daemons (LAN IP watchdog, watching sync), stale port detection,
and graceful signal termination handlers.
"""

import json
import os
import signal
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from typing import Any, Callable, Dict, List, Optional, Sequence


class CinemaThreadingHTTPServer(ThreadingHTTPServer):
    """
    Multi-threaded HTTP server with socket reuse, thread daemonization,
    and bound host/port caching.
    """
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 128
    timeout = 10.0

    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = str(host)
        self.server_port = int(port)


def trigger_macos_browser_fullscreen_key(is_running_fn: Optional[Callable[[], bool]] = None) -> bool:
    """
    Uses macOS AppleScript via System Events to bring the active or known browser process
    to the foreground and simulate the native fullscreen shortcut (key code 3).
    """
    if sys.platform != "darwin":
        return False
    if is_running_fn is not None and not is_running_fn():
        return False

    script = (
        'tell application "System Events"\n'
        '  set browserList to {"zen", "Zen", "Zen Browser", "Firefox", "Safari", "Google Chrome", "Arc", "Brave Browser", "Microsoft Edge", "Opera", "Vivaldi", "Orion", "Velarium", "WebKit"}\n'
        '  set frontApp to name of first application process whose frontmost is true\n'
        '  if frontApp is not in browserList then\n'
        '    repeat with bName in browserList\n'
        '      if exists application process (contents of bName) then\n'
        '        set frontmost of application process (contents of bName) to true\n'
        '        delay 0.05\n'
        '        set frontApp to (contents of bName)\n'
        '        exit repeat\n'
        '      end if\n'
        '    end repeat\n'
        '  end if\n'
        '  if frontApp is in browserList then\n'
        '    key code 3\n'
        '    return "ok"\n'
        '  end if\n'
        '  return "skip"\n'
        'end tell'
    )
    try:
        out = subprocess.check_output(["osascript", "-e", script], text=True, timeout=1.5).strip()
        return out == "ok"
    except Exception:
        return False


def trigger_macos_browser_pip_key(engine: str = "", is_running_fn: Optional[Callable[[], bool]] = None) -> bool:
    """
    Uses macOS AppleScript via System Events to toggle Picture-in-Picture mode in supported browsers.
    For Gecko (Firefox, Zen), uses key code 30 with Cmd+Option+Shift.
    For Chromium/Safari, uses key code 34.
    """
    if sys.platform != "darwin":
        return False
    if is_running_fn is not None and not is_running_fn():
        return False

    gecko_first = engine == "gecko"
    browser_order = (
        '{"zen", "Zen", "Zen Browser", "Firefox", "Safari", "Google Chrome", "Arc", "Brave Browser", "Microsoft Edge", "Opera", "Vivaldi", "Orion", "Velarium", "WebKit"}'
        if gecko_first
        else '{"Safari", "Google Chrome", "Arc", "Brave Browser", "Microsoft Edge", "Opera", "Vivaldi", "Orion", "Velarium", "WebKit", "zen", "Zen", "Zen Browser", "Firefox"}'
    )
    script = (
        'tell application "System Events"\n'
        f'  set browserList to {browser_order}\n'
        '  set geckoList to {"zen", "Zen", "Zen Browser", "Firefox"}\n'
        '  set frontApp to name of first application process whose frontmost is true\n'
        '  if frontApp is not in browserList then\n'
        '    repeat with bName in browserList\n'
        '      if exists application process (contents of bName) then\n'
        '        set frontmost of application process (contents of bName) to true\n'
        '        delay 0.05\n'
        '        set frontApp to (contents of bName)\n'
        '        exit repeat\n'
        '      end if\n'
        '    end repeat\n'
        '  end if\n'
        '  if frontApp is in geckoList then\n'
        '    key code 30 using {command down, option down, shift down}\n'
        '    return "ok_gecko"\n'
        '  else if frontApp is in browserList then\n'
        '    key code 34\n'
        '    return "ok_std"\n'
        '  end if\n'
        '  return "skip"\n'
        'end tell'
    )
    try:
        out = subprocess.check_output(["osascript", "-e", script], text=True, timeout=1.5).strip()
        return out.startswith("ok")
    except Exception:
        return False


def start_lan_ip_watchdog_daemon(
    server_runtime: Dict[str, Any],
    app_prefs: Dict[str, Any],
    detect_lan_fn: Callable[[], str],
    sync_lan_fn: Callable[[bool], None],
    interval_sec: float = 20.0,
) -> threading.Thread:
    """
    Spawns background watchdog daemon monitoring local IPv4 changes.
    When a network change (e.g. Wi-Fi reconnect) occurs while LAN mode is enabled,
    dynamically re-syncs the LAN listener.
    """
    def _lan_watchdog():
        while True:
            time.sleep(interval_sec)
            try:
                if not server_runtime.get("running") or not app_prefs.get("lan_access"):
                    continue
                cur_ip = detect_lan_fn()
                if cur_ip and cur_ip != server_runtime.get("lan_bound_ip"):
                    sync_lan_fn(True)
            except Exception:
                pass

    t = threading.Thread(target=_lan_watchdog, name="VelariumLanWatchdog", daemon=True)
    t.start()
    return t


def start_background_watching_sync_daemon(
    kinorium_service: Any,
    aggregator: Any,
    rezka_client: Any,
    last_stream_activity_getter: Callable[[], float],
    last_bg_watching_sync: Dict[str, Any],
    safe_int_fn: Optional[Callable[[Any, int], int]] = None,
    initial_delay_sec: float = 45.0,
    check_interval_sec: float = 7200.0,
) -> threading.Thread:
    """
    Spawns background watching sync daemon reconciling local Kinorium statuses and series episodes
    with remote metadata caches during playback idle periods.
    """
    _to_int = safe_int_fn or (lambda val, default=0: int(val) if val and str(val).isdigit() else default)

    def _worker():
        time.sleep(initial_delay_sec)
        while True:
            while time.time() - last_stream_activity_getter() < 25.0:
                time.sleep(10.0)
            try:
                if kinorium_service.is_service_enabled("kinorium"):
                    if not kinorium_service.is_ip_cooldown_active():
                        kinorium_service.reconcile_local_statuses_to_remote()
                        kinorium_service.reconcile_all_local_episodes(pull_watching_limit=0)
            except Exception:
                pass
            while time.time() - last_stream_activity_getter() < 25.0:
                time.sleep(10.0)
            try:
                if kinorium_service.is_service_enabled("hdrezka") and kinorium_service.is_service_enabled("kinorium"):
                    start_prof_bg = str(getattr(kinorium_service, "_profile_id", "main") or "main")
                    all_watching = aggregator._enrich_from_curated(
                        kinorium_service.get_section_catalog_items(
                            section="watching",
                            media_type_filter="series",
                            query="",
                            include_caught_up=True,
                        )
                    )
                    now_ts = time.time()
                    ttl_sec = 10800.0  # 3 hours
                    stale_items = []
                    for it in all_watching:
                        ks = it.get("kinorium") or {}
                        if ks.get("not_watching"):
                            continue
                        cached_m = kinorium_service.get_series_live_meta(
                            item_id=str(it.get("id") or ""),
                            title=str(it.get("title") or ""),
                            orig_title=str(it.get("orig_title") or ""),
                            kid=ks.get("kinorium_id"),
                            year=_to_int(it.get("year"), 0),
                            media_type="series",
                        )
                        if not cached_m or (now_ts - float(cached_m.get("updated_at") or 0.0)) >= ttl_sec:
                            stale_items.append(it)
                    if stale_items:
                        fresh = rezka_client.check_series_latest_episodes(stale_items[:6], batch_limit=6)
                        if fresh and str(getattr(kinorium_service, "_profile_id", "main") or "main") == start_prof_bg:
                            kinorium_service.save_series_live_meta(fresh)
                            aggregator.invalidate_catalog_cache()
                        last_bg_watching_sync["ts"] = time.time()
                        last_bg_watching_sync["checked"] = len(fresh or [])
            except Exception:
                pass
            time.sleep(check_interval_sec)

    t = threading.Thread(target=_worker, name="VelariumWatchingSync", daemon=True)
    t.start()
    return t


def is_port_already_serving_velarium(port: int, app_version: str = "") -> bool:
    """
    Checks if a local HTTP port is already actively serving Velarium with the matching version.
    Used by --launchd, desktop webview, and startup scripts to prevent duplicate instances.
    """
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/system/status", method="GET")
        with opener.open(req, timeout=0.8) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                matches_app = isinstance(data, dict) and data.get("app") in ("velarium", "cineflow")
                if not matches_app:
                    return False
                if not app_version:
                    return True
                return str(data.get("version") or "") == str(app_version)
    except Exception:
        pass
    return False


def stop_stale_velarium_server_on_port(port: int, app_version: str = "") -> None:
    """
    Terminates any stale Velarium server process occupying the designated port from an older version.
    """
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/system/status", method="GET")
        with opener.open(req, timeout=0.8) as resp:
            if resp.status != 200:
                return
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
            if not isinstance(data, dict) or data.get("app") not in ("velarium", "cineflow"):
                return
            if app_version and str(data.get("version") or "") == str(app_version) and data.get("app") == "velarium":
                return
    except Exception:
        return

    try:
        stop_req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/system/shutdown",
            data=b"{}",
            headers={
                "Content-Type": "application/json",
                "Origin": f"http://127.0.0.1:{port}",
                "X-Velarium-Local-Stop": "velarium-installer-stop",
            },
            method="POST",
        )
        with opener.open(stop_req, timeout=0.8):
            pass
        time.sleep(0.35)
    except Exception:
        pass

    if sys.platform == "darwin":
        try:
            out = subprocess.check_output(
                ["/usr/sbin/lsof", "-ti", f"tcp:{port}", "-sTCP:LISTEN"],
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=2.0,
            )
            for pid_s in out.splitlines():
                if pid_s.strip().isdigit() and int(pid_s.strip()) != os.getpid():
                    os.kill(int(pid_s.strip()), 15)
            time.sleep(0.45)
        except Exception:
            pass
    elif sys.platform == "win32":
        try:
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            out = subprocess.check_output(
                ["netstat", "-ano", "-p", "tcp"],
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=2.5,
                creationflags=creationflags,
            )
            port_suffix = f":{port}"
            killed_any = False
            for ln in out.splitlines():
                parts = ln.split()
                if len(parts) >= 5 and parts[0].upper() == "TCP" and parts[3].upper() == "LISTENING":
                    if parts[1].endswith(port_suffix) and parts[4].isdigit():
                        pid_val = int(parts[4])
                        if pid_val > 0 and pid_val != os.getpid():
                            subprocess.run(
                                ["taskkill", "/F", "/PID", str(pid_val)],
                                stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL,
                                timeout=2.0,
                                creationflags=creationflags,
                            )
                            killed_any = True
            if killed_any:
                time.sleep(0.35)
        except Exception:
            pass


def install_graceful_termination_handlers() -> None:
    """
    Converts SIGTERM, SIGHUP, and SIGBREAK signals into SystemExit
    so that atexit and finally cleanup blocks (TorrServer, ffmpeg remuxers, downloads)
    are guaranteed to execute.
    """
    if threading.current_thread() is not threading.main_thread():
        return

    def _graceful_exit(_signum, _frame):
        raise SystemExit(0)

    for sig_name in ("SIGTERM", "SIGHUP", "SIGBREAK"):
        sig = getattr(signal, sig_name, None)
        if sig is None:
            continue
        try:
            signal.signal(sig, _graceful_exit)
        except (ValueError, OSError):
            pass


def run_velarium_server(
    port: int = 8765,
    server_runtime: Optional[Dict[str, Any]] = None,
    app_prefs: Optional[Dict[str, Any]] = None,
    handler_class: Optional[type] = None,
    app_version: str = "",
    sync_lan_fn: Optional[Callable[[bool], None]] = None,
    ensure_torrserver_fn: Optional[Callable[[], Any]] = None,
    start_bg_watching_fn: Optional[Callable[[], Any]] = None,
    start_lan_watchdog_fn: Optional[Callable[[], Any]] = None,
    detect_lan_fn: Optional[Callable[[], Optional[str]]] = None,
    terminate_remux_fn: Optional[Callable[[], Any]] = None,
    cleanup_callbacks: Optional[Sequence[Callable[[], Any]]] = None,
) -> None:
    """
    Main orchestration loop for running the Velarium HTTP server:
    cleans up stale instances, binds socket, launches background daemons,
    prints startup banner, registers signals, serves HTTP, and guarantees
    resource cleanup on shutdown.
    """
    runtime = server_runtime if server_runtime is not None else {}
    prefs = app_prefs if app_prefs is not None else {}

    stop_stale_velarium_server_on_port(port, app_version=app_version)
    runtime["port"] = port
    runtime["running"] = True

    server = CinemaThreadingHTTPServer(("127.0.0.1", port), handler_class)
    lock = runtime.get("lock")
    if lock is not None:
        with lock:
            runtime["server"] = server
    else:
        runtime["server"] = server

    if prefs.get("lan_access") and sync_lan_fn is not None:
        sync_lan_fn(True)

    if ensure_torrserver_fn is not None:
        threading.Thread(
            target=ensure_torrserver_fn,
            name="VelariumTorrServerBoot",
            daemon=True,
        ).start()

    if start_bg_watching_fn is not None:
        start_bg_watching_fn()

    if start_lan_watchdog_fn is not None:
        start_lan_watchdog_fn()

    lan_ip = detect_lan_fn() if detect_lan_fn is not None else None
    print("============================================================")
    print("Velarium Unified Cinema (Apple TV Edition • Poland PL)")
    print(f"Local Cinema Server running at: http://127.0.0.1:{port}")
    if prefs.get("lan_access") and lan_ip:
        print(f"Home Wi-Fi / LAN URL:           http://{lan_ip}:{port}")
    print("============================================================")

    install_graceful_termination_handlers()
    try:
        server.serve_forever(poll_interval=0.2)
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        runtime["running"] = False
        if sync_lan_fn is not None:
            sync_lan_fn(False)
        try:
            server.server_close()
        except Exception:
            pass
        if terminate_remux_fn is not None:
            terminate_remux_fn()
        if cleanup_callbacks:
            for cleanup in cleanup_callbacks:
                try:
                    cleanup()
                except Exception:
                    pass


is_port_already_serving_cineflow = is_port_already_serving_velarium
stop_stale_cineflow_server_on_port = stop_stale_velarium_server_on_port
run_cineflow_server = run_velarium_server

