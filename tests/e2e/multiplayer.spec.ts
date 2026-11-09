// Two clients join one room by link, see each other, ride one chair together, and appear on the map.
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page, name: string, color: string, room: string) {
  const server = encodeURIComponent(process.env.TEST_SERVER_URL ?? 'ws://localhost:8787');
  await page.goto(`/?autostart=1&name=${name}&color=${color}&room=${room}&server=${server}`);
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
}

test('two players in one room', async ({ browser }) => {
  const room = 'T' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const a = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const b = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await boot(a, 'Alice', '1f6fd1', room);
  await boot(b, 'Bob', '2e9e44', room);
  await expect.poll(() => a.evaluate(() => (window as any).game.net?.remotes.size), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => b.evaluate(() => (window as any).game.net?.remotes.size), { timeout: 15_000 }).toBe(1);
  await expect(a.locator('#minimap canvas')).toHaveAttribute('aria-label', /1 other skier in the room/);
  await expect(b.locator('#minimap canvas')).toHaveAttribute('aria-label', /1 other skier in the room/);
  // Room controls leave enough space above the minimap.
  const roomBox = (await b.locator('#roombox').boundingBox())!, mapBox = (await b.locator('#minimap').boundingBox())!;
  expect(mapBox.y).toBeGreaterThan(roomBox.y + roomBox.height);

  // Alice moves; Bob sees her there
  await a.evaluate(() => (window as any).game.teleportToRun('Midway'));
  const alicePos = await a.evaluate(() => { const p = (window as any).game.player.st.pos; return [p.x, p.z]; });
  await expect.poll(async () => {
    const r = await b.evaluate(() => { const g = (window as any).game; const rem = [...g.net.remotes.values()][0]; return [rem.model.root.position.x, rem.model.root.position.z]; });
    return Math.hypot(r[0] - alicePos[0], r[1] - alicePos[1]);
  }, { timeout: 10_000 }).toBeLessThan(6);

  // both stand in the Segundo load zone and get scooped by the same chair
  await expect.poll(() => a.evaluate(() => {
    const p = (window as any).game.lifts.paths.find((p: any) => p.def.name === 'Segundo'), t = (window as any).game.lifts.now();
    return p.nextChairAt(p.loadU, t).arrive - t;
  }), { timeout: 15_000 }).toBeGreaterThan(3);
  for (const [page, off] of [[a, -0.6], [b, 0.6]] as const) {
    await page.evaluate((o) => {
      const g = (window as any).game; const path = g.lifts.paths.find((p: any) => p.def.name === 'Segundo');
      const lp = path.loadPoint();
      g.player.teleport(lp.x - path.ax * 1.2 + path.rx * o, lp.z - path.az * 1.2 + path.rz * o, lp.heading);
      g.net.markTeleport();
    }, off);
  }
  await expect.poll(() => a.evaluate(() => !!(window as any).game.player.ride), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => b.evaluate(() => !!(window as any).game.player.ride), { timeout: 30_000 }).toBe(true);
  const ra = await a.evaluate(() => (window as any).game.player.ride);
  const rb = await b.evaluate(() => (window as any).game.player.ride);
  expect(ra.lift).toBe(rb.lift);
  expect(ra.chair).toBe(rb.chair);
  expect(ra.seat).not.toBe(rb.seat);
  // Bob sees Alice riding
  await expect.poll(() => b.evaluate(() => { const rem = [...(window as any).game.net.remotes.values()][0]; return !!rem.ride; }), { timeout: 5_000 }).toBe(true);
  await b.waitForTimeout(4000);
  await b.evaluate(() => document.getElementById('help')?.classList.add('hidden'));
  await b.screenshot({ path: 'screenshots/08_multiplayer_chair.png' });

  // the map shows the other player
  await b.keyboard.press('KeyM');
  await b.waitForTimeout(500);
  const names = await b.evaluate(() => (window as any).game.trailMap.players.map((p: any) => p.name));
  expect(names).toContain('Alice');
  await b.screenshot({ path: 'screenshots/09_multiplayer_map.png' });

  // join a friend from the map: Bob unloads, then jumps next to Alice
  await b.keyboard.press('KeyM');
  await b.evaluate(() => (window as any).game.player.skipRide());
  await a.evaluate(() => (window as any).game.player.skipRide());
  await a.waitForTimeout(1000);
  for (const page of [a, b]) {
    const result = await page.evaluate(() => {
      const g = (window as any).game, p = g.lifts.paths.find((p: any) => p.def.name === 'Segundo');
      return { ride: g.player.ride, mode: g.player.st.mode, distance: Math.hypot(g.player.st.pos.x - p.def.top[0], g.player.st.pos.z - p.def.top[2]) };
    });
    expect(result.ride).toBeNull();
    expect(result.mode).not.toBe('fallen');
    expect(result.distance).toBeLessThan(30);
  }
  await a.evaluate(() => (window as any).game.teleportToRun('Sun King'));
  await b.waitForTimeout(1500);
  await b.evaluate(() => (window as any).game.joinFriend('Alice'));
  const d = await b.evaluate(() => { const g = (window as any).game; const r = [...g.net.remotes.values()][0]; return Math.hypot(g.player.st.pos.x - r.model.root.position.x, g.player.st.pos.z - r.model.root.position.z); });
  expect(d).toBeLessThan(8);

  // chat
  await a.evaluate(() => (window as any).game.net.chat('See you at the top'));
  await expect.poll(() => b.evaluate(() => document.getElementById('chatlog')?.textContent ?? ''), { timeout: 5_000 }).toContain('See you at the top');
  await b.keyboard.press('KeyT');
  await expect(b.locator('#chatin')).toBeVisible();
  await b.locator('#chatin').pressSequentially('view from the lift');
  await expect(b.locator('#minimap canvas')).toBeVisible(); // Typing V in chat must not hide the map.
  await b.keyboard.press('Enter');
  await a.context().close();
  await b.context().close();
});
