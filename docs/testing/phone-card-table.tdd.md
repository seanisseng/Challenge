# Phone card table — 2026-11-11

Source: the user's request for a phone-first poker-style board that flips on host
reveal, discards removed challenges and draws replacements from the deck.

## Delivered behavior

- Two cards per row on phones, three on wider screens, on a felt-style table.
  Card fronts show the clue tier, challenge title, area and a rule preview.
- Host reveal deals face-down cards from the draw pile, then flips them face-up
  with a short stagger. Connected phone users return to the Board view for a new
  reveal. Ordinary snapshots update card details without replaying the deal.
- Claimed or deferred card IDs leave toward the discard pile. Their replacements
  wait until the departing cards finish, then draw into the vacant positions.
  Remaining cards keep their positions. Rapid updates use the latest board.
- Tapping a face-up card opens a native modal sheet with complete rules,
  reference photo, review feedback and a photo-proof action. The sheet closes
  when its challenge leaves the board or the board is hidden.
- Phone navigation separates Board, Clues and Teams. Reduced-motion preferences
  apply board changes immediately. Hiding clears card details immediately.

## Tests and actual results

`frontend/tests/cardTable.test.ts` was written first. With stub transition
functions, seven tests failed and one passed. After implementation all eight
passed. Cases cover reveal and settling, ordinary snapshot updates, discard
before draw, rapid replacement changes, hide cancellation, missed hide/reveal
cycles, reduced motion, and a card returning before its discard completes.

```powershell
# frontend/
node --test --experimental-test-coverage --test-coverage-include=src/lib/cardTable.ts tests/cardTable.test.ts
npm run build
```

Result: **8 tests passed**. Node reported **100% lines, branches and functions
for `cardTable.ts` only**. This does not measure the React components, hook or CSS.
TypeScript and Vite build passed (45 modules).

The live board test initially failed because snapshots lacked a reveal identity.
Migration 0015 adds `board_reveal_version`, increasing it only on hidden-to-visible
transitions. Repeated reveal requests leave the version unchanged. The updated
live test passed with versions 1 and 2 across a hide/reveal cycle.

```powershell
# backend/
$env:CHALLENGE_LIVE_TESTS='1'
.\.venv\Scripts\python.exe -m pytest -o addopts= -q -p no:cacheprovider
```

Result: **62 passed**, 5 dependency warnings, 16.81 seconds. Both live tests used
temporary games; their session data and disposable proof files were removed.
Migration 0015 was applied to Supabase through MCP. Existing game visibility was
preserved. The reveal identity reaches clients through the shared snapshot.

## Limits and follow-up

The computer/browser access host is unavailable. No visual animation, native
dialog, touch upload or viewport interaction result is claimed. Follow up on
320/390/430-pixel phones: reveal, claim, defer, rapid changes, long rules,
reference photos, upload failure, Escape/backdrop dismissal and reduced motion.
The node tests prove animation state transitions, not visual rendering.
No checkpoint commits were made; source and RED/GREEN evidence remain local.

## Self-evaluation

| Axis | Score | Evidence / improvement |
|---|---|---|
| Accuracy | 4/5 | State transitions and live reveal identities pass; visual CSS/browser behavior remains unverified. |
| Completeness | 4/5 | Phone board, flop, discard/draw, readable sheet and reduced motion implemented; run phone interaction QA. |
| Clarity | 4/5 | Full rules and feedback are in a dedicated sheet; confirm preview readability on a real phone. |
| Actionability | 4/5 | Migration is live and tests/build pass; a browser connection is needed for final visual verification. |
| Conciseness | 4/5 | No animation dependency or bitmap assets; custom CSS and a small state model require maintenance. |

Overall **4.0/5**; no known critical issues. Highest-value improvement: browser
verification of the card animations and photo sheet. Would the user agree?
Likely, provided the missing visual check is clearly disclosed.
