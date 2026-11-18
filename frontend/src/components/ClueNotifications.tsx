import { useEffect, useState } from "react";
import { Check, MailOpen, Ticket, X } from "lucide-react";
import { TierBadge } from "./Badges";
import { RaceDialog } from "./RaceDialog";
import type { Clue, ClueAward, SubmissionRecord, Tier } from "../lib/types";

export type ClueOutcome =
  | { id: string; kind: "success"; clue: Clue }
  | { id: string; kind: "rejected"; submission: SubmissionRecord; challengeTitle: string };

const ROMAN: Record<Tier, string> = { tier1: "I", tier2: "II", tier3: "III" };

export function ClueNotifications({ outcome, announcements, onDismissOutcome, onDismissAnnouncement, onView }: {
  outcome: ClueOutcome | undefined;
  announcements: ClueAward[];
  onDismissOutcome: (id: string) => void;
  onDismissAnnouncement: (id: string) => void;
  onView: (view: "board" | "clues") => void;
}) {
  useEffect(() => {
    if (!outcome) return;
    const timer = window.setTimeout(() => onDismissOutcome(outcome.id), 8000);
    return () => window.clearTimeout(timer);
  }, [outcome?.id, onDismissOutcome]);

  const rejected = outcome?.kind === "rejected";
  const claimed=rejected&&Boolean(outcome.submission.review_note?.match(/another team.*claim|claim.*another team/i));
  return <>
    {outcome ? <div className={`clue-outcome ${rejected ? "clue-outcome--rejected" : ""}`}>
      <RaceDialog title={rejected ? "Submission rejected" : "Clue unlocked!"}
        eyebrow={rejected ? "RACE CONTROL / REVIEW FEEDBACK" : "RACE CONTROL / CLUE ACQUIRED"}
        onClose={() => onDismissOutcome(outcome.id)}
        footer={<button type="button" className="btn-primary outcome-action" onClick={() => {
          onDismissOutcome(outcome.id);
          onView(rejected ? "board" : "clues");
        }}>{rejected ? "Back to board" : "View your clues"}</button>}>
        <div className="outcome-identity" aria-hidden="true">
          <span className="outcome-symbol">{rejected ? <X size={36} /> : <MailOpen size={40} />}</span>
          <span className="outcome-stamp">{rejected ? claimed?'TASK CLAIMED':'TRY AGAIN' : <><Check size={16} />ACQUIRED</>}</span>
        </div>
        {outcome.kind === "success" ? <>
          <p className="outcome-intro">Your team acquired a Tier {ROMAN[outcome.clue.tier]} clue.</p>
          <div className="outcome-clue-ticket"><TierBadge tier={outcome.clue.tier} />
            <h3>{outcome.clue.title}</h3><p>{outcome.clue.body}</p>
          </div>
          <p className="outcome-note">Saved in Your clues. This closes automatically after 8 seconds.</p>
        </> : <>
          <p className="outcome-intro">{outcome.challengeTitle}</p>
          <div className="rejection-feedback"><strong>{claimed?'TASK NO LONGER AVAILABLE':'HOST FEEDBACK'}</strong>
            <p>{outcome.submission.review_note?.trim() || "No feedback was provided. Check the challenge requirements before submitting again."}</p>
          </div>
          <p className="outcome-note">Your team only. This closes automatically after 8 seconds.</p>
        </>}
      </RaceDialog>
    </div> : null}
    <aside className="rival-clue-notices" aria-label="Game updates">
      <div role="log" aria-label="Clue updates" aria-live="polite" aria-relevant="additions"><ol>
        {announcements.slice(0, 2).map(award => <RivalNotice key={award.id} award={award} onDismiss={onDismissAnnouncement} />)}
      </ol></div>
    </aside>
  </>;
}

function RivalNotice({ award, onDismiss }: { award: ClueAward; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => onDismiss(award.id), 6000);
    return () => window.clearTimeout(timer);
  }, [award.id, paused, onDismiss]);
  return <li className="rival-clue-toast" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
    onFocusCapture={() => setPaused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false); }}>
    <Ticket size={22} className="rival-toast-icon" aria-hidden="true" />
    <p><strong>{award.team_name}</strong> acquired a <b>Tier {ROMAN[award.tier]}</b> clue.</p>
    <button type="button" onClick={() => onDismiss(award.id)} aria-label={`Dismiss update from ${award.team_name}`}><X size={18} aria-hidden="true" /></button>
  </li>;
}
