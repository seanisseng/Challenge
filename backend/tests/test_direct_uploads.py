from unittest.mock import Mock
import pytest
from fastapi import HTTPException
from app import direct_uploads
from types import SimpleNamespace
from fastapi.testclient import TestClient
from app.main import app
from app.deps import current_member
from app.routers import uploads
from app import repo


def test_verification_rejects_foreign_upload_before_storage(monkeypatch):
    monkeypatch.setattr(direct_uploads,'get_upload',Mock(side_effect=HTTPException(404,'Upload not found')))
    storage=Mock();monkeypatch.setattr(direct_uploads,'download_upload',storage)
    with pytest.raises(HTTPException):direct_uploads.verify_upload('foreign','team')
    storage.assert_not_called()


def test_completed_upload_verification_is_idempotent(monkeypatch):
    row={'id':'upload','verified_at':'now','size':10}
    monkeypatch.setattr(direct_uploads,'get_upload',lambda *_:row)
    storage=Mock();monkeypatch.setattr(direct_uploads,'download_upload',storage)
    assert direct_uploads.verify_upload('upload','team')['ok'] is True
    storage.assert_not_called()


@pytest.mark.parametrize('valid',[True,False])
def test_image_bytes_are_checked_before_marking_verified(monkeypatch,valid):
    row={'id':'upload','verified_at':None,'content_type':'image/png'}
    monkeypatch.setattr(direct_uploads,'get_upload',lambda *_:row)
    monkeypatch.setattr(direct_uploads,'download_upload',lambda _,path:path.write_bytes(b'\x89PNG\r\n\x1a\n' if valid else b'not an image'))
    query=Mock();query.update.return_value=query;query.eq.return_value=query
    monkeypatch.setattr(repo,'_select',lambda _:query)
    if valid:
        assert direct_uploads.verify_upload('upload','team')=={'ok':True}
        query.update.assert_called_once()
    else:
        with pytest.raises(HTTPException) as error:direct_uploads.verify_upload('upload','team')
        assert error.value.status_code==415;query.update.assert_not_called()


def test_probe_failure_never_marks_video_verified(monkeypatch):
    row={'id':'upload','verified_at':None,'content_type':'video/mp4'}
    monkeypatch.setattr(direct_uploads,'get_upload',lambda *_:row)
    monkeypatch.setattr(direct_uploads,'download_upload',lambda _,path:path.write_bytes(b'video'))
    monkeypatch.setattr(direct_uploads,'inspect_video',Mock(side_effect=HTTPException(400,'Videos must be 30 seconds or shorter')))
    update=Mock();monkeypatch.setattr(repo,'_select',update)
    with pytest.raises(HTTPException):direct_uploads.verify_upload('upload','team')
    update.assert_not_called()


def test_signed_uploads_only_use_server_generated_paths(monkeypatch):
    row={'id':'upload','path':'room/team/random.mp4','name':'clip.mp4','content_type':'video/mp4','size':100,'ordinal':0,'verified_at':None}
    monkeypatch.setattr(repo,'rpc',Mock(return_value={'batch_id':'batch','submission_id':None,'uploads':[row]}))
    client=Mock();client.storage.from_.return_value.create_signed_upload_url.return_value={'token':'upload-token'}
    monkeypatch.setattr(repo,'_client',lambda:client)
    monkeypatch.setattr(direct_uploads,'get_settings',lambda:SimpleNamespace(proof_bucket='proofs',supabase_url='https://project.supabase.co'))
    result=direct_uploads.authorize('request','challenge',[],{'id':'member','team':{'id':'team'}})
    client.storage.from_.return_value.create_signed_upload_url.assert_called_once_with('room/team/random.mp4')
    assert result['endpoint']=='https://project.storage.supabase.co/storage/v1/upload/resumable'
    assert result['uploads'][0]['token']=='upload-token'


def test_cleanup_only_removes_expired_orphan_paths(monkeypatch):
    monkeypatch.setattr(repo,'rpc',Mock(return_value=[{'batch_id':'batch','paths':['room/team/orphan.mp4']}]))
    client=Mock();monkeypatch.setattr(repo,'_client',lambda:client)
    query=Mock();query.delete.return_value=query;query.eq.return_value=query;monkeypatch.setattr(repo,'_select',lambda _:query)
    assert direct_uploads.cleanup_expired()==1
    client.storage.from_.return_value.remove.assert_called_once_with(['room/team/orphan.mp4'])
    query.delete.assert_called_once()


def test_cleanup_endpoint_requires_backend_secret(monkeypatch):
    monkeypatch.setattr(uploads,'get_settings',lambda:SimpleNamespace(cron_secret='test-secret'))
    cleanup=Mock(return_value=1);monkeypatch.setattr(direct_uploads,'cleanup_expired',cleanup)
    monkeypatch.setattr(repo,'retry_session_media_deletions',Mock())
    client=TestClient(app)
    assert client.get('/api/internal/uploads/cleanup').status_code==401
    assert client.get('/api/internal/uploads/cleanup',headers={'Authorization':'Bearer wrong'}).status_code==401
    cleanup.assert_not_called()
    assert client.get('/api/internal/uploads/cleanup',headers={'Authorization':'Bearer test-secret'}).json()=={'ok':True,'batches_removed':1}


def test_authorization_rejects_oversized_manifest_without_storage(monkeypatch):
    app.dependency_overrides[current_member]=lambda:{'id':'member','team':{'id':'team'}}
    authorize=Mock();monkeypatch.setattr(direct_uploads,'authorize',authorize)
    try:
        response=TestClient(app).post('/api/uploads',json={'request_id':'00000000-0000-0000-0000-000000000001',
          'challenge_id':'00000000-0000-0000-0000-000000000002','files':[{'name':'large.mp4','content_type':'video/mp4','size':45*1024*1024+1}]})
        assert response.status_code==422;authorize.assert_not_called()
    finally:app.dependency_overrides.pop(current_member,None)


@pytest.mark.parametrize('actual,declared,status',[(4,3,413),(2,3,400)])
def test_storage_download_enforces_actual_byte_count(monkeypatch,tmp_path,actual,declared,status):
    client=Mock();client.storage.from_.return_value.exists.return_value=True
    monkeypatch.setattr(repo,'_client',lambda:client)
    monkeypatch.setattr(direct_uploads,'get_settings',lambda:SimpleNamespace(proof_bucket='proofs',supabase_url='https://project.supabase.co'))
    monkeypatch.setattr(repo,'signed_url',lambda *_args,**_kwargs:'https://project.supabase.co/storage/file?token=test')
    response=Mock();response.status_code=200;response.iter_bytes.return_value=[b'x'*actual]
    stream=Mock();stream.__enter__=Mock(return_value=response);stream.__exit__=Mock(return_value=False)
    monkeypatch.setattr(direct_uploads.httpx,'stream',lambda *_args,**_kwargs:stream)
    with pytest.raises(HTTPException) as error:direct_uploads.download_upload({'path':'room/team/object','size':declared},tmp_path/'copy')
    assert error.value.status_code==status


def test_non_mp4_bytes_never_reach_native_probe(monkeypatch,tmp_path):
    from app import video
    path=tmp_path/'fake.mp4';path.write_bytes(b'#EXTM3U\nfile:///private')
    process=Mock();monkeypatch.setattr(video.subprocess,'run',process)
    with pytest.raises(HTTPException) as error:video.inspect_video(path,require_compatible=True)
    assert error.value.status_code==415;process.assert_not_called()
