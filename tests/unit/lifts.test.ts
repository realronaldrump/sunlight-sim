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
      expect(p.spacing * p.chairCount).toBeCloseTo(p.loopLen, 6);
    }
  });

  it('uses published Sunlight line speeds and installed chair counts', () => {
    const specs = { Primo: [2.286, 115], Segundo: [2.54, 140], Tercero: [1.524, 110] };
    for (const p of paths) {
      const [speed, chairs] = specs[p.def.name as keyof typeof specs];
      expect(p.def.speed).toBeCloseTo(speed, 6);
      expect(p.chairCount).toBe(chairs);
    }
  });

  it('ride time measures loading to unloading along the sagging rope', () => {
    const seg = paths.find((p) => p.def.name === 'Segundo')!;
    expect(seg.rideTime()).toBeCloseTo((seg.unloadU - seg.loadU) / seg.def.speed, 3);
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

  it('catches crossings between render frames and never boards a future chair', () => {
    for (const p of paths) for (const t of [0, 1000.123, 1794188110.7]) {
      const n = p.nextChairAt(p.loadU, t);
      expect(p.crossingChair(n.arrive - 0.35, n.arrive + 0.05)).toBe(n.index);
      expect(p.crossingChair(n.arrive - 0.35, n.arrive - 0.01)).toBeNull();
      expect(p.crossingChair(n.arrive - 10, n.arrive)).toBeNull();
      expect(p.remainingRideTime(n.index, n.arrive)).toBeCloseTo(p.rideTime(), 5);
    }
  });

  it('moves at the rated rope speed with evenly timed chairs on both lines and wheels', () => {
    for (const p of paths) {
      for (const u of [20, p.lineLen / 2, p.lineLen + 3, p.lineLen * 1.5 + 10, p.loopLen - 3]) {
        const t = u / p.def.speed, a = p.loopPoint(p.chairU(0, t)).p, b = p.loopPoint(p.chairU(0, t + 0.01)).p;
        expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.01).toBeCloseTo(p.def.speed, 2);
      }
    }
  });

  it('load zone contains the load point and excludes the downhill rope', () => {
    for (const p of paths) {
      const lp = p.loadPoint();
      expect(p.inLoadZone(lp.x - p.ax * 1, lp.z - p.az * 1)).toBe(true);
      const down = p.ropePoint(LOAD_OFFSET, -1);
      expect(p.inLoadZone(down.x, down.z)).toBe(false);
    }
  });

  it('raises the restraint before unloading and lowers it only after leaving the load area', () => {
    for (const p of paths) {
      expect(p.restraintAngle(LOAD_OFFSET, true)).toBeGreaterThan(1.4);
      expect(p.restraintAngle(p.horiz / 2, true)).toBe(0);
      expect(p.restraintAngle(p.horiz - 6.5, true)).toBeGreaterThan(1.4);
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
