import { describe, it, expect, beforeAll } from 'vitest';
import { loadWorld } from '../harness/world';
import { LiftPath, LOAD_OFFSET } from '../../shared/lifts';

let paths: LiftPath[];
let world: Awaited<ReturnType<typeof loadWorld>>;
beforeAll(async () => { world = await loadWorld(); paths = world.resort.lifts.map((d: any) => new LiftPath(d)); });

describe('lifts', () => {
  it('has the three Sunlight chairlifts with specs', () => {
    expect(paths.map((p) => p.def.name).sort()).toEqual(['Primo', 'Segundo', 'Tercero']);
    const primo = paths.find((p) => p.def.name === 'Primo')!;
    expect(primo.def.seats).toBe(4);
    expect(primo.def.supports.filter((s) => s.kind === 'tower').length).toBeGreaterThan(10);
    // Primo ~5,060 ft per liftblog (old alignment); OSM line gives ~1.6 km
    expect(primo.lineLen).toBeGreaterThan(1450);
    expect(primo.lineLen).toBeLessThan(1750);
  });

  it('chair loop is continuous and chairs are evenly spaced', () => {
    for (const p of paths) {
      let prev = p.loopPoint(0).p; const step = 0.5;
      prev = { ...prev };
      for (let u = step; u < p.loopLen; u += step) {
        const q = p.loopPoint(u).p;
        expect(Math.hypot(q.x - prev.x, q.y - prev.y, q.z - prev.z)).toBeLessThan(step * 2.2);
        prev = { ...q };
      }
      expect(Math.abs(p.spacing - p.def.chairSpacing)).toBeLessThan(1.5);
    }
  });

  it('ride time equals rope length over speed', () => {
    const seg = paths.find((p) => p.def.name === 'Segundo')!;
    expect(seg.rideTime()).toBeCloseTo(seg.lineLen / seg.def.speed, 3);
    expect(seg.rideTime() / 60).toBeGreaterThan(8);
    expect(seg.rideTime() / 60).toBeLessThan(13);
  });

  it('next chair arrives at the load line within one chair interval', () => {
    const p = paths[0];
    const t = 1000.123;
    const n = p.nextChairAt(p.loadU, t);
    expect(n.arrive - t).toBeLessThanOrEqual(p.spacing / p.def.speed + 1e-6);
    expect(Math.abs(p.chairU(n.index, n.arrive) - p.loadU)).toBeLessThan(1e-3);
  });

  it('load zone contains the load point and excludes the downhill rope', () => {
    for (const p of paths) {
      const lp = p.loadPoint();
      expect(p.inLoadZone(lp.x - p.ax * 1, lp.z - p.az * 1)).toBe(true);
      const down = p.ropePoint(LOAD_OFFSET, -1);
      expect(p.inLoadZone(down.x, down.z)).toBe(false);
    }
  });

  it('the rope keeps riders clear of the ground between towers', async () => {
    for (const p of paths) {
      await world.hf.ensureArea(0, (p.def.bottom[0] + p.def.top[0]) / 2, -(p.def.bottom[2] + p.def.top[2]) / 2, p.horiz / 2 + 100);
      for (let h = 50; h < p.horiz - 50; h += 5) {
        const r = p.ropePoint(h, 1);
        const g = world.hf.heightAt(r.x, r.z);
        expect(r.y - 3.4 - g).toBeGreaterThan(1.5); // seat above snow
      }
    }
  });
});
