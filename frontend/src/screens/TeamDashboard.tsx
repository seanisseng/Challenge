import { PlayingArea } from "../components/PlayingArea";
import {LocationSharingPrompt} from '../components/LocationSharingPrompt';
import { useLocationSharing } from "../lib/useLocationSharing";
import { applyMapEvent,mergeMapSnapshot } from "../lib/gameMap";
import type { MapEvent } from "../lib/gameMap";
import "../game-map.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleHelp, LayoutGrid, LoaderCircle, LogOut, MoreHorizontal, MapPinned, Pencil, RefreshCw, Ticket, Users, WifiOff } from "lucide-react";
import { TeamNameDialog } from "../components/TeamNameDialog";
import { RaceDialog } from "../components/RaceDialog";
import { CardTable } from "../components/CardTable";
import { TeamProgressCards, NoTeams, emptyTierCounts, type TierCounts } from "../components/TeamProgressCards";
import { ClueNotifications } from "../components/ClueNotifications";
import type { ClueOutcome } from "../components/ClueNotifications";
import { createClueCursor, readClueUpdates } from "../lib/clueNotifications";
import {createShrinkCursor,readShrinkUpdate} from '../lib/shrinkNotifications';
import type {ShrinkNotice} from '../lib/shrinkNotifications';

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
  freshJoin?:boolean;
  onLeave: () => void;
}

