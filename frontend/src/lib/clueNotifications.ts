import type { TeamState } from "./types.ts";

type Snapshot = Pick<TeamState, "session" | "team" | "clues" | "clue_awards" | "my_submissions">;

export interface ClueCursor {
  sessionId: string;
  teamId: string;
  clueIds: Set<string>;
  awardIds: Set<string>;
  rejectedIds: Set<string>;
  hasPublicBaseline: boolean;
}

export function createClueCursor(snapshot: Snapshot): ClueCursor {
  return { sessionId: snapshot.session.id, teamId: snapshot.team.id,
    clueIds: new Set(snapshot.clues.map(clue => clue.id)),
    awardIds: new Set((snapshot.clue_awards ?? []).map(award => award.id)),
    rejectedIds: new Set(snapshot.my_submissions.filter(proof => proof.status === "rejected").map(proof => proof.id)),
    hasPublicBaseline: snapshot.clue_awards !== undefined };
}

export function readClueUpdates(previous: ClueCursor, snapshot: Snapshot) {
  if (previous.sessionId !== snapshot.session.id || previous.teamId !== snapshot.team.id) {
    return { cursor: createClueCursor(snapshot), clues: [], awards: [], rejections: [] };
  }
  const cursor = { ...previous, clueIds: new Set(previous.clueIds), awardIds: new Set(previous.awardIds), rejectedIds: new Set(previous.rejectedIds),
    hasPublicBaseline: previous.hasPublicBaseline || snapshot.clue_awards !== undefined };
  const clues = snapshot.clues.filter(clue => {
    const fresh = !cursor.clueIds.has(clue.id);
    cursor.clueIds.add(clue.id);
    return fresh;
  });
  const awards = (snapshot.clue_awards ?? []).filter(award => {
    const fresh = previous.hasPublicBaseline && !cursor.awardIds.has(award.id);
    cursor.awardIds.add(award.id);
    return fresh && award.team_id !== snapshot.team.id;
  }).sort((a, b) => a.awarded_at.localeCompare(b.awarded_at));
  const rejections = snapshot.my_submissions.filter(proof => {
    if (proof.status !== "rejected" || cursor.rejectedIds.has(proof.id)) return false;
    cursor.rejectedIds.add(proof.id);
    return true;
  });
  return { cursor, clues, awards, rejections };
}
