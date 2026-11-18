import time
from datetime import datetime,timezone
from unittest.mock import AsyncMock,Mock
import pytest
from app import snapshots,repo
from app.realtime import Hub,Subscriber

@pytest.fixture(autouse=True)
def map_policy(monkeypatch):
    monkeypatch.setattr(repo,'map_visibility',lambda _:({'hidden_team_ids':[],'revision':0}),raising=False)

def test_host_hidden_team_is_removed_from_player_payload_but_visible_to_itself(monkeypatch):
    monkeypatch.setattr(repo,'team_submissions',lambda _:[])
    monkeypatch.setattr(repo,'team_clues',lambda _:[])
    core={'session':{'id':'room','status':'active'},'board':[],'progress':[],
          '_hidden_location_team_ids':['rival'],
          'map':{'visibility_revision':3,'locations':[{'team_id':'own'},{'team_id':'rival'}]}}
    result=snapshots.team_payload(member(),core=core,location_until=time.time()+60)
    assert result['map']['locations']==[{'team_id':'own'}]
    assert '_hidden_location_team_ids' not in result
    own=snapshots.team_payload(member('rival'),core=core,location_until=time.time()+60)
    assert {'team_id':'rival'} in own['map']['locations']

@pytest.mark.asyncio
async def test_hidden_team_gps_never_reaches_other_teams(monkeypatch):
    monkeypatch.setattr(repo,'map_visibility',lambda _:{'hidden_team_ids':['rival'],'revision':4})
    hub=Hub();sockets=[Mock(send_json=AsyncMock()) for _ in range(3)]
    for socket,kind,team in zip(sockets,['team','team','admin'],['own','rival','admin']):
        await hub.register(Subscriber(ws=socket,session_id='room',kind=kind,member=member(team) if kind=='team' else None,location_until=time.time()+60,tracking_visible=True))
    await hub.map_event('room',{'kind':'location','location':{'team_id':'rival','device_id':'phone'}})
    sockets[0].send_json.assert_not_called()
    assert sockets[1].send_json.call_args.args[0]['visibility_revision']==4
    assert sockets[2].send_json.call_args.args[0]['kind']=='location'

@pytest.mark.asyncio
async def test_access_revocation_carries_current_visibility_revision(monkeypatch):
    monkeypatch.setattr(repo,'map_visibility',lambda _:{'hidden_team_ids':[],'revision':5})
    hub=Hub();socket=Mock(send_json=AsyncMock())
    sub=Subscriber(ws=socket,session_id='room',kind='team',member=member(),tracking_visible=True,location_until=0)
    await hub.register(sub)
    await hub.map_event('room',{'kind':'location','location':{'team_id':'rival','device_id':'phone'}})
    assert socket.send_json.call_args.args[0]=={'kind':'map_access','can_track_teams':False,'session_id':'room','visibility_revision':5}

def member(team='own'):
    return {'id':'pool','name':'Team','team':{'id':team,'name':team},'session':{'id':'room'}}

def test_unshared_snapshot_redacts_rivals_and_valid_device_access_allows_them(monkeypatch):
    monkeypatch.setattr(snapshots.repo,'team_submissions',lambda _:[])
    monkeypatch.setattr(snapshots.repo,'team_clues',lambda _:[])
    core={'session':{'id':'room','status':'active'},'board':[],'progress':[],
          'map':{'locations':[{'team_id':'own'},{'team_id':'rival'}]}}
    assert snapshots.team_payload(member(),core)['map']['locations']==[{'team_id':'own'}]
    assert len(snapshots.team_payload(member(),core,location_until=time.time()+60)['map']['locations'])==2
    assert snapshots.team_payload(member(),core,location_until=time.time()-1)['map']['can_track_teams'] is False
    assert len(core['map']['locations'])==2


def test_player_snapshots_hide_timer_timestamps_without_changing_host_data(monkeypatch):
    monkeypatch.setattr(snapshots.repo,'team_submissions',lambda _:[])
    monkeypatch.setattr(snapshots.repo,'team_clues',lambda _:[])
    core={'session':{'id':'room','status':'active'},'board':[],'progress':[],
          'map':{'locations':[],'started_at':'private-start','paused_at':'private-pause','next_shrink_at':'private-next'}}
    public=snapshots.team_payload(member(),core,location_until=time.time()+60)['map']
    for key in ('started_at','paused_at','next_shrink_at'):
        assert public[key] is None
        assert core['map'][key].startswith('private-')

