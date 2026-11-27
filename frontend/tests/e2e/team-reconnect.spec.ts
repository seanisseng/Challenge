import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {fixtureState} from './board.fixture';

function teamState(){
 const host=fixtureState();
 return {kind:'team',session:host.session,team:{id:'team-0',name:'Team 1'},
  me:{id:'member',name:'Alice'},board:host.board,progress:host.progress,
  clues:[],my_submissions:[],clue_awards:[]};
}

test('rejoining has a clear accessible mobile-friendly loading screen',async({page},info)=>{
 await page.addInitScript(()=>localStorage.setItem('challenge.team-token','saved-token'));
 let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/state',async route=>{await waiting;try{await route.fulfill({json:teamState()});}catch{/* Request cancelled during cleanup. */}});
 try{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Rejoining your team',exact:true})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Connecting to your game');
  await expect(page.getByRole('button',{name:'Use another team code',exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>document.fonts.ready);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await page.screenshot({path:`artifacts/reconnect-loading-${info.project.name}.png`,fullPage:true});
 }finally{release();}
});

test('a stalled reconnect times out without removing the saved login and can retry',async({page},info)=>{
 await page.clock.install();
 await page.addInitScript(()=>localStorage.setItem('challenge.team-token','saved-token'));
 let stalled=true,release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/state',async route=>{
  if(stalled)await waiting;
  try{await route.fulfill({json:teamState()});}catch{/* Timed-out request. */}
 });
 await page.routeWebSocket(/\/ws\?/,ws=>ws.send(JSON.stringify(teamState())));
 try{
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Rejoining your team',exact:true})).toBeVisible();
  await page.clock.runFor(8_100);
  await expect(page.getByText('Taking a little longer than usual.',{exact:true})).toBeVisible();
  await page.clock.runFor(7_000);
  await expect(page.getByRole('heading',{name:'Reconnect to your team',exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('saved');
  expect(await page.evaluate(()=>localStorage.getItem('challenge.team-token'))).toBe('saved-token');
  await page.screenshot({path:`artifacts/reconnect-retry-${info.project.name}.png`,fullPage:true});
  stalled=false;
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.locator('.player-identity')).toHaveText('Team 1');
 }finally{release();}
});

test('using another team code ignores a late reconnect response and keeps saved drafts',async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('challenge.team-token','saved-token');
  localStorage.setItem('challenge.direct-upload:saved-token:task','saved-upload-draft');
 });
 let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
 let finished=false;
 await page.route('**/api/state',async route=>{
  await waiting;try{await route.fulfill({json:teamState()});}catch{/* Switched team. */}finally{finished=true;}
 });
 try{
  await page.goto('/');
  await page.getByRole('button',{name:'Use another team code',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Join your team',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('challenge.team-token'))).toBeNull();
  expect(await page.evaluate(()=>localStorage.getItem('challenge.direct-upload:saved-token:task'))).toBe('saved-upload-draft');
  release();await expect.poll(()=>finished).toBe(true);
  await expect(page.getByRole('heading',{name:'Join your team',exact:true})).toBeVisible();
 }finally{release();}
});
