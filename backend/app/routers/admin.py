"""Admin endpoints. Everything except /login requires the admin token."""

from __future__ import annotations

import secrets
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app import repo, snapshots
from app.config import get_settings
from app.deps import require_admin
from app.models import (
    AdminLoginRequest,
    AdminLoginResponse,
    ChallengeCreateRequest,
    ClueCreateRequest,
    ReviewRequest,
    SessionCreateRequest,
)
from app.realtime import hub

public_router = APIRouter(prefix="/api/admin", tags=["admin"])
router = APIRouter(
    prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)]
)


# --------------------------------------------------------------------------- #
# login
# --------------------------------------------------------------------------- #
@public_router.post("/login", response_model=AdminLoginResponse)
def login(payload: AdminLoginRequest) -> AdminLoginResponse:
    settings = get_settings()
    if not settings.admin_pin:
        raise HTTPException(
            status_code=503,
            detail="admin PIN is not configured; set ADMIN_PIN in backend/.env",
        )
    if not secrets.compare_digest(payload.pin, settings.admin_pin):
        raise HTTPException(status_code=401, detail="incorrect PIN")
    return AdminLoginResponse(token=settings.admin_token)


# --------------------------------------------------------------------------- #
# sessions
# --------------------------------------------------------------------------- #
@router.get("/sessions")
def list_sessions() -> list[dict[str, Any]]:
    return repo.list_sessions()


@router.post("/sessions")
def create_session(payload: SessionCreateRequest) -> dict[str, Any]:
    created = repo.create_session(
        payload.name, payload.team_count, payload.active_task_limit
    )
    session_id = created["session_id"]
    return {
        "session": repo.get_session(session_id),
        "teams": repo.list_teams(session_id),
    }


@router.get("/sessions/{session_id}/state")
def session_state(session_id: str) -> dict[str, Any]:
    return snapshots.admin_payload(session_id)


@router.post("/sessions/{session_id}/start")
def start_session(session_id: str, background: BackgroundTasks) -> dict[str, Any]:
    repo.get_session(session_id)
    repo.start_board(session_id)
    repo.set_session_status(session_id, "active")
    background.add_task(hub.broadcast, session_id)
    return {"ok": True}


@router.post("/sessions/{session_id}/end")
def end_session(session_id: str, background: BackgroundTasks) -> dict[str, Any]:
    repo.get_session(session_id)
    repo.set_session_status(session_id, "ended")
    background.add_task(hub.broadcast, session_id)
    return {"ok": True}


# --------------------------------------------------------------------------- #
# content
# --------------------------------------------------------------------------- #
@router.post("/sessions/{session_id}/challenges")
def add_challenge(
    session_id: str, payload: ChallengeCreateRequest, background: BackgroundTasks
) -> dict[str, Any]:
    repo.get_session(session_id)
    challenge = repo.create_challenge(
        session_id,
        payload.title,
        payload.location_area,
        payload.completion_condition,
        payload.clue_tier,
        payload.sort_order,
    )
    # If the board has room, the new challenge should go live immediately
    # rather than waiting for the next claim to trigger a refill.
    repo.refill_board(session_id)
    background.add_task(hub.broadcast, session_id)
    return challenge


@router.post("/sessions/{session_id}/clues")
def add_clue(
    session_id: str, payload: ClueCreateRequest, background: BackgroundTasks
) -> dict[str, Any]:
    repo.get_session(session_id)
    clue = repo.create_clue(
        session_id,
        payload.tier,
        payload.title,
        payload.body,
        payload.media_url,
        payload.sort_order,
    )
    background.add_task(hub.broadcast, session_id)
    return clue


@router.get("/sessions/{session_id}/clues")
def list_clues(session_id: str) -> list[dict[str, Any]]:
    return repo.list_clues(session_id)


# --------------------------------------------------------------------------- #
# review
# --------------------------------------------------------------------------- #
@router.post("/submissions/{submission_id}/approve")
def approve(
    submission_id: str, payload: ReviewRequest, background: BackgroundTasks
) -> dict[str, Any]:
    submission = repo.submission(submission_id)
    repo.approve_submission(submission_id, payload.note)
    background.add_task(hub.broadcast, submission["session_id"])
    return {"ok": True}


@router.post("/submissions/{submission_id}/reject")
def reject(
    submission_id: str, payload: ReviewRequest, background: BackgroundTasks
) -> dict[str, Any]:
    submission = repo.submission(submission_id)
    repo.reject_submission(submission_id, payload.note)
    background.add_task(hub.broadcast, submission["session_id"])
    return {"ok": True}


@router.get("/submissions/{submission_id}/photo")
def photo(submission_id: str) -> dict[str, Any]:
    submission = repo.submission(submission_id)
    url = repo.signed_url(submission["photo_path"])
    if not url:
        raise HTTPException(status_code=404, detail="photo unavailable")
    return {"url": url}


# --------------------------------------------------------------------------- #
# members
# --------------------------------------------------------------------------- #
@router.delete("/members/{member_id}")
def remove_member(member_id: str, background: BackgroundTasks) -> dict[str, Any]:
    session_id = repo.member_session_id(member_id)
    if session_id is None:
        raise HTTPException(status_code=404, detail="member not found")
    repo.delete_member(member_id)
    background.add_task(hub.broadcast, session_id)
    return {"ok": True}
