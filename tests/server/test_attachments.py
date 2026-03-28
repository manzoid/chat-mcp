"""Tests for attachment endpoints."""

from __future__ import annotations

import io

import pytest


@pytest.mark.asyncio
async def test_upload_and_download_attachment(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    # Upload
    file_content = b"hello world test content"
    files = {"file": ("test.txt", io.BytesIO(file_content), "text/plain")}
    resp = await client.post(
        f"/rooms/{room_id}/attachments", headers=headers, files=files
    )
    assert resp.status_code == 200
    att = resp.json()
    assert att["filename"] == "test.txt"
    assert att["size_bytes"] == len(file_content)
    att_id = att["id"]

    # Get metadata
    resp = await client.get(f"/attachments/{att_id}/metadata", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["filename"] == "test.txt"

    # Download
    resp = await client.get(f"/attachments/{att_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.content == file_content
