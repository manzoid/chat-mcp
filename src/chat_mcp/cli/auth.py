"""Client-side authentication flow."""

from __future__ import annotations

from chat_mcp.cli.client import chat_client
from chat_mcp.cli.config import client_config
from chat_mcp.cli.signing import ssh_sign


async def login() -> str:
    """Perform challenge-response login and store the session token."""
    pid = client_config.participant_id
    if not pid:
        raise ValueError("No participant_id configured. Run 'chat register' first.")

    # Get challenge
    resp = await chat_client.post("/auth/challenge", json={"participant_id": pid})
    challenge = resp["challenge"]

    # Sign challenge
    signature = ssh_sign(
        challenge.encode("utf-8"),
        key_path=client_config.ssh_key_path,
    )

    # Verify
    resp = await chat_client.post("/auth/verify", json={
        "participant_id": pid,
        "signed_challenge": signature,
    })

    token = resp["session_token"]
    client_config.token = token
    return token


async def register(display_name: str, public_key: str | None = None, participant_type: str = "human") -> str:
    """Register a new participant and store the participant ID."""
    import os

    if not public_key:
        # Try to read the public key from the configured SSH key path
        pub_key_path = os.path.expanduser(client_config.ssh_key_path + ".pub")
        if os.path.exists(pub_key_path):
            public_key = open(pub_key_path).read().strip()

    resp = await chat_client.post("/auth/register", json={
        "display_name": display_name,
        "type": participant_type,
        "public_key": public_key,
    })

    pid = resp["participant_id"]
    client_config.participant_id = pid
    client_config.save()
    return pid
