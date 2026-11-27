import {expect,test,type Page,type WebSocketRoute} from '@playwright/test';
import {installBoardFixture} from './board.fixture';

async function liveFixture(page:Page){
 const fixture=await installBoardFixture(page);
 const sockets:WebSocketRoute[]=[];let pings=0,sendInitial=true;
 await page.routeWebSocket(/\/ws\?/,ws=>{
  sockets.push(ws);
  if(sendInitial)ws.send(JSON.stringify(fixture.state));
  ws.onMessage(message=>{if(message==='ping'){pings++;ws.send(JSON.stringify({kind:'pong'}));}});
 });
 return {...fixture,sockets,pings:()=>pings,pauseSnapshots:()=>{sendInitial=false;},
  send:(data:unknown)=>sockets.at(-1)?.send(JSON.stringify(data))};
}

test('expected socket closure keeps the board and refreshes over HTTP while reconnecting',async({page})=>{
 await page.clock.install();const fixture=await liveFixture(page);
 let recovering=false,release!:()=>void;
 const waiting=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/admin/sessions/*/state',async route=>{
  if(recovering)await waiting;await route.fallback();
 });
 try{
  await page.goto('/admin');await expect(page.getByText('Live connection',{exact:true})).toBeVisible();
  recovering=true;fixture.pauseSnapshots();fixture.sockets.at(-1)!.close({code:1000});
  await expect(page.getByText('Reconnecting',{exact:true})).toBeVisible();
  await expect(page.getByText('Connection interrupted',{exact:true})).toHaveCount(0);
  fixture.state.submissions[0].teams={name:'Recovered team'};release();
  await expect(page.getByRole('complementary',{name:'Pending submissions'})).toContainText('Recovered team');
  await expect(page.getByText('Updating',{exact:true})).toBeVisible();
  fixture.state.submissions[0].teams={name:'Kept fresh while reconnecting'};
  await page.clock.runFor(5_100);
  await expect(page.getByRole('complementary',{name:'Pending submissions'})).toContainText('Kept fresh while reconnecting');
  await page.clock.runFor(1_100);fixture.send(fixture.state);
  await expect(page.getByText('Live connection',{exact:true})).toBeVisible();
 }finally{release();}
});

test('healthy sockets also reconcile updates from another server instance',async({page})=>{
 await page.clock.install();const fixture=await liveFixture(page);
 await page.goto('/admin');await expect(page.getByText('Live connection',{exact:true})).toBeVisible();
 const connections=fixture.sockets.length;
 fixture.state.submissions[0].teams={name:'Changed on another instance'};
 await page.clock.runFor(10_000);fixture.send({kind:'map_access',session_id:fixture.state.session.id,can_track_teams:false});
 await page.clock.runFor(10_000);fixture.send({kind:'map_access',session_id:fixture.state.session.id,can_track_teams:false});
 await page.clock.runFor(11_000);
 await expect(page.getByRole('complementary',{name:'Pending submissions'})).toContainText('Changed on another instance');
 expect(fixture.sockets).toHaveLength(connections);
});

test('returning from a hidden tab refreshes immediately without a stale-heartbeat disconnect',async({page})=>{
 await page.clock.install();const fixture=await liveFixture(page);
 await page.goto('/admin');await expect(page.getByText('Live connection',{exact:true})).toBeVisible();
 const connections=fixture.sockets.length;
 await page.evaluate(()=>{
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
  document.dispatchEvent(new Event('visibilitychange'));
 });
 await page.clock.runFor(120_000);
 expect(fixture.pings()).toBe(0);
 expect(fixture.sockets).toHaveLength(connections);
 fixture.state.submissions[0].teams={name:'Back from the background'};
 await page.evaluate(()=>{
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
  document.dispatchEvent(new Event('visibilitychange'));
 });
 await expect(page.getByRole('complementary',{name:'Pending submissions'})).toContainText('Back from the background');
 expect(fixture.sockets).toHaveLength(connections);
});

test('server resync requests refresh state without replacing the socket',async({page})=>{
 const fixture=await liveFixture(page);
 await page.goto('/admin');await expect(page.getByText('Live connection',{exact:true})).toBeVisible();
 const connections=fixture.sockets.length;
 fixture.state.submissions[0].teams={name:'Recovered after a database hiccup'};
 fixture.send({kind:'sync_required'});
 await expect(page.getByRole('complementary',{name:'Pending submissions'})).toContainText('Recovered after a database hiccup');
 expect(fixture.sockets).toHaveLength(connections);
});

test('late HTTP refresh cannot overwrite a newer socket update',async({page})=>{
 await page.clock.install();const fixture=await liveFixture(page);
 let refreshStarted=false,responded=false,release!:()=>void;
 const waiting=new Promise<void>(resolve=>{release=resolve;});
 await page.goto('/admin');await expect(page.getByText('Live connection',{exact:true})).toBeVisible();
 const older=structuredClone(fixture.state);
 await page.route('**/api/admin/sessions/*/state',async route=>{
  refreshStarted=true;await waiting;await route.fulfill({json:older});responded=true;
 });
 try{
  await page.clock.runFor(31_000);await expect.poll(()=>refreshStarted).toBe(true);
  fixture.state.submissions[0].teams={name:'Newer socket update'};fixture.send(fixture.state);
  await expect(page.getByRole('complementary',{name:'Pending submissions'})).toContainText('Newer socket update');
  release();await expect.poll(()=>responded).toBe(true);
  await expect(page.getByRole('complementary',{name:'Pending submissions'})).toContainText('Newer socket update');
 }finally{release();}
});

test('network return reconnects immediately and retains the current board',async({page,context})=>{
 const fixture=await liveFixture(page);
 await page.goto('/admin');await expect(page.getByText('Live connection',{exact:true})).toBeVisible();
 const connections=fixture.sockets.length;
 await context.setOffline(true);
 await expect(page.getByText('Offline',{exact:true})).toBeVisible();
 await expect(page.getByRole('complementary',{name:'Pending submissions'})).toBeVisible();
 fixture.state.submissions[0].teams={name:'Fresh after network return'};
 await context.setOffline(false);
 await expect(page.getByText('Live connection',{exact:true})).toBeVisible();
 await expect(page.getByRole('complementary',{name:'Pending submissions'})).toContainText('Fresh after network return');
 expect(fixture.sockets.length).toBeGreaterThan(connections);
});

test('late background HTTP refresh cannot restore a confirmed rejected proof',async({page})=>{
 await page.clock.install();const fixture=await liveFixture(page);
 let started=false,responded=false,release!:()=>void;
 const waiting=new Promise<void>(resolve=>{release=resolve;});
 await page.goto('/admin');await expect(page.getByText('Live connection',{exact:true})).toBeVisible();
 const older=structuredClone(fixture.state);
 await page.route('**/api/admin/sessions/*/state',async route=>{
  if(started){await route.fallback();return;}
  started=true;await waiting;await route.fulfill({json:older});responded=true;
 });
 try{
  await page.clock.runFor(31_000);await expect.poll(()=>started).toBe(true);
  await page.getByRole('button',{name:/^Reject/}).click();
  await expect(page.getByRole('heading',{name:'All caught up.',exact:true})).toBeVisible();
  release();await expect.poll(()=>responded).toBe(true);await page.clock.runFor(100);
  await expect(page.getByRole('heading',{name:'All caught up.',exact:true})).toBeVisible();
  await expect(page.getByRole('complementary',{name:'Pending submissions'})).toHaveCount(0);
 }finally{release();}
});

test('an expired login during fallback stops recovery and returns to sign-in',async({page})=>{
 const fixture=await liveFixture(page);
 await page.goto('/admin');await expect(page.getByText('Live connection',{exact:true})).toBeVisible();
 await page.route('**/api/admin/sessions/*/state',route=>route.fulfill({status:401,json:{detail:'Invalid admin token'}}));
 fixture.sockets.at(-1)!.close({code:1000});
 await expect(page.getByRole('heading',{name:'Enter the admin PIN',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('challenge.admin-token'))).toBeNull();
});

test('GPS traffic does not cancel recovery from a failed game refresh',async({page})=>{
 await page.clock.install();const fixture=await liveFixture(page);
 let first=true,started=false,returned=false,release!:()=>void;
 const waiting=new Promise<void>(resolve=>{release=resolve;});
 await page.goto('/admin');await expect(page.getByText('Live connection',{exact:true})).toBeVisible();
 await page.route('**/api/admin/sessions/*/state',async route=>{
  if(!first){await route.fallback();return;}
  first=false;started=true;await waiting;
  await route.fulfill({status:503,json:{detail:'Temporary refresh failure'}});returned=true;
 });
 try{
  fixture.state.submissions[0].teams={name:'Recovered despite GPS traffic'};
  fixture.send({kind:'sync_required'});await expect.poll(()=>started).toBe(true);
  fixture.send({kind:'location',session_id:fixture.state.session.id,location:{team_id:'team-0',team_name:'Team 1',device_id:'phone',lat:1.3,lng:103.9,accuracy_m:10,updated_at:new Date().toISOString(),revision:1}});
  await page.clock.runFor(100);release();await expect.poll(()=>returned).toBe(true);
  await page.clock.runFor(5_100);
  await expect(page.getByRole('complementary',{name:'Pending submissions'})).toContainText('Recovered despite GPS traffic');
 }finally{release();}
});
