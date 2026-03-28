"""Attachment commands."""

from __future__ import annotations

import asyncio

import click

from chat_mcp.cli.config import client_config


@click.command()
@click.argument("filepath")
@click.option("--room", default=None, help="Room ID")
def attach(filepath: str, room: str | None):
    """Upload a file attachment."""
    from chat_mcp.cli.client import chat_client

    room_id = room or client_config.room_id
    if not room_id:
        click.echo("Error: No room specified.", err=True)
        raise SystemExit(1)

    async def run():
        att = await chat_client.upload(f"/rooms/{room_id}/attachments", filepath)
        click.echo(f"Uploaded: {att['filename']} ({att['size_bytes']}B) [{att['id'][:8]}]")
        await chat_client.close()

    asyncio.run(run())


@click.command()
@click.argument("attachment_id")
@click.option("--output", "-o", default=None, help="Output file path")
def download(attachment_id: str, output: str | None):
    """Download an attachment."""
    import httpx
    from chat_mcp.cli.client import chat_client

    async def run():
        # Get metadata first
        meta = await chat_client.get(f"/attachments/{attachment_id}/metadata")
        out_path = output or meta["filename"]

        # Download the file
        from chat_mcp.cli.config import client_config as cfg
        headers = {}
        if cfg.participant_id:
            headers["X-Participant-ID"] = cfg.participant_id
        token = cfg.token
        if token:
            headers["Authorization"] = f"Bearer {token}"

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{cfg.server_url}/attachments/{attachment_id}",
                headers=headers,
            )
            resp.raise_for_status()
            with open(out_path, "wb") as f:
                f.write(resp.content)

        click.echo(f"Downloaded: {out_path} ({meta['size_bytes']}B)")

    asyncio.run(run())
