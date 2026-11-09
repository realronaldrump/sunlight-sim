import { test, expect } from '@playwright/test';

test('Sunlight chair close-ups, occupied seats and distinct carrier designs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/?autostart=1&ambient=0&mute=1');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  for (const name of ['Primo', 'Segundo', 'Tercero']) {
    const model = await page.evaluate(name => {
      const g = (window as any).game, li = g.lifts.paths.findIndex((p: any) => p.def.name === name), p = g.lifts.paths[li];
      const t = p.lineLen * .40 / p.def.speed, lp = p.loopPoint(p.lineLen * .40).p;
      g.lifts.now = () => t;
      g.flyMode = true; g.player.model.root.visible = false;
      g.camera.fov = 45; g.camera.updateProjectionMatrix();
      g.onFrame = [() => {
        g.camera.position.set(lp.x + p.ax * 4.7 + p.rx * 2.5, lp.y - 1.25, lp.z + p.az * 4.7 + p.rz * 2.5);
        g.camera.lookAt(lp.x, lp.y - 1.85, lp.z);
        g.lifts.update([{ lift: li, chair: 0 }], g.camera.position);
      }];
      const style = document.createElement('style'); style.textContent = 'body > :not(#app) { visibility: hidden !important; }'; document.head.appendChild(style);
      const meshes = g.lifts.chairMeshes[li];
      return { near: meshes.near.length, bar: meshes.near.some((m: any) => m.motion === 'restraint'), count: meshes.labels.count };
    }, name);
    expect(model.near).toBeGreaterThanOrEqual(3);
    expect(model.bar).toBe(name !== 'Tercero');
    expect(model.count).toBe(({ Primo: 115, Segundo: 140, Tercero: 110 })[name]);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `screenshots/chair-${name}-front.png` });
    await page.evaluate(name => {
      const g = (window as any).game, li = g.lifts.paths.findIndex((p: any) => p.def.name === name);
      g.player.board(li, 0, Math.floor(g.lifts.paths[li].def.seats / 2));
      g.player.sitBlend = 1;
      for (let i = 0; i < 3; i++) g.player.update(1 / 60, { steer: 0, tuck: false, plow: 0, stop: false, push: false });
      // Use the actual seated pose, after the short pickup visual has finished.
      const r = g.player.ride, point = g.lifts.paths[li].riderPoint(0, r.seat, g.lifts.now()).p;
      g.player.model.root.position.set(point.x, point.y, point.z);
      g.player.model.root.visible = true;
    }, name);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `screenshots/chair-${name}-occupied.png` });
  }
  expect(errors).toEqual([]);
});
