"""
CineFlow Server Bootstrap Utilities
Provides runtime paths resolution, safe standard stream redirection,
safe non-blocking logging, numeric query parameter parsers, and binary directory setup.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Callable, Dict, Optional


def resolve_runtime_paths(base_file: str) -> Dict[str, str]:
    """
    Computes absolute filesystem paths for BASE_DIR, PUBLIC_DIR, DATA_DIR,
    SETTINGS_PATH, and BIN_DIR based on the entry script location and environment.
    """
    base_dir = os.path.dirname(os.path.abspath(base_file))
    public_dir = os.path.join(base_dir, "public")
    data_dir = os.path.abspath(os.environ.get("CINEFLOW_DATA_DIR") or os.path.join(base_dir, "data"))
    settings_path = os.path.join(data_dir, "server_settings.json")
    bin_dir = os.path.join(base_dir, "backend", "bin")
    return {
        "base_dir": base_dir,
        "public_dir": public_dir,
        "data_dir": data_dir,
        "settings_path": settings_path,
        "bin_dir": bin_dir,
    }


def ensure_bin_in_path(bin_dir: str) -> None:
    """Prepends backend binary directory to PATH environment variable if present."""
    if os.path.isdir(bin_dir) and bin_dir not in os.environ.get("PATH", "").split(os.pathsep):
        os.environ["PATH"] = f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"


def ensure_safe_std_streams(data_dir: str) -> None:
    """
    Guarantees non-None UTF-8 sys.stdout and sys.stderr even when launched via
    pythonw.exe without redirected standard handles or on non-UTF-8 Windows codepages.
    """
    fallback_stream = None
    for attr in ("stdout", "stderr"):
        cur = getattr(sys, attr, None)
        if cur is None:
            if fallback_stream is None:
                try:
                    os.makedirs(data_dir, exist_ok=True)
                    fallback_stream = open(
                        os.path.join(data_dir, "cineflow.log"),
                        "a",
                        encoding="utf-8",
                        errors="replace",
                        buffering=1,
                    )
                except Exception:
                    fallback_stream = open(os.devnull, "w", encoding="utf-8", errors="replace")
            setattr(sys, attr, fallback_stream)
        else:
            reconf = getattr(cur, "reconfigure", None)
            if callable(reconf):
                try:
                    reconf(encoding="utf-8", errors="replace")
                except Exception:
                    pass


def make_safe_logger(is_daemon_log_mode: bool = False) -> Callable[[str, bool], None]:
    """Creates a thread-safe stdout/stderr writer that suppresses encoding errors."""
    def _safe_log(message: str, is_error: bool = False) -> None:
        try:
            target = sys.stderr if is_error else sys.stdout
            if target is not None:
                target.write(message)
                if is_error or not is_daemon_log_mode:
                    target.flush()
        except Exception:
            pass

    return _safe_log


def safe_int(val: Any, default: int = 0) -> int:
    """Parses value into int safely, returning default on None or conversion error."""
    try:
        if val is None or val == "":
            return default
        return int(val)
    except (ValueError, TypeError):
        return default


def safe_float(val: Any, default: float = 0.0) -> float:
    """Parses value into float safely, returning default on None or conversion error."""
    try:
        if val is None or val == "":
            return default
        return float(val)
    except (ValueError, TypeError):
        return default


def qs_int(qs: dict, key: str, default: int = 0) -> int:
    """Extracts integer value from parsed query string dict."""
    raw_list = qs.get(key)
    if not raw_list:
        return default
    return safe_int(raw_list[0], default)


def qs_float(qs: dict, key: str, default: float = 0.0) -> float:
    """Extracts float value from parsed query string dict."""
    raw_list = qs.get(key)
    if not raw_list:
        return default
    return safe_float(raw_list[0], default)
