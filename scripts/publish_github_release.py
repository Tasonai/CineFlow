#!/usr/bin/env python3
"""
Publishes a CineFlow release (`vX.Y.Z`) and uploads installer assets from `dist/`
(`CineFlow.dmg`, `CineFlow-Setup-X.Y.Z-x64.exe`, `SHA256SUMS.txt`, `latest.json`)
to GitHub Releases (`https://github.com/Tasonai/CineFlow/releases`).

Reads the GitHub Personal Access Token from `GITHUB_TOKEN` / `GITHUB_PERSONAL_ACCESS_TOKEN`
or `~/.gemini/antigravity/mcp_config.json` (never stored in repository code).
"""

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(BASE_DIR, "dist")
DEFAULT_REPO = "Tasonai/CineFlow"


def _load_github_token() -> str:
    for env_k in ("GITHUB_TOKEN", "GITHUB_PERSONAL_ACCESS_TOKEN", "GH_TOKEN"):
        val = (os.environ.get(env_k) or "").strip()
        if val:
            return val
    mcp_cfg_path = os.path.expanduser("~/.gemini/antigravity/mcp_config.json")
    if os.path.isfile(mcp_cfg_path):
        try:
            with open(mcp_cfg_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            gh_srv = (cfg.get("mcpServers") or {}).get("github") or {}
            tok = ((gh_srv.get("env") or {}).get("GITHUB_PERSONAL_ACCESS_TOKEN") or "").strip()
            if tok:
                return tok
        except Exception:
            pass
    raise RuntimeError("GitHub token not found in environment or ~/.gemini/antigravity/mcp_config.json")


def _detect_app_version() -> str:
    srv_path = os.path.join(BASE_DIR, "server.py")
    with open(srv_path, "r", encoding="utf-8") as f:
        txt = f.read()
    m = re.search(r'^APP_VERSION\s*=\s*"([^"]+)"', txt, re.MULTILINE)
    if not m:
        raise RuntimeError("Could not detect APP_VERSION in server.py")
    return m.group(1).strip()


def _gh_api_json(
    url: str,
    token: str,
    method: str = "GET",
    payload: Optional[Dict[str, Any]] = None,
    timeout: float = 30.0,
) -> Any:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "CineFlow-Release-Publisher",
    }
    if data is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw.strip() else {}


def _ensure_repo_initialized(repo: str, token: str, version: str) -> None:
    """
    Ensures the GitHub repository has at least one commit on `main` so tags/releases can be created.
    """
    try:
        _gh_api_json(f"https://api.github.com/repos/{repo}/commits/main", token)
        return
    except urllib.error.HTTPError as e:
        if e.code not in (404, 409):
            raise
    import base64

    readme_md = (
        f"# CineFlow {version}\n\n"
        "Официальный репозиторий обновлений и установщиков **CineFlow** (macOS & Windows x64).\n\n"
        "- Скачать актуальную версию: [Releases](https://github.com/Tasonai/CineFlow/releases/latest)\n"
    )
    _gh_api_json(
        f"https://api.github.com/repos/{repo}/contents/README.md",
        token,
        method="PUT",
        payload={
            "message": f"Initialize CineFlow release repository ({version})",
            "content": base64.b64encode(readme_md.encode("utf-8")).decode("ascii"),
        },
    )


