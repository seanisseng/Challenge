from unittest.mock import Mock
from fastapi.testclient import TestClient
from app import repo,snapshots
from app.main import app


def test_code_only_join_and_legacy_name_use_the_same_team_identity(monkeypatch):
    joined=Mock(return_value={'member_token':'shared-token'})
    monkeypatch.setattr(repo,'join_team',joined)
    monkeypatch.setattr(repo,'member_by_token',Mock(return_value={'id':'pool','team':{'id':'team'}}))
    monkeypatch.setattr(snapshots,'team_payload',Mock(return_value={'team':{'id':'team'},'clues':[{'id':'earned'}]}))
    client=TestClient(app)
    for payload in ({'code':'TEAM01'},{'code':'TEAM01','name':'Ignored legacy name'}):
        result=client.post('/api/join',json=payload)
        assert result.status_code==200
        assert result.json()['token']=='shared-token'
        assert result.json()['state']['clues']==[{'id':'earned'}]
    assert joined.call_args_list[0].args==('TEAM01',)
    assert joined.call_args_list[1].args==('TEAM01',)


def test_repository_join_sends_only_the_team_code(monkeypatch):
    rpc=Mock(return_value=[{'member_token':'shared-token'}])
    monkeypatch.setattr(repo,'rpc',rpc)
    assert repo.join_team('TEAM01')['member_token']=='shared-token'
    rpc.assert_called_once_with('join_team',{'p_join_code':'TEAM01'})


def test_player_snapshot_includes_only_their_own_team_code():
    member={'id':'member','name':'Player','session':{'id':'room'},
            'team':{'id':'own','name':'Our team','join_code':'OWN123'}}
    room={'core':{'session':{'id':'room','status':'active','board_visible':True},
                  'board':[],'progress':[],'clue_awards':[]},
          'submissions':{},'clues':{},
          'teams':[member['team'],{'id':'rival','join_code':'RIVAL1'}]}
    result=snapshots.team_payload(member,room=room)
    assert result['team']['join_code']=='OWN123'
    assert 'RIVAL1' not in str(result)
