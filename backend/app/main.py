"""FastAPI application entrypoint.

Kahoot-style: there are no user accounts. The host signs in with a PIN, opens
a session with a fixed number of teams, and each team redeems its own join
code. Every browser request is mediated here -- the frontend never talks to
Supabase directly.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.map_runtime import map_runtime
from app.realtime import hub
from app.media_cleanup import media_cleanup
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import admin, play, ws, maps

settings = get_settings()

@asynccontextmanager
async def lifespan(app: FastAPI):
    await map_runtime.start()
    await hub.start()
    await media_cleanup.start()
    try:yield
    finally:
        await media_cleanup.close()
        await hub.close()
        await map_runtime.close()


app = FastAPI(
    lifespan=lifespan,
    title="Challenge — Scavenger Hunt API",
    version="0.2.0",
    description="Real-time competitive scavenger hunt with team join codes.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin.public_router)
app.include_router(admin.router)
app.include_router(play.router)
app.include_router(ws.router)
app.include_router(maps.admin)
app.include_router(maps.players)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    """Liveness probe."""
    return {"status": "ok"}


@app.get("/", tags=["meta"])
def root() -> dict[str, str]:
    """Root banner."""
    return {"service": "scavenger-hunt-api", "docs": "/docs"}
