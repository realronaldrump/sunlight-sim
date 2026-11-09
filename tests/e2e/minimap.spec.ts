import { test, expect } from '@playwright/test';

test('minimap follows skiing and lift rides, zooms, collapses and opens the trail map', async ({ page, browserName }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/?autostart=1&name=Navigator&mute=1&ambient=0');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  await expect(page.locator('#loading')).toHaveCSS('opacity', '0');
  const minimap = page.getByRole('region', { name: 'Skiing minimap' });
  const canvas = minimap.locator('canvas');
  await expect(minimap).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(minimap.locator('.mm-zoom')).toHaveText('3,000 ft');
  // The image is real rendered data, and gameplay continues without opening the full map.
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => new Set(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data).size)).toBeGreaterThan(30);
  await page.evaluate(() => (window as any).game.teleportToRun('Midway'));
  await page.keyboard.down('KeyW');
  await expect.poll(() => page.evaluate(() => (window as any).game.player.st.speed)).toBeGreaterThan(2);
  await page.keyboard.up('KeyW');
  await expect(canvas).toHaveAttribute('aria-label', /Midway/);
  const before = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).not.toBe(before);
  expect(await page.evaluate(() => (window as any).game.trailMap.visible)).toBe(false);
  await page.keyboard.press('KeyH');
  await page.screenshot({ path: `screenshots/minimap_skiing_${browserName}.png` });
  await minimap.getByRole('button', { name: 'Zoom minimap in' }).click();
  await expect(minimap.locator('.mm-zoom')).toHaveText('1,500 ft');
  await expect(minimap.getByRole('button', { name: 'Zoom minimap in' })).toBeDisabled();
  await minimap.getByRole('button', { name: 'Zoom minimap out' }).click();
  await minimap.getByRole('button', { name: 'Zoom minimap out' }).click();
  await expect(minimap.locator('.mm-zoom')).toHaveText('1.1 mi');
  await expect(minimap.getByRole('button', { name: 'Zoom minimap out' })).toBeDisabled();

  await minimap.getByRole('button', { name: 'Open full trail map (M)' }).click();
  await expect(page.locator('#tmap')).toHaveClass('show');
  await expect(minimap).toBeHidden();
  await page.keyboard.press('KeyM');
  await expect(canvas).toBeVisible();
  await page.keyboard.press('KeyV');
  await expect(canvas).toBeHidden();
  await expect(minimap.getByRole('button', { name: 'Show minimap (V)' })).toBeVisible();
  // Choices survive reload, and clicking the compact control restores the map.
  await page.reload();
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  await expect(page.locator('#loading')).toHaveCSS('opacity', '0');
  await expect(canvas).toBeHidden();
  await minimap.getByRole('button', { name: 'Show minimap (V)' }).click();
  await expect(canvas).toBeVisible();
  await expect(minimap.locator('.mm-zoom')).toHaveText('1.1 mi');
  await minimap.getByRole('button', { name: 'Zoom minimap in' }).click();
  await page.setViewportSize({ width: 1024, height: 640 });
  // The map and speed readout occupy separate regions on a small desktop window.
  const mapBox = (await minimap.boundingBox())!, hudBox = (await page.locator('#hud').boundingBox())!;
  expect(mapBox.y + mapBox.height).toBeLessThan(hudBox.y);
  expect(await minimap.locator('.mm-tools').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: `screenshots/minimap_compact_${browserName}.png` });
  await page.setViewportSize({ width: 800, height: 480 });
  expect(await minimap.locator('.mm-tools').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1024, height: 640 });

  await page.evaluate(() => {
    const g = (window as any).game, path = g.lifts.paths.find((p: any) => p.def.name === 'Tercero');
    const lp = path.loadPoint(); g.player.teleport(lp.x - path.ax * 1.2, lp.z - path.az * 1.2, lp.heading);
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).game.player.ride), { timeout: 30_000 }).toBe(true);
  await expect(minimap.locator('.mm-run')).toHaveText('Tercero lift');
  await page.screenshot({ path: `screenshots/minimap_lift_${browserName}.png` });
  await page.keyboard.press('KeyF');
  await expect(minimap.locator('.mm-run')).not.toHaveText('Tercero lift');
  expect(errors).toEqual([]);
});

test('minimap stays usable without the terrain image or saved settings', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sunlight.minimap', '{invalid'));
  await page.route('**/world/map.jpg', route => route.abort());
  await page.goto('/?autostart=1&mute=1&ambient=0&webgl=1');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  await expect(page.locator('#minimap canvas')).toBeVisible();
  await expect(page.locator('#minimap .mm-zoom')).toHaveText('3,000 ft');
  // Colored trail/lift pixels remain on the vector fallback.
  await expect.poll(() => page.locator('#minimap canvas').evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let colored = 0;
    for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 80) colored++;
    return colored;
  })).toBeGreaterThan(100);
});
