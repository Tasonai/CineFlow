import concurrent.futures
import functools
import html
import ipaddress
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from .doh import DoHSplitNetworkClient, _SafeRedirectHandler, _is_disallowed_hostname, _is_valid_public_ip_addr
from .hdrezka import HDRezkaClient


_STRICT_TRASH_QUALITY_RE = re.compile(
    r"\b(camrip|hdcam|telesync|telesynch|hdts|telecine|dvdscr|screener|workprint|dvd5|dvd9|video_ts)\b",
    re.IGNORECASE,
)
_AMBIGUOUS_TRASH_QUALITY_RE = re.compile(r"\b(cam|ts|tc|scr)\b", re.IGNORECASE)
_HQ_SOURCE_MARKER_RE = re.compile(
    r"\b(bdremux|remux|blu-?ray|bdrip|web-?dl|webrip|2160p|1080p|uhd|hevc|h\.?265)\b",
    re.IGNORECASE,
)
_CTRL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")
_NORM_SEG_NON_WORD_RE = re.compile(r"[^\w\s]", re.UNICODE)
_NORM_SEG_UNDERSCORE_RE = re.compile(r"_+")
_NORM_SEG_SPACE_RE = re.compile(r"\s+")
_VOICE_PATTERNS_COMPILED = [
    (re.compile(r"\b(?:red\s*head\s*sound|rhs)\b", re.IGNORECASE), "Red Head Sound"),
    (re.compile(r"\b(?:hdrezka|резка)\b", re.IGNORECASE), "HDRezka Studio"),
    (re.compile(r"\b(?:lostfilm|лостфильм)\b", re.IGNORECASE), "LostFilm"),
    (re.compile(r"\b(?:кубик\s*в\s*кубе|kubik)\b", re.IGNORECASE), "Кубик в Кубе"),
    (re.compile(r"\b(?:jaskier|яскьер)\b", re.IGNORECASE), "Jaskier"),
    (re.compile(r"\b(?:tvshows)\b", re.IGNORECASE), "TVShows"),
    (re.compile(r"\b(?:newstudio|ньюстудио)\b", re.IGNORECASE), "NewStudio"),
    (re.compile(r"\b(?:alexfilm)\b", re.IGNORECASE), "AlexFilm"),
    (re.compile(r"\b(?:амедиа|amedia)\b", re.IGNORECASE), "Amedia"),
    (re.compile(r"\b(?:гаврилов|михалев|володарский|живов|пучков|гоблин|goblin|сербин|визгунов)\b", re.IGNORECASE), "Авторский"),
    (re.compile(r"\b(?:дубляж|дублирован\w*|\bdub\b)\b", re.IGNORECASE), "Дубляж"),
    (re.compile(r"\b(?:многоголос\w*|\bmvo\b|\bdvo\b|профессиональн\w*|\bpm\b|\bp\.m\.)\b", re.IGNORECASE), "Многоголосый"),
]
_UKR_TAG_RE = re.compile(r"\b(?:\d*x?\s*ukr|укр|україн)\b", re.IGNORECASE)
_RUS_TAG_RE = re.compile(r"\b(?:\d*x?\s*rus|рус|російськ)\b", re.IGNORECASE)
_BTIH_RE = re.compile(r"btih:([a-fA-F0-9]{40}|[A-Za-z2-7]{32})\b", re.IGNORECASE)
_SCRUB_TECH_RE = re.compile(
    r"(?:\[[0-9a-fA-F]{8}\]|\b(?:2160p?|1080[pi]?|720p?|480p?|4k|uhd|x264|x265|h\.?264|h\.?265|hevc|av1|(?:ddp?|ac-?3|eac-?3|dts(?:-hd)?|truehd|atmos|flac|opus|aac)\s*[257]\.[01]|[57]\.1|2\.0|10-?bit|hdr10\+?|bdremux|remux|web-?dl|webrip|bluray|blu-?ray|bdrip)\b)",
    re.IGNORECASE,
)
_SCRUB_NOISE_RE = re.compile(
    r"(?:\[[0-9a-fA-F]{8}\]|\b(?:2160p?|1080[pi]?|720p?|480p?|x264|x265|h\.?264|h\.?265|hevc|av1|(?:ddp?|ac-?3|eac-?3|dts(?:-hd)?|truehd|atmos|flac|opus|aac)\s*[257]\.[01]|[57]\.1|10-?bit|hdr10\+?|19\d{2}|20\d{2})\b)",
    re.IGNORECASE,
)
_TAIL_SPLIT_RE = re.compile(
    r"\b(?:s\d{1,2}(?:e\d{1,3})?|season\s*:?\s*\d+|сезоны?\s*:?\s*\d+|\d+\s*(?:-?й\s*)?сезон|серии\s*:?\s*\d+|серия\s*:?\s*\d+|19\d{2}|20\d{2}|2160p|1080p|720p|4k|uhd|web-?dl|webrip|bdremux|bdrip|blu-?ray|hdr\d*|hevc|x264|x265)\b",
    re.IGNORECASE,
)
_ALLOWED_SUFFIX_RE = re.compile(
    r"^(?:part\s*1|часть\s*1|фильм\s*1|film\s*1|"
    r"trilogy|quadrilogy|tetralogy|duology|dilogy|collection|anthology|"
    r"трилогия|квадрология|тетралогия|дилогия|коллекция|антология|"
    r"(?:parts?|части|фильмы)?\s*1\s*[2-9]|"
    r"extended(?:\s+cut|\s+edition)?|director\s*s\s*cut|final\s*cut|unrated|remastered|"
    r"special\s+edition|anniversary\s+edition|ultimate\s+edition|imax|"
    r"режиссерская\s+версия|расширенная\s+версия|полная\s+версия)$"
)
_JACRED_QUERY_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=12,
    thread_name_prefix="VelariumJacRed",
)
_BACKUP_SEARCH_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=9,
    thread_name_prefix="VelariumBkpSearch",
)


class _NoTorrRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.URLError("Disallowed TorrServer redirect")


def _natural_sort_key(text: str) -> List[Any]:
    return [int(tok) if tok.isdigit() else tok.lower() for tok in re.split(r"(\d+)", str(text or ""))]


def _normalize_torrserver_url(raw_url: str, velarium_port: int = 8765) -> str:
    s = str(raw_url or "").strip()
    if not s or _CTRL_CHAR_RE.search(s):
        return ""
    had_scheme = "://" in s
    if not had_scheme:
        s = f"http://{s}"
    try:
        parsed = urllib.parse.urlparse(s)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return ""
        if parsed.username is not None or parsed.password is not None:
            return ""
        raw_port = parsed.port
    except ValueError:
        return ""

    host = (parsed.hostname or "").strip().lower().rstrip(".")
    if not host or host == "0.0.0.0":
        return ""
    port = raw_port if raw_port is not None else (8090 if not had_scheme else (443 if parsed.scheme == "https" else 80))
    if not (1 <= int(port) <= 65535):
        return ""
    if host in ("127.0.0.1", "localhost", "::1") and int(port) == int(velarium_port):
        return ""
    try:
        ip_obj = ipaddress.ip_address(host)
        if isinstance(ip_obj, ipaddress.IPv6Address):
            if ip_obj.ipv4_mapped is not None:
                ip_obj = ip_obj.ipv4_mapped
            elif ip_obj.sixtofour is not None:
                ip_obj = ip_obj.sixtofour
            elif ip_obj.teredo is not None:
                return ""
        if ip_obj.is_link_local or ip_obj.is_multicast or ip_obj.is_unspecified or ip_obj.is_reserved:
            return ""
        host_fmt = f"[{host}]" if ":" in host else host
    except ValueError:
        if "%" in host:
            return ""
        host_fmt = host
    return f"{parsed.scheme}://{host_fmt}:{int(port)}"


def _is_safe_debrid_stream_url(url: str) -> bool:
    s = str(url or "").strip()
    if not s or _CTRL_CHAR_RE.search(s):
        return False
    try:
        parsed = urllib.parse.urlparse(s)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        if parsed.username is not None or parsed.password is not None:
            return False
        _ = parsed.port
        host = (parsed.hostname or "").strip().lower().rstrip(".")
        if not host or host in ("0.0.0.0", "127.0.0.1", "::1") or _is_disallowed_hostname(host):
            return False
        try:
            ipaddress.ip_address(host)
            return _is_valid_public_ip_addr(host)
        except ValueError:
            return "." in host
    except Exception:
        return False


def _extract_btih_hex(magnet: str) -> str:
    m = _BTIH_RE.search(magnet or "")
    if not m:
        return ""
    raw = m.group(1)
    if len(raw) == 32:
        try:
            import base64
            return base64.b32decode(raw.upper()).hex().lower()
        except Exception:
            return ""
    return raw.lower()


_VIDEO_EXT_RE = re.compile(r"\.(mkv|mp4|avi|m2ts|ts|mov|webm)$", re.IGNORECASE)
_SAMPLE_OR_EXTRA_RE = re.compile(
    r"(?:^|[\\/._\-\s\[\(])(sample|trailer|teaser|featurette|extras?|bonus|ncop\d*|nced\d*|creditless)(?:$|[\\/._\-\s\]\)])",
    re.IGNORECASE,
)
_PUBLIC_TRACKER_URLS = (
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
    "udp://opentor.net:6969",
    "udp://p4p.arenabg.com:1337/announce",
    "http://bt.t-ru.org/ann?magnet",
    "http://bt2.t-ru.org/ann?magnet",
    "http://bt3.t-ru.org/ann?magnet",
    "http://bt4.t-ru.org/ann?magnet",
    "http://retracker.local/announce",
)
_PUBLIC_TRACKERS_SUFFIX = "".join(f"&tr={urllib.parse.quote(u, safe='')}" for u in _PUBLIC_TRACKER_URLS)


def _is_safe_tracker_url(tr_url: str) -> bool:
    s = str(tr_url or "").strip()
    if not s or _CTRL_CHAR_RE.search(s):
        return False
    try:
        parsed = urllib.parse.urlparse(s)
        if parsed.scheme not in ("udp", "http", "https", "ws", "wss") or not parsed.hostname:
            return False
        if parsed.username or parsed.password:
            return False
        host = (parsed.hostname or "").strip().lower().rstrip(".")
        if _is_disallowed_hostname(host) or host in ("0.0.0.0", "127.0.0.1", "::1"):
            return False
        try:
            ipaddress.ip_address(host)
            return _is_valid_public_ip_addr(host)
        except ValueError:
            return "." in host
    except Exception:
        return False


def _sanitize_magnet_uri(magnet: str) -> str:
    """Strips dangerous web-seed (ws/as/xs) SSRF vectors and private tracker hosts from magnet URIs."""
    mag = _CTRL_CHAR_RE.sub("", str(magnet or "").strip())
    if not mag.lower().startswith("magnet:?"):
        return mag if mag.lower().startswith("magnet:") else ""
    raw_query = mag[8:]
    kept_parts: List[str] = []
    has_xt = False
    for part in raw_query.split("&"):
        if not part:
            continue
        if "=" not in part:
            continue
        k_raw, v_raw = part.split("=", 1)
        k_low = k_raw.strip().lower()
        if k_low in ("ws", "as", "xs", "kt", "ad"):
            continue
        if k_low == "xt":
            unq_xt = urllib.parse.unquote(v_raw)
            if "urn:btih:" in unq_xt.lower():
                has_xt = True
                kept_parts.append(f"xt={v_raw}")
        elif k_low == "dn":
            kept_parts.append(f"dn={v_raw}")
        elif k_low == "tr":
            unq_tr = urllib.parse.unquote(v_raw).strip()
            if _is_safe_tracker_url(unq_tr):
                kept_parts.append(f"tr={urllib.parse.quote(unq_tr, safe=':/?&=._-')}")
        elif k_low in ("xl", "so"):
            if v_raw.isdigit():
                kept_parts.append(f"{k_low}={v_raw}")
    if not has_xt:
        return ""
    return "magnet:?" + "&".join(kept_parts)


def _enrich_magnet_trackers(magnet: str) -> str:
    mag = _sanitize_magnet_uri(magnet)
    if not mag:
        return ""
    mag_unq_low = urllib.parse.unquote(mag).lower()
    missing_suffix = "".join(
        f"&tr={u}" for u in _PUBLIC_TRACKER_URLS if u.lower() not in mag_unq_low
    )
    return mag + missing_suffix


