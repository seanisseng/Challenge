/**
 * Thin fetch wrapper around the FastAPI backend.
 *
 * Game data reads and writes go through the backend, which holds the
 * service-role key. Reference photos load from public storage URLs.
 * Identity travels in a header:
 * `X-Team-Token` for players, `X-Admin-Token` for the host.
 */

import type {
  AdminState,
  Clue,
  CreatedSession,
  SessionSummary,
  TeamState,
  Tier,
} from "./types";

export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

const TEAM_TOKEN_KEY = "challenge.team-token";
const ADMIN_TOKEN_KEY = "challenge.admin-token";
const ADMIN_SESSION_KEY = "challenge.admin-session";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// --------------------------------------------------------------------------
// token storage
// --------------------------------------------------------------------------
export function getTeamToken(): string | null {
  try {
    return localStorage.getItem(TEAM_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setTeamToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TEAM_TOKEN_KEY, token);
    else localStorage.removeItem(TEAM_TOKEN_KEY);
  } catch {
    /* private mode — session simply won't survive a reload */
  }
}

export function getAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function getAdminSession(): string | null {
  try {
    return localStorage.getItem(ADMIN_SESSION_KEY);
  } catch {
    return null;
  }
}

export function setAdminSession(id: string | null): void {
  try {
    if (id) localStorage.setItem(ADMIN_SESSION_KEY, id);
    else localStorage.removeItem(ADMIN_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

// --------------------------------------------------------------------------
// request plumbing
// --------------------------------------------------------------------------
interface RequestOptions {
  method?: string;
  body?: unknown;
  teamToken?: string | null;
  adminToken?: string | null;
  formData?: FormData;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = options.teamToken ?? getTeamToken();
  const admin = options.adminToken ?? getAdminToken();

  if (token) headers["X-Team-Token"] = token;
  if (admin) headers["X-Admin-Token"] = admin;

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData; // let the browser set the multipart boundary
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(
      `cannot reach the backend at ${API_BASE_URL} — is it running?`,
      0,
    );
  }

  if (!response.ok) {
    let detail = `request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === "string") detail = payload.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// --------------------------------------------------------------------------
// player
// --------------------------------------------------------------------------
export async function joinTeam(code: string, name: string): Promise<TeamState> {
  const result = await request<{ token: string; state: TeamState }>("/api/join", {
    method: "POST",
    body: { code: code.trim(), name: name.trim() },
    teamToken: null,
    adminToken: null,
  });
  setTeamToken(result.token);
  return result.state;
}

export function fetchTeamState(token?: string): Promise<TeamState> {
  return request<TeamState>("/api/state", { teamToken: token });
}

export function fetchClues(): Promise<Clue[]> {
  return request<Clue[]>("/api/clues");
}

export function submitProof(
  challengeId: string,
  file: File,
): Promise<{ ok: boolean; photo_path: string }> {
  const form = new FormData();
  form.append("challenge_id", challengeId);
  form.append("file", file);
  return request<{ ok: boolean; photo_path: string }>("/api/submissions", {
    method: "POST",
    formData: form,
  });
}

// --------------------------------------------------------------------------
// admin
// --------------------------------------------------------------------------
export async function adminLogin(pin: string): Promise<string> {
  const result = await request<{ token: string }>("/api/admin/login", {
    method: "POST",
    body: { pin },
    adminToken: null,
    teamToken: null,
  });
  setAdminToken(result.token);
  return result.token;
}

export function listSessions(): Promise<SessionSummary[]> {
  return request<SessionSummary[]>("/api/admin/sessions");
}

export function createSession(input: {
  name: string;
  team_count: number;
  active_task_limit: number;
}): Promise<CreatedSession> {
  return request<CreatedSession>("/api/admin/sessions", {
    method: "POST",
    body: input,
  });
}

export function fetchAdminState(sessionId: string): Promise<AdminState> {
  return request<AdminState>(`/api/admin/sessions/${sessionId}/state`);
}

export function startSession(sessionId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/admin/sessions/${sessionId}/start`, {
    method: "POST",
  });
}

export function setBoardVisibility(sessionId: string, visible: boolean): Promise<{ ok: boolean }> {
  return request(`/api/admin/sessions/${sessionId}/board/${visible ? "reveal" : "hide"}`, {
    method: "POST",
  });
}

export function deferChallenge(sessionId: string, challengeId: string): Promise<{ ok: boolean }> {
  return request(`/api/admin/sessions/${sessionId}/challenges/${challengeId}/defer`, {
    method: "POST",
  });
}

export function discardChallenge(sessionId: string, challengeId: string): Promise<{ ok: boolean }> {
  return request(`/api/admin/sessions/${sessionId}/challenges/${challengeId}/discard`, { method: "POST" });
}

export function reorderQueue(sessionId: string, challengeIds: string[], expectedIds: string[]): Promise<{ ok: boolean }> {
  return request(`/api/admin/sessions/${sessionId}/queue/reorder`, {
    method: "POST", body: { challenge_ids: challengeIds, expected_ids: expectedIds },
  });
}

export function endSession(sessionId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/admin/sessions/${sessionId}/end`, {
    method: "POST",
  });
}

export function approveSubmission(
  submissionId: string,
  note?: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/api/admin/submissions/${submissionId}/approve`,
    { method: "POST", body: { note: note ?? null } },
  );
}

export function rejectSubmission(
  submissionId: string,
  note?: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/api/admin/submissions/${submissionId}/reject`,
    { method: "POST", body: { note: note ?? null } },
  );
}

export function submissionPhoto(submissionId: string): Promise<{ url: string }> {
  return request<{ url: string }>(
    `/api/admin/submissions/${submissionId}/photo`,
  );
}

export function addChallenge(
  sessionId: string,
  input: {
    title: string;
    location_area: string | null;
    completion_condition: string;
    clue_tier: Tier;
    sort_order: number;
  },
): Promise<{ id: string }> {
  return request<{ id: string }>(`/api/admin/sessions/${sessionId}/challenges`, {
    method: "POST",
    body: input,
  });
}

export function uploadChallengeImage(
  sessionId: string,
  challengeId: string,
  file: File,
): Promise<{ ok: boolean; image_url: string }> {
  const form = new FormData();
  form.append("file", file);
  return request(`/api/admin/sessions/${sessionId}/challenges/${challengeId}/image`, {
    method: "POST",
    formData: form,
  });
}

export function addClue(
  sessionId: string,
  input: {
    tier: Tier;
    title: string;
    body: string;
    media_url: string | null;
    sort_order: number;
  },
): Promise<unknown> {
  return request(`/api/admin/sessions/${sessionId}/clues`, {
    method: "POST",
    body: input,
  });
}

export function listClues(sessionId: string): Promise<Clue[]> {
  return request<Clue[]>(`/api/admin/sessions/${sessionId}/clues`);
}

export function removeMember(memberId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/admin/members/${memberId}`, {
    method: "DELETE",
  });
}

// --------------------------------------------------------------------------
// websocket
// --------------------------------------------------------------------------
export function teamSocketUrl(token: string): string {
  const base = API_BASE_URL.replace(/^http/, "ws");
  return `${base}/ws?token=${encodeURIComponent(token)}`;
}

export function adminSocketUrl(token: string, sessionId: string): string {
  const base = API_BASE_URL.replace(/^http/, "ws");
  return `${base}/ws?admin_token=${encodeURIComponent(
    token,
  )}&session_id=${encodeURIComponent(sessionId)}`;
}
