from uuid import UUID
from fastapi import APIRouter,Depends,BackgroundTasks
from pydantic import BaseModel,Field
from app import repo
from app.deps import current_member,require_admin
from app.game_map import MapPlan,MapPoint
from app.map_runtime import map_runtime
from app.realtime import hub

admin=APIRouter(prefix='/api/admin/sessions',tags=['map'],dependencies=[Depends(require_admin)])
players=APIRouter(prefix='/api/location',tags=['map'])

class Device(BaseModel):
    device_id: UUID
class Share(Device):
    lease: UUID
class Fix(Share,MapPoint):
    accuracy_m: float=Field(ge=0,le=100000,allow_inf_nan=False)

class TimerPosition(BaseModel):
    elapsed_seconds: int=Field(ge=0,le=86400,strict=True)

@admin.post('/{session_id}/map/pause')
def pause_timer(session_id:str,background:BackgroundTasks):
    repo.pause_map_timer(session_id,True)
    background.add_task(map_runtime.schedule,session_id)
    background.add_task(hub.broadcast,session_id)
    return {'ok':True}

@admin.post('/{session_id}/map/resume')
def resume_timer(session_id:str,background:BackgroundTasks):
    repo.pause_map_timer(session_id,False)
    background.add_task(map_runtime.schedule,session_id)
    background.add_task(hub.broadcast,session_id)
    return {'ok':True}

@admin.post('/{session_id}/map/seek')
def seek_timer(session_id:str,body:TimerPosition,background:BackgroundTasks):
    repo.seek_map_timer(session_id,body.elapsed_seconds)
    background.add_task(map_runtime.schedule,session_id)
    background.add_task(hub.broadcast,session_id)
    return {'ok':True}

@admin.put('/{session_id}/map')
def configure(session_id:str,plan:MapPlan,background:BackgroundTasks):
    repo.configure_map(session_id,plan.model_dump())
    background.add_task(map_runtime.schedule,session_id)
    background.add_task(hub.broadcast,session_id)
    return {'ok':True}

@admin.post('/{session_id}/map/start')
def start_timer(session_id:str,background:BackgroundTasks):
    repo.set_map_timer(session_id,True)
    background.add_task(map_runtime.schedule,session_id)
    background.add_task(hub.broadcast,session_id)
    return {'ok':True}

@admin.post('/{session_id}/map/reset')
def reset_timer(session_id:str,background:BackgroundTasks):
    repo.set_map_timer(session_id,False)
    background.add_task(map_runtime.schedule,session_id)
    background.add_task(hub.broadcast,session_id)
    return {'ok':True}

@admin.post('/{session_id}/map/shrink')
def shrink_area(session_id:str,background:BackgroundTasks):
    stage=repo.shrink_map(session_id)
    background.add_task(map_runtime.schedule,session_id)
    background.add_task(hub.broadcast,session_id)
    return {'stage_index':stage}

@players.post('/start')
def start_share(body:Device,background:BackgroundTasks,member=Depends(current_member)):
    result=repo.start_location(member['team']['id'],str(body.device_id))
    background.add_task(hub.map_event,member['session']['id'],{'kind':'location_removed','team_id':member['team']['id'],'device_id':str(body.device_id),'revision':result['revision']})
    return result

@players.put('')
def send_fix(body:Fix,background:BackgroundTasks,member=Depends(current_member)):
    location=repo.update_location(member['team']['id'],body.model_dump(mode='json'))
    location['team_name']=member['team']['name']
    background.add_task(hub.map_event,member['session']['id'],{'kind':'location','location':location},lease=str(body.lease))
    return {'ok':True}

@players.delete('')
def stop_share(body:Share,background:BackgroundTasks,member=Depends(current_member)):
    result=repo.stop_location(member['team']['id'],str(body.device_id),str(body.lease))
    if result:background.add_task(hub.map_event,member['session']['id'],{'kind':'location_removed',**result})
    return {'ok':True}
