// @ts-nocheck -- TSL node graphs: @types/three node typings are too strict to be useful here.
// Sunlight Mountain Main Lodge, rebuilt from data rather than as a decorated box:
//  - footprint: the 2023 NAIP roof trace (main block 31.0 x 15.5 m, long axis N-S, yaw -1.83 rad);
//  - heights: 2016 USGS lidar first returns. Main roof 2493.07 m (3.7 m above the upper floor),
//    east two-storey section roof 6.6 m above it, south-west annex single storey; bare-earth grade
//    falls from the upper floor level at the south end to about 6 m below it at the north end;
//  - arrangement: reference photo from the snow south of the lodge shows (left to right) the signed
//    annex with blue trim, the glazed storefront and sun deck, and the darker glazed east section.
// So the upper (deck) level meets the snow on the south, and a walk-out lower level opens to the
// west grade facing the lifts. Interior finishes follow the reference interiors (exposed dark timber
// beams under a plank ceiling, sage walls over knotty-pine wainscot, wood bar, carpeted dining).
// Room layout, furniture and fittings are plausible estimates, not surveyed plans (DECISIONS.md D20).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mx_noise_float, positionWorld, normalWorld, vec3, float, texture, dot, normalize, max, color as tslColor } from 'three/tsl';
import type { ColliderGrid } from '../../../shared/collision';
import { headingFromDir } from '../../../shared/skiPhysics';
import { toWorld } from '../../../shared/walk';
import { walkable } from './walkable';
import type { BuildingDef } from './sunlightBuildings';

// ---------------------------------------------------------------- textures
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function rng(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

const pine = () => canvasTex(512, 512, (g) => {
  const r = rng(11);
  for (let y = 0; y < 512; y += 64) { // 0.25 m tongue-and-groove boards (texture spans 2 m)
    const base = 150 + r() * 30;
    g.fillStyle = `rgb(${base + 40 | 0},${base + 2 | 0},${base * 0.55 | 0})`; g.fillRect(0, y, 512, 64);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(120,70,30,${0.08 + r() * 0.1})`; g.fillRect(0, y + r() * 64, 512, 1 + r() * 2); }
    for (let k = 0; k < 2; k++) {
      const x = r() * 512, yy = y + 12 + r() * 40;
      g.fillStyle = 'rgba(90,50,20,0.75)'; g.beginPath(); g.ellipse(x, yy, 5 + r() * 6, 3 + r() * 3, 0, 0, 6.3); g.fill();
      g.strokeStyle = 'rgba(110,60,25,0.35)'; g.lineWidth = 2; g.beginPath(); g.ellipse(x, yy, 14, 7, 0, 0, 6.3); g.stroke();
    }
    g.fillStyle = 'rgba(60,35,15,0.6)'; g.fillRect(0, y, 512, 3);
  }
});
const ceilingPlanks = () => canvasTex(512, 512, (g) => {
  const r = rng(23);
  for (let x = 0; x < 512; x += 32) {
    const b = 160 + r() * 35; g.fillStyle = `rgb(${b + 30 | 0},${b | 0},${b * 0.62 | 0})`; g.fillRect(x, 0, 32, 512);
    g.fillStyle = 'rgba(70,40,20,0.5)'; g.fillRect(x, 0, 2, 512);
    for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(110,65,30,${r() * 0.15})`; g.fillRect(x + r() * 30, 0, 1, 512); }
  }
});
const carpet = () => canvasTex(256, 256, (g) => {
  const r = rng(5);
  g.fillStyle = '#6e5f4f'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) { const v = 75 + r() * 45; g.fillStyle = `rgba(${v + 18 | 0},${v + 8 | 0},${v | 0},0.5)`; g.fillRect(r() * 256, r() * 256, 1.5, 1.5); }
  g.strokeStyle = 'rgba(120,96,64,0.35)'; g.lineWidth = 3;
  for (let k = 0; k < 256; k += 64) { g.strokeRect(k + 8, 8, 48, 240); }
});
const woodFloor = () => canvasTex(512, 512, (g) => {
  const r = rng(31);
  for (let y = 0; y < 512; y += 24) {
    let x = -r() * 200;
    while (x < 512) { const L = 120 + r() * 200, b = 110 + r() * 40; g.fillStyle = `rgb(${b + 40 | 0},${b + 8 | 0},${b * 0.55 | 0})`; g.fillRect(x, y, L, 24); g.fillStyle = 'rgba(40,24,10,0.5)'; g.fillRect(x, y, 2, 24); x += L; }
    g.fillStyle = 'rgba(40,24,10,0.45)'; g.fillRect(0, y, 512, 1.5);
  }
});
const concreteFloor = () => canvasTex(256, 256, (g) => {
  const r = rng(41); g.fillStyle = '#8d8b86'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) { const v = 120 + r() * 40; g.fillStyle = `rgba(${v},${v},${v - 4},0.25)`; g.fillRect(r() * 256, r() * 256, 2 + r() * 4, 2 + r() * 4); }
  g.fillStyle = 'rgba(40,40,40,0.35)'; g.fillRect(0, 0, 256, 2); g.fillRect(0, 0, 2, 256);
});
const deckBoards = () => canvasTex(512, 256, (g) => {
  const r = rng(53);
  for (let y = 0; y < 256; y += 18) { const b = 100 + r() * 30; g.fillStyle = `rgb(${b + 30 | 0},${b + 5 | 0},${b * 0.7 | 0})`; g.fillRect(0, y, 512, 15); g.fillStyle = 'rgba(30,20,12,0.9)'; g.fillRect(0, y + 15, 512, 3); }
});
function signTex(lines: { text: string; size: number; color?: string; y: number; font?: string }[], bg: string, w = 1024, h = 256, logo = false) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (logo) { // generic sun mark: a half sun over a blue band (not a reproduction of the resort logo artwork)
      g.fillStyle = '#1f5fae'; g.fillRect(40, h * 0.62, 190, h * 0.1);
      g.fillStyle = '#f2a51a'; g.beginPath(); g.arc(135, h * 0.62, 70, Math.PI, 0); g.fill();
      g.strokeStyle = '#f2a51a'; g.lineWidth = 9;
      for (let i = 0; i < 7; i++) { const a = Math.PI + (i + 0.5) / 7 * Math.PI; g.beginPath(); g.moveTo(135 + Math.cos(a) * 82, h * 0.62 + Math.sin(a) * 82); g.lineTo(135 + Math.cos(a) * 104, h * 0.62 + Math.sin(a) * 104); g.stroke(); }
    }
    for (const l of lines) { g.fillStyle = l.color ?? '#222'; g.font = l.font ?? `bold ${l.size}px Helvetica, Arial, sans-serif`; g.textAlign = logo ? 'left' : 'center'; g.textBaseline = 'middle'; g.fillText(l.text, logo ? 260 : w / 2, l.y, w - 60); }
  }, false);
}

// ---------------------------------------------------------------- materials
interface Lamp { p: THREE.Vector3; i: number }
let lampsWorld: Lamp[] = [];
const WARM = new THREE.Color(1.0, 0.78, 0.52);

/** Interior surfaces: sky light mostly occluded (ambient occlusion) plus warm light from the listed lamps. */
function interior(opts: { color?: number; map?: THREE.Texture; roughness?: number; metalness?: number; worldUV?: number; sky?: number; side?: THREE.Side }) {
  const m = new THREE.MeshStandardNodeMaterial({ color: opts.color ?? 0xffffff, map: opts.map ?? null, roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0, side: opts.side ?? THREE.FrontSide });
  m.userData.worldUV = opts.worldUV ?? 0;
  m.userData.interior = true;
  m.userData.sky = opts.sky ?? 0.34;
  return m;
}
function finishInterior(m: THREE.MeshStandardNodeMaterial) {
  if (!m.userData.interior || m.userData.lit) return;
  m.userData.lit = true;
  const albedo = (m.map ? texture(m.map).rgb : vec3(1)).mul(tslColor(m.color));
  let sum = float(0);
  for (const l of lampsWorld) {
    const d = vec3(l.p.x, l.p.y, l.p.z).sub(positionWorld);
    const r2 = dot(d, d).add(0.35);
    const ndl = max(dot(normalWorld, normalize(d)), 0).mul(0.8).add(0.2);
    sum = sum.add(ndl.mul(l.i).div(r2));
  }
  m.emissiveNode = albedo.mul(vec3(WARM.r, WARM.g, WARM.b)).mul(sum).mul(0.5);
  m.aoNode = float(m.userData.sky);
}

const stucco = (hex: number, sc = 3) => {
  const m = new THREE.MeshStandardNodeMaterial({ color: hex, roughness: 0.93 });
  const c = new THREE.Color(hex);
  const n = mx_noise_float(positionWorld.mul(sc)).mul(0.5).add(0.5), f = mx_noise_float(positionWorld.mul(sc * 9)).mul(0.5).add(0.5);
  m.colorNode = vec3(c.r, c.g, c.b).mul(n.mul(0.05).add(f.mul(0.04)).add(0.93));
  return m;
};

