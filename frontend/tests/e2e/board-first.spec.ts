import {expect,test,type Page,type WebSocketRoute} from '@playwright/test';
import {fixtureState} from './board.fixture';
import type {TeamState} from '../../src/lib/types';

async function restoreFixture(page:Page,{fail=false,saved=true}={}){
 const host=fixtureState();
 const pending={id:'own-proof',challenge_id:host.board[0].id,status:'pending' as const,review_note:null,submitted_at:'2026-11-28T00:00:00Z'};
 host.board[0].my_submission=pending;
 const full:TeamState={kind:'team',session:host.session,team:{id:'team-0',name:'Team 1',join_code:'TEAM01'},me:{id:'member',name:'Player'},
  board:host.board,progress:host.progress,clues:[{id:'old-clue',tier:'tier1',title:'Already earned clue',body:'Existing clue',media_url:null,unlocked_at:'2026-11-27'}],
  my_submissions:[{...pending,photo_path:null,reviewed_at:null,team_member_id:null}],clue_awards:[]};
 const board={...full,progress:[],clues:[],loading_details:true};delete board.clue_awards;
 let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
 let failed=fail,socket:WebSocketRoute|undefined,detailsRequests=0;
 await page.setViewportSize({width:390,height:844});
 if(saved)await page.addInitScript(()=>localStorage.setItem('challenge.team-token','saved-token'));
 await page.route('**/api/join*',async route=>{
  if(new URL(route.request().url()).searchParams.get('view')!=='board')await waiting;
  await route.fulfill({json:{token:'saved-token',state:board}});
 });
 await page.route('**/api/state*',async route=>{
  if(new URL(route.request().url()).searchParams.get('view')==='board'){await route.fulfill({json:board});return;}
  detailsRequests++;
  if(failed){await route.fulfill({status:503,json:{detail:'Temporarily unavailable'}});return;}
  await waiting;try{await route.fulfill({json:full});}catch{/* Aborted after a live snapshot. */}
 });
 await page.route('**/api/admin/**',route=>route.abort());
 await page.routeWebSocket(/\/ws\?/,ws=>{socket=ws;});
 return {full,release,retry:()=>{failed=false;release();},detailsRequests:()=>detailsRequests,
  connected:()=>Boolean(socket),push:(snapshot:unknown)=>socket?.send(JSON.stringify(snapshot))};
}

test('board opens before details and pending proof stays blocked',async({page})=>{
 const fixture=await restoreFixture(page);
 try{
  await page.goto('/');
  await expect(page.getByRole('button',{name:/Going Bananas/})).toBeVisible();
  await expect.poll(()=>fixture.detailsRequests()).toBeGreaterThan(0);
  await page.getByRole('button',{name:/Going Bananas/}).click();
  await expect(page.getByRole('button',{name:'Awaiting host review',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Close challenge',exact:true}).click();
  await page.getByRole('button',{name:/Your clues/}).click();
  await expect(page.getByText('Loading your clues…',{exact:true})).toBeVisible();
  await expect(page.getByText(/Locked — complete/)).toHaveCount(0);
  await page.getByRole('button',{name:'Teams',exact:true}).click();
  await expect(page.getByRole('status',{name:'Loading team progress'})).toBeVisible();
  await page.getByRole('button',{name:'Map',exact:true}).click();
  await expect(page.getByText('Loading playing area…',{exact:true})).toBeVisible();
  fixture.release();
  await page.getByRole('button',{name:/Your clues/}).click();
  await expect(page.getByText('Already earned clue',{exact:true})).toBeVisible();
  await expect(page.getByRole('dialog',{name:'Clue unlocked!',exact:true})).toHaveCount(0);
  await expect.poll(fixture.connected).toBe(true);
  fixture.push({...fixture.full,clues:[...fixture.full.clues,{...fixture.full.clues[0],id:'new-clue',title:'New reward'}]});
  await expect(page.getByRole('dialog',{name:'Clue unlocked!',exact:true})).toContainText('New reward');
 }finally{fixture.release();}
});

test('entering a team code also opens the board before details',async({page})=>{
 const fixture=await restoreFixture(page,{saved:false});
 try{
  await page.goto('/');
  await page.getByLabel('Team code',{exact:true}).fill('TEAM01');
  await page.getByRole('button',{name:'Join / rejoin team',exact:true}).click();
  await expect(page.getByRole('button',{name:/Going Bananas/})).toBeVisible();
  await expect.poll(()=>fixture.detailsRequests()).toBeGreaterThan(0);
 }finally{fixture.release();}
});

test('details failure keeps the board usable and can be retried',async({page})=>{
 const fixture=await restoreFixture(page,{fail:true});
 await page.goto('/');
 await expect(page.getByRole('button',{name:/Going Bananas/})).toBeVisible();
 await expect(page.getByRole('button',{name:'Retry details',exact:true})).toBeVisible();
 fixture.retry();await page.getByRole('button',{name:'Retry details',exact:true}).click();
 await page.getByRole('button',{name:/Your clues/}).click();
 await expect(page.getByText('Already earned clue',{exact:true})).toBeVisible();
});

test('late details preserve newer live board and clue updates',async({page})=>{
 const fixture=await restoreFixture(page);
 try{
  await page.goto('/');await expect.poll(fixture.connected).toBe(true);
  const newestClue={...fixture.full.clues[0],id:'latest-clue',title:'Latest earned clue'};
  fixture.push({kind:'team_update',session_id:fixture.full.session.id,team_id:fixture.full.team.id,changes:{
   session:fixture.full.session,board:fixture.full.board.slice(1),progress:fixture.full.progress,
   clues:[newestClue],my_submissions:[],clue_awards:[],
  }});
  await expect(page.getByRole('button',{name:/Going Bananas/})).toHaveCount(0);
  fixture.release();
  await page.getByRole('button',{name:/Your clues/}).click();
  await expect(page.getByText('Latest earned clue',{exact:true})).toBeVisible();
  await expect(page.getByText('Already earned clue',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'The board',exact:true}).click();
  await expect(page.getByRole('button',{name:/Going Bananas/})).toHaveCount(0);
 }finally{fixture.release();}
});

test('a full live snapshot wins over older in-flight HTTP details',async({page})=>{
 const fixture=await restoreFixture(page);
 try{
  await page.goto('/');await expect.poll(fixture.connected).toBe(true);
  const live={...fixture.full,board:fixture.full.board.slice(1),clues:[{...fixture.full.clues[0],id:'live-clue',title:'Live clue'}]};
  fixture.push(live);
  await page.getByRole('button',{name:/Your clues/}).click();
  await expect(page.getByText('Live clue',{exact:true})).toBeVisible();
  fixture.release();
  await expect(page.getByText('Already earned clue',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'The board',exact:true}).click();
  await expect(page.getByRole('button',{name:/Going Bananas/})).toHaveCount(0);
 }finally{fixture.release();}
});
