import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixtureState, installBoardFixture } from "./board.fixture";
import type { TeamState } from "../../src/lib/types";
import {readFileSync} from 'node:fs';

async function playerFixture(page: Page, count = 6) {
  const host = fixtureState();
  const state: TeamState = {
    kind: "team", session: host.session, team: { id: "team-0", name: "Team 1" },
    me: { id: "member-1", name: "Avery" }, board: [...host.board, ...host.queue].slice(0, count), progress: host.progress,
    clues: [{ id: "sample", tier: "tier1", title: "Sample unlocked clue", body: "A local fixture clue for display checks.", media_url: null, unlocked_at: "2026-11-12" }], my_submissions: [], clue_awards: [],
  };
  const uploads: string[] = [];
  let manifest:unknown[]=[];
  let socket: WebSocketRoute | undefined;
  await page.addInitScript(() => localStorage.setItem("challenge.team-token", "local-player-fixture"));
  await page.route(/\/api\//, async route => {
    if (route.request().method() === "POST") {
      if(new URL(route.request().url()).pathname==='/api/uploads'){
        const body=route.request().postDataJSON();manifest=body.files;
        await route.fulfill({json:{batch_id:'fixture-batch',submission_id:null,bucket:'proofs',endpoint:'https://storage.invalid/resumable',
          uploads:body.files.map((_:unknown,ordinal:number)=>({id:`upload-${ordinal}`,ordinal,verified_at:'now',path:`proof-${ordinal}`,token:null}))}});return;
      }
      uploads.push(JSON.stringify({files:manifest,...route.request().postDataJSON()}));
      await route.fulfill({ json: { ok: true, photo_path: "fixture.jpg" } });
    } else await route.fulfill({ json: state });
  });
  await page.route("**/reference.jpg", route => route.fulfill({ status: 404 }));
  await page.routeWebSocket(/\/ws\?/, ws => { socket = ws; ws.send(JSON.stringify(state)); });
  return { state, uploads, push: () => socket?.send(JSON.stringify(state)),pushEvent:(event:unknown)=>socket?.send(JSON.stringify(event)) };
}

test('large photos are compressed before attaching and submission',async({page})=>{
 const fixture=await playerFixture(page);
 await page.goto('/');
 await page.getByRole('button',{name:/Going Bananas/}).click();
 const encoded=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=2200;canvas.height=2200;
  const ctx=canvas.getContext('2d')!;const pixels=ctx.createImageData(2200,2200);
  let seed=12345;
  for(let i=0;i<pixels.data.length;i+=4){for(let j=0;j<3;j++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;pixels.data[i+j]=seed&255;}pixels.data[i+3]=255;}
  ctx.putImageData(pixels,0,0);return canvas.toDataURL('image/png').split(',')[1];
 });
 const original=Buffer.from(encoded,'base64');expect(original.length).toBeGreaterThan(4*1024**2);
 await page.getByLabel('Attach images or videos').setInputFiles({name:'phone.png',mimeType:'image/png',buffer:original});
 await expect(page.getByText('phone.jpg',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Submit',exact:true})).toBeEnabled();
 const image=page.getByRole('img',{name:'Preview phone.jpg'});
 await expect(image).toBeVisible();
 const size=await image.evaluate(async node=>{
  const img=node as HTMLImageElement;await img.decode();
  return {bytes:(await(await fetch(img.src)).blob()).size,width:img.naturalWidth,height:img.naturalHeight};
 });
 expect(size.bytes).toBeLessThan(original.length);expect(size.bytes).toBeLessThan(4*1024**2);
 expect(Math.max(size.width,size.height)).toBeLessThanOrEqual(1600);
 await page.getByRole('button',{name:'Submit',exact:true}).click();
 await expect.poll(()=>fixture.uploads.length).toBe(1);
 expect(fixture.uploads[0]).toContain('phone.jpg');
});

test('partial game updates deliver rewards without replacing the player identity',async({page})=>{
 const fixture=await playerFixture(page);
 await page.goto('/');await expect(page.getByText('Live',{exact:true})).toBeVisible();
 const changes={session:fixture.state.session,board:fixture.state.board,progress:fixture.state.progress,
  clues:[...fixture.state.clues,{id:'delta-clue',tier:'tier2',title:'Fast reward',body:'Private destination clue',media_url:null,unlocked_at:'2026-11-27T10:00:00Z'}],
  my_submissions:[],clue_awards:[]};
 fixture.pushEvent({kind:'team_update',session_id:fixture.state.session.id,team_id:fixture.state.team.id,changes});
 await expect(page.getByRole('dialog',{name:'Clue unlocked!',exact:true})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'Clue unlocked!',exact:true}).getByText('Fast reward',{exact:true})).toBeVisible();
});

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
  await expect(modal).toContainText("closes automatically after 8 seconds");
  await page.clock.runFor(7900);
  await expect(modal).toBeVisible();
  await page.clock.runFor(200);
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
  await expect(modal).toContainText("closes automatically after 8 seconds");
  await page.clock.runFor(7900);
  await expect(modal).toBeVisible();
  await page.clock.runFor(200);
  await expect(modal).toHaveCount(0);
});

