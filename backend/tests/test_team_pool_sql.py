"""Code-only team access has one shared identity and preserves team state."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import pytest

MIGRATIONS=Path(__file__).resolve().parents[1]/'supabase/migrations'

@pytest.fixture(scope='module')
def team_db(full_database):
    return full_database

@pytest.fixture
def game(team_db):
    sql=team_db
    session=sql("select session_id from create_session('Team pool test',2,6)").stdout.strip()
    codes=sql(f"select join_code from teams where session_id='{session}' order by name").stdout.splitlines()
    yield sql,session,codes
    sql(f"delete from game_sessions where id='{session}'")


def test_code_only_rejoin_returns_same_team_credential(game):
    sql,session,codes=game
    first=sql(f"select member_id,member_token from join_team('{codes[0]}')").stdout.strip()
    again=sql(f"select member_id,member_token from join_team(' {codes[0].lower()} ','Ignored old name')").stdout.strip()
    assert again==first
    assert sql(f"select count(*) from team_members m join teams t on t.id=m.team_id where t.session_id='{session}'").stdout.strip()=='1'
    assert sql(f"select member_token from join_team('{codes[1]}')").stdout.strip()!=first.split('|')[1]


def test_concurrent_devices_create_only_one_shared_identity(game):
    sql,_,codes=game
    def join(_):return sql(f"select member_token from join_team('{codes[0]}')").stdout.strip()
    with ThreadPoolExecutor(max_workers=6) as pool: tokens=list(pool.map(join,range(12)))
    assert len(set(tokens))==1


def test_rejoin_preserves_earned_clues_and_legacy_records(game):
    sql,session,codes=game
    team=sql(f"select id from teams where join_code='{codes[0]}'").stdout.strip()
    sql(f"insert into team_members(team_id,name) values('{team}','Historical player')")
    first=sql(f"select member_token from join_team('{codes[0]}')").stdout.strip()
    sql(f"insert into team_clues(team_id,clue_id) select '{team}',id from clues where tier='tier2' limit 1")
    assert sql(f"select member_token from join_team('{codes[0]}')").stdout.strip()==first
    assert sql(f"select count(*) from team_clues where team_id='{team}'").stdout.strip()=='1'
    assert sql(f"select count(*) from team_members where team_id='{team}' and name='Historical player'").stdout.strip()=='1'


def test_invalid_code_and_ended_game_remain_blocked(game):
    sql,session,codes=game
    assert sql("select * from join_team('INVALID')",check=False).returncode!=0
    sql(f"update game_sessions set status='ended' where id='{session}'")
    assert sql(f"select * from join_team('{codes[0]}')",check=False).returncode!=0

def test_team_rename_preserves_code_pool_identity_and_clues(game):
    sql,_,codes=game
    original=sql(f"select member_id,member_token,team_id from join_team('{codes[0]}')").stdout.strip().split('|')
    member,token,team=original
    sql(f"insert into team_clues(team_id,clue_id) select '{team}',id from clues where tier='tier1' limit 1")
    assert sql(f"select rename_team('{team}','  Orange Explorers  ')").stdout.strip()=='Orange Explorers'
    current=sql(f"select member_id,member_token,team_id,team_name from join_team('{codes[0]}')").stdout.strip().split('|')
    assert current==[member,token,team,'Orange Explorers']
    assert sql(f"select count(*) from team_clues where team_id='{team}'").stdout.strip()=='1'


def test_team_names_are_unique_in_room_and_blank_names_rejected(game):
    sql,_,codes=game
    first=sql(f"select team_id from join_team('{codes[0]}')").stdout.strip()
    second=sql(f"select team_id from join_team('{codes[1]}')").stdout.strip()
    sql(f"select rename_team('{first}','Explorers')")
    for name in (' explorers ','   ','x'*41):
        result=sql(f"select rename_team('{second}','{name}')",check=False)
        assert result.returncode!=0
    for role in ('anon','authenticated'):
        assert sql(f"set role {role}; select rename_team('{first}','Hijacked')",check=False).returncode!=0
