import assert from "node:assert/strict";
import { test } from "node:test";
import { createClueCursor, readClueUpdates } from "../src/lib/clueNotifications.ts";
import type { ClueAward, SubmissionRecord, TeamState } from "../src/lib/types.ts";

function snapshot(): TeamState & { clue_awards: ClueAward[] } {
  return { kind: "team", session: { id: "room", name: "Game", room_code: "ROOM", status: "active", team_count: 2, active_task_limit: 6, board_visible: true, board_reveal_version: 1 },
    team: { id: "mine", name: "Mine" }, me: { id: "member", name: "Player" }, board: [], progress: [],
    clues: [{ id: "old", tier: "tier1", title: "Existing", body: "Existing clue", media_url: null, unlocked_at: "2026-11-12T09:00:00Z" }],
    my_submissions: [], clue_awards: [{ id: "old-event", team_id: "rival", team_name: "Rival", tier: "tier1", awarded_at: "2026-11-12T10:00:00Z" }] };
}

test("existing clues and award history never announce on join or identical snapshots", () => {
  const initial = snapshot();
  const changes = readClueUpdates(createClueCursor(initial), structuredClone(initial));
  assert.deepEqual(changes.clues, []);
  assert.deepEqual(changes.awards, []);
});

test("new own clue and rival award announce once without exposing rival clue text", () => {
  const initial = snapshot();
  const next = snapshot();
  next.clues.push({ ...next.clues[0], id: "new", tier: "tier2" });
  next.clue_awards.push({ id: "new-event", team_id: "rival", team_name: "Rival", tier: "tier3", awarded_at: "2026-11-12T10:01:00Z" });
  next.clue_awards.push({ id: "own-event", team_id: "mine", team_name: "Mine", tier: "tier2", awarded_at: "2026-11-12T10:01:00Z" });
  const changes = readClueUpdates(createClueCursor(initial), next);
  assert.deepEqual(changes.clues.map(clue => clue.id), ["new"]);
  assert.deepEqual(changes.awards.map(award => award.id), ["new-event"]);
  const replay = readClueUpdates(changes.cursor, structuredClone(next));
  assert.deepEqual(replay.clues, []);
  assert.deepEqual(replay.awards, []);
});

test("switching rooms resets the baseline and a new optional event feed does not replay history", () => {
  const initial = snapshot();
  const legacy = { ...initial, clue_awards: undefined };
  assert.deepEqual(readClueUpdates(createClueCursor(legacy), initial).awards, []);
  const otherRoom = { ...initial, session: { ...initial.session, id: "other" } };
  const reset = readClueUpdates(createClueCursor(legacy), otherRoom);
  assert.deepEqual(reset.clues, []);
  assert.deepEqual(reset.awards, []);
});

test("removed and later restored clue IDs are not new rewards", () => {
  const initial = snapshot();
  const empty = { ...initial, clues: [] };
  const removed = readClueUpdates(createClueCursor(initial), empty);
  assert.deepEqual(readClueUpdates(removed.cursor, initial).clues, []);
});

test("private rejected proofs appear once and never produce public announcements", () => {
  const proof: SubmissionRecord = { id: "proof", status: "pending", review_note: null, challenge_id: "challenge", photo_path: "private/proof.jpg", submitted_at: "2026-11-12T10:00:00Z", reviewed_at: null, team_member_id: "member" };
  const initial = { ...snapshot(), my_submissions: [proof] };
  const rejected = { ...snapshot(), my_submissions: [{ ...proof, status: "rejected" as const, review_note: "Include the whole team" }] };
  const updates = readClueUpdates(createClueCursor(initial), rejected);
  assert.deepEqual(updates.rejections.map(proof => proof.id), ["proof"]);
  assert.deepEqual(updates.awards, []);
  assert.deepEqual(readClueUpdates(updates.cursor, rejected).rejections, []);
  assert.deepEqual(readClueUpdates(createClueCursor(rejected), rejected).rejections, []);
});

test("simultaneous rival awards are chronological and duplicate event IDs announce only once", () => {
  const initial = snapshot();
  const first = { ...initial.clue_awards[0], id: "first", awarded_at: "2026-11-12T10:01:00Z" };
  const later = { ...first, id: "later", awarded_at: "2026-11-12T10:02:00Z" };
  const next = { ...initial, clue_awards: [later, first, first, ...initial.clue_awards] };
  assert.deepEqual(readClueUpdates(createClueCursor(initial), next).awards.map(award => award.id), ["first", "later"]);
});
