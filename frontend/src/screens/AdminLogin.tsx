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
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-5">
      <header className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-brand-700 ring-1 ring-inset ring-brand-200">
          Host console
        </span>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900">
          Enter the admin PIN
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Set as <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-800">ADMIN_PIN</code> in{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-800">backend/.env</code>.
        </p>
      </header>

      <form onSubmit={submit} className="card space-y-4 p-5">
        <input
          type="password"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          placeholder="PIN"
          autoFocus
          required
          className="field py-3 text-center text-xl font-bold tracking-[0.2em]"
        />

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
          disabled={busy || pin.length === 0}
          className="btn-primary w-full py-3 text-base"
        >
          {busy ? "Checking…" : "Unlock console"}
        </button>
      </form>

      <button
        type="button"
        onClick={onBack}
        className="mx-auto text-xs font-semibold text-slate-500 underline-offset-4 hover:text-brand-700 hover:underline"
      >
        Back to player join
      </button>
    </main>
  );
}
