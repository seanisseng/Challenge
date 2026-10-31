import type { ChallengeStatus, SubmissionStatus, Tier } from "../lib/types";

const tierStyles: Record<Tier, string> = {
  tier1: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  tier2: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  tier3: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
};

const tierNames: Record<Tier, string> = {
  tier1: "Tier 1",
  tier2: "Tier 2",
  tier3: "Tier 3",
};

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${tierStyles[tier]}`}
    >
      🔑 {tierNames[tier]}
    </span>
  );
}

const challengeStyles: Record<ChallengeStatus, string> = {
  open: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  pending_approval: "bg-indigo-500/15 text-indigo-300 ring-indigo-500/30",
  claimed: "bg-slate-600/30 text-slate-400 ring-slate-600/40",
};

const challengeNames: Record<ChallengeStatus, string> = {
  open: "Open",
  pending_approval: "Pending approval",
  claimed: "Claimed",
};

export function ChallengeStatusBadge({ status }: { status: ChallengeStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${challengeStyles[status]}`}
    >
      {challengeNames[status]}
    </span>
  );
}

const submissionStyles: Record<SubmissionStatus, string> = {
  pending: "bg-indigo-500/15 text-indigo-300 ring-indigo-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  rejected: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
};

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ring-1 ${submissionStyles[status]}`}
    >
      {status}
    </span>
  );
}
