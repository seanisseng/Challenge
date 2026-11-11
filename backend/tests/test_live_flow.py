"""End-to-end game flow against the hosted Supabase project.

These hit the real database and storage bucket, so they are skipped by default.
To run them:

    $env:CHALLENGE_LIVE_TESTS = "1"
    .\\.venv\\Scripts\\python.exe -m pytest tests/test_live_flow.py -v

The session created by the test is deleted afterwards, which cascades to its
teams, members, challenges, clues, submissions, and storage objects.
"""

from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db.supabase_client import get_admin_client
from app.main import app

settings = get_settings()

live = pytest.mark.skipif(
    os.getenv("CHALLENGE_LIVE_TESTS") != "1" or not settings.service_key,
    reason=(
        "live tests need CHALLENGE_LIVE_TESTS=1 and a SUPABASE_SECRET_KEY or "
        "SUPABASE_SERVICE_ROLE_KEY in backend/.env"
    ),
)

pytestmark = live

# A 1x1 transparent JPEG-ish payload; the backend only checks the MIME type and
# size, and Storage accepts any bytes under an image content type.
FAKE_PHOTO = b"\xff\xd8\xff\xe0" + b"\x00" * 64 + b"\xff\xd9"


def _cleanup(session_id: str) -> None:
    try:
        get_admin_client().table("game_sessions").delete().eq(
            "id", session_id
        ).execute()
    except Exception:  # pragma: no cover - best effort cleanup
        pass


