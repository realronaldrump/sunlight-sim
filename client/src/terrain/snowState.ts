// What the snow remembers. A 2 m grid over the ski area holds:
//   R  traffic wear deposited by every skier (the player, friends, the lesson, other guests)
//   G  "groomed tonight": a snowcat's tiller passed here, restoring corduroy
//   B  how busy this spot is on a normal day (baked from run centrelines, lift loading areas)
// The terrain shader turns wear into scraped, glossier hardpack with fading corduroy; fresh snow
// covers wear and tracks; physics reads the same wear as firmer, slicker snow. The dynamic channels
// are saved in the browser so the next visit shows what happened (or was groomed or snowed) since.
import * as THREE from 'three/webgpu';
import type { RunInfo } from '../game';

export const SNOW_KEY = 'sunlight.snow.v1';
const RES = 2;
const POPULARITY: Record<string, number> = { green: 1, blue: 0.95, black: 0.6, double: 0.35, park: 0.7 };

export interface SavedSnow { v: 1; t: number; day: number; w: number; h: number; wear: string; groomed: string; fresh: number; tracks?: string; crowd?: string }

export class SnowState {
  readonly x0: number; readonly n0: number; readonly w: number; readonly h: number;
  readonly data: Uint8Array;
  readonly texture: THREE.DataTexture;
  /** Inches of new snow since the corduroy was last laid. */
  freshInches = 0;
  private dirty = false;
  private uploadTimer = 0;

