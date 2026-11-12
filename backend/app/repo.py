"""Data access layer.

Every database call in the application goes through here, using the
service-role client. Nothing in this module trusts caller input for identity:
the caller's team is always resolved from a member token first.
"""

from __future__ import annotations

import uuid
from urllib.parse import quote
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from postgrest.exceptions import APIError
from supabase import Client

from app.config import get_settings
from app.db.supabase_client import get_admin_client


# --------------------------------------------------------------------------- #
# plumbing
# --------------------------------------------------------------------------- #
def _client() -> Client:
    return get_admin_client()


def _clean_message(message: str) -> str:
    """Turn a raw Postgres error into something safe to show a player."""
    text = (message or "").strip()
    if text.startswith("ERROR:"):
        # "ERROR:  P0001: invalid team code" -> "invalid team code"
        text = text.split(":", 2)[-1].strip()
    return text.splitlines()[0].strip()[:200] or "request failed"


def _to_http(exc: APIError) -> HTTPException:
    message = getattr(exc, "message", None) or str(exc)
    code = getattr(exc, "code", None)
    status = 409 if code in {"23505", "PT409"} else 400
    return HTTPException(status_code=status, detail=_clean_message(message))


def rpc(name: str, params: dict[str, Any]) -> Any:
    try:
        return _client().rpc(name, params).execute().data
    except APIError as exc:
        raise _to_http(exc) from exc


def _select(table: str):
    return _client().table(table)


# --------------------------------------------------------------------------- #
# sessions
# --------------------------------------------------------------------------- #
def create_session(
    name: str, team_count: int, active_task_limit: int
) -> dict[str, Any]:
    rows = rpc(
        "create_session",
        {
            "p_name": name,
            "p_team_count": team_count,
            "p_active_task_limit": active_task_limit,
        },
    )
    return rows[0]


def list_sessions() -> list[dict[str, Any]]:
    return (
        _select("game_sessions")
        .select("id,room_code,name,status,team_count,active_task_limit,created_at,started_at,ended_at")
        .order("created_at", desc=True)
        .execute()
        .data
    )


