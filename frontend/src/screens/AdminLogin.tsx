import { useState } from "react";
import type { FormEvent } from "react";

import { ApiError, adminLogin } from "../lib/api";

interface Props {
  onAuthed: () => void;
  onBack: () => void;
}

export default function AdminLogin({ onAuthed, onBack }: Props) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminLogin(pin);
      onAuthed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "login failed");
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6">
      <header className="text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand">
          Host console
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white">Enter the admin PIN</h1>
        <p className="mt-2 text-sm text-slate-400">
          Set as <code className="text-slate-300">ADMIN_PIN</code> in
          <code className="ml-1 text-slate-300">backend/.env</code>.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-4">
        <input
          type="password"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          placeholder="PIN"
          autoFocus
          required
          className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-center text-xl tracking-[0.2em] text-white outline-none placeholder:text-slate-600 focus:border-brand focus:ring-2 focus:ring-brand/40"
        />

        {error ? (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || pin.length === 0}
          className="w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Checking…" : "Unlock console"}
        </button>
      </form>

      <button
        type="button"
        onClick={onBack}
        className="mx-auto text-xs text-slate-500 underline-offset-4 hover:text-slate-300 hover:underline"
      >
        Back to player join
      </button>
    </main>
  );
}
