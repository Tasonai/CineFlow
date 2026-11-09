"""Static file resolution, in-memory compression caching, ETags, and HTTP serving.

Handles:
- Safe path containment within `public/` directory (anti-directory traversal)
- Gzip in-memory compression for text/script/style/svg assets
- Strong ETag calculation based on mtime and size
- Conditional requests (If-None-Match -> 304 Not Modified)
- Cache-Control headers (immutable for versioned assets with ?v=, no-cache for root SPA HTML)
- Index HTML dynamic boot metadata injection
- Unified GET and HEAD delivery
"""

from __future__ import annotations

import gzip
import mimetypes
import os
import threading
from typing import Any, Callable, Dict, Optional, Tuple

_STATIC_CONTENT_LOCK = threading.Lock()
_STATIC_CONTENT_CACHE: Dict[str, Tuple[float, bytes, Optional[bytes], str]] = {}
_INDEX_RAW_CACHE: Dict[str, Tuple[float, bytes]] = {}


def get_static_file_etag(file_path: str, mtime: float, length: int) -> str:
    return f'"{int(mtime):x}-{length:x}"'


def load_cached_static_file(
    file_path: str,
    can_gzip: bool = False,
    index_transformer: Optional[Callable[[bytes], bytes]] = None,
) -> Tuple[bytes, bool]:
    is_index = os.path.basename(file_path) == "index.html"
    try:
        mtime = os.path.getmtime(file_path)
    except OSError:
        mtime = 0.0

    if not is_index:
        with _STATIC_CONTENT_LOCK:
            entry = _STATIC_CONTENT_CACHE.get(file_path)
            if entry is not None and entry[0] == mtime:
                raw_bytes, gz_bytes = entry[1], entry[2]
                if can_gzip and gz_bytes is not None:
                    return gz_bytes, True
                return raw_bytes, False

    raw_bytes: Optional[bytes] = None
    if is_index:
        with _STATIC_CONTENT_LOCK:
            raw_entry = _INDEX_RAW_CACHE.get(file_path)
            if raw_entry is not None and raw_entry[0] == mtime:
                raw_bytes = raw_entry[1]

    if raw_bytes is None:
        try:
            with open(file_path, "rb") as f:
                raw_bytes = f.read()
        except OSError:
            raw_bytes = b""
        if is_index:
            with _STATIC_CONTENT_LOCK:
                if len(_INDEX_RAW_CACHE) > 16:
                    _INDEX_RAW_CACHE.clear()
                _INDEX_RAW_CACHE[file_path] = (mtime, raw_bytes)

    if is_index:
        if index_transformer is not None:
            try:
                raw_bytes = index_transformer(raw_bytes)
            except Exception:
                pass
        with _STATIC_CONTENT_LOCK:
            entry = _STATIC_CONTENT_CACHE.get(file_path)
            if entry is not None and entry[0] == mtime and entry[1] == raw_bytes:
                if can_gzip and entry[2] is not None:
                    return entry[2], True
                if not can_gzip:
                    return raw_bytes, False
        gz_bytes = None
        if len(raw_bytes) > 512:
            try:
                gz_bytes = gzip.compress(raw_bytes, compresslevel=5)
            except Exception:
                gz_bytes = None
        with _STATIC_CONTENT_LOCK:
            if len(_STATIC_CONTENT_CACHE) > 300:
                _STATIC_CONTENT_CACHE.clear()
            _STATIC_CONTENT_CACHE[file_path] = (mtime, raw_bytes, gz_bytes, "")
        if can_gzip and gz_bytes is not None:
            return gz_bytes, True
        return raw_bytes, False

    gz_bytes = None
    if file_path.endswith((".css", ".js", ".mjs", ".svg")) and len(raw_bytes) > 512:
        try:
            gz_bytes = gzip.compress(raw_bytes, compresslevel=5)
        except Exception:
            gz_bytes = None

    etag = get_static_file_etag(file_path, mtime, len(raw_bytes))

    with _STATIC_CONTENT_LOCK:
        if len(_STATIC_CONTENT_CACHE) > 300:
            _STATIC_CONTENT_CACHE.clear()
        _STATIC_CONTENT_CACHE[file_path] = (mtime, raw_bytes, gz_bytes, etag)

    if can_gzip and gz_bytes is not None:
        return gz_bytes, True
    return raw_bytes, False


def lookup_static_etag(file_path: str) -> Optional[str]:
    is_index = os.path.basename(file_path) == "index.html"
    if is_index:
        return None
    with _STATIC_CONTENT_LOCK:
        entry = _STATIC_CONTENT_CACHE.get(file_path)
        if entry is not None and len(entry) >= 4:
            return entry[3]
    try:
        st = os.stat(file_path)
        return get_static_file_etag(file_path, st.st_mtime, st.st_size)
    except OSError:
        return None


def resolve_safe_public_static_path(rel_path: str, public_dir: str) -> Tuple[str, bool]:
    clean = (rel_path or "").replace("\\", "/").strip().lstrip("/")
    abs_base = os.path.abspath(public_dir)
    target = os.path.abspath(os.path.join(abs_base, clean))
    try:
        common = os.path.commonpath([abs_base, target])
    except ValueError:
        return os.path.join(abs_base, "index.html"), False
    if common != abs_base:
        return os.path.join(abs_base, "index.html"), False
    if os.path.isfile(target):
        return target, True
    return target, False


