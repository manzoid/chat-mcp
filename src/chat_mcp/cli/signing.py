"""Client-side SSH signing via ssh-keygen."""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path


class SigningError(Exception):
    pass


def ssh_sign(payload: bytes, key_path: str = "~/.ssh/id_ed25519", namespace: str = "chat-mcp") -> str:
    """Sign a payload using the user's SSH key via ssh-keygen -Y sign.

    Args:
        payload: The data to sign.
        key_path: Path to the SSH private key.
        namespace: The signing namespace.

    Returns:
        PEM-encoded SSH signature string.
    """
    key_path = os.path.expanduser(key_path)
    if not Path(key_path).exists():
        raise SigningError(f"SSH key not found: {key_path}")

    proc = subprocess.run(
        ["ssh-keygen", "-Y", "sign", "-f", key_path, "-n", namespace],
        input=payload,
        capture_output=True,
        timeout=10,
    )
    if proc.returncode != 0:
        raise SigningError(f"ssh-keygen sign failed: {proc.stderr.decode()}")

    return proc.stdout.decode()
