import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clueValue, leadingTeam, rankTeams} from '../src/lib/clueRanking.ts';
import type {TeamProgress, Tier} from '../src/lib/types';

const team = (id: string, total: number): TeamProgress => ({team_id:id,team_name:id,member_count:1,clue_count:total,claimed_count:total});
const counts: Record<string, Record<Tier, number>> = {
  A:{tier1:1,tier2:1,tier3:1}, B:{tier1:0,tier2:2,tier3:1},
  C:{tier1:4,tier2:0,tier3:0}, D:{tier1:0,tier2:0,tier3:2},
};

test('tier weights determine the leader and ordering without changing clue counts', () => {
  const rows = [team('A',3),team('B',3),team('C',4)];
  assert.equal(clueValue(rows[0],counts),6);
  assert.equal(clueValue(rows[1],counts),7);
  assert.equal(leadingTeam(rows,counts),'B');
  assert.deepEqual(rankTeams(rows,counts).map(row=>row.team_id),['B','A','C']);
  assert.deepEqual(rows.map(row=>row.team_id),['A','B','C']);
  assert.equal(rows[1].clue_count,3);
});

test('equal weighted totals and empty collections have no single leader', () => {
  const rows=[team('D',2),team('A',3)];
  assert.equal(leadingTeam(rows,counts),undefined);
  assert.deepEqual(rankTeams(rows,counts).map(row=>row.team_id),['A','D']);
  assert.equal(leadingTeam([team('empty',0)],{}),undefined);
  assert.equal(leadingTeam([],{}),undefined);
});

test('incomplete tier data cannot name a misleading leader', () => {
  const rows=[team('A',3),team('unknown',4)];
  assert.equal(clueValue(rows[1],counts),null);
  assert.equal(clueValue(team('A',4),counts),null);
  assert.equal(leadingTeam(rows,counts),undefined);
  assert.equal(leadingTeam([team('A',3)],counts),'A');
});
