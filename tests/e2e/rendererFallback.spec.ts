import { test, expect } from '@playwright/test';

test('WebGL starts even when parallel shader completion never reports ready', async ({ page }) => {
  await page.addInitScript(() => {
    const original=WebGL2RenderingContext.prototype.getProgramParameter;
    WebGL2RenderingContext.prototype.getProgramParameter=function(program,parameter) {
      // KHR_parallel_shader_compile.COMPLETION_STATUS_KHR: reproduce the second-context stall.
      return parameter===0x91b1 ? false : original.call(this,program,parameter);
    };
  });
  await page.goto('/?autostart=1&ambient=0&webgl=1');
  await page.waitForFunction(()=>(window as any).game?.ready,null,{timeout:25000});
  expect(await page.evaluate(()=>(window as any).game.renderer.info.render.drawCalls)).toBeGreaterThan(0);
});

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
