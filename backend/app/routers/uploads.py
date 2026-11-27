from typing import Annotated, Literal
from uuid import UUID
import secrets
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, Field, model_validator, ConfigDict
from app import direct_uploads, repo
from app.config import get_settings
from app.deps import current_member
from app.realtime import hub

router=APIRouter(prefix='/api',tags=['uploads'])


class UploadFileInfo(BaseModel):
    model_config=ConfigDict(extra='forbid')
    name:str=Field(min_length=1,max_length=255)
    content_type:Literal['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','video/mp4']
    size:int=Field(gt=0,le=45*1024*1024,strict=True)

    @model_validator(mode='after')
    def image_limit(self):
        if self.content_type.startswith('image/') and self.size>25*1024*1024:
            raise ValueError('Images must be 25 MiB or smaller')
        return self


class UploadRequest(BaseModel):
    request_id:UUID
    challenge_id:UUID
    files:list[UploadFileInfo]=Field(max_length=10)


class FinalizeRequest(BaseModel):
    batch_id:UUID
    text:str=Field(default='',max_length=4000)


@router.post('/uploads')
def authorize(body:UploadRequest,member=Depends(current_member)):
    return direct_uploads.authorize(body.request_id,body.challenge_id,[item.model_dump() for item in body.files],member)


@router.post('/uploads/{upload_id}/complete')
def complete(upload_id:UUID,member=Depends(current_member)):
    return direct_uploads.verify_upload(upload_id,member['team']['id'])


@router.post('/submissions/finalize')
def finalize(body:FinalizeRequest,background:BackgroundTasks,member=Depends(current_member)):
    submission_id=repo.rpc('finalize_proof_uploads',{'p_batch_id':str(body.batch_id),'p_team_id':member['team']['id'],
                                                   'p_text':body.text.strip()},retry=True)
    background.add_task(hub.broadcast_game,member['session']['id'])
    return {'ok':True,'submission_id':submission_id,'photo_path':None}


@router.get('/internal/uploads/cleanup')
def cleanup(authorization:Annotated[str|None,Header()]=None):
    secret=get_settings().cron_secret
    if not secret:raise HTTPException(503,'Upload cleanup is not configured')
    if not authorization or not secrets.compare_digest(authorization,'Bearer '+secret):
        raise HTTPException(401,'Unauthorized')
    removed=direct_uploads.cleanup_expired()
    repo.retry_session_media_deletions()
    return {'ok':True,'batches_removed':removed}
