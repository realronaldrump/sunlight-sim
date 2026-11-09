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

export function addTreeCollider(grid: ColliderGrid, x: number, z: number, y: number, h: number, r: number, species: number, seed: number) {
  if (h <= 3 || species === 3) return;
  if (species === 2) {
    // Every rendered aspen stem is solid and rotates with its individual tree.
    const angle = seed / 255 * Math.PI * 2, cos = Math.cos(angle), sin = Math.sin(angle);
    for (const [dx, dz, hf, gs] of ASPEN_STEMS) {
      const ox = (dx * cos + dz * sin) * r, oz = (-dx * sin + dz * cos) * r;
      grid.add({ type: 'cyl', x: x + ox, z: z + oz, r: Math.max(.08, (.04 + .012 * h) * gs), top: y + h * hf });
    }
  } else {
    grid.add({ type: 'cyl', x, z, r: .1 + .012 * h + (species <= 1 ? .3 : .05), top: y + h });
  }
}
