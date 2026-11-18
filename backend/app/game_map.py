"""Public playing-area geometry; finish coordinates never enter player payloads."""
from datetime import datetime, timedelta, timezone
import math
from typing import Any
from pydantic import BaseModel, Field, model_validator

class MapPoint(BaseModel):
    lat: float = Field(ge=-85, le=85, allow_inf_nan=False)
    lng: float = Field(ge=-180, le=180, allow_inf_nan=False)

class MapStage(MapPoint):
    after_seconds: int | None = Field(default=None, ge=0, le=86400)
    radius_m: float = Field(ge=100, le=100000, allow_inf_nan=False)


def distance(a: dict, b: dict) -> float:
    lat1,lat2=map(math.radians,(a['lat'],b['lat']))
    dlat=lat2-lat1; dlng=math.radians(b['lng']-a['lng'])
    value=math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlng/2)**2
    return 6371000*2*math.asin(math.sqrt(min(1,value)))

class MapPlan(BaseModel):
    finish: MapPoint
    stages: list[MapStage] = Field(min_length=1,max_length=12)

    @model_validator(mode='after')
    def check_areas(self):
        if self.stages[0].after_seconds != 0: raise ValueError('The starting area must begin at 0 minutes.')
        last_time=0
        for i,stage in enumerate(self.stages):
            if distance(stage.model_dump(),self.finish.model_dump()) > stage.radius_m:
                raise ValueError('Every area must contain the hidden destination.')
            if i:
                previous=self.stages[i-1]
                if stage.after_seconds is not None:
                    if stage.after_seconds <= last_time: raise ValueError('Shrink times must increase.')
                    last_time=stage.after_seconds
                if stage.radius_m >= previous.radius_m: raise ValueError('Each area must be smaller than the previous area.')
                if distance(stage.model_dump(),previous.model_dump())+stage.radius_m > previous.radius_m+0.1:
                    raise ValueError('Each area must fit completely inside the previous area.')
        return self


def default_plan() -> dict:
    """Private host defaults. Never include this plan in a player response."""
    start={'lat':1.3108674745426903,'lng':103.86352181175857}
    finish={'lat':1.2993920420142073,'lng':103.90664926387365}
    # Shift by less than the 2 km reduction per stage, retaining nested circles
    # without making the finish their exact center. The start may leave the zone.
    stages=[]
    for fraction,radius in ((0,7000),(.35,5000),(.7,3000)):
        stages.append({**{key:start[key]+fraction*(finish[key]-start[key]) for key in start},
                       'radius_m':radius,'after_seconds':0 if not stages else None})
    return {'finish':finish,'stages':stages}


def utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace('Z','+00:00'))


def public_map(session:dict,locations:list[dict],now:datetime | None=None) -> dict[str,Any]:
    now=now or datetime.now(timezone.utc)
    stages=(session.get('playing_area') or {}).get('stages',[])
    started=session.get('map_started_at')
    paused=session.get('map_paused_at')
    active=session['status']=='active'
    elapsed=max(0,(now-utc(started)).total_seconds()) if started else 0
    if not active and session.get('ended_at') and started:
        elapsed=max(0,(utc(session['ended_at'])-utc(started)).total_seconds())
    if paused and started:elapsed=max(0,(utc(paused)-utc(started)).total_seconds())
    timed=max((i for i,s in enumerate(stages) if s.get('after_seconds') is not None and s['after_seconds']<=elapsed),default=0)
    index=min(max(timed,session.get('map_stage_floor',0)),max(0,len(stages)-1))
    next_stage=next((s for i,s in enumerate(stages) if i>index and s.get('after_seconds') is not None and s['after_seconds']>elapsed),None) if started and active else None
    return {'configured':bool(stages),'visibility_revision':session.get('map_visibility_revision',0),'initial_area':stages[0] if stages else None,
            'area':stages[index] if stages else None,'stage_index':index,'stage_count':len(stages),
            'started_at':started,'paused_at':paused,'next_shrink_at':(utc(started)+timedelta(seconds=next_stage['after_seconds'])).isoformat() if next_stage else None,
            'server_time':now.isoformat(),'locations':locations if active else []}
