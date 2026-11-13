import { test, expect } from '@playwright/test';

test('skiers flex independently and counter-rotate through linked turns', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/?autostart=1&quality=high&ambient=0&mute=1');
  await page.waitForFunction(() => (window as any).game?.ready, null, { timeout: 120000 });
  await page.evaluate(async () => {
    const g = (window as any).game;
    const run = g.resort.runs.find((r: any) => r.name === 'Midway' && r.kind === 'line');
    const spot = run.points[Math.floor(run.points.length * .4)];
    await g.hf.ensureArea(0, spot[0], -spot[2], 150);
    await g.lookAt(spot[0] + 2, spot[2] + 4, spot[0], spot[1], spot[2], 2);
    await g.waitIdle(30000); g.flyMode = true;
    document.getElementById('help')?.classList.add('hidden');
    const m = g.player.model, position = m.root.position.clone().set(spot[0], g.player.terrainHeight(spot[0], spot[2]), spot[2]);
    const n = g.player.terrainNormal(position.x, position.z), up = position.clone().set(n.x, n.y, n.z).normalize();
    const forward = position.clone().set(0, 0, -1); forward.addScaledVector(up, -forward.dot(up)).normalize();
    const right = forward.clone().cross(up).normalize();
    const orientation = m.root.quaternion.clone().setFromRotationMatrix(m.root.matrix.clone().makeBasis(right, up, forward.negate()));
    const update = m.update.bind(m);
    m.update = () => {}; // the review owns this rig while the rest of the real scene renders normally
    const pose = { speed: 10, edge: 0, plow: 0, tuck: 0, skid: 0, fallen: 0, sitting: 0, time: 0, pushing: false, terrain: g.player.terrain };
    (window as any).animationReview = { pose, frames: 0, samples: [] };
    g.camera.fov = 34; g.camera.updateProjectionMatrix();
    g.onFrame.push((dt: number) => {
      const r = (window as any).animationReview;
      pose.time += dt; m.root.position.copy(position); m.root.quaternion.copy(orientation); update(pose);
      const offset = position.clone().set(2.4, 1.45, -4.8).applyQuaternion(orientation);
      g.camera.position.copy(position).add(offset);
      g.camera.lookAt(position.clone().add(position.clone().set(0, .85, 0).applyQuaternion(orientation)));
      const bone = (name: string) => m.human.mesh.skeleton.bones.find((b: any) => b.name === name).position;
      const knee = (side: string) => bone(`thigh_${side}`).clone().sub(bone(`calf_${side}`))
        .angleTo(bone(`foot_${side}`).clone().sub(bone(`calf_${side}`)));
      r.frames++;
      r.samples.push({ x: bone('pelvis').x, left: knee('l'), right: knee('r'),
        shoulders: bone('upperarm_r').z - bone('upperarm_l').z });
    });
  });
  for (const [name, change] of [
    ['neutral', {}], ['right', { edge: .8 }], ['left', { edge: -.8 }],
    ['wedge', { plow: 1 }], ['tuck', { tuck: 1 }],
  ] as const) {
    const start = await page.evaluate(change => {
      const r = (window as any).animationReview;
      Object.assign(r.pose, { edge: 0, plow: 0, tuck: 0, sitting: 0 }, change);
      return r.frames;
    }, change);
    await page.waitForFunction(start => (window as any).animationReview.frames > start + 55, start);
    const state = await page.evaluate(() => (window as any).animationReview.samples.at(-1));
    if (name === 'right') { expect(state.x).toBeGreaterThan(.2); expect(state.left - state.right).toBeGreaterThan(.1); expect(state.shoulders).toBeLessThan(-.05); }
    if (name === 'left') { expect(state.x).toBeLessThan(-.2); expect(state.right - state.left).toBeGreaterThan(.1); expect(state.shoulders).toBeGreaterThan(.05); }
    await page.screenshot({ path: `screenshots/skier-animation/${info.project.name}-${name}.png` });
  }
  const continuity = await page.evaluate(() => {
    const samples = (window as any).animationReview.samples;
    return Math.max(...samples.slice(1).map((s: any, i: number) => Math.abs(s.x - samples[i].x)));
  });
  expect(continuity).toBeLessThan(.3);
  expect(errors).toEqual([]);
});
