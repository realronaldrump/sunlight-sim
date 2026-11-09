import { describe, expect, it } from 'vitest';
import { coniferGeometry, aspenGeometry, oakGeometry } from '../../client/src/trees/treeAssets';

describe('winter tree geometry', () => {
  it('preserves the measured tree height and ground contact for every species and LOD', () => {
    for (const detail of ['high', 'low'] as const) {
      for (const g of [coniferGeometry(0, detail), coniferGeometry(1, detail), aspenGeometry(detail), oakGeometry(detail)]) {
        g.computeBoundingBox();
        // Angled oak stems can embed their end rings slightly below the root plane.
        expect(g.boundingBox!.min.y).toBeLessThanOrEqual(0.00001);
        expect(g.boundingBox!.min.y).toBeGreaterThan(-0.025);
        expect(g.boundingBox!.max.y).toBeCloseTo(1, 5);
        const n = g.getAttribute('normal');
        for (let i = 0; i < n.count; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
        g.dispose();
      }
    }
  });

  it('keeps conifer boughs inside the lidar crown radius after height/radius normalization', () => {
    for (const kind of [0, 1] as const) {
      const g = coniferGeometry(kind, 'high'), p = g.getAttribute('position');
      let maxRadius = 0;
      for (let i = 0; i < p.count; i++) maxRadius = Math.max(maxRadius, Math.hypot(p.getX(i), p.getZ(i)));
      expect(maxRadius).toBeGreaterThan(0.8);
      expect(maxRadius).toBeLessThan(1.1);
      g.dispose();
    }
  });
});
