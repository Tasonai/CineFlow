import glob
import json
import os
import re
import tempfile
import unittest

import server
from backend.aggregator import UnifiedCinemaAggregator
from backend.doh import DoHSplitNetworkClient
from backend.en_metadata import (
    EnglishMetadataResolver,
    _names_match_ru_en,
    is_localized_non_en_image_url,
    resolve_original_backdrop_url,
    resolve_original_poster_url,
)
from backend.hdrezka import HDRezkaClient
from backend.kinorium import KinoriumService, _sanitize_kinorium_genres
from backend.regions import get_country_profile, get_european_countries_list
from backend.skip_intro import SkipIntroEngine
from backend.stremio import StremioAddonEngine


class _DummyNetClient:
    def fetch_text(self, *args, **kwargs):
        return ""


class TestAuditFixes(unittest.TestCase):
    def test_ssrf_media_source_url_guard(self):
        # External HTTPS/HTTP media streams must be allowed
        self.assertTrue(
            server._is_allowed_media_source_url("https://cdn.example.com/video/master.m3u8")
        )
        # Local TorrServer (:8090) allowed ONLY when allow_torrserver_loopback=True
        self.assertTrue(
            server._is_allowed_media_source_url(
                "http://127.0.0.1:8090/stream/movie.mkv?link=deadbeef&index=0&play",
                allow_torrserver_loopback=True,
            )
        )
        self.assertFalse(
            server._is_allowed_media_source_url(
                "http://127.0.0.1:8090/stream/movie.mkv?link=deadbeef&index=0&play",
                allow_torrserver_loopback=False,
            )
        )
        # Arbitrary localhost ports, CineFlow's own port, private LAN IPs, link-local, and non-HTTP schemes MUST be rejected
        for forbidden in (
            "http://127.0.0.1:8765/api/settings",
            "http://localhost:8765/api/system/status",
            "http://127.0.0.1:22/",
            "http://[::1]:8765/api/settings",
            "http://192.168.1.1/admin",
            "http://10.0.0.1:8080/internal",
            "http://169.254.169.254/latest/meta-data/",
            "file:///etc/passwd",
            "ftp://example.com/movie.mp4",
            "",
        ):
            self.assertFalse(
                server._is_allowed_media_source_url(forbidden, allow_torrserver_loopback=True),
                f"Expected SSRF guard to block {forbidden!r}",
            )

    def test_kinorium_genre_sanitization(self):
        raw_genres = ["Канада", "драма", "Великобритания", "триллер", "США", "Франция", "2025"]
        cleaned = _sanitize_kinorium_genres(raw_genres, "series")
        self.assertEqual(cleaned, ["Драма", "Триллер"])

        fallback_cleaned = _sanitize_kinorium_genres(["Канада", "США"], "series")
        self.assertEqual(fallback_cleaned, ["Сериал", "Драма"])

    def test_kinorium_cw_restore_and_secret_redaction(self):
        with tempfile.TemporaryDirectory() as td:
            seed_state = {
                "account": {
                    "connected": True,
                    "user_id": "51670",
                    "username": "Tester",
                    "session_cookie": "PHPSESSID=super_secret_token_123",
                },
                "remote_watching_items": {
                    "101": {
                        "id": "kin_101",
                        "title": "Test Show",
                        "media_type": "series",
                        "genres": ["Канада", "фантастика", "США"],
                    }
                },
                "continue_watching": [
                    {"id": "kin_101", "title": "Test Show", "progress": 0.42},
                    {"id": "kin_202", "title": "Second Movie", "progress": 0.65},
                ],
            }
            with open(os.path.join(td, "kinorium_state.json"), "w", encoding="utf-8") as f:
                json.dump(seed_state, f, ensure_ascii=False)

            svc = KinoriumService(_DummyNetClient(), td)
            # Persisted countries in genres are stripped on load
            self.assertEqual(
                svc.state["remote_watching_items"]["101"]["genres"],
                ["Фантастика"],
            )

            # Summary never leaks session_cookie
            summary = svc.get_account_summary()
            self.assertNotIn("session_cookie", summary)
            self.assertTrue(summary.get("has_session_cookie"))
            self.assertEqual(summary.get("cw_dismissed_count"), 0)

            # Dismiss + single undo restore round-trip
            svc.dismiss_continue_watching("kin_101", "Test Show")
            self.assertEqual(len(svc.state["continue_watching"]), 1)
            self.assertGreater(svc.get_account_summary().get("cw_dismissed_count", 0), 0)

            svc.restore_continue_watching(item_id="kin_101", title="Test Show")
            cw_ids = [x["id"] for x in svc.state["continue_watching"]]
            self.assertIn("kin_101", cw_ids)
            self.assertEqual(svc.get_account_summary().get("cw_dismissed_count"), 0)

            # Dismiss all + restore_all=True
            svc.dismiss_continue_watching("kin_101", "Test Show")
            svc.dismiss_continue_watching("kin_202", "Second Movie")
            self.assertEqual(len(svc.state["continue_watching"]), 0)
            svc.restore_continue_watching(restore_all=True)
            self.assertEqual(len(svc.state["continue_watching"]), 2)

            # Redacted backup strips session_cookie for non-local LAN clients
            full_backup = svc.export_backup_state(redact_secrets=False)
            self.assertIn("super_secret_token_123", full_backup["account"].get("session_cookie", ""))

            redacted_backup = svc.export_backup_state(redact_secrets=True)
            self.assertEqual(redacted_backup["account"].get("session_cookie", ""), "")

    def test_stremio_addon_descriptions_localized(self):
        with tempfile.TemporaryDirectory() as td:
            engine = StremioAddonEngine(td, backup_engine=None)
            ru_addons = engine.get_addons(lang="ru")
            en_addons = engine.get_addons(lang="en")
            self.assertTrue(ru_addons and en_addons)
            for a in en_addons:
                if a.get("builtin"):
                    desc = str(a.get("description") or "")
                    self.assertTrue(desc)
                    self.assertFalse(
                        any("а" <= ch.lower() <= "я" for ch in desc),
                        f"Expected English description for builtin addon {a.get('id')}, got: {desc!r}",
                    )

    def test_en_poster_and_backdrop_localization_filter(self):
        self.assertTrue(is_localized_non_en_image_url("https://vod.pl/img/rodzina-soprano-poster.jpg"))
        self.assertTrue(is_localized_non_en_image_url("https://vod.pl/img/lalka-2026-bg.jpg"))
        self.assertTrue(is_localized_non_en_image_url("https://ru-images.kinorium.com/movie/600/83721.jpg"))
        self.assertFalse(is_localized_non_en_image_url("https://images.metahub.space/poster/medium/tt0141842/img"))

        sopranos_item = {
            "id": "tt0141842",
            "imdb_id": "tt0141842",
            "kinorium_id": "83721",
            "poster": "https://cdn.player.pl/rodzina-soprano-vertical.jpg",
            "backdrop": "https://cdn.player.pl/rodzina-soprano-hero.jpg",
        }
        en_poster = resolve_original_poster_url(sopranos_item)
        en_backdrop = resolve_original_backdrop_url(sopranos_item)
        self.assertNotIn("rodzina-soprano", en_poster)
        self.assertNotIn("rodzina-soprano", en_backdrop)
        self.assertIn("tt0141842", en_backdrop)

    def test_curated_matching_respects_media_type_and_year(self):
        agg = server.aggregator
        # Curated catalog contains "Джентльмены" / "The Gentlemen" (2019 movie) OR (2024 series);
        # ensure a different media_type / year homonym never collides with the wrong entry.
        fake_movie_1996 = {
            "id": "kin_999111",
            "title": "Джентльмены",
            "orig_title": "The Gentlemen",
            "media_type": "movie",
            "year": 1996,
        }
        self.assertIsNone(agg._match_curated_catalog_entry(fake_movie_1996))

    def test_skip_intro_imdb_resolver_bucket_and_strict_match(self):
        calls = []

        class _MockImdbNet:
            def request(self, url, **kwargs):
                calls.append(url)
                payload = {
                    "d": [
                        {"id": "tt0000001", "l": "Completely Different Show", "qid": "tvSeries", "y": 2024},
                        {"id": "tt8367814", "l": "The Gentlemen", "qid": "movie", "y": 2019},
                        {"id": "tt13210838", "l": "The Gentlemen", "qid": "tvSeries", "y": 2024},
                    ]
                }
                return 200, json.dumps(payload).encode("utf-8"), {}

        eng = SkipIntroEngine(_MockImdbNet())
        resolved = eng.resolve_imdb_id("kin_500", title="Джентльмены", orig_title="The Gentlemen", year=2024)
        self.assertEqual(resolved, "tt13210838")
        self.assertTrue(calls and "/suggestion/t/" in calls[0], f"Expected /suggestion/t/ bucket, got {calls}")

        # Unknown title must NOT blindly return candidates[0]
        unknown = eng.resolve_imdb_id("kin_501", title="Несуществующий сериал", orig_title="NoSuchSeriesXYZ", year=2025)
        self.assertEqual(unknown, "kin_501")

    def test_kinorium_similar_slider_extraction_and_ranking(self):
        sample_html = """
        <section class="film-page__slider" id="similar-slider">
          <div class='item reported' data-id='999999'>
            <div data-movieId="999999" data-movieName="Спам Предложение"></div>
            <span class='title_orig cut_text'><span>Spam Entry</span></span>
            <span class='title_orig_years'>2023</span>
            <span class='kr-rating'>9.1</span>
          </div>
          <div class='item ' data-id='666111'>
            <div data-movieId="666111" data-movieName="Малоизвестный сериал" data-isSerial="1"></div>
            <span class='title_orig cut_text'><span>Obscure Show</span></span>
            <span class='title_orig_years'>2025, сериал</span>
            <span class='kr-rating'>6.1</span>
          </div>
          <div class='item ' data-id='565845'>
            <div data-movieId="565845" data-movieName="Чёрное зеркало" data-isSerial="1"></div>
            <span class='title_orig cut_text'><span>Black Mirror</span></span>
            <span class='title_orig_years'>2011 – ..., сериал</span>
            <span class='kr-rating'>8.4</span>
          </div>
          <div class='item ' data-id='1515997'>
            <div data-movieId="1515997" data-movieName="Мистер Робот" data-isSerial="1"></div>
            <span class='title_orig cut_text'><span>Mr. Robot</span></span>
            <span class='title_orig_years'>2015 – 2019, сериал</span>
            <span class='kr-rating'>7.8</span>
          </div>
        </section>
        """
        parsed = KinoriumService.extract_similar_items_html(sample_html)
        kids = [x["kinorium_id"] for x in parsed]
        self.assertNotIn("999999", kids, "Unmoderated 'item reported' entries must be skipped")
        self.assertEqual(kids, ["666111", "565845", "1515997"])
        bm = next(x for x in parsed if x["kinorium_id"] == "565845")
        self.assertEqual(bm["orig_title"], "Black Mirror")
        self.assertEqual(bm["media_type"], "series")
        self.assertEqual(bm["year"], 2011)
        self.assertAlmostEqual(bm["kinorium_rating"], 8.4)

        with tempfile.TemporaryDirectory() as tmp:
            svc = KinoriumService(_DummyNetClient(), tmp)
            svc.state["remote_never_items"] = {
                "666111": {"kinorium_id": "666111", "ru_title": "Малоизвестный сериал", "not_watching": True}
            }
            svc.state["remote_watchlist_items"] = {
                "1515997": {"kinorium_id": "1515997", "ru_title": "Мистер Робот", "orig_title": "Mr. Robot", "in_watchlist": True}
            }
            svc._build_lookup_indices()
            ranked = svc.get_similar_catalog_items(
                kid="2389884",
                media_type="series",
                allow_network=False,
                preloaded_raw=parsed,
            )
            ranked_ids = [r["id"] for r in ranked]
            self.assertNotIn("kin_666111", ranked_ids, "not_watching items must be excluded from recommendations")
            self.assertEqual(ranked_ids[0], "kin_565845", "Higher-rated Black Mirror should rank above newer low-rated items")
            mr_robot = next(r for r in ranked if r["id"] == "kin_1515997")
            self.assertEqual(mr_robot["similar_source"], "kinorium")
            self.assertIn("Буду смотреть", mr_robot["similar_reason"])

    def test_profile_stats_favorites_preserve_real_ratings(self):
        with tempfile.TemporaryDirectory() as tmp:
            svc = KinoriumService(_DummyNetClient(), tmp)
            svc.state["remote_watched_items"] = {
                "384511": {
                    "kinorium_id": "384511",
                    "ru_title": "Интерстеллар",
                    "orig_title": "Interstellar",
                    "year": 2014,
                    "media_type": "movie",
                    "kinorium_rating": 8.6,
                    "imdb_rating": 8.7,
                    "score": 10,
                }
            }
            stats = svc.get_profile_stats()
            favs = stats.get("top_favorites") or []
            self.assertEqual(len(favs), 1)
            self.assertEqual(favs[0]["score"], 10)
            self.assertAlmostEqual(favs[0]["kinorium_rating"], 8.6)
            self.assertAlmostEqual(favs[0]["imdb_rating"], 8.7)

    def test_person_name_match_rejects_shared_first_name_mismatch(self):
        self.assertLess(
            _names_match_ru_en("Кристофер Уокен", "Кристофер Нолан"),
            0.55,
            "Different surnames sharing a first name must never pass person matching",
        )
        self.assertLess(
            _names_match_ru_en("Christopher Walken", "Christopher Nolan"),
            0.55,
        )
        self.assertGreater(
            _names_match_ru_en("Кристофер Нолан", "Christopher Nolan"),
            0.9,
        )
        self.assertGreater(
            _names_match_ru_en("Дени Вильнёв", "Denis Villeneuve"),
            0.8,
        )

    def test_european_countries_profiles_and_localization(self):
        ru_list = get_european_countries_list("ru")
        en_list = get_european_countries_list("en")
        self.assertEqual(len(ru_list), 50)
        self.assertEqual(len(en_list), 50)
        codes = {c["code"] for c in ru_list}
        for expected in ("PL", "DE", "UA", "BY", "IT", "FR", "GB", "ES", "LV", "LT", "EE", "CZ", "NL", "CH"):
            self.assertIn(expected, codes)

        de_prof = get_country_profile("DE", "ru")
        self.assertTrue(de_prof["p2p_strict"])
        self.assertTrue(de_prof["doh_enabled"])
        self.assertEqual(de_prof["justwatch_country"], "DE")

        pl_prof = get_country_profile("PL", "en")
        self.assertIn("playerpl", pl_prof["local_services"])

        with tempfile.TemporaryDirectory() as tmp:
            svc = KinoriumService(_DummyNetClient(), tmp)
            svc.apply_country_localization("DE", adjust_local_services=True, persist=False)
            self.assertIn("/de", svc.state["integrations"]["appletv"]["login_url"])
            self.assertFalse(svc.state["integrations"]["playerpl"]["enabled"])

    def test_clean_install_kinorium_has_no_hardcoded_user_and_bulk_toggle(self):
        with tempfile.TemporaryDirectory() as tmp:
            svc = KinoriumService(_DummyNetClient(), tmp)
            self.assertFalse(svc.had_persisted_state)
            acc = svc.get_account_summary()
            self.assertEqual(acc["user_id"], "")
            self.assertFalse(acc["connected"])
            svc.set_services_enabled_bulk({"kinorium": False, "netflix": False, "hdrezka": True})
            integ = svc.get_integrations()
            self.assertFalse(integ["kinorium"]["enabled"])
            self.assertFalse(integ["netflix"]["enabled"])
            self.assertTrue(integ["hdrezka"]["enabled"])

            # Verify user 51670 resolves to Andrei Crustillio, and never leaks raw user_51670
            svc.state["account"]["user_id"] = "51670"
            svc.state["account"]["display_name"] = "user_51670"
            svc.state["account"]["connected"] = True
            acc_51670 = svc.get_account_summary()
            self.assertEqual(acc_51670["display_name"], "Andrei Crustillio")

    def test_doh_geo_headers_and_worker_url_autoclassification(self):
        doh = DoHSplitNetworkClient()
        kz_headers = doh.build_geo_headers("KZ")
        self.assertEqual(kz_headers.get("CF-IPCountry"), "KZ")
        self.assertTrue(kz_headers.get("X-Forwarded-For"))
        self.assertEqual(doh.build_geo_headers("DIRECT"), {})

        rezka = HDRezkaClient(doh)
        rezka.configure(proxy_url="https://myrelay.example.workers.dev", cf_worker_relay="")
        self.assertEqual(rezka.proxy_url, "")
        self.assertEqual(rezka.cf_worker_relay, "https://myrelay.example.workers.dev")

    def test_person_details_never_fakes_filmography_from_title_search(self):
        rezka = HDRezkaClient(_DummyNetClient())
        rezka.search_live = lambda q: [
            {"title": "Шоу Кристофера Нолана", "year": 2015, "page_url": "https://rezka.ag/films/doc/1.html"}
        ]
        prof = rezka.get_person_details(name="Несуществующий Тестовый Режиссёр", hint_url="")
        self.assertEqual(prof.get("sections"), [], "Unrelated title search hits must never be returned as filmography")
        self.assertEqual(len(rezka.person_profile_cache), 0, "Empty fallback profiles must not be cached")

    def test_kinorium_search_persons_and_filmography_parsers(self):
        with tempfile.TemporaryDirectory() as tmp:
            svc = KinoriumService(_DummyNetClient(), tmp)
            sample_search_payload = json.dumps(
                {
                    "list": [
                        {
                            "id": 295341,
                            "mixtype": "persona",
                            "name": "Кристофер Нолан",
                            "name_orig": "Christopher Nolan",
                            "date_of_birth": "30.07.1970",
                            "image": "https://images.kinorium.com/persona/XXX/295341.jpg",
                        },
                        {
                            "id": 384511,
                            "mixtype": "movie",
                            "name": "Интерстеллар",
                            "name_orig": "Interstellar",
                            "year": "2014",
                            "rating": "8.6",
                            "image": "https://images.kinorium.com/movie/XXX/384511.jpg",
                        },
                    ]
                },
                ensure_ascii=False,
            )
            svc.fetch_kinorium_html = lambda url, *a, **kw: sample_search_payload
            parsed = svc.search_persons_and_movies("Кристофер Нолан")
            self.assertEqual(len(parsed["persons"]), 1)
            self.assertEqual(parsed["persons"][0]["kinorium_person_id"], "295341")
            self.assertEqual(parsed["persons"][0]["orig_name"], "Christopher Nolan")
            self.assertIn("/persona/300/295341.jpg", parsed["persons"][0]["photo"])
            self.assertEqual(len(parsed["movies"]), 1)
            self.assertEqual(parsed["movies"][0]["kinorium_id"], "384511")

            sample_person_html = """
            <html><head>
            <meta name="description" content="Кристофер Нолан — Режиссёр, сценарист, продюсер." />
            <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Person","name":"Кристофер Нолан","alternateName":"Christopher Nolan","birthDate":"1970-07-30","birthPlace":{"name":"Лондон, Великобритания"},"image":"https://images.kinorium.com/persona/300/295341.jpg"}
            </script>
            </head><body>
              <div class="item headlines_type-director status_watched" rel="384511">
                <a href="/384511/"><span class="title">Интерстеллар</span></a>
                <span class="filmList__small-text">Interstellar, 2014</span>
                <span class="rating_kinorium"><span class="value">8.6</span></span>
              </div>
              <div class="item headlines_type-director" rel="472809">
                <a href="/472809/"><span class="title">Начало</span></a>
                <span class="filmList__small-text">Inception, 2010</span>
                <span class="rating_kinorium"><span class="value">8.7</span></span>
              </div>
              <div class="item headlines_type-director" rel="2773282">
                <a href="/2773282/"><span class="title">Оппенгеймер</span></a>
                <span class="filmList__small-text">Oppenheimer, 2023</span>
                <span class="rating_kinorium"><span class="value">8.4</span></span>
              </div>
              <div class="item headlines_type-director status_future" rel="999999">
                <a href="/999999/"><span class="title">Будущий анонс</span></a>
                <span class="filmList__small-text">Future Project, 2029</span>
              </div>
              <div class="item headlines_type-actor" rel="777111">
                <a href="/777111/"><span class="title">Документалка о кино</span></a>
                <span class="filmList__small-text">Cinema Doc, 2018</span>
                <span class="filmList__extra-char">играет самого себя</span>
                <span class="rating_kinorium"><span class="value">7.4</span></span>
              </div>
            </body></html>
            """
            svc.fetch_kinorium_html = lambda url, *a, **kw: sample_person_html
            filmog = svc.fetch_person_filmography(persona_id="295341", name="Кристофер Нолан")
            self.assertEqual(filmog["name"], "Кристофер Нолан")
            self.assertEqual(filmog["orig_name"], "Christopher Nolan")
            self.assertEqual(filmog["birth_place"], "Лондон, Великобритания")
            sec_labels = [s["label"] for s in filmog["sections"]]
            self.assertIn("Режиссёр", sec_labels)
            self.assertNotIn("В ролях", sec_labels, "Self-appearances must not pollute narrative actor section")
            dir_sec = next(s for s in filmog["sections"] if s["key"] == "director")
            self.assertEqual(len(dir_sec["items"]), 3, "Unrated status_future items must be filtered out")
            self.assertEqual(dir_sec["items"][0]["kinorium_id"], "384511")

    def test_en_metadata_kinorium_en_fallback_and_suggest_search(self):
        with tempfile.TemporaryDirectory() as tmp:
            en_payload = json.dumps(
                {
                    "list": [
                        {
                            "id": 10765001,
                            "mixtype": "movie",
                            "name": "Fool's Day",
                            "name_orig": "День дурака",
                            "year": "2026",
                            "image": "https://en-images.kinorium.com/movie/XXX/10765001.jpg",
                        }
                    ]
                },
                ensure_ascii=False,
            )
            resolver = EnglishMetadataResolver(
                os.path.join(tmp, "en_meta.json"),
                kinorium_html_fetcher=lambda url, *a, **kw: en_payload if "en.kinorium.com" in url else "",
            )
            hit = resolver._query_kinorium_en_search("День дурака", year=2026, kinorium_id="10765001")
            self.assertIsNotNone(hit)
            self.assertEqual(hit["title_en"], "Fool's Day")
            self.assertIn("en-images.kinorium.com/movie/600/10765001.jpg", hit["poster_en"])

            doh = DoHSplitNetworkClient()
            doh.fetch_text = lambda *a, **kw: ""
            rezka = HDRezkaClient(doh)
            rezka.search_live = lambda q: []
            stremio = StremioAddonEngine(tmp, None)
            stremio.search_cinemeta = lambda q: []
            kin = KinoriumService(doh, tmp)
            kin.search_persons_and_movies = lambda q: {
                "persons": [
                    {
                        "name": "Кристофер Нолан",
                        "orig_name": "Christopher Nolan",
                        "kinorium_person_id": "295341",
                        "photo": "https://images.kinorium.com/persona/300/295341.jpg",
                        "birth_date": "30.07.1970",
                    }
                ],
                "movies": [],
            }
            kin.fetch_person_filmography = lambda persona_id="", name="": {
                "kinorium_person_id": "295341",
                "name": "Кристофер Нолан",
                "orig_name": "Christopher Nolan",
                "career_roles": "Режиссёр, Сценарист",
                "sections": [
                    {
                        "key": "director",
                        "label": "Режиссёр",
                        "items": [
                            {
                                "id": "kin_384511",
                                "kinorium_id": "384511",
                                "title": "Интерстеллар",
                                "orig_title": "Interstellar",
                                "year": 2014,
                                "media_type": "movie",
                                "ratings": {"kinorium": 8.6},
                                "providers": [{"id": "hdrezka", "available": True, "quality": "1080p"}],
                            }
                        ],
                    }
                ],
            }
            agg = UnifiedCinemaAggregator(doh, rezka, kin, stremio, resolver)
            sug = agg.unified_search("Кристофер Нолан", mode="suggest")
            self.assertEqual(sug.get("mode"), "suggest")
            self.assertGreaterEqual(len(sug.get("persons") or []), 1)
            self.assertEqual(sug["persons"][0]["orig_name"], "Christopher Nolan")

            full = agg.unified_search("Кристофер Нолан", mode="full")
            self.assertEqual(full["persons"][0]["role"], "Режиссёр")
            titles = {it.get("orig_title") or it.get("title") for it in (full.get("items") or [])}
            self.assertIn("Interstellar", titles)

    @staticmethod
    def _read_text(path: str, encoding: str = "utf-8") -> str:
        with open(path, "r", encoding=encoding) as fh:
            return fh.read()

    @staticmethod
    def _write_bytes(path: str, data: bytes) -> None:
        with open(path, "wb") as fh:
            fh.write(data)

    def test_frontend_dom_css_and_copy_invariants(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        html_txt = self._read_text(os.path.join(root, "public", "index.html"))
        for required_id in (
            "select-catalog-genre",
            "select-catalog-year",
            "search-persons-section",
            "search-persons-row",
            "btn-toggle-player-sidebar",
            "btn-onboarding-skip",
            "ob-cookie-help",
        ):
            self.assertIn(f'id="{required_id}"', html_txt)

        # Ensure stale non-existent filter select IDs never come back in JS
        for jf in [os.path.join(root, "public", "app.js")] + sorted(
            glob.glob(os.path.join(root, "public", "js", "*.js"))
        ):
            jtxt = self._read_text(jf)
            self.assertNotIn('"filter-genre-select"', jtxt)
            self.assertNotIn('"filter-year-select"', jtxt)

        app_js = self._read_text(os.path.join(root, "public", "app.js"))
        self.assertIn("initCustomSelects()", app_js)
        set_css = self._read_text(os.path.join(root, "public", "css", "settings-and-episodes.css"))
        self.assertIn(".atv-cselect-menu", set_css)
        self.assertIn(".atv-native-select-hidden", set_css)

        # Ensure player modal includes genre chips row and shared genre/subheader renderer
        self.assertIn('id="meta-genres-list"', html_txt)
        player_js = self._read_text(os.path.join(root, "public", "js", "player.js"))
        self.assertIn("renderModalGenresAndSubheader", player_js)
        self.assertIn("filterCatalogByGenreFromPlayer", player_js)
        layout_css = self._read_text(os.path.join(root, "public", "css", "catalog-and-player-layout.css"))
        self.assertIn(".atv-meta-genres", layout_css)
        self.assertIn(".atv-meta-genre-chip", layout_css)
        i18n_js = self._read_text(os.path.join(root, "public", "js", "i18n.js"))
        self.assertIn("GENRE_EN_TO_RU", i18n_js)
        self.assertIn("getItemGenreEntries", i18n_js)

        # Ensure uniform cache-buster version across index.html, app.js, and ES module imports
        v_re = re.compile(r"\?v=([A-Za-z0-9_.-]+)")
        html_versions = set(v_re.findall(html_txt))
        self.assertEqual(len(html_versions), 1, f"Mismatched asset versions in index.html: {html_versions}")
        expected_v = next(iter(html_versions))
        for jf in [os.path.join(root, "public", "app.js")] + sorted(
            glob.glob(os.path.join(root, "public", "js", "*.js"))
        ):
            if os.path.basename(jf) == "state.js":
                continue
            j_versions = set(v_re.findall(self._read_text(jf)))
            self.assertEqual(j_versions, {expected_v}, f"Version mismatch in {jf}: {j_versions}")

        # Ensure CSS monochrome, zero-blur, zero-outline invariants
        for cf in sorted(glob.glob(os.path.join(root, "public", "css", "*.css"))):
            ctxt = self._read_text(cf)
            for line in ctxt.splitlines():
                stripped = line.strip()
                if stripped.startswith("/*") or stripped.startswith("*"):
                    continue
                if "backdrop-filter" in stripped:
                    self.assertIn("none", stripped, f"Disallowed backdrop-filter in {cf}: {stripped}")
                if re.search(r"\boutline\s*:", stripped):
                    self.assertRegex(
                        stripped,
                        r"\boutline\s*:\s*(none|0)\b",
                        f"Disallowed focus outline in {cf}: {stripped}",
                    )
                self.assertNotIn("#fbbf24", stripped.lower())
                self.assertNotIn("#6ee7b7", stripped.lower())

        # Ensure zero dotted Russian abbreviations across frontend, backend, and Windows installer
        abbr_re = re.compile(r"(?<![А-Яа-яЁё])(сек|мин|эп|стр|г)\.")
        emoji_re = re.compile(r"[\U0001F300-\U0001FAFF\u2705\u274C]")
        scan_files = (
            sorted(glob.glob(os.path.join(root, "public", "**", "*.*"), recursive=True))
            + sorted(glob.glob(os.path.join(root, "backend", "*.py")))
            + sorted(glob.glob(os.path.join(root, "windows", "**", "*.*"), recursive=True))
            + [os.path.join(root, "server.py")]
        )
        for sf in scan_files:
            if sf.endswith((".png", ".svg", ".ico", ".bmp", ".exe", ".dll", ".res", ".woff", ".woff2", ".webmanifest")):
                continue
            stxt = self._read_text(sf, encoding="utf-8-sig")
            m = abbr_re.search(stxt)
            self.assertIsNone(m, f"Found forbidden dotted abbreviation in {sf}: {m.group(0) if m else ''}")
            em = emoji_re.search(stxt)
            self.assertIsNone(em, f"Found forbidden emoji in {sf}: {em.group(0) if em else ''}")

    def test_hdrezka_page_metadata_extracts_canonical_genres(self):
        sample_page = """
        <html><body>
        <table>
          <tr><td class="l"><h2>Страна</h2>:</td><td>США</td></tr>
          <tr><td class="l"><h2>Жанр</h2>:</td><td>
            <a href="/films/scifi/"><span itemprop="genre">Фантастика</span></a>,
            <a href="/films/drama/"><span itemprop="genre">Драмы</span></a>,
            <a href="/films/thriller/"><span itemprop="genre">Триллеры</span></a>,
            <a href="/films/foreign/"><span itemprop="genre">Зарубежные</span></a>
          </td></tr>
          <tr><td class="l"><h2>Время</h2>:</td><td itemprop="duration">169 минут</td></tr>
        </table>
        <script>sof.tv.initCDNMoviesEvents(2259, 56, 0, 0, false, 'localhost', false, {"streams":""});</script>
        </body></html>
        """

        class _MockRezkaNet:
            def request(self, url, **kwargs):
                return 200, sample_page, {"_final_url": url}

        client = HDRezkaClient(_MockRezkaNet())
        meta = client._resolve_page_metadata(
            "2259",
            "Интерстеллар",
            "Interstellar",
            "https://rezka.ag/films/fiction/2259-interstellar-2014.html",
            year=2014,
            media_type="movie",
        )
        self.assertEqual(meta.get("genres"), ["Фантастика", "Драма", "Триллер"])

    def test_proxy_stream_helpers_and_series_episode_studio_fallback(self):
        raw_vb = "https://stream.voidboost.one/hash:exp:tok/1/2/3/video.mp4"
        wrapped = server._wrap_voidboost_stream_url(raw_vb, absolute_loopback=False)
        self.assertTrue(wrapped.startswith("/api/proxy-stream?url="))
        self.assertEqual(server._unwrap_local_proxy_media_url(wrapped), raw_vb)
        self.assertTrue(server._is_voidboost_cdn_host("coliseum.stream.voidboost.one"))
        self.assertFalse(server._is_voidboost_cdn_host("evil-voidboost.com"))

        sample_series_html = """
        <html><body>
        <ul id="translators-list">
          <li data-translator_id="623">1win Studio</li>
          <li data-translator_id="73">Novamedia</li>
          <li data-translator_id="565">TVShows</li>
          <li data-translator_id="33">Jetvis Studio</li>
          <li data-translator_id="447">Le-Production</li>
          <li data-translator_id="316">октопус (Octopus/Ultradox)</li>
        </ul>
        <ul id="simple-episodes-tabs">
          <li data-season_id="2" data-episode_id="5">5 серия</li>
          <li data-season_id="2" data-episode_id="6">6 серия</li>
        </ul>
        <script>sof.tv.initCDNSeriesEvents(77922, 623, 2, 6, false, 'hdrezka-home.tv', false, true, {"streams":""});</script>
        </body></html>
        """

        class _MockSeriesNet:
            def __init__(self):
                self.mirror_hits = []

            def request(self, url, method="GET", data=None, **kwargs):
                self.mirror_hits.append(url)
                if method == "POST" and "/ajax/get_cdn_series/" in url:
                    body_str = data.decode("utf-8") if isinstance(data, bytes) else str(data or "")
                    if "translator_id=316" in body_str and "season=2" in body_str and "episode=6" in body_str:
                        return (
                            200,
                            json.dumps(
                                {
                                    "success": True,
                                    "url": "[1080p]https://stream.voidboost.one/real/ep6.mp4",
                                    "subtitle": False,
                                }
                            ),
                            {},
                        )
                    return 200, json.dumps({"success": False, "message": "Session expired"}), {}
                return 200, sample_series_html, {"_final_url": url}

        mock_net = _MockSeriesNet()
        client = HDRezkaClient(mock_net)
        res = client.get_streams_for_title(
            item_id="77922",
            title="Гангстерленд",
            orig_title="MobLand",
            year=2025,
            media_type="series",
            translator_id="565",
            season=2,
            episode=6,
            rezka_url="https://hdrezka-home.tv/series/drama/77922-gangsterlend-2025-latest.html",
        )
        self.assertEqual(res["selected_studio"]["id"], "316")
        self.assertEqual(res["studio_auto_switched_from"], "TVShows")
        self.assertEqual(res["default_stream_url"], "https://stream.voidboost.one/real/ep6.mp4")
        # Must not hit secondary mirrors when primary mirror answered HTTP 200 JSON
        self.assertTrue(all("hdrezka-home.tv" in u for u in mock_net.mirror_hits))

    def test_windows_cross_platform_and_installer_invariants(self):
        from backend.backup_stream import BackupStreamingEngine
        from backend.remuxer import RemuxStreamEngine
        from windows.apply_install_prefs import apply_app_lang

        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with tempfile.TemporaryDirectory() as tmp:
            fake_bin = os.path.join(tmp, "backend", "bin")
            os.makedirs(fake_bin, exist_ok=True)
            fake_ffmpeg = os.path.join(fake_bin, "ffmpeg.exe")
            fake_torr = os.path.join(fake_bin, "torrserver.exe")
            self._write_bytes(fake_ffmpeg, b"MZ")
            self._write_bytes(fake_torr, b"MZ")

            found_ff = RemuxStreamEngine._find_binary("ffmpeg", fake_bin, is_windows=True)
            self.assertEqual(found_ff, fake_ffmpeg)

            bs = BackupStreamingEngine(DoHSplitNetworkClient(), HDRezkaClient(DoHSplitNetworkClient()), tmp)
            self.assertEqual(bs._find_torrserver_binary(is_windows=True), fake_torr)

            # Verify Windows autostart command prefers CineFlow.exe --background
            fake_launcher = os.path.join(tmp, "CineFlow.exe")
            self._write_bytes(fake_launcher, b"MZ")
            win_cmd = server._build_windows_autostart_command(base_dir=tmp)
            self.assertEqual(win_cmd, f'"{fake_launcher}" --background')
            self.assertTrue(server.is_system_autostart_supported("win32"))
            self.assertTrue(server.is_system_autostart_supported("darwin"))

            # Verify installer app_lang persistence merges cleanly without losing existing settings
            settings_dir = os.path.join(tmp, "data")
            os.makedirs(settings_dir, exist_ok=True)
            settings_path = os.path.join(settings_dir, "server_settings.json")
            with open(settings_path, "w", encoding="utf-8") as fh:
                json.dump({"user_country": "DE", "lan_access": True}, fh)
            apply_app_lang(tmp, "en")
            merged = json.loads(self._read_text(settings_path))
            self.assertEqual(merged["app_lang"], "en")
            self.assertEqual(merged["user_country"], "DE")
            self.assertTrue(merged["lan_access"])
            self.assertIs(merged["setup_completed"], False)

        # Verify index.html boot language and setup_completed attribute injection
        prev_lang = server.APP_PREFS.get("app_lang", "ru")
        prev_setup = server.APP_PREFS.get("setup_completed", True)
        try:
            server.APP_PREFS["app_lang"] = "en"
            server.APP_PREFS["setup_completed"] = False
            idx_bytes = server.CinemaRequestHandler._load_static_file_bytes(
                os.path.join(root, "public", "index.html")
            )
            self.assertIn(
                b'<html lang="en" data-boot-lang="en" data-setup-completed="false">',
                idx_bytes[:260],
            )
        finally:
            server.APP_PREFS["app_lang"] = prev_lang
            server.APP_PREFS["setup_completed"] = prev_setup

        # Verify NSIS installer script metadata, installer language dialog, and app language custom page
        nsi_path = os.path.join(root, "windows", "installer", "cineflow.nsi")
        nsi_txt = self._read_text(nsi_path)
        self.assertIn('!define APP_VERSION "2.7.0"', nsi_txt)
        self.assertIn('!define APP_PUBLISHER "Atoma"', nsi_txt)
        self.assertIn("!insertmacro MUI_LANGDLL_DISPLAY", nsi_txt)
        self.assertIn("Page custom AppLangPageCreate AppLangPageLeave", nsi_txt)
        self.assertIn('!insertmacro MUI_LANGUAGE "Russian"', nsi_txt)
        self.assertIn('!insertmacro MUI_LANGUAGE "English"', nsi_txt)

        dist_launcher = os.path.join(root, "dist", "CineFlow.exe")
        if os.path.isfile(dist_launcher):
            import struct

            with open(dist_launcher, "rb") as fh:
                pe_head = fh.read(4096)
            pe_off = struct.unpack_from("<I", pe_head, 0x3C)[0]
            subsys = struct.unpack_from("<H", pe_head, pe_off + 24 + 68)[0]
            self.assertEqual(subsys, 2, "CineFlow.exe must use IMAGE_SUBSYSTEM_WINDOWS_GUI (2), not console (3)")

    def test_european_50_countries_onboarding_and_bypass_enforcement(self):
        from backend.backup_stream import BackupStreamingEngine
        from backend.regions import get_country_profile, get_european_countries_list

        eu_list = get_european_countries_list(lang="ru")
        codes = {c["code"] for c in eu_list}
        expected_50 = {
            "AT", "AZ", "AL", "AD", "AM", "BY", "BE", "BG", "BA", "VA",
            "GB", "HU", "DE", "GR", "GE", "DK", "IE", "IS", "ES", "IT",
            "CY", "XK", "LV", "LT", "LI", "LU", "MT", "MD", "MC", "NL",
            "NO", "PL", "PT", "RU", "RO", "SM", "MK", "RS", "SK", "SI",
            "TR", "UA", "FI", "FR", "HR", "ME", "CZ", "CH", "SE", "EE",
        }
        self.assertEqual(len(eu_list), 50)
        self.assertEqual(codes, expected_50)

        for entry in eu_list:
            self.assertTrue(entry.get("restrictions_ru"))
            self.assertTrue(entry.get("restrictions_en"))
            self.assertTrue(entry.get("bypass_summary_ru"))
            self.assertTrue(entry.get("bypass_summary_en"))
            self.assertGreaterEqual(len(entry.get("bypass_tags_ru") or []), 2)
            self.assertGreaterEqual(len(entry.get("bypass_tags_en") or []), 2)

        # Verify Germany (DE) enforces strict anti-P2P policy (no local TorrServer swarm)
        net = DoHSplitNetworkClient()
        rezka = HDRezkaClient(net)
        with tempfile.TemporaryDirectory() as tmp:
            fake_bin = os.path.join(tmp, "backend", "bin")
            os.makedirs(fake_bin, exist_ok=True)
            fake_torr = os.path.join(fake_bin, "torrserver")
            with open(fake_torr, "wb") as fh:
                fh.write(b"#!/bin/sh\nexit 0\n")
            os.chmod(fake_torr, 0o755)

            bs = BackupStreamingEngine(net, rezka, tmp)
            self.assertEqual(bs.mode, "torrserver")

            prof_de = net.configure_country("DE")
            self.assertTrue(net.p2p_strict)
            bs.apply_country_policy(prof_de["p2p_strict"])
            self.assertEqual(bs.mode, "debrid_https")
            self.assertFalse(bs.ensure_local_torrserver())
            # Ensure legacy configure("debrid_https") does NOT re-enable torrserver under DE p2p_strict
            bs.configure(mode="debrid_https")
            self.assertEqual(bs.mode, "debrid_https")

            # Switching to Italy (IT) enables local_media_proxy + DoH and restores torrserver mode
            prof_it = net.configure_country("IT")
            self.assertFalse(net.p2p_strict)
            self.assertTrue(net.local_media_proxy)
            self.assertTrue(net.doh_enabled)
            bs.apply_country_policy(prof_it["p2p_strict"])
            self.assertEqual(bs.mode, "torrserver")

        prof_ru = get_country_profile("RU", lang="ru")
        self.assertTrue(prof_ru["doh_enabled"])
        self.assertTrue(prof_ru["local_media_proxy"])
        self.assertEqual(prof_ru["hdrezka_spoof"], "KZ")

        # Verify 3-step onboarding wizard HTML has stepper, Kinorium choice buttons, and service presets without duplicate country search input
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        html_txt = self._read_text(os.path.join(root, "public", "index.html"))
        self.assertNotIn('id="ob-country-search"', html_txt)
        for ob_id in (
            "ob-stepper",
            "btn-onboarding-back",
            "btn-onboarding-next",
            "btn-onboarding-finish",
            "ob-country-select",
            "ob-country-bypass-note",
            "ob-kin-mode-on",
            "ob-kin-mode-off",
            "ob-kinorium-benefits",
            "ob-kinorium-disabled-note",
            "ob-preset-builtin",
            "ob-preset-all",
            "ob-services-list",
        ):
            self.assertIn(f'id="{ob_id}"', html_txt)

    def test_video_smoothness_and_anti_stall_guards(self):
        from backend.remuxer import RemuxStreamEngine
        import server

        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

        # 1. Embedded video ad-skip subsystem must stay completely removed so parallel background scanners
        #    and live canvas OCR never throttle CDN streams (such as Voidboost MP4/HLS tokens) or stall playback
        self.assertFalse(os.path.exists(os.path.join(root, "backend", "ad_skip.py")))
        self.assertFalse(os.path.exists(os.path.join(root, "backend", "vision_ad_detector.swift")))
        self.assertFalse(os.path.exists(os.path.join(root, "backend", "bin", "vision_ad_detector")))
        srv_txt = self._read_text(os.path.join(root, "server.py"))
        html_txt = self._read_text(os.path.join(root, "public", "index.html"))
        player_js = self._read_text(os.path.join(root, "public", "js", "player.js"))
        for banned in ("AdSkipEngine", "/api/ad-segments", "/api/ad-detect-frame", "/api/ad-scan-stop"):
            self.assertNotIn(banned, srv_txt)
        for banned_ui in ("skip-ad-btn", "auto-skip-ads-toggle", "vc-ad-markers"):
            self.assertNotIn(banned_ui, html_txt)
            self.assertNotIn(banned_ui, player_js)
        self.assertNotIn("initAdSkipSession", player_js)
        # Intro Skip must remain intact
        self.assertIn("skip-intro-btn", html_txt)
        self.assertIn("auto-skip-intro-toggle", html_txt)

        # 2. RemuxStreamEngine emits low-jitter PTS & zero-muxpreload flags
        remux = RemuxStreamEngine(root)
        cmd = remux.build_remux_command(
            source_url="http://127.0.0.1:8090/stream/fname?link=abc&index=1&play",
            audio_index=0,
            start_sec=0.0,
            video_codec="hevc",
            channels=6,
            audio_codec="eac3",
        )
        self.assertIn("+discardcorrupt", cmd)
        self.assertIn("-avoid_negative_ts", cmd)
        self.assertIn("delay_moov+default_base_moof", cmd)
        self.assertIn("-frag_duration", cmd)
        self.assertIn("1024", cmd)
        self.assertIn("-muxdelay", cmd)
        self.assertIn("-muxpreload", cmd)

        # 4. _open_resilient_media_upstream evicts slow cached Voidboost edge IP on _evict_edge=1
        sample_base = "https://stream.voidboost.cc/1/2/3/1080.mp4"
        sample_edge = "https://93.184.216.34/edge/1080.mp4"
        with server.MEDIA_EDGE_LOCK:
            server.VOIDBOOST_EDGE_CACHE[sample_base] = (sample_edge, 9999999999.0)
            server.DEAD_MEDIA_EDGE_IPS.pop("93.184.216.34", None)
        orig_connect = server._connect_media_http
        try:
            def _fail_fast(*_args, **_kwargs):
                raise OSError("synthetic fail")
            server._connect_media_http = _fail_fast
            with self.assertRaises(RuntimeError):
                server._open_resilient_media_upstream(sample_base, evict_cached_edge=True)
            with server.MEDIA_EDGE_LOCK:
                self.assertNotIn(sample_base, server.VOIDBOOST_EDGE_CACHE)
                self.assertIn("93.184.216.34", server.DEAD_MEDIA_EDGE_IPS)
        finally:
            server._connect_media_http = orig_connect
            with server.MEDIA_EDGE_LOCK:
                server.DEAD_MEDIA_EDGE_IPS.pop("93.184.216.34", None)

        # 5. Frontend player.js must not flood v.currentTime on pointermove or download full MP4 via no-cors preload
        with open(os.path.join(root, "public", "js", "player.js"), encoding="utf-8") as f:
            player_js = f.read()
        self.assertNotIn('mode: "no-cors"', player_js)
        self.assertNotIn("v.currentTime = ratio * dur", player_js)
        self.assertIn("_evict_edge=1", player_js)

        # 6. Anti-freeze A/V desync watchdog and hardware decoder recovery guards
        self.assertIn("recoverFrozenVideoPlayback", player_js)
        self.assertIn("getRenderedVideoFrameCount", player_js)
        self.assertIn("initVideoFrameCounter", player_js)
        self.assertIn("getVideoPlaybackQuality", player_js)

    def test_cross_platform_audit_v23_regressions(self):
        import sys
        import tempfile
        from unittest.mock import patch
        import server
        from backend.doh import DoHSplitNetworkClient
        from backend.kinorium import KinoriumService

        # 1. pythonw.exe simulation: sys.stdout = None must never crash CinemaRequestHandler.log_message
        dummy_handler = object.__new__(server.CinemaRequestHandler)
        dummy_handler.command = "GET"
        dummy_handler.path = "/api/catalog?q=Дюна"
        orig_stdout = sys.stdout
        try:
            sys.stdout = None
            dummy_handler.log_message("%s", "200")
        finally:
            sys.stdout = orig_stdout

        # 2. Cross-platform Kinorium JS challenge solver (without macOS jsc) + en.kinorium.com failover
        with tempfile.TemporaryDirectory() as tmp:
            net = DoHSplitNetworkClient()
            net.configure_country("UA")
            kin = KinoriumService(net, os.path.join(tmp, "kin_cache.json"))
            with patch.object(KinoriumService, "JSC_PATH", "/nonexistent/macos/jsc"):
                solved = kin._solve_kinorium_js_challenge(
                    "<script>document['cookie'] = 'pow_token' + '=' + 'ok123; path=/';</script>"
                )
            self.assertIn("pow_token=ok123", solved)

            calls = []

            class _FakeResp:
                status = 200
                headers = {}

                def read(self):
                    return b'{"result":"ok"}'

                def __enter__(self):
                    return self

                def __exit__(self, *_a):
                    return False

            class _FakeOpener:
                def add_handler(self, _h):
                    pass

                def open(self, req, timeout=10):
                    calls.append(req.full_url)
                    if "ru.kinorium.com" in req.full_url:
                        raise OSError("ISP blocked ru.kinorium.com")
                    return _FakeResp()

            with patch.object(net, "_build_opener", return_value=_FakeOpener()):
                code, txt, dom = kin._kinorium_http_request(
                    "https://ru.kinorium.com/handlers/status/", method="POST", data=b"x=1"
                )
            self.assertEqual(code, 200)
            self.assertEqual(dom, "en.kinorium.com")
            self.assertIn('"ok"', txt)
            self.assertTrue(any("ru.kinorium.com" in u for u in calls))
            self.assertTrue(any("en.kinorium.com" in u for u in calls))

        # 3. Suggest search still queries Cinemeta when HDRezka and Kinorium are disabled
        fake_cinemeta_hit = [
            {
                "id": "stremio_tt9999999",
                "imdb_id": "tt9999999",
                "title": "Synthetic Suggest Hit",
                "orig_title": "Synthetic Suggest Hit",
                "year": 2025,
                "type": "movie",
                "poster": "",
                "imdb": 8.1,
            }
        ]
        with patch.object(
            server.aggregator, "is_service_enabled", side_effect=lambda sid: sid == "stremio"
        ), patch.object(
            server.aggregator.stremio, "search_cinemeta", return_value=fake_cinemeta_hit
        ) as m_cm, patch.object(
            server.aggregator, "_search_justwatch_poland", return_value=[]
        ):
            res = server.aggregator.unified_search("Synthetic Suggest Hit", mode="suggest", lang="en")
            self.assertTrue(m_cm.called)
            self.assertTrue(any(it.get("imdb_id") == "tt9999999" for it in res.get("items", [])))

        # 4. Stage-relative player popovers and Windows launcher --stop handler
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        gear_css = self._read_text(os.path.join(root, "public", "css", "settings-and-episodes.css"))
        vc_css = self._read_text(os.path.join(root, "public", "css", "video-controls-and-person.css"))
        launcher_c = self._read_text(os.path.join(root, "windows", "launcher", "cineflow_launcher.c"))
        self.assertIn("calc(100% - 84px)", gear_css)
        self.assertIn("min(300px, 46dvh)", vc_css)
        self.assertNotIn("calc(100% - 84px)", vc_css)
        self.assertIn('L"--stop"', launcher_c)
        self.assertIn("PYTHONUTF8", launcher_c)

    def test_pass3_deep_backend_audit_regressions(self):
        import threading
        import urllib.parse
        import urllib.request
        from unittest.mock import patch
        from backend.backup_stream import BackupStreamingEngine
        from backend.profiles import ProfileManager

        # 1. Kinorium & Profile nickname normalization + challenge cookie + movie synopsis extraction
        with tempfile.TemporaryDirectory() as tmpdir:
            state_fp = os.path.join(tmpdir, "kinorium_state.json")
            with open(state_fp, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "account": {
                            "connected": True,
                            "user_id": "51670",
                            "display_name": "user_51670",
                            "session_cookie": "PHPSESSID=sess51670; ulogin=51670",
                        }
                    },
                    f,
                )
            kin51 = KinoriumService(_DummyNetClient(), storage_dir=tmpdir)
            self.assertEqual(kin51.get_account_summary()["display_name"], "Andrei Crustillio")

            # Challenge cookie must preserve user session_cookie + anti-bot tokens (t, x1)
            ck_hdr = kin51._ensure_kinorium_cookies(challenge_cookie="t=pow_tok_1; x1=777")
            self.assertIn("PHPSESSID=sess51670", ck_hdr)
            self.assertIn("t=pow_tok_1", ck_hdr)
            self.assertIn("x1=777", ck_hdr)

            # Custom display name on 51670 is preserved; other UIDs never receive Andrei Crustillio
            pm = ProfileManager(tmpdir)
            prof_main = pm.get_active_profile()
            fmt_51 = pm.format_profile_for_client(prof_main, lang="ru", live_kinorium_service=kin51)
            self.assertEqual(fmt_51["display_label"], "Andrei Crustillio")

            with kin51._state_lock:
                kin51.state["account"]["display_name"] = "CustomNick"
            fmt_custom = pm.format_profile_for_client(prof_main, lang="ru", live_kinorium_service=kin51)
            self.assertEqual(fmt_custom["display_label"], "CustomNick")

            with tempfile.TemporaryDirectory() as tmpdir2:
                with open(os.path.join(tmpdir2, "kinorium_state.json"), "w", encoding="utf-8") as f2:
                    json.dump(
                        {
                            "account": {
                                "connected": True,
                                "user_id": "999111",
                                "display_name": "user_999111",
                            }
                        },
                        f2,
                    )
                kin_other = KinoriumService(_DummyNetClient(), storage_dir=tmpdir2)
                self.assertNotIn("user_", kin_other.get_account_summary()["display_name"])
                self.assertNotEqual(kin_other.get_account_summary()["display_name"], "Andrei Crustillio")
                fmt_other = pm.format_profile_for_client(prof_main, lang="ru", live_kinorium_service=kin_other)
                self.assertEqual(fmt_other["display_label"], "Личный")

            desc_html = (
                '<div itemprop="description" class="film-page__text">'
                "Вижн пытается восстановить собственную память и человечность после событий в Вествью."
                "</div>"
            )
            extracted_desc = KinoriumService.extract_movie_description_html(desc_html)
            self.assertIn("Вижн пытается восстановить", extracted_desc)

            # 2. Episode HTML parser (guest disabled widgets vs future air dates & TBA) + tombstones
            sample_ep_html = """
            <button id="seasonButton1" class="active">1</button>
            <ul>
              <li class="seasonItem__episodes-item">
                <div class="statusWidgetData disabled" data-movieId="1001" data-movieName="Пилот"></div>
                <span>1 сезон: 1 серия</span>
                <h3>No Strings</h3>
                <span class="date">15 мая 2024</span>
              </li>
              <li class="seasonItem__episodes-item">
                <div class="statusWidgetData disabled" data-movieId="1007" data-movieName="Сожжение"></div>
                <span>1 сезон: 7 серия</span>
                <h3>Immolation</h3>
                <span class="date">15 мая 2099</span>
              </li>
              <li class="seasonItem__episodes-item">
                <div class="statusWidgetData disabled" data-movieId="1008" data-movieName="Навсегда"></div>
                <span>1 сезон: 8 серия</span>
                <h3>Forever</h3>
              </li>
            </ul>
            """
            parsed_eps = KinoriumService.parse_series_episodes_html(sample_ep_html)["episodes"]
            self.assertFalse(parsed_eps[(1, 1)]["is_future"])
            self.assertEqual(parsed_eps[(1, 1)]["air_date_iso"], "2024-05-15")
            self.assertTrue(parsed_eps[(1, 7)]["is_future"])
            self.assertTrue(parsed_eps[(1, 8)]["is_future"])

            # Unmarking an episode stores a tombstone and reverts auto_scrobbled series to watching
            with patch.object(kin51, "_run_remote_sync_bg", return_value=False):
                kin51.toggle_episode_watched(
                    "kin_2800001",
                    "Квест Вижна",
                    season=1,
                    episode=1,
                    watched=True,
                    orig_title="VisionQuest",
                    total_seasons=1,
                    total_episodes_in_season=2,
                    is_series_completed=True,
                )
                kin51.toggle_episode_watched(
                    "kin_2800001",
                    "Квест Вижна",
                    season=1,
                    episode=2,
                    watched=True,
                    orig_title="VisionQuest",
                    total_seasons=1,
                    total_episodes_in_season=2,
                    is_series_completed=True,
                )
                self.assertIn("kin_2800001", kin51.state["watched"])
                kin51.toggle_episode_watched(
                    "kin_2800001",
                    "Квест Вижна",
                    season=1,
                    episode=2,
                    watched=False,
                    orig_title="VisionQuest",
                )
                self.assertNotIn("kin_2800001", kin51.state["watched"])
                self.assertIn("kin_2800001", kin51.state["watching_local"])
                self.assertIn(2, kin51.state["unwatched_episodes"].get("kin_2800001", {}).get("1", []))
                kin51._merge_remote_episodes_into_local(
                    "2800001",
                    {(1, 2): {"ep_id": "1002", "season": 1, "episode": 2, "watched": True}},
                )
                self.assertNotIn(2, kin51.state["watched_episodes"].get("kin_2800001", {}).get("1", []))

            # 3. Kids Mode adult-cartoon blocklist & PIN redaction
            saved_kids = pm.save_profile(profile_id="kids", name="Дети", kids_mode=True, kids_pin="4321")
            self.assertNotIn("kids_pin", saved_kids)
            self.assertTrue(saved_kids.get("has_kids_pin"))
            self.assertFalse(
                pm.is_item_kids_safe({"title": "Рик и Морти", "orig_title": "Rick and Morty", "genres": ["мультфильм", "комедия"]})
            )
            self.assertFalse(
                pm.is_item_kids_safe({"title": "Отель Хазбин", "orig_title": "Hazbin Hotel", "genres": ["animation"]})
            )
            self.assertFalse(
                pm.is_item_kids_safe({"title": "Подростковая драма", "genres": ["семейный"], "age_rating": "16+"})
            )
            self.assertTrue(
                pm.is_item_kids_safe({"title": "Головоломка 2", "orig_title": "Inside Out 2", "genres": ["мультфильм", "семейный"]})
            )

        # 4. SSRF / Host / Origin hardening
        self.assertFalse(server._is_allowed_media_source_url("https://user:pass@cdn.example.com/live.m3u8"))
        self.assertFalse(server._is_allowed_media_source_url("https://cdn.example.com/live.m3u8\r\nX-Inj: 1"))
        self.assertFalse(server._is_allowed_media_source_url("http://100.64.0.10/stream.mp4"))
        self.assertFalse(server._is_allowed_media_source_url("http://198.18.0.5/stream.mp4"))
        self.assertFalse(server._is_allowed_media_source_url("http://metadata.internal/latest"))
        def _chk_origin(orig_val: str) -> bool:
            h = server.CinemaRequestHandler.__new__(server.CinemaRequestHandler)
            h.headers = {"Origin": orig_val}
            h.server = None
            return h._is_trusted_origin()

        self.assertFalse(_chk_origin("file://"))
        self.assertFalse(_chk_origin("http://evil-router.local:8765"))
        self.assertTrue(_chk_origin("http://127.0.0.1:8765"))

        # 5. Live HTTP VisionQuest scenario: /api/title-meta + /api/hdrezka/streams + Backup 4K seasons_map
        fake_rezka_meta = {
            "rezka_id": "88991",
            "rezka_url": "https://hdrezka.ag/series/fiction/88991-vision-quest-2026.html",
            "media_type": "series",
            "description": "",
            "seasons_map": {"1": [1, 2, 3, 4]},
            "prem_episodes_map": {"1": [5, 6]},
            "episodes_meta": {},
            "episodes_titles": {},
            "studios": [{"id": "111", "name": "HDRezka Studio"}],
            "latest_season": 1,
            "latest_episode": 4,
            "is_completed": False,
        }
        fake_en_meta = {
            "imdb_id": "tt27995113",
            "episodes_meta_en": {
                "1": {
                    "1": {"title": "No Strings", "air_date": "2026-09-10", "is_future": False},
                    "2": {"title": "Theseus", "air_date": "2026-09-17", "is_future": False},
                    "3": {"title": "Reboot", "air_date": "2026-09-24", "is_future": False},
                    "4": {"title": "Malware", "air_date": "2026-10-01", "is_future": False},
                    "5": {"title": "Firewall", "air_date": "2026-10-08", "is_future": False},
                    "6": {"title": "Deadlock", "air_date": "2026-10-15", "is_future": False},
                    "7": {"title": "Immolation", "air_date": "2099-11-05", "is_future": True},
                    "8": {"title": "Forever", "air_date": "2099-11-12", "is_future": True},
                }
            },
        }
        fake_kin_extras = {
            "critics_pct": 90,
            "similar_items": [],
            "description": "После событий в Вествью Вижн отправляется на поиски своей идентичности.",
        }

        def _fake_stream_bundle(**kwargs):
            ep_req = int(kwargs.get("episode") or 1)
            if ep_req in (5, 6):
                return {
                    "ok": False,
                    "media_type": "series",
                    "rezka_id": "88991",
                    "rezka_url": fake_rezka_meta["rezka_url"],
                    "seasons_map": {"1": [1, 2, 3, 4]},
                    "prem_episodes_map": {"1": [5, 6]},
                    "is_prem_locked": True,
                    "qualities": {},
                    "default_quality": "",
                    "default_stream_url": "",
                    "description": "",
                }
            return {
                "ok": False,
                "media_type": "series",
                "rezka_id": "88991",
                "rezka_url": fake_rezka_meta["rezka_url"],
                "seasons_map": {"1": [1, 2, 3, 4]},
                "prem_episodes_map": {"1": [5, 6]},
                "qualities": {},
                "default_quality": "",
                "default_stream_url": "",
                "description": "",
            }

        fake_backup_fb = {
            "qualities": {"2160p": "/api/remux-stream?sid=vq_s1e5"},
            "default_quality": "2160p",
            "default_stream_url": "/api/remux-stream?sid=vq_s1e5",
            "subtitles": [],
            "remux_session": {"sid": "vq_s1e5"},
        }

        httpd = server.CinemaThreadingHTTPServer(("127.0.0.1", 0), server.CinemaRequestHandler)
        port = httpd.server_address[1]
        t_srv = threading.Thread(target=httpd.serve_forever, daemon=True)
        t_srv.start()
        try:
            with patch.object(server.profile_manager, "is_kids_mode_active", return_value=False), patch.object(
                server.rezka_client, "_resolve_page_metadata", return_value=fake_rezka_meta
            ), patch.object(
                server.rezka_client, "get_streams_for_title", side_effect=_fake_stream_bundle
            ), patch.object(
                server.en_meta_resolver, "resolve", return_value=fake_en_meta
            ), patch.object(
                server.kinorium_service, "fetch_movie_page_extras", return_value=fake_kin_extras
            ), patch.object(
                server.kinorium_service, "reconcile_series_episodes", return_value={}
            ), patch.object(
                server.kinorium_service, "fetch_series_episodes_state", return_value={"episodes": {}}
            ), patch.object(
                server.aggregator, "resolve_provider_offers_for_title", return_value=[]
            ), patch.object(
                server.kinorium_service, "_resolve_kinorium_id", return_value="2800001"
            ), patch.object(
                server.kinorium_service, "save_series_live_meta", return_value=0
            ), patch.object(
                server.backup_stream_engine, "resolve_original_audio_fallback", return_value=fake_backup_fb
            ) as mock_bk_fb, patch.object(
                server.stremio_engine, "get_subtitles_only", return_value=[]
            ):
                qs_meta = urllib.parse.urlencode(
                    {
                        "id": "kin_2800001",
                        "title": "Квест Вижна",
                        "orig_title": "VisionQuest",
                        "year": "2026",
                        "media_type": "series",
                        "lang": "ru",
                    }
                )
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/title-meta?{qs_meta}", timeout=5) as r_m:
                    meta_json = json.loads(r_m.read().decode("utf-8"))
                self.assertEqual(meta_json["seasons_map"], {"1": [1, 2, 3, 4, 5, 6]})
                self.assertEqual(meta_json["latest_season"], 1)
                self.assertEqual(meta_json["latest_episode"], 6)
                self.assertIn("Вижн отправляется", meta_json["description"])
                self.assertTrue(meta_json["episodes_meta"]["1"]["7"]["is_future"])
                self.assertTrue(meta_json["episodes_meta"]["1"]["8"]["is_future"])

                # S1E5 (HDRezka Premium locked) in RU mode auto-falls back to Backup 4K stream
                qs_e5 = urllib.parse.urlencode(
                    {
                        "id": "kin_2800001",
                        "title": "Квест Вижна",
                        "orig_title": "VisionQuest",
                        "year": "2026",
                        "media_type": "series",
                        "season": "1",
                        "episode": "5",
                        "prefer_original": "0",
                        "lang": "ru",
                    }
                )
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/hdrezka/streams?{qs_e5}", timeout=5) as r_e5:
                    e5_json = json.loads(r_e5.read().decode("utf-8"))
                self.assertTrue(e5_json["ok"])
                self.assertEqual(e5_json["default_stream_url"], "/api/remux-stream?sid=vq_s1e5")
                self.assertIn("Вижн отправляется", e5_json["description"])
                self.assertEqual(e5_json["seasons_map"], {"1": [1, 2, 3, 4, 5, 6]})
                self.assertTrue(mock_bk_fb.called)

                # Unreleased S1E7 is blocked with is_unreleased=True without invoking Backup/Stremio
                mock_bk_fb.reset_mock()
                qs_e7 = urllib.parse.urlencode(
                    {
                        "id": "kin_2800001",
                        "title": "Квест Вижна",
                        "orig_title": "VisionQuest",
                        "year": "2026",
                        "media_type": "series",
                        "season": "1",
                        "episode": "7",
                        "prefer_original": "0",
                        "lang": "ru",
                    }
                )
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/hdrezka/streams?{qs_e7}", timeout=5) as r_e7:
                    e7_json = json.loads(r_e7.read().decode("utf-8"))
                self.assertTrue(e7_json.get("is_unreleased"))
                self.assertEqual(e7_json.get("default_stream_url") or "", "")
                self.assertFalse(mock_bk_fb.called)
        finally:
            httpd.shutdown()
            httpd.server_close()

        # BackupStreamingEngine.search_releases deep-merges episodes_meta and excludes future episodes from seasons_map
        fake_rezka_for_bse = unittest.mock.MagicMock()
        fake_rezka_for_bse.get_streams_for_title.return_value = {}
        bse = BackupStreamingEngine(_DummyNetClient(), fake_rezka_for_bse)
        with patch.object(bse, "_query_jacred_candidates", return_value=[]), patch.object(
            bse, "ensure_local_torrserver", return_value=False
        ):
            fake_st_engine = unittest.mock.MagicMock()
            fake_st_engine.get_streams_for_title.return_value = {
                "imdb_id": "tt27995113",
                "seasons_map": {"1": [1, 2, 3, 4, 5, 6, 7, 8]},
                "episodes_titles": {"1": {"5": "Firewall", "7": "Immolation"}},
                "episodes_meta": {
                    "1": {
                        "5": {"title": "Firewall", "is_future": False, "is_released": True},
                        "7": {"title": "Immolation", "is_future": True, "is_released": False},
                        "8": {"title": "Forever", "is_future": True, "is_released": False},
                    }
                },
                "streams": [],
                "subtitles": [],
            }
            res_4k = bse.search_releases(
                title="Квест Вижна",
                orig_title="VisionQuest",
                year=2026,
                media_type="series",
                season=1,
                episode=5,
                stremio_engine=fake_st_engine,
            )
            self.assertEqual(res_4k["seasons_map"], {"1": [1, 2, 3, 4, 5, 6]})
            self.assertTrue(res_4k["episodes_meta"]["1"]["7"]["is_future"])
            self.assertTrue(res_4k["episodes_meta"]["1"]["8"]["is_future"])

    def test_pass4_deep_backend_audit_regressions(self):
        import socket
        import threading
        import urllib.error
        import urllib.parse
        import urllib.request
        from unittest.mock import patch
        from backend.downloads import parse_http_byte_range
        from backend.profiles import ProfileManager
        from backend.storage_db import CineFlowStorageDB

        # 1. _open_safe_public_url fails closed on non-public / non-HTTP proxy URLs
        with self.assertRaises(urllib.error.URLError):
            server._open_safe_public_url(
                "https://93.184.216.34/sub.vtt",
                proxy_url="socks5://127.0.0.1:9050",
            )
        with self.assertRaises(urllib.error.URLError):
            server._open_safe_public_url(
                "https://93.184.216.34/sub.vtt",
                proxy_url="http://127.0.0.1:8080",
            )

        # 2. Multi-layer /api/proxy-stream unwrapping & HLS manifest relative URI proxy rewriting
        raw_edge = "https://stream.voidboost.one/a/b/master.m3u8"
        once_wrapped = f"/api/proxy-stream?url={urllib.parse.quote(raw_edge, safe='')}"
        twice_wrapped = f"http://127.0.0.1:8765/api/proxy-stream?url={urllib.parse.quote(once_wrapped, safe='')}"
        self.assertEqual(server._unwrap_local_proxy_media_url(twice_wrapped), raw_edge)

        sample_m3u8 = (
            "#EXTM3U\n"
            '#EXT-X-KEY:METHOD=AES-128,URI="keys/enc.key"\n'
            "#EXTINF:6.0,\n"
            "seg_001.ts\n"
        )
        rewritten_m3u8 = server._rewrite_hls_manifest_for_proxy(
            sample_m3u8,
            "https://93.184.216.34/hls/1080/index.m3u8",
        )
        self.assertIn('/api/proxy-stream?url=https%3A%2F%2F93.184.216.34%2Fhls%2F1080%2Fkeys%2Fenc.key', rewritten_m3u8)
        self.assertIn('/api/proxy-stream?url=https%3A%2F%2F93.184.216.34%2Fhls%2F1080%2Fseg_001.ts', rewritten_m3u8)

        # 3. _is_allowed_media_source_url checks net_client.doh_cache when OS DNS fails
        with server.net_client._doh_lock:
            server.net_client.doh_cache["rebind-test.example"] = ("127.0.0.1", 9999999999.0)
        try:
            with patch("socket.getaddrinfo", side_effect=socket.gaierror("offline")):
                self.assertFalse(
                    server._is_allowed_media_source_url(
                        "https://rebind-test.example/video.mp4",
                        allow_torrserver_loopback=False,
                    )
                )
        finally:
            with server.net_client._doh_lock:
                server.net_client.doh_cache.pop("rebind-test.example", None)

        # 4. LAN Stremio addon redaction hides embedded Debrid tokens while preserving builtin addons
        sample_addons = [
            {
                "id": "org.stremio.cinemeta",
                "builtin": True,
                "manifest_url": "https://v3-cinemeta.strem.io/manifest.json",
            },
            {
                "id": "custom.torrentio.rd",
                "manifest_url": "https://torrentio.strem.fun/realdebrid=SUPER_SECRET_RD_TOKEN/manifest.json",
                "base_url": "https://torrentio.strem.fun/realdebrid=SUPER_SECRET_RD_TOKEN",
            },
        ]
        lan_redacted = server._redact_stremio_addons_for_client(sample_addons, is_local_client=False)
        self.assertEqual(lan_redacted[0]["manifest_url"], "https://v3-cinemeta.strem.io/manifest.json")
        self.assertNotIn("SUPER_SECRET_RD_TOKEN", json.dumps(lan_redacted))
        self.assertEqual(lan_redacted[1]["manifest_url"], "https://torrentio.strem.fun/[redacted]/manifest.json")

        # 5. KinoriumService: disconnected 51670 guard, undated earlier episodes, cleared_episode_ratings tombstones & deep-copy backup
        with tempfile.TemporaryDirectory() as tmpdir:
            state_fp = os.path.join(tmpdir, "kinorium_state.json")
            with open(state_fp, "w", encoding="utf-8") as fh:
                json.dump(
                    {
                        "account": {
                            "connected": False,
                            "user_id": "51670",
                            "display_name": "",
                            "session_cookie": "PHPSESSID=stale",
                            "auth_token": "secret_auth_tok",
                        }
                    },
                    fh,
                )
            kin = KinoriumService(_DummyNetClient(), storage_dir=tmpdir)
            self.assertNotEqual(kin.get_account_summary()["display_name"], "Andrei Crustillio")
            self.assertEqual(kin.get_account_summary()["display_name"], "Не подключен")

            undated_early_html = """
            <button id="seasonButton1" class="active">1</button>
            <ul>
              <li class="seasonItem__episodes-item">
                <div class="statusWidgetData" data-movieId="2001" data-movieName="Ep 1"></div>
                <span>1 сезон: 1 серия</span>
                <h3>Pilot</h3>
              </li>
              <li class="seasonItem__episodes-item">
                <div class="statusWidgetData" data-movieId="2002" data-movieName="Ep 2"></div>
                <span>1 сезон: 2 серия</span>
                <h3>Second</h3>
                <span class="date">10 мая 2024</span>
              </li>
              <li class="seasonItem__episodes-item">
                <div class="statusWidgetData disabled" data-movieId="2007" data-movieName="Ep 7"></div>
                <span>1 сезон: 7 серия</span>
                <h3>Future Seven</h3>
                <span class="date">10 мая 2099</span>
              </li>
              <li class="seasonItem__episodes-item">
                <div class="statusWidgetData disabled" data-movieId="2008" data-movieName="Ep 8"></div>
                <span>1 сезон: 8 серия</span>
                <h3>Future Eight</h3>
              </li>
            </ul>
            """
            ep_parsed = KinoriumService.parse_series_episodes_html(undated_early_html)["episodes"]
            self.assertFalse(ep_parsed[(1, 1)]["is_future"])
            self.assertFalse(ep_parsed[(1, 2)]["is_future"])
            self.assertTrue(ep_parsed[(1, 7)]["is_future"])
            self.assertTrue(ep_parsed[(1, 8)]["is_future"])

            with patch.object(kin, "_run_remote_sync_bg", return_value=False):
                kin.set_episode_rating("kin_2800001", "Квест Вижна", season=1, episode=5, score=9, orig_title="VisionQuest")
                self.assertEqual(kin.state["episode_ratings"]["kin_2800001"]["s1e5"]["score"], 9)
                kin.set_episode_rating("kin_2800001", "Квест Вижна", season=1, episode=5, score=0, orig_title="VisionQuest")
                self.assertTrue(kin.state["cleared_episode_ratings"].get("kin_2800001", {}).get("s1e5"))
                kin._merge_remote_episodes_into_local(
                    "2800001",
                    {(1, 5): {"ep_id": "2005", "season": 1, "episode": 5, "watched": True, "rating": 9}},
                )
                self.assertNotIn("s1e5", kin.state.get("episode_ratings", {}).get("kin_2800001", {}))

            exported = kin.export_backup_state(redact_secrets=True)
            self.assertEqual(exported.get("account", {}).get("session_cookie"), "")
            self.assertNotIn("auth_token", exported.get("account", {}))
            exported.setdefault("watched", {})["mutated_key"] = {"score": 10}
            self.assertNotIn("mutated_key", kin.state.get("watched", {}))

            # 6. ProfileManager PIN brute-force lockout persists across restarts in SQLite
            pm1 = ProfileManager(tmpdir)
            pm1.save_profile(profile_id="kids", name="Дети", kids_mode=True, kids_pin="1234")
            pm1.switch_profile("kids")
            for _ in range(pm1.PIN_MAX_ATTEMPTS):
                self.assertFalse(pm1.verify_active_kids_pin("9999"))
            self.assertGreater(pm1.get_pin_lockout_remaining("kids"), 0.0)
            pm2 = ProfileManager(tmpdir)
            self.assertGreater(pm2.get_pin_lockout_remaining("kids"), 0.0)
            self.assertFalse(pm2.verify_active_kids_pin("1234"))

        # 7. Range parser & homonym catalog deduplication
        self.assertIsNone(parse_http_byte_range("bytes=0-10, 20-30", 1000))
        with self.assertRaises(ValueError):
            parse_http_byte_range("bytes=-0", 1000)
        self.assertEqual(parse_http_byte_range("bytes=100-199", 1000), (100, 199))

        homonym_a = {"id": "kin_101", "title": "Добыча", "orig_title": "Prey", "year": 2022, "media_type": "movie"}
        homonym_b = {"id": "kin_202", "title": "Добыча", "orig_title": "The Quarry", "year": 2022, "media_type": "movie"}
        homonym_c = {"id": "rezka_555", "title": "Добыча", "orig_title": "Prey", "year": 2022, "media_type": "movie"}
        self.assertFalse(server.aggregator._is_same_work(homonym_a, homonym_b))
        self.assertFalse(server.aggregator._is_same_work(homonym_c, homonym_b))
        self.assertTrue(server.aggregator._is_same_work(homonym_a, homonym_c))

        # 8. Live HTTP Kids Mode: forged client genres rejected on /api/downloads/start & anonymous/adult magnet rejected on /api/debrid/resolve
        httpd = server.CinemaThreadingHTTPServer(("127.0.0.1", 0), server.CinemaRequestHandler)
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            with patch.object(server.profile_manager, "is_kids_mode_active", return_value=True):
                req_dl = urllib.request.Request(
                    f"http://127.0.0.1:{port}/api/downloads/start",
                    data=json.dumps(
                        {
                            "id": "custom_saw",
                            "title": "Пила 10",
                            "orig_title": "Saw X",
                            "media_type": "movie",
                            "genres": ["семейный", "мультфильм"],
                            "age_rating": "6+",
                            "stream_url": "https://93.184.216.34/video.mp4",
                        }
                    ).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with self.assertRaises(urllib.error.HTTPError) as ctx_dl:
                    urllib.request.urlopen(req_dl, timeout=5)
                self.assertEqual(ctx_dl.exception.code, 403)

                req_anon_mag = urllib.request.Request(
                    f"http://127.0.0.1:{port}/api/debrid/resolve",
                    data=json.dumps(
                        {
                            "magnet": "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
                            "media_type": "movie",
                        }
                    ).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with self.assertRaises(urllib.error.HTTPError) as ctx_mag:
                    urllib.request.urlopen(req_anon_mag, timeout=5)
                self.assertEqual(ctx_mag.exception.code, 403)
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_pass6_audit_regressions(self):
        import gzip
        from unittest.mock import patch

        # 1. DesktopRemoteBroker preserves native_fs_ready, native_pip_ready, active_profile_id, kids_mode
        broker = server.DesktopRemoteBroker(tempfile.mkdtemp(prefix="cineflow_rm_p6_"))
        snap = broker.update_desktop_state(
            {
                "is_player_open": True,
                "native_fs_ready": True,
                "native_pip_ready": True,
                "active_profile_id": "kids",
                "kids_mode": True,
            }
        )
        self.assertTrue(snap["state"]["native_fs_ready"])
        self.assertTrue(snap["state"]["native_pip_ready"])
        self.assertEqual(snap["state"]["active_profile_id"], "kids")
        self.assertTrue(snap["state"]["kids_mode"])

        # 2. KinoriumService reflects non-kin_ items in section counts and catalog items immediately
        with tempfile.TemporaryDirectory(prefix="cineflow_kin_p6_") as tmpdir:
            kin = KinoriumService(server.net_client, tmpdir)
            with patch.object(kin, "_run_remote_sync_bg", return_value=False):
                st_wl = kin.toggle_watchlist("tt8887776", title="Тестовый фильм", orig_title="Test Movie", year=2025, media_type="movie")
                self.assertTrue(st_wl["in_watchlist"])
                self.assertEqual(st_wl["kinorium_counts"]["watchlist"], 1)
                wl_items = kin.get_section_catalog_items("watchlist")
                self.assertEqual(len(wl_items), 1)
                self.assertEqual(wl_items[0]["id"], "tt8887776")

                st_w = kin.toggle_watching("tt8887776", title="Тестовый фильм", orig_title="Test Movie", year=2025, media_type="series")
                self.assertTrue(st_w["watching"])
                self.assertEqual(st_w["kinorium_counts"]["watchlist"], 0)
                self.assertEqual(st_w["kinorium_counts"]["watching"], 1)

                st_done = kin.mark_watched("tt8887776", title="Тестовый фильм", orig_title="Test Movie", watched=True, year=2025, media_type="series")
                self.assertTrue(st_done["watched"])
                self.assertEqual(st_done["kinorium_counts"]["watching"], 0)
                self.assertEqual(st_done["kinorium_counts"]["watched"], 1)

                st_nev = kin.toggle_not_watching("tt8887776", title="Тестовый фильм", orig_title="Test Movie", year=2025, media_type="series")
                self.assertTrue(st_nev["not_watching"])
                self.assertEqual(st_nev["kinorium_counts"]["watched"], 0)
                self.assertEqual(st_nev["kinorium_counts"]["never"], 1)

        # 3. BypassNetworkClient._decompress_bytes preserves Windows-1251 bytes for subtitle conversion
        cp1251_srt = "1\r\n00:00:01,000 --> 00:00:03,000\r\nПривет, мир!\r\n\r\n".encode("cp1251")
        gz_buf = gzip.compress(cp1251_srt)
        raw_dec = server.net_client._decompress_bytes(gz_buf, "gzip")
        self.assertEqual(raw_dec, cp1251_srt)
        vtt_out = server.convert_any_subtitle_to_webvtt(raw_dec)
        self.assertIn("Привет, мир!", vtt_out)

        # 4. HLS manifest proxy rewrites single-quoted and lowercase uri= attributes
        hls_in = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,uri='https://93.184.216.34/key.bin'\nhttps://93.184.216.34/seg1.ts\n"
        hls_out = server._rewrite_hls_manifest_for_proxy(hls_in, "https://93.184.216.34/master.m3u8")
        self.assertIn("/api/proxy-stream?url=", hls_out)
        self.assertEqual(hls_out.count("/api/proxy-stream?url="), 2)

    def test_pass7_backend_frontend_audit(self):
        import urllib.parse
        from backend.tv_cast import DlnaCastManager
        from unittest.mock import patch

        # 1. _unwrap_local_proxy_media_url unwraps both /api/proxy-stream?url= and /api/remux-stream?src=
        raw_torr = "http://127.0.0.1:8090/stream/fname.mkv?link=deadbeef&index=1&play"
        rmx_rel = f"/api/remux-stream?src={urllib.parse.quote(raw_torr, safe='')}&audio=0&start=120"
        self.assertEqual(server._unwrap_local_proxy_media_url(rmx_rel), raw_torr)
        rmx_abs = f"http://127.0.0.1:8765{rmx_rel}"
        self.assertEqual(server._unwrap_local_proxy_media_url(rmx_abs), raw_torr)

        # 2. DlnaCastManager.build_lan_stream_url injects start_sec into /api/remux-stream and TorrServer loopback URLs
        lan_rmx = DlnaCastManager.build_lan_stream_url(rmx_rel, "192.168.1.50", 8765, start_sec=345.6)
        self.assertIn("http://192.168.1.50:8765/api/remux-stream?", lan_rmx)
        self.assertIn("start=345.6", lan_rmx)
        lan_torr = DlnaCastManager.build_lan_stream_url(raw_torr, "192.168.1.50", 8765, start_sec=180.0)
        self.assertIn("http://192.168.1.50:8765/api/remux-stream?", lan_torr)
        self.assertIn("start=180.0", lan_torr)

        # 3. DlnaCastManager.cast_stream skips SOAP Seek on /api/remux-stream (since start= is baked into FFmpeg pipe)
        dlna = DlnaCastManager()
        sent_actions = []

        def _fake_soap(ctrl, act, body, timeout=5.0):
            sent_actions.append(act)
            return True, ""

        with patch.object(dlna, "_send_soap_request", side_effect=_fake_soap):
            res_cast = dlna.cast_stream(
                control_url="http://192.168.1.99:1400/MediaRenderer/AVTransport/Control",
                stream_url=lan_rmx,
                title="Тест · S1E2",
                start_sec=345.6,
            )
        self.assertTrue(res_cast["ok"])
        self.assertTrue(any("#SetAVTransportURI" in a for a in sent_actions))
        self.assertTrue(any("#Play" in a for a in sent_actions))
        self.assertFalse(any("#Seek" in a for a in sent_actions))

        # 4. CatalogAggregator.find_cached_item_for_deep_link finds items across _catalog_by_id and _catalog_cache safely
        hit_dl = server.aggregator.find_cached_item_for_deep_link("kin_10830106")
        if hit_dl is not None:
            self.assertIsInstance(hit_dl, dict)

    def test_pass8_backend_frontend_audit(self):
        from backend.profiles import ProfileManager

        # 1. ProfileManager.filter_catalog_payload_for_kids filters live_series_updates for adult titles
        sample_payload = {
            "items": [
                {"id": "tt0903747", "title": "Во все тяжкие", "orig_title": "Breaking Bad", "genres": ["криминал", "триллер"]},
                {"id": "tt1865718", "title": "Гравити Фолз", "orig_title": "Gravity Falls", "genres": ["мультфильм", "семейный"]},
            ],
            "live_series_updates": [
                {"id": "tt0903747", "title": "Во все тяжкие", "orig_title": "Breaking Bad", "latest_season": 5, "latest_episode": 16},
                {"id": "tt1190634", "title": "Пацаны", "orig_title": "The Boys", "latest_season": 4, "latest_episode": 8},
                {"id": "tt1865718", "title": "Гравити Фолз", "orig_title": "Gravity Falls", "latest_season": 2, "latest_episode": 20},
            ],
        }
        filtered_cat = ProfileManager.filter_catalog_payload_for_kids(sample_payload)
        self.assertEqual([it["id"] for it in filtered_cat["items"]], ["tt1865718"])
        self.assertEqual([u["id"] for u in filtered_cat["live_series_updates"]], ["tt1865718"])

        # 2. Core backend modules use 25% FIFO cache eviction instead of full .clear() on capacity overflow
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        for rel_path in ("backend/aggregator.py", "backend/backup_stream.py", "backend/hdrezka.py", "backend/kinorium.py"):
            with open(os.path.join(repo_root, rel_path), "r", encoding="utf-8") as f:
                src = f.read()
            self.assertIn("for k_ev in list(", src, f"Expected FIFO eviction in {rel_path}")

    def test_pass9_backend_frontend_audit(self):
        import socket
        import threading
        import time
        import urllib.error
        import urllib.parse
        import urllib.request
        from unittest.mock import patch
        from backend.downloads import OfflineDownloadManager
        from backend.kinorium import _safe_year_int
        from backend.profiles import ProfileManager
        from backend.remote_control import DesktopRemoteBroker
        from backend.storage_db import CineFlowStorageDB

        # 1. P9-01 & P9-17: OfflineDownloadManager.enqueue_download clears pending_cleanup and saves index without AttributeError
        #    and delete_profile_downloads removes tasks belonging to a deleted profile
        with tempfile.TemporaryDirectory(prefix="cineflow_dl_p9_") as tmpdir:
            fake_remux = unittest.mock.MagicMock()
            fake_remux.is_available.return_value = True
            dm = OfflineDownloadManager(tmpdir, fake_remux, _DummyNetClient())
            did_test = dm.build_download_id(
                item_id="kin_100",
                title="Test Pending",
                media_type="movie",
                season=1,
                episode=1,
                quality="1080p",
                studio="HDRezka",
            )
            with dm._lock:
                dm._items[did_test] = {
                    "id": did_test,
                    "download_id": did_test,
                    "item_id": "kin_100",
                    "title": "Test Pending",
                    "media_type": "movie",
                    "season": 1,
                    "episode": 1,
                    "quality": "1080p",
                    "studio": "HDRezka",
                    "status": "completed",
                    "pending_cleanup": True,
                    "created_at": 1000,
                    "completed_at": 1000,
                    "profile_id": "prof_del",
                }
                dm._save_index_locked()
            res_re = dm.enqueue_download(
                item_id="kin_100",
                title="Test Pending",
                media_type="movie",
                season=1,
                episode=1,
                quality="1080p",
                studio="HDRezka",
                stream_url="https://93.184.216.34/video.mp4",
            )
            self.assertEqual(res_re["download_id"], did_test)
            self.assertFalse(dm._items[did_test].get("pending_cleanup"))
            removed_cnt = dm.delete_profile_downloads("prof_del")
            self.assertEqual(removed_cnt, 1)
            self.assertNotIn(did_test, dm._items)

        # 2. P9-02 & P9-15: _safe_year_int handles ranges ("2019-2022", "2020–present") and invalid strings safely
        self.assertEqual(_safe_year_int("2019-2022"), 2019)
        self.assertEqual(_safe_year_int("2021–н.в."), 2021)
        self.assertEqual(_safe_year_int("TBA", 0), 0)
        self.assertEqual(_safe_year_int(None, 2025), 2025)

        # 3. P9-04: KinoriumService.switch_state_file(force_reload=True, discard_dirty=True) reloads disk/DB state
        with tempfile.TemporaryDirectory(prefix="cineflow_kin_p9_") as tmpdir:
            kin = KinoriumService(_DummyNetClient(), tmpdir)
            with kin._state_lock:
                kin.state["watched"]["old_dirty"] = {"id": "old_dirty", "title": "Dirty"}
                kin._save_dirty = True
            ext_writer = KinoriumService(_DummyNetClient(), tmpdir)
            ext_writer.import_backup_state({"watched": {"fresh_disk": {"id": "fresh_disk", "title": "Fresh"}}})
            kin.switch_state_file(kin.state_file, force_reload=True, discard_dirty=True)
            self.assertNotIn("old_dirty", kin.state.get("watched", {}))
            self.assertIn("fresh_disk", kin.state.get("watched", {}))

        # 4. P9-06: DesktopRemoteBroker.wait_for_commands returns immediately without 30s block when since_seq < 0 or > _cmd_seq
        with tempfile.TemporaryDirectory(prefix="cineflow_rm_p9_") as tmpdir:
            broker = DesktopRemoteBroker(tmpdir)
            broker.enqueue_command("toggle_play", {})
            t0 = time.time()
            initial_sync = broker.wait_for_commands(after_seq=-1, timeout=5.0)
            self.assertLess(time.time() - t0, 1.0)
            self.assertEqual(initial_sync["commands"], [])
            self.assertEqual(initial_sync["latest_seq"], 1)

            future_sync = broker.wait_for_commands(after_seq=999, timeout=5.0)
            self.assertEqual(future_sync["commands"], [])
            self.assertEqual(future_sync["latest_seq"], 1)

        # 5. P9-16: Pre-connect DNS/IP validation blocks DNS rebinding to loopback/private IP
        with patch("socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 80))]):
            with self.assertRaises(urllib.error.URLError):
                server._connect_strictly_public_socket("rebind-evil.example.com", 80, 2.0)

        # 6. P9-19: StorageDB.set_cache_entries_batch writes multiple entries in one transaction
        with tempfile.TemporaryDirectory(prefix="cineflow_db_p9_") as tmpdir:
            db = CineFlowStorageDB(os.path.join(tmpdir, "test.sqlite3"))
            db.set_cache_entries_batch("en_meta", {"k1": {"title": "One"}, "k2": {"title": "Two"}})
            loaded_batch = db.load_cache_dict("en_meta")
            self.assertEqual(loaded_batch["k1"]["title"], "One")
            self.assertEqual(loaded_batch["k2"]["title"], "Two")
            db.close()

        # 7. P9-03, P9-07, P9-20: Live HTTP verification for /api/tv/devices redaction, /api/remote/command Kids Mode, and /api/kinorium/continue-watching/remove counts
        httpd = server.CinemaThreadingHTTPServer(("127.0.0.1", 0), server.CinemaRequestHandler)
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            # P9-07: Remote play_item blocked in Kids Mode for adult item
            with patch.object(server.profile_manager, "is_kids_mode_active", return_value=True):
                req_rm = urllib.request.Request(
                    f"http://127.0.0.1:{port}/api/remote/command",
                    data=json.dumps(
                        {
                            "key": server.remote_broker.pair_token,
                            "action": "play_item",
                            "payload": {
                                "item": {
                                    "id": "tt0903747",
                                    "title": "Во все тяжкие",
                                    "orig_title": "Breaking Bad",
                                    "genres": ["криминал", "триллер"],
                                    "age_rating": "18+",
                                }
                            },
                        }
                    ).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with self.assertRaises(urllib.error.HTTPError) as ctx_rm:
                    urllib.request.urlopen(req_rm, timeout=5)
                self.assertEqual(ctx_rm.exception.code, 403)

            # P9-20: /api/kinorium/continue-watching/remove and restore return kinorium_counts
            req_cw = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/kinorium/continue-watching/remove",
                data=json.dumps({"id": "kin_999888777", "title": "Тест CW"}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req_cw, timeout=5) as r_cw:
                cw_json = json.loads(r_cw.read().decode("utf-8"))
            self.assertTrue(cw_json["ok"])
            self.assertIn("kinorium_counts", cw_json)

            req_cwr = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/kinorium/continue-watching/restore",
                data=json.dumps({"id": "kin_999888777", "title": "Тест CW"}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req_cwr, timeout=5) as r_cwr:
                cwr_json = json.loads(r_cwr.read().decode("utf-8"))
            self.assertTrue(cwr_json["ok"])
            self.assertIn("kinorium_counts", cwr_json)
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_pass10_backend_frontend_audit(self):
        import urllib.request
        from backend.backup_stream import BackupStreamingEngine
        from backend.downloads import OfflineDownloadManager
        from backend.profiles import ProfileManager
        from backend.remuxer import RemuxStreamEngine
        from backend.stremio import convert_srt_or_vtt_to_webvtt
        from backend.subtitles import (
            SubtitleSearchService,
            convert_ass_to_webvtt,
            decode_subtitle_bytes,
        )
        from backend.tv_cast import DlnaCastManager

        # 1. P10-05: RemuxStreamEngine.build_ffmpeg_env strips HTTP_PROXY/HTTPS_PROXY for loopback TorrServer
        env_loop = RemuxStreamEngine.build_ffmpeg_env("http://127.0.0.1:8090/stream/fname.mkv")
        self.assertEqual(env_loop.get("NO_PROXY"), "127.0.0.1,localhost,::1")
        self.assertNotIn("HTTP_PROXY", env_loop)
        self.assertNotIn("http_proxy", env_loop)

        # 2. P10-07: Kids Mode catalog filter does not allow genre-less live_series_updates for unknown adult titles
        sample_payload = {
            "items": [
                {"id": "tt1865718", "title": "Гравити Фолз", "orig_title": "Gravity Falls", "genres": ["мультфильм", "семейный"]},
            ],
            "live_series_updates": [
                {"id": "kin_999111", "title": "Неизвестный сериал для взрослых", "latest_season": 2, "latest_episode": 5},
                {"id": "tt1865718", "title": "Гравити Фолз", "latest_season": 2, "latest_episode": 20},
            ],
        }
        filtered_cat = ProfileManager.filter_catalog_payload_for_kids(sample_payload)
        self.assertEqual([u["id"] for u in filtered_cat["live_series_updates"]], ["tt1865718"])

        # 3. P10-07: OfflineDownloadManager._is_entry_kids_safe respects explicit kids_safe=False even on 'kids' profile
        self.assertFalse(
            OfflineDownloadManager._is_entry_kids_safe(
                {"id": "dl_adult", "title": "Adult", "profile_id": "kids", "kids_safe": False}
            )
        )
        self.assertFalse(
            OfflineDownloadManager._is_entry_kids_safe(
                {"id": "dl_legacy_main", "title": "Legacy Main", "profile_id": "main"}
            )
        )
        self.assertTrue(
            OfflineDownloadManager._is_entry_kids_safe(
                {"id": "dl_legacy_kids", "title": "Legacy Kids", "profile_id": "kids"}
            )
        )

        # 4. P10-08: BackupStreamingEngine._extract_explicit_seasons_in_text expands multi-season ranges
        self.assertEqual(
            BackupStreamingEngine._extract_explicit_seasons_in_text("Show.S01-S03.1080p.WEB-DL"),
            {1, 2, 3},
        )
        self.assertEqual(
            BackupStreamingEngine._extract_explicit_seasons_in_text("Сериал (1-4 сезон) 2160p"),
            {1, 2, 3, 4},
        )

        # 5. P10-08: BackupStreamingEngine enforces p2p_strict (DE country policy) even when configure(mode="torrserver") is called
        bkp = BackupStreamingEngine(_DummyNetClient(), None)
        bkp.apply_country_policy(True)
        bkp.configure(mode="torrserver")
        self.assertNotEqual(bkp.mode, "torrserver")

        # 6. P10-11: KOI8-R vs CP1251 detection, ASS multi-layer deduplication, and single-newline SRT cue boundary fix
        koi8_bytes = "Привет, мир! Это проверка кодировки субтитров.".encode("koi8-r")
        self.assertEqual(decode_subtitle_bytes(koi8_bytes), "Привет, мир! Это проверка кодировки субтитров.")
        cp1251_bytes = "Привет, мир! Это проверка кодировки субтитров.".encode("cp1251")
        self.assertEqual(decode_subtitle_bytes(cp1251_bytes), "Привет, мир! Это проверка кодировки субтитров.")

        ass_sample = (
            "[Events]\n"
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
            "Dialogue: 0,0:00:01.00,0:00:03.00,Shadow,,0,0,0,,{\\blur3}Hello World\n"
            "Dialogue: 1,0:00:01.00,0:00:03.00,Main,,0,0,0,,{\\pos(100,200)}Hello World\n"
        )
        vtt_ass = convert_ass_to_webvtt(ass_sample)
        self.assertEqual(vtt_ass.count("Hello World"), 1)

        srt_single_nl = (
            "1\n"
            "00:00:01,000 --> 00:00:02,500\n"
            "First cue line\n"
            "2\n"
            "00:00:03,000 --> 00:00:04,500\n"
            "Second cue line\n"
        )
        vtt_srt = convert_srt_or_vtt_to_webvtt(srt_single_nl)
        self.assertEqual(vtt_srt.count("-->"), 2)
        self.assertNotIn("\n2\n00:00:03", vtt_srt)

        # 7. P10-11: SubtitleSearchService.translate_subtitle_word strips HTML/ASS tags before lookup
        sub_svc = SubtitleSearchService(_DummyNetClient(), None)
        tr_res = sub_svc.translate_subtitle_word("<i>{\\i1}hello{\\i0}</i>", context="<i>hello</i> world", target_lang="ru")
        self.assertTrue(tr_res["ok"])
        self.assertEqual(tr_res["word"], "hello")
        self.assertEqual(tr_res["translation"], "привет")

        # 8. P10-12: DlnaCastManager.build_lan_stream_url strips stale start= when start_sec <= 5.0
        lan_u = DlnaCastManager.build_lan_stream_url(
            "/api/remux-stream?src=http%3A%2F%2F127.0.0.1%3A8090%2Fstream%2F1&audio=0&start=420.0",
            "192.168.1.50",
            8765,
            start_sec=0.0,
        )
        self.assertNotIn("start=", lan_u)

        # 9. P10-12: HEAD /api/remux-stream returns video/mp4 Content-Type
        import threading
        httpd = server.CinemaThreadingHTTPServer(("127.0.0.1", 0), server.CinemaRequestHandler)
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            req_head = urllib.request.Request(f"http://127.0.0.1:{port}/api/remux-stream", method="HEAD")
            with urllib.request.urlopen(req_head, timeout=5) as r_head:
                self.assertEqual(r_head.status, 200)
                self.assertIn("video/mp4", r_head.headers.get("Content-Type", ""))
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_pass11_fullstack_audit_fixes(self):
        import time
        from backend.remote_control import DesktopRemoteBroker
        from backend.storage_db import CineFlowStorageDB

        # 1. DB-01 & DB-03: CineFlowStorageDB handles NaN/Inf/set/bytes and preserves cache TTL on unchanged keys
        with tempfile.TemporaryDirectory(prefix="cineflow_p11_db_") as tmpdir:
            db = CineFlowStorageDB(tmpdir)
            db.set_kv("test_ns", "nan_test", {"val": float("nan"), "inf": float("inf"), "tags": {"a", "b"}})
            loaded = db.get_kv("test_ns", "nan_test")
            self.assertIsNone(loaded["val"])
            self.assertIsNone(loaded["inf"])
            self.assertEqual(sorted(loaded["tags"]), ["a", "b"])

            db.set_cache_entry("ns_ttl", "k1", {"hello": "world"})
            with db._lock:
                row1 = db._conn.execute(
                    "SELECT updated_at FROM cache_entries WHERE cache_name = 'ns_ttl' AND entry_key = 'k1'"
                ).fetchone()
                old_ts = float(row1[0]) - 120.0
                db._conn.execute(
                    "UPDATE cache_entries SET updated_at = ? WHERE cache_name = 'ns_ttl' AND entry_key = 'k1'",
                    (old_ts,),
                )
            db.save_cache_dict("ns_ttl", {"k1": {"hello": "world"}, "k2": {"new": 1}})
            with db._lock:
                row2 = db._conn.execute(
                    "SELECT updated_at FROM cache_entries WHERE cache_name = 'ns_ttl' AND entry_key = 'k1'"
                ).fetchone()
                self.assertAlmostEqual(float(row2[0]), old_ts, places=2)
            db.close()
            # Closed DB guards must not raise programming errors
            self.assertIsNone(db.get_kv("test_ns", "nan_test"))

        # 2. SRV-03 & SRV-04: SSRF CGNAT/Benchmark IP blocking & TorrServer loopback path allowlist
        self.assertFalse(server._is_strictly_public_ip_obj("100.64.0.1"))
        self.assertFalse(server._is_strictly_public_ip_obj("198.18.0.1"))
        self.assertFalse(
            server._is_allowed_media_source_url(
                "http://127.0.0.1:8090/settings",
                allow_torrserver_loopback=True,
            )
        )
        self.assertTrue(
            server._is_allowed_media_source_url(
                "http://127.0.0.1:8090/stream/movie.mkv?index=1&play",
                allow_torrserver_loopback=True,
            )
        )

        # 3. RC-01: DesktopRemoteBroker brute-force lockout & immediate wait_for_state on negative since_seq
        with tempfile.TemporaryDirectory(prefix="cineflow_p11_rc_") as tmpdir:
            broker = DesktopRemoteBroker(tmpdir)
            for _ in range(30):
                self.assertFalse(broker.verify_key("wrong_token", is_loopback=False))
            # Even valid token is rejected on non-loopback while locked out
            self.assertFalse(broker.verify_key(broker._pair_token, is_loopback=False))
            self.assertTrue(broker.verify_key(broker._pair_token, is_loopback=True))
            t0 = time.time()
            st_snap = broker.wait_for_state(since_seq=-1, timeout=5.0)
            self.assertLess(time.time() - t0, 1.0)
            self.assertIn("seq", st_snap)

        # 4. BE-02, BE-03, BE-05: Kinorium cw_dismissed cleanup, cross-season advance, and redacted backup import
        with tempfile.TemporaryDirectory(prefix="cineflow_p11_kin_") as tmpdir:
            kin = KinoriumService(_DummyNetClient(), tmpdir)
            with kin._state_lock:
                kin.state.setdefault("account", {})["session_cookie"] = "secret_cookie_val"
                kin.state.setdefault("account", {})["auth_token"] = "secret_tok_val"
                kin.state.setdefault("series_live_meta", {})["kin_555"] = {
                    "seasons_map": {"1": [1, 2], "2": [1, 2, 3]},
                    "latest_season": 2,
                    "latest_episode": 3,
                }
            kin._build_lookup_indices()
            res_d = kin.dismiss_continue_watching("kin_555", title="Test Series")
            self.assertEqual(res_d["cw_dismissed_count"], 1)
            self.assertEqual(kin.get_account_summary()["cw_dismissed_count"], 1)
            # Updating playback progress clears cw_dismissed automatically
            kin.update_progress_and_scrobble(
                "kin_555",
                title="Test Series",
                media_type="series",
                season=1,
                episode=2,
                current_time=120.0,
                duration=1200.0,
                total_seasons=2,
                total_episodes_in_season=2,
            )
            self.assertEqual(kin.get_account_summary()["cw_dismissed_count"], 0)
            # Finishing S1E2 (season finale of S1) advances next episode to S2E1 when S2 is in seasons_map
            kin._record_episode_watched("kin_555", "Test Series", "", 1, 2, resolved_kid="555")
            cw_list = kin.state.get("continue_watching") or []
            self.assertTrue(len(cw_list) >= 1)
            self.assertEqual(cw_list[0].get("season"), 2)
            self.assertEqual(cw_list[0].get("episode"), 1)
            # Importing redacted backup preserves existing session_cookie and auth_token
            exported = kin.export_backup_state(redact_secrets=True)
            self.assertEqual(exported["account"]["session_cookie"], "")
            kin.import_backup_state(exported)
            self.assertEqual(kin.state["account"]["session_cookie"], "secret_cookie_val")
            self.assertEqual(kin.state["account"]["auth_token"], "secret_tok_val")

    def test_pass12_auto_updater_and_fullstack_audit_fixes(self):
        import hashlib
        from backend.downloads import OfflineDownloadManager
        from backend.profiles import ProfileManager
        from backend.storage_db import CineFlowStorageDB
        from backend.updater import (
            AppUpdater,
            is_newer_version,
            normalize_version_str,
            parse_semver,
        )

        # 1. AppUpdater semver comparison, manifest parsing & GitHub release parsing
        self.assertEqual(parse_semver("v2.6.6"), (2, 6, 6, 0))
        self.assertEqual(normalize_version_str("v2.7.0-beta1"), "2.7.0")
        self.assertTrue(is_newer_version("2.6.11", "2.6.6"))
        self.assertTrue(is_newer_version("2.7.0", "2.6.119"))
        self.assertFalse(is_newer_version("2.6.6", "2.6.6"))
        self.assertFalse(is_newer_version("2.6.5", "2.6.6"))

        with tempfile.TemporaryDirectory(prefix="cineflow_p12_upd_") as tmpdir:
            upd = AppUpdater(
                current_version="2.6.6",
                storage_dir=tmpdir,
                settings_getter=lambda: {
                    "auto_check_updates": True,
                    "update_repo": "crustillio/cineflow",
                    "update_manifest_url": "",
                },
            )
            sample_manifest = {
                "version": "2.6.11",
                "published_at": "2026-11-02T18:00:00Z",
                "notes": "Автоматическое обновление в 1 клик",
                "platforms": {
                    "macos": {
                        "url": "https://example.com/CineFlow-2.6.11.dmg",
                        "name": "CineFlow-2.6.11.dmg",
                        "sha256": "a" * 64,
                        "size": 123456,
                    },
                    "windows": {
                        "url": "https://example.com/CineFlow-Setup-2.6.11.exe",
                        "name": "CineFlow-Setup-2.6.11.exe",
                        "sha256": "b" * 64,
                        "size": 234567,
                    },
                },
            }
            parsed_m = upd._parse_manifest_payload(sample_manifest, "macos")
            self.assertIsNotNone(parsed_m)
            self.assertEqual(parsed_m["latest_version"], "2.6.11")
            self.assertIn("CineFlow", parsed_m["asset_name"])
            self.assertEqual(len(parsed_m["expected_sha256"]), 64)

            fake_body = b"fake-installer-binary-payload-cineflow"
            expected_sha = hashlib.sha256(fake_body).hexdigest()
            sample_gh_release = {
                "tag_name": "v2.6.11",
                "published_at": "2026-11-02T19:00:00Z",
                "html_url": "https://github.com/crustillio/cineflow/releases/tag/v2.6.11",
                "body": "## Что нового\n- Быстрое обновление\n",
                "assets": [
                    {
                        "name": "CineFlow.dmg",
                        "browser_download_url": "https://github.com/crustillio/cineflow/releases/download/v2.6.11/CineFlow.dmg",
                        "size": len(fake_body),
                        "digest": f"sha256:{expected_sha}",
                    },
                    {
                        "name": "CineFlow-Setup-2.6.11.exe",
                        "browser_download_url": "https://github.com/crustillio/cineflow/releases/download/v2.6.11/CineFlow-Setup-2.6.11.exe",
                        "size": len(fake_body),
                        "digest": f"sha256:{expected_sha}",
                    },
                ],
            }
            parsed_gh = upd._parse_manifest_payload(sample_gh_release, "macos")
            self.assertIsNotNone(parsed_gh)
            self.assertEqual(parsed_gh["latest_version"], "2.6.11")
            self.assertTrue(parsed_gh["asset_url"].startswith("https://github.com/"))
            self.assertEqual(parsed_gh["expected_sha256"], expected_sha)

        # 2. SRV-01: ProfileManager.verify_any_kids_pin verifies across all profiles with kids_pin
        with tempfile.TemporaryDirectory(prefix="cineflow_p12_prof_") as tmpdir:
            pm = ProfileManager(tmpdir)
            pm.save_profile(profile_id="kids1", name="Kids 1", kids_mode=True, kids_pin="4321")
            self.assertTrue(pm.has_any_kids_pin())
            self.assertTrue(pm.verify_any_kids_pin("4321"))
            self.assertFalse(pm.verify_any_kids_pin("0000"))
            self.assertFalse(pm.verify_any_kids_pin(""))

        # 3. DB-01: StorageDB.save_profile_state rewrites all sections when db_prev is None even if caller_prev has hashes
        with tempfile.TemporaryDirectory(prefix="cineflow_p12_db_") as tmpdir:
            db = CineFlowStorageDB(tmpdir)
            sample_state = {"watched": {"100": {"title": "Movie"}}, "watchlist": {"200": {"title": "Watch"}}}
            h1 = db.save_profile_state("prof_test", sample_state)
            self.assertTrue(h1)
            db.delete_profile_state("prof_test")
            self.assertIsNone(db.load_profile_state("prof_test"))
            # Save again passing stale caller_prev hashes after DB rows were deleted
            db.save_profile_state("prof_test", sample_state, last_hashes=h1)
            reloaded = db.load_profile_state("prof_test")
            self.assertIsNotNone(reloaded)
            self.assertEqual(reloaded["watched"]["100"]["title"], "Movie")
            self.assertEqual(reloaded["watchlist"]["200"]["title"], "Watch")
            db.close()

        # 4. DL-02: OfflineDownloadManager.handle_watched_scrobble isolates auto-delete by profile_id
        from unittest.mock import MagicMock
        with tempfile.TemporaryDirectory(prefix="cineflow_p12_dl_") as tmpdir:
            fake_remux = MagicMock()
            fake_remux.is_available.return_value = True
            dm = OfflineDownloadManager(
                tmpdir,
                fake_remux,
                _DummyNetClient(),
                start_workers=False,
            )
            dm._db.set_kv("downloads", "prefs", {"auto_cleanup_watched": True})
            with dm._lock:
                dm._items["dl_prof_a"] = {
                    "id": "dl_prof_a",
                    "download_id": "dl_prof_a",
                    "item_id": "tt1234567",
                    "title": "Shared Movie",
                    "media_type": "movie",
                    "status": "completed",
                    "profile_id": "prof_a",
                }
                dm._items["dl_prof_b"] = {
                    "id": "dl_prof_b",
                    "download_id": "dl_prof_b",
                    "item_id": "tt1234567",
                    "title": "Shared Movie",
                    "media_type": "movie",
                    "status": "completed",
                    "profile_id": "prof_b",
                }
            res_scrobble = dm.handle_watched_scrobble(
                item_id="tt1234567",
                title="Shared Movie",
                media_type="movie",
                active_download_id="",
                profile_id="prof_a",
            )
            self.assertIn("dl_prof_a", res_scrobble["cleaned"])
            self.assertNotIn("dl_prof_b", res_scrobble["cleaned"])
            self.assertIn("dl_prof_b", dm._items)


if __name__ == "__main__":
    unittest.main()
