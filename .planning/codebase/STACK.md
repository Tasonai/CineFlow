---
last_mapped_commit: 0ca6949e3be2a26342beea7cbfcd591a789fea04
last_mapped_at: 2026-11-03
---
# Technology Stack

**Analysis Date:** 2026-11-03

## Languages

**Primary:**
- Python 3.11+ - Backend HTTP server (`server.py`), media aggregation, DNS-over-HTTPS client, SQLite persistence, FFmpeg live remuxing, TorrServer orchestration, DLNA casting, and cross-platform installer build scripts (`backend/*.py`, `windows/*.py`, `macos/build_macos_app.py`, `scripts/publish_github_release.py`).
- JavaScript (ES2022+ ES Modules) - Zero-build browser frontend, custom video player controls, Web Audio API DSP, Canvas Ambilight, i18n, and smartphone remote control UI (`public/app.js`, `public/js/*.js`).
- HTML5 / CSS3 - Single-page application markup (`public/index.html`) and modular CSS stylesheets (`public/css/*.css`).

**Secondary:**
- Swift 5 (macOS 12.0+ target) - Native macOS Universal 2 application bundle (`macos/CineFlowApp.swift`) and Kinorium authentication helper (`macos/kinorium_login_helper.swift`).
- C (Win32 API / Winsock2) - Native 64-bit Windows GUI launcher (`windows/launcher/cineflow_launcher.c`) with resource/manifest definitions (`windows/launcher/cineflow_launcher.rc`, `windows/launcher/cineflow_launcher.manifest`).
- NSIS Script - Bilingual Modern UI 2 Windows installer definition (`windows/installer/cineflow.nsi`).
- Bash / Windows Batch - Platform launch and autostart helper scripts (`macos/Start-CineFlow-macOS.command`, `macos/install-autostart.sh`, `macos/uninstall-autostart.sh`, `windows/Start-Cinema-Windows.bat`, `windows/build-windows-exe.bat`).

## Runtime

**Environment:**
- Python 3.11+ (CPython standard library runtime; Windows installer bundles Python 3.11.9 Embeddable amd64 runtime from `build/cache/python-3.11.9-embed-amd64.zip`).
- macOS Native Runtime: Apple `WKWebView` (`WebKit.framework`), `Cocoa.framework`, `MediaPlayer.framework`, `UserNotifications.framework` compiled into `dist/CineFlow.app`.
- Windows Native Runtime: Native Win32 launcher (`dist/CineFlow.exe`) + `pywebview` (`edgechromium` / Microsoft Edge WebView2) via `windows/desktop_webview2.py` or Chromium/Edge App Mode with Widevine L1 DRM support.

**Package Manager:**
- None required for core server or frontend execution (strictly zero-dependency Python standard library and vanilla ES modules).
- Lockfile: Missing (intentionally omitted; no `package.json`, `requirements.txt`, or `pyproject.toml` is used).

## Frameworks

**Core:**
- Python `http.server` (`ThreadingHTTPServer` & `BaseHTTPRequestHandler`) - Multi-threaded local HTTP/REST server and streaming proxy in `server.py`.
- Python `sqlite3` (WAL mode) - Embedded relational and key-value storage engine in `backend/storage_db.py`.
- Vanilla JS ES Modules - Direct browser-native module system (`public/app.js` importing `public/js/state.js`, `public/js/player.js`, `public/js/catalog.js`, `public/js/modals.js`, `public/js/subtitles.js`, `public/js/remote.js`, `public/js/settings.js`, `public/js/features.js`, `public/js/audio-dsp.js`, `public/js/i18n.js`, `public/js/utils.js`).
- Apple Cocoa & WebKit - Native macOS desktop shell, menu bar status item (`NSStatusItem`), and system media center integration (`MPNowPlayingInfoCenter`, `MPRemoteCommandCenter`) in `macos/CineFlowApp.swift`.

**Testing:**
- Python `unittest` (Standard Library) - Automated test suite discovered and executed via `run_tests.py` across `tests/test_*.py`.

**Build/Dev:**
- `swiftc` & `lipo` & `iconutil` & `sips` & `codesign` & `hdiutil` - Apple command-line toolchain invoked by `macos/build_macos_app.py` to build Universal 2 (`arm64` + `x86_64`) binaries, `.icns` assets, `dist/CineFlow.app`, and `dist/CineFlow.dmg`.
- Zig `0.13.0` (`zig cc` / `zig rc`) - Cross-platform C compiler and Win32 resource compiler downloaded into `build/toolchain/` by `windows/build_windows_installer.py` to compile `windows/launcher/cineflow_launcher.c` into `dist/CineFlow.exe` on both macOS and Windows.
- NSIS `3.12` (`makensis`) - Nullsoft Scriptable Install System (`build/toolchain/nsis/`) invoked by `windows/build_windows_installer.py` to package `dist/CineFlow-Setup-2.6.11-x64.exe`.

