# Prepopulated board controls — 2026-11-11

Source: the user's request to replace challenge entry with a prepared board,
Reveal Board / Hide Board, an upcoming queue and × controls for both lists.
The user confirmed that moving a live challenge should reject pending proofs.

## Acceptance evidence

| Journey | Test / verification | Result |
|---|---|---|
| New game starts with 29 challenges, six ready and 23 queued | `test_board_live.py::test_prepopulated_board_visibility_and_queue` | PASS |
| Admin sees preview and queue; hidden board and queue never reach team payloads | `test_board_controls.py`, live acceptance | PASS |
| Reveal starts the game; hide and re-reveal preserve board state | Live acceptance through HTTP API | PASS |
| × on a queued task changes queue order | Live acceptance through HTTP API | PASS |
| × on a live task refills its slot and rejects both teams' pending proofs | Live acceptance through HTTP API | PASS |
| Cancelled proof cannot be approved; hidden/moved tasks reject submissions | Live API + database RPC acceptance | PASS |
| Wrong-session moves and reveal after game end fail | Live acceptance through HTTP API | PASS |
| Controls require admin tokens and broadcast snapshots | `test_board_controls.py`, API surface checks | PASS |
| Existing join, submit, claim, clue unlock and rejection flow works | `test_live_flow.py` | PASS |
| Frontend types and bundle compile | `npm run build` | PASS |

RED: eight new backend tests failed on missing controls and missing visibility
fields. The live test created an isolated game and failed because its challenge
pool was empty. That temporary game was removed. GREEN: the same tests passed
after migration 0014 and implementation.

Final command from `backend/`:

```powershell
$env:CHALLENGE_LIVE_TESTS='1'
.\.venv\Scripts\python.exe -m pytest -o addopts= -q -p no:cacheprovider
```

Actual result: **62 passed**, 5 dependency warnings, 17.38 seconds.
Frontend: TypeScript passed; Vite built 42 modules in 3.78 seconds.

Migration 0014 was applied via Supabase MCP. Existing rooms `95Q2X3` and
`PSA62S` each have 29 challenges, six in the hidden preview, and remain in the
lobby. Temporary live-test games were deleted. Their disposable proof objects
were cleaned up separately.

No browser interaction check was possible: both browser and native access hosts
were unavailable. This leaves visual layout, button interaction and reconnect
rendering unverified in a browser. No coverage percentage is claimed; coverage
tooling is not installed. No checkpoint commits were created; code and this
RED/GREEN evidence remain in the working tree.

## Self-evaluation

| Axis | Score | Evidence / improvement |
|---|---|---|
| Accuracy | 4/5 | Database/API lifecycle and existing game flow pass; add browser checks. |
| Completeness | 4/5 | All requested controls and prepopulation delivered; UI automation remains. |
| Clarity | 4/5 | Controls explain visibility and pending-proof cancellation; browser readability needs review. |
| Actionability | 4/5 | Existing and new rooms are prepared; browser access is needed for visual confirmation. |
| Conciseness | 4/5 | Dedicated Board component replaces manual challenge entry; some legacy API remains for compatibility. |

Overall: **4.0/5**; no critical issues. Highest-value follow-up is a browser
click-through at phone and desktop sizes. Would the user agree? Likely, since
the requested behavior is live and the browser-verification gap is explicit.
