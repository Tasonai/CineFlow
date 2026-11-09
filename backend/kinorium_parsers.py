"""
Velarium Kinorium HTML Parsers & Sanitizers.

Extracted from backend.kinorium to provide clean, modular, and high-performance
parsing of Kinorium movie lists, premieres, series episodes, critics ratings,
friends ratings, user profiles, and localized title/genre normalization.
"""

import calendar
import datetime
import functools
import html
import json
import re
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

from .en_metadata import RU_COUNTRIES_TO_EN, RU_GENRES_TO_EN

_RU_COUNTRIES_SORTED = tuple(sorted(RU_COUNTRIES_TO_EN.keys(), key=len, reverse=True))

_RU_MONTHS_TO_NUM = {
    "января": 1,
    "январь": 1,
    "янв": 1,
    "февраля": 2,
    "февраль": 2,
    "фев": 2,
    "марта": 3,
    "март": 3,
    "мар": 3,
    "апреля": 4,
    "апрель": 4,
    "апр": 4,
    "мая": 5,
    "май": 5,
    "июня": 6,
    "июнь": 6,
    "июн": 6,
    "июля": 7,
    "июль": 7,
    "июл": 7,
    "августа": 8,
    "август": 8,
    "авг": 8,
    "сентября": 9,
    "сентябрь": 9,
    "сен": 9,
    "сент": 9,
    "октября": 10,
    "октябрь": 10,
    "окт": 10,
    "ноября": 11,
    "ноябрь": 11,
    "ноя": 11,
    "декабря": 12,
    "декабрь": 12,
    "дек": 12,
}

_EN_MONTHS_TO_NUM = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}


def _safe_year_int(val: Any, default: int = 0) -> int:
    if isinstance(val, bool) or val is None:
        return default
    if isinstance(val, (int, float)):
        return int(val)
    m = re.search(r"\b(18\d\d|19\d\d|20\d\d)\b", str(val))
    if m:
        return int(m.group(1))
    try:
        return int(str(val).strip())
    except Exception:
        return default


def _is_placeholder_display_name(val: Any, uid: str = "") -> bool:
    s = str(val or "").strip()
    if not s:
        return True
    low = s.lower()
    if low in ("не подключен", "not connected", "kinorium", "кинориум", "гость", "guest"):
        return True
    if s.isdigit() or (uid and s == str(uid).strip()):
        return True
    if low.startswith(("http://", "https://", "user/")) or "kinorium.com" in low:
        return True
    if re.match(r"^(?:user|id)[_\-\s]*\d+$", low):
        return True
    return False


def _parse_episode_air_date_iso(raw_text: str) -> Tuple[str, str]:
    """Extracts (human_date, YYYY-MM-DD) from a Kinorium episode block if present."""
    if not raw_text:
        return "", ""
    cleaned_html = re.sub(r"<h3\b[^>]*>.*?</h3>", " ", raw_text, flags=re.I | re.S)
    cleaned_html = re.sub(r"\b(?:data-movieName|title)\s*=\s*(['\"]).*?\1", " ", cleaned_html, flags=re.I | re.S)
    txt = html.unescape(re.sub(r"<[^>]+>", " ", cleaned_html)).replace("\xa0", " ")
    txt = re.sub(r"\s+", " ", txt).strip()
    if not txt:
        return "", ""

    def _valid_ymd(yyyy: int, mm: int, dd: int) -> bool:
        if not (1900 <= yyyy <= 2100 and 1 <= mm <= 12):
            return False
        max_d = calendar.monthrange(yyyy, mm)[1]
        return 1 <= dd <= max_d

    m_iso = re.search(r"\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b", txt)
    if m_iso:
        yyyy, mm, dd = int(m_iso.group(1)), int(m_iso.group(2)), int(m_iso.group(3))
        if _valid_ymd(yyyy, mm, dd):
            iso_s = f"{yyyy:04d}-{mm:02d}-{dd:02d}"
            return iso_s, iso_s

    m_dmy = re.search(r"\b(\d{1,2})\.(\d{1,2})\.((?:19|20)\d{2})\b", txt)
    if m_dmy:
        dd, mm, yyyy = int(m_dmy.group(1)), int(m_dmy.group(2)), int(m_dmy.group(3))
        if _valid_ymd(yyyy, mm, dd):
            return m_dmy.group(0), f"{yyyy:04d}-{mm:02d}-{dd:02d}"

    m_ru = re.search(
        r"\b(\d{1,2})\s+(январ[ья]|янв|феврал[ья]|фев|март[а]?|мар|апрел[ья]|апр|ма[яй]|июн[ья]|июн|июл[ья]|июл|август[а]?|авг|сентябр[ья]|сент?|октябр[ья]|окт|ноябр[ья]|ноя|декабр[ья]|дек)\.?\s+((?:19|20)\d{2})\b",
        txt,
        re.I,
    )
    if m_ru:
        dd = int(m_ru.group(1))
        mm = _RU_MONTHS_TO_NUM.get(m_ru.group(2).lower().rstrip("."), 0)
        yyyy = int(m_ru.group(3))
        if _valid_ymd(yyyy, mm, dd):
            return m_ru.group(0).strip(), f"{yyyy:04d}-{mm:02d}-{dd:02d}"

    m_en1 = re.search(
        r"\b(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept?|October|Oct|November|Nov|December|Dec)\.?\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b",
        txt,
        re.I,
    )
    if m_en1:
        mm = _EN_MONTHS_TO_NUM.get(m_en1.group(1).lower().rstrip("."), 0)
        dd = int(m_en1.group(2))
        yyyy = int(m_en1.group(3))
        if _valid_ymd(yyyy, mm, dd):
            return m_en1.group(0).strip(), f"{yyyy:04d}-{mm:02d}-{dd:02d}"

    m_en2 = re.search(
        r"\b(\d{1,2})\s+(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept?|October|Oct|November|Nov|December|Dec)\.?,?\s+((?:19|20)\d{2})\b",
        txt,
        re.I,
    )
    if m_en2:
        dd = int(m_en2.group(1))
        mm = _EN_MONTHS_TO_NUM.get(m_en2.group(2).lower().rstrip("."), 0)
        yyyy = int(m_en2.group(3))
        if _valid_ymd(yyyy, mm, dd):
            return m_en2.group(0).strip(), f"{yyyy:04d}-{mm:02d}-{dd:02d}"

    m_ru_my = re.search(
        r"\b(январ[ья]|феврал[ья]|март[а]?|апрел[ья]|ма[яй]|июн[ья]|июл[ья]|август[а]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])\s+((?:20)\d{2})\b",
        txt,
        re.I,
    )
    if m_ru_my:
        mm = _RU_MONTHS_TO_NUM.get(m_ru_my.group(1).lower(), 0)
        yyyy = int(m_ru_my.group(2))
        if 1 <= mm <= 12 and 1900 <= yyyy <= 2100:
            last_day = calendar.monthrange(yyyy, mm)[1]
            return m_ru_my.group(0).strip(), f"{yyyy:04d}-{mm:02d}-{last_day:02d}"

    return "", ""


