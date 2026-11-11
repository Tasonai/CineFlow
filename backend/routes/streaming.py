"""
Velarium Streaming, Media Proxy, Range Streaming and Remuxing Route Handlers.
Dispatches:
- /api/proxy-stream (HLS and raw video proxy with edge failover)
- /api/download-mp4 (Direct or remuxed MP4 file downloads)
- /api/proxy-vtt (Remote subtitle proxy and WebVTT conversion)
- /api/remux-stream (Live zero-copy FFmpeg remuxing pipeline)
- /api/video-snapshot (Canvas/FFmpeg video frame snapshot capture)
- /api/downloads/stream/* (Range-streaming of offline video files)
- /api/downloads/sub/* (Offline subtitle delivery)
- /api/downloads/poster/* (Offline poster image delivery)
"""

import concurrent.futures
import hashlib
import http.client
import ipaddress
import os
import queue
import re
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from backend.downloads import parse_http_byte_range
from backend.net_security import (
    is_allowed_media_source_url as _net_is_allowed_media_source_url,
    is_strictly_public_ip_obj as _net_is_strictly_public_ip_obj,
)
from backend.stremio import StremioAddonEngine
from backend.subtitles import convert_any_subtitle_to_webvtt

_REMUX_SUB_SRT_LOCK = threading.Lock()
_REMUX_SUB_SRT_CACHE: Dict[Any, str] = {}
_REMUX_TEMP_SUB_FILES: List[str] = []
_REMUX_CLEANUP_POOL = concurrent.futures.ThreadPoolExecutor(
    max_workers=2,
    thread_name_prefix="VelariumRemuxReap",
)
_PROXY_PUMP_POOL = concurrent.futures.ThreadPoolExecutor(
    max_workers=16,
    thread_name_prefix="VelariumProxyPump",
)


def _terminate_and_reap_proc(proc: Any) -> None:
    """Terminates and waits for a preempted FFmpeg subprocess on a background reaper thread."""
    if proc is None:
        return
    try:
        if proc.stdout:
            try:
                proc.stdout.close()
            except Exception:
                pass
        if proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=0.8)
    except Exception:
        try:
            proc.kill()
            proc.wait(timeout=0.5)
        except Exception:
            pass


def _get_server_module() -> Any:
    """Resolves the server module whether imported as 'server' or executed as '__main__'."""
    srv = sys.modules.get("server")
    if srv is not None:
        return srv
    main_mod = sys.modules.get("__main__")
    if main_mod is not None and (hasattr(main_mod, "SERVER_CONTEXT") or hasattr(main_mod, "SERVICES")):
        return main_mod
    return None

# Thread-safe media edge caches and locks
MEDIA_EDGE_LOCK = threading.Lock()
VOIDBOOST_EDGE_CACHE: Dict[str, Tuple[str, float]] = {}
DEAD_MEDIA_EDGE_IPS: Dict[str, float] = {}
_MEDIA_EDGE_DNS_CACHE: Dict[Tuple[str, int], Tuple[List[str], float]] = {}
_MEDIA_UPSTREAM_POOL: Dict[Tuple[str, str, int], List[Tuple[http.client.HTTPConnection, float]]] = {}

SUBTITLE_CACHE_LOCK = threading.Lock()
SUBTITLE_RAW_CACHE: Dict[str, bytes] = {}
_WEBVTT_CONVERTED_CACHE: Dict[Tuple[str, float], Tuple[float, bytes]] = {}
_HLS_URI_ATTR_RE = re.compile(r'URI\s*=\s*(["\'])([^"\']+)\1', re.I)
_RANGE_START_RE = re.compile(r"^bytes=(\d+)-")
_RANGE_SINGLE_RE = re.compile(r"^bytes=(\d+)-(\d*)$")
_HTTP_RANGE_RE = re.compile(r"bytes=(?:\d+-\d*|\d*-\d+)(?:,\s*(?:\d+-\d*|\d*-\d+))*")

_ACTIVE_REMUX_PROCS_LOCK = threading.Lock()
_ACTIVE_REMUX_PROCS: List[Any] = []
_REMUX_GEN_SEQ: int = 0
_LAST_TOUCH_STREAM_TS: float = 0.0

_SAFE_MEDIA_CTYPE_PREFIXES = ("video/", "audio/")
_SAFE_MEDIA_CTYPES = {
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "application/mpegurl",
    "application/octet-stream",
    "application/dash+xml",
    "application/mp4",
    "application/ogg",
    "binary/octet-stream",
    "text/vtt",
}

_SHARED_VERIFIED_SSL_CTX = ssl.create_default_context()
_SHARED_UNVERIFIED_SSL_CTX = ssl._create_unverified_context()
_LOOPBACK_DIRECT_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def touch_stream_activity() -> float:
    """Updates last streaming activity timestamp on server module (throttled to 1.5s)."""
    global _LAST_TOUCH_STREAM_TS
    now = time.time()
    if now - _LAST_TOUCH_STREAM_TS < 1.5:
        return now
    _LAST_TOUCH_STREAM_TS = now
    srv = _get_server_module()
    if srv:
        try:
            setattr(srv, "LAST_STREAM_ACTIVITY_TS", now)
        except Exception:
            pass
    return now


def terminate_active_remux_procs() -> None:
    """Terminates all active FFmpeg remux processes cleanly."""
    with _ACTIVE_REMUX_PROCS_LOCK:
        active_snap = list(_ACTIVE_REMUX_PROCS)
        _ACTIVE_REMUX_PROCS.clear()
    for remux_p, remux_stop in active_snap:
        try:
            remux_stop.set()
            if remux_p.poll() is None:
                remux_p.terminate()
                remux_p.wait(timeout=0.6)
        except Exception:
            try:
                remux_p.kill()
            except Exception:
                pass


def _safe_media_content_type(raw_ctype: str) -> str:
    """Only relay media MIME types from upstream; anything else becomes octet-stream."""
    clean = str(raw_ctype or "").replace("\r", "").replace("\n", "").strip()
    base = clean.split(";", 1)[0].strip().lower()
    if base.startswith(_SAFE_MEDIA_CTYPE_PREFIXES) or base in _SAFE_MEDIA_CTYPES:
        return clean
    return "application/octet-stream"


def _sniff_raster_image_type(data: bytes) -> str:
    if not data:
        return ""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n" or data[:4] == b"\x89PNG":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[4:12] in (b"ftypavif", b"ftypavis", b"ftypmif1", b"ftypheic"):
        return "image/avif"
    return ""


def _is_voidboost_cdn_host(host: str) -> bool:
    h = (host or "").strip().lower().rstrip(".")
    return bool(h) and (h.startswith("voidboost.") or ".voidboost." in h)


def _unwrap_local_proxy_media_url(raw_url: str) -> str:
    u = str(raw_url or "").strip()
    if not u:
        return ""
    srv = _get_server_module()
    server_runtime = getattr(srv, "SERVER_RUNTIME", {}) if srv else {}
    for _ in range(4):
        u_low = u.lower()
        if u_low.startswith(("/api/proxy-stream", "/api/remux-stream")):
            p = urllib.parse.urlparse(u)
            p_path = (p.path or "").rstrip("/").lower()
            if p_path in ("/api/proxy-stream", "/api/remux-stream"):
                qs_map = urllib.parse.parse_qs(p.query)
                inner = (qs_map.get("url") or qs_map.get("src") or [""])[0].strip()
                if inner and inner != u:
                    u = inner
                    continue
            break
        if u_low.startswith(("http://", "https://")):
            p = urllib.parse.urlparse(u)
            p_path = (p.path or "").rstrip("/").lower()
            if p_path in ("/api/proxy-stream", "/api/remux-stream"):
                h_low = (p.hostname or "").strip().lower()
                srv_port = int(server_runtime.get("port") or 8765)
                lan_bound = str(server_runtime.get("lan_bound_ip") or "").strip().lower()
                if h_low in ("127.0.0.1", "localhost", "::1") or (lan_bound and h_low == lan_bound) or p.port == srv_port:
                    qs_map = urllib.parse.parse_qs(p.query)
                    inner = (qs_map.get("url") or qs_map.get("src") or [""])[0].strip()
                    if inner and inner != u:
                        u = inner
                        continue
        break
    return u


def _wrap_voidboost_stream_url(raw_url: str, absolute_loopback: bool = False) -> str:
    u = _unwrap_local_proxy_media_url(raw_url)
    if not u or not u.startswith(("http://", "https://")):
        return raw_url
    p = urllib.parse.urlparse(u)
    path_low = (p.path or "").lower()
    if path_low.endswith(".m3u8") or ":hls:" in path_low:
        return u
    rel = f"/api/proxy-stream?url={urllib.parse.quote(u, safe='')}"
    if absolute_loopback:
        srv = _get_server_module()
        server_runtime = getattr(srv, "SERVER_RUNTIME", {}) if srv else {}
        port = int(server_runtime.get("port") or 8765)
        return f"http://127.0.0.1:{port}{rel}"
    return rel


def _configure_low_latency_socket(sock: Any, is_client_stream: bool = False) -> None:
    if sock is None:
        return
    if is_client_stream:
        try:
            sock.settimeout(None)
        except Exception:
            pass
    try:
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    except Exception:
        pass
    try:
        cur_rcv = sock.getsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF)
        if cur_rcv < 1048576:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1048576)
    except Exception:
        pass
    if is_client_stream:
        try:
            cur_snd = sock.getsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF)
            if cur_snd < 1048576:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1048576)
        except Exception:
            pass


def _check_strictly_public_ip_obj(raw_ip: Any) -> bool:
    srv = _get_server_module()
    chk_fn = getattr(srv, "_is_strictly_public_ip_obj", None)
    if chk_fn:
        return chk_fn(raw_ip)
    return _net_is_strictly_public_ip_obj(raw_ip)


