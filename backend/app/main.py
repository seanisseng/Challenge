"""FastAPI application entrypoint.

Currently a health-check stub. Feature routers (sessions, challenges,
submissions, clues) will be added on top of the database layer.
"""

from __future__ import annotations

from fastapi import FastAPI

from app.config import get_settings

settings = get_settings()

app = FastAPI(
    title="Challenge — Scavenger Hunt API",
    version="0.1.0",
    description="Backend for the real-time competitive scavenger hunt.",
)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    """Liveness probe."""
    return {"status": "ok"}


@app.get("/", tags=["meta"])
def root() -> dict[str, str]:
    """Root banner."""
    return {"service": "scavenger-hunt-api", "docs": "/docs"}
