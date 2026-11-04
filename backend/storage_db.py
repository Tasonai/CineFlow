import base64
import contextlib
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import sys
import threading
import time
from typing import Any, Dict, Iterator, Optional

_DB_REGISTRY_LOCK = threading.Lock()
_DB_REGISTRY: Dict[str, "CineFlowStorageDB"] = {}


from .vault import LocalVaultCipher, set_private_file_permissions

def _sanitize_for_json(val: Any) -> Any:
    if val is None or isinstance(val, (bool, int, str)):
        return val
    if isinstance(val, float):
        import math
        return None if (math.isnan(val) or math.isinf(val)) else val
    if isinstance(val, dict):
        return {str(k): _sanitize_for_json(v) for k, v in val.items()}
    if isinstance(val, (list, tuple, set, frozenset)):
        return [_sanitize_for_json(x) for x in val]
    if isinstance(val, (bytes, bytearray)):
        return bytes(val).decode("utf-8", errors="replace")
    return str(val)


def _safe_json_dumps(obj: Any, *, sort_keys: bool = False) -> str:
    try:
        return json.dumps(obj, ensure_ascii=False, sort_keys=sort_keys, allow_nan=False)
    except (TypeError, ValueError):
        clean = _sanitize_for_json(obj)
        try:
            return json.dumps(clean, ensure_ascii=False, sort_keys=sort_keys, allow_nan=False)
        except TypeError:
            return json.dumps(clean, ensure_ascii=False, allow_nan=False)


def profile_id_from_state_path(storage_dir: str, state_file: str) -> str:
    norm_storage = os.path.abspath(storage_dir)
    norm_parent = os.path.abspath(os.path.dirname(os.path.abspath(state_file)))
    if norm_parent == norm_storage:
        return "main"
    base = os.path.basename(norm_parent).strip()
    return base if base else "main"


