import copy
import html
import json
import re
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

from .hdrezka import _CTRL_CHAR_RE, _RejectedMeta, _safe_int


def check_series_latest_episodes(
    client,
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
        year = _safe_int(it.get("year"))
        rezka_url = it.get("rezka_url") or ""
        numeric_id = str(it.get("rezka_id") or "")
        try:
            meta = client._resolve_page_metadata(
                numeric_id=numeric_id,
                title=title,
                orig_title=orig_title,
                rezka_url=rezka_url,
                year=year,
                media_type="series",
            )
        except Exception:
            meta = None

        if not meta or (not meta.get("seasons_map") and not meta.get("prem_episodes_map")):
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
            "prem_episodes_map": meta.get("prem_episodes_map", {}),
            "episodes_meta": meta.get("episodes_meta", {}),
            "is_completed": bool(meta.get("is_completed", False)),
            "series_status_text": meta.get("series_status_text", ""),
            "studios_summary": ", ".join(studio_names) if studio_names else "HDRezka",
            "studios_count": len(studios),
            "not_found": False,
        }

    workers = min(2, len(batch))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(_fetch_one, batch))

def _is_youtube_embeddable(client, vid: str) -> bool:
    if not vid or not re.match(r"^[a-zA-Z0-9_-]{11}$", str(vid)):
        return False
    try:
        st, html_text, _ = client.net.request(
            f"https://www.youtube.com/embed/{vid}",
            headers={"Referer": "http://127.0.0.1:8765/"},
            spoof_geo_country="DIRECT",
            timeout=4,
        )
        if st != 200 or not html_text:
            return True
        return (
            "UNPLAYABLE" not in html_text
            and '"153"' not in html_text
            and '\\"153\\"' not in html_text
        )
    except Exception:
        return True

def _search_youtube_video_id(client, query: str) -> str:
    try:
        q_enc = urllib.parse.quote(query)
        st, html_text, _ = client.net.request(
            f"https://www.youtube.com/results?search_query={q_enc}",
            headers={"Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8"},
            spoof_geo_country="DIRECT",
            timeout=5,
        )
        if st != 200 or not html_text:
            return ""
        raw_vids = re.findall(r'"videoId":"([a-zA-Z0-9_-]{11})"', html_text)
        seen = []
        for v in raw_vids:
            if v not in seen:
                seen.append(v)
        for cand in seen[:4]:
            if client._is_youtube_embeddable(cand):
                return cand
        if seen:
            return seen[0]
    except Exception:
        pass
    return ""

