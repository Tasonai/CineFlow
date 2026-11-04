import json
import os
import tempfile
import unittest

from backend.kinorium import KinoriumService
from backend.remuxer import RemuxStreamEngine
from backend.skip_intro import SkipIntroEngine


class _MockNetClient:
    def __init__(self, responses=None):
        self.responses = responses or {}

    def request(self, url, spoof_geo_country="PL", headers=None, timeout=8, **kwargs):
        for pattern, payload in self.responses.items():
            if pattern in url:
                return 200, json.dumps(payload), {}
        return 404, "", {}


class TestAutoStatusRules(unittest.TestCase):
    def test_legacy_085_threshold_migrates_to_095(self):
        with tempfile.TemporaryDirectory() as td:
            with open(os.path.join(td, "kinorium_state.json"), "w", encoding="utf-8") as f:
                json.dump({"account": {"auto_scrobble_threshold": 0.85}}, f)
            svc = KinoriumService(_MockNetClient(), td)
            self.assertEqual(svc.state["account"]["auto_scrobble_threshold"], 0.95)

    def test_movie_10pct_watching_and_95pct_watched(self):
        with tempfile.TemporaryDirectory() as td:
            svc = KinoriumService(_MockNetClient(), td)

            # 5% -> neither 'Смотрю' nor 'Просмотрено'
            r5 = svc.update_progress_and_scrobble(
                item_id="kin_7001",
                title="Тестовый фильм",
                orig_title="Test Movie",
                media_type="movie",
                current_time=300,
                duration=6000,
            )
            self.assertFalse(r5["promoted_to_watching"])
            self.assertFalse(r5["kinorium_status"]["watching"])
            self.assertFalse(r5["kinorium_status"]["watched"])

            # 10% -> automatically marked as 'Смотрю'
            r10 = svc.update_progress_and_scrobble(
                item_id="kin_7001",
                title="Тестовый фильм",
                orig_title="Test Movie",
                media_type="movie",
                current_time=600,
                duration=6000,
            )
            self.assertTrue(r10["promoted_to_watching"])
            self.assertTrue(r10["kinorium_status"]["watching"])
            self.assertFalse(r10["kinorium_status"]["watched"])

            # 90% (above old 85%, below new 95%, no credits) -> stays 'Смотрю', NOT 'Просмотрено'
            r90 = svc.update_progress_and_scrobble(
                item_id="kin_7001",
                title="Тестовый фильм",
                orig_title="Test Movie",
                media_type="movie",
                current_time=5400,
                duration=6000,
            )
            self.assertFalse(r90["just_scrobbled"])
            self.assertTrue(r90["kinorium_status"]["watching"])
            self.assertFalse(r90["kinorium_status"]["watched"])

            # 95% -> automatically moves from 'Смотрю' to 'Просмотрено' and leaves continue_watching
            r95 = svc.update_progress_and_scrobble(
                item_id="kin_7001",
                title="Тестовый фильм",
                orig_title="Test Movie",
                media_type="movie",
                current_time=5700,
                duration=6000,
            )
            self.assertTrue(r95["just_scrobbled"])
            self.assertTrue(r95["kinorium_status"]["watched"])
            self.assertFalse(r95["kinorium_status"]["watching"])
            self.assertEqual([x["id"] for x in r95["continue_watching"]], [])

    def test_movie_credits_marks_watched_and_close_does_not_reinsert_cw(self):
        with tempfile.TemporaryDirectory() as td:
            svc = KinoriumService(_MockNetClient(), td)
            svc.update_progress_and_scrobble(
                item_id="kin_7002",
                title="Матрица",
                orig_title="The Matrix",
                media_type="movie",
                current_time=900,
                duration=8160,
            )
            # Credits start at 89% -> force_watched=True, reason='credits'
            r_cred = svc.update_progress_and_scrobble(
                item_id="kin_7002",
                title="Матрица",
                orig_title="The Matrix",
                media_type="movie",
                current_time=7262,
                duration=8160,
                force_watched=True,
                reason="credits",
            )
            self.assertTrue(r_cred["just_scrobbled"])
            self.assertTrue(r_cred["kinorium_status"]["watched"])
            self.assertFalse(r_cred["kinorium_status"]["watching"])
            self.assertEqual(r_cred["continue_watching"], [])

            # Closing player during credits at 90% must NOT put movie back into continue_watching
            r_close = svc.update_progress_and_scrobble(
                item_id="kin_7002",
                title="Матрица",
                orig_title="The Matrix",
                media_type="movie",
                current_time=7344,
                duration=8160,
            )
            self.assertEqual(r_close["continue_watching"], [])
            self.assertTrue(r_close["kinorium_status"]["watched"])

    def test_series_10pct_watching_next_episode_credits_and_finale(self):
        with tempfile.TemporaryDirectory() as td:
            svc = KinoriumService(_MockNetClient(), td)

            # S1E1 reaches 10% -> series becomes 'Смотрю', episode 1 not yet watched
            r_s1e1_10 = svc.update_progress_and_scrobble(
                item_id="kin_8001",
                title="Тестовый сериал",
                orig_title="Test Series",
                media_type="series",
                season=1,
                episode=1,
                current_time=300,
                duration=3000,
                total_seasons=1,
                total_episodes_in_season=3,
                is_series_completed=True,
            )
            self.assertTrue(r_s1e1_10["promoted_to_watching"])
            self.assertTrue(r_s1e1_10["kinorium_status"]["watching"])
            self.assertEqual(r_s1e1_10["kinorium_status"]["watched_episodes"], {})

            # User switches to next episode (S1E2) -> S1E1 marked watched, Up Next points to S1E2
            r_next = svc.update_progress_and_scrobble(
                item_id="kin_8001",
                title="Тестовый сериал",
                orig_title="Test Series",
                media_type="series",
                season=1,
                episode=1,
                current_time=3000,
                duration=3000,
                total_seasons=1,
                total_episodes_in_season=3,
                is_series_completed=True,
                force_watched=True,
                reason="next_episode",
            )
            self.assertTrue(r_next["just_scrobbled_episode"])
            self.assertEqual(r_next["kinorium_status"]["watched_episodes"].get("1"), [1])
            self.assertEqual(r_next["continue_watching"][0]["episode"], 2)

            # S1E2 credits start at 88% -> S1E2 marked watched, Up Next points to S1E3
            r_cred = svc.update_progress_and_scrobble(
                item_id="kin_8001",
                title="Тестовый сериал",
                orig_title="Test Series",
                media_type="series",
                season=1,
                episode=2,
                current_time=2640,
                duration=3000,
                total_seasons=1,
                total_episodes_in_season=3,
                is_series_completed=True,
                force_watched=True,
                reason="credits",
            )
            self.assertTrue(r_cred["just_scrobbled_episode"])
            self.assertEqual(r_cred["kinorium_status"]["watched_episodes"].get("1"), [1, 2])
            self.assertEqual(r_cred["continue_watching"][0]["episode"], 3)

            # Closing player on S1E2 at 89% keeps S1E3 in continue_watching instead of regressing to S1E2
            r_close_ep = svc.update_progress_and_scrobble(
                item_id="kin_8001",
                title="Тестовый сериал",
                orig_title="Test Series",
                media_type="series",
                season=1,
                episode=2,
                current_time=2670,
                duration=3000,
                total_seasons=1,
                total_episodes_in_season=3,
                is_series_completed=True,
            )
            self.assertEqual(r_close_ep["continue_watching"][0]["episode"], 3)

            # Finale S1E3 reaches 95% -> series auto-completes from 'Смотрю' to 'Просмотрено'
            r_fin = svc.update_progress_and_scrobble(
                item_id="kin_8001",
                title="Тестовый сериал",
                orig_title="Test Series",
                media_type="series",
                season=1,
                episode=3,
                current_time=2850,
                duration=3000,
                total_seasons=1,
                total_episodes_in_season=3,
                is_series_completed=True,
            )
            self.assertTrue(r_fin["auto_completed_series"])
            self.assertTrue(r_fin["kinorium_status"]["watched"])
            self.assertFalse(r_fin["kinorium_status"]["watching"])
            self.assertEqual(r_fin["kinorium_status"]["watched_episodes"].get("1"), [1, 2, 3])

    def test_credits_detection_movie_theintrodb_and_mkv_chapters(self):
        mock_net = _MockNetClient(
            {
                "imdb_id=tt0133093": {
                    "tmdb_id": 603,
                    "type": "movie",
                    "credits": [{"start_ms": 7726800, "end_ms": None}],
                }
            }
        )
        skip_engine = SkipIntroEngine(mock_net)
        seg = skip_engine.get_skip_segments("tt0133093", media_type="movie")
        self.assertIsNone(seg["intro"])
        self.assertAlmostEqual(seg["outro"]["start_sec"], 7726.8, places=1)

        chapters = [
            {"start_time": "120.0", "tags": {"title": "Opening Credits"}},
            {"start_time": "6650.5", "tags": {"title": "End Credits"}},
        ]
        self.assertAlmostEqual(
            RemuxStreamEngine._extract_credits_chapter_sec(chapters, 7200.0),
            6650.5,
            places=1,
        )


if __name__ == "__main__":
    unittest.main()
