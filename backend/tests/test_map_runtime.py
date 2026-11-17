import asyncio
from datetime import datetime,timedelta,timezone
from unittest.mock import AsyncMock
import pytest
import app.map_runtime as module
from app.map_runtime import MapRuntime

@pytest.mark.asyncio
async def test_restart_uses_remaining_absolute_deadlines(monkeypatch):
    now=[datetime.now(timezone.utc)]
    class Clock(datetime):
        @classmethod
        def now(cls,tz=None):return now[0]
    delays=[]
    async def sleep(seconds):delays.append(round(seconds));now[0]+=timedelta(seconds=seconds)
    monkeypatch.setattr(module,'datetime',Clock)
    monkeypatch.setattr(module.asyncio,'sleep',sleep)
    broadcast=AsyncMock();monkeypatch.setattr(module.hub,'broadcast',broadcast)
    session={'id':'room','map_started_at':(now[0]-timedelta(seconds=300)).isoformat(),'playing_area':{'stages':[{'after_seconds':0},{'after_seconds':600},{'after_seconds':900}]}}
    await MapRuntime()._run(session)
    assert delays==[300,300]
    assert broadcast.await_count==2


@pytest.mark.asyncio
async def test_pause_cancels_pending_shrink_and_does_not_schedule_a_new_one(monkeypatch):
    runtime=MapRuntime();old=asyncio.create_task(asyncio.sleep(999))
    runtime.timers['room']=old
    monkeypatch.setattr(module.repo,'get_session',lambda _: {'id':'room','status':'active','map_started_at':datetime.now(timezone.utc).isoformat(),'map_paused_at':datetime.now(timezone.utc).isoformat()})
    await runtime.schedule('room');await asyncio.sleep(0)
    assert old.cancelled();assert 'room' not in runtime.timers
