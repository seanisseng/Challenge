import { useEffect, useState } from "react";

import {
  ApiError,
  fetchTeamState,
  getAdminToken,
  getTeamToken,
  setAdminSession,
  setAdminToken,
  setTeamToken,
} from "./lib/api";
import { navigate, useRoute } from "./lib/router";
import type { TeamState } from "./lib/types";
import AdminConsole from "./screens/AdminConsole";
import AdminLogin from "./screens/AdminLogin";
import JoinScreen from "./screens/JoinScreen";
import TeamDashboard from "./screens/TeamDashboard";
import {locationPromptKey} from './components/LocationSharingPrompt';
import { TeamProgressSkeleton } from "./components/TeamProgressCards";

export default function App() {
  const route = useRoute();

  return route === "/admin" ? (
    <AdminRoute />
  ) : (
    <PlayerRoute />
  );
}

// ---------------------------------------------------------------------------
// players
// ---------------------------------------------------------------------------
function PlayerRoute() {
  const [freshJoin,setFreshJoin]=useState(false);
  const [state, setState] = useState<TeamState | null>(null);
  const [booting, setBooting] = useState(true);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  // A stored team token means this device already joined: restore silently.
  useEffect(() => {
    if (state) { setBooting(false); return; }
    const token = getTeamToken();
    if (!token) {
      setBooting(false);
      return;
    }
    let cancelled = false;
    setBooting(true);
    setRestoreFailed(false);
    fetchTeamState(token)
      .then((snapshot) => {
        if (!cancelled) setState(snapshot);
      })
      .catch(error => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) setTeamToken(null);
        else setRestoreFailed(true);
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [restoreAttempt]);

  if (booting) return <Booting label="Rejoining your team…" />;

  if (state) {
    return (
      <TeamDashboard
        initialState={state}
        freshJoin={freshJoin}
        onLeave={() => {
          setTeamToken(null);
          setState(null);
        }}
      />
    );
  }

  if (restoreFailed) return <main className="race-entry mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-12">
    <header className="entry-heading"><h1>Reconnect to your team</h1></header>
    <section className="card entry-ticket space-y-4 p-5"><p role="alert">We could not reconnect. Your saved login is still on this device.</p>
      <button type="button" className="btn-primary w-full" onClick={() => setRestoreAttempt(value => value + 1)}>Try again</button>
    </section>
  </main>;

  return (
    <JoinScreen
      onJoined={snapshot=>{
        try{const key=locationPromptKey(snapshot.session.id,snapshot.team.id);if(!localStorage.getItem(key))localStorage.setItem(key,'pending');}catch{/* The in-memory flag still offers the prompt. */}
        setFreshJoin(true);setState(snapshot);
      }}
      onAdmin={() => navigate("/admin")}
    />
  );
}

// ---------------------------------------------------------------------------
// admin
// ---------------------------------------------------------------------------
function AdminRoute() {
  const [authed, setAuthed] = useState(() => Boolean(getAdminToken()));

  if (!authed) {
    return (
      <AdminLogin
        onAuthed={() => setAuthed(true)}
        onBack={() => navigate("/")}
      />
    );
  }

  return (
    <AdminConsole
      onSignOut={() => {
        setAdminToken(null);
        setAdminSession(null);
        setAuthed(false);
      }}
    />
  );
}

function Booting({ label }: { label: string }) {
  return (
    <main className="mx-auto max-w-lg px-3 py-6">
      <p className="mb-4 text-sm font-medium text-slate-600">{label}</p>
      <TeamProgressSkeleton />
    </main>
  );
}
