from concurrent.futures import ThreadPoolExecutor
import html
import ipaddress
import re
import socket
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Tuple

from .qrcode_svg import detect_lan_ipv4, generate_qr_svg


SSDP_MULTICAST_ADDR = ("239.255.255.250", 1900)
SSDP_SEARCH_TARGETS = (
    "urn:schemas-upnp-org:service:AVTransport:1",
    "urn:schemas-upnp-org:device:MediaRenderer:1",
)


_RFC1918_NETS = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
)
_LINK_LOCAL_NET = ipaddress.ip_network("169.254.0.0/16")
_METADATA_IPV4 = ipaddress.ip_address("169.254.169.254")


def _is_lan_ipv4_host(hostname: str) -> bool:
    h = (hostname or "").strip()
    if not h:
        return False
    try:
        ip_obj = ipaddress.ip_address(h)
        if ip_obj.version != 4:
            return False
        if (
            ip_obj.is_loopback
            or ip_obj.is_unspecified
            or ip_obj.is_multicast
            or ip_obj.is_reserved
            or ip_obj == _METADATA_IPV4
            or ip_obj.packed[0] == 0
            or ip_obj.packed[3] in (0, 255)
        ):
            # Reject 127.0.0.0/8, 0.0.0.0/8 (macOS/Linux loopback alias), cloud metadata, and subnet broadcasts
            return False
        if any(ip_obj in net for net in _RFC1918_NETS):
            return True
        if ip_obj in _LINK_LOCAL_NET and ip_obj.packed[2] not in (0, 255):
            return True
        return False
    except ValueError:
        return False


def format_dlna_rel_time(seconds: float) -> str:
    s = max(0, int(seconds or 0))
    hrs = s // 3600
    mins = (s % 3600) // 60
    rem = s % 60
    return f"{hrs:02d}:{mins:02d}:{rem:02d}"


def parse_ssdp_headers(raw_packet: str) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    if not raw_packet:
        return headers
    lines = raw_packet.replace("\r\n", "\n").split("\n")
    for line in lines[1:]:
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        headers[k.strip().lower()] = v.strip()
    return headers


