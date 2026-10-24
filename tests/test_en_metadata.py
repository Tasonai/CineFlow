import unittest

from backend.en_metadata import (
    _names_match_ru_en,
    _phonetic_key,
    build_english_cast_people,
    resolve_original_poster_url,
    translate_birth_date_en,
    translate_birth_place_en,
    translate_career_role_en,
    translate_kinorium_extra_desc_to_en,
)


class TestEnglishMetadataLocalization(unittest.TestCase):
    def test_phonetic_and_name_matching(self):
        self.assertEqual(_phonetic_key("Джек"), "jek")
        self.assertGreaterEqual(_names_match_ru_en("Джек Николсон", "Jack Nicholson"), 0.85)
        self.assertGreaterEqual(_names_match_ru_en("Гэри Олдман", "Gary Oldman"), 0.85)
        self.assertGreaterEqual(_names_match_ru_en("Кристофер Нолан", "Christopher Nolan"), 0.80)
        self.assertLess(_names_match_ru_en("Гэри Олдман", "Килиан Мерфи"), 0.45)

    def test_person_bio_fields_translation(self):
        self.assertEqual(translate_career_role_en("актер"), "Actor")
        self.assertEqual(translate_career_role_en("режиссёр"), "Director")
        self.assertEqual(translate_career_role_en("сценарист"), "Screenwriter")
        self.assertEqual(
            translate_birth_date_en("21 марта, 1958 (68 лет)"),
            "March 21, 1958 (68)",
        )
        self.assertEqual(
            translate_birth_place_en("Нью-Кросс, Лондон, Англия, Великобритания"),
            "New Cross, London, England, United Kingdom",
        )

    def test_kinorium_extra_desc_translation(self):
        ru_desc = "триллер, драма, 1 ч 55 мин • США, Великобритания • Джеймс Хоуз"
        en_desc = translate_kinorium_extra_desc_to_en(ru_desc)
        self.assertIn("Thriller", en_desc)
        self.assertIn("Drama", en_desc)
        self.assertIn("1h 55m", en_desc)
        self.assertIn("United States", en_desc)
        self.assertIn("United Kingdom", en_desc)

    def test_original_poster_url_resolution(self):
        item_imdb = {
            "id": "tt0468569",
            "poster": "https://ru-images.kinorium.com/movie/600/325797.jpg",
        }
        self.assertEqual(
            resolve_original_poster_url(item_imdb),
            "https://images.metahub.space/poster/medium/tt0468569/img",
        )
        item_kin = {
            "id": "kin_325797",
            "poster": "https://ru-images.kinorium.com/movie/600/325797.jpg",
        }
        self.assertEqual(
            resolve_original_poster_url(item_kin),
            "https://en-images.kinorium.com/movie/600/325797.jpg",
        )

    def test_build_english_cast_preserves_person_url(self):
        en_meta = {
            "directors_en": ["Christopher Nolan"],
            "actors_en": ["Gary Oldman"],
        }
        ru_cast = [
            {
                "name": "Кристофер Нолан",
                "is_director": True,
                "person_url": "https://hdrezka.ag/person/42-christopher-nolan/",
                "photo": "https://example.com/nolan.jpg",
            },
            {
                "name": "Гэри Олдман",
                "is_director": False,
                "person_url": "https://hdrezka.ag/person/99-gary-oldman/",
                "photo": "https://example.com/oldman.jpg",
            },
        ]
        cast = build_english_cast_people(en_meta, ru_cast)
        self.assertEqual(len(cast), 2)
        self.assertEqual(cast[0]["name"], "Christopher Nolan")
        self.assertEqual(cast[0]["person_url"], "https://hdrezka.ag/person/42-christopher-nolan/")
        self.assertEqual(cast[1]["name"], "Gary Oldman")
        self.assertEqual(cast[1]["person_url"], "https://hdrezka.ag/person/99-gary-oldman/")


if __name__ == "__main__":
    unittest.main()
