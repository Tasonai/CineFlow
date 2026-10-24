import hashlib
import json
import os
import shutil
import subprocess
import threading
import time
from typing import Any, Dict, List, Optional


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
        self._sub_cache: Dict[str, str] = {}
        self._lock = threading.Lock()
        self._hw_caps: Dict[str, Any] = self._probe_hw_capabilities()

    def _probe_hw_capabilities(self) -> Dict[str, Any]:
        caps = {
            "videotoolbox_hwaccel": False,
            "h264_videotoolbox": False,
            "hevc_videotoolbox": False,
            "aac_at": False,
            "audio_encoder": "aac",
            "video_encoder": "libx264",
        }
        if not self.ffmpeg_path:
            return caps
        try:
            hw_proc = subprocess.run(
                [self.ffmpeg_path, "-hide_banner", "-hwaccels"],
                capture_output=True,
                text=True,
                timeout=3.0,
            )
            hw_out = (hw_proc.stdout or "") + "\n" + (hw_proc.stderr or "")
            if "videotoolbox" in hw_out:
                caps["videotoolbox_hwaccel"] = True
        except Exception:
            pass
        try:
            enc_proc = subprocess.run(
                [self.ffmpeg_path, "-hide_banner", "-encoders"],
                capture_output=True,
                text=True,
                timeout=3.5,
            )
            enc_out = enc_proc.stdout or ""
            if "h264_videotoolbox" in enc_out:
                caps["h264_videotoolbox"] = True
                caps["video_encoder"] = "h264_videotoolbox"
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
            or self._hw_caps.get("h264_videotoolbox")
            or self._hw_caps.get("aac_at")
        )
        parts: List[str] = []
        if self._hw_caps.get("h264_videotoolbox") or self._hw_caps.get("videotoolbox_hwaccel"):
            parts.append("VideoToolbox")
        if self._hw_caps.get("aac_at"):
            parts.append("AudioToolbox")
        return {
            **self._hw_caps,
            "active": active,
            "summary": " + ".join(parts) if parts else "Software FFmpeg",
        }

    @staticmethod
    def _find_binary(name: str, bin_dir: str) -> str:
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

        for tr in audio_tracks:
            lbl_low = str(tr.get("label") or "").lower()
            if tr.get("lang") in ("rus", "ru") or any(k in lbl_low for k in (*_RU_DUB_MARKERS, "dub")):
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

    def probe_media(
        self,
        source_url: str,
        timeout_sec: float = 14.0,
        fast_probe: bool = False,
        lang: str = "ru",
    ) -> Dict[str, Any]:
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        if not source_url or not source_url.startswith(("http://", "https://")):
            return {"ok": False, "error": "Invalid source URL"}
        if not self.is_available():
            return {"ok": False, "error": "FFprobe not available", "remux_available": False}

        cache_key = hashlib.sha1(source_url.encode("utf-8")).hexdigest()
        now = time.time()
        with self._lock:
            cached = self._probe_cache.get(cache_key)
            if cached:
                cached_dur = float(cached.get("duration") or 0.0)
                ttl = 1800.0 if cached_dur > 1.0 else (3.5 if fast_probe else 0.0)
                if ttl > 0 and (now - cached.get("_ts", 0)) < ttl:
                    return self._localize_probe_payload(cached, ui_lang=ui_lang)

        analyze_us = "500000" if fast_probe else "1500000"
        probe_bytes = "500000" if fast_probe else "1200000"
        eff_timeout = timeout_sec if fast_probe else max(timeout_sec, 16.0)
        cmd = [
            self.ffprobe_path,
            "-v",
            "quiet",
            "-analyzeduration",
            analyze_us,
            "-probesize",
            probe_bytes,
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            source_url,
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=eff_timeout,
            )
            if proc.returncode != 0 or not proc.stdout.strip():
                err_msg = (proc.stderr or "").strip()[:240] or "FFprobe failed to read container header"
                return {"ok": False, "error": err_msg, "remux_available": True}
            parsed = json.loads(proc.stdout)
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "Timeout probing torrent stream (peers warming up)", "remux_available": True}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "remux_available": True}

        fmt = parsed.get("format") or {}
        fmt_name = str(fmt.get("format_name") or "").lower()
        streams = parsed.get("streams") or []
        duration = self._extract_best_duration(fmt, streams)
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
                subtitle_tracks.append(
                    {
                        "stream_index": s_idx,
                        "codec": cname,
                        "label": self._build_sub_label(len(subtitle_tracks), st, ui_lang=ui_lang),
                        "_raw_stream": {
                            "tags": st.get("tags") or {},
                            "disposition": st.get("disposition") or {},
                        },
                    }
                )

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
            "video_codec": video_codec,
            "width": video_width,
            "height": video_height,
            "needs_remux": needs_remux,
            "default_audio_index": default_audio_idx,
            "audio_tracks": audio_tracks,
            "subtitle_tracks": subtitle_tracks[:12],
        }
        with self._lock:
            if len(self._probe_cache) > 120:
                self._probe_cache.clear()
            self._probe_cache[cache_key] = {**raw_result, "_ts": now}
        return self._localize_probe_payload(raw_result, ui_lang=ui_lang)

    def extract_subtitle_vtt(
        self,
        source_url: str,
        stream_index: int,
        start_sec: float = 0.0,
        window_sec: float = 420.0,
        timeout_sec: float = 8.0,
    ) -> str:
        if not self.is_available() or not source_url.startswith(("http://", "https://")):
            return "WEBVTT\n\n"
        norm_start = max(0.0, round(float(start_sec or 0.0), 1))
        norm_win = max(120.0, min(900.0, round(float(window_sec or 420.0), 0)))
        cache_key = (
            f"{hashlib.sha1(source_url.encode('utf-8')).hexdigest()}"
            f":s{int(stream_index)}:ss{norm_start:.1f}:w{int(norm_win)}"
        )
        with self._lock:
            if cache_key in self._sub_cache:
                return self._sub_cache[cache_key]

        cmd: List[str] = [
            self.ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
            "-probesize",
            "1200000",
            "-analyzeduration",
            "1200000",
            "-reconnect",
            "1",
            "-reconnect_streamed",
            "1",
            "-reconnect_delay_max",
            "3",
        ]
        # Place -ss BEFORE -i so FFmpeg performs an instant HTTP Range seek on TorrServer/Debrid
        # AND shifts output WEBVTT cue timestamps to 00:00:00.000 — matching build_remux_command 1:1!
        if norm_start > 0.5:
            cmd.extend(["-ss", f"{norm_start:.2f}"])
        cmd.extend(
            [
                "-i",
                source_url,
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
            proc = subprocess.run(cmd, capture_output=True, timeout=timeout_sec)
            raw_out = (proc.stdout or b"").decode("utf-8", errors="replace")
            vtt = raw_out if "WEBVTT" in raw_out else "WEBVTT\n\n"
            if len(vtt) > 16:
                with self._lock:
                    if len(self._sub_cache) > 80:
                        self._sub_cache.clear()
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
    ) -> List[str]:
        v_low = (video_codec or "").strip().lower()
        a_low = (audio_codec or "").strip().lower()
        ch_count = max(1, int(channels or 2))

        need_video_transcode = bool(
            (force_h264 and v_low not in ("h264", "avc", "avc1"))
            or (v_low and v_low not in self._MP4_COPY_SAFE_VCODECS)
        )

        cmd: List[str] = [
            self.ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
        ]
        if need_video_transcode and self._hw_caps.get("videotoolbox_hwaccel"):
            cmd.extend(["-hwaccel", "videotoolbox"])

        if source_url.startswith(("http://", "https://")):
            cmd.extend(
                [
                    "-reconnect",
                    "1",
                    "-reconnect_streamed",
                    "1",
                    "-reconnect_delay_max",
                    "5",
                ]
            )
        if start_sec > 0.5:
            cmd.extend(["-ss", f"{start_sec:.2f}"])

        cmd.extend(
            [
                "-i",
                source_url,
                "-map",
                "0:v:0",
                "-map",
                f"0:a:{max(0, int(audio_index))}?",
            ]
        )

        if need_video_transcode:
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

        # Zero-loss passthrough if source audio is already 1ch/2ch AAC; otherwise use AudioToolbox / stereo downmix
        if a_low in ("aac", "mp4a") and ch_count <= 2:
            cmd.extend(["-c:a", "copy"])
        else:
            if ch_count >= 6:
                cmd.extend(
                    [
                        "-af",
                        "pan=stereo|FL<0.75*FC+0.60*FL+0.40*BL+0.40*SL+0.25*LFE|FR<0.75*FC+0.60*FR+0.40*BR+0.40*SR+0.25*LFE",
                    ]
                )
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
                "-movflags",
                "frag_keyframe+empty_moov+default_base_moof",
                "-f",
                "mp4",
                "pipe:1",
            ]
        )
        return cmd

    def capture_frame_png(self, source_url: str, timestamp_sec: float = 0.0, timeout_sec: float = 9.0) -> bytes:
        if not self.is_available() or not source_url.startswith(("http://", "https://")):
            return b""
        ts = max(0.0, round(float(timestamp_sec or 0.0), 2))
        cmd: List[str] = [
            self.ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
        ]
        if self._hw_caps.get("videotoolbox_hwaccel"):
            cmd.extend(["-hwaccel", "videotoolbox"])
        cmd.extend(
            [
                "-reconnect",
                "1",
                "-reconnect_streamed",
                "1",
            ]
        )
        if ts > 0.1:
            cmd.extend(["-ss", f"{ts:.2f}"])
        cmd.extend(
            [
                "-i",
                source_url,
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
            proc = subprocess.run(cmd, capture_output=True, timeout=timeout_sec)
            out = proc.stdout or b""
            return out if out[:8] == b"\x89PNG\r\n\x1a\n" else b""
        except Exception:
            return b""