def _check_allowed_media_source_url(raw_url: str, allow_torrserver_loopback: bool = True) -> bool:
    srv = _get_server_module()
    chk_fn = getattr(srv, "_is_allowed_media_source_url", None)
    if chk_fn:
        return chk_fn(raw_url, allow_torrserver_loopback=allow_torrserver_loopback)
    b_engine = getattr(srv, "backup_stream_engine", None) if srv else None
    torr_url = str(getattr(b_engine, "torrserver_url", None) or "http://127.0.0.1:8090")
    s_runtime = getattr(srv, "SERVER_RUNTIME", {}) if srv else {}
    own_p = int((s_runtime.get("port") if isinstance(s_runtime, dict) else None) or 8765)
    net_c = getattr(srv, "net_client", None) if srv else None
    return _net_is_allowed_media_source_url(
        raw_url,
        allow_torrserver_loopback=allow_torrserver_loopback,
        torrserver_url=torr_url,
        own_port=own_p,
        net_client=net_c,
    )


def _is_usable_public_ip(ip_str: str) -> bool:
    return _check_strictly_public_ip_obj(str(ip_str or "").split("%", 1)[0].strip())


def _connect_media_http(
    parsed_url: urllib.parse.ParseResult,
    connect_timeout: float = 2.8,
    read_timeout: float = 14.0,
) -> http.client.HTTPConnection:
    host = (parsed_url.hostname or "").strip()
    is_https = parsed_url.scheme == "https"
    port = parsed_url.port or (443 if is_https else 80)

    seen_ips = []
    is_ip_literal = False
    try:
        ipaddress.ip_address(host)
        is_ip_literal = True
        if _is_usable_public_ip(host):
            seen_ips.append(host)
    except ValueError:
        pass

    srv = _get_server_module()
    net_client = getattr(srv, "net_client", None)

    prefer_doh_first = bool(getattr(net_client, "doh_enabled", False)) and not is_ip_literal
    allow_doh_fallback = (
        prefer_doh_first or bool(getattr(net_client, "local_media_proxy", False))
    ) and not is_ip_literal

    def _append_os_dns_ips(target_list: List[str]) -> List[str]:
        added: List[str] = []
        if is_ip_literal:
            return added
        dns_key = (host.lower(), int(port))
        now_dns = time.time()
        with MEDIA_EDGE_LOCK:
            cached_dns = _MEDIA_EDGE_DNS_CACHE.get(dns_key)
            if cached_dns and cached_dns[1] > now_dns:
                for ip_addr in cached_dns[0]:
                    if ip_addr not in target_list:
                        target_list.append(ip_addr)
                        added.append(ip_addr)
                return added
        resolved_public: List[str] = []
        try:
            infos = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
        except Exception:
            infos = []
        if not infos:
            try:
                infos = socket.getaddrinfo(host, port, socket.AF_UNSPEC, socket.SOCK_STREAM)
            except Exception:
                infos = []
        for entry in infos:
            ip_addr = entry[4][0]
            if _is_usable_public_ip(ip_addr):
                if ip_addr not in resolved_public:
                    resolved_public.append(ip_addr)
                if ip_addr not in target_list:
                    target_list.append(ip_addr)
                    added.append(ip_addr)
        if resolved_public:
            with MEDIA_EDGE_LOCK:
                if len(_MEDIA_EDGE_DNS_CACHE) > 256:
                    _MEDIA_EDGE_DNS_CACHE.clear()
                _MEDIA_EDGE_DNS_CACHE[dns_key] = (resolved_public, now_dns + 120.0)
        return added

    os_dns_queried = is_ip_literal
    if prefer_doh_first and net_client:
        doh_ip = net_client.resolve_doh_ipv4(host)
        if doh_ip and _is_usable_public_ip(doh_ip) and doh_ip not in seen_ips:
            seen_ips.append(doh_ip)

    with MEDIA_EDGE_LOCK:
        has_healthy_doh = any(ip not in DEAD_MEDIA_EDGE_IPS for ip in seen_ips)

    if not is_ip_literal and not has_healthy_doh:
        os_dns_queried = True
        _append_os_dns_ips(seen_ips)

    if not seen_ips and allow_doh_fallback and net_client:
        doh_ip = net_client.resolve_doh_ipv4(host)
        if doh_ip and _is_usable_public_ip(doh_ip) and doh_ip not in seen_ips:
            seen_ips.append(doh_ip)

    now = time.time()
    with MEDIA_EDGE_LOCK:
        expired = [k for k, exp in DEAD_MEDIA_EDGE_IPS.items() if exp <= now]
        for k in expired:
            DEAD_MEDIA_EDGE_IPS.pop(k, None)
        if len(DEAD_MEDIA_EDGE_IPS) > 512:
            for _ in range(min(128, len(DEAD_MEDIA_EDGE_IPS))):
                DEAD_MEDIA_EDGE_IPS.pop(next(iter(DEAD_MEDIA_EDGE_IPS)), None)
        healthy_ips = [ip for ip in seen_ips if ip not in DEAD_MEDIA_EDGE_IPS]
        suspect_ips = [ip for ip in seen_ips if ip in DEAD_MEDIA_EDGE_IPS]

    if not healthy_ips and allow_doh_fallback and not prefer_doh_first and net_client:
        doh_ip = net_client.resolve_doh_ipv4(host)
        if doh_ip and _is_usable_public_ip(doh_ip) and doh_ip not in seen_ips:
            seen_ips.append(doh_ip)
            with MEDIA_EDGE_LOCK:
                is_dead_doh = doh_ip in DEAD_MEDIA_EDGE_IPS
            if not is_dead_doh:
                healthy_ips.insert(0, doh_ip)
            else:
                suspect_ips.append(doh_ip)

    ordered_ips = list(healthy_ips) + list(suspect_ips)
    last_err: Optional[Exception] = None
    allow_expired_voidboost_tls = _is_voidboost_cdn_host(host)
    doh_appended_on_error = prefer_doh_first or not allow_doh_fallback

    idx = 0
    while idx < len(ordered_ips):
        ip_addr = ordered_ips[idx]
        idx += 1
        raw_sock = None
        try:
            raw_sock = socket.create_connection((ip_addr, port), timeout=connect_timeout)
            _configure_low_latency_socket(raw_sock)
        except Exception as err:
            last_err = err
            with MEDIA_EDGE_LOCK:
                DEAD_MEDIA_EDGE_IPS[ip_addr] = time.time() + 30.0
            if not doh_appended_on_error and idx >= len(healthy_ips) and net_client:
                doh_appended_on_error = True
                doh_ip = net_client.resolve_doh_ipv4(host)
                if doh_ip and _is_usable_public_ip(doh_ip) and doh_ip not in ordered_ips:
                    ordered_ips.insert(idx, doh_ip)
            if not os_dns_queried and idx >= len(ordered_ips):
                os_dns_queried = True
                _append_os_dns_ips(ordered_ips)
            continue

        try:
            peer_ip_chk = str(raw_sock.getpeername()[0]).split("%", 1)[0]
            if not _check_strictly_public_ip_obj(peer_ip_chk):
                raise OSError(f"Disallowed non-public media peer IP: {peer_ip_chk}")
            if is_https:
                ctx_used = _SHARED_VERIFIED_SSL_CTX
                try:
                    tls_sock = ctx_used.wrap_socket(raw_sock, server_hostname=host)
                except ssl.SSLCertVerificationError as cert_err:
                    try:
                        raw_sock.close()
                    except Exception:
                        pass
                    raw_sock = None
                    if not allow_expired_voidboost_tls:
                        raise cert_err
                    raw_sock = socket.create_connection((ip_addr, port), timeout=connect_timeout)
                    _configure_low_latency_socket(raw_sock)
                    peer_ip_fb = str(raw_sock.getpeername()[0]).split("%", 1)[0]
                    if not _check_strictly_public_ip_obj(peer_ip_fb):
                        raise OSError(f"Disallowed non-public media peer IP: {peer_ip_fb}")
                    ctx_used = _SHARED_UNVERIFIED_SSL_CTX
                    tls_sock = ctx_used.wrap_socket(raw_sock, server_hostname=host)
                tls_sock.settimeout(read_timeout)
                conn: http.client.HTTPConnection = http.client.HTTPSConnection(
                    host, port, timeout=read_timeout, context=ctx_used
                )
                conn.sock = tls_sock
                return conn
            raw_sock.settimeout(read_timeout)
            conn = http.client.HTTPConnection(host, port, timeout=read_timeout)
            conn.sock = raw_sock
            return conn
        except Exception as err:
            last_err = err
            with MEDIA_EDGE_LOCK:
                DEAD_MEDIA_EDGE_IPS[ip_addr] = time.time() + 30.0
            try:
                if raw_sock:
                    raw_sock.close()
            except Exception:
                pass
            if not doh_appended_on_error and idx >= len(healthy_ips) and net_client:
                doh_appended_on_error = True
                doh_ip = net_client.resolve_doh_ipv4(host)
                if doh_ip and _is_usable_public_ip(doh_ip) and doh_ip not in ordered_ips:
                    ordered_ips.insert(idx, doh_ip)

    raise OSError(f"Media upstream connect failed for {host}: {last_err}")


def _call_connect_media_http(*args, **kwargs) -> http.client.HTTPConnection:
    srv = _get_server_module()
    conn_fn = getattr(srv, "_connect_media_http", _connect_media_http) if srv else _connect_media_http
    return conn_fn(*args, **kwargs)


def _pop_pooled_media_conn(parsed_url: urllib.parse.ParseResult) -> Optional[http.client.HTTPConnection]:
    srv = _get_server_module()
    conn_fn = getattr(srv, "_connect_media_http", _connect_media_http) if srv else _connect_media_http
    if conn_fn is not _connect_media_http:
        return None
    scheme = (parsed_url.scheme or "https").lower()
    host = (parsed_url.hostname or "").strip().lower()
    port = int(parsed_url.port or (443 if scheme == "https" else 80))
    key = (scheme, host, port)
    now = time.time()
    chosen_conn: Optional[http.client.HTTPConnection] = None
    expired_conns: List[http.client.HTTPConnection] = []
    with MEDIA_EDGE_LOCK:
        bucket = _MEDIA_UPSTREAM_POOL.get(key)
        if bucket:
            while bucket:
                conn, ts = bucket.pop()
                if now - ts <= 25.0 and getattr(conn, "sock", None) is not None:
                    chosen_conn = conn
                    break
                expired_conns.append(conn)
    for c_old in expired_conns:
        try:
            c_old.close()
        except Exception:
            pass
    return chosen_conn


