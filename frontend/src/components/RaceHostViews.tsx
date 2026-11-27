import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Copy, ExternalLink, Inbox, Keyboard, LoaderCircle, LockKeyhole, Mail, Route, Ticket, X } from "lucide-react";
import { ApiError, listClues } from "../lib/api";
import type { AdminState, AdminSubmission, AdminTeam, Clue, Tier } from "../lib/types";
import { TeamProgressCards, NoTeams, emptyTierCounts, type TierCounts } from "./TeamProgressCards";
import { SubmissionEvidenceView } from "./SubmissionEvidenceView";
import {RaceDialog} from './RaceDialog';
import { SubmissionStatusBadge, TierBadge } from "./Badges";
import {pendingReviewQueue} from '../lib/reviewQueue';

function PageHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <div className="race-page-heading"><p className="race-eyebrow"><Route size={14} aria-hidden="true" />{eyebrow}</p><h2>{title}</h2><p>{children}</p></div>;
}

export function ReviewTab({ submissions, selectedId, onSelect, onApprove, onReject, busy }: {
  busy: boolean;
  submissions: AdminSubmission[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onApprove: (id: string, note?: string) => void | Promise<void>;
  onReject: (id: string, note?: string) => void | Promise<void>;
}) {
  const pending = pendingReviewQueue(submissions);
  const history = submissions.filter(item => item.status !== "pending").sort((a,b)=>
    Date.parse(b.submitted_at)-Date.parse(a.submitted_at)||b.id.localeCompare(a.id));
  const workspaceRef = useRef<HTMLElement>(null);
  useEffect(() => { if (selectedId) workspaceRef.current?.focus(); }, [selectedId]);
  const selected = pending.find(item => item.id === selectedId) ?? pending[0];
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [shortcuts, setShortcuts] = useState(true);
  const [previous,setPrevious]=useState<AdminSubmission|null>(null);
  const actionRef = useRef<(action: "approve" | "reject") => void>(() => {});

  const decide = async (action: "approve" | "reject") => {
    if (!selected || busy || previous) return;
    await (action === "approve" ? onApprove : onReject)(selected.id, notes[selected.id]?.trim() || undefined);
  };
  actionRef.current = action => { void decide(action); };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!shortcuts) return;
      const target = event.target as HTMLElement;
      if (event.ctrlKey || event.metaKey || event.altKey || target.closest("input,textarea,select,[contenteditable=true],dialog")) return;
      if (event.key.toLowerCase() === "a" || event.key.toLowerCase() === "r") {
        event.preventDefault(); actionRef.current(event.key.toLowerCase() === "a" ? "approve" : "reject");
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [shortcuts]);

  return <section className="race-review">
    <PageHeading eyebrow="RACE CONTROL / PROOF DESK" title="Make the call.">Review the oldest submission first. New submissions join the bottom of the queue.</PageHeading>
    <div className="host-view-summary"><span><b>{String(pending.length).padStart(2, "0")}</b> awaiting review</span><span><b>{String(history.length).padStart(2, "0")}</b> reviewed</span><span className="review-shortcuts"><Keyboard size={15} aria-hidden="true" /><button type="button" aria-pressed={shortcuts} onClick={() => setShortcuts(value => !value)}>{shortcuts ? "A approve / R reject: On" : "Keyboard shortcuts: Off"}</button></span></div>
    {!selected ? <div className="race-empty"><Inbox size={34} aria-hidden="true" /><h3>All caught up.</h3><p>New proof will appear here as teams submit. Keep the race moving from the Board.</p></div> : <div className="review-layout">
      <aside className="review-inbox" aria-label="Pending submissions"><p className="race-eyebrow">INCOMING PROOF</p><ol>{pending.map((item, index) => <li key={item.id}><button type="button" disabled={busy} className={item.id === selected.id ? "review-inbox-item review-inbox-item--selected" : "review-inbox-item"} onClick={() => onSelect(item.id)} aria-pressed={item.id === selected.id}>
        <span className="review-inbox-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{item.teams?.name ?? "Team"}</strong><span>{item.challenges?.title ?? "Challenge"}</span></span><ArrowRight size={14} aria-hidden="true" /></button></li>)}</ol></aside>
      <article ref={workspaceRef} tabIndex={-1} className="review-workspace" aria-label="Selected submission">
        <SubmissionEvidenceView key={selected.id} submission={selected}/>
        <div className="review-decision"><SubmissionStatusBadge status="pending" /><p className="race-eyebrow">{selected.teams?.name ?? "Team"}</p><h3>{selected.challenges?.title ?? "Challenge"}</h3><p className="review-decision-help">Approve valid proof to award the challenge and unlock its clue. Reject it to let the team try again.</p>
          <label htmlFor="review-note">Note for the team <span>(optional)</span></label><textarea id="review-note" className="field" disabled={busy} rows={4} maxLength={280} value={notes[selected.id] ?? ""} onChange={event => setNotes(current => ({ ...current, [selected.id]: event.target.value }))} placeholder="What did you see?" />
          <div className="review-decision-buttons" aria-busy={busy}><button type="button" className="btn-success" disabled={busy} onClick={() => void decide("approve")}><Check size={18} aria-hidden="true" />Approve <kbd>A</kbd></button><button type="button" className="btn-danger" disabled={busy} onClick={() => void decide("reject")}><X size={18} aria-hidden="true" />Reject <kbd>R</kbd></button></div>
          {busy?<p role="status">Saving decision…</p>:null}
          <p className="review-stakes"><LockKeyhole size={13} aria-hidden="true" />First approved proof wins. Rival pending proofs are rejected automatically.</p>
        </div>
      </article>
    </div>}
    {history.length ? <section className="review-history"><div className="board-section-heading"><div><span className="race-section-index">02</span><h3>DECISION LOG</h3></div><span>{history.length} reviewed</span></div><ul>{history.map(item => <li key={item.id}><span><strong>{item.teams?.name ?? "Team"}</strong><span>{item.challenges?.title ?? "Challenge"}</span></span><SubmissionStatusBadge status={item.status} /><button type="button" className="btn-secondary" onClick={()=>setPrevious(item)}>View / download proof</button>{item.review_note ? <p>{item.review_note}</p> : null}</li>)}</ul></section> : null}
    {previous?<RaceDialog title="Previous submission" onClose={()=>setPrevious(null)}><p>{previous.teams?.name??"Team"} / {previous.challenges?.title??"Challenge"}</p><SubmissionStatusBadge status={previous.status}/><SubmissionEvidenceView submission={previous}/></RaceDialog>:null}
  </section>;
}

export function CodesTab({ teams }: { teams: AdminTeam[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(code); setCopied(code); setCopyError(false); window.setTimeout(() => setCopied(null), 2000); }
    catch { setCopyError(true); }
  };
  return <section className="race-codes"><PageHeading eyebrow="RACE CONTROL / TEAM PASSES" title="Get your teams moving.">One pass per team. Everyone uses the same code to join or return to the shared team.</PageHeading>
    <div className="host-view-summary"><span><b>{String(teams.length).padStart(2, "0")}</b> team passes</span><span><Ticket size={16} aria-hidden="true" />Share only with the right team</span></div>
    <p className="sr-only" role="status">{copied ? "Code copied." : ""}</p>{copyError ? <p role="alert" className="connection-notice">Copy is unavailable. Select the code text or read it to your team.</p> : null}
    {!teams.length ? <div className="race-empty"><Ticket size={32} aria-hidden="true" /><h3>No team passes yet.</h3><p>Team codes appear when a game session has teams ready to join.</p></div> : <ul className="team-pass-grid">{teams.map((team, index) => <li key={team.id} className="team-pass"><div className="team-pass-header"><Ticket size={18} aria-hidden="true" /><span>TEAM PASS</span><b>{String(index + 1).padStart(2, "0")}</b></div><div className="team-pass-title"><h3>{team.name}</h3></div>
      <button type="button" className="team-pass-code" aria-label={`Copy join code ${team.join_code} for ${team.name}`} onClick={() => void copy(team.join_code)}><span>JOIN CODE</span>{" "}<strong>{team.join_code}</strong>{copied === team.join_code ? <Check size={20} aria-hidden="true" /> : <Copy size={20} aria-hidden="true" />}</button>
      <p className="team-pass-copy-hint">{copied === team.join_code ? "Copied. Ready to share." : "Tap to copy the team code"}</p><p className="team-pass-waiting">Use this code to join or rejoin your team on any device.</p>
    </li>)}</ul>}
  </section>;
}

export function CluesTab({ sessionId, onError }: { sessionId: string; onError: (message: string) => void }) {
  const [clues, setClues] = useState<Clue[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const fail = useRef(onError); fail.current = onError;
  useEffect(() => {
    let cancelled = false; setLoading(true); setFailed(false);
    listClues(sessionId).then(rows => { if (!cancelled) setClues(rows); }).catch(error => {
      if (!cancelled) { setFailed(true); fail.current(error instanceof ApiError ? error.message : "could not load clues"); }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId, retry]);
  return <section className="race-clue-pack"><PageHeading eyebrow="RACE CONTROL / SEALED INTELLIGENCE" title="The clue pack.">The permanent clue catalog shared by every game. Teams unlock clues through approved challenges.</PageHeading>
    {loading ? <div className="race-empty" role="status"><LoaderCircle className="race-spinner" size={28} aria-hidden="true" /><h3>Opening the clue pack...</h3></div> : failed ? <div className="race-empty"><Mail size={30} aria-hidden="true" /><h3>The pack could not be loaded.</h3><button type="button" className="btn-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : !clues.length ? <div className="race-empty"><Mail size={32} aria-hidden="true" /><h3>No clues ready yet.</h3><p>The shared clue catalog is empty. Contact the game administrator to restore it.</p></div> : <div className="host-clue-tiers">{(["tier1", "tier2", "tier3"] as Tier[]).map(tier => <section key={tier}><div className="host-clue-tier-header"><TierBadge tier={tier} /><span>{clues.filter(clue => clue.tier === tier).length} clues</span></div><ul>{clues.filter(clue => clue.tier === tier).map(clue => <li key={clue.id} className="host-clue-envelope"><Mail size={20} aria-hidden="true" /><div><h3>{clue.title}</h3><p>{clue.body}</p>{clue.media_url ? <a href={clue.media_url} target="_blank" rel="noreferrer">Open reference <ExternalLink size={13} aria-hidden="true" /></a> : null}</div></li>)}</ul></section>)}</div>}
  </section>;
}

export function ProgressTab({ state }: { state: AdminState }) {
  const [table, setTable] = useState(false);
  const rows = [...state.progress].sort((a, b) => b.clue_count - a.clue_count || a.team_name.localeCompare(b.team_name));
  const counts: Record<string, TierCounts> = {};
  // Legacy fallback only; current snapshots provide complete inventory counts.
  for (const challenge of [...state.board, ...state.queue]) {
    if (challenge.status === "claimed" && challenge.claimed_by_team_id) {
      (counts[challenge.claimed_by_team_id] ??= emptyTierCounts())[challenge.clue_tier]++;
    }
  }
  for (const row of rows) {
    if (row.clue_tier_counts) counts[row.team_id] = row.clue_tier_counts;
  }
  const codes = Object.fromEntries(state.teams.map(team => [team.id, team.join_code]));
  return <section className="race-progress"><PageHeading eyebrow="RACE CONTROL / THE FIELD" title="Follow the field.">Every clue adds to the collection. See what each team has earned.</PageHeading>
    <div className="host-view-summary"><span><b>{String(rows.length).padStart(2, "0")}</b> teams racing</span><span><b>{String(rows.reduce((sum, row) => sum + row.claimed_count, 0)).padStart(2, "0")}</b> challenges secured</span>
      <button className="btn-secondary progress-view-toggle" type="button" aria-pressed={table} onClick={() => setTable(value => !value)}>Table view</button></div>
    {!rows.length ? <NoTeams /> : table ? <div className="team-progress-table-wrap"><table className="team-progress-table"><caption className="sr-only">Team progress details</caption><thead><tr><th scope="col">Team</th><th scope="col">Join code</th><th scope="col">Clues</th><th scope="col">Challenges secured</th></tr></thead><tbody>{rows.map(row => <tr key={row.team_id}><th scope="row">{row.team_name}</th><td><code>{codes[row.team_id]}</code></td><td>{row.clue_count}</td><td>{row.claimed_count}</td></tr>)}</tbody></table></div>
      : <TeamProgressCards rows={rows} counts={counts} codes={codes} host />}
  </section>;
}
