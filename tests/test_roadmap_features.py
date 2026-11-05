import base64
import glob
import hashlib
import json
import os
import plistlib
import py_compile
import socket
import struct
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

import server
from backend.doh import DoHSplitNetworkClient
from backend.downloads import OfflineDownloadManager, parse_http_byte_range
from backend.kinorium import KinoriumService
from backend.kinorium_auth import KinoriumOneClickAuthManager
from backend.profiles import ProfileManager
from backend.tv_cast import (
    DlnaCastManager,
    build_soap_set_av_transport_uri,
    format_dlna_rel_time,
    parse_ssdp_headers,
    parse_upnp_device_xml,
)


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class _DummyRemuxEngine:
    ffmpeg_path = "/usr/bin/ffmpeg"
    _hw_caps = {"h264_videotoolbox": True, "aac_at": True}

    @staticmethod
    def is_available() -> bool:
        return True


class TestRoadmapFeatures(unittest.TestCase):
    def test_profiles_isolation_and_kids_safe_filter(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            # Pre-seed personal 'main' Kinorium state to prove 100% non-destructive preservation
            main_state_path = os.path.join(tmpdir, "kinorium_state.json")
            kin = KinoriumService(DoHSplitNetworkClient(), storage_dir=tmpdir)
            kin.mark_watched(
                item_id="tt0816692",
                title="Интерстеллар",
                orig_title="Interstellar",
                watched=True,
                kinorium_id="716587",
            )
            self.assertTrue(kin.get_item_status("tt0816692", "Интерстеллар")["watched"])

            pm = ProfileManager(data_dir=tmpdir)
            payload = pm.get_profiles_payload(lang="ru", live_kinorium_service=kin)
            prof_ids = [p["id"] for p in payload["profiles"]]
            self.assertEqual(prof_ids[:3], ["main", "family", "kids"])
            self.assertEqual(payload["active_profile_id"], "main")
            self.assertEqual(os.path.abspath(pm.get_kinorium_state_path("main")), os.path.abspath(main_state_path))

            # Switch to 'family' -> isolated state file, 'Interstellar' is NOT watched in 'family'
            switched = pm.switch_profile("family")
            self.assertEqual(switched["id"], "family")
            fam_state_path = pm.get_kinorium_state_path("family")
            self.assertNotEqual(os.path.abspath(fam_state_path), os.path.abspath(main_state_path))
            kin.switch_state_file(fam_state_path)
            self.assertFalse(kin.get_item_status("tt0816692", "Интерстеллар")["watched"])
            kin.mark_watched(
                item_id="tt0133093",
                title="Матрица",
                orig_title="The Matrix",
                watched=True,
                kinorium_id="104439",
            )
            self.assertTrue(kin.get_item_status("tt0133093", "Матрица")["watched"])

            # Switch back to 'main' -> personal 'Interstellar' is intact, 'The Matrix' did not leak
            pm.switch_profile("main")
            kin.switch_state_file(pm.get_kinorium_state_path("main"))
            self.assertTrue(kin.get_item_status("tt0816692", "Интерстеллар")["watched"])
            self.assertFalse(kin.get_item_status("tt0133093", "Матрица")["watched"])

            # Custom profile create + delete + builtin deletion protection
            created = pm.save_profile(
                profile_id="",
                name="Гостевой",
                avatar_color="#BF5AF2",
                kids_mode=False,
                default_audio_pref="original",
            )
            self.assertTrue(created["id"].startswith("prof_"))
            self.assertEqual(created["default_audio_pref"], "original")
            self.assertTrue(pm.delete_profile(created["id"]))
            with self.assertRaises(ValueError):
                pm.delete_profile("main")

            # Kids catalog safety filter
            sample_catalog = {
                "items": [
                    {
                        "id": "kids_ok_1",
                        "title": "Головоломка 2",
                        "orig_title": "Inside Out 2",
                        "genres": ["мультфильм", "семейный", "приключения"],
                    },
                    {
                        "id": "adult_horror_1",
                        "title": "Пила 10",
                        "orig_title": "Saw X",
                        "genres": ["ужасы", "триллер"],
                    },
                    {
                        "id": "adult_series_1",
                        "title": "Пацаны",
                        "orig_title": "The Boys",
                        "genres": ["фантастика", "криминал"],
                    },
                ],
                "continue_watching": [
                    {"id": "adult_horror_1", "title": "Пила 10", "genres": ["ужасы"]},
                    {"id": "kids_ok_1", "title": "Головоломка 2", "genres": ["мультфильм"]},
                ],
                "hero": {"id": "adult_horror_1", "title": "Пила 10", "genres": ["ужасы"]},
            }
            filtered = ProfileManager.filter_catalog_payload_for_kids(sample_catalog)
            kept_ids = [it["id"] for it in filtered["items"]]
            self.assertEqual(kept_ids, ["kids_ok_1"])
            self.assertEqual([it["id"] for it in filtered["continue_watching"]], ["kids_ok_1"])
            self.assertEqual(filtered["hero"]["id"], "kids_ok_1")

    def test_offline_download_ffmpeg_builder_and_byte_ranges(self):
        self.assertEqual(parse_http_byte_range("bytes=0-99", 1000), (0, 99))
        self.assertEqual(parse_http_byte_range("bytes=500-", 1000), (500, 999))
        self.assertEqual(parse_http_byte_range("bytes=-200", 1000), (800, 999))
        self.assertIsNone(parse_http_byte_range("", 1000))
        with self.assertRaises(ValueError):
            parse_http_byte_range("bytes=1200-1300", 1000)

        with tempfile.TemporaryDirectory() as tmpdir:
            dm = OfflineDownloadManager(data_dir=tmpdir, remux_engine=_DummyRemuxEngine(), start_workers=False)
            hls_cmd = dm.build_ffmpeg_download_command(
                source_url="https://cdn.example.com/master.m3u8",
                output_path="/tmp/out.mp4",
                is_remux_source=False,
            )
            self.assertIn("aac_adtstoasc", hls_cmd)
            self.assertIn("+faststart", hls_cmd)

            remux_cmd = dm.build_ffmpeg_download_command(
                source_url="http://127.0.0.1:8090/stream/film.mkv",
                output_path="/tmp/out4k.mp4",
                audio_index=2,
                video_codec="hevc",
                audio_codec="eac3",
                channels=6,
                is_remux_source=True,
            )
            self.assertIn("0:a:2?", remux_cmd)
            self.assertIn("hvc1", remux_cmd)
            self.assertIn("aac_at", remux_cmd)
            self.assertTrue(any("pan=stereo" in arg for arg in remux_cmd))

            # Verify Windows NVIDIA NVENC hardware encoder selection for legacy MPEG-2 / VC-1 video
            class _WinNvencRemuxEngine:
                ffmpeg_path = "C:\\CineFlow\\backend\\bin\\ffmpeg.exe"
                _hw_caps = {"h264_nvenc": True, "aac_at": False}

                @staticmethod
                def is_available() -> bool:
                    return True

            dm_win = OfflineDownloadManager(data_dir=tmpdir, remux_engine=_WinNvencRemuxEngine(), start_workers=False)
            win_cmd = dm_win.build_ffmpeg_download_command(
                source_url="http://127.0.0.1:8090/stream/legacy.mkv",
                output_path="C:\\CineFlow\\data\\downloads\\out.mp4",
                audio_index=1,
                video_codec="mpeg2video",
                audio_codec="ac3",
                channels=6,
                is_remux_source=True,
            )
            self.assertIn("h264_nvenc", win_cmd)
            self.assertIn("aac", win_cmd)

    def test_dlna_ssdp_upnp_soap_and_qr_payload(self):
        ssdp_pkt = (
            "HTTP/1.1 200 OK\r\n"
            "CACHE-CONTROL: max-age=1800\r\n"
            "LOCATION: http://192.168.1.55:1400/xml/device_description.xml\r\n"
            "ST: urn:schemas-upnp-org:service:AVTransport:1\r\n\r\n"
        )
        hdrs = parse_ssdp_headers(ssdp_pkt)
        self.assertEqual(hdrs.get("location"), "http://192.168.1.55:1400/xml/device_description.xml")

        sample_upnp_xml = """<?xml version="1.0"?>
        <root xmlns="urn:schemas-upnp-org:device-1-0">
          <device>
            <friendlyName>Living Room LG OLED</friendlyName>
            <manufacturer>LG Electronics</manufacturer>
            <modelName>OLED65C4</modelName>
            <UDN>uuid:1234-5678-oled</UDN>
            <serviceList>
              <service>
                <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
                <controlURL>/upnp/control/AVTransport1</controlURL>
              </service>
            </serviceList>
          </device>
        </root>"""
        dev = parse_upnp_device_xml(sample_upnp_xml, "http://192.168.1.55:1400/xml/device_description.xml")
        self.assertIsNotNone(dev)
        self.assertEqual(dev["name"], "Living Room LG OLED")
        self.assertEqual(dev["control_url"], "http://192.168.1.55:1400/upnp/control/AVTransport1")
        self.assertIsNone(parse_upnp_device_xml("<!DOCTYPE foo [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]>", "http://192.168.1.55/d.xml"))

        soap_action, soap_xml = build_soap_set_av_transport_uri(
            stream_url="http://192.168.1.10:8765/api/downloads/stream/dl_test",
            title="Severance S2E1",
            subtitle_url="http://192.168.1.10:8765/api/downloads/sub/dl_test/sub_0_ru.vtt",
        )
        self.assertIn("SetAVTransportURI", soap_action)
        self.assertIn("CaptionInfoEx", soap_xml)
        self.assertEqual(format_dlna_rel_time(3665), "01:01:05")

        lan_url = DlnaCastManager.build_lan_stream_url(
            "http://127.0.0.1:8765/api/proxy-stream?url=https%3A%2F%2Fcdn.example%2Fv.mp4",
            "192.168.1.25",
            8765,
        )
        self.assertTrue(lan_url.startswith("http://192.168.1.25:8765/api/proxy-stream"))

        qr = DlnaCastManager.build_tv_qr_payload("192.168.1.25", 8765, item_id="tt11280740", season=2, episode=3)
        self.assertEqual(qr["tv_url"], "http://192.168.1.25:8765/?tv=1&p=tt11280740&s=2&e=3")
        self.assertLessEqual(len(qr["tv_url"].encode("utf-8")), 102)
        self.assertIn("<svg", qr["qr_svg"])

    def test_kinorium_one_click_auth_and_native_macos_bundle(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            kin = KinoriumService(DoHSplitNetworkClient(), storage_dir=tmpdir)
            mgr = KinoriumOneClickAuthManager(base_dir=BASE_DIR, kinorium_service=kin)
            with patch.object(
                kin,
                "sync_user_profile",
                return_value={
                    "synced": True,
                    "user_id": "987654",
                    "display_name": "CinemaFan",
                    "watched_count": 42,
                },
            ):
                res = mgr.complete_with_captured_session(
                    user_id="987654",
                    session_cookie="PHPSESSID=test_token_123; ulogin=987654",
                    display_name_hint="CinemaFan",
                )
            self.assertTrue(res["ok"])
            self.assertEqual(res["status"], "done")
            self.assertEqual(res["user_id"], "987654")
            self.assertTrue(kin.get_account_summary()["has_session_cookie"])

        win_webview = os.path.join(BASE_DIR, "windows", "kinorium_login_webview.py")
        self.assertTrue(os.path.isfile(win_webview))
        py_compile.compile(win_webview, doraise=True)

        # Verify pure-stdlib CDP WebSocket client, cookie formatting, and win32 embedded Python support
        from windows.kinorium_login_webview import CdpWebSocketClient, _format_cdp_cookies

        formatted_ck = _format_cdp_cookies(
            [
                {"domain": ".kinorium.com", "name": "PHPSESSID", "value": "sess_abc"},
                {"domain": "ru.kinorium.com", "name": "ulogin", "value": "987654"},
                {"domain": ".example.com", "name": "other", "value": "ignored"},
            ]
        )
        self.assertEqual(formatted_ck, "PHPSESSID=sess_abc; ulogin=987654")

        # Mock RFC 6455 CDP WebSocket server to verify CdpWebSocketClient end-to-end
        srv_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv_sock.bind(("127.0.0.1", 0))
        srv_sock.listen(1)
        ws_port = srv_sock.getsockname()[1]

        def _ws_server_worker():
            conn, _ = srv_sock.accept()
            with conn:
                req = b""
                while b"\r\n\r\n" not in req:
                    req += conn.recv(4096)
                sec_key = ""
                for line in req.decode("iso-8859-1").split("\r\n"):
                    if line.lower().startswith("sec-websocket-key:"):
                        sec_key = line.split(":", 1)[1].strip()
                accept_val = base64.b64encode(
                    hashlib.sha1((sec_key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()
                ).decode("ascii")
                conn.sendall(
                    (
                        "HTTP/1.1 101 Switching Protocols\r\n"
                        "Upgrade: websocket\r\n"
                        "Connection: Upgrade\r\n"
                        f"Sec-WebSocket-Accept: {accept_val}\r\n\r\n"
                    ).encode("ascii")
                )
                hdr = conn.recv(2)
                masked = (hdr[1] & 0x80) != 0
                plen = hdr[1] & 0x7F
                if plen == 126:
                    (plen,) = struct.unpack("!H", conn.recv(2))
                mask = conn.recv(4) if masked else b"\x00\x00\x00\x00"
                enc_payload = conn.recv(plen)
                dec = bytes(b ^ mask[i & 3] for i, b in enumerate(enc_payload))
                msg = json.loads(dec.decode("utf-8"))
                # Send an unmasked async event first, then the matching response
                for reply_obj in (
                    {"method": "Network.requestWillBeSent", "params": {}},
                    {"id": msg["id"], "result": {"cookies": [{"domain": ".kinorium.com", "name": "uid", "value": "77"}]}},
                ):
                    raw_rep = json.dumps(reply_obj).encode("utf-8")
                    conn.sendall(bytes([0x81, len(raw_rep)]) + raw_rep)

        ws_thread = threading.Thread(target=_ws_server_worker, daemon=True)
        ws_thread.start()
        try:
            with CdpWebSocketClient(f"ws://127.0.0.1:{ws_port}/devtools/page/test", timeout=4.0) as cdp:
                cdp_res = cdp.call("Network.getAllCookies", {})
                self.assertEqual(cdp_res["cookies"][0]["value"], "77")
        finally:
            srv_sock.close()

        # Verify win32 standalone embedded Python resolution (pythonw.exe -> python.exe + Edge browser)
        with tempfile.TemporaryDirectory() as tmp_win:
            os.makedirs(os.path.join(tmp_win, "windows"), exist_ok=True)
            os.makedirs(os.path.join(tmp_win, "runtime"), exist_ok=True)
            fake_helper = os.path.join(tmp_win, "windows", "kinorium_login_webview.py")
            fake_pythonw = os.path.join(tmp_win, "runtime", "pythonw.exe")
            fake_python = os.path.join(tmp_win, "runtime", "python.exe")
            fake_edge = os.path.join(tmp_win, "msedge.exe")
            for fp in (fake_helper, fake_pythonw, fake_python, fake_edge):
                with open(fp, "wb") as fh:
                    fh.write(b"MZ")
            kin_tmp = KinoriumService(DoHSplitNetworkClient(), storage_dir=tmp_win)
            mgr_win = KinoriumOneClickAuthManager(base_dir=tmp_win, kinorium_service=kin_tmp)
            with patch.object(sys, "platform", "win32"), patch.object(sys, "executable", fake_pythonw), patch(
                "windows.kinorium_login_webview.find_chromium_browser", return_value=fake_edge
            ):
                self.assertTrue(mgr_win.is_supported())
                self.assertEqual(mgr_win._resolve_windows_python_executable(), fake_python)

        # Verify Windows installer staging & output binary invariants
        stage_core = os.path.join(BASE_DIR, "build", "win-stage-core")
        if os.path.isdir(stage_core):
            for rel_req in (
                os.path.join("backend", "profiles.py"),
                os.path.join("backend", "downloads.py"),
                os.path.join("backend", "tv_cast.py"),
                os.path.join("backend", "kinorium_auth.py"),
                os.path.join("public", "js", "features.js"),
                os.path.join("windows", "kinorium_login_webview.py"),
            ):
                self.assertTrue(os.path.isfile(os.path.join(stage_core, rel_req)), f"Missing staged file: {rel_req}")
            self.assertFalse(os.path.exists(os.path.join(stage_core, "data")))
        win_setup_exe = os.path.join(BASE_DIR, "dist", "CineFlow-Setup-2.7.0-x64.exe")
        if os.path.isfile(win_setup_exe):
            self.assertGreater(os.path.getsize(win_setup_exe), 20 * 1024 * 1024)

        if sys.platform == "darwin":
            helper_bin = os.path.join(BASE_DIR, "backend", "bin", "kinorium_login_helper")
            self.assertTrue(os.path.isfile(helper_bin) and os.access(helper_bin, os.X_OK))

            app_bundle = os.path.join(BASE_DIR, "dist", "CineFlow.app")
            plist_path = os.path.join(app_bundle, "Contents", "Info.plist")
            exec_path = os.path.join(app_bundle, "Contents", "MacOS", "CineFlow")
            icon_path = os.path.join(app_bundle, "Contents", "Resources", "AppIcon.icns")
            self.assertTrue(os.path.isfile(plist_path))
            self.assertTrue(os.path.isfile(exec_path) and os.access(exec_path, os.X_OK))
            self.assertTrue(os.path.isfile(icon_path))
            with open(plist_path, "rb") as pf:
                plist_data = plistlib.load(pf)
            self.assertEqual(plist_data.get("CFBundleIdentifier"), "app.cineflow.cinema")
            self.assertEqual(plist_data.get("CFBundleExecutable"), "CineFlow")

    def test_live_roadmap_http_endpoints_and_offline_range_streaming(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            temp_dm = OfflineDownloadManager(data_dir=tmpdir, remux_engine=_DummyRemuxEngine(), start_workers=False)
            did = "dl_test_offline_movie"
            item_dir = os.path.join(temp_dm.downloads_dir, did)
            os.makedirs(item_dir, exist_ok=True)
            sample_mp4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isomCINEFLOW_OFFLINE_VIDEO_PAYLOAD"
            with open(os.path.join(item_dir, "video.mp4"), "wb") as vf:
                vf.write(sample_mp4)
            with open(os.path.join(item_dir, "sub_0_ru.vtt"), "wb") as sf:
                sf.write(b"WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nOffline subtitle line\n")
            temp_dm._items[did] = {
                "download_id": did,
                "profile_id": "main",
                "item_id": "tt0816692",
                "title": "Interstellar",
                "media_type": "movie",
                "season": 1,
                "episode": 1,
                "quality": "1080p",
                "studio": "Original",
                "status": "completed",
                "progress_pct": 100.0,
                "file_size": len(sample_mp4),
                "downloaded_bytes": len(sample_mp4),
                "subtitles": [{"lang": "Русский", "file": "sub_0_ru.vtt"}],
                "created_at": 1700000000.0,
                "completed_at": 1700000010.0,
            }

            orig_dm = server.download_manager
            server.download_manager = temp_dm
            httpd = server.CinemaThreadingHTTPServer(("127.0.0.1", 0), server.CinemaRequestHandler)
            port = httpd.server_address[1]
            base_url = f"http://127.0.0.1:{port}"
            t = threading.Thread(target=httpd.serve_forever, daemon=True)
            t.start()
            try:
                for ep in ("/api/profiles", "/api/downloads", "/api/kinorium/one-click-status"):
                    with urllib.request.urlopen(f"{base_url}{ep}", timeout=8) as r:
                        self.assertEqual(r.status, 200)
                        body = json.loads(r.read())
                        self.assertIsInstance(body, dict)

                with patch.object(server.dlna_manager, "discover_devices", return_value=[]):
                    with urllib.request.urlopen(f"{base_url}/api/tv/devices?id=tt0816692", timeout=8) as r_tv:
                        self.assertEqual(r_tv.status, 200)
                        tv_data = json.loads(r_tv.read())
                        self.assertTrue(tv_data.get("ok"))

                # Partial Range request on offline MP4
                req_range = urllib.request.Request(
                    f"{base_url}/api/downloads/stream/{did}",
                    headers={"Range": "bytes=4-15"},
                )
                with urllib.request.urlopen(req_range, timeout=8) as r_vid:
                    self.assertEqual(r_vid.status, 206)
                    self.assertEqual(r_vid.headers.get("Accept-Ranges"), "bytes")
                    self.assertEqual(r_vid.read(), sample_mp4[4:16])

                # Offline WebVTT subtitle request
                with urllib.request.urlopen(f"{base_url}/api/downloads/sub/{did}/sub_0_ru.vtt", timeout=8) as r_sub:
                    self.assertEqual(r_sub.status, 200)
                    self.assertIn("text/vtt", r_sub.headers.get("Content-Type", ""))
                    self.assertIn(b"WEBVTT", r_sub.read())

                # ?download=1 Content-Disposition attachment header for saving .mp4 copy
                with urllib.request.urlopen(f"{base_url}/api/downloads/stream/{did}?download=1", timeout=8) as r_att:
                    self.assertEqual(r_att.status, 200)
                    self.assertIn("attachment;", r_att.headers.get("Content-Disposition", ""))
            finally:
                server.download_manager = orig_dm
                httpd.shutdown()
                httpd.server_close()

    def test_v24_kids_pin_downloads_filtering_backup_bundle_and_tv_deeplink(self):
        with tempfile.TemporaryDirectory() as src_dir, tempfile.TemporaryDirectory() as dst_dir:
            pm = ProfileManager(data_dir=src_dir)
            kin = KinoriumService(DoHSplitNetworkClient(), storage_dir=src_dir)
            kin.mark_watched(
                item_id="tt0816692",
                title="Интерстеллар",
                orig_title="Interstellar",
                watched=True,
                kinorium_id="716587",
            )

            # Set a 4-digit PIN on the Kids profile and verify raw PIN is never exposed to clients
            pm.save_profile(profile_id="kids", name="Детский", kids_mode=True, kids_pin="2580")
            client_payload = pm.get_profiles_payload(lang="ru", live_kinorium_service=kin)
            kids_client = next(p for p in client_payload["profiles"] if p["id"] == "kids")
            self.assertTrue(kids_client["has_kids_pin"])
            self.assertNotIn("kids_pin", kids_client)

            # Entering Kids profile needs no PIN, exiting to adult profile requires the 4-digit PIN
            pm.switch_profile("kids")
            kin.switch_state_file(pm.get_kinorium_state_path("kids"))
            kin.mark_watched(
                item_id="tt2294629",
                title="Холодное сердце",
                orig_title="Frozen",
                watched=True,
                kinorium_id="677566",
            )
            with self.assertRaises(PermissionError):
                pm.switch_profile("main", pin="")
            with self.assertRaises(PermissionError):
                pm.switch_profile("main", pin="0000")
            switched_back = pm.switch_profile("main", pin="2580")
            self.assertEqual(switched_back["id"], "main")

            # Export full multi-profile bundle and import into a clean directory
            bundle = pm.export_profiles_bundle(redact_secrets=False)
            self.assertIn("kids", bundle["secondary_kinorium_states"])
            pm_restored = ProfileManager(data_dir=dst_dir)
            imp_res = pm_restored.import_profiles_bundle(bundle, redact_secrets=False)
            self.assertGreaterEqual(imp_res["restored_profiles_count"], 3)
            kin_restored = KinoriumService(DoHSplitNetworkClient(), storage_dir=dst_dir)
            kin_restored.switch_state_file(pm_restored.get_kinorium_state_path("kids"))
            self.assertTrue(kin_restored.get_item_status("tt2294629", "Холодное сердце")["watched"])
            pm_restored.switch_profile("kids")
            with self.assertRaises(PermissionError):
                pm_restored.switch_profile("main", pin="9999")
            self.assertEqual(pm_restored.switch_profile("main", pin="2580")["id"], "main")

            # Offline downloads Kids Mode filtering
            dm = OfflineDownloadManager(data_dir=src_dir, remux_engine=_DummyRemuxEngine(), start_workers=False)
            dm._items["dl_adult"] = {
                "download_id": "dl_adult",
                "profile_id": "main",
                "title": "Пила 10",
                "orig_title": "Saw X",
                "genres": ["ужасы", "триллер"],
                "age_rating": "18+",
                "kids_safe": False,
                "media_type": "movie",
                "season": 1,
                "episode": 1,
                "quality": "1080p",
                "studio": "HDRezka",
                "status": "completed",
                "progress_pct": 100.0,
                "file_size": 1024,
                "downloaded_bytes": 1024,
                "subtitles": [],
                "created_at": 1700000100.0,
            }
            dm._items["dl_cartoon"] = {
                "download_id": "dl_cartoon",
                "profile_id": "main",
                "title": "Головоломка 2",
                "orig_title": "Inside Out 2",
                "genres": ["мультфильм", "семейный"],
                "age_rating": "6+",
                "kids_safe": True,
                "media_type": "movie",
                "season": 1,
                "episode": 1,
                "quality": "1080p",
                "studio": "Дубляж",
                "status": "completed",
                "progress_pct": 100.0,
                "file_size": 2048,
                "downloaded_bytes": 2048,
                "subtitles": [],
                "created_at": 1700000200.0,
            }
            adult_list = dm.get_downloads_payload(kids_mode=False, active_profile_id="main")
            self.assertEqual(len(adult_list["items"]), 2)
            self.assertTrue(all(it["export_url"].endswith("?download=1") for it in adult_list["items"]))

            kids_list = dm.get_downloads_payload(kids_mode=True, active_profile_id="kids")
            self.assertEqual([it["download_id"] for it in kids_list["items"]], ["dl_cartoon"])
            self.assertFalse(dm.is_download_allowed("dl_adult", kids_mode=True, active_profile_id="kids"))
            self.assertTrue(dm.is_download_allowed("dl_cartoon", kids_mode=True, active_profile_id="kids"))

            # Verify live HTTP endpoints: /api/tv/deep-link, /api/profiles/switch PIN 403, and /api/title-meta ok: True
            orig_pm = server.profile_manager
            orig_dm = server.download_manager
            pm.switch_profile("kids")
            server.profile_manager = pm
            server.download_manager = dm
            httpd = server.CinemaThreadingHTTPServer(("127.0.0.1", 0), server.CinemaRequestHandler)
            port = httpd.server_address[1]
            base_url = f"http://127.0.0.1:{port}"
            th = threading.Thread(target=httpd.serve_forever, daemon=True)
            th.start()
            try:
                # Adult download stream blocked with HTTP 403 in Kids Mode
                with self.assertRaises(urllib.error.HTTPError) as ctx_dl:
                    urllib.request.urlopen(f"{base_url}/api/downloads/stream/dl_adult", timeout=6)
                self.assertEqual(ctx_dl.exception.code, 403)

                # Switching out of PIN-locked Kids profile without PIN returns 403 pin_required: True
                req_sw = urllib.request.Request(
                    f"{base_url}/api/profiles/switch",
                    data=json.dumps({"profile_id": "main"}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with self.assertRaises(urllib.error.HTTPError) as ctx_sw:
                    urllib.request.urlopen(req_sw, timeout=6)
                self.assertEqual(ctx_sw.exception.code, 403)
                err_json = json.loads(ctx_sw.exception.read())
                self.assertTrue(err_json.get("pin_required"))

                # Unlock back to 'main' with valid PIN
                req_unlock = urllib.request.Request(
                    f"{base_url}/api/profiles/switch",
                    data=json.dumps({"profile_id": "main", "pin": "2580"}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req_unlock, timeout=6) as r_un:
                    self.assertEqual(r_un.status, 200)
                    self.assertEqual(json.loads(r_un.read())["active_profile_id"], "main")

                # Register non-home search item via /api/tv/devices and resolve via /api/tv/deep-link
                with patch.object(server.dlna_manager, "discover_devices", return_value=[]):
                    with urllib.request.urlopen(
                        f"{base_url}/api/tv/devices?id=rezka_search_777&title=Dune+Part+Two&media_type=movie&year=2024",
                        timeout=6,
                    ) as r_reg:
                        self.assertEqual(r_reg.status, 200)
                with urllib.request.urlopen(f"{base_url}/api/tv/deep-link?p=rezka_search_777", timeout=6) as r_deep:
                    deep_body = json.loads(r_deep.read())
                    self.assertTrue(deep_body.get("ok"))
                    self.assertEqual(deep_body["item"]["title"], "Dune Part Two")

                # /api/title-meta includes ok: True
                with patch.object(
                    server.rezka_client,
                    "_resolve_page_metadata",
                    return_value={"title": "Дюна 2", "description": "Описание"},
                ), patch.object(
                    server.kinorium_service,
                    "fetch_movie_page_extras",
                    return_value={"critics_pct": 92, "kinorium_id": "12345", "similar_raw": []},
                ), patch.object(
                    server.aggregator,
                    "resolve_provider_offers_for_title",
                    return_value=[],
                ), patch.object(
                    server.en_meta_resolver,
                    "resolve",
                    return_value={
                        "ok": True,
                        "title_en": "Dune: Part Two",
                        "description_en": "Paul Atreides unites with Chani.",
                        "poster_en": "https://img.example.com/dune2_en.jpg",
                    },
                ):
                    with urllib.request.urlopen(
                        f"{base_url}/api/title-meta?title=Dune&orig_title=Dune+Part+Two&lang=en",
                        timeout=6,
                    ) as r_meta:
                        meta_body = json.loads(r_meta.read())
                        self.assertTrue(meta_body.get("ok"))
                        self.assertEqual(meta_body.get("description_en"), "Paul Atreides unites with Chani.")
            finally:
                server.profile_manager = orig_pm
                server.download_manager = orig_dm
                httpd.shutdown()
                httpd.server_close()

    def test_v25_builtin_profile_i18n_kids_pin_bypass_hardening_and_hdrezka_filter(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            pm = ProfileManager(data_dir=tmpdir)
            kin = KinoriumService(DoHSplitNetworkClient(), storage_dir=tmpdir)

            # 1. Builtin profile saves color/audio/PIN without breaking RU <-> EN translation
            pm.save_profile(
                profile_id="family",
                name="Семейный",
                avatar_color="#BF5AF2",
                default_audio_pref="original",
            )
            en_payload = pm.get_profiles_payload(lang="en", live_kinorium_service=kin)
            fam_en = next(p for p in en_payload["profiles"] if p["id"] == "family")
            self.assertFalse(fam_en["custom_name"])
            self.assertEqual(fam_en["display_label"], "Family")
            ru_payload = pm.get_profiles_payload(lang="ru", live_kinorium_service=kin)
            fam_ru = next(p for p in ru_payload["profiles"] if p["id"] == "family")
            self.assertEqual(fam_ru["display_label"], "Семейный")

            # Explicit custom rename sets custom_name=True in both languages
            pm.save_profile(profile_id="family", name="Домашний зал")
            fam_custom_en = next(
                p for p in pm.get_profiles_payload(lang="en", live_kinorium_service=kin)["profiles"] if p["id"] == "family"
            )
            self.assertTrue(fam_custom_en["custom_name"])
            self.assertEqual(fam_custom_en["display_label"], "Домашний зал")

            # 2. HDRezka 'info' string fallback in is_item_kids_safe
            self.assertFalse(
                ProfileManager.is_item_kids_safe(
                    {"title": "Астрал", "genres": [], "info": "2023, США, Ужасы, Триллер"}
                )
            )
            self.assertTrue(
                ProfileManager.is_item_kids_safe(
                    {"title": "Дикий робот", "genres": [], "info": "2024, США, Мультфильмы, Семейный, 6+"}
                )
            )
            self.assertFalse(
                ProfileManager.is_item_kids_safe(
                    {"title": "Атака титанов", "genres": ["мультфильм"], "info": "2023, Япония, Аниме, Боевик, 18+"}
                )
            )

            # 3. Kids PIN bypass hardening: create PIN-less second Kids profile, then lock active 'kids' with PIN
            kids2 = pm.save_profile(profile_id="", name="Малыш", kids_mode=True)
            pm.save_profile(profile_id="kids", name="Детский", kids_mode=True, kids_pin="4321")
            pm.switch_profile("kids")
            self.assertTrue(pm.is_active_kids_pin_locked())
            self.assertTrue(pm.requires_pin_to_leave_active_kids(kids2["id"]))
            with self.assertRaises(PermissionError):
                pm.switch_profile(kids2["id"], pin="")

            # 4. Prepare offline downloads (1 adult with subtitle, 1 cartoon) and verify live HTTP hardening
            dm = OfflineDownloadManager(data_dir=tmpdir, remux_engine=_DummyRemuxEngine(), start_workers=False)
            for did, is_safe, title in (("dl_adult_v25", False, "Пила 10"), ("dl_kids_v25", True, "Моана 2")):
                ddir = os.path.join(dm.downloads_dir, did)
                os.makedirs(ddir, exist_ok=True)
                with open(os.path.join(ddir, "video.mp4"), "wb") as vf:
                    vf.write(b"\x00\x00\x00\x18ftypmp42CINEFLOW")
                with open(os.path.join(ddir, "sub_0_ru.vtt"), "wb") as sf:
                    sf.write(b"WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nSub\n")
                dm._items[did] = {
                    "download_id": did,
                    "profile_id": "main",
                    "title": title,
                    "genres": ["мультфильм"] if is_safe else ["ужасы"],
                    "kids_safe": is_safe,
                    "media_type": "movie",
                    "season": 1,
                    "episode": 1,
                    "quality": "1080p",
                    "studio": "Дубляж",
                    "status": "completed",
                    "progress_pct": 100.0,
                    "file_size": 24,
                    "downloaded_bytes": 24,
                    "subtitles": [{"lang": "Русский", "file": "sub_0_ru.vtt"}],
                    "created_at": 1700000500.0,
                }

            orig_pm = server.profile_manager
            orig_dm = server.download_manager
            server.profile_manager = pm
            server.download_manager = dm
            httpd = server.CinemaThreadingHTTPServer(("127.0.0.1", 0), server.CinemaRequestHandler)
            port = httpd.server_address[1]
            base_url = f"http://127.0.0.1:{port}"
            th = threading.Thread(target=httpd.serve_forever, daemon=True)
            th.start()
            try:
                def _post_json(ep: str, obj: dict):
                    req = urllib.request.Request(
                        f"{base_url}{ep}",
                        data=json.dumps(obj).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    return urllib.request.urlopen(req, timeout=6)

                # Switching from PIN-locked 'kids' to PIN-less 'kids2' without PIN -> 403
                with self.assertRaises(urllib.error.HTTPError) as e_sw2:
                    _post_json("/api/profiles/switch", {"profile_id": kids2["id"]})
                self.assertEqual(e_sw2.exception.code, 403)

                # Saving/editing profiles, deleting profiles, or importing backup while PIN-locked without PIN -> 403
                for ep_name, body_obj in (
                    ("/api/profiles/save", {"id": "kids", "name": "Детский", "kids_mode": True, "kids_pin": "__clear__"}),
                    ("/api/profiles/delete", {"profile_id": kids2["id"]}),
                    ("/api/backup/import", {"backup": {"version": 2}}),
                ):
                    with self.assertRaises(urllib.error.HTTPError) as e_pin:
                        _post_json(ep_name, body_obj)
                    self.assertEqual(e_pin.exception.code, 403)
                    self.assertTrue(json.loads(e_pin.exception.read()).get("pin_required"))

                # HEAD /api/downloads/stream/*, GET /api/downloads/sub/*, POST /api/downloads/delete blocked on adult item
                req_head_adult = urllib.request.Request(f"{base_url}/api/downloads/stream/dl_adult_v25", method="HEAD")
                with self.assertRaises(urllib.error.HTTPError) as e_ha:
                    urllib.request.urlopen(req_head_adult, timeout=6)
                self.assertEqual(e_ha.exception.code, 403)

                req_head_kids = urllib.request.Request(f"{base_url}/api/downloads/stream/dl_kids_v25", method="HEAD")
                with urllib.request.urlopen(req_head_kids, timeout=6) as r_hk:
                    self.assertEqual(r_hk.status, 200)

                with self.assertRaises(urllib.error.HTTPError) as e_sub:
                    urllib.request.urlopen(f"{base_url}/api/downloads/sub/dl_adult_v25/sub_0_ru.vtt", timeout=6)
                self.assertEqual(e_sub.exception.code, 403)

                with self.assertRaises(urllib.error.HTTPError) as e_del:
                    _post_json("/api/downloads/delete", {"download_id": "dl_adult_v25"})
                self.assertEqual(e_del.exception.code, 403)

                # GET /api/person filters adult items in Kids Mode
                mock_person = {
                    "ok": True,
                    "name": "Тестовый Актер",
                    "all_items": [
                        {"id": "k1", "title": "Головоломка", "genres": ["мультфильм", "семейный"]},
                        {"id": "a1", "title": "Пила", "genres": ["ужасы", "триллер"]},
                    ],
                    "sections": [
                        {
                            "role": "Актер",
                            "count": 2,
                            "items": [
                                {"id": "k1", "title": "Головоломка", "genres": ["мультфильм", "семейный"]},
                                {"id": "a1", "title": "Пила", "genres": ["ужасы", "триллер"]},
                            ],
                        }
                    ],
                    "stats": {"total_count": 2, "watched_count": 0, "watched_pct": 0},
                }
                with patch.object(server.aggregator, "get_person_profile", return_value=mock_person):
                    with urllib.request.urlopen(f"{base_url}/api/person?name=Test", timeout=6) as r_pers:
                        pers_json = json.loads(r_pers.read())
                        self.assertEqual([it["id"] for it in pers_json["all_items"]], ["k1"])
                        self.assertEqual(pers_json["stats"]["total_count"], 1)

                # GET /api/title-meta filters similar_items in Kids Mode
                with patch.object(
                    server.rezka_client, "_resolve_page_metadata", return_value={"title": "Головоломка", "genres": ["мультфильм"]}
                ), patch.object(
                    server.kinorium_service, "fetch_movie_page_extras", return_value={"critics_pct": 95, "similar_raw": []}
                ), patch.object(
                    server.aggregator, "resolve_provider_offers_for_title", return_value=[]
                ), patch.object(
                    server.en_meta_resolver, "resolve", return_value={"ok": False}
                ), patch.object(
                    server.aggregator,
                    "resolve_similar_for_title",
                    return_value={
                        "source": "kinorium",
                        "items": [
                            {"id": "sim_kids", "title": "Тайна Коко", "genres": ["мультфильм", "семейный"]},
                            {"id": "sim_adult", "title": "Крик", "genres": ["ужасы", "триллер"]},
                        ],
                    },
                ):
                    with urllib.request.urlopen(f"{base_url}/api/title-meta?title=Inside+Out", timeout=6) as r_tm:
                        tm_json = json.loads(r_tm.read())
                        self.assertEqual([it["id"] for it in tm_json["similar_items"]], ["sim_kids"])

                # GET /api/tv/devices reports is_local_client and lan_enabled
                with patch.object(server.dlna_manager, "discover_devices", return_value=[]):
                    with urllib.request.urlopen(f"{base_url}/api/tv/devices", timeout=6) as r_tv:
                        tv_json = json.loads(r_tv.read())
                        self.assertTrue(tv_json.get("is_local_client"))
                        self.assertIn("lan_enabled", tv_json)
            finally:
                server.profile_manager = orig_pm
                server.download_manager = orig_dm
                httpd.shutdown()
                httpd.server_close()

    def test_v26_kids_pin_admin_gates_dl_eta_lang_and_tv_deeplink_filter(self):
        import time
        from http.server import ThreadingHTTPServer

        with tempfile.TemporaryDirectory() as td:
            pm = ProfileManager(data_dir=td)
            pm.save_profile(
                profile_id="kids",
                name="Детский",
                avatar_color="#30D158",
                kids_mode=True,
                default_audio_pref="dub",
                kids_pin="2468",
            )
            pm.switch_profile("kids")

            dm = OfflineDownloadManager(
                data_dir=td,
                remux_engine=_DummyRemuxEngine(),
                start_workers=False,
                local_port_getter=lambda: 8765,
            )
            # 1. FFmpeg command puts -user_agent BEFORE -reconnect
            cmd = dm.build_ffmpeg_download_command(
                source_url="https://cdn.example.com/movie.mp4",
                output_path="/tmp/out.mp4",
                is_remux_source=False,
            )
            self.assertLess(cmd.index("-user_agent"), cmd.index("-reconnect"))

            now_ts = time.time()
            with dm._lock:
                dm._items["dl_v26"] = {
                    "download_id": "dl_v26",
                    "profile_id": "kids",
                    "item_id": "id_v26",
                    "title": "Inside Out 2",
                    "orig_title": "Inside Out 2",
                    "media_type": "movie",
                    "year": 2024,
                    "genres": ["мультфильм", "семейный"],
                    "kids_safe": True,
                    "status": "downloading",
                    "progress_pct": 50.0,
                    "downloaded_bytes": 52428800,
                    "speed_label": "5.0 МБ/с",
                    "error": "Не удалось сохранить видеопоток",
                    "eta_sec": 10,
                    "duration_sec": 5400.0,
                    "created_at": now_ts - 120.0,
                    "started_at": now_ts - 10.0,
                    "local_subtitles": [{"file": "sub_0_ru.vtt", "lang": "Русский", "srclang": "ru"}],
                }
            en_list = dm.get_downloads_payload(kids_mode=True, active_profile_id="kids", lang="en")["items"]
            self.assertEqual(len(en_list), 1)
            self.assertEqual(en_list[0]["speed_label"], "5.0 MB/s")
            self.assertEqual(en_list[0]["error"], "Failed to save video stream")
            self.assertEqual(en_list[0]["subtitles"][0]["lang"], "Russian")

            ru_list = dm.get_downloads_payload(kids_mode=True, active_profile_id="kids", lang="ru")["items"]
            self.assertEqual(ru_list[0]["speed_label"], "5.0 МБ/с")
            self.assertEqual(ru_list[0]["subtitles"][0]["lang"], "Русский")

            orig_pm = server.profile_manager
            orig_dm = server.download_manager
            httpd = server.CinemaThreadingHTTPServer(("127.0.0.1", 0), server.CinemaRequestHandler)
            port = httpd.server_address[1]
            t_srv = threading.Thread(target=httpd.serve_forever, daemon=True)
            t_srv.start()
            base_url = f"http://127.0.0.1:{port}"

            def post_json(path, body):
                req = urllib.request.Request(
                    f"{base_url}{path}",
                    data=json.dumps(body).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                try:
                    with urllib.request.urlopen(req, timeout=6) as r:
                        return r.status, json.loads(r.read())
                except urllib.error.HTTPError as e:
                    return e.code, json.loads(e.read())

            try:
                server.profile_manager = pm
                server.download_manager = dm

                # Admin endpoints reject unauthenticated mutations while locked Kids Mode is active
                try:
                    urllib.request.urlopen(f"{base_url}/api/backup/export", timeout=6)
                    self.fail("Expected 403 on /api/backup/export without PIN")
                except urllib.error.HTTPError as e_exp:
                    self.assertEqual(e_exp.code, 403)
                    self.assertTrue(json.loads(e_exp.read()).get("pin_required"))

                with urllib.request.urlopen(f"{base_url}/api/backup/export?pin=2468", timeout=6) as r_exp_ok:
                    self.assertEqual(r_exp_ok.status, 200)

                c_int, j_int = post_json("/api/integrations", {"service_id": "netflix", "enabled": True})
                self.assertEqual(c_int, 403)
                self.assertTrue(j_int.get("pin_required"))

                c_str, _ = post_json("/api/stremio/addons", {"action": "toggle", "id": "cinemeta", "enabled": False})
                self.assertEqual(c_str, 403)

                c_lan, _ = post_json("/api/system/lan", {"enabled": True})
                self.assertEqual(c_lan, 403)

                c_set_block, _ = post_json("/api/settings", {"user_country": "DE"})
                self.assertEqual(c_set_block, 403)

                # Pure UI language switch remains allowed in Kids Mode without PIN
                c_lang_ok, _ = post_json("/api/settings", {"app_lang": server.APP_PREFS.get("app_lang", "ru")})
                self.assertEqual(c_lang_ok, 200)

                # Creating a brand-new adult profile from locked Kids Mode requires PIN
                c_new_prof, j_new_prof = post_json("/api/profiles/save", {"name": "Escape Adult", "kids_mode": False})
                self.assertEqual(c_new_prof, 403)
                self.assertTrue(j_new_prof.get("pin_required"))

                c_new_prof_ok, _ = post_json(
                    "/api/profiles/save",
                    {"name": "Approved Profile", "kids_mode": False, "current_pin": "2468"},
                )
                self.assertEqual(c_new_prof_ok, 200)

                # English localized PIN error on /api/profiles/verify-pin
                c_vpin, j_vpin = post_json("/api/profiles/verify-pin", {"pin": "0000", "lang": "en"})
                self.assertEqual(c_vpin, 403)
                self.assertIn("PIN", j_vpin.get("error", ""))

                # /api/tv/deep-link filters out adult items in Kids Mode
                server.dlna_manager.register_deep_link_item(
                    "adult_dl_1",
                    {
                        "id": "adult_dl_1",
                        "title": "Saw X",
                        "media_type": "movie",
                        "year": 2023,
                        "genres": ["ужасы", "триллер"],
                        "age_rating": "18+",
                    },
                )
                with urllib.request.urlopen(f"{base_url}/api/tv/deep-link?p=adult_dl_1", timeout=6) as r_dl_adult:
                    dl_adult_json = json.loads(r_dl_adult.read())
                    self.assertFalse(dl_adult_json.get("ok"))
                    self.assertIsNone(dl_adult_json.get("item"))

                server.dlna_manager.register_deep_link_item(
                    "kids_dl_1",
                    {
                        "id": "kids_dl_1",
                        "title": "Paddington",
                        "media_type": "movie",
                        "year": 2014,
                        "genres": ["семейный", "приключения"],
                        "age_rating": "6+",
                    },
                )
                with urllib.request.urlopen(f"{base_url}/api/tv/deep-link?p=kids_dl_1", timeout=6) as r_dl_kids:
                    dl_kids_json = json.loads(r_dl_kids.read())
                    self.assertTrue(dl_kids_json.get("ok"))
                    self.assertEqual((dl_kids_json.get("item") or {}).get("id"), "kids_dl_1")
            finally:
                server.profile_manager = orig_pm
                server.download_manager = orig_dm
                httpd.shutdown()
                httpd.server_close()

    def test_any_user_kinorium_sync_discovers_friends_and_comments(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            kin = KinoriumService(DoHSplitNetworkClient(), storage_dir=tmpdir)

            user_movie_html = """
            <div class="item user-status-list status_done" data-movieId="2023303" data-movieName="Невероятные приключения ДжоДжо">
              <span class="title">Невероятные приключения ДжоДжо</span>
              <small>JoJo's Bizarre Adventure, 2012, 5 сезонов</small>
              <div class="statusWidgetData statusWidget_is-my-profile" data-id="2023303">
                <span class="status status_done"></span>
                <span class="valueBg number-9">9</span>
              </div>
              <ul class="ratingsBlock">
                <li title="10 - Анна Смирнова&#10;8 - Борис Волков">
                  <div class="rating__name">Друзья</div>
                </li>
              </ul>
            </div>
            """
            friend_anna_html = (
                '<div class="item user-status-list status_done" data-movieId="2023303" data-movieName="Невероятные приключения ДжоДжо">'
                '<span class="title">Невероятные приключения ДжоДжо</span>'
                "<small>JoJo's Bizarre Adventure, 2012, 5 сезонов</small>"
                '<div class="statusWidgetData statusWidget_is-alian-profile" data-id="2023303">'
                '<span class="status status_done"></span>'
                '<div class="statusText">' + ("Очень стильное аниме! " * 140) + "</div>"
                '<span class="valueBg number-10">10</span>'
                "</div></div>"
            )

            def fake_fetch_html(url: str, extra_headers=None):
                if "/user/777888/following/" in url:
                    # Simulate /following/ blocked by captcha so friend discovery relies on tooltips + AJAX search
                    return '<div class="g-recaptcha"></div>'
                if "/user/777888/" in url:
                    return "<title>Новый Пользователь - Кинориум</title><script>USER_ID = 777888;</script>"
                if "/handlers/Search/" in url and "only_user" in url:
                    if "%D0%90%D0%BD%D0%BD%D0%B0" in url or "%D0%A1%D0%BC%D0%B8%D1%80%D0%BD%D0%BE%D0%B2%D0%B0" in url:
                        return json.dumps(
                            {
                                "user": {
                                    "search": [
                                        {
                                            "user_id": "333111",
                                            "name": "Анна",
                                            "surname": "Смирнова",
                                            "screenName": "Анна Смирнова",
                                            "is_followed_by_me": True,
                                        }
                                    ]
                                }
                            }
                        )
                    return json.dumps({"user": {"search": []}})
                if "/handlers/getStatusList/" in url:
                    if "user_id=777888" in url and "status%5D%5B%5D=done" in url and "page=1" in url:
                        return json.dumps({"result": {"html": user_movie_html}})
                    if "user_id=333111" in url and "status%5D%5B%5D=done" in url and "page=1" in url:
                        return json.dumps({"result": {"html": friend_anna_html}})
                    return json.dumps({"result": {"html": ""}})
                return ""

            with patch.object(kin, "fetch_kinorium_html", side_effect=fake_fetch_html), patch.object(
                kin, "_verify_recent_watchlist_online_availability", return_value=None
            ):
                sync_res = kin.sync_user_profile("777888", session_cookie="ulogin=777888; PHPSESSID=xyz")

            self.assertTrue(sync_res["synced"])
            self.assertEqual(sync_res["user_id"], "777888")
            self.assertEqual(sync_res["display_name"], "Новый Пользователь")

            friends = sync_res["friends"]
            friend_names = {f["name"]: f for f in friends}
            self.assertIn("Анна Смирнова", friend_names)
            self.assertEqual(friend_names["Анна Смирнова"]["id"], "333111")
            self.assertIn("Борис Волков", friend_names)

            st = kin.get_item_status("kin_2023303", title="Невероятные приключения ДжоДжо")
            fr_by_name = {f["name"]: f for f in st.get("friends_ratings") or []}
            self.assertIn("Анна Смирнова", fr_by_name)
            self.assertEqual(fr_by_name["Анна Смирнова"]["score"], 10)
            self.assertEqual(fr_by_name["Анна Смирнова"]["user_id"], "333111")
            self.assertIn("Очень стильное аниме!", fr_by_name["Анна Смирнова"].get("comment", ""))
            self.assertIn("Борис Волков", fr_by_name)
            self.assertEqual(fr_by_name["Борис Волков"]["score"], 8)

    def test_master_flagship_features_dom_and_player_invariants(self):
        index_path = os.path.join(BASE_DIR, "public", "index.html")
        with open(index_path, "r", encoding="utf-8") as f:
            html = f.read()

        # Check DOM elements
        self.assertIn('id="btn-open-roulette-modal"', html)
        self.assertIn('id="movie-roulette-modal"', html)
        self.assertIn('id="video-dropzone"', html)
        self.assertIn('id="xray-pause-shelf"', html)
        self.assertIn('id="vc-bookmarks"', html)
        self.assertIn('id="vc-btn-bookmark"', html)
        self.assertIn('data-speed="1.75"', html)

        # Check CSS rules
        vc_css_path = os.path.join(BASE_DIR, "public", "css", "video-controls-and-person.css")
        with open(vc_css_path, "r", encoding="utf-8") as f:
            vc_css = f.read()
        self.assertIn(".atv-video-dropzone", vc_css)
        self.assertIn(".atv-xray-pause-shelf", vc_css)
        self.assertIn(".atv-vc-bookmarks", vc_css)
        self.assertIn(".atv-vc-bookmark-pin", vc_css)

        modals_css_path = os.path.join(BASE_DIR, "public", "css", "modals-and-search.css")
        with open(modals_css_path, "r", encoding="utf-8") as f:
            modals_css = f.read()
        self.assertIn(".atv-roulette-dialog", modals_css)
        self.assertIn(".atv-roulette-pill", modals_css)

        # Check JS functions
        audio_dsp_path = os.path.join(BASE_DIR, "public", "js", "audio-dsp.js")
        with open(audio_dsp_path, "r", encoding="utf-8") as f:
            audio_dsp = f.read()
        self.assertIn("ensurePreservesPitch", audio_dsp)

        catalog_js_path = os.path.join(BASE_DIR, "public", "js", "catalog.js")
        with open(catalog_js_path, "r", encoding="utf-8") as f:
            catalog_js = f.read()
        self.assertIn("openMovieRouletteModal", catalog_js)
        self.assertIn("closeMovieRouletteModal", catalog_js)
        self.assertIn("spinMovieRoulette", catalog_js)

        player_js_path = os.path.join(BASE_DIR, "public", "js", "player.js")
        with open(player_js_path, "r", encoding="utf-8") as f:
            player_js = f.read()
        self.assertIn("toggleBookmarkCurrentMoment", player_js)
        self.assertIn("renderTimelineBookmarks", player_js)
        self.assertIn("showXRayPauseShelf", player_js)
        self.assertIn("hideXRayPauseShelf", player_js)

    def test_apple_tv_flagship_ux_ui_invariants(self):
        index_path = os.path.join(BASE_DIR, "public", "index.html")
        with open(index_path, "r", encoding="utf-8") as f:
            html = f.read()

        # Command Palette
        self.assertIn('id="command-palette-modal"', html)
        self.assertIn('id="command-palette-input"', html)
        self.assertIn('id="command-palette-results"', html)

        # Floating Next Episode Toast
        self.assertIn('id="player-next-ep-toast"', html)
        self.assertIn('id="next-ep-thumb"', html)
        self.assertIn('id="next-ep-ring-fill"', html)
        self.assertIn('id="btn-next-ep-now"', html)
        self.assertIn('id="btn-next-ep-cancel"', html)

        # Check CSS
        modals_css_path = os.path.join(BASE_DIR, "public", "css", "modals-and-search.css")
        with open(modals_css_path, "r", encoding="utf-8") as f:
            modals_css = f.read()
        self.assertIn(".atv-palette-sheet", modals_css)
        self.assertIn(".atv-palette-input", modals_css)
        self.assertIn(".atv-poster-preview-video", modals_css)

        vc_css_path = os.path.join(BASE_DIR, "public", "css", "video-controls-and-person.css")
        with open(vc_css_path, "r", encoding="utf-8") as f:
            vc_css = f.read()
        self.assertIn(".atv-next-ep-toast", vc_css)
        self.assertIn(".atv-next-ep-ring", vc_css)

        # Check JS
        catalog_js_path = os.path.join(BASE_DIR, "public", "js", "catalog.js")
        with open(catalog_js_path, "r", encoding="utf-8") as f:
            catalog_js = f.read()
        catalog_cards_path = os.path.join(BASE_DIR, "public", "js", "catalog-cards.js")
        with open(catalog_cards_path, "r", encoding="utf-8") as f:
            catalog_cards_js = f.read()
        catalog_discovery_path = os.path.join(BASE_DIR, "public", "js", "catalog-discovery.js")
        with open(catalog_discovery_path, "r", encoding="utf-8") as f:
            catalog_discovery_js = f.read()
        catalog_combined = catalog_js + catalog_cards_js + catalog_discovery_js
        self.assertIn("openCommandPalette", catalog_combined)
        self.assertIn("closeCommandPalette", catalog_combined)
        self.assertIn("initCommandPalette", catalog_combined)
        self.assertIn("hoverPreviewTimer", catalog_combined)

        player_js_path = os.path.join(BASE_DIR, "public", "js", "player.js")
        with open(player_js_path, "r", encoding="utf-8") as f:
            player_js = f.read()
        self.assertIn("getSnappingRatio", player_js)
        self.assertIn("showPlayerNextEpisodeToast", player_js)
        self.assertIn("dismissPlayerNextEpisodeToast", player_js)

    def test_windows_desktop_performance_optimizations(self):
        import server

        self.assertGreaterEqual(server.CinemaThreadingHTTPServer.request_queue_size, 128)
        self.assertIsNotNone(server._SHARED_VERIFIED_SSL_CTX)
        self.assertIsNotNone(server._DEFAULT_SAFE_PUBLIC_OPENER)
        self.assertEqual(
            server.CinemaRequestHandler._own_mdns_hostname(),
            server._CACHED_OWN_MDNS_HOSTNAME,
        )

        # Ensure _is_torrserver_alive_cached exists and returns bool without blocking
        self.assertIsInstance(server.backup_stream_engine._is_torrserver_alive_cached(), bool)

        for rel_path in (
            ("windows", "launcher", "cineflow_launcher.c"),
            ("windows", "desktop_webview2.py"),
            ("windows", "Start-Cinema-Windows.bat"),
        ):
            fp = os.path.join(BASE_DIR, *rel_path)
            with open(fp, "r", encoding="utf-8") as fh:
                content = fh.read()
            self.assertIn("D3D11VideoDecoder,DirectComposition", content)
            self.assertNotIn("VaapiVideoDecoder", content)

    def test_wave2_flagship_ux_ui_and_subtitle_translation(self):
        import server

        # 1. Verify SubtitleSearchService.translate_subtitle_word offline & cache behavior
        sub_svc = server.subtitle_service
        res_en = sub_svc.translate_subtitle_word(
            word="truth",
            context="Tell me the truth right now.",
            target_lang="ru",
        )
        self.assertTrue(res_en.get("ok"))
        self.assertEqual(res_en.get("word"), "truth")
        self.assertIn("правда", res_en.get("translation", "").lower())
        self.assertIsInstance(res_en.get("alternatives"), list)

        res_ru = sub_svc.translate_subtitle_word(
            word="правда",
            context="Это правда.",
            target_lang="en",
        )
        self.assertTrue(res_ru.get("ok"))
        self.assertEqual(res_ru.get("translation", "").lower(), "truth")

        # 2. Verify DOM hooks in public/index.html
        index_path = os.path.join(BASE_DIR, "public", "index.html")
        with open(index_path, "r", encoding="utf-8") as fh:
            html = fh.read()
        self.assertIn('id="btn-toggle-curated-shelves"', html)
        self.assertIn('id="curated-shelves-section"', html)
        self.assertIn('id="curated-shelves-stack"', html)
        self.assertIn('id="atv-sub-dict-popover"', html)
        self.assertIn('id="vc-episodes-wrap"', html)
        self.assertIn('id="vc-btn-episodes"', html)
        self.assertIn('id="vc-episodes-popover"', html)

        # 3. Verify JS modules for all 5 Wave-2 Flagship blocks
        sub_js_path = os.path.join(BASE_DIR, "public", "js", "subtitles.js")
        with open(sub_js_path, "r", encoding="utf-8") as fh:
            sub_js = fh.read()
        self.assertIn("renderInteractiveSubtitleLineHtml", sub_js)
        self.assertIn("openSubtitleDictPopover", sub_js)
        self.assertIn("closeSubtitleDictPopover", sub_js)
        self.assertIn("/api/subtitles/translate", sub_js)

        player_js_path = os.path.join(BASE_DIR, "public", "js", "player.js")
        player_ui_path = os.path.join(BASE_DIR, "public", "js", "player-ui-controls.js")
        with open(player_js_path, "r", encoding="utf-8") as fh:
            player_js = fh.read()
        with open(player_ui_path, "r", encoding="utf-8") as fh:
            player_ui = fh.read()
        player_combined = player_js + player_ui
        self.assertIn("switchToSeriesSeasonEpisode", player_combined)
        self.assertIn("vc-episodes-popover", player_combined)
        self.assertIn("atv-vc-hover-delta", player_combined)
        self.assertIn("atv-vc-hover-chapter", player_combined)

        catalog_js_path = os.path.join(BASE_DIR, "public", "js", "catalog.js")
        with open(catalog_js_path, "r", encoding="utf-8") as fh:
            catalog_js = fh.read()
        catalog_discovery_path = os.path.join(BASE_DIR, "public", "js", "catalog-discovery.js")
        with open(catalog_discovery_path, "r", encoding="utf-8") as fh:
            catalog_discovery_js = fh.read()
        catalog_combined = catalog_js + catalog_discovery_js
        self.assertIn("renderCuratedShelves", catalog_combined)
        self.assertIn("is-instant-open", catalog_combined)

        utils_js_path = os.path.join(BASE_DIR, "public", "js", "utils.js")
        with open(utils_js_path, "r", encoding="utf-8") as fh:
            utils_js = fh.read()
        self.assertIn("atv-toast-undo-btn", utils_js)
        self.assertIn("undoText", utils_js)

        # 4. Verify server route registration for /api/subtitles/translate
        server_py_path = os.path.join(BASE_DIR, "server.py")
        with open(server_py_path, "r", encoding="utf-8") as fh:
            server_py = fh.read()
        self.assertIn('"/api/subtitles/translate"', server_py)

    def test_windows_and_cross_platform_performance_optimizations(self):
        """Verifies Windows DNS/DoH media proxy fast-path, cscript/Edge JS solver, WPAD bypass flags, and warm catalog cache."""
        import time

        # 1. HLS manifest rewrite caches origin validation instead of resolving DNS per segment line
        m3u8_sample = "#EXTM3U\n" + "\n".join(
            f"#EXTINF:4.0,\nhttps://93.184.216.34/hls/seg_{i:04d}.ts" for i in range(120)
        )
        t0 = time.time()
        rewritten = server._rewrite_hls_manifest_for_proxy(m3u8_sample, "https://93.184.216.34/hls/index.m3u8")
        elapsed = time.time() - t0
        self.assertLess(elapsed, 0.25)
        self.assertIn("/api/proxy-stream?url=https%3A%2F%2F93.184.216.34%2Fhls%2Fseg_0119.ts", rewritten)

        # 2. Windows Chromium/Edge launcher flags include loopback WPAD bypass & extension disable
        for rel_file in (
            os.path.join("windows", "launcher", "cineflow_launcher.c"),
            os.path.join("windows", "desktop_webview2.py"),
            os.path.join("windows", "Start-Cinema-Windows.bat"),
        ):
            with open(os.path.join(BASE_DIR, rel_file), "r", encoding="utf-8") as fh:
                content = fh.read()
            self.assertIn("--proxy-bypass-list=<-loopback>", content)
            self.assertIn("--disable-extensions", content)

        # 3. Kinorium JS challenge solver includes Windows cscript Chakra runner + persistent profile dir
        with open(os.path.join(BASE_DIR, "backend", "kinorium.py"), "r", encoding="utf-8") as fh:
            kin_py = fh.read()
        self.assertIn("16d51579-a30b-4c8b-a276-0ff4dc41e755", kin_py)
        self.assertIn(".headless_js_profile", kin_py)

        # 4. SQLite WAL includes mmap_size and cache_size pragmas
        with open(os.path.join(BASE_DIR, "backend", "storage_db.py"), "r", encoding="utf-8") as fh:
            db_py = fh.read()
        self.assertIn("PRAGMA cache_size=-16000;", db_py)
        self.assertIn("PRAGMA mmap_size=67108864;", db_py)

        # 5. Frontend catalog warm cache
        with open(os.path.join(BASE_DIR, "public", "js", "catalog.js"), "r", encoding="utf-8") as fh:
            cat_js = fh.read()
        self.assertIn("WARM_CATALOG_STORAGE_KEY", cat_js)
        self.assertIn("_catalogEndpointCache", cat_js)

        # 6. Streaming socket timeout disabled for client streams + premature 4K/Stremio EOF guard + name-only X-Ray shelf
        class _DummyStreamSocket:
            def __init__(self):
                self.timeout = 4.0

            def settimeout(self, val):
                self.timeout = val

            def setsockopt(self, *args):
                pass

            def getsockopt(self, *args):
                return 65536

        dummy_sock = _DummyStreamSocket()
        server._configure_low_latency_socket(dummy_sock, is_client_stream=True)
        self.assertIsNone(dummy_sock.timeout)

        with open(os.path.join(BASE_DIR, "public", "js", "player.js"), "r", encoding="utf-8") as fh:
            player_js_code = fh.read()
        with open(os.path.join(BASE_DIR, "public", "js", "player-streams.js"), "r", encoding="utf-8") as fh:
            player_streams_code = fh.read()
        player_combined_code = player_js_code + player_streams_code
        self.assertIn("isGenuineEnd", player_combined_code)
        self.assertIn("_lastPrematureEndReconnectTs", player_combined_code)
        self.assertIn("remuxTransientRetried", player_combined_code)
        self.assertNotIn("/icons/avatar-placeholder.png", player_combined_code)

    def test_zero_wait_binge_watching_preload_for_4k_and_stremio(self):
        # 1. State preservation of active 4K release
        with open(os.path.join(BASE_DIR, "public", "js", "state.js"), "r", encoding="utf-8") as fh:
            state_js = fh.read()
        self.assertIn("active4kRelease: null,", state_js)

        # 2. Player streams preload integration for backup4k and stremio
        with open(os.path.join(BASE_DIR, "public", "js", "player-streams.js"), "r", encoding="utf-8") as fh:
            ps_code = fh.read()
        self.assertIn('["hdrezka", "backup4k", "stremio"].includes(state.activeSourceTab)', ps_code)
        self.assertIn('tab: "backup4k"', ps_code)
        self.assertIn('tab: "stremio"', ps_code)
        self.assertIn('&preload', ps_code)
        self.assertIn("warmDirectPlayed = true", ps_code)
        self.assertIn("hasWarmPreload", ps_code)

        # 3. Backend TorrServer stream resolution supports series episode file matching
        from backend.backup_stream import BackupStreamingEngine
        engine = BackupStreamingEngine(DoHSplitNetworkClient(), None, base_dir=BASE_DIR)
        with patch.object(engine, "ensure_local_torrserver", return_value=True), \
             patch.object(engine, "_is_torrserver_alive", return_value=True), \
             patch.object(engine, "_fetch_torrserver_file_stats", return_value=[
                 {"id": 1, "path": "Severance.S01E01.mkv", "length": 2500000000},
                 {"id": 2, "path": "Severance.S01E02.mkv", "length": 2600000000},
                 {"id": 3, "path": "Severance.S01E03.mkv", "length": 2400000000},
             ]):
            res = engine.resolve_torrserver_stream(
                magnet="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Severance.S01.4K",
                media_type="series",
                season=1,
                episode=2,
            )
            self.assertTrue(res.get("ok"))
            self.assertEqual(res.get("file_index"), 2)
            self.assertIn("index=2", res.get("stream_url", ""))
            self.assertEqual(len(res.get("video_files", [])), 3)

    def test_dlna_cast_stream_with_burned_in_subtitles(self):
        # 1. WebVTT to SRT conversion for FFmpeg subtitle filter
        from backend.subtitles import convert_vtt_to_srt
        vtt_sample = "WEBVTT\n\n00:01:23.456 --> 00:01:25.789\nHello Smart TV\n\n00:01:26.100 --> 00:01:28.200\nSubtitles burned in"
        srt_res = convert_vtt_to_srt(vtt_sample)
        self.assertIn("1\n00:01:23,456 --> 00:01:25,789\nHello Smart TV", srt_res)
        self.assertIn("2\n00:01:26,100 --> 00:01:28,200\nSubtitles burned in", srt_res)

        # 2. FFmpeg remux command generation includes subtitle filter
        from backend.remuxer import RemuxStreamEngine
        remux = RemuxStreamEngine(base_dir=BASE_DIR)
        cmd = remux.build_remux_command(
            source_url="http://127.0.0.1:8090/stream/video.mkv",
            subtitles_file="/tmp/test_sub.srt",
        )
        self.assertIn("-vf", cmd)
        vf_idx = cmd.index("-vf")
        self.assertIn("subtitles='/tmp/test_sub.srt'", cmd[vf_idx + 1])
        self.assertIn("FontSize=22", cmd[vf_idx + 1])
        self.assertNotIn("-hwaccel", cmd)

        # 3. TV cast route passes burn_subtitles and wraps into remux-stream
        from backend.routes.remote import handle_tv_cast

        class _MockCastHandler:
            def __init__(self):
                self.resp_data = None
                self.resp_status = 200

            def _require_authorized_client_if_lan(self, body, lang="ru"):
                return True

            def _is_loopback_client(self):
                return True

            def _send_json(self, data, status=200):
                self.resp_data = data
                self.resp_status = status

        class _MockDlnaManager:
            def cast_stream(self, **kwargs):
                return {"ok": True, "cast": kwargs}

            def build_lan_stream_url(self, raw, lan_ip, port, start_sec=0.0):
                return f"http://{lan_ip}:{port}{raw}"

        class _MockCastCtx:
            app_prefs = {"lan_access": True}
            server_runtime = {"port": 8765, "running": True}
            dlna_manager = _MockDlnaManager()

            @staticmethod
            def msg(ru, en):
                return ru

            @staticmethod
            def safe_float(val, default=0.0):
                try:
                    return float(val)
                except Exception:
                    return default

            @staticmethod
            def detect_lan_ipv4():
                return "192.168.1.100"

            @staticmethod
            def unwrap_local_proxy_media_url(u):
                return u

            @staticmethod
            def is_allowed_media_source_url(u, allow_torrserver_loopback=True):
                return True

            class profile_manager:
                @staticmethod
                def is_kids_mode_active():
                    return False

        h = _MockCastHandler()
        body = {
            "control_url": "http://192.168.1.50:7676/smp_4_",
            "stream_url": "http://127.0.0.1:8090/stream/movie.mkv",
            "subtitle_url": "/api/proxy-vtt?url=https%3A%2F%2Fsub.example.com%2Fsub.vtt",
            "burn_subtitles": True,
            "title": "Интерстеллар",
            "start_sec": 30.0,
        }
        ok = handle_tv_cast(h, {}, None, body, _MockCastCtx)
        self.assertTrue(ok)
        self.assertTrue(h.resp_data.get("ok"))
        cast_info = h.resp_data.get("cast", {})
        self.assertIn("/api/remux-stream", cast_info.get("stream_url", ""))
        self.assertIn("burn_sub=1", cast_info.get("stream_url", ""))
        self.assertEqual(cast_info.get("subtitle_url"), "")

    def test_smart_subtitle_vocabulary_notebook_and_anki_export(self):
        # 1. Check HTML markup for vocabulary modal and dictionary popover footer
        with open(os.path.join(BASE_DIR, "public", "index.html"), "r", encoding="utf-8") as fh:
            index_html = fh.read()
        self.assertIn('id="vocab-modal"', index_html)
        self.assertIn('id="btn-vocab-export-anki"', index_html)
        self.assertIn('id="btn-sub-dict-save"', index_html)
        self.assertIn('id="btn-sub-dict-open-vocab"', index_html)
        self.assertIn('id="vocab-items-list"', index_html)

        # 2. Check JavaScript vocabulary methods and Anki export TSV structure
        with open(os.path.join(BASE_DIR, "public", "js", "subtitles.js"), "r", encoding="utf-8") as fh:
            sub_js = fh.read()
        self.assertIn("VOCAB_STORAGE_KEY", sub_js)
        self.assertIn("cineflow_vocab_v1", sub_js)
        self.assertIn("exportVocabularyToAnkiTsv", sub_js)
        self.assertIn("#tags:CineFlow vocabulary", sub_js)
        self.assertIn("toggleWordInVocabulary", sub_js)
        self.assertIn("openVocabularyModal", sub_js)

        # 3. Check state declarations for subtitle dictionary
        with open(os.path.join(BASE_DIR, "public", "js", "state.js"), "r", encoding="utf-8") as fh:
            state_js = fh.read()
        self.assertIn("activeSubDictWord", state_js)
        self.assertIn("activeSubDictEntry", state_js)

    def test_offline_ui_mode_and_downloaded_media_resilience(self):
        # 1. HTML markup invariants for offline banner and offline filter pill
        with open(os.path.join(BASE_DIR, "public", "index.html"), "r", encoding="utf-8") as fh:
            index_html = fh.read()
        self.assertIn('id="offline-status-banner"', index_html)
        self.assertIn('id="type-pill-offline"', index_html)
        self.assertIn('data-type="offline"', index_html)
        self.assertIn('id="btn-offline-banner-view"', index_html)
        self.assertIn('id="btn-offline-banner-retry"', index_html)

        # 2. CSS invariants for offline banner
        css_combined = ""
        for css_file in sorted(glob.glob(os.path.join(BASE_DIR, "public", "css", "*.css"))):
            with open(css_file, "r", encoding="utf-8") as f:
                css_combined += "\n" + f.read()
        self.assertIn(".atv-offline-banner", css_combined)
        self.assertIn(".atv-offline-banner-icon", css_combined)
        self.assertIn(".atv-offline-banner-text", css_combined)

        # 3. JavaScript state, downloads helper and media resolver offline routing
        with open(os.path.join(BASE_DIR, "public", "js", "state.js"), "r", encoding="utf-8") as fh:
            state_src = fh.read()
        self.assertIn("isOfflineMode", state_src)

        with open(os.path.join(BASE_DIR, "public", "js", "features-downloads.js"), "r", encoding="utf-8") as fh:
            dl_src = fh.read()
        self.assertIn("export function getOfflineCatalogItems", dl_src)
        self.assertIn("export function setOfflineMode", dl_src)

        with open(os.path.join(BASE_DIR, "public", "js", "catalog-media-resolver.js"), "r", encoding="utf-8") as fh:
            res_src = fh.read()
        self.assertIn("state.isOfflineMode", res_src)
        self.assertIn("item.is_offline", res_src)

        with open(os.path.join(BASE_DIR, "public", "js", "catalog.js"), "r", encoding="utf-8") as fh:
            cat_src = fh.read()
        self.assertIn('state.mediaTypeFilter === "offline"', cat_src)
        self.assertIn("getOfflineCatalogItems", cat_src)
        self.assertIn("setOfflineMode", cat_src)

        # 4. Backend offline catalog payload generation
        from backend.routes.catalog import build_offline_catalog_payload, handle_catalog

        class FakeDownloadManager:
            def get_downloads_payload(self, profile_id="main", kids_mode=False, active_profile_id="main", lang="ru"):
                return {
                    "ok": True,
                    "items": [
                        {
                            "download_id": "dl_movie_1",
                            "status": "completed",
                            "title": "Интерстеллар",
                            "orig_title": "Interstellar",
                            "media_type": "movie",
                            "year": "2014",
                            "play_url": "/api/downloads/stream/dl_movie_1",
                        },
                        {
                            "download_id": "dl_ser_1_1",
                            "status": "completed",
                            "title": "Пингвин",
                            "orig_title": "The Penguin",
                            "media_type": "series",
                            "year": "2024",
                            "season": 1,
                            "episode": 1,
                            "kinorium_id": 999901,
                            "play_url": "/api/downloads/stream/dl_ser_1_1",
                        },
                        {
                            "download_id": "dl_ser_1_2",
                            "status": "completed",
                            "title": "Пингвин",
                            "orig_title": "The Penguin",
                            "media_type": "series",
                            "year": "2024",
                            "season": 1,
                            "episode": 2,
                            "kinorium_id": 999901,
                            "play_url": "/api/downloads/stream/dl_ser_1_2",
                        },
                        {
                            "download_id": "dl_queued_1",
                            "status": "queued",
                            "title": "Не скачан",
                            "media_type": "movie",
                        },
                    ],
                }

        class FakeProfileManager:
            def is_kids_mode_active(self):
                return False

            def get_active_profile_id(self):
                return "main"

            def get_active_profile(self, lang="ru", live_kinorium_service=None):
                return {"id": "main", "name": "Основной"}

            def filter_catalog_payload_for_kids(self, payload):
                return payload

        class FakeCtx:
            def __init__(self):
                self.download_manager = FakeDownloadManager()
                self.profile_manager = FakeProfileManager()
                self.app_prefs = {"app_lang": "ru"}
                self.kinorium_service = None

            def norm_app_lang(self, val, default="ru"):
                return val or default

        ctx = FakeCtx()
        payload = build_offline_catalog_payload(ctx)
        self.assertTrue(payload.get("ok"))
        self.assertTrue(payload.get("is_offline"))
        items = payload.get("items", [])
        self.assertEqual(len(items), 2)  # 1 movie + 1 grouped series (2 episodes grouped)

        movie = next(it for it in items if it.get("media_type") == "movie")
        self.assertEqual(movie.get("title"), "Интерстеллар")
        self.assertTrue(movie.get("is_offline"))

        series = next(it for it in items if it.get("media_type") == "series")
        self.assertEqual(series.get("title"), "Пингвин")
        self.assertTrue(series.get("is_offline"))
        self.assertEqual(series.get("seasons_map"), {"1": [1, 2]})

        # Test handle_catalog dispatching offline provider
        class FakeHandler:
            def __init__(self):
                self.resp_data = None

            def _send_json(self, data):
                self.resp_data = data

        h = FakeHandler()
        handle_catalog(h, {"provider": ["offline"]}, None, ctx)
        self.assertIsNotNone(h.resp_data)
        self.assertTrue(h.resp_data.get("is_offline"))
        self.assertEqual(len(h.resp_data.get("items", [])), 2)

    def test_release_calendar_shelf_frontend_contract(self):
        with open(os.path.join(BASE_DIR, "public", "index.html"), "r", encoding="utf-8") as fh:
            index_html = fh.read()
        self.assertIn('id="release-calendar-shelf"', index_html)
        self.assertIn('id="release-calendar-row"', index_html)
        self.assertIn('id="release-calendar-count"', index_html)
        self.assertIn('id="btn-open-release-calendar"', index_html)

        with open(os.path.join(BASE_DIR, "public", "css", "catalog-and-player-layout.css"), "r", encoding="utf-8") as fh:
            css_content = fh.read()
        self.assertIn(".atv-cal-shelf-card", css_content)
        self.assertIn(".atv-cal-poster-wrap", css_content)
        self.assertIn(".atv-cal-badge", css_content)
        self.assertIn(".atv-cal-meta", css_content)

        with open(os.path.join(BASE_DIR, "public", "js", "catalog-notifications.js"), "r", encoding="utf-8") as fh:
            notif_js = fh.read()
        self.assertIn("export async function renderReleaseCalendarShelf", notif_js)

        with open(os.path.join(BASE_DIR, "public", "js", "catalog-shelves.js"), "r", encoding="utf-8") as fh:
            shelves_js = fh.read()
        self.assertIn("renderReleaseCalendarShelf", shelves_js)

        with open(os.path.join(BASE_DIR, "public", "js", "i18n.js"), "r", encoding="utf-8") as fh:
            i18n_js = fh.read()
        self.assertIn("#btn-open-release-calendar", i18n_js)
        self.assertIn("#release-calendar-shelf-heading", i18n_js)

    def test_multi_device_handoff_backend_and_frontend(self):
        # 1. Backend API /api/handoff
        from backend.routes.remote import handle_handoff

        class _MockHandoffDlnaManager:
            def __init__(self):
                self.lan_ip = "192.168.1.120"
                self.registered_items = {}

            def register_deep_link_item(self, item_id, item_meta):
                self.registered_items[item_id] = item_meta

        class _MockHandoffCtx:
            dlna_manager = _MockHandoffDlnaManager()

            @staticmethod
            def qs_int(qs, key, default=0):
                try:
                    vals = qs.get(key, [])
                    if vals:
                        return int(vals[0])
                except (ValueError, TypeError):
                    pass
                return default

        class _MockServer:
            server_address = ("0.0.0.0", 8765)

        class _MockHandoffHandler:
            server = _MockServer()

            def __init__(self):
                self.resp_data = None

            def _send_json(self, data):
                self.resp_data = data

        h = _MockHandoffHandler()
        qs = {
            "id": ["series-777"],
            "season": ["2"],
            "episode": ["4"],
            "t": ["320"],
            "tab": ["hdrezka"],
            "tr": ["56"],
            "title": ["Очень странные дела"],
            "media_type": ["series"],
        }
        res = handle_handoff(h, qs, None, _MockHandoffCtx)
        self.assertTrue(res)
        self.assertIsNotNone(h.resp_data)
        self.assertTrue(h.resp_data.get("ok"))
        self.assertIn("192.168.1.120:8765", h.resp_data.get("handoff_url", ""))
        self.assertIn("p=series-777", h.resp_data.get("handoff_url", ""))
        self.assertIn("s=2&e=4", h.resp_data.get("handoff_url", ""))
        self.assertIn("t=320", h.resp_data.get("handoff_url", ""))
        self.assertIn("tab=hdrezka", h.resp_data.get("handoff_url", ""))
        self.assertIn("tr=56", h.resp_data.get("handoff_url", ""))
        self.assertTrue(h.resp_data.get("qr_svg", "").startswith("<svg"))
        self.assertIn("</svg>", h.resp_data.get("qr_svg", ""))
        self.assertIn("series-777", _MockHandoffCtx.dlna_manager.registered_items)

        # 2. Frontend markup and scripts
        with open(os.path.join(BASE_DIR, "public", "index.html"), "r", encoding="utf-8") as fh:
            index_html = fh.read()
        self.assertIn('id="btn-player-handoff"', index_html)
        self.assertIn('id="handoff-modal"', index_html)
        self.assertIn('id="handoff-qr-box"', index_html)
        self.assertIn('id="handoff-item-title"', index_html)
        self.assertIn('id="handoff-item-time"', index_html)
        self.assertIn('class="atv-handoff-time-badge"', index_html)
        self.assertIn('id="handoff-url-input"', index_html)
        self.assertIn('id="btn-handoff-copy-url"', index_html)
        self.assertIn('id="close-handoff-modal"', index_html)

        with open(os.path.join(BASE_DIR, "public", "js", "features-cast.js"), "r", encoding="utf-8") as fh:
            cast_js = fh.read()
        self.assertIn("export async function openPlayerHandoffModal", cast_js)
        self.assertIn("export function closePlayerHandoffModal", cast_js)
        self.assertIn("startSec", cast_js)

        with open(os.path.join(BASE_DIR, "public", "js", "features.js"), "r", encoding="utf-8") as fh:
            features_js = fh.read()
        self.assertIn("btn-player-handoff", features_js)
        self.assertIn("btn-handoff-copy-url", features_js)
        self.assertIn("openPlayerHandoffModal", features_js)

    def test_audit_bugfixes_burn_sub_handoff_and_catalog(self):
        """Verifies bugfixes from adversarial audit:
        - streaming.py has hashlib, tempfile, urllib.request imported for burned subs
        - streaming.py registers active MP4 remux procs
        - remote.py handle_handoff enforces kids mode and loopback auto-LAN
        - catalog.py gracefully falls back to offline catalog if aggregator returns non-dict
        - features-cast.js handles deep links even when catalogItems is empty
        - catalog-shelves.js filters CW strictly by id
        - subtitles.js isolates vocabulary per profile
        """
        import backend.routes.streaming as st_mod
        self.assertTrue(hasattr(st_mod, "hashlib"))
        self.assertTrue(hasattr(st_mod, "tempfile"))
        self.assertTrue(hasattr(st_mod, "urllib"))
        self.assertTrue(hasattr(st_mod.urllib, "request"))

        with open(os.path.join(BASE_DIR, "backend", "routes", "streaming.py"), "r", encoding="utf-8") as fh:
            st_src = fh.read()
        self.assertIn("_ACTIVE_REMUX_PROCS.append((proc, dl_stop))", st_src)

        # 2. remote.py handle_handoff kids mode enforcement
        from backend.routes.remote import handle_handoff

        class _MockKidsHandoffCtx:
            app_prefs = {"lan_access": False}
            server_runtime = {"running": True}
            lan_synced = False

            class dlna_manager:
                lan_ip = "192.168.1.50"
                registered_items = {}

                @classmethod
                def register_deep_link_item(cls, item_id, payload):
                    cls.registered_items[item_id] = payload

            class profile_manager:
                @staticmethod
                def is_kids_mode_active():
                    return True

                @staticmethod
                def is_active_kids_pin_locked():
                    return True

                @staticmethod
                def is_item_kids_safe(item):
                    return item.get("id") == "safe_cartoon"

            @staticmethod
            def qs_int(qs, key, default):
                try:
                    return int(qs.get(key, [default])[0])
                except Exception:
                    return default

            @staticmethod
            def build_trusted_item_for_kids_check(**kwargs):
                d = dict(kwargs)
                d["id"] = d.get("item_id", "")
                return d

        class _MockHandoffHandler:
            resp_status = 200
            resp_data = None

            def _is_loopback_client(self):
                return True

            def _send_json(self, data, status=200):
                self.resp_status = status
                self.resp_data = data

        # Blocked in kids mode
        h_blocked = _MockHandoffHandler()
        res_blocked = handle_handoff(
            h_blocked,
            {"id": ["adult_film"], "title": ["Adult Film"]},
            None,
            _MockKidsHandoffCtx,
        )
        self.assertTrue(res_blocked)
        self.assertEqual(h_blocked.resp_status, 403)
        self.assertFalse(h_blocked.resp_data.get("ok"))

        # Allowed in kids mode
        h_allowed = _MockHandoffHandler()
        res_allowed = handle_handoff(
            h_allowed,
            {"id": ["safe_cartoon"], "title": ["Safe Cartoon"]},
            None,
            _MockKidsHandoffCtx,
        )
        self.assertTrue(res_allowed)
        self.assertEqual(h_allowed.resp_status, 200)
        self.assertTrue(h_allowed.resp_data.get("ok"))

        # 3. catalog.py non-dict fallback
        from backend.routes.catalog import handle_catalog, handle_search

        class _MockNonDictCtx:
            app_prefs = {"app_lang": "ru"}

            @staticmethod
            def norm_app_lang(val, default):
                return val or default

            class aggregator:
                @staticmethod
                def get_catalog(**kwargs):
                    return None  # Bad aggregator return

                @staticmethod
                def unified_search(**kwargs):
                    return None  # Bad aggregator return

            class download_manager:
                @staticmethod
                def get_downloads_payload(**kwargs):
                    return {"ok": True, "items": []}

            class profile_manager:
                @staticmethod
                def is_kids_mode_active():
                    return False

                @staticmethod
                def get_active_profile(**kwargs):
                    return {"id": "main", "name": "Main"}

        h_cat = _MockHandoffHandler()
        self.assertTrue(handle_catalog(h_cat, {}, None, _MockNonDictCtx))
        self.assertIsInstance(h_cat.resp_data, dict)
        self.assertIn("items", h_cat.resp_data)

        h_srch = _MockHandoffHandler()
        self.assertTrue(handle_search(h_srch, {"q": ["test"]}, None, _MockNonDictCtx))
        self.assertIsInstance(h_srch.resp_data, dict)
        self.assertIn("items", h_srch.resp_data)

        # 4. Frontend integrity checks
        with open(os.path.join(BASE_DIR, "public", "js", "features-cast.js"), "r", encoding="utf-8") as fh:
            fc_src = fh.read()
        self.assertIn("!req || (!req.id && !req.title)", fc_src)
        self.assertIn("getEffectivePlaybackTiming(video)", fc_src)
        self.assertIn("state.pendingStudioId = String(req.tr)", fc_src)

        with open(os.path.join(BASE_DIR, "public", "js", "subtitles.js"), "r", encoding="utf-8") as fh:
            sub_src = fh.read()
        self.assertIn("profileStorageKey(VOCAB_STORAGE_KEY)", sub_src)
        self.assertIn('class="atv-sub-word" role="button" tabindex="0"', sub_src)

        with open(os.path.join(BASE_DIR, "public", "js", "catalog-shelves.js"), "r", encoding="utf-8") as fh:
            shelves_src = fh.read()
        self.assertIn("(x) => x.id !== cw.id", shelves_src)
        self.assertNotIn("x.id !== cw.id && x.title !== cw.title", shelves_src)

    def test_wave3_features_lan_sync_bookmarks_and_credits(self):
        """Test Wave 3: LAN sync endpoints, Kids Mode sync safety, bookmarks subsystem, and player credits layout."""
        from backend.routes.remote import handle_sync_state, handle_sync_merge, handle_sync_peers

        # 1. Test LAN sync state export
        class _MockSyncStore:
            def __init__(self):
                self._data = {}
            def get(self, key, default=None):
                return self._data.get(key, default)
            def set(self, key, val):
                self._data[key] = val

        class _MockSyncCtx:
            store = _MockSyncStore()
            class profile_manager:
                @staticmethod
                def get_active_profile_id():
                    return "adult_profile"
                @staticmethod
                def is_kids_mode_active():
                    return False
                @staticmethod
                def is_item_kids_safe(item):
                    return item.get("age_rating") != "18+"

            @staticmethod
            def detect_lan_ipv4():
                return "192.168.1.10"

        class _MockHttpHandler:
            def __init__(self, body=None):
                self.resp_data = None
                self._body = body or {}
            def _send_json(self, data):
                self.resp_data = data
            def _read_json_body(self):
                return self._body

        # Initial state export
        h_state = _MockHttpHandler()
        self.assertTrue(handle_sync_state(h_state, {}, None, _MockSyncCtx))
        self.assertTrue(h_state.resp_data.get("ok"))
        self.assertEqual(h_state.resp_data.get("profile_id"), "adult_profile")
        self.assertEqual(h_state.resp_data.get("device_ip"), "192.168.1.10")

        # LAN merge in adult profile
        merge_body = {
            "profile_id": "adult_profile",
            "watch_history": [
                {"id": "mov_1", "title": "Inception", "time": 1200, "updatedAt": 1000},
                {"id": "mov_2", "title": "Deadpool", "age_rating": "18+", "time": 300, "updatedAt": 2000},
            ],
            "bookmarks": [
                {"id": "bm_1", "itemId": "mov_1", "time": 1200, "note": "Dream level 2", "updatedAt": 1000}
            ]
        }
        h_merge = _MockHttpHandler(merge_body)
        self.assertTrue(handle_sync_merge(h_merge, {}, None, _MockSyncCtx))
        self.assertEqual(h_merge.resp_data.get("merged_history"), 2)
        self.assertEqual(h_merge.resp_data.get("merged_bookmarks"), 1)

        # Verify state in store
        saved_hist = _MockSyncCtx.store.get("sync_history_adult_profile", [])
        self.assertEqual(len(saved_hist), 2)

        # Last-write-wins update
        update_body = {
            "watch_history": [
                {"id": "mov_1", "title": "Inception", "time": 3500, "updatedAt": 1500}
            ]
        }
        h_update = _MockHttpHandler(update_body)
        self.assertTrue(handle_sync_merge(h_update, {}, None, _MockSyncCtx))
        updated_hist = _MockSyncCtx.store.get("sync_history_adult_profile", [])
        inc_item = next(it for it in updated_hist if it["id"] == "mov_1")
        self.assertEqual(inc_item["time"], 3500)

        # 2. Kids Mode sync isolation: adult content MUST NOT merge into kids profile
        class _MockKidsSyncCtx:
            store = _MockSyncStore()
            class profile_manager:
                @staticmethod
                def get_active_profile_id():
                    return "child_profile"
                @staticmethod
                def is_kids_mode_active():
                    return True
                @staticmethod
                def is_item_kids_safe(item):
                    return item.get("age_rating") != "18+"
            @staticmethod
            def detect_lan_ipv4():
                return "192.168.1.10"

        kids_merge_payload = {
            "watch_history": [
                {"id": "cartoon_1", "title": "Inside Out", "age_rating": "6+", "updatedAt": 100},
                {"id": "adult_horror", "title": "Saw X", "age_rating": "18+", "updatedAt": 200}
            ]
        }
        h_kids = _MockHttpHandler(kids_merge_payload)
        self.assertTrue(handle_sync_merge(h_kids, {}, None, _MockKidsSyncCtx))
        kids_saved = _MockKidsSyncCtx.store.get("sync_history_child_profile", [])
        self.assertEqual(len(kids_saved), 1)
        self.assertEqual(kids_saved[0]["title"], "Inside Out")
        self.assertNotIn("Saw X", [it["title"] for it in kids_saved])

        # 3. Peers endpoint
        h_peers = _MockHttpHandler()
        self.assertTrue(handle_sync_peers(h_peers, {}, None, _MockSyncCtx))
        self.assertTrue(h_peers.resp_data.get("ok"))
        self.assertIn("peers", h_peers.resp_data)

        # 4. Frontend verification for layout deconfliction and bookmarks
        with open(os.path.join(BASE_DIR, "public", "index.html"), "r", encoding="utf-8") as fh:
            html_src = fh.read()
        self.assertIn('id="skip-outro-btn"', html_src)
        self.assertIn('id="atv-bookmark-dialog"', html_src)
        self.assertIn('id="bookmarks-modal"', html_src)
        self.assertIn('id="lan-sync-card"', html_src)
        self.assertIn('id="btn-open-bookmarks-modal"', html_src)

        # Ensure skip-outro-btn is decoupled from #video-endgame-stack
        endgame_idx = html_src.find('id="video-endgame-stack"')
        endgame_close = html_src.find('</div>', endgame_idx)
        outro_idx = html_src.find('id="skip-outro-btn"')
        self.assertTrue(outro_idx > endgame_close or outro_idx < endgame_idx, "skip-outro-btn must not be nested inside video-endgame-stack")

        with open(os.path.join(BASE_DIR, "public", "css", "video-controls-and-person.css"), "r", encoding="utf-8") as fh:
            css_src = fh.read()
        self.assertIn(".atv-video-stage.has-postwatch-open #skip-outro-btn", css_src)
        self.assertIn(".atv-bookmark-dialog", css_src)
        self.assertIn("#vc-bookmarks-popover", css_src)

        with open(os.path.join(BASE_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as fh:
            bm_js = fh.read()
        self.assertIn("export function openBookmarkNoteDialog", bm_js)
        self.assertIn("export function exportBookmarksMarkdown", bm_js)
        self.assertIn("export function initBookmarksListeners", bm_js)

        with open(os.path.join(BASE_DIR, "public", "js", "catalog-cards.js"), "r", encoding="utf-8") as fh:
            cards_js = fh.read()
        self.assertIn("export function appendPosterCardsProgressive", cards_js)
        self.assertIn("export function cancelPendingCardBatch", cards_js)

    def test_seamless_next_episode_transition(self):
        """Test seamless next-episode pre-buffering, skip-intro preloading, and instant swap."""
        # 1. State and preloading keys
        with open(os.path.join(BASE_DIR, "public", "js", "state.js"), "r", encoding="utf-8") as fh:
            state_src = fh.read()
        self.assertIn("preloadedSkipSegments: null,", state_src)
        self.assertIn("preloadedNextSubtitles: null,", state_src)

        # 2. Player streams preload & warm up buffer
        with open(os.path.join(BASE_DIR, "public", "js", "player-streams.js"), "r", encoding="utf-8") as fh:
            streams_src = fh.read()
        self.assertIn("export async function warmUpStreamBuffer(url)", streams_src)
        self.assertIn("shouldPreload = creditsActive || ratio >= 0.82 || remain <= 150", streams_src)
        self.assertIn("warmUpStreamBuffer(state.preloadedNextEpisode.streamUrl)", streams_src)
        self.assertIn("state.preloadedSkipSegments = skipData", streams_src)
        self.assertIn("state.preloadedNextSubtitles = subData", streams_src)
        self.assertIn('skipOutroBtn.classList.add("is-preloaded")', streams_src)

        # 3. Intro credits instant preloaded segments usage
        with open(os.path.join(BASE_DIR, "public", "js", "player-intro-credits.js"), "r", encoding="utf-8") as fh:
            intro_src = fh.read()
        self.assertIn("if (state.preloadedSkipSegments && state.preloadedSkipSegments.ok)", intro_src)

        # 4. Instant swap in player.js and player-seasons.js
        with open(os.path.join(BASE_DIR, "public", "js", "player.js"), "r", encoding="utf-8") as fh:
            player_src = fh.read()
        self.assertIn("isInstantSwap = false", player_src)
        self.assertIn("state.instantSwapLoaderTimer", player_src)

        with open(os.path.join(BASE_DIR, "public", "js", "player-seasons.js"), "r", encoding="utf-8") as fh:
            seasons_src = fh.read()
        self.assertIn("isInstantSwap: Boolean(hasPreloadedNext)", seasons_src)
        self.assertIn("!hasPreloadedNext && (state.activeSourceTab === \"stremio\"", seasons_src)

        # 5. CSS readiness dot & animation
        with open(os.path.join(BASE_DIR, "public", "css", "video-controls-and-person.css"), "r", encoding="utf-8") as fh:
            css_src = fh.read()
        self.assertIn(".atv-preload-ready-dot", css_src)
        self.assertIn("@keyframes atvPreloadPulse", css_src)

    def test_codebase_decomposition_and_debug_logging(self):
        """Verifies decomposition of kinorium parsers, catalog live search module, and logDebug instrumentation."""
        # 1. backend.kinorium_parsers exports
        from backend.kinorium_parsers import (
            parse_movie_list_html,
            parse_premieres_list_html,
            parse_series_episodes_html,
            extract_similar_items_html,
            _safe_year_int,
            _sanitize_kinorium_genres,
        )
        self.assertEqual(_safe_year_int("2024 (Series)"), 2024)
        self.assertEqual(_sanitize_kinorium_genres(["Драма", "Боевик"]), ["Драма", "Боевик"])

        # 2. KinoriumService static method delegation
        from backend.kinorium import KinoriumService
        self.assertTrue(callable(KinoriumService.parse_movie_list_html))
        self.assertTrue(callable(KinoriumService.parse_premieres_list_html))
        self.assertTrue(callable(KinoriumService.parse_series_episodes_html))
        self.assertTrue(callable(KinoriumService.extract_similar_items_html))

        # Sample parse verification
        sample_html = '<div class="user-status-list" data-movieId="12345" data-movieName="Тестовый фильм"></div>'
        parsed = KinoriumService.parse_movie_list_html(sample_html)
        self.assertIn("12345", parsed)
        self.assertEqual(parsed["12345"]["ru_title"], "Тестовый фильм")

        # 3. public/js/catalog-live-search.js presence and exports
        live_search_path = os.path.join(BASE_DIR, "public", "js", "catalog-live-search.js")
        self.assertTrue(os.path.isfile(live_search_path))
        with open(live_search_path, "r", encoding="utf-8") as fh:
            live_src = fh.read()
        self.assertIn("export function initCatalogLiveSearch", live_src)
        self.assertIn("export const closeLiveSearchPopover", live_src)
        self.assertIn("export function resetCatalogFiltersForGlobalSearch", live_src)

        # 4. app.js invokes initCatalogLiveSearch
        with open(os.path.join(BASE_DIR, "public", "app.js"), "r", encoding="utf-8") as fh:
            app_src = fh.read()
        self.assertIn("initCatalogLiveSearch()", app_src)
        self.assertIn('from "./js/catalog-live-search.js?v=', app_src)

        # 5. logDebug in utils.js
        with open(os.path.join(BASE_DIR, "public", "js", "utils.js"), "r", encoding="utf-8") as fh:
            utils_src = fh.read()
        self.assertIn("export function logDebug(", utils_src)
        self.assertIn("window.logDebug = logDebug", utils_src)

    def test_improve_loop_m1_modules_and_log_hygiene(self):
        """Verifies M1 improve-loop modular extractions (kinorium_http, kinorium_sync, app-hotkeys, player-rating, settings bindings) and verbose_log gating."""
        # 1. backend.kinorium_http & backend.kinorium_sync
        from backend.kinorium_http import (
            extract_user_path,
            sanitize_session_cookie,
            kinorium_http_request,
            fetch_kinorium_html,
        )
        from backend.kinorium_sync import (
            fetch_series_episodes_state,
            reconcile_series_episodes,
            reconcile_local_statuses_to_remote,
        )
        self.assertEqual(extract_user_path("https://ru.kinorium.com/user/51670/"), "/user/51670/")
        self.assertIn("PHPSESSID=abc123", sanitize_session_cookie("Cookie: PHPSESSID=abc123"))
        self.assertTrue(callable(kinorium_http_request))
        self.assertTrue(callable(fetch_kinorium_html))
        self.assertTrue(callable(fetch_series_episodes_state))
        self.assertTrue(callable(reconcile_series_episodes))
        self.assertTrue(callable(reconcile_local_statuses_to_remote))

        # 2. verbose_log gating in backend/routes/streams.py
        with open(os.path.join(BASE_DIR, "backend", "routes", "streams.py"), "r", encoding="utf-8") as fh:
            streams_src = fh.read()
        self.assertIn('if getattr(ctx, "verbose_log", False):', streams_src)

        # 3. Frontend modular controllers
        hotkeys_path = os.path.join(BASE_DIR, "public", "js", "app-hotkeys.js")
        self.assertTrue(os.path.isfile(hotkeys_path))
        with open(hotkeys_path, "r", encoding="utf-8") as fh:
            self.assertIn("export function initGlobalHotkeys(", fh.read())

        with open(os.path.join(BASE_DIR, "public", "js", "player-rating.js"), "r", encoding="utf-8") as fh:
            self.assertIn("export function initPlayerStatusAndRatingBindings(", fh.read())

        with open(os.path.join(BASE_DIR, "public", "js", "modals.js"), "r", encoding="utf-8") as fh:
            self.assertIn("export function initQuickPeekBindings(", fh.read())

        with open(os.path.join(BASE_DIR, "public", "js", "settings.js"), "r", encoding="utf-8") as fh:
            settings_src = fh.read()
        self.assertIn("export function initSettingsAndBackupBindings(", settings_src)
        self.assertIn("export async function requestCloseSettingsModal(", settings_src)

        with open(os.path.join(BASE_DIR, "public", "app.js"), "r", encoding="utf-8") as fh:
            app_src = fh.read()
        self.assertIn("initGlobalHotkeys({", app_src)
        self.assertIn("initQuickPeekBindings()", app_src)
        self.assertIn("initPlayerStatusAndRatingBindings({", app_src)
        self.assertIn("initSettingsAndBackupBindings()", app_src)


if __name__ == "__main__":
    unittest.main()
