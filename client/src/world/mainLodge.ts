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
import { glowAtDusk } from '../sky/eveningLights';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mx_noise_float, positionWorld, normalWorld, vec3, float, texture, dot, normalize, max, color as tslColor } from 'three/tsl';
import type { ColliderGrid } from '../../../shared/collision';
import { headingFromDir } from '../../../shared/skiPhysics';
import { toWorld } from '../../../shared/walk';
import { walkable } from './walkable';
import type { BuildingDef } from './sunlightBuildings';
import { BASE_TRAIL_MAP, buildTrailMapBoard } from './trailMapBoard';

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
  const r = rng(53); // stained a dark red-brown like the 2020 deck photos
  for (let y = 0; y < 256; y += 18) { const b = 70 + r() * 22; g.fillStyle = `rgb(${b + 42 | 0},${b - 8 | 0},${b * 0.62 | 0})`; g.fillRect(0, y, 512, 15); g.fillStyle = 'rgba(30,14,10,0.9)'; g.fillRect(0, y + 15, 512, 3); }
});
/** Horizontal lap siding: `base` board colour, 0.2 m exposure (texture spans 2 m). */
const lapSiding = (base: [number, number, number], seed: number) => canvasTex(256, 256, (g) => {
  const r = rng(seed);
  for (let y = 0; y < 256; y += 25.6) {
    const k = 0.94 + r() * 0.1;
    g.fillStyle = `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`; g.fillRect(0, y, 256, 25.6);
    for (let i = 0; i < 10; i++) { g.fillStyle = `rgba(80,50,25,${r() * 0.08})`; g.fillRect(0, y + r() * 24, 256, 1); }
    g.fillStyle = 'rgba(40,25,12,0.45)'; g.fillRect(0, y + 22.6, 256, 3);
    g.fillStyle = 'rgba(255,240,210,0.18)'; g.fillRect(0, y, 256, 1.5);
  }
});
/** Vertical board-and-batten in a dark red-brown stain (the small deck buildings). */
const boardBatten = (base: [number, number, number], seed: number) => canvasTex(256, 256, (g) => {
  const r = rng(seed);
  for (let x = 0; x < 256; x += 32) {
    const k = 0.9 + r() * 0.16;
    g.fillStyle = `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`; g.fillRect(x, 0, 32, 256);
    for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(20,8,5,${r() * 0.12})`; g.fillRect(x + r() * 30, 0, 1, 256); }
    g.fillStyle = 'rgba(15,6,4,0.55)'; g.fillRect(x + 28, 0, 4, 256);
    g.fillStyle = `rgb(${base[0] * 1.08 | 0},${base[1] * 1.08 | 0},${base[2] * 1.08 | 0})`; g.fillRect(x + 29, 0, 3, 256);
  }
});
/** The painted wall sign: a rising sun inside a blue arc over a lowercase wordmark. Drawn here, transparent around it. */
const wallLogo = () => canvasTex(1024, 512, (g) => {
  const cx = 512, cy = 205;
  g.lineCap = 'butt';
  g.strokeStyle = '#2d63b4'; g.lineWidth = 30; g.beginPath(); g.arc(cx, cy, 158, Math.PI, 0); g.stroke();
  g.strokeStyle = '#7a4fa0'; g.lineWidth = 10; g.beginPath(); g.arc(cx, cy, 136, Math.PI, 0); g.stroke();
  for (let i = 0; i < 13; i++) {
    const a0 = Math.PI + (i + 0.12) / 13 * Math.PI, a1 = Math.PI + (i + 0.88) / 13 * Math.PI;
    g.fillStyle = i % 2 ? '#f6b21b' : '#ffd23a';
    g.beginPath(); g.moveTo(cx + Math.cos(a0) * 64, cy + Math.sin(a0) * 64); g.lineTo(cx + Math.cos((a0 + a1) / 2) * 126, cy + Math.sin((a0 + a1) / 2) * 126); g.lineTo(cx + Math.cos(a1) * 64, cy + Math.sin(a1) * 64); g.fill();
  }
  g.fillStyle = '#f8b51e'; g.beginPath(); g.arc(cx, cy, 62, Math.PI, 0); g.fill();
  g.fillStyle = '#2b2c30'; g.font = 'bold 205px "Arial Rounded MT Bold", "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText('sunlight', cx, 420, 980);
}, false);
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

/** Exterior textured surface with world-scale planar UVs (boards keep their real size). */
function exterior(opts: { map: THREE.Texture; roughness?: number; worldUV: number }) {
  const m = new THREE.MeshStandardNodeMaterial({ map: opts.map, roughness: opts.roughness ?? 0.85 });
  m.userData.worldUV = opts.worldUV;
  return m;
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
    darkGlass: glowAtDusk(new THREE.MeshStandardNodeMaterial({ color: 0x141a1e, roughness: 0.05, metalness: 0.55 }), 0.75, 1.5, 3.4),
    redDoor: new THREE.MeshStandardNodeMaterial({ color: 0xa0262a, roughness: 0.55 }),
    steel: new THREE.MeshStandardNodeMaterial({ color: 0x9aa0a4, roughness: 0.35, metalness: 0.85 }),
    hvac: new THREE.MeshStandardNodeMaterial({ color: 0xb5b3aa, roughness: 0.6, metalness: 0.4 }),
    deck: exterior({ map: deckBoards(), roughness: 0.92, worldUV: 3 }),
    deckRail: new THREE.MeshStandardNodeMaterial({ color: 0x7a3326, roughness: 0.85 }),
    picnic: new THREE.MeshStandardNodeMaterial({ color: 0x6e4a32, roughness: 0.9 }),
    picnicTop: new THREE.MeshStandardNodeMaterial({ color: 0x2f7a62, roughness: 0.7 }),
    // storefront and false-front details from the 2010 and 2020 reference photos
    maroon: new THREE.MeshStandardNodeMaterial({ color: 0x6a1d1b, roughness: 0.7 }),
    olive: new THREE.MeshStandardNodeMaterial({ color: 0x77754a, roughness: 0.6, metalness: 0.2 }),
    cedar: new THREE.MeshStandardNodeMaterial({ color: 0x9a5a2c, roughness: 0.55 }),
    oak: new THREE.MeshStandardNodeMaterial({ color: 0xc69a62, roughness: 0.5 }),
    redTrim: new THREE.MeshStandardNodeMaterial({ color: 0x9a2a22, roughness: 0.65 }),
    siding: exterior({ map: lapSiding([206, 172, 124], 61), roughness: 0.85, worldUV: 2 }),
    darkSiding: exterior({ map: lapSiding([86, 58, 40], 67), roughness: 0.9, worldUV: 2 }),
    battens: exterior({ map: boardBatten([96, 42, 32], 71), roughness: 0.9, worldUV: 2 }),
    blueRoof: new THREE.MeshStandardNodeMaterial({ color: 0x2c5fa6, roughness: 0.45, metalness: 0.45 }),
    brownRoof: new THREE.MeshStandardNodeMaterial({ color: 0x4a3326, roughness: 0.55, metalness: 0.4 }),
    greenRoof: new THREE.MeshStandardNodeMaterial({ color: 0x3e6a5c, roughness: 0.5, metalness: 0.4 }),
    canopy: new THREE.MeshStandardNodeMaterial({ color: 0xc9cdcf, roughness: 0.8, side: THREE.DoubleSide }),
    galv: new THREE.MeshStandardNodeMaterial({ color: 0xa7acaf, roughness: 0.38, metalness: 0.8 }),
    yellow: new THREE.MeshStandardNodeMaterial({ color: 0xe0b022, roughness: 0.5 }),
    dish: new THREE.MeshStandardNodeMaterial({ color: 0xe4e6e4, roughness: 0.5, side: THREE.DoubleSide }),
    wheel: new THREE.MeshStandardNodeMaterial({ color: 0x5a3f2c, roughness: 0.8 }),
    patio: new THREE.MeshStandardNodeMaterial({ color: 0x2b2a28, roughness: 0.5, metalness: 0.5 }),
    bin: new THREE.MeshStandardNodeMaterial({ color: 0x2f4d4a, roughness: 0.55 }),
    skiA: new THREE.MeshStandardNodeMaterial({ color: 0xd4dce3, roughness: 0.35 }),
    skiB: new THREE.MeshStandardNodeMaterial({ color: 0x23262b, roughness: 0.35 }),
    skiC: new THREE.MeshStandardNodeMaterial({ color: 0xc23a2e, roughness: 0.35 }),
    skiD: new THREE.MeshStandardNodeMaterial({ color: 0x2f6db5, roughness: 0.35 }),
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
interface Opening { a: number; b: number; y0: number; y1: number; door?: boolean; dark?: boolean; mullions?: number; frame?: THREE.Material; transom?: number }
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
    const fm = o.frame ?? M.bronze, f = 0.07, mid = w - out * t * 0.45;
    const F = (a: number, b: number, ya: number, yb: number) => B(fm, a, b, ya, yb, mid - 0.05, mid + 0.05);
    F(o.a, o.a + f, o.y0, o.y1); F(o.b - f, o.b, o.y0, o.y1); F(o.a, o.b, o.y1 - f, o.y1);
    if (o.transom) {
      F(o.a, o.b, o.transom - f / 2, o.transom + f / 2);
      if (o.door) B(M.glass, o.a + f, o.b - f, o.transom + f / 2, o.y1 - f, mid - 0.012, mid + 0.012);
    }
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
        const ya = o.y0 + 0.02, yb = (o.transom ?? o.y1) - 0.04, ia = inner, ib = inner - out * leaf;
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
  const part = (w: number, h: number, d: number, px: number, py: number, pz: number, rx = 0, mat: THREE.Material = M.picnic) => {
    const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(px, py, pz); k.add(g, mat, m);
  };
  // green-painted tops and benches on a brown frame, as on the Sunlight deck
  for (let i = 0; i < 4; i++) part(1.8, 0.04, 0.17, 0, 0.75, -0.27 + i * 0.18, 0, M.picnicTop);
  for (const s of [-1, 1]) { part(1.8, 0.04, 0.26, 0, 0.45, s * 0.72, 0, M.picnicTop); for (const e of [-0.65, 0.65]) { part(0.07, 0.95, 0.07, e, 0.42, s * 0.36, s * 0.5); } part(0.07, 0.07, 1.7, e0(s), 0.42, 0); }
  function e0(s: number) { return s * 0.65; }
  const seats: { x: number; z: number; h: number }[] = [];
  for (const s of [-1, 1]) for (const e of [-0.45, 0.45]) {
    const c = new THREE.Vector3(e, 0, s * 0.72).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    seats.push({ x: x + c.x, z: z + c.z, h: ry + (s > 0 ? 0 : Math.PI) });
  }
  return seats;
}

/** Square metal patio table with four slat-back chairs (the east deck in the 2020 photos). */
function patioSet(k: Kit, x: number, y: number, z: number) {
  const M = k.M, seats: { x: number; z: number; h: number }[] = [];
  k.box(M.patio, x - 0.42, x + 0.42, y + 0.72, y + 0.75, z - 0.42, z + 0.42);
  k.cyl(M.patio, 0.03, 0.03, x, y, y + 0.72, z, 6); k.box(M.patio, x - 0.3, x + 0.3, y, y + 0.03, z - 0.04, z + 0.04); k.box(M.patio, x - 0.04, x + 0.04, y, y + 0.03, z - 0.3, z + 0.3);
  for (const [dx, dz] of [[0.68, 0], [-0.68, 0], [0, 0.68], [0, -0.68]]) {
    const h = Math.atan2(dx, dz), m = new THREE.Matrix4().compose(new THREE.Vector3(x + dx, y, z + dz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, h, 0)), new THREE.Vector3(1, 1, 1));
    const part = (w: number, hh: number, d: number, px: number, py: number, pz: number) => { const g = new THREE.BoxGeometry(w, hh, d); g.translate(px, py, pz); k.add(g, M.patio, m); };
    part(0.44, 0.03, 0.42, 0, 0.45, 0);
    for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) part(0.025, 0.45, 0.025, lx, 0.225, lz);
    for (const lx of [-0.19, 0.19]) part(0.025, 0.42, 0.025, lx, 0.66, 0.19);
    for (const yy of [0.62, 0.72, 0.82]) part(0.4, 0.04, 0.02, 0, yy, 0.19);
    seats.push({ x: x + dx, z: z + dz, h: h + Math.PI });
  }
  return seats;
}
/** A pair of skis (or a board) leaning on a rack rail: base at (x, y, z), leaning toward +x by `lean`. */
function leaningSkis(k: Kit, mat: THREE.Material, x: number, y: number, z: number, lean: number, board = false) {
  const len = board ? 1.5 : 1.68, w = board ? 0.25 : 0.068;
  for (const off of board ? [0] : [-0.038, 0.038]) {
    const g = new THREE.BoxGeometry(0.02, len, w); g.translate(0, len / 2, 0); g.rotateZ(-lean); g.translate(x, y, z + off); k.add(g, mat);
  }
}
/** A wagon wheel hung flat on a wall facing +x. */
function wagonWheel(k: Kit, x: number, y: number, z: number, r = 0.42) {
  const M = k.M;
  const rim = new THREE.TorusGeometry(r, 0.035, 5, 28); rim.rotateY(Math.PI / 2); rim.translate(x, y, z); k.add(rim, M.wheel);
  const hub = new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10); hub.rotateZ(Math.PI / 2); hub.translate(x, y, z); k.add(hub, M.wheel);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; k.obox(M.wheel, 0.03, r, 0.035, x, y + Math.cos(a) * r / 2, z + Math.sin(a) * r / 2, 0, a); }
}
/** A small satellite dish on a short mast, facing roughly south-west (toward +x). */
function satelliteDish(k: Kit, x: number, y: number, z: number, r = 0.4) {
  const M = k.M;
  k.cyl(M.steel, 0.025, 0.025, x, y, y + 0.75, z, 6);
  // a spherical cap whose hollow faces south-west and a little up
  const d = new THREE.SphereGeometry(r, 16, 6, 0, Math.PI * 2, 0, 0.55); d.rotateZ(Math.PI / 2 + 0.5); d.rotateY(-0.6); d.translate(x + 0.3 * r / 0.4, y + 0.95, z + 0.2 * r / 0.4); k.add(d, M.dish);
}
/**
 * Extrude a polygon given as (u, y) points. axis 'x': a wall at constant x from w0 to w1 spanning lodge z (u = -z);
 * axis 'z': a wall at constant z from w0 to w1 spanning lodge x (u = x).
 */
function prism(k: Kit, mat: THREE.Material, pts: [number, number][], axis: 'x' | 'z', w0: number, w1: number) {
  const s = new THREE.Shape(pts.map(([u, y]) => new THREE.Vector2(u, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: w1 - w0, bevelEnabled: false });
  const m = new THREE.Matrix4();
  if (axis === 'z') m.makeTranslation(0, 0, w0);
  else m.set(0, 0, 1, w0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1);
  k.add(g, mat, m);
}

// ---------------------------------------------------------------- the lodge
const LODGE = { cx: 115.5, cz: -961, yaw: -1.83 };
const HX = 15.5, HZ = 7.75, T = 0.3;
const UP_CEIL = 3.15, ROOF = 3.7, LOW = -3.4, LOW_END = -1.0;
const EAST = { x0: 1.6, x1: 13.6, z0: -13.8, top: 6.6 };
// South side, from the owner's 2010 and 2020 photos (layout and sizes are estimates, DECISIONS.md D29):
// the single-storey west annex (signed wing, then a lower wing under a blue shed roof), the storefront
// arcade, the wood-framed sunroom, and the open gable canopy over the west end of the deck.
const ANNEX = { x0: 6.5, x1: 17.0, z0: HZ, zm: 12.9, z1: 18.5 };
const SUNROOM = { x0: EAST.x1, x1: 17.0, z0: EAST.z0, z1: -HZ };
const ARCADE = { x: 17.0, col: 16.55, cols: [-5.0, -2.4, 0.2, 2.8, 5.4] };
const DECK_Y = -0.02, DECK_EDGE = 22.6, DECK_EAST = -17.6;
const CANOPY = { x0: 17.0, x1: 25.4, z0: 7.2, z1: 18.6, eave: 2.9, ridge: 5.0 };
const DECK_W = { x0: -4.5, x1: 5.0, z0: HZ, z1: 14.0, y: -0.1 };
const RACK_X = 26.6;
// racks run along lodge z: [x, z0, z1, banner, side people stand on]; the last is on the snow west of the canopy
const RACKS: [number, number, number, string, 1 | -1][] = [[RACK_X, -15.5, -11.3, 'SKI & RIDE SCHOOL', -1], [RACK_X, -4.2, 0.0, 'GRIZZ GRILL & BARISTA', -1], [RACK_X, 2.5, 6.7, "TODD'S TAVERN", -1], [17.0, 21.5, 25.7, 'SUNLIGHT MOUNTAIN', 1]];

// Start on the gentle snow beside the west rack, just past the canopy, facing down toward the base lifts with
// the chase camera clear of the canopy roof.
export const LODGE_SKI_START = {
  ...toWorld(LODGE, 22.5, 23.0),
  heading: headingFromDir(-0.6, -1),
};

/** World footprints of the lodge's annex, decks, canopy and small east buildings (trees are kept out of them). */
export function lodgeSiteFootprints(): { points: number[][] }[] {
  const m = 0.8, rects = [
    [ANNEX.x0, ANNEX.x1, ANNEX.z0, ANNEX.z1], [CANOPY.x0, CANOPY.x1, CANOPY.z0, CANOPY.z1 + 3], [EAST.x0, DECK_EDGE, DECK_EAST, CANOPY.z0],
    [DECK_W.x0, DECK_W.x1, DECK_W.z0, DECK_W.z1 + 5.5], [16.5, 22.0, -22.6, -17.85], [10.3, 23.5, -38.5, -24.3], [16.4, 17.6, 21.5, 25.7],
  ];
  return rects.map(([x0, x1, z0, z1]) => ({ points: [[x0 - m, z0 - m], [x1 + m, z0 - m], [x1 + m, z1 + m], [x0 - m, z1 + m]].map(([lx, lz]) => { const w = toWorld(LODGE, lx, lz); return [w.x, w.z]; }) }));
}

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
  // roof: membrane inside a cream parapet with a metal cap, a deep winter snow load, and the rooftop plant
  // seen in the photos (round turbine vents and tall kitchen stacks near the storefront, a satellite dish)
  k.box(M.roofMembrane, -HX, HX, UP_CEIL, ROOF - 0.25, -HZ, HZ);
  const parapet = (x0: number, x1: number, z0: number, z1: number) => { k.box(M.stuccoCream, x0, x1, ROOF - 0.55, ROOF, z0, z1); k.box(M.steel, x0 - 0.03, x1 + 0.03, ROOF, ROOF + 0.04, z0 - 0.03, z1 + 0.03); };
  parapet(-HX - 0.05, -HX + 0.05, -HZ, HZ);                       // north end
  parapet(-HX, ANNEX.x0, HZ - 0.05, HZ + 0.05);                   // west side (the annex covers the rest)
  parapet(-HX, EAST.x0, -HZ - 0.05, -HZ + 0.05); parapet(EAST.x1, HX, -HZ - 0.05, -HZ + 0.05);
  k.box(M.snow, -HX + 0.05, HX + 0.02, ROOF - 0.25, ROOF + 0.14, -HZ + 0.05, HZ - 0.05);
  for (const [x, z, w, d, h] of [[-6, -3, 2.4, 1.6, 1.3], [2, 2.5, 1.8, 1.4, 1.1], [-11, 3, 1.0, 1.0, 0.8]]) {
    k.box(M.hvac, x - w / 2, x + w / 2, ROOF - 0.05, ROOF - 0.05 + h, z - d / 2, z + d / 2);
    k.box(M.snow, x - w / 2 + 0.02, x + w / 2 - 0.02, ROOF - 0.05 + h, ROOF + h + 0.1, z - d / 2 + 0.02, z + d / 2 - 0.02);
  }
  for (const [x, z, h] of [[10.5, 5.6, 1.1], [8.2, 1.6, 0.9], [-2, -5, 0.8]]) { k.cyl(M.steel, 0.14, 0.14, x, ROOF - 0.2, ROOF + h, z, 12); k.cyl(M.steel, 0.24, 0.18, x, ROOF + h + 0.12, ROOF + h + 0.3, z, 12); k.cyl(M.steel, 0.04, 0.04, x, ROOF + h, ROOF + h + 0.13, z, 6); }
  for (const [x, z] of [[12.4, 3.3], [11.8, -0.6], [13.0, -3.6], [6.0, 4.4]]) { // turbine vents
    k.cyl(M.steel, 0.12, 0.12, x, ROOF - 0.2, ROOF + 0.45, z, 10);
    const t = new THREE.SphereGeometry(0.26, 14, 8); t.scale(1, 0.85, 1); t.translate(x, ROOF + 0.62, z); k.add(t, M.steel);
  }
  satelliteDish(k, 11.0, ROOF + 0.1, -5.6, 0.45); satelliteDish(k, 7.6, ROOF + 0.1, -6.6, 0.38);

  // ---------- upper level walls
  const band = { mat: M.pineWall, y: 1.05 };
  // storefront behind the arcade: olive-framed glass with transoms between cream piers, main doors at the east end
  const SOUTH_DOOR = { a: -7.25, b: -5.35 };
  const southStore: Opening[] = [
    { ...SOUTH_DOOR, y0: 0, y1: 2.95, door: true, frame: M.olive, transom: 2.3 },
    ...[[-4.75, -2.65], [-2.15, -0.05], [0.45, 2.55], [3.05, 5.15], [5.65, 7.45]].map(([a, b]) => ({ a, b, y0: 0.45, y1: 2.95, mullions: 2, frame: M.olive, transom: 2.3 })),
  ];
  wall(k, 'z', -HZ, HZ, HX, 1, 0, ROOF - 0.55, M.stuccoCream, M.sage, southStore, band);
  const westUp: Opening[] = [
    { a: -13.2, b: -10.8, y0: 0.95, y1: 2.55 }, { a: -8.2, b: -5.8, y0: 0.95, y1: 2.55 },
    { a: 0.6, b: 1.7, y0: 0, y1: 2.25, door: true }, { a: 3.6, b: 6.0, y0: 0.95, y1: 2.55 }];
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
  k.box(M.vinyl, 12.5, HX - T, 0.005, 0.02, SOUTH_DOOR.a - 0.15, SOUTH_DOOR.b + 0.15);
  for (const z of [2.6, 3.2]) { k.box(M.blackMetal, 13.6, 14.1, 0, 0.95, z - 0.25, z + 0.25); }
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

  // ---------- east section: two storeys (lidar roof 6.6 m). The ground-floor dining room opens south into the
  // wood-framed sunroom; the upper storey is clad in tan lap siding with red trim under a western false front
  // with two wagon wheels (owner's 2020 photos; window sizes and positions are estimates).
  const E = EAST, SR = SUNROOM;
  wall(k, 'x', E.x0, E.x1, E.z0, -1, 0, 3.3, M.stuccoBeige, M.sage, [{ a: 3.0, b: 6.4, y0: 0.9, y1: 2.6 }, { a: 8.2, b: 11.6, y0: 0.9, y1: 2.6 }], band);
  wall(k, 'z', E.z0, -HZ, E.x0, -1, 0, 3.3, M.stuccoBeige, M.sage, [], band);
  // the old south wall is now a header over the wide opening into the sunroom
  k.box(M.sage, E.x1 - 0.15, E.x1 + 0.15, 2.75, 3.3, E.z0, -HZ); k.box(M.beam, E.x1 - 0.17, E.x1 + 0.17, 2.6, 2.78, E.z0 + T, -HZ);
  wallColliders(addCol, 'z', E.z0, -HZ, E.x1, 1, 2.75, E.top, []); wallColliders(addCol, 'x', E.x0, E.x1, E.z0, -1, 0, E.top, []); wallColliders(addCol, 'z', E.z0, -HZ, E.x0, -1, 0, E.top, []);
  const red = M.redTrim, upTop = E.top - 0.2;
  wall(k, 'z', E.z0, -HZ, E.x1, 1, 3.3, upTop, M.siding, null, [
    { a: -10.0, b: -9.1, y0: 4.2, y1: 5.75, dark: true, frame: red }, { a: -12.95, b: -11.25, y0: 4.4, y1: 5.6, dark: true, frame: red, mullions: 2 }]);
  wall(k, 'x', E.x0, E.x1, E.z0, -1, 3.3, upTop, M.siding, null, [3.0, 7.5, 10.8].map((a) => ({ a, b: a + 1.0, y0: 4.4, y1: 5.7, dark: true, frame: red })));
  wall(k, 'z', E.z0, -HZ, E.x0, -1, 3.3, upTop, M.siding, null, [{ a: -12.0, b: -11.0, y0: 4.4, y1: 5.7, dark: true, frame: red }]);
  wall(k, 'x', E.x0, E.x1, -HZ, 1, ROOF - 0.55, upTop, M.siding, null, [{ a: 5.2, b: 6.2, y0: 4.4, y1: 5.7, dark: true, frame: red }, { a: 10.9, b: 11.9, y0: 4.3, y1: 5.7, dark: true, frame: red }]);
  for (const [x, z, y0] of [[E.x1, E.z0, 3.3], [E.x1, -HZ, 3.3], [E.x0, E.z0, 3.3], [E.x0, -HZ, ROOF]] as const) k.box(red, x - 0.09, x + 0.09, y0, upTop, z - 0.09, z + 0.09);
  k.box(M.roofMembrane, E.x0, E.x1, E.top - 0.6, E.top - 0.25, E.z0, -HZ);
  k.box(M.snow, E.x0 + 0.05, E.x1 - 0.05, E.top - 0.25, E.top + 0.12, E.z0 + 0.05, -HZ - 0.05);
  for (const [x0, x1, z0, z1] of [[E.x0, E.x1, E.z0 - 0.06, E.z0 + 0.06], [E.x0 - 0.06, E.x0 + 0.06, E.z0, -HZ], [E.x0, E.x1, -HZ - 0.06, -HZ + 0.06]]) k.box(red, x0, x1, upTop, upTop + 0.12, z0, z1);
  // western false front on the south face, its shoulders curving up to a flat crest, with a red cap
  {
    const u0 = HZ - 0.1, u1 = -E.z0 + 0.1, base = upTop - 0.45, shoulder = 6.85, crest = 7.5, top: [number, number][] = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; top.push([u0 + 0.85 * t, shoulder + (crest - shoulder) * (1 - Math.cos(t * Math.PI / 2))]); }
    for (let i = 0; i <= 8; i++) { const t = i / 8; top.push([u1 - 0.85 + 0.85 * t, shoulder + (crest - shoulder) * (1 - Math.cos((1 - t) * Math.PI / 2))]); }
    prism(k, M.siding, [[u0, base], ...top, [u1, base]], 'x', E.x1, E.x1 + 0.2);
    const cap: [number, number][] = [...top, ...top.slice().reverse().map(([u, y]): [number, number] => [u, y + 0.12])];
    prism(k, red, cap, 'x', E.x1 - 0.04, E.x1 + 0.28);
    k.box(red, E.x1, E.x1 + 0.26, base - 0.1, base, E.z0 - 0.1, -HZ + 0.1);
    for (const z of [-9.0, -12.6]) wagonWheel(k, E.x1 + 0.24, 6.72, z);
  }

  // ---------- sunroom: varnished wood frames on a board base, a sloped glazed band under a brown metal roof
  k.box(M.concrete, E.x0, SR.x1, -1.6, -0.35, E.z0, -HZ);
  k.box(M.concrete, E.x0, SR.x1, -0.35, 0, E.z0, -HZ); k.box(M.carpet, E.x0 + T, SR.x1 - 0.12, -0.01, 0.005, E.z0 + 0.12, -HZ);
  floor(E.x0, SR.x1, E.z0, -HZ, 0, SUN);
  k.box(M.ceiling, E.x0 + T, E.x1 - 0.15, 2.98, 3.0, E.z0 + T, -HZ);
  k.box(M.ceiling, E.x1 + 0.15, 16.0, 3.18, 3.2, SR.z0 + 0.1, SR.z1);
  const SR_DOOR = { a: -11.36, b: -10.14 };
  const glazed = (axis: 'x' | 'z', posts: number[], w: number, out: 1 | -1, door?: { a: number; b: number }) => {
    const B = (mat: THREE.Material, a: number, b: number, y0: number, y1: number, t0: number, t1: number) => {
      const w0 = w - out * t1, w1 = w - out * t0;
      axis === 'x' ? k.box(mat, a, b, y0, y1, Math.min(w0, w1), Math.max(w0, w1)) : k.box(mat, Math.min(w0, w1), Math.max(w0, w1), y0, y1, a, b);
    };
    const lo = posts[0], hi = posts[posts.length - 1];
    for (let i = 0; i < posts.length - 1; i++) {
      const a = posts[i], b = posts[i + 1], isDoor = door && Math.abs(a - door.a) < 0.01;
      if (!isDoor) { B(M.cedar, a, b, 0, 0.55, 0, 0.12); B(M.cedar, a, b, 0.55, 0.6, -0.03, 0.14); B(M.glass, a + 0.05, b - 0.05, 0.6, 2.7, 0.05, 0.07); }
      else B(M.glass, a + 0.05, b - 0.05, 2.15, 2.7, 0.05, 0.07);
    }
    for (const p of posts) B(M.cedar, p - 0.05, p + 0.05, 0, 2.82, -0.02, 0.12);
    B(M.cedar, lo, hi, 2.08, 2.15, -0.01, 0.12); B(M.cedar, lo, hi, 2.7, 2.82, -0.02, 0.14);
  };
  const sPosts = [-13.8, -12.99, -12.17, SR_DOOR.a, SR_DOOR.b, -9.34, -8.55, -7.75];
  glazed('z', sPosts, SR.x1, 1, SR_DOOR);
  glazed('x', [E.x1, 14.73, 15.87, SR.x1], SR.z0, -1);
  glazed('x', [HX, SR.x1], -HZ, 1);
  // double doors in light oak, standing open
  for (const [z, s] of [[SR_DOOR.a + 0.04, 1], [SR_DOOR.b - 0.04, -1]] as const) {
    k.box(M.oak, SR.x1 - 0.72, SR.x1 - 0.12, 0.02, 2.06, z - 0.025, z + 0.025);
    k.box(M.glass, SR.x1 - 0.66, SR.x1 - 0.18, 0.5, 1.95, z - 0.01 + s * 0.0, z + 0.01);
  }
  // sloped glazing and roof
  const slope = Math.atan2(0.53, 1.0), slen = Math.hypot(0.53, 1.0);
  k.obox(M.darkGlass, slen, 0.03, -SR.z0 - HZ + 0.05, 16.5, 3.085, (SR.z0 - HZ) / 2, 0, 0, -slope);
  for (const z of sPosts) k.obox(M.cedar, slen, 0.08, 0.07, 16.5, 3.11, z, 0, 0, -slope);
  for (const z of [SR.z0, -HZ]) k.box(M.cedar, 16.0, SR.x1, 2.82, 3.08, z - 0.05, z + 0.05);
  k.box(M.brownRoof, E.x1, 16.15, 3.35, 3.46, SR.z0 - 0.12, -HZ + 0.02);
  k.box(red, 16.02, 16.16, 3.28, 3.5, SR.z0 - 0.12, -HZ + 0.02);
  k.box(M.snow, E.x1 + 0.05, 16.05, 3.46, 3.6, SR.z0 - 0.05, -HZ - 0.02);
  addCol(SR.x1 - 0.15, SR.x1 + 0.05, SR.z0, SR_DOOR.a, 0, 3.4); addCol(SR.x1 - 0.15, SR.x1 + 0.05, SR_DOOR.b, -HZ, 0, 3.4);
  addCol(E.x1, SR.x1 + 0.05, SR.z0 - 0.06, SR.z0 + 0.12, 0, 3.4); addCol(HX, SR.x1 + 0.05, -HZ - 0.12, -HZ + 0.06, 0, 3.4);
  for (const z of [-9.05, -12.5]) {
    for (const s of diningTable(k, 15.2, 0, z, 0, 4)) poi('seat', s.x, 0.45, s.z, s.h, SUN, 'dining');
    addCol(14.6, 15.8, z - 0.45, z + 0.45, 0, 0.78); lamp(15.2, 2.45, z, 0.6);
  }
  const srMid = (SR_DOOR.a + SR_DOOR.b) / 2;
  poi('door', SR.x1 + 1.1, DECK_Y, srMid, Math.PI / 2, null, 'sunroom-door'); poi('door', SR.x1 - 1.1, 0, srMid, -Math.PI / 2, SUN, 'sunroom-door-in');
  for (const z of [-11.8, -9.6]) for (const s of diningTable(k, 7.5, 0, z, 0, 4)) poi('seat', s.x, 0.45, s.z, s.h, SUN, 'dining');
  for (const z of [-11.8, -9.6]) { addCol(6.9, 8.1, z - 0.45, z + 0.45, 0, 0.78); lamp(7.5, 2.3, z, 0.8); }
  for (const z of [-11.8, -9.6]) for (const s of diningTable(k, 4.0, 0, z, 0, 4)) poi('seat', s.x, 0.45, s.z, s.h, SUN, 'dining');
  for (const z of [-11.8, -9.6]) { addCol(3.4, 4.6, z - 0.45, z + 0.45, 0, 0.78); lamp(4.0, 2.3, z, 0.8); }

  // ---------- west annex (not enterable): the signed wing, flush with the main roof, and a lower wing under a
  // blue standing-seam shed roof with the red door and the ticket window (2010 photo; blue roof also in 2023 NAIP)
  const A = ANNEX;
  const skirt = (axis: 'x' | 'z', u0: number, u1: number, w: number, inward: 1 | -1, mat: THREE.Material = M.stuccoCream) => {
    for (let u = u0; u < u1 - 0.01; u += 1.5) {
      const ub = Math.min(u1, u + 1.5), gy = axis === 'x' ? Math.min(ground(u, w), ground(ub, w)) : Math.min(ground(w, u), ground(w, ub));
      if (gy > DECK_Y - 0.15) continue;
      axis === 'x' ? k.box(mat, u, ub, gy - 0.3, DECK_Y - 0.1, Math.min(w, w + inward * 0.3), Math.max(w, w + inward * 0.3))
        : k.box(mat, Math.min(w, w + inward * 0.3), Math.max(w, w + inward * 0.3), gy - 0.3, DECK_Y - 0.1, u, ub);
    }
  };
  skirt('z', A.z0, A.z1, A.x0, 1); skirt('x', A.x0, A.x1, A.z1, -1); skirt('z', A.z0, A.z1, A.x1, -1);
  const AY = DECK_Y - 0.1, BLUE_HI = 3.2, BLUE_LO = 2.45;
  // signed wing
  k.box(M.stuccoCream, A.x1 - 0.3, A.x1, AY, ROOF, A.z0, A.zm); k.box(M.stuccoCream, A.x0, A.x0 + 0.3, AY, ROOF, A.z0, A.zm);
  k.box(M.stuccoCream, HX, A.x1, AY, ROOF, A.z0, A.z0 + 0.3); k.box(M.stuccoCream, A.x0, A.x1, BLUE_HI - 0.2, ROOF, A.zm - 0.3, A.zm);
  k.box(M.roofMembrane, A.x0, A.x1, ROOF - 0.55, ROOF - 0.25, A.z0, A.zm);
  parapet(A.x1 - 0.1, A.x1, A.z0, A.zm); parapet(A.x0, A.x0 + 0.1, A.z0, A.zm); parapet(A.x0, A.x1, A.zm - 0.1, A.zm);
  k.box(M.snow, A.x0 + 0.05, A.x1 + 0.02, ROOF - 0.25, ROOF + 0.14, A.z0 - 0.05, A.zm - 0.05);
  // the taller stair penthouse behind the sign, its top sloping down to the west
  k.box(M.stuccoCream, 9.0, 13.0, ROOF - 0.2, 5.0, 8.3, 11.6);
  prism(k, M.stuccoCream, [[-11.6, ROOF - 0.2], [-13.1, ROOF - 0.2], [-11.6, 5.0]], 'x', 9.0, 13.0);
  k.box(M.snow, 9.0, 13.0, 5.0, 5.14, 8.3, 11.6); k.box(M.steel, 8.97, 13.03, 4.97, 5.0, 8.27, 11.63);
  // lower wing with its sloping eave
  const shed: [number, number][] = [[-A.zm, AY], [-A.z1, AY], [-A.z1, BLUE_LO], [-A.zm, BLUE_HI]];
  prism(k, M.stuccoCream, shed, 'x', A.x1 - 0.3, A.x1); prism(k, M.stuccoCream, shed, 'x', A.x0, A.x0 + 0.3);
  k.box(M.stuccoCream, A.x0, A.x1, AY, BLUE_LO, A.z1 - 0.3, A.z1);
  {
    const z0 = A.zm, z1 = A.z1 + 0.35, drop = (BLUE_HI - BLUE_LO) / (A.z1 - A.zm) * (z1 - z0), len = Math.hypot(z1 - z0, drop), rx = Math.atan2(drop, z1 - z0);
    const yc = BLUE_HI - drop / 2 + 0.04, zc = (z0 + z1) / 2;
    k.obox(M.blueRoof, A.x1 - A.x0 + 0.5, 0.06, len, (A.x0 + A.x1) / 2, yc, zc, 0, rx);
    for (let x = A.x0 - 0.2; x <= A.x1 + 0.2; x += 0.45) k.obox(M.blueRoof, 0.035, 0.05, len, x, yc + 0.05, zc, 0, rx);
    k.box(M.blueRoof, A.x0 - 0.25, A.x1 + 0.25, BLUE_HI - 0.04, BLUE_HI + 0.12, A.zm - 0.12, A.zm + 0.12);
  }
  // red door, ticket window and sign, an electrical box
  k.box(M.redDoor, A.x1, A.x1 + 0.06, AY, 2.0, 14.3, 15.3); k.box(M.trim, A.x1, A.x1 + 0.08, 2.0, 2.08, 14.22, 15.38);
  for (const z of [14.22, 15.3]) k.box(M.trim, A.x1, A.x1 + 0.08, AY, 2.08, z, z + 0.08);
  k.box(M.steel, A.x1 + 0.06, A.x1 + 0.1, 0.95, 1.1, 15.12, 15.2);
  k.box(M.darkGlass, A.x1, A.x1 + 0.03, 0.95, 1.95, 16.1, 17.7); k.box(M.bronze, A.x1, A.x1 + 0.06, 1.92, 2.0, 16.05, 17.75);
  k.box(M.tableTop, A.x1, A.x1 + 0.35, 0.92, 0.97, 16.0, 17.8);
  const tix = new THREE.MeshStandardNodeMaterial({ map: signTex([{ text: 'LIFT TICKETS', size: 92, y: 128, color: '#ffffff' }], '#1d3b5e', 1024, 256), roughness: 0.6 });
  k.plane(tix, 1.5, 0.37, A.x1 + 0.04, 2.2, 16.9, Math.PI / 2);
  k.box(M.hvac, A.x1, A.x1 + 0.12, 1.0, 1.5, 13.3, 13.7);
  poi('counter', A.x1 + 1.2, DECK_Y, 16.9, Math.PI / 2, null, 'tickets');
  const logo = new THREE.MeshStandardNodeMaterial({ map: wallLogo(), roughness: 0.8, alphaTest: 0.5 });
  k.plane(logo, 4.4, 2.2, A.x1 + 0.02, 1.72, 10.3, Math.PI / 2);
  addCol(A.x0, A.x1, A.z0, A.z1, ground(A.x0, A.z1) - 0.5, ROOF + 0.2);

  // ---------- decks: one level with the dining floor, dark red-brown boards, posts down where the snow falls away
  const deckBlock = (x0: number, x1: number, z0: number, z1: number, name: string) => {
    k.box(M.deck, x0, x1, DECK_Y - 0.1, DECK_Y, z0, z1);
    floor(x0, x1, z0, z1, DECK_Y, name);
    for (let x = x0 + 0.6; x < x1; x += 2.4) for (let z = z0 + 0.6; z < z1; z += 2.4) { const gy = ground(x, z); if (gy < DECK_Y - 0.3) k.box(M.deckRail, x - 0.09, x + 0.09, gy - 0.3, DECK_Y - 0.1, z - 0.09, z + 0.09); }
  };
  deckBlock(HX, DECK_EDGE, -HZ, CANOPY.z0, 'South deck');
  deckBlock(HX, CANOPY.x0, CANOPY.z0, HZ, 'South deck corner');
  deckBlock(CANOPY.x0, CANOPY.x1, CANOPY.z0, CANOPY.z1, 'Canopy deck');
  deckBlock(SR.x1, DECK_EDGE, DECK_EAST, -HZ, 'East deck');
  deckBlock(SR.x0, SR.x1, DECK_EAST, SR.z0, 'East deck corner');
  skirt('z', CANOPY.z0, CANOPY.z1, CANOPY.x1, -1, M.deckRail); skirt('x', CANOPY.x0, CANOPY.x1, CANOPY.z1, -1, M.deckRail);
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / 1.8));
    for (let i = 0; i <= n; i++) { const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; k.box(M.deckRail, x - 0.065, x + 0.065, DECK_Y, DECK_Y + 1.05, z - 0.065, z + 0.065); }
    for (const h of [0.45, 0.98]) k.box(M.deckRail, Math.min(x0, x1) - 0.04, Math.max(x0, x1) + 0.04, DECK_Y + h - 0.05, DECK_Y + h + 0.05, Math.min(z0, z1) - 0.04, Math.max(z0, z1) + 0.04);
    addCol(Math.min(x0, x1) - 0.07, Math.max(x0, x1) + 0.07, Math.min(z0, z1) - 0.07, Math.max(z0, z1) + 0.07, DECK_Y, DECK_Y + 1.05);
  };
  const STEPS = { east: [-12.6, -10.4], main: [-6.9, -4.7], canopy: [12.2, 14.4], west: [18.0, 19.8] };
  rail(DECK_EDGE, DECK_EAST, DECK_EDGE, STEPS.east[0]); rail(DECK_EDGE, STEPS.east[1], DECK_EDGE, STEPS.main[0]); rail(DECK_EDGE, STEPS.main[1], DECK_EDGE, CANOPY.z0);
  rail(DECK_EDGE, CANOPY.z0, CANOPY.x1, CANOPY.z0);
  rail(CANOPY.x1, CANOPY.z0, CANOPY.x1, STEPS.canopy[0]); rail(CANOPY.x1, STEPS.canopy[1], CANOPY.x1, CANOPY.z1);
  rail(CANOPY.x0, CANOPY.z1, STEPS.west[0], CANOPY.z1); rail(STEPS.west[1], CANOPY.z1, CANOPY.x1, CANOPY.z1);
  rail(SR.x0, DECK_EAST, 16.5, DECK_EAST); rail(22.0, DECK_EAST, DECK_EDGE, DECK_EAST);
  rail(SR.x0, DECK_EAST, SR.x0, SR.z0);
  for (const [z0, z1] of [STEPS.east, STEPS.main]) {
    const gy = Math.min(ground(DECK_EDGE + 0.8, (z0 + z1) / 2), DECK_Y - 0.12);
    stairX(DECK_EDGE, DECK_EDGE + Math.max(0.3, (DECK_Y - gy) / 0.18 * 0.3), DECK_Y, gy, z0 + 0.1, z1 - 0.1, M.deck, 'Deck steps');
    poi('door', DECK_EDGE + 2.0, gy, (z0 + z1) / 2, Math.PI / 2, null, 'deck-steps');
  }
  {
    const [z0, z1] = STEPS.canopy, gy = Math.min(ground(CANOPY.x1 + 0.8, (z0 + z1) / 2), DECK_Y - 0.12);
    stairX(CANOPY.x1, CANOPY.x1 + Math.max(0.3, (DECK_Y - gy) / 0.18 * 0.3), DECK_Y, gy, z0 + 0.1, z1 - 0.1, M.deck, 'Deck steps');
    poi('door', CANOPY.x1 + 2.0, gy, (z0 + z1) / 2, Math.PI / 2, null, 'deck-steps');
    const [x0, x1] = STEPS.west, gw = Math.min(ground((x0 + x1) / 2, CANOPY.z1 + 2.5), DECK_Y - 0.12), run = Math.max(0.3, (DECK_Y - gw) / 0.18 * 0.28);
    stairZ(CANOPY.z1, CANOPY.z1 + run, DECK_Y, gw, x0 + 0.05, x1 - 0.05, M.deck, 'Deck steps');
    poi('door', (x0 + x1) / 2, gw, CANOPY.z1 + run + 1.2, 0, null, 'deck-steps');
  }

  // ---------- storefront arcade: cream piers carry dark red beams whose ends project past the eave
  k.box(M.roofMembrane, HX, ARCADE.x + 0.05, ROOF - 0.4, ROOF - 0.2, -HZ, HZ);
  k.box(M.maroon, HX, ARCADE.x, 3.0, 3.08, -HZ, HZ);
  k.box(M.maroon, ARCADE.x - 0.12, ARCADE.x + 0.05, 2.9, ROOF - 0.12, -HZ, HZ);
  k.box(M.snow, HX - 0.1, ARCADE.x + 0.16, ROOF - 0.2, ROOF + 0.14, -HZ + 0.02, HZ - 0.02);
  { const lip = new THREE.CylinderGeometry(0.16, 0.16, 2 * HZ - 0.1, 10); lip.rotateX(Math.PI / 2); lip.translate(ARCADE.x + 0.12, ROOF + 0.0, 0); k.add(lip, M.snow); }
  for (const z of [...ARCADE.cols, -HZ + 0.2]) {
    k.box(M.maroon, HX, ARCADE.x + 0.45, 2.86, 3.42, z - 0.17, z + 0.17);
    if (Math.abs(z) > HZ - 0.5) continue;
    k.box(M.stuccoCream, ARCADE.col - 0.21, ARCADE.col + 0.21, DECK_Y, 2.88, z - 0.21, z + 0.21);
    addCol(ARCADE.col - 0.22, ARCADE.col + 0.22, z - 0.22, z + 0.22, DECK_Y, 2.88);
  }
  for (const z of [-3.7, 1.5, 4.1]) k.box(M.hvac, HX + 0.02, HX + 0.16, 2.6, 2.76, z - 0.13, z + 0.13);
  const doorZ = (SOUTH_DOOR.a + SOUTH_DOOR.b) / 2;
  poi('door', HX + 2.0, DECK_Y, doorZ, Math.PI / 2, null, 'south-door'); poi('door', HX - 1.2, 0, doorZ, -Math.PI / 2, UPPER, 'south-door-in');
  for (const x of [18.7, 21.0]) for (const z of [-2.9, -0.5, 1.9, 4.3]) {
    for (const s of picnicTable(k, x, DECK_Y, z, Math.PI / 2)) poi('seat', s.x, DECK_Y + 0.45, s.z, s.h, null, 'deck');
    addCol(x - 0.45, x + 0.45, z - 0.95, z + 0.95, DECK_Y, DECK_Y + 0.8);
  }
  const bin = (x: number, z: number) => { k.cyl(M.bin, 0.28, 0.3, x, DECK_Y, DECK_Y + 0.92, z, 12); k.cyl(M.bin, 0.33, 0.33, x, DECK_Y + 0.92, DECK_Y + 1.0, z, 12); addCol(x - 0.32, x + 0.32, z - 0.32, z + 0.32, DECK_Y, DECK_Y + 1.0); };
  bin(17.35, 6.85); bin(22.0, -16.95); bin(17.4, -7.3);

  // ---------- the open gable canopy over the west end of the deck, with the grill booth under it (2020 photos)
  {
    const C = CANOPY, cx = (C.x0 + C.x1) / 2, half = (C.x1 - C.x0) / 2, rise = C.ridge - C.eave, pitch = Math.atan2(rise, half), sl = Math.hypot(rise, half);
    const zc = (C.z0 + C.z1) / 2, zl = C.z1 - C.z0;
    for (const s of [-1, 1]) {
      const mx = cx + s * half / 2, my = (C.eave + C.ridge) / 2, nx = s * Math.sin(pitch), ny = Math.cos(pitch), rz = -s * pitch;
      // the south slope overhangs the posts; the north slope stops at the annex wall
      const e = s > 0 ? 0.2 : 0, ex = mx + s * Math.cos(pitch) * e, ey = my - Math.sin(pitch) * e;
      k.obox(M.canopy, sl + 2 * e, 0.05, zl, ex, ey, zc, 0, 0, rz);
      k.obox(M.snow, sl + 2 * e + 0.05, 0.3, zl + 0.1, ex + nx * 0.17, ey + ny * 0.17, zc, 0, 0, rz);
      for (const z of [C.z0 + 0.15, A.zm, C.z1 - 0.15]) k.obox(M.steel, sl, 0.14, 0.09, mx - nx * 0.1, my - ny * 0.1, z, 0, 0, rz);
      k.box(M.steel, s > 0 ? C.x1 - 0.25 : C.x0 + 0.2, s > 0 ? C.x1 - 0.05 : C.x0 + 0.4, C.eave - 0.25, C.eave - 0.05, C.z0, C.z1);
    }
    { const ridge = new THREE.CylinderGeometry(0.22, 0.22, zl + 0.1, 10); ridge.rotateX(Math.PI / 2); ridge.translate(cx, C.ridge + 0.22, zc); k.add(ridge, M.snow); }
    for (const z of [C.z0 + 0.15, A.zm, C.z1 - 0.15]) k.box(M.steel, C.x0, C.x1, C.eave - 0.2, C.eave - 0.08, z - 0.05, z + 0.05);
    const post = (x: number, z: number) => { k.box(M.steel, x - 0.07, x + 0.07, DECK_Y, C.eave - 0.05, z - 0.07, z + 0.07); addCol(x - 0.1, x + 0.1, z - 0.1, z + 0.1, DECK_Y, C.eave); };
    for (const z of [C.z0 + 0.15, 11.05, 14.75, C.z1 - 0.15]) post(C.x1 - 0.15, z);
    for (const z of [C.z0 + 0.15, A.zm, C.z1 - 0.15]) post(C.x0 + 0.35, z);
    // the yellow downspout on the front corner post
    k.cyl(M.yellow, 0.07, 0.07, C.x1 + 0.0, DECK_Y, C.eave - 0.1, C.z0 + 0.15, 10); k.box(M.yellow, C.x1 - 0.1, C.x1 + 0.1, C.eave - 0.2, C.eave + 0.0, C.z0 + 0.05, C.z0 + 0.25);
    // grill booth: dark board walls, a service window and counter facing the deck, a banner
    const bx0 = 20.6, bx1 = 23.3, bz0 = 15.8, bz1 = 18.35;
    k.box(M.battens, bx0, bx1, DECK_Y, 2.45, bz0, bz1); k.box(M.trim, bx0 - 0.08, bx1 + 0.08, 2.45, 2.58, bz0 - 0.08, bz1 + 0.08);
    k.box(M.darkGlass, bx0 + 0.35, bx1 - 0.35, 1.0, 2.0, bz0 - 0.02, bz0); k.box(M.oak, bx0 + 0.25, bx1 - 0.25, 0.98, 1.04, bz0 - 0.3, bz0);
    const grill = new THREE.MeshStandardNodeMaterial({ map: signTex([{ text: 'GRIZZ GRILL', size: 120, y: 105, color: '#ffffff' }, { text: 'ON THE DECK', size: 60, y: 200, color: '#f2c14e' }], '#7a1f1c', 1024, 256), roughness: 0.7 });
    k.plane(grill, 2.2, 0.55, bx1 + 0.02, 1.85, (bz0 + bz1) / 2, Math.PI / 2);
    addCol(bx0, bx1, bz0, bz1, DECK_Y, 2.5);
    poi('counter', (bx0 + bx1) / 2, DECK_Y, bz0 - 1.0, Math.PI, null, 'deck-grill');
    for (const [x, z] of [[19.6, 9.0], [19.6, 11.5], [22.6, 9.0], [22.6, 11.5]]) {
      for (const s of picnicTable(k, x, DECK_Y, z, Math.PI / 2)) poi('seat', s.x, DECK_Y + 0.45, s.z, s.h, null, 'deck');
      addCol(x - 0.45, x + 0.45, z - 0.95, z + 0.95, DECK_Y, DECK_Y + 0.8);
    }
  }

  // ---------- east deck: metal patio sets, a kettle grill
  for (const [x, z] of [[19.5, -8.75], [21.5, -8.75], [19.5, -14.4], [21.5, -14.4], [15.3, -15.7]]) {
    for (const s of patioSet(k, x, DECK_Y, z)) poi('seat', s.x, DECK_Y + 0.45, s.z, s.h, null, 'deck');
    addCol(x - 0.45, x + 0.45, z - 0.45, z + 0.45, DECK_Y, DECK_Y + 0.76);
  }
  { const x = 14.3, z = -16.9, kettle = new THREE.SphereGeometry(0.3, 14, 8); kettle.translate(x, DECK_Y + 0.82, z); k.add(kettle, M.patio); for (let i = 0; i < 3; i++) { const a = i * 2.1; k.cyl(M.patio, 0.015, 0.015, x + Math.cos(a) * 0.2, DECK_Y, DECK_Y + 0.75, z + Math.sin(a) * 0.2, 4); } addCol(x - 0.32, x + 0.32, z - 0.32, z + 0.32, DECK_Y, DECK_Y + 1.1); }

  // ---------- galvanized ski racks on the snow, each with a banner frame at one end
  const skiMats = [M.skiA, M.skiB, M.skiC, M.skiD];
  const rr = rng(97);
  for (const [x, z0, z1, label, side] of RACKS) {
    const gy = ground(x, (z0 + z1) / 2), G = M.galv;
    for (const z of [z0, (z0 + z1) / 2, z1]) for (const s of [-1, 1]) k.obox(G, 0.045, 1.24, 0.045, x + s * 0.24, gy + 0.55, z, 0, 0, s * 0.42);
    k.box(G, x - 0.03, x + 0.03, gy + 1.08, gy + 1.14, z0, z1);
    for (const s of [-1, 1]) k.box(G, x + s * 0.44 - 0.02, x + s * 0.44 + 0.02, gy + 0.16, gy + 0.21, z0, z1);
    for (let z = z0 + 0.12; z < z1 - 0.05; z += 0.2) for (const s of [-1, 1]) k.obox(G, 0.16, 0.018, 0.018, x + s * 0.09, gy + 1.17, z, 0, 0, s * 0.5);
    for (const zz of [z0, z0 + 1.4]) k.box(G, x - 0.03, x + 0.03, gy - 0.2, gy + 1.98, zz - 0.03, zz + 0.03);
    k.box(G, x - 0.03, x + 0.03, gy + 1.93, gy + 1.99, z0, z0 + 1.4);
    const sub = label === 'SUNLIGHT MOUNTAIN' ? 'GLENWOOD SPRINGS, COLORADO' : 'SUNLIGHT MOUNTAIN';
    const banner = new THREE.MeshStandardNodeMaterial({ map: signTex([{ text: label, size: 84, y: 190, color: '#ffffff' }, { text: sub, size: 52, y: 330, color: '#ffd23a' }], '#1f4f8f', 1024, 480), roughness: 0.75 });
    k.plane(banner, 1.32, 0.62, x + 0.012, gy + 1.55, z0 + 0.7, Math.PI / 2); k.plane(banner, 1.32, 0.62, x - 0.012, gy + 1.55, z0 + 0.7, -Math.PI / 2);
    for (let z = z0 + 1.6; z < z1 - 0.1; z += 0.2) if (rr() < 0.32) { const s = rr() < 0.5 ? -1 : 1; leaningSkis(k, skiMats[Math.floor(rr() * 4)], x + s * 0.5, gy, z, -s * 0.3, rr() < 0.25); }
    addCol(x - 0.5, x + 0.5, z0, z1, gy - 0.3, gy + 1.2);
    poi('rack', x + side * 1.0, gy, (z0 + z1) / 2 + 0.7, side * Math.PI / 2, null, 'ski-rack');
  }

  // ---------- small deck buildings to the east (2010 and 2020 photos; footprints estimated from NAIP)
  {
    // the dark red board-and-batten shack at the east end of the deck: gable roof, a western false front with a
    // little gabled crest toward the deck, a door and service window, a banner on the slope side
    const S = { x0: 16.5, x1: 22.0, z0: -22.6, z1: -17.85, eave: 2.6, ridge: 3.9 };
    const gs = Math.min(ground(S.x0, S.z0), ground(S.x1, S.z0), ground(S.x0, S.z1), ground(S.x1, S.z1));
    k.box(M.battens, S.x0, S.x1, gs - 0.3, S.eave, S.z0, S.z1);
    prism(k, M.battens, [[S.x0, S.eave], [S.x1, S.eave], [(S.x0 + S.x1) / 2, S.ridge]], 'z', S.z0, S.z1);
    const half = (S.x1 - S.x0) / 2, pitch = Math.atan2(S.ridge - S.eave, half), sl = Math.hypot(S.ridge - S.eave, half), cx = (S.x0 + S.x1) / 2;
    for (const s of [-1, 1]) {
      const mx = cx + s * half / 2, my = (S.eave + S.ridge) / 2 + 0.05, nx = s * Math.sin(pitch), ny = Math.cos(pitch);
      k.obox(M.greenRoof, sl + 0.6, 0.06, S.z1 - S.z0 + 0.6, mx + s * 0.2, my, (S.z0 + S.z1) / 2, 0, 0, -s * pitch);
      k.obox(M.snow, sl + 0.55, 0.26, S.z1 - S.z0 + 0.55, mx + s * 0.2 + nx * 0.16, my + ny * 0.16, (S.z0 + S.z1) / 2, 0, 0, -s * pitch);
    }
    const front: [number, number][] = [[S.x0 - 0.15, 2.3], [S.x1 + 0.15, 2.3], [S.x1 + 0.15, 3.55], [20.55, 3.55], [20.55, 4.15], [cx, 4.75], [17.95, 4.15], [17.95, 3.55], [S.x0 - 0.15, 3.55]];
    prism(k, M.battens, front, 'z', S.z1 - 0.02, S.z1 + 0.16);
    for (let i = 0; i < front.length - 1; i++) {
      if (i === 0) continue;
      const [ua, ya] = front[i], [ub, yb] = front[i + 1], L = Math.hypot(ub - ua, yb - ya);
      k.obox(M.redTrim, L + 0.08, 0.1, 0.24, (ua + ub) / 2, (ya + yb) / 2 + 0.03, S.z1 + 0.06, 0, 0, Math.atan2(yb - ya, ub - ua));
    }
    k.box(M.trim, 18.7, 19.6, 0, 2.1, S.z1, S.z1 + 0.06);
    k.box(M.darkGlass, 20.25, 21.55, 1.0, 1.9, S.z1, S.z1 + 0.03); k.box(M.redTrim, 20.18, 21.62, 0.94, 1.0, S.z1, S.z1 + 0.1); k.box(M.oak, 20.15, 21.65, 0.95, 1.0, S.z1, S.z1 + 0.32);
    const pass = new THREE.MeshStandardNodeMaterial({ map: signTex([{ text: 'SEASON PASSES', size: 110, y: 110, color: '#ffffff' }, { text: 'sunlightmtn.com', size: 64, y: 200, color: '#ffd23a' }], '#1f4f8f', 1024, 256), roughness: 0.75 });
    k.plane(pass, 2.6, 0.65, S.x1 + 0.02, 1.7, (S.z0 + S.z1) / 2, Math.PI / 2);
    addCol(S.x0, S.x1, S.z0, S.z1, gs - 0.3, S.ridge);

    // the long, low dark-timber building beyond it, with a covered porch toward the slope and a trail map board
    const L = { x0: 13.0, x1: 23.5, z0: -38.5, z1: -26.0, h: 3.0 };
    const gl = Math.min(ground(L.x0, L.z0), ground(L.x1, L.z0), ground(L.x0, L.z1), ground(L.x1, L.z1), ground((L.x0 + L.x1) / 2, (L.z0 + L.z1) / 2));
    k.box(M.darkSiding, L.x0, L.x1, gl - 0.3, L.h, L.z0, L.z1);
    k.box(M.roofMembrane, L.x0 - 0.35, L.x1 + 0.35, L.h, L.h + 0.14, L.z0 - 0.35, L.z1 + 0.35);
    k.box(M.redTrim, L.x0 - 0.37, L.x1 + 0.37, L.h - 0.05, L.h + 0.16, L.z1 + 0.33, L.z1 + 0.37);
    k.box(M.snow, L.x0 - 0.3, L.x1 + 0.3, L.h + 0.14, L.h + 0.5, L.z0 - 0.3, L.z1 + 0.3);
    for (const [x, z] of [[L.x0, L.z0], [L.x1, L.z0], [L.x0, L.z1], [L.x1, L.z1]]) k.box(M.redTrim, x - 0.08, x + 0.08, gl, L.h, z - 0.08, z + 0.08);
    const py = Math.max(gl, ground((L.x0 + L.x1) / 2, L.z1 + 0.9)) + 0.12, pz = L.z1 + 1.7;
    k.box(M.deck, L.x0, L.x1, py - 0.15, py, L.z1, pz);
    floor(L.x0, L.x1, L.z1, pz, py, 'East porch deck');
    for (let x = L.x0 + 0.15; x <= L.x1; x += (L.x1 - L.x0 - 0.3) / 5) { k.box(M.darkWood, x - 0.09, x + 0.09, py, 2.55, pz - 0.18, pz); addCol(x - 0.1, x + 0.1, pz - 0.2, pz, py, 2.6); }
    {
      const drop = 0.4, len = Math.hypot(pz + 0.4 - L.z1, drop), rx = Math.atan2(drop, pz + 0.4 - L.z1), zc = (L.z1 + pz + 0.4) / 2;
      k.obox(M.greenRoof, L.x1 - L.x0 + 0.5, 0.06, len, (L.x0 + L.x1) / 2, 2.78, zc, 0, rx);
      k.obox(M.snow, L.x1 - L.x0 + 0.45, 0.22, len, (L.x0 + L.x1) / 2, 2.92, zc, 0, rx);
    }
    for (const a of [14.2, 17.0, 21.6]) { k.box(M.darkGlass, a, a + 1.2, 1.0, 2.1, L.z1, L.z1 + 0.04); k.box(M.redTrim, a - 0.07, a + 1.27, 0.93, 2.17, L.z1, L.z1 + 0.03); }
    for (const a of [15.9, 19.6]) { k.box(M.trim, a, a + 0.9, py, 2.15, L.z1, L.z1 + 0.06); k.box(M.redTrim, a - 0.07, a + 0.97, 2.15, 2.23, L.z1, L.z1 + 0.08); }
    const beacon = new THREE.MeshStandardNodeMaterial({ color: 0x5a2a05, emissive: 0xff8a1a, emissiveIntensity: 1.2 });
    k.cyl(beacon, 0.14, 0.14, 20.0, L.h + 0.45, L.h + 0.8, -33.0, 10);
    addCol(L.x0, L.x1, L.z0, L.z1, gl - 0.3, L.h + 0.5);
    // Photo-matched kiosk between the two east buildings, facing the snowy apron.
    const { x: mx, z: mz } = BASE_TRAIL_MAP, mg = ground(mx, mz);
    g.add(buildTrailMapBoard(mg));
    addCol(mx - .18, mx + .18, mz - 1.28, mz + 1.28, mg - .3, mg + 3.1);
  }

  // ---------- west deck off the dining room, its stair now running west down the slope past the annex
  const DW = DECK_W;
  k.box(M.deck, DW.x0, DW.x1, DW.y - 0.1, DW.y, DW.z0, DW.z1);
  floor(DW.x0, DW.x1, DW.z0, DW.z1, DW.y, 'West deck');
  for (let x = DW.x0 + 0.2; x <= DW.x1; x += 2.4) for (const z of [DW.z0 + 1.5, DW.z1 - 0.2]) { const gy = ground(x, z); k.box(M.deckRail, x - 0.1, x + 0.1, gy - 0.3, DW.y - 0.1, z - 0.1, z + 0.1); }
  const wRail = (x0: number, x1: number, z0: number, z1: number) => {
    for (let x = x0; x <= x1 + 1e-3; x += Math.max(0.5, (x1 - x0) / Math.ceil((x1 - x0) / 1.8 || 1))) for (let z = z0; z <= z1 + 1e-3; z += Math.max(0.5, (z1 - z0) / Math.ceil((z1 - z0) / 1.8 || 1))) k.box(M.deckRail, x - 0.06, x + 0.06, DW.y, DW.y + 1.05, z - 0.06, z + 0.06);
    for (const h of [0.45, 0.98]) k.box(M.deckRail, x0 - 0.04, x1 + 0.04, DW.y + h - 0.05, DW.y + h + 0.05, z0 - 0.04, z1 + 0.04);
    addCol(x0 - 0.06, x1 + 0.06, z0 - 0.06, z1 + 0.06, DW.y, DW.y + 1.05);
  };
  wRail(DW.x0, DW.x0, DW.z0, DW.z1); wRail(DW.x0, DW.x1 - 1.6, DW.z1, DW.z1); wRail(DW.x1, DW.x1, DW.z0, DW.z1);
  const gW = ground(DW.x1 - 0.8, DW.z1 + 5.5);
  stairZ(DW.z1, DW.z1 + Math.max(0.6, (DW.y - gW) / 0.18 * 0.28), DW.y, gW, DW.x1 - 1.5, DW.x1 - 0.1, M.deck, 'West deck stairs');
  for (const s of picnicTable(k, -1.5, DW.y, 11.0, 0)) poi('seat', s.x, DW.y + 0.45, s.z, s.h, null, 'deck');
  for (const s of picnicTable(k, 2.2, DW.y, 11.0, 0)) poi('seat', s.x, DW.y + 0.45, s.z, s.h, null, 'deck');
  addCol(-2.5, -0.5, 10.1, 11.9, DW.y, DW.y + 0.8); addCol(1.2, 3.2, 10.1, 11.9, DW.y, DW.y + 0.8);
  poi('door', 1.15, DW.y, HZ + 1.2, Math.PI, null, 'west-door'); poi('door', 1.15, 0, HZ - 1.2, 0, UPPER, 'west-door-in');

  // ---------- registration: interiors and terrain cut-outs
  const vol = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, name: string) => {
    const c = W((x0 + x1) / 2, (z0 + z1) / 2);
    walkable.surfaces.addVolume({ cx: c.x, cz: c.z, yaw: LODGE.yaw, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, y0: F + y0, y1: F + y1, name });
  };
  vol(-HX, HX, -HZ, HZ, 0, UP_CEIL, UPPER); vol(-HX, LOW_END, -HZ, HZ, LOW, -0.35, LOWER); vol(E.x0, SR.x1, E.z0, -HZ, 0, 3.0, SUN);
  const cut = (x0: number, x1: number, z0: number, z1: number, y: number) => {
    const c = W((x0 + x1) / 2, (z0 + z1) / 2);
    walkable.cutouts.push({ cx: c.x, cz: c.z, yaw: LODGE.yaw, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, y: F + y });
  };
  // main block; the deck, sunroom and east deck together (every part of this rectangle is floored); the east
  // section; the annex
  cut(-HX + 0.05, HX - 0.05, -HZ + 0.05, HZ - 0.05, 0.02); cut(SR.x0, DECK_EDGE, DECK_EAST, CANOPY.z0, DECK_Y + 0.22);
  cut(E.x0 + 0.05, E.x1, E.z0 + 0.05, -HZ, 0.02); cut(A.x0, A.x1 - 0.05, A.z0, A.z1 - 0.05, 0.02);

  k.build(g);
  g.userData.lodge = { F, frame };
  return g;
}
