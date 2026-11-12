import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleHelp, Flag, LayoutGrid, LoaderCircle, LogOut, MoreHorizontal, RefreshCw, Ticket, Users, WifiOff } from "lucide-react";
import { RaceDialog } from "../components/RaceDialog";
import { CardTable } from "../components/CardTable";
import { ClueEnvelope } from "../components/ClueEnvelope";
import { ClueNotifications } from "../components/ClueNotifications";
import type { ClueOutcome } from "../components/ClueNotifications";
import { createClueCursor, readClueUpdates } from "../lib/clueNotifications";

import {
  TierBadge,
} from "../components/Badges";
import {
  ApiError,
  fetchTeamState,
  getTeamToken,
  submitProof,
  teamSocketUrl,
} from "../lib/api";
import { TIER_LABEL } from "../lib/types";
import type { ClueAward, TeamState, Tier } from "../lib/types";
import { useLiveSocket } from "../lib/useLive";

const TIERS: Tier[] = ["tier1", "tier2", "tier3"];

interface Props {
  initialState: TeamState;
  onLeave: () => void;
}

export default function TeamDashboard({ initialState, onLeave }: Props) {
  const [helpOpen, setHelpOpen] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const token = getTeamToken();
  const [state, setState] = useState<TeamState>(initialState);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"board" | "clues" | "teams">("board");
  const revealVersion = useRef(initialState.session.board_reveal_version);
  const notificationCursor = useRef(createClueCursor(initialState));
  const [outcomes, setOutcomes] = useState<ClueOutcome[]>([]);
  const [announcements, setAnnouncements] = useState<ClueAward[]>([]);
  const dismissOutcome = useCallback((id: string) => {
    setOutcomes(items => items.filter(item => item.id !== id));
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) menu.current?.querySelector("summary")?.focus();
    });
  }, []);
  const dismissAnnouncement = useCallback((id: string) => setAnnouncements(items => items.filter(item => item.id !== id)), []);
  const viewReward = useCallback((view: "board" | "clues") => {
    setMobileTab(view);
    if (view === "clues") requestAnimationFrame(() => document.getElementById("player-clues-heading")?.focus());
  }, []);

  const applySnapshot = (snapshot: TeamState) => {
    const switched = notificationCursor.current.sessionId !== snapshot.session.id || notificationCursor.current.teamId !== snapshot.team.id;
    const updates = readClueUpdates(notificationCursor.current, snapshot);
    notificationCursor.current = updates.cursor;
    if (switched) { setOutcomes([]); setAnnouncements([]); }
    const fresh: ClueOutcome[] = [
      ...updates.clues.map(clue => ({ id: `clue:${clue.id}`, kind: "success" as const, clue })),
      ...updates.rejections.map(submission => ({ id: `rejected:${submission.id}`, kind: "rejected" as const, submission,
        challengeTitle: snapshot.board.find(card => card.id === submission.challenge_id)?.title
          ?? state.board.find(card => card.id === submission.challenge_id)?.title ?? "Your submission" })),
    ];
    if (fresh.length) setOutcomes(items => [...items, ...fresh]);
    if (updates.awards.length) setAnnouncements(items => [...items, ...updates.awards]);
    // Bring connected phone users to the table for a new host reveal.
    if (snapshot.session.board_visible && snapshot.session.board_reveal_version !== revealVersion.current) {
      setMobileTab("board");
    }
    revealVersion.current = snapshot.session.board_reveal_version;
    setState(snapshot);
  };

  const status = useLiveSocket<TeamState>(
    token ? teamSocketUrl(token) : null,
    (snapshot) => {
      if (snapshot.kind === "team") applySnapshot(snapshot);
    },
  );

  const cluesByTier = useMemo(() => {
    const map: Record<Tier, TeamState["clues"]> = {
      tier1: [],
      tier2: [],
      tier3: [],
    };
    for (const clue of state.clues) map[clue.tier].push(clue);
    return map;
  }, [state.clues]);

  const ranked = useMemo(
    () =>
      [...state.progress].sort(
        (a, b) =>
          b.clue_count - a.clue_count || a.team_name.localeCompare(b.team_name),
      ),
    [state.progress],
  );

  const upload = async (challengeId: string, file: File | undefined) => {
    if (!file) return;
    setBusyId(challengeId);
    setError(null);
    try {
      await submitProof(challengeId, file);
      const fresh = await fetchTeamState();
      applySnapshot(fresh);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "upload failed");
    } finally {
      setBusyId(null);
    }
  };

  const refresh = async () => {
    try {
      applySnapshot(await fetchTeamState());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not refresh");
    }
  };

  const leave = () => {
    if (window.confirm("Leave the game on this device?")) onLeave();
  };


  return (
    <div className={`race-player race-player--${mobileTab} min-h-screen pb-28 lg:pb-16`}>
      <header className="player-header">
        <div className="player-header-inner">
          <div className="min-w-0 flex-1">
            <h1>
              {state.session.name}
            </h1>
            <p className="player-identity">
              {state.team.name} · {" "}
              <span className="font-semibold">
                {state.me.name}
              </span>
            </p>
          </div>

          <span className="player-live" role="status">
            {status === "live" ? <span className="live-dot" aria-hidden="true" /> : status === "offline" ? <WifiOff size={16} aria-hidden="true" /> : <LoaderCircle size={16} aria-hidden="true" className="race-spinner" />}
            <span>{status === "live" ? "Live" : status === "offline" ? "Offline" : "Connecting"}</span>
          </span>
          <details className="player-menu" ref={menu}
            onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false; }}
            onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
            <summary aria-label="Game menu"><MoreHorizontal size={24} aria-hidden="true" /></summary>
            <div className="player-menu-panel">
              <button type="button" onClick={() => { menu.current!.open = false; void refresh(); }}><RefreshCw size={18} aria-hidden="true" />Refresh game</button>
              <button type="button" onClick={() => { menu.current!.open = false; setHelpOpen(true); }}><CircleHelp size={18} aria-hidden="true" />Help</button>
              <button type="button" onClick={() => { menu.current!.open = false; leave(); }}><LogOut size={18} aria-hidden="true" />Leave</button>
            </div>
          </details>
        </div>
      </header>


      <main tabIndex={mobileTab === "board" ? undefined : 0} className="player-main mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
        {state.session.status === "lobby" ? (
          <p className="mb-6 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700">
            You&apos;re in. Waiting for the host to start the hunt — challenges
            will appear here automatically.
          </p>
        ) : null}

        {state.session.status === "ended" ? (
          <p className="mb-6 rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
            This game has ended. Thanks for playing.
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800"
          >
            {error}
          </p>
        ) : null}

        <div className="player-layout grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className={mobileTab === "board" ? "player-board-panel min-w-0" : "player-board-panel hidden min-w-0 lg:block"}>
            <CardTable
              board={state.board}
              session={state.session}
              busy={busyId !== null}
              error={error}
              reviewNoticeId={outcomes[0]?.id}
              onUpload={(id, file) => void upload(id, file)}
            />
          </div>

          <aside className={mobileTab === "board" ? "hidden space-y-6 lg:block" : "space-y-6"}>
            <section className={mobileTab === "clues" ? "player-clues" : "player-clues hidden lg:block"}>
              <h2 id="player-clues-heading" tabIndex={-1} className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
                Your clues
              </h2>
              <div className="space-y-3">
                {TIERS.map((tier) => (
                  <div key={tier} className="card clue-ticket p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <TierBadge tier={tier} />
                    </div>
                    {cluesByTier[tier].length === 0 ? (
                      <p className="text-base text-slate-600">
                        Locked — complete a {TIER_LABEL[tier]} challenge.
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {cluesByTier[tier].map((clue) => (
                          <li key={clue.id}>
                            <p className="text-base font-bold text-slate-900">
                              {clue.title}
                            </p>
                            <p className="mt-0.5 whitespace-pre-wrap text-base leading-relaxed text-slate-700">
                              {clue.body}
                            </p>
                            {clue.media_url ? (
                              <a
                                href={clue.media_url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-block text-base font-semibold text-brand-700 hover:underline"
                              >
                                Open reference →
                              </a>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className={mobileTab === "teams" ? "" : "hidden lg:block"}>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
                Team progress
              </h2>
              <ul className="card race-team-list">
                {ranked.map((team) => {
                  const mine = team.team_id === state.team.id;
                  const maxClues = Math.max(1, ...ranked.map(entry => entry.clue_count));
                  return (
                    <li key={team.team_id} className={`race-team-row ${mine ? "race-team-row--mine" : ""}`}>
                      <div className="race-team-label">
                        <strong>{team.team_name}</strong>
                        {mine ? <span className="you-stamp">YOU</span> : null}
                        <span className="race-member-count"><Users size={14} aria-hidden="true" /> {team.member_count} players</span>
                      </div>
                      {mine ? <div className="team-inventory-envelopes">{TIERS.map(tier => <ClueEnvelope key={tier} tier={tier} count={cluesByTier[tier].length} />)}</div> : null}
                      <div className="race-track" aria-hidden="true">
                        <div className="race-track-fill" style={{ width: `${team.clue_count / maxClues * 100}%` }}><span><Flag size={12} /></span></div>
                      </div>
                      <p className="race-track-count">{team.clue_count} {team.clue_count === 1 ? "clue" : "clues"} unlocked</p>
                    </li>
                  );
                })}
              </ul>
            </section>
          </aside>
        </div>
      </main>
      <nav className="player-mobile-nav" aria-label="Game views">
        <button type="button" aria-current={mobileTab === "board" ? "page" : undefined} onClick={() => setMobileTab("board")}><LayoutGrid size={20} aria-hidden="true" />The board</button>
        <button type="button" aria-current={mobileTab === "clues" ? "page" : undefined} onClick={() => setMobileTab("clues")}><Ticket size={20} aria-hidden="true" /><span>Your clues <b className="nav-count">{state.clues.length}</b></span></button>
        <button type="button" aria-current={mobileTab === "teams" ? "page" : undefined} onClick={() => setMobileTab("teams")}><Users size={20} aria-hidden="true" />Teams</button>
      </nav>
      <ClueNotifications outcome={outcomes[0]} announcements={announcements} onDismissOutcome={dismissOutcome}
        onDismissAnnouncement={dismissAnnouncement} onView={viewReward} />
      {helpOpen ? <RaceDialog title="How to play" eyebrow="RACE CONTROL / FIELD GUIDE" onClose={() => setHelpOpen(false)}>
        <p>Find it. Prove it. Unlock it. Tap a challenge card for its full instructions, then submit your photo proof.</p>
        <p>Choose a challenge and submit photo proof. Challenges stay open to every team until the host approves a submission. The first approved team wins that challenge’s clue.</p>
        <p>Challenges reward Tier I, II or III clues. Find your unlocked clues in Your clues.</p>
        <p>You can head to the final location whenever you’re ready. Use Refresh game if you need the latest snapshot.</p>
      </RaceDialog> : null}
    </div>
  );
}
