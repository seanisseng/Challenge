"""Snapshot builders shared by the REST endpoints and the WebSocket hub.

A snapshot is the complete state a client needs to render its screen. Because
the whole app is push-driven, every mutation ends with a broadcast of a fresh
snapshot to the session room.
"""

from __future__ import annotations

from typing import Any

from app import repo
from app.config import get_settings

# Deploy-time values that live in challenge copy. `{{phone}}` is replaced from
# CONTACT_PHONE so the host's number never reaches git or Postgres.
PHONE_PLACEHOLDER = "{{phone}}"
PHONE_FALLBACK = "the number your station leader gives you"


def fill_placeholders(text: str | None) -> str | None:
    """Swap deploy-time tokens for their configured values.

    If CONTACT_PHONE is unset the sentence still reads correctly, rather than
    showing a raw `{{phone}}` token to players.
    """
    if not text or PHONE_PLACEHOLDER not in text:
        return text
    phone = get_settings().contact_phone.strip()
    return text.replace(PHONE_PLACEHOLDER, phone or PHONE_FALLBACK)


def _render_challenge(challenge: dict[str, Any]) -> dict[str, Any]:
    """Apply placeholders to the fields a player actually reads."""
    return {
        **challenge,
        "title": fill_placeholders(challenge.get("title")),
        "location_area": fill_placeholders(challenge.get("location_area")),
        "completion_condition": fill_placeholders(
            challenge.get("completion_condition")
        ),
    }



def _board_with_my_status(
    challenges: list[dict[str, Any]], submissions: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Annotate each live challenge with this team's latest submission state."""
    latest: dict[str, dict[str, Any]] = {}
    for sub in submissions:  # already newest-first
        latest.setdefault(sub["challenge_id"], sub)

    board: list[dict[str, Any]] = []
    for challenge in challenges:
        mine = latest.get(challenge["id"])
        board.append(
            {
                **challenge,
                "my_submission": (
                    {
                        "id": mine["id"],
                        "status": mine["status"],
                        "review_note": mine.get("review_note"),
                        "submitted_at": mine["submitted_at"],
                    }
                    if mine
                    else None
                ),
            }
        )
    return board


def session_core(session_id: str) -> dict[str, Any]:
    """The parts of the snapshot that are identical for every viewer."""
    session = repo.get_session(session_id)
    return {
        "session": {
            "id": session["id"],
            "name": session["name"],
            "room_code": session["room_code"],
            "status": session["status"],
            "team_count": session["team_count"],
            "active_task_limit": session["active_task_limit"],
        },
        "board": [_render_challenge(c) for c in repo.active_challenges(session_id)],
        "progress": repo.progress(session_id),
    }


def team_payload(member: dict[str, Any], core: dict[str, Any] | None = None) -> dict[str, Any]:
    """Full snapshot for one player's device."""
    session_id = member["session"]["id"]
    team_id = member["team"]["id"]

    if core is None:
        core = session_core(session_id)

    submissions = repo.team_submissions(team_id)
    board = _board_with_my_status(core["board"], submissions)

    return {
        "kind": "team",
        "session": core["session"],
        "me": {"id": member["id"], "name": member["name"]},
        "team": {"id": member["team"]["id"], "name": member["team"]["name"]},
        "board": board,
        "progress": core["progress"],
        "clues": repo.team_clues(team_id),
        "my_submissions": submissions,
    }


def admin_payload(session_id: str, core: dict[str, Any] | None = None) -> dict[str, Any]:
    """Full snapshot for the admin console."""
    if core is None:
        core = session_core(session_id)

    teams = repo.list_teams(session_id)
    members = repo.list_members([t["id"] for t in teams])
    by_team: dict[str, list[dict[str, Any]]] = {}
    for member in members:
        by_team.setdefault(member["team_id"], []).append(
            {"id": member["id"], "name": member["name"]}
        )

    return {
        "kind": "admin",
        "session": core["session"],
        "board": core["board"],
        "progress": core["progress"],
        "teams": [
            {
                "id": team["id"],
                "name": team["name"],
                "join_code": team["join_code"],
                "members": by_team.get(team["id"], []),
            }
            for team in teams
        ],
        "submissions": repo.session_submissions(session_id),
    }
