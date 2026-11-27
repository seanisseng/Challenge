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
import { TeamReconnect } from "./components/TeamReconnect";

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
  const [booting, setBooting] = useState(()=>Boolean(getTeamToken()));
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
    const controller=new AbortController();
    setBooting(true);
    setRestoreFailed(false);
    const timeout=window.setTimeout(()=>{
      controller.abort();
      if(!cancelled){setRestoreFailed(true);setBooting(false);}
    },15_000);
    fetchTeamState(token,{signal:controller.signal})
      .then((snapshot) => {
        if (!cancelled&&!controller.signal.aborted) setState(snapshot);
      })
      .catch(error => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) setTeamToken(null);
        else setRestoreFailed(true);
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [restoreAttempt]);

  const useTeamCode=()=>{
    setTeamToken(null);setBooting(false);setRestoreFailed(false);
    setRestoreAttempt(value=>value+1);
  };

  if (booting||restoreFailed) return <TeamReconnect key={restoreAttempt} failed={restoreFailed}
    onRetry={()=>setRestoreAttempt(value=>value+1)} onUseCode={useTeamCode} onAdmin={()=>navigate('/admin')}/>;

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
