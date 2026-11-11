import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Copy, ExternalLink, Flag, ImageOff, Inbox, Keyboard, LoaderCircle, LockKeyhole, Mail, MapPin, RefreshCw, Route, Ticket, Users, X } from "lucide-react";
import { ApiError, listClues, submissionPhoto } from "../lib/api";
import type { AdminState, AdminSubmission, AdminTeam, Clue, Tier } from "../lib/types";
import { SubmissionStatusBadge, TierBadge } from "./Badges";

function PageHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <div className="race-page-heading"><p className="race-eyebrow"><Route size={14} aria-hidden="true" />{eyebrow}</p><h2>{title}</h2><p>{children}</p></div>;
}

export function ReviewTab({ submissions, onApprove, onReject }: {
  submissions: AdminSubmission[];
  onApprove: (id: string, note?: string) => void | Promise<void>;
  onReject: (id: string, note?: string) => void | Promise<void>;
}) {
  const pending = submissions.filter(item => item.status === "pending");
  const history = submissions.filter(item => item.status !== "pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = pending.find(item => item.id === selectedId) ?? pending[0];
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [shortcuts, setShortcuts] = useState(true);
  const actionRef = useRef<(action: "approve" | "reject") => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    setPhoto(null); setPhotoError(false);
    if (selected) submissionPhoto(selected.id).then(result => { if (!cancelled) setPhoto(result.url); })
      .catch(() => { if (!cancelled) setPhotoError(true); });
    return () => { cancelled = true; };
  }, [selected?.id, reload]);

  const decide = async (action: "approve" | "reject") => {
    if (!selected || busy) return;
    setBusy(true);
    try { await (action === "approve" ? onApprove : onReject)(selected.id, notes[selected.id]?.trim() || undefined); }
    finally { setBusy(false); }
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
    <PageHeading eyebrow="RACE CONTROL / PROOF DESK" title="Make the call.">A clear proof, a quick decision, a new clue for the team.</PageHeading>
    <div className="host-view-summary"><span><b>{String(pending.length).padStart(2, "0")}</b> awaiting review</span><span><b>{String(history.length).padStart(2, "0")}</b> reviewed</span><span className="review-shortcuts"><Keyboard size={15} aria-hidden="true" /><button type="button" aria-pressed={shortcuts} onClick={() => setShortcuts(value => !value)}>{shortcuts ? "A approve / R reject: On" : "Keyboard shortcuts: Off"}</button></span></div>
    {!selected ? <div className="race-empty"><Inbox size={34} aria-hidden="true" /><h3>All caught up.</h3><p>New proof will appear here as teams submit. Keep the race moving from the Board.</p></div> : <div className="review-layout">
      <aside className="review-inbox" aria-label="Pending submissions"><p className="race-eyebrow">INCOMING PROOF</p><ol>{pending.map((item, index) => <li key={item.id}><button type="button" className={item.id === selected.id ? "review-inbox-item review-inbox-item--selected" : "review-inbox-item"} onClick={() => setSelectedId(item.id)} aria-pressed={item.id === selected.id}>
        <span className="review-inbox-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{item.teams?.name ?? "Team"}</strong><span>{item.challenges?.title ?? "Challenge"}</span></span><ArrowRight size={14} aria-hidden="true" /></button></li>)}</ol></aside>
      <article className="review-workspace" aria-label="Selected submission">
        <div className="review-media">{photo && !photoError ? <a href={photo} target="_blank" rel="noreferrer" aria-label="Open full submission photo"><img src={photo} alt={`Proof from ${selected.teams?.name ?? "a team"} for ${selected.challenges?.title ?? "the challenge"}`} onError={() => setPhotoError(true)} /></a> : <div className="review-media-state">{photoError ? <ImageOff size={32} aria-hidden="true" /> : <LoaderCircle size={28} className="race-spinner" aria-hidden="true" />}<strong>{photoError ? "We could not load this photo." : "Loading proof..."}</strong>{photoError ? <button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}><RefreshCw size={15} aria-hidden="true" />Retry photo</button> : null}</div>}<span className="review-media-caption">SUBMISSION PHOTO <ExternalLink size={12} aria-hidden="true" /></span></div>
        <div className="review-decision"><SubmissionStatusBadge status="pending" /><p className="race-eyebrow">{selected.teams?.name ?? "Team"}{selected.team_members?.name ? ` / ${selected.team_members.name}` : ""}</p><h3>{selected.challenges?.title ?? "Challenge"}</h3><p className="review-decision-help">Approve valid proof to award the challenge and unlock its clue. Reject it to let the team try again.</p>
          <label htmlFor="review-note">Note for the team <span>(optional)</span></label><textarea id="review-note" className="field" rows={4} maxLength={280} value={notes[selected.id] ?? ""} onChange={event => setNotes(current => ({ ...current, [selected.id]: event.target.value }))} placeholder="What did you see?" />
          <div className="review-decision-buttons"><button type="button" className="btn-success" disabled={busy} onClick={() => void decide("approve")}><Check size={18} aria-hidden="true" />Approve <kbd>A</kbd></button><button type="button" className="btn-danger" disabled={busy} onClick={() => void decide("reject")}><X size={18} aria-hidden="true" />Reject <kbd>R</kbd></button></div>
          <p className="review-stakes"><LockKeyhole size={13} aria-hidden="true" />First approved proof wins. Rival pending proofs are rejected automatically.</p>
        </div>
      </article>
    </div>}
    {history.length ? <section className="review-history"><div className="board-section-heading"><div><span className="race-section-index">02</span><h3>DECISION LOG</h3></div><span>{history.length} reviewed</span></div><ul>{history.map(item => <li key={item.id}><span><strong>{item.teams?.name ?? "Team"}</strong><span>{item.challenges?.title ?? "Challenge"}</span></span><SubmissionStatusBadge status={item.status} />{item.review_note ? <p>{item.review_note}</p> : null}</li>)}</ul></section> : null}
  </section>;
}

export function CodesTab({ teams, onRemove }: { teams: AdminTeam[]; onRemove: (memberId: string) => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(code); setCopied(code); setCopyError(false); window.setTimeout(() => setCopied(null), 2000); }
    catch { setCopyError(true); }
  };
  const members = teams.reduce((total, team) => total + team.members.length, 0);
  return <section className="race-codes"><PageHeading eyebrow="RACE CONTROL / TEAM PASSES" title="Get your teams moving.">One pass per team. Every player uses the same code and joins with their own name.</PageHeading>
    <div className="host-view-summary"><span><b>{String(teams.length).padStart(2, "0")}</b> team passes</span><span><b>{String(members).padStart(2, "0")}</b> players checked in</span><span><Ticket size={16} aria-hidden="true" />Share only with the right team</span></div>
    <p className="sr-only" role="status">{copied ? "Code copied." : ""}</p>{copyError ? <p role="alert" className="connection-notice">Copy is unavailable. Select the code text or read it to your team.</p> : null}
    {!teams.length ? <div className="race-empty"><Ticket size={32} aria-hidden="true" /><h3>No team passes yet.</h3><p>Team codes appear when a game session has teams ready to join.</p></div> : <ul className="team-pass-grid">{teams.map((team, index) => <li key={team.id} className="team-pass"><div className="team-pass-header"><Ticket size={18} aria-hidden="true" /><span>TEAM PASS</span><b>{String(index + 1).padStart(2, "0")}</b></div><div className="team-pass-title"><h3>{team.name}</h3><span><Users size={14} aria-hidden="true" />{team.members.length} checked in</span></div>
      <button type="button" className="team-pass-code" aria-label={`Copy join code ${team.join_code} for ${team.name}`} onClick={() => void copy(team.join_code)}><span>JOIN CODE</span>{" "}<strong>{team.join_code}</strong>{copied === team.join_code ? <Check size={20} aria-hidden="true" /> : <Copy size={20} aria-hidden="true" />}</button>
      <p className="team-pass-copy-hint">{copied === team.join_code ? "Copied. Ready to share." : "Tap to copy the team code"}</p><div className="team-pass-members"><p className="race-eyebrow">CHECKED-IN PLAYERS</p>{team.members.length ? <ul>{team.members.map(member => <li key={member.id}><span>{member.name}</span><button type="button" className="race-icon-button" aria-label={`Remove ${member.name} from ${team.name}`} onClick={() => onRemove(member.id)}><X size={15} aria-hidden="true" /></button></li>)}</ul> : <p className="team-pass-waiting">Waiting for the first player to join.</p>}</div>
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
  return <section className="race-clue-pack"><PageHeading eyebrow="RACE CONTROL / SEALED INTELLIGENCE" title="The clue pack.">This session's preloaded clues. Teams unlock them through approved challenges.</PageHeading>
    {loading ? <div className="race-empty" role="status"><LoaderCircle className="race-spinner" size={28} aria-hidden="true" /><h3>Opening the clue pack...</h3></div> : failed ? <div className="race-empty"><Mail size={30} aria-hidden="true" /><h3>The pack could not be loaded.</h3><button type="button" className="btn-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : !clues.length ? <div className="race-empty"><Mail size={32} aria-hidden="true" /><h3>No clues ready yet.</h3><p>This session does not have a clue pack loaded. Clues will appear here once the pack is available.</p></div> : <div className="host-clue-tiers">{(["tier1", "tier2", "tier3"] as Tier[]).map(tier => <section key={tier}><div className="host-clue-tier-header"><TierBadge tier={tier} /><span>{clues.filter(clue => clue.tier === tier).length} clues</span></div><ul>{clues.filter(clue => clue.tier === tier).map(clue => <li key={clue.id} className="host-clue-envelope"><Mail size={20} aria-hidden="true" /><div><h3>{clue.title}</h3><p>{clue.body}</p>{clue.media_url ? <a href={clue.media_url} target="_blank" rel="noreferrer">Open reference <ExternalLink size={13} aria-hidden="true" /></a> : null}</div></li>)}</ul></section>)}</div>}
  </section>;
}

export function ProgressTab({ state }: { state: AdminState }) {
  const rows = [...state.progress].sort((a, b) => b.clue_count - a.clue_count || a.team_name.localeCompare(b.team_name));
  const maximum = Math.max(3, ...rows.map(row => row.clue_count));
  return <section className="race-progress"><PageHeading eyebrow="RACE CONTROL / THE FIELD" title="Follow the field.">Track the clues each team has earned and the challenges they have secured.</PageHeading>
    <div className="host-view-summary"><span><b>{String(rows.length).padStart(2, "0")}</b> teams racing</span><span><b>{String(rows.reduce((sum, row) => sum + row.claimed_count, 0)).padStart(2, "0")}</b> challenges secured</span><span><MapPin size={15} aria-hidden="true" />Clue progress; physical locations are not tracked</span></div>
    {!rows.length ? <div className="race-empty"><Flag size={30} aria-hidden="true" /><h3>The field is getting ready.</h3><p>Team progress will appear as the session gets under way.</p></div> : <ol className="race-progress-list">{rows.map((row, index) => <li key={row.team_id}><div className="progress-team"><span className="progress-rank">{String(index + 1).padStart(2, "0")}</span><div><h3>{row.team_name}</h3><span>{row.member_count} players / {row.claimed_count} challenges secured</span></div></div><div className="progress-route" aria-hidden="true"><span className="progress-route-start" /><span className="progress-route-line" /><span className="progress-route-marker" style={{ left: `${row.clue_count / maximum * 100}%` }}><Flag size={16} /></span></div><div className="progress-clues"><strong>{String(row.clue_count).padStart(2, "0")}</strong><span>CLUES UNLOCKED</span></div></li>)}</ol>}
  </section>;
}
