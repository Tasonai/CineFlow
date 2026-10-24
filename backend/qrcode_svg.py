"""
Pure-Python ISO/IEC 18004 QR Code SVG Generator & Local Network Address Detector.
Zero third-party dependencies — generates crisp, high-contrast vector SVG QR codes
for LAN URLs (e.g. `http://192.168.1.25:8765`) scannable by iOS, iPadOS, Android, and Smart TVs.
"""

import socket
from typing import List, Optional, Tuple

# Version 1..6 parameters for Error Correction Level M:
# version -> (size, total_data_codewords, ec_codewords_per_block, num_blocks, alignment_centers)
_QR_VERSIONS_M = {
    1: (21, 16, 10, 1, ()),
    2: (25, 28, 16, 1, (6, 18)),
    3: (29, 44, 26, 1, (6, 22)),
    4: (33, 64, 18, 2, (6, 26)),
    5: (37, 86, 24, 2, (6, 30)),
    6: (41, 108, 16, 4, (6, 34)),
}

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


def _encode_codewords(payload: bytes) -> Tuple[int, List[int]]:
    length = len(payload)
    chosen_ver = 0
    for ver, (_, data_cw, _, _, _) in sorted(_QR_VERSIONS_M.items()):
        # Byte mode header: 4 bits mode (0100) + 8 bits char count (for ver 1..9) = 12 bits
        max_bytes = (data_cw * 8 - 12) // 8
        if length <= max_bytes:
            chosen_ver = ver
            break
    if not chosen_ver:
        raise ValueError("QR payload too long for versions 1..6 (max ~106 bytes)")

    _, total_data_cw, ec_per_block, num_blocks, _ = _QR_VERSIONS_M[chosen_ver]
    bits: List[int] = []

    def _append_bits(val: int, count: int) -> None:
        for shift in range(count - 1, -1, -1):
            bits.append((val >> shift) & 1)

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

    # Split into equal blocks (versions 1..6 at ECC-M all use equal-size blocks)
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

    return chosen_ver, interleaved


def _format_bits_ecc_m(mask_id: int) -> int:
    # ECC Level M indicator = 00
    data = ((0b00 << 3) | (mask_id & 0b111)) << 10
    rem = data
    for bit in range(14, 9, -1):
        if rem & (1 << bit):
            rem ^= 0x537 << (bit - 10)
    combined = (((0b00 << 3) | (mask_id & 0b111)) << 10) | rem
    return combined ^ 0x5412


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
    return score


def build_qr_matrix(text: str) -> List[List[int]]:
    payload = text.encode("utf-8")
    ver, codewords = _encode_codewords(payload)
    size, _, _, _, align_coords = _QR_VERSIONS_M[ver]

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
        fmt = _format_bits_ecc_m(mask_id)
        # Copy 1: around top-left finder
        for i in range(6):
            grid[8][i] = (fmt >> i) & 1
        grid[8][7] = (fmt >> 6) & 1
        grid[8][8] = (fmt >> 7) & 1
        grid[7][8] = (fmt >> 8) & 1
        for i in range(9, 15):
            grid[14 - i][8] = (fmt >> i) & 1

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
    matrix = build_qr_matrix(text)
    n = len(matrix)
    total = n + quiet_zone * 2
    path_parts: List[str] = []
    for r in range(n):
        row = matrix[r]
        y = r + quiet_zone
        c = 0
        while c < n:
            if row[c]:
                run = 1
                while c + run < n and row[c + run]:
                    run += 1
                x = c + quiet_zone
                path_parts.append(f"M{x},{y}h{run}v1h-{run}z")
                c += run
            else:
                c += 1
    d_attr = "".join(path_parts)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total} {total}" '
        f'shape-rendering="crispEdges" role="img" aria-label="QR Code">'
        f'<rect width="{total}" height="{total}" rx="2.2" fill="{bg_color}"/>'
        f'<path d="{d_attr}" fill="{fg_color}"/>'
        f"</svg>"
    )


def detect_lan_ipv4() -> str:
    """
    Detects the primary active LAN IPv4 address of the host (e.g. `192.168.1.42`)
    without sending any network packets (UDP connect to RFC5737 / DNS route).
    """
    for target in (("192.0.2.1", 80), ("1.1.1.1", 80)):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(target)
            ip = sock.getsockname()[0]
            if ip and not ip.startswith("127.") and ip != "0.0.0.0":
                return ip
        except OSError:
            pass
        finally:
            sock.close()

    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and not ip.startswith("169.254."):
                return ip
    except OSError:
        pass
    return ""