def publish_release(
    version: Optional[str] = None,
    release_notes: str = "",
    repo: str = DEFAULT_REPO,
) -> Dict[str, Any]:
    token = _load_github_token()
    ver = (version or _detect_app_version()).lstrip("v").strip()
    tag = f"v{ver}"
    title = f"CineFlow {ver}"

    if not release_notes.strip():
        rel_notes_file = os.path.join(BASE_DIR, "RELEASE_NOTES.md")
        if os.path.isfile(rel_notes_file):
            with open(rel_notes_file, "r", encoding="utf-8") as rnf:
                raw_rn = rnf.read().strip()
            if raw_rn:
                release_notes = raw_rn.split("<!-- EN -->")[0].strip()
    if not release_notes.strip():
        release_notes = (
            f"✨ **Что нового в CineFlow {ver}:**\n"
            "• **Защита от блокировки IP на Кинориуме (`403 Forbidden`)**: добавлен умный ограничитель частоты запросов (Rate Limiter) и автоматический предохранитель при временных блокировках, исключающий перегрузку серверов Кинориума фоновыми проверками старых сериалов.\n"
            "• **Гарантированная доотправка отметок и оценок**: все отметки просмотров фильмов, сериалов и оценки эпизодов, поставленные во время офлайна или временной блокировки сети, теперь автоматически доотправляются в ваш профиль Кинориума при восстановлении связи.\n"
            "• **Автоматическое обновление в 1 клик**: проверка новых версий через GitHub Releases, фоновая загрузка установщика с проверкой контрольной суммы SHA-256 и запуск обновления прямо из окна «О программе».\n"
            "• **Точное определение актёров «В кадре» (X-Ray)** и мгновенный запуск локального сервера."
        )

    _ensure_repo_initialized(repo, token, ver)

    # Check if release for this tag already exists
    rel_obj: Optional[Dict[str, Any]] = None
    try:
        rel_obj = _gh_api_json(f"https://api.github.com/repos/{repo}/releases/tags/{tag}", token)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise

    if rel_obj and rel_obj.get("id"):
        rel_id = rel_obj["id"]
        rel_obj = _gh_api_json(
            f"https://api.github.com/repos/{repo}/releases/{rel_id}",
            token,
            method="PATCH",
            payload={
                "tag_name": tag,
                "name": title,
                "body": release_notes,
                "draft": False,
                "prerelease": False,
            },
        )
    else:
        rel_obj = _gh_api_json(
            f"https://api.github.com/repos/{repo}/releases",
            token,
            method="POST",
            payload={
                "tag_name": tag,
                "target_commitish": "main",
                "name": title,
                "body": release_notes,
                "draft": False,
                "prerelease": False,
            },
        )

    rel_id = rel_obj["id"]
    existing_assets = {a["name"]: a["id"] for a in (rel_obj.get("assets") or []) if a.get("name") and a.get("id")}

    assets_to_upload: List[str] = [
        os.path.join(DIST_DIR, "CineFlow.dmg"),
        os.path.join(DIST_DIR, f"CineFlow-Setup-{ver}-x64.exe"),
        os.path.join(DIST_DIR, "SHA256SUMS.txt"),
        os.path.join(DIST_DIR, "latest.json"),
    ]
    uploaded_names: List[str] = []

    for asset_path in assets_to_upload:
        if not os.path.isfile(asset_path):
            print(f"[publish] Skipping missing file: {asset_path}")
            continue
        asset_name = os.path.basename(asset_path)
        if asset_name in existing_assets:
            del_url = f"https://api.github.com/repos/{repo}/releases/assets/{existing_assets[asset_name]}"
            req_del = urllib.request.Request(
                del_url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "CineFlow-Release-Publisher",
                },
                method="DELETE",
            )
            with urllib.request.urlopen(req_del, timeout=30):
                pass

        size_mb = os.path.getsize(asset_path) / (1024 * 1024)
        print(f"[publish] Uploading {asset_name} ({size_mb:.2f} MB) to {repo} ({tag})...")
        with open(asset_path, "rb") as fp:
            file_bytes = fp.read()

        content_type = "application/octet-stream"
        if asset_name.endswith(".json"):
            content_type = "application/json"
        elif asset_name.endswith(".txt"):
            content_type = "text/plain; charset=utf-8"

        up_url = (
            f"https://uploads.github.com/repos/{repo}/releases/{rel_id}/assets?"
            + urllib.parse.urlencode({"name": asset_name})
        )
        req_up = urllib.request.Request(
            up_url,
            data=file_bytes,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "Content-Type": content_type,
                "Content-Length": str(len(file_bytes)),
                "User-Agent": "CineFlow-Release-Publisher",
            },
            method="POST",
        )
        with urllib.request.urlopen(req_up, timeout=300) as resp:
            up_res = json.loads(resp.read().decode("utf-8"))
            uploaded_names.append(up_res.get("name") or asset_name)
            print(f"[publish] Uploaded {asset_name} -> {up_res.get('browser_download_url')}")

    return {
        "ok": True,
        "tag": tag,
        "title": title,
        "html_url": rel_obj.get("html_url"),
        "uploaded_assets": uploaded_names,
    }


if __name__ == "__main__":
    res = publish_release()
    print(json.dumps(res, ensure_ascii=False, indent=2))