def get_trailer_for_title(
    client,
    item_id: str,
    title: str,
    orig_title: str = "",
    year: int = 0,
    media_type: str = "movie",
    rezka_url: Optional[str] = None,
    rezka_id: str = "",
    imdb_id: str = "",
) -> Dict[str, Any]:
    yr_int = _safe_int(year)
    cache_key = f"{item_id}:{title}:{orig_title}:{yr_int}"
    with client._cache_lock:
        if cache_key in client.trailer_cache:
            return copy.deepcopy(client.trailer_cache[cache_key])

    s_id = str(item_id or "").strip()
    inferred_imdb = imdb_id.strip() if imdb_id else (s_id if re.match(r"^tt\d{5,10}$", s_id) else "")
    safe_rezka_url = rezka_url if (rezka_url and client._is_rezka_page_url(rezka_url)) else None
    numeric_id = client._extract_safe_rezka_id(s_id, explicit_rezka_id=rezka_id, rezka_url=safe_rezka_url)
    meta = client._resolve_page_metadata(
        numeric_id,
        title,
        orig_title,
        safe_rezka_url,
        year=yr_int,
        media_type=media_type,
        imdb_id=inferred_imdb,
    )
    was_rejected = isinstance(meta, _RejectedMeta)
    if was_rejected:
        numeric_id = ""
        safe_rezka_url = None
    mirror = meta.get("mirror", client.get_mirrors()[0])
    resolved_id = "" if was_rejected else (meta.get("rezka_id") or numeric_id)
    resolved_url = "" if was_rejected else meta.get("rezka_url", safe_rezka_url or mirror)

    rezka_embed = ""
    rezka_yt_id = ""
    if resolved_id:
        try:
            st, body, _ = client.net.request(
                f"{mirror}/engine/ajax/gettrailervideo.php",
                method="POST",
                data=urllib.parse.urlencode({"id": resolved_id}).encode("utf-8"),
                headers={
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                    "Origin": mirror,
                    "Referer": resolved_url,
                },
                proxy_url=client.proxy_url,
                cf_worker_relay=client.cf_worker_relay,
                spoof_geo_country=client.spoof_region,
                timeout=5,
            )
            if st == 200 and body:
                payload = json.loads(body)
                code_html = payload.get("code") or ""
                m_src = re.search(r'src="([^"]+)"', code_html)
                if m_src:
                    raw_src = html.unescape(m_src.group(1).replace("\\/", "/")).strip()
                    if raw_src.startswith("//"):
                        raw_src = "https:" + raw_src
                    if (
                        raw_src.startswith(("https://", "http://"))
                        and not _CTRL_CHAR_RE.search(raw_src)
                        and not any(ch in raw_src for ch in ('"', "'", "<", ">"))
                    ):
                        rezka_embed = raw_src
                        m_yt = re.search(r"youtube\.com/embed/([a-zA-Z0-9_-]{11})", raw_src)
                        if m_yt:
                            rezka_yt_id = m_yt.group(1)
        except Exception:
            pass

    type_word_ru = "сериал" if media_type == "series" else "фильм"
    yr_part = f" {yr_int}" if yr_int > 1900 else ""
    ru_query = f"{title}{yr_part} {type_word_ru} русский трейлер"
    en_base = orig_title if orig_title and orig_title != title else title
    en_query = f"{en_base}{yr_part} official trailer"

    if rezka_yt_id and not client._is_youtube_embeddable(rezka_yt_id):
        rezka_yt_id = ""
        rezka_embed = ""

    ru_vid = rezka_yt_id or client._search_youtube_video_id(ru_query)
    en_vid = client._search_youtube_video_id(en_query) or ru_vid

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
        "ok": bool(ru_vid or en_vid or rezka_embed),
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
    if ru_vid or en_vid or rezka_embed:
        with client._cache_lock:
            if len(client.trailer_cache) > 400:
                for k_ev in list(client.trailer_cache.keys())[:100]:
                    client.trailer_cache.pop(k_ev, None)
            client.trailer_cache[cache_key] = copy.deepcopy(result)
    return result

def _fetch_wiki_json(client, url: str, timeout: float = 2.8) -> Dict[str, Any]:
    try:
        st, body, _ = client.net.request(
            url,
            headers={
                "User-Agent": "CineFlow/2.0 (AppleTV Local Media Center)",
                "Accept": "application/json",
            },
            spoof_geo_country="DIRECT",
            timeout=max(1, int(round(timeout))),
        )
        if st == 200 and body:
            data = json.loads(body)
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}

def resolve_person_photo(client, name: str) -> str:
    clean = (name or "").strip()
    if not clean:
        return ""
    key = clean.lower()
    with client._cache_lock:
        cached_ph = client.person_photo_by_name.get(key)
    if cached_ph:
        return cached_ph
    for wiki_lang in ("ru", "en"):
        try:
            slug = urllib.parse.quote(clean.replace(" ", "_"))
            payload = client._fetch_wiki_json(
                f"https://{wiki_lang}.wikipedia.org/api/rest_v1/page/summary/{slug}",
                timeout=3.0,
            )
            if payload.get("type") == "disambiguation":
                continue
            thumb = (payload.get("thumbnail") or {}).get("source") or ""
            if thumb.startswith("http"):
                with client._cache_lock:
                    if len(client.person_photo_by_name) > 1500:
                        for k_ev in list(client.person_photo_by_name.keys())[:375]:
                            client.person_photo_by_name.pop(k_ev, None)
                    client.person_photo_by_name[key] = thumb
                return thumb
        except Exception:
            pass
    return ""

def find_cached_person_url(client, target_name: str) -> str:
    clean = (target_name or "").strip().lower()
    if not clean:
        return ""
    with client._cache_lock:
        direct = client.person_url_by_name.get(clean, "")
        if direct:
            return direct
        items_snap = list(client.person_url_by_name.items())
    from .en_metadata import _names_match_ru_en
    best_url = ""
    best_score = 0.0
    for cached_k, url_val in items_snap:
        if not url_val:
            continue
        sc = _names_match_ru_en(cached_k, clean)
        if sc > best_score:
            best_score = sc
            best_url = url_val
    return best_url if best_score >= 0.78 else ""

