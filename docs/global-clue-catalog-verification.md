# Permanent global clue catalog

Migration: `backend/supabase/migrations/20260101000020_global_clue_catalog.sql`.
Journeys follow the user's revised request: every game reads the same permanent
`clues` table directly; deleting a game must not remove clues.

## Database and application behavior

- `clues.session_id` and its owning foreign key are removed. There is no
  `clue_templates` table, seeding RPC, per-session clue copy, or load-pack button.
- The 24 player-facing clues in `clues/clues.md` occupy slots 0–7 of each tier.
  Host-only facts, notes, and answer keys are excluded; media URLs are null.
- Identical old clues consolidate by tier/title/body/media URL. Existing team
  unlocks and challenge references are remapped before duplicate rows are removed.
  Distinct legacy content is preserved after the eight built-in clues in its tier;
  it becomes part of the same global catalog. Inspect hosted legacy content before
  applying if the desired catalog must contain exactly 24 rows.
- Session creation still builds the existing 29-challenge board. It does not copy
  clues. Session deletion removes its teams and unlocks while retaining all clues.
- Approval retains session/challenge/submission locking, randomly draws one
  shared same-tier clue the winning team does not own, and rejects rival proofs.
  A missing tier aborts the transaction; an exhausted tier does not repeat clues.
- Anonymous/authenticated database roles cannot read the catalog. Player routes
  continue exposing only that team's unlocked clues. Host clue listing validates
  the session, then reads the shared catalog. Session-specific clue creation is
  removed, including the unused frontend helper and request model.

## Verification evidence

Tests use disposable local PostgreSQL. Storage/Auth schema stubs support the
application migrations; actual hosted Storage and Realtime delivery are excluded.
The migration is executed atomically, matching Supabase migration application.

From the repository root:

```powershell
# RED: historical migration 19 cannot award a clue owned by another old room.
$env:CLUE_APPROVAL_MIGRATION='20260101000019_random_unowned_clue_rewards.sql'
backend/.venv/Scripts/python.exe -m pytest backend/tests/test_clue_rotation_sql.py -k shared_catalog -x -p no:cacheprovider -o addopts=''
# Observed: 1 failed, 8 deselected; inventory [] instead of the shared clue ID.
Remove-Item Env:CLUE_APPROVAL_MIGRATION

# GREEN: shared catalog, migration integration, HTTP reads and reward regressions.
backend/.venv/Scripts/python.exe -m pytest backend/tests/test_global_clues.py backend/tests/test_global_clues_sql.py backend/tests/test_clue_rotation_sql.py -p no:cacheprovider -o addopts=''
# Observed: 16 passed.

backend/.venv/Scripts/python.exe -m pytest backend/tests -q -p no:cacheprovider
# Passed with 3 hosted tests skipped (before adding the final 3 reward cases).
```

| Guarantee | Evidence |
|---|---|
| Exact built-in titles/bodies, eight per tier | `test_catalog_exactly_matches_player_facing_document` compares database rows with Markdown |
| Legacy awards and bindings survive consolidation | `test_old_awards_and_bindings_survive_consolidation` |
| New/deleted games share permanent IDs | `test_new_and_deleted_games_share_the_permanent_catalog` |
| Catalog remains private to backend | `test_catalog_is_private_to_the_backend` and HTTP credential checks |
| Reveal, submit, approve work across games | `test_reveal_submit_approve_uses_same_catalog_across_games` runs real RPCs and submission triggers |
| Independent inventories, random same-tier draw, no repeats | Nine cases in `test_clue_rotation_sql.py` |
| All host sessions read the same catalog | `test_global_clues.py` |

Frontend: `npm test` passed all 17 tests; `npm run build` passed TypeScript and
Vite compilation. `git diff --check` passed. Windows sandbox restrictions required
running local subprocess-based checks outside the sandbox. Coverage percentage
was not measured. No commits or pushes were made. Hosted migration and verification
were subsequently completed through Supabase MCP as recorded below.

## Hosted rollout status

Applied through Supabase MCP to project `ceqfgjqwvuqhtsbmxfdn` on 2026-11-15
(Singapore time). Hosted migration version: `20261115142016`, name
`global_clue_catalog`; its source is local migration `20260101000020`.

Preflight found one active game, zero clues, zero unlocked rewards and zero
pending submissions. No legacy content needed consolidation in this project.

Hosted read-back confirmed:

- Exactly 24 clues, eight per tier, with 24 exact title/body/order matches against
  the source values verified locally against `clues/clues.md`; media URLs null.
- `clues.session_id` removed, `clue_templates` absent, and no anonymous or
  authenticated table SELECT privilege. Approval reads the global tier pool.
- Two scratch games each created 29 challenges and revealed successfully.
  Real `submit_proof` and `approve_submission` RPCs awarded one Tier 2 clue in
  each game. Read-only calls through the updated local backend confirmed actual
  player snapshots changed from zero clues to one matching-tier clue in both.
- Both scratch games were deleted through MCP. All 24 catalog clues survived,
  scratch rewards were cascaded away, and the original active game was preserved.
  No proof files were uploaded; the RPC test used a placeholder storage path.

The scratch test covers hosted database RPCs and backend snapshot generation;
actual photo upload and browser Realtime delivery were not replayed.
Deploy the matching backend code with this schema: older code filters the removed
`session_id` column. No application deployment or push was performed here.
Existing database backups are the rollback path for the ownership conversion;
rolling application code back alone is insufficient.

## Self-evaluation

| Criterion | Score | Evidence / improvement |
|---|---|---|
| Accuracy | 4/5 | Local and hosted migration/RPC/snapshot checks pass; photo upload and browser delivery were not replayed. |
| Completeness | 4/5 | Shared catalog is applied and verified on the hosted project; application deployment is outside this change. |
| Clarity | 5/5 | Shared catalog and team-specific inventory are explicitly separated. |
| Actionability | 4/5 | Hosted database is updated; matching local backend changes remain to be deployed if a separate hosted server is used. |
| Conciseness | 4/5 | SQL repeats canonical values to preserve stable ordering without persistent helper tables. |

Overall: 4.2/5. Remaining verification improvements are browser Realtime delivery
and a real photo upload. The permanent hosted catalog and reward flow are verified.
