import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installBoardFixture } from "./board.fixture";

test("Board has tier hierarchy, readable statuses and a deliberate replacement confirmation", async ({ page }) => {
  const { mutations } = await installBoardFixture(page);
  await page.goto("/admin");
  await page.getByRole("button", {name:"Board", exact:true}).click();
  await expect(page.getByRole("heading", { name: "Set the pace." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Going Bananas", exact: true })).toBeVisible();
  await expect(page.getByText("Pending", { exact: true }).first()).toBeVisible();
  const ticket = page.getByTestId("challenge-ticket").first();
  await ticket.getByRole("button", { name: "Replace" }).click();
  const dialog = page.getByRole("dialog", { name: "Replace Going Bananas?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Pending submissions will be rejected.", { exact: true })).toBeVisible();
  expect(mutations).toHaveLength(0);
  await dialog.getByRole("button", { name: "Keep challenge" }).click();
  await expect(dialog).not.toBeVisible();
  expect(mutations).toHaveLength(0);
  await ticket.getByRole("button", { name: "Replace" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Replace challenge" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(mutations[0].path).toBe("/api/admin/sessions/design-session/challenges/challenge-1/discard");
});

test("queue keeps its keyboard ordering controls and the existing request contract", async ({ page }) => {
  const { mutations } = await installBoardFixture(page);
  await page.goto("/admin");
  await page.getByRole("button", {name:"Board", exact:true}).click();
  await page.getByRole("button", { name: "Move Shophouse of Cards down", exact: true }).click();
  await expect.poll(() => mutations.length).toBe(1);
  expect(mutations[0].path).toBe("/api/admin/sessions/design-session/queue/reorder");
  expect((mutations[0].body as { challenge_ids: string[] }).challenge_ids[0]).toBe("challenge-8");
});

test("dragging expands the queue and saves the dropped order across reloads", async ({ page }) => {
  const { state, mutations } = await installBoardFixture(page);
  const original = state.queue.map(card => card.id);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const rows = page.locator("[data-queue-id]");
  await expect(rows).toHaveCount(6);
  const grip = page.getByRole("button", { name: `Drag ${state.queue[0].title} to reorder`, exact: true });
  await grip.scrollIntoViewIfNeeded();
  const start = (await grip.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + 10, { steps: 3 });
  await expect(rows).toHaveCount(original.length);
  const target = (await rows.nth(1).boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, target.y + target.height * 0.8, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => mutations.length).toBe(1);
  const expected = [original[1], original[0], ...original.slice(2)];
  expect(mutations[0].body).toEqual({ challenge_ids: expected, expected_ids: original });
  await expect(rows.first()).toHaveAttribute("data-queue-id", expected[0]);
  await page.reload();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(rows.first()).toHaveAttribute("data-queue-id", expected[0]);
});

test("touch dragging a queue grip saves its new position", async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== "chromium" || !isMobile, "Native touch injection uses Chromium's mobile protocol");
  const { state, mutations } = await installBoardFixture(page);
  const original = state.queue.map(card => card.id);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const grip = page.getByRole("button", { name: `Drag ${state.queue[0].title} to reorder`, exact: true });
  await grip.evaluate(element => element.scrollIntoView({ block: "center" }));
  const start = (await grip.boundingBox())!;
  const x = start.x + start.width / 2, y = start.y + start.height / 2;
  const touch = await page.context().newCDPSession(page);
  try {
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 12 }] });
    await expect(page.locator("[data-queue-id]")).toHaveCount(original.length);
    const target = (await page.locator("[data-queue-id]").nth(1).boundingBox())!;
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: target.y + target.height * 0.8 }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => mutations.length).toBe(1);
    expect(mutations[0].body).toEqual({ challenge_ids: [original[1], original[0], ...original.slice(2)], expected_ids: original });
  } finally {
    await touch.detach();
  }
});

test("screenshots, contrast and responsive overflow", async ({ page }, info) => {
  await installBoardFixture(page);
  await page.goto("/admin");
  await page.getByRole("button", {name:"Board", exact:true}).click();
  await expect(page.getByRole("heading", { name: "Set the pace." })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).include(".race-host").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: `artifacts/board-${info.project.name}.png`, fullPage: true });
});

test("offline state preserves the board and offers a plain-language retry", async ({ page }, info) => {
  const fixture = await installBoardFixture(page);
  await page.goto("/admin");
  await page.getByRole("button", {name:"Board", exact:true}).click();
  await expect(page.getByRole("heading", { name: "Set the pace." })).toBeVisible();
  fixture.disconnect();
  await expect(page.getByText("Connection interrupted", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Going Bananas", exact: true })).toBeVisible();
  await page.screenshot({ path: `artifacts/board-offline-${info.project.name}.png`, fullPage: true });
});

test("empty board is designed rather than a missing card grid", async ({ page }, info) => {
  await installBoardFixture(page, { empty: true });
  await page.goto("/admin");
  await page.getByRole("button", {name:"Board", exact:true}).click();
  await expect(page.getByRole("heading", { name: "The board is clear." })).toBeVisible();
  await expect(page.getByText("The queue is empty.", { exact: true })).toBeVisible();
  await page.screenshot({ path: `artifacts/board-empty-${info.project.name}.png`, fullPage: true });
});

test("primary button, tier stamps and live indicator pass AA contrast", async ({ page }, info) => {
  await installBoardFixture(page);
  await page.goto("/admin");
  await page.getByRole("button", {name:"Board", exact:true}).click();
  await page.getByRole("button", { name: "Hide Board", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reveal Board", exact: true })).toBeVisible();
  const ratios = await page.evaluate(() => {
    function luminance(rgb: string) {
      const values = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    }
    return [".board-reveal", ".challenge-ticket .tier-stamp--tier3", ".connection-indicator--live"].map(selector => {
      const styles = getComputedStyle(document.querySelector(selector)!);
      const a = luminance(styles.color), b = luminance(styles.backgroundColor);
      return { selector, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
  });
  for (const { ratio } of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: `artifacts/board-preview-${info.project.name}.png`, fullPage: true });
});

test("loading state keeps the board structure visible", async ({ page }, info) => {
  await installBoardFixture(page, { slow: true });
  await page.goto("/admin");
  await expect(page.getByRole("status", { name: "Loading challenge board" })).toBeVisible();
  await page.screenshot({ path: `artifacts/board-loading-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", {name:"Board", exact:true}).click();
  await expect(page.getByRole("heading", { name: "Set the pace." })).toBeVisible();
});

test("initial connection failure has a recoverable board state", async ({ page }, info) => {
  const fixture = await installBoardFixture(page, { unavailable: true });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "We could not load your board." })).toBeVisible();
  await page.screenshot({ path: `artifacts/board-unavailable-${info.project.name}.png`, fullPage: true });
  fixture.reconnect();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByRole("button", {name:"Board", exact:true}).click();
  await expect(page.getByRole("heading", { name: "Set the pace." })).toBeVisible();
});
