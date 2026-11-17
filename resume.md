# Scavenger Hunt App — Handoff

Updated 2026-11-16

## Current task - playing area map

- User chose OpenStreetMap, all teams + host seeing every opted-in device,
  and host-configured automatic timed shrinking with a hidden destination.
- Applied map migration 23 `playing_area` through Supabase MCP after explicit
  user approval; hosted version `20261116071533`. No hosted migration remains
  pending. No temporary live game created; existing game remains unconfigured.
- Every new game persists default 7/5/3 km circles. Start center:
  1.3108674745426903, 103.86352181175857. Hidden finish:
  1.2993920420142073, 103.90664926387365. Later centers shift 35% / 70% toward
  the finish, retaining nested containment while letting the start leave the
  final zone. Exact centers are in the verification doc and migration.
- Shrink times default null (manual only). Host can set minutes from countdown
  start, save, then start. Shrink area advances one stage immediately before or
  after countdown start. Persisted map_stage_floor plus elapsed clock prevent
  repeating timed stages, survive restart, preserve remaining deadlines. Reset
  clears floor/clock. Unsaved edits disable start/shrink until saved.
- Player snapshots expose only starting/current circles and next deadline;
  finish and future geometry stay host-only. Default finish is supplied by the
  backend, not hardcoded into the frontend bundle.
- Every device explicitly opts in; 15-second visible-tab fixes, stop anytime,
  two-minute stale marker expiry, no location history. Rotating private leases
  and revision tombstones prevent late updates from resurrecting stopped shares.
  All views group devices under team names. HTTPS required on actual phones;
  background/locked-phone GPS is not guaranteed.
- Local verification: backend 119 passed / 3 hosted skipped + final SQL map suite 6 passed, frontend 19 unit
  checks, production build, 12 map browser checks across desktop/tablet/phone/
  iPhone WebKit. Host/player regressions: 47 passed, 5 viewport skips; fixed two existing
  session-picker accessibility/selector failures and reran both plus four
  delete-session checks (6 passed). TypeScript and diff checks pass. See
  `docs/playing-area-verification.md` for privacy, sources, evidence and limits.
- No commit, push or deployment performed.

## Previous handoff - shared team access and naming

- Latest identity model: **team-only access**. Players enter only the team code;
  repeat joins return the same shared team credential and all existing clues,
  submissions and progress. Personal names, recovery links, individual roster
  controls and misleading player-count displays are removed from the UI.
  Historical records and existing device credentials are preserved. The discarded
  individual-recovery feature was never applied to Supabase.
- Temporary startup/network failures now preserve saved access and offer Retry;
  only an explicitly invalid credential clears it. Closing/reopening the browser
  restores saved access; if local storage is lost, re-enter the team code.
- **Game menu > Change team name** is available to any joined teammate. Names
  are limited to 40 characters and unique within the game regardless of case.
  Changes broadcast to teammates and host; cached WebSocket identities use fresh
  team names. Team code, shared identity, earned clues and progress stay intact.
- Applied through Supabase MCP on 2026-11-16: local migration 21
  `team_pool_access` as hosted `20261116054423`, and migration 22 `team_names`
  as hosted `20261116055049`. Map migration 23 is now also applied (see current task above).
- Live verification used an explicitly approved scratch game: repeated code-only
  joins, two teammate sockets plus the host socket, authorized renaming, rejected
  duplicate names and an earned clue surviving rejoin/rename all passed. Scratch
  game was deleted; the original active game, six historical access records,
  four earned clues and 24 permanent clues were unchanged. See
  `docs/team-access-verification.md` for tests and limits.
- The user's latest database direction is one permanent shared `clues` catalog.
  Migration `backend/supabase/migrations/20260101000020_global_clue_catalog.sql`
  was applied through Supabase MCP to project `ceqfgjqwvuqhtsbmxfdn` as hosted
  version `20261115142016` (`global_clue_catalog`). All 24 player-facing clues
  match `clues/clues.md`, eight per tier. `clues.session_id` is removed;
  there is no `clue_templates` table or per-session seeding.
