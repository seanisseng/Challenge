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

# One unresponsive phone must not stall the room. Sends run concurrently, so
# this bounds the whole fan-out rather than each socket.
SEND_TIMEOUT = 5.0


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

    async def close_room(self, session_id: str) -> None:
        """Disconnect a deleted session without rebuilding its missing snapshot."""
        async def close(sub: Subscriber) -> None:
            try:
                await asyncio.wait_for(sub.ws.close(), timeout=1.0)
            except Exception:
                log.debug("could not close deleted session subscriber", exc_info=True)
            finally:
                await self.unregister(sub)

        await asyncio.gather(*(close(sub) for sub in self._room(session_id)))

    async def _send(self, sub: Subscriber, payload: dict[str, Any]) -> None:
        try:
            await asyncio.wait_for(sub.ws.send_json(payload), timeout=SEND_TIMEOUT)
            return
        except Exception:
            log.debug("dropping dead subscriber", exc_info=True)

        # Close the socket so the client notices and reconnects. Dropping it from
        # the hub alone would leave that screen frozen on stale data forever.
        try:
            await asyncio.wait_for(sub.ws.close(), timeout=1.0)
        except Exception:
            pass
        await self.unregister(sub)

    async def broadcast(self, session_id: str) -> None:
        """Rebuild and push a snapshot to everyone watching this session.

        The room is read once and every device gets a slice of that read. A
        device that is slow, gone, or throws while its payload is assembled is
        dropped on its own; it never takes the rest of the room down with it.
        """
        room = self._room(session_id)
        if not room:
            return

        try:
            data = await asyncio.to_thread(snapshots.room_data, session_id)
        except Exception:
            log.exception("failed to build snapshot for session %s", session_id)
            return

        payloads: list[tuple[Subscriber, dict[str, Any]]] = []
        for sub in room:
            try:
                if sub.kind == "admin":
                    payload = snapshots.admin_payload(sub.session_id, room=data)
                elif sub.member is not None:
                    payload = snapshots.team_payload(sub.member, room=data)
                else:
                    continue
            except Exception:
                log.exception("failed to build payload for a %s subscriber", sub.kind)
                continue
            payloads.append((sub, payload))

        if payloads:
            await asyncio.gather(*(self._send(sub, payload) for sub, payload in payloads))


hub = Hub()
