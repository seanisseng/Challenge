# RESUME — Scavenger Hunt App

> Handoff note. Paste this file into a fresh session to continue without
> re-deriving context. Last updated **2026-11-07**.

---

## TL;DR

The app is **feature-complete and building green**, but it has **never been run
end-to-end against the live database** because the Supabase service key is blank.
Two things are unfinished:

1. **Challenge reference photos** — designed, not yet coded. This is the next task.
2. **Seeding the 29 challenges** — SQL spec written below, not yet inserted.

Nothing is committed. Working tree is dirty on `main` at `bbb978a`.

---

## 1. What the app is

A Kahoot-style live scavenger hunt. No user accounts.

| Role | Identity | Can do |
|---|---|---|
| Admin | PIN → stateless HMAC token | Create sessions, issue team codes, approve/reject photo proofs, add challenges and clues |
| Team | Per-team join code + member name → member token in `localStorage` | See the live board, upload photo proof, read unlocked clues |

Teams share one join code; each player enters their own name, so a team can
have many devices. Approving a submission claims the challenge for that team
(sniping) and unlocks the clue for its tier.

**Win condition:** first team to reach the secret final location. No points.

**Clue tiers:** Tier 1 = macro direction, Tier 2 = landmark anchor, Tier 3 =
precision pin. Completing a Tier *N* challenge unlocks the Tier *N* clue.

---

## 2. Infrastructure

| Piece | Value |
|---|---|
| Database | Hosted Supabase project `zrfilmdzczsgfzmhfgbd` ("Game 2 Challenge", eu-north-1, Postgres 17) |
| Backend | FastAPI + `supabase-py`, `backend/`, venv at `backend/.venv` (Python 3.12.6) |
| Frontend | React 18 + Vite + TypeScript + Tailwind, `frontend/` (Node 24.14.0) |
| Realtime | **Backend WebSocket hub** (`/ws`), not Supabase Realtime, not polling |
| Storage | Bucket `challenge-proofs` (private, signed URLs for admin review) |

**No Docker anywhere.** Run the backend and frontend directly (`start.ps1`).

**All DB access is mediated by the backend** using the service-role key. The
browser never talks to Supabase. RLS is enabled with **zero policies**, and
anon/authenticated grants are revoked — the backend is the only door.

---

## 3. Verified working state

- Migrations `0001`–`0012` applied and verified on the remote project.
- Backend: 17 routes live; `uvicorn` smoke test passed on `:8899`.
- Tests: **28 collected, 27 passed, 1 skipped** (`pytest -q`).
  The skip is `tests/test_live_flow.py`, gated on `CHALLENGE_LIVE_TESTS=1` + a real key.
- Frontend: `tsc --noEmit` clean, `vite build` green (40 modules, ~23.6 kB CSS).
- Light theme applied everywhere: page `#f6f7fb`, white cards, `slate-900` text,
  brand `#4f46e5` / `#4338ca`, `emerald-700` for white-on-green buttons.

### Schema notes worth remembering

- `challenges` columns: `id, session_id, title, location_area,
  completion_condition, clue_tier, clue_id, status, is_active,
  claimed_by_team_id, sort_order, created_at, updated_at`.
- `is_active` defaults **false** — seeded rows stay off the board until
  `refill_board()` runs when the admin presses **Start hunt**.
- No unique constraint on `challenges.title`.
- `team_clues` is unique on `(team_id, clue_id)` — one clue per tier per team.

---

## 4. Current target session

| Field | Value |
|---|---|
| Name | `Game2` |
| Room code | `95Q2X3` |
| Session id | `31095d65-eacf-453b-8a34-a6d5eccb73cb` |
| Status | `lobby` |
| Teams | 6 |
| Challenges | **0** |
| Clues | **0** |

It is the only session in the database.

---

## 5. Challenge content — `challenges/challenges.md`

The canonical spec. **29 challenges**, renumbered `1`–`29` (the `#` column is
`sort_order`). Tier split: **10 / 12 / 7**.

Names are creative; the rule text is unchanged. `Name` → `challenges.title`,
`Complete when` → `completion_condition`, `Where` → `location_area`.

### Photo convention

`challenges/challenge<N>.jpg` belongs to challenge `#N`:

| File | Challenge | What it shows |
|---|---|---|
| `challenge2.jpg` | #2 Strava-geddon | Marina Bay Loop 3 km route map |
| `challenge13.jpg` | #13 Copy-Pose | 6-person star-pose reference |

Only these two have photos. All others have none.

### What the user edited by hand, and what I cleaned up

