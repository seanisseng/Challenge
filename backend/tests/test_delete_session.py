from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import repo, realtime
from app.config import get_settings
from app.main import app


@pytest.fixture
def deletion(monkeypatch):
    monkeypatch.setenv("ADMIN_PIN", "delete-tests")
    get_settings.cache_clear()
    delete = Mock()
    close = AsyncMock()
    monkeypatch.setattr(repo, "delete_session", delete, raising=False)
    monkeypatch.setattr(realtime.hub, "close_room", close, raising=False)
    yield TestClient(app), {"X-Admin-Token": get_settings().admin_token}, delete, close
    get_settings.cache_clear()


def test_host_can_delete_only_the_requested_session(deletion):
    client, headers, delete, close = deletion
    response = client.delete("/api/admin/sessions/selected-session", headers=headers)
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    delete.assert_called_once_with("selected-session")
    close.assert_awaited_once_with("selected-session")


def test_deletion_requires_host_authentication(deletion):
    client, _, delete, close = deletion
    assert client.delete("/api/admin/sessions/selected-session").status_code == 401
    delete.assert_not_called()
    close.assert_not_awaited()


def test_missing_session_does_not_disconnect_players(deletion):
    client, headers, delete, close = deletion
    delete.side_effect = HTTPException(status_code=404, detail="session not found")
    response = client.delete("/api/admin/sessions/missing", headers=headers)
    assert response.status_code == 404
    close.assert_not_awaited()


def test_repository_delete_is_scoped_to_session_id(monkeypatch):
    query = Mock()
    query.delete.return_value = query
    query.eq.return_value = query
    query.execute.return_value.data = [{"id": "selected-session"}]
    select = Mock(return_value=query)
    monkeypatch.setattr(repo, "_select", select)
    repo.delete_session("selected-session")
    select.assert_called_once_with("game_sessions")
    query.delete.assert_called_once_with()
    query.eq.assert_called_once_with("id", "selected-session")


def test_repository_returns_404_when_nothing_deleted(monkeypatch):
    query = Mock()
    query.delete.return_value = query
    query.eq.return_value = query
    query.execute.return_value.data = []
    monkeypatch.setattr(repo, "_select", lambda table: query)
    with pytest.raises(HTTPException) as error:
        repo.delete_session("missing")
    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_deleted_room_disconnects_only_its_subscribers():
    hub = realtime.Hub()
    deleted = realtime.Subscriber(ws=Mock(close=AsyncMock()), session_id="deleted", kind="admin")
    other = realtime.Subscriber(ws=Mock(close=AsyncMock()), session_id="other", kind="admin")
    await hub.register(deleted)
    await hub.register(other)
    await hub.close_room("deleted")
    deleted.ws.close.assert_awaited_once()
    other.ws.close.assert_not_awaited()
    assert hub.presence("deleted") == 0
    assert hub.presence("other") == 1
