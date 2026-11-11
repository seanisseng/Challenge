"""Board visibility is enforced in payloads, with queue details admin-only."""

from unittest.mock import AsyncMock, Mock

import pytest
from fastapi.testclient import TestClient

from app import repo, snapshots
from app.config import get_settings
from app.main import app


@pytest.fixture
def board_api(monkeypatch):
    monkeypatch.setenv("ADMIN_PIN", "board-tests")
    get_settings.cache_clear()
    mocks = {}
    for name in ["set_board_visibility", "defer_challenge", "discard_challenge", "reorder_queue"]:
        mocks[name] = Mock()
        monkeypatch.setattr(repo, name, mocks[name], raising=False)
    from app.routers.admin import hub
    mocks["broadcast"] = AsyncMock()
    monkeypatch.setattr(hub, "broadcast", mocks["broadcast"])
    yield TestClient(app), {"X-Admin-Token": get_settings().admin_token}, mocks
    get_settings.cache_clear()


@pytest.mark.parametrize("action,visible", [("reveal", True), ("hide", False)])
def test_visibility_control_broadcasts(board_api, action, visible):
    client, headers, mocks = board_api
    response = client.post(f"/api/admin/sessions/session/board/{action}", headers=headers)
    assert response.status_code == 200
    mocks["set_board_visibility"].assert_called_once_with("session", visible)
    mocks["broadcast"].assert_awaited_once_with("session")


def test_legacy_defer_endpoint_broadcasts(board_api):
    client, headers, mocks = board_api
    response = client.post("/api/admin/sessions/session/challenges/challenge/defer", headers=headers)
    assert response.status_code == 200
    mocks["defer_challenge"].assert_called_once_with("session", "challenge")
    mocks["broadcast"].assert_awaited_once_with("session")


def test_remove_challenge_for_session_broadcasts(board_api):
    client, headers, mocks = board_api
    assert client.post("/api/admin/sessions/session/challenges/challenge/discard", headers=headers).status_code == 200
    mocks["discard_challenge"].assert_called_once_with("session", "challenge")
    mocks["broadcast"].assert_awaited_once_with("session")


def test_queue_reorder_broadcasts(board_api):
    client, headers, mocks = board_api
    ids = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"]
    response = client.post("/api/admin/sessions/session/queue/reorder", headers=headers, json={"challenge_ids": ids[::-1], "expected_ids": ids})
    assert response.status_code == 200
    mocks["reorder_queue"].assert_called_once_with("session", ids[::-1], ids)
    mocks["broadcast"].assert_awaited_once_with("session")


@pytest.mark.parametrize("path", ["board/reveal", "board/hide", "challenges/challenge/defer", "challenges/challenge/discard", "queue/reorder"])
def test_board_controls_require_admin(board_api, path):
    client, _, mocks = board_api
    assert client.post(f"/api/admin/sessions/session/{path}").status_code == 401
    mocks["broadcast"].assert_not_called()


@pytest.mark.parametrize("visible", [False, True])
def test_hidden_board_keeps_admin_preview_but_never_leaks_to_team(monkeypatch, visible):
    session = {"id": "session", "name": "Game", "room_code": "CODE", "status": "active", "team_count": 2, "active_task_limit": 6, "board_visible": visible}
    monkeypatch.setattr(repo, "get_session", lambda _: session)
    monkeypatch.setattr(repo, "active_challenges", lambda _: [{"id": "live", "title": "Live"}])
    monkeypatch.setattr(repo, "queued_challenges", lambda _: [{"id": "next", "title": "Next"}], raising=False)
    for name in ["progress", "list_teams", "list_members", "session_submissions", "team_submissions", "team_clues"]:
        monkeypatch.setattr(repo, name, lambda _: [])
    core = snapshots.session_core("session")
    member = {"id": "member", "name": "Player", "session": session, "team": {"id": "team", "name": "Team"}}
    team = snapshots.team_payload(member, core)
    admin = snapshots.admin_payload("session", core)
    assert team["session"]["board_visible"] is visible
    assert [c["id"] for c in team["board"]] == (["live"] if visible else [])
    assert "queue" not in team
    assert [c["id"] for c in admin["board"]] == ["live"]
    assert [c["id"] for c in admin["queue"]] == ["next"]
