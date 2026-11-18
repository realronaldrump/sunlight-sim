import { expect, test } from '@playwright/test';

test('ski from Primo through the Grizzly Road dip and coast up its far side', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?autostart=1&name=Ridge&quality=medium&mute=1&ambient=0&hour=11');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120_000 });
  await page.keyboard.press('KeyC');
  const result = await page.evaluate(async () => {
    const g = (window as any).game, player = g.player;
    await g.hf.ensureArea(0, 180, -870, 320);
    const li = g.lifts.paths.findIndex((p: any) => p.def.name === 'Primo');
    player.board(li, 0, 1);
    player.skipRide();
    const exit = player.st.pos, lift = g.lifts.paths[li];
    const road = g.resort.runs.find((r: any) => r.name === 'Grizzly Road');
    // Follow the clear lane off the chair, turn onto the shared apron, then use the mapped trail.
    const points = [[exit.x, exit.z], [exit.x + lift.ax * 10, exit.z + lift.az * 10],
      [11, 1009], [17, 1005], [18, 998], [15, 986], [15, 973],
      ...road.points.slice(0, road.points.findIndex((p: number[]) => p[0] > 350) + 1).map((p: number[]) => [p[0], p[2]])];
    const line: { x: number; z: number }[] = [];
    let distance = 0;
    for (let i = 1; i < points.length; i++) {
      const [x, z] = points[i - 1], dx = points[i][0] - x, dz = points[i][1] - z;
      const length = Math.hypot(dx, dz);
      while (line.length < distance + length) {
        const t = (line.length - distance) / length;
        line.push({ x: x + dx * t, z: z + dz * t });
      }
      distance += length;
    }

    const verdict = { reached: false, fell: false, downhill: 0, uphill: 0,
      troughSpeed: 0, crestSpeed: 0, troughHeight: Infinity, crestHeight: -Infinity,
      downhillView: 0, uphillView: -90, sawRun: false, eyeError: 0 };
    const input = g.input.ski.bind(g.input);
    const cameraDirection = g.camera.position.clone();
    let station = 0, elapsed = 0;
    await new Promise<void>(resolve => {
      // Drive only the input. Rendering, ski forces, collisions, camera and HUD keep their normal frame loop.
      g.input.ski = (dt: number) => {
        elapsed += dt;
        const st = player.st, { x, y, z } = st.pos;
        const advance = Math.min(station + 30, line.length);
        let nearest = Infinity;
        for (let i = station; i < advance; i++) {
          const d = Math.hypot(line[i].x - x, line[i].z - z);
          if (d < nearest) { station = i; nearest = d; }
        }
        const degree = Number(document.getElementById('h-line-angle')!.textContent);
        const direction = document.getElementById('h-line-direction')!.textContent;
        const view = Math.asin(g.camera.getWorldDirection(cameraDirection).y) * 180 / Math.PI;
        if (x > 156 && x < 190 && direction?.includes('down')) {
          verdict.downhill = Math.max(verdict.downhill, degree);
          verdict.downhillView = Math.min(verdict.downhillView, view);
          const goggles = player.model.root.getObjectByName('helmet-and-goggles');
          const lens = goggles.localToWorld(cameraDirection.set(0, .035, -.15));
          verdict.eyeError = Math.max(verdict.eyeError, g.camera.position.distanceTo(lens));
        }
        if (x > 248 && x < 273 && direction?.includes('up')) {
          verdict.uphill = Math.max(verdict.uphill, degree);
          verdict.uphillView = Math.max(verdict.uphillView, view);
          verdict.sawRun ||= g.runAt(x, z)?.name === 'Grizzly Road';
        }
        if (x > 232 && x < 250 && y < verdict.troughHeight) {
          verdict.troughHeight = y; verdict.troughSpeed = st.speed;
        }
        if (x > 265 && x < 284 && y > verdict.crestHeight) {
          verdict.crestHeight = y; verdict.crestSpeed = st.speed;
        }
        verdict.fell ||= st.mode === 'fallen';
        verdict.reached = x > 310;
        if (verdict.reached || verdict.fell || elapsed > 100) {
          g.input.ski = input; resolve();
          return input(dt);
        }
        const lookAhead = x < 19 && z > 972 ? 3 : Math.round(10 + st.speed * .35);
        const target = line[Math.min(line.length - 1, station + lookAhead)];
        const angle = Math.atan2(x - target.x, z - target.z) - st.heading;
        const steer = -1.45 * Math.atan2(Math.sin(angle), Math.cos(angle));
        return { steer: Math.max(-1, Math.min(1, steer)), tuck: false, stop: false,
          plow: x < 145 ? Math.max(0, Math.min(1, (st.speed - 11) * .45)) : 0,
          push: x < 24 && st.speed < 3.5 };
      };
    });
    return verdict;
  });
  expect(result.fell).toBe(false);
  expect(result.reached).toBe(true);
  expect(result.sawRun).toBe(true);
  expect(result.downhill).toBeGreaterThan(16);
  expect(result.uphill).toBeGreaterThan(5);
  expect(result.crestHeight - result.troughHeight).toBeGreaterThan(3.2);
  expect(result.crestSpeed).toBeGreaterThan(1);
  expect(result.troughSpeed).toBeGreaterThan(result.crestSpeed + 5);
  expect(result.uphillView).toBeGreaterThan(result.downhillView + 6);
  expect(result.eyeError).toBeLessThan(.06);
  expect(errors).toEqual([]);
});