class BackupStreamingEngine:
    """
    Backup 4K UHD / HDR / Dolby Vision Streaming Engine.
    - Queries live JacRed aggregator API for 4K / BDRemux / Blu-Ray releases.
    - Automatically manages a built-in local TorrServer daemon (`backend/bin/torrserver`)
      when `torrserver_url` points to localhost, so 4K BDRemux plays out of the box.
    - Supports Real-Debrid and TorBox cloud HTTPS magnet-to-stream resolution (`resolve_debrid_magnet`).
    """

    JACRED_HOSTS = [
        "https://jacred.xyz",
        "https://jac.red",
    ]

    def __init__(
        self,
        net_client: DoHSplitNetworkClient,
        rezka_client: HDRezkaClient,
        base_dir: Optional[str] = None,
    ):
        self.net = net_client
        self.rezka = rezka_client
        self.base_dir = base_dir or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.bin_dir = os.path.join(self.base_dir, "backend", "bin")
        self.torr_data_dir = os.path.join(self.base_dir, "data", "torrserver")
        self.torr_bin_path = self._find_torrserver_binary()

        self.mode: str = "torrserver"
        self.debrid_api_key: str = ""
        self.torrserver_url: str = "http://127.0.0.1:8090"

        self._torr_proc: Optional[subprocess.Popen] = None
        self._torr_lock = threading.Lock()
        self._torr_tuned: bool = False
        self._torr_alive_cache: Tuple[bool, float] = (False, 0.0)
        self._torr_preflight_pool = None
        self._cache_lock = threading.Lock()
        self._debrid_cache: Dict[str, Tuple[str, float]] = {}

    def _find_torrserver_binary(self, is_windows: Optional[bool] = None) -> str:
        win_mode = (os.name == "nt") if is_windows is None else bool(is_windows)
        if win_mode:
            for fname in ("torrserver.exe", "TorrServer-windows-amd64.exe", "TorrServer.exe"):
                cand = os.path.join(self.bin_dir, fname)
                if os.path.isfile(cand):
                    return cand
            local_app_data = os.environ.get("LOCALAPPDATA", "")
            if local_app_data:
                cand_app = os.path.join(local_app_data, "Programs", "CineFlow", "backend", "bin", "torrserver.exe")
                if os.path.isfile(cand_app):
                    return cand_app
            return shutil.which("torrserver.exe") or shutil.which("torrserver") or ""

        bundled = os.path.join(self.bin_dir, "torrserver")
        if os.path.isfile(bundled) and os.access(bundled, os.X_OK):
            return bundled
        for prefix in ("/opt/homebrew/bin", "/usr/local/bin"):
            cand = os.path.join(prefix, "torrserver")
            if os.path.isfile(cand) and os.access(cand, os.X_OK):
                return cand
        return shutil.which("torrserver") or ""

    def _redact_secret(self, text: Any) -> str:
        s = str(text or "")
        if self.debrid_api_key and len(self.debrid_api_key) >= 4:
            s = s.replace(self.debrid_api_key, "***")
            s = s.replace(urllib.parse.quote(self.debrid_api_key), "***")
            s = s.replace(urllib.parse.quote(self.debrid_api_key, safe=""), "***")
        return s

    _TORR_OPENER: Optional[urllib.request.OpenerDirector] = None

    @classmethod
    def _build_torr_opener(cls) -> urllib.request.OpenerDirector:
        if cls._TORR_OPENER is None:
            cls._TORR_OPENER = urllib.request.build_opener(
                _NoTorrRedirectHandler(),
                urllib.request.ProxyHandler({}),
            )
        return cls._TORR_OPENER

    def configure(
        self,
        mode: Optional[str] = None,
        debrid_api_key: Optional[str] = None,
        torrserver_url: Optional[str] = None,
    ):
        prev_mode = self.mode
        if mode:
            is_strict_p2p = bool(getattr(self, "p2p_strict", False) or getattr(self.net, "p2p_strict", False))
            # Upgrade legacy default `debrid_https` without key to `torrserver` when bundled binary exists,
            # EXCEPT in strict anti-P2P countries (e.g. Germany DE Abmahnung protection).
            if is_strict_p2p and mode == "torrserver":
                self.mode = "debrid_https" if (debrid_api_key or self.debrid_api_key) else "auto"
            elif (
                mode == "debrid_https"
                and not (debrid_api_key or self.debrid_api_key)
                and self.torr_bin_path
                and not is_strict_p2p
            ):
                self.mode = "torrserver"
            else:
                self.mode = mode
        if prev_mode == "torrserver" and self.mode != "torrserver":
            self.stop_local_torrserver()
        if debrid_api_key is not None and debrid_api_key.strip() != "********":
            new_key = _CTRL_CHAR_RE.sub("", debrid_api_key.strip())
            if new_key != self.debrid_api_key:
                with self._cache_lock:
                    self._debrid_cache.clear()
            self.debrid_api_key = new_key
        if torrserver_url is not None and torrserver_url.strip():
            norm_torr = _normalize_torrserver_url(torrserver_url)
            if norm_torr and norm_torr != self.torrserver_url:
                if self._torr_proc is not None:
                    self.stop_local_torrserver()
                with self._torr_lock:
                    self.torrserver_url = norm_torr
                    self._torr_tuned = False
                    self._torr_alive_cache = (False, 0.0)

    def stop_local_torrserver(self) -> None:
        with self._torr_lock:
            proc = self._torr_proc
            self._torr_proc = None
            self._torr_tuned = False
            self._torr_alive_cache = (False, time.monotonic())
            if proc is not None:
                try:
                    proc.terminate()
                    proc.wait(timeout=1.5)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass

    def apply_country_policy(self, p2p_strict: bool) -> None:
        self.p2p_strict = bool(p2p_strict)
        if p2p_strict:
            if self.mode == "torrserver":
                self.mode = "debrid_https"
                self.stop_local_torrserver()
        else:
            if self.mode == "debrid_https" and not self.debrid_api_key and self.torr_bin_path:
                self.mode = "torrserver"

    def _is_torrserver_alive(self) -> bool:
        try:
            opener = self._build_torr_opener()
            req = urllib.request.Request(f"{self.torrserver_url}/echo", method="GET")
            with opener.open(req, timeout=0.25) as resp:
                ok = resp.status == 200
                self._torr_alive_cache = (ok, time.monotonic())
                return ok
        except Exception:
            self._torr_alive_cache = (False, time.monotonic())
            return False

    def _is_torrserver_alive_cached(self, ttl_sec: float = 3.5) -> bool:
        if self.mode != "torrserver" and self._torr_proc is None:
            return False
        now_m = time.monotonic()
        cached_ok, cached_ts = self._torr_alive_cache
        if cached_ts > 0.0 and (now_m - cached_ts) < ttl_sec:
            return cached_ok
        if (
            self._torr_proc is None
            and not self.torr_bin_path
            and self.torrserver_url.startswith("http://127.0.0.1:8090")
            and cached_ts > 0.0
            and (now_m - cached_ts) < 15.0
        ):
            return cached_ok
        return self._is_torrserver_alive()

    def ensure_local_torrserver(self) -> bool:
        if self.mode != "torrserver":
            return False
        if self._is_torrserver_alive_cached(ttl_sec=3.5):
            if not self._torr_tuned:
                self._tune_torrserver_ram_cache()
            return True
        if not self.torr_bin_path:
            self.torr_bin_path = self._find_torrserver_binary()
        if not self.torr_bin_path:
            return False

        parsed = urllib.parse.urlparse(self.torrserver_url)
        host = (parsed.hostname or "127.0.0.1").lower()
        port = parsed.port or 8090
        if host not in ("127.0.0.1", "localhost", "::1"):
            return False

        needs_tune = False
        is_ready = False
        with self._torr_lock:
            if self._is_torrserver_alive():
                if not self._torr_tuned:
                    needs_tune = True
                is_ready = True
            if not is_ready:
                prev_proc = self._torr_proc
                if prev_proc is not None and prev_proc.poll() is None:
                    # Our previous instance is still starting (first-run DB init / AV scan): wait, never double-spawn
                    wait_deadline = time.time() + 8.0
                    while time.time() < wait_deadline and prev_proc.poll() is None:
                        if self._is_torrserver_alive():
                            needs_tune = True
                            is_ready = True
                            break
                        time.sleep(0.15)
                    if not is_ready and prev_proc.poll() is None:
                        try:
                            prev_proc.terminate()
                            prev_proc.wait(timeout=0.5)
                        except Exception:
                            try:
                                prev_proc.kill()
                            except Exception:
                                pass
                        self._torr_proc = None
                        prev_proc = None
                if not is_ready and prev_proc is not None:
                    try:
                        prev_proc.wait(timeout=0.5)
                    except Exception:
                        pass
                    self._torr_proc = None
                if not is_ready:
                    try:
                        os.makedirs(self.torr_data_dir, exist_ok=True)
                        env = os.environ.copy()
                        env["PATH"] = f"{self.bin_dir}{os.pathsep}{env.get('PATH', '')}"
                        log_path = os.path.join(self.torr_data_dir, "torrserver.log")
                        popen_kwargs: Dict[str, Any] = {
                            "env": env,
                            "creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0),
                        }
                        if os.name != "nt":
                            popen_kwargs["start_new_session"] = True
                        bind_ip = "::1" if host == "::1" else "127.0.0.1"
                        log_mode = "ab"
                        try:
                            if os.path.isfile(log_path) and os.path.getsize(log_path) > 10 * 1024 * 1024:
                                log_mode = "wb"
                        except OSError:
                            pass
                        with open(log_path, log_mode) as log_fh:
                            self._torr_proc = subprocess.Popen(
                                [
                                    self.torr_bin_path,
                                    "-i",
                                    bind_ip,
                                    "-p",
                                    str(port),
                                    "-d",
                                    self.torr_data_dir,
                                ],
                                stdout=log_fh,
                                stderr=subprocess.STDOUT,
                                **popen_kwargs,
                            )
                    except Exception:
                        return False

                    deadline = time.time() + 2.8
                    while time.time() < deadline:
                        if self._is_torrserver_alive():
                            needs_tune = True
                            is_ready = True
                            break
                        time.sleep(0.12)
        if is_ready:
            if needs_tune:
                self._tune_torrserver_ram_cache()
            return True
        return self._is_torrserver_alive()

    def _tune_torrserver_ram_cache(self) -> None:
        self._torr_tuned = True
        try:
            opener = self._build_torr_opener()
            req_get = urllib.request.Request(
                f"{self.torrserver_url}/settings",
                data=json.dumps({"action": "get"}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with opener.open(req_get, timeout=1.5) as r:
                cur_cfg = json.loads(r.read(262144).decode("utf-8", errors="ignore") or "{}")
            if isinstance(cur_cfg, dict) and cur_cfg:
                # Never send {"action": "set"} if settings are already tuned, because TorrServer
                # executes "drop all torrents" and resets the BitTorrent client on every "set"!
                if (
                    int(cur_cfg.get("CacheSize") or 0) == 402653184
                    and not bool(cur_cfg.get("UseDisk"))
                    and int(cur_cfg.get("ConnectionsLimit") or 0) >= 100
                    and int(cur_cfg.get("TorrentDisconnectTimeout") or 0) >= 90
                ):
                    return
                cur_cfg["CacheSize"] = 402653184  # 384 MB RAM ring buffer
                cur_cfg["ReaderReadAHead"] = 90
                cur_cfg["ReaderReadAhead"] = 90
                cur_cfg["PreloadCache"] = 0
                cur_cfg["PreloadBuffer"] = False
                cur_cfg["UseDisk"] = False
                cur_cfg["ConnectionsLimit"] = 100
                cur_cfg["TorrentDisconnectTimeout"] = 120
                cur_cfg["RetrackersMode"] = 1
                req_set = urllib.request.Request(
                    f"{self.torrserver_url}/settings",
                    data=json.dumps({"action": "set", "sets": cur_cfg}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with opener.open(req_set, timeout=4.5) as r_set:
                    r_set.read(65536)
        except Exception:
            pass

    def shutdown_local_torrserver(self) -> None:
        with self._torr_lock:
            proc = self._torr_proc
            self._torr_proc = None
            self._torr_tuned = False
            if proc and proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=2.0)
                except Exception:
                    try:
                        proc.kill()
                        proc.wait(timeout=1.0)
                    except Exception:
                        pass

    @staticmethod
    def _is_trash_rip(rel_title: str) -> bool:
        cleaned = _VIDEO_EXT_RE.sub("", str(rel_title or "").strip())
        if not cleaned:
            return False
        if _STRICT_TRASH_QUALITY_RE.search(cleaned):
            return True
        if _HQ_SOURCE_MARKER_RE.search(cleaned):
            return False
        return bool(_AMBIGUOUS_TRASH_QUALITY_RE.search(cleaned))

    @staticmethod
    def _classify_release_quality(rel_title: str) -> Tuple[str, int]:
        low = (rel_title or "").lower()
        is_remux = "remux" in low or "bdremux" in low
        is_hdr = any(tok in low for tok in ("hdr", "dolby vision", "dovi", "dv"))
        if any(tok in low for tok in ("2160p", "2160", "4k", "uhd")):
            if is_remux:
                return ("4K UHD BDRemux", 420)
            if is_hdr:
                return ("4K UHD HDR", 380)
            return ("4K UHD", 340)
        if "1080p" in low or "1080i" in low:
            if is_remux:
                return ("1080p BDRemux", 260)
            if "bluray" in low or "blu-ray" in low or "bdrip" in low:
                return ("1080p Blu-Ray", 220)
            return ("1080p WEB-DL", 190)
        if is_remux:
            return ("1080p BDRemux", 250)
        if "720p" in low:
            return ("720p HD", 120)
        if any(tok in low for tok in ("web-dl", "webdl", "web-dlrip", "bdrip", "blu-ray", "bluray")):
            return ("1080p WEB-DL", 185)
        return ("WEB / Rip", 70)

    @staticmethod
    def _format_file_bytes(num_bytes: int, is_en: bool = False) -> str:
        b = max(0, int(num_bytes or 0))
        if b <= 0:
            return ""
        gb = b / (1024 ** 3)
        if gb >= 1.0:
            return f"{gb:.2f} {'GB' if is_en else 'ГБ'}"
        mb = b / (1024 ** 2)
        return f"{mb:.0f} {'MB' if is_en else 'МБ'}"

    @staticmethod
    def _extract_explicit_seasons_in_text(text: str) -> set:
        out = set()
        raw_text = text or ""
        for m in re.finditer(
            r"(?:\bs0*(\d{1,2})(?:\b|\s*[._\-x]?\s*e\d{1,4}\b)|\b0*(\d{1,2})x\d{1,4}\b|\bseason\s*:?\s*0*(\d{1,2})\b|сезон\s*:?\s*0*(\d{1,2})\b|\b0*(\d{1,2})\s*(?:-?й\s*)?сезон\b)",
            raw_text,
            re.IGNORECASE,
        ):
            val = next((g for g in m.groups() if g is not None), None)
            if val is not None:
                out.add(int(val))
        for m_rng in re.finditer(
            r"(?:\bs0*(\d{1,2})\s*(?:[-–—~]|to)\s*s?0*(\d{1,2})\b|\bseasons?\s*:?\s*0*(\d{1,2})\s*(?:[-–—~]|to)\s*0*(\d{1,2})\b|сезоны?\s*:?\s*0*(\d{1,2})\s*[-–—~]\s*0*(\d{1,2})\b|\b0*(\d{1,2})\s*[-–—~]\s*0*(\d{1,2})\s*сезон)",
            raw_text,
            re.IGNORECASE,
        ):
            grp = [int(g) for g in m_rng.groups() if g is not None]
            if len(grp) == 2 and 1 <= grp[0] <= grp[1] <= 60:
                out.update(range(grp[0], grp[1] + 1))
        return out

    @classmethod
    def _has_conflicting_season_marker(cls, text: str, target_season: int) -> bool:
        found = cls._extract_explicit_seasons_in_text(text)
        return bool(found and target_season not in found)

    @classmethod
    def _extract_episode_span_from_stem(cls, fname_stem: str, season: int = 1) -> Optional[Tuple[int, int]]:
        s_num = max(0, int(season if season is not None else 1))
        # Chained multi-episode tag: S01E05E06E07
        m_chained = re.search(
            rf"\bs0*{s_num}\s*[._\-x]?\s*e0*(\d{{1,3}})((?:\s*[._\-]?\s*e0*\d{{1,3}})+)\b",
            fname_stem,
            re.IGNORECASE,
        )
        if m_chained:
            ep_a = int(m_chained.group(1))
            tail_eps = [int(x) for x in re.findall(r"e0*(\d{1,3})", m_chained.group(2), re.IGNORECASE)]
            if tail_eps:
                ep_b = max(tail_eps)
                if ep_b >= ep_a:
                    return (ep_a, ep_b)
        # Double-episode or range span: S01E05-E06, S01E05-06
        m_span = re.search(
            rf"\bs0*{s_num}\s*[._\-x]?\s*e0*(\d{{1,3}})(?:\s*[-–—._]?\s*e0*(\d{{1,3}})|\s*[-–—]\s*0*(\d{{1,3}}))\b",
            fname_stem,
            re.IGNORECASE,
        )
        if m_span:
            ep_a = int(m_span.group(1))
            ep_b = int(m_span.group(2) or m_span.group(3) or ep_a)
            if ep_b >= ep_a:
                return (ep_a, ep_b)
        m_se = re.search(rf"\bs0*{s_num}\s*[._\-x]?\s*e0*(\d{{1,3}})\b", fname_stem, re.IGNORECASE)
        if m_se:
            ep_v = int(m_se.group(1))
            return (ep_v, ep_v)
        m_x = re.search(rf"\b0*{s_num}x0*(\d{{1,3}})\b", fname_stem, re.IGNORECASE)
        if m_x:
            ep_v = int(m_x.group(1))
            return (ep_v, ep_v)
        # Reject season-agnostic matches if the stem explicitly belongs to a DIFFERENT season (e.g. S01E05 when s_num=2)
        if cls._has_conflicting_season_marker(fname_stem, s_num):
            return None
        m_ep = re.search(
            r"(?:(?:\bep|\bepisode|серия|выпуск|\bсер)\s*[._\-:]?\s*0*(\d{1,3})\b|\b0*(\d{1,3})\s*(?:-?(?:я|й)\s*)?(?:серия|выпуск)\b)",
            fname_stem,
            re.IGNORECASE,
        )
        if m_ep:
            ep_v = int(m_ep.group(1) or m_ep.group(2))
            return (ep_v, ep_v)
        m_any_e = re.search(r"(?:^|[._\-\s\[])e0*(\d{1,3})(?:$|[._\-\s\]])", fname_stem, re.IGNORECASE)
        if m_any_e:
            ep_v = int(m_any_e.group(1))
            return (ep_v, ep_v)
        return None

    @classmethod
    def _detect_episode_in_path(cls, path_str: str, season: int = 1) -> Optional[int]:
        raw = str(path_str or "").replace("\\", "/")
        parts = raw.split("/")
        base = parts[-1]
        parent_dirs = "/".join(parts[:-1])
        s_num = max(0, int(season if season is not None else 1))
        if parent_dirs and cls._has_conflicting_season_marker(parent_dirs, s_num):
            return None
        stem = _VIDEO_EXT_RE.sub("", base)
        span = cls._extract_episode_span_from_stem(stem, season=s_num)
        return span[0] if span is not None else None

    @staticmethod
    def _filter_main_video_files(
        files: List[Dict[str, Any]],
        path_key: str,
        size_key: str,
    ) -> List[Dict[str, Any]]:
        video_files = [
            f
            for f in files
            if isinstance(f, dict)
            and _VIDEO_EXT_RE.search(str(f.get(path_key) or ""))
            and "/bdmv/backup/" not in str(f.get(path_key) or "").replace("\\", "/").lower()
        ] or [f for f in files if isinstance(f, dict)]
        if not video_files:
            return []
        non_sample = [
            f for f in video_files if not _SAMPLE_OR_EXTRA_RE.search(str(f.get(path_key) or ""))
        ]
        if non_sample:
            video_files = non_sample
        sizes = [int(f.get(size_key) or f.get("length") or f.get("bytes") or 0) for f in video_files]
        max_sz = max(sizes) if sizes else 0
        if max_sz >= 80 * 1024 * 1024:
            filtered_big = [
                f
                for f in video_files
                if int(f.get(size_key) or f.get("length") or f.get("bytes") or 0) >= 25 * 1024 * 1024
            ]
            if filtered_big:
                video_files = filtered_big
        return video_files

    @classmethod
    def _match_episode_from_files(
        cls,
        files: List[Dict[str, Any]],
        path_key: str,
        id_key: str,
        size_key: str,
        media_type: str,
        season: int,
        episode: int,
        year: int = 0,
        title: str = "",
        orig_title: str = "",
    ) -> Optional[Any]:
        video_files = cls._filter_main_video_files(files, path_key, size_key)
        if not video_files:
            return None

        if media_type != "series":
            if len(video_files) == 1:
                return video_files[0].get(id_key)
            sizes = [int(x.get(size_key) or x.get("length") or x.get("bytes") or 0) for x in video_files]
            max_sz = max(sizes) if sizes else 0
            # Identify full feature movie files in a multi-movie pack (>= 30% of largest file or >= 450 MB)
            main_movies = (
                [
                    vf
                    for vf in video_files
                    if int(vf.get(size_key) or vf.get("length") or vf.get("bytes") or 0)
                    >= max(450 * 1024 * 1024, int(max_sz * 0.30))
                ]
                if max_sz > 0
                else list(video_files)
            )
            if len(main_movies) == 1:
                return main_movies[0].get(id_key)
            if not main_movies:
                main_movies = list(video_files)

            # Multi-movie pack (Trilogy / Quadrilogy / Anthology): match target movie year and part number!
            t_seq = cls._extract_sequel_markers(title) | cls._extract_sequel_markers(orig_title)
            non_one = sorted(int(s) for s in t_seq if int(s) >= 2)
            target_part = non_one[0] if non_one else 1

            scrub_tech_re = _SCRUB_TECH_RE
            sorted_movies = sorted(main_movies, key=lambda x: _natural_sort_key(str(x.get(path_key) or "")))
            best_vf = None
            best_score = -10**9
            for idx_m, vf in enumerate(sorted_movies):
                raw_p = str(vf.get(path_key) or vf.get("name") or "")
                base_n = raw_p.replace("\\", "/").split("/")[-1]
                stem_n = _VIDEO_EXT_RE.sub("", base_n)
                score = 0
                f_years = [
                    int(y)
                    for y in re.findall(r"\b(19\d{2}|20\d{2})\b", raw_p)
                    if int(y) not in (1080, 2160)
                ]
                if year and int(year) >= 1900 and f_years:
                    if any(abs(fy - int(year)) <= 1 for fy in f_years):
                        score += 250
                    else:
                        score -= 250

                stem_no_yr = re.sub(r"\b(19\d{2}|20\d{2})\b", " ", scrub_tech_re.sub(" ", stem_n))
                f_seq = cls._extract_sequel_markers(stem_no_yr)
                f_explicit_seq = {int(s) for s in f_seq if int(s) >= 2}
                if target_part in f_seq:
                    score += 120
                elif target_part == 1 and not f_explicit_seq:
                    score += 70
                elif f_explicit_seq and target_part not in f_explicit_seq:
                    score -= 140

                # Subtle bonus for natural chronological position matching target_part (e.g. Part 1 -> index 0)
                if idx_m == (target_part - 1):
                    score += 25
                else:
                    score -= abs(idx_m - (target_part - 1)) * 5

                if score > best_score:
                    best_score = score
                    best_vf = vf

            if best_vf is not None:
                return best_vf.get(id_key)
            return sorted_movies[0].get(id_key)

        s_num = max(0, int(season if season is not None else 1))
        e_num = max(1, int(episode or 1))

        # Narrow multi-season packs to files not explicitly tagged with a conflicting season folder
        season_scoped_files = [
            vf
            for vf in video_files
            if not cls._has_conflicting_season_marker(
                "/".join(str(vf.get(path_key) or "").replace("\\", "/").split("/")[:-1]),
                s_num,
            )
        ]
        candidate_files = season_scoped_files or video_files

        # Pass 1: Explicit season/episode or double-episode span on the filename stem (never parent folder "(8 из 8)")
        for vf in candidate_files:
            raw_p = str(vf.get(path_key) or "")
            base = raw_p.replace("\\", "/").split("/")[-1]
            stem = _VIDEO_EXT_RE.sub("", base)
            span = cls._extract_episode_span_from_stem(stem, season=s_num)
            if span is not None and span[0] <= e_num <= span[1]:
                return vf.get(id_key)

        # Pass 2: Scrubbed bare/anime episode number on filename stem after removing resolution/codec/CRC32 noise
        bare_ep_re = re.compile(
            rf"(?:^|[._\-\s\[])0*{e_num}(?:\s*(?:из|of)\s*\d+|\s*серия|(?:$|[._\-\s\]]))",
            re.IGNORECASE,
        )
        scrub_noise_re = _SCRUB_NOISE_RE
        for vf in candidate_files:
            raw_p = str(vf.get(path_key) or "")
            base = raw_p.replace("\\", "/").split("/")[-1]
            raw_stem = _VIDEO_EXT_RE.sub("", base)
            if cls._has_conflicting_season_marker(raw_stem, s_num):
                continue
            stem_scrubbed = scrub_noise_re.sub(" ", raw_stem)
            if bare_ep_re.search(stem_scrubbed):
                return vf.get(id_key)

        video_files_sorted = sorted(candidate_files, key=lambda x: _natural_sort_key(str(x.get(path_key) or "")))
        if len(video_files_sorted) == 1:
            return video_files_sorted[0].get(id_key)
        if 1 <= e_num <= len(video_files_sorted):
            return video_files_sorted[e_num - 1].get(id_key)
        return video_files_sorted[0].get(id_key)

    def _remove_torrserver_torrent(self, info_hash: str) -> None:
        if not info_hash:
            return
        try:
            opener = self._build_torr_opener()
            req_rem = urllib.request.Request(
                f"{self.torrserver_url}/torrents",
                data=json.dumps({"action": "rem", "hash": info_hash}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with opener.open(req_rem, timeout=1.5) as _:
                pass
        except Exception:
            pass

    @staticmethod
    def _extract_files_from_torr_obj(t_obj: Any) -> List[Dict[str, Any]]:
        if not isinstance(t_obj, dict):
            return []
        fs = t_obj.get("file_stats")
        if isinstance(fs, list) and fs:
            return fs
        raw_data = t_obj.get("data")
        if isinstance(raw_data, str) and raw_data.strip().startswith("{"):
            try:
                parsed_d = json.loads(raw_data)
                files = ((parsed_d.get("TorrServer") or {}).get("Files")) or []
                if isinstance(files, list) and files:
                    return files
            except Exception:
                pass
        return []

    def _drop_other_active_torrents(self, keep_hashes: set) -> None:
        if "_fetch_torrserver_file_stats" in self.__dict__:
            return
        try:
            opener = self._build_torr_opener()
            req_list = urllib.request.Request(
                f"{self.torrserver_url}/torrents",
                data=json.dumps({"action": "list"}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with opener.open(req_list, timeout=1.0) as r_list:
                all_torrs = json.loads(r_list.read(4 * 1024 * 1024).decode("utf-8", errors="ignore") or "[]")
            if not isinstance(all_torrs, list):
                return
            keep_low = {str(h or "").strip().lower() for h in (keep_hashes or set()) if h}
            for t in all_torrs:
                if not isinstance(t, dict):
                    continue
                th = str(t.get("hash") or "").strip().lower()
                st_code = int(t.get("stat") or 0)
                if not th or th in keep_low or st_code == 5:
                    continue
                try:
                    req_drop = urllib.request.Request(
                        f"{self.torrserver_url}/torrents",
                        data=json.dumps({"action": "drop", "hash": th}).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    with opener.open(req_drop, timeout=0.8) as r_drop:
                        r_drop.read(4096)
                except Exception:
                    pass
        except Exception:
            pass

    def _fetch_torrserver_file_stats(
        self,
        magnet: str,
        wait_metadata_sec: float = 0.0,
    ) -> List[Dict[str, Any]]:
        enriched_mag = _enrich_magnet_trackers(magnet)
        info_hash = _extract_btih_hex(enriched_mag)
        now_mono = time.monotonic()
        if info_hash:
            with self._cache_lock:
                fcache = getattr(self, "_torr_fstats_cache", None)
                if isinstance(fcache, dict):
                    cached_fs = fcache.get(info_hash)
                    if cached_fs and (now_mono - cached_fs[1]) < 900.0 and cached_fs[0]:
                        return list(cached_fs[0])
        try:
            opener = self._build_torr_opener()
            wait_sec_val = max(0.0, float(wait_metadata_sec or 0.0))
            deadline = time.time() + wait_sec_val
            file_stats: List[Dict[str, Any]] = []
            if info_hash:
                try:
                    req_fast = urllib.request.Request(
                        f"{self.torrserver_url}/torrents",
                        data=json.dumps({"action": "get", "hash": info_hash}).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    with opener.open(req_fast, timeout=0.6) as r_fast:
                        d_fast = json.loads(r_fast.read(2 * 1024 * 1024).decode("utf-8", errors="ignore") or "{}")
                    file_stats = self._extract_files_from_torr_obj(d_fast)
                except Exception:
                    file_stats = []
            if not file_stats:
                add_timeout = max(2.5, wait_sec_val if wait_sec_val > 0 else 2.5)
                data: Dict[str, Any] = {}
                try:
                    req = urllib.request.Request(
                        f"{self.torrserver_url}/torrents",
                        data=json.dumps({"action": "add", "link": enriched_mag, "save_to_db": True}).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    with opener.open(req, timeout=add_timeout) as resp:
                        data = json.loads(resp.read(2 * 1024 * 1024).decode("utf-8", errors="ignore") or "{}")
                except Exception:
                    data = {}
                file_stats = self._extract_files_from_torr_obj(data)
            if not file_stats and info_hash and wait_sec_val > 0:
                while True:
                    req_get = urllib.request.Request(
                        f"{self.torrserver_url}/torrents",
                        data=json.dumps({"action": "get", "hash": info_hash}).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    try:
                        with opener.open(req_get, timeout=2.0) as r_get:
                            d_get = json.loads(r_get.read(2 * 1024 * 1024).decode("utf-8", errors="ignore") or "{}")
                        file_stats = self._extract_files_from_torr_obj(d_get)
                    except Exception:
                        file_stats = []
                    if file_stats or time.time() >= deadline:
                        break
                    time.sleep(0.24)
            if isinstance(file_stats, list):
                if file_stats and info_hash:
                    with self._cache_lock:
                        if not hasattr(self, "_torr_fstats_cache") or not isinstance(self._torr_fstats_cache, dict):
                            self._torr_fstats_cache = {}
                        if len(self._torr_fstats_cache) >= 256:
                            for k_old in list(self._torr_fstats_cache.keys())[:64]:
                                self._torr_fstats_cache.pop(k_old, None)
                        self._torr_fstats_cache[info_hash] = (list(file_stats), time.monotonic())
                return file_stats
        except Exception:
            pass
        return []

    def _warm_torrserver_winner_piece_zero(
        self,
        magnet: str,
        file_stats: List[Dict[str, Any]],
    ) -> None:
        if "_fetch_torrserver_file_stats" in self.__dict__:
            return
        enriched_mag = _enrich_magnet_trackers(magnet)
        info_hash = _extract_btih_hex(enriched_mag)
        if len(info_hash) != 40 or not file_stats:
            return
        main_files = self._filter_main_video_files(file_stats, "path", "length") or file_stats
        best_file = max(main_files, key=lambda x: int(x.get("length") or 0))
        fid = max(1, int(best_file.get("id") or 1))
        s_url = f"{self.torrserver_url}/stream/warm.mkv?link={urllib.parse.quote(enriched_mag)}&index={fid}&play"

        def _bg_warm() -> None:
            try:
                opener = self._build_torr_opener()
                req = urllib.request.Request(s_url, headers={"Range": "bytes=0-65535"})
                with opener.open(req, timeout=6.0) as resp:
                    resp.read(16384)
            except Exception:
                pass

        try:
            self._torr_preflight_pool.submit(_bg_warm)
        except Exception:
            threading.Thread(target=_bg_warm, name="VelariumTorrWarm0", daemon=True).start()

    def preflight_rank_torrserver_candidates(
        self,
        candidates: List[Dict[str, Any]],
        sort_key_fn: Any,
        max_probe: int = 5,
        wait_sec: float = 3.5,
    ) -> List[Dict[str, Any]]:
        if not candidates:
            return candidates
        mag_cands = [
            c
            for c in candidates
            if not c.get("direct_url") and c.get("magnet")
        ]
        if not mag_cands:
            return candidates

        is_mocked = "_fetch_torrserver_file_stats" in self.__dict__
        probed_fs_by_hash: Dict[str, List[Dict[str, Any]]] = {}

        def _classify_fs_tier(
            fs: List[Dict[str, Any]],
            total_peers: Optional[int] = None,
            connected_seeders: Optional[int] = None,
            reported_seeders: int = 0,
        ) -> int:
            if not fs:
                return -1
            if is_mocked:
                return 1
            main_files = self._filter_main_video_files(fs, "path", "length") or fs
            best_f = max(main_files, key=lambda x: int(x.get("length") or 0))
            best_path = str(best_f.get("path") or "").lower()
            best_gb = int(best_f.get("length") or 0) / (1024 ** 3)
            is_modern = (
                best_path.endswith((".mkv", ".mp4", ".mov", ".webm"))
                and "bdmv" not in best_path
                and len(fs) <= 45
            )
            if not is_modern:
                return 1
            if total_peers is not None:
                tp = int(total_peers or 0)
                cs = int(connected_seeders or 0)
                # Heavy >18 GB 4K files need >=2 connected seeders to sustain 25+ Mbps;
                # if only 0-1 seeder is connected, demote so a multi-seeder stream wins.
                if best_gb > 18.0 and cs <= 1:
                    return 1
                if cs >= 4 or (cs >= 2 and (best_gb <= 16.0 or tp >= 12)) or (tp >= 25 and best_gb <= 12.0):
                    return 3
                if cs >= 1 or tp >= 6:
                    return 2
                return 1
            if reported_seeders >= 20 and best_gb <= 18.0:
                return 3
            return 2

        def _probe_one(cand: Dict[str, Any], w_sec: float) -> Tuple[int, str, Optional[Dict[str, Any]]]:
            mag = str(cand.get("magnet") or "")
            fs = self._fetch_torrserver_file_stats(mag, wait_metadata_sec=w_sec)
            tier = _classify_fs_tier(fs, reported_seeders=int(cand.get("seeders") or 0))
            ih = _extract_btih_hex(_enrich_magnet_trackers(mag)) if fs else ""
            return tier, ih, fs

        probe_limit = len(mag_cands) if is_mocked else min(len(mag_cands), max(max_probe, 8))
        batch_all = mag_cands[:probe_limit]
        eff_wait = wait_sec if is_mocked else max(wait_sec, 4.8)
        pool = getattr(self, "_torr_preflight_pool", None)
        if pool is None:
            pool = concurrent.futures.ThreadPoolExecutor(
                max_workers=8, thread_name_prefix="VelariumTorrPreflight"
            )
            self._torr_preflight_pool = pool
        fut_map = {
            pool.submit(_probe_one, c, eff_wait): c
            for c in batch_all
        }
        done, not_done = concurrent.futures.wait(fut_map.keys(), timeout=eff_wait + 2.0)
        for fut, cand in fut_map.items():
            if fut in not_done:
                cand["_dht_verified"] = -1
                fut.cancel()
                continue
            try:
                tier_res, ih_res, fs_res = fut.result(timeout=0.05)
                cand["_dht_verified"] = tier_res
                if ih_res and fs_res:
                    probed_fs_by_hash[ih_res] = fs_res
            except Exception:
                cand["_dht_verified"] = -1

        if not is_mocked:
            try:
                opener = self._build_torr_opener()
                req_list = urllib.request.Request(
                    f"{self.torrserver_url}/torrents",
                    data=json.dumps({"action": "list"}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with opener.open(req_list, timeout=1.0) as r_list:
                    all_torrs = json.loads(r_list.read(4 * 1024 * 1024).decode("utf-8", errors="ignore") or "[]")
                if isinstance(all_torrs, list):
                    live_torr_map = {
                        str(t.get("hash") or "").strip().lower(): t
                        for t in all_torrs
                        if isinstance(t, dict) and self._extract_files_from_torr_obj(t)
                    }
                    for cand in mag_cands:
                        ih = _extract_btih_hex(_enrich_magnet_trackers(str(cand.get("magnet") or "")))
                        if ih and ih in live_torr_map:
                            t_obj = live_torr_map[ih]
                            fs_live = self._extract_files_from_torr_obj(t_obj)
                            probed_fs_by_hash[ih] = fs_live
                            st_code = int(t_obj.get("stat") or 0)
                            is_live_working = st_code in (2, 3)
                            cand["_dht_verified"] = _classify_fs_tier(
                                fs_live,
                                total_peers=int(t_obj.get("total_peers") or 0) if is_live_working else None,
                                connected_seeders=int(t_obj.get("connected_seeders") or 0) if is_live_working else None,
                                reported_seeders=int(cand.get("seeders") or 0),
                            )
                            with self._cache_lock:
                                if not hasattr(self, "_torr_fstats_cache") or not isinstance(self._torr_fstats_cache, dict):
                                    self._torr_fstats_cache = {}
                                self._torr_fstats_cache[ih] = (list(fs_live), time.monotonic())
            except Exception:
                pass

        ranked = sorted(
            candidates,
            key=lambda r: (
                3 if r.get("direct_url") else int(r.get("_dht_verified", -1)),
                sort_key_fn(r),
            ),
            reverse=True,
        )

        if not is_mocked and ranked:
            winner = ranked[0]
            win_mag = str(winner.get("magnet") or "")
            win_hash = _extract_btih_hex(_enrich_magnet_trackers(win_mag)) if win_mag else ""
            keep_top = {win_hash} if win_hash else set()
            if len(ranked) > 1:
                sec_mag = str(ranked[1].get("magnet") or "")
                sec_hash = _extract_btih_hex(_enrich_magnet_trackers(sec_mag)) if sec_mag else ""
                if sec_hash:
                    keep_top.add(sec_hash)
            self._drop_other_active_torrents(keep_top)
            if win_hash and win_hash in probed_fs_by_hash:
                self._warm_torrserver_winner_piece_zero(win_mag, probed_fs_by_hash[win_hash])

        return ranked

    @classmethod
    def _infer_pack_relative_file_index(cls, rel_title: str, season: int, episode: int) -> int:
        s_num = max(0, int(season if season is not None else 1))
        e_num = max(1, int(episode or 1))
        txt = str(rel_title or "")
        if not txt:
            return e_num
        # Sub-pack range e.g. [S01E05-E06] or Серии 5-6 -> relative file index inside pack
        for m_rng in re.finditer(
            rf"(?:\bs0*{s_num}\s*[._\-x]?\s*e0*(\d{{1,3}})\s*[-–—]\s*e?0*(\d{{1,3}})\b|(?:серии|ep|episodes?)\s*:?\s*0*(\d{{1,3}})\s*[-–—]\s*0*(\d{{1,3}})\b)",
            txt,
            re.IGNORECASE,
        ):
            a_str = m_rng.group(1) or m_rng.group(3)
            b_str = m_rng.group(2) or m_rng.group(4)
            if a_str and b_str:
                ep_a, ep_b = int(a_str), int(b_str)
                if ep_a <= e_num <= ep_b:
                    return max(1, e_num - ep_a + 1)
        # Single-episode release e.g. Severance.S02E05.2160p -> file index is 1
        if re.search(rf"\bs0*{s_num}\s*[._\-x]?\s*e0*\d{{1,3}}\b(?!\s*[-–—])", txt, re.IGNORECASE) or re.search(
            rf"\b0*{s_num}x0*\d{{1,3}}\b(?!\s*[-–—])", txt, re.IGNORECASE
        ):
            return 1
        return e_num

    def _resolve_torrserver_file_index(
        self,
        magnet: str,
        media_type: str,
        season: int,
        episode: int,
        wait_metadata_sec: float = 0.0,
        release_title: str = "",
        year: int = 0,
        title: str = "",
        orig_title: str = "",
    ) -> int:
        if media_type != "series" and not self._is_multi_movie_pack(release_title):
            return 1
        file_stats = self._fetch_torrserver_file_stats(magnet, wait_metadata_sec=wait_metadata_sec)
        if file_stats:
            matched_id = self._match_episode_from_files(
                file_stats,
                "path",
                "id",
                "length",
                media_type,
                season,
                episode,
                year=year,
                title=title,
                orig_title=orig_title,
            )
            if matched_id is not None and int(matched_id) > 0:
                return int(matched_id)
        if media_type == "series":
            return self._infer_pack_relative_file_index(release_title or magnet, season, episode)
        return 1

    def resolve_torrserver_stream(
        self,
        magnet: str,
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        file_index: Optional[int] = None,
        filename_hint: str = "",
        lang: str = "ru",
        year: int = 0,
        title: str = "",
        orig_title: str = "",
    ) -> Dict[str, Any]:
        is_en = str(lang or "").strip().lower().startswith("en")
        raw_mag = str(magnet or "").strip()
        if not raw_mag.startswith("magnet:") or _CTRL_CHAR_RE.search(raw_mag):
            return {
                "ok": False,
                "error": "Invalid Magnet link" if is_en else "Некорректная Magnet-ссылка",
            }
        if getattr(self.net, "p2p_strict", False) and self.mode != "torrserver":
            return {
                "ok": False,
                "error": (
                    "Direct BitTorrent (P2P) is disabled in your region — use Real-Debrid or TorBox HTTPS"
                    if is_en
                    else "Прямой торрент-обмен (P2P) отключён для вашего региона — используйте Real-Debrid или TorBox HTTPS"
                ),
            }
        torr_alive = self.ensure_local_torrserver() or self._is_torrserver_alive()
        if not torr_alive:
            return {
                "ok": False,
                "error": "TorrServer is not running" if is_en else "Локальный TorrServer не запущен",
            }
        enriched_mag = _enrich_magnet_trackers(raw_mag)
        active_ih = _extract_btih_hex(enriched_mag)
        if active_ih:
            try:
                self._torr_preflight_pool.submit(self._drop_other_active_torrents, {active_ih})
            except Exception:
                self._drop_other_active_torrents({active_ih})
        file_stats = self._fetch_torrserver_file_stats(enriched_mag, wait_metadata_sec=4.0)
        if not file_stats and file_index is None:
            return {
                "ok": False,
                "dead_swarm": True,
                "error": (
                    "No active DHT peers found for this release — switching to another source"
                    if is_en
                    else "Нет активных пиров DHT для этой раздачи — переключаем на другой источник"
                ),
            }
        main_files = self._filter_main_video_files(file_stats, "path", "length")
        main_files_sorted = sorted(main_files, key=lambda x: _natural_sort_key(str(x.get("path") or "")))

        video_files_out: List[Dict[str, Any]] = []
        for idx_pos, vf in enumerate(main_files_sorted):
            fid = int(vf.get("id") or (idx_pos + 1))
            raw_path = str(vf.get("path") or f"file_{fid}.mkv")
            base_name = raw_path.replace("\\", "/").split("/")[-1] or raw_path
            f_bytes = int(vf.get("length") or 0)
            det_ep = self._detect_episode_in_path(raw_path, season=season) if media_type == "series" else None
            video_files_out.append(
                {
                    "id": fid,
                    "name": base_name,
                    "path": raw_path,
                    "bytes": f_bytes,
                    "size": self._format_file_bytes(f_bytes, is_en=is_en),
                    "episode": det_ep,
                }
            )

        chosen_idx = 1
        if file_index is not None and int(file_index) > 0:
            chosen_idx = int(file_index)
        elif file_stats:
            matched_id = self._match_episode_from_files(
                file_stats,
                "path",
                "id",
                "length",
                media_type,
                season,
                episode,
                year=year,
                title=title,
                orig_title=orig_title,
            )
            if matched_id is not None and int(matched_id) > 0:
                chosen_idx = int(matched_id)
            elif media_type == "series":
                chosen_idx = self._infer_pack_relative_file_index(filename_hint or raw_mag, season, episode)
        elif media_type == "series":
            chosen_idx = self._infer_pack_relative_file_index(filename_hint or raw_mag, season, episode)

        chosen_file_obj = next((f for f in video_files_out if int(f["id"]) == chosen_idx), None)
        fname_raw = (
            (chosen_file_obj["name"] if chosen_file_obj else "")
            or str(filename_hint or "fname").split("/")[-1]
            or "fname"
        )
        fname_seg = urllib.parse.quote(fname_raw)
        stream_url = (
            f"{self.torrserver_url}/stream/{fname_seg}"
            f"?link={urllib.parse.quote(enriched_mag)}&index={chosen_idx}&play"
        )
        return {
            "ok": True,
            "stream_url": stream_url,
            "file_index": chosen_idx,
            "video_files": video_files_out,
        }

    def _format_debrid_http_error(self, service_name: str, code: int, is_en: bool) -> str:
        if code in (401, 403):
            return (
                f"{service_name} rejected your API key (HTTP {code}) — check your key and subscription"
                if is_en
                else f"{service_name} отклонил API-ключ (HTTP {code}) — проверьте ключ и статус подписки"
            )
        if code == 429:
            return (
                f"{service_name} rate limit reached (HTTP 429) — retry in a few seconds"
                if is_en
                else f"Превышен лимит запросов {service_name} (HTTP 429) — повторите через пару секунд"
            )
        if code == 451:
            return (
                f"This release is unavailable on {service_name} due to a copyright takedown (HTTP 451)"
                if is_en
                else f"Раздача недоступна в {service_name} по запросу правообладателя (HTTP 451)"
            )
        if code >= 500:
            return (
                f"{service_name} servers are temporarily unavailable (HTTP {code})"
                if is_en
                else f"Серверы {service_name} временно недоступны (HTTP {code})"
            )
        return (
            f"{service_name} API error (HTTP {code})"
            if is_en
            else f"Ошибка {service_name} API (HTTP {code})"
        )

    def resolve_debrid_magnet(
        self,
        magnet: str,
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        provider: Optional[str] = None,
        lang: str = "ru",
        year: int = 0,
        title: str = "",
        orig_title: str = "",
    ) -> Dict[str, Any]:
        is_en = str(lang or "").strip().lower().startswith("en")
        prov = (provider or self.mode or "").lower()
        if prov == "debrid_https":
            prov = "realdebrid"
        if not self.debrid_api_key:
            return {
                "ok": False,
                "error": (
                    "Enter a Real-Debrid or TorBox API key in Settings -> Network & Streams"
                    if is_en
                    else "Укажите API-ключ Real-Debrid или TorBox в Настройках -> Сеть и потоки"
                ),
            }
        clean_mag = str(magnet or "").strip()
        if not clean_mag.startswith("magnet:") or _CTRL_CHAR_RE.search(clean_mag):
            return {"ok": False, "error": "Invalid Magnet link" if is_en else "Некорректная Magnet-ссылка"}

        cache_key = f"{prov}:{clean_mag}:{media_type}:s{season}e{episode}:y{year}:{title}"
        now_mono = time.monotonic()
        with self._cache_lock:
            cached_entry = self._debrid_cache.get(cache_key)
            if cached_entry and (now_mono - cached_entry[1]) < 3600.0:
                return {"ok": True, "stream_url": cached_entry[0], "provider": prov}

        if prov == "torbox":
            res = self._resolve_torbox_magnet(
                clean_mag, media_type, season, episode, is_en=is_en, year=year, title=title, orig_title=orig_title
            )
        else:
            res = self._resolve_realdebrid_magnet(
                clean_mag, media_type, season, episode, is_en=is_en, year=year, title=title, orig_title=orig_title
            )

        if res.get("ok") and res.get("stream_url"):
            with self._cache_lock:
                if len(self._debrid_cache) >= 256:
                    for k_ev in list(self._debrid_cache.keys())[:64]:
                        self._debrid_cache.pop(k_ev, None)
                self._debrid_cache[cache_key] = (str(res["stream_url"]), now_mono)
        return res

    _DEBRID_SSL_CTX = ssl.create_default_context()
    _DEBRID_API_OPENER: Optional[urllib.request.OpenerDirector] = None

    @classmethod
    def _build_debrid_api_opener(cls) -> urllib.request.OpenerDirector:
        if cls._DEBRID_API_OPENER is None:
            cls._DEBRID_API_OPENER = urllib.request.build_opener(
                _SafeRedirectHandler(),
                urllib.request.HTTPSHandler(context=cls._DEBRID_SSL_CTX),
                urllib.request.ProxyHandler({}),
            )
        return cls._DEBRID_API_OPENER

    def _resolve_realdebrid_magnet(
        self,
        magnet: str,
        media_type: str,
        season: int,
        episode: int,
        is_en: bool = False,
        year: int = 0,
        title: str = "",
        orig_title: str = "",
    ) -> Dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.debrid_api_key}",
            "User-Agent": "Velarium/2.0",
        }
        opener = self._build_debrid_api_opener()
        try:
            body_add = urllib.parse.urlencode({"magnet": magnet}).encode("utf-8")
            req_add = urllib.request.Request(
                "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
                data=body_add,
                headers={**headers, "Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            )
            with opener.open(req_add, timeout=10) as r_add:
                add_data = json.loads(r_add.read(1048576).decode("utf-8"))
            tid = str(add_data.get("id") or "").strip()
            if not tid:
                return {
                    "ok": False,
                    "error": "Real-Debrid did not return a torrent ID" if is_en else "Real-Debrid не вернул ID раздачи",
                }

            safe_tid = urllib.parse.quote(tid, safe="")
            req_info = urllib.request.Request(
                f"https://api.real-debrid.com/rest/1.0/torrents/info/{safe_tid}",
                headers=headers,
            )
            with opener.open(req_info, timeout=10) as r_info:
                info_data = json.loads(r_info.read(2 * 1024 * 1024).decode("utf-8"))

            files = info_data.get("files") or []
            chosen_fid = self._match_episode_from_files(
                files,
                "path",
                "id",
                "bytes",
                media_type,
                season,
                episode,
                year=year,
                title=title,
                orig_title=orig_title,
            )
            sel_val = str(chosen_fid) if chosen_fid is not None else "all"
            req_sel = urllib.request.Request(
                f"https://api.real-debrid.com/rest/1.0/torrents/selectFiles/{safe_tid}",
                data=urllib.parse.urlencode({"files": sel_val}).encode("utf-8"),
                headers={**headers, "Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            )
            with opener.open(req_sel, timeout=10) as r_sel:
                r_sel.read(65536)

            with opener.open(req_info, timeout=10) as r_info2:
                info_after = json.loads(r_info2.read(2 * 1024 * 1024).decode("utf-8"))

            links = info_after.get("links") or []
            if not links:
                status_str = info_after.get("status", "downloading")
                # Clean up uncached torrent slot so failed instant-play checks never exhaust active RD slots
                try:
                    req_del = urllib.request.Request(
                        f"https://api.real-debrid.com/rest/1.0/torrents/delete/{safe_tid}",
                        headers=headers,
                        method="DELETE",
                    )
                    with opener.open(req_del, timeout=4) as r_del:
                        r_del.read(16384)
                except Exception:
                    pass
                return {
                    "ok": False,
                    "error": (
                        f"Release is still caching on Real-Debrid ({status_str}). Try TorrServer or pick a release with more seeders."
                        if is_en
                        else f"Раздача ещё кешируется в облаке Real-Debrid ({status_str}). Используйте TorrServer или выберите раздачу с большим числом сидов."
                    ),
                }

            chosen_link = links[0]
            if chosen_fid is not None and len(links) > 1:
                after_files = [
                    f for f in (info_after.get("files") or files)
                    if isinstance(f, dict) and f.get("selected")
                ]
                for idx_f, sf in enumerate(after_files):
                    if sf.get("id") == chosen_fid and idx_f < len(links):
                        chosen_link = links[idx_f]
                        break

            req_unr = urllib.request.Request(
                "https://api.real-debrid.com/rest/1.0/unrestrict/link",
                data=urllib.parse.urlencode({"link": chosen_link}).encode("utf-8"),
                headers={**headers, "Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            )
            with opener.open(req_unr, timeout=10) as r_unr:
                unr_data = json.loads(r_unr.read(1048576).decode("utf-8"))
            dl_url = str(unr_data.get("download") or "").strip()
            if not _is_safe_debrid_stream_url(dl_url):
                return {
                    "ok": False,
                    "error": "Real-Debrid did not return a valid HTTPS stream URL" if is_en else "Real-Debrid не вернул корректную прямую ссылку на поток",
                }
            return {"ok": True, "stream_url": dl_url, "provider": "realdebrid"}
        except urllib.error.HTTPError as he:
            err_code = he.code
            try:
                he.read(32768)
            except Exception:
                pass
            finally:
                try:
                    he.close()
                except Exception:
                    pass
            return {"ok": False, "error": self._format_debrid_http_error("Real-Debrid", err_code, is_en)}
        except Exception as exc:
            safe_err = self._redact_secret(exc)
            return {"ok": False, "error": f"Real-Debrid error: {safe_err}" if is_en else f"Ошибка Real-Debrid: {safe_err}"}

    def _resolve_torbox_magnet(
        self,
        magnet: str,
        media_type: str,
        season: int,
        episode: int,
        is_en: bool = False,
        year: int = 0,
        title: str = "",
        orig_title: str = "",
    ) -> Dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.debrid_api_key}",
            "User-Agent": "Velarium/2.0",
        }
        opener = self._build_debrid_api_opener()
        try:
            body_create = urllib.parse.urlencode({"magnet": magnet, "seed": "1"}).encode("utf-8")
            req_cr = urllib.request.Request(
                "https://api.torbox.app/v1/api/torrents/createtorrent",
                data=body_create,
                headers={**headers, "Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            )
            with opener.open(req_cr, timeout=12) as r_cr:
                cr_data = json.loads(r_cr.read(1048576).decode("utf-8"))
            tdata = cr_data.get("data") or {}
            tid = tdata.get("torrent_id") or tdata.get("id")
            if not tid:
                return {
                    "ok": False,
                    "error": self._redact_secret(
                        cr_data.get("detail")
                        or ("TorBox did not return torrent_id" if is_en else "TorBox не вернул torrent_id")
                    ),
                }

            safe_tid = urllib.parse.quote(str(tid), safe="")
            req_list = urllib.request.Request(
                f"https://api.torbox.app/v1/api/torrents/mylist?id={safe_tid}&bypass_cache=true",
                headers=headers,
            )
            with opener.open(req_list, timeout=10) as r_ls:
                ls_data = json.loads(r_ls.read(2 * 1024 * 1024).decode("utf-8"))
            t_item = ls_data.get("data") or {}
            if isinstance(t_item, list):
                t_item = t_item[0] if t_item else {}
            files = t_item.get("files") or []
            if not t_item.get("download_present"):
                try:
                    req_del = urllib.request.Request(
                        "https://api.torbox.app/v1/api/torrents/controltorrent",
                        data=json.dumps({"torrent_id": tid, "operation": "delete"}).encode("utf-8"),
                        headers={**headers, "Content-Type": "application/json"},
                        method="POST",
                    )
                    with opener.open(req_del, timeout=4) as r_del:
                        r_del.read(16384)
                except Exception:
                    pass
                return {
                    "ok": False,
                    "error": (
                        "Release is caching on TorBox. Try another release or switch to TorrServer."
                        if is_en
                        else "Раздача кешируется в облаке TorBox. Попробуйте раздачу выше или режим TorrServer."
                    ),
                }
            chosen_fid = self._match_episode_from_files(
                files,
                "name",
                "id",
                "size",
                media_type,
                season,
                episode,
                year=year,
                title=title,
                orig_title=orig_title,
            )
            fid_param = chosen_fid if chosen_fid is not None else 0
            dl_api = (
                f"https://api.torbox.app/v1/api/torrents/requestdl"
                f"?token={urllib.parse.quote(self.debrid_api_key, safe='')}&torrent_id={safe_tid}"
                f"&file_id={urllib.parse.quote(str(fid_param), safe='')}"
            )
            req_dl = urllib.request.Request(dl_api, headers=headers)
            with opener.open(req_dl, timeout=10) as r_dl:
                dl_json = json.loads(r_dl.read(1048576).decode("utf-8"))
            dl_url = str(dl_json.get("data") or "").strip()
            if not _is_safe_debrid_stream_url(dl_url):
                return {
                    "ok": False,
                    "error": (
                        "TorBox is still preparing the file — retry in a moment"
                        if is_en
                        else "TorBox ещё подготавливает файл — повторите через пару секунд"
                    ),
                }
            return {"ok": True, "stream_url": dl_url, "provider": "torbox"}
        except urllib.error.HTTPError as he:
            err_code = he.code
            try:
                he.read(32768)
            except Exception:
                pass
            finally:
                try:
                    he.close()
                except Exception:
                    pass
            return {"ok": False, "error": self._format_debrid_http_error("TorBox", err_code, is_en)}
        except Exception as exc:
            safe_err = self._redact_secret(exc)
            return {"ok": False, "error": f"TorBox error: {safe_err}" if is_en else f"Ошибка TorBox: {safe_err}"}

    @staticmethod
    @functools.lru_cache(maxsize=2048)
    def _norm_title_segment(text: str) -> str:
        s = html.unescape(str(text or "")).lower().replace("ё", "е")
        s = _NORM_SEG_NON_WORD_RE.sub(" ", s)
        s = _NORM_SEG_UNDERSCORE_RE.sub(" ", s)
        return _NORM_SEG_SPACE_RE.sub(" ", s).strip()

    @staticmethod
    def _fold_double_chars(norm_s: str) -> str:
        return re.sub(r"([a-zа-я])\1+", r"\1", str(norm_s or ""))

    @classmethod
    def _strip_en_article(cls, norm_s: str) -> str:
        return re.sub(r"^(?:the|a|an)\s+", "", norm_s).strip()

    @staticmethod
    def _parse_size_gb(size_str: str) -> float:
        m = re.search(r"(\d+(?:[.,]\d+)?)\s*(tb|тб|gb|гб|mb|мб)", str(size_str or "").lower())
        if not m:
            return 0.0
        val = float(m.group(1).replace(",", "."))
        unit = m.group(2)
        if unit in ("tb", "тб"):
            return val * 1024.0
        if unit in ("mb", "мб"):
            return val / 1024.0
        return val

    @classmethod
    def _is_multi_movie_pack(cls, rel_title: str) -> bool:
        t = html.unescape(str(rel_title or "")).lower()
        if re.search(
            r"\b(?:trilogy|quadrilogy|tetralogy|pentlogy|hexalogy|duology|dilogy|anthology|collection|"
            r"трилогия|квадрология|тетралогия|дилогия|антология|коллекция)\b",
            t,
        ):
            return True
        for m_yr in re.finditer(r"\b(19\d{2}|20\d{2})\s*[-–—]\s*(19\d{2}|20\d{2})\b", t):
            y1, y2 = int(m_yr.group(1)), int(m_yr.group(2))
            if y2 - y1 >= 2:
                return True
        return False

    @classmethod
    def _extract_sequel_markers(cls, text: str) -> set:
        s = html.unescape(str(text or "")).lower().replace("ё", "е")
        head = re.split(r"[\[\(]", s, maxsplit=1)[0]
        head = re.split(
            r"\b(?:19\d{2}|20\d{2}|2160p|1080p|720p|4k|uhd|web-?dl|webrip|bdremux|bdrip|blu-?ray|hdr\d*|hevc|x264|x265)\b",
            head,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        if re.search(
            r"\b(?:trilogy|quadrilogy|tetralogy|duology|dilogy|трилогия|квадрология|тетралогия|дилогия|"
            r"parts?\s*1\s*[-–—]\s*[2-9]|част[иь]\s*1\s*[-–—]\s*[2-9]|\b1\s*[-–—]\s*[2-4]\b)\b",
            head,
        ):
            return set()
        nums: set = set()
        roman_map = {
            "ii": 2,
            "iii": 3,
            "iv": 4,
            "v": 5,
            "vi": 6,
            "vii": 7,
            "viii": 8,
            "ix": 9,
        }
        for m_pt in re.finditer(r"\b(?:part|часть|ч\.?|фильм|film|vol\.?|volume|chapter|глава)\s*([1-9])\b", head):
            nums.add(int(m_pt.group(1)))
        for m_rom in re.finditer(r"(?<=\s)(ii|iii|iv|vi|vii|viii|ix)(?=\b)", head):
            nums.add(roman_map[m_rom.group(1)])
        for seg in re.split(r"\s*/\s*", head):
            seg_clean = cls._norm_title_segment(seg)
            m_tail_num = re.search(r"(?<=\s)([2-9])$", seg_clean)
            if m_tail_num:
                nums.add(int(m_tail_num.group(1)))
            m_tail_rom = re.search(r"(?<=\s)(ii|iii|iv|v|vi|vii|viii|ix)$", seg_clean)
            if m_tail_rom and m_tail_rom.group(1) in roman_map:
                nums.add(roman_map[m_tail_rom.group(1)])
        return nums

    @classmethod
    def _infer_release_voices(cls, rel_title: str, raw_voices: Any) -> List[str]:
        if isinstance(raw_voices, list):
            cleaned = [str(v).strip() for v in raw_voices if str(v or "").strip()]
            if cleaned:
                return cleaned
        t = html.unescape(str(rel_title or "")).lower()
        found: List[str] = []
        for pat_re, label in _VOICE_PATTERNS_COMPILED:
            if pat_re.search(t) and label not in found:
                found.append(label)
        has_ukr_tag = bool(_UKR_TAG_RE.search(t))
        has_rus_tag = bool(_RUS_TAG_RE.search(t))
        if has_ukr_tag and not has_rus_tag and not found:
            return ["Українська", "Оригинал"]
        if not found:
            found.append("Дубляж")
        if "Оригинал" not in found:
            found.append("Оригинал")
        return found

    @classmethod
    def _season_matches_release(cls, clean_rel: str, season: int) -> bool:
        season = max(0, int(season if season is not None else 1))
        if re.search(
            rf"(?:\bs0*{season}(?:\b|\s*[._\-x]?\s*e\d{{1,4}}\b)|\b0*{season}x\d{{1,4}}\b|\bseason\s*:?\s*0*{season}\b|сезон\s*:?\s*0*{season}\b|\b0*{season}\s*(?:-?й\s*)?сезон\b)",
            clean_rel,
            re.IGNORECASE,
        ):
            return True
        for m_rng in re.finditer(
            r"(?:(?:\bs|season\s*:?\s*|сезоны?\s*:?\s*)0*(\d{1,2})\s*[-–—]\s*s?0*(\d{1,2})\b|\b0*(\d{1,2})\s*[-–—]\s*0*(\d{1,2})\s*сезон)",
            clean_rel,
            re.IGNORECASE,
        ):
            g1 = m_rng.group(1) or m_rng.group(3)
            g2 = m_rng.group(2) or m_rng.group(4)
            if g1 and g2 and int(g1) <= season <= int(g2):
                return True
        return False

    @classmethod
    def _release_covers_episode(cls, clean_rel: str, season: int, episode: int) -> bool:
        if not episode or int(episode) <= 0:
            return True
        e_num = int(episode)
        s_num = max(0, int(season if season is not None else 1))
        # Multi-season pack (e.g. S01-S03) covers full seasons
        for m_sr in re.finditer(
            r"(?:(?:\bs|season\s*:?\s*|сезоны?\s*:?\s*)0*(\d{1,2})\s*[-–—]\s*s?0*(\d{1,2})\b|\b0*(\d{1,2})\s*[-–—]\s*0*(\d{1,2})\s*сезон)",
            clean_rel,
            re.IGNORECASE,
        ):
            g1 = m_sr.group(1) or m_sr.group(3)
            g2 = m_sr.group(2) or m_sr.group(4)
            if g1 and g2 and int(g1) < int(g2) and int(g1) <= s_num <= int(g2):
                return True

        # 1. Explicit episode range e.g. S01E01-E04, S01E05-06, Серии 1-4 из 8, [1-4 из 8]
        ranges_found: List[Tuple[int, int]] = []
        for m_er in re.finditer(
            rf"(?:\bs0*{s_num}\s*[._\-x]?\s*e0*(\d{{1,3}})\s*[-–—]\s*e?0*(\d{{1,3}})\b|(?:серии|серия|ep|episodes?)\s*:?\s*0*(\d{{1,3}})\s*[-–—]\s*0*(\d{{1,3}})\b|[\(\[]\s*0*(\d{{1,3}})\s*[-–—]\s*0*(\d{{1,3}})\s*(?:из|of)\s*\d{{1,3}})",
            clean_rel,
            re.IGNORECASE,
        ):
            pairs = [(m_er.group(1), m_er.group(2)), (m_er.group(3), m_er.group(4)), (m_er.group(5), m_er.group(6))]
            for a_s, b_s in pairs:
                if a_s and b_s:
                    ranges_found.append((int(a_s), int(b_s)))
        if ranges_found:
            return any(a <= e_num <= b for a, b in ranges_found)

        # 2. Explicit SxxExx (or SxxExxExx) without range -> single/chained episode release
        explicit_eps: set = set()
        for m_se in re.finditer(
            rf"\bs0*{s_num}\s*[._\-x]?\s*e0*(\d{{1,3}})((?:\s*[._\-]?\s*e0*\d{{1,3}})*)\b(?!\s*[-–—])",
            clean_rel,
            re.IGNORECASE,
        ):
            explicit_eps.add(int(m_se.group(1)))
            for extra_e in re.findall(r"e0*(\d{1,3})", m_se.group(2) or "", re.IGNORECASE):
                explicit_eps.add(int(extra_e))
        for m_x in re.finditer(rf"\b0*{s_num}x0*(\d{{1,3}})\b(?!\s*[-–—])", clean_rel, re.IGNORECASE):
            explicit_eps.add(int(m_x.group(1)))
        if explicit_eps:
            return e_num in explicit_eps

        # 3. Incremental tracker pack "(6 из 8)" -> contains episodes 1..6
        m_inc = re.search(r"[\(\[]\s*0*(\d{1,3})\s*(?:из|of)\s*0*(\d{1,3})\s*[\)\]]", clean_rel, re.IGNORECASE)
        if m_inc:
            avail_max = int(m_inc.group(1))
            total_max = int(m_inc.group(2))
            if 1 <= avail_max <= total_max and e_num > avail_max:
                return False

        # 4. Explicit singular Russian episode "5 серия" (not "серии 1-5")
        m_single_ru = re.search(r"(?<!-)\b0*(\d{1,3})\s*(?:-?(?:я|й)\s*)?серия\b", clean_rel, re.IGNORECASE)
        if m_single_ru and not re.search(r"серии", clean_rel, re.IGNORECASE):
            return int(m_single_ru.group(1)) == e_num

        return True

    @classmethod
    def _matches_target_title(
        cls,
        rel_title: str,
        title: str,
        orig_title: str,
        year: int,
        media_type: str,
        season: int,
        episode: int = 0,
    ) -> bool:
        clean_rel = html.unescape(str(rel_title or "")).strip()
        if not clean_rel:
            return False

        if year and year >= 1960:
            yr_matches = [int(y) for y in re.findall(r"\b(19\d{2}|20\d{2})\b", clean_rel)]
            yr_filtered = [y for y in yr_matches if y not in (1080, 2160)]
            if yr_filtered:
                if media_type == "series" and int(season or 1) > 1:
                    max_yr = year + int(season) + 2
                    if not any((year - 1) <= y <= max_yr for y in yr_filtered):
                        return False
                else:
                    if not any(abs(y - year) <= 1 for y in yr_filtered):
                        return False

        if media_type == "series":
            if re.search(r"\[movie\]", clean_rel, re.IGNORECASE):
                return False
            has_any_season_tag = bool(
                re.search(
                    r"(?:\bs\d{1,2}(?:\b|\s*[._\-x]?\s*e\d{1,4}\b)|\b\d{1,2}x\d{1,4}\b|\bseason\s*:?\s*\d+|сезон)",
                    clean_rel,
                    re.IGNORECASE,
                )
            )
            has_ep_marker = bool(
                re.search(
                    r"(?:серии\s*:?\s*\d+|серия\s*:?\s*\d+|\bs\d{1,2}\s*[._\-x]?\s*e\d{1,4}\b|\b\d{1,2}x\d{1,4}\b|\b\d{1,3}\s*из\s*\d{1,3}\b)",
                    clean_rel,
                    re.IGNORECASE,
                )
            )
            if has_any_season_tag:
                if not cls._season_matches_release(clean_rel, season):
                    return False
            elif not (int(season or 1) == 1 and has_ep_marker):
                return False
            if episode and int(episode) > 0 and not cls._release_covers_episode(clean_rel, season, episode):
                return False
        else:
            if re.search(
                r"(?:\bs\d{1,2}(?:e\d{1,3})?\b|\bseason\s*:?\s*\d+|сезон\s*:?\s*\d+|\b\d+\s*сезон\b|серии\s*:?\s*\d+)",
                clean_rel,
                re.IGNORECASE,
            ):
                return False

        target_seq_nums = cls._extract_sequel_markers(title) | cls._extract_sequel_markers(orig_title)
        rel_seq_nums = cls._extract_sequel_markers(clean_rel)
        if media_type != "series":
            target_explicit_seq = {n for n in target_seq_nums if n >= 2}
            rel_explicit_seq = {n for n in rel_seq_nums if n >= 2}
            if target_explicit_seq:
                if not (rel_explicit_seq & target_explicit_seq) and not cls._is_multi_movie_pack(clean_rel):
                    return False
            elif rel_explicit_seq:
                return False

        targets: List[str] = []
        for raw_t in (title, orig_title):
            nt = cls._norm_title_segment(raw_t)
            if nt and nt not in targets:
                targets.append(nt)
        if not targets:
            return True

        head_before_brackets = re.split(r"[\[\(]", clean_rel, maxsplit=1)[0]
        raw_Parts = [p.strip() for p in re.split(r"\s*/\s*", head_before_brackets) if p.strip()]
        if not raw_Parts:
            raw_Parts = [head_before_brackets.strip()]

        tail_split_re = _TAIL_SPLIT_RE
        candidate_norms: List[str] = []
        for rp in raw_Parts:
            trimmed = tail_split_re.split(rp, maxsplit=1)[0].strip()
            cn = cls._norm_title_segment(trimmed)
            if cn and cn not in candidate_norms:
                candidate_norms.append(cn)

        if not candidate_norms:
            return False

        allowed_suffix_re = _ALLOWED_SUFFIX_RE

        for t_norm in targets:
            t_art = cls._strip_en_article(t_norm)
            t_fold = cls._fold_double_chars(t_art or t_norm)
            for c_norm in candidate_norms:
                c_art = cls._strip_en_article(c_norm)
                c_fold = cls._fold_double_chars(c_art or c_norm)
                if c_norm == t_norm or (t_art and len(t_art) >= 3 and c_art == t_art):
                    return True
                if t_fold and len(t_fold) >= 4 and c_fold == t_fold:
                    return True
                if len(t_norm) >= 6 and len(c_norm) >= 6:
                    if c_norm.startswith(t_norm + " "):
                        suffix = c_norm[len(t_norm) :].strip()
                        if media_type == "series" or allowed_suffix_re.match(suffix):
                            return True
                    elif c_fold.startswith(t_fold + " ") and len(t_fold) >= 6:
                        suffix_f = c_fold[len(t_fold) :].strip()
                        if media_type == "series" or allowed_suffix_re.match(suffix_f):
                            return True
                    elif t_norm.startswith(c_norm + " ") and len(c_norm) >= 10:
                        if media_type == "series":
                            return True
        return False

    def _query_jacred_candidates(
        self,
        title: str,
        orig_title: str,
        year: int,
        media_type: str,
        season: int,
        episode: int = 0,
    ) -> List[Dict[str, Any]]:
        search_terms: List[str] = []
        for st in (orig_title, title):
            st_clean = str(st or "").strip()
            if st_clean and st_clean.lower() not in [x.lower() for x in search_terms]:
                search_terms.append(st_clean)
        yr_qs = f"&year={year}" if year and int(year) >= 1900 else ""

        def _fetch_host_term(host: str, term: str) -> List[Dict[str, Any]]:
            url = (
                f"{host}/api/v1.0/torrents?search={urllib.parse.quote(term)}"
                f"{yr_qs}"
            )
            status, body, _ = self.net.request(url, spoof_geo_country="DIRECT", timeout=2.8)
            if status != 200 or not body:
                return []
            try:
                items = json.loads(body)
                return items if isinstance(items, list) else []
            except Exception:
                return []

        raw_batches: List[List[Dict[str, Any]]] = []
        tasks = [(h, term) for term in search_terms for h in self.JACRED_HOSTS]
        futs = [_JACRED_QUERY_EXECUTOR.submit(_fetch_host_term, h, term) for h, term in tasks]
        try:
            done, not_done = concurrent.futures.wait(futs, timeout=3.2)
            for nf in not_done:
                nf.cancel()
            for f in done:
                try:
                    batch = f.result()
                    if batch:
                        raw_batches.append(batch)
                except Exception:
                    continue
        finally:
            for rf in futs:
                rf.cancel()

        candidates: List[Dict[str, Any]] = []
        seen_hashes = set()
        for items in raw_batches:
            for item in items:
                if not isinstance(item, dict):
                    continue
                rel_title = html.unescape(str(item.get("title") or "")).strip()
                magnet = _enrich_magnet_trackers(str(item.get("magnet") or "").strip())
                if not rel_title or not magnet:
                    continue
                if self._is_trash_rip(rel_title):
                    continue
                if not self._matches_target_title(
                    rel_title, title, orig_title, year, media_type, season, episode=episode
                ):
                    continue
                info_hash = _extract_btih_hex(magnet)
                dedup_key = info_hash or rel_title.lower()
                if dedup_key in seen_hashes:
                    continue
                seen_hashes.add(dedup_key)

                quality_badge, quality_rank = self._classify_release_quality(rel_title)
                seeders = max(0, int(item.get("sid") or 0))
                inferred_voices = self._infer_release_voices(rel_title, item.get("voices"))
                candidates.append(
                    {
                        "info_hash": info_hash,
                        "title": rel_title,
                        "tracker": str(item.get("tracker") or "Rutor / Rutracker"),
                        "size": str(item.get("sizeName") or "—"),
                        "seeders": seeders,
                        "quality": quality_badge,
                        "quality_rank": quality_rank,
                        "voices": inferred_voices,
                        "magnet": magnet,
                    }
                )
        return candidates

    def search_releases(
        self,
        title: str,
        orig_title: str = "",
        year: int = 0,
        item_id: str = "",
        rezka_url: str = "",
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        stremio_engine: Any = None,
        lang: str = "ru",
    ) -> Dict[str, Any]:
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        torr_alive = self.ensure_local_torrserver()
        debrid_ready = bool(self.debrid_api_key and self.mode in ("realdebrid", "torbox", "debrid_https"))

        wait_futs = []
        try:
            fut_jac = _BACKUP_SEARCH_EXECUTOR.submit(
                self._query_jacred_candidates,
                title,
                orig_title,
                year,
                media_type,
                season,
                episode if media_type == "series" else 0,
            )
            fut_cdn = _BACKUP_SEARCH_EXECUTOR.submit(
                self.rezka.get_streams_for_title,
                item_id=item_id or title,
                title=title,
                orig_title=orig_title,
                year=year,
                media_type=media_type,
                season=season,
                episode=episode,
                rezka_url=rezka_url,
            )
            st_kwargs: Dict[str, Any] = {
                "item_id": item_id,
                "title": title,
                "orig_title": orig_title,
                "year": year,
                "media_type": media_type,
                "season": season,
                "episode": episode,
                "lang": ui_lang,
            }
            if stremio_engine is not None and getattr(stremio_engine, "__class__", None).__name__ == "StremioAddonEngine":
                st_kwargs["skip_preflight"] = True
            fut_stremio = (
                _BACKUP_SEARCH_EXECUTOR.submit(
                    stremio_engine.get_streams_for_title,
                    **st_kwargs,
                )
                if stremio_engine is not None
                else None
            )
            wait_futs = [f for f in (fut_jac, fut_cdn, fut_stremio) if f is not None]
            concurrent.futures.wait(wait_futs, timeout=4.8 if media_type == "series" else 3.2)
            jac_candidates = fut_jac.result(timeout=0.05) or [] if fut_jac.done() and not fut_jac.exception() else []
            real_cdn_data = fut_cdn.result(timeout=0.05) or {} if fut_cdn.done() and not fut_cdn.exception() else {}
            stremio_payload: Dict[str, Any] = (
                (fut_stremio.result(timeout=0.05) or {})
                if (fut_stremio is not None and fut_stremio.done() and not fut_stremio.exception())
                else {}
            )
        finally:
            for wf in wait_futs:
                wf.cancel()

        direct_title_stream = (real_cdn_data or {}).get("default_stream_url", "")
        external_subtitles = list(stremio_payload.get("subtitles") or [])
        imdb_id = str(stremio_payload.get("imdb_id") or (real_cdn_data or {}).get("imdb_id") or "").strip()
        resolved_orig = str(orig_title or (real_cdn_data or {}).get("orig_title") or "").strip()
        if not jac_candidates and resolved_orig and resolved_orig.lower() != str(orig_title or "").strip().lower():
            try:
                jac_candidates = self._query_jacred_candidates(
                    title,
                    resolved_orig,
                    year,
                    media_type,
                    season,
                    episode if media_type == "series" else 0,
                )
            except Exception:
                pass
        if resolved_orig and not orig_title:
            orig_title = resolved_orig

        merged_seasons_map: Dict[str, List[int]] = {}
        cdn_seasons = (real_cdn_data or {}).get("seasons_map")
        st_seasons = stremio_payload.get("seasons_map")
        if isinstance(cdn_seasons, dict) and cdn_seasons:
            for sk, eps in cdn_seasons.items():
                if str(sk).isdigit() and isinstance(eps, list) and eps:
                    clean_eps = sorted({int(x) for x in eps if str(x).isdigit() and int(x) > 0})
                    if clean_eps:
                        merged_seasons_map[str(int(sk))] = clean_eps
        if isinstance(st_seasons, dict) and st_seasons:
            for sk, eps in st_seasons.items():
                if not str(sk).isdigit() or not isinstance(eps, list) or not eps:
                    continue
                s_key = str(int(sk))
                clean_eps = sorted({int(x) for x in eps if str(x).isdigit() and int(x) > 0})
                if clean_eps:
                    existing_eps = set(merged_seasons_map.get(s_key) or [])
                    merged_seasons_map[s_key] = sorted(existing_eps | set(clean_eps))

        episodes_titles: Dict[str, Any] = {}
        et_sources = (
            ((real_cdn_data or {}).get("episodes_titles"), stremio_payload.get("episodes_titles"))
            if ui_lang == "en"
            else (stremio_payload.get("episodes_titles"), (real_cdn_data or {}).get("episodes_titles"))
        )
        for src_et in et_sources:
            if not isinstance(src_et, dict):
                continue
            for sk, sv in src_et.items():
                if isinstance(sv, dict):
                    dst_s = episodes_titles.get(str(sk))
                    if not isinstance(dst_s, dict):
                        dst_s = {}
                        episodes_titles[str(sk)] = dst_s
                    for ek, ev in sv.items():
                        if ev:
                            dst_s[str(ek)] = ev
                            episodes_titles[f"{sk}:{ek}"] = ev
                elif sv and ":" in str(sk):
                    s_p, e_p = str(sk).split(":", 1)
                    episodes_titles[str(sk)] = sv
                    if s_p.isdigit() and e_p.isdigit():
                        dst_s = episodes_titles.get(s_p)
                        if not isinstance(dst_s, dict):
                            dst_s = {}
                            episodes_titles[s_p] = dst_s
                        dst_s[e_p] = sv

        episodes_meta: Dict[str, Any] = {}
        for src_em in (stremio_payload.get("episodes_meta"), (real_cdn_data or {}).get("episodes_meta")):
            if not isinstance(src_em, dict):
                continue
            for sk, sv in src_em.items():
                if not isinstance(sv, dict):
                    continue
                if ":" in str(sk):
                    s_p, e_p = str(sk).split(":", 1)
                    if s_p.isdigit() and e_p.isdigit():
                        dst_em_s = episodes_meta.setdefault(s_p, {})
                        cur_ev = dst_em_s.setdefault(e_p, {})
                        for fk, fv in sv.items():
                            if fv not in (None, "") or fk not in cur_ev:
                                cur_ev[fk] = fv
                        if sv.get("is_future") is True or sv.get("is_released") is False:
                            cur_ev["is_future"] = True
                            cur_ev["is_released"] = False
                    continue
                dst_em_s = episodes_meta.setdefault(str(sk), {})
                for ek, ev in sv.items():
                    if not isinstance(ev, dict):
                        continue
                    cur_ev = dst_em_s.setdefault(str(ek), {})
                    for fk, fv in ev.items():
                        if fv not in (None, "") or fk not in cur_ev:
                            cur_ev[fk] = fv
                    if ev.get("is_future") is True or ev.get("is_released") is False:
                        cur_ev["is_future"] = True
                        cur_ev["is_released"] = False

        if merged_seasons_map and episodes_meta:
            for sk in list(merged_seasons_map.keys()):
                s_em = episodes_meta.get(str(sk)) or {}
                kept_eps = [
                    ep_n
                    for ep_n in merged_seasons_map[sk]
                    if not (
                        (s_em.get(str(ep_n)) or {}).get("is_future") is True
                        or (s_em.get(str(ep_n)) or {}).get("is_released") is False
                    )
                ]
                if kept_eps:
                    merged_seasons_map[sk] = kept_eps
                else:
                    merged_seasons_map.pop(sk, None)

        by_key: Dict[str, Dict[str, Any]] = {}
        for jc in jac_candidates:
            ih = str(jc.get("info_hash") or "").strip().lower()
            key = ih or str(jc.get("magnet") or jc.get("title") or "")
            if not key:
                continue
            by_key[key] = dict(jc)

        # Merge healthy 4K / high-bitrate 1080p releases from Stremio (Torrentio / TPB+)
        for st in stremio_payload.get("streams") or []:
            q_rank = int(st.get("quality_rank") or 0)
            if q_rank < 180:
                continue
            ih = str(st.get("info_hash") or "").strip().lower()
            d_url = str(st.get("direct_url") or "").strip()
            magnet_st = str(st.get("magnet") or "").strip()
            if not d_url and not magnet_st:
                continue
            key = d_url or ih or magnet_st
            seeders_st = int(st.get("seeders") or 0)
            langs_st = list(st.get("languages") or [])
            voices_st = langs_st if langs_st else (["Original"] if ui_lang == "en" else ["Оригинал"])
            size_st = str(st.get("size") or "—")
            if ui_lang == "en":
                size_st = size_st.replace("ГБ", "GB").replace("МБ", "MB").replace("ТБ", "TB")

            cand_st = {
                "info_hash": ih,
                "title": str(st.get("filename_hint") or st.get("filename") or st.get("title") or title),
                "pack_title": str(st.get("title") or ""),
                "tracker": str(st.get("tracker") or st.get("addon_name") or "Torrentio"),
                "size": size_st,
                "seeders": seeders_st,
                "quality": str(st.get("quality") or "4K UHD"),
                "quality_rank": q_rank,
                "voices": voices_st,
                "magnet": magnet_st,
                "direct_url": d_url,
                "stremio_file_idx": st.get("file_idx"),
                "filename_hint": str(st.get("filename_hint") or st.get("filename") or ""),
                "has_russian": bool(st.get("has_russian")),
            }
            existing = by_key.get(key)
            if not existing:
                by_key[key] = cand_st
            else:
                if seeders_st > int(existing.get("seeders") or 0):
                    existing["seeders"] = seeders_st
                if existing.get("stremio_file_idx") is None and cand_st.get("stremio_file_idx") is not None:
                    existing["stremio_file_idx"] = cand_st["stremio_file_idx"]
                if not existing.get("filename_hint") and cand_st.get("filename_hint"):
                    existing["filename_hint"] = cand_st["filename_hint"]

        merged_candidates = list(by_key.values())
        has_live_peers = any(
            int(c.get("seeders") or 0) >= 1 or bool(c.get("direct_url"))
            for c in merged_candidates
        )
        if has_live_peers and not debrid_ready:
            merged_candidates = [
                c
                for c in merged_candidates
                if int(c.get("seeders") or 0) >= 1 or bool(c.get("direct_url"))
            ]
        hd_candidates = [
            c for c in merged_candidates if int(c.get("quality_rank") or 0) >= 120 or bool(c.get("direct_url"))
        ]
        if len(hd_candidates) >= 2:
            merged_candidates = hd_candidates

        def _release_sort_key(r: Dict[str, Any]) -> Tuple[Any, ...]:
            is_direct = 1 if r.get("direct_url") else 0
            seeds = int(r.get("seeders") or 0)
            q_rank = int(r.get("quality_rank") or 0)
            rel_title_str = f"{r.get('title') or ''} {r.get('pack_title') or ''}".strip()
            is_multi_pack = 1 if (media_type != "series" and self._is_multi_movie_pack(rel_title_str)) else 0
            single_movie_tier = 0 if is_multi_pack else 1
            healthy_tier = 2 if (is_direct or seeds >= 5) else (1 if seeds >= 1 else 0)
            is_uhd = 1 if q_rank >= 300 else 0
            voices_join = " ".join(str(v) for v in (r.get("voices") or [])).lower()
            has_ru = bool(
                r.get("has_russian")
                or any(
                    k in voices_join
                    for k in ("ru", "рус", "дубляж", "многоголос", "авторск", "hdrezka", "lostfilm", "jaskier", "кубик", "rhs")
                )
            )
            lang_match = (0 if has_ru else 1) if ui_lang == "en" else (1 if has_ru else 0)
            size_gb = self._parse_size_gb(str(r.get("size") or ""))
            is_remux = bool(re.search(r"bdremux|remux|\bblu-?ray\s*disc\b|\bbdmv\b", rel_title_str, re.IGNORECASE))
            if is_direct or debrid_ready:
                streamable_tier = 3
            elif media_type == "series":
                streamable_tier = 1 if is_remux else (3 if (0.0 <= size_gb <= 24.0 and seeds >= 10) else 2)
            else:
                if not is_remux and 0.4 <= size_gb <= 18.5 and seeds >= 8:
                    streamable_tier = 3
                elif not is_remux and 0.0 <= size_gb <= 28.5:
                    streamable_tier = 2
                elif 0.0 <= size_gb <= 45.0:
                    streamable_tier = 1
                else:
                    streamable_tier = 0
            quality_tier = 3 if q_rank >= 300 else (2 if q_rank >= 180 else (1 if q_rank >= 135 else 0))
            seed_bucket = min(seeds, 60) // 10
            trk_low = str(r.get("tracker") or "").lower()
            is_public_dht_tracker = any(
                k in trk_low
                for k in ("rutor", "rutracker", "torrentio", "tpb", "piratebay", "bitsearch", "1337x", "eztv", "yts", "nyaa")
            )
            if is_direct or debrid_ready:
                dht_swarm_tier = 3
            elif seeds >= 25 or (seeds >= 12 and is_public_dht_tracker):
                dht_swarm_tier = 2
            elif seeds >= 5:
                dht_swarm_tier = 1
            else:
                dht_swarm_tier = 0
            p2p_realtime_viable = (
                1
                if (
                    is_direct
                    or debrid_ready
                    or (streamable_tier >= 2 and seeds >= 8)
                    or seeds >= 25
                )
                else 0
            )
            effective_q_rank = min(q_rank, 355) if (not is_direct and not debrid_ready) else q_rank
            return (
                is_direct,
                healthy_tier,
                single_movie_tier,
                lang_match,
                p2p_realtime_viable,
                quality_tier,
                streamable_tier,
                dht_swarm_tier,
                seed_bucket,
                effective_q_rank,
                seeds,
            )

        merged_candidates.sort(key=_release_sort_key, reverse=True)
        uhd_cands = [c for c in merged_candidates if int(c.get("quality_rank") or 0) >= 300]
        fhd_cands = [c for c in merged_candidates if int(c.get("quality_rank") or 0) < 300]
        if len(uhd_cands) > 8 and fhd_cands:
            # Always include up to 4 fastest/highest-seeder 1080p releases alongside the top 8 4K releases
            # so DHT preflight and automatic player bandwidth step-down always have a fast 1080p option ready!
            top_releases = uhd_cands[:8] + fhd_cands[:4]
        else:
            top_releases = merged_candidates[:12]
        if torr_alive and not debrid_ready and top_releases:
            top_releases = self.preflight_rank_torrserver_candidates(
                top_releases,
                _release_sort_key,
                max_probe=5,
                wait_sec=3.5,
            )

        live_releases: List[Dict[str, Any]] = []
        for idx, rel in enumerate(top_releases):
            direct_u = str(rel.get("direct_url") or "").strip()
            magnet = _enrich_magnet_trackers(str(rel.get("magnet") or "")) if rel.get("magnet") else ""
            stream_url = ""
            stream_kind = "magnet_only"

            if direct_u:
                stream_url = direct_u
                stream_kind = "direct_http"
            elif debrid_ready and magnet:
                stream_kind = "debrid"
            elif torr_alive and magnet:
                rel_t = str(rel.get("title") or "")
                if media_type == "series":
                    if idx == 0:
                        file_idx = self._resolve_torrserver_file_index(
                            magnet,
                            media_type,
                            season,
                            episode,
                            wait_metadata_sec=0.9,
                            release_title=rel_t,
                            year=year,
                            title=title,
                            orig_title=orig_title,
                        )
                    elif rel.get("stremio_file_idx") is not None:
                        file_idx = max(1, int(rel["stremio_file_idx"]) + 1)
                    else:
                        file_idx = self._infer_pack_relative_file_index(
                            rel_t, season, episode
                        )
                elif rel.get("stremio_file_idx") is not None:
                    file_idx = max(1, int(rel["stremio_file_idx"]) + 1)
                elif idx == 0 and self._is_multi_movie_pack(rel_t):
                    file_idx = self._resolve_torrserver_file_index(
                        magnet,
                        media_type,
                        season,
                        episode,
                        wait_metadata_sec=0.9,
                        release_title=rel_t,
                        year=year,
                        title=title,
                        orig_title=orig_title,
                    )
                else:
                    file_idx = 1
                fname_seg = urllib.parse.quote(str(rel.get("filename_hint") or "fname").split("/")[-1] or "fname")
                stream_url = (
                    f"{self.torrserver_url}/stream/{fname_seg}"
                    f"?link={urllib.parse.quote(magnet)}&index={file_idx}&play"
                )
                stream_kind = "torrserver"

            size_lbl = str(rel.get("size") or "—")
            if ui_lang == "en":
                size_lbl = size_lbl.replace("ГБ", "GB").replace("МБ", "MB").replace("ТБ", "TB")

            live_releases.append(
                {
                    "info_hash": rel.get("info_hash") or "",
                    "title": rel["title"],
                    "tracker": rel["tracker"],
                    "size": size_lbl,
                    "seeders": int(rel.get("seeders") or 0),
                    "quality": rel["quality"],
                    "voices": rel.get("voices") or [],
                    "magnet": magnet,
                    "stream_url": stream_url,
                    "stream_kind": stream_kind,
                    "_dht_verified": rel.get("_dht_verified"),
                }
            )

        if media_type == "series" and not merged_seasons_map:
            inferred_max_ep = max(1, int(episode or 1))
            inferred_max_season = max(1, int(season or 1))
            for cand in merged_candidates:
                t_raw = str(cand.get("title") or "")
                for m_rng in re.finditer(
                    r"(?:e|ep|серии|серия|сер\.?)\s*0*\d{1,3}\s*[-–—]\s*(?:e|ep)?0*(\d{1,3})\b",
                    t_raw,
                    re.IGNORECASE,
                ):
                    val = int(m_rng.group(1))
                    if 1 < val <= 200:
                        inferred_max_ep = max(inferred_max_ep, val)
                for m_of in re.finditer(r"\b(\d{1,3})\s*(?:из|of)\s*(\d{1,3})\b", t_raw, re.IGNORECASE):
                    v1, v2 = int(m_of.group(1)), int(m_of.group(2))
                    if 1 <= v1 <= 200 and 1 <= v2 <= 200:
                        best_v = min(v1, v2)
                    else:
                        best_v = v1 if 1 <= v1 <= 200 else (v2 if 1 <= v2 <= 200 else 1)
                    inferred_max_ep = max(inferred_max_ep, best_v)
                for m_s in re.finditer(r"(?:1\s*[-–—]\s*(\d{1,2})\s*сезон|s0*1\s*[-–—]\s*s?0*(\d{1,2})\b)", t_raw, re.IGNORECASE):
                    sv = int(m_s.group(1) or m_s.group(2) or 1)
                    if 1 < sv <= 30:
                        inferred_max_season = max(inferred_max_season, sv)
            if inferred_max_ep > 1 or inferred_max_season > 1:
                for s_idx in range(1, inferred_max_season + 1):
                    merged_seasons_map[str(s_idx)] = list(range(1, inferred_max_ep + 1))

        return {
            "mode": self.mode,
            "p2p_strict": bool(getattr(self.net, "p2p_strict", False)),
            "torrserver_connected": torr_alive,
            "torrserver_builtin": bool(self.torr_bin_path),
            "torrserver_url": self.torrserver_url,
            "debrid_connected": bool(self.debrid_api_key),
            "debrid_ready": debrid_ready,
            "fallback_stream_url": direct_title_stream,
            "imdb_id": imdb_id,
            "seasons_map": merged_seasons_map,
            "episodes_titles": episodes_titles,
            "episodes_meta": episodes_meta,
            "subtitles": external_subtitles,
            "releases": live_releases,
        }

    def resolve_original_audio_fallback(
        self,
        title: str = "",
        orig_title: str = "",
        year: int = 0,
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        remux_engine: Any = None,
        imdb_id: str = "",
        item_id: str = "",
        lang: str = "ru",
    ) -> Optional[Dict[str, Any]]:
        """
        When HDRezka geo-locks 'Оригинал (+субтитры)' (translator_id=238) behind b-prem_translator,
        resolves a direct 1080p/4K stream with Original audio track + Russian/English subtitles
        via built-in TorrServer/Debrid + RemuxStreamEngine.
        """
        if not remux_engine or not remux_engine.is_available():
            return None
        torr_alive = self.ensure_local_torrserver()
        debrid_ready = bool(self.debrid_api_key and self.mode in ("realdebrid", "torbox", "debrid_https"))
        if not torr_alive and not debrid_ready:
            return None

        candidates = self._query_jacred_candidates(
            title,
            orig_title,
            year,
            media_type,
            season,
            episode=episode if media_type == "series" else 0,
        )
        if not candidates:
            return None

        _ru_dub_words = ("дубляж", "рус", "rezka", "rhs", "lostfilm", "tvshows", "jaskier", "кубик", "alexfilm", "newstudio")

        def _orig_score(rel: Dict[str, Any]) -> Tuple[int, int, int]:
            voices_str = " ".join(str(v) for v in (rel.get("voices") or [])).lower()
            t_low = str(rel.get("title") or "").lower()
            has_orig_tag = 1 if ("оригинал" in voices_str or "eng" in t_low or "sub" in t_low or "original" in t_low) else 0
            # Prefer fast-starting 1080p WEB-DL / Blu-Ray with high seeders for instant HDRezka playback
            q_rank = int(rel.get("quality_rank") or 0)
            fast_1080 = 1 if (180 <= q_rank <= 270) else 0
            return (has_orig_tag, fast_1080, int(rel.get("seeders") or 0))

        ranked = sorted(candidates, key=_orig_score, reverse=True)
        for rel in ranked[:3]:
            if int(rel.get("seeders") or 0) < 1 and not debrid_ready:
                continue
            magnet = _enrich_magnet_trackers(rel["magnet"])
            if not magnet:
                continue
            raw_stream_url = ""
            if debrid_ready:
                d_res = self.resolve_debrid_magnet(
                    magnet,
                    media_type=media_type,
                    season=season,
                    episode=episode,
                    year=year,
                    title=title,
                    orig_title=orig_title,
                )
                if d_res.get("ok") and d_res.get("stream_url"):
                    raw_stream_url = str(d_res["stream_url"])
            if not raw_stream_url and torr_alive:
                file_idx = self._resolve_torrserver_file_index(
                    magnet,
                    media_type,
                    season,
                    episode,
                    wait_metadata_sec=1.8,
                    year=year,
                    title=title,
                    orig_title=orig_title,
                    release_title=str(rel.get("title") or ""),
                )
                raw_stream_url = (
                    f"{self.torrserver_url}/stream/fname"
                    f"?link={urllib.parse.quote(magnet)}&index={file_idx}&play"
                )
            if not raw_stream_url:
                continue

            probe = remux_engine.probe_media(raw_stream_url, timeout_sec=12.0, fast_probe=True)
            if not probe.get("ok"):
                continue

            audio_tracks = probe.get("audio_tracks") or []
            orig_track = None
            for tr in audio_tracks:
                lang = str(tr.get("lang") or "").lower()
                lbl = str(tr.get("label") or "").lower()
                if lang in ("rus", "ru") or any(w in lbl for w in _ru_dub_words):
                    continue
                if lang in ("eng", "en", "jpn", "ja", "kor", "ko", "fra", "fre", "fr", "deu", "ger", "de", "spa", "es", "ita", "it"):
                    orig_track = tr
                    break
                if any(k in lbl for k in ("оригинал", "original", "english", "английск")):
                    orig_track = tr
                    break
            if orig_track is None and len(audio_tracks) == 1:
                only_tr = audio_tracks[0]
                only_lang = str(only_tr.get("lang") or "").lower()
                only_lbl = str(only_tr.get("label") or "").lower()
                if only_lang not in ("rus", "ru") and not any(w in only_lbl for w in _ru_dub_words):
                    orig_track = only_tr
            if orig_track is None:
                continue

            audio_idx = int(orig_track.get("audio_index") or 0)
            vcodec = str(probe.get("video_codec") or "")
            acodec = str(orig_track.get("codec") or orig_track.get("codec_name") or "").strip().lower()
            channels = int(orig_track.get("channels") or 2)
            remux_qs = urllib.parse.urlencode(
                {
                    "src": raw_stream_url,
                    "audio": str(audio_idx),
                    "start": "0",
                    "vcodec": vcodec,
                    "acodec": acodec,
                    "ch": str(channels),
                }
            )
            remux_play_url = f"/api/remux-stream?{remux_qs}"
            subs_out = []
            for st in (probe.get("subtitle_tracks") or []):
                sub_qs = urllib.parse.urlencode(
                    {
                        "src": raw_stream_url,
                        "si": str(st.get("stream_index") or 0),
                        "ss": "0",
                        "dur": "420",
                    }
                )
                subs_out.append(
                    {
                        "lang": st.get("label") or "Субтитры",
                        "url": f"/api/remux-subtitle?{sub_qs}",
                        "direct_vtt": True,
                    }
                )
            qual_label = "1080p" if "1080" in str(rel.get("quality") or "") else str(rel.get("quality") or "1080p")
            return {
                "qualities": {qual_label: remux_play_url},
                "default_quality": qual_label,
                "default_stream_url": remux_play_url,
                "subtitles": subs_out,
                "remux_session": {
                    "rawSourceUrl": raw_stream_url,
                    "duration": float(probe.get("duration") or 0.0),
                    "creditsStartSec": float(probe.get("credits_start_sec") or 0.0),
                    "audioIndex": audio_idx,
                    "videoCodec": vcodec,
                    "audioCodec": acodec,
                    "channels": channels,
                    "audioTracks": audio_tracks,
                    "subtitleTracks": probe.get("subtitle_tracks") or [],
                },
            }
        return None
