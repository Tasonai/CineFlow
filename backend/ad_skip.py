import json
import os
import select
import subprocess
import sys
import threading
import time
from typing import Any, Dict, List, Optional


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
CACHE_PATH = os.path.join(DATA_DIR, "ad_segments_cache.json")
SWIFT_SRC_PATH = os.path.join(BASE_DIR, "backend", "vision_ad_detector.swift")
SWIFT_BIN_PATH = os.path.join(BASE_DIR, "backend", "bin", "vision_ad_detector")


class _VisionWorkerProcess:
    """Thread-safe wrapper around a persistent native macOS Vision OCR + QR detector process."""

    def __init__(self, bin_path: str):
        self.bin_path = bin_path
        self.lock = threading.Lock()
        self.proc: Optional[subprocess.Popen] = None

    def _ensure_started(self) -> bool:
        if not os.path.isfile(self.bin_path) or not os.access(self.bin_path, os.X_OK):
            return False
        if self.proc is not None and self.proc.poll() is None:
            return True
        try:
            self.proc = subprocess.Popen(
                [self.bin_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                bufsize=1,
            )
            return True
        except Exception:
            self.proc = None
            return False

    def request(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            if not self._ensure_started() or not self.proc or not self.proc.stdin or not self.proc.stdout:
                return {"ok": False}
            try:
                line = json.dumps(payload, ensure_ascii=False) + "\n"
                self.proc.stdin.write(line)
                self.proc.stdin.flush()
                ready, _, _ = select.select([self.proc.stdout], [], [], 4.0)
                if not ready:
                    try:
                        self.proc.kill()
                    except Exception:
                        pass
                    self.proc = None
                    return {"ok": False}
                resp_line = self.proc.stdout.readline()
                if not resp_line:
                    self.proc = None
                    return {"ok": False}
                return json.loads(resp_line)
            except Exception:
                try:
                    if self.proc:
                        self.proc.kill()
                except Exception:
                    pass
                self.proc = None
                return {"ok": False}


class AdSkipEngine:
    """
    Automatic Baked-In Betting / Casino Ad Detector & Skipper:
    1. Uses native Apple Vision OCR (`ru-RU` + `en-US` with Cyrillic/Latin homoglyph normalization)
       + QR barcode detection + frame letterbox/geometry analysis.
    2. Runs a low-priority ahead-of-playhead keyframe scanner on the 360p stream so spliced
       ad breaks (`1xBet`, `1win`, `Melbet`, `Mostbet`, `Fonbet`, `Winline`, `BetBoom`, `Parimatch`,
       `Vavada`, `Dragon Money`, `Azino777`, etc.) are pinpointed BEFORE playback reaches them.
    3. Also provides a <50ms live `<video>` frame analyzer fallback for pre-rolls, direct seeks,
       and external/HLS streams, while distinguishing full commercial cut-ins (`splice`) from
       permanent corner watermarks (`>68s`) and small edge banners (`banner`).
    """

    def __init__(self):
        os.makedirs(DATA_DIR, exist_ok=True)
        self._ensure_binary()
        self.available = os.path.isfile(SWIFT_BIN_PATH) and os.access(SWIFT_BIN_PATH, os.X_OK)

        self.realtime_worker = _VisionWorkerProcess(SWIFT_BIN_PATH)
        self.scanner_worker = _VisionWorkerProcess(SWIFT_BIN_PATH)

        self.cache_lock = threading.RLock()
        self.cache: Dict[str, Dict[str, Any]] = self._load_cache()

        self.scan_lock = threading.RLock()
        self.active_stream_key: str = ""
        self.active_mp4_url: str = ""
        self.active_playhead: float = 0.0
        self.active_duration_hint: float = 0.0
        self.scan_generation: int = 0
        self.scanner_thread: Optional[threading.Thread] = None

    def _ensure_binary(self) -> None:
        if sys.platform != "darwin":
            return
        if os.path.isfile(SWIFT_BIN_PATH) and os.access(SWIFT_BIN_PATH, os.X_OK):
            try:
                if os.path.getmtime(SWIFT_BIN_PATH) >= os.path.getmtime(SWIFT_SRC_PATH):
                    return
            except Exception:
                return
        if not os.path.isfile(SWIFT_SRC_PATH):
            return
        try:
            os.makedirs(os.path.dirname(SWIFT_BIN_PATH), exist_ok=True)
            subprocess.run(
                ["swiftc", "-O", SWIFT_SRC_PATH, "-o", SWIFT_BIN_PATH],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=35,
            )
        except Exception:
            pass

    def _load_cache(self) -> Dict[str, Dict[str, Any]]:
        if not os.path.isfile(CACHE_PATH):
            return {}
        try:
            with open(CACHE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _save_cache_unlocked(self) -> None:
        try:
            if len(self.cache) > 600:
                sorted_keys = sorted(
                    self.cache.keys(),
                    key=lambda k: float((self.cache.get(k) or {}).get("updated_at") or 0.0),
                )
                for old_k in sorted_keys[:150]:
                    self.cache.pop(old_k, None)
            tmp_path = CACHE_PATH + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(self.cache, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, CACHE_PATH)
        except Exception:
            pass

    @staticmethod
    def build_stream_key(
        item_id: str,
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        translator_id: str = "",
        stream_url: str = "",
    ) -> str:
        clean_id = (item_id or "").strip() or "unknown"
        tr = (translator_id or "").strip() or "default"
        if media_type == "series":
            return f"{clean_id}_s{int(season or 1)}_e{int(episode or 1)}_tr{tr}"
        if clean_id != "unknown":
            return f"{clean_id}_movie_tr{tr}"
        # Fallback URL tail key
        tail = (stream_url or "").split("?")[0].split("/")[-2:]
        return "url_" + "_".join(tail)

    def get_stream_entry(self, stream_key: str) -> Dict[str, Any]:
        if not stream_key:
            return {"stream_key": "", "segments": [], "scanned_until": 0.0, "complete": False, "scanning": False}
        with self.cache_lock:
            entry = dict(self.cache.get(stream_key) or {})
        segs = list(entry.get("segments") or [])
        with self.scan_lock:
            is_scanning = bool(self.active_stream_key == stream_key and self.available)
        return {
            "stream_key": stream_key,
            "available": self.available,
            "segments": segs,
            "scanned_until": float(entry.get("scanned_until") or 0.0),
            "complete": bool(entry.get("complete")),
            "scanning": is_scanning and not bool(entry.get("complete")),
            "ignore_peripheral": bool(entry.get("ignore_peripheral")),
        }

    def _merge_segment(self, stream_key: str, new_seg: Dict[str, Any]) -> List[Dict[str, Any]]:
        with self.cache_lock:
            entry = self.cache.setdefault(
                stream_key,
                {
                    "segments": [],
                    "scanned_until": 0.0,
                    "complete": False,
                    "ignore_peripheral": False,
                    "updated_at": time.time(),
                },
            )
            segs: List[Dict[str, Any]] = list(entry.get("segments") or [])
            ns = round(max(0.0, float(new_seg["start"])), 1)
            ne = round(float(new_seg["end"]), 1)
            if ne - ns < 4.0:
                return segs

            merged = False
            for s in segs:
                if not (ne < float(s["start"]) - 3.0 or ns > float(s["end"]) + 3.0):
                    s["start"] = round(min(float(s["start"]), ns), 1)
                    s["end"] = round(max(float(s["end"]), ne), 1)
                    if new_seg.get("kind") == "splice":
                        s["kind"] = "splice"
                    if new_seg.get("brand") and not s.get("brand"):
                        s["brand"] = new_seg["brand"]
                    merged = True
                    break
            if not merged:
                segs.append(
                    {
                        "start": ns,
                        "end": ne,
                        "kind": new_seg.get("kind", "splice"),
                        "brand": new_seg.get("brand", "Реклама ставок"),
                    }
                )
            segs.sort(key=lambda x: float(x["start"]))
            entry["segments"] = segs
            entry["updated_at"] = time.time()
            self._save_cache_unlocked()
            return list(segs)

    def _set_ignore_peripheral(self, stream_key: str) -> None:
        with self.cache_lock:
            entry = self.cache.setdefault(
                stream_key,
                {
                    "segments": [],
                    "scanned_until": 0.0,
                    "complete": False,
                    "ignore_peripheral": True,
                    "updated_at": time.time(),
                },
            )
            entry["ignore_peripheral"] = True
            entry["updated_at"] = time.time()

    def _update_scan_progress(self, stream_key: str, scanned_until: float, complete: bool = False) -> None:
        with self.cache_lock:
            entry = self.cache.setdefault(
                stream_key,
                {
                    "segments": [],
                    "scanned_until": 0.0,
                    "complete": False,
                    "ignore_peripheral": False,
                    "updated_at": time.time(),
                },
            )
            if scanned_until > float(entry.get("scanned_until") or 0.0):
                entry["scanned_until"] = round(scanned_until, 1)
            if complete:
                entry["complete"] = True
            entry["updated_at"] = time.time()
            if complete:
                self._save_cache_unlocked()

    def stop_scan(self) -> None:
        with self.scan_lock:
            self.scan_generation += 1
            self.active_stream_key = ""
            self.active_mp4_url = ""

    def start_or_update_scan(
        self,
        stream_key: str,
        mp4_url: str,
        playhead: float = 0.0,
        duration_hint: float = 0.0,
    ) -> Dict[str, Any]:
        if not self.available or not stream_key or not mp4_url or ".m3u8" in mp4_url:
            return self.get_stream_entry(stream_key)

        with self.cache_lock:
            existing = self.cache.get(stream_key)
            if existing and existing.get("complete"):
                return self.get_stream_entry(stream_key)

        with self.scan_lock:
            same_job = (
                self.active_stream_key == stream_key
                and self.active_mp4_url == mp4_url
                and self.scanner_thread is not None
                and self.scanner_thread.is_alive()
            )
            self.active_playhead = max(0.0, float(playhead or 0.0))
            if duration_hint and duration_hint > 60:
                self.active_duration_hint = float(duration_hint)
            if not same_job:
                self.scan_generation += 1
                gen_id = self.scan_generation
                self.active_stream_key = stream_key
                self.active_mp4_url = mp4_url
                t = threading.Thread(
                    target=self._run_background_scan,
                    args=(gen_id, stream_key, mp4_url),
                    daemon=True,
                )
                self.scanner_thread = t
                t.start()

        return self.get_stream_entry(stream_key)

    def _resolve_ad_boundaries(
        self,
        worker: _VisionWorkerProcess,
        stream_key: str,
        mp4_url: str,
        hit_frame: Dict[str, Any],
        duration_hint: float = 0.0,
    ) -> Optional[Dict[str, Any]]:
        t_hit = float(hit_frame.get("actual_time") or hit_frame.get("timestamp") or 0.0)
        with self.cache_lock:
            ignore_periph = bool((self.cache.get(stream_key) or {}).get("ignore_peripheral"))

        if ignore_periph and not hit_frame.get("is_central") and int(hit_frame.get("score") or 0) < 165:
            return None

        # Step 1: Guard against permanent static corner watermarks (> 72s)
        if not hit_frame.get("is_central") and int(hit_frame.get("score") or 0) < 165:
            far_probes = [t_hit + 72.0, t_hit + 145.0]
            if duration_hint > 180 and t_hit + 72.0 >= duration_hint - 20:
                far_probes = [max(30.0, t_hit - 90.0)]
            wm_resp = worker.request(
                {"cmd": "scan_stream_window", "mp4_url": mp4_url, "timestamps": far_probes, "exact": False}
            )
            wm_frames = wm_resp.get("frames") or []
            if wm_frames and all(
                bool(f.get("is_ad")) and not bool(f.get("is_central")) for f in wm_frames
            ):
                self._set_ignore_peripheral(stream_key)
                return None

        # Step 2: Walk backward (3s steps up to 15s) to pinpoint exact ad_start & pre-ad letterbox
        back_times = [round(t_hit - d, 1) for d in (3, 6, 9, 12, 15) if t_hit - d >= 0.0]
        first_ad_t = t_hit
        pre_clean_frame: Optional[Dict[str, Any]] = None
        observed_ad_frames: List[Dict[str, Any]] = [hit_frame]

        if back_times:
            b_resp = worker.request(
                {"cmd": "scan_stream_window", "mp4_url": mp4_url, "timestamps": back_times, "exact": True}
            )
            clean_streak = 0
            for bf in b_resp.get("frames") or []:
                bt = float(bf.get("actual_time") or bf.get("timestamp") or 0.0)
                if bf.get("is_ad"):
                    first_ad_t = min(first_ad_t, bt)
                    observed_ad_frames.append(bf)
                    clean_streak = 0
                else:
                    if pre_clean_frame is None:
                        pre_clean_frame = bf
                    clean_streak += 1
                    if clean_streak >= 2:
                        break

        # Step 3: Walk forward (3s steps up to +60s, stopping after 2 consecutive clean frames)
        fwd_times = [round(t_hit + d, 1) for d in range(3, 63, 3)]
        f_resp = worker.request(
            {
                "cmd": "scan_stream_window",
                "mp4_url": mp4_url,
                "timestamps": fwd_times,
                "exact": True,
                "stop_after_clean_run": 2,
            }
        )
        last_ad_t = t_hit
        first_post_clean_t: Optional[float] = None
        post_clean_frame: Optional[Dict[str, Any]] = None
        saw_clean_after = False

        for ff in f_resp.get("frames") or []:
            ft = float(ff.get("actual_time") or ff.get("timestamp") or 0.0)
            if ff.get("is_ad"):
                last_ad_t = max(last_ad_t, ft)
                observed_ad_frames.append(ff)
                first_post_clean_t = None
            else:
                saw_clean_after = True
                if first_post_clean_t is None:
                    first_post_clean_t = ft
                post_clean_frame = ff

        ad_start = 0.0 if first_ad_t <= 4.5 else max(0.0, first_ad_t - 0.8)
        ad_end = first_post_clean_t if (saw_clean_after and first_post_clean_t) else (last_ad_t + 1.5)
        dur = ad_end - ad_start

        if dur < 5.0:
            return None
        if dur > 68.0 and not any(bool(x.get("is_central")) for x in observed_ad_frames):
            self._set_ignore_peripheral(stream_key)
            return None

        any_central = any(bool(x.get("is_central")) for x in observed_ad_frames)
        max_score = max(int(x.get("score") or 0) for x in observed_ad_frames)
        brand = next((str(x.get("brand")) for x in observed_ad_frames if x.get("brand")), "Реклама ставок")

        # Check cinema letterbox disappearance (e.g. 16:9 commercial spliced into 2.39:1 widescreen movie)
        letterbox_cut = False
        if pre_clean_frame and post_clean_frame:
            pre_bars = float(pre_clean_frame.get("top_bar") or 0) + float(pre_clean_frame.get("bottom_bar") or 0)
            post_bars = float(post_clean_frame.get("top_bar") or 0) + float(post_clean_frame.get("bottom_bar") or 0)
            min_ad_bars = min(
                float(x.get("top_bar") or 0) + float(x.get("bottom_bar") or 0) for x in observed_ad_frames
            )
            if pre_bars >= 0.12 and post_bars >= 0.12 and min_ad_bars <= 0.035:
                letterbox_cut = True

        is_preroll_or_outro = ad_start <= 45.0 or (duration_hint > 300 and ad_start >= duration_hint - 180.0)
        kind = "splice" if (any_central or max_score >= 165 or letterbox_cut or is_preroll_or_outro) else "banner"

        return {
            "start": round(ad_start, 1),
            "end": round(ad_end, 1),
            "kind": kind,
            "brand": brand,
        }

    def _run_background_scan(self, gen_id: int, stream_key: str, mp4_url: str) -> None:
        # Scan in 8s keyframe strides ahead of user's playhead (guaranteed to hit every >=9s ad break)
        cursor = 2.0
        empty_batches = 0

        while True:
            with self.scan_lock:
                if self.scan_generation != gen_id:
                    return
                playhead = self.active_playhead
                dur_hint = self.active_duration_hint

            # If user scrubbed ahead significantly past our scan cursor, jump cursor right to their playhead!
            if playhead > cursor + 24.0:
                cursor = max(2.0, playhead + 1.0)

            if dur_hint > 60 and cursor > dur_hint - 3.0:
                if playhead < 30.0:
                    self._update_scan_progress(stream_key, dur_hint, complete=True)
                return

            # Gentle pacing: stay at most 2 minutes ahead of playhead so CDN bandwidth & VideoToolbox stay free for smooth 1080p/4K playback
            if cursor - playhead > 120.0:
                time.sleep(3.0)
                continue

            batch_times = [round(cursor + i * 10.0, 1) for i in range(2)]
            if dur_hint > 60:
                batch_times = [t for t in batch_times if t <= dur_hint - 1.5]
            if not batch_times:
                self._update_scan_progress(stream_key, cursor, complete=(playhead < 30.0))
                return

            resp = self.scanner_worker.request(
                {"cmd": "scan_stream_window", "mp4_url": mp4_url, "timestamps": batch_times, "exact": False}
            )
            frames = resp.get("frames") or []
            if not frames:
                empty_batches += 1
                if empty_batches >= 2:
                    self._update_scan_progress(stream_key, cursor, complete=(cursor > 120.0 and playhead < 30.0))
                    return
                time.sleep(0.4)
                continue

            empty_batches = 0
            last_actual = float(frames[-1].get("actual_time") or frames[-1].get("timestamp") or batch_times[-1])

            # Detect EOF when AVAssetImageGenerator clamps actual_time to end of file
            reached_eof = False
            if len(frames) >= 2 and batch_times[-1] > 60.0 and last_actual < batch_times[-1] - 7.0:
                reached_eof = True

            skip_until = -1.0
            for f in frames:
                with self.scan_lock:
                    if self.scan_generation != gen_id:
                        return
                ft = float(f.get("actual_time") or f.get("timestamp") or 0.0)
                if ft < skip_until:
                    continue
                if f.get("is_ad"):
                    resolved = self._resolve_ad_boundaries(
                        self.scanner_worker, stream_key, mp4_url, f, duration_hint=dur_hint
                    )
                    if resolved:
                        self._merge_segment(stream_key, resolved)
                        skip_until = float(resolved["end"]) + 4.0

            next_cursor = max(batch_times[-1] + 10.0, skip_until)
            cursor = next_cursor
            self._update_scan_progress(stream_key, max(last_actual, cursor - 10.0), complete=reached_eof and playhead < 30.0)

            if reached_eof:
                return

            # Gentle pacing so hardware video decoding & network buffering never stutter
            time.sleep(2.4)

    def analyze_live_frame(
        self,
        jpeg_b64: str,
        timestamp: float,
        stream_key: str = "",
        mp4_url: str = "",
        duration: float = 0.0,
    ) -> Dict[str, Any]:
        if not self.available or not jpeg_b64:
            return {"ok": False, "is_ad": False}

        clean_b64 = jpeg_b64.split(",", 1)[-1] if "," in jpeg_b64 else jpeg_b64
        res = self.realtime_worker.request(
            {"cmd": "analyze_jpeg_b64", "jpeg_b64": clean_b64, "timestamp": float(timestamp or 0.0)}
        )
        if not res.get("ok") or not res.get("is_ad"):
            return {
                "ok": bool(res.get("ok")),
                "is_ad": False,
                "segments": self.get_stream_entry(stream_key).get("segments", []) if stream_key else [],
            }

        with self.cache_lock:
            ignore_periph = bool((self.cache.get(stream_key) or {}).get("ignore_peripheral")) if stream_key else False

        if ignore_periph and not res.get("is_central") and int(res.get("score") or 0) < 165:
            return {
                "ok": True,
                "is_ad": False,
                "ignored_watermark": True,
                "segments": self.get_stream_entry(stream_key).get("segments", []),
            }

        # If we have a seekable MP4 URL on the backend, resolve exact [ad_start, ad_end] right now!
        if mp4_url and ".m3u8" not in mp4_url and stream_key:
            resolved = self._resolve_ad_boundaries(
                self.realtime_worker, stream_key, mp4_url, res, duration_hint=float(duration or 0.0)
            )
            if resolved:
                segs = self._merge_segment(stream_key, resolved)
                return {
                    "ok": True,
                    "is_ad": True,
                    "resolved_segment": resolved,
                    "segments": segs,
                }
            return {
                "ok": True,
                "is_ad": False,
                "ignored_watermark": True,
                "segments": self.get_stream_entry(stream_key).get("segments", []),
            }

        # Fallback when no separate MP4 URL exists (e.g. external HLS stream): return frame classification directly
        is_preroll = float(timestamp or 0.0) <= 45.0
        kind = "splice" if (res.get("is_central") or int(res.get("score") or 0) >= 165 or is_preroll) else "banner"
        return {
            "ok": True,
            "is_ad": True,
            "kind": kind,
            "brand": res.get("brand") or "Реклама ставок",
            "score": int(res.get("score") or 100),
            "is_central": bool(res.get("is_central")),
            "segments": self.get_stream_entry(stream_key).get("segments", []) if stream_key else [],
        }
