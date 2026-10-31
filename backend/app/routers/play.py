"""Player-facing endpoints. Identity comes from the X-Team-Token header."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile

from app import repo, snapshots
from app.config import get_settings
from app.deps import current_member
from app.models import JoinRequest
from app.realtime import hub

router = APIRouter(prefix="/api", tags=["play"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}


@router.post("/join")
def join(payload: JoinRequest) -> dict[str, Any]:
    """Redeem a team code plus a player name. No account, no password."""
    joined = repo.join_team(payload.code, payload.name)
    token = str(joined["member_token"])

    member = repo.member_by_token(token)
    if member is None:
        raise HTTPException(status_code=500, detail="joined but could not load team")

    return {"token": token, "state": snapshots.team_payload(member)}


@router.get("/state")
def state(member: dict[str, Any] = Depends(current_member)) -> dict[str, Any]:
    """The full snapshot this device needs to render the game."""
    repo.touch_member(member["id"])
    return snapshots.team_payload(member)


@router.post("/submissions")
async def submit_proof(
    background: BackgroundTasks,
    challenge_id: str = Form(...),
    file: UploadFile = File(...),
    member: dict[str, Any] = Depends(current_member),
) -> dict[str, Any]:
    """Upload photo proof and register the submission."""
    settings = get_settings()

    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"unsupported image type: {content_type or 'unknown'}",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"photo is larger than {settings.max_upload_bytes // (1024 * 1024)} MiB",
        )

    session_id = member["session"]["id"]
    team_id = member["team"]["id"]

    path = await asyncio.to_thread(
        repo.upload_proof,
        session_id,
        team_id,
        file.filename or "proof.jpg",
        data,
        content_type,
    )
    await asyncio.to_thread(
        repo.submit_proof, team_id, member["id"], challenge_id, path, None
    )

    background.add_task(hub.broadcast, session_id)
    return {"ok": True, "photo_path": path}


@router.get("/clues")
def clues(member: dict[str, Any] = Depends(current_member)) -> list[dict[str, Any]]:
    """Only this team's unlocked clues."""
    return repo.team_clues(member["team"]["id"])
