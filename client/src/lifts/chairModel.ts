// Original, meter-scale models reconstructed from Sunlight photo references.
// Primo: 2025 LPA quad. Segundo: relocated LPA triple. Tercero: older painted Riblet.
// See DECISIONS.md for reference dates and estimated dimensions. No photo textures ship.
import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, texture, uv, vec2 } from 'three/tsl';
import { HANGER, SEAT_SPACING } from '../../../shared/lifts';

export type ChairFinish = 'frame' | 'vinyl' | 'hardware';
export type ChairMotion = 'body' | 'grip' | 'restraint';
export interface ChairPart { name: string; geometry: THREE.BufferGeometry; finish: ChairFinish; motion: ChairMotion }
export const BAR_PIVOT = new THREE.Vector3(0, -HANGER + 0.52, 0.36);

const V = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2]);

/** Rounded bends with straight tubing between them, not overshooting spline corners. */
function bentTube(points: number[][], radius: number, bend: number, detail: boolean) {
  const curve = new THREE.CurvePath<THREE.Vector3>();
  let previous = V(points[0]);
  for (let i = 1; i < points.length - 1; i++) {
    const p = V(points[i]), before = V(points[i - 1]).sub(p), after = V(points[i + 1]).sub(p);
    const d = Math.min(bend, before.length() * 0.45, after.length() * 0.45);
    const entry = p.clone().add(before.normalize().multiplyScalar(d));
    const exit = p.clone().add(after.normalize().multiplyScalar(d));
    curve.add(new THREE.LineCurve3(previous, entry));
    curve.add(new THREE.QuadraticBezierCurve3(entry, p, exit));
    previous = exit;
  }
  curve.add(new THREE.LineCurve3(previous, V(points.at(-1)!)));
  return new THREE.TubeGeometry(curve, Math.max(12, points.length * (detail ? 12 : 5)), radius, detail ? 10 : 6, false);
}

function cylinder(a: number[], b: number[], radius: number, sides = 10) {
  const p = V(a), q = V(b), delta = q.clone().sub(p);
  const g = new THREE.CylinderGeometry(radius, radius, delta.length(), sides);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
  g.translate(...p.add(q).multiplyScalar(0.5).toArray());
  return g;
}

