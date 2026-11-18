from datetime import datetime,timedelta,timezone
import pytest
from pydantic import ValidationError
from app.game_map import MapPlan, public_map


def test_requested_defaults_keep_finish_inside_and_allow_start_outside_final():
    from app.game_map import default_plan, distance
    value=default_plan()
    MapPlan(**value)
    start=value['stages'][0]
    assert (start['lat'],start['lng'])==(1.3108674745426903,103.86352181175857)
    assert value['finish']=={'lat':1.2993920420142073,'lng':103.90664926387365}
    assert [s['radius_m'] for s in value['stages']]==[7000,5000,3000]
    assert [s['after_seconds'] for s in value['stages']]==[0,3600,7200]
    assert distance(start,value['stages'][-1])>3000


def test_manual_shrink_before_countdown_and_future_timed_stage():
    value=plan()
    value['stages'].append({**value['stages'][1],'radius_m':1000,'after_seconds':1200})
    value['stages'][1]['after_seconds']=None
    MapPlan(**value)
    now=datetime.now(timezone.utc)
    session={'status':'active','playing_area':value,'map_started_at':None,'map_stage_floor':1}
    manual=public_map(session,[],now)
    assert manual['stage_index']==1 and manual['next_shrink_at'] is None
    session['map_started_at']=now.isoformat()
    timed=public_map(session,[],now+timedelta(seconds=1200))
    assert timed['stage_index']==2 and timed['next_shrink_at'] is None


def plan():
    return {'finish':{'lat':1.3,'lng':103.9},'stages':[
        {'lat':1.31,'lng':103.9,'radius_m':5000,'after_seconds':0},
        {'lat':1.3,'lng':103.9,'radius_m':1500,'after_seconds':600}]}


def test_plan_rejects_excluded_finish_non_nested_areas_and_bad_schedule():
    MapPlan(**plan())
    for change in ('finish','nested','time'):
        value=plan()
        if change=='finish':value['finish']['lat']=2
        if change=='nested':value['stages'][1].update(lat=1.33,radius_m=3000)
        if change=='time':value['stages'][1]['after_seconds']=0
        with pytest.raises(ValidationError):MapPlan(**value)


def test_current_area_advances_without_exposing_finish_or_future_stages():
    now=datetime.now(timezone.utc)
    session={'status':'active','playing_area':{'stages':plan()['stages']},'final_destination':plan()['finish'],'map_started_at':now.isoformat()}
    before=public_map(session,[],now+timedelta(seconds=599))
    after=public_map(session,[],now+timedelta(seconds=600))
    assert before['stage_index']==0 and after['stage_index']==1
    assert before['area']['radius_m']==5000 and after['area']['radius_m']==1500
    assert 'finish' not in before and 'final_destination' not in before and 'stages' not in before
    assert before['next_shrink_at'] is not None and after['next_shrink_at'] is None


def test_paused_clock_preserves_area_and_remaining_time_after_reload():
    start=datetime.now(timezone.utc)
    session={'status':'active','playing_area':plan(),'map_started_at':start.isoformat(),'map_paused_at':(start+timedelta(seconds=300)).isoformat()}
    first=public_map(session,[],start+timedelta(seconds=400))
    later=public_map(session,[],start+timedelta(seconds=1400))
    assert first['stage_index']==later['stage_index']==0
    assert first['paused_at']==session['map_paused_at']
    assert first['next_shrink_at']==later['next_shrink_at']
