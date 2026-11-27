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
      JoinScreen.tsx      shared team-code entry
      TeamDashboard.tsx   live board, clues, rival progress
      AdminLogin.tsx      PIN entry
      AdminConsole.tsx    sessions, codes, review, content, progress
```

## Screens

| Route | Screen | What it does |
|-------|--------|--------------|
| `/` | Join | Enter the shared team code to join or rejoin |
| `/` | Reconnect | Restore the saved team login with connection feedback, retry, and another-code entry |
| `/` | Team dashboard | Copyable team code in the header, live board, submissions, own clues and rival progress |
| `/admin` | PIN login | Exchanges the PIN for the admin token |
| `/admin` | Console | Create sessions, read out team codes, approve/reject proofs, add clues and challenges, watch progress |

Reconnecting preserves the saved login on temporary failures. Requests time out
after 15 seconds and can be retried; switching to another team code cancels the
old request and retains local drafts. A confirmed invalid login returns to code
entry. The player header receives only the current team's `join_code` from the
backend; rival team codes remain private. Deploy the frontend and backend
together for the header code; no database migration is required.

Joining and restoring a login request `?view=board` first. The board and the
team's submission statuses render immediately; clues, progress and the map load
in the background with loading states and a separate retry. Pending submissions
stay blocked during this phase. The first complete response establishes the
notification baseline, so previously earned clues do not replay as new rewards.
Late HTTP responses preserve newer live updates. Older servers can return a full
snapshot for this request and still work; deploy both services for the speedup.

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
`?admin_token=<token>&session_id=<id>` for the console. Full snapshots establish
state; game and map messages update their respective fields.

Expected socket closures show **Reconnecting**, keep the current board, and
retry with backoff capped at ten seconds. While visible and online, authenticated
HTTP snapshots refresh every five seconds during recovery and every 30 seconds
when healthy. **Updating** means HTTP refreshes are keeping the game current
while the socket recovers. Only failed recovery or browser-offline status shows
**Offline**. HTTP requests do not overlap and time out after ten seconds.

Hidden tabs pause heartbeat checks and refresh requests. Returning to the game
or regaining the network triggers an immediate refresh and a heartbeat grace
period. Old HTTP reads cannot overwrite newer socket updates or confirmed
actions. Authentication failures stop recovery and return to sign-in. Console
diagnostics include close codes and recovery causes, never credential URLs.

This tolerates Vercel's finite WebSocket lifetime. Cross-instance changes are
reconciled by HTTP even when the instance holding the socket missed a mutation;
instant push delivery across instances still requires shared pub/sub.

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
tab also uses the full available content width. Team details stay below the map.
Players can share or stop sharing using the button above the map on the Map
page, including on phones. Joining or rejoining with a team code offers an
optional location prompt once the game is active and its playing area is ready.
Accepting keeps the board open; opening Map does not prompt again. Dismissal is
remembered across reloads, and GPS starts only after the player chooses to share.

Style source: https://tiles.openfreemap.org/styles/liberty
Original design and license: https://github.com/maputnik/osm-liberty

The player header uses one compact block: game name, copyable team code and
the game menu on the first row; team name and live status on the second row.
