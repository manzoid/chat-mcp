"""Auth CLI commands: register, login."""

from __future__ import annotations

import asyncio

import click


@click.command()
@click.argument("display_name")
@click.option("--type", "ptype", default="human", help="Participant type (human or agent)")
@click.option("--public-key", default=None, help="SSH public key string")
def register(display_name: str, ptype: str, public_key: str | None):
    """Register a new participant."""
    from chat_mcp.cli.auth import register as do_register

    async def run():
        pid = await do_register(display_name, public_key, ptype)
        click.echo(f"Registered as {pid}")

    asyncio.run(run())


@click.command()
def login():
    """Authenticate with the server using SSH key."""
    from chat_mcp.cli.auth import login as do_login

    async def run():
        token = await do_login()
        click.echo(f"Logged in. Token stored.")

    asyncio.run(run())
