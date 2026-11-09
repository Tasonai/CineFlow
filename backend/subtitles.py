import concurrent.futures
import copy
import gzip
import io
import json
import os
import re
import threading
import time
import urllib.parse
import zipfile
from typing import Any, Dict, List, Optional, Union

from backend.stremio import StremioAddonEngine, convert_srt_or_vtt_to_webvtt


_ASS_TAG_RE = re.compile(r"\{[^}]*\}")
_ASS_DRAW_STATE_RE = re.compile(r"\\p(\d+)(?![a-zA-Z])")
_ASS_TS_RE = re.compile(r"^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$")
_VTT_TS_DOT_RE = re.compile(r"(\d{2}:\d{2}:\d{2})\.(\d{3})")
_MICRODVD_PROBE_RE = re.compile(r"^\s*\{\d+\}\{\d+\}", re.MULTILINE)
_CYR_WORD_RUN_RE = re.compile(rb"[\xc0-\xff\xa3\xa8\xb3\xb8]{3,}")
_LATIN_ACCENT_MIX_RE = re.compile(rb"[A-Za-z][\xc0-\xff]|[\xc0-\xff][A-Za-z]")
_MAX_SUBTITLE_DECODED_BYTES = 8 * 1024 * 1024


def _strip_ass_tags_and_drawings(dlg: str) -> str:
    """
    Linear-time O(N) stripper for ASS override blocks `{...}` and vector drawing
    runs (`{\\p1}...{\\p0}`), immune to quadratic regex backtracking on malformed files.
    """
    if not dlg:
        return ""
    if "{" not in dlg:
        return dlg
    drawing = False
    out_parts: List[str] = []
    pos = 0
    for m in _ASS_TAG_RE.finditer(dlg):
        if not drawing and m.start() > pos:
            out_parts.append(dlg[pos : m.start()])
        tag_body = m.group(0)
        for dm in _ASS_DRAW_STATE_RE.finditer(tag_body):
            drawing = int(dm.group(1)) > 0
        pos = m.end()
    if not drawing and pos < len(dlg):
        tail = dlg[pos:]
        if "{" in tail:
            tail = tail.split("{", 1)[0]
        if tail:
            out_parts.append(tail)
    return "".join(out_parts)


def _safe_sub_int(val: Any, default: int = 0) -> int:
    try:
        return int(val)
    except Exception:
        return default


def convert_vtt_to_srt(vtt_text: str) -> str:
    """Converts WebVTT subtitle text to SubRip format for FFmpeg video filtering."""
    if not vtt_text:
        return ""
    lines = vtt_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out: List[str] = []
    cue_idx = 1
    started = False
    for line in lines:
        stripped = line.strip()
        if not started:
            if not stripped or stripped.startswith("WEBVTT") or stripped.startswith("NOTE") or stripped.startswith("STYLE"):
                continue
            if "-->" in stripped:
                started = True
                out.append(str(cue_idx))
                cue_idx += 1
                clean_ts = _VTT_TS_DOT_RE.sub(r"\1,\2", stripped)
                parts = clean_ts.split(" --> ")
                if len(parts) == 2:
                    out.append(f"{parts[0].strip().split(' ')[0]} --> {parts[1].strip().split(' ')[0]}")
                else:
                    out.append(clean_ts)
                continue
        else:
            if "-->" in stripped:
                out.append("")
                out.append(str(cue_idx))
                cue_idx += 1
                clean_ts = _VTT_TS_DOT_RE.sub(r"\1,\2", stripped)
                parts = clean_ts.split(" --> ")
                if len(parts) == 2:
                    out.append(f"{parts[0].strip().split(' ')[0]} --> {parts[1].strip().split(' ')[0]}")
                else:
                    out.append(clean_ts)
            else:
                out.append(stripped)
    return "\n".join(out).strip()


