# Queue drag ordering and no-repeat removals — 2026-11-11

Source: the user requested host drag-and-drop queue configuration and that cards
removed with × never repeat in the same session. This supersedes the previous
move-to-bottom behavior.

## Delivered guarantees

- Mouse/touch drag grips preview a reordered queue; one save occurs on a valid
  drop. Arrow buttons and arrow keys also reorder. Escape, pointer cancellation,
  dropping outside the list, or a changed server queue cancels the drag.
- Reorder requests submit the full queue and the expected original order.
  The database rejects missing, duplicate, foreign, live or discarded IDs and
  stale orders. Admin queue actions are serialized per session.
- × permanently flags a challenge as discarded within its session, preserving
  challenge and proof history. Eligible-only refill, queue filters, submission
  guard and a database constraint prevent removed cards from returning.
  The legacy defer endpoint has the same permanent-removal semantics.
- Live removal rejects both teams' pending proofs and draws the next eligible
  challenge. Exhausting the pool leaves an empty board; hide/reveal and refill
  cannot resurrect removed cards. New sessions still start with 29 fresh cards.

## Evidence

RED: four API tests failed on missing routes. The live board tests failed on
missing reorder/removal behavior. Queue helper stubs failed two ordering tests.
GREEN: targeted live/control tests passed after implementation; the final full
suite passed with additional invalid-order, idempotency and session-scope checks.

```powershell
# backend/
$env:CHALLENGE_LIVE_TESTS='1'
.\.venv\Scripts\python.exe -m pytest -o addopts= -q -p no:cacheprovider
# frontend/
node --test --experimental-test-coverage --test-coverage-include=src/lib/queueOrder.ts tests/*.test.ts
npm run build
```

Actual results: **67 backend tests passed** (5 dependency warnings, 20.91s),
**11 frontend tests passed**, TypeScript and production build passed (47 modules).
Node reported **100% lines/branches/functions for `queueOrder.ts` only**; this
does not measure drag pointer handlers, React or CSS.

The stale-order test initially timed out when application conflicts used
SQLSTATE `40001`. Migration 0017 uses `PT409`, the explicit HTTP-status form
documented in [PostgREST custom errors](https://docs.postgrest.org/en/v14/references/errors.html#custom-errors).
The same live test then passed in the targeted 14-test run (10.34s).

Migrations 0016 and 0017 were applied through Supabase MCP. Grant checks confirmed
anon cannot reorder, authenticated cannot discard, and service_role can reorder.
Live tests used temporary sessions, which were removed afterward; disposable
proof files were cleaned separately.

Browser/native access hosts remain unavailable, so no browser touch-drag,
auto-scroll, focus-retention or visual result is claimed. Follow up on a phone
and desktop: drag to either end, cancel, scroll, save conflict, keyboard reorder,
and × the last remaining eligible card. No checkpoint commits were created;
the code and RED/GREEN evidence remain in the working tree.

## Self-evaluation

| Axis | Score | Evidence / improvement |
|---|---|---|
| Accuracy | 4/5 | Live no-repeat and persisted-order tests pass; browser pointer behavior remains unverified. |
| Completeness | 4/5 | Drag, keyboard alternatives, stale-save protection and session-local removal delivered; run interaction QA. |
| Clarity | 4/5 | UI explicitly says removed cards will not return; drag instructions need a real-phone check. |
| Actionability | 4/5 | Migrations and code are ready; browser connection is needed for final interaction verification. |
| Conciseness | 4/5 | No drag dependency added; custom pointer handling has ongoing maintenance cost. |

Overall **4.0/5**. No known critical issues. Highest-value follow-up: real browser
drag/cancel/auto-scroll verification. Would the user agree? Likely, with the
interaction-testing limit clearly stated.