def _strip_xml_ns(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


_UPNP_SERVICE_TYPE_RE = re.compile(r"^urn:[A-Za-z0-9._-]+:service:AVTransport:\d{1,2}$")
_UPNP_ACTION_RE = re.compile(r"^[A-Za-z0-9_]{1,64}$")
_XML_ILLEGAL_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _xml_safe_text(val: str) -> str:
    cleaned = _XML_ILLEGAL_CTRL_RE.sub("", str(val or ""))
    return html.escape(cleaned, quote=True).replace("&#x27;", "&apos;")


def parse_upnp_device_xml(xml_text: str, location_url: str) -> Optional[Dict[str, Any]]:
    if not xml_text:
        return None
    up = xml_text.upper()
    if "<!ENTITY" in up or "<!DOCTYPE" in up:
        return None
    try:
        root = ET.fromstring(xml_text.strip())
    except Exception:
        return None

    loc_parsed = urllib.parse.urlparse(location_url or "")
    loc_host = (loc_parsed.hostname or "").strip().lower()
    url_base = location_url
    for child in root:
        if _strip_xml_ns(child.tag) == "URLBase" and (child.text or "").strip():
            cand_base = (child.text or "").strip()
            cand_parsed = urllib.parse.urlparse(cand_base)
            if (
                cand_parsed.scheme in ("http", "https")
                and cand_parsed.username is None
                and cand_parsed.password is None
                and (not loc_host or (cand_parsed.hostname or "").strip().lower() == loc_host)
            ):
                url_base = cand_base
            break

    # Walk all <device> nodes (root + embedded <deviceList>) to find AVTransport
    devices_nodes = [el for el in root.iter() if _strip_xml_ns(el.tag) == "device"]
    if not devices_nodes:
        return None

    chosen_info: Optional[Dict[str, Any]] = None
    fallback_friendly = ""
    fallback_mfg = ""
    fallback_model = ""
    fallback_udn = ""

    for dev in devices_nodes:
        d_fields: Dict[str, str] = {}
        for ch in dev:
            tname = _strip_xml_ns(ch.tag)
            if tname in ("friendlyName", "manufacturer", "modelName", "UDN") and (ch.text or "").strip():
                d_fields[tname] = (ch.text or "").strip()
        if not fallback_friendly and d_fields.get("friendlyName"):
            fallback_friendly = d_fields["friendlyName"]
        if not fallback_mfg and d_fields.get("manufacturer"):
            fallback_mfg = d_fields["manufacturer"]
        if not fallback_model and d_fields.get("modelName"):
            fallback_model = d_fields["modelName"]
        if not fallback_udn and d_fields.get("UDN"):
            fallback_udn = d_fields["UDN"]

        for srv_list in dev:
            if _strip_xml_ns(srv_list.tag) != "serviceList":
                continue
            for srv in srv_list:
                if _strip_xml_ns(srv.tag) != "service":
                    continue
                s_map: Dict[str, str] = {}
                for sc in srv:
                    s_map[_strip_xml_ns(sc.tag)] = (sc.text or "").strip()
                stype = s_map.get("serviceType", "")
                ctrl = s_map.get("controlURL", "")
                if _UPNP_SERVICE_TYPE_RE.fullmatch(stype) and ctrl:
                    resolved_ctrl = urllib.parse.urljoin(url_base, ctrl)
                    parsed_ctrl = urllib.parse.urlparse(resolved_ctrl)
                    ctrl_host = (parsed_ctrl.hostname or "").strip().lower()
                    if (
                        parsed_ctrl.scheme not in ("http", "https")
                        or parsed_ctrl.username is not None
                        or parsed_ctrl.password is not None
                        or not _is_lan_ipv4_host(ctrl_host)
                        or (loc_host and ctrl_host != loc_host)
                    ):
                        continue
                    chosen_info = {
                        "id": d_fields.get("UDN") or fallback_udn or resolved_ctrl,
                        "name": d_fields.get("friendlyName") or fallback_friendly or parsed_ctrl.hostname or "Smart TV",
                        "manufacturer": d_fields.get("manufacturer") or fallback_mfg,
                        "model": d_fields.get("modelName") or fallback_model,
                        "host": parsed_ctrl.hostname or "",
                        "location_url": location_url,
                        "control_url": resolved_ctrl,
                        "service_type": stype,
                    }
                    break
            if chosen_info:
                break
        if chosen_info:
            break

    return chosen_info


def build_didl_lite_metadata(
    stream_url: str,
    title: str = "Velarium Video",
    subtitle_url: str = "",
) -> str:
    safe_title = _xml_safe_text(title or "Velarium Video")
    safe_stream = _xml_safe_text(stream_url)
    low_stream = stream_url.lower()
    is_remux_mp4 = "/api/remux-stream" in low_stream
    is_hls = (not is_remux_mp4) and (".m3u8" in low_stream)
    mime = "application/vnd.apple.mpegurl" if is_hls else "video/mp4"
    dlna_flags = "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000"

    sub_xml = ""
    if subtitle_url:
        safe_sub = _xml_safe_text(subtitle_url)
        sub_xml = (
            f'<sec:CaptionInfoEx sec:type="vtt">{safe_sub}</sec:CaptionInfoEx>'
            f'<sec:CaptionInfo sec:type="vtt">{safe_sub}</sec:CaptionInfo>'
            f'<res protocolInfo="http-get:*:text/vtt:*">{safe_sub}</res>'
        )

    return (
        '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" '
        'xmlns:sec="http://www.sec.co.kr/">'
        '<item id="0" parentID="-1" restricted="1">'
        f"<dc:title>{safe_title}</dc:title>"
        "<upnp:class>object.item.videoItem.movie</upnp:class>"
        f'<res protocolInfo="http-get:*:{mime}:{dlna_flags}">{safe_stream}</res>'
        f"{sub_xml}"
        "</item>"
        "</DIDL-Lite>"
    )


def build_soap_envelope(
    action: str,
    params_xml: str,
    service_type: str = "urn:schemas-upnp-org:service:AVTransport:1",
) -> Tuple[str, str]:
    clean_action = str(action or "").strip()
    if not _UPNP_ACTION_RE.fullmatch(clean_action):
        raise ValueError(f"Invalid UPnP SOAP action: {clean_action!r}")
    clean_st = str(service_type or "").strip()
    if not _UPNP_SERVICE_TYPE_RE.fullmatch(clean_st):
        clean_st = "urn:schemas-upnp-org:service:AVTransport:1"
    soap_action = f'"{clean_st}#{clean_action}"'
    safe_params = _XML_ILLEGAL_CTRL_RE.sub("", str(params_xml or ""))
    body = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
        's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
        "<s:Body>"
        f'<u:{clean_action} xmlns:u="{clean_st}">'
        f"{safe_params}"
        f"</u:{clean_action}>"
        "</s:Body>"
        "</s:Envelope>"
    )
    return soap_action, body


