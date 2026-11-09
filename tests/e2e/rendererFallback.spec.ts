import { test, expect } from '@playwright/test';

test('starts via WebGL2 if the browser GPU capability request never returns', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: { requestAdapter: () => new Promise(() => {}) } });
  });
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?autostart=1&ambient=0');
  await page.waitForFunction(()=>(window as any).game?.ready,null,{timeout:30000});
  const result=await page.evaluate(()=>{
    const g=(window as any).game;
    return {webgl:g.renderer.backend.isWebGLBackend,trees:g.trees.loaded,bones:g.player.model.human.mesh.skeleton.bones.length};
  });
  expect(result.webgl).toBe(true);expect(result.trees).toBeGreaterThan(100000);expect(result.bones).toBe(53);
  expect(errors).toEqual([]);
});