def decode_subtitle_bytes(raw_bytes: bytes) -> str:
    """
    Auto-decompresses gzipped or ZIP subtitle payloads and decodes UTF-8, UTF-16 (LE/BE),
    or Cyrillic Windows-1251 without mojibake.
    """
    if not raw_bytes:
        return ""
    data = bytes(raw_bytes)
    if len(data) >= 2 and data[0] == 0x1F and data[1] == 0x8B:
        try:
            # Multi-member + CRC-checked bounded inflate (8 MB cap)
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as gz:
                inflated = gz.read(_MAX_SUBTITLE_DECODED_BYTES + 1)
            if len(inflated) > _MAX_SUBTITLE_DECODED_BYTES:
                return ""
            data = inflated
        except Exception:
            return ""
    elif len(data) >= 4 and data[:4] == b"PK\x03\x04":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                sub_entry = next(
                    (
                        zi
                        for zi in zf.infolist()[:64]
                        if not zi.is_dir()
                        and zi.file_size <= _MAX_SUBTITLE_DECODED_BYTES
                        and not zi.filename.replace("\\", "/").startswith("__MACOSX/")
                        and not os.path.basename(zi.filename.replace("\\", "/")).startswith("._")
                        and zi.filename.lower().endswith((".srt", ".vtt", ".ass", ".ssa", ".sub"))
                    ),
                    None,
                )
                if not sub_entry:
                    return ""
                with zf.open(sub_entry) as zf_stream:
                    extracted = zf_stream.read(_MAX_SUBTITLE_DECODED_BYTES + 1)
                if len(extracted) > _MAX_SUBTITLE_DECODED_BYTES:
                    return ""
                data = extracted
        except Exception:
            return ""
    elif len(data) > _MAX_SUBTITLE_DECODED_BYTES:
        return ""

    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", errors="replace")
    if data.startswith(b"\xff\xfe"):
        return data[2:].decode("utf-16-le", errors="replace")
    if data.startswith(b"\xfe\xff"):
        return data[2:].decode("utf-16-be", errors="replace")

    if len(data) >= 4 and b"\x00" in data[:512]:
        sample = data[: min(len(data), 1024)]
        even_nuls = sum(1 for i in range(0, len(sample), 2) if sample[i] == 0)
        odd_nuls = sum(1 for i in range(1, len(sample), 2) if sample[i] == 0)
        if odd_nuls >= len(sample) * 0.20 and even_nuls <= len(sample) * 0.05:
            return data.decode("utf-16-le", errors="replace")
        if even_nuls >= len(sample) * 0.20 and odd_nuls <= len(sample) * 0.05:
            return data.decode("utf-16-be", errors="replace")

    try:
        return data.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        pass

    # Distinguish Cyrillic CP1251 / KOI8-R (contiguous 0xC0..0xFF words) from Western CP1252/Latin-1
    probe_bytes = data[:65536]
    high_bytes = [b for b in probe_bytes if b >= 0x80]
    cyr_range = sum(1 for b in high_bytes if 0xC0 <= b <= 0xFF or b in (0xA3, 0xA8, 0xB3, 0xB8))
    cyr_word_runs = len(_CYR_WORD_RUN_RE.findall(probe_bytes))
    latin_accent_mix = len(_LATIN_ACCENT_MIX_RE.findall(probe_bytes))
    if (
        cyr_word_runs >= 2
        or (cyr_word_runs >= 1 and cyr_word_runs > latin_accent_mix)
        or (not latin_accent_mix and high_bytes and (cyr_range / len(high_bytes)) >= 0.75)
    ):
        # In CP1251, lowercase Russian letters are 0xE0..0xFF (uppercase 0xC0..0xDF).
        # In KOI8-R, lowercase Russian letters are 0xC0..0xDF (uppercase 0xE0..0xFF).
        cnt_c0_df = sum(1 for b in high_bytes if 0xC0 <= b <= 0xDF)
        cnt_e0_ff = sum(1 for b in high_bytes if 0xE0 <= b <= 0xFF)
        if cnt_c0_df > cnt_e0_ff * 1.6 and (cnt_c0_df + cnt_e0_ff) >= 6:
            try:
                return data.decode("koi8-r", errors="replace")
            except Exception:
                pass
        try:
            return data.decode("cp1251", errors="replace")
        except Exception:
            pass
    try:
        return data.decode("cp1252", errors="replace")
    except Exception:
        return data.decode("latin-1", errors="replace")


