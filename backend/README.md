# Backend - API + Supabase Database

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

The database is **hosted on Supabase Cloud** - project `zrfilmdzczsgfzmhfgbd`
("Game 2 Challenge", `eu-north-1`, Postgres 17). There is no local database
container; nothing here needs Docker or the Supabase CLI.

Connection details live in `backend/.env`:

| Variable | Used for |
|----------|----------|
| `SUPABASE_URL` | `https://zrfilmdzczsgfzmhfgbd.supabase.co` |
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

All migrations are already applied. Verify the live state any time with:

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
  team. Every teammate types the same code, then their own name, and gets their
  own `team_members` row with its own token. Names are unique per team,
  case-insensitively.
- **RLS stays on with zero policies.** Anon and authenticated have no table
  grants at all, so a leaked anon key reads nothing. Every query runs through
  the backend's service-role client.

## Entity relationships

```
game_sessions 1---* teams 1---* team_members
                 |     |
                 |     +---* team_clues *---1 clues
                 |     +---* submissions
                 +---* clues
                 +---* challenges *---1 submissions
submission_events *---1 submissions
```

### Tables

| Table | Purpose | Notable columns |
|-------|---------|-----------------|
| `game_sessions` | Game room + lifecycle | `room_code` unique, `status`, `team_count`, `active_task_limit`, `final_destination` |
| `teams` | One team slot per session | unique `(session_id, name)`, unique `join_code` |
| `team_members` | A person who joined a team | `name`, unique `(team_id, lower(name))`, unique `token` |
| `clues` | Clue content per tier | `tier` (`tier1/2/3`), `body`, `media_url` |
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
- **Clue fallback.** A challenge points at a clue only through `clue_tier`.
  `approve_submission` uses `challenges.clue_id` when set, otherwise the first
  clue of that tier in the session.

## RPC reference

All are `SECURITY DEFINER` and executable only by `service_role`.

| RPC | Effect |
|-----|--------|
| `generate_join_code()` | 6 chars from a 32-char alphabet with no `0/O/1/I/L` |
| `create_session(name, team_count, task_limit?, room_code?)` | Creates a session plus `team_count` team slots, each with a unique code |
| `join_team(join_code, member_name)` | Redeems a code + name, returns that device's member token |
| `submit_proof(team_id, member_id, challenge_id, photo_path, photo_url?)` | Creates a pending submission |
| `approve_submission(submission_id, note?)` | Claims the challenge, grants the clue, rejects rivals, refills |
| `reject_submission(submission_id, note?)` | Rejects; reopens the board if it was the last pending |
| `refill_board(session_id)` | Retires claimed challenges, activates pool up to `active_task_limit` |

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
| `POST` | `/api/admin/sessions/{id}/end` | admin | End the game |
| `POST` | `/api/admin/sessions/{id}/challenges` | admin | Add a challenge (goes live if there is room) |
| `GET`/`POST` | `/api/admin/sessions/{id}/clues` | admin | List / add clues |
| `POST` | `/api/admin/submissions/{id}/approve` | admin | Approve a proof |
| `POST` | `/api/admin/submissions/{id}/reject` | admin | Reject a proof |
| `GET` | `/api/admin/submissions/{id}/photo` | admin | Short-lived signed photo URL |
| `DELETE` | `/api/admin/members/{id}` | admin | Remove a player |
| `POST` | `/api/join` | none | Redeem a team code + name, returns a token |
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

Photos are never in the broadcast payload; the admin fetches a signed URL on
demand from `/api/admin/submissions/{id}/photo`.

## Storage

Bucket **`challenge-proofs`** (private, 25 MiB, images only). Path convention:

```
{session_id}/{team_id}/{uuid}.{ext}
```

Nothing is reachable directly: anon and authenticated have no `storage.objects`
grants. The backend uploads with the service-role key and mints short-lived
signed URLs for the admin console.

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
