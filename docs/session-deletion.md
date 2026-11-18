# Complete session deletion

Deleting a session now deletes its database records and the session's Storage
objects in both `challenge-proofs` and `challenge-assets` (or their configured
bucket names). Cleanup walks the exact session UUID prefix recursively, pages
through every folder, removes objects in batches, and verifies the prefix is
empty. This includes proof images/videos, replacement reference images and
unreferenced older uploads under that prefix. Other sessions are not touched.

Legacy reference images reused by `challenge_templates`, other games or the
shared clue catalog are copied to a deterministic `_shared/` key and their
references are changed atomically before the old session-owned object is removed.
New-game creation is locked during relinking, preventing a new game from copying
an obsolete path. This preserves the shared catalog while emptying the deleted
session's prefix.

The database deletion and cleanup job creation are one transaction. Session
deletion therefore cannot lose the information needed to retry Storage cleanup.
The API tries cleanup immediately; if Storage is temporarily unavailable, the
host sees **Storage cleanup is pending and will retry automatically**. The job
survives API restarts, retries at startup and every 60 seconds, and is removed
only after cleanup succeeds. No cleanup runs against existing games simply from
applying the migration. Previously deleted sessions without a cleanup job are
not automatically swept by this change.

Physical uploads and cleanup share a per-session lock. A video finishing its
encoding after the session disappears fails the existence check before uploading,
and cleanup waits for an upload already in progress. Use one backend instance
as required by the existing deployment entry point. Players are disconnected
after deletion and the deleted session's shrink scheduler is cancelled.

Supabase migration `20260101000028_session_media_cleanup.sql` was applied on
2026-11-18 as hosted version `20261118081217`. It adds the service-role-only
cleanup queue and RPCs. Storage objects are removed through the Storage API,
not by deleting rows directly from `storage.objects`. No existing session or
media was deleted as part of applying this migration.

Validation: the backend suite passed (182 tests, three live tests skipped), plus
targeted follow-up tests for shared-reference relocation, the retry worker,
late uploads and deletion retry handling. Nine browser checks passed across
desktop, touch Chromium and iPhone WebKit. Frontend type checking and production
build passed. Hosted verification checks the migrated schema and read-only
Storage access; destructive media scenarios use isolated local fixtures.

After deploying/restarting the updated API, pending jobs can be inspected by an
operator with `select * from public.session_media_deletions`. Failed jobs expose
only an error type, not credentials or request details. Clearing browser-downloaded
copies, the repository's bundled reference photos, shared catalog content and
external media URLs is outside session-owned Supabase Storage cleanup.