class CineFlowStorageDB:
    """
    Thread-safe SQLite WAL storage engine for CineFlow local state, multi-profile
    isolation, metadata caches, and offline download queue persistence.
    """

    def __init__(self, storage_dir: str) -> None:
        self.storage_dir = os.path.abspath(storage_dir)
        os.makedirs(self.storage_dir, exist_ok=True)
        set_private_file_permissions(self.storage_dir, is_dir=True)
        self.vault = LocalVaultCipher(self.storage_dir)
        self.db_path = os.path.join(self.storage_dir, "cineflow.db")
        try:
            fd = os.open(self.db_path, os.O_CREAT | os.O_RDWR | getattr(os, "O_BINARY", 0), 0o600)
            os.close(fd)
        except Exception:
            pass
        set_private_file_permissions(self.db_path, is_dir=False)
        self._lock = threading.RLock()
        self._tx_depth: int = 0
        self._writer_thread_id: Optional[int] = None
        self._closed: bool = False
        self._profile_section_hashes: Dict[str, Dict[str, str]] = {}
        self._local = threading.local()
        self._read_conns: list = []
        self._read_conns_lock = threading.Lock()
        self._conn = sqlite3.connect(
            self.db_path,
            timeout=10.0,
            check_same_thread=False,
            isolation_level=None,
        )
        self._init_schema()
        set_private_file_permissions(self.db_path, is_dir=False)
        set_private_file_permissions(f"{self.db_path}-wal", is_dir=False)
        set_private_file_permissions(f"{self.db_path}-shm", is_dir=False)

    def _get_read_conn(self) -> Optional[sqlite3.Connection]:
        if self._closed:
            return None
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            return conn
        try:
            conn = sqlite3.connect(
                self.db_path,
                timeout=10.0,
                check_same_thread=True,
                isolation_level=None,
            )
            cur = conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL;")
            cur.execute("PRAGMA synchronous=NORMAL;")
            cur.execute("PRAGMA busy_timeout=10000;")
            cur.execute("PRAGMA temp_store=MEMORY;")
            cur.execute("PRAGMA cache_size=-8000;")
            cur.execute("PRAGMA mmap_size=67108864;")
            cur.execute("PRAGMA query_only=ON;")
            cur.close()
            self._local.conn = conn
            with self._read_conns_lock:
                self._read_conns.append(conn)
            return conn
        except Exception:
            return self._conn if not self._closed else None

    def _reader_conn(self) -> Optional[sqlite3.Connection]:
        if self._closed:
            return None
        if self._tx_depth > 0 and self._writer_thread_id == threading.get_ident():
            return self._conn
        return self._get_read_conn()

    @contextlib.contextmanager
    def _write_tx(self) -> Iterator[None]:
        self._writer_thread_id = threading.get_ident()
        if self._tx_depth > 0:
            sp_name = f"sp_{self._tx_depth}"
            self._conn.execute(f"SAVEPOINT {sp_name};")
            self._tx_depth += 1
            try:
                yield
                self._conn.execute(f"RELEASE SAVEPOINT {sp_name};")
            except BaseException:
                try:
                    self._conn.execute(f"ROLLBACK TO SAVEPOINT {sp_name};")
                    self._conn.execute(f"RELEASE SAVEPOINT {sp_name};")
                except sqlite3.Error:
                    pass
                raise
            finally:
                self._tx_depth -= 1
                if self._tx_depth == 0:
                    self._writer_thread_id = None
            return

        if self._conn.in_transaction:
            try:
                self._conn.execute("ROLLBACK;")
            except sqlite3.Error:
                pass
        self._conn.execute("BEGIN IMMEDIATE;")
        self._tx_depth = 1
        try:
            yield
            self._conn.execute("COMMIT;")
        except BaseException:
            try:
                if self._conn.in_transaction:
                    self._conn.execute("ROLLBACK;")
            except sqlite3.Error:
                pass
            raise
        finally:
            self._tx_depth = 0
            self._writer_thread_id = None

    def close(self) -> None:
        with _DB_REGISTRY_LOCK:
            if _DB_REGISTRY.get(self.storage_dir) is self:
                _DB_REGISTRY.pop(self.storage_dir, None)
        with self._lock:
            self._closed = True
            try:
                if self._conn.in_transaction:
                    self._conn.execute("ROLLBACK;")
            except Exception:
                pass
            try:
                self._conn.execute("PRAGMA optimize;")
                self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            except Exception:
                pass
            try:
                self._conn.close()
            except Exception:
                pass
            with self._read_conns_lock:
                for rconn in self._read_conns:
                    try:
                        rconn.close()
                    except Exception:
                        pass
                self._read_conns.clear()

    @classmethod
    def _preserve_existing_ciphertexts(cls, prev_raw: Any, next_enc: Any) -> Any:
        """
        When `.vault_key` suffered a transient read lock (`vault.is_ephemeral == True`),
        preserve any existing `enc:v1:...` ciphertexts in SQLite whenever the incoming value is empty
        (or auto-regenerated on boot as with `remote_pair_token`) so secrets (`kids_pin`,
        `debrid_api_key`, `remote_pair_token`, `session_cookie`) are never wiped.
        """
        if not isinstance(prev_raw, dict) or not isinstance(next_enc, dict):
            return next_enc
        out = dict(next_enc)
        old_rpt = prev_raw.get("remote_pair_token")
        if isinstance(old_rpt, str) and old_rpt.startswith(LocalVaultCipher.PREFIX):
            out["remote_pair_token"] = old_rpt
        for sk in ("session_cookie", "auth_token"):
            old_v = prev_raw.get(sk)
            if isinstance(old_v, str) and old_v.startswith(LocalVaultCipher.PREFIX):
                out[sk] = old_v
        if isinstance(prev_raw.get("backup_stream"), dict) and isinstance(out.get("backup_stream"), dict):
            old_dk = prev_raw["backup_stream"].get("debrid_api_key")
            if isinstance(old_dk, str) and old_dk.startswith(LocalVaultCipher.PREFIX):
                bkp = dict(out["backup_stream"])
                bkp["debrid_api_key"] = old_dk
                out["backup_stream"] = bkp
        if isinstance(prev_raw.get("account"), dict) and isinstance(out.get("account"), dict):
            acc = dict(out["account"])
            for ak in ("session_cookie", "auth_token"):
                old_av = prev_raw["account"].get(ak)
                if isinstance(old_av, str) and old_av.startswith(LocalVaultCipher.PREFIX):
                    acc[ak] = old_av
            out["account"] = acc
        if isinstance(prev_raw.get("profiles"), list) and isinstance(out.get("profiles"), list):
            old_pins = {
                str(p.get("id") or ""): str(p.get("kids_pin") or "")
                for p in prev_raw["profiles"]
                if isinstance(p, dict) and str(p.get("kids_pin") or "").startswith(LocalVaultCipher.PREFIX)
            }
            if old_pins:
                merged_profs = []
                for p in out["profiles"]:
                    if isinstance(p, dict):
                        pid = str(p.get("id") or "")
                        if pid in old_pins:
                            p_cp = dict(p)
                            p_cp["kids_pin"] = old_pins[pid]
                            merged_profs.append(p_cp)
                        else:
                            merged_profs.append(p)
                    else:
                        merged_profs.append(p)
                out["profiles"] = merged_profs
        return out

    def _encrypt_payload(self, obj: Any) -> Any:
        if not isinstance(obj, dict):
            return obj
        out = dict(obj)
        # 1. Server settings (backup_stream.debrid_api_key, remote_pair_token)
        if "remote_pair_token" in out and out.get("remote_pair_token"):
            out["remote_pair_token"] = self.vault.encrypt_str(str(out["remote_pair_token"]))
        if isinstance(out.get("backup_stream"), dict):
            bkp = dict(out["backup_stream"])
            if bkp.get("debrid_api_key"):
                bkp["debrid_api_key"] = self.vault.encrypt_str(str(bkp["debrid_api_key"]))
            out["backup_stream"] = bkp
        # 2. Kinorium account section (session_cookie, auth_token)
        if "session_cookie" in out and out.get("session_cookie"):
            out["session_cookie"] = self.vault.encrypt_str(str(out["session_cookie"]))
        if "auth_token" in out and out.get("auth_token"):
            out["auth_token"] = self.vault.encrypt_str(str(out["auth_token"]))
        if isinstance(out.get("account"), dict):
            acc = dict(out["account"])
            if acc.get("session_cookie"):
                acc["session_cookie"] = self.vault.encrypt_str(str(acc["session_cookie"]))
            if acc.get("auth_token"):
                acc["auth_token"] = self.vault.encrypt_str(str(acc["auth_token"]))
            out["account"] = acc
        # 3. Profiles manifest (kids_pin inside profiles list)
        if isinstance(out.get("profiles"), list):
            new_profs = []
            for p in out["profiles"]:
                if isinstance(p, dict) and p.get("kids_pin"):
                    p_copy = dict(p)
                    p_copy["kids_pin"] = self.vault.encrypt_str(str(p_copy["kids_pin"]))
                    new_profs.append(p_copy)
                else:
                    new_profs.append(p)
            out["profiles"] = new_profs
        return out

    def _decrypt_payload(self, obj: Any) -> Any:
        if not isinstance(obj, dict):
            return obj
        out = dict(obj)
        if "remote_pair_token" in out and out.get("remote_pair_token"):
            out["remote_pair_token"] = self.vault.decrypt_str(str(out["remote_pair_token"]))
        if isinstance(out.get("backup_stream"), dict):
            bkp = dict(out["backup_stream"])
            if bkp.get("debrid_api_key"):
                bkp["debrid_api_key"] = self.vault.decrypt_str(str(bkp["debrid_api_key"]))
            out["backup_stream"] = bkp
        if "session_cookie" in out and out.get("session_cookie"):
            out["session_cookie"] = self.vault.decrypt_str(str(out["session_cookie"]))
        if "auth_token" in out and out.get("auth_token"):
            out["auth_token"] = self.vault.decrypt_str(str(out["auth_token"]))
        if isinstance(out.get("account"), dict):
            acc = dict(out["account"])
            if acc.get("session_cookie"):
                acc["session_cookie"] = self.vault.decrypt_str(str(acc["session_cookie"]))
            if acc.get("auth_token"):
                acc["auth_token"] = self.vault.decrypt_str(str(acc["auth_token"]))
            out["account"] = acc
        if isinstance(out.get("profiles"), list):
            new_profs = []
            for p in out["profiles"]:
                if isinstance(p, dict) and p.get("kids_pin"):
                    p_copy = dict(p)
                    raw_cipher = str(p_copy["kids_pin"])
                    dec_pin = self.vault.decrypt_str(raw_cipher)
                    p_copy["kids_pin"] = dec_pin
                    if not dec_pin and self.vault.is_ephemeral and raw_cipher.startswith(LocalVaultCipher.PREFIX):
                        p_copy["kids_pin_locked_ephemeral"] = True
                    new_profs.append(p_copy)
                else:
                    new_profs.append(p)
            out["profiles"] = new_profs
        return out

    def _init_schema(self) -> None:
        with self._lock:
            cur = self._conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL;")
            cur.execute("PRAGMA synchronous=NORMAL;")
            cur.execute("PRAGMA busy_timeout=10000;")
            cur.execute("PRAGMA temp_store=MEMORY;")
            cur.execute("PRAGMA cache_size=-16000;")
            cur.execute("PRAGMA mmap_size=67108864;")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS kv_store (
                    namespace TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value_json TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (namespace, key)
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS profile_state (
                    profile_id TEXT NOT NULL,
                    section_key TEXT NOT NULL,
                    value_json TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (profile_id, section_key)
                );
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS cache_entries (
                    cache_name TEXT NOT NULL,
                    entry_key TEXT NOT NULL,
                    value_json TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (cache_name, entry_key)
                );
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_cache_entries_updated ON cache_entries(cache_name, updated_at);"
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS downloads (
                    download_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    payload_json TEXT NOT NULL
                );
                """
            )
            cur.close()

    # ------------------------------------------------------------------
    # Generic Key-Value Store (Settings, Profiles Manifest, Addons)
    # ------------------------------------------------------------------

    def get_kv(self, namespace: str, key: str, default: Any = None) -> Any:
        conn = self._reader_conn()
        if not conn:
            return default
        try:
            with contextlib.closing(
                conn.execute(
                    "SELECT value_json FROM kv_store WHERE namespace = ? AND key = ?",
                    (str(namespace), str(key)),
                )
            ) as cur:
                row = cur.fetchone()
        except sqlite3.Error:
            return default
        if not row:
            return default
        try:
            return self._decrypt_payload(json.loads(row[0]))
        except Exception:
            return default

    def set_kv(self, namespace: str, key: str, value: Any) -> None:
        enc_val = self._encrypt_payload(value)
        now = time.time()
        ns_s, key_s = str(namespace), str(key)
        with self._lock:
            if self._closed:
                return
            if self.vault.is_ephemeral and isinstance(enc_val, dict):
                with contextlib.closing(
                    self._conn.execute(
                        "SELECT value_json FROM kv_store WHERE namespace = ? AND key = ?",
                        (ns_s, key_s),
                    )
                ) as cur:
                    old_row = cur.fetchone()
                if old_row:
                    try:
                        enc_val = self._preserve_existing_ciphertexts(json.loads(old_row[0]), enc_val)
                    except Exception:
                        pass
            payload = _safe_json_dumps(enc_val)
            with self._write_tx():
                self._conn.execute(
                    """
                    INSERT INTO kv_store (namespace, key, value_json, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(namespace, key) DO UPDATE SET
                        value_json = excluded.value_json,
                        updated_at = excluded.updated_at;
                    """,
                    (ns_s, key_s, payload, now),
                )

    def delete_kv(self, namespace: str, key: str) -> None:
        with self._lock:
            if self._closed:
                return
            with self._write_tx():
                self._conn.execute(
                    "DELETE FROM kv_store WHERE namespace = ? AND key = ?",
                    (str(namespace), str(key)),
                )

    # ------------------------------------------------------------------
    # Sectioned Profile State (Kinorium & Watch History per Profile)
    # ------------------------------------------------------------------

    def has_profile_state(self, profile_id: str) -> bool:
        conn = self._reader_conn()
        if not conn:
            return False
        try:
            with contextlib.closing(
                conn.execute(
                    "SELECT 1 FROM profile_state WHERE profile_id = ? LIMIT 1",
                    (str(profile_id),),
                )
            ) as cur:
                row = cur.fetchone()
            return row is not None
        except sqlite3.Error:
            return False

    def load_profile_state(self, profile_id: str) -> Optional[Dict[str, Any]]:
        conn = self._reader_conn()
        if not conn:
            return None
        try:
            with contextlib.closing(
                conn.execute(
                    "SELECT section_key, value_json FROM profile_state WHERE profile_id = ?",
                    (str(profile_id),),
                )
            ) as cur:
                rows = cur.fetchall()
        except sqlite3.Error:
            return None
        if not rows:
            return None
        out: Dict[str, Any] = {}
        for sec_key, val_json in rows:
            try:
                out[str(sec_key)] = self._decrypt_payload(json.loads(val_json))
            except Exception:
                continue
        return out if out else None

    def get_profile_section(self, profile_id: str, section_key: str, default: Any = None) -> Any:
        conn = self._reader_conn()
        if not conn:
            return default
        try:
            with contextlib.closing(
                conn.execute(
                    "SELECT value_json FROM profile_state WHERE profile_id = ? AND section_key = ?",
                    (str(profile_id), str(section_key)),
                )
            ) as cur:
                row = cur.fetchone()
        except sqlite3.Error:
            return default
        if not row:
            return default
        try:
            return self._decrypt_payload(json.loads(row[0]))
        except Exception:
            return default

    def save_profile_state(
        self,
        profile_id: str,
        state_dict: Dict[str, Any],
        last_hashes: Optional[Dict[str, str]] = None,
    ) -> Dict[str, str]:
        pid = str(profile_id)
        now = time.time()
        items_snapshot = list((state_dict or {}).items())
        next_hashes: Dict[str, str] = {}
        computed_sections: Dict[str, Any] = {}

        for sec_key, sec_val in items_snapshot:
            k = str(sec_key)
            plain_serialized = _safe_json_dumps(sec_val, sort_keys=True)
            digest = hashlib.sha1(plain_serialized.encode("utf-8", errors="replace")).hexdigest()
            next_hashes[k] = digest
            computed_sections[k] = sec_val

        with self._lock:
            if self._closed:
                return next_hashes
            caller_prev = last_hashes if isinstance(last_hashes, dict) else {}
            db_prev = self._profile_section_hashes.get(pid)
            existing_db_keys = set()
            if caller_prev and db_prev is not None:
                prev = {
                    k: v
                    for k, v in caller_prev.items()
                    if db_prev.get(k) == v
                }
            elif caller_prev and db_prev is None:
                with contextlib.closing(
                    self._conn.execute(
                        "SELECT section_key FROM profile_state WHERE profile_id = ?",
                        (pid,),
                    )
                ) as cur:
                    existing_db_keys = {str(r[0]) for r in cur.fetchall()}
                prev = {
                    k: v
                    for k, v in caller_prev.items()
                    if k in existing_db_keys
                }
            else:
                prev = {}

            to_upsert = []
            for k, digest in next_hashes.items():
                if prev.get(k) != digest:
                    sec_val = computed_sections[k]
                    enc_sec = self._encrypt_payload(sec_val) if k == "account" else sec_val
                    to_upsert.append((pid, k, enc_sec, now))

            all_prev_keys = set(prev.keys())
            if db_prev is not None:
                all_prev_keys |= set(db_prev.keys())
            elif existing_db_keys:
                all_prev_keys |= existing_db_keys
            removed_keys = [k for k in all_prev_keys if k not in next_hashes]
            if not to_upsert and not removed_keys and prev and next_hashes:
                self._profile_section_hashes[pid] = dict(next_hashes)
                return next_hashes

            serialized_upserts = []
            for u_pid, u_k, u_obj, u_ts in to_upsert:
                eff_obj = u_obj
                if self.vault.is_ephemeral and u_k == "account" and isinstance(eff_obj, dict):
                    with contextlib.closing(
                        self._conn.execute(
                            "SELECT value_json FROM profile_state WHERE profile_id = ? AND section_key = ?",
                            (u_pid, u_k),
                        )
                    ) as cur:
                        old_acc = cur.fetchone()
                    if old_acc:
                        try:
                            eff_obj = self._preserve_existing_ciphertexts(json.loads(old_acc[0]), eff_obj)
                        except Exception:
                            pass
                serialized_upserts.append((u_pid, u_k, _safe_json_dumps(eff_obj, sort_keys=True), u_ts))

            with self._write_tx():
                if not next_hashes:
                    self._conn.execute("DELETE FROM profile_state WHERE profile_id = ?", (pid,))
                else:
                    if serialized_upserts:
                        self._conn.executemany(
                            """
                            INSERT INTO profile_state (profile_id, section_key, value_json, updated_at)
                            VALUES (?, ?, ?, ?)
                            ON CONFLICT(profile_id, section_key) DO UPDATE SET
                                value_json = excluded.value_json,
                                updated_at = excluded.updated_at;
                            """,
                            serialized_upserts,
                        )
                    if removed_keys:
                        for rk in removed_keys:
                            self._conn.execute(
                                "DELETE FROM profile_state WHERE profile_id = ? AND section_key = ?",
                                (pid, rk),
                            )
                    elif not prev:
                        with contextlib.closing(
                            self._conn.execute(
                                "SELECT section_key FROM profile_state WHERE profile_id = ?",
                                (pid,),
                            )
                        ) as cur:
                            existing_keys = [str(r[0]) for r in cur.fetchall()]
                        stale_pairs = [(pid, ek) for ek in existing_keys if ek not in next_hashes]
                        if stale_pairs:
                            self._conn.executemany(
                                "DELETE FROM profile_state WHERE profile_id = ? AND section_key = ?",
                                stale_pairs,
                            )
            self._profile_section_hashes[pid] = dict(next_hashes)
        return next_hashes

    def delete_profile_state(self, profile_id: str) -> None:
        pid = str(profile_id)
        with self._lock:
            if self._closed:
                return
            self._profile_section_hashes.pop(pid, None)
            with self._write_tx():
                self._conn.execute(
                    "DELETE FROM profile_state WHERE profile_id = ?",
                    (pid,),
                )

    # ------------------------------------------------------------------
    # Metadata & Schedule Caches
    # ------------------------------------------------------------------

    def get_cache_entry(self, cache_name: str, entry_key: str, ttl_sec: float = 0.0) -> Any:
        conn = self._reader_conn()
        if not conn:
            return None
        try:
            with contextlib.closing(
                conn.execute(
                    "SELECT value_json, updated_at FROM cache_entries WHERE cache_name = ? AND entry_key = ?",
                    (str(cache_name), str(entry_key)),
                )
            ) as cur:
                row = cur.fetchone()
        except sqlite3.Error:
            return None
        if not row:
            return None
        val_json, updated_at = row
        if ttl_sec > 0 and (time.time() - float(updated_at or 0)) > ttl_sec:
            return None
        try:
            return json.loads(val_json)
        except Exception:
            return None

    def _prune_cache_namespace_locked(self, cache_name: str, max_entries: int = 4000) -> None:
        cname = str(cache_name)
        with contextlib.closing(
            self._conn.execute(
                "SELECT COUNT(*) FROM cache_entries WHERE cache_name = ?",
                (cname,),
            )
        ) as cur:
            row = cur.fetchone()
        total = int(row[0] or 0) if row else 0
        if total <= max_entries + 200:
            return
        self._conn.execute(
            """
            DELETE FROM cache_entries
            WHERE cache_name = ? AND entry_key NOT IN (
                SELECT entry_key FROM cache_entries
                WHERE cache_name = ?
                ORDER BY updated_at DESC
                LIMIT ?
            );
            """,
            (cname, cname, int(max_entries)),
        )

    def set_cache_entry(self, cache_name: str, entry_key: str, value: Any) -> None:
        payload = _safe_json_dumps(value)
        now = time.time()
        with self._lock:
            if self._closed:
                return
            with self._write_tx():
                self._conn.execute(
                    """
                    INSERT INTO cache_entries (cache_name, entry_key, value_json, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(cache_name, entry_key) DO UPDATE SET
                        value_json = excluded.value_json,
                        updated_at = excluded.updated_at;
                    """,
                    (str(cache_name), str(entry_key), payload, now),
                )
                self._prune_cache_namespace_locked(cache_name)

    def set_cache_entries_batch(self, cache_name: str, entries: Dict[str, Any]) -> None:
        if not entries:
            return
        now = time.time()
        rows = [
            (str(cache_name), str(k), _safe_json_dumps(v), now)
            for k, v in entries.items()
        ]
        with self._lock:
            if self._closed:
                return
            with self._write_tx():
                self._conn.executemany(
                    """
                    INSERT INTO cache_entries (cache_name, entry_key, value_json, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(cache_name, entry_key) DO UPDATE SET
                        value_json = excluded.value_json,
                        updated_at = excluded.updated_at;
                    """,
                    rows,
                )
                self._prune_cache_namespace_locked(cache_name)

    def load_cache_dict(self, cache_name: str, max_entries: int = 4000) -> Dict[str, Any]:
        conn = self._reader_conn()
        if not conn:
            return {}
        try:
            with contextlib.closing(
                conn.execute(
                    """
                    SELECT entry_key, value_json FROM cache_entries
                    WHERE cache_name = ?
                    ORDER BY updated_at DESC
                    LIMIT ?
                    """,
                    (str(cache_name), int(max_entries)),
                )
            ) as cur:
                rows = cur.fetchall()
        except sqlite3.Error:
            return {}
        out: Dict[str, Any] = {}
        for k, v_json in reversed(rows):
            try:
                out[str(k)] = json.loads(v_json)
            except Exception:
                continue
        return out

    def save_cache_dict(self, cache_name: str, mapping: Dict[str, Any], max_entries: int = 4000) -> None:
        if not isinstance(mapping, dict):
            return
        cname = str(cache_name)
        items = list(mapping.items())
        if len(items) > max_entries:
            items = items[-max_entries:]
        now = time.time()
        serialized_items = []
        target_keys = set()
        for idx, (k, v) in enumerate(items):
            try:
                sk = str(k)
                serialized_items.append((sk, _safe_json_dumps(v), now + idx * 1e-6))
                target_keys.add(sk)
            except Exception:
                continue
        with self._lock:
            if self._closed:
                return
            with contextlib.closing(
                self._conn.execute(
                    "SELECT entry_key, value_json FROM cache_entries WHERE cache_name = ?",
                    (cname,),
                )
            ) as cur:
                existing_rows = {str(r[0]): str(r[1]) for r in cur.fetchall()}

            to_upsert = [
                (cname, sk, v_json, ts)
                for sk, v_json, ts in serialized_items
                if existing_rows.get(sk) != v_json
            ]
            to_delete = [
                (cname, ek)
                for ek in existing_rows.keys()
                if ek not in target_keys
            ]
            if not to_upsert and not to_delete and (existing_rows or not serialized_items):
                return
            with self._write_tx():
                if not serialized_items:
                    self._conn.execute("DELETE FROM cache_entries WHERE cache_name = ?", (cname,))
                else:
                    if to_delete:
                        self._conn.executemany(
                            "DELETE FROM cache_entries WHERE cache_name = ? AND entry_key = ?",
                            to_delete,
                        )
                    if to_upsert:
                        self._conn.executemany(
                            """
                            INSERT INTO cache_entries (cache_name, entry_key, value_json, updated_at)
                            VALUES (?, ?, ?, ?)
                            ON CONFLICT(cache_name, entry_key) DO UPDATE SET
                                value_json = excluded.value_json,
                                updated_at = excluded.updated_at;
                            """,
                            to_upsert,
                        )

    # ------------------------------------------------------------------
    # Offline Downloads Table
    # ------------------------------------------------------------------

    def has_downloads_rows(self) -> bool:
        conn = self._reader_conn()
        if not conn:
            return False
        try:
            with contextlib.closing(conn.execute("SELECT 1 FROM downloads LIMIT 1")) as cur:
                row = cur.fetchone()
            return row is not None
        except sqlite3.Error:
            return False

    def load_downloads_map(self) -> Dict[str, Dict[str, Any]]:
        conn = self._reader_conn()
        if not conn:
            return {}
        try:
            with contextlib.closing(
                conn.execute("SELECT download_id, payload_json FROM downloads ORDER BY created_at DESC")
            ) as cur:
                rows = cur.fetchall()
        except sqlite3.Error:
            return {}
        out: Dict[str, Dict[str, Any]] = {}
        for dl_id, p_json in rows:
            try:
                rec = json.loads(p_json)
                if isinstance(rec, dict):
                    out[str(dl_id)] = rec
            except Exception:
                continue
        return out

    def replace_all_downloads(self, items_map: Dict[str, Dict[str, Any]]) -> None:
        batch = []
        for dl_id, rec in (items_map or {}).items():
            if not isinstance(rec, dict):
                continue
            status = str(rec.get("status") or "queued")
            created_at = float(rec.get("created_at") or time.time())
            batch.append((str(dl_id), status, created_at, _safe_json_dumps(rec)))
        with self._lock:
            if self._closed:
                return
            with self._write_tx():
                self._conn.execute("DELETE FROM downloads;")
                if batch:
                    self._conn.executemany(
                        "INSERT INTO downloads (download_id, status, created_at, payload_json) VALUES (?, ?, ?, ?)",
                        batch,
                    )

    def upsert_download(self, download_id: str, record: Dict[str, Any]) -> None:
        if not isinstance(record, dict) or not download_id:
            return
        status = str(record.get("status") or "queued")
        created_at = float(record.get("created_at") or time.time())
        payload = _safe_json_dumps(record)
        with self._lock:
            if self._closed:
                return
            with self._write_tx():
                self._conn.execute(
                    """
                    INSERT INTO downloads (download_id, status, created_at, payload_json)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(download_id) DO UPDATE SET
                        status = excluded.status,
                        payload_json = excluded.payload_json;
                    """,
                    (str(download_id), status, created_at, payload),
                )

    def delete_download_record(self, download_id: str) -> None:
        if not download_id:
            return
        with self._lock:
            if self._closed:
                return
            with self._write_tx():
                self._conn.execute("DELETE FROM downloads WHERE download_id = ?;", (str(download_id),))


def get_storage_db(storage_dir: str) -> CineFlowStorageDB:
    norm = os.path.abspath(storage_dir)
    with _DB_REGISTRY_LOCK:
        inst = _DB_REGISTRY.get(norm)
        if inst is None or getattr(inst, "_closed", False):
            inst = CineFlowStorageDB(norm)
            _DB_REGISTRY[norm] = inst
        return inst
