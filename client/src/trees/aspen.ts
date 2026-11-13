// Quaking aspen (Populus tremuloides) in winter: smooth cream bark with black branch-scar "eyes",
// dark rough bark and elk scarring near the ground, a narrow ascending crown of grey-brown twigs.
// Lidar local-maximum detection resolves one canopy per 5 to 7 m window, while mature clonal aspen
// stands carry stems every 2 to 3 m, so each detected crown is drawn as one of several clump layouts
// (a lone trunk, a pair, a parent ringed by saplings) inside its measured crown radius (DECISIONS.md D17). Geometry is built in meters and then normalized to
// height 1 and crown radius 1 for lidar instancing, like the other species.
import { ASPEN_CLUMPS } from '../../../shared/treeData';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function rand(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

const H = 14, R = 2.1;

/** Texture atlas: twig sprigs fill the whole texture; bark is a separate repeating texture. */
const TWIG_ROWS = 2;

/** Polyline tube with per-point radius. u spans the circumference, v runs along the tube in meters / vScale. */
function tube(points: THREE.Vector3[], radii: number[], sides: number, vScale: number, color: (p: THREE.Vector3, along: number) => THREE.Color) {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  let along = 0;
  const frameN = new THREE.Vector3(), frameB = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) along += p.distanceTo(points[i - 1]);
    t.copy(points[Math.min(points.length - 1, i + 1)]).sub(points[Math.max(0, i - 1)]).normalize();
    const ref = Math.abs(t.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    frameN.crossVectors(t, ref).normalize(); frameB.crossVectors(t, frameN).normalize();
    const c = color(p, along);
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const n = frameN.clone().multiplyScalar(Math.cos(a)).addScaledVector(frameB, Math.sin(a));
      pos.push(p.x + n.x * radii[i], p.y + n.y * radii[i], p.z + n.z * radii[i]);
      nor.push(n.x, n.y, n.z);
      uv.push(k / sides, along / vScale);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < points.length - 1; i++) for (let k = 0; k < sides; k++) {
    const a = i * (sides + 1) + k, b = a + sides + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g.toNonIndexed();
}

/** A pair of crossed twig cards from `a` along `dir`. Normals lean outward and upward for soft crown light. */
function twigCards(a: THREE.Vector3, dir: THREE.Vector3, len: number, width: number, roll: number, row: number, tint: number, center: THREE.Vector3, crossed = true) {
  const cards: THREE.BufferGeometry[] = [];
  for (const extra of crossed ? [0, Math.PI / 2] : [0]) {
    const card = new THREE.PlaneGeometry(len, width, 1, 1);
    card.translate(len / 2, 0, 0);
    card.rotateX(roll + extra);
    card.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize()));
    card.translate(a.x, a.y, a.z);
    const uvA = card.getAttribute('uv');
    for (let i = 0; i < uvA.count; i++) uvA.setY(i, (row + uvA.getY(i)) / TWIG_ROWS);
    const g = card.toNonIndexed();
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3(p.getX(i) - center.x, (p.getY(i) - center.y) * 0.6 + 1.2, p.getZ(i) - center.z).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
      col[i * 3] = tint; col[i * 3 + 1] = tint * 0.98; col[i * 3 + 2] = tint * 0.97;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    cards.push(g);
  }
  return cards;
}

/**
 * One stem with its crown, in meters. Returns [bark parts, crown parts].
 * Mature Colorado aspen: clear trunk to 40 to 62 percent of height, short ascending branches, narrow
 * rounded crown. Trunks sweep out of the snowpack at the base and wander on the way up; some carry a
 * second leader. Bark vertex colour carries the dark base, browse scars and grey-green cast; the bark
 * texture supplies lenticels and branch-scar eyes.
 */