export function buildChairModel(name: string, seats: number, detailed = true): ChairPart[] {
  const riblet = name === 'Tercero', primo = name === 'Primo';
  const width = seats * SEAT_SPACING + 0.08, half = width / 2, sy = -HANGER;
  const header = sy + (riblet ? 1.28 : primo ? 1.42 : 1.34);
  const buckets = new Map<string, { finish: ChairFinish; motion: ChairMotion; geos: THREE.BufferGeometry[] }>();
  const add = (finish: ChairFinish, motion: ChairMotion, g: THREE.BufferGeometry) => {
    const key = `${motion}-${finish}`;
    if (!buckets.has(key)) buckets.set(key, { finish, motion, geos: [] });
    buckets.get(key)!.geos.push(g.index ? g.toNonIndexed() : g);
  };
  const box = (finish: ChairFinish, motion: ChairMotion, size: number[], p: number[], rounding = 0.01, tilt = 0) => {
    const g = new RoundedBoxGeometry(size[0], size[1], size[2], detailed ? 2 : 1, rounding);
    g.rotateX(tilt); g.translate(...p as [number, number, number]); add(finish, motion, g);
  };
  const tube = (finish: ChairFinish, motion: ChairMotion, points: number[][], r: number, bend = 0.12) => add(finish, motion, bentTube(points, r, bend, detailed));
  const rod = (finish: ChairFinish, motion: ChairMotion, a: number[], b: number[], r: number, sides = detailed ? 10 : 6) => add(finish, motion, cylinder(a, b, r, sides));

  // Full rounded carrier hoop, with an open back above the low cushion/slats.
  tube('frame', 'body', [[-half, sy - .08, .40], [-half, header, .46], [half, header, .46], [half, sy - .08, .40], [-half, sy - .08, .40]], riblet ? .025 : .034, riblet ? .16 : .27);
  rod('frame', 'body', [-half, sy - .075, -.16], [half, sy - .075, -.16], .027);
  for (const side of [-1, 1]) {
    // Open side rails and seat-pan cradles, not solid slab armrests.
    tube(riblet ? 'frame' : 'hardware', 'body', [[side * half, sy + .43, .40], [side * half, sy + .33, -.14], [side * half, sy - .06, -.17], [side * half, sy - .08, .40]], .022, .10);
  }
  // Profile-specific S/J hanger routes behind occupants; fixed grip remains at origin.
  const offset = primo ? 1 : -1;
  const hanger = riblet
    ? [[0, -.05, .02], [0, -.45, .05], [.14, -.72, .40], [.14, header + .17, .52], [0, header, .46]]
    : [[0, -.06, .02], [.20 * offset, -.31, .08], [.29 * offset, -.50, .44], [.29 * offset, header + .28, .54], [.17 * offset, header + .04, .50], [0, header, .46]];
  tube('frame', 'body', hanger, riblet ? .033 : .045, .19);
  box('frame', 'body', [.24, .16, .10], [0, header + .015, .46], .015);

  // Individual padded divisions still read as a continuous vinyl bench at a distance.
  for (let i = 0; i < seats; i++) {
    const x = (i - (seats - 1) / 2) * SEAT_SPACING;
    box('vinyl', 'body', [SEAT_SPACING - .006, .07, .48], [x, sy, .12], .028);
    if (!riblet) box('vinyl', 'body', [SEAT_SPACING - .006, .32, .07], [x, sy + .29, .365], .025, .12);
    if (detailed) {
      // Piping/seams and the support brackets beneath each seat.
      rod('vinyl', 'body', [x - .285, sy + .025, -.105], [x + .285, sy + .025, -.105], .0035, 6);
      box('frame', 'body', [.045, .055, .48], [x, sy - .064, .12], .008);
      if (!riblet) for (const side of [-1, 1]) rod('vinyl', 'body', [x + side * .286, sy + .15, .321], [x + side * .286, sy + .42, .354], .0025, 6);
    }
  }
  if (riblet) {
    // The reference Riblet has two narrow back slats and no visible overhead restraint.
    for (const y of [.23, .43]) box('frame', 'body', [width - .07, .07, .045], [0, sy + y, .39], .008);
  }

  // Fixed-grip jaws around the haul rope, cross pin, tension nut and witness bands.
  box('frame', 'grip', [.12, .05, .30], [0, .025, 0], .022);
  box('hardware', 'grip', [.12, .05, .26], [0, -.035, 0], .018);
  rod('frame', 'grip', [-.13, -.065, .02], [.15, -.065, .02], .038);
  if (detailed) {
    for (const z of [-.105, .105]) {
      rod('hardware', 'grip', [-.085, -.025, z], [.085, -.025, z], .013, 6);
      rod('frame', 'grip', [.074, -.025, z], [.095, -.025, z], .022, 6);
    }
    for (const x of [-.135, .155]) rod('hardware', 'grip', [x, -.065, .02], [x + .016, -.065, .02], .030, 6);
    for (const side of [-1, 1]) {
      for (const y of [header + .055, header - .035]) rod('hardware', 'body', [side * .084, y, .398], [side * .084, y, .385], .014, 6);
      box('hardware', 'body', [.06, .11, .07], [side * half, sy + .51, .38], .009);
    }
  }

  if (!riblet) {
    // Everything here is relative to BAR_PIVOT. A real bar folds up and behind the
    // carrier; its foot supports travel with it, leaving loading/unloading clear.
    for (const side of [-1, 1]) tube('frame', 'restraint', [[side * half, 0, 0], [side * half, -.04, -.69], [side * (half - .10), -.04, -.85]], .021, .14);
    rod('frame', 'restraint', [-half + .10, -.04, -.85], [half - .10, -.04, -.85], .022);
    // Primo's two paired ski rests versus the triple's three small individual rests.
    const rests = primo ? [-.60, .60] : [-.60, 0, .60];
    for (const x of rests) {
      tube('frame', 'restraint', [[x, -.04, -.85], [x, -.92, -.86], [x, -1.16, -.72]], .019, .10);
      box('hardware', 'restraint', [primo ? .68 : .35, .035, .15], [x, -1.16, -.72], .014);
      if (detailed) for (let k = -2; k <= 2; k++) box('hardware', 'restraint', [primo ? .62 : .29, .009, .008], [x, -1.135, -.72 + k * .022], .003);
    }
    for (let i = 0; i < seats; i++) {
      const x = (i - (seats - 1) / 2) * SEAT_SPACING;
      rod('vinyl', 'restraint', [x - .16, -.04, -.85], [x + .16, -.04, -.85], .030);
    }
  }
  return [...buckets.entries()].map(([key, b]) => {
    const geometry = mergeGeometries(b.geos)!;
    for (const g of b.geos) g.dispose();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return { name: `${name}-${key}`, geometry, finish: b.finish, motion: b.motion };
  });
}

