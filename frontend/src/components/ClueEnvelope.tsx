import { Mail, MailOpen } from "lucide-react";
import type { Tier } from "../lib/types";

export function ClueEnvelope({ tier, count = 0, reward = false }: { tier: Tier; count?: number; reward?: boolean }) {
  const rank = { tier1: "I", tier2: "II", tier3: "III" }[tier];
  const Icon = count > 0 && !reward ? MailOpen : Mail;
  return <span role="img" className={`clue-envelope ${count > 0 && !reward ? "clue-envelope--opened" : ""} ${reward ? "clue-envelope--reward" : ""}`}
    aria-label={reward ? `Unlocks a Tier ${rank} clue` : `Tier ${rank}: ${count} ${count === 1 ? "clue" : "clues"} opened`}>
    <Icon size={reward ? 16 : 20} aria-hidden="true" />
    {!reward ? <span aria-hidden="true">{rank} {"\u00b7"} {count}</span> : null}
  </span>;
}
