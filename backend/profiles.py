import hmac
import json
import os
import re
import shutil
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from .storage_db import get_storage_db, set_private_file_permissions


_KIDS_PRIMARY_SAFE_GENRE_KEYWORDS = (
    "мульт",
    "семейн",
    "детск",
    "сказк",
    "animation",
    "animated",
    "family",
    "kids",
    "children",
)

_KIDS_SAFE_GENRE_KEYWORDS = (
    "мульт",
    "семейн",
    "детск",
    "приключ",
    "фэнтези",
    "комеди",
    "сказк",
    "animation",
    "animated",
    "family",
    "kids",
    "children",
    "adventure",
    "fantasy",
    "comedy",
)

_KIDS_BLOCKED_GENRE_KEYWORDS = (
    "ужас",
    "хоррор",
    "триллер",
    "криминал",
    "эротик",
    "для взрослых",
    "военн",
    "нуар",
    "биограф",
    "horror",
    "thriller",
    "crime",
    "erotic",
    "adult",
    "war",
    "slasher",
    "gore",
    "18+",
    "16+",
)

_KIDS_BLOCKED_TITLE_KEYWORDS = (
    "пила",
    "saw ",
    "заклятие",
    "conjuring",
    "астрал",
    "insidious",
    "пацаны",
    "the boys",
    "игра престолов",
    "game of thrones",
    "дом дракона",
    "house of the dragon",
    "эйфория",
    "euphoria",
    "во все тяжкие",
    "breaking bad",
    "гангстерленд",
    "mobland",
    "сегун",
    "shogun",
    "рипли",
    "ripley",
    "разделение",
    "severance",
    "черное зеркало",
    "black mirror",
    "дэдпул",
    "deadpool",
    "субстанция",
    "the substance",
    "американский психопат",
    "american psycho",
    "молчание ягнят",
    "silence of the lambs",
    "семь",
    "se7en",
    "рик и морти",
    "rick and morty",
    "южный парк",
    "south park",
    "гриффины",
    "family guy",
    "любовь, смерть и роботы",
    "любовь смерть и роботы",
    "love, death & robots",
    "love death and robots",
    "аркейн",
    "arcane",
    "отель хазбин",
    "hazbin hotel",
    "адский босс",
    "helluva boss",
    "неуязвимый",
    "invincible",
    "конь боджек",
    "bojack horseman",
    "американский папаша",
    "american dad",
    "полный расколбас",
    "sausage party",
)

_KIDS_AGE_R_RE = re.compile(r"(?<![a-z0-9])r(?![a-z0-9])")
_KIDS_SAFE_AGE_RE = re.compile(
    r"(?<![a-z0-9\-])(?:0\+|6\+|12\+|g|pg|tv-y|tv-y7|tv-g)(?![a-z0-9\-])"
)
_KIDS_BLOCKED_TITLE_SHORT_SET = {
    "семь",
    "пила",
    "saw",
    "рипли",
    "ripley",
    "сегун",
    "shogun",
    "аркейн",
    "arcane",
    "неуязвимый",
    "invincible",
}
_KIDS_BLOCKED_TITLE_SHORT_RE = re.compile(
    r"(?<![а-яa-z0-9])(?:пила|saw|рипли|ripley|сегун|shogun|аркейн|arcane|неуязвимый|invincible)(?![а-яa-z0-9])"
)
_KIDS_BLOCKED_SEVEN_RE = re.compile(r"(?<![а-яa-z0-9])семь(?![а-яa-z0-9])")
_KIDS_BLOCKED_TITLE_SUBSTR_KEYWORDS = tuple(
    k for k in _KIDS_BLOCKED_TITLE_KEYWORDS if k.strip() not in _KIDS_BLOCKED_TITLE_SHORT_SET
)
_KIDS_BLOCKED_GENRE_WORD_RE = re.compile(r"\b(?:war|crime|gore|adult)\b")
_KIDS_BLOCKED_GENRE_SUBSTR_KEYWORDS = tuple(
    g for g in _KIDS_BLOCKED_GENRE_KEYWORDS if g not in ("war", "crime", "gore", "adult")
)
_PLACEHOLDER_USER_ID_RE = re.compile(r"^(?:user|id)[_\-\s]*\d+$")


def _is_placeholder_kinorium_name(val: Any, uid: str = "") -> bool:
    s = str(val or "").strip()
    if not s:
        return True
    low = s.lower()
    if low in ("не подключен", "not connected", "kinorium", "кинориум", "профиль", "profile"):
        return True
    if s.isdigit() or (uid and s == str(uid).strip()):
        return True
    if low.startswith(("http://", "https://", "user/")) or "kinorium.com" in low:
        return True
    if _PLACEHOLDER_USER_ID_RE.match(low):
        return True
    return False

_AVATAR_COLORS = (
    "#0A84FF",
    "#30D158",
    "#FF9F0A",
    "#BF5AF2",
    "#FF375F",
    "#64D2FF",
    "#5E5CE6",
    "#FFD60A",
)

_AUDIO_PREF_VALUES = ("auto", "ru_dub", "original")


