"""Exercise the complete catalog migration in disposable PostgreSQL."""
import json
from pathlib import Path
import re

import pytest

MIGRATIONS = Path(__file__).resolve().parents[1] / 'supabase/migrations'


@pytest.fixture(scope='module')
def catalog(postgres):
    sql = postgres
    sql("""
        drop schema public cascade; create schema public;
        create schema auth; create table auth.users (id uuid primary key);
        create function auth.uid() returns uuid language sql as 'select null::uuid';
        create role anon; create role authenticated; create role service_role;
        grant usage on schema public to anon, authenticated, service_role;
        create schema storage; create table storage.objects (id uuid);
        create table storage.buckets (id text primary key, name text, public boolean,
            file_size_limit bigint, allowed_mime_types text[]);
    """)
    for path in sorted(MIGRATIONS.glob('*.sql')):
        number = int(path.name[10:14])
        if number in (6, 7) or number >= 20:
            continue
        sql(path.read_text(encoding='utf-8'))
    # Two old rooms own identical clues; both teams have earned their copy.
    sql("""
        select create_session('Old A', 1, 6, 'OLD_A');
        select create_session('Old B', 1, 6, 'OLD_B');
        insert into clues (session_id, tier, title, body)
        select id, 'tier1', 'Yellow Yellow, there she goes!', 'Yellow.'
        from game_sessions;
        insert into team_clues (team_id,clue_id)
        select t.id,c.id from teams t join clues c on c.session_id=t.session_id;
        update challenges ch set clue_id=c.id from clues c
        where ch.session_id=c.session_id and ch.clue_tier='tier1';
        insert into clues (session_id,tier,title,body,sort_order)
        select id,'tier3','Legacy custom clue','Preserve this distinct content',42
        from game_sessions where room_code='OLD_B';
    """)
    sql('begin;\n'+(MIGRATIONS/'20260101000020_global_clue_catalog.sql').read_text(encoding='utf-8')+'\ncommit;')
    return sql


def test_catalog_exactly_matches_player_facing_document(catalog):
    source = (MIGRATIONS.parents[2]/'clues/clues.md').read_text(encoding='utf-8').split('## Host-only destination facts')[0]
    rows = re.findall(r'^\| T([123])-0([1-8]) \| (.*?) \| (.*?) \|$',source,re.M)
    expected = [[f'tier{tier}',int(order)-1,title,body,None] for tier,order,title,body in rows]
    actual = catalog('select json_build_array(tier,sort_order,title,body,media_url) from clues where sort_order < 8 order by tier,sort_order').stdout.splitlines()
    assert [json.loads(row) for row in actual] == expected
    assert len(expected) == 24
    assert catalog("select count(*) from clues where title='Legacy custom clue' and sort_order=8").stdout.strip() == '1'


def test_old_awards_and_bindings_survive_consolidation(catalog):
    assert catalog('select count(*),count(distinct clue_id) from team_clues').stdout.strip() == '2|1'
    assert catalog('select count(distinct clue_id) from challenges where clue_id is not null').stdout.strip() == '1'
    assert catalog("select count(*) from information_schema.columns where table_schema='public' and table_name='clues' and column_name='session_id'").stdout.strip() == '0'
    assert catalog("select to_regclass('public.clue_templates') is null").stdout.strip() == 't'


def test_new_and_deleted_games_share_the_permanent_catalog(catalog):
    before = catalog('select id from clues order by id').stdout
    catalog("select create_session('New game',2,6,'NEW')")
    assert catalog("select count(*) from challenges ch join game_sessions s on s.id=ch.session_id where s.room_code='NEW'").stdout.strip() == '29'
    catalog("delete from game_sessions where room_code='OLD_A'")
    assert catalog('select id from clues order by id').stdout == before
    assert catalog('select count(*) from team_clues').stdout.strip() == '1'


def test_catalog_is_private_to_the_backend(catalog):
    for role in ('anon','authenticated'):
        result = catalog(f'set role {role}; select * from clues',check=False)
        assert result.returncode != 0
    assert catalog("select has_table_privilege('service_role','clues','select')").stdout.strip() == 't'


def test_reveal_submit_approve_uses_same_catalog_across_games(catalog):
    sql = catalog
    for code in ('NEW','OLD_B'):
        session = sql(f"select id from game_sessions where room_code='{code}'").stdout.strip()
        sql(f"select set_board_visibility('{session}',true)")
        team = sql(f"select id from teams where session_id='{session}' limit 1").stdout.strip()
        challenge = sql(f"select id from challenges where session_id='{session}' and is_active and clue_tier='tier2' limit 1").stdout.strip()
        before = int(sql(f"select count(*) from team_clues where team_id='{team}'").stdout.strip())
        submission = sql(f"select submit_proof('{team}',null,'{challenge}','local-proof.jpg')").stdout.strip()
        sql(f"select approve_submission('{submission}')")
        assert int(sql(f"select count(*) from team_clues where team_id='{team}'").stdout.strip()) == before+1
        assert sql(f"select count(*) from team_clues tc join clues c on c.id=tc.clue_id join challenges ch on ch.id=tc.challenge_id where tc.team_id='{team}' and c.tier=ch.clue_tier and ch.id='{challenge}'").stdout.strip() == '1'
