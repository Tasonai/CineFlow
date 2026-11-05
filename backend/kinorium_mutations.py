"""
CineFlow — Kinorium Status, Episode, Rating & Profile Stats Mutations Submodule (`backend/kinorium_mutations.py`).

Encapsulates optimistic local state mutations and background two-way Kinorium writebacks:
- Continue Watching dismiss & restore (`dismiss_continue_watching`, `restore_continue_watching`)
- Remote entry template synthesis (`_ensure_remote_entry_template`)
- Episode watched recording & unrecording (`_record_episode_watched`, `_unrecord_episode_watched`)
- Batch & single episode watched toggles (`mark_episodes_batch`, `toggle_episode_watched`)
- Profile statistics & friend taste proximity (`get_profile_stats`)
- Title watched, rating, episode rating, watchlist, watching, and never toggles
  (`mark_watched`, `set_rating`, `set_episode_rating`, `toggle_watchlist`, `toggle_watching`, `toggle_not_watching`)
- Account configuration & auto-promotion to watching (`configure_account`, `_promote_to_watching_with_status`)
"""

import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from backend.kinorium_parsers import _norm_title, _safe_year_int


def dismiss_continue_watching(self, item_id: str, title: str = "") -> Dict[str, Any]:
    nr = _norm_title(title)
    kid_hint = self._resolve_kinorium_id(item_id, title, "", allow_network=False)
    kin_pref = f"kin_{kid_hint}" if kid_hint and str(kid_hint).isdigit() else ""
    target_ids = {str(x) for x in (item_id, kin_pref) if x}
    with self._state_lock:
        def _matches_cw(x: Dict[str, Any]) -> bool:
            x_id = str(x.get("id") or "")
            x_kid = str(x.get("kinorium_id") or "")
            if x_id in target_ids or (x_kid and f"kin_{x_kid}" in target_ids):
                return True
            if nr and (_norm_title(x.get("title", "")) == nr or _norm_title(x.get("orig_title", "")) == nr):
                return True
            return False

        removed_entries = [
            x
            for x in self.state.get("continue_watching", [])
            if isinstance(x, dict) and _matches_cw(x)
        ]
        if removed_entries:
            stash = self.state.setdefault("cw_dismissed_entries", {})
            if isinstance(stash, dict):
                stash[item_id or kin_pref or f"title:{nr}"] = removed_entries[0]
        self.state["continue_watching"] = [
            x
            for x in self.state.get("continue_watching", [])
            if not (isinstance(x, dict) and _matches_cw(x))
        ]
        dismissed = self.state.setdefault("cw_dismissed", [])
        for tid in target_ids:
            if tid not in dismissed:
                dismissed.append(tid)
        if nr and f"title:{nr}" not in dismissed:
            dismissed.append(f"title:{nr}")
        dismissed_cnt = self._count_dismissed_cw_items_locked()
        self._save_state()
    return {
        "ok": True,
        "dismissed_id": item_id,
        "cw_dismissed_count": dismissed_cnt,
    }


def restore_continue_watching(
    self, item_id: str = "", title: str = "", restore_all: bool = False
) -> Dict[str, Any]:
    with self._state_lock:
        dismissed = self.state.setdefault("cw_dismissed", [])
        stash = self.state.setdefault("cw_dismissed_entries", {})
        cw_arr = self.state.setdefault("continue_watching", [])
        if restore_all:
            if isinstance(stash, dict):
                existing_ids = {str(x.get("id") or "") for x in cw_arr}
                for stashed_entry in stash.values():
                    if isinstance(stashed_entry, dict) and str(stashed_entry.get("id") or "") not in existing_ids:
                        cw_arr.insert(0, stashed_entry)
                        existing_ids.add(str(stashed_entry.get("id") or ""))
                stash.clear()
            dismissed.clear()
        else:
            nr = _norm_title(title)
            kid_hint = self._resolve_kinorium_id(item_id, title, "", allow_network=False)
            kin_pref = f"kin_{kid_hint}" if kid_hint and str(kid_hint).isdigit() else ""
            target_ids = {str(x) for x in (item_id, kin_pref) if x}
            self.state["cw_dismissed"] = [
                d
                for d in dismissed
                if d not in target_ids and (not nr or d != f"title:{nr}")
            ]
            if isinstance(stash, dict):
                restored_entry = (
                    stash.pop(item_id, None)
                    or (stash.pop(kin_pref, None) if kin_pref else None)
                    or (stash.pop(f"title:{nr}", None) if nr else None)
                )
                if isinstance(restored_entry, dict):
                    if not any(x.get("id") == restored_entry.get("id") for x in cw_arr):
                        cw_arr.insert(0, restored_entry)
        dismissed_cnt = self._count_dismissed_cw_items_locked()
        self._save_state()
    return {
        "ok": True,
        "restored_id": item_id,
        "cw_dismissed_count": dismissed_cnt,
    }


