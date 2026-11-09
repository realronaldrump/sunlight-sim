// Maintained winter snow pads over the measured bare-earth DEM. Their triangle grid is
// shared by drawing and skiing; the underlying terrain is never flattened or rewritten.
import { GAUGE, LiftPath, LOAD_OFFSET, UNLOAD_OFFSET } from './lifts';
import type { TerrainProbe, Vec3 } from './skiPhysics';

const smooth = (v: number) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };

export class StationRamp {
  readonly step = 0.5;
  readonly start: number;
  readonly end: number;
  readonly halfWidth = 5;
  readonly rows: number;
  readonly cols = 21;
  readonly heights: number[] = [];
  readonly positions: number[] = [];
  readonly indices: number[] = [];

  constructor(readonly path: LiftPath, readonly top: boolean, ground: (x: number, z: number) => number) {
    const line = top ? path.horiz - UNLOAD_OFFSET : LOAD_OFFSET;
    this.start = line - (top ? 18 : 16);
    this.end = line + (top ? 30 : 14);
    this.rows = Math.round((this.end - this.start) / this.step) + 1;
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.cols; j++) {
      const h = this.start + i * this.step, across = -this.halfWidth + j * this.step;
      const p = path.ropePoint(h, 1);
      const x = p.x + path.rx * across, z = p.z + path.rz * across;
      const base = ground(x, z);
      const width = path.def.seats * 0.3 + 0.5;
      const lateral = 1 - smooth((Math.abs(across) - width) / (this.halfWidth - width));
      const longitudinal = smooth((h - this.start) / (line - 2 - this.start)) * (1 - smooth((h - line - 2) / (this.end - line - 2)));
      // Follow the gently descending rope at unload, then continue down an exit ramp.
      const target = top && h > line ? path.stationHeight(true) - (h - line) * 0.08 : path.stationHeight(top, h);
      const y = base + Math.max(0, target - base) * lateral * longitudinal + 0.015;
      this.heights.push(y); this.positions.push(x, y, z);
      if (i < this.rows - 1 && j < this.cols - 1) {
        const a = i * this.cols + j, b = a + 1, c = a + this.cols, d = c + 1;
        this.indices.push(a, b, c, b, d, c);
      }
    }
  }

  height(x: number, z: number): number | null {
    const p = this.path, dx = x - p.def.bottom[0], dz = z - p.def.bottom[2];
    const u = (dx * p.ax + dz * p.az - this.start) / this.step;
    const v = (dx * p.rx + dz * p.rz - GAUGE / 2 + this.halfWidth) / this.step;
    if (u < 0 || v < 0 || u >= this.rows - 1 || v >= this.cols - 1) return null;
    const i = Math.floor(u), j = Math.floor(v), a = i * this.cols + j;
    const f = u - i, g = v - j, H = this.heights;
    // Same diagonal and barycentric interpolation as the rendered triangles.
    return f + g <= 1
      ? H[a] + (H[a + this.cols] - H[a]) * f + (H[a + 1] - H[a]) * g
      : H[a + this.cols + 1] + (H[a + 1] - H[a + this.cols + 1]) * (1 - f) + (H[a + this.cols] - H[a + this.cols + 1]) * (1 - g);
  }
}

export class LiftStations {
  readonly ramps: StationRamp[];
  constructor(paths: LiftPath[], readonly terrain: TerrainProbe) {
    this.ramps = paths.flatMap(p => [new StationRamp(p, false, terrain.height), new StationRamp(p, true, terrain.height)]);
  }
  height = (x: number, z: number) => {
    let y = this.terrain.height(x, z);
    for (const ramp of this.ramps) y = Math.max(y, ramp.height(x, z) ?? -Infinity);
    return y;
  };
  normal = (x: number, z: number, out: Vec3): Vec3 => {
    if (!this.ramps.some(r => r.height(x, z) !== null)) return this.terrain.normal(x, z, out);
    const e = 0.1;
    out.x = (this.height(x - e, z) - this.height(x + e, z)) / (2 * e);
    out.y = 1;
    out.z = (this.height(x, z - e) - this.height(x, z + e)) / (2 * e);
    const length = Math.hypot(out.x, out.y, out.z);
    out.x /= length; out.y /= length; out.z /= length;
    return out;
  };
  surface = (x: number, z: number) => this.ramps.some(r => r.height(x, z) !== null)
    ? { groomed: 1, piste: 1, moguls: 0 } : this.terrain.surface(x, z);
}
