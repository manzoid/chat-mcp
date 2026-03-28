"""Chat message list widget."""

from __future__ import annotations

from textual.widgets import RichLog


class ChatView(RichLog):
    """Scrollable view of chat messages."""

    def set_messages(self, messages: list[dict]) -> None:
        """Replace all messages."""
        self.clear()
        for msg in messages:
            self._render_message(msg)

    def add_message(self, msg: dict) -> None:
        """Append a new message."""
        self._render_message(msg)

    def _render_message(self, msg: dict) -> None:
        ts = msg.get("created_at", "")[:16]
        author = msg.get("author_id", "?")[:8]
        content = msg.get("content", {})
        text = content.get("text", "") if isinstance(content, dict) else str(content)
        mid = msg.get("id", "?")[:8]

        line = f"[dim]{ts}[/dim] [bold]{author}[/bold]: {text}"

        # Reactions
        reactions = msg.get("reactions", [])
        if reactions:
            emojis = " ".join(r["emoji"] for r in reactions)
            line += f"  [dim][{emojis}][/dim]"

        # Attachments
        for att in msg.get("attachments", []):
            line += f"\n  [italic][{att.get('filename', '?')} {att.get('size_bytes', 0)}B][/italic]"

        if msg.get("edited_at"):
            line += " [dim](edited)[/dim]"

        self.write(line)