def _ensure_remote_entry_template(
    self,
    kid: str,
    title: str,
    orig_title: str,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    existing = self._by_kid.get(str(kid))
    if existing:
        tpl = dict(existing)
    else:
        ex = extra or {}
        mtype = str(ex.get("media_type") or "movie")
        year_val = _safe_year_int(ex.get("year"))
        default_poster = f"https://ru-images.kinorium.com/movie/600/{kid}.jpg" if str(kid).isdigit() else ""
        default_backdrop = f"https://ru-images.kinorium.com/movie/1080/{kid}.jpg" if str(kid).isdigit() else ""
        tpl = {
            "kinorium_id": str(kid),
            "ru_title": title,
            "orig_title": orig_title or title,
            "year": year_val,
            "media_type": mtype,
            "seasons_count": int(ex.get("seasons_count") or (0 if mtype == "series" else 1)),
            "episodes_per_season": int(ex.get("episodes_per_season") or (0 if mtype == "series" else 1)),
            "genres": ["Сериал"] if mtype == "series" else ["Фильм"],
            "description": f"{title} ({orig_title or year_val or ''})".replace(" ()", ""),
            "kinorium_rating": 8.0,
            "imdb_rating": 8.0,
            "poster": str(ex.get("poster") or default_poster),
            "backdrop": str(ex.get("backdrop") or ex.get("poster") or default_backdrop),
            "status": "done",
            "watched": False,
            "watching": False,
            "in_watchlist": False,
            "not_watching": False,
            "score": None,
            "watched_at": "",
        }
    if extra:
        if extra.get("poster") and not tpl.get("poster"):
            tpl["poster"] = str(extra["poster"])
        if extra.get("backdrop") and not tpl.get("backdrop"):
            tpl["backdrop"] = str(extra["backdrop"])
        if extra.get("media_type"):
            tpl["media_type"] = str(extra["media_type"])
        if extra.get("year"):
            tpl["year"] = int(extra["year"])
        if extra.get("rezka_id"):
            tpl["rezka_id"] = str(extra["rezka_id"])
        if extra.get("rezka_url"):
            tpl["rezka_url"] = str(extra["rezka_url"])
    return tpl


def _record_episode_watched(
    self,
    item_id: str,
    title: str,
    orig_title: str,
    season: Optional[int],
    episode: Optional[int],
    resolved_kid: Optional[str] = None,
):
    if not season or not episode:
        return
    s_key = str(int(season))
    ep_num = int(episode)
    kid = resolved_kid or self._resolve_kinorium_id(item_id, title, orig_title, allow_network=False)
    with self._state_lock:
        we_root = self.state.setdefault("watched_episodes", {})
        uw_root = self.state.setdefault("unwatched_episodes", {})
        dirty_ep_series = self.state.setdefault("dirty_episode_series", [])
        keys = [k for k in (item_id, f"kin_{kid}" if (kid and str(kid).isdigit()) else "") if k]
        for k_id in dict.fromkeys(keys):
            if k_id not in dirty_ep_series:
                dirty_ep_series.append(k_id)
            item_map = we_root.setdefault(k_id, {})
            cur_list = item_map.get(s_key) or []
            if ep_num not in cur_list:
                cur_list.append(ep_num)
                item_map[s_key] = sorted(set(cur_list))
            uw_map = uw_root.get(k_id)
            if isinstance(uw_map, dict) and s_key in uw_map:
                rem_uw = [int(x) for x in (uw_map.get(s_key) or []) if str(x).isdigit() and int(x) != ep_num]
                if rem_uw:
                    uw_map[s_key] = sorted(set(rem_uw))
                else:
                    uw_map.pop(s_key, None)
        nr_cw = _norm_title(title)
        live_m = self.get_series_live_meta(item_id=item_id, title=title, orig_title=orig_title, kid=kid)
        smap_cw = (live_m.get("seasons_map") or {}) if isinstance(live_m, dict) else {}
        cur_s_eps = [int(x) for x in (smap_cw.get(str(int(season))) or []) if str(x).isdigit()]
        next_s_num = int(season)
        next_e_num = ep_num + 1
        if cur_s_eps and ep_num >= max(cur_s_eps):
            if str(int(season) + 1) in smap_cw or int((live_m or {}).get("latest_season") or 0) > int(season):
                next_s_num = int(season) + 1
                next_e_num = 1
        for cw_it in self.state.get("continue_watching") or []:
            if not isinstance(cw_it, dict) or cw_it.get("media_type") != "series":
                continue
            if (
                cw_it.get("id") == item_id
                or (kid and cw_it.get("id") == f"kin_{kid}")
                or (nr_cw and _norm_title(cw_it.get("title", "")) == nr_cw)
            ):
                if int(cw_it.get("season") or 1) == int(season) and int(cw_it.get("episode") or 1) == ep_num:
                    cw_it["season"] = next_s_num
                    cw_it["episode"] = next_e_num
                    cw_it["current_time"] = 0.0
                    cw_it["progress"] = 0.0
                    cw_it["is_auto_next"] = True
                    cw_it["updated_at"] = int(time.time())


def _unrecord_episode_watched(
    self,
    item_id: str,
    title: str,
    orig_title: str,
    season: Optional[int],
    episode: Optional[int],
    resolved_kid: Optional[str] = None,
) -> bool:
    if not season or not episode:
        return False
    s_key = str(int(season))
    ep_num = int(episode)
    kid = resolved_kid or self._resolve_kinorium_id(item_id, title, orig_title, allow_network=False)
    with self._state_lock:
        we_root = self.state.setdefault("watched_episodes", {})
        uw_root = self.state.setdefault("unwatched_episodes", {})
        keys = [k for k in (item_id, f"kin_{kid}" if (kid and str(kid).isdigit()) else "") if k]
        for k_id in dict.fromkeys(keys):
            item_map = we_root.get(k_id)
            if isinstance(item_map, dict) and s_key in item_map:
                next_list = [int(x) for x in (item_map.get(s_key) or []) if str(x).isdigit() and int(x) != ep_num]
                if next_list:
                    item_map[s_key] = sorted(set(next_list))
                else:
                    item_map.pop(s_key, None)
            uw_map = uw_root.setdefault(k_id, {})
            uw_list = uw_map.get(s_key) or []
            if ep_num not in uw_list:
                uw_list.append(ep_num)
                uw_map[s_key] = sorted(set(uw_list))

        # If this series was auto-completed into watched when all episodes were watched,
        # unmarking an episode reverts it back to 'Смотрю' (watching) so it isn't stuck in 'Просмотрено'.
        watched_dict = self.state.setdefault("watched", {})
        loc_w = self.state.setdefault("watching_local", [])
        rem_w = self.state.setdefault("watching_removed", [])
        reverted_auto = False
        for k_id in dict.fromkeys(keys):
            w_entry = watched_dict.get(k_id)
            if isinstance(w_entry, dict) and w_entry.get("auto_scrobbled"):
                watched_dict.pop(k_id, None)
                reverted_auto = True
        if kid and str(kid).isdigit():
            k_str = str(kid)
            rem_done = (self.state.get("remote_watched_items") or {}).get(k_str)
            if isinstance(rem_done, dict) and rem_done.get("auto_scrobbled"):
                popped_done = self.state["remote_watched_items"].pop(k_str, None)
                if isinstance(popped_done, dict):
                    popped_done["watched"] = False
                    popped_done["watching"] = True
                    popped_done["status"] = "now"
                    popped_done.pop("auto_scrobbled", None)
                    self.state.setdefault("remote_watching_items", {})[k_str] = popped_done
                reverted_auto = True
        if reverted_auto:
            for k_id in dict.fromkeys(keys):
                if k_id not in loc_w:
                    loc_w.append(k_id)
                if k_id in rem_w:
                    rem_w.remove(k_id)
            self._build_lookup_indices()
        return reverted_auto


def _run_remote_sync_bg(self, fn, *args, **kwargs) -> bool:
    with self._state_lock:
        user_cookie = (self.state.get("account", {}).get("session_cookie") or "").strip()
        enqueue_profile_id = self._profile_id
    if not user_cookie:
        return False

    def _worker():
        if self._profile_id != enqueue_profile_id:
            # Profile switched before the job ran: posting now would use another account's cookie
            return
        self._sync_cookie_tl.cookie = user_cookie
        try:
            fn(*args, **kwargs)
        except Exception:
            pass
        finally:
            self._sync_cookie_tl.cookie = None

    threading.Thread(target=_worker, daemon=True).start()
    return True


def mark_episodes_batch(
    self,
    item_id: str,
    title: str,
    orig_title: str = "",
    season: int = 1,
    episodes: Optional[List[int]] = None,
    mark_season_complete: bool = False,
    total_seasons: int = 0,
    total_episodes_in_season: int = 0,
    is_series_completed: Optional[bool] = None,
    **kwargs,
) -> Dict[str, Any]:
    eps = sorted({int(x) for x in (episodes or []) if str(x).isdigit() and int(x) > 0})
    yr_arg = int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None
    kid = self._resolve_kinorium_id(
        item_id,
        title,
        orig_title,
        allow_network=False,
        media_type="series",
        year=yr_arg,
    )
    for ep_num in eps:
        self._record_episode_watched(item_id, title, orig_title, season, ep_num, resolved_kid=kid)
    auto_completed_series = False
    promoted_to_watching = False
    remote_synced = False
    remote_synced_count = len(eps) if eps else 0
    if eps:
        auto_completed_series = self._maybe_auto_complete_series(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            season=season,
            episode=max(eps),
            total_seasons=total_seasons,
            total_episodes_in_season=total_episodes_in_season,
            is_series_completed=is_series_completed,
            **kwargs,
        )
        if not auto_completed_series:
            promoted_to_watching = self._promote_series_to_watching_if_needed(
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                kid=kid,
                **kwargs,
            )

        enqueue_pid = self._profile_id

        def _bg_batch_sync():
            eff_k = kid or self._resolve_kinorium_id(
                item_id, title, orig_title, allow_network=True, media_type="series", year=yr_arg
            )
            if eff_k and self._profile_id == enqueue_pid:
                for ep_n in eps:
                    self._record_episode_watched(item_id, title, orig_title, season, ep_n, resolved_kid=eff_k)
                self._sync_episodes_map_to_kinorium_remote(
                    kid=eff_k,
                    item_id=item_id,
                    target_by_season={int(season): eps},
                    mark_season_complete=mark_season_complete,
                )

        remote_synced = self._run_remote_sync_bg(_bg_batch_sync)
    self._save_state()
    status = self.get_item_status(item_id, title=title, orig_title=orig_title)
    status["marked_episodes_count"] = len(eps)
    status["mark_season_complete"] = bool(mark_season_complete)
    status["auto_completed_series"] = auto_completed_series
    status["promoted_to_watching"] = promoted_to_watching
    status["remote_synced"] = remote_synced
    status["remote_synced_count"] = remote_synced_count if remote_synced else 0
    status["kinorium_counts"] = self.get_sections_counts()
    return status


def toggle_episode_watched(
    self,
    item_id: str,
    title: str,
    orig_title: str = "",
    season: int = 1,
    episode: int = 1,
    watched: Optional[bool] = None,
    total_seasons: int = 0,
    total_episodes_in_season: int = 0,
    is_series_completed: Optional[bool] = None,
    **kwargs,
) -> Dict[str, Any]:
    s_num = max(1, int(season or 1))
    e_num = max(1, int(episode or 1))
    cur_status = self.get_item_status(item_id, title=title, orig_title=orig_title)
    cur_eps = (cur_status.get("watched_episodes") or {}).get(str(s_num)) or []
    currently_watched = e_num in cur_eps
    next_watched = (not currently_watched) if watched is None else bool(watched)
    yr_arg = int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None
    kid = self._resolve_kinorium_id(
        item_id,
        title,
        orig_title,
        allow_network=False,
        media_type="series",
        year=yr_arg,
    )
    auto_completed_series = False
    promoted_to_watching = False
    remote_synced = False
    if next_watched:
        self._record_episode_watched(item_id, title, orig_title, s_num, e_num, resolved_kid=kid)
        auto_completed_series = self._maybe_auto_complete_series(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            season=s_num,
            episode=e_num,
            total_seasons=total_seasons,
            total_episodes_in_season=total_episodes_in_season,
            is_series_completed=is_series_completed,
            **kwargs,
        )
        if not auto_completed_series:
            promoted_to_watching = self._promote_series_to_watching_if_needed(
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                kid=kid,
                **kwargs,
            )

        enqueue_pid = self._profile_id

        def _bg_ep_mark():
            eff_k = kid or self._resolve_kinorium_id(
                item_id, title, orig_title, allow_network=True, media_type="series", year=yr_arg
            )
            if eff_k and self._profile_id == enqueue_pid:
                self._record_episode_watched(item_id, title, orig_title, s_num, e_num, resolved_kid=eff_k)
                self._sync_episodes_map_to_kinorium_remote(
                    kid=eff_k,
                    item_id=item_id,
                    target_by_season={s_num: [e_num]},
                )

        remote_synced = self._run_remote_sync_bg(_bg_ep_mark)
    else:
        reverted_auto = self._unrecord_episode_watched(item_id, title, orig_title, s_num, e_num, resolved_kid=kid)
        ep_key = f"s{s_num}e{e_num}"
        with self._state_lock:
            er_root = self.state.setdefault("episode_ratings", {})
            cer_root = self.state.setdefault("cleared_episode_ratings", {})
            for k_id in filter(None, [item_id, f"kin_{kid}" if (kid and str(kid).isdigit()) else ""]):
                if isinstance(er_root.get(k_id), dict) and ep_key in er_root[k_id]:
                    er_root[k_id].pop(ep_key, None)
                    cer_root.setdefault(k_id, {})[ep_key] = True

        enqueue_pid = self._profile_id

        def _bg_ep_unmark():
            eff_k = kid or self._resolve_kinorium_id(
                item_id, title, orig_title, allow_network=True, media_type="series", year=yr_arg
            )
            if eff_k and self._profile_id == enqueue_pid:
                reverted_bg = self._unrecord_episode_watched(item_id, title, orig_title, s_num, e_num, resolved_kid=eff_k)
                with self._state_lock:
                    er_bg = self.state.get("episode_ratings") or {}
                    cer_bg = self.state.setdefault("cleared_episode_ratings", {})
                    if isinstance(er_bg.get(f"kin_{eff_k}"), dict) and ep_key in er_bg[f"kin_{eff_k}"]:
                        er_bg[f"kin_{eff_k}"].pop(ep_key, None)
                        cer_bg.setdefault(f"kin_{eff_k}", {})[ep_key] = True
                if reverted_auto or reverted_bg:
                    self._sync_to_kinorium_remote(
                        action="watching_add",
                        item_id=item_id,
                        title=title,
                        orig_title=orig_title,
                        resolved_kid=eff_k,
                    )
                ep_state = self.fetch_series_episodes_state(eff_k, item_id="")
                ep_info = (ep_state.get("episodes") or {}).get((s_num, e_num))
                if ep_info and ep_info.get("ep_id"):
                    if self._post_episode_status_remote(
                        kid=eff_k,
                        ep_id=str(ep_info["ep_id"]),
                        watched=False,
                    ):
                        ep_info["watched"] = False
                        ep_info["rating"] = None
                        with self._state_lock:
                            uw_bg = self.state.get("unwatched_episodes") or {}
                            cer_bg2 = self.state.get("cleared_episode_ratings") or {}
                            for k_u in filter(None, [item_id, f"kin_{eff_k}"]):
                                uw_s = uw_bg.get(k_u)
                                if isinstance(uw_s, dict) and str(s_num) in uw_s:
                                    rem_u = [
                                        int(x)
                                        for x in (uw_s.get(str(s_num)) or [])
                                        if str(x).isdigit() and int(x) != e_num
                                    ]
                                    if rem_u:
                                        uw_s[str(s_num)] = sorted(set(rem_u))
                                    else:
                                        uw_s.pop(str(s_num), None)
                                if isinstance(cer_bg2.get(k_u), dict):
                                    cer_bg2[k_u].pop(ep_key, None)
                self._save_state(immediate=False, bump_version=True)

        remote_synced = self._run_remote_sync_bg(_bg_ep_unmark)

    self._save_state()
    status = self.get_item_status(item_id, title=title, orig_title=orig_title)
    status["episode_watched"] = next_watched
    status["toggled_season"] = s_num
    status["toggled_episode"] = e_num
    status["auto_completed_series"] = auto_completed_series
    status["promoted_to_watching"] = promoted_to_watching
    status["remote_synced"] = remote_synced
    status["kinorium_counts"] = self.get_sections_counts()
    return status


def get_profile_stats(self) -> Dict[str, Any]:
    with self._state_lock:
        watched_dict = dict(self.state.get("remote_watched_items") or {})
        watching_dict = dict(self.state.get("remote_watching_items") or {})
        watchlist_dict = dict(self.state.get("remote_watchlist_items") or {})
        never_dict = dict(self.state.get("remote_never_items") or {})
        local_ratings = dict(self.state.get("ratings") or {})
        friends_by_kid = dict(self.state.get("friends_ratings_by_kid") or {})
        friends_list_snap = list(self.state.get("friends") or [])

    watched_movies = 0
    watched_series = 0
    histogram = {str(s): 0 for s in range(10, 0, -1)}
    user_scores: List[int] = []
    kin_scores: List[float] = []
    cur_decade_key = f"2020–{max(2026, time.localtime().tm_year)}"
    decades = {
        cur_decade_key: 0,
        "2010–2019": 0,
        "2000–2009": 0,
        "1990–1999": 0,
        "До 1990": 0,
    }
    favorites: List[Dict[str, Any]] = []
    friend_stats: Dict[str, Dict[str, Any]] = {}

    for kid, entry in watched_dict.items():
        if not isinstance(entry, dict):
            continue
        mtype = entry.get("media_type", "movie")
        if mtype == "series":
            watched_series += 1
        else:
            watched_movies += 1

        yr_raw = _safe_year_int(entry.get("year"))
        if yr_raw >= 2020:
            decades[cur_decade_key] += 1
        elif yr_raw >= 2010:
            decades["2010–2019"] += 1
        elif yr_raw >= 2000:
            decades["2000–2009"] += 1
        elif yr_raw >= 1990:
            decades["1990–1999"] += 1
        elif yr_raw > 0:
            decades["До 1990"] += 1

        kr = entry.get("kinorium_rating")
        kr_float: Optional[float] = None
        if kr:
            try:
                kr_float = float(kr)
                kin_scores.append(kr_float)
            except Exception:
                kr_float = None
        im_raw = entry.get("imdb_rating")
        im_float: Optional[float] = None
        if im_raw:
            try:
                im_float = float(im_raw)
            except Exception:
                im_float = None

        loc_r = local_ratings.get(f"kin_{kid}") or local_ratings.get(str(kid))
        if isinstance(loc_r, dict):
            sc = (
                None
                if loc_r.get("cleared")
                else (loc_r.get("score") if loc_r.get("score") is not None else entry.get("score"))
            )
        else:
            sc = entry.get("score")
        if sc is not None:
            try:
                sc_int = max(1, min(10, int(sc)))
                user_scores.append(sc_int)
                histogram[str(sc_int)] = histogram.get(str(sc_int), 0) + 1
                if sc_int >= 9:
                    favorites.append(
                        {
                            "id": f"kin_{kid}" if str(kid).isdigit() else str(kid),
                            "kinorium_id": str(kid) if str(kid).isdigit() else "",
                            "title": entry.get("ru_title") or entry.get("orig_title") or "",
                            "orig_title": entry.get("orig_title") or "",
                            "year": yr_raw or "",
                            "media_type": mtype,
                            "score": sc_int,
                            "kinorium_rating": kr_float,
                            "imdb_rating": im_float,
                            "poster": entry.get("poster")
                            or (f"https://ru-images.kinorium.com/movie/600/{kid}.jpg" if str(kid).isdigit() else ""),
                        }
                    )
                for fr in friends_by_kid.get(str(kid), []):
                    fname = fr.get("name")
                    fscore = fr.get("score")
                    if fname and fscore:
                        st = friend_stats.setdefault(
                            fname,
                            {
                                "name": fname,
                                "common": 0,
                                "similar_within_1": 0,
                                "diff_sum": 0.0,
                                "friend_sum": 0.0,
                            },
                        )
                        diff_val = abs(float(sc_int) - float(fscore))
                        st["common"] += 1
                        if diff_val <= 1.0:
                            st["similar_within_1"] += 1
                        st["diff_sum"] += diff_val
                        st["friend_sum"] += float(fscore)
            except Exception:
                pass

    favorites.sort(key=lambda x: (x["score"], _safe_year_int(x.get("year"))), reverse=True)
    friend_meta_by_name = {
        str(f.get("name") or "").strip(): f
        for f in friends_list_snap
        if isinstance(f, dict) and f.get("name")
    }
    friends_out = []
    for fname, st in friend_stats.items():
        if st["common"] > 0:
            avg_diff = st["diff_sum"] / st["common"]
            f_meta = friend_meta_by_name.get(fname) or {}
            official_pct = f_meta.get("kinorium_proximity_pct")
            if official_pct is not None:
                similarity = max(0, min(100, int(official_pct)))
            else:
                similarity = max(0, min(100, round(st["similar_within_1"] * 100 / st["common"])))
            friends_out.append(
                {
                    "name": fname,
                    "common_count": st["common"],
                    "similar_count": st["similar_within_1"],
                    "avg_friend_score": round(st["friend_sum"] / st["common"], 1),
                    "avg_diff": round(avg_diff, 2),
                    "similarity_pct": similarity,
                    "official_kinorium_pct": official_pct is not None,
                }
            )
    friends_out.sort(key=lambda x: (x["similarity_pct"], x["common_count"]), reverse=True)

    total_watched = len(watched_dict)
    estimated_hours = round(watched_movies * 2.0 + watched_series * 10.5)
    return {
        "profile_name": self.state.get("account", {}).get("display_name") or "Киноман",
        "user_id": self.state.get("account", {}).get("user_id") or "",
        "total_watched": total_watched,
        "watched_movies": watched_movies,
        "watched_series": watched_series,
        "watching_count": len(watching_dict),
        "watchlist_count": len(watchlist_dict),
        "never_count": len(never_dict),
        "estimated_hours": estimated_hours,
        "estimated_days": round(estimated_hours / 24, 1),
        "rated_count": len(user_scores),
        "avg_user_rating": round(sum(user_scores) / len(user_scores), 2) if user_scores else 0.0,
        "avg_kinorium_rating": round(sum(kin_scores) / len(kin_scores), 2) if kin_scores else 0.0,
        "ratings_histogram": histogram,
        "decades": decades,
        "friends_comparison": friends_out[:8],
        "top_favorites": favorites[:12],
    }


def mark_watched(
    self,
    item_id: str,
    title: str,
    orig_title: str = "",
    watched: bool = True,
    season: Optional[int] = None,
    episode: Optional[int] = None,
    auto_scrobbled: bool = False,
    auto_scrobbled_alias: bool = False,
    _skip_remote_sync: bool = False,
    **kwargs,
) -> Dict[str, Any]:
    now_str = time.strftime("%Y-%m-%d %H:%M")
    prev_status = self.get_item_status(item_id, title=title, orig_title=orig_title)
    was_watching = bool(prev_status.get("watching"))
    yr_arg = int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None
    mtype_arg = str(kwargs.get("media_type") or "")
    kid = self._resolve_kinorium_id(
        item_id,
        title,
        orig_title,
        allow_network=False,
        media_type=mtype_arg,
        year=yr_arg,
    )
    eff_kid = str(kid) if (kid and str(kid).isdigit()) else ""
    eff_rkey = eff_kid or (str(item_id).strip() if str(item_id or "").strip() else f"local_{_norm_title(title or orig_title)}")
    nr = _norm_title(title)
    remote_ok = False
    if watched:
        if season and episode:
            self._record_episode_watched(item_id, title, orig_title, season, episode, resolved_kid=kid)
        entry_val = {
            "item_id": item_id,
            "title": title,
            "orig_title": orig_title,
            "watched": True,
            "watched_at": now_str,
            "season": season,
            "episode": episode,
            "auto_scrobbled": auto_scrobbled or auto_scrobbled_alias,
            "remote_synced": False,
        }
        with self._state_lock:
            self.state.setdefault("watched", {})[item_id] = entry_val
            self.state["continue_watching"] = [
                x
                for x in self.state.get("continue_watching", [])
                if x.get("id") != item_id
                and (not eff_kid or x.get("id") != f"kin_{eff_kid}")
                and (not nr or _norm_title(x.get("title", "")) != nr)
            ]
            loc_w = self.state.setdefault("watching_local", [])
            if item_id in loc_w:
                loc_w.remove(item_id)
            if eff_kid and f"kin_{eff_kid}" in loc_w:
                loc_w.remove(f"kin_{eff_kid}")
            rem_w = self.state.setdefault("watching_removed", [])
            if item_id and item_id not in rem_w:
                rem_w.append(item_id)
            loc_n = self.state.setdefault("never_local", [])
            if item_id in loc_n:
                loc_n.remove(item_id)
            rem_n = self.state.setdefault("never_removed", [])
            if item_id and item_id not in rem_n:
                rem_n.append(item_id)
            if eff_kid:
                self.state["watched"][f"kin_{eff_kid}"] = entry_val
                if f"kin_{eff_kid}" not in rem_w:
                    rem_w.append(f"kin_{eff_kid}")
                if f"kin_{eff_kid}" in loc_n:
                    loc_n.remove(f"kin_{eff_kid}")
                if f"kin_{eff_kid}" not in rem_n:
                    rem_n.append(f"kin_{eff_kid}")
            if eff_rkey:
                tpl = self._ensure_remote_entry_template(eff_kid or eff_rkey, title, orig_title, extra=kwargs)
                tpl["watched"] = True
                tpl["watching"] = False
                tpl["in_watchlist"] = False
                tpl["not_watching"] = False
                tpl["status"] = "done"
                tpl["watched_at"] = now_str
                self.state.setdefault("remote_watched_items", {})[str(eff_rkey)] = tpl
                for k_pop in {str(eff_rkey), str(item_id or "").strip()} - {""}:
                    if k_pop != str(eff_rkey):
                        (self.state.get("remote_watched_items") or {}).pop(k_pop, None)
                    (self.state.get("remote_watchlist_items") or {}).pop(k_pop, None)
                    (self.state.get("remote_watching_items") or {}).pop(k_pop, None)
                    (self.state.get("remote_never_items") or {}).pop(k_pop, None)
            wl_list = self.state.setdefault("watchlist", [])
            if item_id in wl_list:
                wl_list.remove(item_id)
            if eff_kid and f"kin_{eff_kid}" in wl_list:
                wl_list.remove(f"kin_{eff_kid}")
            rem_wl = self.state.setdefault("watchlist_removed", [])
            if item_id and item_id not in rem_wl:
                rem_wl.append(item_id)
            if eff_kid and f"kin_{eff_kid}" not in rem_wl:
                rem_wl.append(f"kin_{eff_kid}")
        if not _skip_remote_sync:
            enqueue_pid = self._profile_id

            def _bg_watched_sync():
                eff_k = eff_kid or (
                    self._resolve_kinorium_id(
                        item_id, title, orig_title, allow_network=True, media_type=mtype_arg, year=yr_arg
                    )
                    or ""
                )
                if self._profile_id != enqueue_pid:
                    return
                if eff_k and str(eff_k).isdigit() and eff_rkey != str(eff_k):
                    with self._state_lock:
                        if self._profile_id != enqueue_pid:
                            return
                        rw_d = self.state.setdefault("remote_watched_items", {})
                        migrated = rw_d.pop(str(eff_rkey), None)
                        if isinstance(migrated, dict):
                            migrated["kinorium_id"] = str(eff_k)
                            rw_d.setdefault(str(eff_k), migrated)
                            self._build_lookup_indices()
                if season and episode and eff_k:
                    self._sync_episodes_map_to_kinorium_remote(
                        kid=eff_k,
                        item_id=item_id,
                        target_by_season={int(season): [int(episode)]},
                    )
                if was_watching:
                    self._sync_to_kinorium_remote(
                        action="watching_remove",
                        item_id=item_id,
                        title=title,
                        orig_title=orig_title,
                        resolved_kid=eff_k or None,
                    )
                pushed_ok = self._sync_to_kinorium_remote(
                    action="watched",
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    resolved_kid=eff_k or None,
                )
                if pushed_ok and self._profile_id == enqueue_pid:
                    with self._state_lock:
                        w_d = self.state.get("watched") or {}
                        for k_w in filter(None, [item_id, f"kin_{eff_k}" if eff_k else ""]):
                            if isinstance(w_d.get(k_w), dict):
                                w_d[k_w]["remote_synced"] = True
                        self._save_state(immediate=False, bump_version=False)
                return pushed_ok

            remote_ok = self._run_remote_sync_bg(_bg_watched_sync)
    else:
        unw_val = {
            "item_id": item_id,
            "title": title,
            "orig_title": orig_title,
            "watched": False,
        }
        cleared_r = {"score": None, "comment": "", "cleared": True, "updated_at": now_str}
        with self._state_lock:
            self.state.setdefault("watched", {})[item_id] = unw_val
            if item_id in (self.state.get("ratings") or {}):
                self.state["ratings"][item_id] = cleared_r
            if eff_kid:
                self.state["watched"][f"kin_{eff_kid}"] = unw_val
                if f"kin_{eff_kid}" in (self.state.get("ratings") or {}):
                    self.state["ratings"][f"kin_{eff_kid}"] = cleared_r
            for k_pop in {str(eff_rkey), str(eff_kid), str(item_id or "").strip()} - {""}:
                (self.state.get("remote_watched_items") or {}).pop(k_pop, None)
        if not _skip_remote_sync:
            remote_ok = self._run_remote_sync_bg(
                self._sync_to_kinorium_remote,
                action="unwatched",
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_kid or None,
            )

    with self._state_lock:
        self._build_lookup_indices()
        self._save_state()
    status = self.get_item_status(item_id, title=title, orig_title=orig_title)
    status["remote_synced"] = remote_ok
    status["kinorium_counts"] = self.get_sections_counts()
    return status


def set_rating(
    self,
    item_id: str,
    title: str,
    score: int,
    comment: str = "",
    orig_title: str = "",
    is_series_completed: Optional[bool] = None,
    **kwargs,
) -> Dict[str, Any]:
    raw_score = int(score or 0)
    now_str = time.strftime("%Y-%m-%d %H:%M")
    yr_arg = int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None
    mtype_arg = str(kwargs.get("media_type") or "")
    kid = self._resolve_kinorium_id(
        item_id,
        title,
        orig_title,
        allow_network=False,
        media_type=mtype_arg,
        year=yr_arg,
    )

    if raw_score <= 0:
        cleared_val = {"score": None, "comment": "", "cleared": True, "updated_at": now_str}
        with self._state_lock:
            self.state.setdefault("ratings", {})[item_id] = cleared_val
            if kid:
                self.state["ratings"][f"kin_{kid}"] = cleared_val
                for sec_k in ("remote_watched_items", "remote_watching_items", "remote_watchlist_items"):
                    sec_d = self.state.get(sec_k) or {}
                    if str(kid) in sec_d:
                        sec_d[str(kid)]["score"] = None
            self._build_lookup_indices()
            self._save_state()
        remote_ok = self._run_remote_sync_bg(
            self._sync_to_kinorium_remote,
            action="rate_remove",
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            resolved_kid=kid,
        )
        status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        status["remote_synced"] = remote_ok
        status["kinorium_counts"] = self.get_sections_counts()
        return status

    score = max(1, min(10, raw_score))
    prev_status = self.get_item_status(item_id, title=title, orig_title=orig_title)
    was_watching = bool(prev_status.get("watching"))
    remote_item = self._resolve_remote_item(item_id, title, orig_title)
    meta_kw = kwargs.get("item_meta") if isinstance(kwargs.get("item_meta"), dict) else {}
    mtype = str(
        kwargs.get("media_type")
        or meta_kw.get("media_type")
        or (remote_item.get("media_type") if remote_item else "")
        or ""
    ).lower()
    completed_flag = (
        bool(is_series_completed)
        if isinstance(is_series_completed, bool)
        else bool(prev_status.get("is_completed") or prev_status.get("is_series_completed"))
    )
    keep_in_watching = bool(
        prev_status.get("watching")
        and mtype != "movie"
        and not completed_flag
    )

    r_val = {
        "score": score,
        "comment": comment.strip(),
        "title": title,
        "orig_title": orig_title,
        "keep_in_watching": keep_in_watching,
        "updated_at": now_str,
        "remote_synced": False,
    }
    with self._state_lock:
        self.state.setdefault("ratings", {})[item_id] = r_val
        if kid:
            self.state["ratings"][f"kin_{kid}"] = r_val

        loc_n = self.state.setdefault("never_local", [])
        if item_id in loc_n:
            loc_n.remove(item_id)
        rem_n = self.state.setdefault("never_removed", [])
        if item_id and item_id not in rem_n:
            rem_n.append(item_id)
        if kid:
            k_pref = f"kin_{kid}"
            if k_pref in loc_n:
                loc_n.remove(k_pref)
            if k_pref not in rem_n:
                rem_n.append(k_pref)
            (self.state.get("remote_never_items") or {}).pop(str(kid), None)

    if not keep_in_watching:
        self.mark_watched(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            watched=True,
            _skip_remote_sync=True,
            **kwargs,
        )

    with self._state_lock:
        if kid:
            for sec_k in ("remote_watched_items", "remote_watching_items", "remote_watchlist_items"):
                sec_d = self.state.get(sec_k) or {}
                if str(kid) in sec_d:
                    sec_d[str(kid)]["score"] = score
        self._build_lookup_indices()
        self._save_state()

    enqueue_pid = self._profile_id

    def _bg_rate_sync():
        eff_k = kid or self._resolve_kinorium_id(
            item_id, title, orig_title, allow_network=True, media_type=mtype_arg, year=yr_arg
        )
        if self._profile_id != enqueue_pid:
            return False
        if not keep_in_watching and was_watching:
            self._sync_to_kinorium_remote(
                action="watching_remove",
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_k,
            )
        pushed_ok = self._sync_to_kinorium_remote(
            action="rate",
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            score=score,
            comment=comment,
            resolved_kid=eff_k,
        )
        if pushed_ok and self._profile_id == enqueue_pid:
            with self._state_lock:
                r_d = self.state.get("ratings") or {}
                w_d = self.state.get("watched") or {}
                for k_r in filter(None, [item_id, f"kin_{eff_k}" if eff_k else ""]):
                    if isinstance(r_d.get(k_r), dict):
                        r_d[k_r]["remote_synced"] = True
                    if not keep_in_watching and isinstance(w_d.get(k_r), dict):
                        w_d[k_r]["remote_synced"] = True
                self._save_state(immediate=False, bump_version=False)
        return pushed_ok

    remote_ok = self._run_remote_sync_bg(_bg_rate_sync)
    status = self.get_item_status(item_id, title=title, orig_title=orig_title)
    status["remote_synced"] = remote_ok
    status["kinorium_counts"] = self.get_sections_counts()
    return status


def set_episode_rating(
    self,
    item_id: str,
    title: str,
    season: int,
    episode: int,
    score: int,
    comment: str = "",
    orig_title: str = "",
    episode_title: str = "",
    total_seasons: int = 0,
    total_episodes_in_season: int = 0,
    is_series_completed: Optional[bool] = None,
    **kwargs,
) -> Dict[str, Any]:
    raw_score = int(score or 0)
    s_num = max(1, int(season or 1))
    e_num = max(1, int(episode or 1))
    ep_key = f"s{s_num}e{e_num}"
    now_str = time.strftime("%Y-%m-%d %H:%M")
    yr_arg = int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None
    kid = self._resolve_kinorium_id(
        item_id,
        title,
        orig_title,
        allow_network=False,
        media_type="series",
        year=yr_arg,
    )
    remote_synced = False

    if raw_score <= 0:
        with self._state_lock:
            er_root = self.state.setdefault("episode_ratings", {})
            cer_root = self.state.setdefault("cleared_episode_ratings", {})
            for k_id in filter(None, [item_id, f"kin_{kid}" if (kid and str(kid).isdigit()) else ""]):
                item_map = er_root.get(k_id)
                if isinstance(item_map, dict):
                    item_map.pop(ep_key, None)
                cer_root.setdefault(k_id, {})[ep_key] = True

        enqueue_pid = self._profile_id

        def _bg_clear_ep_rate():
            eff_k = kid or self._resolve_kinorium_id(
                item_id, title, orig_title, allow_network=True, media_type="series", year=yr_arg
            )
            if eff_k and self._profile_id == enqueue_pid:
                with self._state_lock:
                    if self._profile_id != enqueue_pid:
                        return
                    er_bg = self.state.get("episode_ratings") or {}
                    cer_bg = self.state.setdefault("cleared_episode_ratings", {})
                    if isinstance(er_bg.get(f"kin_{eff_k}"), dict):
                        er_bg[f"kin_{eff_k}"].pop(ep_key, None)
                    cer_bg.setdefault(f"kin_{eff_k}", {})[ep_key] = True
                ep_state = self.fetch_series_episodes_state(eff_k, item_id="")
                ep_info = (ep_state.get("episodes") or {}).get((s_num, e_num))
                if ep_info and ep_info.get("ep_id") and self._profile_id == enqueue_pid:
                    if self._post_episode_status_remote(
                        kid=eff_k,
                        ep_id=str(ep_info["ep_id"]),
                        watched=True,
                        clear_rating_only=True,
                    ):
                        ep_info["rating"] = None
                        with self._state_lock:
                            if self._profile_id == enqueue_pid:
                                cer_done = self.state.get("cleared_episode_ratings") or {}
                                for k_u in filter(None, [item_id, f"kin_{eff_k}"]):
                                    if isinstance(cer_done.get(k_u), dict):
                                        cer_done[k_u].pop(ep_key, None)
                if self._profile_id == enqueue_pid:
                    self._save_state(immediate=False, bump_version=True)

        remote_synced = self._run_remote_sync_bg(_bg_clear_ep_rate)
        self._save_state()
        status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        status["rated_episode"] = None
        status["auto_completed_series"] = False
        status["remote_synced"] = remote_synced
        status["kinorium_counts"] = self.get_sections_counts()
        return status

    score = max(1, min(10, raw_score))
    clean_comment = (comment or "").strip()
    entry = {
        "season": s_num,
        "episode": e_num,
        "score": score,
        "comment": clean_comment,
        "episode_title": (episode_title or "").strip(),
        "updated_at": now_str,
        "remote_synced": False,
    }
    with self._state_lock:
        er_root = self.state.setdefault("episode_ratings", {})
        cer_root = self.state.get("cleared_episode_ratings") or {}
        for k_id in filter(None, [item_id, f"kin_{kid}" if (kid and str(kid).isdigit()) else ""]):
            item_map = er_root.setdefault(k_id, {})
            item_map[ep_key] = entry
            if isinstance(cer_root.get(k_id), dict):
                cer_root[k_id].pop(ep_key, None)
    self._record_episode_watched(item_id, title, orig_title, s_num, e_num, resolved_kid=kid)
    auto_completed_series = self._maybe_auto_complete_series(
        item_id=item_id,
        title=title,
        orig_title=orig_title,
        season=s_num,
        episode=e_num,
        total_seasons=total_seasons,
        total_episodes_in_season=total_episodes_in_season,
        is_series_completed=is_series_completed,
        **kwargs,
    )
    promoted_to_watching = False
    if not auto_completed_series:
        promoted_to_watching = self._promote_series_to_watching_if_needed(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            kid=kid,
            **kwargs,
        )

    enqueue_pid = self._profile_id

    def _bg_ep_rate():
        eff_k = kid or self._resolve_kinorium_id(
            item_id, title, orig_title, allow_network=True, media_type="series", year=yr_arg
        )
        if eff_k and self._profile_id == enqueue_pid:
            self._record_episode_watched(item_id, title, orig_title, s_num, e_num, resolved_kid=eff_k)
            ep_state = self.fetch_series_episodes_state(eff_k, item_id=item_id)
            ep_info = (ep_state.get("episodes") or {}).get((s_num, e_num))
            if ep_info and ep_info.get("ep_id") and not ep_info.get("is_future") and self._profile_id == enqueue_pid:
                if self._post_episode_status_remote(
                    kid=eff_k,
                    ep_id=str(ep_info["ep_id"]),
                    watched=True,
                    score=score,
                    comment=clean_comment,
                ):
                    ep_info["watched"] = True
                    ep_info["rating"] = score
                    with self._state_lock:
                        if self._profile_id == enqueue_pid:
                            er_done = self.state.get("episode_ratings") or {}
                            for k_u in filter(None, [item_id, f"kin_{eff_k}"]):
                                if isinstance(er_done.get(k_u), dict) and isinstance(er_done[k_u].get(ep_key), dict):
                                    er_done[k_u][ep_key]["remote_synced"] = True
                            self._save_state(immediate=False, bump_version=False)
                    return True
        return False

    remote_synced = self._run_remote_sync_bg(_bg_ep_rate)
    self._save_state()
    status = self.get_item_status(item_id, title=title, orig_title=orig_title)
    status["rated_episode"] = entry
    status["auto_completed_series"] = auto_completed_series
    status["promoted_to_watching"] = promoted_to_watching
    status["remote_synced"] = remote_synced
    status["kinorium_counts"] = self.get_sections_counts()
    return status


def toggle_watchlist(self, item_id: str, title: str = "", orig_title: str = "", **kwargs) -> Dict[str, Any]:
    cur = self.get_item_status(item_id, title=title, orig_title=orig_title)
    was_watching = bool(cur.get("watching"))
    was_watched = bool(cur.get("watched"))
    was_never = bool(cur.get("not_watching"))
    yr_arg = int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None
    mtype_arg = str(kwargs.get("media_type") or "")
    kid = self._resolve_kinorium_id(
        item_id,
        title,
        orig_title,
        allow_network=False,
        media_type=mtype_arg,
        year=yr_arg,
    )
    eff_kid = str(kid) if (kid and str(kid).isdigit()) else ""
    eff_rkey = eff_kid or (str(item_id).strip() if str(item_id or "").strip() else f"local_{_norm_title(title or orig_title)}")
    with self._state_lock:
        wl_list = self.state.setdefault("watchlist", [])
        rem_wl = self.state.setdefault("watchlist_removed", [])
        loc_w = self.state.setdefault("watching_local", [])
        rem_w = self.state.setdefault("watching_removed", [])
        loc_n = self.state.setdefault("never_local", [])
        rem_n = self.state.setdefault("never_removed", [])
        if cur.get("in_watchlist"):
            if item_id in wl_list:
                wl_list.remove(item_id)
            if eff_kid and f"kin_{eff_kid}" in wl_list:
                wl_list.remove(f"kin_{eff_kid}")
            if item_id and item_id not in rem_wl:
                rem_wl.append(item_id)
            if eff_kid and f"kin_{eff_kid}" not in rem_wl:
                rem_wl.append(f"kin_{eff_kid}")
            for k_pop in {str(eff_rkey), str(eff_kid), str(item_id or "").strip()} - {""}:
                (self.state.get("remote_watchlist_items") or {}).pop(k_pop, None)
            if eff_kid and isinstance(self.state.get("remote_removals_pushed"), list):
                self.state["remote_removals_pushed"] = [
                    x for x in self.state["remote_removals_pushed"] if x != f"watchlist_remove:{eff_kid}"
                ]
            action_mode = "remove"
        else:
            if item_id and item_id not in wl_list:
                wl_list.append(item_id)
            if item_id in rem_wl:
                rem_wl.remove(item_id)
            if item_id in loc_w:
                loc_w.remove(item_id)
            if was_watching and item_id and item_id not in rem_w:
                rem_w.append(item_id)
            if item_id in loc_n:
                loc_n.remove(item_id)
            if was_never and item_id and item_id not in rem_n:
                rem_n.append(item_id)
            if was_watched:
                self.state.setdefault("watched", {})[item_id] = {
                    "item_id": item_id,
                    "title": title,
                    "orig_title": orig_title,
                    "watched": False,
                }
            if eff_kid:
                k_pref = f"kin_{eff_kid}"
                if k_pref in rem_wl:
                    rem_wl.remove(k_pref)
                if k_pref in loc_w:
                    loc_w.remove(k_pref)
                if was_watching and k_pref not in rem_w:
                    rem_w.append(k_pref)
                if k_pref in loc_n:
                    loc_n.remove(k_pref)
                if was_never and k_pref not in rem_n:
                    rem_n.append(k_pref)
                if was_watched:
                    self.state.setdefault("watched", {})[k_pref] = {
                        "item_id": k_pref,
                        "title": title,
                        "orig_title": orig_title,
                        "watched": False,
                    }
            if eff_rkey:
                for k_pop in {str(eff_rkey), str(item_id or "").strip()} - {""}:
                    if k_pop != str(eff_rkey):
                        (self.state.get("remote_watchlist_items") or {}).pop(k_pop, None)
                    (self.state.get("remote_watching_items") or {}).pop(k_pop, None)
                    (self.state.get("remote_never_items") or {}).pop(k_pop, None)
                    (self.state.get("remote_watched_items") or {}).pop(k_pop, None)
                tpl = self._ensure_remote_entry_template(eff_kid or eff_rkey, title, orig_title, extra=kwargs)
                tpl["in_watchlist"] = True
                tpl["watching"] = False
                tpl["watched"] = False
                tpl["not_watching"] = False
                tpl["status"] = "future"
                self.state.setdefault("remote_watchlist_items", {})[str(eff_rkey)] = tpl
            action_mode = "add"
        self._build_lookup_indices()
        self._save_state()

    if action_mode == "remove":
        remote_ok = self._run_remote_sync_bg(
            self._sync_to_kinorium_remote,
            action="watchlist_remove",
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            resolved_kid=eff_kid or None,
        )
    else:
        enqueue_pid = self._profile_id

        def _bg_watchlist_add():
            eff_k = eff_kid or (
                self._resolve_kinorium_id(
                    item_id, title, orig_title, allow_network=True, media_type=mtype_arg, year=yr_arg
                )
                or ""
            )
            if self._profile_id != enqueue_pid:
                return
            if eff_k and str(eff_k).isdigit() and eff_rkey != str(eff_k):
                with self._state_lock:
                    if self._profile_id != enqueue_pid:
                        return
                    rwl_d = self.state.setdefault("remote_watchlist_items", {})
                    migrated = rwl_d.pop(str(eff_rkey), None)
                    if isinstance(migrated, dict):
                        migrated["kinorium_id"] = str(eff_k)
                        rwl_d.setdefault(str(eff_k), migrated)
                        self._build_lookup_indices()
            if was_watching:
                self._sync_to_kinorium_remote(
                    action="watching_remove",
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    resolved_kid=eff_k or None,
                )
            if was_watched:
                self._sync_to_kinorium_remote(
                    action="unwatched",
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    resolved_kid=eff_k or None,
                )
            if was_never:
                self._sync_to_kinorium_remote(
                    action="never_remove",
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    resolved_kid=eff_k or None,
                )
            self._sync_to_kinorium_remote(
                action="watchlist_add",
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_k or None,
            )

        remote_ok = self._run_remote_sync_bg(_bg_watchlist_add)
    status = self.get_item_status(item_id, title=title, orig_title=orig_title)
    status["remote_synced"] = remote_ok
    status["kinorium_counts"] = self.get_sections_counts()
    return status


def toggle_watching(self, item_id: str, title: str = "", orig_title: str = "", **kwargs) -> Dict[str, Any]:
    cur = self.get_item_status(item_id, title=title, orig_title=orig_title)
    was_in_watchlist = bool(cur.get("in_watchlist"))
    was_watched = bool(cur.get("watched"))
    was_never = bool(cur.get("not_watching"))
    yr_arg = int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None
    mtype_arg = str(kwargs.get("media_type") or "")
    kid = self._resolve_kinorium_id(
        item_id,
        title,
        orig_title,
        allow_network=False,
        media_type=mtype_arg,
        year=yr_arg,
    )
    eff_kid = str(kid) if (kid and str(kid).isdigit()) else ""
    eff_rkey = eff_kid or (str(item_id).strip() if str(item_id or "").strip() else f"local_{_norm_title(title or orig_title)}")
    with self._state_lock:
        loc_w = self.state.setdefault("watching_local", [])
        rem_w = self.state.setdefault("watching_removed", [])
        wl_list = self.state.setdefault("watchlist", [])
        rem_wl = self.state.setdefault("watchlist_removed", [])
        loc_n = self.state.setdefault("never_local", [])
        rem_n = self.state.setdefault("never_removed", [])
        if cur.get("watching"):
            if item_id in loc_w:
                loc_w.remove(item_id)
            if eff_kid and f"kin_{eff_kid}" in loc_w:
                loc_w.remove(f"kin_{eff_kid}")
            if item_id and item_id not in rem_w:
                rem_w.append(item_id)
            if eff_kid and f"kin_{eff_kid}" not in rem_w:
                rem_w.append(f"kin_{eff_kid}")
            for k_pop in {str(eff_rkey), str(eff_kid), str(item_id or "").strip()} - {""}:
                (self.state.get("remote_watching_items") or {}).pop(k_pop, None)
            if eff_kid and isinstance(self.state.get("remote_removals_pushed"), list):
                self.state["remote_removals_pushed"] = [
                    x for x in self.state["remote_removals_pushed"] if x != f"watching_remove:{eff_kid}"
                ]
            action_mode = "remove"
        else:
            if item_id and item_id not in loc_w:
                loc_w.append(item_id)
            if eff_kid and f"kin_{eff_kid}" not in loc_w:
                loc_w.append(f"kin_{eff_kid}")
            if item_id in rem_w:
                rem_w.remove(item_id)
            if item_id in wl_list:
                wl_list.remove(item_id)
            if was_in_watchlist and item_id and item_id not in rem_wl:
                rem_wl.append(item_id)
            if item_id in loc_n:
                loc_n.remove(item_id)
            if was_never and item_id and item_id not in rem_n:
                rem_n.append(item_id)
            if was_watched:
                self.state.setdefault("watched", {})[item_id] = {
                    "item_id": item_id,
                    "title": title,
                    "orig_title": orig_title,
                    "watched": False,
                }
            if eff_kid:
                k_pref = f"kin_{eff_kid}"
                if k_pref in rem_w:
                    rem_w.remove(k_pref)
                if k_pref in wl_list:
                    wl_list.remove(k_pref)
                if was_in_watchlist and k_pref not in rem_wl:
                    rem_wl.append(k_pref)
                if k_pref in loc_n:
                    loc_n.remove(k_pref)
                if was_never and k_pref not in rem_n:
                    rem_n.append(k_pref)
                if was_watched:
                    self.state.setdefault("watched", {})[k_pref] = {
                        "item_id": k_pref,
                        "title": title,
                        "orig_title": orig_title,
                        "watched": False,
                    }
            if eff_rkey:
                for k_pop in {str(eff_rkey), str(item_id or "").strip()} - {""}:
                    if k_pop != str(eff_rkey):
                        (self.state.get("remote_watching_items") or {}).pop(k_pop, None)
                    (self.state.get("remote_watchlist_items") or {}).pop(k_pop, None)
                    (self.state.get("remote_never_items") or {}).pop(k_pop, None)
                    (self.state.get("remote_watched_items") or {}).pop(k_pop, None)
                tpl = self._ensure_remote_entry_template(eff_kid or eff_rkey, title, orig_title, extra=kwargs)
                tpl["watching"] = True
                tpl["watched"] = False
                tpl["in_watchlist"] = False
                tpl["not_watching"] = False
                tpl["status"] = "now"
                self.state.setdefault("remote_watching_items", {})[str(eff_rkey)] = tpl
            action_mode = "add"
        self._build_lookup_indices()
        self._save_state()

    if action_mode == "remove":
        remote_ok = self._run_remote_sync_bg(
            self._sync_to_kinorium_remote,
            action="watching_remove",
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            resolved_kid=eff_kid or None,
        )
    else:
        enqueue_pid = self._profile_id

        def _bg_watching_add():
            eff_k = eff_kid or (
                self._resolve_kinorium_id(
                    item_id, title, orig_title, allow_network=True, media_type=mtype_arg, year=yr_arg
                )
                or ""
            )
            if self._profile_id != enqueue_pid:
                return
            if eff_k and str(eff_k).isdigit() and eff_rkey != str(eff_k):
                with self._state_lock:
                    if self._profile_id != enqueue_pid:
                        return
                    rwg_d = self.state.setdefault("remote_watching_items", {})
                    migrated = rwg_d.pop(str(eff_rkey), None)
                    if isinstance(migrated, dict):
                        migrated["kinorium_id"] = str(eff_k)
                        rwg_d.setdefault(str(eff_k), migrated)
                        self._build_lookup_indices()
            if was_in_watchlist:
                self._sync_to_kinorium_remote(
                    action="watchlist_remove",
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    resolved_kid=eff_k or None,
                )
            if was_watched:
                self._sync_to_kinorium_remote(
                    action="unwatched",
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    resolved_kid=eff_k or None,
                )
            if was_never:
                self._sync_to_kinorium_remote(
                    action="never_remove",
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    resolved_kid=eff_k or None,
                )
            self._sync_to_kinorium_remote(
                action="watching_add",
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_k or None,
            )

        remote_ok = self._run_remote_sync_bg(_bg_watching_add)
    status = self.get_item_status(item_id, title=title, orig_title=orig_title)
    status["remote_synced"] = remote_ok
    status["kinorium_counts"] = self.get_sections_counts()
    return status


def toggle_not_watching(self, item_id: str, title: str = "", orig_title: str = "", **kwargs) -> Dict[str, Any]:
    cur = self.get_item_status(item_id, title=title, orig_title=orig_title)
    was_watching = bool(cur.get("watching"))
    was_in_watchlist = bool(cur.get("in_watchlist"))
    was_watched = bool(cur.get("watched"))
    had_user_rating = cur.get("user_rating") is not None
    nr = _norm_title(title)
    yr_arg = int(kwargs["year"]) if str(kwargs.get("year") or "").isdigit() else None
    mtype_arg = str(kwargs.get("media_type") or "")
    kid = self._resolve_kinorium_id(
        item_id,
        title,
        orig_title,
        allow_network=False,
        media_type=mtype_arg,
        year=yr_arg,
    )
    eff_kid = str(kid) if (kid and str(kid).isdigit()) else ""
    eff_rkey = eff_kid or (str(item_id).strip() if str(item_id or "").strip() else f"local_{_norm_title(title or orig_title)}")
    with self._state_lock:
        loc_n = self.state.setdefault("never_local", [])
        rem_n = self.state.setdefault("never_removed", [])
        loc_w = self.state.setdefault("watching_local", [])
        rem_w = self.state.setdefault("watching_removed", [])
        wl_list = self.state.setdefault("watchlist", [])
        rem_wl = self.state.setdefault("watchlist_removed", [])
        if cur.get("not_watching"):
            if item_id in loc_n:
                loc_n.remove(item_id)
            if eff_kid and f"kin_{eff_kid}" in loc_n:
                loc_n.remove(f"kin_{eff_kid}")
            if item_id and item_id not in rem_n:
                rem_n.append(item_id)
            if eff_kid and f"kin_{eff_kid}" not in rem_n:
                rem_n.append(f"kin_{eff_kid}")
            for k_pop in {str(eff_rkey), str(eff_kid), str(item_id or "").strip()} - {""}:
                (self.state.get("remote_never_items") or {}).pop(k_pop, None)
            if eff_kid and isinstance(self.state.get("remote_removals_pushed"), list):
                self.state["remote_removals_pushed"] = [
                    x for x in self.state["remote_removals_pushed"] if x != f"never_remove:{eff_kid}"
                ]
            action_mode = "remove"
        else:
            if item_id and item_id not in loc_n:
                loc_n.append(item_id)
            if item_id in rem_n:
                rem_n.remove(item_id)
            if item_id in loc_w:
                loc_w.remove(item_id)
            if was_watching and item_id and item_id not in rem_w:
                rem_w.append(item_id)
            if item_id in wl_list:
                wl_list.remove(item_id)
            if was_in_watchlist and item_id and item_id not in rem_wl:
                rem_wl.append(item_id)
            self.state["continue_watching"] = [
                x
                for x in self.state.get("continue_watching", [])
                if x.get("id") != item_id
                and (not eff_kid or x.get("id") != f"kin_{eff_kid}")
                and (not nr or _norm_title(x.get("title", "")) != nr)
            ]
            if item_id in self.state.get("watched", {}):
                self.state["watched"][item_id] = {"item_id": item_id, "title": title, "watched": False}
            if item_id in self.state.get("ratings", {}):
                self.state["ratings"][item_id] = {"score": None, "comment": "", "cleared": True}
            if eff_kid:
                k_pref = f"kin_{eff_kid}"
                if k_pref in rem_n:
                    rem_n.remove(k_pref)
                if k_pref in loc_w:
                    loc_w.remove(k_pref)
                if was_watching and k_pref not in rem_w:
                    rem_w.append(k_pref)
                if k_pref in wl_list:
                    wl_list.remove(k_pref)
                if was_in_watchlist and k_pref not in rem_wl:
                    rem_wl.append(k_pref)
                self.state.setdefault("watched", {})[k_pref] = {"item_id": k_pref, "title": title, "watched": False}
                self.state.setdefault("ratings", {})[k_pref] = {"score": None, "comment": "", "cleared": True}
            if eff_rkey:
                for k_pop in {str(eff_rkey), str(item_id or "").strip()} - {""}:
                    if k_pop != str(eff_rkey):
                        (self.state.get("remote_never_items") or {}).pop(k_pop, None)
                    (self.state.get("remote_watched_items") or {}).pop(k_pop, None)
                    (self.state.get("remote_watching_items") or {}).pop(k_pop, None)
                    (self.state.get("remote_watchlist_items") or {}).pop(k_pop, None)
                tpl = self._ensure_remote_entry_template(eff_kid or eff_rkey, title, orig_title, extra=kwargs)
                tpl["not_watching"] = True
                tpl["watched"] = False
                tpl["watching"] = False
                tpl["in_watchlist"] = False
                tpl["score"] = None
                tpl["status"] = "never"
                self.state.setdefault("remote_never_items", {})[str(eff_rkey)] = tpl
            action_mode = "add"
        self._build_lookup_indices()
        self._save_state()

    if action_mode == "remove":
        remote_ok = self._run_remote_sync_bg(
            self._sync_to_kinorium_remote,
            action="never_remove",
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            resolved_kid=eff_kid or None,
        )
    else:
        enqueue_pid = self._profile_id

        def _bg_never_add():
            eff_k = eff_kid or (
                self._resolve_kinorium_id(
                    item_id, title, orig_title, allow_network=True, media_type=mtype_arg, year=yr_arg
                )
                or ""
            )
            if self._profile_id != enqueue_pid:
                return
            if eff_k and str(eff_k).isdigit() and eff_rkey != str(eff_k):
                with self._state_lock:
                    if self._profile_id != enqueue_pid:
                        return
                    rn_d = self.state.setdefault("remote_never_items", {})
                    migrated = rn_d.pop(str(eff_rkey), None)
                    if isinstance(migrated, dict):
                        migrated["kinorium_id"] = str(eff_k)
                        rn_d.setdefault(str(eff_k), migrated)
                        self._build_lookup_indices()
            if was_watching:
                self._sync_to_kinorium_remote(
                    action="watching_remove",
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    resolved_kid=eff_k or None,
                )
            if was_in_watchlist:
                self._sync_to_kinorium_remote(
                    action="watchlist_remove",
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    resolved_kid=eff_k or None,
                )
            if had_user_rating:
                self._sync_to_kinorium_remote(
                    action="rate_remove",
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    resolved_kid=eff_k or None,
                )
            if was_watched:
                self._sync_to_kinorium_remote(
                    action="unwatched",
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    resolved_kid=eff_k or None,
                )
            self._sync_to_kinorium_remote(
                action="never_add",
                item_id=item_id,
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_k or None,
            )

        remote_ok = self._run_remote_sync_bg(_bg_never_add)
    status = self.get_item_status(item_id, title=title, orig_title=orig_title)
    status["remote_synced"] = remote_ok
    status["kinorium_counts"] = self.get_sections_counts()
    return status


def configure_account(self, username: str, session_cookie: str, threshold: float = 0.95) -> Dict[str, Any]:
    raw_user = (username or "").strip()
    cookie_updated = False
    new_cookie_uid = ""
    with self._state_lock:
        if session_cookie is not None and session_cookie.strip():
            cleaned_cookie = self.sanitize_session_cookie(session_cookie)
            if cleaned_cookie:
                self.state.setdefault("account", {})["session_cookie"] = cleaned_cookie
                with self._cookie_lock:
                    self._kinorium_cookie_cache = ""
                with self._episodes_lock:
                    self._series_episodes_cache.clear()
                self._session_auth_verified = None
                cookie_updated = True
                new_cookie_uid = self.extract_cookie_user_id(cleaned_cookie)
        self.state.setdefault("account", {})["auto_scrobble_threshold"] = max(0.5, min(0.99, float(threshold)))

    start_pid_cfg = self._profile_id

    def _bg_two_way_reconcile() -> None:
        if self._profile_id != start_pid_cfg:
            return
        try:
            self.reconcile_local_statuses_to_remote()
        except Exception:
            pass
        if self._profile_id != start_pid_cfg:
            return
        try:
            self.reconcile_all_local_episodes()
        except Exception:
            pass

    if raw_user:
        new_path = self.extract_user_path(raw_user)
        cur_uid = str(self.state.get("account", {}).get("user_id") or "")
        if cookie_updated and new_cookie_uid and (not cur_uid or new_path == f"/user/{cur_uid}/") and new_cookie_uid != cur_uid:
            self.sync_user_profile(new_cookie_uid, session_cookie=self.state["account"].get("session_cookie"))
        elif not cur_uid or new_path != f"/user/{cur_uid}/":
            self.sync_user_profile(raw_user, session_cookie=session_cookie if cookie_updated else None)
        else:
            self._save_state()
            if cookie_updated:
                threading.Thread(target=_bg_two_way_reconcile, daemon=True).start()
    else:
        if cookie_updated and new_cookie_uid and new_cookie_uid != str(self.state.get("account", {}).get("user_id") or ""):
            self.sync_user_profile(new_cookie_uid, session_cookie=self.state["account"].get("session_cookie"))
        else:
            self._save_state()
            if cookie_updated:
                threading.Thread(target=_bg_two_way_reconcile, daemon=True).start()
    return self.state["account"]


def _promote_to_watching_with_status(
    self,
    item_id: str,
    title: str = "",
    orig_title: str = "",
    kid: Optional[str] = None,
    **extra,
) -> Tuple[bool, bool]:
    """
    Automatically promotes an unfinished movie or series to 'Смотрю' (`watching=True`, `isNow=1`)
    when the user reaches 10% playback progress, batch-marks, or rates episodes while the title
    is still in 'Буду смотреть' (`future`) or has no status yet.
    Returns `(promoted, remote_synced)`.
    """
    remote_ok = False
    cur = self.get_item_status(item_id, title=title, orig_title=orig_title)
    if cur.get("watching") or cur.get("watched") or cur.get("not_watching"):
        return False, False
    was_in_watchlist = bool(cur.get("in_watchlist"))
    mtype = str(extra.get("media_type") or "series")
    eff_kid = str(kid) if (kid and str(kid).isdigit()) else ""
    if not eff_kid:
        resolved = self._resolve_kinorium_id(
            item_id,
            title,
            orig_title,
            allow_network=True,
            media_type=mtype,
        )
        eff_kid = str(resolved) if (resolved and str(resolved).isdigit()) else ""

    with self._state_lock:
        loc_w = self.state.setdefault("watching_local", [])
        rem_w = self.state.setdefault("watching_removed", [])
        rem_wl = self.state.setdefault("watchlist_removed", [])
        if item_id and item_id not in loc_w:
            loc_w.append(item_id)
        if item_id in rem_w:
            rem_w.remove(item_id)
        if item_id in self.state["watchlist"]:
            self.state["watchlist"].remove(item_id)
        if was_in_watchlist and item_id and item_id not in rem_wl:
            rem_wl.append(item_id)

        if eff_kid:
            k_pref = f"kin_{eff_kid}"
            if k_pref not in loc_w:
                loc_w.append(k_pref)
            if k_pref in rem_w:
                rem_w.remove(k_pref)
            if was_in_watchlist and k_pref not in rem_wl:
                rem_wl.append(k_pref)
            (self.state.get("remote_watchlist_items") or {}).pop(eff_kid, None)
            extra_kw = dict(extra)
            extra_kw.setdefault("media_type", mtype)
            tpl = self._ensure_remote_entry_template(eff_kid, title, orig_title, extra=extra_kw)
            tpl["watching"] = True
            tpl["watched"] = False
            tpl["in_watchlist"] = False
            tpl["status"] = "now"
            self.state.setdefault("remote_watching_items", {})[eff_kid] = tpl

    self._build_lookup_indices()
    if eff_kid:
        if was_in_watchlist:
            self._sync_to_kinorium_remote(
                action="watchlist_remove",
                item_id=item_id or f"kin_{eff_kid}",
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_kid,
            )
        remote_ok = bool(
            self._sync_to_kinorium_remote(
                action="watching_add",
                item_id=item_id or f"kin_{eff_kid}",
                title=title,
                orig_title=orig_title,
                resolved_kid=eff_kid,
            )
        )
    return True, remote_ok


def _promote_to_watching_if_needed(
    self,
    item_id: str,
    title: str = "",
    orig_title: str = "",
    kid: Optional[str] = None,
    **extra,
) -> bool:
    promoted, _ = self._promote_to_watching_with_status(
        item_id=item_id,
        title=title,
        orig_title=orig_title,
        kid=kid,
        **extra,
    )
    return promoted


def _promote_series_to_watching_if_needed(
    self,
    item_id: str,
    title: str = "",
    orig_title: str = "",
    kid: Optional[str] = None,
    **extra,
) -> bool:
    extra_kw = dict(extra)
    extra_kw.setdefault("media_type", "series")
    return self._promote_to_watching_if_needed(
        item_id=item_id,
        title=title,
        orig_title=orig_title,
        kid=kid,
        **extra_kw,
    )
