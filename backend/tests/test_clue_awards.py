"""Public award notifications never expose clue content or cross-session data."""
from unittest.mock import Mock

from app import repo, snapshots


def test_recent_awards_are_session_scoped_and_public_only(monkeypatch):
    query = Mock()
    query.select.return_value = query
    query.eq.return_value = query
    query.order.return_value = query
    query.limit.return_value = query
    query.execute.return_value.data = [{
        "id": "award-1", "team_id": "team-2", "unlocked_at": "2026-11-12T10:00:00Z",
        "teams": {"name": "Team 2", "session_id": "room"},
        "clues": {"tier": "tier2", "body": "secret answer", "title": "secret title"},
    }]
    select = Mock(return_value=query)
    monkeypatch.setattr(repo, "_select", select)
    awards = repo.recent_clue_awards("room")
    select.assert_called_once_with("team_clues")
    query.eq.assert_called_once_with("teams.session_id", "room")
    query.limit.assert_called_once_with(50)
    assert awards == [{"id": "award-1", "team_id": "team-2", "team_name": "Team 2", "tier": "tier2", "awarded_at": "2026-11-12T10:00:00Z"}]
    assert "body" not in query.select.call_args.args[0]
    assert "title" not in query.select.call_args.args[0]


def test_player_payload_includes_public_awards_without_other_clues(monkeypatch):
    award = {"id": "award", "team_id": "rival", "team_name": "Rival", "tier": "tier3", "awarded_at": "2026-11-12T10:00:00Z"}
    core = {"session": {"id": "room", "status": "active", "board_visible": True}, "board": [], "progress": [], "clue_awards": [award]}
    monkeypatch.setattr(repo, "team_submissions", lambda team_id: [])
    own_clues = [{"id": "own", "body": "my private clue"}]
    clues = Mock(return_value=own_clues)
    monkeypatch.setattr(repo, "team_clues", clues)
    payload = snapshots.team_payload({"id": "member", "name": "Alex", "team": {"id": "mine", "name": "My team"}, "session": {"id": "room"}}, core)
    assert payload["clue_awards"] == [award]
    assert payload["clues"] == own_clues
    clues.assert_called_once_with("mine")
