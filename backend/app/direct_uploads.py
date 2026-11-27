"""Private direct-upload capabilities, bounded verification and orphan cleanup."""
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic
from urllib.parse import urlsplit
import httpx
from fastapi import HTTPException
from app import repo
from app.config import get_settings
from app.video import inspect_video


def authorize(request_id, challenge_id, files, member):
    result=repo.rpc('authorize_proof_uploads',{
        'p_request_id':str(request_id),'p_team_id':member['team']['id'],
        'p_member_id':member['id'],'p_challenge_id':str(challenge_id),'p_files':files,
    },retry=True)
    settings=get_settings()
    client=repo._client().storage.from_(settings.proof_bucket)
    uploads=[]
    for row in result['uploads']:
        token=None
        if not row['verified_at']:
            try:
                signed=client.create_signed_upload_url(row['path'])
                token=signed['token']
            except Exception as error:
                raise HTTPException(503,'Could not authorize Storage upload. Retry this saved draft.') from error
        uploads.append({key:row[key] for key in ('id','path','name','content_type','size','ordinal','verified_at')}|{'token':token})
    base=settings.supabase_url.rstrip('/')
    host=urlsplit(base).hostname or ''
    if host.endswith('.supabase.co') and not host.endswith('.storage.supabase.co'):
        base='https://'+host.removesuffix('.supabase.co')+'.storage.supabase.co'
    return {'batch_id':result['batch_id'],'submission_id':result['submission_id'],'uploads':uploads,
            'bucket':settings.proof_bucket,'endpoint':base+'/storage/v1/upload/resumable/sign'}


def get_upload(upload_id, team_id):
    rows=(repo._select('proof_uploads').select('*,proof_upload_batches!inner(expires_at,submission_id)')
          .eq('id',str(upload_id)).eq('team_id',team_id).limit(1).execute().data)
    if not rows:raise HTTPException(404,'Upload not found')
    row=rows[0]
    if datetime.fromisoformat(row['proof_upload_batches']['expires_at'].replace('Z','+00:00'))<=datetime.now(timezone.utc):
        raise HTTPException(410,'Upload session expired. Start a new upload.')
    repo.get_session(row['session_id'])
    return row


def download_upload(row, target):
    try:
        exists=repo._client().storage.from_(get_settings().proof_bucket).exists(row['path'])
    except Exception as error:
        raise HTTPException(503,'Storage verification is unavailable. Retry.') from error
    if not exists:raise HTTPException(409,'Upload is not finished yet')
    url=repo.signed_url(row['path'],expires_in=120)
    if not url:raise HTTPException(503,'Could not read the uploaded file. Retry verification.')
    if urlsplit(url).hostname!=urlsplit(get_settings().supabase_url).hostname:
        raise HTTPException(503,'Unexpected Storage download endpoint')
    deadline=monotonic()+90;size=0
    try:
        with httpx.stream('GET',url,timeout=30,follow_redirects=False) as response:
            if response.status_code==404:raise HTTPException(409,'Upload is not finished yet')
            if response.status_code!=200:raise HTTPException(503,'Storage verification is unavailable. Retry.')
            with target.open('wb') as stream:
                for chunk in response.iter_bytes(64*1024):
                    size+=len(chunk)
                    if size>row['size'] or size>45*1024*1024:raise HTTPException(413,'Uploaded file exceeds its declared size')
                    if monotonic()>deadline:raise HTTPException(503,'Verification took too long. Retry.')
                    stream.write(chunk)
    except httpx.HTTPError as error:
        raise HTTPException(503,'Storage connection interrupted. Retry verification.') from error
    if size!=row['size']:raise HTTPException(400,'Uploaded file size does not match this draft')


def image_matches(path, content_type):
    with path.open('rb') as stream:head=stream.read(64)
    return {
        'image/jpeg':head.startswith(b'\xff\xd8\xff'),
        'image/png':head.startswith(b'\x89PNG\r\n\x1a\n'),
        'image/gif':head[:6] in (b'GIF87a',b'GIF89a'),
        'image/webp':head[:4]==b'RIFF' and head[8:12]==b'WEBP',
        'image/heic':head[4:8]==b'ftyp' and any(brand in head[8:] for brand in (b'heic',b'heix',b'hevc',b'mif1')),
        'image/heif':head[4:8]==b'ftyp' and any(brand in head[8:] for brand in (b'heic',b'heix',b'hevc',b'mif1',b'msf1')),
    }.get(content_type,False)


def verify_upload(upload_id, team_id):
    row=get_upload(upload_id,team_id)
    if row['verified_at']:return {'ok':True}
    with TemporaryDirectory(prefix='verify-proof-') as directory:
        path=Path(directory)/'upload'
        download_upload(row,path)
        if row['content_type']=='video/mp4':
            duration=inspect_video(path,require_compatible=True)
        else:
            if not image_matches(path,row['content_type']):raise HTTPException(415,'Uploaded image does not match its declared format')
            duration=None
    # Finalization rechecks session existence and challenge availability under
    # database locks. Never trust duration, size or arbitrary paths from clients.
    repo._select('proof_uploads').update({'verified_at':datetime.now(timezone.utc).isoformat(),
                                         'duration_seconds':duration}).eq('id',str(upload_id)).eq('team_id',team_id).execute()
    return {'ok':True}


def cleanup_expired():
    jobs=repo.rpc('expired_proof_uploads',{'p_limit':50},retry=True)
    bucket=repo._client().storage.from_(get_settings().proof_bucket)
    removed=0
    for job in jobs:
        if job['paths']:bucket.remove(job['paths'])
        repo._select('proof_upload_batches').delete().eq('id',job['batch_id']).execute()
        removed+=1
    return removed
