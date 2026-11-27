# Submission evidence

Players can attach up to ten images/videos and an optional message. A nonblank
message alone is valid. Videos must be **30 seconds or shorter**. Longer clips
must be trimmed by the player; the app never silently cuts off evidence.

## Player flow and preparation

1. Add attachments and a message. Files stay on the device until Submit.
2. Supported photos become JPEG upload copies (at most 1600 pixels on the long
   edge, targeting 350 KiB). Unsupported decoders preserve the original.
3. Selecting a video lazily loads the locally served single-thread FFmpeg
   WebAssembly worker (approximately 32 MB on the first visit, cached as hashed
   static assets). It checks duration and codecs before accepting the file.
4. Compatible H.264/AAC MP4s up to 20 MiB skip conversion. Other videos are
   converted to MP4, up to 720p / 30 fps, around 3 Mbps H.264 plus 128 kbps AAC.
   Audio is preserved when present. Sources may be at most 200 MiB; prepared
   videos must fit within 45 MiB. Images may be at most 25 MiB; the combined
   submission limit is 450 MiB. Supabase project storage quotas still apply.
5. Preparation shows its status and can be cancelled. After three minutes, an
   unsuccessful preparation stops with advice to export a smaller 720p MP4.
   The prior draft and original recordings remain untouched.
6. Submit authorizes private upload paths, transfers files directly to Supabase,
   verifies them, and finalizes one pending proof. At most two files transfer at
   once. Each transfer uses 6 MiB TUS chunks, with a smaller final chunk. These
   are transport chunks, not separate playable clips: each file stays one video.

Signed TUS uploads use `/storage/v1/upload/resumable/sign` with the per-object
token in `x-signature`, matching Supabase's signed-upload example. The regular
`/upload/resumable` route expects user authentication instead. Deploy both the
backend endpoint correction and frontend status-specific errors together; no
database migration is needed. Failed drafts remain available for retry. Error
messages expose HTTP status codes without exposing signed URLs or tokens.

Browser conversion can be slow or fail on memory-limited devices or unsupported
recordings; retain the draft and provide a clear fallback rather than uploading
an unverified original. Existing drafts saved before this rollout may need their
videos reattached to prepare a compatible copy. Host playback uses normal video
controls and retains a signed download fallback. Real iPhone hardware playback
and HDR camera variants require device verification beyond Windows WebKit.

Drafts persist in IndexedDB, scoped to the game and team. Choosing files does not
upload them. Storage failures show a warning instead of claiming the draft is
saved. Closing the proof sheet cancels active preparation; cancelling upload
retains the draft. A request committed just before cancellation may still
appear, so the client checks current state before offering another submission.

## Direct-upload API and verification

- `POST /api/uploads`: authenticated with the existing team token; accepts a
  request UUID, challenge UUID, and file manifest. The database atomically
  allocates a batch and unique team-owned paths. Repeated identical requests
  reuse the batch; signed upload tokens are never logged or persisted in drafts.
- The browser sends files directly to the project's Storage hostname using
  signed TUS capabilities. No Supabase service key is shipped to the browser.
  Interrupted transfers resume their offset; uncertain completed transfers are
  verified before attempting another upload.
- `POST /api/uploads/{id}/complete`: checks team ownership, expiry and session
  existence, then reads the actual stored object with a bounded streaming
  download. Size, image signature, video container/codecs and duration are
  verified server-side. Vercel does not re-encode direct uploads.
- `POST /api/submissions/finalize`: accepts only a batch UUID and message.
  A transactional service-only function requires every attachment to be
  verified, rechecks challenge availability, and creates exactly one pending
  proof. Duplicate finalization returns the same submission ID. Client-supplied
  paths, sizes and durations cannot authorize evidence.

All attachments use the new direct flow. `POST /api/submissions` remains as a
legacy multipart path with its existing 4 MiB aggregate request budget and the
new 30-second duration limit. Its backend encoding remains for old clients.
The new direct flow bypasses Vercel's file-body limit; it does not increase it.
Existing stored 60-second proofs remain reviewable.

## Expiry and session deletion

Upload capabilities can outlive a page or deleted session. Durable batch records
have no cascading session foreign key and remain until 25 hours after their last
capability authorization, covering the 24-hour resumable URL lifetime plus a
margin. Up to 20 unfinished attachment slots per team bound abandoned drafts.
Reusing a saved upload batch does not consume extra slots.

`GET /api/internal/uploads/cleanup` removes up to 50 expired orphan batches and
retries session-prefix cleanup. Attached proofs in existing sessions are retained.
Session deletion keeps its cleanup job until outstanding capabilities expire,
so a late upload cannot permanently recreate deleted media. The daily Vercel
cron runs at 19:00 UTC (03:00 Singapore time); cleanup may therefore occur up to
about a day after expiry. Storage errors leave records available for retry.
The endpoint requires `Authorization: Bearer <CRON_SECRET>`.

## Deployment

### Direct uploads (migration 32)

Apply all preceding migrations, then
`backend/supabase/migrations/20260101000032_direct_proof_uploads.sql` through the
Supabase SQL Editor or an authorized migration connection. It adds private
upload tables, authorization/finalization functions and a 30-second constraint
for new attachment data. It does not modify historical proofs or make Storage
public. Migration 32 was applied to hosted project `ceqfgjqwvuqhtsbmxfdn` on
2026-11-27 as version `20261127083953` (`direct_proof_uploads`). Both upload
tables, RLS, the duration trigger, service-only RPC permissions and application
SDK access were verified after commit. The API schema cache was refreshed.
The working IPv4 migration connection is the Singapore session pooler
`aws-1-ap-southeast-1.pooler.supabase.com:5432`, using
`postgres.ceqfgjqwvuqhtsbmxfdn` and the existing database password.

