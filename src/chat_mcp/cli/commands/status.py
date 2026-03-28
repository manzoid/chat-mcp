"""Status and presence commands."""

from __future__ import annotations

import asyncio

import click

from chat_mcp.cli.config import client_config


@click.command()
@click.argument("state_or_description")
@click.option("--room", default=None, help="Room ID for 'who' display")
def status(state_or_description: str, room: str | None):
    """Set your status. Use 'online', 'away', 'busy', 'offline', or a description."""
    from chat_mcp.cli.client import chat_client

    known_states = {"online", "away", "busy", "offline"}

    async def run():
        if state_or_description in known_states:
            await chat_client.post("/participants/me/status", json={
                "state": state_or_description,
            })
            click.echo(f"Status: {state_or_description}")
        else:
            await chat_client.post("/participants/me/status", json={
                "state": "online",
                "description": state_or_description,
            })
            click.echo(f"Status: {state_or_description}")
        await chat_client.close()

    asyncio.run(run())


@click.command()
@click.option("--room", default=None, help="Room ID")
def who(room: str | None):
    """Show participants in the room."""
    from chat_mcp.cli.client import chat_client

    room_id = room or client_config.room_id
    if not room_id:
        click.echo("Error: No room specified.", err=True)
        raise SystemExit(1)

    async def run():
        participants = await chat_client.get(f"/rooms/{room_id}/participants")
        for p in participants:
            ptype = f" ({p['type']})" if p["type"] == "agent" else ""
            status_str = p.get("status", {}).get("state", "unknown")
            desc = p.get("status", {}).get("description")
            if desc:
                status_str += f" - {desc}"
            click.echo(f"  {p['display_name']}{ptype}  [{status_str}]")
        await chat_client.close()

    asyncio.run(run())
