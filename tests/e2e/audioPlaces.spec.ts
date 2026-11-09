// The real audio graph, rendered offline: the lodge, an aspen grove and an exposed ridge sound different.
import { test, expect } from '@playwright/test';

test('the lodge, a sheltered grove and an exposed ridge each sound distinct', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?autostart=1&mute=1&ambient=0&quality=low');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  const db = await page.evaluate(async () => {
    const Audio = (window as any).game.audio.constructor;
    const base = { speed: 0, skid: 0, edge: 0, grounded: true, groomed: 1, moguls: 0, plow: 0, riding: false, nearTerminal: 1000, towerPass: false, fell: false, inAir: false, altitude: 2800 };
    const env = (e: object) => ({ indoor: 0, shelter: 0, exposure: 0, chatter: 0, ...e });
    const cases: Record<string, { env: object; step?: string }> = {
      open: { env: env({}) }, grove: { env: env({ shelter: 0.9 }) }, ridge: { env: env({ exposure: 1 }) },
      lodge: { env: env({ indoor: 1, chatter: 1 }), step: 'wood' },
    };
    const out: Record<string, { rms: number; hf: number }> = {};
    for (const [name, c] of Object.entries(cases)) {
      const rate = 24000, seconds = 10, ctx = new OfflineAudioContext(2, rate * seconds, rate);
      const a = new Audio(); a.start(ctx); await a.assetsReady;
      a.placeTimers.clink = 0.5; a.placeTimers.coffee = 2;
      for (let i = 0; i < seconds * 60; i++) a.update(1 / 60, { ...base, env: c.env, step: c.step && i % 40 === 0 ? c.step : undefined }, i / 60);
      const b = await ctx.startRendering(), l = b.getChannelData(0), r = b.getChannelData(1);
      let e = 0, h = 0;
      for (let i = rate * 2; i < l.length; i++) { e += l[i] ** 2 + r[i] ** 2; h += (l[i] - l[i - 1]) ** 2; }
      out[name] = { rms: 10 * Math.log10(e / (2 * (l.length - rate * 2)) + 1e-12), hf: h / Math.max(1e-12, e / 2) };
      a.dispose();
    }
    return out;
  });
  expect(db.grove.rms).toBeLessThan(db.open.rms - 3);     // trees hush the wind
  expect(db.ridge.rms).toBeGreaterThan(db.open.rms + 6);  // the ridge is windier
  expect(db.lodge.rms).toBeGreaterThan(db.open.rms + 4);  // room, conversation, cups, boots on the floor
  expect(db.lodge.hf).toBeGreaterThan(db.open.hf * 2);    // cups and boot heels are bright, unlike filtered wind
  expect(errors).toEqual([]);
});
