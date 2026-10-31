"""In-process WebSocket fan-out.

One room per game session. Any mutation calls ``hub.broadcast(session_id)``
and every connected device -- players and the admin console -- receives a
freshly rebuilt snapshot tailored to what it is allowed to see.

This keeps the whole app push-driven without needing a JWT: Supabase Realtime
cannot filter rows per team without an authenticated identity, so the backend
does the filtering and pushes instead.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

from app import snapshots

log = logging.getLogger(__name__)


@dataclass(eq=False)
class Subscriber:
    ws: WebSocket
    session_id: str
    kind: str  # "team" | "admin"
    member: dict[str, Any] | None = field(default=None)

    @property
    def team_id(self) -> str | None:
        return self.member["team"]["id"] if self.member else None


class Hub:
    def __init__(self) -> None:
        self._subs: set[Subscriber] = set()
        self._lock = asyncio.Lock()

    async def register(self, sub: Subscriber) -> None:
        async with self._lock:
            self._subs.add(sub)

    async def unregister(self, sub: Subscriber) -> None:
        async with self._lock:
            self._subs.discard(sub)

    def _room(self, session_id: str) -> list[Subscriber]:
        return [s for s in self._subs if s.session_id == session_id]

    def presence(self, session_id: str) -> int:
        return len(self._room(session_id))

    async def broadcast(self, session_id: str) -> None:
        """Rebuild and push a snapshot to everyone watching this session."""
        room = self._room(session_id)
        if not room:
            return

        try:
            core = await asyncio.to_thread(snapshots.session_core, session_id)
        except Exception:
            log.exception("failed to build snapshot for session %s", session_id)
            return

        for sub in room:
            try:
                if sub.kind == "admin":
                    payload = await asyncio.to_thread(
                        snapshots.admin_payload, session_id, core
                    )
                elif sub.member is not None:
                    payload = await asyncio.to_thread(
                        snapshots.team_payload, sub.member, core
                    )
                else:
                    continue
                await sub.ws.send_json(payload)
            except Exception:
                log.debug("dropping dead subscriber", exc_info=True)
                await self.unregister(sub)


hub = Hub()
