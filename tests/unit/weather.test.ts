import { describe, expect, it } from 'vitest';
import { squallsAt, squallIntensity } from '../../client/src/sky/weather';

describe('squalls on the shared clock', () => {
  it('is the same storm for everyone at the same moment, drifting east-northeast', () => {
    const t = 1_800_000_000;
    expect(squallsAt(t)).toEqual(squallsAt(t));
    // follow one squall for ten minutes
    let t0 = t;
    while (!squallsAt(t0).some((s) => s.strength > 0.5)) t0 += 60;
    const a = squallsAt(t0).find((s) => s.strength > 0.5)!;
    const b = squallsAt(t0 + 600).find((s) => s.id === a.id)!;
    expect(b).toBeTruthy();
    const dx = b.x - a.x, dz = b.z - a.z;
    expect(Math.hypot(dx, dz)).toBeCloseTo(11 * 600, -2);
    expect(dx).toBeGreaterThan(0); expect(dz).toBeLessThan(0); // east and north (north is -z)
  });

  it('has clear spells and stormy spells over a day', () => {
    let clear = 0, stormy = 0;
    for (let t = 1_800_000_000; t < 1_800_000_000 + 86400; t += 600) {
      const k = squallIntensity(squallsAt(t), 0, -950); // the base lodge
      if (k === 0) clear++; else if (k > 0.3) stormy++;
    }
    expect(clear).toBeGreaterThan(100);   // most of the day it is not snowing at the lodge
    expect(stormy).toBeGreaterThan(0);    // but squalls do pass over
  });

  it('snows hardest in the heart of a cell and not at all outside it', () => {
    const s = [{ id: 1, x: 0, z: 0, radius: 3000, strength: 1 }];
    expect(squallIntensity(s, 0, 0)).toBe(1);
    expect(squallIntensity(s, 2200, 0)).toBeGreaterThan(0);
    expect(squallIntensity(s, 3100, 0)).toBe(0);
  });
});
