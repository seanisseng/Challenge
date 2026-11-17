from unittest.mock import Mock,AsyncMock
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app import repo,snapshots
from app.deps import current_member,require_admin
from app.map_runtime import map_runtime
from app.realtime import hub


def test_map_and_location_routes_require_credentials(monkeypatch):
    from app.config import get_settings
    monkeypatch.setenv("ADMIN_PIN","map-tests");get_settings.cache_clear()
    client=TestClient(app)
    assert client.post('/api/location/start',json={'device_id':'00000000-0000-0000-0000-000000000001'}).status_code==401
    assert client.post('/api/admin/sessions/room/map/start').status_code==401
    assert client.post('/api/admin/sessions/room/map/shrink').status_code==401
    assert client.post('/api/admin/sessions/room/map/seek',json={'elapsed_seconds':1}).status_code==401
    assert client.post('/api/admin/sessions/room/map/pause').status_code==401
    assert client.post('/api/admin/sessions/room/map/resume').status_code==401
    get_settings.cache_clear()


def test_location_cannot_target_another_team_or_expose_the_lease(monkeypatch):
    member={'team':{'id':'own','name':'Own'},'session':{'id':'room'}}
    app.dependency_overrides[current_member]=lambda:member
    result={'lease':'private-lease','revision':1}
    start=Mock(return_value=result)
    monkeypatch.setattr(repo,'start_location',start)
    event=AsyncMock();monkeypatch.setattr(hub,'map_event',event)
    try:
        device='00000000-0000-0000-0000-000000000001'
        response=TestClient(app).post('/api/location/start',json={'device_id':device,'team_id':'rival'})
        assert response.status_code==200 and response.json()['lease']=='private-lease'
        start.assert_called_once_with('own',device)
        broadcast=event.call_args.args[1]
        assert broadcast['team_id']=='own' and 'lease' not in broadcast
    finally:app.dependency_overrides.clear()


def test_player_snapshot_never_contains_host_map_configuration(monkeypatch):
    secret={'finish':{'lat':1.234567,'lng':103.987654},'plan':{'stages':[{'after_seconds':999}]}}
    core={'session':{'id':'room','status':'active'},'board':[],'progress':[],
          'map':{'configured':True,'locations':[]},'_host_map':secret}
    monkeypatch.setattr(repo,'team_submissions',lambda _:[])
    monkeypatch.setattr(repo,'team_clues',lambda _:[])
    member={'id':'device','name':'unused','team':{'id':'own','name':'Own'},'session':{'id':'room'}}
    payload=snapshots.team_payload(member,core)
    assert payload['map']=={'configured':True,'locations':[],'can_track_teams':False}
    assert 'finish' not in str(payload) and '_host_map' not in payload


def test_location_grant_rpc_json_response_is_preserved(monkeypatch):
    rpc=Mock(return_value={'lease':'secret','revision':1})
    monkeypatch.setattr(repo,'rpc',rpc)
    assert repo.start_location('team','device')=={'lease':'secret','revision':1}


def test_host_shrink_updates_timer_and_broadcasts(monkeypatch):
    app.dependency_overrides[require_admin]=lambda:True
    shrink=Mock(return_value=1);monkeypatch.setattr(repo,'shrink_map',shrink)
    schedule=AsyncMock();broadcast=AsyncMock()
    monkeypatch.setattr(map_runtime,'schedule',schedule);monkeypatch.setattr(hub,'broadcast',broadcast)
    try:
        response=TestClient(app).post('/api/admin/sessions/room/map/shrink')
        assert response.status_code==200 and response.json()=={'stage_index':1}
        shrink.assert_called_once_with('room')
        schedule.assert_awaited_once_with('room');broadcast.assert_awaited_once_with('room')
    finally:app.dependency_overrides.clear()


def test_prefilled_private_defaults_never_enter_public_map():
    session={'id':'room','name':'New','room_code':'ABC','status':'active','team_count':2,'active_task_limit':6}
    core=snapshots._core(session,[],[],[])
    assert [s['radius_m'] for s in core['_host_map']['plan']['stages']]==[7000,5000,3000]
    assert core['_host_map']['finish']['lng']==103.90664926387365
    assert core['map']['configured'] is False
    assert 'finish' not in core['map'] and 'plan' not in core['map']


def test_host_can_seek_and_reschedule_the_shared_countdown(monkeypatch):
    app.dependency_overrides[require_admin]=lambda:True
    seek=Mock();monkeypatch.setattr(repo,'seek_map_timer',seek)
    schedule=AsyncMock();broadcast=AsyncMock()
    monkeypatch.setattr(map_runtime,'schedule',schedule);monkeypatch.setattr(hub,'broadcast',broadcast)
    try:
        client=TestClient(app)
        assert client.post('/api/admin/sessions/room/map/seek',json={'elapsed_seconds':570}).status_code==200
        seek.assert_called_once_with('room',570)
        schedule.assert_awaited_once_with('room');broadcast.assert_awaited_once_with('room')
        for invalid in (-1,86401,1.5,True):
            assert client.post('/api/admin/sessions/room/map/seek',json={'elapsed_seconds':invalid}).status_code==422
        assert seek.call_count==1
    finally:app.dependency_overrides.clear()


@pytest.mark.parametrize('action,paused',[('pause',True),('resume',False)])
def test_host_pause_resume_broadcast_and_reschedule(monkeypatch,action,paused):
    app.dependency_overrides[require_admin]=lambda:True
    change=Mock();monkeypatch.setattr(repo,'pause_map_timer',change)
    schedule=AsyncMock();broadcast=AsyncMock()
    monkeypatch.setattr(map_runtime,'schedule',schedule);monkeypatch.setattr(hub,'broadcast',broadcast)
    try:
        assert TestClient(app).post(f'/api/admin/sessions/room/map/{action}').status_code==200
        change.assert_called_once_with('room',paused)
        schedule.assert_awaited_once_with('room');broadcast.assert_awaited_once_with('room')
    finally:app.dependency_overrides.clear()
