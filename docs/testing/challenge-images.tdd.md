# Challenge reference photos — verification, 2026-11-11

Source: the resume handoff and `challenges/challenges.md`. The user confirmed
keeping the current 29 challenges. Newer canonical wording was preserved.

## Journeys and evidence

| Guarantee | Evidence | Result |
|---|---|---|
| Admins attach photos; teams and admins receive public image URLs | `tests/test_challenge_images.py` and `tests/test_api_surface.py` | PASS |
| Uploads reject unsupported types, empty files, oversized files, wrong sessions and missing challenges | `tests/test_challenge_images.py` | PASS |
| Failed storage uploads do not link an image or broadcast success | `tests/test_challenge_images.py` | PASS |
| Python SDK actually sends the image MIME type for references and proofs | Real SDK + mock HTTP transport in `test_storage_sdk_sends_the_image_mime_type` | PASS |
| Imported photos map to exactly one challenge; seed matches canonical copy, tier counts and photo keys | `tests/test_challenge_assets.py` | PASS |
| Join, submit, approve, snipe, unlock clues and reject work against hosted Supabase | `tests/test_live_flow.py` | PASS |
| Frontend compiles and bundles | `npm run build` in `frontend/` | PASS |

Initial RED: image tests and API surface checks failed because the endpoint,
storage helpers and snapshot fields were absent. After implementation, the
same target passed. A live upload then exposed incorrect SDK option names.
The real-SDK MIME tests failed for both upload paths before the fix, then passed
after replacing `contentType` with `content-type`. The import script also uses
`cache-control` rather than `cacheControl`.

Final backend command (from `backend/`):

```powershell
$env:CHALLENGE_LIVE_TESTS='1'
.\.venv\Scripts\python.exe -m pytest -o addopts= -q -p no:cacheprovider
```

Result: **53 passed**, 5 dependency deprecation warnings, 14.40 seconds.
Frontend: TypeScript passed; Vite built 41 modules successfully.

## Hosted state

- Project `ceqfgjqwvuqhtsbmxfdn`, Singapore region. All 13 migrations applied
  through Supabase MCP. MCP assigns application timestamps in migration history;
  the local source filenames retain their original ordered timestamps.
- Fresh-install legacy grants in migrations 0005 and 0008 now restrict RPCs to
  `service_role`. Database checks confirm anon/authenticated cannot execute
  `refill_board(uuid)`, while the service role can.
- Room `95Q2X3`, session `1c0fb2d3-ba9f-40d8-ac6d-8959a0850b64`: lobby, six
  teams, 29 inactive challenges, tier split 10/12/7, zero clues.
- Reference photos #2 and #13 uploaded. Unauthenticated GETs returned HTTP 200,
  `image/jpeg`, and SHA-256 hashes identical to the local originals.
- The live test's temporary session and four disposable proof objects were
  removed after verification.

## Known gaps

No visual browser check was possible: the browser/native access host was
unavailable. The image fallback and admin upload retry flow still need browser
interaction coverage. Coverage tooling was not installed, so no percentage is
claimed. No TDD checkpoint commits were created; RED/GREEN evidence is preserved
here and changes remain available for review. Real game clues must be added
before play; the test used its own temporary clue.

## Self-evaluation

| Axis | Score | Evidence and improvement |
|---|---|---|
| Accuracy | 4/5 | Live flow, public image bytes and privilege checks passed; add browser verification. |
| Completeness | 4/5 | Feature, migration, seed and uploads delivered; UI interaction tests and coverage measurement remain. |
| Clarity | 4/5 | Setup and verification are documented; the historical migration chain remains complex. |
| Actionability | 4/5 | Game2 content and photos are ready; real clue content must still be supplied. |
| Conciseness | 4/5 | Shared image renderer avoids duplicated fallback logic; the evidence report adds maintenance overhead. |

Overall: **4.0/5**. No critical issues. Highest-value follow-up: browser checks
for broken image URLs and upload retries. Would the user agree? Likely: the
requested photos and seed are live, with the remaining limits stated explicitly.
