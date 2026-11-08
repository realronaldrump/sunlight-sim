import { describe, it, expect, beforeAll } from 'vitest';
import { loadWorld, makeProbe } from '../harness/world';
import { simulateRun } from '../harness/runBots';
import { createSkier, stepSkier, collideCylinder, getUp, TerrainProbe, SkiInput } from '../../shared/skiPhysics';

let world: Awaited<ReturnType<typeof loadWorld>>;
beforeAll(async () => { world = await loadWorld(); });

const none: SkiInput = { steer: 0, tuck: false, plow: 0, stop: false, push: false };

// synthetic planar slope
function plane(deg: number): TerrainProbe {
  const t = Math.tan((deg * Math.PI) / 180);
  const len = Math.hypot(t, 1);
  return {
    height: (_x, z) => z * t, // downhill toward -z (north)
    normal: (_x, _z, out) => { out.x = 0; out.y = 1 / len; out.z = -t / len; return out; },
    surface: () => ({ groomed: 1, piste: 1, moguls: 0 }),
  };
}

describe('ski physics', () => {
  it('stands still on flat snow', () => {
    const p = plane(0);
    const st = createSkier({ x: 0, y: 0, z: 0 });
    for (let i = 0; i < 300; i++) stepSkier(st, none, p, 1 / 60);
    expect(st.speed).toBeLessThan(0.05);
  });

  it('skis across the fall line do not slide on a green slope', () => {
    const p = plane(10);
    const st = createSkier({ x: 0, y: 0, z: 0 }, Math.PI / 2); // facing west, slope falls north
    for (let i = 0; i < 300; i++) stepSkier(st, none, p, 1 / 60);
    expect(st.speed).toBeLessThan(0.3);
  });

  it('accelerates down the fall line and reaches a sensible terminal speed', () => {
    const p = plane(12);
    const st = createSkier({ x: 0, y: 0, z: 0 }, 0); // facing north = downhill
    for (let i = 0; i < 60 * 120; i++) stepSkier(st, none, p, 1 / 60);
    const kmh = st.speed * 3.6;
    expect(kmh).toBeGreaterThan(60);
    expect(kmh).toBeLessThan(130);
  });

  it('a tuck is faster than standing tall', () => {
    const p = plane(15);
    const a = createSkier({ x: 0, y: 0, z: 0 }, 0), b = createSkier({ x: 0, y: 0, z: 0 }, 0);
    for (let i = 0; i < 60 * 30; i++) { stepSkier(a, none, p, 1 / 60); stepSkier(b, { ...none, tuck: true }, p, 1 / 60); }
    expect(b.speed).toBeGreaterThan(a.speed * 1.1);
  });

  it('a snowplow stops a skier on a green slope but not on a steep black', () => {
    for (const [deg, stops] of [[9, true], [28, false]] as const) {
      const p = plane(deg);
      const st = createSkier({ x: 0, y: 0, z: 0 }, 0);
      st.vel = { x: 0, y: 0, z: -5 };
      for (let i = 0; i < 60 * 20; i++) stepSkier(st, { ...none, plow: 1 }, p, 1 / 60);
      expect(st.speed < 0.5).toBe(stops);
    }
  });

  it('turning comes from edging: heading changes gradually, not instantly', () => {
    const p = plane(12);
    const st = createSkier({ x: 0, y: 0, z: 0 }, 0);
    st.vel = { x: 0, y: 0, z: -10 };
    stepSkier(st, { ...none, steer: 1 }, p, 1 / 60);
    const h1 = st.heading;
    expect(Math.abs(h1)).toBeLessThan(0.05);
    for (let i = 0; i < 60; i++) stepSkier(st, { ...none, steer: 1 }, p, 1 / 60);
    expect(st.heading).toBeLessThan(-0.3); // turned right
  });

  it('hitting a tree at speed causes a fall, and the skier can get up', () => {
    const st = createSkier({ x: 0, y: 0, z: 0 }, 0);
    st.vel = { x: 0, y: 0, z: -8 };
    st.pos.z = 0.5;
    collideCylinder(st, 0, 0, 0.3);
    expect(st.mode).toBe('fallen');
    st.vel = { x: 0, y: 0, z: 0 }; st.speed = 0;
    expect(getUp(st)).toBe(true);
    const p = plane(5);
    for (let i = 0; i < 60 * 3; i++) stepSkier(st, none, p, 1 / 60);
    expect(st.mode === 'standing' || st.mode === 'skiing').toBe(true);
  });

  it('cautious beginner bot stays within 10-25 km/h on Midway (real terrain)', async () => {
    const r = await simulateRun(world, 'Midway', 'beginner');
    expect(r.finished).toBe(true);
    expect(r.avgKmh).toBeGreaterThan(10);
    expect(r.avgKmh).toBeLessThan(25);
    expect(r.falls).toBe(0);
  });

  it('intermediate bot finishes Sun King faster than the beginner', async () => {
    const b = await simulateRun(world, 'Sun King', 'beginner');
    const i = await simulateRun(world, 'Sun King', 'intermediate');
    expect(i.finished && b.finished).toBe(true);
    expect(i.time).toBeLessThan(b.time);
  });

  it('terrain probe uses the same heights the renderer meshes', async () => {
    const probe = makeProbe(world.hf, world.surface);
    await world.hf.ensureArea(0, 10, 300, 20);
    const t = world.hf.getTile(0, 0, 1)!;
    // a vertex of the mesh is exactly a DEM sample
    const h = probe.height(10, -300);
    const i = 10 - t.tx * 256 + 1, j = 300 - t.tn * 256 + 1;
    expect(Math.abs(h - t.heights[j * 259 + i])).toBeLessThan(1e-3);
  });
});
