import { test, expect, type Page } from '@playwright/test';

async function ready(page: Page, extra = '') {
  await page.goto(`/?autostart=1&ambient=0&mute=1&autounload=1${extra}`);
  await page.waitForFunction(() => (window as any).game?.ready, null, {timeout:120000});
}
async function board(page: Page, li = 1) {
  await page.evaluate(async li => {
    const g=(window as any).game,p=g.lifts.paths[li];
    // Warm the destination before placing the test skier there. Actual lift approaches
    // stream this terrain while skiing; an instant test relocation must do that explicitly.
    const load=p.loadPoint();
    await g.setView(load.x, -8, load.z+10, 0, -15);
    await g.waitIdle();
    g.flyMode=false;g.camRig.reset();
    const t=g.lifts.now(li),chair=p.nextChairAt(p.loadU,t);
    g.lifts.clockOffset+=chair.arrive-t;
    const lp=p.loadPoint(),off=p.seatOffset(0);
    g.player.teleport(lp.x+p.rx*off,lp.z+p.rz*off,lp.heading);g.player.board(li,chair.index,0);
  }, li);
  await expect(page.locator('#lift-ride-controls')).toBeVisible({timeout:30000});
  await expect.poll(() => page.evaluate(() => (window as any).game.player.sitBlend), {timeout:30000}).toBeGreaterThan(.99);
}

