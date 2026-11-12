import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixtureState, installBoardFixture } from "./board.fixture";
import type { TeamState } from "../../src/lib/types";

async function playerFixture(page: Page, count = 6) {
  const host = fixtureState();
  const state: TeamState = {
    kind: "team", session: host.session, team: { id: "team-0", name: "Team 1" },
    me: { id: "member-1", name: "Avery" }, board: [...host.board, ...host.queue].slice(0, count), progress: host.progress,
    clues: [{ id: "sample", tier: "tier1", title: "Sample unlocked clue", body: "A local fixture clue for display checks.", media_url: null, unlocked_at: "2026-11-12" }], my_submissions: [], clue_awards: [],
  };
  const uploads: string[] = [];
  let socket: WebSocketRoute | undefined;
  await page.addInitScript(() => localStorage.setItem("challenge.team-token", "local-player-fixture"));
  await page.route(/\/api\//, async route => {
    if (route.request().method() === "POST") {
      uploads.push(route.request().postData() ?? "");
      await route.fulfill({ json: { ok: true, photo_path: "fixture.jpg" } });
    } else await route.fulfill({ json: state });
  });
  await page.route("**/reference.jpg", route => route.fulfill({ status: 404 }));
  await page.routeWebSocket(/\/ws\?/, ws => { socket = ws; ws.send(JSON.stringify(state)); });
  return { state, uploads, push: () => socket?.send(JSON.stringify(state)) };
}

test("new clues celebrate once, close early or expire, and survive a closing proof sheet", async ({ page }, info) => {
  await page.clock.install();
  const fixture = await playerFixture(page);
  await page.goto("/");
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Going Bananas/ }).click();
  fixture.state.clues.push({ id: "new-clue", tier: "tier2", title: "Newly earned clue", body: "Your private clue text.", media_url: null, unlocked_at: "2026-11-12T10:01:00Z" });
  fixture.state.board = fixture.state.board.slice(1);
  fixture.push();
  const modal = page.getByRole("dialog", { name: "Clue unlocked!", exact: true });
  await expect(modal).toBeVisible();
  await expect(modal.getByText("Newly earned clue", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `artifacts/clue-success-${info.project.name}.png` });
  await modal.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  fixture.push();
  await page.clock.runFor(50);
  await expect(modal).toHaveCount(0);
  fixture.state.clues.push({ ...fixture.state.clues[1], id: "next-clue", title: "Another clue" });
  fixture.push();
  await expect(modal).toBeVisible();
  await page.clock.fastForward(8100);
  await expect(modal).toHaveCount(0);
});

test("rival clue awards use quiet side notices without opening a modal or stealing focus", async ({ page }, info) => {
  await page.clock.install();
  const fixture = await playerFixture(page);
  await page.goto("/");
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  const menu = page.getByLabel("Game menu");
  await menu.focus();
  fixture.state.clue_awards!.push({ id: "rival-award", team_id: "team-1", team_name: "Team 2", tier: "tier3", awarded_at: "2026-11-12T10:01:00Z" });
  fixture.push();
  const notice = page.getByText("Team 2 acquired a Tier III clue.", { exact: true });
  await expect(notice).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(menu).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `artifacts/rival-clue-notice-${info.project.name}.png` });
  await page.clock.fastForward(6100);
  await expect(notice).toHaveCount(0);
  fixture.push();
  await page.clock.runFor(50);
  await expect(notice).toHaveCount(0);
  fixture.state.clue_awards!.push({ id: "next-rival-award", team_id: "team-2", team_name: "Team 3", tier: "tier1", awarded_at: "2026-11-12T10:02:00Z" });
  fixture.push();
  await page.getByRole("button", { name: "Dismiss update from Team 3", exact: true }).click();
  await expect(page.getByText("Team 3 acquired a Tier I clue.", { exact: true })).toHaveCount(0);
});

