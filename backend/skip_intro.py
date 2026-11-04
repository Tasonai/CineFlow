import copy
import json
import math
import re
import threading
import time
import unicodedata
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

from .doh import DoHSplitNetworkClient


_LATIN_DIGRAPH_FOLD = str.maketrans(
    {
        "ł": "l",
        "ø": "o",
        "ß": "ss",
        "æ": "ae",
        "œ": "oe",
        "đ": "d",
        "ð": "d",
        "þ": "th",
        "ı": "i",
    }
)


_STRICT_IMDB_RE = re.compile(r"^tt\d{5,10}$")


def _safe_int(val: Any, default: int = 0) -> int:
    if isinstance(val, bool) or val is None:
        return default
    if isinstance(val, int):
        return val
    try:
        return int(val)
    except Exception:
        m = re.search(r"-?\d+", str(val))
        return int(m.group(0)) if m else default


def _parse_conf_and_votes(entry: Dict[str, Any]) -> Optional[Tuple[float, int]]:
    raw_conf = entry.get("confidence")
    if raw_conf is not None and not isinstance(raw_conf, bool):
        try:
            conf_f = float(raw_conf)
        except (TypeError, ValueError):
            conf_f = 0.5
        if not math.isfinite(conf_f) or conf_f <= 0.0:
            return None
        conf_score = min(1.0, conf_f)
    else:
        conf_score = 0.5
    sub_cnt = max(0, _safe_int(entry.get("submission_count"), 0))
    return (conf_score, sub_cnt)


def _as_dict_list(val: Any) -> List[Dict[str, Any]]:
    if isinstance(val, dict):
        return [val]
    if isinstance(val, list):
        return [item for item in val if isinstance(item, dict)]
    return []


