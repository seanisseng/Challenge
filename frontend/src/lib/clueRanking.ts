import type {TeamProgress, Tier} from './types';

type TeamTierCounts = Record<string, Record<Tier, number>>;

/** Unknown tier breakdowns must not be ranked as if all clues were Tier 1. */
export function clueValue(row: TeamProgress, counts: TeamTierCounts): number | null {
  const earned = counts[row.team_id];
  if (!earned) return row.clue_count === 0 ? 0 : null;
  if (earned.tier1 + earned.tier2 + earned.tier3 !== row.clue_count) return null;
  return earned.tier1 + 2 * earned.tier2 + 3 * earned.tier3;
}

export function rankTeams(rows: TeamProgress[], counts: TeamTierCounts): TeamProgress[] {
  return [...rows].sort((a,b) =>
    (clueValue(b,counts) ?? -1) - (clueValue(a,counts) ?? -1)
    || a.team_name.localeCompare(b.team_name) || a.team_id.localeCompare(b.team_id));
}

export function leadingTeam(rows: TeamProgress[], counts: TeamTierCounts): string | undefined {
  const values = rows.map(row => clueValue(row,counts));
  if (values.includes(null)) return undefined;
  const top = Math.max(0,...values.map(value => value ?? 0));
  const leaders = rows.filter((_,index) => values[index] === top);
  return top > 0 && leaders.length === 1 ? leaders[0].team_id : undefined;
}
