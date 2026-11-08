// Procedural tree geometry (near LOD) and impostor textures (far LOD). All generated in code.
// Geometry is built in a normalized space (height 1, crown radius 1) and scaled per instance by
// (crown radius, height, crown radius), so horizontal and vertical extents are designed separately.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// species: 0 spruce/fir, 1 Douglas-fir, 2 aspen (bare), 3 Gambel oak (bare shrub)

function rand(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function colorize(g: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3, i: number) => THREE.Color) {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nor, i);
    const c = fn(p, n, i);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Branch sprite: a drooping twig covered in needles with snow on top. Transparent background. */
export function branchTexture(): THREE.CanvasTexture {
  const W = 256, H = 128;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const r = rand(3);
  const ys = (x: number) => H * 0.42 + (x / W) ** 1.6 * H * 0.22; // droop
  for (let i = 0; i < 1400; i++) {
    const x = r() * W * 0.98;
    const spread = (1 - (x / W) * 0.55) * H * 0.3;
    const y = ys(x) + (r() - 0.5) * spread * 2 * Math.sqrt(r());
    const len = 6 + r() * 10, a = (r() - 0.5) * 1.6 + 0.6;
    const shade = 20 + r() * 28;
    g.strokeStyle = `rgb(${shade * 0.75 | 0},${shade * 1.25 + 14 | 0},${shade * 0.95 + 6 | 0})`;
    g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
  }
  g.strokeStyle = '#3a2a1e'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(0, ys(0)); for (let x = 0; x <= W; x += 16) g.lineTo(x, ys(x)); g.stroke();
  for (let i = 0; i < 70; i++) {
    const x = r() * W * 0.9;
    const top = ys(x) - (1 - (x / W) * 0.55) * H * 0.22;
    const rad = 4 + r() * 9;
    g.fillStyle = `rgba(${235 + r() * 15 | 0},${240 + r() * 12 | 0},250,${0.75 + r() * 0.25})`;
    g.beginPath(); g.ellipse(x, top + r() * 10, rad * 1.5, rad * 0.7, 0, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Card conifer: trunk + whorls of crossed branch cards along a narrow cone. Uses branchTexture(). */
export function coniferGeometry(kind: 0 | 1, detail: 'high' | 'low'): THREE.BufferGeometry {
  const r = rand(kind === 0 ? 7 : 13);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.03, 0.07, 1.0, 6, 1, true);
  trunk.translate(0, 0.5, 0);
  const tuv = trunk.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, 0.02, 0.58); // sample the twig colour
  parts.push(colorize(trunk.toNonIndexed(), () => new THREE.Color(0.8, 0.75, 0.7)));
  const whorls = detail === 'high' ? (kind === 0 ? 13 : 10) : 4;
  const perWhorl = detail === 'high' ? 6 : 4;
  for (let w = 0; w < whorls; w++) {
    const t = w / whorls;
    const y = 0.1 + t * 0.86;
    const profile = kind === 0 ? Math.pow(1 - t, 0.85) : Math.pow(1 - t, 0.7) * (t < 0.12 ? 0.85 : 1);
    const reach = Math.max(0.12, profile * (0.95 + r() * 0.1));
    for (let b = 0; b < perWhorl; b++) {
      const ang = (b / perWhorl) * Math.PI * 2 + r() * 0.8 + w * 1.3;
      const len = reach * (0.85 + r() * 0.3);
      const thick = 0.07 + 0.08 * profile;
      for (const vert of [false, true]) {
        const q = new THREE.PlaneGeometry(len, vert ? thick : thick * 2.2);
        q.translate(len / 2, 0, 0);
        if (!vert) q.rotateX(-Math.PI / 2 + 0.35);
        q.rotateZ(-0.25 - r() * 0.2);
        q.rotateY(ang);
        q.translate(0, y, 0);
        const c = 0.8 + r() * 0.35;
        parts.push(colorize(q.toNonIndexed(), (p) => {
          const radial = Math.hypot(p.x, p.z) / Math.max(0.05, reach);
          const k = c * (0.65 + 0.35 * Math.min(1, radial));
          return new THREE.Color(k, k, k);
        }));
      }
    }
  }
  const top = new THREE.PlaneGeometry(0.06, 0.12); top.translate(0, 0.98, 0);
  parts.push(colorize(top.toNonIndexed(), () => new THREE.Color(0.9, 0.9, 0.9)));
  const g = mergeGeometries(parts);
  // bend normals outward/up so the crown shades like a volume rather than flat cards
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    const n = new THREE.Vector3(pos.getX(i), 0.6 + (pos.getY(i) - 0.5) * 0.4, pos.getZ(i)).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  g.computeBoundingSphere();
  return g;
}

/** Bare aspen: pale trunk with dark marks and spreading branches with fine twigs. Height 1, radius ~1. */
export function aspenGeometry(detail: 'high' | 'low'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = rand(29);
  const seg = (a: THREE.Vector3, b: THREE.Vector3, rad0: number, rad1: number, col: THREE.Color, sides = 4) => {
    const d = b.clone().sub(a); const L = d.length();
    const c = new THREE.CylinderGeometry(rad1, rad0, L, sides, 1, true);
    c.translate(0, L / 2, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    c.translate(a.x, a.y, a.z);
    parts.push(colorize(c.toNonIndexed(), () => col));
  };
  const trunk = new THREE.CylinderGeometry(0.035, 0.07, 1.0, detail === 'high' ? 8 : 5, 6, true);
  trunk.translate(0, 0.5, 0);
  parts.push(colorize(trunk.toNonIndexed(), (p) => {
    const mark = Math.sin(p.y * 70 + Math.sin(p.x * 50) * 3) > 0.9 ? 0.35 : 1;
    const base = p.y < 0.07 ? 0.55 : 1;
    return new THREE.Color(0.66, 0.66, 0.6).multiplyScalar(mark * base);
  }));
  const nb = detail === 'high' ? 16 : 6;
  const branchCol = new THREE.Color(0.36, 0.33, 0.3), twigCol = new THREE.Color(0.27, 0.25, 0.23);
  for (let i = 0; i < nb; i++) {
    const y0 = 0.42 + r() * 0.5;
    const ang = r() * Math.PI * 2;
    const reach = (0.55 + r() * 0.45) * (1 - (y0 - 0.42) * 0.6);
    const rise = 0.06 + r() * 0.12;
    const a = new THREE.Vector3(0, y0, 0);
    const b = new THREE.Vector3(Math.cos(ang) * reach, y0 + rise, Math.sin(ang) * reach);
    seg(a, b, 0.016, 0.006, branchCol);
    if (detail === 'high') {
      for (let k = 0; k < 4; k++) {
        const t = 0.35 + r() * 0.6;
        const p = a.clone().lerp(b, t);
        const a2 = ang + (r() - 0.5) * 1.6;
        const l2 = 0.15 + r() * 0.25;
        seg(p, new THREE.Vector3(p.x + Math.cos(a2) * l2, p.y + 0.03 + r() * 0.05, p.z + Math.sin(a2) * l2), 0.006, 0.002, twigCol, 3);
      }
    }
  }
  return mergeGeometries(parts);
}

/** Gambel oak clump: crooked grey-brown stems with a dense twiggy dome (bare, a few dead leaves). */
export function oakGeometry(detail: 'high' | 'low'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = rand(41);
  const stems = detail === 'high' ? 6 : 3;
  for (let i = 0; i < stems; i++) {
    const h = 0.6 + r() * 0.35;
    const s = new THREE.CylinderGeometry(0.02, 0.035, h, 4);
    s.translate(0, h / 2, 0);
    s.rotateZ((r() - 0.5) * 0.5); s.rotateX((r() - 0.5) * 0.5);
    s.translate((r() - 0.5) * 0.4, 0, (r() - 0.5) * 0.4);
    parts.push(colorize(s.toNonIndexed(), () => new THREE.Color(0x5b4e44)));
  }
  const dome = new THREE.IcosahedronGeometry(0.8, detail === 'high' ? 1 : 0);
  dome.scale(1, 0.55, 1); dome.translate(0, 0.62, 0);
  parts.push(colorize(dome.toNonIndexed(), (p, n) => {
    const snowy = Math.max(0, n.y - 0.5) * 1.2;
    return new THREE.Color(0x6e5440).lerp(new THREE.Color(0xdfe5ec), Math.min(0.6, snowy));
  }));
  return mergeGeometries(parts);
}

/** Impostor texture atlas (4 species side by side, 256x256 each) drawn on a canvas. */
export function impostorAtlas(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S * 4; cv.height = S;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, cv.width, cv.height);
  const r = rand(5);
  const conifer = (ox: number, width: number, exp: number) => {
    g.fillStyle = '#3b2a20';
    g.fillRect(ox + S / 2 - 3, S * 0.84, 6, S * 0.16);
    for (let i = 0; i < 2600; i++) {
      const t = r();
      const y = S * (0.95 - t * 0.92);
      const w = width * Math.pow(1 - t, exp) + 3;
      const x = ox + S / 2 + (r() * 2 - 1) * w * Math.sqrt(r());
      const shade = 18 + r() * 30;
      g.strokeStyle = `rgb(${shade * 0.75 | 0},${shade * 1.25 + 12 | 0},${shade * 0.95 + 6 | 0})`;
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (x > ox + S / 2 ? 5 : -5), y + 4); g.stroke();
    }
    for (let i = 0; i < 160; i++) {
      const t = r();
      const y = S * (0.92 - t * 0.88);
      const w = width * Math.pow(1 - t, exp);
      const x = ox + S / 2 + (r() * 2 - 1) * w * 0.85;
      g.fillStyle = `rgba(236,241,248,${0.6 + r() * 0.4})`;
      g.beginPath(); g.ellipse(x, y, 4 + r() * 5, 2 + r() * 2, 0, 0, Math.PI * 2); g.fill();
    }
  };
  conifer(0, S * 0.3, 0.85);
  conifer(S, S * 0.38, 0.7);
  {
    const ox = S * 2;
    g.strokeStyle = '#d9d6cc'; g.lineWidth = 8;
    g.beginPath(); g.moveTo(ox + S / 2, S); g.lineTo(ox + S / 2, S * 0.12); g.stroke();
    for (let i = 0; i < 220; i++) {
      const y = S * (0.12 + r() * 0.5);
      const a = (r() - 0.5) * 2.4;
      const len = 25 + r() * 60;
      g.strokeStyle = `rgba(${95 + r() * 30 | 0},${88 + r() * 25 | 0},${80 + r() * 20 | 0},0.9)`;
      g.lineWidth = 1 + r() * 1.5;
      g.beginPath(); g.moveTo(ox + S / 2, y + 30); g.lineTo(ox + S / 2 + Math.sin(a) * len, y + 30 - Math.cos(a) * len * 0.6); g.stroke();
    }
  }
  {
    const ox = S * 3;
    for (let i = 0; i < 300; i++) {
      const a = r() * Math.PI, rr = r();
      const x = ox + S / 2 + Math.cos(a) * rr * S * 0.42, y = S * 0.95 - Math.sin(a) * rr * S * 0.55;
      g.fillStyle = r() < 0.7 ? 'rgba(98,76,58,0.9)' : 'rgba(150,110,70,0.9)';
      g.fillRect(x, y, 4 + r() * 6, 3 + r() * 5);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

/** Two crossed quads, unit height, base at y=0, half-width 1. */
export function crossQuadGeometry(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(2, 1); a.translate(0, 0.5, 0);
  const b = a.clone(); b.rotateY(Math.PI / 2);
  return mergeGeometries([a, b]);
}
