# Backend capacity: why it was flaky and what changed

Diagnosis and fixes for the intermittent backend failures that showed up once
more than a handful of phones were connected. Target: ~100 concurrent devices
during a live game.

## What was failing

### 1. One HTTP/2 connection shared by every thread

`create_client()` with no options builds `httpx.Client(http2=True)`. The
Supabase SDK's PostgREST, Storage and Auth clients then all ride that single
connection, and every FastAPI worker thread multiplexes onto it.

Under a burst of uploads the Supabase edge aborted the session:

```
httpx.RemoteProtocolError: Server disconnected
EOF occurred in violation of protocol
```

Measured against the live project, 8 simultaneous uploads x 10 rounds:

| Client                         | Failures | Rounds fully failed |
|--------------------------------|----------|---------------------|
| shared HTTP/2 (old default)    | 10 / 80  | 8 / 10              |
| shared HTTP/1.1 pool           | 0 / 80   | 0 / 10              |
| one client per thread (HTTP/2) | 0 / 80   | 0 / 10              |

Nothing retried, so a single dropped socket surfaced as a 500 in the middle of
an approval (`app/routers/admin.py` -> `repo.submission` -> `RemoteProtocolError`).

### 2. Approval deadlocks

`approve_submission` locked its submission first and its challenge second;
`discard_challenge` locked the challenge first. Two host actions at the same
moment produced `400 deadlock detected` — reproduced 4/4 rounds, both for
approve-vs-approve on one challenge and approve-vs-discard.

### 3. A team could never hold more than one clue per tier

When a challenge had no bound clue, `approve_submission` fell back to the
*first* clue of that tier. `team_clues` is unique on `(team_id, clue_id)`, so
the insert was silently swallowed: three Tier-1 wins produced exactly one
Tier-1 clue. Clue progress — the only way to win — stalled.

### 4. The fan-out was O(devices) in database round trips

Every broadcast rebuilt state per subscriber: 2 queries per team device plus 4
for the admin console. One approval with 20 phones watching meant ~44 queries,
serialised. A single bad socket also aborted the loop and unregistered healthy
subscribers, and a payload-build error dropped the device instead of just the
payload.

## What changed

### `app/db/supabase_client.py` — owned HTTP/1.1 pool

* `httpx.Client(http2=False)` with 50 max connections, 20 keep-alive, 30s
  keep-alive expiry.
* Timeouts: connect 5s, read 30s, write 60s (a 25 MiB photo on a phone
  connection), pool checkout 10s.
* `RetryingTransport` retries GET/HEAD (and any method whose *connect* failed)
  up to 3 times with backoff. A dead pooled socket now costs one request.
* Client creation is behind a lock, so the first burst cannot build two pools.

### `app/repo.py` — retries and batched reads

* `rpc()` retries `40P01` deadlocks always (Postgres rolled the transaction
  back, so replay is safe) and retries dropped connections for RPCs that are
  replay-safe. A replayed approve/reject that finds the work already done is
  treated as success rather than an error.
* A transport failure on a non-replayable call (e.g. `submit_proof`) returns
  `503 lost contact with the database, please try again` instead of a 500.
* `upload_proof` / `upload_challenge_image` retry a dropped connection 3 times
  with backoff; a "duplicate" answer from a retry means the first attempt
  actually landed, so it counts as success.
* New batched readers: `submissions_by_team`, `clues_by_team`, `members_by_team`,
  plus `progress(session_id, teams=...)` so the team list is fetched once.

### `app/snapshots.py` — one read per room, not per device

`room_data(session_id)` reads the room in a fixed 8 queries and returns the
session core, teams, rosters, per-team submissions, per-team clues, queue and
review list. `team_payload` / `admin_payload` accept `room=` and just slice it.
Calling them without `room=` still works (REST responses, one-off snapshots).

### `app/realtime.py` — concurrent, isolated sends

* One `room_data` call per broadcast, in a worker thread.
* Payloads are built per device from the shared read; a build error skips that
  device only.
* Sends run via `asyncio.gather` with a 5s per-send timeout. A slow or dead
  socket is dropped on its own and never blocks the room.

### `app/routers/ws.py`

The initial snapshot and token lookup now run in `asyncio.to_thread`, so a
connect storm no longer blocks the event loop.

### `supabase/migrations/20260101000018_approval_lock_order_and_clue_rotation.sql`

* `approve_submission`, `reject_submission`, `discard_challenge` all lock
  `game_sessions -> challenges -> submissions`, and `refill_board` takes the
  session lock so a standalone top-up cannot interleave with an approval.
* The clue fallback skips clues the team already owns, so repeat wins of a tier
  rotate to the next clue instead of being swallowed.

Applied to the hosted project on 2026-11-12. Verified by `probe_clues.py`
(three Tier-1 wins now yield `Clue 0`, `Clue 1`, `Clue 2`) and
`probe_deadlock.py` (zero `deadlock detected` across 12 racing cases).

## Measurements after the change

`probe_fix.py` against the live project, 100 concurrent users, after the
migration was applied:

```
uploads:   100 concurrent in 2.8s, 0 failure(s)
snapshots: 100 concurrent in 8.6s (100 x 8 queries)
fan-out:   100 team payloads + 1 admin in 0.608s, from 8 queries
```

During the earlier upload burst the transport logged one retry
(`retrying GET /rest/v1/submissions after ReadError`) and recovered — the exact
failure that used to be a 500.

Deadlock probe, 4 rounds per case: 0 `deadlock detected` (was 4/4 for
approve-vs-approve and approve-vs-discard). The remaining errors are the
intended race outcomes: `submission is already rejected` for the team that lost
the challenge, and `claimed challenges cannot be removed` for a discard that
lost to an approval.

Clue probe: three Tier-1 wins now unlock `Clue 0`, `Clue 1`, `Clue 2` (was
`Clue 0` three times).

Test suite: full suite green with `CHALLENGE_LIVE_TESTS=1` (83 tests at the
time of writing), including `tests/test_clue_rotation_sql.py`, which loads the
real approval RPC into a disposable local Postgres and checks the reward
rotation.

## How to verify

From `backend/`:

```powershell
$env:CHALLENGE_LIVE_TESTS="1"; .\.venv\Scripts\python.exe -m pytest
```

Concurrency probes (they create and delete their own throwaway sessions):

```powershell
$env:PYTHONPATH="."
.\.venv\Scripts\python.exe "$env:TEMP\opencode\probe_fix.py" 100
.\.venv\Scripts\python.exe "$env:TEMP\opencode\probe_deadlock.py"
.\.venv\Scripts\python.exe "$env:TEMP\opencode\probe_clues.py"
```

`20260101000018` is applied on the hosted project. To re-apply it elsewhere, run
it in the SQL editor or with
`psql "$env:DATABASE_URL" -f supabase/migrations/20260101000018_approval_lock_order_and_clue_rotation.sql`,
then run `probe_clues.py` — it should print `Clue 0`, `Clue 1`, `Clue 2`.

## Known limits

* The backend is still one process: the WebSocket hub is in-memory, so
  broadcasts only reach devices connected to the same worker. Running uvicorn
  with `--workers N` needs a shared pub/sub (Supabase Realtime broadcast or
  Postgres `LISTEN/NOTIFY`) first.
* Uploads stream through the backend and then to Storage, so the API process
  holds each photo in memory (25 MiB cap). At 100 simultaneous maximum-size
  uploads that is ~2.5 GiB; the practical fix is signed upload URLs issued to
  the client, which was out of scope here.
* `room_data` is 8 queries; above ~50 teams it becomes the dominant cost and
  should move behind a single SQL view or RPC.