def _release_or_close_media_conn(
    conn: Optional[http.client.HTTPConnection],
    resp: Optional[http.client.HTTPResponse] = None,
    reusable: bool = False,
) -> None:
    if conn is None:
        return
    if reusable and getattr(conn, "sock", None) is not None:
        try:
            conn_hdr = (resp.getheader("Connection") or "").lower() if resp is not None else ""
            if "close" not in conn_hdr and (resp is None or not getattr(resp, "will_close", False)):
                if resp is not None and (
                    getattr(resp, "length", None) in (0, None)
                    or str(getattr(resp, "_method", "") or "").upper() == "HEAD"
                ):
                    try:
                        resp.close()
                    except Exception:
                        pass
                if resp is not None and hasattr(resp, "isclosed") and not resp.isclosed():
                    try:
                        conn.close()
                    except Exception:
                        pass
                    return
                edge_u = str(getattr(conn, "_velarium_edge_url", "") or "")
                p = urllib.parse.urlparse(edge_u) if edge_u else None
                scheme = (p.scheme if p and p.scheme else ("https" if isinstance(conn, http.client.HTTPSConnection) else "http")).lower()
                host = (p.hostname if p and p.hostname else getattr(conn, "host", "")).strip().lower()
                port = int((p.port if p and p.port else getattr(conn, "port", 0)) or (443 if scheme == "https" else 80))
                if host:
                    key = (scheme, host, port)
                    evicted_conns: List[http.client.HTTPConnection] = []
                    pooled_ok = False
                    with MEDIA_EDGE_LOCK:
                        if key not in _MEDIA_UPSTREAM_POOL and len(_MEDIA_UPSTREAM_POOL) >= 24:
                            oldest_key = next(iter(_MEDIA_UPSTREAM_POOL))
                            for c_old, _ in _MEDIA_UPSTREAM_POOL.pop(oldest_key, []):
                                evicted_conns.append(c_old)
                        bucket = _MEDIA_UPSTREAM_POOL.setdefault(key, [])
                        if len(bucket) < 3:
                            bucket.append((conn, time.time()))
                            pooled_ok = True
                    for c_old in evicted_conns:
                        try:
                            c_old.close()
                        except Exception:
                            pass
                    if pooled_ok:
                        return
        except Exception:
            pass
    try:
        conn.close()
    except Exception:
        pass


def _evict_voidboost_edge_and_mark_dead(base_url: str, edge_url: str = "") -> None:
    clean_base = _unwrap_local_proxy_media_url(base_url)
    with MEDIA_EDGE_LOCK:
        evicted = VOIDBOOST_EDGE_CACHE.pop(clean_base, None)
    target_edge = edge_url or (evicted[0] if evicted and evicted[0] != clean_base else "")
    if target_edge and target_edge != clean_base:
        try:
            p_ev = urllib.parse.urlparse(target_edge)
            ev_host = (p_ev.hostname or "").strip()
            ev_port = int(p_ev.port or (443 if (p_ev.scheme or "https").lower() == "https" else 80))
            if ev_host:
                try:
                    ipaddress.ip_address(ev_host)
                    ev_ips = [ev_host]
                except ValueError:
                    dns_k = (ev_host.lower(), ev_port)
                    with MEDIA_EDGE_LOCK:
                        cached_d = _MEDIA_EDGE_DNS_CACHE.pop(dns_k, None)
                        if cached_d is None and ev_port != 443:
                            cached_d = _MEDIA_EDGE_DNS_CACHE.pop((ev_host.lower(), 443), None)
                    ev_ips = list(cached_d[0]) if cached_d else []
                to_close: List[http.client.HTTPConnection] = []
                with MEDIA_EDGE_LOCK:
                    exp_until = time.time() + 45.0
                    for ev_ip in ev_ips:
                        DEAD_MEDIA_EDGE_IPS[ev_ip] = exp_until
                    for pk in [k for k in _MEDIA_UPSTREAM_POOL.keys() if k[1] == ev_host.lower()]:
                        for c_old, _ in _MEDIA_UPSTREAM_POOL.pop(pk, []):
                            to_close.append(c_old)
                for c_old in to_close:
                    try:
                        c_old.close()
                    except Exception:
                        pass
        except Exception:
            pass


def _open_resilient_media_upstream(
    raw_url: str,
    range_header: str = "",
    method: str = "GET",
    evict_cached_edge: bool = False,
    abort_event: Optional[threading.Event] = None,
) -> Tuple[http.client.HTTPConnection, http.client.HTTPResponse]:
    base_url = _unwrap_local_proxy_media_url(raw_url)
    if not _check_allowed_media_source_url(base_url, allow_torrserver_loopback=False):
        raise ValueError("Disallowed media stream URL")

    if evict_cached_edge:
        _evict_voidboost_edge_and_mark_dead(base_url)

    ua = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    )
    last_exc: Optional[Exception] = None

    for attempt in range(3):
        if abort_event is not None and abort_event.is_set():
            break
        now = time.time()
        cur_url = base_url
        with MEDIA_EDGE_LOCK:
            cached = VOIDBOOST_EDGE_CACHE.get(base_url)
            if cached and cached[1] > now:
                cur_url = cached[0]
            elif cached:
                VOIDBOOST_EDGE_CACHE.pop(base_url, None)

        conn: Optional[http.client.HTTPConnection] = None
        try:
            for _hop in range(4):
                if abort_event is not None and abort_event.is_set():
                    break
                if not _check_allowed_media_source_url(cur_url, allow_torrserver_loopback=False):
                    raise ValueError("Disallowed redirect media target")
                p = urllib.parse.urlparse(cur_url)
                host_low = (p.hostname or "").lower()
                is_router_hop = host_low.startswith("stream.voidboost.")
                req_method = "GET" if (method != "HEAD" or is_router_hop) else "HEAD"
                req_headers = {
                    "User-Agent": ua,
                    "Accept": "*/*",
                    "Connection": "close" if is_router_hop else "keep-alive",
                }
                if range_header:
                    req_headers["Range"] = range_header
                elif method == "HEAD" and is_router_hop:
                    req_headers["Range"] = "bytes=0-1"

                req_target = p.path or "/"
                if p.query:
                    req_target += f"?{p.query}"

                resp = None
                if not is_router_hop and not evict_cached_edge and attempt == 0:
                    pooled_conn = _pop_pooled_media_conn(p)
                    if pooled_conn is not None:
                        try:
                            pooled_conn.request(req_method, req_target, headers=req_headers)
                            resp = pooled_conn.getresponse()
                            conn = pooled_conn
                        except Exception:
                            try:
                                pooled_conn.close()
                            except Exception:
                                pass
                            conn = None
                            resp = None

                if resp is None:
                    conn = _call_connect_media_http(
                        p,
                        connect_timeout=4.5 if is_router_hop else 5.5,
                        read_timeout=25.0,
                    )
                    conn.request(req_method, req_target, headers=req_headers)
                    resp = conn.getresponse()

                if resp.status in (301, 302, 303, 307, 308):
                    loc = resp.getheader("Location") or ""
                    try:
                        resp.close()
                    except Exception:
                        pass
                    conn.close()
                    conn = None
                    if not loc:
                        break
                    cur_url = urllib.parse.urljoin(cur_url, loc)
                    continue

                if resp.status in (200, 206):
                    # Guard against broken CDN edges that ignore non-zero Range requests
                    # and return 200 OK from byte 0 (which resets HTML5 <video> to 0:00).
                    req_rng = req_headers.get("Range") or ""
                    m_req_rng = _RANGE_START_RE.match(req_rng)
                    req_start_byte = int(m_req_rng.group(1)) if m_req_rng else 0
                    resp_ct = (resp.getheader("Content-Type") or "").lower()
                    is_hls_resp = "mpegurl" in resp_ct or (p.path or "").lower().endswith(".m3u8") or ":hls:" in cur_url.lower()
                    if req_start_byte > 0 and resp.status == 200 and not is_hls_resp:
                        try:
                            resp.close()
                        except Exception:
                            pass
                        conn.close()
                        conn = None
                        _evict_voidboost_edge_and_mark_dead(base_url, cur_url)
                        last_exc = RuntimeError(f"Upstream edge ignored Range {req_rng} and returned 200 OK")
                        break
                    setattr(conn, "_velarium_edge_url", cur_url)
                    if cur_url != base_url and _is_voidboost_cdn_host(host_low):
                        with MEDIA_EDGE_LOCK:
                            if len(VOIDBOOST_EDGE_CACHE) > 256:
                                for k_old in list(VOIDBOOST_EDGE_CACHE.keys())[:64]:
                                    VOIDBOOST_EDGE_CACHE.pop(k_old, None)
                            VOIDBOOST_EDGE_CACHE[base_url] = (cur_url, time.time() + 180.0)
                    return conn, resp

                if resp.status == 416:
                    return conn, resp
                try:
                    resp.close()
                except Exception:
                    pass
                conn.close()
                conn = None
                if resp.status >= 500 or resp.status in (403, 404, 429):
                    _evict_voidboost_edge_and_mark_dead(base_url, cur_url)
                last_exc = RuntimeError(f"Upstream status {resp.status}")
                break
        except Exception as err:
            last_exc = err
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
            _evict_voidboost_edge_and_mark_dead(base_url, cur_url)

    raise RuntimeError(f"Unable to open media stream: {last_exc}")


