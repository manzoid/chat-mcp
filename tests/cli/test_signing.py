"""Tests for CLI signing utilities."""

from __future__ import annotations

import pytest

from chat_mcp.cli.signing import SigningError


def test_signing_error_bad_key():
    """Test that signing with a nonexistent key raises SigningError."""
    from chat_mcp.cli.signing import ssh_sign

    with pytest.raises(SigningError, match="SSH key not found"):
        ssh_sign(b"test payload", key_path="/nonexistent/key")
