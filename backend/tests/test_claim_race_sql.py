"""Competing approvals against real migrations in disposable local PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest


@pytest.mark.parametrize('same_submission',[False,True])
def test_competing_approvals_have_one_winner_and_one_reward(full_database,same_submission):
    sql=full_database
    session=sql("select session_id from create_session('Concurrent claim check',2,6)").stdout.strip()
    try:
        sql(f"select set_board_visibility('{session}',true)")
        teams=sql(f"select id from teams where session_id='{session}' order by id").stdout.splitlines()
        challenge=sql(f"select id from challenges where session_id='{session}' and is_active and status='open' order by id limit 1").stdout.strip()
        submissions=[sql(f"select submit_proof('{team}',null,'{challenge}','local-race-proof.jpg')").stdout.strip() for team in teams]
        barrier=Barrier(2)
        def approve(submission):
            barrier.wait(timeout=5)
            return sql(f"select approve_submission('{submission}')",check=False)
        targets=[submissions[0],submissions[0] if same_submission else submissions[1]]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(approve,targets))
        assert sorted(result.returncode==0 for result in results)==[False,True]
        assert sql(f"select count(*) from submissions where challenge_id='{challenge}' and status='approved'").stdout.strip()=='1'
        assert sql(f"select count(*) from submissions where challenge_id='{challenge}' and status='rejected'").stdout.strip()=='1'
        assert sql(f"select count(*),count(distinct team_id) from team_clues where challenge_id='{challenge}'").stdout.strip()=='1|1'
        assert sql(f"select ch.claimed_by_team_id=s.team_id from challenges ch join submissions s on s.challenge_id=ch.id and s.status='approved' where ch.id='{challenge}'").stdout.strip()=='t'
        assert sql(f"select count(*) from submission_events e join submissions s on s.id=e.submission_id where s.challenge_id='{challenge}' and e.event='approved'").stdout.strip()=='1'
    finally:
        sql(f"delete from game_sessions where id='{session}'")
