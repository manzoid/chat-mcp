"""Tests for CLI command parsing and configuration."""

from __future__ import annotations

import pytest
from click.testing import CliRunner

from chat_mcp.cli.main import cli


def test_cli_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "chat-mcp" in result.output


def test_cli_send_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["send", "--help"])
    assert result.exit_code == 0
    assert "--room" in result.output
    assert "--thread" in result.output
    assert "--mention" in result.output
    assert "--attach" in result.output


def test_cli_read_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["read", "--help"])
    assert result.exit_code == 0
    assert "--last" in result.output
    assert "--since" in result.output
    assert "--thread" in result.output


def test_cli_rooms_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["rooms", "--help"])
    assert result.exit_code == 0


def test_cli_search_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["search", "--help"])
    assert result.exit_code == 0
    assert "--author" in result.output


def test_cli_react_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["react", "--help"])
    assert result.exit_code == 0


def test_cli_register_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["register", "--help"])
    assert result.exit_code == 0
    assert "--type" in result.output


def test_cli_watch_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["watch", "--help"])
    assert result.exit_code == 0
    assert "--since" in result.output


def test_cli_pin_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["pin", "--help"])
    assert result.exit_code == 0


def test_cli_status_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["status", "--help"])
    assert result.exit_code == 0


def test_cli_who_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["who", "--help"])
    assert result.exit_code == 0


def test_cli_attach_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["attach", "--help"])
    assert result.exit_code == 0


def test_cli_download_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["download", "--help"])
    assert result.exit_code == 0


def test_cli_edit_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["edit", "--help"])
    assert result.exit_code == 0


def test_cli_delete_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["delete", "--help"])
    assert result.exit_code == 0


def test_all_subcommands_registered():
    """Ensure all expected subcommands are registered."""
    expected = {
        "send", "read", "react", "unreact", "rooms", "join", "create-room",
        "topic", "search", "status", "who", "pin", "unpin", "pins",
        "attach", "download", "edit", "delete", "watch", "register", "login",
    }
    actual = set(cli.commands.keys())
    assert expected.issubset(actual), f"Missing commands: {expected - actual}"
