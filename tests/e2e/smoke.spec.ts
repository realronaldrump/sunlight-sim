// Cross-browser smoke test (Chromium and WebKit/Safari): the game loads, renders and runs without errors.
import { test, expect } from '@playwright/test';

test('loads and renders Sunlight', async ({ page, browserName }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/?autostart=1&name=Smoke');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 180_000 });
  await page.evaluate(() => (window as any).game.waitIdle(30000));
  const info = await page.evaluate(() => {
    const g = (window as any).game;
    return { backend: g.renderer.backend.constructor.name, chunks: g.terrain.visibleCount, trees: g.trees.loaded, runs: g.resort.runs.length };
  });
  expect(info.chunks).toBeGreaterThan(50);
  expect(info.trees).toBeGreaterThan(100000);
  expect(info.runs).toBeGreaterThan(70);
  await page.screenshot({ path: `screenshots/smoke_${browserName}.png` });
  expect(errors).toEqual([]);
});

test('starts beside the lodge racks and returns there from the slopes', async ({ page }) => {
  await page.goto('/?quality=low&mute=1');
  await page.getByRole('button', { name: 'Ski solo' }).click({ timeout: 120_000 });
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });

  const skier = () => page.evaluate(() => {
    const game = (window as any).game;
    const { pos, heading, mode } = game.player.st;
    return { ...pos, heading, mode, onFoot: game.onFoot.active };
  });
  const start = await skier();
  const base = await page.evaluate(({ x, y, z }) => {
    const game = (window as any).game;
    const racks = game.walkablePois().filter((p: any) => p.tag === 'ski-rack');
    const loads = game.lifts.paths.filter((p: any) => p.def.name !== 'Primo').map((p: any) => p.loadPoint());
    return {
      rackDistance: Math.min(...racks.map((p: any) => Math.hypot(p.x - x, p.z - z))),
      aboveBaseLifts: loads.every((p: any) => y > game.player.terrainHeight(p.x, p.z) + 3),
      atLift: game.lifts.paths.some((p: any) => p.inBoardingApproach(x, z)),
    };
  }, start);
  expect(start.onFoot).toBe(false);
  expect(base.rackDistance).toBeLessThan(8);
  expect(base.aboveBaseLifts).toBe(true);
  expect(base.atLift).toBe(false);

  await page.keyboard.down('KeyW');
  try {
    await expect.poll(async () => (await skier()).x, { timeout: 25_000 }).toBeLessThan(start.x - 5);
  } finally {
    await page.keyboard.up('KeyW');
  }
  const moving = await skier();
  expect(moving.y).toBeLessThan(start.y);
  expect(moving.mode).toBe('skiing');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Teleport to base' }).click();
  await expect.poll(skier).toMatchObject(start);
});
