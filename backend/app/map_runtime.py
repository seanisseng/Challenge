"""Clock-driven zone updates; GPS events avoid full game snapshot fan-out."""
import asyncio
import contextlib
import logging
from datetime import datetime,timezone,timedelta
from app import repo
from app.game_map import utc
from app.realtime import hub

log=logging.getLogger(__name__)

class MapRuntime:
    def __init__(self):
        self.timers:dict[str,asyncio.Task]={}
        self.locks:dict[str,asyncio.Lock]={}
        self.housekeeper:asyncio.Task | None=None
        self.bootstrap:asyncio.Task | None=None

    async def start(self):
        self.housekeeper=asyncio.create_task(self._cleanup())
        self.bootstrap=asyncio.create_task(self._restore())

    async def _restore(self):
        try:
            for session in await asyncio.to_thread(repo.running_maps):
                await self.schedule(session['id'])
        except Exception:
            log.warning('Map timers unavailable until the map migration/connection is ready')

    async def schedule(self,session_id):
        lock=self.locks.setdefault(session_id,asyncio.Lock())
        async with lock:
            old=self.timers.pop(session_id,None)
            if old:old.cancel()
            session=await asyncio.to_thread(repo.get_session,session_id)
            if session.get('map_started_at') and not session.get('map_paused_at') and session['status']=='active':
                self.timers[session_id]=asyncio.create_task(self._run(session))

    async def _run(self,session):
        started=utc(session['map_started_at'])
        for index,stage in enumerate((session.get('playing_area') or {}).get('stages',[])):
            if stage.get('after_seconds') is None or index<=session.get('map_stage_floor',0):continue
            due=started+timedelta(seconds=stage['after_seconds'])
            delay=(due-datetime.now(timezone.utc)).total_seconds()
            if delay<=0:continue
            await asyncio.sleep(delay)
            await hub.broadcast(session['id'])

    async def _cleanup(self):
        while True:
            await asyncio.sleep(30)
            try:
                expired=await asyncio.to_thread(repo.expire_locations)
                for point in expired:
                    session_id=point.pop('session_id')
                    await hub.map_event(session_id,{'kind':'location_removed',**point})
            except Exception:
                log.warning('Location cleanup deferred; map storage unavailable')

    async def close(self):
        tasks=list(self.timers.values())+[t for t in (self.housekeeper,self.bootstrap) if t]
        for task in tasks:task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError):await task

map_runtime=MapRuntime()
