# Submission evidence

Players can attach up to ten images/videos, totaling at most **4 MiB
(4,194,304 bytes)** per submission, and an optional message. This combined
source-file budget leaves room for the message and multipart headers below
Vercel's default 4.5 MB request limit. The browser rejects oversized drafts
before sending; the API independently enforces the same combined limit before
processing or uploading any media, including the legacy `file` field.
Supported photos are resized in the browser before attaching: a JPEG upload
copy uses a longest edge of at most 1600 pixels and targets 350 KiB. Encoding
tries lower quality/dimensions when needed and keeps the original if conversion
fails or would make the file larger. GIFs, videos, files over 25 MiB, and formats
the browser cannot decode are left unchanged and must still fit the combined
4 MiB budget. Originals remain untouched. Trim/compress large videos before
attaching. A nonblank
message alone is valid. An empty draft cannot be submitted; the API
and database also enforce this rule.

## Player flow

1. Add or remove attachments and write an optional message. Attachment previews
   use local object URLs; choosing a file makes no upload or submission request.
2. Check the inline previews and message, editing or removing attachments as needed.
3. Select **Submit** to send directly, without a separate review step. The API prepares all files, uploads them, and creates
   one pending submission. Failed requests keep the draft available for retry.

Drafts are saved in IndexedDB on this device, scoped to the game and team,
and restored after reload. Attachments stay local until Submit. A storage/quota
failure shows a warning instead of claiming the draft was saved. While a draft
is being saved, or an upload is running, the browser warns before leaving.
Private browsing, cleared site data or browser eviction can remove saved drafts.
Some phone formats such as HEIC may not preview in every browser; the attached
filename remains visible. WebKit's Blob-storage failure falls back to bounded
4 MiB binary chunks, rather than one huge JavaScript buffer per video.

The form shows upload percentage, followed by a preparing/saving state, and has
a Cancel upload button. Cancel aborts the browser request and retains the draft.
The server checks disconnection before processing another video, uploading files
or registering proof. An encoder already running may finish its current clip.
A request committed just before cancellation can still appear; the client checks
the latest snapshot before offering another attempt. Pending proofs block a
second submission, including a server preflight before any video processing.

The host's existing Review tab displays every attachment and the message. Videos
have native playback controls. Approval, rejection, first-approved-wins locking,
and clue rewards continue through the existing decision endpoints.
The decision log's **View / download proof** button opens reviewed evidence;
each attachment has a short-lived signed **Download** link. Downloads are the
stored upload copies (including compressed video), not original phone recordings.

## Video copies on Supabase Free

Original MP4/MOV/WebM recordings may be up to 60 seconds and must fit within
the shared 4 MiB submission attachment budget before reaching the server. The
backend creates a separate H.264/AAC MP4 using bundled FFmpeg from
`imageio-ffmpeg`. It limits the longest edge to 1920 pixels, frame rate to 30 fps,
video bitrate to 5 Mbps and audio to 128 kbps. HDR recordings are tone-mapped to
SDR. The original recording remains unchanged. This reduces upload-copy quality
in exchange for staying within the Free plan's per-file storage limit.

Prepared videos must fit within 45 MiB in Storage. That is an output safety
cap, not an allowance for larger browser requests: all input images/videos
combined must fit within 4 MiB. The existing database cap of 450 MiB is a
Storage constraint, not the public upload limit. Free plan project-wide
storage/bandwidth quotas still apply.

The API streams source files to temporary disk and streams prepared copies to
Storage rather than buffering whole videos in memory. At most two encoders run
concurrently per server process. Deployment needs temporary disk space, an
executable FFmpeg binary, and request/body/proxy timeouts sufficient for the
original recording upload and encoding (up to five minutes per clip). Multiple
No background upload service is added.

## Deployment

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

## Verification

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
