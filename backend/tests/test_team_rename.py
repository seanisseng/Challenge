from unittest.mock import Mock,AsyncMock
import pytest
from fastapi.testclient import TestClient
from app import repo,snapshots
from app.config import get_settings
from app.main import app
from app.deps import current_member
from app.realtime import hub


def test_team_rename_requires_a_team_credential():
    client=TestClient(app)
    assert client.patch('/api/team',json={'name':'Explorers'}).status_code==401


def test_team_can_only_rename_its_own_identity(monkeypatch):
    member={'id':'pool','name':'internal','team':{'id':'own-team','name':'Old'},'session':{'id':'room'}}
    app.dependency_overrides[current_member]=lambda:member
    rename=Mock(return_value='Explorers')
    broadcast=AsyncMock()
    monkeypatch.setattr(repo,'rename_team',rename,raising=False)
    monkeypatch.setattr(hub,'broadcast',broadcast)
    try:
        result=TestClient(app).patch('/api/team',json={'name':'Explorers','team_id':'rival-team'})
        assert result.status_code==200
        assert result.json()=={'name':'Explorers'}
        rename.assert_called_once_with('own-team','Explorers')
        broadcast.assert_awaited_once_with('room')
    finally:app.dependency_overrides.clear()


def test_connected_player_header_uses_fresh_team_name(monkeypatch):
    member={'id':'pool','name':'internal','team':{'id':'own-team','name':'Old'},'session':{'id':'room'}}
    core={'session':{'id':'room','status':'active'},'board':[],
          'progress':[{'team_id':'own-team','team_name':'Explorers'}]}
    monkeypatch.setattr(repo,'team_submissions',lambda _:[])
    monkeypatch.setattr(repo,'team_clues',lambda _:[])
    assert snapshots.team_payload(member,core)['team']['name']=='Explorers'
