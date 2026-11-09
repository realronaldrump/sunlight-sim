import { describe, it, expect } from 'vitest';
import { buildChairModel } from '../../client/src/lifts/chairModel';
import { HANGER } from '../../shared/lifts';

describe('chair carrier geometry', () => {
  for (const [name, seats] of [['Primo', 4], ['Segundo', 3], ['Tercero', 3]] as const) {
    it(`${name} keeps both detail levels finite, at human scale, with the same seat surface`, () => {
      const counts: number[] = [];
      for (const detailed of [true, false]) {
        const parts = buildChairModel(name, seats, detailed);
        counts.push(parts.reduce((n, p) => n + p.geometry.attributes.position.count, 0));
        const cushion = parts.find(p => p.motion === 'body' && p.finish === 'vinyl')!;
        const g = cushion.geometry, vertices = g.attributes.position;
        let seatTop = -Infinity;
        for (let i = 0; i < vertices.count; i++) {
          const y = vertices.getY(i);
          if (y < -HANGER + .1 && vertices.getZ(i) < .2) seatTop = Math.max(seatTop, y);
        }
        expect(seatTop).toBeCloseTo(-HANGER + .035, 4);
        for (const part of parts) {
          const box = part.geometry.boundingBox!;
          expect(box.min.y).toBeGreaterThan(-3.3);
          expect(box.max.y).toBeLessThan(.2);
          expect(Math.max(Math.abs(box.min.x), Math.abs(box.max.x))).toBeLessThan(seats * .3 + .15);
          for (const attr of ['position', 'normal']) expect([...part.geometry.attributes[attr].array].every(Number.isFinite)).toBe(true);
          part.geometry.dispose();
        }
        expect(parts.some(p => p.motion === 'restraint')).toBe(name !== 'Tercero');
      }
      expect(counts[1]).toBeLessThan(counts[0] * .65);
    });
  }
});
