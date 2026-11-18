# Backend - API + Supabase Database

For multi-image/video/text proof submission, compressed upload copies, and
migration 26 deployment requirements, see [Submission evidence](../docs/submission-evidence.md).

FastAPI service plus the **Postgres/Supabase data layer** for the scavenger
hunt. The database folder (`supabase/`) is the heart of the project: the
sniping and clue-unlock mechanics are enforced in Postgres so they stay
race-safe no matter which client calls them.

```
backend/
  app/
    main.py            app wiring, CORS, routers
    config.py          env-driven settings + admin token derivation
    models.py          request schemas
    repo.py            every database and storage call
    snapshots.py       the payloads pushed to clients
    realtime.py        in-process WebSocket hub
    deps.py            the two credential gates
    routers/
      play.py          /api/join, /api/state, /api/submissions, /api/clues
      admin.py         PIN login, sessions, content, review
      ws.py            /ws
  tests/               pytest suite (unit + optional live flow)
  supabase/
    migrations/        schema, RLS, RPCs, storage, realtime, hardening
    seed.sql           optional demo session (not applied anywhere)
  requirements.txt
```

## Running the database

The database is **hosted on Supabase Cloud** - project `ceqfgjqwvuqhtsbmxfdn`
("Game 2 Challenge", `ap-southeast-1`, Postgres 17). There is no local database
container; nothing here needs Docker or the Supabase CLI.

Connection details live in `backend/.env`:

| Variable | Used for |
|----------|----------|
| `SUPABASE_URL` | `https://ceqfgjqwvuqhtsbmxfdn.supabase.co` |
| `SUPABASE_SECRET_KEY` | new-style `sb_secret_...` key - the only key the backend uses; bypasses RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | legacy `eyJ...` JWT with the same privileges; either name works |
| `DATABASE_URL` | direct Postgres connection for `psql` / migration tooling |
| `ADMIN_PIN` | the host console PIN (never stored in the database) |

Set **one** of the two key variables - `config.service_key` takes whichever is
present. Both resolve to the `service_role` Postgres role, and Supabase is
deprecating the legacy `service_role` JWT by the end of 2026, so the
`sb_secret_...` secret key is the better choice.

No anon/publishable key is needed anywhere: the frontend never talks to
Supabase, and RLS has no policies for it to read.

Migration 20 was applied through Supabase MCP on 2026-11-15 as hosted version
`20261115142016` (`global_clue_catalog`); all 24 shared clues were verified.
Migrations 21/22 were applied on 2026-11-16 as hosted versions
`20261116054423` and `20261116055049`. Verify the live migration state with:

```sql
select * from supabase_migrations.schema_migrations order by version;
```

## Auth model

There are no user accounts anywhere - not in Supabase Auth, not in a table.

| Role | Credential | Where it lives | Sent as |
|------|-----------|----------------|---------|
| Host | a PIN | `ADMIN_PIN` in `backend/.env` | `X-Admin-Token` |
| Player | a per-team join code | `teams.join_code` | `X-Team-Token` after joining |

- **The admin token is derived, not stored.** `POST /api/admin/login` checks the
  PIN and returns `hmac_sha256(ADMIN_PIN, "challenge-admin-v1")`. Rotating
  `ADMIN_PIN` invalidates every token that was ever issued, with no session
  table to clean up.
- **A team code is a shared credential.** The host picks the team count when
  creating a session; the database generates one unique 6-character code per
  team. Every teammate enters only that code and receives the same shared team
  token. Rejoining preserves team clues, submissions and progress. One internal
  `team_members` access row is reused per team; legacy records/tokens remain valid.
- **Any teammate may rename their team.** `PATCH /api/team` derives the team
  from its token. Names are trimmed, limited to 40 characters and unique within
  the game regardless of case. The team code and credential do not change.
- **RLS stays on with zero policies.** Anon and authenticated have no table
  grants at all, so a leaked anon key reads nothing. Every query runs through
  the backend's service-role client.

## Entity relationships

