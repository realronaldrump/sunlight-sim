import { test, expect, devices, type Page } from '@playwright/test';

const phone={viewport:{width:390,height:844},screen:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:devices['iPhone 13'].userAgent};
test.use(phone);

async function ready(page:Page,query='') {
  await page.goto(`/?autostart=1&ambient=0${query}`);
  await page.waitForFunction(()=>(window as any).game?.ready,null,{timeout:120_000});
  await expect(page.locator('#pause-toggle')).toBeVisible();
}

const scenery = (page: Page) => page.locator('#app canvas');
const menu = (page: Page) => page.getByRole('button', { name: 'Flight menu' });

async function down(page: Page, id: number, x: number, y: number) {
  await scenery(page).dispatchEvent('pointerdown', { pointerId:id, pointerType:'touch', clientX:x, clientY:y });
}

async function move(page: Page, id: number, x: number, y: number) {
  await scenery(page).dispatchEvent('pointermove', { pointerId:id, pointerType:'touch', clientX:x, clientY:y });
}

async function release(page: Page, id: number) {
  await scenery(page).dispatchEvent('pointerup', { pointerId:id, pointerType:'touch' });
}

async function forward(page: Page) {
  await down(page, 42, 190, 330);
  await move(page, 42, 210, 290);
  await down(page, 31, 280, 610);
}

async function hover(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as any).game.drone.state.speed), { timeout:10000 }).toBeLessThan(.05);
}

