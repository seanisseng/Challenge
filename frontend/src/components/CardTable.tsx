import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";

import { ChallengeImage } from "./ChallengeImage";
import { TierBadge } from "./Badges";
import { useCardTable } from "../lib/useCardTable";
import type { TableCard } from "../lib/cardTable";
import type { Challenge, SessionInfo } from "../lib/types";

const SUITS = {
  tier1: { rank: "I", suit: "♦", label: "Direction" },
  tier2: { rank: "II", suit: "♣", label: "Landmark" },
  tier3: { rank: "III", suit: "♠", label: "Precision" },
};

interface Props {
  board: Challenge[];
  session: SessionInfo;
  busy: boolean;
  error: string | null;
  onUpload: (challengeId: string, file: File | undefined) => void;
}

export function CardTable({ board, session, busy, error, onUpload }: Props) {
  const visible = session.board_visible && session.status === "active";
  const table = useCardTable(board, visible, session.board_reveal_version);
  const deck = useRef<HTMLDivElement>(null);
  const discard = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = visible ? board.find(card => card.id === selectedId) : undefined;

  useEffect(() => {
    if (!selected) setSelectedId(null);
  }, [selected]);

  const discarding = table.cards.some(card => card.phase === "discarding");
  const dealing = table.cards.some(card => card.phase === "dealing");
  const slots = Math.max(session.active_task_limit, table.slots);

  return (
    <section className="hunt-table" aria-label="Challenge card table">
      <div className="table-heading">
        <div>
          <p className="table-eyebrow">THE HUNT IS ON</p>
          <h2>The board</h2>
        </div>
        <span className="table-counter">{visible ? board.length : "—"} in play</span>
      </div>

      <div className="table-rail" aria-hidden="true">
        <div className="table-pile-label">
          <div ref={deck} className={`table-deck ${dealing ? "table-deck--drawing" : ""}`}>
            <span className="pile-card pile-card--under" />
            <span className="pile-card pile-card--middle" />
            <span className="pile-card pile-card--top">✦</span>
          </div>
          <span>DRAW PILE</span>
        </div>
        <p className="table-rail-message">
          {!visible ? "Your next move awaits." : discarding ? "Off the table. Next card up." : dealing ? "Dealing your next move…" : "Find it. Prove it. Unlock it."}
        </p>
        <div className="table-pile-label">
          <div ref={discard} className={`table-discard ${table.discarded || discarding ? "table-discard--filled" : ""} ${discarding ? "table-discard--receiving" : ""}`}>
            <span>♠</span>
          </div>
          <span>DISCARD</span>
        </div>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {!visible ? "Board hidden. Waiting for the host." : discarding ? "A challenge is leaving the board." : dealing ? "Dealing challenge cards." : `${board.length} challenges available. Tap a card for full details.`}
      </p>

      {!visible ? (
        <div className="table-waiting">
          <div className="waiting-hand" aria-hidden="true">
            <span className="waiting-card">✦</span>
            <span className="waiting-card">✦</span>
            <span className="waiting-card">✦</span>
          </div>
          <h3>{session.status === "ended" ? "That’s a wrap." : "Ready for the flop?"}</h3>
          <p>{session.status === "ended" ? "The hunt has ended. Your clues are still below." : "The host will reveal your challenges here. Keep your team close."}</p>
        </div>
      ) : (
        <>
          <ul className="table-grid">
            {Array.from({ length: slots }, (_, slot) => {
              const card = table.cards.find(entry => entry.slot === slot);
              return card ? (
                <PlayingCard key={card.key} card={card} deck={deck} discard={discard} onOpen={() => setSelectedId(card.challenge.id)} />
              ) : (
                <li key={`empty-${slot}`} className="table-empty-slot" aria-hidden="true"><span>✦</span></li>
              );
            })}
          </ul>
          <p className="table-footnote">
            {board.length ? "Tap a card for the full challenge & photo proof." : "All challenges have left the table. Follow your clues."}
          </p>
        </>
      )}

      {selected ? (
        <ChallengeSheet key={selected.id} challenge={selected} busy={busy} error={error}
          onClose={() => setSelectedId(null)} onUpload={file => onUpload(selected.id, file)} />
      ) : null}
    </section>
  );
}

