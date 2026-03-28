"""Pin commands."""

from __future__ import annotations

import asyncio

import click

from chat_mcp.cli.config import client_config


@click.command()
@click.argument("message_id")
@click.option("--room", default=None, help="Room ID")
def pin(message_id: str, room: str | None):
    """Pin a message."""
    from chat_mcp.cli.client import chat_client

    room_id = room or client_config.room_id
    if not room_id:
        click.echo("Error: No room specified.", err=True)
        raise SystemExit(1)

    async def run():
        await chat_client.post(f"/rooms/{room_id}/messages/pin/{message_id}")
        click.echo(f"Pinned message {message_id[:8]}")
        await chat_client.close()

    asyncio.run(run())


@click.command()
@click.argument("message_id")
@click.option("--room", default=None, help="Room ID")
def unpin(message_id: str, room: str | None):
    """Unpin a message."""
    from chat_mcp.cli.client import chat_client

    room_id = room or client_config.room_id
    if not room_id:
        click.echo("Error: No room specified.", err=True)
        raise SystemExit(1)

    async def run():
        await chat_client.delete(f"/rooms/{room_id}/messages/pin/{message_id}")
        click.echo(f"Unpinned message {message_id[:8]}")
        await chat_client.close()

    asyncio.run(run())


@click.command("pins")
@click.option("--room", default=None, help="Room ID")
def list_pins(room: str | None):
    """List pinned messages."""
    from chat_mcp.cli.client import chat_client

    room_id = room or client_config.room_id
    if not room_id:
        click.echo("Error: No room specified.", err=True)
        raise SystemExit(1)

    async def run():
        pins = await chat_client.get(f"/rooms/{room_id}/pins")
        for msg in pins:
            click.echo(f"#{msg['id'][:8]} [{msg['created_at'][:16]}] {msg['author_id'][:8]}: {msg['content']['text']}")
        if not pins:
            click.echo("No pinned messages.")
        await chat_client.close()

    asyncio.run(run())
