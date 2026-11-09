import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

async function ready(page:Page,query='') {
  await page.goto(`/?autostart=1&ambient=0${query}`);
  await page.waitForFunction(()=>(window as any).game?.ready,null,{timeout:120_000});
  await expect(page.locator('#drone-toggle')).toBeVisible();
}

for(const backend of ['default','webgl'])test(`drone controls, safe return and views (${backend})`,async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await ready(page,backend==='webgl'?'&webgl=1':'');
  const starting=await page.evaluate(()=>({...((window as any).game.player.st.pos)}));
  await page.locator('#drone-toggle').click({delay:120});
  await expect(page.locator('#drone-panel')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.active)).toBe(true);
  const parked=await page.evaluate(()=>({...((window as any).game.player.st.pos)}));
  expect(Math.hypot(parked.x-starting.x,parked.z-starting.z)).toBeLessThan(.1);
  await page.keyboard.down('KeyE');await page.keyboard.down('KeyW');
  await expect.poll(()=>page.evaluate(()=>{const g=(window as any).game;return g.drone.state.pos.y-g.player.st.pos.y;}),{timeout:15_000}).toBeGreaterThan(17);
  await page.keyboard.up('KeyE');await page.keyboard.up('KeyW');await page.keyboard.down('Space');
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.state.speed)).toBeLessThan(.05);
  await page.keyboard.up('Space');
  expect(await page.evaluate(()=>({...((window as any).game.player.st.pos)}))).toEqual(parked);
  expect(await page.locator('#drone-height').innerText()).toMatch(/ft$/);
  expect(await page.locator('#drone-speed').innerText()).toMatch(/mph$/);
  await page.screenshot({path:info.outputPath('drone-chase.png')});
  const yaw=await page.evaluate(()=>(window as any).game.drone.state.yaw);
  await page.mouse.move(600,450);await page.mouse.down();await page.mouse.move(760,490,{steps:8});await page.mouse.up();
  expect(Math.abs(await page.evaluate(()=>(window as any).game.drone.state.yaw)-yaw)).toBeGreaterThan(.2);
  await page.keyboard.press('KeyC');
  await expect(page.locator('#drone-view-label')).toHaveText('FPV');
  expect(await page.evaluate(()=>(window as any).game.drone.model.root.visible)).toBe(false);
  await page.screenshot({path:info.outputPath('drone-fpv.png')});
  // A modal must not allow held movement or camera input to keep flying.
  await page.keyboard.press('KeyP');await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  expect(await page.evaluate(()=>(window as any).game.drone.state.speed)).toBeLessThan(.1);
  await page.keyboard.up('KeyW');await page.keyboard.press('KeyP');
  await expect.poll(()=>page.evaluate(()=>(window as any).game.options.visible)).toBe(false);
  await page.keyboard.press('KeyM');await expect.poll(()=>page.evaluate(()=>(window as any).game.trailMap.visible)).toBe(true);
  await page.keyboard.press('KeyM');await expect.poll(()=>page.evaluate(()=>(window as any).game.trailMap.visible)).toBe(false);
  await expect(page.locator('#drone-panel')).toBeVisible();
  await page.keyboard.press('KeyN');await page.waitForTimeout(600);
  expect(await page.evaluate(()=>(window as any).game.drone.audio.master.gain.value)).toBeLessThan(.001);
  await page.keyboard.press('KeyN');await page.waitForTimeout(600);
  expect(await page.evaluate(()=>(window as any).game.drone.audio.master.gain.value)).toBeGreaterThan(.1);
  await page.keyboard.press('Escape'); await page.locator('#pause-recall').click();
  await expect.poll(()=>page.evaluate(()=>{const g=(window as any).game;return Math.hypot(g.drone.state.pos.x-g.player.st.pos.x,g.drone.state.pos.z-g.player.st.pos.z);})).toBeLessThan(.1);
  await page.setViewportSize({width:960,height:640});await page.keyboard.press('KeyC');
  await page.screenshot({path:info.outputPath('drone-compact.png')});
  await page.keyboard.press('KeyG');
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.active)).toBe(false);
  await expect(page.locator('#hud')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(()=>(window as any).game.drone.audio.master.gain.value)).toBeLessThan(.001);
  const returned=await page.evaluate(()=>({...((window as any).game.player.st.pos)}));
  expect(Math.hypot(returned.x-parked.x,returned.z-parked.z)).toBeLessThan(.5);
  // Travel from flight exits it; ski camera and controls work again.
  await page.keyboard.press('KeyG');await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.active)).toBe(true);await page.evaluate(()=>(window as any).game.teleportToRun('Midway'));
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.active)).toBe(false);
  await page.keyboard.down('KeyW');await expect.poll(()=>page.evaluate(()=>(window as any).game.player.st.speed),{timeout:15_000}).toBeGreaterThan(1);await page.keyboard.up('KeyW');
  expect(errors).toEqual([]);
});

