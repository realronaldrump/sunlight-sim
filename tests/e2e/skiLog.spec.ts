import { expect, test } from '@playwright/test';

test('the ski log records a descent with keyboard skiing and keeps it after a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?autostart=1&quality=low&mute=1&ambient=0', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.removeItem('sunlight.skilog.v1'));
  await page.reload();
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 180_000 });

  // ski the Tercero green with the real keyboard input path
  const result = await page.evaluate(async () => {
    const g = (window as any).game;
    await g.teleportToRun('Tercero');
    await g.waitIdle(15000);
    const run = g.resort.runs.find((r: any) => r.name === 'Tercero' && r.kind === 'line');
    const pts: number[][] = [];
    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1], b = run.points[i], n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 3);
      for (let k = 0; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[2] + (b[2] - a[2]) * k / n]);
    }
    const keys: Set<string> = g.input.keys;
    let idx = 0, stuck = 0, escape = 0, side = 1, last = performance.now();
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const step = () => {
        const st = g.player.st;
        if (st.mode === 'fallen') { keys.clear(); g.player.getUp(); }
        let best = idx, bd = Infinity;
        for (let i = idx; i < Math.min(pts.length, idx + 40); i++) { const d = Math.hypot(pts[i][0] - st.pos.x, pts[i][1] - st.pos.z); if (d < bd) { bd = d; best = i; } }
        idx = best;
        if (idx >= pts.length - 2 || performance.now() - t0 > 90000) { keys.clear(); resolve(); return; }
        const now = performance.now(), dt = (now - last) / 1000; last = now;
        // like a person wedged against a tree: turn away and push off before heading back to the line
        stuck = st.speed < 0.4 && st.mode !== 'fallen' ? stuck + dt : 0;
        if (stuck > 1.2) { escape = 1.0; side = -side; stuck = 0; }
        const look = pts[Math.min(pts.length - 1, idx + 4)];
        const want = Math.atan2(-(look[0] - st.pos.x), -(look[1] - st.pos.z));
        let diff = want - st.heading; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
        for (const k of ['KeyA', 'KeyD', 'KeyS', 'KeyW']) keys.delete(k);
        if (escape > 0) { escape -= dt; keys.add(side > 0 ? 'KeyA' : 'KeyD'); keys.add('KeyW'); requestAnimationFrame(step); return; }
        if (diff > 0.08) keys.add('KeyA'); else if (diff < -0.08) keys.add('KeyD');
        if (st.speed > 9) keys.add('KeyS');
        if (st.speed < 3) keys.add('KeyW');
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    // board nothing, just stop and teleport: the descent closes
    await g.teleportToRun('Midway');
    await new Promise((r) => setTimeout(r, 500));
    const log = g.skiLog;
    return { descents: log.descents.length, d: log.descents[0], tercero: log.coverage().find((c: any) => c.trail.name === 'Tercero') };
  });
  expect(result.descents).toBe(1);
  expect(result.d.dist).toBeGreaterThan(120);
  expect(result.d.vert).toBeGreaterThan(15);
  expect(result.d.runs[0].key).toBe(result.tercero.trail.key);
  expect(result.tercero.status).toBe('completed');

  // review it from the pause menu
  await page.keyboard.press('Escape');
  await page.click('#pause-log');
  await expect(page.locator('#skilog')).toHaveClass(/show/);
  await expect(page.locator('#skilog')).toContainText('1 of');
  await page.click('#skilog .tabs button[data-tab="history"]');
  await page.click('#skilog tbody tr');
  await expect(page.locator('#skilog')).toContainText('Elevation and speed along the descent');
  await page.click('#skilog .close');

  // persists in this browser
  await page.reload();
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 180_000 });
  const after = await page.evaluate(() => ({ n: (window as any).game.skiLog.descents.length, laps: (window as any).game.skiLog.coverage().find((c: any) => c.trail.name === 'Tercero').laps }));
  expect(after).toEqual({ n: 1, laps: 1 });
  expect(errors).toEqual([]);
});
