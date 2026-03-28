"""Sidebar widget showing rooms and participants."""

from __future__ import annotations

from textual.widgets import Static


class Sidebar(Static):
    """Sidebar showing room info and participants."""

    def __init__(self, **kwargs):
        super().__init__("Loading...", **kwargs)
        self._rooms: list[dict] = []
        self._participants: list[dict] = []

    async def on_mount(self) -> None:
        await self._load_rooms()

    async def _load_rooms(self) -> None:
        from chat_mcp.cli.client import chat_client

        try:
            self._rooms = await chat_client.get("/rooms")
            self._render()
        except Exception:
            self.update("[bold red]Error loading rooms[/]")

    async def refresh_participants(self, room_id: str) -> None:
        from chat_mcp.cli.client import chat_client

        try:
            self._participants = await chat_client.get(f"/rooms/{room_id}/participants")
            self._render()
        except Exception:
            pass

    def _render(self) -> None:
        lines = ["[bold]Rooms[/bold]"]
        for r in self._rooms:
            name = r.get("name", "?")
            lines.append(f"  #{name}")

        lines.append("")
        lines.append("[bold]People[/bold]")
        for p in self._participants:
            name = p.get("display_name", "?")
            ptype = " (bot)" if p.get("type") == "agent" else ""
            state = p.get("status", {}).get("state", "?")
            indicator = {"online": "[green]o[/]", "away": "[yellow]o[/]", "busy": "[red]o[/]"}.get(state, "[dim]o[/]")
            lines.append(f"  {indicator} {name}{ptype}")

        self.update("\n".join(lines))