test('a competing claim shows a rejection modal and removes the task',async({page})=>{
 const fixture=await playerFixture(page);
 const proof={id:'losing-proof',challenge_id:fixture.state.board[0].id,status:'pending' as const,photo_path:'proof.jpg',review_note:null,submitted_at:'2026-11-18',reviewed_at:null,team_member_id:'member-1'};
 fixture.state.my_submissions.push(proof);
 await page.goto('/');await page.getByRole('button',{name:/Going Bananas/}).click();
 fixture.state.my_submissions[0]={...proof,status:'rejected',review_note:'Another team has claimed this task.',reviewed_at:'2026-11-18T12:00:00Z'};
 fixture.state.board=fixture.state.board.slice(1);fixture.push();
 const dialog=page.getByRole('dialog',{name:'Submission rejected',exact:true});
 await expect(dialog).toContainText('Another team has claimed this task.');
 await expect(dialog).toContainText('TASK CLAIMED');
 await expect(dialog).not.toContainText('TRY AGAIN');
 await expect(page.locator('.challenge-sheet')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Back to board'}).click();
 await expect(page.getByRole('button',{name:/Going Bananas/})).toHaveCount(0);
 fixture.push();await expect(dialog).toHaveCount(0);
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
  const fixture = await playerFixture(page);
  fixture.state.clues.push(
    { id: "paper-tier2", tier: "tier2", title: "The Morning Tenant", body: "Borrow the sunrise's address. Leave the sunset to somebody else.", media_url: null, unlocked_at: "2026-11-15" },
    { id: "paper-tier3", tier: "tier3", title: "Five Answers, One Stop", body: "Calculate separately: 3 squared; 1+1; 6 divided by 3; 10 divided by 2; 4 minus 3. Join the five answers in order. Look up that Singapore bus-stop code: its name identifies the area opposite the finish. You do not need to board a bus.", media_url: "https://example.com/reference", unlocked_at: "2026-11-15" },
  );
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
  expect(uploads).toHaveLength(0);
  await page.getByRole('button',{name:'Submit',exact:true}).click();
  await expect.poll(() => uploads.length).toBe(1);
  expect(JSON.parse(uploads[0]).files[0].name).toBe('proof.png');
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Game menu").click();
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Game 2" })).toBeVisible();
});

test('proof drafts require evidence, retain edits, and submit mixed attachments directly',async({page},info)=>{
 const {uploads}=await playerFixture(page);
 await page.goto('/');
 const card=page.getByRole('button',{name:/Going Bananas/});await card.click();
 const review=page.getByRole('button',{name:'Submit',exact:true});
 await expect(review).toBeDisabled();
 await page.getByRole('textbox',{name:/Message/}).fill('   ');await expect(review).toBeDisabled();
 await page.locator('input[type=file]').setInputFiles([
  {name:'first.png',mimeType:'image/png',buffer:Buffer.from('fixture image')},
  {name:'clip.mp4',mimeType:'video/mp4',buffer:readFileSync(new URL('../fixtures/video/short.mp4',import.meta.url))},
 ]);
 await expect(page.getByRole('list',{name:'Attached files'}).locator('li')).toHaveCount(2);
 expect(uploads).toHaveLength(0);
 await page.getByRole('textbox',{name:/Message/}).fill('Our evidence for the host');
 await page.keyboard.press('Escape');await card.click();
 await expect(page.getByRole('textbox',{name:/Message/})).toHaveValue('Our evidence for the host');
 await page.getByRole('button',{name:'Remove first.png'}).click();
 expect(uploads).toHaveLength(0);
 await page.screenshot({path:`artifacts/proof-review-${info.project.name}.png`});
 await page.getByRole('button',{name:'Submit',exact:true}).click();
 await expect.poll(()=>uploads.length).toBe(1);
 expect(JSON.parse(uploads[0]).files.map((file:{name:string})=>file.name)).toEqual(['clip.mp4']);
 expect(uploads[0]).toContain('Our evidence for the host');
 await expect(page.locator('.challenge-sheet')).toHaveCount(0);
});

test('text-only proof survives a failed submit and can be retried',async({page})=>{
 const {uploads}=await playerFixture(page);let attempts=0;
 await page.route('**/api/submissions/finalize',async route=>{attempts++;if(attempts===1)await route.fulfill({status:400,json:{detail:'Please try again'}});else{uploads.push(route.request().postData()??'');await route.fulfill({json:{ok:true}});}});
 await page.goto('/');await page.getByRole('button',{name:/Going Bananas/}).click();
 await page.getByRole('textbox',{name:/Message/}).fill('Text alone is valid');
 await page.getByRole('button',{name:'Submit',exact:true}).click();
 await expect(page.locator('.challenge-sheet').getByRole('alert')).toContainText('Please try again');
 await expect(page.getByRole('textbox',{name:/Message/})).toHaveValue('Text alone is valid');
 await page.getByRole('button',{name:'Submit',exact:true}).click();
 await expect.poll(()=>uploads.length).toBe(1);
 expect(uploads[0]).toContain('Text alone is valid');
 expect(uploads[0]).not.toContain('filename=');
});

test('pending proofs block another upload until rejected',async({page})=>{
 const fixture=await playerFixture(page);
 fixture.state.board[0].my_submission={id:'pending-proof',status:'pending',review_note:null,submitted_at:'2026-11-18'};
 await page.goto('/');await page.getByRole('button',{name:/Going Bananas/}).click();
 await expect(page.getByRole('button',{name:'Awaiting host review',exact:true})).toBeDisabled();
 await expect(page.getByLabel('Attach images or videos')).toHaveCount(0);
 expect(fixture.uploads).toHaveLength(0);
 fixture.state.board[0].my_submission={...fixture.state.board[0].my_submission!,status:'rejected'};fixture.push();
 await expect(page.getByRole('textbox',{name:/Message/})).toBeVisible();
 await page.getByRole('textbox',{name:/Message/}).fill('Trying again');
 await expect(page.getByRole('button',{name:'Submit',exact:true})).toBeEnabled();
});

test('a silent live socket reconnects and restores a fresh snapshot',async({page})=>{
 await page.clock.install();const fixture=await playerFixture(page);let connections=0;
 await page.routeWebSocket(/\/ws\?/,ws=>{connections++;ws.send(JSON.stringify(fixture.state));ws.onMessage(()=>{/* Simulate a connection that no longer answers pings. */});});
 await page.goto('/');await expect(page.getByText('Live',{exact:true})).toBeVisible();
 fixture.state.team.name='Fresh after reconnect';
 await page.clock.runFor(61_100);
 await expect.poll(()=>connections).toBeGreaterThan(1);
 await expect(page.locator('.player-identity')).toHaveText('Fresh after reconnect');
 await expect(page.getByText('Live',{exact:true})).toBeVisible();
});

test('message and attachment draft recover after a reload',async({page})=>{
 const fixture=await playerFixture(page);await page.goto('/');
 await page.getByRole('button',{name:/Going Bananas/}).click();
 await page.getByRole('textbox',{name:/Message/}).fill('Keep this draft');
 await page.locator('input[type=file]').setInputFiles({name:'recover.png',mimeType:'image/png',buffer:Buffer.from('recoverable image')});
 await expect(page.getByText('Draft saved on this device.',{exact:true})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:/Going Bananas/}).click();
 await expect(page.getByRole('textbox',{name:/Message/})).toHaveValue('Keep this draft');
 await expect(page.getByRole('list',{name:'Attached files'})).toContainText('recover.png');
 expect(fixture.uploads).toHaveLength(0);
 await page.getByRole('button',{name:'Submit',exact:true}).click();
 await expect.poll(()=>fixture.uploads.length).toBe(1);
 await expect(page.locator('.challenge-sheet')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('challenge-proof-drafts',1);r.onsuccess=()=>resolve(r.result);});
  return new Promise<number>(resolve=>{const tx=db.transaction('drafts');const r=tx.objectStore('drafts').count();r.onsuccess=()=>resolve(r.result);tx.oncomplete=()=>db.close();});
 })).toBe(0);
});

test('uploads show progress, allow cancellation and retain the draft',async({page})=>{
 await playerFixture(page);
 let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/submissions/finalize',async route=>{await waiting;try{await route.fulfill({json:{ok:true}});}catch{/* Cancelled request. */}});
 await page.goto('/');await page.getByRole('button',{name:/Going Bananas/}).click();
 await page.getByRole('textbox',{name:/Message/}).fill('Keep after cancelling');
 await page.getByRole('button',{name:'Submit',exact:true}).click();
 await expect(page.getByRole('progressbar',{name:'Upload progress'})).toBeVisible();
 await page.getByRole('button',{name:'Cancel upload',exact:true}).click();release();
 await expect(page.locator('.challenge-sheet').getByRole('alert')).toContainText('Upload cancelled');
 await expect(page.getByRole('textbox',{name:/Message/})).toHaveValue('Keep after cancelling');
 await expect(page.getByRole('button',{name:'Submit',exact:true})).toBeEnabled();
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
  await page.getByRole("button", { name: /^Game 2/ }).click();
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
