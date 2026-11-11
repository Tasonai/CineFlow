import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.parse
from typing import Any, Dict, List, Optional


_SUBPROC_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_FFMPEG_NET_WHITELIST = "http,https,tcp,tls,crypto,data,httpproxy"
_CTRL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")
_WS_CHAR_RE = re.compile(r"\s")


def _is_valid_ffmpeg_http_url(url: str) -> bool:
    s = str(url or "").strip()
    if not s or _CTRL_CHAR_RE.search(s) or _WS_CHAR_RE.search(s):
        return False
    try:
        parsed = urllib.parse.urlparse(s)
        if parsed.username or parsed.password:
            return False
        _ = parsed.port
    except ValueError:
        return False
    if not (parsed.scheme in ("http", "https") and parsed.hostname):
        return False
    try:
        from .net_security import is_allowed_media_source_url
        return bool(is_allowed_media_source_url(s, allow_torrserver_loopback=True))
    except Exception:
        return False


def build_ffmpeg_env(source_url: str = "") -> Dict[str, str]:
    """Builds a subprocess environment that prevents corporate/VPN HTTP_PROXY from hijacking loopback streams."""
    env = dict(os.environ)
    no_proxy_items = [x.strip() for x in (env.get("NO_PROXY") or env.get("no_proxy") or "").split(",") if x.strip()]
    for loop_h in ("127.0.0.1", "localhost", "::1"):
        if loop_h not in no_proxy_items:
            no_proxy_items.append(loop_h)
    merged_np = ",".join(no_proxy_items)
    env["NO_PROXY"] = merged_np
    env["no_proxy"] = merged_np
    try:
        host = (urllib.parse.urlparse(str(source_url or "").strip()).hostname or "").strip().lower().strip("[]")
    except ValueError:
        host = ""
    if host in ("127.0.0.1", "localhost", "::1"):
        for pk in ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"):
            env.pop(pk, None)
    return env


_LANG_NAMES_RU = {
    "rus": "Русский",
    "ru": "Русский",
    "eng": "Английский (Оригинал)",
    "en": "Английский (Оригинал)",
    "ukr": "Украинский",
    "uk": "Украинский",
    "jpn": "Японский",
    "ja": "Японский",
    "kor": "Корейский",
    "ko": "Корейский",
    "deu": "Немецкий",
    "ger": "Немецкий",
    "fra": "Французский",
    "fre": "Французский",
    "spa": "Испанский",
    "ita": "Итальянский",
    "pol": "Польский",
    "pl": "Польский",
}

_LANG_NAMES_EN = {
    "rus": "Russian",
    "ru": "Russian",
    "eng": "English (Original)",
    "en": "English (Original)",
    "ukr": "Ukrainian",
    "uk": "Ukrainian",
    "jpn": "Japanese",
    "ja": "Japanese",
    "kor": "Korean",
    "ko": "Korean",
    "deu": "German",
    "ger": "German",
    "fra": "French",
    "fre": "French",
    "spa": "Spanish",
    "ita": "Italian",
    "pol": "Polish",
    "pl": "Polish",
}

_RU_DUB_MARKERS = ("рус", "дубляж", "rezka", "rhs", "lostfilm", "tvshows", "jaskier", "кубик", "alexfilm", "newstudio")

_BROWSER_SAFE_AUDIO_CODECS = {"aac", "mp3", "opus", "vorbis", "flac"}
_TEXT_SUBTITLE_CODECS = {"subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"}
_HW_CAPS_PROCESS_CACHE: Dict[str, Dict[str, Any]] = {}
_HW_CAPS_CACHE_LOCK = threading.Lock()
_CREDITS_CHAPTER_RE = re.compile(
    r"\b(end\s*credits?|closing\s*credits?|credits|outro|ending|титры|финальные\s*титры|конечные\s*титры|эндинг)\b",
    re.IGNORECASE,
)


