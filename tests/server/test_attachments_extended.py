"""Extended attachment tests."""

from __future__ import annotations

import io

import pytest


@pytest.mark.asyncio
async def test_attachment_metadata(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    content = b"print('hello world')"
    files = {"file": ("hello.py", io.BytesIO(content), "text/x-python")}
    resp = await client.post(f"/rooms/{room_id}/attachments", headers=headers, files=files)
    assert resp.status_code == 200
    att = resp.json()

    assert att["filename"] == "hello.py"
    assert att["size_bytes"] == len(content)
    assert att["mime_type"] == "text/x-python"
    assert att["metadata"]["checksum"] is not None


@pytest.mark.asyncio
async def test_attachment_not_found(client, room_and_participant):
    _, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.get("/attachments/nonexistent/metadata", headers=headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_non_participant_cannot_upload(client, room_and_participant):
    room_id, _ = room_and_participant

    resp = await client.post("/auth/register", json={"display_name": "outsider"})
    outsider_id = resp.json()["participant_id"]

    files = {"file": ("test.txt", io.BytesIO(b"nope"), "text/plain")}
    resp = await client.post(
        f"/rooms/{room_id}/attachments",
        headers={"X-Participant-ID": outsider_id},
        files=files,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_binary_attachment(client, room_and_participant):
    """Binary files should be stored and retrieved correctly."""
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    # Create some binary data
    binary_data = bytes(range(256)) * 10
    files = {"file": ("data.bin", io.BytesIO(binary_data), "application/octet-stream")}
    resp = await client.post(f"/rooms/{room_id}/attachments", headers=headers, files=files)
    assert resp.status_code == 200
    att_id = resp.json()["id"]

    # Download and verify
    resp = await client.get(f"/attachments/{att_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.content == binary_data
