import { HostMap } from "../components/HostMap";
import {mergeAdminGameUpdate} from '../lib/gameUpdates';
import type {AdminGameUpdate} from '../lib/gameUpdates';
import { applyMapEvent,mergeMapSnapshot } from "../lib/gameMap";
import type { MapEvent } from "../lib/gameMap";
import "../game-map.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { AdminBoard, AdminBoardSkeleton } from "../components/AdminBoard";
import { ReviewTab, CodesTab, CluesTab, ProgressTab } from "../components/RaceHostViews";
import { BoardUnavailable, ConnectionNotice } from "../components/ConnectionNotice";
import { HostSubmissionNotifications } from "../components/HostSubmissionNotifications";
import { DeleteSessionButton } from "../components/DeleteSessionButton";
import { ArrowLeftRight, Flag, LogOut, PlaneTakeoff, Users } from "lucide-react";

import {
  LivePill,
} from "../components/Badges";
import {
  ApiError,
  adminSocketUrl,
  approveSubmission,
  createSession,
  endSession,
  fetchAdminState,
  getAdminSession,
  getAdminToken,
  listSessions,
  rejectSubmission,
  setAdminSession,
} from "../lib/api";
import type {
  AdminState,
  SessionSummary,
} from "../lib/types";
import { useLiveSocket } from "../lib/useLive";

type Tab = "review" | "codes" | "board" | "clues" | "progress" | "map";

interface Props {
  onSignOut: () => void;
}

