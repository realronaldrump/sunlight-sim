/** Stable meter-scale coordinates following groomed run centerlines.
 * Signed lateral distance avoids dot(worldPosition, varyingDirection), whose derivative grows
 * with distance from the origin and destroys fine corduroy. This only affects shading.
 */
export interface GroomingRun { kind: string; grooming: string; points: number[][] }
interface Point { x: number; z: number }
interface Segment { a: Point; dx: number; dz: number; length: number; along: number }

const CELL = 64;
const REACH = 100;

export class GroomingField {
  private cells = new Map<string, Segment[]>();

  constructor(runs: GroomingRun[]) {
    for (const run of runs) {
      if (run.kind !== 'line' || !['groomed', 'mixed'].includes(run.grooming)) continue;
      const raw = run.points.filter((p) => p.length >= 3 && p.every(Number.isFinite));
      if (raw.length < 2) continue;
      // A small, consistent resampling interval makes smoothing independent of OSM point density.
      const samples: Point[] = [];
      for (let i = 1; i < raw.length; i++) {
        const a = raw[i - 1], b = raw[i], length = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const steps = Math.max(1, Math.ceil(length / 6));
        for (let j = 0; j < steps; j++) {
          const t = j / steps;
          samples.push({ x: a[0] + (b[0] - a[0]) * t, z: a[2] + (b[2] - a[2]) * t });
        }
      }
      samples.push({ x: raw.at(-1)![0], z: raw.at(-1)![2] });
      const points = samples.map((p, i) => {
        if (i === 0 || i === samples.length - 1) return p;
        let x = 0, z = 0, total = 0;
        for (let j = -2; j <= 2; j++) {
          const q = samples[Math.max(0, Math.min(samples.length - 1, i + j))], weight = 3 - Math.abs(j);
          x += q.x * weight; z += q.z * weight; total += weight;
        }
        return { x: x / total, z: z / total };
      });
      let along = 0;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length < 0.001) continue;
        const seg = { a, dx: (b.x - a.x) / length, dz: (b.z - a.z) / length, length, along };
        along += length;
        for (let cx = Math.floor((Math.min(a.x, b.x) - REACH) / CELL); cx <= Math.floor((Math.max(a.x, b.x) + REACH) / CELL); cx++) {
          for (let cz = Math.floor((Math.min(a.z, b.z) - REACH) / CELL); cz <= Math.floor((Math.max(a.z, b.z) + REACH) / CELL); cz++) {
            const key = `${cx}/${cz}`, cell = this.cells.get(key);
            if (cell) cell.push(seg); else this.cells.set(key, [seg]);
          }
        }
      }
    }
  }

  sample(x: number, z: number, out: { across: number; along: number }) {
    const candidates = this.cells.get(`${Math.floor(x / CELL)}/${Math.floor(z / CELL)}`);
    let best = REACH * REACH;
    out.across = x; out.along = z;
    for (const s of candidates ?? []) {
      const dx = x - s.a.x, dz = z - s.a.z;
      const t = Math.max(0, Math.min(s.length, dx * s.dx + dz * s.dz));
      const ex = dx - s.dx * t, ez = dz - s.dz * t;
      const d2 = ex * ex + ez * ez;
      if (d2 >= best) continue;
      best = d2;
      // Signed distance, continuous through each polyline vertex on either side of the run.
      out.across = Math.sqrt(d2) * (dx * -s.dz + dz * s.dx < 0 ? -1 : 1);
      out.along = s.along + t;
    }
    return out;
  }
}
