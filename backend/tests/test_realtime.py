"""Fan-out tests for the in-process WebSocket hub.

No database: the snapshot builders are stubbed, so these only exercise the
routing and dead-subscriber logic.
"""

from __future__ import annotations

from typing import Any

import pytest

from app import realtime, snapshots


class StubSocket:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def send_json(self, payload: dict[str, Any]) -> None:
        self.sent.append(payload)


class DeadSocket:
    def __init__(self) -> None:
        self.attempts = 0

    async def send_json(self, payload: dict[str, Any]) -> None:
        self.attempts += 1
        raise RuntimeError("socket is gone")


@pytest.fixture
def stub_snapshots(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        snapshots, "session_core", lambda session_id: {"session": {"id": session_id}}
    )
    monkeypatch.setattr(
        snapshots,
        "team_payload",
        lambda member, core=None: {"kind": "team", "member": member["id"]},
    )
    monkeypatch.setattr(
        snapshots,
        "admin_payload",
        lambda session_id, core=None: {"kind": "admin", "session": session_id},
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
    assert hub.presence("s1") == 0

    # A second broadcast has nobody left to send to.
    await hub.broadcast("s1")
    assert dead.attempts == 1


@pytest.mark.asyncio
async def test_broadcast_with_no_listeners_is_a_noop(stub_snapshots: None) -> None:
    hub = realtime.Hub()
    await hub.broadcast("nobody-here")
    assert hub.presence("nobody-here") == 0