test('B and the normal map cannot teleport; pause menu travel is explicit', async ({page}, info) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await ready(page, '&webgl=1');
  await page.evaluate(() => (window as any).game.teleportToRun('Midway'));
  const before=await page.evaluate(() => ({...(window as any).game.player.st.pos}));
  await page.keyboard.press('KeyB');
  await page.keyboard.press('KeyF');
  const after=await page.evaluate(() => ({...(window as any).game.player.st.pos}));
  expect(Math.hypot(after.x-before.x,after.z-before.z)).toBeLessThan(2);
  await page.keyboard.press('KeyM');
  await expect(page.locator('#tmap')).toBeVisible();
  const spot=await page.evaluate(() => {
    const g=(window as any).game, p=g.resort.runs.find((r:any)=>r.name==='Sun King').points[2];
    return g.trailMap.toScreen(p[0],p[2]);
  });
  const mapBefore=await page.evaluate(() => ({...(window as any).game.player.st.pos}));
  await page.locator('#tmap canvas').click({position:{x:spot[0],y:spot[1]}});
  expect(await page.evaluate(() => ({...(window as any).game.player.st.pos}))).toEqual(mapBefore);
  await expect(page.locator('#tmap')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tmap')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#opts')).toBeVisible();
  await page.screenshot({path:info.outputPath('pause-menu.png')});
  await page.locator('#pause-travel').click();
  await expect(page.locator('#tmap .map-instructions')).toContainText('teleport there');
  await page.locator('#tmap canvas').click({position:{x:spot[0],y:spot[1]}});
  await expect(page.locator('#opts')).toBeHidden();
  expect(await page.evaluate(p=>{const s=(window as any).game.player.st.pos;return Math.hypot(s.x-p.x,s.z-p.z);},before)).toBeGreaterThan(50);
  await page.keyboard.press('Escape');await page.locator('#pause-base').click();
  expect(await page.evaluate(()=>{const g=(window as any).game,s=g.player.st.pos;return Math.min(...g.walkablePois().filter((p:any)=>p.tag==='ski-rack').map((p:any)=>Math.hypot(s.x-p.x,s.z-p.z))); })).toBeLessThan(8);
  // Start opens pause; it must not retain the former back-to-base behavior.
  await page.evaluate(()=> {
    const pad={connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},(_,i)=>({pressed:i===9,value:i===9?1:0}))};
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[pad]});
  });
  await expect(page.locator('#opts')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const backend of ['default','webgl']) test(`lift speed affects only its cable and player marker follows the ride (${backend})`, async ({page}, info) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await ready(page, backend==='webgl'?'&webgl=1':''); await board(page);
  await page.keyboard.press('KeyG');await expect(page.locator('#drone-panel')).toBeVisible();
  await expect(page.locator('#player-marker')).toBeHidden();
  await page.locator('#drone-marker').click({delay:120});
  await expect(page.locator('#player-marker')).toBeVisible();
  await expect(page.locator('#player-marker')).toContainText('Your skier · Primo');
  await page.locator('#lift-speed-8').click();
  await expect(page.locator('#lift-speed-8')).toHaveAttribute('aria-pressed','true');
  const start=await page.evaluate(()=>{const g=(window as any).game;return {wall:Date.now()/1000,times:g.lifts.paths.map((_:any,i:number)=>g.lifts.now(i)),hour:g.env.hour,drone:{...g.drone.state.pos},body:g.player.time};});
  await page.waitForTimeout(1800);
  const end=await page.evaluate(()=>{const g=(window as any).game,r=g.player.ride;return {wall:Date.now()/1000,times:g.lifts.paths.map((_:any,i:number)=>g.lifts.now(i)),hour:g.env.hour,drone:{...g.drone.state.pos},body:g.player.time,seat:g.lifts.paths[r.lift].riderPoint(r.chair,r.seat,g.lifts.now(r.lift)).p,player:{...g.player.st.pos}};});
  const elapsed=end.wall-start.wall;
  expect((end.times[1]-start.times[1])/elapsed).toBeCloseTo(8,1);
  for(const i of [0,2])expect((end.times[i]-start.times[i])/elapsed).toBeCloseTo(1,1);
  expect(end.hour).toBe(start.hour); expect(end.drone).toEqual(start.drone);
  expect(end.body-start.body).toBeLessThan(elapsed*1.15);
  const alignment=await page.evaluate(()=>new Promise<number>(resolve=>{const g=(window as any).game;const sample=()=>{g.onFrame.splice(g.onFrame.indexOf(sample),1);const r=g.player.ride,p=g.lifts.paths[r.lift].riderPoint(r.chair,r.seat,g.lifts.now(r.lift)).p,s=g.player.st.pos;resolve(Math.hypot(s.x-p.x,s.y-p.y,s.z-p.z));};g.onFrame.push(sample);}));
  expect(alignment).toBeLessThan(.01);
  // Every visible choice changes the actual cable speed, including lowering it.
  await expect(page.locator('#lift-speed-options button')).toHaveCount(5);
  for(const speed of [16,4,2,1]) {
    await page.locator(`#lift-speed-${speed}`).click();
    await expect.poll(()=>page.evaluate(()=>(window as any).game.lifts.clocks[1].rate)).toBe(speed);
    await expect(page.locator(`#lift-speed-${speed}`)).toHaveAttribute('aria-pressed','true');
  }
  for(const speed of [2,4,8,16,1]) {
    await page.keyboard.press('KeyF');
    await expect(page.locator(`#lift-speed-${speed}`)).toHaveAttribute('aria-pressed','true');
  }
  await page.locator('#lift-speed-8').click();
  await page.screenshot({path:info.outputPath('drone-lift-marker.png')});
  await page.keyboard.press('Escape');
  await expect.poll(()=>page.evaluate(()=>(window as any).game.lifts.clocks[1].rate)).toBe(1);
  await expect(page.locator('#player-marker')).toBeHidden();
  await page.locator('#pause-resume').click();
  await page.locator('#drone-marker').click();await expect(page.locator('#player-marker')).toBeHidden();
  await page.locator('#drone-marker').click();
  await page.evaluate(()=>{const g=(window as any).game,s=g.drone.state,p=g.player.st.pos; s.pos={x:p.x,y:p.y+30,z:p.z+35};s.yaw=0;s.pitch=-.55;g.drone.fpv=true;});
  await expect(page.locator('#player-marker')).not.toHaveClass('edge');
  await page.screenshot({path:info.outputPath('drone-skier-onscreen.png')});
  await page.evaluate(()=>{const g=(window as any).game;g.drone.state.yaw=Math.PI;});
  await expect(page.locator('#player-marker')).toHaveClass('edge');
  await page.screenshot({path:info.outputPath('drone-skier-offscreen.png')});
  // Near the top, accelerate the actual cable through its unload line.
  await page.evaluate(()=>{const g=(window as any).game,r=g.player.ride;g.lifts.clockOffset+=r.unloadAt-g.lifts.now(r.lift)-12;});
  await page.locator('#lift-speed-16').click();
  // a sped-up lift slows back to normal nine lift seconds before the ramp
  await expect.poll(()=>page.evaluate(()=>(window as any).game.player.ride),{timeout:16000}).toBeNull();
  await expect(page.locator('#lift-ride-controls')).toBeHidden();
  expect(await page.evaluate(()=>(window as any).game.lifts.clocks[1].rate)).toBe(1);
  await page.keyboard.press('KeyG');await expect(page.locator('#player-marker')).toBeHidden();
  expect(errors).toEqual([]);
});