- Every game draws randomly from the shared rewarded tier, excluding that
  team's existing clues. Deleting a game preserves the catalog. Two hosted
  scratch games verified create/reveal/submit/approve and actual backend player
  snapshots changing from 0 to 1 matching-tier clue. Scratch games were cleaned
  up and the original active game preserved. See
  `docs/global-clue-catalog-verification.md`.
- Player success modals now close after **8 seconds**; rejection modals after
  **8 seconds**. Early dismissal remains available. Rival-team notices are
  unchanged; the user explicitly said no extra rival-notification check was needed.
- Added the Race Control favicon: existing navy takeoff mark on orange.
  Assets in `frontend/public/` include SVG, 16/32px ICO, 32px PNG and 180px Apple
  touch icon; `frontend/index.html` links them. Production build includes all.
- Fixed host Progress showing "Full tier breakdown unavailable" while players
  could see earned tiers. `repo.progress` now includes authoritative
  `clue_tier_counts` from `team_clues -> clues(tier)` for every team. Both views
  prefer this field over board/history inference; it uses no additional query.
  Read-only checks against the running host API matched all current inventories:
  Team 4 has Tier 1: 1, Tier 2: 2, Tier 3: 1 (four clues total).
  Backend regressions, eight desktop/phone browser cases and the frontend build
  pass. See `docs/progress-tier-counts-verification.md`.
- Players' unlocked clues now appear as individual paper slips in Your clues:
  warm ruled paper, folded corner, lightly torn bottom edge and soft shadow.
  Tier groupings, private clue wording and reference links are preserved.
  The existing player-view checks pass on desktop, phone and iPhone WebKit;
  production build passes. See `docs/player-race-control-verification.md`.
- Hosts now receive a small, nonblocking notification for new pending submissions.
  **Open submission** switches to Review, selects that exact proof and focuses
  its workspace. Notices queue until opened/dismissed, disappear for reviewed
  proofs, and do not replay existing submissions on initial connection or repeats.
  Notifications are suppressed on Review; entering Review clears queued notices,
  and submissions arriving there are marked seen so they do not replay on leaving.
- The updated local backend was started on `http://127.0.0.1:8000` and verified
  through actual read-only HTTP requests: healthy, 24 catalog clues, and the old
  session-specific clue-creation route absent. The frontend was started on
  `http://127.0.0.1:5173`. Confirm these processes still run when resuming.
- Browser QA uses local fixtures so notification checks do not mutate the active
  game. Desktop and phone modal timing and host proof-navigation checks pass.
  Frontend build and 17 unit tests pass. See
  `docs/host-submission-notifications-verification.md` for final browser results.
- Changes are local and uncommitted. The database migration is live; no application
  deployment, commit, or push was performed. Preserve the current working tree.

The sections below are historical notes. They do not override this handoff;
references to session-owned clues, pending wording approval, or 8/12-second
modal durations are superseded.

## Latest: random clue rewards and session deletion

- Migration `20260101000019_random_unowned_clue_rewards.sql` is applied to
  Supabase. Every approved challenge filters clues by session and rewarded
  tier, excludes clues the winning team owns, and grants one random remaining
  clue. Bound challenge clues do not override this draw. Exhausted tiers do
  not repeat clues. Verified the committed function and permissions on a fresh
  database connection; see `docs/random-clue-rewards-verification.md`.
- Hosts can delete a session from its header or the session picker, with a
  named confirmation, busy state and error retry. The authenticated delete
  endpoint removes its game records and disconnects its room. Storage objects
  are retained. No migration required; existing games were not deleted for
  verification. See `docs/delete-session-verification.md`.
- Team progress now uses shared tier stickers and cards in the player and host
  views; missing tier breakdowns are labelled explicitly. See
  `docs/team-stickers-verification.md`.
- Pre-push verification: full local backend suite passed (three hosted tests
  skipped), frontend production build and 17 unit tests passed, and selected
  desktop/phone/WebKit browser regressions passed 21 tests with six viewport
  skips. No dependency manifests or lockfiles changed in this release.
