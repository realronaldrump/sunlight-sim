// Quaking aspen (Populus tremuloides) in winter: smooth cream bark with black branch-scar "eyes",
// dark rough bark and elk scarring near the ground, a narrow ascending crown of grey-brown twigs.
// Lidar local-maximum detection resolves one canopy per 5 to 7 m window, while mature clonal aspen
// stands carry stems every 2 to 3 m, so each detected crown also carries two smaller ramets inside
// its measured crown radius (DECISIONS.md D17). Geometry is built in meters and then normalized to
// height 1 and crown radius 1 for lidar instancing, like the other species.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function rand(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

const H = 14, R = 2.1;

/** Stems per instance in normalized units: offset x, offset z (crown radius 1), height fraction, girth scale. */
export const ASPEN_STEMS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 1, 1],
  [0.78 * Math.cos(0.7), 0.78 * Math.sin(0.7), 0.78, 0.72],
  [0.86 * Math.cos(3.6), 0.86 * Math.sin(3.6), 0.63, 0.58],
];

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
 * Mature Colorado aspen: clear trunk to 45 to 60 percent of height, short ascending branches, narrow
 * rounded crown. Bark vertex colour carries the dark base, browse scars and grey-green cast; the bark
 * texture supplies lenticels and branch-scar eyes.
 */
function stem(ox: number, oz: number, height: number, girth: number, seed: number, detail: 'high' | 'low') {
  const r = rand(seed);
  const bark: THREE.BufferGeometry[] = [], crown: THREE.BufferGeometry[] = [];
  const baseRadius = 0.15 * girth * (height / H) ** 0.6;
  const sway = r() * Math.PI * 2;
  const trunkPts: THREE.Vector3[] = [], trunkR: number[] = [];
  const nSeg = detail === 'high' ? 22 : 7;
  const axis = (t: number) => new THREE.Vector3(
    ox + Math.sin(t * 5.1 + sway) * 0.05 * t + Math.cos(sway) * 0.18 * t * t,
    t * height,
    oz + Math.cos(t * 4.3 + sway) * 0.05 * t + Math.sin(sway) * 0.18 * t * t,
  );
  for (let i = 0; i <= nSeg; i++) {
    const t = i / nSeg;
    trunkPts.push(axis(t));
    const flare = 1 + 0.35 * Math.exp(-t * 28);
    trunkR.push(baseRadius * flare * Math.max(0.05, 1 - t * 0.93));
  }
  const scarTop = 1.1 + r() * 1.0; // elk browse scars reach about 2 m
  bark.push(tube(trunkPts, trunkR, detail === 'high' ? 10 : 6, 2.6, (p, along) => {
    const y = p.y;
    // weathered black base and browse scarring, fading into smooth cream bark
    const base = THREE.MathUtils.smoothstep(y, 0.15, scarTop);
    const scar = 0.5 + 0.5 * Math.sin(along * 3.1 + seed);
    const k = THREE.MathUtils.lerp(0.28 + 0.12 * scar, 1, base);
    const g = 0.92 + 0.08 * Math.sin(along * 1.7 + seed * 0.3);
    return new THREE.Color(0.86 * k * g, 0.88 * k * g, 0.8 * k * g);
  }));

  const crownBase = height * (0.46 + r() * 0.1);
  const crownH = height - crownBase;
  const center = new THREE.Vector3(ox, crownBase + crownH * 0.55, oz);
  const branchCol = new THREE.Color(0.46, 0.45, 0.41);
  const nb = detail === 'high' ? Math.round(18 + 14 * height / H) : 7;
  for (let i = 0; i < nb; i++) {
    const t = (i + r() * 0.8) / nb;
    const y = crownBase + crownH * t * 0.94;
    const base = axis(y / height);
    const ang = i * 2.399 + r() * 0.6;
    // narrow rounded crown: longest branches in the lower-middle crown
    const profile = Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.95));
    const len = (0.9 + r() * 0.8) * (0.45 + profile * 1.15) * (0.65 + 0.35 * height / H);
    const up = 0.55 + t * 0.6 + r() * 0.3; // ascending, steeper near the top
    const dir = new THREE.Vector3(Math.cos(ang), up, Math.sin(ang)).normalize();
    const mid = base.clone().addScaledVector(dir, len * 0.5); mid.y += len * 0.08;
    const tip = base.clone().addScaledVector(dir, len); tip.y += len * 0.2;
    const r0 = Math.max(0.012, trunkR[Math.min(nSeg, Math.round(y / height * nSeg))] * 0.42);
    bark.push(tube([base, mid, tip], [r0, r0 * 0.6, r0 * 0.18], detail === 'high' ? 5 : 3, 1.6, () => branchCol));
    if (detail === 'high') {
      for (let k = 0; k < 3; k++) {
        const s = 0.35 + k * 0.22 + r() * 0.1;
        const p = base.clone().lerp(tip, s);
        const a2 = ang + (r() - 0.5) * 1.9;
        const d2 = new THREE.Vector3(Math.cos(a2), up * 0.8 + r() * 0.5, Math.sin(a2)).normalize();
        const l2 = len * (0.35 + r() * 0.3);
        const e = p.clone().addScaledVector(d2, l2);
        crown.push(tube([p, e], [r0 * 0.35, r0 * 0.08], 3, 1.6, () => branchCol));
        // a real winter crown stays see-through: one sprig plane per side shoot, none on every third
        if ((k + i) % 3 !== 2) crown.push(...twigCards(p.clone().lerp(e, 0.3), d2, l2 * 1.1 + 0.3, 0.5 + r() * 0.25, r() * Math.PI, (k + i) % TWIG_ROWS, 0.9 + r() * 0.2, center, false));
      }
    }
    crown.push(...twigCards(base.clone().lerp(tip, 0.45), dir, len * 0.8 + 0.45, 0.6 + r() * 0.35, r() * Math.PI, i % TWIG_ROWS, 0.9 + r() * 0.2, center, detail === 'low'));
  }
  // leader
  const top = axis(1);
  crown.push(...twigCards(axis(0.9), top.clone().sub(axis(0.9)).normalize(), height * 0.13, 0.5, r() * Math.PI, 0, 1, center));
  return { bark, crown };
}

