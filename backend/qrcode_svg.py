"""
Pure-Python ISO/IEC 18004 QR Code SVG Generator & Local Network Address Detector.
Zero third-party dependencies — generates crisp, high-contrast vector SVG QR codes
for LAN URLs (e.g. `http://192.168.1.25:8765`) scannable by iOS, iPadOS, Android, and Smart TVs.
"""

import html
import ipaddress
import socket
from typing import List, Optional, Tuple

# Version 1..6 parameters:
# version -> (size, total_data_codewords, ec_codewords_per_block, num_blocks, alignment_centers, ecc_format_bits)
_QR_VERSIONS_M = {
    1: (21, 16, 10, 1, (), 0b00),
    2: (25, 28, 16, 1, (6, 18), 0b00),
    3: (29, 44, 26, 1, (6, 22), 0b00),
    4: (33, 64, 18, 2, (6, 26), 0b00),
    5: (37, 86, 24, 2, (6, 30), 0b00),
    6: (41, 108, 16, 4, (6, 34), 0b00),
}
# Extended Version 6 Level L fallback for longer URLs (up to 134 bytes)
_QR_V6_ECC_L = (41, 136, 18, 2, (6, 34), 0b01)

# GF(256) log / exp tables with primitive polynomial 0x11D
_GF_EXP = [0] * 512
_GF_LOG = [0] * 256


def _init_gf256() -> None:
    x = 1
    for i in range(255):
        _GF_EXP[i] = x
        _GF_LOG[x] = i
        x <<= 1
        if x & 0x100:
            x ^= 0x11D
    for i in range(255, 512):
        _GF_EXP[i] = _GF_EXP[i - 255]


_init_gf256()


def _gf_mul(a: int, b: int) -> int:
    if a == 0 or b == 0:
        return 0
    return _GF_EXP[_GF_LOG[a] + _GF_LOG[b]]


def _rs_generator_poly(degree: int) -> List[int]:
    poly = [1]
    for i in range(degree):
        next_poly = [0] * (len(poly) + 1)
        factor = _GF_EXP[i]
        for j, coef in enumerate(poly):
            next_poly[j] ^= coef
            next_poly[j + 1] ^= _gf_mul(coef, factor)
        poly = next_poly
    return poly


def _rs_compute_remainder(data: List[int], ec_len: int) -> List[int]:
    gen = _rs_generator_poly(ec_len)
    rem = [0] * ec_len
    for byte in data:
        factor = byte ^ rem[0]
        rem = rem[1:] + [0]
        if factor != 0:
            for j in range(ec_len):
                rem[j] ^= _gf_mul(gen[j + 1], factor)
    return rem


def _encode_codewords(
    payload: bytes,
    use_eci_utf8: bool = False,
) -> Tuple[Tuple[int, int, int, int, Tuple[int, ...], int], List[int]]:
    length = len(payload)
    # Pure ASCII uses 12-bit Byte header (0100 + 8-bit length);
    # non-ASCII prepends 12-bit ISO/IEC 18004 UTF-8 ECI header (0111 + 26) = 24 header bits.
    header_bits = 24 if use_eci_utf8 else 12
    chosen_spec: Optional[Tuple[int, int, int, int, Tuple[int, ...], int]] = None
    for _, spec in sorted(_QR_VERSIONS_M.items()):
        data_cw = spec[1]
        max_bytes = (data_cw * 8 - header_bits) // 8
        if length <= max_bytes:
            chosen_spec = spec
            break
    if chosen_spec is None:
        max_l_bytes = (_QR_V6_ECC_L[1] * 8 - header_bits) // 8
        if length <= max_l_bytes:
            chosen_spec = _QR_V6_ECC_L
        else:
            raise ValueError("QR payload too long for versions 1..6 (max 134 bytes)")

    _, total_data_cw, ec_per_block, num_blocks, _, _ = chosen_spec
    bits: List[int] = []

    def _append_bits(val: int, count: int) -> None:
        for shift in range(count - 1, -1, -1):
            bits.append((val >> shift) & 1)

    if use_eci_utf8:
        _append_bits(0b0111, 4)
        _append_bits(26, 8)
    _append_bits(0b0100, 4)
    _append_bits(length, 8)
    for b in payload:
        _append_bits(b, 8)

    capacity_bits = total_data_cw * 8
    terminator = min(4, capacity_bits - len(bits))
    _append_bits(0, terminator)
    while len(bits) % 8 != 0:
        bits.append(0)

    data_bytes: List[int] = []
    for i in range(0, len(bits), 8):
        byte_val = 0
        for bit in bits[i : i + 8]:
            byte_val = (byte_val << 1) | bit
        data_bytes.append(byte_val)

    pad_cycle = (0xEC, 0x11)
    idx = 0
    while len(data_bytes) < total_data_cw:
        data_bytes.append(pad_cycle[idx % 2])
        idx += 1

    # Split into equal blocks
    block_size = total_data_cw // num_blocks
    data_blocks: List[List[int]] = []
    ec_blocks: List[List[int]] = []
    for b_idx in range(num_blocks):
        blk = data_bytes[b_idx * block_size : (b_idx + 1) * block_size]
        data_blocks.append(blk)
        ec_blocks.append(_rs_compute_remainder(blk, ec_per_block))

    interleaved: List[int] = []
    for col in range(block_size):
        for b_idx in range(num_blocks):
            interleaved.append(data_blocks[b_idx][col])
    for col in range(ec_per_block):
        for b_idx in range(num_blocks):
            interleaved.append(ec_blocks[b_idx][col])

    return chosen_spec, interleaved


