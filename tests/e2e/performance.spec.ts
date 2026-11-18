// Performance profiling at 2560x1440 on the High preset (spec section 2). Logs fps per scene.
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

test.use({ viewport: { width: 2560, height: 1440 } });

test('fps at 1440p on High', async ({ page }) => {
  // Replay the same lift, lesson and weather phase across revisions.
  await page.addInitScript(() => { Date.now = () => 1800000000000 + Math.floor(performance.now()); });
  await page.goto('/?autostart=1&name=Perf&quality=high');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  const readyMs = await page.evaluate(() => Math.round(performance.now()));
  await page.waitForFunction(() => (window as any).game.baseLife?.stats().built, null, { timeout: 60000 });
  const measure = async (label: string, setup: string) => {
    await page.evaluate(setup);
    await page.evaluate(() => (window as any).game.waitIdle(30000));
    const r = await page.evaluate(async () => {
      const g = (window as any).game;
      const frames: number[] = [];
      const requested = performance.now();
      let first = 0, last = 0, calls = 0, triangles = 0;
      await new Promise<void>((res) => {
        const tick = () => {
          const t = performance.now();
          if (last) { frames.push(t - last); calls += g.renderer.info.render.drawCalls; triangles += g.renderer.info.render.triangles; }
          else first = t;
          last = t;
          if (frames.length < 240) requestAnimationFrame(tick); else res();
        };
        requestAnimationFrame(tick);
      });
      frames.sort((a, b) => a - b);
      const avg = frames.reduce((a, b) => a + b, 0) / frames.length;

      return { avgMs: +avg.toFixed(2), p95Ms: +frames[Math.floor(frames.length * 0.95)].toFixed(2), fps: +(1000 / avg).toFixed(1),
        cpuMs: +g.frameMs.toFixed(2), firstFrameWaitMs: +(first - requested).toFixed(1), maxMs: +frames.at(-1)!.toFixed(1),
        drawCalls: Math.round(calls / frames.length), triangles: Math.round(triangles / frames.length), pixelRatio: g.renderer.getPixelRatio(), backend: g.renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2' };
    });
    console.log(label, JSON.stringify(r));
    return { label, ...r };
  };
  console.log('readyMs', readyMs);
  const results = [];
  results.push(await measure('spawn_base', `(window.game.flyMode=false, window.game.respawn())`));
  results.push(await measure('skiing_sun_king', `(window.game.flyMode=false, window.game.teleportToRun('Sun King'))`));
  results.push(await measure('summit_view_sopris', `(() => { const g = window.game; const t = g.resort.lifts.find(l => l.name === 'Primo').top; const s = g.resort.peaks.find(p => p.name === 'Mount Sopris'); return g.lookAt(t[0] + 15, t[2] + 25, s.x, s.ele, s.z, 2); })()`));
  results.push(await measure('forest_east_ridge', `(window.game.flyMode=false, window.game.teleportToRun('Vortex'))`));
  mkdirSync('tests/harness/out', { recursive: true });
  writeFileSync('tests/harness/out/perf.json', JSON.stringify(results, null, 1));
  for (const r of results) expect(r.fps).toBeGreaterThan(20);
});
