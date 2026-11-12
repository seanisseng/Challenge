# Scavenger Hunt App — Handoff

Updated 2026-11-12

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
  challenges still default to the first clue per tier; distribution of the
  complete pack across challenge rewards remains a separate follow-up.
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

## Current state

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

Review the completed visual pass with the user and make any requested tweaks.
The clue wording still requires explicit approval before database population.
The historical prompt below ends mid-sentence. The user approved continuing with
the supplied scope and the stated 16px body-text assumption; do not invent further
requirements from the missing text.

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

