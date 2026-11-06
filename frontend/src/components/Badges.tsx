import type { ChallengeStatus, SubmissionStatus, Tier } from "../lib/types";

// Every badge pairs a very light tint with a dark, saturated foreground, which
// keeps them readable at a glance in bright outdoor light.
const tierStyles: Record<Tier, string> = {
  tier1: "bg-sky-50 text-sky-800 ring-sky-600/25",
  tier2: "bg-amber-50 text-amber-800 ring-amber-600/25",
  tier3: "bg-rose-50 text-rose-800 ring-rose-600/25",
};

const tierNames: Record<Tier, string> = {
  tier1: "Tier 1",
  tier2: "Tier 2",
  tier3: "Tier 3",
};

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${tierStyles[tier]}`}
    >
      🔑 {tierNames[tier]}
    </span>
  );
}

const challengeStyles: Record<ChallengeStatus, string> = {
  open: "bg-emerald-50 text-emerald-800 ring-emerald-600/25",
  pending_approval: "bg-indigo-50 text-indigo-800 ring-indigo-600/25",
  claimed: "bg-slate-100 text-slate-600 ring-slate-400/40",
};

const challengeNames: Record<ChallengeStatus, string> = {
  open: "Open",
  pending_approval: "Pending approval",
  claimed: "Claimed",
};

export function ChallengeStatusBadge({ status }: { status: ChallengeStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${challengeStyles[status]}`}
    >
      {challengeNames[status]}
    </span>
  );
}

const submissionStyles: Record<SubmissionStatus, string> = {
  pending: "bg-indigo-50 text-indigo-800 ring-indigo-600/25",
  approved: "bg-emerald-50 text-emerald-800 ring-emerald-600/25",
  rejected: "bg-rose-50 text-rose-800 ring-rose-600/25",
};

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ring-1 ring-inset ${submissionStyles[status]}`}
    >
      {status}
    </span>
  );
}

export function LivePill({
  status,
}: {
  status: "connecting" | "live" | "offline";
}) {
  const live = status === "live";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${
        live
          ? "bg-emerald-50 text-emerald-800 ring-emerald-600/25"
          : "bg-amber-50 text-amber-800 ring-amber-600/25"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          live ? "bg-emerald-500" : "bg-amber-500"
        }`}
      />
      {live ? "Live" : status === "connecting" ? "Connecting" : "Offline"}
    </span>
  );
}
