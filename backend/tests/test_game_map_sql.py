import json,uuid
import pytest
from app.game_map import default_plan,distance


def test_new_games_persist_independent_default_zones(full_database):
    sql=full_database
    first=sql("select session_id from create_session('Default map one',2,6)").stdout.strip()
    second=sql("select session_id from create_session('Default map two',2,6)").stdout.strip()
    for session in (first,second):
        row=json.loads(sql(f"select jsonb_build_object('plan',playing_area,'finish',final_destination,'started',map_started_at,'floor',map_stage_floor) from game_sessions where id='{session}'").stdout)
        assert row['plan']['stages']==default_plan()['stages']
        assert row['finish']==default_plan()['finish']
        assert row['started'] is None and row['floor']==0
        assert [s['radius_m'] for s in row['plan']['stages']]==[7000,5000,3000]
        assert distance(row['plan']['stages'][0],row['plan']['stages'][2])>3000
    sql(f"update game_sessions set playing_area=null where id='{first}'")
    assert sql(f"select playing_area is not null from game_sessions where id='{second}'").stdout.strip()=='t'

@pytest.fixture
def mapped_game(full_database):
    sql=full_database
    session=sql("select session_id from create_session('Map tests',2,6)").stdout.strip()
    teams=sql(f"select id from teams where session_id='{session}' order by name").stdout.splitlines()
    plan={'finish':{'lat':1.3,'lng':103.9},'stages':[{'lat':1.31,'lng':103.9,'radius_m':5000,'after_seconds':0},{'lat':1.3,'lng':103.9,'radius_m':1000,'after_seconds':600}]}
    sql(f"select configure_playing_area('{session}','{json.dumps(plan)}'::jsonb); select set_board_visibility('{session}',true)")
    yield sql,session,teams
    sql(f"delete from game_sessions where id='{session}'")


def grant(sql,team,device):
    return json.loads(sql(f"select to_jsonb(s) from start_location_share('{team}','{device}') s").stdout.strip())


def fix(sql,team,device,lease,check=True):
    return sql(f"select update_map_location('{team}','{device}','{lease}',1.3,103.9,10)",check=check)


def test_location_lease_prevents_cross_team_updates_and_late_resurrection(mapped_game):
    sql,_,teams=mapped_game
    device=str(uuid.uuid4()); first=grant(sql,teams[0],device)
    point=json.loads(fix(sql,teams[0],device,first['lease']).stdout.strip())
    assert point['team_id']==teams[0] and point['lat']==1.3
    assert fix(sql,teams[1],device,first['lease'],False).returncode!=0
    sql(f"select stop_location_share('{teams[0]}','{device}','{first['lease']}')")
    assert fix(sql,teams[0],device,first['lease'],False).returncode!=0
    second=grant(sql,teams[0],device)
    assert second['lease']!=first['lease']
    sql(f"select stop_location_share('{teams[0]}','{device}','{first['lease']}')")
    assert fix(sql,teams[0],device,second['lease']).returncode==0


def test_stale_coordinates_are_removed_and_game_end_clears_shares(mapped_game):
    sql,session,teams=mapped_game
    device=str(uuid.uuid4()); share=grant(sql,teams[0],device)
    fix(sql,teams[0],device,share['lease'])
    sql(f"update map_location_shares set updated_at=now()-interval '3 minutes' where team_id='{teams[0]}'")
    expired=json.loads(sql('select expire_map_locations()').stdout.strip())
    assert len(expired)==1
    assert sql('select count(*) from map_location_shares where lat is not null').stdout.strip()=='0'
    fix(sql,teams[0],device,share['lease'])
    sql(f"update game_sessions set status='ended' where id='{session}'")
    assert sql(f"select count(*) from map_location_shares where session_id='{session}'").stdout.strip()=='0'
    assert fix(sql,teams[0],device,share['lease'],False).returncode!=0


def test_timer_is_idempotent_plan_locked_while_running_and_grants_are_private(mapped_game):
    sql,session,_=mapped_game
    sql(f"select set_map_timer('{session}',true)")
    before=sql(f"select map_started_at from game_sessions where id='{session}'").stdout
    sql(f"select set_map_timer('{session}',true)")
    assert sql(f"select map_started_at from game_sessions where id='{session}'").stdout==before
    assert sql(f"select configure_playing_area('{session}','{{}}')",check=False).returncode!=0
    for role in ('anon','authenticated'):
        assert sql(f"set role {role}; select * from map_location_shares",check=False).returncode!=0
        assert sql(f"set role {role}; select set_map_timer('{session}',true)",check=False).returncode!=0


def test_manual_shrink_advances_once_moves_to_marker_and_resets(mapped_game):
    sql,session,_=mapped_game
    assert sql(f"select shrink_map_area('{session}')").stdout.strip()=='1'
    assert sql(f"select map_started_at is null from game_sessions where id='{session}'").stdout.strip()=='t'
    assert sql(f"select shrink_map_area('{session}')",check=False).returncode!=0
    assert sql(f"select configure_playing_area('{session}','{{}}')",check=False).returncode!=0
    sql(f"select set_map_timer('{session}',false)")
    assert sql(f"select map_stage_floor from game_sessions where id='{session}'").stdout.strip()=='0'
    sql(f"select set_map_timer('{session}',true)")
    sql(f"select shrink_map_area('{session}')")
    elapsed=float(sql(f"select extract(epoch from clock_timestamp()-map_started_at) from game_sessions where id='{session}'").stdout)
    assert abs(elapsed-600)<2
    for role in ('anon','authenticated'):
        assert sql(f"set role {role}; select shrink_map_area('{session}')",check=False).returncode!=0


