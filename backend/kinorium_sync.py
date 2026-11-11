"""
Kinorium Bidirectional Episode & Status Synchronization Engine (`backend/kinorium_sync.py`).
Extracted from `backend/kinorium.py` to isolate remote episode state merging,
series episode reconciliation, and status/tombstone pushing.
"""

import json
import re
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple


def _is_episode_cached_remote_done(self, kid: str, season: int, episode: int) -> bool:
    if not kid or not str(kid).isdigit():
        return False
    with self._episodes_lock:
        cached = self._series_episodes_cache.get(str(kid))
    if not cached:
        return False
    ep_info = (cached.get("episodes") or {}).get((int(season), int(episode)))
    return bool(ep_info and ep_info.get("watched"))

def _merge_remote_episodes_into_local(
    self,
    kid: str,
    episodes_map: Dict[Tuple[int, int], Dict[str, Any]],
    item_id: str = "",
) -> bool:
    if not kid or not str(kid).isdigit() or not episodes_map:
        return False
    changed = False
    with self._state_lock:
        we_root = self.state.setdefault("watched_episodes", {})
        uw_root = self.state.setdefault("unwatched_episodes", {})
        er_root = self.state.setdefault("episode_ratings", {})
        cer_root = self.state.setdefault("cleared_episode_ratings", {})
        target_keys = [k for k in (f"kin_{kid}", item_id if (item_id and item_id != f"kin_{kid}") else "") if k]
        now_str = time.strftime("%Y-%m-%d %H:%M")

        for (s_num, e_num), ep_info in episodes_map.items():
            s_key = str(s_num)
            ep_key = f"s{s_num}e{e_num}"
            locally_unwatched = any(
                e_num in ((uw_root.get(k_id) or {}).get(s_key) or [])
                for k_id in target_keys
            )
            locally_cleared_rating = any(
                bool((cer_root.get(k_id) or {}).get(ep_key))
                for k_id in target_keys
            )
            if ep_info.get("watched") or ep_info.get("rating"):
                if locally_unwatched:
                    continue
                for k_id in target_keys:
                    s_map = we_root.setdefault(k_id, {})
                    cur_list = s_map.get(s_key) or []
                    if e_num not in cur_list:
                        cur_list.append(e_num)
                        s_map[s_key] = sorted(set(cur_list))
                        changed = True
            elif locally_unwatched:
                # Remote now agrees episode is unwatched -> clear local tombstone
                for k_id in target_keys:
                    uw_map = uw_root.get(k_id)
                    if isinstance(uw_map, dict) and s_key in uw_map:
                        rem_uw = [int(x) for x in (uw_map.get(s_key) or []) if str(x).isdigit() and int(x) != e_num]
                        if rem_uw:
                            uw_map[s_key] = sorted(set(rem_uw))
                        else:
                            uw_map.pop(s_key, None)
                        changed = True
            r_val = ep_info.get("rating")
            if r_val and 1 <= int(r_val) <= 10 and not locally_unwatched and not locally_cleared_rating:
                for k_id in target_keys:
                    r_map = er_root.setdefault(k_id, {})
                    existing_r = r_map.get(ep_key)
                    if isinstance(existing_r, dict) and existing_r.get("remote_synced") is False:
                        continue
                    if (
                        not isinstance(existing_r, dict)
                        or existing_r.get("score") != int(r_val)
                        or existing_r.get("remote_synced") is not True
                    ):
                        r_map[ep_key] = {
                            "season": s_num,
                            "episode": e_num,
                            "score": int(r_val),
                            "comment": str(existing_r.get("comment") or "") if isinstance(existing_r, dict) else "",
                            "episode_title": str(
                                (existing_r.get("episode_title") if isinstance(existing_r, dict) else "")
                                or ep_info.get("ru_title")
                                or ""
                            ),
                            "updated_at": now_str,
                            "remote_synced": True,
                        }
                        changed = True
            elif not r_val and locally_cleared_rating:
                # Remote now agrees episode rating is cleared -> drop tombstone
                for k_id in target_keys:
                    if isinstance(cer_root.get(k_id), dict) and ep_key in cer_root[k_id]:
                        cer_root[k_id].pop(ep_key, None)
                        changed = True
    return changed

def fetch_series_episodes_state(
    self,
    kid: str,
    item_id: str = "",
    force_refresh: bool = False,
) -> Dict[str, Any]:
    kid_str = str(kid or "").strip()
    if not kid_str.isdigit():
        return {"episodes": {}, "season_buttons": {}, "is_authed": False}

    start_pid = self._profile_id
    now_ts = time.time()
    with self._state_lock:
        uid = str(self.state.get("account", {}).get("user_id") or "").strip()
        has_cookie = bool((self.state.get("account", {}).get("session_cookie") or "").strip())
    cached_hit: Optional[Dict[str, Any]] = None
    with self._episodes_lock:
        cached = self._series_episodes_cache.get(kid_str)
        if (
            cached
            and not force_refresh
            and (now_ts - float(cached.get("ts") or 0.0)) < 3600.0
            and (not has_cookie or (cached.get("is_authed") and cached.get("user_id") == uid))
        ):
            cached_hit = cached
    if cached_hit is not None:
        if cached_hit.get("is_authed") and item_id and self._profile_id == start_pid:
            if self._merge_remote_episodes_into_local(kid_str, cached_hit.get("episodes") or {}, item_id=item_id):
                self._save_state(immediate=False, bump_version=True)
        return cached_hit

    try:
        prev_ia_ep = getattr(self._sync_cookie_tl, "include_auth", False)
        self._sync_cookie_tl.include_auth = bool(has_cookie)
        try:
            ep_html = self.fetch_kinorium_html(f"https://ru.kinorium.com/{kid_str}/episodes/")
        finally:
            self._sync_cookie_tl.include_auth = prev_ia_ep
        is_authed = bool(
            (
                uid
                and (
                    re.search(rf"\bUSER_ID\s*=\s*['\"]?{re.escape(uid)}['\"]?", ep_html)
                    or f"/user/{uid}/" in ep_html
                )
            )
            or (has_cookie and re.search(r"\bUSER_ID\s*=\s*['\"]?[1-9]\d*['\"]?", ep_html))
        )
        if has_cookie and self._profile_id == start_pid:
            self._session_auth_verified = is_authed
        parsed = self.parse_series_episodes_html(ep_html)
        if not parsed["episodes"] and cached and cached.get("episodes"):
            return cached
        state_obj: Dict[str, Any] = {
            "ts": now_ts,
            "user_id": uid,
            "is_authed": is_authed,
            "episodes": parsed["episodes"],
            "season_buttons": parsed["season_buttons"],
        }
        if parsed["episodes"] and self._profile_id == start_pid and (is_authed or not has_cookie):
            with self._episodes_lock:
                if len(self._series_episodes_cache) >= 128 and kid_str not in self._series_episodes_cache:
                    try:
                        self._series_episodes_cache.pop(next(iter(self._series_episodes_cache)))
                    except StopIteration:
                        pass
                self._series_episodes_cache[kid_str] = state_obj
        if is_authed and item_id and parsed["episodes"] and self._profile_id == start_pid:
            if self._merge_remote_episodes_into_local(kid_str, parsed["episodes"], item_id=item_id):
                self._save_state(immediate=False, bump_version=True)
        return state_obj
    except Exception:
        if cached and cached.get("episodes"):
            return cached
        return {"episodes": {}, "season_buttons": {}, "is_authed": False}