- Dependency audits found existing findings: `npm audit` reports three affected
  packages (Vite high, esbuild and postcss-selector-parser moderate).
  `pip-audit` reports certifi 2026.7.22 advisory `PYSEC-2026-4320`, fixed in
  2026.10.18 (the tool printed the same advisory twice). These remain open;
  dependency upgrades were not included in the feature commits.

## Latest: backend capacity work (100 concurrent users)

- Fixed the intermittent backend failures. Root causes: one shared HTTP/2
  connection for every request thread (Supabase aborted it under upload bursts),
  approve/discard taking row locks in opposite orders (`40P01 deadlock
  detected`), a clue fallback that always returned the first clue of a tier, and
  a per-device snapshot fan-out (2 queries per phone per broadcast).
- Backend now owns an HTTP/1.1 pool (50 connections) with retries, retries
  deadlocks in `repo.rpc`, batches each broadcast into 8 queries
  (`snapshots.room_data`), and sends WebSocket payloads concurrently with a 5s
  timeout so one dead phone cannot stall the room.
- Migration `20260101000018_approval_lock_order_and_clue_rotation.sql` fixes the
  lock order and makes repeat wins of a tier rotate to the next unowned clue.
  **Applied to the hosted project on 2026-11-12.** Verified: three Tier-1 wins
  now unlock `Clue 0`, `Clue 1`, `Clue 2` (was `Clue 0` three times), and the
  deadlock probe reports zero `deadlock detected` across 12 racing cases.
- Measured after the migration: 100 concurrent uploads and 100 concurrent
  snapshot builds with zero failures; the full backend suite passes with live
  tests enabled (83 at the time of writing). Details: `docs/backend-100-users.md`.
- The hub is still in-process, so `--workers N` needs shared pub/sub first.

## Latest feature: review-result notifications

- Own new clue: themed private success modal, eight-second auto-close, early
  dismissal and View your clues. Own rejection: private modal with prominent
  host feedback, twelve-second auto-close, early dismissal and Back to board.
- Rival successes: small nonmodal side notices, six-second auto-close and manual
  dismissal. Rejections never generate public announcements. No focus stealing.
- The backend adds session-scoped public `clue_awards` metadata from actual
  team_clues rows (ID, team, tier, time only). No private clue/feedback/photo
  contents are exposed. No schema migration or reward-selection change.
- Snapshot cursors suppress old/duplicate events. Shared dialog scroll locks
  handle proof sheets closing as a result modal opens.
- Build passed; 34 backend tests, 17 Node tests, nine notification browser checks
  and 14 host regressions passed. Node cursor coverage: 100% lines/functions,
  95.24% branches. More detail: `docs/clue-notifications-verification.md`.
- Work is local/uncommitted. The updated backend must run to supply rival tier
  events. No production game mutations or deployment were performed.

## Latest addition: draw deck

- Added a stacked navy draw deck in the space beneath the flop. It stays outside
  the scrolling challenge list and above the bottom navigation.
- Replacement backs fly from the deck's measured position to their actual slot
  using a fixed viewport overlay, then flip face-up. Flight is 600ms and flip
  480ms, within the existing 1100ms reveal phase. Ordinary snapshots stay still.
- Reduced motion skips the flight/flip. Resizing or scrolling cancels a captured
  flight path so it cannot drift away from its destination.
- Chromium/WebKit replacement-coordinate and reduced-motion checks passed;
  six/ten-card iPhone layouts, sheet/upload flows and 11 unit tests passed.
  Screenshot: `frontend/artifacts/board-draw-deck-phone.png`.
- Backend/API/model/router/database behavior remains unchanged. Local only.

## Latest Board presentation: dealt flop

- After restoring the ticket cards, the user requested a flop of cards. The
  Board now lays out three portrait cards across, with patterned navy backs,
  a staggered deal/flip on host reveal and slight resting angles. It retains
  cream/ink/orange styling, vertical scrolling and tap-to-open proof sheets.
