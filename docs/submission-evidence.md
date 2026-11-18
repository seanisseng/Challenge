# Submission evidence

Players can attach up to ten images/videos and an optional message. A nonblank
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

Original MP4/MOV/WebM recordings may be up to 60 seconds and 1 GiB each. The
backend creates a separate H.264/AAC MP4 using bundled FFmpeg from
`imageio-ffmpeg`. It limits the longest edge to 1920 pixels, frame rate to 30 fps,
video bitrate to 5 Mbps and audio to 128 kbps. HDR recordings are tone-mapped to
SDR. The original recording remains unchanged. This reduces upload-copy quality
in exchange for staying within the Free plan's per-file storage limit.

Prepared videos must fit within 45 MiB. Images are limited to 25 MiB each. Input
files must total at most 2 GiB per submission; the database limits stored media
to 450 MiB. Free plan project-wide storage/bandwidth quotas still apply.

The API streams source files to temporary disk and streams prepared copies to
Storage rather than buffering whole videos in memory. At most two encoders run
concurrently per server process. Deployment needs temporary disk space, an
executable FFmpeg binary, and request/body/proxy timeouts sufficient for the
original recording upload and encoding (up to five minutes per clip). Multiple
No background upload service is added.

## Deployment

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