def _post_episode_status_remote(
    self,
    kid: str,
    ep_id: str,
    watched: bool = True,
    score: Optional[int] = None,
    comment: str = "",
    clear_rating_only: bool = False,
) -> bool:
    user_cookie = self._get_active_sync_cookie()
    if not user_cookie or not str(kid).isdigit() or not str(ep_id).isdigit():
        return False
    try:
        full_cookie = self._ensure_kinorium_cookies(extra_cookie=user_cookie)
        headers = {
            "User-Agent": self.UA,
            "Cookie": full_cookie,
            "X-Requested-With": "XMLHttpRequest",
            "Origin": "https://ru.kinorium.com",
            "Referer": f"https://ru.kinorium.com/{kid}/episodes/",
        }
        group_key = str(int(time.time() * 1000))
        if clear_rating_only or not watched:
            del_type = "rating" if clear_rating_only else "status"
            qs = urllib.parse.urlencode(
                {
                    "movie_id": str(ep_id),
                    "episode_of": str(kid),
                    "del_type": del_type,
                    "group_key": group_key,
                }
            )
            _, raw_txt, _ = self._kinorium_http_request(
                f"/handlers/delStatus/?{qs}",
                method="GET",
                extra_headers=headers,
                timeout=8.0,
            )
            raw = raw_txt.strip()
            if not raw.startswith("{"):
                return False
            resp_json = json.loads(raw)
            return bool(isinstance(resp_json, dict) and not resp_json.get("error") and "result" in resp_json)

        form: Dict[str, Any] = {
            "group_key": group_key,
            "status": "done",
            "rating": str(int(score)) if (score is not None and 1 <= int(score) <= 10) else "",
            "isNow": "",
            "isEdit": "",
            "logId": "",
            "comment": comment or "",
            "movie_id": str(ep_id),
            "episode_of": str(kid),
            "share": "",
        }
        payload = urllib.parse.urlencode(form).encode("utf-8")
        post_hdrs = {**headers, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}
        _, raw_txt, _ = self._kinorium_http_request(
            "/handlers/setStatus/",
            method="POST",
            data=payload,
            extra_headers=post_hdrs,
            timeout=8.0,
        )
        raw = raw_txt.strip()
        if not raw.startswith("{"):
            return False
        resp_json = json.loads(raw)
        return bool(isinstance(resp_json, dict) and not resp_json.get("error") and "result" in resp_json)
    except Exception:
        return False

def _sync_episodes_map_to_kinorium_remote(
    self,
    kid: str,
    item_id: str,
    target_by_season: Dict[int, List[int]],
    mark_season_complete: bool = False,
) -> Tuple[bool, int]:
    user_cookie = self._get_active_sync_cookie()
    if not user_cookie or not str(kid).isdigit() or not target_by_season:
        return False, 0

    ep_state = self.fetch_series_episodes_state(kid, item_id=item_id)
    ep_map: Dict[Tuple[int, int], Dict[str, Any]] = ep_state.get("episodes") or {}
    if not ep_map:
        return False, 0

    with self._state_lock:
        er_root = self.state.get("episode_ratings") or {}
        er_for_item: Dict[str, Any] = {}
        for k_lookup in filter(None, [f"kin_{kid}", item_id]):
            if isinstance(er_root.get(k_lookup), dict):
                er_for_item.update(er_root[k_lookup])

    to_mark: List[Dict[str, Any]] = []
    already_done_count = 0
    for s_num, e_list in target_by_season.items():
        for e_num in sorted(set(int(x) for x in e_list if int(x) > 0)):
            ep_info = ep_map.get((int(s_num), int(e_num)))
            if not ep_info or ep_info.get("is_future"):
                continue
            ep_k = f"s{int(s_num)}e{int(e_num)}"
            loc_r = er_for_item.get(ep_k) if isinstance(er_for_item.get(ep_k), dict) else None
            sc_val = int(loc_r["score"]) if (loc_r and str(loc_r.get("score") or "").isdigit()) else None
            needs_rating_push = bool(
                sc_val and 1 <= sc_val <= 10 and (ep_info.get("rating") != sc_val or loc_r.get("remote_synced") is not True)
            )
            if ep_info.get("watched") and not needs_rating_push:
                already_done_count += 1
            else:
                to_mark.append(ep_info)

    if not to_mark:
        return (already_done_count > 0 or bool(ep_state.get("is_authed"))), 0

    # Fast-path whole-season check when Kinorium's season button is enabled (all episodes released)
    if mark_season_complete and len(target_by_season) == 1 and len(to_mark) >= 3:
        only_s = next(iter(target_by_season.keys()))
        s_btn = (ep_state.get("season_buttons") or {}).get(int(only_s)) or {}
        season_released_eps = [
            info for (sn, _), info in ep_map.items() if sn == int(only_s) and not info.get("is_future")
        ]
        target_set = set(target_by_season[only_s])
        if (
            s_btn
            and not s_btn.get("disabled")
            and season_released_eps
            and all(info["episode"] in target_set for info in season_released_eps)
        ):
            try:
                full_cookie = self._ensure_kinorium_cookies(extra_cookie=user_cookie)
                qs = urllib.parse.urlencode(
                    {"movie_id": str(kid), "season": str(only_s), "checked": "1"}
                )
                _, raw_txt, _ = self._kinorium_http_request(
                    f"/handlers/checkEpisode/?{qs}",
                    method="GET",
                    extra_headers={
                        "User-Agent": self.UA,
                        "Cookie": full_cookie,
                        "X-Requested-With": "XMLHttpRequest",
                        "Referer": f"https://ru.kinorium.com/{kid}/episodes/",
                    },
                    timeout=8.0,
                )
                raw = raw_txt.strip()
                if raw.startswith("{"):
                    rj = json.loads(raw)
                    if isinstance(rj, dict) and not rj.get("error") and "result" in rj:
                        with self._episodes_lock:
                            for info in season_released_eps:
                                info["watched"] = True
                        return True, len(to_mark)
            except Exception:
                pass

    def _mark_one(info: Dict[str, Any]) -> bool:
        prev_tl = getattr(self._sync_cookie_tl, "cookie", None)
        self._sync_cookie_tl.cookie = user_cookie
        try:
            ep_k = f"s{info['season']}e{info['episode']}"
            loc_r = er_for_item.get(ep_k) if isinstance(er_for_item.get(ep_k), dict) else None
            sc_val = int(loc_r["score"]) if (loc_r and str(loc_r.get("score") or "").isdigit()) else None
            cm_val = str(loc_r.get("comment") or "") if loc_r else ""
            ok = self._post_episode_status_remote(
                kid=str(kid),
                ep_id=str(info["ep_id"]),
                watched=True,
                score=sc_val,
                comment=cm_val,
            )
            if ok:
                with self._episodes_lock:
                    info["watched"] = True
                    if sc_val:
                        info["rating"] = sc_val
                if sc_val:
                    with self._state_lock:
                        er_live = self.state.get("episode_ratings") or {}
                        for k_u in filter(None, [item_id, f"kin_{kid}"]):
                            if isinstance(er_live.get(k_u), dict) and isinstance(er_live[k_u].get(ep_k), dict):
                                er_live[k_u][ep_k]["remote_synced"] = True
            return ok
        finally:
            self._sync_cookie_tl.cookie = prev_tl

    # Execute episode status updates sequentially to avoid burst anti-bot triggers on Kinorium
    synced_cnt = 0
    for info_item in to_mark:
        if _mark_one(info_item):
            synced_cnt += 1

    if synced_cnt == len(to_mark):
        with self._state_lock:
            dirty_list = self.state.get("dirty_episode_series")
            if isinstance(dirty_list, list):
                for k_clean in (item_id, f"kin_{kid}", str(kid)):
                    if k_clean and k_clean in dirty_list:
                        dirty_list.remove(k_clean)
    return synced_cnt > 0, synced_cnt