def _format_bits_for_ecc(ecc_bits: int, mask_id: int) -> int:
    hdr = ((ecc_bits & 0b11) << 3) | (mask_id & 0b111)
    data = hdr << 10
    rem = data
    for bit in range(14, 9, -1):
        if rem & (1 << bit):
            rem ^= 0x537 << (bit - 10)
    combined = (hdr << 10) | rem
    return combined ^ 0x5412


def _format_bits_ecc_m(mask_id: int) -> int:
    return _format_bits_for_ecc(0b00, mask_id)


def _mask_bit(mask_id: int, r: int, c: int) -> bool:
    if mask_id == 0:
        return (r + c) % 2 == 0
    if mask_id == 1:
        return r % 2 == 0
    if mask_id == 2:
        return c % 3 == 0
    if mask_id == 3:
        return (r + c) % 3 == 0
    if mask_id == 4:
        return (r // 2 + c // 3) % 2 == 0
    if mask_id == 5:
        return ((r * c) % 2 + (r * c) % 3) == 0
    if mask_id == 6:
        return (((r * c) % 2 + (r * c) % 3) % 2) == 0
    return (((r + c) % 2 + (r * c) % 3) % 2) == 0


def _penalty_score(modules: List[List[int]]) -> int:
    n = len(modules)
    score = 0
    # Rule 1: runs of >=5 identical modules in rows and columns
    for r in range(n):
        run_val = modules[r][0]
        run_len = 1
        for c in range(1, n):
            if modules[r][c] == run_val:
                run_len += 1
            else:
                if run_len >= 5:
                    score += 3 + (run_len - 5)
                run_val = modules[r][c]
                run_len = 1
        if run_len >= 5:
            score += 3 + (run_len - 5)

    for c in range(n):
        run_val = modules[0][c]
        run_len = 1
        for r in range(1, n):
            if modules[r][c] == run_val:
                run_len += 1
            else:
                if run_len >= 5:
                    score += 3 + (run_len - 5)
                run_val = modules[r][c]
                run_len = 1
        if run_len >= 5:
            score += 3 + (run_len - 5)

    # Rule 2: 2x2 blocks
    for r in range(n - 1):
        for c in range(n - 1):
            v = modules[r][c]
            if v == modules[r][c + 1] == modules[r + 1][c] == modules[r + 1][c + 1]:
                score += 3

    # Rule 3: 1:1:3:1:1 finder-like patterns preceded or followed by 4 light modules
    pat_a = (1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0)
    pat_b = (0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1)
    for r in range(n):
        row = modules[r]
        for c in range(n - 10):
            seg = tuple(row[c : c + 11])
            if seg == pat_a or seg == pat_b:
                score += 40
    for c in range(n):
        for r in range(n - 10):
            seg = tuple(modules[r + k][c] for k in range(11))
            if seg == pat_a or seg == pat_b:
                score += 40

    # Rule 4: dark/light module ratio deviation from 50%
    total_mods = n * n
    dark_mods = sum(sum(row) for row in modules)
    pct_dark = (dark_mods * 100) / max(1, total_mods)
    steps_from_50 = int(abs(pct_dark - 50.0) // 5)
    score += steps_from_50 * 10
    return score


def build_qr_matrix(text: str) -> List[List[int]]:
    raw_str = str(text or "")
    payload = raw_str.encode("utf-8", errors="replace")
    spec, codewords = _encode_codewords(payload, use_eci_utf8=(not raw_str.isascii()))
    size, _, _, _, align_coords, ecc_bits = spec

    base: List[List[int]] = [[0] * size for _ in range(size)]
    is_func: List[List[bool]] = [[False] * size for _ in range(size)]

    def _set_func(r: int, c: int, dark: bool) -> None:
        if 0 <= r < size and 0 <= c < size:
            base[r][c] = 1 if dark else 0
            is_func[r][c] = True

    def _draw_finder(top: int, left: int) -> None:
        for dr in range(-1, 8):
            for dc in range(-1, 8):
                rr, cc = top + dr, left + dc
                if 0 <= rr < size and 0 <= cc < size:
                    in_outer = 0 <= dr <= 6 and 0 <= dc <= 6
                    on_border = dr in (0, 6) or dc in (0, 6)
                    in_center = 2 <= dr <= 4 and 2 <= dc <= 4
                    _set_func(rr, cc, in_outer and (on_border or in_center))

    _draw_finder(0, 0)
    _draw_finder(0, size - 7)
    _draw_finder(size - 7, 0)

    # Timing patterns
    for i in range(8, size - 8):
        _set_func(6, i, i % 2 == 0)
        _set_func(i, 6, i % 2 == 0)

    # Alignment patterns
    if align_coords:
        for ar in align_coords:
            for ac in align_coords:
                if (ar == 6 and ac == 6) or (ar == 6 and ac == size - 7) or (ar == size - 7 and ac == 6):
                    continue
                for dr in range(-2, 3):
                    for dc in range(-2, 3):
                        dist = max(abs(dr), abs(dc))
                        _set_func(ar + dr, ac + dc, dist in (0, 2))

    # Reserve format info & dark module
    for i in range(9):
        if i != 6:
            _set_func(8, i, False)
            _set_func(i, 8, False)
    for i in range(8):
        _set_func(8, size - 1 - i, False)
        _set_func(size - 1 - i, 8, False)
    _set_func(size - 8, 8, True)

    # Place data bits in upward/downward 2-column zig-zag
    bit_stream: List[int] = []
    for cw in codewords:
        for shift in range(7, -1, -1):
            bit_stream.append((cw >> shift) & 1)

    bit_idx = 0
    upward = True
    col = size - 1
    while col > 0:
        if col == 6:
            col -= 1
        row_iter = range(size - 1, -1, -1) if upward else range(size)
        for r in row_iter:
            for dc in (0, 1):
                c = col - dc
                if not is_func[r][c]:
                    if bit_idx < len(bit_stream):
                        base[r][c] = bit_stream[bit_idx]
                        bit_idx += 1
                    else:
                        base[r][c] = 0
        upward = not upward
        col -= 2

    def _write_format_bits(grid: List[List[int]], mask_id: int) -> None:
        fmt = _format_bits_for_ecc(ecc_bits, mask_id)
        # Copy 1: around top-left finder (ISO/IEC 18004 Fig. 25: bit 0 at (0,8) .. bit 14 at (8,0))
        for i in range(6):
            grid[i][8] = (fmt >> i) & 1
        grid[7][8] = (fmt >> 6) & 1
        grid[8][8] = (fmt >> 7) & 1
        grid[8][7] = (fmt >> 8) & 1
        for i in range(9, 15):
            grid[8][14 - i] = (fmt >> i) & 1

        # Copy 2: bottom-left vertical & top-right horizontal
        for i in range(8):
            grid[8][size - 1 - i] = (fmt >> i) & 1
        for i in range(8, 15):
            grid[size - 15 + i][8] = (fmt >> i) & 1
        grid[size - 8][8] = 1

    best_grid: Optional[List[List[int]]] = None
    best_penalty = 10**9
    for mask_id in range(8):
        cand = [row[:] for row in base]
        for r in range(size):
            for c in range(size):
                if not is_func[r][c] and _mask_bit(mask_id, r, c):
                    cand[r][c] ^= 1
        _write_format_bits(cand, mask_id)
        pen = _penalty_score(cand)
        if pen < best_penalty:
            best_penalty = pen
            best_grid = cand

    return best_grid or base


def generate_qr_svg(
    text: str,
    quiet_zone: int = 3,
    fg_color: str = "#090a0f",
    bg_color: str = "#ffffff",
) -> str:
    qz = max(1, min(16, int(quiet_zone)))
    safe_bg = html.escape(str(bg_color or "#ffffff"), quote=True)
    safe_fg = html.escape(str(fg_color or "#090a0f"), quote=True)
    matrix = build_qr_matrix(text)
    n = len(matrix)
    total = n + qz * 2
    path_parts: List[str] = []
    for r in range(n):
        row = matrix[r]
        y = r + qz
        c = 0
        while c < n:
            if row[c]:
                run = 1
                while c + run < n and row[c + run]:
                    run += 1
                x = c + qz
                path_parts.append(f"M{x},{y}h{run}v1h-{run}z")
                c += run
            else:
                c += 1
    d_attr = "".join(path_parts)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total} {total}" '
        f'shape-rendering="crispEdges" role="img" aria-label="QR Code">'
        f'<rect width="{total}" height="{total}" rx="2.2" fill="{safe_bg}"/>'
        f'<path d="{d_attr}" fill="{safe_fg}"/>'
        f"</svg>"
    )


