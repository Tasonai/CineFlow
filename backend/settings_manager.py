"""
CineFlow Server Settings & Configuration Manager.

Handles server persistence (`server_settings.json` + SQLite storage),
Vault encryption for credentials (Debrid API key, pairing token),
country profile application, localized messages, and QR/remote pairing payload.
"""

import json
import os
import threading
import time
from typing import Any, Callable, Dict, List, Optional

from .qrcode_svg import detect_lan_ipv4, generate_qr_svg
from .regions import get_country_profile, normalize_country_code
from .storage_db import set_private_file_permissions


def norm_app_lang(val: object, default: str = "ru") -> str:
    """Normalizes application language to 'ru' or 'en'."""
    raw = str(val or "").strip().lower()
    if raw.startswith("en"):
        return "en"
    if raw.startswith("ru"):
        return "ru"
    return default


def format_multilang_msg(
    ru_text: str,
    en_text: str,
    lang: Optional[str] = None,
    default_lang: str = "ru",
) -> str:
    """Returns Russian or English localized message string based on selected language."""
    eff = str(lang if lang is not None else default_lang).strip().lower()
    return en_text if eff.startswith("en") else ru_text


def build_remote_pairing_payload(
    port: int,
    lan_enabled: bool,
    app_lang: str,
    pair_token: str,
    connected_remotes: List[Dict[str, Any]],
    include_secret: bool = True,
) -> Dict[str, Any]:
    """Generates QR code SVG and URL payload for pairing mobile devices with the server."""
    lan_ip = detect_lan_ipv4()
    cur_lang = norm_app_lang(app_lang, "ru")
    host_for_qr = lan_ip or "127.0.0.1"
    tok = pair_token if include_secret else ""
    remote_url = f"http://{host_for_qr}:{port}/?remote=1&k={tok}&lang={cur_lang}" if include_secret else ""
    try:
        qr_svg = generate_qr_svg(remote_url, quiet_zone=3) if (include_secret and remote_url) else ""
    except Exception:
        qr_svg = ""
    return {
        "ok": True,
        "app_lang": cur_lang,
        "lan_ip": lan_ip,
        "port": port,
        "lan_enabled": lan_enabled,
        "remote_url": remote_url,
        "pair_token": tok,
        "qr_svg": qr_svg,
        "connected_remotes": connected_remotes,
    }