// Small original procedural textures: matte vinyl grain and galvanized zinc mottling.
// Material maps add close-up surface response without borrowing copyrighted photography.
function surfaceTexture(vinyl: boolean, roughness: boolean) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const ctx = cv.getContext('2d')!, pixels = ctx.createImageData(128, 128);
  let seed = 431;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    seed = (seed * 16807) % 2147483647;
    const n = seed / 2147483647 - .5;
    const wrinkle = Math.sin(x * .33 + Math.sin(y * .09) * 1.8) * Math.sin(y * .14);
    const value = roughness ? (vinyl ? 195 : 130) + n * 35 + wrinkle * 12 : (vinyl ? 170 : 225) + n * (vinyl ? 8 : 20) + wrinkle * (vinyl ? 3 : 10);
    const i = (y * 128 + x) * 4;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value; pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(vinyl ? 3 : 1, vinyl ? 1 : 2); t.anisotropy = 4;
  if (!roughness) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function chairMaterials(name: string) {
  const riblet = name === 'Tercero';
  return {
    frame: new THREE.MeshStandardNodeMaterial({ color: riblet ? 0x243d34 : 0xa4afb6, metalness: riblet ? .25 : .7, roughness: .58, map: surfaceTexture(false, false), roughnessMap: surfaceTexture(false, true) }),
    vinyl: new THREE.MeshStandardNodeMaterial({ color: 0x20262c, metalness: .02, roughness: .62, map: surfaceTexture(true, false), roughnessMap: surfaceTexture(true, true) }),
    hardware: new THREE.MeshStandardNodeMaterial({ color: 0x444b50, metalness: .60, roughness: .44 }),
  };
}

/** One atlas and instanced mesh per lift for actual chair numbers, front and back. */
export function numberedChairPlates(name: string, count: number) {
  const cols = 16, rows = Math.ceil(count / cols);
  const cv = document.createElement('canvas'); cv.width = cols * 64; cv.height = rows * 32;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#e5e7e2'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#20262a'; ctx.font = '500 24px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < count; i++) ctx.fillText(String(i + 1), (i % cols) * 64 + 32, Math.floor(i / cols) * 32 + 16);
  const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const header = -HANGER + (name === 'Tercero' ? 1.28 : name === 'Primo' ? 1.42 : 1.34);
  const front = new THREE.PlaneGeometry(.24, .12); front.rotateY(Math.PI); front.translate(0, header, .398);
  const back = new THREE.PlaneGeometry(.24, .12); back.translate(0, header, .518);
  const g = mergeGeometries([front, back])!;
  const offsets = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) { offsets[i * 2] = (i % cols) / cols; offsets[i * 2 + 1] = (rows - 1 - Math.floor(i / cols)) / rows; }
  g.setAttribute('labelUV', new THREE.InstancedBufferAttribute(offsets, 2));
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: .65 });
  mat.colorNode = texture(map, uv().mul(vec2(1 / cols, 1 / rows)).add(attribute('labelUV', 'vec2'))).rgb;
  const mesh = new THREE.InstancedMesh(g, mat, count); mesh.name = `${name}-chair-numbers`; mesh.frustumCulled = false;
  return mesh;
}
