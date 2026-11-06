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

The one-shot launcher creates the backend venv, installs both dependency sets,
and opens a window per service:

```powershell
.\start.ps1               # first run: installs dependencies
.\start.ps1 -SkipInstall  # later runs
.\stop.ps1                # free ports 8000 and 5173
```

### VS Code tasks

The same actions are wired up as tasks (`Ctrl+Shift+B` runs the default):

| Task | Effect |
|------|--------|
| `Start All (Backend + Frontend)` | runs both services in parallel (default build task) |
| `Backend: Setup (venv + pip install)` | creates `.venv`, installs `requirements.txt` |
| `Backend: Run` | `uvicorn app.main:app --reload` on `:8000` |
| `Backend: Tests` | `pytest` in the backend venv |
| `Frontend: Setup (npm install)` | installs `node_modules` |
| `Frontend: Run` | `vite` on `:5173` |
| `Frontend: Build` | `tsc --noEmit && vite build` |
| `Stop All` | frees ports 8000 and 5173 |

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
