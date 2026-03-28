"""Read messages command."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone, timedelta

import click

from chat_mcp.cli.config import client_config


def _parse_since(since: str) -> str:
    """Parse a relative time string like '1h', '30m', '2d' into an ISO timestamp."""
    now = datetime.now(timezone.utc)
    unit = since[-1]
    amount = int(since[:-1])
    if unit == "m":
        dt = now - timedelta(minutes=amount)
    elif unit == "h":
        dt = now - timedelta(hours=amount)
    elif unit == "d":
        dt = now - timedelta(days=amount)
    else:
        return since  # Assume it's already an ISO timestamp
    return dt.isoformat()


@click.command()
@click.option("--room", default=None, help="Room ID")
@click.option("--last", default=20, help="Number of messages to show")
@click.option("--since", default=None, help="Show messages since (e.g., 1h, 30m, 2d)")
@click.option("--thread", default=None, help="Show thread replies")
def read(room: str | None, last: int, since: str | None, thread: str | None):
    """Read messages from a room."""
    from chat_mcp.cli.client import chat_client

    room_id = room or client_config.room_id
    if not room_id:
        click.echo("Error: No room specified. Use --room or set CHAT_MCP_ROOM_ID.", err=True)
        raise SystemExit(1)

    async def run():
        params = {"limit": last}
        if since:
            params["after"] = _parse_since(since)
        if thread:
            params["thread_id"] = thread

        messages = await chat_client.get(f"/rooms/{room_id}/messages", params=params)

        for msg in messages:
            ts = msg["created_at"][:16]
            author = msg["author_id"][:8]
            text = msg["content"]["text"]
            mid = msg["id"][:8]

            prefix = f"[{ts}] {author}"
            if msg.get("thread_id"):
                prefix = f"  {prefix}"  # Indent thread replies

            line = f"{prefix}: {text}"

            # Show reactions
            if msg.get("reactions"):
                emojis = " ".join(r["emoji"] for r in msg["reactions"])
                line += f"  [{emojis}]"

            # Show attachment indicators
            for att in msg.get("attachments", []):
                line += f"\n  [{att['mime_type']}: {att['filename']} {att['size_bytes']}B]"

            if msg.get("edited_at"):
                line += " (edited)"

            click.echo(f"#{mid} {line}")

        await chat_client.close()

    asyncio.run(run())
