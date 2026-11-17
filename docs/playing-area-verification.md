# Playing area and location sharing

Implemented and applied through Supabase MCP on 2026-11-16 after explicit user
approval. Local migration 23 `playing_area` is hosted as `20261116071533`.
No existing game's boundary or destination was configured. No location
collection starts automatically. No hosted temporary game was created.

## New-game defaults and immediate shrinking

Every new game persists these database defaults (existing games are not
backfilled):

| Zone | Center latitude | Center longitude | Radius |
| --- | --- | --- | --- |
| Starting | 1.3108674745426903 | 103.86352181175857 | 7 km |
| Smaller | 1.3068510731577212 | 103.87861641999885 | 5 km |
| Smallest | 1.3028346717727521 | 103.89371102823912 | 3 km |

Hidden endpoint: **1.2993920420142073, 103.90664926387365**. Each zone contains
the endpoint and nests inside its predecessor. The initial point is the first
circle's center; it falls outside the smallest circle. Later centers shift
35% and 70% along the start-to-finish vector instead of centering on the finish.

Shrink times default to blank (manual only). Host can enter increasing minutes
from countdown start, save, and start the countdown. **Shrink area** advances
one zone immediately, with or without a running countdown. It computes the
current zone from elapsed time plus a persisted manual stage floor, so a manual
advance after a timed transition does not repeat the same stage. It preserves
remaining absolute deadlines. Reset clears both the clock and manual floor.
Host must save edited geometry/times before starting or manually shrinking.

## Accepted behavior

- OpenStreetMap with Leaflet, visible attribution, no Google key or billing.
- Host sees one tracker per team. Player devices see rival trackers only while
  that device is actively sharing; another teammate sharing does not unlock them.
  Recent device fixes are combined into an accuracy-weighted team position.
- Host configures a hidden destination and up to 12 circular stages. The first
  starts at zero; optional subsequent times increase and circles shrink completely inside
  the prior circle. Every circle must contain the destination.
- Host can save a plan, start the countdown or manually shrink during an active game. Absolute
  server timestamps drive automatic transitions; reconnect and backend restart
  derive the current stage from the same start time. Reset restores the starting
  area and unlocks editing. Countdown start is idempotent.
- Player REST and WebSocket snapshots contain only the starting/current circle;
  countdown timestamps are redacted. Destination coordinates and future circle geometry
  are host-only. Host may offset circle centers to avoid revealing the finish
  through concentric boundaries.

## Location lifecycle and privacy

### Player shrink announcements (18 November 2026)

Players do not see a shrink countdown or pause/start status. When an active
game's radius becomes smaller, a modal announces the current area and radius
from any player tab, with View map and Got it actions. The host keeps the timer,
slider, Pause/Resume and manual controls. REST/WebSocket player snapshots redact
the start, pause and next-shrink timestamps without altering host data.

Initial join establishes a baseline, so an already smaller area is not announced
as a fresh shrink. Repeated/stale snapshots do not replay an alert. Expansions
and resets are silent; a later shrink alerts again. Other open player dialogs
are coordinated so notifications do not stack. No migration is required.

Verified with 12 desktop/phone/iPhone browser cases, frontend transition unit
tests, and 21 backend tests including timestamp redaction and location access.

### First-join prompt and reciprocal tracking (18 November 2026)

New joins get an optional location prompt once the game is active and its map
is configured. Lobby joins keep the prompt pending across reloads. Share opens
the map and requests browser location permission; Not now is remembered per
game/team on that browser. The prompt explains that sharing reveals the device's
position within the radius and is required to view other teams. Declining does
not block gameplay, the radius, or the device's own team.

Each team has one map marker and one roster entry, combining recent device fixes
with inverse-square GPS accuracy weights (10m floor). A spherical center handles
the date line. The displayed uncertainty includes both device accuracy and spread;
device counts show how many fixes contribute. Individual fixes remain available
internally for leases, expiry, and the current device's outside-zone warning.

Rival access is enforced on both REST snapshots and live WebSocket messages.
The device must present its private sharing lease and UUID, matched to its team
and a location fix less than two minutes old. Credentials stay in memory and
are not included in public map events. Stop clears client access immediately;
lease removal/replacement and expiry revoke server access. A fresh fix under the
same valid lease restores expired access. Hosts retain their full map view.
No database migration or hosted data mutation was needed for these additions.

Verification: production build and 27 frontend unit checks passed; 34 targeted
backend checks passed. All 21 browser cases passed across desktop Chromium,
phone Chromium, and iPhone WebKit, covering opt-in, denial, deferred lobby prompt,
dismissal persistence, team aggregation, and rival visibility before/after sharing.
Tests use simulated GPS and mocked browser API traffic; backend authorization tests
exercise real REST/WebSocket routing with stubbed database reads.

### Device update lifecycle

