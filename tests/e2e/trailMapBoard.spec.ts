import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const print = JSON.parse(readFileSync('client/src/world/assets/trail-board.json', 'utf8'));
for (const [quality, webgl] of [['high', false], ['low', true]] as const) {
  test(`the photo-located base trail map is readable and solid (${quality})`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`/?autostart=1&ambient=0&mute=1&quality=${quality}${webgl ? '&webgl=1' : ''}`);
    await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120000 });
    const board = await page.evaluate(() => {
      const g = (window as any).game;
      const panel = g.scene.getObjectByName('base-trail-map-panel'), kiosk = panel.parent;
      const at = kiosk.getWorldPosition(g.camera.position.clone());
      const middle = panel.getWorldPosition(at.clone());
      const normal = at.clone().set(0, 0, 1).applyQuaternion(panel.getWorldQuaternion(g.camera.quaternion.clone()));
      const right = at.clone().set(1, 0, 0).applyQuaternion(panel.getWorldQuaternion(g.camera.quaternion.clone()));
      const boxes = g.colliders.query(at.x, at.z).filter((b: any) => b.type === 'box' && Math.hypot(b.x - at.x, b.z - at.z) < .1);
      let blocked = false;
      // Approach the left, middle and right of the printed face without a structure or trunk hiding it.
      for (const side of [-.75, 0, .75]) for (let distance = .35; distance < 8; distance += .08) {
        const p = middle.clone().addScaledVector(normal, distance).addScaledVector(right, side);
        blocked ||= g.colliders.query(p.x, p.z).some((b: any) => {
          if (p.y > b.top || p.y < (b.bottom ?? -Infinity)) return false;
          const dx = p.x - b.x, dz = p.z - b.z;
          if (b.type === 'cyl') return Math.hypot(dx, dz) < b.r;
          const c = Math.cos(b.yaw ?? 0), s = Math.sin(b.yaw ?? 0);
          return Math.abs(c * dx - s * dz) < b.hx && Math.abs(s * dx + c * dz) < b.hz;
        });
      }
      document.getElementById('help')?.classList.add('hidden');
      return { x: at.x, z: at.z, ground: at.y, center: middle.toArray(), normal: normal.toArray(),
        image: [panel.material.map.image.width, panel.material.map.image.height],
        lifts: g.resort.lifts.filter((l: any) => l.name !== 'Primo').map((l: any) => ({ name: l.name, distance: Math.hypot(at.x - l.bottom[0], at.z - l.bottom[2]) })),
        terrain: g.hf.heightAt(at.x, at.z), blocked, solid: boxes.some((b: any) => b.top > at.y + 2 && b.bottom < at.y) };
    });
    expect(board.x).toBeCloseTo(print.youAreHere[0], 1);
    expect(board.z).toBeCloseTo(print.youAreHere[2], 1);
    expect(board.image).toEqual([3072, 2304]);
    expect(board.ground).toBeCloseTo(board.terrain, 2);
    expect(board.solid).toBe(true);
    expect(board.blocked).toBe(false);
    expect(board.lifts.find((l: any) => l.name === 'Tercero').distance).toBeLessThan(24);
    expect(board.lifts.find((l: any) => l.name === 'Segundo').distance).toBeLessThan(35);
    expect(print.unplacedRunLabels).toEqual([]);
    expect(print.runLabels).toEqual(expect.arrayContaining(['Ute', 'Grizzly Road', 'Sun King', 'Midway', 'The Heathen']));
    expect(print.lifts.sort()).toEqual(['Primo', 'Segundo', 'Tercero']);
    for (const [view, distance, fov] of [['approach', 8, 62], ['panel', 2.4, 38], ['setting', 18, 62]] as const) {
      await page.evaluate(async ({ board, distance, fov, view }) => {
        const g = (window as any).game, [x, y, z] = board.center, [nx, , nz] = board.normal;
        g.camera.fov = fov; g.camera.updateProjectionMatrix();
        const side = view === 'setting' ? 7 : 0;
        await g.lookAt(x + nx * distance + nz * side, z + nz * distance - nx * side, x, y, z, view === 'panel' ? 2 : 1.72);
        await g.waitIdle(30000);
      }, { board, distance, fov, view });
      await page.screenshot({ path: `screenshots/base-trail-map/${info.project.name}-${quality}-${view}.png` });
    }
    expect(errors).toEqual([]);
  });
}
