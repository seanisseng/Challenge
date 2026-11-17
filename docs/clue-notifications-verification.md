# Private review dialogs and public clue notices — 2026-11-12

**Updated 2026-11-16:** success is restored to 8 seconds; rejection remains 8 seconds.
Desktop/phone clock-controlled browser checks verify the new durations. Rival
notices are unchanged.

The user requested a celebration when a team acquires a clue, quiet rival-team
announcements, and a private rejection dialog with highlighted host feedback.

## Implemented behavior

- Actual new private clue IDs trigger a themed “Clue unlocked!” modal. It shows
  the tier and private clue, offers View your clues, and closes after eight
  seconds or earlier using Close/Escape/the backdrop.
- Newly rejected private submission IDs trigger “Submission rejected,” with the
  host's review note prominently highlighted. Missing notes are explicitly
  identified. It closes after eight seconds or earlier, and offers Back to board.
- Own review outcomes queue rather than mounting multiple competing dialogs.
  The underlying proof sheet closes; shared scroll locking prevents body-scroll
  leaks when native dialogs briefly overlap during the same snapshot update.
- Rival awards appear at the side without a backdrop or focus change. They say
  only “Team … acquired a Tier … clue.” They expire after six seconds, allow
  manual dismissal, and pause while hovered/focused. At most two are visible;
  further awards wait in order. The live region is polite.
- Initial joins, reload baselines, repeated snapshots and reconnect replays do
  not repeat known notifications. Successes use actual unlocks, not photo uploads
  or inferred progress-count changes. Existing reward-selection rules are unchanged.

## Data and privacy

The player snapshot gains an optional `clue_awards` array. The existing
`team_clues` table supplies an award ID, team ID/name, tier and timestamp, limited
to the session's 50 latest unlocks. No clue title/body/media, photos, rejection
notes or member identity enters this public feed. Rejections remain in the
existing team-private `my_submissions` payload. No new endpoint, schema migration,
reward logic, seed data or production write was needed.

The new read-only PostgREST join was validated against the existing game session;
only its returned count and public field names were printed. The backend update
must run alongside the frontend for rival tier announcements. Own success and
rejection dialogs remain compatible with older snapshots lacking the public feed.

## Verification

- Backend RED: the new query function and payload field were initially missing.
  GREEN: 34 isolated pytest checks passed across award privacy, snapshots, board
  controls, images and WebSocket fan-out. No live mutation tests ran.
- Frontend RED: event-cursor module and success modal were initially missing.
  GREEN: 17 Node unit tests passed. The new cursor module has 100% line/function
  coverage and 95.24% branch coverage under Node's test coverage reporter.
- Nine final notification browser checks passed across desktop Chromium, mobile
  Chromium and mobile WebKit: manual/automatic dismissal, duplicate suppression,
  feedback fallback, private rejection, focus preservation, axe and overlapping
  proof-sheet cleanup. An initial WebKit fixture race was fixed by waiting for
  the initial Live snapshot before simulating a rejection.
- Existing player proof/Help/Leave and detail-sheet checks passed across those
  engines. Fourteen host Board/tab regression checks also passed.
- `npm run build` and `git diff --check` passed.
- Screenshots: `clue-success-*.png`, `submission-rejected-*.png`, and
  `rival-clue-notice-*.png` in `frontend/artifacts/`.
- No production approvals, rejections or database changes; no commit/push/deploy.
  Physical-device camera/network testing remains outside these fixture checks.

## Self-evaluation

| Axis | Score | Evidence / remaining improvement |
| --- | --- | --- |
| Accuracy | 4 | Public query validated live read-only; actual notification flow exercised with fixtures rather than a live approval. |
| Completeness | 4 | Both private outcome dialogs and public success notices are covered; deployment was not requested. |
| Clarity | 4 | Timings, privacy boundary and backend compatibility documented; queued catch-up messages have no separate history screen. |
| Actionability | 4 | Code and previews are reviewable; the updated backend must be running for public tier events. |
| Conciseness | 4 | Reuses the dialog and tier components; adds a shared lock to correctly handle overlapping modal cleanup. |

Overall: 4.0/5. A real multi-device approval/rejection check after deployment is
the next useful verification. The score reflects the tested local scope.