def serve_static_file(
    handler: Any,
    path: str,
    parsed: Any,
    public_dir: str,
    head_only: bool = False,
    index_transformer: Optional[Callable[[bytes], bytes]] = None,
) -> None:
    """Serve a static asset or SPA HTML with ETag, 304, compression, and security headers."""
    if path == "/favicon.ico":
        rel_path = "favicon.svg"
    else:
        rel_path = "index.html" if path in ("/", "") else path.lstrip("/")

    file_path, is_valid_static = resolve_safe_public_static_path(rel_path, public_dir)
    is_asset_request = bool(
        path not in ("/", "")
        and (
            os.path.splitext(rel_path)[1]
            or rel_path.startswith(("css/", "js/", "assets/", "icons/", "fonts/"))
        )
    )

    if not is_valid_static:
        if is_asset_request:
            handler.send_response(404)
            handler.send_header("Content-Type", "text/plain; charset=utf-8")
            handler.send_header("Content-Length", "0")
            handler.end_headers()
            return
        file_path = os.path.join(public_dir, "index.html")

    if file_path.endswith(".svg"):
        mime_type = "image/svg+xml"
    elif file_path.endswith(".webmanifest"):
        mime_type = "application/manifest+json; charset=utf-8"
    elif file_path.endswith((".js", ".mjs")):
        mime_type = "application/javascript; charset=utf-8"
    elif file_path.endswith(".css"):
        mime_type = "text/css; charset=utf-8"
    else:
        mime_type, _ = mimetypes.guess_type(file_path)
        mime_type = mime_type or "text/html; charset=utf-8"

    can_gzip = False
    if file_path.endswith((".html", ".css", ".js", ".mjs", ".svg")):
        accept_enc = handler.headers.get("Accept-Encoding") or ""
        if "gzip" in accept_enc.lower():
            can_gzip = True

    is_versioned_asset = bool("v=" in parsed.query and not file_path.endswith(".html"))
    etag = lookup_static_etag(file_path)
    if_none_match = (handler.headers.get("If-None-Match") or "").strip()

    if etag and if_none_match and not file_path.endswith(".html"):
        tokens = [x.strip() for x in if_none_match.split(",")]
        if etag in tokens or f"W/{etag}" in tokens or "*" in tokens:
            try:
                handler.send_response(304)
                handler._send_security_headers(allow_media_cors=False)
                handler.send_header("ETag", etag)
                if is_versioned_asset:
                    handler.send_header("Cache-Control", "public, max-age=604800, immutable")
                handler.end_headers()
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

    content, use_static_gzip = load_cached_static_file(
        file_path, can_gzip=can_gzip, index_transformer=index_transformer
    )
    if not etag and not file_path.endswith(".html"):
        etag = lookup_static_etag(file_path)

    try:
        handler.send_response(200)
        handler.send_header("Content-Type", mime_type)
        handler._send_security_headers(allow_media_cors=False)
        if etag and not file_path.endswith(".html"):
            handler.send_header("ETag", etag)
        if use_static_gzip:
            handler.send_header("Content-Encoding", "gzip")
            handler.send_header("Vary", "Accept-Encoding")
        handler.send_header("Content-Length", str(len(content)))
        if is_versioned_asset:
            handler.send_header("Cache-Control", "public, max-age=604800, immutable")
        elif file_path.endswith((".html", ".css", ".js")):
            handler.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            handler.send_header("Pragma", "no-cache")
            handler.send_header("Expires", "0")
        handler.end_headers()

        if not head_only:
            handler.wfile.write(content)
    except (BrokenPipeError, ConnectionResetError):
        pass


def transform_index_html(
    raw_bytes: bytes,
    boot_lang: str = "ru",
    setup_completed: bool = False,
) -> bytes:
    """Injects dynamic boot language and setup-completed attributes into index.html."""
    setup_flag = "true" if setup_completed else "false"
    tag = (
        f'<html lang="{boot_lang}" data-boot-lang="{boot_lang}" '
        f'data-setup-completed="{setup_flag}">'
    ).encode("utf-8")
    return raw_bytes.replace(b'<html lang="ru">', tag, 1)


def make_index_html_transformer(
    app_prefs: Dict[str, Any],
    norm_lang_fn: Optional[Callable[[Any, str], str]] = None,
) -> Callable[[bytes], bytes]:
    """Builds a dynamic index.html transformer callable reading current app_prefs."""
    def _transformer(raw_bytes: bytes) -> bytes:
        raw_lang = app_prefs.get("app_lang")
        boot_lang = norm_lang_fn(raw_lang, "ru") if norm_lang_fn else (str(raw_lang or "ru").strip().lower() or "ru")
        setup_flag = bool(app_prefs.get("setup_completed"))
        return transform_index_html(raw_bytes, boot_lang=boot_lang, setup_completed=setup_flag)

    return _transformer

