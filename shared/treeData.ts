import type { ColliderGrid } from './collision';

export const ASPEN_STEMS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 1, 1],
  [0.78 * Math.cos(0.7), 0.78 * Math.sin(0.7), 0.78, 0.72],
  [0.86 * Math.cos(3.6), 0.86 * Math.sin(3.6), 0.63, 0.58],
];

export async function decodeTreeTile(bytes: ArrayBuffer) {
  const buf = new Uint8Array(bytes)[0] === 0x1f
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : bytes;
  const n = new DataView(buf).getUint32(4, true);
  let offset = 8;
  const f32 = () => { const a = new Float32Array(buf, offset, n); offset += n * 4; return a; };
  const x = f32(), z = f32(), y = f32();
  const h = Float32Array.from(new Uint16Array(buf, offset, n), v => v / 100); offset += n * 2;
  const r = Float32Array.from(new Uint8Array(buf, offset, n), v => v / 20); offset += n;
  const s = new Uint8Array(buf, offset, n), seed = new Uint8Array(buf, offset + n, n);
  return { n, x, z, y, h, r, s, seed };
}

export function addTreeCollider(grid: ColliderGrid, x: number, z: number, y: number, h: number, r: number, species: number, seed: number, rememberFir = false) {
  if (h <= 3 || species === 3) return;
  if (species === 2) {
    // Every rendered aspen stem is solid and rotates with its individual tree.
    const angle = seed / 255 * Math.PI * 2, cos = Math.cos(angle), sin = Math.sin(angle);
    for (const [dx, dz, hf, gs] of ASPEN_STEMS) {
      const ox = (dx * cos + dz * sin) * r, oz = (-dx * sin + dz * cos) * r;
      grid.add({ type: 'cyl', x: x + ox, z: z + oz, r: Math.max(.08, (.04 + .012 * h) * gs), top: y + h * hf });
    }
  } else {
    const fir: FirInstance | undefined = rememberFir && (species === 0 || species === 1) && r >= .6 && h <= 16
      ? { x, y, z, height: h, radius: r, kind: species, seed } : undefined;
    grid.add({ type: 'cyl', x, z, r: .1 + .012 * h + (species <= 1 ? .3 : .05), top: y + h, ...(fir && { fir }) });
  }
}

export interface FirInstance {
  x: number; y: number; z: number; height: number; radius: number; kind: 0 | 1; seed: number;
}

export const CONIFER_HEIGHT = 14;
export const CONIFER_RADIUS = 2.25;

interface ConiferBough {
  angle: number; reach: number; drop: number; level: number; forked: boolean; shades: number[];
}

/** The renderer and the ornament planner use the same seeded branch positions. */
export function coniferBoughs(kind: 0 | 1, detail: 'high' | 'low') {
  let seed = kind === 0 ? 7 : 13;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const whorls = detail === 'high' ? (kind === 0 ? 22 : 18) : 9;
  const arms = detail === 'high' ? 7 : 5;
  const result: ConiferBough[] = [];
  for (let w = 0; w < whorls; w++) {
    const t = w / whorls, y = CONIFER_HEIGHT * (.12 + t * .85);
    const profile = (1 - t) ** (kind === 0 ? .78 : .64);
    for (let b = 0; b < arms; b++) {
      if (w > 1 && random() < .075) continue;
      const angle = b / arms * Math.PI * 2 + w * 2.399 + random() * .5;
      const reach = CONIFER_RADIUS * Math.max(.065, profile * (.72 + random() * .24));
      const drop = reach * (kind === 0 ? .16 : .24);
      const level = y + (random() - .5) * .42;
      const forked = detail === 'high' && t < .85;
      const shades = Array.from({ length: forked ? 4 : 2 }, () => .72 + random() * .28);
      result.push({ angle, reach, drop, level, forked, shades });
    }
  }
  return result;
}

const nearBoughs = [coniferBoughs(0, 'high'), coniferBoughs(1, 'high')];

export function* ornamentBranches(tree: FirInstance, maxY: number, reachFraction = .77) {
  const yaw = tree.seed / 255 * Math.PI * 2, lean = (tree.seed * 7 % 255) / 255 * .04 - .02;
  const c = Math.cos(yaw), s = Math.sin(yaw), cl = Math.cos(lean), sl = Math.sin(lean);
  const width = tree.radius / CONIFER_RADIUS, height = tree.height / CONIFER_HEIGHT;
  for (const b of nearBoughs[tree.kind]) {
    if (tree.y - .2 + (b.level - .85) * height > maxY + .8) break;
    const pitch = Math.atan2(b.drop, b.reach), along = b.reach * reachFraction;
    const reach = along * Math.cos(pitch) * width;
    const x = Math.cos(b.angle) * reach, z = -Math.sin(b.angle) * reach;
    const y = (b.level - along * Math.sin(pitch)) * height;
    const tiltedZ = y * sl + z * cl;
    yield { x: tree.x + x * c + tiltedZ * s, y: tree.y - .2 + y * cl - z * sl, z: tree.z - x * s + tiltedZ * c };
  }
}
