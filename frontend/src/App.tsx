import { useEffect, useState } from "react";

import {
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
  const [state, setState] = useState<TeamState | null>(null);
  const [booting, setBooting] = useState(true);

  // A stored team token means this device already joined: restore silently.
  useEffect(() => {
    const token = getTeamToken();
    if (!token) {
      setBooting(false);
      return;
    }
    let cancelled = false;
    fetchTeamState(token)
      .then((snapshot) => {
        if (!cancelled) setState(snapshot);
      })
      .catch(() => {
        if (!cancelled) setTeamToken(null);
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (booting) return <Booting label="Rejoining your team…" />;

  if (state) {
    return (
      <TeamDashboard
        initialState={state}
        onLeave={() => {
          setTeamToken(null);
          setState(null);
        }}
      />
    );
  }

  return (
    <JoinScreen
      onJoined={setState}
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
    <main className="flex min-h-screen items-center justify-center">
      <p className="animate-pulse text-sm text-slate-400">{label}</p>
    </main>
  );
}
