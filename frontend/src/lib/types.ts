/**
 * Types mirroring the snapshots the backend pushes over the WebSocket.
 *
 * There is one source of truth: `backend/app/snapshots.py`. If you change a
 * payload there, change it here too.
 */

export type Tier = "tier1" | "tier2" | "tier3";
export type SessionStatus = "lobby" | "active" | "ended";
export type ChallengeStatus = "open" | "pending_approval" | "claimed";
export type SubmissionStatus = "pending" | "approved" | "rejected";

export interface SessionInfo {
  id: string;
  name: string;
  room_code: string;
  status: SessionStatus;
  team_count: number;
  active_task_limit: number;
}

export interface SubmissionSummary {
  id: string;
  status: SubmissionStatus;
  review_note: string | null;
  submitted_at: string;
}

export interface Challenge {
  id: string;
  title: string;
  location_area: string | null;
  completion_condition: string;
  clue_tier: Tier;
  status: ChallengeStatus;
  claimed_by_team_id: string | null;
  sort_order: number;
  updated_at: string;
  /** Only present on the player payload. */
  my_submission?: SubmissionSummary | null;
}

export interface TeamProgress {
  team_id: string;
  team_name: string;
  member_count: number;
  clue_count: number;
  claimed_count: number;
}

export interface Clue {
  id: string;
  tier: Tier;
  title: string;
  body: string;
  media_url: string | null;
  unlocked_at: string;
}

export interface SubmissionRecord {
  id: string;
  challenge_id: string;
  status: SubmissionStatus;
  photo_path: string;
  review_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  team_member_id: string | null;
}

export interface TeamState {
  kind: "team";
  session: SessionInfo;
  me: { id: string; name: string };
  team: { id: string; name: string };
  board: Challenge[];
  progress: TeamProgress[];
  clues: Clue[];
  my_submissions: SubmissionRecord[];
}

export interface AdminSubmission {
  id: string;
  session_id: string;
  challenge_id: string;
  team_id: string;
  team_member_id: string | null;
  photo_path: string;
  status: SubmissionStatus;
  review_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  challenges: { title: string } | null;
  teams: { name: string } | null;
  team_members: { name: string } | null;
}

export interface AdminTeam {
  id: string;
  name: string;
  join_code: string;
  members: { id: string; name: string }[];
}

export interface AdminState {
  kind: "admin";
  session: SessionInfo;
  board: Challenge[];
  progress: TeamProgress[];
  teams: AdminTeam[];
  submissions: AdminSubmission[];
}

export interface SessionSummary {
  id: string;
  room_code: string;
  name: string;
  status: SessionStatus;
  team_count: number;
  active_task_limit: number;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface CreatedSession {
  session: SessionInfo;
  teams: AdminTeam[];
}

export const TIER_LABEL: Record<Tier, string> = {
  tier1: "Tier 1",
  tier2: "Tier 2",
  tier3: "Tier 3",
};

export const TIER_HINT: Record<Tier, string> = {
  tier1: "Macro direction",
  tier2: "Landmark anchor",
  tier3: "Precision pin",
};
