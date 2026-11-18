"""WebSocket endpoint.

Players connect with ``?token=<team token>``; the admin connects with
``?admin_token=<admin token>&session_id=<session>``. On connect the current
snapshot is pushed, then every mutation on that session re-pushes it.
"""

from __future__ import annotations

import asyncio
import secrets
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app import repo, snapshots
from app.config import get_settings
from app.realtime import Subscriber, hub

router = APIRouter()

CLOSE_UNAUTHORIZED = 4401
CLOSE_BAD_REQUEST = 4400


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str | None = None,
    admin_token: str | None = None,
    session_id: str | None = None,
    location_device: str | None = None,
    location_lease: str | None = None,
) -> None:
    settings = get_settings()
    await websocket.accept()

    sub: Subscriber
    initial: dict[str, Any]

    if admin_token:
        if not settings.admin_pin or not secrets.compare_digest(
            admin_token, settings.admin_token
        ):
            await websocket.close(code=CLOSE_UNAUTHORIZED)
            return
        if not session_id:
            await websocket.close(code=CLOSE_BAD_REQUEST)
            return
        try:
            initial = await asyncio.to_thread(snapshots.admin_payload, session_id)
        except Exception:
            await websocket.close(code=CLOSE_BAD_REQUEST)
            return
        sub = Subscriber(ws=websocket, session_id=session_id, kind="admin")
    else:
        member = await asyncio.to_thread(repo.member_by_token, token or "")
        if member is None:
            await websocket.close(code=CLOSE_UNAUTHORIZED)
            return
        until=await asyncio.to_thread(repo.location_access_until,member['team']['id'],location_device,location_lease)
        initial = await asyncio.to_thread(snapshots.team_payload, member,location_until=until)
        sub = Subscriber(
            ws=websocket,
            session_id=member["session"]["id"],
            kind="team",
            member=member,
            location_device_id=location_device,
            location_lease=location_lease,
            location_until=until,
            tracking_visible=bool((initial.get('map') or {}).get('can_track_teams')),
        )

    await hub.register(sub)
    try:
        await websocket.send_json(initial)
        while True:
            # Clients send a heartbeat; anything else is ignored.
            message = await websocket.receive_text()
            if message == 'ping':
                await websocket.send_json({'kind':'pong'})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await hub.unregister(sub)
