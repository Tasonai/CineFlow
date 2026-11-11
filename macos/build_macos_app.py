#!/usr/bin/env python3
"""
Builds the self-contained Universal 2 (Apple Silicon arm64 + Intel x86_64) macOS application:
  - `dist/Velarium.app` (WKWebView + NSStatusBar Menu Bar + Now Playing + UNUserNotificationCenter + bundled runtime)
  - `dist/Velarium.dmg` (Drag-to-Applications UDZO disk image installer)
  - `backend/bin/kinorium_login_helper` (One-Click Kinorium WKWebView Auth Helper)
"""

import glob
import os
import plistlib
import shutil
import subprocess
import tempfile

MACOS_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(MACOS_DIR)
DIST_DIR = os.path.join(BASE_DIR, "dist")
APP_BUNDLE = os.path.join(DIST_DIR, "Velarium.app")
DMG_PATH = os.path.join(DIST_DIR, "Velarium.dmg")
CONTENTS_DIR = os.path.join(APP_BUNDLE, "Contents")
MACOS_BIN_DIR = os.path.join(CONTENTS_DIR, "MacOS")
RESOURCES_DIR = os.path.join(CONTENTS_DIR, "Resources")
BUNDLED_APP_DIR = os.path.join(RESOURCES_DIR, "app")


def compile_universal_swift(swift_src: str, out_bin: str, frameworks: list[str]) -> None:
    os.makedirs(os.path.dirname(out_bin), exist_ok=True)
    fw_flags: list[str] = []
    for fw in frameworks:
        fw_flags.extend(["-framework", fw])

    with tempfile.TemporaryDirectory() as tmpdir:
        arm_bin = os.path.join(tmpdir, "bin_arm64")
        x64_bin = os.path.join(tmpdir, "bin_x86_64")
        try:
            subprocess.run(
                ["swiftc", "-O", "-target", "arm64-apple-macos12.0", swift_src, *fw_flags, "-o", arm_bin],
                check=True,
            )
            subprocess.run(
                ["swiftc", "-O", "-target", "x86_64-apple-macos12.0", swift_src, *fw_flags, "-o", x64_bin],
                check=True,
            )
            subprocess.run(["lipo", "-create", arm_bin, x64_bin, "-output", out_bin], check=True)
        except Exception:
            subprocess.run(["swiftc", "-O", swift_src, *fw_flags, "-o", out_bin], check=True)
    os.chmod(out_bin, 0o755)


