// @ts-nocheck -- TSL node graphs: @types/three node typings are too strict to be useful here.
// Shadows of the mountains themselves. The cascaded shadow maps only reach a few hundred metres, so
// without this the ridge south of the resort never shades the base at 3 PM and Mount Sopris never keeps
// the last light while the valley goes blue. For the sun's current compass direction every cell of a
// coarse map stores how high the terrain horizon stands in that direction (as a tangent); the sunlight
// then reaches a surface only while the sun is above its horizon. Heights come from the same lidar and
// 3DEP terrain tiles that are drawn (128 m level), so the shadows fall where the real ones do.
import * as THREE from 'three/webgpu';
import { uniform, float, vec2, texture, positionWorld, smoothstep, step, mix } from 'three/tsl';
import { EARTH_R_EFF } from '../../../shared/world';
import type { Heightfield } from '../terrain/heightfield';

/** Height grid sample spacing (terrain level 7). */
export const CELL = 128;
/** Occluders nearer than this are left to the cascaded shadow maps and surface shading. */
export const NEAR = 450;
const FAR = 34000;
/** The viewer's own bump on a coarse grid must not shade it. */
const LIFT = 14;

export interface HeightGrid { data: Float32Array; n: number; x0: number; z0: number }

// march distances: every cell near the viewer, stretching with distance
const STEPS: number[] = [];
for (let d = NEAR; d < FAR; d += Math.max(CELL, d * 0.11)) STEPS.push(d);
const DROP = STEPS.map((d) => d * d / (2 * EARTH_R_EFF));

/** Tangent of the terrain horizon above each map cell, looking toward (dirX, dirZ) (unit, game x/z). */
export function horizonTangents(grid: HeightGrid, map: { n: number; x0: number; z0: number; cell: number }, dirX: number, dirZ: number,
  out: Float32Array, rowFrom = 0, rowTo = map.n) {
  const { data, n } = grid, last = n - 1, S = STEPS.length;
  const ox = new Float64Array(S), oz = new Float64Array(S), inv = new Float64Array(S);
  for (let s = 0; s < S; s++) { ox[s] = dirX * STEPS[s] / CELL; oz[s] = dirZ * STEPS[s] / CELL; inv[s] = 1 / STEPS[s]; }
  const gx0 = (map.x0 - grid.x0) / CELL, gz0 = (map.z0 - grid.z0) / CELL, gs = map.cell / CELL;
  for (let j = rowFrom; j < rowTo; j++) {
    const gz = gz0 + (j + 0.5) * gs;
    for (let i = 0; i < map.n; i++) {
      const gx = gx0 + (i + 0.5) * gs;
      // the surface here, interpolated; the horizon samples can take the nearest grid height
      const cx = Math.min(Math.max(gx, 0), last - 0.001), cz = Math.min(Math.max(gz, 0), last - 0.001);
      const i0 = cx | 0, j0 = cz | 0, u = cx - i0, v = cz - j0, k = j0 * n + i0;
      const a = data[k], b = data[k + 1], c = data[k + n], d = data[k + n + 1];
      const h0 = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v + LIFT;
      let best = -0.25;
      for (let s = 0; s < S; s++) {
        let fx = gx + ox[s] + 0.5, fz = gz + oz[s] + 0.5;
        fx = fx < 0 ? 0 : fx > last ? last : fx; fz = fz < 0 ? 0 : fz > last ? last : fz;
        const t = (data[(fz | 0) * n + (fx | 0)] - DROP[s] - h0) * inv[s];
        if (t > best) best = t;
      }
      out[j * map.n + i] = best;
    }
  }
  return out;
}

export class MountainShadow {
  /** Shadow map cells per side and their size (m): 49 km square around the resort and Mount Sopris. */
  readonly n = 384;
  readonly cell = CELL;
  readonly x0: number; readonly z0: number;
  grid: HeightGrid | null = null;
  private tex: THREE.DataTexture;
  private tanSun = uniform(0.5);
  private flat = uniform(1);
  private strength = uniform(0);
  private work: Float32Array;
  private job: { dirX: number; dirZ: number; row: number; azimuth: number } | null = null;
  private wanted: number | null = null;
  private current: number | null = null;
  /** Sunlight reaching a surface past the surrounding mountains, 0..1. */
  readonly visibility;