def test_manual_shrink_uses_current_timed_stage_and_handles_manual_only(mapped_game):
    sql,session,_=mapped_game
    plan=default_plan()
    plan['stages'][1]['after_seconds']=600
    plan['stages'][2]['after_seconds']=1200
    sql(f"select configure_playing_area('{session}','{json.dumps(plan)}')")
    sql(f"update game_sessions set map_started_at=now()-interval '700 seconds' where id='{session}'")
    assert sql(f"select shrink_map_area('{session}')").stdout.strip()=='2'
    sql(f"select set_map_timer('{session}',false)")
    plan=default_plan()
    plan['stages'][1]['after_seconds']=None
    plan['stages'][2]['after_seconds']=None
    sql(f"select configure_playing_area('{session}','{json.dumps(plan)}')")
    sql(f"select set_map_timer('{session}',true)")
    before=sql(f"select map_started_at from game_sessions where id='{session}'").stdout
    assert sql(f"select shrink_map_area('{session}')").stdout.strip()=='1'
    assert sql(f"select map_started_at from game_sessions where id='{session}'").stdout==before
    assert sql(f"select shrink_map_area('{session}')").stdout.strip()=='2'
    sql(f"update game_sessions set status='ended' where id='{session}'")
    assert sql(f"select shrink_map_area('{session}')",check=False).returncode!=0


def test_seek_is_shared_atomic_bounded_and_private(mapped_game):
    sql,session,_=mapped_game
    plan=default_plan()
    plan['stages'][1]['after_seconds']=600
    plan['stages'][2]['after_seconds']=1200
    sql(f"select configure_playing_area('{session}','{json.dumps(plan)}')")
    assert sql(f"select seek_map_timer('{session}',30)",check=False).returncode!=0


    sql(f"select set_map_timer('{session}',true)")
    for position,stage in ((570,0),(900,1),(1200,2),(0,0)):
        sql(f"select seek_map_timer('{session}',{position})")
        result=json.loads(sql(f"select jsonb_build_object('elapsed',extract(epoch from clock_timestamp()-map_started_at),'stage',map_stage_floor) from game_sessions where id='{session}'").stdout)
        assert abs(result['elapsed']-position)<2
        assert result['stage']==stage
    for position in (-1,1201):
        assert sql(f"select seek_map_timer('{session}',{position})",check=False).returncode!=0
    for role in ('anon','authenticated'):
        assert sql(f"set role {role}; select seek_map_timer('{session}',30)",check=False).returncode!=0
    sql(f"select shrink_map_area('{session}')")
    elapsed=float(sql(f"select extract(epoch from clock_timestamp()-map_started_at) from game_sessions where id='{session}'").stdout)
    assert abs(elapsed-600)<2
    sql(f"select set_map_timer('{session}',false)")
    assert sql(f"select map_started_at is null and map_stage_floor=0 from game_sessions where id='{session}'").stdout.strip()=='t'
    sql(f"update game_sessions set status='ended' where id='{session}'")
    assert sql(f"select seek_map_timer('{session}',30)",check=False).returncode!=0



def test_pause_resume_are_idempotent_and_preserve_elapsed_time(mapped_game):
    sql,session,_=mapped_game
    assert sql(f"select pause_map_timer('{session}',true)",check=False).returncode!=0
    sql(f"select set_map_timer('{session}',true); select seek_map_timer('{session}',300); select pause_map_timer('{session}',true)")
    paused=sql(f"select map_paused_at from game_sessions where id='{session}'").stdout
    sql(f"select pause_map_timer('{session}',true)")
    assert sql(f"select map_paused_at from game_sessions where id='{session}'").stdout==paused
    # Move both anchors back to simulate a long pause without sleeping.
    sql(f"update game_sessions set map_started_at=map_started_at-interval '30 minutes',map_paused_at=map_paused_at-interval '30 minutes' where id='{session}'")
    sql(f"select pause_map_timer('{session}',false)")
    elapsed=float(sql(f"select extract(epoch from clock_timestamp()-map_started_at) from game_sessions where id='{session}'").stdout)
    assert abs(elapsed-300)<2
    started=sql(f"select map_started_at from game_sessions where id='{session}'").stdout
    sql(f"select pause_map_timer('{session}',false)")
    assert sql(f"select map_started_at from game_sessions where id='{session}'").stdout==started
    sql(f"select pause_map_timer('{session}',true); select seek_map_timer('{session}',200)")
    assert sql(f"select map_paused_at is not null from game_sessions where id='{session}'").stdout.strip()=='t'
    elapsed=float(sql(f"select extract(epoch from map_paused_at-map_started_at) from game_sessions where id='{session}'").stdout)
    assert abs(elapsed-200)<.01
    sql(f"select shrink_map_area('{session}')")
    elapsed=float(sql(f"select extract(epoch from map_paused_at-map_started_at) from game_sessions where id='{session}'").stdout)
    assert abs(elapsed-600)<.01
    for role in ('anon','authenticated'):
        assert sql(f"set role {role}; select pause_map_timer('{session}',true)",check=False).returncode!=0
    sql(f"select set_map_timer('{session}',false)")
    assert sql(f"select map_started_at is null and map_paused_at is null and map_stage_floor=0 from game_sessions where id='{session}'").stdout.strip()=='t'
