"""
Velarium Security Vault — Authenticated Encryption for Credentials at Rest.

Provides transparent authenticated stream encryption (HMAC-SHA256 CTR + HMAC-SHA256 tag)
using a per-installation 256-bit master key stored in `data/.vault_key` with strict 0600
POSIX permissions.
"""

import base64
import hashlib
import hmac
import os
import secrets
import sys
import threading
import time


def set_private_file_permissions(path: str, is_dir: bool = False) -> None:
    """Sets strict owner-only permissions (0700 for directories, 0600 for files) on POSIX."""
    if not path or sys.platform == "win32":
        return
    try:
        if os.path.exists(path):
            os.chmod(path, 0o700 if is_dir else 0o600)
    except Exception:
        pass


class LocalVaultCipher:
    """
    Transparent authenticated stream cipher (HMAC-SHA256 CTR + HMAC-SHA256 tag)
    using a per-installation 256-bit master key stored in `data/.vault_key` with 0600 permissions.
    """

    PREFIX = "enc:v1:"

    def __init__(self, storage_dir: str) -> None:
        self.key_path = os.path.join(os.path.abspath(storage_dir), ".vault_key")
        self.is_ephemeral: bool = False
        self._key: bytes = self._load_or_create_key()

    def _load_or_create_key(self) -> bytes:
        # NOTE: the key is 32 raw random bytes; it must NEVER be .strip()-ed (≈5% of keys start or end
        # with a whitespace byte, which previously caused a silent re-key and loss of every secret).
        for _attempt in range(5):
            try:
                with open(self.key_path, "rb") as f:
                    raw = f.read()
                if len(raw) >= 32:
                    set_private_file_permissions(self.key_path, is_dir=False)
                    return raw[:32]
                if _attempt < 4:
                    # Another process may still be writing the 32-byte key: wait briefly before assuming corruption
                    time.sleep(0.1)
                    continue
                # Truncated / corrupt key after retries: keep a copy for forensics, then re-key below
                try:
                    os.replace(self.key_path, f"{self.key_path}.corrupt-{int(time.time())}")
                except Exception:
                    pass
                break
            except FileNotFoundError:
                break
            except Exception:
                # Transient read error (AV scanner lock on Windows, etc.): retry instead of re-keying
                time.sleep(0.2)
        else:
            # Key file exists but could not be read: use an ephemeral key for this run and never overwrite it
            self.is_ephemeral = True
            return secrets.token_bytes(32)

        key = secrets.token_bytes(32)
        key_dir = os.path.dirname(self.key_path)
        tmp_path = f"{self.key_path}.tmp.{os.getpid()}.{threading.get_ident()}"
        try:
            os.makedirs(key_dir, exist_ok=True)
            set_private_file_permissions(key_dir, is_dir=True)
            fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_BINARY", 0), 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(key)
                f.flush()
                try:
                    os.fsync(f.fileno())
                except Exception:
                    pass
            set_private_file_permissions(tmp_path, is_dir=False)
            if sys.platform != "win32":
                try:
                    os.link(tmp_path, self.key_path)
                except OSError as exc:
                    if isinstance(exc, FileExistsError):
                        raise
                    if not os.path.exists(self.key_path):
                        os.replace(tmp_path, self.key_path)
                    else:
                        raise FileExistsError()
            else:
                fd_win = os.open(
                    self.key_path,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0),
                    0o600,
                )
                with os.fdopen(fd_win, "wb") as fw:
                    fw.write(key)
                    fw.flush()
            set_private_file_permissions(self.key_path, is_dir=False)
        except FileExistsError:
            # Another process/thread published the key concurrently: read theirs
            for _ in range(4):
                try:
                    with open(self.key_path, "rb") as f:
                        raw = f.read()
                    if len(raw) >= 32:
                        return raw[:32]
                except Exception:
                    pass
                time.sleep(0.05)
            self.is_ephemeral = True
        except Exception:
            self.is_ephemeral = True
        finally:
            try:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
            except Exception:
                pass
        return key

    def _keystream(self, nonce: bytes, length: int) -> bytes:
        out = bytearray()
        counter = 0
        while len(out) < length:
            blk = hmac.new(
                self._key,
                nonce + counter.to_bytes(4, "big"),
                hashlib.sha256,
            ).digest()
            out.extend(blk)
            counter += 1
        return bytes(out[:length])

    def encrypt_str(self, plaintext: str) -> str:
        s = str(plaintext or "")
        if not s or s.startswith(self.PREFIX):
            return s
        raw_bytes = s.encode("utf-8")
        nonce = secrets.token_bytes(16)
        ks = self._keystream(nonce, len(raw_bytes))
        ct = bytes(a ^ b for a, b in zip(raw_bytes, ks))
        tag = hmac.new(self._key, b"VELARIUM_VAULT_V1" + nonce + ct, hashlib.sha256).digest()[:16]
        token = base64.urlsafe_b64encode(nonce + tag + ct).decode("ascii")
        return f"{self.PREFIX}{token}"

    def decrypt_str(self, value: str) -> str:
        s = str(value or "")
        if not s or not s.startswith(self.PREFIX):
            return s
        b64_part = s[len(self.PREFIX) :]
        try:
            blob = base64.urlsafe_b64decode(b64_part.encode("ascii"))
            if len(blob) < 32:
                return ""
            nonce = blob[:16]
            tag = blob[16:32]
            ct = blob[32:]
            exp_tag = hmac.new(self._key, b"VELARIUM_VAULT_V1" + nonce + ct, hashlib.sha256).digest()[:16]
            if not hmac.compare_digest(tag, exp_tag):
                legacy_tag = hmac.new(self._key, b"\x43\x49\x4e\x45\x46\x4c\x4f\x57_VAULT_V1" + nonce + ct, hashlib.sha256).digest()[:16]
                if not hmac.compare_digest(tag, legacy_tag):
                    return ""
            ks = self._keystream(nonce, len(ct))
            pt = bytes(a ^ b for a, b in zip(ct, ks))
            return pt.decode("utf-8", errors="replace")
        except Exception:
            return ""
