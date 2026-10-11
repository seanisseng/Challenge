# Backend — API + Supabase Database

FastAPI service plus the **Postgres/Supabase data layer** for the scavenger
hunt. The database folder (`supabase/`) is the heart of the project: the
sniping and clue-unlock mechanics are enforced in Postgres so they stay
race-safe no matter which client calls them.

```
backend/
├── app/                     FastAPI app
│   ├── main.py              app + /health + /docs
│   ├── config.py            env-driven settings
│   └── db/supabase_client.py admin (service-role) + anon clients
├── tests/                   pytest smoke tests (no live DB required)
├── supabase/                Supabase project root
│   ├── config.toml
│   ├── migrations/          schema, RLS, RPCs, storage, realtime
│   └── seed.sql             demo session + banana-tree example
└── requirements.txt
```

## Running the database

```powershell
cd backend
supabase start          # boots Postgres/Auth/Storage/Realtime in Docker
supabase db reset       # applies migrations/*.sql then seed.sql
supabase status         # prints API URL + anon / service-role keys
```

All 7 migrations apply cleanly on a fresh database; `seed.sql` populates a
playable demo session (room code `SUNSET`).

## Auth model

- **Admins** — real email/password accounts listed in `admin_users`.
  `public.is_admin()` gates every privileged RPC and RLS policy.
- **Teams** — Supabase **anonymous sign-in**. One auth user maps to one team
  (`teams.user_id` is unique); `public.current_team_id()` /
  `public.current_session_id()` derive identity inside RLS.

## Entity relationships

```
game_sessions 1─┬─* teams 1──* team_clues *──1 clues
                │                 │
                ├─* clues         │
                ├─* challenges 1──┘
                └─* submissions *──1 challenges
                                 └──1 teams
submission_events *──1 submissions
```

### Tables

| Table | Purpose | Notable columns |
|-------|---------|-----------------|
| `admin_users` | Admin allow-list | `user_id → auth.users` |
| `game_sessions` | Game room + lifecycle | `room_code` unique, `status`, `active_task_limit` (default 6), `final_destination` (admin-only) |
| `teams` | A team in a session | unique `(session_id, name)`, unique `user_id` |
| `clues` | Clue content per tier | `tier` (`tier1/2/3`), `body`, `media_url` |
| `challenges` | Pool + live board | `clue_tier`, `clue_id`, `status`, `is_active`, `claimed_by_team_id` |
| `submissions` | Photo proof + review | `photo_path`, `status`, `reviewed_by` |
| `team_clues` | Unlocked clue inventory | unique `(team_id, clue_id)` |
| `submission_events` | Audit trail | `event`, `actor_id` |

### Enums

`session_status`: `lobby` · `active` · `ended`
`challenge_status`: `open` · `pending_approval` · `claimed`
`clue_tier`: `tier1` · `tier2` · `tier3`
`submission_status`: `pending` · `approved` · `rejected`

## Sniping mechanics (enforced in Postgres)

- **Many pending, one winner.** A partial unique index permits unlimited
  `pending` submissions per challenge but only **one** `approved` row
  (`submissions_one_approved_per_challenge`). A second index stops a team from
  double-submitting the same challenge while pending.
- **Guard trigger.** `submissions_before_insert` locks the challenge and
  refuses inserts against a `claimed` challenge, and flips `open →
  pending_approval` — so even a direct REST insert can't cheat.
- **Atomic approval.** `approve_submission()` runs in one transaction: marks
  the winner, claims the challenge, grants the matching tier clue, auto-rejects
  rival pending submissions, and refills the board.

## RPC reference

All are `SECURITY DEFINER` and re-check identity internally.

| RPC | Caller | Effect |
|-----|--------|--------|
| `join_session(room_code, team_name)` | team | Idempotent join/rename |
| `submit_proof(challenge_id, photo_path, photo_url?)` | team | Creates a pending submission |
| `approve_submission(submission_id, note?)` | admin | Claims challenge + grants clue |
| `reject_submission(submission_id, note?)` | admin | Rejects; reopens board if last pending |
| `refill_board(session_id)` | admin | Retires claimed, activates pool up to `active_task_limit` |

## RLS matrix

| Table | Admin | Team (own) | Team (other sessions) |
|-------|-------|-----------|------------------------|
| `game_sessions` | all | read own session | ✗ |
| `teams` | all | read session peers, update self | ✗ |
| `clues` | all | read **only unlocked** | ✗ |
| `challenges` | all | read active board of session | ✗ |
| `submissions` | all | insert + read own | ✗ |
| `team_clues` | all | read own | ✗ |
| `submission_events` | all | read own submissions' events | ✗ |
| `admin_users` | read | ✗ | ✗ |

Helpers used by policies: `is_admin()`, `current_team_id()`, `current_session_id()`.

## Storage

Bucket **`challenge-proofs`** (private, 25 MiB, images only). Path convention:

```
{session_id}/{team_id}/{filename}
```

Teams may upload/read only their own prefix; admins manage all objects.
Serve files via signed URLs generated server-side with the service-role client.

## Realtime

`challenges`, `teams`, `submissions`, and `team_clues` are added to the
`supabase_realtime` publication with `replica identity full`. Realtime honors
RLS, so each team receives only their session's board and their own rows.

## Migrations

Timestamp-prefixed SQL in `supabase/migrations/`:

| File | Contents |
|------|----------|
| `…0001_init_schema` | extensions, enums, tables |
| `…0002_constraints_indexes` | partial indexes, indexes, triggers |
| `…0003_helpers` | `is_admin` / `current_team_id` / `current_session_id` |
| `…0004_rls_policies` | enable RLS + full policy matrix |
| `…0005_rpc_functions` | join / submit / approve / reject / refill |
| `…0006_storage` | bucket + storage policies |
| `…0007_realtime` | publication + replica identity |

Add a new migration with:

```powershell
supabase migration new <name>
# edit the generated file, then:
supabase db reset          # local
supabase db push           # remote
```

## Backend app

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env      # fill in keys from `supabase status`
uvicorn app.main:app --reload
```

- Health: <http://localhost:8000/health>
- Tests: `python -m pytest`

> The FastAPI layer currently exposes only a health check; feature routers are
> the next milestone and sit on top of the RPCs above.

## Seeded demo data (`supabase/seed.sql`)

Room code **`SUNSET`**, 3 teams, 6 clues (2 per tier), 8 challenges (6 live),
and one already-approved submission. Seeded auth users share the password
`password123` (e.g. `admin@example.com`, `banana@example.com`).
