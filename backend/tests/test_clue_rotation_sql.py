"""Exercise the real approval RPC in an isolated, disposable local Postgres.

Requires PostgreSQL binaries on PATH (or POSTGRES_BIN). Never uses hosted data.
CLUE_APPROVAL_MIGRATION can select an older migration to reproduce the bug.
"""

import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import uuid

import pytest


MIGRATIONS = Path(__file__).resolve().parents[1] / "supabase" / "migrations"


@pytest.fixture(scope="module")
def postgres(tmp_path_factory):
    executable = shutil.which("initdb")
    binary_dir = Path(os.environ.get("POSTGRES_BIN", Path(executable).parent if executable else ""))
    initdb = binary_dir / ("initdb.exe" if os.name == "nt" else "initdb")
    if not initdb.is_file():
        pytest.skip("local PostgreSQL binaries required; set POSTGRES_BIN")
    root = tmp_path_factory.mktemp("clue-rotation-postgres")
    data = root / "data"
    subprocess.run([str(initdb), "-D", str(data), "-U", "postgres", "-A", "trust", "--no-locale", "-E", "UTF8"], check=True, capture_output=True)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    control = str(binary_dir / "pg_ctl")
    # A Windows server can inherit captured pipe handles and prevent run()
    # from returning even after pg_ctl exits. Use a file for startup output.
    with (root / "control.log").open("w") as output:
        subprocess.run([control, "-D", str(data), "-l", str(root / "postgres.log"), "-o", f"-h 127.0.0.1 -p {port}", "-w", "start"], check=True, stdout=output, stderr=subprocess.STDOUT, timeout=90)

    def sql(statement, *, check=True):
        return subprocess.run(
            [str(binary_dir / "psql"), "-X", "-h", "127.0.0.1", "-p", str(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"],
            input=statement, text=True, capture_output=True, check=check, timeout=30,
        )

    try:
        # Only the tables touched by approve_submission; board refill is outside
        # this reward regression. Execute the actual migration's PL/pgSQL below.
        sql("""
            create table game_sessions (id uuid primary key);
            create table challenges (
                id uuid primary key, session_id uuid, clue_id uuid,
                clue_tier text, status text default 'open',
                claimed_by_team_id uuid, updated_at timestamptz
            );
            create table submissions (
                id uuid primary key, challenge_id uuid, team_id uuid,
                status text default 'pending', reviewed_by text,
                review_note text, reviewed_at timestamptz
            );
            create table clues (id uuid primary key, session_id uuid, tier text, sort_order integer);
            create table team_clues (
                team_id uuid, clue_id uuid, challenge_id uuid,
                unique (team_id, clue_id)
            );
            create table submission_events (submission_id uuid, event text, actor_id text, note text);
            create function refill_board(uuid) returns void language sql as 'select';
        """)
        override = os.environ.get("CLUE_APPROVAL_MIGRATION")
        paths = [MIGRATIONS / override] if override else sorted(MIGRATIONS.glob("*.sql"))
        definitions = []
        for path in paths:
            definitions.extend(re.findall(
                r"create or replace function public\.approve_submission\(.*?\$\$;",
                path.read_text(encoding="utf-8"), re.DOTALL | re.IGNORECASE,
            ))
        assert definitions, "approval RPC migration must exist"
        sql(definitions[-1])
        yield sql
    finally:
        subprocess.run([control, "-D", str(data), "-m", "immediate", "-w", "stop"], check=True, capture_output=True)


@pytest.fixture
def game(postgres):
    postgres("truncate game_sessions, challenges, submissions, clues, team_clues, submission_events")
    session, team = str(uuid.uuid4()), str(uuid.uuid4())
    postgres(f"insert into game_sessions values ('{session}')")
    return postgres, session, team


def add_clue(sql, session, tier, order):
    clue = str(uuid.uuid4())
    sql(f"insert into clues values ('{clue}', '{session}', '{tier}', {order})")
    return clue


def win(sql, session, team, tier, bound=None):
    challenge, submission = str(uuid.uuid4()), str(uuid.uuid4())
    bound_sql = f"'{bound}'" if bound else "null"
    sql(f"""
        insert into challenges (id, session_id, clue_id, clue_tier)
        values ('{challenge}', '{session}', {bound_sql}, '{tier}');
        insert into submissions (id, challenge_id, team_id)
        values ('{submission}', '{challenge}', '{team}');
        select approve_submission('{submission}');
    """)
    return submission


def inventory(sql, team):
    return sql(f"select clue_id from team_clues where team_id = '{team}' order by clue_id").stdout.splitlines()


@pytest.mark.parametrize("tier", ["tier1", "tier2", "tier3"])
def test_every_new_challenge_awards_another_clue_in_the_same_tier(game, tier):
    sql, session, team = game
    clues = [add_clue(sql, session, tier, i) for i in range(8)]
    # A lower sort order in a different room must never leak into this game.
    add_clue(sql, str(uuid.uuid4()), tier, -1)
    add_clue(sql, session, "tier2" if tier != "tier2" else "tier1", -1)
    for i in range(8):
        win(sql, session, team, tier)
        earned = inventory(sql, team)
        assert len(earned) == i + 1
        assert set(earned) <= set(clues)
    assert inventory(sql, team) == sorted(clues)


def test_owned_clue_is_excluded_and_another_team_can_earn_it(game):
    sql, session, team = game
    first = add_clue(sql, session, "tier2", 0)
    win(sql, session, team, "tier2", first)
    bound = add_clue(sql, session, "tier2", 1)
    win(sql, session, team, "tier2", first)
    assert inventory(sql, team) == sorted([first, bound])
    rival = str(uuid.uuid4())
    win(sql, session, rival, "tier2", bound)
    win(sql, session, rival, "tier2", bound)
    assert inventory(sql, rival) == sorted([first, bound])


def test_reward_is_randomized_even_when_challenge_has_a_bound_clue(game):
    sql, session, team = game
    clues = [add_clue(sql, session, "tier3", i) for i in range(8)]
    # Seed PostgreSQL's RNG so randomness is verifiable without a flaky
    # frequency assertion. Reset the seed before running the actual RPC.
    challenge, submission = str(uuid.uuid4()), str(uuid.uuid4())
    result = sql(f"""
        insert into challenges (id, session_id, clue_id, clue_tier)
        values ('{challenge}', '{session}', '{clues[0]}', 'tier3');
        insert into submissions (id, challenge_id, team_id)
        values ('{submission}', '{challenge}', '{team}');
        select setseed(0.5);
        select id from clues where session_id = '{session}' order by random() limit 1;
        select setseed(0.5);
        select approve_submission('{submission}');
        select clue_id from team_clues where team_id = '{team}';
    """)
    ids = [line for line in result.stdout.splitlines() if line in clues]
    assert len(ids) == 2
    assert ids[0] != clues[0], "seed must distinguish random selection from first/bound clue"
    assert ids[1] == ids[0]


def test_reapproving_same_submission_does_not_award_another_clue(game):
    sql, session, team = game
    first = add_clue(sql, session, "tier1", 0)
    submission = win(sql, session, team, "tier1")
    add_clue(sql, session, "tier1", 1)
    retry = sql(f"select approve_submission('{submission}')", check=False)
    assert retry.returncode != 0
    assert "already approved" in retry.stderr
    assert inventory(sql, team) == [first]
