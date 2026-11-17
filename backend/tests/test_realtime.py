"""Fan-out tests for the in-process WebSocket hub.

No database: the snapshot builders are stubbed, so these only exercise the
routing and dead-subscriber logic.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app import realtime, snapshots


class StubSocket:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.closed = False

    async def send_json(self, payload: dict[str, Any]) -> None:
        self.sent.append(payload)

    async def close(self) -> None:
        self.closed = True


class DeadSocket:
    def __init__(self) -> None:
        self.attempts = 0
        self.closed = False

    async def send_json(self, payload: dict[str, Any]) -> None:
        self.attempts += 1
        raise RuntimeError("socket is gone")

    async def close(self) -> None:
        self.closed = True


class SlowSocket:
    def __init__(self) -> None:
        self.attempts = 0
        self.closed = False

    async def send_json(self, payload: dict[str, Any]) -> None:
        self.attempts += 1
        await asyncio.sleep(5)

    async def close(self) -> None:
        self.closed = True


@pytest.fixture
def stub_snapshots(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        snapshots, "room_data", lambda session_id: {"core": {"session": {"id": session_id}}}
    )
    monkeypatch.setattr(
        snapshots,
        "team_payload",
        lambda member, core=None, room=None,location_until=0: {"kind": "team", "member": member["id"]},
    )
    monkeypatch.setattr(
        snapshots,
        "admin_payload",
        lambda session_id, core=None, room=None: {"kind": "admin", "session": session_id},
    )


@pytest.mark.asyncio
async def test_broadcast_only_reaches_its_own_room(stub_snapshots: None) -> None:
    hub = realtime.Hub()
    alice_ws, admin_ws, outsider_ws = StubSocket(), StubSocket(), StubSocket()

    await hub.register(
        realtime.Subscriber(
            ws=alice_ws,
            session_id="s1",
            kind="team",
            member={"id": "alice", "team": {"id": "t1"}},
        )
    )
    await hub.register(realtime.Subscriber(ws=admin_ws, session_id="s1", kind="admin"))
    await hub.register(
        realtime.Subscriber(
            ws=outsider_ws,
            session_id="s2",
            kind="team",
            member={"id": "cara", "team": {"id": "t2"}},
        )
    )

    await hub.broadcast("s1")

    assert alice_ws.sent == [{"kind": "team", "member": "alice"}]
    assert admin_ws.sent == [{"kind": "admin", "session": "s1"}]
    assert outsider_ws.sent == []
    assert hub.presence("s1") == 2


@pytest.mark.asyncio
async def test_dead_subscribers_are_dropped(stub_snapshots: None) -> None:
    hub = realtime.Hub()
    dead = DeadSocket()
    await hub.register(realtime.Subscriber(ws=dead, session_id="s1", kind="admin"))

    await hub.broadcast("s1")
    assert dead.attempts == 1
    assert dead.closed  # so the browser notices and reconnects
    assert hub.presence("s1") == 0

    # A second broadcast has nobody left to send to.
    await hub.broadcast("s1")
    assert dead.attempts == 1


@pytest.mark.asyncio
async def test_broadcast_with_no_listeners_is_a_noop(stub_snapshots: None) -> None:
    hub = realtime.Hub()
    await hub.broadcast("nobody-here")
    assert hub.presence("nobody-here") == 0


@pytest.mark.asyncio
async def test_one_slow_socket_does_not_stall_the_room(
    stub_snapshots: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(realtime, "SEND_TIMEOUT", 0.05)
    hub = realtime.Hub()
    slow, healthy = SlowSocket(), StubSocket()
    await hub.register(realtime.Subscriber(ws=slow, session_id="s1", kind="admin"))
    await hub.register(
        realtime.Subscriber(
            ws=healthy,
            session_id="s1",
            kind="team",
            member={"id": "alice", "team": {"id": "t1"}},
        )
    )

    await hub.broadcast("s1")

    assert healthy.sent == [{"kind": "team", "member": "alice"}]
    assert slow.attempts == 1
    assert slow.closed
    assert hub.presence("s1") == 1


@pytest.mark.asyncio
async def test_payload_failure_does_not_take_the_room_down(
    stub_snapshots: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    def explode(member: dict[str, Any], core: Any = None, room: Any = None) -> Any:
        raise ValueError("bad member shape")

    monkeypatch.setattr(snapshots, "team_payload", explode)
    hub = realtime.Hub()
    broken, admin = StubSocket(), StubSocket()
    await hub.register(
        realtime.Subscriber(
            ws=broken, session_id="s1", kind="team", member={"id": "bob", "team": {"id": "t1"}}
        )
    )
    await hub.register(realtime.Subscriber(ws=admin, session_id="s1", kind="admin"))

    await hub.broadcast("s1")

    assert admin.sent == [{"kind": "admin", "session": "s1"}]
    assert hub.presence("s1") == 2  # building failed, so the socket was not blamed
