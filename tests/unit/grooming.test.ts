import { describe, it, expect } from 'vitest';
import { GroomingField } from '../../client/src/terrain/grooming';

const sample = (field: GroomingField, x: number, z: number) => field.sample(x, z, { across: 0, along: 0 });
const run = (points: number[][], grooming = 'groomed') => ({ kind: 'line', grooming, points });

describe('grooming coordinates', () => {
  it('keeps true meter spacing and follows the run instead of a world axis', () => {
    const f = new GroomingField([run([[0, 2800, 0], [60, 2700, 80]])]);
    const on = sample(f, 30, 40), beside = sample(f, 26, 43);
    expect(on.across).toBeCloseTo(0, 6);
    expect(beside.across).toBeCloseTo(5, 6);
    expect(beside.along).toBeCloseTo(on.along, 6);
  });

  it('retains the same curved corduroy far from the world origin', () => {
    const points = [[0, 2800, 0], [15, 2750, 50], [55, 2700, 100]];
    const a = new GroomingField([run(points)]);
    const b = new GroomingField([run(points.map(([x, y, z]) => [x + 50000, y, z - 30000]))]);
    for (let z = 10; z < 100; z += 11) {
      const local = sample(a, z / 2 + 3, z), far = sample(b, z / 2 + 50003, z - 30000);
      expect(far.across).toBeCloseTo(local.across, 6);
      expect(far.along).toBeCloseTo(local.along, 6);
    }
  });

  it('does not introduce a seam at spatial-index boundaries', () => {
    const f = new GroomingField([run([[0, 2800, 0], [150, 2700, 150]])]);
    const a = sample(f, 64 - 1e-5, 69), b = sample(f, 64 + 1e-5, 69);
    expect(Math.abs(a.across - b.across)).toBeLessThan(0.0001);
    expect(Math.abs(a.along - b.along)).toBeLessThan(0.0001);
  });

  it('ignores ungroomed runs and handles duplicate survey points', () => {
    const f = new GroomingField([run([[0, 0, 0], [0, 0, 0], [0, 0, 40]]), run([[5, 0, 0], [5, 0, 40]], 'moguls')]);
    expect(sample(f, 5, 20).across).toBeCloseTo(-5, 6);
    expect(sample(f, 5, 20).along).toBeCloseTo(20, 6);
  });
});
