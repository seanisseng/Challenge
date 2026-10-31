"""WebSocket endpoint.

Players connect with ``?token=<team token>``; the admin connects with
``?admin_token=<admin token>&session_id=<session>``. On connect the current
snapshot is pushed, then every mutation on that session re-pushes it.
"""

from __future__ import annotations

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
            initial = snapshots.admin_payload(session_id)
        except Exception:
            await websocket.close(code=CLOSE_BAD_REQUEST)
            return
        sub = Subscriber(ws=websocket, session_id=session_id, kind="admin")
    else:
        member = repo.member_by_token(token or "")
        if member is None:
            await websocket.close(code=CLOSE_UNAUTHORIZED)
            return
        initial = snapshots.team_payload(member)
        sub = Subscriber(
            ws=websocket,
            session_id=member["session"]["id"],
            kind="team",
            member=member,
        )

    await hub.register(sub)
    try:
        await websocket.send_json(initial)
        while True:
            # Clients send a heartbeat; anything else is ignored.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await hub.unregister(sub)
