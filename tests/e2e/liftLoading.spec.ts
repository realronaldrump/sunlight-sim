import { test, expect } from '@playwright/test';

for (const name of ['Primo', 'Segundo', 'Tercero']) test(`${name}: continuous physical chair pickup away from the stripe`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?autostart=1&ambient=0&mute=1');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  await page.evaluate(name => {
    const g = (window as any).game, li = g.lifts.paths.findIndex((p: any) => p.def.name === name), p = g.lifts.paths[li];
    const h = 5, t = g.lifts.now(), next = p.nextChairAt(p.sAtH(h), t);
    g.lifts.clockOffset += next.arrive - t - 1;
    const pos = p.ropePoint(h, 1), off = p.seatOffset(0);
    g.player.teleport(pos.x + p.rx * off, pos.z + p.rz * off, p.loadPoint().heading);
    document.getElementById('help')?.classList.add('hidden');
    g.loadingTrace = [];
    g.onFrame.push(() => {
      const s = g.player.st, r = g.player.ride;
      g.camera.position.set(s.pos.x + p.ax * 3 + p.rx * 4.5, s.pos.y + 2, s.pos.z + p.az * 3 + p.rz * 4.5);
      g.camera.lookAt(s.pos.x, s.pos.y + .75, s.pos.z);
      if (g.loadingTrace.length > 300) return;
      g.player.model.root.updateMatrixWorld(true);
      const ski = g.player.model.skis[0], point = ski.position.clone(); ski.getWorldPosition(point);
      g.loadingTrace.push({ time: g.lifts.now(), x: s.pos.x, y: s.pos.y, z: s.pos.z, sitting: g.player.sitBlend,
        ride: !!r, elapsed: r ? g.lifts.now() - r.boardedAt : -1, clearance: point.y - g.probe.height(point.x, point.z) });
    });
  }, name);
  await expect.poll(() => page.evaluate(() => !!(window as any).game.player.ride), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(1400);
  const trace = await page.evaluate(() => (window as any).game.loadingTrace) as { time: number; x: number; y: number; z: number; sitting: number; ride: boolean; elapsed: number; clearance: number }[];
  const pickup = trace.findIndex(p => p.ride);
  expect(pickup).toBeGreaterThan(0);
  const before = trace[pickup - 1], first = trace[pickup];
  expect(Math.hypot(first.x - before.x, first.y - before.y, first.z - before.z)).toBeLessThan(.3);
  expect(trace.some(p => p.ride && p.sitting > .1 && p.sitting < .8)).toBe(true);
  const loading = trace.filter(p => p.ride && p.elapsed < .9);
  expect(loading.length).toBeGreaterThan(4);
  expect(Math.min(...loading.map(p => p.clearance))).toBeGreaterThan(-.08);
  expect(trace.at(-1)!.sitting).toBe(1);
  await page.screenshot({ path: `screenshots/lift-${name}-physical-pickup.png` });
  expect(errors).toEqual([]);
});
