import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page, WebSocketRoute } from "@playwright/test";
import type { AdminState, Challenge, Clue } from "../../src/lib/types";

const rows = readFileSync(resolve("../challenges/challenges.md"), "utf8").split(/\r?\n/)
  .map(line => line.replace(/^\||\|$/g, "").split("|").map(cell => cell.trim()))
  .filter(cells => cells.length === 6 && /^\d+$/.test(cells[0]));

export function fixtureState(): AdminState {
  const challenges: Challenge[] = rows.map(([number, tier, title, area, condition, photo]) => ({
    id: `challenge-${number}`, title, location_area: area, completion_condition: condition,
    clue_tier: `tier${tier}` as Challenge["clue_tier"], status: number === "2" ? "pending_approval" : "open",
    image_url: photo === "-" ? null : "/reference.jpg", claimed_by_team_id: null,
    sort_order: Number(number), updated_at: "2026-11-11T12:00:00Z",
  }));
  return {
    kind: "admin",
    session: { id: "design-session", name: "Game 2", room_code: "95Q2X3", status: "active", team_count: 6, active_task_limit: 6, board_visible: true, board_reveal_version: 1 },
    board: challenges.slice(0, 6), queue: challenges.slice(6),
    progress: Array.from({ length: 6 }, (_, i) => ({ team_id: `team-${i}`, team_name: `Team ${i + 1}`, member_count: i === 0 ? 1 : 0, clue_count: Math.max(0, 3 - i), claimed_count: Math.max(0, 3 - i) })),
    teams: Array.from({ length: 6 }, (_, i) => ({ id: `team-${i}`, name: `Team ${i + 1}`, join_code: `RACE0${i + 1}`, members: i === 0 ? [{ id: "member-1", name: "Avery" }] : [] })),
    submissions: [{ id: "proof-1", session_id: "design-session", challenge_id: "challenge-2", team_id: "team-0", team_member_id: null, photo_path: "test.jpg", status: "pending", review_note: null, submitted_at: "2026-11-11T12:00:00Z", reviewed_at: null, challenges: { title: "Strava-geddon" }, teams: { name: "Team 1" }, team_members: null }],
  };
}

export async function installBoardFixture(page: Page, options: { empty?: boolean; slow?: boolean; unavailable?: boolean; clues?: Clue[] } = {}) {
  const state = fixtureState();
  if (options.empty) { state.board = []; state.queue = []; state.submissions = []; }
  const mutations: { path: string; body: unknown }[] = [];
  let socket: WebSocketRoute | undefined;
  let offline = Boolean(options.unavailable);
  await page.addInitScript(() => {
    localStorage.setItem("challenge.admin-token", "local-design-fixture");
    localStorage.setItem("challenge.admin-session", "design-session");
  });
  await page.route("**/reference.jpg", route => route.fulfill({ contentType: "image/jpeg", body: readFileSync(resolve("../challenges/challenge2.jpg")) }));
  await page.route(/\/api\//, async route => {
    const url = new URL(route.request().url());
    if (offline) { await route.abort("failed"); return; }
    if (url.pathname.endsWith("/photo")) { await route.fulfill({ json: { url: "/reference.jpg" } }); return; }
    if (url.pathname.endsWith("/clues")) { await route.fulfill({ json: options.clues ?? [] }); return; }
    if (options.slow && url.pathname.endsWith("/state")) await new Promise(resolve => setTimeout(resolve, 1500));
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      mutations.push({ path: url.pathname, body });
      if (/\/(approve|reject)$/.test(url.pathname)) {
        const proof = state.submissions.find(item => item.id === url.pathname.split("/").at(-2));
        if (proof) { proof.status = url.pathname.endsWith("/approve") ? "approved" : "rejected"; proof.review_note = body?.note ?? null; }
      }
      if (url.pathname.endsWith("/discard")) {
        const id = url.pathname.split("/").at(-2);
        state.board = state.board.filter(card => card.id !== id);
        state.queue = state.queue.filter(card => card.id !== id);
        if (state.board.length < 6 && state.queue.length) state.board.push(state.queue.shift()!);
      }
      if (url.pathname.endsWith("/reorder")) {
        const ids = body.challenge_ids as string[];
        state.queue = ids.map(id => state.queue.find(card => card.id === id)!);
      }
      if (url.pathname.endsWith("/hide")) state.session.board_visible = false;
      if (url.pathname.endsWith("/reveal")) state.session.board_visible = true;
      await route.fulfill({ json: { ok: true } });
      socket?.send(JSON.stringify(state));
      return;
    }
    await route.fulfill({ json: url.pathname.endsWith("/sessions") ? [{ ...state.session, created_at: "2026-11-11" }] : state });
  });
  await page.routeWebSocket(/\/ws\?/, ws => {
    socket = ws;
    if (offline) ws.close({ code: 1001 });
    else if (!options.slow) ws.send(JSON.stringify(state));
  });
  return { state, mutations, push: () => socket?.send(JSON.stringify(state)),pushEvent:(event:unknown)=>socket?.send(JSON.stringify(event)), disconnect: () => { offline = true; socket?.close({ code: 1001 }); }, reconnect: () => { offline = false; } };
}