- Uses the existing useCardTable animation hook; ordinary snapshots do not
  replay the reveal. Reduced motion presents the faces immediately.
- The envelope Team Progress redesign remains cancelled. No backend, API,
  model, route or database changes were made for this presentation.
- iPhone geometry/accessibility/upload checks passed in Chromium and WebKit;
  the reveal and sheet tests also passed after fixing an inherited animation.
  Evidence: `docs/flop-board-verification.md`. Local/uncommitted.

## Latest user instruction: card layout restored

- The user stopped the Team Progress envelope redesign and requested the previous
  card layout. Board is restored to the two-column miniature host-style ticket
  grid, with vertical scrolling, compact header/menu, detail sheets and no Open
  pills. The newer Board progress strip and full-width rows were removed.
- The unfinished SVG envelope redesign and its preview/test files were removed.
  Existing player race-track Team Progress and host Progress were preserved.
- Backend, API modules, models, routes and populated clue data are unchanged.
- The row-layout notes and measurements below are historical and superseded.

## Latest mobile Board refinement

- The user ultimately selected full-width rows, superseding the intermediate
  ticket-card grid. Header 56px, team-progress strip 64px, section label 32px,
  navigation 56px, with safe-area insets and a 100dvh player viewport.
- Six rows fill 390×844 at about 106px each; at 375×667 they shrink to about
  76.5px per the user's explicit preference. Ten rows scroll vertically inside
  the board. The page and board do not scroll horizontally.
- Rows show tier + sealed envelope reward, title, description teaser, location,
  explicit status and chevron. Open badges were restored by the latest spec.
  Header shows Live text and an overflow menu. Summary opens Teams.
- Shared ClueEnvelope displays actual tier counts; no clue-pack total or media
  submission type was invented because neither exists in the player payload.
- Build passed; 11 unit tests passed; final player browser run: 38 passed,
  10 mobile-only skips on desktop/tablet, including Chromium and WebKit.
- Screenshots and limits: `docs/mobile-board-verification.md`. Changes are local
  and uncommitted; no new backend/API/type/route/database changes were made.

## Clue population completed

- The user approved population after reviewing the 24-clue pack and T3-02's Green
  addition. Supabase project `ceqfgjqwvuqhtsbmxfdn`, active Game 2 (`PSA62S`,
  `6f783270-30ed-483d-a52b-6950ae0013a8`) now has eight clues per tier.
- Read-back verified all 24 titles/bodies exactly against `clues/clues.md`.
  Host-only answers/notes were excluded and the other lobby session untouched.
- Existing challenge assignments/reward logic were preserved. Unassigned
  challenges still start at the first clue per tier; distribution of the
  complete pack across challenge rewards remains a separate follow-up.
  (Superseded in part by migration `0018`: a repeat win of a tier now rotates to
  the next clue the team does not own instead of being silently dropped.)
- Historical statements below about pending clue approval and no database writes
  describe the earlier UI pass and are superseded by this population record.

## Approved continuation completed

- Follow-up: removed clue-type names (Direction, Landmark, Precision and their
  longer variants) from player tickets, clue inventory and Help. Tier stamps remain.
- Applied Race Control to the player board, header, bottom navigation, clues,
  progress, challenge sheet, join, host login and session picker.
- Paper tickets replace felt, piles and suits. I / II / III stamps use orange
  outline, tint and fill. Challenge body text is at least 16px, the stated
  assumption for the truncated prompt approved by the user's continuation.
- Help opens a field guide; Refresh retains the existing refresh action.
- Production build and 11 unit tests passed. The 42 existing host browser checks
  passed; all 15 expanded player/entry checks passed on the final rerun across
  desktop, tablet and phone, including axe checks. Local fixtures only.
- Screenshots: `frontend/artifacts/player-*.png`, `entry-*.png`, `sessions-*.png`.
  Evidence and limits: `docs/player-race-control-verification.md`.
