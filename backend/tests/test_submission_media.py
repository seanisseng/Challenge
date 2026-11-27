from unittest.mock import Mock,AsyncMock
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.main import app
from app import repo
from app.deps import current_member,require_admin
from app.realtime import hub
from app.routers import play

@pytest.fixture
def evidence(monkeypatch):
    app.dependency_overrides[current_member]=lambda:{'id':'member','team':{'id':'team'},'session':{'id':'room'}}
    upload=Mock(side_effect=lambda session,team,name,data,mime:f'{session}/{team}/{name}')
    submit=Mock(return_value='new-submission');cleanup=Mock()
    monkeypatch.setattr(repo,'upload_proof',upload)
    monkeypatch.setattr(repo,'submit_evidence',submit,raising=False)
    monkeypatch.setattr(repo,'remove_proof_files',cleanup,raising=False)
    monkeypatch.setattr(repo,'require_submission_open',Mock(),raising=False)
    monkeypatch.setattr(hub,'broadcast',AsyncMock())
    def prepare(source,destination,content_type):destination.write_bytes(source.read_bytes());return 5
    monkeypatch.setattr(play,'prepare_video',prepare)
    yield TestClient(app),upload,submit,cleanup
    app.dependency_overrides.clear()

@pytest.mark.parametrize('text',['','   \n '])
def test_empty_submissions_are_rejected(evidence,text):
    client,upload,submit,_=evidence
    assert client.post('/api/submissions',data={'challenge_id':'challenge','text':text}).status_code==400
    upload.assert_not_called();submit.assert_not_called()

def test_text_only_submission_is_valid(evidence):
    client,upload,submit,_=evidence
    response=client.post('/api/submissions',data={'challenge_id':'challenge','text':'  Our answer  '})
    assert response.status_code==200;upload.assert_not_called()
    submit.assert_called_once_with('team','member','challenge',[],'Our answer')

@pytest.mark.parametrize('mime,name',[('image/jpeg','photo.jpg'),('video/mp4','clip.mp4')])
def test_vercel_attachment_budget_rejects_oversized_files_before_processing(evidence,monkeypatch,mime,name):
    client,upload,submit,_=evidence
    prepare=Mock();monkeypatch.setattr(play,'prepare_video',prepare)
    response=client.post('/api/submissions',data={'challenge_id':'challenge'},
                         files=[('files',(name,b'x'*(4*1024*1024+1),mime))])
    assert response.status_code==413
    prepare.assert_not_called();upload.assert_not_called();submit.assert_not_called()

@pytest.mark.parametrize('extra',[0,1])
def test_vercel_budget_is_combined_across_new_and_legacy_file_fields(evidence,extra):
    client,upload,submit,_=evidence
    half=2*1024*1024
    response=client.post('/api/submissions',data={'challenge_id':'challenge','text':'x'*4000},
                         files=[('files',('photo.jpg',b'x'*half,'image/jpeg')),
                                ('file',('clip.mp4',b'x'*(half+extra),'video/mp4'))])
    assert response.status_code==(413 if extra else 200)
    if extra:
        upload.assert_not_called();submit.assert_not_called()
    else:
        assert upload.call_count==2;submit.assert_called_once()

def test_pending_submission_is_rejected_before_processing_or_storage(evidence,monkeypatch):
    client,upload,submit,_=evidence
    monkeypatch.setattr(repo,'require_submission_open',Mock(side_effect=HTTPException(409,'Your proof is awaiting host review.')))
    prepare=Mock();monkeypatch.setattr(play,'prepare_video',prepare)
    response=client.post('/api/submissions',data={'challenge_id':'challenge'},files=[('files',('clip.mp4',b'video','video/mp4'))])
    assert response.status_code==409
    prepare.assert_not_called();upload.assert_not_called();submit.assert_not_called()

def test_mixed_images_video_and_text_create_one_submission(evidence):
    client,upload,submit,_=evidence
    response=client.post('/api/submissions',data={'challenge_id':'challenge','text':'Group proof'},files=[('files',('a.jpg',b'image','image/jpeg')),('files',('b.mp4',b'video','video/mp4'))])
    assert response.status_code==200;assert upload.call_count==2;assert submit.call_count==1
    args=submit.call_args.args
    assert [item['content_type'] for item in args[3]]==['image/jpeg','video/mp4'];assert args[4]=='Group proof'

def test_invalid_or_excess_media_is_rejected_before_upload(evidence):
    client,upload,submit,_=evidence
    for files,status in [([('files',('empty.jpg',b'','image/jpeg'))],400),([('files',('bad.pdf',b'data','application/pdf'))],415),([('files',(f'{i}.jpg',b'image','image/jpeg')) for i in range(11)],400)]:
        assert client.post('/api/submissions',data={'challenge_id':'challenge'},files=files).status_code==status
    assert client.post('/api/submissions',data={'challenge_id':'challenge','text':'a'*4001}).status_code==422
    upload.assert_not_called();submit.assert_not_called()

def test_failed_upload_cleans_partial_files_without_creating_submission(evidence):
    client,upload,submit,cleanup=evidence
    upload.side_effect=['room/team/first.jpg',HTTPException(status_code=503,detail='Upload interrupted')]
    response=client.post('/api/submissions',data={'challenge_id':'challenge'},files=[('files',('a.jpg',b'a','image/jpeg')),('files',('b.jpg',b'b','image/jpeg'))])
    assert response.status_code==503;submit.assert_not_called();cleanup.assert_called_once_with(['room/team/first.jpg'])

def test_host_can_review_all_media_or_text_without_changing_approval(evidence,monkeypatch):
    client,*_=evidence
    app.dependency_overrides[require_admin]=lambda:True
    row={'photo_path':None,'attachments':[],'proof_text':'Text alone'}
    monkeypatch.setattr(repo,'submission',lambda _:row)
    monkeypatch.setattr(repo,'signed_url',lambda path:f'https://storage.invalid/{path}')
    response=client.get('/api/admin/submissions/proof/photo')
    assert response.status_code==200
    assert response.json()=={'url':None,'attachments':[],'text':'Text alone'}
    row['attachments']=[{'path':'image','content_type':'image/jpeg'},{'path':'video','content_type':'video/mp4'}]
    result=client.get('/api/admin/submissions/proof/photo').json()
    assert len(result['attachments'])==2
    assert result['attachments'][1]['url']=='https://storage.invalid/video'
    assert result['attachments'][1]['download_url']=='https://storage.invalid/video?download=attachment'
