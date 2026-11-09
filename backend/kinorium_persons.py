"""
Velarium Kinorium Person & Filmography Parsers.

Extracts structured artist profiles, biographies, career roles, and filmography sections
from Kinorium JSON search API responses and HTML artist pages (schema.org LD-JSON + DOM).
"""

import html
import json
import re
import time
from typing import Any, Callable, Dict, List, Optional, Set

RU_MONTHS = {
    1: "января",
    2: "февраля",
    3: "марта",
    4: "апреля",
    5: "мая",
    6: "июня",
    7: "июля",
    8: "августа",
    9: "сентября",
    10: "октября",
    11: "ноября",
    12: "декабря",
}

ROLE_DEFS = {
    "director": ("director", "Режиссёр"),
    "actor": ("actor", "В ролях"),
    "writer": ("writer", "Сценарист"),
    "author": ("writer", "Сценарист"),
    "producer": ("producer", "Продюсер"),
    "composer": ("composer", "Композитор"),
    "operator": ("operator", "Оператор"),
}

ROLE_LABELS_ORDER = [
    ("director", "Режиссёр"),
    ("actor", "В ролях"),
    ("writer", "Сценарист"),
    ("producer", "Продюсер"),
    ("composer", "Композитор"),
    ("operator", "Оператор"),
]

ITEM_HDR_RE = re.compile(
    r"<div\s+class=['\"][^'\"]*\bitem\b[^'\"]*\bheadlines_type-([a-z0-9_-]+)[^'\"]*['\"][^>]*\brel=['\"](\d+)['\"][^>]*>",
    re.I,
)


def parse_search_persons_and_movies(raw_json: str) -> Dict[str, List[Dict[str, Any]]]:
    """
    Parses raw Kinorium search JSON (/handlers/Search/?str=...) into sorted persons and movies lists.
    """
    try:
        data = json.loads(raw_json)
        if not isinstance(data, dict):
            return {"persons": [], "movies": []}
    except Exception:
        return {"persons": [], "movies": []}

    persons: List[Dict[str, Any]] = []
    movies: List[Dict[str, Any]] = []
    cur_year = time.localtime().tm_year
    for idx, entry in enumerate(data.get("list") or []):
        if not isinstance(entry, dict):
            continue
        mtype_raw = str(entry.get("mixtype") or "").strip().lower()
        eid = str(entry.get("id") or "").strip()
        if not eid.isdigit():
            continue
        if mtype_raw == "persona":
            ru_name = html.unescape(str(entry.get("name") or "").strip())
            orig_name = html.unescape(str(entry.get("name_orig") or entry.get("orig") or "").strip())
            if not ru_name and not orig_name:
                continue
            raw_img = str(entry.get("image") or "").strip()
            photo = ""
            if raw_img and "noperson" not in raw_img.lower() and "no-poster" not in raw_img.lower():
                photo = raw_img.replace("/persona/XXX/", "/persona/300/")
            dob = str(entry.get("date_of_birth") or "").strip()
            persons.append(
                {
                    "kinorium_person_id": eid,
                    "name": ru_name or orig_name,
                    "orig_name": orig_name or (ru_name if not re.search(r"[А-Яа-яЁё]", ru_name) else ""),
                    "photo": photo,
                    "birth_date": dob,
                    "has_image": bool(photo),
                    "_rank": (100 if photo else 0) + (30 if dob else 0) - idx,
                }
            )
        elif mtype_raw == "movie":
            ru_title = html.unescape(str(entry.get("name") or "").strip())
            orig_title = html.unescape(str(entry.get("name_orig") or entry.get("orig") or ru_title).strip())
            if not ru_title:
                continue
            y_str = str(entry.get("year") or "").strip()
            ym = re.search(r"\b(19\d\d|20\d\d)\b", y_str)
            yr = int(ym.group(1)) if ym else 0
            raw_img = str(entry.get("image") or "").strip()
            poster = ""
            if raw_img and "no-poster" not in raw_img.lower() and "noperson" not in raw_img.lower():
                poster = raw_img.replace("/movie/XXX/", "/movie/600/")
            raw_rating = str(entry.get("rating") or "").strip()
            rat_f = 0.0
            try:
                rat_f = float(raw_rating) if raw_rating else 0.0
            except Exception:
                rat_f = 0.0
            movies.append(
                {
                    "id": f"kin_{eid}",
                    "kinorium_id": eid,
                    "title": ru_title,
                    "orig_title": orig_title,
                    "year": yr,
                    "poster": poster,
                    "rating": rat_f,
                    "_rank": (80 if yr and (cur_year - 5 <= yr <= cur_year + 1) else 0)
                    + (50 if poster else 0)
                    + int(rat_f * 5)
                    - idx,
                }
            )

    persons.sort(key=lambda x: x.get("_rank", 0), reverse=True)
    movies.sort(key=lambda x: x.get("_rank", 0), reverse=True)
    return {"persons": persons, "movies": movies}


