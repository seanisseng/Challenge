# Shared team access and team-controlled names — 2026-11-16

The app now treats each team as one shared pool. Players enter only their team
code; repeated joins return the same team credential and existing clues,
submissions and progress. No human name is requested. The UI no longer presents
individual rosters, recovery controls or inaccurate player counts. Historical
member records and existing tokens are preserved for compatibility and audit
history; new joins reuse one internal access row per team.

A transient startup/network failure preserves saved access and presents Retry.
Only a confirmed invalid token clears it. Returning on a device with cleared
storage simply requires the team code again. The discarded individual recovery
feature was never applied; no recovery table or endpoint remains.

Any joined teammate can use **Game menu > Change team name**. The server derives
the editable team from the credential, ignoring any client-supplied team ID.
Names are trimmed, limited to 40 characters, and unique within the game ignoring
case. The team code, shared access row/token, clues and progress do not change.
Renames broadcast to the host and teammate devices. Cached WebSocket member
records now use the fresh progress team's name rather than an old cached name.

## Database rollout

Both migrations were applied through Supabase MCP with user authorization:

| Local migration | Hosted version | Name |
|---|---|---|
| `20260101000021_team_pool_access.sql` | `20261116054423` | `team_pool_access` |
| `20260101000022_team_names.sql` | `20261116055049` | `team_names` |

The join RPC retains its optional legacy name argument for old clients but
ignores it. New API requests contain only `{code}`. PostgreSQL session locking
ensures simultaneous devices reuse one access identity. Rename uses the same
session lock and a case-insensitive name index. RPC execution remains limited
to the backend service role; the FastAPI team endpoint enforces team ownership.

## Verification

- RED: code-only join failed against the old required-name RPC. Rename tests
  failed because its RPC/API were missing and cached player headers stayed old.
  Startup-retry browser test reproduced deletion of the saved login on 503.
- Final full backend suite: **103 passed, 3 hosted tests skipped**. New PostgreSQL
  cases cover repeated/concurrent joins, one pool identity, cross-team isolation,
  legacy compatibility, retained earned clues, blank/long/duplicate names and
  denied direct client-role RPC access. API tests reject unauthenticated renames
  and derive the target from credentials. Snapshot regression covers stale names.
- Desktop/phone browser checks: eight shared-access/rename cases passed, including
  two devices seeing a rename, duplicate-name errors, no name field, cleared
  storage rejoin, page-close restoration and temporary network failure retry.
  The 20 existing host-view cases also passed after roster controls were removed.
  Additional entry-screen axe checks passed. One old test expected the removed
  personal-name label; its expectation was updated to the team-only label.
- Rename dialog axe/screenshot checks wait for the enabled Save button's opacity
  transition before measuring contrast; the first desktop audit caught an
  intermediate transition state. No contrast rule was disabled.
- `npm test`: **17 passed**. `npm run build`: passed TypeScript and Vite.
  `git diff --check`: passed. Coverage percentage was not measured.

## Hosted scratch-game evidence

Automatic review initially rejected creation of a live scratch game because it
needed explicit authorization. The user then expressly approved creation and
deletion for the end-to-end test. No workaround or indirect creation was used.

A scratch session with two teams was created through MCP. Actual requests through
running FastAPI confirmed repeated code-only joins returned identical access.
A rename was observed by **two real teammate WebSockets and one host WebSocket**.
A supplied rival team ID did not change the target; the rival and code remained
unchanged. A duplicate team name returned HTTP 400.

MCP then exercised reveal/submit/approve with a placeholder photo path. Both
joins saw the same earned clue; another rename and rejoin preserved it, the
team identity and the code. No photo was uploaded. The scratch game was deleted
through MCP. Final read-back: one original active game, six historical access
records, four earned clues and all 24 permanent catalog clues preserved.

No application deployment, commit or push was performed. `resume.md` and backend
README reflect the live schema and locally running code. Browser fixtures do not
claim to test a full browser restart or cleared-storage real Supabase flow;
page-close/storage behavior is simulated, while API/database/WebSockets were
also verified live as described above.

## Self-evaluation

| Criterion | Score | Evidence / improvement |
|---|---|---|
| Accuracy | 4/5 | Actual database, API and three WebSocket connections verified; rename browser coverage is Chromium desktop/phone, not every engine. |
| Completeness | 5/5 | Team-only access, rejoin, network persistence, team rename, live migration and scratch cleanup completed. |
| Clarity | 5/5 | One code-only entry and one named menu action replace individual account recovery. |
| Actionability | 5/5 | Live RPCs and running backend work; existing data remains available. |
| Conciseness | 4/5 | Legacy internal identities remain to avoid destructive historical-data changes. |

Overall: 4.6/5. A future WebKit/browser-restart check could broaden UI assurance.