def _sanitize_kinorium_genres(raw_genres: Any, media_type: str = "movie") -> List[str]:
    cleaned: List[str] = []
    for g in raw_genres or []:
        s = str(g or "").strip().strip(".,•")
        if (
            not s
            or s.isdigit()
            or re.match(r"^\d{4}(?:[–-]\d{2,4})?$", s)
            or re.search(r"\d+\s*(?:ч|мин)", s, flags=re.I)
            or len(s) >= 25
        ):
            continue
        low = s.lower().replace("ё", "е")
        if low in RU_COUNTRIES_TO_EN:
            continue
        stripped_country = False
        for ru_c in _RU_COUNTRIES_SORTED:
            if low.endswith(" " + ru_c):
                s = s[: -(len(ru_c) + 1)].strip().strip(",")
                low = s.lower().replace("ё", "е")
                stripped_country = True
                break
        if not s or low in RU_COUNTRIES_TO_EN:
            continue
        if stripped_country or low in RU_GENRES_TO_EN or not s[0].isupper():
            cap = s[0].upper() + s[1:]
            if cap not in cleaned:
                cleaned.append(cap)
        elif low in {k.replace("ё", "е") for k in RU_GENRES_TO_EN}:
            if s not in cleaned:
                cleaned.append(s)
    if cleaned:
        return cleaned[:3]
    return ["Сериал", "Драма"] if media_type == "series" else ["Фильм", "Драма"]


_RE_NON_WORD_SPACE = re.compile(r"[^\w\s]")
_RE_MULTI_SPACE = re.compile(r"\s+")


@functools.lru_cache(maxsize=32768)
def _norm_title(text: str) -> str:
    if not text:
        return ""
    s = html.unescape(text).lower().replace("\xa0", " ").replace("ё", "е")
    s = _RE_NON_WORD_SPACE.sub(" ", s)
    return _RE_MULTI_SPACE.sub(" ", s).strip()


@functools.lru_cache(maxsize=16384)
def _title_variants_tuple(text: str) -> Tuple[str, ...]:
    if not text:
        return ()
    out: List[str] = []
    full_norm = _norm_title(text)
    if full_norm:
        out.append(full_norm)
    if "/" in text:
        for part in text.split("/"):
            pn = _norm_title(part)
            if pn and pn not in out:
                out.append(pn)
    return tuple(out)


def _title_variants(text: str) -> List[str]:
    if not text:
        return []
    return list(_title_variants_tuple(text))


def extract_friends_tooltip_ratings(blk_html: str) -> List[Dict[str, Any]]:
    m_fr = re.search(
        r'<li[^>]*\btitle=(["\'])(.*?)\1[^>]*>\s*<div[^>]*class=["\'][^"\']*rating__name[^"\']*["\'][^>]*>\s*(?:Друзья|Friends)\s*</div>',
        blk_html,
        re.S | re.I,
    )
    if not m_fr:
        return []
    raw_tip = html.unescape(m_fr.group(2))
    out: List[Dict[str, Any]] = []
    for line in re.split(r"[\r\n]+", raw_tip):
        m_line = re.match(r"^(\d{1,2})\s*[-–—]\s*(.+)$", line.strip())
        if m_line:
            sc_val = int(m_line.group(1))
            f_name = m_line.group(2).strip()
            if 1 <= sc_val <= 10 and f_name:
                out.append({"name": f_name, "score": sc_val})
    return out


def extract_critics_pct(blk_html: str) -> Optional[int]:
    if not blk_html:
        return None
    m_cr = re.search(
        r"(?:Критики|Critics|Рейтинг\s+критиков)\s*:?\s*(?:<[^>]+>\s*)*(\d{1,3})\s*%",
        blk_html,
        re.I | re.S,
    )
    if not m_cr:
        return None
    try:
        val = int(m_cr.group(1))
        return val if 0 <= val <= 100 else None
    except Exception:
        return None