def _rewrite_hls_manifest_for_proxy(raw_text: str, base_url: str) -> str:
    if not raw_text or "#EXTM3U" not in raw_text:
        return raw_text

    verified_origins: Dict[Tuple[str, str], bool] = {}
    uri_cache: Dict[str, str] = {}
    base_parsed = urllib.parse.urlparse(base_url)
    base_origin_key = (base_parsed.scheme.lower(), (base_parsed.netloc or "").lower())
    base_origin_allowed: Optional[bool] = None
    if base_origin_key[0] in ("http", "https") and base_origin_key[1] and "@" not in base_origin_key[1]:
        base_origin_allowed = _check_allowed_media_source_url(base_url, allow_torrserver_loopback=False)
        verified_origins[base_origin_key] = base_origin_allowed
    base_no_q = base_url.split("?", 1)[0].split("#", 1)[0]
    base_dir = (base_no_q.rsplit("/", 1)[0] + "/") if "/" in base_no_q[8:] else ""
    quoted_base_dir = urllib.parse.quote(base_dir, safe="") if base_dir else ""

    def _proxy_target(target_u: str) -> str:
        t = str(target_u or "").strip()
        if not t or t.startswith("/api/proxy-stream"):
            return t
        cached_rw = uri_cache.get(t)
        if cached_rw is not None:
            return cached_rw
        if (
            base_origin_allowed is True
            and quoted_base_dir
            and not t.startswith(("/", "http://", "https://", ".", "?", "#"))
            and "/." not in t
            and "://" not in t
            and not any(ord(c) < 32 or c.isspace() for c in t)
        ):
            rw = f"/api/proxy-stream?url={quoted_base_dir}{urllib.parse.quote(t, safe='')}"
            if len(uri_cache) < 4096:
                uri_cache[t] = rw
            return rw
        abs_u = urllib.parse.urljoin(base_url, t)
        if any(ord(c) < 32 or c.isspace() for c in abs_u):
            return abs_u
        try:
            p = urllib.parse.urlparse(abs_u)
            origin_key = (p.scheme.lower(), (p.netloc or "").lower())
        except Exception:
            origin_key = ("", "")
        if origin_key[0] in ("http", "https") and origin_key[1] and "@" not in origin_key[1]:
            allowed = verified_origins.get(origin_key)
            if allowed is None:
                allowed = _check_allowed_media_source_url(abs_u, allow_torrserver_loopback=False)
                verified_origins[origin_key] = allowed
        else:
            allowed = _check_allowed_media_source_url(abs_u, allow_torrserver_loopback=False)
        rw = f"/api/proxy-stream?url={urllib.parse.quote(abs_u, safe='')}" if allowed else abs_u
        if len(uri_cache) < 4096:
            uri_cache[t] = rw
        return rw

    def _replace_uri_attr(m: re.Match) -> str:
        quote_ch = m.group(1) or '"'
        inner = m.group(2)
        return f'URI={quote_ch}{_proxy_target(inner)}{quote_ch}'

    out_lines: List[str] = []
    for line in raw_text.splitlines():
        s = line.strip()
        if not s:
            out_lines.append(line)
            continue
        if s.startswith("#"):
            if "URI" in s.upper() and _HLS_URI_ATTR_RE.search(s):
                out_lines.append(
                    _HLS_URI_ATTR_RE.sub(_replace_uri_attr, line)
                )
            else:
                out_lines.append(line)
            continue
        out_lines.append(_proxy_target(s))
    return "\n".join(out_lines) + ("\n" if raw_text.endswith("\n") else "")


def serve_offline_video_file(
    handler,
    video_path: str,
    head_only: bool = False,
    download_filename: str = "",
    ctx=None,
) -> None:
    """Delivers an offline video file with byte-range support."""
    if not video_path or not os.path.isfile(video_path):
        handler._send_json({"error": "Offline video not found"}, status=404)
        return
    file_size = os.path.getsize(video_path)
    range_hdr = (handler.headers.get("Range") or "").strip()
    try:
        byte_range = parse_http_byte_range(range_hdr, file_size)
    except ValueError:
        handler.send_response(416)
        handler.send_header("Content-Range", f"bytes */{file_size}")
        handler.send_header("Content-Length", "0")
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.end_headers()
        return

    if byte_range is not None:
        start, end = byte_range
        chunk_len = end - start + 1
        handler.send_response(206)
        handler.send_header("Content-Type", "video/mp4")
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        handler.send_header("Content-Length", str(chunk_len))
    else:
        start, end = 0, max(0, file_size - 1)
        chunk_len = file_size
        handler.send_response(200)
        handler.send_header("Content-Type", "video/mp4")
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Content-Length", str(file_size))

    if download_filename:
        ascii_fb = re.sub(r'[^a-zA-Z0-9._ -]+', "_", download_filename).strip() or "Velarium.mp4"
        utf8_enc = urllib.parse.quote(download_filename, safe="")
        handler.send_header(
            "Content-Disposition",
            f'attachment; filename="{ascii_fb}"; filename*=UTF-8\'\'{utf8_enc}',
        )
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
    handler.end_headers()
    if head_only or chunk_len <= 0:
        return

    _configure_low_latency_socket(getattr(handler, "connection", None), is_client_stream=True)
    try:
        with open(video_path, "rb") as vf:
            vf.seek(start)
            remaining = chunk_len
            while remaining > 0:
                buf = vf.read(min(262144, remaining))
                if not buf:
                    break
                touch_stream_activity()
                handler.wfile.write(buf)
                remaining -= len(buf)
    except (BrokenPipeError, ConnectionResetError):
        pass
    finally:
        try:
            cli_sock = getattr(handler, "connection", None)
            if cli_sock is not None:
                cli_sock.settimeout(handler.timeout)
        except Exception:
            pass