def _normalize_wiki_person_title(raw_title: str) -> str:
    t = re.sub(r"\s*\([^)]*\)\s*$", "", (raw_title or "").strip()).strip()
    if t.count(",") == 1:
        surname, given = [p.strip() for p in t.split(",", 1)]
        if surname and given:
            return f"{given} {surname}"
    return t

def get_person_details(client, name: str, hint_url: str = "") -> Dict[str, Any]:
    from .en_metadata import has_cyrillic
    clean_name = (name or "").strip()
    if not clean_name:
        return {"name": "", "sections": []}
    key = clean_name.lower()
    safe_hint_url = hint_url.strip() if (hint_url and client._is_rezka_page_url(hint_url.strip())) else ""
    cache_key = f"{key}|{safe_hint_url}"
    with client._cache_lock:
        if cache_key in client.person_profile_cache:
            return copy.deepcopy(client.person_profile_cache[cache_key])
        photo_url = client.person_photo_by_name.get(key, "")

    p_url = safe_hint_url or client.find_cached_person_url(clean_name)
    if p_url and not client._is_rezka_page_url(p_url):
        p_url = ""
    is_latin_query = not has_cyrillic(clean_name)
    ru_name = clean_name
    orig_name = clean_name if is_latin_query else ""
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

    ru_wiki_page_title = ""
    if is_latin_query:
        # Fast English Wikipedia summary + langlinks -> exact Russian name ("Gary Oldman" -> "Гэри Олдман")
        try:
            en_slug = urllib.parse.quote(clean_name.replace(" ", "_"))
            en_payload = client._fetch_wiki_json(
                f"https://en.wikipedia.org/api/rest_v1/page/summary/{en_slug}",
                timeout=2.5,
            )
            if en_payload and en_payload.get("type") != "disambiguation":
                if not photo_url:
                    thumb = (en_payload.get("thumbnail") or {}).get("source") or ""
                    if thumb.startswith("http"):
                        photo_url = thumb
                        with client._cache_lock:
                            if len(client.person_photo_by_name) > 1500:
                                for k_ev in list(client.person_photo_by_name.keys())[:375]:
                                    client.person_photo_by_name.pop(k_ev, None)
                            client.person_photo_by_name[key] = thumb
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
            ll_data = client._fetch_wiki_json(
                f"https://en.wikipedia.org/w/api.php?{ll_qs}",
                timeout=2.2,
            )
            pages = (ll_data.get("query") or {}).get("pages") or {}
            for pg in pages.values():
                lls = pg.get("langlinks") or []
                if lls:
                    ru_t = (lls[0].get("*") or lls[0].get("title") or "").strip()
                    norm_ru = client._normalize_wiki_person_title(ru_t)
                    if norm_ru and has_cyrillic(norm_ru):
                        ru_wiki_page_title = ru_t
                        ru_name = norm_ru
                        if not p_url:
                            p_url = client.find_cached_person_url(ru_name)
                        break
        except Exception:
            pass

    def _fetch_ru_wiki_summary(q_name: str, exact_wiki_title: str = "") -> Dict[str, Any]:
        candidates_w = [c for c in dict.fromkeys([exact_wiki_title, q_name]) if c]
        for candidate in candidates_w:
            try:
                slug = urllib.parse.quote(candidate.replace(" ", "_"))
                res_w = client._fetch_wiki_json(
                    f"https://ru.wikipedia.org/api/rest_v1/page/summary/{slug}",
                    timeout=2.5,
                )
                if res_w and res_w.get("type") != "disambiguation":
                    return res_w
            except Exception:
                pass
        try:
            os_url = (
                "https://ru.wikipedia.org/w/api.php?action=opensearch&limit=1&namespace=0&format=json&search="
                + urllib.parse.quote(q_name)
            )
            st_os, body_os, _ = client.net.request(
                os_url,
                headers=ua_hdrs,
                spoof_geo_country="DIRECT",
                timeout=3,
            )
            os_data = json.loads(body_os) if (st_os == 200 and body_os) else []
            titles = os_data[1] if isinstance(os_data, list) and len(os_data) > 1 else []
            if titles and titles[0]:
                slug = urllib.parse.quote(str(titles[0]).replace(" ", "_"))
                res_w2 = client._fetch_wiki_json(
                    f"https://ru.wikipedia.org/api/rest_v1/page/summary/{slug}",
                    timeout=2.5,
                )
                if res_w2 and res_w2.get("type") != "disambiguation":
                    return res_w2
        except Exception:
            pass
        return {}

    # Pre-fetch Russian Wikipedia summary if p_url or Russian bio is needed
    payload = _fetch_ru_wiki_summary(ru_name, exact_wiki_title=ru_wiki_page_title) if (not p_url or not is_latin_query) else {}
    if payload:
        wiki_ru_title = client._normalize_wiki_person_title(str(payload.get("title") or ""))
        if wiki_ru_title and has_cyrillic(wiki_ru_title) and not has_cyrillic(ru_name):
            ru_name = wiki_ru_title
            if not p_url:
                p_url = client.find_cached_person_url(ru_name)
        if not photo_url:
            thumb = (payload.get("thumbnail") or {}).get("source") or ""
            if thumb.startswith("http"):
                photo_url = thumb
                with client._cache_lock:
                    if len(client.person_photo_by_name) > 1500:
                        for k_ev in list(client.person_photo_by_name.keys())[:375]:
                            client.person_photo_by_name.pop(k_ev, None)
                    client.person_photo_by_name[key] = thumb
        ext = (payload.get("extract") or "").strip()
        ext_html = str(payload.get("extract_html") or "")
        if ext and len(ext) > 30:
            bio = ext[:420] + ("…" if len(ext) > 420 else "")
            if not p_url:
                wiki_works = list(
                    dict.fromkeys(
                        [w.strip() for w in re.findall(r"«([^»]{2,48})»", ext) if w.strip()]
                        + [
                            html.unescape(w.strip())
                            for w in re.findall(r"<i>([^<]{2,48})</i>", ext_html)
                            if w.strip() and w.strip().lower() != ru_name.lower() and w.strip().lower() != clean_name.lower()
                        ]
                    )
                )
                for quoted_work in wiki_works[:3]:
                    w_hits = client.search_live(quoted_work)
                    if w_hits and w_hits[0].get("url"):
                        try:
                            client._resolve_page_metadata(
                                str(w_hits[0].get("rezka_id") or ""),
                                str(w_hits[0].get("title") or ""),
                                "",
                                str(w_hits[0].get("url") or ""),
                            )
                        except Exception:
                            pass
                        p_url = client.find_cached_person_url(ru_name) or client.find_cached_person_url(clean_name)
                        if p_url:
                            break

    if not p_url:
        # Discover person_url via first matching movie page on HDRezka if not cached yet
        live_hits = client.search_live(ru_name if has_cyrillic(ru_name) else clean_name)
        for hit in (live_hits or [])[:2]:
            if not hit.get("url"):
                continue
            try:
                client._resolve_page_metadata(
                    str(hit.get("rezka_id") or ""),
                    str(hit.get("title") or ""),
                    "",
                    str(hit.get("url") or ""),
                )
                p_url = client.find_cached_person_url(ru_name) or client.find_cached_person_url(clean_name)
                if p_url:
                    break
            except Exception:
                pass

    item_pattern = re.compile(
        r'<div class="b-content__inline_item(?:\s+[^"]*)?"[^>]*data-id="(\d+)"[^>]*data-url="([^"]+)"[^>]*>.*?'
        r'<img[^>]+src=["\']([^"\']+)["\'][^>]*>.*?'
        r'<div class="b-content__inline_item-link">\s*<a[^>]*>([^<]+)</a>\s*<div[^>]*>([^<]*)</div>',
        re.S,
    )

    if p_url and client._is_rezka_page_url(p_url):
        status, body, resp_headers = client.net.request(
            p_url,
            proxy_url=client.proxy_url,
            cf_worker_relay=client.cf_worker_relay,
            spoof_geo_country=client.spoof_region,
            timeout=8,
        )
        if status == 200 and body:
            final_mirror = "/".join(resp_headers.get("_final_url", p_url).split("/")[:3])
            m_t1 = re.search(r'<span[^>]*class="t1"[^>]*itemprop="name"[^>]*>([^<]+)</span>', body)
            if m_t1:
                ru_name = html.unescape(m_t1.group(1).strip())
                if ru_name:
                    with client._cache_lock:
                        if len(client.person_url_by_name) >= 2000:
                            for k_ev in list(client.person_url_by_name.keys())[:500]:
                                client.person_url_by_name.pop(k_ev, None)
                        client.person_url_by_name[ru_name.lower()] = p_url
            m_t2 = re.search(
                r'<span[^>]*class="t2"[^>]*itemprop="alternativeHeadline"[^>]*>([^<]+)</span>', body
            )
            if m_t2:
                orig_name = html.unescape(m_t2.group(1).strip())
                if orig_name:
                    with client._cache_lock:
                        if len(client.person_url_by_name) >= 2000:
                            for k_ev in list(client.person_url_by_name.keys())[:500]:
                                client.person_url_by_name.pop(k_ev, None)
                        client.person_url_by_name[orig_name.lower()] = p_url

            m_img = re.search(r'<div class="b-post__infotable_left".*?<img[^>]*src="([^"]+)"', body, re.S)
            if m_img:
                raw_img = m_img.group(1).strip()
                if "nopersonphoto" not in raw_img.lower():
                    m_i = re.search(r"(/i/\d+/\d+/\d+/[^\s\"']+)", raw_img)
                    photo_url = f"{final_mirror.rstrip('/')}{m_i.group(1)}" if m_i else raw_img
                    with client._cache_lock:
                        if len(client.person_photo_by_name) > 1500:
                            for k_ev in list(client.person_photo_by_name.keys())[:375]:
                                client.person_photo_by_name.pop(k_ev, None)
                        client.person_photo_by_name[key] = photo_url

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
                    it_url = client._norm_rezka_asset_url(it_url, final_mirror)
                    it_poster = client._norm_rezka_asset_url(it_poster, final_mirror)
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
    en_wiki_page_title = ""
    if not orig_name and ru_name and re.search(r"[А-Яа-яЁё]", ru_name):
        try:
            ll_qs = urllib.parse.urlencode(
                {
                    "action": "query",
                    "titles": ru_wiki_page_title or ru_name,
                    "prop": "langlinks",
                    "lllang": "en",
                    "redirects": "1",
                    "format": "json",
                }
            )
            ll_data = client._fetch_wiki_json(
                f"https://ru.wikipedia.org/w/api.php?{ll_qs}",
                timeout=2.5,
            )
            pages = (ll_data.get("query") or {}).get("pages") or {}
            for pg in pages.values():
                lls = pg.get("langlinks") or []
                if lls:
                    en_t = (lls[0].get("*") or lls[0].get("title") or "").strip()
                    if en_t:
                        en_wiki_page_title = en_t
                        orig_name = re.sub(r"\s*\([^)]*\)\s*$", "", en_t).strip()
                        break
        except Exception:
            pass

    wiki_candidates = []
    if ru_name:
        wiki_candidates.append(
            ("ru" if re.search(r"[А-Яа-яЁё]", ru_name) else "en", ru_wiki_page_title or ru_name)
        )
    if orig_name:
        wiki_candidates.append(
            ("en" if re.search(r"[A-Za-z]", orig_name) else "ru", en_wiki_page_title or orig_name)
        )

    for wiki_lang, wiki_name in wiki_candidates:
        if wiki_lang == "ru" and bio and photo_url:
            continue
        if wiki_lang == "en" and bio_en and photo_url:
            continue
        try:
            slug = urllib.parse.quote(wiki_name.replace(" ", "_"))
            payload = client._fetch_wiki_json(
                f"https://{wiki_lang}.wikipedia.org/api/rest_v1/page/summary/{slug}",
                timeout=2.8,
            )
            if not payload or payload.get("type") == "disambiguation":
                continue
            if not photo_url:
                thumb = (payload.get("thumbnail") or {}).get("source") or ""
                if thumb.startswith("http"):
                    photo_url = thumb
                    with client._cache_lock:
                        if len(client.person_photo_by_name) > 1500:
                            for k_ev in list(client.person_photo_by_name.keys())[:375]:
                                client.person_photo_by_name.pop(k_ev, None)
                        client.person_photo_by_name[key] = thumb
            ext = (payload.get("extract") or "").strip()
            if ext and len(ext) > 30:
                clipped = ext[:420] + ("…" if len(ext) > 420 else "")
                if wiki_lang == "en" and not bio_en:
                    bio_en = clipped
                elif wiki_lang == "ru" and not bio:
                    bio = clipped
        except Exception:
            pass

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
    if sections and p_url:
        with client._cache_lock:
            if len(client.person_profile_cache) >= 200:
                for k_ev in list(client.person_profile_cache.keys())[:50]:
                    client.person_profile_cache.pop(k_ev, None)
            client.person_profile_cache[cache_key] = copy.deepcopy(result)
    return result