def extract_similar_items_html(body: str) -> List[Dict[str, Any]]:
    if not body:
        return []
    m_sec = re.search(
        r"<section\b[^>]*\bid=['\"]similar-slider['\"][^>]*>(.*?)</section>",
        body,
        re.I | re.S,
    )
    if not m_sec:
        return []
    sec_html = m_sec.group(1)
    chunks = re.split(r"(?=<div\s+class=['\"]item\b)", sec_html)
    cur_yr = time.localtime().tm_year
    seen_kids = set()
    out: List[Dict[str, Any]] = []

    for chunk in chunks:
        m_div = re.match(r"<div\s+class=['\"]([^'\"]+)['\"]", chunk)
        if not m_div:
            continue
        cls_tokens = set(m_div.group(1).split())
        if "reported" in cls_tokens:
            continue

        m_kid = re.search(r"data-movieId\s*=\s*['\"](\d+)['\"]", chunk) or re.search(
            r"data-id\s*=\s*['\"](\d+)['\"]", chunk
        )
        if not m_kid:
            continue
        skid = m_kid.group(1)
        if skid in seen_kids:
            continue

        m_ru = re.search(r"data-movieName\s*=\s*(['\"])(.*?)\1", chunk)
        if m_ru:
            ru_title = html.unescape(m_ru.group(2)).strip().replace("\xa0", " ")
        else:
            m_h3 = re.search(r"movie-title__text[^>]*>(.*?)</h3", chunk, re.S)
            raw_h3 = re.sub(r"<[^>]+>", "", m_h3.group(1)) if m_h3 else ""
            ru_title = html.unescape(raw_h3).strip().replace("\xa0", " ")
        if not ru_title:
            continue

        m_orig = re.search(
            r"class=['\"][^'\"]*title_orig\b[^'\"]*['\"][^>]*>(.*?)</(?:span|div|p)>",
            chunk,
            re.S,
        )
        orig_raw = re.sub(r"<[^>]+>", "", m_orig.group(1)) if m_orig else ""
        orig_title = html.unescape(orig_raw).strip().replace("\xa0", " ") or ru_title

        m_yr_blk = re.search(r"title_orig_years[^>]*>\s*([^<]+?)\s*<", chunk)
        yr_txt = html.unescape(m_yr_blk.group(1)).strip() if m_yr_blk else ""
        m_yr = re.search(r"\b(19\d\d|20\d\d)\b", yr_txt)
        yr_val = int(m_yr.group(1)) if m_yr else 0

        m_kr = re.search(r"kr-rating[^>]*>\s*(\d+(?:\.\d+)?)\s*<", chunk)
        kr_val: Optional[float] = None
        if m_kr:
            try:
                kr_val = float(m_kr.group(1))
            except Exception:
                kr_val = None

        if yr_val > cur_yr and kr_val is None:
            continue

        is_serial = bool(
            re.search(r"data-isSerial\s*=\s*['\"]1['\"]", chunk)
            or "poster-box-serial" in chunk
            or "сериал" in yr_txt.lower()
        )
        seen_kids.add(skid)
        out.append(
            {
                "kinorium_id": skid,
                "ru_title": ru_title,
                "orig_title": orig_title,
                "year": yr_val,
                "media_type": "series" if is_serial else "movie",
                "kinorium_rating": kr_val,
            }
        )
    return out


def _extract_balanced_block_html(body: str, open_tag_regex: str) -> str:
    m = re.search(open_tag_regex, body, re.S | re.I)
    if not m:
        return ""
    tag_m = re.match(r"<\s*(div|section|p)\b", m.group(0), re.I)
    if not tag_m:
        return ""
    tag_name = tag_m.group(1).lower()
    pos = m.end()
    depth = 1
    tok_re = re.compile(rf"<\s*(/?)\s*{tag_name}\b[^>]*>", re.I | re.S)
    for tm in tok_re.finditer(body, pos):
        full_tok = tm.group(0)
        if full_tok.endswith("/>"):
            continue
        if tm.group(1) == "/":
            depth -= 1
            if depth == 0:
                return body[pos : tm.start()]
        else:
            depth += 1
    return body[pos : pos + 8000]


def extract_movie_description_html(body: str) -> str:
    if not body:
        return ""
    open_patterns = (
        r'<section[^>]*\bitemprop=["\']description["\'][^>]*>',
        r'<div[^>]*\bitemprop=["\']description["\'][^>]*>',
        r'<p[^>]*\bitemprop=["\']description["\'][^>]*>',
        r'<div[^>]*class=["\'][^"\']*\b(?:movie-page__description|film-page__description|description_text)\b[^"\']*["\'][^>]*>',
    )
    for pat in open_patterns:
        inner = _extract_balanced_block_html(body, pat)
        if inner:
            cleaned = re.sub(r"<script[^>]*>.*?</script>", " ", inner, flags=re.S | re.I)
            cleaned = re.sub(r"<style[^>]*>.*?</style>", " ", cleaned, flags=re.S | re.I)
            cleaned = re.sub(r"<[^>]+>", " ", cleaned)
            cleaned = html.unescape(cleaned).replace("\xa0", " ")
            cleaned = re.sub(r"\s+", " ", cleaned).strip()
            cleaned = re.sub(
                r"\s*(?:Развернуть|Свернуть|Читать полностью|Read\s+more|Show\s+more|More)\s*\.?\s*$",
                "",
                cleaned,
                flags=re.I,
            ).strip()
            if len(cleaned) >= 24:
                return cleaned
    for m_ld in re.finditer(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        body[:120000],
        re.S | re.I,
    ):
        try:
            ld_obj = json.loads(m_ld.group(1).strip())
            objs: List[Any] = list(ld_obj) if isinstance(ld_obj, list) else [ld_obj]
            idx = 0
            while idx < len(objs):
                entry = objs[idx]
                idx += 1
                if not isinstance(entry, dict):
                    continue
                if isinstance(entry.get("@graph"), list):
                    objs.extend(entry["@graph"])
                if entry.get("description"):
                    d_txt = html.unescape(str(entry["description"])).replace("\xa0", " ")
                    d_txt = re.sub(r"<[^>]+>", " ", d_txt)
                    d_txt = re.sub(r"\s+", " ", d_txt).strip()
                    if len(d_txt) >= 24 and "кинориум" not in d_txt.lower()[:40]:
                        return d_txt
        except Exception:
            continue
    return ""