function stem(ox: number, oz: number, height: number, girth: number, seed: number, detail: 'high' | 'low') {
  const r = rand(seed);
  const bark: THREE.BufferGeometry[] = [], crown: THREE.BufferGeometry[] = [];
  const high = detail === 'high';
  const baseRadius = 0.15 * girth * (height / H) ** 0.6;
  const sway = r() * Math.PI * 2, crook = (r() - .3) * .34 * (height / H), sweep = r() * .38 * (height / H) ** .5, wander = 3.2 + r() * 3;
  const trunkPts: THREE.Vector3[] = [], trunkR: number[] = [];
  const nSeg = high ? 14 : 5;
  const axis = (t: number) => {
    // snow creep bends the butt of the trunk; above it the stem wanders toward gaps in the canopy
    const butt = sweep * (1 - Math.exp(-t * 6)), bend = crook * Math.sin(t * wander) * t + .2 * t * t * (height / H);
    return new THREE.Vector3(
      ox + Math.cos(sway) * (butt + bend) + Math.sin(t * 5.1 + sway) * 0.05 * t, t * height,
      oz + Math.sin(sway) * (butt + bend) + Math.cos(t * 4.3 + sway) * 0.05 * t);
  };
  for (let i = 0; i <= nSeg; i++) {
    const t = (i / nSeg) ** 1.25; // more rings near the curved, flared base
    trunkPts.push(axis(t));
    trunkR.push(baseRadius * (1 + 0.35 * Math.exp(-t * 28)) * Math.max(0.05, 1 - t * 0.93));
  }
  const radiusAt = (t: number) => baseRadius * Math.max(0.05, 1 - t * 0.93);
  const scarTop = 0.9 + r() * 1.3; // elk browse scars reach about 2 m
  const tone = .93 + r() * .1, green = r() * .05;
  bark.push(tube(trunkPts, trunkR, high ? 8 : 5, 2.6, (p, along) => {
    const base = THREE.MathUtils.smoothstep(p.y, 0.15, scarTop);
    const scar = 0.5 + 0.5 * Math.sin(along * 3.1 + seed);
    const k = THREE.MathUtils.lerp(0.28 + 0.12 * scar, 1, base) * tone;
    const g = 0.92 + 0.08 * Math.sin(along * 1.7 + seed * 0.3);
    return new THREE.Color(0.86 * k * g, (0.88 + green) * k * g, 0.8 * k * g);
  }));

  const crownBase = height * (0.4 + r() * 0.22);
  const crownH = height - crownBase;
  const center = new THREE.Vector3(ox, crownBase + crownH * 0.55, oz);
  const branchCol = new THREE.Color(0.5, 0.49, 0.44);
  const limb = (base: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number, i: number, shoots: number) => {
    const mid = base.clone().addScaledVector(dir, len * 0.5); mid.y += len * 0.08;
    const tip = base.clone().addScaledVector(dir, len); tip.y += len * 0.2;
    bark.push(tube([base, mid, tip], [r0, r0 * 0.6, r0 * 0.18], high ? 4 : 3, 1.6, () => branchCol));
    const ang = Math.atan2(dir.z, dir.x);
    for (let k = 0; k < shoots; k++) {
      const s = 0.3 + k * 0.6 / shoots + r() * 0.1;
      const p = base.clone().lerp(tip, s);
      const a2 = ang + (r() - 0.5) * 2.1;
      const d2 = new THREE.Vector3(Math.cos(a2), dir.y * 0.8 + r() * 0.5, Math.sin(a2)).normalize();
      const l2 = len * (0.35 + r() * 0.35);
      const e = p.clone().addScaledVector(d2, l2);
      crown.push(tube([p, e], [r0 * 0.35, r0 * 0.08], 3, 1.6, () => branchCol));
      // a real winter crown stays see-through: one sprig plane per side shoot, none on every third
      if ((k + i) % 3 !== 2) crown.push(...twigCards(p.clone().lerp(e, 0.3), d2, l2 * 1.1 + 0.3, 0.5 + r() * 0.3, r() * Math.PI, (k + i) % TWIG_ROWS, 0.9 + r() * 0.2, center, false));
    }
    crown.push(...twigCards(base.clone().lerp(tip, 0.45), dir, len * 0.8 + 0.45, 0.6 + r() * 0.4, r() * Math.PI, i % TWIG_ROWS, 0.9 + r() * 0.2, center, !high));
  };
  const nb = high ? Math.round(11 + 11 * height / H) : 6;
  const lopsided = r() * Math.PI * 2, bias = r() * .5; // crowns reach toward the open side of the grove
  for (let i = 0; i < nb; i++) {
    const t = (i + r() * 0.8) / nb;
    const y = crownBase + crownH * t * 0.94;
    const ang = i * 2.399 + r() * 0.6;
    // narrow rounded crown: longest branches in the lower-middle crown
    const profile = Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.95));
    const len = (0.9 + r() * 0.9) * (0.45 + profile * 1.15) * (0.65 + 0.35 * height / H) * (1 - bias * (.5 + .5 * Math.cos(ang - lopsided)));
    const up = 0.55 + t * 0.6 + r() * 0.3; // ascending, steeper near the top
    limb(axis(y / height), new THREE.Vector3(Math.cos(ang), up, Math.sin(ang)).normalize(), len, Math.max(0.012, radiusAt(y / height) * 0.42), i, high ? 3 : 0);
  }
  // a second leader leaves the trunk at a narrow fork on some of the larger stems
  if (girth > .7 && r() < .4) {
    const at = .5 + r() * .15, a = r() * Math.PI * 2;
    limb(axis(at), new THREE.Vector3(Math.cos(a) * .32, 1, Math.sin(a) * .32).normalize(), height * (.3 + r() * .1), radiusAt(at) * .62, 1, high ? 5 : 1);
  }
  // a broken stub or two below the crown, where shaded limbs died back
  if (high) for (let i = 0; i < 2; i++) {
    const t = (crownBase / height) * (.55 + r() * .4), a = r() * Math.PI * 2, base = axis(t);
    bark.push(tube([base, base.clone().add(new THREE.Vector3(Math.cos(a) * .3, .12, Math.sin(a) * .3))], [radiusAt(t) * .3, radiusAt(t) * .16], 3, 1.6, () => new THREE.Color(.3, .28, .25)));
  }
  // leader
  const top = axis(1);
  crown.push(...twigCards(axis(0.9), top.clone().sub(axis(0.9)).normalize(), height * 0.13, 0.5, r() * Math.PI, 0, 1, center));
  return { bark, crown };
}

