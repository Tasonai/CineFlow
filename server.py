#!/usr/bin/env python3
import atexit
import gzip
import json
import mimetypes
import os
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional, Tuple

from backend.ad_skip import AdSkipEngine
from backend.aggregator import UnifiedCinemaAggregator
from backend.backup_stream import BackupStreamingEngine
from backend.doh import DoHSplitNetworkClient
from backend.en_metadata import (
    EnglishMetadataResolver,
    build_english_cast_people,
    has_cyrillic,
    translate_kinorium_extra_desc_to_en,
)
from backend.hdrezka import HDRezkaClient
from backend.kinorium import KinoriumService
from backend.qrcode_svg import detect_lan_ipv4, generate_qr_svg
from backend.remuxer import RemuxStreamEngine
from backend.skip_intro import SkipIntroEngine
from backend.stremio import StremioAddonEngine, convert_srt_or_vtt_to_webvtt

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
DATA_DIR = os.path.join(BASE_DIR, "data")
SETTINGS_PATH = os.path.join(DATA_DIR, "server_settings.json")

net_client = DoHSplitNetworkClient()
rezka_client = HDRezkaClient(net_client)
kinorium_service = KinoriumService(net_client, DATA_DIR)
skip_intro_engine = SkipIntroEngine(net_client)
ad_skip_engine = AdSkipEngine()
backup_stream_engine = BackupStreamingEngine(net_client, rezka_client, BASE_DIR)
remux_engine = RemuxStreamEngine(BASE_DIR)
stremio_engine = StremioAddonEngine(DATA_DIR, backup_stream_engine)
en_meta_resolver = EnglishMetadataResolver(os.path.join(DATA_DIR, "en_meta_cache.json"), net_client)
aggregator = UnifiedCinemaAggregator(
    net_client,
    rezka_client,
    kinorium_service,
    stremio_engine,
    en_meta_resolver=en_meta_resolver,
)
PERSON_PHOTO_BYTES_CACHE: dict = {}
PERSON_PHOTO_LOCK = threading.Lock()
SUBTITLE_RAW_CACHE: dict = {}
SUBTITLE_CACHE_LOCK = threading.Lock()
LAST_BG_WATCHING_SYNC: dict = {"ts": 0.0, "checked": 0}

atexit.register(backup_stream_engine.shutdown_local_torrserver)


def _safe_int(val, default: int = 0) -> int:
    try:
        if val is None or val == "":
            return default
        return int(val)
    except (ValueError, TypeError):
        return default


def _safe_float(val, default: float = 0.0) -> float:
    try:
        if val is None or val == "":
            return default
        return float(val)
    except (ValueError, TypeError):
        return default


def _qs_int(qs: dict, key: str, default: int = 0) -> int:
    raw_list = qs.get(key)
    if not raw_list:
        return default
    return _safe_int(raw_list[0], default)


def _qs_float(qs: dict, key: str, default: float = 0.0) -> float:
    raw_list = qs.get(key)
    if not raw_list:
        return default
    return _safe_float(raw_list[0], default)


APP_PREFS: Dict[str, Any] = {"app_lang": "ru", "lan_access": False}
SERVER_RUNTIME: Dict[str, Any] = {
    "server": None,
    "host": "127.0.0.1",
    "port": 8765,
    "running": False,
    "rebind_requested": False,
    "lock": threading.Lock(),
}
LAUNCH_AGENT_LABEL = "app.cineflow.cinema"


def _launch_agent_plist_path() -> str:
    return os.path.expanduser(f"~/Library/LaunchAgents/{LAUNCH_AGENT_LABEL}.plist")


def is_macos_autostart_enabled() -> bool:
    if sys.platform != "darwin":
        return False
    return os.path.isfile(_launch_agent_plist_path())


