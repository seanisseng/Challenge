from unittest.mock import Mock
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from app import repo

SESSION='00000000-0000-0000-0000-000000000001'

def file(name):return {'id':'object','name':name,'metadata':{}}
def folder(name):return {'id':None,'name':name,'metadata':None}

def test_storage_listing_walks_nested_folders_and_all_pages_before_removing():
    bucket=Mock()
    def listing(prefix,options):
        if prefix==SESSION:return [folder('team'),file('reference.jpg')]
        return [file(f'{i}.mp4') for i in range(options['offset'],min(205,options['offset']+100))]
    bucket.list.side_effect=listing
    paths=repo._storage_session_paths(bucket,SESSION)
    assert len(paths)==206
    assert f'{SESSION}/team/204.mp4' in paths
    assert all(path.startswith(SESSION+'/') for path in paths)
    bucket.remove.assert_not_called()

def test_storage_path_traversal_is_rejected():
    bucket=Mock();bucket.list.return_value=[file('../other-game')]
    with pytest.raises(ValueError):repo._storage_session_paths(bucket,SESSION)
    bucket.remove.assert_not_called()

@pytest.fixture
def cleanup(monkeypatch):
    job={'session_id':SESSION,'buckets':['proofs','assets'],'attempts':0}
    query=Mock()
    for method in ('select','eq','limit','update','delete'):getattr(query,method).return_value=query
    query.execute.return_value=SimpleNamespace(data=[job])
    monkeypatch.setattr(repo,'_select',lambda _:query)
    buckets={name:Mock() for name in job['buckets']}
    for bucket in buckets.values():bucket.list.side_effect=[[file('old.jpg')],[]]
    client=Mock();client.storage.from_.side_effect=lambda name:buckets[name]
    monkeypatch.setattr(repo,'_client',lambda:client)
    monkeypatch.setattr(repo,'_preserve_shared_assets',Mock())
    return job,query,buckets

def test_cleanup_removes_both_bucket_prefixes_and_then_completes_job(cleanup):
    _,query,buckets=cleanup
    assert repo._cleanup_session_media(SESSION) is False
    for bucket in buckets.values():bucket.remove.assert_called_once_with([f'{SESSION}/old.jpg'])
    query.delete.assert_called_once()

def test_storage_failure_keeps_job_for_retry(cleanup):
    _,query,buckets=cleanup
    buckets['proofs'].remove.side_effect=RuntimeError('network failed')
    assert repo._cleanup_session_media(SESSION) is True
    query.delete.assert_not_called()
    assert query.update.call_args.args[0]=={'last_error':'RuntimeError'}

def test_upload_after_session_deletion_never_recreates_media(monkeypatch):
    monkeypatch.setattr(repo,'get_session',Mock(side_effect=HTTPException(404,'session not found')))
    upload=Mock();monkeypatch.setattr(repo,'_upload_object',upload)
    with pytest.raises(HTTPException):repo.upload_proof(SESSION,'team','video.mp4',b'video','video/mp4')
    upload.assert_not_called()

def test_database_failure_after_deletion_reports_pending_cleanup(monkeypatch):
    monkeypatch.setattr(repo,'rpc',Mock())
    monkeypatch.setattr(repo,'_cleanup_session_media',Mock(side_effect=RuntimeError('database interrupted')))
    assert repo.delete_session(SESSION) is True

def test_legacy_shared_assets_are_copied_and_relinked_before_removal(monkeypatch):
    path=SESSION+'/reference.jpg'
    query=Mock()
    for method in ('select','like','is_'):getattr(query,method).return_value=query
    query.not_=query
    def select(table):
        query.execute.return_value=SimpleNamespace(data=[{'image_path':path}] if table=='challenge_templates' else [])
        return query
    monkeypatch.setattr(repo,'_select',select)
    action=Mock();monkeypatch.setattr(repo,'rpc',action)
    bucket=Mock();bucket.exists.return_value=False
    repo._preserve_shared_assets(bucket,SESSION,[path,SESSION+'/private.jpg'])
    bucket.copy.assert_called_once()
    assert bucket.copy.call_args.args[0]==path
    assert bucket.copy.call_args.args[1].startswith('_shared/')
    assert action.call_args.args[0]=='relocate_shared_session_asset'
    assert action.call_args.args[1]['p_old_path']==path

@pytest.mark.asyncio
async def test_cleanup_worker_retries_failure_and_stops(monkeypatch):
    import asyncio
    from app import media_cleanup
    attempts=[]
    def retry():
        attempts.append(True)
        if len(attempts)==1:raise RuntimeError('temporary failure')
    monkeypatch.setattr(repo,'retry_session_media_deletions',retry)
    monkeypatch.setattr(media_cleanup,'RETRY_INTERVAL',.01)
    worker=media_cleanup.SessionMediaCleanup();await worker.start()
    try:
        for _ in range(100):
            if len(attempts)>=2:break
            await asyncio.sleep(.01)
        assert len(attempts)>=2
    finally:await worker.close()
    assert worker.task is None
