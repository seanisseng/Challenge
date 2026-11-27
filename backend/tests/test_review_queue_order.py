"""Admin snapshots request FIFO proofs without changing player feed ordering."""
from unittest.mock import Mock

from app import repo, snapshots


def test_admin_submissions_request_oldest_first_with_stable_ties(monkeypatch):
    query = Mock()
    query.select.return_value = query
    query.eq.return_value = query
    query.order.return_value = query
    query.execute.return_value.data = []
    monkeypatch.setattr(repo, '_select', Mock(return_value=query))

    assert repo.session_submissions('room', 'pending') == []
    assert query.order.call_args_list == [
        (('submitted_at',), {'desc': False}),
        (('id',), {'desc': False}),
    ]
    query.eq.assert_any_call('session_id', 'room')
    query.eq.assert_any_call('status', 'pending')


def test_player_submissions_keep_newest_first(monkeypatch):
    query = Mock()
    query.select.return_value = query
    query.in_.return_value = query
    query.order.return_value = query
    query.execute.return_value.data = []
    monkeypatch.setattr(repo, '_select', Mock(return_value=query))

    assert repo.team_submissions('team') == []
    query.order.assert_called_once_with('submitted_at', desc=True)


def test_fifo_admin_broadcast_still_shows_players_their_latest_attempt():
    proof = {'team_id': 'team', 'challenge_id': 'task', 'review_note': None}
    data = {
        'session': {'id': 'room', 'status': 'active', 'board_visible': True},
        'board': [{'id': 'task'}], 'progress': [], 'clue_awards': [], 'clues': {},
        'submissions': [
            {**proof, 'id': 'old', 'status': 'rejected', 'submitted_at': '2026-11-27T10:00:00Z'},
            {**proof, 'id': 'new', 'status': 'pending', 'submitted_at': '2026-11-27T10:01:00Z'},
        ],
    }
    update = snapshots.team_game_update('team', data)['changes']
    assert update['board'][0]['my_submission']['id'] == 'new'
    assert update['board'][0]['my_submission']['status'] == 'pending'
    assert [proof['id'] for proof in update['my_submissions']] == ['new', 'old']
