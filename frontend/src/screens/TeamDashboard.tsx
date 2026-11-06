import { useMemo, useState } from "react";

import {
  ChallengeStatusBadge,
  LivePill,
  TierBadge,
} from "../components/Badges";
import {
  ApiError,
  fetchTeamState,
  getTeamToken,
  submitProof,
  teamSocketUrl,
} from "../lib/api";
import { TIER_HINT, TIER_LABEL } from "../lib/types";
import type { Challenge, TeamState, Tier } from "../lib/types";
import { useLiveSocket } from "../lib/useLive";

const TIERS: Tier[] = ["tier1", "tier2", "tier3"];

interface Props {
  initialState: TeamState;
  onLeave: () => void;
}

export default function TeamDashboard({ initialState, onLeave }: Props) {
  const token = getTeamToken();
  const [state, setState] = useState<TeamState>(initialState);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const status = useLiveSocket<TeamState>(
    token ? teamSocketUrl(token) : null,
    (snapshot) => {
      if (snapshot.kind === "team") setState(snapshot);
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
      setState(fresh);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "upload failed");
    } finally {
      setBusyId(null);
    }
  };

  const refresh = async () => {
    try {
      setState(await fetchTeamState());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not refresh");
    }
  };

  const leave = () => {
    if (window.confirm("Leave the game on this device?")) onLeave();
  };

  const openCount = state.board.filter((c) => c.status !== "claimed").length;

  return (
    <div className="min-h-screen pb-16">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-extrabold tracking-tight text-slate-900">
              {state.session.name}
            </h1>
            <p className="text-xs text-slate-600">
              {state.team.name} · playing as{" "}
              <span className="font-semibold text-slate-900">
                {state.me.name}
              </span>
            </p>
          </div>

          <LivePill status={status} />

          <button type="button" onClick={refresh} className="btn-secondary">
            Refresh
          </button>
          <button
            type="button"
            onClick={leave}
            className="btn px-2 text-slate-500 hover:text-rose-700"
          >
            Leave
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
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

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section>
            <h2 className="mb-3 flex items-baseline justify-between text-sm font-bold uppercase tracking-wide text-slate-500">
              <span>Live board</span>
              <span className="text-xs font-semibold normal-case tracking-normal text-slate-500">
                {openCount} open
              </span>
            </h2>

            {state.board.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-10 text-center text-sm text-slate-500">
                No challenges on the board yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {state.board.map((challenge) => (
                  <ChallengeCard
                    key={challenge.id}
                    challenge={challenge}
                    busy={busyId === challenge.id}
                    isMine={challenge.claimed_by_team_id === state.team.id}
                    onUpload={(file) => upload(challenge.id, file)}
                  />
                ))}
              </ul>
            )}
          </section>

          <aside className="space-y-6">
            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
                Your clues
              </h2>
              <div className="space-y-3">
                {TIERS.map((tier) => (
                  <div key={tier} className="card p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <TierBadge tier={tier} />
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {TIER_HINT[tier]}
                      </span>
                    </div>
                    {cluesByTier[tier].length === 0 ? (
                      <p className="text-xs text-slate-500">
                        Locked — complete a {TIER_LABEL[tier]} challenge.
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {cluesByTier[tier].map((clue) => (
                          <li key={clue.id}>
                            <p className="text-sm font-bold text-slate-900">
                              {clue.title}
                            </p>
                            <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                              {clue.body}
                            </p>
                            {clue.media_url ? (
                              <a
                                href={clue.media_url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-block text-xs font-semibold text-brand-700 hover:underline"
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

            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
                Team progress
              </h2>
              <ul className="card divide-y divide-slate-200 overflow-hidden">
                {ranked.map((team) => {
                  const mine = team.team_id === state.team.id;
                  return (
                    <li
                      key={team.team_id}
                      className={`flex items-center justify-between gap-3 px-4 py-3 text-sm ${
                        mine ? "bg-brand-50" : ""
                      }`}
                    >
                      <span className="min-w-0 truncate font-semibold text-slate-800">
                        {team.team_name}
                        {mine ? (
                          <span className="ml-1 text-xs font-bold text-brand-700">
                            (you)
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-3 text-xs font-semibold text-slate-600">
                        <span title="players">👤 {team.member_count}</span>
                        <span className="text-amber-700" title="clues unlocked">
                          🔑 {team.clue_count}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function ChallengeCard({
  challenge,
  busy,
  isMine,
  onUpload,
}: {
  challenge: Challenge;
  busy: boolean;
  isMine: boolean;
  onUpload: (file: File | undefined) => void;
}) {
  const submission = challenge.my_submission;
  const claimedByOther = challenge.status === "claimed" && !isMine;

  return (
    <li
      className={`card p-4 transition ${
        claimedByOther ? "bg-slate-50 opacity-70" : "hover:border-slate-300"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TierBadge tier={challenge.clue_tier} />
        <ChallengeStatusBadge status={challenge.status} />
        {isMine ? (
          <span className="rounded-full bg-emerald-700 px-2.5 py-0.5 text-xs font-bold text-white">
            Won by you
          </span>
        ) : null}
      </div>

      <h3 className="text-base font-bold text-slate-900">{challenge.title}</h3>

      {challenge.location_area ? (
        <p className="mt-1 text-xs font-medium text-slate-600">
          📍 {challenge.location_area}
        </p>
      ) : null}

      <p className="mt-2 text-sm leading-relaxed text-slate-700">
        🎯 {challenge.completion_condition}
      </p>

      {submission ? (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${
            submission.status === "approved"
              ? "bg-emerald-50 text-emerald-800"
              : submission.status === "rejected"
                ? "bg-rose-50 text-rose-800"
                : "bg-indigo-50 text-indigo-800"
          }`}
        >
          {submission.status === "approved"
            ? "Approved — clue unlocked."
            : submission.status === "rejected"
              ? `Rejected${submission.review_note ? `: ${submission.review_note}` : ""}. Try again.`
              : "Submitted — waiting for the host to approve."}
        </p>
      ) : null}

      {challenge.status !== "claimed" ? (
        <label
          className={`mt-3 ${
            busy
              ? "btn cursor-wait bg-slate-100 text-slate-500"
              : submission
                ? "btn-secondary cursor-pointer"
                : "btn-primary cursor-pointer"
          }`}
        >
          {busy ? "Uploading…" : submission ? "Submit again" : "Submit photo proof"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={busy}
            onChange={(event) => {
              onUpload(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
      ) : null}
    </li>
  );
}
