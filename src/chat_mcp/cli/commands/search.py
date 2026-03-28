"""Search command."""

from __future__ import annotations

import asyncio

import click

from chat_mcp.cli.config import client_config


@click.command()
@click.argument("query")
@click.option("--room", default=None, help="Room ID")
@click.option("--author", default=None, help="Filter by author ID")
def search(query: str, room: str | None, author: str | None):
    """Search messages."""
    from chat_mcp.cli.client import chat_client

    room_id = room or client_config.room_id
    if not room_id:
        click.echo("Error: No room specified.", err=True)
        raise SystemExit(1)

    async def run():
        params = {"q": query}
        if author:
            params["author"] = author

        messages = await chat_client.get(f"/rooms/{room_id}/messages/search", params=params)
        for msg in messages:
            ts = msg["created_at"][:16]
            aid = msg["author_id"][:8]
            text = msg["content"]["text"]
            click.echo(f"#{msg['id'][:8]} [{ts}] {aid}: {text}")

        if not messages:
            click.echo("No results found.")
        await chat_client.close()

    asyncio.run(run())
