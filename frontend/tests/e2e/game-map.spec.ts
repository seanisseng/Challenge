import { test,expect,type WebSocketRoute } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installBoardFixture,fixtureState } from './board.fixture';
test.beforeEach(async({page})=>{
 page.on('pageerror',error=>{throw error;});
 // Exercise the vector renderer without depending on a public tile server.
 await page.route('**/game-map-style.json',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#f3f1ef'}}]}}));
});
const stage0={lat:1.31,lng:103.9,radius_m:5000,after_seconds:0};
const stage1={lat:1.30,lng:103.9,radius_m:1500,after_seconds:600};
const publicMap=()=>({configured:true,initial_area:stage0,area:stage0,stage_index:0,stage_count:2,started_at:null,next_shrink_at:null,server_time:new Date().toISOString(),locations:[] as any[]});
async function install(page:any,denied=false,fresh=false) {
 const host=fixtureState();
 const state:any={kind:'team',session:host.session,team:{id:'team-0',name:'Team 1'},me:{id:'pool',name:'unused'},board:host.board,progress:host.progress,clues:[],my_submissions:[],clue_awards:[],map:publicMap()};
 let socket:WebSocketRoute|undefined;const calls:string[]=[];let revision=1;const hidden=new Set<string>();
 await page.addInitScript(({denied,fresh}:any)=>{
  if(!fresh)localStorage.setItem('challenge.team-token','map-fixture');
  (window as any).__gpsRequests=0;
  Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:(ok:any,fail:any)=>{(window as any).__gpsRequests++;return denied?fail({code:1}):ok({coords:{latitude:1.3,longitude:103.9,accuracy:12}});}}});
 },{denied,fresh});
 await page.route(/\/api\//,async (route:any)=>{
  const path=new URL(route.request().url()).pathname;const method=route.request().method();
  if(path==='/api/join'){await route.fulfill({json:{token:'map-fixture',state}});return;}
  if(path==='/api/location/start') {calls.push('start');await route.fulfill({json:{lease:'00000000-0000-0000-0000-000000000002',revision:revision++}});return;}
  if(path==='/api/location'&&method==='PUT') {
   calls.push('fix');const body=route.request().postDataJSON();
   const point={...body,team_id:'team-0',team_name:'Team 1',updated_at:new Date().toISOString(),revision:revision++};delete point.lease;
   state.map.locations=[...state.map.locations.filter((old:any)=>old.team_id!==point.team_id||old.device_id!==point.device_id),point];await route.fulfill({json:{ok:true}});socket?.send(JSON.stringify({kind:'location',session_id:state.session.id,location:point}));return;
  }
  if(path==='/api/location'&&method==='DELETE') {
   calls.push('stop');const body=route.request().postDataJSON();state.map.locations=state.map.locations.filter((point:any)=>point.team_id!=='team-0'||point.device_id!==body.device_id);
   await route.fulfill({json:{ok:true}});socket?.send(JSON.stringify({kind:'location_removed',session_id:state.session.id,team_id:'team-0',device_id:body.device_id,revision:revision++}));return;
  }
  await route.fulfill({json:state});
 });
 const snapshot=(ws:WebSocketRoute)=>{
  const url=new URL(ws.url());const device=url.searchParams.get('location_device');
  const allowed=url.searchParams.get('location_lease')==='00000000-0000-0000-0000-000000000002'&&state.map.locations.some((point:any)=>point.device_id===device&&point.team_id==='team-0');
  return {...state,map:{...state.map,can_track_teams:allowed,locations:state.map.locations.filter((point:any)=>point.team_id==='team-0'||allowed&&!hidden.has(point.team_id))}};
 };
 await page.routeWebSocket(/\/ws\?/,ws=>{socket=ws;ws.send(JSON.stringify(snapshot(ws)));});
 return {state,calls,emit:(event:any)=>socket?.send(JSON.stringify(event)),hideTeam:(team:string,value:boolean)=>{if(value)hidden.add(team);else hidden.delete(team);state.map.visibility_revision=(state.map.visibility_revision??0)+1;},push:()=>{state.map.server_time=new Date().toISOString();if(socket)socket.send(JSON.stringify(snapshot(socket)));}};
}
async function openMap(page:any,project:string,dismissPrompt=true) {
 if(project==='desktop')await page.getByRole('button',{name:'Map',exact:true}).click();
 else await page.getByRole('navigation',{name:'Game views'}).getByRole('button',{name:'Map',exact:true}).click();
 await expect(page.getByRole('region',{name:'Playing area map'})).toBeVisible();
 await expect(page.locator('.maplibregl-canvas')).toBeVisible();
 await expect(page.getByText('Map tiles could not load.',{exact:false})).toHaveCount(0);
 const prompt=page.getByRole('dialog',{name:'See your team on the map'});
 if(dismissPrompt&&await prompt.isVisible())await prompt.getByRole('button',{name:'Not now',exact:true}).click();
}

