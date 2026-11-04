import concurrent.futures
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
    r"\b(camrip|hdcam|telesync|telesynch|hdts|telecine|dvdscr|screener|workprint)\b",
    re.IGNORECASE,
)
_AMBIGUOUS_TRASH_QUALITY_RE = re.compile(r"\b(cam|ts|tc|scr)\b", re.IGNORECASE)
_HQ_SOURCE_MARKER_RE = re.compile(
    r"\b(bdremux|remux|blu-?ray|bdrip|web-?dl|webrip|2160p|1080p|uhd|hevc|h\.?265)\b",
    re.IGNORECASE,
)
_CTRL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")
_BTIH_RE = re.compile(r"btih:([a-fA-F0-9]{40}|[A-Za-z2-7]{32})\b", re.IGNORECASE)


class _NoTorrRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.URLError("Disallowed TorrServer redirect")


def _natural_sort_key(text: str) -> List[Any]:
    return [int(tok) if tok.isdigit() else tok.lower() for tok in re.split(r"(\d+)", str(text or ""))]


def _normalize_torrserver_url(raw_url: str, cineflow_port: int = 8765) -> str:
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
    if host in ("127.0.0.1", "localhost", "::1") and int(port) == int(cineflow_port):
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
_PUBLIC_TRACKERS_SUFFIX = (
    "&tr=udp://tracker.opentrackr.org:1337/announce"
    "&tr=udp://open.stealth.si:80/announce"
    "&tr=udp://exodus.desync.com:6969/announce"
    "&tr=http://bt.t-ru.org/ann?magnet"
    "&tr=udp://opentor.net:6969"
)


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
    if "&tr=" in mag.lower():
        return mag
    return mag + _PUBLIC_TRACKERS_SUFFIX


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
        return s

    @staticmethod
    def _build_torr_opener() -> urllib.request.OpenerDirector:
        return urllib.request.build_opener(
            _NoTorrRedirectHandler(),
            urllib.request.ProxyHandler({}),
        )

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
                self.torrserver_url = norm_torr
                self._torr_tuned = False

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
        if self._is_torrserver_alive():
            if not self._torr_tuned:
                with self._torr_lock:
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

        with self._torr_lock:
            if self._is_torrserver_alive():
                if not self._torr_tuned:
                    self._tune_torrserver_ram_cache()
                return True
            prev_proc = self._torr_proc
            if prev_proc is not None and prev_proc.poll() is None:
                # Our previous instance is still starting (first-run DB init / AV scan): wait, never double-spawn
                wait_deadline = time.time() + 8.0
                while time.time() < wait_deadline and prev_proc.poll() is None:
                    if self._is_torrserver_alive():
                        self._tune_torrserver_ram_cache()
                        return True
                    time.sleep(0.15)
                if prev_proc.poll() is None:
                    return False
            if prev_proc is not None:
                try:
                    prev_proc.wait(timeout=0.5)
                except Exception:
                    pass
                self._torr_proc = None
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
                with open(log_path, "ab") as log_fh:
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
                    self._tune_torrserver_ram_cache()
                    return True
                time.sleep(0.12)
        return self._is_torrserver_alive()

    def _tune_torrserver_ram_cache(self) -> None:
        try:
            opener = self._build_torr_opener()
            req_get = urllib.request.Request(
                f"{self.torrserver_url}/settings",
                data=json.dumps({"action": "get"}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with opener.open(req_get, timeout=1.2) as r:
                cur_cfg = json.loads(r.read(262144).decode("utf-8", errors="ignore") or "{}")
            if isinstance(cur_cfg, dict) and cur_cfg:
                cur_cfg["CacheSize"] = 268435456  # 256 MB RAM ring buffer
                cur_cfg["ReaderReadAhead"] = 95
                cur_cfg["PreloadCache"] = 0
                cur_cfg["PreloadBuffer"] = False
                cur_cfg["UseDisk"] = False
                req_set = urllib.request.Request(
                    f"{self.torrserver_url}/settings",
                    data=json.dumps({"action": "set", "sets": cur_cfg}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with opener.open(req_set, timeout=1.2) as r_set:
                    r_set.read(65536)
                self._torr_tuned = True
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
    ) -> Optional[Any]:
        video_files = cls._filter_main_video_files(files, path_key, size_key)
        if not video_files:
            return None

        if media_type != "series":
            best = max(video_files, key=lambda x: int(x.get(size_key) or x.get("length") or x.get("bytes") or 0))
            return best.get(id_key)

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
        scrub_noise_re = re.compile(
            r"(?:\[[0-9a-fA-F]{8}\]|\b(?:2160p?|1080[pi]?|720p?|480p?|x264|x265|h\.?264|h\.?265|hevc|av1|(?:ddp?|ac-?3|eac-?3|dts(?:-hd)?|truehd|atmos|flac|opus|aac)\s*[257]\.[01]|[57]\.1|10-?bit|hdr10\+?|19\d{2}|20\d{2})\b)",
            re.IGNORECASE,
        )
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

    def _fetch_torrserver_file_stats(
        self,
        magnet: str,
        wait_metadata_sec: float = 0.0,
    ) -> List[Dict[str, Any]]:
        enriched_mag = _enrich_magnet_trackers(magnet)
        info_hash = _extract_btih_hex(enriched_mag)
        try:
            opener = self._build_torr_opener()
            req = urllib.request.Request(
                f"{self.torrserver_url}/torrents",
                data=json.dumps({"action": "add", "link": enriched_mag, "save_to_db": False}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with opener.open(req, timeout=2.5) as resp:
                data = json.loads(resp.read(2 * 1024 * 1024).decode("utf-8", errors="ignore") or "{}")
            file_stats = data.get("file_stats") or []
            if not file_stats and info_hash and wait_metadata_sec > 0:
                deadline = time.time() + wait_metadata_sec
                while time.time() < deadline:
                    time.sleep(0.32)
                    req_get = urllib.request.Request(
                        f"{self.torrserver_url}/torrents",
                        data=json.dumps({"action": "get", "hash": info_hash}).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    with opener.open(req_get, timeout=2.0) as r_get:
                        d_get = json.loads(r_get.read(2 * 1024 * 1024).decode("utf-8", errors="ignore") or "{}")
                    file_stats = d_get.get("file_stats") or []
                    if file_stats:
                        break
            if isinstance(file_stats, list):
                return file_stats
        except Exception:
            pass
        return []

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
    ) -> int:
        if media_type != "series":
            return 1
        file_stats = self._fetch_torrserver_file_stats(magnet, wait_metadata_sec=wait_metadata_sec)
        if file_stats:
            matched_id = self._match_episode_from_files(
                file_stats, "path", "id", "length", media_type, season, episode
            )
            if matched_id is not None and int(matched_id) > 0:
                return int(matched_id)
        return self._infer_pack_relative_file_index(release_title or magnet, season, episode)

    def resolve_torrserver_stream(
        self,
        magnet: str,
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        file_index: Optional[int] = None,
        filename_hint: str = "",
        lang: str = "ru",
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
        file_stats = self._fetch_torrserver_file_stats(enriched_mag, wait_metadata_sec=3.8)
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
                file_stats, "path", "id", "length", media_type, season, episode
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

        cache_key = f"{prov}:{clean_mag}:{media_type}:s{season}e{episode}"
        now_mono = time.monotonic()
        with self._cache_lock:
            cached_entry = self._debrid_cache.get(cache_key)
            if cached_entry and (now_mono - cached_entry[1]) < 3600.0:
                return {"ok": True, "stream_url": cached_entry[0], "provider": prov}

        if prov == "torbox":
            res = self._resolve_torbox_magnet(clean_mag, media_type, season, episode, is_en=is_en)
        else:
            res = self._resolve_realdebrid_magnet(clean_mag, media_type, season, episode, is_en=is_en)

        if res.get("ok") and res.get("stream_url"):
            with self._cache_lock:
                if len(self._debrid_cache) >= 256:
                    for k_ev in list(self._debrid_cache.keys())[:64]:
                        self._debrid_cache.pop(k_ev, None)
                self._debrid_cache[cache_key] = (str(res["stream_url"]), now_mono)
        return res

    _DEBRID_SSL_CTX = ssl.create_default_context()

    @classmethod
    def _build_debrid_api_opener(cls) -> urllib.request.OpenerDirector:
        return urllib.request.build_opener(
            _SafeRedirectHandler(),
            urllib.request.HTTPSHandler(context=cls._DEBRID_SSL_CTX),
            urllib.request.ProxyHandler({}),
        )

    def _resolve_realdebrid_magnet(
        self, magnet: str, media_type: str, season: int, episode: int, is_en: bool = False
    ) -> Dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.debrid_api_key}",
            "User-Agent": "CineFlow/2.0",
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
                files, "path", "id", "bytes", media_type, season, episode
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
        self, magnet: str, media_type: str, season: int, episode: int, is_en: bool = False
    ) -> Dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.debrid_api_key}",
            "User-Agent": "CineFlow/2.0",
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
                files, "name", "id", "size", media_type, season, episode
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
    def _norm_title_segment(text: str) -> str:
        s = html.unescape(str(text or "")).lower().replace("ё", "е")
        s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
        s = re.sub(r"_+", " ", s)
        return re.sub(r"\s+", " ", s).strip()

    @classmethod
    def _strip_en_article(cls, norm_s: str) -> str:
        return re.sub(r"^(?:the|a|an)\s+", "", norm_s).strip()

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

        tail_split_re = re.compile(
            r"\b(?:s\d{1,2}(?:e\d{1,3})?|season\s*:?\s*\d+|сезоны?\s*:?\s*\d+|\d+\s*(?:-?й\s*)?сезон|серии\s*:?\s*\d+|серия\s*:?\s*\d+|19\d{2}|20\d{2}|2160p|1080p|720p|4k|uhd|web-?dl|webrip|bdremux|bdrip|blu-?ray|hdr\d*|hevc|x264|x265)\b",
            re.IGNORECASE,
        )
        candidate_norms: List[str] = []
        for rp in raw_Parts:
            trimmed = tail_split_re.split(rp, maxsplit=1)[0].strip()
            cn = cls._norm_title_segment(trimmed)
            if cn and cn not in candidate_norms:
                candidate_norms.append(cn)

        if not candidate_norms:
            return False

        for t_norm in targets:
            t_art = cls._strip_en_article(t_norm)
            for c_norm in candidate_norms:
                c_art = cls._strip_en_article(c_norm)
                if c_norm == t_norm or (t_art and len(t_art) >= 3 and c_art == t_art):
                    return True
                if len(t_norm) >= 6 and len(c_norm) >= 6:
                    if c_norm.startswith(t_norm + " ") or t_norm.startswith(c_norm + " "):
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
        if len(search_terms) > 1 and len(search_terms[0]) > 5:
            search_terms = search_terms[:1]
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
        jac_pool = concurrent.futures.ThreadPoolExecutor(max_workers=max(1, len(tasks)))
        try:
            futs = [jac_pool.submit(_fetch_host_term, h, term) for h, term in tasks]
            done, _ = concurrent.futures.wait(futs, timeout=3.2)
            for f in done:
                try:
                    batch = f.result()
                    if batch:
                        raw_batches.append(batch)
                except Exception:
                    continue
        finally:
            jac_pool.shutdown(wait=False, cancel_futures=True)

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
                candidates.append(
                    {
                        "info_hash": info_hash,
                        "title": rel_title,
                        "tracker": str(item.get("tracker") or "Rutor / Rutracker"),
                        "size": str(item.get("sizeName") or "—"),
                        "seeders": seeders,
                        "quality": quality_badge,
                        "quality_rank": quality_rank,
                        "voices": item.get("voices") or ["Дубляж", "Оригинал"],
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

        pool = concurrent.futures.ThreadPoolExecutor(max_workers=3)
        try:
            fut_jac = pool.submit(
                self._query_jacred_candidates,
                title,
                orig_title,
                year,
                media_type,
                season,
                episode if media_type == "series" else 0,
            )
            fut_cdn = pool.submit(
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
            fut_stremio = (
                pool.submit(
                    stremio_engine.get_streams_for_title,
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    year=year,
                    media_type=media_type,
                    season=season,
                    episode=episode,
                    lang=ui_lang,
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
            pool.shutdown(wait=False, cancel_futures=True)

        direct_title_stream = (real_cdn_data or {}).get("default_stream_url", "")
        external_subtitles = list(stremio_payload.get("subtitles") or [])
        imdb_id = str(stremio_payload.get("imdb_id") or (real_cdn_data or {}).get("imdb_id") or "").strip()

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
            if q_rank < 200:
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

        def _release_sort_key(r: Dict[str, Any]) -> Tuple[Any, ...]:
            is_direct = 1 if r.get("direct_url") else 0
            seeds = int(r.get("seeders") or 0)
            q_rank = int(r.get("quality_rank") or 0)
            healthy_tier = 2 if (is_direct or seeds >= 5) else (1 if seeds >= 1 else 0)
            is_uhd = 1 if q_rank >= 300 else 0
            voices_join = " ".join(str(v) for v in (r.get("voices") or [])).lower()
            has_ru = bool(
                r.get("has_russian")
                or any(k in voices_join for k in ("ru", "рус", "дубляж", "hdrezka", "lostfilm", "jaskier", "кубик", "rhs"))
            )
            lang_match = (0 if has_ru else 1) if ui_lang == "en" else (1 if has_ru else 0)
            seed_bucket = min(seeds, 60) // 12
            return (is_direct, healthy_tier, is_uhd, lang_match, seed_bucket, q_rank, seeds)

        merged_candidates.sort(key=_release_sort_key, reverse=True)
        top_releases = merged_candidates[:12]

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
                if media_type == "series":
                    if idx == 0:
                        file_idx = self._resolve_torrserver_file_index(
                            magnet,
                            media_type,
                            season,
                            episode,
                            wait_metadata_sec=0.9,
                            release_title=str(rel.get("title") or ""),
                        )
                    elif rel.get("stremio_file_idx") is not None:
                        file_idx = max(1, int(rel["stremio_file_idx"]) + 1)
                    else:
                        file_idx = self._infer_pack_relative_file_index(
                            str(rel.get("title") or ""), season, episode
                        )
                elif rel.get("stremio_file_idx") is not None:
                    file_idx = max(1, int(rel["stremio_file_idx"]) + 1)
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
                d_res = self.resolve_debrid_magnet(magnet, media_type=media_type, season=season, episode=episode)
                if d_res.get("ok") and d_res.get("stream_url"):
                    raw_stream_url = str(d_res["stream_url"])
            if not raw_stream_url and torr_alive:
                file_idx = self._resolve_torrserver_file_index(
                    magnet,
                    media_type,
                    season,
                    episode,
                    wait_metadata_sec=1.8,
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
