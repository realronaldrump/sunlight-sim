// Terrain height tile cache and sampling. Shared by the renderer and the ski physics so that
// "what you see is what you ski": heights are interpolated on the same triangles the mesh uses.
import { decodeTile } from './codec';

export interface LevelInfo { spacing: number; tileSize: number; tiles: [number, number, number, number][] }
export interface TerrainIndex {
  origin: { E: number; N: number; crs: string };
  tileSamples: number;
  tileCells: number;
  levels: Record<string, LevelInfo>;
  hiExtent: [number, number, number, number];
  maxLevel: number;
}

export interface HeightTile {
  level: number; tx: number; tn: number;
  n: number; // samples per side (259)
  r: number; // spacing
  S: number; // tile size in meters
  heights: Float32Array;
  min: number; max: number;
}

export type Loader = (path: string) => Promise<ArrayBuffer>;

export const browserLoader: Loader = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`fetch ${path}: ${res.status}`);
  return res.arrayBuffer();
};

const key = (L: number, tx: number, tn: number) => `${L}/${tx}_${tn}`;

export class Heightfield {
  index!: TerrainIndex;
  private exists = new Map<number, Set<string>>();
  private tiles = new Map<string, HeightTile>();
  private pending = new Map<string, Promise<HeightTile | null>>();
  loadedBytes = 0;
  /** Optional height modifier baked into fine tiles on load (moguls). */
  modifier: ((x: number, n: number) => number) | null = null;
  modifierMaxLevel = 1;

  constructor(private base: string, private loader: Loader = browserLoader) {}

  async init() {
    const buf = await this.loader(`${this.base}/terrain/index.json`);
    this.index = JSON.parse(new TextDecoder().decode(buf));
    for (const [L, info] of Object.entries(this.index.levels)) {
      const s = new Set<string>();
      for (const t of info.tiles) s.add(`${t[0]}_${t[1]}`);
      this.exists.set(Number(L), s);
    }
  }

  get maxLevel() { return this.index.maxLevel; }
  spacing(L: number) { return 2 ** L; }
  tileSize(L: number) { return 256 * 2 ** L; }

  hasTile(L: number, tx: number, tn: number) {
    return this.exists.get(L)?.has(`${tx}_${tn}`) ?? false;
  }
  tileRange(L: number) {
    return this.index.levels[String(L)]?.tiles ?? [];
  }

  getTile(L: number, tx: number, tn: number) {
    return this.tiles.get(key(L, tx, tn));
  }

