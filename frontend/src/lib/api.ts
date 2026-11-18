import type { MapPoint,MapStage } from "./gameMap";
import type {SubmissionDraft} from './submissionDraft';
import type {EvidenceAttachment} from './types';
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
export interface LocationAccess {device_id:string;lease:string}
let locationAccess:LocationAccess|null=null;
export function setLocationAccess(access:LocationAccess|null) {locationAccess=access;}

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
  if(!token)locationAccess=null;
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
  if(token&&locationAccess){headers['X-Location-Device']=locationAccess.device_id;headers['X-Location-Lease']=locationAccess.lease;}
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
      else if (Array.isArray(payload.detail)) detail=payload.detail.map(item=>item && typeof item==='object' && 'msg' in item ? String(item.msg).replace(/^Value error, /,'') : '').filter(Boolean).slice(0,2).join('. ') || detail;
      else if (Array.isArray(payload.detail)) detail = payload.detail.map(item => typeof item?.msg === "string" ? item.msg.replace(/^Value error, /, "") : "").filter(Boolean).slice(0, 2).join(". ") || detail;
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
export async function joinTeam(code: string): Promise<TeamState> {
  const result = await request<{ token: string; state: TeamState }>("/api/join", {
    method: "POST",
    body: { code: code.trim() },
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
  draft: SubmissionDraft,
): Promise<{ ok: boolean; photo_path: string|null }> {
  const form = new FormData();
  form.append("challenge_id", challengeId);
  for(const file of draft.files)form.append('files',file);
  form.append('text',draft.text.trim());
  return request<{ ok: boolean; photo_path: string|null }>("/api/submissions", {
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

export function deleteSession(sessionId: string): Promise<{ ok: boolean }> {
  return request(`/api/admin/sessions/${sessionId}`, { method: "DELETE" });
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

export function submissionPhoto(submissionId: string): Promise<{ url: string|null;attachments?:EvidenceAttachment[];text?:string }> {
  return request<{ url: string|null;attachments?:EvidenceAttachment[];text?:string }>(
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
export function teamSocketUrl(token: string,access?:LocationAccess|null): string {
  const base = API_BASE_URL.replace(/^http/, "ws");
  return `${base}/ws?token=${encodeURIComponent(token)}`+(access?`&location_device=${encodeURIComponent(access.device_id)}&location_lease=${encodeURIComponent(access.lease)}`:'');
}

export function adminSocketUrl(token: string, sessionId: string): string {
  const base = API_BASE_URL.replace(/^http/, "ws");
  return `${base}/ws?admin_token=${encodeURIComponent(
    token,
  )}&session_id=${encodeURIComponent(sessionId)}`;
}


export function renameTeam(name: string): Promise<{ name: string }> {
  return request("/api/team", { method: "PATCH", body: { name: name.trim() } });
}


export function configureMap(sessionId:string,plan:{finish:MapPoint;stages:MapStage[]}) {return request(`/api/admin/sessions/${sessionId}/map`,{method:'PUT',body:plan});}
export function startMapTimer(sessionId:string) {return request(`/api/admin/sessions/${sessionId}/map/start`,{method:'POST'});}
export function pauseMapTimer(sessionId:string) {return request(`/api/admin/sessions/${sessionId}/map/pause`,{method:'POST'});}
export function resumeMapTimer(sessionId:string) {return request(`/api/admin/sessions/${sessionId}/map/resume`,{method:'POST'});}
export function seekMapTimer(sessionId:string,elapsed_seconds:number) {return request(`/api/admin/sessions/${sessionId}/map/seek`,{method:'POST',body:{elapsed_seconds}});}
export function resetMapTimer(sessionId:string) {return request(`/api/admin/sessions/${sessionId}/map/reset`,{method:'POST'});}
export function shrinkMapArea(sessionId:string) {return request(`/api/admin/sessions/${sessionId}/map/shrink`,{method:'POST'});}
export function beginLocationShare(device_id:string):Promise<{lease:string;revision:number}> {return request('/api/location/start',{method:'POST',body:{device_id}});}
export function sendLocation(device_id:string,lease:string,point:MapPoint,accuracy_m:number) {return request('/api/location',{method:'PUT',body:{device_id,lease,...point,accuracy_m}});}
export function endLocationShare(device_id:string,lease:string) {return request('/api/location',{method:'DELETE',body:{device_id,lease}});}
