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

# --- Seed from host config on first run; persistent volume keeps auth after /login ---
# ~/.claude is a named volume. On first run it's empty, so seed from host.
# On subsequent runs it already has the OAuth token from /login.
if [ -d "$HOME/.claude-host" ] && [ ! -f "$HOME/.claude/.seeded" ]; then
  cp -a "$HOME/.claude-host/." "$HOME/.claude/"
  touch "$HOME/.claude/.seeded"
fi
# ~/.claude.json: use volume copy if it exists (has OAuth token), else seed from host
CLAUDE_JSON_VOL="$HOME/.claude-json-vol/.claude.json"
if [ -f "$CLAUDE_JSON_VOL" ]; then
  cp "$CLAUDE_JSON_VOL" "$HOME/.claude.json"
elif [ -f "$HOME/.claude.json.host" ]; then
  cp "$HOME/.claude.json.host" "$HOME/.claude.json"
fi
if [ -f "$HOME/.claude/settings.json" ]; then
  node -e "
    const fs = require('fs');
    const settings = JSON.parse(fs.readFileSync('$HOME/.claude/settings.json', 'utf8'));
    const mcp = JSON.parse(fs.readFileSync('$MCP_CONFIG', 'utf8'));
    settings.mcpServers = { ...settings.mcpServers, ...mcp.mcpServers };
    fs.writeFileSync('$HOME/.claude/settings.json', JSON.stringify(settings, null, 2) + '\n');
  "
else
  cp "$MCP_CONFIG" "$HOME/.claude/settings.json"
fi

# --- Export env vars for any tools that read them directly ---
export CHAT_SERVER_URL
export CHAT_PARTICIPANT_ID
export CHAT_SSH_KEY_PATH
export CHAT_ROOMS

# --- Launch Claude Code ---
cd /workspace
claude \
  --dangerously-skip-permissions \
  --dangerously-load-development-channels server:chat-mcp \
  --mcp-config "$MCP_CONFIG" \
  "$@"
STATUS=$?

# Persist .claude.json to volume on exit (saves OAuth token from /login)
cp -f "$HOME/.claude.json" "$CLAUDE_JSON_VOL" 2>/dev/null || true

exit $STATUS
