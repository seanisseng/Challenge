import { Ticket, Users } from "lucide-react";
import type { TeamProgress, Tier } from "../lib/types";
import { TeamLabelSticker, TierSticker, type StickerTier } from "./TierSticker";

export type TierCounts = Record<Tier, number>;
export const emptyTierCounts = (): TierCounts => ({ tier1: 0, tier2: 0, tier3: 0 });
const tiers: StickerTier[] = ["1", "2", "3"];

export function TeamProgressCards({ rows, counts, ownTeamId, codes, finishedTeamIds = [], host = false }: {
  rows: TeamProgress[]; counts: Record<string, TierCounts>; ownTeamId?: string;
  codes?: Record<string, string>; finishedTeamIds?: string[]; host?: boolean;
}) {
  const top = Math.max(0, ...rows.map(row => row.clue_count));
  const leader = top > 0 && rows.filter(row => row.clue_count === top).length === 1
    ? rows.find(row => row.clue_count === top)?.team_id : undefined;
  return <ul className={`team-sticker-cards${host ? " team-sticker-cards--host" : ""}`}>
    {rows.map(row => {
      const earned = counts[row.team_id] ?? emptyTierCounts();
      const completeBreakdown = Object.values(earned).reduce((sum, count) => sum + count, 0) === row.clue_count;
      return <li key={row.team_id} className={`team-sticker-card${row.team_id === ownTeamId ? " team-sticker-card--mine" : ""}`}>
        <div className="team-card-labels">
          {row.team_id === ownTeamId ? <TeamLabelSticker label="YOU" /> : null}
          {finishedTeamIds.includes(row.team_id) ? <TeamLabelSticker label="FINISHED" /> : null}
          {row.team_id === leader ? <TeamLabelSticker label="LEADING" /> : null}
        </div>
        <div className="team-card-heading"><strong title={row.team_name}>{row.team_name}</strong>
          <span className="team-card-members"><Users size={15} aria-hidden="true" />{row.member_count} {row.member_count === 1 ? "player" : "players"}</span>
        </div>
        {host ? <p className="team-card-code">JOIN CODE <span>{codes?.[row.team_id] ?? "—"}</span></p> : null}
        <div className="team-card-collection"><div className="team-card-stickers" role={completeBreakdown ? "group" : "img"}
          aria-label={completeBreakdown ? "Tier collection" : `Full tier breakdown unavailable. Known awards: Tier 1, ${earned.tier1}; Tier 2, ${earned.tier2}; Tier 3, ${earned.tier3}. Empty slots may have unreported awards.`}>
          {tiers.map(tier => <TierSticker key={tier} tier={tier} count={earned[`tier${tier}`]} state={earned[`tier${tier}`] > 0 ? "earned" : "empty"} size={host ? "md" : "sm"} />)}
        </div><div className="team-card-total" aria-label={`${row.clue_count} total clues`}><strong>{row.clue_count}</strong><span>CLUES</span></div></div>
        {!completeBreakdown ? <p className="team-card-data-note">Full tier breakdown unavailable</p> : null}
      </li>;
    })}
  </ul>;
}

export function TeamProgressSkeleton({ host = false }: { host?: boolean }) {
  return <div role="status" aria-label="Loading team progress"><span className="sr-only">Loading team progress…</span>
    <div className={`team-sticker-cards${host ? " team-sticker-cards--host" : ""}`} aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => <div className="team-sticker-card team-sticker-skeleton" key={i}><span className="team-skeleton-name" /><div className="team-card-stickers">{tiers.map(tier => <TierSticker key={tier} tier={tier} state="empty" count={0} size={host ? "md" : "sm"} />)}</div></div>)}
    </div>
  </div>;
}

export function NoTeams() {
  return <div className="race-empty"><Ticket size={30} aria-hidden="true" /><h3>The field is getting ready.</h3><p>Team sticker collections will appear here when teams join.</p></div>;
}