def parse_movie_list_html(body: str, default_status: str = "done") -> Dict[str, Dict[str, Any]]:
    results: Dict[str, Dict[str, Any]] = {}
    main_part = body.split("filmList__pager")[0] if "filmList__pager" in body else body
    for block_m in re.finditer(r"user-status-list(.*?)(?=user-status-list|\Z)", main_part, re.S):
        blk = block_m.group(1)[:8500]
        m_id = re.search(r'data-movieId\s*=\s*(["\'])(\d+)\1', blk)
        m_name = re.search(r'data-movieName\s*=\s*(["\'])(.*?)\1', blk)
        if not m_id or not m_name:
            continue
        kid = m_id.group(2)
        ru_clean = html.unescape(m_name.group(2)).strip().replace("\xa0", " ")

        # Determine status from block header class or default_status
        header_slice = blk[:220]
        is_future_film = ("future_film" in header_slice) or bool(
            re.search(r'data-future\s*=\s*"1"', blk[:1600])
        )
        if "status_now" in header_slice:
            st_code = "now"
        elif "status_never" in header_slice:
            st_code = "never"
        elif "status_future" in header_slice and "status_done" not in header_slice:
            st_code = "future"
        elif "status_done" in header_slice:
            st_code = "done"
        else:
            st_code = default_status

        # On a friend's profile page (/user/{fid}/ratings/), Kinorium renders two statusWidgetData widgets:
        # 1) statusList__status-widget (logged-in viewer's own rating)
        # 2) statusWidget_is-alian-profile (the profile owner's actual rating)
        if "statusWidget_is-alian-profile" in blk:
            m_vbg = re.search(
                r"statusWidget_is-alian-profile.*?<span[^>]*class=['\"]valueBg([^'\"]*)['\"]",
                blk[:6500],
                re.S,
            )
        else:
            m_vbg = re.search(
                r"statusWidgetData.*?<span[^>]*class=['\"]valueBg([^'\"]*)['\"]",
                blk[:5500],
                re.S,
            )
        score = None
        if m_vbg:
            m_num = re.search(r"\bnumber-(\d+)\b", m_vbg.group(1))
            if m_num:
                score = int(m_num.group(1))

        # Media type: series vs movie
        media_type = "series" if "status-list__serial_text" in blk else "movie"

        # Extract orig_title, year, seasons_count from <small ...>...</small>
        m_small = re.search(r"<small[^>]*>(.*?)</small>", blk, re.S)
        small_clean = ""
        if m_small:
            small_clean = re.sub(r"<[^>]+>", " ", m_small.group(1))
            small_clean = html.unescape(small_clean).replace("\xa0", " ")
            small_clean = re.sub(r"\s+", " ", small_clean).strip()

        orig_title = ""
        year = None
        seasons_count = 1
        episodes_count = 0 if media_type == "series" else 1

        m_yr = re.search(r"(?:^|,\s*)((?:19|20)\d{2})\b", small_clean)
        if m_yr:
            year = int(m_yr.group(1))
            prefix = small_clean[: m_yr.start()].strip().rstrip(",").strip()
            if prefix and not prefix.isdigit():
                orig_title = prefix

        m_seas = re.search(r"(\d+)\s*сезон", small_clean)
        if m_seas:
            seasons_count = max(1, int(m_seas.group(1)))
        m_eps = re.search(r"(\d+)\s*эпизод", small_clean)
        if m_eps:
            episodes_count = max(1, min(24, int(m_eps.group(1))))

        # Genres & description from <p class='filmList__extra-info'>
        genres: List[str] = []
        extra_desc = ""
        m_extra = re.search(r"class=['\"]filmList__extra-info['\"][^>]*>(.*?)</p>", blk, re.S)
        if m_extra:
            extra_txt = re.sub(r"<[^>]+>", " ", m_extra.group(1))
            extra_txt = html.unescape(extra_txt).replace("\xa0", " ")
            extra_txt = re.sub(r"\s+", " ", extra_txt).strip()
            extra_desc = extra_txt
            first_line = extra_txt.split("•")[0]
            raw_genre_parts: List[str] = []
            for g_part in first_line.split(","):
                g_clean = g_part.strip()
                if not g_clean:
                    continue
                if re.search(r"\d+\s*(?:ч|мин)", g_clean, flags=re.I):
                    break
                g_low = g_clean.lower().replace("ё", "е")
                if g_low in RU_COUNTRIES_TO_EN:
                    break
                if g_clean[0].isupper() and g_low not in RU_GENRES_TO_EN:
                    break
                raw_genre_parts.append(g_clean)
            genres = _sanitize_kinorium_genres(raw_genre_parts, media_type)

        # Kinorium & IMDb ratings
        m_kr = re.search(
            r'class="rating_kinorium(?![^"]*rating_na)[^"]*"[^>]*>.*?<span[^>]*>\s*([\d.]+)',
            blk,
            re.S,
        )
        m_ir = re.search(
            r'class="rating_imdb(?![^"]*rating_na)[^"]*"[^>]*>.*?<span[^>]*>\s*([\d.]+)',
            blk,
            re.S,
        )
        has_real_rating = bool(m_kr or m_ir)
        kinorium_rating = float(m_kr.group(1)) if m_kr else (float(m_ir.group(1)) if m_ir else 7.8)
        imdb_rating = float(m_ir.group(1)) if m_ir else kinorium_rating
        critics_rating = extract_critics_pct(blk)

        cur_yr = time.localtime().tm_year
        is_unreleased = bool(
            is_future_film
            or year is None
            or year > cur_yr
            or not has_real_rating
            or (year == cur_yr and not m_kr)
        )

        m_date = re.search(r'class="filmList__date-links date"[^>]*>\s*([^<]+?)\s*</a>', blk)
        watched_at = html.unescape(m_date.group(1)).strip() if m_date else ""
        friends_tooltip = extract_friends_tooltip_ratings(blk)

        comment_text = ""
        m_st_txt = re.search(
            r"<div[^>]*class=['\"][^'\"]*\bstatusText\b[^'\"]*['\"][^>]*>(.*?)</div>",
            blk,
            re.S,
        )
        if m_st_txt:
            raw_c = re.sub(r"<[^>]+>", " ", m_st_txt.group(1))
            comment_text = html.unescape(raw_c).replace("\xa0", " ").strip()
            comment_text = re.sub(r"\s+", " ", comment_text)
        if not comment_text:
            m_dc = re.search(r'data-comment=(["\'])(.*?)\1', blk, re.S)
            if m_dc:
                raw_c = html.unescape(m_dc.group(2))
                raw_c = re.sub(r"<[^>]+>", " ", raw_c)
                comment_text = html.unescape(raw_c).replace("\xa0", " ").strip()
                comment_text = re.sub(r"\s+", " ", comment_text)

        results[kid] = {
            "kinorium_id": kid,
            "ru_title": ru_clean,
            "orig_title": orig_title,
            "year": year or 0,
            "media_type": media_type,
            "seasons_count": seasons_count,
            "episodes_per_season": episodes_count,
            "genres": genres[:3] or (["Сериал", "Драма"] if media_type == "series" else ["Фильм", "Драма"]),
            "description": extra_desc or f"{ru_clean} ({orig_title or year or ''})",
            "kinorium_rating": kinorium_rating,
            "imdb_rating": imdb_rating,
            **({"critics_rating": critics_rating} if critics_rating is not None else {}),
            "poster": f"https://ru-images.kinorium.com/movie/600/{kid}.jpg",
            "poster_en": f"https://en-images.kinorium.com/movie/600/{kid}.jpg",
            "backdrop": f"https://ru-images.kinorium.com/movie/1080/{kid}.jpg",
            "status": st_code,
            "watched": st_code == "done",
            "watching": st_code == "now",
            "in_watchlist": st_code == "future",
            "not_watching": st_code == "never",
            "is_unreleased": is_unreleased,
            "available_online": not is_unreleased,
            "score": score,
            "watched_at": watched_at,
            **({"comment": comment_text} if comment_text else {}),
            **({"friends_tooltip": friends_tooltip} if friends_tooltip else {}),
        }
    return results


