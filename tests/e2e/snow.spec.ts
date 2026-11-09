// Snow material and particle regressions on both renderer backends. Screenshots are reviewed,
// not golden pixel snapshots: other agents are evolving the scenery and characters concurrently.
import { test, expect } from '@playwright/test';

for (const webgl of [false, true]) {
  test(`snow surfaces and weather (${webgl ? 'WebGL2' : 'WebGPU'})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`/?autostart=1&ambient=0&mute=1${webgl ? '&webgl=1' : ''}`);
    await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120000 });
    await page.evaluate(() => {
      document.getElementById('help')?.classList.add('hidden');
      return (window as any).game.terrainMat.ready;
    });
    const backend = webgl ? 'webgl' : 'webgpu';
    for (const name of ['Midway', 'Segundo']) {
      const ground = await page.evaluate(async (name) => {
        const g = (window as any).game;
        const run = g.resort.runs.find((r: any) => r.name === name && r.kind === 'line');
        const i = Math.min(run.points.length - 2, Math.floor(run.points.length * 0.4));
        const p = run.points[i], q = run.points[i + 1];
        await g.hf.ensureArea(0, p[0], -p[2], 250);
        const dx = q[0] - p[0], dz = q[2] - p[2], l = Math.hypot(dx, dz);
        await g.lookAt(p[0], p[2], p[0] + dx / l * 9, g.hf.heightAt(p[0] + dx / l * 9, p[2] + dz / l * 9), p[2] + dz / l * 9, 1.7);
        await g.waitIdle(30000);
        return { before: g.hf.heightAt(p[0], p[2]), x: p[0], z: p[2] };
      }, name);
      for (const hour of [11, 15.5]) {
        await page.evaluate((h) => (window as any).game.env.setHour(h), hour);
        await page.waitForTimeout(700);
        await page.screenshot({ path: `screenshots/snow_${backend}_${name.toLowerCase()}_${hour}.png` });
      }
      // Lighting and relief must never move the physical terrain under the player's skis.
      const after = await page.evaluate(({ x, z }) => (window as any).game.hf.heightAt(x, z), ground);
      expect(after).toBe(ground.before);
    }
    await page.evaluate(() => {
      const g = (window as any).game;
      g.env.setHour(11); g.setSnow(true);
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `screenshots/snow_${backend}_falling.png` });
    const trackIndices = await page.evaluate(async () => {
      const g = (window as any).game;
      g.setSnow(false); g.env.setHour(14);
      const run = g.resort.runs.find((r: any) => r.name === 'Midway' && r.kind === 'line');
      const p = run.points[Math.floor(run.points.length * 0.4)], q = run.points[Math.floor(run.points.length * 0.4) + 1];
      await g.hf.ensureArea(0, p[0], -p[2], 200);
      const dx = q[0] - p[0], dz = q[2] - p[2], len = Math.hypot(dx, dz);
      const forward = g.camera.position.clone().set(dx / len, 0, dz / len);
      const side = forward.clone().set(-forward.z, 0, forward.x);
      const point = (s: number, offset: number) => {
        const v = forward.clone().multiplyScalar(s).addScaledVector(side, Math.sin(s * 0.18) * 2 + offset);
        v.x += p[0]; v.z += p[2]; v.y = g.hf.heightAt(v.x, v.z);
        return v;
      };
      g.tracks.break();
      for (let s = -14; s <= 4; s += 0.3) {
        const a = point(s, 0), b = point(s + 0.05, 0);
        const dir = b.clone().sub(a); dir.y = 0; dir.normalize();
        g.tracks.add(point(s, -0.22), point(s, 0.22), dir, 0.25, 1.4);
        g.tracks.update(0.03);
      }
      const target = point(2, 0), eye = point(-4, 4.5);
      await g.lookAt(eye.x, eye.z, target.x, target.y + 0.1, target.z, 2.2);
      await g.waitIdle(30000);
      // Emit a fresh edge plume after terrain streaming so its sub-second lifetime is visible.
      g.tracks.break();
      g.tracks.add(point(3.5, -0.22), point(3.5, 0.22), forward, 0.32, 1.6);
      g.tracks.update(0.04);
      g.tracks.add(point(4, -0.22), point(4, 0.22), forward, 0.32, 1.6);
      g.tracks.update(0.08);
      await g.renderer.compileAsync(g.scene, g.camera);
      return g.tracks.mesh.geometry.drawRange.count;
    });
    expect(trackIndices).toBeGreaterThan(1000);
    await page.screenshot({ path: `screenshots/snow_${backend}_tracks.png` });
    expect(errors).toEqual([]);
  });
}