  constructor(centerX = 3000, centerZ = 3000) {
    const half = this.n * this.cell / 2;
    this.x0 = Math.round((centerX - half) / CELL) * CELL; this.z0 = Math.round((centerZ - half) / CELL) * CELL;
    this.work = new Float32Array(this.n * this.n);
    const t = this.tex = new THREE.DataTexture(new Uint16Array(this.n * this.n).fill(THREE.DataUtils.toHalfFloat(-0.25)), this.n, this.n, THREE.RedFormat, THREE.HalfFloatType);
    t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; t.name = 'mountain horizon';
    const size = this.n * this.cell;
    const uv = positionWorld.xz.sub(vec2(this.x0, this.z0)).div(size);
    const inside = step(0.0, uv.x).mul(step(uv.x, 1.0)).mul(step(0.0, uv.y)).mul(step(uv.y, 1.0));
    const tanH = texture(this.tex, uv).level(0).r;
    // the sun is half a degree across: a soft edge of about that much
    const seen = smoothstep(tanH.sub(0.007), tanH.add(0.007), this.tanSun);
    this.visibility = mix(float(1), mix(this.flat, seen, inside), this.strength);
  }

  /** Copy the 128 m terrain around the map into one flat grid (once, after the far terrain has loaded). */
  async init(hf: Heightfield) {
    const L = 7, S = hf.tileSize(L), margin = 16000;
    const n = this.n + Math.round(2 * margin / CELL), x0 = this.x0 - margin, z0 = this.z0 - margin;
    // grid row j is game z = z0 + j * CELL, i.e. north = -(z0 + j * CELL)
    const cx = x0 + n * CELL / 2, cz = z0 + n * CELL / 2;
    await hf.ensureArea(L, cx, -cz, n * CELL / 2 + CELL);
    const data = new Float32Array(n * n);
    let filled = 0;
    for (let j = 0; j < n; j++) {
      const north = -(z0 + j * CELL), tn = Math.floor(north / S);
      for (let i = 0; i < n; i++) {
        const x = x0 + i * CELL, tx = Math.floor(x / S), tile = hf.getTile(L, tx, tn);
        if (!tile) continue;
        data[j * n + i] = tile.heights[(Math.round((north - tn * S) / tile.r) + 1) * tile.n + Math.round((x - tx * S) / tile.r) + 1];
        filled++;
      }
    }
    if (filled < n * n * 0.6) return false;
    this.grid = { data, n, x0, z0 };
    if (this.wanted !== null) { const w = this.wanted; this.current = null; this.setSun(w, this.elevation, this.use); }
    return true;
  }

  private elevation = 30;
  private use = 1;

  /** Follow the sun. `use` 0..1 switches the mountain shadows off for moonlight. */
  setSun(azimuthDeg: number, elevationDeg: number, use = 1) {
    this.elevation = elevationDeg; this.use = use;
    this.tanSun.value = Math.tan(Math.max(-8, Math.min(80, elevationDeg)) * Math.PI / 180);
    // away from the map, flat ground: the sun's disc crossing a level horizon
    this.flat.value = THREE.MathUtils.smoothstep(elevationDeg, -0.9, 0.3);
    this.strength.value = this.grid ? use : 0;
    this.wanted = azimuthDeg;
    if (!this.grid || use <= 0) return;
    const last = this.job?.azimuth ?? this.current;
    if (last !== null && Math.abs(azimuthDeg - last) < 0.6) return;
    const a = azimuthDeg * Math.PI / 180;
    this.job = { dirX: Math.sin(a), dirZ: -Math.cos(a), row: 0, azimuth: azimuthDeg };
  }

  /** Work off the pending horizon map a few milliseconds at a time, then switch to it. */
  update(_dt: number, budgetMs = 3) {
    const job = this.job;
    if (!job || !this.grid) return;
    const map = { n: this.n, x0: this.x0, z0: this.z0, cell: this.cell };
    // the first map may take a little longer per frame: until it is ready no mountain casts a shadow
    const first = this.current === null, t0 = performance.now(), budget = first ? 12 : budgetMs;
    while (job.row < this.n && performance.now() - t0 < budget) {
      horizonTangents(this.grid, map, job.dirX, job.dirZ, this.work, job.row, Math.min(this.n, job.row + 16));
      job.row += 16;
    }
    if (job.row < this.n) return;
    // the sun moves well under a degree between maps, so the new one can simply replace the old
    const px = this.tex.image.data as Uint16Array;
    for (let i = 0; i < px.length; i++) px[i] = THREE.DataUtils.toHalfFloat(Math.max(-0.25, Math.min(4, this.work[i])));
    this.tex.needsUpdate = true;
    this.current = job.azimuth; this.job = null;
  }

  /** Test hook: is (x, z) in a mountain's shadow for the map now in use? */
  shadedAt(x: number, z: number) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    if (!this.grid || this.current === null || i < 0 || j < 0 || i >= this.n || j >= this.n) return false;
    return THREE.DataUtils.fromHalfFloat((this.tex.image.data as Uint16Array)[j * this.n + i]) > this.tanSun.value;
  }
}
