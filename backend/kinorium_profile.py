from concurrent.futures import ThreadPoolExecutor
import copy
import html
import json
import re
import threading
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

from .kinorium_parsers import _is_placeholder_display_name
from .regions import get_country_profile


class _StatusListResult(dict):
    """dict of parsed Kinorium list items + `incomplete` flag set when any page failed."""

    incomplete: bool = False


def _store_similar_for_kid(self, eff_kid: str, items: List[Dict[str, Any]]) -> None:
    if not eff_kid or not eff_kid.isdigit():
        return
    entry_obj = {
        "updated_at": round(time.time(), 1),
        "items": items,
    }
    with self._similar_lock:
        if len(self._similar_by_kid) >= 1000 and eff_kid not in self._similar_by_kid:
            try:
                self._similar_by_kid.pop(next(iter(self._similar_by_kid)))
            except StopIteration:
                pass
        self._similar_by_kid[eff_kid] = entry_obj
    db_inst = getattr(self, "_db", None)
    if db_inst is not None:
        try:
            db_inst.set_cache_entry("similar_by_kid", eff_kid, entry_obj)
            return
        except Exception:
            pass
    self._save_similar_disk_cache()


def _get_cached_similar_for_kid(self, eff_kid: str, max_age_sec: float = 1209600.0) -> Optional[List[Dict[str, Any]]]:
    if not eff_kid or not eff_kid.isdigit():
        return None
    with self._similar_lock:
        entry = self._similar_by_kid.get(eff_kid)
    if not isinstance(entry, dict):
        return None
    ts = float(entry.get("updated_at") or 0.0)
    if max_age_sec > 0 and (time.time() - ts) > max_age_sec:
        return None
    items = entry.get("items")
    return list(items) if isinstance(items, list) else None


def fetch_movie_page_extras(
    self,
    kid: str = "",
    item_id: str = "",
    title: str = "",
    orig_title: str = "",
    year: Optional[int] = None,
    media_type: str = "",
    allow_network: bool = True,
) -> Dict[str, Any]:
    eff_kid = str(kid or "").strip()
    if not eff_kid.isdigit():
        resolved = self._resolve_kinorium_id(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            allow_network=allow_network,
            media_type=media_type,
            year=year if (year and year > 0) else None,
        )
        eff_kid = str(resolved or "").strip()
    if not eff_kid.isdigit():
        return {"kinorium_id": "", "critics_pct": None, "similar_raw": [], "description": ""}

    with self._state_lock:
        critics_map = self.state.setdefault("critics_by_kid", {})
        desc_map = self.state.setdefault("descriptions_by_kid", {})
        has_cached_critics = eff_kid in critics_map
        cached_critics: Optional[int] = None
        if has_cached_critics:
            cv = critics_map[eff_kid]
            cached_critics = int(cv) if isinstance(cv, int) and cv > 0 else None
        else:
            for skey in ("remote_watching_items", "remote_watchlist_items", "remote_watched_items", "remote_never_items"):
                rem_entry = (self.state.get(skey) or {}).get(eff_kid)
                if isinstance(rem_entry, dict) and rem_entry.get("critics_rating") is not None:
                    c_val = int(rem_entry["critics_rating"])
                    critics_map[eff_kid] = c_val
                    has_cached_critics = True
                    cached_critics = c_val
                    break
        has_cached_desc = eff_kid in desc_map
        cached_desc = str(desc_map.get(eff_kid) or "").strip()

    cached_sim = self._get_cached_similar_for_kid(eff_kid)
    if (has_cached_critics and cached_sim is not None and has_cached_desc) or not allow_network:
        return {
            "kinorium_id": eff_kid,
            "critics_pct": cached_critics,
            "similar_raw": cached_sim or [],
            "description": cached_desc,
        }

    start_pid = self._profile_id
    try:
        body = self.fetch_kinorium_html(f"https://ru.kinorium.com/{eff_kid}/")
        is_valid_movie_html = bool(
            body
            and len(body) >= 1200
            and not ("var x =" in body and ("document['cookie']" in body or "document.cookie" in body))
        )
        if not is_valid_movie_html:
            return {
                "kinorium_id": eff_kid,
                "critics_pct": cached_critics,
                "similar_raw": cached_sim or [],
                "description": cached_desc,
            }
        pct = self.extract_critics_pct(body[:65000])
        desc_extracted = self.extract_movie_description_html(body)
        sim_raw = self.extract_similar_items_html(body)
        if self._profile_id == start_pid:
            with self._state_lock:
                if self._profile_id == start_pid:
                    crit_store = self.state.setdefault("critics_by_kid", {})
                    if len(crit_store) > 4000:
                        for old_ck in list(crit_store.keys())[:-4000]:
                            crit_store.pop(old_ck, None)
                    crit_store[eff_kid] = int(pct) if pct is not None else -1
                    desc_store = self.state.setdefault("descriptions_by_kid", {})
                    if len(desc_store) > 2000:
                        for old_dk in list(desc_store.keys())[:-2000]:
                            desc_store.pop(old_dk, None)
                    if desc_extracted:
                        desc_store[eff_kid] = desc_extracted
                    elif eff_kid not in desc_store:
                        desc_store[eff_kid] = ""
            self._save_state(immediate=False, bump_version=False)
            self._store_similar_for_kid(eff_kid, sim_raw)
        return {
            "kinorium_id": eff_kid,
            "critics_pct": pct,
            "similar_raw": sim_raw,
            "description": desc_extracted or cached_desc,
        }
    except Exception:
        return {
            "kinorium_id": eff_kid,
            "critics_pct": cached_critics,
            "similar_raw": cached_sim or [],
            "description": cached_desc,
        }