def build_soap_set_av_transport_uri(
    stream_url: str,
    title: str = "Velarium",
    subtitle_url: str = "",
    service_type: str = "urn:schemas-upnp-org:service:AVTransport:1",
) -> Tuple[str, str]:
    didl = build_didl_lite_metadata(stream_url=stream_url, title=title, subtitle_url=subtitle_url)
    escaped_didl = _xml_safe_text(didl)
    escaped_uri = _xml_safe_text(stream_url)
    params = (
        "<InstanceID>0</InstanceID>"
        f"<CurrentURI>{escaped_uri}</CurrentURI>"
        f"<CurrentURIMetaData>{escaped_didl}</CurrentURIMetaData>"
    )
    return build_soap_envelope("SetAVTransportURI", params, service_type=service_type)


class _LanOnlyRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        resolved = urllib.parse.urljoin(req.full_url, str(newurl or ""))
        p_red = urllib.parse.urlparse(resolved)
        orig_host = (urllib.parse.urlparse(req.full_url).hostname or "").strip().lower()
        red_host = (p_red.hostname or "").strip().lower()
        if (
            p_red.scheme not in ("http", "https")
            or p_red.username is not None
            or p_red.password is not None
            or not _is_lan_ipv4_host(red_host)
            or (orig_host and red_host != orig_host)
        ):
            if fp is not None:
                try:
                    fp.close()
                except Exception:
                    pass
            raise urllib.error.URLError("Disallowed non-LAN UPnP redirect")
        return super().redirect_request(req, fp, code, msg, headers, resolved)


class _NoSoapRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if fp is not None:
            try:
                fp.close()
            except Exception:
                pass
        raise urllib.error.URLError("Disallowed SOAP POST redirect")


_LAN_DESC_OPENER = urllib.request.build_opener(
    urllib.request.ProxyHandler({}),
    _LanOnlyRedirectHandler(),
)
_SOAP_OPENER = urllib.request.build_opener(
    urllib.request.ProxyHandler({}),
    _NoSoapRedirectHandler(),
)
_UPNP_EXECUTOR = ThreadPoolExecutor(max_workers=6)


