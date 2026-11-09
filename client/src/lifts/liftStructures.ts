// @ts-nocheck -- TSL node graphs: @types/three node typings are too strict to be useful here.
// Lift towers, terminals and operator huts reconstructed from Lift Blog's March 2026 Primo/Segundo and
// September 2016 Tercero photo surveys (reference only, cached under data/raw/reference/lifts/liftblog).
//   Primo   (Leitner-Poma, 2025): galvanized. Bottom return = open spoked bullwheel on one leaning box
//           column with a line-guide sheave beam. Top drive = dark green curved housing on two long
//           galvanized tubes and angled legs, on an earth berm.
//   Segundo (ex Arapahoe Basin Leitner-Poma triple): bottom drive = the same housing type, all dark
//           green. Top return = green open bullwheel on a single green column. Galvanized towers.
//   Tercero (Riblet, 1987): black painted pipe towers with chair-guard rings, black bullwheel terminals
//           with a cap, and portal frames carrying the line sheaves.
// Dimensions are photo estimates scaled from the 5.2 m rope gauge, not manufacturer drawings.
import * as THREE from 'three/webgpu';
import { mx_noise_float, positionWorld, vec3, float } from 'three/tsl';
import { GAUGE } from '../../../shared/lifts';
import type { Collider } from '../../../shared/collision';

export type LiftStyle = 'primo' | 'segundo' | 'tercero';
export function liftStyle(name: string): LiftStyle {
  const n = name.toLowerCase();
  return n.includes('primo') ? 'primo' : n.includes('segundo') ? 'segundo' : 'tercero';
}

const HALF = GAUGE / 2;

function mottled(hex: number, amount: number, scale: number, opts: { roughness: number; metalness: number }) {
  const m = new THREE.MeshStandardNodeMaterial(opts);
  const base = new THREE.Color(hex);
  const n = mx_noise_float(positionWorld.mul(scale)).mul(0.5).add(0.5);
  const fine = mx_noise_float(positionWorld.mul(scale * 7.3)).mul(0.5).add(0.5);
  m.colorNode = vec3(base.r, base.g, base.b).mul(float(1 - amount).add(n.mul(amount * 0.7)).add(fine.mul(amount * 0.3)));
  return m;
}

