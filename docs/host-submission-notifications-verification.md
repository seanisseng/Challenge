# Host submission notifications and player modal timing — 2026-11-15

New pending proofs produce a small host corner notification showing the team
and challenge. **Open submission** switches to Review, selects that exact proof,
and focuses its workspace. The host can dismiss a notice without opening it.
Multiple arrivals queue one at a time; notices persist until opened/dismissed or
the proof is reviewed elsewhere. Initial history and repeated snapshots remain
quiet; switching sessions creates a new baseline. No backdrop or focus change
occurs when a notice arrives. Notifications are hidden on Review; entering Review
clears queued notices. Incoming proofs there are marked seen, preventing delayed
popups when the host leaves Review. This uses existing admin WebSocket snapshots and
approval/rejection endpoints; no backend or database change was needed.

Updated 2026-11-16: player success modals are restored to 8 seconds; rejection
modals remain at 8 seconds. Their explanatory text matches. Early dismissal remains supported.
Rival-team notification code is unchanged; the user requested no additional
rival-specific browser check.

## Evidence

Journeys were derived directly from the user's requests.

- RED: the new host browser test failed because the notification was absent.
  The modal test failed because success still displayed an eight-second duration.
- GREEN: 18 host-view checks passed across desktop and phone. They cover new
  arrivals without focus theft, exact-proof navigation and focus, duplicate
  suppression, queued arrivals, dismissal, removal after external review and
  session baseline reset. Existing review actions and member confirmation also
  pass. Host catalog checks render all 24 source clues, eight per tier.
- Four player timing cases passed across desktop and phone: success remains
  visible at 2.9 seconds and closes by 3.1; rejection remains visible at 7.9
  seconds and closes by 8.1. Existing early-dismiss and duplicate suppression
  assertions pass. Those four cases ran alongside the host tests; the first
  mixed run had two host-fixture locator failures, corrected before the final
  18-case host run passed.
- `npm run build`: passed TypeScript and Vite compilation.
- `npm test`: 17 unit tests passed.
- `git diff --check`: passed.
- The running local backend was checked through read-only HTTP requests:
  `/health` succeeds, the authenticated catalog returns 24 clues, and OpenAPI
  exposes GET but no POST for session clue listing.

Commands run from `frontend/`:

```powershell
npx playwright test tests/e2e/host-views.spec.ts --project=desktop --project=phone
npx playwright test tests/e2e/host-views.spec.ts tests/e2e/player-views.spec.ts --project=desktop --project=phone --grep 'new host submissions|host submission notices|new clues celebrate|rejections privately'
npm run build
npm test
```

Browser tests use local seeded fixtures. Catalog rendering uses the player-facing
Markdown source; the running backend's actual catalog was separately checked by
HTTP. They do not upload photos, approve proofs or mutate the hosted game.
Axe checks passed on the notification screen and existing host views. Phone
notification and catalog screenshots were visually inspected; no visual baseline
comparison or full manual accessibility audit was performed. Coverage percentage
was not measured.

Artifacts: `frontend/artifacts/host-submission-notice-{desktop,phone}.png`,
`global-clue-catalog-{desktop,phone}.png`, and updated success/rejection screenshots.

The local backend and frontend were started on ports 8000 and 5173. The handoff
in `resume.md` now reflects the permanent catalog, current timers and host popup.
No application deployment, commit or push was performed.

## Self-evaluation

| Criterion | Score | Evidence / improvement |
|---|---|---|
| Accuracy | 4/5 | Clock-controlled browser checks and actual backend reads pass; notification delivery was simulated rather than driven by a hosted upload. |
| Completeness | 5/5 | Both requested timers and actionable host notification are implemented, including queued and stale events. |
| Clarity | 5/5 | Popup identifies the proof and offers one explicit opening action. |
| Actionability | 5/5 | Open submission selects and focuses the specific pending proof. |
| Conciseness | 4/5 | A dedicated component keeps notification state separate; fixtures add necessary cross-view regression coverage. |

Overall: 4.6/5. A future real-upload test could cover the complete transport path.
The remaining limitation is documented rather than presented as a passing test.


## Review-page suppression follow-up

Notifications are hidden whenever the host is on Review. Entering Review clears
queued notices; submissions arriving there are marked seen and never replay as
popups after leaving. New arrivals on other tabs still notify normally.

The new regression failed before implementation because the popup remained on
Review. After implementation, six focused browser cases passed on desktop and
phone, including exact-proof navigation, queue behavior and suppression across
tab switches. The suppression fixture explicitly waits for its initial HTTP
snapshot to avoid racing startup with its simulated new submission. TypeScript
and `git diff --check` passed. No hosted data was changed.
