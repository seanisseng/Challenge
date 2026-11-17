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
import time
import secrets
from datetime import datetime
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
    location_device_id: str | None = None
    location_lease: str | None = None
    location_until: float = 0
    tracking_visible: bool = False

    @property
    def can_track(self) -> bool:
        return self.kind=='admin' or self.location_until>time.time()

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

    async def map_event(self, session_id: str, event: dict[str, Any], *, lease: str | None = None) -> None:
        """Only public map metadata; no game state or private finish in GPS fan-out."""
        point=event.get('location',event)
        async def deliver(sub:Subscriber):
            if sub.kind!='admin' and point.get('team_id')==sub.team_id and point.get('device_id')==sub.location_device_id:
                if event['kind']=='location_removed':sub.location_until=0
                elif lease:
                    sub.location_until=(datetime.fromisoformat(point['updated_at'].replace('Z','+00:00')).timestamp()+120
                                        if sub.location_lease and secrets.compare_digest(sub.location_lease,lease) else 0)
            if sub.tracking_visible and not sub.can_track:
                await self._send(sub,{'kind':'map_access','can_track_teams':False,'session_id':session_id})
            if not sub.tracking_visible and sub.can_track and sub.kind=='team' and sub.member:
                sub.tracking_visible=True
                payload=await asyncio.to_thread(snapshots.team_payload,sub.member,location_until=sub.location_until)
                await self._send(sub,payload)
            sub.tracking_visible=sub.can_track
            if sub.can_track or point.get('team_id')==sub.team_id:
                await self._send(sub,{**event,'session_id':session_id})
        await asyncio.gather(*(deliver(sub) for sub in self._room(session_id)))

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
                    payload = snapshots.team_payload(sub.member, room=data,location_until=sub.location_until)
                    sub.tracking_visible=sub.can_track
                else:
                    continue
            except Exception:
                log.exception("failed to build payload for a %s subscriber", sub.kind)
                continue
            payloads.append((sub, payload))

        if payloads:
            await asyncio.gather(*(self._send(sub, payload) for sub, payload in payloads))


hub = Hub()
