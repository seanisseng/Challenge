import { PlayingArea } from "../components/PlayingArea";
import {rankTeams} from '../lib/clueRanking';
import {mergeTeamGameUpdate} from '../lib/gameUpdates';
import type {TeamGameUpdate} from '../lib/gameUpdates';
import {LocationSharingPrompt} from '../components/LocationSharingPrompt';
import { useLocationSharing } from "../lib/useLocationSharing";
import { applyMapEvent,mergeMapSnapshot } from "../lib/gameMap";
import type { MapEvent } from "../lib/gameMap";
import "../game-map.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleHelp, LayoutGrid, LoaderCircle, LogOut, MoreHorizontal, MapPinned, Pencil, RefreshCw, Ticket, Users, WifiOff } from "lucide-react";
import { TeamNameDialog } from "../components/TeamNameDialog";
import {PlayerTeamCode} from '../components/PlayerTeamCode';
import { RaceDialog } from "../components/RaceDialog";
import { CardTable } from "../components/CardTable";
import { TeamProgressCards, TeamProgressSkeleton, NoTeams, emptyTierCounts, type TierCounts } from "../components/TeamProgressCards";
import { ClueNotifications } from "../components/ClueNotifications";
import type { ClueOutcome } from "../components/ClueNotifications";
import { createClueCursor, readClueUpdates } from "../lib/clueNotifications";
import {createShrinkCursor,readShrinkUpdate} from '../lib/shrinkNotifications';
import type {ShrinkNotice} from '../lib/shrinkNotifications';
import {draftError} from '../lib/submissionDraft';
import type {SubmissionDraft} from '../lib/submissionDraft';

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
  const currentState=useRef(initialState);currentState.current=state;
  const detailsReady=useRef(!initialState.loading_details);
  const gameRevision=useRef(0);
  const pendingMapEvents=useRef<MapEvent[]>([]);
  const [detailsError,setDetailsError]=useState(false);
  const [detailsAttempt,setDetailsAttempt]=useState(0);
  const detailsLoading=Boolean(state.loading_details);
  const [busyId, setBusyId] = useState<string | null>(null);
  const uploadController=useRef<AbortController|null>(null);
  const [uploadProgress,setUploadProgress]=useState(0);
  useEffect(()=>()=>uploadController.current?.abort(),[]);
  const [error, setError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"board" | "clues" | "teams" | "map">("board");
  const sharing=useLocationSharing(state.session.id,state.session.status==="active");
  const openMap=()=>setMobileTab('map');
  const canStartSharing=state.session.status==='active'&&Boolean(state.map?.configured);
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
    gameRevision.current++;
    if(!detailsReady.current){
      // The first full load is a baseline, not a batch of newly earned rewards.
      notificationCursor.current=createClueCursor(snapshot);
      shrinkCursor.current=createShrinkCursor(snapshot);
      if(!snapshot.loading_details){detailsReady.current=true;setDetailsError(false);}
    }else{
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
            ?? currentState.current.board.find(card => card.id === submission.challenge_id)?.title ?? "Your submission" })),
      ];
      if (fresh.length) setOutcomes(items => [...items, ...fresh]);
      if (updates.awards.length) setAnnouncements(items => [...items, ...updates.awards]);
    }
    // Bring connected phone users to the table for a new host reveal.
    if (snapshot.session.board_visible && snapshot.session.board_reveal_version !== revealVersion.current) {
      setMobileTab("board");
    }
    revealVersion.current = snapshot.session.board_reveal_version;
    let map=currentState.current.session.id===snapshot.session.id?mergeMapSnapshot(currentState.current.map,snapshot.map):snapshot.map;
    if(map&&pendingMapEvents.current.length){
      for(const event of pendingMapEvents.current)if(event.session_id===snapshot.session.id)map=applyMapEvent(map,event,snapshot.team.id);
      pendingMapEvents.current=[];
    }
    const next={...snapshot,map};currentState.current=next;
    setState(current=>({...next,map:current.session.id===snapshot.session.id?mergeMapSnapshot(current.map,next.map):next.map}));
  };
  const applyLatest=useRef(applySnapshot);applyLatest.current=applySnapshot;

  const status = useLiveSocket<TeamState | MapEvent | TeamGameUpdate>(
    token ? teamSocketUrl(token,sharing.access) : null,
    (snapshot) => {
      if (snapshot.kind === "team") applySnapshot(snapshot);
      else if(snapshot.kind==='team_update'){
        const merged=mergeTeamGameUpdate(currentState.current,snapshot);
        if(merged===currentState.current)return;
        applySnapshot(merged);
      }
      else{
        if(!currentState.current.map&&!detailsReady.current&&snapshot.session_id===currentState.current.session.id){
          pendingMapEvents.current=[...pendingMapEvents.current,snapshot].slice(-500);
        }
        setState(current=> snapshot.session_id===current.session.id && (current.session.status==='active'||snapshot.kind==='location_removed'||snapshot.kind==='map_access') ? {...current,map:applyMapEvent(current.map,snapshot,current.team.id)} : current);
      }
    },
    onLeave,
    signal=>fetchTeamState(token??undefined,{signal}),
    ()=>gameRevision.current,
  );

  useEffect(()=>{
    if(detailsReady.current)return;
    let cancelled=false;
    const controller=new AbortController(),revision=gameRevision.current;
    setDetailsError(false);
    const timeout=window.setTimeout(()=>controller.abort(),15_000);
    void fetchTeamState(token??undefined,{signal:controller.signal}).then(snapshot=>{
      if(cancelled||detailsReady.current)return;
      const current=currentState.current;
      if(snapshot.session.id!==current.session.id||snapshot.team.id!==current.team.id)return;
      // Live game updates are newer than an in-flight HTTP response. Only the
      // missing map should come from that response when game data has advanced.
      applyLatest.current(gameRevision.current===revision?snapshot:{...current,map:snapshot.map,loading_details:false});
    }).catch(error=>{
      if(cancelled||detailsReady.current)return;
      if(error instanceof ApiError&&error.status===401){onLeave();return;}
      setDetailsError(true);
    }).finally(()=>window.clearTimeout(timeout));
    return()=>{cancelled=true;controller.abort();window.clearTimeout(timeout);};
    // Message processing uses refs so live updates do not restart this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[token,detailsAttempt]);

  const cluesByTier = useMemo(() => {
    const map: Record<Tier, TeamState["clues"]> = {
      tier1: [],
      tier2: [],
      tier3: [],
    };
    for (const clue of state.clues) map[clue.tier].push(clue);
    return map;
  }, [state.clues]);

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

  const ranked = useMemo(() => rankTeams(state.progress, teamTierCounts), [state.progress, teamTierCounts]);

  const upload = async (challengeId: string, draft:SubmissionDraft):Promise<boolean> => {
    const problem=draftError(draft);if(problem){setError(problem);return false;}
    if(uploadController.current)return false;
    const controller=new AbortController();uploadController.current=controller;
    setBusyId(challengeId);
    setUploadProgress(0);
    setError(null);
    try {
      const fresh=await fetchTeamState();applySnapshot(fresh);
      const challenge=fresh.board.find(item=>item.id===challengeId);
      if(challenge?.my_submission?.status==='pending'||fresh.my_submissions.some(item=>item.challenge_id===challengeId&&item.status==='pending')){
        setError('Your proof is awaiting host review.');return false;
      }
      if(controller.signal.aborted)throw new DOMException('Upload cancelled','AbortError');
      await submitProof(challengeId, draft,{signal:controller.signal,onProgress:setUploadProgress});
      try{applySnapshot(await fetchTeamState());}catch{setError('Submission sent. Refresh the game to see its status.');}
      return true;
    } catch (err) {
      const cancelled=err instanceof DOMException&&err.name==='AbortError';
      if(cancelled||err instanceof ApiError&&(err.status===0||err.status===409||err.status>=500)){
        try{
          const fresh=await fetchTeamState();applySnapshot(fresh);
          if(fresh.my_submissions.some(item=>item.challenge_id===challengeId&&item.status==='pending')){
            setError('Your submission was received and is awaiting host review.');return true;
          }
        }catch{/* Keep the draft if the response cannot be reconciled. */}
      }
      setError(cancelled?'Upload cancelled. Your draft is kept. A request already being saved may still appear shortly.':err instanceof ApiError ? err.message : "Upload failed. Your draft is kept.");
      return false;
    } finally {
      setBusyId(null);
      uploadController.current=null;
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
          <h1>{state.session.name}</h1>
          <PlayerTeamCode code={state.team.join_code}/>
          <p className="player-identity">{state.team.name}</p>
          <span className="player-live" role="status">
            {status === "live" ? <span className="live-dot" aria-hidden="true" /> : status === "offline" ? <WifiOff size={16} aria-hidden="true" /> : <LoaderCircle size={16} aria-hidden="true" className="race-spinner" />}
            <span>{status === "live" ? "Live" : status === "offline" ? "Offline" : status==='reconnecting'?'Reconnecting':status==='syncing'?'Updating':'Connecting'}</span>
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
        <button type="button" className="player-map-shortcut" aria-pressed={mobileTab==='map'} onClick={()=>mobileTab==='map'?setMobileTab('board'):openMap()}><MapPinned size={20} aria-hidden="true"/>{mobileTab==='map'?'Back to board':'Map'}</button>
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
        {detailsLoading?<div className="player-details-loading" role={detailsError?'alert':'status'}>
          <p>{detailsError?'Your board is ready. The rest of the game couldn’t load.':'Board ready. Loading clues, team progress and map…'}</p>
          {detailsError?<button type="button" className="btn-secondary" onClick={()=>setDetailsAttempt(value=>value+1)}>Retry details</button>:null}
        </div>:null}

        <div className={`player-layout grid gap-6 ${mobileTab==='map'?'player-layout--map':'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'}`}>
          {mobileTab==='map'?(detailsLoading?<p role="status">Loading playing area…</p>:<PlayingArea data={state.map} status={state.session.status} sharing={sharing} teamId={state.team.id} teamNames={Object.fromEntries(state.progress.map(team=>[team.team_id,team.team_name]))}/>):null}
          <div className={mobileTab === "map" ? "hidden" : mobileTab === "board" ? "player-board-panel min-w-0" : "player-board-panel hidden min-w-0 lg:block"}>
            <CardTable
              key={`${state.session.id}:${state.team.id}`} teamId={state.team.id}
              board={state.board}
              session={state.session}
              busy={busyId !== null}
              error={error}
              reviewNoticeId={outcomes[0]?.id}
              onUpload={upload}
              uploadProgress={uploadProgress} onCancelUpload={()=>uploadController.current?.abort()}
            />
          </div>

          <aside className={mobileTab === "map" ? "hidden" : mobileTab === "board" ? "hidden space-y-6 lg:block" : "space-y-6"}>
            <section className={mobileTab === "clues" ? "player-clues" : "player-clues hidden lg:block"}>
              <h2 id="player-clues-heading" tabIndex={-1} className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
                Your clues
              </h2>
              <div className="space-y-3">
                {detailsLoading?<p role="status">Loading your clues…</p>:TIERS.map((tier) => (
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
              <p className="team-card-data-note">Clue value: Tier 1 = 1, Tier 2 = 2, Tier 3 = 3.</p>
              {detailsLoading?<TeamProgressSkeleton/>:ranked.length ? <TeamProgressCards rows={ranked} ownTeamId={state.team.id} counts={teamTierCounts} /> : <NoTeams />}
            </section>
          </aside>
        </div>
      </main>
      <nav className="player-mobile-nav" aria-label="Game views">
        <button type="button" aria-current={mobileTab === "board" ? "page" : undefined} onClick={() => setMobileTab("board")}><LayoutGrid size={20} aria-hidden="true" />The board</button>
        <button type="button" aria-current={mobileTab === "clues" ? "page" : undefined} onClick={() => setMobileTab("clues")}><Ticket size={20} aria-hidden="true" /><span>Your clues <b className="nav-count">{detailsLoading?'…':state.clues.length}</b></span></button>
        <button type="button" aria-current={mobileTab === "teams" ? "page" : undefined} onClick={() => setMobileTab("teams")}><Users size={20} aria-hidden="true" />Teams</button>
        <button type="button" aria-current={mobileTab==='map'?'page':undefined} onClick={openMap}><MapPinned size={20} aria-hidden="true"/>Map</button>
      </nav>
      <ClueNotifications outcome={outcomes[0]} announcements={announcements} onDismissOutcome={dismissOutcome}
        onDismissAnnouncement={dismissAnnouncement} onView={viewReward} />
      <LocationSharingPrompt key={`${state.session.id}:${state.team.id}`} sessionId={state.session.id} teamId={state.team.id} freshJoin={freshJoin}
        eligible={canStartSharing&&sharing.status==='off'} deferred={Boolean(shrinkNotice)||helpOpen||nameOpen||Boolean(outcomes[0])} onShare={sharing.start}/>
      {shrinkNotice&&!helpOpen&&!nameOpen&&!outcomes[0]?<RaceDialog title="The playing area has shrunk" eyebrow="PLAYING AREA UPDATE" onClose={()=>setShrinkNotice(null)} footer={<>
        <button type="button" className="btn-secondary" onClick={()=>setShrinkNotice(null)}>Got it</button>
        <button type="button" className="btn-primary" onClick={()=>{setShrinkNotice(null);openMap();}}>View map</button>
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