class ProfileManager:
    """
    Multi-profile manager for Velarium ('Личный', 'Семейный', 'Детский', plus custom profiles).
    Guarantees 100% backward compatibility with the primary root `data/kinorium_state.json`
    for the `'main'` profile while isolating secondary profiles in `data/profiles/<id>/`.
    """

    def __init__(self, data_dir: str):
        self.data_dir = os.path.abspath(data_dir)
        os.makedirs(self.data_dir, exist_ok=True)
        set_private_file_permissions(self.data_dir, is_dir=True)
        self.profiles_dir = os.path.join(self.data_dir, "profiles")
        os.makedirs(self.profiles_dir, exist_ok=True)
        set_private_file_permissions(self.profiles_dir, is_dir=True)
        self.manifest_path = os.path.join(self.data_dir, "profiles.json")
        self._lock = threading.RLock()
        self._pin_attempts: Dict[str, Tuple[int, float]] = {}
        self._db = get_storage_db(self.data_dir)
        self._load_pin_attempts()
        self._state = self._load_manifest()

    def _load_pin_attempts(self) -> None:
        try:
            raw = self._db.get_kv("profiles", "pin_attempts")
            if isinstance(raw, dict):
                loaded: Dict[str, Tuple[int, float]] = {}
                for k, v in raw.items():
                    pid = self._sanitize_profile_id(str(k or ""))
                    if pid and isinstance(v, (list, tuple)) and len(v) == 2:
                        try:
                            failures = max(0, int(v[0] or 0))
                            lock_until = max(0.0, float(v[1] or 0.0))
                            if failures > 0 or lock_until > 0.0:
                                loaded[pid] = (failures, lock_until)
                        except (TypeError, ValueError):
                            continue
                self._pin_attempts = loaded
        except Exception:
            self._pin_attempts = {}

    def _save_pin_attempts_locked(self) -> None:
        try:
            serializable = {
                pid: [int(fails), float(until)]
                for pid, (fails, until) in self._pin_attempts.items()
                if int(fails) > 0 or float(until) > 0.0
            }
            self._db.set_kv("profiles", "pin_attempts", serializable)
        except Exception:
            pass

    @staticmethod
    def _default_profiles_list() -> List[Dict[str, Any]]:
        now_ts = int(time.time())
        return [
            {
                "id": "main",
                "name": "Личный",
                "name_en": "Personal",
                "custom_name": False,
                "avatar_color": "#0A84FF",
                "icon": "user",
                "kids_mode": False,
                "default_audio_pref": "auto",
                "is_default": True,
                "builtin": True,
                "created_at": now_ts,
            },
            {
                "id": "family",
                "name": "Семейный",
                "name_en": "Family",
                "custom_name": False,
                "avatar_color": "#30D158",
                "icon": "users",
                "kids_mode": False,
                "default_audio_pref": "ru_dub",
                "is_default": False,
                "builtin": True,
                "created_at": now_ts,
            },
            {
                "id": "kids",
                "name": "Детский",
                "name_en": "Kids",
                "custom_name": False,
                "avatar_color": "#FF9F0A",
                "icon": "star",
                "kids_mode": True,
                "default_audio_pref": "ru_dub",
                "is_default": False,
                "builtin": True,
                "created_at": now_ts,
            },
        ]

    def _load_manifest(self) -> Dict[str, Any]:
        defaults = self._default_profiles_list()
        state: Dict[str, Any] = {
            "active_profile_id": "main",
            "profiles": defaults,
        }
        loaded: Optional[Dict[str, Any]] = None
        try:
            db_val = self._db.get_kv("profiles", "manifest")
            if isinstance(db_val, dict):
                loaded = db_val
        except Exception:
            loaded = None

        if loaded is None and os.path.isfile(self.manifest_path):
            try:
                with open(self.manifest_path, "r", encoding="utf-8") as f:
                    raw_f = json.load(f)
                if isinstance(raw_f, dict):
                    loaded = raw_f
            except Exception:
                loaded = None

        if isinstance(loaded, dict):
            try:
                raw_profiles = loaded.get("profiles")
                if isinstance(raw_profiles, list) and raw_profiles:
                    cleaned: List[Dict[str, Any]] = []
                    seen_ids = set()
                    for entry in raw_profiles:
                        if not isinstance(entry, dict):
                            continue
                        pid = self._sanitize_profile_id(str(entry.get("id") or ""))
                        if not pid or pid in seen_ids:
                            continue
                        seen_ids.add(pid)
                        cleaned.append(self._normalize_profile_dict(entry, pid))
                    if "main" not in seen_ids:
                        cleaned.insert(0, defaults[0])
                    state["profiles"] = cleaned
                act_id = str(loaded.get("active_profile_id") or "main").strip()
                valid_ids = {p["id"] for p in state["profiles"]}
                state["active_profile_id"] = act_id if act_id in valid_ids else "main"
            except Exception:
                pass
        self._save_manifest_locked(state)
        return state

    @staticmethod
    def _sanitize_profile_id(raw_id: str) -> str:
        s = re.sub(r"[^a-zA-Z0-9_-]+", "", (raw_id or "").strip().lower())
        return s[:32]

    @staticmethod
    def _normalize_profile_dict(raw: Dict[str, Any], forced_id: Optional[str] = None) -> Dict[str, Any]:
        pid = forced_id or ProfileManager._sanitize_profile_id(str(raw.get("id") or "")) or "main"
        is_main = pid == "main"
        audio_pref = str(raw.get("default_audio_pref") or "auto").strip().lower()
        if audio_pref not in _AUDIO_PREF_VALUES:
            audio_pref = "auto"
        color = str(raw.get("avatar_color") or "#0A84FF").strip()
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            color = "#0A84FF"
        def_ru, def_en = ProfileManager._BUILTIN_DEFAULT_NAMES.get(pid, (pid.capitalize(), pid.capitalize()))
        name_ru = str(raw.get("name") or def_ru).strip()[:28] or "Профиль"
        name_en = str(raw.get("name_en") or name_ru).strip()[:28] or name_ru
        has_custom_name = bool(raw.get("custom_name", False))
        if _is_placeholder_kinorium_name(name_ru) and name_ru not in ("Профиль", "Profile"):
            name_ru = def_ru
            name_en = def_en
            has_custom_name = False
        icon = str(raw.get("icon") or ("star" if raw.get("kids_mode") else "user")).strip()
        if icon not in ("user", "users", "star", "film"):
            icon = "user"
        is_kids = False if is_main and not raw.get("kids_mode") else bool(raw.get("kids_mode", False))
        raw_pin = re.sub(r"\D+", "", str(raw.get("kids_pin") or ""))
        clean_pin = raw_pin if (is_kids and len(raw_pin) == 4) else ""
        ephemeral_locked = bool(is_kids and not clean_pin and raw.get("kids_pin_locked_ephemeral", False))
        try:
            created_ts = int(float(raw.get("created_at") or time.time()))
        except Exception:
            created_ts = int(time.time())
        out_prof = {
            "id": pid,
            "name": name_ru,
            "name_en": name_en,
            "custom_name": has_custom_name,
            "avatar_color": color,
            "icon": icon,
            "kids_mode": is_kids,
            "kids_pin": clean_pin,
            "default_audio_pref": audio_pref,
            "is_default": is_main,
            "builtin": pid in ("main", "family", "kids"),
            "created_at": created_ts,
        }
        if ephemeral_locked:
            out_prof["kids_pin_locked_ephemeral"] = True
        return out_prof

    def _save_manifest_locked(self, state_obj: Optional[Dict[str, Any]] = None) -> None:
        target = state_obj if state_obj is not None else self._state
        try:
            self._db.set_kv("profiles", "manifest", target)
        except Exception:
            pass

    def get_kinorium_state_path(self, profile_id: Optional[str] = None) -> str:
        with self._lock:
            pid = self._sanitize_profile_id(profile_id or self._state.get("active_profile_id") or "main") or "main"
        if pid == "main":
            return os.path.join(self.data_dir, "kinorium_state.json")
        prof_dir = os.path.join(self.profiles_dir, pid)
        os.makedirs(prof_dir, exist_ok=True)
        return os.path.join(prof_dir, "kinorium_state.json")

    def _read_profile_kinorium_summary(
        self,
        profile_id: str,
        live_kinorium_service: Optional[Any] = None,
    ) -> Dict[str, Any]:
        def _normalize_summary(acc_obj: Dict[str, Any]) -> Dict[str, Any]:
            uid = str(acc_obj.get("user_id") or "").strip()
            conn = bool(acc_obj.get("connected") and uid)
            av = str(acc_obj.get("avatar_url") or "").strip()
            if av and "/user/180/" in av:
                av = av.replace("/user/180/", "/user/200/")
            if conn and uid.isdigit():
                av = f"/api/kinorium/avatar?uid={uid}"
            raw_dn = str(acc_obj.get("display_name") or "").strip()
            if _is_placeholder_kinorium_name(raw_dn, uid):
                raw_dn = "Andrei Crustillio" if (uid == "51670" and conn) else ""
            try:
                w_cnt = int(float(acc_obj.get("watched_count") or 0))
            except Exception:
                w_cnt = 0
            return {
                "connected": bool(acc_obj.get("connected")),
                "user_id": uid,
                "display_name": raw_dn,
                "avatar_url": av if conn else "",
                "watched_count": w_cnt,
            }

        active_id = self.get_active_profile_id()
        if live_kinorium_service is not None and profile_id == active_id:
            acc = live_kinorium_service.get_account_summary()
            return _normalize_summary(acc if isinstance(acc, dict) else {})
        try:
            acc_db = self._db.get_profile_section(profile_id, "account")
            if isinstance(acc_db, dict):
                return _normalize_summary(acc_db)
        except Exception:
            pass
        st_path = self.get_kinorium_state_path(profile_id)
        if not os.path.isfile(st_path):
            return {"connected": False, "user_id": "", "display_name": "", "avatar_url": "", "watched_count": 0}
        try:
            with open(st_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            acc = (raw.get("account") or {}) if isinstance(raw, dict) else {}
            return _normalize_summary(acc if isinstance(acc, dict) else {})
        except Exception:
            return {"connected": False, "user_id": "", "display_name": "", "avatar_url": "", "watched_count": 0}

    def format_profile_for_client(
        self,
        prof: Dict[str, Any],
        lang: str = "ru",
        live_kinorium_service: Optional[Any] = None,
    ) -> Dict[str, Any]:
        out = dict(prof)
        raw_pin = str(out.pop("kids_pin", "") or "")
        eph_locked = bool(out.pop("kids_pin_locked_ephemeral", False))
        out["has_kids_pin"] = bool(out.get("kids_mode") and (len(raw_pin) == 4 or eph_locked))
        k_sum = self._read_profile_kinorium_summary(
            out["id"],
            live_kinorium_service=live_kinorium_service,
        )
        k_uid = str(k_sum.get("user_id") or "").strip()
        if (
            k_uid == "51670"
            and bool(k_sum.get("connected"))
            and _is_placeholder_kinorium_name(k_sum.get("display_name"), k_uid)
        ):
            k_sum["display_name"] = "Andrei Crustillio"
        out["kinorium_summary"] = k_sum

        kin_disp = str(k_sum.get("display_name") or "").strip()
        is_clean_kin_name = bool(
            bool(k_sum.get("connected"))
            and kin_disp
            and not _is_placeholder_kinorium_name(kin_disp, k_uid)
        )
        has_custom = bool(out.get("custom_name"))
        curr_name = str(out.get("name") or "").strip()
        is_generic_name = curr_name in ("Личный", "Personal", "Профиль", "Profile", "")

        if not out.get("kids_mode") and is_clean_kin_name and (not has_custom or is_generic_name):
            out["display_label"] = kin_disp
        elif lang == "en" and not out.get("custom_name") and out.get("name_en"):
            out["display_label"] = out["name_en"]
        else:
            out["display_label"] = out["name"]

        # Ensure display_label is never a raw URL or user_ ID
        lbl = str(out["display_label"] or "").strip()
        if _is_placeholder_kinorium_name(lbl, k_uid) and lbl not in ("Профиль", "Profile"):
            if is_clean_kin_name:
                out["display_label"] = kin_disp
            else:
                def_ru, def_en = self._BUILTIN_DEFAULT_NAMES.get(str(out.get("id") or ""), ("Профиль", "Profile"))
                out["display_label"] = def_en if lang == "en" else def_ru

        initials_src = out["display_label"].strip()
        parts = [p for p in initials_src.split() if p]
        if len(parts) >= 2:
            out["initials"] = (parts[0][0] + parts[1][0]).upper()
        elif initials_src:
            out["initials"] = initials_src[:2].upper()
        else:
            out["initials"] = "CF"
        return out

    def get_active_profile_id(self) -> str:
        with self._lock:
            return str(self._state.get("active_profile_id") or "main")

    def get_active_profile(
        self,
        lang: str = "ru",
        live_kinorium_service: Optional[Any] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            act_id = str(self._state.get("active_profile_id") or "main")
            found = next((p for p in self._state["profiles"] if p["id"] == act_id), None)
            if not found:
                found = self._state["profiles"][0]
            found_copy = dict(found)
        return self.format_profile_for_client(found_copy, lang=lang, live_kinorium_service=live_kinorium_service)

    def get_profiles_payload(
        self,
        lang: str = "ru",
        live_kinorium_service: Optional[Any] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            act_id = str(self._state.get("active_profile_id") or "main")
            raw_profiles = [dict(p) for p in self._state["profiles"]]
        items = [
            self.format_profile_for_client(p, lang=lang, live_kinorium_service=live_kinorium_service)
            for p in raw_profiles
        ]
        active_obj = next((p for p in items if p["id"] == act_id), items[0] if items else None)
        return {
            "ok": True,
            "active_profile_id": act_id,
            "active_profile": active_obj,
            "profiles": items,
        }

    _BUILTIN_DEFAULT_NAMES = {
        "main": ("Личный", "Personal"),
        "family": ("Семейный", "Family"),
        "kids": ("Детский", "Kids"),
    }

    def is_active_kids_pin_locked(self) -> bool:
        with self._lock:
            act_id = str(self._state.get("active_profile_id") or "main")
            active = next((p for p in self._state["profiles"] if p["id"] == act_id), None)
            if not active or not active.get("kids_mode"):
                return False
            return len(str(active.get("kids_pin") or "")) == 4 or bool(active.get("kids_pin_locked_ephemeral"))

    def requires_pin_to_leave_active_kids(self, target_profile_id: str) -> bool:
        clean_target = self._sanitize_profile_id(target_profile_id)
        with self._lock:
            act_id = str(self._state.get("active_profile_id") or "main")
            if clean_target == act_id:
                return False
            active = next((p for p in self._state["profiles"] if p["id"] == act_id), None)
            if not active or not active.get("kids_mode"):
                return False
            active_pin = str(active.get("kids_pin") or "")
            if len(active_pin) != 4 and not active.get("kids_pin_locked_ephemeral"):
                return False
            return True

    PIN_MAX_ATTEMPTS = 5
    PIN_LOCKOUT_SECONDS = 30.0

    def get_pin_lockout_remaining(self, profile_id: Optional[str] = None) -> int:
        with self._lock:
            pid = self._sanitize_profile_id(profile_id or self._state.get("active_profile_id") or "main")
            failures, lock_until = self._pin_attempts.get(pid, (0, 0.0))
            now = time.time()
            if lock_until > now:
                return max(1, int(round(lock_until - now)))
            if lock_until > 0:
                self._pin_attempts[pid] = (failures, 0.0)
                self._save_pin_attempts_locked()
            return 0

    def reset_pin_attempts(self, profile_id: Optional[str] = None) -> None:
        with self._lock:
            if profile_id is None:
                self._pin_attempts.clear()
            else:
                pid = self._sanitize_profile_id(profile_id)
                self._pin_attempts.pop(pid, None)
            self._save_pin_attempts_locked()

    def _record_pin_failure(self, profile_id: Optional[str] = None) -> None:
        with self._lock:
            pid = self._sanitize_profile_id(profile_id or self._state.get("active_profile_id") or "main") or "main"
            now = time.time()
            failures, _ = self._pin_attempts.get(pid, (0, 0.0))
            failures += 1
            if failures >= self.PIN_MAX_ATTEMPTS and failures % self.PIN_MAX_ATTEMPTS == 0:
                tier = failures // self.PIN_MAX_ATTEMPTS - 1
                lock_secs = min(3600.0, self.PIN_LOCKOUT_SECONDS * (2 ** tier))
                self._pin_attempts[pid] = (failures, now + lock_secs)
            else:
                self._pin_attempts[pid] = (failures, 0.0)
            self._save_pin_attempts_locked()

    def verify_active_kids_pin(self, pin: str, profile_id: Optional[str] = None) -> bool:
        candidate = str(pin or "").strip()
        with self._lock:
            if profile_id is not None:
                pid = self._sanitize_profile_id(profile_id)
                if not pid:
                    return False
                prof = next((p for p in self._state["profiles"] if p["id"] == pid), None)
                if not prof:
                    return False
            else:
                pid = self._sanitize_profile_id(self._state.get("active_profile_id") or "main")
                prof = next((p for p in self._state["profiles"] if p["id"] == pid), None)
                if not prof:
                    return True
            if not prof.get("kids_mode"):
                return True
            expected = str(prof.get("kids_pin") or "")
            if len(expected) != 4:
                if prof.get("kids_pin_locked_ephemeral"):
                    return False
                return True

            now = time.time()
            failures, lock_until = self._pin_attempts.get(pid, (0, 0.0))
            if lock_until > now:
                return False
            # Failures are NOT reset after a lockout: each further batch of wrong PINs doubles
            # the lockout (30 s → 60 s → 2 min … capped at 1 h), so 10 000 PINs can't be brute-forced.

            matched = bool(
                len(candidate) == 4
                and hmac.compare_digest(candidate.encode("utf-8"), expected.encode("utf-8"))
            )
            if matched:
                if self._pin_attempts.pop(pid, None) is not None:
                    self._save_pin_attempts_locked()
                return True

            # Only count non-empty wrong PIN guesses towards brute-force lockout
            # (empty PIN probes are initial UI/API checks asking whether a PIN prompt is needed)
            if candidate:
                failures += 1
                if failures >= self.PIN_MAX_ATTEMPTS and failures % self.PIN_MAX_ATTEMPTS == 0:
                    tier = failures // self.PIN_MAX_ATTEMPTS - 1
                    lock_secs = min(3600.0, self.PIN_LOCKOUT_SECONDS * (2 ** tier))
                    self._pin_attempts[pid] = (failures, now + lock_secs)
                else:
                    self._pin_attempts[pid] = (failures, 0.0)
                self._save_pin_attempts_locked()
            return False

    @staticmethod
    def _redact_profile_dict(prof: Dict[str, Any]) -> Dict[str, Any]:
        out = dict(prof)
        raw_pin = str(out.pop("kids_pin", "") or "")
        eph_locked = bool(out.pop("kids_pin_locked_ephemeral", False))
        out["has_kids_pin"] = bool(out.get("kids_mode") and (len(raw_pin) == 4 or eph_locked))
        return out

    def switch_profile(self, profile_id: str, pin: str = "") -> Dict[str, Any]:
        clean_id = self._sanitize_profile_id(profile_id)
        with self._lock:
            target = next((p for p in self._state["profiles"] if p["id"] == clean_id), None)
            if not target:
                raise ValueError(f"Profile '{profile_id}' not found")
            if self.requires_pin_to_leave_active_kids(clean_id):
                if not self.verify_active_kids_pin(pin):
                    raise PermissionError("PIN_REQUIRED")
            self._state["active_profile_id"] = target["id"]
            self._save_manifest_locked()
            return self._redact_profile_dict(target)

    def save_profile(
        self,
        profile_id: str = "",
        name: str = "",
        avatar_color: str = "",
        kids_mode: Optional[bool] = None,
        kids_pin: Optional[str] = None,
        default_audio_pref: Optional[str] = None,
        icon: str = "",
        pin: str = "",
    ) -> Dict[str, Any]:
        parsed_pin: Optional[str] = None
        if kids_pin is not None:
            raw_pin_str = str(kids_pin).strip()
            if raw_pin_str in ("", "__clear__"):
                parsed_pin = ""
            elif re.fullmatch(r"\d{4}", raw_pin_str):
                parsed_pin = raw_pin_str
            else:
                raise ValueError("PIN-код должен состоять ровно из 4 цифр")

        with self._lock:
            raw_id_supplied = str(profile_id or "").strip()
            clean_id = self._sanitize_profile_id(raw_id_supplied)
            if raw_id_supplied and not clean_id:
                raise ValueError("Некорректный идентификатор профиля")
            if self.is_active_kids_pin_locked():
                if not self.verify_active_kids_pin(pin):
                    raise PermissionError("PIN_REQUIRED")
            existing = next((p for p in self._state["profiles"] if p["id"] == clean_id), None) if clean_id else None
            if existing:
                existing_pin_locked = bool(
                    existing.get("kids_mode") and len(str(existing.get("kids_pin") or "")) == 4
                )
                if existing_pin_locked and (kids_mode is not None or parsed_pin is not None):
                    if not self.verify_active_kids_pin(pin, profile_id=existing["id"]):
                        raise PermissionError("PIN_REQUIRED")
                if name.strip():
                    clean_nm = name.strip()[:28]
                    builtin_pair = self._BUILTIN_DEFAULT_NAMES.get(existing["id"])
                    if builtin_pair and clean_nm.lower() in (builtin_pair[0].lower(), builtin_pair[1].lower()):
                        existing["name"] = builtin_pair[0]
                        existing["name_en"] = builtin_pair[1]
                        existing["custom_name"] = False
                    else:
                        existing["name"] = clean_nm
                        existing["name_en"] = clean_nm
                        existing["custom_name"] = True
                if avatar_color and re.fullmatch(r"#[0-9a-fA-F]{6}", avatar_color.strip()):
                    existing["avatar_color"] = avatar_color.strip()
                if kids_mode is not None:
                    existing["kids_mode"] = bool(kids_mode)
                    if not existing["kids_mode"]:
                        existing["kids_pin"] = ""
                    if self._pin_attempts.pop(existing["id"], None) is not None:
                        self._save_pin_attempts_locked()
                if parsed_pin is not None:
                    existing["kids_pin"] = parsed_pin if existing.get("kids_mode") else ""
                    if self._pin_attempts.pop(existing["id"], None) is not None:
                        self._save_pin_attempts_locked()
                if default_audio_pref and default_audio_pref in _AUDIO_PREF_VALUES:
                    existing["default_audio_pref"] = default_audio_pref
                if icon in ("user", "users", "star", "film"):
                    existing["icon"] = icon
                self._save_manifest_locked()
                return self._redact_profile_dict(existing)

            if len(self._state["profiles"]) >= 8:
                raise ValueError("Достигнут лимит профилей (максимум 8)")
            clean_nm = (name or "").strip()[:28]
            if not clean_nm:
                raise ValueError("Укажите имя профиля")
            if clean_id == "main":
                clean_id = ""
            new_id = clean_id or f"prof_{int(time.time() * 1000) % 100000000}"
            existing_ids = {p["id"] for p in self._state["profiles"]}
            suffix = 1
            base_id = new_id
            while new_id in existing_ids or new_id == "main":
                suffix += 1
                new_id = f"{base_id}_{suffix}"
            chosen_color = (
                avatar_color.strip()
                if (avatar_color and re.fullmatch(r"#[0-9a-fA-F]{6}", avatar_color.strip()))
                else _AVATAR_COLORS[len(self._state["profiles"]) % len(_AVATAR_COLORS)]
            )
            is_kids = bool(kids_mode)
            chosen_audio = (
                default_audio_pref
                if (default_audio_pref in _AUDIO_PREF_VALUES)
                else ("ru_dub" if is_kids else "auto")
            )
            chosen_icon = icon if icon in ("user", "users", "star", "film") else ("star" if is_kids else "user")
            created = {
                "id": new_id,
                "name": clean_nm,
                "name_en": clean_nm,
                "custom_name": True,
                "avatar_color": chosen_color,
                "icon": chosen_icon,
                "kids_mode": is_kids,
                "kids_pin": (parsed_pin or "") if is_kids else "",
                "default_audio_pref": chosen_audio,
                "is_default": False,
                "builtin": False,
                "created_at": int(time.time()),
            }
            self._state["profiles"].append(created)
            os.makedirs(os.path.join(self.profiles_dir, new_id), exist_ok=True)
            self._save_manifest_locked()
            return self._redact_profile_dict(created)

    def export_profiles_bundle(self, redact_secrets: bool = False) -> Dict[str, Any]:
        with self._lock:
            act_id = str(self._state.get("active_profile_id") or "main")
            exported_profiles: List[Dict[str, Any]] = []
            secondary_states: Dict[str, Any] = {}
            for p in self._state["profiles"]:
                p_copy = dict(p)
                if redact_secrets:
                    p_copy.pop("kids_pin", None)
                exported_profiles.append(p_copy)
                pid = p["id"]
                if pid == "main":
                    continue
                raw_st: Optional[Dict[str, Any]] = None
                try:
                    raw_st = self._db.load_profile_state(pid)
                except Exception:
                    raw_st = None
                if raw_st is None:
                    st_path = self.get_kinorium_state_path(pid)
                    if os.path.isfile(st_path):
                        try:
                            with open(st_path, "r", encoding="utf-8") as sf:
                                loaded_f = json.load(sf)
                            if isinstance(loaded_f, dict):
                                raw_st = loaded_f
                        except Exception:
                            raw_st = None
                if isinstance(raw_st, dict):
                    if redact_secrets and isinstance(raw_st.get("account"), dict):
                        raw_st = dict(raw_st)
                        acc_copy = dict(raw_st["account"])
                        acc_copy.pop("session_cookie", None)
                        acc_copy.pop("auth_token", None)
                        raw_st["account"] = acc_copy
                    secondary_states[pid] = raw_st
            return {
                "active_profile_id": act_id,
                "profiles": exported_profiles,
                "secondary_kinorium_states": secondary_states,
            }

    def has_any_kids_pin_locked_profile(self) -> Optional[str]:
        with self._lock:
            act_id = str(self._state.get("active_profile_id") or "main")
            active = next((p for p in self._state["profiles"] if p["id"] == act_id), None)
            if active and active.get("kids_mode") and (
                len(str(active.get("kids_pin") or "")) == 4 or bool(active.get("kids_pin_locked_ephemeral"))
            ):
                return act_id
            for p in self._state["profiles"]:
                if p.get("kids_mode") and (
                    len(str(p.get("kids_pin") or "")) == 4 or bool(p.get("kids_pin_locked_ephemeral"))
                ):
                    return str(p["id"])
            return None

    def has_any_kids_pin(self) -> bool:
        return bool(self.has_any_kids_pin_locked_profile())

    def verify_any_kids_pin(self, pin: str) -> bool:
        with self._lock:
            locked_pid = self.has_any_kids_pin_locked_profile()
            if not locked_pid:
                return True
            return self.verify_active_kids_pin(pin, profile_id=locked_pid)

    def import_profiles_bundle(
        self,
        bundle: Optional[Dict[str, Any]],
        redact_secrets: bool = False,
        enforce_pin: bool = False,
        pin: str = "",
    ) -> Dict[str, Any]:
        if not isinstance(bundle, dict):
            return {"restored_profiles_count": len(self._state.get("profiles") or [])}
        with self._lock:
            if enforce_pin:
                locked_pid = self.has_any_kids_pin_locked_profile()
                if locked_pid and not self.verify_active_kids_pin(pin, profile_id=locked_pid):
                    raise PermissionError("PIN_REQUIRED")

            old_profiles_by_id = {p["id"]: dict(p) for p in (self._state.get("profiles") or []) if isinstance(p, dict) and p.get("id")}
            old_ids = set(old_profiles_by_id.keys())

            raw_profiles = bundle.get("profiles")
            if isinstance(raw_profiles, list) and raw_profiles:
                defaults = self._default_profiles_list()
                cleaned: List[Dict[str, Any]] = []
                seen_ids = set()
                for entry in raw_profiles:
                    if not isinstance(entry, dict):
                        continue
                    pid = self._sanitize_profile_id(str(entry.get("id") or ""))
                    if not pid or pid in seen_ids:
                        continue
                    seen_ids.add(pid)
                    norm = self._normalize_profile_dict(entry, pid)
                    prev_prof = old_profiles_by_id.get(pid)
                    prev_pin = str((prev_prof or {}).get("kids_pin") or "")
                    if redact_secrets:
                        norm["kids_pin"] = prev_pin if (norm.get("kids_mode") and len(prev_pin) == 4) else ""
                    elif norm.get("kids_mode") and not norm.get("kids_pin") and len(prev_pin) == 4 and "kids_pin" not in entry:
                        norm["kids_pin"] = prev_pin
                    cleaned.append(norm)
                if "main" not in seen_ids:
                    cleaned.insert(0, defaults[0])
                self._state["profiles"] = cleaned[:8]

            valid_ids = {p["id"] for p in self._state["profiles"]}
            orphan_ids = {oid for oid in (old_ids - valid_ids) if oid and oid != "main"}
            pin_dirty = False
            for orphan_id in orphan_ids:
                if self._pin_attempts.pop(orphan_id, None) is not None:
                    pin_dirty = True
                try:
                    self._db.delete_profile_state(orphan_id)
                except Exception:
                    pass
                orphan_dir = os.path.join(self.profiles_dir, orphan_id)
                if os.path.isdir(orphan_dir):
                    shutil.rmtree(orphan_dir, ignore_errors=True)
            if pin_dirty:
                self._save_pin_attempts_locked()

            act_id = self._sanitize_profile_id(str(bundle.get("active_profile_id") or "main"))
            self._state["active_profile_id"] = act_id if act_id in valid_ids else "main"
            self._save_manifest_locked()

            sec_states = bundle.get("secondary_kinorium_states")
            if isinstance(sec_states, dict):
                for pid_raw, st_data in sec_states.items():
                    pid = self._sanitize_profile_id(str(pid_raw or ""))
                    if not pid or pid == "main" or pid not in valid_ids or not isinstance(st_data, dict):
                        continue
                    prev_acc: Dict[str, Any] = {}
                    try:
                        loaded_acc = self._db.get_profile_section(pid, "account")
                        if isinstance(loaded_acc, dict):
                            prev_acc = loaded_acc
                    except Exception:
                        prev_acc = {}
                    safe_st = dict(st_data)
                    if isinstance(safe_st.get("account"), dict):
                        acc_c = dict(safe_st["account"])
                        same_uid = bool(
                            prev_acc.get("user_id")
                            and str(prev_acc.get("user_id")).strip() == str(acc_c.get("user_id") or "").strip()
                        )
                        if redact_secrets:
                            acc_c.pop("session_cookie", None)
                            acc_c.pop("auth_token", None)
                            if same_uid:
                                if prev_acc.get("session_cookie"):
                                    acc_c["session_cookie"] = prev_acc["session_cookie"]
                                if prev_acc.get("auth_token"):
                                    acc_c["auth_token"] = prev_acc["auth_token"]
                        elif same_uid:
                            if not acc_c.get("session_cookie") and "session_cookie" not in safe_st["account"] and prev_acc.get("session_cookie"):
                                acc_c["session_cookie"] = prev_acc["session_cookie"]
                            if not acc_c.get("auth_token") and "auth_token" not in safe_st["account"] and prev_acc.get("auth_token"):
                                acc_c["auth_token"] = prev_acc["auth_token"]
                        safe_st["account"] = acc_c
                    self.get_kinorium_state_path(pid)
                    try:
                        self._db.delete_profile_state(pid)
                    except Exception:
                        pass
                    try:
                        self._db.save_profile_state(pid, safe_st, {})
                    except Exception:
                        pass
            return {
                "restored_profiles_count": len(self._state["profiles"]),
                "active_profile_id": self._state["active_profile_id"],
            }

    def delete_profile(self, profile_id: str, pin: str = "") -> bool:
        clean_id = self._sanitize_profile_id(profile_id)
        if not clean_id or clean_id == "main":
            raise ValueError("Основной профиль нельзя удалить")
        with self._lock:
            if self.is_active_kids_pin_locked():
                if not self.verify_active_kids_pin(pin):
                    raise PermissionError("PIN_REQUIRED")
            target = next((p for p in self._state["profiles"] if p["id"] == clean_id), None)
            if not target:
                return False
            if target.get("kids_mode") and len(str(target.get("kids_pin") or "")) == 4:
                if not self.verify_active_kids_pin(pin, profile_id=clean_id):
                    raise PermissionError("PIN_REQUIRED")
            self._state["profiles"] = [p for p in self._state["profiles"] if p["id"] != clean_id]
            if self._pin_attempts.pop(clean_id, None) is not None:
                self._save_pin_attempts_locked()
            if self._state.get("active_profile_id") == clean_id:
                self._state["active_profile_id"] = "main"
            try:
                self._db.delete_profile_state(clean_id)
            except Exception:
                pass
            prof_dir = os.path.join(self.profiles_dir, clean_id)
            self._save_manifest_locked()
            if os.path.isdir(prof_dir):
                shutil.rmtree(prof_dir, ignore_errors=True)
        return True

    def is_kids_mode_active(self) -> bool:
        with self._lock:
            act_id = str(self._state.get("active_profile_id") or "main")
            found = next((p for p in self._state["profiles"] if p["id"] == act_id), None)
            return bool(found and found.get("kids_mode"))

    @staticmethod
    def is_item_kids_safe(item: Dict[str, Any]) -> bool:
        if not isinstance(item, dict):
            return False
        age_str = str(item.get("age_rating") or item.get("mpaa") or "").strip().lower()
        if age_str:
            if (
                "18+" in age_str
                or "16+" in age_str
                or "14+" in age_str
                or "13+" in age_str
                or "pg-13" in age_str
                or "pg13" in age_str
                or "nc-17" in age_str
                or "tv-ma" in age_str
                or "tv-14" in age_str
                or _KIDS_AGE_R_RE.search(age_str)
            ):
                return False

        title_blob = (
            f"{item.get('title') or ''} {item.get('orig_title') or ''} {item.get('ru_title') or ''}"
            .lower()
            .replace("ё", "е")
        )
        if _KIDS_BLOCKED_TITLE_SHORT_RE.search(title_blob):
            return False
        if (
            "семь" in title_blob
            and "гномов" not in title_blob
            and "чудес" not in title_blob
            and _KIDS_BLOCKED_SEVEN_RE.search(title_blob)
        ):
            return False
        for bad_t in _KIDS_BLOCKED_TITLE_SUBSTR_KEYWORDS:
            if bad_t in title_blob:
                return False

        raw_genres = list(item.get("genres") or []) + list(item.get("genres_en") or [])
        info_hint = str(item.get("info") or item.get("category") or "").strip()
        genre_blob = " | ".join(str(g or "").lower().replace("ё", "е") for g in raw_genres)
        combined_genre_info = f"{genre_blob} | {info_hint.lower().replace('ё', 'е')}".strip(" |")
        if _KIDS_BLOCKED_GENRE_WORD_RE.search(combined_genre_info):
            return False
        for bad_g in _KIDS_BLOCKED_GENRE_SUBSTR_KEYWORDS:
            if bad_g in combined_genre_info:
                return False

        desc_low = (
            f"{item.get('description') or ''} {item.get('description_en') or ''}"
            .lower()
            .replace("ё", "е")
        )
        if any(
            bad_d in desc_low
            for bad_d in (
                "убийств",
                "маньяк",
                "наркот",
                "насили",
                "эротик",
                "порно",
                "18+",
                "16+",
                "horror",
                "serial killer",
                "gore",
                "erotic",
            )
        ):
            return False

        if genre_blob:
            if any(ok_g in genre_blob for ok_g in _KIDS_PRIMARY_SAFE_GENRE_KEYWORDS):
                return True
            if any(ok_g in genre_blob for ok_g in _KIDS_SAFE_GENRE_KEYWORDS):
                # Secondary genres (comedy/adventure/fantasy without family/animation/kids)
                # pass unless marked with adult Drama/Sci-Fi-only maturity signals
                if age_str and _KIDS_SAFE_AGE_RE.search(age_str):
                    return True
                if not any(m in combined_genre_info for m in ("драма", "drama", "мелодрам", "romance", "детектив", "mystery")):
                    return True
            return False

        if info_hint:
            info_low = info_hint.lower().replace("ё", "е")
            if any(ok_g in info_low for ok_g in _KIDS_PRIMARY_SAFE_GENRE_KEYWORDS):
                return True
            if any(ok_g in info_low for ok_g in _KIDS_SAFE_GENRE_KEYWORDS) and any(
                k in info_low for k in ("0+", "6+", "12+")
            ):
                return True

        return any(
            ok_w in desc_low
            for ok_w in ("мульт", "семейн", "детск", "приключ", "сказк", "family", "animated", "children")
        )

    @classmethod
    def filter_items_for_kids(cls, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not isinstance(items, list):
            return []
        return [it for it in items if cls.is_item_kids_safe(it)]

    @classmethod
    def filter_catalog_payload_for_kids(cls, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            return payload
        out = dict(payload)
        rejected_ids = set()
        rejected_titles = set()
        allowed_ids = set()
        allowed_titles = set()
        for list_key in ("items", "continue_watching", "similar_pool", "similar_items", "hero_items"):
            raw_list = out.get(list_key)
            if isinstance(raw_list, list):
                filtered_list: List[Dict[str, Any]] = []
                for it in raw_list:
                    if not isinstance(it, dict):
                        continue
                    if cls.is_item_kids_safe(it):
                        filtered_list.append(it)
                        if it.get("id"):
                            allowed_ids.add(str(it["id"]).strip())
                        if it.get("kinorium_id"):
                            allowed_ids.add(str(it["kinorium_id"]).strip())
                            allowed_ids.add(f"kin_{it['kinorium_id']}")
                        for tk in ("title", "orig_title", "ru_title"):
                            tv = str(it.get(tk) or "").strip().lower()
                            if tv:
                                allowed_titles.add(tv)
                    else:
                        if it.get("id"):
                            rejected_ids.add(str(it["id"]).strip())
                        if it.get("kinorium_id"):
                            rejected_ids.add(str(it["kinorium_id"]).strip())
                            rejected_ids.add(f"kin_{it['kinorium_id']}")
                        for tk in ("title", "orig_title", "ru_title"):
                            tv = str(it.get(tk) or "").strip().lower()
                            if tv:
                                rejected_titles.add(tv)
                out[list_key] = filtered_list
                if list_key == "items":
                    out["total"] = len(filtered_list)
        if isinstance(out.get("live_series_updates"), list):
            safe_updates = []
            for u in out["live_series_updates"]:
                if not isinstance(u, dict):
                    continue
                uid = str(u.get("id") or "").strip()
                ukid = str(u.get("kinorium_id") or "").strip()
                ut = str(u.get("title") or "").strip().lower()
                uo = str(u.get("orig_title") or "").strip().lower()
                if (
                    (uid and uid in rejected_ids)
                    or (ukid and ukid in rejected_ids)
                    or (ut and ut in rejected_titles)
                    or (uo and uo in rejected_titles)
                ):
                    continue
                has_own_meta = bool(u.get("genres") or u.get("description") or u.get("age_rating"))
                is_cartoon_url = "/cartoons/" in str(u.get("rezka_url") or "").lower()
                matched_allowed = bool(
                    (uid and uid in allowed_ids)
                    or (ukid and ukid in allowed_ids)
                    or (ut and ut in allowed_titles)
                    or (uo and uo in allowed_titles)
                )
                if has_own_meta:
                    if cls.is_item_kids_safe(u):
                        safe_updates.append(u)
                elif is_cartoon_url or matched_allowed:
                    probe_u = {**u, "genres": ["мультфильм" if is_cartoon_url else "семейный"]}
                    if cls.is_item_kids_safe(probe_u):
                        safe_updates.append(u)
            out["live_series_updates"] = safe_updates
        if isinstance(out.get("hero"), dict) and not cls.is_item_kids_safe(out["hero"]):
            safe_items = out.get("items") if isinstance(out.get("items"), list) else []
            out["hero"] = safe_items[0] if safe_items else None
        return out
