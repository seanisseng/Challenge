# Mobile player board — 2026-11-12

**Historical verification:** the user subsequently requested restoration of the
two-column ticket-card Board. The row design described below is superseded.

The final user specification supersedes the intermediate card-grid designs:
full-width challenge rows fill the available viewport, with a compact header,
a team progress strip, explicit statuses, description teasers and clue rewards.
The user chose shorter rows on iPhone SE so all six remain visible.

## Measured layout

At 390×844 before this pass: header 168.3px; hero content 93.3px plus 36px of
margins; first card 290px; navigation 57px. About 473px remained visible for cards
after the top spacing.

The completed layout has a 56px header, 64px team strip, 32px section label and
56px navigation, plus actual safe-area insets. With six challenges:

| Viewport | Row height | Result without additional safe-area insets |
| --- | --- | --- |
| 390×844 | approximately 106px | All six visible; list ends at navigation |
| 375×667 | approximately 76.5px | All six visible; short-screen titles use one line |

Rows otherwise clamp between 88px and 120px. The six-row short-screen exception
permits 72px. Ten challenges scroll vertically inside the list; header, team
strip, section label, filters and navigation remain outside that scroller.
Horizontal overflow and horizontal scrolling are explicitly tested.

`ClueEnvelope` is shared by row rewards, the progress strip and the player's own
team inventory. The strip opens Teams. Open, Submitted, Approved and Rejected
have text, different symbols and different border shapes. Tier captions are
11px as explicitly requested; row titles are at least 17px, other row text 14px.

## Data boundaries

- Description and status are available and displayed. Submission status refers
  to the player's own proof; a rival pending submission does not close the task.
- Photo/video/screenshot type is not supplied by the current challenge payload.
  No submission type is inferred from wording.
- The player payload has no total clue-pack count or per-tier remaining counts.
  The summary shows the actual number opened, without inventing an “of 6” total.
  Sealed/opened envelopes summarize each tier, with actual opened counts.
- Existing reference images remain in the detail sheet. The location preview is
  an area-search link with a decorative map motif, not a geographic map tile or
  an invented exact pin. No new map API is called.
- Backend, API modules, types, route definitions and database data were untouched.

## Verification

- `npm run build`: passed, including TypeScript and Vite.
- `npm test`: 11 existing unit tests passed.
- `npx playwright test player-views.spec.ts`: **38 passed, 10 skipped**. The skips
  are mobile-only geometry checks excluded from desktop/tablet projects.
- Browsers: Chromium desktop/tablet/phone and mobile WebKit. A local WebKit
  browser was installed for this verification; no physical iPhone was used.
- Axe checks cover board, clues, Teams, Help, challenge details and entry screens.
- Interaction checks cover filters, summary-to-Teams, multipart proof submission,
  cancelled Leave, live snapshots, modal Back/close/drag, focus return, reduced
  motion and safe-area/viewport resizing. The gesture test waits for the opening
  animation before obtaining drag coordinates.
- Safe-area tests simulate 47px top and 34px bottom. If a smaller available
  viewport cannot hold the minimum rows, the list scrolls and chrome stays fixed.
- The new layout test first failed on the missing row/progress implementation.
  Accessibility testing then identified missing semantic roles on envelope
  graphics; those were fixed before the successful final run.
- Local fixtures only; no live uploads, remote writes, commits or pushes.

Screenshots: `frontend/artifacts/compact-board-{390x844,375x667}-{6,10}.png`.
Matching `-webkit.png` files and sheet screenshots are also available.

## Self-evaluation

| Axis | Score | Evidence / improvement |
| --- | --- | --- |
| Accuracy | 4 | Production build and both browser engines pass; native iPhone hardware remains untested. |
| Completeness | 4 | Final requested layout and four screenshots supplied; map tiles and clue totals cannot be supplied from current data. |
| Clarity | 4 | Explicit field limitations and final sizing; tier captions deliberately follow the specific 11px instruction. |
| Actionability | 4 | Local changes and artifacts are reviewable; deployment was not requested. |
| Conciseness | 4 | Superseded grid CSS was replaced; existing CardTable filename remains for import compatibility. |

Overall: **4.0/5**. A physical iPhone pass and real camera upload are the most useful
follow-ups. The evidence should support the user's assessment of the local work.
