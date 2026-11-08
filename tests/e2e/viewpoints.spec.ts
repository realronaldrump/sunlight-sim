// Fixed-viewpoint screenshots for visual review (spec section 8). Saved to screenshots/.
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page, query = '') {
  await page.goto('/' + query);
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  await page.evaluate(() => { document.getElementById('help')?.classList.add('hidden'); });
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => (window as any).game.waitIdle(30000));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `screenshots/${name}.png` });
}

test('viewpoints', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, '?autostart=1&name=Reviewer');
  const lifts = await page.evaluate(() => (window as any).game.resort.lifts.map((l: any) => ({ name: l.name, bottom: l.bottom, top: l.top })));
  const peaks = await page.evaluate(() => (window as any).game.resort.peaks);
  // 1. base area looking up the mountain
  const seg = lifts.find((l: any) => l.name === 'Segundo');
  await page.evaluate(([b, t]) => {
    const g = (window as any).game; const dx = t[0] - b[0], dz = t[2] - b[2], L = Math.hypot(dx, dz);
    return g.lookAt(b[0] - dx / L * 60 + 25, b[2] - dz / L * 60, b[0] + dx / L * 600, t[1] - 120, b[2] + dz / L * 600, 6);
  }, [seg.bottom, seg.top]);
  await shot(page, '01_base_area');
  // 2. top of each lift, looking down the lift line
  for (const l of lifts) {
    await page.evaluate(([b, t]) => {
      const g = (window as any).game; const dx = b[0] - t[0], dz = b[2] - t[2], L = Math.hypot(dx, dz);
      return g.lookAt(t[0] - dx / L * 10 + 6, t[2] - dz / L * 10, b[0], b[1], b[2], 3);
    }, [l.bottom, l.top]);
    await shot(page, `02_top_of_${l.name.toLowerCase()}`);
  }
  // 3. view toward Mount Sopris from the summit
  const sopris = peaks.find((p: any) => p.name === 'Mount Sopris');
  const primo = lifts.find((l: any) => l.name === 'Primo');
  await page.evaluate(([t, s]) => (window as any).game.lookAt(t[0] + 15, t[2] + 25, s.x, s.ele, s.z, 2), [primo.top, sopris]);
  await shot(page, '03_view_to_mount_sopris');
  // 4. signature runs from their tops looking down
  for (const run of ['Ute', 'Midway', 'Beaujolais', 'Sun King', 'The Heathen', 'Grizzly Road']) {
    const ok = await page.evaluate(async (name) => {
      const g = (window as any).game; const top = g.runs.runTops().get(name);
      if (!top) return false;
      const x = top.x + top.dx * 6, z = top.z + top.dz * 6;
      await g.lookAt(x - top.dx * 12, z - top.dz * 12, x + top.dx * 80, g.hf.heightAt(x + top.dx * 80, z + top.dz * 80), z + top.dz * 80, 2.5);
      return true;
    }, run);
    expect(ok).toBeTruthy();
    await shot(page, `04_run_${run.toLowerCase().replace(/[^a-z]+/g, '_')}`);
  }
  // 5. gameplay chase camera at spawn and slope overlay
  await page.evaluate(() => { const g = (window as any).game; g.flyMode = false; g.respawn(); });
  await shot(page, '05_gameplay_spawn');
  await page.keyboard.press('KeyO');
  await page.evaluate(() => (window as any).game.teleportToRun('Sun King'));
  await shot(page, '06_slope_overlay_sun_king');
  await page.keyboard.press('KeyO');
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'screenshots/07_trail_map.png' });
  expect(errors).toEqual([]);
});
