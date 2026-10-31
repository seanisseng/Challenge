import { useState } from "react";
import type { FormEvent } from "react";

import { ApiError, joinTeam } from "../lib/api";
import type { TeamState } from "../lib/types";

interface Props {
  onJoined: (state: TeamState) => void;
  onAdmin: () => void;
}

export default function JoinScreen({ onJoined, onAdmin }: Props) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const state = await joinTeam(code, name);
      onJoined(state);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "something went wrong");
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand">
          Scavenger Hunt
        </p>
        <h1 className="mt-2 text-3xl font-bold text-white">Join your team</h1>
        <p className="mt-2 text-sm text-slate-400">
          Type the code your host gave you, then your name. Everyone on your
          team can use the same code from their own phone.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Team code
          </span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={12}
            required
            className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-center text-2xl font-bold tracking-[0.3em] text-white outline-none placeholder:text-slate-600 focus:border-brand focus:ring-2 focus:ring-brand/40"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Your name
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Alex"
            maxLength={40}
            required
            className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-lg text-white outline-none placeholder:text-slate-600 focus:border-brand focus:ring-2 focus:ring-brand/40"
          />
        </label>

        {error ? (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || code.trim().length === 0 || name.trim().length === 0}
          className="w-full rounded-xl bg-brand px-4 py-3 text-lg font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Joining…" : "Join game"}
        </button>
      </form>

      <button
        type="button"
        onClick={onAdmin}
        className="mx-auto text-xs text-slate-500 underline-offset-4 hover:text-slate-300 hover:underline"
      >
        I&apos;m the host
      </button>
    </main>
  );
}
