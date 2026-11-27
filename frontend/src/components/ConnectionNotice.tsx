import { LoaderCircle, RefreshCw, TriangleAlert, WifiOff } from "lucide-react";
import type {ConnectionStatus} from '../lib/useLive';

export function ConnectionNotice({ status, error, retrying, onRetry, confirmationPending=false }: {
  status: ConnectionStatus;
  error: string | null;
  retrying: boolean;
  onRetry: () => void;
  confirmationPending?: boolean;
}) {
  const offline = status === "offline";
  if (!offline && !error && !confirmationPending) return null;
  const Icon = offline ? WifiOff : TriangleAlert;
  return <div className={`connection-notice ${offline ? "connection-notice--offline" : "connection-notice--error"}`} role="alert">
    <span className="connection-notice-icon"><Icon size={22} aria-hidden="true" /></span>
    <div><strong>{confirmationPending ? "Waiting for decision confirmation" : offline ? "Connection interrupted" : "That change did not go through"}</strong>
      <p>{confirmationPending ? error??"Your decision was sent. Waiting for the updated queue; you can refresh its status." : offline ? "Your last board is still here. We are reconnecting automatically; you can also try again." : error}</p>
    </div>
    {offline || confirmationPending ? <button type="button" className="btn-secondary" disabled={retrying} onClick={onRetry}>
      {retrying ? <LoaderCircle size={16} className="race-spinner" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
      {retrying ? "Trying again..." : confirmationPending ? "Refresh status" : "Try again"}
    </button> : null}
  </div>;
}

export function BoardUnavailable({ retrying, onRetry, onSwitch }: { retrying: boolean; onRetry: () => void; onSwitch: () => void }) {
  return <div className="race-host"><div className="race-loading-header"><span className="race-eyebrow">RACE CONTROL / HOST CONSOLE</span></div>
    <main className="race-main"><div className="race-empty board-empty" role="alert">
      <TriangleAlert size={32} aria-hidden="true" /><h1 className="race-error-title">We could not load your board.</h1>
      <p>The game server could not load your session. This can happen even when your internet is working. Try again in a moment.</p>
      <div className="race-error-actions"><button type="button" className="btn-primary" disabled={retrying} onClick={onRetry}>
        {retrying ? <LoaderCircle size={16} className="race-spinner" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}{retrying ? "Trying again..." : "Try again"}</button>
        <button type="button" className="btn-secondary" onClick={onSwitch}>Switch session</button></div>
    </div></main>
  </div>;
}
