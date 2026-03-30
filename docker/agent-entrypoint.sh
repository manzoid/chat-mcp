#!/usr/bin/env bash
set -euo pipefail

# --- Validate required env vars ---
: "${CHAT_PARTICIPANT_ID:?CHAT_PARTICIPANT_ID is required}"
: "${CHAT_ROOMS:?CHAT_ROOMS is required}"

CHAT_SERVER_URL="${CHAT_SERVER_URL:-http://host.docker.internal:8808}"
CHAT_SSH_KEY_PATH="${CHAT_SSH_KEY_PATH:-/keys/key}"

if [ ! -f "$CHAT_SSH_KEY_PATH" ]; then
  echo "ERROR: SSH key not found at $CHAT_SSH_KEY_PATH" >&2
  exit 1
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ERROR: ANTHROPIC_API_KEY not set" >&2
  exit 1
fi

# --- Wait for chat server to be healthy ---
echo "Waiting for chat server at $CHAT_SERVER_URL ..." >&2
attempts=0
max_attempts=30
until curl -sf "$CHAT_SERVER_URL/health" > /dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge "$max_attempts" ]; then
    echo "ERROR: Chat server not reachable after ${max_attempts}s" >&2
    exit 1
  fi
  sleep 1
done
echo "Chat server is ready." >&2

# --- Write MCP config for the channel plugin ---
MCP_CONFIG="/opt/chat-mcp/mcp-agent.json"
cat > "$MCP_CONFIG" << EOF
{
  "mcpServers": {
    "chat-mcp": {
      "command": "node",
      "args": ["/opt/chat-mcp/packages/channel-plugin/dist/index.js"],
      "env": {
        "CHAT_SERVER_URL": "${CHAT_SERVER_URL}",
        "CHAT_PARTICIPANT_ID": "${CHAT_PARTICIPANT_ID}",
        "CHAT_SSH_KEY_PATH": "${CHAT_SSH_KEY_PATH}",
        "CHAT_ROOMS": "${CHAT_ROOMS}"
      }
    }
  }
}
EOF

# Also write to global settings as fallback for MCP discovery
mkdir -p "$HOME/.claude"
cp "$MCP_CONFIG" "$HOME/.claude/settings.json"

# --- Export env vars for any tools that read them directly ---
export CHAT_SERVER_URL
export CHAT_PARTICIPANT_ID
export CHAT_SSH_KEY_PATH
export CHAT_ROOMS

# --- Launch Claude Code ---
cd /workspace
exec claude \
  --dangerously-skip-permissions \
  --dangerously-load-development-channels server:chat-mcp \
  --mcp-config "$MCP_CONFIG" \
  "$@"