function materials() {
  return {
    stuccoCream: stucco(0xe2d5b3), stuccoBeige: stucco(0xd2bf98), concrete: stucco(0x8e8a82, 1.5),
    trim: new THREE.MeshStandardNodeMaterial({ color: 0x4a3426, roughness: 0.8 }),
    fascia: new THREE.MeshStandardNodeMaterial({ color: 0x5b3b2a, roughness: 0.75 }),
    blueTrim: new THREE.MeshStandardNodeMaterial({ color: 0x2c63a8, roughness: 0.55, metalness: 0.2 }),
    roofMembrane: new THREE.MeshStandardNodeMaterial({ color: 0x8f9293, roughness: 0.9 }),
    snow: new THREE.MeshStandardNodeMaterial({ color: 0xf1f5f9, roughness: 0.92 }),
    bronze: new THREE.MeshStandardNodeMaterial({ color: 0x2f2a25, roughness: 0.42, metalness: 0.6 }),
    glass: new THREE.MeshStandardNodeMaterial({ color: 0x8aa2ad, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }),
    darkGlass: new THREE.MeshStandardNodeMaterial({ color: 0x141a1e, roughness: 0.05, metalness: 0.55 }),
    redDoor: new THREE.MeshStandardNodeMaterial({ color: 0xa0262a, roughness: 0.55 }),
    steel: new THREE.MeshStandardNodeMaterial({ color: 0x9aa0a4, roughness: 0.35, metalness: 0.85 }),
    hvac: new THREE.MeshStandardNodeMaterial({ color: 0xb5b3aa, roughness: 0.6, metalness: 0.4 }),
    deck: new THREE.MeshStandardNodeMaterial({ map: deckBoards(), roughness: 0.92 }),
    deckRail: new THREE.MeshStandardNodeMaterial({ color: 0x6b4630, roughness: 0.88 }),
    awning: new THREE.MeshStandardNodeMaterial({ color: 0xa3302a, roughness: 0.85, side: THREE.DoubleSide }),
    picnic: new THREE.MeshStandardNodeMaterial({ color: 0x7a5a3c, roughness: 0.9 }),
    // interior
    pineWall: interior({ map: pine(), worldUV: 2 }),
    sage: interior({ color: 0x8a9b78, roughness: 0.92 }),
    whiteWall: interior({ color: 0xdedbd2, roughness: 0.9 }),
    ceiling: interior({ map: ceilingPlanks(), worldUV: 2.2, sky: 0.22 }),
    beam: interior({ color: 0x3e2a1c, roughness: 0.8 }),
    carpet: interior({ map: carpet(), worldUV: 1.6, roughness: 0.98 }),
    woodFloor: interior({ map: woodFloor(), worldUV: 3, roughness: 0.55 }),
    concFloor: interior({ map: concreteFloor(), worldUV: 2.5, roughness: 0.45 }),
    tableTop: interior({ color: 0x8a5a34, roughness: 0.45 }),
    darkWood: interior({ color: 0x4a2f1f, roughness: 0.6 }),
    chairWood: interior({ color: 0x9a6b42, roughness: 0.6 }),
    stainless: interior({ color: 0xb9bdbf, roughness: 0.25, metalness: 0.9 }),
    blackMetal: interior({ color: 0x1e1f21, roughness: 0.5, metalness: 0.6 }),
    vinyl: interior({ color: 0x2a2826, roughness: 0.6 }),
    locker: interior({ color: 0x3d5a73, roughness: 0.45, metalness: 0.5 }),
    rentalSki: interior({ color: 0xd8dde2, roughness: 0.35 }),
    rentalSkiBlue: interior({ color: 0x2f6db5, roughness: 0.35 }),
    rentalSkiBlack: interior({ color: 0x24262a, roughness: 0.35 }),
    bootPlastic: interior({ color: 0x27292c, roughness: 0.4 }),
    food: interior({ color: 0xb8742e, roughness: 0.6 }),
    bottle: interior({ color: 0x3f6a3a, roughness: 0.15, metalness: 0.2 }),
    tile: interior({ color: 0xcfcac0, roughness: 0.3 }),
    fridgeGlow: new THREE.MeshStandardNodeMaterial({ color: 0x223040, emissive: 0xd8ecff, emissiveIntensity: 0.9, roughness: 0.2 }),
    heatLamp: new THREE.MeshStandardNodeMaterial({ color: 0x331a0c, emissive: 0xff8a33, emissiveIntensity: 2.4 }),
    bulb: new THREE.MeshStandardNodeMaterial({ color: 0x2a2015, emissive: 0xffc27a, emissiveIntensity: 3.5 }),
    screen: new THREE.MeshStandardNodeMaterial({ color: 0x0a0c10, emissive: 0x3a6fa8, emissiveIntensity: 0.6, roughness: 0.2 }),
  };
}
type Mats = ReturnType<typeof materials>;

// ---------------------------------------------------------------- builder
const NO_SHADOW_KEYS = ['glass', 'fridgeGlow', 'heatLamp', 'bulb', 'screen', 'snow'];
class Kit {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private noShadow = new Set<THREE.Material>();
  constructor(public M: Mats) { for (const k of NO_SHADOW_KEYS) this.noShadow.add(M[k]); }
  add(geo: THREE.BufferGeometry, mat: THREE.Material, m?: THREE.Matrix4) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (m) g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const s = mat.userData?.worldUV;
    if (s) { // planar world-scale UVs chosen per face so boards and patterns keep real size
      const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
      for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
        if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i) / s, p.getZ(i) / s);
        else if (ax >= az) uv.setXY(i, p.getZ(i) / s, p.getY(i) / s);
        else uv.setXY(i, p.getX(i) / s, p.getY(i) / s);
      }
    }
    let a = this.parts.get(mat); if (!a) this.parts.set(mat, a = []); a.push(g);
  }
  box(mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.add(g, mat);
  }
  /** Box of size (w, h, d) centred at (x, y, z) rotated by ry about y. */
  obox(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    this.add(g, mat, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  }
  cyl(mat: THREE.Material, r0: number, r1: number, x: number, y0: number, y1: number, z: number, seg = 12) {
    const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg); g.translate(x, (y0 + y1) / 2, z); this.add(g, mat);
  }
  plane(mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, ry: number) {
    const g = new THREE.PlaneGeometry(w, h); this.add(g, mat, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1)));
  }
  build(group: THREE.Group) {
    for (const [mat, geos] of this.parts) {
      const merged = mergeGeometries(geos); if (!merged) continue;
      finishInterior(mat as THREE.MeshStandardNodeMaterial);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = !this.noShadow.has(mat) && !(mat as THREE.Material).transparent;
      mesh.receiveShadow = true;
      mesh.userData.keep = true;
      if ((mat as THREE.Material).transparent) mesh.renderOrder = 2;
      group.add(mesh);
      for (const g of geos) g.dispose();
    }
  }
}

// ---------------------------------------------------------------- walls with openings
interface Opening { a: number; b: number; y0: number; y1: number; door?: boolean; dark?: boolean; mullions?: number }
/**
 * Wall along an axis. `axis` 'x' runs from u0 to u1 in x at z = w; 'z' runs in z at x = w. `out` is +1 when the
 * exterior face is on the +w side. Openings cut real holes; windows get frames, mullions and glass.
 */
