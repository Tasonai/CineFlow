import argparse
import json
import os
import sqlite3
import sys
import time


def apply_app_lang(install_dir: str, app_lang: str) -> None:
    norm_lang = "en" if str(app_lang or "").strip().lower().startswith("en") else "ru"
    data_dir = os.path.join(install_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    settings_path = os.path.join(data_dir, "server_settings.json")
    db_path = os.path.join(data_dir, "cineflow.db")

    payload = {}
    if os.path.isfile(settings_path):
        try:
            with open(settings_path, "r", encoding="utf-8") as fh:
                loaded = json.load(fh)
            if isinstance(loaded, dict):
                payload = loaded
        except Exception:
            payload = {}

    has_sqlite_state = False
    if os.path.isfile(db_path):
        try:
            with sqlite3.connect(db_path, timeout=5.0) as conn:
                row = conn.execute(
                    "SELECT value_json FROM kv_store WHERE namespace = 'server' AND key = 'settings' LIMIT 1"
                ).fetchone()
                if row and row[0]:
                    db_loaded = json.loads(row[0])
                    if isinstance(db_loaded, dict):
                        merged_db = dict(payload)
                        merged_db.update(db_loaded)
                        payload = merged_db
                st_row = conn.execute(
                    "SELECT 1 FROM profile_state WHERE profile_id = 'main' LIMIT 1"
                ).fetchone()
                has_sqlite_state = bool(st_row)
        except Exception:
            pass

    payload["app_lang"] = norm_lang
    kinorium_state_path = os.path.join(data_dir, "kinorium_state.json")
    if not os.path.isfile(kinorium_state_path) and not has_sqlite_state and not payload.get("setup_completed"):
        payload["setup_completed"] = False

    if os.path.isfile(db_path):
        try:
            with sqlite3.connect(db_path, timeout=5.0) as conn:
                conn.execute(
                    """
                    INSERT INTO kv_store (namespace, key, value_json, updated_at)
                    VALUES ('server', 'settings', ?, ?)
                    ON CONFLICT(namespace, key) DO UPDATE SET
                        value_json = excluded.value_json,
                        updated_at = excluded.updated_at
                    """,
                    (json.dumps(payload, ensure_ascii=False), time.time()),
                )
                conn.commit()
        except Exception:
            pass

    tmp_path = f"{settings_path}.{os.getpid()}.tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        os.replace(tmp_path, settings_path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply CineFlow installer preferences")
    parser.add_argument("--install-dir", required=True, help="Target CineFlow installation directory")
    parser.add_argument("--app-lang", default="ru", help="Initial application interface language (ru or en)")
    args = parser.parse_args()
    try:
        apply_app_lang(os.path.abspath(args.install_dir), args.app_lang)
        return 0
    except Exception as exc:
        if sys.stderr is not None:
            sys.stderr.write(f"[CineFlow Setup] Failed to persist app_lang: {exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
