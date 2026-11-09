import { expect, test } from '@playwright/test';

test('the Snowriders\' Club lines up at the lodge, can be joined and waits for a solo tag-along', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?autostart=1&quality=low&mute=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).game?.ready && (window as any).game.lesson?.ready, null, { timeout: 180_000 });

  // the group is together at the Lesson Line-Up Area, children smaller than their instructor
  const lineup = await page.evaluate(async () => {
    const g = (window as any).game, L = g.lesson;
    L.freezeTau = 60;
    await new Promise((r) => setTimeout(r, 1500));
    const pos = L.positions();
    const spread = Math.max(...pos.map((p: any) => p.distanceTo(pos[0])));
    const ground = Math.max(...pos.map((p: any) => Math.abs(p.y - g.player.terrainHeight(p.x, p.z))));
    const scales = L.members.map((m: any) => m.model.root.scale.x);
    const status = L.status(Date.now() / 1000);
    return { n: pos.length, spread, ground, scales, label: status.label, phase: status.phase };
  });
  expect(lineup.n).toBe(6);
  expect(lineup.phase).toBe('lineup');
  expect(lineup.spread).toBeLessThan(8);
  expect(lineup.ground).toBeLessThan(0.1);
  expect(lineup.scales[0]).toBe(1);
  for (const s of lineup.scales.slice(1)) expect(s).toBeLessThan(0.9);

  // walk up and tag along with L
  await page.evaluate(() => { const g = (window as any).game, p = g.lesson.positions()[0]; g.player.teleport(p.x + 6, p.z + 4, 0); });
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyL');
  await expect.poll(() => page.evaluate(() => (window as any).game.tagging)).toBe(true);
  await expect(page.locator('#lesson')).toHaveClass(/show/);
  await expect(page.locator('#lesson')).toContainText('Segundo Road');

  // solo: if the tag-along falls behind as the group is about to leave, they wait
  const held = await page.evaluate(async () => {
    const g = (window as any).game, L = g.lesson;
    L.freezeTau = null;
    const now = () => Date.now() / 1000;
    const c = L.clock(now()); L.hold += c.tau - (L.timeline.lineup - 2);
    g.player.teleport(L.positions()[0].x + 150, L.positions()[0].z, 0);
    const before = L.hold;
    await new Promise((r) => setTimeout(r, 4000));
    return { gained: L.hold - before, tau: L.clock(now()).tau, lineup: L.timeline.lineup };
  });
  expect(held.gained).toBeGreaterThan(2.5);
  expect(held.tau).toBeLessThan(held.lineup);
  await expect(page.locator('#lesson')).toContainText('waiting for you');

  await page.keyboard.press('KeyL');
  await expect.poll(() => page.evaluate(() => (window as any).game.tagging)).toBe(false);
  expect(errors).toEqual([]);
});
