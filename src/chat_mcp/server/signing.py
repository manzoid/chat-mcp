"""Server-side SSH signature verification."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from typing import Optional


def verify_ssh_signature(
    payload: bytes, signature: str, public_key: str, namespace: str = "chat-mcp"
) -> bool:
    """Verify an SSH signature using ssh-keygen -Y verify.

    Args:
        payload: The original data that was signed.
        signature: The PEM-encoded SSH signature.
        public_key: The signer's SSH public key (e.g. "ssh-ed25519 AAAA...").
        namespace: The signing namespace (must match what was used to sign).

    Returns:
        True if the signature is valid, False otherwise.
    """
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)

            # Write allowed signers file
            allowed_signers_file = tmppath / "allowed_signers"
            allowed_signers_file.write_text(f"signer {public_key}\n")

            # Write signature to file
            sig_file = tmppath / "signature"
            sig_file.write_text(signature)

            proc = subprocess.run(
                [
                    "ssh-keygen",
                    "-Y", "verify",
                    "-f", str(allowed_signers_file),
                    "-I", "signer",
                    "-n", namespace,
                    "-s", str(sig_file),
                ],
                input=payload,
                capture_output=True,
                timeout=10,
            )
            return proc.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return False


def verify_message_signature(
    canonical_payload: str, signature: Optional[str], public_key: Optional[str]
) -> bool:
    """Verify a message's cryptographic signature."""
    if not signature or not public_key:
        return False
    return verify_ssh_signature(canonical_payload.encode("utf-8"), signature, public_key)
