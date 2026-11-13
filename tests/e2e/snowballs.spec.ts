import { test, expect, type Page } from '@playwright/test';

async function boot(page: Page, name: string, room?: string) {
  const server = encodeURIComponent(process.env.TEST_SERVER_URL ?? 'ws://localhost:8787');
  await page.goto(`/?autostart=1&name=${name}&quality=low&mute=1&snowmemory=0&lesson=0${room ? `&room=${room}&server=${server}` : ''}`);
  await page.waitForFunction(room => {
    const g = (window as any).game; return g?.ready && (!room || g.net?.connected && g.net.supportsSnowballs);
  }, room, { timeout: 120_000 });
  await page.evaluate(() => document.getElementById('help')?.classList.add('hidden'));
}

// Find real open, nearly level snow. Physics and collision stay live during the exchange.
async function clearing(page: Page) {
  return page.evaluate(async () => {
    const g = (window as any).game, start = g.player.st.pos;
    for (let x = start.x - 50; x < start.x + 50; x += 4) for (let z = start.z + 10; z < start.z + 75; z += 4) {
      if (g.probe.normal(x,z,{x:0,y:1,z:0}).y < .985 || g.probe.normal(x,z-10,{x:0,y:1,z:0}).y < .985) continue;
      let clear = true;
      for (let d = 0; d <= 12; d++) {
        if (g.colliders.query(x,z-d).some((c: any) => Math.hypot(c.x-x,c.z-z+d) < (c.r ?? Math.hypot(c.hx,c.hz)) + 2)) { clear=false; break; }
        if (Math.abs(g.probe.height(x,z-d)-g.probe.height(x,z)) > 1.3) { clear=false; break; }
      }
      if (clear) return {x,z};
    }
    throw new Error('No open snow clearing');
  });
}

test('Q plunks a skiing NPC, scatters equipment, and the recovered NPC throws back', async ({ page, browserName }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await boot(page, 'Snowballer');
  const p = await clearing(page);
  const id = await page.evaluate(({x,z}) => {
    const g = (window as any).game;
    g.player.teleport(x,z,0); g.camRig.reset();
    const a = g.ambient.agents[0];
    a.st.pos = { x, y: g.probe.height(x,z-10), z:z-10 }; a.st.vel = { x: 1.1, y:0, z:-1.5 }; a.st.speed = 1.9;
    a.st.mode='skiing'; a.st.grounded=true; a.bot.done=false;
    a.bot.input=()=>({steer:0,tuck:false,plow:1,push:false,stop:true});
    return `npc/${a.guest.id}`;
  },p);
  await expect.poll(() => page.evaluate(() => (window as any).game.snowballs.target()?.id)).toBe(id);
  await page.keyboard.press('KeyQ');
  await expect.poll(() => page.evaluate(() => (window as any).game.snowballs.lastHit?.target)).toBe(id);
  expect(await page.evaluate(id => (window as any).game.snowballs.gear.get(id)?.sale.group.children.length,id)).toBe(4);
  await page.waitForTimeout(450);
  await page.screenshot({path:`screenshots/snowballs/${browserName}-npc-tumble.png`});
  await expect.poll(() => page.evaluate(id => (window as any).game.ambient.agents.find((a:any)=>`npc/${a.guest.id}`===id)?.st.mode,id),{timeout:12000}).toMatch(/standing|skiing/);
  await expect.poll(() => page.evaluate(() => (window as any).game.snowballs.lastHit?.target),{timeout:16000}).toBe('you');
  expect(await page.evaluate(() => (window as any).game.player.st.mode)).toBe('fallen');
  await page.screenshot({path:`screenshots/snowballs/${browserName}-return-yard-sale.png`});
  await expect.poll(() => page.evaluate(() => (window as any).game.player.st.speed),{timeout:15000}).toBeLessThan(1);
  await page.keyboard.press('KeyR');
  await expect.poll(() => page.evaluate(() => (window as any).game.player.st.mode),{timeout:6000}).not.toBe('fallen');
  // Q in chat, maps and the pause menu must never throw into the world.
  await page.keyboard.press('Escape');
  const throws = await page.evaluate(() => (window as any).game.snowballs.sequence);
  await page.keyboard.press('KeyQ');
  expect(await page.evaluate(() => (window as any).game.snowballs.sequence)).toBe(throws);
  expect(errors).toEqual([]);
});