def get_similar_catalog_items(
    self,
    kid: str = "",
    item_id: str = "",
    title: str = "",
    orig_title: str = "",
    year: Optional[int] = None,
    media_type: str = "",
    allow_network: bool = True,
    limit: int = 12,
    preloaded_raw: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    if preloaded_raw is not None:
        raw_list = list(preloaded_raw)
    else:
        extras = self.fetch_movie_page_extras(
            kid=kid,
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            year=year,
            media_type=media_type,
            allow_network=allow_network,
        )
        raw_list = list(extras.get("similar_raw") or [])

    if not raw_list:
        return []

    rated_high = sum(1 for r in raw_list if isinstance(r.get("kinorium_rating"), (int, float)) and float(r["kinorium_rating"]) >= 6.0)
    with self._state_lock:
        friends_by_kid = dict(self.state.get("friends_ratings_by_kid") or {})
        critics_by_kid = dict(self.state.get("critics_by_kid") or {})
        by_kid_snap = dict(self._by_kid)
    scored: List[tuple] = []

    for idx, raw in enumerate(raw_list):
        skid = str(raw.get("kinorium_id") or "").strip()
        if not skid.isdigit():
            continue
        kr_raw = raw.get("kinorium_rating")
        if kr_raw is None and rated_high >= 4:
            continue
        kr_num = float(kr_raw) if isinstance(kr_raw, (int, float)) else 6.8
        if rated_high >= 6 and kr_num < 5.8:
            continue

        sim_id = f"kin_{skid}"
        ru_t = str(raw.get("ru_title") or "").strip()
        orig_t = str(raw.get("orig_title") or ru_t).strip()
        mtype = "series" if raw.get("media_type") == "series" else "movie"
        yr_val = int(raw.get("year") or 0)

        k_status = self.get_item_status(sim_id, title=ru_t, orig_title=orig_t)
        if k_status.get("not_watching"):
            continue

        rem_entry = by_kid_snap.get(skid) or {}
        genres = list(rem_entry.get("genres") or (["Сериал"] if mtype == "series" else ["Фильм"]))
        imdb_val = float(rem_entry.get("imdb_rating") or kr_num)
        critics_val = rem_entry.get("critics_rating")
        if critics_val is None:
            c_cached = critics_by_kid.get(skid)
            if isinstance(c_cached, int) and c_cached > 0:
                critics_val = c_cached

        fr_list = friends_by_kid.get(skid) or []
        fr_avg = (
            sum(float(f["score"]) for f in fr_list if f.get("score")) / len(fr_list)
            if fr_list
            else 0.0
        )

        rank_score = kr_num * 1.15
        if media_type in ("movie", "series") and mtype == media_type:
            rank_score += 1.35
        if not k_status.get("watched"):
            rank_score += 0.75
        if k_status.get("in_watchlist"):
            rank_score += 0.55
        if fr_avg >= 7.8:
            rank_score += 0.65
        if yr_val >= 2005:
            rank_score += 0.25
        rank_score -= idx * 0.01

        if k_status.get("in_watchlist"):
            reason_ru = "В списке «Буду смотреть»"
            reason_en = "In your Watchlist"
        elif fr_avg >= 7.8:
            fr_disp = f"{fr_avg:.1f}".rstrip("0").rstrip(".")
            reason_ru = f"Оценка друзей {fr_disp}"
            reason_en = f"Friends rated {fr_disp}"
        else:
            reason_ru = "Подборка Kinorium"
            reason_en = "Kinorium similar"

        ratings_obj: Dict[str, Any] = {
            "kinorium": round(kr_num, 1),
            "imdb": round(imdb_val, 1),
        }
        if critics_val is not None:
            ratings_obj["critics"] = int(critics_val)

        item_dict: Dict[str, Any] = {
            "id": sim_id,
            "kinorium_id": skid,
            "title": ru_t,
            "orig_title": orig_t,
            "title_pl": orig_t,
            "year": yr_val or "",
            "media_type": mtype,
            "seasons_count": int(rem_entry.get("seasons_count") or 1),
            "episodes_per_season": int(rem_entry.get("episodes_per_season") or (0 if mtype == "series" else 1)),
            "genres": genres[:3],
            "description": str(rem_entry.get("description") or f"{ru_t} ({orig_t})"),
            "poster": str(rem_entry.get("poster") or f"https://ru-images.kinorium.com/movie/600/{skid}.jpg"),
            "poster_en": f"https://en-images.kinorium.com/movie/600/{skid}.jpg",
            "backdrop": str(rem_entry.get("backdrop") or f"https://ru-images.kinorium.com/movie/1080/{skid}.jpg"),
            "ambient_color": "#1e293b",
            "ratings": ratings_obj,
            "providers": [
                {"id": "hdrezka", "available": True, "quality": "1080p", "audio": "RU/EN"},
                {"id": "backup4k", "available": True, "quality": "4K Remux", "audio": "RU/EN"},
            ],
            "kinorium": k_status,
            "similar_source": "kinorium",
            "similar_reason": reason_ru,
            "similar_reason_en": reason_en,
        }
        if rem_entry.get("rezka_id"):
            item_dict["rezka_id"] = str(rem_entry["rezka_id"])
        if rem_entry.get("rezka_url"):
            item_dict["rezka_url"] = str(rem_entry["rezka_url"])

        scored.append((rank_score, item_dict))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [it for _, it in scored[: max(1, int(limit))]]


def _refresh_online_premieres_sync(self) -> List[Dict[str, Any]]:
    start_pid = self._profile_id
    results_map: Dict[str, str] = {}

    def _fetch_one(key: str, url: str) -> None:
        try:
            results_map[key] = self.fetch_kinorium_html(url)
        except Exception:
            results_map[key] = ""

    _fetch_one("movies", "https://ru.kinorium.com/movies/online/?perpage=100")
    _fetch_one("shows", "https://ru.kinorium.com/shows/popular/?perpage=100")

    online_movies = self.parse_premieres_list_html(results_map.get("movies", ""))
    fresh_series = self.parse_premieres_list_html(
        results_map.get("shows", ""),
        forced_media_type="series",
        min_year=2025,
        require_rating=True,
    )

    combined: List[Dict[str, Any]] = []
    seen_kids = set()
    with self._state_lock:
        friend_id_by_name = {
            str(f.get("name") or "").strip(): str(f.get("id") or "")
            for f in (self.state.get("friends") or [])
            if isinstance(f, dict) and f.get("name")
        }
        own_name = str(self.state.get("account", {}).get("display_name") or "").strip()
    updated_friends_cache = False

    for it in online_movies + fresh_series:
        kid = str(it.get("kinorium_id") or "")
        if kid and kid in seen_kids:
            continue
        if kid:
            seen_kids.add(kid)
        f_tips = it.pop("friends_tooltip", None) or []
        if kid and f_tips and self._profile_id == start_pid:
            with self._state_lock:
                if self._profile_id == start_pid:
                    fbk = self.state.setdefault("friends_ratings_by_kid", {})
                    cur_list = list(fbk.get(kid) or [])
                    by_name = {str(x.get("name") or ""): x for x in cur_list if isinstance(x, dict) and x.get("name")}
                    for ft in f_tips:
                        fnm = str(ft.get("name") or "").strip()
                        fsc = ft.get("score")
                        if not fnm or fnm == own_name or not fsc:
                            continue
                        by_name[fnm] = {
                            "name": fnm,
                            "user_id": friend_id_by_name.get(fnm) or by_name.get(fnm, {}).get("user_id", ""),
                            "score": int(fsc),
                        }
                        updated_friends_cache = True
                    fbk[kid] = list(by_name.values())
        combined.append(it)

    if updated_friends_cache and self._profile_id == start_pid:
        try:
            self._save_state()
        except Exception:
            pass

    if combined:
        now = time.time()
        with self._state_lock:
            self._online_premieres_mem = combined
            self._online_premieres_ts = now
            self._state_version += 1
        try:
            self._db.set_kv("cache", "online_premieres", {"updated_at": now, "items": combined})
        except Exception:
            pass
    return combined


def _maybe_trigger_bg_premieres_refresh(self, now: float) -> None:
    with self._state_lock:
        if (
            self._online_premieres_refreshing
            or (now - self._online_premieres_ts) < 1800
            or (now - self._online_premieres_last_attempt_ts) < 300
        ):
            return
        self._online_premieres_refreshing = True
        self._online_premieres_last_attempt_ts = now

    def _bg_refresh() -> None:
        try:
            self._refresh_online_premieres_sync()
        finally:
            with self._state_lock:
                self._online_premieres_refreshing = False

    threading.Thread(target=_bg_refresh, daemon=True).start()


def get_online_premieres_count(self, allow_network: bool = True) -> int:
    now = time.time()
    with self._state_lock:
        if self._online_premieres_mem:
            cached_copy = [dict(it) for it in self._online_premieres_mem]
        else:
            cached_copy = []
    if cached_copy:
        if allow_network:
            self._maybe_trigger_bg_premieres_refresh(now)
        items = cached_copy
    elif allow_network:
        items = self.fetch_online_premieres(force_refresh=False)
    else:
        return 0
    if not self.is_service_enabled("kinorium"):
        return len(items)
    count = 0
    for it in items:
        k_status = self.get_item_status(
            str(it.get("id") or ""),
            base_kinorium_rating=float((it.get("ratings") or {}).get("kinorium") or 7.8),
            title=str(it.get("title") or ""),
            orig_title=str(it.get("orig_title") or ""),
        )
        if not self.is_item_fully_watched_or_caught_up(
            k_status, media_type=str(it.get("media_type") or "movie")
        ):
            count += 1
    return count


def fetch_online_premieres(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
    now = time.time()
    if not force_refresh:
        with self._state_lock:
            if self._online_premieres_mem:
                cached_copy = [dict(it) for it in self._online_premieres_mem]
            else:
                cached_copy = []
        if cached_copy:
            self._maybe_trigger_bg_premieres_refresh(now)
            return cached_copy
        self._preload_premieres_disk_cache()
        with self._state_lock:
            if self._online_premieres_mem:
                cached_copy = [dict(it) for it in self._online_premieres_mem]
            last_att = self._online_premieres_last_attempt_ts
        if cached_copy:
            self._maybe_trigger_bg_premieres_refresh(now)
            return cached_copy
        if (now - last_att) < 300.0 or self.is_ip_cooldown_active():
            return []

    with self._state_lock:
        self._online_premieres_last_attempt_ts = now
    fresh = self._refresh_online_premieres_sync()
    return [dict(it) for it in fresh]


def fetch_status_list_ajax(self, user_id: str, status_code: str, max_pages: int = 3) -> Dict[str, Dict[str, Any]]:
    """
    Returns the parsed list. When any page fails (network error, anti-bot page, missing
    `result` payload) the returned dict carries `incomplete=True` so callers can keep the
    previously synced section instead of wiping it.
    """
    collected: "_StatusListResult" = _StatusListResult()
    for page_num in range(1, max_pages + 1):
        url = (
            f"https://ru.kinorium.com/handlers/getStatusList/"
            f"?type=self&user_id={user_id}&mode=movie&requestMode=onlyList"
            f"&perpage=200&page={page_num}&filter%5Bstatus%5D%5B%5D={status_code}"
        )
        try:
            raw_json = self.fetch_kinorium_html(
                url,
                extra_headers={
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": f"https://ru.kinorium.com/user/{user_id}/ratings/",
                },
            )
            data = json.loads(raw_json)
            if not isinstance(data, dict) or not isinstance(data.get("result"), dict):
                collected.incomplete = True
                break
            html_chunk = data["result"].get("html", "") or data["result"].get("content", "")
            parsed = self.parse_movie_list_html(html_chunk, default_status=status_code)
            if not parsed:
                break
            collected.update(parsed)
            if len(parsed) < 190:
                break
        except Exception:
            collected.incomplete = True
            break
    return collected


def _verify_recent_watchlist_online_availability(
    self, watchlist_items: Dict[str, Dict[str, Any]]
) -> None:
    """
    Verifies online streaming / HDRezka / 4K Remux availability for recent (2025+)
    items in 'Буду смотреть', hiding unreleased or theatrical-only titles that do not yet
    have online streams.
    """
    from .hdrezka import HDRezkaClient, _RejectedMeta

    prev_wl = self.state.get("remote_watchlist_items") or {}
    rc = getattr(self, "_rezka_client", None) or HDRezkaClient(self.net)
    to_check: List[str] = []

    cur_yr = time.localtime().tm_year
    for kid, v in watchlist_items.items():
        yr_num = int(v.get("year") or 0)
        if v.get("is_unreleased") or (yr_num and yr_num > cur_yr):
            v["available_online"] = False
            continue
        prev_entry = prev_wl.get(kid)
        if prev_entry and "available_online" in prev_entry and "rezka_checked" in prev_entry:
            v["available_online"] = prev_entry["available_online"]
            v["rezka_checked"] = True
            if prev_entry.get("rezka_id"):
                v["rezka_id"] = prev_entry["rezka_id"]
            if prev_entry.get("rezka_url"):
                v["rezka_url"] = prev_entry["rezka_url"]
            continue
        if int(v.get("year") or 2024) >= 2025:
            to_check.append(kid)
        else:
            v["available_online"] = True

    def _check_kid(kid_str: str) -> None:
        v = watchlist_items[kid_str]
        yr = int(v.get("year") or 2025)
        mtype = v.get("media_type", "movie")
        try:
            meta = rc._resolve_page_metadata(
                "",
                v.get("ru_title", ""),
                v.get("orig_title", ""),
                None,
                yr,
                mtype,
            )
            if not meta and not isinstance(meta, _RejectedMeta):
                # Transient network / mirror failure: keep released items visible and retry next sync
                v["available_online"] = yr <= cur_yr
                return
            r_url = meta.get("rezka_url") or ""
            year_ok = (
                (str(yr) in r_url)
                or (str(yr - 1) in r_url)
                or (mtype == "series" and bool(meta.get("seasons_map")))
            )
            has_stream_data = False
            if year_ok and r_url:
                if meta.get("inline_streams"):
                    has_stream_data = True
                else:
                    st_res = rc.get_streams_for_title(
                        "",
                        title=v.get("ru_title", ""),
                        orig_title=v.get("orig_title", ""),
                        year=yr,
                        media_type=mtype,
                        rezka_url=r_url,
                    )
                    has_stream_data = bool(st_res.get("qualities"))
            if has_stream_data and year_ok:
                v["available_online"] = True
                v["rezka_id"] = meta.get("rezka_id")
                v["rezka_url"] = r_url
            else:
                v["available_online"] = False
            v["rezka_checked"] = True
        except Exception:
            v["available_online"] = yr <= cur_yr

    if to_check:
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(_check_kid, to_check))


def _resolve_friend_user_by_name_ajax(self, full_name: str, self_user_id: str = "") -> Optional[Dict[str, Any]]:
    clean_name = str(full_name or "").strip()
    if not clean_name:
        return None
    full_norm = clean_name.lower().replace("ё", "е")
    parts = [p.strip() for p in re.split(r"[\s_.-]+", clean_name) if len(p.strip()) >= 3]
    queries: List[str] = [clean_name]
    for p in sorted(parts, key=len, reverse=True):
        if p not in queries:
            queries.append(p)

    seen_q = set()
    best_followed: Optional[Dict[str, Any]] = None
    best_exact: Optional[Dict[str, Any]] = None
    for q in queries[:3]:
        q_low = q.lower()
        if q_low in seen_q:
            continue
        seen_q.add(q_low)
        try:
            qs = urllib.parse.urlencode({"str": q, "filters[only_user]": 1})
            raw_json = self.fetch_kinorium_html(
                f"https://ru.kinorium.com/handlers/Search/?{qs}",
                extra_headers={
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": "https://ru.kinorium.com/",
                },
            )
            data = json.loads(raw_json)
            candidates = (data.get("user") or {}).get("search") or []
            for c in candidates:
                if not isinstance(c, dict):
                    continue
                cid = str(c.get("user_id") or c.get("id") or "").strip()
                if not cid.isdigit() or (self_user_id and cid == str(self_user_id)):
                    continue
                sn = html.unescape(str(c.get("screenName") or "")).strip()
                n1 = html.unescape(str(c.get("name") or "")).strip()
                n2 = html.unescape(str(c.get("surname") or "")).strip()
                combined = f"{n1} {n2}".strip()
                sn_norm = sn.lower().replace("ё", "е")
                comb_norm = combined.lower().replace("ё", "е")
                if sn_norm == full_norm or comb_norm == full_norm:
                    if c.get("is_followed_by_me") or c.get("is_my_follower"):
                        best_followed = c
                        break
                    if best_exact is None:
                        best_exact = c
            if best_followed is not None:
                break
        except Exception:
            continue

    chosen = best_followed or best_exact
    if not chosen:
        return None
    fid = str(chosen.get("user_id") or chosen.get("id") or "").strip()
    if not fid.isdigit():
        return None
    fname = html.unescape(str(chosen.get("screenName") or clean_name)).strip() or clean_name
    return {
        "id": fid,
        "name": fname,
        "avatar": f"https://images.kinorium.com/user/96/{fid}.jpg",
        "is_followed_by_me": bool(chosen.get("is_followed_by_me")),
        "is_my_follower": bool(chosen.get("is_my_follower")),
    }


def sync_user_profile(
    self,
    user_identifier: str = "",
    session_cookie: Optional[str] = None,
    display_name_hint: str = "",
) -> Dict[str, Any]:
    """
    Synchronizes a real Kinorium profile (supports switching to any Kinorium user):
    - Display name & counts
    - 'Смотрю' (status=now)
    - 'Буду смотреть' (status=future, verified for online availability)
    - 'Просмотрено' & ratings (status=done)
    - 'Не буду смотреть' (status=never)
    - Real friends list (/following/) & their ratings
    """
    with self._state_lock:
        sync_start_profile_id = self._profile_id
        acc_snap = dict(self.state.get("account") or {})
        prev_user_id = str(acc_snap.get("user_id") or "")
        prev_display_name = str(acc_snap.get("display_name") or "").strip()
        prev_cookie = str(acc_snap.get("session_cookie") or "").strip()
        prev_friends_snap = [dict(f) for f in (self.state.get("friends") or []) if isinstance(f, dict)]
        prev_friends_ratings_snap = copy.deepcopy(self.state.get("friends_ratings_by_kid") or {})
        prev_friend_titles_snap = copy.deepcopy(self.state.get("friend_known_titles") or {})
        prev_remote_sections = {
            sk: {str(k): dict(v) for k, v in (self.state.get(sk) or {}).items() if isinstance(v, dict)}
            for sk in (
                "remote_watching_items",
                "remote_never_items",
                "remote_watchlist_items",
                "remote_watched_items",
            )
        }

    effective_cookie = prev_cookie
    provided_new_cookie = False
    new_cookie_uid = ""
    if session_cookie is not None and session_cookie.strip():
        cleaned_cookie = self.sanitize_session_cookie(session_cookie)
        if cleaned_cookie:
            effective_cookie = cleaned_cookie
            provided_new_cookie = True
            new_cookie_uid = self.extract_cookie_user_id(cleaned_cookie)

    with self._cookie_lock:
        self._kinorium_cookie_cache = ""
    self._session_auth_verified = None
    self._ip_blocked_until = 0.0

    self._sync_cookie_tl.cookie = effective_cookie
    try:
        user_path = self.extract_user_path(user_identifier)
        if provided_new_cookie and new_cookie_uid:
            user_path = f"/user/{new_cookie_uid}/"

        if not user_path and effective_cookie:
            ck_uid = self.extract_cookie_user_id(effective_cookie)
            if ck_uid:
                user_path = f"/user/{ck_uid}/"
            else:
                prev_ia = getattr(self._sync_cookie_tl, "include_auth", False)
                self._sync_cookie_tl.include_auth = True
                try:
                    home_html = self.fetch_kinorium_html("https://ru.kinorium.com/")
                    m_cookie_uid = re.search(r"\bUSER_ID\s*=\s*['\"]?(\d+)['\"]?", home_html)
                    if m_cookie_uid and int(m_cookie_uid.group(1)) > 0:
                        user_path = f"/user/{m_cookie_uid.group(1)}/"
                except Exception:
                    pass
                finally:
                    self._sync_cookie_tl.include_auth = prev_ia
        if not user_path:
            raise ValueError("Укажите ID или ссылку на профиль Kinorium")

        m_path_uid = re.search(r"/user/(\d+)/", user_path)
        early_target_uid = m_path_uid.group(1) if m_path_uid else ""
        if prev_user_id and early_target_uid and early_target_uid != prev_user_id and not provided_new_cookie:
            existing_ck_uid = self.extract_cookie_user_id(effective_cookie)
            if not existing_ck_uid or existing_ck_uid != early_target_uid:
                effective_cookie = ""
                self._sync_cookie_tl.cookie = ""
                with self._cookie_lock:
                    self._kinorium_cookie_cache = ""

        base_url = f"https://ru.kinorium.com{user_path}"

        prev_ia_prof = getattr(self._sync_cookie_tl, "include_auth", False)
        self._sync_cookie_tl.include_auth = bool(effective_cookie)
        try:
            prof_html = self.fetch_kinorium_html(base_url)
        finally:
            self._sync_cookie_tl.include_auth = prev_ia_prof
        if self._profile_id != sync_start_profile_id:
            return {"ok": False, "synced": False, "error": "profile_switched_during_sync"}

        m_uid = re.search(r"/user/(\d+)/", user_path) or re.search(r"data-user_id=['\"](\d+)['\"]", prof_html)
        user_id = m_uid.group(1) if m_uid else user_identifier.strip("/").replace("user/", "")
        fallback_ident = "" if str(user_id) == "51670" else user_identifier
        display_name = self._extract_profile_display_name(prof_html, fallback_ident)

        if _is_placeholder_display_name(display_name, str(user_id)):
            ck_name = self._extract_cookie_display_name(effective_cookie)
            if not _is_placeholder_display_name(ck_name, str(user_id)):
                display_name = ck_name
        if _is_placeholder_display_name(display_name, str(user_id)):
            clean_hint = str(display_name_hint or "").strip()
            if not _is_placeholder_display_name(clean_hint, str(user_id)):
                display_name = clean_hint
            elif str(user_id) == prev_user_id and not _is_placeholder_display_name(prev_display_name, str(user_id)):
                display_name = prev_display_name
        if str(user_id) == "51670" and _is_placeholder_display_name(display_name, str(user_id)):
            display_name = "Andrei Crustillio"
        avatar_url = self._extract_profile_avatar_url(prof_html, user_id)

        is_switching_user = bool(prev_user_id and str(user_id) != prev_user_id)
        if is_switching_user and not provided_new_cookie:
            existing_ck_uid = self.extract_cookie_user_id(effective_cookie)
            if not existing_ck_uid or existing_ck_uid != str(user_id):
                effective_cookie = ""
                self._sync_cookie_tl.cookie = ""
                with self._cookie_lock:
                    self._kinorium_cookie_cache = ""

        if effective_cookie:
            ck_uid = self.extract_cookie_user_id(effective_cookie)
            m_page_authed = re.search(r"\bUSER_ID\s*=\s*['\"]?(\d+)['\"]?", prof_html)
            page_authed_uid = m_page_authed.group(1) if (m_page_authed and int(m_page_authed.group(1)) > 0) else ""
            if ck_uid and ck_uid != str(user_id):
                effective_cookie = ""
                self._sync_cookie_tl.cookie = ""
                with self._cookie_lock:
                    self._kinorium_cookie_cache = ""
                self._session_auth_verified = False
            elif page_authed_uid and page_authed_uid != str(user_id):
                effective_cookie = ""
                self._sync_cookie_tl.cookie = ""
                with self._cookie_lock:
                    self._kinorium_cookie_cache = ""
                self._session_auth_verified = False
            elif not ck_uid and "session=" not in effective_cookie and page_authed_uid != str(user_id):
                effective_cookie = ""
                self._sync_cookie_tl.cookie = ""
                with self._cookie_lock:
                    self._kinorium_cookie_cache = ""
                self._session_auth_verified = False
            else:
                self._session_auth_verified = bool(page_authed_uid == str(user_id))

        # 1. Fetch user's real friends (/following/) early before heavy status pagination
        friends_list: List[Dict[str, Any]] = []
        try:
            foll_html = self.fetch_kinorium_html(f"{base_url}following/")
            friends_list = self._parse_following_html(foll_html, str(user_id))
        except Exception:
            pass

        if not friends_list and prof_html:
            friends_list = self._parse_following_html(prof_html, str(user_id))

        if not friends_list and not is_switching_user and prev_friends_snap:
            friends_list = [dict(f) for f in prev_friends_snap]

        incomplete_sections: List[str] = []

        def _keep_prev_if_incomplete(fresh: Dict[str, Dict[str, Any]], state_key: str) -> Dict[str, Dict[str, Any]]:
            if getattr(fresh, "incomplete", False):
                incomplete_sections.append(state_key)
            if getattr(fresh, "incomplete", False) and not is_switching_user:
                prev = prev_remote_sections.get(state_key) or {}
                if isinstance(prev, dict) and prev:
                    merged_prev = {str(k): dict(v) for k, v in prev.items() if isinstance(v, dict)}
                    merged_prev.update(fresh)
                    return merged_prev
            return dict(fresh)

        # 2. Fetch 'Смотрю' (status=now)
        watching_items = _keep_prev_if_incomplete(
            self.fetch_status_list_ajax(user_id, "now", max_pages=2), "remote_watching_items"
        )

        # 3. Fetch 'Не буду смотреть' (status=never)
        never_items = _keep_prev_if_incomplete(
            self.fetch_status_list_ajax(user_id, "never", max_pages=3), "remote_never_items"
        )

        # 4. Fetch 'Буду смотреть' (status=future, up to 3 pages = 600 items)
        watchlist_items = _keep_prev_if_incomplete(
            self.fetch_status_list_ajax(user_id, "future", max_pages=3), "remote_watchlist_items"
        )
        self._verify_recent_watchlist_online_availability(watchlist_items)

        # 5. Fetch all watched/rated pages of the user (status=done, up to 8 pages = 1600 items)
        watched_raw = self.fetch_status_list_ajax(user_id, "done", max_pages=8)
        watched_fetch_incomplete = bool(getattr(watched_raw, "incomplete", False))
        watched_items = dict(watched_raw)
        if not watched_items:
            fallback_complete = False
            for page_num in range(1, 9):
                p_url = f"{base_url}ratings/?perpage=200&page={page_num}"
                try:
                    p_html = self.fetch_kinorium_html(p_url)
                    parsed = self.parse_movie_list_html(p_html, default_status="done")
                    if not parsed:
                        fallback_complete = bool(watched_items)
                        break
                    watched_items.update(parsed)
                    if len(parsed) < 190:
                        fallback_complete = True
                        break
                    if page_num == 8:
                        fallback_complete = True
                except Exception:
                    break
            if fallback_complete and watched_items:
                watched_fetch_incomplete = False
        if watched_fetch_incomplete and not is_switching_user:
            incomplete_sections.append("done")
            prev_done = prev_remote_sections.get("remote_watched_items") or {}
            if isinstance(prev_done, dict) and prev_done:
                merged_done = {str(k): dict(v) for k, v in prev_done.items() if isinstance(v, dict)}
                merged_done.update(watched_items)
                watched_items = merged_done

        # 6. Collect real friends' ratings & comments for ANY connected Kinorium user
        friend_id_by_name = {
            str(f.get("name") or "").strip(): str(f.get("id") or "")
            for f in friends_list
            if str(f.get("name") or "").strip() and str(f.get("id") or "").isdigit()
        }
        friends_map_by_kid: Dict[str, Dict[str, Dict[str, Any]]] = {}
        tooltip_friend_counts: Dict[str, int] = {}
        local_friend_known_titles: Dict[str, Dict[str, Any]] = (
            {} if is_switching_user else dict(prev_friend_titles_snap)
        )

        if not is_switching_user and isinstance(prev_friends_ratings_snap, dict):
            for _prev_kid, prev_flist in prev_friends_ratings_snap.items():
                if not isinstance(prev_flist, list):
                    continue
                for pf in prev_flist:
                    if not isinstance(pf, dict):
                        continue
                    pfn = str(pf.get("name") or "").strip()
                    puid = str(pf.get("user_id") or "").strip()
                    if pfn and puid.isdigit() and pfn not in friend_id_by_name:
                        friend_id_by_name[pfn] = puid

        def _upsert_friend_score(
            kid_key: str,
            f_name: str,
            f_uid: str,
            f_score: Any,
            f_comment: str = "",
        ) -> None:
            fn = str(f_name or "").strip()
            if not fn or fn == display_name or not f_score:
                return
            try:
                sc_int = int(f_score)
            except Exception:
                return
            if not (1 <= sc_int <= 10):
                return
            uid_resolved = str(f_uid or friend_id_by_name.get(fn) or "")
            existing_f = friends_map_by_kid.setdefault(str(kid_key), {}).get(fn) or {}
            clean_cm = str(f_comment or existing_f.get("comment") or "").strip()
            entry_f: Dict[str, Any] = {
                "name": fn,
                "user_id": uid_resolved or str(existing_f.get("user_id") or ""),
                "score": sc_int,
            }
            if clean_cm:
                entry_f["comment"] = clean_cm
            friends_map_by_kid[str(kid_key)][fn] = entry_f

        for status_dict in (watched_items, watching_items, watchlist_items, never_items):
            for kid, st_item in status_dict.items():
                for ft in st_item.pop("friends_tooltip", None) or []:
                    fn_tip = str(ft.get("name") or "").strip()
                    if fn_tip and fn_tip != display_name:
                        tooltip_friend_counts[fn_tip] = tooltip_friend_counts.get(fn_tip, 0) + 1
                    _upsert_friend_score(kid, fn_tip, "", ft.get("score"))

        known_friend_names = {str(f.get("name") or "").strip() for f in friends_list if f.get("name")}
        unresolved_names = [
            fn
            for fn, _cnt in sorted(tooltip_friend_counts.items(), key=lambda kv: kv[1], reverse=True)
            if fn and fn not in friend_id_by_name
        ]
        if unresolved_names:
            def _resolve_one(fn_target: str) -> Tuple[str, Optional[Dict[str, Any]]]:
                self._sync_cookie_tl.cookie = effective_cookie
                try:
                    return fn_target, self._resolve_friend_user_by_name_ajax(fn_target, str(user_id))
                finally:
                    self._sync_cookie_tl.cookie = None

            with ThreadPoolExecutor(max_workers=min(2, len(unresolved_names[:6]))) as pool:
                for fn_target, resolved_obj in pool.map(_resolve_one, unresolved_names[:6]):
                    if resolved_obj and str(resolved_obj.get("id") or "").isdigit():
                        r_fid = str(resolved_obj["id"])
                        friend_id_by_name[fn_target] = r_fid
                        friend_id_by_name[str(resolved_obj.get("name") or fn_target)] = r_fid
                        if fn_target not in known_friend_names and not any(str(f.get("id")) == r_fid for f in friends_list):
                            friends_list.append(
                                {
                                    "id": r_fid,
                                    "name": fn_target,
                                    "avatar": f"https://images.kinorium.com/user/96/{r_fid}.jpg",
                                    "kinorium_similar_count": tooltip_friend_counts.get(fn_target, 1),
                                }
                            )
                            known_friend_names.add(fn_target)

        for fn_tip, sim_cnt in sorted(tooltip_friend_counts.items(), key=lambda kv: kv[1], reverse=True):
            if fn_tip not in known_friend_names:
                r_fid = str(friend_id_by_name.get(fn_tip) or "")
                f_entry: Dict[str, Any] = {
                    "id": r_fid,
                    "name": fn_tip,
                    "avatar": f"https://images.kinorium.com/user/96/{r_fid}.jpg" if r_fid.isdigit() else "",
                    "kinorium_similar_count": sim_cnt,
                }
                friends_list.append(f_entry)
                known_friend_names.add(fn_tip)

        for fdict in friends_map_by_kid.values():
            for fn_k, f_entry in fdict.items():
                if not f_entry.get("user_id") and friend_id_by_name.get(fn_k):
                    f_entry["user_id"] = friend_id_by_name[fn_k]

        friends_with_valid_id = [
            f for f in friends_list[:8] if str(f.get("id") or "").isdigit()
        ]

        def _fetch_friend_done_items(friend_obj: Dict[str, Any]) -> Tuple[str, str, Dict[str, Dict[str, Any]]]:
            self._sync_cookie_tl.cookie = effective_cookie
            try:
                fid_s = str(friend_obj["id"])
                fname_s = str(friend_obj["name"])
                try:
                    items = self.fetch_status_list_ajax(fid_s, "done", max_pages=2)
                    if items:
                        return fid_s, fname_s, items
                except Exception:
                    pass
                fallback_items: Dict[str, Dict[str, Any]] = {}
                for f_page in range(1, 3):
                    try:
                        fr_html = self.fetch_kinorium_html(
                            f"https://ru.kinorium.com/user/{fid_s}/ratings/?perpage=200&page={f_page}"
                        )
                        f_parsed = self.parse_movie_list_html(fr_html, default_status="done")
                        if not f_parsed:
                            break
                        fallback_items.update(f_parsed)
                        if len(f_parsed) < 190:
                            break
                    except Exception:
                        break
                return fid_s, fname_s, fallback_items
            finally:
                self._sync_cookie_tl.cookie = None

        if friends_with_valid_id:
            with ThreadPoolExecutor(max_workers=min(2, len(friends_with_valid_id))) as pool:
                friend_results = list(pool.map(_fetch_friend_done_items, friends_with_valid_id))
            for fid, fname, f_items in friend_results:
                for kid, f_item in f_items.items():
                    for ft in f_item.pop("friends_tooltip", None) or []:
                        _upsert_friend_score(kid, ft.get("name", ""), "", ft.get("score"))
                    if f_item.get("score"):
                        _upsert_friend_score(
                            kid,
                            fname,
                            fid,
                            f_item["score"],
                            str(f_item.get("comment") or ""),
                        )
                    elif f_item.get("comment"):
                        existing_cm = (friends_map_by_kid.get(str(kid)) or {}).get(fname)
                        if existing_cm and existing_cm.get("score"):
                            existing_cm["comment"] = str(f_item["comment"]).strip()
                    if kid not in watched_items and kid not in watchlist_items:
                        local_friend_known_titles[kid] = {
                            "kinorium_id": kid,
                            "ru_title": f_item.get("ru_title", ""),
                            "orig_title": f_item.get("orig_title", ""),
                        }
    finally:
        self._sync_cookie_tl.cookie = None

    friends_ratings_by_kid: Dict[str, List[Dict[str, Any]]] = {
        kid: list(fdict.values()) for kid, fdict in friends_map_by_kid.items() if fdict
    }

    if not friends_ratings_by_kid and not is_switching_user and prev_friends_ratings_snap:
        friends_ratings_by_kid = prev_friends_ratings_snap

    cur_yr = time.localtime().tm_year
    wl_online_count = sum(
        1
        for v in watchlist_items.values()
        if v.get("available_online", True)
        and not v.get("is_unreleased", False)
        and (int(v.get("year") or 0) == 0 or int(v.get("year") or 0) <= cur_yr)
    )

    with self._state_lock:
        if self._profile_id != sync_start_profile_id:
            return {"ok": False, "synced": False, "error": "profile_switched_during_sync"}

        with self._episodes_lock:
            self._series_episodes_cache.clear()
        with self._cookie_lock:
            self._kinorium_cookie_cache = ""

        if is_switching_user:
            self.state["watched"] = {}
            self.state["ratings"] = {}
            self.state["watchlist"] = []
            self.state["watchlist_removed"] = []
            self.state["watching_local"] = []
            self.state["watching_removed"] = []
            self.state["never_local"] = []
            self.state["never_removed"] = []
            self.state["continue_watching"] = []
            self.state["friends"] = []
            self.state["friends_ratings_by_kid"] = {}
            self.state["friend_known_titles"] = {}
            self.state["remote_watched_items"] = {}
            self.state["remote_watching_items"] = {}
            self.state["remote_watchlist_items"] = {}
            self.state["remote_never_items"] = {}
            self.state["watched_episodes"] = {}
            self.state["unwatched_episodes"] = {}
            self.state["episode_ratings"] = {}
            self.state["cleared_episode_ratings"] = {}
            self.state["cw_dismissed"] = []
            self.state["cw_dismissed_entries"] = {}

        if _is_placeholder_display_name(display_name, str(user_id)):
            display_name = "Andrei Crustillio" if str(user_id) == "51670" else ""

        self.state["account"]["session_cookie"] = effective_cookie
        self.state["account"]["connected"] = True
        self.state["account"]["user_id"] = str(user_id)
        self.state["account"]["profile_url"] = f"https://en.kinorium.com{user_path}"
        self.state["account"]["username"] = f"{display_name} (user/{user_id})" if display_name else f"user/{user_id}"
        self.state["account"]["display_name"] = display_name
        self.state["account"]["avatar_url"] = avatar_url
        self.state["account"]["watched_count"] = len(watched_items)
        self.state["account"]["watching_count"] = len(watching_items)
        self.state["account"]["watchlist_count"] = wl_online_count
        self.state["account"]["never_count"] = len(never_items)
        self.state["account"]["friends_count"] = len(friends_list)
        self.state["account"]["last_synced"] = time.strftime("%Y-%m-%d %H:%M")

        if not is_switching_user:
            loc_watched_map = self.state.get("watched") or {}
            loc_ratings_map = self.state.get("ratings") or {}
            rem_wt_set = {str(x) for x in (self.state.get("watching_removed") or [])}
            rem_wl_set = {str(x) for x in (self.state.get("watchlist_removed") or [])}
            rem_nv_set = {str(x) for x in (self.state.get("never_removed") or [])}
            for kid_k in list(watched_items.keys()):
                w_loc = loc_watched_map.get(f"kin_{kid_k}") or loc_watched_map.get(str(kid_k))
                if isinstance(w_loc, dict) and w_loc.get("watched") is False and not w_loc.get("remote_unwatched_pushed"):
                    watched_items.pop(kid_k, None)
                    continue
                r_loc = loc_ratings_map.get(f"kin_{kid_k}") or loc_ratings_map.get(str(kid_k))
                if isinstance(r_loc, dict) and r_loc.get("cleared") and not r_loc.get("remote_cleared_pushed"):
                    if isinstance(watched_items.get(kid_k), dict):
                        watched_items[kid_k]["score"] = None
            for kid_k in list(watching_items.keys()):
                if str(kid_k) in rem_wt_set or f"kin_{kid_k}" in rem_wt_set:
                    watching_items.pop(kid_k, None)
                    continue
                r_loc = loc_ratings_map.get(f"kin_{kid_k}") or loc_ratings_map.get(str(kid_k))
                if isinstance(r_loc, dict) and r_loc.get("cleared") and not r_loc.get("remote_cleared_pushed"):
                    if isinstance(watching_items.get(kid_k), dict):
                        watching_items[kid_k]["score"] = None
            for kid_k in list(watchlist_items.keys()):
                if str(kid_k) in rem_wl_set or f"kin_{kid_k}" in rem_wl_set:
                    watchlist_items.pop(kid_k, None)
            for kid_k in list(never_items.keys()):
                if str(kid_k) in rem_nv_set or f"kin_{kid_k}" in rem_nv_set:
                    never_items.pop(kid_k, None)
            self.state["account"]["watched_count"] = len(watched_items)
            self.state["account"]["watching_count"] = len(watching_items)
            self.state["account"]["never_count"] = len(never_items)

        self.state["remote_watched_items"] = watched_items
        self.state["remote_watching_items"] = watching_items
        self.state["remote_watchlist_items"] = watchlist_items
        self.state["remote_never_items"] = never_items
        self.state["friends"] = friends_list
        self.state["friends_ratings_by_kid"] = friends_ratings_by_kid
        self.state["friend_known_titles"] = local_friend_known_titles
        self._sanitize_never_vs_watched_conflicts(self.state)

        if "integrations" in self.state and "kinorium" in self.state["integrations"]:
            self.state["integrations"]["kinorium"]["login_url"] = f"https://en.kinorium.com{user_path}"

        self.set_service_login(
            "kinorium",
            True,
            f"{display_name} • {len(watched_items)} просмотрено • {len(watching_items)} смотрю • {len(friends_list)} друзей",
            enabled=True,
        )
        self._build_lookup_indices()
        self._save_state()

    if (
        not is_switching_user
        and not incomplete_sections
        and effective_cookie
    ):
        try:
            self.reconcile_local_statuses_to_remote()
        except Exception:
            pass
    try:
        self.reconcile_all_local_episodes(pull_watching_limit=0)
    except Exception:
        pass
    with self._state_lock:
        if self._profile_id != sync_start_profile_id:
            return {"ok": False, "synced": False, "error": "profile_switched_during_sync"}
        wl_after = self.get_sections_counts().get("watchlist", wl_online_count)
        watching_after = len(self.state.get("remote_watching_items") or {})
        watched_after = len(self.state.get("remote_watched_items") or {})
        never_after = len(self.state.get("remote_never_items") or {})
        self.state["account"]["watched_count"] = watched_after
        self.state["account"]["watching_count"] = watching_after
        self.state["account"]["watchlist_count"] = wl_after
        self.state["account"]["never_count"] = never_after
        self._save_state()
    return {
        "synced": True,
        "user_id": str(user_id),
        "display_name": display_name,
        "avatar_url": avatar_url,
        "profile_url": f"https://en.kinorium.com{user_path}",
        "watched_count": watched_after,
        "watching_count": watching_after,
        "watchlist_count": wl_after,
        "never_count": never_after,
        "friends": friends_list,
    }


def disconnect_user_profile(self) -> Dict[str, Any]:
    """
    Disconnects the current Kinorium user profile and clears all user-specific lists
    so a new user installing the app can connect their own Kinorium profile cleanly.
    """
    with self._state_lock:
        with self._cookie_lock:
            self._kinorium_cookie_cache = ""
        with self._episodes_lock:
            self._series_episodes_cache.clear()
        self._session_auth_verified = None

        self.state["watched"] = {}
        self.state["ratings"] = {}
        self.state["watchlist"] = []
        self.state["watchlist_removed"] = []
        self.state["watching_local"] = []
        self.state["watching_removed"] = []
        self.state["never_local"] = []
        self.state["never_removed"] = []
        self.state["continue_watching"] = []
        self.state["friends"] = []
        self.state["friends_ratings_by_kid"] = {}
        self.state["friend_known_titles"] = {}
        self.state["remote_watched_items"] = {}
        self.state["remote_watching_items"] = {}
        self.state["remote_watchlist_items"] = {}
        self.state["remote_never_items"] = {}
        self.state["watched_episodes"] = {}
        self.state["unwatched_episodes"] = {}
        self.state["episode_ratings"] = {}
        self.state["cleared_episode_ratings"] = {}
        self.state["cw_dismissed"] = []
        self.state["cw_dismissed_entries"] = {}

        self.state["account"] = {
            "connected": False,
            "user_id": "",
            "profile_url": "https://en.kinorium.com/",
            "username": "",
            "display_name": "Не подключен",
            "avatar_url": "",
            "watched_count": 0,
            "watching_count": 0,
            "watchlist_count": 0,
            "never_count": 0,
            "friends_count": 0,
            "last_synced": "",
            "session_cookie": "",
            "auto_scrobble_threshold": 0.95,
        }
        self.set_service_login("kinorium", False, "")
        self._build_lookup_indices()
        self._save_state()
        return self.get_account_summary()


def _count_dismissed_cw_items_locked(self) -> int:
    dismissed = self.state.get("cw_dismissed") or []
    if not dismissed:
        return 0
    stash = self.state.get("cw_dismissed_entries")
    non_title = [d for d in dismissed if isinstance(d, str) and d and not d.startswith("title:")]
    if non_title:
        return len(set(non_title))
    if isinstance(stash, dict) and stash:
        return len(stash)
    return len(set(dismissed))


def get_account_summary(self) -> Dict[str, Any]:
    with self._state_lock:
        acc = dict(self.state.get("account") or {})
        uid = str(acc.get("user_id") or "").strip()
        disp_raw = str(acc.get("display_name") or "").strip()
        conn_raw = bool(acc.get("connected"))
        cur_ver = getattr(self, "_state_version", 0)
        cache_key = (cur_ver, uid, disp_raw, conn_raw, acc.get("last_synced"), acc.get("watched_count"))
        if getattr(self, "_cached_account_summary_key", None) == cache_key and hasattr(self, "_cached_account_summary"):
            return dict(self._cached_account_summary)

        cw_dismissed_cnt = self._count_dismissed_cw_items_locked()
        connected = bool(conn_raw and uid)
        avatar_url = str(acc.get("avatar_url") or "").strip()
        if avatar_url and "/user/180/" in avatar_url:
            avatar_url = avatar_url.replace("/user/180/", "/user/200/")
        if connected and uid.isdigit():
            avatar_url = f"/api/kinorium/avatar?uid={uid}"
        disp = disp_raw or "Не подключен"
        is_placeholder_name = _is_placeholder_display_name(disp, uid)
        if connected and uid == "51670" and is_placeholder_name:
            disp = "Andrei Crustillio"
        elif connected and is_placeholder_name:
            disp = "Kinorium"
        elif not connected and is_placeholder_name:
            disp = "Не подключен"
        res = {
            "connected": bool(acc.get("connected")),
            "user_id": uid,
            "display_name": disp,
            "avatar_url": avatar_url if connected else "",
            "profile_url": str(acc.get("profile_url") or "https://en.kinorium.com/"),
            "watched_count": int(acc.get("watched_count") or 0),
            "last_synced": str(acc.get("last_synced") or ""),
            "has_session_cookie": bool((acc.get("session_cookie") or "").strip()),
            "cw_dismissed_count": cw_dismissed_cnt,
        }
        self._cached_account_summary = res
        self._cached_account_summary_key = cache_key
        return dict(res)


def export_backup_state(self, redact_secrets: bool = False) -> Dict[str, Any]:
    keys_to_export = [
        "account",
        "integrations",
        "watched",
        "ratings",
        "watchlist",
        "watchlist_removed",
        "watching_local",
        "watching_removed",
        "never_local",
        "never_removed",
        "continue_watching",
        "watched_episodes",
        "unwatched_episodes",
        "episode_ratings",
        "cleared_episode_ratings",
        "cw_dismissed",
        "cw_dismissed_entries",
        "series_live_meta",
        "critics_by_kid",
        "descriptions_by_kid",
        "remote_watched_items",
        "remote_watching_items",
        "remote_watchlist_items",
        "remote_never_items",
        "friends",
        "friends_ratings_by_kid",
        "friend_known_titles",
    ]
    with self._state_lock:
        exported = {k: copy.deepcopy(self.state.get(k)) for k in keys_to_export if k in self.state}
    if redact_secrets and isinstance(exported.get("account"), dict):
        safe_acc = dict(exported["account"])
        safe_acc["session_cookie"] = ""
        safe_acc.pop("auth_token", None)
        exported["account"] = safe_acc
    return exported


def import_backup_state(self, backup_data: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(backup_data, dict):
        return self.get_account_summary()
    allowed_keys = [
        "account",
        "integrations",
        "watched",
        "ratings",
        "watchlist",
        "watchlist_removed",
        "watching_local",
        "watching_removed",
        "never_local",
        "never_removed",
        "continue_watching",
        "watched_episodes",
        "unwatched_episodes",
        "episode_ratings",
        "cleared_episode_ratings",
        "cw_dismissed",
        "cw_dismissed_entries",
        "series_live_meta",
        "critics_by_kid",
        "descriptions_by_kid",
        "remote_watched_items",
        "remote_watching_items",
        "remote_watchlist_items",
        "remote_never_items",
        "friends",
        "friends_ratings_by_kid",
        "friend_known_titles",
    ]
    dict_keys = {
        "watched",
        "ratings",
        "watched_episodes",
        "unwatched_episodes",
        "episode_ratings",
        "cleared_episode_ratings",
        "cw_dismissed_entries",
        "series_live_meta",
        "critics_by_kid",
        "descriptions_by_kid",
        "remote_watched_items",
        "remote_watching_items",
        "remote_watchlist_items",
        "remote_never_items",
        "friends_ratings_by_kid",
        "friend_known_titles",
    }
    list_keys = {
        "watchlist",
        "watchlist_removed",
        "watching_local",
        "watching_removed",
        "never_local",
        "never_removed",
        "continue_watching",
        "cw_dismissed",
        "friends",
    }
    with self._state_lock:
        prev_uid = str((self.state.get("account") or {}).get("user_id") or "")
        for k in allowed_keys:
            if k in backup_data and backup_data[k] is not None:
                if k == "integrations" and isinstance(backup_data[k], dict):
                    merged_int = copy.deepcopy(self.DEFAULT_INTEGRATIONS)
                    for ik, iv in backup_data[k].items():
                        if ik in merged_int and isinstance(iv, dict):
                            merged_int[ik].update(copy.deepcopy(iv))
                            if "enabled" not in merged_int[ik]:
                                merged_int[ik]["enabled"] = True
                    self.state["integrations"] = merged_int
                    self._integrations_cache = merged_int
                elif k == "account" and isinstance(backup_data[k], dict):
                    acc_in = copy.deepcopy(backup_data[k])
                    raw_ck = str(acc_in.get("session_cookie") or "").strip()
                    merged_acc = dict(self.state.get("account") or {})
                    if raw_ck:
                        acc_in["session_cookie"] = self.sanitize_session_cookie(raw_ck)
                    elif merged_acc.get("session_cookie"):
                        acc_in.pop("session_cookie", None)
                    else:
                        acc_in["session_cookie"] = ""
                    if not str(acc_in.get("auth_token") or "").strip() and merged_acc.get("auth_token"):
                        acc_in.pop("auth_token", None)
                    merged_acc.update(acc_in)
                    self.state["account"] = merged_acc
                elif k in dict_keys and isinstance(backup_data[k], dict):
                    self.state[k] = copy.deepcopy(backup_data[k])
                elif k in list_keys and isinstance(backup_data[k], list):
                    self.state[k] = copy.deepcopy(backup_data[k])
        with self._cookie_lock:
            self._kinorium_cookie_cache = ""
        with self._episodes_lock:
            self._series_episodes_cache.clear()
        self._session_auth_verified = None
        new_uid = str((self.state.get("account") or {}).get("user_id") or "")
        self._sanitize_never_vs_watched_conflicts(self.state)
        self._build_lookup_indices()
        self._save_state()
    if new_uid and new_uid != prev_uid and not backup_data.get("remote_watched_items"):
        try:
            self.sync_user_profile(new_uid)
        except Exception:
            pass
    return self.get_account_summary()


def get_integrations(self) -> Dict[str, Any]:
    with self._state_lock:
        cached = self._integrations_cache
        if cached is not None:
            return cached
        stored = self.state.get("integrations")
        merged = {k: dict(v) for k, v in self.DEFAULT_INTEGRATIONS.items()}
        if isinstance(stored, dict):
            for ik, iv in stored.items():
                if ik in merged and isinstance(iv, dict):
                    merged[ik].update(iv)
                    if "enabled" not in merged[ik]:
                        merged[ik]["enabled"] = True
        self.state["integrations"] = merged
        self._integrations_cache = merged
        return merged


def is_service_enabled(self, service_id: str) -> bool:
    if not service_id or service_id == "all":
        return True
    integ = self.get_integrations().get(service_id)
    if not isinstance(integ, dict):
        return True
    return bool(integ.get("enabled", True))


def set_services_enabled_bulk(self, enabled_map: Dict[str, Any]) -> Dict[str, Any]:
    with self._state_lock:
        integrations = self.get_integrations()
        changed = False
        for srv_id, val in (enabled_map or {}).items():
            if srv_id in integrations and val is not None:
                b_val = bool(val)
                if integrations[srv_id].get("enabled") != b_val:
                    integrations[srv_id]["enabled"] = b_val
                    changed = True
        if changed:
            self._save_state()
        return integrations


def apply_country_localization(
    self,
    country_code: str,
    adjust_local_services: bool = False,
    persist: bool = True,
) -> Dict[str, Any]:
    prof = get_country_profile(country_code)
    with self._state_lock:
        integrations = self.get_integrations()
        changed = False
        for srv_id, url_val in (prof.get("service_urls") or {}).items():
            if srv_id in integrations and integrations[srv_id].get("login_url") != url_val:
                integrations[srv_id]["login_url"] = url_val
                changed = True
        if adjust_local_services and "playerpl" in integrations:
            want_pl = "playerpl" in (prof.get("local_services") or [])
            if integrations["playerpl"].get("enabled") != want_pl:
                integrations["playerpl"]["enabled"] = want_pl
                changed = True
        if changed and persist:
            self._save_state()
    return prof


def set_service_login(
    self,
    service_id: str,
    logged_in: Optional[bool] = None,
    username: str = "",
    enabled: Optional[bool] = None,
) -> Dict[str, Any]:
    with self._state_lock:
        integrations = self.get_integrations()
        if enabled is not None and service_id in integrations:
            integrations[service_id]["enabled"] = bool(enabled)

        if logged_in is not None:
            if service_id == "hdrezka":
                integrations["hdrezka"]["logged_in"] = True
                integrations["hdrezka"]["status_label"] = "Активно без регистрации (Обход ограничений + 1080p)"
            elif service_id == "backup4k":
                integrations["backup4k"]["logged_in"] = True
                integrations["backup4k"]["status_label"] = "Прямой 4K UHD HDR поток и TorrServer"
            elif service_id in integrations:
                integrations[service_id]["logged_in"] = bool(logged_in)
                if logged_in:
                    label = f"Подключено ({username})" if username else "Вход выполнен"
                    integrations[service_id]["status_label"] = label
                else:
                    integrations[service_id]["status_label"] = "Не выполнен вход"

            if service_id == "kinorium":
                self.state["account"]["connected"] = bool(logged_in)

        self._save_state()
        return integrations
