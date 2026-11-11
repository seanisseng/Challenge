# Scavenger Hunt App — Handoff

Updated 2026-11-11

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

Continue the visual redesign across the remaining app screens. Start with the
player experience, which still uses the old green card-table theme. Preserve
backend logic, API calls, data models and routes. Follow the user's full prompt
below. **The source prompt in this handoff ends mid-sentence; ask the user for
the missing remainder before deciding any requirements beyond the supplied
text.**

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

