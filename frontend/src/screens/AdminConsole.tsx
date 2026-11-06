import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import {
  ChallengeStatusBadge,
  LivePill,
  SubmissionStatusBadge,
  TierBadge,
} from "../components/Badges";
import {
  ApiError,
  addChallenge,
  addClue,
  adminSocketUrl,
  approveSubmission,
  createSession,
  endSession,
  fetchAdminState,
  getAdminSession,
  getAdminToken,
  listClues,
  listSessions,
  rejectSubmission,
  removeMember,
  setAdminSession,
  startSession,
  submissionPhoto,
} from "../lib/api";
import { TIER_LABEL } from "../lib/types";
import type {
  AdminState,
  AdminSubmission,
  AdminTeam,
  Clue,
  SessionSummary,
  Tier,
} from "../lib/types";
import { useLiveSocket } from "../lib/useLive";

type Tab = "review" | "codes" | "board" | "content" | "progress";

interface Props {
  onSignOut: () => void;
}

export default function AdminConsole({ onSignOut }: Props) {
  const adminToken = getAdminToken() ?? "";

  const [sessionId, setSessionId] = useState<string | null>(getAdminSession());
  const [state, setState] = useState<AdminState | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [tab, setTab] = useState<Tab>("review");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const status = useLiveSocket<AdminState>(
    sessionId && adminToken ? adminSocketUrl(adminToken, sessionId) : null,
    (snapshot) => {
      if (snapshot.kind === "admin") setState(snapshot);
    },
  );

  const selectSession = (id: string) => {
    setAdminSession(id);
    setSessionId(id);
    setError(null);
  };

  const pendingCount = useMemo(
    () => (state?.submissions ?? []).filter((s) => s.status === "pending").length,
    [state],
  );

  if (!sessionId || !state) {
    return (
      <SessionPicker
        sessions={sessions}
        loading={loading}
        error={error}
        onSelect={selectSession}
        onCreated={(id) => {
          void reloadSessions();
          selectSession(id);
        }}
        onError={(message) => setError(message)}
        onSignOut={onSignOut}
      />
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
    { id: "content", label: "Content" },
    { id: "progress", label: "Progress" },
  ];

  return (
    <div className="min-h-screen pb-16">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-extrabold tracking-tight text-slate-900">
              {session.name}
            </h1>
            <p className="text-xs text-slate-600">
              Room{" "}
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-bold tracking-widest text-slate-900">
                {session.room_code}
              </span>{" "}
              · {session.team_count} teams ·{" "}
              <span className="font-semibold capitalize text-slate-700">
                {session.status}
              </span>
            </p>
          </div>

          <LivePill status={status} />

          {session.status === "lobby" ? (
            <button
              type="button"
              onClick={() =>
                run(() => startSession(session.id), "could not start session")
              }
              className="btn-success"
            >
              Start hunt
            </button>
          ) : null}

          {session.status === "active" ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("End the game for everyone?"))
                  void run(() => endSession(session.id), "could not end session");
              }}
              className="btn-danger"
            >
              End game
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setAdminSession(null);
              setSessionId(null);
            }}
            className="btn-secondary"
          >
            Switch session
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="btn px-2 text-slate-500 hover:text-rose-700"
          >
            Sign out
          </button>
        </div>

        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-bold transition ${
                tab === entry.id
                  ? "border-brand text-brand-700"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
              }`}
            >
              {entry.label}
              {entry.badge ? (
                <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  {entry.badge}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800"
          >
            {error}
          </p>
        ) : null}

        {tab === "review" ? (
          <ReviewTab
            submissions={state.submissions}
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
            onRemove={(memberId) => {
              if (!window.confirm("Remove this player?")) return;
              void run(() => removeMember(memberId), "could not remove player");
            }}
          />
        ) : null}

        {tab === "board" ? <BoardTab state={state} /> : null}

        {tab === "content" ? (
          <ContentTab
            sessionId={session.id}
            onError={(message) => setError(message)}
            onDone={() =>
              void run(
                () => fetchAdminState(session.id).then(setState),
                "reload failed",
              )
            }
          />
        ) : null}

        {tab === "progress" ? <ProgressTab state={state} /> : null}
      </main>
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
}: {
  sessions: SessionSummary[];
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onCreated: (id: string) => void;
  onError: (message: string) => void;
  onSignOut: () => void;
}) {
  const [name, setName] = useState("");
  const [teamCount, setTeamCount] = useState(4);
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
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6 flex items-start justify-between gap-4">
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

      <section className="card mb-8 p-5">
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
              <li key={entry.id}>
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
                  <span className="shrink-0 text-xs font-bold text-brand-700">
                    Open →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------
function ReviewTab({
  submissions,
  onApprove,
  onReject,
}: {
  submissions: AdminSubmission[];
  onApprove: (id: string, note?: string) => void;
  onReject: (id: string, note?: string) => void;
}) {
  const pending = submissions.filter((s) => s.status === "pending");
  const history = submissions.filter((s) => s.status !== "pending");

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
          Waiting for review ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-8 text-center text-sm text-slate-500">
            Nothing to review right now.
          </p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {pending.map((submission) => (
              <ReviewCard
                key={submission.id}
                submission={submission}
                onApprove={onApprove}
                onReject={onReject}
              />
            ))}
          </ul>
        )}
      </section>

      {history.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
            History
          </h2>
          <ul className="card divide-y divide-slate-200 overflow-hidden">
            {history.map((submission) => (
              <li
                key={submission.id}
                className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm"
              >
                <span className="font-bold text-slate-800">
                  {submission.teams?.name ?? "Team"}
                </span>
                <span className="text-slate-400">·</span>
                <span className="min-w-0 flex-1 truncate text-slate-600">
                  {submission.challenges?.title ?? "Challenge"}
                </span>
                <SubmissionStatusBadge status={submission.status} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ReviewCard({
  submission,
  onApprove,
  onReject,
}: {
  submission: AdminSubmission;
  onApprove: (id: string, note?: string) => void;
  onReject: (id: string, note?: string) => void;
}) {
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    submissionPhoto(submission.id)
      .then((result) => {
        if (!cancelled) setPhoto(result.url);
      })
      .catch(() => {
        if (!cancelled) setPhotoError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [submission.id]);

  return (
    <li className="card overflow-hidden">
      <div className="aspect-[4/3] bg-slate-100">
        {photo ? (
          <a href={photo} target="_blank" rel="noreferrer">
            <img
              src={photo}
              alt={`Proof from ${submission.teams?.name ?? "a team"}`}
              className="h-full w-full object-cover"
            />
          </a>
        ) : (
          <div className="flex h-full items-center justify-center text-xs font-medium text-slate-500">
            {photoError ? "photo unavailable" : "loading photo…"}
          </div>
        )}
      </div>

      <div className="space-y-2.5 p-4">
        <p className="text-sm font-bold text-slate-900">
          {submission.teams?.name ?? "Team"}
          {submission.team_members?.name ? (
            <span className="font-medium text-slate-600">
              {" "}
              · {submission.team_members.name}
            </span>
          ) : null}
        </p>
        <p className="text-sm text-slate-700">
          {submission.challenges?.title ?? "Challenge"}
        </p>

        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional note for the team"
          maxLength={280}
          className="field py-1.5 text-sm"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onApprove(submission.id, note || undefined)}
            className="btn-success flex-1"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => onReject(submission.id, note || undefined)}
            className="btn-danger flex-1"
          >
            Reject
          </button>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// team codes
// ---------------------------------------------------------------------------
function CodesTab({
  teams,
  onRemove,
}: {
  teams: AdminTeam[];
  onRemove: (memberId: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied(null), 1200);
    } catch {
      /* clipboard blocked; the code is on screen anyway */
    }
  };

  return (
    <section>
      <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-500">
        Team join codes
      </h2>
      <p className="mb-3 text-xs text-slate-600">
        Every player on a team enters the same code, then their own name.
      </p>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {teams.map((team) => (
          <li key={team.id} className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-900">{team.name}</span>
              <span className="text-xs font-semibold text-slate-500">
                {team.members.length} player{team.members.length === 1 ? "" : "s"}
              </span>
            </div>

            <button
              type="button"
              onClick={() => void copy(team.join_code)}
              title="Copy code"
              className="mt-2.5 w-full rounded-xl border-2 border-brand-200 bg-brand-50 px-3 py-2 font-mono text-xl font-extrabold tracking-[0.3em] text-brand-700 transition hover:border-brand hover:bg-brand-100"
            >
              {team.join_code}
            </button>
            <p className="mt-1 text-center text-[11px] font-semibold text-slate-500">
              {copied === team.join_code ? "copied!" : "tap to copy"}
            </p>

            {team.members.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1">
                {team.members.map((member) => (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() => onRemove(member.id)}
                      title="Remove player"
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 transition hover:bg-rose-100 hover:text-rose-800"
                    >
                      {member.name} ✕
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-500">Nobody joined yet.</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// board
// ---------------------------------------------------------------------------
function BoardTab({ state }: { state: AdminState }) {
  const teamName = (id: string | null) =>
    state.teams.find((team) => team.id === id)?.name ?? "another team";

  return (
    <section>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
        Live board ({state.board.length} of {state.session.active_task_limit})
      </h2>

      {state.board.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-8 text-center text-sm text-slate-500">
          No active challenges. Add challenges under Content, then start the
          hunt.
        </p>
      ) : (
        <ul className="space-y-3">
          {state.board.map((challenge) => (
            <li key={challenge.id} className="card p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <TierBadge tier={challenge.clue_tier} />
                <ChallengeStatusBadge status={challenge.status} />
              </div>
              <p className="font-bold text-slate-900">{challenge.title}</p>
              {challenge.location_area ? (
                <p className="text-xs font-medium text-slate-600">
                  📍 {challenge.location_area}
                </p>
              ) : null}
              <p className="mt-1 text-sm text-slate-700">
                🎯 {challenge.completion_condition}
              </p>
              {challenge.status === "claimed" ? (
                <p className="mt-2 text-xs font-bold text-emerald-700">
                  Claimed by {teamName(challenge.claimed_by_team_id)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// content
// ---------------------------------------------------------------------------
function ContentTab({
  sessionId,
  onError,
  onDone,
}: {
  sessionId: string;
  onError: (message: string) => void;
  onDone: () => void;
}) {
  const [clues, setClues] = useState<Clue[]>([]);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [condition, setCondition] = useState("");
  const [challengeTier, setChallengeTier] = useState<Tier>("tier1");

  const [clueTier, setClueTier] = useState<Tier>("tier1");
  const [clueTitle, setClueTitle] = useState("");
  const [clueBody, setClueBody] = useState("");
  const [clueMedia, setClueMedia] = useState("");

  const reloadClues = useCallback(async () => {
    try {
      setClues(await listClues(sessionId));
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "could not load clues");
    }
  }, [sessionId, onError]);

  useEffect(() => {
    void reloadClues();
  }, [reloadClues]);

  const submitChallenge = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await addChallenge(sessionId, {
        title: title.trim(),
        location_area: area.trim() || null,
        completion_condition: condition.trim(),
        clue_tier: challengeTier,
        sort_order: 0,
      });
      setTitle("");
      setArea("");
      setCondition("");
      onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "could not add challenge");
    } finally {
      setBusy(false);
    }
  };

  const submitClue = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await addClue(sessionId, {
        tier: clueTier,
        title: clueTitle.trim(),
        body: clueBody.trim(),
        media_url: clueMedia.trim() || null,
        sort_order: 0,
      });
      setClueTitle("");
      setClueBody("");
      setClueMedia("");
      await reloadClues();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "could not add clue");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-500">
          Add a challenge
        </h2>
        <form onSubmit={submitChallenge} className="space-y-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Banana tree selfie"
            maxLength={120}
            required
            className="field"
          />
          <input
            value={area}
            onChange={(event) => setArea(event.target.value)}
            placeholder="Location / area"
            maxLength={160}
            className="field"
          />
          <textarea
            value={condition}
            onChange={(event) => setCondition(event.target.value)}
            placeholder="Eat a banana as a group beneath a banana tree."
            maxLength={400}
            required
            rows={3}
            className="field"
          />
          <TierSelect value={challengeTier} onChange={setChallengeTier} />
          <button type="submit" disabled={busy} className="btn-primary w-full">
            Add challenge
          </button>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-500">
          Add a clue
        </h2>
        <form onSubmit={submitClue} className="space-y-3">
          <TierSelect value={clueTier} onChange={setClueTier} />
          <input
            value={clueTitle}
            onChange={(event) => setClueTitle(event.target.value)}
            placeholder="Head toward the river"
            maxLength={120}
            required
            className="field"
          />
          <textarea
            value={clueBody}
            onChange={(event) => setClueBody(event.target.value)}
            placeholder="The old market district, north of the tram line."
            maxLength={1000}
            required
            rows={3}
            className="field"
          />
          <input
            value={clueMedia}
            onChange={(event) => setClueMedia(event.target.value)}
            placeholder="Reference image URL (optional)"
            maxLength={500}
            className="field"
          />
          <button type="submit" disabled={busy} className="btn-primary w-full">
            Add clue
          </button>
        </form>

        <div className="mt-5 border-t border-slate-200 pt-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            Clues in this session ({clues.length})
          </h3>
          <ul className="space-y-2">
            {clues.map((clue) => (
              <li
                key={clue.id}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <TierBadge tier={clue.tier} />
                  <span className="text-sm font-bold text-slate-900">
                    {clue.title}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{clue.body}</p>
              </li>
            ))}
            {clues.length === 0 ? (
              <li className="text-xs text-slate-500">
                No clues yet — approving a challenge will unlock nothing until
                you add one.
              </li>
            ) : null}
          </ul>
        </div>
      </section>
    </div>
  );
}

function TierSelect({
  value,
  onChange,
}: {
  value: Tier;
  onChange: (tier: Tier) => void;
}) {
  return (
    <div className="flex gap-2">
      {(["tier1", "tier2", "tier3"] as Tier[]).map((tier) => (
        <button
          key={tier}
          type="button"
          onClick={() => onChange(tier)}
          className={`flex-1 rounded-xl px-3 py-1.5 text-xs font-bold ring-1 ring-inset transition ${
            value === tier
              ? "bg-brand text-white ring-brand"
              : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50"
          }`}
        >
          {TIER_LABEL[tier]}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// progress
// ---------------------------------------------------------------------------
function ProgressTab({ state }: { state: AdminState }) {
  const rows = [...state.progress].sort(
    (a, b) =>
      b.clue_count - a.clue_count || a.team_name.localeCompare(b.team_name),
  );

  return (
    <section>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
        Team progress
      </h2>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-bold">Team</th>
              <th className="px-4 py-2.5 font-bold">Code</th>
              <th className="px-4 py-2.5 text-right font-bold">Players</th>
              <th className="px-4 py-2.5 text-right font-bold">Won</th>
              <th className="px-4 py-2.5 text-right font-bold">Clues</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.map((row) => {
              const team = state.teams.find((t) => t.id === row.team_id);
              return (
                <tr key={row.team_id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-bold text-slate-900">
                    {row.team_name}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs font-bold tracking-widest text-brand-700">
                    {team?.join_code ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-slate-700">
                    {row.member_count}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-slate-700">
                    {row.claimed_count}
                  </td>
                  <td className="px-4 py-2.5 text-right font-extrabold text-amber-700">
                    {row.clue_count}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