def _parse_ass_ts(raw_ts: str) -> Optional[float]:
    m = _ASS_TS_RE.match(str(raw_ts or "").strip())
    if not m:
        return None
    hrs = int(m.group(1))
    mins = int(m.group(2))
    secs = int(m.group(3))
    frac_str = m.group(4)
    frac = int(frac_str) / (10.0 ** len(frac_str))
    return hrs * 3600.0 + mins * 60.0 + secs + frac


def _fmt_vtt_ts(sec: float) -> str:
    sec = max(0.0, sec)
    total_ms = int(round(sec * 1000))
    hrs, rem = divmod(total_ms, 3600_000)
    mins, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hrs:02d}:{mins:02d}:{secs:02d}.{ms:03d}"


def convert_ass_to_webvtt(raw_text: str, offset_sec: float = 0.0) -> str:
    """
    Converts SubStation Alpha (.ass / .ssa) subtitle files to valid WebVTT,
    preserving commas inside dialogue text and stripping override/drawing tags.
    """
    if not raw_text:
        return "WEBVTT\n\n"
    text = raw_text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    shift = max(0.0, float(offset_sec or 0.0))

    in_events = False
    format_cols: List[str] = [
        "layer",
        "start",
        "end",
        "style",
        "name",
        "marginl",
        "marginr",
        "marginv",
        "effect",
        "text",
    ]
    start_idx = 1
    end_idx = 2
    text_idx = 9
    cues: List[tuple] = []

    for raw_line in text.split("\n"):
        line = raw_line.strip()
        if not line or line.startswith(";"):
            continue
        low = line.lower()
        if line.startswith("[") and line.endswith("]"):
            in_events = low == "[events]"
            continue
        if not in_events and not low.startswith("dialogue:"):
            continue

        if low.startswith("format:"):
            cols = [c.strip().lower() for c in line[7:].split(",") if c.strip()]
            if "start" in cols and "end" in cols and "text" in cols:
                format_cols = cols
                start_idx = cols.index("start")
                end_idx = cols.index("end")
                text_idx = cols.index("text")
            continue

        if low.startswith("dialogue:"):
            body = line[9:].lstrip()
            parts = body.split(",", max(1, len(format_cols) - 1))
            if len(parts) <= max(start_idx, end_idx, text_idx):
                continue
            s_val = _parse_ass_ts(parts[start_idx])
            e_val = _parse_ass_ts(parts[end_idx])
            if s_val is None or e_val is None:
                continue
            s_shifted = s_val - shift
            e_shifted = e_val - shift
            if e_shifted <= 0.05 or e_shifted <= s_shifted:
                continue
            s_shifted = max(0.0, s_shifted)

            dlg = _strip_ass_tags_and_drawings(parts[text_idx])
            dlg = dlg.replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ")
            cleaned_lines = [ln.strip().replace("-->", "--&gt;") for ln in dlg.split("\n") if ln.strip()]
            if not cleaned_lines:
                continue
            cues.append((s_shifted, e_shifted, "\n".join(cleaned_lines)))

    cues.sort(key=lambda item: (item[0], item[1]))
    seen_cues = set()
    out_blocks = []
    for s, e, txt in cues:
        s_vtt = _fmt_vtt_ts(s)
        e_vtt = _fmt_vtt_ts(e)
        cue_sig = (s_vtt, e_vtt, txt)
        if cue_sig in seen_cues:
            continue
        seen_cues.add(cue_sig)
        out_blocks.append(f"{s_vtt} --> {e_vtt}\n{txt}")
    return "WEBVTT\n\n" + "\n\n".join(out_blocks) + "\n"


_MICRODVD_LINE_RE = re.compile(r"^\s*\{(\d+)\}\{(\d+)\}(.*)$")
_MICRODVD_FPS_RE = re.compile(r"^\s*(\d{2}(?:[.,]\d{1,4})?)\s*$")


