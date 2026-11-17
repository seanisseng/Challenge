# Authoritative progress tier counts — 2026-11-16

The host inferred tiers from claimed challenges remaining in the live board or
queue. Refill removes claimed cards, leaving the host with a correct total but
an incomplete breakdown. Players saw their own tiers from their private clue
inventory; rivals depended on a recent-award feed capped at 50 events.

`repo.progress` now reads `team_id,clues!inner(tier)` from the existing inventory
query and adds `clue_tier_counts` per team. All tiers are present, including
zero counts. Both host and player progress cards prefer these complete totals.
The optional frontend field keeps old snapshots compatible; player own-clue
counts remain authoritative. Only tier counts are shared, never clue content.
No additional query, migration, or hosted mutation is required.

Verification:

- RED: the backend test failed with missing `clue_tier_counts` before the fix.
- GREEN: 16 backend progress/award/snapshot/board checks passed. The inventory
  regression includes 72 unlocks across teams, beyond the notification feed's
  50-event cap, and verifies zero counts for a team with no clues.
- Eight browser cases passed across desktop and phone: complete host tiers after
  claimed cards leave the board, realtime count updates, player rivals without
  recent awards, old-server fallback, and tied leaders.
- Frontend production build and `git diff --check` passed.
- The running host HTTP API was compared read-only with actual unlocked clues
  for every team. Team 4 matched Tier 1: 1, Tier 2: 2, Tier 3: 1, total 4.
  Other teams had zero. No game records were changed.

Commands:

```powershell
backend/.venv/Scripts/python.exe -m pytest backend/tests/test_progress_tiers.py backend/tests/test_clue_awards.py backend/tests/test_board_controls.py -p no:cacheprovider -o addopts='' -q
# From frontend:
npx playwright test tests/e2e/team-stickers.spec.ts --project=desktop --project=phone --grep 'host grid|host never|host tier|host inventory|host.*tier|player rival'
npm run build
```

Self-evaluation: accuracy 5/5 (running API matches live inventories), completeness
5/5 (host and player/rival paths covered), clarity 5/5 (actual inventory replaces
inference), actionability 5/5 (running backend serves the field), conciseness 4/5
(legacy fallback retained for compatibility). Overall 4.8/5. Browser regressions
use fixtures; no live approval or upload was required. Coverage percentage was
not measured. No application deployment, commit or push was performed.
