import { test, expect, devices, type Page } from '@playwright/test';

const phone={viewport:{width:390,height:844},screen:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:devices['iPhone 13'].userAgent};
test.use(phone);

async function ready(page:Page,query='') {
  await page.goto(`/?autostart=1&ambient=0${query}`);
  await page.waitForFunction(()=>(window as any).game?.ready,null,{timeout:120_000});
  await expect(page.locator('#touch-flight')).toBeVisible();
}
async function tapScene(page:Page) {
  const v=page.viewportSize()!;
  await page.touchscreen.tap(v.width*.55,v.height*.46);
  await expect.poll(()=>page.evaluate(()=>!!(window as any).game.navigation.target)).toBe(true);
}
async function dragScene(page:Page) {
  const canvas=page.locator('#app canvas');
  await canvas.dispatchEvent('pointerdown',{pointerId:21,pointerType:'touch',button:0,clientX:190,clientY:330});
  for(let i=1;i<=10;i++) { await canvas.dispatchEvent('pointermove',{pointerId:21,pointerType:'touch',clientX:190+i*8,clientY:330+i*2}); await page.waitForTimeout(16); }
  await canvas.dispatchEvent('pointerup',{pointerId:21,pointerType:'touch',clientX:270,clientY:350});
}

test('iPhone menu and direct flight stay drone-only in both orientations',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?ambient=0&onfoot=1&fly=1&cam=0,3000,0&quality=ultra');
  await expect(page.getByRole('button',{name:'Fly solo'})).toBeVisible({timeout:120_000});
  await expect(page.getByRole('button',{name:'Ski solo'})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('phone-menu.png')});
  await page.getByRole('button',{name:'Fly solo'}).tap();
  await expect(page.locator('#touch-flight')).toBeVisible();
  await expect(page.locator('#drone-toggle')).toBeHidden();
  expect(await page.evaluate(()=>{const g=(window as any).game;return {drone:g.drone.active,foot:g.onFoot.active,fly:g.flyMode,quality:g.quality.name,skier:g.player.model.root.visible};})).toEqual({drone:true,foot:false,fly:false,quality:'low',skier:false});
  await tapScene(page);
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.state.speed)).toBeGreaterThan(.3);
  await expect(page.locator('#flight-marker')).toBeVisible();
  await page.screenshot({path:info.outputPath('phone-flying.png')});
  await page.locator('#touch-hold').tap();
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.state.speed)).toBeLessThan(.01);
  const parked=await page.evaluate(()=>({...((window as any).game.drone.state.pos)}));
  await page.waitForTimeout(300);expect(await page.evaluate(()=>({...((window as any).game.drone.state.pos)}))).toEqual(parked);
  const yaw=await page.evaluate(()=>(window as any).game.drone.state.yaw);
  await tapScene(page);await dragScene(page);
  await expect.poll(()=>page.evaluate(before=>Math.abs((window as any).game.drone.state.yaw-before),yaw)).toBeGreaterThan(.15);
  expect(await page.evaluate(()=>(window as any).game.navigation.target)).toBeNull();
  await page.locator('#touch-view').tap();expect(await page.evaluate(()=>(window as any).game.drone.fpv)).toBe(true);
  for(const key of ['KeyG','KeyK','KeyB','KeyF'])await page.keyboard.press(key);
  await page.evaluate(async()=>{const g=(window as any).game;g.startOnFoot();g.toggleSkis();await g.toggleDrone();g.respawn();await g.setView(0,3000,0,0,0);});
  expect(await page.evaluate(()=>{const g=(window as any).game;return [g.drone.active,g.onFoot.active,g.flyMode,!!g.player.ride,g.player.model.root.visible];})).toEqual([true,false,false,false,false]);
  await page.setViewportSize({width:844,height:390});
  await expect(page.locator('#touch-hold')).toBeVisible();
  await page.screenshot({path:info.outputPath('phone-landscape.png')});
  for(const id of ['touch-map','touch-options','touch-view','touch-home','touch-hold','touch-speed']) {
    const b=await page.locator('#'+id).boundingBox();expect(b).toBeTruthy();expect(b!.x).toBeGreaterThanOrEqual(0);expect(b!.y).toBeGreaterThanOrEqual(0);expect(b!.x+b!.width).toBeLessThanOrEqual(845);expect(b!.y+b!.height).toBeLessThanOrEqual(391);
  }
  await page.setViewportSize({width:320,height:568});await page.screenshot({path:info.outputPath('phone-small.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);
  expect(errors).toEqual([]);
});

test('touch interruptions, options and map travel hold safely without skiing',async({page},info)=>{
  await ready(page,'&webgl=1');
  await tapScene(page);await page.locator('#touch-options').tap();
  await expect(page.locator('#opts')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).game.navigation.target)).toBeNull();
  await page.getByRole('button',{name:'Resume',exact:true}).tap();
  await tapScene(page);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.state.speed)).toBeLessThan(.01);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  expect(await page.evaluate(()=>(window as any).game.navigation.target)).toBeNull();
  await tapScene(page);
  await page.locator('#app canvas').dispatchEvent('pointerdown',{pointerId:42,pointerType:'touch',button:0,clientX:180,clientY:320});
  await page.locator('#app canvas').dispatchEvent('pointercancel',{pointerId:42,pointerType:'touch'});
  expect(await page.evaluate(()=>(window as any).game.navigation.target)).toBeNull();
  await page.locator('#touch-map').tap();await expect(page.locator('#tmap')).toBeVisible();
  const cv=page.locator('#tmap canvas'),before=await page.evaluate(()=>(window as any).game.trailMap.scale);
  for(const [id,x] of [[31,140],[32,240]])await cv.dispatchEvent('pointerdown',{pointerId:id,pointerType:'touch',button:0,clientX:x,clientY:350});
  await cv.dispatchEvent('pointermove',{pointerId:31,pointerType:'touch',clientX:90,clientY:350});
  await cv.dispatchEvent('pointermove',{pointerId:32,pointerType:'touch',clientX:290,clientY:350});
  for(const id of [31,32])await cv.dispatchEvent('pointerup',{pointerId:id,pointerType:'touch',clientX:id===31?90:290,clientY:350});
  expect(await page.evaluate(()=>(window as any).game.trailMap.scale)).toBeGreaterThan(before*1.5);
  await page.screenshot({path:info.outputPath('phone-map.png')});
  await page.locator('#tmap .close').first().tap();
  await page.evaluate(()=>(window as any).game.teleportToRun('Midway'));
  expect(await page.evaluate(()=>{const g=(window as any).game;return {active:g.drone.active,skier:g.player.model.root.visible,agl:g.drone.state.agl,foot:g.onFoot.active};})).toMatchObject({active:true,skier:false,foot:false});
  await page.locator('#touch-home').tap();expect(await page.evaluate(()=>(window as any).game.drone.active)).toBe(true);
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
    await a.bringToFront();await a.locator('#touch-chat').tap();await a.locator('#chatin').fill('Flying from iPhone');
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
    await a.getByRole('button',{name:'Share invite'}).tap();
    const invite=await a.evaluate(()=>(window as any).sharedInvite as string),url=new URL(invite);
    expect([...url.searchParams.keys()].sort()).toEqual(['room','server']);
    await b.goto(invite);await expect(b.locator('#m-join')).toBeVisible({timeout:120_000});
    await b.locator('#m-name').fill('Second pilot');await b.locator('#m-join').tap();
    await expect.poll(()=>b.evaluate(()=>(window as any).game.net?.connected),{timeout:15000}).toBe(true);
    for(const page of [a,b])await expect.poll(()=>page.evaluate(()=>{const g=(window as any).game;return g.drone.active && [...g.net.remotes.values()].some((r:any)=>r.droneOnly && r.flight);})).toBe(true);
    await b.screenshot({path:info.outputPath('phone-invite-room.png')});
  } finally {for(const c of contexts)await c.close();}
});
