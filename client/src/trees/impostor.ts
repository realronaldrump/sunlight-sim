// Far-tree impostors are baked from the detailed tree models themselves: each model is rasterized on
// the CPU from two directions a quarter turn apart, with the same textures, vertex shading and shading
// normals as the near mesh. Distant forests therefore keep the silhouettes, colour and lighting of the
// trees they turn into as you approach. Pure functions, so the bake runs the same in a browser or Node.
import type * as THREE from 'three/webgpu';

/** Writes linear [r, g, b, coverage] for texture coordinates (u, v), v up. */
export type Sampler = (u: number, v: number, out: Float32Array) => void;

export interface BakeModel {
  /** Normalized tree (height 1, crown radius 1), non-indexed. Groups select the sampler. */
  geometry: THREE.BufferGeometry;
  samplers: Sampler[];
  /** Horizontal half-extent of the baked cell, in crown radii. */
  halfWidth: number;
}

/** Baked cells cover slightly more than the tree height, so a crown tip never touches a cell edge. */
export const IMPOSTOR_HEADROOM = 1.04;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const toSRGB = (c: number) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));

/** Largest horizontal distance of any vertex from the trunk axis, in crown radii. */
export function modelRadius(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position');
  let m = 0;
  for (let i = 0; i < p.count; i++) m = Math.max(m, Math.hypot(p.getX(i), p.getZ(i)));
  return m;
}

/**
 * Atlas of `models.length` columns by two rows (view along -z below, view along -x above). Rows run up
 * from the tree base. `albedo` is sRGB with coverage in alpha; `normal` holds model-space shading
 * normals in meters-space directions, packed to 0..255.
 */
