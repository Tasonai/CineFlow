#!/usr/bin/env python3
"""
Cross-platform Windows x64 Installer Builder for CineFlow 2.7.1 (Developer: Atoma).

Builds:
  1. windows/assets/cineflow.ico (multi-size 16..256px Windows icon)
  2. windows/assets/wizard-welcome.bmp & wizard-header.bmp (NSIS MUI2 branding bitmaps)
  3. windows/installer/license_ru.txt & license_en.txt (UTF-8 BOM localized product & license docs)
  4. dist/CineFlow.exe (native 64-bit Win32 GUI launcher with PE VERSIONINFO & Per-Monitor V2 DPI)
  5. dist/CineFlow-Setup-2.7.1-x64.exe (standalone bilingual NSIS 3 Modern UI 2 installer bundling
     Python 3.11.9 Windows x64 runtime + TorrServer MatriX x64 + FFmpeg 9 x64)
"""

import os
import shutil
import struct
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
import zlib
from typing import List, Optional, Tuple


APP_NAME = "CineFlow"
APP_VERSION = "2.7.1"
APP_VERSION_QUAD = "2.7.1.0"
APP_PUBLISHER = "Atoma"

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WINDOWS_DIR = os.path.join(ROOT_DIR, "windows")
ASSETS_DIR = os.path.join(WINDOWS_DIR, "assets")
LAUNCHER_DIR = os.path.join(WINDOWS_DIR, "launcher")
INSTALLER_DIR = os.path.join(WINDOWS_DIR, "installer")
BUILD_DIR = os.path.join(ROOT_DIR, "build")
CACHE_DIR = os.path.join(BUILD_DIR, "cache")
TOOLCHAIN_DIR = os.path.join(BUILD_DIR, "toolchain")
STAGE_CORE_DIR = os.path.join(BUILD_DIR, "win-stage-core")
STAGE_MEDIA_DIR = os.path.join(BUILD_DIR, "win-stage-media")
DIST_DIR = os.path.join(ROOT_DIR, "dist")

URL_PYTHON_WIN64 = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"
URL_TORRSERVER_WIN64 = "https://github.com/YouROK/TorrServer/releases/download/MatriX.147.1/TorrServer-windows-amd64.exe"
URL_FFMPEG_WIN64 = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip"
URL_NSIS_BUNDLE = "https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis%402.0.2/nsis-bundle-3.12.tar.gz"
URL_ZIG_MACOS_X64 = "https://ziglang.org/download/0.13.0/zig-macos-x86_64-0.13.0.tar.xz"
URL_ZIG_MACOS_ARM64 = "https://ziglang.org/download/0.13.0/zig-macos-aarch64-0.13.0.tar.xz"


LICENSE_RU_TEXT = f"""==========================================================
CINEFLOW — ЕДИНЫЙ ЛОКАЛЬНЫЙ ОНЛАЙН-КИНОТЕАТР ДЛЯ WINDOWS
Паспорт выпуска, конфиденциальность и условия использования
==========================================================

ПАСПОРТ ПРОГРАММНОГО ПРОДУКТА
  Название продукта: {APP_NAME}
  Версия выпуска:    {APP_VERSION} (64-разрядная сборка x64)
  Разработчик:       {APP_PUBLISHER}
  Год выпуска:       2026 год
  Целевая система:   Microsoft Windows 10 и Windows 11 (x64)

1. НАЗНАЧЕНИЕ И ВОЗМОЖНОСТИ ПРИЛОЖЕНИЯ
CineFlow объединяет вашу персональную коллекцию кино, потоковое воспроизведение высокой четкости и каталог стриминговых платформ в едином быстром интерфейсе:

• Полная двусторонняя синхронизация с сервисом Kinorium и вход в один клик через встроенное окно без ручного копирования Cookie: списки «Буду смотреть», «Смотрю», «Просмотрено», история серий, оценки и лента друзей.
• Домашние профили («Личный», «Семейный», детский безопасный профиль «Детский» и пользовательские профили) с раздельными историями просмотра, настройками озвучки по умолчанию и независимыми аккаунтами Kinorium.
• Менеджер офлайн-загрузок «Скачать в дорогу»: пакетное сохранение целых сезонов, оставшихся серий и фильмов в качестве 1080p и 4K с выбранной аудиодорожкой и субтитрами, а также безопасное автоудаление просмотренных файлов.
• Прямое потоковое воспроизведение в качестве 1080p, 2K и 4K HDR без ручной установки сторонних кодеков или внешних видеоплееров.
• Встроенный модуль ремукса звука и контейнеров на базе FFmpeg 9: точная нулевая задержка звука и видео, ручная подстройка синхронизации аудио на лету, мгновенное переключение аудиодорожек MKV, выравнивание громкости диалогов 5.1 и 7.1, а также умные субтитры (поиск внешних дорожек и конвертация SRT и ASS в WebVTT).
• Встроенный движок TorrServer MatriX для потокового просмотра фильмов и выбора отдельных серий внутри многофайловых раздач 4K HDR непосредственно в оперативной памяти без износа твердотельного накопителя.
• Пульт управления со смартфона по домашнему Wi-Fi (подключение по QR-коду без установки приложений на телефон), хронологический календарь выхода новых серий, режим для телевизора (TV Mode) и прямая передача потока по DLNA на Smart TV.
• Быстрое и отказоустойчивое локальное хранилище SQLite в режиме WAL и поддержка пользовательских расширений экосистемы Stremio с автопропуском заставок.

2. ЛОКАЛЬНАЯ КОНФИДЕНЦИАЛЬНОСТЬ И БЕЗОПАСНОСТЬ
• Все компоненты CineFlow работают локально на вашем компьютере по адресу 127.0.0.1:8765. Доступ из локальной сети открывается исключительно по вашему явному решению в настройках приложения.
• Разработчик {APP_PUBLISHER} не собирает телеметрию, не отслеживает историю просмотра и не передает ваши учетные данные на сторонние серверы.
• Все персональные настройки, резервные копии и сессии хранятся только локально в папке data внутри каталога установки приложения.

3. ЛИЦЕНЗИОННЫЕ УСЛОВИЯ
• Программное обеспечение CineFlow {APP_VERSION} предоставляется разработчиком {APP_PUBLISHER} для персонального некоммерческого использования по принципу «как есть» (AS IS) без каких-либо прямых или подразумеваемых гарантий.
• CineFlow является локальным техническим агрегатором и клиентским интерфейсом. Приложение не размещает, не хранит и не распространяет защищенные авторским правом аудиовизуальные произведения на собственных серверах.
• В состав установочного пакета включены официально распространяемые среды выполнения с открытым исходным кодом (Python Software Foundation License, FFmpeg GPL, TorrServer MatriX), права на которые принадлежат их авторам.

Copyright (C) 2026 {APP_PUBLISHER}. Все права защищены.
"""

