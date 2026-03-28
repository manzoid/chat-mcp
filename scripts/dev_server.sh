#!/bin/bash
# Quick start for development
set -e

echo "Starting chat-mcp server in development mode..."
export CHAT_MCP_HOST=127.0.0.1
export CHAT_MCP_PORT=8420
export CHAT_MCP_DB_PATH=chat_mcp_dev.db

python -m chat_mcp.server.app
