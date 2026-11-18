import json
import pytest

@pytest.fixture
def evidence_game(full_database):
    sql=full_database
    session=sql("select session_id from create_session('Evidence test',2,6)").stdout.strip()
    sql(f"select set_board_visibility('{session}',true)")
    team=sql(f"select id from teams where session_id='{session}' order by id limit 1").stdout.strip()
    challenge=sql(f"select id from challenges where session_id='{session}' and is_active and status='open' order by id limit 1").stdout.strip()
    yield sql,session,team,challenge
    sql(f"delete from game_sessions where id='{session}'")

def test_text_only_and_mixed_proofs_are_reviewable_and_awarded_normally(evidence_game):
    sql,session,team,challenge=evidence_game
    text=sql(f"select submit_evidence('{team}',null,'{challenge}','[]','Text proof')").stdout.strip()
    assert sql(f"select photo_path is null and proof_text='Text proof' from submissions where id='{text}'").stdout.strip()=='t'
    files=[{'path':f'{session}/{team}/image.jpg','name':'image.jpg','content_type':'image/jpeg','size':10},{'path':f'{session}/{team}/video.mp4','name':'video.mp4','content_type':'video/mp4','size':20,'duration_seconds':5}]
    sql(f"select reject_submission('{text}','Try again')")
    mixed=sql(f"select submit_evidence('{team}',null,'{challenge}','{json.dumps(files)}','Details')").stdout.strip()
    assert sql(f"select jsonb_array_length(attachments) from submissions where id='{mixed}'").stdout.strip()=='2'
    sql(f"select approve_submission('{mixed}')")
    assert sql(f"select status from submissions where id='{mixed}'").stdout.strip()=='approved'
    assert sql(f"select status from submissions where id='{text}'").stdout.strip()=='rejected'
    assert sql(f"select count(*) from team_clues where challenge_id='{challenge}'").stdout.strip()=='1'

def test_empty_proofs_and_foreign_media_are_rejected_at_database_boundary(evidence_game):
    sql,session,team,challenge=evidence_game
    assert sql(f"select submit_evidence('{team}',null,'{challenge}','[]','   ')",check=False).returncode!=0
    foreign=[{'path':'another-game/another-team/file.jpg','content_type':'image/jpeg','size':10}]
    assert sql(f"select submit_evidence('{team}',null,'{challenge}','{json.dumps(foreign)}',null)",check=False).returncode!=0
    assert sql(f"insert into submissions(session_id,challenge_id,team_id,photo_path) values('{session}','{challenge}','{team}',null)",check=False).returncode!=0
    for role in ('anon','authenticated'):
        assert sql(f"set role {role}; select submit_evidence('{team}',null,'{challenge}','[]','Answer')",check=False).returncode!=0
