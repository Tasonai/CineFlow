import atexit
import calendar
from concurrent.futures import ThreadPoolExecutor
import copy
import datetime
import functools
import gzip
import html
import http.cookiejar
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import zlib
from typing import Any, Dict, List, Optional, Tuple

from .doh import DoHSplitNetworkClient
from .kinorium_persons import (
    parse_search_persons_and_movies,
    parse_person_filmography_html,
)
from .en_metadata import RU_COUNTRIES_TO_EN, RU_GENRES_TO_EN
from .regions import get_country_profile
from .storage_db import get_storage_db, profile_id_from_state_path, set_private_file_permissions
from .kinorium_parsers import (
    _EN_MONTHS_TO_NUM,
    _RU_COUNTRIES_SORTED,
    _RU_MONTHS_TO_NUM,
    _extract_balanced_block_html,
    _extract_cookie_display_name,
    _extract_profile_avatar_url,
    _extract_profile_display_name,
    _is_placeholder_display_name,
    _norm_title,
    _parse_episode_air_date_iso,
    _parse_following_html,
    _safe_year_int,
    _sanitize_kinorium_genres,
    _title_variants,
    _title_variants_tuple,
    extract_critics_pct,
    extract_friends_tooltip_ratings,
    extract_movie_description_html,
    extract_similar_items_html,
    parse_movie_list_html,
    parse_premieres_list_html,
    parse_series_episodes_html,
)
from .kinorium_http import (
    _MAX_KINORIUM_RESP_BYTES,
    _decompress_gzip_bounded,
    _read_resp_bounded,
    ensure_kinorium_cookies,
    extract_cookie_user_id,
    extract_user_path,
    fetch_kinorium_html,
    get_active_sync_cookie,
    is_ip_cooldown_active,
    kinorium_candidate_domains,
    kinorium_http_request,
    sanitize_session_cookie,
    solve_kinorium_js_challenge,
)
from .kinorium_sync import (
    _is_episode_cached_remote_done,
    _merge_remote_episodes_into_local,
    _post_episode_status_remote,
    _sync_episodes_map_to_kinorium_remote,
    _sync_to_kinorium_remote,
    fetch_series_episodes_state,
    reconcile_all_local_episodes,
    reconcile_local_statuses_to_remote,
    reconcile_series_episodes,
)
from .kinorium_mutations import (
    _ensure_remote_entry_template,
    _promote_series_to_watching_if_needed,
    _promote_to_watching_if_needed,
    _promote_to_watching_with_status,
    _record_episode_watched,
    _run_remote_sync_bg,
    _unrecord_episode_watched,
    configure_account,
    dismiss_continue_watching,
    get_profile_stats,
    mark_episodes_batch,
    mark_watched,
    restore_continue_watching,
    set_episode_rating,
    set_rating,
    toggle_episode_watched,
    toggle_not_watching,
    toggle_watching,
    toggle_watchlist,
)
from .kinorium_profile import (
    _StatusListResult,
    _count_dismissed_cw_items_locked,
    _get_cached_similar_for_kid,
    _maybe_trigger_bg_premieres_refresh,
    _refresh_online_premieres_sync,
    _resolve_friend_user_by_name_ajax,
    _store_similar_for_kid,
    _verify_recent_watchlist_online_availability,
    apply_country_localization,
    disconnect_user_profile,
    export_backup_state,
    fetch_movie_page_extras,
    fetch_online_premieres,
    fetch_status_list_ajax,
    get_account_summary,
    get_integrations,
    get_online_premieres_count,
    get_similar_catalog_items,
    import_backup_state,
    is_service_enabled,
    set_service_login,
    set_services_enabled_bulk,
    sync_user_profile,
)