class DlnaCastManager:
    """
    Pure-Python UPnP / DLNA MediaRenderer Discovery & Direct Stream Casting Engine,
    plus LAN Smart TV QR Deep-Link generator.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._scan_lock = threading.Lock()
        self._cached_devices: List[Dict[str, Any]] = []
        self._last_scan_ts: float = 0.0
        self._active_cast: Optional[Dict[str, Any]] = None
        self._deep_link_items: Dict[str, Dict[str, Any]] = {}

    def register_deep_link_item(self, item_id: str, item_meta: Optional[Dict[str, Any]] = None) -> str:
        raw_id = str(item_id or "").strip()
        clean_id = re.sub(r"[^a-zA-Z0-9_-]+", "", raw_id)[:24]
        if not clean_id or not isinstance(item_meta, dict) or not item_meta.get("title"):
            return clean_id
        snap = {
            "id": str(item_meta.get("id") or raw_id or clean_id),
            "kinorium_id": str(item_meta.get("kinorium_id") or ""),
            "rezka_id": str(item_meta.get("rezka_id") or ""),
            "rezka_url": str(item_meta.get("rezka_url") or ""),
            "title": str(item_meta.get("title") or ""),
            "orig_title": str(item_meta.get("orig_title") or ""),
            "year": item_meta.get("year") or "",
            "media_type": "series" if str(item_meta.get("media_type") or "") == "series" else "movie",
            "poster": str(item_meta.get("poster") or ""),
            "backdrop": str(item_meta.get("backdrop") or item_meta.get("poster") or ""),
            "genres": list(item_meta.get("genres") or []),
            "age_rating": str(item_meta.get("age_rating") or ""),
            "updated_at": time.time(),
        }
        with self._lock:
            self._deep_link_items[clean_id] = snap
            if raw_id and raw_id != clean_id:
                self._deep_link_items[raw_id] = snap
            if len(self._deep_link_items) > 96:
                oldest_keys = sorted(
                    self._deep_link_items.keys(),
                    key=lambda k: float(self._deep_link_items[k].get("updated_at") or 0.0),
                )[:24]
                for ok in oldest_keys:
                    self._deep_link_items.pop(ok, None)
        return clean_id

    def get_deep_link_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        key = str(item_id or "").strip()
        clean_key = re.sub(r"[^a-zA-Z0-9_-]+", "", key)[:24]
        if not key and not clean_key:
            return None
        with self._lock:
            hit = self._deep_link_items.get(key) or self._deep_link_items.get(clean_key)
            return dict(hit) if isinstance(hit, dict) else None

    @staticmethod
    def build_lan_stream_url(raw_url: str, lan_ip: str, port: int, start_sec: float = 0.0) -> str:
        u = str(raw_url or "").strip()
        if not u:
            return ""
        start_val = max(0.0, round(float(start_sec or 0.0), 1))

        def _inject_remux_start(remux_u: str) -> str:
            if "/api/remux-stream" not in remux_u:
                return remux_u
            try:
                p_rmx = urllib.parse.urlparse(remux_u)
                qs_rmx = urllib.parse.parse_qs(p_rmx.query, keep_blank_values=True)
                if start_val > 5.0:
                    qs_rmx["start"] = [f"{start_val:.1f}"]
                else:
                    qs_rmx.pop("start", None)
                new_q = urllib.parse.urlencode(qs_rmx, doseq=True)
                return urllib.parse.urlunparse((p_rmx.scheme, p_rmx.netloc, p_rmx.path, p_rmx.params, new_q, p_rmx.fragment))
            except Exception:
                return remux_u

        if u.startswith("/") and not u.startswith("//"):
            out_u = f"http://{lan_ip}:{int(port)}{u}" if lan_ip else u
            return _inject_remux_start(out_u)
        try:
            parsed = urllib.parse.urlparse(u)
            host_low = (parsed.hostname or "").lower()
            if host_low in ("127.0.0.1", "localhost", "::1") and lan_ip:
                eff_port = parsed.port or int(port)
                if eff_port != int(port) and parsed.path.startswith(("/stream/", "/play/")):
                    # Loopback-bound TorrServer MKV/DTS stream: route through Velarium's LAN remux endpoint
                    remux_start = f"{start_val:.1f}" if start_val > 5.0 else "0"
                    return f"http://{lan_ip}:{int(port)}/api/remux-stream?src={urllib.parse.quote(u, safe='')}&audio=0&start={remux_start}"
                rebuilt = urllib.parse.urlunparse(
                    (
                        parsed.scheme or "http",
                        f"{lan_ip}:{eff_port}",
                        parsed.path,
                        parsed.params,
                        parsed.query,
                        parsed.fragment,
                    )
                )
                return _inject_remux_start(rebuilt)
        except Exception:
            pass
        return _inject_remux_start(u)

    @staticmethod
    def build_tv_qr_payload(
        lan_ip: str,
        port: int,
        item_id: str = "",
        season: int = 0,
        episode: int = 0,
        pair_key: str = "",
    ) -> Dict[str, str]:
        if not lan_ip:
            return {"tv_url": "", "qr_svg": ""}
        base = f"http://{lan_ip}:{int(port)}/?tv=1"
        clean_key = re.sub(r"[^a-fA-F0-9]+", "", str(pair_key or ""))[:16]
        if clean_key:
            base += f"&k={clean_key}"
        clean_id = re.sub(r"[^a-zA-Z0-9_-]+", "", str(item_id or ""))[:24]
        tv_url = base
        if clean_id:
            cand = f"{base}&p={clean_id}"
            if season > 0 and episode > 0:
                cand += f"&s={int(season)}&e={int(episode)}"
            if len(cand.encode("utf-8")) <= 130:
                tv_url = cand
        try:
            qr_svg = generate_qr_svg(tv_url, quiet_zone=3)
        except Exception:
            tv_url = base
            try:
                qr_svg = generate_qr_svg(base, quiet_zone=3) if len(base.encode("utf-8")) <= 130 else ""
            except Exception:
                min_url = f"http://{lan_ip}:{int(port)}"
                tv_url = min_url
                try:
                    qr_svg = generate_qr_svg(min_url, quiet_zone=3)
                except Exception:
                    qr_svg = ""
        return {"tv_url": tv_url, "qr_svg": qr_svg}

    def discover_devices(self, timeout_sec: float = 1.6, force_refresh: bool = False) -> List[Dict[str, Any]]:
        now = time.time()
        with self._lock:
            ttl = 20.0 if self._cached_devices else 5.0
            if not force_refresh and self._last_scan_ts > 0 and (now - self._last_scan_ts) < ttl:
                return [dict(d) for d in self._cached_devices]

        with self._scan_lock:
            now_inner = time.time()
            with self._lock:
                ttl_inner = 20.0 if self._cached_devices else 5.0
                if not force_refresh and self._last_scan_ts > 0 and (now_inner - self._last_scan_ts) < ttl_inner:
                    return [dict(d) for d in self._cached_devices]

            locations: set = set()
            sock: Optional[socket.socket] = None
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
                sock.settimeout(0.35)
                lan_ip = detect_lan_ipv4()
                if lan_ip:
                    try:
                        sock.bind((lan_ip, 0))
                        try:
                            sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(lan_ip))
                        except OSError:
                            pass
                    except OSError:
                        sock.bind(("", 0))
                else:
                    sock.bind(("", 0))

                for st in SSDP_SEARCH_TARGETS:
                    msg = (
                        "M-SEARCH * HTTP/1.1\r\n"
                        f"HOST: {SSDP_MULTICAST_ADDR[0]}:{SSDP_MULTICAST_ADDR[1]}\r\n"
                        'MAN: "ssdp:discover"\r\n'
                        "MX: 1\r\n"
                        f"ST: {st}\r\n\r\n"
                    ).encode("ascii")
                    try:
                        sock.sendto(msg, SSDP_MULTICAST_ADDR)
                    except OSError:
                        pass

                deadline = time.time() + max(0.4, min(3.5, float(timeout_sec)))
                while time.time() < deadline:
                    try:
                        pkt, _ = sock.recvfrom(8192)
                    except socket.timeout:
                        continue
                    except OSError:
                        break
                    hdrs = parse_ssdp_headers(pkt.decode("utf-8", errors="ignore"))
                    loc = hdrs.get("location", "")
                    if loc.startswith(("http://", "https://")):
                        parsed_loc = urllib.parse.urlparse(loc)
                        if _is_lan_ipv4_host(parsed_loc.hostname or "") and len(locations) < 32:
                            locations.add(loc)
            except Exception:
                pass
            finally:
                if sock is not None:
                    try:
                        sock.close()
                    except Exception:
                        pass

            discovered: List[Dict[str, Any]] = []
            if locations:
                def _fetch_desc(loc_u: str) -> Optional[Dict[str, Any]]:
                    try:
                        req = urllib.request.Request(loc_u, headers={"User-Agent": "Velarium/2.7 UPnP/1.1"})
                        with _LAN_DESC_OPENER.open(req, timeout=2.0) as resp:
                            if resp.status != 200:
                                return None
                            xml_body = resp.read(262144).decode("utf-8", errors="replace")
                            return parse_upnp_device_xml(xml_body, loc_u)
                    except urllib.error.HTTPError as he:
                        try:
                            he.close()
                        except Exception:
                            pass
                        return None
                    except Exception:
                        return None

                for info in _UPNP_EXECUTOR.map(_fetch_desc, sorted(locations)):
                    if info and info.get("control_url"):
                        discovered.append(info)

            # Deduplicate by control_url
            unique_by_ctrl: Dict[str, Dict[str, Any]] = {}
            for d in discovered:
                unique_by_ctrl[d["control_url"]] = d
            final_list = sorted(unique_by_ctrl.values(), key=lambda x: x.get("name", ""))

            with self._lock:
                self._cached_devices = final_list
                self._last_scan_ts = time.time()
            return [dict(d) for d in final_list]

    @staticmethod
    def _send_soap_request(
        control_url: str,
        soap_action: str,
        xml_body: str,
        timeout: float = 5.0,
    ) -> Tuple[bool, str]:
        raw_ctrl = str(control_url or "").strip()
        if not raw_ctrl or any(ord(c) <= 0x20 or ord(c) == 0x7F for c in raw_ctrl):
            return False, "Некорректный адрес DLNA-устройства в локальной сети"
        parsed = urllib.parse.urlparse(raw_ctrl)
        try:
            _ = parsed.port
        except ValueError:
            return False, "Некорректный порт DLNA-устройства"
        if (
            parsed.scheme not in ("http", "https")
            or parsed.username is not None
            or parsed.password is not None
            or not _is_lan_ipv4_host(parsed.hostname or "")
        ):
            return False, "Некорректный адрес DLNA-устройства в локальной сети"
        clean_hdr_act = str(soap_action or "").strip()
        if any(ord(c) < 0x20 or ord(c) == 0x7F for c in clean_hdr_act):
            return False, "Некорректный заголовок SOAPAction"
        data_bytes = xml_body.encode("utf-8")
        req = urllib.request.Request(
            raw_ctrl,
            data=data_bytes,
            headers={
                "Content-Type": 'text/xml; charset="utf-8"',
                "SOAPAction": clean_hdr_act,
                "User-Agent": "Velarium/2.7 DLNA/1.5",
                "Connection": "close",
            },
            method="POST",
        )
        try:
            with _SOAP_OPENER.open(req, timeout=timeout) as resp:
                resp.read(65536)
                return (200 <= resp.status < 300), ""
        except urllib.error.HTTPError as he:
            err_msg = str(he)
            try:
                he.read(8192)
            except Exception:
                pass
            finally:
                try:
                    he.close()
                except Exception:
                    pass
            return False, err_msg
        except Exception as exc:
            return False, str(exc)

    def cast_stream(
        self,
        *,
        control_url: str,
        stream_url: str,
        title: str = "Velarium",
        subtitle_url: str = "",
        start_sec: float = 0.0,
        device_name: str = "Smart TV",
        service_type: str = "urn:schemas-upnp-org:service:AVTransport:1",
    ) -> Dict[str, Any]:
        clean_st = str(service_type or "").strip()
        eff_st = (
            clean_st
            if _UPNP_SERVICE_TYPE_RE.fullmatch(clean_st)
            else "urn:schemas-upnp-org:service:AVTransport:1"
        )
        # Stop any prior transport state gracefully before setting new URI
        stop_act, stop_xml = build_soap_envelope("Stop", "<InstanceID>0</InstanceID>", service_type=eff_st)
        self._send_soap_request(control_url, stop_act, stop_xml, timeout=2.2)

        set_act, set_xml = build_soap_set_av_transport_uri(
            stream_url=stream_url,
            title=title,
            subtitle_url=subtitle_url,
            service_type=eff_st,
        )
        ok_set, err_set = self._send_soap_request(control_url, set_act, set_xml, timeout=6.0)
        if not ok_set:
            return {"ok": False, "error": err_set or "Телевизор отклонил поток SetAVTransportURI"}

        play_act, play_xml = build_soap_envelope(
            "Play",
            "<InstanceID>0</InstanceID><Speed>1</Speed>",
            service_type=eff_st,
        )
        ok_play, err_play = self._send_soap_request(control_url, play_act, play_xml, timeout=5.0)
        if not ok_play:
            return {"ok": False, "error": err_play or "Не удалось запустить воспроизведение на ТВ"}

        if start_sec >= 15.0 and "/api/remux-stream" not in str(stream_url or ""):
            rel_t = format_dlna_rel_time(start_sec)
            seek_act, seek_xml = build_soap_envelope(
                "Seek",
                f"<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>{rel_t}</Target>",
                service_type=eff_st,
            )
            self._send_soap_request(control_url, seek_act, seek_xml, timeout=3.0)

        with self._lock:
            self._active_cast = {
                "device_name": device_name,
                "control_url": control_url,
                "service_type": eff_st,
                "title": title,
                "stream_url": stream_url,
                "started_at": time.time(),
            }
        return {"ok": True, "active_cast": dict(self._active_cast)}

    def stop_cast(self, control_url: str = "") -> Dict[str, Any]:
        with self._lock:
            active = dict(self._active_cast) if self._active_cast else {}
            target_ctrl = control_url or active.get("control_url") or ""
            eff_st = active.get("service_type") or "urn:schemas-upnp-org:service:AVTransport:1"
            self._active_cast = None
        if not target_ctrl:
            return {"ok": True, "stopped": False}
        stop_act, stop_xml = build_soap_envelope("Stop", "<InstanceID>0</InstanceID>", service_type=eff_st)
        ok, err = self._send_soap_request(target_ctrl, stop_act, stop_xml, timeout=3.5)
        return {"ok": ok, "stopped": ok, "error": err}

    def get_active_cast(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            return dict(self._active_cast) if self._active_cast else None
