import json,uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest

@pytest.fixture
def game(full_database):
    sql=full_database
    session=sql("select session_id from create_session('Direct uploads',2,6)").stdout.strip()
    sql(f"select set_board_visibility('{session}',true)")
    team,code=sql(f"select id,join_code from teams where session_id='{session}' order by id limit 1").stdout.strip().split('|')
    member=sql(f"select member_id from join_team('{code}')").stdout.strip()
    challenge=sql(f"select id from challenges where session_id='{session}' and is_active order by id limit 1").stdout.strip()
    yield sql,session,team,member,challenge
    sql(f"delete from game_sessions where id='{session}';delete from proof_upload_batches where session_id='{session}'")

def authorize(game,files=None,request_id=None):
    sql,_,team,member,challenge=game
    manifest=files if files is not None else [{'name':'clip.mp4','content_type':'video/mp4','size':100}]
    request_id=request_id or str(uuid.uuid4())
    return json.loads(sql(f"select authorize_proof_uploads('{request_id}','{team}','{member}','{challenge}','{json.dumps(manifest)}')").stdout)

def test_upload_ownership_verification_and_idempotent_finalization(game):
    sql,session,team,_,_=game
    request_id=str(uuid.uuid4());batch=authorize(game,request_id=request_id)
    assert authorize(game,request_id=request_id)['batch_id']==batch['batch_id']
    row=batch['uploads'][0];assert row['path'].startswith(f'{session}/{team}/')
    batch_id=batch['batch_id']
    assert sql(f"select finalize_proof_uploads('{batch_id}','{team}','Proof')",check=False).returncode!=0
    foreign=sql(f"select id from teams where session_id='{session}' and id<>'{team}'").stdout.strip()
    assert sql(f"select finalize_proof_uploads('{batch_id}','{foreign}','Proof')",check=False).returncode!=0
    sql(f"update proof_uploads set verified_at=now(),duration_seconds=30 where id='{row['id']}'")
    barrier=Barrier(2)
    def finalize(_):
        barrier.wait(timeout=5)
        return sql(f"select finalize_proof_uploads('{batch_id}','{team}','Proof')").stdout.strip()
    with ThreadPoolExecutor(max_workers=2) as pool:ids=list(pool.map(finalize,range(2)))
    assert ids[0]==ids[1]
    assert sql(f"select count(*) from submissions where id='{ids[0]}'").stdout.strip()=='1'
    assert authorize(game,request_id=request_id)['submission_id']==ids[0]
    for role in ('anon','authenticated'):
        assert sql(f"set role {role};select finalize_proof_uploads('{batch_id}','{team}','Proof')",check=False).returncode!=0

def test_deleted_sessions_retain_upload_tombstones_and_expired_cleanup(game):
    sql,session,_,_,_=game
    batch=authorize(game);batch_id=batch['batch_id']
    sql(f"select delete_session_with_media('{session}',array['challenge-proofs'])")
    assert sql(f"select has_live_proof_uploads('{session}')").stdout.strip()=='t'
    assert sql("select count(*) from expired_proof_uploads(50)").stdout.strip()=='0'
    sql(f"update proof_upload_batches set expires_at=now()-interval '1 second' where id='{batch_id}'")
    assert sql(f"select has_live_proof_uploads('{session}')").stdout.strip()=='f'
    assert sql(f"select count(*) from expired_proof_uploads(50) where batch_id='{batch_id}'").stdout.strip()=='1'

def test_video_duration_is_enforced_and_losing_challenges_cannot_finalize(game):
    sql,_,team,_,challenge=game
    batch=authorize(game);batch_id=batch['batch_id']
    sql(f"update proof_uploads set verified_at=now(),duration_seconds=30.1 where batch_id='{batch_id}'")
    assert sql(f"select finalize_proof_uploads('{batch_id}','{team}','Proof')",check=False).returncode!=0
    sql(f"update proof_uploads set duration_seconds=10 where batch_id='{batch_id}'")
    sql(f"update challenges set status='claimed',claimed_by_team_id='{team}' where id='{challenge}'")
    assert sql(f"select finalize_proof_uploads('{batch_id}','{team}','Proof')",check=False).returncode!=0
