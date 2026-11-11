import assert from "node:assert/strict";
import { test } from "node:test";

import { advanceTable, createTable, reconcileTable, DISCARD_MS, DEAL_MS } from "../src/lib/cardTable.ts";
import type { Challenge } from "../src/lib/types.ts";

const challenge = (id: string): Challenge => ({
  id, title: id, location_area: "Marina Bay", completion_condition: "Take a group photo.",
  image_url: null, clue_tier: "tier1", status: "open", claimed_by_team_id: null,
  sort_order: 1, updated_at: "2026-11-11", my_submission: null,
});
const options = { visible: true, revealVersion: 1, reducedMotion: false, now: 0 };

test("reveal deals every card, then settles face-up", () => {
  const table = reconcileTable(createTable(), [challenge("a"), challenge("b")], options);
  assert.deepEqual(table.cards.map(c => c.phase), ["dealing", "dealing"]);
  assert.ok(table.cards[1].endsAt > table.cards[0].endsAt);
  assert.deepEqual(advanceTable(table, DEAL_MS + 1000).cards.map(c => c.phase), ["settled", "settled"]);
});

test("ordinary snapshots update details without replaying or moving cards", () => {
  const before = advanceTable(reconcileTable(createTable(), [challenge("a"), challenge("b")], options), 3000);
  const after = reconcileTable(before, [{ ...challenge("b"), status: "pending_approval" }, challenge("a")], { ...options, now: 4000 });
  assert.deepEqual(after.cards.map(c => [c.key, c.slot, c.phase]), before.cards.map(c => [c.key, c.slot, c.phase]));
  assert.equal(after.cards.find(c => c.challenge.id === "b")?.challenge.status, "pending_approval");
});

test("a removed card discards before its replacement draws into the same slot", () => {
  const before = advanceTable(reconcileTable(createTable(), [challenge("a"), challenge("b")], options), 3000);
  const removed = reconcileTable(before, [challenge("b"), challenge("c")], { ...options, now: 4000 });
  assert.equal(removed.cards.find(c => c.challenge.id === "a")?.phase, "discarding");
  assert.ok(!removed.cards.some(c => c.challenge.id === "c"));
  const drawn = advanceTable(removed, 4000 + DISCARD_MS);
  assert.equal(drawn.discarded, 1);
  assert.equal(drawn.cards.find(c => c.challenge.id === "c")?.slot, 0);
  assert.equal(drawn.cards.find(c => c.challenge.id === "c")?.phase, "dealing");
  assert.equal(drawn.cards.find(c => c.challenge.id === "b")?.key, before.cards[1].key);
});

test("rapid updates only draw the latest replacement", () => {
  let table = reconcileTable(createTable(), [challenge("a"), challenge("b")], options);
  table = reconcileTable(table, [challenge("b"), challenge("c")], { ...options, now: 3000 });
  table = reconcileTable(table, [challenge("b"), challenge("d")], { ...options, now: 3100 });
  table = advanceTable(table, 4000);
  assert.deepEqual(table.cards.map(c => c.challenge.id).sort(), ["b", "d"]);
});

test("hiding immediately clears details and cancels outstanding draws", () => {
  let table = reconcileTable(createTable(), [challenge("a")], options);
  table = reconcileTable(table, [], { ...options, visible: false, now: 10 });
  assert.deepEqual(advanceTable(table, 10000).cards, []);
  assert.deepEqual(table.pending, []);
});

test("a new reveal version replays the flop even if hide was missed", () => {
  const before = advanceTable(reconcileTable(createTable(), [challenge("a")], options), 3000);
  const after = reconcileTable(before, [challenge("a")], { ...options, revealVersion: 2, now: 4000 });
  assert.equal(after.cards[0].phase, "dealing");
  assert.notEqual(after.cards[0].key, before.cards[0].key);
});

test("reduced motion applies replacements immediately", () => {
  let table = reconcileTable(createTable(), [challenge("a")], { ...options, reducedMotion: true });
  table = reconcileTable(table, [challenge("b")], { ...options, reducedMotion: true, now: 3000 });
  assert.deepEqual(table.cards.map(c => [c.challenge.id, c.phase]), [["b", "settled"]]);
});

test("reappearing cards cancel a pending discard", () => {
  let table = reconcileTable(createTable(), [challenge("a")], options);
  table = reconcileTable(table, [], { ...options, now: 3000 });
  table = reconcileTable(table, [challenge("a")], { ...options, now: 3100 });
  table = advanceTable(table, 10000);
  assert.equal(table.cards[0].challenge.id, "a");
  assert.equal(table.cards[0].phase, "settled");
});