def convert_microdvd_to_webvtt(raw_text: str, offset_sec: float = 0.0) -> str:
    """
    Converts MicroDVD (.sub) frame-based subtitles (`{start}{end}Text|Line2`) to WebVTT,
    adopting the file's FPS header cue (`{1}{1}25.000`) when present instead of rendering it.
    """
    if not raw_text:
        return "WEBVTT\n\n"
    text = raw_text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    shift = max(0.0, float(offset_sec or 0.0))
    fps = 23.976
    out_blocks: List[str] = []
    for raw_line in text.split("\n"):
        m = _MICRODVD_LINE_RE.match(raw_line)
        if not m:
            continue
        s_frame = int(m.group(1))
        e_frame = int(m.group(2))
        body = m.group(3).strip()
        if s_frame <= 1 and e_frame <= 1:
            m_fps = _MICRODVD_FPS_RE.match(body)
            if m_fps:
                try:
                    parsed_fps = float(m_fps.group(1).replace(",", "."))
                    if 10.0 <= parsed_fps <= 120.0:
                        fps = parsed_fps
                        continue
                except Exception:
                    pass
        if e_frame <= s_frame:
            e_frame = s_frame + int(round(fps * 2.0))
        s_sec = (s_frame / fps) - shift
        e_sec = (e_frame / fps) - shift
        if e_sec <= 0.05 or e_sec <= s_sec:
            continue
        s_sec = max(0.0, s_sec)
        cleaned_body = _ASS_TAG_RE.sub("", body)
        lines = [ln.strip().replace("-->", "--&gt;") for ln in cleaned_body.split("|") if ln.strip()]
        if not lines:
            continue
        out_blocks.append(f"{_fmt_vtt_ts(s_sec)} --> {_fmt_vtt_ts(e_sec)}\n" + "\n".join(lines))
    return "WEBVTT\n\n" + "\n\n".join(out_blocks) + "\n"


def convert_any_subtitle_to_webvtt(
    raw_input: Union[bytes, str],
    offset_sec: float = 0.0,
) -> str:
    text = decode_subtitle_bytes(raw_input) if isinstance(raw_input, (bytes, bytearray)) else str(raw_input or "")
    if not text.strip():
        return "WEBVTT\n\n"
    probe = text[:4096].lower()
    if "[script info]" in probe or "[v4+ styles]" in probe or "\ndialogue:" in probe or probe.startswith("dialogue:"):
        vtt = convert_ass_to_webvtt(text, offset_sec=offset_sec)
        if "-->" in vtt:
            return vtt
    if _MICRODVD_PROBE_RE.search(text[:2048]):
        vtt = convert_microdvd_to_webvtt(text, offset_sec=offset_sec)
        if "-->" in vtt:
            return vtt
    return convert_srt_or_vtt_to_webvtt(text, offset_sec=offset_sec)