def handle_proxy_stream(handler, qs: Dict[str, Any], parsed, ctx, head_only: bool = False) -> bool:
    """Proxies HLS and media chunks with edge failover."""
    raw_url = qs.get("url", [""])[0].strip()
    clean_url = _unwrap_local_proxy_media_url(raw_url)
    if not _check_allowed_media_source_url(clean_url, allow_torrserver_loopback=False):
        handler._send_json({"error": "Disallowed media stream URL"}, status=400)
        return True
    evict_edge = qs.get("_evict_edge", ["0"])[0].strip().lower() in ("1", "true", "yes")
    raw_range = (handler.headers.get("Range") or "").replace("\r", "").replace("\n", "").strip()
    parsed_stream_url = urllib.parse.urlparse(clean_url)
    parsed_stream_path_lower = (parsed_stream_url.path or "").lower()
    is_likely_hls_url = (
        parsed_stream_path_lower.endswith(".m3u8")
        or ":hls:" in clean_url.lower()
    )
    range_hdr = (
        ""
        if is_likely_hls_url
        else (raw_range if _HTTP_RANGE_RE.fullmatch(raw_range) else "")
    )
    m_single_range = _RANGE_SINGLE_RE.match(range_hdr)
    range_start = int(m_single_range.group(1)) if m_single_range else 0
    range_end_str = m_single_range.group(2) if m_single_range else ""
    conn = None
    upstream = None
    conn_reusable = False
    headers_sent = False
    expected_len = -1
    bytes_forwarded = 0
    _configure_low_latency_socket(getattr(handler, "connection", None), is_client_stream=True)
    try:
        conn, upstream = _open_resilient_media_upstream(
            clean_url,
            range_header=range_hdr,
            method="HEAD" if head_only else "GET",
            evict_cached_edge=evict_edge,
        )
        status_code = upstream.status
        content_type = _safe_media_content_type(upstream.getheader("Content-Type") or "video/mp4")
        raw_cl = (upstream.getheader("Content-Length") or "").replace("\r", "").replace("\n", "").strip()
        content_len = raw_cl if raw_cl.isdigit() else ""
        content_range = (upstream.getheader("Content-Range") or "").replace("\r", "").replace("\n", "").strip()
        accept_ranges = (upstream.getheader("Accept-Ranges") or "bytes").replace("\r", "").replace("\n", "").strip() or "bytes"
        if content_len:
            expected_len = int(content_len)

        is_hls_content = (
            status_code in (200, 206)
            and (
                "mpegurl" in content_type.lower()
                or is_likely_hls_url
            )
        )
        if not is_hls_content and range_start > 0 and status_code == 200:
            _evict_voidboost_edge_and_mark_dead(
                clean_url,
                str(getattr(conn, "_velarium_edge_url", "") or ""),
            )
            handler._send_json(
                {"error": f"Upstream ignored non-zero Range ({range_hdr}) and returned 200 OK"},
                status=502,
            )
            return True
        if (
            not head_only
            and not is_hls_content
            and range_start == 0
            and not range_end_str
            and ".mp4" in parsed_stream_path_lower
            and 0 < expected_len < 300000
        ):
            _evict_voidboost_edge_and_mark_dead(
                clean_url,
                str(getattr(conn, "_velarium_edge_url", "") or ""),
            )
            handler._send_json(
                {"error": f"Upstream returned suspiciously small MP4 stub ({expected_len} bytes)"},
                status=502,
            )
            return True
        is_hls_manifest = not head_only and is_hls_content
        if head_only and is_hls_content:
            status_code = 200
            content_range = ""
            content_len = ""
            if "mpegurl" not in content_type.lower():
                content_type = "application/vnd.apple.mpegurl"
        rewritten_hls_bytes: Optional[bytes] = None
        if is_hls_manifest:
            if expected_len > 2 * 1024 * 1024:
                handler._send_json({"error": "HLS manifest exceeds 2 MB safety limit"}, status=502)
                return True
            raw_m3u8 = upstream.read(2 * 1024 * 1024 + 1)
            if len(raw_m3u8) > 2 * 1024 * 1024:
                handler._send_json({"error": "HLS manifest exceeds 2 MB safety limit"}, status=502)
                return True
            edge_base = str(getattr(conn, "_velarium_edge_url", "") or clean_url)
            rewritten_txt = _rewrite_hls_manifest_for_proxy(
                raw_m3u8.decode("utf-8", errors="replace"),
                edge_base,
            )
            rewritten_hls_bytes = rewritten_txt.encode("utf-8")
            status_code = 200
            content_range = ""
            content_len = str(len(rewritten_hls_bytes))
            expected_len = len(rewritten_hls_bytes)
            if "mpegurl" not in content_type.lower():
                content_type = "application/vnd.apple.mpegurl"

        handler.send_response(status_code)
        handler.send_header("Content-Type", content_type)
        handler.send_header("Accept-Ranges", accept_ranges)
        if content_range:
            handler.send_header("Content-Range", content_range)
        if content_len:
            handler.send_header("Content-Length", content_len)
        elif not head_only:
            handler.send_header("Connection", "close")
            handler.close_connection = True
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.end_headers()
        headers_sent = True

        if head_only:
            conn_reusable = True
        else:
            touch_stream_activity()
            if rewritten_hls_bytes is not None:
                handler.wfile.write(rewritten_hls_bytes)
                bytes_forwarded = len(rewritten_hls_bytes)
                conn_reusable = True
            elif expected_len > 0 and expected_len <= 262144:
                read_fn = getattr(upstream, "read1", None) or upstream.read
                while bytes_forwarded < expected_len:
                    chunk = read_fn(min(131072, expected_len - bytes_forwarded))
                    if not chunk:
                        break
                    bytes_forwarded += len(chunk)
                    touch_stream_activity()
                    handler.wfile.write(chunk)
                if bytes_forwarded == expected_len:
                    conn_reusable = True
            else:
                # 6 MB async RAM read-ahead ring buffer (24 x 256 KB) so VoidBoost CDN is drained
                # continuously at full line speed even when WKWebView pauses between decode bursts.
                proxy_queue: "queue.Queue[Optional[bytes]]" = queue.Queue(maxsize=24)
                stop_proxy = threading.Event()
                conn_box_lock = threading.Lock()
                conn_box: List[Any] = [conn, upstream, False]  # [conn, upstream, pump_completed]

                def _close_conn_box() -> None:
                    with conn_box_lock:
                        c_cur, u_cur = conn_box[0], conn_box[1]
                        conn_box[0] = None
                    if u_cur is not None:
                        try:
                            u_cur.close()
                        except Exception:
                            pass
                    if c_cur is not None:
                        try:
                            c_cur.close()
                        except Exception:
                            pass

                def _pump_proxy_upstream() -> None:
                    resume_attempts = 0
                    max_resume_attempts = 3 if (not is_hls_content and expected_len > 0) else 0
                    pump_bytes_read = 0
                    try:
                        while not stop_proxy.is_set():
                            with conn_box_lock:
                                cur_up = conn_box[1]
                            if cur_up is None:
                                break
                            read_fn = getattr(cur_up, "read1", None) or cur_up.read
                            upstream_dropped = False
                            try:
                                while not stop_proxy.is_set():
                                    if expected_len > 0 and pump_bytes_read >= expected_len:
                                        conn_box[2] = True
                                        break
                                    to_read = 262144
                                    if expected_len > 0:
                                        to_read = min(262144, expected_len - pump_bytes_read)
                                    chunk = read_fn(to_read)
                                    if not chunk:
                                        if expected_len > 0 and pump_bytes_read >= expected_len:
                                            conn_box[2] = True
                                        upstream_dropped = (expected_len > 0 and pump_bytes_read < expected_len)
                                        break
                                    pump_bytes_read += len(chunk)
                                    if expected_len > 0 and pump_bytes_read >= expected_len:
                                        conn_box[2] = True
                                    while not stop_proxy.is_set():
                                        try:
                                            proxy_queue.put(chunk, timeout=0.8)
                                            break
                                        except queue.Full:
                                            continue
                            except Exception:
                                upstream_dropped = (expected_len > 0 and pump_bytes_read < expected_len)

                            if (
                                stop_proxy.is_set()
                                or not upstream_dropped
                                or pump_bytes_read <= 0
                                or resume_attempts >= max_resume_attempts
                            ):
                                break

                            resume_attempts += 1
                            with conn_box_lock:
                                old_edge_u = str(getattr(conn_box[0], "_velarium_edge_url", "") or "")
                            _evict_voidboost_edge_and_mark_dead(clean_url, old_edge_u)
                            _close_conn_box()
                            next_start = range_start + pump_bytes_read
                            if range_end_str:
                                next_end = int(range_end_str)
                            elif expected_len > 0:
                                next_end = range_start + expected_len - 1
                            else:
                                next_end = -1
                            if 0 <= next_end < next_start:
                                break
                            resume_range_hdr = (
                                f"bytes={next_start}-{next_end}"
                                if next_end >= next_start
                                else f"bytes={next_start}-"
                            )
                            try:
                                new_c, new_u = _open_resilient_media_upstream(
                                    clean_url,
                                    range_header=resume_range_hdr,
                                    method="GET",
                                    evict_cached_edge=(resume_attempts > 1),
                                    abort_event=stop_proxy,
                                )
                                with conn_box_lock:
                                    if stop_proxy.is_set():
                                        try:
                                            new_u.close()
                                        except Exception:
                                            pass
                                        try:
                                            new_c.close()
                                        except Exception:
                                            pass
                                        break
                                    conn_box[0] = new_c
                                    conn_box[1] = new_u
                                if new_u.status != 206:
                                    break
                            except Exception:
                                break
                    finally:
                        if stop_proxy.is_set() and not conn_box[2]:
                            _close_conn_box()
                        while not stop_proxy.is_set():
                            try:
                                proxy_queue.put(None, timeout=0.4)
                                break
                            except queue.Full:
                                try:
                                    proxy_queue.get_nowait()
                                except Exception:
                                    break

                pump_future = _PROXY_PUMP_POOL.submit(_pump_proxy_upstream)
                try:
                    while True:
                        try:
                            out_chunk = proxy_queue.get(timeout=45.0)
                        except queue.Empty:
                            break
                        if out_chunk is None:
                            break
                        bytes_forwarded += len(out_chunk)
                        touch_stream_activity()
                        handler.wfile.write(out_chunk)
                finally:
                    stop_proxy.set()
                    if not conn_box[2]:
                        _close_conn_box()
                    while not proxy_queue.empty():
                        try:
                            proxy_queue.get_nowait()
                        except Exception:
                            break
                    try:
                        pump_future.result(timeout=0.3)
                    except Exception:
                        pass
                    with conn_box_lock:
                        conn = conn_box[0]
                        upstream = conn_box[1]
                    if expected_len > 0 and bytes_forwarded == expected_len and conn_box[2]:
                        conn_reusable = True
                    elif pump_future.done():
                        _close_conn_box()
                        conn = None
                    else:
                        conn = None

                if not head_only and expected_len > 0 and bytes_forwarded < expected_len:
                    handler.close_connection = True
                    _evict_voidboost_edge_and_mark_dead(
                        clean_url,
                        str(getattr(conn, "_velarium_edge_url", "") or "") if conn is not None else "",
                    )
    except (BrokenPipeError, ConnectionResetError):
        conn_reusable = False
    except Exception as err:
        conn_reusable = False
        _evict_voidboost_edge_and_mark_dead(
            clean_url,
            str(getattr(conn, "_velarium_edge_url", "") or "") if conn is not None else "",
        )
        if not headers_sent:
            try:
                handler._send_json({"error": str(err)}, status=502)
            except Exception:
                pass
    finally:
        try:
            cli_sock = getattr(handler, "connection", None)
            if cli_sock is not None:
                cli_sock.settimeout(handler.timeout)
        except Exception:
            pass
        if conn is not None:
            _release_or_close_media_conn(conn, upstream, reusable=conn_reusable)
    return True


