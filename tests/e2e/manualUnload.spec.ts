// Manual disembark: stand up with Space on the top ramp; miss it and get whirled around the bull wheel,
// flung off and left in a yard sale; the pause-menu option brings back the automatic unload.
import { expect, test, type Page } from '@playwright/test';

async function rideNearTop(page: Page, lift: string) {
  await page.evaluate((name) => {
    const g = (window as any).game, path = g.lifts.paths.find((l: any) => l.def.name === name), lp = path.loadPoint();
    g.player.teleport(lp.x - path.ax * 1.2, lp.z - path.az * 1.2, lp.heading);
  }, lift);
  await expect.poll(() => page.evaluate(() => !!(window as any).game.player.ride), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const g = (window as any).game, r = g.player.ride; g.lifts.clockOffset += r.unloadAt - g.lifts.now(r.lift) - 6; });
}

test('all three summit tables let the skier glide straight past the turning chair', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?autostart=1&mute=1&ambient=0&autounload=0');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  await page.addStyleTag({ content: 'body > :not(#app):not(#lift-ride-controls) { visibility: hidden !important; }' });
  for (const name of ['Primo', 'Segundo', 'Tercero']) {
    await rideNearTop(page, name);
    const surface = await page.evaluate(async () => {
      const g = (window as any).game, r = g.player.ride, p = g.lifts.paths[r.lift];
      const clock = g.lifts.clocks[r.lift], fixed = r.unloadAt - g.lifts.clockOffset;
      clock.now = () => fixed;
      await g.hf.ensureArea(0, p.def.top[0], -p.def.top[2], 100);
      const up = p.unloadPoint(r.seat), floor = g.probe.height(up.x, up.z);
      const side = p.uphillSide;
      g.camera.fov = 48; g.camera.updateProjectionMatrix();
      g.onFrame = [() => {
        g.camera.position.set(up.x + p.ax * 14 + side * p.rx * 4, floor + 3.1,
          up.z + p.az * 14 + side * p.rz * 4);
        const look = g.player.ride ? .5 : 3.5;
        g.camera.lookAt(up.x + p.ax * look, floor + .9, up.z + p.az * look);
      }];
      window.addEventListener('keydown', function resume(event) {
        if (event.code !== 'Space') return;
        window.removeEventListener('keydown', resume, true);
        delete clock.now;
        const wall = Date.now() / 1000;
        clock.sync({ time: fixed, at: wall, rate: 1 }, wall);
      }, true);
      const mesh = g.lifts.group.getObjectByName(p.def.name + '-unload-snow-ramp');
      return !!mesh?.geometry.getAttribute('grooming');
    });
    expect(surface).toBe(true);
    await expect(page.locator('#lift-stand')).toContainText('STAND UP');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `screenshots/unload-stations/${info.project.name}-${name}-table.jpg` });
    await page.bringToFront();
    await page.keyboard.down('Space');
    await expect.poll(() => page.evaluate(() => !!(window as any).game.player.ride)).toBe(false);
    await expect.poll(() => page.evaluate(() => (window as any).game.player.lastInput.stop)).toBe(false);
    await page.keyboard.up('Space');
    await expect.poll(() => page.evaluate(name => {
      const g = (window as any).game, p = g.lifts.paths.find((p: any) => p.def.name === name);
      const s = g.player.st, up = p.unloadPoint();
      return s.grounded && s.mode === 'skiing' ? (s.pos.x - up.x) * p.ax + (s.pos.z - up.z) * p.az : 0;
    }, name), { timeout: 15_000, intervals: [150] }).toBeGreaterThan(7);
    await page.screenshot({ path: `screenshots/unload-stations/${info.project.name}-${name}-exit.jpg` });
  }
  expect(errors).toEqual([]);
});

test('stand up on the ramp with Space, or miss it and end up in a yard sale', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?autostart=1&ambient=0&mute=1');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 180_000 });
  expect(await page.evaluate(() => (window as any).game.autoUnloadSetting)).toBe(false);

  // 1. press too early, then on the ramp
  await rideNearTop(page, 'Tercero');
  await page.keyboard.press('Space');
  await expect(page.locator('#toast')).toContainText('Too early');
  await expect.poll(() => page.evaluate(() => (window as any).game.player.unloadPhase()), { timeout: 15_000 }).toBe('ready');
  await expect(page.locator('#lift-stand')).toHaveText(/STAND UP/);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window as any).game.player.ride), { timeout: 3_000 }).toBeNull();
  const off = await page.evaluate(() => { const g = (window as any).game, st = g.player.st; return { ride: g.player.ride, mode: st.mode, gap: st.pos.y - g.player.terrainHeight(st.pos.x, st.pos.z) }; });
  expect(off.ride).toBeNull(); expect(off.mode).toBe('skiing'); expect(Math.abs(off.gap)).toBeLessThan(0.05);
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => (window as any).game.player.st.mode)).not.toBe('fallen');

  // 2. stay seated: BONK, two loops, launch, landing, yard sale
  await rideNearTop(page, 'Tercero');
  await expect.poll(() => page.evaluate(() => !!(window as any).game.player.missed), { timeout: 15_000 }).toBe(true);
  await expect(page.locator('.comic-pop', { hasText: 'BONK!' })).toBeAttached();
  await expect.poll(() => page.evaluate(() => { const p = (window as any).game.player; return !p.ride && p.flung; }), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => { const p = (window as any).game.player; return p.yardSale && !p.flung && p.st.grounded; }), { timeout: 10_000 }).toBe(true);
  await expect(page.locator('.comic-pop', { hasText: 'YARD SALE!' })).toBeAttached();
  await expect.poll(() => page.evaluate(() => (window as any).game.yardSale.active), { timeout: 15_000 }).toBe(true);
  await expect(page.locator('#hint')).toContainText('Yard sale');
  await expect.poll(async () => { await page.keyboard.press('KeyR'); return page.evaluate(() => (window as any).game.player.yardSale); }, { timeout: 15_000 }).toBe(false);
  expect(await page.evaluate(() => (window as any).game.yardSale.active)).toBe(false);

  // 3. jumping off mid-ride after the warning: a fall from the chair
  await rideNearTop(page, 'Segundo');
  await page.evaluate(() => { const g = (window as any).game, r = g.player.ride; g.lifts.clockOffset += -40; void r; });
  await page.keyboard.press('Space');
  await expect(page.locator('#toast')).toContainText('Press Space again');
  expect(await page.evaluate(() => !!(window as any).game.player.ride)).toBe(true);
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => { const p = (window as any).game.player; return !p.ride && p.gag; }), { timeout: 3_000 }).toBe('jump');
  await expect.poll(() => page.evaluate(() => { const p = (window as any).game.player; return p.st.mode === 'fallen' && p.st.grounded; }), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => { await page.keyboard.press('KeyR'); return page.evaluate(() => (window as any).game.player.yardSale); }, { timeout: 20_000 }).toBe(false);

  // 4. the pause-menu option sets you down automatically
  await page.keyboard.press('Escape');
  await page.locator('#o-unload').check();
  expect(await page.evaluate(() => localStorage.getItem('sunlight.autoUnload'))).toBe('1');
  await page.keyboard.press('Escape');
  await rideNearTop(page, 'Segundo');
  await expect.poll(() => page.evaluate(() => (window as any).game.player.ride), { timeout: 15_000 }).toBeNull();
  expect(await page.evaluate(() => (window as any).game.player.yardSale)).toBe(false);
  expect(errors).toEqual([]);
});