The user cut four challenges from the original 33 — **Birthday Ambush** (#16),
**Birthday Jackpot** (#18), **Stonehenge Lite** (#19), **Stonehenge Deluxe**
(#21) — leaving one birthday challenge and one rock statue. I then:

- renumbered `1`–`29` so `sort_order` has no gaps,
- fixed the malformed row `| 20 | 1| Stonehenge Dupe |here |` →
  `| 17 | 1 | Stonehenge | Anywhere |`,
- fixed the SQL link (the file moved into `challenges/`),
- updated the counts (33 → 29, tier table 11/13/9 → 10/12/7),
- moved resolved questions (#7 deck-of-cards, #13 pose image) out of "open".

**Confirm with the user that those four deletions were intentional.**

---

## 6. NEXT TASK — challenge reference photos

**Request:** "a category for photos that would be uploaded to the DB as well."
Interpretation: each challenge may have one reference photo, stored in Supabase
Storage and seeded alongside the challenge rows.

### Design decisions already made

- One optional photo per challenge: `challenges.image_path text`.
- Bucket **`challenge-assets`**, **public read** (every player must see the
  photo; the images are game assets, not private data). Writes stay service-role
  only, so nothing in the browser can upload there.
- Store the **object key**, derive the URL in the backend:
  `{SUPABASE_URL}/storage/v1/object/public/challenge-assets/{image_path}`.
  This avoids signed-URL expiry churn on every snapshot broadcast.
- Path convention: `{session_id}/challenge{N}.jpg`.

### Checklist

1. **Migration** `backend/supabase/migrations/20260101000013_challenge_images.sql`
   - `alter table public.challenges add column if not exists image_path text;`
   - insert the `challenge-assets` bucket into `storage.buckets` (`public = true`,
     10 MiB limit, jpeg/png/webp), `on conflict do update`.
   - Apply it with the Supabase MCP `execute_sql` tool.
2. **`backend/app/config.py`** — add `asset_bucket: str = "challenge-assets"`.
3. **`backend/app/repo.py`**
   - add `image_path` to the `active_challenges()` select list,
   - `create_challenge(..., image_path=None)`,
   - `get_challenge(challenge_id)`, `set_challenge_image(challenge_id, path)`,
   - `upload_challenge_image(session_id, filename, data, content_type) -> path`,
   - `public_asset_url(path) -> str | None`.
4. **`backend/app/snapshots.py`** — in `session_core()`, map each board row so
   `image_path` is replaced by `image_url`. Both team and admin payloads inherit
   this because both read `core["board"]`.
5. **`backend/app/routers/admin.py`** — new endpoint
   `POST /api/admin/sessions/{session_id}/challenges/{challenge_id}/image`
   (multipart `file`), validate content type + `max_upload_bytes`, upload, set
   path, broadcast.
6. **`backend/tests/test_api_surface.py`** — add the new path to the
   `test_openapi_exposes_the_full_api` list and to the admin-token-required
   parametrisation.
7. **Frontend**
   - `lib/types.ts`: `Challenge.image_url: string | null`.
   - `lib/api.ts`: `uploadChallengeImage(sessionId, challengeId, file)`; change
     `addChallenge` to return `{ id: string }`.
   - `screens/TeamDashboard.tsx`: render the photo in `ChallengeCard` with a
     graceful `onError` hide.
   - `screens/AdminConsole.tsx`: optional file input in the "Add a challenge"
     form (create → upload), and a thumbnail in the Board tab.
8. **`backend/supabase/seed_challenges.sql`** — see section 7.
9. **`backend/scripts/upload_challenge_assets.py`** — upload every
   `challenges/challenge*.jpg` to `{session_id}/challenge{N}.jpg` with
   `upsert: true`, then set `image_path` for `sort_order = N`.
10. **Docs** — mention the bucket in `backend/README.md`; add a `Photo` column to
    `challenges/challenges.md`.

### Caveat

The MCP server can run SQL but **cannot upload file bytes**. The actual upload
needs the service key, so it waits for section 9 below. Until then the seeded
`image_path` points at an object that does not exist yet — hence the frontend
`onError` fallback is required, not optional.

---

## 7. THEN — seed the 29 challenges

Write `backend/supabase/seed_challenges.sql` as an idempotent `DO` block:

- resolve `v_session` from `game_sessions where room_code = '95Q2X3'`,
- **return early** if that session already has any challenges,
- insert 29 rows with the titles/conditions/locations/tiers from
  `challenges/challenges.md`, `sort_order` 1–29,
- set `image_path = v_session::text || '/challenge2.jpg'` for #2 and
  `'/challenge13.jpg'` for #13, `null` everywhere else,
- leave `is_active` at its default `false`.

Apply with the MCP `execute_sql` tool, then verify:

```sql
select clue_tier, count(*) from public.challenges
 where session_id = '<id>' group by clue_tier;   -- expect tier1 10, tier2 12, tier3 7
```

**Escaping:** `Finlayson's` and `McDonald's` need `''` in SQL. Challenge #23
keeps the `{{phone}}` token verbatim — do **not** expand it in the seed.

**Tier mix on the opening board** is still 1, 3, 2, 1, 2, 3 — deliberate, so the
first six live challenges are never all one tier.

---

## 8. Blocked

`backend/.env` has **`SUPABASE_SERVICE_ROLE_KEY` blank** (and no
`SUPABASE_SECRET_KEY`). Until one is filled in:

- no backend request can reach the database,
- no file can be uploaded to Storage,
- `tests/test_live_flow.py` stays skipped.

`ADMIN_PIN` is already set in `backend/.env` (value not repeated here on purpose).

Once the key exists:

```powershell
cd C:\GitHub\Challenge\backend
$env:CHALLENGE_LIVE_TESTS=1
.\.venv\Scripts\python.exe -m pytest tests/test_live_flow.py -v
```

---

## 9. Open decisions for the user

| # | Item | Current state |
|---|---|---|
| 1 | **#22 Squat Squad** — "drink 4" is unspecified | Seeded as "drink 4 drinks as a team" |
| 2 | **#26 One-Word Wonder** — "5 attempts" is unclear | Seeded verbatim |
| 3 | **#23 Call Me Maybe** — real phone number | **Resolved:** the number is no longer in the content. `{{phone}}` is substituted from `CONTACT_PHONE` in `backend/.env` at render time (see section 13) |
| 4 | Four challenges cut from the 33 | Confirm the deletions were intentional |

---

## 10. File map

```
challenges/
  challenges.md            canonical 29-challenge spec (names, tiers, order)
  challenge2.jpg           reference photo for #2 Strava-geddon
  challenge13.jpg          reference photo for #13 Copy-Pose

backend/
  .env                     needs SUPABASE_SERVICE_ROLE_KEY
  app/config.py            admin_pin, admin_token (HMAC), service_key, proof_bucket, contact_phone
  app/repo.py              all DB + storage access, RPC wrappers, refill_board
  app/snapshots.py         session_core / team_payload / admin_payload
  app/realtime.py          WebSocket hub
  app/deps.py              require_admin, current_member
  app/routers/play.py      /api/join, /api/state, /api/submissions, /api/clues
  app/routers/admin.py     login, sessions, content, approve/reject
  app/routers/ws.py        /ws?token= and /ws?admin_token=&session_id=
  supabase/migrations/     0001–0012 applied; 0013 is the next number
  supabase/seed.sql        optional demo seed (already model-accurate)

frontend/src/
  lib/api.ts               fetch wrapper, token storage, socket URLs
  lib/types.ts             mirrors backend snapshots
  lib/useLive.ts           WebSocket hook
  screens/JoinScreen.tsx
  screens/TeamDashboard.tsx
  screens/AdminLogin.tsx
  screens/AdminConsole.tsx  sessions / codes / review / board / content / progress
  index.css                light-theme tokens + .field/.card/.btn-*
```

---

## 11. Commands

```powershell
# everything
.\start.ps1
.\stop.ps1

# backend only
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000

# tests
.\.venv\Scripts\python.exe -m pytest -q

# frontend only
cd frontend
npm run dev
npm run build          # tsc --noEmit && vite build
```

---

## 12. Gotchas

- **MCP `execute_sql` output** is wrapped in `<untrusted-data-UUID>…</untrusted-data-UUID>`.
  Parse by finding the closing tag, then `lastIndexOf("<untrusted-data", end)`,
  and slice after the next `>`.
- **The MCP server cannot read secrets** — only publishable keys are exposed.
  That is why the service key must be supplied by hand.
- **Playwright is not installed**, so there is no browser-based visual check.
  Frontend changes are verified by `tsc` + `vite build` + inspecting emitted CSS.
- **`_IncludedRouter`** in `app.openapi()` is FastAPI 0.143's lazy wrapper, not a
  routing failure. Check `app.openapi()["paths"]` instead.
- **`start.ps1` / `stop.ps1`** work; `.vscode/tasks.json` has per-service tasks;
  `.dev-servers.json` is gitignored.

---

## 13. Deploy-time placeholders (`{{phone}}`)

The host's contact number is **not** in the repo and **not** in the database.
Challenge #23 stores the literal token `{{phone}}`, and `app/snapshots.py` swaps
it out when building a snapshot:

| Env value | Players see |
|---|---|
| `CONTACT_PHONE=<number>` | "…make a call to Sean at <number>." |
| unset or blank | "…make a call to Sean at the number your station leader gives you." |

- Declared in `app/config.py` as `contact_phone`.
- Applied by `fill_placeholders()` / `_render_challenge()` in `app/snapshots.py`
  to `title`, `location_area`, and `completion_condition` on every board row.
  Both team and admin payloads inherit it through `core["board"]`.
- Covered by `backend/tests/test_placeholders.py` (4 tests).
- The real value lives in `backend/.env` (gitignored). In production, set it in
  the host's environment panel instead.

**To change the number:** edit `CONTACT_PHONE` and restart the backend. No
migration, no re-seed, no database write.