class SubtitleSearchService:
    """
    Automatic external subtitle search by IMDb ID or title/year via OpenSubtitles v3
    and active Stremio subtitle addons, returning ready-to-play `/api/proxy-vtt` tracks.
    """

    OPENSUBTITLES_V3_BASE = "https://opensubtitles-v3.strem.io"

    LANG_LABELS_RU = {
        "rus": "Русский",
        "ru": "Русский",
        "eng": "Английский",
        "en": "Английский",
        "ukr": "Украинский",
        "uk": "Украинский",
        "deu": "Немецкий",
        "ger": "Немецкий",
        "de": "Немецкий",
        "fra": "Французский",
        "fre": "Французский",
        "fr": "Французский",
        "spa": "Испанский",
        "es": "Испанский",
        "ita": "Итальянский",
        "it": "Итальянский",
        "pol": "Польский",
        "pl": "Польский",
    }

    LANG_LABELS_EN = {
        "rus": "Russian",
        "ru": "Russian",
        "eng": "English",
        "en": "English",
        "ukr": "Ukrainian",
        "uk": "Ukrainian",
        "deu": "German",
        "ger": "German",
        "de": "German",
        "fra": "French",
        "fre": "French",
        "fr": "French",
        "spa": "Spanish",
        "es": "Spanish",
        "ita": "Italian",
        "it": "Italian",
        "pol": "Polish",
        "pl": "Polish",
    }

    def __init__(self, net_client: Any, stremio_engine: Any) -> None:
        self.net = net_client
        self.stremio = stremio_engine
        self._lock = threading.Lock()
        self._cache: Dict[str, tuple] = {}
        self._translate_cache: Dict[str, Dict[str, Any]] = {}
        self._search_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)

    _BUILTIN_EN_RU: Dict[str, tuple] = {
        "hello": ("привет", ["здравствуйте", "алло"]),
        "world": ("мир", ["свет", "вселенная"]),
        "love": ("любовь", ["любить", "дорожить"]),
        "time": ("время", ["раз", "момент"]),
        "life": ("жизнь", ["существование"]),
        "death": ("смерть", ["гибель"]),
        "night": ("ночь", ["вечер"]),
        "day": ("день", ["сутки"]),
        "home": ("дом", ["домой", "родина"]),
        "friend": ("друг", ["приятель", "товарищ"]),
        "family": ("семья", ["родные"]),
        "truth": ("правда", ["истина"]),
        "fear": ("страх", ["бояться", "опасение"]),
        "hope": ("надежда", ["надеяться"]),
        "power": ("сила", ["власть", "мощь"]),
        "money": ("деньги", ["средства"]),
        "water": ("вода", []),
        "fire": ("огонь", ["пламя", "пожар"]),
        "heart": ("сердце", ["душа"]),
        "mind": ("разум", ["ум", "сознание"]),
        "dream": ("мечта", ["сон", "мечтать"]),
        "believe": ("верить", ["полагать", "доверять"]),
        "remember": ("помнить", ["вспоминать"]),
        "forget": ("забыть", ["забывать"]),
        "understand": ("понимать", ["осознавать"]),
        "wait": ("ждать", ["подождать", "ожидание"]),
        "leave": ("уходить", ["оставить", "покидать"]),
        "stay": ("остаться", ["оставаться"]),
        "watch": ("смотреть", ["наблюдать", "часы"]),
        "listen": ("слушать", ["прислушаться"]),
        "speak": ("говорить", ["разговаривать"]),
        "silence": ("тишина", ["молчание"]),
        "shadow": ("тень", ["призрак"]),
        "light": ("свет", ["лёгкий", "освещение"]),
        "dark": ("тьма", ["тёмный", "мрак"]),
        "war": ("война", ["битва"]),
        "peace": ("мир", ["покой", "тишина"]),
        "blood": ("кровь", ["род"]),
        "secret": ("тайна", ["секрет", "скрытый"]),
        "promise": ("обещание", ["обещать", "клятва"]),
        "choice": ("выбор", ["решение"]),
        "destiny": ("судьба", ["предназначение"]),
        "chance": ("шанс", ["случай", "возможность"]),
        "danger": ("опасность", ["угроза"]),
        "safe": ("безопасный", ["в безопасности", "сейф"]),
        "trust": ("доверие", ["доверять", "полагаться"]),
        "betray": ("предать", ["предавать"]),
        "revenge": ("месть", ["возмездие"]),
        "forgive": ("простить", ["прощать"]),
        "guilt": ("вина", ["чувство вины"]),
        "innocent": ("невиновный", ["невинный"]),
        "witness": ("свидетель", ["очевидец"]),
        "evidence": ("улики", ["доказательство", "свидетельство"]),
        "murder": ("убийство", ["убить"]),
        "escape": ("побег", ["сбежать", "спастись"]),
        "survivor": ("выживший", ["уцелевший"]),
        "stranger": ("незнакомец", ["чужак"]),
        "enemy": ("враг", ["противник"]),
        "hero": ("герой", ["спаситель"]),
        "monster": ("чудовище", ["монстр"]),
    }

    _BUILTIN_RU_EN: Dict[str, str] = {}
    for _en_k, (_ru_v, _alt_list) in _BUILTIN_EN_RU.items():
        _BUILTIN_RU_EN.setdefault(_ru_v, _en_k)
        for _alt_w in _alt_list:
            _BUILTIN_RU_EN.setdefault(_alt_w, _en_k)

    def translate_subtitle_word(
        self,
        word: str,
        context: str = "",
        target_lang: str = "ru",
    ) -> Dict[str, Any]:
        stripped_word = re.sub(r"<[^>]+>|\{\\[^}]+\}", "", str(word or ""))
        stripped_ctx = re.sub(r"<[^>]+>|\{\\[^}]+\}", " ", str(context or ""))
        clean_word = re.sub(r"^[^\wА-Яа-яЁё'-]+|[^\wА-Яа-яЁё'-]+$", "", stripped_word.strip())
        clean_context = re.sub(r"\s+", " ", stripped_ctx.strip())[:240]
        if not clean_word or len(clean_word) > 64:
            return {"ok": False, "error": "Empty or invalid word"}

        has_cyr = bool(re.search(r"[А-Яа-яЁё]", clean_word))
        tl = str(target_lang or "").strip().lower()
        if tl not in ("ru", "en"):
            tl = "en" if has_cyr else "ru"
        elif (tl == "ru" and has_cyr) or (tl == "en" and not has_cyr):
            tl = "en" if has_cyr else "ru"

        cache_key = f"{tl}:{clean_word.lower()}:{clean_context.lower()}"
        with self._lock:
            cached = self._translate_cache.get(cache_key)
        if cached is not None:
            return copy.deepcopy(cached)

        w_low = clean_word.lower()
        primary = ""
        alternatives: List[str] = []
        context_tr = ""

        if tl == "ru" and w_low in self._BUILTIN_EN_RU:
            primary, alt_list = self._BUILTIN_EN_RU[w_low]
            alternatives = list(alt_list)
        elif tl == "en" and w_low in self._BUILTIN_RU_EN:
            primary = self._BUILTIN_RU_EN[w_low]

        if not primary:
            try:
                q_url = (
                    "https://translate.googleapis.com/translate_a/single"
                    f"?client=gtx&sl=auto&tl={ urllib.parse.quote(tl, safe='') }"
                    f"&dt=t&dt=bd&q={ urllib.parse.quote(clean_word, safe='') }"
                )
                status = 0
                raw = ""
                if hasattr(self.net, "fetch_text"):
                    status, raw = self.net.fetch_text(q_url, headers={"Accept": "application/json"}, timeout=2.5)
                elif hasattr(self.net, "request"):
                    status, raw, _ = self.net.request(
                        q_url,
                        headers={"Accept": "application/json"},
                        spoof_geo_country="DIRECT",
                        timeout=2.5,
                    )
                if status == 200 and raw:
                    parsed = json.loads(raw)
                    if isinstance(parsed, list) and parsed:
                        if isinstance(parsed[0], list) and parsed[0]:
                            segs = [str(seg[0]) for seg in parsed[0] if isinstance(seg, list) and seg and seg[0]]
                            joined = "".join(segs).strip()
                            if joined:
                                primary = joined
                        if len(parsed) > 1 and isinstance(parsed[1], list):
                            for pos_block in parsed[1]:
                                if isinstance(pos_block, list) and len(pos_block) >= 2 and isinstance(pos_block[1], list):
                                    for cand in pos_block[1]:
                                        c_str = str(cand or "").strip()
                                        if c_str and c_str.lower() != primary.lower() and c_str not in alternatives:
                                            alternatives.append(c_str)
                                            if len(alternatives) >= 5:
                                                break
            except Exception:
                pass

        if clean_context and clean_context.lower() != clean_word.lower():
            try:
                ctx_url = (
                    "https://translate.googleapis.com/translate_a/single"
                    f"?client=gtx&sl=auto&tl={ urllib.parse.quote(tl, safe='') }"
                    f"&dt=t&q={ urllib.parse.quote(clean_context, safe='') }"
                )
                c_status = 0
                c_raw = ""
                if hasattr(self.net, "fetch_text"):
                    c_status, c_raw = self.net.fetch_text(ctx_url, headers={"Accept": "application/json"}, timeout=2.5)
                elif hasattr(self.net, "request"):
                    c_status, c_raw, _ = self.net.request(
                        ctx_url,
                        headers={"Accept": "application/json"},
                        spoof_geo_country="DIRECT",
                        timeout=2.5,
                    )
                if c_status == 200 and c_raw:
                    c_parsed = json.loads(c_raw)
                    if isinstance(c_parsed, list) and c_parsed and isinstance(c_parsed[0], list):
                        c_segs = [str(seg[0]) for seg in c_parsed[0] if isinstance(seg, list) and seg and seg[0]]
                        context_tr = "".join(c_segs).strip()
            except Exception:
                pass

        if not primary:
            primary = clean_word

        res = {
            "ok": True,
            "word": clean_word,
            "target_lang": tl,
            "translation": primary,
            "alternatives": alternatives[:5],
            "context": clean_context,
            "context_translation": context_tr,
        }
        if primary.lower() != clean_word.lower() or alternatives or context_tr:
            with self._lock:
                if len(self._translate_cache) >= 512:
                    for k_old in list(self._translate_cache.keys())[:128]:
                        self._translate_cache.pop(k_old, None)
                self._translate_cache[cache_key] = res
        return copy.deepcopy(res)

    def _query_addon(self, base_url: str, addon_name: str, st_type: str, video_id: str) -> List[Dict[str, Any]]:
        enc_type = urllib.parse.quote(str(st_type or "movie").strip(), safe="")
        enc_vid = urllib.parse.quote(video_id, safe=":")
        url = f"{base_url.rstrip('/')}/subtitles/{enc_type}/{enc_vid}.json"
        if not StremioAddonEngine.is_safe_public_http_url(url):
            return []
        try:
            if hasattr(self.net, "fetch_text"):
                status, raw = self.net.fetch_text(
                    url,
                    headers={"Accept": "application/json"},
                    timeout=6.0,
                )
            else:
                status, raw, rh = self.net.request(
                    url,
                    headers={"Accept": "application/json"},
                    spoof_geo_country="DIRECT",
                    timeout=6,
                )
                final_u = str((rh or {}).get("_final_url") or url)
                if not StremioAddonEngine.is_safe_public_http_url(final_u):
                    return []
            if status != 200 or not raw:
                return []
            data = json.loads(raw)
            subs = data.get("subtitles") if isinstance(data, dict) else []
            if not isinstance(subs, list):
                return []
            out: List[Dict[str, Any]] = []
            for s in subs:
                if not isinstance(s, dict):
                    continue
                sub_url = str(s.get("url") or "").strip()
                if not StremioAddonEngine.is_safe_public_http_url(sub_url):
                    continue
                lang_raw = str(s.get("lang") or s.get("SubLanguageID") or "").strip().lower()
                out.append(
                    {
                        "raw_lang": lang_raw,
                        "url": sub_url,
                        "source": addon_name,
                    }
                )
            return out
        except Exception:
            return []

    def search_subtitles(
        self,
        item_id: str = "",
        imdb_id: str = "",
        title: str = "",
        orig_title: str = "",
        year: int = 0,
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        lang: str = "ru",
    ) -> Dict[str, Any]:
        ui_en = str(lang or "").strip().lower().startswith("en")
        st_type = "series" if str(media_type or "").strip().lower() == "series" else "movie"

        resolved_imdb = str(imdb_id or "").strip().lower()
        if not re.match(r"^tt\d{5,10}$", resolved_imdb):
            m_item_tt = re.match(r"^(?:stremio_|imdb_)?(tt\d{5,10})$", str(item_id or "").strip(), re.I)
            if m_item_tt:
                resolved_imdb = m_item_tt.group(1).lower()
            else:
                resolved_imdb = str(
                    self.stremio.resolve_imdb_id(
                        item_id=item_id,
                        title=title,
                        orig_title=orig_title,
                        year=_safe_sub_int(year, 0),
                        media_type=st_type,
                    )
                    or ""
                ).strip().lower()

        if not re.match(r"^tt\d{5,10}$", resolved_imdb):
            return {
                "ok": False,
                "imdb_id": "",
                "subtitles": [],
                "error": (
                    "Could not resolve IMDb ID for subtitle lookup"
                    if ui_en
                    else "Не удалось определить IMDb идентификатор для поиска субтитров"
                ),
            }

        video_id = (
            f"{resolved_imdb}:{max(1, _safe_sub_int(season, 1))}:{max(1, _safe_sub_int(episode, 1))}"
            if st_type == "series"
            else resolved_imdb
        )
        cache_key = f"{st_type}:{video_id}:{'en' if ui_en else 'ru'}"
        now = time.time()
        with self._lock:
            cached = self._cache.get(cache_key)
        if cached and (now - cached[0]) < 600:
            return copy.deepcopy(cached[1])

        endpoints: List[tuple] = [(self.OPENSUBTITLES_V3_BASE, "OpenSubtitles")]
        seen_bases = {self.OPENSUBTITLES_V3_BASE.rstrip("/")}
        for addon in self.stremio.get_addons():
            if not addon.get("enabled"):
                continue
            if "subtitles" not in (addon.get("resources") or []):
                continue
            if st_type not in (addon.get("types") or ["movie", "series"]):
                continue
            b_url = str(addon.get("base_url") or "").rstrip("/")
            if b_url and b_url not in seen_bases:
                seen_bases.add(b_url)
                endpoints.append((b_url, str(addon.get("name") or "Addon")))

        raw_tracks: List[Dict[str, Any]] = []
        pool = getattr(self, "_search_executor", None)
        own_pool = False
        if pool is None:
            pool = concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(4, len(endpoints))))
            own_pool = True
        try:
            futs = [
                pool.submit(self._query_addon, b_url, a_name, st_type, video_id)
                for b_url, a_name in endpoints
            ]
            done, _ = concurrent.futures.wait(futs, timeout=6.5)
            for fut in done:
                try:
                    raw_tracks.extend(fut.result(timeout=0.05) or [])
                except Exception:
                    pass
        finally:
            if own_pool:
                pool.shutdown(wait=False, cancel_futures=True)

        ru_bucket: List[Dict[str, Any]] = []
        en_bucket: List[Dict[str, Any]] = []
        other_bucket: List[Dict[str, Any]] = []
        seen_urls = set()

        for trk in raw_tracks:
            u = trk["url"]
            if u in seen_urls:
                continue
            seen_urls.add(u)
            rl = trk["raw_lang"]
            if rl in ("rus", "ru", "russian") or rl.startswith(("ru-", "ru_")):
                if len(ru_bucket) < 10:
                    ru_bucket.append(trk)
            elif rl in ("eng", "en", "english") or rl.startswith(("en-", "en_")):
                if len(en_bucket) < 10:
                    en_bucket.append(trk)
            else:
                if len(other_bucket) < 8:
                    other_bucket.append(trk)

        ordered = (en_bucket + ru_bucket + other_bucket) if ui_en else (ru_bucket + en_bucket + other_bucket)
        label_map = self.LANG_LABELS_EN if ui_en else self.LANG_LABELS_RU
        lang_counters: Dict[str, int] = {}
        final_subs: List[Dict[str, Any]] = []

        for trk in ordered:
            rl = trk["raw_lang"]
            base_label = label_map.get(rl) or (rl.upper() if rl else ("Subtitles" if ui_en else "Субтитры"))
            lang_counters[base_label] = lang_counters.get(base_label, 0) + 1
            idx = lang_counters[base_label]
            src_name = trk["source"]
            display_lang = f"{base_label} #{idx} · {src_name}"
            final_subs.append(
                {
                    "lang": display_lang,
                    "url": f"/api/proxy-vtt?url={urllib.parse.quote(trk['url'], safe='')}",
                    "direct_vtt": True,
                    "is_external_search": True,
                }
            )

        payload = {
            "ok": True,
            "imdb_id": resolved_imdb,
            "video_id": video_id,
            "subtitles": final_subs,
        }
        if final_subs:
            with self._lock:
                if len(self._cache) >= 80:
                    for k_old in list(self._cache.keys())[:20]:
                        self._cache.pop(k_old, None)
                self._cache[cache_key] = (now, payload)
        return copy.deepcopy(payload)
