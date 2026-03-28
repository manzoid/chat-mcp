"""Edit and delete message commands."""

from __future__ import annotations

import asyncio

import click


@click.command()
@click.argument("message_id")
@click.argument("new_text")
def edit(message_id: str, new_text: str):
    """Edit a message you sent."""
    from chat_mcp.cli.client import chat_client

    async def run():
        msg = await chat_client.patch(f"/messages/{message_id}", json={
            "content_text": new_text,
            "content_format": "markdown",
        })
        click.echo(f"Edited #{message_id[:8]}: {msg['content']['text']}")
        await chat_client.close()

    asyncio.run(run())


@click.command("delete")
@click.argument("message_id")
def delete_msg(message_id: str):
    """Delete a message you sent."""
    from chat_mcp.cli.client import chat_client

    async def run():
        await chat_client.delete(f"/messages/{message_id}")
        click.echo(f"Deleted #{message_id[:8]}")
        await chat_client.close()

    asyncio.run(run())
