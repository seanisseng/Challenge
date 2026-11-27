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
import contextlib
import logging
import time
import secrets
from datetime import datetime
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

from app import snapshots,repo

log = logging.getLogger(__name__)

# One unresponsive phone must not stall the room. Sends run concurrently, so
# this bounds the whole fan-out rather than each socket.
SEND_TIMEOUT = 5.0
RECONCILE_INTERVAL = 30.0


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
        self._reconciler: asyncio.Task | None = None
        self._broadcast_locks: dict[str,asyncio.Lock] = {}

    async def start(self) -> None:
        if self._reconciler is None:
            self._reconciler = asyncio.create_task(self._reconcile())

    async def close(self) -> None:
        if self._reconciler:
            self._reconciler.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reconciler
            self._reconciler = None

    async def _reconcile(self) -> None:
        while True:
            await asyncio.sleep(RECONCILE_INTERVAL)
            for session_id in {sub.session_id for sub in list(self._subs)}:
                await self.broadcast(session_id)

    async def _reconnect(self, sub: Subscriber) -> None:
        try:
            await asyncio.wait_for(sub.ws.close(), timeout=1.0)
        except Exception:
            pass
        finally:
            await self.unregister(sub)

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

    def room_lock(self,session_id:str) -> asyncio.Lock:
        return self._broadcast_locks.setdefault(session_id,asyncio.Lock())

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
        async with self.room_lock(session_id):
            try:
                policy=await asyncio.to_thread(repo.map_visibility,session_id)
            except Exception:
                log.warning('Location visibility unavailable; withholding GPS events')
                await asyncio.gather(*(self._reconnect(sub) for sub in self._room(session_id)))
                return
            await self._map_event(session_id,event,policy,lease=lease)

    async def change_team_visibility(self,session_id:str,team_id:str,visible:bool) -> None:
        async with self.room_lock(session_id):
            await asyncio.to_thread(repo.set_team_location_visibility,session_id,team_id,visible)
            await self._broadcast_room(session_id)

    async def _map_event(self,session_id:str,event:dict[str,Any],policy:dict,*,lease:str|None=None) -> None:
        """Only public map metadata; no game state or private finish in GPS fan-out."""
        point=event.get('location',event)
        async def deliver(sub:Subscriber):
            if sub.kind!='admin' and point.get('team_id')==sub.team_id and point.get('device_id')==sub.location_device_id:
                if event['kind']=='location_removed':sub.location_until=0
                elif lease:
                    sub.location_until=(datetime.fromisoformat(point['updated_at'].replace('Z','+00:00')).timestamp()+120
                                        if sub.location_lease and secrets.compare_digest(sub.location_lease,lease) else 0)
            if sub.tracking_visible and not sub.can_track:
                await self._send(sub,{'kind':'map_access','can_track_teams':False,'session_id':session_id,'visibility_revision':policy['revision']})
            if not sub.tracking_visible and sub.can_track and sub.kind=='team' and sub.member:
                sub.tracking_visible=True
                payload=await asyncio.to_thread(snapshots.team_payload,sub.member,location_until=sub.location_until)
                await self._send(sub,payload)
            sub.tracking_visible=sub.can_track
            if sub.kind=='admin' or point.get('team_id')==sub.team_id or sub.can_track and point.get('team_id') not in policy['hidden_team_ids']:
                await self._send(sub,{**event,'session_id':session_id,'visibility_revision':policy['revision']})
        await asyncio.gather(*(deliver(sub) for sub in self._room(session_id)))

    async def broadcast(self, session_id: str) -> None:
        async with self.room_lock(session_id):
            await self._broadcast_room(session_id)

    async def broadcast_game(self, session_id: str) -> None:
        """Evidence/review updates do not reload or transmit map/roster data."""
        async with self.room_lock(session_id):
            room=self._room(session_id)
            if not room:return
            try:
                data=await asyncio.to_thread(snapshots.game_data,session_id)
                payloads=[(sub,snapshots.admin_game_update(data) if sub.kind=='admin'
                           else snapshots.team_game_update(sub.team_id,data)) for sub in room]
            except Exception:
                log.exception('failed to build game update for session %s',session_id)
                await asyncio.gather(*(self._send(sub,{'kind':'sync_required'}) for sub in room))
                return
            await asyncio.gather(*(self._send(sub,payload) for sub,payload in payloads))

    async def _broadcast_room(self, session_id: str) -> None:
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
            # The transport can still answer heartbeats. Ask clients to refresh
            # instead of disconnecting the entire room over a transient read.
            await asyncio.gather(*(self._send(sub,{'kind':'sync_required'}) for sub in room))
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
                await self._reconnect(sub)
                continue
            payloads.append((sub, payload))

        if payloads:
            await asyncio.gather(*(self._send(sub, payload) for sub, payload in payloads))


hub = Hub()
