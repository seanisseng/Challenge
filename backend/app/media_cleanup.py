"""Retry durable session-owned Storage cleanup, including after API restarts."""
import asyncio
import contextlib
import logging
from app import repo

log=logging.getLogger(__name__)
RETRY_INTERVAL=60

class SessionMediaCleanup:
    def __init__(self):self.task=None

    async def start(self):
        self.task=asyncio.create_task(self._run())

    async def _run(self):
        while True:
            try:await asyncio.to_thread(repo.retry_session_media_deletions)
            except Exception:log.warning('Session media cleanup deferred; database or Storage unavailable')
            await asyncio.sleep(RETRY_INTERVAL)

    async def close(self):
        if self.task:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):await self.task
            self.task=None

media_cleanup=SessionMediaCleanup()