class SkipIntroEngine:
    """
    Episode-accurate Skip Intro & Skip Credits engine (Cold-Open Safe):
    - Queries TheIntroDB v3 API (`https://api.theintrodb.org/v3/media?imdb_id=...&season=...&episode=...`)
      for exact millisecond timestamps (`start_ms`, `end_ms`) per individual episode.
    - Respects Cold Opens (pre-intro prologue scenes that can last 2 to 10+ minutes before the title sequence).
    - Never blindly skips static seconds (e.g. 15s-48s) at the start of an episode when an episode has
      no verified intro or is a pilot episode without opening credits.
    """

    # Verified per-episode intro windows (in seconds) for episodes after Cold Opens,
    # plus explicit None for pilot episodes that have no opening title sequence at all.
    VERIFIED_EPISODE_INTROS: Dict[Tuple[str, int, int], Optional[Tuple[float, float]]] = {
        # The Last of Us (tt3581920) — Cold opens vary from 6s to 9m09s!
        ("tt3581920", 1, 1): (200.7, 267.5),  # 03:20 - 04:27 (after 1968 talk show cold open)
        ("tt3581920", 1, 2): (549.0, 614.4),  # 09:09 - 10:14 (after Jakarta mycologist cold open)
        ("tt3581920", 1, 3): (6.9, 72.6),     # 00:06 - 01:12
        # Severance (tt11280740) — S1E1 has NO intro; S1E2+ have long cold opens
        ("tt11280740", 1, 1): None,           # Pilot has no opening title sequence
        ("tt11280740", 1, 2): (320.6, 400.0), # 05:20 - 06:40 (after 5m20s cold open)
        ("tt11280740", 1, 3): (125.2, 204.0), # 02:05 - 03:24
        # Silo (tt14688458)
        ("tt14688458", 1, 1): (274.2, 364.9), # 04:34 - 06:05 (after sheriff cold open)
        ("tt14688458", 1, 2): (142.0, 218.9), # 02:22 - 03:39
        # Arcane (tt11126994)
        ("tt11126994", 1, 1): (201.0, 266.0), # 03:21 - 04:26 (after bridge prologue)
        ("tt11126994", 1, 2): (219.6, 282.2), # 03:39 - 04:42
        # Stranger Things (tt4574334)
        ("tt4574334", 1, 1): (464.0, 516.0),  # 07:44 - 08:36 (after Hawkins Lab + Will Byers cold open)
        ("tt4574334", 1, 2): (274.5, 323.5),  # 04:34 - 05:23
        # Shogun (tt2788316)
        ("tt2788316", 1, 1): (468.0, 555.0),  # 07:48 - 09:15 (after Erasmus ship arrival cold open)
        ("tt2788316", 1, 2): (423.1, 513.2),  # 07:03 - 08:33
        # House of the Dragon (tt11198330)
        ("tt11198330", 1, 1): None,           # S1E1 has no opening credits sequence
        ("tt11198330", 1, 2): (2.0, 101.8),   # 00:02 - 01:41
        # Ted Lasso (tt10986410)
        ("tt10986410", 1, 1): None,           # S1E1 has no full intro sequence
        ("tt10986410", 1, 2): (199.6, 221.6), # 03:19 - 03:41 (after cold open)
        # 1670 (tt29420686)
        ("tt29420686", 1, 1): (108.0, 120.0), # 01:48 - 02:00 (title card after cold open)
        ("tt29420686", 1, 2): (173.5, 185.3), # 02:53 - 03:05
        # The Boys (tt1190634) — short title splash after cold open
        ("tt1190634", 1, 1): (165.0, 174.0),  # 02:45 - 02:54 (after Maeve & Homelander bank truck scene)
        # The Witcher (tt5180504) — title splash after cold open
        ("tt5180504", 1, 1): (148.0, 162.0),  # 02:28 - 02:42 (after Kikimora fight cold open)
    }

    def __init__(self, net_client: DoHSplitNetworkClient):
        self.net = net_client
        self.cache: Dict[str, Dict[str, Any]] = {}
        self._cache_meta: Dict[str, Tuple[float, float]] = {}
        self.imdb_id_cache: Dict[str, str] = {}
        self._imdb_cache_meta: Dict[str, Tuple[float, float]] = {}
        self._lock = threading.Lock()

    def _get_cached_segment(self, key: str) -> Optional[Dict[str, Any]]:
        now = time.time()
        with self._lock:
            entry = self.cache.get(key)
            if entry is None:
                return None
            meta = self._cache_meta.get(key)
            if meta is not None and (now - meta[0]) > meta[1]:
                self.cache.pop(key, None)
                self._cache_meta.pop(key, None)
                return None
            return copy.deepcopy(entry)

    def _set_cached_segment(self, key: str, result: Dict[str, Any], positive: bool) -> None:
        ttl = 21600.0 if positive else 900.0
        now = time.time()
        with self._lock:
            if len(self.cache) > 512:
                for k_old in list(self.cache.keys())[:128]:
                    self.cache.pop(k_old, None)
                    self._cache_meta.pop(k_old, None)
            self.cache[key] = result
            self._cache_meta[key] = (now, ttl)

    def resolve_imdb_id(
        self,
        raw_id: str,
        title: str = "",
        orig_title: str = "",
        year: int = 0,
        media_type: str = "series",
    ) -> str:
        s_id = (raw_id or "").strip()
        m_tt = re.match(r"^(?:stremio_|imdb_)?(tt\d{5,10})\b", s_id, re.I)
        if m_tt:
            return m_tt.group(1).lower()
        mtype_norm = "movie" if str(media_type or "").lower() == "movie" else "series"
        req_year = _safe_int(year, 0)
        cache_k = f"{s_id}|{mtype_norm}|{(orig_title or title).strip().lower()}|{req_year}"
        now = time.time()
        with self._lock:
            if cache_k in self.imdb_id_cache:
                meta = self._imdb_cache_meta.get(cache_k)
                if meta is None or (now - meta[0]) <= meta[1]:
                    return self.imdb_id_cache[cache_k]
                self.imdb_id_cache.pop(cache_k, None)
                self._imdb_cache_meta.pop(cache_k, None)

        q_str = (orig_title or title or "").strip()
        if not q_str:
            return s_id

        should_cache_miss = False
        try:
            def _fold_diacritics(val: str) -> str:
                pre = (val or "").strip().lower().translate(_LATIN_DIGRAPH_FOLD)
                nfkd = unicodedata.normalize("NFKD", pre)
                return "".join(ch for ch in nfkd if not unicodedata.combining(ch))

            def _norm_title(val: str) -> str:
                return re.sub(r"[^a-z0-9а-яё]+", " ", _fold_diacritics(val)).strip()

            q_folded = _fold_diacritics(q_str)
            ascii_slug = re.sub(r"[^a-z0-9]+", "_", q_folded).strip("_")[:60]
            has_latin = bool(re.search(r"[a-z]", q_folded))
            has_non_ascii_alpha = bool(re.search(r"[^\x00-\x7f]", q_folded))
            if ascii_slug and (has_latin or not has_non_ascii_alpha):
                first_char = ascii_slug[0]
                q_enc = ascii_slug
            else:
                first_char = "x"
                # Slice plain text BEFORE percent-encoding so multi-byte UTF-8 %XX sequences are never cut mid-byte
                q_enc = urllib.parse.quote(q_str.lower()[:28], safe="")
            sug_url = f"https://v3.sg.media-imdb.com/suggestion/{first_char}/{q_enc}.json"
            status, body, _ = self.net.request(sug_url, spoof_geo_country="DIRECT", timeout=3)
            if status in (200, 404):
                should_cache_miss = True
            if status == 200 and body:
                payload = json.loads(body)
                raw_items = payload.get("d") if isinstance(payload, dict) else []
                candidates = [
                    it
                    for it in (raw_items if isinstance(raw_items, list) else [])
                    if isinstance(it, dict) and _STRICT_IMDB_RE.fullmatch(str(it.get("id") or "").lower())
                ]
                if candidates:
                    q_norm = _norm_title(q_str)
                    alt_norm = _norm_title(title) if title and title != q_str else ""
                    ranked_matches: List[Tuple[int, Dict[str, Any]]] = []
                    for idx, c in enumerate(candidates):
                        c_title_norm = _norm_title(str(c.get("l") or ""))
                        if not c_title_norm:
                            continue
                        title_matches = c_title_norm == q_norm or (alt_norm and c_title_norm == alt_norm)
                        if not title_matches:
                            continue
                        c_qid = str(c.get("qid") or "").lower()
                        if mtype_norm == "movie":
                            if c_qid and any(
                                k in c_qid
                                for k in (
                                    "series",
                                    "tvseries",
                                    "tvminiseries",
                                    "tvepisode",
                                    "videogame",
                                    "podcast",
                                    "musicvideo",
                                )
                            ):
                                continue
                        else:
                            if c_qid and (
                                "tvmovie" in c_qid
                                or "videogame" in c_qid
                                or not any(k in c_qid for k in ("series", "tvminiseries", "tvshort", "tv"))
                            ):
                                continue
                        c_year = _safe_int(c.get("y"), 0)
                        if req_year > 1900 and c_year > 1900 and abs(c_year - req_year) > 1:
                            continue
                        # Rank exact year match highest, then +-1 year, then unknown year, preserving IMDb popularity order
                        if req_year > 1900 and c_year == req_year:
                            score = 300 - idx
                        elif req_year > 1900 and c_year > 1900:
                            score = 200 - idx
                        else:
                            score = 100 - idx
                        ranked_matches.append((score, c))
                    if ranked_matches:
                        ranked_matches.sort(key=lambda pair: pair[0], reverse=True)
                        best = ranked_matches[0][1]
                        resolved = str(best.get("id") or "").lower()
                        if _STRICT_IMDB_RE.fullmatch(resolved):
                            with self._lock:
                                if len(self.imdb_id_cache) > 512:
                                    for k_old in list(self.imdb_id_cache.keys())[:128]:
                                        self.imdb_id_cache.pop(k_old, None)
                                        self._imdb_cache_meta.pop(k_old, None)
                                self.imdb_id_cache[cache_k] = resolved
                                self._imdb_cache_meta[cache_k] = (time.time(), 86400.0)
                            return resolved
        except Exception:
            should_cache_miss = False

        fallback_out = s_id
        if should_cache_miss:
            with self._lock:
                if len(self.imdb_id_cache) > 512:
                    for k_old in list(self.imdb_id_cache.keys())[:128]:
                        self.imdb_id_cache.pop(k_old, None)
                        self._imdb_cache_meta.pop(k_old, None)
                self.imdb_id_cache[cache_k] = fallback_out
                self._imdb_cache_meta[cache_k] = (time.time(), 900.0)
        return fallback_out

    def get_skip_segments(
        self,
        imdb_id: str,
        season: int = 1,
        episode: int = 1,
        media_type: str = "series",
        title: str = "",
        orig_title: str = "",
        year: int = 0,
        lang: str = "ru",
    ) -> Dict[str, Any]:
        ui_en = str(lang or "").strip().lower().startswith("en")
        lbl_intro = "Skip Intro" if ui_en else "Пропустить заставку"
        lbl_next_ep = "Next Episode" if ui_en else "Следующая серия"
        lbl_credits = "End Credits" if ui_en else "Финальные титры"

        def _localize_seg_result(res_obj: Dict[str, Any]) -> Dict[str, Any]:
            copied = copy.deepcopy(res_obj)
            if isinstance(copied.get("intro"), dict):
                copied["intro"]["label"] = lbl_intro
            if isinstance(copied.get("outro"), dict):
                is_mov = str(copied.get("media_type") or media_type or "").lower() == "movie"
                copied["outro"]["label"] = lbl_credits if is_mov else lbl_next_ep
            return copied

        # Feature movies do not have recurring TV opening credits, but CAN have exact end-credits timestamps
        if str(media_type or "").lower() == "movie":
            resolved_movie_imdb = self.resolve_imdb_id(
                imdb_id,
                title=title,
                orig_title=orig_title,
                year=year,
                media_type="movie",
            )
            movie_cache_key = f"{resolved_movie_imdb or imdb_id}_movie"
            cached_movie = self._get_cached_segment(movie_cache_key)
            if cached_movie is not None:
                return _localize_seg_result(cached_movie)
            movie_outro: Dict[str, Any] = {
                "start_ratio": 0.95,
                "label": lbl_credits,
            }
            movie_source = "Movie (No TV Intro)"
            cacheable_movie = True
            has_exact_movie_credits = False
            if resolved_movie_imdb and _STRICT_IMDB_RE.fullmatch(resolved_movie_imdb):
                api_url = f"https://api.theintrodb.org/v3/media?imdb_id={resolved_movie_imdb}"
                status, body, _ = self.net.request(api_url, spoof_geo_country="DIRECT", timeout=3)
                if status not in (200, 404):
                    cacheable_movie = False
                if status == 200 and body:
                    try:
                        data = json.loads(body)
                        credits_list = _as_dict_list(data.get("credits") if isinstance(data, dict) else None)
                        ranked_movie_credits: List[Tuple[float, int, float]] = []
                        for cred in credits_list:
                            cv = _parse_conf_and_votes(cred)
                            if cv is None:
                                continue
                            c_start_ms = cred.get("start_ms")
                            c_end_ms = cred.get("end_ms")
                            if c_start_ms is None:
                                continue
                            st_f = float(c_start_ms)
                            if not math.isfinite(st_f):
                                continue
                            if c_end_ms is not None:
                                en_f = float(c_end_ms)
                                if not math.isfinite(en_f) or en_f <= st_f or (en_f - st_f) < 60000.0:
                                    continue
                            st_sec = round(st_f / 1000.0, 1)
                            if st_sec < 1800.0:
                                # Ignore opening credits (< 30 min) on feature films unless long late credits
                                if st_sec < 900.0 or (
                                    c_end_ms is not None and (float(c_end_ms) - st_f) <= 240000.0
                                ):
                                    continue
                            ranked_movie_credits.append((cv[0], cv[1], st_sec))
                        if ranked_movie_credits:
                            ranked_movie_credits.sort(reverse=True)
                            movie_outro["start_sec"] = ranked_movie_credits[0][2]
                            movie_source = "TheIntroDB v3 (Movie Credits)"
                            has_exact_movie_credits = True
                    except Exception:
                        pass
            movie_res = {
                "imdb_id": resolved_movie_imdb or imdb_id,
                "media_type": "movie",
                "source": movie_source,
                "intro": None,
                "outro": movie_outro,
            }
            if cacheable_movie:
                self._set_cached_segment(movie_cache_key, movie_res, positive=has_exact_movie_credits)
            return copy.deepcopy(movie_res)

        resolved_imdb_id = self.resolve_imdb_id(
            imdb_id,
            title=title,
            orig_title=orig_title,
            year=year,
            media_type="series",
        )
        s_num = max(1, _safe_int(season, 1))
        e_num = max(1, _safe_int(episode, 1))
        cache_key = f"{resolved_imdb_id or imdb_id}_s{s_num}_e{e_num}"
        cached_ep = self._get_cached_segment(cache_key)
        if cached_ep is not None:
            return _localize_seg_result(cached_ep)

        outro_data: Dict[str, Any] = {
            "start_ratio": 0.92,
            "label": lbl_next_ep,
        }
        cacheable_ep = True
        recap_bounds: Optional[Tuple[float, float]] = None

        # 1. Query live TheIntroDB v3 API for exact episode millisecond timestamps
        if resolved_imdb_id and _STRICT_IMDB_RE.fullmatch(resolved_imdb_id):
            api_url = (
                f"https://api.theintrodb.org/v3/media?imdb_id={resolved_imdb_id}"
                f"&season={s_num}&episode={e_num}"
            )
            status, body, _ = self.net.request(api_url, spoof_geo_country="DIRECT", timeout=3)
            if status not in (200, 404):
                cacheable_ep = False
            if status == 200 and body:
                try:
                    data = json.loads(body) if isinstance(body, (str, bytes, bytearray)) else {}
                    if not isinstance(data, dict):
                        data = {}

                    recap_list = _as_dict_list(data.get("recap"))
                    ranked_recaps: List[Tuple[float, int, float, float, float]] = []
                    for cand_rec in recap_list:
                        rcv = _parse_conf_and_votes(cand_rec)
                        if rcv is None or cand_rec.get("end_ms") is None:
                            continue
                        r_st = max(0.0, round(float(cand_rec.get("start_ms") or 0.0) / 1000.0, 1))
                        r_en = round(float(cand_rec["end_ms"]) / 1000.0, 1)
                        if math.isfinite(r_st) and math.isfinite(r_en) and 5.0 <= (r_en - r_st) <= 180.0 and r_st < 120.0:
                            ranked_recaps.append((rcv[0], rcv[1], r_en - r_st, r_st, r_en))
                    if ranked_recaps:
                        ranked_recaps.sort(reverse=True)
                        recap_bounds = (ranked_recaps[0][3], ranked_recaps[0][4])

                    # Parse intro candidates first so credits overlapping a cold-open intro are never mistaken for outro
                    intro_list = _as_dict_list(data.get("intro"))
                    ranked_intros: List[Tuple[float, int, float, float, float]] = []
                    for cand_intro in intro_list:
                        cv = _parse_conf_and_votes(cand_intro)
                        if cv is None:
                            continue
                        raw_start_ms = cand_intro.get("start_ms")
                        raw_end_ms = cand_intro.get("end_ms")
                        if raw_end_ms is None:
                            continue
                        start_s = max(0.0, round(float(raw_start_ms) / 1000.0, 1)) if raw_start_ms is not None else 0.0
                        end_s = round(float(raw_end_ms) / 1000.0, 1)
                        if not math.isfinite(start_s) or not math.isfinite(end_s):
                            continue
                        dur_s = end_s - start_s
                        if dur_s <= 0.0 or dur_s > 160.0:
                            continue
                        # Reject 0-14s studio bumpers near 00:00; allow short title cards (>=4.5s) after a cold open (>=25s)
                        is_real_intro = (
                            (start_s < 25.0 and dur_s >= 15.0)
                            or (start_s >= 25.0 and dur_s >= 4.5)
                        )
                        if is_real_intro:
                            ranked_intros.append((cv[0], cv[1], dur_s, start_s, end_s))
                    ranked_intros.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
                    best_intro = (ranked_intros[0][3], ranked_intros[0][4]) if ranked_intros else None
                    raw_intro_start = best_intro[0] if best_intro else None
                    if (
                        best_intro is not None
                        and recap_bounds is not None
                        and recap_bounds[0] < 30.0
                        and 0.0 <= (best_intro[0] - recap_bounds[1]) <= 3.0
                        and (best_intro[1] - recap_bounds[0]) <= 210.0
                    ):
                        best_intro = (recap_bounds[0], best_intro[1])

                    credits_list = _as_dict_list(data.get("credits"))
                    opening_credits_fallback: Optional[Tuple[float, float]] = None
                    ranked_outros: List[Tuple[float, int, float]] = []
                    for cred in credits_list:
                        cv = _parse_conf_and_votes(cred)
                        if cv is None:
                            continue
                        c_start_ms = cred.get("start_ms")
                        c_end_ms = cred.get("end_ms")
                        if c_start_ms is None:
                            continue
                        st_f = float(c_start_ms)
                        if not math.isfinite(st_f):
                            continue
                        st_s = max(0.0, round(st_f / 1000.0, 1))
                        en_s: Optional[float] = None
                        if c_end_ms is not None:
                            en_f = float(c_end_ms)
                            if not math.isfinite(en_f) or en_f <= st_f:
                                continue
                            en_s = round(en_f / 1000.0, 1)
                        if raw_intro_start is not None and abs(st_s - raw_intro_start) < 30.0:
                            continue
                        is_bounded_short = en_s is not None and 0.0 < (en_s - st_s) <= 180.0
                        if is_bounded_short and st_s < 1200.0:
                            if 15.0 <= (en_s - st_s) <= 160.0 and opening_credits_fallback is None:
                                opening_credits_fallback = (st_s, en_s)
                            continue
                        if st_s >= 600.0:
                            ranked_outros.append((cv[0], cv[1], st_s))
                    if ranked_outros:
                        ranked_outros.sort(reverse=True)
                        outro_data["start_sec"] = ranked_outros[0][2]

                    if best_intro is not None:
                        result = {
                            "imdb_id": resolved_imdb_id or imdb_id,
                            "season": s_num,
                            "episode": e_num,
                            "source": "TheIntroDB v3",
                            "cold_open_safe": True,
                            "intro": {
                                "start": best_intro[0],
                                "end": best_intro[1],
                                "label": lbl_intro,
                            },
                            "outro": outro_data,
                        }
                        if recap_bounds is not None:
                            result["recap"] = {"start": recap_bounds[0], "end": recap_bounds[1]}
                        self._set_cached_segment(cache_key, result, positive=True)
                        return _localize_seg_result(result)

                    if opening_credits_fallback:
                        result = {
                            "imdb_id": resolved_imdb_id or imdb_id,
                            "season": s_num,
                            "episode": e_num,
                            "source": "TheIntroDB v3 (Opening Credits)",
                            "cold_open_safe": True,
                            "intro": {
                                "start": opening_credits_fallback[0],
                                "end": opening_credits_fallback[1],
                                "label": lbl_intro,
                            },
                            "outro": outro_data,
                        }
                        if recap_bounds is not None:
                            result["recap"] = {"start": recap_bounds[0], "end": recap_bounds[1]}
                        self._set_cached_segment(cache_key, result, positive=True)
                        return _localize_seg_result(result)
                except Exception:
                    pass

        # 2. Check verified per-episode Cold-Open-safe table
        ep_key = (resolved_imdb_id, s_num, e_num)
        if ep_key in self.VERIFIED_EPISODE_INTROS:
            bounds = self.VERIFIED_EPISODE_INTROS[ep_key]
            if bounds is None:
                result = {
                    "imdb_id": resolved_imdb_id or imdb_id,
                    "season": s_num,
                    "episode": e_num,
                    "source": "Verified (No Intro in Pilot)",
                    "cold_open_safe": True,
                    "intro": None,
                    "outro": outro_data,
                }
            else:
                result = {
                    "imdb_id": resolved_imdb_id or imdb_id,
                    "season": s_num,
                    "episode": e_num,
                    "source": "Verified Episode Intro",
                    "cold_open_safe": True,
                    "intro": {
                        "start": bounds[0],
                        "end": bounds[1],
                        "label": lbl_intro,
                    },
                    "outro": outro_data,
                }
            if recap_bounds is not None:
                result["recap"] = {"start": recap_bounds[0], "end": recap_bounds[1]}
            if cacheable_ep:
                self._set_cached_segment(cache_key, result, positive=True)
            return _localize_seg_result(result)

        # 3. Cold-Open Protection: NEVER blindly skip static seconds at the beginning of an episode
        # if the exact timestamp for this specific episode is unknown!
        result = {
            "imdb_id": resolved_imdb_id or imdb_id,
            "season": s_num,
            "episode": e_num,
            "source": "Cold-Open Protected (No Blind Skip)",
            "cold_open_safe": True,
            "intro": None,
            "outro": outro_data,
        }
        if recap_bounds is not None:
            result["recap"] = {"start": recap_bounds[0], "end": recap_bounds[1]}
        if cacheable_ep:
            self._set_cached_segment(cache_key, result, positive=bool("start_sec" in outro_data or recap_bounds))
        return copy.deepcopy(result)

    @staticmethod
    def get_webview_cinema_userscript() -> str:
        return """
        (function() {
            const SKIP_SELECTORS = [
                '[data-uia="player-skip-intro"]',
                '[data-uia="player-skip-recap"]',
                '.atvwebplayersdk-skipelement-button',
                '.skip__button',
                '[data-testid="skip-button"]',
                'button[aria-label*="Pomiń"]',
                'button[aria-label*="Skip Intro"]'
            ];
            setInterval(() => {
                for (const sel of SKIP_SELECTORS) {
                    const btn = document.querySelector(sel);
                    if (btn && (btn.offsetParent !== null || btn.getClientRects().length > 0)) {
                        btn.click();
                    }
                }
            }, 1500);
        })();
        """
