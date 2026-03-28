"""Room management commands."""

from __future__ import annotations

import asyncio

import click

from chat_mcp.cli.config import client_config


@click.command("rooms")
def list_rooms():
    """List rooms you belong to."""
    from chat_mcp.cli.client import chat_client

    async def run():
        rooms = await chat_client.get("/rooms")
        for r in rooms:
            topic = f" - {r['topic']}" if r.get("topic") else ""
            click.echo(f"#{r['name']} ({r['id'][:8]}){topic}  [{len(r.get('participants', []))} members]")
        await chat_client.close()

    asyncio.run(run())


@click.command("join")
@click.argument("room_id")
def join_room(room_id: str):
    """Join a room."""
    from chat_mcp.cli.client import chat_client

    async def run():
        await chat_client.post(f"/rooms/{room_id}/join")
        click.echo(f"Joined room {room_id[:8]}")
        await chat_client.close()

    asyncio.run(run())


@click.command("create-room")
@click.argument("name")
@click.option("--topic", default=None, help="Room topic")
@click.option("--invite", multiple=True, help="Participant IDs to invite")
def create_room(name: str, topic: str | None, invite: tuple):
    """Create a new room."""
    from chat_mcp.cli.client import chat_client

    async def run():
        resp = await chat_client.post("/rooms", json={
            "name": name,
            "topic": topic,
            "participants": list(invite),
        })
        room_id = resp["id"]
        click.echo(f"Created room #{name} ({room_id[:8]})")

        # Optionally set as default
        client_config.room_id = room_id
        client_config.save()
        click.echo(f"Set as default room.")
        await chat_client.close()

    asyncio.run(run())


@click.command("topic")
@click.argument("topic_text")
@click.option("--room", default=None, help="Room ID")
def set_topic(topic_text: str, room: str | None):
    """Set the room topic."""
    from chat_mcp.cli.client import chat_client

    room_id = room or client_config.room_id
    if not room_id:
        click.echo("Error: No room specified.", err=True)
        raise SystemExit(1)

    async def run():
        await chat_client.post(f"/rooms/{room_id}/topic", json={"topic": topic_text})
        click.echo(f"Topic set to: {topic_text}")
        await chat_client.close()

    asyncio.run(run())
