// Procedural tree geometry (near LOD) and impostor textures (far LOD). All generated in code.
// Geometry is built in a normalized space (height 1, crown radius 1) and scaled per instance by
// (crown radius, height, crown radius), so horizontal and vertical extents are designed separately.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { drawAspenImpostor } from './aspen';
import { CONIFER_HEIGHT, CONIFER_RADIUS, coniferBoughs } from '../../../shared/treeData';

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

/** A coherent needle bough with discontinuous snow caps, not a white cone silhouette. */
export function branchTexture(): THREE.CanvasTexture {
  const W = 768, H = 384;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const random = rand(83);
  const spine = (x: number) => H * (0.45 + 0.10 * (x / W) ** 1.8);
  g.lineCap = 'round';
  // Secondary twigs leave real gaps between fans. Their needles attach to the twig, rather than
  // forming an evenly filled triangular blob, so grazing views also have a believable silhouette.
  for (let j = 0; j < 30; j++) {
    const x = 18 + j / 30 * W * 0.95;
    for (const side of [-1, 1]) {
      const span = (1 - x / W * 0.78) * H * (0.23 + random() * 0.12);
      const dx = 20 + random() * 42, dy = side * span;
      const y = spine(x);
      g.strokeStyle = '#34402d'; g.lineWidth = 3.3;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx, y + dy); g.stroke();
      for (let k = 0; k < 22; k++) {
        const t = k / 22, px = x + dx * t, py = y + dy * t;
        const needle = 9 + random() * 13;
        const shade = 21 + random() * 23;
        g.strokeStyle = `rgb(${shade * 0.72 | 0},${shade + 11 | 0},${shade * 0.78 + 5 | 0})`;
        g.lineWidth = 1.4 + random() * 1.3;
        for (const fan of [-1, 1]) {
          g.beginPath(); g.moveTo(px, py);
          g.lineTo(px + needle * (0.6 + random() * 0.5) * fan, py + side * needle * 0.65); g.stroke();
        }
      }
    }
  }
  g.strokeStyle = '#594635'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(0, spine(0));
  for (let x = 0; x <= W; x += 16) g.lineTo(x, spine(x));
  g.stroke();
  // Snow sits in little saddles on the upper side of individual boughs. Keep most needles green.
  for (let j = 0; j < 12; j++) {
    const x = 32 + j / 12 * W * 0.83 + random() * 22;
    const y = spine(x) - (1 - x / W * 0.8) * H * (0.10 + random() * 0.12);
    const rx = 14 + random() * 20, ry = 3 + random() * 4;
    g.fillStyle = '#acbcc6';
    g.beginPath(); g.ellipse(x, y + 3, rx, ry + 3, -0.14, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e4eaf0';
    g.beginPath(); g.ellipse(x - 1, y, rx * 0.93, ry, -0.14, 0, Math.PI * 2); g.fill();
  }
  // Opaque white texel block for the vertex-colored trunk, outside the bough silhouette.
  g.fillStyle = '#ffffff'; g.fillRect(0, H - 12, 12, 12);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Build branches in meters, then normalize for lidar height/radius instancing. Rotating a branch
 * after normalizing height and radius makes its droop stretch by the tree's aspect ratio. */
export function coniferGeometry(kind: 0 | 1, detail: 'high' | 'low'): THREE.BufferGeometry {
  const H = CONIFER_HEIGHT, R = CONIFER_RADIUS;
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.035, 0.18, H, 7, 5, true);
  trunk.translate(0, H / 2, 0);
  const trunkUV = trunk.getAttribute('uv');
  for (let i = 0; i < trunkUV.count; i++) trunkUV.setXY(i, 0.006, 0.015);
  parts.push(colorize(trunk.toNonIndexed(), (p) => {
    const shade = 0.85 + Math.sin(p.y * 6.7 + p.x * 13) * 0.12;
    return new THREE.Color(0.075, 0.052, 0.033).multiplyScalar(shade);
  }));
  for (const { angle, reach, drop, level, forked, shades } of coniferBoughs(kind, detail)) {
    const thickness = .14 + reach * .24;
    let shadeIndex = 0;
    const bough = (len: number, width: number, a: number, origin: THREE.Vector3, upright: boolean) => {
      const card = new THREE.PlaneGeometry(len, width, 2, 1);
      card.translate(len / 2, 0, 0);
      if (!upright) card.rotateX(-Math.PI / 2 + .12);
      card.rotateZ(-Math.atan2(drop, reach));
      card.rotateY(a);
      card.translate(origin.x, origin.y, origin.z);
      const shade = shades[shadeIndex++];
      parts.push(colorize(card.toNonIndexed(), (p) => {
        const exposed = Math.min(1, Math.hypot(p.x, p.z) / R);
        const tint = shade * (.72 + exposed * .28);
        return new THREE.Color(tint * .93, tint, tint * .94);
      }));
    };
    bough(reach, thickness, angle, new THREE.Vector3(0, level, 0), true);
    bough(reach, thickness * 2.2, angle, new THREE.Vector3(0, level, 0), false);
    if (forked) for (const side of [-1, 1]) {
      const at = reach * .38;
      bough(reach * .55, thickness * .9, angle + side * .43,
        new THREE.Vector3(Math.cos(angle) * at, level - drop * .38, -Math.sin(angle) * at), false);
    }
  }
  const g = mergeGeometries(parts);
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), coords = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    if (coords.getX(i) < 0.01 && coords.getY(i) < 0.02) continue;
    const n = new THREE.Vector3(pos.getX(i) * 0.5, 0.75, pos.getZ(i) * 0.5).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  g.scale(1 / R, 1 / H, 1 / R);
  g.computeBoundingSphere();
  for (const part of parts) part.dispose();
  return g;
}