test('two friends share the throw, player knockdown, yard sale and recovery', async ({ browser, browserName }) => {
  const room = 'SB'+Math.random().toString(36).slice(2,6).toUpperCase();
  const a = await (await browser.newContext({viewport:{width:1280,height:800}})).newPage();
  const b = await (await browser.newContext({viewport:{width:1280,height:800}})).newPage();
  const errors:string[]=[]; for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
  try {
    await boot(a,'Ann',room); await boot(b,'Ben',room);
    await expect.poll(()=>a.evaluate(()=>(window as any).game.net.remotes.size)).toBe(1);
    const p=await clearing(a);
    await a.evaluate(({x,z})=>{const g=(window as any).game;g.player.teleport(x,z,0);g.net.markTeleport();g.camRig.reset();},p);
    await b.evaluate(({x,z})=>{const g=(window as any).game;g.player.teleport(x,z-11,Math.PI);g.net.markTeleport();g.camRig.reset();},p);
    const bid=await b.evaluate(()=>(window as any).game.net.id);
    await expect.poll(()=>a.evaluate(()=>(window as any).game.snowballs.target()?.id)).toBe(bid);
    await a.keyboard.press('KeyQ');
    await expect.poll(()=>b.evaluate(()=>(window as any).game.player.st.mode),{timeout:6000}).toBe('fallen');
    await expect.poll(()=>a.evaluate(()=>(window as any).game.snowballs.lastHit?.target)).toBe(bid);
    const hits=await Promise.all([a,b].map(p=>p.evaluate(()=>(window as any).game.snowballs.lastHit)));
    expect(hits[0]).toEqual(hits[1]);
    for(const page of [a,b]) expect(await page.evaluate(id=>(window as any).game.snowballs.gear.get(id)?.sale.group.children.length,bid)).toBe(4);
    await a.waitForTimeout(500);
    await a.screenshot({path:`screenshots/snowballs/${browserName}-friend-tumble.png`});
    await b.screenshot({path:`screenshots/snowballs/${browserName}-hit-player.png`});
    await expect.poll(()=>b.evaluate(()=>(window as any).game.player.st.speed),{timeout:15000}).toBeLessThan(1);
    await b.keyboard.press('KeyR');
    await expect.poll(()=>b.evaluate(()=>(window as any).game.player.st.mode),{timeout:6000}).toMatch(/standing|skiing/);
    await expect.poll(()=>a.evaluate(id=>(window as any).game.snowballs.gear.has(id),bid)).toBe(false);
    // A real right click throws back without dragging the chase camera.
    const aid=await a.evaluate(()=>(window as any).game.net.id);
    await b.evaluate(()=>{
      const g=(window as any).game,r=[...g.net.remotes.values()][0] as any,s=g.player.st;
      s.heading=Math.atan2(-(r.model.root.position.x-s.pos.x),-(r.model.root.position.z-s.pos.z));g.camRig.reset();
    });
    await expect.poll(()=>b.evaluate(()=>(window as any).game.snowballs.target()?.id)).toBe(aid);
    await b.locator('#viewport canvas').count().then(async count=>{
      if(count)await b.locator('#viewport canvas').first().click({button:'right',position:{x:700,y:500}});
      else await b.locator('canvas').first().click({button:'right',position:{x:700,y:500}});
    });
    await expect.poll(()=>a.evaluate(()=>(window as any).game.player.st.mode),{timeout:6000}).toBe('fallen');
    expect(errors).toEqual([]);
  } finally { await a.context().close(); await b.context().close(); }
});

