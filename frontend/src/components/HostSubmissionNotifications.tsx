import { useEffect, useRef, useState } from "react";
import { Inbox, X } from "lucide-react";
import type { AdminSubmission } from "../lib/types";

export function HostSubmissionNotifications({ submissions, suppressed, onOpen }: {
  submissions: AdminSubmission[];
  suppressed: boolean;
  onOpen: (id: string) => void;
}) {
  // The first snapshot is a baseline; reconnects must not replay old proofs.
  const seen = useRef(new Set(submissions.map(item => item.id)));
  const [queue, setQueue] = useState<string[]>([]);
  useEffect(() => {
    const fresh = submissions.filter(item => !seen.current.has(item.id) && item.status === "pending")
      .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
    submissions.forEach(item => seen.current.add(item.id));
    if (suppressed) { setQueue([]); return; }
    const pending = new Set(submissions.filter(item => item.status === "pending").map(item => item.id));
    setQueue(current => [...current.filter(id => pending.has(id)), ...fresh.map(item => item.id)]);
  }, [submissions, suppressed]);

  const pending = queue.map(id => submissions.find(item => item.id === id && item.status === "pending"))
    .filter((item): item is AdminSubmission => Boolean(item));
  const submission = pending[0];
  if (suppressed || !submission) return null;
  const dismiss = () => setQueue(current => current.filter(id => id !== submission.id));
  return <aside className="host-submission-notices" aria-label="New submissions">
    <div className="host-submission-notice">
      <Inbox size={22} aria-hidden="true" />
      <div className="host-submission-message">
        <div role="status"><strong>New submission</strong><p>{submission.teams?.name ?? "A team"} submitted proof for {submission.challenges?.title ?? "a challenge"}.</p></div>
        {pending.length > 1 ? <p className="host-submission-more">{pending.length - 1} more new {pending.length === 2 ? "submission" : "submissions"}</p> : null}
        <button type="button" className="btn-secondary" onClick={() => { dismiss(); onOpen(submission.id); }}>Open submission</button>
      </div>
      <button type="button" className="host-submission-dismiss" aria-label="Dismiss submission notification" onClick={dismiss}><X size={18} aria-hidden="true" /></button>
    </div>
  </aside>;
}
