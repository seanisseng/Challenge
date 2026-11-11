import { LoaderCircle, RefreshCw, TriangleAlert, WifiOff } from "lucide-react";

export function ConnectionNotice({ status, error, retrying, onRetry }: {
  status: "connecting" | "live" | "offline";
  error: string | null;
  retrying: boolean;
  onRetry: () => void;
}) {
  const offline = status === "offline" || Boolean(error?.includes("cannot reach the backend"));
  if (!offline && !error) return null;
  const Icon = offline ? WifiOff : TriangleAlert;
  return <div className={`connection-notice ${offline ? "connection-notice--offline" : "connection-notice--error"}`} role="alert">
    <span className="connection-notice-icon"><Icon size={22} aria-hidden="true" /></span>
    <div><strong>{offline ? "Connection interrupted" : "That change did not go through"}</strong>
      <p>{offline ? "Your last board is still here. We are reconnecting automatically; you can also try again." : error}</p>
    </div>
    {offline ? <button type="button" className="btn-secondary" disabled={retrying} onClick={onRetry}>
      {retrying ? <LoaderCircle size={16} className="race-spinner" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
      {retrying ? "Trying again..." : "Try again"}
    </button> : null}
  </div>;
}

export function BoardUnavailable({ retrying, onRetry, onSwitch }: { retrying: boolean; onRetry: () => void; onSwitch: () => void }) {
  return <div className="race-host"><div className="race-loading-header"><span className="race-eyebrow">RACE CONTROL / HOST CONSOLE</span></div>
    <main className="race-main"><div className="race-empty board-empty" role="alert">
      <WifiOff size={32} aria-hidden="true" /><h1 className="race-error-title">We could not load your board.</h1>
      <p>Check your connection, then try again. Your game and challenge order have not been changed.</p>
      <div className="race-error-actions"><button type="button" className="btn-primary" disabled={retrying} onClick={onRetry}>
        {retrying ? <LoaderCircle size={16} className="race-spinner" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}{retrying ? "Trying again..." : "Try again"}</button>
        <button type="button" className="btn-secondary" onClick={onSwitch}>Switch session</button></div>
    </div></main>
  </div>;
}
