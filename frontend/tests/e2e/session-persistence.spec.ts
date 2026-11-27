import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { fixtureState } from "./board.fixture";

test('new sessions default to eight teams',async({page})=>{
 const host=fixtureState();host.session.team_count=8;
 const requests:any[]=[];
 await page.addInitScript(()=>{localStorage.setItem('challenge.admin-token','local-host');localStorage.removeItem('challenge.admin-session');});
 await page.route(/\/api\//,async route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()==='POST'){
   requests.push(route.request().postDataJSON());
   await route.fulfill({json:{session:host.session,teams:host.teams}});
  }else await route.fulfill({json:path.endsWith('/sessions')?[]:host});
 });
 await page.routeWebSocket(/\/ws\?/,socket=>socket.send(JSON.stringify(host)));
 await page.goto('/admin');
 await expect(page.getByRole('spinbutton',{name:'Teams',exact:true})).toHaveValue('8');
 await page.getByRole('textbox',{name:'Hunt name',exact:true}).fill('Eight teams');
 await page.getByRole('button',{name:'Create session',exact:true}).click();
 await expect.poll(()=>requests.length).toBe(1);
 expect(requests[0]).toMatchObject({name:'Eight teams',team_count:8});
});

function state() {
  const host=fixtureState();
  return { kind:"team",session:host.session,team:{id:"team-0",name:"Team 1"},me:{id:"member",name:"Alice"},board:host.board,progress:host.progress,clues:[],my_submissions:[],clue_awards:[] };
}

test("temporary startup failure preserves the saved player login and retries", async ({page}) => {
  let failing=true;
  await page.addInitScript(()=>localStorage.setItem("challenge.team-token","saved-player-token"));
  await page.route(/\/api\/state$/,route=>failing ? route.fulfill({status:503,json:{detail:"temporarily unavailable"}}) : route.fulfill({json:state()}));
  await page.routeWebSocket(/\/ws\?/,ws=>ws.send(JSON.stringify(state())));
  await page.goto("/");
  await expect(page.getByRole("button",{name:"Try again",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem("challenge.team-token"))).toBe("saved-player-token");
  failing=false;
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await expect(page.locator(".player-identity")).toHaveText("Team 1");
});

test("a confirmed invalid saved token returns to join without recovery by name", async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem("challenge.team-token","invalid-player-token"));
  await page.route(/\/api\/state$/,route=>route.fulfill({status:401,json:{detail:"invalid or missing team token"}}));
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"Join your team",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem("challenge.team-token"))).toBeNull();
});



test("team code joins and rejoins the shared pool without a name", async ({page,context}) => {
  let joins=0;
  const shared={...state(),clues:[{id:"earned",tier:"tier2",title:"Our earned clue",body:"Shared by the team",media_url:null,unlocked_at:"2026-11-16"}]};
  await context.route(/\/api\//,async route=> {
    if(new URL(route.request().url()).pathname==='/api/join') {
      joins++;
      expect(route.request().postDataJSON()).toEqual({code:'TEAM01'});
      await route.fulfill({json:{token:'shared-team-token',state:shared}});
    } else await route.fulfill({json:shared});
  });
  await page.routeWebSocket(/\/ws\?/,ws=>ws.send(JSON.stringify(shared)));
  await page.goto('/');
  await expect(page.getByLabel('Your name',{exact:true})).toHaveCount(0);
  await page.getByLabel('Team code',{exact:true}).fill('TEAM01');
  await page.getByRole('button',{name:'Join / rejoin team',exact:true}).click();
  await expect(page.locator('.player-identity')).toHaveText('Team 1');
  await expect(page.getByText('Alice',{exact:true})).toHaveCount(0);
  await page.evaluate(()=>localStorage.removeItem('challenge.team-token'));
  await page.reload();
  await page.getByLabel('Team code',{exact:true}).fill('TEAM01');
  await page.getByRole('button',{name:'Join / rejoin team',exact:true}).click();
  await expect(page.locator('.player-identity')).toHaveText('Team 1');
  expect(joins).toBe(2);
  expect(await page.evaluate(()=>localStorage.getItem('challenge.team-token'))).toBe('shared-team-token');
  await page.close();
  const reopened=await context.newPage();
  await reopened.routeWebSocket(/\/ws\?/,ws=>ws.send(JSON.stringify(shared)));
  await reopened.goto('/');
  await expect(reopened.locator('.player-identity')).toHaveText('Team 1');
  expect(joins).toBe(2);
});

test("any joined device can rename the team and teammates see the update", async ({page,context},info) => {
  const shared={...state(),clues:[{id:'earned',tier:'tier2',title:'Our clue',body:'Preserved',media_url:null,unlocked_at:'2026-11-16'}]};
  const sockets: import('@playwright/test').WebSocketRoute[]=[];
  await context.addInitScript(()=>localStorage.setItem('challenge.team-token','shared-team-token'));
  await context.route(/\/api\//,async route=> {
    if(route.request().method()==='PATCH') {
      expect(new URL(route.request().url()).pathname).toBe('/api/team');
      const name=route.request().postDataJSON().name;
      if(name==='Taken') {await route.fulfill({status:400,json:{detail:'another team is already using that name'}});return;}
      shared.team.name=name;
      shared.progress=shared.progress.map(row=>row.team_id===shared.team.id ? {...row,team_name:name} : row);
      await route.fulfill({json:{name}});
      sockets.forEach(ws=>ws.send(JSON.stringify(shared)));
    } else await route.fulfill({json:shared});
  });
  const teammate=await context.newPage();
  for(const device of [page,teammate]) {
    await device.routeWebSocket(/\/ws\?/,ws=>{sockets.push(ws);ws.send(JSON.stringify(shared));});
    await device.goto('/');
    await expect(device.locator('.player-identity')).toHaveText('Team 1');
  }
  await teammate.getByLabel('Game menu',{exact:true}).click();
  await teammate.getByRole('button',{name:'Change team name',exact:true}).click();
  const dialog=teammate.getByRole('dialog',{name:'Change team name',exact:true});
  await dialog.getByLabel('Team name',{exact:true}).fill('Orange Explorers');
  await expect(dialog.getByRole('button',{name:'Save team name',exact:true})).toBeEnabled();
  await expect(dialog.getByRole('button',{name:'Save team name',exact:true})).toHaveCSS('opacity','1');
  expect((await new AxeBuilder({page:teammate}).analyze()).violations).toEqual([]);
  await teammate.screenshot({path:`artifacts/team-name-dialog-${info.project.name}.png`});
  await dialog.getByRole('button',{name:'Save team name',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.player-identity')).toHaveText('Orange Explorers');
  await expect(teammate.locator('.player-identity')).toHaveText('Orange Explorers');
  expect(shared.clues).toHaveLength(1);
  expect(await teammate.evaluate(()=>localStorage.getItem('challenge.team-token'))).toBe('shared-team-token');
  await teammate.getByLabel('Game menu',{exact:true}).click();
  await teammate.getByRole('button',{name:'Change team name',exact:true}).click();
  await dialog.getByLabel('Team name',{exact:true}).fill('Taken');
  await dialog.getByRole('button',{name:'Save team name',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('already using');
  await expect(teammate.locator('.player-identity')).toHaveText('Orange Explorers');
});
