import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Clue } from "../../src/lib/types";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installBoardFixture } from "./board.fixture";

for (const [tab, title, artifact] of [
  ["Review", "Make the call.", "review"],
  ["Team codes", "Get your teams moving.", "team-codes"],
  ["Clues", "The clue pack.", "clues"],
  ["Progress", "Follow the field.", "progress"],
]) {
  test(`${tab} uses the shared theme without overflow or automated accessibility violations`, async ({ page }, info) => {
    await installBoardFixture(page);
    await page.goto("/admin");
    await page.getByRole("button", { name: new RegExp(`^${tab}`) }).first().click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    if (tab === "Review") await expect(page.getByAltText("Proof from Team 1 for Strava-geddon")).toBeVisible();
    if (tab === "Clues") {
      await expect(page.getByRole("heading", { name: "No clues ready yet." })).toBeVisible();
      await expect(page.getByRole("button", { name: /Add clue/ })).toHaveCount(0);
    }
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const identity = await page.locator(".race-host-identity").boundingBox();
    const ticket = await page.locator(".room-ticket").boundingBox();
    expect(identity!.x + identity!.width).toBeLessThanOrEqual(ticket!.x);
    expect((await new AxeBuilder({ page }).include(".race-host").analyze()).violations).toEqual([]);
    await page.screenshot({ path: `artifacts/${artifact}-${info.project.name}.png`, fullPage: true });
  });
}

test("Review keeps the existing decision endpoint and prevents shortcuts while typing a note", async ({ page }) => {
  const { mutations } = await installBoardFixture(page);
  await page.goto("/admin");
  await page.getByRole("button", { name: /^Review/ }).click();
  await page.getByLabel("Note for the team").fill("A clear proof");
  await page.getByLabel("Note for the team").press("a");
  expect(mutations).toHaveLength(0);
  await page.getByLabel("Note for the team").fill("A clear proof");
  await page.getByRole("button", { name: /^Approve/ }).click();
  await expect(page.getByRole("heading", { name: "All caught up." })).toBeVisible();
  expect(mutations[0]).toEqual({ path: "/api/admin/submissions/proof-1/approve", body: { note: "A clear proof" } });
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
});

test("team codes offer shared team access without personal accounts", async ({ page }) => {
  await installBoardFixture(page);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Team codes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy join code RACE01 for Team 1", exact: true })).toContainText("RACE01");
  await expect(page.getByText("Avery", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Remove Avery|Recover Avery/ })).toHaveCount(0);
  await expect(page.getByText("Use this code to join or rejoin your team on any device.", { exact: true })).toHaveCount(6);
});


test("new host submissions notify without blocking and open the exact proof", async ({ page }, info) => {
  const fixture = await installBoardFixture(page);
  await page.goto("/admin");
  const clues = page.getByRole("button", { name: "Clues", exact: true });
  await clues.click();
  const notice = page.getByRole("complementary", { name: "New submissions", exact: true });
  await expect(notice).toHaveCount(0);
  fixture.state.submissions.unshift({ ...fixture.state.submissions[0], id: "new-proof", team_id: "team-1", teams: { name: "Team 2" }, challenge_id: "challenge-1", challenges: { title: "Going Bananas" }, submitted_at: "2026-11-15T14:00:00Z" });
  fixture.push();
  await expect(notice).toContainText("Team 2");
  await expect(notice).toContainText("Going Bananas");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(clues).toBeFocused();
  fixture.push();
  await expect(notice.getByRole("button", { name: "Open submission", exact: true })).toHaveCount(1);
  expect((await new AxeBuilder({ page }).include(".race-host").analyze()).violations).toEqual([]);
  await page.screenshot({ path: `artifacts/host-submission-notice-${info.project.name}.png` });
  await notice.getByRole("button", { name: "Open submission", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Make the call.", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Proof from Team 2 for Going Bananas", exact: true })).toBeVisible();
  await expect(page.locator(".review-workspace")).toBeFocused();
  await expect(notice).toHaveCount(0);
  expect(fixture.mutations).toHaveLength(0);
});

