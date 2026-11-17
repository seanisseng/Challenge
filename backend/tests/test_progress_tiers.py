"""Tier progress must count actual unlocked clues, not visible challenges."""
from unittest.mock import Mock

from app import repo


def test_progress_counts_actual_inventory_for_every_team_without_event_limit(monkeypatch):
    teams = [{"id": str(i), "name": f"Team {i}"} for i in range(4)]
    awards = [{"team_id": str(i), "clues": {"tier": tier}} for i in range(3)
              for tier in ("tier1", "tier2", "tier3") for _ in range(8)]
    data = {"team_members": [{"team_id": "0"}], "team_clues": awards,
            "challenges": [{"claimed_by_team_id": "0"}]}
    queries = {}
    def select(table):
        query = Mock()
        for method in ("select", "in_", "eq", "is_"):
            getattr(query, method).return_value = query
        query.not_ = query
        query.execute.return_value.data = data[table]
        queries[table] = query
        return query
    monkeypatch.setattr(repo, "_select", select)
    result = repo.progress("room", teams)
    for row in result[:3]:
        assert row["clue_count"] == 24
        assert row["clue_tier_counts"] == {"tier1": 8, "tier2": 8, "tier3": 8}
    assert result[3]["clue_tier_counts"] == {"tier1": 0, "tier2": 0, "tier3": 0}
    assert result[0]["claimed_count"] == 1
    queries["team_clues"].select.assert_called_once_with("team_id,clues!inner(tier)")
    queries["team_clues"].in_.assert_called_once_with("team_id", ["0", "1", "2", "3"])
    queries["team_clues"].limit.assert_not_called()


def test_no_teams_needs_no_inventory_query(monkeypatch):
    query = Mock()
    monkeypatch.setattr(repo, "_select", query)
    assert repo.progress("room", []) == []
    query.assert_not_called()
