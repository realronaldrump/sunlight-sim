import { test, expect } from '@playwright/test';

// Freeze the resort, including shader wind, then let each pipeline render its own complete
// color and shadow passes. Compare pixels as well as submitted work on both backends.
for (const fallback of [false, true]) test(`camera and cascade visibility matches the full scene on ${fallback ? 'WebGL2' : 'WebGPU'}`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/?autostart=1&quality=high&mute=1' + (fallback ? '&webgl=1' : ''));
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120000 });
  for (const scene of ['base', 'Vortex', 'summit']) {
    await page.evaluate(async (scene) => {
      const g = (window as any).game;
      if (scene === 'Vortex') await g.teleportToRun(scene);
      if (scene === 'summit') {
        const t = g.resort.lifts.find((l: any) => l.name === 'Primo').top;
        const s = g.resort.peaks.find((p: any) => p.name === 'Mount Sopris');
        await g.lookAt(t[0] + 15, t[2] + 25, s.x, s.ele, s.z, 2);
        g.env.setHour(15.5);
      }
      await g.waitIdle(30000);
    }, scene);
    const result = await page.evaluate(async () => {
      const g = (window as any).game, r = g.renderer, optimized = r.drawingPipeline;
      const ordinary = new (Object.getPrototypeOf(Object.getPrototypeOf(optimized)).constructor)();
      const loop = r.getAnimationLoop();
      await r.setAnimationLoop(null);
      const canvas = document.createElement('canvas');
      canvas.width = r.domElement.width; canvas.height = r.domElement.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const time = r._nodes.nodeFrame.time;
      const capture = async (pipeline: any) => {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        r._nodes.nodeFrame.time = time;
        r.drawingPipeline = pipeline;
        r.render(g.scene, g.camera);
        ctx.drawImage(r.domElement, 0, 0);
        return { image: ctx.getImageData(0, 0, canvas.width, canvas.height).data, tris: r.info.render.triangles };
      };
      try {
        const full = await capture(ordinary), fast = await capture(optimized);
        let changed = 0, absolute = 0, range = 0;
        for (let i = 0; i < full.image.length; i += 4) {
          let max = 0;
          for (let k = 0; k < 3; k++) {
            const d = Math.abs(full.image[i + k] - fast.image[i + k]); absolute += d; max = Math.max(max, d);
          }
          if (max > 8) changed++;
          range = Math.max(range, full.image[i]);
        }
        return { changedFraction: changed / (canvas.width * canvas.height), mean: absolute / (canvas.width * canvas.height * 3),
          range, full: full.tris, fast: fast.tris, fallback: !!r.backend.isWebGLBackend };
      } finally {
        r.drawingPipeline = optimized; await r.setAnimationLoop(loop);
      }
    });
    console.log(scene, result);
    expect(result.fallback).toBe(fallback);
    expect(result.range).toBeGreaterThan(100);
    expect(result.changedFraction).toBeLessThan(.0005);
    expect(result.mean).toBeLessThan(.05);
    expect(result.fast).toBeLessThan(result.full * .90);
  }
  expect(errors).toEqual([]);
});
