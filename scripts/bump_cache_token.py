#!/usr/bin/env python3
"""
CineFlow Asset Cache Version Bumper.

Atomically updates the frontend asset cache token (?v=YYYYMMDDvNN)
across public/index.html, public/app.js, public/js/*.js, and integrity tests.
"""

import argparse
import datetime
import glob
import os
import re
import sys

DEFAULT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_current_cache_token(root_dir: str = None) -> str:
    root = root_dir or DEFAULT_ROOT
    index_path = os.path.join(root, "public", "index.html")
    if not os.path.isfile(index_path):
        return ""
    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()
    matches = re.findall(r"\?v=([A-Za-z0-9_.-]+)", html)
    return matches[0] if matches else ""


def generate_next_cache_token(current_token: str = None, base_date: str = None) -> str:
    today = base_date or datetime.date.today().strftime("%Y%m%d")
    if not current_token:
        return f"{today}v1"

    m = re.match(r"^(\d{8})v(\d+)$", current_token)
    if m:
        c_date, c_num = m.group(1), int(m.group(2))
        if c_date == today:
            return f"{today}v{c_num + 1}"
        return f"{today}v1"

    return f"{today}v1"


def bump_cache_token(
    new_token: str = None, root_dir: str = None, dry_run: bool = False
) -> dict:
    root = root_dir or DEFAULT_ROOT
    old_token = get_current_cache_token(root)
    if not old_token:
        raise RuntimeError(f"Could not locate current cache token in {root}/public/index.html")

    if not new_token:
        new_token = generate_next_cache_token(old_token)

    old_pattern = f"?v={old_token}"
    new_replacement = f"?v={new_token}"

    targets = []
    pub_index = os.path.join(root, "public", "index.html")
    if os.path.isfile(pub_index):
        targets.append(pub_index)

    pub_app = os.path.join(root, "public", "app.js")
    if os.path.isfile(pub_app):
        targets.append(pub_app)

    targets.extend(sorted(glob.glob(os.path.join(root, "public", "js", "*.js"))))

    test_integrity = os.path.join(root, "tests", "test_frontend_integrity.py")
    if os.path.isfile(test_integrity):
        targets.append(test_integrity)

    updated_files = []
    total_replacements = 0

    for path in targets:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()

        if old_pattern in content:
            count = content.count(old_pattern)
            total_replacements += count
            updated_content = content.replace(old_pattern, new_replacement)
            if not dry_run:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(updated_content)
            updated_files.append((path, count))

    return {
        "old_token": old_token,
        "new_token": new_token,
        "dry_run": dry_run,
        "updated_files": [f[0] for f in updated_files],
        "updated_files_count": len(updated_files),
        "total_replacements": total_replacements,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bump CineFlow frontend asset cache version (?v=...)"
    )
    parser.add_argument("--token", help="Explicit token to set (default: auto-increment)")
    parser.add_argument(
        "--dry-run", action="store_true", help="Preview changes without modifying files"
    )
    parser.add_argument("--root", default=DEFAULT_ROOT, help="Project root directory")

    args = parser.parse_args()

    try:
        res = bump_cache_token(
            new_token=args.token, root_dir=args.root, dry_run=args.dry_run
        )
    except Exception as e:
        print(f"[Error] {e}", file=sys.stderr)
        return 1

    mode = "[DRY-RUN] Would bump" if res["dry_run"] else "[BUMP] Updated"
    print(f"{mode} cache token: {res['old_token']} -> {res['new_token']}")
    print(f"Files modified: {res['updated_files_count']} ({res['total_replacements']} replacements)")
    for p in res["updated_files"]:
        rel = os.path.relpath(p, args.root)
        print(f"  • {rel}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