test('phone gestures aim, fly forward, reverse and release to hover',async({page,browserName},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?ambient=0&onfoot=1&fly=1&cam=0,3000,0&quality=ultra');
  await expect(page.getByRole('button',{name:'Fly solo'})).toBeVisible({timeout:120_000});
  await page.getByRole('button',{name:'Fly solo'}).tap();
  await expect(menu(page)).toBeVisible();
  expect(await page.evaluate(()=>{const g=(window as any).game;return [g.droneOnly,g.drone.active,g.drone.fpv,g.onFoot.active,g.flyMode,g.player.model.root.visible];})).toEqual([true,true,true,false,false,false]);
  await expect(page.locator('#touch-fly,#touch-back,.flight-bottom,.flight-toolbar')).toHaveCount(0);
  await expect(page.locator('#drone-telemetry')).toBeHidden();
  await expect(page.locator('#chatlog')).toBeHidden();
  const parked=await page.evaluate(()=>({...((window as any).game.drone.state.pos)}));
  await page.touchscreen.tap(200,360);
  await down(page,42,190,330);
  await move(page,42,220,280);
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.state.pitch)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>({...((window as any).game.drone.state.pos)}))).toEqual(parked);
  await down(page,31,280,610);
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.state.speed),{timeout:15000}).toBeGreaterThan(1);
  const yaw=await page.evaluate(()=>(window as any).game.drone.state.yaw);
  await move(page,42,285,220);
  await expect.poll(()=>page.evaluate(y=>Math.abs((window as any).game.drone.state.yaw-y),yaw)).toBeGreaterThan(.15);
  expect(await page.evaluate(()=>(window as any).game.touch.direction)).toBe(1);
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.state.vel.y)).toBeGreaterThan(.2);
  await page.screenshot({path:info.outputPath('gesture-flight-portrait.png')});
  await release(page,31);
  await hover(page);
  await down(page,31,280,610);
  expect(await page.evaluate(()=>(window as any).game.touch.direction)).toBe(1);
  await release(page,42);
  await hover(page);
  expect(await page.evaluate(()=>(window as any).game.touch.direction)).toBe(0);
  await release(page,31);

  // Chromium exercises actual simultaneous browser contacts. WebKit receives the same pointer events.
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:150,y:340,id:51},{x:260,y:430,id:52}]});
  } else {
    await scenery(page).evaluate(canvas=>{
      canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerId:51,pointerType:'touch',clientX:150,clientY:340,bubbles:true}));
      canvas.dispatchEvent(new PointerEvent('pointerdown',{pointerId:52,pointerType:'touch',clientX:260,clientY:430,bubbles:true}));
    });
  }
  await expect.poll(()=>page.evaluate(()=>{const s=(window as any).game.drone.state;return -s.vel.x*Math.sin(s.yaw)-s.vel.z*Math.cos(s.yaw);})).toBeLessThan(-.4);
  expect(await page.evaluate(()=>(window as any).game.touch.direction)).toBe(-1);
  if (cdp) { await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await cdp.detach(); }
  else { await release(page,51);await release(page,52); }
  await hover(page);
  await menu(page).tap();
  await page.getByRole('button',{name:'Switch view'}).tap();
  expect(await page.evaluate(()=>(window as any).game.drone.fpv)).toBe(false);
  for(const key of ['KeyG','KeyK','KeyB','KeyF'])await page.keyboard.press(key);
  await page.evaluate(async()=>{const g=(window as any).game;g.startOnFoot();g.toggleSkis();await g.toggleDrone();g.respawn();await g.setView(0,3000,0,0,0);});
  expect(await page.evaluate(()=>{const g=(window as any).game;return [g.drone.active,g.onFoot.active,g.flyMode,!!g.player.ride,g.player.model.root.visible];})).toEqual([true,false,false,false,false]);
  await page.setViewportSize({width:844,height:390});await page.screenshot({path:info.outputPath('direct-phone-landscape.png')});
  const button = await menu(page).boundingBox();
  expect(button).toBeTruthy();
  expect(button!.x+button!.width).toBeLessThanOrEqual(844);
  expect(button!.width).toBeLessThanOrEqual(44);
  await page.setViewportSize({width:320,height:568});await page.screenshot({path:info.outputPath('direct-phone-small.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);expect(errors).toEqual([]);
});

test('held flight cancels safely for panels, lost touches, focus and rotation',async({page},info)=>{
  await ready(page,'&webgl=1');await forward(page);
  await menu(page).tap();await expect(page.locator('#opts')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).game.touch.direction)).toBe(0);
  expect(await page.evaluate(()=>(window as any).game.drone.state.speed)).toBe(0);
  await page.getByRole('button',{name:'Resume',exact:true}).tap();await release(page,31);await release(page,42);
  await forward(page);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(()=>(window as any).game.drone.state.speed)).toBe(0);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));expect(await page.evaluate(()=>(window as any).game.touch.direction)).toBe(0);
  await forward(page);await scenery(page).dispatchEvent('pointercancel',{pointerId:31,pointerType:'touch'});
  expect(await page.evaluate(()=>(window as any).game.touch.direction)).toBe(0);
  await forward(page);await page.setViewportSize({width:844,height:390});
  await expect.poll(()=>page.evaluate(()=>(window as any).game.touch.direction)).toBe(0);
  await page.setViewportSize({width:390,height:844});
  await menu(page).tap();await page.getByRole('button',{name:'Map',exact:true}).tap();await expect(page.locator('#tmap')).toBeVisible();
  const cv=page.locator('#tmap canvas'),before=await page.evaluate(()=>(window as any).game.trailMap.scale);
  for(const [id,x] of [[51,140],[52,240]])await cv.dispatchEvent('pointerdown',{pointerId:id,pointerType:'touch',button:0,clientX:x,clientY:350});
  await cv.dispatchEvent('pointermove',{pointerId:51,pointerType:'touch',clientX:90,clientY:350});
  await cv.dispatchEvent('pointermove',{pointerId:52,pointerType:'touch',clientX:290,clientY:350});
  for(const id of [51,52])await cv.dispatchEvent('pointerup',{pointerId:id,pointerType:'touch',clientX:id===51?90:290,clientY:350});
  expect(await page.evaluate(()=>(window as any).game.trailMap.scale)).toBeGreaterThan(before*1.5);
  await page.locator('#tmap .close').first().tap();
  await page.evaluate(()=>(window as any).game.teleportToRun('Midway'));
  expect(await page.evaluate(()=>{const g=(window as any).game;return [g.drone.active,g.player.model.root.visible,g.onFoot.active];})).toEqual([true,false,false]);
  await menu(page).tap();await page.locator('#pause-recall').tap();
  expect(await page.evaluate(()=>(window as any).game.drone.active)).toBe(true);
});

