from concurrent.futures import ThreadPoolExecutor
from threading import Barrier


def test_review_result_is_atomic_idempotent_and_service_only(full_database):
    sql=full_database
    session=sql("select session_id from create_session('Review latency',2,6)").stdout.strip()
    try:
        sql(f"update game_sessions set status='active',board_visible=true where id='{session}'")
        teams=sql(f"select id from teams where session_id='{session}' order by id").stdout.splitlines()
        challenge=sql(f"select id from challenges where session_id='{session}' and is_active order by sort_order limit 1").stdout.strip()
        proofs=[sql(f"select submit_evidence('{team}',null,'{challenge}','[]','Answer')").stdout.strip() for team in teams]
        assert sql(f"select review_submission('{proofs[0]}','approved','OK')").stdout.strip()==session
        assert sql(f"select review_submission('{proofs[0]}','approved','Retry')").stdout.strip()==session
        assert sql(f"select count(*) from submission_events where submission_id='{proofs[0]}' and event='approved'").stdout.strip()=='1'
        assert sql(f"select status from submissions where id='{proofs[1]}'").stdout.strip()=='rejected'
        assert sql(f"select review_submission('{proofs[1]}','rejected',null)").stdout.strip()==session
        assert sql(f"select review_submission('{proofs[0]}','rejected',null)",check=False).returncode!=0
        assert sql(f"select review_submission('{proofs[0]}','invalid',null)",check=False).returncode!=0
        for role in ('anon','authenticated'):
            assert sql(f"set role {role};select review_submission('{proofs[0]}','approved',null)",check=False).returncode!=0
    finally:sql(f"delete from game_sessions where id='{session}'")


def test_competing_review_results_grant_only_one_reward(full_database):
    sql=full_database
    session=sql("select session_id from create_session('Review race',2,6)").stdout.strip()
    try:
        sql(f"select set_board_visibility('{session}',true)")
        teams=sql(f"select id from teams where session_id='{session}' order by id").stdout.splitlines()
        challenge=sql(f"select id from challenges where session_id='{session}' and is_active order by id limit 1").stdout.strip()
        proofs=[sql(f"select submit_evidence('{team}',null,'{challenge}','[]','Answer')").stdout.strip() for team in teams]
        barrier=Barrier(2)
        def approve(proof):
            barrier.wait(timeout=5)
            return sql(f"select review_submission('{proof}','approved',null)",check=False)
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(approve,proofs))
        assert sum(result.returncode==0 for result in results)==1
        assert sql(f"select count(*) from team_clues where challenge_id='{challenge}'").stdout.strip()=='1'
        assert sql(f"select count(*) from submissions where challenge_id='{challenge}' and status='rejected'").stdout.strip()=='1'
    finally:sql(f"delete from game_sessions where id='{session}'")