export default function AdminConsole({ onSignOut }: Props) {
  const adminToken = getAdminToken() ?? "";

  const [sessionId, setSessionId] = useState<string | null>(getAdminSession());
  const [state, setState] = useState<AdminState | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [tab, setTab] = useState<Tab>("review");
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletionNotice,setDeletionNotice]=useState<string|null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const fail = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          onSignOut();
          return;
        }
        setError(err.message);
        return;
      }
      setError(fallback);
    },
    [onSignOut],
  );

  const reloadSessions = useCallback(async () => {
    try {
      setSessions(await listSessions());
    } catch (err) {
      fail(err, "could not load sessions");
    }
  }, [fail]);

  useEffect(() => {
    void reloadSessions();
  }, [reloadSessions]);

  useEffect(() => {
    if (!sessionId) {
      setState(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchAdminState(sessionId)
      .then((snapshot) => {
        if (!cancelled) setState(snapshot);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          // Session was deleted out from under us.
          setAdminSession(null);
          setSessionId(null);
        }
        fail(err, "could not load session");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, fail]);

  const status = useLiveSocket<AdminState | MapEvent | AdminGameUpdate>(
    sessionId && adminToken ? adminSocketUrl(adminToken, sessionId) : null,
    (snapshot) => {
      if (snapshot.kind === "admin") setState(current=>({...snapshot,map:current?.session.id===snapshot.session.id?mergeMapSnapshot(current.map,snapshot.map):snapshot.map}));
      else if(snapshot.kind==='admin_update')setState(current=>current?mergeAdminGameUpdate(current,snapshot):current);
      else setState(current=>current&&snapshot.session_id===current.session.id?{...current,map:applyMapEvent(current.map,snapshot)}:current);
    },
  );

  const selectSession = (id: string) => {
    setAdminSession(id);
    setSessionId(id);
    setError(null);
    setTab("review");
    setSelectedSubmissionId(null);
  };

  const sessionDeleted = (id: string,mediaPending=false) => {
    setDeletionNotice(mediaPending?'Session deleted. Storage cleanup is pending and will retry automatically.':'Session and its uploaded media deleted.');
    setSessions(current => current.filter(entry => entry.id !== id));
    if (sessionId === id) {
      setAdminSession(null);
      setSessionId(null);
      setState(null);
      setLoading(false);
    }
    setError(null);
  };

  const pendingCount = useMemo(
    () => (state?.submissions ?? []).filter((s) => s.status === "pending").length,
    [state],
  );

  const retryBoard = () => {
    if (!sessionId) return;
    setRetrying(true);
    void fetchAdminState(sessionId).then(snapshot => { setState(snapshot); setError(null); })
      .catch(err => fail(err, "could not reconnect")).finally(() => setRetrying(false));
  };

  if (sessionId && loading && !state) return <AdminBoardSkeleton />;
  if (sessionId && error && !state) return <BoardUnavailable retrying={retrying} onRetry={retryBoard} onSwitch={() => { setAdminSession(null); setSessionId(null); setError(null); }} />;

  if (!sessionId || !state) {
    return (
      <>{deletionNotice?<p className="connection-notice" role="status">{deletionNotice}</p>:null}<SessionPicker
        sessions={sessions}
        loading={loading}
        error={error}
        onSelect={selectSession}
        onCreated={(id) => {
          void reloadSessions();
          selectSession(id);
        }}
        onError={(message) => setError(message)}
        onDeleted={sessionDeleted}
        onSignOut={onSignOut}
      /></>
    );
  }

  const session = state.session;

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    try {
      setError(null);
      await action();
    } catch (err) {
      fail(err, fallback);
    }
  };

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "review", label: "Review", badge: pendingCount },
    { id: "codes", label: "Team codes" },
    { id: "board", label: "Board" },
    { id: "clues", label: "Clues" },
    { id: "progress", label: "Progress" },
    { id: "map", label: "Map" },
  ];

  return (
    <div className="race-host">
      <header className="race-host-header">
        <div className="race-host-topline">
          <div className="race-host-identity">
            <div className="race-brand-mark" aria-hidden="true"><PlaneTakeoff size={25} strokeWidth={2} /></div>
            <div><p className="race-host-kicker">RACE CONTROL <span>/ HOST CONSOLE</span></p><h1>{session.name}</h1></div>
          </div>
          <div className="room-ticket" aria-label={`Room code ${session.room_code}`}><span>ROOM CODE</span><strong>{session.room_code}</strong><span className="ticket-scan-lines" aria-hidden="true" /></div>
          <div className="race-host-meta"><LivePill status={status} /><span className="host-team-count"><Users size={15} aria-hidden="true" /><b>{session.team_count}</b> teams</span></div>
          <div className="race-host-actions">
            <button type="button" className="header-action" aria-label="Switch session" onClick={() => { setAdminSession(null); setSessionId(null); }}><ArrowLeftRight size={16} aria-hidden="true" /><span>Switch session</span></button>
            <button type="button" className="header-action" aria-label="Sign out" onClick={onSignOut}><LogOut size={16} aria-hidden="true" /><span>Sign out</span></button>
          </div>
        </div>
        <div className="race-nav-wrap"><nav className="race-host-nav" aria-label="Host views">
          {tabs.map(entry => <button key={entry.id} type="button" aria-current={tab === entry.id ? "page" : undefined} onClick={() => setTab(entry.id)}>
            {entry.label}{entry.badge ? <span className="nav-count">{entry.badge}</span> : null}
          </button>)}
        </nav>
        <div className="header-danger-zone">{session.status === "active" ? <button type="button" className="header-end-game" onClick={() => {
          if (window.confirm("End the game for everyone?")) void run(() => endSession(session.id), "could not end session");
        }}><Flag size={15} aria-hidden="true" />End game</button> : null}
        <DeleteSessionButton session={session} onDeleted={sessionDeleted} /></div>
        </div>
      </header>
      <main className="race-main">
        {deletionNotice?<p className="connection-notice" role="status">{deletionNotice}</p>:null}
        <ConnectionNotice status={status} error={error} retrying={retrying} onRetry={retryBoard} />

        {tab === "review" ? (
          <ReviewTab
            submissions={state.submissions}
            selectedId={selectedSubmissionId}
            onSelect={setSelectedSubmissionId}
            onApprove={(id, note) =>
              run(() => approveSubmission(id, note), "could not approve")
            }
            onReject={(id, note) =>
              run(() => rejectSubmission(id, note), "could not reject")
            }
          />
        ) : null}

        {tab === "codes" ? (
          <CodesTab
            teams={state.teams}

          />
        ) : null}

        {tab === "board" ? (
          <AdminBoard
            key={session.id}
            state={state}
            error={error}
            onAction={(action) => run(async () => {
              await action();
              setState(await fetchAdminState(session.id));
            }, "could not update board")}
          />
        ) : null}

        {tab === "clues" ? (
          <CluesTab
            key={session.id}
            sessionId={session.id}
            onError={(message) => setError(message)}

          />
        ) : null}

        {tab === 'map' ? <HostMap key={session.id} data={state.map} status={session.status} sessionId={session.id} teamNames={Object.fromEntries(state.progress.map(team=>[team.team_id,team.team_name]))} onReload={async()=>setState(await fetchAdminState(session.id))}/> : null}
        {tab === "progress" ? <ProgressTab state={state} /> : null}
      </main>
      <HostSubmissionNotifications key={session.id} submissions={state.submissions} suppressed={tab === "review"} onOpen={id => {
        setSelectedSubmissionId(id);
        setTab("review");
      }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// session picker
// ---------------------------------------------------------------------------
function SessionPicker({
  sessions,
  loading,
  error,
  onSelect,
  onCreated,
  onError,
  onSignOut,
  onDeleted,
}: {
  sessions: SessionSummary[];
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onCreated: (id: string) => void;
  onError: (message: string) => void;
  onSignOut: () => void;
  onDeleted: (id: string,mediaPending?:boolean) => void;
}) {
  const [name, setName] = useState("");
  const [teamCount, setTeamCount] = useState(8);
  const [taskLimit, setTaskLimit] = useState(6);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const created = await createSession({
        name,
        team_count: teamCount,
        active_task_limit: taskLimit,
      });
      onCreated(created.session.id);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "could not create session");
      setBusy(false);
    }
  };

  return (
    <main className="race-sessions mx-auto max-w-3xl px-4 py-10">
      <header className="entry-heading mb-6 flex items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-brand-700 ring-1 ring-inset ring-brand-200">
            Host console
          </span>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900">
            Sessions
          </h1>
        </div>
        <button type="button" onClick={onSignOut} className="btn-secondary">
          Sign out
        </button>
      </header>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800"
        >
          {error}
        </p>
      ) : null}

      <section className="card entry-ticket mb-8 p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-500">
          New session
        </h2>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600">
              Hunt name
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Saturday Night Hunt"
              maxLength={80}
              required
              className="field"
            />
          </label>

          <label>
            <span className="mb-1.5 block text-xs font-semibold text-slate-600">
              Teams
            </span>
            <input
              type="number"
              min={1}
              max={40}
              value={teamCount}
              onChange={(event) => setTeamCount(Number(event.target.value))}
              className="field"
            />
          </label>

          <label>
            <span className="mb-1.5 block text-xs font-semibold text-slate-600">
              Challenges on the board
            </span>
            <input
              type="number"
              min={1}
              max={24}
              value={taskLimit}
              onChange={(event) => setTaskLimit(Number(event.target.value))}
              className="field"
            />
          </label>

          <button
            type="submit"
            disabled={busy || name.trim().length === 0}
            className="btn-primary sm:col-span-2"
          >
            {busy ? "Creating…" : "Create session"}
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
          Existing sessions
        </h2>
        {loading && sessions.length === 0 ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-8 text-center text-sm text-slate-500">
            No sessions yet — create one above.
          </p>
        ) : (
          <ul className="card divide-y divide-slate-200 overflow-hidden">
            {sessions.map((entry) => (
              <li key={entry.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => onSelect(entry.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold text-slate-900">
                      {entry.name}
                    </span>
                    <span className="text-xs text-slate-600">
                      {entry.team_count} teams · room{" "}
                      <span className="font-mono font-semibold">
                        {entry.room_code}
                      </span>{" "}
                      · <span className="capitalize">{entry.status}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-bold text-slate-900">
                    Open →
                  </span>
                </button>
                <DeleteSessionButton session={entry} onDeleted={onDeleted} compact />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