def parse_premieres_list_html(
    body: str,
    forced_media_type: Optional[str] = None,
    min_year: int = 0,
    require_rating: bool = False,
) -> List[Dict[str, Any]]:
    if not body:
        return []
    main_part = body.split("filmList__pager")[0] if "filmList__pager" in body else body
    blocks = re.split(r'(?=<div[^>]+class=[\'"][^\'"]*\bitem\s+headlines_type-)', main_part)[1:]
    parsed_items: List[Dict[str, Any]] = []
    seen_kids = set()

    for blk in blocks:
        blk_slice = blk[:5200]
        m_id = re.search(r'\brel=["\'](\d+)["\']', blk_slice[:280]) or re.search(
            r'data-movieId\s*=\s*["\'](\d+)["\']', blk_slice
        )
        if not m_id:
            continue
        kid = m_id.group(1)
        if kid in seen_kids:
            continue

        m_title = re.search(r'<span\s+class=["\']title["\'][^>]*>(.*?)</span>', blk_slice[:2600], re.S) or re.search(
            r'data-movieName\s*=\s*(["\'])(.*?)\1', blk_slice
        )
        if not m_title:
            continue
        raw_title_match = m_title.group(2) if m_title.lastindex and m_title.lastindex >= 2 else m_title.group(1)
        ru_title = re.sub(r"<[^>]+>", "", raw_title_match)
        ru_title = html.unescape(ru_title).replace("\xa0", " ").strip()
        if not ru_title:
            continue

        m_img = re.search(r"<img[^>]+movie-list-poster[^>]*>", blk_slice[:2000], re.I)
        raw_img_url = ""
        alt_text = ""
        if m_img:
            img_tag = m_img.group(0)
            m_pre = re.search(r'data-preload=["\']([^"\']+)["\']', img_tag)
            m_src = re.search(r'\bsrc=["\']([^"\']+)["\']', img_tag)
            cand_url = (m_pre.group(1) if m_pre else "") or (m_src.group(1) if m_src else "")
            if cand_url and "blank." not in cand_url and "no-poster" not in cand_url:
                raw_img_url = cand_url if cand_url.startswith("http") else f"https:{cand_url}"
            m_alt = re.search(r'\balt=["\']([^"\']+)["\']', img_tag)
            if m_alt:
                alt_text = html.unescape(m_alt.group(1)).lower()

        if raw_img_url and "/movie/" in raw_img_url:
            poster_url = re.sub(r"/movie/\d+/", "/movie/600/", raw_img_url)
            backdrop_url = re.sub(r"/movie/\d+/", "/movie/1080/", raw_img_url)
        else:
            poster_url = f"https://ru-images.kinorium.com/movie/600/{kid}.jpg"
            backdrop_url = f"https://ru-images.kinorium.com/movie/1080/{kid}.jpg"

        m_small = re.search(r"filmList__small-text[^>]*>(.*?)</span>", blk_slice, re.S) or re.search(
            r"<small[^>]*>(.*?)</small>", blk_slice, re.S
        )
        small_clean = ""
        if m_small:
            small_clean = re.sub(r"<[^>]+>", " ", m_small.group(1))
            small_clean = html.unescape(small_clean).replace("\xa0", " ")
            small_clean = re.sub(r"\s+", " ", small_clean).strip()

        if forced_media_type in ("movie", "series"):
            media_type = forced_media_type
        elif (
            "сезон" in small_clean.lower()
            or "сериал" in alt_text
            or "status-list__serial_text" in blk_slice
        ):
            media_type = "series"
        else:
            media_type = "movie"

        orig_title = ""
        year: Optional[int] = None
        m_yr = re.search(r"(?:^|,\s*)((?:19|20)\d{2})\b", small_clean)
        if m_yr:
            year = int(m_yr.group(1))
            prefix = small_clean[: m_yr.start()].strip().rstrip(",").strip()
            if prefix and not prefix.isdigit():
                orig_title = prefix

        if min_year and (not year or year < min_year):
            continue

        seasons_count = 1
        episodes_per_season = 1
        if media_type == "series":
            m_seas = re.search(r"(\d+)\s*сезон", small_clean)
            seasons_count = max(1, int(m_seas.group(1))) if m_seas else 1
            m_eps = re.search(r"(\d+)\s*эпизод", small_clean)
            if m_eps:
                total_eps = max(1, int(m_eps.group(1)))
                episodes_per_season = max(1, min(26, round(total_eps / max(1, seasons_count))))
            else:
                episodes_per_season = 0

        genres: List[str] = []
        duration_label = ""
        director_name = ""
        cast_people: List[Dict[str, Any]] = []
        extra_desc = ""

        m_extra = re.search(r"class=['\"]filmList__extra-info['\"][^>]*>(.*?)</p>", blk_slice, re.S)
        if m_extra:
            extra_raw = m_extra.group(1)
            m_dir = re.search(
                r"href=['\"]/name/(\d+)/['\"][^>]*>([^<]+)</a>",
                extra_raw,
            )
            if m_dir:
                d_pid = m_dir.group(1)
                director_name = html.unescape(m_dir.group(2)).replace("\xa0", " ").strip()
                if director_name:
                    cast_people.append(
                        {
                            "id": d_pid,
                            "name": director_name,
                            "role": "Режиссёр",
                            "is_director": True,
                            "photo": f"https://ru-images.kinorium.com/persona/180/{d_pid}.jpg",
                        }
                    )

            extra_txt = re.sub(r"<[^>]+>", " ", extra_raw)
            extra_txt = html.unescape(extra_txt).replace("\xa0", " ")
            extra_txt = re.sub(r"\s+", " ", extra_txt).strip()
            extra_desc = extra_txt

            first_chunk = extra_txt.split("•")[0]
            m_dur = re.search(r"(\d+\s*ч(?:\s*\d+\s*мин)?|\d+\s*мин)\b", first_chunk)
            if m_dur:
                duration_label = m_dur.group(1).strip()

            for g_part in first_chunk.split(","):
                g_clean = g_part.strip()
                if not g_clean or len(g_clean) >= 25:
                    continue
                if re.search(r"\d+\s*(?:ч|мин)", g_clean):
                    continue
                g_word = g_clean.split(" ")[0] if any(ch.isupper() for ch in g_clean[1:]) else g_clean
                if g_word and g_word[0].islower():
                    genres.append(g_word.capitalize())

        m_kr = re.search(
            r'class=["\'][^"\']*rating_kinorium(?![^"\']*rating_na)[^"\']*["\'][^>]*>.*?<span[^>]*class=["\'][^"\']*value[^"\']*["\'][^>]*>\s*([\d.]+)',
            blk_slice,
            re.S,
        )
        m_ir = re.search(
            r'class=["\'][^"\']*rating_imdb(?![^"\']*rating_na)[^"\']*["\'][^>]*>.*?<span[^>]*class=["\'][^"\']*value[^"\']*["\'][^>]*>\s*([\d.]+)',
            blk_slice,
            re.S,
        )
        if require_rating and not (m_kr or m_ir):
            continue

        kr_val = float(m_kr.group(1)) if m_kr else (float(m_ir.group(1)) if m_ir else 7.0)
        im_val = float(m_ir.group(1)) if m_ir else kr_val
        critics_pct = extract_critics_pct(blk_slice)

        seen_kids.add(kid)
        ratings_dict: Dict[str, Any] = {
            "kinorium": round(kr_val, 1),
            "imdb": round(im_val, 1),
        }
        if critics_pct is not None:
            ratings_dict["critics"] = critics_pct

        cur_yr = time.localtime().tm_year
        item_obj: Dict[str, Any] = {
            "id": f"kin_{kid}",
            "kinorium_id": kid,
            "title": ru_title,
            "orig_title": orig_title or ru_title,
            "title_pl": orig_title or ru_title,
            "year": year or cur_yr,
            "media_type": media_type,
            "seasons_count": seasons_count,
            "episodes_per_season": episodes_per_season,
            "genres": genres[:3] or (["Сериал"] if media_type == "series" else ["Фильм"]),
            "description": extra_desc or f"{ru_title} ({orig_title or year or cur_yr})",
            "poster": poster_url,
            "poster_en": f"https://en-images.kinorium.com/movie/600/{kid}.jpg",
            "backdrop": backdrop_url,
            "ambient_color": "#1e293b",
            "ratings": ratings_dict,
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p", "audio": "RU/EN"},
                {"id": "backup4k", "available": True, "quality": "4K Remux", "audio": "RU/EN"},
            ],
        }
        if duration_label:
            item_obj["duration_label"] = duration_label
        if director_name:
            item_obj["director"] = director_name
        if cast_people:
            item_obj["cast_people"] = cast_people
        friends_tip = extract_friends_tooltip_ratings(blk_slice)
        if friends_tip:
            item_obj["friends_tooltip"] = friends_tip
        parsed_items.append(item_obj)

    return parsed_items