let mats: ReturnType<typeof createMaterials> | null = null;
function createMaterials() {
  const siding = (base: string, trim: string, window: boolean, door: boolean) => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
    const g = cv.getContext('2d')!;
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 16) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, 0, 3, 256); g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x + 3, 0, 2, 256); }
    g.fillStyle = trim; g.fillRect(0, 0, 256, 10); g.fillRect(0, 246, 256, 10); g.fillRect(0, 0, 10, 256); g.fillRect(246, 0, 10, 256);
    if (window) {
      const x0 = door ? 120 : 40, w = door ? 116 : 176;
      g.fillStyle = trim; g.fillRect(x0 - 8, 52, w + 16, 104);
      g.fillStyle = '#1b2329'; g.fillRect(x0, 60, w, 88);
      g.fillStyle = 'rgba(160,190,215,0.25)'; g.beginPath(); g.moveTo(x0, 60); g.lineTo(x0 + w * 0.45, 60); g.lineTo(x0, 130); g.fill();
      g.fillStyle = trim; g.fillRect(x0 + w / 2 - 3, 60, 6, 88);
    }
    if (door) { g.fillStyle = trim; g.fillRect(18, 56, 82, 200); g.fillStyle = '#2b3a30'; g.fillRect(26, 64, 66, 192); g.fillStyle = '#c9b25a'; g.fillRect(80, 160, 6, 10); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  };
  const sideMat = (base: string, trim: string, window: boolean, door: boolean) =>
    new THREE.MeshStandardNodeMaterial({ map: siding(base, trim, window, door), roughness: 0.8 });
  const louvre = (() => {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#1e4733'; g.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 8) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, 0, 2, 128); }
    g.fillStyle = '#d8dcd6'; g.fillRect(40, 28, 48, 44);
    for (let y = 30; y < 70; y += 6) { g.fillStyle = '#5a605c'; g.fillRect(42, y, 44, 3); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const capTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#f2f2ee'; g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c8202a'; g.beginPath(); g.moveTo(26, 78); g.lineTo(58, 40); g.lineTo(72, 56); g.lineTo(80, 48); g.lineTo(102, 78); g.closePath(); g.fill();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  return {
    galv: mottled(0xb2b6b8, 0.22, 1.7, { roughness: 0.42, metalness: 0.75 }),
    galvDark: mottled(0x8f9496, 0.2, 2.1, { roughness: 0.5, metalness: 0.7 }),
    green: mottled(0x1f4a36, 0.1, 1.3, { roughness: 0.42, metalness: 0.35 }),
    black: mottled(0x24211e, 0.14, 1.5, { roughness: 0.62, metalness: 0.35 }),
    rubber: new THREE.MeshStandardNodeMaterial({ color: 0x161616, roughness: 0.75 }),
    yellow: new THREE.MeshStandardNodeMaterial({ color: 0xe2b21c, roughness: 0.78 }),
    glass: new THREE.MeshStandardNodeMaterial({ color: 0x0c1014, roughness: 0.08, metalness: 0.4 }),
    concrete: mottled(0x8a8780, 0.25, 0.9, { roughness: 0.95, metalness: 0 }),
    louvre: new THREE.MeshStandardNodeMaterial({ map: louvre, roughness: 0.5, metalness: 0.3 }),
    cap: new THREE.MeshStandardNodeMaterial({ map: capTex, roughness: 0.4 }),
    greenRoof: mottled(0x24402f, 0.12, 1.1, { roughness: 0.5, metalness: 0.45 }),
    rustRoof: mottled(0x6e3a2a, 0.16, 1.1, { roughness: 0.6, metalness: 0.3 }),
    hutGreen: [sideMat('#2f5a40', '#d9c27a', true, false), sideMat('#2f5a40', '#d9c27a', true, true)],
    hutPlain: [sideMat('#2c5039', '#1f3a2a', true, false), sideMat('#2c5039', '#1f3a2a', false, true)],
    hutStucco: [sideMat('#d8ccb0', '#a79b80', true, false), sideMat('#d8ccb0', '#8a3a2c', false, true)],
  };
}
export function structureMaterials() { return (mats ??= createMaterials()); }

// ---------- small geometry helpers (meshes are merged per material by mergeStatic) ----------
const Y = new THREE.Vector3(0, 1, 0);
function box(g: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
}
function rod(g: THREE.Object3D, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, sides = 10) {
  const d = b.clone().sub(a), L = d.length();
  const c = new THREE.CylinderGeometry(r1, r0, L, sides, 1, false);
  c.translate(0, L / 2, 0);
  c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()));
  c.translate(a.x, a.y, a.z);
  const m = new THREE.Mesh(c, mat); g.add(m); return m;
}
/** Square hollow-section member between two points. */
function beam(g: THREE.Object3D, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, w: number, h = w) {
  const d = b.clone().sub(a), L = d.length();
  const geo = new THREE.BoxGeometry(w, L, h);
  geo.translate(0, L / 2, 0);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()));
  geo.translate(a.x, a.y, a.z);
  const m = new THREE.Mesh(geo, mat); g.add(m); return m;
}
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A sheave: a pair of side plates with a dark rubber-lined groove, axle along x. */
function sheave(g: THREE.Object3D, M: ReturnType<typeof createMaterials>, frame: THREE.Material, x: number, y: number, z: number, r: number) {
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(r * 0.86, r * 0.16, 6, 18), M.rubber);
  tyre.rotation.y = Math.PI / 2; tyre.position.set(x, y, z); g.add(tyre);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.07, 16), frame);
  disc.rotation.z = Math.PI / 2; disc.position.set(x, y, z); g.add(disc);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.25, r * 0.25, 0.16, 8), M.galvDark);
  hub.rotation.z = Math.PI / 2; hub.position.set(x, y, z); g.add(hub);
}