def handle_download_mp4(handler, qs: Dict[str, Any], parsed, ctx, head_only: bool = False) -> bool:
    """Handles /api/download-mp4 direct file download or ffmpeg remux pipeline."""
    if head_only:
        handler.send_response(200)
        handler.send_header("Content-Type", "video/mp4")
        handler.send_header("Accept-Ranges", "none")
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.end_headers()
        return True

    stream_url = _unwrap_local_proxy_media_url(qs.get("url", [""])[0].strip())
    filename = qs.get("filename", ["Velarium_Video.mp4"])[0]
    profile_manager = ctx.profile_manager
    if profile_manager.is_kids_mode_active():
        raw_dl_title = qs.get("title", [""])[0].strip() or re.sub(r"\.mp4$", "", filename, flags=re.I).strip()
        cand_mp4 = ctx.build_trusted_item_for_kids_check(
            item_id=qs.get("id", [""])[0].strip(),
            title=raw_dl_title,
            orig_title=qs.get("orig_title", [""])[0].strip(),
            media_type=qs.get("media_type", ["movie"])[0].strip(),
        )
        has_trusted_meta = bool(
            cand_mp4.get("genres")
            or cand_mp4.get("description")
            or cand_mp4.get("age_rating")
            or "/cartoons/" in str(cand_mp4.get("rezka_url") or "").lower()
        )
        if not has_trusted_meta or not profile_manager.is_item_kids_safe(cand_mp4):
            handler._send_json({"error": "Restricted in Kids Mode"}, status=403)
            return True
    if not _check_allowed_media_source_url(stream_url, allow_torrserver_loopback=True):
        handler._send_json({"error": "Invalid stream URL"}, status=400)
        return True
    safe_ascii = "".join(
        c if (c.isascii() and (c.isalnum() or c in (" ", "-", "_", ".", "[", "]"))) else "_"
        for c in filename
    ).strip("_ ")
    if not safe_ascii or safe_ascii.lower() == ".mp4":
        safe_ascii = "Velarium_Video.mp4"
    elif not safe_ascii.lower().endswith(".mp4"):
        safe_ascii += ".mp4"
    utf8_quoted = urllib.parse.quote(filename if filename.lower().endswith(".mp4") else filename + ".mp4")
    parsed_dl = urllib.parse.urlparse(stream_url)
    dl_host_low = (parsed_dl.hostname or "").lower()
    dl_path_low = (parsed_dl.path or "").lower()
    force_remux_dl = (
        qs.get("remux", ["0"])[0].strip().lower() in ("1", "true", "yes")
        or dl_host_low in ("127.0.0.1", "localhost", "::1")
        or dl_path_low.endswith((".mkv", ".avi", ".ts", ".m2ts", ".webm", ".m3u8"))
        or ":hls:" in dl_path_low
    )
    remux_engine = ctx.remux_engine
    if force_remux_dl and remux_engine.is_available():
        audio_idx = max(0, ctx.qs_int(qs, "audio", 0))
        vcodec = qs.get("vcodec", [""])[0].strip().lower()
        acodec = qs.get("acodec", [""])[0].strip().lower()
        channels = max(1, ctx.qs_int(qs, "ch", 2))
        cmd = remux_engine.build_remux_command(
            source_url=stream_url,
            audio_index=audio_idx,
            start_sec=0.0,
            video_codec=vcodec,
            channels=channels,
            audio_codec=acodec,
        )
        ff_env_dl = (
            remux_engine.build_ffmpeg_env(stream_url)
            if hasattr(remux_engine, "build_ffmpeg_env")
            else None
        )
        proc = None
        headers_sent = False
        dl_stop = threading.Event()
        setattr(dl_stop, "_is_mp4_download", True)
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=131072,
                env=ff_env_dl,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            with _ACTIVE_REMUX_PROCS_LOCK:
                _ACTIVE_REMUX_PROCS.append((proc, dl_stop))
            dl_q: queue.Queue = queue.Queue(maxsize=48)
            dl_stdout = proc.stdout

            def _pump_mp4_dl(_so=dl_stdout, _q=dl_q, _stop=dl_stop) -> None:
                try:
                    while _so and not _stop.is_set():
                        data_blk = _so.read(131072)
                        if not data_blk:
                            break
                        while not _stop.is_set():
                            try:
                                _q.put(data_blk, timeout=1.0)
                                break
                            except queue.Full:
                                continue
                except Exception:
                    pass
                finally:
                    while not _stop.is_set():
                        try:
                            _q.put(None, timeout=0.5)
                            break
                        except queue.Full:
                            try:
                                _q.get_nowait()
                            except Exception:
                                break

            threading.Thread(target=_pump_mp4_dl, daemon=True, name="VelariumMp4DlPump").start()
            try:
                first_chunk = dl_q.get(timeout=26.0)
            except queue.Empty:
                first_chunk = None
            if not first_chunk:
                dl_stop.set()
                handler._send_json({"error": "FFmpeg produced empty MP4 download"}, status=502)
                return True
            handler.send_response(200)
            handler.send_header("Content-Type", "video/mp4")
            handler.send_header(
                "Content-Disposition",
                f"attachment; filename=\"{safe_ascii}\"; filename*=UTF-8''{utf8_quoted}",
            )
            handler.send_header("Cache-Control", "no-store")
            handler.send_header("Access-Control-Allow-Origin", "*")
            handler.send_header("Connection", "close")
            handler.close_connection = True
            handler.end_headers()
            headers_sent = True
            handler.wfile.write(first_chunk)
            while True:
                try:
                    chunk = dl_q.get(timeout=26.0)
                except queue.Empty:
                    break
                if not chunk:
                    break
                handler.wfile.write(chunk)
            dl_stop.set()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as err:
            if not headers_sent:
                try:
                    handler._send_json({"error": str(err)}, status=502)
                except Exception:
                    pass
        finally:
            dl_stop.set()
            while not dl_q.empty():
                try:
                    dl_q.get_nowait()
                except Exception:
                    break
            if proc:
                with _ACTIVE_REMUX_PROCS_LOCK:
                    _ACTIVE_REMUX_PROCS[:] = [
                        (p, s) for p, s in _ACTIVE_REMUX_PROCS if p is not proc
                    ]
            if proc and proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=1.2)
                except Exception:
                    try:
                        proc.kill()
                        proc.wait(timeout=1.0)
                    except Exception:
                        pass
            if proc and proc.stdout:
                try:
                    proc.stdout.close()
                except Exception:
                    pass
        return True

    headers_sent = False
    dl_conn = None
    try:
        dl_conn, upstream = _open_resilient_media_upstream(stream_url, range_header="", method="GET")
        if upstream.status >= 400:
            handler._send_json({"error": f"Upstream status {upstream.status}"}, status=502)
            return True
        handler.send_response(200)
        handler.send_header("Content-Type", "video/mp4")
        cl = (upstream.getheader("Content-Length") or "").replace("\r", "").replace("\n", "").strip()
        if cl.isdigit():
            handler.send_header("Content-Length", cl)
        else:
            handler.send_header("Connection", "close")
            handler.close_connection = True
        handler.send_header(
            "Content-Disposition",
            f"attachment; filename=\"{safe_ascii}\"; filename*=UTF-8''{utf8_quoted}",
        )
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.end_headers()
        headers_sent = True
        while True:
            chunk = upstream.read(262144)
            if not chunk:
                break
            handler.wfile.write(chunk)
    except (BrokenPipeError, ConnectionResetError):
        pass
    except Exception as err:
        if not headers_sent:
            try:
                handler._send_json({"error": str(err)}, status=502)
            except Exception:
                pass
    finally:
        if dl_conn is not None:
            try:
                dl_conn.close()
            except Exception:
                pass
    return True


