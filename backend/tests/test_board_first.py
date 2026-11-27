from threading import Barrier
from unittest.mock import Mock
import pytest

from fastapi.testclient import TestClient
from app import repo,snapshots
from app.deps import current_member
from app.main import app


def identity():
    return {'id':'member','name':'Player','team':{'id':'team','name':'Our team','join_code':'TEAM01'},'session':{'id':'room'}}


def test_board_restore_reads_only_critical_data_in_parallel(monkeypatch):
    barrier=Barrier(3)
    def result(value):
        def read(*_):
            barrier.wait(timeout=3)
            return value
        return read
    session={'id':'room','name':'Hunt','room_code':'ROOM01','status':'active','team_count':8,'active_task_limit':6,'board_visible':True}
    proof={'id':'proof','challenge_id':'task','status':'pending','submitted_at':'2026-11-28T00:00:00Z'}
    monkeypatch.setattr(repo,'get_session',result(session))
    monkeypatch.setattr(repo,'active_challenges',result([{'id':'task','title':'Our task'}]))
    monkeypatch.setattr(repo,'team_submissions',result([proof]))
    for name in ('progress','recent_clue_awards','map_locations','team_clues'):
        monkeypatch.setattr(repo,name,Mock(side_effect=AssertionError(f'{name} must load later')))
    snapshot=snapshots.team_board_payload(identity())
    assert snapshot['loading_details'] is True
    assert snapshot['board'][0]['my_submission']['status']=='pending'
    assert snapshot['my_submissions']==[proof]
    assert snapshot['team']['join_code']=='TEAM01'
    assert snapshot['progress']==snapshot['clues']==[]
    assert 'map' not in snapshot
    assert 'clue_awards' not in snapshot


def test_lightweight_state_skips_presence_and_location_access(monkeypatch):
    member=identity()
    app.dependency_overrides[current_member]=lambda:member
    snapshot=Mock(return_value={'kind':'team','loading_details':True,'board':[]})
    monkeypatch.setattr(snapshots,'team_board_payload',snapshot)
    touch=Mock();access=Mock()
    monkeypatch.setattr(repo,'touch_member',touch)
    monkeypatch.setattr(repo,'location_access_until',access)
    try:
        response=TestClient(app).get('/api/state?view=board')
        assert response.status_code==200
        assert response.json()['loading_details'] is True
        snapshot.assert_called_once_with(member)
        touch.assert_not_called();access.assert_not_called()
    finally:
        app.dependency_overrides.pop(current_member,None)


def test_join_with_team_code_can_request_the_lightweight_board(monkeypatch):
    monkeypatch.setattr(repo,'join_team',Mock(return_value={'member_token':'token'}))
    member=identity();monkeypatch.setattr(repo,'member_by_token',lambda _:member)
    board=Mock(return_value={'kind':'team','board':[],'loading_details':True})
    monkeypatch.setattr(snapshots,'team_board_payload',board)
    monkeypatch.setattr(snapshots,'team_payload',Mock(side_effect=AssertionError('Full state must load later')))
    response=TestClient(app).post('/api/join?view=board',json={'code':'TEAM01'})
    assert response.status_code==200
    assert response.json()['state']['loading_details'] is True
    board.assert_called_once_with(member)


@pytest.mark.parametrize('status,visible',[('lobby',True),('active',False),('ended',True)])
def test_board_restore_respects_hidden_and_inactive_games(monkeypatch,status,visible):
    session={'id':'room','name':'Hunt','room_code':'ROOM01','status':status,'team_count':8,'active_task_limit':6,'board_visible':visible}
    monkeypatch.setattr(repo,'get_session',lambda _:session)
    monkeypatch.setattr(repo,'active_challenges',lambda _:[{'id':'task','title':'Hidden task'}])
    monkeypatch.setattr(repo,'team_submissions',lambda _:[])
    assert snapshots.team_board_payload(identity())['board']==[]
