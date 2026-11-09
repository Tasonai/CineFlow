import gzip
import json
import os
import re
import tempfile
import threading
import time
import unittest

from backend.downloads import OfflineDownloadManager
from backend.hdrezka import HDRezkaClient
from backend.kinorium import KinoriumService
from backend.remote_control import DesktopRemoteBroker
from backend.storage_db import VelariumStorageDB
from backend.subtitles import (
    SubtitleSearchService,
    convert_any_subtitle_to_webvtt,
    convert_ass_to_webvtt,
    decode_subtitle_bytes,
)


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class _DummyRemux:
    ffmpeg_path = "/usr/bin/true"

    def is_available(self) -> bool:
        return True

    def get_hw_capabilities(self) -> dict:
        return {}


class _FakeNetForRezka:
    def __init__(self, pages: dict, search_html: str = ""):
        self.pages = pages
        self.search_html = search_html
        self.calls = []

    def request(self, url, method="GET", data=None, headers=None, **kwargs):
        self.calls.append((method, url))
        if "/search/" in url:
            return 200, self.search_html, {"_final_url": url}
        for k, html_body in self.pages.items():
            if k in url:
                return 200, html_body, {"_final_url": url}
        return 404, "", {"_final_url": url}


class _FakeNetForSubs:
    def fetch_text(self, url, headers=None, timeout=6.0):
        payload = {
            "subtitles": [
                {"lang": "eng", "url": "https://subs.example.org/en_1.srt"},
                {"lang": "rus", "url": "https://subs.example.org/ru_1.srt"},
                {"lang": "pol", "url": "https://subs.example.org/pl_1.srt"},
            ]
        }
        return 200, json.dumps(payload)


class _FakeStremioForSubs:
    def resolve_imdb_id(self, **kwargs):
        return "tt15398776"

    def get_addons(self, **kwargs):
        return []


