import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional, Tuple


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
        low = p.lower()
        if low in city_map:
            mapped = city_map[low]
        elif low in RU_COUNTRIES_TO_EN:
            mapped = RU_COUNTRIES_TO_EN[low]
        elif low.startswith("нью-"):
            mapped = "New " + transliterate_cyrillic(p[4:]).title()
        elif has_cyrillic(p):
            mapped = transliterate_cyrillic(p)
        else:
            mapped = p
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


class EnglishMetadataResolver:
    """
    Fast, disk-cached resolver for 100% English metadata, original-language US/UK posters,
    English directors & cast, English episode titles, and Critics (%) ratings via
    JustWatch US GraphQL (`country: "US", language: "en"`) + Stremio Cinemeta.
    """

    JW_GRAPHQL_URL = "https://apis.justwatch.com/graphql"
    CINEMETA_BASE = "https://v3-cinemeta.strem.io"

    _JW_QUERY = """
    query SearchEnglishMeta($searchQuery: String!, $country: Country!, $language: Language!) {
      popularTitles(country: $country, first: 6, filter: {searchQuery: $searchQuery}) {
        edges {
          node {
            id
            objectType
            objectId
            content(country: $country, language: $language) {
              title
              originalReleaseYear
              shortDescription
              runtime
              productionCountries
              posterUrl(profile: S592, format: WEBP)
              backdropUrl: backdrops(profile: S1920, format: WEBP) {
                backdropUrl
              }
              externalIds {
                imdbId
                tmdbId
              }
              scoring {
                imdbScore
                tomatoMeter
              }
              genres {
                shortName
                translation(language: $language)
              }
              credits {
                role
                name
              }
            }
          }
        }
      }
    }
    """

    def __init__(self, cache_path: str, net_client: Optional[Any] = None):
        self.cache_path = cache_path
        self.net = net_client
        self._lock = threading.Lock()
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._dirty_count = 0
        self._load()

    def _load(self) -> None:
        try:
            if os.path.exists(self.cache_path):
                with open(self.cache_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    self._cache = {
                        k: v for k, v in data.items() if isinstance(v, dict) and v.get("ok")
                    }
        except Exception:
            self._cache = {}

    def _save(self, force: bool = False) -> None:
        with self._lock:
            self._dirty_count += 1
            if not force and self._dirty_count < 3:
                return
            self._dirty_count = 0
            snapshot = dict(self._cache)
        try:
            os.makedirs(os.path.dirname(self.cache_path), exist_ok=True)
            tmp_path = f"{self.cache_path}.tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(snapshot, f, ensure_ascii=False)
            os.replace(tmp_path, self.cache_path)
        except Exception:
            pass

    def _make_key(
        self,
        item_id: str,
        orig_title: str,
        title: str,
        year: int,
        media_type: str,
        imdb_id: str,
    ) -> str:
        if imdb_id and re.match(r"^tt\d{5,10}$", imdb_id):
            return f"imdb:{imdb_id}"
        if item_id and re.match(r"^tt\d{5,10}$", item_id):
            return f"imdb:{item_id}"
        if item_id and item_id.startswith("kin_"):
            return f"kin:{item_id[4:]}"
        q = (orig_title or title or item_id or "").strip().lower()
        return f"q:{media_type or 'any'}:{year or 0}:{q}"

    def get_cached(
        self,
        item_id: str = "",
        title: str = "",
        orig_title: str = "",
        year: int = 0,
        media_type: str = "",
        imdb_id: str = "",
    ) -> Optional[Dict[str, Any]]:
        key = self._make_key(item_id, orig_title, title, year, media_type, imdb_id)
        with self._lock:
            entry = self._cache.get(key)
        if not entry:
            return None
        now = time.time()
        ttl = 86400 * 14 if entry.get("ok") else 900
        if now - float(entry.get("ts") or 0) > ttl:
            return None
        return entry

    def _http_post_json(self, url: str, payload: Dict[str, Any], timeout: float = 5.5) -> Optional[Dict[str, Any]]:
        import ssl

        body = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        }
        try:
            ssl_ctx = ssl._create_unverified_context()
            opener = urllib.request.build_opener(
                urllib.request.HTTPSHandler(context=ssl_ctx),
                urllib.request.ProxyHandler({}),
            )
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            with opener.open(req, timeout=timeout) as resp:
                raw = resp.read()
                if raw[:2] == b"\x1f\x8b":
                    import gzip
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode("utf-8", errors="replace"))
        except Exception:
            if self.net is not None:
                try:
                    status, body_text, _ = self.net.request(
                        url,
                        method="POST",
                        headers=headers,
                        data=body,
                        spoof_geo_country="DIRECT",
                        timeout=int(max(3, round(timeout))),
                    )
                    if status == 200 and body_text:
                        return json.loads(body_text)
                except Exception:
                    pass
            return None

    def _http_get_json(self, url: str, timeout: float = 4.5) -> Optional[Dict[str, Any]]:
        import ssl

        headers = {
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        }
        try:
            ssl_ctx = ssl._create_unverified_context()
            opener = urllib.request.build_opener(
                urllib.request.HTTPSHandler(context=ssl_ctx),
                urllib.request.ProxyHandler({}),
            )
            req = urllib.request.Request(url, headers=headers, method="GET")
            with opener.open(req, timeout=timeout) as resp:
                raw = resp.read()
                if raw[:2] == b"\x1f\x8b":
                    import gzip
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode("utf-8", errors="replace"))
        except Exception:
            if self.net is not None:
                try:
                    status, body_text, _ = self.net.request(
                        url,
                        method="GET",
                        headers=headers,
                        spoof_geo_country="DIRECT",
                        timeout=int(max(3, round(timeout))),
                    )
                    if status == 200 and body_text:
                        return json.loads(body_text)
                except Exception:
                    pass
            return None

    def _query_justwatch_us(
        self,
        query_str: str,
        year: int = 0,
        media_type: str = "",
        imdb_id: str = "",
    ) -> Optional[Dict[str, Any]]:
        if not query_str:
            return None
        data = self._http_post_json(
            self.JW_GRAPHQL_URL,
            {
                "query": self._JW_QUERY,
                "variables": {
                    "searchQuery": query_str,
                    "country": "US",
                    "language": "en",
                },
            },
            timeout=5.5,
        )
        edges = (((data or {}).get("data") or {}).get("popularTitles") or {}).get("edges") or []
        if not edges:
            return None

        q_low = query_str.strip().lower()
        want_obj_type = "SHOW" if media_type == "series" else ("MOVIE" if media_type == "movie" else "")

        best_score = -999.0
        best_node: Optional[Dict[str, Any]] = None
        for idx, edge in enumerate(edges):
            node = (edge or {}).get("node") or {}
            content = node.get("content") or {}
            c_title = str(content.get("title") or "").strip()
            if not c_title:
                continue
            ext = content.get("externalIds") or {}
            c_imdb = str(ext.get("imdbId") or "").strip()
            if imdb_id and c_imdb and c_imdb == imdb_id:
                best_node = node
                break

            sc = max(0.0, 20.0 - idx * 3.0)
            obj_type = str(node.get("objectType") or "")
            if want_obj_type:
                if obj_type == want_obj_type:
                    sc += 25.0
                else:
                    sc -= 20.0

            c_low = c_title.lower()
            if c_low == q_low:
                sc += 45.0
            elif q_low in c_low or c_low in q_low:
                sc += 18.0
            else:
                sc += SequenceMatcher(None, q_low, c_low).ratio() * 25.0

            c_year = int(content.get("originalReleaseYear") or 0)
            if year and c_year:
                diff = abs(year - c_year)
                if diff == 0:
                    sc += 30.0
                elif diff == 1:
                    sc += 16.0
                elif diff <= 2 and want_obj_type == "SHOW":
                    sc += 6.0
                elif diff >= 4:
                    sc -= 28.0

            if sc > best_score:
                best_score = sc
                best_node = node

        if not best_node or best_score < 20.0 and not (
            imdb_id and str(((best_node.get("content") or {}).get("externalIds") or {}).get("imdbId") or "") == imdb_id
        ):
            return None

        content = best_node.get("content") or {}
        ext = content.get("externalIds") or {}
        scoring = content.get("scoring") or {}
        poster_rel = str(content.get("posterUrl") or "").strip()
        poster_en = f"https://images.justwatch.com{poster_rel}" if poster_rel.startswith("/") else poster_rel

        backdrops = content.get("backdropUrl") or []
        backdrop_en = ""
        if isinstance(backdrops, list) and backdrops:
            b_rel = str((backdrops[0] or {}).get("backdropUrl") or "").strip()
            if b_rel:
                backdrop_en = f"https://images.justwatch.com{b_rel}" if b_rel.startswith("/") else b_rel

        prod_codes = [str(c).upper() for c in (content.get("productionCountries") or []) if c]
        countries_en = [ISO_COUNTRIES_EN.get(code, code) for code in prod_codes[:4]]

        genres_en: List[str] = []
        for g in content.get("genres") or []:
            gt = str((g or {}).get("translation") or "").strip()
            if gt and gt not in genres_en:
                genres_en.append(gt)

        directors_en: List[str] = []
        actors_en: List[str] = []
        for cr in content.get("credits") or []:
            role = str((cr or {}).get("role") or "").upper()
            cname = str((cr or {}).get("name") or "").strip()
            if not cname or has_cyrillic(cname):
                continue
            if role in ("DIRECTOR", "CREATOR") and cname not in directors_en:
                directors_en.append(cname)
            elif role == "ACTOR" and cname not in actors_en:
                actors_en.append(cname)

        tomato = scoring.get("tomatoMeter")
        critics_pct: Optional[int] = None
        if tomato is not None:
            try:
                tv = int(round(float(tomato)))
                if 0 < tv <= 100:
                    critics_pct = tv
            except Exception:
                pass

        runtime_min = 0
        try:
            runtime_min = max(0, int(content.get("runtime") or 0))
        except Exception:
            runtime_min = 0

        return {
            "title_en": str(content.get("title") or "").strip(),
            "year": int(content.get("originalReleaseYear") or year or 0),
            "description_en": str(content.get("shortDescription") or "").strip(),
            "runtime_min": runtime_min,
            "countries_en": countries_en,
            "genres_en": genres_en[:4],
            "poster_en": poster_en,
            "backdrop_en": backdrop_en,
            "imdb_id": str(ext.get("imdbId") or imdb_id or "").strip(),
            "imdb_score": float(scoring.get("imdbScore") or 0.0),
            "critics_pct": critics_pct,
            "directors_en": directors_en[:4],
            "actors_en": actors_en[:14],
            "media_type": "series" if str(best_node.get("objectType") or "") == "SHOW" else "movie",
        }

    def _query_cinemeta(self, imdb_id: str, media_type: str = "", include_episodes: bool = True) -> Optional[Dict[str, Any]]:
        if not imdb_id or not re.match(r"^tt\d{5,10}$", imdb_id):
            return None
        types_to_try = (
            ["series", "movie"]
            if media_type == "series"
            else (["movie", "series"] if media_type == "movie" else ["movie", "series"])
        )
        for ctype in types_to_try:
            url = f"{self.CINEMETA_BASE}/meta/{ctype}/{imdb_id}.json"
            data = self._http_get_json(url, timeout=4.5)
            meta = (data or {}).get("meta") if isinstance(data, dict) else None
            if not isinstance(meta, dict) or not meta.get("name"):
                continue

            directors = [
                str(x).strip()
                for x in (meta.get("director") or meta.get("writer") or [])
                if str(x).strip() and not has_cyrillic(str(x))
            ]
            actors = [
                str(x).strip()
                for x in (meta.get("cast") or [])
                if str(x).strip() and not has_cyrillic(str(x))
            ]
            runtime_str = str(meta.get("runtime") or "").strip()
            m_rt = re.search(r"(\d+)", runtime_str)
            runtime_min = int(m_rt.group(1)) if m_rt else 0

            country_raw = str(meta.get("country") or "").strip()
            countries_en = [
                ISO_COUNTRIES_EN.get(c.strip().upper(), c.strip())
                for c in country_raw.split(",")
                if c.strip()
            ]

            episodes_titles_en: Dict[str, Dict[str, str]] = {}
            episodes_meta_en: Dict[str, Dict[str, Dict[str, Any]]] = {}
            if include_episodes and ctype == "series" and isinstance(meta.get("videos"), list):
                for vid in meta["videos"]:
                    if not isinstance(vid, dict):
                        continue
                    try:
                        sn = int(vid.get("season") or 0)
                        ep = int(vid.get("episode") or vid.get("number") or 0)
                    except Exception:
                        continue
                    if sn <= 0 or ep <= 0:
                        continue
                    sn_k = str(sn)
                    ep_k = str(ep)
                    ep_title = str(vid.get("name") or vid.get("title") or "").strip()
                    if ep_title and not re.match(r"^Episode\s+\d+$", ep_title, re.I):
                        episodes_titles_en.setdefault(sn_k, {})[ep_k] = ep_title
                    ep_overview = str(vid.get("overview") or vid.get("description") or "").strip()
                    ep_thumb = str(vid.get("thumbnail") or "").strip()
                    ep_rel = str(vid.get("released") or "")[:10]
                    if ep_title or ep_overview or ep_thumb:
                        episodes_meta_en.setdefault(sn_k, {})[ep_k] = {
                            "title": ep_title or f"Episode {ep}",
                            "overview": ep_overview,
                            "still": ep_thumb,
                            "air_date": ep_rel,
                        }

            poster = str(meta.get("poster") or f"https://images.metahub.space/poster/medium/{imdb_id}/img").strip()
            return {
                "title_en": str(meta.get("name") or "").strip(),
                "description_en": str(meta.get("description") or "").strip(),
                "runtime_min": runtime_min,
                "countries_en": countries_en[:4],
                "genres_en": [str(g).strip() for g in (meta.get("genres") or []) if str(g).strip()][:4],
                "poster_en": poster,
                "backdrop_en": str(meta.get("background") or "").strip(),
                "imdb_id": imdb_id,
                "directors_en": directors[:4],
                "actors_en": actors[:14],
                "episodes_titles_en": episodes_titles_en,
                "episodes_meta_en": episodes_meta_en,
                "episodes_fetched": bool(include_episodes and ctype == "series"),
                "media_type": ctype,
            }
        return None

    def resolve(
        self,
        item_id: str = "",
        title: str = "",
        orig_title: str = "",
        year: int = 0,
        media_type: str = "",
        imdb_id: str = "",
        kinorium_id: str = "",
        need_episodes: bool = False,
    ) -> Dict[str, Any]:
        eff_imdb = imdb_id or (item_id if str(item_id).startswith("tt") else "")
        cached = self.get_cached(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            year=year,
            media_type=media_type,
            imdb_id=eff_imdb,
        )
        if cached and cached.get("ok"):
            if not (need_episodes and media_type == "series" and not cached.get("episodes_fetched")):
                return cached

        search_q = ""
        if orig_title and not has_cyrillic(orig_title):
            search_q = orig_title.strip()
        elif title and not has_cyrillic(title):
            search_q = title.strip()

        cm_data: Optional[Dict[str, Any]] = None
        if eff_imdb and (not search_q or need_episodes or media_type == "series"):
            cm_data = self._query_cinemeta(eff_imdb, media_type=media_type, include_episodes=need_episodes)
            if cm_data and not search_q:
                search_q = cm_data.get("title_en") or ""

        if not search_q and (orig_title or title):
            # JustWatch search engine also resolves Cyrillic queries to US English content
            search_q = (orig_title or title).strip()

        jw_data = self._query_justwatch_us(
            query_str=search_q,
            year=year,
            media_type=media_type,
            imdb_id=eff_imdb,
        )
        if jw_data is None and title and title.strip() and title.strip().lower() != search_q.lower():
            jw_data = self._query_justwatch_us(
                query_str=title.strip(),
                year=year,
                media_type=media_type,
                imdb_id=eff_imdb,
            )

        resolved_imdb = eff_imdb or str((jw_data or {}).get("imdb_id") or "").strip()
        if resolved_imdb and cm_data is None and (
            need_episodes
            or not jw_data
            or not (jw_data.get("directors_en") or [])
            or not jw_data.get("description_en")
        ):
            cm_data = self._query_cinemeta(
                resolved_imdb,
                media_type=media_type or str((jw_data or {}).get("media_type") or ""),
                include_episodes=need_episodes,
            )

        if not jw_data and not cm_data:
            neg = {
                "ok": False,
                "ts": time.time(),
                "poster_en": resolve_original_poster_url(
                    {"id": item_id, "imdb_id": eff_imdb, "kinorium_id": kinorium_id}
                ),
            }
            key = self._make_key(item_id, orig_title, title, year, media_type, eff_imdb)
            with self._lock:
                self._cache[key] = neg
            return neg

        jw = jw_data or {}
        cm = cm_data or {}

        poster_en = (
            jw.get("poster_en")
            or cm.get("poster_en")
            or resolve_original_poster_url(
                {"id": item_id, "imdb_id": resolved_imdb, "kinorium_id": kinorium_id}
            )
        )
        directors_en = list(jw.get("directors_en") or [])
        for d in cm.get("directors_en") or []:
            if d not in directors_en:
                directors_en.append(d)

        actors_en = list(jw.get("actors_en") or [])
        for a in cm.get("actors_en") or []:
            if a not in actors_en:
                actors_en.append(a)

        result: Dict[str, Any] = {
            "ok": True,
            "ts": time.time(),
            "title_en": jw.get("title_en") or cm.get("title_en") or (orig_title if not has_cyrillic(orig_title) else ""),
            "description_en": jw.get("description_en") or cm.get("description_en") or "",
            "runtime_min": jw.get("runtime_min") or cm.get("runtime_min") or 0,
            "countries_en": jw.get("countries_en") or cm.get("countries_en") or [],
            "genres_en": jw.get("genres_en") or cm.get("genres_en") or [],
            "poster_en": poster_en,
            "backdrop_en": jw.get("backdrop_en") or cm.get("backdrop_en") or "",
            "imdb_id": resolved_imdb,
            "critics_pct": jw.get("critics_pct"),
            "directors_en": directors_en[:4],
            "actors_en": actors_en[:14],
            "episodes_titles_en": cm.get("episodes_titles_en") or (cached or {}).get("episodes_titles_en") or {},
            "episodes_meta_en": cm.get("episodes_meta_en") or (cached or {}).get("episodes_meta_en") or {},
            "episodes_fetched": bool(cm.get("episodes_fetched") or (cached or {}).get("episodes_fetched")),
        }

        keys_to_store = {
            self._make_key(item_id, orig_title, title, year, media_type, eff_imdb),
        }
        if resolved_imdb:
            keys_to_store.add(f"imdb:{resolved_imdb}")
        if kinorium_id:
            keys_to_store.add(f"kin:{kinorium_id}")
        with self._lock:
            for k in keys_to_store:
                self._cache[k] = result
        self._save(force=need_episodes)
        return result