Set a random backend-only `CRON_SECRET` in Vercel Production (and locally when
manually exercising cleanup). Never prefix it with `VITE_`. Deploy frontend and
backend together, then reload open clients. Existing Supabase credentials and
Storage bucket settings remain usable; the proof bucket must allow MP4 and at
least 45 MiB per object, as configured by migration 26. Keep the global Storage
limit at least as large. The browser needs access to the project's
`*.storage.supabase.co` host for direct transfers.

Before production, test a real phone recording and confirm that the daily cron
can invoke cleanup. Check preparation time, upload time, verification time and
Storage quota separately; a short file can still be large at high bitrates.

Verification for migration 32: 45 frontend unit checks, the production build,
focused backend validation/cleanup checks and three disposable PostgreSQL tests
passed. Twenty-two Chromium/WebKit browser checks covered preparation, mixed
proofs, retries, cancellation and draft recovery. Two additional checks exercised
the built production assets. The chunk test received 6 MiB + 6 MiB + 1 MiB for
a 13 MiB video, recovering a lost response without duplicate bytes. Browser-
produced MP4s passed native format/duration inspection; actual iPhone hardware
playback and a hosted upload remain rollout checks.

### Submission and review latency changes

Apply `backend/supabase/migrations/20260101000030_review_submission_result.sql`
before deploying the optimized review API. In Supabase's SQL Editor, run that
file's contents once. It adds the service-role-only `review_submission` RPC,
which returns the affected session in the same call and delegates claim,
auto-rejection and clue rewards to the existing transactional functions.
Same-outcome retries do not issue another reward or decision event. No
environment-variable changes are required. This migration has not been applied
to hosted Supabase by this code change.

Submissions and reviews broadcast `team_update` / `admin_update` messages with
only game fields: board, progress, proof history, queue and private team clues.
They retain the client's map and roster. Independent database reads overlap in
a four-thread pool; history is fetched once and sliced by team. Initial
connections, reconciliation and non-evidence mutations retain full snapshots.
Reload clients after deploying both frontend and backend together.

Up to four Storage transfers per session can run concurrently within a backend
process. Cleanup has exclusive access, waits for active transfers, and blocks
new transfers until it finishes. Every queued transfer rechecks that its
session still exists. These gates remain process-local; they do not replace
cross-instance coordination on an autoscaling deployment.

Migration `20260101000026_submission_evidence.sql` adds `attachments` and
`proof_text`, permits nullable legacy `photo_path`, and installs the service-only
`submit_evidence` RPC. It also updates `challenge-proofs` to accept image/video
MIME types with a 45 MiB per-object limit. Legacy photo submissions and the old
`submit_proof` RPC remain supported.

Migration 26 was applied to hosted Supabase on 2026-11-18 as version
`20261118065806` (`submission_evidence`). The evidence columns, RPC and bucket
limit were verified. Board reads also tolerate the old schema during a rolling deployment.
Install updated `backend/requirements.txt` on the API host. The global Supabase
Storage limit can stay at the Free-plan default of 50 MB.

## Historical verification before direct uploads

The latency changes passed 43 frontend unit tests, TypeScript checking and the
production build. Mocked backend checks verify one-call reviews, team-private
partial updates, reduced room reads, four-transfer concurrency and cleanup
exclusion. Disposable local PostgreSQL checks verify migration application,
service-only permissions, retry idempotency and competing approvals with one
reward. Six focused browser checks passed across desktop Chromium and iPhone
WebKit: real large-photo compression/submission, private clue updates and host
review updates. These checks do not measure hosted latency or apply migration
30 to the hosted database.

Coverage includes empty/text-only/mixed drafts, rejected MIME types and counts,
partial-upload cleanup, host media signing, real FFmpeg encoding including the
60-second boundary, and SQL approval/reward behavior. Browser tests exercise the
edit/submit sequence, draft retention, retry after errors, legacy photo
review, and mixed/text-only host review on desktop, touch Chromium and iPhone
WebKit. Live hosted tests remain disabled.

Workflow recovery verification: the backend suite passed with 168 tests and
three intentionally skipped live tests; the final heartbeat/preflight/runner
checks passed separately (26 tests, including the added heartbeat case).
All 21 focused browser checks passed across desktop, touch Chromium and iPhone
WebKit: pending-proof blocking, direct submission/retry, progress/cancellation,
draft reload recovery, silent-socket reconnection and previous-proof downloads.
The 34 frontend unit tests, type checking and production build passed. These
checks use local fixtures; they do not claim the changes are deployed to an API
host or that storage quota is unlimited.

Final checks: the backend regression suite passed; the added schema compatibility
and upload API checks passed (11 tests); encoder checks passed (6 tests), including
generated portrait 4K/60 and HDR-tagged sources. Frontend unit tests, type checking
and production build passed. The final mixed/text-only browser checks passed
(9 tests across desktop, touch Chromium and iPhone WebKit). A read-only hosted
check loaded all six active board challenges and confirmed the REST schema
exposes `submit_evidence` after migration.

Self-evaluation: accuracy 4/5 (real device codec variations remain untested);
completeness 4/5 (implementation and migration complete; no real phone upload
was made to hosted Storage); clarity 5/5 (limits and copy quality are explicit);
actionability 5/5 (migration applied, dependencies and deployment requirements
documented); conciseness 4/5 (technical operational notes are longer than the
player flow). Overall 4.4/5. Next improvement: verify one real iPhone HEVC/HDR and
one Android 4K/60 recording through the deployed API. These limits reflect the
remaining evidence gap; they do not claim device-wide codec compatibility.