/** Sheave train (rocker beam with n wheels) whose wheel tops carry the rope at `ropeY`, centred on z. */
function sheaveTrain(g: THREE.Object3D, M: ReturnType<typeof createMaterials>, frame: THREE.Material, x: number, ropeY: number, n: number, r = 0.2, below = true) {
  const pitch = r * 2.15;
  const cy = below ? ropeY - r * 0.95 : ropeY + r * 0.95;
  const len = pitch * (n - 1);
  for (let i = 0; i < n; i++) sheave(g, M, frame, x, cy, -len / 2 + i * pitch, r);
  // side plates of the rocker on the tower side
  box(g, frame, 0.05, r * 0.9, len + r * 1.6, x - 0.14, cy, 0);
  box(g, frame, 0.05, r * 0.6, len + r * 1.2, x + 0.14, cy - r * 0.2, 0);
  return cy;
}

/** Horizontal open bullwheel: channel rim with liner, I-section spokes and hub. Centre at origin. */
function bullwheel(g: THREE.Object3D, M: ReturnType<typeof createMaterials>, frame: THREE.Material, y: number, spokes = 8, capped = false) {
  const R = HALF;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.1, R + 0.1, 0.36, 64, 1, true), frame);
  rim.position.y = y; g.add(rim);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.12, R - 0.12, 0.36, 64, 1, true), frame);
  inner.position.y = y; g.add(inner);
  for (const dy of [-0.18, 0.18]) {
    const flange = new THREE.Mesh(new THREE.RingGeometry(R - 0.12, R + 0.16, 64), frame);
    flange.rotation.x = dy < 0 ? Math.PI / 2 : -Math.PI / 2; flange.position.y = y + dy; g.add(flange);
  }
  const liner = new THREE.Mesh(new THREE.TorusGeometry(R + 0.04, 0.06, 6, 72), M.rubber);
  liner.rotation.x = Math.PI / 2; liner.position.y = y; g.add(liner);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    beam(g, frame, v(c * 0.45, y, s * 0.45), v(c * (R - 0.1), y, s * (R - 0.1)), 0.12, 0.3);
    // web stiffener plates near the rim
    box(g, frame, 0.3, 0.06, 0.5, c * (R - 0.4), y - 0.12, s * (R - 0.4), 0, -a, 0);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.62, 18), frame);
  hub.position.y = y; g.add(hub);
  if (capped) {
    // Riblet terminals: a shallow conical cap over the wheel
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.6, R + 0.25, 0.55, 40, 1, false), frame);
    cap.position.y = y + 0.48; g.add(cap);
  }
}

/** Ladder with side rails and rungs from y0 to y1 at (x, z), facing along `along`. */
function ladder(g: THREE.Object3D, mat: THREE.Material, x: number, z: number, y0: number, y1: number, along: 'x' | 'z' = 'z', cage = false) {
  const w = 0.22;
  for (const s of [-1, 1]) {
    const a = along === 'z' ? v(x + s * w, y0, z) : v(x, y0, z + s * w);
    const b = along === 'z' ? v(x + s * w, y1, z) : v(x, y1, z + s * w);
    rod(g, mat, a, b, 0.025, 0.025, 5);
  }
  for (let y = y0 + 0.3; y < y1; y += 0.3) {
    const a = along === 'z' ? v(x - w, y, z) : v(x, y, z - w), b = along === 'z' ? v(x + w, y, z) : v(x, y, z + w);
    rod(g, mat, a, b, 0.012, 0.012, 4);
  }
  if (cage) for (let y = y0 + 2.4; y < y1; y += 0.9) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.015, 4, 14, Math.PI), mat);
    hoop.position.set(x, y, z); hoop.rotation.x = Math.PI / 2; if (along === 'x') hoop.rotation.z = Math.PI / 2; g.add(hoop);
  }
}

// ---------- towers ----------
/**
 * Tower in local coordinates: origin at ground on the lift centreline, +z uphill along the line, ropes at
 * x = +/-HALF and height `h` above the base. `pitch` is the local line slope (rad) for the crossarm trim.
 */
