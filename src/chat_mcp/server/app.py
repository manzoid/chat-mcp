"""FastAPI application factory and entry point."""

from __future__ import annotations

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from chat_mcp.server.config import config
from chat_mcp.server.db import init_db
from chat_mcp.server.routes import (
    auth_routes,
    room_routes,
    message_routes,
    reaction_routes,
    attachment_routes,
    participant_routes,
    event_routes,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db(config.db_path)
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="chat-mcp",
        description="Multi-agent collaborative chat server",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.include_router(auth_routes.router)
    app.include_router(room_routes.router)
    app.include_router(message_routes.router)
    app.include_router(reaction_routes.router)
    app.include_router(attachment_routes.router)
    app.include_router(participant_routes.router)
    app.include_router(event_routes.router)

    @app.get("/health")
    async def health():
        return {"status": "ok", "version": "0.1.0"}

    return app


app = create_app()


def main():
    uvicorn.run(
        "chat_mcp.server.app:app",
        host=config.host,
        port=config.port,
        reload=True,
    )


if __name__ == "__main__":
    main()
