"""Session shuffles persist; explicit host queue order controls replacements."""
import json


def pool(sql, session):
    return json.loads(sql(f"""
        select json_agg(json_build_object('id',id,'title',title,'rank',sort_order,
            'active',is_active) order by sort_order)
        from challenges where session_id='{session}'
    """).stdout)


def test_new_sessions_shuffle_once_and_keep_template_content(full_database):
    sql = full_database
    sessions = []
    try:
        for _ in range(2):
            session = sql("select session_id from create_session('Random board',2,6)").stdout.strip()
            sessions.append(session)
        first, second = [pool(sql, session) for session in sessions]
        assert [c['title'] for c in first] != [c['title'] for c in second]
        templates = int(sql('select count(*) from challenge_templates').stdout)
        for session, cards in zip(sessions, (first, second)):
            assert len(cards) == templates
            assert [c['rank'] for c in cards] == list(range(1, templates + 1))
            assert [c['active'] for c in cards] == [True] * 6 + [False] * (templates - 6)
            assert sql(f"""select count(*) from challenges c
                join challenge_templates t using (title)
                where c.session_id='{session}' and
                (c.location_area,c.completion_condition,c.clue_tier,c.image_path)
                is not distinct from
                (t.location_area,t.completion_condition,t.clue_tier,t.image_path)
            """).stdout.strip() == str(templates)
            sql(f"select refill_board('{session}')")
            assert pool(sql, session) == cards
    finally:
        for session in sessions:
            sql(f"delete from game_sessions where id='{session}'")


def test_manual_queue_order_survives_refill_and_other_session_creation(full_database):
    sql = full_database
    session = sql("select session_id from create_session('Ordered queue',2,6)").stdout.strip()
    other = None
    try:
        before = pool(sql, session)
        queue = [c['id'] for c in before if not c['active']]
        reordered = list(reversed(queue))
        def ids(values):
            return "array[" + ','.join(f"'{value}'::uuid" for value in values) + "]"
        sql(f"select reorder_challenge_queue('{session}',{ids(reordered)},{ids(queue)})")
        saved = pool(sql, session)
        assert [c['id'] for c in saved if not c['active']] == reordered
        # A stale host cannot silently overwrite the saved order.
        assert sql(f"select reorder_challenge_queue('{session}',{ids(queue)},{ids(queue)})", check=False).returncode != 0
        other = sql("select session_id from create_session('Another shuffle',2,6)").stdout.strip()
        assert pool(sql, session) == saved
        removed = next(c['id'] for c in before if c['active'])
        sql(f"select discard_challenge('{session}','{removed}')")
        after = pool(sql, session)
        assert reordered[0] in [c['id'] for c in after if c['active']]
        assert [c['id'] for c in after if not c['active'] and c['id'] != removed] == reordered[1:]
    finally:
        for value in (session, other):
            if value:
                sql(f"delete from game_sessions where id='{value}'")
