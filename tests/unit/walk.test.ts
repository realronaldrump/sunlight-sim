import { describe, expect, it } from 'vitest';
import { ColliderGrid } from '../../shared/collision';
import { WalkSurfaces, createWalker, stepWalker, WALK, toWorld } from '../../shared/walk';

const flat = (_x: number, _z: number) => 100;
const run = (st: ReturnType<typeof createWalker>, inp: { x: number; z: number; run: boolean }, s: WalkSurfaces, c: ColliderGrid, secs: number, terrain = flat) => {
  for (let t = 0; t < secs; t += 1 / 60) stepWalker(st, inp, terrain, s, c, 1 / 60);
};

describe('walking in ski boots', () => {
  it('walks and jogs at booted human speeds and turns to face travel', () => {
    const st = createWalker(0, 100, 0, 0), s = new WalkSurfaces(), c = new ColliderGrid();
    run(st, { x: 1, z: 0, run: false }, s, c, 3);
    expect(st.speed).toBeCloseTo(WALK.walk, 1);
    expect(st.heading).toBeCloseTo(-Math.PI / 2, 1); // facing +x
    run(st, { x: 1, z: 0, run: true }, s, c, 2);
    expect(st.speed).toBeCloseTo(WALK.run, 1);
    run(st, { x: 0, z: 0, run: false }, s, c, 1);
    expect(st.speed).toBeLessThan(0.05);
    expect(st.pos.y).toBe(100);
  });

  it('climbs a stair flight onto a floor and walks off the far edge down to the snow', () => {
    const st = createWalker(0, 100, 0, 0), s = new WalkSurfaces(), c = new ColliderGrid();
    // stairs rising 2.7 m toward -z over 5 m, then a landing floor
    s.add({ cx: 0, cz: -3.5, yaw: 0, hx: 0.8, hz: 2.5, y0: 102.7, y1: 100.1 });
    s.add({ cx: 0, cz: -9, yaw: 0, hx: 3, hz: 3, y0: 102.7 });
    run(st, { x: 0, z: -1, run: false }, s, c, 8);
    expect(st.pos.y).toBeCloseTo(102.7, 2);
    expect(st.onSnow).toBe(false);
    run(st, { x: 0, z: -1, run: false }, s, c, 6);
    expect(st.pos.z).toBeLessThan(-12.5);
    expect(st.pos.y).toBeCloseTo(100, 2);
    expect(st.onSnow).toBe(true);
  });

  it('does not walk up a sheer floor edge or through walls, and slides along them', () => {
    const st = createWalker(0, 100, 0, 0), s = new WalkSurfaces(), c = new ColliderGrid();
    s.add({ cx: 0, cz: -6, yaw: 0, hx: 4, hz: 3, y0: 101.5 }); // 1.5 m platform, no stairs
    run(st, { x: 0, z: -1, run: false }, s, c, 6);
    expect(st.pos.z).toBeGreaterThan(-3.01);
    expect(st.pos.y).toBe(100);
    const w = createWalker(0, 100, 0, 0), wall = new ColliderGrid();
    wall.add({ type: 'box', x: 0, z: -2, hx: 5, hz: 0.1, yaw: 0, top: 103 });
    run(w, { x: 0.6, z: -0.8, run: false }, s, wall, 6);
    expect(w.pos.z).toBeGreaterThan(-2.1 + WALK.radius - 0.01);
    expect(w.pos.x).toBeGreaterThan(2); // slid sideways along the wall
  });

  it('passes under upper-storey walls and reports interior volumes', () => {
    const st = createWalker(0, 100, 0, 0), s = new WalkSurfaces(), c = new ColliderGrid();
    c.add({ type: 'box', x: 0, z: -2, hx: 5, hz: 0.1, yaw: 0, top: 107, bottom: 103.4 });
    const v = { cx: 0, cz: -6, yaw: 0.4, hx: 3, hz: 3, y0: 100, y1: 103, name: 'lodge' };
    s.addVolume(v);
    const p = toWorld(v, 0, 0);
    run(st, { x: p.x, z: p.z, run: false }, s, c, 4.5);
    expect(st.pos.z).toBeLessThan(-3);
    expect(st.indoor).toBe('lodge');
  });

  it('slows on steep snow', () => {
    const steep = (x: number) => 100 + Math.max(0, x) * Math.tan(25 * Math.PI / 180);
    const st = createWalker(0.5, steep(0.5), 0, 0), s = new WalkSurfaces(), c = new ColliderGrid();
    run(st, { x: 1, z: 0, run: false }, s, c, 3, (x: number) => steep(x));
    expect(st.speed).toBeLessThan(WALK.walk * 0.6);
    expect(st.speed).toBeGreaterThan(0.05);
  });
});
