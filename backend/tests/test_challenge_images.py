"""Reference image API and snapshot guarantees, without external services."""

from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import repo, snapshots
from app.config import Settings, get_settings
from app.main import app

URL = "/api/admin/sessions/session/challenges/challenge/image"

@pytest.fixture(autouse=True)
def existing_session(monkeypatch):
    monkeypatch.setattr(repo,'get_session',lambda session_id:{'id':session_id})


@pytest.fixture
def image_api(monkeypatch):
    monkeypatch.setenv("ADMIN_PIN", "image-tests")
    monkeypatch.setenv("MAX_UPLOAD_BYTES", "8")
    get_settings.cache_clear()
    mocks = {}
    for name in ("get_challenge", "upload_challenge_image", "set_challenge_image"):
        mocks[name] = Mock()
        monkeypatch.setattr(repo, name, mocks[name], raising=False)
    mocks["get_challenge"].return_value = {"id": "challenge", "session_id": "session"}
    mocks["upload_challenge_image"].return_value = "session/photo.jpg"
    from app.routers.admin import hub
    from unittest.mock import AsyncMock
    mocks["broadcast"] = AsyncMock()
    monkeypatch.setattr(hub, "broadcast", mocks["broadcast"])
    yield TestClient(app), {"X-Admin-Token": get_settings().admin_token}, mocks
    get_settings.cache_clear()


def test_upload_links_image_and_broadcasts(image_api):
    client, headers, mocks = image_api
    response = client.post(URL, headers=headers, files={"file": ("ref.jpg", b"photo", "image/jpeg")})
    assert response.status_code == 200
    mocks["upload_challenge_image"].assert_called_once_with("session", "ref.jpg", b"photo", "image/jpeg")
    mocks["set_challenge_image"].assert_called_once_with("challenge", "session/photo.jpg")
    mocks["broadcast"].assert_awaited_once_with("session")


@pytest.mark.parametrize("data,mime,status", [
    (b"x", "text/html", 415), (b"x", "image/heic", 415),
    (b"", "image/png", 400), (b"123456789", "image/webp", 413),
])
def test_invalid_upload_never_writes(image_api, data, mime, status):
    client, headers, mocks = image_api
    response = client.post(URL, headers=headers, files={"file": ("ref.jpg", data, mime)})
    assert response.status_code == status
    mocks["upload_challenge_image"].assert_not_called()
    mocks["set_challenge_image"].assert_not_called()


def test_cross_session_upload_is_rejected(image_api):
    client, headers, mocks = image_api
    mocks["get_challenge"].return_value["session_id"] = "other-session"
    response = client.post(URL, headers=headers, files={"file": ("ref.jpg", b"x", "image/jpeg")})
    assert response.status_code == 404
    mocks["upload_challenge_image"].assert_not_called()


def test_missing_challenge_is_rejected(image_api):
    client, headers, mocks = image_api
    mocks["get_challenge"].side_effect = HTTPException(404, "challenge not found")
    assert client.post(URL, headers=headers, files={"file": ("ref.jpg", b"x", "image/jpeg")}).status_code == 404
    mocks["upload_challenge_image"].assert_not_called()


def test_storage_failure_does_not_link_or_broadcast(image_api):
    client, headers, mocks = image_api
    mocks["upload_challenge_image"].side_effect = HTTPException(400, "image upload failed")
    assert client.post(URL, headers=headers, files={"file": ("ref.jpg", b"x", "image/jpeg")}).status_code == 400
    mocks["set_challenge_image"].assert_not_called()
    mocks["broadcast"].assert_not_called()


def test_snapshot_replaces_object_key_without_mutating_row(monkeypatch):
    monkeypatch.setattr(repo, "get_settings", lambda: Settings(_env_file=None, supabase_url="https://example.supabase.co/"))
    row = {"id": "challenge", "title": "Pose", "image_path": "session/a photo.jpg"}
    rendered = snapshots._render_challenge(row)
    assert rendered["image_url"] == "https://example.supabase.co/storage/v1/object/public/challenge-assets/session/a%20photo.jpg"
    assert "image_path" not in rendered
    assert row["image_path"] == "session/a photo.jpg"
    assert snapshots._render_challenge({"title": "No photo"})["image_url"] is None


