"""Player-facing endpoints. Identity comes from the X-Team-Token header."""

from __future__ import annotations

import asyncio
import mimetypes
from pathlib import Path
from tempfile import TemporaryDirectory
from app.video import copy_limited,prepare_video,MAX_VIDEO_SOURCE
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile,Request

from app import repo, snapshots
from app.config import get_settings
from app.deps import current_member
from app.models import JoinRequest, TeamNameRequest
from app.realtime import hub

router = APIRouter(prefix="/api", tags=["play"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "video/mp4", "video/webm", "video/quicktime"}


@router.post("/join")
def join(payload: JoinRequest) -> dict[str, Any]:
    """Join or rejoin shared team access using only the team code."""
    joined = repo.join_team(payload.code)
    token = str(joined["member_token"])

    member = repo.member_by_token(token)
    if member is None:
        raise HTTPException(status_code=500, detail="joined but could not load team")

    return {"token": token, "state": snapshots.team_payload(member)}


@router.get("/state")
def state(request:Request,member: dict[str, Any] = Depends(current_member)) -> dict[str, Any]:
    """The full snapshot this device needs to render the game."""
    repo.touch_member(member["id"])
    until=repo.location_access_until(member['team']['id'],request.headers.get('X-Location-Device'),request.headers.get('X-Location-Lease'))
    return snapshots.team_payload(member,location_until=until)


@router.post("/submissions")
async def submit_proof(
    request: Request,
    background: BackgroundTasks,
    challenge_id: str = Form(...),
    files: list[UploadFile] | None = File(None),
    file: UploadFile | None = File(None),
    text: str = Form('',max_length=4000),
    member: dict[str, Any] = Depends(current_member),
) -> dict[str, Any]:
    """Validate the complete draft, then upload its media and create one proof."""
    settings=get_settings()
    uploads=[*(files or []),*([file] if file else [])]
    message=text.strip()
    if not uploads and not message:
        raise HTTPException(status_code=400,detail='Add an image, a video, or a message before submitting.')
    if len(uploads)>10:
        raise HTTPException(status_code=400,detail='Attach at most 10 files per submission.')
    session_id=member['session']['id'];team_id=member['team']['id']
    await asyncio.to_thread(repo.require_submission_open,session_id,team_id,challenge_id)
    paths=[];attachments=[];registering=False
    with TemporaryDirectory(prefix='challenge-proof-') as directory:
        root=Path(directory);prepared=[];total=0
        for index,item in enumerate(uploads):
            name=(item.filename or 'attachment').replace('\\','/').split('/')[-1][:255]
            content_type=(item.content_type or '').lower()
            if not content_type or content_type=='application/octet-stream':content_type=mimetypes.guess_type(name)[0] or ''
            if content_type not in ALLOWED_TYPES:raise HTTPException(status_code=415,detail='Attach supported images or MP4, WebM, or MOV videos.')
            video=content_type.startswith('video/')
            source=root/f'{index}.source'
            size=await asyncio.to_thread(copy_limited,item.file,source,MAX_VIDEO_SOURCE if video else settings.max_upload_bytes)
            total+=size
            if total>2*1024*1024*1024:raise HTTPException(status_code=413,detail='Attachments must total 2 GiB or less before compression.')
            prepared.append((name,source,content_type,video))
        # Validate/prepare every file before anything is uploaded to Storage.
        processed=[]
        for index,(name,source,content_type,video) in enumerate(prepared):
            if await request.is_disconnected():raise HTTPException(499,'Upload cancelled.')
            duration=None
            if video:
                output=root/f'{index}.mp4'
                duration=await asyncio.to_thread(prepare_video,source,output,content_type)
                source=output;content_type='video/mp4';name=name.rsplit('.',1)[0]+'.mp4'
            processed.append((name,source,content_type,duration))
        try:
            for name,source,content_type,duration in processed:
                if await request.is_disconnected():raise HTTPException(499,'Upload cancelled.')
                with source.open('rb') as stream:
                    path=await asyncio.to_thread(repo.upload_proof,session_id,team_id,name,stream,content_type)
                paths.append(path)
                attachment={'path':path,'name':name,'content_type':content_type,'size':source.stat().st_size}
                if duration is not None:attachment['duration_seconds']=duration
                attachments.append(attachment)
            registering=True
            if await request.is_disconnected():raise HTTPException(499,'Upload cancelled.')
            submission_id=await asyncio.to_thread(repo.submit_evidence,team_id,member['id'],challenge_id,attachments,message)
        except Exception as error:
            # An uncertain database response may already have committed. Keep
            # its media rather than deleting files referenced by a valid proof.
            if paths and (not registering or isinstance(error,HTTPException) and error.status_code<500):
                await asyncio.to_thread(repo.remove_proof_files,paths)
            raise
    background.add_task(hub.broadcast,session_id)
    return {'ok':True,'submission_id':submission_id,'photo_path':paths[0] if paths else None}


@router.get("/clues")
def clues(member: dict[str, Any] = Depends(current_member)) -> list[dict[str, Any]]:
    """Only this team's unlocked clues."""
    return repo.team_clues(member["team"]["id"])


@router.patch("/team")
def rename_team(payload: TeamNameRequest, background: BackgroundTasks,
                member: dict[str, Any] = Depends(current_member)) -> dict[str, str]:
    name = repo.rename_team(member["team"]["id"], payload.name)
    background.add_task(hub.broadcast, member["session"]["id"])
    return {"name": name}
