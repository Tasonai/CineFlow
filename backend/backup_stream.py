import concurrent.futures
import json
import os
import re
import shutil
import socket
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from .doh import DoHSplitNetworkClient
from .hdrezka import HDRezkaClient


_TRASH_QUALITY_RE = re.compile(
    r"\b(camrip|hdcam|cam|telesync|telesynch|hdts|ts|telecine|tc|dvdscr|screener|scr|workprint)\b",
    re.IGNORECASE,
)
_BTIH_RE = re.compile(r"btih:([a-fA-F0-9]{32,40})", re.IGNORECASE)
_VIDEO_EXT_RE = re.compile(r"\.(mkv|mp4|avi|m2ts|ts|mov|webm)$", re.IGNORECASE)
_PUBLIC_TRACKERS_SUFFIX = (
    "&tr=udp://tracker.opentrackr.org:1337/announce"
    "&tr=udp://open.stealth.si:80/announce"
    "&tr=udp://exodus.desync.com:6969/announce"
    "&tr=http://bt.t-ru.org/ann?magnet"
    "&tr=udp://opentor.net:6969"
)


def _enrich_magnet_trackers(magnet: str) -> str:
    mag = (magnet or "").strip()
    if not mag.startswith("magnet:") or "&tr=" in mag.lower():
        return mag
    return mag + _PUBLIC_TRACKERS_SUFFIX


