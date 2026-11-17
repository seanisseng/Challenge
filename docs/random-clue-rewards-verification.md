# Random clue rewards verification

**Migration 20 supersedes session-scoped draws with a permanent shared catalog.**
See [global clue catalog verification](global-clue-catalog-verification.md) for
current implementation and local integration evidence. The migration-19 notes
below record the earlier implementation.

Each approved new challenge awards one random clue in the rewarded tier that
the winning team does not own. Rewards are shared by the team, including all
its members. A challenge's old clue binding does not override this selection.

## Changes

- Migration `20260101000019_random_unowned_clue_rewards.sql` replaces the
  approval RPC's bound/first-unowned preference with `ORDER BY random()` over
  session-scoped, tier-scoped clues excluding that team's inventory.
- The session lock from migration 18 remains held throughout selection and
  insertion, serializing concurrent approvals within the session.
- Existing one-approval-per-challenge and one-copy-per-team protections remain.
- An exhausted tier cannot supply another distinct clue: approval still
  succeeds, without creating a duplicate. Existing rewards are not backfilled.

## Regression evidence

Journeys were derived from the user's requested filter/exclude/randomize flow.
Tests run the actual migrated approval function in disposable local PostgreSQL,
with minimal supporting tables and a stub for the unrelated board refill.
No hosted data was changed.

From `backend/`, using the existing virtual environment:

```powershell
# Before migration 19: five pass, the seeded random-selection test fails.
.\.venv\Scripts\python.exe -m pytest tests/test_clue_rotation_sql.py -q -p no:cacheprovider --basetemp=../.tmp-clue-random-red

# After migration 19: backend suite passes; three hosted tests skipped.
.\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp=../.tmp-clue-random-green
```

Six SQL cases cover collecting all eight distinct clues in each of three tiers,
session and tier isolation, owned-clue exclusion, independent team inventories,
random selection despite a challenge binding, and rejection of repeat approval.
Randomness is checked with PostgreSQL `setseed`, avoiding statistical flakiness.

Frontend `npm test`: 17 passed. `npm run typecheck`: passed.
`git diff --check`: passed. Coverage percentage was not measured; these tests
execute the database business logic directly. Full Supabase schema integration
remain unverified by an end-to-end game run. PostgreSQL binaries are required for the
SQL tests; machines without them skip those tests.

## Deployment

Apply pending migrations in order, including 18 and 19. Hosted changes require
explicit approval under the repository's External Action Boundaries.

Applied to Supabase project `ceqfgjqwvuqhtsbmxfdn` on 2026-11-12 after explicit
user approval. Both migrations committed in one transaction and were recorded
in `supabase_migrations.schema_migrations`. A fresh connection verified the
live function filters by session and tier, excludes the winning team's owned
clues, uses `ORDER BY random() LIMIT 1`, and does not prefer a bound clue.
Execute privileges remain limited to `service_role`; `anon` and
`authenticated` cannot call approval. No team rewards or submissions were
changed during deployment or verification.

## Self-evaluation

| Criterion | Score | Evidence / improvement |
|---|---|---|
| Accuracy | 4/5 | Actual PL/pgSQL passes local tests; live function verified, full game flow not replayed. |
| Completeness | 5/5 | Requested selection implemented and deployed with user approval. |
| Clarity | 5/5 | Reward rule and exhausted-tier behavior documented explicitly. |
| Actionability | 5/5 | Committed migrations and live function verified; future approvals use the new rule. |
| Conciseness | 4/5 | SQL fixture adds setup code to test the actual RPC rather than a replica. |

Overall: 4.6/5. An end-to-end run in a disposable hosted session would provide
additional integration evidence. The requested rule is deployed and verified.