export function buildTower(style: LiftStyle, h: number, index: number, depthBelow: number) {
  const M = structureMaterials();
  const g = new THREE.Group();
  const colliders: { x: number; z: number; r: number }[] = [];
  if (style === 'tercero') {
    // black Riblet pipe, T crossarm with 4-wheel trains, chair guard ring on alternate towers
    rod(g, M.black, v(0, -depthBelow, 0), v(0, h + 0.85, 0), 0.24, 0.2, 14);
    const capY = h + 0.85;
    rod(g, M.black, v(-HALF + 0.15, capY, 0), v(HALF - 0.15, capY, 0), 0.14, 0.14, 10);
    for (const s of [-1, 1]) {
      // knee braces
      beam(g, M.black, v(0, capY - 1.4, 0), v(s * (HALF - 0.8), capY - 0.05, 0), 0.1);
      // hanger post down to the sheave train
      beam(g, M.black, v(s * (HALF - 0.3), capY, 0), v(s * (HALF - 0.3), h - 0.2, 0), 0.1);
      beam(g, M.black, v(s * (HALF - 0.3), h - 0.25, 0), v(s * (HALF - 0.05), h - 0.25, 0), 0.08);
      sheaveTrain(g, M, M.black, s * HALF, h, 4, 0.21);
    }
    if (index % 2 === 0) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 6, 48), M.black);
      ring.scale.set(HALF + 1.5, 1.6, 1); ring.rotation.x = Math.PI / 2; ring.position.y = h - 1.25; g.add(ring);
      for (const s of [-1, 1]) beam(g, M.black, v(0, h - 1.25, 0), v(s * (HALF + 1.45), h - 1.25, 0), 0.07);
    }
    ladder(g, M.black, 0, -0.3, 0.6, h + 0.6, 'z');
    colliders.push({ x: 0, z: 0, r: 0.3 });
    return { object: g, colliders };
  }
  // Leitner-Poma galvanized tube tower with padded base, platform head and 6-wheel trains
  const frame = M.galv;
  const topY = h + 1.05;
  rod(g, frame, v(0, -depthBelow, 0), v(0, topY - 0.35, 0), 0.34, 0.27, 18);
  // base flange and yellow tower pad
  rod(g, M.concrete, v(0, -depthBelow, 0), v(0, 0.25, 0), 0.75, 0.75, 16);
  box(g, M.yellow, 0.95, 2.1, 0.95, 0, 1.3, 0);
  // head: crossarm box beam under a grated platform with railings
  beam(g, frame, v(-HALF + 0.35, topY - 0.25, 0), v(HALF - 0.35, topY - 0.25, 0), 0.42, 0.36);
  for (const s of [-1, 1]) beam(g, frame, v(0, topY - 1.6, 0), v(s * 1.4, topY - 0.45, 0), 0.16);
  box(g, M.galvDark, GAUGE - 0.6, 0.05, 1.5, 0, topY, 0);
  for (const zs of [-0.72, 0.72]) {
    rod(g, frame, v(-HALF + 0.3, topY + 1.05, zs), v(HALF - 0.3, topY + 1.05, zs), 0.025, 0.025, 6);
    rod(g, frame, v(-HALF + 0.3, topY + 0.55, zs), v(HALF - 0.3, topY + 0.55, zs), 0.02, 0.02, 6);
    for (let x = -HALF + 0.3; x <= HALF - 0.29; x += (GAUGE - 0.6) / 4) rod(g, frame, v(x, topY, zs), v(x, topY + 1.05, zs), 0.022, 0.022, 5);
  }
  for (const s of [-1, 1]) {
    // trains hang from the arm ends on the tower side of the rope so carrier hangers pass outside
    beam(g, frame, v(s * (HALF - 0.42), topY - 0.4, 0), v(s * (HALF - 0.42), h - 0.15, 0), 0.14, 0.24);
    beam(g, frame, v(s * (HALF - 0.42), h - 0.22, 0), v(s * (HALF - 0.12), h - 0.22, 0), 0.1, 0.24);
    sheaveTrain(g, M, frame, s * HALF, h, 6, 0.2);
  }
  // tower number plate
  box(g, M.yellow, 0.36, 0.42, 0.03, 0, topY - 0.75, -0.3);
  ladder(g, frame, 0, -0.36, 2.4, topY, 'z', true);
  colliders.push({ x: 0, z: 0, r: 0.45 });
  return { object: g, colliders };
}

