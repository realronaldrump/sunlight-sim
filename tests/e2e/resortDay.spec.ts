import { expect, test } from '@playwright/test';

test('Resort Day closes the lifts at four, the patrol sweeps, and the lifts reopen in the morning', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?autostart=1&quality=low&mute=1&snowmemory=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 180_000 });
  const setHour = (hour: number) => page.evaluate(async (hour) => {
    const g = (window as any).game, c = g.resortClock, span = (20.5 - 7) * 360;
    g.setClockMode('day');
    c.offset += (hour - 7) * 360 - (((c.now() % span) + span) % span);
    await new Promise((r) => setTimeout(r, 1200));
    return { hour: g.env.hour, closed: g.lifts.closed, patrol: g.patrol.members.filter((m: any) => m.visible).length,
      queue: g.baseLife.people.filter((p: any) => p.kind === 'queue' && p.visible).length, lesson: g.lesson.out };
  }, hour);

  const close = await setHour(16.2);
  expect(close.hour).toBeCloseTo(16.2, 1);
  expect(close.closed).toBe(true);
  expect(close.patrol).toBeGreaterThan(0);
  expect(close.queue).toBe(0);
  expect(close.lesson).toBe(false);
  // standing at the load line after hours: no chair takes you
  const boarded = await page.evaluate(async () => {
    const g = (window as any).game, p = g.lifts.paths.find((l: any) => l.def.name === 'Tercero'), lp = p.loadPoint();
    g.player.teleport(lp.x - p.ax * 1.2, lp.z - p.az * 1.2, lp.heading);
    await new Promise((r) => setTimeout(r, 12000));
    return { ride: !!g.player.ride, hint: document.getElementById('hint')?.textContent ?? '' };
  });
  expect(boarded.ride).toBe(false);
  expect(boarded.hint).toContain('closed');

  const morning = await setHour(10.5);
  expect(morning.closed).toBe(false);
  expect(morning.patrol).toBe(0);
  expect(morning.lesson).toBe(true);
  await page.evaluate(() => {
    const g = (window as any).game, p = g.lifts.paths.find((l: any) => l.def.name === 'Tercero'), lp = p.loadPoint();
    g.player.teleport(lp.x - p.ax * 1.2, lp.z - p.az * 1.2, lp.heading);
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).game.player.ride), { timeout: 20_000 }).toBe(true);
  expect(errors).toEqual([]);
});