test('room NPCs have matching identities and the same knockdown for both visitors',async({browser,browserName},testInfo)=>{
  const room='SN'+Math.random().toString(36).slice(2,6).toUpperCase();
  const a=await(await browser.newContext()).newPage(), b=await(await browser.newContext()).newPage();
  let completed = false;
  try {
    await boot(a,'Ann',room); await boot(b,'Ben',room);
    for (const page of [a,b]) await page.evaluate(()=>{
      const g=(window as any).game, receive=g.net.onSnowballs;
      g.snowballTestEvents=[];g.net.onSnowballs=(events:any[])=>{g.snowballTestEvents.push(...events);receive(events);};
    });
    await expect.poll(()=>a.evaluate(()=>(window as any).game.ambient.skiers().length)).toBeGreaterThan(0);
    const shot=await a.evaluate(async()=>{
      const g=(window as any).game;
      const targets=g.ambient.snowballActors().filter((a:any)=>a.active&&Math.hypot(a.vel.x,a.vel.z)<5)
        .sort((a:any,b:any)=>Math.hypot(a.pos.x-g.player.st.pos.x,a.pos.z-g.player.st.pos.z)-Math.hypot(b.pos.x-g.player.st.pos.x,b.pos.z-g.player.st.pos.z));
      for(const target of targets) {
        await g.hf.ensureArea(0,target.pos.x,-target.pos.z,60);
        for(let i=0;i<16;i++) {
          const angle=i*Math.PI/8,x=target.pos.x+Math.cos(angle)*6,z=target.pos.z+Math.sin(angle)*6;
          const y=g.probe.height(x,z);
          if(g.probe.normal(x,z,{x:0,y:1,z:0}).y<.96||Math.abs(y-target.pos.y)>1.4)continue;
          let clear=true;
          // Check the full moving-target corridor, including the lead beyond its current position.
          for(let k=0;k<=20;k++) {
            const t=k/20,px=x+(target.pos.x+target.vel.x*.5-x)*t,pz=z+(target.pos.z+target.vel.z*.5-z)*t;
            if(g.colliders.query(px,pz).some((c:any)=>Math.hypot(c.x-px,c.z-pz)<(c.r??Math.hypot(c.hx,c.hz))+1.2)||Math.abs(g.probe.height(px,pz)-y)>1.6){clear=false;break;}
          }
          if(!clear)continue;
          const heading=Math.atan2(-(target.pos.x-x),-(target.pos.z-z));
          g.player.teleport(x,z,heading);g.net.markTeleport();g.camRig.reset();
          return {id:target.id,x,z,player:g.net.id};
        }
      }
      throw new Error('No moving NPC with a clear, gentle shooting lane');
    });
    const id=shot.id;
    await a.bringToFront();await a.keyboard.down('KeyS');
    await expect.poll(()=>b.evaluate(id=>(window as any).game.ambient.snowballActors().some((a:any)=>a.id===id),id)).toBe(true);
    // Do not throw until the authority has accepted the teleport and the observer has rendered it.
    await expect.poll(()=>b.evaluate(shot=>{
      const p=(window as any).game.net.remotes.get(shot.player)?.model.root.position;
      return p?Math.hypot(p.x-shot.x,p.z-shot.z):Infinity;
    },shot),{timeout:10000}).toBeLessThan(1);
    await expect.poll(()=>a.evaluate(()=>(window as any).game.snowballs.target()?.id),{timeout:10000}).toBe(id);
    await a.evaluate(id=>{const g=(window as any).game;g.snowballTestBefore=structuredClone({hidden:document.hidden,enabled:g.input.enabled,mode:g.player.st.mode,grounded:g.player.st.grounded,sequence:g.snowballs.sequence,actors:g.snowballs.actors().filter((a:any)=>a.id===id||a.id===g.net.id)});},id);
    await a.keyboard.press('KeyQ');
    for(const page of [a,b])await expect.poll(()=>page.evaluate(id=>(window as any).game.snowballTestEvents.some((e:any)=>e.type==='hit'&&e.target===id),id),{timeout:6000}).toBe(true);
    for(const page of [a,b])expect(await page.evaluate(id=>(window as any).game.ambient.snowballFalls().some((a:any)=>a.id===id),id)).toBe(true);
    await a.screenshot({path:`screenshots/snowballs/${browserName}-room-npc.png`});
    completed = true;
  }finally{
    if(!completed) {
      const diagnostic = await a.evaluate(()=>{
        const g=(window as any).game;return {before:g.snowballTestBefore,events:g.snowballTestEvents,actors:g.snowballs.actors()};
      });
      await testInfo.attach('snowball-telemetry',{body:JSON.stringify(diagnostic),contentType:'application/json'});
    }
    await a.context().close();await b.context().close();
  }
});