class TestV31Upgrades(unittest.TestCase):
    def test_sqlite_wal_storage_engine_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = VelariumStorageDB(tmp)
            mode_row = db._conn.execute("PRAGMA journal_mode;").fetchone()
            self.assertEqual(str(mode_row[0]).lower(), "wal")

            # KV roundtrip
            db.set_kv("settings", "prefs", {"lan_access": True, "remote_pair_token": "ab12cd34"})
            self.assertEqual(db.get_kv("settings", "prefs")["remote_pair_token"], "ab12cd34")
            db.delete_kv("settings", "prefs")
            self.assertIsNone(db.get_kv("settings", "prefs"))

            # Sectioned profile state roundtrip + differential hashing
            state_v1 = {
                "account": {"connected": True, "username": "cine_user"},
                "watched": {"kin_100": {"title": "Дюна", "progress": 1.0}},
            }
            hashes_1 = db.save_profile_state("main", state_v1)
            self.assertTrue(db.has_profile_state("main"))
            loaded = db.load_profile_state("main")
            self.assertEqual(loaded["account"]["username"], "cine_user")
            self.assertEqual(db.get_profile_section("main", "watched")["kin_100"]["title"], "Дюна")

            # Removing a section deletes it cleanly
            state_v2 = {"account": {"connected": True, "username": "cine_user"}}
            db.save_profile_state("main", state_v2, last_hashes=hashes_1)
            loaded_v2 = db.load_profile_state("main")
            self.assertNotIn("watched", loaded_v2)

            # Cache & downloads tables
            db.save_cache_dict("en_meta", {"tt0133093": {"title": "The Matrix"}}, max_entries=10)
            self.assertEqual(db.load_cache_dict("en_meta")["tt0133093"]["title"], "The Matrix")

            dl_map = {
                "dl_test_1": {
                    "download_id": "dl_test_1",
                    "status": "completed",
                    "created_at": 100.0,
                    "title": "Матрица",
                }
            }
            db.replace_all_downloads(dl_map)
            self.assertTrue(db.has_downloads_rows())
            self.assertEqual(db.load_downloads_map()["dl_test_1"]["title"], "Матрица")

    def test_hdrezka_wrong_title_id_isolation_and_verification(self):
        # 1. kin_12345 and tt1234567 must NEVER leak numeric suffixes as rezka_id
        self.assertEqual(HDRezkaClient._extract_safe_rezka_id("kin_54321", "", None), "")
        self.assertEqual(HDRezkaClient._extract_safe_rezka_id("tt0903747", "", None), "")
        self.assertEqual(HDRezkaClient._extract_safe_rezka_id("rezka_88991", "", None), "88991")
        self.assertEqual(
            HDRezkaClient._extract_safe_rezka_id(
                "kin_54321",
                "",
                "https://rezka.ag/series/comedy/53988-terapiya-2023.html",
            ),
            "53988",
        )

        # 2. _verify_resolved_page rejects wrong media_type, wrong IMDb, wrong orig_title, and wrong year
        wrong_movie_html = """
        <html>
          <h1 itemprop="name">Терапия</h1>
          <div class="b-post__origtitle">Therapy</div>
          <a href="/year/2009/">2009</a>
          <script>sof.tv.initCDNMoviesEvents(9999, 111, 0, 0, 0, 'rezka.ag', false, {"streams":"[1080p]https://cdn.example/m.mp4"});</script>
        </html>
        """
        self.assertFalse(
            HDRezkaClient._verify_resolved_page(
                wrong_movie_html,
                title="Терапия",
                orig_title="Shrinking",
                year=2023,
                media_type="series",
            )
        )

        wrong_homonym_series_html = """
        <html>
          <h1 itemprop="name">Терапия Себастьяна Фитцека</h1>
          <div class="b-post__origtitle"> Sebastian Fitzeks Die Therapie </div>
          <a href="/year/2023/">2023</a>
          <script>sof.tv.initCDNSeriesEvents(59111, 111, 1, 1, {"streams":"[1080p]https://cdn.example/wrong.mp4"});</script>
        </html>
        """
        self.assertFalse(
            HDRezkaClient._verify_resolved_page(
                wrong_homonym_series_html,
                title="Терапия",
                orig_title="Shrinking",
                year=2023,
                media_type="series",
            )
        )

        correct_shrinking_html = """
        <html>
          <h1 itemprop="name">Терапия</h1>
          <div class="b-post__origtitle">Shrinking</div>
          <a href="https://www.imdb.com/title/tt15677150/">IMDb</a>
          <a href="/year/2023/">2023</a>
          <script>sof.tv.initCDNSeriesEvents(53988, 56, 1, 1, {"streams":"[1080p]https://cdn.example/shrinking.mp4"});</script>
        </html>
        """
        self.assertTrue(
            HDRezkaClient._verify_resolved_page(
                correct_shrinking_html,
                title="Терапия",
                orig_title="Shrinking",
                year=2023,
                media_type="series",
                expected_imdb="tt15677150",
            )
        )

        # 3. Poisoned rezka_url is discarded and dual-query search resolves the true series
        search_markup = """
        <div class="b-content__inline_item" data-id="59111" data-url="https://rezka.ag/series/thriller/59111-terapiya-sebastyana-fitceka-2023.html">
          <img src="https://rezka.ag/p1.jpg">
          <div class="b-content__inline_item-link"><a href="#">Терапия Себастьяна Фитцека</a><div>2023, Германия, Триллеры</div></div>
        </div>
        <div class="b-content__inline_item" data-id="53988" data-url="https://rezka.ag/series/comedy/53988-shrinking-2023.html">
          <img src="https://rezka.ag/p2.jpg">
          <div class="b-content__inline_item-link"><a href="#">Терапия</a><div>2023, США, Комедии</div></div>
        </div>
        """
        fake_net = _FakeNetForRezka(
            pages={
                "59111-terapiya-sebastyana": wrong_homonym_series_html,
                "53988-shrinking-2023.html": correct_shrinking_html,
            },
            search_html=search_markup,
        )
        svc = HDRezkaClient(fake_net)
        resolved = svc._resolve_page_metadata(
            numeric_id="",
            title="Терапия",
            orig_title="Shrinking",
            rezka_url="https://rezka.ag/series/thriller/59111-terapiya-sebastyana-fitceka-2023.html",
            year=2023,
            media_type="series",
            imdb_id="tt15677150",
        )
        self.assertEqual(resolved.get("rezka_id"), "53988")
        self.assertIn("53988-shrinking-2023.html", resolved.get("rezka_url", ""))

    def test_kinorium_sanitizes_poisoned_series_live_meta(self):
        poisoned_state = {
            "remote_watching_items": {
                "2800100": {"ru_title": "Терапия", "orig_title": "Shrinking", "year": 2023}
            },
            "series_live_meta": {
                "kin_tt9999999": {"title": "Мусор"},
                "kin_100200": {"title": "Фильм", "rezka_id": "100200"},
                "kin_2800100": {
                    "id": "59111",
                    "kinorium_id": "2800100",
                    "title": "Терапия Себастьяна Фитцека",
                    "orig_title": "Sebastian Fitzeks Die Therapie",
                    "rezka_url": "https://rezka.ag/series/thriller/59111-terapiya-sebastyana-fitceka-2023.html",
                },
                "kin_333444": {
                    "id": "333444",
                    "kinorium_id": "333444",
                    "title": "Разделение",
                    "orig_title": "Severance",
                    "rezka_id": "46089",
                    "rezka_url": "https://rezka.ag/series/thriller/46089-severance-2022.html",
                    "seasons_map": {"1": [1, 2, 3]},
                },
            },
        }
        healed = KinoriumService._sanitize_series_live_meta_dict(poisoned_state)
        self.assertTrue(healed)
        live = poisoned_state["series_live_meta"]
        self.assertNotIn("kin_tt9999999", live)
        self.assertNotIn("kin_100200", live)
        self.assertNotIn("kin_2800100", live)
        self.assertIn("kin_333444", live)
        self.assertEqual(live["kin_333444"]["id"], "kin_333444")

    def test_hdrezka_stream_bundle_mirrors_hls_and_midstream_recovery_invariants(self):
        raw_stream = (
            "[720p]https://prx1.voidboost.cc/720.mp4:hls:manifest.m3u8 or https://prx1.voidboost.cc/720.mp4 or https://prx2.voidboost.cc/720.mp4,"
            "[1080p]https://prx1.voidboost.cc/1080.mp4:hls:manifest.m3u8 or https://prx1.voidboost.cc/1080.mp4 or https://prx2.voidboost.cc/1080.mp4,"
            "[1080p <span class=\"p-info\">Ultra</span>]https://prx1.voidboost.cc/stub.mp4"
        )
        bundle = HDRezkaClient.decode_rezka_stream_bundle(raw_stream)
        self.assertEqual(bundle["qualities"]["1080p"], "https://prx1.voidboost.cc/1080.mp4")
        self.assertEqual(bundle["backup_qualities"]["1080p"], ["https://prx2.voidboost.cc/1080.mp4"])
        self.assertEqual(
            bundle["hls_qualities"]["1080p"],
            "https://prx1.voidboost.cc/1080.mp4:hls:manifest.m3u8",
        )
        self.assertNotIn("1080p Ultra", bundle["qualities"])

        # Verify force_refresh=True bypasses stale page_cache
        html_v1 = '<html><h1 itemprop="name">Дюна</h1><div class="b-post__origtitle">Dune</div><script>sof.tv.initCDNMoviesEvents(101, 56, 0, 0, 0, "rezka.ag", false, {"streams":"[1080p]https://cdn1.example/old.mp4"});</script></html>'
        html_v2 = '<html><h1 itemprop="name">Дюна</h1><div class="b-post__origtitle">Dune</div><script>sof.tv.initCDNMoviesEvents(101, 56, 0, 0, 0, "rezka.ag", false, {"streams":"[1080p]https://cdn2.example/fresh.mp4"});</script></html>'
        net = _FakeNetForRezka({"101-dune.html": html_v1})
        svc = HDRezkaClient(net)
        m1 = svc._resolve_page_metadata(
            numeric_id="101",
            title="Дюна",
            orig_title="Dune",
            rezka_url="https://rezka.ag/films/fiction/101-dune.html",
            year=2021,
            media_type="movie",
        )
        self.assertEqual(m1["inline_streams"]["1080p"], "https://cdn1.example/old.mp4")
        net.pages["101-dune.html"] = html_v2
        # Cached without force_refresh
        m_cached = svc._resolve_page_metadata(
            numeric_id="101",
            title="Дюна",
            orig_title="Dune",
            rezka_url="https://rezka.ag/films/fiction/101-dune.html",
            year=2021,
            media_type="movie",
            force_refresh=False,
        )
        self.assertEqual(m_cached["inline_streams"]["1080p"], "https://cdn1.example/old.mp4")
        # Fresh with force_refresh=True
        m_fresh = svc._resolve_page_metadata(
            numeric_id="101",
            title="Дюна",
            orig_title="Dune",
            rezka_url="https://rezka.ag/films/fiction/101-dune.html",
            year=2021,
            media_type="movie",
            force_refresh=True,
        )
        self.assertEqual(m_fresh["inline_streams"]["1080p"], "https://cdn2.example/fresh.mp4")

        # Verify player.js and audio-dsp.js recovery invariants
        with open(os.path.join(ROOT_DIR, "public", "js", "player.js"), "r", encoding="utf-8") as pf:
            player_src = pf.read()
        self.assertIn("function _tryRecoverHdRezkaPlayback", player_src)
        self.assertIn("export function isHdRezkaStreamDeadOrExpired", player_src)
        self.assertIn("nocache=1", player_src)
        self.assertIsNone(
            re.search(r'addEventListener\(\s*["\']error["\'][^)]*once\s*:\s*true', player_src),
            "video error listener must never use { once: true }",
        )

        with open(os.path.join(ROOT_DIR, "public", "js", "audio-dsp.js"), "r", encoding="utf-8") as af:
            audio_src = af.read()
        self.assertIn("export function resumeAudioContextIfNeeded", audio_src)
        self.assertIn("interrupted", audio_src)

    def test_phone_remote_broker_pairing_state_and_commands(self):
        broker = DesktopRemoteBroker(initial_token="a1b2c3d4")
        self.assertEqual(broker.pair_token, "a1b2c3d4")
        self.assertTrue(broker.verify_key("a1b2c3d4", is_loopback=False))
        self.assertFalse(broker.verify_key("wrongkey", is_loopback=False))
        self.assertTrue(broker.verify_key("", is_loopback=True))

        # Initial phone handshake registers client; subsequent long-poll blocks until desktop state changes
        init_snap = broker.wait_for_state(
            since_seq=0,
            timeout=0.1,
            client_id="iphone_1",
            device_name="iPhone 16",
            client_ip="192.168.1.44",
        )
        self.assertEqual(init_snap["connected_count"], 1)

        state_box = {}

        def _wait_phone():
            state_box["res"] = broker.wait_for_state(
                since_seq=init_snap["seq"],
                timeout=3.0,
                client_id="iphone_1",
                device_name="iPhone 16",
                client_ip="192.168.1.44",
            )

        t = threading.Thread(target=_wait_phone)
        t.start()
        time.sleep(0.05)
        broker.update_desktop_state({"is_player_open": True, "playing": True, "current_time": 42.5})
        t.join(timeout=2.0)

        snap = state_box["res"]
        self.assertTrue(snap["desktop_online"])
        self.assertEqual(snap["connected_count"], 1)
        self.assertTrue(snap["state"]["playing"])
        self.assertAlmostEqual(snap["state"]["current_time"], 42.5)

        # Command queue & validation
        bad = broker.enqueue_command(action="format_disk")
        self.assertFalse(bad["ok"])

        good = broker.enqueue_command(
            action="seek_rel",
            payload={"delta": 15},
            client_id="iphone_1",
            device_name="iPhone 16",
            client_ip="192.168.1.44",
        )
        self.assertTrue(good["ok"])
        polled = broker.wait_for_commands(since_id=0, timeout=0.2)
        self.assertEqual(len(polled["commands"]), 1)
        self.assertEqual(polled["commands"][0]["action"], "seek_rel")
        self.assertEqual(polled["commands"][0]["payload"]["delta"], 15)

        # Rotating token disconnects previous clients and invalidates old key
        new_tok = broker.rotate_pair_token()
        self.assertNotEqual(new_tok, "a1b2c3d4")
        self.assertFalse(broker.verify_key("a1b2c3d4", is_loopback=False))
        self.assertEqual(len(broker.get_connected_remotes()), 0)

    def test_smart_subtitles_decoding_ass_conversion_and_search(self):
        # CP1251 Cyrillic
        cyr_srt = "1\n00:00:01,000 --> 00:00:03,500\nПривет, мир!\n".encode("cp1251")
        self.assertIn("Привет, мир!", decode_subtitle_bytes(cyr_srt))

        # UTF-16LE with BOM
        utf16_srt = b"\xff\xfe" + "1\n00:00:01,000 --> 00:00:02,000\nТест UTF16\n".encode("utf-16-le")
        self.assertIn("Тест UTF16", decode_subtitle_bytes(utf16_srt))

        # Gzipped UTF-8
        gz_srt = gzip.compress("1\n00:00:05,000 --> 00:00:07,000\nСжатые субтитры\n".encode("utf-8"))
        self.assertIn("Сжатые субтитры", decode_subtitle_bytes(gz_srt))

        # ASS to WebVTT preserving commas inside dialogue and stripping tags
        ass_sample = """[Script Info]
Title: Example

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:10.50,0:00:14.20,Default,,0,0,0,,{\\an8\\pos(192,20)}Привет, Джек!\\NКак дела, друг?
"""
        vtt = convert_ass_to_webvtt(ass_sample, offset_sec=0.5)
        self.assertTrue(vtt.startswith("WEBVTT"))
        self.assertIn("00:00:10.000 --> 00:00:13.700", vtt)
        self.assertIn("Привет, Джек!\nКак дела, друг?", vtt)
        self.assertNotIn("\\an8", vtt)

        auto_vtt = convert_any_subtitle_to_webvtt(ass_sample.encode("utf-8"))
        self.assertIn("Привет, Джек!", auto_vtt)

        # SubtitleSearchService prioritizes Russian when lang='ru'
        sub_svc = SubtitleSearchService(_FakeNetForSubs(), _FakeStremioForSubs())
        res_ru = sub_svc.search_subtitles(title="Oppenheimer", year=2023, media_type="movie", lang="ru")
        self.assertTrue(res_ru["ok"])
        self.assertGreaterEqual(len(res_ru["subtitles"]), 3)
        self.assertTrue(res_ru["subtitles"][0]["lang"].startswith("Русский"))
        self.assertTrue(res_ru["subtitles"][0]["url"].startswith("/api/proxy-vtt?url="))

    def test_batch_downloads_and_safe_deferred_auto_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            resolved_calls = []

            def _fake_resolver(snap):
                resolved_calls.append((snap["season"], snap["episode"]))
                return {"stream_url": f"https://cdn.example/s{snap['season']}e{snap['episode']}.mp4", "subtitles": []}

            mgr = OfflineDownloadManager(
                data_dir=tmp,
                remux_engine=_DummyRemux(),
                net_client=None,
                stream_resolver=_fake_resolver,
                start_workers=False,
            )
            batch_res = mgr.enqueue_batch_series(
                item_id="kin_777888",
                kinorium_id="777888",
                rezka_id="46089",
                title="Разделение",
                orig_title="Severance",
                year=2022,
                season=1,
                episodes=[1, 2, 3],
                episode_titles={"1": "Хорошие новости", "2": "Половина петли"},
                quality="1080p",
                studio="HDrezka Studio",
                translator_id="56",
                max_season_episode=9,
            )
            self.assertEqual(batch_res["queued_count"], 3)
            self.assertEqual(len(batch_res["items"]), 3)

            # Mark episode 1 as completed on disk
            ep1_did = batch_res["items"][0]["download_id"]
            ep1_dir = os.path.join(mgr.downloads_dir, ep1_did)
            os.makedirs(ep1_dir, exist_ok=True)
            ep1_mp4 = os.path.join(ep1_dir, "video.mp4")
            with open(ep1_mp4, "wb") as vf:
                vf.write(b"\x00" * 65536)
            with mgr._lock:
                mgr._items[ep1_did]["status"] = "completed"
                mgr._items[ep1_did]["file_size"] = 65536
                mgr._save_index_locked()

            # Enable auto_cleanup_watched + auto_download_next
            mgr.set_prefs(auto_cleanup_watched=True, auto_download_next=True)

            # Scrobble episode 3 as completed too so episode 4 gets auto-queued,
            # while testing active offline playback protection on episode 1
            scrobble_ep1 = mgr.handle_watched_scrobble(
                item_id="kin_777888",
                kinorium_id="777888",
                rezka_id="46089",
                title="Разделение",
                media_type="series",
                season=1,
                episode=1,
                is_active_offline_playback=True,
                active_download_id=ep1_did,
            )
            self.assertIn(ep1_did, scrobble_ep1["deferred"])
            self.assertTrue(os.path.isfile(ep1_mp4), "Active offline MP4 must NOT be unlinked while playing")

            # Once player closes or switches episodes, sweep_pending_cleanups deletes it safely
            swept = mgr.sweep_pending_cleanups()
            self.assertIn(ep1_did, swept["deleted_ids"])
            self.assertFalse(os.path.isfile(ep1_mp4))

            # Scrobble episode 3 -> should auto-enqueue episode 4
            scrobble_ep3 = mgr.handle_watched_scrobble(
                item_id="kin_777888",
                kinorium_id="777888",
                rezka_id="46089",
                title="Разделение",
                media_type="series",
                season=1,
                episode=3,
                is_active_offline_playback=False,
            )
            self.assertIsNotNone(scrobble_ep3["queued_next"])
            self.assertEqual(scrobble_ep3["queued_next"]["episode"], 4)

    def test_macos_standalone_bundle_and_notification_invariants(self):
        with open(os.path.join(ROOT_DIR, "macos", "VelariumApp.swift"), "r", encoding="utf-8") as sf:
            swift_src = sf.read()
        self.assertIn("import UserNotifications", swift_src)
        self.assertIn('case "notifyEpisode":', swift_src)
        self.assertIn("CINEFLOW_DATA_DIR", swift_src)
        self.assertIn("Application Support", swift_src)

        with open(os.path.join(ROOT_DIR, "macos", "build_macos_app.py"), "r", encoding="utf-8") as bf:
            build_src = bf.read()
        self.assertIn("Velarium.dmg", build_src)
        self.assertIn("hdiutil", build_src)
        self.assertIn('os.path.join(RESOURCES_DIR, "app")', build_src)

    def test_remux_zero_lag_av_sync_and_audio_offset(self):
        from backend.remuxer import RemuxStreamEngine

        eng = RemuxStreamEngine(ROOT_DIR)
        cmd_seek = eng.build_remux_command(
            source_url="http://127.0.0.1:8090/stream/movie.mkv",
            audio_index=1,
            start_sec=42.5,
            video_codec="hevc",
            channels=6,
            audio_codec="eac3",
            force_h264=False,
            audio_offset_sec=0.0,
        )
        self.assertIn("delay_moov+default_base_moof", cmd_seek)
        self.assertNotIn("frag_keyframe+delay_moov+default_base_moof", cmd_seek)
        self.assertNotIn("frag_keyframe+empty_moov+default_base_moof", cmd_seek)
        self.assertIn("-frag_duration", cmd_seek)
        self.assertEqual(cmd_seek[cmd_seek.index("-frag_duration") + 1], "200000")
        self.assertIn("-probesize", cmd_seek)
        self.assertIn("-analyzeduration", cmd_seek)
        self.assertIn("-avoid_negative_ts", cmd_seek)
        self.assertIn("make_zero", cmd_seek)
        self.assertIn("-noaccurate_seek", cmd_seek)
        self.assertNotIn("+genpts+discardcorrupt", cmd_seek)
        af_val = cmd_seek[cmd_seek.index("-af") + 1]
        self.assertIn("aresample=async=1", af_val)
        self.assertIn("pan=stereo", af_val)

        # Negative audio offset advances lagging audio even on 2ch AAC
        cmd_adv = eng.build_remux_command(
            source_url="http://127.0.0.1:8090/stream/movie.mp4",
            audio_index=0,
            start_sec=0.0,
            video_codec="hevc",
            channels=2,
            audio_codec="aac",
            audio_offset_sec=-0.15,
        )
        self.assertIn("-af", cmd_adv)
        self.assertIn("atrim=start=0.150,asetpts=PTS-STARTPTS", cmd_adv[cmd_adv.index("-af") + 1])

        # Positive audio offset delays early audio
        cmd_del = eng.build_remux_command(
            source_url="http://127.0.0.1:8090/stream/movie.mkv",
            audio_index=0,
            start_sec=0.0,
            video_codec="hevc",
            channels=2,
            audio_codec="ac3",
            audio_offset_sec=0.2,
        )
        self.assertIn("-af", cmd_del)
        self.assertIn("adelay=200:all=1", cmd_del[cmd_del.index("-af") + 1])

    def test_backup_4k_series_episodes_and_torrserver_file_resolution(self):
        from backend.backup_stream import BackupStreamingEngine

        files_with_sample = [
            {"id": 1, "path": "Show.S01.2160p/00-Sample.mkv", "length": 15 * 1024 * 1024},
            {"id": 2, "path": "Show.S01.2160p/Extras/Featurette.mkv", "length": 120 * 1024 * 1024},
            {"id": 3, "path": "Show.S01.2160p/Show.S01E01.2160p.BDRemux.mkv", "length": 6 * 1024 * 1024 * 1024},
            {"id": 4, "path": "Show.S01.2160p/Show.S01E02.2160p.BDRemux.mkv", "length": 6 * 1024 * 1024 * 1024},
            {"id": 5, "path": "Show.S01.2160p/Show.S01E03.2160p.BDRemux.mkv", "length": 6 * 1024 * 1024 * 1024},
        ]
        matched_ep1 = BackupStreamingEngine._match_episode_from_files(
            files_with_sample, "path", "id", "length", "series", 1, 1
        )
        matched_ep2 = BackupStreamingEngine._match_episode_from_files(
            files_with_sample, "path", "id", "length", "series", 1, 2
        )
        self.assertEqual(matched_ep1, 3)
        self.assertEqual(matched_ep2, 4)

        class _FakeNetB4K:
            p2p_strict = False

            def request(self, url, **kwargs):
                return 200, "[]", {}

        class _FakeRezkaB4K:
            def get_streams_for_title(self, **kwargs):
                return {
                    "default_stream_url": "https://cdn.example/s1e2.mp4",
                    "seasons_map": {"1": [1, 2, 3, 4, 5], "2": [1, 2, 3]},
                    "episodes_titles": {"1:1": "Пилот", "1:2": "Вторая серия"},
                    "episodes_meta": {"1:2": {"title": "Вторая серия", "air_date": "12 мая 2025"}},
                }

        class _FakeStremioB4K:
            def get_streams_for_title(self, **kwargs):
                return {
                    "imdb_id": "tt11280740",
                    "streams": [
                        {
                            "info_hash": "a" * 40,
                            "title": "Severance S01 2160p UHD BDRemux",
                            "filename": "Severance.S01E02.2160p.mkv",
                            "quality": "4K UHD BDRemux",
                            "quality_rank": 420,
                            "seeders": 35,
                            "size": "48.5 ГБ",
                            "languages": ["RU", "EN"],
                            "has_russian": True,
                            "magnet": "magnet:?xt=urn:btih:" + ("a" * 40),
                        }
                    ],
                    "subtitles": [],
                }

        b4k = BackupStreamingEngine(_FakeNetB4K(), _FakeRezkaB4K(), base_dir=ROOT_DIR)
        b4k.ensure_local_torrserver = lambda: True
        b4k._is_torrserver_alive = lambda: True
        b4k._fetch_torrserver_file_stats = lambda magnet, wait_metadata_sec=0.0: files_with_sample

        search_res = b4k.search_releases(
            title="Разделение",
            orig_title="Severance",
            year=2022,
            media_type="series",
            season=1,
            episode=2,
            stremio_engine=_FakeStremioB4K(),
            lang="ru",
        )
        self.assertEqual(search_res["imdb_id"], "tt11280740")
        self.assertEqual(search_res["seasons_map"]["1"], [1, 2, 3, 4, 5])
        self.assertEqual(search_res["seasons_map"]["2"], [1, 2, 3])
        self.assertEqual(search_res["episodes_titles"]["1:2"], "Вторая серия")

        resolved_torr = b4k.resolve_torrserver_stream(
            magnet="magnet:?xt=urn:btih:" + ("a" * 40),
            media_type="series",
            season=1,
            episode=2,
            lang="ru",
        )
        self.assertTrue(resolved_torr["ok"])
        self.assertEqual(resolved_torr["file_index"], 4)
        self.assertIn("index=4&play", resolved_torr["stream_url"])
        self.assertEqual(len(resolved_torr["video_files"]), 3)
        self.assertEqual([vf["episode"] for vf in resolved_torr["video_files"]], [1, 2, 3])

        # Verify UI layout & low-latency WebAudio invariants
        with open(os.path.join(ROOT_DIR, "public", "index.html"), "r", encoding="utf-8") as hf:
            html_src = hf.read()
        self.assertIn('id="gear-audio-offset-row"', html_src)
        self.assertLess(
            html_src.index('id="episodes-bottom-panel"'),
            html_src.index('id="backup-releases-panel"'),
            "Episodes panel must sit directly below the video stage above 4K torrent cards",
        )
        with open(os.path.join(ROOT_DIR, "public", "js", "audio-dsp.js"), "r", encoding="utf-8") as af:
            adsp_src = af.read()
        self.assertIn('latencyHint: "interactive"', adsp_src)

    def test_stremio_fast_remux_and_non_overlapping_episode_panel_scroll(self):
        from backend.backup_stream import BackupStreamingEngine
        from backend.stremio import StremioAddonEngine

        class _FakeNetStremio:
            p2p_strict = False

            def request(self, url, **kwargs):
                return 200, "{}", {}

        class _FakeRezkaStremio:
            def get_streams_for_title(self, **kwargs):
                return {}

        with tempfile.TemporaryDirectory() as tmp:
            b4k = BackupStreamingEngine(_FakeNetStremio(), _FakeRezkaStremio(), base_dir=tmp)
            b4k.ensure_local_torrserver = lambda: True
            b4k._is_torrserver_alive = lambda: True
            b4k._fetch_torrserver_file_stats = lambda magnet, wait_metadata_sec=0.0: [
                {"id": 1, "path": "See.S01/00-Sample.mkv", "length": 12 * 1024 * 1024},
                {"id": 2, "path": "See.S01/See.S01E01.1080p.mkv", "length": 3 * 1024 * 1024 * 1024},
                {"id": 3, "path": "See.S01/See.S01E02.1080p.mkv", "length": 3 * 1024 * 1024 * 1024},
            ]
            st_eng = StremioAddonEngine(tmp, b4k)
            res_ep2 = st_eng.resolve_stream_to_playable_url(
                magnet="magnet:?xt=urn:btih:" + ("b" * 40),
                filename_hint="",
                file_idx=None,
                media_type="series",
                season=1,
                episode=2,
                lang="ru",
            )
            self.assertTrue(res_ep2["ok"])
            self.assertEqual(res_ep2["torr_index"], 3)
            self.assertIn("index=3&play", res_ep2["stream_url"])
            self.assertEqual(len(res_ep2["video_files"]), 2)

            # Verify Cinemeta series meta uses nested {season: {ep: title}} matching player.js
            st_eng._http_get_json = lambda url, timeout=6.0: {
                "meta": {
                    "videos": [
                        {"season": 1, "episode": 1, "name": "Godflame", "released": "2019-11-01T00:00:00.000Z"},
                        {"season": 1, "episode": 2, "name": "Message in a Bottle", "released": "2019-11-01T00:00:00.000Z"},
                    ]
                }
            }
            cmeta = st_eng.fetch_cinemeta_series_meta("tt7949218")
            self.assertEqual(cmeta["episodes_titles"]["1"]["2"], "Message in a Bottle")
            self.assertEqual(cmeta["episodes_meta"]["1"]["1"]["air_date"], "2019-11-01")

        # Cold-probe fallback in player.js must never hardcode videoCodec: "hevc" (which breaks H.264 streams)
        with open(os.path.join(ROOT_DIR, "public", "js", "player.js"), "r", encoding="utf-8") as pf:
            player_src = pf.read()
        self.assertNotIn('videoCodec: "hevc"', player_src)

        # Episode panel must never ride over the video stage on scroll in Stremio or 4K Remux
        with open(
            os.path.join(ROOT_DIR, "public", "css", "video-controls-and-person.css"),
            "r",
            encoding="utf-8",
        ) as vcf:
            vc_css = vcf.read()
        stage_Rule_match = re.search(
            r"\.atv-modal-overlay:not\(\.mini-player-mode\):not\(\.pip-background-mode\)\s+\.atv-video-stage-wrap\s*\{([^}]+)\}",
            vc_css,
        )
        ep_rule_match = re.search(r"#episodes-bottom-panel\s*\{([^}]+)\}", vc_css)
        self.assertIsNotNone(stage_Rule_match)
        self.assertIsNotNone(ep_rule_match)
        self.assertNotIn("sticky", stage_Rule_match.group(1))
        stage_z = int(re.search(r"z-index:\s*(\d+)", stage_Rule_match.group(1)).group(1))
        ep_z = int(re.search(r"z-index:\s*(\d+)", ep_rule_match.group(1)).group(1))
        self.assertGreater(
            stage_z,
            ep_z,
            "Video stage wrapper z-index must always exceed #episodes-bottom-panel so episodes never overlap video",
        )

    def test_remote_language_matches_selected_program_language(self) -> None:
        from backend.remote_control import DesktopRemoteBroker

        broker = DesktopRemoteBroker("abcdef123456")
        self.assertEqual(broker.get_snapshot()["state"]["app_lang"], "ru")
        self.assertFalse(broker.get_snapshot()["desktop_online"])

        v_before = broker.get_snapshot()["seq"]
        broker.set_app_lang("en")
        snap_en = broker.get_snapshot()
        self.assertEqual(snap_en["state"]["app_lang"], "en")
        self.assertGreater(snap_en["seq"], v_before)
        # set_app_lang must not fake desktop_online heartbeat when no desktop window is connected
        self.assertFalse(snap_en["desktop_online"])

        # Verify server pairing URL & /api/remote/state reflect APP_PREFS["app_lang"]
        import server as srv

        prev_lang = srv.APP_PREFS.get("app_lang", "ru")
        try:
            srv.APP_PREFS["app_lang"] = "en"
            pair_en = srv._build_remote_pairing_payload(include_secret=True)
            self.assertEqual(pair_en["app_lang"], "en")
            if pair_en.get("remote_url"):
                self.assertIn("lang=en", pair_en["remote_url"])

            srv.APP_PREFS["app_lang"] = "ru"
            pair_ru = srv._build_remote_pairing_payload(include_secret=True)
            self.assertEqual(pair_ru["app_lang"], "ru")
            if pair_ru.get("remote_url"):
                self.assertIn("lang=ru", pair_ru["remote_url"])
        finally:
            srv.APP_PREFS["app_lang"] = prev_lang

        # Verify mobile remote controller localizes brand title and syncs dynamically with desktop app_lang
        with open(os.path.join(ROOT_DIR, "public", "js", "remote.js"), "r", encoding="utf-8") as rf:
            remote_src = rf.read()
        self.assertIn("localizeRemoteShellStaticDOM", remote_src)
        self.assertIn("syncRemoteLanguageWithDesktop", remote_src)
        self.assertIn('id="rm-brand-title"', remote_src)
        self.assertIn("Пульт Velarium", remote_src)

    def test_remote_fullscreen_and_rating_controls(self) -> None:
        from backend.remote_control import DesktopRemoteBroker

        broker = DesktopRemoteBroker("abcdef123456")
        r1 = broker.enqueue_command(
            action="rate_active",
            payload={"scope": "episode", "score": 9, "season": 1, "episode": 2},
            client_id="iphone_rate",
            device_name="iPhone",
            client_ip="192.168.1.55",
        )
        self.assertTrue(r1["ok"])
        r2 = broker.enqueue_command(
            action="toggle_watched",
            payload={},
            client_id="iphone_rate",
            device_name="iPhone",
            client_ip="192.168.1.55",
        )
        self.assertTrue(r2["ok"])
        r3 = broker.enqueue_command(
            action="toggle_fullscreen",
            payload={},
            client_id="iphone_rate",
            device_name="iPhone",
            client_ip="192.168.1.55",
        )
        self.assertTrue(r3["ok"])
        polled = broker.wait_for_commands(since_id=0, timeout=0.1)
        actions = [c["action"] for c in polled["commands"]]
        self.assertEqual(actions, ["rate_active", "toggle_watched", "toggle_fullscreen"])

        with open(os.path.join(ROOT_DIR, "public", "js", "player.js"), "r", encoding="utf-8") as pf:
            player_src = pf.read()
        self.assertIn("export function setPseudoStageFullscreen", player_src)
        self.assertIn("is-stage-pseudo-fullscreen", player_src)
        self.assertIn("export async function rateActivePlayerTitle", player_src)
        self.assertIn("export async function toggleActivePlayerWatched", player_src)

        with open(os.path.join(ROOT_DIR, "public", "js", "features.js"), "r", encoding="utf-8") as ff:
            feat_src = ff.read()
        self.assertIn("export function executeRemoteDpadCommand", feat_src)
        self.assertIn("export function executeRemoteBackAction", feat_src)

        with open(os.path.join(ROOT_DIR, "public", "js", "remote.js"), "r", encoding="utf-8") as rf:
            remote_src = rf.read()
        self.assertIn('id="rm-rating-group"', remote_src)
        self.assertIn('id="rm-rate-stars-grid"', remote_src)
        self.assertIn('id="rm-btn-fs"', remote_src)
        self.assertIn('id="rm-btn-pip"', remote_src)
        self.assertNotIn('id="rm-btn-mini"', remote_src)
        self.assertIn("executeRemoteDpadCommand(dir)", remote_src)
        self.assertNotIn('new KeyboardEvent("keydown"', remote_src)
        self.assertIn('case "rate_active":', remote_src)
        self.assertIn('case "toggle_watched":', remote_src)
        self.assertIn("episode_rating:", remote_src)
        self.assertIn("user_rating:", remote_src)

        with open(
            os.path.join(ROOT_DIR, "public", "css", "video-controls-and-person.css"),
            "r",
            encoding="utf-8",
        ) as vcf:
            vc_css = vcf.read()
        self.assertIn("html.is-stage-pseudo-fullscreen #video-stage", vc_css)

    def test_default_browser_and_gecko_kinorium_auth(self) -> None:
        import sqlite3
        import urllib.parse
        from windows.kinorium_login_webview import (
            _classify_browser_family,
            _format_cdp_cookies,
            _has_valid_auth_cookie,
            extract_cookie_user_id,
            read_gecko_kinorium_cookies,
        )

        self.assertEqual(_classify_browser_family("ZenURL-123 /Applications/Zen.app/Contents/MacOS/zen"), "gecko")
        self.assertEqual(_classify_browser_family("FirefoxURL-308046B0AF4A39CB"), "gecko")
        self.assertEqual(_classify_browser_family("ChromeHTML chrome.exe"), "chromium")
        self.assertEqual(_classify_browser_family("BraveHTML brave.exe"), "chromium")

        auth_json = json.dumps({"email": "second@example.com", "user_id": "998877", "ukey": "abc", "signature": "xyz"})
        encoded_auth = urllib.parse.quote(auth_json)

        # Ensure 'deleted' Set-Cookie markers are ignored and never shadow real auth/session cookies
        cdp_list = [
            {"domain": ".kinorium.com", "name": "auth", "value": "deleted"},
            {"domain": ".kinorium.com", "name": "session", "value": "deleted"},
            {"domain": ".kinorium.com", "name": "auth", "value": encoded_auth},
            {"domain": ".kinorium.com", "name": "session", "value": "real_session_token_12345"},
            {"domain": "ru.kinorium.com", "name": "PHPSESSID", "value": "php_sess_998877"},
        ]
        formatted = _format_cdp_cookies(cdp_list)
        self.assertIn(f"auth={encoded_auth}", formatted)
        self.assertIn("session=real_session_token_12345", formatted)
        self.assertNotIn("=deleted", formatted)
        self.assertEqual(extract_cookie_user_id(formatted), "998877")
        self.assertTrue(_has_valid_auth_cookie(formatted, "998877"))
        self.assertFalse(_has_valid_auth_cookie(formatted, "51670"))
        self.assertFalse(_has_valid_auth_cookie("PHPSESSID=anon_only_12345; CONTENT_LANG=ru", "998877"))

        # Test reading Gecko (Zen Browser / Firefox) cookies.sqlite
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = os.path.join(tmp_dir, "cookies.sqlite")
            conn = sqlite3.connect(db_path)
            conn.execute(
                "CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, lastAccessed INTEGER, expiry INTEGER)"
            )
            now_exp = int(time.time()) + 86400 * 30
            conn.execute(
                "INSERT INTO moz_cookies VALUES (?, ?, ?, ?, ?)",
                ("auth", encoded_auth, ".kinorium.com", 1700000005, now_exp),
            )
            conn.execute(
                "INSERT INTO moz_cookies VALUES (?, ?, ?, ?, ?)",
                ("session", "gecko_sess_abcdef123456", ".kinorium.com", 1700000006, now_exp),
            )
            conn.commit()
            conn.close()

            parsed_gecko = read_gecko_kinorium_cookies(db_path)
            self.assertIsNotNone(parsed_gecko)
            assert parsed_gecko is not None
            self.assertEqual(parsed_gecko["user_id"], "998877")
            self.assertIn(f"auth={encoded_auth}", parsed_gecko["cookie"])
            self.assertIn("session=gecko_sess_abcdef123456", parsed_gecko["cookie"])

    def test_second_account_two_way_sync_and_cookie_isolation(self) -> None:
        import urllib.parse
        from backend.doh import DoHSplitNetworkClient
        from backend.kinorium import KinoriumService

        auth_acc1 = urllib.parse.quote(json.dumps({"user_id": "51670", "ukey": "u1", "signature": "s1"}))
        auth_acc2 = urllib.parse.quote(json.dumps({"user_id": "777888", "ukey": "u2", "signature": "s2"}))

        with tempfile.TemporaryDirectory() as tmp_dir:
            svc = KinoriumService(DoHSplitNetworkClient(), storage_dir=tmp_dir)
            svc.state["account"]["connected"] = True
            svc.state["account"]["user_id"] = "51670"
            svc.state["account"]["session_cookie"] = f"auth={auth_acc1}; session=sess1"
            svc._series_episodes_cache["100500"] = {
                "ts": time.time(),
                "user_id": "51670",
                "is_authed": True,
                "episodes": {(1, 1): {"ep_id": "901", "season": 1, "episode": 1, "watched": True, "rating": 8}},
                "season_buttons": {},
            }

            # Mock network responses for Account 2 (777888)
            pushed_actions = []

            def fake_fetch_html(url: str, extra_headers=None) -> str:
                if "/user/777888/" in url and "following" not in url and "ratings" not in url:
                    ck_now = svc.state["account"].get("session_cookie", "")
                    uid_in_page = "777888" if "777888" in urllib.parse.unquote(ck_now) else ""
                    return (
                        f"<html><head><title>Second Tester - Kinorium</title></head>"
                        f"<body><script>USER_ID = '{uid_in_page}';</script>"
                        f"<div data-user_id='777888'></div></body></html>"
                    )
                if "/episodes/" in url:
                    return (
                        "<html><body><script>USER_ID = '777888';</script>"
                        "<li class='seasonItem__episodes-item'><span data-movieId='901'>1 s: 1 e</span>"
                        "<div class='statusWidgetData' data-status='done' data-rating='10'></div></li>"
                        "</body></html>"
                    )
                return "<html></html>"

            svc.fetch_kinorium_html = fake_fetch_html  # type: ignore
            svc.fetch_status_list_ajax = lambda uid, st, max_pages=2: {}  # type: ignore
            svc._verify_recent_watchlist_online_availability = lambda items: None  # type: ignore

            def fake_sync_remote(action: str, item_id: str, **kwargs) -> bool:
                pushed_actions.append((action, item_id, kwargs.get("resolved_kid"), kwargs.get("score")))
                return True

            svc._sync_to_kinorium_remote = fake_sync_remote  # type: ignore

            # 1. Switching to Account 2 by ID without providing a new cookie must NOT leak Account 1's cookie
            res_no_ck = svc.sync_user_profile("777888")
            self.assertEqual(res_no_ck["user_id"], "777888")
            self.assertEqual(res_no_ck["display_name"], "Second Tester")
            self.assertEqual(svc.state["account"]["session_cookie"], "")
            self.assertNotIn("100500", svc._series_episodes_cache)

            # 2. Local ratings/watched/watchlist added on Account 2 get pushed when Account 2's cookie is connected
            svc.state["ratings"]["kin_2736801"] = {"score": 9, "title": "Тест", "orig_title": "Test"}
            svc.state["watchlist"].append("kin_1694059")
            res_with_ck = svc.sync_user_profile("51670", session_cookie=f"auth={auth_acc2}; session=sess2; auth=deleted")
            # Even though '51670' was passed as old input, auth_acc2 has user_id=777888 so it stays on 777888
            self.assertEqual(res_with_ck["user_id"], "777888")
            self.assertIn(f"auth={auth_acc2}", svc.state["account"]["session_cookie"])
            self.assertNotIn("deleted", svc.state["account"]["session_cookie"])
            self.assertTrue(any(a[0] == "rate" and a[2] == "2736801" and a[3] == 9 for a in pushed_actions))
            self.assertTrue(any(a[0] == "watchlist_add" and a[2] == "1694059" for a in pushed_actions))

            # 3. English episode notation ('1 s: 1 e') and authenticated USER_ID check work on Account 2
            ep_state = svc.fetch_series_episodes_state("100500", item_id="kin_100500", force_refresh=True)
            self.assertTrue(ep_state["is_authed"])
            self.assertIn((1, 1), ep_state["episodes"])
            self.assertEqual(ep_state["episodes"][(1, 1)]["rating"], 10)

    def test_security_vault_encryption_pin_lockout_cors_and_body_limits(self) -> None:
        import io
        from backend.profiles import ProfileManager
        from backend.storage_db import VelariumStorageDB, LocalVaultCipher

        with tempfile.TemporaryDirectory() as tmp_dir:
            # 1. LocalVaultCipher & SQLite encryption-at-rest for sensitive keys
            db = VelariumStorageDB(tmp_dir)
            vault_key_path = os.path.join(tmp_dir, ".vault_key")
            self.assertTrue(os.path.isfile(vault_key_path))
            if os.name != "nt":
                mode_bits = os.stat(vault_key_path).st_mode & 0o777
                self.assertEqual(mode_bits, 0o600)

            db.set_kv(
                "server",
                "settings",
                {
                    "app_lang": "ru",
                    "remote_pair_token": "pair_tok_sec_77",
                    "backup_stream": {"mode": "debrid", "debrid_api_key": "rd_secret_token_999"},
                },
            )
            db.save_profile_state(
                "main",
                {
                    "account": {
                        "connected": True,
                        "user_id": "51670",
                        "session_cookie": "auth=super_secret_cookie_123; session=xyz",
                    }
                },
            )
            # Raw SQLite rows must NOT contain plaintext secrets
            raw_kv_row = db._conn.execute(
                "SELECT value_json FROM kv_store WHERE namespace='server' AND key='settings'"
            ).fetchone()[0]
            self.assertNotIn("rd_secret_token_999", raw_kv_row)
            self.assertNotIn("pair_tok_sec_77", raw_kv_row)
            self.assertIn(LocalVaultCipher.PREFIX, raw_kv_row)

            raw_prof_row = db._conn.execute(
                "SELECT value_json FROM profile_state WHERE profile_id='main' AND section_key='account'"
            ).fetchone()[0]
            self.assertNotIn("super_secret_cookie_123", raw_prof_row)
            self.assertIn(LocalVaultCipher.PREFIX, raw_prof_row)

            # Transparent decryption on read
            dec_kv = db.get_kv("server", "settings")
            self.assertEqual(dec_kv["backup_stream"]["debrid_api_key"], "rd_secret_token_999")
            self.assertEqual(dec_kv["remote_pair_token"], "pair_tok_sec_77")
            dec_prof = db.load_profile_state("main")
            assert dec_prof is not None
            self.assertEqual(dec_prof["account"]["session_cookie"], "auth=super_secret_cookie_123; session=xyz")

            # 2. Kids PIN brute-force rate-limiting (5 failed non-empty guesses -> 30s lockout)
            pm = ProfileManager(data_dir=tmp_dir)
            pm.save_profile(profile_id="kids", name="Детский", kids_mode=True, kids_pin="2580")
            pm.switch_profile("kids")
            self.assertTrue(pm.is_active_kids_pin_locked())

            # Empty probes do not trigger lockout
            for _ in range(10):
                self.assertFalse(pm.verify_active_kids_pin(""))
            self.assertEqual(pm.get_pin_lockout_remaining("kids"), 0.0)

            # 5 wrong PIN guesses trigger lockout
            for attempt in range(5):
                self.assertFalse(pm.verify_active_kids_pin(f"000{attempt}"))
            self.assertGreater(pm.get_pin_lockout_remaining("kids"), 10.0)

            # Even the right PIN is rejected while locked out
            self.assertFalse(pm.verify_active_kids_pin("2580"))
            with self.assertRaises(PermissionError):
                pm.switch_profile("main", pin="2580")

            # After resetting lockout, the right PIN works again
            pm.reset_pin_attempts("kids")
            self.assertEqual(pm.get_pin_lockout_remaining("kids"), 0.0)
            self.assertTrue(pm.verify_active_kids_pin("2580"))
            pm.switch_profile("main", pin="2580")

        # 3. Cross-origin request blocking, body size limit, and security headers on CinemaRequestHandler
        import server

        class _DummyHandler(server.CinemaRequestHandler):
            def __init__(self, method: str, path: str, headers_dict: dict, body_bytes: bytes = b""):
                self.command = method
                self.path = path
                self.request_version = "HTTP/1.1"
                self.client_address = ("127.0.0.1", 55123)
                self.headers = headers_dict  # type: ignore
                self.rfile = io.BytesIO(body_bytes)
                self.wfile = io.BytesIO()
                self.sent_status = 0
                self.sent_headers = {}

            def send_response(self, code, message=None):
                self.sent_status = code

            def send_header(self, keyword, value):
                self.sent_headers[keyword] = value

            def end_headers(self):
                pass

        # Evil cross-site origin must be blocked with 403 on GET /api/* and POST /api/*
        evil_get = _DummyHandler("GET", "/api/settings", {"Origin": "https://evil-tracker.example.com"})
        evil_get.do_GET()
        self.assertEqual(evil_get.sent_status, 403)
        self.assertNotEqual(evil_get.sent_headers.get("Access-Control-Allow-Origin"), "*")
        self.assertEqual(evil_get.sent_headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(evil_get.sent_headers.get("X-Frame-Options"), "SAMEORIGIN")
        self.assertEqual(evil_get.sent_headers.get("Referrer-Policy"), "no-referrer")

        # Trusted loopback origin is allowed
        trusted_get = _DummyHandler("GET", "/api/system/status", {"Origin": "http://127.0.0.1:8765"})
        trusted_get.do_GET()
        self.assertEqual(trusted_get.sent_status, 200)
        self.assertEqual(trusted_get.sent_headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:8765")

        # Oversized POST body (> 512 KB) is rejected with 413 Payload Too Large
        oversized_post = _DummyHandler(
            "POST",
            "/api/settings",
            {"Origin": "http://127.0.0.1:8765", "Content-Length": str(2 * 1024 * 1024)},
            b"{}",
        )
        oversized_post.do_POST()
        self.assertEqual(oversized_post.sent_status, 413)

        # 4. Stremio addon manifest SSRF protection & Auxiliary download asset SSRF protection
        from backend.downloads import OfflineDownloadManager
        from backend.stremio import StremioAddonEngine

        self.assertFalse(StremioAddonEngine.is_safe_public_http_url("http://127.0.0.1:8765/manifest.json"))
        self.assertFalse(StremioAddonEngine.is_safe_public_http_url("http://192.168.1.1/manifest.json"))
        self.assertFalse(StremioAddonEngine.is_safe_public_http_url("http://169.254.169.254/latest/meta-data/"))
        self.assertEqual(StremioAddonEngine.normalize_manifest_url("http://127.0.0.1:8080/manifest.json"), "")
        self.assertTrue(
            StremioAddonEngine.is_safe_public_http_url("https://v3-cinemeta.strem.io/manifest.json")
        )
        self.assertFalse(OfflineDownloadManager._is_safe_aux_url("http://127.0.0.1:8765/api/settings"))
        self.assertFalse(OfflineDownloadManager._is_safe_aux_url("http://10.0.0.5/poster.jpg"))
        self.assertTrue(OfflineDownloadManager._is_safe_aux_url("https://images.kinorium.com/user/200/51670.jpg"))

        # 5. Gzip decompression bomb cap in DoHSplitNetworkClient._decompress
        import gzip
        from backend.doh import DoHSplitNetworkClient

        compressed_sample = gzip.compress(b"A" * 2048)
        capped_out = DoHSplitNetworkClient._decompress(compressed_sample, "gzip", max_bytes=512)
        self.assertEqual(len(capped_out), 512)

        # 6. Kinorium /user/200/ avatar URL extraction and automatic upgrade from legacy /user/180/ or /user/64/
        from backend.kinorium import KinoriumService

        av_url = KinoriumService._extract_profile_avatar_url(
            "<html><body><img src='https://images.kinorium.com/user/64/51670.jpg?20191230'></body></html>",
            "51670",
        )
        self.assertEqual(av_url, "https://images.kinorium.com/user/200/51670.jpg?20191230")

        # 7. Non-loopback LAN client without remote pairing key blocked on administrative/destructive endpoints
        lan_del = _DummyHandler(
            "POST",
            "/api/profiles/delete",
            {"Origin": "http://192.168.1.50:8765", "Content-Length": "18"},
            b'{"id":"secondary"}',
        )
        lan_del.client_address = ("192.168.1.99", 54321)
        lan_del.do_POST()
        self.assertEqual(lan_del.sent_status, 403)

    def test_premieres_and_watching_exclude_watched_movies_and_caught_up_series(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            net = _FakeNetForRezka({})
            kin = KinoriumService(net, storage_dir=tmpdir)
            # 1. Watched movie in remote_watching_items & remote_watched_items -> must be excluded from watching & premieres
            kin.state["remote_watched_ids"] = ["1001", "1004"]
            kin.state["remote_watched_items"]["1001"] = {
                "kinorium_id": "1001",
                "ru_title": "Дюна: Часть вторая",
                "orig_title": "Dune: Part Two",
                "year": 2024,
                "media_type": "movie",
            }
            kin.state["remote_watching_ids"] = ["1001", "1002", "1003", "1004", "1005"]
            kin.state["remote_watching_items"] = {
                "1001": {
                    "kinorium_id": "1001",
                    "ru_title": "Дюна: Часть вторая",
                    "orig_title": "Dune: Part Two",
                    "year": 2024,
                    "media_type": "movie",
                },
                # 2. Series where all released episodes (1..8) are watched -> must be excluded from watching & premieres
                "1002": {
                    "kinorium_id": "1002",
                    "ru_title": "Чужой: Земля",
                    "orig_title": "Alien: Earth",
                    "year": 2025,
                    "media_type": "series",
                    "watched_episodes": {"1": [1, 2, 3, 4, 5, 6, 7, 8]},
                },
                # 3. Series where user watched 1..4, and 1x6 is out -> must stay in watching with has_new_episode=True
                "1003": {
                    "kinorium_id": "1003",
                    "ru_title": "Рыцарь Семи Королевств",
                    "orig_title": "A Knight of the Seven Kingdoms",
                    "year": 2026,
                    "media_type": "series",
                    "watched_episodes": {"1": [1, 2, 3, 4]},
                },
                # 4. Series rated on Kinorium (in remote_watched_ids) where user watched 4x1..6, and 4x10 is out -> must stay in watching!
                "1004": {
                    "kinorium_id": "1004",
                    "ru_title": "Тед Лассо",
                    "orig_title": "Ted Lasso",
                    "year": 2020,
                    "media_type": "series",
                    "watched_episodes": {"4": [1, 2, 3, 4, 5, 6]},
                },
                # 5. Series where user watched Season 2 on Kinorium, while HDRezka only lists Season 1 -> caught up, excluded!
                "1005": {
                    "kinorium_id": "1005",
                    "ru_title": "Кайдзю № 8",
                    "orig_title": "Kaiju No. 8",
                    "year": 2024,
                    "media_type": "series",
                    "watched_episodes": {"1": list(range(1, 13)), "2": list(range(1, 12))},
                },
            }
            kin.state["series_live_meta"] = {
                "kin_1002": {
                    "id": "kin_1002",
                    "kinorium_id": "1002",
                    "title": "Чужой: Земля",
                    "orig_title": "Alien: Earth",
                    "latest_season": 1,
                    "latest_episode": 8,
                    "seasons_map": {"1": [1, 2, 3, 4, 5, 6, 7, 8]},
                },
                "kin_1003": {
                    "id": "kin_1003",
                    "kinorium_id": "1003",
                    "title": "Рыцарь Семи Королевств",
                    "orig_title": "A Knight of the Seven Kingdoms",
                    "latest_season": 1,
                    "latest_episode": 6,
                    "seasons_map": {"1": [1, 2, 3, 4, 5, 6]},
                },
                "kin_1004": {
                    "id": "kin_1004",
                    "kinorium_id": "1004",
                    "title": "Тед Лассо",
                    "orig_title": "Ted Lasso",
                    "latest_season": 4,
                    "latest_episode": 10,
                    "seasons_map": {"4": list(range(1, 11))},
                },
                "kin_1005": {
                    "id": "kin_1005",
                    "kinorium_id": "1005",
                    "title": "Кайдзю № 8",
                    "orig_title": "Kaiju No. 8",
                    "latest_season": 1,
                    "latest_episode": 12,
                    "seasons_map": {"1": list(range(1, 13))},
                },
            }
            kin.state["watched_episodes"] = {
                "kin_1002": {"1": [1, 2, 3, 4, 5, 6, 7, 8]},
                "kin_1003": {"1": [1, 2, 3, 4]},
                "kin_1004": {"4": [1, 2, 3, 4, 5, 6]},
                "kin_1005": {"1": list(range(1, 13)), "2": list(range(1, 12))},
            }
            kin._online_premieres_mem = [
                {
                    "id": "kin_1001",
                    "kinorium_id": "1001",
                    "title": "Дюна: Часть вторая",
                    "orig_title": "Dune: Part Two",
                    "year": 2024,
                    "media_type": "movie",
                },
                {
                    "id": "kin_1002",
                    "kinorium_id": "1002",
                    "title": "Чужой: Земля",
                    "orig_title": "Alien: Earth",
                    "year": 2025,
                    "media_type": "series",
                },
                {
                    "id": "kin_1003",
                    "kinorium_id": "1003",
                    "title": "Рыцарь Семи Королевств",
                    "orig_title": "A Knight of the Seven Kingdoms",
                    "year": 2026,
                    "media_type": "series",
                },
                {
                    "id": "kin_2000",
                    "kinorium_id": "2000",
                    "title": "Носферату",
                    "orig_title": "Nosferatu",
                    "year": 2024,
                    "media_type": "movie",
                },
            ]
            kin._online_premieres_last_attempt_ts = time.time()
            kin._build_lookup_indices()

            # Check watching section items (default excludes caught-up & watched)
            watching_items = kin.get_section_catalog_items("watching")
            watching_ids = [it["kinorium_id"] for it in watching_items]
            self.assertEqual(watching_ids, ["1003", "1004"])
            for it in watching_items:
                self.assertTrue(it["kinorium"]["has_new_episode"])
                self.assertFalse(it["kinorium"]["all_released_episodes_watched"])

            # include_caught_up=True still returns all 4 series for background HDRezka polling
            all_watching_for_poll = kin.get_section_catalog_items("watching", include_caught_up=True)
            self.assertGreaterEqual(len(all_watching_for_poll), 4)

            # Check section counts match visible items
            counts = kin.get_sections_counts()
            self.assertEqual(counts["watching"], 2)
            self.assertEqual(counts["premieres"], 2)  # Only 1003 and 2000 are unwatched/uncaught-up

            # When episode 9 of Alien: Earth (1002) is released, it automatically reappears in Watching!
            kin.state["series_live_meta"]["kin_1002"]["latest_episode"] = 9
            kin.state["series_live_meta"]["kin_1002"]["seasons_map"]["1"] = [1, 2, 3, 4, 5, 6, 7, 8, 9]
            kin._build_lookup_indices()
            watching_after_ep9 = [it["kinorium_id"] for it in kin.get_section_catalog_items("watching")]
            self.assertIn("1002", watching_after_ep9)
            self.assertEqual(kin.get_sections_counts()["watching"], 3)

    def test_remote_bookmarks_and_chapters_controls(self):
        from backend.remote_control import DesktopRemoteBroker

        broker = DesktopRemoteBroker("abcdef123456")
        snap = broker.update_desktop_state(
            {
                "is_player_open": True,
                "active_chapter": "Глава 2",
                "chapters": [{"time": 0, "label": "Начало", "kind": "chapter"}],
                "bookmarks": [{"id": "moment_1", "time": 125, "label": "2:05", "note": "Любимая сцена"}],
            }
        )
        self.assertEqual(snap["state"]["active_chapter"], "Глава 2")
        self.assertEqual(len(snap["state"]["chapters"]), 1)
        self.assertEqual(snap["state"]["bookmarks"][0]["note"], "Любимая сцена")

        for action, payload in [
            ("toggle_bookmark", {}),
            ("add_bookmark_note", {"time": 125, "note": "Обновлённая заметка"}),
            ("delete_bookmark", {"id": "moment_1", "time": 125}),
            ("jump_marker", {"direction": 1}),
            ("set_playback_rate", {"rate": 1.5}),
            ("set_sleep_timer", {"mode": "30"}),
            ("select_episode", {"season": 2, "episode": 4}),
        ]:
            cmd = broker.enqueue_command(action, payload)
            self.assertTrue(cmd["ok"], f"Command {action} must be accepted by DesktopRemoteBroker")

        snap2 = broker.update_desktop_state(
            {
                "seasons_map": {"1": [1, 2, 3], "2": [1, 2, 3, 4]},
                "watched_episodes": {"1:1": True, "1:2": True},
                "sleep_timer_mode": "30",
                "sleep_timer_rem_sec": 1800,
                "playback_rate": 1.5,
            }
        )
        self.assertEqual(snap2["state"]["seasons_map"]["2"], [1, 2, 3, 4])
        self.assertTrue(snap2["state"]["watched_episodes"]["1:1"])
        self.assertEqual(snap2["state"]["sleep_timer_mode"], "30")
        self.assertEqual(snap2["state"]["playback_rate"], 1.5)

        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, "public", "js", "remote.js"), "r", encoding="utf-8") as f:
            remote_js = f.read()
        for expected in (
            "rm-bookmarks-group",
            "rm-btn-prev-marker",
            "rm-btn-bookmark-toggle",
            "rm-btn-bookmark-note-open",
            "rm-btn-next-marker",
            "rm-bookmarks-list",
            "rm-ep-picker-group",
            "rm-sel-season",
            "rm-ep-grid",
            "rm-sel-speed",
            "rm-sel-sleep",
            'case "toggle_bookmark":',
            'case "add_bookmark_note":',
            'case "delete_bookmark":',
            'case "jump_marker":',
            'case "set_playback_rate":',
            'case "set_sleep_timer":',
        ):
            self.assertIn(expected, remote_js)

        with open(os.path.join(root, "public", "js", "settings-updater.js"), "r", encoding="utf-8") as f:
            updater_js = f.read()
        self.assertIn("BOOKMARKS_STORAGE_KEY", updater_js)

        with open(os.path.join(root, "public", "js", "settings.js"), "r", encoding="utf-8") as f:
            settings_js = f.read()
        self.assertIn("BOOKMARKS_STORAGE_KEY", settings_js)

        with open(os.path.join(root, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            bookmarks_js = f.read()
        for expected_bm in (
            "_buildMomentFromActiveState",
            "bookmarks-filter-pills",
            "atv-bm-btn-edit",
            "kinorium_id",
            "rezka_url",
        ):
            self.assertIn(expected_bm, bookmarks_js)

    def test_xray_subtitle_styler_studio_memory_and_cinema_wrap(self):
        from backend.routes.meta import _build_xray_payload, META_GET_ROUTES

        self.assertIn("/api/xray", META_GET_ROUTES)
        xray_bb = _build_xray_payload(
            title="Во все тяжкие",
            orig_title="Breaking Bad",
            year=2008,
            media_type="series",
            directors=["Винс Гиллиган"],
            actors=["Брайан Крэнстон", "Аарон Пол"],
            genres=["Драма", "Криминал"],
            countries=["США"],
            kinorium_rating=9.1,
            imdb_rating=9.5,
            critics_rating=96,
            lang="ru",
            allow_network=False,
        )
        self.assertTrue(xray_bb["ok"])
        self.assertGreaterEqual(len(xray_bb["soundtrack"]), 3)
        self.assertEqual(xray_bb["soundtrack"][0]["artist"], "Dave Porter")
        self.assertGreaterEqual(len(xray_bb["trivia"]), 3)
        self.assertTrue(any("C10H15N" in t["text"] for t in xray_bb["trivia"]))

        # Verify Cinema Wrap in KinoriumService.get_profile_stats()
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            svc = KinoriumService(_FakeNetForRezka({}), tmpdir, register_atexit=False, start_background_workers=False)
            svc.state["remote_watched_items"] = {
                "101": {
                    "ru_title": "Интерстеллар",
                    "orig_title": "Interstellar",
                    "year": 2014,
                    "media_type": "movie",
                    "score": 10,
                    "kinorium_rating": 8.6,
                    "genres": ["Фантастика", "Драма"],
                    "directors": ["Кристофер Нолан"],
                    "actors": ["Мэттью Макконахи", "Энн Хэтэуэй"],
                },
                "102": {
                    "ru_title": "Во все тяжкие",
                    "orig_title": "Breaking Bad",
                    "year": 2008,
                    "media_type": "series",
                    "score": 10,
                    "kinorium_rating": 9.1,
                    "genres": ["Драма", "Криминал"],
                    "directors": ["Винс Гиллиган"],
                    "actors": ["Брайан Крэнстон"],
                },
            }
            svc.state["watched_episodes"] = {"kin_102": {"1": [1, 2, 3, 4, 5, 6, 7], "2": [1, 2, 3, 4, 5]}}
            stats = svc.get_profile_stats()
            self.assertIn("cinema_wrap", stats)
            self.assertEqual(stats["watched_episodes_count"], 12)
            self.assertEqual(stats["top_directors"][0]["name"], "Кристофер Нолан")
            self.assertGreaterEqual(len(stats["top_actors"]), 2)
            self.assertTrue(stats["cinema_wrap"]["persona_ru"])

        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, "public", "index.html"), "r", encoding="utf-8") as f:
            html_src = f.read()
        for dom_id in (
            "select-sub-font",
            "select-sub-color",
            "select-sub-edge",
            "xray-tab-cast",
            "xray-tab-soundtrack",
            "xray-tab-trivia",
            "xray-soundtrack-list",
            "xray-trivia-list",
        ):
            self.assertIn(f'id="{dom_id}"', html_src)

        with open(os.path.join(root, "public", "js", "catalog-media-resolver.js"), "r", encoding="utf-8") as f:
            resolver_js = f.read()
        for fn_name in (
            "export function normalizeStudioBrand",
            "export function getItemStudioPreferenceKeys",
            "export function matchPreferredStudioInList",
        ):
            self.assertIn(fn_name, resolver_js)

        with open(os.path.join(root, "public", "js", "modals-stats.js"), "r", encoding="utf-8") as f:
            stats_js = f.read()
        self.assertIn("export function computeClientWatchWrapAnalytics", stats_js)
        self.assertIn("cinema-wrap-banner", stats_js)
        self.assertIn("wrap-top-directors", stats_js)
        self.assertIn("wrap-top-actors", stats_js)

    def test_v32_mobile_remote_xray_audio_sub_and_seamless_bridge(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

        # 1. Remote JS inspection
        with open(os.path.join(root, "public", "js", "remote.js"), "r", encoding="utf-8") as f:
            remote_js = f.read()

        # Mobile X-Ray tab and pane
        self.assertIn('data-rtab="xray"', remote_js)
        self.assertIn('id="rm-tab-lbl-xray"', remote_js)
        self.assertIn('id="rm-pane-xray"', remote_js)
        self.assertIn('id="rm-xray-tab-cast"', remote_js)
        self.assertIn('id="rm-xray-tab-soundtrack"', remote_js)
        self.assertIn('id="rm-xray-tab-trivia"', remote_js)
        self.assertIn("renderRemoteXRay", remote_js)
        self.assertIn("rm-copy-track", remote_js)

        # Audio and Subtitle chips
        self.assertIn('id="rm-studio-chips"', remote_js)
        self.assertIn('id="rm-sub-chips"', remote_js)
        self.assertIn('id="rm-studio-active-badge"', remote_js)
        self.assertIn('id="rm-sub-active-badge"', remote_js)
        self.assertIn('data-studio-id', remote_js)
        self.assertIn('data-sub-idx', remote_js)

        # Desktop snapshot collection of xray
        self.assertIn("xray: (() => {", remote_js)
        self.assertIn("castSnap", remote_js)
        self.assertIn("soundtrackSnap", remote_js)
        self.assertIn("triviaSnap", remote_js)

        # Remote UI/UX ergonomic upgrades (source tabs, volume steppers, live status badge, optimistic feedback)
        self.assertIn('id="rm-source-tabs-row"', remote_js)
        self.assertIn('id="rm-source-seg"', remote_js)
        self.assertIn('data-source-tab="hdrezka"', remote_js)
        self.assertIn('data-source-tab="stremio"', remote_js)
        self.assertIn('data-source-tab="backup4k"', remote_js)
        self.assertIn('id="rm-playback-state-badge"', remote_js)
        self.assertIn('id="rm-btn-vol-down"', remote_js)
        self.assertIn('id="rm-btn-vol-up"', remote_js)
        self.assertIn("applyOptimisticSeek", remote_js)
        self.assertIn('case "set_source_tab":', remote_js)

        from backend.remote_control import DesktopRemoteBroker
        self.assertIn("set_source_tab", DesktopRemoteBroker.ALLOWED_COMMANDS)

        # 2. Remote CSS inspection
        with open(os.path.join(root, "public", "css", "remote-and-palette.css"), "r", encoding="utf-8") as f:
            css_src = f.read()

        self.assertIn("repeat(4, minmax(0, 1fr))", css_src)
        self.assertIn(".atv-remote-chips-scroll", css_src)
        self.assertIn(".atv-remote-chip", css_src)
        self.assertIn("#rm-pane-xray", css_src)
        self.assertIn(".atv-remote-xray-head", css_src)
        self.assertIn(".atv-remote-cast-grid", css_src)
        self.assertIn(".atv-remote-ost-list", css_src)
        self.assertIn(".atv-next-ep-bridge-badge", css_src)
        self.assertIn(".atv-remote-source-seg", css_src)
        self.assertIn(".atv-remote-vol-step-btn", css_src)
        self.assertNotIn("backdrop-filter: blur", css_src)

        # 3. HTML and Seamless Binge Bridge inspection
        with open(os.path.join(root, "public", "index.html"), "r", encoding="utf-8") as f:
            html_src = f.read()

        self.assertIn('id="next-ep-bridge-badge"', html_src)
        self.assertIn('id="seamless-bridge-toggle"', html_src)
        self.assertIn('id="gear-seamless-bridge-label"', html_src)

        # 4. State & Player Autoplay inspection
        with open(os.path.join(root, "public", "js", "state.js"), "r", encoding="utf-8") as f:
            state_js = f.read()
        self.assertIn("seamlessEpisodeBridge:", state_js)

        with open(os.path.join(root, "public", "js", "player-autoplay.js"), "r", encoding="utf-8") as f:
            autoplay_js = f.read()
        self.assertIn("next-ep-bridge-badge", autoplay_js)
        self.assertIn("seamlessEpisodeBridge", autoplay_js)

    def test_person_photo_validation_and_resolution(self):
        from backend.hdrezka import HDRezkaClient
        from backend.hdrezka_extras import resolve_person_photo

        self.assertTrue(
            HDRezkaClient._is_valid_person_photo_url(
                "https://statichdrezka.ac/i/2020/2/19/pe049014c81e0op88q31x.jpg"
            )
        )
        self.assertTrue(
            HDRezkaClient._is_valid_person_photo_url(
                "https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Christopher_Nolan_Cannes_2018.jpg/330px-Christopher_Nolan_Cannes_2018.jpg"
            )
        )
        self.assertFalse(HDRezkaClient._is_valid_person_photo_url(""))
        self.assertFalse(
            HDRezkaClient._is_valid_person_photo_url("https://statichdrezka.ac/templates/hdrezka/images/no-photo.png")
        )
        self.assertFalse(
            HDRezkaClient._is_valid_person_photo_url("https://upload.wikimedia.org/wikipedia/commons/Flag_of_USA.svg")
        )

        class _DummyRezkaClient:
            def __init__(self):
                self._cache_lock = threading.Lock()
                self.person_photo_by_name = {
                    "билли пайпер": "https://statichdrezka.ac/i/2014/12/19/p9b4ab51c1d88bc64d14s.jpg"
                }

            _is_valid_person_photo_url = staticmethod(HDRezkaClient._is_valid_person_photo_url)

            def _fetch_wiki_json(self, url, timeout=3.0):
                return {}

        dummy = _DummyRezkaClient()
        self.assertEqual(
            resolve_person_photo(dummy, "Билли Пайпер"),
            "https://statichdrezka.ac/i/2014/12/19/p9b4ab51c1d88bc64d14s.jpg",
        )
        self.assertEqual(
            resolve_person_photo(dummy, "Billie Piper"),
            "https://statichdrezka.ac/i/2014/12/19/p9b4ab51c1d88bc64d14s.jpg",
        )

    def test_xray_intelligence_and_interactive_upgrades(self):
        from backend.routes.meta import _build_xray_payload
        from backend.remote_control import DesktopRemoteBroker

        # 1. Expanded curated soundtracks & trivia (The Last of Us, Fallout, Oppenheimer, Inception)
        xray_tlou = _build_xray_payload(
            title="Одни из нас",
            orig_title="The Last of Us",
            year=2023,
            media_type="series",
            lang="ru",
            allow_network=False,
        )
        self.assertGreaterEqual(len(xray_tlou["soundtrack"]), 3)
        self.assertEqual(xray_tlou["soundtrack"][0]["artist"], "Gustavo Santaolalla")
        self.assertTrue(any("Linda Ronstadt" in tr["artist"] for tr in xray_tlou["soundtrack"]))
        self.assertGreaterEqual(len(xray_tlou["trivia"]), 2)

        xray_opp = _build_xray_payload(
            title="Оппенгеймер",
            orig_title="Oppenheimer",
            year=2023,
            media_type="movie",
            lang="en",
            allow_network=False,
        )
        self.assertEqual(xray_opp["soundtrack"][0]["artist"], "Ludwig Göransson")
        self.assertTrue(any("CGI" in fc["text"] for fc in xray_opp["trivia"]))

        # 2. Remote commands include open_person and toggle_xray
        self.assertIn("open_person", DesktopRemoteBroker.ALLOWED_COMMANDS)
        self.assertIn("toggle_xray", DesktopRemoteBroker.ALLOWED_COMMANDS)

        # 3. Frontend X-Ray controls, actor avatars, scene metadata & hotkey X
        with open(os.path.join(ROOT_DIR, "public", "index.html"), "r", encoding="utf-8") as f:
            html_src = f.read()
        self.assertIn('id="vc-btn-xray"', html_src)
        self.assertIn('id="xray-scene-meta"', html_src)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            bm_js = f.read()
        self.assertIn("export function toggleXRayPauseShelf()", bm_js)
        self.assertIn("atv-xray-actor-avatar", bm_js)
        self.assertIn("/api/person-photo?name=", bm_js)
        self.assertIn("atv-xray-trivia-copy", bm_js)

        with open(os.path.join(ROOT_DIR, "public", "css", "player-subtitles-and-bookmarks.css"), "r", encoding="utf-8") as f:
            xray_css = f.read()
        self.assertIn(".atv-xray-actor-avatar {", xray_css)
        self.assertIn(".atv-xray-trivia-card.is-expanded", xray_css)

    def test_remote_pro_controller_and_cast_card_alignment(self):
        from backend.remote_control import DesktopRemoteBroker

        # 1. Remote broker supports audio preset, video crop, ambilight & subtitle/audio cycle commands + state
        for cmd in ("set_audio_preset", "set_video_crop", "toggle_ambilight", "cycle_subtitle", "cycle_audio"):
            self.assertIn(cmd, DesktopRemoteBroker.ALLOWED_COMMANDS)

        broker = DesktopRemoteBroker()
        snap = broker.get_snapshot()
        for key in ("xray_open", "audio_preset", "audio_boost", "video_crop", "ambilight_enabled"):
            self.assertIn(key, snap["state"])

        # 2. Remote UI & CSS include transport deck, scrubber markers, quick DSP bar, D-pad chassis & mini transport
        with open(os.path.join(ROOT_DIR, "public", "js", "remote.js"), "r", encoding="utf-8") as f:
            remote_js = f.read()
        for token in (
            'id="rm-transport-deck"',
            'id="rm-scrubber-markers"',
            'id="rm-quick-dsp-row"',
            'id="rm-quick-boost-btn"',
            'id="rm-dpad-chassis"',
            'id="rm-dpad-sub-cycle"',
            'id="rm-tab-xray-badge"',
            'id="rm-quality-chips"',
            'id="rm-tuning-drawer"',
            'id="rm-audio-preset-chips"',
            'id="rm-crop-chips"',
            'id="rm-btn-ambilight"',
            'id="rm-btn-xray-pc"',
            'id="rm-mini-transport"',
        ):
            self.assertIn(token, remote_js)

        with open(os.path.join(ROOT_DIR, "public", "index.html"), "r", encoding="utf-8") as f:
            index_html = f.read()
        self.assertIn('id="remote-connected-devices-list"', index_html)
        self.assertIn('id="btn-remote-open-preview"', index_html)

        with open(os.path.join(ROOT_DIR, "public", "css", "remote-and-palette.css"), "r", encoding="utf-8") as f:
            remote_css = f.read()
        for selector in (
            ".atv-remote-transport-deck {",
            ".atv-remote-scrubber-markers {",
            ".atv-remote-tuning-drawer {",
            ".atv-remote-mini-transport {",
            ".atv-remote-quick-dsp-row {",
            ".atv-remote-dpad-chassis {",
            ".atv-remote-tab-badge {",
        ):
            self.assertIn(selector, remote_css)

        # 3. Cast & Director photo cards have fixed dimensions and 2-line balanced name alignment
        with open(os.path.join(ROOT_DIR, "public", "css", "modals-and-search.css"), "r", encoding="utf-8") as f:
            modals_css = f.read()
        self.assertIn("min-height: calc(2 * 1.24em);", modals_css)
        self.assertIn("min-width: 84px;", modals_css)
        self.assertIn("max-width: 84px;", modals_css)

    def test_v33_hdrezka_jump_to_zero_sequel_pack_and_p2p_remux_fixes(self):
        from backend.backup_stream import BackupStreamingEngine as BackupStreamEngine
        from backend.kinorium_persons import parse_search_persons_and_movies

        # 1. Sequel & subtitle guard in _matches_target_title + double-char folding ("хилз" == "хиллз")
        self.assertTrue(
            BackupStreamEngine._matches_target_title(
                "Полицейский из Беверли-Хиллз / Beverly Hills Cop (1984) 4K UHD BDRip 2160p",
                "Полицейский из Беверли-Хилз",
                "Beverly Hills Cop",
                1984,
                "movie",
                1,
            )
        )
        self.assertFalse(
            BackupStreamEngine._matches_target_title(
                "Полицейский из Беверли-Хиллз 2 / Beverly Hills Cop II (1987) BDRip 1080p",
                "Полицейский из Беверли-Хиллз",
                "Beverly Hills Cop",
                0,
                "movie",
                1,
            )
        )
        self.assertFalse(
            BackupStreamEngine._matches_target_title(
                "Полицейский из Беверли-Хиллз: Аксель Фоули / Beverly Hills Cop: Axel F (2024) 2160p",
                "Полицейский из Беверли-Хиллз",
                "Beverly Hills Cop",
                0,
                "movie",
                1,
            )
        )

        # 2. _infer_release_voices does not fabricate Russian dubbing on Ukrainian-only releases
        ukr_voices = BackupStreamEngine._infer_release_voices(
            "Поліцейський з Беверлі Хіллз. Трилогія / Beverly Hills Cop. Trilogy (1984-1994) BDRemux 1080p 2xUkr/Eng",
            None,
        )
        self.assertIn("Українська", ukr_voices)
        self.assertNotIn("Дубляж", ukr_voices)

        # 3. Trilogy pack file selection picks Part 1 (1984) instead of largest file (Part 3, 1994)
        trilogy_files = [
            {"id": 1, "path": "Trilogy/1984 - Beverly Hills Cop.mkv", "length": 42_000_000_000},
            {"id": 2, "path": "Trilogy/1987 - Beverly Hills Cop II.mkv", "length": 46_000_000_000},
            {"id": 3, "path": "Trilogy/1994 - Beverly Hills Cop III.mkv", "length": 54_000_000_000},
        ]
        self.assertEqual(
            BackupStreamEngine._match_episode_from_files(
                trilogy_files,
                "path",
                "id",
                "length",
                "movie",
                1,
                1,
                year=1984,
                title="Полицейский из Беверли-Хиллз",
                orig_title="Beverly Hills Cop",
            ),
            1,
        )
        self.assertEqual(
            BackupStreamEngine._match_episode_from_files(
                trilogy_files,
                "path",
                "id",
                "length",
                "movie",
                1,
                1,
                year=1994,
                title="Полицейский из Беверли-Хиллз 3",
                orig_title="Beverly Hills Cop III",
            ),
            3,
        )

        # 4. Kinorium movie items always include 'id'
        parsed_kn = parse_search_persons_and_movies(
            '{"list":[{"mixtype":"movie","id":102938,"name":"Полицейский из Беверли-Хиллз","name_orig":"Beverly Hills Cop","year":"1984"}]}'
        )
        self.assertEqual(len(parsed_kn["movies"]), 1)
        self.assertEqual(parsed_kn["movies"][0]["id"], "kin_102938")

        # 5. Player & proxy stream anti-reset and mid-stream continuation invariants
        with open(os.path.join(ROOT_DIR, "public", "js", "player.js"), "r", encoding="utf-8") as f:
            player_js = f.read()
        self.assertIn("enforceNativeStartSeek", player_js)
        self.assertIn("state.lastKnownPlaybackTime", player_js)
        self.assertNotIn("if (video.readyState >= 1) onMeta();", player_js)

        with open(os.path.join(ROOT_DIR, "backend", "routes", "streaming.py"), "r", encoding="utf-8") as f:
            streaming_py = f.read()
        self.assertIn("range_start > 0 and status_code == 200", streaming_py)
        self.assertIn("next_start = range_start + pump_bytes_read", streaming_py)

        # 6. TorrServer DHT preflight ranks live swarms above dead (0-file) swarms and rejects dead magnets fast
        class _DummyNetDHT:
            p2p_strict = False
            def request(self, url, **kwargs):
                return 200, "{}", {}

        class _DummyRezkaDHT:
            def get_streams_for_title(self, **kwargs):
                return {}

        b_dht = BackupStreamEngine(_DummyNetDHT(), _DummyRezkaDHT(), base_dir=ROOT_DIR)
        b_dht.ensure_local_torrserver = lambda: True
        b_dht._is_torrserver_alive = lambda: True
        b_dht._fetch_torrserver_file_stats = lambda mag, wait_metadata_sec=0.0: (
            [{"id": 1, "path": "Beverly.Hills.Cop.1984.BDRemux.mkv", "length": 22_000_000_000}]
            if "livehash" in mag
            else []
        )
        ranked = b_dht.preflight_rank_torrserver_candidates(
            [
                {"title": "Dead Kinozal 4K", "magnet": "magnet:?xt=urn:btih:deadhash", "seeders": 11, "rank": 2},
                {"title": "Live RuTracker Remux", "magnet": "magnet:?xt=urn:btih:livehash", "seeders": 38, "rank": 1},
            ],
            sort_key_fn=lambda r: r["rank"],
            max_probe=4,
            wait_sec=0.1,
        )
        self.assertEqual(ranked[0]["title"], "Live RuTracker Remux")
        self.assertEqual(ranked[0]["_dht_verified"], 1)
        self.assertEqual(ranked[1]["_dht_verified"], -1)

        dead_res = b_dht.resolve_torrserver_stream("magnet:?xt=urn:btih:deadhash", media_type="movie")
        self.assertFalse(dead_res["ok"])
        self.assertTrue(dead_res.get("dead_swarm"))
        live_res = b_dht.resolve_torrserver_stream("magnet:?xt=urn:btih:livehash", media_type="movie")
        self.assertTrue(live_res["ok"])

    def test_xray_stage1_compact_pause_pill_and_pref_toggle(self):
        with open(os.path.join(ROOT_DIR, "public", "index.html"), "r", encoding="utf-8") as f:
            html_src = f.read()
        self.assertIn('id="xray-on-pause-toggle"', html_src)
        self.assertIn('id="gear-xray-pause-label"', html_src)
        self.assertIn('id="xray-compact-pill"', html_src)

        with open(os.path.join(ROOT_DIR, "public", "js", "state.js"), "r", encoding="utf-8") as f:
            state_js = f.read()
        self.assertIn("showXrayOnPause:", state_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "audio-dsp.js"), "r", encoding="utf-8") as f:
            audio_dsp_js = f.read()
        self.assertIn("showXrayOnPause", audio_dsp_js)
        self.assertIn("xray-on-pause-toggle", audio_dsp_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-ui-controls.js"), "r", encoding="utf-8") as f:
            ui_controls_js = f.read()
        self.assertIn('document.getElementById("xray-on-pause-toggle")', ui_controls_js)
        self.assertIn("savePlayerPrefs({ showXrayOnPause: state.showXrayOnPause })", ui_controls_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            bm_js = f.read()
        self.assertIn("export function expandXRayPauseShelf()", bm_js)
        self.assertIn('shelf.classList.contains("is-compact")', bm_js)
        self.assertIn("state.showXrayOnPause === false", bm_js)

        with open(os.path.join(ROOT_DIR, "public", "css", "modals-and-search.css"), "r", encoding="utf-8") as f:
            modals_css = f.read()
        self.assertIn("#xray-pause-shelf:not(.hidden):not(.is-compact)", modals_css)

        with open(os.path.join(ROOT_DIR, "public", "css", "player-subtitles-and-bookmarks.css"), "r", encoding="utf-8") as f:
            xray_css = f.read()
        self.assertIn(".atv-xray-pause-shelf.is-compact", xray_css)
        self.assertIn(".atv-xray-compact-pill", xray_css)

    def test_xray_stage2_fullscreen_person_modal_and_avatar_fallback(self):
        with open(os.path.join(ROOT_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            bm_js = f.read()
        self.assertIn("atv-xray-actor-monogram", bm_js)
        self.assertIn("_buildXRayMonogramInitials", bm_js)
        # Clicking an actor in X-Ray should NOT exit fullscreen
        cast_sec = bm_js.split("function _renderXRayCastSection")[1].split("function _renderXRaySoundtrackAndTrivia")[0]
        self.assertNotIn("exitBrowserFullscreenIfNeeded()", cast_sec)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals-person.js"), "r", encoding="utf-8") as f:
            person_js = f.read()
        self.assertIn("export function syncPersonModalMount()", person_js)

        with open(os.path.join(ROOT_DIR, "public", "css", "player-subtitles-and-bookmarks.css"), "r", encoding="utf-8") as f:
            xray_css = f.read()
        self.assertIn(".atv-xray-actor-monogram", xray_css)

    def test_xray_stage3_authentic_trivia_and_soundtrack_quality(self):
        from backend.routes.meta import _build_xray_payload

        xray_bb = _build_xray_payload(
            title="Во все тяжкие",
            orig_title="Breaking Bad",
            year=2008,
            media_type="series",
            directors=["Винс Гиллиган"],
            actors=["Брайан Крэнстон", "Аарон Пол"],
            genres=["Драма", "Криминал"],
            countries=["США"],
            kinorium_rating=9.1,
            imdb_rating=9.5,
            critics_rating=96,
            lang="ru",
            allow_network=False,
        )
        # Must NOT contain synthetic boilerplate filler phrases
        all_trivia_text = " ".join(fc.get("text", "") for fc in xray_bb["trivia"])
        self.assertNotIn("фирменной визуальной атмосферы", all_trivia_text)
        self.assertNotIn("задающий драматургию истории", all_trivia_text)
        self.assertNotIn("звуковой панорамой и цветокоррекцией", all_trivia_text)
        self.assertTrue(all("yandex_music_url" not in tr for tr in xray_bb["soundtrack"]))

        # Unknown movie fallback should NOT invent fake "Key Scene Suite" / "Original Score Ensemble" tracks
        xray_unknown = _build_xray_payload(
            title="Редкий артхаус",
            orig_title="Rare Arthouse Film",
            year=2024,
            media_type="movie",
            directors=["Иван Иванов"],
            actors=["Пётр Петров", "Анна Сидорова"],
            lang="ru",
            allow_network=False,
        )
        unknown_ost_titles = " ".join(tr.get("title", "") for tr in xray_unknown["soundtrack"])
        self.assertNotIn("Key Scene Suite", unknown_ost_titles)
        self.assertNotIn("Original Score Ensemble", " ".join(tr.get("artist", "") for tr in xray_unknown["soundtrack"]))
        unknown_trivia_text = " ".join(fc.get("text", "") for fc in xray_unknown["trivia"])
        self.assertNotIn("фирменной визуальной атмосферы", unknown_trivia_text)
        self.assertNotIn("звуковой панорамой и цветокоррекцией", unknown_trivia_text)

    def test_xray_stage4_scroll_arrows_and_keyboard_nav(self):
        with open(os.path.join(ROOT_DIR, "public", "index.html"), "r", encoding="utf-8") as f:
            html_src = f.read()
        self.assertIn('id="xray-scroll-prev"', html_src)
        self.assertIn('id="xray-scroll-next"', html_src)
        self.assertIn('aria-controls="xray-cast-list"', html_src)
        self.assertIn('aria-controls="xray-soundtrack-list"', html_src)
        self.assertIn('aria-controls="xray-trivia-list"', html_src)
        self.assertIn('role="tabpanel" aria-labelledby="xray-tab-cast"', html_src)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            bm_js = f.read()
        self.assertIn("export function scrollActiveXRayList(", bm_js)
        self.assertIn("_syncXRayScrollButtons", bm_js)
        self.assertIn("xray-scroll-prev", bm_js)
        self.assertIn("xray-scroll-next", bm_js)
        self.assertIn("can-scroll-left", bm_js)
        self.assertIn("can-scroll-right", bm_js)
        self.assertIn('window.addEventListener("resize", _syncXRayScrollButtons', bm_js)
        self.assertIn('card.setAttribute("aria-expanded"', bm_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "app-hotkeys.js"), "r", encoding="utf-8") as f:
            hotkeys_js = f.read()
        self.assertIn("scrollActiveXRayList", hotkeys_js)
        self.assertIn("switchXRayTab", hotkeys_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "remote.js"), "r", encoding="utf-8") as f:
            remote_js = f.read()
        self.assertTrue(
            '!document.getElementById("xray-pause-shelf")?.classList.contains("is-compact")' in remote_js
            or '!xrayShelfEl.classList.contains("is-compact")' in remote_js
        )
        self.assertNotIn('imgEl.closest(".atv-remote-actor-card")?.remove()', remote_js)
        self.assertIn("/^(официальный саундтрек|official soundtrack)$/i", remote_js)

        with open(os.path.join(ROOT_DIR, "public", "css", "player-subtitles-and-bookmarks.css"), "r", encoding="utf-8") as f:
            xray_css = f.read()
        self.assertIn(".atv-xray-nav-btn", xray_css)
        self.assertIn(".atv-xray-header-actions", xray_css)
        self.assertIn(".atv-xray-nav-btn:focus-visible", xray_css)
        self.assertIn(".atv-xray-tab-btn:focus-visible", xray_css)
        self.assertIn(".atv-xray-trivia-card:focus-visible", xray_css)
        self.assertIn(".can-scroll-right", xray_css)

    def test_xray_stage5_scene_aware_cast_and_soundtrack_priority(self):
        with open(os.path.join(ROOT_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            bm_js = f.read()
        self.assertIn("export function resolveActiveXRaySceneContext(", bm_js)
        self.assertIn("export function isCastEntryInScene(", bm_js)
        self.assertIn("export function scoreTrackForScene(", bm_js)
        self.assertIn("is-in-scene", bm_js)
        self.assertIn("atv-xray-scene-pill", bm_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "remote.js"), "r", encoding="utf-8") as f:
            remote_js = f.read()
        self.assertIn("in_scene", remote_js)

        with open(os.path.join(ROOT_DIR, "public", "css", "player-subtitles-and-bookmarks.css"), "r", encoding="utf-8") as f:
            xray_css = f.read()
        self.assertIn(".atv-xray-scene-pill", xray_css)
        self.assertIn(".atv-xray-actor-card.is-in-scene", xray_css)
        self.assertIn(".atv-xray-track-card.is-in-scene", xray_css)

    def test_qp_stage1_inline_trailer_and_parallel_lookup(self):
        with open(os.path.join(ROOT_DIR, "public", "index.html"), "r", encoding="utf-8") as f:
            html_src = f.read()
        self.assertIn('id="qp-inline-trailer-stage"', html_src)
        self.assertIn('id="qp-trailer-lang-ru"', html_src)
        self.assertIn('id="qp-trailer-lang-en"', html_src)
        self.assertIn('id="qp-trailer-close-btn"', html_src)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals.js"), "r", encoding="utf-8") as f:
            modals_js = f.read()
        self.assertIn("export async function openQuickPeekInlineTrailer(", modals_js)
        self.assertIn("export function stopQuickPeekInlineTrailer(", modals_js)
        self.assertIn("stopQuickPeekInlineTrailer()", modals_js)

        with open(os.path.join(ROOT_DIR, "backend", "hdrezka_extras.py"), "r", encoding="utf-8") as f:
            extras_py = f.read()
        self.assertIn('"youtube_id":', extras_py)
        self.assertIn('"embed_url":', extras_py)

    def test_qp_stage2_franchise_chronology_parser_and_ui(self):
        from backend.hdrezka import HDRezkaClient
        from backend.aggregator_discovery import extract_franchise_root_key

        sample_partcontent_html = """
        <div class="b-post__partcontent">
          <div class="b-post__partcontent_item current" data-url="https://rezka.ag/films/scifi/65001-dyuna-chast-vtoraya-2024.html">
            <span class="num">2</span>
            <span class="title">Дюна: Часть вторая</span>
            <span class="year">2024 год</span>
            <span class="rating"><i class="b-post__partcontent_item-rating">8.61</i></span>
          </div>
          <div class="b-post__partcontent_item" data-url="https://rezka.ag/films/scifi/41001-dyuna-2021.html">
            <span class="num">1</span>
            <span class="title"><a href="https://rezka.ag/films/scifi/41001-dyuna-2021.html">Дюна: Часть первая</a></span>
            <span class="year">2021 год</span>
            <span class="rating"><i class="b-post__partcontent_item-rating">8.02</i></span>
          </div>
        </div>
        """
        parts = HDRezkaClient._extract_franchise_parts_html(sample_partcontent_html, "https://rezka.ag")
        self.assertEqual(len(parts), 2)
        # Should be sorted chronologically (by year ascending or part order)
        self.assertEqual(parts[0]["year"], 2021)
        self.assertEqual(parts[0]["rezka_id"], "41001")
        self.assertFalse(parts[0]["is_current"])
        self.assertEqual(parts[1]["year"], 2024)
        self.assertEqual(parts[1]["rezka_id"], "65001")
        self.assertTrue(parts[1]["is_current"])

        # Franchise root key normalization for sequel grouping
        self.assertEqual(
            extract_franchise_root_key("Дюна: Часть вторая", "Dune: Part Two"),
            extract_franchise_root_key("Дюна", "Dune"),
        )
        self.assertEqual(
            extract_franchise_root_key("Джон Уик 4", "John Wick: Chapter 4"),
            extract_franchise_root_key("Джон Уик 2", "John Wick: Chapter 2"),
        )

        with open(os.path.join(ROOT_DIR, "public", "index.html"), "r", encoding="utf-8") as f:
            html_src = f.read()
        self.assertIn('id="qp-franchise-wrap"', html_src)
        self.assertIn('id="qp-franchise-list"', html_src)
        self.assertIn('id="qp-franchise-progress"', html_src)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals.js"), "r", encoding="utf-8") as f:
            modals_js = f.read()
        self.assertIn("renderQpFranchise", modals_js)
        self.assertIn("atv-qp-franchise-row", modals_js)
        self.assertIn("is-current-part", modals_js)

    def test_qp_stage3_similar_live_enrichment_and_quick_watchlist(self):
        with open(os.path.join(ROOT_DIR, "backend", "routes", "meta.py"), "r", encoding="utf-8") as f:
            meta_py = f.read()
        self.assertIn(
            'allow_network=bool(eff_kin_id_str and kin_extras_holder.get("similar_raw") is None)',
            meta_py,
        )

        with open(os.path.join(ROOT_DIR, "public", "index.html"), "r", encoding="utf-8") as f:
            html_src = f.read()
        for btn_id in (
            'id="qp-cast-scroll-prev"',
            'id="qp-cast-scroll-next"',
            'id="qp-sim-scroll-prev"',
            'id="qp-sim-scroll-next"',
        ):
            self.assertIn(btn_id, html_src)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals.js"), "r", encoding="utf-8") as f:
            modals_js = f.read()
        self.assertIn("atv-qp-sim-wl-btn", modals_js)
        self.assertIn("atv-qp-sim-status-badge", modals_js)
        self.assertIn("bindQpHorizontalScrollControls", modals_js)

    def test_qp_stage4_catalog_franchise_grouping_and_badges(self):
        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-filters.js"), "r", encoding="utf-8") as f:
            filters_js = f.read()
        self.assertIn("export function computeCatalogFranchiseGroups(", filters_js)
        self.assertIn("_franchiseCount", filters_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-cards.js"), "r", encoding="utf-8") as f:
            cards_js = f.read()
        self.assertIn("atv-poster-franchise-badge", cards_js)
        self.assertIn("scrollToFranchise: true", cards_js)
        self.assertIn('data-act="franchise"', cards_js)

        with open(os.path.join(ROOT_DIR, "public", "css", "catalog-and-player-layout.css"), "r", encoding="utf-8") as f:
            cat_css = f.read()
        self.assertIn(".atv-poster-franchise-badge", cat_css)

    def test_perf_stage1_player_subtitles_and_remote_optimizations(self):
        with open(os.path.join(ROOT_DIR, "public", "js", "player-ui-controls.js"), "r", encoding="utf-8") as f:
            vc_js = f.read()
        self.assertIn("function getSnappingRatio(rawRatio, dur, timelineWidthPx", vc_js)
        self.assertIn("_lastFsHeaderKey", vc_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "subtitles.js"), "r", encoding="utf-8") as f:
            sub_js = f.read()
        self.assertIn("export function revokeLocalVideoBlobUrl(", sub_js)
        self.assertIn("_findFirstActiveCueIndex", sub_js)
        self.assertIn("_tokenizedHtml", sub_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player.js"), "r", encoding="utf-8") as f:
            player_js = f.read()
        self.assertIn("revokeLocalVideoBlobUrl(video)", player_js)
        self.assertIn("releaseVideoFrameBridge()", player_js)
        self.assertIn("state.audioOffsetReloadTimerId", player_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            bm_js = f.read()
        self.assertIn("_xrayCompiledTokens", bm_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "audio-dsp.js"), "r", encoding="utf-8") as f:
            dsp_js = f.read()
        self.assertIn("state.ambilightTainted = true", dsp_js)

    def test_perf_stage2_catalog_modals_and_css_optimizations(self):
        with open(os.path.join(ROOT_DIR, "public", "js", "utils.js"), "r", encoding="utf-8") as f:
            utils_js = f.read()
        self.assertIn("export function matchCatalogItemSafe(listOrCandidate, maybeCandidate = null)", utils_js)
        self.assertIn("_dlIndexRef", utils_js)
        self.assertNotIn("bodyMo.observe(document.body", utils_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals.js"), "r", encoding="utf-8") as f:
            modals_js = f.read()
        self.assertIn("Array.isArray(state.catalogItems) ? state.catalogItems : []", modals_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-filters.js"), "r", encoding="utf-8") as f:
            filters_js = f.read()
        self.assertIn("Array.isArray(state.catalogItems) && state.catalogItems.length > list.length ? state.catalogItems : list", filters_js)
        self.assertIn("it._baseFranchiseKey", filters_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-cards.js"), "r", encoding="utf-8") as f:
            cards_js = f.read()
        self.assertIn("export function stopActiveCardHoverPreview()", cards_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-media-resolver.js"), "r", encoding="utf-8") as f:
            resolver_js = f.read()
        self.assertIn("_epInfoCacheEpoch", resolver_js)

        with open(os.path.join(ROOT_DIR, "public", "css", "catalog-and-player-layout.css"), "r", encoding="utf-8") as f:
            cat_css = f.read()
        self.assertNotIn("filter: drop-shadow(0 16px 28px rgba(0, 0, 0, 0.68));", cat_css)

    def test_perf_stage3_streaming_proxy_keepalive_and_remux(self):
        with open(os.path.join(ROOT_DIR, "backend", "routes", "streaming.py"), "r", encoding="utf-8") as f:
            streaming_py = f.read()
        self.assertIn("_MEDIA_UPSTREAM_POOL", streaming_py)
        self.assertIn("_MEDIA_EDGE_DNS_CACHE", streaming_py)
        self.assertIn("_release_or_close_media_conn", streaming_py)
        self.assertIn("_LAST_TOUCH_STREAM_TS", streaming_py)

        with open(os.path.join(ROOT_DIR, "backend", "en_metadata.py"), "r", encoding="utf-8") as f:
            en_meta_py = f.read()
        self.assertIn("self._safe_json_opener", en_meta_py)

        with open(os.path.join(ROOT_DIR, "backend", "doh.py"), "r", encoding="utf-8") as f:
            doh_py = f.read()
        self.assertIn("self._doh_direct_opener", doh_py)
        self.assertIn("_SHARED_DOH_EXECUTOR", doh_py)

    def test_perf_stage4_backend_catalog_kinorium_and_hdrezka(self):
        with open(os.path.join(ROOT_DIR, "backend", "en_metadata.py"), "r", encoding="utf-8") as f:
            en_meta_py = f.read()
        self.assertIn("include_episodes: bool = True", en_meta_py)

        with open(os.path.join(ROOT_DIR, "backend", "aggregator.py"), "r", encoding="utf-8") as f:
            agg_py = f.read()
        self.assertIn("include_episodes=False", agg_py)
        self.assertIn("base_curated if base_curated is not None else", agg_py)

        with open(os.path.join(ROOT_DIR, "backend", "hdrezka.py"), "r", encoding="utf-8") as f:
            rezka_py = f.read()
        self.assertIn('clean_page_html = page_html.split(\'<div class="b-comments"\', 1)[0]', rezka_py)

        with open(os.path.join(ROOT_DIR, "backend", "kinorium.py"), "r", encoding="utf-8") as f:
            kin_py = f.read()
        self.assertNotIn('raw_we_snap = dict(self.state.get("watched_episodes") or {})', kin_py)

    def test_perf_pass2_stage1_player_popovers_xray_and_downloads(self):
        with open(os.path.join(ROOT_DIR, "public", "js", "player-ui-controls.js"), "r", encoding="utf-8") as f:
            ui_js = f.read()
        self.assertIn("!epPop.classList.contains(\"hidden\")", ui_js)
        self.assertIn("!studioPop.classList.contains(\"hidden\")", ui_js)
        self.assertIn("!qualPop.classList.contains(\"hidden\")", ui_js)
        self.assertIn("_cachedSnapCandidates", ui_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            bm_js = f.read()
        self.assertIn("p._xrayCompiledTokens = personObj._xrayCompiledTokens", bm_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "audio-dsp.js"), "r", encoding="utf-8") as f:
            dsp_js = f.read()
        self.assertIn("_playerPrefsCache", dsp_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "utils.js"), "r", encoding="utf-8") as f:
            utils_js = f.read()
        self.assertIn("_watchHistoryCache", utils_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "features-downloads.js"), "r", encoding="utf-8") as f:
            dl_js = f.read()
        self.assertIn("_downloadsRefreshInFlight", dl_js)
        self.assertIn("dataset.dlStructureKey", dl_js)

    def test_perf_pass2_stage2_catalog_modals_calendar_and_scroll(self):
        with open(os.path.join(ROOT_DIR, "public", "js", "modals.js"), "r", encoding="utf-8") as f:
            modals_js = f.read()
        self.assertIn("_qpMetaAbortController", modals_js)
        self.assertIn("item._cachedClientFranchise", modals_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-notifications.js"), "r", encoding="utf-8") as f:
            notif_js = f.read()
        self.assertIn("_calendarInFlightPromise", notif_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-shelves.js"), "r", encoding="utf-8") as f:
            shelves_js = f.read()
        self.assertIn("item._parsedDurationMins", shelves_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-media-resolver.js"), "r", encoding="utf-8") as f:
            resolver_js = f.read()
        self.assertIn("item._cachedFriendsAvg", resolver_js)

        with open(os.path.join(ROOT_DIR, "public", "css", "modals-and-search.css"), "r", encoding="utf-8") as f:
            ms_css = f.read()
        self.assertIn("content-visibility: auto;", ms_css)

    def test_perf_pass2_stage3_sqlite_kinorium_and_downloads_backend(self):
        with open(os.path.join(ROOT_DIR, "backend", "storage_db.py"), "r", encoding="utf-8") as f:
            db_py = f.read()
        self.assertIn("plain_serialized_by_key", db_py)
        self.assertIn("_cache_write_counts", db_py)

        with open(os.path.join(ROOT_DIR, "backend", "kinorium.py"), "r", encoding="utf-8") as f:
            kin_py = f.read()
        self.assertIn("_sections_counts_cache", kin_py)
        self.assertIn("self._save_state(immediate=False, bump_version=True)", kin_py)

        with open(os.path.join(ROOT_DIR, "backend", "downloads.py"), "r", encoding="utf-8") as f:
            dl_py = f.read()
        self.assertIn("self._prefs_cache", dl_py)
        self.assertIn("_defer_save: bool = False", dl_py)

    def test_perf_pass2_stage4_aggregator_stremio_meta_and_streaming(self):
        with open(os.path.join(ROOT_DIR, "backend", "aggregator.py"), "r", encoding="utf-8") as f:
            agg_py = f.read()
        self.assertIn("cached_entry = self._catalog_cache.get(cache_key)", agg_py)
        self.assertIn("dict(cached_entry)", agg_py)

        with open(os.path.join(ROOT_DIR, "backend", "stremio.py"), "r", encoding="utf-8") as f:
            stremio_py = f.read()
        self.assertIn("self._safe_opener", stremio_py)
        self.assertIn("self._addon_executor", stremio_py)

        with open(os.path.join(ROOT_DIR, "backend", "routes", "meta.py"), "r", encoding="utf-8") as f:
            meta_py = f.read()
        self.assertIn("_META_EXECUTOR", meta_py)

        with open(os.path.join(ROOT_DIR, "backend", "hdrezka.py"), "r", encoding="utf-8") as f:
            rezka_py = f.read()
        self.assertIn("scored_found = [(_score_candidate(c), c) for c in found]", rezka_py)

        with open(os.path.join(ROOT_DIR, "backend", "routes", "streaming.py"), "r", encoding="utf-8") as f:
            stream_py = f.read()
        self.assertIn("_HLS_URI_ATTR_RE", stream_py)
        self.assertIn("queue.Queue(maxsize=24)", stream_py)
        self.assertIn("_WEBVTT_CONVERTED_CACHE", stream_py)

    def test_perf_pass3_stage1_player_watchdog_controls_and_subtitles(self):
        with open(os.path.join(ROOT_DIR, "public", "js", "player-watchdog.js"), "r", encoding="utf-8") as f:
            watchdog_js = f.read()
        self.assertIn('typeof v.getVideoPlaybackQuality === "function"', watchdog_js)
        self.assertIn("cancelVideoFrameCallback", watchdog_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-ui-controls.js"), "r", encoding="utf-8") as f:
            controls_js = f.read()
        self.assertIn("dragSheetW = rect.width;", controls_js)
        self.assertIn("dragSheetH = rect.height;", controls_js)
        self.assertIn("if (!video || video.paused || video.ended) return;", controls_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player.js"), "r", encoding="utf-8") as f:
            player_js = f.read()
        self.assertIn("signal: loadAbort.signal", player_js)
        self.assertIn("maxBufferSize: 48 * 1000 * 1000", player_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "subtitles.js"), "r", encoding="utf-8") as f:
            subs_js = f.read()
        self.assertIn("_vocabCacheList", subs_js)
        self.assertIn("_vocabSavedWordsSet", subs_js)
        self.assertIn("let firstCue = null;", subs_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            bm_js = f.read()
        self.assertIn("_momentsCacheList", bm_js)
        self.assertIn("const m = filtered[idx] || filtered.find", bm_js)

    def test_perf_pass3_stage2_catalog_modals_and_css_containment(self):
        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-cards.js"), "r", encoding="utf-8") as f:
            cards_js = f.read()
        self.assertIn("let fallbackSvg = null;", cards_js)
        self.assertIn("const getFallbackSvg = () =>", cards_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-filters.js"), "r", encoding="utf-8") as f:
            filters_js = f.read()
        self.assertIn("_cachedFranchisePoolRef", filters_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-shelves.js"), "r", encoding="utf-8") as f:
            shelves_js = f.read()
        self.assertIn("const scoreMemo = new WeakMap();", shelves_js)
        self.assertIn("renderHero(sourceItems === state.catalogItems ? baseItems : null)", shelves_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-media-resolver.js"), "r", encoding="utf-8") as f:
            resolver_js = f.read()
        self.assertIn("_preferredStudiosCache", resolver_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals-person.js"), "r", encoding="utf-8") as f:
            person_js = f.read()
        self.assertIn("_personModalAbortController", person_js)
        self.assertIn("appendFrom = 0", person_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "utils.js"), "r", encoding="utf-8") as f:
            utils_js = f.read()
        self.assertIn("el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0", utils_js)

        with open(os.path.join(ROOT_DIR, "public", "css", "remote-and-palette.css"), "r", encoding="utf-8") as f:
            remote_css = f.read()
        self.assertIn("contain-intrinsic-size: auto 36px;", remote_css)

    def test_perf_pass3_stage3_doh_net_security_remux_and_streaming(self):
        with open(os.path.join(ROOT_DIR, "backend", "doh.py"), "r", encoding="utf-8") as f:
            doh_py = f.read()
        self.assertIn("self._opener_cache", doh_py)
        self.assertIn("self._doh_inflight", doh_py)

        with open(os.path.join(ROOT_DIR, "backend", "net_security.py"), "r", encoding="utf-8") as f:
            net_sec_py = f.read()
        self.assertIn("_SAFE_PUBLIC_OPENER_CACHE", net_sec_py)

        with open(os.path.join(ROOT_DIR, "backend", "remuxer.py"), "r", encoding="utf-8") as f:
            remux_py = f.read()
        self.assertIn("_CREDITS_CHAPTER_RE", remux_py)
        self.assertIn("self._probe_inflight", remux_py)
        self.assertIn("self._snapshot_cache", remux_py)

        with open(os.path.join(ROOT_DIR, "backend", "routes", "streaming.py"), "r", encoding="utf-8") as f:
            stream_py = f.read()
        self.assertIn("queue.Queue(maxsize=48)", stream_py)
        self.assertIn("private, max-age=300", stream_py)

    def test_perf_pass3_stage4_backup_stream_en_meta_discovery_and_routes(self):
        with open(os.path.join(ROOT_DIR, "backend", "backup_stream.py"), "r", encoding="utf-8") as f:
            bkp_py = f.read()
        self.assertIn("_TORR_OPENER", bkp_py)
        self.assertIn("_DEBRID_API_OPENER", bkp_py)
        self.assertIn("if self._is_torrserver_alive_cached(ttl_sec=3.5):", bkp_py)
        self.assertIn("_BACKUP_SEARCH_EXECUTOR", bkp_py)

        with open(os.path.join(ROOT_DIR, "backend", "en_metadata.py"), "r", encoding="utf-8") as f:
            en_py = f.read()
        self.assertIn("_checked_utc_day", en_py)

        with open(os.path.join(ROOT_DIR, "backend", "aggregator_discovery.py"), "r", encoding="utf-8") as f:
            disc_py = f.read()
        self.assertIn("_DISCOVERY_BG_EXECUTOR", disc_py)

        with open(os.path.join(ROOT_DIR, "backend", "justwatch.py"), "r", encoding="utf-8") as f:
            jw_py = f.read()
        self.assertIn("_JW_PROVIDER_EXECUTOR", jw_py)

        with open(os.path.join(ROOT_DIR, "backend", "routes", "streams.py"), "r", encoding="utf-8") as f:
            streams_py = f.read()
        self.assertIn("_unrel_memo", streams_py)

        with open(os.path.join(ROOT_DIR, "backend", "routes", "meta.py"), "r", encoding="utf-8") as f:
            meta_py = f.read()
        self.assertIn('ctx.person_photo_cache[cache_key] = ("image/svg+xml; charset=utf-8", svg)', meta_py)

    def test_perf_pass4_stage1_remote_seasons_streams_and_hotkeys(self):
        with open(os.path.join(ROOT_DIR, "public", "js", "remote.js"), "r", encoding="utf-8") as f:
            remote_js = f.read()
        self.assertIn("_desktopPushInFlight", remote_js)
        self.assertIn("_cachedSeasonsSnap", remote_js)
        self.assertIn("tickRemotePlaybackTimeUI", remote_js)
        self.assertIn("xrayDomSig", remote_js)
        self.assertIn("activeArrowCls", remote_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-seasons.js"), "r", encoding="utf-8") as f:
            seasons_js = f.read()
        self.assertIn("offlineSavedEpsSet", seasons_js)
        self.assertIn("const epFrag = document.createDocumentFragment();", seasons_js)
        self.assertNotIn("void hoverTipEl.offsetHeight;", seasons_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-streams.js"), "r", encoding="utf-8") as f:
            pstreams_js = f.read()
        self.assertIn("abortActiveVideoListeners();", pstreams_js)
        self.assertNotIn("state.videoListenerAbortController", pstreams_js)
        self.assertIn("state.preloadAbortController", pstreams_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-meta.js"), "r", encoding="utf-8") as f:
            pmeta_js = f.read()
        self.assertIn("state.titleMetaAbortController", pmeta_js)
        self.assertEqual(pmeta_js.count("renderModalGenresAndSubheader(item, m);"), 1)
        self.assertEqual(pmeta_js.count("renderModalCastSection(item, m);"), 1)

        with open(os.path.join(ROOT_DIR, "public", "js", "features-cast.js"), "r", encoding="utf-8") as f:
            cast_js = f.read()
        self.assertIn("_tvDevicesAbortController", cast_js)
        self.assertIn("_handoffAbortController", cast_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "app-hotkeys.js"), "r", encoding="utf-8") as f:
            hotkeys_js = f.read()
        self.assertIn("if (isTypingTarget || e.ctrlKey || e.metaKey || e.altKey || !state.isPlayerOpen)", hotkeys_js)

    def test_perf_pass4_stage2_tv_mode_catalog_i18n_and_modals(self):
        with open(os.path.join(ROOT_DIR, "public", "js", "features-tv-mode.js"), "r", encoding="utf-8") as f:
            tv_js = f.read()
        self.assertIn("_lastRectMap", tv_js)
        self.assertIn("document.hidden", tv_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-notifications.js"), "r", encoding="utf-8") as f:
            notif_js = f.read()
        self.assertIn("_alertedSetCache", notif_js)
        self.assertIn("document.createDocumentFragment()", notif_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-shelves.js"), "r", encoding="utf-8") as f:
            shelves_js = f.read()
        self.assertIn("const cwFrag = document.createDocumentFragment();", shelves_js)
        self.assertIn("const personsFrag = document.createDocumentFragment();", shelves_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-live-search.js"), "r", encoding="utf-8") as f:
            lsearch_js = f.read()
        self.assertIn("_recentSearchesCache", lsearch_js)
        self.assertIn("const hitsFrag = document.createDocumentFragment();", lsearch_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "i18n.js"), "r", encoding="utf-8") as f:
            i18n_js = f.read()
        self.assertIn("_ruTypoCache", i18n_js)
        self.assertIn("_translitCache", i18n_js)
        self.assertIn("_studioTransCache", i18n_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "utils.js"), "r", encoding="utf-8") as f:
            utils_js = f.read()
        self.assertIn("_uiPrefsCache", utils_js)
        self.assertIn("_dateExpandCache", utils_js)
        self.assertIn("_durationLabelCache", utils_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "settings.js"), "r", encoding="utf-8") as f:
            settings_js = f.read()
        self.assertIn("const integFrag = document.createDocumentFragment();", settings_js)
        self.assertIn("const addonsFrag = document.createDocumentFragment();", settings_js)

    def test_perf_pass4_stage3_static_files_subtitles_remote_broker_and_qr(self):
        with open(os.path.join(ROOT_DIR, "backend", "routes", "static_files.py"), "r", encoding="utf-8") as f:
            static_py = f.read()
        self.assertIn("_INDEX_RAW_CACHE", static_py)
        self.assertLess(
            static_py.index("etag = lookup_static_etag(file_path)"),
            static_py.index("content, use_static_gzip = load_cached_static_file("),
        )

        with open(os.path.join(ROOT_DIR, "backend", "routes", "context.py"), "r", encoding="utf-8") as f:
            ctx_py = f.read()
        self.assertIn("_resolved_cache", ctx_py)

        with open(os.path.join(ROOT_DIR, "backend", "request_handler.py"), "r", encoding="utf-8") as f:
            req_py = f.read()
        self.assertIn("def _get_parsed_url_and_qs(self)", req_py)

        with open(os.path.join(ROOT_DIR, "backend", "subtitles.py"), "r", encoding="utf-8") as f:
            subs_py = f.read()
        self.assertIn("_VTT_TS_DOT_RE = re.compile(", subs_py)
        self.assertIn("_MICRODVD_PROBE_RE = re.compile(", subs_py)
        self.assertIn("_CYR_WORD_RUN_RE = re.compile(", subs_py)
        self.assertIn("_LATIN_ACCENT_MIX_RE = re.compile(", subs_py)
        self.assertIn("probe_bytes = data[:65536]", subs_py)
        self.assertIn("self._search_executor = concurrent.futures.ThreadPoolExecutor(", subs_py)
        self.assertIn("_BUILTIN_RU_EN", subs_py)

        with open(os.path.join(ROOT_DIR, "backend", "remote_control.py"), "r", encoding="utf-8") as f:
            rem_ctrl_py = f.read()
        self.assertIn("include_state: bool = True", rem_ctrl_py)
        self.assertIn("def get_state_flags(self)", rem_ctrl_py)
        self.assertIn("def _touch_remote_client_locked(", rem_ctrl_py)

        with open(os.path.join(ROOT_DIR, "backend", "routes", "remote.py"), "r", encoding="utf-8") as f:
            rem_route_py = f.read()
        self.assertIn("update_desktop_state(body, include_state=False)", rem_route_py)
        self.assertIn("get_state_flags()", rem_route_py)

        with open(os.path.join(ROOT_DIR, "backend", "qrcode_svg.py"), "r", encoding="utf-8") as f:
            qr_py = f.read()
        self.assertIn("@functools.lru_cache(maxsize=64)", qr_py)
        self.assertIn("_LAN_IPV4_CACHE", qr_py)

    def test_perf_pass4_stage4_kids_filter_upnp_updater_and_routes(self):
        with open(os.path.join(ROOT_DIR, "backend", "profiles.py"), "r", encoding="utf-8") as f:
            prof_py = f.read()
        self.assertIn("_KIDS_AGE_R_RE = re.compile(", prof_py)
        self.assertIn("_KIDS_SAFE_AGE_RE = re.compile(", prof_py)
        self.assertIn("_KIDS_BLOCKED_TITLE_SHORT_RE = re.compile(", prof_py)
        self.assertIn("_KIDS_BLOCKED_SEVEN_RE = re.compile(", prof_py)
        self.assertIn("_KIDS_BLOCKED_GENRE_WORD_RE = re.compile(", prof_py)
        self.assertIn("filtered_list: List[Dict[str, Any]] = []", prof_py)

        with open(os.path.join(ROOT_DIR, "backend", "aggregator.py"), "r", encoding="utf-8") as f:
            agg_py = f.read()
        self.assertIn("self._catalog_cache[cache_key] = dict(base_payload)", agg_py)

        with open(os.path.join(ROOT_DIR, "backend", "routes", "catalog.py"), "r", encoding="utf-8") as f:
            cat_route_py = f.read()
        self.assertIn("cat_payload = dict(cat_payload)", cat_route_py)

        with open(os.path.join(ROOT_DIR, "backend", "tv_cast.py"), "r", encoding="utf-8") as f:
            tv_cast_py = f.read()
        self.assertIn("_LAN_DESC_OPENER = urllib.request.build_opener(", tv_cast_py)
        self.assertIn("_SOAP_OPENER = urllib.request.build_opener(", tv_cast_py)
        self.assertIn("_UPNP_EXECUTOR = ThreadPoolExecutor(", tv_cast_py)

        with open(os.path.join(ROOT_DIR, "backend", "updater.py"), "r", encoding="utf-8") as f:
            updater_py = f.read()
        self.assertIn("_UPDATER_SSL_CTX", updater_py)
        self.assertIn("_SAFE_OPENER", updater_py)
        self.assertIn("last_reported_bytes", updater_py)

        with open(os.path.join(ROOT_DIR, "backend", "routes", "streaming.py"), "r", encoding="utf-8") as f:
            stream_route_py = f.read()
        self.assertIn("_REMUX_SUB_SRT_CACHE", stream_route_py)
        self.assertIn('handler.headers.get("If-None-Match")', stream_route_py)

    def test_perf_pass5_stage1_player_dsp_subtitles_and_timeline(self):
        with open(os.path.join(ROOT_DIR, "public", "js", "player-remux.js"), "r", encoding="utf-8") as f:
            remux_js = f.read()
        self.assertIn("_cachedEstDurSec", remux_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-seasons.js"), "r", encoding="utf-8") as f:
            seasons_js = f.read()
        self.assertIn("_RU_MONTH_MAP", seasons_js)
        self.assertIn("_effSeasonsMap", seasons_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player.js"), "r", encoding="utf-8") as f:
            player_js = f.read()
        self.assertIn("isOutroEligible", player_js)
        self.assertIn("matchCatalogItemSafe(state.catalogItems, item)", player_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-ui-controls.js"), "r", encoding="utf-8") as f:
            ui_js = f.read()
        self.assertIn("_vcDom", ui_js)
        self.assertIn("_getVcEl", ui_js)
        self.assertIn("state.vcIsIdle", ui_js)
        self.assertIn("containerFrag", ui_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "audio-dsp.js"), "r", encoding="utf-8") as f:
            dsp_js = f.read()
        self.assertIn("skipGearSync", dsp_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "subtitles.js"), "r", encoding="utf-8") as f:
            sub_js = f.read()
        self.assertIn("_SUB_WORD_SPLIT_RE", sub_js)
        self.assertIn("getSubOverlayEl", sub_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            bm_js = f.read()
        self.assertIn("castFrag", bm_js)
        self.assertIn("ostFrag", bm_js)
        self.assertIn("trivFrag", bm_js)
        self.assertIn("_syncXRayScrollButtonsRaf", bm_js)

    def test_perf_pass5_stage2_catalog_hero_modals_and_css(self):
        """Pass-5 Stage 2: Catalog, Hero, Modals, Quick Peek, Downloads and CSS containment optimizations."""
        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-hero.js"), "r", encoding="utf-8") as f:
            hero_js = f.read()
        self.assertIn("_lastHeroPoolSig", hero_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-cards.js"), "r", encoding="utf-8") as f:
            cards_js = f.read()
        self.assertIn("_scrollCloseCtxRaf", cards_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-filters.js"), "r", encoding="utf-8") as f:
            filt_js = f.read()
        self.assertIn("it._franchiseVer === curVer", filt_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-media-resolver.js"), "r", encoding="utf-8") as f:
            cmr_js = f.read()
        self.assertIn("_hasOwnKeys(weMap)", cmr_js)
        self.assertIn("state.liveSeriesUpdatesVersion", cmr_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals.js"), "r", encoding="utf-8") as f:
            modals_js = f.read()
        self.assertIn("qpKinEnabled", modals_js)
        self.assertIn("qpPrimaryPlayTab", modals_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals-stats.js"), "r", encoding="utf-8") as f:
            stats_js = f.read()
        self.assertIn("getTimeFmt", stats_js)
        self.assertIn("getDateFmt", stats_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "features-downloads.js"), "r", encoding="utf-8") as f:
            dl_js = f.read()
        self.assertIn("_cfDlRowMap", dl_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals-person.js"), "r", encoding="utf-8") as f:
            person_js = f.read()
        self.assertIn("_PERSON_MONTH_RE_ENTRIES", person_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "utils.js"), "r", encoding="utf-8") as f:
            utils_js = f.read()
        self.assertIn("_cachedClientSimilarBundle", utils_js)
        self.assertIn("onWindowResize", utils_js)

        with open(os.path.join(ROOT_DIR, "public", "css", "modals-and-search.css"), "r", encoding="utf-8") as f:
            css_modals = f.read()
        self.assertIn(".atv-person-card", css_modals)
        self.assertIn(".atv-fav-item", css_modals)

        with open(os.path.join(ROOT_DIR, "public", "css", "catalog-and-player-layout.css"), "r", encoding="utf-8") as f:
            css_cat = f.read()
        self.assertIn(".atv-curated-row > .atv-poster-item", css_cat)
        self.assertIn(".atv-cal-shelf-card", css_cat)

    def test_perf_pass5_stage3_proxy_dns_anubis_and_streaming(self):
        """Pass-5 Stage 3: Proxy, DNS, Anubis, Net Security, and Streaming Range optimisations."""
        from backend.net_security import (
            _VERIFIED_PUBLIC_IPS_CACHE,
            _VERIFIED_PUBLIC_IPS_LOCK,
            _resolve_verified_public_ips,
            is_allowed_media_source_url,
        )
        from backend.stremio import StremioAddonEngine
        from backend.downloads import OfflineDownloadManager
        import backend.routes.streaming as r_streaming

        # 1. DNS verified IP caching
        res1 = _resolve_verified_public_ips("1.1.1.1", 443)
        self.assertEqual(res1, ["1.1.1.1"])
        with _VERIFIED_PUBLIC_IPS_LOCK:
            self.assertIn(("1.1.1.1", 443), _VERIFIED_PUBLIC_IPS_CACHE)

        # 2. SSRF URL delegation to is_allowed_media_source_url
        self.assertFalse(StremioAddonEngine.is_safe_public_http_url("http://127.0.0.1:8765/foo"))
        self.assertFalse(OfflineDownloadManager._is_safe_aux_url("http://10.0.0.1/bar"))
        self.assertTrue(OfflineDownloadManager._is_safe_aux_url("https://1.1.1.1/test.jpg"))

        # 3. Aux opener cached singleton
        op1 = OfflineDownloadManager._get_aux_opener()
        op2 = OfflineDownloadManager._get_aux_opener()
        self.assertIs(op1, op2)

        # 4. Anubis lock release in doh.py
        with open(os.path.join(ROOT_DIR, "backend", "doh.py"), "r", encoding="utf-8") as f:
            doh_code = f.read()
        self.assertNotIn("with self._anubis_lock:\n                nonce = 0", doh_code)

        # 5. Precompiled Range regexes in streaming
        self.assertTrue(hasattr(r_streaming, "_RANGE_START_RE"))
        self.assertTrue(hasattr(r_streaming, "_RANGE_SINGLE_RE"))
        m = r_streaming._RANGE_START_RE.match("bytes=1048576-")
        self.assertIsNotNone(m)
        self.assertEqual(m.group(1), "1048576")

    def test_perf_pass5_stage4_hdrezka_kinorium_stremio_and_downloads(self):
        """Pass-5 Stage 4: HDRezka trash tokens precomputation, Kinorium summary skip, Stremio Cinemeta parallel query, and Downloads dirty caching."""
        from backend.hdrezka import HDRezkaClient
        from backend.stremio import StremioAddonEngine
        from backend.downloads import OfflineDownloadManager

        # 1. HDRezka trash tokens precomputed at class level
        self.assertTrue(hasattr(HDRezkaClient, "_TRASH_TOKENS"))
        self.assertTrue(hasattr(HDRezkaClient, "_TRASH_SET"))
        self.assertTrue(hasattr(HDRezkaClient, "_EQ_TOKENS"))
        self.assertTrue(hasattr(HDRezkaClient, "_PREFIXED_TRASH"))
        self.assertGreater(len(HDRezkaClient._TRASH_TOKENS), 100)

        # 2. HDRezka stream bundle decoding works with cached trash tokens
        res = HDRezkaClient.decode_rezka_stream_bundle("")
        self.assertEqual(res["qualities"], {})

        # 3. Kinorium status avoids recomputing full account summary
        with open(os.path.join(ROOT_DIR, "backend", "kinorium.py"), "r", encoding="utf-8") as f:
            kin_code = f.read()
        self.assertIn('"profile_name": (self.state.get("account") or {}).get("display_name") or "Киноман"', kin_code)

        # 4. Stremio Cinemeta parallel search & year regex
        with open(os.path.join(ROOT_DIR, "backend", "stremio.py"), "r", encoding="utf-8") as f:
            stremio_code = f.read()
        self.assertIn("ThreadPoolExecutor", stremio_code)
        self.assertIn("_YEAR_EXTRACT_RE", stremio_code)

        # 5. Downloads dirty tracking
        with open(os.path.join(ROOT_DIR, "backend", "downloads.py"), "r", encoding="utf-8") as f:
            dl_code = f.read()
        self.assertIn("dirty = False", dl_code)
        self.assertIn("if dirty:", dl_code)

    def test_perf_pass6_player_catalog_streaming_and_kinorium(self):
        """Pass-6: Watchdog ABR memoization, Roulette non-destructive updates, Curated shelves signature caching, named pump threads & Kinorium summary memoization."""
        # 1. Player watchdog ABR precompiled regex and ladder caching
        with open(os.path.join(ROOT_DIR, "public", "js", "player-watchdog.js"), "r", encoding="utf-8") as f:
            watchdog_code = f.read()
        self.assertIn("_QUALITY_NUM_RE = /(\\d{3,4})p?/", watchdog_code)
        self.assertIn("_QUALITY_SCORE_CACHE = new Map()", watchdog_code)
        self.assertIn("_QUALITIES_LADDER_CACHE = new WeakMap()", watchdog_code)

        # 2. Roulette DOM updates preserve container and cache meta HTML
        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-discovery.js"), "r", encoding="utf-8") as f:
            roulette_code = f.read()
        self.assertIn("_lastMetaHtml", roulette_code)
        self.assertIn("atv-roulette-card-actions", roulette_code)

        # 3. Curated shelves signature memoization & live search filter reset check
        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-shelves.js"), "r", encoding="utf-8") as f:
            shelves_code = f.read()
        self.assertIn("_lastCuratedShelvesSig", shelves_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-live-search.js"), "r", encoding="utf-8") as f:
            search_code = f.read()
        self.assertIn('if (gSel && gSel.value !== "all")', search_code)
        self.assertIn('if (ySel && ySel.value !== "all")', search_code)

        # 4. Streaming pump threads named and queues drained
        with open(os.path.join(ROOT_DIR, "backend", "routes", "streaming.py"), "r", encoding="utf-8") as f:
            streaming_code = f.read()
        self.assertIn('thread_name_prefix="VelariumProxyPump"', streaming_code)
        self.assertIn('name="VelariumFFmpegPump"', streaming_code)
        self.assertIn('name="VelariumMp4DlPump"', streaming_code)
        self.assertIn("while not dl_q.empty():", streaming_code)
        self.assertIn("while not chunk_queue.empty():", streaming_code)

        # 5. Kinorium summary memoization with state version invalidation
        from backend.kinorium import KinoriumService
        with tempfile.TemporaryDirectory() as tmp_kin:
            kin_svc = KinoriumService(None, storage_dir=tmp_kin, register_atexit=False, start_background_workers=False)
            with kin_svc._state_lock:
                kin_svc.state["account"] = {
                    "connected": True,
                    "user_id": "12345",
                    "display_name": "TestUser",
                }
                kin_svc.state["cw_dismissed"] = ["100", "200"]
                kin_svc._state_version += 1

            sum1 = kin_svc.get_account_summary()
            self.assertEqual(sum1["display_name"], "TestUser")
            self.assertEqual(sum1["cw_dismissed_count"], 2)

            # Verify memoization
            sum2 = kin_svc.get_account_summary()
            self.assertEqual(sum1, sum2)

            # Version / state change invalidates cache
            with kin_svc._state_lock:
                kin_svc.state["account"]["display_name"] = "UpdatedUser"
                kin_svc._state_version += 1
            sum3 = kin_svc.get_account_summary()
            self.assertEqual(sum3["display_name"], "UpdatedUser")

    def test_perf_pass7_player_catalog_proxy_and_storage(self):
        """Pass-7: Player rVFC/progress/hover/X-Ray, Catalog pre-signature/hero/modals/CSS, Proxy DNS cache/Anubis sha256.copy()/TorrServer pool, and Backend O(1) indices."""
        # Stage 1: Player, Video Controls, X-Ray, Subtitles & 4K Streams
        with open(os.path.join(ROOT_DIR, "public", "js", "player.js"), "r", encoding="utf-8") as f:
            player_code = f.read()
        self.assertIn("stopVideoFrameCounter(", player_code)
        self.assertIn("_lastProgressSyncTs", player_code)
        self.assertIn("state._filteredStremioCandidates = null", player_code)
        self.assertIn("state._launchStremioStreamCandidate = null", player_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-seasons.js"), "r", encoding="utf-8") as f:
            seasons_code = f.read()
        self.assertIn("_ISO_DATE_PREFIX_RE", seasons_code)
        self.assertIn("getTodayIsoDate()", seasons_code)
        self.assertIn("watchedInSeasonCount", seasons_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-autoplay.js"), "r", encoding="utf-8") as f:
            autoplay_code = f.read()
        self.assertIn("_cachedNextEpKey", autoplay_code)
        self.assertIn("_cachedNextEpVal", autoplay_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-ui-controls.js"), "r", encoding="utf-8") as f:
            ui_ctrl_code = f.read()
        self.assertIn("if (!state.isPlayerOpen) return;", ui_ctrl_code)
        self.assertIn("_lastHoverKey", ui_ctrl_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            bookmarks_code = f.read()
        self.assertIn("cancelAnimationFrame(_xrayRafSyncId)", bookmarks_code)
        self.assertIn('  } else {\n    _renderXRayCastSection(item, sceneCtx);', bookmarks_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "subtitles.js"), "r", encoding="utf-8") as f:
            subs_code = f.read()
        self.assertIn("_contextAttr", subs_code)
        self.assertIn('text.includes("\\\\")', subs_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-streams-4k.js"), "r", encoding="utf-8") as f:
            s4k_code = f.read()
        self.assertIn("const stFrag = document.createDocumentFragment();", s4k_code)
        self.assertIn("const relFrag = document.createDocumentFragment();", s4k_code)

        # Stage 2: Catalog Shelves, Hero, Live Search, Quick Peek Modals & CSS Containment
        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-shelves.js"), "r", encoding="utf-8") as f:
            shelves_code = f.read()
        self.assertIn("_lastCuratedInputSig", shelves_code)
        self.assertIn("friendsScored.push({ it, avg });", shelves_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-hero.js"), "r", encoding="utf-8") as f:
            hero_code = f.read()
        self.assertIn("if (picked.length < 6)", hero_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog.js"), "r", encoding="utf-8") as f:
            cat_code = f.read()
        self.assertIn("state.catalogIndexVersion = (Number(state.catalogIndexVersion) || 0) + 1;", cat_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-live-search.js"), "r", encoding="utf-8") as f:
            live_search_code = f.read()
        self.assertIn("_searchTitleLow", live_search_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals.js"), "r", encoding="utf-8") as f:
            modals_code = f.read()
        self.assertIn("_baseFranchiseKey", modals_code)
        self.assertIn("hasExplicitWatchedEpisodes", modals_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-notifications.js"), "r", encoding="utf-8") as f:
            notif_code = f.read()
        self.assertIn("_lastCalShelfSig", notif_code)
        self.assertIn("_lastNotifSig", notif_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals-stats.js"), "r", encoding="utf-8") as f:
            stats_code = f.read()
        self.assertIn("_relDateTodayStr", stats_code)

        with open(os.path.join(ROOT_DIR, "public", "css", "catalog-and-player-layout.css"), "r", encoding="utf-8") as f:
            css_layout = f.read()
        self.assertIn(".atv-poster-item.is-entering", css_layout)
        self.assertIn("body.player-modal-open .atv-main", css_layout)

        # Stage 3: Network Proxy, DNS Cache, DoH Anubis PoW & TorrServer Preflight Pool
        with open(os.path.join(ROOT_DIR, "backend", "net_security.py"), "r", encoding="utf-8") as f:
            net_sec_code = f.read()
        self.assertIn("verified_ips = _resolve_verified_public_ips(target_host, int(port))", net_sec_code)

        with open(os.path.join(ROOT_DIR, "backend", "doh.py"), "r", encoding="utf-8") as f:
            doh_code = f.read()
        self.assertIn("_ANUBIS_SCRIPT_RE", doh_code)
        self.assertIn("base_hash = hashlib.sha256(rand_bytes)", doh_code)
        self.assertIn("h = base_hash.copy()", doh_code)

        with open(os.path.join(ROOT_DIR, "backend", "routes", "streaming.py"), "r", encoding="utf-8") as f:
            stream_code = f.read()
        self.assertIn("_HTTP_RANGE_RE", stream_code)
        self.assertIn("prev_p.stdout.close()", stream_code)

        with open(os.path.join(ROOT_DIR, "backend", "backup_stream.py"), "r", encoding="utf-8") as f:
            backup_code = f.read()
        self.assertIn("self._torr_preflight_pool", backup_code)

        # Stage 4: Aggregator O(1) Curated Lookup & Alias Cache, Stremio Single-Row Write, Kinorium Local Index
        with open(os.path.join(ROOT_DIR, "backend", "aggregator.py"), "r", encoding="utf-8") as f:
            agg_code = f.read()
        self.assertIn("self._curated_by_id", agg_code)
        self.assertIn("self._curated_by_imdb", agg_code)
        self.assertIn("self._curated_by_rezka", agg_code)
        self.assertIn("self._curated_by_title_low", agg_code)
        self.assertIn("_ITEM_ALIASES_CACHE", agg_code)

        from backend.aggregator import UnifiedCinemaAggregator
        sample_item = {"title": "Фильм по мотивам сериала Тест", "orig_title": "Test Movie"}
        aliases_1 = UnifiedCinemaAggregator._extract_item_aliases(sample_item)
        aliases_2 = UnifiedCinemaAggregator._extract_item_aliases(sample_item)
        self.assertIs(aliases_1, aliases_2)
        self.assertIn("тест", aliases_1)

        with open(os.path.join(ROOT_DIR, "backend", "stremio.py"), "r", encoding="utf-8") as f:
            stremio_code = f.read()
        self.assertIn('self._db.set_cache_entry("stremio_imdb", cache_key, best_tt)', stremio_code)

        with open(os.path.join(ROOT_DIR, "backend", "kinorium.py"), "r", encoding="utf-8") as f:
            kin_code = f.read()
        self.assertIn("_local_status_idx_key", kin_code)
        self.assertIn("_local_status_idx_val", kin_code)

    def test_perf_pass8_player_catalog_proxy_and_wal(self):
        """Pass-8 audit: verifies player media decoder release, O(1) catalog/CW lookups, proxy socket pool hygiene, and SQLite hash-diff cache."""
        # Stage 1: Player, Subtitle Window Abort, X-Ray Deduplication & Remote Snapshot TTL
        with open(os.path.join(ROOT_DIR, "public", "js", "player.js"), "r", encoding="utf-8") as f:
            player_code = f.read()
        self.assertIn("stopVideoFrameCounter(video);", player_code)
        self.assertIn('video.removeAttribute("src");', player_code)
        self.assertIn("matchCatalogItemSafe(state.catalogItems", player_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-ui-controls.js"), "r", encoding="utf-8") as f:
            ui_controls_code = f.read()
        self.assertNotIn("state.seriesEpisodesTitles", ui_controls_code)
        self.assertIn("timeBtn._lastScrubSec", ui_controls_code)
        self.assertIn("scheduleDesktopRemoteStatePush(120);", ui_controls_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-streams.js"), "r", encoding="utf-8") as f:
            streams_code = f.read()
        self.assertIn("signal: preloadAbort.signal", streams_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "subtitles.js"), "r", encoding="utf-8") as f:
            subs_code = f.read()
        self.assertIn("state.subWindowAbortController", subs_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            bm_code = f.read()
        self.assertIn("item._xrayFetching = langKey;", bm_code)
        self.assertIn("container._lastBookmarkSig = bmSig;", bm_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-seasons.js"), "r", encoding="utf-8") as f:
            seasons_code = f.read()
        self.assertIn('findAllOfflineDownloadsForTitle(item, null, null, ["completed"])', seasons_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "remote.js"), "r", encoding="utf-8") as f:
            remote_code = f.read()
        self.assertIn("nowSnapMs - _cachedSeasonsSnapTs < 30000", remote_code)

        # Stage 2: O(1) Catalog & CW Indexing, Progress Epoch, DisplayTitle Memoization & CSS Layer Diet
        with open(os.path.join(ROOT_DIR, "public", "js", "utils.js"), "r", encoding="utf-8") as f:
            utils_code = f.read()
        self.assertIn("export function getLocalProgressEpoch()", utils_code)
        self.assertIn("const _YEAR_SUFFIX_RE =", utils_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-media-resolver.js"), "r", encoding="utf-8") as f:
            resolver_code = f.read()
        self.assertIn("getLocalProgressEpoch()", resolver_code)
        self.assertIn("_cwByTitle.set(ol, cw)", resolver_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "i18n.js"), "r", encoding="utf-8") as f:
            i18n_code = f.read()
        self.assertIn("_dtCacheVal", i18n_code)
        self.assertIn("_POLISH_POSTER_SLUG_RE", i18n_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "features-tv-mode.js"), "r", encoding="utf-8") as f:
            tv_code = f.read()
        self.assertIn("_currentTvFocusedEl", tv_code)

        with open(os.path.join(ROOT_DIR, "public", "css", "catalog-and-player-layout.css"), "r", encoding="utf-8") as f:
            css_layout = f.read()
        self.assertIn(".atv-curated-row > .atv-poster-item", css_layout)

        # Stage 3 & 4: Proxy Socket Pool Hygiene, Fast HLS Rewrite, Persistent Search Pool & SQLite Hash Cache
        with open(os.path.join(ROOT_DIR, "backend", "routes", "streaming.py"), "r", encoding="utf-8") as f:
            stream_code = f.read()
        self.assertIn("_LOOPBACK_DIRECT_OPENER", stream_code)
        self.assertIn("pump_future.result(timeout=0.3)", stream_code)
        self.assertIn("quoted_base_dir", stream_code)

        from backend.routes.streaming import _rewrite_hls_manifest_for_proxy
        sample_m3u8 = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg_001.ts\n#EXTINF:6.0,\nseg_002.ts\n"
        rewritten = _rewrite_hls_manifest_for_proxy(sample_m3u8, "https://stream.voidboost.cc/hls/1080p/index.m3u8")
        self.assertIn("/api/proxy-stream?url=https%3A%2F%2Fstream.voidboost.cc%2Fhls%2F1080p%2Fseg_001.ts", rewritten)
        self.assertIn("/api/proxy-stream?url=https%3A%2F%2Fstream.voidboost.cc%2Fhls%2F1080p%2Fseg_002.ts", rewritten)

        with open(os.path.join(ROOT_DIR, "backend", "remuxer.py"), "r", encoding="utf-8") as f:
            remux_code = f.read()
        self.assertIn('"_failed": True', remux_code)

        with open(os.path.join(ROOT_DIR, "backend", "stremio.py"), "r", encoding="utf-8") as f:
            stremio_code = f.read()
        self.assertNotIn("with ThreadPoolExecutor", stremio_code)
        self.assertIn("self._addon_executor.map(_fetch_type, types_to_query)", stremio_code)

        with open(os.path.join(ROOT_DIR, "backend", "aggregator.py"), "r", encoding="utf-8") as f:
            agg_code = f.read()
        self.assertIn('thread_name_prefix="VelariumSearch"', agg_code)
        self.assertIn("_ITEM_ALIASES_LOCK", agg_code)

        with open(os.path.join(ROOT_DIR, "backend", "storage_db.py"), "r", encoding="utf-8") as f:
            db_code = f.read()
        self.assertIn("self._cache_entry_hashes", db_code)

        with open(os.path.join(ROOT_DIR, "backend", "downloads.py"), "r", encoding="utf-8") as f:
            dl_code = f.read()
        self.assertIn("self._cancelled_ids.discard(did)", dl_code)

    def test_perf_pass9_player_catalog_proxy_and_wal(self) -> None:
        """Pass 9 deep performance, memory & micro-freeze optimizations across player, catalog, proxy & WAL."""
        # Stage 1: Player, WebAudio DSP, Subtitles, Timeline & Remote Sync
        with open(os.path.join(ROOT_DIR, "public", "js", "remote.js"), "r", encoding="utf-8") as f:
            remote_code = f.read()
        self.assertIn("if (!force && !_hasActiveRemoteOrPairingModal()) return;", remote_code)
        self.assertIn("_hasActiveRemoteOrPairingModal() &&", remote_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "audio-dsp.js"), "r", encoding="utf-8") as f:
            dsp_code = f.read()
        self.assertIn("source.connect(state.audioNodes.prePadGain);", dsp_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "subtitles.js"), "r", encoding="utf-8") as f:
            sub_code = f.read()
        self.assertIn("subMeta._lastAdvanceAttemptTs", sub_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-ui-controls.js"), "r", encoding="utf-8") as f:
            ui_ctrl_code = f.read()
        self.assertIn('_getVcEl("vc-studio-popover")', ui_ctrl_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-intro-credits.js"), "r", encoding="utf-8") as f:
            intro_code = f.read()
        self.assertIn("container._lastChaptersSig", intro_code)

        # Stage 2: Catalog, Filters, Modals & CSS Layers
        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-media-resolver.js"), "r", encoding="utf-8") as f:
            resolver_code = f.read()
        self.assertIn("function _computeCwStamp(arr)", resolver_code)
        self.assertIn("state.catalogIndexVersion = (state.catalogIndexVersion || 0) + 1;", resolver_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-live-search.js"), "r", encoding="utf-8") as f:
            search_code = f.read()
        self.assertIn("it._searchCastLow", search_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-notifications.js"), "r", encoding="utf-8") as f:
            notif_code = f.read()
        self.assertIn("_notifCacheEpoch", notif_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-hero.js"), "r", encoding="utf-8") as f:
            hero_code = f.read()
        self.assertIn("state._lastHeroSlideSig", hero_code)
        self.assertIn("state.kinoriumSection", hero_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "utils.js"), "r", encoding="utf-8") as f:
            utils_code = f.read()
        self.assertIn("const scheduleSyncChevronState = () => {", utils_code)

        # Stage 3 & 4: Proxy Socket Pool Keep-Alive, Incremental SQLite Hash Cache & Bounded Mutation Pool
        with open(os.path.join(ROOT_DIR, "backend", "routes", "streaming.py"), "r", encoding="utf-8") as f:
            stream_code = f.read()
        self.assertIn("conn_box: List[Any] = [conn, upstream, False]", stream_code)
        self.assertIn("_REMUX_SUB_SRT_LOCK", stream_code)
        self.assertIn('getattr(resp, "length", None) in (0, None)', stream_code)

        from backend.routes.streaming import _rewrite_hls_manifest_for_proxy
        rel_m3u8 = "#EXTM3U\n#EXTINF:6.0,\nsub/../seg_001.ts\n"
        rewritten_rel = _rewrite_hls_manifest_for_proxy(rel_m3u8, "https://stream.voidboost.cc/hls/1080p/index.m3u8")
        self.assertIn("https%3A%2F%2Fstream.voidboost.cc%2Fhls%2F1080p%2Fseg_001.ts", rewritten_rel)

        with open(os.path.join(ROOT_DIR, "backend", "storage_db.py"), "r", encoding="utf-8") as f:
            db_code = f.read()
        self.assertIn("prev_hashes[skey] = payload_hash", db_code)

        with open(os.path.join(ROOT_DIR, "backend", "kinorium_mutations.py"), "r", encoding="utf-8") as f:
            mut_code = f.read()
        self.assertIn("_KIN_MUTATION_EXECUTOR", mut_code)

        with open(os.path.join(ROOT_DIR, "backend", "backup_stream.py"), "r", encoding="utf-8") as f:
            bkp_code = f.read()
        self.assertIn("_SCRUB_TECH_RE =", bkp_code)
        self.assertIn("self._torr_preflight_pool.submit(_bg_warm)", bkp_code)

    def test_perf_pass10_player_catalog_proxy_and_wal(self) -> None:
        """Pass 10 deep performance, memory & micro-freeze optimizations across player, catalog, proxy & WAL."""
        # Stage 1: Player, Episodes, Subtitles, Remux & Mobile Remote
        with open(os.path.join(ROOT_DIR, "public", "js", "player-seasons.js"), "r", encoding="utf-8") as f:
            seasons_code = f.read()
        self.assertIn("epStripBar.dataset.seasonSig === epStripSeasonSig", seasons_code)
        self.assertIn("epStripBar.dataset.renderSig === epStripRenderSig", seasons_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-ui-controls.js"), "r", encoding="utf-8") as f:
            ui_ctrl_code = f.read()
        self.assertIn("epPop.dataset.renderSig === epPopSig", ui_ctrl_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "subtitles.js"), "r", encoding="utf-8") as f:
            sub_code = f.read()
        self.assertIn("_sessionParsedSubCache", sub_code)
        self.assertIn("prevTokenizedMap.get(", sub_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-streams.js"), "r", encoding="utf-8") as f:
            pstreams_code = f.read()
        self.assertIn("_officialEmbedRectRafPending", pstreams_code)
        self.assertIn("_lastOfficialEmbedRectSig", pstreams_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-remux.js"), "r", encoding="utf-8") as f:
            premux_code = f.read()
        self.assertIn("state.remuxDurationReprobeAbort = reprobeAbort;", premux_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "remote.js"), "r", encoding="utf-8") as f:
            remote_code = f.read()
        self.assertIn("_cachedRemoteSelectsSig", remote_code)
        self.assertIn("_cachedRemoteChaptersKey", remote_code)
        self.assertIn("const scale = dist > 0 ? dampedDist / dist : 0;", remote_code)

        # Stage 2: Catalog, Filters, Modals & CSS Compositing
        with open(os.path.join(ROOT_DIR, "public", "js", "utils.js"), "r", encoding="utf-8") as f:
            utils_code = f.read()
        self.assertIn("popoverEl.offsetParent.getBoundingClientRect()", utils_code)
        self.assertIn("_cselectScrollRaf", utils_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-media-resolver.js"), "r", encoding="utf-8") as f:
            resolver_code = f.read()
        self.assertIn("_cwFastStampVal", resolver_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-filters.js"), "r", encoding="utf-8") as f:
            filters_code = f.read()
        self.assertIn("genreSel._optionsSig !== genreOptsSig", filters_code)
        self.assertIn("_lastFilteredCatalogResult", filters_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "i18n.js"), "r", encoding="utf-8") as f:
            i18n_code = f.read()
        self.assertIn("item._genreEntriesCacheKey", i18n_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals.js"), "r", encoding="utf-8") as f:
            modals_code = f.read()
        self.assertIn("wrap._lastQpEpSig === qpEpSig", modals_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals-stats.js"), "r", encoding="utf-8") as f:
            stats_code = f.read()
        self.assertIn("_lastWatchWrapVal", stats_code)

        with open(os.path.join(ROOT_DIR, "public", "css", "settings-and-episodes.css"), "r", encoding="utf-8") as f:
            set_css = f.read()
        self.assertIn("#autoplay-next-card:not(.hidden) .atv-autoplay-fill {", set_css)

        # Stage 3 & 4: Proxy Socket Pool Keep-Alive, DoH Anubis Lock, Precompiled VTT Regexes & SQLite Hash Unification
        with open(os.path.join(ROOT_DIR, "backend", "routes", "streaming.py"), "r", encoding="utf-8") as f:
            stream_code = f.read()
        self.assertIn("if head_only:\n            conn_reusable = True", stream_code)
        self.assertIn("evict_keys = list(_REMUX_SUB_SRT_CACHE.keys())[:16]", stream_code)

        with open(os.path.join(ROOT_DIR, "backend", "doh.py"), "r", encoding="utf-8") as f:
            doh_code = f.read()
        self.assertIn("with self._anubis_lock:", doh_code)
        self.assertIn("decode_body: bool = True", doh_code)

        with open(os.path.join(ROOT_DIR, "backend", "stremio.py"), "r", encoding="utf-8") as f:
            stremio_code = f.read()
        self.assertIn("_VTT_TIME_CUE_RE = re.compile(", stremio_code)

        with open(os.path.join(ROOT_DIR, "backend", "storage_db.py"), "r", encoding="utf-8") as f:
            db_code = f.read()
        self.assertIn("v_hash = hash(v_json)", db_code)
        self.assertIn("ns_hashes.clear()", db_code)

        with open(os.path.join(ROOT_DIR, "backend", "aggregator.py"), "r", encoding="utf-8") as f:
            agg_code = f.read()
        self.assertIn('thread_name_prefix="VelariumEnPrewarm"', agg_code)

    def test_perf_pass11_player_catalog_proxy_and_wal(self):
        # Stage 1: Player, Episodes, Subtitles, X-Ray & Mobile Remote
        with open(os.path.join(ROOT_DIR, "public", "js", "player-seasons.js"), "r", encoding="utf-8") as f:
            ps_code = f.read()
        self.assertIn("epStripBar._epStripDelegatedBound = true;", ps_code)
        self.assertIn("epBtn.dataset.tipHead", ps_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-ui-controls.js"), "r", encoding="utf-8") as f:
            vc_code = f.read()
        self.assertIn("state._cachedTodayIso", vc_code)
        self.assertIn("container.dataset.renderSig === studioSig", vc_code)
        self.assertIn("qualPop.dataset.renderSig !== qualPopSig", vc_code)
        self.assertIn("nowMs - (state._lastVcActiveSyncTs || 0) < 90", vc_code)
        self.assertIn("cachedTimelineRectTs", vc_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "subtitles.js"), "r", encoding="utf-8") as f:
            subs_code = f.read()
        self.assertIn("subsPop.dataset.renderSig === subsPopSig", subs_code)
        self.assertIn("clearSeamlessEpisodeBridge(true);", subs_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            bm_code = f.read()
        self.assertIn("_syncXRayScrollButtonsRaf();", bm_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-watchdog.js"), "r", encoding="utf-8") as f:
            wd_code = f.read()
        self.assertIn("_QUALITY_SCORE_CACHE.size >= 200", wd_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "remote.js"), "r", encoding="utf-8") as f:
            rm_code = f.read()
        self.assertIn('rState.previewAudio.removeAttribute("src");', rm_code)
        self.assertIn("_getRmTickEl(", rm_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "app-hotkeys.js"), "r", encoding="utf-8") as f:
            hk_code = f.read()
        self.assertIn("_getHotkeyModalEl(", hk_code)

        # Stage 2: Catalog Grids, TV Spatial Navigation, Live Search, Settings & Utils
        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-cards.js"), "r", encoding="utf-8") as f:
            cards_code = f.read()
        self.assertIn("gridEl._gridRenderSig === gridRenderSig", cards_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "features-tv-mode.js"), "r", encoding="utf-8") as f:
            tv_code = f.read()
        self.assertIn("_tvNavCache", tv_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-filters.js"), "r", encoding="utf-8") as f:
            cf_code = f.read()
        self.assertIn("chipsBar._chipsSig === chipsSig", cf_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog.js"), "r", encoding="utf-8") as f:
            cat_code = f.read()
        self.assertIn("sel._optionsSig === friendsSig", cat_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-media-resolver.js"), "r", encoding="utf-8") as f:
            cmr_code = f.read()
        self.assertIn("ks.watched_episodes._weTotal", cmr_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-live-search.js"), "r", encoding="utf-8") as f:
            cls_code = f.read()
        self.assertIn("state._catalogPersonIndex", cls_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "settings.js"), "r", encoding="utf-8") as f:
            set_code = f.read()
        self.assertIn("listEl._integrationsSig === integSig", set_code)
        self.assertIn("listEl._addonsSig === addonsSig", set_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "utils.js"), "r", encoding="utf-8") as f:
            ut_code = f.read()
        self.assertIn("_velariumDebugCached", ut_code)

        # Stage 3 & 4: Backend Proxy Keep-Alive, Remux Probe Inflight, SQLite Dedup & Aggregator
        with open(os.path.join(ROOT_DIR, "backend", "routes", "streaming.py"), "r", encoding="utf-8") as f:
            st_code = f.read()
        self.assertIn('str(getattr(resp, "_method", "") or "").upper() == "HEAD"', st_code)
        self.assertIn("if not head_only and expected_len > 0 and bytes_forwarded < expected_len:", st_code)

        with open(os.path.join(ROOT_DIR, "backend", "remuxer.py"), "r", encoding="utf-8") as f:
            rx_code = f.read()
        self.assertIn("inflight_key = f\"{cache_key}:{'fast' if fast_probe else 'full'}\"", rx_code)

        with open(os.path.join(ROOT_DIR, "backend", "storage_db.py"), "r", encoding="utf-8") as f:
            sdb_code = f.read()
        self.assertIn("if prev_hashes.get(skey) == payload_hash:", sdb_code)

        with open(os.path.join(ROOT_DIR, "backend", "aggregator.py"), "r", encoding="utf-8") as f:
            ag_code = f.read()
        self.assertIn("self._build_continue_watching_list(ui_lang=ui_lang, watching_new_eps=watching_new_eps)", ag_code)

        with open(os.path.join(ROOT_DIR, "backend", "routes", "meta.py"), "r", encoding="utf-8") as f:
            mt_code = f.read()
        self.assertIn("_CURATED_KEY_PATTERNS", mt_code)

    def test_perf_pass12_player_catalog_proxy_and_wal(self):
        # Stage 1: Player, Preloader, X-Ray, Seasons, Hotkeys & Remote
        with open(os.path.join(ROOT_DIR, "public", "js", "player-streams.js"), "r", encoding="utf-8") as f:
            pst_code = f.read()
        self.assertIn("clearRemuxDurationPoll();", pst_code)
        self.assertIn("state.providerLinkAbortController", pst_code)
        self.assertIn("state._preloadFailedKey", pst_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player.js"), "r", encoding="utf-8") as f:
            pl_code = f.read()
        self.assertIn("clearRemuxDurationPoll();", pl_code)
        self.assertIn('"xrayAbortController"', pl_code)
        self.assertIn('"providerLinkAbortController"', pl_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            bm_code = f.read()
        self.assertIn("state.xrayAbortController = xrayAbort;", bm_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-seasons.js"), "r", encoding="utf-8") as f:
            ps_code = f.read()
        self.assertIn("const epStateMap = new Map();", ps_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "remote.js"), "r", encoding="utf-8") as f:
            rm_code = f.read()
        self.assertIn('const xrayShelfEl = document.getElementById("xray-pause-shelf");', rm_code)
        self.assertIn("muteBtn.dataset.ico !== muteIcoKey", rm_code)
        self.assertIn("mPlayBtn.dataset.ico !== mPlayIcoKey", rm_code)

        # Stage 2: Catalog, Modals, Profiles, TV Mode, Custom Selects & CSS
        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-shelves.js"), "r", encoding="utf-8") as f:
            cs_code = f.read()
        self.assertIn("grid._cwRenderSig === cwRenderSig", cs_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals.js"), "r", encoding="utf-8") as f:
            md_code = f.read()
        self.assertIn("castRow._qpCastSig === castSig", md_code)
        self.assertIn("frList._qpFranchiseSig === frSig", md_code)
        self.assertIn("simList._qpSimilarSig === simSig", md_code)
        self.assertIn("const scheduleSyncState = () => {", md_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals-stats.js"), "r", encoding="utf-8") as f:
            ms_code = f.read()
        self.assertIn("histBody._histRenderSig === histRenderSig", ms_code)
        self.assertIn("_statsFetchAbortController", ms_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-filters.js"), "r", encoding="utf-8") as f:
            cf_code = f.read()
        self.assertIn("_lastSortedCatalogResult", cf_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "utils.js"), "r", encoding="utf-8") as f:
            ut_code = f.read()
        self.assertIn("selectEl._cfSyncSig === syncSig", ut_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "settings-onboarding.js"), "r", encoding="utf-8") as f:
            so_code = f.read()
        self.assertIn("sel._countryUiSig !== countryUiSig", so_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "features-profiles.js"), "r", encoding="utf-8") as f:
            fp_code = f.read()
        self.assertIn("pop._profSwitcherSig === profSwitcherSig", fp_code)
        self.assertIn("cardsEl._profModalSig !== cardsSig", fp_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "i18n.js"), "r", encoding="utf-8") as f:
            i18n_code = f.read()
        self.assertIn("_lastAppliedStaticDomLang", i18n_code)

        # Stage 3 & 4: Backend Proxy, Remuxer, Downloads, SQLite WAL, Kinorium, HDRezka, Aggregator & Remote Broker
        with open(os.path.join(ROOT_DIR, "backend", "routes", "streaming.py"), "r", encoding="utf-8") as f:
            st_code = f.read()
        self.assertIn("abort_event: Optional[threading.Event] = None", st_code)
        self.assertIn("_REMUX_CLEANUP_POOL.submit(_terminate_and_reap_proc, prev_p)", st_code)
        self.assertIn("_REMUX_TEMP_SUB_FILES", st_code)

        with open(os.path.join(ROOT_DIR, "backend", "downloads.py"), "r", encoding="utf-8") as f:
            dl_code = f.read()
        self.assertIn("active_p.wait(timeout=1.5)", dl_code)
        self.assertIn("self._save_single_progress_locked(did)", dl_code)

        with open(os.path.join(ROOT_DIR, "backend", "storage_db.py"), "r", encoding="utf-8") as f:
            sdb_code = f.read()
        self.assertIn("DELETE FROM cache_entries WHERE cache_name = ? AND updated_at < ?;", sdb_code)

        with open(os.path.join(ROOT_DIR, "backend", "kinorium.py"), "r", encoding="utf-8") as f:
            kin_code = f.read()
        self.assertIn("state_snapshot = {", kin_code)

        with open(os.path.join(ROOT_DIR, "backend", "hdrezka.py"), "r", encoding="utf-8") as f:
            rz_code = f.read()
        self.assertIn("meta_copy = self._clone_page_meta(meta)", rz_code)

        with open(os.path.join(ROOT_DIR, "backend", "aggregator.py"), "r", encoding="utf-8") as f:
            ag_code = f.read()
        self.assertIn("self._en_prewarm_pool.submit(_bg_en_warm)", ag_code)
        self.assertIn('p["_match_score"] = sc_val', ag_code)

        with open(os.path.join(ROOT_DIR, "backend", "remote_control.py"), "r", encoding="utf-8") as f:
            rc_code = f.read()
        self.assertIn("if state_changed or (now - prev_seen) >= 1.5:", rc_code)

    def test_perf_pass13_player_catalog_proxy_and_wal(self) -> None:
        # Stage 1: Video Player, X-Ray, Subtitles, WebAudio DSP, Watchdog & Mobile Remote
        with open(os.path.join(ROOT_DIR, "public", "js", "player-ui-controls.js"), "r", encoding="utf-8") as f:
            puc_code = f.read()
        self.assertIn("function _onVcIdleTimeout()", puc_code)
        self.assertIn("_lastActiveChapterKey", puc_code)
        self.assertIn("hoverTimeEl._lastHoverLeftPct !== clampedLeftStr", puc_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "remote.js"), "r", encoding="utf-8") as f:
            rm_code = f.read()
        self.assertIn("entry._xrayCompiledTokens = personObj._xrayCompiledTokens;", rm_code)
        self.assertIn("state.xrayAbortController = rmXrayAbort;", rm_code)
        self.assertIn("scrubber._lastTickVal !== nextVal", rm_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            bm_code = f.read()
        self.assertIn("_lastXRaySceneCtxKey", bm_code)
        self.assertIn("track._xrayCompiledTrack", bm_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "subtitles.js"), "r", encoding="utf-8") as f:
            sub_code = f.read()
        self.assertIn("_dictAbortController", sub_code)
        self.assertIn("_activeDictWordEl", sub_code)
        self.assertIn("trackMeta._lastWinCheckMs = nowWinMs;", sub_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "audio-dsp.js"), "r", encoding="utf-8") as f:
            dsp_code = f.read()
        self.assertIn("n._lastAppliedDspSig === dspSig", dsp_code)
        self.assertIn("_lastAppliedSubStyleSig === subStyleSig", dsp_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-watchdog.js"), "r", encoding="utf-8") as f:
            wd_code = f.read()
        self.assertIn("attemptCount >= 2 &&", wd_code)
        self.assertIn("state.hlsInstance.recoverMediaError()", wd_code)

        # Stage 2: Catalog, Modals, TV Mode, Localization & CSS Containment
        with open(os.path.join(ROOT_DIR, "public", "js", "utils.js"), "r", encoding="utf-8") as f:
            ut_code = f.read()
        self.assertIn("(item._cachedClientSimilarLimit || 0) >= limit", ut_code)
        self.assertIn("cand._simTokens", ut_code)
        self.assertIn("b._searchLower", ut_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-filters.js"), "r", encoding="utf-8") as f:
            cf_code = f.read()
        self.assertIn("export function getCatalogFranchiseItemsForItem", cf_code)
        self.assertIn("_cachedFranchiseItemsByGroup", cf_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-shelves.js"), "r", encoding="utf-8") as f:
            cs_code = f.read()
        self.assertIn("state._cachedFavGenreWeights", cs_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "i18n.js"), "r", encoding="utf-8") as f:
            i18n_code = f.read()
        self.assertIn("COUNTRY_RU_TO_EN_KEYS", i18n_code)
        self.assertIn("item._dispPosterVal", i18n_code)
        self.assertIn("item._dispBackdropVal", i18n_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "features-tv-mode.js"), "r", encoding="utf-8") as f:
            tv_code = f.read()
        self.assertIn("Math.abs(curScrollX - _tvNavCache.scrollX) < 12", tv_code)

        with open(os.path.join(ROOT_DIR, "public", "js", "settings.js"), "r", encoding="utf-8") as f:
            set_code = f.read()
        self.assertIn("_settingsLoadAbort", set_code)

        with open(os.path.join(ROOT_DIR, "public", "css", "catalog-and-player-layout.css"), "r", encoding="utf-8") as f:
            cpl_css = f.read()
        self.assertIn("contain: layout style paint;", cpl_css)

        # Stage 3 & 4: Backend Proxy, Remuxer, Downloads, SQLite WAL, Kinorium, HDRezka, Stremio & Aggregator
        with open(os.path.join(ROOT_DIR, "backend", "routes", "streaming.py"), "r", encoding="utf-8") as f:
            st_code = f.read()
        self.assertIn("_PROXY_PUMP_POOL.submit(_pump_proxy_upstream)", st_code)
        self.assertIn("pump_bytes_read = 0", st_code)
        self.assertIn("parsed_stream_path_lower", st_code)

        with open(os.path.join(ROOT_DIR, "backend", "remuxer.py"), "r", encoding="utf-8") as f:
            rmx_code = f.read()
        self.assertIn("self._probe_ttl_sec: float = 7200.0", rmx_code)
        self.assertIn('"-reconnect_streamed"', rmx_code)

        with open(os.path.join(ROOT_DIR, "backend", "downloads.py"), "r", encoding="utf-8") as f:
            dl_code = f.read()
        self.assertIn('if k not in ("out_time_us", "out_time_ms", "total_size", "speed", "progress"):', dl_code)
        self.assertIn("self._save_index_locked(skip_db=True)", dl_code)
        self.assertIn("items_snapshot = [dict(it) for it in self._items.values()]", dl_code)

        with open(os.path.join(ROOT_DIR, "backend", "storage_db.py"), "r", encoding="utf-8") as f:
            sdb_code = f.read()
        self.assertIn("digest = str(hash(plain_serialized))", sdb_code)
        self.assertIn("serialized_by_id: Dict[int, Tuple[str, int]] = {}", sdb_code)

        with open(os.path.join(ROOT_DIR, "backend", "kinorium.py"), "r", encoding="utf-8") as f:
            kin_code = f.read()
        self.assertIn("self._save_io_lock = threading.Lock()", kin_code)
        self.assertIn("self._healed_series_keys", kin_code)
        self.assertIn("def _persist_state_snapshot(", kin_code)

        with open(os.path.join(ROOT_DIR, "backend", "hdrezka.py"), "r", encoding="utf-8") as f:
            rz_code = f.read()
        self.assertIn("self._cached_mirror_hosts", rz_code)
        self.assertIn("def _clone_page_meta(", rz_code)

        with open(os.path.join(ROOT_DIR, "backend", "en_metadata.py"), "r", encoding="utf-8") as f:
            em_code = f.read()
        self.assertIn("def _clone_en_meta(", em_code)
        self.assertIn("_ISO_DATE_RE", em_code)

        with open(os.path.join(ROOT_DIR, "backend", "aggregator.py"), "r", encoding="utf-8") as f:
            ag_code = f.read()
        self.assertIn("self._cw_bg_prewarm_inflight", ag_code)
        self.assertIn("pool_idx_by_id", ag_code)
        self.assertIn('merged["_needs_reenrich"] = True', ag_code)

        with open(os.path.join(ROOT_DIR, "backend", "stremio.py"), "r", encoding="utf-8") as f:
            stm_code = f.read()
        self.assertIn("_SEED_EMOJI_RE", stm_code)
        self.assertIn("_SIZE_EMOJI_RE", stm_code)
        self.assertIn("_4K_UHD_TOKEN_RE", stm_code)

    def test_perf_pass14_player_catalog_proxy_and_storage(self) -> None:
        # Stage 1: Player, X-Ray, Subtitles, WebAudio DSP & Mobile Remote
        with open(os.path.join(ROOT_DIR, "public", "js", "player.js"), "r", encoding="utf-8") as f:
            pl_js = f.read()
        self.assertIn("skipIntroBtn.dataset.introSig", pl_js)
        self.assertIn("state.activeItem._xrayFetching = false", pl_js)
        self.assertIn("state._lastPreloadDoneKey = \"\"", pl_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-streams.js"), "r", encoding="utf-8") as f:
            ps_js = f.read()
        self.assertIn("\"skipIntroAbortController\"", ps_js)
        self.assertIn("state._lastPreloadDoneKey === curEpDoneKey", ps_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-seasons.js"), "r", encoding="utf-8") as f:
            pse_js = f.read()
        self.assertIn("seasonProgBox.dataset.progSig", pse_js)
        self.assertIn("await switchToSeriesSeasonEpisode(state.activeSeason, e);", pse_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-bookmarks.js"), "r", encoding="utf-8") as f:
            pb_js = f.read()
        self.assertIn("castEl.dataset.renderSig", pb_js)
        self.assertIn("ostEl.dataset.renderSig", pb_js)
        self.assertIn("trivEl.dataset.renderSig", pb_js)
        self.assertIn("pill.dataset.renderSig", pb_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "player-ui-controls.js"), "r", encoding="utf-8") as f:
            pui_js = f.read()
        self.assertIn("if (!isStageFullscreen()) return;", pui_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "audio-dsp.js"), "r", encoding="utf-8") as f:
            dsp_js = f.read()
        self.assertIn("_lastGearDotSig", dsp_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "remote.js"), "r", encoding="utf-8") as f:
            rem_js = f.read()
        self.assertIn("_cachedRemoteBookmarksKey", rem_js)
        self.assertIn("rState.dspRenderSig", rem_js)
        self.assertIn("rState.rateRenderSig", rem_js)
        self.assertIn("if (rState.activeTab === \"xray\")", rem_js)

        # Stage 2: Catalog, Modals, Live Search, TV Navigation & CSS Containment
        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-discovery.js"), "r", encoding="utf-8") as f:
            cd_js = f.read()
        self.assertIn("${it.title || \"\"}\\0${it.orig_title || \"\"}", cd_js)
        self.assertIn("const localSources = [state.catalogItems, state.heroItems];", cd_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-cards.js"), "r", encoding="utf-8") as f:
            cc_js = f.read()
        self.assertIn("ks.in_watchlist ? 1 : 0", cc_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "utils.js"), "r", encoding="utf-8") as f:
            ut_js = f.read()
        self.assertIn("cand._simMeta", ut_js)
        self.assertIn("_dlIndexSig", ut_js)
        self.assertIn("item._dlCacheVer === _dlIndexVer", ut_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-shelves.js"), "r", encoding="utf-8") as f:
            cs_js = f.read()
        self.assertIn("searchPersonsRow._personsSig", cs_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-filters.js"), "r", encoding="utf-8") as f:
            cf_js = f.read()
        self.assertIn("_cachedDynamicFilterCountsSig", cf_js)
        self.assertIn("it._rawStudios", cf_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals-person.js"), "r", encoding="utf-8") as f:
            mp_js = f.read()
        self.assertIn("listEl._castRenderSig", mp_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals-stats.js"), "r", encoding="utf-8") as f:
            ms_js = f.read()
        self.assertIn("_statsPayloadCache", ms_js)
        self.assertIn("bodyEl._statsRenderedKey", ms_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "features-tv-mode.js"), "r", encoding="utf-8") as f:
            tv_js = f.read()
        self.assertIn("function getActiveTvFocusedElement()", tv_js)

        # Stage 3: Backend Proxy, Downloads, Kinorium, Aggregator, StorageDB, Stremio & Regexes
        with open(os.path.join(ROOT_DIR, "backend", "routes", "streaming.py"), "r", encoding="utf-8") as f:
            st_py = f.read()
        self.assertIn("pump_future = _PROXY_PUMP_POOL.submit(_pump_proxy_upstream)", st_py)
        self.assertIn("elif pump_future.done():", st_py)
        self.assertNotIn("pump_thread", st_py)

        with open(os.path.join(ROOT_DIR, "backend", "downloads.py"), "r", encoding="utf-8") as f:
            dl_py = f.read()
        self.assertIn("changed_ids: Optional[Sequence[str]] = None", dl_py)
        self.assertIn("self._save_index_locked(changed_ids=[did])", dl_py)

        with open(os.path.join(ROOT_DIR, "backend", "kinorium_mutations.py"), "r", encoding="utf-8") as f:
            km_py = f.read()
        self.assertIn("self._cached_profile_stats", km_py)

        with open(os.path.join(ROOT_DIR, "backend", "aggregator.py"), "r", encoding="utf-8") as f:
            ag_py = f.read()
        self.assertIn("def _get_enriched_curated_catalog(", ag_py)
        self.assertIn("self._cached_cw_list", ag_py)

        with open(os.path.join(ROOT_DIR, "backend", "hdrezka.py"), "r", encoding="utf-8") as f:
            rz_py = f.read()
        self.assertIn("@functools.lru_cache(maxsize=2048)", rz_py)

        with open(os.path.join(ROOT_DIR, "backend", "backup_stream.py"), "r", encoding="utf-8") as f:
            bs_py = f.read()
        self.assertIn("_VOICE_PATTERNS_COMPILED", bs_py)
        self.assertIn("self._torr_preflight_pool.submit(self._drop_other_active_torrents, {active_ih})", bs_py)

    def test_flagship_product_roadmap_features_stages_1_to_4(self):
        import tempfile
        from backend.downloads import OfflineDownloadManager
        from backend.remote_control import DesktopRemoteBroker
        from backend.routes import GET_ROUTES, POST_ROUTES
        from backend.routes.meta import (
            _compute_xray_track_id,
            _enrich_xray_payload_with_saved_tracks,
            handle_xray_saved_tracks_get,
            handle_xray_saved_tracks_post,
        )
        from backend.routes.catalog import handle_catalog_recommendations

        # 1. Route registration checks
        self.assertIn("/api/downloads/season-status", GET_ROUTES)
        self.assertIn("/api/downloads/delete-season", POST_ROUTES)
        self.assertIn("/api/downloads/batch-season", POST_ROUTES)
        self.assertIn("/api/downloads/batch-season/delete", POST_ROUTES)
        self.assertIn("/api/xray/saved-tracks", GET_ROUTES)
        self.assertIn("/api/xray/saved-tracks", POST_ROUTES)
        self.assertIn("/api/xray/soundtracks", GET_ROUTES)
        self.assertIn("/api/user/saved-tracks", GET_ROUTES)
        self.assertIn("/api/user/saved-tracks", POST_ROUTES)
        self.assertIn("/api/catalog/recommendations", GET_ROUTES)
        self.assertTrue(hasattr(OfflineDownloadManager, "batch_enqueue_season"))

        # 2. Stage 1: Batch Season Downloader status & delete_season_downloads
        with tempfile.TemporaryDirectory() as tmpdir:
            mgr = OfflineDownloadManager(data_dir=tmpdir, remux_engine=None, start_workers=False)
            dl_id = "series_test_s1_e1"
            mgr._items[dl_id] = {
                "download_id": dl_id,
                "item_id": "kin_999",
                "kinorium_id": "999",
                "title": "Тестовый сериал",
                "orig_title": "Test Series",
                "media_type": "series",
                "season": 1,
                "episode": 1,
                "status": "completed",
                "progress": 100.0,
                "total_bytes": 1048576,
                "downloaded_bytes": 1048576,
            }
            st = mgr.get_season_download_status(
                item_id="kin_999",
                kinorium_id="999",
                title="Тестовый сериал",
                season=1,
            )
            self.assertTrue(st["ok"])
            self.assertEqual(st["completed_count"], 1)
            self.assertEqual(st["episodes"][0]["episode"], 1)

            del_res = mgr.delete_season_downloads(
                item_id="kin_999",
                kinorium_id="999",
                title="Тестовый сериал",
                season=1,
            )
            self.assertTrue(del_res["ok"])
            self.assertEqual(del_res["deleted_count"], 1)
            self.assertNotIn(dl_id, mgr._items)

        # 3. Stage 2: X-Ray Saved Tracks toggle & enrichment
        class _DummyHandler:
            def __init__(self):
                self.last_json = None
                self.last_status = 200

            def _send_json(self, payload, status=200):
                self.last_json = payload
                self.last_status = status

        class _DummyCtx:
            app_prefs = {"app_lang": "ru"}

            @staticmethod
            def norm_app_lang(val, default="ru"):
                return val or default

        dummy_h = _DummyHandler()
        dummy_ctx = _DummyCtx()
        tid = _compute_xray_track_id({"title": "Cornfield Chase", "artist": "Hans Zimmer"})
        self.assertEqual(tid, "hans-zimmer--cornfield-chase")

        handle_xray_saved_tracks_post(
            dummy_h,
            {},
            None,
            {
                "action": "toggle",
                "media_title": "Интерстеллар",
                "track": {
                    "title": "Cornfield Chase",
                    "artist": "Hans Zimmer",
                    "preview_url": "https://example.com/preview.m4a",
                },
            },
            dummy_ctx,
        )
        self.assertTrue(dummy_h.last_json["ok"])
        self.assertTrue(dummy_h.last_json["is_saved"])
        self.assertEqual(dummy_h.last_json["count"], 1)

        xray_payload = {
            "soundtrack": [
                {"title": "Cornfield Chase", "artist": "Hans Zimmer"},
                {"title": "No Time for Caution", "artist": "Hans Zimmer"},
            ]
        }
        _enrich_xray_payload_with_saved_tracks(xray_payload, dummy_ctx)
        self.assertTrue(xray_payload["soundtrack"][0]["is_saved"])
        self.assertFalse(xray_payload["soundtrack"][1]["is_saved"])
        self.assertEqual(xray_payload["saved_tracks_count"], 1)

        handle_xray_saved_tracks_get(dummy_h, {}, None, dummy_ctx)
        self.assertEqual(len(dummy_h.last_json["items"]), 1)

        # 4. Stage 3: Remote search command & Gamepad/Touchpad upgrades
        self.assertIn("remote_search", DesktopRemoteBroker.ALLOWED_COMMANDS)
        with open(os.path.join(ROOT_DIR, "public", "js", "remote.js"), "r", encoding="utf-8") as f:
            rm_js = f.read()
        self.assertIn('case "remote_search":', rm_js)
        self.assertIn("rm-catalog-search-tv", rm_js)
        self.assertIn("longPressTriggered", rm_js)

        with open(os.path.join(ROOT_DIR, "public", "js", "features-tv-mode.js"), "r", encoding="utf-8") as f:
            tv_js = f.read()
        self.assertIn("wasPressed(6)", tv_js)
        self.assertIn("wasPressed(7)", tv_js)
        self.assertIn('document.getElementById("vc-btn-xray")?.click()', tv_js)

        # 5. Stage 4: Smart Recommendations & Mood Filter Chips
        class _DummyAgg:
            def get_catalog(self, **kwargs):
                return {
                    "items": [
                        {
                            "id": "m1",
                            "title": "Интерстеллар",
                            "media_type": "movie",
                            "genres": ["фантастика", "драма"],
                            "directors": ["Кристофер Нолан"],
                            "ratings": {"imdb": 8.7},
                            "kinorium": {"user_rating": 10, "watched": True},
                        },
                        {
                            "id": "m2",
                            "title": "Начало",
                            "media_type": "movie",
                            "genres": ["фантастика", "триллер"],
                            "directors": ["Кристофер Нолан"],
                            "ratings": {"imdb": 8.8},
                            "kinorium": {"user_rating": 0, "watched": False},
                        },
                    ]
                }

        dummy_ctx.aggregator = _DummyAgg()
        handle_catalog_recommendations(dummy_h, {"mood": ["scifi"]}, None, dummy_ctx)
        self.assertTrue(dummy_h.last_json["ok"])
        self.assertEqual(dummy_h.last_json["anchor_title"], "Интерстеллар")
        self.assertEqual(len(dummy_h.last_json["recommended_for_you"]), 1)
        self.assertIn("Кристофер Нолан", dummy_h.last_json["recommended_for_you"][0]["recommendation_reason"])
        self.assertEqual(len(dummy_h.last_json["because_you_liked"]), 1)
        self.assertEqual(len(dummy_h.last_json["favorite_directors"]), 1)
        self.assertEqual(len(dummy_h.last_json["mood_items"]), 1)

        with open(os.path.join(ROOT_DIR, "public", "js", "catalog-shelves.js"), "r", encoding="utf-8") as f:
            cs_js = f.read()
        self.assertIn("_CURATED_MOOD_PRESETS", cs_js)
        self.assertIn("curated-because-liked", cs_js)
        self.assertIn("curated-favorite-directors", cs_js)

    def test_velarium_wrapped_digest_and_responsive_ui_polish(self):
        """Verify Velarium Wrapped monthly activity, series binge records, period tabs, and responsive UI polish."""
        with open(os.path.join(ROOT_DIR, "backend", "kinorium_mutations.py"), "r", encoding="utf-8") as f:
            km_src = f.read()
        self.assertIn('"monthly_activity": monthly_activity_out', km_src)
        self.assertIn('"series_records": series_records', km_src)
        self.assertIn('"most_binged_series": most_binged_series', km_src)
        self.assertIn('"best_streak_days": best_streak_days', km_src)

        with open(os.path.join(ROOT_DIR, "public", "js", "modals-stats.js"), "r", encoding="utf-8") as f:
            ms_src = f.read()
        self.assertNotIn("getWatchHistory()", ms_src)
        self.assertIn("getWatchHistoryList()", ms_src)
        self.assertIn('export function computeClientWatchWrapAnalytics(st = {}, period = state.statsWrapPeriod || "all")', ms_src)
        self.assertIn('id="wrap-period-tabs"', ms_src)
        self.assertIn('id="wrap-monthly-chart"', ms_src)
        self.assertIn('id="wrap-series-records"', ms_src)
        self.assertIn('id="wrap-most-binged-card"', ms_src)
        self.assertIn("data-filter-genre=", ms_src)
        self.assertIn("atv-wrap-person-rank", ms_src)

        with open(os.path.join(ROOT_DIR, "public", "css", "base-and-hero.css"), "r", encoding="utf-8") as f:
            bh_css = f.read()
        self.assertIn(".atv-wrap-period-tabs", bh_css)
        self.assertIn(".atv-wrap-monthly-chart", bh_css)
        self.assertIn(".atv-wrap-series-record-card", bh_css)
        self.assertIn(".atv-hist-row.is-clickable-genre", bh_css)
        self.assertIn("@media (max-width: 1024px)", bh_css)
        self.assertIn("@media (max-width: 768px)", bh_css)
        self.assertIn("@media (max-width: 480px)", bh_css)

        with open(os.path.join(ROOT_DIR, "public", "js", "utils.js"), "r", encoding="utf-8") as f:
            utils_js = f.read()
        self.assertIn("function _resolveVerticalScrollContainer(el)", utils_js)
        self.assertIn("const captureVertical = Boolean(options.captureVerticalWheel);", utils_js)
        self.assertIn('el.classList.contains("atv-curated-row")', utils_js)

        with open(os.path.join(ROOT_DIR, "public", "css", "catalog-and-player-layout.css"), "r", encoding="utf-8") as f:
            cpl_css = f.read()
        self.assertIn("overscroll-behavior-x: contain;", cpl_css)
        self.assertIn("overflow: clip;", cpl_css)


if __name__ == "__main__":
    unittest.main()