class RemuxStreamEngine:
    """
    Zero-loss 4K UHD / HDR Video Copy + On-the-Fly Audio Remuxer (DTS / TrueHD / AC-3 / E-AC-3 -> AAC).
    - Probes upstream MKV/MP4/M2TS streams (TorrServer or Debrid HTTPS) via ffprobe in ~1s.
    - Lists all embedded audio tracks (Dubs, Voiceovers, Original) and text subtitle tracks.
    - Streams fragmented MP4 (`frag_keyframe+empty_moov+default_base_moof`) with `-c:v copy`
      (`-tag:v hvc1` for Apple VideoToolbox hardware 4K HDR decoding) and `-c:a aac` with
      dialogue-preserving stereo downmix when source audio has >2 channels.
    """

    def __init__(self, base_dir: str):
        bin_dir = os.path.join(base_dir, "backend", "bin")
        self.ffmpeg_path = self._find_binary("ffmpeg", bin_dir)
        self.ffprobe_path = self._find_binary("ffprobe", bin_dir)
        self._probe_cache: Dict[str, Dict[str, Any]] = {}
        self._probe_inflight: Dict[str, threading.Event] = {}
        self._probe_ttl_sec: float = 7200.0
        self._sub_cache: Dict[str, str] = {}
        self._snapshot_cache: Dict[Tuple[str, float, str], Tuple[float, bytes]] = {}
        self._lock = threading.Lock()
        self._hw_caps: Dict[str, Any] = self._init_hw_capabilities()

    @staticmethod
    def build_ffmpeg_env(source_url: str = "") -> Dict[str, str]:
        return build_ffmpeg_env(source_url)

    def _test_hw_encoder(self, encoder_name: str) -> bool:
        if not self.ffmpeg_path or not encoder_name:
            return False
        try:
            proc = subprocess.run(
                [
                    self.ffmpeg_path,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "nullsrc=s=128x128:d=0.04",
                    "-frames:v",
                    "1",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:v",
                    encoder_name,
                    "-f",
                    "null",
                    "-",
                ],
                capture_output=True,
                text=True,
                timeout=2.0,
                creationflags=_SUBPROC_NO_WINDOW,
            )
            return proc.returncode == 0
        except Exception:
            return False

    def _default_hw_capabilities(self) -> Dict[str, Any]:
        is_win = os.name == "nt"
        return {
            "videotoolbox_hwaccel": False,
            "d3d11va_hwaccel": is_win,
            "cuda_hwaccel": False,
            "h264_videotoolbox": False,
            "hevc_videotoolbox": False,
            "h264_nvenc": False,
            "h264_qsv": False,
            "h264_amf": False,
            "aac_at": False,
            "audio_encoder": "aac",
            "video_encoder": "libx264",
        }

    def _init_hw_capabilities(self) -> Dict[str, Any]:
        if not self.ffmpeg_path:
            return self._default_hw_capabilities()
        with _HW_CAPS_CACHE_LOCK:
            cached = _HW_CAPS_PROCESS_CACHE.get(self.ffmpeg_path)
            if cached is not None:
                return dict(cached)
        if os.name == "nt":
            initial_caps = self._default_hw_capabilities()

            def _bg_probe():
                probed = self._probe_hw_capabilities()
                with _HW_CAPS_CACHE_LOCK:
                    _HW_CAPS_PROCESS_CACHE[self.ffmpeg_path] = dict(probed)
                    if self._hw_caps is initial_caps:
                        self._hw_caps = probed

            threading.Thread(target=_bg_probe, name="VelariumFFmpegHwProbe", daemon=True).start()
            return initial_caps

        probed = self._probe_hw_capabilities()
        with _HW_CAPS_CACHE_LOCK:
            _HW_CAPS_PROCESS_CACHE[self.ffmpeg_path] = dict(probed)
        return probed

    def _probe_hw_capabilities(self) -> Dict[str, Any]:
        caps = self._default_hw_capabilities()
        if not self.ffmpeg_path:
            return caps
        try:
            hw_proc = subprocess.run(
                [self.ffmpeg_path, "-hide_banner", "-hwaccels"],
                capture_output=True,
                text=True,
                timeout=3.0,
                creationflags=_SUBPROC_NO_WINDOW,
            )
            hw_out = (hw_proc.stdout or "") + "\n" + (hw_proc.stderr or "")
            if "videotoolbox" in hw_out:
                caps["videotoolbox_hwaccel"] = True
            if "d3d11va" in hw_out:
                caps["d3d11va_hwaccel"] = True
            if "cuda" in hw_out:
                caps["cuda_hwaccel"] = True
        except Exception:
            pass
        try:
            enc_proc = subprocess.run(
                [self.ffmpeg_path, "-hide_banner", "-encoders"],
                capture_output=True,
                text=True,
                timeout=3.5,
                creationflags=_SUBPROC_NO_WINDOW,
            )
            enc_out = enc_proc.stdout or ""
            if "h264_videotoolbox" in enc_out:
                caps["h264_videotoolbox"] = True
                caps["video_encoder"] = "h264_videotoolbox"
            else:
                for hw_enc in ("h264_nvenc", "h264_qsv", "h264_amf"):
                    if hw_enc in enc_out and self._test_hw_encoder(hw_enc):
                        caps[hw_enc] = True
                        caps["video_encoder"] = hw_enc
                        break
            if "hevc_videotoolbox" in enc_out:
                caps["hevc_videotoolbox"] = True
            if "aac_at" in enc_out:
                caps["aac_at"] = True
                caps["audio_encoder"] = "aac_at"
        except Exception:
            pass
        return caps

    def get_hw_capabilities(self) -> Dict[str, Any]:
        active = bool(
            self._hw_caps.get("videotoolbox_hwaccel")
            or self._hw_caps.get("d3d11va_hwaccel")
            or self._hw_caps.get("cuda_hwaccel")
            or self._hw_caps.get("h264_videotoolbox")
            or self._hw_caps.get("h264_nvenc")
            or self._hw_caps.get("h264_qsv")
            or self._hw_caps.get("h264_amf")
            or self._hw_caps.get("aac_at")
        )
        parts: List[str] = []
        if self._hw_caps.get("h264_videotoolbox") or self._hw_caps.get("videotoolbox_hwaccel"):
            parts.append("VideoToolbox")
        if self._hw_caps.get("aac_at"):
            parts.append("AudioToolbox")
        if self._hw_caps.get("h264_nvenc") or self._hw_caps.get("cuda_hwaccel"):
            parts.append("NVIDIA NVENC")
        elif self._hw_caps.get("h264_qsv"):
            parts.append("Intel QuickSync")
        elif self._hw_caps.get("h264_amf"):
            parts.append("AMD AMF")
        elif self._hw_caps.get("d3d11va_hwaccel"):
            parts.append("Direct3D 11")
        return {
            **self._hw_caps,
            "active": active,
            "summary": " + ".join(parts) if parts else "Software FFmpeg",
        }

    @staticmethod
    def _find_binary(name: str, bin_dir: str, is_windows: Optional[bool] = None) -> str:
        win_mode = (os.name == "nt") if is_windows is None else bool(is_windows)
        if win_mode:
            exe_name = name if name.lower().endswith(".exe") else f"{name}.exe"
            candidates = [os.path.join(bin_dir, exe_name), os.path.join(bin_dir, name)]
            local_app_data = os.environ.get("LOCALAPPDATA", "")
            if local_app_data:
                candidates.append(os.path.join(local_app_data, "Microsoft", "WinGet", "Links", exe_name))
                candidates.append(os.path.join(local_app_data, "Programs", "CineFlow", "backend", "bin", exe_name))
            candidates.append(os.path.join("C:\\ffmpeg\\bin", exe_name))
            for cand in candidates:
                if os.path.isfile(cand):
                    return cand
            return shutil.which(exe_name) or shutil.which(name) or ""

        bundled = os.path.join(bin_dir, name)
        if os.path.isfile(bundled) and os.access(bundled, os.X_OK):
            return bundled
        for prefix in ("/opt/homebrew/bin", "/usr/local/bin"):
            cand = os.path.join(prefix, name)
            if os.path.isfile(cand) and os.access(cand, os.X_OK):
                return cand
        return shutil.which(name) or ""

    def is_available(self) -> bool:
        return bool(self.ffmpeg_path and self.ffprobe_path)

    @staticmethod
    def _format_channels_label(channels: int) -> str:
        if channels >= 8:
            return "7.1"
        if channels >= 6:
            return "5.1"
        if channels == 2:
            return "2.0"
        if channels == 1:
            return "1.0"
        return f"{channels}ch" if channels > 0 else ""

    def _build_audio_label(self, idx: int, stream: Dict[str, Any], ui_lang: str = "ru") -> str:
        tags = stream.get("tags") or {}
        raw_title = str(tags.get("title") or tags.get("TITLE") or "").strip()
        raw_lang = str(tags.get("language") or tags.get("LANGUAGE") or "").strip().lower()
        codec = str(stream.get("codec_name") or "audio").upper()
        channels = int(stream.get("channels") or 0)
        ch_label = self._format_channels_label(channels)

        lang_map = _LANG_NAMES_EN if ui_lang == "en" else _LANG_NAMES_RU
        lang_name = lang_map.get(raw_lang, raw_lang.upper() if raw_lang and raw_lang != "und" else "")
        parts: List[str] = []
        if raw_title:
            parts.append(raw_title)
            if lang_name and lang_name.lower() not in raw_title.lower() and (
                ui_lang == "en" or raw_lang not in ("rus", "ru")
            ):
                parts.append(lang_name)
        elif lang_name:
            parts.append(lang_name)
        else:
            parts.append(f"Track {idx + 1}" if ui_lang == "en" else f"Дорожка {idx + 1}")

        tech = " ".join(x for x in (codec, ch_label) if x)
        if tech:
            parts.append(f"[{tech}]")
        return " · ".join(parts)

    def _build_sub_label(self, idx: int, stream: Dict[str, Any], ui_lang: str = "ru") -> str:
        tags = stream.get("tags") or {}
        raw_title = str(tags.get("title") or tags.get("TITLE") or "").strip()
        raw_lang = str(tags.get("language") or tags.get("LANGUAGE") or "").strip().lower()
        lang_map = _LANG_NAMES_EN if ui_lang == "en" else _LANG_NAMES_RU
        lang_name = lang_map.get(raw_lang, raw_lang.upper() if raw_lang and raw_lang != "und" else "")
        disp = stream.get("disposition") or {}
        forced = bool(disp.get("forced"))

        fallback_lbl = f"Subtitles {idx + 1}" if ui_lang == "en" else f"Субтитры {idx + 1}"
        base = raw_title or lang_name or fallback_lbl
        if lang_name and raw_title and lang_name.lower() not in raw_title.lower():
            base = f"{lang_name} ({raw_title})"
        if forced and "форс" not in base.lower() and "forced" not in base.lower():
            base += " · Forced" if ui_lang == "en" else " · Форсированные"
        return base

    @staticmethod
    def _select_default_audio_index(audio_tracks: List[Dict[str, Any]], ui_lang: str = "ru") -> int:
        if not audio_tracks:
            return 0
        if ui_lang == "en":
            for tr in audio_tracks:
                lbl_low = str(tr.get("label") or "").lower()
                tr_lang = str(tr.get("lang") or "").lower()
                if tr_lang in ("eng", "en") and not any(k in lbl_low for k in _RU_DUB_MARKERS):
                    return int(tr["audio_index"])
            for tr in audio_tracks:
                lbl_low = str(tr.get("label") or "").lower()
                tr_lang = str(tr.get("lang") or "").lower()
                if (
                    tr_lang in ("jpn", "ja", "kor", "ko", "fra", "fre", "deu", "ger", "spa", "ita", "pol", "pl")
                    or any(k in lbl_low for k in ("original", "оригинал", "english", "английск"))
                ) and tr_lang not in ("rus", "ru") and not any(k in lbl_low for k in _RU_DUB_MARKERS):
                    return int(tr["audio_index"])
            for tr in audio_tracks:
                lbl_low = str(tr.get("label") or "").lower()
                tr_lang = str(tr.get("lang") or "").lower()
                if tr_lang not in ("rus", "ru") and not any(k in lbl_low for k in _RU_DUB_MARKERS):
                    return int(tr["audio_index"])
            return 0

        # Pass 1: explicit Russian language tag or Russian studio/dubbing marker
        for tr in audio_tracks:
            lbl_low = str(tr.get("label") or "").lower()
            tr_lang = str(tr.get("lang") or "").lower()
            if tr_lang in ("rus", "ru") or any(k in lbl_low for k in _RU_DUB_MARKERS):
                return int(tr["audio_index"])
        # Pass 2: generic "dub" label only when language tag is absent/undetermined (never match "English Dub")
        for tr in audio_tracks:
            lbl_low = str(tr.get("label") or "").lower()
            tr_lang = str(tr.get("lang") or "").lower()
            if tr_lang in ("", "und") and re.search(r"\bdub(?:bed|bing)?\b", lbl_low):
                return int(tr["audio_index"])
        return 0

    def _localize_probe_payload(self, base: Dict[str, Any], ui_lang: str) -> Dict[str, Any]:
        localized_audio = []
        for tr in base.get("audio_tracks") or []:
            raw_st = tr.get("_raw_stream")
            item = {k: v for k, v in tr.items() if k != "_raw_stream"}
            if isinstance(raw_st, dict):
                item["label"] = self._build_audio_label(int(item.get("audio_index") or 0), raw_st, ui_lang=ui_lang)
            localized_audio.append(item)

        localized_subs = []
        for idx, st in enumerate(base.get("subtitle_tracks") or []):
            raw_st = st.get("_raw_stream")
            item = {k: v for k, v in st.items() if k != "_raw_stream"}
            if isinstance(raw_st, dict):
                item["label"] = self._build_sub_label(idx, raw_st, ui_lang=ui_lang)
            localized_subs.append(item)

        out = {k: v for k, v in base.items() if k != "_ts"}
        out["audio_tracks"] = localized_audio
        out["subtitle_tracks"] = localized_subs
        out["default_audio_index"] = self._select_default_audio_index(localized_audio, ui_lang=ui_lang)
        return out

    @staticmethod
    def _parse_tag_hms_seconds(raw_val: Any) -> float:
        s = str(raw_val or "").strip()
        if not s:
            return 0.0
        try:
            fv = float(s)
            if fv > 1.0:
                return fv
        except (ValueError, TypeError):
            pass
        m = re.match(r"^(\d+):([0-5]?\d):([0-5]?\d(?:\.\d+)?)", s)
        if m:
            return int(m.group(1)) * 3600.0 + int(m.group(2)) * 60.0 + float(m.group(3))
        return 0.0

    @classmethod
    def _extract_best_duration(cls, fmt: Dict[str, Any], streams: List[Dict[str, Any]]) -> float:
        best = cls._parse_tag_hms_seconds(fmt.get("duration"))
        if best > 1.0:
            return best
        fmt_tags = fmt.get("tags") or {}
        if isinstance(fmt_tags, dict):
            for k, v in fmt_tags.items():
                if str(k).upper().startswith("DURATION"):
                    cand = cls._parse_tag_hms_seconds(v)
                    if cand > best:
                        best = cand
        for st in streams or []:
            cand_st = cls._parse_tag_hms_seconds(st.get("duration"))
            if cand_st > best:
                best = cand_st
            st_tags = st.get("tags") or {}
            if isinstance(st_tags, dict):
                for k, v in st_tags.items():
                    if str(k).upper().startswith("DURATION"):
                        cand_t = cls._parse_tag_hms_seconds(v)
                        if cand_t > best:
                            best = cand_t
        return best

    @classmethod
    def _extract_credits_chapter_sec(cls, chapters: List[Dict[str, Any]], duration: float) -> float:
        if not chapters or duration < 120.0:
            return 0.0
        min_sec = duration * 0.70
        for ch in chapters:
            if not isinstance(ch, dict):
                continue
            tags = ch.get("tags") or {}
            title = str(tags.get("title") or tags.get("TITLE") or "").strip()
            if not title or not _CREDITS_CHAPTER_RE.search(title):
                continue
            start_s = cls._parse_tag_hms_seconds(ch.get("start_time"))
            if min_sec <= start_s < duration - 2.0:
                return round(start_s, 1)
        return 0.0

    def probe_media(
        self,
        source_url: str,
        timeout_sec: float = 14.0,
        fast_probe: bool = False,
        lang: str = "ru",
    ) -> Dict[str, Any]:
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        clean_src = str(source_url or "").strip()
        if not _is_valid_ffmpeg_http_url(clean_src):
            return {"ok": False, "error": "Invalid source URL"}
        if not self.is_available():
            return {"ok": False, "error": "FFprobe not available", "remux_available": False}

        cache_key = hashlib.sha1(clean_src.encode("utf-8")).hexdigest()
        inflight_key = f"{cache_key}:{'fast' if fast_probe else 'full'}"
        now = time.time()
        with self._lock:
            cached = self._probe_cache.get(cache_key)
            if cached:
                cached_dur = float(cached.get("duration") or 0.0)
                if cached.get("_failed"):
                    ttl = 5.0
                else:
                    ttl = self._probe_ttl_sec if cached_dur > 1.0 else (3.5 if fast_probe else 0.0)
                if ttl > 0 and (now - cached.get("_ts", 0)) < ttl:
                    if cached.get("_failed"):
                        return {k: v for k, v in cached.items() if not str(k).startswith("_")}
                    return self._localize_probe_payload(cached, ui_lang=ui_lang)
            inflight_ev = self._probe_inflight.get(inflight_key)
            if inflight_ev is None:
                inflight_ev = threading.Event()
                self._probe_inflight[inflight_key] = inflight_ev
                is_leader = True
            else:
                is_leader = False

        if not is_leader:
            eff_wait = min(timeout_sec, 6.5) if fast_probe else max(timeout_sec, 14.0)
            inflight_ev.wait(timeout=eff_wait + 0.5)
            with self._lock:
                cached = self._probe_cache.get(cache_key)
                if cached:
                    now_after = time.time()
                    if cached.get("_failed") and (now_after - cached.get("_ts", 0)) < 5.0:
                        return {k: v for k, v in cached.items() if not str(k).startswith("_")}
                    cached_dur_after = float(cached.get("duration") or 0.0)
                    ttl_after = self._probe_ttl_sec if cached_dur_after > 1.0 else (3.5 if fast_probe else 0.0)
                    if not cached.get("_failed") and ttl_after > 0 and (now_after - cached.get("_ts", 0)) < ttl_after:
                        return self._localize_probe_payload(cached, ui_lang=ui_lang)

        analyze_us = "350000" if fast_probe else "1200000"
        probe_bytes = "350000" if fast_probe else "1000000"
        eff_timeout = min(timeout_sec, 6.5) if fast_probe else max(timeout_sec, 14.0)
        rw_timeout_us = str(int(max(5.0, eff_timeout) * 1_000_000))
        is_http_src = clean_src.lower().startswith(("http://", "https://"))
        cmd = [
            self.ffprobe_path,
            "-v",
            "quiet",
            "-rw_timeout",
            rw_timeout_us,
            "-protocol_whitelist",
            _FFMPEG_NET_WHITELIST,
            *(["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2"] if is_http_src else []),
            "-analyzeduration",
            analyze_us,
            "-probesize",
            probe_bytes,
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            "-show_chapters",
            "-i",
            clean_src,
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=eff_timeout,
                env=build_ffmpeg_env(clean_src),
                creationflags=_SUBPROC_NO_WINDOW,
            )
            if proc.returncode != 0 or not proc.stdout.strip():
                err_msg = (proc.stderr or "").strip()[:240] or "FFprobe failed to read container header"
                with self._lock:
                    self._probe_cache[cache_key] = {
                        "ok": False,
                        "error": err_msg,
                        "remux_available": True,
                        "_ts": time.time(),
                        "_failed": True,
                    }
                    if self._probe_inflight.get(inflight_key) is inflight_ev:
                        self._probe_inflight.pop(inflight_key, None)
                inflight_ev.set()
                return {"ok": False, "error": err_msg, "remux_available": True}
            parsed = json.loads(proc.stdout)
        except subprocess.TimeoutExpired:
            with self._lock:
                self._probe_cache[cache_key] = {
                    "ok": False,
                    "error": "Timeout probing torrent stream (peers warming up)",
                    "remux_available": True,
                    "_ts": time.time(),
                    "_failed": True,
                }
                if self._probe_inflight.get(inflight_key) is inflight_ev:
                    self._probe_inflight.pop(inflight_key, None)
            inflight_ev.set()
            return {"ok": False, "error": "Timeout probing torrent stream (peers warming up)", "remux_available": True}
        except Exception as exc:
            with self._lock:
                self._probe_cache[cache_key] = {
                    "ok": False,
                    "error": str(exc),
                    "remux_available": True,
                    "_ts": time.time(),
                    "_failed": True,
                }
                if self._probe_inflight.get(inflight_key) is inflight_ev:
                    self._probe_inflight.pop(inflight_key, None)
            inflight_ev.set()
            return {"ok": False, "error": str(exc), "remux_available": True}

        fmt = parsed.get("format") or {}
        fmt_name = str(fmt.get("format_name") or "").lower()
        streams = parsed.get("streams") or []
        chapters = parsed.get("chapters") or []
        duration = self._extract_best_duration(fmt, streams)
        credits_start_sec = self._extract_credits_chapter_sec(chapters, duration)
        video_codec = ""
        video_width = 0
        video_height = 0
        audio_tracks: List[Dict[str, Any]] = []
        subtitle_tracks: List[Dict[str, Any]] = []

        audio_ord = 0
        for st in streams:
            ctype = str(st.get("codec_type") or "").lower()
            cname = str(st.get("codec_name") or "").lower()
            if ctype == "video" and not video_codec and cname not in ("mjpeg", "png", "webp"):
                video_codec = cname
                video_width = int(st.get("width") or 0)
                video_height = int(st.get("height") or 0)
            elif ctype == "audio":
                channels = int(st.get("channels") or 2)
                tags = st.get("tags") or {}
                raw_lang = str(tags.get("language") or tags.get("LANGUAGE") or "").strip().lower()
                audio_tracks.append(
                    {
                        "audio_index": audio_ord,
                        "stream_index": int(st.get("index") or 0),
                        "codec": cname,
                        "channels": channels,
                        "lang": raw_lang,
                        "label": self._build_audio_label(audio_ord, st, ui_lang=ui_lang),
                        "browser_native_audio": cname in _BROWSER_SAFE_AUDIO_CODECS,
                        "_raw_stream": {
                            "tags": tags,
                            "codec_name": cname,
                            "channels": channels,
                        },
                    }
                )
                audio_ord += 1
            elif ctype == "subtitle" and cname in _TEXT_SUBTITLE_CODECS:
                s_idx = int(st.get("index") or 0)
                s_tags = st.get("tags") or {}
                s_lang = str(s_tags.get("language") or s_tags.get("LANGUAGE") or "").strip().lower()
                subtitle_tracks.append(
                    {
                        "stream_index": s_idx,
                        "codec": cname,
                        "lang": s_lang,
                        "label": self._build_sub_label(len(subtitle_tracks), st, ui_lang=ui_lang),
                        "_raw_stream": {
                            "tags": s_tags,
                            "disposition": st.get("disposition") or {},
                        },
                    }
                )

        priority_subs: List[Dict[str, Any]] = []
        other_subs: List[Dict[str, Any]] = []
        _prio_langs = {"rus", "ru", "eng", "en", "ukr", "uk", "pol", "pl"}
        for st_item in subtitle_tracks:
            st_lang = str(st_item.get("lang") or "").lower()
            st_lbl = str(st_item.get("label") or "").lower()
            if st_lang in _prio_langs or any(
                m in st_lbl for m in ("рус", "russian", "англ", "english", "укр", "ukrain", "polsk", "polish")
            ):
                priority_subs.append(st_item)
            else:
                other_subs.append(st_item)
        ordered_subtitles = (priority_subs + other_subs)[:40]

        default_audio_idx = self._select_default_audio_index(audio_tracks, ui_lang=ui_lang)

        is_mp4_webm = any(k in fmt_name for k in ("mp4", "mov", "webm")) and "matroska" not in fmt_name
        first_audio_safe = bool(audio_tracks and audio_tracks[0]["browser_native_audio"])
        needs_remux = bool(
            not is_mp4_webm
            or not first_audio_safe
            or len(audio_tracks) > 1
            or video_codec in ("hevc", "h265")
        )

        raw_result = {
            "ok": True,
            "remux_available": True,
            "format_name": fmt_name,
            "duration": round(duration, 2),
            "credits_start_sec": credits_start_sec,
            "video_codec": video_codec,
            "width": video_width,
            "height": video_height,
            "needs_remux": needs_remux,
            "default_audio_index": default_audio_idx,
            "audio_tracks": audio_tracks,
            "subtitle_tracks": ordered_subtitles,
        }
        with self._lock:
            if len(self._probe_cache) > 120:
                for k_old in list(self._probe_cache.keys())[:30]:
                    self._probe_cache.pop(k_old, None)
            self._probe_cache[cache_key] = {**raw_result, "_ts": now}
            if self._probe_inflight.get(inflight_key) is inflight_ev:
                self._probe_inflight.pop(inflight_key, None)
        inflight_ev.set()
        return self._localize_probe_payload(raw_result, ui_lang=ui_lang)

    def extract_subtitle_vtt(
        self,
        source_url: str,
        stream_index: int,
        start_sec: float = 0.0,
        window_sec: float = 120.0,
        timeout_sec: float = 8.0,
    ) -> str:
        clean_src = str(source_url or "").strip()
        if not self.is_available() or not _is_valid_ffmpeg_http_url(clean_src):
            return "WEBVTT\n\n"
        norm_start = max(0.0, round(float(start_sec or 0.0), 1))
        norm_win = max(60.0, min(600.0, round(float(window_sec or 120.0), 0)))
        cache_key = (
            f"{hashlib.sha1(clean_src.encode('utf-8')).hexdigest()}"
            f":s{int(stream_index)}:ss{norm_start:.1f}:w{int(norm_win)}"
        )
        with self._lock:
            if cache_key in self._sub_cache:
                return self._sub_cache[cache_key]

        rw_timeout_us = str(int(max(5.0, float(timeout_sec or 8.0)) * 1_000_000))
        sub_probe_val = "2000000" if norm_start > 0.5 else "400000"
        cmd: List[str] = [
            self.ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
            "-probesize",
            sub_probe_val,
            "-analyzeduration",
            sub_probe_val,
            "-reconnect",
            "1",
            "-reconnect_streamed",
            "1",
            "-reconnect_delay_max",
            "3",
            "-rw_timeout",
            rw_timeout_us,
            "-protocol_whitelist",
            _FFMPEG_NET_WHITELIST,
        ]
        # Place -ss BEFORE -i so FFmpeg performs an instant HTTP Range seek on TorrServer/Debrid
        # AND shifts output WEBVTT cue timestamps to 00:00:00.000 — matching build_remux_command 1:1!
        if norm_start > 0.5:
            cmd.extend(["-ss", f"{norm_start:.2f}"])
        cmd.extend(
            [
                "-i",
                clean_src,
                "-t",
                f"{int(norm_win)}",
                "-map",
                f"0:{int(stream_index)}",
                "-f",
                "webvtt",
                "pipe:1",
            ]
        )
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=timeout_sec,
                env=build_ffmpeg_env(clean_src),
                creationflags=_SUBPROC_NO_WINDOW,
            )
            raw_out = (proc.stdout or b"").decode("utf-8", errors="replace")
            vtt = raw_out if "WEBVTT" in raw_out else "WEBVTT\n\n"
            if len(vtt) > 16:
                with self._lock:
                    if len(self._sub_cache) > 80:
                        for k_old in list(self._sub_cache.keys())[:20]:
                            self._sub_cache.pop(k_old, None)
                    self._sub_cache[cache_key] = vtt
            return vtt
        except subprocess.TimeoutExpired as exc:
            # On cold 50 GB torrents, return all complete cues already demuxed before timeout
            partial_bytes = exc.stdout if isinstance(exc.stdout, (bytes, bytearray)) else (
                (exc.stdout or "").encode("utf-8", errors="ignore")
            )
            partial_str = partial_bytes.decode("utf-8", errors="replace")
            if "WEBVTT" in partial_str:
                last_sep = partial_str.rfind("\n\n")
                trimmed = (partial_str[: last_sep + 2] if last_sep > 6 else partial_str + "\n\n")
                if len(trimmed) > 16:
                    return trimmed
            return "WEBVTT\n\n"
        except Exception:
            return "WEBVTT\n\n"

    _MP4_COPY_SAFE_VCODECS = frozenset(
        {"", "h264", "avc", "avc1", "hevc", "h265", "hev1", "hvc1", "av1", "av01"}
    )

    def build_remux_command(
        self,
        source_url: str,
        audio_index: int = 0,
        start_sec: float = 0.0,
        video_codec: str = "",
        channels: int = 2,
        audio_codec: str = "",
        force_h264: bool = False,
        audio_offset_sec: float = 0.0,
        subtitles_file: str = "",
        subtitle_index: Optional[int] = None,
    ) -> List[str]:
        clean_src = str(source_url or "").strip()
        if not _is_valid_ffmpeg_http_url(clean_src):
            raise ValueError("Invalid remux source URL")
        v_low = (video_codec or "").strip().lower()
        a_low = (audio_codec or "").strip().lower()
        ch_count = max(1, int(channels or 2))
        a_shift = max(-5.0, min(5.0, float(audio_offset_sec or 0.0)))
        has_audio_shift = abs(a_shift) >= 0.005

        sub_filter = ""
        clean_sub_file = str(subtitles_file or "").strip()
        if clean_sub_file and not _CTRL_CHAR_RE.search(clean_sub_file) and ".." not in clean_sub_file:
            esc_path = (
                clean_sub_file.replace("\\", "/")
                .replace(":", "\\:")
                .replace("'", "'\\''")
                .replace(",", "\\,")
                .replace(";", "\\;")
                .replace("[", "\\[")
                .replace("]", "\\]")
            )
            sub_filter = f"subtitles='{esc_path}':force_style='FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,MarginV=25'"
        elif subtitle_index is not None and int(subtitle_index) >= 0 and not any(ch in clean_src for ch in ("'", ",", ";", "[", "]")):
            esc_src = clean_src.replace("\\", "/").replace("'", "'\\''").replace(":", "\\:")
            sub_filter = f"subtitles='{esc_src}':si={int(subtitle_index)}:force_style='FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,MarginV=25'"

        need_video_transcode = bool(
            bool(sub_filter)
            or (force_h264 and v_low not in ("h264", "avc", "avc1"))
            or (v_low and v_low not in self._MP4_COPY_SAFE_VCODECS)
        )

        cmd: List[str] = [
            self.ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
        ]
        if need_video_transcode and not sub_filter:
            if self._hw_caps.get("videotoolbox_hwaccel"):
                cmd.extend(["-hwaccel", "videotoolbox"])
            elif self._hw_caps.get("d3d11va_hwaccel"):
                cmd.extend(["-hwaccel", "d3d11va"])

        if clean_src.startswith(("http://", "https://")):
            if start_sec > 0.5:
                probe_val = "5000000"
            else:
                probe_val = "384000" if v_low else "500000"
            cmd.extend(
                [
                    "-probesize",
                    probe_val,
                    "-analyzeduration",
                    probe_val,
                    "-reconnect",
                    "1",
                    "-reconnect_streamed",
                    "1",
                    "-reconnect_delay_max",
                    "5",
                    # Fail a dead torrent / CDN after 60 s instead of hanging the remux session forever
                    "-rw_timeout",
                    "60000000",
                    "-protocol_whitelist",
                    _FFMPEG_NET_WHITELIST,
                ]
            )
        if start_sec > 0.5:
            if not need_video_transcode:
                # Keep copied video and transcoded audio locked to the exact same keyframe cluster on seek/resume
                cmd.extend(["-noaccurate_seek"])
            cmd.extend(["-ss", f"{start_sec:.2f}"])

        cmd.extend(
            [
                "-fflags",
                "+discardcorrupt",
                "-thread_queue_size",
                "1024",
                "-i",
                clean_src,
                "-map",
                "0:v:0",
                "-map",
                f"0:a:{max(0, int(audio_index))}?",
            ]
        )

        if need_video_transcode:
            if sub_filter:
                eff_sub_filter = (
                    f"setpts=PTS+{start_sec:.2f}/TB,{sub_filter},setpts=PTS-STARTPTS"
                    if start_sec > 0.5
                    else sub_filter
                )
                cmd.extend(["-vf", eff_sub_filter])
            if self._hw_caps.get("h264_videotoolbox"):
                cmd.extend(
                    [
                        "-c:v",
                        "h264_videotoolbox",
                        "-realtime",
                        "1",
                        "-b:v",
                        "12M",
                        "-maxrate",
                        "16M",
                        "-bufsize",
                        "24M",
                        "-pix_fmt",
                        "yuv420p",
                    ]
                )
            elif self._hw_caps.get("h264_nvenc"):
                cmd.extend(
                    [
                        "-c:v",
                        "h264_nvenc",
                        "-preset",
                        "p3",
                        "-b:v",
                        "12M",
                        "-maxrate",
                        "16M",
                        "-bufsize",
                        "24M",
                        "-pix_fmt",
                        "yuv420p",
                    ]
                )
            elif self._hw_caps.get("h264_qsv"):
                cmd.extend(
                    [
                        "-c:v",
                        "h264_qsv",
                        "-b:v",
                        "12M",
                        "-maxrate",
                        "16M",
                        "-bufsize",
                        "24M",
                        "-pix_fmt",
                        "yuv420p",
                    ]
                )
            elif self._hw_caps.get("h264_amf"):
                cmd.extend(
                    [
                        "-c:v",
                        "h264_amf",
                        "-b:v",
                        "12M",
                        "-maxrate",
                        "16M",
                        "-bufsize",
                        "24M",
                        "-pix_fmt",
                        "yuv420p",
                    ]
                )
            else:
                cmd.extend(
                    [
                        "-c:v",
                        "libx264",
                        "-preset",
                        "veryfast",
                        "-crf",
                        "21",
                        "-pix_fmt",
                        "yuv420p",
                    ]
                )
        else:
            cmd.extend(["-c:v", "copy"])
            if v_low in ("hevc", "h265"):
                # Tag HEVC as hvc1 so Apple VideoToolbox / Safari / Chrome hardware decoder plays 4K HDR smoothly
                cmd.extend(["-tag:v", "hvc1"])

        # Zero-loss passthrough if source audio is already 1ch/2ch AAC without custom audio sync shift;
        # otherwise transcode via AudioToolbox / AAC with async PTS alignment and optional sample-accurate offset
        if a_low in ("aac", "mp4a") and ch_count <= 2 and not has_audio_shift:
            cmd.extend(["-c:a", "copy"])
        else:
            af_parts: List[str] = ["aresample=async=1"]
            if ch_count >= 6:
                af_parts.append(
                    "pan=stereo|FL<0.75*FC+0.60*FL+0.40*BL+0.40*SL+0.25*LFE|FR<0.75*FC+0.60*FR+0.40*BR+0.40*SR+0.25*LFE"
                )
            if a_shift < -0.005:
                af_parts.append(f"atrim=start={abs(a_shift):.3f},asetpts=PTS-STARTPTS")
            elif a_shift > 0.005:
                delay_ms = max(1, int(round(a_shift * 1000.0)))
                af_parts.append(f"adelay={delay_ms}:all=1")
            cmd.extend(["-af", ",".join(af_parts)])
            audio_enc = "aac_at" if self._hw_caps.get("aac_at") else "aac"
            cmd.extend(
                [
                    "-c:a",
                    audio_enc,
                    "-b:a",
                    "256k",
                    "-ac",
                    "2",
                    "-ar",
                    "48000",
                ]
            )

        cmd.extend(
            [
                "-sn",
                "-dn",
                "-max_muxing_queue_size",
                "2048",
                "-muxdelay",
                "0",
                "-muxpreload",
                "0",
                "-avoid_negative_ts",
                "make_zero",
                "-frag_duration",
                "200000",
                "-movflags",
                "delay_moov+default_base_moof",
                "-f",
                "mp4",
                "pipe:1",
            ]
        )
        return cmd

    def capture_frame_png(
        self,
        source_url: str,
        timestamp_sec: float = 0.0,
        timeout_sec: float = 9.0,
        local_file_path: str = "",
    ) -> bytes:
        clean_local = str(local_file_path or "").strip()
        is_local_file = bool(clean_local and os.path.isfile(clean_local))
        clean_src = clean_local if is_local_file else str(source_url or "").strip()
        if not self.is_available() or (not is_local_file and not _is_valid_ffmpeg_http_url(clean_src)):
            return b""
        ts = max(0.0, round(float(timestamp_sec or 0.0), 2))
        snap_key = (clean_src, round(ts, 1), "local" if is_local_file else "net")
        now_snap = time.time()
        with self._lock:
            cached_snap = self._snapshot_cache.get(snap_key)
            if cached_snap and (now_snap - cached_snap[0]) < 300.0:
                return cached_snap[1]
        rw_timeout_us = str(int(max(5.0, float(timeout_sec or 9.0)) * 1_000_000))
        cmd: List[str] = [
            self.ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
        ]
        if self._hw_caps.get("videotoolbox_hwaccel"):
            cmd.extend(["-hwaccel", "videotoolbox"])
        if not is_local_file:
            cmd.extend(
                [
                    "-reconnect",
                    "1",
                    "-reconnect_streamed",
                    "1",
                    "-rw_timeout",
                    rw_timeout_us,
                    "-protocol_whitelist",
                    _FFMPEG_NET_WHITELIST,
                ]
            )
        if ts > 0.1:
            cmd.extend(["-ss", f"{ts:.2f}"])
        cmd.extend(
            [
                "-i",
                clean_src,
                "-frames:v",
                "1",
                "-f",
                "image2pipe",
                "-vcodec",
                "png",
                "pipe:1",
            ]
        )
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=timeout_sec,
                env=None if is_local_file else build_ffmpeg_env(clean_src),
                creationflags=_SUBPROC_NO_WINDOW,
            )
            out = proc.stdout or b""
            if out[:8] == b"\x89PNG\r\n\x1a\n":
                with self._lock:
                    if len(self._snapshot_cache) >= 32:
                        oldest_k = next(iter(self._snapshot_cache))
                        self._snapshot_cache.pop(oldest_k, None)
                    self._snapshot_cache[snap_key] = (time.time(), out)
                return out
            return b""
        except Exception:
            return b""