test('opening the map prompts non-sharing players again, but never starts GPS without consent',async({page},info)=>{
 const fixture=await install(page);await page.goto('/');
 const back=()=>info.project.name==='desktop'?page.getByRole('button',{name:'Back to board',exact:true}).click():page.getByRole('navigation',{name:'Game views'}).getByRole('button',{name:'The board',exact:true}).click();
 const prompt=page.getByRole('dialog',{name:'See your team on the map'});
 await expect(prompt).toHaveCount(0);
 await openMap(page,info.project.name,false);await expect(prompt).toBeVisible();
 await expect(prompt).toContainText('If you decline or stop sharing, their trackers stay hidden.');
 expect(fixture.calls).toEqual([]);expect(await page.evaluate(()=>(window as any).__gpsRequests)).toBe(0);
 await prompt.getByRole('button',{name:'Not now',exact:true}).click();
 await expect(prompt).toHaveCount(0);
 fixture.push();await expect(prompt).toHaveCount(0);
 await back();
 await openMap(page,info.project.name,false);await expect(prompt).toBeVisible();
 await prompt.getByRole('button',{name:'Share location',exact:true}).click();
 await expect(page.getByRole('button',{name:'Stop sharing',exact:true})).toBeVisible();
 expect(fixture.calls).toEqual(['start','fix']);
 await back();
 await openMap(page,info.project.name,false);await expect(prompt).toHaveCount(0);
 await page.getByRole('button',{name:'Stop sharing',exact:true}).click();
 await expect(prompt).toHaveCount(0);
 await back();
 await openMap(page,info.project.name,false);await expect(prompt).toBeVisible();
});

test('hidden teams disappear from player maps and delayed pre-hide fixes stay hidden',async({page},info)=>{
 const fixture=await install(page);
 const rival={team_id:'rival',team_name:'Rival tracker',device_id:'phone',lat:1.31,lng:103.92,accuracy_m:10,updated_at:new Date().toISOString(),revision:1};
 fixture.state.map.locations=[rival];await page.goto('/');await openMap(page,info.project.name);
 await page.getByRole('button',{name:'Share my location',exact:true}).click();
 await expect(page.getByRole('button',{name:'Stop sharing',exact:true})).toBeVisible();
 await expect(page.locator('.map-roster')).toContainText('Rival tracker');
 fixture.hideTeam('rival',true);fixture.push();
 await expect(page.locator('.map-roster')).not.toContainText('Rival tracker');
 fixture.emit({kind:'location',session_id:fixture.state.session.id,visibility_revision:0,location:{...rival,revision:99}});
 await expect(page.locator('.map-roster')).not.toContainText('Rival tracker');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 fixture.hideTeam('rival',false);fixture.push();await expect(page.locator('.map-roster')).toContainText('Rival tracker');
});