## Key Dependencies

**Critical:**
- `hls.js` `1.5.15` - Loaded via jsDelivr CDN (`https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js`) in `public/index.html` for adaptive `.m3u8` HLS video streaming in browsers without native MSE HLS support.
- `ffmpeg` & `ffprobe` (`9.0` on Windows / bundled binaries in `backend/bin/ffmpeg` and `backend/bin/ffprobe`) - Used by `backend/remuxer.py` for stream probing, subtitle extraction, live audio transcoding (`DTS`/`TrueHD`/`AC-3`/`E-AC-3` to `AAC` with stereo dialogue downmixing), and fragmented MP4 (`frag_keyframe+empty_moov+default_base_moof`) live remuxing with hardware acceleration (`VideoToolbox`, `D3D11VA`, `NVENC`, `QSV`, `AMF`).
- `torrserver` (`MatriX.147.1` in `backend/bin/torrserver` and `build/cache/torrserver-win64.exe`) - Local RAM-buffered BitTorrent HTTP streaming daemon managed by `backend/backup_stream.py`.

**Infrastructure:**
- `kinorium_login_helper` (`backend/bin/kinorium_login_helper`, compiled from `macos/kinorium_login_helper.swift`) - Standalone native macOS WebKit window for 1-click Kinorium authentication.
- `pywebview` (optional on Windows) - Used by `windows/desktop_webview2.py` and `windows/kinorium_login_webview.py` when available to host a native Microsoft Edge WebView2 window; gracefully falls back to Chromium/Edge `--app` mode or system browser.

## Configuration

**Environment:**
- Configured via environment variables and persistent JSON/SQLite settings stored in `data/server_settings.json` and `data/cineflow.db`.
- Supported environment variables:
  - `PORT` - Override default HTTP server port (`8765`) in `server.py`.
  - `CINEFLOW_DATA_DIR` - Override local data storage directory path (`server.py`, `macos/CineFlowApp.swift`).
  - `CINEFLOW_ROOT` - Override application root directory in `macos/CineFlowApp.swift`.
  - `CINEFLOW_VERBOSE_LOG` - Enable verbose stdout logging when running in `--launchd` daemon mode (`server.py`).
  - `CINEFLOW_UPDATE_REPO` - Override GitHub repository (`tasonai/CineFlow`) used by `backend/updater.py`.
  - `CINEFLOW_UPDATE_MANIFEST_URL` - Override custom `latest.json` update manifest URL in `backend/updater.py`.
  - `GITHUB_TOKEN` / `GITHUB_PERSONAL_ACCESS_TOKEN` / `GH_TOKEN` - Used exclusively by release publishing script `scripts/publish_github_release.py`.

**Build:**
- `macos/build_macos_app.py` - macOS `.app` and `.dmg` packaging configuration, `Info.plist` generation, and SHA-256 manifest builder.
- `windows/build_windows_installer.py` & `windows/installer/cineflow.nsi` - Windows x64 `.exe` launcher and NSIS installer build configuration.
- `.github/workflows/build-windows.yml` - GitHub Actions workflow for automated Windows installer builds.
- `public/manifest.webmanifest` - Progressive Web App (PWA) manifest for mobile/desktop installation.

## Platform Requirements

**Development:**
- macOS 12.0+, Windows 10/11 (x64), or Linux with Python `3.11+`.
- Apple Command Line Tools (`swiftc`, `lipo`, `hdiutil`, `iconutil`) required only when building macOS bundles via `macos/build_macos_app.py`.
- Internet connection or populated `build/cache/` required only when building the Windows installer via `windows/build_windows_installer.py`.

**Production:**
- **macOS:** macOS 12.0 Monterey or newer (Universal 2 binary supporting Apple Silicon `arm64` and Intel `x86_64`), distributed as `dist/CineFlow.dmg` (`dist/CineFlow.app`).
- **Windows:** Microsoft Windows 10 or Windows 11 (64-bit `x64`), distributed as self-contained installer `dist/CineFlow-Setup-2.6.11-x64.exe` with native launcher `dist/CineFlow.exe`.

---

*Stack analysis: 2026-11-03*
