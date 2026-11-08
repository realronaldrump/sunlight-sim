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