test('drone flight limits, gamepad, focus loss and continuing lift ride',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await ready(page);
  await page.keyboard.press('KeyG');
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.active)).toBe(true);
  await page.evaluate(()=>{
    const g=(window as any).game,s=g.drone.state;
    s.pos.y=g.probe.height(s.pos.x,s.pos.z)+119.9;s.vel.y=5;
  });
  await page.keyboard.down('KeyE');await expect(page.locator('#drone-status')).toHaveText('Altitude limit reached');await page.keyboard.up('KeyE');
  expect(await page.evaluate(()=>(window as any).game.drone.state.agl)).toBeLessThanOrEqual(120.0001);
  await page.evaluate(async()=>{
    const g=(window as any).game,p=g.resort.boundary[0];
    await g.hf.ensureArea(0,p[0],-p[2],250);
    g.drone.state.pos={x:p[0],y:g.probe.height(p[0],p[2])+70,z:p[2]};
    g.drone.state.vel={x:0,y:0,z:0};g.drone.state.yaw=Math.PI;
  });
  await page.keyboard.down('KeyW');await page.keyboard.down('ShiftLeft');
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.state.warning),{timeout:20_000}).toBe('boundary');
  await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');
  expect(await page.evaluate(()=>{const d=(window as any).game.drone;return d.area.contains(d.state.pos.x,d.state.pos.z);})).toBe(true);
  await page.screenshot({path:info.outputPath('drone-boundary.png')});
  await page.keyboard.press('Escape'); await page.locator('#pause-recall').click();
  await page.evaluate(()=>{
    const pad={connected:true,axes:[0,-1,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[pad]});(window as any).dronePad=pad;
  });
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.state.speed)).toBeGreaterThan(1);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.state.speed)).toBeLessThan(.01);
  await page.evaluate(()=>{(window as any).dronePad.axes=[0,0,0,0];window.dispatchEvent(new Event('focus'));});
  await page.keyboard.press('KeyG');
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.active)).toBe(false);
  await page.evaluate(()=>{
    const g=(window as any).game,p=g.lifts.paths[0],t=g.lifts.now(),chair=p.nextChairAt(p.loadU,t);
    g.lifts.clockOffset+=chair.arrive-t;const lp=p.loadPoint();g.player.teleport(lp.x,lp.z,lp.heading);g.player.board(0,chair.index,0);
  });
  await page.keyboard.press('KeyG');
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.active)).toBe(true);
  expect(await page.evaluate(()=>!!(window as any).game.player.ride)).toBe(true);
  await page.evaluate(()=>{const g=(window as any).game;g.lifts.clockOffset+=g.lifts.paths[0].rideTime()+1;});
  await expect.poll(()=>page.evaluate(()=>(window as any).game.player.ride)).toBeNull();
  expect(await page.evaluate(()=>(window as any).game.player.st.speed)).toBe(0);
  await page.keyboard.press('KeyG');await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.active)).toBe(false);
  expect(errors).toEqual([]);
});

test('drone rotor audio changes with load and mutes on exit',async({page},info)=>{
  await ready(page,'&mute=1');
  const result=await page.evaluate(async()=>{
    const Audio=(window as any).game.drone.audio.constructor;
    const clips=[];
    for(const [name,rpm,enabled,volume,active] of [['hover',5700,true,.8,true],['climb',8200,true,.8,true],['mute',7000,false,.8,true],['zero',7000,true,0,true],['exit',7000,true,.8,false]] as const){
      const ctx=new OfflineAudioContext(2,24000*3,24000),a=new Audio();
      const state={pos:{x:0,y:2510,z:0},vel:{x:0,y:name==='climb'?5:0,z:0},speed:0,rpm:[rpm,rpm+30,rpm-20,rpm+15]};
      a.start(ctx);a.update(ctx,state,.8,true,false,0);a.update(ctx,active?state:null,volume,enabled,false,1);
      const b=await ctx.startRendering();let sum=0,peak=0,crossings=0;const x=b.getChannelData(0);
      for(let i=48000;i<x.length;i++){sum+=x[i]*x[i];peak=Math.max(peak,Math.abs(x[i]));if(x[i]>0&&x[i-1]<=0)crossings++;}
      const pcm=new Uint8Array(x.length*2),view=new DataView(pcm.buffer);for(let i=0;i<x.length;i++)view.setInt16(i*2,Math.round(Math.max(-1,Math.min(1,x[i]))*32767),true);
      let binary='';for(let i=0;i<pcm.length;i+=8192)binary+=String.fromCharCode(...pcm.subarray(i,i+8192));
      let fundamental=0,energy=0;
      if(name==='hover'||name==='climb')for(let f=150;f<=320;f++){let re=0,im=0;for(let i=48000;i<x.length;i+=2){const a=2*Math.PI*f*i/24000;re+=x[i]*Math.cos(a);im+=x[i]*Math.sin(a);}const power=re*re+im*im;if(power>energy){energy=power;fundamental=f;}}
      clips.push({name,fundamental,rms:Math.sqrt(sum/24000),peak,crossings,pcm:btoa(binary)});a.dispose();
    }return clips;
  });
  const hover=result.find(x=>x.name==='hover')!,climb=result.find(x=>x.name==='climb')!;
  expect(hover.rms).toBeGreaterThan(.005);expect(climb.rms).toBeGreaterThan(hover.rms);expect(hover.fundamental).toBeGreaterThan(185);expect(hover.fundamental).toBeLessThan(195);expect(climb.fundamental).toBeGreaterThan(268);expect(climb.fundamental).toBeLessThan(280);
  for(const c of result){expect(c.peak).toBeLessThan(.7);if(['mute','zero','exit'].includes(c.name))expect(c.rms).toBeLessThan(.00001);
    const pcm=Buffer.from(c.pcm,'base64'),h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(24000,24);h.writeUInt32LE(48000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);
    writeFileSync(info.outputPath(`drone-${c.name}.wav`),Buffer.concat([h,pcm]));
  }
  writeFileSync(info.outputPath('drone-audio.json'),JSON.stringify(result.map(({pcm,...s})=>s),null,2));
});