def _classify_lan_candidate_ip(ip_str: str) -> int:
    """
    Scores candidate IPv4 addresses:
      2 = RFC1918 home/office Wi-Fi & Ethernet (192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12)
      1 = CGNAT / Tailscale mesh (100.64.0.0/10)
      0 = Disallowed / unreachable from LAN phones (loopback, 0.0.0.0, 169.254.x.x APIPA, 198.18.0.0/15 VPN TUN, multicast, public)
    """
    if not ip_str:
        return 0
    try:
        ip_obj = ipaddress.ip_address(ip_str.strip())
        if ip_obj.version != 4:
            return 0
        if ip_obj.is_loopback or ip_obj.is_unspecified or ip_obj.is_link_local or ip_obj.is_multicast:
            return 0
        if ip_obj in ipaddress.ip_network("198.18.0.0/15"):
            return 0
        if (
            ip_obj in ipaddress.ip_network("192.168.0.0/16")
            or ip_obj in ipaddress.ip_network("10.0.0.0/8")
            or ip_obj in ipaddress.ip_network("172.16.0.0/12")
        ):
            return 2
        if ip_obj in ipaddress.ip_network("100.64.0.0/10"):
            return 1
    except ValueError:
        return 0
    return 0


def detect_lan_ipv4() -> str:
    """
    Detects the primary active LAN IPv4 address of the host (e.g. `192.168.1.42`)
    without sending any network packets, avoiding virtual VPN TUN (`198.18.x.x`) and APIPA (`169.254.x.x`).
    """
    fallback_cgnat = ""
    probe_targets = (
        ("192.168.1.1", 80),
        ("192.168.0.1", 80),
        ("10.0.0.1", 80),
        ("172.16.0.1", 80),
        ("192.0.2.1", 80),
        ("1.1.1.1", 80),
    )
    for target in probe_targets:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(target)
            ip = sock.getsockname()[0]
            rank = _classify_lan_candidate_ip(ip)
            if rank == 2:
                return ip
            if rank == 1 and not fallback_cgnat:
                fallback_cgnat = ip
        except OSError:
            pass
        finally:
            sock.close()

    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            rank = _classify_lan_candidate_ip(ip)
            if rank == 2:
                return ip
            if rank == 1 and not fallback_cgnat:
                fallback_cgnat = ip
    except OSError:
        pass
    return fallback_cgnat
