"""SQLite database setup, connection management, and migrations."""

from __future__ import annotations

import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator, Optional

import aiosqlite

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent.parent.parent / "migrations"

_db_path: str = ":memory:"
# For in-memory DBs we keep a single shared connection to avoid separate databases
_shared_conn: Optional[aiosqlite.Connection] = None


def set_db_path(path: str) -> None:
    global _db_path, _shared_conn
    _db_path = path
    _shared_conn = None


async def get_db() -> aiosqlite.Connection:
    global _shared_conn
    if _db_path == ":memory:":
        if _shared_conn is None:
            raise RuntimeError("Database not initialized. Call init_db() first.")
        return _shared_conn

    db = await aiosqlite.connect(_db_path)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


@asynccontextmanager
async def get_db_context() -> AsyncGenerator[aiosqlite.Connection, None]:
    if _db_path == ":memory:":
        db = await get_db()
        yield db
        # Don't close the shared connection
    else:
        db = await get_db()
        try:
            yield db
        finally:
            await db.close()


async def run_migrations(db: aiosqlite.Connection) -> None:
    """Run all SQL migration files in order."""
    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    for migration_file in migration_files:
        sql = migration_file.read_text()
        await db.executescript(sql)
    await db.commit()


async def init_db(db_path: str = ":memory:") -> None:
    """Initialize database with schema."""
    global _db_path, _shared_conn

    _db_path = db_path

    if db_path == ":memory:":
        # Close previous shared connection if any
        if _shared_conn is not None:
            try:
                await _shared_conn.close()
            except Exception:
                pass

        _shared_conn = await aiosqlite.connect(":memory:")
        _shared_conn.row_factory = aiosqlite.Row
        await _shared_conn.execute("PRAGMA foreign_keys=ON")
        await run_migrations(_shared_conn)
    else:
        async with aiosqlite.connect(db_path) as db:
            db.row_factory = aiosqlite.Row
            await db.execute("PRAGMA journal_mode=WAL")
            await db.execute("PRAGMA foreign_keys=ON")
            await run_migrations(db)