class ServerSettingsManager:
    """
    Manages loading, saving and runtime propagation of CineFlow server settings,
    including regional proxy profiles, HDRezka mirrors, Debrid credentials and autostart state.
    """

    def __init__(
        self,
        data_dir: str,
        settings_path: str,
        app_prefs: Dict[str, Any],
        server_runtime: Dict[str, Any],
        storage_db: Any,
        net_client: Any,
        aggregator: Any,
        kinorium_service: Any,
        rezka_client: Any,
        backup_stream_engine: Any,
        remote_broker: Any,
        safe_log_fn: Optional[Callable[[str, bool], None]] = None,
    ):
        self.data_dir = data_dir
        self.settings_path = settings_path
        self.app_prefs = app_prefs
        self.server_runtime = server_runtime
        self.storage_db = storage_db
        self.net_client = net_client
        self.aggregator = aggregator
        self.kinorium_service = kinorium_service
        self.rezka_client = rezka_client
        self.backup_stream_engine = backup_stream_engine
        self.remote_broker = remote_broker
        self.safe_log_fn = safe_log_fn or (lambda msg, err=False: None)
        self.settings_save_lock = threading.Lock()

    def norm_app_lang(self, val: object, default: str = "ru") -> str:
        return norm_app_lang(val, default)

    def msg(self, ru_text: str, en_text: str, lang: Optional[str] = None) -> str:
        eff_lang = self.app_prefs.get("app_lang", "ru") if lang is None else lang
        return format_multilang_msg(ru_text, en_text, lang=eff_lang)

    def apply_user_country(
        self,
        country_code: str,
        adjust_bypass: bool = True,
        adjust_local_services: bool = False,
        persist_integrations: bool = True,
    ) -> Dict[str, Any]:
        """Configures national routing profiles, HDRezka mirror priority, and Kinorium catalog localization."""
        norm_cc = normalize_country_code(country_code, default=str(self.app_prefs.get("user_country") or "PL"))
        prof = self.net_client.configure_country(norm_cc)
        self.app_prefs["user_country"] = prof["code"]
        self.aggregator.set_country(prof["code"])
        self.kinorium_service.apply_country_localization(
            prof["code"],
            adjust_local_services=adjust_local_services,
            persist=persist_integrations,
        )
        if adjust_bypass:
            self.rezka_client.configure(
                spoof_region=prof["hdrezka_spoof"],
                mirror_priority=prof["mirror_priority"],
            )
        else:
            self.rezka_client.configure(mirror_priority=prof["mirror_priority"])
        self.backup_stream_engine.apply_country_policy(bool(prof.get("p2p_strict", False)))
        return get_country_profile(prof["code"], lang=str(self.app_prefs.get("app_lang") or "ru"))

    def load_persisted_server_settings(self) -> None:
        """Loads and decrypts persisted settings from SQLite DB or server_settings.json."""
        self.apply_user_country("PL", adjust_bypass=True, adjust_local_services=False, persist_integrations=False)
        cfg = None
        try:
            cfg = self.storage_db.get_kv("server", "settings", None)
        except Exception:
            cfg = None
        if not isinstance(cfg, dict) and os.path.isfile(self.settings_path):
            try:
                with open(self.settings_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                if isinstance(cfg, dict):
                    if cfg.get("remote_pair_token"):
                        cfg["remote_pair_token"] = self.storage_db.vault.decrypt_str(str(cfg["remote_pair_token"]))
                    bkp_raw = cfg.get("backup_stream")
                    if isinstance(bkp_raw, dict) and bkp_raw.get("debrid_api_key"):
                        bkp_copy = dict(bkp_raw)
                        bkp_copy["debrid_api_key"] = self.storage_db.vault.decrypt_str(str(bkp_copy["debrid_api_key"]))
                        cfg["backup_stream"] = bkp_copy
                    try:
                        self.storage_db.set_kv("server", "settings", cfg)
                    except Exception:
                        pass
            except Exception as exc:
                self.safe_log_fn(f"[CineFlow] Failed to load server_settings.json: {exc}\n", True)
                return
        if not isinstance(cfg, dict):
            return
        try:
            if "app_lang" in cfg:
                self.app_prefs["app_lang"] = norm_app_lang(cfg.get("app_lang"), "ru")
                self.remote_broker.set_app_lang(self.app_prefs["app_lang"])
            if "setup_completed" in cfg:
                self.app_prefs["setup_completed"] = bool(cfg.get("setup_completed"))
            if "lan_access" in cfg:
                self.app_prefs["lan_access"] = bool(cfg.get("lan_access"))
                self.server_runtime["host"] = "0.0.0.0" if self.app_prefs["lan_access"] else "127.0.0.1"
            if "auto_check_updates" in cfg:
                self.app_prefs["auto_check_updates"] = bool(cfg.get("auto_check_updates"))
            if "update_repo" in cfg:
                self.app_prefs["update_repo"] = str(cfg.get("update_repo") or "").strip()
            if "update_manifest_url" in cfg:
                self.app_prefs["update_manifest_url"] = str(cfg.get("update_manifest_url") or "").strip()
            if cfg.get("remote_pair_token"):
                tok = self.storage_db.vault.decrypt_str(str(cfg.get("remote_pair_token") or "").strip())
                if len(tok) >= 6:
                    self.remote_broker.pair_token = tok[:16]
            if "user_country" in cfg:
                self.apply_user_country(
                    str(cfg.get("user_country") or "PL"),
                    adjust_bypass=True,
                    adjust_local_services=False,
                    persist_integrations=False,
                )
            rezka_cfg = cfg.get("hdrezka")
            if isinstance(rezka_cfg, dict):
                self.rezka_client.configure(
                    custom_mirror=rezka_cfg.get("custom_mirror"),
                    proxy_url=rezka_cfg.get("proxy_url"),
                    cf_worker_relay=rezka_cfg.get("cf_worker_relay"),
                    spoof_region=rezka_cfg.get("spoof_region"),
                    preferred_studios=rezka_cfg.get("preferred_studios"),
                )
            bkp_cfg = cfg.get("backup_stream")
            if isinstance(bkp_cfg, dict):
                raw_debrid = bkp_cfg.get("debrid_api_key")
                dec_debrid = self.storage_db.vault.decrypt_str(str(raw_debrid)) if raw_debrid else raw_debrid
                self.backup_stream_engine.configure(
                    mode=bkp_cfg.get("mode"),
                    debrid_api_key=dec_debrid,
                    torrserver_url=bkp_cfg.get("torrserver_url"),
                )
        except Exception as exc:
            self.safe_log_fn(f"[CineFlow] Failed to apply server settings: {exc}\n", True)

    def save_persisted_server_settings(self) -> None:
        """Atomically saves encrypted configuration to disk and SQLite settings storage."""
        with self.settings_save_lock:
            try:
                os.makedirs(self.data_dir, exist_ok=True)
                set_private_file_permissions(self.data_dir, is_dir=True)
                payload = {
                    "app_lang": self.app_prefs.get("app_lang", "ru"),
                    "user_country": self.app_prefs.get("user_country", "PL"),
                    "setup_completed": bool(self.app_prefs.get("setup_completed", False)),
                    "lan_access": bool(self.app_prefs.get("lan_access", False)),
                    "auto_check_updates": bool(self.app_prefs.get("auto_check_updates", True)),
                    "update_repo": str(self.app_prefs.get("update_repo") or "").strip(),
                    "update_manifest_url": str(self.app_prefs.get("update_manifest_url") or "").strip(),
                    "remote_pair_token": self.remote_broker.pair_token,
                    "hdrezka": {
                        "custom_mirror": self.rezka_client.custom_mirror,
                        "proxy_url": self.rezka_client.proxy_url,
                        "cf_worker_relay": self.rezka_client.cf_worker_relay,
                        "spoof_region": self.rezka_client.spoof_region,
                        "preferred_studios": self.rezka_client.preferred_studios,
                    },
                    "backup_stream": {
                        "mode": self.backup_stream_engine.mode,
                        "debrid_api_key": self.backup_stream_engine.debrid_api_key,
                        "torrserver_url": self.backup_stream_engine.torrserver_url,
                    },
                    "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                }
                try:
                    self.storage_db.set_kv("server", "settings", payload)
                except Exception:
                    pass
                disk_payload = json.loads(json.dumps(payload))
                if disk_payload.get("remote_pair_token"):
                    disk_payload["remote_pair_token"] = self.storage_db.vault.encrypt_str(
                        str(disk_payload["remote_pair_token"])
                    )
                if disk_payload.get("backup_stream", {}).get("debrid_api_key"):
                    disk_payload["backup_stream"]["debrid_api_key"] = self.storage_db.vault.encrypt_str(
                        str(disk_payload["backup_stream"]["debrid_api_key"])
                    )
                if self.storage_db.vault.is_ephemeral and os.path.isfile(self.settings_path):
                    try:
                        with open(self.settings_path, "r", encoding="utf-8") as prev_f:
                            prev_disk = json.load(prev_f)
                        if isinstance(prev_disk, dict):
                            disk_payload = self.storage_db._preserve_existing_ciphertexts(prev_disk, disk_payload)
                    except Exception:
                        pass
                tmp_path = f"{self.settings_path}.tmp.{os.getpid()}.{threading.get_ident()}"
                with open(tmp_path, "w", encoding="utf-8") as f:
                    json.dump(disk_payload, f, ensure_ascii=False, indent=2)
                set_private_file_permissions(tmp_path, is_dir=False)
                os.replace(tmp_path, self.settings_path)
                set_private_file_permissions(self.settings_path, is_dir=False)
            except Exception as exc:
                try:
                    if "tmp_path" in locals() and tmp_path and os.path.exists(tmp_path):
                        os.unlink(tmp_path)
                except Exception:
                    pass
                self.safe_log_fn(f"[CineFlow] Failed to save server_settings.json: {exc}\n", True)

    def build_remote_pairing_payload(self, include_secret: bool = True) -> Dict[str, Any]:
        """Constructs QR and connection metadata for client remote pairing."""
        port = int(self.server_runtime.get("port") or 8765)
        lan_enabled = bool(self.app_prefs.get("lan_access", False))
        app_lang = str(self.app_prefs.get("app_lang", "ru"))
        pair_token = str(self.remote_broker.pair_token or "")
        connected_remotes = self.remote_broker.get_connected_remotes()
        return build_remote_pairing_payload(
            port=port,
            lan_enabled=lan_enabled,
            app_lang=app_lang,
            pair_token=pair_token,
            connected_remotes=connected_remotes,
            include_secret=include_secret,
        )


__all__ = [
    "norm_app_lang",
    "format_multilang_msg",
    "build_remote_pairing_payload",
    "ServerSettingsManager",
]
