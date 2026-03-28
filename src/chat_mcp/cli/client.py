"""HTTP client wrapper for the chat-mcp server."""

from __future__ import annotations

from typing import Any, AsyncGenerator, Optional

import httpx

from chat_mcp.cli.config import client_config


def _headers() -> dict[str, str]:
    headers = {}
    token = client_config.token
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if client_config.participant_id:
        headers["X-Participant-ID"] = client_config.participant_id
    return headers


def _url(path: str) -> str:
    return f"{client_config.server_url}{path}"


class ChatClient:
    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def get(self, path: str, params: dict | None = None) -> dict | list:
        client = await self._get_client()
        resp = await client.get(_url(path), headers=_headers(), params=params)
        resp.raise_for_status()
        return resp.json()

    async def post(self, path: str, json: dict | None = None, **kwargs) -> dict:
        client = await self._get_client()
        resp = await client.post(_url(path), headers=_headers(), json=json, **kwargs)
        resp.raise_for_status()
        return resp.json()

    async def patch(self, path: str, json: dict) -> dict:
        client = await self._get_client()
        resp = await client.patch(_url(path), headers=_headers(), json=json)
        resp.raise_for_status()
        return resp.json()

    async def delete(self, path: str) -> dict:
        client = await self._get_client()
        resp = await client.delete(_url(path), headers=_headers())
        resp.raise_for_status()
        return resp.json()

    async def upload(self, path: str, filepath: str) -> dict:
        client = await self._get_client()
        import os
        filename = os.path.basename(filepath)
        with open(filepath, "rb") as f:
            files = {"file": (filename, f)}
            resp = await client.post(_url(path), headers=_headers(), files=files)
        resp.raise_for_status()
        return resp.json()

    async def stream_sse(self, path: str, params: dict | None = None) -> AsyncGenerator[dict, None]:
        """Stream SSE events from the server."""
        import json
        client = await self._get_client()
        async with client.stream("GET", _url(path), headers=_headers(), params=params) as resp:
            resp.raise_for_status()
            buffer = ""
            async for chunk in resp.aiter_text():
                buffer += chunk
                while "\n\n" in buffer:
                    event_str, buffer = buffer.split("\n\n", 1)
                    data_line = None
                    for line in event_str.strip().split("\n"):
                        if line.startswith("data:"):
                            data_line = line[5:].strip()
                        elif line.startswith("data: "):
                            data_line = line[6:]
                    if data_line:
                        try:
                            yield json.loads(data_line)
                        except json.JSONDecodeError:
                            pass


chat_client = ChatClient()
