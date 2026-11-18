import { useCallback, useEffect, useRef, useState } from "react";
import { Ticket } from "lucide-react";
import { CardBack, ChallengeCard, proofStatus } from "./ChallengeCard";
import { ChallengeSheet } from "./ChallengeSheet";
import { useCardTable } from "../lib/useCardTable";
import type { Challenge, SessionInfo } from "../lib/types";
import type {SubmissionDraft} from '../lib/submissionDraft';
import {useSubmissionDrafts} from '../lib/useSubmissionDrafts';

interface Props {
  board: Challenge[];
  session: SessionInfo;
  teamId: string;
  busy: boolean;
  error: string | null;
  reviewNoticeId?: string;
  uploadProgress?: number;
  onCancelUpload?:()=>void;
  onUpload: (challengeId: string, draft:SubmissionDraft) => Promise<boolean>;
}

export function CardTable({ board, session, teamId, busy, error, reviewNoticeId, onUpload,uploadProgress,onCancelUpload }: Props) {
  const visible = session.board_visible && session.status === "active";
  const table = useCardTable(board, visible, session.board_reveal_version);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const {drafts,save,storageError,saving,restoring}=useSubmissionDrafts(`${session.id}:${teamId}`);
  const unsaved=Boolean(storageError)&&Object.values(drafts).some(draft=>draft.files.length||draft.text);
  useEffect(()=>{
    if(!busy&&!saving&&!unsaved)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[busy,saving,unsaved]);
  const [filter, setFilter] = useState<"all" | "open" | "submitted">("all");
  const [moreBelow, setMoreBelow] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const deck = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const selected = visible ? board.find(card => card.id === selectedId) : undefined;
  const showFilters = visible && board.length > 8;
  const shown = table.cards.filter(card => !showFilters || filter === "all" || proofStatus(card.challenge) === filter);

  const close = useCallback(() => {
    if (window.history.state?.challengeSheet) window.history.back();
    setSelectedId(null);
  }, []);

  useEffect(() => {
    const back = () => {
      setSelectedId(null);
      requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);

  useEffect(() => {
    if (selectedId && (!selected || reviewNoticeId)) close();
  }, [selectedId, selected, reviewNoticeId, close]);

  const updateOverflow = useCallback(() => {
    const element = list.current;
    setMoreBelow(Boolean(element && element.scrollHeight - element.clientHeight - element.scrollTop > 2));
  }, []);

  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(element);
    updateOverflow();
    return () => observer.disconnect();
  }, [board, filter, visible, updateOverflow]);

  return <section className="hunt-table" aria-label="Challenge board">
    <div className="board-section-label">
      <h2>The board <span>· {visible ? board.length : "—"} in play</span></h2>
    </div>
    {showFilters ? <div className="challenge-filters" role="group" aria-label="Filter challenges">
      {(["all", "open", "submitted"] as const).map(value => <button type="button" key={value}
        aria-pressed={filter === value} onClick={() => { setFilter(value); if (list.current) list.current.scrollTop = 0; }}>
        {value === "all" ? "All" : value === "open" ? "Open" : "Submitted"}
      </button>)}
    </div> : null}
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {visible ? `${board.length} challenges available. Tap a card for full details.` : "Board hidden. Waiting for the host."}
    </p>
    {!visible ? <div className="table-waiting">
      <Ticket size={40} aria-hidden="true" />
      <h3>{session.status === "ended" ? "That’s a wrap." : "Your next move awaits."}</h3>
      <p>{session.status === "ended" ? "The hunt has ended. Your clues are still available." : "The host will reveal your challenges here. Keep your team close."}</p>
    </div> : <div className={`challenge-list-frame ${moreBelow ? "challenge-list-frame--more" : ""}`}>
      <div className={`draw-deck ${table.cards.some(card => card.phase === "dealing") ? "draw-deck--drawing" : ""}`} role="img" aria-label="Draw deck">
        <div className="draw-deck-stack" aria-hidden="true">
          <span className="draw-deck-under draw-deck-under--bottom" />
          <span className="draw-deck-under draw-deck-under--middle" />
          <div className="draw-deck-top" ref={deck}><CardBack /></div>
        </div>
        <span className="draw-deck-label" aria-hidden="true">Draw deck</span>
      </div>
      <ul className="challenge-list" ref={list} onScroll={updateOverflow} aria-label="Live challenges">
        {shown.map(card => <ChallengeCard key={card.key} card={card} deck={deck} onOpen={element => {
          trigger.current = element;
          element.focus({ preventScroll: true });
          window.history.pushState({ ...window.history.state, challengeSheet: card.challenge.id }, "");
          setSelectedId(card.challenge.id);
        }} />)}
        {!shown.length ? <li className="challenge-list-empty">{board.length ? "No challenges match this filter." : "All challenges have been claimed. Follow your clues."}</li> : null}
      </ul>
    </div>}
    {selected ? <ChallengeSheet key={selected.id} challenge={selected} busy={busy} error={error} trigger={trigger.current}
      onClose={close} draft={drafts[selected.id]??{files:[],text:''}} onDraftChange={draft=>save(selected.id,draft)}
      draftStatus={storageError??(restoring?'Restoring saved draft…':saving?'Saving draft on this device…':'Draft saved on this device.')} draftStorageError={Boolean(storageError)} draftLoading={restoring}
      uploadProgress={uploadProgress} onCancelUpload={onCancelUpload}
      onUpload={async draft=>{const sent=await onUpload(selected.id,draft);if(sent){save(selected.id,null);close();}return sent;}} /> : null}
  </section>;
}
