# Team progress sticker redesign

Visual-only changes for player Team Progress and host Progress. No backend, API, snapshot model, or route changes were made for this task.

## Delivered

- Shared `TierSticker` in three tiers, earned/empty states and small/medium sizes, using the existing clue ticket's display font, palette, rounded rectangle, numeral and chevrons.
- Fixed tier rotations, count badges, one-time earn animation and instant reduced-motion updates. Initial awards do not animate.
- Shared team cards with player count, three stickers, total clue count and corner labels. Own-team cards retain their tint. Unique positive leaders receive LEADING; ties and zero scores do not.
- Six-team player fixtures at 390×844 and 375×667, at game start and mixed progress, including x7. All six cards fit above navigation at 390×844. The smaller viewport scrolls inside the existing player main region.
- Three-column desktop and two-column tablet host grids, join codes and a keyboard-accessible Table view toggle.
- Six-card loading skeleton with three dashed sticker slots per card.
- Removed progress flags, tracks, count sentences, retired CSS and the now-unused `ClueEnvelope` component.

## Accepted data limitation

The user explicitly chose “Keep strictly visual; use verifiable data only.” `TeamProgress` supplies totals but no tier counts. Player own-team counts come from `state.clues`; rival counts come from existing public `clue_awards`, which are capped at 50 events. Host cards use claimed challenges still present in the existing snapshot, when available. Missing historical tier information is never inferred from totals.

Cards with incomplete tier counts show “Full tier breakdown unavailable.” Their accessible description explains that empty slots may have unreported awards. The total remains the snapshot's authoritative clue count. The FINISHED label is implemented and shown on the design sheet, but actual cards withhold it because these snapshots provide no verifiable completion target.

## Verification

- `npm run build`: passed.
- `npm run typecheck`: passed after removing the unused envelope component.
- `npm test`: 17 existing tests passed.
- Final Playwright run: 25 passed, 11 intentionally skipped for inapplicable viewport projects. Fixtures cover Chromium and WebKit mobile, desktop and tablet; automated axe scans, horizontal overflow, card sizing, six-team fit, large count badges, missing tier information, tied leads, table toggling and animation/reduced motion.
- Source searches confirm no `race-track`, `progress-route`, `race-progress-list`, `race-track-count`, `CLUES UNLOCKED`, or former clue-count sentence remains in `frontend/src`. No `Flag` import remains in either progress view. Other screens' game-ending and board-empty icons are unrelated to this component.

Reproduce browser checks from `frontend`:

```powershell
npx playwright test tests/e2e/team-stickers.spec.ts tests/e2e/host-views.spec.ts tests/e2e/player-views.spec.ts --grep 'sticker|host never|player views use|Progress uses' --project=desktop --project=tablet --project=phone --project=iphone-webkit
```

Screenshots live in `frontend/artifacts`: `tier-sticker-variants.png`, `team-stickers-{width}x{height}-{start|mixed}-{phone|iphone-webkit}.png`, and `host-team-stickers-{desktop|tablet|phone|iphone-webkit}.png`. The design-sheet URL is a test interception only; no application preview route was added.

## Self-evaluation

Overall: 4.2/5. Deliver within the user-approved visual-only boundary.

| Axis | Score | Evidence and practical limit |
| --- | --- | --- |
| Accuracy | 4 | Build, typecheck, unit tests, source search and browser checks support the implementation. Automated axe checks do not replace a manual screen-reader review. |
| Completeness | 4 | Both layouts, four mobile fixtures, variants and labels are delivered. Complete historical tier counts and FINISHED remain unavailable under the accepted snapshot constraint. |
| Clarity | 4 | Incomplete data is explicitly labelled and documented; repeated per-card notices add visual density when many histories are incomplete. |
| Actionability | 5 | Screenshots and the exact local reproduction command are provided; no external publishing or data migration is needed. |
| Conciseness | 4 | Shared components avoid separate player/host sticker implementations; the browser-only design sheet requires additional test scaffolding to keep it out of production routes. |

Highest-impact future improvement, only if separately authorized: complete per-team tier counts and a completion target in existing snapshots would remove unavailable-data notices and enable verified FINISHED stamps. Self-check: this assessment reflects the user's explicit choice to keep this task visual-only. No critical issue requires expanding this task's scope.