// ---------- terminals ----------
/**
 * Terminal in local coordinates: origin on the ground below the bullwheel centre, +z toward the line,
 * ropes leave at x = +/-HALF, rope height `h` above the origin. Returns world-free colliders in local x/z.
 */
export function buildTerminal(style: LiftStyle, top: boolean, h: number, depthBelow: number) {
  const M = structureMaterials();
  const g = new THREE.Group();
  const colliders: { x: number; z: number; r: number }[] = [];
  const kind = style === 'tercero' ? 'riblet' : (style === 'primo') === top ? 'drive' : 'return';
  if (kind === 'return') {
    // open spoked bullwheel on one leaning box column (Primo bottom galvanized, Segundo top green)
    const frame = style === 'primo' ? M.galv : M.green;
    bullwheel(g, M, frame, h, 8);
    // carriage: box girder from the hub to a line-guide sheave beam ahead of the wheel
    beam(g, frame, v(0, h + 0.5, -0.6), v(0, h + 0.5, HALF + 3.4), 0.7, 0.55);
    beam(g, frame, v(-HALF - 0.1, h + 0.62, HALF + 2.6), v(HALF + 0.1, h + 0.62, HALF + 2.6), 0.32, 0.36);
    for (const s of [-1, 1]) {
      beam(g, frame, v(s * (HALF - 0.3), h + 0.62, HALF + 2.6), v(s * (HALF - 0.3), h + 0.25, HALF + 2.6), 0.12, 0.2);
      const t = new THREE.Group(); t.position.set(0, 0, HALF + 2.6); g.add(t);
      sheaveTrain(t, M, frame, s * HALF, h, 4, 0.18);
      // rope catcher horn
      beam(g, frame, v(s * (HALF + 0.25), h + 0.3, HALF + 1.8), v(s * (HALF + 0.25), h - 0.5, HALF + 3.4), 0.06);
    }
    // cross frame on top of the wheel (Segundo) / hub housing (Primo)
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      beam(g, frame, v(0, h + 0.42, 0), v(Math.cos(a) * 1.6, h + 0.3, Math.sin(a) * 1.6), 0.22, 0.2);
    }
    // single tapered column leaning back from the line, with a diagonal strut
    beam(g, frame, v(0, -depthBelow, -0.9), v(0, h - 0.3, 0), 0.7, 0.55);
    beam(g, frame, v(0, 0.2, -2.0), v(0, h - 0.8, -0.2), 0.3);
    box(g, M.concrete, 1.6, depthBelow, 2.4, 0, -depthBelow / 2 + 0.02, -1.2);
    if (style === 'segundo') box(g, M.yellow, 0.95, 2.1, 0.95, 0, 1.05, -0.75);
    colliders.push({ x: 0, z: -0.9, r: 0.65 }, { x: 0, z: -2.0, r: 0.3 });
    return { object: g, colliders, kind };
  }
  if (kind === 'drive') {
    // curved drive housing on two long tubes with an A-frame of legs
    const tubeMat = style === 'primo' ? M.galv : M.green;
    const ty = h + 1.15;
    for (const s of [-1, 1]) {
      const x = s * (HALF - 0.25);
      rod(g, tubeMat, v(x, ty, -4.6), v(x, ty, HALF + 4.3), 0.33, 0.33, 18);
      const cap = new THREE.Mesh(new THREE.CircleGeometry(0.33, 18), M.cap);
      cap.position.set(x, ty, HALF + 4.31); g.add(cap);
      // back ends turn down
      rod(g, tubeMat, v(x, ty, -4.6), v(x, ty - 1.3, -5.2), 0.3, 0.26, 14);
      // line-side sheave assemblies hang under the tubes ahead of the wheel
      for (const zc of [HALF + 1.2, HALF + 3.2]) {
        const t = new THREE.Group(); t.position.set(0, 0, zc); g.add(t);
        beam(t, tubeMat, v(x, ty - 0.3, 0), v(x, h + 0.35, 0), 0.12, 0.3);
        sheaveTrain(t, M, tubeMat, s * HALF, h, 4, 0.18, false);
      }
    }
    // cross tubes
    for (const z of [-3.4, 0.2, HALF + 2.2]) rod(g, tubeMat, v(-HALF + 0.25, ty - 0.2, z), v(HALF - 0.25, ty - 0.2, z), 0.2, 0.2, 12);
    // A-frame legs on the centreline, splayed along the line (box sections)
    beam(g, tubeMat, v(0, -depthBelow, 4.0), v(0, ty - 0.35, 0.9), 0.62, 0.5);
    beam(g, tubeMat, v(0, -depthBelow, -4.4), v(0, ty - 0.35, -1.2), 0.62, 0.5);
    beam(g, tubeMat, v(-1.2, ty - 0.45, -0.2), v(1.2, ty - 0.45, -0.2), 0.5, 0.5);
    for (const z of [4.0, -4.4]) box(g, M.concrete, 1.4, depthBelow, 1.4, 0, -depthBelow / 2 + 0.02, z);
    // bullwheel (partly visible under the housing) and drive shaft/gearbox
    bullwheel(g, M, M.green, h, 8);
    rod(g, M.galvDark, v(0, h, 0), v(0, ty + 0.4, 0), 0.32, 0.32, 14);
    // housing: loaf-shaped cross-section extruded along the line
    const W = 3.9, Hh = 2.55, rr = 1.25, L = 6.8;
    const shape = new THREE.Shape();
    shape.moveTo(-W / 2, 0); shape.lineTo(W / 2, 0); shape.lineTo(W / 2, Hh - rr);
    shape.absarc(W / 2 - rr, Hh - rr, rr, 0, Math.PI / 2, false);
    shape.lineTo(-W / 2 + rr, Hh);
    shape.absarc(-W / 2 + rr, Hh - rr, rr, Math.PI / 2, Math.PI, false);
    shape.closePath();
    const hb = ty + 0.3;
    const housing = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false, curveSegments: 12 }), M.green);
    housing.position.set(0, hb, -L / 2 - 0.6); g.add(housing);
    // smoked window band over each curved shoulder, with mullions
    for (const s of [-1, 1]) {
      const cx = s * (W / 2 - rr), a0 = 0.12, a1 = 1.38;
      const from = s > 0 ? a0 : Math.PI - a1, to = s > 0 ? a1 : Math.PI - a0;
      const band = new THREE.Shape();
      band.absarc(cx, Hh - rr, rr + 0.02, from, to, false);
      band.absarc(cx, Hh - rr, rr - 0.04, to, from, true);
      const glass = new THREE.Mesh(new THREE.ExtrudeGeometry(band, { depth: L - 1.1, bevelEnabled: false, curveSegments: 12 }), M.glass);
      glass.position.set(0, hb, -L / 2 - 0.05); g.add(glass);
      const am = (from + to) / 2, arcLen = rr * (a1 - a0);
      for (let i = 0; i <= 6; i++) {
        box(g, M.green, 0.08, arcLen, 0.09, cx + Math.cos(am) * (rr + 0.04), hb + Hh - rr + Math.sin(am) * (rr + 0.04),
          -L / 2 - 0.05 + i * (L - 1.1) / 6, 0, 0, am);
      }
    }
    // corrugated end walls with a vent louvre at the back
    const endBack = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), M.louvre);
    endBack.position.set(0, hb, -L / 2 - 0.62); endBack.rotation.y = Math.PI; g.add(endBack);
    const endFront = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), M.green);
    endFront.position.set(0, hb, L / 2 - 0.58); g.add(endFront);
    // service ladder up the side
    ladder(g, M.galv, HALF + 0.12, -5.0, 0.2, ty - 0.3, "z");
    colliders.push({ x: 0, z: 4.0, r: 0.5 }, { x: 0, z: -4.4, r: 0.5 });
    return { object: g, colliders, kind };
  }
  // Riblet: black column with a capped bullwheel and a portal frame of line sheaves ahead of it
  bullwheel(g, M, M.black, h, 6, true);
  rod(g, M.black, v(0, -depthBelow, -0.4), v(0, h - 0.25, 0), 0.42, 0.36, 16);
  beam(g, M.black, v(0, h + 0.2, -0.3), v(0, h + 0.2, HALF + 1.8), 0.4, 0.4);
  // portal beyond the load/unload line; posts stay outside the swinging carriers
  const pz = HALF + 9.5, px = HALF + 1.9;
  for (const s of [-1, 1]) {
    beam(g, M.black, v(s * px, -depthBelow, pz), v(s * px, h + 1.4, pz), 0.3, 0.3);
    beam(g, M.black, v(s * (HALF - 0.35), h + 1.25, pz), v(s * (HALF - 0.35), h - 0.15, pz), 0.12, 0.22);
    const t = new THREE.Group(); t.position.set(0, 0, pz); g.add(t);
    sheaveTrain(t, M, M.black, s * HALF, h, 4, 0.2);
    colliders.push({ x: s * px, z: pz, r: 0.3 });
  }
  beam(g, M.black, v(-px - 0.15, h + 1.4, pz), v(px + 0.15, h + 1.4, pz), 0.34, 0.4);
  box(g, M.concrete, 1.4, depthBelow, 1.4, 0, -depthBelow / 2 + 0.02, -0.4);
  colliders.push({ x: 0, z: -0.4, r: 0.5 });
  return { object: g, colliders, kind };
}