def handle_proxy_vtt(handler, qs: Dict[str, Any], parsed, ctx, head_only: bool = False) -> bool:
    """Handles /api/proxy-vtt remote subtitle retrieval and WebVTT conversion."""
    if head_only:
        handler.send_response(200)
        handler.send_header("Content-Type", "text/vtt; charset=utf-8")
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.end_headers()
        return True

    vtt_url = qs.get("url", [""])[0].strip()
    ss_offset = ctx.qs_float(qs, "ss", 0.0) + ctx.qs_float(qs, "offset", 0.0)
    conv_cache_key = (vtt_url, round(ss_offset, 2))
    now_vtt = time.time()
    vtt_body = "WEBVTT\n\n"
    data_bytes: Optional[bytes] = None
    if _check_allowed_media_source_url(vtt_url, allow_torrserver_loopback=False):
        with SUBTITLE_CACHE_LOCK:
            conv_entry = _WEBVTT_CONVERTED_CACHE.get(conv_cache_key)
            if conv_entry and (now_vtt - conv_entry[0]) < 1800.0:
                data_bytes = conv_entry[1]
            raw_cached = SUBTITLE_RAW_CACHE.get(vtt_url) if data_bytes is None else None
        if data_bytes is None and not raw_cached:
            try:
                open_safe = getattr(ctx, "open_safe_public_url", None)
                if open_safe:
                    with open_safe(
                        vtt_url,
                        headers={"User-Agent": StremioAddonEngine.UA},
                        timeout=7.0,
                    ) as r_sub:
                        if r_sub.status == 200:
                            raw_cached = r_sub.read(4 * 1024 * 1024)
            except urllib.error.HTTPError:
                raw_cached = None
            except Exception as url_err:
                raw_cached = None
                err_msg_sub = str(url_err)
                if not any(tok in err_msg_sub for tok in ("Disallowed", "Failed to verify peer IP")):
                    srv = _get_server_module()
                    net_client = getattr(srv, "net_client", None)
                    if net_client:
                        st, raw_bytes_fb, fb_hdrs = net_client.request_bytes(vtt_url, spoof_geo_country="DIRECT", timeout=6)
                        fb_final = str((fb_hdrs or {}).get("_final_url") or vtt_url)
                        if st == 200 and raw_bytes_fb and _check_allowed_media_source_url(fb_final, allow_torrserver_loopback=False):
                            raw_cached = raw_bytes_fb
            if raw_cached:
                with SUBTITLE_CACHE_LOCK:
                    if len(SUBTITLE_RAW_CACHE) >= 64:
                        for k_old in list(SUBTITLE_RAW_CACHE.keys())[:16]:
                            SUBTITLE_RAW_CACHE.pop(k_old, None)
                    SUBTITLE_RAW_CACHE[vtt_url] = raw_cached
        if data_bytes is None and raw_cached:
            vtt_body = convert_any_subtitle_to_webvtt(raw_cached, offset_sec=ss_offset)
            data_bytes = vtt_body.encode("utf-8")
            with SUBTITLE_CACHE_LOCK:
                if len(_WEBVTT_CONVERTED_CACHE) >= 48:
                    for k_old in list(_WEBVTT_CONVERTED_CACHE.keys())[:12]:
                        _WEBVTT_CONVERTED_CACHE.pop(k_old, None)
                _WEBVTT_CONVERTED_CACHE[conv_cache_key] = (now_vtt, data_bytes)
    if data_bytes is None:
        data_bytes = vtt_body.encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "text/vtt; charset=utf-8")
    handler.send_header("Content-Length", str(len(data_bytes)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(data_bytes)
    return True


def handle_remux_stream(handler, qs: Dict[str, Any], parsed, ctx, head_only: bool = False) -> bool:
    """Handles /api/remux-stream zero-copy live FFmpeg remux pipeline."""
    if head_only:
        handler.send_response(200)
        handler.send_header("Content-Type", "video/mp4")
        handler.send_header("Accept-Ranges", "none")
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.end_headers()
        return True

    src_url = qs.get("src", [""])[0].strip()
    audio_idx = max(0, ctx.qs_int(qs, "audio", 0))
    start_sec = max(0.0, ctx.qs_float(qs, "start", 0.0))
    audio_offset_sec = max(-5.0, min(5.0, ctx.qs_float(qs, "ashift", 0.0)))
    vcodec = qs.get("vcodec", [""])[0].strip().lower()
    acodec = qs.get("acodec", [""])[0].strip().lower()
    compat_h264 = qs.get("compat", [""])[0].strip().lower() in ("h264", "1", "true")
    channels = max(1, ctx.qs_int(qs, "ch", 2))
    sub_param = qs.get("sub", [""])[0].strip()
    sub_idx = ctx.qs_int(qs, "sub_idx", -1)
    burn_sub = qs.get("burn_sub", [""])[0].strip().lower() in ("1", "true", "yes") or bool(sub_param or sub_idx >= 0)
    remux_engine = ctx.remux_engine
    if not _check_allowed_media_source_url(src_url, allow_torrserver_loopback=True) or not remux_engine.is_available():
        handler._send_json({"error": "Remux source unavailable"}, status=400)
        return True

    temp_sub_path = ""
    if burn_sub and sub_param:
        try:
            if sub_param.startswith("/api/downloads/sub/"):
                parts = sub_param.strip("/").split("/")
                if len(parts) >= 4:
                    dl_id = parts[3]
                    sub_fn = parts[4] if len(parts) > 4 else "sub.vtt"
                    dl_sub_file = ctx.download_manager.get_subtitle_file_path(dl_id, sub_fn)
                    if dl_sub_file and os.path.isfile(dl_sub_file):
                        try:
                            sub_mtime = os.path.getmtime(dl_sub_file)
                        except OSError:
                            sub_mtime = 0.0
                        with _REMUX_SUB_SRT_LOCK:
                            cached_srt = _REMUX_SUB_SRT_CACHE.get((dl_sub_file, sub_mtime))
                        if cached_srt and os.path.isfile(cached_srt) and os.path.getsize(cached_srt) > 0:
                            temp_sub_path = cached_srt
                        else:
                            with open(dl_sub_file, "rb") as sf:
                                s_bytes = sf.read(8 * 1024 * 1024)
                            sub_hash = hashlib.sha256(s_bytes).hexdigest()[:12]
                            tmp_f = os.path.join(tempfile.gettempdir(), f"velarium_sub_{sub_hash}.srt")
                            if not (os.path.isfile(tmp_f) and os.path.getsize(tmp_f) > 0):
                                from backend.subtitles import decode_subtitle_bytes, convert_vtt_to_srt
                                s_text = decode_subtitle_bytes(s_bytes)
                                if "WEBVTT" in s_text[:128]:
                                    s_text = convert_vtt_to_srt(s_text)
                                tmp_f_atomic = f"{tmp_f}.{os.getpid()}.{threading.get_ident()}.tmp"
                                with open(tmp_f_atomic, "w", encoding="utf-8") as tf:
                                    tf.write(s_text)
                                os.replace(tmp_f_atomic, tmp_f)
                            with _REMUX_SUB_SRT_LOCK:
                                if len(_REMUX_SUB_SRT_CACHE) > 64:
                                    evict_keys = list(_REMUX_SUB_SRT_CACHE.keys())[:16]
                                    for ek in evict_keys:
                                        old_srt = _REMUX_SUB_SRT_CACHE.pop(ek, None)
                                        if old_srt and old_srt != tmp_f:
                                            try:
                                                os.unlink(old_srt)
                                            except OSError:
                                                pass
                                _REMUX_SUB_SRT_CACHE[(dl_sub_file, sub_mtime)] = tmp_f
                            temp_sub_path = tmp_f
            elif sub_param.startswith(("http://", "https://")) or sub_param.startswith("/api/proxy-vtt"):
                real_sub_url = sub_param
                if "/api/proxy-vtt" in real_sub_url:
                    parsed_sub = urllib.parse.urlparse(real_sub_url)
                    sub_qs = urllib.parse.parse_qs(parsed_sub.query)
                    real_sub_url = (sub_qs.get("url") or [real_sub_url])[0]
                url_sub_hash = hashlib.sha256(real_sub_url.encode("utf-8")).hexdigest()[:12]
                url_tmp_f = os.path.join(tempfile.gettempdir(), f"velarium_sub_{url_sub_hash}.srt")
                if os.path.isfile(url_tmp_f) and os.path.getsize(url_tmp_f) > 64:
                    temp_sub_path = url_tmp_f
                elif _check_allowed_media_source_url(real_sub_url, allow_torrserver_loopback=True):
                    from backend.subtitles import decode_subtitle_bytes, convert_vtt_to_srt
                    with _REMUX_SUB_SRT_LOCK:
                        cached_srt_txt = _REMUX_SUB_SRT_CACHE.get(("url_txt", real_sub_url))
                    if isinstance(cached_srt_txt, str) and cached_srt_txt:
                        s_text = cached_srt_txt
                    else:
                        parsed_real_sub = urllib.parse.urlparse(real_sub_url)
                        sub_host = (parsed_real_sub.hostname or "").lower()
                        if sub_host in ("127.0.0.1", "localhost", "::1"):
                            req_sub = urllib.request.Request(real_sub_url, headers={"User-Agent": "Mozilla/5.0"})
                            s_ctx = _LOOPBACK_DIRECT_OPENER.open(req_sub, timeout=4.0)
                        else:
                            s_ctx = ctx.open_safe_public_url(
                                real_sub_url,
                                headers={"User-Agent": "Mozilla/5.0"},
                                timeout=4.0,
                            )
                        with s_ctx as s_resp:
                            s_bytes = s_resp.read(8 * 1024 * 1024)
                        s_text = decode_subtitle_bytes(s_bytes)
                        if "WEBVTT" in s_text[:128]:
                            s_text = convert_vtt_to_srt(s_text)
                        with _REMUX_SUB_SRT_LOCK:
                            if len(_REMUX_SUB_SRT_CACHE) > 64:
                                for ek in list(_REMUX_SUB_SRT_CACHE.keys())[:16]:
                                    _REMUX_SUB_SRT_CACHE.pop(ek, None)
                            _REMUX_SUB_SRT_CACHE[("url_txt", real_sub_url)] = s_text
                    url_tmp_atomic = f"{url_tmp_f}.{os.getpid()}.{threading.get_ident()}.tmp"
                    with open(url_tmp_atomic, "w", encoding="utf-8") as tf:
                        tf.write(s_text)
                    os.replace(url_tmp_atomic, url_tmp_f)
                    with _REMUX_SUB_SRT_LOCK:
                        if url_tmp_f not in _REMUX_TEMP_SUB_FILES:
                            _REMUX_TEMP_SUB_FILES.append(url_tmp_f)
                        if len(_REMUX_TEMP_SUB_FILES) > 24:
                            evict_subs = _REMUX_TEMP_SUB_FILES[:-24]
                            del _REMUX_TEMP_SUB_FILES[:-24]
                        else:
                            evict_subs = []
                    for old_sub_p in evict_subs:
                        if old_sub_p != url_tmp_f:
                            try:
                                os.unlink(old_sub_p)
                            except OSError:
                                pass
                    temp_sub_path = url_tmp_f
        except Exception:
            pass

    proc = None
    headers_sent = False
    stop_reader = threading.Event()
    global _REMUX_GEN_SEQ
    with _ACTIVE_REMUX_PROCS_LOCK:
        _REMUX_GEN_SEQ += 1
        my_remux_gen = _REMUX_GEN_SEQ
    _configure_low_latency_socket(getattr(handler, "connection", None), is_client_stream=True)
    try:
        vcodec_candidates = [vcodec]
        if vcodec and not compat_h264:
            vcodec_candidates.append("")

        first_chunk = None
        chunk_queue: Optional["queue.Queue[Optional[bytes]]"] = None

        for attempt_vcodec in vcodec_candidates:
            with _ACTIVE_REMUX_PROCS_LOCK:
                if _REMUX_GEN_SEQ != my_remux_gen:
                    break
            stop_reader.set()
            stop_reader = threading.Event()
            chunk_queue = queue.Queue(maxsize=48)
            cmd = remux_engine.build_remux_command(
                source_url=src_url,
                audio_index=audio_idx,
                start_sec=start_sec,
                video_codec=attempt_vcodec,
                channels=channels,
                audio_codec=acodec,
                force_h264=compat_h264 or burn_sub,
                audio_offset_sec=audio_offset_sec,
                subtitles_file=temp_sub_path,
                subtitle_index=sub_idx if sub_idx >= 0 else None,
            )
            attempt_t0 = time.time()
            ff_env_rmx = (
                remux_engine.build_ffmpeg_env(src_url)
                if hasattr(remux_engine, "build_ffmpeg_env")
                else None
            )
            procs_to_terminate = []
            with _ACTIVE_REMUX_PROCS_LOCK:
                if _REMUX_GEN_SEQ != my_remux_gen:
                    break
                kept_dl_procs = []
                for prev_p, prev_stop in list(_ACTIVE_REMUX_PROCS):
                    if getattr(prev_stop, "_is_mp4_download", False):
                        if prev_p.poll() is None and not prev_stop.is_set():
                            kept_dl_procs.append((prev_p, prev_stop))
                        continue
                    prev_stop.set()
                    procs_to_terminate.append(prev_p)
                _ACTIVE_REMUX_PROCS[:] = kept_dl_procs

            for prev_p in procs_to_terminate:
                if prev_p.poll() is None:
                    try:
                        prev_p.terminate()
                    except Exception:
                        pass
                if prev_p.stdout:
                    try:
                        prev_p.stdout.close()
                    except Exception:
                        pass
                try:
                    _REMUX_CLEANUP_POOL.submit(_terminate_and_reap_proc, prev_p)
                except Exception:
                    pass

            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=65536,
                env=ff_env_rmx,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            with _ACTIVE_REMUX_PROCS_LOCK:
                if _REMUX_GEN_SEQ != my_remux_gen:
                    try:
                        proc.terminate()
                    except Exception:
                        pass
                    break
                _ACTIVE_REMUX_PROCS.append((proc, stop_reader))
            active_stdout = proc.stdout
            read_out = getattr(active_stdout, "read1", None) or (active_stdout.read if active_stdout else None)

            def _pump_ffmpeg_stdout(_ro=read_out, _q=chunk_queue, _stop=stop_reader) -> None:
                try:
                    while _ro and not _stop.is_set():
                        buf = _ro(65536)
                        if not buf:
                            break
                        while not _stop.is_set():
                            try:
                                _q.put(buf, timeout=1.0)
                                break
                            except queue.Full:
                                continue
                except Exception:
                    pass
                finally:
                    while not _stop.is_set():
                        try:
                            _q.put(None, timeout=0.5)
                            break
                        except queue.Full:
                            try:
                                _q.get_nowait()
                            except Exception:
                                break

            threading.Thread(target=_pump_ffmpeg_stdout, daemon=True, name="VelariumFFmpegPump").start()
            first_chunk = None
            wait_deadline = time.time() + 32.0
            while time.time() < wait_deadline and not stop_reader.is_set():
                try:
                    first_chunk = chunk_queue.get(timeout=0.5)
                    break
                except queue.Empty:
                    if proc and proc.poll() is not None and chunk_queue.empty():
                        break

            if first_chunk:
                break

            stop_reader.set()
            with _ACTIVE_REMUX_PROCS_LOCK:
                _ACTIVE_REMUX_PROCS[:] = [(p, s) for p, s in _ACTIVE_REMUX_PROCS if p is not proc]
            if proc and proc.stdout:
                try:
                    proc.stdout.close()
                except Exception:
                    pass
            if proc and proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=0.8)
                except Exception:
                    try:
                        proc.kill()
                        proc.wait(timeout=0.8)
                    except Exception:
                        pass
            proc = None
            if (time.time() - attempt_t0) > 3.5:
                break

        if not first_chunk:
            handler._send_json({"error": "FFmpeg produced empty stream"}, status=502)
            return True

        handler.send_response(200)
        handler.send_header("Content-Type", "video/mp4")
        handler.send_header("Accept-Ranges", "none")
        handler.send_header("Cache-Control", "no-store")
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Connection", "close")
        handler.close_connection = True
        handler.end_headers()
        headers_sent = True
        touch_stream_activity()
        local_last_chunk_ts = time.time()
        handler.wfile.write(first_chunk)
        while not stop_reader.is_set():
            try:
                chunk = chunk_queue.get(timeout=1.0)
            except queue.Empty:
                if proc and proc.poll() is not None and chunk_queue.empty():
                    break
                if time.time() - local_last_chunk_ts > 90.0:
                    break
                continue
            if not chunk:
                break
            handler.wfile.write(chunk)
            local_last_chunk_ts = time.time()
            touch_stream_activity()
    except (BrokenPipeError, ConnectionResetError):
        pass
    except Exception as err:
        if not headers_sent:
            try:
                handler._send_json({"error": str(err)}, status=502)
            except Exception:
                pass
    finally:
        stop_reader.set()
        while not chunk_queue.empty():
            try:
                chunk_queue.get_nowait()
            except Exception:
                break
        if proc:
            with _ACTIVE_REMUX_PROCS_LOCK:
                _ACTIVE_REMUX_PROCS[:] = [(p, s) for p, s in _ACTIVE_REMUX_PROCS if p is not proc]
            if proc.stdout:
                try:
                    proc.stdout.close()
                except Exception:
                    pass
            if proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=0.8)
                except Exception:
                    try:
                        proc.kill()
                        proc.wait(timeout=0.6)
                    except Exception:
                        pass
    return True


