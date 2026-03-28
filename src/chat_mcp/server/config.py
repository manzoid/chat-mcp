"""Server configuration loaded from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from chat_mcp.shared.constants import DEFAULT_DB_PATH, DEFAULT_HOST, DEFAULT_PORT


@dataclass
class ServerConfig:
    host: str = field(default_factory=lambda: os.environ.get("CHAT_MCP_HOST", DEFAULT_HOST))
    port: int = field(
        default_factory=lambda: int(os.environ.get("CHAT_MCP_PORT", str(DEFAULT_PORT)))
    )
    db_path: str = field(default_factory=lambda: os.environ.get("CHAT_MCP_DB_PATH", DEFAULT_DB_PATH))
    data_dir: str = field(
        default_factory=lambda: os.environ.get("CHAT_MCP_DATA_DIR", "data")
    )
    max_attachment_bytes: int = 50 * 1024 * 1024

    @property
    def attachments_dir(self) -> Path:
        p = Path(self.data_dir) / "attachments"
        p.mkdir(parents=True, exist_ok=True)
        return p


config = ServerConfig()