```
game_sessions 1---* teams 1---* team_members
                 |     |
                 |     +---* team_clues *---1 clues
                 |     +---* submissions
                 +---* challenges *---1 submissions
submission_events *---1 submissions
```

### Tables

| Table | Purpose | Notable columns |
|-------|---------|-----------------|
| `game_sessions` | Game room + lifecycle | `room_code` unique, `status`, `team_count`, `active_task_limit`, `final_destination` |
| `teams` | One team slot per session | unique `(session_id, name)`, unique `join_code` |
| `team_members` | Internal shared access identity; legacy records retained | `name`, unique `(team_id, lower(name))`, unique `token` |
| `clues` | Permanent shared catalog, independent of sessions | `tier` (`tier1/2/3`), `body`, `media_url` |
| `challenges` | Pool + live board | `clue_tier`, `clue_id`, `status`, `is_active`, `claimed_by_team_id` |
| `submissions` | Photo proof + review | `photo_path`, `status`, `team_member_id`, `reviewed_by` |
| `team_clues` | Unlocked clue inventory | unique `(team_id, clue_id)` |
| `submission_events` | Audit trail | `event`, `actor_id` (text: member id or `'admin'`) |

### Enums

`session_status`: `lobby` -> `active` -> `ended`
`challenge_status`: `open` -> `pending_approval` -> `claimed`
`clue_tier`: `tier1` -> `tier2` -> `tier3`
`submission_status`: `pending` -> `approved` | `rejected`

## Sniping mechanics (enforced in Postgres)

- **Many pending, one winner.** A partial unique index permits unlimited
  `pending` submissions per challenge but only **one** `approved` row
  (`submissions_one_approved_per_challenge`). A second index stops a team from
  double-submitting the same challenge while pending.
- **Guard trigger.** `submissions_before_insert` locks the challenge and
  refuses inserts against a `claimed` challenge, and flips `open ->
  pending_approval` - so even a direct REST insert cannot cheat.
- **Atomic approval.** `approve_submission()` runs in one transaction: marks
  the winner, claims the challenge, grants the matching tier clue, auto-rejects
  rival pending submissions, and refills the board.
- **Clue rewards.** For every approved challenge, `approve_submission` filters
  the shared clue catalog to the rewarded tier, excludes clues the winning team
  already owns, and randomly grants one remaining clue. `challenges.clue_id`
  does not override the draw. Teams can collect multiple clues per tier;
  another team's inventory does not affect eligibility. If the team has
  exhausted the tier, approval succeeds without repeating an owned clue.
  The shared catalog requires migration `20260101000020` on the hosted database.
  A missing tier aborts approval; an exhausted tier still succeeds without a duplicate.

## RPC reference

All are `SECURITY DEFINER` and executable only by `service_role`.

| RPC | Effect |
|-----|--------|
| `generate_join_code()` | 6 chars from a 32-char alphabet with no `0/O/1/I/L` |
| `create_session(name, team_count, task_limit?, room_code?)` | Creates team slots and a hidden, prepopulated challenge board |
| `join_team(join_code, member_name?)` | Returns shared team access; legacy name argument is ignored |
| `rename_team(team_id, name)` | Renames the authenticated team without changing access or progress |
| `submit_proof(team_id, member_id, challenge_id, photo_path, photo_url?)` | Creates a pending submission |
| `approve_submission(submission_id, note?)` | Claims the challenge, grants the clue, rejects rivals, refills |
| `reject_submission(submission_id, note?)` | Rejects; reopens the board if it was the last pending |
| `refill_board(session_id)` | Retires claimed challenges, activates pool up to `active_task_limit` |
| `set_board_visibility(session_id, visible)` | Reveal/start the board or hide it without losing the preview |
| `discard_challenge(session_id, challenge_id)` | Permanently remove for this session, reject pending proofs and refill |
| `reorder_challenge_queue(session_id, ids, expected_ids)` | Save a complete queue order; reject stale or invalid orders |
| `defer_challenge(session_id, challenge_id)` | Legacy alias for session-local removal |