/** Bare aspen clump for one layout. Group 0 is bark, group 1 is twig cards. Height 1, crown radius 1. */
export function aspenGeometry(detail: 'high' | 'low', variant = 0): THREE.BufferGeometry {
  const bark: THREE.BufferGeometry[] = [], crown: THREE.BufferGeometry[] = [];
  ASPEN_CLUMPS[variant % ASPEN_CLUMPS.length].forEach(([dx, dz, hf, gs], i) => {
    const s = stem(dx * R, dz * R, H * hf, gs, 29 + i * 101 + variant * 1009, detail);
    bark.push(...s.bark); crown.push(...s.crown);
  });
  const b = mergeGeometries(bark), c = mergeGeometries(crown);
  const result = mergeGeometries([b, c], true);
  result.computeBoundingBox();
  const minY = result.boundingBox!.min.y, span = result.boundingBox!.max.y - minY;
  // Normalize positions by hand and give normals the inverse-transpose once, so instance scaling by
  // (radius, height, radius) restores the modeled direction.
  const p = result.getAttribute('position'), n = result.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) / R, (p.getY(i) - minY) / span, p.getZ(i) / R);
    const nx = n.getX(i) * R, ny = n.getY(i) * span, nz = n.getZ(i) * R, l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(i, nx / l, ny / l, nz / l);
  }
  result.userData.aspect = span / R;
  result.computeBoundingBox(); result.computeBoundingSphere();
  for (const g of [...bark, ...crown, b, c]) g.dispose();
  return result;
}

/** Recursive winter twig sprig, drawn from (x, y) toward `angle`. Limbs are pale like the bark; the
 * finest twigs are darker and warmer, which gives a bare crown its soft grey-rose cast. */
