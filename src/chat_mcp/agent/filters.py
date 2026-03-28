"""Event relevance filtering for the agent runner."""

from __future__ import annotations

from chat_mcp.agent.config import AgentConfig


def is_relevant(event: dict, config: AgentConfig, paired_human_id: str | None = None) -> bool:
    """Determine if an SSE event is relevant to this agent.

    An event is relevant if any of these conditions are true:
    - config.all_messages is True
    - The agent is mentioned in the message
    - The paired human is mentioned in the message
    - The message contains any of the configured keywords
    - The event is a direct message (2-person room, implied by room setup)
    """
    event_type = event.get("type", "")
    payload = event.get("payload", {})

    # Only filter message.created; other events are always relevant
    if event_type != "message.created":
        return True

    # Don't react to our own messages
    author_id = payload.get("author_id", "")
    if author_id == config.participant_id:
        return False

    if config.all_messages:
        return True

    # Check mentions
    mentions = payload.get("mentions", [])
    if config.mention_me and config.participant_id in mentions:
        return True
    if config.mention_paired_human and paired_human_id and paired_human_id in mentions:
        return True

    # Check keywords in message text
    content = payload.get("content", {})
    text = content.get("text", "").lower() if isinstance(content, dict) else ""
    for keyword in config.keywords:
        if keyword.lower() in text:
            return True

    return False