## API surface

Team endpoints take `X-Team-Token`; admin endpoints take `X-Admin-Token`
(except login).

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/admin/login` | PIN body | Returns the derived admin token |
| `GET` | `/api/admin/sessions` | admin | List sessions |
| `POST` | `/api/admin/sessions` | admin | Create a session + team codes |
| `GET` | `/api/admin/sessions/{id}/state` | admin | Full console snapshot |
| `POST` | `/api/admin/sessions/{id}/start` | admin | Activate the board, go live |
| `POST` | `/api/admin/sessions/{id}/board/reveal` | admin | Reveal the prepared board; starts a lobby game |
| `POST` | `/api/admin/sessions/{id}/board/hide` | admin | Hide challenges from teams and block new proofs |
| `POST` | `/api/admin/sessions/{id}/challenges/{challenge_id}/discard` | admin | Remove a queued or live challenge for this game |
| `POST` | `/api/admin/sessions/{id}/queue/reorder` | admin | Save queue order with stale-order protection |
| `POST` | `/api/admin/sessions/{id}/challenges/{challenge_id}/defer` | admin | Legacy alias for removal |
| `POST` | `/api/admin/sessions/{id}/end` | admin | End the game |
| `POST` | `/api/admin/sessions/{id}/challenges` | admin | Add a challenge (goes live if there is room) |
| `GET` | `/api/admin/sessions/{id}/clues` | admin | Read the shared catalog after validating the session |
| `POST` | `/api/admin/submissions/{id}/approve` | admin | Approve a proof |
| `POST` | `/api/admin/submissions/{id}/reject` | admin | Reject a proof |
| `GET` | `/api/admin/submissions/{id}/photo` | admin | Short-lived signed photo URL |
| `DELETE` | `/api/admin/members/{id}` | admin | Remove a player |
| `POST` | `/api/join` | none | Join or rejoin using a team code, returns shared access |
| `PATCH` | `/api/team` | team | Change own team name and broadcast the update |
| `GET` | `/api/state` | team | Full player snapshot |
| `POST` | `/api/submissions` | team | Upload photo proof (multipart) |
| `GET` | `/api/clues` | team | Only this team's unlocked clues |
| `WS` | `/ws?token=...` or `/ws?admin_token=...&session_id=...` | either | Live snapshots |

## Live updates

`app/realtime.py` keeps one in-process room per session. Every mutation ends
with `hub.broadcast(session_id)`, which rebuilds the snapshot and pushes a
tailored payload to each subscriber: players get their own clues and
submission states, the admin gets all teams and pending proofs.

This replaces Supabase Realtime deliberately. Without a JWT there is no
`auth.uid()`, so RLS cannot filter rows per team - the backend does the
filtering instead. The trade-off is that the API must run as a single process
(no horizontal scaling) and a restart drops sockets, which the client handles
by reconnecting with backoff.

Proof photos are never in the broadcast payload; the admin fetches a signed URL
on demand from `/api/admin/submissions/{id}/photo`. Challenge reference images
are public game assets; their stable `image_url` is included in board snapshots.

## Storage

Bucket **`challenge-proofs`** (private, 25 MiB, images only). Path convention:

```
{session_id}/{team_id}/{uuid}.{ext}
```

Nothing is reachable directly: anon and authenticated have no `storage.objects`
grants. The backend uploads with the service-role key and mints short-lived
signed URLs for the admin console.

Bucket **`challenge-assets`** holds optional challenge reference photos (public
read, 10 MiB per image, JPEG / PNG / WebP). Only the backend service role can
write. `challenges.image_path` stores an object key; snapshots derive the public
URL. See [Supabase public bucket access](https://supabase.com/docs/guides/storage/buckets/fundamentals).

Reference photos come with the built-in challenge pool. The replacement upload route is
`POST /api/admin/sessions/{session_id}/challenges/{challenge_id}/image`, with an
admin token and multipart `file`. It validates ownership, MIME type, emptiness,
and the smaller of `MAX_UPLOAD_BYTES` and 10 MiB, then broadcasts the new URL.
Missing reference photos are hidden gracefully on both boards. Uploading a new
image replaces the challenge's reference; previous objects remain in storage.

## Admin board controls

Every new session receives the 29 built-in challenges from `challenge_templates`.
Its opening board is prepared immediately but hidden from teams. Migration 0014
also prepares existing lobby boards and fills existing empty lobby pools.
The Content tab is replaced by a Board view and a separate Clues tab.

- **Reveal Board** starts a lobby session and shows the prepared challenges to teams.
- **Hide Board** removes challenges from team snapshots and blocks submissions.
  The admin preview, queue, existing reviews and unlocked clues remain available.
- **×** on either a queued or live challenge removes it for the rest of that
  session. It cannot return through a refill, reorder or hide/reveal cycle.
  Removing a live challenge rejects all its pending submissions with a visible
  explanation, records review events and brings in the next eligible challenge.
  Previously rejected proofs cannot later win approval. Claimed challenges and
  ended games cannot be moved.
- The queue shows the next six challenges with an option to show all. Queue
  details are included only in admin snapshots. Drag a grip using mouse or touch
  to reorder; dropping saves once. Arrow buttons and arrow keys on the grip
  provide the same control without dragging. Escape or an interrupted drag
  cancels the preview. The queue scrolls as a dragged card approaches a viewport
  edge. Concurrent queue changes cancel a drag or reject a stale save with HTTP
  409 so another host's order is not silently overwritten.

Removed rows and submission history are retained with `is_discarded = true`.
New sessions copy fresh catalog rows, so removal affects only the current game.

The database enforces visibility, active-board membership and session ownership;
stale clients cannot submit to a hidden or moved challenge. Catalog templates
are service-role-only, and reuse the existing public reference object keys.
Changes to the built-in pool should update the canonical challenge file and use
a new migration to update `challenge_templates` for future sessions.

### Game2 content and reference photos

1. Apply `supabase/migrations/20260101000013_challenge_images.sql` in the SQL editor
   or with `psql` against the hosted database.
2. Apply `supabase/seed_challenges.sql`. It locks room `95Q2X3`, inserts the 29
   canonical challenges only if the pool is empty, and leaves them inactive.
   Apply migration 20 to populate the permanent clue catalog before play.
3. With a working service key in `backend/.env`, run from `backend/`:

   ```powershell
   .\.venv\Scripts\python.exe scripts/upload_challenge_assets.py --dry-run
   .\.venv\Scripts\python.exe scripts/upload_challenge_assets.py
   ```

The script checks that each local `challenges/challenge<N>.jpg` matches exactly
one row by `sort_order`, then upserts `{session_id}/challenge<N>.jpg` and links it
to that challenge. Run it before starting the hunt; a running UI refreshes on
its next snapshot. Reruns repair missing uploads without duplicating challenges.
For another session, pass `--room-code CODE` and optionally `--folder PATH`.

## Migrations

Timestamp-prefixed SQL in `supabase/migrations/`:

| File | Contents |
|------|----------|
| `*_0001_init_schema` | extensions, enums, tables |
| `*_0002_constraints_indexes` | partial indexes, indexes, triggers |
| `*_0003_helpers` | (superseded) auth-derived helper functions |
| `*_0004_rls_policies` | (superseded) the old auth policy matrix |
| `*_0005_rpc_functions` | (superseded) auth-based join / submit / approve |
| `*_0006_storage` | bucket + (superseded) storage policies |
| `*_0007_realtime` | publication + replica identity |
| `*_0008_hardening` | revoke `anon` EXECUTE on RPCs, pin trigger `search_path` |
| `*_0009_team_codes` | **the identity rewrite**: drops `admin_users` and all policies, adds `team_members` and `join_code`, rewrites every RPC |
| `*_0010_drop_legacy_auth_functions` | removes the dead auth-flavoured overloads |
| `*_0011_fix_create_session_ambiguity` | fixes the `room_code` OUT-parameter collision |
| `*_0012_member_name_case_insensitive` | unique `(team_id, lower(name))` |
| `*_0013_challenge_images` | optional reference image key + public assets bucket |
| `*_0014_board_controls` | built-in catalog, hidden preview, visibility and queue controls |
| `*_0015_board_reveal_events` | durable reveal identity for the player card-flop animation |
| `*_0016_queue_order_and_discards` | session-local removal, eligible-only refill and queue reordering |
| `*_0017_queue_conflict_response` | explicit HTTP conflict response for stale queue saves |
| `*_0018_approval_lock_order_and_clue_rotation` | one lock order for approve/reject/discard, clue fallback skips clues the team owns |
| `*_0019_random_unowned_clue_rewards` | every approved challenge randomly awards one same-tier clue the winning team does not own |
| `*_0020_global_clue_catalog` | shared permanent clues, preserved legacy unlocks, random global tier rewards |
| `*_0021_team_pool_access` | code-only joins reuse one shared team identity, preserving legacy access |
| `*_0022_team_names` | team-controlled names, case-insensitive room uniqueness |

`*_0018` is applied on the hosted project. It removes the `40P01` deadlock
between concurrent approvals and makes repeat wins of a clue tier rotate to the
next clue the team does not own. See `docs/backend-100-users.md` for the full
capacity work. Migration `*_0019` is also applied and supersedes the ordered
clue fallback with a random draw from the team's remaining clues in that tier.

To change the schema, add a new timestamped file to `supabase/migrations/` and
apply it to the project (SQL editor, `psql $DATABASE_URL`, or the Supabase MCP
tools). Keep the file in the repo so the schema stays reproducible from source.

## Backend app

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env      # fill in the keys and pick an ADMIN_PIN
uvicorn app.main:app --reload
```