test('phone and desktop share aircraft, map travel, chat and reconnection',async({browser},info)=>{
  const server=process.env.E2E_DRONE_SERVER ?? 'ws://localhost:8787';
  const room=`P${Math.random().toString(36).slice(2,8)}`.toUpperCase();
  const mobile=await browser.newContext(phone),desktop=await browser.newContext({viewport:{width:1100,height:720}});
  const a=await mobile.newPage(),b=await desktop.newPage();const errors:string[]=[];
  for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
  const base=process.env.E2E_BASE_URL ?? 'http://localhost:5173';
  try {
    for(const [p,name] of [[a,'PhonePilot'],[b,'DesktopFriend']] as const){
      await p.goto(`${base}/?autostart=1&ambient=0&webgl=1&quality=low&room=${room}&name=${name}&server=${encodeURIComponent(server)}`);
      await p.waitForFunction(()=>(window as any).game?.ready && (window as any).game.net?.connected,null,{timeout:120_000});
    }
    await expect.poll(()=>b.evaluate(()=>{const r=[...(window as any).game.net.remotes.values()][0] as any;return !!r?.flight && r.droneOnly && !r.model.root.visible;})).toBe(true);
    await b.evaluate(()=>(window as any).game.toggleDrone());
    await expect.poll(()=>a.evaluate(()=>[...(window as any).game.net.remotes.values()].some((r:any)=>!!r.flight))).toBe(true);
    await a.bringToFront();await forward(a);await expect.poll(()=>a.evaluate(()=>(window as any).game.drone.state.speed),{timeout:15000}).toBeGreaterThan(.5);await menu(a).tap();await a.getByRole('button',{name:'Chat',exact:true}).tap();await a.locator('#chatin').fill('Flying from iPhone');
    await a.getByRole('button',{name:'Send',exact:true}).tap();await expect(b.locator('#chatlog')).toContainText('Flying from iPhone');
    await a.evaluate(()=>(window as any).game.teleportToRun('Midway'));
    await expect.poll(async()=>{
      const own=await a.evaluate(()=>({...((window as any).game.drone.state.pos)}));
      return b.evaluate(pos=>{const r=[...(window as any).game.net.remotes.values()][0] as any;return Math.hypot(r.flightPos.x-pos.x,r.flightPos.z-pos.z);},own);
    },{timeout:15000}).toBeLessThan(1);
    const map=await b.evaluate(()=>{const g=(window as any).game,r=[...g.net.remotes.values()][0] as any,m=g.net.mapPlayers()[0];return Math.hypot(m.x-r.flightPos.x,m.z-r.flightPos.z);});expect(map).toBeLessThan(.01);
    await a.evaluate(()=>(window as any).game.joinFriend('DesktopFriend'));expect(await a.evaluate(()=>(window as any).game.drone.active)).toBe(true);
    const oldId=await a.evaluate(()=>(window as any).game.net.id);
    await a.evaluate(()=>(window as any).game.net.ws.close());
    await expect.poll(()=>a.evaluate(old=>(window as any).game.net.connected && (window as any).game.net.id!==old,oldId),{timeout:15000}).toBe(true);
    await expect.poll(()=>b.evaluate(()=>[...(window as any).game.net.remotes.values()].filter((r:any)=>r.name==='PhonePilot' && r.flight && !r.model.root.visible).length)).toBe(1);
    await a.screenshot({path:info.outputPath('phone-multiplayer.png')});
    await a.close();await expect.poll(()=>b.evaluate(()=>(window as any).game.net.remotes.size)).toBe(0);
    expect(errors).toEqual([]);
  } finally {await mobile.close();await desktop.close();}
});

test('two phones create and join a clean invite through the normal menu',async({browser},info)=>{
  const contexts=[await browser.newContext(phone),await browser.newContext(phone)], a=await contexts[0].newPage(),b=await contexts[1].newPage();
  const base=process.env.E2E_BASE_URL ?? 'http://localhost:5173',server=process.env.E2E_DRONE_SERVER ?? 'ws://localhost:8787';
  try {
    await a.addInitScript(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async(data:any)=>{(window as any).sharedInvite=data.url;}}));
    await a.goto(`${base}/?ambient=0&name=NotTheGuest&fly=1&server=${encodeURIComponent(server)}`);
    await expect(a.getByRole('button',{name:'Create room'})).toBeVisible({timeout:120_000});
    await a.locator('#m-name').fill('First pilot');await a.getByRole('button',{name:'Create room'}).tap();
    await expect.poll(()=>a.evaluate(()=>(window as any).game.net?.connected),{timeout:15000}).toBe(true);
    await menu(a).tap();await a.getByRole('button',{name:'Share invite'}).tap();
    const invite=await a.evaluate(()=>(window as any).sharedInvite as string),url=new URL(invite);
    expect([...url.searchParams.keys()].sort()).toEqual(['room','server']);
    await b.goto(invite);await expect(b.locator('#m-join')).toBeVisible({timeout:120_000});
    await b.locator('#m-name').fill('Second pilot');await b.locator('#m-join').tap();
    await expect.poll(()=>b.evaluate(()=>(window as any).game.net?.connected),{timeout:15000}).toBe(true);
    for(const page of [a,b])await expect.poll(()=>page.evaluate(()=>{const g=(window as any).game;return g.drone.active && [...g.net.remotes.values()].some((r:any)=>r.droneOnly && r.flight);})).toBe(true);
    await b.screenshot({path:info.outputPath('phone-invite-room.png')});
  } finally {for(const c of contexts)await c.close();}
});
