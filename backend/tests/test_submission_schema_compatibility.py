"""New media fields must not break boards before migration 26 is applied."""
from types import SimpleNamespace
from unittest.mock import MagicMock
import pytest
from postgrest.exceptions import APIError
from app import repo

@pytest.mark.parametrize('fetch',[
    lambda:repo.session_submissions('session'),
    lambda:repo.submissions_by_team(['team'])['team'],
    lambda:repo.submission('proof'),
])
def test_boards_and_legacy_proof_work_before_evidence_migration(monkeypatch,fetch):
    query=MagicMock();query.select.return_value=query;query.eq.return_value=query
    query.in_.return_value=query;query.order.return_value=query;query.limit.return_value=query
    query.execute.side_effect=[APIError({'code':'42703','message':'column submissions.attachments does not exist','details':None,'hint':None}),SimpleNamespace(data=[{'id':'proof','team_id':'team','photo_path':'legacy.jpg'}])]
    monkeypatch.setattr(repo,'_select',lambda _:query)
    assert fetch()
    assert query.execute.call_count==2
    assert 'attachments' not in query.select.call_args.args[0]

def test_other_database_errors_are_not_hidden(monkeypatch):
    query=MagicMock();query.select.return_value=query;query.eq.return_value=query;query.order.return_value=query
    query.execute.side_effect=APIError({'code':'42501','message':'permission denied','details':None,'hint':None})
    monkeypatch.setattr(repo,'_select',lambda _:query)
    with pytest.raises(APIError):repo.session_submissions('session')
    assert query.execute.call_count==1
