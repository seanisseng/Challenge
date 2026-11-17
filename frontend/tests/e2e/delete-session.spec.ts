import { expect, test } from "@playwright/test";
import { installBoardFixture } from "./board.fixture";

test("delete session requires confirmation and returns to the empty session picker", async ({ page }) => {
  await installBoardFixture(page);
  let deleted = false;
  let requests = 0;
  await page.route(/\/api\/admin\/sessions(?:\/design-session)?$/, async route => {
    if (route.request().method() === "DELETE") {
      requests++;
      deleted = true;
      await route.fulfill({ json: { ok: true } });
    } else if (deleted) await route.fulfill({ json: [] });
    else await route.fallback();
  });
  await page.goto("/admin");
  await page.getByRole("button", { name: "Delete session", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Game 2?", exact: true });
  await expect(dialog).toBeVisible();
  expect(requests).toBe(0);
  await dialog.getByRole("button", { name: "Keep session" }).click();
  await expect(dialog).not.toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Delete session", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
  await expect(page.getByText("No sessions yet", { exact: false })).toBeVisible();
  expect(requests).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("challenge.admin-session"))).toBeNull();
});

test("session picker deletion preserves the session on error and allows retry", async ({ page }) => {
  await installBoardFixture(page);
  let requests = 0;
  await page.route("**/api/admin/sessions/design-session", async route => {
    requests++;
    await route.fulfill(requests === 1
      ? { status: 503, json: { detail: "Please retry deletion" } }
      : { json: { ok: true } });
  });
  await page.goto("/admin");
  await page.getByRole("button", { name: "Switch session", exact: true }).click();
  await page.getByRole("button", { name: "Delete session Game 2", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Game 2?", exact: true });
  await dialog.getByRole("button", { name: "Delete permanently" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Please retry deletion");
  await expect(page.getByRole("button", { name: "Delete session Game 2", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Delete permanently" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Delete session Game 2", exact: true })).toHaveCount(0);
  expect(requests).toBe(2);
});
