# Challenge — Real-Time Scavenger Hunt

A web dashboard for a real-time competitive scavenger hunt. Teams join a game
session, race to complete photo challenges on a shared live board, and unlock
tiered clues (Tier 1/2/3) that lead to a secret final destination.

See [`AGENTS.md`](./AGENTS.md) for the full product brief and mechanics.

## Repository Layout

```
backend/    Python (FastAPI) API + the Supabase/Postgres database layer
  supabase/   Migrations, RLS policies, RPC functions, seed data
frontend/   Vite + React + TypeScript + Tailwind dashboard
```

The database is the heart of this project: **sniping** (only one team can claim
a challenge) and **clue unlocking** are enforced at the Postgres level so they
stay race-safe regardless of which client calls them.

## Prerequisites

- Python 3.11+
- Node 20+ / npm
- Docker (for a local Supabase stack)
- [Supabase CLI](https://supabase.com/docs/guides/cli)

## Quick Start

### 1. Database (Supabase)

```powershell
# from the repo root
cd backend
supabase start          # boots Postgres, Auth, Storage, Realtime in Docker
supabase db reset       # applies supabase/migrations/*.sql then supabase/seed.sql
```

`db reset` prints the local API URL and keys — copy the anon key into
`frontend/.env` and the service-role key into `backend/.env`.

### 2. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env   # then fill in keys from `supabase status`
uvicorn app.main:app --reload
```

Health check: <http://localhost:8000/health>

### 3. Frontend

```powershell
cd frontend
npm install
copy .env.example .env   # then fill in VITE_SUPABASE_* keys
npm run dev
```

Dashboard: <http://localhost:5173>

## Documentation

- [`backend/README.md`](./backend/README.md) — schema (ERD), RLS matrix, RPC reference, migration workflow
- [`frontend/README.md`](./frontend/README.md) — frontend setup and structure