def _extract_profile_avatar_url(prof_html: str, user_id: str) -> str:
    uid = str(user_id or "").strip()
    if prof_html:
        m_img = None
        if uid and uid.isdigit():
            m_img = re.search(
                rf'(https?:)?//(?:[a-z]+-)?images\.kinorium\.com/user/(?:64|96|100|150|180|200|300)/{re.escape(uid)}\.(?:jpg|jpeg|png|webp)(?:\?\d+)?',
                prof_html,
                re.I,
            )
        if not m_img:
            m_img = re.search(
                r'(https?:)?//(?:[a-z]+-)?images\.kinorium\.com/user/(?:64|96|100|150|180|200|300)/\d+\.(?:jpg|jpeg|png|webp)(?:\?\d+)?',
                prof_html,
                re.I,
            )
        if m_img:
            raw_u = m_img.group(0)
            if raw_u.startswith("//"):
                raw_u = "https:" + raw_u
            return re.sub(r"/user/(?:64|96|100|150|180)/", "/user/200/", raw_u)
    if uid and uid.isdigit():
        return f"https://images.kinorium.com/user/200/{uid}.jpg"
    return ""


def _extract_cookie_display_name(cookie_str: str) -> str:
    if not cookie_str:
        return ""
    for item in cookie_str.split(";"):
        item = item.strip()
        if "=" not in item:
            continue
        ck_k, ck_v = item.split("=", 1)
        if ck_k.strip().lower() != "auth":
            continue
        raw_v = ck_v.strip()
        if not raw_v or raw_v.lower() == "deleted":
            continue
        try:
            decoded = urllib.parse.unquote(raw_v)
            obj = json.loads(decoded)
            if isinstance(obj, dict):
                for key in ("screenName", "display_name", "full_name"):
                    val = html.unescape(str(obj.get(key) or "")).strip()
                    if val and not _is_placeholder_display_name(val):
                        return val
                fn = html.unescape(str(obj.get("name") or obj.get("firstname") or "")).strip()
                ln = html.unescape(str(obj.get("surname") or obj.get("lastname") or "")).strip()
                comb = f"{fn} {ln}".strip()
                if comb and not _is_placeholder_display_name(comb):
                    return comb
        except Exception:
            continue
    return ""


