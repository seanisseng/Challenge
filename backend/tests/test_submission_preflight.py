from types import SimpleNamespace
from unittest.mock import MagicMock
import pytest
from fastapi import HTTPException
from app import repo

@pytest.fixture
def board(monkeypatch):
    challenge={'session_id':'room','status':'open','is_active':True,'is_discarded':False}
    session={'status':'active','board_visible':True}
    monkeypatch.setattr(repo,'get_challenge',lambda _:challenge)
    monkeypatch.setattr(repo,'get_session',lambda _:session)
    query=MagicMock()
    for method in ('select','eq','limit'):getattr(query,method).return_value=query
    query.execute.return_value=SimpleNamespace(data=[])
    monkeypatch.setattr(repo,'_select',lambda _:query)
    return challenge,session,query

def test_open_challenge_can_be_submitted(board):
    repo.require_submission_open('room','team','challenge')

def test_pending_proof_is_a_conflict(board):
    board[2].execute.return_value.data=[{'id':'pending'}]
    with pytest.raises(HTTPException,match='awaiting host review') as error:
        repo.require_submission_open('room','team','challenge')
    assert error.value.status_code==409

@pytest.mark.parametrize('change',[{'status':'claimed'},{'is_active':False},{'is_discarded':True},{'session_id':'another-room'}])
def test_closed_or_foreign_challenges_cannot_be_submitted(board,change):
    board[0].update(change)
    with pytest.raises(HTTPException):repo.require_submission_open('room','team','challenge')
    board[2].execute.assert_not_called()

@pytest.mark.parametrize('change',[{'status':'ended'},{'board_visible':False}])
def test_closed_games_cannot_be_submitted(board,change):
    board[1].update(change)
    with pytest.raises(HTTPException):repo.require_submission_open('room','team','challenge')
