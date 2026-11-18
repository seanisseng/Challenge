import pytest

def test_host_visibility_is_persistent_scoped_and_idempotent(full_database):
    sql=full_database
    session=sql("select session_id from create_session('Visibility test',2,6)").stdout.strip()
    other=sql("select session_id from create_session('Other game',1,6)").stdout.strip()
    try:
        team=sql(f"select id from teams where session_id='{session}' order by id limit 1").stdout.strip()
        foreign=sql(f"select id from teams where session_id='{other}' limit 1").stdout.strip()
        assert sql(f"select set_team_location_visibility('{session}','{team}',false)").stdout.strip()=='1'
        assert sql(f"select '{team}'=any(map_hidden_team_ids) from game_sessions where id='{session}'").stdout.strip()=='t'
        assert sql(f"select set_team_location_visibility('{session}','{team}',false)").stdout.strip()=='1'
        assert sql(f"select set_team_location_visibility('{session}','{foreign}',false)",check=False).returncode!=0
        assert sql(f"select set_team_location_visibility('{session}','{team}',true)").stdout.strip()=='2'
        assert sql(f"select cardinality(map_hidden_team_ids) from game_sessions where id='{session}'").stdout.strip()=='0'
        for role in ('anon','authenticated'):
            assert sql(f"set role {role};select set_team_location_visibility('{session}','{team}',false)",check=False).returncode!=0
    finally:
        sql(f"delete from game_sessions where id in ('{session}','{other}')")
