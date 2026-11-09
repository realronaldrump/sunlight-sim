import { test, expect } from '@playwright/test';

test('on foot: walk in ski boots, enter the lodge, and click into skis only on open snow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/?autostart=1&name=Walker&mute=1&ambient=0&onfoot=1');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  const state = () => page.evaluate(() => { const g = (window as any).game, w = g.onFoot.st; return { active: g.onFoot.active, x: w.pos.x, y: w.pos.y, z: w.pos.z, speed: w.speed, indoor: w.indoor, onSnow: w.onSnow, skierVisible: g.player.model.root.visible }; });
  const start = await state();
  expect(start.active).toBe(true);
  expect(start.skierVisible).toBe(false);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2500);
  const moving = await state();
  expect(moving.speed).toBeGreaterThan(0.9);
  expect(moving.speed).toBeLessThan(1.4); // a booted walking pace, not a run
  await page.keyboard.up('KeyW');
  expect(Math.hypot(moving.x - start.x, moving.z - start.z)).toBeGreaterThan(1.5);
  // through the open storefront doors from the sun deck into the dining level
  await page.evaluate(() => { const g = (window as any).game, p = g.walkablePois().find((q: any) => q.tag === 'south-door'); g.onFoot.enter(p.x, p.y, p.z, p.heading); });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(3500); await page.keyboard.up('KeyW');
  await expect.poll(async () => (await state()).indoor).toBe('Main Lodge dining level');
  const inside = await state();
  expect(inside.onSnow).toBe(false);
  // skis cannot go on indoors
  await page.keyboard.press('KeyK');
  expect((await state()).active).toBe(true);
  await page.screenshot({ path: 'screenshots/onfoot-lodge.png' });
  // outside on the snow they can
  await page.evaluate(() => { const g = (window as any).game, p = g.walkablePois().find((q: any) => q.tag === 'lower-door'); g.onFoot.enter(p.x, p.y, p.z, p.heading); });
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyK');
  await expect.poll(async () => (await state()).active).toBe(false);
  expect((await state()).skierVisible).toBe(true);
  // and step out again once stopped
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyK');
  await expect.poll(async () => (await state()).active).toBe(true);
  expect(errors).toEqual([]);
});