export { aspenGeometry } from './aspen';

/** Gambel oak thicket clump: many crooked grey-brown stems from the ground, each with twigs (bare in winter). */
export function oakGeometry(detail: 'high' | 'low'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = rand(41);
  const R = 1.4, H = 3;
  const seg = (a: THREE.Vector3, b: THREE.Vector3, rad0: number, rad1: number, col: THREE.Color) => {
    a = a.clone().multiply(new THREE.Vector3(R, H, R));
    b = b.clone().multiply(new THREE.Vector3(R, H, R));
    const d = b.clone().sub(a); const L = d.length();
    const c = new THREE.CylinderGeometry(rad1 * R, rad0 * R, L, 4, 1, true);
    c.translate(0, L / 2, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    c.translate(a.x, a.y, a.z);
    parts.push(colorize(c.toNonIndexed(), () => col));
  };
  const stems = detail === 'high' ? 14 : 5;
  for (let i = 0; i < stems; i++) {
    const bx = (r() - 0.5) * 0.7, bz = (r() - 0.5) * 0.7;
    const lean = (r() - 0.5) * 0.9;
    const ang = r() * Math.PI * 2;
    const h = 0.55 + r() * 0.45;
    const a = new THREE.Vector3(bx, 0, bz);
    const mid = new THREE.Vector3(bx + Math.cos(ang) * lean * 0.4, h * 0.55, bz + Math.sin(ang) * lean * 0.4);
    const top = new THREE.Vector3(bx + Math.cos(ang) * lean, h, bz + Math.sin(ang) * lean);
    const col = new THREE.Color(0.12 + r() * 0.03, 0.09 + r() * 0.025, 0.065 + r() * 0.02);
    seg(a, mid, 0.03, 0.022, col);
    seg(mid, top, 0.022, 0.008, col);
    if (detail === 'high') {
      for (let k = 0; k < 4; k++) {
        const p = mid.clone().lerp(top, r());
        const a2 = r() * Math.PI * 2, l2 = 0.2 + r() * 0.3;
        seg(p, new THREE.Vector3(p.x + Math.cos(a2) * l2, p.y + 0.05 + r() * 0.15, p.z + Math.sin(a2) * l2), 0.008, 0.003,
          r() < 0.25 ? new THREE.Color(0.48, 0.34, 0.22) : col); // a few marcescent brown leaves
      }
    }
  }
  const result = mergeGeometries(parts);
  result.scale(1 / R, 1 / H, 1 / R);
  result.computeBoundingBox();
  result.scale(1, 1 / result.boundingBox!.max.y, 1);
  for (const part of parts) part.dispose();
  return result;
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
  conifer(0, S * 0.36, 0.8);
  conifer(S, S * 0.42, 0.68);
  drawAspenImpostor(g, S * 2, S);
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
