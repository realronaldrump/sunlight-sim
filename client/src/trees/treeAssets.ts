// Procedural tree geometry (near LOD). All generated in code. Geometry is built in a normalized space
// (height 1, crown radius 1) and scaled per instance by (crown radius, height, crown radius), so
// horizontal and vertical extents are designed separately. Far trees are baked from these same models
// (impostor.ts).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONIFER_HEIGHT, CONIFER_RADIUS } from '../../../shared/treeData';

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

import { coniferGeometry as buildConifer } from './conifer';
export function coniferGeometry(kind: 0 | 1, detail: 'high' | 'low', variant = 0): THREE.BufferGeometry {
  const g = buildConifer(kind, detail, variant);
  g.userData.aspect = CONIFER_HEIGHT / CONIFER_RADIUS;
  return g;
}

export { aspenGeometry } from './aspen';

/** Gambel oak thicket clump: many crooked grey-brown stems from the ground, each with twigs (bare in winter). */
export function oakGeometry(detail: 'high' | 'low', variant = 0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const r = rand(41 + variant * 173);
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
  const stems = detail === 'high' ? 14 - variant * 4 : 5;
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
  result.userData.aspect = H * result.boundingBox!.max.y / R;
  result.scale(1, 1 / result.boundingBox!.max.y, 1);
  result.computeBoundingBox();
  for (const part of parts) part.dispose();
  return result;
}

/** Two crossed quads, unit height, base at y=0, half-width 1. `view` picks the baked view of each
 * quad: 0 was baked looking along -z, 1 looking along -x. */
export function crossQuadGeometry(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(2, 1); a.translate(0, 0.5, 0);
  const b = a.clone(); b.rotateY(Math.PI / 2);
  a.setAttribute('view', new THREE.Float32BufferAttribute([0, 0, 0, 0], 1));
  b.setAttribute('view', new THREE.Float32BufferAttribute([1, 1, 1, 1], 1));
  return mergeGeometries([a, b]);
}
