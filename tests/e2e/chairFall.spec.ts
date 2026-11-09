import { test, expect } from '@playwright/test';

for (const [name, keys] of [['Primo', ['KeyD', 'KeyA']], ['Segundo', ['ArrowUp', 'ArrowDown']], ['Tercero', ['ArrowRight', 'ArrowLeft']]] as const) {
  test(`${name}: rock the occupied chair, fall with momentum, recover and ski at the landing`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('/?autostart=1&ambient=0&quality=medium');
    await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
    await page.bringToFront();
    await page.evaluate(async liftName => {
      const g = (window as any).game, li = g.lifts.paths.findIndex((p: any) => p.def.name === liftName), path = g.lifts.paths[li];
      const chair = 0, now = g.lifts.now(li), u = path.sAtH(path.horiz * .38);
      g.lifts.clockOffset += (u - path.chairU(chair, now)) / path.def.speed;
      const point = path.riderPoint(chair, 0, g.lifts.now(li));
      await g.hf.ensureArea(0, point.p.x, -point.p.z, 150);
      g.player.teleport(point.p.x, point.p.z, point.heading);
      g.player.st.pos = { ...point.p };
      g.player.board(li, chair, 0);
      g.camRig.distance = 8;
      document.getElementById('help')?.classList.add('hidden');
      g.fallReview = { frames: [], release: null, landing: null, phase: 'idle' };
      g.onFrame.push((dt: number) => {
        const s = g.player.st, r = g.fallReview;
        if (r.phase === 'rocking' && !g.player.ride && !r.release) r.release = { pos: { ...s.pos }, vel: { ...s.vel }, grounded: s.grounded };
        if (r.release && s.grounded && !r.landing) r.landing = { pos: { ...s.pos }, impact: s.lastImpact };
        if (r.frames.length < 3000) r.frames.push({ dt, ride: !!g.player.ride, y: s.pos.y, grounded: s.grounded,
          angle: Math.hypot(g.player.chairSwing.roll, g.player.chairSwing.pitch), slip: g.player.chairSwing.slip });
      });
    }, name);
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => (window as any).game.fallReview.frames.length), { timeout: 20_000 }).toBeGreaterThan(10);
    await page.waitForTimeout(1400);
    expect(await page.evaluate(() => (window as any).game.player.chairSwing.roll)).toBe(0);
    // One small intentional shift remains safe and returns when released.
    await page.keyboard.down(keys[0]); await page.waitForTimeout(400); await page.keyboard.up(keys[0]);
    expect(await page.evaluate(() => !!(window as any).game.player.ride)).toBe(true);
    if (name === 'Tercero') {
      await page.keyboard.press('KeyC');
      await page.screenshot({ path: `screenshots/chairfall-${name}-${info.project.name}-first.png` });
      await page.keyboard.press('KeyC'); await page.keyboard.press('KeyC');
    }
    await page.waitForTimeout(1000);
    await page.evaluate(() => { (window as any).game.fallReview.phase = 'rocking'; });
    const started = Date.now();
    let previous: string | null = null, captured = false;
    while (Date.now() - started < 25_000) {
      const current = keys[Math.cos((Date.now() - started) / 1000 * 1.65) >= 0 ? 0 : 1];
      if (previous !== current) {
        if (previous) await page.keyboard.up(previous);
        await page.keyboard.down(current); previous = current;
      }
      const state = await page.evaluate(() => { const g = (window as any).game; return { ride: !!g.player.ride, angle: Math.hypot(g.player.chairSwing.roll, g.player.chairSwing.pitch) }; });
      if (!captured && state.angle > .4) { await page.screenshot({ path: `screenshots/chairfall-${name}-${info.project.name}-swing.png` }); captured = true; }
      if (!state.ride) break;
      await page.waitForTimeout(75);
    }
    if (previous) await page.keyboard.up(previous);
    const release = await page.evaluate(() => (window as any).game.fallReview.release);
    const debug = await page.evaluate(() => { const g = (window as any).game; return { swing: g.player.chairSwing, ride: g.player.ride,
      pos: g.player.st.pos, input: g.player.lastInput, frames: g.fallReview.frames.length, ready: g.ready, fly: g.flyMode }; });
    expect(release, JSON.stringify({ errors, debug })).not.toBeNull(); expect(release.grounded).toBe(false);
    const replacement = await page.evaluate(liftName => {
      const g = (window as any).game, li = g.lifts.paths.findIndex((p: any) => p.def.name === liftName), path = g.lifts.paths[li];
      const seat = path.seatPoint(0, 0, g.lifts.now(li)).p, mesh = g.lifts.riders[li].mesh, a = mesh.instanceMatrix.array;
      return Array.from({ length: mesh.count }, (_, i) => Math.hypot(a[i * 16 + 12] - seat.x, a[i * 16 + 13] - seat.y, a[i * 16 + 14] - seat.z)).some(d => d < 3);
    }, name);
    expect(replacement).toBe(false);
    expect(Math.hypot(release.vel.x, release.vel.z)).toBeGreaterThan(.5);
    await page.screenshot({ path: `screenshots/chairfall-${name}-${info.project.name}-air.png` });
    await expect.poll(() => page.evaluate(() => !!(window as any).game.fallReview.landing), { timeout: 15_000 }).toBe(true);
    const landing = await page.evaluate(() => (window as any).game.fallReview.landing);
    expect(landing.pos.y).toBeLessThan(release.pos.y - 1);
    expect(landing.impact).toBeGreaterThan(3);
    expect(Math.hypot(landing.pos.x - release.pos.x, landing.pos.z - release.pos.z)).toBeLessThan(60);
    await expect.poll(() => page.evaluate(() => (window as any).game.player.st.speed), { timeout: 20_000 }).toBeLessThan(1);
    await page.screenshot({ path: `screenshots/chairfall-${name}-${info.project.name}-land.png` });
    const before = await page.evaluate(() => ({ ...(window as any).game.player.st.pos }));
    await page.keyboard.press('KeyR');
    await expect.poll(() => page.evaluate(() => (window as any).game.player.st.mode)).not.toBe('fallen');
    await page.waitForTimeout(1800);
    const after = await page.evaluate(() => { const g = (window as any).game; return { ...g.player.st.pos, ride: g.player.ride, mode: g.player.st.mode }; });
    expect(after.ride).toBeNull(); expect(after.mode).not.toBe('gettingUp');
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(3);
    // Recovery places skis across the fall line. Use real steering to face downhill
    // before pushing, rather than expecting W to climb an arbitrary off-piste bank.
    let steering = '';
    for (let i = 0; i < 45; i++) {
      const delta = await page.evaluate(() => { const s = (window as any).game.player.st, h = Math.atan2(-s.normal.x, -s.normal.z); return Math.atan2(Math.sin(h - s.heading), Math.cos(h - s.heading)); });
      if (Math.abs(delta) < .2) break;
      const key = delta < 0 ? 'KeyD' : 'KeyA';
      if (key !== steering) { if (steering) await page.keyboard.up(steering); await page.keyboard.down(key); steering = key; }
      await page.waitForTimeout(80);
    }
    if (steering) await page.keyboard.up(steering);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(1800); await page.keyboard.up('KeyW');
    const finish = await page.evaluate(() => { const g = (window as any).game; return { ...g.player.st, frames: g.fallReview.frames }; });
    expect(finish.speed).toBeGreaterThan(.2);
    await info.attach('fall-trace', { body: JSON.stringify({ release, landing, finish }), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });
}
