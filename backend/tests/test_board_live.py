"""Live acceptance for prepopulated games, visibility and atomic queue rotation."""

import uuid

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

from app import repo
from app.config import get_settings
from app.main import app
from tests.test_live_flow import live, _cleanup

pytestmark = live


def test_prepopulated_board_visibility_and_queue():
    client = TestClient(app)
    admin = {"X-Admin-Token": get_settings().admin_token}
    created = client.post("/api/admin/sessions", headers=admin, json={"name": f"Board Test {uuid.uuid4().hex[:6]}", "team_count": 2, "active_task_limit": 6})
    assert created.status_code == 200, created.text
    session_id = created.json()["session"]["id"]
    base = f"/api/admin/sessions/{session_id}"
    try:
        assert len(repo.all_challenges(session_id)) == 29
        state = client.get(base + "/state", headers=admin).json()
        assert len(state["board"]) == 6
        assert len(state["queue"]) == 23
        assert state["session"]["board_visible"] is False
        assert [c["clue_tier"] for c in state["board"]] == ["tier1", "tier3", "tier2", "tier1", "tier2", "tier3"]
        joined = client.post("/api/join", json={"code": created.json()["teams"][0]["join_code"], "name": "Queue Tester"}).json()
        team_headers = {"X-Team-Token": joined["token"]}
        assert joined["state"]["board"] == []
        assert "queue" not in joined["state"]
        member = repo.member_by_token(joined["token"])
        rival = client.post("/api/join", json={"code": created.json()["teams"][1]["join_code"], "name": "Rival Tester"}).json()
        rival_member = repo.member_by_token(rival["token"])
        live_id = state["board"][0]["id"]
        queued_id = state["queue"][0]["id"]
        with pytest.raises(HTTPException):
            repo.submit_proof(member["team"]["id"], member["id"], live_id, "test-only.jpg", None)

        original_queue = [c["id"] for c in state["queue"]]
        reversed_queue = original_queue[::-1]
        reordered = client.post(base + "/queue/reorder", headers=admin, json={"challenge_ids": reversed_queue, "expected_ids": original_queue})
        assert reordered.status_code == 200, reordered.text
        state = client.get(base + "/state", headers=admin).json()
        assert [c["id"] for c in state["queue"]] == reversed_queue
        stale = client.post(base + "/queue/reorder", headers=admin, json={"challenge_ids": original_queue, "expected_ids": original_queue})
        assert stale.status_code == 409
        invalid_orders = [reversed_queue[:-1], reversed_queue[:-1] + [reversed_queue[0]], [live_id] + reversed_queue[1:], [str(uuid.uuid4())] + reversed_queue[1:]]
        for invalid in invalid_orders:
            response = client.post(base + "/queue/reorder", headers=admin, json={"challenge_ids": invalid, "expected_ids": reversed_queue})
            assert response.status_code == 400
        assert client.post(base + f"/challenges/{queued_id}/discard", headers=admin).status_code == 200
        state = client.get(base + "/state", headers=admin).json()
        assert queued_id not in [c["id"] for c in state["queue"]]
        assert repo.get_challenge(queued_id)["is_discarded"] is True
        assert client.post(base + f"/challenges/{queued_id}/discard", headers=admin).status_code == 200
        remaining = [c["id"] for c in state["queue"]]
        restore_removed = client.post(base + "/queue/reorder", headers=admin, json={"challenge_ids": [queued_id] + remaining[1:], "expected_ids": remaining})
        assert restore_removed.status_code == 400
        next_id = state["queue"][0]["id"]

        assert client.post(base + "/board/reveal", headers=admin).status_code == 200
        team = client.get("/api/state", headers=team_headers).json()
        assert len(team["board"]) == 6 and team["session"]["status"] == "active"
        assert team["session"]["board_reveal_version"] == 1
        assert client.post(base + "/board/reveal", headers=admin).status_code == 200
        assert client.get("/api/state", headers=team_headers).json()["session"]["board_reveal_version"] == 1
        submission_id = repo.submit_proof(member["team"]["id"], member["id"], live_id, "test-only.jpg", None)
        rival_submission_id = repo.submit_proof(rival_member["team"]["id"], rival_member["id"], live_id, "test-only.jpg", None)
        assert client.post(base + f"/challenges/{live_id}/discard", headers=admin).status_code == 200
        state = client.get(base + "/state", headers=admin).json()
        assert len(state["board"]) == 6
        assert live_id not in [c["id"] for c in state["board"]]
        assert next_id in [c["id"] for c in state["board"]]
        assert live_id not in [c["id"] for c in state["queue"]]
        rejected = next(s for s in state["submissions"] if s["id"] == submission_id)
        assert rejected["status"] == "rejected"
        assert "removed" in rejected["review_note"].lower()
        assert next(s for s in state["submissions"] if s["id"] == rival_submission_id)["status"] == "rejected"
        assert client.post(f"/api/admin/submissions/{submission_id}/approve", headers=admin, json={}).status_code == 400
        with pytest.raises(HTTPException):
            repo.submit_proof(member["team"]["id"], member["id"], live_id, "test-only.jpg", None)

        wrong_room = client.post(f"/api/admin/sessions/{uuid.uuid4()}/challenges/{next_id}/discard", headers=admin)
        assert wrong_room.status_code in (400, 404)
        assert client.post(base + "/board/hide", headers=admin).status_code == 200
        hidden = client.get("/api/state", headers=team_headers).json()
        assert hidden["board"] == []
        with pytest.raises(HTTPException):
            repo.submit_proof(member["team"]["id"], member["id"], next_id, "test-only.jpg", None)
        assert len(client.get(base + "/state", headers=admin).json()["board"]) == 6
        assert client.post(base + "/board/reveal", headers=admin).status_code == 200
        revealed = client.get("/api/state", headers=team_headers).json()
        assert len(revealed["board"]) == 6
        assert revealed["session"]["board_reveal_version"] == 2
        assert not {queued_id, live_id}.intersection(c["id"] for c in revealed["board"])
        assert client.post(base + "/end", headers=admin).status_code == 200
        assert client.post(base + "/board/reveal", headers=admin).status_code == 400
    finally:
        _cleanup(session_id)


def test_discarded_cards_never_return_when_the_deck_is_exhausted():
    from app.db.supabase_client import get_admin_client
    client = get_admin_client()
    session = repo.create_session(f"Discard Test {uuid.uuid4().hex[:6]}", 1, 2)
    session_id = session["session_id"]
    try:
        fresh_pool = repo.all_challenges(session_id)
        assert len(fresh_pool) == 29 and all(not c["is_discarded"] for c in fresh_pool)
        client.table("challenges").delete().eq("session_id", session_id).execute()
        cards = [repo.create_challenge(session_id, f"Card {i}", None, "Photo", "tier1", i) for i in range(3)]
        repo.refill_board(session_id)
        repo.set_board_visibility(session_id, True)
        # Legacy callers must also get permanent removal rather than requeueing.
        repo.defer_challenge(session_id, cards[2]["id"])
        repo.discard_challenge(session_id, cards[0]["id"])
        assert [c["id"] for c in repo.active_challenges(session_id)] == [cards[1]["id"]]
        repo.discard_challenge(session_id, cards[1]["id"])
        repo.refill_board(session_id)
        repo.set_board_visibility(session_id, False)
        repo.set_board_visibility(session_id, True)
        assert repo.active_challenges(session_id) == []
        assert repo.queued_challenges(session_id) == []
        repo.reorder_queue(session_id, [], [])
        assert all(c["is_discarded"] for c in repo.all_challenges(session_id))
    finally:
        _cleanup(session_id)