test("rejections privately highlight host feedback and close early or automatically", async ({ page }, info) => {
  await page.clock.install();
  const fixture = await playerFixture(page);
  const proof = { id: "proof-reject", challenge_id: fixture.state.board[0].id, status: "pending" as const, photo_path: "private/proof.jpg", review_note: null, submitted_at: "2026-11-12T10:00:00Z", reviewed_at: null, team_member_id: "member-1" };
  fixture.state.my_submissions.push(proof);
  await page.goto("/");
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Going Bananas/ }).click();
  fixture.state.my_submissions[0] = { ...proof, status: "rejected", review_note: "Include every team member in the photo.", reviewed_at: "2026-11-12T10:01:00Z" };
  fixture.push();
  const modal = page.getByRole("dialog", { name: "Submission rejected", exact: true });
  await expect(modal).toBeVisible();
  await expect(page.locator(".challenge-sheet")).toHaveCount(0);
  await expect(modal.locator(".rejection-feedback")).toContainText("Include every team member in the photo.");
  await expect(page.locator(".rival-clue-toast")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `artifacts/submission-rejected-${info.project.name}.png` });
  await modal.getByRole("button", { name: "Close dialog", exact: true }).click();
  fixture.push();
  await page.clock.runFor(50);
  await expect(modal).toHaveCount(0);
  fixture.state.my_submissions.push({ ...fixture.state.my_submissions[0], id: "second-rejection", review_note: null });
  fixture.push();
  await expect(modal).toBeVisible();
  await expect(modal.locator(".rejection-feedback")).toContainText("No feedback was provided");
  await page.clock.fastForward(12100);
  await expect(modal).toHaveCount(0);
});

test("flop reveal deals once and reduced motion immediately shows card faces", async ({ page }) => {
  const fixture = await playerFixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator(".flop-slot--dealing")).toHaveCount(6);
  await expect(page.locator(".flop-slot--settled")).toHaveCount(6);
  fixture.push();
  await expect(page.locator(".flop-slot--dealing")).toHaveCount(0);
  fixture.state.session.board_reveal_version++;
  fixture.push();
  await expect(page.locator(".flop-slot--dealing")).toHaveCount(6);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".flop-slot--settled")).toHaveCount(6);
  await expect(page.locator(".challenge-card").first()).toBeEnabled();
});