  constructor(runs: RunInfo[], lifts: { bottom: number[]; top: number[] }[]) {
    let x0 = Infinity, x1 = -Infinity, n0 = Infinity, n1 = -Infinity;
    for (const r of runs) for (const p of r.points) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); n0 = Math.min(n0, -p[2]); n1 = Math.max(n1, -p[2]); }
    x0 = Math.floor(x0 - 120); n0 = Math.floor(n0 - 120); x1 += 120; n1 += 120;
    this.x0 = x0; this.n0 = n0;
    this.w = Math.ceil((x1 - x0) / RES); this.h = Math.ceil((n1 - n0) / RES);
    this.data = new Uint8Array(this.w * this.h * 4);
    for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255;
    this.bakePopularity(runs, lifts);
    this.texture = new THREE.DataTexture(this.data, this.w, this.h, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter; this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false; this.texture.flipY = false;
    this.texture.needsUpdate = true;
  }

  get sizeX() { return this.w * RES; }
  get sizeN() { return this.h * RES; }
  /** 0..1 of the corduroy and wear hidden under new snow. */
  get freshCover() { return 1 - Math.exp(-this.freshInches / 3); }

  private cell(x: number, z: number) {
    const i = Math.floor((x - this.x0) / RES), j = Math.floor((-z - this.n0) / RES);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i;
  }

  /** Normal-day traffic: the middle of each run's main line, strongest on groomed greens and blues and at lift mazes. */
  private bakePopularity(runs: RunInfo[], lifts: { bottom: number[]; top: number[] }[]) {
    const stamp = (x: number, z: number, weight: number, sigma: number) => {
      const R = Math.ceil(sigma * 2.4 / RES);
      const ci = Math.floor((x - this.x0) / RES), cj = Math.floor((-z - this.n0) / RES);
      for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
        if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
        const dx = this.x0 + (i + 0.5) * RES - x, dn = this.n0 + (j + 0.5) * RES + z;
        const v = Math.round(255 * weight * Math.exp(-(dx * dx + dn * dn) / (2 * sigma * sigma)));
        const k = (j * this.w + i) * 4 + 2;
        if (v > this.data[k]) this.data[k] = v;
      }
    };
    for (const r of runs) {
      if (r.kind !== 'line') continue;
      const weight = (POPULARITY[r.difficulty] ?? 0) * (r.grooming === 'groomed' ? 1 : 0.7);
      if (!weight) continue;
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1], b = r.points[i], L = Math.hypot(b[0] - a[0], b[2] - a[2]);
        for (let s = 0; s < L; s += 2) stamp(a[0] + (b[0] - a[0]) * s / L, a[2] + (b[2] - a[2]) * s / L, weight, 5);
      }
    }
    for (const l of lifts) for (const p of [l.bottom, l.top]) stamp(p[0], p[2], 1, 9);
  }

  /** A skier's skis compact and scrape the snow under them. `amount` per pass, 0..1 of full wear. */
  deposit(x: number, z: number, amount: number) {
    const k = this.cell(x, z);
    if (k < 0) return;
    const o = k * 4, v = this.data[o] + amount * 255;
    this.data[o] = v > 255 ? 255 : v;
    this.dirty = true;
  }

  /** A snowcat's tiller restores corduroy across its width. */
  groom(x: number, z: number, halfWidth: number) {
    const R = Math.ceil(halfWidth / RES);
    const ci = Math.floor((x - this.x0) / RES), cj = Math.floor((-z - this.n0) / RES);
    for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      const dx = this.x0 + (i + 0.5) * RES - x, dn = this.n0 + (j + 0.5) * RES + z;
      if (dx * dx + dn * dn > halfWidth * halfWidth) continue;
      const o = (j * this.w + i) * 4;
      this.data[o] = 0; this.data[o + 1] = 255;
    }
    this.dirty = true;
  }

  /** Wear seen by physics and the shader, 0..1, including a normal day's traffic by `skiedHours`. */
  wornAt(x: number, z: number, skiedHours: number) {
    const k = this.cell(x, z);
    if (k < 0) return 0;
    const o = k * 4, d = this.data;
    const base = (d[o + 2] / 255) * Math.min(1, skiedHours / 6) * (1 - d[o + 1] / 255);
    return Math.min(1, d[o] / 255 + base * 0.85) * (1 - this.freshCover);
  }

  /** Snow falls: the new layer fills tracks and hides traffic wear. */
  snowfall(inches: number) {
    if (inches <= 0) return;
    this.freshInches += inches;
    const keep = Math.exp(-inches / 2.5);
    for (let o = 0; o < this.data.length; o += 4) if (this.data[o]) this.data[o] = Math.floor(this.data[o] * keep);
    this.dirty = true;
  }

  /** Overnight: groomers restore every groomed run and tonight's flags reset for the new day. */
  newDay(groomedAt: (x: number, z: number) => boolean) {
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const o = (j * this.w + i) * 4;
      this.data[o + 1] = 0;
      if (this.data[o] && groomedAt(this.x0 + (i + 0.5) * RES, -(this.n0 + (j + 0.5) * RES))) this.data[o] = 0;
    }
    this.freshInches = 0;
    this.dirty = true;
  }

  update(dt: number) {
    if (!this.dirty || (this.uploadTimer -= dt) > 0) return;
    this.uploadTimer = 1.5; this.dirty = false;
    this.texture.needsUpdate = true;
  }

  serialize(): Pick<SavedSnow, 'w' | 'h' | 'wear' | 'groomed' | 'fresh'> {
    return { w: this.w, h: this.h, wear: rle(this.data, 0), groomed: rle(this.data, 1), fresh: Math.round(this.freshInches * 100) / 100 };
  }

  restore(s: Pick<SavedSnow, 'w' | 'h' | 'wear' | 'groomed' | 'fresh'>) {
    if (s.w !== this.w || s.h !== this.h) return false;
    unrle(s.wear, this.data, 0); unrle(s.groomed, this.data, 1);
    this.freshInches = s.fresh ?? 0;
    this.dirty = true;
    return true;
  }
}

/** Run-length encode one channel (most of the mountain is untouched): base64 of [value, run-1] byte pairs. */
function rle(data: Uint8Array, channel: number) {
  const out: number[] = [];
  let prev = data[channel], run = 0;
  for (let o = channel; o < data.length; o += 4) {
    const v = data[o];
    if (v === prev && run < 256) { run++; continue; }
    out.push(prev, run - 1); prev = v; run = 1;
  }
  out.push(prev, run - 1);
  let s = '';
  for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode(...out.slice(i, i + 8192));
  return btoa(s);
}

function unrle(text: string, data: Uint8Array, channel: number) {
  try {
    const raw = atob(text);
    let o = channel;
    for (let i = 0; i + 1 < raw.length && o < data.length; i += 2) {
      const v = raw.charCodeAt(i), n = raw.charCodeAt(i + 1) + 1;
      for (let k = 0; k < n && o < data.length; k++, o += 4) data[o] = v;
    }
  } catch { /* corrupt save: keep fresh snow */ }
}
