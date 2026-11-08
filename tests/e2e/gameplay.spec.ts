// Gameplay scenario: spawn, ski down a run with keyboard input, fall into a tree and get up, ride a lift,
// toggle cameras/overlay/map, and check that audio runs.
import { test, expect } from '@playwright/test';

test('spawn, ski, fall and get up, ride a lift, audio', async ({ page }) => {
  await page.goto('/?autostart=1&name=Tester');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  // spawned at the base near the main lift, standing
  const spawn = await page.evaluate(() => { const g = (window as any).game; return { mode: g.player.st.mode, y: g.player.st.pos.y, slope: g.player.st.slopeDeg }; });
  expect(spawn.y).toBeGreaterThan(2400);
  expect(spawn.slope).toBeLessThan(8);

  // ski Midway with keyboard: hold W to push off, then let gravity work, steer a little
  await page.evaluate(() => (window as any).game.teleportToRun('Midway'));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyA'); await page.waitForTimeout(700); await page.keyboard.up('KeyA');
  await page.keyboard.down('KeyD'); await page.waitForTimeout(700); await page.keyboard.up('KeyD');
  const moving = await page.evaluate(() => (window as any).game.player.st.speed);
  expect(moving).toBeGreaterThan(2);
  // audio context starts after the key presses and makes sound while moving
  const audio = await page.evaluate(() => { const a = (window as any).game.audio; return { state: a.ctx?.state, wind: a.wind?.gain.gain.value }; });
  expect(audio.state).toBe('running');
  expect(audio.wind).toBeGreaterThan(0.01);
  // snowplow slows down
  await page.keyboard.down('KeyS'); await page.waitForTimeout(3000); await page.keyboard.up('KeyS');

  // fall: launch the skier into a tree trunk
  const fell = await page.evaluate(async () => {
    const g = (window as any).game, st = g.player.st;
    const near = g.colliders.query(st.pos.x, st.pos.z).filter((c: any) => c.type === 'cyl');
    // find any tree near Midway if none in this cell
    let tree = near[0];
    if (!tree) { for (let r = 8; r < 200 && !tree; r += 8) tree = g.colliders.query(st.pos.x + r, st.pos.z).find((c: any) => c.type === 'cyl'); }
    g.player.teleport(tree.x, tree.z + 3, 0);
    g.player.st.vel = { x: 0, y: 0, z: -9 };
    for (let i = 0; i < 40 && g.player.st.mode !== 'fallen'; i++) await new Promise((r) => setTimeout(r, 16));
    return g.player.st.mode;
  });
  expect(fell).toBe('fallen');
  await page.waitForTimeout(2500);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(2500);
  const up = await page.evaluate(() => (window as any).game.player.st.mode);
  expect(['standing', 'skiing']).toContain(up);

  // ride Tercero: stand on the load line, get scooped, skip to the top, unload
  await page.evaluate(() => {
    const g = (window as any).game; const p = g.lifts.paths.find((l: any) => l.def.name === 'Tercero');
    const lp = p.loadPoint(); g.player.teleport(lp.x - p.ax * 1.2, lp.z - p.az * 1.2, lp.heading);
  });
  await expect.poll(() => page.evaluate(() => !!(window as any).game.player.ride), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.getElementById('help')?.classList.add('hidden'));
  await page.screenshot({ path: 'screenshots/11_riding_tercero.png' });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(1000);
  const top = await page.evaluate(() => { const g = (window as any).game; const p = g.lifts.paths.find((l: any) => l.def.name === 'Tercero'); const st = g.player.st; return { ride: g.player.ride, d: Math.hypot(st.pos.x - p.def.top[0], st.pos.z - p.def.top[2]), mode: st.mode }; });
  expect(top.ride).toBeNull();
  expect(top.d).toBeLessThan(20);

  // cameras, overlay, map
  for (const k of ['KeyC', 'KeyC']) { await page.keyboard.press(k); await page.waitForTimeout(400); }
  expect(await page.evaluate(() => (window as any).game.camRig.mode)).toBe('side');
  await page.screenshot({ path: 'screenshots/12_side_camera.png' });
  await page.keyboard.press('KeyC');
  await page.keyboard.press('KeyO');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).game.terrainMat.slopeOverlay.value)).toBe(1);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).game.trailMap.visible)).toBe(true);
});
