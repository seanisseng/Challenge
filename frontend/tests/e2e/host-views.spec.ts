import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Clue } from "../../src/lib/types";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installBoardFixture } from "./board.fixture";

test('Review opens by default and new requests join the bottom of the oldest-first queue',async({page})=>{
 const fixture=await installBoardFixture(page);const proof=fixture.state.submissions[0];
 fixture.state.submissions=[
  {...proof,id:'new',teams:{name:'Newest team'},submitted_at:'2026-11-27T10:02:00Z'},
  {...proof,id:'old',teams:{name:'Oldest team'},submitted_at:'2026-11-27T10:00:00Z'},
  {...proof,id:'middle',teams:{name:'Middle team'},submitted_at:'2026-11-27T10:01:00Z'},
 ];
 await page.goto('/admin');
 await expect(page.getByRole('button',{name:/^Review/})).toHaveAttribute('aria-current','page');
 const queue=page.getByRole('complementary',{name:'Pending submissions'}).getByRole('button');
 await expect(queue).toContainText(['Oldest team','Middle team','Newest team']);
 await expect(queue.first()).toHaveAttribute('aria-pressed','true');
 fixture.state.submissions.unshift({...proof,id:'later',teams:{name:'Later team'},submitted_at:'2026-11-27T10:03:00Z'});
 fixture.push();
 await expect(queue).toContainText(['Oldest team','Middle team','Newest team','Later team']);
 await expect(queue.first()).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:/^Reject/}).click();
 await expect(queue).toContainText(['Middle team','Newest team','Later team']);
 await expect(queue.first()).toHaveAttribute('aria-pressed','true');
 fixture.state.submissions.unshift({...proof,id:'last',teams:{name:'Last team'},submitted_at:'2026-11-27T10:04:00Z'});
 fixture.pushEvent({kind:'admin_update',session_id:fixture.state.session.id,changes:{
  session:fixture.state.session,board:fixture.state.board,queue:fixture.state.queue,
  progress:fixture.state.progress,submissions:fixture.state.submissions,
 }});
 await expect(queue).toContainText(['Middle team','Newest team','Later team','Last team']);
 await page.getByRole('button',{name:/^Approve/}).click();
 await expect(queue).toContainText(['Newest team','Later team','Last team']);
 await expect(queue.first()).toHaveAttribute('aria-pressed','true');
});

test('decision log keeps recent decisions first when API snapshots are oldest first',async({page})=>{
 const fixture=await installBoardFixture(page);const proof=fixture.state.submissions[0];
 fixture.state.submissions=[
  {...proof,id:'old-decision',status:'approved',teams:{name:'Old reviewed team'},submitted_at:'2026-11-27T10:00:00Z'},
  {...proof,id:'new-decision',status:'rejected',teams:{name:'New reviewed team'},submitted_at:'2026-11-27T10:02:00Z'},
 ];
 await page.goto('/admin');
 await expect(page.locator('.review-history li')).toContainText(['New reviewed team','Old reviewed team']);
});

test('partial review updates remove decided proofs from the pending queue',async({page})=>{
 const fixture=await installBoardFixture(page);
 await page.goto('/admin');await expect(page.getByText('Live connection',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:/^Review/}).click();
 const before=fixture.state.submissions.filter(row=>row.status==='pending').length;
 fixture.state.submissions=fixture.state.submissions.map(row=>({...row,status:'rejected' as const}));
 fixture.pushEvent({kind:'admin_update',session_id:fixture.state.session.id,changes:{session:fixture.state.session,
  board:fixture.state.board,queue:fixture.state.queue,progress:fixture.state.progress,submissions:fixture.state.submissions}});
 expect(before).toBeGreaterThan(0);
 await expect(page.getByRole('button',{name:'Approve',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:/^decision log$/i})).toBeVisible();
});

test('reviewed proof has individual host download links',async({page})=>{
 const fixture=await installBoardFixture(page);fixture.state.submissions[0].status='approved';
 await page.route('**/api/admin/submissions/*/photo',route=>route.fulfill({json:{url:'/reference.jpg',text:'Previous message',attachments:[
  {path:'one',name:'photo.jpg',content_type:'image/jpeg',size:100,url:'/reference.jpg',download_url:'https://storage.invalid/photo?token=private&download=photo.jpg'},
  {path:'two',name:'clip.mp4',content_type:'video/mp4',size:100,url:null,download_url:'https://storage.invalid/clip?token=private&download=clip.mp4'},
 ]}}));
 await page.goto('/admin');await page.getByRole('button',{name:/^Review/}).click();
 await page.getByRole('button',{name:'View / download proof',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Previous submission'});
 await expect(dialog).toContainText('Previous message');
 await expect(dialog.getByRole('link',{name:'Download photo.jpg',exact:true})).toHaveAttribute('href',/download=photo.jpg/);
 await expect(dialog.getByRole('link',{name:'Download clip.mp4',exact:true})).toHaveAttribute('download','clip.mp4');
 await expect(dialog.getByRole('button',{name:/^Approve/})).toHaveCount(0);
});

test('Review displays mixed evidence and text-only submissions',async({page},info)=>{
 const fixture=await installBoardFixture(page);
 const media=[{path:'image',name:'Team image',content_type:'image/jpeg',size:100,url:'/reference.jpg'},
  {path:'video',name:'Team video',content_type:'video/mp4',size:100,url:'/proof.mp4'}];
 await page.route('**/api/admin/submissions/*/photo',route=>route.fulfill({json:{url:null,attachments:media,text:'Our mixed evidence'}}));
 await page.route('**/proof.mp4',route=>route.fulfill({contentType:'video/mp4',body:Buffer.from('local fixture')}));
 await page.goto('/admin');await page.getByRole('button',{name:/^Review/}).click();
 await expect(page.getByText('Our mixed evidence',{exact:true})).toBeVisible();
 await expect(page.getByAltText('Proof from Team 1 for Strava-geddon')).toBeVisible();
 await expect(page.locator('.evidence-file')).toHaveCount(2);
 await page.screenshot({path:`artifacts/mixed-evidence-${info.project.name}.png`,fullPage:true});
 fixture.state.submissions.unshift({...fixture.state.submissions[0],id:'text-proof',teams:{name:'Text team'},photo_path:null,attachments:[],proof_text:'Text alone'});
 await page.route('**/api/admin/submissions/text-proof/photo',route=>route.fulfill({json:{url:null,attachments:[],text:'Text alone'}}));
 fixture.push();await page.locator('.review-inbox-item').filter({hasText:'Text team'}).click();
 await expect(page.getByText('Text alone',{exact:true})).toBeVisible();
 await expect(page.locator('.evidence-file')).toHaveCount(0);
 await expect(page.getByRole('button',{name:/^Approve/})).toBeEnabled();
});

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
  await clues.focus();
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
