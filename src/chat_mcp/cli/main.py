"""CLI entry point — the `chat` command."""

from __future__ import annotations

import click

from chat_mcp.cli.config import client_config


@click.group()
def cli():
    """chat-mcp: Multi-agent collaborative chat."""
    client_config.load()


# Auth
from chat_mcp.cli.commands.auth_cmd import register, login
cli.add_command(register)
cli.add_command(login)

# Messaging
from chat_mcp.cli.commands.send import send
from chat_mcp.cli.commands.read import read
from chat_mcp.cli.commands.edit import edit, delete_msg
cli.add_command(send)
cli.add_command(read)
cli.add_command(edit)
cli.add_command(delete_msg)

# Reactions
from chat_mcp.cli.commands.react import react, unreact
cli.add_command(react)
cli.add_command(unreact)

# Rooms
from chat_mcp.cli.commands.room import list_rooms, join_room, create_room, set_topic
cli.add_command(list_rooms)
cli.add_command(join_room)
cli.add_command(create_room)
cli.add_command(set_topic)

# Search
from chat_mcp.cli.commands.search import search
cli.add_command(search)

# Status & presence
from chat_mcp.cli.commands.status import status, who
cli.add_command(status)
cli.add_command(who)

# Pins
from chat_mcp.cli.commands.pin import pin, unpin, list_pins
cli.add_command(pin)
cli.add_command(unpin)
cli.add_command(list_pins)

# Attachments
from chat_mcp.cli.commands.attach import attach, download
cli.add_command(attach)
cli.add_command(download)

# Watch (SSE)
from chat_mcp.cli.commands.watch import watch
cli.add_command(watch)


if __name__ == "__main__":
    cli()
