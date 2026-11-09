import { test, expect } from '@playwright/test';

test('drone launch hint disappears while its shortcut remains available',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?autostart=1&ambient=0&webgl=1');
  await page.waitForFunction(()=>(window as any).game?.ready,null,{timeout:120_000});
  const toggle=page.locator('#drone-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText('Fly a drone  G');
  await expect(toggle).toBeHidden({timeout:16_000});
  await page.screenshot({path:info.outputPath('drone-hint-hidden.png')});
  await page.keyboard.press('KeyM');
  await expect.poll(()=>page.evaluate(()=>(window as any).game.trailMap.visible)).toBe(true);
  await page.keyboard.press('KeyM');
  await expect.poll(()=>page.evaluate(()=>(window as any).game.trailMap.visible)).toBe(false);
  await expect(toggle).toBeHidden();
  await page.keyboard.press('KeyG');
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.active)).toBe(true);
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText('Return to skiing  G');
  await page.keyboard.press('KeyG');
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.active)).toBe(false);
  await expect(toggle).toBeHidden();
  await expect(page.locator('#help')).toContainText('fly a drone');
  expect(errors).toEqual([]);
});

test('launch hint waits for gameplay and remains usable during interaction',async({page})=>{
  await page.goto('/?ambient=0&webgl=1');
  const solo=page.getByRole('button',{name:'Ski solo'}),toggle=page.locator('#drone-toggle');
  await expect(solo).toBeVisible({timeout:120_000});
  await expect(toggle).toBeHidden();
  await page.waitForTimeout(9_000);
  await solo.click();
  await expect(toggle).toBeVisible();
  await toggle.focus();
  await page.waitForTimeout(9_000);
  await expect(toggle).toBeVisible();
  const box=(await toggle.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  await toggle.evaluate(el=>(el as HTMLElement).blur());
  await expect(toggle).toBeVisible();
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.active)).toBe(true);
  await page.keyboard.press('KeyG');
  await expect.poll(()=>page.evaluate(()=>(window as any).game.drone.active)).toBe(false);
  await expect(toggle).toBeHidden();
});
