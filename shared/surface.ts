// Snow surface map: per-pixel groomed / piste / moguls / canopy masks over the 1 m area.
// File: gzip( "SLS1" | f32 x0 | f32 n0 | f32 res | u16 w | u16 h | u8 RGBA[w*h] ), rows south->north.
// R = groomed, G = piste (inside a run), B = canopy cover, A = moguls.
import type { SurfaceInfo } from './skiPhysics';

export type Loader = (path: string) => Promise<ArrayBuffer>;

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).arrayBuffer();
  }
  return buf;
}

export class SurfaceMap {
  constructor(public x0: number, public n0: number, public res: number, public w: number, public h: number, public data: Uint8Array) {}

  static async load(base: string, loader: Loader) {
    const raw = await gunzip(await loader(`${base}/surface.bin.gz`));
    const dv = new DataView(raw);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'SLS1') throw new Error('bad surface magic');
    const x0 = dv.getFloat32(4, true), n0 = dv.getFloat32(8, true), res = dv.getFloat32(12, true);
    const w = dv.getUint16(16, true), h = dv.getUint16(18, true);
    return new SurfaceMap(x0, n0, res, w, h, new Uint8Array(raw, 20, w * h * 4));
  }

  /** Raw RGBA (0..255) at game coords, nearest pixel; zeros outside. */
  rgba(x: number, z: number): [number, number, number, number] {
    const i = Math.floor((x - this.x0) / this.res), j = Math.floor((-z - this.n0) / this.res);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return [0, 0, 0, 0];
    const k = (j * this.w + i) * 4, d = this.data;
    return [d[k], d[k + 1], d[k + 2], d[k + 3]];
  }

  at(x: number, z: number): SurfaceInfo {
    const [r, g, , a] = this.rgba(x, z);
    return { groomed: r / 255, piste: g / 255, moguls: a / 255 };
  }

  canopy(x: number, z: number) { return this.rgba(x, z)[2] / 255; }

  /** Bilinear mogul mask (0..1) at local (x, n). */
  mogulsLocal(x: number, n: number): number {
    const fx = (x - this.x0) / this.res - 0.5, fy = (n - this.n0) / this.res - 0.5;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= this.w - 1 || j >= this.h - 1) return 0;
    const u = fx - i, v = fy - j, d = this.data, w = this.w;
    const a = d[(j * w + i) * 4 + 3], b = d[(j * w + i + 1) * 4 + 3], c = d[((j + 1) * w + i) * 4 + 3], e = d[((j + 1) * w + i + 1) * 4 + 3];
    return ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v) / 255;
  }
}