LICENSE_EN_TEXT = f"""==========================================================
CINEFLOW — UNIFIED LOCAL CINEMA HUB FOR WINDOWS
Product Passport, Local Privacy & License Agreement
==========================================================

PRODUCT INFORMATION
  Product Name:    {APP_NAME}
  Release Version: {APP_VERSION} (64-bit x64 Edition)
  Developer:       {APP_PUBLISHER}
  Release Year:    2026
  Target Platform: Microsoft Windows 10 & Windows 11 (x64)

1. OVERVIEW & CORE CAPABILITIES
CineFlow unifies your personal movie tracking library, high-bitrate streaming, and regional streaming availability inside a single matte-dark desktop interface:

• Two-way Kinorium synchronization with one-click built-in sign-in (zero manual cookie copying): Watchlist, Currently Watching, Watched history, episode progress, personal ratings, and friends' activity.
• Household Profiles ("Personal", "Family", safe "Kids" mode, and custom profiles) with isolated watch history, default audio preferences, and independent Kinorium accounts.
• Offline Downloads manager ("Download to Go"): batch season and episode downloads in 1080p and 4K with selected audio, WebVTT subtitles, and safe auto-cleanup.
• Instant 1080p, 2K, and 4K HDR playback with zero external codec packs or third-party media players required.
• Built-in FFmpeg 9 live container and audio remux engine: zero-lag A/V sync, live Audio Sync stepper, seamless MKV audio track switching, 5.1 / 7.1 dialogue downmixing, and Smart Subtitles (external search + SRT/ASS to WebVTT).
• Integrated TorrServer MatriX engine for RAM-buffered 4K HDR P2P streaming with exact multi-file episode selection and zero SSD write wear.
• Smartphone Wi-Fi Remote Control (instant QR pairing with zero mobile app install), Release Calendar, TV Mode (D-pad / Gamepad), and direct DLNA Smart TV casting.
• Crash-safe SQLite WAL local storage, community Stremio addons, and Intro Skip.

2. LOCAL PRIVACY & SECURITY ARCHITECTURE
• CineFlow runs strictly locally on your computer (127.0.0.1:8765) by default. LAN access is disabled until explicitly enabled by you in Settings.
• {APP_PUBLISHER} collects zero telemetry, zero analytics, and never transmits your viewing history or session credentials to any external server.
• All personal preferences, backups, and sync caches remain exclusively inside the local "data" directory on your machine.

3. LICENSE TERMS
• CineFlow {APP_VERSION} is provided by {APP_PUBLISHER} for personal, non-commercial use on an "AS IS" basis without warranties of any kind.
• CineFlow operates solely as a local client-side media interface and metadata aggregator and does not host or distribute media content on any server.
• Bundled open-source runtime components (Python 3.11 Embeddable Runtime, FFmpeg 9 GPL, TorrServer MatriX) remain covered by their respective licenses.

Copyright (C) 2026 {APP_PUBLISHER}. All rights reserved.
"""