def test_upload_uses_safe_unique_object_keys(monkeypatch):
    client = Mock()
    monkeypatch.setattr(repo, "_client", lambda: client)
    path = repo.upload_challenge_image("session", "../../unsafe.html", b"photo", "image/png")
    assert path.startswith("session/") and path.endswith(".png")
    assert ".." not in path
    client.storage.from_.assert_called_once_with("challenge-assets")
    client.storage.from_().upload.assert_called_once_with(path, b"photo", {"content-type": "image/png", "upsert": "false"})


def test_bucket_limit_applies_even_if_proof_limit_is_higher(image_api, monkeypatch):
    client, headers, mocks = image_api
    monkeypatch.setenv("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024))
    get_settings.cache_clear()
    response = client.post(URL, headers=headers, files={"file": ("big.jpg", b"x" * (10 * 1024 * 1024 + 1), "image/jpeg")})
    assert response.status_code == 413
    mocks["upload_challenge_image"].assert_not_called()


def test_storage_error_is_safe_to_show(monkeypatch):
    client = Mock()
    client.storage.from_().upload.side_effect = RuntimeError("private request details")
    monkeypatch.setattr(repo, "_client", lambda: client)
    with pytest.raises(HTTPException) as caught:
        repo.upload_challenge_image("session", "ref.jpg", b"photo", "image/jpeg")
    assert caught.value.status_code == 400
    assert caught.value.detail == "image upload failed"


def test_missing_challenge_in_repository(monkeypatch):
    query = Mock()
    query.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
    monkeypatch.setattr(repo, "_select", lambda table: query)
    with pytest.raises(HTTPException) as caught:
        repo.get_challenge("missing")
    assert caught.value.status_code == 404


def test_repository_links_image(monkeypatch):
    query = Mock()
    monkeypatch.setattr(repo, "_select", lambda table: query)
    repo.set_challenge_image("challenge", "session/ref.jpg")
    query.update.assert_called_once_with({"image_path": "session/ref.jpg"})
    query.update.return_value.eq.assert_called_once_with("id", "challenge")


def test_reference_url_reaches_both_snapshot_audiences(monkeypatch):
    session = {"id": "session", "name": "Hunt", "room_code": "CODE", "status": "active", "team_count": 1, "active_task_limit": 6, "board_visible": True}
    monkeypatch.setattr(repo, "get_session", lambda _: session)
    monkeypatch.setattr(repo, "active_challenges", lambda _: [{"id": "challenge", "title": "Pose", "image_path": "session/ref.jpg"}])
    monkeypatch.setattr(repo, "public_asset_url", lambda path: f"https://assets/{path}")
    for name in ["progress", "list_teams", "list_members", "session_submissions", "team_submissions", "team_clues", "queued_challenges", "recent_clue_awards"]:
        monkeypatch.setattr(repo, name, lambda _: [])
    member = {"id": "member", "name": "Player", "session": session, "team": {"id": "team", "name": "Team"}}
    core = snapshots.session_core("session")
    for payload in [snapshots.team_payload(member, core), snapshots.admin_payload("session", core)]:
        assert payload["board"][0]["image_url"] == "https://assets/session/ref.jpg"
        assert "image_path" not in payload["board"][0]


@pytest.mark.parametrize("kind", ["reference", "proof"])
def test_storage_sdk_sends_the_image_mime_type(monkeypatch, kind):
    """Exercise the real SDK's multipart encoding, not a mocked upload method."""
    import httpx
    from storage3 import SyncStorageClient

    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={"Key": "bucket/photo.jpg", "Id": "object"})

    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        storage = SyncStorageClient("https://example.supabase.co/storage/v1/", {}, http_client=http)
        client = Mock(storage=storage)
        monkeypatch.setattr(repo, "_client", lambda: client)
        if kind == "reference":
            repo.upload_challenge_image("session", "photo.jpg", b"photo", "image/jpeg")
        else:
            repo.upload_proof("session", "team", "photo.jpg", b"photo", "image/jpeg")
    assert b"Content-Type: image/jpeg" in requests[0].content