export function bakeImpostorAtlas(models: BakeModel[], cw = 128, ch = 256, ss = 2) {
  const width = cw * models.length, height = ch * 2;
  const albedo = new Uint8Array(width * height * 4), normal = new Uint8Array(width * height * 4);
  const w = cw * ss, h = ch * ss, n = w * h;
  const depth = new Float32Array(n), rgb = new Float32Array(n * 3), nrm = new Float32Array(n * 3), hit = new Uint8Array(n);
  const texel = new Float32Array(4), sx = [0, 0, 0], sy = [0, 0, 0], sz = [0, 0, 0];
  models.forEach((m, column) => {
    const g = m.geometry, pos = g.getAttribute('position'), nor = g.getAttribute('normal'), uv = g.getAttribute('uv'), col = g.getAttribute('color');
    const aspect = (g.userData.aspect as number) ?? 1;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
    for (const view of [0, 1]) {
      depth.fill(-Infinity); hit.fill(0);
      for (const group of groups) {
        const sample = m.samplers[group.materialIndex ?? 0];
        for (let i = group.start; i < group.start + group.count; i += 3) {
          for (let k = 0; k < 3; k++) {
            const x = pos.getX(i + k), z = pos.getZ(i + k);
            sx[k] = ((view === 0 ? x : -z) / m.halfWidth * .5 + .5) * w;
            sy[k] = pos.getY(i + k) / IMPOSTOR_HEADROOM * h;
            sz[k] = view === 0 ? z : x;
          }
          const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
          if (Math.abs(area) < 1e-7) continue;
          const x0 = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2]))), x1 = Math.min(w - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])));
          const y0 = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2]))), y1 = Math.min(h - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])));
          for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
            const cx = px + .5, cy = py + .5;
            const b0 = ((sx[1] - cx) * (sy[2] - cy) - (sx[2] - cx) * (sy[1] - cy)) / area;
            const b1 = ((sx[2] - cx) * (sy[0] - cy) - (sx[0] - cx) * (sy[2] - cy)) / area;
            const b2 = 1 - b0 - b1;
            if (b0 < 0 || b1 < 0 || b2 < 0) continue;
            const at = py * w + px, z = b0 * sz[0] + b1 * sz[1] + b2 * sz[2];
            if (z <= depth[at]) continue;
            sample(b0 * uv.getX(i) + b1 * uv.getX(i + 1) + b2 * uv.getX(i + 2), b0 * uv.getY(i) + b1 * uv.getY(i + 1) + b2 * uv.getY(i + 2), texel);
            // Coverage through an ordered threshold, the way alpha-to-coverage treats fine twigs.
            if (texel[3] <= .1 + .8 * (BAYER[(px & 3) + (py & 3) * 4] + .5) / 16) continue;
            depth[at] = z; hit[at] = 1;
            for (let c = 0; c < 3; c++) rgb[at * 3 + c] = texel[c] * (col ? b0 * col.getComponent(i, c) + b1 * col.getComponent(i + 1, c) + b2 * col.getComponent(i + 2, c) : 1);
            // undo the normalizing skew so the stored normal is the modeled direction
            const nx = b0 * nor.getX(i) + b1 * nor.getX(i + 1) + b2 * nor.getX(i + 2);
            const ny = (b0 * nor.getY(i) + b1 * nor.getY(i + 1) + b2 * nor.getY(i + 2)) / aspect;
            const nz = b0 * nor.getZ(i) + b1 * nor.getZ(i + 1) + b2 * nor.getZ(i + 2);
            const l = Math.hypot(nx, ny, nz) || 1;
            nrm[at * 3] = nx / l; nrm[at * 3 + 1] = ny / l; nrm[at * 3 + 2] = nz / l;
          }
        }
      }
      // Resolve the supersamples, then spread colour into empty texels so mipmaps do not darken edges.
      const cell = new Float32Array(cw * ch * 7), filled = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        let count = 0; const o = (y * cw + x) * 7;
        for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
          const at = (y * ss + j) * w + x * ss + i;
          if (!hit[at]) continue;
          count++;
          for (let c = 0; c < 3; c++) { cell[o + c] += rgb[at * 3 + c]; cell[o + 3 + c] += nrm[at * 3 + c]; }
        }
        if (!count) continue;
        for (let c = 0; c < 6; c++) cell[o + c] /= count;
        cell[o + 6] = count / (ss * ss); filled[y * cw + x] = 1;
      }
      for (let pass = 0; pass < 6; pass++) {
        const grown: number[] = [];
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
          if (filled[y * cw + x]) continue;
          let count = 0; const o = (y * cw + x) * 7;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const X = x + dx, Y = y + dy;
            if (X < 0 || Y < 0 || X >= cw || Y >= ch || filled[Y * cw + X] !== 1) continue;
            count++;
            for (let c = 0; c < 6; c++) cell[o + c] += cell[(Y * cw + X) * 7 + c];
          }
          if (!count) continue;
          for (let c = 0; c < 6; c++) cell[o + c] /= count;
          grown.push(y * cw + x);
        }
        for (const at of grown) filled[at] = 1;
      }
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const o = (y * cw + x) * 7, to = ((view * ch + y) * width + column * cw + x) * 4;
        const l = Math.hypot(cell[o + 3], cell[o + 4], cell[o + 5]) || 1;
        for (let c = 0; c < 3; c++) {
          albedo[to + c] = toSRGB(Math.min(1, cell[o + c]));
          normal[to + c] = filled[y * cw + x] ? Math.round((cell[o + 3 + c] / l * .5 + .5) * 255) : c === 1 ? 255 : 128;
        }
        albedo[to + 3] = Math.round(cell[o + 6] * 255); normal[to + 3] = 255;
      }
    }
  });
  return { albedo, normal, width, height };
}

/** Sampler over a canvas, box-filtered down by `shrink` so needles and twigs keep their average
 * coverage at bake resolution. `gain` restores the density that alpha testing gives the near mesh. */
export function canvasSampler(canvas: HTMLCanvasElement, shrink: number, gain = 1, repeat = false): Sampler {
  let src = canvas, w = canvas.width, h = canvas.height;
  for (let s = 1; s < shrink; s *= 2) {
    const c = document.createElement('canvas'); c.width = w = Math.max(1, w >> 1); c.height = h = Math.max(1, h >> 1);
    c.getContext('2d')!.drawImage(src, 0, 0, w, h);
    src = c;
  }
  const data = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const lut = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return (u, v, out) => {
    if (repeat) { u -= Math.floor(u); v -= Math.floor(v); }
    const x = Math.min(w - 1, Math.max(0, (u * w) | 0)), y = Math.min(h - 1, Math.max(0, ((1 - v) * h) | 0)), i = (y * w + x) * 4;
    out[0] = lut[data[i]]; out[1] = lut[data[i + 1]]; out[2] = lut[data[i + 2]]; out[3] = Math.min(1, data[i + 3] / 255 * gain);
  };
}

export const solidSampler: Sampler = (_u, _v, out) => { out[0] = out[1] = out[2] = out[3] = 1; };
