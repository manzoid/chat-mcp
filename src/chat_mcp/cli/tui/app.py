"""Textual TUI application for interactive chat mode."""

from __future__ import annotations

import asyncio
import json
from typing import Optional

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.widgets import Footer, Header

from chat_mcp.cli.tui.chat_view import ChatView
from chat_mcp.cli.tui.input_bar import InputBar
from chat_mcp.cli.tui.sidebar import Sidebar
from chat_mcp.cli.config import client_config


class ChatApp(App):
    """Interactive chat TUI."""

    CSS = """
    Screen {
        layout: horizontal;
    }

    #sidebar {
        width: 25;
        dock: left;
        border-right: solid $accent;
    }

    #main {
        width: 1fr;
    }

    #chat-view {
        height: 1fr;
    }

    #input-bar {
        height: 3;
        dock: bottom;
        border-top: solid $accent;
    }
    """

    BINDINGS = [
        Binding("ctrl+q", "quit", "Quit"),
        Binding("ctrl+r", "refresh", "Refresh"),
    ]

    TITLE = "chat-mcp"

    def __init__(self, room_id: str | None = None, server_url: str | None = None):
        super().__init__()
        self.room_id = room_id or client_config.room_id
        self.server_url = server_url or client_config.server_url
        self._sse_task: Optional[asyncio.Task] = None

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal():
            yield Sidebar(id="sidebar")
            with Vertical(id="main"):
                yield ChatView(id="chat-view")
                yield InputBar(id="input-bar")
        yield Footer()

    async def on_mount(self) -> None:
        self.sub_title = f"#{self.room_id[:8] if self.room_id else 'no room'}"
        if self.room_id:
            await self._load_messages()
            self._sse_task = asyncio.create_task(self._watch_events())

    async def _load_messages(self) -> None:
        """Load recent messages from the server."""
        from chat_mcp.cli.client import chat_client

        try:
            messages = await chat_client.get(
                f"/rooms/{self.room_id}/messages",
                params={"limit": 50},
            )
            chat_view = self.query_one("#chat-view", ChatView)
            chat_view.set_messages(messages)
        except Exception as e:
            self.notify(f"Failed to load messages: {e}", severity="error")

    async def _watch_events(self) -> None:
        """Watch for new events via SSE."""
        from chat_mcp.cli.client import chat_client

        try:
            async for event in chat_client.stream_sse(
                f"/rooms/{self.room_id}/events",
                params={"since_seq": 0},
            ):
                etype = event.get("type", "")
                payload = event.get("payload", {})

                if etype == "message.created":
                    chat_view = self.query_one("#chat-view", ChatView)
                    chat_view.add_message(payload)
                elif etype == "participant.joined":
                    sidebar = self.query_one("#sidebar", Sidebar)
                    await sidebar.refresh_participants(self.room_id)
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    async def on_input_bar_submit(self, event) -> None:
        """Handle message submission from input bar."""
        from chat_mcp.cli.client import chat_client

        text = event.text.strip()
        if not text or not self.room_id:
            return

        try:
            await chat_client.post(f"/rooms/{self.room_id}/messages", json={
                "content_text": text,
                "content_format": "markdown",
            })
        except Exception as e:
            self.notify(f"Send failed: {e}", severity="error")

    def action_refresh(self) -> None:
        if self.room_id:
            asyncio.create_task(self._load_messages())

    async def on_unmount(self) -> None:
        if self._sse_task:
            self._sse_task.cancel()
        from chat_mcp.cli.client import chat_client
        await chat_client.close()
