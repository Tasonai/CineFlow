"""English localization, transliteration, phonetic matching, and dictionary utilities.

Encapsulates:
- Cyrillic-to-Latin transliteration tables and regex helpers
- Phonetic keys, consonant skeletons, and Russian/English name fuzzy matching
- Country, genre, career, date, month, and place dictionaries (RU -> EN)
- Kinorium extra info descriptor translations
- Original-language poster/backdrop URL resolvers (IMDb Metahub / Kinorium EN / JustWatch)
- English cast and director builder with Russian profile metadata preservation
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional

ISO_COUNTRIES_EN: Dict[str, str] = {
    "US": "United States",
    "GB": "United Kingdom",
    "UK": "United Kingdom",
    "CA": "Canada",
    "AU": "Australia",
    "NZ": "New Zealand",
    "IE": "Ireland",
    "FR": "France",
    "DE": "Germany",
    "IT": "Italy",
    "ES": "Spain",
    "PT": "Portugal",
    "NL": "Netherlands",
    "BE": "Belgium",
    "CH": "Switzerland",
    "AT": "Austria",
    "SE": "Sweden",
    "NO": "Norway",
    "DK": "Denmark",
    "FI": "Finland",
    "IS": "Iceland",
    "PL": "Poland",
    "CZ": "Czechia",
    "SK": "Slovakia",
    "HU": "Hungary",
    "RO": "Romania",
    "BG": "Bulgaria",
    "GR": "Greece",
    "TR": "Turkey",
    "UA": "Ukraine",
    "RU": "Russia",
    "SU": "USSR",
    "BY": "Belarus",
    "KZ": "Kazakhstan",
    "GE": "Georgia",
    "AM": "Armenia",
    "JP": "Japan",
    "KR": "South Korea",
    "CN": "China",
    "HK": "Hong Kong",
    "TW": "Taiwan",
    "IN": "India",
    "TH": "Thailand",
    "ID": "Indonesia",
    "SG": "Singapore",
    "PH": "Philippines",
    "VN": "Vietnam",
    "MY": "Malaysia",
    "IL": "Israel",
    "AE": "UAE",
    "SA": "Saudi Arabia",
    "IR": "Iran",
    "EG": "Egypt",
    "ZA": "South Africa",
    "MA": "Morocco",
    "NG": "Nigeria",
    "MX": "Mexico",
    "BR": "Brazil",
    "AR": "Argentina",
    "CL": "Chile",
    "CO": "Colombia",
    "PE": "Peru",
    "UY": "Uruguay",
    "LU": "Luxembourg",
    "EE": "Estonia",
    "LV": "Latvia",
    "LT": "Lithuania",
    "RS": "Serbia",
    "HR": "Croatia",
    "SI": "Slovenia",
}

RU_COUNTRIES_TO_EN: Dict[str, str] = {
    "сша": "United States",
    "великобритания": "United Kingdom",
    "англия": "United Kingdom",
    "канада": "Canada",
    "австралия": "Australia",
    "новая зеландия": "New Zealand",
    "ирландия": "Ireland",
    "франция": "France",
    "германия": "Germany",
    "фрг": "West Germany",
    "италия": "Italy",
    "испания": "Spain",
    "португалия": "Portugal",
    "нидерланды": "Netherlands",
    "бельгия": "Belgium",
    "швейцария": "Switzerland",
    "австрия": "Austria",
    "швеция": "Sweden",
    "норвегия": "Norway",
    "дания": "Denmark",
    "финляндия": "Finland",
    "исландия": "Iceland",
    "польша": "Poland",
    "чехия": "Czechia",
    "чехословакия": "Czechoslovakia",
    "словакия": "Slovakia",
    "венгрия": "Hungary",
    "румыния": "Romania",
    "болгария": "Bulgaria",
    "греция": "Greece",
    "турция": "Turkey",
    "украина": "Ukraine",
    "россия": "Russia",
    "ссср": "USSR",
    "беларусь": "Belarus",
    "казахстан": "Kazakhstan",
    "грузия": "Georgia",
    "армения": "Armenia",
    "япония": "Japan",
    "южная корея": "South Korea",
    "корея южная": "South Korea",
    "корея": "South Korea",
    "китай": "China",
    "гонконг": "Hong Kong",
    "тайвань": "Taiwan",
    "индия": "India",
    "таиланд": "Thailand",
    "индонезия": "Indonesia",
    "сингапур": "Singapore",
    "филиппины": "Philippines",
    "вьетнам": "Vietnam",
    "малайзия": "Malaysia",
    "израиль": "Israel",
    "оаэ": "UAE",
    "саудовская аравия": "Saudi Arabia",
    "иран": "Iran",
    "египет": "Egypt",
    "юар": "South Africa",
    "марокко": "Morocco",
    "нигерия": "Nigeria",
    "мексика": "Mexico",
    "бразилия": "Brazil",
    "аргентина": "Argentina",
    "чили": "Chile",
    "колумбия": "Colombia",
    "перу": "Peru",
    "уругвай": "Uruguay",
    "люксембург": "Luxembourg",
    "эстония": "Estonia",
    "латвия": "Latvia",
    "литва": "Lithuania",
    "сербия": "Serbia",
    "хорватия": "Croatia",
    "словения": "Slovenia",
    "мальта": "Malta",
    "кипр": "Cyprus",
}

RU_GENRES_TO_EN: Dict[str, str] = {
    "драма": "Drama",
    "фантастика": "Sci-Fi",
    "приключения": "Adventure",
    "триллер": "Thriller",
    "шпионаж": "Spy",
    "комедия": "Comedy",
    "спорт": "Sport",
    "фэнтези": "Fantasy",
    "боевик": "Action",
    "детектив": "Mystery",
    "криминал": "Crime",
    "история": "History",
    "биография": "Biography",
    "ужасы": "Horror",
    "мелодрама": "Romance",
    "военный": "War",
    "вестерн": "Western",
    "мюзикл": "Musical",
    "музыка": "Music",
    "документальный": "Documentary",
    "мультфильм": "Animation",
    "аниме": "Anime",
    "семейный": "Family",
    "детский": "Kids",
    "ток-шоу": "Talk Show",
    "реальное тв": "Reality TV",
    "игра": "Game Show",
    "нуар": "Film-Noir",
    "короткометражка": "Short",
    "фильм": "Movie",
    "сериал": "Series",
}

_CYR_TO_LAT: Dict[str, str] = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    "і": "i", "ї": "yi", "є": "ye", "ґ": "g",
}

_CYRILLIC_RE = re.compile(r"[А-Яа-яЁёІіЇїЄєҐґ]")
_POLISH_POSTER_SLUGS = (
    "/silos.",
    "/wiedzmin",
    "/szogun",
    "/skazana",
    "/diuna-czesc",
    "/dzentelmeni",
    "/czas-krwawego",
    "/furiosa-saga",
    "/rozdzielenie",
    "/kulawe-konie",
    "/rod-smoka",
    "/rodzina-soprano",
    "/lalka-2026",
    "/lalka.",
    "/pingwin",
    "/mroczna-materia",
    "/ostatni-z-nas",
    "/reacher-",
)


def has_cyrillic(text: str) -> bool:
    return bool(text and _CYRILLIC_RE.search(text))


def transliterate_cyrillic(text: str) -> str:
    if not text or not has_cyrillic(text):
        return text or ""
    out: List[str] = []
    for ch in text:
        low = ch.lower()
        if low in _CYR_TO_LAT:
            rep = _CYR_TO_LAT[low]
            if ch.isupper() and rep:
                rep = rep[0].upper() + rep[1:]
            out.append(rep)
        else:
            out.append(ch)
    return "".join(out)


def _phonetic_key(name: str) -> str:
    raw = transliterate_cyrillic((name or "").strip()).lower()
    raw = (
        raw.replace("dzh", "j")
        .replace("zh", "j")
        .replace("shch", "sh")
        .replace("ph", "f")
        .replace("ck", "k")
        .replace("qu", "kw")
        .replace("wh", "v")
        .replace("th", "t")
        .replace("kh", "h")
        .replace("ey", "e")
        .replace("yi", "i")
        .replace("yy", "y")
        .replace("iy", "y")
        .replace("ou", "o")
        .replace("ow", "au")
        .replace("aw", "o")
        .replace("c", "k")
        .replace("x", "ks")
        .replace("w", "v")
    )
    raw = re.sub(r"[^a-z0-9\s]", "", raw)
    raw = re.sub(r"(.)\1+", r"\1", raw)
    return re.sub(r"\s+", " ", raw).strip()


def _consonant_skeleton(phonetic: str) -> str:
    return re.sub(r"[aeiouy]", "", phonetic or "")


def _names_match_ru_en(ru_name: str, en_name: str) -> float:
    rk = _phonetic_key(ru_name)
    ek = _phonetic_key(en_name)
    if not rk or not ek:
        return 0.0
    if rk == ek:
        return 1.0
    r_parts = rk.split()
    e_parts = ek.split()
    last_sim = SequenceMatcher(None, r_parts[-1], e_parts[-1]).ratio()
    full_sim = SequenceMatcher(None, rk, ek).ratio()
    first_sim = SequenceMatcher(None, r_parts[0], e_parts[0]).ratio()
    rc_last = _consonant_skeleton(r_parts[-1])
    ec_last = _consonant_skeleton(e_parts[-1])
    rc_first = _consonant_skeleton(r_parts[0])
    ec_first = _consonant_skeleton(e_parts[0])
    skel_score = 0.0
    if len(rc_last) >= 3 and rc_last == ec_last and rc_first[:1] and rc_first[:1] == ec_first[:1]:
        skel_score = 0.88

    if len(r_parts) >= 2 and len(e_parts) >= 2:
        # Handle East Asian given-name / family-name inversion ("Пак Чхан-ук" <-> "Chan-wook Park")
        swap_last = SequenceMatcher(None, r_parts[0], e_parts[-1]).ratio()
        swap_first = SequenceMatcher(None, r_parts[-1], e_parts[0]).ratio()
        if swap_last >= 0.72 and swap_first >= 0.72:
            return (swap_last * 0.65) + (swap_first * 0.35)
        # Never allow a shared first name ("Christopher Walken" vs "Christopher Nolan") to match on full_sim
        if last_sim < 0.64 and skel_score == 0.0:
            return min(0.45, (last_sim * 0.65) + (first_sim * 0.35))

    return max(full_sim, (last_sim * 0.65) + (first_sim * 0.35), skel_score)


_RU_CAREER_TO_EN: Dict[str, str] = {
    "актер": "Actor",
    "актёр": "Actor",
    "актриса": "Actress",
    "в ролях": "Actor",
    "режиссер": "Director",
    "режиссёр": "Director",
    "продюсер": "Producer",
    "сценарист": "Screenwriter",
    "оператор": "Cinematographer",
    "композитор": "Composer",
    "монтажер": "Editor",
    "монтажёр": "Editor",
    "художник": "Production Designer",
    "фильмография": "Filmography",
}

_RU_MONTHS_GENITIVE_TO_EN: Dict[str, str] = {
    "января": "January",
    "февраля": "February",
    "марта": "March",
    "апреля": "April",
    "мая": "May",
    "июня": "June",
    "июля": "July",
    "августа": "August",
    "сентября": "September",
    "октября": "October",
    "ноября": "November",
    "декабря": "December",
}


def translate_career_role_en(role: str) -> str:
    clean = re.sub(r"\s+", " ", (role or "").strip())
    if not clean:
        return ""
    low = clean.lower()
    if low in _RU_CAREER_TO_EN:
        return _RU_CAREER_TO_EN[low]
    return transliterate_cyrillic(clean).title() if has_cyrillic(clean) else clean


def translate_birth_date_en(raw_date: str) -> str:
    s = re.sub(r"\s+", " ", (raw_date or "").strip())
    if not s or not has_cyrillic(s):
        return s
    s = re.sub(r"\bг\.\s*", "", s, flags=re.I)
    s = re.sub(r"\bгода\b", "", s, flags=re.I)
    for ru_m, en_m in _RU_MONTHS_GENITIVE_TO_EN.items():
        s = re.sub(rf"\b{ru_m}\b", en_m, s, flags=re.I)
    s = re.sub(r"\(\s*(\d+)\s*(?:год|года|лет)\s*\)", r"(\1)", s, flags=re.I)
    s = re.sub(r"\b(\d{1,2})\s+([A-Z][a-z]+),?\s+(\d{4})\b", r"\2 \1, \3", s)
    s = re.sub(r"\s{2,}", " ", s).strip(" ,")
    return "" if has_cyrillic(s) else s


def translate_birth_place_en(raw_place: str) -> str:
    s = re.sub(r"\s+", " ", (raw_place or "").strip())
    if not s or not has_cyrillic(s):
        return s
    city_map = {
        "нью-кросс": "New Cross",
        "лондон": "London",
        "нью-йорк": "New York",
        "лос-анджелес": "Los Angeles",
        "чикаго": "Chicago",
        "париж": "Paris",
        "берлин": "Berlin",
        "рим": "Rome",
        "мадрид": "Madrid",
        "торонто": "Toronto",
        "вашингтон": "Washington",
        "бостон": "Boston",
        "сидней": "Sydney",
        "мельбурн": "Melbourne",
        "дублин": "Dublin",
        "москва": "Moscow",
        "санкт-петербург": "Saint Petersburg",
        "англия": "England",
        "шотландия": "Scotland",
        "уэльс": "Wales",
        "калифорния": "California",
        "техас": "Texas",
    }
    parts = [p.strip() for p in s.split(",") if p.strip()]
    out_parts: List[str] = []
    for p in parts:
        p_stripped = re.sub(r"^(?:г\.|гор\.|город|пос\.|пгт\.?|с\.|село|дер\.|деревня)\s+", "", p, flags=re.I).strip()
        if not p_stripped:
            continue
        low = p_stripped.lower()
        if low in city_map:
            mapped = city_map[low]
        elif low in RU_COUNTRIES_TO_EN:
            mapped = RU_COUNTRIES_TO_EN[low]
        elif low.startswith("нью-"):
            mapped = "New " + transliterate_cyrillic(p_stripped[4:]).title()
        elif has_cyrillic(p_stripped):
            mapped = transliterate_cyrillic(p_stripped)
        else:
            mapped = p_stripped
        if mapped and (not out_parts or out_parts[-1].lower() != mapped.lower()):
            out_parts.append(mapped)
    return ", ".join(out_parts)


def translate_kinorium_extra_desc_to_en(desc: str) -> str:
    """
    Translates Kinorium's compact `filmList__extra-info` strings such as:
    `триллер, драма, 1 ч 55 мин • США, Великобритания • Джеймс Хоуз`
    into 100% English (`Thriller, Drama, 1h 55m • United States, United Kingdom • James Hawes`).
    """
    if not desc:
        return ""
    s = desc.strip()
    if not has_cyrillic(s):
        return s

    # Pure fallback "Русское название (Original Title)" -> keep Original Title
    m_paren = re.match(r"^[^•,]+?\(([^()]+)\)\s*$", s)
    if m_paren and not has_cyrillic(m_paren.group(1)):
        return m_paren.group(1).strip()

    # Do not transliterate full Russian prose plot summaries into Latin gibberish
    if "•" not in s:
        if len(s) >= 85 or re.search(r"[.!?]\s+[А-ЯЁ]", s):
            return ""
        probe_tokens = [t.strip().rstrip(".") for t in s.split(",") if t.strip()]
        if probe_tokens and all(
            len(t.split()) > 3
            and t.lower() not in RU_GENRES_TO_EN
            and t.lower() not in RU_COUNTRIES_TO_EN
            and not re.search(r"\d+\s*(?:ч|мин|сезон|эпизод|сери)", t, re.I)
            for t in probe_tokens
        ):
            return ""

    chunks = [c.strip() for c in s.split("•")]
    out_chunks: List[str] = []

    for idx, chunk in enumerate(chunks):
        if not chunk:
            continue
        # Convert durations inside chunk first: "1 ч 55 мин" -> "1h 55m", "47 мин" -> "47m"
        c_work = re.sub(
            r"(\d+)\s*ч\.?\s*(\d+)\s*мин\.?",
            lambda m: f"{m.group(1)}h {m.group(2)}m",
            chunk,
            flags=re.I,
        )
        c_work = re.sub(r"(\d+)\s*ч\.?(?!\w)", lambda m: f"{m.group(1)}h", c_work, flags=re.I)
        c_work = re.sub(r"(\d+)\s*мин\.?(?!\w)", lambda m: f"{m.group(1)}m", c_work, flags=re.I)
        c_work = re.sub(r"(\d+)\s*сезон\w*", lambda m: f"{m.group(1)} seasons", c_work, flags=re.I)
        c_work = re.sub(r"(\d+)\s*(?:эпизод|сери)\w*", lambda m: f"{m.group(1)} episodes", c_work, flags=re.I)

        tokens = [t.strip().rstrip(".") for t in c_work.split(",") if t.strip()]
        out_tokens: List[str] = []
        for tok in tokens:
            low = tok.lower()
            if low in RU_GENRES_TO_EN:
                out_tokens.append(RU_GENRES_TO_EN[low])
                continue
            if low in RU_COUNTRIES_TO_EN:
                out_tokens.append(RU_COUNTRIES_TO_EN[low])
                continue
            # Handle glued genre + country (e.g. "драма США")
            replaced = False
            for ru_c, en_c in sorted(RU_COUNTRIES_TO_EN.items(), key=lambda kv: -len(kv[0])):
                if low.endswith(" " + ru_c):
                    prefix = low[: -(len(ru_c) + 1)].strip()
                    p_en = RU_GENRES_TO_EN.get(prefix, transliterate_cyrillic(prefix).title())
                    out_tokens.append(f"{p_en}, {en_c}" if p_en else en_c)
                    replaced = True
                    break
            if replaced:
                continue
            if has_cyrillic(tok):
                # Likely director/actor name in final bullet or unmapped genre
                out_tokens.append(transliterate_cyrillic(tok))
            else:
                out_tokens.append(tok)
        if out_tokens:
            out_chunks.append(", ".join(out_tokens))

    res = " • ".join(out_chunks)
    return transliterate_cyrillic(res) if has_cyrillic(res) else res


def resolve_original_poster_url(item: Dict[str, Any]) -> str:
    """
    Computes a reliable original-language (English) poster URL for an item without network I/O
    when possible:
    1) Explicit `poster_en`
    2) `tt...` IMDb ID -> `https://images.metahub.space/poster/medium/{tt}/img` when current poster
       is Russian (`ru-images.kinorium.com`, `hdrezka`, `kinopoisk`) or Polish JustWatch slug
    3) `kinorium_id` -> `https://en-images.kinorium.com/movie/600/{kid}.jpg`
    4) Existing non-Russian/non-Polish poster
    """
    explicit = str(item.get("poster_en") or "").strip()
    if explicit and "ru-images.kinorium.com" not in explicit:
        return explicit

    cur_poster = str(item.get("poster") or "").strip()
    item_id = str(item.get("id") or "").strip()
    imdb_id = str(item.get("imdb_id") or (item_id if item_id.startswith("tt") else "")).strip()
    kid = str(item.get("kinorium_id") or "").strip()
    if not kid and item_id.startswith("kin_"):
        kid = item_id[4:]

    is_localized_poster = (
        not cur_poster
        or "ru-images.kinorium.com" in cur_poster
        or "kinopoisk" in cur_poster
        or "rezka" in cur_poster
        or any(slug in cur_poster.lower() for slug in _POLISH_POSTER_SLUGS)
    )

    if not is_localized_poster:
        return cur_poster

    if imdb_id and re.match(r"^tt\d{5,10}$", imdb_id):
        return f"https://images.metahub.space/poster/medium/{imdb_id}/img"

    if kid and kid.isdigit():
        return f"https://en-images.kinorium.com/movie/600/{kid}.jpg"

    if "ru-images.kinorium.com/movie/" in cur_poster:
        return cur_poster.replace("ru-images.kinorium.com/movie/", "en-images.kinorium.com/movie/")

    return cur_poster


def is_localized_non_en_image_url(url: str) -> bool:
    low = str(url or "").strip().lower()
    if not low:
        return True
    return (
        "ru-images.kinorium.com" in low
        or "kinopoisk" in low
        or "rezka" in low
        or any(slug in low for slug in _POLISH_POSTER_SLUGS)
    )


def resolve_original_backdrop_url(item: Dict[str, Any]) -> str:
    explicit = str(item.get("backdrop_en") or "").strip()
    if explicit and not is_localized_non_en_image_url(explicit):
        return explicit

    cur_bg = str(item.get("backdrop") or "").strip()
    if cur_bg and not is_localized_non_en_image_url(cur_bg):
        return cur_bg

    item_id = str(item.get("id") or "").strip()
    imdb_id = str(item.get("imdb_id") or (item_id if item_id.startswith("tt") else "")).strip()
    if imdb_id and re.match(r"^tt\d{5,10}$", imdb_id):
        return f"https://images.metahub.space/background/medium/{imdb_id}/img"

    kid = str(item.get("kinorium_id") or (item.get("kinorium") or {}).get("kinorium_id") or "").strip()
    if not kid and item_id.startswith("kin_"):
        kid = item_id[4:]
    if kid and kid.isdigit():
        return f"https://en-images.kinorium.com/movie/1080/{kid}.jpg"

    return resolve_original_poster_url(item)


def build_english_cast_people(
    en_meta: Dict[str, Any],
    ru_cast_people: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """
    Builds a 100% English `cast_people` list (directors + actors), preserving `person_url`,
    `id`, and `photo` from `ru_cast_people` whenever phonetic transliteration aligns,
    and transliterating any fallback entries if `en_meta` had no credits.
    """
    ru_list = list(ru_cast_people or [])
    directors_en = [str(n).strip() for n in (en_meta.get("directors_en") or []) if str(n).strip()]
    actors_en = [str(n).strip() for n in (en_meta.get("actors_en") or []) if str(n).strip()]

    used_ru_indices = set()

    def _find_ru_match(en_name: str, prefer_director: Optional[bool] = None) -> Optional[Dict[str, Any]]:
        best_idx = -1
        best_score = 0.0
        for idx, rp in enumerate(ru_list):
            if idx in used_ru_indices:
                continue
            if prefer_director is not None and bool(rp.get("is_director")) != prefer_director:
                continue
            rname = str(rp.get("name") or "").strip()
            sc = _names_match_ru_en(rname, en_name)
            if sc > best_score:
                best_score = sc
                best_idx = idx
        if best_idx >= 0 and best_score >= 0.66:
            used_ru_indices.add(best_idx)
            return ru_list[best_idx]
        return None

    out: List[Dict[str, Any]] = []
    seen_en = set()

    for d_name in directors_en[:4]:
        key = d_name.lower()
        if key in seen_en:
            continue
        seen_en.add(key)
        matched = _find_ru_match(d_name, prefer_director=True) or _find_ru_match(d_name, prefer_director=None)
        entry: Dict[str, Any] = {
            "name": d_name,
            "role": "Director",
            "is_director": True,
            "photo": str((matched or {}).get("photo") or ""),
        }
        if matched:
            if matched.get("person_url"):
                entry["person_url"] = matched["person_url"]
            if matched.get("id"):
                entry["id"] = matched["id"]
            if matched.get("name") and has_cyrillic(str(matched.get("name"))):
                entry["ru_name"] = matched["name"]
        out.append(entry)

    # If JustWatch/Cinemeta lacked director for a series, transliterate Russian director cleanly
    if not directors_en:
        for idx, rp in enumerate(ru_list):
            if not rp.get("is_director"):
                continue
            rname = str(rp.get("name") or "").strip()
            if not rname:
                continue
            en_dir = transliterate_cyrillic(rname)
            key = en_dir.lower()
            if key in seen_en:
                continue
            seen_en.add(key)
            used_ru_indices.add(idx)
            entry = {
                "name": en_dir,
                "role": "Director",
                "is_director": True,
                "photo": str(rp.get("photo") or ""),
            }
            if rp.get("person_url"):
                entry["person_url"] = rp["person_url"]
            if rp.get("id"):
                entry["id"] = rp["id"]
            if has_cyrillic(rname):
                entry["ru_name"] = rname
            out.append(entry)

    for a_name in actors_en[:14]:
        key = a_name.lower()
        if key in seen_en:
            continue
        seen_en.add(key)
        matched = _find_ru_match(a_name, prefer_director=False) or _find_ru_match(a_name, prefer_director=None)
        entry = {
            "name": a_name,
            "role": "Actor",
            "is_director": False,
            "photo": str((matched or {}).get("photo") or ""),
        }
        if matched:
            if matched.get("person_url"):
                entry["person_url"] = matched["person_url"]
            if matched.get("id"):
                entry["id"] = matched["id"]
            if matched.get("name") and has_cyrillic(str(matched.get("name"))):
                entry["ru_name"] = matched["name"]
        out.append(entry)

    # Final fallback if neither JustWatch nor Cinemeta returned actors
    if not actors_en:
        for idx, rp in enumerate(ru_list):
            if idx in used_ru_indices or rp.get("is_director"):
                continue
            rname = str(rp.get("name") or "").strip()
            if not rname:
                continue
            en_act = transliterate_cyrillic(rname)
            key = en_act.lower()
            if key in seen_en:
                continue
            seen_en.add(key)
            entry = {
                "name": en_act,
                "role": "Actor",
                "is_director": False,
                "photo": str(rp.get("photo") or ""),
            }
            if rp.get("person_url"):
                entry["person_url"] = rp["person_url"]
            if rp.get("id"):
                entry["id"] = rp["id"]
            if has_cyrillic(rname):
                entry["ru_name"] = rname
            out.append(entry)

    return out
