# Claimed tasks and team location visibility

Approving a submission claims that task atomically, rejects every other pending
submission for the same task, records each rejection in `submission_events`,
and assigns the reason **Another team has claimed this task.** Other tasks in
the same clue tier remain available. Previously rejected proofs keep their
historical status/feedback. The losing teams' existing private rejection modal
shows the reason and a TASK CLAIMED stamp, with no suggestion to retry that task.

Host Map now has **Team location visibility** checkboxes for every team,
including teams with no current GPS fix. Unchecking a team hides all its devices
from other players' REST snapshots and WebSocket updates. The host and the hidden
team itself can still see its shared locations. A hidden team's sharing consent
is unchanged. Hidden status persists across reconnects, page reloads and device
changes until the host checks the team again.

This is a manual visibility control, not a winner/arrival system. There is no
winner announcement, automatic arrival detection, or automatic game ending.
Other teams can continue until they reach the final destination.

Visibility changes, initial WebSocket snapshots and GPS fan-out share a room
lock. Every policy change increments a persisted revision. Client snapshot
merging and event handling reject older policy revisions, preventing delayed
pre-hide GPS fixes or stale snapshots from restoring hidden coordinates. No
hidden-team list is sent to players. A failed visibility read withholds GPS
events and reconnects clients rather than exposing coordinates.

Migration `20260101000027_team_visibility_and_claim_rejections.sql` was applied
to Supabase on 2026-11-18 as hosted version `20261118075112`. It adds the private
visibility fields and service-role-only RPC and replaces `approve_submission`.
The REST schema cache was refreshed. Read-only verification confirmed that the
new RPC is exposed and the active host board still loads all six tasks.

Validation: 173 backend tests passed (three hosted/live tests skipped), 35
frontend unit tests passed, production build/type checking passed, and nine
focused browser checks passed on desktop, touch Chromium and iPhone WebKit.
Checks include competing SQL approvals, per-team visibility persistence and
authorization, player redaction, stale GPS rejection, host hide/show controls,
and the competing-claim rejection modal. A small follow-up test covers visibility
revisions on sharing-access revocation after the full-suite run.

Deployment still needs the updated frontend and API code; applying the database
migration and pushing Git commits do not restart an externally hosted API. Run
one API instance using `python -m app.server` until shared broadcasting is added.

## Remaining gaps

- Ending a game does not prevent later review approvals/rewards. Define whether
  pending submissions should be settled before closing, or remain reviewable.
- Claiming another task in an exhausted clue tier can award no new clue. The
  task UI does not yet explain that condition.
- Shared immediate broadcasting across multiple API instances is not implemented.
- Attachment retention/storage cleanup is not scheduled; stored videos can fill
  the project's storage allocation.
- Public deployment/CI, rate limiting on PIN login and join/upload endpoints,
  and dependency updates still need attention before a public launch.

Pre-commit dependency audits: npm reported 13 findings (11 high, two moderate)
in the build/development dependency tree, with zero production-tree findings.
Python's installed environment audit reported three entries across certifi
2026.7.22 and opentelemetry-api 1.45.1 (including duplicate certifi advisory
entries). These existing dependency findings were not silently changed as part
of gameplay changes; some frontend fixes require major Vite/Tailwind upgrades.
Full-sized real phone uploads through the eventual deployment still need a
device rehearsal in addition to generated-codec and browser-fixture tests.