// ---------- operator huts ----------
/** Operator hut with its floor at the origin. Returns half extents for the box collider. */
export function buildHut(style: LiftStyle, top: boolean) {
  const M = structureMaterials();
  const g = new THREE.Group();
  const w = style === 'tercero' ? 3.4 : 3.0, d = style === 'tercero' ? 3.8 : 3.4, h = 2.7;
  const walls = style === 'tercero' ? M.hutStucco : style === 'primo' ? M.hutGreen : M.hutPlain;
  // [px, nx, py, ny, pz, nz]: door faces +z (toward the line)
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [walls[0], walls[0], M.concrete, M.concrete, walls[1], walls[0]]);
  body.position.y = h / 2; body.userData.keep = true; body.castShadow = true; body.receiveShadow = true; g.add(body);
  // footing hides any slope under the floor
  box(g, M.concrete, w + 0.15, 3.0, d + 0.15, 0, -1.45, 0);
  const gable = style === 'primo' || (style === 'tercero');
  const roofMat = style === 'tercero' ? M.rustRoof : M.greenRoof;
  if (gable) {
    const pitch = 0.5, over = 0.35;
    const half = (w / 2 + over) / Math.cos(pitch);
    for (const s of [-1, 1]) {
      const panel = box(g, roofMat, half, 0.08, d + over * 2, s * (w / 4 + over / 2) * 0.98, h + Math.tan(pitch) * (w / 4) + 0.02, 0, 0, 0, -s * pitch);
      panel.castShadow = true;
    }
    // gable end triangles
    const tri = new THREE.Shape(); tri.moveTo(-w / 2, 0); tri.lineTo(w / 2, 0); tri.lineTo(0, Math.tan(pitch) * w / 2); tri.closePath();
    for (const z of [-d / 2, d / 2]) {
      const m = new THREE.Mesh(new THREE.ShapeGeometry(tri), walls[0]);
      m.position.set(0, h, z); if (z < 0) m.rotation.y = Math.PI; g.add(m);
    }
    // snow load on the roof
    for (const s of [-1, 1]) box(g, new THREE.MeshStandardNodeMaterial({ color: 0xf2f5f8, roughness: 0.9 }), half * 0.9, 0.12, d + over * 1.6, s * (w / 4 + over / 2) * 0.98, h + Math.tan(pitch) * (w / 4) + 0.11, 0, 0, 0, -s * pitch);
  } else {
    box(g, roofMat, w + 0.5, 0.18, d + 0.5, 0, h + 0.09, 0);
    box(g, new THREE.MeshStandardNodeMaterial({ color: 0xf2f5f8, roughness: 0.9 }), w + 0.4, 0.22, d + 0.4, 0, h + 0.29, 0);
  }
  // control pedestal and stop sign by the door
  box(g, M.galv, 0.25, 1.1, 0.2, w / 2 - 0.3, 0.55, d / 2 + 0.9);
  box(g, M.galvDark, 0.4, 0.3, 0.3, w / 2 - 0.3, 1.2, d / 2 + 0.9);
  return { object: g, hx: w / 2 + 0.1, hz: d / 2 + 0.1, height: h + 1 };
}
