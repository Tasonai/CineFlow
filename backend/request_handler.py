"""
Velarium Cinema Request Handler
Encapsulates HTTP request dispatching, security headers, CORS/Origin validation,
DNS-rebinding protection, JSON parsing, and static file serving for Velarium.
"""

import gzip
import ipaddress
import json
import os
import socket
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from backend.routes import (
    GET_ROUTES,
    dispatch_get_route,
    dispatch_post_route,
    dispatch_streaming_route,
    handle_proxy_stream,
    serve_offline_video_file,
)
from backend.routes.static_files import (
    load_cached_static_file,
    resolve_safe_public_static_path,
)


def _compute_own_mdns_hostname() -> str:
    """Computes the local machine's mDNS *.local hostname."""
    try:
        hn = (socket.gethostname() or "").strip().lower().rstrip(".")
        if hn:
            return hn if hn.endswith(".local") else f"{hn}.local"
    except Exception:
        pass
    return ""


_CACHED_OWN_MDNS_HOSTNAME = _compute_own_mdns_hostname()


class CinemaRequestHandler(BaseHTTPRequestHandler):
    """
    Main HTTP request handler for Velarium.
    Implements:
    - DNS rebinding prevention (_is_allowed_host_header)
    - Anti-CSRF Origin and CORS validation (_is_trusted_origin)
    - Content-Length body limits for JSON APIs and backup import
    - Gzip content negotiation for large JSON payloads
    - Route dispatching to backend.routes table
    - Kids PIN and LAN remote key authentication checks
    """
    disable_nagle_algorithm = True
    protocol_version = "HTTP/1.1"
    timeout = 4.0
    MAX_JSON_BODY_BYTES = 524288  # 512 KB default JSON POST limit
    MAX_IMPORT_BODY_BYTES = 10485760  # 10 MB for /api/backup/import

    _context_getter: Optional[Callable[[], Any]] = None
    _static_file_server: Optional[Callable[..., None]] = None
    _safe_log_fn: Optional[Callable[[str, bool], None]] = None
    public_dir: str = ""

    @classmethod
    def set_dependencies(
        cls,
        context_getter: Optional[Callable[[], Any]] = None,
        static_file_server: Optional[Callable[..., None]] = None,
        safe_log_fn: Optional[Callable[[str, bool], None]] = None,
        public_dir: str = "",
    ) -> None:
        cls._context_getter = staticmethod(context_getter) if context_getter else None
        cls._static_file_server = staticmethod(static_file_server) if static_file_server else None
        cls._safe_log_fn = staticmethod(safe_log_fn) if safe_log_fn else None
        if public_dir:
            cls.public_dir = public_dir

    def setup(self):
        super().setup()
        try:
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except Exception:
            pass

    def _get_parsed_url_and_qs(self) -> Tuple[urllib.parse.ParseResult, Dict[str, Any]]:
        raw_path = self.path
        if getattr(self, "_cached_raw_path", None) == raw_path:
            return self._cached_parsed_url, self._cached_qs
        parsed = urllib.parse.urlparse(raw_path)
        qs = urllib.parse.parse_qs(parsed.query)
        self._cached_raw_path = raw_path
        self._cached_parsed_url = parsed
        self._cached_qs = qs
        return parsed, qs

    def log_message(self, format, *args):
        is_daemon_mode = ("--launchd" in sys.argv) and not bool(
            os.environ.get("VELARIUM_VERBOSE_LOG") or os.environ.get("CINEFLOW_VERBOSE_LOG")
        )
        if is_daemon_mode or "/api/proxy-stream" in self.path or "/api/remote/" in self.path:
            return
        # Log path only: query strings may carry pairing keys (?k=), PINs, or URLs
        parsed, _ = self._get_parsed_url_and_qs()
        safe_path = parsed.path
        log_line = f"[Velarium] {self.command} {safe_path}\n"
        log_fn = getattr(type(self), "_safe_log_fn", None)
        if log_fn is not None:
            log_fn(log_line, False)
            return
        srv = sys.modules.get("server") or sys.modules.get("__main__")
        if srv is not None and hasattr(srv, "_safe_log"):
            srv._safe_log(log_line, False)
        else:
            try:
                sys.stdout.write(log_line)
                sys.stdout.flush()
            except Exception:
                pass

    @property
    def server_context(self) -> Any:
        """Returns the server context for route dispatching."""
        getter = getattr(type(self), "_context_getter", None)
        if getter is not None:
            return getter()
        if hasattr(self.server, "server_context") and self.server.server_context:
            return self.server.server_context
        srv = sys.modules.get("server") or sys.modules.get("__main__")
        if srv is not None and hasattr(srv, "SERVER_CONTEXT"):
            return srv.SERVER_CONTEXT
        return None

    def _server_ports(self) -> Set[int]:
        ctx = self.server_context
        runtime = getattr(ctx, "server_runtime", None) if ctx else None
        port = int((runtime.get("port") if runtime else None) or 8765)
        ports = {port}
        try:
            ports.add(int(self.server.server_address[1]))
        except Exception:
            pass
        return ports

    def _current_lan_hosts(self) -> Set[str]:
        hosts = set()
        ctx = self.server_context
        runtime = getattr(ctx, "server_runtime", None) if ctx else None
        bound = runtime.get("lan_bound_ip") if runtime else None
        if bound:
            hosts.add(str(bound).strip().lower())
        else:
            detect_fn = getattr(ctx, "detect_lan_ipv4", None) if ctx else None
            if detect_fn:
                try:
                    det = detect_fn()
                    if det:
                        hosts.add(str(det).strip().lower())
                except Exception:
                    pass
        return hosts

    @staticmethod
    def _extract_host_only(raw_host_hdr: str) -> str:
        raw = urllib.parse.unquote((raw_host_hdr or "").strip().lower())
        if not raw:
            return ""
        if raw.startswith("["):
            host_only = raw[1:].split("]", 1)[0]
        elif raw.count(":") == 1:
            host_only = raw.split(":", 1)[0]
        else:
            host_only = raw
        if "%" in host_only:
            host_only = host_only.split("%", 1)[0]
        return host_only.rstrip(".")

    @staticmethod
    def _own_mdns_hostname() -> str:
        return _CACHED_OWN_MDNS_HOSTNAME

    def _is_allowed_host_header(self) -> bool:
        """
        DNS-rebinding guard: only accept requests addressed to loopback, an IP literal
        (LAN clients open http://<lan-ip>:port) or this machine's own mDNS *.local name.
        Arbitrary DNS names (rebind.attacker.tld) are rejected.
        """
        host_only = self._extract_host_only(self.headers.get("Host") or "")
        if not host_only:
            return True
        own_mdns = self._own_mdns_hostname()
        if host_only in ("127.0.0.1", "localhost", "::1") or (own_mdns and host_only == own_mdns):
            return True
        try:
            ipaddress.ip_address(host_only)
            return True
        except ValueError:
            return False

    def _reject_bad_host(self) -> bool:
        if self._is_allowed_host_header():
            return False
        body = b'{"ok":false,"error":"Forbidden host"}'
        try:
            self.send_response(403)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass
        return True

    def _is_trusted_origin(self) -> bool:
        sfs = (self.headers.get("Sec-Fetch-Site") or "").strip().lower()
        if sfs == "cross-site":
            return False
        origin = (self.headers.get("Origin") or "").strip()
        if not origin:
            return True
        if origin.lower() == "null":
            return False
        try:
            parsed = urllib.parse.urlparse(origin)
            scheme = parsed.scheme.lower()
            if scheme not in ("http", "https", "app", "capacitor", "ionic"):
                return False
            host = urllib.parse.unquote((parsed.hostname or "").strip().lower().strip("[]")).rstrip(".")
            if "%" in host:
                host = host.split("%", 1)[0]
            if not host:
                # Native wrappers (app:// / capacitor:// / ionic://) have no network host
                return scheme in ("app", "capacitor", "ionic")
            try:
                origin_port = parsed.port or (443 if scheme == "https" else 80)
            except ValueError:
                return False
            if origin_port not in self._server_ports():
                # Pages served by other local/LAN web servers (router UI, printers, dev servers)
                # must never be able to drive this API with the user's privileges.
                return False
            own_mdns = self._own_mdns_hostname()
            if host in ("127.0.0.1", "localhost", "::1") or (own_mdns and host == own_mdns):
                return True
            ip_obj = ipaddress.ip_address(host)
            if getattr(ip_obj, "ipv4_mapped", None) is not None:
                ip_obj = ip_obj.ipv4_mapped
            if ip_obj.is_loopback:
                return True
            if host in self._current_lan_hosts():
                return True
            req_host = self._extract_host_only(self.headers.get("Host") or "")
            if (ip_obj.is_private or ip_obj.is_link_local) and (not req_host or host == req_host):
                return True
            return False
        except Exception:
            return False

    def _get_cors_origin_header(self) -> Optional[str]:
        origin = (self.headers.get("Origin") or "").strip()
        if not origin:
            ctx = self.server_context
            runtime = getattr(ctx, "server_runtime", None) if ctx else None
            port = int((runtime.get("port") if runtime else None) or 8765)
            return f"http://127.0.0.1:{port}"
        if self._is_trusted_origin():
            return origin
        return None

    def _send_security_headers(self, allow_media_cors: bool = False) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "no-referrer")
        if allow_media_cors:
            self.send_header("Access-Control-Allow-Origin", "*")
        else:
            cors_origin = self._get_cors_origin_header()
            if cors_origin:
                self.send_header("Access-Control-Allow-Origin", cors_origin)
                self.send_header("Vary", "Origin")

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        use_gzip = False
        if self.command != "HEAD" and len(body) > 4096:
            accept_enc = self.headers.get("Accept-Encoding") or ""
            if "gzip" in accept_enc.lower():
                body = gzip.compress(body, compresslevel=5)
                use_gzip = True
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._send_security_headers(allow_media_cors=False)
            if use_gzip:
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Vary", "Accept-Encoding")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Keep-Alive", "timeout=4, max=100")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers",
                "Content-Type, X-Velarium-Pin, X-Velarium-Key, X-Velarium-Intent, X-CineFlow-Pin, X-CineFlow-Key, X-CineFlow-Intent",
            )
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    @staticmethod
    def _resolve_safe_public_static_path(rel_path: str) -> Tuple[str, bool]:
        pdir = CinemaRequestHandler.public_dir
        if not pdir:
            srv = sys.modules.get("server")
            pdir = getattr(srv, "PUBLIC_DIR", "")
        return resolve_safe_public_static_path(rel_path, pdir)

    @staticmethod
    def _load_static_file_bytes(file_path: str) -> bytes:
        srv = sys.modules.get("server")
        if srv is not None and hasattr(srv, "_load_cached_static_file"):
            raw, _ = srv._load_cached_static_file(file_path, can_gzip=False)
            return raw
        raw, _ = load_cached_static_file(file_path, can_gzip=False)
        return raw

    def _read_json_body(self, max_bytes: Optional[int] = None) -> Optional[dict]:
        limit = max_bytes if max_bytes is not None else self.MAX_JSON_BODY_BYTES
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except (ValueError, TypeError):
            length = 0
        if length <= 0:
            return {}
        if length > limit:
            return None
        try:
            raw = self.rfile.read(length).decode("utf-8", errors="replace")
            parsed_obj = json.loads(raw)
            return parsed_obj if isinstance(parsed_obj, dict) else {}
        except Exception:
            return {}

    def do_OPTIONS(self):
        if self._reject_bad_host():
            return
        try:
            if not self._is_trusted_origin():
                self.send_response(403)
                self._send_security_headers(allow_media_cors=False)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(204)
            self._send_security_headers(allow_media_cors=False)
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers",
                "Content-Type, X-Velarium-Pin, X-Velarium-Key, X-Velarium-Intent, X-CineFlow-Pin, X-CineFlow-Key, X-CineFlow-Intent",
            )
            self.end_headers()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _handle_proxy_stream(self, qs: dict, head_only: bool = False) -> None:
        parsed, _ = self._get_parsed_url_and_qs()
        handle_proxy_stream(
            self,
            qs,
            parsed,
            self.server_context,
            head_only=head_only,
        )

    def _serve_offline_video_file(
        self,
        video_path: str,
        head_only: bool = False,
        download_filename: str = "",
    ) -> None:
        serve_offline_video_file(
            self,
            video_path,
            head_only=head_only,
            download_filename=download_filename,
            ctx=self.server_context,
        )

    def _serve_static_file(self, path: str, parsed: Any, head_only: bool = False) -> None:
        srv_fn = getattr(type(self), "_static_file_server", None) or getattr(type(self), "static_file_server", None)
        if srv_fn is not None:
            srv_fn(self, path, parsed, head_only=head_only)
            return
        srv = sys.modules.get("server")
        if srv is not None and hasattr(srv, "_serve_static_file_unified"):
            srv._serve_static_file_unified(self, path, parsed, head_only=head_only)

    def do_HEAD(self):
        if self._reject_bad_host():
            return
        parsed, qs = self._get_parsed_url_and_qs()
        path = parsed.path
        if (
            path.startswith("/api/")
            and path not in ("/api/proxy-stream", "/api/proxy-vtt")
            and not path.startswith("/api/downloads/")
            and self.headers.get("Origin")
            and not self._is_trusted_origin()
        ):
            self._send_json({"error": "Forbidden cross-origin request"}, status=403)
            return
        if dispatch_streaming_route(self, path, qs, parsed, self.server_context, head_only=True):
            return
        if path == "/api/backup/export":
            if not self._require_authorized_client_if_lan():
                return
            if not self._require_kids_pin_if_locked(qs.get("pin", [""])[0].strip()):
                return
        elif path == "/api/remote/commands":
            if not self._is_loopback_client():
                self._send_json({"ok": False, "error": "Loopback only"}, status=403)
                return
        elif path in ("/api/remote/state", "/api/remote/catalog"):
            broker = getattr(self.server_context, "remote_broker", None)
            if not self._is_loopback_client() and (
                broker and not broker.verify_key(qs.get("k", [""])[0].strip())
            ):
                self._send_json({"ok": False, "error": "Unauthorized remote key"}, status=403)
                return
        if path.startswith("/api/"):
            known_get_apis = {
                "/api/catalog",
                "/api/search",
                "/api/hdrezka/streams",
                "/api/hdrezka/check-watching-updates",
                "/api/trailer",
                "/api/person",
                "/api/person-photo",
                "/api/kinorium/avatar",
                "/api/title-meta",
                "/api/provider-link",
                "/api/download-mp4",
                "/api/proxy-vtt",
                "/api/skip-intro",
                "/api/backup-streams",
                "/api/stremio/addons",
                "/api/stremio/streams",
                "/api/remux-probe",
                "/api/remux-stream",
                "/api/remux-subtitle",
                "/api/video-snapshot",
                "/api/kinorium/live-digest",
                "/api/kinorium/one-click-status",
                "/api/integrations",
                "/api/kinorium/stats",
                "/api/backup/export",
                "/api/settings",
                "/api/system/status",
                "/api/system/update/status",
                "/api/system/update/check",
                "/api/profiles",
                "/api/downloads",
                "/api/downloads/prefs",
                "/api/tv/devices",
                "/api/tv/deep-link",
                "/api/subtitles/search",
                "/api/subtitles/translate",
                "/api/calendar",
                "/api/remote/pairing",
                "/api/remote/state",
                "/api/remote/commands",
                "/api/remote/catalog",
            }
            if path in GET_ROUTES or path in known_get_apis:
                head_media_types = {
                    "/api/remux-stream": "video/mp4",
                    "/api/download-mp4": "video/mp4",
                    "/api/remux-subtitle": "text/vtt; charset=utf-8",
                    "/api/proxy-vtt": "text/vtt; charset=utf-8",
                    "/api/video-snapshot": "image/png",
                }
                if path in head_media_types:
                    self.send_response(200)
                    self.send_header("Content-Type", head_media_types[path])
                    if path in ("/api/remux-stream", "/api/download-mp4"):
                        self.send_header("Accept-Ranges", "none")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    self.end_headers()
                else:
                    self._send_json({"ok": True}, status=200)
            else:
                self._send_json({"error": "Not found"}, status=404)
            return

        self._serve_static_file(path, parsed, head_only=True)

    def _is_loopback_client(self) -> bool:
        try:
            addr = str((self.client_address or ("", 0))[0] or "").strip().lower()
        except Exception:
            return False
        if addr not in ("127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"):
            return False
        host_only = self._extract_host_only(self.headers.get("Host") or "")
        if host_only and host_only not in ("127.0.0.1", "localhost", "::1"):
            return False
        return True

    def _require_authorized_client_if_lan(
        self,
        body: Optional[dict] = None,
        lang: Optional[str] = None,
    ) -> bool:
        if self._is_loopback_client():
            return True
        _, parsed_q = self._get_parsed_url_and_qs()
        k_val = str(
            (body or {}).get("k")
            or (parsed_q.get("k", [""])[0])
            or self.headers.get("X-Velarium-Key")
            or self.headers.get("X-CineFlow-Key")
            or ""
        ).strip()
        broker = getattr(self.server_context, "remote_broker", None)
        if broker and broker.verify_key(k_val):
            return True
        msg_fn = getattr(self.server_context, "msg", lambda ru, en, l=None: ru)
        self._send_json(
            {
                "ok": False,
                "error": msg_fn(
                    "Это действие доступно только на основном компьютере или с авторизованного пульта",
                    "This action is only allowed on the host computer or from a paired remote",
                    lang,
                ),
            },
            status=403,
        )
        return False

    def _require_kids_pin_if_locked(
        self,
        pin_value: str = "",
        action_ru: str = "Для изменения настроек введите 4-значный PIN-код детского профиля",
        action_en: str = "Enter the 4-digit Kids profile PIN to change settings",
        lang: Optional[str] = None,
    ) -> bool:
        pm = getattr(self.server_context, "profile_manager", None)
        msg_fn = getattr(self.server_context, "msg", lambda ru, en, l=None: ru)
        pin_clean = str(
            pin_value
            or self.headers.get("X-Velarium-Pin")
            or self.headers.get("X-CineFlow-Pin")
            or ""
        ).strip()
        if pm and pm.is_active_kids_pin_locked() and not pm.verify_active_kids_pin(pin_clean):
            lock_rem = pm.get_pin_lockout_remaining()
            if lock_rem > 0:
                sec = int(lock_rem) + 1
                self._send_json(
                    {
                        "ok": False,
                        "pin_required": True,
                        "pin_locked_out": True,
                        "locked_seconds": sec,
                        "error": msg_fn(
                            f"Слишком много неверных попыток PIN-кода — подождите {sec} секунд",
                            f"Too many failed PIN attempts — please wait {sec} seconds",
                            lang,
                        ),
                    },
                    status=429,
                )
                return False
            self._send_json(
                {
                    "ok": False,
                    "pin_required": True,
                    "error": msg_fn(action_ru, action_en, lang),
                },
                status=403,
            )
            return False
        return True

    def do_GET(self):
        srv = sys.modules.get("server")
        if srv is not None and hasattr(srv, "LAST_STREAM_ACTIVITY_TS"):
            pass
        if self._reject_bad_host():
            return
        parsed, qs = self._get_parsed_url_and_qs()
        path = parsed.path

        if path.startswith("/api/") and self.headers.get("Origin") and not self._is_trusted_origin():
            self._send_json({"ok": False, "error": "Forbidden cross-origin request"}, status=403)
            return

        if dispatch_get_route(self, path, qs, parsed, self.server_context):
            return

        if dispatch_streaming_route(self, path, qs, parsed, self.server_context, head_only=False):
            return

        if path.startswith("/api/"):
            self._send_json({"error": "Not found"}, status=404)
            return

        self._serve_static_file(path, parsed, head_only=False)

    def do_POST(self):
        if self._reject_bad_host():
            return
        parsed, qs = self._get_parsed_url_and_qs()
        path = parsed.path
        if self.headers.get("Origin") and not self._is_trusted_origin():
            self._send_json({"ok": False, "error": "Forbidden cross-origin request"}, status=403)
            return
        max_body = self.MAX_IMPORT_BODY_BYTES if path == "/api/backup/import" else self.MAX_JSON_BODY_BYTES
        body = self._read_json_body(max_bytes=max_body)
        if body is None:
            msg_fn = getattr(self.server_context, "msg", lambda ru, en, l=None: ru)
            self._send_json(
                {
                    "ok": False,
                    "error": msg_fn(
                        "Слишком большой размер запроса (Payload Too Large)",
                        "Request payload too large",
                    ),
                },
                status=413,
            )
            return

        if dispatch_post_route(self, path, qs, parsed, body, self.server_context):
            return

        self._send_json({"error": "Not found"}, status=404)
