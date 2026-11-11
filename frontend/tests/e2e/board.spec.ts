import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installBoardFixture } from "./board.fixture";

test("Board has tier hierarchy, readable statuses and a deliberate replacement confirmation", async ({ page }) => {
  const { mutations } = await installBoardFixture(page);
  await page.goto("/admin");
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
  await page.getByRole("button", { name: "Move Shophouse of Cards down", exact: true }).click();
  await expect.poll(() => mutations.length).toBe(1);
  expect(mutations[0].path).toBe("/api/admin/sessions/design-session/queue/reorder");
  expect((mutations[0].body as { challenge_ids: string[] }).challenge_ids[0]).toBe("challenge-8");
});

test("screenshots, contrast and responsive overflow", async ({ page }, info) => {
  await installBoardFixture(page);
  await page.goto("/admin");
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
  await expect(page.getByRole("heading", { name: "The board is clear." })).toBeVisible();
  await expect(page.getByText("The queue is empty.", { exact: true })).toBeVisible();
  await page.screenshot({ path: `artifacts/board-empty-${info.project.name}.png`, fullPage: true });
});

test("primary button, tier stamps and live indicator pass AA contrast", async ({ page }, info) => {
  await installBoardFixture(page);
  await page.goto("/admin");
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
  await expect(page.getByRole("heading", { name: "Set the pace." })).toBeVisible();
});

test("initial connection failure has a recoverable board state", async ({ page }, info) => {
  const fixture = await installBoardFixture(page, { unavailable: true });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "We could not load your board." })).toBeVisible();
  await page.screenshot({ path: `artifacts/board-unavailable-${info.project.name}.png`, fullPage: true });
  fixture.reconnect();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Set the pace." })).toBeVisible();
});
