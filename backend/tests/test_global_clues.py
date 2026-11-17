from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import repo
from app.config import get_settings
from app.main import app


def test_catalog_query_has_no_session_filter(monkeypatch):
    query = Mock()
    query.select.return_value = query
    query.order.return_value = query
    query.execute.return_value.data = [{'id': 'shared'}]
    select = Mock(return_value=query)
    monkeypatch.setattr(repo,'_select',select)
    assert repo.list_clues() == [{'id': 'shared'}]
    select.assert_called_once_with('clues')
    query.eq.assert_not_called()


def test_all_host_sessions_read_same_catalog(monkeypatch):
    monkeypatch.setenv('ADMIN_PIN','global-tests')
    get_settings.cache_clear()
    try:
        get_session = Mock()
        list_clues = Mock(return_value=[{'id':'shared','tier':'tier1'}])
        monkeypatch.setattr(repo,'get_session',get_session)
        monkeypatch.setattr(repo,'list_clues',list_clues)
        client = TestClient(app)
        headers = {'X-Admin-Token':get_settings().admin_token}
        for session in ('one','two'):
            response = client.get(f'/api/admin/sessions/{session}/clues',headers=headers)
            assert response.status_code == 200
            assert response.json() == [{'id':'shared','tier':'tier1'}]
        assert client.get('/api/admin/sessions/one/clues').status_code == 401
        assert client.post('/api/admin/sessions/one/clues',headers=headers,json={}).status_code == 405
        get_session.side_effect = HTTPException(404,'session not found')
        assert client.get('/api/admin/sessions/missing/clues',headers=headers).status_code == 404
    finally:
        get_settings.cache_clear()
