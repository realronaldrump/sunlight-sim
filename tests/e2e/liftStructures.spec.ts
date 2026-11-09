import { test, expect } from '@playwright/test';

for (const webgl of [false, true]) test(`Sunlight terminal and tower review (${webgl ? 'WebGL2' : 'WebGPU'})`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`/?autostart=1&ambient=0&mute=1${webgl ? '&webgl=1' : ''}`);
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  for (const name of ['Primo', 'Segundo', 'Tercero']) {
    for (const view of ['bottom', 'top', 'tower']) {
      await page.evaluate(async ({ name, view }) => {
        const g = (window as any).game, p = g.lifts.paths.find((p: any) => p.def.name === name);
        const towers = p.def.supports.filter((s: any) => s.kind === 'tower');
        const support = view === 'tower' ? towers[Math.floor(towers.length / 2)] : p.def.supports[view === 'top' ? p.def.supports.length - 1 : 0];
        const centre = p.ropePoint(support.s, 0), direction = view === 'top' ? -1 : 1;
        await g.hf.ensureArea(0, centre.x, -centre.z, 120);
        g.flyMode = true; g.player.model.root.visible = false;
        g.camera.fov = view === 'tower' ? 48 : 55; g.camera.updateProjectionMatrix();
        const wheel = g.lifts.spinners.find((w: any) => w.object.parent.name.includes(`${name}-${view}`));
        g.onFrame = [() => {
          const distance = view === 'tower' ? 12 : 18;
          g.camera.position.set(centre.x + p.rx * distance - p.ax * distance * direction, centre.y + (view === 'tower' ? 2 : 4), centre.z + p.rz * distance - p.az * distance * direction);
          g.camera.lookAt(centre.x, centre.y + (view === 'tower' ? .5 : 1), centre.z);
          if (wheel) g.wheelSample = { time: g.lifts.now(), angle: wheel.object.rotation.y, speed: wheel.speed, radius: wheel.radius };
        }];
        const style = document.createElement('style'); style.textContent = 'body > :not(#app) { visibility: hidden !important; }'; document.head.appendChild(style);
      }, { name, view });
      await page.waitForTimeout(500);
      if (view !== 'tower') {
        const before = await page.evaluate(() => (window as any).game.wheelSample);
        await page.waitForTimeout(400);
        const after = await page.evaluate(() => (window as any).game.wheelSample);
        const angle = (after.angle - before.angle + Math.PI * 2) % (Math.PI * 2);
        expect(Math.abs(angle * after.radius - after.speed * (after.time - before.time))).toBeLessThan(.05);
      }
      await page.screenshot({ path: `screenshots/structure-${name}-${view}${webgl ? '-webgl' : ''}.png` });
    }
  }
  expect(await page.evaluate(() => (window as any).game.lifts.spinners.length)).toBe(6);
  expect(errors).toEqual([]);
});