def _download_if_missing(url: str, dest_path: str, label: str) -> str:
    if os.path.isfile(dest_path) and os.path.getsize(dest_path) > 1024:
        return dest_path
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    print(f"[build] Downloading {label} from {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "CineFlow-Builder/2.7.1"})
    tmp_path = f"{dest_path}.part"
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp_path, "wb") as out:
        shutil.copyfileobj(resp, out)
    os.replace(tmp_path, dest_path)
    return dest_path


def _paeth_predictor(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def decode_rgba_png(png_path: str) -> Tuple[int, int, bytearray]:
    """Pure-stdlib 8-bit RGBA/RGB PNG decoder."""
    with open(png_path, "rb") as fh:
        data = fh.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Not a valid PNG file: {png_path}")

    pos = 8
    width = height = bit_depth = color_type = 0
    idat_chunks: List[bytes] = []
    while pos < len(data):
        length, ctype = struct.unpack(">I4s", data[pos : pos + 8])
        chunk_data = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, bit_depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", chunk_data)
            if bit_depth != 8 or color_type not in (2, 6) or interlace != 0:
                raise ValueError(f"Unsupported PNG format in {png_path}: depth={bit_depth} type={color_type}")
        elif ctype == b"IDAT":
            idat_chunks.append(chunk_data)
        elif ctype == b"IEND":
            break

    bpp = 4 if color_type == 6 else 3
    stride = width * bpp
    raw = zlib.decompress(b"".join(idat_chunks))
    rgba = bytearray(width * height * 4)
    prev_row = bytearray(stride)

    src_idx = 0
    for y in range(height):
        flt = raw[src_idx]
        src_idx += 1
        cur_row = bytearray(raw[src_idx : src_idx + stride])
        src_idx += stride

        if flt == 1:  # Sub
            for i in range(bpp, stride):
                cur_row[i] = (cur_row[i] + cur_row[i - bpp]) & 0xFF
        elif flt == 2:  # Up
            for i in range(stride):
                cur_row[i] = (cur_row[i] + prev_row[i]) & 0xFF
        elif flt == 3:  # Average
            for i in range(stride):
                left = cur_row[i - bpp] if i >= bpp else 0
                cur_row[i] = (cur_row[i] + ((left + prev_row[i]) >> 1)) & 0xFF
        elif flt == 4:  # Paeth
            for i in range(stride):
                left = cur_row[i - bpp] if i >= bpp else 0
                up = prev_row[i]
                up_left = prev_row[i - bpp] if i >= bpp else 0
                cur_row[i] = (cur_row[i] + _paeth_predictor(left, up, up_left)) & 0xFF

        prev_row = cur_row
        dst_base = y * width * 4
        if bpp == 4:
            rgba[dst_base : dst_base + width * 4] = cur_row
        else:
            for x in range(width):
                rgba[dst_base + x * 4 + 0] = cur_row[x * 3 + 0]
                rgba[dst_base + x * 4 + 1] = cur_row[x * 3 + 1]
                rgba[dst_base + x * 4 + 2] = cur_row[x * 3 + 2]
                rgba[dst_base + x * 4 + 3] = 255

    return width, height, rgba


def encode_rgba_png(width: int, height: int, rgba: bytes) -> bytes:
    """Pure-stdlib RGBA PNG encoder."""
    raw_rows = bytearray()
    stride = width * 4
    for y in range(height):
        raw_rows.append(0)
        raw_rows.extend(rgba[y * stride : (y + 1) * stride])

    def _chunk(ctype: bytes, payload: bytes) -> bytes:
        crc = zlib.crc32(ctype + payload) & 0xFFFFFFFF
        return struct.pack(">I4s", len(payload), ctype) + payload + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw_rows), 9)
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


def resize_rgba_area(src_w: int, src_h: int, src_rgba: bytearray, dst_w: int, dst_h: int) -> bytearray:
    """High-quality area-averaging box/bilinear downsampler for crisp icons."""
    out = bytearray(dst_w * dst_h * 4)
    scale_x = src_w / float(dst_w)
    scale_y = src_h / float(dst_h)

    for dy in range(dst_h):
        sy0 = dy * scale_y
        sy1 = (dy + 1) * scale_y
        iy0 = int(sy0)
        iy1 = min(src_h - 1, int(sy1))
        for dx in range(dst_w):
            sx0 = dx * scale_x
            sx1 = (dx + 1) * scale_x
            ix0 = int(sx0)
            ix1 = min(src_w - 1, int(sx1))

            r_acc = g_acc = b_acc = a_acc = w_sum = 0.0
            for sy in range(iy0, iy1 + 1):
                wy = min(sy + 1.0, sy1) - max(float(sy), sy0)
                if wy <= 0.0:
                    continue
                row_off = sy * src_w * 4
                for sx in range(ix0, ix1 + 1):
                    wx = min(sx + 1.0, sx1) - max(float(sx), sx0)
                    if wx <= 0.0:
                        continue
                    w = wx * wy
                    idx = row_off + sx * 4
                    a = src_rgba[idx + 3] / 255.0
                    r_acc += src_rgba[idx + 0] * a * w
                    g_acc += src_rgba[idx + 1] * a * w
                    b_acc += src_rgba[idx + 2] * a * w
                    a_acc += a * w
                    w_sum += w

            d_idx = (dy * dst_w + dx) * 4
            if w_sum > 0.0 and a_acc > 1e-6:
                out_a = min(1.0, max(0.0, a_acc / w_sum))
                out[d_idx + 0] = min(255, max(0, int(round(r_acc / a_acc))))
                out[d_idx + 1] = min(255, max(0, int(round(g_acc / a_acc))))
                out[d_idx + 2] = min(255, max(0, int(round(b_acc / a_acc))))
                out[d_idx + 3] = min(255, max(0, int(round(out_a * 255.0))))
    return out


