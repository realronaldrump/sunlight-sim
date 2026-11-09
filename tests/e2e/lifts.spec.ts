import { test, expect } from '@playwright/test';

for (const name of ['Primo', 'Segundo', 'Tercero']) test(`${name}: load, ride, naturally unload and ski clear`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/?autostart=1&ambient=0');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  await page.evaluate(liftName => {
    const g = (window as any).game, li = g.lifts.paths.findIndex((p: any) => p.def.name === liftName), path = g.lifts.paths[li];
    // Put a chair with ambient occupants three seconds from loading. Only the test changes
    // the clock; the app still performs the real boarding/unloading state transitions.
    const chair = g.lifts.riders[li].slots[0].chair, t = g.lifts.now();
    const arrival = t + ((path.loadU - path.chairU(chair, t) + path.loopLen) % path.loopLen) / path.def.speed;
    g.lifts.clockOffset += arrival - t - 3;
    const lp = path.loadPoint(), off = path.seatOffset(0);
    g.player.teleport(lp.x + path.rx * off, lp.z + path.rz * off, lp.heading);
    document.getElementById('help')?.classList.add('hidden');
    g.onFrame.push(() => {
      const p = g.player.st.pos;
      g.camera.position.set(p.x + path.rx * 5 - path.ax * 3, p.y + 2.8, p.z + path.rz * 5 - path.az * 3);
      g.camera.lookAt(p.x, p.y + 0.9, p.z);
    });
  }, name);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `screenshots/lift-${name}-loading.png` });
  await expect.poll(() => page.evaluate(() => !!(window as any).game.player.ride), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(1500);
  const seated = await page.evaluate(() => {
    const g = (window as any).game, r = g.player.ride, path = g.lifts.paths[r.lift], p = path.riderPoint(r.chair, r.seat, g.lifts.now()).p;
    return { error: Math.hypot(g.player.st.pos.x - p.x, g.player.st.pos.y - p.y, g.player.st.pos.z - p.z), seat: r.seat, duration: path.rideTime() };
  });
  expect(seated.error).toBeLessThan(0.2);
  expect(seated.seat).toBe(0);
  expect(seated.duration).toBeGreaterThan(500);
  await page.screenshot({ path: `screenshots/lift-${name}-seated.png` });
  await page.evaluate(() => {
    const g = (window as any).game, r = g.player.ride, path = g.lifts.paths[r.lift];
    g.lifts.clockOffset += (path.unloadU + path.loadU) / 2 / path.def.speed - path.chairU(r.chair, g.lifts.now()) / path.def.speed;
  });
  await page.waitForTimeout(300);
  const middle = await page.evaluate(() => {
    const g = (window as any).game, r = g.player.ride, path = g.lifts.paths[r.lift], riders = g.lifts.riders[r.lift];
    const occupied = riders.slots.map((s: any, i: number) => s.chair === r.chair ? i : -1).filter((i: number) => i >= 0);
    return { remaining: path.remainingRideTime(r.chair, g.lifts.now()), total: path.rideTime(), hidden: occupied.every((i: number) => riders.mesh.instanceMatrix.array[i * 16] === 0), count: occupied.length };
  });
  expect(middle.count).toBeGreaterThan(0);
  expect(middle.hidden).toBe(true);
  expect(Math.abs(middle.remaining - middle.total / 2)).toBeLessThan(1);
  await page.screenshot({ path: `screenshots/lift-${name}-riding.png` });
  await page.evaluate(() => {
    const g = (window as any).game;
    g.lifts.clockOffset += g.player.ride.unloadAt - g.lifts.now() - 1.5;
  });
  await expect.poll(() => page.evaluate(() => (window as any).game.player.ride), { timeout: 10_000 }).toBeNull();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `screenshots/lift-${name}-unloading.png` });
  const start = await page.evaluate(() => ({ ...(window as any).game.player.st.pos }));
  await page.waitForTimeout(1800);
  const end = await page.evaluate(() => { const g = (window as any).game, s = g.player.st; return { ...s.pos, mode: s.mode, heightError: s.pos.y - g.probe.height(s.pos.x, s.pos.z) }; });
  expect(end.mode).not.toBe('fallen');
  expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeGreaterThan(1);
  expect(Math.abs(end.heightError)).toBeLessThan(0.1);
  expect(errors).toEqual([]);
});
