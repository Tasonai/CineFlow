"""
Velarium Self-Update & Release Verification Engine (`backend/updater.py`)

Provides:
- Semantic version parsing and comparison (`X.Y.Z`)
- Checking GitHub Releases API (`https://api.github.com/repos/{repo}/releases/latest`)
  or a custom manifest URL (`latest.json`)
- Platform-aware asset selection (`.dmg` on macOS, `*Setup*.exe` / `.exe` on Windows)
- SHA-256 digest extraction (GitHub `asset.digest`, `latest.json`, or `SHA256SUMS.txt`)
- Background download into `~/Downloads` with atomic `.part` file, SSRF-safe HTTPS
  redirect validation, live progress tracking, and SHA-256 / file-size verification
- Launching/mounting the downloaded installer (`.dmg` / `Setup.exe`) in 1 click
"""

import hashlib
import http.client
import json
import logging
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, Optional, Tuple

from backend.doh import (
    _is_disallowed_hostname,
    _is_valid_public_ip_addr,
    validate_safe_external_url,
)

logger = logging.getLogger("Velarium.Updater")

DEFAULT_UPDATE_REPO = os.environ.get("CINEFLOW_UPDATE_REPO", "tasonai/CineFlow")
DEFAULT_UPDATE_MANIFEST_URL = os.environ.get("CINEFLOW_UPDATE_MANIFEST_URL", "")


def parse_semver(version_str: str) -> Tuple[int, int, int, int]:
    """
    Parses a version string like 'v2.6.7', '2.6.7', or '2.6.7.0' into a comparable
    4-tuple of ints `(major, minor, patch, build)`. Returns `(0, 0, 0, 0)` if invalid.
    """
    raw = str(version_str or "").strip()
    m = re.search(r"v?(\d+)\.(\d+)(?:\.(\d+))?(?:\.(\d+))?", raw, re.IGNORECASE)
    if not m:
        return (0, 0, 0, 0)
    return (
        int(m.group(1) or 0),
        int(m.group(2) or 0),
        int(m.group(3) or 0),
        int(m.group(4) or 0),
    )


def normalize_version_str(version_str: str) -> str:
    sem = parse_semver(version_str)
    if sem == (0, 0, 0, 0):
        return ""
    if sem[3] > 0:
        return f"{sem[0]}.{sem[1]}.{sem[2]}.{sem[3]}"
    return f"{sem[0]}.{sem[1]}.{sem[2]}"


def is_newer_version(candidate: str, current: str) -> bool:
    cand_t = parse_semver(candidate)
    curr_t = parse_semver(current)
    if cand_t == (0, 0, 0, 0):
        return False
    return cand_t > curr_t


def get_platform_key() -> str:
    if sys.platform == "darwin":
        return "macos"
    if sys.platform == "win32":
        return "windows"
    return "linux"


class _SafeUpdateHTTPSConnection(http.client.HTTPSConnection):
    def connect(self) -> None:
        if getattr(self, "_tunnel_host", None):
            raise urllib.error.URLError("Disallowed HTTPS CONNECT tunnel")
        if _is_disallowed_hostname(self.host):
            raise urllib.error.URLError(f"Disallowed update host: {self.host}")
        try:
            infos = socket.getaddrinfo(self.host, self.port or 443, type=socket.SOCK_STREAM)
        except Exception as exc:
            raise urllib.error.URLError(str(exc)) from exc
        public_addrs = []
        for family, socktype, proto, _canon, sockaddr in infos:
            cand_ip = str(sockaddr[0]).split("%", 1)[0]
            if not _is_valid_public_ip_addr(cand_ip):
                raise urllib.error.URLError(f"Disallowed non-public DNS target IP: {cand_ip}")
            public_addrs.append((family, socktype, proto, sockaddr))
        if not public_addrs:
            raise urllib.error.URLError("No public address found for update host")
        last_err: Optional[Exception] = None
        for family, socktype, proto, sockaddr in public_addrs:
            s = None
            try:
                s = socket.socket(family, socktype, proto)
                if self.timeout is not socket._GLOBAL_DEFAULT_TIMEOUT and self.timeout is not None:
                    s.settimeout(self.timeout)
                if self.source_address:
                    s.bind(self.source_address)
                s.connect(sockaddr)
                peer_ip = str(s.getpeername()[0]).split("%", 1)[0]
                if not _is_valid_public_ip_addr(peer_ip):
                    s.close()
                    raise urllib.error.URLError(f"Disallowed non-public peer IP: {peer_ip}")
                self.sock = self._context.wrap_socket(s, server_hostname=self.host)
                return
            except urllib.error.URLError:
                if s is not None:
                    try:
                        s.close()
                    except Exception:
                        pass
                raise
            except Exception as exc:
                last_err = exc
                if s is not None:
                    try:
                        s.close()
                    except Exception:
                        pass
        raise urllib.error.URLError(str(last_err or "Failed to connect to update host"))


class _SafeUpdateHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_SafeUpdateHTTPSConnection, req, context=self._context)