export default function TeamDashboard({ initialState, onLeave,freshJoin=false }: Props) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
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
  const [mobileTab, setMobileTab] = useState<"board" | "clues" | "teams" | "map">("board");
  const sharing=useLocationSharing(state.session.id,state.session.status==="active");
  useEffect(()=>{if(sharing.status==='off')setState(current=>current.map?{...current,map:{...current.map,can_track_teams:false,locations:current.map.locations.filter(point=>point.team_id===current.team.id)}}:current);},[sharing.status]);
  const revealVersion = useRef(initialState.session.board_reveal_version);
  const notificationCursor = useRef(createClueCursor(initialState));
  const shrinkCursor=useRef(createShrinkCursor(initialState));
  const [shrinkNotice,setShrinkNotice]=useState<ShrinkNotice|null>(null);
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
    const previousShrink=shrinkCursor.current;
    const shrink=readShrinkUpdate(shrinkCursor.current,snapshot);
    shrinkCursor.current=shrink.cursor;
    if(snapshot.session.status!=='active'||(shrink.cursor.radius!==null&&previousShrink.radius!==null&&shrink.cursor.radius>previousShrink.radius))setShrinkNotice(null);
    else if(shrink.notice)setShrinkNotice(shrink.notice);
    const switched = notificationCursor.current.sessionId !== snapshot.session.id || notificationCursor.current.teamId !== snapshot.team.id;
    const updates = readClueUpdates(notificationCursor.current, snapshot);
    notificationCursor.current = updates.cursor;
    if (switched) { setOutcomes([]); setAnnouncements([]);setShrinkNotice(null); }
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
    setState(current=>({...snapshot,map:current.session.id===snapshot.session.id?mergeMapSnapshot(current.map,snapshot.map):snapshot.map}));
  };

  const status = useLiveSocket<TeamState | MapEvent>(
    token ? teamSocketUrl(token,sharing.access) : null,
    (snapshot) => {
      if (snapshot.kind === "team") applySnapshot(snapshot);
      else setState(current=> snapshot.session_id===current.session.id && (current.session.status==='active'||snapshot.kind==='location_removed'||snapshot.kind==='map_access') ? {...current,map:applyMapEvent(current.map,snapshot,current.team.id)} : current);
    },
    onLeave,
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

  // Use only tier metadata already present in the snapshot; own clues are authoritative.
  const teamTierCounts = useMemo(() => {
    const counts: Record<string, TierCounts> = {};
    const seen = new Set<string>();
    for (const award of state.clue_awards ?? []) {
      if (seen.has(award.id)) continue;
      seen.add(award.id);
      (counts[award.team_id] ??= emptyTierCounts())[award.tier]++;
    }
    for (const row of state.progress) {
      if (row.clue_tier_counts) counts[row.team_id] = row.clue_tier_counts;
    }
    counts[state.team.id] = { tier1: cluesByTier.tier1.length, tier2: cluesByTier.tier2.length, tier3: cluesByTier.tier3.length };
    return counts;
  }, [state.clue_awards, state.progress, state.team.id, cluesByTier]);

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
    if (window.confirm("Leave the game on this device?")) void sharing.stop().finally(onLeave);
  };


  return (
    <div className={`race-player race-player--${mobileTab} min-h-screen pb-28 lg:pb-16`}>
      <header className="player-header">
        <div className="player-header-inner">
          <div className="min-w-0 flex-1">
            <h1>
              {state.session.name}
            </h1>
            <p className="player-identity">{state.team.name}</p>
          </div>

          <button type="button" className="player-map-shortcut" aria-pressed={mobileTab==='map'} onClick={()=>setMobileTab(mobileTab==='map'?'board':'map')}><MapPinned size={20} aria-hidden="true"/>{mobileTab==='map'?'Back to board':'Map'}</button>
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
              <button type="button" onClick={() => { menu.current!.open = false; setNameOpen(true); }}><Pencil size={18} aria-hidden="true" />Change team name</button>
              <button type="button" onClick={() => { menu.current!.open = false; setHelpOpen(true); }}><CircleHelp size={18} aria-hidden="true" />Help</button>
              <button type="button" onClick={() => { menu.current!.open = false; leave(); }}><LogOut size={18} aria-hidden="true" />Leave</button>
            </div>
          </details>
        </div>
      </header>


      <main tabIndex={mobileTab === "board" ? undefined : 0} className={`player-main mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6 ${mobileTab==='map'?'player-main--map':''}`}>
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

        <div className={`player-layout grid gap-6 ${mobileTab==='map'?'player-layout--map':'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'}`}>
          {mobileTab==='map'?<PlayingArea data={state.map} status={state.session.status} sharing={sharing} teamId={state.team.id} teamNames={Object.fromEntries(state.progress.map(team=>[team.team_id,team.team_name]))}/>:null}
          <div className={mobileTab === "map" ? "hidden" : mobileTab === "board" ? "player-board-panel min-w-0" : "player-board-panel hidden min-w-0 lg:block"}>
            <CardTable
              board={state.board}
              session={state.session}
              busy={busyId !== null}
              error={error}
              reviewNoticeId={outcomes[0]?.id}
              onUpload={(id, file) => void upload(id, file)}
            />
          </div>

          <aside className={mobileTab === "map" ? "hidden" : mobileTab === "board" ? "hidden space-y-6 lg:block" : "space-y-6"}>
            <section className={mobileTab === "clues" ? "player-clues" : "player-clues hidden lg:block"}>
              <h2 id="player-clues-heading" tabIndex={-1} className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
                Your clues
              </h2>
              <div className="space-y-3">
                {TIERS.map((tier) => (
                  <div key={tier} className={`clue-tier-group ${cluesByTier[tier].length === 0 ? "clue-tier-group--locked" : ""}`}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <TierBadge tier={tier} />
                    </div>
                    {cluesByTier[tier].length === 0 ? (
                      <p className="text-base text-slate-600">
                        Locked — complete a {TIER_LABEL[tier]} challenge.
                      </p>
                    ) : (
                      <ul className="clue-slip-list">
                        {cluesByTier[tier].map((clue, index) => (
                          <li key={clue.id} className="clue-slip">
                            <article className="clue-slip-paper" aria-labelledby={`unlocked-clue-${clue.id}`}>
                              <div className="clue-slip-header"><span>UNLOCKED CLUE</span><span>{String(index + 1).padStart(2, "0")}</span></div>
                              <h3 id={`unlocked-clue-${clue.id}`}>{clue.title}</h3>
                              <p className="clue-slip-body">{clue.body}</p>
                              {clue.media_url ? (
                                <a href={clue.media_url} target="_blank" rel="noreferrer" className="clue-slip-reference">
                                  Open reference &rarr;
                                </a>
                              ) : null}
                            </article>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className={mobileTab === "teams" ? "player-team-progress" : "player-team-progress hidden lg:block"}>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
                Team progress
              </h2>
              {ranked.length ? <TeamProgressCards rows={ranked} ownTeamId={state.team.id} counts={teamTierCounts} /> : <NoTeams />}
            </section>
          </aside>
        </div>
      </main>
      <nav className="player-mobile-nav" aria-label="Game views">
        <button type="button" aria-current={mobileTab === "board" ? "page" : undefined} onClick={() => setMobileTab("board")}><LayoutGrid size={20} aria-hidden="true" />The board</button>
        <button type="button" aria-current={mobileTab === "clues" ? "page" : undefined} onClick={() => setMobileTab("clues")}><Ticket size={20} aria-hidden="true" /><span>Your clues <b className="nav-count">{state.clues.length}</b></span></button>
        <button type="button" aria-current={mobileTab === "teams" ? "page" : undefined} onClick={() => setMobileTab("teams")}><Users size={20} aria-hidden="true" />Teams</button>
        <button type="button" aria-current={mobileTab==='map'?'page':undefined} onClick={()=>setMobileTab('map')}><MapPinned size={20} aria-hidden="true"/>Map</button>
      </nav>
      <ClueNotifications outcome={outcomes[0]} announcements={announcements} onDismissOutcome={dismissOutcome}
        onDismissAnnouncement={dismissAnnouncement} onView={viewReward} />
      <LocationSharingPrompt key={`${state.session.id}:${state.team.id}`} sessionId={state.session.id} teamId={state.team.id} freshJoin={freshJoin}
        eligible={state.session.status==='active'&&Boolean(state.map?.configured)} deferred={Boolean(shrinkNotice)||helpOpen||nameOpen||Boolean(outcomes[0])} onShare={()=>{setMobileTab('map');sharing.start();}}/>
      {shrinkNotice&&!helpOpen&&!nameOpen&&!outcomes[0]?<RaceDialog title="The playing area has shrunk" eyebrow="PLAYING AREA UPDATE" onClose={()=>setShrinkNotice(null)} footer={<>
        <button type="button" className="btn-secondary" onClick={()=>setShrinkNotice(null)}>Got it</button>
        <button type="button" className="btn-primary" onClick={()=>{setShrinkNotice(null);setMobileTab('map');}}>View map</button>
      </>}>
        <p>Area {shrinkNotice.stage} is now active, with a {shrinkNotice.radius_m/1000} km radius.</p>
        <p>The final location is within the playing area. Open the map to check the updated area.</p>
      </RaceDialog>:null}
      {nameOpen ? <TeamNameDialog name={state.team.name} onClose={() => setNameOpen(false)} onSaved={() => { setNameOpen(false); void refresh(); }} /> : null}
      {helpOpen ? <RaceDialog title="How to play" eyebrow="RACE CONTROL / FIELD GUIDE" onClose={() => setHelpOpen(false)}>
        <p>Find it. Prove it. Unlock it. Tap a challenge card for its full instructions, then submit your photo proof.</p>
        <p>Choose a challenge and submit photo proof. Challenges stay open to every team until the host approves a submission. The first approved team wins that challenge’s clue.</p>
        <p>Challenges reward Tier I, II or III clues. Find your unlocked clues in Your clues.</p>
        <p>You can head to the final location whenever you’re ready. Use Refresh game if you need the latest snapshot.</p>
      </RaceDialog> : null}
    </div>
  );
}
