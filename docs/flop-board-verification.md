# Dealt-card Board — 2026-11-12

## Draw-deck follow-up

The user requested a visible source for replacement cards. A stacked draw deck
now occupies the lower empty space, outside the vertically scrolling hand.
Animated card backs use a fixed viewport portal so the list cannot clip the
flight. Coordinates are measured from the actual deck and destination slot.
The flight takes 600ms, followed by a 480ms flip, fitting the existing 1100ms
reveal phase. No reward, queue, API or backend logic changed.

The replacement test first failed on the missing deck. Its final Chromium and
WebKit runs both passed, verifying the source/target offsets, ordinary snapshots
and reduced-motion replacement. Initial cross-browser test failures were caused
by querying a short-lived flight across several protocol calls and by changing
motion preference immediately before replacement. The test now starts with the
intended preference and captures the geometry in one browser frame. The deck's
small lift animates its face rather than the measured source wrapper.

Fourteen other targeted checks passed across the same mobile engines: reveal,
six/ten-card layouts at both requested sizes, axe, photo upload, Help/Leave and
detail sheet interactions. Eleven unit tests passed. Screenshots:
`frontend/artifacts/board-draw-deck-{phone,iphone-webkit}.png`.

The follow-up self-evaluation remains 4/5 on each axis: measured path and browser
checks support accuracy; the requested deck and reduced-motion behavior cover
scope; comments explain the overlay and timing; local code/artifacts are ready
for review; reuse of CardBack and the existing animation hook limits duplication.
Physical iPhone testing remains the main verification gap.

The user stopped the Team Progress redesign, restored the Board's ticket cards,
then requested a “flop of cards.” The current design uses three cards across,
navy patterned card backs, a staggered deal and flip on reveal, and small resting
angles. It keeps the existing paper/ink/orange system and vertical scrolling.

The existing `useCardTable` hook controls reveal/replacement phases. Stable live
snapshots do not replay the deal. Reduced motion settles faces immediately.
The full challenge and photo submission remain in the detail sheet. Open pills
remain omitted, following the restored card layout.

## Verification

- New reveal test first failed because the previous grid had no dealing phase.
- Chromium and WebKit each passed six/ten-card layouts at 390×844 and 375×667,
  horizontal-overflow checks, axe checks and photo/Help/Leave interactions.
- The rotated face initially added 2px of horizontal overflow. Clipping its
  decorative notch overflow fixed this while preserving vertical scrolling.
- The inherited host `ticket-arrival` animation conflicted with settled cards.
  The player card now suppresses it and uses only its own reveal animation.
- Final targeted rerun: four reveal and detail-sheet tests passed across both
  mobile engines, including reduced motion, ordinary live snapshots, browser
  Back, drag dismissal, focus return and map-search links.
- Final production build passed after the inherited-animation correction.
- No backend/API/type/router files changed. No database writes, commits or
  pushes occurred. Other existing uncommitted work was preserved.

The layout checks cover browser emulation, not physical iPhone camera behavior.
Screenshots are `frontend/artifacts/compact-board-{390x844,375x667}-{6,10}.png`
and corresponding `-webkit.png` files. Intermediate row/grid reports are historical.

## Self-evaluation

| Axis | Score | Evidence / improvement |
| --- | --- | --- |
| Accuracy | 4 | Browser checks verify reveals and stable updates; no physical iPhone test. |
| Completeness | 4 | Requested flop styling is implemented; user has not yet reviewed its appearance. |
| Clarity | 4 | Final presentation and unchanged behavior are explicit; historical artifacts remain in the workspace. |
| Actionability | 4 | Local code and screenshots are ready to review; deployment was not requested. |
| Conciseness | 4 | Existing animation hook reused; some older card CSS remains for shared styling. |

Overall: 4.0/5. The useful next check is user visual review on their phone; the
assessment should be consistent with the local scope and verification above.
