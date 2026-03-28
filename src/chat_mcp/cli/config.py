"""CLI client configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from chat_mcp.shared.constants import DEFAULT_HOST, DEFAULT_PORT

CONFIG_DIR = Path.home() / ".config" / "chat-mcp"
CONFIG_FILE = CONFIG_DIR / "config.toml"
TOKEN_FILE = CONFIG_DIR / "token"


@dataclass
class ClientConfig:
    server_url: str = field(
        default_factory=lambda: os.environ.get(
            "CHAT_MCP_SERVER_URL", f"http://{DEFAULT_HOST}:{DEFAULT_PORT}"
        )
    )
    participant_id: str = field(
        default_factory=lambda: os.environ.get("CHAT_MCP_PARTICIPANT_ID", "")
    )
    room_id: str = field(
        default_factory=lambda: os.environ.get("CHAT_MCP_ROOM_ID", "")
    )
    ssh_key_path: str = field(
        default_factory=lambda: os.environ.get("CHAT_MCP_SSH_KEY", "~/.ssh/id_ed25519")
    )

    def load(self) -> None:
        """Load config from TOML file if it exists."""
        if CONFIG_FILE.exists():
            import tomllib
            with open(CONFIG_FILE, "rb") as f:
                data = tomllib.load(f)
            self.server_url = data.get("server_url", self.server_url)
            self.participant_id = data.get("participant_id", self.participant_id)
            self.room_id = data.get("room_id", self.room_id)
            self.ssh_key_path = data.get("ssh_key_path", self.ssh_key_path)

    def save(self) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        lines = [
            f'server_url = "{self.server_url}"',
            f'participant_id = "{self.participant_id}"',
            f'room_id = "{self.room_id}"',
            f'ssh_key_path = "{self.ssh_key_path}"',
        ]
        CONFIG_FILE.write_text("\n".join(lines) + "\n")

    @property
    def token(self) -> str | None:
        if TOKEN_FILE.exists():
            return TOKEN_FILE.read_text().strip()
        return None

    @token.setter
    def token(self, value: str) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(value)
        TOKEN_FILE.chmod(0o600)


client_config = ClientConfig()
