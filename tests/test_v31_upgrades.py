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
from backend.storage_db import CineFlowStorageDB
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
            db = CineFlowStorageDB(tmp)
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
        with open(os.path.join(ROOT_DIR, "macos", "CineFlowApp.swift"), "r", encoding="utf-8") as sf:
            swift_src = sf.read()
        self.assertIn("import UserNotifications", swift_src)
        self.assertIn('case "notifyEpisode":', swift_src)
        self.assertIn("CINEFLOW_DATA_DIR", swift_src)
        self.assertIn("Application Support", swift_src)

        with open(os.path.join(ROOT_DIR, "macos", "build_macos_app.py"), "r", encoding="utf-8") as bf:
            build_src = bf.read()
        self.assertIn("CineFlow.dmg", build_src)
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
        self.assertIn("Пульт CineFlow", remote_src)

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
        from backend.storage_db import CineFlowStorageDB, LocalVaultCipher

        with tempfile.TemporaryDirectory() as tmp_dir:
            # 1. LocalVaultCipher & SQLite encryption-at-rest for sensitive keys
            db = CineFlowStorageDB(tmp_dir)
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


if __name__ == "__main__":
    unittest.main()
