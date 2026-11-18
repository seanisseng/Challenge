from unittest.mock import Mock
import pytest
from app import server

def test_production_runner_uses_one_worker(monkeypatch):
    monkeypatch.delenv('WEB_CONCURRENCY',raising=False);monkeypatch.delenv('UVICORN_WORKERS',raising=False)
    run=Mock();monkeypatch.setattr(server.uvicorn,'run',run)
    server.main()
    assert run.call_args.kwargs['workers']==1

def test_production_runner_rejects_multiple_workers(monkeypatch):
    monkeypatch.setenv('WEB_CONCURRENCY','2')
    with pytest.raises(RuntimeError,match='one backend worker'):server.main()