  ensureTile(L: number, tx: number, tn: number): Promise<HeightTile | null> {
    const k = key(L, tx, tn);
    const t = this.tiles.get(k);
    if (t) return Promise.resolve(t);
    if (!this.hasTile(L, tx, tn)) return Promise.resolve(null);
    let p = this.pending.get(k);
    if (!p) {
      p = (async () => {
        const buf = await this.loader(`${this.base}/terrain/L${L}/${tx}_${tn}.bin.gz`);
        this.loadedBytes += buf.byteLength;
        const d = await decodeTile(buf);
        const tile: HeightTile = { level: L, tx, tn, n: d.n, r: 2 ** L, S: 256 * 2 ** L, heights: d.heights, min: d.min, max: d.max };
        if (this.modifier && L <= this.modifierMaxLevel) {
          const r = tile.r, N = tile.n, H = tile.heights, x0 = tx * tile.S - r, n0 = tn * tile.S - r;
          // coarser level gets damped bumps (it cannot represent 4.6 m waves well)
          const k = L === 0 ? 1 : 0.35;
          for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const dh = this.modifier(x0 + i * r, n0 + j * r) * k;
            if (dh) { H[j * N + i] += dh; }
          }
          tile.max += 0.5;
        }
        this.tiles.set(k, tile);
        this.pending.delete(k);
        return tile;
      })().catch((e) => { this.pending.delete(k); console.warn(e); return null; });
      this.pending.set(k, p);
    }
    return p;
  }

  /** Load the tiles of level L that cover a square of half-size `radius` around (x, n). */
  async ensureArea(L: number, x: number, n: number, radius: number) {
    const S = this.tileSize(L);
    const jobs: Promise<unknown>[] = [];
    for (let tn = Math.floor((n - radius) / S); tn <= Math.floor((n + radius) / S); tn++)
      for (let tx = Math.floor((x - radius) / S); tx <= Math.floor((x + radius) / S); tx++)
        jobs.push(this.ensureTile(L, tx, tn));
    await Promise.all(jobs);
  }

  /** Release tiles of fine levels far from (x, n). */
  evict(x: number, n: number, keepRadius: number, maxLevel = 2) {
    for (const [k, t] of this.tiles) {
      if (t.level > maxLevel) continue;
      const cx = (t.tx + 0.5) * t.S, cn = (t.tn + 0.5) * t.S;
      if (Math.max(Math.abs(cx - x), Math.abs(cn - n)) > keepRadius + t.S) this.tiles.delete(k);
    }
  }

  /** Height from a specific tile at local (x, n) with the mesh's triangle interpolation. */
  static sampleTile(t: HeightTile, x: number, n: number): number {
    const fi = (x - t.tx * t.S) / t.r + 1;
    const fj = (n - t.tn * t.S) / t.r + 1;
    let i = Math.floor(fi), j = Math.floor(fj);
    i = Math.min(Math.max(i, 0), t.n - 2);
    j = Math.min(Math.max(j, 0), t.n - 2);
    const u = Math.min(Math.max(fi - i, 0), 1), v = Math.min(Math.max(fj - j, 0), 1);
    const H = t.heights, N = t.n;
    const h00 = H[j * N + i], h10 = H[j * N + i + 1], h01 = H[(j + 1) * N + i], h11 = H[(j + 1) * N + i + 1];
    // Mesh diagonal goes from (i, j) to (i+1, j+1): triangles (00,10,11) and (00,11,01)
    if (u >= v) return h00 + (h10 - h00) * u + (h11 - h10) * v;
    return h00 + (h11 - h01) * u + (h01 - h00) * v;
  }

  /** Finest loaded level covering (x, n), or -1. */
  bestLevel(x: number, n: number, minLevel = 0): number {
    for (let L = minLevel; L <= this.maxLevel; L++) {
      const S = this.tileSize(L);
      if (this.tiles.has(key(L, Math.floor(x / S), Math.floor(n / S)))) return L;
    }
    return -1;
  }

  /** Height (m, NAVD88) at game local coords (x east, n north). Uses the finest loaded level. */
  heightAtLocal(x: number, n: number, minLevel = 0): number {
    for (let L = minLevel; L <= this.maxLevel; L++) {
      const S = this.tileSize(L);
      const t = this.tiles.get(key(L, Math.floor(x / S), Math.floor(n / S)));
      if (t) return Heightfield.sampleTile(t, x, n);
    }
    return 0;
  }

  /** Height at game coords (x, z) where z = -north. */
  heightAt(x: number, z: number): number {
    return this.heightAtLocal(x, -z);
  }

  /** Smooth surface normal (game axes) from central differences over `d` meters. */
  normalAt(x: number, z: number, d = 1, out = { x: 0, y: 1, z: 0 }) {
    const hL = this.heightAt(x - d, z), hR = this.heightAt(x + d, z);
    const hU = this.heightAt(x, z - d), hD = this.heightAt(x, z + d);
    const nx = (hL - hR) / (2 * d), nz = (hU - hD) / (2 * d);
    const len = Math.hypot(nx, 1, nz);
    out.x = nx / len; out.y = 1 / len; out.z = nz / len;
    return out;
  }

  /** Slope angle in degrees at (x, z). */
  slopeDeg(x: number, z: number, d = 1) {
    const nrm = this.normalAt(x, z, d);
    return (Math.acos(Math.min(1, nrm.y)) * 180) / Math.PI;
  }
}