def handle_video_snapshot(handler, qs: Dict[str, Any], parsed, ctx, head_only: bool = False) -> bool:
    """Handles /api/video-snapshot frame capture."""
    if head_only:
        handler.send_response(200)
        handler.send_header("Content-Type", "image/png")
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.end_headers()
        return True

    raw_snap_url = _unwrap_local_proxy_media_url(qs.get("url", [""])[0].strip())
    ts_sec = max(0.0, ctx.qs_float(qs, "ss", 0.0))
    local_dl_file = ""
    snap_parsed = urllib.parse.urlparse(raw_snap_url)
    snap_path = (snap_parsed.path or "").strip()
    profile_manager = ctx.profile_manager
    download_manager = ctx.download_manager
    if snap_path.startswith("/api/downloads/stream/"):
        dl_id = snap_path[len("/api/downloads/stream/") :].strip("/")
        if profile_manager.is_kids_mode_active() and not download_manager.is_download_allowed(
            dl_id,
            kids_mode=True,
            active_profile_id=profile_manager.get_active_profile_id(),
        ):
            handler._send_json({"error": "Restricted in Kids Mode"}, status=403)
            return True
        cand_file = download_manager.get_video_file_path(dl_id)
        if not cand_file or not os.path.isfile(cand_file):
            handler._send_json({"error": "Offline video file not found"}, status=404)
            return True
        local_dl_file = cand_file
        src_url = ""
    else:
        if not _check_allowed_media_source_url(raw_snap_url, allow_torrserver_loopback=True):
            handler._send_json({"error": "Disallowed video snapshot URL"}, status=400)
            return True
        src_url = (
            _wrap_voidboost_stream_url(raw_snap_url, absolute_loopback=True)
            if _is_voidboost_cdn_host(snap_parsed.hostname or "")
            else raw_snap_url
        )
    png_bytes = ctx.remux_engine.capture_frame_png(
        src_url,
        timestamp_sec=ts_sec,
        local_file_path=local_dl_file,
    )
    if not png_bytes:
        handler._send_json({"error": "Failed to capture video frame"}, status=502)
        return True
    handler.send_response(200)
    handler.send_header("Content-Type", "image/png")
    handler.send_header("Content-Length", str(len(png_bytes)))
    handler.send_header("Cache-Control", "private, max-age=300")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(png_bytes)
    return True


def handle_downloads_stream(handler, qs: Dict[str, Any], parsed, ctx, head_only: bool = False) -> bool:
    """Handles /api/downloads/stream/<did> Range-streaming."""
    path = parsed.path
    did = urllib.parse.unquote(path[len("/api/downloads/stream/") :]).strip("/")
    download_manager = ctx.download_manager
    profile_manager = ctx.profile_manager
    if not download_manager.is_download_allowed(
        did,
        kids_mode=profile_manager.is_kids_mode_active(),
        active_profile_id=profile_manager.get_active_profile_id(),
    ):
        handler._send_json({"error": "Restricted in Kids Mode"}, status=403)
        return True
    vpath = download_manager.get_video_file_path(did)
    want_dl = qs.get("download", ["0"])[0].strip().lower() in ("1", "true", "yes")
    dl_fname = download_manager.get_download_export_filename(did) if want_dl else ""
    serve_offline_video_file(handler, vpath or "", head_only=head_only, download_filename=dl_fname, ctx=ctx)
    return True


def handle_downloads_sub(handler, qs: Dict[str, Any], parsed, ctx, head_only: bool = False) -> bool:
    """Handles /api/downloads/sub/<did>/<sub_id>."""
    path = parsed.path
    rem = urllib.parse.unquote(path[len("/api/downloads/sub/") :]).strip("/")
    parts_sub = rem.split("/", 1)
    if len(parts_sub) != 2:
        handler._send_json({"error": "Invalid subtitle path"}, status=400)
        return True
    download_manager = ctx.download_manager
    profile_manager = ctx.profile_manager
    if not download_manager.is_download_allowed(
        parts_sub[0],
        kids_mode=profile_manager.is_kids_mode_active(),
        active_profile_id=profile_manager.get_active_profile_id(),
    ):
        handler._send_json({"error": "Restricted in Kids Mode"}, status=403)
        return True
    spath = download_manager.get_subtitle_file_path(parts_sub[0], parts_sub[1])
    if not spath or not os.path.isfile(spath):
        handler._send_json({"error": "Subtitle not found"}, status=404)
        return True
    file_size = os.path.getsize(spath)
    handler.send_response(200)
    handler.send_header("Content-Type", "text/vtt; charset=utf-8")
    handler.send_header("Content-Length", str(file_size))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    if not head_only:
        with open(spath, "rb") as sf:
            vtt_bytes = sf.read()
        handler.wfile.write(vtt_bytes)
    return True


def handle_downloads_poster(handler, qs: Dict[str, Any], parsed, ctx, head_only: bool = False) -> bool:
    """Handles /api/downloads/poster/<did>."""
    path = parsed.path
    did = urllib.parse.unquote(path[len("/api/downloads/poster/") :]).strip("/")
    download_manager = ctx.download_manager
    profile_manager = ctx.profile_manager
    if not download_manager.is_download_allowed(
        did,
        kids_mode=profile_manager.is_kids_mode_active(),
        active_profile_id=profile_manager.get_active_profile_id(),
    ):
        handler._send_json({"error": "Restricted in Kids Mode"}, status=403)
        return True
    ppath = download_manager.get_poster_file_path(did)
    if not ppath or not os.path.isfile(ppath):
        handler._send_json({"error": "Poster not found"}, status=404)
        return True
    try:
        st = os.stat(ppath)
        file_size = st.st_size
        etag = f'"{int(st.st_mtime):x}-{file_size:x}"'
    except OSError:
        file_size = os.path.getsize(ppath)
        etag = ""

    if etag and hasattr(handler, "headers") and handler.headers is not None:
        inm = (handler.headers.get("If-None-Match") or "").strip()
        if inm and (etag in [x.strip() for x in inm.split(",")] or inm == "*"):
            handler.send_response(304)
            handler.send_header("ETag", etag)
            handler.send_header("Cache-Control", "public, max-age=86400")
            handler.send_header("Access-Control-Allow-Origin", "*")
            handler.end_headers()
            return True

    if head_only:
        try:
            with open(ppath, "rb") as pf:
                head_bytes = pf.read(16)
        except Exception:
            head_bytes = b""
        p_ctype = _sniff_raster_image_type(head_bytes) or "image/jpeg"
        handler.send_response(200)
        handler.send_header("Content-Type", p_ctype)
        handler.send_header("Content-Length", str(file_size))
        if etag:
            handler.send_header("ETag", etag)
        handler.send_header("Cache-Control", "public, max-age=86400")
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.end_headers()
        return True

    with open(ppath, "rb") as pf:
        img_bytes = pf.read()
    ctype = _sniff_raster_image_type(img_bytes[:16]) or "image/jpeg"
    handler.send_response(200)
    handler.send_header("Content-Type", ctype)
    handler.send_header("Content-Length", str(len(img_bytes)))
    if etag:
        handler.send_header("ETag", etag)
    handler.send_header("Cache-Control", "public, max-age=86400")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(img_bytes)
    return True


STREAMING_EXACT_ROUTES = {
    "/api/proxy-stream": handle_proxy_stream,
    "/api/download-mp4": handle_download_mp4,
    "/api/proxy-vtt": handle_proxy_vtt,
    "/api/remux-stream": handle_remux_stream,
    "/api/video-snapshot": handle_video_snapshot,
}

STREAMING_PREFIX_ROUTES = (
    ("/api/downloads/stream/", handle_downloads_stream),
    ("/api/downloads/sub/", handle_downloads_sub),
    ("/api/downloads/poster/", handle_downloads_poster),
)


def dispatch_streaming_route(
    handler,
    path: str,
    qs: Dict[str, Any],
    parsed,
    ctx,
    head_only: bool = False,
) -> bool:
    """
    Attempts to dispatch streaming, proxy and remuxing routes.
    Returns True if handled, False otherwise.
    """
    route_handler = STREAMING_EXACT_ROUTES.get(path)
    if route_handler:
        res = route_handler(handler, qs, parsed, ctx, head_only=head_only)
        return True if res is None else bool(res)

    for prefix, p_handler in STREAMING_PREFIX_ROUTES:
        if path.startswith(prefix):
            res = p_handler(handler, qs, parsed, ctx, head_only=head_only)
            return True if res is None else bool(res)

    return False