class BackupStreamingEngine:
    """
    Backup 4K UHD / HDR / Dolby Vision Streaming Engine.
    - Queries live JacRed aggregator API for 4K / BDRemux / Blu-Ray releases.
    - Automatically manages a built-in local TorrServer daemon (`backend/bin/torrserver`)
      when `torrserver_url` points to localhost, so 4K BDRemux plays out of the box.
    - Supports Real-Debrid and TorBox cloud HTTPS magnet-to-stream resolution (`resolve_debrid_magnet`).
    """

    JACRED_HOSTS = [
        "https://jacred.xyz",
        "https://jac.red",
    ]

    def __init__(
        self,
        net_client: DoHSplitNetworkClient,
        rezka_client: HDRezkaClient,
        base_dir: Optional[str] = None,
    ):
        self.net = net_client
        self.rezka = rezka_client
        self.base_dir = base_dir or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.bin_dir = os.path.join(self.base_dir, "backend", "bin")
        self.torr_data_dir = os.path.join(self.base_dir, "data", "torrserver")
        self.torr_bin_path = self._find_torrserver_binary()

        self.mode: str = "torrserver"
        self.debrid_api_key: str = ""
        self.torrserver_url: str = "http://127.0.0.1:8090"

        self._torr_proc: Optional[subprocess.Popen] = None
        self._torr_lock = threading.Lock()
        self._debrid_cache: Dict[str, str] = {}

    def _find_torrserver_binary(self) -> str:
        bundled = os.path.join(self.bin_dir, "torrserver")
        if os.path.isfile(bundled) and os.access(bundled, os.X_OK):
            return bundled
        for prefix in ("/opt/homebrew/bin", "/usr/local/bin"):
            cand = os.path.join(prefix, "torrserver")
            if os.path.isfile(cand) and os.access(cand, os.X_OK):
                return cand
        return shutil.which("torrserver") or ""

    def configure(
        self,
        mode: Optional[str] = None,
        debrid_api_key: Optional[str] = None,
        torrserver_url: Optional[str] = None,
    ):
        if mode:
            # Upgrade legacy default `debrid_https` without key to `torrserver` when bundled binary exists
            if mode == "debrid_https" and not (debrid_api_key or self.debrid_api_key) and self.torr_bin_path:
                self.mode = "torrserver"
            else:
                self.mode = mode
        if debrid_api_key is not None and debrid_api_key.strip() != "********":
            self.debrid_api_key = debrid_api_key.strip()
        if torrserver_url is not None and torrserver_url.strip():
            self.torrserver_url = torrserver_url.strip().rstrip("/")

    def _is_torrserver_alive(self) -> bool:
        try:
            parsed = urllib.parse.urlparse(self.torrserver_url)
            host = parsed.hostname or "127.0.0.1"
            port = parsed.port or 8090
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except Exception:
            return False

    def ensure_local_torrserver(self) -> bool:
        if self._is_torrserver_alive():
            return True
        if not self.torr_bin_path:
            self.torr_bin_path = self._find_torrserver_binary()
        if not self.torr_bin_path:
            return False

        parsed = urllib.parse.urlparse(self.torrserver_url)
        host = (parsed.hostname or "127.0.0.1").lower()
        port = parsed.port or 8090
        if host not in ("127.0.0.1", "localhost", "::1"):
            return False

        with self._torr_lock:
            if self._is_torrserver_alive():
                return True
            try:
                os.makedirs(self.torr_data_dir, exist_ok=True)
                env = os.environ.copy()
                env["PATH"] = f"{self.bin_dir}:{env.get('PATH', '')}"
                log_path = os.path.join(self.torr_data_dir, "torrserver.log")
                with open(log_path, "ab") as log_fh:
                    self._torr_proc = subprocess.Popen(
                        [
                            self.torr_bin_path,
                            "-p",
                            str(port),
                            "-d",
                            self.torr_data_dir,
                        ],
                        stdout=log_fh,
                        stderr=subprocess.STDOUT,
                        env=env,
                        start_new_session=True,
                    )
            except Exception:
                return False

            deadline = time.time() + 2.8
            while time.time() < deadline:
                if self._is_torrserver_alive():
                    self._tune_torrserver_ram_cache()
                    return True
                time.sleep(0.12)
        return self._is_torrserver_alive()

    def _tune_torrserver_ram_cache(self) -> None:
        try:
            req_get = urllib.request.Request(
                f"{self.torrserver_url}/settings",
                data=json.dumps({"action": "get"}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req_get, timeout=1.2) as r:
                cur_cfg = json.loads(r.read().decode("utf-8", errors="ignore") or "{}")
            if isinstance(cur_cfg, dict) and cur_cfg:
                cur_cfg["CacheSize"] = 134217728  # 128 MB RAM ring buffer
                cur_cfg["ReaderReadAhead"] = 95
                cur_cfg["PreloadCache"] = 15
                cur_cfg["UseDisk"] = False
                req_set = urllib.request.Request(
                    f"{self.torrserver_url}/settings",
                    data=json.dumps({"action": "set", "sets": cur_cfg}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                urllib.request.urlopen(req_set, timeout=1.2).close()
        except Exception:
            pass

    def shutdown_local_torrserver(self) -> None:
        with self._torr_lock:
            proc = self._torr_proc
            self._torr_proc = None
            if proc and proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=2.0)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass

    @staticmethod
    def _is_trash_rip(rel_title: str) -> bool:
        return bool(_TRASH_QUALITY_RE.search(rel_title or ""))

    @staticmethod
    def _classify_release_quality(rel_title: str) -> Tuple[str, int]:
        low = (rel_title or "").lower()
        is_remux = "remux" in low or "bdremux" in low
        is_hdr = any(tok in low for tok in ("hdr", "dolby vision", "dovi", "dv"))
        if any(tok in low for tok in ("2160p", "2160", "4k", "uhd")):
            if is_remux:
                return ("4K UHD BDRemux", 420)
            if is_hdr:
                return ("4K UHD HDR", 380)
            return ("4K UHD", 340)
        if "1080p" in low or "1080i" in low:
            if is_remux:
                return ("1080p BDRemux", 260)
            if "bluray" in low or "blu-ray" in low or "bdrip" in low:
                return ("1080p Blu-Ray", 220)
            return ("1080p WEB-DL", 190)
        if is_remux:
            return ("1080p BDRemux", 250)
        if "720p" in low:
            return ("720p HD", 120)
        return ("WEB / Rip", 70)

    @staticmethod
    def _match_episode_from_files(
        files: List[Dict[str, Any]],
        path_key: str,
        id_key: str,
        size_key: str,
        media_type: str,
        season: int,
        episode: int,
    ) -> Optional[Any]:
        video_files = [
            f for f in files if isinstance(f, dict) and _VIDEO_EXT_RE.search(str(f.get(path_key) or ""))
        ] or [f for f in files if isinstance(f, dict)]
        if not video_files:
            return None

        if media_type != "series":
            best = max(video_files, key=lambda x: int(x.get(size_key) or x.get("length") or 0))
            return best.get(id_key)

        s_num = max(1, int(season or 1))
        e_num = max(1, int(episode or 1))
        ep_patterns = [
            re.compile(rf"s0*{s_num}\s*[._\-x]?\s*e0*{e_num}\b", re.IGNORECASE),
            re.compile(rf"\b0*{s_num}x0*{e_num}\b", re.IGNORECASE),
            re.compile(rf"(?:ep|episode|серия|выпуск)\s*0*{e_num}\b", re.IGNORECASE),
        ]
        for pat in ep_patterns:
            for vf in video_files:
                if pat.search(str(vf.get(path_key) or "")):
                    return vf.get(id_key)
        video_files_sorted = sorted(video_files, key=lambda x: str(x.get(path_key) or "").lower())
        if 1 <= e_num <= len(video_files_sorted):
            return video_files_sorted[e_num - 1].get(id_key)
        return video_files_sorted[0].get(id_key)

    def _resolve_torrserver_file_index(
        self,
        magnet: str,
        media_type: str,
        season: int,
        episode: int,
        wait_metadata_sec: float = 0.0,
    ) -> int:
        if media_type != "series":
            return 1
        e_num = max(1, int(episode or 1))
        enriched_mag = _enrich_magnet_trackers(magnet)
        hm = _BTIH_RE.search(enriched_mag)
        info_hash = hm.group(1).lower() if hm else ""
        try:
            req = urllib.request.Request(
                f"{self.torrserver_url}/torrents",
                data=json.dumps({"action": "add", "link": enriched_mag, "save_to_db": False}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=2.5) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="ignore") or "{}")
            file_stats = data.get("file_stats") or []
            if not file_stats and info_hash and wait_metadata_sec > 0:
                deadline = time.time() + wait_metadata_sec
                while time.time() < deadline:
                    time.sleep(0.35)
                    req_get = urllib.request.Request(
                        f"{self.torrserver_url}/torrents",
                        data=json.dumps({"action": "get", "hash": info_hash}).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    with urllib.request.urlopen(req_get, timeout=2.0) as r_get:
                        d_get = json.loads(r_get.read().decode("utf-8", errors="ignore") or "{}")
                    file_stats = d_get.get("file_stats") or []
                    if file_stats:
                        break
            if isinstance(file_stats, list) and file_stats:
                matched_id = self._match_episode_from_files(
                    file_stats, "path", "id", "length", media_type, season, episode
                )
                if matched_id is not None and int(matched_id) > 0:
                    return int(matched_id)
        except Exception:
            pass
        return e_num

    def resolve_debrid_magnet(
        self,
        magnet: str,
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        provider: Optional[str] = None,
    ) -> Dict[str, Any]:
        prov = (provider or self.mode or "").lower()
        if prov == "debrid_https":
            prov = "realdebrid"
        if not self.debrid_api_key:
            return {"ok": False, "error": "Укажите API-ключ Real-Debrid или TorBox в Настройках -> Сеть и потоки"}
        if not magnet.startswith("magnet:"):
            return {"ok": False, "error": "Некорректная Magnet-ссылка"}

        cache_key = f"{prov}:{magnet}:{media_type}:s{season}e{episode}"
        if cache_key in self._debrid_cache:
            return {"ok": True, "stream_url": self._debrid_cache[cache_key], "provider": prov}

        if prov == "torbox":
            res = self._resolve_torbox_magnet(magnet, media_type, season, episode)
        else:
            res = self._resolve_realdebrid_magnet(magnet, media_type, season, episode)

        if res.get("ok") and res.get("stream_url"):
            self._debrid_cache[cache_key] = res["stream_url"]
        return res

    def _resolve_realdebrid_magnet(
        self, magnet: str, media_type: str, season: int, episode: int
    ) -> Dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.debrid_api_key}",
            "User-Agent": "CineFlow/2.0",
        }
        try:
            body_add = urllib.parse.urlencode({"magnet": magnet}).encode("utf-8")
            req_add = urllib.request.Request(
                "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
                data=body_add,
                headers={**headers, "Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            )
            with urllib.request.urlopen(req_add, timeout=10) as r_add:
                add_data = json.loads(r_add.read().decode("utf-8"))
            tid = add_data.get("id")
            if not tid:
                return {"ok": False, "error": "Real-Debrid не вернул ID раздачи"}

            req_info = urllib.request.Request(
                f"https://api.real-debrid.com/rest/1.0/torrents/info/{tid}",
                headers=headers,
            )
            with urllib.request.urlopen(req_info, timeout=10) as r_info:
                info_data = json.loads(r_info.read().decode("utf-8"))

            files = info_data.get("files") or []
            chosen_fid = self._match_episode_from_files(
                files, "path", "id", "bytes", media_type, season, episode
            )
            sel_val = str(chosen_fid) if chosen_fid is not None else "all"
            req_sel = urllib.request.Request(
                f"https://api.real-debrid.com/rest/1.0/torrents/selectFiles/{tid}",
                data=urllib.parse.urlencode({"files": sel_val}).encode("utf-8"),
                headers={**headers, "Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            )
            urllib.request.urlopen(req_sel, timeout=10).close()

            with urllib.request.urlopen(req_info, timeout=10) as r_info2:
                info_after = json.loads(r_info2.read().decode("utf-8"))

            links = info_after.get("links") or []
            if not links:
                status_str = info_after.get("status", "downloading")
                return {
                    "ok": False,
                    "error": f"Раздача ещё кешируется в облаке Real-Debrid ({status_str}). Используйте TorrServer или выберите раздачу с большим числом сидов.",
                }

            req_unr = urllib.request.Request(
                "https://api.real-debrid.com/rest/1.0/unrestrict/link",
                data=urllib.parse.urlencode({"link": links[0]}).encode("utf-8"),
                headers={**headers, "Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            )
            with urllib.request.urlopen(req_unr, timeout=10) as r_unr:
                unr_data = json.loads(r_unr.read().decode("utf-8"))
            dl_url = str(unr_data.get("download") or "")
            if not dl_url:
                return {"ok": False, "error": "Real-Debrid не вернул прямую ссылку на поток"}
            return {"ok": True, "stream_url": dl_url, "provider": "realdebrid"}
        except urllib.error.HTTPError as he:
            return {"ok": False, "error": f"Ошибка Real-Debrid API (HTTP {he.code}) — проверьте API-ключ"}
        except Exception as exc:
            return {"ok": False, "error": f"Ошибка Real-Debrid: {exc}"}

    def _resolve_torbox_magnet(
        self, magnet: str, media_type: str, season: int, episode: int
    ) -> Dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.debrid_api_key}",
            "User-Agent": "CineFlow/2.0",
        }
        try:
            body_create = urllib.parse.urlencode({"magnet": magnet, "seed": "1"}).encode("utf-8")
            req_cr = urllib.request.Request(
                "https://api.torbox.app/v1/api/torrents/createtorrent",
                data=body_create,
                headers={**headers, "Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            )
            with urllib.request.urlopen(req_cr, timeout=12) as r_cr:
                cr_data = json.loads(r_cr.read().decode("utf-8"))
            tdata = cr_data.get("data") or {}
            tid = tdata.get("torrent_id") or tdata.get("id")
            if not tid:
                return {"ok": False, "error": str(cr_data.get("detail") or "TorBox не вернул torrent_id")}

            req_list = urllib.request.Request(
                f"https://api.torbox.app/v1/api/torrents/mylist?id={tid}&bypass_cache=true",
                headers=headers,
            )
            with urllib.request.urlopen(req_list, timeout=10) as r_ls:
                ls_data = json.loads(r_ls.read().decode("utf-8"))
            t_item = ls_data.get("data") or {}
            if isinstance(t_item, list):
                t_item = t_item[0] if t_item else {}
            files = t_item.get("files") or []
            if not t_item.get("download_present") and not files:
                return {
                    "ok": False,
                    "error": "Раздача кешируется в облаке TorBox. Попробуйте раздачу выше или режим TorrServer.",
                }
            chosen_fid = self._match_episode_from_files(
                files, "name", "id", "size", media_type, season, episode
            )
            fid_param = chosen_fid if chosen_fid is not None else 0
            dl_api = (
                f"https://api.torbox.app/v1/api/torrents/requestdl"
                f"?token={urllib.parse.quote(self.debrid_api_key)}&torrent_id={tid}&file_id={fid_param}"
            )
            req_dl = urllib.request.Request(dl_api, headers={"User-Agent": "CineFlow/2.0"})
            with urllib.request.urlopen(req_dl, timeout=10) as r_dl:
                dl_json = json.loads(r_dl.read().decode("utf-8"))
            dl_url = str(dl_json.get("data") or "")
            if not dl_url.startswith("http"):
                return {"ok": False, "error": "TorBox ещё подготавливает файл — повторите через пару секунд"}
            return {"ok": True, "stream_url": dl_url, "provider": "torbox"}
        except urllib.error.HTTPError as he:
            return {"ok": False, "error": f"Ошибка TorBox API (HTTP {he.code}) — проверьте API-ключ"}
        except Exception as exc:
            return {"ok": False, "error": f"Ошибка TorBox: {exc}"}

    def _query_jacred_candidates(
        self, title: str, orig_title: str, year: int, media_type: str, season: int
    ) -> List[Dict[str, Any]]:
        candidates: List[Dict[str, Any]] = []
        search_term = orig_title or title
        for host in self.JACRED_HOSTS:
            url = (
                f"{host}/api/v1.0/torrents?search={urllib.parse.quote(search_term)}"
                f"&year={year}"
            )
            status, body, _ = self.net.request(url, spoof_geo_country="DIRECT", timeout=4)
            if status == 200 and body:
                try:
                    items = json.loads(body)
                    if isinstance(items, list) and items:
                        seen_hashes = set()
                        for item in items:
                            if not isinstance(item, dict):
                                continue
                            rel_title = str(item.get("title") or "").strip()
                            magnet = _enrich_magnet_trackers(str(item.get("magnet") or "").strip())
                            if not rel_title or not magnet:
                                continue
                            if self._is_trash_rip(rel_title):
                                continue
                            if year and year >= 1960:
                                yr_matches = [int(y) for y in re.findall(r"\b(19\d{2}|20\d{2})\b", rel_title)]
                                yr_filtered = [y for y in yr_matches if y not in (1080, 2160)]
                                if yr_filtered and not any(abs(y - year) <= 2 for y in yr_filtered):
                                    continue
                            if media_type == "series":
                                s_tag_re = re.compile(
                                    rf"(?:s0*{season}\b|сезон\s*{season}\b|{season}\s*сезон|1-\d+\s*сезон)",
                                    re.IGNORECASE,
                                )
                                has_any_season_tag = bool(
                                    re.search(r"(?:s\d{1,2}\b|сезон)", rel_title, re.IGNORECASE)
                                )
                                if has_any_season_tag and not s_tag_re.search(rel_title):
                                    continue
                            hm = _BTIH_RE.search(magnet)
                            info_hash = hm.group(1).lower() if hm else ""
                            dedup_key = info_hash or rel_title.lower()
                            if dedup_key in seen_hashes:
                                continue
                            seen_hashes.add(dedup_key)

                            quality_badge, quality_rank = self._classify_release_quality(rel_title)
                            seeders = max(0, int(item.get("sid") or 0))
                            candidates.append(
                                {
                                    "info_hash": info_hash,
                                    "title": rel_title,
                                    "tracker": str(item.get("tracker") or "Rutor / Rutracker"),
                                    "size": str(item.get("sizeName") or "—"),
                                    "seeders": seeders,
                                    "quality": quality_badge,
                                    "quality_rank": quality_rank,
                                    "voices": item.get("voices") or ["Дубляж", "Оригинал"],
                                    "magnet": magnet,
                                }
                            )
                        if candidates:
                            break
                except Exception:
                    continue
        return candidates

    def search_releases(
        self,
        title: str,
        orig_title: str = "",
        year: int = 2024,
        item_id: str = "",
        rezka_url: str = "",
        media_type: str = "movie",
        season: int = 1,
        episode: int = 1,
        stremio_engine: Any = None,
        lang: str = "ru",
    ) -> Dict[str, Any]:
        ui_lang = "en" if str(lang or "").strip().lower().startswith("en") else "ru"
        torr_alive = self.ensure_local_torrserver()
        debrid_ready = bool(self.debrid_api_key and self.mode in ("realdebrid", "torbox", "debrid_https"))

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            fut_jac = pool.submit(
                self._query_jacred_candidates, title, orig_title, year, media_type, season
            )
            fut_cdn = pool.submit(
                self.rezka.get_streams_for_title,
                item_id=item_id or title,
                title=title,
                orig_title=orig_title,
                year=year,
                media_type=media_type,
                season=season,
                episode=episode,
                rezka_url=rezka_url,
            )
            fut_stremio = (
                pool.submit(
                    stremio_engine.get_streams_for_title,
                    item_id=item_id,
                    title=title,
                    orig_title=orig_title,
                    year=year,
                    media_type=media_type,
                    season=season,
                    episode=episode,
                    lang=ui_lang,
                )
                if stremio_engine is not None
                else None
            )
            try:
                jac_candidates = fut_jac.result(timeout=7.5) or []
            except Exception:
                jac_candidates = []
            try:
                real_cdn_data = fut_cdn.result(timeout=4.5)
            except Exception:
                real_cdn_data = {}
            stremio_payload: Dict[str, Any] = {}
            if fut_stremio is not None:
                try:
                    stremio_payload = fut_stremio.result(timeout=8.0) or {}
                except Exception:
                    stremio_payload = {}

        direct_title_stream = (real_cdn_data or {}).get("default_stream_url", "")
        external_subtitles = list(stremio_payload.get("subtitles") or [])

        by_key: Dict[str, Dict[str, Any]] = {}
        for jc in jac_candidates:
            ih = str(jc.get("info_hash") or "").strip().lower()
            key = ih or str(jc.get("magnet") or jc.get("title") or "")
            if not key:
                continue
            by_key[key] = dict(jc)

        # Merge healthy 4K / high-bitrate 1080p releases from Stremio (Torrentio / TPB+)
        for st in stremio_payload.get("streams") or []:
            q_rank = int(st.get("quality_rank") or 0)
            if q_rank < 200:
                continue
            ih = str(st.get("info_hash") or "").strip().lower()
            d_url = str(st.get("direct_url") or "").strip()
            magnet_st = str(st.get("magnet") or "").strip()
            if not d_url and not magnet_st:
                continue
            key = d_url or ih or magnet_st
            seeders_st = int(st.get("seeders") or 0)
            langs_st = list(st.get("languages") or [])
            voices_st = langs_st if langs_st else (["Original"] if ui_lang == "en" else ["Оригинал"])
            size_st = str(st.get("size") or "—")
            if ui_lang == "en":
                size_st = size_st.replace("ГБ", "GB").replace("МБ", "MB").replace("ТБ", "TB")

            cand_st = {
                "info_hash": ih,
                "title": str(st.get("filename") or st.get("title") or title),
                "tracker": str(st.get("tracker") or st.get("addon_name") or "Torrentio"),
                "size": size_st,
                "seeders": seeders_st,
                "quality": str(st.get("quality") or "4K UHD"),
                "quality_rank": q_rank,
                "voices": voices_st,
                "magnet": magnet_st,
                "direct_url": d_url,
                "stremio_file_idx": st.get("file_idx"),
                "filename_hint": str(st.get("filename") or ""),
                "has_russian": bool(st.get("has_russian")),
            }
            existing = by_key.get(key)
            if not existing:
                by_key[key] = cand_st
            else:
                if seeders_st > int(existing.get("seeders") or 0):
                    existing["seeders"] = seeders_st
                if existing.get("stremio_file_idx") is None and cand_st.get("stremio_file_idx") is not None:
                    existing["stremio_file_idx"] = cand_st["stremio_file_idx"]
                if not existing.get("filename_hint") and cand_st.get("filename_hint"):
                    existing["filename_hint"] = cand_st["filename_hint"]

        merged_candidates = list(by_key.values())
        has_live_peers = any(
            int(c.get("seeders") or 0) >= 1 or bool(c.get("direct_url"))
            for c in merged_candidates
        )
        if has_live_peers and not debrid_ready:
            merged_candidates = [
                c
                for c in merged_candidates
                if int(c.get("seeders") or 0) >= 1 or bool(c.get("direct_url"))
            ]

        def _release_sort_key(r: Dict[str, Any]) -> Tuple[Any, ...]:
            is_direct = 1 if r.get("direct_url") else 0
            seeds = int(r.get("seeders") or 0)
            q_rank = int(r.get("quality_rank") or 0)
            healthy_tier = 2 if (is_direct or seeds >= 5) else (1 if seeds >= 1 else 0)
            is_uhd = 1 if q_rank >= 300 else 0
            voices_join = " ".join(str(v) for v in (r.get("voices") or [])).lower()
            has_ru = bool(
                r.get("has_russian")
                or any(k in voices_join for k in ("ru", "рус", "дубляж", "hdrezka", "lostfilm", "jaskier", "кубик", "rhs"))
            )
            lang_match = (0 if has_ru else 1) if ui_lang == "en" else (1 if has_ru else 0)
            seed_bucket = min(seeds, 60) // 12
            return (is_direct, healthy_tier, is_uhd, lang_match, seed_bucket, q_rank, seeds)

        merged_candidates.sort(key=_release_sort_key, reverse=True)
        top_releases = merged_candidates[:12]

        live_releases: List[Dict[str, Any]] = []
        for idx, rel in enumerate(top_releases):
            direct_u = str(rel.get("direct_url") or "").strip()
            magnet = _enrich_magnet_trackers(str(rel.get("magnet") or "")) if rel.get("magnet") else ""
            stream_url = ""
            stream_kind = "magnet_only"

            if direct_u:
                stream_url = direct_u
                stream_kind = "direct_http"
            elif debrid_ready and magnet:
                stream_kind = "debrid"
            elif torr_alive and magnet:
                if idx < 2 and stremio_engine is not None and (
                    rel.get("stremio_file_idx") is not None or rel.get("filename_hint")
                ):
                    st_res = stremio_engine.resolve_stream_to_playable_url(
                        magnet=magnet,
                        filename_hint=str(rel.get("filename_hint") or ""),
                        file_idx=rel.get("stremio_file_idx"),
                        media_type=media_type,
                        season=season,
                        episode=episode,
                    )
                    if st_res.get("ok") and st_res.get("stream_url"):
                        stream_url = str(st_res["stream_url"])
                        stream_kind = "torrserver"
                if not stream_url:
                    if media_type == "series":
                        if idx < 3:
                            file_idx = self._resolve_torrserver_file_index(
                                magnet, media_type, season, episode, wait_metadata_sec=2.0
                            )
                        elif rel.get("stremio_file_idx") is not None:
                            file_idx = max(1, int(rel["stremio_file_idx"]) + 1)
                        else:
                            file_idx = max(1, int(episode or 1))
                    else:
                        file_idx = 1
                    stream_url = (
                        f"{self.torrserver_url}/stream/fname"
                        f"?link={urllib.parse.quote(magnet)}&index={file_idx}&play"
                    )
                    stream_kind = "torrserver"

            size_lbl = str(rel.get("size") or "—")
            if ui_lang == "en":
                size_lbl = size_lbl.replace("ГБ", "GB").replace("МБ", "MB").replace("ТБ", "TB")

            live_releases.append(
                {
                    "info_hash": rel.get("info_hash") or "",
                    "title": rel["title"],
                    "tracker": rel["tracker"],
                    "size": size_lbl,
                    "seeders": int(rel.get("seeders") or 0),
                    "quality": rel["quality"],
                    "voices": rel.get("voices") or [],
                    "magnet": magnet,
                    "stream_url": stream_url,
                    "stream_kind": stream_kind,
                }
            )

        return {
            "mode": self.mode,
            "torrserver_connected": torr_alive,
            "torrserver_builtin": bool(self.torr_bin_path),
            "torrserver_url": self.torrserver_url,
            "debrid_connected": bool(self.debrid_api_key),
            "debrid_ready": debrid_ready,
            "fallback_stream_url": direct_title_stream,
            "subtitles": external_subtitles,
            "releases": live_releases,
        }

    def resolve_original_audio_fallback(
        self,
        title: str,
        orig_title: str,
        year: int,
        media_type: str,
        season: int,
        episode: int,
        remux_engine: Any,
    ) -> Optional[Dict[str, Any]]:
        """
        When HDRezka geo-locks 'Оригинал (+субтитры)' (translator_id=238) behind b-prem_translator,
        resolves a direct 1080p/4K stream with Original audio track + Russian/English subtitles
        via built-in TorrServer/Debrid + RemuxStreamEngine.
        """
        if not remux_engine or not remux_engine.is_available():
            return None
        torr_alive = self.ensure_local_torrserver()
        debrid_ready = bool(self.debrid_api_key and self.mode in ("realdebrid", "torbox", "debrid_https"))
        if not torr_alive and not debrid_ready:
            return None

        candidates = self._query_jacred_candidates(title, orig_title, year, media_type, season)
        if not candidates:
            return None

        def _orig_score(rel: Dict[str, Any]) -> Tuple[int, int, int]:
            voices_str = " ".join(str(v) for v in (rel.get("voices") or [])).lower()
            t_low = str(rel.get("title") or "").lower()
            has_orig_tag = 1 if ("оригинал" in voices_str or "eng" in t_low or "sub" in t_low or "original" in t_low) else 0
            # Prefer fast-starting 1080p WEB-DL / Blu-Ray with high seeders for instant HDRezka playback
            q_rank = int(rel.get("quality_rank") or 0)
            fast_1080 = 1 if (180 <= q_rank <= 270) else 0
            return (has_orig_tag, fast_1080, int(rel.get("seeders") or 0))

        ranked = sorted(candidates, key=_orig_score, reverse=True)
        for rel in ranked[:3]:
            if int(rel.get("seeders") or 0) < 1 and not debrid_ready:
                continue
            magnet = _enrich_magnet_trackers(rel["magnet"])
            raw_stream_url = ""
            if debrid_ready:
                d_res = self.resolve_debrid_magnet(magnet, media_type=media_type, season=season, episode=episode)
                if d_res.get("ok") and d_res.get("stream_url"):
                    raw_stream_url = str(d_res["stream_url"])
            if not raw_stream_url and torr_alive:
                file_idx = self._resolve_torrserver_file_index(
                    magnet, media_type, season, episode, wait_metadata_sec=1.8
                )
                raw_stream_url = (
                    f"{self.torrserver_url}/stream/fname"
                    f"?link={urllib.parse.quote(magnet)}&index={file_idx}&play"
                )
            if not raw_stream_url:
                continue

            probe = remux_engine.probe_media(raw_stream_url, timeout_sec=12.0, fast_probe=True)
            if not probe.get("ok"):
                continue

            audio_tracks = probe.get("audio_tracks") or []
            orig_track = None
            for tr in audio_tracks:
                lang = str(tr.get("lang") or "").lower()
                lbl = str(tr.get("label") or "").lower()
                if lang in ("eng", "en", "jpn", "ja", "kor", "ko", "fra", "fr", "deu", "de", "spa", "es", "ita", "it"):
                    orig_track = tr
                    break
                if any(k in lbl for k in ("оригинал", "original", "english", "английск")):
                    orig_track = tr
                    break
            if orig_track is None and len(audio_tracks) == 1:
                orig_track = audio_tracks[0]
            if orig_track is None:
                continue

            audio_idx = int(orig_track.get("audio_index") or 0)
            vcodec = str(probe.get("video_codec") or "")
            channels = int(orig_track.get("channels") or 2)
            remux_qs = urllib.parse.urlencode(
                {
                    "src": raw_stream_url,
                    "audio": str(audio_idx),
                    "start": "0",
                    "vcodec": vcodec,
                    "ch": str(channels),
                }
            )
            remux_play_url = f"/api/remux-stream?{remux_qs}"
            subs_out = []
            for st in (probe.get("subtitle_tracks") or []):
                sub_qs = urllib.parse.urlencode(
                    {
                        "src": raw_stream_url,
                        "si": str(st.get("stream_index") or 0),
                        "ss": "0",
                        "dur": "420",
                    }
                )
                subs_out.append(
                    {
                        "lang": st.get("label") or "Субтитры",
                        "url": f"/api/remux-subtitle?{sub_qs}",
                        "direct_vtt": True,
                    }
                )
            qual_label = "1080p" if "1080" in str(rel.get("quality") or "") else str(rel.get("quality") or "1080p")
            return {
                "qualities": {qual_label: remux_play_url},
                "default_quality": qual_label,
                "default_stream_url": remux_play_url,
                "subtitles": subs_out,
                "remux_session": {
                    "rawSourceUrl": raw_stream_url,
                    "duration": float(probe.get("duration") or 0.0),
                    "audioIndex": audio_idx,
                    "videoCodec": vcodec,
                    "channels": channels,
                    "audioTracks": audio_tracks,
                    "subtitleTracks": probe.get("subtitle_tracks") or [],
                },
            }
        return None