function wall(k: Kit, axis: 'x' | 'z', u0: number, u1: number, w: number, out: 1 | -1, y0: number, y1: number,
  extMat: THREE.Material | null, intMat: THREE.Material | null, openings: Opening[], intBand?: { mat: THREE.Material; y: number },
  t = 0.3) {
  const M = k.M;
  const B = (mat: THREE.Material, a: number, b: number, ya: number, yb: number, w0: number, w1: number) =>
    axis === 'x' ? k.box(mat, a, b, ya, yb, Math.min(w0, w1), Math.max(w0, w1)) : k.box(mat, Math.min(w0, w1), Math.max(w0, w1), ya, yb, a, b);
  const extW0 = w, extW1 = w + out * 0.0, half = w - out * t / 2, inner = w - out * t;
  const piece = (a: number, b: number, ya: number, yb: number) => {
    if (b - a < 1e-3 || yb - ya < 1e-3) return;
    if (extMat) B(extMat, a, b, ya, yb, extW0, half);
    if (intMat) {
      if (intBand && ya < intBand.y) {
        B(intBand.mat, a, b, ya, Math.min(yb, intBand.y), half, inner);
        if (yb > intBand.y) B(intMat, a, b, intBand.y, yb, half, inner);
        // chair rail
        if (yb > intBand.y) B(M.darkWood, a, b, intBand.y - 0.03, intBand.y + 0.04, inner, inner - out * 0.025);
      } else B(intMat, a, b, ya, yb, half, inner);
    } else if (extMat) B(extMat, a, b, ya, yb, half, inner);
  };
  const ops = [...openings].sort((p, q) => p.a - q.a);
  let cur = u0;
  for (const o of ops) {
    piece(cur, o.a, y0, y1);
    piece(o.a, o.b, y0, o.y0); // sill wall
    piece(o.a, o.b, o.y1, y1); // header
    // frame and glazing
    const fm = M.bronze, f = 0.07, mid = w - out * t * 0.45;
    const F = (a: number, b: number, ya: number, yb: number) => B(fm, a, b, ya, yb, mid - 0.05, mid + 0.05);
    F(o.a, o.a + f, o.y0, o.y1); F(o.b - f, o.b, o.y0, o.y1); F(o.a, o.b, o.y1 - f, o.y1);
    if (!o.door) {
      F(o.a, o.b, o.y0, o.y0 + f);
      const n = o.mullions ?? Math.max(1, Math.round((o.b - o.a) / 1.4));
      for (let i = 1; i < n; i++) { const u = o.a + (o.b - o.a) * i / n; F(u - f / 2, u + f / 2, o.y0, o.y1); }
      B(o.dark ? M.darkGlass : M.glass, o.a + f, o.b - f, o.y0 + f, o.y1 - f, mid - 0.012, mid + 0.012);
      // sill boards inside and out
      B(M.trim, o.a - 0.05, o.b + 0.05, o.y0 - 0.06, o.y0, w + out * 0.06, w);
      if (intMat) B(M.darkWood, o.a, o.b, o.y0 - 0.04, o.y0, inner, inner - out * 0.12);
    } else {
      // glazed door leaves standing open, perpendicular to the wall on the inside
      const leaf = Math.min(0.95, (o.b - o.a) / (o.b - o.a > 1.3 ? 2 : 1));
      const hinge = (u: number) => {
        const ya = o.y0 + 0.02, yb = o.y1 - 0.04, ia = inner, ib = inner - out * leaf;
        if (axis === 'x') { k.box(M.bronze, u - 0.03, u + 0.03, ya, yb, Math.min(ia, ib), Math.max(ia, ib)); k.box(M.glass, u - 0.01, u + 0.01, ya + 0.1, yb - 0.1, Math.min(ia, ib) + 0.08, Math.max(ia, ib) - 0.08); }
        else { k.box(M.bronze, Math.min(ia, ib), Math.max(ia, ib), ya, yb, u - 0.03, u + 0.03); k.box(M.glass, Math.min(ia, ib) + 0.08, Math.max(ia, ib) - 0.08, ya + 0.1, yb - 0.1, u - 0.01, u + 0.01); }
      };
      hinge(o.a + 0.04); if (o.b - o.a > 1.3) hinge(o.b - 0.04);
      // threshold
      B(M.steel, o.a, o.b, o.y0, o.y0 + 0.015, w + out * 0.02, inner);
    }
    cur = o.b;
  }
  piece(cur, u1, y0, y1);
}

/** Collision boxes for a wall line with door gaps (windows block like walls). */
function wallColliders(add: (lx0: number, lx1: number, lz0: number, lz1: number, y0: number, y1: number) => void,
  axis: 'x' | 'z', u0: number, u1: number, w: number, out: 1 | -1, y0: number, y1: number, doors: Opening[], t = 0.3) {
  const segs: [number, number][] = []; let cur = u0;
  for (const d of [...doors].sort((p, q) => p.a - q.a)) { segs.push([cur, d.a]); cur = d.b; }
  segs.push([cur, u1]);
  const wa = Math.min(w, w - out * t), wb = Math.max(w, w - out * t);
  for (const [a, b] of segs) if (b - a > 0.05) axis === 'x' ? add(a, b, wa, wb, y0, y1) : add(wa, wb, a, b, y0, y1);
  // short wall above each door
  for (const d of doors) if (d.y1 < y1 - 0.1) axis === 'x' ? add(d.a, d.b, wa, wb, d.y1, y1) : add(wa, wb, d.a, d.b, d.y1, y1);
}

// ---------------------------------------------------------------- furniture
function chair(k: Kit, x: number, y: number, z: number, ry: number) {
  const M = k.M, m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
  const part = (w: number, h: number, d: number, px: number, py: number, pz: number, mat = M.chairWood) => {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(px, py, pz); k.add(g, mat, m);
  };
  part(0.44, 0.04, 0.42, 0, 0.45, 0);
  for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) part(0.035, 0.45, 0.035, lx, 0.225, lz);
  for (const lx of [-0.19, 0.19]) part(0.035, 0.45, 0.035, lx, 0.69, 0.19);
  part(0.42, 0.1, 0.03, 0, 0.84, 0.19); part(0.42, 0.06, 0.03, 0, 0.62, 0.19);
}
function diningTable(k: Kit, x: number, y: number, z: number, ry: number, seats: number) {
  const M = k.M;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
  const L = seats > 4 ? 1.9 : 1.2;
  const add = (g: THREE.BufferGeometry, mat: THREE.Material) => k.add(g, mat, m);
  const top = new THREE.BoxGeometry(L, 0.05, 0.85); top.translate(0, 0.74, 0); add(top, M.tableTop);
  for (const s of [-1, 1]) {
    for (const t of [-0.28, 0.28]) { const leg = new THREE.BoxGeometry(0.045, 0.72, 0.045); leg.translate(s * (L / 2 - 0.22), 0.36, t); add(leg, M.blackMetal); }
    const foot = new THREE.BoxGeometry(0.05, 0.04, 0.66); foot.translate(s * (L / 2 - 0.22), 0.02, 0); add(foot, M.blackMetal);
    const rail = new THREE.BoxGeometry(0.04, 0.05, 0.6); rail.translate(s * (L / 2 - 0.22), 0.69, 0); add(rail, M.blackMetal);
  }
  const stretcher = new THREE.BoxGeometry(L - 0.44, 0.04, 0.04); stretcher.translate(0, 0.25, 0); add(stretcher, M.blackMetal);
  const n = seats / 2;
  const out: { x: number; z: number; h: number }[] = [];
  for (let i = 0; i < n; i++) for (const side of [-1, 1]) {
    const lx = -L / 2 + L * (i + 0.5) / n, lz = side * 0.62;
    const c = new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    const h = ry + (side > 0 ? 0 : Math.PI);
    chair(k, x + c.x, y, z + c.z, h);
    out.push({ x: x + c.x, z: z + c.z, h });
  }
  return out;
}
function picnicTable(k: Kit, x: number, y: number, z: number, ry: number) {
  const M = k.M, m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
  const part = (w: number, h: number, d: number, px: number, py: number, pz: number, rx = 0) => {
    const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(px, py, pz); k.add(g, M.picnic, m);
  };
  for (let i = 0; i < 4; i++) part(1.8, 0.04, 0.17, 0, 0.75, -0.27 + i * 0.18);
  for (const s of [-1, 1]) { part(1.8, 0.04, 0.26, 0, 0.45, s * 0.72); for (const e of [-0.65, 0.65]) { part(0.07, 0.95, 0.07, e, 0.42, s * 0.36, s * 0.5); } part(0.07, 0.07, 1.7, e0(s), 0.42, 0); }
  function e0(s: number) { return s * 0.65; }
  const seats: { x: number; z: number; h: number }[] = [];
  for (const s of [-1, 1]) for (const e of [-0.45, 0.45]) {
    const c = new THREE.Vector3(e, 0, s * 0.72).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    seats.push({ x: x + c.x, z: z + c.z, h: ry + (s > 0 ? 0 : Math.PI) });
  }
  return seats;
}

// ---------------------------------------------------------------- the lodge
const LODGE = { cx: 115.5, cz: -961, yaw: -1.83 };
const HX = 15.5, HZ = 7.75, T = 0.3;
const UP_CEIL = 3.15, ROOF = 3.7, LOW = -3.4, LOW_END = -1.0;
const EAST = { x0: 1.6, x1: 13.6, z0: -13.8, top: 6.6 };
const ANNEX = { x0: 12.5, x1: 22.5, z0: HZ, z1: 17.5, top: 3.9 };
const DECK_S = { x0: HX, x1: 21.0, z0: -6.8, z1: HZ, y: -0.12 };
const DECK_W = { x0: -4.5, x1: 5.0, z0: HZ, z1: 14.0, y: -0.1 };
const SKI_RACK_X = 24.6;
const WEST_RACK = [7, 11] as const;

// Start on the open snow just beyond the west rack, facing past the lodge toward the base slopes.
export const LODGE_SKI_START = {
  ...toWorld(LODGE, SKI_RACK_X, WEST_RACK[1] + 3),
  heading: headingFromDir(-1, -0.45),
};