def test_full_game_flow() -> None:
    client = TestClient(app)
    admin = {"X-Admin-Token": settings.admin_token}

    created = client.post(
        "/api/admin/sessions",
        headers=admin,
        json={
            "name": f"Live Test {uuid.uuid4().hex[:6]}",
            "team_count": 2,
            "active_task_limit": 2,
        },
    )
    assert created.status_code == 200, created.text

    payload = created.json()
    session_id = payload["session"]["id"]
    teams = payload["teams"]

    try:
        assert len(teams) == 2
        # This test builds a tiny custom pool; normal games now start with 29.
        assert len(get_admin_client().table("challenges").select("id").eq("session_id", session_id).execute().data) == 29
        get_admin_client().table("challenges").delete().eq("session_id", session_id).execute()
        codes = {team["join_code"] for team in teams}
        assert len(codes) == 2, "each team must get its own code"

        # --- join: two devices on one team, one on the other ---------------
        team_a, team_b = teams[0], teams[1]

        alice = client.post(
            "/api/join", json={"code": team_a["join_code"], "name": "Alice"}
        )
        assert alice.status_code == 200, alice.text
        alice_token = alice.json()["token"]

        bob = client.post(
            "/api/join", json={"code": team_a["join_code"].lower(), "name": "Bob"}
        )
        assert bob.status_code == 200, "codes are case-insensitive"
        bob_token = bob.json()["token"]
        assert bob.json()["state"]["team"]["id"] == team_a["id"]

        cara = client.post(
            "/api/join", json={"code": team_b["join_code"], "name": "Cara"}
        )
        assert cara.status_code == 200, cara.text
        cara_token = cara.json()["token"]

        duplicate = client.post(
            "/api/join", json={"code": team_a["join_code"], "name": "alice"}
        )
        assert duplicate.status_code == 400, "names are unique per team"
        assert "already using the name" in duplicate.json()["detail"]

        bad = client.post("/api/join", json={"code": "ZZZZZZ", "name": "Nobody"})
        assert bad.status_code == 400
        assert bad.json()["detail"] == "invalid team code"

        alice_headers = {"X-Team-Token": alice_token}
        cara_headers = {"X-Team-Token": cara_token}

        # --- content -------------------------------------------------------
        clue = client.post(
            f"/api/admin/sessions/{session_id}/clues",
            headers=admin,
            json={
                "tier": "tier1",
                "title": "Head north",
                "body": "Follow the river past the old mill.",
                "media_url": None,
                "sort_order": 0,
            },
        )
        assert clue.status_code == 200, clue.text

        challenge = client.post(
            f"/api/admin/sessions/{session_id}/challenges",
            headers=admin,
            json={
                "title": "Banana tree selfie",
                "location_area": "Riverside park",
                "completion_condition": "Eat a banana as a group under the tree.",
                "clue_tier": "tier1",
                "sort_order": 0,
            },
        )
        assert challenge.status_code == 200, challenge.text
        challenge_id = challenge.json()["id"]

        started = client.post(
            f"/api/admin/sessions/{session_id}/start", headers=admin
        )
        assert started.status_code == 200, started.text

        state = client.get("/api/state", headers=alice_headers).json()
        assert state["session"]["status"] == "active"
        assert [c["id"] for c in state["board"]] == [challenge_id]

        # --- sniping: two teams race the same challenge --------------------
        cara_submit = client.post(
            "/api/submissions",
            headers=cara_headers,
            data={"challenge_id": challenge_id},
            files={"file": ("cara.jpg", FAKE_PHOTO, "image/jpeg")},
        )
        assert cara_submit.status_code == 200, cara_submit.text

        alice_submit = client.post(
            "/api/submissions",
            headers=alice_headers,
            data={"challenge_id": challenge_id},
            files={"file": ("alice.jpg", FAKE_PHOTO, "image/jpeg")},
        )
        assert alice_submit.status_code == 200, alice_submit.text

        admin_state = client.get(
            f"/api/admin/sessions/{session_id}/state", headers=admin
        ).json()
        pending = [s for s in admin_state["submissions"] if s["status"] == "pending"]
        assert len(pending) == 2

        alice_submission = next(
            s for s in pending if s["team_id"] == team_a["id"]
        )

        photo = client.get(
            f"/api/admin/submissions/{alice_submission['id']}/photo", headers=admin
        )
        assert photo.status_code == 200, photo.text
        assert photo.json()["url"].startswith("http")

        approved = client.post(
            f"/api/admin/submissions/{alice_submission['id']}/approve",
            headers=admin,
            json={"note": "nice banana"},
        )
        assert approved.status_code == 200, approved.text
        assert client.post(
            f"/api/admin/sessions/{session_id}/challenges/{challenge_id}/discard", headers=admin
        ).status_code == 400

        # --- the winner unlocks a clue, the loser is auto-rejected ---------
        alice_state = client.get("/api/state", headers=alice_headers).json()
        assert len(alice_state["clues"]) == 1
        assert alice_state["clues"][0]["tier"] == "tier1"
        assert alice_state["clues"][0]["title"] == "Head north"
        assert challenge_id not in [c["id"] for c in alice_state["board"]]

        cara_state = client.get("/api/state", headers=cara_headers).json()
        assert cara_state["clues"] == []
        assert cara_state["my_submissions"][0]["status"] == "rejected"
        assert "claimed by another team" in (
            cara_state["my_submissions"][0]["review_note"] or ""
        ).lower()

        # Everyone sees the same scoreboard.
        progress = {p["team_id"]: p for p in cara_state["progress"]}
        assert progress[team_a["id"]]["clue_count"] == 1
        assert progress[team_a["id"]]["member_count"] == 2
        assert progress[team_b["id"]]["clue_count"] == 0

        # A claimed challenge can no longer be submitted against.
        again = client.post(
            "/api/submissions",
            headers=cara_headers,
            data={"challenge_id": challenge_id},
            files={"file": ("cara.jpg", FAKE_PHOTO, "image/jpeg")},
        )
        assert again.status_code == 400
        assert "claimed" in again.json()["detail"].lower()

        # --- rejection reopens the challenge -------------------------------
        second = client.post(
            f"/api/admin/sessions/{session_id}/challenges",
            headers=admin,
            json={
                "title": "Find the blue door",
                "location_area": None,
                "completion_condition": "Photograph the blue door.",
                "clue_tier": "tier2",
                "sort_order": 1,
            },
        ).json()

        submitted = client.post(
            "/api/submissions",
            headers=cara_headers,
            data={"challenge_id": second["id"]},
            files={"file": ("door.jpg", FAKE_PHOTO, "image/jpeg")},
        )
        assert submitted.status_code == 200, submitted.text

        cara_state = client.get("/api/state", headers=cara_headers).json()
        door_sub = next(
            s for s in cara_state["my_submissions"] if s["challenge_id"] == second["id"]
        )

        rejected = client.post(
            f"/api/admin/submissions/{door_sub['id']}/reject",
            headers=admin,
            json={"note": "can't see the door"},
        )
        assert rejected.status_code == 200, rejected.text

        cara_state = client.get("/api/state", headers=cara_headers).json()
        door = next(c for c in cara_state["board"] if c["id"] == second["id"])
        assert door["status"] == "open", "a rejected challenge returns to the board"

    finally:
        _cleanup(session_id)
