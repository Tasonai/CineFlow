import base64
import html
import json
import re
import time
import urllib.parse
import urllib.request
from itertools import product
from typing import Any, Dict, List, Optional, Tuple

from .doh import DoHSplitNetworkClient
from .en_metadata import _names_match_ru_en, has_cyrillic


class HDRezkaClient:
    """
    Live HDRezka Parser, Anubis PoW Solver, Split-Proxy Bypasser, and Stream Extractor.
    Automatically bypasses HDRezka without registration and filters out the 15-second
    'HD REZKA PREMIUM' QR-code stub video (/1/5/3/6/4/2/4/zrkms.mp4) returned on
    unauthenticated '1080p Ultra' tracks, selecting the full-length 1080p stream instead.
    """

    DEFAULT_MIRRORS = [
        "https://hdrezka-home.tv",
        "https://hdrezka.ag",
        "https://rezka.ag",
        "https://hdrezka.me",
    ]

    TRASH_CHARS = ["@", "#", "!", "^", "$"]

    # Known HDRezka Premium QR-code promo stub filenames/paths served to unauthenticated users on "Ultra"
    PREMIUM_STUB_PATTERNS = (
        "/1/5/3/6/4/2/4/",
        "zrkms.mp4",
        "premium",
    )

    def __init__(self, net_client: DoHSplitNetworkClient):
        self.net = net_client
        self.custom_mirror: str = ""
        self.proxy_url: str = ""
        self.cf_worker_relay: str = ""
        self.spoof_region: str = "KZ"
        self.preferred_studios: List[str] = [
            "HDrezka Studio",
            "Кубик в Кубе",
            "Red Head Sound",
            "TVShows",
            "Дубляж",
            "LostFilm",
            "Оригинал",
        ]
        self.page_cache: Dict[str, Dict[str, Any]] = {}
        self.trailer_cache: Dict[str, Dict[str, Any]] = {}
        self.search_cache: Dict[str, List[Dict[str, Any]]] = {}
        self.person_url_by_name: Dict[str, str] = {}
        self.person_photo_by_name: Dict[str, str] = {}
        self.person_profile_cache: Dict[str, Dict[str, Any]] = {}

    def configure(
        self,
        custom_mirror: Optional[str] = None,
        proxy_url: Optional[str] = None,
        cf_worker_relay: Optional[str] = None,
        spoof_region: Optional[str] = None,
        preferred_studios: Optional[List[str]] = None,
    ):
        if custom_mirror is not None:
            self.custom_mirror = custom_mirror.strip().rstrip("/")
        if proxy_url is not None:
            self.proxy_url = proxy_url.strip()
        if cf_worker_relay is not None:
            self.cf_worker_relay = cf_worker_relay.strip()
        if spoof_region is not None:
            self.spoof_region = spoof_region.strip()
        if preferred_studios is not None:
            self.preferred_studios = preferred_studios

    def get_mirrors(self) -> List[str]:
        mirrors = []
        if self.custom_mirror:
            m = self.custom_mirror
            if not m.startswith("http"):
                m = "https://" + m
            mirrors.append(m.rstrip("/"))
        for m in self.DEFAULT_MIRRORS:
            if m not in mirrors:
                mirrors.append(m)
        return mirrors

    @classmethod
    def decode_rezka_stream_url(cls, raw_stream: str) -> Dict[str, str]:
        """
        Parses HDRezka stream string and automatically removes HDRezka Premium QR-code
        stub videos ('1080p Ultra' -> '/1/5/3/6/4/2/4/zrkms.mp4') so playback works
        100% free without registration in full 1080p.
        """
        if not raw_stream:
            return {}

        text = raw_stream.strip().replace("\\/", "/")

        if (text.startswith("#h") or text.startswith("#2")) and "[" not in text[:15]:
            body = text[2:]
            cleaned = "".join(body.split("//_//"))
            for length in (3, 2):
                for comb in product(cls.TRASH_CHARS, repeat=length):
                    token_str = "".join(comb)
                    b64_token = base64.b64encode(token_str.encode("ascii")).decode("ascii")
                    cleaned = cleaned.replace(b64_token, "")
            padding = len(cleaned) % 4
            if padding:
                cleaned += "=" * (4 - padding)
            try:
                text = base64.b64decode(cleaned).decode("utf-8", errors="ignore").replace("\\/", "/")
            except Exception:
                pass

        streams: Dict[str, str] = {}
        chunks = re.split(r",(?=\[)", text)
        for chunk in chunks:
            m = re.match(r"\[([^\]]+)\](.+)", chunk.strip())
            if not m:
                continue
            raw_quality, urls_str = m.groups()
            clean_quality = re.sub(r"<[^>]+>", "", raw_quality).strip()

            # Skip paid 'Ultra' / '2K' / '4K' tags when they contain HTML <span class="p-info">
            # because HDRezka serves a 15-sec QR code stub on those without a paid account
            if "ultra" in clean_quality.lower() or "<span" in raw_quality.lower():
                continue

            candidates = [u.strip() for u in urls_str.split(" or ") if u.strip().startswith("http")]
            if not candidates:
                continue

            mp4_urls = [u for u in candidates if not u.endswith(".m3u8")]
            chosen = mp4_urls[0] if mp4_urls else candidates[0]

            # Filter out known Premium QR stub URLs
            if any(pat in chosen.lower() for pat in cls.PREMIUM_STUB_PATTERNS):
                continue

            streams[clean_quality] = chosen

        # Reverse order so 1080p is first
        ordered_keys = list(streams.keys())[::-1]
        return {k: streams[k] for k in ordered_keys}

    @staticmethod
    def parse_subtitles(subtitle_str: Any) -> List[Dict[str, str]]:
        if not subtitle_str or subtitle_str is False:
            return []
        subs = []
        text = str(subtitle_str).replace("\\/", "/")
        for match in re.finditer(r"\[([^\]]+)\](https?://[^\s,]+)", text):
            subs.append({"lang": match.group(1).strip(), "url": match.group(2).strip()})
        return subs

    def search_live(self, query: str) -> List[Dict[str, Any]]:
        q_norm = (query or "").strip().lower()
        if not q_norm:
            return []
        if q_norm in self.search_cache:
            return self.search_cache[q_norm]
        results: List[Dict[str, Any]] = []
        seen_rezka_ids = set()
        encoded_q = urllib.parse.quote(query.strip())

        item_pattern = re.compile(
            r'<div class="b-content__inline_item"[^>]*data-id="(\d+)"[^>]*data-url="([^"]+)"[^>]*>.*?'
            r'<img src="([^"]+)"[^>]*>.*?'
            r'<div class="b-content__inline_item-link">\s*<a[^>]*>([^<]+)</a>\s*<div[^>]*>([^<]*)</div>',
            re.S,
        )

        # If query matches a known director/actor name from a viewed movie/series, fetch their filmography page directly
        person_url = self.person_url_by_name.get(q_norm)
        if person_url:
            status, body, resp_headers = self.net.request(
                person_url,
                proxy_url=self.proxy_url,
                cf_worker_relay=self.cf_worker_relay,
                spoof_geo_country=self.spoof_region,
                timeout=8,
            )
            if status == 200 and "b-content__inline_item" in body:
                final_mirror = "/".join(resp_headers.get("_final_url", person_url).split("/")[:3])
                for m in item_pattern.finditer(body):
                    rezka_id, item_url, poster, title, info = m.groups()
                    if rezka_id in seen_rezka_ids:
                        continue
                    seen_rezka_ids.add(rezka_id)
                    if not item_url.startswith("http"):
                        item_url = final_mirror + item_url
                    if not poster.startswith("http"):
                        poster = final_mirror + poster
                    results.append(
                        {
                            "rezka_id": rezka_id,
                            "url": item_url,
                            "poster": poster,
                            "title": html.unescape(title.strip()),
                            "info": html.unescape(info.strip()),
                            "mirror": final_mirror,
                        }
                    )
                if results:
                    self.search_cache[q_norm] = results
                    return results

        for mirror in self.get_mirrors()[:2]:
            search_url = f"{mirror}/search/?do=search&subaction=search&q={encoded_q}"
            status, body, resp_headers = self.net.request(
                search_url,
                headers={"Referer": f"{mirror}/"},
                proxy_url=self.proxy_url,
                cf_worker_relay=self.cf_worker_relay,
                spoof_geo_country=self.spoof_region,
                timeout=8,
            )
            if status == 200 and "b-content__inline_item" in body:
                final_mirror = "/".join(resp_headers.get("_final_url", search_url).split("/")[:3])
                for m in item_pattern.finditer(body):
                    rezka_id, item_url, poster, title, info = m.groups()
                    if rezka_id in seen_rezka_ids:
                        continue
                    seen_rezka_ids.add(rezka_id)
                    if not item_url.startswith("http"):
                        item_url = final_mirror + item_url
                    if not poster.startswith("http"):
                        poster = final_mirror + poster
                    results.append(
                        {
                            "rezka_id": rezka_id,
                            "url": item_url,
                            "poster": poster,
                            "title": html.unescape(title.strip()),
                            "info": html.unescape(info.strip()),
                            "mirror": final_mirror,
                        }
                    )
                if results:
                    break
        if results:
            self.search_cache[q_norm] = results
        return results

    def _resolve_page_metadata(
        self,
        numeric_id: str,
        title: str,
        orig_title: str,
        rezka_url: Optional[str],
        year: int = 2024,
        media_type: str = "movie",
    ) -> Dict[str, Any]:
        cache_key = numeric_id or rezka_url or f"{title}|{orig_title}|{year}|{media_type}"
        if cache_key in self.page_cache:
            return self.page_cache[cache_key]

        target_url = rezka_url
        page_html = ""
        resp_headers: Dict[str, Any] = {}
        status = 0

        if target_url and target_url.startswith("http"):
            status, page_html, resp_headers = self.net.request(
                target_url,
                proxy_url=self.proxy_url,
                cf_worker_relay=self.cf_worker_relay,
                spoof_geo_country=self.spoof_region,
                timeout=8,
            )

        # If target_url was missing or returned a stale slug without initCDN player initialization,
        # resolve the live URL via search_live
        if status != 200 or not page_html or "initCDN" not in page_html:
            def _norm_cmp(s: str) -> str:
                x = (s or "").strip().lower().replace("ё", "е").replace("–", "-").replace("—", "-")
                x = re.sub(r"[^\w\s]", " ", x)
                return re.sub(r"\s+", " ", x).strip()

            t_norm = _norm_cmp(title)
            o_norm = _norm_cmp(orig_title)

            def _score_candidate(cand: Dict[str, Any]) -> int:
                sc = 0
                if numeric_id and cand.get("rezka_id") == str(numeric_id):
                    sc += 200
                ct = _norm_cmp(cand.get("title") or "")
                cinfo = (cand.get("info") or "").lower()
                cinfo_norm = _norm_cmp(cinfo)
                curl = (cand.get("url") or "").lower()
                if t_norm and ct == t_norm:
                    sc += 45
                elif o_norm and ct == o_norm:
                    sc += 40
                elif t_norm and t_norm in ct:
                    sc += 18
                elif o_norm and o_norm in ct:
                    sc += 18
                if o_norm and len(o_norm) >= 3 and o_norm in cinfo_norm:
                    sc += 25
                if media_type == "series":
                    if "/series/" in curl or "/cartoons/" in curl or "/animation/" in curl or "сериал" in cinfo:
                        sc += 30
                else:
                    if "/films/" in curl or "/cartoons/" in curl or "/animation/" in curl:
                        sc += 30
                if year:
                    if str(year) in cinfo:
                        sc += 35
                    elif str(year - 1) in cinfo or str(year + 1) in cinfo:
                        sc += 20
                return sc

            found = list(self.search_live(title or orig_title))
            best_initial_score = max((_score_candidate(c) for c in found), default=0)
            need_orig_search = (
                not found
                or (numeric_id and not any(f["rezka_id"] == numeric_id for f in found))
                or best_initial_score < 65
            )
            if need_orig_search and orig_title and orig_title != title:
                found_orig = self.search_live(orig_title)
                if found_orig:
                    seen_rids = {f["rezka_id"] for f in found}
                    for fo in found_orig:
                        if fo["rezka_id"] not in seen_rids:
                            found.append(fo)
                            seen_rids.add(fo["rezka_id"])
            if found:
                best = max(found, key=_score_candidate)
                numeric_id = best["rezka_id"]
                target_url = best["url"]
                status, page_html, resp_headers = self.net.request(
                    target_url,
                    proxy_url=self.proxy_url,
                    cf_worker_relay=self.cf_worker_relay,
                    spoof_geo_country=self.spoof_region,
                    timeout=8,
                )

        if status != 200 or not page_html:
            return {}

        final_url = resp_headers.get("_final_url", target_url)
        mirror = "/".join(final_url.split("/")[:3])

        country_text = ""
        trans_info_text = ""
        m_country = re.search(
            r'<td class="l">\s*<h2>\s*Страна\s*</h2>\s*:?\s*</td>\s*<td>(.*?)</td>',
            page_html,
            re.S | re.I,
        )
        if m_country:
            country_text = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m_country.group(1)))).strip()
        m_trans_info = re.search(
            r'<td class="l">\s*<h2>\s*В переводе\s*</h2>\s*:?\s*</td>\s*<td>(.*?)</td>',
            page_html,
            re.S | re.I,
        )
        if m_trans_info:
            trans_info_text = html.unescape(
                re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m_trans_info.group(1)))
            ).strip()

        country_low = country_text.lower()
        is_russian_native = bool(
            ("россия" in country_low or "ссср" in country_low or "беларусь" in country_low)
            and not any(k in country_low for k in ("сша", "великобритания", "франция", "германия", "канада", "япония", "корея"))
            and not bool(orig_title and re.search(r"[A-Za-z]", orig_title))
        )

        studios: List[Dict[str, Any]] = []
        seen_tr = set()
        for tr_m in re.finditer(
            r'<(?:li|a|option)([^>]*data-translator_id="(\d+)"[^>]*)>(.*?)</(?:li|a|option)>',
            page_html,
            re.S,
        ):
            li_attrs, tr_id, tr_inner_html = tr_m.groups()
            if tr_id in seen_tr:
                continue
            m_flag = re.search(r'<img[^>]*title="([^"]+)"', tr_inner_html, re.I)
            flag_lang = html.unescape(m_flag.group(1).strip()) if m_flag else ""
            clean_name = re.sub(r"<[^>]+>", " ", tr_inner_html)
            clean_name = html.unescape(re.sub(r"\s+", " ", clean_name)).strip()
            if not clean_name:
                m_title_attr = re.search(r'title="([^"]+)"', li_attrs)
                if m_title_attr:
                    clean_name = html.unescape(m_title_attr.group(1).strip())
            if not clean_name:
                continue

            low_name = clean_name.lower()
            is_orig = bool(
                tr_id == "238"
                or "оригинал" in low_name
                or "original" in low_name
                or ("субтитр" in low_name and "укр" not in low_name)
            )
            is_prem = bool("b-prem_translator" in li_attrs or "prem_translator" in li_attrs)

            # Skip paid 'b-prem_translator' dub entries that only serve the 15s Premium QR code stub,
            # EXCEPT NEVER hide Original audio ('Оригинал') — keep it visible and resolve stream fallback if locked!
            if is_prem and not is_orig:
                continue

            if flag_lang and "укр" in flag_lang.lower() and "укр" not in low_name:
                clean_name = f"{clean_name} (Украинский)"

            if is_orig and "оригинал" not in low_name:
                clean_name = f"Оригинал ({clean_name})"

            seen_tr.add(tr_id)
            studios.append(
                {
                    "id": tr_id,
                    "name": clean_name,
                    "lang": "EN" if is_orig else ("UA" if "укр" in clean_name.lower() else "RU"),
                    "is_original": is_orig,
                    "is_prem_locked": is_prem,
                    "badge": "Оригинал · 1080p" if is_orig else "1080p Full HD",
                }
            )

        default_tr_m = re.search(r"initCDN(Series|Movies)Events\(\s*(\d+)\s*,\s*(\d+)", page_html)
        cdn_event_kind = default_tr_m.group(1) if default_tr_m else ""
        page_rezka_id = default_tr_m.group(2) if default_tr_m else numeric_id
        raw_default_tr_id = default_tr_m.group(3) if default_tr_m else (studios[0]["id"] if studios else "111")

        if not studios:
            trans_low = trans_info_text.lower()
            if raw_default_tr_id == "238" or "оригинал" in trans_low or "субтитр" in trans_low:
                studios = [
                    {
                        "id": raw_default_tr_id,
                        "name": "Оригинал (+субтитры)",
                        "lang": "EN",
                        "is_original": True,
                        "is_prem_locked": False,
                        "badge": "Оригинал · 1080p",
                    }
                ]
            elif is_russian_native:
                studios = [
                    {
                        "id": raw_default_tr_id,
                        "name": "Оригинал (Русская дорожка)",
                        "lang": "RU",
                        "is_original": True,
                        "is_prem_locked": False,
                        "badge": "Оригинал · 1080p",
                    }
                ]
            else:
                studios = [
                    {
                        "id": raw_default_tr_id,
                        "name": trans_info_text or "Профессиональный перевод (HDRezka)",
                        "lang": "RU",
                        "is_original": False,
                        "is_prem_locked": False,
                        "badge": "1080p",
                    }
                ]

        # Guarantee 'Оригинал' always appears in HDRezka voiceovers list
        if not any(s.get("is_original") for s in studios):
            if is_russian_native and studios:
                studios[0]["is_original"] = True
                if "оригинал" not in studios[0]["name"].lower():
                    studios[0]["name"] = f"Оригинал ({studios[0]['name']})"
            else:
                studios.append(
                    {
                        "id": "238",
                        "name": "Оригинал (+субтитры)",
                        "lang": "EN",
                        "is_original": True,
                        "is_prem_locked": True,
                        "badge": "Оригинал · 1080p",
                    }
                )

        # Pin 'Оригинал' at the very top of the studios list so it is always immediately visible
        studios.sort(key=lambda s: (0 if s.get("is_original") else 1))

        # If the page's default translator was a paid b-prem_translator, select the first free non-locked translator
        free_studios = [s for s in studios if not s.get("is_prem_locked")]
        if studios and not any(s["id"] == raw_default_tr_id and not s.get("is_prem_locked") for s in studios):
            ru_free = [s for s in free_studios if not s.get("is_original")]
            if ru_free:
                default_tr_id = ru_free[0]["id"]
            elif free_studios:
                default_tr_id = free_studios[0]["id"]
            else:
                default_tr_id = studios[0]["id"]
        else:
            default_tr_id = raw_default_tr_id

        inline_streams = {}
        m_streams = re.search(r'"streams"\s*:\s*"([^"]+)"', page_html)
        if m_streams:
            inline_streams = self.decode_rezka_stream_url(m_streams.group(1))

        inline_subs = []
        m_subs = re.search(r'"subtitle"\s*:\s*"([^"]+)"', page_html)
        if m_subs:
            inline_subs = self.parse_subtitles(m_subs.group(1))

        # Extract real seasons & episodes map + schedule episode titles from page_html
        seasons_map: Dict[str, List[int]] = {}
        episodes_titles: Dict[str, Dict[str, str]] = {}
        episodes_meta: Dict[str, Dict[str, Dict[str, str]]] = {}
        for s_str, e_str, ep_label in re.findall(
            r'data-season_id="(\d+)"[^>]*data-episode_id="(\d+)"[^>]*>([^<]*)</', page_html
        ):
            ep_num = int(e_str)
            if ep_num >= 1:
                seasons_map.setdefault(s_str, []).append(ep_num)
                clean_lbl = html.unescape(ep_label.strip())
                if clean_lbl:
                    episodes_titles.setdefault(s_str, {})[str(ep_num)] = clean_lbl
        if not seasons_map:
            for s_str, e_str in re.findall(r'data-season_id="(\d+)"[^>]*data-episode_id="(\d+)"', page_html):
                ep_num = int(e_str)
                if ep_num >= 1:
                    seasons_map.setdefault(s_str, []).append(ep_num)

        # Parse full HDRezka episode schedule table (<table class="b-post__schedule_table">)
        # for real Russian/original episode titles, air dates, and earlier released seasons
        schedule_rows = re.findall(
            r'<tr[^>]*>\s*<td class="td-1"[^>]*>\s*(\d+)\s*сезон\s*(\d+)\s*серия\s*</td>\s*'
            r'<td class="td-2">\s*(?:<b>(.*?)</b>)?(?:\s*<br\s*/?>\s*<span>(.*?)</span>)?\s*</td>\s*'
            r'<td class="td-3">.*?</td>\s*<td class="td-4">(.*?)</td>\s*<td class="td-5">(.*?)</td>',
            page_html,
            re.S,
        )
        unreleased_schedule_count = 0
        for s_str, e_str, raw_b, raw_span, raw_date, raw_td5 in schedule_rows:
            ep_num = int(e_str)
            if ep_num < 1:
                continue
            b_title = html.unescape(re.sub(r"<[^>]+>", "", raw_b or "")).strip()
            orig_ep = html.unescape(re.sub(r"<[^>]+>", "", raw_span or "")).strip()
            air_date = html.unescape(re.sub(r"<[^>]+>", "", raw_date or "")).strip()
            if "exists-episode" in (raw_td5 or ""):
                seasons_map.setdefault(s_str, []).append(ep_num)
            else:
                unreleased_schedule_count += 1
            if b_title and not re.match(r"^(?:серия|эпизод|episode)\s*\d+$", b_title, re.I):
                episodes_titles.setdefault(s_str, {})[str(ep_num)] = b_title
            elif orig_ep and not re.match(r"^(?:серия|эпизод|episode)\s*\d+$", orig_ep, re.I):
                episodes_titles.setdefault(s_str, {})[str(ep_num)] = orig_ep
            if b_title or orig_ep or air_date:
                episodes_meta.setdefault(s_str, {})[str(ep_num)] = {
                    "title": b_title,
                    "orig_title": orig_ep if orig_ep.lower() != b_title.lower() else "",
                    "air_date": air_date,
                }

        for s_str in list(seasons_map.keys()):
            seasons_map[s_str] = sorted(set(seasons_map[s_str]))

        latest_season = 1
        latest_episode = 1
        if seasons_map:
            s_nums = [int(k) for k in seasons_map.keys() if k.isdigit()]
            if s_nums:
                latest_season = max(s_nums)
                ep_list = seasons_map.get(str(latest_season)) or [1]
                latest_episode = max(ep_list) if ep_list else 1

        # Extract full Russian plot synopsis from <div class="b-post__description_text">
        description = ""
        m_desc = re.search(r'<div class="b-post__description_text">\s*(.*?)\s*</div>', page_html, re.S)
        if m_desc:
            raw_desc = re.sub(r"<[^>]+>", " ", m_desc.group(1))
            description = html.unescape(re.sub(r"\s+", " ", raw_desc)).strip()

        # Extract directors, cast (actors), photos, and duration from page_html
        def _norm_photo(raw_p: str) -> str:
            p = (raw_p or "").strip()
            if not p or p.lower() in ("null", "none") or "nopersonphoto" in p.lower():
                return ""
            m_i = re.search(r"(/i/\d+/\d+/\d+/[^\s\"']+)", p)
            if m_i:
                return f"{mirror.rstrip('/')}{m_i.group(1)}"
            if p.startswith("//"):
                return "https:" + p
            return p

        directors: List[str] = []
        actors: List[str] = []
        cast_people: List[Dict[str, Any]] = []
        seen_people = set()

        for span_attrs, inner_html in re.findall(
            r'<span([^>]*class="[^"]*person-name-item[^"]*"[^>]*)>(.*?)</span>\s*(?:</a>\s*)?</span>',
            page_html,
            re.S,
        ):
            m_name = re.search(r'itemprop="name"[^>]*>([^<]+)', inner_html)
            if not m_name:
                m_name = re.search(r">([^<>]+)$", inner_html.strip())
            if not m_name:
                continue
            p_name = html.unescape(m_name.group(1).strip())
            if not p_name:
                continue
            person_full_url = ""
            m_href = re.search(r'href="([^"]+)"', inner_html)
            if m_href:
                href_val = m_href.group(1)
                person_full_url = href_val if href_val.startswith("http") else (mirror + href_val)
                self.person_url_by_name[p_name.lower()] = person_full_url
            m_photo = re.search(r'data-photo="([^"]*)"', span_attrs)
            photo_url = _norm_photo(m_photo.group(1) if m_photo else "")
            if photo_url:
                self.person_photo_by_name[p_name.lower()] = photo_url

            m_job = re.search(r'data-job="([^"]*)"', span_attrs)
            job_raw = html.unescape(m_job.group(1).strip()) if m_job else ""
            is_dir = 'itemprop="director"' in span_attrs or "режисс" in job_raw.lower()
            is_act = 'itemprop="actor"' in span_attrs or "актер" in job_raw.lower() or "актрис" in job_raw.lower()

            if is_dir and p_name not in directors:
                directors.append(p_name)
            elif is_act and p_name not in actors:
                actors.append(p_name)

            if (is_dir or is_act) and p_name.lower() not in seen_people:
                seen_people.add(p_name.lower())
                cast_people.append(
                    {
                        "name": p_name,
                        "role": "Режиссёр" if is_dir else (job_raw or "В ролях"),
                        "is_director": is_dir,
                        "photo": photo_url,
                        "person_url": person_full_url,
                    }
                )

        if not directors:
            for p_url, d_name in re.findall(
                r'itemprop="director"[^>]*>.*?(?:<a[^>]*href="([^"]+)"[^>]*>\s*)?<span[^>]*itemprop="name"[^>]*>([^<]+)</span>',
                page_html,
                re.S,
            ):
                dn = html.unescape(d_name.strip())
                if dn and dn not in directors:
                    directors.append(dn)
                    if p_url:
                        self.person_url_by_name[dn.lower()] = p_url if p_url.startswith("http") else (mirror + p_url)

        if not actors:
            for p_url, a_name in re.findall(
                r'itemprop="actor"[^>]*>.*?(?:<a[^>]*href="([^"]+)"[^>]*>\s*)?<span[^>]*itemprop="name"[^>]*>([^<]+)</span>',
                page_html,
                re.S,
            ):
                an = html.unescape(a_name.strip())
                if an and an not in actors:
                    actors.append(an)
                    if p_url:
                        self.person_url_by_name[an.lower()] = p_url if p_url.startswith("http") else (mirror + p_url)

        duration_label = ""
        m_dur = re.search(r'<td[^>]*itemprop="duration"[^>]*>([^<]+)</td>', page_html)
        if m_dur:
            duration_label = html.unescape(m_dur.group(1).strip())

        player_kind = (
            "series"
            if (cdn_event_kind == "Series" or bool(seasons_map))
            else ("movie" if cdn_event_kind == "Movies" else media_type)
        )

        series_status_text = ""
        m_infolast = re.search(r'<div class="b-post__infolast"[^>]*>\s*(.*?)\s*</div>', page_html, re.S)
        if m_infolast:
            raw_infolast = re.sub(r"<[^>]+>", " ", m_infolast.group(1))
            series_status_text = html.unescape(re.sub(r"\s+", " ", raw_infolast)).strip()

        has_season_only_marker = bool(re.search(r"\d+\s*(?:-\s*[йя]|сезон)?\s*сезон\s+заверш", series_status_text, re.I))
        is_completed = bool(
            player_kind == "series"
            and seasons_map
            and unreleased_schedule_count == 0
            and not has_season_only_marker
            and re.search(r"(?:завершен|завершён|закрыт)", series_status_text, re.I)
        )

        meta = {
            "rezka_id": page_rezka_id,
            "rezka_url": final_url,
            "mirror": mirror,
            "player_kind": player_kind,
            "raw_default_tr_id": raw_default_tr_id,
            "default_tr_id": default_tr_id,
            "studios": studios,
            "inline_streams": inline_streams,
            "inline_subs": inline_subs,
            "seasons_map": seasons_map,
            "episodes_titles": episodes_titles,
            "episodes_meta": episodes_meta,
            "latest_season": latest_season,
            "latest_episode": latest_episode,
            "is_completed": is_completed,
            "series_status_text": series_status_text,
            "description": description,
            "directors": directors[:4],
            "actors": actors[:10],
            "cast_people": cast_people[:14],
            "duration_label": duration_label,
        }
        if default_tr_m or inline_streams or seasons_map:
            self.page_cache[cache_key] = meta
        return meta

    def _fetch_ajax_streams(
        self,
        used_mirror: str,
        resolved_id: str,
        resolved_url: str,
        tr_id: str,
        media_type: str,
        season: int,
        episode: int,
    ) -> Tuple[Dict[str, str], List[Dict[str, str]]]:
        ajax_url = f"{used_mirror}/ajax/get_cdn_series/?t={int(time.time() * 1000)}"
        post_params = {
            "id": resolved_id,
            "translator_id": str(tr_id),
            "action": "get_stream" if media_type == "series" else "get_movie",
        }
        if media_type == "series":
            post_params["season"] = str(season)
            post_params["episode"] = str(episode)

        encoded_data = urllib.parse.urlencode(post_params).encode("utf-8")
        status, body, _ = self.net.request(
            ajax_url,
            method="POST",
            data=encoded_data,
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Origin": used_mirror,
                "Referer": resolved_url,
            },
            proxy_url=self.proxy_url,
            cf_worker_relay=self.cf_worker_relay,
            spoof_geo_country=self.spoof_region,
            timeout=8,
        )
        if status == 200 and body:
            try:
                payload = json.loads(body)
                if payload.get("url"):
                    streams = self.decode_rezka_stream_url(payload["url"])
                    subs = self.parse_subtitles(payload.get("subtitle", ""))
                    return streams, subs
            except Exception:
                pass
        return {}, []

    def get_streams_for_title(
        self,
        item_id: str,
        title: str,
        orig_title: str = "",
        year: int = 2024,
        media_type: str = "movie",
        translator_id: str = "",
        season: int = 1,
        episode: int = 1,
        rezka_url: Optional[str] = None,
        prefer_original: bool = False,
        lang: str = "ru",
    ) -> Dict[str, Any]:
        s_id = str(item_id).strip()
        numeric_id = s_id if s_id.isdigit() else ""
        meta = self._resolve_page_metadata(numeric_id, title, orig_title, rezka_url, year=year, media_type=media_type)

        live_streams: Dict[str, str] = {}
        live_subtitles: List[Dict[str, str]] = []
        studios = meta.get("studios", [])
        used_mirror = meta.get("mirror", self.get_mirrors()[0])
        resolved_id = meta.get("rezka_id", numeric_id)
        resolved_url = meta.get("rezka_url", rezka_url or used_mirror)
        effective_type = meta.get("player_kind") or media_type
        seasons_map = meta.get("seasons_map") or {}
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"

        # Clamp out-of-range (season, episode) (e.g. announced future season on Kinorium) to available HDRezka episodes
        if effective_type == "series" and seasons_map:
            avail_seasons = sorted(int(k) for k in seasons_map.keys() if str(k).isdigit())
            if avail_seasons:
                if int(season) not in avail_seasons:
                    season = max(s for s in avail_seasons if s <= int(season)) if any(s <= int(season) for s in avail_seasons) else avail_seasons[0]
                avail_eps = seasons_map.get(str(season)) or []
                if avail_eps and int(episode) not in avail_eps:
                    episode = max(e for e in avail_eps if e <= int(episode)) if any(e <= int(episode) for e in avail_eps) else avail_eps[0]

        default_tr_candidate = meta.get("default_tr_id", "111")
        if not translator_id and (prefer_original or ui_lang == "en"):
            orig_st = next(
                (
                    s
                    for s in studios
                    if s.get("is_original") or str(s.get("id")) == "238"
                ),
                None,
            )
            if orig_st:
                default_tr_candidate = str(orig_st["id"])

        chosen_tr_id = (
            translator_id
            if translator_id and any(s["id"] == translator_id for s in studios)
            else default_tr_candidate
        )
        chosen_studio_meta = next((s for s in studios if s["id"] == str(chosen_tr_id)), None)
        req_is_original = bool(
            str(chosen_tr_id) == "238"
            or (chosen_studio_meta and chosen_studio_meta.get("is_original"))
        )

        # Only use inline_streams on movies when chosen_tr_id matches the inline raw_default_tr_id
        if (
            effective_type == "movie"
            and meta.get("inline_streams")
            and chosen_tr_id == meta.get("raw_default_tr_id")
        ):
            live_streams = meta["inline_streams"]
            live_subtitles = meta.get("inline_subs", [])

        req_is_prem_locked = bool(chosen_studio_meta and chosen_studio_meta.get("is_prem_locked"))

        # Fetch exact stream for the requested studio + season/episode via AJAX
        # (Skip pointless AJAX + 6-mirror failover when HDRezka already marked Original as b-prem_translator)
        if not live_streams and resolved_id and not (req_is_original and req_is_prem_locked):
            live_streams, live_subtitles = self._fetch_ajax_streams(
                used_mirror,
                resolved_id,
                resolved_url,
                chosen_tr_id,
                effective_type,
                season,
                episode,
            )

        # Try up to 3 alternate studios ONLY when user did not explicitly request Original audio
        if not live_streams and not req_is_original and resolved_id and studios:
            tried_alt = 0
            for alt_studio in studios:
                alt_id = alt_studio["id"]
                if alt_id == str(chosen_tr_id) or alt_studio.get("is_prem_locked"):
                    continue
                tried_alt += 1
                if tried_alt > 3:
                    break
                alt_streams, alt_subs = self._fetch_ajax_streams(
                    used_mirror,
                    resolved_id,
                    resolved_url,
                    alt_id,
                    effective_type,
                    season,
                    episode,
                )
                if alt_streams:
                    live_streams = alt_streams
                    live_subtitles = alt_subs
                    chosen_tr_id = alt_id
                    if not translator_id:
                        meta["default_tr_id"] = alt_id
                    break

        # Mirror failover if primary mirror AJAX returned empty (including warming Anubis PoW cookie)
        if not live_streams and resolved_id and not (req_is_original and req_is_prem_locked):
            parsed_res = urllib.parse.urlparse(resolved_url)
            rel_path = parsed_res.path or "/"
            for alt_mirror in self.get_mirrors():
                alt_base = alt_mirror.rstrip("/")
                if alt_base == used_mirror.rstrip("/"):
                    continue
                alt_ref = alt_base + rel_path
                live_streams, live_subtitles = self._fetch_ajax_streams(
                    alt_base,
                    resolved_id,
                    alt_ref,
                    chosen_tr_id,
                    effective_type,
                    season,
                    episode,
                )
                if not live_streams:
                    # Warm page on alternate mirror to solve Anubis challenge if needed, then retry AJAX
                    try:
                        self.net.request(alt_ref, timeout=5)
                    except Exception:
                        pass
                    live_streams, live_subtitles = self._fetch_ajax_streams(
                        alt_base,
                        resolved_id,
                        alt_ref,
                        chosen_tr_id,
                        effective_type,
                        season,
                        episode,
                    )
                if not live_streams and not req_is_original and studios:
                    alt_try = 0
                    for alt_studio in studios:
                        alt_id = alt_studio["id"]
                        if alt_id == str(chosen_tr_id) or alt_studio.get("is_prem_locked"):
                            continue
                        alt_try += 1
                        if alt_try > 2:
                            break
                        s_streams, s_subs = self._fetch_ajax_streams(
                            alt_base,
                            resolved_id,
                            alt_ref,
                            alt_id,
                            effective_type,
                            season,
                            episode,
                        )
                        if s_streams:
                            live_streams = s_streams
                            live_subtitles = s_subs
                            chosen_tr_id = alt_id
                            break
                if live_streams:
                    used_mirror = alt_base
                    resolved_url = alt_ref
                    break

        if not live_streams and not req_is_original and meta.get("inline_streams"):
            live_streams = meta["inline_streams"]

        selected_studio = next(
            (s for s in studios if s["id"] == str(chosen_tr_id)),
            studios[0] if studios else {"id": "111", "name": "HDRezka Studio", "lang": "RU", "badge": "1080p"},
        )

        default_quality = next(iter(live_streams.keys()), "1080p")
        default_stream_url = live_streams.get(default_quality, "")
        needs_original_fallback = bool(req_is_original and not live_streams)

        return {
            "provider": "hdrezka",
            "rezka_id": resolved_id,
            "rezka_url": resolved_url,
            "title": title,
            "orig_title": orig_title,
            "year": year,
            "media_type": media_type,
            "season": season,
            "episode": episode,
            "seasons_map": meta.get("seasons_map", {}),
            "episodes_titles": meta.get("episodes_titles", {}),
            "episodes_meta": meta.get("episodes_meta", {}),
            "latest_season": meta.get("latest_season", season),
            "latest_episode": meta.get("latest_episode", episode),
            "is_completed": bool(meta.get("is_completed", False)),
            "series_status_text": meta.get("series_status_text", ""),
            "description": meta.get("description", ""),
            "directors": meta.get("directors", []),
            "actors": meta.get("actors", []),
            "cast_people": meta.get("cast_people", []),
            "duration_label": meta.get("duration_label", ""),
            "selected_studio": selected_studio,
            "studios": studios,
            "qualities": live_streams,
            "default_quality": default_quality,
            "default_stream_url": default_stream_url,
            "subtitles": live_subtitles,
            "needs_original_fallback": needs_original_fallback,
            "mirror": used_mirror,
            "geo_bypass": {
                "enabled": True,
                "user_region": "PL (Poland)",
                "api_relay_region": self.spoof_region,
                "status_text": (
                    "1080p No registration • Direct stream"
                    if ui_lang == "en"
                    else "1080p Без регистрации • Прямой поток"
                ),
            },
        }

    def check_series_latest_episodes(
        self,
        series_items: List[Dict[str, Any]],
        batch_limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """
        Checks live HDRezka pages concurrently for a batch of series (from 'Смотрю') and returns
        the real latest released season, episode, and available Russian voiceover studios.
        """
        from concurrent.futures import ThreadPoolExecutor

        batch = list((series_items or [])[: max(1, int(batch_limit))])
        if not batch:
            return []

        def _fetch_one(it: Dict[str, Any]) -> Dict[str, Any]:
            item_id = str(it.get("id") or "")
            title = str(it.get("title") or "")
            orig_title = str(it.get("orig_title") or "")
            year = int(it.get("year") or 2024)
            rezka_url = it.get("rezka_url") or ""
            numeric_id = str(it.get("rezka_id") or "")
            try:
                meta = self._resolve_page_metadata(
                    numeric_id=numeric_id,
                    title=title,
                    orig_title=orig_title,
                    rezka_url=rezka_url,
                    year=year,
                    media_type="series",
                )
            except Exception:
                meta = None

            if not meta or not meta.get("seasons_map"):
                return {
                    "id": item_id,
                    "title": title,
                    "orig_title": orig_title,
                    "not_found": True,
                }

            studios = meta.get("studios") or []
            studio_names = [s.get("name", "") for s in studios if s.get("name")][:4]
            return {
                "id": item_id,
                "title": title,
                "orig_title": orig_title,
                "rezka_id": meta.get("rezka_id", ""),
                "rezka_url": meta.get("rezka_url", ""),
                "latest_season": meta.get("latest_season", 1),
                "latest_episode": meta.get("latest_episode", 1),
                "seasons_map": meta.get("seasons_map", {}),
                "is_completed": bool(meta.get("is_completed", False)),
                "series_status_text": meta.get("series_status_text", ""),
                "studios_summary": ", ".join(studio_names) if studio_names else "HDRezka",
                "studios_count": len(studios),
                "not_found": False,
            }

        workers = min(2, len(batch))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            return list(pool.map(_fetch_one, batch))

    def _is_youtube_embeddable(self, vid: str) -> bool:
        if not vid:
            return False
        try:
            req = urllib.request.Request(
                f"https://www.youtube.com/embed/{vid}",
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
                    ),
                    "Referer": "http://127.0.0.1:8765/",
                },
            )
            with urllib.request.urlopen(req, timeout=4) as resp:
                html_text = resp.read().decode("utf-8", errors="ignore")
            return (
                "UNPLAYABLE" not in html_text
                and '"153"' not in html_text
                and '\\"153\\"' not in html_text
            )
        except Exception:
            return True

    def _search_youtube_video_id(self, query: str) -> str:
        try:
            q_enc = urllib.parse.quote(query)
            req = urllib.request.Request(
                f"https://www.youtube.com/results?search_query={q_enc}",
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
                    ),
                    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8",
                },
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                html_text = resp.read().decode("utf-8", errors="ignore")
            raw_vids = re.findall(r'"videoId":"([a-zA-Z0-9_-]{11})"', html_text)
            seen = []
            for v in raw_vids:
                if v not in seen:
                    seen.append(v)
            for cand in seen[:4]:
                if self._is_youtube_embeddable(cand):
                    return cand
            if seen:
                return seen[0]
        except Exception:
            pass
        return ""

    def get_trailer_for_title(
        self,
        item_id: str,
        title: str,
        orig_title: str = "",
        year: int = 2024,
        media_type: str = "movie",
        rezka_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        cache_key = f"{item_id}:{title}:{orig_title}:{year}"
        if cache_key in self.trailer_cache:
            return self.trailer_cache[cache_key]

        s_id = str(item_id).strip()
        numeric_id = s_id if s_id.isdigit() else ""
        meta = self._resolve_page_metadata(
            numeric_id, title, orig_title, rezka_url, year=year, media_type=media_type
        )
        mirror = meta.get("mirror", self.get_mirrors()[0])
        resolved_id = meta.get("rezka_id", numeric_id)
        resolved_url = meta.get("rezka_url", rezka_url or mirror)

        rezka_embed = ""
        rezka_yt_id = ""
        if resolved_id:
            try:
                st, body, _ = self.net.request(
                    f"{mirror}/engine/ajax/gettrailervideo.php",
                    method="POST",
                    data=urllib.parse.urlencode({"id": resolved_id}).encode("utf-8"),
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                        "Origin": mirror,
                        "Referer": resolved_url,
                    },
                    proxy_url=self.proxy_url,
                    cf_worker_relay=self.cf_worker_relay,
                    spoof_geo_country=self.spoof_region,
                    timeout=5,
                )
                if st == 200 and body:
                    payload = json.loads(body)
                    code_html = payload.get("code") or ""
                    m_src = re.search(r'src="([^"]+)"', code_html)
                    if m_src:
                        raw_src = m_src.group(1).replace("\\/", "/")
                        if raw_src.startswith("//"):
                            raw_src = "https:" + raw_src
                        rezka_embed = raw_src
                        m_yt = re.search(r"youtube\.com/embed/([a-zA-Z0-9_-]{11})", raw_src)
                        if m_yt:
                            rezka_yt_id = m_yt.group(1)
            except Exception:
                pass

        type_word_ru = "сериал" if media_type == "series" else "фильм"
        ru_query = f"{title} {year} {type_word_ru} русский трейлер"
        en_base = orig_title if orig_title and orig_title != title else title
        en_query = f"{en_base} {year} official trailer"

        if rezka_yt_id and not self._is_youtube_embeddable(rezka_yt_id):
            rezka_yt_id = ""
            rezka_embed = ""

        ru_vid = rezka_yt_id or self._search_youtube_video_id(ru_query)
        en_vid = self._search_youtube_video_id(en_query) or ru_vid

        ru_embed = (
            f"https://www.youtube.com/embed/{ru_vid}?autoplay=1&rel=0"
            if ru_vid
            else rezka_embed
        )
        en_embed = (
            f"https://www.youtube.com/embed/{en_vid}?autoplay=1&rel=0"
            if en_vid
            else ru_embed
        )

        result = {
            "title": title,
            "orig_title": orig_title,
            "year": year,
            "ru_video_id": ru_vid,
            "en_video_id": en_vid,
            "ru_embed_url": ru_embed,
            "en_embed_url": en_embed,
            "default_embed_url": ru_embed or en_embed,
            "ru_youtube_url": (
                f"https://www.youtube.com/watch?v={ru_vid}"
                if ru_vid
                else f"https://www.youtube.com/results?search_query={urllib.parse.quote(ru_query)}"
            ),
            "en_youtube_url": (
                f"https://www.youtube.com/watch?v={en_vid}"
                if en_vid
                else f"https://www.youtube.com/results?search_query={urllib.parse.quote(en_query)}"
            ),
        }
        self.trailer_cache[cache_key] = result
        return result

    def resolve_person_photo(self, name: str) -> str:
        clean = (name or "").strip()
        if not clean:
            return ""
        key = clean.lower()
        if key in self.person_photo_by_name:
            return self.person_photo_by_name[key]
        for wiki_lang in ("ru", "en"):
            try:
                slug = urllib.parse.quote(clean.replace(" ", "_"))
                req = urllib.request.Request(
                    f"https://{wiki_lang}.wikipedia.org/api/rest_v1/page/summary/{slug}",
                    headers={
                        "User-Agent": "CineFlow/2.0 (AppleTV Local Media Center)",
                        "Accept": "application/json",
                    },
                )
                with urllib.request.urlopen(req, timeout=3) as resp:
                    payload = json.loads(resp.read().decode("utf-8", errors="ignore"))
                thumb = (payload.get("thumbnail") or {}).get("source") or ""
                if thumb.startswith("http"):
                    self.person_photo_by_name[key] = thumb
                    return thumb
            except Exception:
                pass
        self.person_photo_by_name[key] = ""
        return ""

    def find_cached_person_url(self, target_name: str) -> str:
        clean = (target_name or "").strip().lower()
        if not clean:
            return ""
        direct = self.person_url_by_name.get(clean, "")
        if direct:
            return direct
        best_url = ""
        best_score = 0.0
        for cached_k, url_val in list(self.person_url_by_name.items()):
            if not url_val:
                continue
            sc = _names_match_ru_en(cached_k, clean)
            if sc > best_score:
                best_score = sc
                best_url = url_val
        return best_url if best_score >= 0.72 else ""

    @staticmethod
    def _normalize_wiki_person_title(raw_title: str) -> str:
        t = re.sub(r"\s*\([^)]*\)\s*$", "", (raw_title or "").strip()).strip()
        if t.count(",") == 1:
            surname, given = [p.strip() for p in t.split(",", 1)]
            if surname and given:
                return f"{given} {surname}"
        return t

    def get_person_details(self, name: str, hint_url: str = "") -> Dict[str, Any]:
        clean_name = (name or "").strip()
        if not clean_name:
            return {"name": "", "sections": []}
        key = clean_name.lower()
        cache_key = f"{key}|{hint_url.strip()}"
        if cache_key in self.person_profile_cache:
            return self.person_profile_cache[cache_key]

        p_url = hint_url.strip() or self.find_cached_person_url(clean_name)
        is_latin_query = not has_cyrillic(clean_name)
        ru_name = clean_name
        orig_name = clean_name if is_latin_query else ""
        photo_url = self.person_photo_by_name.get(key, "")
        career_roles = ""
        birth_date = ""
        birth_place = ""
        bio = ""
        bio_en = ""
        sections: List[Dict[str, Any]] = []

        ua_hdrs = {
            "User-Agent": "CineFlow/2.0 (AppleTV Local Media Center)",
            "Accept": "application/json",
        }

        if is_latin_query:
            # Fast English Wikipedia summary + langlinks -> exact Russian name ("Gary Oldman" -> "Гэри Олдман")
            try:
                en_slug = urllib.parse.quote(clean_name.replace(" ", "_"))
                en_req = urllib.request.Request(
                    f"https://en.wikipedia.org/api/rest_v1/page/summary/{en_slug}",
                    headers=ua_hdrs,
                )
                with urllib.request.urlopen(en_req, timeout=2.5) as en_resp:
                    en_payload = json.loads(en_resp.read().decode("utf-8", errors="ignore"))
                if not photo_url:
                    thumb = (en_payload.get("thumbnail") or {}).get("source") or ""
                    if thumb.startswith("http"):
                        photo_url = thumb
                        self.person_photo_by_name[key] = thumb
                ext_en = (en_payload.get("extract") or "").strip()
                if ext_en and len(ext_en) > 30:
                    bio_en = ext_en[:420] + ("…" if len(ext_en) > 420 else "")
            except Exception:
                pass

            try:
                ll_qs = urllib.parse.urlencode(
                    {
                        "action": "query",
                        "titles": clean_name,
                        "prop": "langlinks",
                        "lllang": "ru",
                        "redirects": "1",
                        "format": "json",
                    }
                )
                ll_req = urllib.request.Request(
                    f"https://en.wikipedia.org/w/api.php?{ll_qs}",
                    headers=ua_hdrs,
                )
                with urllib.request.urlopen(ll_req, timeout=2.2) as ll_resp:
                    ll_data = json.loads(ll_resp.read().decode("utf-8", errors="ignore"))
                pages = (ll_data.get("query") or {}).get("pages") or {}
                for pg in pages.values():
                    lls = pg.get("langlinks") or []
                    if lls:
                        ru_t = (lls[0].get("*") or lls[0].get("title") or "").strip()
                        norm_ru = self._normalize_wiki_person_title(ru_t)
                        if norm_ru and has_cyrillic(norm_ru):
                            ru_name = norm_ru
                            if not p_url:
                                p_url = self.find_cached_person_url(ru_name)
                            break
            except Exception:
                pass

        def _fetch_ru_wiki_summary(q_name: str) -> Dict[str, Any]:
            for candidate in [q_name]:
                try:
                    slug = urllib.parse.quote(candidate.replace(" ", "_"))
                    req = urllib.request.Request(
                        f"https://ru.wikipedia.org/api/rest_v1/page/summary/{slug}",
                        headers=ua_hdrs,
                    )
                    with urllib.request.urlopen(req, timeout=2.5) as resp:
                        return json.loads(resp.read().decode("utf-8", errors="ignore"))
                except Exception:
                    pass
            try:
                os_url = (
                    "https://ru.wikipedia.org/w/api.php?action=opensearch&limit=1&namespace=0&format=json&search="
                    + urllib.parse.quote(q_name)
                )
                req = urllib.request.Request(os_url, headers=ua_hdrs)
                with urllib.request.urlopen(req, timeout=2.5) as resp:
                    os_data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                titles = os_data[1] if isinstance(os_data, list) and len(os_data) > 1 else []
                if titles and titles[0]:
                    slug = urllib.parse.quote(str(titles[0]).replace(" ", "_"))
                    req2 = urllib.request.Request(
                        f"https://ru.wikipedia.org/api/rest_v1/page/summary/{slug}",
                        headers=ua_hdrs,
                    )
                    with urllib.request.urlopen(req2, timeout=2.5) as resp2:
                        return json.loads(resp2.read().decode("utf-8", errors="ignore"))
            except Exception:
                pass
            return {}

        # Pre-fetch Russian Wikipedia summary if p_url or Russian bio is needed
        payload = _fetch_ru_wiki_summary(ru_name) if (not p_url or not is_latin_query) else {}
        if payload:
            wiki_ru_title = self._normalize_wiki_person_title(str(payload.get("title") or ""))
            if wiki_ru_title and has_cyrillic(wiki_ru_title) and not has_cyrillic(ru_name):
                ru_name = wiki_ru_title
                if not p_url:
                    p_url = self.find_cached_person_url(ru_name)
            if not photo_url:
                thumb = (payload.get("thumbnail") or {}).get("source") or ""
                if thumb.startswith("http"):
                    photo_url = thumb
                    self.person_photo_by_name[key] = thumb
            ext = (payload.get("extract") or "").strip()
            if ext and len(ext) > 30:
                bio = ext[:420] + ("…" if len(ext) > 420 else "")
                if not p_url:
                    for quoted_work in re.findall(r"«([^»]{2,48})»", ext)[:2]:
                        w_hits = self.search_live(quoted_work)
                        if w_hits and w_hits[0].get("url"):
                            try:
                                self._resolve_page_metadata(
                                    str(w_hits[0].get("rezka_id") or ""),
                                    str(w_hits[0].get("title") or ""),
                                    "",
                                    str(w_hits[0].get("url") or ""),
                                )
                            except Exception:
                                pass
                            p_url = self.find_cached_person_url(ru_name) or self.find_cached_person_url(clean_name)
                            if p_url:
                                break

        if not p_url:
            # Discover person_url via first matching movie page on HDRezka if not cached yet
            live_hits = self.search_live(ru_name if has_cyrillic(ru_name) else clean_name)
            for hit in (live_hits or [])[:2]:
                if not hit.get("url"):
                    continue
                try:
                    self._resolve_page_metadata(
                        str(hit.get("rezka_id") or ""),
                        str(hit.get("title") or ""),
                        "",
                        str(hit.get("url") or ""),
                    )
                    p_url = self.find_cached_person_url(ru_name) or self.find_cached_person_url(clean_name)
                    if p_url:
                        break
                except Exception:
                    pass

        item_pattern = re.compile(
            r'<div class="b-content__inline_item(?:\s+[^"]*)?"[^>]*data-id="(\d+)"[^>]*data-url="([^"]+)"[^>]*>.*?'
            r'<img src="([^"]+)"[^>]*>.*?'
            r'<div class="b-content__inline_item-link">\s*<a[^>]*>([^<]+)</a>\s*<div[^>]*>([^<]*)</div>',
            re.S,
        )

        if p_url:
            status, body, resp_headers = self.net.request(
                p_url,
                proxy_url=self.proxy_url,
                cf_worker_relay=self.cf_worker_relay,
                spoof_geo_country=self.spoof_region,
                timeout=8,
            )
            if status == 200 and body:
                final_mirror = "/".join(resp_headers.get("_final_url", p_url).split("/")[:3])
                m_t1 = re.search(r'<span[^>]*class="t1"[^>]*itemprop="name"[^>]*>([^<]+)</span>', body)
                if m_t1:
                    ru_name = html.unescape(m_t1.group(1).strip())
                    if ru_name:
                        self.person_url_by_name[ru_name.lower()] = p_url
                m_t2 = re.search(
                    r'<span[^>]*class="t2"[^>]*itemprop="alternativeHeadline"[^>]*>([^<]+)</span>', body
                )
                if m_t2:
                    orig_name = html.unescape(m_t2.group(1).strip())
                    if orig_name:
                        self.person_url_by_name[orig_name.lower()] = p_url

                m_img = re.search(r'<div class="b-post__infotable_left".*?<img[^>]*src="([^"]+)"', body, re.S)
                if m_img:
                    raw_img = m_img.group(1).strip()
                    if "nopersonphoto" not in raw_img.lower():
                        m_i = re.search(r"(/i/\d+/\d+/\d+/[^\s\"']+)", raw_img)
                        photo_url = f"{final_mirror.rstrip('/')}{m_i.group(1)}" if m_i else raw_img
                        self.person_photo_by_name[key] = photo_url

                for row_title, row_html in re.findall(
                    r'<tr>\s*<td class="l"><h2>([^<]+)</h2>:\s*</td>\s*<td>(.*?)</td>\s*</tr>',
                    body,
                    re.S,
                ):
                    rt_low = row_title.strip().lower()
                    val_txt = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", row_html))).strip()
                    val_txt = re.sub(r"\s*,\s*", ", ", val_txt)
                    if "карьер" in rt_low:
                        career_roles = val_txt
                    elif "дата рожд" in rt_low:
                        birth_date = val_txt
                    elif "место рожд" in rt_low:
                        birth_place = val_txt

                role_map = {
                    "rezhisser": ("director", "Режиссёр"),
                    "akter": ("actor", "В ролях"),
                    "scenarist": ("writer", "Сценарист"),
                    "prodyuser": ("producer", "Продюсер"),
                }

                parts = body.split('<div class="b-person__career"')
                for chunk in parts[1:]:
                    m_h2 = re.search(r'<h2[^>]*id="([^"]*)"[^>]*>([^<]+)</h2>', chunk)
                    sec_raw_id = (m_h2.group(1).strip().lower() if m_h2 else "works")
                    sec_raw_title = html.unescape(m_h2.group(2).strip()) if m_h2 else "Фильмография"
                    role_key, role_label = role_map.get(sec_raw_id, (sec_raw_id, sec_raw_title))

                    sec_items = []
                    seen_rids = set()
                    for m_it in item_pattern.finditer(chunk):
                        rid, it_url, it_poster, it_title, it_info = m_it.groups()
                        if rid in seen_rids:
                            continue
                        seen_rids.add(rid)
                        if not it_url.startswith("http"):
                            it_url = final_mirror + it_url
                        if not it_poster.startswith("http"):
                            it_poster = final_mirror + it_poster
                        sec_items.append(
                            {
                                "rezka_id": rid,
                                "url": it_url,
                                "poster": it_poster,
                                "title": html.unescape(it_title.strip()),
                                "info": html.unescape(it_info.strip()),
                            }
                        )
                        if len(sec_items) >= 80:
                            break
                    if sec_items:
                        sections.append(
                            {
                                "key": role_key,
                                "label": role_label,
                                "items": sec_items,
                            }
                        )

        # Fetch concise Wikipedia bio (RU + EN) & fallback photo (+ resolve English name via langlinks if missing)
        if not orig_name and ru_name and re.search(r"[А-Яа-яЁё]", ru_name):
            try:
                ll_qs = urllib.parse.urlencode(
                    {
                        "action": "query",
                        "titles": ru_name,
                        "prop": "langlinks",
                        "lllang": "en",
                        "redirects": "1",
                        "format": "json",
                    }
                )
                ll_req = urllib.request.Request(
                    f"https://ru.wikipedia.org/w/api.php?{ll_qs}",
                    headers={
                        "User-Agent": "CineFlow/2.0 (AppleTV Local Media Center)",
                        "Accept": "application/json",
                    },
                )
                with urllib.request.urlopen(ll_req, timeout=2.5) as ll_resp:
                    ll_data = json.loads(ll_resp.read().decode("utf-8", errors="ignore"))
                pages = (ll_data.get("query") or {}).get("pages") or {}
                for pg in pages.values():
                    lls = pg.get("langlinks") or []
                    if lls:
                        en_t = (lls[0].get("*") or lls[0].get("title") or "").strip()
                        if en_t:
                            orig_name = re.sub(r"\s*\([^)]*\)\s*$", "", en_t).strip()
                            break
            except Exception:
                pass

        wiki_candidates = []
        if ru_name:
            wiki_candidates.append(("ru" if re.search(r"[А-Яа-яЁё]", ru_name) else "en", ru_name))
        if orig_name:
            wiki_candidates.append(("en" if re.search(r"[A-Za-z]", orig_name) else "ru", orig_name))

        for wiki_lang, wiki_name in wiki_candidates:
            if wiki_lang == "ru" and bio and photo_url:
                continue
            if wiki_lang == "en" and bio_en and photo_url:
                continue
            try:
                slug = urllib.parse.quote(wiki_name.replace(" ", "_"))
                req = urllib.request.Request(
                    f"https://{wiki_lang}.wikipedia.org/api/rest_v1/page/summary/{slug}",
                    headers={
                        "User-Agent": "CineFlow/2.0 (AppleTV Local Media Center)",
                        "Accept": "application/json",
                    },
                )
                with urllib.request.urlopen(req, timeout=2.8) as resp:
                    payload = json.loads(resp.read().decode("utf-8", errors="ignore"))
                if not photo_url:
                    thumb = (payload.get("thumbnail") or {}).get("source") or ""
                    if thumb.startswith("http"):
                        photo_url = thumb
                        self.person_photo_by_name[key] = thumb
                ext = (payload.get("extract") or "").strip()
                if ext and len(ext) > 30:
                    clipped = ext[:420] + ("…" if len(ext) > 420 else "")
                    if wiki_lang == "en" and not bio_en:
                        bio_en = clipped
                    elif wiki_lang == "ru" and not bio:
                        bio = clipped
            except Exception:
                pass

        if not sections:
            fallback_hits = self.search_live(clean_name)
            if fallback_hits:
                sections.append(
                    {
                        "key": "all",
                        "label": "Фильмография",
                        "items": fallback_hits[:30],
                    }
                )

        result = {
            "name": ru_name,
            "orig_name": orig_name,
            "person_url": p_url,
            "photo": photo_url,
            "career_roles": career_roles,
            "birth_date": birth_date,
            "birth_place": birth_place,
            "bio": bio,
            "bio_en": bio_en,
            "sections": sections,
        }
        self.person_profile_cache[cache_key] = result
        return result