def _rgba_to_ico_dib(width: int, height: int, rgba: bytearray) -> bytes:
    """Packs RGBA pixels into a 32-bit bottom-up BGRA BITMAPINFOHEADER + AND mask for Win32 .ico."""
    bmi = struct.pack(
        "<IIIHHIIIIII",
        40,
        width,
        height * 2,
        1,
        32,
        0,
        width * height * 4,
        0,
        0,
        0,
        0,
    )
    xor_buf = bytearray(width * height * 4)
    mask_row_bytes = ((width + 31) // 32) * 4
    and_buf = bytearray(mask_row_bytes * height)

    for y in range(height):
        src_y = height - 1 - y
        for x in range(width):
            s_idx = (src_y * width + x) * 4
            d_idx = (y * width + x) * 4
            r, g, b, a = rgba[s_idx], rgba[s_idx + 1], rgba[s_idx + 2], rgba[s_idx + 3]
            xor_buf[d_idx + 0] = b
            xor_buf[d_idx + 1] = g
            xor_buf[d_idx + 2] = r
            xor_buf[d_idx + 3] = a
            if a < 16:
                byte_idx = y * mask_row_bytes + (x >> 3)
                and_buf[byte_idx] |= 0x80 >> (x & 7)

    return bmi + bytes(xor_buf) + bytes(and_buf)


def build_ico_file(src_w: int, src_h: int, src_rgba: bytearray, out_ico_path: str) -> None:
    sizes = [16, 24, 32, 48, 64, 256]
    payloads: List[Tuple[int, bytes]] = []
    for sz in sizes:
        scaled = resize_rgba_area(src_w, src_h, src_rgba, sz, sz)
        if sz == 256:
            blob = encode_rgba_png(sz, sz, bytes(scaled))
        else:
            blob = _rgba_to_ico_dib(sz, sz, scaled)
        payloads.append((sz, blob))

    header = struct.pack("<HHH", 0, 1, len(payloads))
    entries = bytearray()
    offset = 6 + 16 * len(payloads)
    blobs = bytearray()

    for sz, blob in payloads:
        w_byte = 0 if sz >= 256 else sz
        h_byte = 0 if sz >= 256 else sz
        entries.extend(struct.pack("<BBBBHHII", w_byte, h_byte, 0, 0, 1, 32, len(blob), offset))
        blobs.extend(blob)
        offset += len(blob)

    os.makedirs(os.path.dirname(out_ico_path), exist_ok=True)
    with open(out_ico_path, "wb") as fh:
        fh.write(header + bytes(entries) + bytes(blobs))


def write_bmp_24(
    width: int,
    height: int,
    bg_rgb: Tuple[int, int, int],
    icon_rgba: bytearray,
    icon_size: int,
    icon_x: int,
    icon_y: int,
    out_bmp_path: str,
    right_border_rgb: Optional[Tuple[int, int, int]] = None,
) -> None:
    """Writes an uncompressed 24-bit BI_RGB Windows BMP required by NSIS Modern UI 2."""
    canvas = bytearray(width * height * 3)
    br, bg, bb = bg_rgb
    for i in range(0, len(canvas), 3):
        canvas[i + 0] = br
        canvas[i + 1] = bg
        canvas[i + 2] = bb

    if right_border_rgb is not None:
        rr, rg, rb = right_border_rgb
        for y in range(height):
            idx = (y * width + (width - 1)) * 3
            canvas[idx + 0] = rr
            canvas[idx + 1] = rg
            canvas[idx + 2] = rb

    for iy in range(icon_size):
        dy = icon_y + iy
        if not (0 <= dy < height):
            continue
        for ix in range(icon_size):
            dx = icon_x + ix
            if not (0 <= dx < width):
                continue
            s_idx = (iy * icon_size + ix) * 4
            ir, ig, ib, ia = (
                icon_rgba[s_idx + 0],
                icon_rgba[s_idx + 1],
                icon_rgba[s_idx + 2],
                icon_rgba[s_idx + 3],
            )
            if ia == 0:
                continue
            d_idx = (dy * width + dx) * 3
            alpha = ia / 255.0
            inv = 1.0 - alpha
            canvas[d_idx + 0] = int(round(ir * alpha + canvas[d_idx + 0] * inv))
            canvas[d_idx + 1] = int(round(ig * alpha + canvas[d_idx + 1] * inv))
            canvas[d_idx + 2] = int(round(ib * alpha + canvas[d_idx + 2] * inv))

    row_stride = ((width * 3 + 3) // 4) * 4
    pad = b"\x00" * (row_stride - width * 3)
    pixel_data = bytearray()
    for y in range(height - 1, -1, -1):
        row = bytearray()
        for x in range(width):
            idx = (y * width + x) * 3
            row.extend((canvas[idx + 2], canvas[idx + 1], canvas[idx + 0]))
        pixel_data.extend(row)
        pixel_data.extend(pad)

    file_size = 14 + 40 + len(pixel_data)
    bmp_header = struct.pack("<2sIHHI", b"BM", file_size, 0, 0, 54)
    dib_header = struct.pack(
        "<IIIHHIIIIII",
        40,
        width,
        height,
        1,
        24,
        0,
        len(pixel_data),
        2835,
        2835,
        0,
        0,
    )
    os.makedirs(os.path.dirname(out_bmp_path), exist_ok=True)
    with open(out_bmp_path, "wb") as fh:
        fh.write(bmp_header + dib_header + bytes(pixel_data))


def generate_branding_and_docs() -> None:
    print("[build] Generating Windows .ico, wizard .bmp graphics, and localized license docs...")
    os.makedirs(ASSETS_DIR, exist_ok=True)
    os.makedirs(INSTALLER_DIR, exist_ok=True)

    icon_png = os.path.join(ROOT_DIR, "public", "icons", "icon-512.png")
    src_w, src_h, src_rgba = decode_rgba_png(icon_png)

    ico_path = os.path.join(ASSETS_DIR, "cineflow.ico")
    build_ico_file(src_w, src_h, src_rgba, ico_path)

    # NSIS Welcome/Finish sidebar bitmap (164x314) — flat matte dark #131417 with subtle hairline border
    welcome_icon = resize_rgba_area(src_w, src_h, src_rgba, 88, 88)
    write_bmp_24(
        width=164,
        height=314,
        bg_rgb=(19, 20, 23),
        icon_rgba=welcome_icon,
        icon_size=88,
        icon_x=(164 - 88) // 2,
        icon_y=84,
        out_bmp_path=os.path.join(ASSETS_DIR, "wizard-welcome.bmp"),
        right_border_rgb=(42, 44, 52),
    )

    # NSIS Header right-aligned badge bitmap (150x57) — clean #FFFFFF matching MUI2 header bar
    header_icon = resize_rgba_area(src_w, src_h, src_rgba, 40, 40)
    write_bmp_24(
        width=150,
        height=57,
        bg_rgb=(255, 255, 255),
        icon_rgba=header_icon,
        icon_size=40,
        icon_x=98,
        icon_y=8,
        out_bmp_path=os.path.join(ASSETS_DIR, "wizard-header.bmp"),
    )

    # Write localized UTF-8 BOM + CRLF license/passport documents for NSIS Unicode RichEdit
    rel_notes_path = os.path.join(ROOT_DIR, "RELEASE_NOTES.md")
    ru_notes_plain = ""
    en_notes_plain = ""
    if os.path.isfile(rel_notes_path):
        try:
            with open(rel_notes_path, "r", encoding="utf-8") as rnf:
                raw_md = rnf.read().strip()
            parts = raw_md.split("<!-- EN -->")
            ru_part = parts[0].strip().replace("**", "").replace("`", "")
            en_part = (parts[1].strip() if len(parts) > 1 else parts[0].strip()).replace("**", "").replace("`", "")
            if ru_part:
                ru_notes_plain = f"\n0. СПИСОК ИЗМЕНЕНИЙ (RELEASE NOTES)\n{ru_part}\n"
            if en_part:
                en_notes_plain = f"\n0. RELEASE NOTES (CHANGELOG)\n{en_part}\n"
        except Exception:
            pass

    lic_ru = LICENSE_RU_TEXT.replace(
        "\n1. НАЗНАЧЕНИЕ И ВОЗМОЖНОСТИ ПРИЛОЖЕНИЯ",
        f"{ru_notes_plain}\n1. НАЗНАЧЕНИЕ И ВОЗМОЖНОСТИ ПРИЛОЖЕНИЯ",
    )
    lic_en = LICENSE_EN_TEXT.replace(
        "\n1. OVERVIEW & CORE CAPABILITIES",
        f"{en_notes_plain}\n1. OVERVIEW & CORE CAPABILITIES",
    )
    for fname, content in (("license_ru.txt", lic_ru), ("license_en.txt", lic_en)):
        norm_crlf = content.replace("\r\n", "\n").replace("\n", "\r\n")
        out_txt = os.path.join(INSTALLER_DIR, fname)
        with open(out_txt, "wb") as fh:
            fh.write(b"\xef\xbb\xbf" + norm_crlf.encode("utf-8"))


def ensure_zig_compiler() -> Optional[str]:
    sys_zig = shutil.which("zig")
    if sys_zig:
        return sys_zig
    for sub in ("zig-macos-x86_64-0.13.0", "zig-macos-aarch64-0.13.0"):
        cand = os.path.join(TOOLCHAIN_DIR, sub, "zig")
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand

    if sys.platform == "darwin":
        arch = os.uname().machine.lower()
        url = URL_ZIG_MACOS_ARM64 if "arm" in arch or "aarch64" in arch else URL_ZIG_MACOS_X64
        tar_name = os.path.basename(url)
        archive = _download_if_missing(url, os.path.join(CACHE_DIR, tar_name), "Zig cross-compiler")
        os.makedirs(TOOLCHAIN_DIR, exist_ok=True)
        with tarfile.open(archive, "r:*") as tf:
            tf.extractall(TOOLCHAIN_DIR)
        sub_name = tar_name.replace(".tar.xz", "")
        cand = os.path.join(TOOLCHAIN_DIR, sub_name, "zig")
        if os.path.isfile(cand):
            return cand
    return None


def ensure_makensis() -> str:
    sys_nsis = shutil.which("makensis") or shutil.which("makensis.exe")
    if sys_nsis:
        return sys_nsis
    if os.name == "nt":
        for p in (r"C:\Program Files (x86)\NSIS\makensis.exe", r"C:\Program Files\NSIS\makensis.exe"):
            if os.path.isfile(p):
                return p

    bundled_wrapper = os.path.join(TOOLCHAIN_DIR, "nsis", "nsis-bundle", "makensis")
    if os.path.isfile(bundled_wrapper) and os.access(bundled_wrapper, os.X_OK):
        return bundled_wrapper

    archive = _download_if_missing(
        URL_NSIS_BUNDLE,
        os.path.join(CACHE_DIR, "nsis-bundle-3.12.tar.gz"),
        "NSIS 3.12 portable bundle",
    )
    nsis_dest = os.path.join(TOOLCHAIN_DIR, "nsis")
    os.makedirs(nsis_dest, exist_ok=True)
    with tarfile.open(archive, "r:gz") as tf:
        tf.extractall(nsis_dest)
    if os.path.isfile(bundled_wrapper):
        os.chmod(bundled_wrapper, 0o755)
        return bundled_wrapper
    raise RuntimeError("Unable to locate or bootstrap makensis")


def compile_windows_launcher(out_exe: str) -> None:
    out_exe = os.path.abspath(out_exe)
    print("[build] Compiling native 64-bit Win32 GUI launcher CineFlow.exe ...")
    os.makedirs(os.path.dirname(out_exe), exist_ok=True)
    c_src = os.path.join(LAUNCHER_DIR, "cineflow_launcher.c")
    rc_src = os.path.join(LAUNCHER_DIR, "cineflow_launcher.rc")
    res_obj = os.path.join(BUILD_DIR, "cineflow_launcher.res")

    mingw_gcc = shutil.which("x86_64-w64-mingw32-gcc")
    mingw_windres = shutil.which("x86_64-w64-mingw32-windres")
    if mingw_gcc and mingw_windres:
        subprocess.run([mingw_windres, rc_src, "-O", "coff", "-o", res_obj], cwd=LAUNCHER_DIR, check=True)
        subprocess.run(
            [
                mingw_gcc,
                "-O2",
                "-s",
                "-municode",
                "-mwindows",
                c_src,
                res_obj,
                "-o",
                out_exe,
                "-lws2_32",
                "-lshell32",
                "-ladvapi32",
                "-luser32",
                "-lkernel32",
            ],
            cwd=LAUNCHER_DIR,
            check=True,
        )
        return

    zig_bin = ensure_zig_compiler()
    if not zig_bin:
        raise RuntimeError("Neither x86_64-w64-mingw32-gcc nor Zig cross-compiler is available.")

    subprocess.run(
        [zig_bin, "rc", "/c", "65001", "--", rc_src, res_obj],
        cwd=LAUNCHER_DIR,
        check=True,
    )
    subprocess.run(
        [
            zig_bin,
            "cc",
            "-target",
            "x86_64-windows-gnu",
            "-O2",
            "-s",
            "-municode",
            "-Wl,--subsystem,windows",
            c_src,
            res_obj,
            "-o",
            out_exe,
            "-lws2_32",
            "-lshell32",
            "-ladvapi32",
            "-luser32",
            "-lkernel32",
        ],
        cwd=LAUNCHER_DIR,
        check=True,
    )


def stage_windows_payloads(launcher_exe: str) -> None:
    print("[build] Staging clean Windows x64 application & runtime trees...")
    if os.path.exists(STAGE_CORE_DIR):
        shutil.rmtree(STAGE_CORE_DIR)
    if os.path.exists(STAGE_MEDIA_DIR):
        shutil.rmtree(STAGE_MEDIA_DIR)
    os.makedirs(STAGE_CORE_DIR, exist_ok=True)
    os.makedirs(STAGE_MEDIA_DIR, exist_ok=True)

    # 1. Core launcher & entrypoint
    shutil.copy2(launcher_exe, os.path.join(STAGE_CORE_DIR, "CineFlow.exe"))
    shutil.copy2(os.path.join(ROOT_DIR, "server.py"), os.path.join(STAGE_CORE_DIR, "server.py"))
    if os.path.isfile(os.path.join(ROOT_DIR, "README.md")):
        shutil.copy2(os.path.join(ROOT_DIR, "README.md"), os.path.join(STAGE_CORE_DIR, "README.md"))

    # 2. Backend Python modules ONLY (strictly exclude macOS binaries in backend/bin and __pycache__)
    stage_backend = os.path.join(STAGE_CORE_DIR, "backend")
    os.makedirs(os.path.join(stage_backend, "bin"), exist_ok=True)
    src_backend = os.path.join(ROOT_DIR, "backend")
    for entry in sorted(os.listdir(src_backend)):
        full = os.path.join(src_backend, entry)
        if os.path.isfile(full) and entry.endswith(".py"):
            shutil.copy2(full, os.path.join(stage_backend, entry))

    # 3. Frontend public assets (exclude .DS_Store)
    def _ignore_junk(_dir: str, names: List[str]) -> List[str]:
        return [n for n in names if n in (".DS_Store", "__pycache__", "Thumbs.db") or n.endswith(".pyc")]

    shutil.copytree(
        os.path.join(ROOT_DIR, "public"),
        os.path.join(STAGE_CORE_DIR, "public"),
        ignore=_ignore_junk,
    )

    # 4. Windows helper scripts (installer language prefs, 1-click Kinorium sign-in, WebView2 fallback)
    stage_win_scripts = os.path.join(STAGE_CORE_DIR, "windows")
    os.makedirs(stage_win_scripts, exist_ok=True)
    for helper_name in (
        "apply_install_prefs.py",
        "kinorium_login_webview.py",
        "desktop_webview2.py",
        "Start-Cinema-Windows.bat",
    ):
        src_helper = os.path.join(WINDOWS_DIR, helper_name)
        if os.path.isfile(src_helper):
            shutil.copy2(src_helper, os.path.join(stage_win_scripts, helper_name))

    # 5. Embedded Python 3.11.9 Windows x64 runtime
    py_zip = _download_if_missing(
        URL_PYTHON_WIN64,
        os.path.join(CACHE_DIR, "python-3.11.9-embed-amd64.zip"),
        "Python 3.11.9 Windows x64 Embeddable Runtime",
    )
    stage_runtime = os.path.join(STAGE_CORE_DIR, "runtime")
    os.makedirs(stage_runtime, exist_ok=True)
    with zipfile.ZipFile(py_zip, "r") as zf:
        zf.extractall(stage_runtime)

    # Configure python311._pth so runtime\pythonw.exe imports .. (CineFlow root) cleanly
    pth_path = os.path.join(stage_runtime, "python311._pth")
    with open(pth_path, "w", encoding="utf-8", newline="\r\n") as fh:
        fh.write("python311.zip\n.\n..\nimport site\n")

    # 6. Media Engine Stage: TorrServer MatriX x64 + FFmpeg 9 x64 (ffmpeg.exe, ffprobe.exe, companion DLLs)
    torr_exe = _download_if_missing(
        URL_TORRSERVER_WIN64,
        os.path.join(CACHE_DIR, "torrserver-win64.exe"),
        "TorrServer MatriX Windows x64",
    )
    shutil.copy2(torr_exe, os.path.join(STAGE_MEDIA_DIR, "torrserver.exe"))

    ffmpeg_zip = _download_if_missing(
        URL_FFMPEG_WIN64,
        os.path.join(CACHE_DIR, "ffmpeg-win64-shared.zip"),
        "FFmpeg 9.0 Windows x64 GPL Shared",
    )
    with zipfile.ZipFile(ffmpeg_zip, "r") as zf:
        for member in zf.infolist():
            norm_name = member.filename.replace("\\", "/")
            if "/bin/" not in norm_name or member.is_dir():
                continue
            base = os.path.basename(norm_name)
            low = base.lower()
            if low in ("ffmpeg.exe", "ffprobe.exe") or low.endswith(".dll"):
                target_file = os.path.join(STAGE_MEDIA_DIR, base)
                with zf.open(member, "r") as src_f, open(target_file, "wb") as dst_f:
                    shutil.copyfileobj(src_f, dst_f)

    # Strict safety assertions: NEVER bundle personal data/*.json or macOS binaries,
    # and ensure all latest roadmap modules are staged in STAGE_CORE_DIR
    if os.path.exists(os.path.join(STAGE_CORE_DIR, "data")):
        raise RuntimeError("Safety check failed: STAGE_CORE_DIR must never contain personal data/ directory!")
    if os.listdir(os.path.join(STAGE_CORE_DIR, "backend", "bin")):
        raise RuntimeError("Safety check failed: STAGE_CORE_DIR/backend/bin must not contain host binaries!")
    for required_rel in (
        os.path.join("backend", "storage_db.py"),
        os.path.join("backend", "remote_control.py"),
        os.path.join("backend", "subtitles.py"),
        os.path.join("backend", "profiles.py"),
        os.path.join("backend", "downloads.py"),
        os.path.join("backend", "tv_cast.py"),
        os.path.join("backend", "kinorium_auth.py"),
        os.path.join("backend", "updater.py"),
        os.path.join("public", "js", "features.js"),
        os.path.join("public", "js", "remote.js"),
        os.path.join("public", "js", "subtitles.js"),
        os.path.join("windows", "kinorium_login_webview.py"),
        os.path.join("windows", "apply_install_prefs.py"),
    ):
        if not os.path.isfile(os.path.join(STAGE_CORE_DIR, required_rel)):
            raise RuntimeError(f"Missing required file in STAGE_CORE_DIR: {required_rel}")


def build_nsis_installer() -> str:
    makensis_bin = ensure_makensis()
    os.makedirs(DIST_DIR, exist_ok=True)
    out_installer = os.path.join(DIST_DIR, f"CineFlow-Setup-{APP_VERSION}-x64.exe")
    nsi_script = os.path.join(INSTALLER_DIR, "cineflow.nsi")

    print(f"[build] Running NSIS compiler ({makensis_bin}) -> {out_installer} ...")
    cmd = [
        makensis_bin,
        f"-DAPP_VERSION={APP_VERSION}",
        f"-DAPP_VERSION_QUAD={APP_VERSION_QUAD}",
        f"-DSTAGE_CORE_DIR={STAGE_CORE_DIR}",
        f"-DSTAGE_MEDIA_DIR={STAGE_MEDIA_DIR}",
        f"-DASSETS_DIR={ASSETS_DIR}",
        f"-DINSTALLER_DIR={INSTALLER_DIR}",
        f"-DOUT_INSTALLER_EXE={out_installer}",
        nsi_script,
    ]
    subprocess.run(cmd, cwd=INSTALLER_DIR, check=True)
    return out_installer


def main() -> int:
    os.makedirs(BUILD_DIR, exist_ok=True)
    os.makedirs(DIST_DIR, exist_ok=True)

    generate_branding_and_docs()

    launcher_out = os.path.join(DIST_DIR, "CineFlow.exe")
    compile_windows_launcher(launcher_out)

    stage_windows_payloads(launcher_out)
    installer_path = build_nsis_installer()

    size_mb = os.path.getsize(installer_path) / (1024 * 1024)
    print(f"[build] SUCCESS: {installer_path} ({size_mb:.1f} MB)")
    write_update_manifest_files(installer_path, APP_VERSION)
    return 0


def write_update_manifest_files(installer_path: str, version_str: str) -> None:
    if not os.path.isfile(installer_path):
        return
    import hashlib
    import json

    h = hashlib.sha256()
    with open(installer_path, "rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    sha_hex = h.hexdigest()
    size_bytes = os.path.getsize(installer_path)
    exe_name = os.path.basename(installer_path)

    sums_path = os.path.join(DIST_DIR, "SHA256SUMS.txt")
    existing_lines = []
    if os.path.isfile(sums_path):
        with open(sums_path, "r", encoding="utf-8") as sf:
            existing_lines = [ln.strip() for ln in sf.read().splitlines() if ln.strip() and not ln.strip().endswith(exe_name)]
    existing_lines.append(f"{sha_hex}  {exe_name}")
    with open(sums_path, "w", encoding="utf-8") as sf:
        sf.write("\n".join(existing_lines) + "\n")

    manifest_path = os.path.join(DIST_DIR, "latest.json")
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
    rel_notes_path = os.path.join(ROOT_DIR, "RELEASE_NOTES.md")
    if os.path.isfile(rel_notes_path):
        try:
            with open(rel_notes_path, "r", encoding="utf-8") as rnf:
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
        platforms["windows"] = {
            "name": exe_name,
            "url": f"https://github.com/tasonai/CineFlow/releases/download/v{version_str}/{exe_name}",
            "size": size_bytes,
            "sha256": sha_hex,
        }
    with open(manifest_path, "w", encoding="utf-8") as mf:
        json.dump(manifest, mf, ensure_ascii=False, indent=2)

    dev_dist = os.path.expanduser("~/Developer/CineFlow/dist")
    try:
        os.makedirs(dev_dist, exist_ok=True)
        shutil.copy2(installer_path, os.path.join(dev_dist, exe_name))
        shutil.copy2(sums_path, os.path.join(dev_dist, "SHA256SUMS.txt"))
        shutil.copy2(manifest_path, os.path.join(dev_dist, "latest.json"))
        print(f"[+] Synced Windows installer to local repository: {dev_dist}")
    except Exception as exc:
        print(f"[-] Note: could not copy to {dev_dist}: {exc}")


if __name__ == "__main__":
    raise SystemExit(main())