export function buildMainLodge(b: BuildingDef, height: (x: number, z: number) => number, colliders: ColliderGrid) {
  const F = b.roofElevation ? b.roofElevation - ROOF : height(LODGE.cx, LODGE.cz) + 0.3;
  const g = new THREE.Group(); g.name = b.name;
  g.position.set(LODGE.cx, F, LODGE.cz); g.rotation.y = LODGE.yaw;
  const frame = { cx: LODGE.cx, cz: LODGE.cz, yaw: LODGE.yaw };
  const W = (lx: number, lz: number) => toWorld(frame, lx, lz);
  const ground = (lx: number, lz: number) => { const p = W(lx, lz); return height(p.x, p.z) - F; };
  const M = materials();
  const k = new Kit(M);
  const S = walkable.surfaces;
  const addCol = (lx0: number, lx1: number, lz0: number, lz1: number, y0: number, y1: number) => {
    const c = W((lx0 + lx1) / 2, (lz0 + lz1) / 2);
    colliders.add({ type: 'box', x: c.x, z: c.z, hx: (lx1 - lx0) / 2, hz: (lz1 - lz0) / 2, yaw: LODGE.yaw, top: F + y1, bottom: F + y0 });
  };
  const floor = (lx0: number, lx1: number, lz0: number, lz1: number, y: number, name: string) => {
    const c = W((lx0 + lx1) / 2, (lz0 + lz1) / 2);
    S.add({ cx: c.x, cz: c.z, yaw: LODGE.yaw, hx: (lx1 - lx0) / 2, hz: (lz1 - lz0) / 2, y0: F + y, name });
  };
  /** Stair flight along lodge x from (xa, ya) to (xb, yb), lz0..lz1. */
  const stairX = (xa: number, xb: number, ya: number, yb: number, lz0: number, lz1: number, mat: THREE.Material, name: string) => {
    const c = W((xa + xb) / 2, (lz0 + lz1) / 2);
    const yawS = Math.atan2(Math.cos(LODGE.yaw), -Math.sin(LODGE.yaw)) + (xb > xa ? 0 : Math.PI);
    S.add({ cx: c.x, cz: c.z, yaw: yawS, hx: (lz1 - lz0) / 2, hz: Math.abs(xb - xa) / 2, y0: F + ya, y1: F + yb, name });
    const n = Math.max(2, Math.round(Math.abs(yb - ya) / 0.18)), run = (xb - xa) / n, rise = (yb - ya) / n;
    for (let i = 0; i < n; i++) {
      const x0 = xa + run * i, x1 = x0 + run, top = ya + rise * (i + 1) - (rise < 0 ? rise : 0);
      k.box(mat, Math.min(x0, x1), Math.max(x0, x1), Math.min(ya, yb) - 0.05, top, lz0, lz1);
    }
  };
  /** Stair flight along lodge z. */
  const stairZ = (za: number, zb: number, ya: number, yb: number, lx0: number, lx1: number, mat: THREE.Material, name: string) => {
    const c = W((lx0 + lx1) / 2, (za + zb) / 2);
    S.add({ cx: c.x, cz: c.z, yaw: LODGE.yaw + (zb > za ? 0 : Math.PI), hx: (lx1 - lx0) / 2, hz: Math.abs(zb - za) / 2, y0: F + ya, y1: F + yb, name });
    const n = Math.max(2, Math.round(Math.abs(yb - ya) / 0.18)), run = (zb - za) / n, rise = (yb - ya) / n;
    for (let i = 0; i < n; i++) {
      const z0 = za + run * i, z1 = z0 + run, top = ya + rise * (i + 1) - (rise < 0 ? rise : 0);
      k.box(mat, lx0, lx1, Math.min(ya, yb) - 0.05, top, Math.min(z0, z1), Math.max(z0, z1));
    }
  };
  const lamp = (lx: number, ly: number, lz: number, i = 1, pendant = true) => {
    const p = W(lx, lz); lampsWorld.push({ p: new THREE.Vector3(p.x, F + ly - 0.15, p.z), i });
    if (pendant) {
      k.cyl(M.blackMetal, 0.006, 0.006, lx, ly, ly + 0.9, lz, 4);
      const shade = new THREE.CylinderGeometry(0.09, 0.24, 0.2, 14, 1, true); shade.translate(lx, ly, lz); k.add(shade, M.blackMetal);
      const bulb = new THREE.SphereGeometry(0.06, 8, 6); bulb.translate(lx, ly - 0.06, lz); k.add(bulb, M.bulb);
    } else {
      k.box(M.bulb, lx - 0.3, lx + 0.3, ly - 0.02, ly, lz - 0.3, lz + 0.3);
    }
  };
  const poi = (kind: any, lx: number, ly: number, lz: number, heading: number, indoor: string | null, tag?: string) => {
    const p = W(lx, lz); walkable.pois.push({ kind, x: p.x, y: F + ly, z: p.z, heading: heading + LODGE.yaw, indoor, tag });
  };
  lampsWorld = [];

  // ---------- structure: slabs, plinth, roof
  const UPPER = 'Main Lodge dining level', LOWER = 'Main Lodge rental level', SUN = 'Main Lodge sunroom';
  k.box(M.concrete, -HX, HX, -0.35, 0, -HZ, HZ);                    // upper floor slab
  k.box(M.concrete, -HX, LOW_END, LOW - 0.3, LOW, -HZ, HZ);          // lower floor slab
  // stepped foundation down to the bare-earth grade, visible where the ground falls away to the north
  for (let x = -HX; x < HX; x += 2) {
    const gmin = Math.min(ground(x, -HZ), ground(x + 2, -HZ), ground(x, HZ), ground(x + 2, HZ), ground(x, 0));
    const top = x + 2 <= LOW_END ? LOW : -0.35;
    const bottom = Math.min(top - 0.5, gmin - 1.2);
    k.box(M.concrete, x, Math.min(HX, x + 2), bottom, top, -HZ, -HZ + T); k.box(M.concrete, x, Math.min(HX, x + 2), bottom, top, HZ - T, HZ);
  }
  const gN = Math.min(ground(-HX, -HZ), ground(-HX, HZ), ground(-HX, 0));
  k.box(M.concrete, -HX, -HX + T, gN - 1.2, LOW, -HZ, HZ);
  k.box(M.concrete, HX - T, HX, -4.0, -0.35, -HZ, HZ);
  // roof: membrane, parapet with dark fascia, snow load, rooftop plant like the reference photo
  k.box(M.roofMembrane, -HX, HX, UP_CEIL, ROOF - 0.25, -HZ, HZ);
  for (const s of [-1, 1]) { k.box(M.fascia, -HX - 0.05, HX + 0.05, ROOF - 0.55, ROOF, s > 0 ? HZ - 0.05 : -HZ - 0.05, s > 0 ? HZ + 0.05 : -HZ + 0.05); k.box(M.fascia, s > 0 ? HX - 0.05 : -HX - 0.05, s > 0 ? HX + 0.05 : -HX + 0.05, ROOF - 0.55, ROOF, -HZ, HZ); }
  k.box(M.snow, -HX + 0.1, HX - 0.1, ROOF - 0.25, ROOF - 0.05, -HZ + 0.1, HZ - 0.1);
  for (const [x, z, w, d, h] of [[-6, -3, 2.4, 1.6, 1.3], [2, 2.5, 1.8, 1.4, 1.1], [8, -4.5, 1.2, 1.2, 0.9], [-11, 3, 1.0, 1.0, 0.8]]) {
    k.box(M.hvac, x - w / 2, x + w / 2, ROOF - 0.05, ROOF - 0.05 + h, z - d / 2, z + d / 2);
    k.box(M.snow, x - w / 2 + 0.02, x + w / 2 - 0.02, ROOF - 0.05 + h, ROOF + h + 0.08, z - d / 2 + 0.02, z + d / 2 - 0.02);
  }
  for (const [x, z] of [[-2, -5], [4, 5], [11, 1]]) { k.cyl(M.steel, 0.12, 0.12, x, ROOF - 0.2, ROOF + 0.6, z, 10); k.cyl(M.steel, 0.2, 0.16, x, ROOF + 0.6, ROOF + 0.75, z, 10); }

  // ---------- upper level walls
  const band = { mat: M.pineWall, y: 1.05 };
  const southStore: Opening[] = [-5.28, -2.64, 0, 2.64, 5.28].map((c) => ({ a: c - 1.27, b: c + 1.27, y0: c === 0 ? 0 : 0.35, y1: 2.85, door: c === 0, mullions: 2 }));
  wall(k, 'z', -HZ, HZ, HX, 1, 0, ROOF - 0.55, M.stuccoCream, M.sage, southStore, band);
  const westUp: Opening[] = [
    { a: -13.2, b: -10.8, y0: 0.95, y1: 2.55 }, { a: -8.2, b: -5.8, y0: 0.95, y1: 2.55 },
    { a: 0.6, b: 1.7, y0: 0, y1: 2.25, door: true }, { a: 3.6, b: 6.0, y0: 0.95, y1: 2.55 }, { a: 8.0, b: 10.4, y0: 0.95, y1: 2.55 }];
  wall(k, 'x', -HX, ANNEX.x0, HZ, 1, 0, ROOF - 0.55, M.stuccoCream, M.sage, westUp, band);
  wall(k, 'x', ANNEX.x0, HX, HZ, 1, 0, ROOF - 0.55, null, M.sage, [], band); // shared with the annex
  const northUp: Opening[] = [{ a: 0.6, b: 3.0, y0: 0.95, y1: 2.55 }, { a: 4.2, b: 6.6, y0: 0.95, y1: 2.55 }];
  wall(k, 'z', -HZ, HZ, -HX, -1, 0, ROOF - 0.55, M.stuccoCream, M.sage, northUp, band);
  const eastUp: Opening[] = [{ a: -7.2, b: -5.6, y0: 1.6, y1: 2.6 }, { a: 4.0, b: 11.0, y0: 0, y1: 2.6, door: true }];
  wall(k, 'x', -HX, EAST.x0, -HZ, -1, 0, ROOF - 0.55, M.stuccoCream, M.sage, [eastUp[0]], band);
  wall(k, 'x', EAST.x0, EAST.x1, -HZ, -1, 0, ROOF - 0.55, null, M.sage, [eastUp[1]], band);
  wall(k, 'x', EAST.x1, HX, -HZ, -1, 0, ROOF - 0.55, M.stuccoCream, M.sage, [], band);
  wallColliders(addCol, 'z', -HZ, HZ, HX, 1, 0, ROOF, southStore.filter((o) => o.door));
  wallColliders(addCol, 'x', -HX, HX, HZ, 1, 0, ROOF, westUp.filter((o) => o.door));
  wallColliders(addCol, 'z', -HZ, HZ, -HX, -1, LOW, ROOF, []);
  wallColliders(addCol, 'x', -HX, HX, -HZ, -1, 0, ROOF, [eastUp[1]]);
  // ceiling: plank boards between dark timber beams with warm string lights
  k.box(M.ceiling, -HX + T, HX - T, UP_CEIL - 0.02, UP_CEIL, -HZ + T, HZ - T);
  for (let x = -12.5; x <= 13; x += 2.6) {
    k.box(M.beam, x - 0.12, x + 0.12, UP_CEIL - 0.34, UP_CEIL - 0.02, -HZ + T, HZ - T);
    for (let z = -HZ + 0.6; z < HZ - 0.4; z += 0.45) { const s = new THREE.SphereGeometry(0.018, 5, 4); s.translate(x + 0.13, UP_CEIL - 0.08 - 0.06 * Math.sin((z + 7) * 0.7), z); k.add(s, M.bulb); }
  }
  k.box(M.beam, -HX + T, HX - T, UP_CEIL - 0.42, UP_CEIL - 0.34, -0.15, 0.15);

  // ---------- upper level floor, stairwell, rooms
  const STW = { x0: -9.2, x1: -3.7, z0: -HZ + T, z1: -6.0 };
  const upFloor = (x0: number, x1: number, z0: number, z1: number, mat: THREE.Material) => { k.box(mat, x0, x1, -0.01, 0.005, z0, z1); floor(x0, x1, z0, z1, 0, UPPER); };
  upFloor(-HX, STW.x0, -HZ, HZ, M.woodFloor);
  upFloor(STW.x0, STW.x1, STW.z1, HZ, M.woodFloor);
  upFloor(STW.x1, 9.0, -HZ, HZ, M.carpet);
  upFloor(9.0, HX, -HZ, HZ, M.woodFloor);
  for (const [a, b] of [[STW.x0, STW.x1]]) {
    k.box(M.darkWood, a, b, 0.98, 1.04, STW.z1 - 0.03, STW.z1 + 0.03);
    for (let x = a; x <= b; x += 0.12) k.box(M.blackMetal, x - 0.012, x + 0.012, 0, 0.98, STW.z1 - 0.012, STW.z1 + 0.012);
    addCol(a, b, STW.z1 - 0.05, STW.z1 + 0.05, 0, 1.05);
  }
  k.box(M.darkWood, STW.x0 - 0.03, STW.x0 + 0.03, 0.98, 1.04, STW.z0, STW.z1);
  addCol(STW.x0 - 0.05, STW.x0 + 0.05, STW.z0, STW.z1, 0, 1.05);
  stairX(STW.x1, STW.x0 + 0.2, 0, LOW, STW.z0, STW.z1, M.woodFloor, 'Main Lodge stairs');
  // enclosed under the flight on the rental level; the flight opens at its foot
  wall(k, 'x', STW.x0 + 0.2, STW.x1, STW.z1, 1, LOW, -0.35, M.whiteWall, M.whiteWall, [], undefined, 0.12);
  addCol(STW.x0 + 0.2, STW.x1, STW.z1 - 0.12, STW.z1, LOW, -0.35);
  k.box(M.darkWood, STW.x0 + 0.2, STW.x1, LOW + 0.9, LOW + 0.95, STW.z1 + 0.02, STW.z1 + 0.07);
  // restrooms (closed doors, signed)
  wall(k, 'x', -HX + T, -10.0, -2.0, 1, 0, UP_CEIL, M.sage, M.sage, [], band, 0.15);
  wall(k, 'z', -HZ + T, -2.0, -10.0, 1, 0, UP_CEIL, M.sage, M.sage, [], band, 0.15);
  wall(k, 'z', -HZ + T, -2.0, -12.6, 1, 0, UP_CEIL, M.whiteWall, M.whiteWall, [], undefined, 0.12);
  addCol(-HX + T, -9.85, -2.15, -1.85, 0, UP_CEIL); addCol(-10.15, -9.85, -HZ + T, -2.0, 0, UP_CEIL);
  for (const [x, label] of [[-14.0, 'WOMEN'], [-11.4, 'MEN']] as const) {
    k.box(M.darkWood, x - 0.48, x + 0.48, 0, 2.1, -2.0, -1.95);
    k.plane(new THREE.MeshStandardNodeMaterial({ map: signTex([{ text: label, size: 120, y: 128, color: '#f4f1e8' }], '#2f4a3a', 512, 256) }), 0.4, 0.2, x, 1.55, -1.94, 0);
  }
  // bar: L counter with stools, back bar, TV
  const bar = { x0: -14.6, x1: -9.6, z: 3.2 };
  k.box(M.darkWood, bar.x0, bar.x1, 0, 1.0, bar.z - 0.35, bar.z + 0.35);
  k.box(M.tableTop, bar.x0 - 0.05, bar.x1 + 0.1, 1.0, 1.06, bar.z - 0.45, bar.z + 0.5);
  k.box(M.darkWood, bar.x1 - 0.7, bar.x1, 0, 1.0, bar.z + 0.35, HZ - T - 1.2);
  k.box(M.tableTop, bar.x1 - 0.8, bar.x1 + 0.1, 1.0, 1.06, bar.z + 0.35, HZ - T - 1.1);
  addCol(bar.x0, bar.x1 + 0.1, bar.z - 0.45, bar.z + 0.5, 0, 1.06); addCol(bar.x1 - 0.8, bar.x1 + 0.1, bar.z, HZ - T - 1.1, 0, 1.06);
  for (let x = bar.x0 + 0.5; x < bar.x1 - 0.3; x += 0.75) {
    k.cyl(M.blackMetal, 0.025, 0.025, x, 0, 0.72, bar.z - 0.85, 6); k.cyl(M.vinyl, 0.19, 0.19, x, 0.72, 0.78, bar.z - 0.85, 14);
    const ring = new THREE.TorusGeometry(0.16, 0.012, 4, 14); ring.rotateX(Math.PI / 2); ring.translate(x, 0.28, bar.z - 0.85); k.add(ring, M.blackMetal);
    poi('seat', x, 0.78, bar.z - 0.85, Math.PI, UPPER, 'stool');
  }
  k.box(M.darkWood, -HX + T, -HX + T + 0.5, 0, 0.95, 1.0, 6.6);
  for (const y of [1.35, 1.75]) {
    k.box(M.darkWood, -HX + T, -HX + T + 0.3, y - 0.03, y, 1.0, 6.6);
    for (let z = 1.1; z < 6.5; z += 0.13) k.cyl(M.bottle, 0.035, 0.03, -HX + T + 0.15, y, y + 0.28 + (z * 7 % 3) * 0.02, z, 6);
  }
  k.box(M.blackMetal, -HX + T, -HX + T + 0.08, 2.0, 2.65, 2.4, 3.9); k.box(M.screen, -HX + T + 0.08, -HX + T + 0.09, 2.04, 2.61, 2.44, 3.86);
  lamp(-12.0, 2.45, 3.2, 1.2); lamp(-10.4, 2.45, 3.2, 1.2);
  // servery along the east wall: tray rail, sneeze guard, heat lamps, coolers, registers, menu boards
  const sv = { x0: -2.5, x1: 8.5, z: -4.7 };
  k.box(M.darkWood, sv.x0, sv.x1, 0, 0.92, sv.z - 0.4, sv.z + 0.25);
  k.box(M.stainless, sv.x0, sv.x1, 0.92, 0.96, sv.z - 0.45, sv.z + 0.3);
  k.box(M.stainless, sv.x0, sv.x1, 0.82, 0.86, sv.z + 0.3, sv.z + 0.6);
  for (let x = sv.x0 + 0.2; x < sv.x1 - 0.2; x += 0.9) {
    k.box(M.food, x, x + 0.55, 0.96, 1.0, sv.z - 0.35, sv.z - 0.05);
    k.box(M.heatLamp, x + 0.05, x + 0.5, 1.48, 1.5, sv.z - 0.3, sv.z - 0.1);
  }
  k.box(M.glass, sv.x0, sv.x1, 1.3, 1.33, sv.z - 0.1, sv.z + 0.25);
  for (let x = sv.x0; x <= sv.x1; x += 1.8) k.cyl(M.stainless, 0.015, 0.015, x, 0.96, 1.52, sv.z - 0.05, 6);
  k.box(M.stainless, sv.x0, sv.x1, 1.5, 1.53, sv.z - 0.35, sv.z - 0.05);
  addCol(sv.x0, sv.x1, sv.z - 0.45, sv.z + 0.6, 0, 1.0);
  for (const x of [-1.8, -0.6]) { k.box(M.blackMetal, x - 0.5, x + 0.5, 0, 2.0, -HZ + T, -HZ + T + 0.7); k.box(M.fridgeGlow, x - 0.45, x + 0.45, 0.1, 1.9, -HZ + T + 0.7, -HZ + T + 0.71); }
  for (const x of [5.5, 7.2]) { k.box(M.blackMetal, x - 0.2, x + 0.2, 0.96, 1.25, sv.z - 0.3, sv.z); k.box(M.screen, x - 0.16, x + 0.16, 1.27, 1.45, sv.z - 0.2, sv.z - 0.18); }
  for (let x = sv.x0; x < sv.x1 - 0.5; x += 0.7) k.box(M.stainless, x, x + 0.6, 0.92, 1.0, -HZ + T, -HZ + T + 0.6);
  const menu = new THREE.MeshStandardNodeMaterial({ emissive: 0xffffff, emissiveIntensity: 0.35, map: signTex([
    { text: 'GRILL', size: 70, y: 50, color: '#f2c14e' }, { text: 'Breakfast burrito   Burgers   Chili   Soup of the day', size: 38, y: 130, color: '#eee' },
    { text: 'Pizza by the slice   Salads   Cocoa   Coffee', size: 38, y: 190, color: '#eee' }], '#1d1f1c') });
  menu.emissiveNode = texture(menu.map).rgb.mul(0.45);
  k.plane(menu, 4.2, 1.05, 2.0, 2.45, -HZ + T + 0.02, 0);
  k.plane(menu, 4.2, 1.05, 6.4, 2.45, -HZ + T + 0.02, 0);
  for (let x = sv.x0 + 0.5; x < sv.x1; x += 2.2) lamp(x, 2.4, sv.z - 0.3, 1.0);
  poi('counter', 3.0, 0, sv.z - 1.1, Math.PI, UPPER, 'servery');
  poi('counter', 6.0, 0, sv.z - 1.1, Math.PI, UPPER, 'register');
  // dining: tables in rows, pendant lamps over each
  const tables: [number, number, number, number][] = [];
  for (const x of [-6.0, -2.2, 1.6, 5.4]) for (const z of [-0.6, 3.6]) tables.push([x, z, 0, 6]);
  for (const z of [-4.5, -1.5, 1.5, 4.5]) tables.push([11.6, z, Math.PI / 2, 4]);
  for (const [x, z, r, n] of tables) {
    for (const s of diningTable(k, x, 0, z, r, n)) poi('seat', s.x, 0.45, s.z, s.h, UPPER, 'dining');
    addCol(x - (r ? 0.45 : 0.95), x + (r ? 0.45 : 0.95), z - (r ? 0.6 : 0.45), z + (r ? 0.6 : 0.45), 0, 0.78);
    lamp(x, 2.35, z, 0.9);
  }
  // boot-friendly entry mats and trash/recycling by the south doors
  k.box(M.vinyl, 12.5, HX - T, 0.005, 0.02, -2.5, 2.5);
  for (const z of [-3.2, -2.6]) { k.box(M.blackMetal, 13.6, 14.1, 0, 0.95, z - 0.25, z + 0.25); }
  for (let x = -12; x < 14; x += 6) lamp(x, 2.8, -6.0, 0.6, false);

  // ---------- lower level: rentals, lockers, benches, walk-out door to the west grade
  const lowerWest: Opening[] = [{ a: -13.0, b: -10.8, y0: LOW + 1.0, y1: LOW + 2.4 }, { a: -7.9, b: -6.1, y0: LOW, y1: LOW + 2.3, door: true }, { a: -4.4, b: -2.2, y0: LOW + 1.0, y1: LOW + 2.4 }];
  wall(k, 'x', -HX, LOW_END, HZ, 1, LOW, -0.35, M.stuccoCream, M.whiteWall, lowerWest, { mat: M.concrete, y: LOW + 0.15 });
  wall(k, 'z', -HZ, HZ, -HX, -1, LOW, -0.35, M.stuccoCream, M.whiteWall, [{ a: -5, b: -2.8, y0: LOW + 1.0, y1: LOW + 2.4 }, { a: 2.8, b: 5, y0: LOW + 1.0, y1: LOW + 2.4 }]);
  wall(k, 'x', -HX, LOW_END, -HZ, -1, LOW, -0.35, M.stuccoCream, M.whiteWall, [{ a: -13, b: -11, y0: LOW + 1.0, y1: LOW + 2.4 }]);
  wall(k, 'z', -HZ, HZ, LOW_END, 1, LOW, -0.35, null, M.whiteWall, []); // retaining wall against the slope
  wallColliders(addCol, 'x', -HX, LOW_END, HZ, 1, LOW, -0.35, lowerWest.filter((o) => o.door));
  wallColliders(addCol, 'x', -HX, LOW_END, -HZ, -1, LOW, -0.35, []);
  wallColliders(addCol, 'z', -HZ, HZ, LOW_END, 1, LOW, -0.35, []);
  k.box(M.concFloor, -HX + T, LOW_END - T, LOW - 0.01, LOW + 0.005, -HZ + T, HZ - T);
  floor(-HX, LOW_END, -HZ, HZ, LOW, LOWER);
  k.box(M.whiteWall, -HX + T, LOW_END - T, -0.37, -0.35, -HZ + T, HZ - T);
  for (let x = -13.5; x < -1.5; x += 3) for (const z of [-4, 0, 4]) lamp(x, -0.4, z, 0.8, false);
  // rental counter with terminals
  k.box(M.darkWood, -6.2, -2.0, LOW, LOW + 1.05, 1.2, 1.8); k.box(M.tableTop, -6.3, -1.9, LOW + 1.05, LOW + 1.1, 1.1, 1.9);
  for (const x of [-5.4, -3.4]) { k.box(M.blackMetal, x - 0.25, x + 0.25, LOW + 1.1, LOW + 1.45, 1.35, 1.4); k.box(M.screen, x - 0.22, x + 0.22, LOW + 1.13, LOW + 1.42, 1.41, 1.415); }
  addCol(-6.3, -1.9, 1.1, 1.9, LOW, LOW + 1.1);
  const rentals = new THREE.MeshStandardNodeMaterial({ map: signTex([{ text: 'RENTALS  &  REPAIR', size: 96, y: 128, color: '#f4efe2' }], '#30473a') });
  k.plane(rentals, 3.6, 0.9, -4.1, LOW + 2.45, 0.32, 0);
  for (const x of [-5.7, -2.5]) k.cyl(M.blackMetal, 0.006, 0.006, x, LOW + 2.9, -0.36, 0.32, 4);
  // ski wall: rental skis stand in racks along the retaining wall
  for (let z = -6.8; z < 6.8; z += 0.16) {
    const h = 1.55 + ((z * 13) % 0.25);
    const skiMat = [M.rentalSki, M.rentalSkiBlue, M.rentalSkiBlack][Math.floor(Math.abs(z * 7.3)) % 3];
    k.box(skiMat, LOW_END - T - 0.12, LOW_END - T - 0.1, LOW + 0.02, LOW + h, z - 0.04, z + 0.04);
    k.box(M.bootPlastic, LOW_END - T - 0.135, LOW_END - T - 0.085, LOW + 0.75, LOW + 0.83, z - 0.045, z + 0.045);
    k.box(M.blackMetal, LOW_END - T - 0.14, LOW_END - T - 0.06, LOW + 0.55, LOW + 0.62, z - 0.05, z + 0.05);
  }
  k.box(M.blackMetal, LOW_END - T - 0.2, LOW_END - T, LOW + 1.2, LOW + 1.24, -6.9, 6.9);
  // boot cubbies
  for (let zz = -6.6; zz < -2.2; zz += 0.45) for (let y = 0; y < 4; y++) {
    k.box(M.darkWood, -3.4, -1.6, LOW + 0.3 + y * 0.45, LOW + 0.33 + y * 0.45, zz, zz + 0.43);
    k.box(M.bootPlastic, -2.9, -2.6, LOW + 0.33 + y * 0.45, LOW + 0.68 + y * 0.45, zz + 0.1, zz + 0.33);
  }
  addCol(-3.4, -1.6, -6.6, -2.2, LOW, LOW + 2.1);
  // lockers along the north wall and benches
  for (let z = -6.4; z < 6.4; z += 0.42) {
    k.box(M.locker, -HX + T, -HX + T + 0.5, LOW + 0.1, LOW + 1.85, z, z + 0.4);
    k.box(M.blackMetal, -HX + T + 0.5, -HX + T + 0.52, LOW + 1.0, LOW + 1.1, z + 0.3, z + 0.34);
  }
  addCol(-HX + T, -HX + T + 0.55, -6.4, 6.4, LOW, LOW + 1.9);
  for (const z of [-3, 1.5]) { k.box(M.tableTop, -13.6, -9.6, LOW + 0.42, LOW + 0.47, z - 0.2, z + 0.2); for (const x of [-13.3, -9.9]) k.box(M.blackMetal, x - 0.03, x + 0.03, LOW, LOW + 0.42, z - 0.15, z + 0.15); poi('seat', -11.6, LOW + 0.47, z, 0, LOWER, 'bench'); addCol(-13.6, -9.6, z - 0.2, z + 0.2, LOW, LOW + 0.47); }
  poi('counter', -4.1, LOW, 2.4, 0, LOWER, 'rentals');
  // outside landing and steps at the walk-out door
  k.box(M.concrete, -8.6, -5.4, ground(-7, HZ + 1.2) - 0.6, LOW, HZ, HZ + 1.8);
  floor(-8.6, -5.4, HZ, HZ + 1.8, LOW, 'Lower entrance');
  poi('door', -7, LOW, HZ + 2.6, Math.PI, null, 'lower-door'); poi('door', -7, LOW, HZ - 1.2, 0, LOWER, 'lower-door-in');

  // ---------- east section: two storeys (lidar roof 6.6 m), ground-floor sunroom open to the dining hall
  const E = EAST;
  const eSouth: Opening[] = [{ a: E.z0 + 0.6, b: -8.4, y0: 0.35, y1: 2.7, mullions: 3 }];
  wall(k, 'z', E.z0, -HZ, E.x1, 1, 0, 3.3, M.stuccoBeige, M.sage, eSouth, band);
  wall(k, 'x', E.x0, E.x1, E.z0, -1, 0, 3.3, M.stuccoBeige, M.sage, [{ a: 3.0, b: 6.4, y0: 0.9, y1: 2.6 }, { a: 8.2, b: 11.6, y0: 0.9, y1: 2.6 }], band);
  wall(k, 'z', E.z0, -HZ, E.x0, -1, 0, 3.3, M.stuccoBeige, M.sage, [], band);
  wallColliders(addCol, 'z', E.z0, -HZ, E.x1, 1, 0, E.top, []); wallColliders(addCol, 'x', E.x0, E.x1, E.z0, -1, 0, E.top, []); wallColliders(addCol, 'z', E.z0, -HZ, E.x0, -1, 0, E.top, []);
  // upper storey offices (not enterable): beige stucco with a ribbon of windows
  for (const [axis, u0, u1, w, out] of [['z', E.z0, -HZ, E.x1, 1], ['x', E.x0, E.x1, E.z0, -1], ['z', E.z0, -HZ, E.x0, -1]] as const) {
    const ops: Opening[] = [];
    for (let u = u0 + 1; u + 1.6 < u1 - 0.5; u += 2.4) ops.push({ a: u, b: u + 1.6, y0: 4.4, y1: 5.8, dark: true });
    wall(k, axis, u0, u1, w, out, 3.3, E.top - 0.4, M.stuccoBeige, null, ops);
  }
  wall(k, 'x', E.x0, E.x1, -HZ, 1, ROOF - 0.55, E.top - 0.4, M.stuccoBeige, null, [{ a: 5, b: 6.6, y0: 4.4, y1: 5.8, dark: true }, { a: 8.6, b: 10.2, y0: 4.4, y1: 5.8, dark: true }]);
  k.box(M.concrete, E.x0, E.x1, -0.35, 0, E.z0, -HZ); k.box(M.carpet, E.x0 + T, E.x1 - T, -0.01, 0.005, E.z0 + T, -HZ);
  floor(E.x0, E.x1, E.z0, -HZ, 0, SUN);
  k.box(M.concrete, E.x0, E.x1, -1.6, -0.35, E.z0, -HZ);
  k.box(M.ceiling, E.x0 + T, E.x1 - T, 2.98, 3.0, E.z0 + T, -HZ);
  k.box(M.roofMembrane, E.x0, E.x1, E.top - 0.6, E.top - 0.25, E.z0, -HZ);
  k.box(M.snow, E.x0 + 0.1, E.x1 - 0.1, E.top - 0.25, E.top - 0.07, E.z0 + 0.1, -HZ - 0.1);
  for (const [x0, x1, z0, z1] of [[E.x0, E.x1, E.z0 - 0.05, E.z0 + 0.05], [E.x0 - 0.05, E.x0 + 0.05, E.z0, -HZ], [E.x1 - 0.05, E.x1 + 0.05, E.z0, -HZ]]) k.box(M.fascia, x0, x1, E.top - 0.5, E.top, z0, z1);
  for (const z of [-11.8, -9.6]) for (const s of diningTable(k, 7.5, 0, z, 0, 4)) poi('seat', s.x, 0.45, s.z, s.h, SUN, 'dining');
  for (const z of [-11.8, -9.6]) { addCol(6.9, 8.1, z - 0.45, z + 0.45, 0, 0.78); lamp(7.5, 2.3, z, 0.8); }
  for (const z of [-11.8, -9.6]) for (const s of diningTable(k, 4.0, 0, z, 0, 4)) poi('seat', s.x, 0.45, s.z, s.h, SUN, 'dining');
  for (const z of [-11.8, -9.6]) { addCol(3.4, 4.6, z - 0.45, z + 0.45, 0, 0.78); lamp(4.0, 2.3, z, 0.8); }
  // red awning over the sunroom glazing, as in the reference photo
  const aw = new THREE.PlaneGeometry(3.2, -HZ - E.z0); aw.rotateX(-Math.PI / 2); aw.rotateZ(-0.3);
  aw.translate(E.x1 + 1.55, 2.95, (E.z0 - HZ) / 2); k.add(aw, M.awning);
  for (const z of [E.z0 + 0.2, -HZ - 0.2]) k.cyl(M.blackMetal, 0.03, 0.03, E.x1 + 3.0, -0.1, 2.5, z, 6);

  // ---------- south-west annex: the signed building with blue trim and a red door (not enterable)
  const A = ANNEX;
  const aHeight = A.top;
  wall(k, 'z', A.z0, A.z1, A.x1, 1, -0.1, aHeight - 0.3, M.stuccoCream, null, [{ a: 9.6, b: 10.6, y0: -0.1, y1: 2.1, dark: true }, { a: 14.6, b: 16.6, y0: 0.9, y1: 2.2, dark: true }]);
  k.box(M.redDoor, A.x1, A.x1 + 0.06, -0.1, 2.08, 9.65, 10.55);
  wall(k, 'x', A.x0, A.x1, A.z1, 1, -0.1, aHeight - 0.3, M.stuccoCream, null, [{ a: 15.0, b: 17.0, y0: 0.9, y1: 2.2, dark: true }, { a: 19.0, b: 21.0, y0: 0.9, y1: 2.2, dark: true }]);
  wall(k, 'z', A.z0, A.z1, A.x0, -1, -1.5, aHeight - 0.3, M.stuccoCream, null, []);
  wall(k, 'x', HX, A.x1, A.z0, -1, -0.1, aHeight - 0.3, M.stuccoCream, null, [{ a: 17.0, b: 19.2, y0: 0.9, y1: 2.2, dark: true }]);
  wallColliders(addCol, 'z', A.z0, A.z1, A.x1, 1, -1, aHeight, []); wallColliders(addCol, 'x', A.x0, A.x1, A.z1, 1, -1, aHeight, []);
  wallColliders(addCol, 'z', A.z0, A.z1, A.x0, -1, -1.5, aHeight, []); wallColliders(addCol, 'x', HX, A.x1, A.z0, -1, -1, aHeight, []);
  k.box(M.roofMembrane, A.x0, A.x1, aHeight - 0.3, aHeight - 0.1, A.z0, A.z1);
  for (const [x0, x1, z0, z1] of [[A.x0, A.x1, A.z1 - 0.05, A.z1 + 0.1], [A.x1 - 0.05, A.x1 + 0.1, A.z0, A.z1], [HX, A.x1, A.z0 - 0.1, A.z0 + 0.05]]) k.box(M.blueTrim, x0, x1, aHeight - 0.45, aHeight + 0.05, z0, z1);
  k.box(M.snow, A.x0 + 0.1, A.x1 - 0.1, aHeight - 0.1, aHeight + 0.08, A.z0 + 0.1, A.z1 - 0.1);
  const logo = new THREE.MeshStandardNodeMaterial({ map: signTex([{ text: 'sunlight', size: 150, y: 120, color: '#262a2e', font: 'bold 150px Helvetica, Arial, sans-serif' }], '#f3efe3', 1024, 256, true), roughness: 0.6 });
  k.plane(logo, 4.6, 1.15, A.x1 + 0.03, 2.45, 13.6, Math.PI / 2);
  k.box(M.concrete, A.x0, A.x1, -1.6, -0.1, A.z0, A.z1);

  // ---------- south sun deck at snow grade with picnic tables, steps and ski racks on the snow
  const D = DECK_S;
  k.box(M.deck, D.x0, D.x1, D.y - 0.1, D.y, D.z0, D.z1);
  for (let x = D.x0 + 1.5; x < D.x1; x += 2.5) for (const z of [D.z0 + 0.3, D.z1 - 0.3, 0]) { const gy = ground(x, z); if (gy < D.y - 0.2) k.box(M.deckRail, x - 0.1, x + 0.1, gy - 0.3, D.y - 0.1, z - 0.1, z + 0.1); }
  k.box(M.deckRail, D.x0, D.x1, D.y - 0.4, D.y - 0.1, D.z0, D.z0 + 0.15);
  floor(D.x0, D.x1, D.z0, D.z1, D.y, 'South deck');
  // perimeter rail with two openings to the snow (timber posts and rails as in the reference)
  const railSeg = (x0: number, x1: number, z0: number, z1: number) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / 1.8));
    for (let i = 0; i <= n; i++) { const t = i / n; const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; k.box(M.deckRail, x - 0.06, x + 0.06, D.y, D.y + 1.05, z - 0.06, z + 0.06); }
    for (const h of [0.45, 0.98]) k.box(M.deckRail, Math.min(x0, x1) - 0.04, Math.max(x0, x1) + 0.04, D.y + h - 0.05, D.y + h + 0.05, Math.min(z0, z1) - 0.04, Math.max(z0, z1) + 0.04);
    addCol(Math.min(x0, x1) - 0.06, Math.max(x0, x1) + 0.06, Math.min(z0, z1) - 0.06, Math.max(z0, z1) + 0.06, D.y, D.y + 1.05);
  };
  railSeg(D.x1, D.x1, D.z0, -3.0); railSeg(D.x1, D.x1, -0.6, 3.6); railSeg(D.x1, D.x1, 6.0, D.z1);
  railSeg(D.x0 + 0.2, D.x1, D.z0, D.z0);
  for (const [z0, z1] of [[-3.0, -0.6], [3.6, 6.0]]) {
    const gy = Math.min(ground(D.x1 + 1.0, (z0 + z1) / 2), D.y - 0.15);
    stairX(D.x1, D.x1 + Math.max(0.3, (D.y - gy) / 0.18 * 0.3), D.y, gy, z0 + 0.1, z1 - 0.1, M.deck, 'Deck steps');
    poi('door', D.x1 + 2.2, gy, (z0 + z1) / 2, Math.PI / 2, null, 'deck-steps');
  }
  for (const [x, z] of [[17.2, -4.6], [17.2, -1.3], [17.2, 2.2], [19.4, -4.6], [19.4, 2.2], [17.2, 5.4]]) for (const s of picnicTable(k, x, D.y, z, Math.PI / 2)) poi('seat', s.x, D.y + 0.45, s.z, s.h, null, 'deck');
  for (const [x, z] of [[17.2, -4.6], [17.2, -1.3], [17.2, 2.2], [19.4, -4.6], [19.4, 2.2], [17.2, 5.4]]) addCol(x - 0.45, x + 0.45, z - 0.95, z + 0.95, D.y, D.y + 0.8);
  // ski racks out on the snow below the deck
  for (const [z0, z1] of [[-9.5, -5.0], WEST_RACK]) {
    const x = SKI_RACK_X;
    const gy = ground(x, (z0 + z1) / 2);
    for (const z of [z0, z1]) k.cyl(M.steel, 0.03, 0.03, x, gy - 0.3, gy + 1.15, z, 8);
    k.box(M.steel, x - 0.025, x + 0.025, gy + 1.12, gy + 1.17, z0, z1);
    k.box(M.steel, x - 0.25, x + 0.25, gy + 0.55, gy + 0.58, z0, z1);
    addCol(x - 0.3, x + 0.3, z0, z1, gy - 0.3, gy + 1.2);
    poi('rack', x - 1.0, gy, (z0 + z1) / 2, -Math.PI / 2, null, 'ski-rack');
  }
  poi('door', HX + 1.2, D.y, 0, Math.PI / 2, null, 'south-door'); poi('door', HX - 1.2, 0, 0, -Math.PI / 2, UPPER, 'south-door-in');

  // ---------- west deck off the dining room with a stair down to the walk-out grade
  const DW = DECK_W;
  k.box(M.deck, DW.x0, DW.x1, DW.y - 0.1, DW.y, DW.z0, DW.z1);
  floor(DW.x0, DW.x1, DW.z0, DW.z1, DW.y, 'West deck');
  for (let x = DW.x0 + 0.2; x <= DW.x1; x += 2.4) for (const z of [DW.z0 + 1.5, DW.z1 - 0.2]) { const gy = ground(x, z); k.box(M.deckRail, x - 0.1, x + 0.1, gy - 0.3, DW.y - 0.1, z - 0.1, z + 0.1); }
  const wRail = (x0: number, x1: number, z0: number, z1: number) => {
    for (let x = x0; x <= x1 + 1e-3; x += Math.max(0.5, (x1 - x0) / Math.ceil((x1 - x0) / 1.8 || 1))) for (let z = z0; z <= z1 + 1e-3; z += Math.max(0.5, (z1 - z0) / Math.ceil((z1 - z0) / 1.8 || 1))) k.box(M.deckRail, x - 0.06, x + 0.06, DW.y, DW.y + 1.05, z - 0.06, z + 0.06);
    for (const h of [0.45, 0.98]) k.box(M.deckRail, x0 - 0.04, x1 + 0.04, DW.y + h - 0.05, DW.y + h + 0.05, z0 - 0.04, z1 + 0.04);
    addCol(x0 - 0.06, x1 + 0.06, z0 - 0.06, z1 + 0.06, DW.y, DW.y + 1.05);
  };
  wRail(DW.x0, DW.x0, DW.z0, DW.z1); wRail(DW.x0, DW.x1 - 1.6, DW.z1, DW.z1); wRail(DW.x1, DW.x1, DW.z0, DW.z1 - 1.6);
  const gW = ground(DW.x1 + 4, DW.z1 - 0.8);
  stairX(DW.x1, DW.x1 + Math.max(0.6, (DW.y - gW) / 0.18 * 0.28), DW.y, gW, DW.z1 - 1.5, DW.z1 - 0.1, M.deck, 'West deck stairs');
  for (const s of picnicTable(k, -1.5, DW.y, 11.0, 0)) poi('seat', s.x, DW.y + 0.45, s.z, s.h, null, 'deck');
  for (const s of picnicTable(k, 2.2, DW.y, 11.0, 0)) poi('seat', s.x, DW.y + 0.45, s.z, s.h, null, 'deck');
  addCol(-2.5, -0.5, 10.1, 11.9, DW.y, DW.y + 0.8); addCol(1.2, 3.2, 10.1, 11.9, DW.y, DW.y + 0.8);
  poi('door', 1.15, DW.y, HZ + 1.2, Math.PI, null, 'west-door'); poi('door', 1.15, 0, HZ - 1.2, 0, UPPER, 'west-door-in');

  // ---------- registration: interiors and terrain cut-outs
  const vol = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, name: string) => {
    const c = W((x0 + x1) / 2, (z0 + z1) / 2);
    walkable.surfaces.addVolume({ cx: c.x, cz: c.z, yaw: LODGE.yaw, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, y0: F + y0, y1: F + y1, name });
  };
  vol(-HX, HX, -HZ, HZ, 0, UP_CEIL, UPPER); vol(-HX, LOW_END, -HZ, HZ, LOW, -0.35, LOWER); vol(E.x0, E.x1, E.z0, -HZ, 0, 3.0, SUN);
  const cut = (x0: number, x1: number, z0: number, z1: number, y: number) => {
    const c = W((x0 + x1) / 2, (z0 + z1) / 2);
    walkable.cutouts.push({ cx: c.x, cz: c.z, yaw: LODGE.yaw, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, y: F + y });
  };
  cut(-HX + 0.05, HX - 0.05, -HZ + 0.05, HZ - 0.05, 0.02); cut(DECK_S.x0, DECK_S.x1, DECK_S.z0, DECK_S.z1, DECK_S.y + 0.25); cut(E.x0 + 0.05, E.x1 - 0.05, E.z0 + 0.05, -HZ, 0.02); cut(A.x0, A.x1 - 0.05, A.z0, A.z1 - 0.05, 0.02);

  k.build(g);
  g.userData.lodge = { F, frame };
  return g;
}