function sprig(g: CanvasRenderingContext2D, r: () => number, x: number, y: number, angle: number, len: number, width: number, depth: number) {
  const steps = 6;
  let px = x, py = y, a = angle;
  const pts: [number, number][] = [[px, py]];
  for (let i = 0; i < steps; i++) {
    a += (r() - 0.5) * 0.3;
    px += Math.cos(a) * len / steps; py += Math.sin(a) * len / steps;
    pts.push([px, py]);
  }
  const fine = THREE.MathUtils.clamp(1 - (width - 1) / 4, 0, 1), shade = 118 - fine * 34 + r() * 22;
  g.strokeStyle = `rgb(${shade + 6 + fine * 10 | 0},${shade - fine * 4 | 0},${shade - 8 - fine * 8 | 0})`;
  for (let i = 0; i < steps; i++) {
    g.lineWidth = Math.max(0.75, width * (1 - 0.55 * i / steps));
    g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i + 1][0], pts[i + 1][1]); g.stroke();
  }
  if (depth <= 0 || len < 9) return;
  const children = 3 + Math.floor(r() * 3);
  for (let c = 0; c < children; c++) {
    const at = 0.18 + (c / children) * 0.74 + r() * 0.08;
    const [bx, by] = pts[Math.min(steps - 1, Math.floor(at * steps))];
    const side = c % 2 === 0 ? 1 : -1;
    sprig(g, r, bx, by, a + side * (0.3 + r() * 0.45), len * (0.36 + r() * 0.3) * (1.15 - at * .5), Math.max(0.75, width * 0.55), depth - 1);
  }
}

/** Twig card canvas: TWIG_ROWS sprig variants stacked vertically, base at the left edge. */
export function aspenTwigCanvas(): HTMLCanvasElement {
  const W = 1024, Hh = 512 * TWIG_ROWS;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
  const g = cv.getContext('2d')!;
  g.lineCap = 'round'; g.lineJoin = 'round';
  const r = rand(113);
  for (let row = 0; row < TWIG_ROWS; row++) {
    const cy = Hh - (row + 0.5) * 512; // canvas rows are flipped relative to texture v
    sprig(g, r, 4, cy, (r() - 0.5) * 0.12, W * 0.92, 6.5, 4);
    // extra spurs fill the card without making a solid fan
    for (let k = 0; k < 6; k++) {
      const x = 90 + k * 140 + r() * 50;
      sprig(g, r, x, cy + (r() - 0.5) * 40, (k % 2 ? 1 : -1) * (0.45 + r() * 0.5), 120 + r() * 130, 2.4, 2);
    }
  }
  return cv;
}

export function canvasTexture(cv: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Repeating smooth aspen bark: chalky cream with horizontal lenticels and dark branch-scar eyes. */
export function aspenBarkCanvas(): HTMLCanvasElement {
  const W = 256, Hh = 512;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
  const g = cv.getContext('2d')!;
  const r = rand(71);
  g.fillStyle = '#e4e3d2'; g.fillRect(0, 0, W, Hh);
  // powdery patches and faint greenish cast
  for (let i = 0; i < 260; i++) {
    const x = r() * W, y = r() * Hh, w = 10 + r() * 50, h = 6 + r() * 30;
    g.fillStyle = r() < 0.5 ? `rgba(200,206,182,${0.12 + r() * 0.2})` : `rgba(246,244,232,${0.15 + r() * 0.2})`;
    g.beginPath(); g.ellipse(x, y, w, h, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(x - W, y, w, h, 0, 0, Math.PI * 2); g.fill();
  }
  // lenticels: short dark horizontal dashes
  for (let i = 0; i < 380; i++) {
    const x = r() * W, y = r() * Hh, w = 3 + r() * 11;
    g.fillStyle = `rgba(70,66,58,${0.35 + r() * 0.4})`;
    g.fillRect(x, y, w, 1 + r() * 1.6);
    if (x + w > W) g.fillRect(x - W, y, w, 1.5);
  }
  // branch-scar eyes: small, irregular dark chevrons, a few per repeat
  for (let i = 0; i < 4; i++) {
    const x = 20 + r() * (W - 40), y = 30 + r() * (Hh - 60), w = 5 + r() * 9, h = 1.5 + r() * 3, tilt = (r() - 0.5) * 0.4;
    g.save(); g.translate(x, y); g.rotate(tilt);
    g.fillStyle = `rgba(30,27,24,${0.6 + r() * 0.3})`;
    g.beginPath(); g.moveTo(-w, 0); g.quadraticCurveTo(0, -h * 1.8, w, 0); g.quadraticCurveTo(0, h * 0.6, -w, 0); g.fill();
    g.restore();
  }
  return cv;
}
