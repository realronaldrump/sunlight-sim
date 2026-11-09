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
