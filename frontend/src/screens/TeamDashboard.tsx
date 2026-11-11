import { useMemo, useRef, useState } from "react";
import { CardTable } from "../components/CardTable";

import {
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
import type { TeamState, Tier } from "../lib/types";
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
  const [mobileTab, setMobileTab] = useState<"board" | "clues" | "teams">("board");
  const revealVersion = useRef(initialState.session.board_reveal_version);

  const applySnapshot = (snapshot: TeamState) => {
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
    <div className="min-h-screen pb-28 lg:pb-16">
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

          <button type="button" onClick={refresh} aria-label="Refresh game" className="btn-secondary min-h-11 px-3">
            ?
          </button>
          <button
            type="button"
            onClick={leave}
            className="btn min-h-11 px-2 text-slate-500 hover:text-rose-700"
          >
            Leave
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6">
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
          <div className={mobileTab === "board" ? "min-w-0" : "hidden min-w-0 lg:block"}>
            <CardTable
              board={state.board}
              session={state.session}
              busy={busyId !== null}
              error={error}
              onUpload={(id, file) => void upload(id, file)}
            />
          </div>

          <aside className={mobileTab === "board" ? "hidden space-y-6 lg:block" : "space-y-6"}>
            <section className={mobileTab === "clues" ? "" : "hidden lg:block"}>
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

            <section className={mobileTab === "teams" ? "" : "hidden lg:block"}>
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
      <nav className="player-mobile-nav" aria-label="Game views">
        <button type="button" aria-current={mobileTab === "board" ? "page" : undefined} onClick={() => setMobileTab("board")}>The board</button>
        <button type="button" aria-current={mobileTab === "clues" ? "page" : undefined} onClick={() => setMobileTab("clues")}>Your clues ? {state.clues.length}</button>
        <button type="button" aria-current={mobileTab === "teams" ? "page" : undefined} onClick={() => setMobileTab("teams")}>Teams</button>
      </nav>
    </div>
  );
}
