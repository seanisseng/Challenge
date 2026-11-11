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

test("team codes retain the member removal confirmation", async ({ page }) => {
  await installBoardFixture(page);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Team codes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy join code RACE01 for Team 1", exact: true })).toContainText("RACE01");
  page.once("dialog", async dialog => { expect(dialog.message()).toBe("Remove this player?"); await dialog.dismiss(); });
  await page.getByRole("button", { name: "Remove Avery from Team 1", exact: true }).click();
  await expect(page.getByText("Avery", { exact: true })).toBeVisible();
});