Each browser chooses **Share my location** and grants browser permission before
any location is sent. A device UUID identifies the sharing browser; the team
comes from its authenticated access token. Updates use a private, rotating
lease. Other teams cannot write a device's position. Stop deletes the share;
late updates cannot recreate it, and an old stop cannot delete a newer lease.
Public events contain coordinates/revisions, never leases or access tokens.

Only the latest fix is stored, without a trail/history. Fresh fixes are requested
every 15 seconds while the game is visible. Hidden tabs pause updates; returning
requests a fresh fix. Permission denial leaves the game playable. Both host and
player screens hide fixes after two minutes. Server cleanup runs every 30 seconds
and clears coordinates older than two minutes (so physical cleanup can take
up to 150 seconds). Ending/deleting a game clears its shares.

Phone geolocation needs HTTPS. Browser tabs cannot guarantee continuous GPS
while a phone is locked or the browser is closed. Reopening does not silently
resume sharing. Markers show GPS accuracy, so their positions are approximate.

## Verification

- Backend suite: **119 passed, 3 hosted tests skipped**. An additional timed/manual transition regression was then added; the final SQL map suite passed **6 tests**. SQL tests run against
  temporary local PostgreSQL with real migrations, roles, leases, expiration,
  ended-game cleanup and timer operations. Geometry tests cover containment and
  hidden future stages; API tests cover authentication and team scoping.
- Targeted API check rerun after correcting the JSON RPC response handling:
  **4 passed**. Later map API checks include host-only shrink authorization and private default-plan isolation.
- Frontend unit suite: **19 passed**, including out-of-order GPS events,
  removal tombstones and snapshot merges.
- Production build: passed, Leaflet loaded as a separate lazy chunk.
- Map browser checks: **12 passed** on desktop, tablet, phone Chromium and
  iPhone WebKit. Covers opt-in, denial, stop, stage changes, host save/start,
  visible attribution, host/player map accessibility and horizontal overflow. Updated host tests exercise three persisted defaults, blank times, two custom schedule values, immediate advance before/after countdown, final-stage disable and unsaved-edit protection across all four layouts. The iPhone contrast check waits for the enabled-button animation to settle before analysis.
- Existing host/player regression run: 47 passed, 5 viewport-specific checks
  skipped, and two session-picker checks initially failed. Fixed the existing
  Delete session button's accessible label to include its visible text and
  narrowed the session-open selector. Both corrected checks plus four delete
  confirmation/retry checks passed on desktop/phone (**6 passed**).
- Final TypeScript check and `git diff --check` passed.
- Screenshots in `frontend/artifacts/playing-area-*.png` and
  `host-playing-area-*.png` use simulated positions and mocked map tiles.
- Supabase MCP verification: migration `20261116071533`, three column defaults
  matching the local plan, zero location shares, RLS enabled and direct
  anon/authenticated reads denied. The shrink RPC is service-only. Counts remain
  one original game, six historical access records, four awards and 24 catalog
  clues. The original game's boundary/destination/start remain null.
- Live default readback and function grants are verified. No hosted game or
  real-phone GPS end-to-end test was performed; local SQL tests execute the
  migration and new-game creation/shrink/lease flows against PostgreSQL.

## Map service

OpenStreetMap is maintained by its contributor community; local completeness
varies. Standard OSM tiles are a free, best-effort public service with usage
requirements, not an unlimited paid-service substitute. This integration uses
HTTPS tiles, visible attribution, normal browser caching and no bulk downloads
or offline prefetch. Tile failure displays a notice while boundaries and the
location roster remain usable. `VITE_MAP_TILE_URL` allows a compatible OSM tile
host; changing providers also requires reviewing its attribution requirements.

Sources: [OSM about](https://www.openstreetmap.org/about),
[tile policy](https://operations.osmfoundation.org/policies/tiles/),
[Leaflet reference](https://leafletjs.com/reference-1.9.4.html),
[browser geolocation](https://www.w3.org/TR/geolocation/).

## Self-evaluation

Overall **4.0/5** across five axes.

| Axis | Score | Evidence and improvement |
| --- | --- | --- |
| Accuracy | 4 | Local geometry, SQL and four browser engines/layouts pass. Hosted schema/default/grant readback is verified; real-phone GPS remains unverified. Validate on an HTTPS phone session. |
| Completeness | 4 | All agreed map/shrink/privacy flows implemented. Hosted migration is applied; application deployment is outside this task's authorization. |
| Clarity | 4 | Host editor explains nested stages and hidden finish; sharing copy states who sees locations. A field trial would confirm timer wording works during play. |
| Actionability | 4 | Host can save/start from Map and players can share/stop. Live storage is ready; frontend/backend changes are local and uncommitted. |
| Conciseness | 4 | UI uses short labels and optional coordinate details. Verification details live here instead of crowding the user response. |

Top improvements: validate a full hosted game when one is authorized; validate GPS on an actual
HTTPS phone session. Self-check: the user should agree that the requested flows
are implemented, while application deployment and phone GPS are explicit limits.