- Backend, API modules, models, routes, board-state hooks and clue data remain
  unchanged. Work is local and uncommitted.

## Historical state ? earlier visual pass

- The host header, navigation and Board use the Race Control visual system:
  paper `#FAF6EF`, ink navy `#14213D`, race orange `#FF6A13`, orange tint
  `#FFE8D6`, and Barlow Condensed display type.
- Host Review, Team codes, Clues and Progress were restyled to match. Team
  passes use orange ticket-like join codes. Review keeps the existing approve
  and reject requests and member removal keeps its confirmation.
- The host Clues tab is read-only and displays the preloaded session clue pack.
  It no longer offers host-authored clue creation.
- The consolidated clue draft is `clues/clues.md`; `clues/clues.draft.md` was
  removed. The draft has six clues per tier. Tier 1 clues are useful fragments
  without context; Tier 2 clues are strange interlocking riddles; Tier 3 clues
  offer stronger leads but still require decoding. New host-provided context
  (a nearby beach volleyball court, Starbucks and Area C1) is incorporated.
  The destination, answer key and source notes are host-only.
- **The clue wording is awaiting user review. Do not insert or populate these
  clues in the database until the user approves the wording.**
- No backend logic, API module, data model or route was changed for the recent
  host UI pass. The app has earlier backend and board-control work in the
  existing dirty working tree; preserve it.

## Verification completed

- `npm run build` passed (TypeScript and Vite).
- `npm test`: 11 unit tests passed.
- Board browser checks: 24 passed across desktop, tablet and phone.
- Host-view browser checks: 18 passed across desktop, tablet and phone,
  including axe checks, existing review request behavior, the read-only clue
  empty state, responsive layout and phone header overlap.
- Local fixtures were used; no production database writes were made.
- Backend Python/SQL and frontend API, types and router file hashes were
  unchanged by the Race Control visual pass.
- Screenshots are in `frontend/artifacts/`. The visual check exposed and fixed
  a mobile header overlap. No committed visual baseline exists.

## Next task

Map work is complete locally and schema/defaults are live. Verify on an actual
HTTPS phone game when available. Do not configure the existing active game or
create hosted scratch games without authorization. Preserve all prior changes;
do not commit, push or deploy without authorization. See map verification doc
for final tests and limitations.

## User prompt

### Task

The host header and tabs now follow the new "Race Control" design system
(paper background, ink navy, race orange, ticket-style room code,
departure-board display font). The rest of the app does not. Apply the SAME
design system, using the existing CSS tokens, to every remaining screen. Do
not change backend logic, API calls, data models or routes.

### Problems found

**Player view (inconsistent, highest priority)**

1. The Board screen uses a dark green "card table" theme with playing-card
   suits. It does not match the host app. Remove the green felt, the draw pile /
   discard pile and the suit symbols. Keep the useful idea (a clue as a physical
   card) but restyle each challenge as a paper clue ticket on the cream
   background: ticket notches, a dashed tear line, and a bold tier stamp
   (I / II / III) in the corner. Tier is shown by stamp number and orange
   intensity (outline, tint, solid fill), not by suit colour.
2. The player header (Game 2 / Team 1 / Live connection / ? / Leave) is plain
   white and does not match the host header. Give it a compact version of the
   same header: navy bar, game name in the display font, orange live indicator.
   Make "Leave" a clear secondary button, and the "?" a proper labelled help
   button.
3. Bottom nav ("The board / Your clues / Teams") is a pale green pill. Restyle
   it: ink navy icons and labels, orange active indicator, 56px high, real icons
   from the same line-icon set, with a count badge for "Your clues".
4. Team Progress (player) still uses the old style: indigo "(you)" highlight,
   purple person icons, yellow key emoji. Replace it with a race-track view:
   each team is a row with a progress line and a marker showing how many clues
   they have. The player's own team is highlighted with a pale orange tint and
   an orange "YOU" stamp. No emoji.
5. Text on the cards is small and low-contrast ("Anywhere", the description,
   "View challenge"). Raise the body size to at