def set_macos_autostart(enabled: bool) -> Dict[str, Any]:
    if sys.platform != "darwin":
        return {"ok": False, "error": "macOS LaunchAgent supported on darwin only"}
    plist_path = _launch_agent_plist_path()
    if enabled:
        os.makedirs(os.path.dirname(plist_path), exist_ok=True)
        os.makedirs(DATA_DIR, exist_ok=True)
        py_bin = sys.executable or "/usr/bin/python3"
        script_path = os.path.abspath(__file__)
        log_path = os.path.join(DATA_DIR, "cineflow-launchd.log")
        plist_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{py_bin}</string>
    <string>{script_path}</string>
    <string>--launchd</string>
  </array>
  <key>WorkingDirectory</key>
  <string>{BASE_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>{log_path}</string>
  <key>StandardErrorPath</key>
  <string>{log_path}</string>
</dict>
</plist>
"""
        with open(plist_path, "w", encoding="utf-8") as f:
            f.write(plist_xml)
    else:
        if os.path.isfile(plist_path):
            try:
                subprocess.run(
                    ["launchctl", "unload", plist_path],
                    capture_output=True,
                    timeout=3.0,
                )
            except Exception:
                pass
            try:
                os.remove(plist_path)
            except OSError:
                pass
    return {"ok": True, "autostart_enabled": is_macos_autostart_enabled()}


def get_system_status_payload() -> Dict[str, Any]:
    lan_ip = detect_lan_ipv4()
    port = int(SERVER_RUNTIME.get("port") or 8765)
    lan_enabled = bool(APP_PREFS.get("lan_access", False))
    lan_url = f"http://{lan_ip}:{port}" if lan_ip else ""
    qr_svg = generate_qr_svg(lan_url, quiet_zone=3) if lan_url else ""
    return {
        "app": "cineflow",
        "platform": sys.platform,
        "is_macos": sys.platform == "darwin",
        "lan_enabled": lan_enabled,
        "bind_host": str(SERVER_RUNTIME.get("host") or ("0.0.0.0" if lan_enabled else "127.0.0.1")),
        "port": port,
        "lan_ip": lan_ip,
        "lan_url": lan_url,
        "qr_svg": qr_svg,
        "autostart_supported": sys.platform == "darwin",
        "autostart_enabled": is_macos_autostart_enabled(),
        "hw_accel": remux_engine.get_hw_capabilities(),
    }


def sync_lan_listener(lan_enabled: bool) -> None:
    port = int(SERVER_RUNTIME.get("port") or 8765)
    lan_ip = detect_lan_ipv4()
    with SERVER_RUNTIME["lock"]:
        existing = SERVER_RUNTIME.get("lan_server")
        existing_ip = SERVER_RUNTIME.get("lan_bound_ip")
        if not lan_enabled or not lan_ip:
            SERVER_RUNTIME["lan_server"] = None
            SERVER_RUNTIME["lan_bound_ip"] = ""
            SERVER_RUNTIME["host"] = "127.0.0.1"
        elif existing is not None and existing_ip == lan_ip:
            SERVER_RUNTIME["host"] = "0.0.0.0"
            return
        else:
            SERVER_RUNTIME["lan_server"] = None
            SERVER_RUNTIME["lan_bound_ip"] = ""

    if existing is not None:
        try:
            existing.shutdown()
            existing.server_close()
        except Exception:
            pass

    if lan_enabled and lan_ip:
        try:
            lan_srv = CinemaThreadingHTTPServer((lan_ip, port), CinemaRequestHandler)
            with SERVER_RUNTIME["lock"]:
                SERVER_RUNTIME["lan_server"] = lan_srv
                SERVER_RUNTIME["lan_bound_ip"] = lan_ip
                SERVER_RUNTIME["host"] = "0.0.0.0"
            threading.Thread(
                target=lan_srv.serve_forever,
                kwargs={"poll_interval": 0.15},
                name="CineFlowLanHTTP",
                daemon=True,
            ).start()
        except Exception as exc:
            sys.stderr.write(f"[CineFlow] Failed to bind LAN listener on {lan_ip}:{port}: {exc}\n")


def _norm_app_lang(val: object, default: str = "ru") -> str:
    raw = str(val or "").strip().lower()
    if raw.startswith("en"):
        return "en"
    if raw.startswith("ru"):
        return "ru"
    return default


def load_persisted_server_settings() -> None:
    if not os.path.isfile(SETTINGS_PATH):
        return
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        if not isinstance(cfg, dict):
            return
        if "app_lang" in cfg:
            APP_PREFS["app_lang"] = _norm_app_lang(cfg.get("app_lang"), "ru")
        if "lan_access" in cfg:
            APP_PREFS["lan_access"] = bool(cfg.get("lan_access"))
            SERVER_RUNTIME["host"] = "0.0.0.0" if APP_PREFS["lan_access"] else "127.0.0.1"
        rezka_cfg = cfg.get("hdrezka")
        if isinstance(rezka_cfg, dict):
            rezka_client.configure(
                custom_mirror=rezka_cfg.get("custom_mirror"),
                proxy_url=rezka_cfg.get("proxy_url"),
                cf_worker_relay=rezka_cfg.get("cf_worker_relay"),
                spoof_region=rezka_cfg.get("spoof_region"),
                preferred_studios=rezka_cfg.get("preferred_studios"),
            )
        bkp_cfg = cfg.get("backup_stream")
        if isinstance(bkp_cfg, dict):
            backup_stream_engine.configure(
                mode=bkp_cfg.get("mode"),
                debrid_api_key=bkp_cfg.get("debrid_api_key"),
                torrserver_url=bkp_cfg.get("torrserver_url"),
            )
    except Exception as exc:
        sys.stderr.write(f"[CineFlow] Failed to load server_settings.json: {exc}\n")


def save_persisted_server_settings() -> None:
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        payload = {
            "app_lang": APP_PREFS.get("app_lang", "ru"),
            "lan_access": bool(APP_PREFS.get("lan_access", False)),
            "hdrezka": {
                "custom_mirror": rezka_client.custom_mirror,
                "proxy_url": rezka_client.proxy_url,
                "cf_worker_relay": rezka_client.cf_worker_relay,
                "spoof_region": rezka_client.spoof_region,
                "preferred_studios": rezka_client.preferred_studios,
            },
            "backup_stream": {
                "mode": backup_stream_engine.mode,
                "debrid_api_key": backup_stream_engine.debrid_api_key,
                "torrserver_url": backup_stream_engine.torrserver_url,
            },
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        tmp_path = SETTINGS_PATH + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, SETTINGS_PATH)
    except Exception as exc:
        sys.stderr.write(f"[CineFlow] Failed to save server_settings.json: {exc}\n")


load_persisted_server_settings()


def _scrub_cyrillic_episode_dicts(
    ep_titles: Optional[Dict[str, Any]],
    ep_meta: Optional[Dict[str, Any]],
) -> Tuple[Dict[str, Dict[str, str]], Dict[str, Dict[str, Dict[str, Any]]]]:
    clean_titles: Dict[str, Dict[str, str]] = {}
    for sn_k, sn_map in (ep_titles or {}).items():
        if not isinstance(sn_map, dict):
            continue
        c_sn: Dict[str, str] = {}
        for ep_k, t_val in sn_map.items():
            s_val = str(t_val or "").strip()
            if s_val and not has_cyrillic(s_val):
                c_sn[str(ep_k)] = s_val
        if c_sn:
            clean_titles[str(sn_k)] = c_sn

    clean_meta: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for sn_k, sn_map in (ep_meta or {}).items():
        if not isinstance(sn_map, dict):
            continue
        c_sn_m: Dict[str, Dict[str, Any]] = {}
        for ep_k, info in sn_map.items():
            if not isinstance(info, dict):
                continue
            item_info = dict(info)
            if has_cyrillic(str(item_info.get("title") or "")):
                item_info["title"] = ""
            if has_cyrillic(str(item_info.get("overview") or "")):
                item_info["overview"] = ""
            if has_cyrillic(str(item_info.get("air_date") or "")):
                item_info["air_date"] = ""
            c_sn_m[str(ep_k)] = item_info
        if c_sn_m:
            clean_meta[str(sn_k)] = c_sn_m
    return clean_titles, clean_meta


class CinemaRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        if "/api/ad-segments" in self.path or "/api/ad-detect-frame" in self.path:
            return
        sys.stdout.write(f"[CineFlow] {self.command} {self.path}\n")

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
            if use_gzip:
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Vary", "Accept-Encoding")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _read_json_body(self) -> dict:
        length = _safe_int(self.headers.get("Content-Length", "0"), 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_HEAD(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            known_get_apis = {
                "/api/catalog",
                "/api/search",
                "/api/hdrezka/streams",
                "/api/hdrezka/check-watching-updates",
                "/api/trailer",
                "/api/person",
                "/api/person-photo",
                "/api/title-meta",
                "/api/download-mp4",
                "/api/proxy-vtt",
                "/api/ad-segments",
                "/api/skip-intro",
                "/api/backup-streams",
                "/api/stremio/addons",
                "/api/stremio/streams",
                "/api/remux-probe",
                "/api/remux-stream",
                "/api/remux-subtitle",
                "/api/video-snapshot",
                "/api/kinorium/live-digest",
                "/api/integrations",
                "/api/kinorium/stats",
                "/api/backup/export",
                "/api/settings",
                "/api/system/status",
            }
            if path in known_get_apis:
                self._send_json({"ok": True}, status=200)
            else:
                self._send_json({"error": "Not found"}, status=404)
            return

        if path == "/favicon.ico":
            rel_path = "favicon.svg"
        else:
            rel_path = "index.html" if path in ("/", "") else path.lstrip("/")
        file_path = os.path.normpath(os.path.join(PUBLIC_DIR, rel_path))
        is_asset_request = bool(
            path not in ("/", "")
            and (
                os.path.splitext(rel_path)[1]
                or rel_path.startswith(("css/", "js/", "assets/", "icons/", "fonts/"))
            )
        )
        if not file_path.startswith(PUBLIC_DIR) or not os.path.isfile(file_path):
            if is_asset_request:
                self.send_response(404)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            file_path = os.path.join(PUBLIC_DIR, "index.html")
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
        size = os.path.getsize(file_path) if os.path.isfile(file_path) else 0
        self.send_response(200)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(size))
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path == "/api/catalog":
            provider = qs.get("provider", ["all"])[0]
            media_type = qs.get("media_type", ["all"])[0]
            kinorium_section = qs.get("kinorium_section", ["all"])[0]
            req_lang = _norm_app_lang(qs.get("lang", [APP_PREFS.get("app_lang", "ru")])[0], APP_PREFS.get("app_lang", "ru"))
            self._send_json(
                aggregator.get_catalog(
                    provider_filter=provider,
                    media_type_filter=media_type,
                    kinorium_section=kinorium_section,
                    lang=req_lang,
                )
            )
            return

        if path == "/api/search":
            q = qs.get("q", [""])[0]
            provider = qs.get("provider", ["all"])[0]
            media_type = qs.get("media_type", ["all"])[0]
            kinorium_section = qs.get("kinorium_section", ["all"])[0]
            req_lang = _norm_app_lang(qs.get("lang", [APP_PREFS.get("app_lang", "ru")])[0], APP_PREFS.get("app_lang", "ru"))
            self._send_json(
                aggregator.unified_search(
                    query=q,
                    provider_filter=provider,
                    media_type_filter=media_type,
                    kinorium_section=kinorium_section,
                    lang=req_lang,
                )
            )
            return

        if path == "/api/hdrezka/streams":
            item_id = qs.get("id", ["tt11280740"])[0]
            title = qs.get("title", ["Фильм"])[0]
            orig_title = qs.get("orig_title", [""])[0]
            year = _qs_int(qs, "year", 2024)
            media_type = qs.get("media_type", ["movie"])[0]
            translator_id = qs.get("translator_id", [""])[0]
            season = max(1, _qs_int(qs, "season", 1))
            episode = max(1, _qs_int(qs, "episode", 1))
            rezka_url = qs.get("rezka_url", [""])[0]
            req_lang = _norm_app_lang(qs.get("lang", [APP_PREFS.get("app_lang", "ru")])[0], APP_PREFS.get("app_lang", "ru"))
            prefer_orig = qs.get("prefer_original", ["0"])[0].strip().lower() in ("1", "true", "yes") or (
                req_lang == "en" and not translator_id
            )

            data = rezka_client.get_streams_for_title(
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                year=year,
                media_type=media_type,
                translator_id=translator_id,
                season=season,
                episode=episode,
                rezka_url=rezka_url,
                prefer_original=prefer_orig,
                lang=req_lang,
            )
            if data.get("needs_original_fallback") and not data.get("default_stream_url"):
                orig_fb = backup_stream_engine.resolve_original_audio_fallback(
                    title=title,
                    orig_title=orig_title,
                    year=year,
                    media_type=media_type,
                    season=season,
                    episode=episode,
                    remux_engine=remux_engine,
                )
                if not orig_fb:
                    orig_fb = stremio_engine.resolve_original_audio_fallback(
                        item_id=item_id,
                        title=title,
                        orig_title=orig_title,
                        year=year,
                        media_type=media_type,
                        season=season,
                        episode=episode,
                        remux_engine=remux_engine,
                        lang=req_lang,
                    )
                if orig_fb:
                    data["qualities"] = orig_fb["qualities"]
                    data["default_quality"] = orig_fb["default_quality"]
                    data["default_stream_url"] = orig_fb["default_stream_url"]
                    if orig_fb.get("subtitles"):
                        data["subtitles"] = orig_fb["subtitles"]
                    data["remux_session"] = orig_fb["remux_session"]
                    data["geo_bypass"] = {
                        **(data.get("geo_bypass") or {}),
                        "status_text": (
                            "Original 1080p • Direct stream + subtitles"
                            if req_lang == "en"
                            else "Оригинал 1080p • Прямой поток + субтитры"
                        ),
                    }
            if media_type == "series" and data.get("seasons_map"):
                st_names = [s.get("name", "") for s in (data.get("studios") or []) if s.get("name")][:4]
                kinorium_service.save_series_live_meta(
                    [
                        {
                            "id": item_id,
                            "title": title,
                            "orig_title": orig_title,
                            "rezka_id": data.get("rezka_id", ""),
                            "rezka_url": data.get("rezka_url", ""),
                            "latest_season": data.get("latest_season", season),
                            "latest_episode": data.get("latest_episode", episode),
                            "seasons_map": data.get("seasons_map", {}),
                            "is_completed": bool(data.get("is_completed", False)),
                            "series_status_text": data.get("series_status_text", ""),
                            "studios_summary": ", ".join(st_names) if st_names else "HDRezka",
                            "studios_count": len(data.get("studios") or []),
                            "not_found": False,
                        }
                    ]
                )
            qualities_map = data.get("qualities") or {}
            scan_mp4_url = (
                qualities_map.get("360p")
                or qualities_map.get("480p")
                or qualities_map.get("720p")
                or data.get("default_stream_url")
                or ""
            )
            sel_tr_id = str((data.get("selected_studio") or {}).get("id") or translator_id or "default")
            ad_stream_key = ad_skip_engine.build_stream_key(
                item_id=str(data.get("rezka_id") or item_id),
                media_type=media_type,
                season=season,
                episode=episode,
                translator_id=sel_tr_id,
                stream_url=scan_mp4_url,
            )
            ad_info = ad_skip_engine.get_stream_entry(ad_stream_key)
            data["ad_skip"] = {
                **ad_info,
                "scan_mp4_url": scan_mp4_url,
            }

            # Attach external OpenSubtitles when HDRezka stream lacks subtitles or in English mode
            existing_subs = list(data.get("subtitles") or [])
            if len(existing_subs) < 2:
                ext_subs = stremio_engine.get_subtitles_only(
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    year=year,
                    media_type=media_type,
                    season=season,
                    episode=episode,
                    lang=req_lang,
                )
                seen_sub_urls = {str(s.get("url") or "") for s in existing_subs}
                for es in ext_subs[:8]:
                    raw_u = str(es.get("url") or "").strip()
                    if not raw_u:
                        continue
                    proxied_u = f"/api/proxy-vtt?url={urllib.parse.quote(raw_u)}&ss=0"
                    if proxied_u in seen_sub_urls or raw_u in seen_sub_urls:
                        continue
                    seen_sub_urls.add(proxied_u)
                    existing_subs.append(
                        {
                            "lang": es.get("label") or es.get("lang_code") or "Subtitles",
                            "url": proxied_u,
                            "direct_vtt": True,
                        }
                    )
                data["subtitles"] = existing_subs

            if req_lang == "en":
                en_m = en_meta_resolver.resolve(
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    year=year,
                    media_type=media_type,
                    need_episodes=(media_type == "series"),
                )
                if en_m and en_m.get("ok"):
                    if en_m.get("description_en"):
                        data["description"] = en_m["description_en"]
                    elif has_cyrillic(str(data.get("description") or "")):
                        data["description"] = translate_kinorium_extra_desc_to_en(str(data.get("description") or ""))
                    en_cast = build_english_cast_people(en_m, data.get("cast_people"))
                    data["cast_people"] = en_cast
                    data["directors"] = [p["name"] for p in en_cast if p.get("is_director")]
                    data["actors"] = [p["name"] for p in en_cast if not p.get("is_director")]
                    if en_m.get("poster_en"):
                        data["poster_en"] = en_m["poster_en"]
                    if en_m.get("runtime_min"):
                        data["duration_label"] = f"{int(en_m['runtime_min'])} min"
                    if en_m.get("episodes_titles_en"):
                        merged_ep_t = dict(data.get("episodes_titles") or {})
                        for sn_k, ep_dict in en_m["episodes_titles_en"].items():
                            cur_sn = dict(merged_ep_t.get(sn_k) or {})
                            cur_sn.update(ep_dict)
                            merged_ep_t[sn_k] = cur_sn
                        data["episodes_titles"] = merged_ep_t
                    if en_m.get("episodes_meta_en"):
                        merged_ep_m = dict(data.get("episodes_meta") or {})
                        for sn_k, ep_dict in en_m["episodes_meta_en"].items():
                            cur_sn_m = dict(merged_ep_m.get(sn_k) or {})
                            for ep_k, ep_info in ep_dict.items():
                                base_ep = dict(cur_sn_m.get(ep_k) or {})
                                base_ep.update({k: v for k, v in ep_info.items() if v})
                                cur_sn_m[ep_k] = base_ep
                            merged_ep_m[sn_k] = cur_sn_m
                        data["episodes_meta"] = merged_ep_m
                data["episodes_titles"], data["episodes_meta"] = _scrub_cyrillic_episode_dicts(
                    data.get("episodes_titles"), data.get("episodes_meta")
                )

            self._send_json(data)
            return

        if path == "/api/hdrezka/check-watching-updates":
            if not kinorium_service.is_service_enabled("hdrezka") or not kinorium_service.is_service_enabled("kinorium"):
                self._send_json(
                    {
                        "ok": True,
                        "checked_count": 0,
                        "remaining_unchecked": 0,
                        "updates": [],
                    }
                )
                return

            import time as _time

            force_refresh = qs.get("force", ["0"])[0] in ("1", "true", "yes")
            all_watching_series = aggregator._enrich_from_curated(
                kinorium_service.get_section_catalog_items(
                    section="watching", media_type_filter="series", query=""
                )
            )
            active_candidates = [
                it
                for it in all_watching_series
                if not (it.get("kinorium") or {}).get("watched")
                and not (it.get("kinorium") or {}).get("not_watching")
                and int(it.get("year") or 2024) <= 2026
            ]

            now_ts = _time.time()
            ttl_sec = 21600.0  # 6 hours
            cached_valid = []
            to_check = []

            for it in active_candidates:
                ks = it.get("kinorium") or {}
                cached_m = kinorium_service.get_series_live_meta(
                    item_id=str(it.get("id") or ""),
                    title=str(it.get("title") or ""),
                    orig_title=str(it.get("orig_title") or ""),
                    kid=ks.get("kinorium_id"),
                )
                is_fresh = bool(
                    cached_m
                    and not force_refresh
                    and (now_ts - float(cached_m.get("updated_at") or 0.0)) < ttl_sec
                )
                if is_fresh:
                    if not cached_m.get("not_found"):
                        cached_valid.append(cached_m)
                else:
                    to_check.append(it)

            batch_size = 8
            fresh_results = rezka_client.check_series_latest_episodes(to_check[:batch_size], batch_limit=batch_size)
            if fresh_results:
                kinorium_service.save_series_live_meta(fresh_results)

            fresh_valid = [u for u in fresh_results if not u.get("not_found")]
            combined_updates = cached_valid + fresh_valid
            remaining = max(0, len(to_check) - len(to_check[:batch_size]))

            self._send_json(
                {
                    "ok": True,
                    "checked_count": len(combined_updates),
                    "newly_checked": len(fresh_results),
                    "remaining_unchecked": remaining,
                    "updates": combined_updates,
                }
            )
            return

        if path == "/api/trailer":
            item_id = qs.get("id", [""])[0]
            title = qs.get("title", ["Фильм"])[0]
            orig_title = qs.get("orig_title", [""])[0]
            year = _qs_int(qs, "year", 2024)
            media_type = qs.get("media_type", ["movie"])[0]
            rezka_url = qs.get("rezka_url", [""])[0]
            data = rezka_client.get_trailer_for_title(
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                year=year,
                media_type=media_type,
                rezka_url=rezka_url,
            )
            self._send_json(data)
            return

        if path == "/api/person":
            name = qs.get("name", [""])[0].strip()
            p_url = qs.get("url", [""])[0].strip()
            hint_title = qs.get("hint_title", [""])[0].strip()
            hint_orig = qs.get("hint_orig", [""])[0].strip()
            req_lang = _norm_app_lang(qs.get("lang", [APP_PREFS.get("app_lang", "ru")])[0], APP_PREFS.get("app_lang", "ru"))
            self._send_json(
                aggregator.get_person_profile(
                    name=name,
                    person_url=p_url,
                    hint_title=hint_title,
                    hint_orig=hint_orig,
                    lang=req_lang,
                )
            )
            return

        if path == "/api/person-photo":
            name = qs.get("name", [""])[0].strip()
            hint_url = qs.get("url", [""])[0].strip()
            cache_key = (hint_url or name.lower()).strip()
            cached_hit = None
            if cache_key:
                with PERSON_PHOTO_LOCK:
                    cached_hit = PERSON_PHOTO_BYTES_CACHE.get(cache_key)
            if cached_hit:
                cached_ctype, cached_bytes = cached_hit
                self.send_response(200)
                self.send_header("Content-Type", cached_ctype)
                self.send_header("Content-Length", str(len(cached_bytes)))
                self.send_header("Cache-Control", "public, max-age=86400")
                self.end_headers()
                self.wfile.write(cached_bytes)
                return

            candidate_urls = []
            if hint_url.startswith(("http://", "https://")):
                candidate_urls.append(hint_url)
            resolved_url = rezka_client.resolve_person_photo(name)
            if resolved_url and resolved_url not in candidate_urls:
                candidate_urls.append(resolved_url)

            opener = net_client._build_opener(getattr(rezka_client, "proxy_url", None))
            for p_url in candidate_urls:
                try:
                    req = urllib.request.Request(
                        p_url,
                        headers={
                            "User-Agent": net_client.default_ua,
                            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                        },
                    )
                    with opener.open(req, timeout=4) as resp:
                        ctype = (resp.headers.get("Content-Type") or "").lower()
                        raw_img = resp.read(524288)
                        if resp.status == 200 and raw_img and ("image/" in ctype or raw_img[:3] == b"\xff\xd8\xff" or raw_img[:4] == b"\x89PNG"):
                            out_ctype = ctype if "image/" in ctype else "image/jpeg"
                            if cache_key:
                                with PERSON_PHOTO_LOCK:
                                    if len(PERSON_PHOTO_BYTES_CACHE) > 350:
                                        PERSON_PHOTO_BYTES_CACHE.clear()
                                    PERSON_PHOTO_BYTES_CACHE[cache_key] = (out_ctype, raw_img)
                            self.send_response(200)
                            self.send_header("Content-Type", out_ctype)
                            self.send_header("Content-Length", str(len(raw_img)))
                            self.send_header("Cache-Control", "public, max-age=86400")
                            self.end_headers()
                            self.wfile.write(raw_img)
                            return
                except Exception:
                    continue

            parts = [w for w in name.split() if w]
            initials = "".join(w[0].upper() for w in parts[:2]) or "CF"
            safe_initials = (
                initials.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            )
            svg = (
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160">'
                '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
                '<stop offset="0%" stop-color="#2c2c30"/><stop offset="100%" stop-color="#1c1c1f"/>'
                '</linearGradient></defs>'
                '<rect width="120" height="160" fill="url(#g)"/>'
                f'<text x="60" y="90" fill="#e5e5ea" font-family="-apple-system,sans-serif" '
                f'font-size="36" font-weight="600" text-anchor="middle">{safe_initials}</text></svg>'
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml; charset=utf-8")
            self.send_header("Content-Length", str(len(svg)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(svg)
            return

        if path == "/api/title-meta":
            item_id = qs.get("id", [""])[0].strip()
            kin_item_id = qs.get("item_id", [""])[0].strip() or item_id
            kin_kid = qs.get("kinorium_id", [""])[0].strip()
            title = qs.get("title", [""])[0].strip()
            orig_title = qs.get("orig_title", [""])[0].strip()
            year = _qs_int(qs, "year", 2024)
            media_type = qs.get("media_type", ["movie"])[0]
            rezka_url = qs.get("rezka_url", [""])[0] or None
            req_lang = _norm_app_lang(qs.get("lang", [APP_PREFS.get("app_lang", "ru")])[0], APP_PREFS.get("app_lang", "ru"))
            num_id = item_id if item_id.isdigit() else ""

            reconcile_thread = None
            if media_type == "series" and kinorium_service.is_service_enabled("kinorium"):
                reconcile_thread = threading.Thread(
                    target=kinorium_service.reconcile_series_episodes,
                    kwargs={
                        "item_id": kin_item_id,
                        "title": title,
                        "orig_title": orig_title,
                        "kid": kin_kid or None,
                    },
                    daemon=True,
                )
                reconcile_thread.start()

            critics_holder: Dict[str, Any] = {"pct": None}
            en_holder: Dict[str, Any] = {"data": None}

            def _fetch_critics_bg() -> None:
                if kinorium_service.is_service_enabled("kinorium"):
                    critics_holder["pct"] = kinorium_service.fetch_movie_critics_pct(
                        kid=kin_kid,
                        item_id=kin_item_id,
                        title=title,
                        orig_title=orig_title,
                        year=year,
                        media_type=media_type,
                        allow_network=True,
                    )

            def _fetch_en_bg() -> None:
                en_holder["data"] = en_meta_resolver.resolve(
                    item_id=kin_item_id or item_id,
                    title=title,
                    orig_title=orig_title,
                    year=year,
                    media_type=media_type,
                    kinorium_id=kin_kid,
                    need_episodes=(media_type == "series" and req_lang == "en"),
                )

            critics_thread = threading.Thread(target=_fetch_critics_bg, daemon=True)
            critics_thread.start()
            en_thread = None
            if req_lang == "en":
                en_thread = threading.Thread(target=_fetch_en_bg, daemon=True)
                en_thread.start()

            meta = rezka_client._resolve_page_metadata(
                num_id, title, orig_title, rezka_url, year=year, media_type=media_type
            )
            if reconcile_thread is not None:
                reconcile_thread.join(timeout=5.5)
            critics_thread.join(timeout=3.5)
            if en_thread is not None:
                en_thread.join(timeout=5.0)
            elif critics_holder["pct"] is None:
                # Fallback to JustWatch US tomatoMeter when Kinorium shows '—' for critics %
                resolved_en_fb = en_meta_resolver.resolve(
                    item_id=kin_item_id or item_id,
                    title=title,
                    orig_title=orig_title,
                    year=year,
                    media_type=media_type,
                    kinorium_id=kin_kid,
                    need_episodes=False,
                )
                if resolved_en_fb and resolved_en_fb.get("critics_pct") is not None:
                    critics_holder["pct"] = int(resolved_en_fb["critics_pct"])

            if media_type == "series" and meta and meta.get("seasons_map"):
                st_names = [s.get("name", "") for s in (meta.get("studios") or []) if s.get("name")][:4]
                kinorium_service.save_series_live_meta(
                    [
                        {
                            "id": kin_item_id,
                            "title": title,
                            "orig_title": orig_title,
                            "rezka_id": meta.get("rezka_id", ""),
                            "rezka_url": meta.get("rezka_url", ""),
                            "latest_season": meta.get("latest_season", 1),
                            "latest_episode": meta.get("latest_episode", 1),
                            "seasons_map": meta.get("seasons_map", {}),
                            "is_completed": bool(meta.get("is_completed", False)),
                            "series_status_text": meta.get("series_status_text", ""),
                            "studios_summary": ", ".join(st_names) if st_names else "HDRezka",
                            "studios_count": len(meta.get("studios") or []),
                            "not_found": False,
                        }
                    ]
                )

            en_data = en_holder["data"]
            final_critics = critics_holder["pct"]
            if final_critics is None and isinstance(en_data, dict) and en_data.get("critics_pct") is not None:
                final_critics = int(en_data["critics_pct"])

            resp_payload = {
                "rezka_id": meta.get("rezka_id", "") if meta else "",
                "rezka_url": meta.get("rezka_url", "") if meta else "",
                "description": meta.get("description", "") if meta else "",
                "directors": meta.get("directors", []) if meta else [],
                "actors": meta.get("actors", []) if meta else [],
                "cast_people": meta.get("cast_people", []) if meta else [],
                "duration_label": meta.get("duration_label", "") if meta else "",
                "seasons_map": meta.get("seasons_map", {}) if meta else {},
                "episodes_titles": meta.get("episodes_titles", {}) if meta else {},
                "episodes_meta": meta.get("episodes_meta", {}) if meta else {},
                "latest_season": meta.get("latest_season") if meta else None,
                "latest_episode": meta.get("latest_episode") if meta else None,
                "is_completed": bool(meta.get("is_completed", False)) if meta else False,
                "series_status_text": meta.get("series_status_text", "") if meta else "",
                "critics_rating": final_critics,
            }

            if req_lang == "en":
                if isinstance(en_data, dict) and en_data.get("ok"):
                    if en_data.get("description_en"):
                        resp_payload["description"] = en_data["description_en"]
                        resp_payload["description_en"] = en_data["description_en"]
                    elif has_cyrillic(str(resp_payload.get("description") or "")):
                        resp_payload["description"] = translate_kinorium_extra_desc_to_en(
                            str(resp_payload.get("description") or "")
                        )
                    en_cast = build_english_cast_people(en_data, resp_payload.get("cast_people"))
                    resp_payload["cast_people"] = en_cast
                    resp_payload["directors"] = [p["name"] for p in en_cast if p.get("is_director")]
                    resp_payload["actors"] = [p["name"] for p in en_cast if not p.get("is_director")]
                    if en_data.get("poster_en"):
                        resp_payload["poster_en"] = en_data["poster_en"]
                    if en_data.get("countries_en"):
                        resp_payload["countries_en"] = en_data["countries_en"]
                    if en_data.get("genres_en"):
                        resp_payload["genres_en"] = en_data["genres_en"]
                    if en_data.get("runtime_min"):
                        resp_payload["duration_label"] = f"{int(en_data['runtime_min'])} min"
                    if en_data.get("episodes_titles_en"):
                        merged_t = dict(resp_payload.get("episodes_titles") or {})
                        for sn_k, ep_dict in en_data["episodes_titles_en"].items():
                            cur_sn = dict(merged_t.get(sn_k) or {})
                            cur_sn.update(ep_dict)
                            merged_t[sn_k] = cur_sn
                        resp_payload["episodes_titles"] = merged_t
                    if en_data.get("episodes_meta_en"):
                        merged_m = dict(resp_payload.get("episodes_meta") or {})
                        for sn_k, ep_dict in en_data["episodes_meta_en"].items():
                            cur_sn_m = dict(merged_m.get(sn_k) or {})
                            for ep_k, ep_info in ep_dict.items():
                                base_ep = dict(cur_sn_m.get(ep_k) or {})
                                base_ep.update({k: v for k, v in ep_info.items() if v})
                                cur_sn_m[ep_k] = base_ep
                            merged_m[sn_k] = cur_sn_m
                        resp_payload["episodes_meta"] = merged_m
                else:
                    if has_cyrillic(str(resp_payload.get("description") or "")):
                        resp_payload["description"] = ""
                    en_cast_fb = build_english_cast_people({}, resp_payload.get("cast_people"))
                    resp_payload["cast_people"] = en_cast_fb
                    resp_payload["directors"] = [p["name"] for p in en_cast_fb if p.get("is_director")]
                    resp_payload["actors"] = [p["name"] for p in en_cast_fb if not p.get("is_director")]
                resp_payload["episodes_titles"], resp_payload["episodes_meta"] = _scrub_cyrillic_episode_dicts(
                    resp_payload.get("episodes_titles"), resp_payload.get("episodes_meta")
                )

            if media_type == "series" and kin_item_id:
                resp_payload["kinorium_status"] = kinorium_service.get_item_status(
                    kin_item_id, title=title, orig_title=orig_title
                )
                resp_payload["kinorium_counts"] = kinorium_service.get_sections_counts()
            self._send_json(resp_payload)
            return

        if path == "/api/download-mp4":
            stream_url = qs.get("url", [""])[0]
            filename = qs.get("filename", ["CineFlow_Video.mp4"])[0]
            parsed_dl = urllib.parse.urlparse(stream_url)
            host_low = (parsed_dl.hostname or "").lower()
            if parsed_dl.scheme not in ("http", "https") or not host_low or host_low in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
                self._send_json({"error": "Invalid external stream URL"}, status=400)
                return
            safe_ascii = "".join(
                c if (c.isascii() and (c.isalnum() or c in (" ", "-", "_", ".", "[", "]"))) else "_"
                for c in filename
            ).strip("_ ")
            if not safe_ascii or safe_ascii.lower() == ".mp4":
                safe_ascii = "CineFlow_Video.mp4"
            elif not safe_ascii.lower().endswith(".mp4"):
                safe_ascii += ".mp4"
            utf8_quoted = urllib.parse.quote(filename if filename.lower().endswith(".mp4") else filename + ".mp4")
            headers_sent = False
            try:
                req = urllib.request.Request(
                    stream_url,
                    headers={
                        "User-Agent": (
                            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
                        )
                    },
                )
                with urllib.request.urlopen(req, timeout=15) as upstream:
                    self.send_response(200)
                    self.send_header("Content-Type", "video/mp4")
                    cl = upstream.headers.get("Content-Length")
                    if cl:
                        self.send_header("Content-Length", cl)
                    self.send_header(
                        "Content-Disposition",
                        f"attachment; filename=\"{safe_ascii}\"; filename*=UTF-8''{utf8_quoted}",
                    )
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    headers_sent = True
                    while True:
                        chunk = upstream.read(262144)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as err:
                if not headers_sent:
                    try:
                        self._send_json({"error": str(err)}, status=502)
                    except Exception:
                        pass
            return

        if path == "/api/proxy-vtt":
            vtt_url = qs.get("url", [""])[0].strip()
            ss_offset = max(0.0, _qs_float(qs, "ss", 0.0))
            vtt_body = "WEBVTT\n\n"
            parsed_sub = urllib.parse.urlparse(vtt_url)
            host_sub = (parsed_sub.hostname or "").lower()
            if parsed_sub.scheme in ("http", "https") and host_sub and host_sub not in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
                with SUBTITLE_CACHE_LOCK:
                    raw_text = SUBTITLE_RAW_CACHE.get(vtt_url, "")
                if not raw_text:
                    try:
                        req_sub = urllib.request.Request(
                            vtt_url,
                            headers={"User-Agent": StremioAddonEngine.UA},
                        )
                        with urllib.request.urlopen(req_sub, timeout=7) as r_sub:
                            if r_sub.status == 200:
                                raw_text = r_sub.read().decode("utf-8", errors="replace")
                    except Exception:
                        st, raw_text_fb, _ = net_client.request(vtt_url, spoof_geo_country="DIRECT", timeout=6)
                        if st == 200 and raw_text_fb:
                            raw_text = raw_text_fb
                    if raw_text:
                        with SUBTITLE_CACHE_LOCK:
                            if len(SUBTITLE_RAW_CACHE) >= 64:
                                SUBTITLE_RAW_CACHE.clear()
                            SUBTITLE_RAW_CACHE[vtt_url] = raw_text
                if raw_text:
                    if raw_text.lstrip().startswith("WEBVTT") and ss_offset < 0.05:
                        vtt_body = raw_text
                    else:
                        vtt_body = convert_srt_or_vtt_to_webvtt(raw_text, offset_sec=ss_offset)
            data_bytes = vtt_body.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/vtt; charset=utf-8")
            self.send_header("Content-Length", str(len(data_bytes)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data_bytes)
            return

        if path == "/api/ad-segments":
            stream_key = qs.get("stream_key", [""])[0].strip()
            mp4_url = qs.get("mp4_url", [""])[0].strip()
            playhead = _qs_float(qs, "playhead", 0.0)
            duration = _qs_float(qs, "duration", 0.0)
            if mp4_url:
                info = ad_skip_engine.start_or_update_scan(
                    stream_key=stream_key,
                    mp4_url=mp4_url,
                    playhead=playhead,
                    duration_hint=duration,
                )
            else:
                info = ad_skip_engine.get_stream_entry(stream_key)
            self._send_json(info)
            return

        if path == "/api/skip-intro":
            imdb_id = qs.get("imdb_id", ["tt11280740"])[0]
            season = max(1, _qs_int(qs, "season", 1))
            episode = max(1, _qs_int(qs, "episode", 1))
            media_type = qs.get("media_type", ["series"])[0]
            title = qs.get("title", [""])[0]
            orig_title = qs.get("orig_title", [""])[0]
            year = _qs_int(qs, "year", 0)
            data = skip_intro_engine.get_skip_segments(
                imdb_id=imdb_id,
                season=season,
                episode=episode,
                media_type=media_type,
                title=title,
                orig_title=orig_title,
                year=year,
            )
            self._send_json(data)
            return

        if path == "/api/backup-streams":
            title = qs.get("title", [""])[0]
            orig_title = qs.get("orig_title", [""])[0]
            year = _qs_int(qs, "year", 2024)
            item_id = qs.get("id", [""])[0]
            rezka_url = qs.get("rezka_url", [""])[0]
            media_type = qs.get("media_type", ["movie"])[0]
            season = max(1, _qs_int(qs, "season", 1))
            episode = max(1, _qs_int(qs, "episode", 1))
            req_lang = _norm_app_lang(qs.get("lang", [APP_PREFS.get("app_lang", "ru")])[0], APP_PREFS.get("app_lang", "ru"))
            data = backup_stream_engine.search_releases(
                title=title,
                orig_title=orig_title,
                year=year,
                item_id=item_id,
                rezka_url=rezka_url,
                media_type=media_type,
                season=season,
                episode=episode,
                stremio_engine=stremio_engine,
                lang=req_lang,
            )
            data["remux_available"] = remux_engine.is_available()
            self._send_json(data)
            return

        if path == "/api/stremio/addons":
            self._send_json({"ok": True, "addons": stremio_engine.get_addons()})
            return

        if path == "/api/stremio/streams":
            item_id = qs.get("id", [""])[0]
            title = qs.get("title", [""])[0]
            orig_title = qs.get("orig_title", [""])[0]
            year = _qs_int(qs, "year", 2024)
            media_type = qs.get("media_type", ["movie"])[0]
            season = max(1, _qs_int(qs, "season", 1))
            episode = max(1, _qs_int(qs, "episode", 1))
            req_lang = _norm_app_lang(qs.get("lang", [APP_PREFS.get("app_lang", "ru")])[0], APP_PREFS.get("app_lang", "ru"))
            st_data = stremio_engine.get_streams_for_title(
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                year=year,
                media_type=media_type,
                season=season,
                episode=episode,
                lang=req_lang,
            )
            st_data["remux_available"] = remux_engine.is_available()
            self._send_json(st_data)
            return

        if path == "/api/remux-probe":
            src_url = (qs.get("src") or qs.get("url") or [""])[0].strip()
            req_lang = _norm_app_lang(qs.get("lang", [APP_PREFS.get("app_lang", "ru")])[0], APP_PREFS.get("app_lang", "ru"))
            is_full = qs.get("full", ["0"])[0].strip().lower() in ("1", "true", "yes")
            self._send_json(remux_engine.probe_media(src_url, fast_probe=not is_full, lang=req_lang))
            return

        if path == "/api/remux-subtitle":
            src_url = qs.get("src", [""])[0].strip()
            stream_idx = max(0, _qs_int(qs, "si", 0))
            start_sec = max(0.0, _qs_float(qs, "ss", 0.0))
            window_sec = max(120.0, min(900.0, _qs_float(qs, "dur", 420.0)))
            vtt_text = remux_engine.extract_subtitle_vtt(
                src_url,
                stream_idx,
                start_sec=start_sec,
                window_sec=window_sec,
            )
            vtt_bytes = vtt_text.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/vtt; charset=utf-8")
            self.send_header("Content-Length", str(len(vtt_bytes)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(vtt_bytes)
            return

        if path == "/api/remux-stream":
            src_url = qs.get("src", [""])[0].strip()
            audio_idx = max(0, _qs_int(qs, "audio", 0))
            start_sec = max(0.0, _qs_float(qs, "start", 0.0))
            vcodec = qs.get("vcodec", [""])[0].strip().lower()
            acodec = qs.get("acodec", [""])[0].strip().lower()
            compat_h264 = qs.get("compat", [""])[0].strip().lower() in ("h264", "1", "true")
            channels = max(1, _qs_int(qs, "ch", 2))
            if not src_url.startswith(("http://", "https://")) or not remux_engine.is_available():
                self._send_json({"error": "Remux source unavailable"}, status=400)
                return

            cmd = remux_engine.build_remux_command(
                source_url=src_url,
                audio_index=audio_idx,
                start_sec=start_sec,
                video_codec=vcodec,
                channels=channels,
                audio_codec=acodec,
                force_h264=compat_h264,
            )
            proc = None
            headers_sent = False
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    bufsize=131072,
                )
                first_chunk = proc.stdout.read(65536) if proc.stdout else b""
                if not first_chunk:
                    self._send_json({"error": "FFmpeg produced empty stream"}, status=502)
                    return

                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Accept-Ranges", "none")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                headers_sent = True
                self.wfile.write(first_chunk)
                while proc.stdout:
                    chunk = proc.stdout.read(131072)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as err:
                if not headers_sent:
                    try:
                        self._send_json({"error": str(err)}, status=502)
                    except Exception:
                        pass
            finally:
                if proc and proc.poll() is None:
                    try:
                        proc.terminate()
                        proc.wait(timeout=1.2)
                    except Exception:
                        try:
                            proc.kill()
                        except Exception:
                            pass
            return

        if path == "/api/video-snapshot":
            src_url = qs.get("url", [""])[0].strip()
            ts_sec = max(0.0, _qs_float(qs, "ss", 0.0))
            png_bytes = remux_engine.capture_frame_png(src_url, timestamp_sec=ts_sec)
            if not png_bytes:
                self._send_json({"error": "Failed to capture video frame"}, status=502)
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(png_bytes)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(png_bytes)
            return

        if path == "/api/kinorium/live-digest":
            raw_meta = kinorium_service.state.get("series_live_meta") or {}
            seen_ids = set()
            updates_out = []
            for entry in raw_meta.values():
                if not isinstance(entry, dict) or entry.get("not_found"):
                    continue
                dedup = str(entry.get("id") or entry.get("kinorium_id") or entry.get("title") or "")
                if not dedup or dedup in seen_ids:
                    continue
                seen_ids.add(dedup)
                updates_out.append(entry)
            self._send_json(
                {
                    "ok": True,
                    "updates": updates_out,
                    "kinorium_counts": kinorium_service.get_sections_counts(),
                    "last_bg_sync_at": LAST_BG_WATCHING_SYNC.get("ts", 0.0),
                    "torrserver_connected": backup_stream_engine._is_torrserver_alive(),
                    "remux_available": remux_engine.is_available(),
                }
            )
            return

        if path == "/api/integrations":
            self._send_json({"integrations": kinorium_service.get_integrations()})
            return

        if path == "/api/kinorium/stats":
            self._send_json(kinorium_service.get_profile_stats())
            return

        if path == "/api/backup/export":
            self._send_json(
                {
                    "app": "CineFlow",
                    "version": "2.0",
                    "exported_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "app_lang": APP_PREFS.get("app_lang", "ru"),
                    "hdrezka": {
                        "custom_mirror": rezka_client.custom_mirror,
                        "proxy_url": rezka_client.proxy_url,
                        "cf_worker_relay": rezka_client.cf_worker_relay,
                        "spoof_region": rezka_client.spoof_region,
                        "preferred_studios": rezka_client.preferred_studios,
                    },
                    "backup_stream": {
                        "mode": backup_stream_engine.mode,
                        "torrserver_url": backup_stream_engine.torrserver_url,
                        "debrid_api_key": backup_stream_engine.debrid_api_key,
                    },
                    "kinorium_state": kinorium_service.export_backup_state(),
                    "stremio_addons": stremio_engine.get_addons(),
                }
            )
            return

        if path == "/api/system/status":
            self._send_json(get_system_status_payload())
            return

        if path == "/api/settings":
            self._send_json(
                {
                    "region": "PL (Poland)",
                    "app_lang": APP_PREFS.get("app_lang", "ru"),
                    "system": get_system_status_payload(),
                    "hdrezka": {
                        "custom_mirror": rezka_client.custom_mirror,
                        "proxy_url": rezka_client.proxy_url,
                        "cf_worker_relay": rezka_client.cf_worker_relay,
                        "spoof_region": rezka_client.spoof_region,
                        "preferred_studios": rezka_client.preferred_studios,
                        "active_mirrors": rezka_client.get_mirrors(),
                    },
                    "backup_stream": {
                        "mode": backup_stream_engine.mode,
                        "torrserver_url": backup_stream_engine.torrserver_url,
                        "torrserver_connected": backup_stream_engine._is_torrserver_alive(),
                        "torrserver_builtin": bool(backup_stream_engine.torr_bin_path),
                        "remux_available": remux_engine.is_available(),
                        "hw_accel": remux_engine.get_hw_capabilities(),
                        "debrid_configured": bool(backup_stream_engine.debrid_api_key),
                    },
                    "stremio_addons": stremio_engine.get_addons(),
                    "kinorium": kinorium_service.state["account"],
                    "integrations": kinorium_service.get_integrations(),
                    "webview_userscript": skip_intro_engine.get_webview_cinema_userscript(),
                }
            )
            return

        if path.startswith("/api/"):
            self._send_json({"error": "Not found"}, status=404)
            return

        if path == "/favicon.ico":
            rel_path = "favicon.svg"
        else:
            rel_path = "index.html" if path in ("/", "") else path.lstrip("/")
        file_path = os.path.normpath(os.path.join(PUBLIC_DIR, rel_path))
        is_asset_request = bool(
            path not in ("/", "")
            and (
                os.path.splitext(rel_path)[1]
                or rel_path.startswith(("css/", "js/", "assets/", "icons/", "fonts/"))
            )
        )
        if not file_path.startswith(PUBLIC_DIR) or not os.path.isfile(file_path):
            if is_asset_request:
                self.send_response(404)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            file_path = os.path.join(PUBLIC_DIR, "index.html")

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
        with open(file_path, "rb") as f:
            content = f.read()

        use_static_gzip = False
        if file_path.endswith((".html", ".css", ".js", ".mjs", ".svg")) and len(content) > 1024:
            accept_enc = self.headers.get("Accept-Encoding") or ""
            if "gzip" in accept_enc.lower():
                content = gzip.compress(content, compresslevel=5)
                use_static_gzip = True

        try:
            self.send_response(200)
            self.send_header("Content-Type", mime_type)
            if use_static_gzip:
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Vary", "Accept-Encoding")
            self.send_header("Content-Length", str(len(content)))
            if file_path.endswith((".html", ".css", ".js")):
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
            self.end_headers()
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self._read_json_body()

        if path == "/api/ad-detect-frame":
            res = ad_skip_engine.analyze_live_frame(
                jpeg_b64=str(body.get("jpeg_b64") or ""),
                timestamp=_safe_float(body.get("timestamp"), 0.0),
                stream_key=str(body.get("stream_key") or ""),
                mp4_url=str(body.get("mp4_url") or ""),
                duration=_safe_float(body.get("duration"), 0.0),
            )
            self._send_json(res)
            return

        if path == "/api/ad-scan-stop":
            ad_skip_engine.stop_scan()
            self._send_json({"ok": True})
            return

        if path == "/api/kinorium/scrobble":
            raw_comp = body.get("is_series_completed")
            res = kinorium_service.update_progress_and_scrobble(
                item_id=str(body.get("id", "tt11280740")),
                title=str(body.get("title", "")),
                orig_title=str(body.get("orig_title", "")),
                poster=str(body.get("poster", "")),
                backdrop=str(body.get("backdrop", "")),
                media_type=str(body.get("media_type", "movie")),
                season=max(1, _safe_int(body.get("season"), 1)),
                episode=max(1, _safe_int(body.get("episode"), 1)),
                current_time=_safe_float(body.get("current_time"), 0.0),
                duration=_safe_float(body.get("duration"), 1.0),
                source=str(body.get("source", "HDRezka")),
                studio=str(body.get("studio", "HDRezka Studio")),
                total_seasons=max(0, _safe_int(body.get("total_seasons"), 1)),
                total_episodes_in_season=max(0, _safe_int(body.get("total_episodes_in_season"), 1)),
                is_series_completed=bool(raw_comp) if isinstance(raw_comp, bool) else None,
            )
            self._send_json(res)
            return

        if path in ("/api/kinorium/rate-episode", "/api/kinorium/rate") and (
            path == "/api/kinorium/rate-episode" or body.get("scope") == "episode"
        ):
            raw_comp = body.get("is_series_completed")
            raw_score = 0 if body.get("clear") else _safe_int(body.get("score"), 8)
            score_val = 0 if raw_score <= 0 else max(1, min(10, raw_score))
            res = kinorium_service.set_episode_rating(
                item_id=str(body.get("id", "")),
                title=str(body.get("title", "")),
                season=max(1, _safe_int(body.get("season"), 1)),
                episode=max(1, _safe_int(body.get("episode"), 1)),
                score=score_val,
                comment=str(body.get("comment", "")),
                orig_title=str(body.get("orig_title", "")),
                episode_title=str(body.get("episode_title", "")),
                total_seasons=max(0, _safe_int(body.get("total_seasons"), 0)),
                total_episodes_in_season=max(0, _safe_int(body.get("total_episodes_in_season"), 0)),
                is_series_completed=bool(raw_comp) if isinstance(raw_comp, bool) else None,
                poster=body.get("poster"),
                backdrop=body.get("backdrop"),
                year=body.get("year"),
                rezka_id=body.get("rezka_id"),
                rezka_url=body.get("rezka_url"),
            )
            self._send_json(res)
            return

        if path == "/api/kinorium/rate":
            raw_comp = body.get("is_series_completed")
            raw_score = 0 if body.get("clear") else _safe_int(body.get("score"), 8)
            score_val = 0 if raw_score <= 0 else max(1, min(10, raw_score))
            res = kinorium_service.set_rating(
                item_id=str(body.get("id", "")),
                title=str(body.get("title", "")),
                score=score_val,
                comment=str(body.get("comment", "")),
                orig_title=str(body.get("orig_title", "")),
                is_series_completed=bool(raw_comp) if isinstance(raw_comp, bool) else None,
                poster=body.get("poster"),
                backdrop=body.get("backdrop"),
                year=body.get("year"),
                media_type=body.get("media_type"),
                rezka_id=body.get("rezka_id"),
                rezka_url=body.get("rezka_url"),
            )
            self._send_json(res)
            return

        if path == "/api/kinorium/watched":
            res = kinorium_service.mark_watched(
                item_id=str(body.get("id", "")),
                title=str(body.get("title", "")),
                orig_title=str(body.get("orig_title", "")),
                watched=bool(body.get("watched", True)),
                season=body.get("season"),
                episode=body.get("episode"),
                poster=body.get("poster"),
                backdrop=body.get("backdrop"),
                year=body.get("year"),
                media_type=body.get("media_type"),
                rezka_id=body.get("rezka_id"),
                rezka_url=body.get("rezka_url"),
            )
            self._send_json(res)
            return

        if path == "/api/kinorium/episode-watched":
            raw_comp = body.get("is_series_completed")
            watched_arg = body.get("watched")
            res = kinorium_service.toggle_episode_watched(
                item_id=str(body.get("id", "")),
                title=str(body.get("title", "")),
                orig_title=str(body.get("orig_title", "")),
                season=max(1, _safe_int(body.get("season"), 1)),
                episode=max(1, _safe_int(body.get("episode"), 1)),
                watched=bool(watched_arg) if isinstance(watched_arg, bool) else None,
                total_seasons=max(0, _safe_int(body.get("total_seasons"), 0)),
                total_episodes_in_season=max(0, _safe_int(body.get("total_episodes_in_season"), 0)),
                is_series_completed=bool(raw_comp) if isinstance(raw_comp, bool) else None,
                poster=body.get("poster"),
                backdrop=body.get("backdrop"),
                year=body.get("year"),
                media_type=body.get("media_type") or "series",
                rezka_id=body.get("rezka_id"),
                rezka_url=body.get("rezka_url"),
            )
            self._send_json(res)
            return

        if path == "/api/kinorium/watched-episodes-batch":
            raw_comp = body.get("is_series_completed")
            res = kinorium_service.mark_episodes_batch(
                item_id=str(body.get("id", "")),
                title=str(body.get("title", "")),
                orig_title=str(body.get("orig_title", "")),
                season=max(1, _safe_int(body.get("season"), 1)),
                episodes=body.get("episodes") or [],
                mark_season_complete=bool(body.get("mark_season_complete", False)),
                total_seasons=max(0, _safe_int(body.get("total_seasons"), 0)),
                total_episodes_in_season=max(0, _safe_int(body.get("total_episodes_in_season"), 0)),
                is_series_completed=bool(raw_comp) if isinstance(raw_comp, bool) else None,
                poster=body.get("poster"),
                backdrop=body.get("backdrop"),
                year=body.get("year"),
                media_type=body.get("media_type") or "series",
                rezka_id=body.get("rezka_id"),
                rezka_url=body.get("rezka_url"),
            )
            self._send_json(res)
            return

        if path == "/api/kinorium/watchlist":
            res = kinorium_service.toggle_watchlist(
                item_id=str(body.get("id", "")),
                title=str(body.get("title", "")),
                orig_title=str(body.get("orig_title", "")),
                poster=body.get("poster"),
                backdrop=body.get("backdrop"),
                year=body.get("year"),
                media_type=body.get("media_type"),
                rezka_id=body.get("rezka_id"),
                rezka_url=body.get("rezka_url"),
            )
            self._send_json(res)
            return

        if path == "/api/kinorium/watching":
            res = kinorium_service.toggle_watching(
                item_id=str(body.get("id", "")),
                title=str(body.get("title", "")),
                orig_title=str(body.get("orig_title", "")),
                poster=body.get("poster"),
                backdrop=body.get("backdrop"),
                year=body.get("year"),
                media_type=body.get("media_type"),
                rezka_id=body.get("rezka_id"),
                rezka_url=body.get("rezka_url"),
            )
            self._send_json(res)
            return

        if path == "/api/kinorium/never":
            res = kinorium_service.toggle_not_watching(
                item_id=str(body.get("id", "")),
                title=str(body.get("title", "")),
                orig_title=str(body.get("orig_title", "")),
                poster=body.get("poster"),
                backdrop=body.get("backdrop"),
                year=body.get("year"),
                media_type=body.get("media_type"),
                rezka_id=body.get("rezka_id"),
                rezka_url=body.get("rezka_url"),
            )
            self._send_json(res)
            return

        if path == "/api/kinorium/continue-watching/remove":
            res = kinorium_service.dismiss_continue_watching(
                item_id=str(body.get("id", "")),
                title=str(body.get("title", "")),
            )
            self._send_json(res)
            return

        if path == "/api/kinorium/sync":
            user_input = str(body.get("user_id") or body.get("profile_url") or kinorium_service.state.get("account", {}).get("user_id") or "51670")
            session_cookie = body.get("session_cookie")
            try:
                sync_info = kinorium_service.sync_user_profile(user_input, session_cookie=session_cookie)
                self._send_json(
                    {
                        "ok": bool(sync_info.get("synced", True)),
                        "sync": sync_info,
                        "kinorium_account": kinorium_service.get_account_summary(),
                        "integrations": kinorium_service.get_integrations(),
                    }
                )
            except Exception as exc:
                self._send_json(
                    {
                        "ok": False,
                        "sync": {"synced": False, "error": str(exc)},
                        "kinorium_account": kinorium_service.get_account_summary(),
                        "integrations": kinorium_service.get_integrations(),
                    },
                    status=200,
                )
            return

        if path == "/api/kinorium/disconnect":
            acc = kinorium_service.disconnect_user_profile()
            self._send_json(
                {
                    "ok": True,
                    "kinorium_account": acc,
                    "integrations": kinorium_service.get_integrations(),
                }
            )
            return

        if path == "/api/backup/import":
            if "app_lang" in body:
                APP_PREFS["app_lang"] = _norm_app_lang(body.get("app_lang"), APP_PREFS.get("app_lang", "ru"))
            rezka_cfg = body.get("hdrezka") or {}
            if isinstance(rezka_cfg, dict) and rezka_cfg:
                rezka_client.configure(
                    custom_mirror=rezka_cfg.get("custom_mirror"),
                    proxy_url=rezka_cfg.get("proxy_url"),
                    cf_worker_relay=rezka_cfg.get("cf_worker_relay"),
                    spoof_region=rezka_cfg.get("spoof_region"),
                    preferred_studios=rezka_cfg.get("preferred_studios"),
                )
            bkp_cfg = body.get("backup_stream") or {}
            if isinstance(bkp_cfg, dict) and bkp_cfg:
                backup_stream_engine.configure(
                    mode=bkp_cfg.get("mode"),
                    debrid_api_key=bkp_cfg.get("debrid_api_key"),
                    torrserver_url=bkp_cfg.get("torrserver_url"),
                )
            if isinstance(body.get("stremio_addons"), list):
                stremio_engine.restore_addons(body["stremio_addons"])
            save_persisted_server_settings()
            k_state = body.get("kinorium_state") or {}
            acc = kinorium_service.import_backup_state(k_state)
            total_watched = len(kinorium_service.state.get("remote_watched_items") or {}) + len(
                kinorium_service.state.get("watched") or {}
            )
            self._send_json(
                {
                    "ok": True,
                    "kinorium_account": acc,
                    "integrations": kinorium_service.get_integrations(),
                    "restored": {
                        "ratings_count": len(kinorium_service.state.get("ratings") or {})
                        + len(kinorium_service.state.get("remote_watched_items") or {}),
                        "continue_watching_count": len(kinorium_service.state.get("continue_watching") or []),
                        "watched_count": total_watched,
                    },
                }
            )
            return

        if path == "/api/integrations":
            service_id = str(body.get("service_id", ""))
            logged_in = body.get("logged_in", None)
            if logged_in is not None:
                logged_in = bool(logged_in)
            enabled = body.get("enabled", None)
            if enabled is not None:
                enabled = bool(enabled)
            username = str(body.get("username", ""))
            updated = kinorium_service.set_service_login(
                service_id,
                logged_in=logged_in,
                username=username,
                enabled=enabled,
            )
            self._send_json({"ok": True, "integrations": updated})
            return

        if path == "/api/debrid/resolve":
            magnet = str(body.get("magnet") or "").strip()
            media_type = str(body.get("media_type") or "movie")
            season = max(1, _safe_int(body.get("season"), 1))
            episode = max(1, _safe_int(body.get("episode"), 1))
            provider = body.get("provider")
            self._send_json(
                backup_stream_engine.resolve_debrid_magnet(
                    magnet=magnet,
                    media_type=media_type,
                    season=season,
                    episode=episode,
                    provider=provider,
                )
            )
            return

        if path == "/api/stremio/addons":
            action = str(body.get("action") or "add").strip().lower()
            if action == "add":
                res = stremio_engine.add_addon_by_url(str(body.get("manifest_url") or ""))
                aggregator._catalog_cache.clear()
                self._send_json(res, status=200 if res.get("ok") else 400)
                return
            if action == "toggle":
                res = stremio_engine.toggle_addon(
                    str(body.get("manifest_url") or body.get("id") or ""),
                    bool(body.get("enabled", True)),
                )
                aggregator._catalog_cache.clear()
                self._send_json(res)
                return
            if action == "remove":
                res = stremio_engine.remove_addon(str(body.get("manifest_url") or body.get("id") or ""))
                aggregator._catalog_cache.clear()
                self._send_json(res)
                return
            if action == "restore":
                stremio_engine.restore_addons(body.get("addons"))
                aggregator._catalog_cache.clear()
                self._send_json({"ok": True, "addons": stremio_engine.get_addons()})
                return
            self._send_json({"ok": False, "error": "Unknown action"}, status=400)
            return

        if path == "/api/stremio/resolve":
            raw_fidx = body.get("file_idx")
            file_idx_val = int(raw_fidx) if isinstance(raw_fidx, int) and raw_fidx >= 0 else None
            magnet_val = str(body.get("magnet") or "").strip()
            info_hash_val = str(body.get("info_hash") or "").strip()
            if not magnet_val and info_hash_val and len(info_hash_val) >= 32:
                magnet_val = f"magnet:?xt=urn:btih:{info_hash_val}"
            res = stremio_engine.resolve_stream_to_playable_url(
                magnet=magnet_val,
                filename_hint=str(body.get("filename_hint") or ""),
                file_idx=file_idx_val,
                media_type=str(body.get("media_type") or "movie"),
                season=max(1, _safe_int(body.get("season"), 1)),
                episode=max(1, _safe_int(body.get("episode"), 1)),
            )
            self._send_json(res, status=200 if res.get("ok") else 400)
            return

        if path == "/api/system/lan":
            enabled = bool(body.get("enabled"))
            APP_PREFS["lan_access"] = enabled
            save_persisted_server_settings()
            sync_lan_listener(enabled)
            self._send_json({"ok": True, "system": get_system_status_payload()})
            return

        if path == "/api/system/autostart":
            enabled = bool(body.get("enabled"))
            res = set_macos_autostart(enabled)
            status_code = 200 if res.get("ok") else 400
            self._send_json({**res, "system": get_system_status_payload()}, status=status_code)
            return

        if path == "/api/settings":
            if "app_lang" in body:
                APP_PREFS["app_lang"] = _norm_app_lang(body.get("app_lang"), APP_PREFS.get("app_lang", "ru"))
            rezka_cfg = body.get("hdrezka", {})
            if isinstance(rezka_cfg, dict):
                rezka_client.configure(
                    custom_mirror=rezka_cfg.get("custom_mirror"),
                    proxy_url=rezka_cfg.get("proxy_url"),
                    cf_worker_relay=rezka_cfg.get("cf_worker_relay"),
                    spoof_region=rezka_cfg.get("spoof_region"),
                    preferred_studios=rezka_cfg.get("preferred_studios"),
                )
            bkp_cfg = body.get("backup_stream", {})
            if isinstance(bkp_cfg, dict):
                backup_stream_engine.configure(
                    mode=bkp_cfg.get("mode"),
                    debrid_api_key=bkp_cfg.get("debrid_api_key"),
                    torrserver_url=bkp_cfg.get("torrserver_url"),
                )
                if backup_stream_engine.mode == "torrserver":
                    backup_stream_engine.ensure_local_torrserver()
            if isinstance(body.get("stremio_addons"), list):
                stremio_engine.restore_addons(body["stremio_addons"])
            save_persisted_server_settings()
            kin_cfg = body.get("kinorium", {})
            if isinstance(kin_cfg, dict) and kin_cfg:
                kinorium_service.configure_account(
                    username=kin_cfg.get("username", ""),
                    session_cookie=kin_cfg.get("session_cookie", ""),
                    threshold=_safe_float(kin_cfg.get("auto_scrobble_threshold"), 0.85),
                )
            self._send_json(
                {
                    "ok": True,
                    "app_lang": APP_PREFS.get("app_lang", "ru"),
                    "integrations": kinorium_service.get_integrations(),
                    "backup_stream": {
                        "mode": backup_stream_engine.mode,
                        "torrserver_url": backup_stream_engine.torrserver_url,
                        "torrserver_connected": backup_stream_engine._is_torrserver_alive(),
                        "debrid_configured": bool(backup_stream_engine.debrid_api_key),
                    },
                }
            )
            return

        self._send_json({"error": "Not found"}, status=404)


class CinemaThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def _start_background_watching_sync_daemon() -> None:
    def _worker():
        time.sleep(3.0)
        try:
            if kinorium_service.is_service_enabled("kinorium"):
                kinorium_service.reconcile_all_local_episodes(pull_watching_limit=16)
        except Exception:
            pass
        time.sleep(17.0)
        while True:
            try:
                if kinorium_service.is_service_enabled("kinorium"):
                    kinorium_service.reconcile_all_local_episodes(pull_watching_limit=12)
                if kinorium_service.is_service_enabled("hdrezka") and kinorium_service.is_service_enabled("kinorium"):
                    all_watching = aggregator._enrich_from_curated(
                        kinorium_service.get_section_catalog_items(
                            section="watching", media_type_filter="series", query=""
                        )
                    )
                    now_ts = time.time()
                    ttl_sec = 10800.0  # 3 hours
                    stale_items = []
                    for it in all_watching:
                        ks = it.get("kinorium") or {}
                        if ks.get("watched") or ks.get("not_watching"):
                            continue
                        cached_m = kinorium_service.get_series_live_meta(
                            item_id=str(it.get("id") or ""),
                            title=str(it.get("title") or ""),
                            orig_title=str(it.get("orig_title") or ""),
                            kid=ks.get("kinorium_id"),
                        )
                        if not cached_m or (now_ts - float(cached_m.get("updated_at") or 0.0)) >= ttl_sec:
                            stale_items.append(it)
                    if stale_items:
                        fresh = rezka_client.check_series_latest_episodes(stale_items[:6], batch_limit=6)
                        if fresh:
                            kinorium_service.save_series_live_meta(fresh)
                        LAST_BG_WATCHING_SYNC["ts"] = time.time()
                        LAST_BG_WATCHING_SYNC["checked"] = len(fresh or [])
            except Exception:
                pass
            time.sleep(1800.0)  # check every 30 minutes gently

    t = threading.Thread(target=_worker, name="CineFlowWatchingSync", daemon=True)
    t.start()


def _is_port_already_serving_cineflow(port: int) -> bool:
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/system/status", method="GET")
        with urllib.request.urlopen(req, timeout=1.2) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                return isinstance(data, dict) and data.get("app") == "cineflow"
    except Exception:
        pass
    return False


def run_server(port: int = 8765):
    SERVER_RUNTIME["port"] = port
    SERVER_RUNTIME["running"] = True
    backup_stream_engine.ensure_local_torrserver()
    _start_background_watching_sync_daemon()

    server = CinemaThreadingHTTPServer(("127.0.0.1", port), CinemaRequestHandler)
    with SERVER_RUNTIME["lock"]:
        SERVER_RUNTIME["server"] = server
    if APP_PREFS.get("lan_access"):
        sync_lan_listener(True)

    lan_ip = detect_lan_ipv4()
    print("============================================================")
    print("CineFlow Unified Cinema (Apple TV Edition • Poland PL)")
    print(f"Local Cinema Server running at: http://127.0.0.1:{port}")
    if APP_PREFS.get("lan_access") and lan_ip:
        print(f"Home Wi-Fi / LAN URL:           http://{lan_ip}:{port}")
    print("============================================================")
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        SERVER_RUNTIME["running"] = False
        sync_lan_listener(False)
        try:
            server.server_close()
        except Exception:
            pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    if "--launchd" in sys.argv and _is_port_already_serving_cineflow(port):
        sys.exit(0)
    run_server(port)
