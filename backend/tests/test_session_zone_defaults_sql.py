import json
from app.game_map import default_plan


def test_new_sessions_save_zones_even_when_column_defaults_are_missing(full_database):
    sql=full_database
    # Roll back the fixture's changed column defaults and inserted session.
    result=sql(r"""begin;
        alter table game_sessions alter column playing_area drop default;
        alter table game_sessions alter column final_destination drop default;
        select session_id from create_session('Saved zones',8,6) \gset
        select jsonb_build_object('plan',playing_area,'finish',final_destination,'started',map_started_at)
        from game_sessions where id=:'session_id';
        rollback;""")
    row=json.loads(next(line for line in result.stdout.splitlines() if line.startswith('{')))
    assert row['plan']=={'stages':default_plan()['stages']}
    assert row['finish']==default_plan()['finish']
    assert row['started'] is None


def test_manual_shrink_works_in_lobby_without_starting_timer(full_database):
    sql=full_database
    session=sql("select session_id from create_session('Lobby shrink',8,6)").stdout.strip()
    try:
        assert sql(f"select shrink_map_area('{session}')").stdout.strip()=='1'
        assert sql(f"select map_started_at is null and status='lobby' from game_sessions where id='{session}'").stdout.strip()=='t'
        assert sql(f"select shrink_map_area('{session}')").stdout.strip()=='2'
        assert sql(f"select shrink_map_area('{session}')",check=False).returncode!=0
        sql(f"update game_sessions set status='ended' where id='{session}'")
        assert sql(f"select shrink_map_area('{session}')",check=False).returncode!=0
        for role in ('anon','authenticated'):
            assert sql(f"set role {role};select shrink_map_area('{session}')",check=False).returncode!=0
    finally:sql(f"delete from game_sessions where id='{session}'")


def test_zone_initialization_keeps_explicit_plans(full_database):
    sql=full_database
    plan={'stages':[{'lat':1.3,'lng':103.9,'radius_m':1000,'after_seconds':0}]}
    finish={'lat':1.3,'lng':103.9}
    result=sql(f"""begin;
        insert into game_sessions(room_code,name,team_count,active_task_limit,playing_area,final_destination)
        values('ZX1234','Custom zones',8,6,'{json.dumps(plan)}','{json.dumps(finish)}');
        select jsonb_build_object('plan',playing_area,'finish',final_destination) from game_sessions where room_code='ZX1234';
        rollback;""")
    row=json.loads(next(line for line in result.stdout.splitlines() if line.startswith('{')))
    assert row=={'plan':plan,'finish':finish}