def get_session(session_id: str) -> dict[str, Any]:
    rows = (
        _select("game_sessions")
        .select("*")
        .eq("id", session_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="session not found")
    return rows[0]


def set_session_status(session_id: str, status: str) -> None:
    payload: dict[str, Any] = {"status": status}
    now = datetime.now(timezone.utc).isoformat()
    if status == "active":
        payload["started_at"] = now
    elif status == "ended":
        payload["ended_at"] = now
        payload["board_visible"] = False
    try:
        _select("game_sessions").update(payload).eq("id", session_id).execute()
    except APIError as exc:
        raise _to_http(exc) from exc


def list_teams(session_id: str) -> list[dict[str, Any]]:
    return (
        _select("teams")
        .select("id,name,join_code,created_at")
        .eq("session_id", session_id)
        .order("name")
        .execute()
        .data
    )


def list_members(team_ids: list[str]) -> list[dict[str, Any]]:
    if not team_ids:
        return []
    return (
        _select("team_members")
        .select("id,team_id,name,joined_at,last_seen_at")
        .in_("team_id", team_ids)
        .order("joined_at")
        .execute()
        .data
    )


def delete_member(member_id: str) -> None:
    try:
        _select("team_members").delete().eq("id", member_id).execute()
    except APIError as exc:
        raise _to_http(exc) from exc


# --------------------------------------------------------------------------- #
# identity
# --------------------------------------------------------------------------- #
def member_by_token(token: str) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        uuid.UUID(token)
    except ValueError:
        return None

    rows = (
        _select("team_members")
        .select(
            "id,name,token,team_id,"
            "teams!inner(id,name,join_code,session_id,"
            "game_sessions!inner(id,name,room_code,status,team_count,active_task_limit))"
        )
        .eq("token", token)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        return None

    row = rows[0]
    team = row.pop("teams")
    session = team.pop("game_sessions")
    row["team"] = team
    row["session"] = session
    return row


def touch_member(member_id: str) -> None:
    try:
        _select("team_members").update(
            {"last_seen_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", member_id).execute()
    except APIError:
        pass  # presence is cosmetic; never fail a request over it


def join_team(code: str, name: str) -> dict[str, Any]:
    rows = rpc("join_team", {"p_join_code": code, "p_member_name": name})
    if not rows:
        raise HTTPException(status_code=400, detail="could not join team")
    return rows[0]


# --------------------------------------------------------------------------- #
# board / progress
# --------------------------------------------------------------------------- #
def active_challenges(session_id: str) -> list[dict[str, Any]]:
    return (
        _select("challenges")
        .select(
            "id,title,location_area,completion_condition,clue_tier,status,"
            "claimed_by_team_id,sort_order,updated_at,image_path"
        )
        .eq("session_id", session_id)
        .eq("is_active", True)
        .eq("is_discarded", False)
        .order("sort_order")
        .execute()
        .data
    )


def all_challenges(session_id: str) -> list[dict[str, Any]]:
    return (
        _select("challenges")
        .select("*")
        .eq("session_id", session_id)
        .order("sort_order")
        .execute()
        .data
    )


def queued_challenges(session_id: str) -> list[dict[str, Any]]:
    return (
        _select("challenges").select(
            "id,title,location_area,completion_condition,clue_tier,status,"
            "claimed_by_team_id,sort_order,updated_at,image_path"
        )
        .eq("session_id", session_id).eq("is_active", False)
        .eq("is_discarded", False).eq("status", "open")
        .order("sort_order").order("created_at")
        .execute().data
    )


def set_board_visibility(session_id: str, visible: bool) -> None:
    rpc("set_board_visibility", {"p_session_id": session_id, "p_visible": visible})


def defer_challenge(session_id: str, challenge_id: str) -> None:
    rpc("defer_challenge", {"p_session_id": session_id, "p_challenge_id": challenge_id})


def discard_challenge(session_id: str, challenge_id: str) -> None:
    rpc("discard_challenge", {"p_session_id": session_id, "p_challenge_id": challenge_id})


def reorder_queue(session_id: str, challenge_ids: list[str], expected_ids: list[str]) -> None:
    rpc("reorder_challenge_queue", {
        "p_session_id": session_id, "p_challenge_ids": challenge_ids, "p_expected_ids": expected_ids,
    })


def team_submissions(team_id: str) -> list[dict[str, Any]]:
    return (
        _select("submissions")
        .select(
            "id,challenge_id,status,photo_path,review_note,submitted_at,reviewed_at,team_member_id"
        )
        .eq("team_id", team_id)
        .order("submitted_at", desc=True)
        .execute()
        .data
    )


def session_submissions(session_id: str, status: str | None = None) -> list[dict[str, Any]]:
    query = (
        _select("submissions")
        .select(
            "id,session_id,challenge_id,team_id,team_member_id,photo_path,status,"
            "review_note,submitted_at,reviewed_at,"
            "challenges!inner(title),teams!inner(name),"
            "team_members(name)"
        )
        .eq("session_id", session_id)
        .order("submitted_at", desc=True)
    )
    if status:
        query = query.eq("status", status)
    return query.execute().data


def team_clues(team_id: str) -> list[dict[str, Any]]:
    unlocked = (
        _select("team_clues")
        .select("clue_id,challenge_id,unlocked_at")
        .eq("team_id", team_id)
        .order("unlocked_at")
        .execute()
        .data
    )
    if not unlocked:
        return []

    clue_ids = [row["clue_id"] for row in unlocked]
    clues = (
        _select("clues")
        .select("id,tier,title,body,media_url,sort_order")
        .in_("id", clue_ids)
        .execute()
        .data
    )
    by_id = {c["id"]: c for c in clues}

    out: list[dict[str, Any]] = []
    for row in unlocked:
        clue = by_id.get(row["clue_id"])
        if not clue:
            continue
        out.append(
            {
                "id": clue["id"],
                "tier": clue["tier"],
                "title": clue["title"],
                "body": clue["body"],
                "media_url": clue.get("media_url"),
                "unlocked_at": row["unlocked_at"],
            }
        )
    tier_order = {"tier1": 1, "tier2": 2, "tier3": 3}
    out.sort(key=lambda c: (tier_order.get(c["tier"], 9), c["unlocked_at"]))
    return out


def recent_clue_awards(session_id: str) -> list[dict[str, Any]]:
    """Public, session-scoped unlock events; never include clue text or media."""
    rows = (
        _select("team_clues")
        .select("id,team_id,unlocked_at,teams!inner(name,session_id),clues!inner(tier)")
        .eq("teams.session_id", session_id)
        .order("unlocked_at", desc=True)
        .limit(50)
        .execute()
        .data
    )
    return [
        {
            "id": row["id"],
            "team_id": row["team_id"],
            "team_name": row["teams"]["name"],
            "tier": row["clues"]["tier"],
            "awarded_at": row["unlocked_at"],
        }
        for row in rows
    ]


def progress(session_id: str) -> list[dict[str, Any]]:
    teams = list_teams(session_id)
    if not teams:
        return []
    team_ids = [t["id"] for t in teams]

    members = (
        _select("team_members").select("team_id").in_("team_id", team_ids).execute().data
    )
    clues = (
        _select("team_clues").select("team_id").in_("team_id", team_ids).execute().data
    )
    claimed = (
        _select("challenges")
        .select("claimed_by_team_id")
        .eq("session_id", session_id)
        .not_.is_("claimed_by_team_id", "null")
        .execute()
        .data
    )

    def tally(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
        out: dict[str, int] = {}
        for row in rows:
            value = row.get(key)
            if value:
                out[value] = out.get(value, 0) + 1
        return out

    member_count = tally(members, "team_id")
    clue_count = tally(clues, "team_id")
    claim_count = tally(claimed, "claimed_by_team_id")

    return [
        {
            "team_id": team["id"],
            "team_name": team["name"],
            "member_count": member_count.get(team["id"], 0),
            "clue_count": clue_count.get(team["id"], 0),
            "claimed_count": claim_count.get(team["id"], 0),
        }
        for team in teams
    ]


# --------------------------------------------------------------------------- #
# submissions
# --------------------------------------------------------------------------- #
def submit_proof(
    team_id: str, member_id: str, challenge_id: str, photo_path: str, photo_url: str | None
) -> str:
    return rpc(
        "submit_proof",
        {
            "p_team_id": team_id,
            "p_member_id": member_id,
            "p_challenge_id": challenge_id,
            "p_photo_path": photo_path,
            "p_photo_url": photo_url,
        },
    )


def approve_submission(submission_id: str, note: str | None) -> None:
    rpc("approve_submission", {"p_submission_id": submission_id, "p_note": note})


def reject_submission(submission_id: str, note: str | None) -> None:
    rpc("reject_submission", {"p_submission_id": submission_id, "p_note": note})


def submission(submission_id: str) -> dict[str, Any]:
    rows = (
        _select("submissions")
        .select("id,session_id,team_id,status,photo_path,submitted_at")
        .eq("id", submission_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="submission not found")
    return rows[0]


def member_session_id(member_id: str) -> str | None:
    rows = (
        _select("team_members")
        .select("teams!inner(session_id)")
        .eq("id", member_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        return None
    return rows[0]["teams"]["session_id"]


# --------------------------------------------------------------------------- #
# challenges / clues (admin)
# --------------------------------------------------------------------------- #
def create_challenge(
    session_id: str,
    title: str,
    location_area: str | None,
    completion_condition: str,
    clue_tier: str,
    sort_order: int,
    image_path: str | None = None,
) -> dict[str, Any]:
    try:
        rows = (
            _select("challenges")
            .insert(
                {
                    "session_id": session_id,
                    "title": title,
                    "location_area": location_area,
                    "completion_condition": completion_condition,
                    "clue_tier": clue_tier,
                    "sort_order": sort_order,
                    "image_path": image_path,
                }
            )
            .execute()
            .data
        )
    except APIError as exc:
        raise _to_http(exc) from exc
    return rows[0]


def get_challenge(challenge_id: str) -> dict[str, Any]:
    rows = _select("challenges").select("*").eq("id", challenge_id).limit(1).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="challenge not found")
    return rows[0]


def set_challenge_image(challenge_id: str, path: str) -> None:
    try:
        _select("challenges").update({"image_path": path}).eq("id", challenge_id).execute()
    except APIError as exc:
        raise _to_http(exc) from exc


def create_clue(
    session_id: str,
    tier: str,
    title: str,
    body: str,
    media_url: str | None,
    sort_order: int,
) -> dict[str, Any]:
    try:
        rows = (
            _select("clues")
            .insert(
                {
                    "session_id": session_id,
                    "tier": tier,
                    "title": title,
                    "body": body,
                    "media_url": media_url,
                    "sort_order": sort_order,
                }
            )
            .execute()
            .data
        )
    except APIError as exc:
        raise _to_http(exc) from exc
    return rows[0]


def list_clues(session_id: str) -> list[dict[str, Any]]:
    return (
        _select("clues")
        .select("id,tier,title,body,media_url,sort_order")
        .eq("session_id", session_id)
        .order("tier")
        .order("sort_order")
        .execute()
        .data
    )


def start_board(session_id: str) -> None:
    """Activate the opening board and flip the session live."""
    refill_board(session_id)


def refill_board(session_id: str) -> None:
    """Top the live board back up to the session's active-task limit."""
    rpc("refill_board", {"p_session_id": session_id})


# --------------------------------------------------------------------------- #
# storage
# --------------------------------------------------------------------------- #
def public_asset_url(path: str | None) -> str | None:
    if not path:
        return None
    settings = get_settings()
    return (
        f"{settings.supabase_url.rstrip('/')}/storage/v1/object/public/"
        f"{quote(settings.asset_bucket, safe='')}/{quote(path, safe='/')}"
    )


def upload_challenge_image(
    session_id: str, filename: str, data: bytes, content_type: str
) -> str:
    # Derive extensions from the allowed MIME type, never from an uploaded name.
    extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[content_type]
    path = f"{session_id}/{uuid.uuid4().hex}{extension}"
    try:
        _client().storage.from_(get_settings().asset_bucket).upload(
            path, data, {"content-type": content_type, "upsert": "false"}
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail="image upload failed") from exc
    return path


def upload_proof(session_id: str, team_id: str, filename: str, data: bytes, content_type: str) -> str:
    settings = get_settings()
    safe = f"{uuid.uuid4().hex}{filename[filename.rfind('.'):] if '.' in filename else '.jpg'}"
    path = f"{session_id}/{team_id}/{safe}"
    try:
        _client().storage.from_(settings.proof_bucket).upload(
            path,
            data,
            {"content-type": content_type, "upsert": "false"},
        )
    except Exception as exc:  # storage3 raises its own errors
        raise HTTPException(status_code=400, detail=f"upload failed: {exc}") from exc
    return path


def signed_url(path: str, expires_in: int = 3600) -> str | None:
    settings = get_settings()
    try:
        res = _client().storage.from_(settings.proof_bucket).create_signed_url(
            path, expires_in
        )
    except Exception:
        return None
    if isinstance(res, dict):
        return res.get("signedURL") or res.get("signedUrl")
    return None
