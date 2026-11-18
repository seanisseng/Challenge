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
        sub = Subscriber(ws=websocket, session_id=session_id, kind="admin")
    else:
        member = await asyncio.to_thread(repo.member_by_token, token or "")
        if member is None:
            await websocket.close(code=CLOSE_UNAUTHORIZED)
            return
        until=await asyncio.to_thread(repo.location_access_until,member['team']['id'],location_device,location_lease)
        sub = Subscriber(
            ws=websocket,
            session_id=member["session"]["id"],
            kind="team",
            member=member,
            location_device_id=location_device,
            location_lease=location_lease,
            location_until=until,
            tracking_visible=until>0,
        )

    # Serialize initial snapshots with visibility changes and live GPS sends.
    # A reconnect must not install pre-hide coordinates after the host hides a team.
    async with hub.room_lock(sub.session_id):
        try:
            initial=await asyncio.to_thread(snapshots.admin_payload,sub.session_id) if sub.kind=='admin' else await asyncio.to_thread(snapshots.team_payload,sub.member,location_until=sub.location_until)
            await hub.register(sub)
            await websocket.send_json(initial)
        except Exception:
            await hub.unregister(sub)
            await websocket.close(code=CLOSE_BAD_REQUEST)
            return
    try:
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
