import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { ApiError, deleteSession } from "../lib/api";
import { RaceDialog } from "./RaceDialog";

export function DeleteSessionButton({ session, onDeleted, compact = false }: {
  session: { id: string; name: string };
  onDeleted: (id: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const close = () => { if (!pending.current) setOpen(false); };
  const confirm = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await deleteSession(session.id);
      setOpen(false);
      onDeleted(session.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete this session. Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return <>
    <button type="button" className={compact ? "btn-danger m-3 shrink-0" : "header-end-game"}
      aria-label={compact ? `Delete session ${session.name}` : "Delete session"}
      onClick={() => { setError(null); setOpen(true); }}>
      <Trash2 size={15} aria-hidden="true" />Delete session
    </button>
    {open ? <RaceDialog title={`Delete ${session.name}?`} onClose={close} footer={<>
      <button type="button" className="btn-secondary" disabled={busy} onClick={close}>Keep session</button>
      <button type="button" className="btn-danger" disabled={busy} onClick={() => void confirm()}>{busy ? "Deleting..." : "Delete permanently"}</button>
    </>}>
      <p>This permanently deletes this session, its teams, challenges, clues, submissions and progress. Connected players will be disconnected.</p>
      <p>This cannot be undone.</p>
      {error ? <p role="alert">{error}</p> : null}
    </RaceDialog> : null}
  </>;
}
