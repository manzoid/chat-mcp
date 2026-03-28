"""Reaction commands."""

from __future__ import annotations

import asyncio

import click


@click.command()
@click.argument("message_id")
@click.argument("emoji")
def react(message_id: str, emoji: str):
    """Add a reaction to a message."""
    from chat_mcp.cli.client import chat_client

    async def run():
        await chat_client.post(f"/messages/{message_id}/reactions", json={"emoji": emoji})
        click.echo(f"Reacted {emoji} to {message_id[:8]}")
        await chat_client.close()

    asyncio.run(run())


@click.command()
@click.argument("message_id")
@click.argument("emoji")
def unreact(message_id: str, emoji: str):
    """Remove a reaction from a message."""
    from chat_mcp.cli.client import chat_client

    async def run():
        await chat_client.delete(f"/messages/{message_id}/reactions/{emoji}")
        click.echo(f"Removed {emoji} from {message_id[:8]}")
        await chat_client.close()

    asyncio.run(run())
