#!/usr/bin/env bash
# Runs as root to fix volume permissions, then drops to agent user.
set -euo pipefail

chown -R agent:agent /home/agent/.claude /home/agent/.claude-json-vol 2>/dev/null || true
chown agent:agent /workspace 2>/dev/null || true

exec su -s /bin/bash agent -c 'agent-entrypoint.sh "$@"' -- "$@"