/** Bare aspen clump (main stem plus two ramets). Group 0 is bark, group 1 is twig cards. Height 1, crown radius 1. */
export function aspenGeometry(detail: 'high' | 'low'): THREE.BufferGeometry {
  const bark: THREE.BufferGeometry[] = [], crown: THREE.BufferGeometry[] = [];
  ASPEN_STEMS.forEach(([dx, dz, hf, gs], i) => {
    const s = stem(dx * R, dz * R, H * hf, gs, 29 + i * 101, detail);
    bark.push(...s.bark); crown.push(...s.crown);
  });
  const b = mergeGeometries(bark), c = mergeGeometries(crown);
  const result = mergeGeometries([b, c], true);
  result.scale(1 / R, 1 / H, 1 / R);
  result.computeBoundingBox();
  const minY = result.boundingBox!.min.y;
  result.translate(0, -minY, 0);
  result.computeBoundingBox();
  result.scale(1, 1 / result.boundingBox!.max.y, 1);
  // Non-uniform scaling bends normals; restore unit length after normalization.
  const n = result.getAttribute('normal');
  for (let i = 0; i < n.count; i++) {
    const v = new THREE.Vector3(n.getX(i) / (1 / R), n.getY(i) / (1 / H), n.getZ(i) / (1 / R)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  result.computeBoundingSphere();
  for (const g of [...bark, ...crown, b, c]) g.dispose();
  return result;
}

/** Recursive winter twig sprig, drawn from (x, y) toward `angle`. */
function sprig(g: CanvasRenderingContext2D, r: () => number, x: number, y: number, angle: number, len: number, width: number, depth: number) {
  const steps = 5;
  let px = x, py = y, a = angle;
  const pts: [number, number][] = [[px, py]];
  for (let i = 0; i < steps; i++) {
    a += (r() - 0.5) * 0.35;
    px += Math.cos(a) * len / steps; py += Math.sin(a) * len / steps;
    pts.push([px, py]);
  }
  const shade = 98 + r() * 34;
  g.strokeStyle = `rgb(${shade + 5 | 0},${shade | 0},${shade - 6 | 0})`;
  g.lineWidth = width;
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
  g.stroke();
  // terminal bud
  g.fillStyle = `rgb(${shade * 0.7 | 0},${shade * 0.6 | 0},${shade * 0.5 | 0})`;
  g.beginPath(); g.ellipse(px, py, Math.max(1.2, width * 0.9), Math.max(1, width * 0.7), a, 0, Math.PI * 2); g.fill();
  if (depth <= 0 || len < 10) return;
  const children = 2 + Math.floor(r() * 3);
  for (let c = 0; c < children; c++) {
    const at = 0.25 + (c / children) * 0.65 + r() * 0.1;
    const i = Math.min(steps - 1, Math.floor(at * steps));
    const [bx, by] = pts[i];
    const side = c % 2 === 0 ? 1 : -1;
    sprig(g, r, bx, by, a + side * (0.35 + r() * 0.45), len * (0.42 + r() * 0.28), Math.max(0.9, width * 0.62), depth - 1);
  }
}

/** Twig card texture: TWIG_ROWS sprig variants stacked vertically, base at the left edge. */
export function aspenTwigTexture(): THREE.CanvasTexture {
  const W = 1024, Hh = 512 * TWIG_ROWS;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
  const g = cv.getContext('2d')!;
  g.lineCap = 'round'; g.lineJoin = 'round';
  const r = rand(113);
  for (let row = 0; row < TWIG_ROWS; row++) {
    const cy = Hh - (row + 0.5) * 512; // canvas rows are flipped relative to texture v
    sprig(g, r, 4, cy, (r() - 0.5) * 0.12, W * 0.92, 7, 3);
    // extra short spurs fill the card without making a solid fan
    for (let k = 0; k < 4; k++) {
      const x = 120 + k * 200 + r() * 60;
      sprig(g, r, x, cy + (r() - 0.5) * 40, (k % 2 ? 1 : -1) * (0.5 + r() * 0.5), 110 + r() * 130, 2.6, 1);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Repeating smooth aspen bark: chalky cream with horizontal lenticels and dark branch-scar eyes. */
export function aspenBarkTexture(): THREE.CanvasTexture {
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
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/**
 * Far-LOD aspen clump for the impostor atlas, drawn to match the 3D model: three pale stems, dark bases
 * and a translucent grey-brown twig crown. `ox` is the left edge of the S x S atlas cell.
 */
export function drawAspenImpostor(g: CanvasRenderingContext2D, ox: number, S: number) {
  const r = rand(5);
  // impostor quad half-width is 1.1 crown radii, so x = cell centre + offset / 1.1 * S / 2
  const stems = ASPEN_STEMS.map(([dx, dz, hf, gs]) => ({ x: ox + S / 2 + (dx * 0.8 + dz * 0.6) / 1.1 * S / 2, hf, gs }));
  g.lineCap = 'round';
  for (const s of stems) {
    const top = S * (1 - s.hf);
    const crownBase = S - s.hf * S * 0.5;
    // twig haze: many faint fine strokes give the purple-grey cast of winter aspen from afar
    for (let i = 0; i < 1000 * s.hf; i++) {
      const t = r();
      const y = crownBase - t * (crownBase - top);
      const prof = Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.9));
      const len = (8 + r() * 22) * S / 256 * (0.6 + prof);
      const a = -Math.PI / 2 + (r() - 0.5) * 2.2;
      const x = s.x + (r() - 0.5) * prof * S * 0.32 * s.hf;
      const shade = 112 + r() * 36;
      g.strokeStyle = `rgba(${shade + 4 | 0},${shade | 0},${shade - 6 | 0},${0.1 + r() * 0.14})`;
      g.lineWidth = (0.7 + r() * 0.9) * S / 256;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    }
    // stem: cream bark, darker scarred base
    const w = 5.5 * s.gs * S / 256;
    const grad = g.createLinearGradient(0, S, 0, top);
    grad.addColorStop(0, '#3e3a34'); grad.addColorStop(0.1, '#9d9a8c'); grad.addColorStop(0.16, '#d9d9c7'); grad.addColorStop(1, '#cfd0bf');
    g.strokeStyle = grad; g.lineWidth = w;
    g.beginPath(); g.moveTo(s.x, S); g.lineTo(s.x + (r() - 0.5) * 4, top + (S - top) * 0.1); g.stroke();
    // ascending main branches
    for (let i = 0; i < 9 * s.hf; i++) {
      const y = crownBase - r() * (crownBase - top) * 0.85;
      const side = i % 2 ? 1 : -1;
      g.strokeStyle = 'rgba(112,108,98,0.95)'; g.lineWidth = w * 0.35;
      g.beginPath(); g.moveTo(s.x, y); g.lineTo(s.x + side * (10 + r() * 22) * S / 256 * s.hf, y - (18 + r() * 26) * S / 256); g.stroke();
    }
  }
}