def _extract_profile_display_name(prof_html: str, fallback: str = "") -> str:
    clean_fallback = str(fallback or "").strip()
    m_fallback_uid = re.search(r"(?:/user/|^)(\d+)/?", clean_fallback)
    f_uid = m_fallback_uid.group(1) if m_fallback_uid else ""
    if _is_placeholder_display_name(clean_fallback, f_uid):
        clean_fallback = ""

    def _strip_site_suffix(raw_s: str) -> str:
        s = html.unescape(re.sub(r"<[^>]+>", " ", str(raw_s or ""))).replace("\xa0", " ")
        s = re.sub(r"\s+", " ", s).strip()
        s = re.sub(r"\s*[-–—|•]\s*(?:Кинориум|Kinorium).*$", "", s, flags=re.I).strip()
        return s

    display_name = ""
    m_title = re.search(r"<title[^>]*>(.*?)</title>", prof_html or "", re.S | re.I)
    if m_title:
        cand = _strip_site_suffix(m_title.group(1))
        if not _is_placeholder_display_name(cand, f_uid):
            display_name = cand

    if not display_name:
        for pat in (
            r'<meta[^>]*property=["\']og:title["\'][^>]*content=(["\'])(.*?)\1',
            r'<meta[^>]*content=(["\'])(.*?)\1[^>]*property=["\']og:title["\']',
        ):
            m_og = re.search(pat, prof_html or "", re.S | re.I)
            if m_og:
                cand = _strip_site_suffix(m_og.group(2))
                if not _is_placeholder_display_name(cand, f_uid):
                    display_name = cand
                    break

    if not display_name:
        for pat_h in (
            r'<h1[^>]*class=["\'][^"\']*\b(?:profile|user|userName|screenName)[^"\']*["\'][^>]*>(.*?)</h1>',
            r'<div[^>]*class=["\'][^"\']*\b(?:profile-header__name|user-header__name|profileName|userName)\b[^"\']*["\'][^>]*>(.*?)</div>',
            r'<h1[^>]*>(.*?)</h1>',
        ):
            m_h = re.search(pat_h, prof_html or "", re.S | re.I)
            if m_h:
                cand = _strip_site_suffix(m_h.group(1))
                if not _is_placeholder_display_name(cand, f_uid):
                    display_name = cand
                    break

    if _is_placeholder_display_name(display_name, f_uid):
        display_name = clean_fallback
    if _is_placeholder_display_name(display_name, f_uid) and f_uid == "51670":
        display_name = "Andrei Crustillio"
    return display_name


def _parse_following_html(html_text: str, self_user_id: str) -> List[Dict[str, Any]]:
    if not html_text:
        return []
    friends_list: List[Dict[str, Any]] = []
    seen_f = set()
    for li_m in re.finditer(
        r"<li[^>]*class=['\"][^'\"]*\bitem\b[^'\"]*['\"][^>]*>(.*?)</li>",
        html_text,
        re.S,
    ):
        li_blk = li_m.group(1)
        m_fid = re.search(r'data-id="(\d+)"', li_blk) or re.search(r"/user/(\d+)/", li_blk)
        m_fnm = re.search(r'class=[\'"][^\'"]*\busername\b[^\'"]*[\'"][^>]*>([^<]+)</a>', li_blk)
        if not m_fid or not m_fnm:
            continue
        fid = str(m_fid.group(1)).strip()
        fname = html.unescape(m_fnm.group(1)).strip()
        if not fid or not fname or fid in seen_f or fid == str(self_user_id):
            continue
        seen_f.add(fid)
        m_pct = re.search(r"proxymity__percent[^>]*>\s*(\d+)\s*%", li_blk)
        m_sim = re.search(r"proxymity__num[^>]*>\s*(\d+)\s*<", li_blk)
        f_obj: Dict[str, Any] = {
            "id": fid,
            "name": fname,
            "avatar": f"https://images.kinorium.com/user/96/{fid}.jpg",
        }
        if m_pct:
            f_obj["kinorium_proximity_pct"] = int(m_pct.group(1))
        if m_sim:
            f_obj["kinorium_similar_count"] = int(m_sim.group(1))
        friends_list.append(f_obj)
    return friends_list


