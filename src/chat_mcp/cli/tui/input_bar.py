"""Message input widget."""

from __future__ import annotations

from dataclasses import dataclass

from textual.message import Message
from textual.widgets import Input


class InputBar(Input):
    """Text input for composing messages."""

    @dataclass
    class Submit(Message):
        text: str

    def __init__(self, **kwargs):
        super().__init__(placeholder="Type a message... (Enter to send)", **kwargs)

    async def action_submit(self) -> None:
        text = self.value.strip()
        if text:
            self.post_message(self.Submit(text=text))
            self.value = ""
