"""Tests for authentication endpoints."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_register_participant(client):
    resp = await client.post("/auth/register", json={
        "display_name": "alice",
        "type": "human",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "participant_id" in data
    assert len(data["participant_id"]) == 36  # UUID


@pytest.mark.asyncio
async def test_register_agent(client):
    # Register human first
    resp = await client.post("/auth/register", json={
        "display_name": "alice",
        "type": "human",
    })
    human_id = resp.json()["participant_id"]

    # Register agent paired with human
    resp = await client.post("/auth/register", json={
        "display_name": "agent-alice",
        "type": "agent",
        "paired_with": human_id,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "participant_id" in data


@pytest.mark.asyncio
async def test_challenge_no_key(client):
    # Register without public key
    resp = await client.post("/auth/register", json={
        "display_name": "bob",
        "type": "human",
    })
    pid = resp.json()["participant_id"]

    # Challenge should fail — no public key
    resp = await client.post("/auth/challenge", json={"participant_id": pid})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_challenge_not_found(client):
    resp = await client.post("/auth/challenge", json={
        "participant_id": "nonexistent-id",
    })
    assert resp.status_code == 404
