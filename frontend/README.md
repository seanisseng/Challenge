# Frontend — Scavenger Hunt Dashboard

Vite + React + TypeScript + Tailwind CSS, talking to Supabase (Auth, Realtime,
Storage) and the FastAPI backend.

```
frontend/
├── index.html
├── vite.config.ts
├── tailwind.config.js
└── src/
    ├── main.tsx          React bootstrap
    ├── App.tsx           app shell (placeholder)
    ├── index.css         Tailwind + base styles
    └── lib/supabase.ts   browser Supabase client (RLS-scoped)
```

## Setup

```powershell
cd frontend
npm install
copy .env.example .env    # VITE_* keys from the Supabase dashboard
npm run dev               # http://localhost:5173
```

Fill `.env` with the **anon / publishable** key only — never the service-role
key (it must stay server-side).

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase API URL |
| `VITE_SUPABASE_ANON_KEY` | RLS-scoped publishable key |
| `VITE_API_BASE_URL` | FastAPI base URL |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | `tsc --noEmit` |

## Notes

The client in `src/lib/supabase.ts` runs every query as the signed-in user, so
Row Level Security applies automatically. Teams sign in anonymously, then call
the `join_session` / `submit_proof` RPCs; the live board and unlocked clues
update via Supabase Realtime subscriptions.

> The dashboard UI (join screen, live board, clue inventory, admin review
> console) is the next milestone. `App.tsx` is currently a placeholder shell.