function PlayingCard({ card, deck, discard, onOpen }: {
  card: TableCard;
  deck: RefObject<HTMLDivElement>;
  discard: RefObject<HTMLDivElement>;
  onOpen: () => void;
}) {
  const slot = useRef<HTMLLIElement>(null);
  const { challenge, phase } = card;
  const { rank, suit, label } = SUITS[challenge.clue_tier];

  useLayoutEffect(() => {
    if (!slot.current || phase === "settled") return;
    const target = (phase === "discarding" ? discard : deck).current;
    if (!target) return;
    const sourceRect = target.getBoundingClientRect();
    const cardRect = slot.current.getBoundingClientRect();
    slot.current.style.setProperty("--travel-x", `${sourceRect.left + sourceRect.width / 2 - cardRect.left - cardRect.width / 2}px`);
    slot.current.style.setProperty("--travel-y", `${sourceRect.top + sourceRect.height / 2 - cardRect.top - cardRect.height / 2}px`);
  }, [phase, deck, discard]);

  return (
    <li ref={slot} className={`table-slot table-slot--${phase}`} style={{ "--deal-delay": `${card.delayMs}ms` } as CSSProperties}>
      <div className="playing-card-motion">
        <button type="button" className={`playing-card playing-card--${challenge.clue_tier}`}
          disabled={phase !== "settled"} onClick={onOpen}
          aria-label={`View ${challenge.title}, tier ${challenge.clue_tier.slice(-1)} ${label.toLowerCase()} clue challenge`}>
          <span className="playing-card-inner">
            <span className="playing-card-back" aria-hidden="true">
              <span className="card-back-frame"><span>✦</span><span>THE<br />HUNT</span><span>✦</span></span>
            </span>
            <span className="playing-card-front">
              <span className="card-corner" aria-hidden="true"><b>{rank}</b><span>{suit}</span></span>
              <span className="card-tier">Tier {challenge.clue_tier.slice(-1)} clue</span>
              <span className="card-front-copy">
                <span className="card-front-suit" aria-hidden="true">{suit}</span>
                <span className="card-title">{challenge.title}</span>
                <span className="card-location">{challenge.location_area ?? "Anywhere"}</span>
                <span className="card-rule">{challenge.completion_condition}</span>
              </span>
              <span className={`card-proof-state ${challenge.my_submission?.status === "pending" ? "card-proof-state--pending" : ""}`}>
                {challenge.my_submission?.status === "pending" ? "Proof submitted" : challenge.my_submission?.status === "rejected" ? "Try again · view feedback" : "View challenge ↗"}
              </span>
              <span className="card-corner card-corner--bottom" aria-hidden="true"><b>{rank}</b><span>{suit}</span></span>
            </span>
          </span>
        </button>
      </div>
    </li>
  );
}

function ChallengeSheet({ challenge, busy, error, onClose, onUpload }: {
  challenge: Challenge;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onUpload: (file: File | undefined) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const submission = challenge.my_submission;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
    };
  }, []);

  return (
    <dialog ref={dialog} className="challenge-sheet" aria-labelledby="challenge-sheet-title" onCancel={onClose}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}>
      <div className="sheet-handle" aria-hidden="true" />
      <div className="flex items-center justify-between gap-3">
        <TierBadge tier={challenge.clue_tier} />
        <button type="button" onClick={onClose} aria-label="Close challenge" className="sheet-close">×</button>
      </div>
      <h2 id="challenge-sheet-title" className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">{challenge.title}</h2>
      <p className="mt-2 text-sm font-medium text-slate-500">📍 {challenge.location_area ?? "Anywhere"}</p>
      <ChallengeImage url={challenge.image_url} title={challenge.title} />
      <p className="mt-5 text-xs font-bold uppercase tracking-widest text-slate-400">Your challenge</p>
      <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-slate-800">{challenge.completion_condition}</p>
      {submission ? (
        <p role="status" className={`mt-4 rounded-xl p-3 text-sm ${submission.status === "rejected" ? "bg-rose-50 text-rose-800" : "bg-indigo-50 text-indigo-800"}`}>
          {submission.status === "pending" ? "Your proof is with the host. The challenge stays open until someone is approved."
            : submission.status === "approved" ? "Approved. Your clue is unlocked."
              : `Rejected${submission.review_note ? `: ${submission.review_note}` : ". You can try again."}`}
        </p>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p> : null}
      <div className="sheet-actions">
        <input ref={input} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={event => { onUpload(event.target.files?.[0]); event.target.value = ""; }} />
        <button type="button" className="btn-primary min-h-12 w-full" disabled={busy || challenge.status === "claimed"}
          onClick={() => input.current?.click()}>
          {busy ? "Uploading proof…" : submission ? "Submit another photo" : "Submit photo proof"}
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">First approved proof wins the clue.</p>
      </div>
    </dialog>
  );
}
