"""The deployed catalog matches the document without resetting existing games."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'backend/supabase/migrations/20260101000034_sync_challenge_catalog.sql'


def document_rows():
    rows = []
    for line in (ROOT / 'challenges/challenges.md').read_text(encoding='utf-8').splitlines():
        cells = [cell.strip() for cell in line.strip('|').split('|')]
        if len(cells) == 6 and cells[0].isdigit():
            number, tier, title, area, condition, image = cells
            rows.append([int(number), title, area, condition, f'tier{tier}',
                         None if image == '-' else image.strip('`')])
    return rows


def test_catalog_matches_document_and_new_session_has_every_challenge(full_database):
    sql = full_database
    actual = sql("""select json_build_array(sort_order,title,location_area,
        completion_condition,clue_tier,regexp_replace(image_path,'^.*/',''))
        from challenge_templates order by sort_order""").stdout.splitlines()
    assert [json.loads(row) for row in actual] == document_rows()
    session = sql("select session_id from create_session('Full catalog',2,6)").stdout.strip()
    try:
        assert sql(f"select count(*),count(*) filter(where is_active) from challenges where session_id='{session}'").stdout.strip() == '49|6'
    finally:
        sql(f"delete from game_sessions where id='{session}'")


def test_sync_preserves_history_removals_and_existing_queue_and_is_repeatable(full_database):
    sql = full_database
    session = sql("select session_id from create_session('Existing game',2,6)").stdout.strip()
    try:
        # Simulate the 29-row legacy pool with a host-chosen order.
        sql(f"""
            delete from challenges where session_id='{session}' and title in
                (select title from challenge_templates where sort_order>=30);
            update challenges c set is_active=false,sort_order=100-t.sort_order
                from challenge_templates t where c.session_id='{session}' and c.title=t.title;
            update challenges set title='Copy-Pose' where session_id='{session}' and title='I love my Country';
            update challenges set title='Trial by Rival' where session_id='{session}' and title='Youths in the Wild';
            update challenges set is_discarded=true where session_id='{session}' and title='Burp-apella';
            update challenges set status='claimed',claimed_by_team_id=(select id from teams where session_id='{session}' limit 1)
                where session_id='{session}' and title='Going Bananas';
            update challenges set status='pending_approval',is_active=true,completion_condition='Original pending rule'
                where session_id='{session}' and title='Ketchup Allegiance';
        """)
        snapshot = f"select id,status,is_active,is_discarded,sort_order,completion_condition from challenges where session_id='{session}' and (status<>'open' or is_discarded) order by id"
        history = sql(snapshot).stdout
        original = sql(f"select id,sort_order from challenges where session_id='{session}' order by id").stdout
        for _ in range(2):
            sql('begin;'+MIGRATION.read_text(encoding='utf-8')+'commit;')
            assert sql(snapshot).stdout == history
            assert sql(f"select id,sort_order from challenges where session_id='{session}' and sort_order<100 order by id").stdout == original
            assert sql(f"select count(*),count(distinct title) from challenges where session_id='{session}'").stdout.strip() == '49|49'
            assert sql(f"select count(*) from challenges where session_id='{session}' and title in ('Copy-Pose','Trial by Rival')").stdout.strip() == '0'
    finally:
        sql(f"delete from game_sessions where id='{session}'")