test('host can hide and restore a team without ending the game',async({page})=>{
 const fixture=await installBoardFixture(page);
 fixture.state.map={...publicMap(),plan:{stages:[stage0,stage1]},finish:{lat:1.3,lng:103.9},hidden_team_ids:[],visibility_revision:0};
 const writes:boolean[]=[];
 await page.route('**/api/admin/sessions/*/map/teams/*/visibility',async route=>{
  const visible=route.request().postDataJSON().visible;writes.push(visible);
  fixture.state.map!.hidden_team_ids=visible?[]:['team-0'];fixture.state.map!.visibility_revision!++;
  await route.fulfill({json:{ok:true}});fixture.push();
 });
 await page.goto('/admin');await page.getByRole('button',{name:'Map',exact:true}).click();
 const checkbox=page.getByRole('checkbox',{name:'Show Team 1 to other players',exact:true});
 await expect(checkbox).toBeChecked();await checkbox.click();await expect(checkbox).not.toBeChecked();
 await expect(page.getByText('Hidden from other players',{exact:true})).toBeVisible();
 expect(fixture.state.session.status).toBe('active');
 await page.reload();await page.getByRole('button',{name:'Map',exact:true}).click();await expect(checkbox).not.toBeChecked();
 await checkbox.click();await expect(checkbox).toBeChecked();expect(writes).toEqual([false,true]);
 await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('players see the area, opt in to GPS, stop sharing and receive automatic area changes',async({page},info)=>{
 const fixture=await install(page);await page.goto('/');await openMap(page,info.project.name);
 expect(fixture.calls).toEqual([]);
 await expect(page.getByRole('link',{name:/OpenStreetMap contributors/})).toBeVisible();
 await expect(page.getByText('Hidden destination (host only)',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Share my location',exact:true}).click();
 await expect(page.getByRole('button',{name:'Stop sharing',exact:true})).toBeVisible();
 await expect(page.getByText('Team 1 (your device)',{exact:true})).toBeVisible();
 expect(fixture.calls).toEqual(['start','fix']);
 fixture.state.map={...fixture.state.map,area:stage1,stage_index:1,started_at:new Date().toISOString()};fixture.push();
 await expect(page.getByText('Area 2 of 2',{exact:true})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'The playing area has shrunk'})).toBeVisible();
 await page.getByRole('button',{name:'Got it',exact:true}).click();
 await expect(page.locator('.playing-area')).not.toContainText('Next shrink');
 await expect(page.getByRole('button',{name:'Stop sharing',exact:true})).toHaveCSS('opacity','1');
 expect((await new AxeBuilder({page}).include('.playing-area').analyze()).violations).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`artifacts/playing-area-${info.project.name}.png`});
 await page.getByRole('button',{name:'Stop sharing',exact:true}).click();
 await expect(page.getByRole('button',{name:'Share my location',exact:true})).toBeVisible();
 await expect(page.getByText('Team 1 (your device)',{exact:true})).toHaveCount(0);
 expect(fixture.calls).toEqual(['start','fix','stop']);
});

