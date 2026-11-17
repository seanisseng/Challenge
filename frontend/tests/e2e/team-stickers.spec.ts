import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixtureState, installBoardFixture } from "./board.fixture";
import type { TeamState } from "../../src/lib/types";

async function playerProgress(page: Page, mixed: boolean, inventory = false) {
  const host = fixtureState();
  const distributions = mixed ? [[2, 1, 0], [0, 0, 7], [1, 1, 0], [0, 1, 0], [1, 0, 0], [0, 0, 0]] : Array.from({ length: 6 }, () => [0, 0, 0]);
  const awards = distributions.flatMap((counts, i) => counts.flatMap((count, tier) => Array.from({ length: count }, (_, n) => ({
    id: `award-${i}-${tier}-${n}`, team_id: `team-${i}`, team_name: `Team ${i + 1}`, tier: `tier${tier + 1}` as "tier1" | "tier2" | "tier3", awarded_at: "2026-11-12T10:00:00Z",
  }))));
  const state: TeamState = {
    kind: "team", session: host.session, team: { id: "team-0", name: "Team 1" }, me: { id: "member-1", name: "Avery" },
    board: host.board, my_submissions: [], clue_awards: inventory ? [] : awards,
    clues: awards.filter(award => award.team_id === "team-0").map(award => ({ id: award.id, tier: award.tier, title: "Fixture clue", body: "Private fixture copy", media_url: null, unlocked_at: award.awarded_at })),
    progress: host.progress.map((row, i) => ({ ...row, member_count: 3 + i % 3, ...(inventory ? { clue_tier_counts: { tier1: distributions[i][0], tier2: distributions[i][1], tier3: distributions[i][2] } } : {}), clue_count: distributions[i].reduce((a, b) => a + b, 0) })),
  };
  await page.addInitScript(() => localStorage.setItem("challenge.team-token", "local-sticker-fixture"));
  await page.route(/\/api\//, route => route.fulfill({ json: state }));
  await page.routeWebSocket(/\/ws\?/, ws => ws.send(JSON.stringify(state)));
  await page.goto("/");
  const teamsTab = page.getByRole("button", { name: "Teams", exact: true });
  if (await teamsTab.isVisible()) await teamsTab.click();
  await expect(page.locator(".team-sticker-card")).toHaveCount(6);
  await page.evaluate(() => document.fonts.ready);
}

test("sticker design sheet: six variants, corner labels and loading slots", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // Browser-only component fixture. No preview route is added to the application.
  await page.route("**/sticker-preview", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><title>Tier sticker design sheet</title></head><body><main id="preview"></main><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    </script><script type="module">
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import {TierSticker,TeamLabelSticker} from '/src/components/TierSticker.tsx';
    import {TeamProgressSkeleton} from '/src/components/TeamProgressCards.tsx';
    import '/src/index.css?import'; import '/src/team-progress.css?import'; import '/node_modules/@fontsource/barlow-condensed/latin-700.css?import';
    const h=React.createElement;
    function Sheet(){const [count,setCount]=React.useState(0);return h('div',{style:{maxWidth:820,margin:'48px auto',padding:32}},
      h('h1',{style:{fontFamily:'var(--font-display)',fontSize:40}},'The tier sticker collection'),
      ...['md','sm'].map(size=>h('section',{key:size,style:{margin:'32px 0'}},h('h2',null,size==='md'?'Host / medium':'Player / small'),
      ...['earned','empty'].map(state=>h('div',{key:state,style:{display:'flex',alignItems:'center',gap:40,margin:'24px 0'}},h('span',{style:{width:80}},state),...['1','2','3'].map(tier=>h(TierSticker,{key:tier,tier,state,count:state==='earned'?2:0,size})))))),
      h('div',{style:{display:'flex',gap:24,margin:'40px 0'}},...['YOU','FINISHED','LEADING'].map(label=>h(TeamLabelSticker,{key:label,label}))),
      h('button',{onClick:()=>setCount(n=>n+1)},'Earn a sticker'),h('div',{id:'live-sticker',style:{marginTop:20}},h(TierSticker,{tier:'2',state:count?'earned':'empty',count,size:'md'})),
      h('h2',{style:{marginTop:40}},'Loading slots'),h(TeamProgressSkeleton));}
    ReactDOM.createRoot(document.getElementById('preview')).render(h(Sheet));
    </script></body></html>` }));
  await page.goto("/sticker-preview");
  await expect(page.getByRole("heading", { name: "The tier sticker collection" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "artifacts/tier-sticker-variants.png", fullPage: true });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const sticker = page.locator("#live-sticker .tier-sticker");
  await page.getByRole("button", { name: "Earn a sticker" }).click();
  await expect(sticker).toHaveClass(/tier-sticker--slap/);
  await expect(sticker).not.toHaveClass(/tier-sticker--slap/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Earn a sticker" }).click();
  expect(await sticker.evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  expect(errors).toEqual([]);
});

for (const size of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
  for (const mixed of [false, true]) {
    test(`player sticker collection ${size.width}x${size.height} ${mixed ? "mixed" : "start"}`, async ({ page }, info) => {
      test.skip(!["phone", "iphone-webkit"].includes(info.project.name));
      await page.setViewportSize(size);
      await playerProgress(page, mixed);
      await expect(page.locator(".team-card-stickers .tier-sticker")).toHaveCount(18);
      await expect(page.locator(".team-label-sticker--you")).toHaveCount(1);
      await expect(page.locator(".team-label-sticker--leading")).toHaveCount(mixed ? 1 : 0);
      await expect(page.locator(".team-label-sticker--finished")).toHaveCount(0);
      await expect(page.locator(".race-track, .progress-route, .race-track-count")).toHaveCount(0);
      if (mixed) await expect(page.locator(".tier-sticker-count").filter({ hasText: "x7" })).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const cards = await page.locator(".team-sticker-card").all();
      for (const card of cards) { const box = await card.boundingBox(); expect(box!.height).toBeLessThanOrEqual(112); }
      if (size.height === 844) {
        const last = await cards.at(-1)!.boundingBox();
        const nav = await page.locator(".player-mobile-nav").boundingBox();
        expect(last!.y + last!.height).toBeLessThanOrEqual(nav!.y);
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: `artifacts/team-stickers-${size.width}x${size.height}-${mixed ? "mixed" : "start"}-${info.project.name}.png` });
    });
  }
}

test("host grid and detail toggle preserve totals and honestly mark missing tier data", async ({ page }, info) => {
  const fixture = await installBoardFixture(page);
  fixture.state.board[0] = { ...fixture.state.board[0], status: "claimed", claimed_by_team_id: "team-0", clue_tier: "tier2" };
  await page.goto("/admin");
  await page.getByRole("button", { name: /^Progress/ }).first().click();
  await expect(page.locator(".team-sticker-card")).toHaveCount(6);
  await expect(page.locator(".tier-sticker--md")).toHaveCount(18);
  await expect(page.getByRole("img", { name: /Full tier breakdown unavailable. Known awards: Tier 1, 0; Tier 2, 1/ })).toHaveCount(1);
  await expect(page.getByText("Full tier breakdown unavailable", { exact: true })).toHaveCount(3);
  await expect(page.locator(".team-label-sticker--finished")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/host-team-stickers-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Table view", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Team 1" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "RACE01" })).toBeVisible();
  await page.getByRole("button", { name: "Table view", exact: true }).click();
  await expect(page.locator(".team-sticker-card")).toHaveCount(6);
  expect(fixture.mutations).toEqual([]);
});

test("host never labels a tied lead", async ({ page }) => {
  const fixture = await installBoardFixture(page);
  fixture.state.progress[1].clue_count = fixture.state.progress[0].clue_count;
  await page.goto("/admin");
  await page.getByRole("button", { name: /^Progress/ }).first().click();
  await expect(page.locator(".team-sticker-card")).toHaveCount(6);
  await expect(page.locator(".team-label-sticker--leading")).toHaveCount(0);
});


test("host tier breakdown comes from inventory after claimed cards leave the board", async ({ page }) => {
  const fixture = await installBoardFixture(page);
  fixture.state.progress = fixture.state.progress.map((row, i) => ({ ...row,
    clue_count: i === 0 ? 4 : 0,
    clue_tier_counts: { tier1: 0, tier2: i === 0 ? 2 : 0, tier3: i === 0 ? 2 : 0 },
  }));
  // No claimed challenge remains in the live board or queue.
  await page.goto("/admin");
  await page.getByRole("button", { name: /^Progress/ }).click();
  const team = page.locator(".team-sticker-card").filter({ hasText: "Team 1" });
  await expect(team.getByRole("img", { name: "Tier 2 sticker, 2 earned", exact: true })).toBeVisible();
  await expect(team.getByRole("img", { name: "Tier 3 sticker, 2 earned", exact: true })).toBeVisible();
  await expect(page.getByText("Full tier breakdown unavailable", { exact: true })).toHaveCount(0);
  fixture.state.progress[0].clue_tier_counts!.tier1 = 1;
  fixture.state.progress[0].clue_count = 5;
  fixture.push();
  await expect(team.getByRole("img", { name: "Tier 1 sticker, 1 earned", exact: true })).toBeVisible();
});

test("player rival tier counts remain complete without the recent award feed", async ({ page }) => {
  await playerProgress(page, true, true);
  const rival = page.locator(".team-sticker-card").filter({ hasText: "Team 2" });
  await expect(rival.getByRole("img", { name: "Tier 3 sticker, 7 earned", exact: true })).toBeVisible();
  await expect(page.getByText("Full tier breakdown unavailable", { exact: true })).toHaveCount(0);
});
