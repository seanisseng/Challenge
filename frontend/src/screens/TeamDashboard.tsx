import { useMemo, useState } from "react";

import { ChallengeStatusBadge, TierBadge } from "../components/Badges";
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
        (a, b) => b.clue_count - a.clue_count || a.team_name.localeCompare(b.team_name),
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

  return (
    <div className="min-h-screen pb-16">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-white">
              {state.session.name}
            </h1>
            <p className="text-xs text-slate-400">
              {state.team.name} · playing as{" "}
              <span className="text-slate-200">{state.me.name}</span>
            </p>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
              status === "live"
                ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                : "bg-amber-500/15 text-amber-300 ring-amber-500/30"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === "live" ? "bg-emerald-400" : "bg-amber-400"
              }`}
            />
            {status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Offline"}
          </span>

          <button
            type="button"
            onClick={refresh}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-500 hover:text-white"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={leave}
            className="rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:text-rose-300"
          >
            Leave
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {state.session.status === "lobby" ? (
          <p className="mb-6 rounded-xl border border-brand/40 bg-brand/10 px-4 py-3 text-sm text-indigo-200">
            You&apos;re in. Waiting for the host to start the hunt — challenges
            will appear here automatically.
          </p>
        ) : null}

        {state.session.status === "ended" ? (
          <p className="mb-6 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
            This game has ended. Thanks for playing.
          </p>
        ) : null}

        {error ? (
          <p className="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section>
            <h2 className="mb-3 flex items-baseline justify-between text-sm font-semibold uppercase tracking-wide text-slate-400">
              <span>Live board</span>
              <span className="text-xs font-normal normal-case text-slate-500">
                {state.board.filter((c) => c.status !== "claimed").length} open
              </span>
            </h2>

            {state.board.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-500">
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
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Your clues
              </h2>
              <div className="space-y-3">
                {TIERS.map((tier) => (
                  <div
                    key={tier}
                    className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <TierBadge tier={tier} />
                      <span className="text-[11px] uppercase tracking-wide text-slate-500">
                        {TIER_HINT[tier]}
                      </span>
                    </div>
                    {cluesByTier[tier].length === 0 ? (
                      <p className="text-xs text-slate-500">
                        Locked — complete a {TIER_LABEL[tier]} challenge.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {cluesByTier[tier].map((clue) => (
                          <li key={clue.id}>
                            <p className="text-sm font-semibold text-slate-100">
                              {clue.title}
                            </p>
                            <p className="whitespace-pre-wrap text-sm text-slate-300">
                              {clue.body}
                            </p>
                            {clue.media_url ? (
                              <a
                                href={clue.media_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-brand hover:underline"
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
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Team progress
              </h2>
              <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
                {ranked.map((team) => {
                  const mine = team.team_id === state.team.id;
                  return (
                    <li
                      key={team.team_id}
                      className={`flex items-center justify-between gap-3 px-3 py-2.5 text-sm ${
                        mine ? "bg-brand/10" : ""
                      }`}
                    >
                      <span className="min-w-0 truncate text-slate-200">
                        {team.team_name}
                        {mine ? (
                          <span className="ml-1 text-xs text-brand">(you)</span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-3 text-xs text-slate-400">
                        <span title="players">{team.member_count}👤</span>
                        <span
                          className="font-semibold text-amber-300"
                          title="clues unlocked"
                        >
                          {team.clue_count}🔑
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
  const claimedByOther =
    challenge.status === "claimed" && !isMine;

  return (
    <li
      className={`rounded-xl border p-4 transition ${
        claimedByOther
          ? "border-slate-800 bg-slate-900/40 opacity-60"
          : "border-slate-800 bg-slate-900/70"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TierBadge tier={challenge.clue_tier} />
        <ChallengeStatusBadge status={challenge.status} />
        {isMine ? (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
            Won by you
          </span>
        ) : null}
      </div>

      <h3 className="text-base font-bold text-white">{challenge.title}</h3>

      {challenge.location_area ? (
        <p className="mt-1 text-xs text-slate-400">
          📍 {challenge.location_area}
        </p>
      ) : null}

      <p className="mt-2 text-sm text-slate-300">
        🎯 {challenge.completion_condition}
      </p>

      {submission ? (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            submission.status === "approved"
              ? "bg-emerald-500/10 text-emerald-200"
              : submission.status === "rejected"
                ? "bg-rose-500/10 text-rose-200"
                : "bg-indigo-500/10 text-indigo-200"
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
          className={`mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
            busy
              ? "cursor-wait bg-slate-700 text-slate-300"
              : "bg-brand text-white hover:bg-brand-dark"
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