class KinoriumService:
    """
    Live Kinorium Integration for Velarium:
    - Connects to real Kinorium user profiles (e.g., https://en.kinorium.com/user/51670/ -> Andrei Crustillio).
    - Automatically solves Kinorium's anti-bot JS challenge to fetch:
      1. All watched & rated movies/series of the user (/user/{id}/ratings/).
      2. The user's 'Буду смотреть' watchlist (/user/{id}/watchlist/).
      3. The user's real friends (/user/{id}/following/) and their real ratings!
    - Provides 85% automatic scrobbling and 1-10 post-watch rating sync.
    """

    JSC_PATH = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
    UA = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    )

    DEFAULT_INTEGRATIONS = {
        "kinorium": {
            "id": "kinorium",
            "name": "Kinorium",
            "enabled": True,
            "requires_login": True,
            "logged_in": False,
            "status_label": "Не подключен",
            "login_url": "https://kinorium.com/",
        },
        "hdrezka": {
            "id": "hdrezka",
            "name": "HDRezka",
            "enabled": True,
            "requires_login": False,
            "logged_in": True,
            "status_label": "Активно без регистрации (Обход ограничений + 1080p)",
            "login_url": "https://hdrezka-home.tv",
        },
        "backup4k": {
            "id": "backup4k",
            "name": "4K Remux",
            "enabled": True,
            "requires_login": False,
            "logged_in": True,
            "status_label": "Прямой 4K UHD HDR поток и TorrServer",
            "login_url": "http://127.0.0.1:8090",
        },
        "stremio": {
            "id": "stremio",
            "name": "Stremio",
            "enabled": True,
            "requires_login": False,
            "logged_in": True,
            "status_label": "Встроенные аддоны Torrentio + OpenSubtitles",
            "login_url": "https://web.stremio.com/",
        },
        "appletv": {
            "id": "appletv",
            "name": "Apple TV+",
            "enabled": True,
            "requires_login": True,
            "logged_in": False,
            "status_label": "Не выполнен вход",
            "login_url": "https://tv.apple.com/pl",
        },
        "netflix": {
            "id": "netflix",
            "name": "Netflix",
            "enabled": True,
            "requires_login": True,
            "logged_in": False,
            "status_label": "Не выполнен вход",
            "login_url": "https://www.netflix.com/pl/login",
        },
        "prime": {
            "id": "prime",
            "name": "Prime Video",
            "enabled": True,
            "requires_login": True,
            "logged_in": False,
            "status_label": "Не выполнен вход",
            "login_url": "https://www.primevideo.com/",
        },
        "disney": {
            "id": "disney",
            "name": "Disney+",
            "enabled": True,
            "requires_login": True,
            "logged_in": False,
            "status_label": "Не выполнен вход",
            "login_url": "https://www.disneyplus.com/pl-pl/login",
        },
        "max": {
            "id": "max",
            "name": "Max (HBO)",
            "enabled": True,
            "requires_login": True,
            "logged_in": False,
            "status_label": "Не выполнен вход",
            "login_url": "https://play.max.com/",
        },
        "playerpl": {
            "id": "playerpl",
            "name": "Player.pl",
            "enabled": True,
            "requires_login": True,
            "logged_in": False,
            "status_label": "Не выполнен вход",
            "login_url": "https://player.pl/",
        },
    }

    def __init__(
        self,
        net_client: DoHSplitNetworkClient,
        storage_dir: str,
        *,
        register_atexit: bool = True,
        start_background_workers: bool = True,
    ):
        self.net = net_client
        self.storage_dir = storage_dir
        os.makedirs(self.storage_dir, exist_ok=True)
        self.state_file = os.path.join(self.storage_dir, "kinorium_state.json")
        self.premieres_cache_file = os.path.join(self.storage_dir, "online_premieres_cache.json")
        self.similar_cache_file = os.path.join(self.storage_dir, "kinorium_similar_cache.json")
        self._state_lock = threading.RLock()
        self._save_io_lock = threading.Lock()
        self._healed_series_keys: set = set()
        self._cookie_lock = threading.Lock()
        self._cookie_refresh_lock = threading.Lock()
        self._episodes_lock = threading.Lock()
        self._similar_lock = threading.Lock()
        self._person_lock = threading.Lock()
        self._series_episodes_cache: Dict[str, Dict[str, Any]] = {}
        self._similar_by_kid: Dict[str, Dict[str, Any]] = {}
        self._person_search_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._person_filmog_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._session_auth_verified: Optional[bool] = None
        self._kinorium_cookie_cache: str = ""
        self._kinorium_anon_cookie_cache: str = ""
        self._sync_cookie_tl = threading.local()
        self._prefer_en_domain_until: float = 0.0
        self._rate_limit_lock = threading.Lock()
        self._last_http_req_ts: float = 0.0
        self._ip_blocked_until: float = 0.0
        self._ip_blocked_proxy_sig: str = ""
        self._state_version: int = 1
        self._integrations_cache: Optional[Dict[str, Any]] = None
        self._sections_counts_cache: Optional[Tuple[Tuple[int, int, int], Dict[str, int]]] = None
        self._save_dirty: bool = False
        self._save_timer: Optional[threading.Timer] = None
        self._online_premieres_mem: List[Dict[str, Any]] = []
        self._online_premieres_ts: float = 0.0
        self._online_premieres_last_attempt_ts: float = 0.0
        self._online_premieres_refreshing: bool = False
        self._db = get_storage_db(self.storage_dir)
        self._profile_id: str = profile_id_from_state_path(self.storage_dir, self.state_file)
        self._section_hashes: Dict[str, str] = {}
        self._preload_premieres_disk_cache()
        self._preload_similar_disk_cache()
        self.had_persisted_state: bool = self._db.has_profile_state(self._profile_id) or os.path.exists(self.state_file)
        self.state = self._load_state()
        self._build_lookup_indices()
        self._background_workers_enabled = bool(start_background_workers)
        if register_atexit:
            atexit.register(self._flush_state_on_exit)

    def _preload_similar_disk_cache(self) -> None:
        try:
            db_map = self._db.load_cache_dict("kinorium_similar", max_entries=800)
            if db_map:
                with self._similar_lock:
                    self._similar_by_kid = {
                        str(k): v
                        for k, v in db_map.items()
                        if str(k).isdigit() and isinstance(v, dict) and isinstance(v.get("items"), list)
                    }
                return
        except Exception:
            pass
        if not os.path.isfile(self.similar_cache_file):
            return
        try:
            with open(self.similar_cache_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                cleaned = {
                    str(k): v
                    for k, v in data.items()
                    if str(k).isdigit() and isinstance(v, dict) and isinstance(v.get("items"), list)
                }
                with self._similar_lock:
                    self._similar_by_kid = cleaned
                if cleaned:
                    self._db.save_cache_dict("kinorium_similar", cleaned, max_entries=800)
        except Exception:
            pass

    def _save_similar_disk_cache(self) -> None:
        try:
            with self._similar_lock:
                if len(self._similar_by_kid) > 800:
                    sorted_keys = sorted(
                        self._similar_by_kid.keys(),
                        key=lambda k: float((self._similar_by_kid.get(k) or {}).get("updated_at") or 0.0),
                        reverse=True,
                    )[:650]
                    self._similar_by_kid = {k: self._similar_by_kid[k] for k in sorted_keys}
                snapshot = dict(self._similar_by_kid)
            self._db.save_cache_dict("kinorium_similar", snapshot, max_entries=800)
        except Exception:
            pass

    def _preload_premieres_disk_cache(self) -> None:
        try:
            cached_payload = self._db.get_kv("cache", "online_premieres")
            if isinstance(cached_payload, dict):
                cached_items = cached_payload.get("items")
                cached_ts = float(cached_payload.get("updated_at") or 0.0)
                if isinstance(cached_items, list) and len(cached_items) >= 20:
                    self._online_premieres_mem = cached_items
                    self._online_premieres_ts = cached_ts
                    return
        except Exception:
            pass
        if not os.path.isfile(self.premieres_cache_file):
            return
        try:
            with open(self.premieres_cache_file, "r", encoding="utf-8") as f:
                cached_payload = json.load(f)
            cached_items = cached_payload.get("items") if isinstance(cached_payload, dict) else None
            cached_ts = float(cached_payload.get("updated_at") or 0.0) if isinstance(cached_payload, dict) else 0.0
            if isinstance(cached_items, list) and len(cached_items) >= 20:
                self._online_premieres_mem = cached_items
                self._online_premieres_ts = cached_ts
                self._db.set_kv("cache", "online_premieres", {"updated_at": cached_ts, "items": cached_items})
        except Exception:
            pass

    @staticmethod
    def _sanitize_series_live_meta_dict(state_dict: Dict[str, Any]) -> bool:
        """
        Purges poisoned or malformed `series_live_meta` entries (wrong movies, homonym hijacks,
        placeholder 'Фильм' titles, malformed `kin_tt...` keys, or overwritten numeric IDs).
        """
        live_meta = state_dict.get("series_live_meta")
        if not isinstance(live_meta, dict) or not live_meta:
            return False

        remote_by_kid: Dict[str, Dict[str, Any]] = {}
        for sec in ("remote_never_items", "remote_watchlist_items", "remote_watched_items", "remote_watching_items"):
            sec_d = state_dict.get(sec)
            if isinstance(sec_d, dict):
                for rk, rv in sec_d.items():
                    if isinstance(rv, dict):
                        remote_by_kid[str(rk)] = rv

        healed = False
        for k in list(live_meta.keys()):
            entry = live_meta.get(k)
            if not isinstance(entry, dict):
                live_meta.pop(k, None)
                healed = True
                continue
            sk = str(k)
            # Remove malformed kin_tt... keys
            if sk.startswith("kin_") and not sk[4:].isdigit():
                live_meta.pop(k, None)
                healed = True
                continue

            t_raw = str(entry.get("title") or "").strip()
            o_raw = str(entry.get("orig_title") or "").strip()
            r_url = str(entry.get("rezka_url") or "").strip()
            r_id = str(entry.get("rezka_id") or "").strip()
            kid = str(entry.get("kinorium_id") or (sk[4:] if sk.startswith("kin_") else "")).strip()

            # Remove placeholder garbage titles ('Фильм', 'Сериал')
            if t_raw.lower() in ("фильм", "сериал", "movie", "series"):
                live_meta.pop(k, None)
                healed = True
                continue

            # Repair overwritten bare numeric catalog IDs
            cur_id = str(entry.get("id") or "").strip()
            if cur_id.isdigit() and kid.isdigit():
                entry["id"] = f"kin_{kid}"
                healed = True

            # Reject movie pages stored inside series_live_meta
            if "/films/" in r_url.lower():
                live_meta.pop(k, None)
                healed = True
                continue

            # Cross-verify against authoritative Kinorium remote item if available
            rem = remote_by_kid.get(kid) if kid else None
            if rem:
                rem_ru = _norm_title(rem.get("ru_title") or "")
                rem_orig = _norm_title(rem.get("orig_title") or "")
                ent_ru = _norm_title(t_raw)
                ent_orig = _norm_title(o_raw)
                if rem_orig and ent_orig and rem_orig != ent_orig:
                    live_meta.pop(k, None)
                    healed = True
                    continue
                if rem_ru and ent_ru and rem_ru != ent_ru and not (rem_orig and rem_orig == ent_orig):
                    live_meta.pop(k, None)
                    healed = True
                    continue
                if not t_raw and rem.get("ru_title"):
                    entry["title"] = str(rem["ru_title"]).strip()
                    ent_ru = _norm_title(entry["title"])
                    healed = True
                if not o_raw and rem.get("orig_title"):
                    entry["orig_title"] = str(rem["orig_title"]).strip()
                    ent_orig = _norm_title(entry["orig_title"])
                    healed = True
                if not entry.get("year") and rem.get("year"):
                    yr_rem = _safe_year_int(rem.get("year"))
                    if yr_rem:
                        entry["year"] = yr_rem
                        healed = True

            # Detect homonym slug hijacks (e.g. 'Shrinking' / 'Терапия' -> 'terapiya-sebastyana-fitceka', 'Carrie' -> 'kerri-i-superkola')
            eff_orig = str(entry.get("orig_title") or "").strip()
            eff_ru = str(entry.get("title") or "").strip()
            if r_url and (eff_orig or eff_ru):
                m_slug = re.search(r"/\d+-([a-z0-9-]+?)(?:-\d{4})?(?:-latest)?\.html", r_url.lower())
                if m_slug:
                    slug_words = [w for w in m_slug.group(1).split("-") if w]
                    ru_words = [w for w in _norm_title(eff_ru).split() if w]
                    orig_ascii = re.sub(r"[^a-z0-9\s]", " ", eff_orig.lower()).split()
                    max_expected_words = max(len(ru_words), len(orig_ascii), 1)
                    orig_in_slug = bool(orig_ascii) and all(ow in slug_words for ow in orig_ascii if len(ow) >= 3)
                    if len(slug_words) >= max_expected_words + 2 and not orig_in_slug:
                        live_meta.pop(k, None)
                        healed = True
                        continue
            # Also reject non-series cartoons without seasons_map if marked single episode
            smap = entry.get("seasons_map")
            if "/cartoons/" in r_url.lower() and not smap and r_id:
                live_meta.pop(k, None)
                healed = True
                continue
        return healed

    def _load_state(self) -> Dict[str, Any]:
        default_state: Dict[str, Any] = {
            "account": {
                "connected": False,
                "user_id": "",
                "profile_url": "https://kinorium.com/",
                "username": "",
                "display_name": "Не подключен",
                "session_cookie": "",
                "auto_scrobble_threshold": 0.95,
                "watched_count": 0,
                "friends_count": 0,
                "last_synced": "",
            },
            "integrations": json.loads(json.dumps(self.DEFAULT_INTEGRATIONS)),
            "watched": {},
            "ratings": {},
            "watchlist": [],
            "watching_local": [],
            "never_local": [],
            "remote_watched_items": {},
            "remote_watching_items": {},
            "remote_watchlist_items": {},
            "remote_never_items": {},
            "friends": [],
            "friends_ratings_by_kid": {},
            "continue_watching": [],
            "watched_episodes": {},
            "unwatched_episodes": {},
            "episode_ratings": {},
            "cleared_episode_ratings": {},
            "cw_dismissed": [],
            "cw_dismissed_entries": {},
            "series_live_meta": {},
            "descriptions_by_kid": {},
        }
        loaded: Optional[Dict[str, Any]] = None
        imported_from_json = False
        try:
            loaded = self._db.load_profile_state(self._profile_id)
        except Exception:
            loaded = None

        if loaded is None and os.path.exists(self.state_file):
            try:
                with open(self.state_file, "r", encoding="utf-8") as f:
                    raw_json = json.load(f)
                if isinstance(raw_json, dict):
                    loaded = raw_json
                    imported_from_json = True
            except Exception:
                loaded = None

        if isinstance(loaded, dict):
            for k, v in loaded.items():
                if k == "integrations" and isinstance(v, dict):
                    merged_int = json.loads(json.dumps(self.DEFAULT_INTEGRATIONS))
                    for ik, iv in v.items():
                        if ik in merged_int and isinstance(iv, dict):
                            merged_int[ik].update(iv)
                            if "enabled" not in merged_int[ik]:
                                merged_int[ik]["enabled"] = True
                    default_state["integrations"] = merged_int
                elif k == "account" and isinstance(v, dict):
                    default_state["account"].update(v)
                    raw_dn = str(default_state["account"].get("display_name") or "").strip()
                    uid_val = str(default_state["account"].get("user_id") or "").strip()
                    if _is_placeholder_display_name(raw_dn, uid_val):
                        if uid_val == "51670" and default_state["account"].get("connected"):
                            default_state["account"]["display_name"] = "Andrei Crustillio"
                        elif default_state["account"].get("connected"):
                            default_state["account"]["display_name"] = ""
                        else:
                            default_state["account"]["display_name"] = "Не подключен"
                    if default_state["account"].get("auto_scrobble_threshold") == 0.85:
                        default_state["account"]["auto_scrobble_threshold"] = 0.95
                    if default_state["account"].get("session_cookie"):
                        default_state["account"]["session_cookie"] = self.sanitize_session_cookie(
                            str(default_state["account"]["session_cookie"])
                        )
                    if (
                        "integrations" not in loaded
                        and default_state["account"].get("connected")
                        and default_state["account"].get("user_id")
                    ):
                        default_state["integrations"]["kinorium"]["logged_in"] = True
                        uid_loaded = default_state["account"]["user_id"]
                        default_state["integrations"]["kinorium"]["login_url"] = (
                            f"https://en.kinorium.com/user/{uid_loaded}/"
                        )
                else:
                    default_state[k] = v

        # Clean up any malformed 'kin_tt...' keys from earlier non-numeric ID fallbacks
        for dict_key in ("watched_episodes", "unwatched_episodes", "episode_ratings", "cleared_episode_ratings", "watched", "ratings"):
            sub_d = default_state.get(dict_key)
            if isinstance(sub_d, dict):
                bad_keys = [k for k in list(sub_d.keys()) if str(k).startswith("kin_") and not str(k)[4:].isdigit()]
                for bk in bad_keys:
                    raw_val = sub_d.pop(bk, None)
                    orig_id = str(bk)[4:]
                    if orig_id and orig_id not in sub_d and raw_val is not None:
                        sub_d[orig_id] = raw_val
        # Strip any country names accidentally parsed into genres in persisted Kinorium lists
        for r_key in (
            "remote_watched_items",
            "remote_watching_items",
            "remote_watchlist_items",
            "remote_never_items",
            "watched",
        ):
            r_dict = default_state.get(r_key)
            if isinstance(r_dict, dict):
                for entry in r_dict.values():
                    if isinstance(entry, dict) and isinstance(entry.get("genres"), list):
                        entry["genres"] = _sanitize_kinorium_genres(
                            entry["genres"], str(entry.get("media_type") or "movie")
                        )

        healed_live = self._sanitize_series_live_meta_dict(default_state)
        healed_conflicts = self._sanitize_never_vs_watched_conflicts(default_state)
        saved_to_db = False
        if imported_from_json or ((healed_live or healed_conflicts) and self.had_persisted_state):
            try:
                self._section_hashes = self._db.save_profile_state(self._profile_id, default_state, {})
                saved_to_db = True
            except Exception:
                pass
        live_cookie = str((default_state.get("account") or {}).get("session_cookie") or "").strip()
        if live_cookie and (saved_to_db or (loaded is not None and self._db.has_profile_state(self._profile_id))):
            # The encrypted SQLite store is authoritative: scrub plaintext secrets from the legacy JSON
            self._scrub_legacy_json_secrets(self.state_file)
        return default_state

    @staticmethod
    def _scrub_legacy_json_secrets(json_path: str) -> None:
        if not json_path or not os.path.isfile(json_path):
            return
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                legacy = json.load(f)
            acc = legacy.get("account") if isinstance(legacy, dict) else None
            if not isinstance(acc, dict):
                set_private_file_permissions(json_path, is_dir=False)
                return
            secret_keys = [k for k in ("session_cookie", "auth_token") if str(acc.get(k) or "").strip()]
            if secret_keys:
                for k in secret_keys:
                    acc[k] = ""
                tmp_path = f"{json_path}.scrub.tmp.{os.getpid()}.{threading.get_ident()}"
                try:
                    with open(tmp_path, "w", encoding="utf-8") as f:
                        json.dump(legacy, f, ensure_ascii=False)
                    os.replace(tmp_path, json_path)
                except Exception:
                    try:
                        if os.path.exists(tmp_path):
                            os.unlink(tmp_path)
                    except Exception:
                        pass
                    raise
            set_private_file_permissions(json_path, is_dir=False)
        except Exception:
            pass

    @staticmethod
    def _sanitize_never_vs_watched_conflicts(state_dict: Dict[str, Any]) -> bool:
        """
        Ensures any title that is watched (`watched=True` / in `remote_watched_items`) or rated (`score > 0`)
        never remains in 'Не буду смотреть' (`remote_never_items` / `never_local`), moving rated items in
        `remote_never_items` into `remote_watched_items`.
        """
        if not isinstance(state_dict, dict):
            return False
        changed = False
        rem_watched = state_dict.setdefault("remote_watched_items", {})
        rem_watching = state_dict.setdefault("remote_watching_items", {})
        rem_never = state_dict.setdefault("remote_never_items", {})
        loc_watched = state_dict.get("watched") or {}
        loc_ratings = state_dict.get("ratings") or {}
        loc_never = state_dict.setdefault("never_local", [])
        rem_never_removed = state_dict.setdefault("never_removed", [])

        for kid in list(rem_never.keys()):
            n_entry = rem_never.get(kid)
            if not isinstance(n_entry, dict):
                continue
            k_str = str(kid)
            k_pref = f"kin_{k_str}"
            lw = loc_watched.get(k_pref) or loc_watched.get(k_str)
            lr = loc_ratings.get(k_pref) or loc_ratings.get(k_str)
            has_local_watched = bool(isinstance(lw, dict) and lw.get("watched"))
            has_local_score = bool(
                isinstance(lr, dict)
                and not lr.get("cleared")
                and str(lr.get("score") or "").isdigit()
                and int(lr.get("score") or 0) > 0
            )
            entry_score = n_entry.get("score")
            has_entry_score = bool(str(entry_score or "").isdigit() and int(entry_score or 0) > 0)
            in_watched = k_str in rem_watched
            in_watching = k_str in rem_watching
            if in_watched or in_watching or has_local_watched or has_local_score or has_entry_score or bool(n_entry.get("watched")):
                popped = rem_never.pop(kid, None)
                changed = True
                if not in_watching:
                    w_existing = rem_watched.get(k_str)
                    if isinstance(w_existing, dict):
                        if not w_existing.get("score") and has_entry_score:
                            w_existing["score"] = int(entry_score)
                        w_existing["watched"] = True
                        w_existing["not_watching"] = False
                        w_existing["status"] = "done"
                    elif isinstance(popped, dict):
                        popped_copy = dict(popped)
                        popped_copy["watched"] = True
                        popped_copy["not_watching"] = False
                        popped_copy["status"] = "done"
                        if has_local_score and not popped_copy.get("score"):
                            popped_copy["score"] = int(lr["score"])
                        rem_watched[k_str] = popped_copy
                for cand_id in (k_str, k_pref):
                    if cand_id in loc_never:
                        loc_never.remove(cand_id)
                    if cand_id not in rem_never_removed:
                        rem_never_removed.append(cand_id)

        # Mutually exclusive lists: items in remote_watched_items must not linger in remote_watching_items
        for kid in list(rem_watched.keys()):
            k_str = str(kid)
            if k_str in rem_watching:
                rem_watching.pop(k_str, None)
                changed = True

        if isinstance(loc_never, list) and loc_never:
            for item_key in list(loc_never):
                s_key = str(item_key)
                kid_part = s_key[4:] if (s_key.startswith("kin_") and s_key[4:].isdigit()) else (s_key if s_key.isdigit() else "")
                lw = loc_watched.get(s_key) or (loc_watched.get(f"kin_{kid_part}") if kid_part else None)
                lr = loc_ratings.get(s_key) or (loc_ratings.get(f"kin_{kid_part}") if kid_part else None)
                is_w = bool((isinstance(lw, dict) and lw.get("watched")) or (kid_part and kid_part in rem_watched))
                is_r = bool(
                    isinstance(lr, dict)
                    and not lr.get("cleared")
                    and str(lr.get("score") or "").isdigit()
                    and int(lr.get("score") or 0) > 0
                )
                if is_w or is_r:
                    loc_never.remove(item_key)
                    if s_key not in rem_never_removed:
                        rem_never_removed.append(s_key)
                    changed = True

        if isinstance(state_dict.get("account"), dict):
            state_dict["account"]["watched_count"] = len(rem_watched)
            state_dict["account"]["never_count"] = len(rem_never)
        return changed

    def _prepare_state_snapshot_locked(self) -> Tuple[str, Dict[str, Any], Dict[str, str], int]:
        desc_map = self.state.get("descriptions_by_kid")
        if isinstance(desc_map, dict) and len(desc_map) > 2000:
            keep_keys = list(desc_map.keys())[-2000:]
            self.state["descriptions_by_kid"] = {k: desc_map[k] for k in keep_keys}
        crit_map = self.state.get("critics_by_kid")
        if isinstance(crit_map, dict) and len(crit_map) > 4000:
            keep_ck = list(crit_map.keys())[-4000:]
            self.state["critics_by_kid"] = {k: crit_map[k] for k in keep_ck}
        scrobbles_list = self.state.get("scrobbles")
        if isinstance(scrobbles_list, list) and len(scrobbles_list) > 2000:
            self.state["scrobbles"] = scrobbles_list[-2000:]
        reconcile_ts_map = getattr(self, "_live_ep_reconcile_ts", None)
        if isinstance(reconcile_ts_map, dict) and len(reconcile_ts_map) > 256:
            keep_rk = list(reconcile_ts_map.keys())[-256:]
            self._live_ep_reconcile_ts = {k: reconcile_ts_map[k] for k in keep_rk}

        def _clone_val(val: Any) -> Any:
            if isinstance(val, dict):
                return {str(dk): _clone_val(dv) for dk, dv in list(val.items())}
            if isinstance(val, list):
                return [_clone_val(iv) for iv in list(val)]
            return val

        state_snapshot = {str(k): _clone_val(v) for k, v in list(self.state.items())}
        self._save_dirty = False
        self._save_seq = int(getattr(self, "_save_seq", 0)) + 1
        return self._profile_id, state_snapshot, dict(self._section_hashes), self._save_seq

    def _persist_state_snapshot(
        self,
        profile_id: str,
        state_snapshot: Dict[str, Any],
        prev_hashes: Dict[str, str],
        save_seq: int = 0,
    ) -> None:
        try:
            with self._save_io_lock:
                if save_seq and save_seq < int(getattr(self, "_last_persisted_seq", 0)) and getattr(self, "_last_persisted_pid", "") == profile_id:
                    return
                next_hashes = self._db.save_profile_state(
                    profile_id,
                    state_snapshot,
                    prev_hashes,
                )
                if save_seq:
                    self._last_persisted_seq = save_seq
                    self._last_persisted_pid = profile_id
            with self._state_lock:
                if self._profile_id == profile_id:
                    self._section_hashes = next_hashes
        except Exception:
            with self._state_lock:
                self._save_dirty = True
                if self._save_timer is None:
                    t = threading.Timer(3.0, self._flush_dirty_state)
                    t.daemon = True
                    self._save_timer = t
                    t.start()

    def _write_state_file_locked(self) -> None:
        try:
            pid, state_snapshot, prev_hashes, save_seq = self._prepare_state_snapshot_locked()
            with self._save_io_lock:
                self._section_hashes = self._db.save_profile_state(
                    pid,
                    state_snapshot,
                    prev_hashes,
                )
                self._last_persisted_seq = save_seq
                self._last_persisted_pid = pid
        except Exception:
            # e.g. "dictionary changed size during iteration" while another thread mutates state:
            # keep the change dirty and retry shortly instead of silently losing it.
            self._save_dirty = True
            if self._save_timer is None:
                t = threading.Timer(3.0, self._flush_dirty_state)
                t.daemon = True
                self._save_timer = t
                t.start()

    def _flush_dirty_state(self) -> None:
        snap_tuple = None
        with self._state_lock:
            self._save_timer = None
            if self._save_dirty:
                try:
                    snap_tuple = self._prepare_state_snapshot_locked()
                except Exception:
                    self._save_dirty = True
        if snap_tuple is not None:
            self._persist_state_snapshot(*snap_tuple)

    def _flush_state_on_exit(self) -> None:
        with self._state_lock:
            if self._save_timer is not None:
                self._save_timer.cancel()
                self._save_timer = None
            if self._save_dirty:
                self._write_state_file_locked()

    def _save_state(self, immediate: bool = True, bump_version: bool = True):
        snap_tuple = None
        with self._state_lock:
            self._integrations_cache = None
            self._cached_account_summary = None
            self._local_status_idx_key = None
            if bump_version:
                self._state_version += 1
            if immediate:
                if self._save_timer is not None:
                    self._save_timer.cancel()
                    self._save_timer = None
                try:
                    snap_tuple = self._prepare_state_snapshot_locked()
                except Exception:
                    self._save_dirty = True
            else:
                self._save_dirty = True
                if self._save_timer is None:
                    t = threading.Timer(25.0, self._flush_dirty_state)
                    t.daemon = True
                    self._save_timer = t
                    t.start()
        if snap_tuple is not None:
            self._persist_state_snapshot(*snap_tuple)

    def _build_lookup_indices(self):
        """
        Builds fast in-memory lookup maps by normalized Russian title, normalized original title,
        and Kinorium ID across all 4 Kinorium status sections:
        - `remote_watched_items` (Просмотрено / done)
        - `remote_watching_items` (Смотрю / now)
        - `remote_watchlist_items` (Буду смотреть / future)
        - `remote_never_items` (Не буду смотреть / never)
        """
        by_ru: Dict[str, Dict[str, Any]] = {}
        by_orig: Dict[str, Dict[str, Any]] = {}
        by_kid: Dict[str, Dict[str, Any]] = {}
        watching_by_ru: set = set()
        watching_by_orig: set = set()
        watchlist_by_ru: set = set()
        watchlist_by_orig: set = set()
        never_by_ru: set = set()
        never_by_orig: set = set()
        friend_kid_by_ru: Dict[str, str] = {}
        friend_kid_by_orig: Dict[str, str] = {}
        live_meta_by_id: Dict[str, Dict[str, Any]] = {}
        live_meta_by_ru: Dict[str, Dict[str, Any]] = {}
        live_meta_by_orig: Dict[str, Dict[str, Any]] = {}

        with self._state_lock:
            live_meta_snap = list((self.state.get("series_live_meta") or {}).items())
            watched_map = dict(self.state.get("remote_watched_items") or {})
            watching_map = dict(self.state.get("remote_watching_items") or {})
            watchlist_map = dict(self.state.get("remote_watchlist_items") or {})
            never_map = dict(self.state.get("remote_never_items") or {})
            friend_known_snap = list((self.state.get("friend_known_titles") or {}).items())
            for kid, w_item in list(watching_map.items()):
                if (
                    isinstance(w_item, dict)
                    and not w_item.get("score")
                    and kid in watched_map
                    and isinstance(watched_map[kid], dict)
                    and watched_map[kid].get("score")
                ):
                    w_item["score"] = watched_map[kid]["score"]

        for m_key, m_val in live_meta_snap:
            if not isinstance(m_val, dict):
                continue
            live_meta_by_id[str(m_key)] = m_val
            raw_mid = str(m_val.get("id") or "")
            if raw_mid and not raw_mid.isdigit():
                live_meta_by_id[raw_mid] = m_val
            if m_val.get("kinorium_id"):
                live_meta_by_id[str(m_val["kinorium_id"])] = m_val
                live_meta_by_id[f"kin_{m_val['kinorium_id']}"] = m_val
            m_nr = _norm_title(m_val.get("title", ""))
            m_no = _norm_title(m_val.get("orig_title", ""))
            if m_nr and m_nr not in ("фильм", "сериал"):
                live_meta_by_ru[m_nr] = m_val
            if m_no and m_no not in ("фильм", "сериал"):
                live_meta_by_orig[m_no] = m_val

        for section_map in (
            never_map,
            watchlist_map,
            watching_map,
            watched_map,
        ):
            for kid, item in list(section_map.items()):
                if not isinstance(item, dict):
                    continue
                by_kid[str(kid)] = item
                nr = _norm_title(item.get("ru_title", ""))
                no = _norm_title(item.get("orig_title", ""))
                if nr:
                    by_ru[nr] = item
                if no:
                    by_orig[no] = item

        for kid, item in list(watching_map.items()):
            if not isinstance(item, dict):
                continue
            nr = _norm_title(item.get("ru_title", ""))
            no = _norm_title(item.get("orig_title", ""))
            if nr:
                watching_by_ru.add(nr)
            if no:
                watching_by_orig.add(no)

        for kid, item in list(watchlist_map.items()):
            if not isinstance(item, dict):
                continue
            nr = _norm_title(item.get("ru_title", ""))
            no = _norm_title(item.get("orig_title", ""))
            if nr:
                watchlist_by_ru.add(nr)
            if no:
                watchlist_by_orig.add(no)

        for kid, item in list(never_map.items()):
            if not isinstance(item, dict):
                continue
            nr = _norm_title(item.get("ru_title", ""))
            no = _norm_title(item.get("orig_title", ""))
            if nr:
                never_by_ru.add(nr)
            if no:
                never_by_orig.add(no)

        for kid, fmeta in friend_known_snap:
            if not isinstance(fmeta, dict):
                continue
            fnr = _norm_title(fmeta.get("ru_title", ""))
            fno = _norm_title(fmeta.get("orig_title", ""))
            if fnr:
                friend_kid_by_ru[fnr] = str(kid)
            if fno:
                friend_kid_by_orig[fno] = str(kid)

        with self._state_lock:
            self._by_ru = by_ru
            self._by_orig = by_orig
            self._by_kid = by_kid
            self._watching_by_ru = watching_by_ru
            self._watching_by_orig = watching_by_orig
            self._watchlist_by_ru = watchlist_by_ru
            self._watchlist_by_orig = watchlist_by_orig
            self._never_by_ru = never_by_ru
            self._never_by_orig = never_by_orig
            self._friend_kid_by_ru = friend_kid_by_ru
            self._friend_kid_by_orig = friend_kid_by_orig
            self._live_meta_by_id = live_meta_by_id
            self._live_meta_by_ru = live_meta_by_ru
            self._live_meta_by_orig = live_meta_by_orig
            self._state_version = getattr(self, "_state_version", 0) + 1

    def switch_state_file(
        self,
        new_state_file: str,
        *,
        force_reload: bool = False,
        discard_dirty: bool = False,
    ) -> Dict[str, Any]:
        """
        Atomically flushes the current profile's Kinorium state to disk and switches
        `self.state_file` to `new_state_file`, reloading state and rebuilding all indices.
        """
        target_path = os.path.abspath(new_state_file)
        with self._state_lock:
            if os.path.abspath(self.state_file) == target_path and not force_reload:
                return self.get_account_summary()
            if self._save_timer is not None:
                self._save_timer.cancel()
                self._save_timer = None
            if self._save_dirty and not discard_dirty:
                self._write_state_file_locked()
            self._save_dirty = False
            prev_integrations = json.loads(json.dumps(self.state.get("integrations") or self.DEFAULT_INTEGRATIONS))
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            next_pid = profile_id_from_state_path(self.storage_dir, target_path)
            is_brand_new = (not self._db.has_profile_state(next_pid)) and (not os.path.exists(target_path))
            self.state_file = target_path
            self._profile_id = next_pid
            self._section_hashes = {}
            self.had_persisted_state = not is_brand_new
            with self._cookie_lock:
                self._kinorium_cookie_cache = ""
            with self._episodes_lock:
                self._series_episodes_cache.clear()
            self._session_auth_verified = None
            self._integrations_cache = None
            self._state_version += 1
            self.state = self._load_state()
            if is_brand_new and isinstance(prev_integrations, dict):
                for srv_id, srv_cfg in prev_integrations.items():
                    if srv_id == "kinorium" or not isinstance(srv_cfg, dict):
                        continue
                    if srv_id in self.state.get("integrations", {}):
                        self.state["integrations"][srv_id]["enabled"] = bool(srv_cfg.get("enabled", True))
                self._write_state_file_locked()
            self._build_lookup_indices()
            return self.get_account_summary()

    # HTTP transport, cookie helpers & JS challenge solver (cscript 16d51579-a30b-4c8b-a276-0ff4dc41e755 / .headless_js_profile) delegated to backend/kinorium_http.py
    extract_user_path = staticmethod(extract_user_path)
    extract_cookie_user_id = staticmethod(extract_cookie_user_id)
    sanitize_session_cookie = staticmethod(sanitize_session_cookie)
    _solve_kinorium_js_challenge = solve_kinorium_js_challenge
    _kinorium_candidate_domains = kinorium_candidate_domains
    is_ip_cooldown_active = is_ip_cooldown_active
    _kinorium_http_request = kinorium_http_request
    _get_active_sync_cookie = get_active_sync_cookie
    _ensure_kinorium_cookies = ensure_kinorium_cookies
    fetch_kinorium_html = fetch_kinorium_html

    extract_friends_tooltip_ratings = staticmethod(extract_friends_tooltip_ratings)
    extract_critics_pct = staticmethod(extract_critics_pct)
    extract_similar_items_html = staticmethod(extract_similar_items_html)

    _store_similar_for_kid = _store_similar_for_kid
    _get_cached_similar_for_kid = _get_cached_similar_for_kid
    _extract_balanced_block_html = staticmethod(_extract_balanced_block_html)
    extract_movie_description_html = staticmethod(extract_movie_description_html)
    fetch_movie_page_extras = fetch_movie_page_extras
    get_similar_catalog_items = get_similar_catalog_items
    parse_movie_list_html = staticmethod(parse_movie_list_html)
    parse_premieres_list_html = staticmethod(parse_premieres_list_html)
    _refresh_online_premieres_sync = _refresh_online_premieres_sync
    _maybe_trigger_bg_premieres_refresh = _maybe_trigger_bg_premieres_refresh
    get_online_premieres_count = get_online_premieres_count
    fetch_online_premieres = fetch_online_premieres
    fetch_status_list_ajax = fetch_status_list_ajax
    _verify_recent_watchlist_online_availability = _verify_recent_watchlist_online_availability
    _extract_profile_avatar_url = staticmethod(_extract_profile_avatar_url)
    _extract_cookie_display_name = staticmethod(_extract_cookie_display_name)
    _extract_profile_display_name = staticmethod(_extract_profile_display_name)
    _parse_following_html = staticmethod(_parse_following_html)
    _resolve_friend_user_by_name_ajax = _resolve_friend_user_by_name_ajax
    sync_user_profile = sync_user_profile
    disconnect_user_profile = disconnect_user_profile
    _count_dismissed_cw_items_locked = _count_dismissed_cw_items_locked
    get_account_summary = get_account_summary
    export_backup_state = export_backup_state
    import_backup_state = import_backup_state
    get_integrations = get_integrations
    is_service_enabled = is_service_enabled
    set_services_enabled_bulk = set_services_enabled_bulk
    apply_country_localization = apply_country_localization
    set_service_login = set_service_login

    def get_series_live_meta(
        self,
        item_id: str = "",
        title: str = "",
        orig_title: str = "",
        kid: Optional[str] = None,
        year: int = 0,
        media_type: str = "series",
    ) -> Optional[Dict[str, Any]]:
        if media_type and str(media_type).strip().lower() != "series":
            return None

        def _year_ok(cand: Dict[str, Any]) -> bool:
            cy = _safe_year_int(cand.get("year"))
            ry = _safe_year_int(year)
            if cy >= 1900 and ry >= 1900 and abs(cy - ry) > 2:
                return False
            return True

        with self._state_lock:
            meta_by_id = self._live_meta_by_id
            meta_by_orig = self._live_meta_by_orig
            meta_by_ru = self._live_meta_by_ru

            if item_id and not str(item_id).isdigit() and item_id in meta_by_id:
                hit = meta_by_id[item_id]
                if _year_ok(hit):
                    return hit
            if kid:
                if str(kid) in meta_by_id:
                    return meta_by_id[str(kid)]
                if f"kin_{kid}" in meta_by_id:
                    return meta_by_id[f"kin_{kid}"]
            for no in _title_variants(orig_title):
                if no in meta_by_orig and _year_ok(meta_by_orig[no]):
                    return meta_by_orig[no]
            for nr in _title_variants(title):
                if nr in ("фильм", "сериал"):
                    continue
                if nr in meta_by_ru and _year_ok(meta_by_ru[nr]):
                    cand = meta_by_ru[nr]
                    # If caller has a Latin orig_title and candidate also has a Latin orig_title, require match
                    if orig_title and cand.get("orig_title"):
                        if _norm_title(orig_title) != _norm_title(cand["orig_title"]):
                            continue
                    return cand
        return None

    def save_series_live_meta(self, updates: List[Dict[str, Any]]):
        if not updates:
            return
        with self._state_lock:
            store = self.state.setdefault("series_live_meta", {})
            now_ts = time.time()
            changed = False
            for u in updates:
                if not isinstance(u, dict):
                    continue
                mt = str(u.get("media_type") or "series").strip().lower()
                if mt != "series":
                    continue
                uid = str(u.get("id") or "").strip()
                title = str(u.get("title") or "").strip()
                orig_title = str(u.get("orig_title") or "").strip()
                year_val = _safe_year_int(u.get("year"))
                r_url = str(u.get("rezka_url") or "").strip()
                if title.lower() in ("фильм", "сериал", "movie", "series"):
                    title = ""
                if not title and not orig_title and not uid:
                    continue
                if "/films/" in r_url.lower():
                    continue
                # Never store bare HDRezka integer as catalog uid
                if uid.isdigit() and uid == str(u.get("rezka_id") or "").strip():
                    uid = ""

                kid = self._resolve_kinorium_id(
                    uid,
                    title,
                    orig_title,
                    allow_network=False,
                    media_type="series",
                    year=year_val if year_val else None,
                ) or ""
                key = f"kin_{kid}" if kid else (uid or _norm_title(orig_title or title))
                if not key or (key.startswith("kin_") and not key[4:].isdigit()):
                    continue
                existing = store.get(key) if isinstance(store.get(key), dict) else {}
                raw_smap = u.get("seasons_map")
                smap = (
                    raw_smap
                    if isinstance(raw_smap, dict) and raw_smap
                    else (existing.get("seasons_map") if isinstance(existing.get("seasons_map"), dict) else {})
                )
                is_comp = (
                    bool(u.get("is_completed"))
                    if "is_completed" in u and u.get("is_completed") is not None
                    else bool(existing.get("is_completed", False))
                )
                status_txt = (
                    str(u.get("series_status_text") or "")
                    if "series_status_text" in u
                    else str(existing.get("series_status_text") or "")
                )
                eff_uid = uid or (f"kin_{kid}" if kid else str(existing.get("id") or key))
                if eff_uid.isdigit() and kid:
                    eff_uid = f"kin_{kid}"
                old_s = int(existing.get("latest_season") or 0)
                old_e = int(existing.get("latest_episode") or 0)
                # Missing fields must keep the known values (defaulting to 1/1 wiped e.g. S5E10 and then
                # produced a false "new episode" on the next real update).
                new_s = int(u.get("latest_season") or old_s or 1)
                new_e = int(u.get("latest_episode") or old_e or 1)
                is_new_air = False
                if old_s > 0 and old_e > 0:
                    if new_s > old_s or (new_s == old_s and new_e > old_e):
                        is_new_air = True
                has_act_rel = is_new_air or bool(
                    existing.get("has_actual_new_release")
                    and (now_ts - float(existing.get("last_new_release_ts") or 0.0) < 604800.0)
                )
                last_rel_ts = now_ts if is_new_air else float(existing.get("last_new_release_ts") or 0.0)
                had_valid_existing = bool(existing and not existing.get("not_found") and old_s > 0 and old_e > 0)
                is_not_found = False if had_valid_existing else bool(u.get("not_found", False))
                entry = {
                    "id": eff_uid,
                    "kinorium_id": str(kid) if kid else "",
                    "title": title or str(existing.get("title") or ""),
                    "orig_title": orig_title or str(existing.get("orig_title") or ""),
                    "year": year_val or _safe_year_int(existing.get("year")),
                    "rezka_id": str(u.get("rezka_id") or existing.get("rezka_id") or ""),
                    "rezka_url": str(r_url or existing.get("rezka_url") or ""),
                    "latest_season": new_s,
                    "latest_episode": new_e,
                    "seasons_map": smap,
                    "is_completed": is_comp,
                    "series_status_text": status_txt,
                    "studios_summary": str(u.get("studios_summary") or "HDRezka"),
                    "studios_count": int(u.get("studios_count") or 0),
                    "not_found": is_not_found,
                    "has_actual_new_release": has_act_rel,
                    "last_new_release_ts": last_rel_ts,
                    "updated_at": float(u.get("updated_at") or now_ts),
                }
                store[key] = entry
                self._live_meta_by_id[key] = entry
                if eff_uid and not eff_uid.isdigit():
                    self._live_meta_by_id[eff_uid] = entry
                if kid:
                    self._live_meta_by_id[str(kid)] = entry
                    self._live_meta_by_id[f"kin_{kid}"] = entry
                nr = _norm_title(entry["title"])
                no = _norm_title(entry["orig_title"])
                if nr and nr not in ("фильм", "сериал"):
                    self._live_meta_by_ru[nr] = entry
                if no and no not in ("фильм", "сериал"):
                    self._live_meta_by_orig[no] = entry
                changed = True
            if changed:
                self._save_state(immediate=False, bump_version=True)

    def _resolve_remote_item(
        self,
        item_id: str,
        title: str = "",
        orig_title: str = "",
        year: Optional[int] = None,
        media_type: str = "",
    ) -> Optional[Dict[str, Any]]:
        def _compat(cand: Dict[str, Any]) -> bool:
            if year and cand.get("year"):
                try:
                    if abs(int(year) - int(cand["year"])) > 2:
                        return False
                except Exception:
                    pass
            return True

        with self._state_lock:
            if item_id and item_id.startswith("kin_"):
                kid = item_id[4:]
                if kid in self._by_kid:
                    return self._by_kid[kid]
            elif item_id and item_id.isdigit() and item_id in self._by_kid:
                return self._by_kid[item_id]

            for no in _title_variants(orig_title):
                if no in self._by_orig and _compat(self._by_orig[no]):
                    return self._by_orig[no]
                if no in self._by_ru and _compat(self._by_ru[no]):
                    return self._by_ru[no]
            for nr in _title_variants(title):
                if nr in ("фильм", "сериал"):
                    continue
                if nr in self._by_ru and _compat(self._by_ru[nr]):
                    cand = self._by_ru[nr]
                    if orig_title and cand.get("orig_title") and _norm_title(orig_title) != _norm_title(cand["orig_title"]):
                        continue
                    return cand
                if nr in self._by_orig and _compat(self._by_orig[nr]):
                    return self._by_orig[nr]
        return None

    def _resolve_kinorium_id(
        self,
        item_id: str,
        title: str = "",
        orig_title: str = "",
        allow_network: bool = False,
        media_type: str = "",
        year: Optional[int] = None,
    ) -> Optional[str]:
        if item_id and item_id.startswith("kin_") and item_id[4:].isdigit():
            return item_id[4:]
        with self._state_lock:
            if item_id and item_id.isdigit() and item_id in self._by_kid:
                return item_id
            if item_id and item_id in self._live_meta_by_id:
                lm_kid = str(self._live_meta_by_id[item_id].get("kinorium_id") or "")
                if lm_kid.isdigit():
                    return lm_kid
            rem = self._resolve_remote_item(item_id, title, orig_title)
            if rem and str(rem.get("kinorium_id") or "").isdigit():
                return str(rem["kinorium_id"])
            for nr in _title_variants(title):
                if nr in self._friend_kid_by_ru and str(self._friend_kid_by_ru[nr]).isdigit():
                    return str(self._friend_kid_by_ru[nr])
                if nr in self._friend_kid_by_orig and str(self._friend_kid_by_orig[nr]).isdigit():
                    return str(self._friend_kid_by_orig[nr])
            for no in _title_variants(orig_title):
                if no in self._friend_kid_by_orig and str(self._friend_kid_by_orig[no]).isdigit():
                    return str(self._friend_kid_by_orig[no])
                if no in self._friend_kid_by_ru and str(self._friend_kid_by_ru[no]).isdigit():
                    return str(self._friend_kid_by_ru[no])
        if not allow_network:
            return None
        # Live lookup via Kinorium /handlers/Search/ (requires XHR headers)
        nr_targets = set(_title_variants(title))
        no_targets = set(_title_variants(orig_title))
        queries: List[str] = []
        for q_cand in (orig_title, title):
            q_clean = (q_cand or "").strip()
            if q_clean and q_clean not in queries:
                queries.append(q_clean)
        xhr_headers = {
            "X-Requested-With": "XMLHttpRequest",
            "Referer": "https://ru.kinorium.com/",
        }
        best_kid: Optional[str] = None
        best_score = -1
        best_entry: Optional[Dict[str, Any]] = None
        for query in queries:
            try:
                q_enc = urllib.parse.quote(query)
                raw = self.fetch_kinorium_html(
                    f"https://ru.kinorium.com/handlers/Search/?str={q_enc}",
                    extra_headers=xhr_headers,
                )
                data = json.loads(raw)
                for idx, entry in enumerate(data.get("list") or []):
                    if entry.get("mixtype") != "movie" or not str(entry.get("id") or "").isdigit():
                        continue
                    cand_kid = str(entry["id"])
                    cand_ru = str(entry.get("name") or "")
                    cand_orig = str(entry.get("name_orig") or entry.get("orig") or "")
                    cand_nr = _norm_title(cand_ru)
                    cand_no = _norm_title(cand_orig)
                    sc = max(0, 15 - idx * 2)
                    if cand_no and cand_no in no_targets:
                        sc += 110
                    if cand_nr and cand_nr in nr_targets:
                        sc += 100
                    if cand_no and cand_no in nr_targets:
                        sc += 80
                    if cand_nr and cand_nr in no_targets:
                        sc += 80
                    if media_type in ("movie", "series"):
                        is_ser = bool(entry.get("isSerial"))
                        if is_ser == (media_type == "series"):
                            sc += 35
                        else:
                            sc -= 25
                    if year:
                        ey_raw = str(entry.get("year_serial_b") or entry.get("year") or "")
                        if ey_raw.isdigit() and abs(int(ey_raw) - int(year)) <= 1:
                            sc += 25
                        elif ey_raw.isdigit() and abs(int(ey_raw) - int(year)) >= 3:
                            # Remakes / homonyms (Shogun 1980 vs 2024): a known, distant year is disqualifying
                            sc -= 120
                    if sc > best_score:
                        best_score = sc
                        best_kid = cand_kid
                        best_entry = entry
                if best_kid and best_score >= 100:
                    break
            except Exception:
                continue
        # Only a real title match (>=80 title points + bonuses) is trusted: these ids drive
        # status / rating writes on the user's real Kinorium account.
        if best_kid and best_entry is not None and best_score >= 100:
            ru_t_val = str(best_entry.get("name") or title)
            orig_t_val = str(best_entry.get("name_orig") or best_entry.get("orig") or orig_title)
            fnr = _norm_title(ru_t_val)
            fno = _norm_title(orig_t_val)
            with self._state_lock:
                fkt = self.state.setdefault("friend_known_titles", {})
                if len(fkt) > 2000:
                    for k_ev in list(fkt.keys())[:500]:
                        fkt.pop(k_ev, None)
                fkt[best_kid] = {
                    "kinorium_id": best_kid,
                    "ru_title": ru_t_val,
                    "orig_title": orig_t_val,
                }
                if fnr:
                    self._friend_kid_by_ru[fnr] = str(best_kid)
                if fno:
                    self._friend_kid_by_orig[fno] = str(best_kid)
            return best_kid
        return None

    def search_persons_and_movies(self, query: str) -> Dict[str, List[Dict[str, Any]]]:
        q_clean = (query or "").strip()
        if not q_clean:
            return {"persons": [], "movies": []}
        cache_key = _norm_title(q_clean)
        now_ts = time.time()
        with self._person_lock:
            cached = self._person_search_cache.get(cache_key)
            if cached and (now_ts - cached[0]) < 900:
                return cached[1]
        try:
            q_enc = urllib.parse.quote(q_clean)
            raw = self.fetch_kinorium_html(
                f"https://ru.kinorium.com/handlers/Search/?str={q_enc}",
                extra_headers={
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": "https://ru.kinorium.com/",
                },
            )
            res = parse_search_persons_and_movies(raw)
        except Exception:
            return {"persons": [], "movies": []}

        with self._person_lock:
            if len(self._person_search_cache) > 256:
                for k_ev in list(self._person_search_cache.keys())[:64]:
                    self._person_search_cache.pop(k_ev, None)
            self._person_search_cache[cache_key] = (now_ts, res)
        return res

    def fetch_person_filmography(self, persona_id: str = "", name: str = "") -> Dict[str, Any]:
        eff_pid = str(persona_id or "").strip()
        q_name = (name or "").strip()
        if not eff_pid.isdigit() and q_name:
            s_res = self.search_persons_and_movies(q_name)
            q_norm = _norm_title(q_name)
            best_p: Optional[Dict[str, Any]] = None
            best_sc = -999
            for idx, cand in enumerate(s_res.get("persons") or []):
                cn_ru = _norm_title(str(cand.get("name") or ""))
                cn_en = _norm_title(str(cand.get("orig_name") or ""))
                name_bonus = 0
                if q_norm and (q_norm == cn_ru or q_norm == cn_en):
                    name_bonus = 120
                elif q_norm and (
                    (cn_ru and (q_norm in cn_ru or cn_ru in q_norm))
                    or (cn_en and (q_norm in cn_en or cn_en in q_norm))
                ):
                    name_bonus = 65
                if name_bonus <= 0:
                    continue
                sc = name_bonus + (60 if cand.get("has_image") else 0) + (20 if cand.get("birth_date") else 0) - idx * 3
                if sc > best_sc:
                    best_sc = sc
                    best_p = cand
            if best_p:
                eff_pid = str(best_p.get("kinorium_person_id") or "")
                q_name = str(best_p.get("name") or q_name)
        if not eff_pid.isdigit():
            return {}

        now_ts = time.time()
        with self._person_lock:
            cached = self._person_filmog_cache.get(eff_pid)
            if cached and (now_ts - cached[0]) < 1800:
                return cached[1]

        try:
            html_page = self.fetch_kinorium_html(f"https://ru.kinorium.com/name/{eff_pid}/")
        except Exception:
            return {}

        result = parse_person_filmography_html(
            html_page,
            eff_pid,
            fallback_name=q_name,
            genres_sanitizer=_sanitize_kinorium_genres,
        )
        if not result:
            return {}

        with self._person_lock:
            if len(self._person_filmog_cache) > 128:
                for k_ev in list(self._person_filmog_cache.keys())[:32]:
                    self._person_filmog_cache.pop(k_ev, None)
            self._person_filmog_cache[eff_pid] = (now_ts, result)
        return result

    def get_item_status(
        self,
        item_id: str,
        base_kinorium_rating: float = 8.1,
        title: str = "",
        orig_title: str = "",
    ) -> Dict[str, Any]:
        # 1. Resolve synced Kinorium entry & canonical kin_<id> alias early so local overrides
        #    recorded under either `item_id` or `kin_<id>` are always respected consistently.
        remote_item = self._resolve_remote_item(item_id, title, orig_title)
        kid_str = str(remote_item.get("kinorium_id")) if remote_item and remote_item.get("kinorium_id") else ""
        kid_early = kid_str or str(self._resolve_kinorium_id(item_id, title, orig_title, allow_network=False) or "")
        k_pref_early = f"kin_{kid_early}" if kid_early.isdigit() else ""
        lookup_ids = [k for k in dict.fromkeys([item_id, k_pref_early]) if k]

        watched_dict = self.state.get("watched") or {}
        ratings_dict = self.state.get("ratings") or {}
        watchlist_arr = self.state.get("watchlist") or []
        watching_local_arr = self.state.get("watching_local") or []
        never_local_arr = self.state.get("never_local") or []
        unwatched_watchlist = self.state.get("watchlist_removed") or []
        watching_removed = self.state.get("watching_removed") or []
        never_removed = self.state.get("never_removed") or []
        cw_arr = self.state.get("continue_watching") or []

        idx_key = (
            getattr(self, "_state_version", 0),
            id(watchlist_arr), len(watchlist_arr),
            id(watching_local_arr), len(watching_local_arr),
            id(never_local_arr), len(never_local_arr),
            id(unwatched_watchlist), len(unwatched_watchlist),
            id(watching_removed), len(watching_removed),
            id(never_removed), len(never_removed),
            id(cw_arr), len(cw_arr),
        )
        local_idx = getattr(self, "_local_status_idx_val", None)
        if local_idx is None or getattr(self, "_local_status_idx_key", None) != idx_key:
            cw_ids = set()
            cw_nrs = set()
            for cw_it in cw_arr:
                if isinstance(cw_it, dict):
                    cid = cw_it.get("id")
                    if cid:
                        cw_ids.add(cid)
                    ctitle = cw_it.get("title")
                    if ctitle:
                        cnr = _norm_title(ctitle)
                        if cnr:
                            cw_nrs.add(cnr)
            local_idx = (
                set(watchlist_arr),
                set(watching_local_arr),
                set(never_local_arr),
                set(unwatched_watchlist),
                set(watching_removed),
                set(never_removed),
                cw_ids,
                cw_nrs,
            )
            self._local_status_idx_key = idx_key
            self._local_status_idx_val = local_idx

        wl_set, w_loc_set, n_loc_set, wl_rem_set, w_rem_set, n_rem_set, cw_ids_set, cw_nrs_set = local_idx

        local_watched = None
        for lk in lookup_ids:
            if lk in watched_dict:
                local_watched = watched_dict[lk]
                break
        local_rating = None
        for lk in lookup_ids:
            if lk in ratings_dict:
                local_rating = ratings_dict[lk]
                break
        local_in_watchlist = any(lk in wl_set for lk in lookup_ids)
        local_watching = any(lk in w_loc_set for lk in lookup_ids)
        local_never = any(lk in n_loc_set for lk in lookup_ids)

        if local_watched is not None:
            is_watched = bool(local_watched.get("watched"))
        else:
            is_watched = bool(
                (kid_early and kid_early in (self.state.get("remote_watched_items") or {}))
                or (remote_item and remote_item.get("watched"))
            )

        if local_rating and local_rating.get("cleared"):
            user_score = None
        else:
            user_score = (
                local_rating.get("score")
                if local_rating and local_rating.get("score") is not None and int(local_rating.get("score") or 0) > 0
                else (remote_item.get("score") if remote_item else None)
            )
        user_comment = (
            ""
            if (local_rating and local_rating.get("cleared"))
            else (
                local_rating.get("comment")
                if (local_rating and local_rating.get("comment"))
                else (remote_item.get("comment", "") if remote_item else "")
            )
        )

        nr_vars = _title_variants(title)
        no_vars = _title_variants(orig_title)
        nr = nr_vars[0] if nr_vars else ""

        is_wl_removed = any(lk in wl_rem_set for lk in lookup_ids)
        in_watchlist = bool(
            not is_wl_removed
            and (
                local_in_watchlist
                or (kid_early and kid_early in (self.state.get("remote_watchlist_items") or {}))
                or any(v in self._watchlist_by_ru for v in nr_vars)
                or any(v in self._watchlist_by_orig for v in no_vars)
            )
        )

        is_w_removed = any(lk in w_rem_set for lk in lookup_ids)
        is_watching = bool(
            not is_watched
            and not is_w_removed
            and (
                local_watching
                or (kid_early and kid_early in (self.state.get("remote_watching_items") or {}))
                or any(v in self._watching_by_ru for v in nr_vars)
                or any(v in self._watching_by_orig for v in no_vars)
            )
        )

        is_n_removed = any(lk in n_rem_set for lk in lookup_ids)
        not_watching = bool(
            not is_watched
            and not user_score
            and not is_n_removed
            and (
                local_never
                or (kid_early and kid_early in (self.state.get("remote_never_items") or {}))
                or any(v in self._never_by_ru for v in nr_vars)
                or any(v in self._never_by_orig for v in no_vars)
            )
        )

        # 3. Resolve real friends' ratings and per-season watched episodes map first
        kid = kid_early or None
        friends_ratings: List[Dict[str, Any]] = []
        we_map: Dict[str, List[int]] = {}
        ep_ratings_map: Dict[str, Dict[str, Any]] = {}
        cw_match = None
        lookup_keys = [k for k in (item_id, f"kin_{kid}" if kid else "") if k]
        with self._state_lock:
            if kid:
                friends_ratings = list((self.state.get("friends_ratings_by_kid") or {}).get(str(kid), []))
            raw_we_store = self.state.get("watched_episodes") or {}
            for k_lookup in lookup_keys:
                sub_map = raw_we_store.get(k_lookup)
                if isinstance(sub_map, dict):
                    for s_k, ep_list in sub_map.items():
                        if isinstance(ep_list, list):
                            merged_eps = sorted(
                                set(we_map.get(str(s_k), []) + [int(x) for x in ep_list if str(x).isdigit()])
                            )
                            we_map[str(s_k)] = merged_eps

            raw_er_store = self.state.get("episode_ratings") or {}
            for k_lookup in lookup_keys:
                sub_er = raw_er_store.get(k_lookup)
                if isinstance(sub_er, dict):
                    for ep_k, ep_val in sub_er.items():
                        if isinstance(ep_val, dict):
                            ep_ratings_map[str(ep_k)] = dict(ep_val)

            if (
                item_id in cw_ids_set
                or (kid and f"kin_{kid}" in cw_ids_set)
                or (nr and nr in cw_nrs_set)
            ):
                for cw_it in (self.state.get("continue_watching") or []):
                    if not isinstance(cw_it, dict):
                        continue
                    if (
                        cw_it.get("id") == item_id
                        or (kid and cw_it.get("id") == f"kin_{kid}")
                        or (nr and _norm_title(cw_it.get("title", "")) == nr)
                    ):
                        cw_match = dict(cw_it)
                        break

        # 4. Unified Season & Episode resolution across Continue Watching, Poster Grid, Notifications & Player
        mtype_val = (remote_item.get("media_type") if remote_item else "series") or "series"
        has_new_episode = False
        all_released_episodes_watched = False

        live_meta = self.get_series_live_meta(item_id=item_id, title=title, orig_title=orig_title, kid=kid)
        next_season = 1
        next_episode = 1
        episode_verified = False
        latest_season = None
        latest_episode = None
        studios_summary = ""

        cw_s_num = max(1, int(cw_match.get("season") or 1)) if cw_match else 0
        cw_e_num = max(1, int(cw_match.get("episode") or 1)) if cw_match else 0
        cw_ep_already_watched = bool(
            cw_match and cw_e_num in (we_map.get(str(cw_s_num)) or [])
        )
        has_mid_episode_resume = bool(
            cw_match
            and not cw_match.get("is_new_episode")
            and not cw_ep_already_watched
            and float(cw_match.get("current_time") or 0.0) >= 15.0
        )

        series_status_text = ""
        is_series_completed = False
        if live_meta and not live_meta.get("not_found"):
            latest_season = max(1, int(live_meta.get("latest_season") or 1))
            latest_episode = max(1, int(live_meta.get("latest_episode") or 1))
            studios_summary = str(live_meta.get("studios_summary") or "")
            series_status_text = str(live_meta.get("series_status_text") or "")
            if bool(live_meta.get("is_completed")):
                rem_seasons = int(remote_item.get("seasons_count") or 0) if remote_item else 0
                if not (rem_seasons > latest_season):
                    is_series_completed = True

        if latest_season is not None and latest_episode is not None and mtype_val == "series":
            numeric_seasons_all = sorted(
                int(k) for k in we_map.keys() if str(k).isdigit() and we_map.get(k)
            )
            watched_in_latest_all = list(we_map.get(str(latest_season)) or [])
            max_prev_s = max(numeric_seasons_all) if numeric_seasons_all else 0
            has_unwatched_season = bool(latest_season and max_prev_s and latest_season > max_prev_s)
            has_unwatched_in_latest = bool(latest_season and latest_episode and watched_in_latest_all and max(watched_in_latest_all) < latest_episode)

            if has_unwatched_season or (latest_season and not watched_in_latest_all and max_prev_s < latest_season):
                # An entire new season has been released that the user has not watched yet
                all_released_episodes_watched = False
                has_new_episode = bool(is_watched or bool(live_meta and live_meta.get("has_actual_new_release")))
            elif has_unwatched_in_latest:
                # Latest season is not fully watched
                all_released_episodes_watched = False
                if is_watched:
                    has_new_episode = True
                elif is_watching and not not_watching:
                    # User is currently watching this season: only mark new_episode if an actual new release occurred since watching started
                    if live_meta and "has_actual_new_release" in live_meta:
                        last_rel_ts = float(live_meta.get("last_new_release_ts") or 0.0)
                        user_cw_ts = float(cw_match.get("updated_at") or 0.0) if cw_match else 0.0
                        if last_rel_ts > 0 and user_cw_ts > 0:
                            has_new_episode = bool(last_rel_ts > user_cw_ts)
                        else:
                            has_new_episode = bool(live_meta.get("has_actual_new_release"))
                    elif cw_match and float(cw_match.get("updated_at") or 0.0) > 0:
                        has_new_episode = False
                    else:
                        has_new_episode = True
            elif is_watched and not is_watching:
                all_released_episodes_watched = True
                has_new_episode = False
            elif (watched_in_latest_all and max(watched_in_latest_all) >= latest_episode) or (
                numeric_seasons_all and max(numeric_seasons_all) > latest_season
            ):
                all_released_episodes_watched = True
                has_new_episode = False
            elif is_watching and not not_watching:
                if is_series_completed:
                    has_new_episode = False
                elif live_meta and "has_actual_new_release" in live_meta:
                    last_rel_ts = float(live_meta.get("last_new_release_ts") or 0.0)
                    user_cw_ts = float(cw_match.get("updated_at") or 0.0) if cw_match else 0.0
                    if last_rel_ts > 0 and user_cw_ts > 0:
                        has_new_episode = bool(last_rel_ts > user_cw_ts)
                    else:
                        has_new_episode = bool(live_meta.get("has_actual_new_release"))
                else:
                    has_new_episode = False

        if (
            mtype_val == "series"
            and is_series_completed
            and all_released_episodes_watched
            and not not_watching
        ):
            was_watching_now = is_watching
            is_watched = True
            is_watching = False
            has_new_episode = False
            heal_sig = f"{self._state_version}:{item_id}:{kid or ''}"
            if heal_sig not in self._healed_series_keys:
                with self._state_lock:
                    if len(self._healed_series_keys) > 4096:
                        self._healed_series_keys.clear()
                    self._healed_series_keys.add(heal_sig)
                    rem_w_map = self.state.get("remote_watching_items") or {}
                    in_rem_w = bool(kid and str(kid) in rem_w_map)
                    already_auto = bool(
                        isinstance((self.state.get("watched") or {}).get(item_id), dict)
                        and (self.state.get("watched") or {}).get(item_id, {}).get("auto_scrobbled")
                        and item_id not in (self.state.get("watching_local") or [])
                        and not in_rem_w
                    )
            else:
                in_rem_w = False
                already_auto = True
            if (was_watching_now or in_rem_w) and not already_auto:
                now_str_auto = time.strftime("%Y-%m-%d %H:%M")
                auto_entry = {
                    "item_id": item_id,
                    "title": title,
                    "orig_title": orig_title,
                    "watched": True,
                    "watched_at": now_str_auto,
                    "season": latest_season,
                    "episode": latest_episode,
                    "auto_scrobbled": True,
                }
                with self._state_lock:
                    self.state.setdefault("watched", {})[item_id] = auto_entry
                    loc_w = self.state.setdefault("watching_local", [])
                    if item_id in loc_w:
                        loc_w.remove(item_id)
                    rem_w = self.state.setdefault("watching_removed", [])
                    if item_id and item_id not in rem_w:
                        rem_w.append(item_id)
                    if kid and str(kid).isdigit():
                        k_str = str(kid)
                        k_pref = f"kin_{k_str}"
                        self.state["watched"][k_pref] = auto_entry
                        if k_pref in loc_w:
                            loc_w.remove(k_pref)
                        if k_pref not in rem_w:
                            rem_w.append(k_pref)
                        popped_w = (self.state.get("remote_watching_items") or {}).pop(k_str, None)
                        tpl_w = dict(popped_w) if isinstance(popped_w, dict) else self._ensure_remote_entry_template(k_str, title, orig_title, extra={"media_type": "series"})
                        tpl_w["watched"] = True
                        tpl_w["watching"] = False
                        tpl_w["status"] = "done"
                        tpl_w["watched_at"] = now_str_auto
                        tpl_w["auto_scrobbled"] = True
                        self.state.setdefault("remote_watched_items", {})[k_str] = tpl_w
                self._build_lookup_indices()
                self._save_state(immediate=False, bump_version=True)
                if kid and str(kid).isdigit():
                    self._run_remote_sync_bg(
                        action="watched",
                        item_id=str(item_id or f"kin_{kid}"),
                        title=title,
                        orig_title=orig_title,
                        resolved_kid=str(kid),
                    )
                    self._run_remote_sync_bg(
                        action="watching_remove",
                        item_id=str(item_id or f"kin_{kid}"),
                        title=title,
                        orig_title=orig_title,
                        resolved_kid=str(kid),
                    )

        if has_mid_episode_resume and cw_match and not all_released_episodes_watched:
            next_season = max(1, int(cw_match.get("season") or 1))
            next_episode = max(1, int(cw_match.get("episode") or 1))
            episode_verified = True
        elif latest_season is not None and latest_episode is not None:
            numeric_seasons = sorted(
                int(k) for k in we_map.keys() if str(k).isdigit() and we_map.get(k)
            )
            watched_in_latest = list(we_map.get(str(latest_season)) or [])
            if is_watched and not is_watching and not has_new_episode:
                next_season = latest_season
                next_episode = latest_episode
                episode_verified = True
            elif numeric_seasons and max(numeric_seasons) > latest_season:
                max_s = max(numeric_seasons)
                has_new_episode = False
                next_season = max_s
                next_episode = max(we_map[str(max_s)])
            elif watched_in_latest:
                max_watched_ep = max(watched_in_latest)
                if max_watched_ep >= latest_episode:
                    # User already watched up to the latest released episode on HDRezka
                    has_new_episode = False
                    next_season = latest_season
                    next_episode = latest_episode
                else:
                    next_season = latest_season
                    next_episode = max_watched_ep + 1
            else:
                if numeric_seasons:
                    max_prev_s = max(numeric_seasons)
                    max_prev_ep = max(we_map[str(max_prev_s)])
                    smap = (live_meta.get("seasons_map") or {}) if isinstance(live_meta, dict) else {}
                    prev_s_eps = [
                        int(x) for x in (smap.get(str(max_prev_s)) or []) if str(x).isdigit()
                    ]
                    if prev_s_eps and max_prev_ep < max(prev_s_eps):
                        next_season = max_prev_s
                        next_episode = max_prev_ep + 1
                    else:
                        next_season = min(latest_season, max_prev_s + 1)
                        next_episode = 1
                elif cw_match and not cw_ep_already_watched and not cw_match.get("is_new_episode") and (
                    cw_match.get("season") or cw_match.get("episode")
                ):
                    next_season = max(1, int(cw_match.get("season") or 1))
                    next_episode = max(1, int(cw_match.get("episode") or 1))
                else:
                    next_season = 1
                    next_episode = 1
            episode_verified = True
        elif live_meta and live_meta.get("not_found"):
            has_new_episode = False
            episode_verified = False
        elif cw_match and not cw_ep_already_watched and (cw_match.get("season") or cw_match.get("episode")):
            next_season = max(1, int(cw_match.get("season") or next_season))
            next_episode = max(1, int(cw_match.get("episode") or 1))
            episode_verified = not bool(cw_match.get("is_new_episode"))
        elif we_map:
            numeric_seasons = [int(k) for k in we_map.keys() if str(k).isdigit() and we_map.get(k)]
            if numeric_seasons:
                max_s = max(numeric_seasons)
                max_w = max(we_map[str(max_s)])
                next_season = max_s
                next_episode = max_w + 1
                episode_verified = True

        # Primary status code for badge display
        if not_watching:
            st_code = "never"
        elif has_new_episode:
            st_code = "new_ep"
        elif is_watched or all_released_episodes_watched:
            st_code = "done"
        elif is_watching:
            st_code = "now"
        elif in_watchlist:
            st_code = "future"
        else:
            st_code = ""

        cached_critics = None
        if remote_item and remote_item.get("critics_rating") is not None:
            cached_critics = int(remote_item["critics_rating"])
        elif kid and str(kid) in (self.state.get("critics_by_kid") or {}):
            cv = self.state["critics_by_kid"][str(kid)]
            if isinstance(cv, int) and cv > 0:
                cached_critics = cv

        return {
            "kinorium_id": kid,
            "kinorium_rating": remote_item.get("kinorium_rating", base_kinorium_rating) if remote_item else base_kinorium_rating,
            "imdb_rating": remote_item.get("imdb_rating") if remote_item else None,
            "critics_rating": cached_critics,
            "status_code": st_code,
            "watched": is_watched,
            "watching": is_watching,
            "has_new_episode": has_new_episode,
            "all_released_episodes_watched": all_released_episodes_watched,
            "episode_verified": episode_verified,
            "next_season": next_season,
            "next_episode": next_episode,
            "latest_season": latest_season,
            "latest_episode": latest_episode,
            "is_completed": is_series_completed,
            "series_status_text": series_status_text,
            "studios_summary": studios_summary,
            "watched_episodes": we_map,
            "episode_ratings": ep_ratings_map,
            "in_watchlist": in_watchlist,
            "not_watching": not_watching,
            "watched_info": local_watched or remote_item,
            "user_rating": user_score,
            "user_comment": user_comment,
            "friends_ratings": friends_ratings,
            "profile_name": (self.state.get("account") or {}).get("display_name") or "Киноман",
        }

    @staticmethod
    def is_item_fully_watched_or_caught_up(k_status: Dict[str, Any], media_type: str = "movie") -> bool:
        """
        Returns True if a movie is watched or a series has all currently released episodes watched
        (so it should not appear in 'Премьеры онлайн' or 'Смотрю').
        """
        if not isinstance(k_status, dict):
            return False
        if k_status.get("not_watching"):
            return True
        mtype = str(media_type or "").strip().lower()
        if mtype != "series":
            return bool(k_status.get("watched"))
        if k_status.get("all_released_episodes_watched"):
            return True
        ls = k_status.get("latest_season")
        le = k_status.get("latest_episode")
        we_map = k_status.get("watched_episodes") or {}
        if ls is not None and le is not None:
            ls_int = int(ls or 1)
            le_int = int(le or 1)
            w_in_ls = [int(x) for x in (we_map.get(str(ls_int)) or []) if str(x).isdigit()]
            if w_in_ls and max(w_in_ls) >= le_int:
                return True
            num_s = [int(s) for s, eps in we_map.items() if str(s).isdigit() and eps]
            if num_s and max(num_s) > ls_int:
                return True
            return False
        return bool(k_status.get("watched") and not k_status.get("has_new_episode"))

    def get_watching_with_new_episodes(self) -> List[Dict[str, Any]]:
        """
        Returns all series from the user's 'Смотрю' list that have unwatched / newly released episodes
        (i.e. `has_new_episode == True`).
        """
        all_watching = self.get_section_catalog_items(section="watching", media_type_filter="series", query="")
        active_new_eps: List[Dict[str, Any]] = []
        for it in all_watching:
            ks = it.get("kinorium") or {}
            if ks.get("has_new_episode") and not self.is_item_fully_watched_or_caught_up(ks, media_type="series"):
                active_new_eps.append(it)
        return active_new_eps

    def get_sections_counts(self, premieres_count: Optional[int] = None) -> Dict[str, int]:
        if premieres_count is None:
            premieres_count = self.get_online_premieres_count(allow_network=False)
        cur_yr = time.localtime().tm_year
        cache_key = (self._state_version, cur_yr, int(premieres_count or 0))
        cached = self._sections_counts_cache
        if cached and cached[0] == cache_key:
            return dict(cached[1])
        with self._state_lock:
            wl_items = list((self.state.get("remote_watchlist_items") or {}).values())
            watched_cnt = len(self.state.get("remote_watched_items") or {})
            never_cnt = len(self.state.get("remote_never_items") or {})
        wl_online_count = sum(
            1
            for v in wl_items
            if isinstance(v, dict)
            and v.get("available_online", True)
            and not v.get("is_unreleased", False)
            and (_safe_year_int(v.get("year")) == 0 or _safe_year_int(v.get("year")) <= cur_yr)
        )
        watching_items = self.get_section_catalog_items(section="watching", media_type_filter="all", query="")
        res = {
            "premieres": int(premieres_count),
            "watching": len(watching_items),
            "watchlist": wl_online_count,
            "watched": watched_cnt,
            "never": never_cnt,
        }
        self._sections_counts_cache = (cache_key, res)
        return dict(res)

    def get_section_catalog_items(
        self,
        section: str,
        media_type_filter: str = "all",
        query: str = "",
        include_caught_up: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        Converts all synced Kinorium items from a given section:
        - `watching` / `now` («Смотрю»)
        - `watchlist` / `future` («Буду смотреть»)
        - `watched` / `done` («Просмотрено»)
        - `never` / `not_watching` («Не буду смотреть»)
        into full, playable Velarium catalog items with high-resolution Kinorium posters.
        """
        sec_map = {
            "watching": "remote_watching_items",
            "now": "remote_watching_items",
            "watchlist": "remote_watchlist_items",
            "future": "remote_watchlist_items",
            "watched": "remote_watched_items",
            "done": "remote_watched_items",
            "never": "remote_never_items",
            "not_watching": "remote_never_items",
        }
        state_key = sec_map.get(section)
        if not state_key:
            return []

        with self._state_lock:
            raw_dict = self.state.get(state_key) or {}
            raw_entries = list(raw_dict.items())
        q_norm = _norm_title(query)
        items_out: List[Dict[str, Any]] = []

        cur_yr = time.localtime().tm_year
        for kid, entry in raw_entries:
            # In 'watchlist' («Буду смотреть»), hide movies/series that are not yet released online
            if section in ("watchlist", "future"):
                yr_check = int(entry.get("year") or 0)
                if (
                    entry.get("available_online") is False
                    or entry.get("is_unreleased") is True
                    or (yr_check and yr_check > cur_yr)
                ):
                    continue

            mtype = entry.get("media_type", "movie")
            if media_type_filter in ("movie", "series") and mtype != media_type_filter:
                continue

            ru_t = entry.get("ru_title", "")
            orig_t = entry.get("orig_title", "") or ru_t
            if not ru_t and not orig_t:
                continue
            if q_norm:
                if q_norm not in _norm_title(ru_t) and q_norm not in _norm_title(orig_t):
                    continue

            item_id = f"kin_{kid}" if str(kid).isdigit() else str(kid)
            kr_rating = float(entry.get("kinorium_rating") or 7.8)
            im_rating = float(entry.get("imdb_rating") or kr_rating)
            k_status = self.get_item_status(
                item_id=item_id,
                base_kinorium_rating=kr_rating,
                title=ru_t,
                orig_title=orig_t,
            )
            if section in ("watched", "done") and not k_status.get("watched"):
                continue
            if section in ("watchlist", "future") and not k_status.get("in_watchlist"):
                continue
            if section in ("watching", "now"):
                if not k_status.get("watching") and not (include_caught_up and k_status.get("watched")):
                    continue
                if not include_caught_up and self.is_item_fully_watched_or_caught_up(k_status, media_type=mtype):
                    continue
            if section in ("never", "not_watching"):
                if not k_status.get("not_watching") or k_status.get("watched") or k_status.get("user_rating"):
                    continue
            critics_val = entry.get("critics_rating")
            if critics_val is None and k_status.get("critics_rating") is not None:
                critics_val = k_status["critics_rating"]
            ratings_out: Dict[str, Any] = {
                "kinorium": kr_rating,
                "imdb": im_rating,
            }
            if critics_val is not None:
                ratings_out["critics"] = int(critics_val)

            item_obj: Dict[str, Any] = {
                "id": item_id,
                "kinorium_id": str(kid) if str(kid).isdigit() else "",
                "title": ru_t,
                "orig_title": orig_t,
                "title_pl": orig_t,
                "year": entry.get("year") or "",
                "media_type": mtype,
                "seasons_count": entry.get("seasons_count") or 1,
                "episodes_per_season": entry.get("episodes_per_season") or (0 if mtype == "series" else 1),
                "genres": entry.get("genres") or (["Сериал"] if mtype == "series" else ["Фильм"]),
                "description": entry.get("description") or f"{ru_t} ({orig_t})",
                "poster": entry.get("poster") or (f"https://ru-images.kinorium.com/movie/600/{kid}.jpg" if str(kid).isdigit() else ""),
                "poster_en": entry.get("poster_en") or (f"https://en-images.kinorium.com/movie/600/{kid}.jpg" if str(kid).isdigit() else ""),
                "backdrop": entry.get("backdrop") or (f"https://ru-images.kinorium.com/movie/1080/{kid}.jpg" if str(kid).isdigit() else ""),
                "ambient_color": "#1e293b",
                "ratings": ratings_out,
                "providers": [
                    {"id": "hdrezka", "available": True, "quality": "1080p", "audio": "RU/EN"},
                    {"id": "backup4k", "available": True, "quality": "4K Remux", "audio": "RU/EN"},
                ],
                "kinorium": k_status,
            }
            if entry.get("rezka_id"):
                item_obj["rezka_id"] = entry["rezka_id"]
            if entry.get("rezka_url"):
                item_obj["rezka_url"] = entry["rezka_url"]
            items_out.append(item_obj)
        return items_out

    def _maybe_auto_complete_series(
        self,
        item_id: str,
        title: str,
        orig_title: str = "",
        season: int = 1,
        episode: int = 1,
        total_seasons: int = 0,
        total_episodes_in_season: int = 0,
        is_series_completed: Optional[bool] = None,
        allow_unpromoted: bool = False,
        **extra,
    ) -> bool:
        """
        If a series is completed/ended, currently has status 'Смотрю' (`watching == True`)
        (or `allow_unpromoted=True` during episode completion),
        and the user finished watching the final episode of the final season, automatically
        switch its status from 'Смотрю' to 'Просмотрено' (`watched = True`, `watching = False`).
        """
        cur_status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        if cur_status.get("watched") or cur_status.get("not_watching"):
            return False
        if not cur_status.get("watching") and not allow_unpromoted:
            return False

        kid = cur_status.get("kinorium_id")
        live_meta = self.get_series_live_meta(item_id=item_id, title=title, orig_title=orig_title, kid=kid)
        if live_meta and live_meta.get("not_found"):
            return False

        meta_has_flag = bool(live_meta and "is_completed" in live_meta)
        meta_completed = bool(live_meta and live_meta.get("is_completed"))
        if meta_has_flag and not meta_completed:
            return False
        effective_completed = meta_completed or bool(is_series_completed is True)
        if not effective_completed:
            return False

        final_season = 0
        final_episode = 0
        if live_meta:
            smap = live_meta.get("seasons_map")
            if isinstance(smap, dict) and smap:
                s_nums = [int(k) for k in smap.keys() if str(k).isdigit() and smap.get(k)]
                if s_nums:
                    final_season = max(s_nums)
                    ep_vals = [int(e) for e in (smap.get(str(final_season)) or []) if str(e).isdigit()]
                    if ep_vals:
                        final_episode = max(ep_vals)
            if (final_season <= 0 or final_episode <= 0) and live_meta.get("latest_season") and live_meta.get("latest_episode"):
                final_season = int(live_meta.get("latest_season") or 0)
                final_episode = int(live_meta.get("latest_episode") or 0)

        totals_from_client = False
        if (final_season <= 0 or final_episode <= 0) and total_seasons > 0 and total_episodes_in_season > 0:
            if int(season) == int(total_seasons):
                final_season = int(total_seasons)
                final_episode = int(total_episodes_in_season)
                totals_from_client = True

        if final_season <= 0 or final_episode <= 0:
            return False

        if totals_from_client:
            if final_season == 1 and final_episode == 1:
                # 1/1 is the client default when totals are unknown — never treat it as a finale
                return False
            # No server-side episode map: client-reported totals (which default to 1/1) alone must not
            # complete a whole series. Require that most earlier episodes of the final season were watched.
            we_map = cur_status.get("watched_episodes") if isinstance(cur_status.get("watched_episodes"), dict) else {}
            watched_in_final = {
                int(e) for e in (we_map.get(str(final_season)) or []) if str(e).isdigit() and int(e) < final_episode
            }
            if final_episode > 1 and len(watched_in_final) < max(1, (final_episode - 1) // 2):
                return False

        remote_item = self._resolve_remote_item(item_id, title, orig_title)
        if remote_item:
            if remote_item.get("is_unreleased"):
                return False
            rem_seasons = int(remote_item.get("seasons_count") or 0)
            if rem_seasons > final_season:
                return False

        if int(season) != final_season or int(episode) < final_episode:
            return False

        extra_payload = dict(extra)
        extra_payload.setdefault("media_type", "series")
        self.mark_watched(
            item_id=item_id,
            title=title,
            orig_title=orig_title,
            watched=True,
            season=int(season),
            episode=int(episode),
            auto_scrobbled=True,
            **extra_payload,
        )
        return True

    def update_progress_and_scrobble(
        self,
        item_id: str,
        title: str,
        orig_title: str = "",
        poster: str = "",
        backdrop: str = "",
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        current_time: float = 0,
        duration: float = 1,
        source: str = "HDRezka",
        studio: str = "HDRezka Studio",
        total_seasons: int = 1,
        total_episodes_in_season: int = 1,
        is_series_completed: Optional[bool] = None,
        force_watched: bool = False,
        reason: str = "",
    ) -> Dict[str, Any]:
        start_pid = self._profile_id
        progress = min(1.0, max(0.0, current_time / max(1.0, duration)))
        threshold = float(self.state["account"].get("auto_scrobble_threshold", 0.95))
        watching_threshold = 0.10
        should_mark_watched = bool(force_watched or progress >= threshold)
        nr = _norm_title(title)
        kid_hint = self._resolve_kinorium_id(item_id, title, orig_title, allow_network=False)

        with self._state_lock:
            cur_cw_snap = list(self.state.get("continue_watching", []))
        prev_cw_entries = [
            x
            for x in cur_cw_snap
            if x.get("id") == item_id
            or (kid_hint and x.get("id") == f"kin_{kid_hint}")
            or (nr and _norm_title(x.get("title", "")) == nr)
        ]
        prev_cw_item = prev_cw_entries[0] if prev_cw_entries else None
        new_cw_head: Optional[Dict[str, Any]] = None

        just_scrobbled = False
        just_scrobbled_episode = False
        auto_completed_series = False
        promoted_to_watching = False
        remote_ep_synced = False
        remote_movie_synced = False
        remote_watching_synced = False
        cur_status = self.get_item_status(item_id, title=title, orig_title=orig_title)
        already_watched = bool(cur_status.get("watched"))

        if should_mark_watched:
            if media_type == "series":
                prev_season_eps = (cur_status.get("watched_episodes") or {}).get(str(int(season)), [])
                already_ep_watched = int(episode) in prev_season_eps
                kid_resolved = self._resolve_kinorium_id(
                    item_id,
                    title,
                    orig_title,
                    allow_network=True,
                    media_type="series",
                )
                if self._profile_id != start_pid:
                    return self.get_item_status(item_id, title=title, orig_title=orig_title)
                self._record_episode_watched(
                    item_id,
                    title,
                    orig_title,
                    season,
                    episode,
                    resolved_kid=kid_resolved,
                )
                if not already_ep_watched:
                    just_scrobbled_episode = True
                auto_completed_series = self._maybe_auto_complete_series(
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    season=season,
                    episode=episode,
                    total_seasons=total_seasons,
                    total_episodes_in_season=total_episodes_in_season,
                    is_series_completed=is_series_completed,
                    allow_unpromoted=True,
                    poster=poster,
                    backdrop=backdrop,
                    media_type="series",
                )
                if auto_completed_series:
                    just_scrobbled = True
                else:
                    promoted_to_watching, remote_watching_synced = self._promote_to_watching_with_status(
                        item_id=item_id,
                        title=title,
                        orig_title=orig_title,
                        kid=kid_resolved,
                        poster=poster,
                        backdrop=backdrop,
                        media_type="series",
                    )
                    # Check if there is a next episode in this season or next season
                    has_more_in_season = total_episodes_in_season > 1 and episode < total_episodes_in_season
                    has_more_seasons = total_seasons > 1 and season < total_seasons
                    if has_more_in_season or has_more_seasons:
                        next_s = season if has_more_in_season else season + 1
                        next_e = (episode + 1) if has_more_in_season else 1
                        cw_entry = {
                            "id": item_id,
                            "title": title,
                            "orig_title": orig_title,
                            "poster": poster,
                            "backdrop": backdrop,
                            "media_type": media_type,
                            "season": next_s,
                            "episode": next_e,
                            "current_time": 0.0,
                            "duration": round(duration, 1),
                            "progress": 0.0,
                            "is_new_episode": False,
                            "is_auto_next": True,
                            "source": source,
                            "studio": studio,
                            "updated_at": int(time.time()),
                        }
                        new_cw_head = cw_entry
                if kid_resolved:
                    target_by_season: Dict[int, List[int]] = {int(season): [int(episode)]}
                    has_dirty_or_unsynced = False
                    with self._state_lock:
                        er_root = self.state.get("episode_ratings") or {}
                        dirty_set = set(str(k) for k in (self.state.get("dirty_episode_series") or []) if k)
                        for k_lookup in filter(None, [item_id, f"kin_{kid_resolved}"]):
                            if k_lookup in dirty_set:
                                has_dirty_or_unsynced = True
                            er_sub = er_root.get(k_lookup)
                            if isinstance(er_sub, dict):
                                for ep_entry in er_sub.values():
                                    if isinstance(ep_entry, dict) and ep_entry.get("remote_synced") is not True:
                                        has_dirty_or_unsynced = True
                                        break
                    if (
                        not already_ep_watched
                        or not self._is_episode_cached_remote_done(kid_resolved, int(season), int(episode))
                    ):
                        remote_ep_synced, _ = self._sync_episodes_map_to_kinorium_remote(
                            kid=kid_resolved,
                            item_id=item_id,
                            target_by_season=target_by_season,
                        )
                    if not remote_ep_synced or has_dirty_or_unsynced:
                        self._run_remote_sync_bg(
                            self.reconcile_series_episodes,
                            item_id=item_id,
                            title=title,
                            orig_title=orig_title,
                            kid=kid_resolved,
                            force_refresh=not remote_ep_synced,
                        )
            else:
                # Finished movie (95% or credits started) -> mark watched and move out of 'Смотрю' / Up Next
                if self._profile_id == start_pid and not already_watched and not cur_status.get("not_watching"):
                    watched_res = self.mark_watched(
                        item_id=item_id,
                        title=title,
                        orig_title=orig_title,
                        auto_scrobbled=True,
                        poster=poster,
                        backdrop=backdrop,
                        media_type="movie",
                    )
                    remote_movie_synced = bool(watched_res.get("remote_synced"))
                    just_scrobbled = True
        else:
            if self._profile_id == start_pid and progress >= watching_threshold and not already_watched and not cur_status.get("watching") and not cur_status.get("not_watching"):
                promoted_to_watching, remote_watching_synced = self._promote_to_watching_with_status(
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    kid=kid_hint,
                    poster=poster,
                    backdrop=backdrop,
                    media_type=media_type,
                )

            if current_time >= 15.0 or progress >= 0.02:
                # If this series has unsynced local episodes or episode ratings from earlier playback,
                # opportunistically reconcile them in the background while the user is watching.
                if media_type == "series" and not self.is_ip_cooldown_active():
                    needs_bg_ep_reconcile = False
                    with self._state_lock:
                        dirty_set = set(str(k) for k in (self.state.get("dirty_episode_series") or []) if k)
                        er_root = self.state.get("episode_ratings") or {}
                        for k_chk in filter(None, [item_id, f"kin_{kid_hint}" if kid_hint else ""]):
                            if k_chk in dirty_set:
                                needs_bg_ep_reconcile = True
                                break
                            er_sub = er_root.get(k_chk)
                            if isinstance(er_sub, dict):
                                for ep_entry in er_sub.values():
                                    if isinstance(ep_entry, dict) and ep_entry.get("remote_synced") is not True:
                                        needs_bg_ep_reconcile = True
                                        break
                            if needs_bg_ep_reconcile:
                                break
                    if needs_bg_ep_reconcile:
                        now_reconcile_ts = time.time()
                        reconcile_cache = getattr(self, "_live_ep_reconcile_ts", None)
                        if not isinstance(reconcile_cache, dict):
                            reconcile_cache = {}
                            self._live_ep_reconcile_ts = reconcile_cache
                        rec_key = str(kid_hint or item_id or title)
                        if now_reconcile_ts - float(reconcile_cache.get(rec_key) or 0.0) >= 45.0:
                            reconcile_cache[rec_key] = now_reconcile_ts
                            self._run_remote_sync_bg(
                                self.reconcile_series_episodes,
                                item_id=item_id,
                                title=title,
                                orig_title=orig_title,
                                kid=kid_hint,
                            )
                # Do not re-insert a movie that was already marked watched during credits (>=70%)
                skip_cw_reinsert = False
                if media_type != "series" and already_watched and progress >= 0.70:
                    skip_cw_reinsert = True
                elif media_type == "series":
                    prev_season_eps = (cur_status.get("watched_episodes") or {}).get(str(int(season)), [])
                    if int(episode) in prev_season_eps and progress >= 0.70 and isinstance(prev_cw_item, dict):
                        prev_pair = (int(prev_cw_item.get("season") or 0), int(prev_cw_item.get("episode") or 0))
                        if prev_pair > (int(season), int(episode)):
                            new_cw_head = prev_cw_item
                            skip_cw_reinsert = True
                if not skip_cw_reinsert:
                    cw_entry = {
                        "id": item_id,
                        "title": title,
                        "orig_title": orig_title,
                        "poster": poster,
                        "backdrop": backdrop,
                        "media_type": media_type,
                        "season": season,
                        "episode": episode,
                        "current_time": round(current_time, 1),
                        "duration": round(duration, 1),
                        "progress": round(progress, 3),
                        "is_new_episode": False,
                        "source": source,
                        "studio": studio,
                        "updated_at": int(time.time()),
                    }
                    new_cw_head = cw_entry

        cw_snap: List[Dict[str, Any]] = []
        if self._profile_id == start_pid:
            should_save_cw = False
            with self._state_lock:
                if self._profile_id == start_pid:
                    should_save_cw = True
                    live_cw = [
                        x
                        for x in self.state.get("continue_watching", [])
                        if x.get("id") != item_id
                        and (not kid_hint or x.get("id") != f"kin_{kid_hint}")
                        and (not nr or _norm_title(x.get("title", "")) != nr)
                    ]
                    if new_cw_head is not None:
                        live_cw.insert(0, new_cw_head)
                    self.state["continue_watching"] = live_cw[:12]
                    if not auto_completed_series and not (media_type != "series" and (just_scrobbled or (already_watched and progress >= 0.70))) and (current_time >= 15.0 or progress >= 0.02):
                        dismissed = self.state.get("cw_dismissed") or []
                        kin_prefixed = f"kin_{kid_hint}" if kid_hint else ""
                        if dismissed:
                            self.state["cw_dismissed"] = [
                                d
                                for d in dismissed
                                if d != item_id
                                and (not kin_prefixed or d != kin_prefixed)
                                and (not nr or d != f"title:{nr}")
                            ]
                        stash = self.state.get("cw_dismissed_entries")
                        if isinstance(stash, dict) and stash:
                            stash.pop(item_id, None)
                            if kin_prefixed:
                                stash.pop(kin_prefixed, None)
                            if nr:
                                stash.pop(f"title:{nr}", None)
                    cw_snap = list(self.state["continue_watching"])
            if should_save_cw:
                is_milestone = bool(just_scrobbled or just_scrobbled_episode or auto_completed_series or promoted_to_watching)
                self._save_state(immediate=is_milestone, bump_version=is_milestone)
        if should_mark_watched:
            eff_remote_synced = remote_ep_synced if media_type == "series" else remote_movie_synced
        elif promoted_to_watching:
            eff_remote_synced = remote_watching_synced
        else:
            eff_remote_synced = False
        out: Dict[str, Any] = {
            "progress": round(progress, 3),
            "threshold": threshold,
            "watching_threshold": watching_threshold,
            "reason": reason or ("watched_threshold" if should_mark_watched else ""),
            "just_scrobbled": just_scrobbled,
            "just_scrobbled_episode": just_scrobbled_episode,
            "auto_scrobbled": bool(just_scrobbled or just_scrobbled_episode),
            "auto_completed_series": auto_completed_series,
            "promoted_to_watching": promoted_to_watching,
            "remote_synced": eff_remote_synced,
            "scrobbled_season": int(season),
            "scrobbled_episode": int(episode),
            "continue_watching": cw_snap,
            "kinorium_status": self.get_item_status(item_id, title=title, orig_title=orig_title),
        }
        if just_scrobbled or auto_completed_series or promoted_to_watching:
            out["kinorium_counts"] = self.get_sections_counts()
        return out

    dismiss_continue_watching = dismiss_continue_watching
    restore_continue_watching = restore_continue_watching
    _ensure_remote_entry_template = _ensure_remote_entry_template
    _record_episode_watched = _record_episode_watched
    _unrecord_episode_watched = _unrecord_episode_watched
    _run_remote_sync_bg = _run_remote_sync_bg
    mark_episodes_batch = mark_episodes_batch
    toggle_episode_watched = toggle_episode_watched
    get_profile_stats = get_profile_stats
    mark_watched = mark_watched
    set_rating = set_rating
    set_episode_rating = set_episode_rating
    toggle_watchlist = toggle_watchlist
    toggle_watching = toggle_watching
    toggle_not_watching = toggle_not_watching
    configure_account = configure_account
    _promote_to_watching_with_status = _promote_to_watching_with_status
    _promote_to_watching_if_needed = _promote_to_watching_if_needed
    _promote_series_to_watching_if_needed = _promote_series_to_watching_if_needed

    parse_series_episodes_html = staticmethod(parse_series_episodes_html)

    _is_episode_cached_remote_done = _is_episode_cached_remote_done
    _merge_remote_episodes_into_local = _merge_remote_episodes_into_local
    fetch_series_episodes_state = fetch_series_episodes_state
    _post_episode_status_remote = _post_episode_status_remote
    _sync_episodes_map_to_kinorium_remote = _sync_episodes_map_to_kinorium_remote
    reconcile_series_episodes = reconcile_series_episodes
    reconcile_local_statuses_to_remote = reconcile_local_statuses_to_remote
    reconcile_all_local_episodes = reconcile_all_local_episodes
    _sync_to_kinorium_remote = _sync_to_kinorium_remote