@pytest.mark.asyncio
async def test_live_events_require_this_devices_sharing_and_revoke_on_stop():
    hub=Hub();sockets=[Mock(send_json=AsyncMock()) for _ in range(3)]
    watching=Subscriber(ws=sockets[0],session_id='room',kind='team',member=member(),location_device_id='phone',location_lease='secret',location_until=time.time()+60,tracking_visible=True)
    declined=Subscriber(ws=sockets[1],session_id='room',kind='team',member=member())
    admin=Subscriber(ws=sockets[2],session_id='room',kind='admin')
    for sub in (watching,declined,admin):await hub.register(sub)
    event={'kind':'location','location':{'team_id':'rival','device_id':'other','updated_at':datetime.now(timezone.utc).isoformat()}}
    await hub.map_event('room',event)
    assert sockets[0].send_json.await_count==1
    assert sockets[1].send_json.await_count==0
    assert sockets[2].send_json.await_count==1
    await hub.map_event('room',{'kind':'location_removed','team_id':'own','device_id':'phone','revision':2})
    sockets[0].send_json.reset_mock()
    await hub.map_event('room',event)
    assert sockets[0].send_json.await_count==0

@pytest.mark.asyncio
async def test_expired_sharing_drops_rival_events_and_revoked_lease_cannot_renew():
    hub=Hub();ws=Mock(send_json=AsyncMock())
    sub=Subscriber(ws=ws,session_id='room',kind='team',member=member(),location_device_id='phone',location_lease='old',location_until=time.time()-1,tracking_visible=True)
    await hub.register(sub)
    await hub.map_event('room',{'kind':'location','location':{'team_id':'rival','device_id':'other'}})
    assert ws.send_json.call_args.args[0]['kind']=='map_access'
    ws.send_json.reset_mock()
    await hub.map_event('room',{'kind':'location','location':{'team_id':'own','device_id':'phone','updated_at':datetime.now(timezone.utc).isoformat()}},lease='new')
    assert not sub.can_track

def test_rest_and_websocket_apply_device_proof_to_each_viewer(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app import repo
    monkeypatch.setattr(repo,'member_by_token',lambda _:member())
    monkeypatch.setattr(repo,'touch_member',lambda _:None)
    monkeypatch.setattr(repo,'team_submissions',lambda _:[])
    monkeypatch.setattr(repo,'team_clues',lambda _:[])
    core={'session':{'id':'room','status':'active'},'board':[],'progress':[],
          'map':{'locations':[{'team_id':'own'},{'team_id':'rival'}]}}
    monkeypatch.setattr(snapshots,'session_core',lambda _:core)
    proof=Mock(side_effect=lambda team,device,lease:time.time()+60 if team=='own' and device=='phone' and lease=='private' else 0)
    monkeypatch.setattr(repo,'location_access_until',proof)
    client=TestClient(app)
    headers={'X-Team-Token':'shared'}
    assert len(client.get('/api/state',headers=headers).json()['map']['locations'])==1
    headers.update({'X-Location-Device':'phone','X-Location-Lease':'private'})
    assert len(client.get('/api/state',headers=headers).json()['map']['locations'])==2
    with client.websocket_connect('/ws?token=shared') as socket:
        assert len(socket.receive_json()['map']['locations'])==1
    with client.websocket_connect('/ws?token=shared&location_device=phone&location_lease=private') as socket:
        assert len(socket.receive_json()['map']['locations'])==2
    with client.websocket_connect('/ws?token=shared&location_device=other&location_lease=private') as socket:
        assert len(socket.receive_json()['map']['locations'])==1

def test_device_proof_requires_matching_team_device_lease_and_recent_fix(monkeypatch):
    from app import repo
    device='00000000-0000-0000-0000-000000000001'
    lease='00000000-0000-0000-0000-000000000002'
    query=Mock();query.select.return_value=query;query.eq.return_value=query;query.limit.return_value=query
    query.execute.return_value.data=[{'lat':1.3,'updated_at':datetime.now(timezone.utc).isoformat()}]
    table=Mock(return_value=query);monkeypatch.setattr(repo,'_select',table)
    assert repo.location_access_until('own',device,lease)>time.time()
    for field,value in (('team_id','own'),('device_id',device),('lease',lease)):
        assert ((field,value),) in [(call.args,) for call in query.eq.call_args_list]
    query.execute.return_value.data=[{'lat':None,'updated_at':None}]
    assert repo.location_access_until('own',device,lease)==0
    assert repo.location_access_until('own',None,None)==0

@pytest.mark.asyncio
async def test_correct_lease_refresh_recovers_expired_access_with_a_new_snapshot(monkeypatch):
    hub=Hub();ws=Mock(send_json=AsyncMock())
    sub=Subscriber(ws=ws,session_id='room',kind='team',member=member(),location_device_id='phone',location_lease='secret',location_until=0)
    await hub.register(sub)
    monkeypatch.setattr(snapshots,'team_payload',lambda *args,**kwargs:{'kind':'team','map':{'can_track_teams':True}})
    await hub.map_event('room',{'kind':'location','location':{'team_id':'own','device_id':'phone','updated_at':datetime.now(timezone.utc).isoformat()}},lease='secret')
    assert sub.can_track
    assert ws.send_json.call_args_list[0].args[0]['map']['can_track_teams'] is True
