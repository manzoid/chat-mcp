"""Watch command — live SSE event stream."""

from __future__ import annotations

import asyncio
import json

import click

from chat_mcp.cli.config import client_config


@click.command()
@click.option("--room", default=None, help="Room ID")
@click.option("--since", "since_seq", default=0, help="Start from sequence number")
def watch(room: str | None, since_seq: int):
    """Watch for live events in a room (SSE stream)."""
    from chat_mcp.cli.client import chat_client

    room_id = room or client_config.room_id
    if not room_id:
        click.echo("Error: No room specified.", err=True)
        raise SystemExit(1)

    async def run():
        click.echo(f"Watching room {room_id[:8]}... (Ctrl+C to stop)")
        try:
            async for event in chat_client.stream_sse(
                f"/rooms/{room_id}/events",
                params={"since_seq": since_seq},
            ):
                etype = event.get("type", "unknown")
                payload = event.get("payload", {})
                seq = event.get("seq", "?")

                if etype == "message.created":
                    author = payload.get("author_id", "?")[:8]
                    text = payload.get("content", {}).get("text", "")
                    click.echo(f"[{seq}] {author}: {text}")
                elif etype == "message.edited":
                    mid = payload.get("message_id", "?")[:8]
                    text = payload.get("content", {}).get("text", "")
                    click.echo(f"[{seq}] (edited #{mid}): {text}")
                elif etype == "message.deleted":
                    mid = payload.get("message_id", "?")[:8]
                    click.echo(f"[{seq}] (deleted #{mid})")
                elif etype == "reaction.added":
                    mid = payload.get("message_id", "?")[:8]
                    emoji = payload.get("reaction", {}).get("emoji", "?")
                    click.echo(f"[{seq}] {emoji} on #{mid}")
                elif etype == "participant.joined":
                    pid = payload.get("participant_id", "?")[:8]
                    click.echo(f"[{seq}] {pid} joined")
                elif etype == "participant.left":
                    pid = payload.get("participant_id", "?")[:8]
                    click.echo(f"[{seq}] {pid} left")
                elif etype == "participant.status":
                    pid = payload.get("participant_id", "?")[:8]
                    state = payload.get("state", "?")
                    click.echo(f"[{seq}] {pid} is now {state}")
                elif etype == "participant.typing":
                    pid = payload.get("participant_id", "?")[:8]
                    typing = payload.get("is_typing", False)
                    if typing:
                        click.echo(f"[{seq}] {pid} is typing...")
                else:
                    click.echo(f"[{seq}] {etype}: {json.dumps(payload)[:100]}")
        except KeyboardInterrupt:
            click.echo("\nStopped watching.")
        finally:
            await chat_client.close()

    asyncio.run(run())
