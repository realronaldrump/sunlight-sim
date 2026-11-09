import { test, expect } from '@playwright/test';
import WebSocket from 'ws';
import type { PlayerInfo } from '../../shared/protocol';

test('a networked fall releases its seat and broadcasts the landing instead of the summit', async ({ page }) => {
  const server = process.env.TEST_SERVER_URL ?? 'ws://127.0.0.1:8795';
  const room = 'F' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const observer = new WebSocket(server);
  let skiers: PlayerInfo[] = [], released = false;
  const welcome = new Promise<void>((resolve, reject) => {
    observer.on('open', () => observer.send(JSON.stringify({ type: 'join', room, name: 'Observer', color: '#445566' })));
    observer.on('error', reject);
    observer.on('message', data => {
      const m = JSON.parse(data.toString());
      if (m.type === 'welcome') resolve();
      if (m.type === 'snapshot') skiers = m.players;
      if (m.type === 'liftFell') released = true;
    });
  });
  await welcome;
  const keepalive = setInterval(() => observer.send(JSON.stringify({ type: 'ping', t: Date.now() / 1000 })), 5000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`/?autostart=1&ambient=0&webgl=1&name=Rocker&room=${room}&server=${encodeURIComponent(server)}`);
    await page.waitForFunction(() => (window as any).game?.ready && (window as any).game.net?.connected, null, { timeout: 120_000 });
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => {
      const g = (window as any).game, li = g.lifts.paths.findIndex((p: any) => p.def.name === 'Primo'), path = g.lifts.paths[li], t = g.lifts.now(li);
      return path.nextChairAt(path.loadU, t).arrive - t;
    }), { timeout: 25000, intervals: [100] }).toBeLessThan(.8);
    await page.evaluate(() => {
      const g = (window as any).game, path = g.lifts.paths.find((p: any) => p.def.name === 'Primo'), lp = path.loadPoint(), off = path.seatOffset(0);
      g.player.teleport(lp.x + path.rx * off, lp.z + path.rz * off, lp.heading);
      g.net.markTeleport(); g.networkFall = { corrections: 0, release: null, rejections: [], frames: 0 };
      const message = g.net.onMessage.bind(g.net);
      g.net.onMessage = (m: any) => { if (m.type === 'correct') g.networkFall.corrections++; if (m.type === 'boardRejected') g.networkFall.rejections.push(m.reason); message(m); };
      g.onFrame.push(() => { g.networkFall.frames++; if (g.player.tumble && !g.networkFall.release) g.networkFall.release = { ...g.player.st.pos }; });
      document.getElementById('help')?.classList.add('hidden');
    });
    await expect.poll(() => page.evaluate(() => !!(window as any).game.player.ride), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => skiers.find(p => p.name === 'Rocker')?.ride).toBeTruthy();
    if (await page.locator('#lift-speed-8').count()) await page.locator('#lift-speed-8').click();
    else await page.keyboard.press('KeyF');
    await expect.poll(() => page.evaluate(() => {
      const g = (window as any).game, r = g.player.ride, p = g.lifts.paths[r.lift];
      return p.loopPoint(p.chairU(r.chair, g.lifts.now(r.lift))).h;
    }), { timeout: 20_000 }).toBeGreaterThan(160);
    if (await page.locator('#lift-speed-1').count()) await page.locator('#lift-speed-1').click();
    else await page.keyboard.press('KeyF');
    const started = Date.now(); let last = '';
    while (Date.now() - started < 25_000 && await page.evaluate(() => !!(window as any).game.player.ride)) {
      const key = Math.cos((Date.now() - started) / 1000 * 1.65) >= 0 ? 'KeyD' : 'KeyA';
      if (key !== last) { if (last) await page.keyboard.up(last); await page.keyboard.down(key); last = key; }
      await page.waitForTimeout(75);
    }
    if (last) await page.keyboard.up(last);
    await expect.poll(() => released, { timeout: 5000 }).toBe(true);
    await expect.poll(() => skiers.find(p => p.name === 'Rocker')?.ride).toBeNull();
    await expect.poll(() => page.evaluate(() => (window as any).game.player.st.grounded), { timeout: 15_000 }).toBe(true);
    const state = await page.evaluate(() => { const g = (window as any).game; return { ...g.networkFall, pos: { ...g.player.st.pos }, ride: g.player.ride }; });
    expect(state.ride).toBeNull(); expect(state.corrections).toBe(0);
    expect(Math.hypot(state.pos.x - state.release.x, state.pos.z - state.release.z)).toBeLessThan(60);
    expect(skiers.find(p => p.name === 'Rocker')?.s.mode).toBe('fallen');
    expect(errors).toEqual([]);
  } finally { clearInterval(keepalive); observer.close(); }
});
