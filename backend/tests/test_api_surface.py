"""Tests for the HTTP surface that need no database.

These assert the shape of the API and the two credential gates. Anything that
touches Postgres lives in ``test_live_flow.py`` and is skipped unless you opt
in.
"""

from __future__ import annotations

import hashlib
import hmac

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app

client = TestClient(app)

TEST_PIN = "test-pin-9137"


@pytest.fixture(autouse=True)
def _fixed_admin_pin(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin ADMIN_PIN so the tests never depend on the local .env file."""
    monkeypatch.setenv("ADMIN_PIN", TEST_PIN)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def expected_token() -> str:
    return hmac.new(TEST_PIN.encode(), b"challenge-admin-v1", hashlib.sha256).hexdigest()


# --------------------------------------------------------------------------- #
# surface
# --------------------------------------------------------------------------- #
def test_openapi_exposes_the_full_api() -> None:
    paths = app.openapi()["paths"]

    for path in (
        "/health",
        "/api/join",
        "/api/state",
        "/api/submissions",
        "/api/clues",
        "/api/admin/login",
        "/api/admin/sessions",
        "/api/admin/sessions/{session_id}/state",
        "/api/admin/sessions/{session_id}/start",
        "/api/admin/sessions/{session_id}/end",
        "/api/admin/sessions/{session_id}/challenges",
        "/api/admin/sessions/{session_id}/challenges/{challenge_id}/image",
        "/api/admin/sessions/{session_id}/board/reveal",
        "/api/admin/sessions/{session_id}/board/hide",
        "/api/admin/sessions/{session_id}/challenges/{challenge_id}/defer",
        "/api/admin/sessions/{session_id}/challenges/{challenge_id}/discard",
        "/api/admin/sessions/{session_id}/queue/reorder",
        "/api/admin/sessions/{session_id}/clues",
        "/api/admin/submissions/{submission_id}/approve",
        "/api/admin/submissions/{submission_id}/reject",
        "/api/admin/submissions/{submission_id}/photo",
        "/api/admin/members/{member_id}",
    ):
        assert path in paths, f"missing route {path}"


def test_websocket_route_is_registered() -> None:
    from app.routers import ws as ws_router

    paths = {getattr(route, "path", None) for route in ws_router.router.routes}
    assert "/ws" in paths


# --------------------------------------------------------------------------- #
# team credential
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/state"),
        ("get", "/api/clues"),
    ],
)
def test_team_endpoints_reject_missing_token(method: str, path: str) -> None:
    resp = getattr(client, method)(path)
    assert resp.status_code == 401
    assert "team token" in resp.json()["detail"]


def test_team_endpoints_reject_garbage_token() -> None:
    resp = client.get("/api/state", headers={"X-Team-Token": "not-a-uuid"})
    assert resp.status_code == 401


def test_submit_requires_a_team_token() -> None:
    resp = client.post(
        "/api/submissions",
        data={"challenge_id": "00000000-0000-0000-0000-000000000000"},
        files={"file": ("proof.jpg", b"\xff\xd8\xff", "image/jpeg")},
    )
    assert resp.status_code == 401


# --------------------------------------------------------------------------- #
# admin credential
# --------------------------------------------------------------------------- #
def test_admin_login_rejects_a_wrong_pin() -> None:
    resp = client.post("/api/admin/login", json={"pin": "nope"})
    assert resp.status_code == 401
    assert resp.json()["detail"] == "incorrect PIN"


def test_admin_login_returns_the_derived_token() -> None:
    resp = client.post("/api/admin/login", json={"pin": TEST_PIN})
    assert resp.status_code == 200
    assert resp.json()["token"] == expected_token()


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/admin/sessions"),
        ("get", "/api/admin/sessions/abc/state"),
        ("post", "/api/admin/sessions/abc/start"),
        ("post", "/api/admin/sessions/abc/end"),
        ("post", "/api/admin/sessions/abc/challenges/def/image"),
        ("post", "/api/admin/submissions/abc/approve"),
        ("post", "/api/admin/submissions/abc/reject"),
        ("get", "/api/admin/submissions/abc/photo"),
        ("delete", "/api/admin/members/abc"),
    ],
)
def test_admin_endpoints_reject_missing_token(method: str, path: str) -> None:
    resp = getattr(client, method)(path)
    assert resp.status_code == 401
    assert resp.json()["detail"] == "invalid admin token"


def test_admin_token_rotates_with_the_pin(monkeypatch: pytest.MonkeyPatch) -> None:
    first = client.post("/api/admin/login", json={"pin": TEST_PIN}).json()["token"]

    monkeypatch.setenv("ADMIN_PIN", "a-different-pin")
    get_settings.cache_clear()
    second = client.post(
        "/api/admin/login", json={"pin": "a-different-pin"}
    ).json()["token"]

    assert first != second
    # The old token no longer opens anything.
    resp = client.get("/api/admin/sessions", headers={"X-Admin-Token": first})
    assert resp.status_code == 401


def test_admin_is_unavailable_when_no_pin_is_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ADMIN_PIN", "")
    get_settings.cache_clear()

    assert client.post("/api/admin/login", json={"pin": "x"}).status_code == 503
    resp = client.get(
        "/api/admin/sessions", headers={"X-Admin-Token": expected_token()}
    )
    assert resp.status_code == 503
