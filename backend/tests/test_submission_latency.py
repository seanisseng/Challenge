from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from unittest.mock import Mock, AsyncMock
import pytest
from app import repo, snapshots


def test_uploads_overlap_but_cleanup_waits(monkeypatch):
    started=Event();release=Event();cleaned=Event();guard=Lock();count=0
    monkeypatch.setattr(repo,'get_session',lambda _: {})
    def upload(*_):
        nonlocal count
        with guard:
            count+=1
            if count==2:started.set()
        assert release.wait(3)
    monkeypatch.setattr(repo,'_upload_object',upload)
    def cleanup():
        with repo._media_lock('overlap-test'):cleaned.set()
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures=[pool.submit(repo._upload_session_object,'overlap-test','bucket',str(i),b'x','image/jpeg') for i in range(2)]
        try:
            assert started.wait(1), 'uploads were serialized'
            cleaning=pool.submit(cleanup)
            assert not cleaned.wait(.05)
        finally:release.set()
        for future in futures:future.result()
        cleaning.result()
    assert cleaned.is_set()


def test_review_returns_session_without_loading_submission(monkeypatch):
    rpc=Mock(return_value='room');monkeypatch.setattr(repo,'rpc',rpc)
    assert repo.review_submission('proof','approved','Good')=='room'
    rpc.assert_called_once_with('review_submission',{'p_submission_id':'proof','p_status':'approved','p_note':'Good'},retry=True)


def test_game_updates_omit_map_and_other_teams_private_evidence():
    data={'session':{'id':'room','status':'active','board_visible':True},'board':[{'id':'task'}],
          'progress':[],'clue_awards':[],'queue':[],
          'submissions':[{'id':'mine','team_id':'a','challenge_id':'task','status':'pending','review_note':None,'submitted_at':'now'},
                         {'id':'secret','team_id':'b','challenge_id':'task','proof_text':'private'}],
          'clues':{'a':[{'id':'own'}],'b':[{'id':'private-clue'}]}}
    event=snapshots.team_game_update('a',data)
    assert event['kind']=='team_update'
    assert [row['id'] for row in event['changes']['my_submissions']]==['mine']
    assert event['changes']['clues']==[{'id':'own'}]
    assert 'map' not in event['changes']
    assert 'private' not in str(event)


def test_upload_concurrency_is_bounded_and_failure_releases_slots():
    from app.media_gate import MediaGate
    gate=MediaGate();release=Event();full=Event();guard=Lock();active=0;peak=0
    def transfer():
        nonlocal active,peak
        with gate.upload():
            with guard:
                active+=1;peak=max(active,peak)
                if active==4:full.set()
            try:assert release.wait(5)
            finally:
                with guard:active-=1
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures=[pool.submit(transfer) for _ in range(6)]
        try:assert full.wait(3)
        finally:release.set()
        for future in futures:future.result()
    assert peak==4
    with pytest.raises(RuntimeError):
        with gate.upload():raise RuntimeError('transfer failed')
    with gate:assert gate.active==0


@pytest.mark.parametrize('action,status',[('approve','approved'),('reject','rejected')])
def test_review_api_uses_one_database_call(monkeypatch,action,status):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.deps import require_admin
    from app.realtime import hub
    review=Mock(return_value='room');broadcast=AsyncMock()
    monkeypatch.setattr(repo,'review_submission',review)
    monkeypatch.setattr(repo,'submission',Mock(side_effect=AssertionError('extra lookup')))
    monkeypatch.setattr(hub,'broadcast_game',broadcast)
    app.dependency_overrides[require_admin]=lambda:None
    try:
        assert TestClient(app).post(f'/api/admin/submissions/proof/{action}',json={'note':'Reviewed'}).json()=={'ok':True}
        review.assert_called_once_with('proof',status,'Reviewed')
        broadcast.assert_awaited_once_with('room')
    finally:app.dependency_overrides.pop(require_admin,None)


def test_game_reads_skip_maps_rosters_and_duplicate_submission_queries(monkeypatch):
    monkeypatch.setattr(repo,'get_session',lambda _: {'id':'room','status':'active','board_visible':True})
    monkeypatch.setattr(repo,'list_teams',lambda _: [{'id':'team'}])
    for name in ('active_challenges','progress','recent_clue_awards','queued_challenges'):
        monkeypatch.setattr(repo,name,lambda *_: [])
    monkeypatch.setattr(repo,'clues_by_team',lambda _: {})
    submissions=Mock(return_value=[]);monkeypatch.setattr(repo,'session_submissions',submissions)
    for name in ('map_locations','members_by_team','submissions_by_team'):
        monkeypatch.setattr(repo,name,Mock(side_effect=AssertionError('unnecessary read')))
    assert snapshots.game_data('room')['submissions']==[]
    submissions.assert_called_once_with('room')