def parse_person_filmography_html(
    html_page: str,
    eff_pid: str,
    fallback_name: str = "",
    genres_sanitizer: Optional[Callable[[List[str], str], List[str]]] = None,
) -> Dict[str, Any]:
    """
    Parses Kinorium artist page HTML (https://ru.kinorium.com/name/{eff_pid}/)
    into structured metadata (bio, dates, roles) and organized filmography sections.
    """
    if not html_page or len(html_page) < 1500:
        return {}

    ru_name = fallback_name
    orig_name = ""
    photo_url = ""
    birth_date = ""
    birth_place = ""
    bio = ""
    career_roles = ""

    for ld_raw in re.findall(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html_page[:40000],
        re.S,
    ):
        try:
            ld_obj = json.loads(ld_raw.strip())
        except Exception:
            continue
        if not isinstance(ld_obj, dict) or ld_obj.get("@type") != "Person":
            continue
        if ld_obj.get("name"):
            ru_name = html.unescape(str(ld_obj["name"]).strip())
        alt = ld_obj.get("alternateName")
        if isinstance(alt, list) and alt:
            orig_name = html.unescape(str(alt[0]).strip())
        elif isinstance(alt, str) and alt.strip():
            orig_name = html.unescape(alt.strip())
        raw_img = str(ld_obj.get("image") or "").strip()
        if raw_img and "noperson" not in raw_img.lower():
            photo_url = raw_img.replace("/persona/XXX/", "/persona/300/")
        bd_iso = str(ld_obj.get("birthDate") or "").strip()
        m_iso = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", bd_iso)
        if m_iso:
            y_i, m_i, d_i = int(m_iso.group(1)), int(m_iso.group(2)), int(m_iso.group(3))
            if m_i in RU_MONTHS and d_i > 0:
                birth_date = f"{d_i} {RU_MONTHS[m_i]} {y_i}"
            else:
                birth_date = str(y_i)
        elif bd_iso:
            birth_date = bd_iso
        bp_obj = ld_obj.get("birthPlace")
        if isinstance(bp_obj, dict) and bp_obj.get("name"):
            birth_place = html.unescape(str(bp_obj["name"]).strip())
        ld_desc = html.unescape(str(ld_obj.get("description") or "").strip())
        if len(ld_desc) > 35:
            bio = ld_desc[:420] + ("…" if len(ld_desc) > 420 else "")
        break

    m_meta = re.search(
        r'<meta[^>]*name=["\']description["\'][^>]*content=["\']([^"\']+)["\']',
        html_page[:20000],
    )
    if m_meta:
        meta_txt = html.unescape(m_meta.group(1).strip())
        if "—" in meta_txt:
            after_dash = meta_txt.split("—", 1)[1].strip()
            if not bio and len(after_dash) > 25:
                bio = after_dash[:420] + ("…" if len(after_dash) > 420 else "")

    section_buckets: Dict[str, List[Dict[str, Any]]] = {
        "director": [],
        "actor": [],
        "writer": [],
        "producer": [],
        "composer": [],
        "operator": [],
    }
    section_seen: Dict[str, Set[str]] = {k: set() for k in section_buckets}
    actor_self_items: List[Dict[str, Any]] = []

    matches = list(ITEM_HDR_RE.finditer(html_page))
    cur_year = time.localtime().tm_year

    for idx, m_hdr in enumerate(matches):
        raw_role = m_hdr.group(1).lower()
        kid = m_hdr.group(2)
        if raw_role not in ROLE_DEFS or not kid.isdigit():
            continue
        role_key, _ = ROLE_DEFS[raw_role]
        if kid in section_seen[role_key]:
            continue
        end_pos = matches[idx + 1].start() if (idx + 1) < len(matches) else min(len(html_page), m_hdr.end() + 6500)
        chunk = html_page[m_hdr.start() : min(end_pos, m_hdr.end() + 6500)]
        if "status_future" in chunk or "filmList__future" in chunk:
            continue

        m_title = re.search(r'<span\s+class=["\']title["\']>([^<]+)</span>', chunk)
        if not m_title:
            continue
        ru_title = html.unescape(m_title.group(1).strip())
        if not ru_title:
            continue

        m_small = re.search(r'<span\s+class=["\']filmList__small-text["\']>\s*(.*?)\s*</span>', chunk, re.S)
        small_txt = html.unescape(re.sub(r"<[^>]+>", " ", m_small.group(1)).strip()) if m_small else ""
        small_txt = re.sub(r"\s+", " ", small_txt).strip()

        ym = re.search(r"\b(19\d\d|20\d\d)\b", small_txt)
        yr_num = int(ym.group(1)) if ym else 0

        m_kr = re.search(
            r'class=["\']rating_kinorium[^"\']*["\'].*?<span[^>]*class=["\'][^"\']*value[^"\']*["\'][^>]*>\s*(\d+(?:\.\d+)?)',
            chunk,
            re.S,
        )
        m_ir = re.search(
            r'class=["\']rating_imdb[^"\']*["\'].*?<span[^>]*class=["\'][^"\']*value[^"\']*["\'][^>]*>\s*(\d+(?:\.\d+)?)',
            chunk,
            re.S,
        )
        kr_val = float(m_kr.group(1)) if m_kr else 0.0
        ir_val = float(m_ir.group(1)) if m_ir else 0.0

        # Skip unrated future announcements
        if yr_num > cur_year and kr_val <= 0.0 and ir_val <= 0.0:
            continue
        if yr_num == cur_year and kr_val <= 0.0 and ir_val <= 0.0 and "rating_na" in chunk and "rating_kinorium" not in chunk:
            continue

        orig_t = ""
        if small_txt:
            parts_sm = [p.strip() for p in small_txt.rsplit(",", 1)]
            if len(parts_sm) == 2 and re.search(r"\d{4}", parts_sm[1]):
                orig_t = parts_sm[0].strip()
            elif not re.match(r"^[\d\s–-]+$", small_txt):
                orig_t = re.sub(r",?\s*(?:19|20)\d\d.*$", "", small_txt).strip()
        if not orig_t:
            orig_t = ru_title

        is_series = bool(
            "link-info-movie-type-serial" in chunk
            or "сериал" in small_txt.lower()
            or re.search(r"\d{4}\s*[–-]", small_txt)
        )
        mtype = "series" if is_series else "movie"

        m_extra = re.search(r'<p\s+class=["\']filmList__extra-info["\']>(.*?)(?:<br|</p>)', chunk, re.S)
        raw_extra = html.unescape(re.sub(r"<[^>]+>", " ", m_extra.group(1)).strip()) if m_extra else ""
        raw_genre_tokens = [g.strip() for g in raw_extra.split(",") if g.strip()]
        if genres_sanitizer:
            genres = genres_sanitizer(raw_genre_tokens, mtype)
        else:
            genres = raw_genre_tokens[:3] if raw_genre_tokens else (["Сериал", "Драма"] if is_series else ["Фильм", "Драма"])

        ratings_obj: Dict[str, float] = {}
        if kr_val > 0:
            ratings_obj["kinorium"] = kr_val
        if ir_val > 0:
            ratings_obj["imdb"] = ir_val
        if not ratings_obj:
            ratings_obj = {"kinorium": 7.5}

        work_obj = {
            "id": f"kin_{kid}",
            "kinorium_id": kid,
            "title": ru_title,
            "orig_title": orig_t,
            "title_pl": orig_t,
            "year": yr_num,
            "media_type": mtype,
            "seasons_count": 1,
            "episodes_per_season": 0 if mtype == "series" else 1,
            "genres": genres,
            "description": f"{ru_title} ({orig_t}, {yr_num})" if yr_num else ru_title,
            "poster": f"https://ru-images.kinorium.com/movie/600/{kid}.jpg",
            "poster_en": f"https://en-images.kinorium.com/movie/600/{kid}.jpg",
            "backdrop": f"https://ru-images.kinorium.com/movie/1080/{kid}.jpg",
            "ambient_color": "#1e293b",
            "ratings": ratings_obj,
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p", "audio": "RU/EN"},
                {"id": "backup4k", "available": True, "quality": "4K Remux", "audio": "RU/EN"},
            ],
        }

        chunk_low = chunk.lower()
        is_self_credit = role_key == "actor" and (
            "играет самого себя" in chunk_low
            or "играет саму себя" in chunk_low
            or "хроника" in chunk_low
        )
        section_seen[role_key].add(kid)
        if is_self_credit:
            actor_self_items.append(work_obj)
        else:
            if len(section_buckets[role_key]) < 80:
                section_buckets[role_key].append(work_obj)

    total_narrative = sum(len(v) for v in section_buckets.values())
    if not section_buckets["actor"] and total_narrative < 3 and actor_self_items:
        section_buckets["actor"] = actor_self_items[:30]

    sections: List[Dict[str, Any]] = []
    active_role_labels: List[str] = []
    for r_key, r_label in ROLE_LABELS_ORDER:
        b_items = section_buckets.get(r_key) or []
        if b_items:
            sections.append({"key": r_key, "label": r_label, "items": b_items})
            active_role_labels.append(r_label)

    if active_role_labels:
        career_roles = ", ".join(active_role_labels[:4])

    return {
        "kinorium_person_id": eff_pid,
        "name": ru_name,
        "orig_name": orig_name,
        "person_url": f"https://ru.kinorium.com/name/{eff_pid}/",
        "photo": photo_url,
        "career_roles": career_roles,
        "birth_date": birth_date,
        "birth_place": birth_place,
        "bio": bio,
        "sections": sections,
    }