test("replacement cards draw from the visible deck and reduced motion skips the flight", async ({ page }, info) => {
  const fixture = await playerFixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const deck = page.getByRole("img", { name: "Draw deck" });
  await expect(deck).toBeVisible();
  await expect(page.locator(".flop-slot--settled")).toHaveCount(6);
  await page.screenshot({ path: `artifacts/board-draw-deck-${info.project.name}.png`, fullPage: true });
  // Capture the short-lived flight in one browser frame instead of racing it
  // with several protocol round trips to read its coordinates.
  const capture = page.waitForFunction(() => {
    const flight = document.querySelector<HTMLElement>('.deck-draw-flight[data-challenge-id="replacement-card"]');
    const deck = document.querySelector(".draw-deck-top");
    const slot = document.querySelector('.flop-slot[data-challenge-id="replacement-card"]');
    if (!flight || !deck || !slot) return null;
    const source = deck.getBoundingClientRect();
    const target = slot.getBoundingClientRect();
    return { x: parseFloat(flight.style.getPropertyValue("--draw-x")), y: parseFloat(flight.style.getPropertyValue("--draw-y")),
      expectedX: source.left + source.width / 2 - target.left - target.width / 2,
      expectedY: source.top + source.height / 2 - target.top - target.height / 2,
      animation: getComputedStyle(flight).animationName };
  });
  fixture.state.board[0] = { ...fixture.state.board[0], id: "replacement-card", title: "A fresh challenge" };
  fixture.push();
  const flight = page.locator('.deck-draw-flight[data-challenge-id="replacement-card"]');
  const evidence = await (await capture).jsonValue();
  if (!evidence) throw new Error("Replacement flight was not captured");
  expect(evidence.animation).toBe("deck-draw");
  expect(evidence.x).toBeCloseTo(evidence.expectedX, 0);
  expect(evidence.y).toBeCloseTo(evidence.expectedY, 0);
  await expect(page.getByRole("button", { name: /A fresh challenge/ })).toBeEnabled();
  await expect(flight).toHaveCount(0);
  fixture.push();
  await expect(page.locator(".deck-draw-flight")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  fixture.state.board[1] = { ...fixture.state.board[1], id: "instant-card", title: "An instant challenge" };
  fixture.push();
  await expect(page.getByRole("button", { name: /An instant challenge/ })).toBeEnabled();
  await expect(page.locator(".deck-draw-flight")).toHaveCount(0);
});

for (const size of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
  for (const count of [6, 10]) {
    test(`mobile overview ${size.width}x${size.height} with ${count} challenges`, async ({ page }, info) => {
      test.skip(!["phone", "iphone-webkit"].includes(info.project.name), "Mobile viewport checks");
      await page.setViewportSize(size);
      const fixture = await playerFixture(page, count);
      fixture.state.board[1].my_submission = { id: "proof", status: "pending", review_note: null, submitted_at: "2026-11-12" };
      await page.goto("/");
      await expect(page.getByRole("button", { name: /Going Bananas/ })).toBeEnabled();
      await page.evaluate(() => document.fonts.ready);
      if (size.height === 844 && count === 6) {
        console.log("Rendered sizing:", await page.evaluate(() => {
          const height = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().height ?? 0;
          const header = height(".player-header");
          const hero = height(".table-heading") + height(".table-rail-message");
          const sectionLabel = height(".board-section-label");
          const progress = height(".team-progress-strip");
          const nav = height(".player-mobile-nav");
          return { header, hero, sectionLabel, progress, card: height(".playing-card, .challenge-card"), nav, viewport: innerHeight, availableAfterHeaderHeroNav: innerHeight - header - hero - sectionLabel - progress - nav };
        }));
      }
      await expect(page.locator(".challenge-card")).toHaveCount(count);
      expect((await page.locator(".player-header").boundingBox())!.height).toBeLessThanOrEqual(56);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
      await expect(page.getByText("Live", { exact: true })).toBeVisible();
      const list = page.locator(".challenge-list");
      expect(await list.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await list.evaluate(el => el.scrollLeft = 999);
      expect(await list.evaluate(el => el.scrollLeft)).toBe(0);
      const nav = (await page.getByRole("navigation", { name: "Game views" }).boundingBox())!;
      for (const row of await page.locator(".challenge-card").all()) {
        expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(175);
        expect((await row.boundingBox())!.height).toBeLessThanOrEqual(192);
      }
      if (count === 6) {
        expect(await list.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
        const last = (await page.locator(".challenge-card").last().boundingBox())!;
        expect(last.y + last.height).toBeLessThanOrEqual(nav.y);
      } else {
        await expect(page.getByRole("group", { name: "Filter challenges" })).toBeVisible();
        expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
        await page.getByRole("button", { name: "Submitted", exact: true }).click();
        await expect(page.locator(".challenge-card")).toHaveCount(1);
        await page.getByRole("button", { name: "All", exact: true }).click();
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: `artifacts/compact-board-${size.width}x${size.height}-${count}${info.project.name === "iphone-webkit" ? "-webkit" : ""}.png` });
      await list.evaluate(el => el.scrollTop = el.scrollHeight);
      const last = (await page.locator(".challenge-card").last().boundingBox())!;
      expect(last.y + last.height).toBeLessThanOrEqual(nav.y);
    });
  }
}

test("player views use readable tickets, clue badges and accessible race progress", async ({ page }, info) => {
  await playerFixture(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Going Bananas/ })).toBeEnabled();
  await expect(page.getByText("DRAW PILE", { exact: true })).toHaveCount(0);
  expect(await page.locator(".ticket-card-title").first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(17);
  expect(await page.locator(".ticket-card-location").first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
  await expect(page.locator(".card-rule")).toHaveCount(0);
  for (const tab of ["board", "clues", "teams"]) {
    if (info.project.name !== "desktop") {
      await page.getByRole("navigation", { name: "Game views" }).getByRole("button", { name: tab === "board" ? "The board" : tab === "clues" ? /Your clues/ : "Teams" }).click();
    }
    if (tab === "clues") await expect(page.getByText("Sample unlocked clue")).toBeVisible();
    if (tab === "teams") await expect(page.getByText("YOU", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `artifacts/player-${tab}-${info.project.name}.png`, fullPage: true });
  }
});

test("row status and clue rewards use explicit text and distinct symbols", async ({ page }) => {
  const fixture = await playerFixture(page);
  for (const [index, status] of ["approved", "pending", "rejected"].entries()) {
    fixture.state.board[index].my_submission = { id: `proof-${index}`, status: status as "approved" | "pending" | "rejected", review_note: null, submitted_at: "2026-11-12" };
  }
  await page.goto("/");
  for (const status of ["Approved", "Submitted", "Rejected"]) {
    await expect(page.locator(".challenge-list").getByText(status, { exact: true }).first()).toBeVisible();
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("challenge sheet retains details, browser Back, drag dismissal and focus", async ({ page }, info) => {
  const fixture = await playerFixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const row = page.getByRole("button", { name: /Going Bananas/ });
  await expect(row).toBeVisible();
  await expect(page.locator(".proof-status--open")).toHaveCount(0);
  await expect(row).toBeEnabled();
  expect(await row.evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  const path = new URL(page.url()).pathname;
  await row.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(fixture.state.board[0].completion_condition, { exact: true })).toBeVisible();
  expect((await sheet.boundingBox())!.height).toBeLessThanOrEqual((page.viewportSize()!.height * .76));
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe(path);
  await row.click();
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
  const handle = (await page.locator(".sheet-drag-area").boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 150, { steps: 8 });
  await page.mouse.up();
  await expect(sheet).toHaveCount(0);
  await expect(row).toBeFocused();
  await page.getByRole("button", { name: /Strava-geddon/ }).click();
  await expect(sheet.getByRole("link", { name: /Search area in Maps/ })).toHaveAttribute("href", /Marina%20Barrage/);
  if (["phone", "iphone-webkit"].includes(info.project.name)) await page.screenshot({ path: `artifacts/compact-sheet-${info.project.name}.png` });
  await sheet.getByRole("button", { name: "Close challenge" }).click();
  await expect(sheet).toHaveCount(0);
});

test("safe areas and toolbar resizing preserve contained scrolling", async ({ page }, info) => {
  test.skip(!["phone", "iphone-webkit"].includes(info.project.name), "Mobile safe-area sizing");
  await playerFixture(page);
  await page.goto("/");
  await page.addStyleTag({ content: ".race-player { --player-safe-top: 47px; --player-safe-bottom: 34px; }" });
  await expect(page.locator(".challenge-card")).toHaveCount(6);
  expect((await page.locator(".player-header").boundingBox())!.height).toBe(103);
  expect((await page.locator(".player-mobile-nav").boundingBox())!.height).toBe(90);
  const list = page.locator(".challenge-list");
  expect(await list.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await page.setViewportSize({ width: 375, height: 540 });
  await expect.poll(() => list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(page.locator(".challenge-list-frame--more")).toBeVisible();
  await list.evaluate(el => el.scrollTop = el.scrollHeight);
  await expect(page.locator(".challenge-list-frame--more")).toHaveCount(0);
  const last = (await page.locator(".challenge-card").last().boundingBox())!;
  const nav = (await page.locator(".player-mobile-nav").boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(nav.y);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
});

test("help, photo proof and leave retain their interactions", async ({ page }) => {
  const { uploads } = await playerFixture(page);
  await page.goto("/");
  await page.getByLabel("Game menu").click();
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "How to play" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const card = page.getByRole("button", { name: /Going Bananas/ });
  await expect(card).toBeEnabled();
  await card.click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.locator('input[type="file"]').setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: Buffer.from("local fixture") });
  await expect.poll(() => uploads.length).toBe(1);
  expect(uploads[0]).toContain('name="challenge_id"');
  expect(uploads[0]).toContain('filename="proof.png"');
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Game menu").click();
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Game 2" })).toBeVisible();
});

test("live snapshots preserve hidden, revealed, pending and ended views", async ({ page }) => {
  const fixture = await playerFixture(page);
  fixture.state.session.board_visible = false;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your next move awaits." })).toBeVisible();
  fixture.state.session.board_visible = true;
  fixture.state.session.board_reveal_version++;
  fixture.state.board[0].my_submission = { id: "proof", status: "pending", review_note: null, submitted_at: "2026-11-12" };
  fixture.push();
  await expect(page.getByRole("button", { name: /Going Bananas/ })).toBeEnabled();
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
  fixture.state.session.status = "ended";
  fixture.push();
  await expect(page.getByRole("heading", { name: "That’s a wrap." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Going Bananas/ })).toHaveCount(0);
});

test("session selection uses Race Control and retains its form and navigation", async ({ page }, info) => {
  await installBoardFixture(page);
  await page.addInitScript(() => localStorage.removeItem("challenge.admin-session"));
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
  await expect(page.getByLabel("Hunt name")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/sessions-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: /Game 2/ }).click();
  await expect(page.getByRole("heading", { name: "Game 2", exact: true })).toBeVisible();
});

test("entry screens share the theme and have accessible fields", async ({ page }, info) => {
  for (const [url, heading] of [["/", "Join your team"], ["/admin", "Enter the admin PIN"]]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `artifacts/entry-${url === "/" ? "join" : "host"}-${info.project.name}.png`, fullPage: true });
  }
});