def build_app_icon_icns(src_png: str, dest_icns: str) -> bool:
    if not os.path.isfile(src_png):
        return False
    with tempfile.TemporaryDirectory() as tmpdir:
        iconset = os.path.join(tmpdir, "AppIcon.iconset")
        os.makedirs(iconset, exist_ok=True)
        sizes = [
            (16, "icon_16x16.png"),
            (32, "icon_16x16@2x.png"),
            (32, "icon_32x32.png"),
            (64, "icon_32x32@2x.png"),
            (128, "icon_128x128.png"),
            (256, "icon_128x128@2x.png"),
            (256, "icon_256x256.png"),
            (512, "icon_256x256@2x.png"),
            (512, "icon_512x512.png"),
        ]
        for px, name in sizes:
            out_file = os.path.join(iconset, name)
            subprocess.run(
                ["sips", "-z", str(px), str(px), src_png, "--out", out_file],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        shutil.copy2(src_png, os.path.join(iconset, "icon_512x512@2x.png"))
        res = subprocess.run(
            ["iconutil", "-c", "icns", iconset, "-o", dest_icns],
            capture_output=True,
        )
        return res.returncode == 0 and os.path.isfile(dest_icns)


def main() -> None:
    print("[Velarium] Building Universal 2 kinorium_login_helper...")
    helper_src = os.path.join(MACOS_DIR, "kinorium_login_helper.swift")
    helper_out = os.path.join(BASE_DIR, "backend", "bin", "kinorium_login_helper")
    compile_universal_swift(helper_src, helper_out, ["Cocoa", "WebKit"])

    print("[Velarium] Preparing dist/Velarium.app bundle...")
    if os.path.exists(APP_BUNDLE):
        shutil.rmtree(APP_BUNDLE)
    os.makedirs(MACOS_BIN_DIR, exist_ok=True)
    os.makedirs(RESOURCES_DIR, exist_ok=True)

    icon_png = os.path.join(BASE_DIR, "public", "icons", "icon-512.png")
    icon_icns = os.path.join(RESOURCES_DIR, "AppIcon.icns")
    has_icon = build_app_icon_icns(icon_png, icon_icns)

    print("[Velarium] Embedding self-contained server.py, backend/, and public/ into Velarium.app...")
    os.makedirs(BUNDLED_APP_DIR, exist_ok=True)
    shutil.copy2(os.path.join(BASE_DIR, "server.py"), os.path.join(BUNDLED_APP_DIR, "server.py"))
    rel_notes_src = os.path.join(BASE_DIR, "RELEASE_NOTES.md")
    if os.path.isfile(rel_notes_src):
        shutil.copy2(rel_notes_src, os.path.join(RESOURCES_DIR, "RELEASE_NOTES.md"))
        shutil.copy2(rel_notes_src, os.path.join(BUNDLED_APP_DIR, "RELEASE_NOTES.md"))

    bundled_backend = os.path.join(BUNDLED_APP_DIR, "backend")
    os.makedirs(bundled_backend, exist_ok=True)
    for py_file in sorted(glob.glob(os.path.join(BASE_DIR, "backend", "*.py"))):
        shutil.copy2(py_file, os.path.join(bundled_backend, os.path.basename(py_file)))
    bundled_routes = os.path.join(bundled_backend, "routes")
    os.makedirs(bundled_routes, exist_ok=True)
    for py_file in sorted(glob.glob(os.path.join(BASE_DIR, "backend", "routes", "*.py"))):
        shutil.copy2(py_file, os.path.join(bundled_routes, os.path.basename(py_file)))

    src_bin_dir = os.path.join(BASE_DIR, "backend", "bin")
    if os.path.isdir(src_bin_dir):
        dst_bin_dir = os.path.join(bundled_backend, "bin")
        os.makedirs(dst_bin_dir, exist_ok=True)
        for name in sorted(os.listdir(src_bin_dir)):
            if name.lower().endswith((".exe", ".dll")) or name.startswith("."):
                continue
            src_item = os.path.join(src_bin_dir, name)
            if os.path.isfile(src_item):
                dst_item = os.path.join(dst_bin_dir, name)
                shutil.copy2(src_item, dst_item)
                os.chmod(dst_item, 0o755)

    shutil.copytree(
        os.path.join(BASE_DIR, "public"),
        os.path.join(BUNDLED_APP_DIR, "public"),
        ignore=shutil.ignore_patterns(".DS_Store", "__pycache__", ".BC.*"),
    )

    src_win_helper = os.path.join(BASE_DIR, "windows", "kinorium_login_webview.py")
    if os.path.isfile(src_win_helper):
        bundled_win_dir = os.path.join(BUNDLED_APP_DIR, "windows")
        os.makedirs(bundled_win_dir, exist_ok=True)
        shutil.copy2(src_win_helper, os.path.join(bundled_win_dir, "kinorium_login_webview.py"))

    with open(os.path.join(CONTENTS_DIR, "PkgInfo"), "w", encoding="ascii") as f:
        f.write("APPL????")

    info_plist = {
        "CFBundleName": "Velarium",
        "CFBundleDisplayName": "Velarium",
        "CFBundleIdentifier": "app.velarium.cinema",
        "CFBundleVersion": "27140",
        "CFBundleShortVersionString": "2.7.14",
        "CFBundlePackageType": "APPL",
        "CFBundleExecutable": "Velarium",
        "LSMinimumSystemVersion": "12.0",
        "NSHighResolutionCapable": True,
        "NSSupportsAutomaticGraphicsSwitching": True,
        "NSPrincipalClass": "NSApplication",
        "LSApplicationCategoryType": "public.app-category.entertainment",
        "NSHumanReadableCopyright": "Velarium Unified Home Cinema",
        "NSAppTransportSecurity": {
            "NSAllowsArbitraryLoads": True,
            "NSAllowsLocalNetworking": True,
        },
    }
    if has_icon:
        info_plist["CFBundleIconFile"] = "AppIcon"

    with open(os.path.join(CONTENTS_DIR, "Info.plist"), "wb") as pf:
        plistlib.dump(info_plist, pf)

    print("[Velarium] Compiling Universal 2 VelariumApp.swift...")
    app_src = os.path.join(MACOS_DIR, "VelariumApp.swift")
    app_bin = os.path.join(MACOS_BIN_DIR, "Velarium")
    compile_universal_swift(
        app_src,
        app_bin,
        ["Cocoa", "WebKit", "MediaPlayer", "UserNotifications"],
    )
    legacy_bin_link = os.path.join(MACOS_BIN_DIR, "CineFlow")
    if not os.path.exists(legacy_bin_link):
        os.symlink("Velarium", legacy_bin_link)

    subprocess.run(
        ["codesign", "--force", "--deep", "--sign", "-", APP_BUNDLE],
        capture_output=True,
        check=False,
    )
    print(f"[Velarium] Built standalone macOS bundle: {APP_BUNDLE}")

    if os.path.isfile("/usr/bin/hdiutil"):
        print("[Velarium] Packaging compressed macOS disk image dist/Velarium.dmg...")
        if os.path.exists(DMG_PATH):
            os.remove(DMG_PATH)
        with tempfile.TemporaryDirectory() as dmg_stage:
            velarium_stage_app = os.path.join(dmg_stage, "Velarium.app")
            legacy_stage_app = os.path.join(dmg_stage, "CineFlow.app")
            shutil.copytree(APP_BUNDLE, velarium_stage_app, symlinks=True)
            # Hidden hardlinked CineFlow.app bundle so existing CineFlow <= 2.7.1 OTA updaters
            # find mnt/CineFlow.app, copy it to /Applications/CineFlow.app, and self-relocate to /Applications/Velarium.app
            shutil.copytree(velarium_stage_app, legacy_stage_app, symlinks=True, copy_function=os.link)
            subprocess.run(["/usr/bin/chflags", "hidden", legacy_stage_app], check=False)
            os.symlink("/Applications", os.path.join(dmg_stage, "Applications"))
            rel_notes_src = os.path.join(BASE_DIR, "RELEASE_NOTES.md")
            if os.path.isfile(rel_notes_src):
                shutil.copy2(rel_notes_src, os.path.join(dmg_stage, "RELEASE_NOTES.md"))
            subprocess.run(
                [
                    "/usr/bin/hdiutil",
                    "create",
                    "-size",
                    "320m",
                    "-volname",
                    "Velarium",
                    "-srcfolder",
                    dmg_stage,
                    "-ov",
                    "-format",
                    "UDZO",
                    DMG_PATH,
                ],
                check=True,
            )
        print(f"[Velarium] Built macOS installer DMG: {DMG_PATH}")
        write_update_manifest_files(DMG_PATH, info_plist["CFBundleShortVersionString"])


def write_update_manifest_files(dmg_path: str, version_str: str) -> None:
    if not os.path.isfile(dmg_path):
        return
    import hashlib
    import json

    h = hashlib.sha256()
    with open(dmg_path, "rb") as fp:
        for chunk in iter(lambda: fp.read(1024 * 1024), b""):
            h.update(chunk)
    sha_hex = h.hexdigest()
    size_bytes = os.path.getsize(dmg_path)
    dmg_name = os.path.basename(dmg_path)
    dist_dir = os.path.dirname(dmg_path)

    sums_path = os.path.join(dist_dir, "SHA256SUMS.txt")
    existing_lines = []
    if os.path.isfile(sums_path):
        with open(sums_path, "r", encoding="utf-8") as sf:
            existing_lines = [ln.strip() for ln in sf.read().splitlines() if ln.strip() and not ln.strip().endswith(dmg_name)]
    existing_lines.append(f"{sha_hex}  {dmg_name}")
    with open(sums_path, "w", encoding="utf-8") as sf:
        sf.write("\n".join(existing_lines) + "\n")

    manifest_path = os.path.join(dist_dir, "latest.json")
    manifest = {"version": version_str, "platforms": {}}
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path, "r", encoding="utf-8") as mf:
                loaded = json.load(mf)
                if isinstance(loaded, dict):
                    manifest.update(loaded)
        except Exception:
            pass
    manifest["version"] = version_str
    rel_notes_src = os.path.join(BASE_DIR, "RELEASE_NOTES.md")
    if os.path.isfile(rel_notes_src):
        try:
            with open(rel_notes_src, "r", encoding="utf-8") as rnf:
                raw_rn = rnf.read().strip()
            if raw_rn:
                parts = raw_rn.split("<!-- EN -->")
                manifest["release_notes"] = parts[0].strip()
                if len(parts) > 1 and parts[1].strip():
                    manifest["release_notes_en"] = parts[1].strip()
        except Exception:
            pass
    platforms = manifest.setdefault("platforms", {})
    if isinstance(platforms, dict):
        platforms["macos"] = {
            "name": dmg_name,
            "url": f"https://github.com/tasonai/CineFlow/releases/download/v{version_str}/{dmg_name}",
            "size": size_bytes,
            "sha256": sha_hex,
        }
    with open(manifest_path, "w", encoding="utf-8") as mf:
        json.dump(manifest, mf, ensure_ascii=False, indent=2)

    dev_dist = os.path.expanduser("~/Developer/CineFlow/dist")
    try:
        os.makedirs(dev_dist, exist_ok=True)
        shutil.copy2(dmg_path, os.path.join(dev_dist, dmg_name))
        shutil.copy2(sums_path, os.path.join(dev_dist, "SHA256SUMS.txt"))
        shutil.copy2(manifest_path, os.path.join(dev_dist, "latest.json"))
        print(f"[+] Synced installer artifacts to local repository: {dev_dist}")
    except Exception as exc:
        print(f"[-] Note: could not copy to {dev_dist}: {exc}")


if __name__ == "__main__":
    main()