test('denied location permission does not block playing or create a share',async({page},info)=>{
 const fixture=await install(page,true);await page.goto('/');await openMap(page,info.project.name);
 await page.getByRole('button',{name:'Share my location',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('permission was denied');
 expect(fixture.calls).toEqual([]);
 await expect(page.getByRole('button',{name:'Share my location',exact:true})).toBeEnabled();
});

test('first join offers optional location sharing and dismissal persists on this device',async({page},info)=>{
 const fixture=await install(page,false,true);await page.goto('/');
 await page.getByLabel('Team code',{exact:true}).fill('TEAM01');await page.getByRole('button',{name:'Join / rejoin team',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'See your team on the map'});
 await expect(dialog).toBeVisible();expect(fixture.calls).toEqual([]);
 expect(await page.evaluate(()=>(window as any).__gpsRequests)).toBe(0);
 await expect(dialog).toContainText('game radius');await expect(dialog).toContainText('host and other sharing teams');
 await expect(dialog).toContainText('If you decline or stop sharing, their trackers stay hidden.');
 expect((await new AxeBuilder({page}).include('.race-dialog').analyze()).violations).toEqual([]);
 await dialog.screenshot({path:`artifacts/location-prompt-${info.project.name}.png`});
 await dialog.getByRole('button',{name:'Not now',exact:true}).click();
 await expect(dialog).toHaveCount(0);expect(fixture.calls).toEqual([]);
 await page.reload();await expect(page.locator('.player-identity')).toBeVisible();await expect(dialog).toHaveCount(0);
});

test('a lobby join keeps the prompt pending until the configured game starts',async({page})=>{
 const fixture=await install(page,false,true);fixture.state.session.status='lobby';await page.goto('/');
 await page.getByLabel('Team code',{exact:true}).fill('TEAM01');await page.getByRole('button',{name:'Join / rejoin team',exact:true}).click();
 await expect(page.locator('.player-identity')).toBeVisible();
 await expect(page.getByRole('dialog',{name:'See your team on the map'})).toHaveCount(0);
 await page.reload();await expect(page.locator('.player-identity')).toBeVisible();
 fixture.state.session.status='active';fixture.push();
 await expect(page.getByRole('dialog',{name:'See your team on the map'})).toBeVisible();expect(fixture.calls).toEqual([]);
});

test('accepting the join prompt opens the map and starts sharing only after consent',async({page})=>{
 const fixture=await install(page,false,true);await page.goto('/');
 await page.getByLabel('Team code',{exact:true}).fill('TEAM01');await page.getByRole('button',{name:'Join / rejoin team',exact:true}).click();
 await page.getByRole('dialog',{name:'See your team on the map'}).getByRole('button',{name:'Share location',exact:true}).click();
 await expect(page.getByRole('region',{name:'Playing area map'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Stop sharing',exact:true})).toBeVisible();expect(fixture.calls).toEqual(['start','fix']);
});

test('multiple devices on one team render one tracker and one roster entry',async({page},info)=>{
 const fixture=await install(page);const now=new Date().toISOString();
 const device=(id:string,lng:number)=>({team_id:'team-0',team_name:'Team 1',device_id:id,lat:1.31,lng,accuracy_m:10,updated_at:now,revision:1});
 fixture.state.map.locations=[device('a',103.90),device('b',103.902)];
 await page.goto('/');await openMap(page,info.project.name);
 await expect(page.locator('.map-pin-shell')).toHaveCount(1);await expect(page.locator('.map-roster li')).toHaveCount(1);
 await expect(page.locator('.map-roster')).toContainText('2 devices');
 fixture.state.map.locations=[device('b',103.902)];fixture.push();
 await expect(page.locator('.map-pin-shell')).toHaveCount(1);await expect(page.locator('.map-roster')).toContainText('1 device');
 fixture.state.map.locations=[];fixture.push();await expect(page.locator('.map-pin-shell')).toHaveCount(0);
});

test('rival trackers require this device to share, even when another teammate is sharing',async({page},info)=>{
 const fixture=await install(page);const now=new Date().toISOString();
 fixture.state.map.locations=[{team_id:'team-0',team_name:'Team 1',device_id:'teammate',lat:1.31,lng:103.90,accuracy_m:10,updated_at:now,revision:1},
  {team_id:'rival',team_name:'Rival tracker',device_id:'other',lat:1.31,lng:103.92,accuracy_m:10,updated_at:now,revision:1}];
 await page.goto('/');await openMap(page,info.project.name);
 await expect(page.locator('.map-pin-shell')).toHaveCount(1);await expect(page.locator('.map-roster')).not.toContainText('Rival tracker');
 await expect(page.locator('.map-roster')).toContainText('Share your location to see other teams.');
 await page.getByRole('button',{name:'Share my location',exact:true}).click();
 await expect(page.getByRole('button',{name:'Stop sharing',exact:true})).toBeVisible();
 await expect(page.locator('.map-pin-shell')).toHaveCount(2);await expect(page.locator('.map-roster')).toContainText('Rival tracker');
 await page.getByRole('button',{name:'Stop sharing',exact:true}).click();
 await expect(page.locator('.map-roster')).not.toContainText('Rival tracker');await expect(page.locator('.map-pin-shell')).toHaveCount(1);
});

test('players get a shrink modal from the board, without timer details or duplicate alerts',async({page},info)=>{
 const fixture=await install(page);await page.goto('/');await expect(page.locator('.player-identity')).toBeVisible();
 const dialog=page.getByRole('dialog',{name:'The playing area has shrunk'});
 await expect(dialog).toHaveCount(0);
 fixture.state.map={...fixture.state.map,area:stage1,stage_index:1,started_at:new Date().toISOString(),next_shrink_at:new Date(Date.now()+600000).toISOString()};fixture.push();
 await expect(dialog).toBeVisible();await expect(dialog).toContainText('1.5 km radius');
 expect((await new AxeBuilder({page}).include('.race-dialog').analyze()).violations).toEqual([]);
 await dialog.screenshot({path:`artifacts/shrink-notice-${info.project.name}.png`});
 await dialog.getByRole('button',{name:'View map',exact:true}).click();
 await expect(page.getByRole('region',{name:'Playing area map'})).toBeVisible();
 await expect(page.locator('.playing-area')).not.toContainText('Next shrink');
 await expect(page.locator('.playing-area')).not.toContainText('Shrink timer');expect(fixture.calls).toEqual([]);
 fixture.push();await expect(dialog).toHaveCount(0);
 fixture.state.map={...fixture.state.map,area:stage0,stage_index:0};fixture.push();await expect(dialog).toHaveCount(0);
 fixture.state.map={...fixture.state.map,area:stage1,stage_index:1};fixture.push();await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'Got it',exact:true}).click();
 await page.reload();await expect(page.locator('.player-identity')).toBeVisible();await expect(dialog).toHaveCount(0);
});

test('host sees new-game defaults and can schedule or immediately shrink through both zones',async({page},info)=>{
 const start={lat:1.3108674745426903,lng:103.86352181175857};
 const finish={lat:1.2993920420142073,lng:103.90664926387365};
 const defaults=[0,.35,.7].map((fraction,i)=>({lat:start.lat+fraction*(finish.lat-start.lat),lng:start.lng+fraction*(finish.lng-start.lng),radius_m:[7000,5000,3000][i],after_seconds:i===0?0:null}));
 const host:any=fixtureState();host.map={...publicMap(),initial_area:defaults[0],area:defaults[0],stage_count:3,plan:{stages:defaults},finish};
 const writes:any[]=[];let socket:WebSocketRoute|undefined;
 await page.addInitScript(()=>{localStorage.setItem('challenge.admin-token','map-host');localStorage.setItem('challenge.admin-session','design-session');});
 await page.route(/\/api\//,async route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()==='PUT') {
   const body=route.request().postDataJSON();writes.push(body);host.map.plan={stages:body.stages};host.map.finish=body.finish;
   await route.fulfill({json:{ok:true}});socket?.send(JSON.stringify(host));return;
  }
  if(path.endsWith('/map/shrink')) {host.map.stage_index++;host.map.area=host.map.plan.stages[host.map.stage_index];if(host.map.started_at)host.map.started_at=new Date(Date.now()-host.map.area.after_seconds*1000).toISOString();if(host.map.stage_index===2)host.map.next_shrink_at=null;await route.fulfill({json:{stage_index:host.map.stage_index}});socket?.send(JSON.stringify(host));return;}
  if(path.endsWith('/map/start')) {host.map.started_at=new Date().toISOString();host.map.next_shrink_at=new Date(Date.now()+1200000).toISOString();await route.fulfill({json:{ok:true}});socket?.send(JSON.stringify(host));return;}
  await route.fulfill({json:path.endsWith('/sessions')?[{...host.session,created_at:'2026-11-16'}]:host});
 });
 await page.routeWebSocket(/\/ws\?/,ws=>{socket=ws;ws.send(JSON.stringify(host));});
 await page.goto('/admin');await page.getByRole('button',{name:'Map',exact:true}).click();
 await expect(page.getByRole('region',{name:'Playing area map'})).toBeVisible();
 await expect(page.getByRole('spinbutton',{name:'Stage 1 radius (km)',exact:true})).toHaveValue('7');
 await expect(page.getByRole('spinbutton',{name:'Stage 2 radius (km)',exact:true})).toHaveValue('5');
 await expect(page.getByRole('spinbutton',{name:'Stage 3 radius (km)',exact:true})).toHaveValue('3');
 await expect(page.getByRole('spinbutton',{name:'Stage 2 after (minutes)',exact:true})).toBeEmpty();
 await expect(page.getByRole('spinbutton',{name:'Stage 3 after (minutes)',exact:true})).toBeEmpty();
 await page.getByRole('spinbutton',{name:'Stage 2 after (minutes)',exact:true}).fill('10');
 await page.getByRole('spinbutton',{name:'Stage 3 after (minutes)',exact:true}).fill('20');
 await expect(page.getByRole('button',{name:'Shrink area',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Start shrink countdown',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Save playing area',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0].stages).toHaveLength(3);
 expect(writes[0].finish).toEqual(finish);expect(writes[0].stages[0]).toMatchObject({...start,radius_m:7000});
 expect(writes[0].stages.map((stage:any)=>stage.after_seconds)).toEqual([0,600,1200]);
 await page.getByRole('button',{name:'Shrink area',exact:true}).click();
 await expect(page.getByText('Area 2 of 3',{exact:true})).toBeVisible();
 expect(host.map.started_at).toBeNull();
 await page.getByRole('button',{name:'Start shrink countdown',exact:true}).click();
 await expect(page.getByRole('button',{name:'Reset shrink timer',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Save playing area',exact:true})).toBeDisabled();
 const clock=host.map.started_at;
 await page.getByRole('button',{name:'Shrink area',exact:true}).click();
 await expect(page.getByText('Area 3 of 3',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Shrink area',exact:true})).toBeDisabled();
 expect(host.map.started_at).not.toBe(clock);
 await expect(page.getByRole('button',{name:'Reset shrink timer',exact:true})).toHaveCSS('opacity','1');
 expect((await new AxeBuilder({page}).include('.map-host').analyze()).violations).toEqual([]);
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:`artifacts/host-playing-area-${info.project.name}.png`,fullPage:true});
});

test('host timeline supports live countdown, keyboard, dragging, reset and stage jumps',async({page},info)=>{
 const stages=[0,600,1200].map((after_seconds,index)=>({...stage0,radius_m:5000-index*1500,after_seconds}));
 const host:any=fixtureState();host.map={...publicMap(),stage_count:3,initial_area:stages[0],area:stages[0],plan:{stages},finish:{lat:1.31,lng:103.9},started_at:new Date(Date.now()-30000).toISOString()};
 const seeks:number[]=[];let socket:WebSocketRoute|undefined;let fail=false;
 const update=(seconds:number)=>{host.map.started_at=new Date((host.map.paused_at?Date.parse(host.map.paused_at):Date.now())-seconds*1000).toISOString();host.map.stage_index=seconds>=1200?2:seconds>=600?1:0;host.map.area=stages[host.map.stage_index];host.map.server_time=new Date().toISOString();};
 await page.addInitScript(()=>{localStorage.setItem('challenge.admin-token','map-host');localStorage.setItem('challenge.admin-session','design-session');});
 await page.route(/\/api\//,async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/map/seek')) {
   if(fail){await route.fulfill({status:503,json:{detail:'Timer update failed'}});return;}
   const seconds=route.request().postDataJSON().elapsed_seconds;seeks.push(seconds);update(seconds);
  }else if(path.endsWith('/map/reset')){host.map.started_at=null;host.map.paused_at=null;host.map.stage_index=0;host.map.area=stages[0];}
  else if(path.endsWith('/map/pause')){host.map.paused_at??=new Date().toISOString();host.map.server_time=new Date().toISOString();}
  else if(path.endsWith('/map/resume')){if(host.map.paused_at)host.map.started_at=new Date(Date.parse(host.map.started_at)+Date.now()-Date.parse(host.map.paused_at)).toISOString();host.map.paused_at=null;host.map.server_time=new Date().toISOString();}
  else if(path.endsWith('/map/start'))update(0);
  else if(path.endsWith('/map/shrink'))update(stages[host.map.stage_index+1].after_seconds);
  await route.fulfill({json:path.endsWith('/sessions')?[{...host.session,created_at:'2026-11-16'}]:host});socket?.send(JSON.stringify(host));
 });
 await page.routeWebSocket(/\/ws\?/,ws=>{socket=ws;ws.send(JSON.stringify(host));});
 await page.goto('/admin');await page.getByRole('button',{name:'Map',exact:true}).click();
 const slider=page.getByRole('slider',{name:'Shrink countdown position'});
 await expect(slider).toBeEnabled();
 await expect(page.locator('.map-zone-future')).toHaveCount(2);
 await expect(page.locator('.map-zone-future').first()).toHaveAttribute('stroke-dasharray','1 7');
 const initial=Number(await slider.getAttribute('aria-valuenow'));
 await expect.poll(async()=>Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThan(initial);
 await page.getByRole('button',{name:'Pause shrink timer',exact:true}).click();
 await expect(page.getByRole('button',{name:'Resume shrink timer',exact:true})).toBeVisible();
 const frozen=await slider.getAttribute('aria-valuenow');const frozenText=await page.locator('.map-main-timer strong').textContent();
 await page.waitForTimeout(1200);
 await expect(slider).toHaveAttribute('aria-valuenow',frozen!);await expect(page.locator('.map-main-timer strong')).toHaveText(frozenText!);
 await expect(page.locator('.shrink-timeline-heading strong')).toContainText('Paused:');
 await page.reload();await page.getByRole('button',{name:'Map',exact:true}).click();
 await expect(page.getByRole('button',{name:'Resume shrink timer',exact:true})).toBeVisible();await expect(slider).toHaveAttribute('aria-valuenow',frozen!);
 await page.getByRole('button',{name:'Resume shrink timer',exact:true}).click();
 await expect(page.getByRole('button',{name:'Pause shrink timer',exact:true})).toBeVisible();
 await expect.poll(async()=>Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThan(Number(frozen));
 await page.getByRole('button',{name:'Shrink to stage 2 at 10 minutes',exact:true}).click();
 await expect.poll(()=>seeks.at(-1)).toBe(600);
 await expect(page.getByText('Area 2 of 3',{exact:true})).toBeVisible();
 await expect(page.locator('.map-zone-future')).toHaveCount(1);
 await expect(page.getByRole('group',{name:'Next shrink countdown'})).toContainText('Next shrink · Stage 3');
 await expect(slider).toBeEnabled();
 await page.getByRole('button',{name:'Shrink to stage 3 at 20 minutes',exact:true}).click();
 await expect.poll(()=>seeks.at(-1)).toBe(1200);
 await expect(page.getByText('Area 3 of 3',{exact:true})).toBeVisible();
 await expect(page.locator('.map-zone-future')).toHaveCount(0);
 await expect(page.locator('.map-main-timer strong')).toHaveText('00:00');
 await expect(slider).toBeEnabled();
 await page.getByRole('button',{name:'Restore starting area at 0 minutes',exact:true}).click();
 await expect.poll(()=>seeks.at(-1)).toBe(0);
 await expect(page.getByText('Area 1 of 3',{exact:true})).toBeVisible();
 await expect(page.locator('.map-zone-future')).toHaveCount(2);
 await expect(slider).toBeEnabled();
 await slider.focus();await slider.press('End');await expect.poll(()=>seeks.at(-1)).toBe(1200);
 await expect(page.getByRole('progressbar',{name:'Elapsed shrink schedule'})).toHaveAttribute('aria-valuenow','100');
 await expect(page.getByText('Final area reached',{exact:true})).toBeVisible();
 await expect(slider).toBeEnabled();
 await slider.press('ArrowLeft');await expect.poll(()=>seeks.at(-1)).toBe(1199);
 await expect(page.locator('.shrink-timeline')).toHaveClass(/warning/);
 await expect(slider).toBeEnabled();
 await slider.press('Home');await expect.poll(()=>seeks.at(-1)).toBe(0);
 await expect(page.getByText('Area 1 of 3',{exact:true})).toBeVisible();
 await slider.evaluate(el=>el.scrollIntoView({block:'center'}));
 const rect=(await slider.boundingBox())!;const before=seeks.length;
 await page.mouse.move(rect.x+12,rect.y+rect.height/2);await page.mouse.down();
 await page.mouse.move(rect.x+rect.width*.7,rect.y+rect.height/2,{steps:8});
 await expect(page.locator('.shrink-time-tooltip')).toBeVisible();expect(seeks.length).toBe(before);
 await expect(page.locator('.shrink-timeline-heading strong')).toContainText('Next shrink: Stage 3');
 const alignment=await page.locator('.shrink-timeline').evaluate(el=>{
  const track=el.querySelector('.shrink-remaining')!.getBoundingClientRect();
  const fill=el.querySelector('.shrink-remaining > span')!.getBoundingClientRect();
  const range=el.querySelector('input')!;
  const tick=el.querySelectorAll('.shrink-ticks i')[1].getBoundingClientRect();
  const label=el.querySelectorAll('.shrink-markers li')[1].getBoundingClientRect();
  return {fill:Math.abs(fill.right-(track.left+Number(range.value)/Number(range.max)*track.width)),marker:Math.abs(tick.x+tick.width/2-label.x-label.width/2)};
 });
 expect(alignment.fill).toBeLessThan(2);expect(alignment.marker).toBeLessThan(2);
 await page.mouse.up();await expect.poll(()=>seeks.length).toBe(before+1);
 expect(seeks.at(-1)).toBeGreaterThan(700);expect(seeks.at(-1)).toBeLessThan(1000);
 if(info.project.use.hasTouch){await expect(slider).toBeEnabled();const touchRect=(await slider.boundingBox())!;await page.touchscreen.tap(touchRect.x+touchRect.width*.3,touchRect.y+touchRect.height/2);await expect.poll(()=>seeks.length).toBe(before+2);}
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Reset shrink timer',exact:true}).click();
 await expect(slider).toBeDisabled();await expect(slider).toHaveAttribute('aria-valuenow','0');
 await expect(page.locator('.map-main-timer strong')).toHaveText('--:--');
 await expect(page.getByRole('button',{name:'Shrink to stage 2 at 10 minutes',exact:true})).toBeDisabled();
 await expect(page.locator('.shrink-timeline')).toHaveClass(/stopped/);
 await page.getByRole('button',{name:'Start shrink countdown',exact:true}).click();await expect(slider).toBeEnabled();
 await page.getByRole('button',{name:'Shrink area',exact:true}).click();
 await expect.poll(async()=>Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(600);
 expect((await new AxeBuilder({page}).include('.map-plan-editor').analyze()).violations).toEqual([]);
 await expect(page.getByRole('button',{name:'Save playing area',exact:true})).toBeDisabled();
 await page.getByRole('spinbutton',{name:'Stage 2 after (minutes)',exact:true}).scrollIntoViewIfNeeded();
 await page.locator('.map-plan-editor').screenshot({path:`artifacts/shrink-timeline-${info.project.name}.png`,style:'.race-host-header{visibility:hidden}'});
 fail=true;await slider.focus();await slider.press('Home');
 await expect(page.getByRole('alert')).toContainText('Timer update failed');
 await expect.poll(async()=>Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(600);
});
