"""Exercise the real approval RPC in an isolated, disposable local Postgres.

Requires PostgreSQL binaries on PATH (or POSTGRES_BIN). Never uses hosted data.
CLUE_APPROVAL_MIGRATION can select an older migration to reproduce the bug.
"""

import uuid

import pytest


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
        select id from clues order by random() limit 1;
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


def test_shared_catalog_clue_is_available_to_another_game(game):
    sql, session, team = game
    shared = add_clue(sql, str(uuid.uuid4()), "tier2", 0)
    win(sql, session, team, "tier2")
    assert inventory(sql, team) == [shared]


def test_exhausted_tier_does_not_repeat_owned_clue(game):
    sql, session, team = game
    clue = add_clue(sql, session, "tier1", 0)
    win(sql, session, team, "tier1")
    win(sql, session, team, "tier1")
    assert inventory(sql, team) == [clue]


def test_missing_tier_aborts_before_claiming(game):
    sql, session, team = game
    challenge, submission = str(uuid.uuid4()), str(uuid.uuid4())
    sql(f"""
        insert into challenges (id,session_id,clue_tier) values ('{challenge}','{session}','tier3');
        insert into submissions (id,challenge_id,team_id) values ('{submission}','{challenge}','{team}');
    """)
    result = sql(f"select approve_submission('{submission}')", check=False)
    assert result.returncode != 0 and "no clues configured for tier tier3" in result.stderr
    assert sql(f"select status from challenges where id='{challenge}'").stdout.strip() == "open"
    assert sql(f"select status from submissions where id='{submission}'").stdout.strip() == "pending"
