# Race Paper host UI and clue draft review

Date: 2026-11-11

## Scope

Host Board, Review, Team codes, Clues and Progress share the paper / ink / orange
system. Review retains the existing photo and decision requests; Team codes
retains clipboard sharing and the member-removal confirmation. Clues displays
the database pack without a creation form. No clue pack has been populated.

The consolidated `clues/clues.md` review draft contains six clues per tier.
Host-supplied volleyball, Starbucks and C1 facts now inform fragments, riddles,
stronger leads and the host-only answer key. Wording approval is still pending.

## Verification evidence

- `npm run build`: passed TypeScript and Vite production build.
- `npm test`: 11 passed, covering card reveal/replacement and queue ordering.
- Board Playwright cases: 24 passed across desktop, tablet and phone.
- Host-view Playwright cases: 18 passed across desktop, tablet and phone. They
  cover responsive layout, axe checks, existing approval
  request with its note, typing protection for shortcuts, read-only empty clue
  pack, and cancellation of the existing member-removal confirmation.
- Added a geometric check for overlap between header identity and room ticket
  after visual inspection exposed a compressed phone header.
- Primary action, Tier 3 stamp and live-indicator colour pairings measured
  5.57:1 in Board browser checks.
- Backend Python, SQL, frontend API module, types and router hashes match the
  baseline captured before this visual pass.
- Screenshots use local fixtures, including a challenge reference image as
  stand-in proof; no real submissions or database writes were used.

Automated axe results do not establish full WCAG conformance. There is no
committed visual baseline, so visual regression comparison is inconclusive.
Live database integration, screen-reader testing and outdoor device legibility
were not assessed by these local checks. Riddle difficulty still needs a human
playtest without prior knowledge of the destination.

## Self-evaluation

| Axis | Score | Evidence and next improvement |
|---|---|---|
| Accuracy | 4/5 | Supplied destination facts are retained; nearby outlet/court are host observations. Confirm these on site before play. |
| Completeness | 4/5 | Host tabs and all 18 clues covered; this pass does not finish a separate player-screen redesign. |
| Clarity | 4/5 | Player bodies and host decoding notes are separated; playtest whether the siren metaphor is understood. |
| Actionability | 4/5 | One review draft and local screenshots are available; clue wording needs approval before population. |
| Conciseness | 4/5 | Short clue bodies keep the player copy compact; the host notes are intentionally more extensive. |

Overall: 4.0/5. The user should find the draft reviewable, while the difficulty
and physical landmark assumptions remain explicit rather than claimed proven.
Highest-impact follow-ups: blind-playtest clue combinations, confirm landmarks
on site, then review the remaining player screens separately.
