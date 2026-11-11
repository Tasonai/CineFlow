from collections import deque
import hashlib
import ipaddress
import json
import os
import queue
import re
import shutil
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from .profiles import ProfileManager
from .remuxer import build_ffmpeg_env
from .storage_db import get_storage_db
from .subtitles import convert_any_subtitle_to_webvtt


_SUBPROC_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_SHARED_SSL_CTX = ssl.create_default_context()
_FFMPEG_NET_WHITELIST = "http,https,tcp,tls,crypto,data,httpproxy"
_CTRL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")
_MIN_FREE_DISK_BYTES = 256 * 1024 * 1024


def parse_http_byte_range(range_header: str, file_size: int) -> Optional[Tuple[int, int]]:
    """
    Parses an HTTP `Range: bytes=start-end` header against `file_size`.
    Returns `(start, end)` inclusive if valid, or `None` if no valid Range header is present.
    Raises `ValueError` if Range is syntactically bytes= but out of bounds (416).
    """
    if not range_header:
        return None
    s = range_header.strip()
    if not s.lower().startswith("bytes="):
        return None
    if file_size <= 0:
        raise ValueError("Empty resource")
    raw_spec = s[6:].strip()
    if "," in raw_spec:
        # Multi-part byte ranges are unsupported; RFC 9110 §14.2 allows ignoring or 416
        return None
    if "-" not in raw_spec:
        return None
    start_str, end_str = raw_spec.split("-", 1)
    start_str = start_str.strip()
    end_str = end_str.strip()
    if len(start_str) > 20 or len(end_str) > 20:
        raise ValueError("Range bounds overflow")
    if start_str == "":
        if not (end_str.isascii() and end_str.isdigit()):
            return None
        suffix_len = int(end_str)
        if suffix_len <= 0:
            raise ValueError("Invalid suffix length")
        start = max(0, file_size - suffix_len)
        end = file_size - 1
        return (start, end)
    if not (start_str.isascii() and start_str.isdigit()) or (
        end_str != "" and not (end_str.isascii() and end_str.isdigit())
    ):
        return None
    start = int(start_str)
    end = int(end_str) if end_str != "" else (file_size - 1)
    if start >= file_size or start < 0 or end < start:
        raise ValueError("Range Not Satisfiable")
    end = min(end, file_size - 1)
    return (start, end)


def _safe_int(val: Any, default: int = 0) -> int:
    try:
        if val is None or val == "":
            return default
        return int(val)
    except (ValueError, TypeError):
        return default


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        if val is None or val == "":
            return default
        return float(val)
    except (ValueError, TypeError):
        return default


def _qs_int(qs: dict, key: str, default: int = 0) -> int:
    vals = (qs or {}).get(key)
    if isinstance(vals, list) and vals:
        return _safe_int(vals[0], default)
    return _safe_int(vals, default)


def resolve_offline_episode_stream(
    snapshot: Dict[str, Any],
    rezka_client: Any,
    backup_stream_engine: Any = None,
    stremio_engine: Any = None,
    remux_engine: Any = None,
    wrap_voidboost_fn: Optional[Callable[..., str]] = None,
    unwrap_media_fn: Optional[Callable[..., str]] = None,
    is_server_running_fn: Optional[Callable[[], bool]] = None,
) -> Dict[str, Any]:
    """Resolves stream metadata, alternative studios, fallbacks and subtitles for an offline episode download."""
    s_num = max(1, _safe_int(snapshot.get("season"), 1))
    e_num = max(1, _safe_int(snapshot.get("episode"), 1))
    mtype = str(snapshot.get("media_type") or "series")
    want_qual = str(snapshot.get("quality") or "1080p")
    want_tr = str(snapshot.get("translator_id") or "")
    want_studio = str(snapshot.get("studio") or "").strip().lower()
    st_data = rezka_client.get_streams_for_title(
        item_id=str(snapshot.get("item_id") or ""),
        rezka_id=str(snapshot.get("rezka_id") or ""),
        title=str(snapshot.get("title") or ""),
        orig_title=str(snapshot.get("orig_title") or ""),
        year=_safe_int(snapshot.get("year"), 0),
        media_type=mtype,
        translator_id=want_tr,
        season=s_num,
        episode=e_num,
        rezka_url=str(snapshot.get("rezka_url") or ""),
        force_refresh=True,
    )
    if not isinstance(st_data, dict):
        st_data = {}
    if mtype == "series":
        s_map = st_data.get("seasons_map") or {}
        prem_map = st_data.get("prem_episodes_map") or {}
        if isinstance(s_map, dict) and s_map:
            avail_eps = set(s_map.get(str(s_num)) or [])
            if isinstance(prem_map, dict) and prem_map.get(str(s_num)):
                avail_eps.update(prem_map.get(str(s_num)) or [])
            if avail_eps and e_num not in avail_eps:
                return {"error": "Серия еще недоступна в выбранной озвучке"}

    if not want_tr and want_studio and isinstance(st_data.get("studios"), list):
        for st_obj in st_data["studios"]:
            if not isinstance(st_obj, dict):
                continue
            st_nm = str(st_obj.get("name") or "").strip().lower()
            st_id = str(st_obj.get("id") or "")
            if st_id and st_nm == want_studio and st_id != str(st_data.get("selected_translator_id") or ""):
                st_alt = rezka_client.get_streams_for_title(
                    item_id=str(snapshot.get("item_id") or ""),
                    rezka_id=str(st_data.get("rezka_id") or snapshot.get("rezka_id") or ""),
                    title=str(snapshot.get("title") or ""),
                    orig_title=str(snapshot.get("orig_title") or ""),
                    year=_safe_int(snapshot.get("year"), 0),
                    media_type=mtype,
                    translator_id=st_id,
                    season=s_num,
                    episode=e_num,
                    rezka_url=str(st_data.get("rezka_url") or snapshot.get("rezka_url") or ""),
                    force_refresh=True,
                )
                if isinstance(st_alt, dict) and st_alt.get("qualities"):
                    st_data = st_alt
                break

    q_map = dict(st_data.get("qualities") or {})
    subs_list = list(st_data.get("subtitles") or [])
    fb_remux_info: Dict[str, Any] = {}
    if (not q_map or st_data.get("is_prem_locked")) and (
        want_tr == "238"
        or "оригинал" in want_studio
        or "original" in want_studio
        or st_data.get("is_prem_locked")
    ):
        for fb_eng in (backup_stream_engine, stremio_engine):
            if fb_eng is not None and hasattr(fb_eng, "resolve_original_audio_fallback"):
                try:
                    fb_res = fb_eng.resolve_original_audio_fallback(
                        item_id=str(snapshot.get("item_id") or ""),
                        title=str(snapshot.get("title") or ""),
                        orig_title=str(snapshot.get("orig_title") or ""),
                        year=_safe_int(snapshot.get("year"), 0),
                        media_type=mtype,
                        season=s_num,
                        episode=e_num,
                        imdb_id=str(snapshot.get("imdb_id") or st_data.get("imdb_id") or ""),
                        remux_engine=remux_engine,
                    )
                    if isinstance(fb_res, dict) and fb_res.get("qualities"):
                        q_map = dict(fb_res["qualities"])
                        if fb_res.get("subtitles") and not subs_list:
                            subs_list = list(fb_res["subtitles"])
                        rmx_sess = fb_res.get("remux_session")
                        if rmx_sess:
                            rmx_meta = rmx_sess if isinstance(rmx_sess, dict) else fb_res
                            raw_src_fb = str(
                                rmx_meta.get("rawSourceUrl")
                                or rmx_meta.get("sourceUrl")
                                or fb_res.get("rawSourceUrl")
                                or fb_res.get("sourceUrl")
                                or ""
                            ).strip()
                            if raw_src_fb:
                                fb_remux_info = {
                                    "raw_source_url": raw_src_fb,
                                    "is_remux_source": True,
                                    "audio_index": _safe_int(
                                        rmx_meta.get(
                                            "audioIndex",
                                            rmx_meta.get(
                                                "selected_audio_index",
                                                fb_res.get("selected_audio_index", fb_res.get("audioIndex")),
                                            ),
                                        ),
                                        0,
                                    ),
                                    "video_codec": str(
                                        rmx_meta.get("videoCodec")
                                        or rmx_meta.get("video_codec")
                                        or fb_res.get("video_codec")
                                        or fb_res.get("videoCodec")
                                        or ""
                                    ),
                                    "audio_codec": str(
                                        rmx_meta.get("audioCodec")
                                        or rmx_meta.get("audio_codec")
                                        or fb_res.get("audio_codec")
                                        or fb_res.get("audioCodec")
                                        or ""
                                    ),
                                    "channels": max(
                                        1,
                                        _safe_int(rmx_meta.get("channels", fb_res.get("channels")), 2),
                                    ),
                                    "duration_sec": _safe_float(
                                        rmx_meta.get("duration", fb_res.get("duration")),
                                        0.0,
                                    ),
                                }
                        break
                except Exception:
                    pass
    if not subs_list and stremio_engine is not None and hasattr(stremio_engine, "get_subtitles_only"):
        try:
            ext_subs = stremio_engine.get_subtitles_only(
                item_id=str(snapshot.get("item_id") or ""),
                title=str(snapshot.get("title") or ""),
                orig_title=str(snapshot.get("orig_title") or ""),
                year=_safe_int(snapshot.get("year"), 0),
                media_type=mtype,
                season=s_num,
                episode=e_num,
                imdb_id=str(snapshot.get("imdb_id") or st_data.get("imdb_id") or ""),
            )
            if isinstance(ext_subs, list) and ext_subs:
                subs_list = list(ext_subs)
        except Exception:
            pass

    chosen_q = want_qual if want_qual in q_map else str(st_data.get("default_quality") or "")
    raw_u = str(q_map.get(chosen_q) or st_data.get("default_stream_url") or "").strip()
    if not raw_u and q_map:
        first_pair = next(iter(q_map.items()))
        chosen_q, raw_u = str(first_pair[0]), str(first_pair[1] or "")
    if not raw_u and not fb_remux_info.get("raw_source_url"):
        return {"error": "Не удалось получить видеопоток серии"}

    is_remux_ep = bool(fb_remux_info.get("is_remux_source"))
    audio_idx_ep = _safe_int(fb_remux_info.get("audio_index"), 0)
    vcodec_ep = str(fb_remux_info.get("video_codec") or "")
    acodec_ep = str(fb_remux_info.get("audio_codec") or "")
    ch_ep = max(1, _safe_int(fb_remux_info.get("channels"), 2))
    dur_ep = _safe_float(fb_remux_info.get("duration_sec"), 0.0)
    if fb_remux_info.get("raw_source_url"):
        eff_u = str(fb_remux_info["raw_source_url"])
    elif "/api/remux-stream" in raw_u:
        qs_rmx_ep = urllib.parse.parse_qs(urllib.parse.urlparse(raw_u).query)
        eff_u = (qs_rmx_ep.get("src") or [""])[0].strip()
        is_remux_ep = True
        audio_idx_ep = max(0, _qs_int(qs_rmx_ep, "audio", audio_idx_ep))
        vcodec_ep = (qs_rmx_ep.get("vcodec") or [vcodec_ep])[0].strip()
        acodec_ep = (qs_rmx_ep.get("acodec") or [acodec_ep])[0].strip()
        ch_ep = max(1, _qs_int(qs_rmx_ep, "ch", ch_ep))
    else:
        is_running = is_server_running_fn() if callable(is_server_running_fn) else bool(is_server_running_fn)
        if is_running and callable(wrap_voidboost_fn):
            eff_u = wrap_voidboost_fn(raw_u, absolute_loopback=True)
        elif callable(unwrap_media_fn):
            eff_u = unwrap_media_fn(raw_u)
        else:
            eff_u = raw_u
    ep_titles = st_data.get("episodes_titles") or {}
    ep_t = ""
    if isinstance(ep_titles, dict):
        sn_dict = ep_titles.get(str(s_num))
        if isinstance(sn_dict, dict):
            ep_t = str(sn_dict.get(str(e_num)) or "")
    return {
        "stream_url": eff_u,
        "quality": chosen_q or want_qual,
        "studio": str(st_data.get("selected_studio_name") or snapshot.get("studio") or "HDRezka"),
        "translator_id": str(st_data.get("selected_translator_id") or want_tr),
        "subtitles": subs_list,
        "episode_title": ep_t,
        "is_remux_source": is_remux_ep,
        "audio_index": audio_idx_ep,
        "video_codec": vcodec_ep,
        "audio_codec": acodec_ep,
        "channels": ch_ep,
        "duration_sec": dur_ep,
    }