class _SafeUpdateRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        full_new = urllib.parse.urljoin(req.full_url, newurl)
        parsed = urllib.parse.urlparse(full_new)
        if parsed.scheme.lower() != "https" or not validate_safe_external_url(full_new):
            if fp is not None:
                try:
                    fp.close()
                except Exception:
                    pass
            raise urllib.error.URLError(f"Unsafe redirect blocked during update download: {full_new}")
        redirected = super().redirect_request(req, fp, code, msg, headers, full_new)
        if redirected is not None:
            parsed_old = urllib.parse.urlparse(req.full_url)
            if (parsed_old.hostname or "").lower() != (parsed.hostname or "").lower():
                for sensitive_hdr in ("Authorization", "Cookie", "Proxy-Authorization", "Origin"):
                    for hdr_dict in (redirected.headers, redirected.unredirected_hdrs):
                        for existing_k in list(hdr_dict.keys()):
                            if existing_k.lower() == sensitive_hdr.lower():
                                hdr_dict.pop(existing_k, None)
        return redirected


class AppUpdater:
    """
    Manages update checks, installer downloads with SHA-256 verification, and 1-click launch.
    """

    USER_AGENT = "Velarium-Updater/2.7 (+https://github.com)"

    def __init__(
        self,
        current_version: str,
        storage_dir: str,
        settings_getter: Optional[Callable[[], Dict[str, Any]]] = None,
    ) -> None:
        self.current_version = normalize_version_str(current_version) or str(current_version).strip()
        self.storage_dir = storage_dir
        self._settings_getter = settings_getter
        self._lock = threading.RLock()
        self._download_thread: Optional[threading.Thread] = None
        self._cancel_requested = False

        self._status: Dict[str, Any] = {
            "state": "idle",  # idle | checking | available | up_to_date | downloading | downloaded | installing | error
            "current_version": self.current_version,
            "latest_version": self.current_version,
            "update_available": False,
            "platform": get_platform_key(),
            "release_title": "",
            "release_notes": "",
            "release_notes_en": "",
            "published_at": "",
            "html_url": "",
            "asset_name": "",
            "asset_url": "",
            "asset_size": 0,
            "expected_sha256": "",
            "progress_pct": 0.0,
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "file_path": "",
            "sha256_verified": False,
            "last_checked_at": 0.0,
            "error": "",
            "source_configured": True,
        }

    def _get_config(self) -> Tuple[str, str]:
        repo = DEFAULT_UPDATE_REPO
        manifest_url = DEFAULT_UPDATE_MANIFEST_URL
        if callable(self._settings_getter):
            try:
                cfg = self._settings_getter() or {}
                custom_repo = str(cfg.get("update_repo") or "").strip().strip("/")
                custom_manifest = str(cfg.get("update_manifest_url") or "").strip()
                if custom_repo and re.match(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", custom_repo):
                    if custom_repo.lower() == "tasonai/velarium":
                        repo = DEFAULT_UPDATE_REPO
                    else:
                        repo = custom_repo
                if custom_manifest and custom_manifest.lower().startswith("https://") and validate_safe_external_url(custom_manifest):
                    manifest_url = custom_manifest
            except Exception:
                pass
        return repo, manifest_url

    def _enrich_status(self, snap: Dict[str, Any]) -> Dict[str, Any]:
        repo, manifest_url = self._get_config()
        state_val = str(snap.get("state") or "idle")
        err_val = str(snap.get("error") or "")
        if state_val == "downloaded":
            dl_state = "ready"
        elif state_val in ("downloading", "error"):
            dl_state = state_val
        else:
            dl_state = "idle"
        html_url = str(snap.get("html_url") or (f"https://github.com/{repo}/releases/latest" if repo else ""))
        enriched = dict(snap)
        enriched.update(
            {
                "ok": state_val != "error" and not bool(err_val),
                "checking": state_val == "checking",
                "download_state": dl_state,
                "download_progress": float(snap.get("progress_pct") or 0.0),
                "downloaded_path": str(snap.get("file_path") or ""),
                "download_error": err_val if state_val == "error" else "",
                "release_page_url": html_url,
                "html_url": html_url,
                "update_repo": repo,
                "update_manifest_url": manifest_url,
                "source_configured": bool(repo or manifest_url),
            }
        )
        result = dict(enriched)
        result["updater"] = dict(enriched)
        return result

    def get_status(self, redact_local_paths: bool = False) -> Dict[str, Any]:
        with self._lock:
            snap = dict(self._status)
        file_p = str(snap.get("file_path") or "").strip()
        if snap.get("state") == "downloaded" and file_p and not os.path.isfile(file_p):
            with self._lock:
                self._status["state"] = "available" if self._status.get("update_available") else "idle"
                self._status["file_path"] = ""
                self._status["progress_pct"] = 0.0
                snap = dict(self._status)
        res = self._enrich_status(snap)
        if redact_local_paths:
            for target_d in (res, res.get("updater")):
                if isinstance(target_d, dict):
                    target_d["file_path"] = ""
                    target_d["downloaded_path"] = ""
                    target_d["update_repo"] = ""
                    target_d["update_manifest_url"] = ""
        return res

    @staticmethod
    def _validate_https_url(url: str) -> bool:
        raw = str(url or "").strip()
        if not raw:
            return False
        parsed = urllib.parse.urlparse(raw)
        if parsed.scheme.lower() != "https":
            return False
        return validate_safe_external_url(raw)

    _UPDATER_SSL_CTX: Optional[ssl.SSLContext] = None
    _SAFE_OPENER: Optional[urllib.request.OpenerDirector] = None

    @classmethod
    def _build_safe_opener(cls) -> urllib.request.OpenerDirector:
        if cls._SAFE_OPENER is None:
            if cls._UPDATER_SSL_CTX is None:
                cls._UPDATER_SSL_CTX = ssl.create_default_context()
            cls._SAFE_OPENER = urllib.request.build_opener(
                urllib.request.ProxyHandler({}),
                _SafeUpdateHTTPSHandler(context=cls._UPDATER_SSL_CTX),
                _SafeUpdateRedirectHandler(),
            )
        return cls._SAFE_OPENER

    def _http_get_json(self, url: str, timeout: float = 10.0) -> Dict[str, Any]:
        if not self._validate_https_url(url):
            raise ValueError("Update URL must use HTTPS and resolve to a public host")
        opener = self._build_safe_opener()
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": self.USER_AGENT,
                "Accept": "application/vnd.github+json, application/json;q=0.9, */*;q=0.8",
            },
            method="GET",
        )
        with opener.open(req, timeout=timeout) as resp:
            raw = resp.read(2 * 1024 * 1024)
            return json.loads(raw.decode("utf-8", errors="replace"))

    def _http_get_text(self, url: str, timeout: float = 8.0) -> str:
        if not self._validate_https_url(url):
            raise ValueError("Update URL must use HTTPS and resolve to a public host")
        opener = self._build_safe_opener()
        req = urllib.request.Request(
            url,
            headers={"User-Agent": self.USER_AGENT},
            method="GET",
        )
        with opener.open(req, timeout=timeout) as resp:
            raw = resp.read(512 * 1024)
            return raw.decode("utf-8", errors="replace")

    @staticmethod
    def _select_platform_asset(assets: list, platform_key: str) -> Optional[Dict[str, Any]]:
        if not isinstance(assets, list):
            return None
        valid_assets = [a for a in assets if isinstance(a, dict) and a.get("browser_download_url")]
        if not valid_assets:
            return None

        if platform_key == "macos":
            dmg_assets = [
                a for a in valid_assets if str(a.get("name") or "").lower().endswith(".dmg")
            ]
            if dmg_assets:
                for a in dmg_assets:
                    nm = str(a.get("name") or "").lower()
                    if "velarium" in nm or "cineflow" in nm:
                        return a
                return dmg_assets[0]
            zip_assets = [
                a
                for a in valid_assets
                if str(a.get("name") or "").lower().endswith(".zip")
                and ("mac" in str(a.get("name") or "").lower() or "darwin" in str(a.get("name") or "").lower())
            ]
            if zip_assets:
                return zip_assets[0]
        elif platform_key == "windows":
            exe_assets = [
                a for a in valid_assets if str(a.get("name") or "").lower().endswith(".exe")
            ]
            if exe_assets:
                for a in exe_assets:
                    nm = str(a.get("name") or "").lower()
                    if "setup" in nm or "install" in nm:
                        return a
                return exe_assets[0]
            msi_assets = [
                a for a in valid_assets if str(a.get("name") or "").lower().endswith(".msi")
            ]
            if msi_assets:
                return msi_assets[0]

        return None

    def _extract_sha256_for_asset(self, asset: Dict[str, Any], all_assets: list) -> str:
        # 1. GitHub Releases native digest field ("sha256:abcdef...")
        digest_raw = str(asset.get("digest") or asset.get("sha256") or "").strip().lower()
        if digest_raw.startswith("sha256:"):
            digest_raw = digest_raw.split(":", 1)[1].strip()
        if re.fullmatch(r"[0-9a-f]{64}", digest_raw):
            return digest_raw

        # 2. Check accompanying SHA256SUMS.txt or <asset>.sha256 in release assets
        asset_name = str(asset.get("name") or "").strip()
        if not asset_name or not isinstance(all_assets, list):
            return ""
        for a in all_assets:
            if not isinstance(a, dict):
                continue
            nm = str(a.get("name") or "").strip()
            dl_url = str(a.get("browser_download_url") or "").strip()
            if not dl_url:
                continue
            if nm.lower() in (
                "sha256sums.txt",
                "sha256sums",
                "checksums.txt",
                f"{asset_name.lower()}.sha256",
            ):
                try:
                    txt = self._http_get_text(dl_url, timeout=6.0)
                    for line in txt.splitlines():
                        line_s = line.strip()
                        if not line_s:
                            continue
                        m_exact = re.match(r"^([0-9a-fA-F]{64})\s+\*?(.+)$", line_s)
                        if m_exact:
                            hash_hex, fname = m_exact.group(1).lower(), m_exact.group(2).strip()
                            if os.path.basename(fname) == asset_name:
                                return hash_hex
                        elif nm.lower() == f"{asset_name.lower()}.sha256":
                            m_only = re.match(r"^([0-9a-fA-F]{64})\b", line_s)
                            if m_only:
                                return m_only.group(1).lower()
                except Exception:
                    continue
        return ""

    def _parse_manifest_payload(self, data: Dict[str, Any], platform_key: str) -> Dict[str, Any]:
        """
        Parses either a custom `latest.json` manifest or a GitHub Releases `/releases/latest` JSON payload.
        """
        if not isinstance(data, dict):
            raise ValueError("Invalid update manifest format")

        # Case A: GitHub Releases API payload (`tag_name` + `assets`)
        if "tag_name" in data or isinstance(data.get("assets"), list):
            raw_ver = str(data.get("tag_name") or data.get("version") or "").strip()
            latest_ver = normalize_version_str(raw_ver)
            if not latest_ver:
                raise ValueError("Release tag does not contain a valid semantic version")
            assets = data.get("assets") if isinstance(data.get("assets"), list) else []
            chosen = self._select_platform_asset(assets, platform_key)
            asset_name = str(chosen.get("name") or "") if chosen else ""
            asset_url = str(chosen.get("browser_download_url") or "") if chosen else ""
            asset_size = int(chosen.get("size") or 0) if chosen else 0
            expected_sha = self._extract_sha256_for_asset(chosen, assets) if chosen else ""
            return {
                "latest_version": latest_ver,
                "release_title": str(data.get("name") or f"Velarium v{latest_ver}").strip(),
                "release_notes": str(data.get("body") or "").strip(),
                "release_notes_en": "",
                "published_at": str(data.get("published_at") or "").strip(),
                "html_url": str(data.get("html_url") or "").strip(),
                "asset_name": asset_name,
                "asset_url": asset_url,
                "asset_size": asset_size,
                "expected_sha256": expected_sha,
            }

        # Case B: Custom `latest.json` manifest
        raw_ver = str(data.get("version") or data.get("latest_version") or "").strip()
        latest_ver = normalize_version_str(raw_ver)
        if not latest_ver:
            raise ValueError("Manifest does not contain a valid version field")

        platforms_map = data.get("platforms") if isinstance(data.get("platforms"), dict) else {}
        plat_entry = (
            platforms_map.get(platform_key)
            or platforms_map.get("darwin" if platform_key == "macos" else "win32")
            or data.get(platform_key)
            or {}
        )
        if not isinstance(plat_entry, dict):
            plat_entry = {}

        asset_url = str(plat_entry.get("url") or data.get("url") or data.get("asset_url") or "").strip()
        asset_name = str(
            plat_entry.get("name")
            or data.get("asset_name")
            or (os.path.basename(urllib.parse.urlparse(asset_url).path) if asset_url else "")
        ).strip()
        if not asset_url and asset_name:
            repo, _ = self._get_config()
            if repo:
                asset_url = f"https://github.com/{repo}/releases/download/v{latest_ver}/{asset_name}"
        asset_size = int(plat_entry.get("size") or data.get("size") or 0)
        raw_sha = str(plat_entry.get("sha256") or data.get("sha256") or "").strip().lower()
        if raw_sha.startswith("sha256:"):
            raw_sha = raw_sha.split(":", 1)[1].strip()
        expected_sha = raw_sha if re.fullmatch(r"[0-9a-f]{64}", raw_sha) else ""

        return {
            "latest_version": latest_ver,
            "release_title": str(data.get("title") or data.get("name") or f"Velarium v{latest_ver}").strip(),
            "release_notes": str(data.get("notes") or data.get("release_notes") or data.get("body") or "").strip(),
            "release_notes_en": str(data.get("release_notes_en") or "").strip(),
            "published_at": str(data.get("published_at") or data.get("date") or "").strip(),
            "html_url": str(data.get("html_url") or data.get("release_url") or "").strip(),
            "asset_name": asset_name,
            "asset_url": asset_url,
            "asset_size": asset_size,
            "expected_sha256": expected_sha,
        }

    def check_for_updates(self, force: bool = False) -> Dict[str, Any]:
        now = time.time()
        with self._lock:
            if self._status.get("state") == "downloading":
                return self.get_status()
            last_chk = float(self._status.get("last_checked_at") or 0.0)
            if not force and last_chk > 0 and (now - last_chk) < 300.0 and not self._status.get("error"):
                return self.get_status()
            self._status["state"] = "checking"
            self._status["error"] = ""

        repo, manifest_url = self._get_config()
        platform_key = get_platform_key()
        urls_to_try = []
        if manifest_url:
            urls_to_try.append(manifest_url)
        if repo:
            # Prefer GitHub CDN latest.json first (no 60 req/hr API rate limit on shared/home Wi-Fi IPs)
            urls_to_try.append(f"https://github.com/{repo}/releases/latest/download/latest.json")
            urls_to_try.append(f"https://api.github.com/repos/{repo}/releases/latest")

        if not urls_to_try:
            with self._lock:
                self._status.update(
                    {
                        "state": "up_to_date",
                        "update_available": False,
                        "source_configured": False,
                        "last_checked_at": now,
                        "error": "",
                    }
                )
            return self.get_status()

        parsed_info: Optional[Dict[str, Any]] = None
        last_err_msg = ""
        not_found_only = True

        for candidate_url in urls_to_try:
            try:
                raw_json = self._http_get_json(candidate_url, timeout=10.0)
                parsed_info = self._parse_manifest_payload(raw_json, platform_key)
                break
            except urllib.error.HTTPError as he:
                if he.code != 404:
                    not_found_only = False
                last_err_msg = f"HTTP {he.code}"
            except Exception as e:
                not_found_only = False
                last_err_msg = str(e)

        with self._lock:
            cur_st = self._status.get("state")
            if cur_st == "downloading" or (
                cur_st == "installing"
                and (time.time() - float(self._status.get("install_started_at") or 0.0)) < 15.0
            ):
                return self.get_status()
            self._status["last_checked_at"] = now
            if parsed_info is None:
                if not_found_only:
                    # Repository has no published releases yet — treat cleanly as up_to_date
                    self._status.update(
                        {
                            "state": "up_to_date",
                            "latest_version": self.current_version,
                            "update_available": False,
                            "error": "",
                        }
                    )
                else:
                    self._status.update(
                        {
                            "state": "error",
                            "error": last_err_msg or "Failed to check for updates",
                        }
                    )
                return self.get_status()

            latest_ver = parsed_info["latest_version"]
            has_newer = is_newer_version(latest_ver, self.current_version)
            existing_file = str(self._status.get("file_path") or "").strip()
            already_downloaded = bool(
                has_newer
                and existing_file
                and os.path.isfile(existing_file)
                and self._status.get("latest_version") == latest_ver
                and self._status.get("state") == "downloaded"
            )

            self._status.update(
                {
                    "state": "downloaded" if already_downloaded else ("available" if has_newer else "up_to_date"),
                    "latest_version": latest_ver,
                    "update_available": has_newer,
                    "platform": platform_key,
                    "release_title": parsed_info["release_title"],
                    "release_notes": parsed_info["release_notes"],
                    "release_notes_en": parsed_info.get("release_notes_en") or "",
                    "published_at": parsed_info["published_at"],
                    "html_url": parsed_info["html_url"] or (f"https://github.com/{repo}/releases/latest" if repo else ""),
                    "asset_name": parsed_info["asset_name"],
                    "asset_url": parsed_info["asset_url"],
                    "asset_size": parsed_info["asset_size"],
                    "expected_sha256": parsed_info["expected_sha256"],
                    "file_path": existing_file if already_downloaded else "",
                    "sha256_verified": bool(self._status.get("sha256_verified")) if already_downloaded else False,
                    "error": "",
                }
            )
        return self.get_status()

    def _resolve_downloads_dir(self) -> str:
        home_dl = os.path.expanduser("~/Downloads")
        if os.path.isdir(home_dl) and os.access(home_dl, os.W_OK):
            return home_dl
        try:
            temp_dl = os.path.join(tempfile.gettempdir(), "Velarium-Updates")
            os.makedirs(temp_dl, mode=0o700, exist_ok=True)
            if os.access(temp_dl, os.W_OK):
                return temp_dl
        except OSError:
            pass
        fallback_dl = os.path.join(self.storage_dir, "updates")
        os.makedirs(fallback_dl, exist_ok=True)
        return fallback_dl

    @staticmethod
    def _create_isolated_stage_dir() -> str:
        """Create a 0o700 staging directory in OS temp (never inside $INSTDIR or storage_dir)."""
        base_tmp = tempfile.gettempdir()
        now_ts = time.time()
        try:
            for entry in os.scandir(base_tmp):
                if entry.name.startswith("velarium_upd_") and entry.is_dir(follow_symlinks=False):
                    try:
                        if (now_ts - entry.stat(follow_symlinks=False).st_mtime) > 21600:
                            shutil.rmtree(entry.path, ignore_errors=True)
                    except OSError:
                        pass
        except OSError:
            pass
        stage_dir = tempfile.mkdtemp(prefix="velarium_upd_")
        try:
            os.chmod(stage_dir, 0o700)
        except OSError:
            pass
        return stage_dir

    def start_download(
        self,
        asset_url: str = "",
        expected_sha256: str = "",
        blocking: bool = False,
        url: str = "",
        expected_size: int = 0,
        filename: str = "",
        **kwargs: Any,
    ) -> Dict[str, Any]:
        with self._lock:
            if self._status.get("state") == "downloading" and self._download_thread and self._download_thread.is_alive():
                return self.get_status()
            if (
                self._status.get("state") == "installing"
                and (time.time() - float(self._status.get("install_started_at") or 0.0)) < 15.0
            ):
                return self.get_status()
            existing_file = str(self._status.get("file_path") or "").strip()
            if (
                self._status.get("state") == "downloaded"
                and existing_file
                and os.path.isfile(existing_file)
                and not (asset_url or url)
            ):
                st = self.get_status()
                st["already_downloaded"] = True
                return st
            target_url = str(asset_url or url or self._status.get("asset_url") or "").strip()
            target_sha = str(expected_sha256 or self._status.get("expected_sha256") or "").strip().lower()
            target_name = str(filename or self._status.get("asset_name") or "").strip()
            latest_ver = str(self._status.get("latest_version") or self.current_version).strip()
            target_expected_size = int(expected_size or self._status.get("asset_size") or 0)

        if not target_url:
            chk = self.check_for_updates(force=True)
            target_url = str(chk.get("asset_url") or "").strip()
            target_sha = str(expected_sha256 or chk.get("expected_sha256") or "").strip().lower()
            target_name = str(filename or chk.get("asset_name") or "").strip()
            latest_ver = str(chk.get("latest_version") or self.current_version).strip()
            target_expected_size = int(expected_size or chk.get("asset_size") or 0)

        if not target_url:
            with self._lock:
                self._status["state"] = "error"
                self._status["error"] = "No installer asset URL available for this platform"
            return self.get_status()

        if not self._validate_https_url(target_url):
            with self._lock:
                self._status["state"] = "error"
                self._status["error"] = "Installer download URL must use HTTPS and a public host"
            return self.get_status()

        if not target_name:
            url_path = urllib.parse.urlparse(target_url).path
            target_name = os.path.basename(url_path) or (
                f"Velarium-{latest_ver}.dmg" if sys.platform == "darwin" else f"Velarium-Setup-{latest_ver}.exe"
            )
        safe_name = re.sub(r"[^A-Za-z0-9._+-]", "_", os.path.basename(target_name))
        if not safe_name.lower().endswith((".dmg", ".exe", ".msi", ".zip", ".pkg")):
            safe_name += ".dmg" if sys.platform == "darwin" else ".exe"

        dest_dir = self._resolve_downloads_dir()
        dest_path = os.path.join(dest_dir, safe_name)

        # If the exact verified installer already exists on disk in ~/Downloads, reuse it immediately
        if target_sha and os.path.isfile(dest_path):
            try:
                if not target_expected_size or os.path.getsize(dest_path) == target_expected_size:
                    h_existing = hashlib.sha256()
                    with open(dest_path, "rb") as efp:
                        for chunk in iter(lambda: efp.read(512 * 1024), b""):
                            h_existing.update(chunk)
                    if h_existing.hexdigest().lower() == target_sha.lower():
                        fsize = os.path.getsize(dest_path)
                        with self._lock:
                            self._status.update(
                                {
                                    "state": "downloaded",
                                    "asset_url": target_url,
                                    "asset_name": safe_name,
                                    "expected_sha256": target_sha,
                                    "progress_pct": 100.0,
                                    "downloaded_bytes": fsize,
                                    "total_bytes": fsize,
                                    "file_path": dest_path,
                                    "sha256_verified": True,
                                    "error": "",
                                }
                            )
                        st = self.get_status()
                        st["already_downloaded"] = True
                        return st
            except Exception:
                pass

        with self._lock:
            if self._status.get("state") == "downloading" and self._download_thread and self._download_thread.is_alive():
                return self.get_status()
            if (
                self._status.get("state") == "installing"
                and (time.time() - float(self._status.get("install_started_at") or 0.0)) < 15.0
            ):
                return self.get_status()
            self._cancel_requested = False
            self._status.update(
                {
                    "state": "downloading",
                    "asset_url": target_url,
                    "asset_name": safe_name,
                    "expected_sha256": target_sha,
                    "progress_pct": 0.0,
                    "downloaded_bytes": 0,
                    "total_bytes": target_expected_size,
                    "file_path": "",
                    "sha256_verified": False,
                    "error": "",
                }
            )

        def _worker() -> None:
            part_path = f"{dest_path}.{os.getpid()}.{threading.get_ident()}.part"
            try:
                opener = self._build_safe_opener()
                req = urllib.request.Request(
                    target_url,
                    headers={"User-Agent": self.USER_AGENT},
                    method="GET",
                )
                hasher = hashlib.sha256()
                downloaded = 0
                with opener.open(req, timeout=25.0) as resp:
                    cl_header = resp.headers.get("Content-Length")
                    total = int(cl_header) if (cl_header and str(cl_header).isdigit()) else target_expected_size
                    with self._lock:
                        self._status["total_bytes"] = total
                    max_bytes = target_expected_size if target_expected_size > 0 else (512 * 1024 * 1024)
                    last_pct = -1.0
                    last_reported_bytes = 0
                    with open(part_path, "wb") as fp:
                        while True:
                            if self._cancel_requested:
                                raise RuntimeError("Download cancelled")
                            chunk = resp.read(256 * 1024)
                            if not chunk:
                                break
                            downloaded += len(chunk)
                            if downloaded > max_bytes:
                                raise RuntimeError(f"Installer exceeds allowed maximum size ({max_bytes} bytes)")
                            fp.write(chunk)
                            hasher.update(chunk)
                            pct = round(min(99.9, (downloaded * 100.0 / total)), 1) if total > 0 else 0.0
                            if pct != last_pct or (downloaded - last_reported_bytes) >= 1048576:
                                last_pct = pct
                                last_reported_bytes = downloaded
                                with self._lock:
                                    self._status["downloaded_bytes"] = downloaded
                                    self._status["progress_pct"] = pct
                    with self._lock:
                        self._status["downloaded_bytes"] = downloaded
                        if total > 0:
                            self._status["progress_pct"] = round(min(99.9, (downloaded * 100.0 / total)), 1)

                if downloaded < 1024:
                    raise RuntimeError("Downloaded installer file is unexpectedly small or empty")
                if target_expected_size > 0 and downloaded != target_expected_size:
                    raise RuntimeError(f"Installer size mismatch ({downloaded} vs {target_expected_size} bytes)")

                actual_sha = hasher.hexdigest().lower()
                sha_ok = False
                if target_sha:
                    if actual_sha != target_sha.lower():
                        raise RuntimeError(
                            f"SHA-256 checksum mismatch (expected {target_sha[:12]}…, got {actual_sha[:12]}…)"
                        )
                    sha_ok = True

                os.replace(part_path, dest_path)
                with self._lock:
                    self._status.update(
                        {
                            "state": "downloaded",
                            "progress_pct": 100.0,
                            "downloaded_bytes": downloaded,
                            "total_bytes": downloaded,
                            "file_path": dest_path,
                            "sha256_verified": sha_ok,
                            "error": "",
                        }
                    )
            except Exception as e:
                try:
                    if os.path.exists(part_path):
                        os.remove(part_path)
                except Exception:
                    pass
                with self._lock:
                    self._status.update(
                        {
                            "state": "error",
                            "error": str(e),
                        }
                    )

        t = threading.Thread(target=_worker, daemon=True)
        with self._lock:
            self._download_thread = t
        t.start()
        if blocking:
            t.join()
        return self.get_status()

    def open_installer(self, auto_reveal: bool = False) -> Dict[str, Any]:
        with self._lock:
            if (
                not auto_reveal
                and self._status.get("state") == "installing"
                and (time.time() - float(self._status.get("install_started_at") or 0.0)) < 15.0
            ):
                st = self.get_status()
                return {
                    "ok": True,
                    "already_installing": True,
                    "file_path": str(self._status.get("file_path") or ""),
                    "status": st,
                    "updater": st,
                }
            file_path = str(self._status.get("file_path") or "").strip()
            expected_sha = str(self._status.get("expected_sha256") or "").strip()
            sha256_verified = bool(expected_sha) and bool(self._status.get("sha256_verified"))
            if not sha256_verified:
                auto_reveal = True
        if not file_path or os.path.islink(file_path) or not os.path.isfile(file_path):
            st = self.get_status()
            return {
                "ok": False,
                "error": "Installer file not found on disk. Please download the update first.",
                "status": st,
                "updater": st,
            }

        exec_path = file_path
        stage_dir_created = ""
        if not auto_reveal and sha256_verified and expected_sha:
            try:
                stage_dir_created = self._create_isolated_stage_dir()
                staged_file = os.path.join(stage_dir_created, os.path.basename(file_path))
                file_mode = 0o700 if file_path.lower().endswith(".exe") else 0o600
                verify_hasher = hashlib.sha256()
                with open(file_path, "rb") as src_fp, open(
                    os.open(staged_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, file_mode), "wb"
                ) as dst_fp:
                    while True:
                        blk = src_fp.read(256 * 1024)
                        if not blk:
                            break
                        verify_hasher.update(blk)
                        dst_fp.write(blk)
                if verify_hasher.hexdigest().lower() != expected_sha.lower():
                    shutil.rmtree(stage_dir_created, ignore_errors=True)
                    st = self.get_status()
                    return {
                        "ok": False,
                        "error": "Installer SHA-256 verification failed before launch. Please re-download the update.",
                        "status": st,
                        "updater": st,
                    }
                exec_path = staged_file
            except Exception as stage_err:
                if stage_dir_created:
                    shutil.rmtree(stage_dir_created, ignore_errors=True)
                st = self.get_status()
                return {
                    "ok": False,
                    "error": f"Could not stage verified installer: {stage_err}",
                    "status": st,
                    "updater": st,
                }

        try:
            if sys.platform == "darwin":
                if auto_reveal:
                    subprocess.Popen(["open", "-R", file_path], close_fds=True)
                elif sha256_verified and exec_path.lower().endswith(".dmg") and os.access("/Applications", os.W_OK):
                    upd_sh = (
                        "set -u\n"
                        "cd /tmp || exit 1\n"
                        'DMG="$VELARIUM_UPD_DMG"\n'
                        'OLD_PID="$VELARIUM_UPD_OLD_PID"\n'
                        'MNT="$(/usr/bin/mktemp -d /tmp/velarium_dmg.XXXXXX)" || exit 1\n'
                        'STAGE_APP="/Applications/.Velarium.app.new.$$"\n'
                        'BACKUP_APP="/Applications/.Velarium.app.old.$$"\n'
                        "cleanup() {\n"
                        '  /usr/bin/hdiutil detach "$MNT" -force -quiet >/dev/null 2>&1 || true\n'
                        '  /bin/rm -rf "$MNT" "$STAGE_APP" >/dev/null 2>&1 || true\n'
                        "}\n"
                        "trap cleanup EXIT\n"
                        '/usr/bin/xattr -cr "$DMG" >/dev/null 2>&1 || true\n'
                        'if ! printf "Y\\n" | /usr/bin/hdiutil attach "$DMG" -mountpoint "$MNT" -nobrowse -readonly -quiet >/dev/null 2>&1; then\n'
                        '  /usr/bin/open "$DMG" >/dev/null 2>&1 || true\n'
                        "  exit 1\n"
                        "fi\n"
                        'SRC_APP="$MNT/Velarium.app"\n'
                        'DST_APP="/Applications/Velarium.app"\n'
                        'if [ ! -d "$SRC_APP" ] && [ -d "$MNT/CineFlow.app" ]; then\n'
                        '  SRC_APP="$MNT/CineFlow.app"\n'
                        "fi\n"
                        'if [ ! -d "$SRC_APP" ]; then\n'
                        '  /usr/bin/open "$DMG" >/dev/null 2>&1 || true\n'
                        "  exit 1\n"
                        "fi\n"
                        '/bin/rm -rf "$STAGE_APP" >/dev/null 2>&1 || true\n'
                        'if ! /usr/bin/ditto "$SRC_APP" "$STAGE_APP" >/dev/null 2>&1; then\n'
                        '  /usr/bin/open "$DMG" >/dev/null 2>&1 || true\n'
                        "  exit 1\n"
                        "fi\n"
                        '/usr/bin/chflags -R nohidden "$STAGE_APP" >/dev/null 2>&1 || true\n'
                        '/usr/bin/xattr -cr "$STAGE_APP" >/dev/null 2>&1 || true\n'
                        "/bin/sleep 0.35\n"
                        "/usr/bin/killall -TERM Velarium >/dev/null 2>&1 || true\n"
                        '/usr/bin/pkill -TERM -f "/Applications/Velarium.app/Contents/" >/dev/null 2>&1 || true\n'
                        '/usr/bin/pkill -TERM -f "/Applications/CineFlow.app/Contents/" >/dev/null 2>&1 || true\n'
                        '[ -n "$OLD_PID" ] && /bin/kill -TERM "$OLD_PID" >/dev/null 2>&1 || true\n'
                        "/bin/sleep 0.9\n"
                        "/usr/bin/killall -KILL Velarium >/dev/null 2>&1 || true\n"
                        '/usr/bin/pkill -KILL -f "/Applications/Velarium.app/Contents/" >/dev/null 2>&1 || true\n'
                        '[ -n "$OLD_PID" ] && /bin/kill -KILL "$OLD_PID" >/dev/null 2>&1 || true\n'
                        "/bin/sleep 0.3\n"
                        '/bin/rm -rf "$BACKUP_APP" >/dev/null 2>&1 || true\n'
                        'if [ -e "$DST_APP" ]; then\n'
                        '  /bin/mv "$DST_APP" "$BACKUP_APP" >/dev/null 2>&1 || /bin/rm -rf "$DST_APP" >/dev/null 2>&1 || true\n'
                        "fi\n"
                        'if [ -e "/Applications/CineFlow.app" ]; then\n'
                        '  /bin/rm -rf "/Applications/CineFlow.app" >/dev/null 2>&1 || true\n'
                        "fi\n"
                        'if /bin/mv "$STAGE_APP" "$DST_APP" >/dev/null 2>&1; then\n'
                        '  /bin/rm -rf "$BACKUP_APP" >/dev/null 2>&1 || true\n'
                        "  /bin/sleep 0.35\n"
                        '  /usr/bin/open -n "$DST_APP" >/dev/null 2>&1 || true\n'
                        "else\n"
                        '  if [ -e "$BACKUP_APP" ] && [ ! -e "$DST_APP" ]; then\n'
                        '    /bin/mv "$BACKUP_APP" "$DST_APP" >/dev/null 2>&1 || true\n'
                        "  fi\n"
                        '  /usr/bin/open "$DMG" >/dev/null 2>&1 || true\n'
                        "fi\n"
                    )
                    upd_env = dict(os.environ)
                    upd_env["VELARIUM_UPD_DMG"] = exec_path
                    upd_env["VELARIUM_UPD_OLD_PID"] = str(os.getpid())
                    subprocess.Popen(
                        ["/bin/sh", "-c", upd_sh],
                        cwd="/tmp",
                        env=upd_env,
                        close_fds=True,
                        start_new_session=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                else:
                    subprocess.Popen(["open", exec_path], close_fds=True)
            elif sys.platform == "win32":
                if auto_reveal:
                    subprocess.Popen(["explorer", f"/select,{os.path.normpath(file_path)}"], close_fds=True)
                else:
                    launch_dir = os.path.dirname(os.path.abspath(exec_path)) or tempfile.gettempdir()
                    base_flags = (
                        getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
                        | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
                    )
                    breakaway_flag = getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0x01000000)
                    try:
                        subprocess.Popen(
                            [exec_path],
                            cwd=launch_dir,
                            close_fds=True,
                            creationflags=base_flags | breakaway_flag,
                        )
                    except OSError:
                        try:
                            subprocess.Popen(
                                [exec_path],
                                cwd=launch_dir,
                                close_fds=True,
                                creationflags=base_flags,
                            )
                        except OSError:
                            os.startfile(exec_path)  # type: ignore[attr-defined]
            else:
                subprocess.Popen(["xdg-open", os.path.dirname(file_path) if auto_reveal else exec_path], close_fds=True)

            with self._lock:
                self._status["state"] = "installing"
                self._status["install_started_at"] = time.time()
            st = self.get_status()
            return {
                "ok": True,
                "file_path": file_path,
                "status": st,
                "updater": st,
            }
        except Exception as e:
            if stage_dir_created:
                shutil.rmtree(stage_dir_created, ignore_errors=True)
            st = self.get_status()
            return {
                "ok": False,
                "error": str(e),
                "status": st,
                "updater": st,
            }
