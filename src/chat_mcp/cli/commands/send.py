"""Send message command."""

from __future__ import annotations

import asyncio

import click

from chat_mcp.cli.config import client_config


@click.command()
@click.argument("message")
@click.option("--room", default=None, help="Room ID (uses default if not set)")
@click.option("--thread", default=None, help="Thread ID (reply to a message)")
@click.option("--mention", multiple=True, help="Participant IDs to mention")
@click.option("--attach", default=None, help="File path to attach")
def send(message: str, room: str | None, thread: str | None, mention: tuple, attach: str | None):
    """Send a message to a room."""
    from chat_mcp.cli.client import chat_client

    room_id = room or client_config.room_id
    if not room_id:
        click.echo("Error: No room specified. Use --room or set CHAT_MCP_ROOM_ID.", err=True)
        raise SystemExit(1)

    async def run():
        attachment_ids = []
        if attach:
            att = await chat_client.upload(f"/rooms/{room_id}/attachments", attach)
            attachment_ids.append(att["id"])

        resp = await chat_client.post(f"/rooms/{room_id}/messages", json={
            "content_text": message,
            "content_format": "markdown",
            "thread_id": thread,
            "mentions": list(mention),
            "attachment_ids": attachment_ids,
        })
        click.echo(f"[{resp['created_at'][:16]}] {resp['author_id'][:8]}: {resp['content']['text']}")
        await chat_client.close()

    asyncio.run(run())