class OfflineDownloadManager:
    """
    Background Offline Downloads Manager ('Скачать в дорогу') powered by Velarium's bundled FFmpeg.
    Saves 1080p / 4K movies & episodes with selected audio track + Russian/English WebVTT subtitles
    and cached poster art into `data/downloads/` for 100% offline playback.
    """

    MAX_CONCURRENT = 2

    def __init__(
        self,
        data_dir: str,
        remux_engine: Any,
        net_client: Optional[Any] = None,
        start_workers: bool = True,
        local_port_getter: Optional[Callable[[], int]] = None,
        stream_resolver: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    ):
        self.data_dir = os.path.abspath(data_dir)
        self.downloads_dir = os.path.join(self.data_dir, "downloads")
        os.makedirs(self.downloads_dir, exist_ok=True)
        self.index_path = os.path.join(self.downloads_dir, "downloads_index.json")
        self._db = get_storage_db(self.data_dir)
        self.remux = remux_engine
        self.net = net_client
        self.local_port_getter = local_port_getter
        self.stream_resolver = stream_resolver
        self._lock = threading.RLock()
        self._active_procs: Dict[str, subprocess.Popen] = {}
        self._active_aux_procs: Dict[str, subprocess.Popen] = {}
        self._cancelled_ids: set = set()
        self._inflight_ids: set = set()
        self._queue: "queue.Queue[str]" = queue.Queue()
        self._shutdown = False
        self._prefs_cache: Optional[Dict[str, Any]] = None
        self._items: Dict[str, Dict[str, Any]] = self._load_index()
        for did, it in sorted(
            self._items.items(),
            key=lambda x: float(x[1].get("created_at") or 0.0),
        ):
            if it.get("status") == "queued":
                self._queue.put(did)
        self._workers: List[threading.Thread] = []
        if start_workers:
            for idx in range(self.MAX_CONCURRENT):
                t = threading.Thread(
                    target=self._worker_loop,
                    name=f"VelariumDownloadWorker-{idx + 1}",
                    daemon=True,
                )
                t.start()
                self._workers.append(t)

    def get_prefs(self) -> Dict[str, Any]:
        if self._prefs_cache is not None:
            return dict(self._prefs_cache)
        raw = self._db.get_kv("downloads", "prefs", None)
        if not isinstance(raw, dict):
            raw = {}
        prefs = {
            "auto_cleanup_watched": bool(raw.get("auto_cleanup_watched", False)),
            "auto_download_next": bool(raw.get("auto_download_next", False)),
        }
        self._prefs_cache = dict(prefs)
        return prefs

    def set_prefs(
        self,
        auto_cleanup_watched: Optional[bool] = None,
        auto_download_next: Optional[bool] = None,
    ) -> Dict[str, Any]:
        cur = self.get_prefs()
        if auto_cleanup_watched is not None:
            cur["auto_cleanup_watched"] = bool(auto_cleanup_watched)
        if auto_download_next is not None:
            cur["auto_download_next"] = bool(auto_download_next)
        self._prefs_cache = dict(cur)
        self._db.set_kv("downloads", "prefs", cur)
        return cur

    def _load_index(self) -> Dict[str, Dict[str, Any]]:
        items: Dict[str, Dict[str, Any]] = {}
        raw_list: List[Dict[str, Any]] = []
        try:
            if self._db.has_downloads_rows():
                raw_list = list(self._db.load_downloads_map().values())
        except Exception:
            raw_list = []

        if not raw_list and os.path.isfile(self.index_path):
            try:
                with open(self.index_path, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                cand = raw.get("items") if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
                if isinstance(cand, list):
                    raw_list = cand
            except Exception:
                raw_list = []

        dirty = False
        for entry in raw_list or []:
            if not isinstance(entry, dict) or not entry.get("download_id"):
                continue
            did = str(entry["download_id"])
            st = str(entry.get("status") or "failed")
            if st in ("downloading", "queued"):
                if entry.get("status") != "queued":
                    dirty = True
                entry["status"] = "queued"
                entry["error"] = ""
                entry["speed_label"] = ""
                if self.stream_resolver is not None and not entry.get("lazy_resolve"):
                    entry["lazy_resolve"] = True
                    dirty = True
            if entry.get("status") == "completed":
                vpath = os.path.join(self.downloads_dir, did, "video.mp4")
                if not os.path.isfile(vpath):
                    entry["status"] = "failed"
                    entry["error"] = "Файл видео не найден на диске"
                    dirty = True
                else:
                    cur_sz = os.path.getsize(vpath)
                    if entry.get("file_size") != cur_sz or entry.get("progress_pct") != 100.0:
                        entry["file_size"] = cur_sz
                        entry["downloaded_bytes"] = cur_sz
                        entry["progress_pct"] = 100.0
                        dirty = True
            ppath = os.path.join(self.downloads_dir, did, "poster.jpg")
            if os.path.isfile(ppath) and os.path.getsize(ppath) > 256:
                if not entry.get("has_local_poster"):
                    entry["has_local_poster"] = True
                    dirty = True
            items[did] = entry

        if dirty:
            self._save_index_locked(items)
        return items

    def _save_single_progress_locked(self, did: str) -> None:
        rec = self._items.get(did)
        if not rec:
            return
        try:
            self._db.upsert_download(did, rec)
        except Exception:
            pass

    def _save_index_locked(
        self,
        target_map: Optional[Dict[str, Dict[str, Any]]] = None,
        skip_db: bool = False,
        changed_ids: Optional[Sequence[str]] = None,
    ) -> None:
        mp = target_map if target_map is not None else self._items
        if not skip_db:
            try:
                if changed_ids:
                    for cid in changed_ids:
                        rec = mp.get(cid)
                        if isinstance(rec, dict):
                            self._db.upsert_download(cid, rec)
                else:
                    self._db.replace_all_downloads(mp)
            except Exception:
                pass
        ordered = sorted(mp.values(), key=lambda x: float(x.get("created_at") or 0.0), reverse=True)
        tmp = f"{self.index_path}.tmp.{threading.get_ident()}"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"updated_at": time.time(), "items": ordered}, f, ensure_ascii=False, indent=2)
            os.replace(tmp, self.index_path)
        except Exception:
            try:
                if os.path.exists(tmp):
                    os.remove(tmp)
            except OSError:
                pass

    @staticmethod
    def build_download_id(
        item_id: str,
        title: str,
        media_type: str,
        season: int,
        episode: int,
        quality: str = "",
        studio: str = "",
    ) -> str:
        base_key = f"{item_id or title.strip().lower()}|{media_type}|S{int(season)}E{int(episode)}|{quality}|{studio}"
        digest = hashlib.sha1(base_key.encode("utf-8", errors="ignore")).hexdigest()[:12]
        slug = re.sub(r"[^a-zA-Z0-9]+", "_", (item_id or "title")).strip("_").lower()[:16] or "item"
        ep_part = f"_s{int(season):02d}e{int(episode):02d}" if media_type == "series" else "_movie"
        return f"dl_{slug}{ep_part}_{digest}"

    def build_ffmpeg_download_command(
        self,
        source_url: str,
        output_path: str,
        audio_index: int = 0,
        video_codec: str = "",
        audio_codec: str = "",
        channels: int = 2,
        is_remux_source: bool = False,
    ) -> List[str]:
        clean_src = str(source_url or "").strip()
        try:
            port_val = int(self.local_port_getter() if callable(self.local_port_getter) else 8765)
        except Exception:
            port_val = 8765
        if not self._is_safe_stream_url(clean_src, local_port=port_val):
            raise ValueError("Disallowed download stream URL")
        ffmpeg_bin = getattr(self.remux, "ffmpeg_path", "") or shutil.which("ffmpeg") or "ffmpeg"
        hw_caps = getattr(self.remux, "_hw_caps", {}) or {}
        v_low = (video_codec or "").strip().lower()
        a_low = (audio_codec or "").strip().lower()
        ch_count = max(1, int(channels or 2))
        url_low = clean_src.lower()
        is_hls = ".m3u8" in url_low or ":hls:" in url_low

        cmd: List[str] = [
            ffmpeg_bin,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-progress",
            "pipe:1",
            "-nostats",
        ]
        if clean_src.startswith(("http://", "https://")):
            cmd.extend(
                [
                    "-user_agent",
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                    "-reconnect",
                    "1",
                    "-reconnect_streamed",
                    "1",
                    "-reconnect_delay_max",
                    "5",
                    # Abort a fully stalled source after 45 s instead of blocking a worker slot forever
                    "-rw_timeout",
                    "45000000",
                    "-protocol_whitelist",
                    _FFMPEG_NET_WHITELIST,
                ]
            )
        cmd.extend(
            [
                "-fflags",
                "+genpts+discardcorrupt",
                "-thread_queue_size",
                "1024",
                "-i",
                clean_src,
            ]
        )

        if is_remux_source:
            cmd.extend(
                [
                    "-map",
                    "0:v:0",
                    "-map",
                    f"0:a:{max(0, int(audio_index))}?",
                ]
            )
            copy_safe_v = {"", "h264", "avc", "avc1", "hevc", "h265", "hev1", "hvc1", "av1", "av01"}
            if v_low and v_low not in copy_safe_v:
                if hw_caps.get("h264_videotoolbox"):
                    cmd.extend(["-c:v", "h264_videotoolbox", "-b:v", "10M", "-pix_fmt", "yuv420p"])
                elif hw_caps.get("h264_nvenc"):
                    cmd.extend(["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "21", "-pix_fmt", "yuv420p"])
                elif hw_caps.get("h264_qsv"):
                    cmd.extend(["-c:v", "h264_qsv", "-global_quality", "21", "-pix_fmt", "yuv420p"])
                elif hw_caps.get("h264_amf"):
                    cmd.extend(["-c:v", "h264_amf", "-quality", "balanced", "-pix_fmt", "yuv420p"])
                else:
                    cmd.extend(["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p"])
            else:
                cmd.extend(["-c:v", "copy"])
                if v_low in ("hevc", "h265"):
                    cmd.extend(["-tag:v", "hvc1"])

            if a_low in ("aac", "mp4a") and ch_count <= 2:
                cmd.extend(["-c:a", "copy"])
            else:
                audio_enc = "aac_at" if hw_caps.get("aac_at") else "aac"
                cmd.extend(["-c:a", audio_enc, "-ac", "2", "-b:a", "192k"])
                if ch_count >= 6:
                    cmd.extend(
                        [
                            "-af",
                            "aresample=async=1,pan=stereo|FL<0.75*FC+0.60*FL+0.40*BL+0.40*SL+0.25*LFE|FR<0.75*FC+0.60*FR+0.40*BR+0.40*SR+0.25*LFE",
                        ]
                    )
                else:
                    cmd.extend(["-af", "aresample=async=1"])
        else:
            cmd.extend(["-map", "0:v:0?", "-map", "0:a:0?", "-c:v", "copy"])
            if is_hls:
                if a_low in ("", "aac", "mp4a"):
                    cmd.extend(["-c:a", "copy", "-bsf:a", "aac_adtstoasc"])
                else:
                    audio_enc = "aac_at" if hw_caps.get("aac_at") else "aac"
                    cmd.extend(["-c:a", audio_enc, "-ac", "2", "-b:a", "192k"])
            elif a_low in ("", "aac", "mp4a", "mp3", "alac") and ch_count <= 2:
                cmd.extend(["-c:a", "copy"])
            else:
                audio_enc = "aac_at" if hw_caps.get("aac_at") else "aac"
                cmd.extend(["-c:a", audio_enc, "-ac", "2", "-b:a", "192k"])

        cmd.extend(["-movflags", "+faststart", "-f", "mp4", output_path])
        return cmd

    def enqueue_download(
        self,
        *,
        item_id: str,
        kinorium_id: str = "",
        rezka_id: str = "",
        rezka_url: str = "",
        title: str,
        orig_title: str = "",
        year: Any = "",
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        episode_title: str = "",
        poster: str = "",
        backdrop: str = "",
        stream_url: str = "",
        quality: str = "1080p",
        studio: str = "HDRezka",
        translator_id: str = "",
        source_tab: str = "hdrezka",
        is_remux_source: bool = False,
        audio_index: int = 0,
        video_codec: str = "",
        audio_codec: str = "",
        channels: int = 2,
        duration_sec: float = 0.0,
        subtitles: Optional[List[Dict[str, Any]]] = None,
        profile_id: str = "main",
        genres: Optional[List[str]] = None,
        age_rating: str = "",
        kids_safe: Optional[bool] = None,
        lazy_resolve: bool = False,
        max_season_episode: int = 0,
        lang: str = "ru",
        _defer_save: bool = False,
    ) -> Dict[str, Any]:
        is_en = str(lang or "ru").strip().lower().startswith("en")
        clean_stream = str(stream_url or "").strip()
        can_lazy = bool(lazy_resolve and self.stream_resolver is not None)
        if not clean_stream and not can_lazy:
            raise ValueError(
                "Missing video stream URL for download"
                if is_en
                else "Не указана ссылка на видеопоток для загрузки"
            )
        if clean_stream:
            try:
                port_val = int(self.local_port_getter() if callable(self.local_port_getter) else 8765)
            except Exception:
                port_val = 8765
            if "/api/remux-stream" in clean_stream:
                try:
                    parsed_rmx = urllib.parse.urlparse(clean_stream)
                    rmx_host = (parsed_rmx.hostname or "").strip().lower().strip("[]")
                    if parsed_rmx.path == "/api/remux-stream" and rmx_host in ("", "127.0.0.1", "localhost", "::1"):
                        qs_rmx = urllib.parse.parse_qs(parsed_rmx.query)
                        src_inner = (qs_rmx.get("src") or [""])[0].strip()
                        if src_inner:
                            clean_stream = src_inner
                            is_remux_source = True
                            if qs_rmx.get("audio"):
                                try:
                                    audio_index = max(0, int(qs_rmx["audio"][0]))
                                except Exception:
                                    pass
                            if qs_rmx.get("vcodec") and not video_codec:
                                video_codec = str(qs_rmx["vcodec"][0] or "").strip()
                            if qs_rmx.get("acodec") and not audio_codec:
                                audio_codec = str(qs_rmx["acodec"][0] or "").strip()
                            if qs_rmx.get("ch"):
                                try:
                                    channels = max(1, int(qs_rmx["ch"][0]))
                                except Exception:
                                    pass
                except Exception:
                    pass
            if clean_stream.startswith(("/api/proxy-stream", "/api/remux-stream")):
                clean_stream = f"http://127.0.0.1:{port_val}{clean_stream}"
            if not self._is_safe_stream_url(clean_stream, local_port=port_val):
                raise ValueError(
                    "Disallowed video stream URL for download"
                    if is_en
                    else "Недопустимая ссылка на видеопоток для загрузки"
                )
        if not self.remux or not self.remux.is_available():
            raise RuntimeError(
                "FFmpeg engine not found for saving offline video"
                if is_en
                else "Движок FFmpeg не найден для сохранения офлайн-видео"
            )

        eff_type = "series" if str(media_type or "").lower() == "series" else "movie"
        eff_s = max(1, int(season or 1)) if eff_type == "series" else 1
        eff_e = max(1, int(episode or 1)) if eff_type == "series" else 1
        did = self.build_download_id(
            item_id=item_id,
            title=title,
            media_type=eff_type,
            season=eff_s,
            episode=eff_e,
            quality=quality,
            studio=studio,
        )

        with self._lock:
            existing = self._items.get(did)
            if existing and existing.get("status") in ("downloading", "queued", "completed"):
                existing_vpath = os.path.join(self.downloads_dir, did, "video.mp4")
                if (
                    existing.get("status") != "completed"
                    or int(existing.get("file_size") or 0) <= 0
                    or os.path.isfile(existing_vpath)
                ):
                    if existing.get("pending_cleanup"):
                        existing["pending_cleanup"] = False
                        self._save_index_locked()
                    return self._format_entry_for_client(existing, lang=lang)

            item_dir = os.path.join(self.downloads_dir, did)
            os.makedirs(item_dir, exist_ok=True)
            self._cancelled_ids.discard(did)

            clean_genres = [str(g).strip() for g in (genres or []) if str(g or "").strip()]
            computed_kids_safe = (
                bool(kids_safe)
                if kids_safe is not None
                else ProfileManager.is_item_kids_safe(
                    {
                        "title": title,
                        "orig_title": orig_title,
                        "genres": clean_genres,
                        "age_rating": age_rating,
                    }
                )
            )

            entry: Dict[str, Any] = {
                "download_id": did,
                "_run_id": f"{time.time():.6f}_{threading.get_ident()}",
                "profile_id": str(profile_id or "main"),
                "item_id": str(item_id or ""),
                "kinorium_id": str(kinorium_id or ""),
                "rezka_id": str(rezka_id or ""),
                "rezka_url": str(rezka_url or ""),
                "title": str(title or "Видео"),
                "orig_title": str(orig_title or ""),
                "year": year or "",
                "media_type": eff_type,
                "season": eff_s,
                "episode": eff_e,
                "episode_title": str(episode_title or ""),
                "genres": clean_genres,
                "age_rating": str(age_rating or ""),
                "kids_safe": computed_kids_safe,
                "poster_remote": str(poster or backdrop or ""),
                "backdrop_remote": str(backdrop or poster or ""),
                "has_local_poster": False,
                "stream_url": clean_stream,
                "lazy_resolve": bool(can_lazy and not clean_stream),
                "max_season_episode": max(0, int(max_season_episode or 0)),
                "pending_cleanup": False,
                "quality": str(quality or "1080p"),
                "studio": str(studio or "HDRezka"),
                "translator_id": str(translator_id or ""),
                "source_tab": str(source_tab or "hdrezka"),
                "is_remux_source": bool(is_remux_source),
                "audio_index": max(0, int(audio_index or 0)),
                "video_codec": str(video_codec or ""),
                "audio_codec": str(audio_codec or ""),
                "channels": max(1, int(channels or 2)),
                "duration_sec": max(0.0, float(duration_sec or 0.0)),
                "requested_subtitles": list(subtitles or []),
                "local_subtitles": [],
                "status": "queued",
                "progress_pct": 0.0,
                "downloaded_bytes": 0,
                "file_size": 0,
                "speed_label": "",
                "eta_sec": 0,
                "error": "",
                "created_at": time.time(),
                "completed_at": 0.0,
            }
            self._items[did] = entry
            if not _defer_save:
                self._save_index_locked(changed_ids=[did])

        self._queue.put(did)
        return self._format_entry_for_client(entry, lang=lang)

    def enqueue_batch_series(
        self,
        *,
        item_id: str,
        kinorium_id: str = "",
        rezka_id: str = "",
        rezka_url: str = "",
        title: str,
        orig_title: str = "",
        year: Any = "",
        season: int = 1,
        episodes: List[Any],
        episode_titles: Optional[Dict[str, str]] = None,
        poster: str = "",
        backdrop: str = "",
        quality: str = "1080p",
        studio: str = "HDRezka",
        translator_id: str = "",
        source_tab: str = "hdrezka",
        profile_id: str = "main",
        genres: Optional[List[str]] = None,
        age_rating: str = "",
        kids_safe: Optional[bool] = None,
        max_season_episode: int = 0,
        lang: str = "ru",
    ) -> Dict[str, Any]:
        is_en = str(lang or "ru").strip().lower().startswith("en")
        if not episodes:
            raise ValueError(
                "No episodes selected for batch download"
                if is_en
                else "Не выбраны серии для пакетной загрузки"
            )
        ep_titles_map = episode_titles if isinstance(episode_titles, dict) else {}
        eff_season = max(1, int(season or 1))
        queued_items: List[Dict[str, Any]] = []
        parsed_eps: List[Tuple[int, str, str]] = []
        for raw_ep in episodes[:60]:
            if isinstance(raw_ep, dict):
                ep_num = int(raw_ep.get("episode") or 0)
                ep_t = str(raw_ep.get("episode_title") or "")
                ep_u = str(raw_ep.get("stream_url") or "")
            else:
                try:
                    ep_num = int(raw_ep)
                except (ValueError, TypeError):
                    ep_num = 0
                ep_t = ""
                ep_u = ""
            if ep_num <= 0:
                continue
            if not ep_t:
                ep_t = str(
                    ep_titles_map.get(f"s{eff_season}e{ep_num}")
                    or ep_titles_map.get(str(ep_num))
                    or ""
                )
            parsed_eps.append((ep_num, ep_t, ep_u))

        if not parsed_eps:
            raise ValueError(
                "No valid episode numbers provided"
                if is_en
                else "Некорректный список серий для загрузки"
            )
        eff_max_ep = max(max_season_episode, max(x[0] for x in parsed_eps))
        skipped_items: List[Dict[str, Any]] = []
        for ep_num, ep_t, ep_u in parsed_eps:
            cand_did = self.build_download_id(
                item_id=item_id,
                title=title,
                media_type="series",
                season=eff_season,
                episode=ep_num,
                quality=quality,
                studio=studio,
            )
            already_active_or_done = False
            with self._lock:
                existing = self._items.get(cand_did)
                if existing and existing.get("status") in ("downloading", "queued", "completed"):
                    existing_vpath = os.path.join(self.downloads_dir, cand_did, "video.mp4")
                    if (
                        existing.get("status") != "completed"
                        or int(existing.get("file_size") or 0) <= 0
                        or os.path.isfile(existing_vpath)
                    ):
                        already_active_or_done = True
                        if existing.get("pending_cleanup"):
                            existing["pending_cleanup"] = False
                        skipped_items.append(self._format_entry_for_client(existing, lang=lang))
            if already_active_or_done:
                continue
            rec = self.enqueue_download(
                item_id=item_id,
                kinorium_id=kinorium_id,
                rezka_id=rezka_id,
                rezka_url=rezka_url,
                title=title,
                orig_title=orig_title,
                year=year,
                media_type="series",
                season=eff_season,
                episode=ep_num,
                episode_title=ep_t,
                poster=poster,
                backdrop=backdrop,
                stream_url=ep_u,
                quality=quality,
                studio=studio,
                translator_id=translator_id,
                source_tab=source_tab,
                profile_id=profile_id,
                genres=genres,
                age_rating=age_rating,
                kids_safe=kids_safe,
                lazy_resolve=not bool(ep_u.strip()),
                max_season_episode=eff_max_ep,
                lang=lang,
                _defer_save=True,
            )
            queued_items.append(rec)
        with self._lock:
            changed = [r.get("download_id") for r in (queued_items + skipped_items) if r.get("download_id")]
            if changed:
                self._save_index_locked(changed_ids=changed)

        free_bytes = 0
        try:
            free_bytes = int(shutil.disk_usage(self.downloads_dir).free)
        except Exception:
            free_bytes = 0
        est_per_ep = 1200 * 1024 * 1024 if "2160" in str(quality) or "4k" in str(quality).lower() else 550 * 1024 * 1024
        estimated_bytes = len(queued_items) * est_per_ep

        return {
            "ok": True,
            "queued_count": len(queued_items),
            "skipped_count": len(skipped_items),
            "season": eff_season,
            "free_bytes": free_bytes,
            "estimated_bytes": estimated_bytes,
            "sufficient_disk_space": (free_bytes == 0) or (free_bytes >= estimated_bytes),
            "items": queued_items,
            "skipped_items": skipped_items,
        }

    batch_enqueue_season = enqueue_batch_series

    def _worker_loop(self) -> None:
        while not self._shutdown:
            try:
                did = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue
            try:
                self._run_download_task(did)
            except Exception as exc:
                with self._lock:
                    if did in self._items and self._items[did].get("status") not in ("cancelled", "completed"):
                        self._items[did]["status"] = "failed"
                        self._items[did]["error"] = str(exc)
                        self._items[did]["speed_label"] = ""
                        self._save_index_locked(changed_ids=[did])
            finally:
                self._queue.task_done()

    @staticmethod
    def _classify_sub_lang(sub: Dict[str, Any], idx: int) -> Tuple[str, str]:
        raw_lang = str(sub.get("lang") or sub.get("label") or sub.get("lang_code") or "").strip()
        low = raw_lang.lower()
        if any(w in low for w in ("рус", "rus", "ru")):
            return (f"ru_{idx}", raw_lang or "Русский")
        if any(w in low for w in ("англ", "eng", "en")):
            return (f"en_{idx}", raw_lang or "English")
        return (f"sub_{idx}", raw_lang or f"Subtitles #{idx + 1}")

    _CGNAT_NET = ipaddress.ip_network("100.64.0.0/10")
    _BENCHMARK_NET = ipaddress.ip_network("198.18.0.0/15")

    @staticmethod
    def _is_disallowed_ip(ip_obj: Any) -> bool:
        if isinstance(ip_obj, ipaddress.IPv6Address):
            if ip_obj.ipv4_mapped is not None:
                return OfflineDownloadManager._is_disallowed_ip(ip_obj.ipv4_mapped)
            if getattr(ip_obj, "sixtofour", None) is not None:
                return OfflineDownloadManager._is_disallowed_ip(ip_obj.sixtofour)
            if getattr(ip_obj, "teredo", None) is not None:
                srv_ip, cli_ip = ip_obj.teredo
                return OfflineDownloadManager._is_disallowed_ip(srv_ip) or OfflineDownloadManager._is_disallowed_ip(cli_ip)
        elif isinstance(ip_obj, ipaddress.IPv4Address):
            if ip_obj in OfflineDownloadManager._CGNAT_NET or ip_obj in OfflineDownloadManager._BENCHMARK_NET:
                return True
        return bool(
            ip_obj.is_loopback
            or ip_obj.is_private
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_unspecified
            or ip_obj.is_reserved
            or not ip_obj.is_global
        )

    @staticmethod
    def _is_safe_stream_url(url: str, local_port: int = 8765, torrserver_port: int = 8090) -> bool:
        u = str(url or "").strip()
        if not u or _CTRL_CHAR_RE.search(u):
            return False
        try:
            parsed = urllib.parse.urlparse(u)
            if parsed.scheme not in ("http", "https"):
                return False
            if parsed.username or parsed.password:
                return False
            host = (parsed.hostname or "").strip().lower().strip("[]")
            if not host or host == "0.0.0.0" or host.endswith((".local", ".localhost", ".internal")):
                return False
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            path = parsed.path or ""
            if host in ("127.0.0.1", "localhost", "::1"):
                if local_port and int(local_port) > 0 and port == int(local_port) and path.startswith(
                    ("/api/proxy-stream", "/api/remux-stream")
                ):
                    return True
                if torrserver_port and int(torrserver_port) > 0 and port == int(torrserver_port) and path.startswith(
                    ("/stream/", "/play/")
                ):
                    return True
                return False
            from backend.net_security import is_allowed_media_source_url
            return bool(is_allowed_media_source_url(u, allow_torrserver_loopback=False))
        except Exception:
            return False

    @staticmethod
    def _is_safe_aux_url(url: str, local_port: int = 8765) -> bool:
        u = str(url or "").strip()
        if not u or _CTRL_CHAR_RE.search(u):
            return False
        try:
            parsed = urllib.parse.urlparse(u)
            if parsed.scheme not in ("http", "https"):
                return False
            if parsed.username or parsed.password:
                return False
            host = (parsed.hostname or "").strip().lower().strip("[]")
            if not host or host == "0.0.0.0" or host.endswith((".local", ".localhost", ".internal")):
                return False
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            if host in ("127.0.0.1", "localhost", "::1"):
                return bool(local_port and int(local_port) > 0 and port == int(local_port) and (parsed.path or "").startswith("/api/person-photo"))
            from backend.net_security import is_allowed_media_source_url
            return bool(is_allowed_media_source_url(u, allow_torrserver_loopback=False))
        except Exception:
            return False

    _cached_aux_opener: Any = None
    _cached_aux_opener_lock = threading.Lock()

    @classmethod
    def _get_aux_opener(cls):
        with cls._cached_aux_opener_lock:
            if cls._cached_aux_opener is not None:
                return cls._cached_aux_opener

            class _SafeRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, req, fp, code, msg, headers, newurl):
                    resolved_url = urllib.parse.urljoin(req.full_url, str(newurl or ""))
                    req_host = (urllib.parse.urlparse(str(req.full_url or "")).hostname or "").lower()
                    res_host = (urllib.parse.urlparse(str(resolved_url or "")).hostname or "").lower()
                    is_loop_req = req_host in ("127.0.0.1", "localhost", "::1")
                    is_loop_res = res_host in ("127.0.0.1", "localhost", "::1")
                    if (is_loop_req and not is_loop_res) or not OfflineDownloadManager._is_safe_aux_url(resolved_url, local_port=0):
                        if fp is not None:
                            try:
                                fp.close()
                            except Exception:
                                pass
                        raise urllib.error.URLError("Disallowed redirect target")
                    return super().redirect_request(req, fp, code, msg, headers, resolved_url)

            cls._cached_aux_opener = urllib.request.build_opener(
                _SafeRedirect(),
                urllib.request.HTTPSHandler(context=_SHARED_SSL_CTX),
                urllib.request.ProxyHandler({}),
            )
            return cls._cached_aux_opener

    @classmethod
    def _open_safe_aux_url(cls, url: str, timeout: float = 8.0, local_port: int = 8765):
        if not cls._is_safe_aux_url(url, local_port=local_port):
            raise ValueError("Disallowed auxiliary asset URL")
        parsed_aux = urllib.parse.urlparse(str(url or "").strip())
        if (parsed_aux.hostname or "").lower() not in ("127.0.0.1", "localhost", "::1"):
            from .net_security import open_safe_public_url
            return open_safe_public_url(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"},
                timeout=timeout,
                allow_torrserver_loopback=False,
            )

        opener = cls._get_aux_opener()
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"},
        )
        return opener.open(req, timeout=timeout)

    def _is_run_aborted(self, did: str, run_id: str) -> bool:
        with self._lock:
            if self._shutdown or did in self._cancelled_ids:
                return True
            cur = self._items.get(did)
            return not cur or str(cur.get("_run_id") or "") != run_id

    def _download_poster_and_subtitles(
        self,
        did: str,
        run_id: str,
        entry: Dict[str, Any],
        item_dir: str,
    ) -> None:
        if self._is_run_aborted(did, run_id):
            return
        poster_url = str(entry.get("poster_remote") or "").strip()
        fetch_poster_url = poster_url
        try:
            port_val = int(self.local_port_getter() if callable(self.local_port_getter) else 8765)
        except Exception:
            port_val = 8765
        if poster_url.startswith("/api/person-photo"):
            fetch_poster_url = f"http://127.0.0.1:{port_val}{poster_url}"
        if fetch_poster_url.startswith(("http://", "https://")) and self._is_safe_aux_url(
            fetch_poster_url, local_port=port_val
        ):
            try:
                with self._open_safe_aux_url(fetch_poster_url, timeout=8, local_port=port_val) as resp:
                    raw_img = resp.read(2 * 1024 * 1024)
                    if (
                        resp.status == 200
                        and len(raw_img) > 256
                        and not self._is_run_aborted(did, run_id)
                        and os.path.isdir(item_dir)
                    ):
                        p_path = os.path.join(item_dir, "poster.jpg")
                        with open(p_path, "wb") as pf:
                            pf.write(raw_img)
                        if self._is_run_aborted(did, run_id):
                            try:
                                os.remove(p_path)
                            except OSError:
                                pass
                        else:
                            with self._lock:
                                cur_it = self._items.get(did)
                                if (
                                    cur_it
                                    and str(cur_it.get("_run_id") or "") == run_id
                                    and did not in self._cancelled_ids
                                ):
                                    cur_it["has_local_poster"] = True
                                    self._save_index_locked(changed_ids=[did])
            except Exception:
                pass

        req_subs = entry.get("requested_subtitles") or []
        if not isinstance(req_subs, list) or not req_subs:
            return

        # Keep Russian and English subtitles first (up to 6 tracks)
        prioritized: List[Dict[str, Any]] = []
        others: List[Dict[str, Any]] = []
        for s in req_subs:
            if not isinstance(s, dict):
                continue
            low = str(s.get("lang") or s.get("label") or s.get("lang_code") or "").lower()
            if any(k in low for k in ("рус", "rus", "ru", "англ", "eng", "en")):
                prioritized.append(s)
            else:
                others.append(s)
        selected_subs = (prioritized + others)[:6]

        saved_subs: List[Dict[str, Any]] = []
        ffmpeg_bin = getattr(self.remux, "ffmpeg_path", "") or "ffmpeg"
        src_stream = str(entry.get("stream_url") or "")

        for idx, sub in enumerate(selected_subs):
            if self._is_run_aborted(did, run_id):
                return
            code, label = self._classify_sub_lang(sub, idx)
            fname = f"{code}.vtt"
            dest_vtt = os.path.join(item_dir, fname)
            vtt_content = ""
            sub_url = str(sub.get("url") or "").strip()
            stream_si = sub.get("stream_index")
            eff_src_stream = src_stream

            # Case 1: Embedded MKV/MP4 subtitle track (`stream_index` or `/api/remux-subtitle?...`)
            sub_ss = 0.0
            if stream_si is None and "/api/remux-subtitle" in sub_url:
                try:
                    qs_sub = urllib.parse.parse_qs(urllib.parse.urlparse(sub_url).query)
                    if "si" in qs_sub:
                        stream_si = int(qs_sub["si"][0])
                    if "src" in qs_sub and qs_sub["src"][0]:
                        eff_src_stream = qs_sub["src"][0]
                    if "ss" in qs_sub and qs_sub["ss"][0]:
                        sub_ss = max(0.0, float(qs_sub["ss"][0]))
                except Exception:
                    pass

            if eff_src_stream.startswith(("/api/proxy-stream", "/api/remux-stream")):
                eff_src_stream = f"http://127.0.0.1:{port_val}{eff_src_stream}"

            if (
                stream_si is not None
                and eff_src_stream
                and not self._is_run_aborted(did, run_id)
                and os.path.isdir(item_dir)
                and self._is_safe_stream_url(eff_src_stream, local_port=port_val)
            ):
                dest_vtt_part = f"{dest_vtt}.part"
                try:
                    cmd_sub = [
                        ffmpeg_bin,
                        "-y",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-rw_timeout",
                        "30000000",
                        "-protocol_whitelist",
                        _FFMPEG_NET_WHITELIST,
                    ]
                    if sub_ss > 0.0:
                        cmd_sub.extend(["-ss", f"{sub_ss:.3f}"])
                    cmd_sub.extend([
                        "-i",
                        eff_src_stream,
                        "-map",
                        f"0:{int(stream_si)}",
                        "-f",
                        "webvtt",
                        dest_vtt_part,
                    ])
                    sub_proc = subprocess.Popen(
                        cmd_sub,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        env=build_ffmpeg_env(eff_src_stream),
                        creationflags=_SUBPROC_NO_WINDOW,
                    )
                    with self._lock:
                        self._active_aux_procs[did] = sub_proc
                        if self._shutdown or did in self._cancelled_ids:
                            try:
                                sub_proc.terminate()
                            except Exception:
                                pass
                    sub_ok = False
                    try:
                        sub_proc.wait(timeout=120)
                        sub_ok = sub_proc.returncode == 0
                    except Exception:
                        try:
                            sub_proc.kill()
                            sub_proc.wait(timeout=2)
                        except Exception:
                            pass
                    finally:
                        with self._lock:
                            if self._active_aux_procs.get(did) is sub_proc:
                                self._active_aux_procs.pop(did, None)
                    if self._is_run_aborted(did, run_id) or not os.path.isdir(item_dir):
                        try:
                            if os.path.isfile(dest_vtt_part):
                                os.remove(dest_vtt_part)
                        except OSError:
                            pass
                        return
                    if sub_ok and os.path.isfile(dest_vtt_part) and os.path.getsize(dest_vtt_part) > 12:
                        os.replace(dest_vtt_part, dest_vtt)
                        saved_subs.append(
                            {
                                "code": code,
                                "lang": label,
                                "file": fname,
                                "url": f"/api/downloads/sub/{did}/{fname}",
                                "direct_vtt": True,
                            }
                        )
                        continue
                    elif os.path.isfile(dest_vtt_part):
                        try:
                            os.remove(dest_vtt_part)
                        except OSError:
                            pass
                except Exception:
                    try:
                        if os.path.isfile(dest_vtt_part):
                            os.remove(dest_vtt_part)
                    except OSError:
                        pass

            # Case 2: Remote or local-proxied SRT/VTT URL
            eff_sub_url = sub_url
            if "/api/proxy-vtt" in eff_sub_url:
                try:
                    qs_vtt = urllib.parse.parse_qs(urllib.parse.urlparse(eff_sub_url).query)
                    if qs_vtt.get("url"):
                        eff_sub_url = qs_vtt["url"][0]
                except Exception:
                    pass

            if eff_sub_url.startswith(("http://", "https://")) and self._is_safe_aux_url(eff_sub_url, local_port=0):
                try:
                    with self._open_safe_aux_url(eff_sub_url, timeout=12, local_port=0) as r_s:
                        if r_s.status == 200:
                            raw_bytes = r_s.read(4 * 1024 * 1024)
                            if raw_bytes:
                                vtt_content = convert_any_subtitle_to_webvtt(raw_bytes, offset_sec=0.0)
                except Exception as aux_exc:
                    if "Disallowed" not in str(aux_exc) and self.net is not None:
                        try:
                            if hasattr(self.net, "request_bytes"):
                                st, fb_raw, fb_hdrs = self.net.request_bytes(eff_sub_url, spoof_geo_country="DIRECT", timeout=10)
                            elif hasattr(self.net, "request"):
                                st, fb_raw, fb_hdrs = self.net.request(eff_sub_url, spoof_geo_country="DIRECT", timeout=10)
                            else:
                                st, fb_raw, fb_hdrs = 0, b"", {}
                            final_u = str((fb_hdrs or {}).get("_final_url") or eff_sub_url)
                            if st == 200 and fb_raw and self._is_safe_aux_url(final_u, local_port=0):
                                vtt_content = convert_any_subtitle_to_webvtt(fb_raw, offset_sec=0.0)
                        except Exception:
                            pass

            if (
                vtt_content
                and "WEBVTT" in vtt_content
                and len(vtt_content) > 12
                and not self._is_run_aborted(did, run_id)
                and os.path.isdir(item_dir)
            ):
                try:
                    with open(dest_vtt, "w", encoding="utf-8") as sf:
                        sf.write(vtt_content)
                    if self._is_run_aborted(did, run_id):
                        try:
                            os.remove(dest_vtt)
                        except OSError:
                            pass
                    else:
                        saved_subs.append(
                            {
                                "code": code,
                                "lang": label,
                                "file": fname,
                                "url": f"/api/downloads/sub/{did}/{fname}",
                                "direct_vtt": True,
                            }
                        )
                except Exception:
                    pass

        if saved_subs and not self._is_run_aborted(did, run_id):
            with self._lock:
                cur_it = self._items.get(did)
                if cur_it and str(cur_it.get("_run_id") or "") == run_id and did not in self._cancelled_ids:
                    cur_it["local_subtitles"] = saved_subs
                    self._save_index_locked(changed_ids=[did])

    def _probe_duration_if_needed(self, source_url: str, current_dur: float) -> float:
        if current_dur > 30.0:
            return current_dur
        if self.remux and hasattr(self.remux, "probe_media"):
            try:
                pr = self.remux.probe_media(source_url, fast_probe=True)
                probed_dur = float(pr.get("duration") or 0.0)
                if probed_dur > 10.0:
                    return probed_dur
            except Exception:
                pass
        return current_dur

    def _run_download_task(self, did: str) -> None:
        with self._lock:
            if did in self._inflight_ids:
                return
            self._inflight_ids.add(did)
        try:
            self._run_download_task_impl(did)
        finally:
            requeue = False
            with self._lock:
                self._inflight_ids.discard(did)
                cur = self._items.get(did)
                if cur and cur.get("status") == "queued" and did not in self._cancelled_ids and not self._shutdown:
                    requeue = True
            if requeue:
                self._queue.put(did)

    def _run_download_task_impl(self, did: str) -> None:
        started_ts = time.time()
        with self._lock:
            entry = self._items.get(did)
            if not entry or did in self._cancelled_ids:
                return
            if entry.get("status") != "queued":
                # Duplicate queue entry (cancel → re-enqueue race) or already processed
                return
            my_run_id = str(entry.get("_run_id") or "")
            entry["status"] = "downloading"
            entry["started_at"] = started_ts
            entry["error"] = ""
            self._save_index_locked(changed_ids=[did])
            snapshot = dict(entry)

        item_dir = os.path.join(self.downloads_dir, did)
        os.makedirs(item_dir, exist_ok=True)
        part_path = os.path.join(item_dir, "video.mp4.part")
        final_path = os.path.join(item_dir, "video.mp4")

        try:
            port_val = int(self.local_port_getter() if callable(self.local_port_getter) else 8765)
        except Exception:
            port_val = 8765

        src_url = str(snapshot.get("stream_url") or "").strip()
        if (not src_url or snapshot.get("lazy_resolve")) and self.stream_resolver is not None:
            try:
                resolved = self.stream_resolver(snapshot) or {}
            except Exception as exc:
                resolved = {"error": str(exc)}
            resolved_url = str(resolved.get("stream_url") or "").strip()
            if resolved_url.startswith(("/api/proxy-stream", "/api/remux-stream")):
                resolved_url = f"http://127.0.0.1:{port_val}{resolved_url}"
            if not resolved_url:
                with self._lock:
                    cur_it = self._items.get(did)
                    if cur_it and str(cur_it.get("_run_id") or "") == my_run_id and did not in self._cancelled_ids:
                        cur_it["status"] = "failed"
                        cur_it["speed_label"] = ""
                        cur_it["error"] = str(
                            resolved.get("error") or "Не удалось получить видеопоток серии"
                        )
                        self._save_index_locked(changed_ids=[did])
                return
            src_url = resolved_url
            snapshot["stream_url"] = resolved_url
            snapshot["lazy_resolve"] = False
            if resolved.get("quality"):
                snapshot["quality"] = str(resolved["quality"])
            if resolved.get("studio"):
                snapshot["studio"] = str(resolved["studio"])
            if resolved.get("translator_id"):
                snapshot["translator_id"] = str(resolved["translator_id"])
            if resolved.get("subtitles") and not snapshot.get("requested_subtitles"):
                snapshot["requested_subtitles"] = list(resolved["subtitles"])
            if resolved.get("episode_title") and not snapshot.get("episode_title"):
                snapshot["episode_title"] = str(resolved["episode_title"])
            if "is_remux_source" in resolved:
                snapshot["is_remux_source"] = bool(resolved.get("is_remux_source"))
            if "audio_index" in resolved:
                snapshot["audio_index"] = max(0, int(resolved.get("audio_index") or 0))
            if resolved.get("video_codec"):
                snapshot["video_codec"] = str(resolved["video_codec"])
            if resolved.get("audio_codec"):
                snapshot["audio_codec"] = str(resolved["audio_codec"])
            if resolved.get("channels"):
                snapshot["channels"] = max(1, int(resolved.get("channels") or 2))
            if resolved.get("duration_sec") and not snapshot.get("duration_sec"):
                snapshot["duration_sec"] = float(resolved.get("duration_sec") or 0.0)
            with self._lock:
                cur_it = self._items.get(did)
                if cur_it and str(cur_it.get("_run_id") or "") == my_run_id:
                    for upd_k in (
                        "stream_url",
                        "lazy_resolve",
                        "quality",
                        "studio",
                        "translator_id",
                        "requested_subtitles",
                        "episode_title",
                        "is_remux_source",
                        "audio_index",
                        "video_codec",
                        "audio_codec",
                        "channels",
                        "duration_sec",
                    ):
                        if upd_k in snapshot:
                            cur_it[upd_k] = snapshot[upd_k]
                    self._save_index_locked(changed_ids=[did])

        if src_url.startswith(("/api/proxy-stream", "/api/remux-stream")):
            src_url = f"http://127.0.0.1:{port_val}{src_url}"

        if not src_url or not self._is_safe_stream_url(src_url, local_port=port_val):
            with self._lock:
                cur_it = self._items.get(did)
                if cur_it and str(cur_it.get("_run_id") or "") == my_run_id and did not in self._cancelled_ids:
                    cur_it["status"] = "failed"
                    cur_it["speed_label"] = ""
                    cur_it["error"] = (
                        "Не указана ссылка на видеопоток для загрузки"
                        if not src_url
                        else "Недопустимая ссылка на видеопоток для загрузки"
                    )
                    self._save_index_locked(changed_ids=[did])
            return

        try:
            free_bytes = shutil.disk_usage(self.downloads_dir).free
        except OSError:
            free_bytes = 10 * 1024 * 1024 * 1024
        if free_bytes < _MIN_FREE_DISK_BYTES:
            with self._lock:
                cur_it = self._items.get(did)
                if cur_it and str(cur_it.get("_run_id") or "") == my_run_id and did not in self._cancelled_ids:
                    cur_it["status"] = "failed"
                    cur_it["speed_label"] = ""
                    cur_it["error"] = "Недостаточно свободного места на диске"
                    self._save_index_locked(changed_ids=[did])
            return

        # Fetch poster + subtitles in parallel while FFmpeg remuxes the video
        aux_thread = threading.Thread(
            target=self._download_poster_and_subtitles,
            args=(did, my_run_id, snapshot, item_dir),
            daemon=True,
        )
        aux_thread.start()

        dur_sec = self._probe_duration_if_needed(src_url, float(snapshot.get("duration_sec") or 0.0))
        if dur_sec > 0:
            with self._lock:
                cur_it = self._items.get(did)
                if cur_it and str(cur_it.get("_run_id") or "") == my_run_id:
                    cur_it["duration_sec"] = dur_sec

        cmd = self.build_ffmpeg_download_command(
            source_url=src_url,
            output_path=part_path,
            audio_index=int(snapshot.get("audio_index") or 0),
            video_codec=str(snapshot.get("video_codec") or ""),
            audio_codec=str(snapshot.get("audio_codec") or ""),
            channels=int(snapshot.get("channels") or 2),
            is_remux_source=bool(snapshot.get("is_remux_source")),
        )

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=build_ffmpeg_env(src_url),
            creationflags=_SUBPROC_NO_WINDOW,
        )
        stderr_lines: deque = deque(maxlen=40)

        def _drain_stderr() -> None:
            if not proc.stderr:
                return
            while True:
                try:
                    err_line = proc.stderr.readline()
                except Exception:
                    break
                if not err_line:
                    break
                s_err = err_line.strip()
                if s_err:
                    stderr_lines.append(s_err)

        stderr_thread = threading.Thread(target=_drain_stderr, daemon=True)
        stderr_thread.start()

        with self._lock:
            self._active_procs[did] = proc
            cur_it = self._items.get(did)
            if did in self._cancelled_ids or not cur_it or str(cur_it.get("_run_id") or "") != my_run_id:
                try:
                    proc.terminate()
                except Exception:
                    pass

        last_save_ts = 0.0
        last_bytes = 0
        last_bytes_ts = time.time()
        started_ts = last_bytes_ts
        out_time_sec = 0.0
        cur_size = 0
        speed_str = ""
        aborted_early = False

        try:
            if proc.stdout:
                for raw_line in proc.stdout:
                    if did in self._cancelled_ids:
                        aborted_early = True
                        break
                    line = raw_line.strip()
                    if "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    if k not in ("out_time_us", "out_time_ms", "total_size", "speed", "progress"):
                        continue
                    v = v.strip()
                    with self._lock:
                        cur_check = self._items.get(did)
                        if not cur_check or str(cur_check.get("_run_id") or "") != my_run_id:
                            aborted_early = True
                            break
                    v_num = v.lstrip("-")
                    if k in ("out_time_us", "out_time_ms") and v_num.isascii() and v_num.isdigit():
                        out_time_sec = max(0.0, int(v) / 1_000_000.0)
                    elif k == "total_size" and v.isascii() and v.isdigit():
                        cur_size = int(v)
                    elif k == "speed" and v and v != "N/A":
                        speed_str = v
                    elif k == "progress":
                        now = time.time()
                        dt = max(0.2, now - last_bytes_ts)
                        if cur_size <= 0 and os.path.isfile(part_path):
                            try:
                                cur_size = os.path.getsize(part_path)
                            except OSError:
                                pass
                        bps = max(0.0, (cur_size - last_bytes) / dt) if cur_size >= last_bytes else 0.0
                        if dt >= 0.8:
                            last_bytes = cur_size
                            last_bytes_ts = now
                        pct = 0.0
                        eta = 0
                        if dur_sec > 5.0 and out_time_sec > 0:
                            pct = min(99.4, max(0.5, (out_time_sec / dur_sec) * 100.0))
                            if pct > 1.0:
                                elapsed_wall = max(1.0, now - started_ts)
                                eta = max(0, int(elapsed_wall * (100.0 - pct) / pct))
                        mbps_label = f"{bps / (1024 * 1024):.1f} МБ/с" if bps > 65536 else speed_str
                        with self._lock:
                            it = self._items.get(did)
                            if it and str(it.get("_run_id") or "") == my_run_id and did not in self._cancelled_ids:
                                it["downloaded_bytes"] = cur_size
                                if pct > it.get("progress_pct", 0.0):
                                    it["progress_pct"] = round(pct, 1)
                                it["speed_label"] = mbps_label
                                it["eta_sec"] = eta
                                if now - last_save_ts >= 3.0:
                                    self._save_single_progress_locked(did)
                                    last_save_ts = now

            if aborted_early:
                try:
                    proc.terminate()
                except Exception:
                    pass
                try:
                    proc.wait(timeout=1.5)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
            else:
                # Allow up to 180s for -movflags +faststart moov relocation on large 4K files while polling cancellation
                wait_deadline = time.monotonic() + 180.0
                while proc.poll() is None and time.monotonic() < wait_deadline:
                    if self._is_run_aborted(did, my_run_id):
                        try:
                            proc.terminate()
                        except Exception:
                            pass
                        break
                    try:
                        proc.wait(timeout=0.5)
                        break
                    except subprocess.TimeoutExpired:
                        continue
                if proc.poll() is None:
                    try:
                        proc.kill()
                    except Exception:
                        pass
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
        finally:
            if proc.poll() is None:
                try:
                    proc.kill()
                except Exception:
                    pass
            try:
                proc.wait(timeout=2.0)
            except Exception:
                pass
            for stream_pipe in (proc.stdout, proc.stderr):
                if stream_pipe is not None:
                    try:
                        stream_pipe.close()
                    except Exception:
                        pass
            with self._lock:
                if self._active_procs.get(did) is proc:
                    self._active_procs.pop(did, None)

        stderr_thread.join(timeout=2.0)
        aux_thread.join(timeout=8.0)

        deleted_from_index = False
        requeued_or_replaced = False
        with self._lock:
            cur_after = self._items.get(did)
            if cur_after is None:
                deleted_from_index = True
            elif str(cur_after.get("_run_id") or "") != my_run_id:
                requeued_or_replaced = True

        if deleted_from_index:
            shutil.rmtree(item_dir, ignore_errors=True)
            return
        if requeued_or_replaced:
            try:
                if os.path.isfile(part_path):
                    os.remove(part_path)
            except OSError:
                pass
            return

        if did in self._cancelled_ids:
            try:
                if os.path.isfile(part_path):
                    os.remove(part_path)
            except OSError:
                pass
            with self._lock:
                cur_it = self._items.get(did)
                if cur_it is None:
                    deleted_from_index = True
                elif str(cur_it.get("_run_id") or "") == my_run_id:
                    cur_it["status"] = "cancelled"
                    cur_it["speed_label"] = ""
                    self._save_single_progress_locked(did)
                    self._save_index_locked(skip_db=True)
            if deleted_from_index:
                shutil.rmtree(item_dir, ignore_errors=True)
            return

        err_tail = " | ".join(stderr_lines)[-240:] if stderr_lines else ""
        premature_eof = bool(dur_sec >= 120.0 and 0.0 < out_time_sec < dur_sec * 0.85)

        if (
            proc.returncode == 0
            and not premature_eof
            and os.path.isfile(part_path)
            and os.path.getsize(part_path) > 32768
        ):
            os.replace(part_path, final_path)
            fsize = os.path.getsize(final_path)
            with self._lock:
                it = self._items.get(did)
                if it and str(it.get("_run_id") or "") == my_run_id:
                    it["status"] = "completed"
                    it["progress_pct"] = 100.0
                    it["file_size"] = fsize
                    it["downloaded_bytes"] = fsize
                    it["speed_label"] = ""
                    it["eta_sec"] = 0
                    it["completed_at"] = time.time()
                    self._save_single_progress_locked(did)
                    self._save_index_locked(skip_db=True)
        else:
            try:
                if os.path.isfile(part_path):
                    os.remove(part_path)
            except OSError:
                pass
            with self._lock:
                it = self._items.get(did)
                if it and str(it.get("_run_id") or "") == my_run_id:
                    it["status"] = "failed"
                    it["speed_label"] = ""
                    it["error"] = (
                        "Видеопоток оборвался до завершения загрузки"
                        if premature_eof
                        else (err_tail or "Не удалось сохранить видеопоток")
                    )
                    self._save_single_progress_locked(did)
                    self._save_index_locked(skip_db=True)

    _SAFE_DID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]{0,159}$")

    def _is_safe_download_id(self, did: str) -> bool:
        """Download ids are generated slugs (dl_<slug>_<hash>); reject '.', drive letters, separators, etc."""
        if not did or not self._SAFE_DID_RE.match(did):
            return False
        try:
            root = os.path.realpath(self.downloads_dir)
            target = os.path.realpath(os.path.join(root, did))
            return os.path.dirname(target) == root
        except Exception:
            return False

    def cancel_download(self, download_id: str, force_mark_cancelled: bool = False) -> bool:
        did = str(download_id or "").strip()
        if not self._is_safe_download_id(did):
            return False
        with self._lock:
            proc = self._active_procs.get(did)
            aux_proc = self._active_aux_procs.get(did)
            entry = self._items.get(did)
            is_active = bool(
                force_mark_cancelled
                or did in self._inflight_ids
                or proc is not None
                or aux_proc is not None
                or (entry and entry.get("status") in ("queued", "downloading"))
            )
            if is_active:
                if len(self._cancelled_ids) >= 512:
                    self._cancelled_ids.intersection_update(self._items.keys())
                self._cancelled_ids.add(did)
            if entry and entry.get("status") in ("queued", "downloading"):
                entry["status"] = "cancelled"
                entry["speed_label"] = ""
                self._save_single_progress_locked(did)
                self._save_index_locked(skip_db=True)
        for active_p in (proc, aux_proc):
            if active_p and active_p.poll() is None:
                try:
                    active_p.terminate()
                    active_p.wait(timeout=1.5)
                except Exception:
                    try:
                        active_p.kill()
                        active_p.wait(timeout=0.5)
                    except Exception:
                        pass
        part_p = os.path.join(self.downloads_dir, did, "video.mp4.part")
        if os.path.isfile(part_p):
            try:
                os.remove(part_p)
            except OSError:
                pass
        return True

    def retry_download(self, download_id: str, lang: str = "ru") -> Dict[str, Any]:
        did = str(download_id or "").strip()
        if not self._is_safe_download_id(did):
            return {"ok": False, "error": "Недопустимый идентификатор загрузки"}
        with self._lock:
            entry = self._items.get(did)
            if not entry:
                return {"ok": False, "error": "Загрузка не найдена"}
            if entry.get("status") in ("queued", "downloading"):
                return {"ok": True, "item": self._format_entry_for_client(entry, lang=lang)}
            if entry.get("status") == "completed":
                vpath = os.path.join(self.downloads_dir, did, "video.mp4")
                if os.path.isfile(vpath) and os.path.getsize(vpath) > 32768:
                    return {"ok": True, "item": self._format_entry_for_client(entry, lang=lang)}

            self._cancelled_ids.discard(did)
            entry["status"] = "queued"
            entry["error"] = ""
            entry["speed_label"] = ""
            entry["_run_id"] = f"{time.time():.6f}_{threading.get_ident()}"
            if self.stream_resolver is not None:
                entry["lazy_resolve"] = True
            self._save_single_progress_locked(did)
            self._queue.put(did)
            return {"ok": True, "item": self._format_entry_for_client(entry, lang=lang)}

    def delete_download(self, download_id: str) -> bool:
        did = str(download_id or "").strip()
        if not self._is_safe_download_id(did):
            return False
        self.cancel_download(did, force_mark_cancelled=True)
        with self._lock:
            self._cancelled_ids.discard(did)
            existed = self._items.pop(did, None) is not None
            try:
                self._db.delete_download_record(did)
            except Exception:
                pass
            self._save_index_locked(skip_db=True)
        folder = os.path.join(self.downloads_dir, did)
        if os.path.isdir(folder):
            shutil.rmtree(folder, ignore_errors=True)
            existed = True
        return existed

    def delete_profile_downloads(self, profile_id: str) -> int:
        pid = str(profile_id or "").strip()
        if not pid or pid == "main":
            return 0
        with self._lock:
            dids = [
                str(did)
                for did, it in self._items.items()
                if isinstance(it, dict) and str(it.get("profile_id") or "main") == pid
            ]
        removed = 0
        for did in dids:
            if self.delete_download(did):
                removed += 1
        return removed

    def get_video_file_path(self, download_id: str) -> Optional[str]:
        did = str(download_id or "").strip()
        if not self._is_safe_download_id(did):
            return None
        vpath = os.path.join(self.downloads_dir, did, "video.mp4")
        return vpath if os.path.isfile(vpath) else None

    def get_subtitle_file_path(self, download_id: str, filename: str) -> Optional[str]:
        did = str(download_id or "").strip()
        fn = os.path.basename(str(filename or "").strip())
        if not self._is_safe_download_id(did) or not fn.endswith(".vtt") or fn.startswith("."):
            return None
        spath = os.path.join(self.downloads_dir, did, fn)
        return spath if os.path.isfile(spath) else None

    def get_poster_file_path(self, download_id: str) -> Optional[str]:
        did = str(download_id or "").strip()
        if not self._is_safe_download_id(did):
            return None
        ppath = os.path.join(self.downloads_dir, did, "poster.jpg")
        return ppath if os.path.isfile(ppath) else None

    @staticmethod
    def _reap_helper_proc(proc: subprocess.Popen) -> None:
        try:
            proc.wait(timeout=15)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    def reveal_in_file_manager(self, download_id: str = "") -> Dict[str, Any]:
        did = str(download_id or "").strip()
        target_video = self.get_video_file_path(did) if did else None
        target_dir = os.path.dirname(target_video) if target_video else self.downloads_dir
        os.makedirs(target_dir, exist_ok=True)
        try:
            if sys.platform == "darwin":
                if target_video and os.path.isfile(target_video):
                    proc = subprocess.Popen(["open", "-R", target_video])
                else:
                    proc = subprocess.Popen(["open", target_dir])
            elif sys.platform == "win32":
                if target_video and os.path.isfile(target_video):
                    proc = subprocess.Popen(["explorer", f"/select,{target_video}"])
                else:
                    proc = subprocess.Popen(["explorer", target_dir])
            else:
                proc = subprocess.Popen(["xdg-open", target_dir])
            threading.Thread(target=self._reap_helper_proc, args=(proc,), daemon=True).start()
            return {"ok": True, "path": target_video or target_dir}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "path": target_video or target_dir}

    @staticmethod
    def _is_entry_kids_safe(entry: Dict[str, Any], active_profile_id: str = "") -> bool:
        if not isinstance(entry, dict):
            return False
        if entry.get("kids_safe") is True:
            return True
        if ProfileManager.is_item_kids_safe(entry):
            return True
        if entry.get("kids_safe") is False:
            return False
        # Legacy entry without explicit `kids_safe` flag and without genres: allow only if created in `kids` profile
        entry_prof = str(entry.get("profile_id") or "")
        if "kids_safe" not in entry and not entry.get("genres") and entry_prof == "kids":
            probe = dict(entry)
            probe["genres"] = ["семейный"]
            return ProfileManager.is_item_kids_safe(probe)
        return False

    def is_download_allowed(
        self,
        download_id: str,
        kids_mode: bool = False,
        active_profile_id: str = "",
    ) -> bool:
        if not kids_mode:
            return True
        did = str(download_id or "").strip()
        with self._lock:
            entry = self._items.get(did)
            if not entry:
                return False
            return self._is_entry_kids_safe(entry, active_profile_id=active_profile_id)

    def get_download_export_filename(self, download_id: str) -> str:
        did = str(download_id or "").strip()
        with self._lock:
            entry = self._items.get(did) or {}
        raw_title = str(entry.get("orig_title") or entry.get("title") or "Velarium_Video").strip()
        clean_title = re.sub(r'[\\/:*?"<>|\r\n]+', "", raw_title).strip()[:64] or "Velarium_Video"
        is_series = entry.get("media_type") == "series"
        ep_tag = (
            f" S{int(entry.get('season') or 1):02d}E{int(entry.get('episode') or 1):02d}"
            if is_series
            else (f" ({entry.get('year')})" if entry.get("year") else "")
        )
        qual = re.sub(r"[^a-zA-Z0-9_-]+", "", str(entry.get("quality") or "1080p"))
        qual_tag = f" {qual}" if qual else ""
        return f"{clean_title}{ep_tag}{qual_tag}.mp4"

    def _format_entry_for_client(self, entry: Dict[str, Any], lang: str = "ru") -> Dict[str, Any]:
        did = str(entry.get("download_id") or "")
        is_en = str(lang or "ru").strip().lower().startswith("en")
        raw_speed = str(entry.get("speed_label") or "")
        if is_en and raw_speed:
            raw_speed = raw_speed.replace(" МБ/с", " MB/s").replace("МБ/с", "MB/s")
        raw_err = str(entry.get("error") or "")
        if is_en and raw_err:
            err_en_map = {
                "Загрузка была прервана при перезапуске": "Download was interrupted on restart",
                "Файл видео не найден на диске": "Video file not found on disk",
                "Не удалось сохранить видеопоток": "Failed to save video stream",
                "Не удалось получить видеопоток серии": "Failed to resolve episode video stream",
                "Не указана ссылка на видеопоток для загрузки": "Missing video stream URL for download",
                "Недопустимая ссылка на видеопоток для загрузки": "Disallowed video stream URL for download",
                "Недостаточно свободного места на диске": "Insufficient free disk space",
                "Видеопоток оборвался до завершения загрузки": "Video stream ended prematurely before completion",
            }
            raw_err = err_en_map.get(raw_err, raw_err)
        fmt_subs: List[Dict[str, Any]] = []
        for s in list(entry.get("local_subtitles") or []):
            if not isinstance(s, dict):
                continue
            sc = dict(s)
            slbl = str(sc.get("lang") or "")
            if is_en:
                if slbl == "Русский":
                    sc["lang"] = "Russian"
                elif slbl.startswith("Субтитры #"):
                    sc["lang"] = slbl.replace("Субтитры #", "Subtitles #")
            else:
                if slbl == "English":
                    sc["lang"] = "Английский"
                elif slbl.startswith("Subtitles #"):
                    sc["lang"] = slbl.replace("Subtitles #", "Субтитры #")
            fmt_subs.append(sc)
        out = {
            "download_id": did,
            "profile_id": entry.get("profile_id", "main"),
            "item_id": entry.get("item_id", ""),
            "kinorium_id": entry.get("kinorium_id", ""),
            "rezka_id": entry.get("rezka_id", ""),
            "rezka_url": entry.get("rezka_url", ""),
            "title": entry.get("title", ""),
            "orig_title": entry.get("orig_title", ""),
            "year": entry.get("year", ""),
            "media_type": entry.get("media_type", "movie"),
            "season": int(entry.get("season") or 1),
            "episode": int(entry.get("episode") or 1),
            "episode_title": entry.get("episode_title", ""),
            "genres": list(entry.get("genres") or []),
            "kids_safe": bool(entry.get("kids_safe", False)),
            "poster": (
                f"/api/downloads/poster/{did}"
                if entry.get("has_local_poster")
                else entry.get("poster_remote", "")
            ),
            "backdrop": entry.get("backdrop_remote") or entry.get("poster_remote", ""),
            "quality": entry.get("quality", "1080p"),
            "studio": entry.get("studio", "HDRezka"),
            "translator_id": entry.get("translator_id", ""),
            "source_tab": entry.get("source_tab", "hdrezka"),
            "status": entry.get("status", "queued"),
            "pending_cleanup": bool(entry.get("pending_cleanup", False)),
            "progress_pct": float(entry.get("progress_pct") or 0.0),
            "downloaded_bytes": int(entry.get("downloaded_bytes") or 0),
            "file_size": int(entry.get("file_size") or 0),
            "duration_sec": float(entry.get("duration_sec") or 0.0),
            "speed_label": raw_speed,
            "eta_sec": int(entry.get("eta_sec") or 0),
            "error": raw_err,
            "created_at": float(entry.get("created_at") or 0.0),
            "completed_at": float(entry.get("completed_at") or 0.0),
            "play_url": f"/api/downloads/stream/{did}",
            "export_url": f"/api/downloads/stream/{did}?download=1",
            "subtitles": fmt_subs,
        }
        return out

    @staticmethod
    def _entry_matches_work(
        entry: Dict[str, Any],
        item_id: str = "",
        kinorium_id: str = "",
        rezka_id: str = "",
        title: str = "",
    ) -> bool:
        e_id = str(entry.get("item_id") or "").strip()
        e_kid = str(entry.get("kinorium_id") or "").strip()
        e_rid = str(entry.get("rezka_id") or "").strip()
        if item_id and e_id and item_id == e_id:
            return True
        if kinorium_id and e_kid and kinorium_id == e_kid:
            return True
        if rezka_id and e_rid and rezka_id == e_rid:
            return True
        has_req_ids = bool(item_id or kinorium_id or rezka_id)
        has_entry_ids = bool(e_id or e_kid or e_rid)
        if has_req_ids and has_entry_ids:
            # Both sides carry real ids and none matched: same title ≠ same work (remakes, homonyms)
            return False
        t_norm = str(title or "").strip().lower()
        if t_norm and t_norm in (
            str(entry.get("title") or "").strip().lower(),
            str(entry.get("orig_title") or "").strip().lower(),
        ):
            return True
        return False

    def handle_watched_scrobble(
        self,
        *,
        item_id: str = "",
        kinorium_id: str = "",
        rezka_id: str = "",
        title: str = "",
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        is_active_offline_playback: bool = False,
        active_download_id: str = "",
        profile_id: str = "",
        lang: str = "ru",
    ) -> Dict[str, Any]:
        prefs = self.get_prefs()
        auto_clean = bool(prefs.get("auto_cleanup_watched"))
        auto_next = bool(prefs.get("auto_download_next"))
        if not auto_clean and not auto_next:
            return {"ok": True, "cleaned": [], "queued_next": None}

        eff_type = "series" if str(media_type or "").lower() == "series" else "movie"
        eff_s = max(1, int(season or 1)) if eff_type == "series" else 1
        eff_e = max(1, int(episode or 1)) if eff_type == "series" else 1
        req_prof = str(profile_id or "").strip()

        matched_episode_ids: List[str] = []
        series_template: Optional[Dict[str, Any]] = None
        next_already_exists = False
        next_ep = eff_e + 1

        with self._lock:
            for did, entry in list(self._items.items()):
                if entry.get("media_type") != eff_type:
                    continue
                if req_prof and req_prof != "all":
                    entry_prof = str(entry.get("profile_id") or "main").strip() or "main"
                    if entry_prof != req_prof and not (active_download_id and did == active_download_id):
                        continue
                if not self._entry_matches_work(
                    entry,
                    item_id=str(item_id or "").strip(),
                    kinorium_id=str(kinorium_id or "").strip(),
                    rezka_id=str(rezka_id or "").strip(),
                    title=str(title or "").strip(),
                ):
                    continue
                e_s = int(entry.get("season") or 1)
                e_e = int(entry.get("episode") or 1)
                if eff_type == "series" and e_s == eff_s:
                    if (series_template is None or e_e == eff_e) and entry.get("status") in (
                        "completed",
                        "downloading",
                        "queued",
                    ):
                        series_template = dict(entry)
                    if e_e == next_ep and entry.get("status") in ("completed", "downloading", "queued"):
                        next_already_exists = True
                if e_s == eff_s and e_e == eff_e and entry.get("status") == "completed":
                    matched_episode_ids.append(did)

        cleaned_ids: List[str] = []
        deferred_ids: List[str] = []
        if auto_clean and matched_episode_ids:
            for did in matched_episode_ids:
                if is_active_offline_playback or (active_download_id and did == active_download_id):
                    with self._lock:
                        if did in self._items:
                            self._items[did]["pending_cleanup"] = True
                            self._save_index_locked(changed_ids=[did])
                            deferred_ids.append(did)
                else:
                    if self.delete_download(did):
                        cleaned_ids.append(did)

        queued_next_item: Optional[Dict[str, Any]] = None
        if (
            auto_next
            and eff_type == "series"
            and series_template is not None
            and not next_already_exists
            and self.stream_resolver is not None
        ):
            max_ep_hint = int(series_template.get("max_season_episode") or 0)
            if max_ep_hint <= 0 or next_ep <= max_ep_hint:
                try:
                    queued_next_item = self.enqueue_download(
                        item_id=str(series_template.get("item_id") or item_id or ""),
                        kinorium_id=str(series_template.get("kinorium_id") or kinorium_id or ""),
                        rezka_id=str(series_template.get("rezka_id") or rezka_id or ""),
                        rezka_url=str(series_template.get("rezka_url") or ""),
                        title=str(series_template.get("title") or title or "Сериал"),
                        orig_title=str(series_template.get("orig_title") or ""),
                        year=series_template.get("year") or "",
                        media_type="series",
                        season=eff_s,
                        episode=next_ep,
                        episode_title="",
                        poster=str(series_template.get("poster_remote") or ""),
                        backdrop=str(series_template.get("backdrop_remote") or ""),
                        stream_url="",
                        quality=str(series_template.get("quality") or "1080p"),
                        studio=str(series_template.get("studio") or "HDRezka"),
                        translator_id=str(series_template.get("translator_id") or ""),
                        source_tab=str(series_template.get("source_tab") or "hdrezka"),
                        profile_id=str(series_template.get("profile_id") or "main"),
                        genres=list(series_template.get("genres") or []),
                        age_rating=str(series_template.get("age_rating") or ""),
                        kids_safe=series_template.get("kids_safe"),
                        lazy_resolve=True,
                        max_season_episode=max_ep_hint,
                        lang=lang,
                    )
                except Exception:
                    queued_next_item = None

        return {
            "ok": True,
            "cleaned": cleaned_ids,
            "deferred": deferred_ids,
            "queued_next": queued_next_item,
        }

    def sweep_pending_cleanups(self, exclude_download_id: str = "") -> Dict[str, Any]:
        excl = str(exclude_download_id or "").strip()
        to_delete: List[str] = []
        with self._lock:
            for did, entry in list(self._items.items()):
                if entry.get("pending_cleanup") and did != excl:
                    to_delete.append(did)
        deleted: List[str] = []
        for did in to_delete:
            if self.delete_download(did):
                deleted.append(did)
        return {"ok": True, "deleted_ids": deleted}

    def get_downloads_payload(
        self,
        profile_id: Optional[str] = None,
        kids_mode: bool = False,
        active_profile_id: str = "",
        lang: str = "ru",
    ) -> Dict[str, Any]:
        prefs = self.get_prefs()
        with self._lock:
            items_snapshot = [dict(it) for it in self._items.values()]
        ordered = sorted(
            items_snapshot,
            key=lambda x: float(x.get("created_at") or 0.0),
            reverse=True,
        )
        if kids_mode:
            ordered = [
                it
                for it in ordered
                if self._is_entry_kids_safe(it, active_profile_id=active_profile_id)
            ]
        if profile_id and profile_id != "all":
            ordered = [it for it in ordered if it.get("profile_id", "main") in (profile_id, "main", "")]
        formatted = [self._format_entry_for_client(it, lang=lang) for it in ordered]
        total_bytes = sum(
            int(it.get("file_size") or it.get("downloaded_bytes") or 0)
            for it in ordered
            if it.get("status") in ("completed", "downloading")
        )
        active_count = sum(
            1 for it in ordered if it.get("status") in ("queued", "downloading")
        )
        completed_count = sum(1 for it in ordered if it.get("status") == "completed")
        return {
            "ok": True,
            "downloads_dir": self.downloads_dir,
            "active_count": active_count,
            "completed_count": completed_count,
            "total_disk_bytes": total_bytes,
            "prefs": prefs,
            "items": formatted,
        }

    def _matches_series_season_entry(
        self,
        entry: Dict[str, Any],
        *,
        item_id: str = "",
        kinorium_id: str = "",
        rezka_id: str = "",
        title: str = "",
        season: int = 1,
        kids_mode: bool = False,
        active_profile_id: str = "",
    ) -> bool:
        if entry.get("media_type") != "series":
            return False
        if int(entry.get("season") or 1) != max(1, int(season or 1)):
            return False
        if kids_mode and not self._is_entry_kids_safe(entry, active_profile_id=active_profile_id):
            return False
        e_id = str(entry.get("item_id") or "").strip()
        e_kin = str(entry.get("kinorium_id") or "").strip()
        e_rez = str(entry.get("rezka_id") or "").strip()
        e_title = str(entry.get("title") or "").strip().lower()
        q_id = str(item_id or "").strip()
        q_kin = str(kinorium_id or "").strip()
        q_rez = str(rezka_id or "").strip()
        q_title = str(title or "").strip().lower()
        if q_id and e_id and q_id == e_id:
            return True
        if q_kin and e_kin and q_kin == e_kin:
            return True
        if q_rez and e_rez and q_rez == e_rez:
            return True
        if q_title and e_title and q_title == e_title:
            return True
        return False

    def get_season_download_status(
        self,
        *,
        item_id: str = "",
        kinorium_id: str = "",
        rezka_id: str = "",
        title: str = "",
        season: int = 1,
        kids_mode: bool = False,
        active_profile_id: str = "",
        lang: str = "ru",
    ) -> Dict[str, Any]:
        eff_s = max(1, int(season or 1))
        with self._lock:
            matched = [
                dict(it)
                for it in self._items.values()
                if self._matches_series_season_entry(
                    it,
                    item_id=item_id,
                    kinorium_id=kinorium_id,
                    rezka_id=rezka_id,
                    title=title,
                    season=eff_s,
                    kids_mode=kids_mode,
                    active_profile_id=active_profile_id,
                )
            ]
        matched.sort(key=lambda x: int(x.get("episode") or 1))
        formatted = [self._format_entry_for_client(it, lang=lang) for it in matched]
        completed_count = sum(1 for it in matched if it.get("status") == "completed")
        active_count = sum(1 for it in matched if it.get("status") in ("downloading", "queued"))
        failed_count = sum(1 for it in matched if it.get("status") in ("failed", "cancelled"))
        total_bytes = sum(
            int(it.get("file_size") or it.get("downloaded_bytes") or 0)
            for it in matched
            if it.get("status") in ("completed", "downloading")
        )
        total_eps = len(matched)
        overall_pct = 0.0
        if total_eps > 0:
            pct_sum = sum(
                100.0
                if it.get("status") == "completed"
                else float(it.get("progress_pct") or 0.0)
                if it.get("status") == "downloading"
                else 0.0
                for it in matched
            )
            overall_pct = round(pct_sum / total_eps, 1)
        free_bytes = 0
        try:
            free_bytes = int(shutil.disk_usage(self.downloads_dir).free)
        except Exception:
            free_bytes = 0
        return {
            "ok": True,
            "season": eff_s,
            "total_episodes": total_eps,
            "completed_count": completed_count,
            "active_count": active_count,
            "failed_count": failed_count,
            "total_bytes": total_bytes,
            "free_bytes": free_bytes,
            "overall_progress_pct": overall_pct,
            "episodes": formatted,
        }

    def delete_season_downloads(
        self,
        *,
        item_id: str = "",
        kinorium_id: str = "",
        rezka_id: str = "",
        title: str = "",
        season: int = 1,
        kids_mode: bool = False,
        active_profile_id: str = "",
    ) -> Dict[str, Any]:
        eff_s = max(1, int(season or 1))
        with self._lock:
            target_ids = [
                did
                for did, it in self._items.items()
                if self._matches_series_season_entry(
                    it,
                    item_id=item_id,
                    kinorium_id=kinorium_id,
                    rezka_id=rezka_id,
                    title=title,
                    season=eff_s,
                    kids_mode=kids_mode,
                    active_profile_id=active_profile_id,
                )
            ]
        deleted_ids: List[str] = []
        for did in target_ids:
            if self.delete_download(did):
                deleted_ids.append(did)
        return {
            "ok": True,
            "season": eff_s,
            "deleted_count": len(deleted_ids),
            "deleted_ids": deleted_ids,
        }

    def shutdown(self) -> None:
        self._shutdown = True
        with self._lock:
            procs = list(self._active_procs.values()) + list(self._active_aux_procs.values())
        for p in procs:
            if p and p.poll() is None:
                try:
                    p.terminate()
                except Exception:
                    pass
                try:
                    p.wait(timeout=1.5)
                except Exception:
                    try:
                        p.kill()
                        p.wait(timeout=1.0)
                    except Exception:
                        pass
