def test_deletion_cascades_records_but_keeps_cleanup_job_for_storage(full_database):
    sql=full_database
    session=sql("select session_id from create_session('Deletion cleanup',2,6)").stdout.strip()
    other=sql("select session_id from create_session('Other game',1,6)").stdout.strip()
    sql(f"select delete_session_with_media('{session}',array['proofs','assets'])")
    assert sql(f"select count(*) from game_sessions where id='{session}'").stdout.strip()=='0'
    for table in ('teams','challenges','submissions'):
        assert sql(f"select count(*) from {table} where session_id='{session}'").stdout.strip()=='0'
    assert sql(f"select cardinality(buckets) from session_media_deletions where session_id='{session}'").stdout.strip()=='2'
    assert sql(f"select count(*) from game_sessions where id='{other}'").stdout.strip()=='1'
    sql(f"select delete_session_with_media('{session}',array['proofs','assets'])")
    for role in ('anon','authenticated'):
        assert sql(f"set role {role};select delete_session_with_media('{other}',array['proofs'])",check=False).returncode!=0
    sql(f"delete from session_media_deletions where session_id='{session}';delete from game_sessions where id='{other}'")

def test_relocating_legacy_reference_images_preserves_other_games(full_database):
    sql=full_database
    source=sql("select session_id from create_session('Source image',1,6)").stdout.strip()
    old=f'{source}/reference.jpg';new='_shared/reference.jpg'
    sql(f"update challenge_templates set image_path='{old}' where sort_order=1")
    other=sql("select session_id from create_session('Reused image',1,6)").stdout.strip()
    sql(f"select delete_session_with_media('{source}',array['proofs','assets'])")
    sql(f"select relocate_shared_session_asset('{source}','{old}','{new}','https://assets/old','https://assets/new')")
    assert sql("select image_path from challenge_templates where sort_order=1").stdout.strip()==new
    assert sql(f"select image_path from challenges where session_id='{other}' and sort_order=1").stdout.strip()==new
    sql(f"delete from session_media_deletions where session_id='{source}';delete from game_sessions where id='{other}';update challenge_templates set image_path=null where sort_order=1")
