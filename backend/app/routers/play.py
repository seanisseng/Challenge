"""Player-facing endpoints. Identity comes from the X-Team-Token header."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile,Request

from app import repo, snapshots
from app.config import get_settings
from app.deps import current_member
from app.models import JoinRequest, TeamNameRequest
from app.realtime import hub

router = APIRouter(prefix="/api", tags=["play"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}


@router.post("/join")
def join(payload: JoinRequest) -> dict[str, Any]:
    """Join or rejoin shared team access using only the team code."""
    joined = repo.join_team(payload.code)
    token = str(joined["member_token"])

    member = repo.member_by_token(token)
    if member is None:
        raise HTTPException(status_code=500, detail="joined but could not load team")

    return {"token": token, "state": snapshots.team_payload(member)}


@router.get("/state")
def state(request:Request,member: dict[str, Any] = Depends(current_member)) -> dict[str, Any]:
    """The full snapshot this device needs to render the game."""
    repo.touch_member(member["id"])
    until=repo.location_access_until(member['team']['id'],request.headers.get('X-Location-Device'),request.headers.get('X-Location-Lease'))
    return snapshots.team_payload(member,location_until=until)


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


@router.patch("/team")
def rename_team(payload: TeamNameRequest, background: BackgroundTasks,
                member: dict[str, Any] = Depends(current_member)) -> dict[str, str]:
    name = repo.rename_team(member["team"]["id"], payload.name)
    background.add_task(hub.broadcast, member["session"]["id"])
    return {"name": name}
