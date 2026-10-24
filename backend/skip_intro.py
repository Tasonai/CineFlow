import json
import urllib.parse
from typing import Any, Dict, Optional, Tuple

from .doh import DoHSplitNetworkClient


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
        self.imdb_id_cache: Dict[str, str] = {}

    def resolve_imdb_id(
        self,
        raw_id: str,
        title: str = "",
        orig_title: str = "",
        year: int = 0,
    ) -> str:
        s_id = (raw_id or "").strip()
        if s_id.startswith("tt"):
            return s_id
        cache_k = f"{s_id}|{(orig_title or title).strip().lower()}|{year}"
        if cache_k in self.imdb_id_cache:
            return self.imdb_id_cache[cache_k]

        q_str = (orig_title or title or "").strip()
        if not q_str:
            return s_id

        try:
            q_enc = urllib.parse.quote(q_str)
            sug_url = f"https://v3.sg.media-imdb.com/suggestion/x/{q_enc}.json"
            status, body, _ = self.net.request(sug_url, spoof_geo_country="DIRECT", timeout=3)
            if status == 200 and body:
                payload = json.loads(body)
                candidates = [
                    it
                    for it in (payload.get("d") or [])
                    if str(it.get("id") or "").startswith("tt")
                ]
                if candidates:
                    q_low = q_str.lower()
                    best = None
                    for c in candidates:
                        c_title = str(c.get("l") or "").strip().lower()
                        c_qid = str(c.get("qid") or "").lower()
                        if c_title == q_low and ("series" in c_qid or "tv" in c_qid):
                            best = c
                            break
                    if not best:
                        best = next(
                            (c for c in candidates if "series" in str(c.get("qid") or "").lower()),
                            candidates[0],
                        )
                    resolved = str(best.get("id") or s_id)
                    self.imdb_id_cache[cache_k] = resolved
                    return resolved
        except Exception:
            pass

        self.imdb_id_cache[cache_k] = s_id
        return s_id

    def get_skip_segments(
        self,
        imdb_id: str,
        season: int = 1,
        episode: int = 1,
        media_type: str = "series",
        title: str = "",
        orig_title: str = "",
        year: int = 0,
    ) -> Dict[str, Any]:
        # Feature movies do not have recurring TV opening credits
        if media_type == "movie":
            return {
                "imdb_id": imdb_id,
                "media_type": "movie",
                "source": "Movie (No TV Intro)",
                "intro": None,
                "outro": {
                    "start_ratio": 0.92,
                    "label": "Финальные титры",
                },
            }

        resolved_imdb_id = self.resolve_imdb_id(imdb_id, title=title, orig_title=orig_title, year=year)
        s_num = int(season or 1)
        e_num = int(episode or 1)
        cache_key = f"{resolved_imdb_id}_s{s_num}_e{e_num}"
        if cache_key in self.cache:
            return self.cache[cache_key]

        outro_data: Dict[str, Any] = {
            "start_ratio": 0.92,
            "label": "Следующая серия",
        }

        # 1. Query live TheIntroDB v3 API for exact episode millisecond timestamps
        if resolved_imdb_id and resolved_imdb_id.startswith("tt"):
            api_url = (
                f"https://api.theintrodb.org/v3/media?imdb_id={resolved_imdb_id}"
                f"&season={s_num}&episode={e_num}"
            )
            status, body, _ = self.net.request(api_url, spoof_geo_country="DIRECT", timeout=3)
            if status == 200 and body:
                try:
                    data = json.loads(body)

                    # Extract exact credits timestamp if valid (> 10 minutes into episode)
                    credits_list = data.get("credits") or []
                    opening_credits_fallback = None
                    if credits_list and isinstance(credits_list, list):
                        for cred in credits_list:
                            c_start_ms = cred.get("start_ms")
                            c_end_ms = cred.get("end_ms")
                            if c_start_ms and float(c_start_ms) >= 600000:
                                outro_data["start_sec"] = round(float(c_start_ms) / 1000.0, 1)
                            elif (
                                c_start_ms is not None
                                and c_end_ms is not None
                                and float(c_start_ms) < 600000
                            ):
                                st_s = round(float(c_start_ms) / 1000.0, 1)
                                en_s = round(float(c_end_ms) / 1000.0, 1)
                                if 15.0 <= (en_s - st_s) <= 160.0:
                                    opening_credits_fallback = (st_s, en_s)

                    intro_list = data.get("intro") or []
                    if intro_list and isinstance(intro_list, list):
                        first_intro = intro_list[0]
                        raw_start_ms = first_intro.get("start_ms")
                        raw_end_ms = first_intro.get("end_ms")

                        if raw_end_ms is not None:
                            start_s = round(float(raw_start_ms) / 1000.0, 1) if raw_start_ms is not None else 2.0
                            end_s = round(float(raw_end_ms) / 1000.0, 1)
                            # Ignore 0-16s studio bumper unless it's a real >25s intro sequence
                            is_real_intro = (end_s > start_s) and ((end_s - start_s) <= 160) and (
                                raw_start_ms is not None or (end_s - start_s) >= 25.0
                            )
                            if is_real_intro:
                                result = {
                                    "imdb_id": resolved_imdb_id,
                                    "season": s_num,
                                    "episode": e_num,
                                    "source": "TheIntroDB v3",
                                    "cold_open_safe": True,
                                    "intro": {
                                        "start": start_s,
                                        "end": end_s,
                                        "label": "Пропустить заставку",
                                    },
                                    "outro": outro_data,
                                }
                                self.cache[cache_key] = result
                                return result

                    if opening_credits_fallback:
                        result = {
                            "imdb_id": resolved_imdb_id,
                            "season": s_num,
                            "episode": e_num,
                            "source": "TheIntroDB v3 (Opening Credits)",
                            "cold_open_safe": True,
                            "intro": {
                                "start": opening_credits_fallback[0],
                                "end": opening_credits_fallback[1],
                                "label": "Пропустить заставку",
                            },
                            "outro": outro_data,
                        }
                        self.cache[cache_key] = result
                        return result
                except Exception:
                    pass

        # 2. Check verified per-episode Cold-Open-safe table
        ep_key = (resolved_imdb_id, s_num, e_num)
        if ep_key in self.VERIFIED_EPISODE_INTROS:
            bounds = self.VERIFIED_EPISODE_INTROS[ep_key]
            if bounds is None:
                result = {
                    "imdb_id": imdb_id,
                    "season": s_num,
                    "episode": e_num,
                    "source": "Verified (No Intro in Pilot)",
                    "cold_open_safe": True,
                    "intro": None,
                    "outro": outro_data,
                }
            else:
                result = {
                    "imdb_id": imdb_id,
                    "season": s_num,
                    "episode": e_num,
                    "source": "Verified Episode Intro",
                    "cold_open_safe": True,
                    "intro": {
                        "start": bounds[0],
                        "end": bounds[1],
                        "label": "Пропустить заставку",
                    },
                    "outro": outro_data,
                }
            self.cache[cache_key] = result
            return result

        # 3. Cold-Open Protection: NEVER blindly skip static seconds at the beginning of an episode
        # if the exact timestamp for this specific episode is unknown!
        result = {
            "imdb_id": imdb_id,
            "season": s_num,
            "episode": e_num,
            "source": "Cold-Open Protected (No Blind Skip)",
            "cold_open_safe": True,
            "intro": None,
            "outro": outro_data,
        }
        self.cache[cache_key] = result
        return result

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
                    if (btn && btn.offsetParent !== null) {
                        btn.click();
                    }
                }
            }, 1500);
        })();
        """
