"""FastAPI application entrypoint.

Kahoot-style: there are no user accounts. The host signs in with a PIN, opens
a session with a fixed number of teams, and each team redeems its own join
code. Every browser request is mediated here -- the frontend never talks to
Supabase directly.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import admin, play, ws

settings = get_settings()

app = FastAPI(
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


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    """Liveness probe."""
    return {"status": "ok"}


@app.get("/", tags=["meta"])
def root() -> dict[str, str]:
    """Root banner."""
    return {"service": "scavenger-hunt-api", "docs": "/docs"}
