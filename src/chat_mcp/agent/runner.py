"""Agent runner — autonomous event loop that watches chat and acts via Claude."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

import click
import httpx

from chat_mcp.agent.config import AgentConfig
from chat_mcp.agent.filters import is_relevant
from chat_mcp.agent.invoker import build_prompt, invoke_claude

DEFAULT_CONFIG_PATH = Path.home() / ".config" / "chat-mcp" / "agent.yaml"
STATE_FILE = Path.home() / ".config" / "chat-mcp" / "agent_state.json"


def _load_last_seq() -> int:
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text())
            return data.get("last_seq", 0)
        except (json.JSONDecodeError, OSError):
            pass
    return 0


def _save_last_seq(seq: int) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"last_seq": seq}))


async def _fetch_recent_messages(
    client: httpx.AsyncClient, config: AgentConfig, room_id: str, headers: dict
) -> list[dict]:
    try:
        resp = await client.get(
            f"{config.server_url}/rooms/{room_id}/messages",
            headers=headers,
            params={"limit": config.max_context_messages},
        )
        if resp.status_code == 200:
            return resp.json()
    except httpx.HTTPError:
        pass
    return []


async def _send_message(
    client: httpx.AsyncClient, config: AgentConfig, room_id: str, text: str, headers: dict
) -> None:
    try:
        await client.post(
            f"{config.server_url}/rooms/{room_id}/messages",
            headers=headers,
            json={"content_text": text, "content_format": "markdown"},
        )
    except httpx.HTTPError as e:
        print(f"[agent] Failed to send message: {e}", file=sys.stderr)


async def _get_rooms(
    client: httpx.AsyncClient, config: AgentConfig, headers: dict
) -> list[dict]:
    try:
        resp = await client.get(f"{config.server_url}/rooms", headers=headers)
        if resp.status_code == 200:
            return resp.json()
    except httpx.HTTPError:
        pass
    return []


async def _get_paired_human(
    client: httpx.AsyncClient, config: AgentConfig, headers: dict
) -> Optional[str]:
    """Get the paired human's participant ID."""
    # We'd need to look up our own participant record; for now return None
    return None


class AgentRunner:
    def __init__(self, config: AgentConfig):
        self.config = config
        self._messages_sent = 0
        self._last_rate_reset = time.monotonic()

    def _check_rate_limit(self) -> bool:
        now = time.monotonic()
        if now - self._last_rate_reset > 60:
            self._messages_sent = 0
            self._last_rate_reset = now
        return self._messages_sent < self.config.max_messages_per_minute

    async def run(self) -> None:
        last_seq = _load_last_seq()
        headers = {"X-Participant-ID": self.config.participant_id}

        print(f"[agent] Starting agent runner for {self.config.participant_id}")
        print(f"[agent] Server: {self.config.server_url}")
        print(f"[agent] Last seq: {last_seq}")

        while True:
            try:
                async with httpx.AsyncClient(timeout=None) as client:
                    # Get rooms to watch
                    rooms = await _get_rooms(client, self.config, headers)
                    if not rooms:
                        print("[agent] No rooms found. Waiting...", file=sys.stderr)
                        await asyncio.sleep(self.config.reconnect_delay_seconds)
                        continue

                    paired_human = await _get_paired_human(client, self.config, headers)

                    # Watch first room (TODO: multi-room support)
                    room = rooms[0]
                    room_id = room["id"]
                    print(f"[agent] Watching room: {room.get('name', room_id[:8])}")

                    # Stream events via SSE
                    async with client.stream(
                        "GET",
                        f"{self.config.server_url}/rooms/{room_id}/events",
                        headers=headers,
                        params={"since_seq": last_seq},
                    ) as resp:
                        buffer = ""
                        async for chunk in resp.aiter_text():
                            buffer += chunk
                            while "\n\n" in buffer:
                                event_str, buffer = buffer.split("\n\n", 1)
                                data_line = None
                                for line in event_str.strip().split("\n"):
                                    if line.startswith("data:"):
                                        data_line = line[5:].strip()

                                if not data_line:
                                    continue

                                try:
                                    event = json.loads(data_line)
                                except json.JSONDecodeError:
                                    continue

                                seq = event.get("seq", 0)
                                if seq > last_seq:
                                    last_seq = seq
                                    _save_last_seq(last_seq)

                                if not is_relevant(event, self.config, paired_human):
                                    continue

                                print(f"[agent] Relevant event: {event.get('type')} (seq {seq})")

                                if not self._check_rate_limit():
                                    print("[agent] Rate limit reached, skipping", file=sys.stderr)
                                    continue

                                # Fetch recent context
                                recent = await _fetch_recent_messages(
                                    client, self.config, room_id, headers
                                )

                                # Build prompt and invoke Claude
                                prompt = build_prompt(event, recent, self.config)
                                response = invoke_claude(prompt, self.config)

                                if response:
                                    await _send_message(
                                        client, self.config, room_id, response, headers
                                    )
                                    self._messages_sent += 1
                                    print(f"[agent] Sent response: {response[:80]}")

            except (httpx.HTTPError, httpx.StreamError) as e:
                print(f"[agent] Connection error: {e}. Reconnecting...", file=sys.stderr)
                await asyncio.sleep(self.config.reconnect_delay_seconds)
            except KeyboardInterrupt:
                print("\n[agent] Shutting down.")
                break


@click.command()
@click.option("--config", "config_path", default=str(DEFAULT_CONFIG_PATH), help="Config file path")
def main(config_path: str):
    """Run the autonomous chat agent."""
    config = AgentConfig.from_file(config_path)

    # Allow env overrides
    config.participant_id = os.environ.get("CHAT_MCP_PARTICIPANT_ID", config.participant_id)
    config.server_url = os.environ.get("CHAT_MCP_SERVER_URL", config.server_url)

    if not config.participant_id:
        click.echo("Error: No participant_id configured.", err=True)
        sys.exit(1)

    runner = AgentRunner(config)
    asyncio.run(runner.run())


if __name__ == "__main__":
    main()
