import { Check, ChevronRight, Circle, Clock3, LoaderCircle, WifiOff, X } from "lucide-react";
import type { ChallengeStatus, SubmissionStatus, Tier } from "../lib/types";

export function TierBadge({ tier }: { tier: Tier }) {
  const number = Number(tier.slice(-1));
  return (
    <span className={`tier-stamp tier-stamp--${tier}`} aria-label={`Tier ${number}`}>
      <span className="tier-stamp-number" aria-hidden="true">{number}</span>
      <span className="tier-stamp-copy"><span>TIER {number}</span>
        <span className="tier-chevron" aria-hidden="true">{Array.from({ length: number }, (_, i) => <ChevronRight key={i} size={10} strokeWidth={3} />)}</span>
      </span>
    </span>
  );
}

export function ChallengeStatusBadge({ status }: { status: ChallengeStatus }) {
  const Icon = status === "claimed" ? Check : status === "pending_approval" ? Clock3 : Circle;
  return <span className={`race-status race-status--${status === "claimed" ? "done" : status === "pending_approval" ? "pending" : "open"}`}>
    <Icon size={13} aria-hidden="true" />{status === "claimed" ? "Done" : status === "pending_approval" ? "Pending" : "Open"}
  </span>;
}

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  const Icon = status === "approved" ? Check : status === "rejected" ? X : Clock3;
  return <span className={`race-status race-status--${status === "approved" ? "done" : status === "rejected" ? "rejected" : "pending"}`}>
    <Icon size={13} aria-hidden="true" />{status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Pending"}
  </span>;
}

export function LivePill({ status }: { status: "connecting" | "live" | "offline" }) {
  return <span className={`connection-indicator connection-indicator--${status}`} role="status">
    {status === "live" ? <span className="live-dot" aria-hidden="true" />
      : status === "offline" ? <WifiOff size={14} aria-hidden="true" /> : <LoaderCircle className="race-spinner" size={14} aria-hidden="true" />}
    {status === "live" ? "Live connection" : status === "offline" ? "Offline" : "Connecting"}
  </span>;
}
