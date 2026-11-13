import { describe, expect, it } from 'vitest';
import { coniferGeometry, aspenGeometry, oakGeometry } from '../../client/src/trees/treeAssets';
import { bakeImpostorAtlas, modelRadius, solidSampler } from '../../client/src/trees/impostor';
import { ASPEN_CLUMPS, CONIFER_VARIANTS, aspenClumpIndex, coniferBoughs } from '../../shared/treeData';

describe('winter tree geometry', () => {
  it('keeps repeating bark UVs out of the transparent twig atlas', () => {
    for (let v = 0; v < ASPEN_CLUMPS.length; v++) {
      const g = aspenGeometry('high', v), uv = g.getAttribute('uv');
      const twigs = g.groups[1];
      for (let i = twigs.start; i < twigs.start + twigs.count; i++) {
        expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getY(i)).toBeLessThanOrEqual(1);
      }
      g.dispose();
    }
  });
  it('preserves the measured tree height and ground contact for every species and LOD', () => {
    for (const detail of ['high', 'low'] as const) {
      const forms = [0, 1, 2, 3].flatMap(v => [coniferGeometry(0, detail, v), coniferGeometry(1, detail, v)]);
      const clumps = ASPEN_CLUMPS.map((_, v) => aspenGeometry(detail, v));
      for (const g of [...forms, ...clumps, oakGeometry(detail), oakGeometry(detail, 1)]) {
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
    for (const kind of [0, 1] as const) for (let v = 0; v < CONIFER_VARIANTS; v++) {
      const g = coniferGeometry(kind, 'high', v), p = g.getAttribute('position');
      let maxRadius = 0;
      for (let i = 0; i < p.count; i++) maxRadius = Math.max(maxRadius, Math.hypot(p.getX(i), p.getZ(i)));
      expect(maxRadius).toBeGreaterThan(0.8);
      expect(maxRadius).toBeLessThan(1.1);
      g.dispose();
    }
  });

  it('gives each species several distinct growth forms and keeps the light model inside the full one', () => {
    for (const kind of [0, 1] as const) {
      const forms = Array.from({ length: CONIFER_VARIANTS }, (_, v) => coniferBoughs(kind, 'high', v));
      const signature = forms.map(f => `${f.length}:${f.filter(b => b.dead).length}:${f[f.length - 1].level.toFixed(2)}`);
      expect(new Set(signature).size).toBe(CONIFER_VARIANTS);
      forms.forEach((full, v) => {
        // boughs are listed from the ground up, which the ornament planner relies on
        const live = full.filter(b => !b.dead);
        for (let i = 1; i < live.length; i++) expect(live[i].level).toBeGreaterThan(live[i - 1].level - 0.6);
        for (const b of coniferBoughs(kind, 'low', v)) expect(full).toContainEqual(b);
      });
    }
    expect(new Set(ASPEN_CLUMPS.map(c => c.length)).size).toBeGreaterThan(2);
    expect(new Set(Array.from({ length: 256 }, (_, seed) => aspenClumpIndex(seed))).size).toBe(ASPEN_CLUMPS.length);
  });

  it('bakes far-tree impostors from the detailed model in two views', () => {
    const geometry = coniferGeometry(0, 'high', 2);
    const { albedo, normal, width, height } = bakeImpostorAtlas([{ geometry, samplers: [solidSampler], halfWidth: modelRadius(geometry) * 1.06 }], 64, 128, 1);
    expect([width, height]).toEqual([64, 256]);
    const covered = (view: number, y0: number, y1: number) => {
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = 0; x < 64; x++) if (albedo[((view * 128 + y) * 64 + x) * 4 + 3] > 127) n++;
      return n / ((y1 - y0) * 64);
    };
    for (const view of [0, 1]) {
      // rows run up from the base: bare trunk low, a wide skirt above it, a narrow top, empty headroom
      expect(covered(view, 4, 24)).toBeLessThan(0.3);
      expect(covered(view, 40, 70)).toBeGreaterThan(0.45);
      expect(covered(view, 100, 120)).toBeLessThan(covered(view, 40, 70) * 0.6);
      expect(covered(view, 125, 128)).toBe(0);
    }
    // the two views are different sides of the same asymmetric tree
    let differing = 0;
    for (let i = 3; i < 64 * 128 * 4; i += 4) if ((albedo[i] > 127) !== (albedo[i + 64 * 128 * 4] > 127)) differing++;
    expect(differing).toBeGreaterThan(200);
    // stored normals are unit length and mostly face the direction each view was baked from
    let facing = 0, total = 0;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
      const at = (y * 64 + x) * 4;
      if (albedo[at + 3] < 128) continue;
      const n = [0, 1, 2].map(c => normal[at + c] / 127.5 - 1);
      expect(Math.hypot(n[0], n[1], n[2])).toBeGreaterThan(0.9);
      total++; if (n[2] > -0.2) facing++;
    }
    expect(facing / total).toBeGreaterThan(0.7);
    geometry.dispose();
  });
});
