# Challenge - Real-Time Scavenger Hunt

A web dashboard for a real-time competitive scavenger hunt. The host opens a
session with a fixed number of teams, each team gets its own join code, and
players type their name to get in. Teams race to complete photo challenges on a
shared live board and unlock tiered clues (Tier 1/2/3) that lead to a secret
final destination.

There are **no user accounts**. Identity is a PIN for the host and a per-team
join code for players - the same idea as a Kahoot game PIN.

See [`AGENTS.md`](./AGENTS.md) for the full product brief and mechanics.

## Repository Layout

```
backend/    Python (FastAPI) API + the Supabase/Postgres database layer
  app/        routers, data access, WebSocket hub, snapshot builders
  supabase/   Migrations and optional demo seed
frontend/   Vite + React + TypeScript + Tailwind dashboard
```

The database is the heart of this project: **sniping** (only one team can claim
a challenge) and **clue unlocking** are enforced at the Postgres level so they
stay race-safe regardless of which client calls them.

The database is **hosted on Supabase Cloud** (project `zrfilmdzczsgfzmhfgbd`,
"Game 2 Challenge"). There is no local database container - nothing in this
repo needs Docker or the Supabase CLI to run.

## Prerequisites

- Python 3.11+
- Node 20+ / npm

## Quick Start

Use the VS Code tasks below, or run the backend and frontend in separate terminals.

### VS Code tasks

Development actions are available as tasks (`Ctrl+Shift+B` runs the default):

| Task | Effect |
|------|--------|
| `Start All (Backend + Frontend)` | runs both services in parallel (default build task) |
| `Backend: Setup (venv + pip install)` | creates `.venv`, installs `requirements.txt` |
| `Backend: Run` | `uvicorn app.main:app --reload` on `:8000` |
| `Backend: Tests` | `pytest` in the backend venv |
| `Frontend: Setup (npm install)` | installs `node_modules` |
| `Frontend: Run` | `vite` on `:5173` |
| `Frontend: Build` | `tsc --noEmit && vite build` |

Stop development servers with Ctrl+C in their terminals or VS Code's
**Tasks: Terminate Task** command.

### Manual equivalent

```powershell
# backend
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload

# frontend, in a second terminal
cd frontend
npm install
npm run dev
```

- Backend health: <http://localhost:8000/health> (API docs at `/docs`)
- Player join: <http://localhost:5173/>
- Host console: <http://localhost:5173/admin>

### Environment variables for a shared deployment domain

Keep `VITE_API_BASE_URL=` in `frontend/.env` and
`BACKEND_CORS_ORIGINS=` in `backend/.env` blank. The frontend uses the current
website's origin automatically, so production and preview domains need no URL
edits. Locally, Vite proxies `/api` and `/ws` to the backend on port 8000.

Import the backend and frontend env files into Vercel's project environment
settings, retaining the existing Supabase credentials and admin PIN. Import
`VITE_API_BASE_URL` as Config (or omit it); credentials and the PIN are Secret.
Remove any existing localhost override in Vercel and redeploy the updated code.
This requires deployment routing for `/api/*` to the backend. The app also uses
`/ws` for live updates, which requires a host that supports WebSocket servers;
environment variables alone do not provide that capability.

For a separately hosted backend, set `VITE_API_BASE_URL` to its public origin
without `/api` or a trailing slash, and set `BACKEND_CORS_ORIGINS` to the
frontend's exact origin (comma-separated for multiple origins).

### Vercel project setup

For direct video uploads, apply migration 32 after the earlier migrations and
set a backend-only `CRON_SECRET` in Vercel Production. Videos are limited to
30 seconds, prepared on the device, then transferred directly to private
Supabase Storage in resumable chunks. See
[direct-upload deployment](docs/submission-evidence.md#direct-uploads-migration-32)
for migration, cleanup and device-verification steps.

Before deploying the optimized submission/review code, apply
[`20260101000030_review_submission_result.sql`](backend/supabase/migrations/20260101000030_review_submission_result.sql)
through the Supabase SQL Editor. Deploy frontend and backend together and reload
open clients. See [submission evidence](docs/submission-evidence.md#submission-and-review-latency-changes)
for upload limits, compression, concurrency and verification details.

The root `vercel.json` defines a Vite `frontend` and a FastAPI `backend` in one
project. Set Vercel's Root Directory to the repository root (not `frontend`),
use the Other project framework preset, and clear project-wide build/install/
output overrides so the per-service configuration controls each build.
The top-level rewrites send `/api/*` and `/ws` to the backend and all other
paths to the frontend. The frontend's own rewrite serves client-side routes
such as `/admin` through `index.html`.

No internal service bindings are required: the Vite app runs in the browser
and calls the public API on the same origin. Supabase remains an external
dependency configured with the backend environment variables.

After committing and pushing the configuration, use `vercel dev --local` from
the repository root for local services testing, and check the next deployment's
service builds. A missing PIN should return 503 from `/api/admin/login`, and
an incorrect PIN should return 401; a 404 means routing still needs inspection.

Deployment routing does not make the current in-process game scheduling and
WebSocket broadcasting shared across function instances. The backend's existing
single-worker assumption still needs review before running a live game on an
autoscaling deployment. See [Vercel WebSocket state guidance](https://vercel.com/docs/functions/websockets#manage-persistent-state).

## How a game runs

1. **Host** opens `/admin`, types the PIN from `backend/.env`, and creates a
   session, choosing the number of teams.
2. The console shows **one join code per team**. Hand each team its code.
3. **Players** open `/`, enter their team's code and their own name. Several
   phones can join the same team with the same code.
4. The host adds clues and challenges, then presses **Start hunt**. The board
   goes live and every connected device updates instantly.
5. A team photographs its proof and submits. The host approves or rejects it.
   On approval the challenge is locked for everyone else and the team receives
   the matching clue tier.
6. Everyone sees the same live scoreboard: how many clues each rival team holds.

## Environment

`backend/.env` holds the Supabase keys and the admin PIN. `frontend/.env` only
needs the backend URL - the browser never talks to Supabase directly, so no
Supabase keys belong in the frontend. Both files are gitignored; on a fresh
clone, copy the matching `.env.example`.

| File | Variable | Purpose |
|------|----------|---------|
| `backend/.env` | `SUPABASE_URL` | project URL |
| `backend/.env` | `SUPABASE_SECRET_KEY` | `sb_secret_...` server key; bypasses RLS |
| `backend/.env` | `SUPABASE_SERVICE_ROLE_KEY` | legacy JWT for the same role; either name works |
| `backend/.env` | `ADMIN_PIN` | the host's PIN - change it before the real game |
| `frontend/.env` | `VITE_API_BASE_URL` | FastAPI base URL |

## Documentation

- [`backend/README.md`](./backend/README.md) - schema, RPC reference, API surface, migration workflow
- [`frontend/README.md`](./frontend/README.md) - frontend setup and structure
