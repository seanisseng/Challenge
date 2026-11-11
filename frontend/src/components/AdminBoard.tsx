import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, Flag, LoaderCircle, MapPin, MapPinned, RefreshCw, Route, Trash2, TriangleAlert } from "lucide-react";

import { ChallengeStatusBadge, TierBadge } from "./Badges";
import { ChallengeImage } from "./ChallengeImage";
import { ChallengeQueue } from "./ChallengeQueue";
import { RaceDialog } from "./RaceDialog";
import { discardChallenge, setBoardVisibility } from "../lib/api";
import type { AdminState, Challenge } from "../lib/types";

export function AdminBoard({ state, onAction, error }: {
  state: AdminState;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
  error?: string | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState<Challenge | null>(null);
  const [brief, setBrief] = useState<Challenge | null>(null);
  const { session } = state;
  const ended = session.status === "ended";
  const pending = state.submissions.filter(sub => sub.status === "pending").length;
  const isLiveRemoval = Boolean(removing && state.board.some(card => card.id === removing.id));

  useEffect(() => {
    if (removing && ![...state.board, ...state.queue].some(card => card.id === removing.id)) setRemoving(null);
  }, [state.board, state.queue, removing]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    try { await onAction(action); } finally { setBusy(null); }
  };

  const removeButton = (challenge: Challenge) => {
    const live = state.board.some(card => card.id === challenge.id);
    const Icon = live ? RefreshCw : Trash2;
    return <button type="button" className={live ? "ticket-replace" : "queue-remove"}
      aria-label={live ? "Replace" : `Remove ${challenge.title} from this game`}
      title={live ? "Replace this challenge" : "Remove for this session"}
      disabled={busy !== null || dragging || ended || challenge.status === "claimed"}
      onClick={() => setRemoving(challenge)}>
      <Icon size={15} aria-hidden="true" /><span>{live ? "Replace" : "Remove"}</span>
    </button>;
  };

  return <section className="board-page" aria-label="Challenge board">
    <div className="board-intro">
      <div><p className="race-eyebrow"><Route size={14} aria-hidden="true" /> RACE CONTROL / BOARD</p>
        <h2>Set the pace.</h2>
        <p className="board-intro-copy">Real-world challenges. Race-changing clues. You call the next move.</p>
      </div>
      <button type="button" className={session.board_visible ? "btn-secondary board-reveal" : "btn-primary board-reveal"}
        disabled={busy !== null || dragging || ended || (!session.board_visible && state.board.length === 0)}
        onClick={() => void run("visibility", () => setBoardVisibility(session.id, !session.board_visible))}>
        {busy === "visibility" ? <LoaderCircle size={18} className="race-spinner" aria-hidden="true" /> : session.board_visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        {busy === "visibility" ? "Updating board..." : session.board_visible ? "Hide Board" : "Reveal Board"}
      </button>
    </div>

    <div className="board-overview">
      <div className="board-metric"><span className="board-metric-number">{String(state.board.length).padStart(2, "0")}</span><span>ON THE BOARD</span></div>
      <div className="board-metric"><span className="board-metric-number">{String(state.queue.length).padStart(2, "0")}</span><span>IN THE QUEUE</span></div>
      <div className="board-metric"><span className="board-metric-number">{String(pending).padStart(2, "0")}</span><span>AWAITING REVIEW</span></div>
      <div className={`board-visibility ${session.board_visible && !ended ? "board-visibility--visible" : ""}`} role="status">
        {session.board_visible && !ended ? <Eye size={18} aria-hidden="true" /> : <EyeOff size={18} aria-hidden="true" />}
        <div><strong>{ended ? "Game ended" : session.board_visible ? "Board is live" : "Host preview only"}</strong>
          <span>{ended ? "Your session is closed." : session.board_visible ? `Visible to all ${session.team_count} teams.` : "Teams cannot see these challenges yet."}</span></div>
      </div>
    </div>

    <div className="board-layout">
      <div className="board-live-region">
        <div className="board-section-heading"><div><span className="race-section-index">01</span><h3>{session.board_visible ? "LIVE CHALLENGES" : "YOUR OPENING BOARD"}</h3></div><span>{state.board.length} / {session.active_task_limit} slots</span></div>
        <p className="board-section-note">First approved proof wins the clue. Replace a card to draw the next challenge.</p>
        {state.board.length === 0 ? <div className="race-empty board-empty"><Flag size={34} strokeWidth={1.4} aria-hidden="true" /><h4>The board is clear.</h4><p>No challenges remain in play. Teams can keep following the clues they have unlocked.</p></div> : (
          <ul className="board-ticket-grid">
            {state.board.map((challenge, index) => <li key={challenge.id} className={`challenge-ticket challenge-ticket--${challenge.clue_tier}`} data-testid="challenge-ticket">
              <div className="ticket-stamps"><TierBadge tier={challenge.clue_tier} /><ChallengeStatusBadge status={challenge.status} /></div>
              <div className="ticket-main"><p className="ticket-index">CHALLENGE {String(index + 1).padStart(2, "0")}</p>
                <h4>{challenge.title}</h4><p className="ticket-condition">{challenge.completion_condition}</p>
                <button type="button" className="ticket-brief" onClick={() => setBrief(challenge)}>Read full brief <ArrowRight size={14} aria-hidden="true" /></button>
              </div>
              <div className="ticket-area"><div className="ticket-area-icon"><MapPin size={20} aria-hidden="true" /></div>
                <div><span>CHALLENGE AREA</span><p>{challenge.location_area || "Anywhere"}</p></div>
                <div className="ticket-reference" aria-hidden={!challenge.image_url}>
                  {challenge.image_url ? <ChallengeImage url={challenge.image_url} title={challenge.title} thumbnail /> : <MapPinned size={34} strokeWidth={1} aria-hidden="true" />}
                </div>
              </div>
              <div className="ticket-footer"><span><span className="ticket-route-dot" />TIER {challenge.clue_tier.slice(-1)} CLUE REWARD</span>{removeButton(challenge)}</div>
            </li>)}
          </ul>
        )}
        <p className="board-replace-note"><RefreshCw size={14} aria-hidden="true" /> Replaced challenges leave this session permanently. You will confirm before any change.</p>
      </div>
      <ChallengeQueue queue={state.queue} sessionId={session.id} disabled={busy !== null || ended}
        renderRemove={removeButton} onDraggingChange={setDragging}
        onAction={action => run("queue", async () => { await action(); })} />
    </div>

    {removing ? <RaceDialog title={`${isLiveRemoval ? "Replace" : "Remove"} ${removing.title}?`} onClose={() => { if (!busy) setRemoving(null); }}
      footer={<><button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => setRemoving(null)}>Keep challenge</button>
        <button type="button" className="btn-danger-solid" disabled={busy !== null} onClick={() => void run(removing.id, async () => {
          await discardChallenge(session.id, removing.id); setRemoving(null);
        })}>{busy ? <LoaderCircle size={16} className="race-spinner" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}{isLiveRemoval ? "Replace challenge" : "Remove challenge"}</button></>}>
      <p>This challenge will be removed for the rest of this game. It will not return to the queue.</p>
      <div className="race-warning"><TriangleAlert size={20} aria-hidden="true" /><strong>Pending submissions will be rejected.</strong></div>
      {isLiveRemoval ? <p>{state.queue.length ? "The next queued challenge will take its place on the live board." : "The queue is empty, so this slot will stay empty."}</p> : null}
      {error ? <p className="race-dialog-error" role="alert">We could not make that change. Please try again.</p> : null}
    </RaceDialog> : null}

    {brief ? <RaceDialog title={brief.title} onClose={() => setBrief(null)} footer={<button type="button" className="btn-primary" onClick={() => setBrief(null)}>Back to the board</button>}>
      <div className="brief-meta"><TierBadge tier={brief.clue_tier} /><span><MapPin size={16} aria-hidden="true" /> {brief.location_area || "Anywhere"}</span></div>
      <ChallengeImage url={brief.image_url} title={brief.title} />
      <p className="brief-condition">{brief.completion_condition}</p>
    </RaceDialog> : null}
  </section>;
}

export function AdminBoardSkeleton() {
  return <div className="race-host race-loading" role="status" aria-label="Loading challenge board">
    <div className="race-loading-header"><span className="race-eyebrow">RACE CONTROL</span><div className="race-skeleton" /></div>
    <main className="race-main"><div className="race-skeleton race-skeleton-title" /><p>Getting your board ready...</p>
      <div className="board-layout"><div className="board-ticket-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="race-skeleton race-skeleton-ticket" />)}</div><div className="race-skeleton race-skeleton-queue" /></div>
    </main>
  </div>;
}
