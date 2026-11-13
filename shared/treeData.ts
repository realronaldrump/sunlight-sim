import type { ColliderGrid } from './collision';

/** Aspen clump layouts: [dx, dz, height fraction, girth] per stem, offsets in crown radii.
 * Lidar resolves one crown per 3 to 7 m window; the stems inside it vary from a lone mature trunk to a
 * parent ringed by saplings, so the layout is chosen per tree from its seed. */
const polar = (r: number, a: number, hf: number, gs: number) => [r * Math.cos(a), r * Math.sin(a), hf, gs] as const;
export const ASPEN_CLUMPS: readonly (readonly (readonly [number, number, number, number])[])[] = [
  [[0, 0, 1, 1], polar(.78, .7, .78, .72), polar(.86, 3.6, .63, .58)],
  [[0, 0, 1, 1.1]],
  [polar(.14, 2.6, 1, 1), polar(.42, 5.7, .9, .84)],
  [polar(.1, 0, 1, .94), polar(.76, 2.7, .55, .44), polar(.83, .85, .47, .4), polar(.82, 4.95, .61, .5)],
  [polar(.54, 3.7, 1, .9), polar(.63, .65, .93, .86)],
  [[0, 0, 1, 1.16], polar(.8, 5.6, .7, .6)],
  [polar(.3, 1.3, 1, .82), polar(.52, 4.3, .86, .7), polar(.9, 2.9, .74, .6), polar(.7, .1, .38, .34)],
  [[0, 0, 1, .98], polar(.9, 4.1, .52, .42)],
];
export const aspenClumpIndex = (seed: number) => seed % ASPEN_CLUMPS.length;

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
    for (const [dx, dz, hf, gs] of ASPEN_CLUMPS[aspenClumpIndex(seed)]) {
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

export const CONIFER_VARIANTS = 4;
export const coniferVariant = (seed: number) => seed % CONIFER_VARIANTS;

export interface ConiferBough {
  angle: number; reach: number; drop: number; lift: number; level: number;
  forked: boolean; shades: number[]; snow: number; dead: boolean; roll: number;
}

/** Height in meters above the trunk attachment at fraction `s` of the reach: a bough leaves the trunk
 * drooping under its own weight and snow, then turns up toward the light at the tip. */
export const boughRise = (b: { drop: number; lift: number }, s: number) => -b.drop * s + b.lift * s * s;

/** Growth forms. base: live crown base as a height fraction; taper: crown profile exponent (higher is a
 * narrower spire); droop: slope of the lowest boughs; thin: share of boughs lost; side: how much shorter
 * the crowded or windward side is; top: 0 spire, 1 dead spike top, 2 twin leader; stubs: dead lower limbs. */
interface ConiferForm { base: number; taper: number; droop: number; thin: number; side: number; top: 0 | 1 | 2; stubs: number }
export const CONIFER_FORMS: readonly (readonly ConiferForm[])[] = [
  [ // Engelmann spruce and subalpine fir
    { base: .06, taper: .92, droop: .62, thin: .05, side: 0, top: 0, stubs: 0 },
    { base: .09, taper: 1.28, droop: .8, thin: .04, side: .1, top: 0, stubs: 0 },
    { base: .27, taper: .8, droop: .5, thin: .17, side: .28, top: 0, stubs: 7 },
    { base: .13, taper: .86, droop: .58, thin: .1, side: .5, top: 1, stubs: 3 },
  ],
  [ // Douglas-fir
    { base: .16, taper: .68, droop: .42, thin: .14, side: .15, top: 0, stubs: 2 },
    { base: .31, taper: .6, droop: .36, thin: .2, side: .3, top: 0, stubs: 6 },
    { base: .1, taper: .78, droop: .5, thin: .1, side: 0, top: 0, stubs: 0 },
    { base: .22, taper: .64, droop: .4, thin: .24, side: .45, top: 2, stubs: 4 },
  ],
];

/** The renderer and the ornament planner use the same seeded branch positions. Boughs are listed from
 * the ground up. The light model keeps every third bough of the full one, so gaps and lean carry over. */
export function coniferBoughs(kind: 0 | 1, detail: 'high' | 'low', variant = 0) {
  const form = CONIFER_FORMS[kind][variant % CONIFER_VARIANTS];
  let seed = (kind === 0 ? 7 : 13) + variant * 977;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const H = CONIFER_HEIGHT, R = CONIFER_RADIUS;
  const spacing = kind === 0 ? .43 : .55;
  const y0 = H * form.base, crown = H * (form.top === 1 ? .89 : .965) - y0;
  const levels = Math.round(crown / spacing);
  const shortSide = random() * Math.PI * 2, gapAngle = random() * Math.PI * 2, gapAt = .18 + random() * .45;
  const result: ConiferBough[] = [];
  for (let i = 0; i < form.stubs; i++) {
    result.push({
      angle: random() * Math.PI * 2, reach: R * (.2 + random() * .26), drop: .05 + random() * .2, lift: 0,
      level: Math.max(.9, y0 * (.3 + .68 * (i + random()) / form.stubs)), forked: false, shades: [.8, .8], snow: 0, dead: true, roll: 0,
    });
  }
  for (let w = 0; w < levels; w++) {
    const t = w / levels, y = y0 + crown * t;
    const arms = Math.round(6.4 - 2.7 * t);
    const profile = (1 - t) ** form.taper * Math.min(1, .8 + t * 3.5);
    for (let b = 0; b < arms; b++) {
      const u = [random(), random(), random(), random(), random(), random(), random()];
      const angle = b / arms * Math.PI * 2 + w * 2.399 + (u[0] - .5) * .7;
      const off = Math.atan2(Math.sin(angle - gapAngle), Math.cos(angle - gapAngle));
      // Shade and storm breakage leave a few missing boughs and one ragged hole in the crown.
      if ((w > 1 && u[1] < form.thin) || (Math.abs(off) < .6 && Math.abs(t - gapAt) < .08 + form.thin * .25)) continue;
      const side = 1 - form.side * (.5 + .5 * Math.cos(angle - shortSide));
      const reach = R * Math.max(.07, profile * (.72 + u[2] * .28) * side);
      const slope = form.droop + (-.5 - form.droop) * t ** 1.5 + (u[3] - .5) * .2;
      result.push({
        angle, reach, drop: reach * slope, lift: reach * (.3 - .16 * t + u[4] * .1),
        level: y + (u[5] - .5) * spacing * .85, forked: reach > .8,
        shades: [.84 + random() * .16, .84 + random() * .16, .84 + random() * .16, .84 + random() * .16],
        snow: Math.min(1, .2 + u[6] * .55 + t * .25), dead: false, roll: (random() - .5) * .5,
      });
    }
  }
  return detail === 'high' ? result : result.filter((_, i) => i % 3 === 0);
}

const nearBoughs = ([0, 1] as const).map(kind =>
  Array.from({ length: CONIFER_VARIANTS }, (_, v) => coniferBoughs(kind, 'high', v).filter(b => !b.dead)));

export function* ornamentBranches(tree: FirInstance, maxY: number, reachFraction = .77) {
  const yaw = tree.seed / 255 * Math.PI * 2, lean = (tree.seed * 7 % 255) / 255 * .04 - .02;
  const c = Math.cos(yaw), s = Math.sin(yaw), cl = Math.cos(lean), sl = Math.sin(lean);
  const width = tree.radius / CONIFER_RADIUS, height = tree.height / CONIFER_HEIGHT;
  for (const b of nearBoughs[tree.kind][coniferVariant(tree.seed)]) {
    if (tree.y - .2 + (b.level - .85) * height > maxY + .8) break;
    const reach = b.reach * reachFraction * width;
    const x = Math.cos(b.angle) * reach, z = -Math.sin(b.angle) * reach;
    const y = (b.level + boughRise(b, reachFraction)) * height;
    const tiltedZ = y * sl + z * cl;
    yield { x: tree.x + x * c + tiltedZ * s, y: tree.y - .2 + y * cl - z * sl, z: tree.z - x * s + tiltedZ * c };
  }
}
