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
    <main className="race-entry mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-12">
      <header className="entry-heading text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-brand-700 ring-1 ring-inset ring-brand-200">
          Scavenger Hunt
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900">
          Join your team
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-base leading-relaxed text-slate-600">
          Type the code your host gave you, then your name. Everyone on your
          team can use the same code from their own phone.
        </p>
      </header>

      <form onSubmit={submit} className="card entry-ticket space-y-4 p-5">
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
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
            className="field entry-code py-3 text-center text-2xl font-extrabold uppercase tracking-[0.3em] placeholder:font-normal placeholder:tracking-normal"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
            Your name
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Alex"
            maxLength={40}
            required
            className="field py-3 text-lg"
          />
        </label>

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || code.trim().length === 0 || name.trim().length === 0}
          className="btn-primary w-full py-3 text-base"
        >
          {busy ? "Joining…" : "Join game"}
        </button>
      </form>

      <button
        type="button"
        onClick={onAdmin}
        className="mx-auto text-base font-semibold text-slate-600 underline-offset-4 hover:text-brand-700 hover:underline"
      >
        I&apos;m the host
      </button>
    </main>
  );
}
