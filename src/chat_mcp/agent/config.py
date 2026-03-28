"""Agent runner configuration."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml


@dataclass
class AgentConfig:
    participant_id: str = ""
    server_url: str = "http://127.0.0.1:8420"
    ssh_key: str = "~/.ssh/id_ed25519"

    watch_rooms: list[str] = field(default_factory=lambda: ["all"])

    # Filters
    mention_me: bool = True
    mention_paired_human: bool = True
    keywords: list[str] = field(default_factory=list)
    all_messages: bool = False

    # Claude invocation
    claude_command: str = "claude"
    claude_flags: list[str] = field(default_factory=lambda: ["-p"])
    max_context_messages: int = 20

    # Intervals
    reconnect_delay_seconds: int = 5
    periodic_checkin_minutes: int = 30

    # Rate limiting
    max_messages_per_minute: int = 10

    @classmethod
    def from_file(cls, path: str | Path) -> "AgentConfig":
        path = Path(path)
        if not path.exists():
            return cls()

        with open(path) as f:
            data = yaml.safe_load(f) or {}

        config = cls()
        config.participant_id = data.get("participant_id", config.participant_id)
        config.server_url = data.get("server_url", config.server_url)
        config.ssh_key = data.get("ssh_key", config.ssh_key)

        watch = data.get("watch", {})
        config.watch_rooms = watch.get("rooms", config.watch_rooms)

        filters = data.get("filters", {})
        config.mention_me = filters.get("mention_me", config.mention_me)
        config.mention_paired_human = filters.get("mention_paired_human", config.mention_paired_human)
        config.keywords = filters.get("keywords", config.keywords)
        config.all_messages = filters.get("all_messages", config.all_messages)

        claude = data.get("claude", {})
        config.claude_command = claude.get("command", config.claude_command)
        config.claude_flags = claude.get("flags", config.claude_flags)
        config.max_context_messages = claude.get("max_context_messages", config.max_context_messages)

        intervals = data.get("intervals", {})
        config.reconnect_delay_seconds = intervals.get("reconnect_delay_seconds", config.reconnect_delay_seconds)
        config.periodic_checkin_minutes = intervals.get("periodic_checkin_minutes", config.periodic_checkin_minutes)

        return config