test("host submission notices queue, dismiss once and remove reviewed proofs", async ({ page }) => {
  const fixture = await installBoardFixture(page);
  await page.goto("/admin");
  await expect(page.getByText("Live connection", { exact: true })).toBeVisible();
  const initial = fixture.state.submissions[0];
  fixture.state.submissions.push(
    { ...initial, id: "new-a", teams: { name: "Team A" }, submitted_at: "2026-11-15T14:00:00Z" },
    { ...initial, id: "new-b", teams: { name: "Team B" }, submitted_at: "2026-11-15T14:00:01Z" },
  );
  fixture.push();
  const notice = page.getByRole("complementary", { name: "New submissions", exact: true });
  await expect(notice).toContainText("Team A");
  await notice.getByRole("button", { name: "Dismiss submission notification", exact: true }).click();
  await expect(notice).toContainText("Team B");
  fixture.push();
  await expect(notice).not.toContainText("Team A");
  fixture.state.submissions.find(item => item.id === "new-b")!.status = "approved";
  fixture.push();
  await expect(notice).toHaveCount(0);
  fixture.push();
  await expect(notice).toHaveCount(0);
  fixture.state.session.id = "other-session";
  fixture.state.submissions.push({ ...initial, id: "other-existing", session_id: "other-session" });
  fixture.push();
  await expect(notice).toHaveCount(0);
});


test("host catalog displays all 24 permanent clues across three tiers", async ({ page }, info) => {
  const source = readFileSync(resolve("../clues/clues.md"), "utf8").replace(/\r\n/g, "\n").split("## Host-only destination facts")[0];
  const clues: Clue[] = [...source.matchAll(/^\| T([123])-0([1-8]) \| (.*?) \| (.*?) \|$/gm)].map(([, tier, order, title, body]) => ({
    id: `catalog-${tier}-${order}`, tier: `tier${tier}` as Clue["tier"], title, body, media_url: null, unlocked_at: "",
  }));
  expect(clues).toHaveLength(24);
  await installBoardFixture(page, { clues });
  await page.goto("/admin");
  await page.getByRole("button", { name: "Clues", exact: true }).click();
  await expect(page.getByText("The permanent clue catalog shared by every game.", { exact: false })).toBeVisible();
  await expect(page.locator(".host-clue-envelope")).toHaveCount(24);
  for (const section of await page.locator(".host-clue-tiers > section").all()) {
    await expect(section.locator("li")).toHaveCount(8);
  }
  await expect(page.getByRole("button", { name: /Load built-in|Add clue/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/global-clue-catalog-${info.project.name}.png` });
});


test("Review suppresses host notices and leaving Review does not replay them", async ({ page }) => {
  const fixture = await installBoardFixture(page);
  const baseline = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/state"));
  await page.goto("/admin");
  await baseline;
  await expect(page.getByText("Live connection", { exact: true })).toBeVisible();
  const notice = page.getByRole("complementary", { name: "New submissions", exact: true });
  const initial = fixture.state.submissions[0];
  fixture.state.submissions.push({ ...initial, id: "before-review", teams: { name: "Team Before" } });
  fixture.push();
  await expect(notice).toContainText("Team Before");
  await page.getByRole("button", { name: /^Review/ }).click();
  await expect(notice).toHaveCount(0);
  fixture.state.submissions.push({ ...initial, id: "during-review", teams: { name: "Team During" } });
  fixture.push();
  await expect(page.locator(".review-inbox-item")).toHaveCount(3);
  await expect(notice).toHaveCount(0);
  await page.getByRole("button", { name: "Clues", exact: true }).click();
  await expect(notice).toHaveCount(0);
  fixture.push();
  await expect(notice).toHaveCount(0);
  fixture.state.submissions.push({ ...initial, id: "after-review", teams: { name: "Team After" } });
  fixture.push();
  await expect(notice).toContainText("Team After");
  await expect(notice).not.toContainText("Team Before");
  await expect(notice).not.toContainText("Team During");
});
