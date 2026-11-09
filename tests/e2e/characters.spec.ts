import { test, expect } from '@playwright/test';

test('anatomical skiers and reference-based base buildings', async ({ page }) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?autostart=1&name=VisualReview&ambient=0');
  await page.waitForFunction(()=>(window as any).game?.ready,null,{timeout:120000});
  const data=await page.evaluate(()=>{
    const g=(window as any).game;
    return {bones:g.player.model.human.mesh.skeleton.bones.length,
      lodge:g.resort.buildings.find((b:any)=>b.style==='sunlight_lodge'),
      condos:g.resort.buildings.find((b:any)=>b.style==='brettelberg')};
  });
  expect(data.bones).toBe(53);expect(data.lodge.roofElevation).toBeCloseTo(2493.065,1);
  expect(data.condos.name).toBe('Brettelberg Condominiums');
  await page.evaluate(async()=>{
    const g=(window as any).game;document.getElementById('help')?.classList.add('hidden');
    await g.teleportToRun('Midway');await g.waitIdle(30000);g.flyMode=true;
    const p={...g.player.st.pos};
    const pose={speed:5,edge:0,plow:0,tuck:0,skid:0,fallen:0,sitting:0,time:2,pushing:false};
    (window as any).reviewPose=pose;
    g.onFrame.push(()=>{
      g.player.model.root.position.set(p.x,p.y,p.z);g.player.model.root.rotation.set(0,0,0);
      g.player.model.update((window as any).reviewPose);
      g.camera.position.set(p.x+2.4,p.y+1.5,p.z-4);g.camera.lookAt(p.x,p.y+.8,p.z);
    });
  });
  for(const [name,changes] of [['standing',{}],['wedge',{plow:1}],['tuck',{tuck:1}],['seated',{sitting:1}]] as const){
    await page.evaluate(c=>{const p=(window as any).reviewPose;Object.assign(p,{plow:0,tuck:0,sitting:0},c);},changes);
    await page.waitForTimeout(350);await page.screenshot({path:`screenshots/character_${name}.png`});
  }
  await page.evaluate(()=>{(window as any).game.onFrame.length=0;});
  for(const [name,cam,target] of [
    ['lodge',[72,-980,5],[112,-960,5]],['condos',[116,-916,4],[175,-863,8]],
  ] as const){
    await page.evaluate(async({cam,target})=>{const g=(window as any).game;
      await g.hf.ensureArea(0,cam[0],-cam[1],150);
      await g.lookAt(cam[0],cam[1],target[0],g.hf.heightAt(target[0],target[1])+target[2],target[1],cam[2]);
      await g.waitIdle(30000);
    },{cam,target});
    await page.screenshot({path:`screenshots/building_${name}.png`});
  }
  expect(errors).toEqual([]);
});