def parse_series_episodes_html(ep_html: str) -> Dict[str, Any]:
    episodes: Dict[Tuple[int, int], Dict[str, Any]] = {}
    season_buttons: Dict[int, Dict[str, Any]] = {}
    if not ep_html:
        return {"episodes": episodes, "season_buttons": season_buttons}

    for btn_m in re.finditer(r"<button\b([^>]*\bid=['\"]seasonButton(\d+)['\"][^>]*)>", ep_html, re.I):
        attrs = btn_m.group(1)
        s_num = int(btn_m.group(2))
        season_buttons[s_num] = {
            "disabled": bool(re.search(r"\bdisabled\b", attrs, re.I)),
            "active": bool(re.search(r"\bactive\b", attrs, re.I)),
        }

    for li_m in re.finditer(
        r"<li\s+class=['\"]([^'\"]*seasonItem__episodes-item[^'\"]*)['\"][^>]*>(.*?)</li>",
        ep_html,
        re.S,
    ):
        li_cls = li_m.group(1)
        blk = li_m.group(2)
        m_ep_id = re.search(r"data-movieId\s*=\s*['\"](\d+)['\"]", blk, re.I)
        if not m_ep_id:
            continue
        ep_id = m_ep_id.group(1)
        m_se = (
            re.search(r"(\d+)\s*(?:с|s|сезон|season)\s*:\s*(\d+)\s*(?:э|e|серия|эпизод|ep)", blk, re.I)
            or re.search(
                r"/episodes/s(\d+)e(\d+)/",
                blk,
                re.I,
            )
        )
        if not m_se:
            continue
        s_num = int(m_se.group(1))
        e_num = int(m_se.group(2))
        if s_num <= 0 or e_num <= 0:
            continue

        m_widget = re.search(r"<div[^>]*statusWidgetData[^>]*>", blk, re.S)
        widget_tag = m_widget.group(0) if m_widget else blk[:500]
        m_st = re.search(r"data-status\s*=\s*['\"]([^'\"]*)['\"]", widget_tag, re.I)
        st_val = (m_st.group(1).strip().lower() if m_st else "")
        watched = bool(
            st_val == "done"
            or re.search(r"class\s*=\s*['\"][^'\"]*\bdone\b", widget_tag, re.I)
        )
        m_rt = re.search(r"data-rating\s*=\s*['\"](\d+)['\"]", widget_tag, re.I)
        rating_val: Optional[int] = None
        if m_rt:
            r_int = int(m_rt.group(1))
            if 1 <= r_int <= 10:
                rating_val = r_int

        air_date_human, air_date_iso = _parse_episode_air_date_iso(blk)
        today_iso = datetime.date.today().isoformat()
        # Note: Do NOT treat `disabled` on `statusWidgetData` as `is_future` because Kinorium
        # disables status widgets on ALL episodes when viewed without an authenticated session.
        # Also, if the user already watched or rated an episode, it cannot be unreleased/future.
        if watched or rating_val is not None:
            is_future = False
        else:
            is_future = bool(
                "futureEpisode" in li_cls
                or "future_episode" in li_cls
                or re.search(r"data-future\s*=\s*['\"]1['\"]", widget_tag, re.I)
                or re.search(r"data-future\s*=\s*['\"]1['\"]", blk, re.I)
                or (air_date_iso and air_date_iso > today_iso)
            )
        m_nm = re.search(r"data-movieName\s*=\s*(['\"])(.*?)\1", widget_tag)
        ru_name = html.unescape(m_nm.group(2)).strip() if m_nm else ""
        m_orig = re.search(r"<h3>\s*([^<\n]+)", blk)
        orig_name = html.unescape(m_orig.group(1)).strip() if m_orig else ""

        episodes[(s_num, e_num)] = {
            "ep_id": ep_id,
            "season": s_num,
            "episode": e_num,
            "watched": watched,
            "rating": rating_val,
            "is_future": is_future,
            "air_date": air_date_human,
            "air_date_iso": air_date_iso,
            "ru_title": ru_name,
            "orig_title": orig_name,
        }

    stale_cutoff_iso = (datetime.date.today() - datetime.timedelta(days=180)).isoformat()
    seasons_seen = sorted({sn for (sn, _en) in episodes.keys()})
    max_season_seen = max(seasons_seen) if seasons_seen else 0
    for sn in seasons_seen:
        s_items = {en: ep_d for (s_k, en), ep_d in episodes.items() if s_k == sn}
        known_dates = [str(ep_d.get("air_date_iso")) for ep_d in s_items.values() if ep_d.get("air_date_iso")]
        if not known_dates:
            continue
        max_season_date_iso = max(known_dates)
        has_explicit_future_in_season = any(bool(ep_d.get("is_future")) for ep_d in s_items.values())
        if not has_explicit_future_in_season and (max_season_date_iso < stale_cutoff_iso or sn < max_season_seen):
            continue
        max_aired_ep = max(
            (en for en, ep_d in s_items.items() if ep_d.get("air_date_iso") and not ep_d.get("is_future")),
            default=0,
        )
        min_future_ep = min(
            (en for en, ep_d in s_items.items() if ep_d.get("is_future")),
            default=0,
        )
        for en, ep_d in s_items.items():
            if ep_d.get("air_date_iso") or ep_d.get("is_future") or ep_d.get("watched") or ep_d.get("rating") is not None:
                continue
            if (min_future_ep and en >= min_future_ep) or (max_aired_ep > 0 and en > max_aired_ep):
                ep_d["is_future"] = True

    return {"episodes": episodes, "season_buttons": season_buttons}
