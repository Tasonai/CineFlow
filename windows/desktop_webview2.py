import ctypes
import json
import os
import socket
import sys
import threading
import time
from typing import Any, Optional
import urllib.request
import webbrowser

os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault(
    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    "--enable-gpu-rasterization --enable-oop-rasterization --ignore-gpu-blocklist "
    "--enable-features=CanvasOopRasterization,D3D11VideoDecoder,DirectComposition "
    "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows "
    "--disable-features=CalculateNativeWinOcclusion,Translate "
    "--proxy-bypass-list=<-loopback> --disable-extensions --disable-component-update --disable-sync "
    "--disable-default-apps --disable-domain-reliability --disk-cache-size=268435456 "
    "--autoplay-policy=no-user-gesture-required",
)

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

_velarium_server: Any = None


def _ensure_server_module() -> Any:
    global _velarium_server
    if _velarium_server is None:
        import server as _srv_mod

        _velarium_server = _srv_mod
    return _velarium_server


def _probe_existing_velarium_port(port: int) -> bool:
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{int(port)}/api/system/status",
            headers={"Accept": "application/json"},
            method="GET",
        )
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=0.6) as resp:
            if resp.status != 200:
                return False
            data = json.loads(resp.read(16384).decode("utf-8", errors="ignore"))
            return isinstance(data, dict) and data.get("ok") is True and "port" in data
    except Exception:
        return False


def _safe_stderr_write(msg: str) -> None:
    if sys.stderr is not None:
        try:
            sys.stderr.write(msg)
        except Exception:
            pass


def _is_port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _shutdown_desktop_runtime(server_thread: Optional[threading.Thread] = None) -> None:
    if _velarium_server is None:
        return
    try:
        _velarium_server.sync_lan_listener(False)
    except Exception:
        pass
    try:
        httpd = _velarium_server.SERVER_RUNTIME.get("server")
        if httpd is not None:
            httpd.shutdown()
            if server_thread is not None and server_thread.is_alive():
                server_thread.join(timeout=3.0)
            httpd.server_close()
    except Exception:
        pass
    try:
        _velarium_server.backup_stream_engine.shutdown_local_torrserver()
    except Exception:
        pass
    try:
        _velarium_server.download_manager.shutdown()
    except Exception:
        pass
    try:
        from backend.routes.system import _close_active_stream_embed_proc

        _close_active_stream_embed_proc()
    except Exception:
        pass
    try:
        _velarium_server.kinorium_service._flush_state_on_exit()
    except Exception:
        pass


def wait_for_port(port: int, timeout: float = 15.0) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def compute_adaptive_window_size() -> tuple[int, int]:
    """Computes DPI-safe window dimensions that never overflow behind the Windows Taskbar."""
    win_w, win_h = 1280, 780
    if sys.platform == "win32":
        try:
            class _RECT(ctypes.Structure):
                _fields_ = [
                    ("left", ctypes.c_long),
                    ("top", ctypes.c_long),
                    ("right", ctypes.c_long),
                    ("bottom", ctypes.c_long),
                ]

            rc = _RECT()
            if ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rc), 0):
                work_w = max(800, int(rc.right - rc.left))
                work_h = max(600, int(rc.bottom - rc.top))
                win_w = min(1400, max(960, work_w - 56))
                win_h = min(860, max(640, work_h - 44))
                win_w = min(win_w, work_w)
                win_h = min(win_h, work_h)
        except Exception:
            pass
    return win_w, win_h


def main() -> None:
    port = 8765
    owns_server = True
    server_thread: Optional[threading.Thread] = None

    if _probe_existing_velarium_port(port):
        # Background Velarium daemon is already serving 127.0.0.1:8765 — attach UI without
        # importing server or spawning duplicate background workers / atexit hooks.
        owns_server = False
        actual_port = port
    else:
        if not _is_port_free(port):
            found_free = None
            for cand_port in range(8766, 8776):
                if _probe_existing_velarium_port(cand_port):
                    owns_server = False
                    found_free = cand_port
                    break
                if _is_port_free(cand_port):
                    found_free = cand_port
                    break
            if found_free is None:
                _safe_stderr_write(f"[Velarium] No available loopback port in 8765..8775\n")
                return
            port = found_free

        if owns_server:
            srv_mod = _ensure_server_module()
            server_thread = threading.Thread(target=srv_mod.run_server, args=(port,), daemon=True)
            server_thread.start()
            if not wait_for_port(port, timeout=20.0):
                _safe_stderr_write(f"[Velarium] Local HTTP server failed to bind 127.0.0.1:{port}\n")
                _shutdown_desktop_runtime(server_thread)
                return
            actual_port = int(srv_mod.SERVER_RUNTIME.get("port") or port)
            if not srv_mod._is_port_already_serving_velarium(actual_port):
                _safe_stderr_write(f"[Velarium] Port 127.0.0.1:{actual_port} is not serving Velarium\n")
                _shutdown_desktop_runtime(server_thread)
                return
        else:
            actual_port = port

    url = f"http://127.0.0.1:{actual_port}"
    win_w, win_h = compute_adaptive_window_size()
    try:
        try:
            import webview  # pywebview uses Microsoft Edge WebView2 on Windows 10/11

            webview.create_window(
                title="Velarium",
                url=url,
                width=win_w,
                height=win_h,
                background_color="#0a0a0c",
                text_select=True,
            )
            webview.start(gui="edgechromium")
        except Exception as exc:
            _safe_stderr_write(f"[Velarium] WebView2 unavailable ({exc}); opening system browser.\n")
            webbrowser.open(url)
            if owns_server and server_thread is not None:
                try:
                    while server_thread.is_alive():
                        time.sleep(1)
                except KeyboardInterrupt:
                    pass
    finally:
        if owns_server:
            _shutdown_desktop_runtime(server_thread)


if __name__ == "__main__":
    main()
