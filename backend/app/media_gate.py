"""Bounded concurrent transfers with exclusive, reentrant session cleanup."""
from contextlib import contextmanager
from threading import Condition, RLock


class MediaGate:
    def __init__(self, limit=4):
        self.condition=Condition(RLock())
        self.limit=limit
        self.active=0
        self.writers=0

    @contextmanager
    def upload(self):
        with self.condition:
            self.condition.wait_for(lambda: self.active<self.limit and not self.writers)
            self.active+=1
        try:yield
        finally:
            with self.condition:
                self.active-=1
                self.condition.notify_all()

    def __enter__(self):
        self.condition.acquire()
        self.writers+=1
        try:self.condition.wait_for(lambda: self.active==0)
        finally:self.writers-=1
        return self

    def __exit__(self,*_):
        self.condition.notify_all()
        self.condition.release()
