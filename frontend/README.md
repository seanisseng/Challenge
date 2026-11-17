# Frontend - Scavenger Hunt Dashboard

Vite + React + TypeScript + Tailwind CSS.

The browser talks **only** to the FastAPI backend. It never touches Supabase
directly, so no Supabase key exists anywhere in this app - which means a
leaked bundle cannot read the database.

```
frontend/
  index.html
  vite.config.ts
  tailwind.config.js
  src/
    main.tsx              React bootstrap
    App.tsx               route switch + session restore
    index.css             Tailwind + base styles
    lib/
      api.ts              fetch wrapper, token storage, endpoint helpers
      types.ts            payload types mirroring backend snapshots
      router.ts           tiny history-API router
      useLive.ts          WebSocket hook with reconnect + heartbeat
    components/
      Badges.tsx          tier / challenge / submission pills
    screens/
      JoinScreen.tsx      team code + player name
      TeamDashboard.tsx   live board, clues, rival progress
      AdminLogin.tsx      PIN entry
      AdminConsole.tsx    sessions, codes, review, content, progress
```

## Screens

| Route | Screen | What it does |
|-------|--------|--------------|
| `/` | Join | Enter a team code and your name; a stored token rejoins silently on reload |
| `/` | Team dashboard | Live board with photo submission, own clues by tier, rival clue counts |
| `/admin` | PIN login | Exchanges the PIN for the admin token |
| `/admin` | Console | Create sessions, read out team codes, approve/reject proofs, add clues and challenges, watch progress |

## Setup

```powershell
cd frontend
npm install
copy .env.example .env
npm run dev               # http://localhost:5173
```

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | FastAPI base URL (default `http://localhost:8000`) |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | `tsc --noEmit` |

## How live updates work

`useLive.ts` opens one WebSocket per device: `?token=<team token>` for players,
`?admin_token=<token>&session_id=<id>` for the console. The backend sends a
complete snapshot on connect and again after every mutation, so the client
never polls and never merges diffs - each message just replaces state.

If the socket drops, the hook reconnects with exponential backoff and shows
`Offline` in the header. A manual **Refresh** button re-fetches `/api/state` as
a fallback.

## Credentials in the browser

- The team token is a UUID in `localStorage` (`challenge.team-token`). It is
  the device's identity; "Leave" clears it.
- The admin token is in `localStorage` (`challenge.admin-token`) and is only
  ever obtained by typing the PIN. Signing out clears both it and the last
  selected session.

Neither token grants direct database access - both are checked by the backend
on every request.

## Map appearance

The map uses OpenMapTiles vector data hosted by OpenFreeMap, rendered through
MapLibre's Leaflet layer. Leaflet still handles game overlays and interaction.
`public/game-map-style.json` is a local adaptation of OpenFreeMap's Liberty
style, with turquoise water, soft green parks, pale land and yellow roads.
Tiles, fonts and sprites need network access; no API key is required.
Set `VITE_MAP_STYLE_URL` in `frontend/.env` to use a different style endpoint.
The previous raster `VITE_MAP_TILE_URL` setting is superseded by this option.

The map fills 78% of the viewport height, with a 420px minimum. The player Map
tab also uses the full available content width. Controls and team details stay
below the map.

Style source: https://tiles.openfreemap.org/styles/liberty
Original design and license: https://github.com/maputnik/osm-liberty