def reconcile_series_episodes(
    self,
    item_id: str = "",
    title: str = "",
    orig_title: str = "",
    kid: Optional[str] = None,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """
    Two-way synchronization of watched episodes & episode ratings for a single series:
    1. Pulls all watched/rated episodes from `ru.kinorium.com/{kid}/episodes/` into Velarium.
    2. Pushes any locally watched/rated episodes from Velarium to `kinorium.com`.
    3. Automatically promotes the series from 'Буду смотреть' (`future`) to 'Смотрю' (`now`)
       if episodes have been watched in Velarium while the series is still incomplete.
    """
    start_pid = self._profile_id
    eff_kid = str(kid) if (kid and str(kid).isdigit()) else ""
    if not eff_kid:
        resolved = self._resolve_kinorium_id(
            item_id,
            title,
            orig_title,
            allow_network=True,
            media_type="series",
        )
        eff_kid = str(resolved) if (resolved and str(resolved).isdigit()) else ""
    eff_item_id = item_id or (f"kin_{eff_kid}" if eff_kid else "")
    if not eff_kid or self._profile_id != start_pid:
        return self.get_item_status(eff_item_id, title=title, orig_title=orig_title)

    user_cookie = self._get_active_sync_cookie()
    prev_tl_cookie = getattr(self._sync_cookie_tl, "cookie", None)
    self._sync_cookie_tl.cookie = user_cookie
    try:
        return _reconcile_series_episodes_impl(
            self,
            start_pid=start_pid,
            eff_kid=eff_kid,
            eff_item_id=eff_item_id,
            title=title,
            orig_title=orig_title,
            user_cookie=user_cookie,
            force_refresh=force_refresh,
        )
    finally:
        self._sync_cookie_tl.cookie = prev_tl_cookie


def _reconcile_series_episodes_impl(
    self,
    *,
    start_pid: str,
    eff_kid: str,
    eff_item_id: str,
    title: str,
    orig_title: str,
    user_cookie: str,
    force_refresh: bool,
) -> Dict[str, Any]:
    ep_state = self.fetch_series_episodes_state(eff_kid, item_id=eff_item_id, force_refresh=force_refresh)
    if self._profile_id != start_pid:
        return self.get_item_status(eff_item_id, title=title, orig_title=orig_title)
    ep_map: Dict[Tuple[int, int], Dict[str, Any]] = ep_state.get("episodes") or {}
    can_push_remote = bool(user_cookie and ep_map)

    with self._state_lock:
        we_root = self.state.setdefault("watched_episodes", {})
        uw_root = self.state.get("unwatched_episodes") or {}
        local_by_season: Dict[int, List[int]] = {}
        unwatched_by_season: Dict[int, List[int]] = {}
        for k_lookup in filter(None, [eff_item_id, f"kin_{eff_kid}"]):
            sub_map = we_root.get(k_lookup)
            if isinstance(sub_map, dict):
                for s_k, ep_list in sub_map.items():
                    if str(s_k).isdigit() and isinstance(ep_list, list):
                        s_int = int(s_k)
                        merged = sorted(
                            set(local_by_season.get(s_int, []) + [int(x) for x in ep_list if str(x).isdigit() and int(x) > 0])
                        )
                        if merged:
                            local_by_season[s_int] = merged
            uw_sub = uw_root.get(k_lookup)
            if isinstance(uw_sub, dict):
                for s_k, uw_list in uw_sub.items():
                    if str(s_k).isdigit() and isinstance(uw_list, list):
                        s_int = int(s_k)
                        merged_uw = sorted(
                            set(unwatched_by_season.get(s_int, []) + [int(x) for x in uw_list if str(x).isdigit() and int(x) > 0])
                        )
                        if merged_uw:
                            unwatched_by_season[s_int] = merged_uw

        state_changed = False
        if local_by_season:
            # Ensure canonical 'kin_{eff_kid}' key also holds all merged episodes
            kin_map = we_root.setdefault(f"kin_{eff_kid}", {})
            for s_int, ep_list in local_by_season.items():
                uw_for_s = set(unwatched_by_season.get(s_int, []))
                clean_eps = [ep for ep in ep_list if ep not in uw_for_s]
                local_by_season[s_int] = clean_eps
                prev_l = kin_map.get(str(s_int)) or []
                merged_l = sorted(set([x for x in prev_l if x not in uw_for_s] + clean_eps))
                if merged_l != prev_l:
                    if merged_l:
                        kin_map[str(s_int)] = merged_l
                    else:
                        kin_map.pop(str(s_int), None)
                    state_changed = True

    if any(local_by_season.values()) and can_push_remote and self._profile_id == start_pid:
        cur_st = self.get_item_status(eff_item_id, title=title, orig_title=orig_title)
        if not cur_st.get("watching") and not cur_st.get("watched") and not cur_st.get("not_watching"):
            rem_entry = self._by_kid.get(eff_kid) or {}
            eff_title = title or str(rem_entry.get("ru_title") or "")
            eff_orig = orig_title or str(rem_entry.get("orig_title") or "")
            if self._promote_series_to_watching_if_needed(
                item_id=eff_item_id,
                title=eff_title,
                orig_title=eff_orig,
                kid=eff_kid,
            ):
                state_changed = True

        _, pushed_cnt = self._sync_episodes_map_to_kinorium_remote(
            kid=eff_kid,
            item_id=eff_item_id,
            target_by_season={s: eps for s, eps in local_by_season.items() if eps},
        )
        if pushed_cnt > 0:
            state_changed = True

    # Push offline episode unmark tombstones (`unwatched_episodes`) if remote still shows watched
    if can_push_remote and unwatched_by_season and self._profile_id == start_pid:
        for sn_u, eps_u in unwatched_by_season.items():
            for en_u in eps_u:
                ep_info = ep_map.get((sn_u, en_u))
                if ep_info and ep_info.get("ep_id") and (ep_info.get("watched") or ep_info.get("rating")):
                    if self._post_episode_status_remote(
                        kid=eff_kid,
                        ep_id=str(ep_info["ep_id"]),
                        watched=False,
                    ):
                        with self._episodes_lock:
                            ep_info["watched"] = False
                            ep_info["rating"] = None
                        with self._state_lock:
                            uw_bg = self.state.get("unwatched_episodes") or {}
                            for k_u in filter(None, [eff_item_id, f"kin_{eff_kid}"]):
                                uw_s = uw_bg.get(k_u)
                                if isinstance(uw_s, dict) and str(sn_u) in uw_s:
                                    rem_u = [int(x) for x in (uw_s.get(str(sn_u)) or []) if str(x).isdigit() and int(x) != en_u]
                                    if rem_u:
                                        uw_s[str(sn_u)] = sorted(set(rem_u))
                                    else:
                                        uw_s.pop(str(sn_u), None)
                        state_changed = True

    # Push local episode ratings & cleared episode rating tombstones
    all_ratings_synced = True
    if can_push_remote and self._profile_id == start_pid:
        with self._state_lock:
            er_root = self.state.get("episode_ratings") or {}
            cer_root = self.state.get("cleared_episode_ratings") or {}
            merged_er: Dict[str, Dict[str, Any]] = {}
            cleared_ep_keys: set = set()
            for k_lookup in filter(None, [f"kin_{eff_kid}", eff_item_id]):
                if isinstance(er_root.get(k_lookup), dict):
                    merged_er.update(er_root[k_lookup])
                if isinstance(cer_root.get(k_lookup), dict):
                    cleared_ep_keys.update(k for k, v in cer_root[k_lookup].items() if v)
        for ep_k_str, ep_val in merged_er.items():
            if not isinstance(ep_val, dict):
                continue
            sn = int(ep_val.get("season") or 0)
            en = int(ep_val.get("episode") or 0)
            sc = int(ep_val.get("score") or 0)
            ep_info = ep_map.get((sn, en))
            if ep_info and not ep_info.get("is_future") and 1 <= sc <= 10:
                if ep_info.get("rating") != sc:
                    if self._post_episode_status_remote(
                        kid=eff_kid,
                        ep_id=str(ep_info["ep_id"]),
                        watched=True,
                        score=sc,
                        comment=str(ep_val.get("comment") or ""),
                    ):
                        with self._episodes_lock:
                            ep_info["watched"] = True
                            ep_info["rating"] = sc
                        with self._state_lock:
                            er_live = self.state.get("episode_ratings") or {}
                            for k_u in filter(None, [eff_item_id, f"kin_{eff_kid}"]):
                                if isinstance(er_live.get(k_u), dict) and isinstance(er_live[k_u].get(ep_k_str), dict):
                                    er_live[k_u][ep_k_str]["remote_synced"] = True
                        state_changed = True
                    else:
                        all_ratings_synced = False
                elif ep_val.get("remote_synced") is not True:
                    with self._state_lock:
                        er_live = self.state.get("episode_ratings") or {}
                        for k_u in filter(None, [eff_item_id, f"kin_{eff_kid}"]):
                            if isinstance(er_live.get(k_u), dict) and isinstance(er_live[k_u].get(ep_k_str), dict):
                                er_live[k_u][ep_k_str]["remote_synced"] = True
                    state_changed = True
        for ck_ep in cleared_ep_keys:
            m_ce = re.fullmatch(r"s(\d+)e(\d+)", str(ck_ep))
            if not m_ce:
                continue
            sn_c, en_c = int(m_ce.group(1)), int(m_ce.group(2))
            ep_info = ep_map.get((sn_c, en_c))
            if ep_info and ep_info.get("ep_id"):
                if ep_info.get("rating") is not None:
                    if self._post_episode_status_remote(
                        kid=eff_kid,
                        ep_id=str(ep_info["ep_id"]),
                        watched=True,
                        clear_rating_only=True,
                    ):
                        with self._episodes_lock:
                            ep_info["rating"] = None
                        with self._state_lock:
                            cer_done = self.state.get("cleared_episode_ratings") or {}
                            for k_u in filter(None, [eff_item_id, f"kin_{eff_kid}"]):
                                if isinstance(cer_done.get(k_u), dict):
                                    cer_done[k_u].pop(ck_ep, None)
                        state_changed = True
                    else:
                        all_ratings_synced = False
                else:
                    with self._state_lock:
                        cer_done = self.state.get("cleared_episode_ratings") or {}
                        for k_u in filter(None, [eff_item_id, f"kin_{eff_kid}"]):
                            if isinstance(cer_done.get(k_u), dict):
                                cer_done[k_u].pop(ck_ep, None)
                    state_changed = True

    all_watched_synced = True
    for s_chk, eps_chk in local_by_season.items():
        for e_chk in eps_chk:
            ep_chk_info = ep_map.get((int(s_chk), int(e_chk)))
            if ep_chk_info and not ep_chk_info.get("is_future") and not ep_chk_info.get("watched"):
                all_watched_synced = False
                break
        if not all_watched_synced:
            break

    if can_push_remote and all_watched_synced and all_ratings_synced and self._profile_id == start_pid:
        with self._state_lock:
            dirty_list = self.state.get("dirty_episode_series")
            if isinstance(dirty_list, list):
                for k_clean in (eff_item_id, f"kin_{eff_kid}", eff_kid):
                    if k_clean and k_clean in dirty_list:
                        dirty_list.remove(k_clean)
                        state_changed = True

    if state_changed and self._profile_id == start_pid:
        self._save_state()
    return self.get_item_status(eff_item_id, title=title, orig_title=orig_title)

def reconcile_local_statuses_to_remote(self) -> int:
    """
    Pushes local movie/series statuses (`ratings`, `watched`, `watching_local`, `watchlist`, `never_local`)
    and offline removal tombstones from Velarium to `kinorium.com` when an authenticated `session_cookie`
    is present, completing bidirectional synchronization of movies and series in addition to episodes.
    """
    with self._state_lock:
        start_pid = self._profile_id
        user_cookie = (self.state.get("account", {}).get("session_cookie") or "").strip()
    if not user_cookie:
        return 0

    prev_tl_cookie = getattr(self._sync_cookie_tl, "cookie", None)
    self._sync_cookie_tl.cookie = user_cookie
    try:
        return _reconcile_local_statuses_to_remote_impl(self, start_pid)
    finally:
        self._sync_cookie_tl.cookie = prev_tl_cookie


def _reconcile_local_statuses_to_remote_impl(self, start_pid: str) -> int:
    pushed = 0
    with self._state_lock:
        rem_watched = dict(self.state.setdefault("remote_watched_items", {}))
        rem_watching = dict(self.state.setdefault("remote_watching_items", {}))
        rem_watchlist = dict(self.state.setdefault("remote_watchlist_items", {}))
        rem_never = dict(self.state.setdefault("remote_never_items", {}))
        ratings_map = dict(self.state.get("ratings") or {})
        watched_map = dict(self.state.get("watched") or {})
        watching_local_list = list(self.state.get("watching_local") or [])
        watchlist_list = list(self.state.get("watchlist") or [])
        never_local_list = list(self.state.get("never_local") or [])
        watching_removed = set(str(x) for x in (self.state.get("watching_removed") or []))
        watchlist_removed = set(str(x) for x in (self.state.get("watchlist_removed") or []))
        never_removed = set(str(x) for x in (self.state.get("never_removed") or []))

    def _extract_kid_and_titles(raw_id: str, meta_dict: Optional[Dict[str, Any]] = None) -> Tuple[str, str, str]:
        s_id = str(raw_id or "").strip()
        t_ru = str((meta_dict or {}).get("title") or (meta_dict or {}).get("ru_title") or "")
        t_orig = str((meta_dict or {}).get("orig_title") or "")
        kid_c = s_id[4:] if (s_id.startswith("kin_") and s_id[4:].isdigit()) else ""
        if not kid_c and s_id.isdigit():
            kid_c = s_id
        if not kid_c:
            resolved = self._resolve_kinorium_id(s_id, t_ru, t_orig, allow_network=True)
            if resolved and str(resolved).isdigit():
                kid_c = str(resolved)
        if kid_c and kid_c in self._by_kid:
            t_ru = t_ru or str(self._by_kid[kid_c].get("ru_title") or "")
            t_orig = t_orig or str(self._by_kid[kid_c].get("orig_title") or "")
        return kid_c, t_ru, t_orig

    # 0. Push offline removal tombstones even when the item was already popped from in-memory remote_*_items
    seen_unwatched_kids: set = set()
    for raw_id, w_entry in watched_map.items():
        if self._profile_id != start_pid:
            return pushed
        if not isinstance(w_entry, dict) or w_entry.get("watched") is not False:
            continue
        kid_c, t_ru, t_orig = _extract_kid_and_titles(raw_id, w_entry)
        if not kid_c or kid_c in seen_unwatched_kids:
            continue
        if kid_c not in rem_watched and w_entry.get("remote_unwatched_pushed"):
            continue
        seen_unwatched_kids.add(kid_c)
        if self._sync_to_kinorium_remote(action="unwatched", item_id=str(raw_id), title=t_ru, orig_title=t_orig, resolved_kid=kid_c):
            with self._state_lock:
                if self._profile_id == start_pid:
                    self.state.setdefault("remote_watched_items", {}).pop(kid_c, None)
                    rem_watched.pop(kid_c, None)
                    live_w = (self.state.get("watched") or {}).get(raw_id)
                    if isinstance(live_w, dict):
                        live_w["remote_unwatched_pushed"] = True
                    live_wk = (self.state.get("watched") or {}).get(f"kin_{kid_c}")
                    if isinstance(live_wk, dict):
                        live_wk["remote_unwatched_pushed"] = True
                    self._save_dirty = True
            pushed += 1

    seen_rate_clear_kids: set = set()
    for raw_id, r_entry in ratings_map.items():
        if self._profile_id != start_pid:
            return pushed
        if not isinstance(r_entry, dict) or not r_entry.get("cleared"):
            continue
        kid_c, t_ru, t_orig = _extract_kid_and_titles(raw_id, r_entry)
        if not kid_c or kid_c in seen_rate_clear_kids:
            continue
        has_remote_score = any(
            isinstance(sec.get(kid_c), dict) and sec[kid_c].get("score") is not None
            for sec in (rem_watched, rem_watching, rem_watchlist)
        )
        if not has_remote_score and r_entry.get("remote_cleared_pushed"):
            continue
        seen_rate_clear_kids.add(kid_c)
        if self._sync_to_kinorium_remote(action="rate_remove", item_id=str(raw_id), title=t_ru, orig_title=t_orig, resolved_kid=kid_c):
            with self._state_lock:
                if self._profile_id == start_pid:
                    for sec_key in ("remote_watched_items", "remote_watching_items", "remote_watchlist_items"):
                        live_sec = self.state.setdefault(sec_key, {})
                        if isinstance(live_sec.get(kid_c), dict):
                            live_sec[kid_c]["score"] = None
                    for sec in (rem_watched, rem_watching, rem_watchlist):
                        if isinstance(sec.get(kid_c), dict):
                            sec[kid_c]["score"] = None
                    live_r = (self.state.get("ratings") or {}).get(raw_id)
                    if isinstance(live_r, dict):
                        live_r["remote_cleared_pushed"] = True
                    live_rk = (self.state.get("ratings") or {}).get(f"kin_{kid_c}")
                    if isinstance(live_rk, dict):
                        live_rk["remote_cleared_pushed"] = True
                    self._save_dirty = True
            pushed += 1

    pushed_rem_tombstones = set(str(x) for x in (self.state.get("remote_removals_pushed") or []))
    for rem_ids, rem_dict, rem_state_map_key, rem_action, state_rem_key in (
        (watching_removed, rem_watching, "remote_watching_items", "watching_remove", "watching_removed"),
        (watchlist_removed, rem_watchlist, "remote_watchlist_items", "watchlist_remove", "watchlist_removed"),
        (never_removed, rem_never, "remote_never_items", "never_remove", "never_removed"),
    ):
        seen_rem_kids: set = set()
        for raw_id in rem_ids:
            if self._profile_id != start_pid:
                return pushed
            kid_c, t_ru, t_orig = _extract_kid_and_titles(raw_id)
            if not kid_c or kid_c in seen_rem_kids:
                continue
            tomb_token = f"{rem_action}:{kid_c}"
            if kid_c not in rem_dict and tomb_token in pushed_rem_tombstones:
                continue
            seen_rem_kids.add(kid_c)
            if self._sync_to_kinorium_remote(action=rem_action, item_id=str(raw_id), title=t_ru, orig_title=t_orig, resolved_kid=kid_c):
                with self._state_lock:
                    if self._profile_id == start_pid:
                        self.state.setdefault(rem_state_map_key, {}).pop(kid_c, None)
                        rem_dict.pop(kid_c, None)
                        pushed_rem_tombstones.add(tomb_token)
                        self.state["remote_removals_pushed"] = list(pushed_rem_tombstones)[-1000:]
                        rem_list_live = self.state.get(state_rem_key)
                        if isinstance(rem_list_live, list):
                            self.state[state_rem_key] = [
                                x for x in rem_list_live if str(x) not in (str(raw_id), str(kid_c), f"kin_{kid_c}")
                            ]
                        self._save_dirty = True
                pushed += 1

    # 1. Local ratings & watched items
    all_done_keys = list(dict.fromkeys(list(ratings_map.keys()) + list(watched_map.keys())))
    never_local_ids = set(str(x) for x in never_local_list)
    seen_done_kids = set()
    for raw_id in all_done_keys:
        if self._profile_id != start_pid:
            return pushed
        r_entry = ratings_map.get(raw_id) if isinstance(ratings_map.get(raw_id), dict) else None
        w_entry = watched_map.get(raw_id) if isinstance(watched_map.get(raw_id), dict) else None
        # Tombstones (un-watched, cleared rating, "never") must never be pushed back as "watched"
        is_watched_local = bool(w_entry and w_entry.get("watched") is True)
        has_live_rating = bool(
            r_entry
            and not r_entry.get("cleared")
            and str(r_entry.get("score") or "").isdigit()
            and 1 <= int(r_entry["score"]) <= 10
        )
        if not (is_watched_local or has_live_rating):
            continue
        if str(raw_id) in never_local_ids:
            continue
        meta_src = {**(w_entry or {}), **(r_entry or {})}
        kid_c, t_ru, t_orig = _extract_kid_and_titles(raw_id, meta_src)
        if not kid_c or kid_c in seen_done_kids or kid_c in rem_never or f"kin_{kid_c}" in never_local_ids:
            continue
        w_kid_entry = watched_map.get(f"kin_{kid_c}") if isinstance(watched_map.get(f"kin_{kid_c}"), dict) else None
        if (w_entry and w_entry.get("watched") is False) or (w_kid_entry and w_kid_entry.get("watched") is False):
            continue
        seen_done_kids.add(kid_c)
        sc_val: Optional[int] = None
        if has_live_rating and r_entry and str(r_entry.get("score") or "").isdigit():
            s_int = int(r_entry["score"])
            if 1 <= s_int <= 10:
                sc_val = s_int
        cm_val = str((r_entry or {}).get("comment") or "")
        keep_watching = bool(
            (kid_c in rem_watching or (r_entry and r_entry.get("keep_in_watching")))
            and not is_watched_local
        )
        rem_existing = rem_watching.get(kid_c) if keep_watching else rem_watched.get(kid_c)
        rem_score = rem_existing.get("score") if isinstance(rem_existing, dict) else None
        unsynced_w = bool(is_watched_local and isinstance(w_entry, dict) and w_entry.get("remote_synced") is False)
        unsynced_r = bool(has_live_rating and isinstance(r_entry, dict) and r_entry.get("remote_synced") is False)
        if rem_existing is None or (sc_val is not None and rem_score != sc_val) or unsynced_w or unsynced_r:
            action = "rate" if sc_val is not None else "watched"
            if self._sync_to_kinorium_remote(
                action=action,
                item_id=str(raw_id),
                title=t_ru,
                orig_title=t_orig,
                score=sc_val,
                comment=cm_val,
                resolved_kid=kid_c,
            ):
                with self._state_lock:
                    if self._profile_id == start_pid:
                        w_live = self.state.get("watched") or {}
                        r_live = self.state.get("ratings") or {}
                        for k_sync in {str(raw_id), f"kin_{kid_c}"}:
                            if isinstance(w_live.get(k_sync), dict):
                                w_live[k_sync]["remote_synced"] = True
                            if isinstance(r_live.get(k_sync), dict):
                                r_live[k_sync]["remote_synced"] = True
                        live_rem_watching = self.state.setdefault("remote_watching_items", {})
                        live_rem_watched = self.state.setdefault("remote_watched_items", {})
                        if keep_watching and (kid_c in live_rem_watching or kid_c in rem_watching):
                            if sc_val is not None:
                                if isinstance(live_rem_watching.get(kid_c), dict):
                                    live_rem_watching[kid_c]["score"] = sc_val
                                if isinstance(rem_watching.get(kid_c), dict):
                                    rem_watching[kid_c]["score"] = sc_val
                        else:
                            tpl = self._ensure_remote_entry_template(kid_c, t_ru, t_orig, extra=meta_src)
                            tpl["watched"] = True
                            tpl["status"] = "done"
                            if sc_val is not None:
                                tpl["score"] = sc_val
                            live_rem_watched[kid_c] = tpl
                            rem_watched[kid_c] = tpl
                        self._save_dirty = True
                pushed += 1

    # 2. Local 'Смотрю' (`watching_local`)
    for raw_id in watching_local_list:
        if self._profile_id != start_pid:
            return pushed
        if str(raw_id) in watching_removed:
            continue
        kid_c, t_ru, t_orig = _extract_kid_and_titles(str(raw_id))
        if not kid_c or kid_c in rem_watching or kid_c in rem_watched or f"kin_{kid_c}" in watching_removed:
            continue
        if self._sync_to_kinorium_remote(
            action="watching_add",
            item_id=str(raw_id),
            title=t_ru,
            orig_title=t_orig,
            resolved_kid=kid_c,
        ):
            with self._state_lock:
                if self._profile_id == start_pid:
                    tpl = self._ensure_remote_entry_template(kid_c, t_ru, t_orig)
                    tpl["watching"] = True
                    tpl["status"] = "now"
                    self.state.setdefault("remote_watching_items", {})[kid_c] = tpl
                    rem_watching[kid_c] = tpl
                    self._save_dirty = True
            pushed += 1

    # 3. Local 'Буду смотреть' (`watchlist`)
    for raw_id in watchlist_list:
        if self._profile_id != start_pid:
            return pushed
        if str(raw_id) in watchlist_removed:
            continue
        kid_c, t_ru, t_orig = _extract_kid_and_titles(str(raw_id))
        if not kid_c or kid_c in rem_watchlist or kid_c in rem_watching or kid_c in rem_watched or f"kin_{kid_c}" in watchlist_removed:
            continue
        if self._sync_to_kinorium_remote(
            action="watchlist_add",
            item_id=str(raw_id),
            title=t_ru,
            orig_title=t_orig,
            resolved_kid=kid_c,
        ):
            with self._state_lock:
                if self._profile_id == start_pid:
                    tpl = self._ensure_remote_entry_template(kid_c, t_ru, t_orig)
                    tpl["in_watchlist"] = True
                    tpl["status"] = "future"
                    self.state.setdefault("remote_watchlist_items", {})[kid_c] = tpl
                    rem_watchlist[kid_c] = tpl
                    self._save_dirty = True
            pushed += 1

    # 4. Local 'Не буду смотреть' (`never_local`)
    for raw_id in never_local_list:
        if self._profile_id != start_pid:
            return pushed
        if str(raw_id) in never_removed:
            continue
        kid_c, t_ru, t_orig = _extract_kid_and_titles(str(raw_id))
        if not kid_c or kid_c in rem_never or f"kin_{kid_c}" in never_removed:
            continue
        if self._sync_to_kinorium_remote(
            action="never_add",
            item_id=str(raw_id),
            title=t_ru,
            orig_title=t_orig,
            resolved_kid=kid_c,
        ):
            with self._state_lock:
                if self._profile_id == start_pid:
                    tpl = self._ensure_remote_entry_template(kid_c, t_ru, t_orig)
                    tpl["not_watching"] = True
                    tpl["status"] = "never"
                    self.state.setdefault("remote_never_items", {})[kid_c] = tpl
                    rem_never[kid_c] = tpl
                    self._save_dirty = True
            pushed += 1

    if pushed > 0 and self._profile_id == start_pid:
        with self._state_lock:
            self._build_lookup_indices()
            self._save_state()
    return pushed

def reconcile_all_local_episodes(self, pull_watching_limit: int = 0) -> Dict[str, Any]:
    """
    Reconciles locally modified series episodes & active 'Продолжить просмотр' / 'Смотрю'
    series bidirectionally with Kinorium without flooding Kinorium with historical series requests.
    """
    if self.is_ip_cooldown_active():
        return {"ok": False, "reason": "ip_cooldown", "reconciled": 0}
    with self._state_lock:
        start_pid = self._profile_id
        user_cookie = (self.state.get("account", {}).get("session_cookie") or "").strip()
        cw_snap = list(self.state.get("continue_watching") or [])
        rem_watching_snap = dict(self.state.get("remote_watching_items") or {})
        dirty_ep_keys = set(str(k) for k in (self.state.get("dirty_episode_series") or []) if k)
        uw_ep_keys = {
            str(k)
            for k, v in (self.state.get("unwatched_episodes") or {}).items()
            if isinstance(v, dict) and any(v.values())
        }
        cer_ep_keys = {
            str(k)
            for k, v in (self.state.get("cleared_episode_ratings") or {}).items()
            if isinstance(v, dict) and any(v.values())
        }
        unsynced_er_keys = set()
        for k_er, er_map in (self.state.get("episode_ratings") or {}).items():
            if isinstance(er_map, dict):
                for ep_entry in er_map.values():
                    if isinstance(ep_entry, dict) and ep_entry.get("remote_synced") is not True:
                        unsynced_er_keys.add(str(k_er))
                        break
        local_keys = dirty_ep_keys | uw_ep_keys | cer_ep_keys | unsynced_er_keys
    if not user_cookie:
        return {"ok": False, "reason": "no_session_cookie", "reconciled": 0}

    cw_meta_by_id: Dict[str, Dict[str, str]] = {}
    for cw in cw_snap:
        cid = str(cw.get("id") or "").strip()
        if cid:
            cw_meta_by_id[cid] = {
                "title": str(cw.get("title") or ""),
                "orig_title": str(cw.get("orig_title") or ""),
                "media_type": str(cw.get("media_type") or ""),
            }

    tasks: List[Tuple[str, str, str, Optional[str]]] = []
    seen_targets: set = set()

    # 1. All series with local watched/unwatched/rated episodes (push + pull)
    for raw_k in local_keys:
        k_str = str(raw_k).strip()
        if not k_str:
            continue
        kid_cand = k_str[4:] if (k_str.startswith("kin_") and k_str[4:].isdigit()) else None
        t_ru = ""
        t_orig = ""
        if kid_cand and kid_cand in self._by_kid:
            t_ru = str(self._by_kid[kid_cand].get("ru_title") or "")
            t_orig = str(self._by_kid[kid_cand].get("orig_title") or "")
        if k_str in cw_meta_by_id:
            t_ru = t_ru or cw_meta_by_id[k_str]["title"]
            t_orig = t_orig or cw_meta_by_id[k_str]["orig_title"]
        lm = self._live_meta_by_id.get(k_str)
        if lm:
            t_ru = t_ru or str(lm.get("title") or "")
            t_orig = t_orig or str(lm.get("orig_title") or "")
            if not kid_cand and str(lm.get("kinorium_id") or "").isdigit():
                kid_cand = str(lm["kinorium_id"])
        if not kid_cand and not t_ru and not t_orig:
            continue
        dedup = kid_cand or k_str
        if dedup in seen_targets:
            continue
        seen_targets.add(dedup)
        tasks.append((k_str, t_ru, t_orig, kid_cand))

    # 2. Active series in Continue Watching & 'Смотрю' (pull remote Kinorium checkmarks into Velarium)
    pulled_extra = 0
    for cw in cw_snap:
        if pulled_extra >= pull_watching_limit:
            break
        if cw.get("media_type") != "series":
            continue
        cid = str(cw.get("id") or "")
        kid_c = cid[4:] if (cid.startswith("kin_") and cid[4:].isdigit()) else None
        dedup = kid_c or cid
        if dedup and dedup not in seen_targets:
            seen_targets.add(dedup)
            tasks.append((cid, str(cw.get("title") or ""), str(cw.get("orig_title") or ""), kid_c))
            pulled_extra += 1

    for kid_w, w_entry in rem_watching_snap.items():
        if pulled_extra >= pull_watching_limit:
            break
        if w_entry.get("media_type") != "series":
            continue
        kid_s = str(kid_w)
        if kid_s.isdigit() and kid_s not in seen_targets:
            seen_targets.add(kid_s)
            tasks.append(
                (
                    f"kin_{kid_s}",
                    str(w_entry.get("ru_title") or ""),
                    str(w_entry.get("orig_title") or ""),
                    kid_s,
                )
            )
            pulled_extra += 1

    def _run_one(t_args: Tuple[str, str, str, Optional[str]]) -> bool:
        if self._profile_id != start_pid:
            return False
        prev_tl = getattr(self._sync_cookie_tl, "cookie", None)
        self._sync_cookie_tl.cookie = user_cookie
        try:
            self.reconcile_series_episodes(
                item_id=t_args[0],
                title=t_args[1],
                orig_title=t_args[2],
                kid=t_args[3],
            )
            time.sleep(0.2)
            return True
        except Exception:
            return False
        finally:
            self._sync_cookie_tl.cookie = prev_tl

    reconciled_cnt = 0
    if tasks and self._profile_id == start_pid:
        for t_item in tasks:
            if _run_one(t_item):
                reconciled_cnt += 1
        if self._profile_id == start_pid:
            self._save_state()
    return {
        "ok": True,
        "reconciled": reconciled_cnt,
        "session_authenticated": self._session_auth_verified,
    }

def _sync_to_kinorium_remote(
    self,
    action: str,
    item_id: str,
    title: str = "",
    orig_title: str = "",
    score: Optional[int] = None,
    comment: str = "",
    resolved_kid: Optional[str] = None,
) -> bool:
    user_cookie = self._get_active_sync_cookie()
    if not user_cookie:
        return False
    kid = (
        str(resolved_kid)
        if (resolved_kid and str(resolved_kid).isdigit())
        else self._resolve_kinorium_id(item_id, title, orig_title, allow_network=True)
    )
    if not kid or not str(kid).isdigit():
        return False
    try:
        full_cookie = self._ensure_kinorium_cookies(extra_cookie=user_cookie)
        headers = {
            "User-Agent": self.UA,
            "Cookie": full_cookie,
            "X-Requested-With": "XMLHttpRequest",
            "Origin": "https://ru.kinorium.com",
            "Referer": f"https://ru.kinorium.com/{kid}/",
        }
        group_key = str(int(time.time() * 1000))
        if action in ("watched", "rate", "watchlist_add", "watching_add", "never_add"):
            if action == "watching_add":
                form: Dict[str, Any] = {
                    "movie_id": kid,
                    "group_key": group_key,
                    "status": "",
                    "isNow": "1",
                }
            else:
                status_map = {
                    "watched": "done",
                    "rate": "done",
                    "watchlist_add": "future",
                    "never_add": "never",
                }
                form = {
                    "movie_id": kid,
                    "group_key": group_key,
                    "status": status_map[action],
                    "isNow": "",
                }
            if score is not None:
                form["rating"] = str(score)
            if comment:
                form["comment"] = comment
            payload = urllib.parse.urlencode(form).encode("utf-8")
            post_hdrs = {**headers, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}
            _, raw_txt, _ = self._kinorium_http_request(
                "/handlers/setStatus/",
                method="POST",
                data=payload,
                extra_headers=post_hdrs,
                timeout=7.0,
            )
            raw = raw_txt.strip()
            if not raw.startswith("{"):
                return False
            resp_json = json.loads(raw)
            if isinstance(resp_json, dict) and (resp_json.get("error") or "result" not in resp_json):
                return False
            return True
        elif action in ("unwatched", "watchlist_remove", "watching_remove", "never_remove", "rate_remove"):
            if action == "watching_remove":
                del_type = "now"
            elif action == "rate_remove":
                del_type = "rating"
            else:
                del_type = "status"
            qs = urllib.parse.urlencode(
                {
                    "movie_id": kid,
                    "del_type": del_type,
                    "group_key": group_key,
                }
            )
            _, raw_txt, _ = self._kinorium_http_request(
                f"/handlers/delStatus/?{qs}",
                method="GET",
                extra_headers=headers,
                timeout=7.0,
            )
            raw = raw_txt.strip()
            if not raw.startswith("{"):
                return False
            resp_json = json.loads(raw)
            if isinstance(resp_json, dict) and (resp_json.get("error") or "result" not in resp_json):
                return False
            return True
    except Exception:
        pass
    return False