test('two pilots see independent drones, chat does not steer, and exiting clears remote flight',async({browser},info)=>{
  test.skip(!!process.env.E2E_BASE_URL && !process.env.E2E_DRONE_SERVER,'A local multiplayer server is required for this scenario');
  const context=await browser.newContext({viewport:{width:1100,height:720}}),a=await context.newPage(),b=await context.newPage();
  const errors:string[]=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
  const server=encodeURIComponent(process.env.E2E_DRONE_SERVER ?? 'ws://localhost:8787'),room=`DR${Math.random().toString(36).slice(2,7)}`.toUpperCase();
  try {
    for(const [p,name] of [[a,'Pilot'],[b,'Friend']] as const){
      await p.goto(`${process.env.E2E_BASE_URL ?? 'http://localhost:5173'}/?autostart=1&ambient=0&webgl=1&name=${name}&room=${room}&server=${server}`);
      await p.waitForFunction(()=>(window as any).game?.ready && (window as any).game.net?.connected,null,{timeout:120_000});
    }
    await a.bringToFront();await a.keyboard.press('KeyG');await expect.poll(()=>a.evaluate(()=>(window as any).game.drone.active)).toBe(true);
    await expect.poll(()=>b.evaluate(()=>[...(window as any).game.net.remotes.values()].some((r:any)=>r.flight && r.drone?.root.visible)),{timeout:15_000}).toBe(true);
    const position=await a.evaluate(()=>({...((window as any).game.drone.state.pos)}));
    await a.keyboard.press('KeyT');await expect.poll(()=>a.evaluate(()=>(window as any).game.chat.open)).toBe(true);
    await a.keyboard.type('wasd g e q c');await a.waitForTimeout(500);
    expect(await a.evaluate(()=>({...((window as any).game.drone.state.pos)}))).toEqual(position);
    expect(await a.evaluate(()=>(window as any).game.drone.fpv)).toBe(false);
    await a.keyboard.press('Enter');await expect.poll(()=>a.evaluate(()=>(window as any).game.chat.open)).toBe(false);
    await a.keyboard.down('KeyE');await expect.poll(()=>a.evaluate(()=>(window as any).game.drone.state.agl),{timeout:10_000}).toBeGreaterThan(12);await a.keyboard.up('KeyE');
    await expect.poll(()=>b.evaluate(()=>{const g=(window as any).game,r=[...g.net.remotes.values()][0] as any;return r.drone.root.position.y-r.model.root.position.y;}),{timeout:10_000}).toBeGreaterThan(10);
    await a.screenshot({path:info.outputPath('drone-multiplayer.png')});
    await a.keyboard.press('KeyG');await expect.poll(()=>b.evaluate(()=>[...(window as any).game.net.remotes.values()].every((r:any)=>!r.flight && !r.drone?.root.visible)),{timeout:10_000}).toBe(true);
    expect(errors).toEqual([]);
  } finally {await context.close();}
});

test('normal start menu exposes a working drone launch button',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?ambient=0');
  await expect(page.getByRole('button',{name:'Ski solo'})).toBeVisible({timeout:120_000});
  await expect(page.locator('#drone-toggle')).toBeHidden();
  await page.getByRole('button',{name:'Ski solo'}).click();
  await expect(page.locator('#drone-toggle')).toBeVisible();
  await page.locator('#drone-toggle').click({delay:120});
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.active)).toBe(true);
  await page.locator('#drone-toggle').click({delay:120});
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.active)).toBe(false);
  expect(errors).toEqual([]);
});
