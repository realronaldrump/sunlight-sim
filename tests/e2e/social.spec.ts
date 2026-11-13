// Two friends at the lodge: one racks her skis and sits at a deck table; the other sees her seated in ski
// boots; they wave and point and each is told about the other's gesture.
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page, name: string, color: string, room: string) {
  const server = encodeURIComponent(process.env.TEST_SERVER_URL ?? 'ws://localhost:8787');
  await page.goto(`/?autostart=1&name=${name}&color=${color}&room=${room}&server=${server}&quality=low&mute=1&snowmemory=0`);
  await page.waitForFunction(() => (window as any).game?.ready && (window as any).game.net?.connected, null, { timeout: 120_000 });
}

test('friends rack skis, sit on the deck, wave and point', async ({ browser }) => {
  const room = 'S' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const ann = await (await browser.newContext({ viewport: { width: 1200, height: 700 } })).newPage();
  const ben = await (await browser.newContext({ viewport: { width: 1200, height: 700 } })).newPage();
  const errors: string[] = [];
  for (const p of [ann, ben]) p.on('pageerror', (e) => errors.push(e.message));
  await boot(ann, 'Ann', '2e9e44', room);
  await boot(ben, 'Ben', '1f6fd1', room);
  await expect.poll(() => ben.evaluate(() => (window as any).game.net.remotes.size), { timeout: 15_000 }).toBe(1);

  const seat = await ann.evaluate(async () => {
    const g = (window as any).game;
    g.toggleSkis();                                   // step out at the west rack
    const rack = g.nearPoi('rack', 6);
    g.onFoot.st.pos.x = rack.x + 0.6; g.onFoot.st.pos.z = rack.z;
    g.toggleSkis();                                   // K at the rack leaves the skis
    const free = g.walkablePois().find((p: any) => p.kind === 'seat' && p.tag === 'deck' && !g.baseLife.seatTaken(p.x, p.z));
    g.onFoot.st.pos.x = free.x + 0.4; g.onFoot.st.pos.z = free.z; g.onFoot.st.pos.y = free.y - 0.45;
    g.net.markTeleport();                             // the test jumps her there; walking would not
    g.toggleSeat();                                   // E at a free table
    return { racked: !g.onFoot.carrying, seated: !!g.onFoot.seat, x: free.x, z: free.z };
  });
  expect(seat).toMatchObject({ racked: true, seated: true });

  await expect.poll(() => ben.evaluate(() => {
    const r = [...(window as any).game.net.remotes.values()][0];
    return { mode: r.last?.mode, walker: !!r.walker?.root.visible, carry: r.last?.foot?.carry };
  }), { timeout: 10_000 }).toEqual({ mode: 'sitting', walker: true, carry: false });
  // Mode changes on the selected snapshot; its position finishes the 120 ms interpolation afterward.
  await expect.poll(() => ben.evaluate(seat => {
    const p = [...(window as any).game.net.remotes.values()][0].walker.root.position;
    return Math.hypot(p.x - seat.x, p.z - seat.z);
  }, seat), { timeout: 10_000 }).toBeLessThan(0.5);

  await ben.evaluate(() => (window as any).game.startGesture('wave'));
  await expect.poll(() => ann.evaluate(() => document.getElementById('toast')?.textContent), { timeout: 5_000 }).toBe('Ben waves');
  await ann.evaluate(() => (window as any).game.startGesture('point'));
  await expect.poll(() => ben.evaluate(() => document.getElementById('toast')?.textContent), { timeout: 5_000 }).toMatch(/^Ann points (down|downhill)/);

  // standing up and picking the skis back up
  const back = await ann.evaluate(async () => {
    const g = (window as any).game;
    g.toggleSeat();
    const rack = g.rackedAt; g.onFoot.st.pos.x = rack.x + 0.6; g.onFoot.st.pos.z = rack.z;
    g.toggleSkis();
    return { seated: !!g.onFoot.seat, carrying: g.onFoot.carrying };
  });
  expect(back).toEqual({ seated: false, carrying: true });
  expect(errors).toEqual([]);
});