- Health: <http://localhost:8000/health>
- Docs: <http://localhost:8000/docs>
- Tests: `python -m pytest`

### Tests

`tests/test_smoke.py`, `tests/test_api_surface.py`, and
`tests/test_realtime.py` need no database - they cover the routing surface,
both credential gates, and the WebSocket fan-out.

`tests/test_live_flow.py` drives a whole game against the hosted project
(create session, join two teams, race one challenge, approve, verify clue
unlock, reject, verify reopen) and deletes the session afterwards. It is
skipped unless you opt in:

```powershell
$env:CHALLENGE_LIVE_TESTS = "1"
.\.venv\Scripts\python.exe -m pytest tests/test_live_flow.py -v
```

## Demo data (`supabase/seed.sql`)

Optional and **not** applied to the hosted project. It calls `create_session`
for a 3-team "Sunset City Hunt", adds two clues per tier and eight challenges,
and prints the generated team codes. There are no auth users to create any
more - hand the printed codes out and play.


## Playing area and location sharing

Migration 23 adds private map configuration and expiring device fixes. It was
applied to hosted Supabase as `20261116071533` on 2026-11-16. New games persist
the default 7/5/3 km zones and hidden finish; existing games are not backfilled.
Shrink times are blank for manual control until the host sets them. Shrink area
advances one stage immediately and preserves future scheduled deadlines. The host saves a hidden destination and nested
circular stages, then starts the shrink countdown during an active game. Each
stage must contain the destination and fit inside the previous stage. Timers
use absolute server time and restore after restart. Current deployment uses
one backend process with the existing in-memory WebSocket room hub.

Players opt in per browser using Share my location. All teams and the host see
shared device positions under team names. Only the latest fix is kept; clients
hide fixes after two minutes and the backend clears expired coordinates every
30 seconds. Ending a game deletes shares. Devices need HTTPS and browser
location permission; visible-tab updates do not provide background tracking.
No Google API key is required. OSM standard tiles require attribution and
compliance with their best-effort public tile policy. Details and verification:
[playing-area-verification](../docs/playing-area-verification.md).
