// Generic OSM buildings around the base (condos, houses, the B&B, outbuildings), built from data
// rather than as textured extrusions: footprint from OSM, eave and ridge from 2016 lidar
// (pipeline/build_structures.py), grade from the DEM. Walls step down to the measured ground on
// slopes, windows and doors are framed openings, taller buildings get balconies, pitched roofs have
// overhangs, fascia, a snow load and a chimney. Materials vary per building, deterministically.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mx_noise_float, positionWorld, vec3 } from 'three/tsl';
import type { ColliderGrid } from '../../../shared/collision';
import type { BuildingDef } from './sunlightBuildings';

export interface MeasuredBuilding extends BuildingDef { grade?: [number, number]; eave?: number; roofTop?: number; roofForm?: 'pitched' | 'flat' }

function rng(seed: number) { let s = Math.abs(seed) % 2147483646 + 1; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

const grain = (hex: number, scale: [number, number, number], amount: number, rough: number, metal = 0) => {
  const m = new THREE.MeshStandardNodeMaterial({ color: hex, roughness: rough, metalness: metal });
  const c = new THREE.Color(hex);
  const n = mx_noise_float(positionWorld.mul(vec3(...scale))).mul(amount).add(1 - amount / 2);
  m.colorNode = vec3(c.r, c.g, c.b).mul(n);
  return m;
};
let M: ReturnType<typeof mats> | null = null;
function mats() {
  return {
    siding: [grain(0x6b4a32, [14, 0.6, 14], 0.12, 0.9), grain(0x7d5b3e, [14, 0.6, 14], 0.12, 0.9), grain(0x5a4434, [14, 0.6, 14], 0.1, 0.9), grain(0x8a6a4c, [14, 0.6, 14], 0.12, 0.9)],
    stucco: [grain(0xd6c9a8, [5, 5, 5], 0.06, 0.95), grain(0xc4b28c, [5, 5, 5], 0.06, 0.95), grain(0xe0d8c6, [5, 5, 5], 0.05, 0.95)],
    trim: [new THREE.MeshStandardNodeMaterial({ color: 0x3a2a1e, roughness: 0.8 }), new THREE.MeshStandardNodeMaterial({ color: 0xe8e4da, roughness: 0.7 }), new THREE.MeshStandardNodeMaterial({ color: 0x2d3a2f, roughness: 0.75 })],
    roof: [grain(0x3d4a3c, [2, 2, 2], 0.08, 0.55, 0.4), grain(0x4a3a30, [2, 2, 2], 0.08, 0.6, 0.35), grain(0x55595e, [2, 2, 2], 0.08, 0.5, 0.45), grain(0x6a2f25, [2, 2, 2], 0.08, 0.55, 0.35)],
    concrete: grain(0x87837b, [3, 3, 3], 0.1, 0.95),
    stone: grain(0x7a7268, [6, 6, 6], 0.25, 0.95),
    snow: new THREE.MeshStandardNodeMaterial({ color: 0xf0f4f8, roughness: 0.92 }),
    glass: new THREE.MeshStandardNodeMaterial({ color: 0x1a232a, roughness: 0.06, metalness: 0.5 }),
    // some windows have blinds or curtains drawn, which is what breaks up real facades in daylight
    lit: new THREE.MeshStandardNodeMaterial({ color: 0xb9ad94, roughness: 0.55 }),
    door: new THREE.MeshStandardNodeMaterial({ color: 0x4d3322, roughness: 0.7 }),
    deck: grain(0x7a5c40, [10, 1, 10], 0.15, 0.9),
  };
}

class Parts {
  private by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(g: THREE.BufferGeometry, m: THREE.Material) { let a = this.by.get(m); if (!a) this.by.set(m, a = []); a.push(g.index ? g.toNonIndexed() : g); }
  /** Box spanning [u0,u1] along the edge direction (ux,uz) from origin (ox,oz), [y0,y1], depth [w0,w1] along the outward normal. */
  edgeBox(m: THREE.Material, ox: number, oz: number, ux: number, uz: number, u0: number, u1: number, y0: number, y1: number, w0: number, w1: number) {
    if (u1 - u0 < 1e-3 || y1 - y0 < 1e-3) return;
    const nx = -uz, nz = ux; // outward normal for counter-clockwise footprints in (x, -z)
    const g = new THREE.BoxGeometry(u1 - u0, y1 - y0, Math.max(0.005, w1 - w0));
    const yaw = Math.atan2(-uz, ux);
    g.rotateY(yaw);
    const cu = (u0 + u1) / 2, cw = (w0 + w1) / 2;
    g.translate(ox + ux * cu + nx * cw, (y0 + y1) / 2, oz + uz * cu + nz * cw);
    this.add(g, m);
  }
  build(group: THREE.Group) {
    for (const [m, gs] of this.by) {
      for (const g of gs) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      const merged = mergeGeometries(gs); if (!merged) continue;
      const mesh = new THREE.Mesh(merged, m); mesh.castShadow = m !== M!.glass && m !== M!.lit; mesh.receiveShadow = true; group.add(mesh);
    }
  }
}

/** Oriented bounding rectangle along the footprint's principal axis. */
function obb(pts: number[][]) {
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  let best = { area: Infinity, ang: 0, minA: 0, maxA: 0, minB: 0, maxB: 0 };
  for (let i = 0; i < pts.length; i++) { // minimum-area rectangle has a side along a polygon edge
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]), ax = Math.cos(ang), az = Math.sin(ang);
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const r of pts) { const dx = r[0] - cx, dz = r[1] - cz, a = dx * ax + dz * az, b = -dx * az + dz * ax; minA = Math.min(minA, a); maxA = Math.max(maxA, a); minB = Math.min(minB, b); maxB = Math.max(maxB, b); }
    const area = (maxA - minA) * (maxB - minB);
    if (area < best.area) best = { area, ang, minA, maxA, minB, maxB };
  }
  let { ang, minA, maxA, minB, maxB } = best;
  if (maxB - minB > maxA - minA) { ang += Math.PI / 2; [minA, maxA, minB, maxB] = [minB, maxB, -maxA, -minA]; }
  const ax = Math.cos(ang), az = Math.sin(ang);
  return { cx: cx + ax * (minA + maxA) / 2 - az * (minB + maxB) / 2, cz: cz + az * (minA + maxA) / 2 + ax * (minB + maxB) / 2, ax, az, L: maxA - minA, W: maxB - minB };
}

export function buildGenericBuilding(b: MeasuredBuilding, height: (x: number, z: number) => number, colliders: ColliderGrid) {
  M ??= mats();
  const r = rng(b.id);
  let pts = b.points.map((p) => [p[0], p[1]]);
  if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.05) pts = pts.slice(0, -1);
  if (pts.length < 3) return null;
  // counter-clockwise in (x, -z) so edge normals point outward
  let area2 = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area2 += p[0] * -q[1] - q[0] * -p[1]; }
  if (area2 < 0) pts.reverse();
  // Grade: lidar-measured ring around the footprint when available. Terrain far from the base may not
  // have streamed in yet (height() then returns coarse or zero values), so it is only a fallback.
  let gmin = Infinity, gmax = -Infinity;
  if (b.grade) { gmin = b.grade[0]; gmax = b.grade[1]; }
  else {
    for (const p of pts) { const h = height(p[0], p[1]); gmin = Math.min(gmin, h); gmax = Math.max(gmax, h); }
    if (!(gmin > 1000) || gmax - gmin > 15) { gmin = b.base; gmax = b.base + 1; }
  }
  const local = (x: number, z: number) => { const h = height(x, z); return Math.abs(h - gmin) < 12 ? h : gmin; };
  const levels = Math.max(1, b.levels || 2);
  let eave = b.eave ?? gmin + levels * 2.9 + 0.4;
  eave = Math.max(eave, gmax + 2.5);
  const pitched = (b.roofForm ?? (pts.length <= 6 ? 'pitched' : 'flat')) === 'pitched';
  const ridgeTop = Math.max(b.roofTop ?? eave + 2.2, eave + (pitched ? 1.2 : 0.3));
  const storeys = Math.min(6, Math.max(1, Math.round((eave - gmin - 0.5) / 2.85)));
  const storeyH = (eave - gmin - 0.5) / storeys;
  const wood = r() < 0.65;
  const wallMat = wood ? M.siding[Math.floor(r() * M.siding.length)] : M.stucco[Math.floor(r() * M.stucco.length)];
  const trim = M.trim[Math.floor(r() * M.trim.length)], roofMat = M.roof[Math.floor(r() * M.roof.length)];
  const P = new Parts();
  const T = 0.25;
  // walls with foundation, framed windows and one door on the longest downhill-facing edge
  let doorEdge = 0, doorScore = -Infinity;
  pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); const s = L - (local((p[0] + q[0]) / 2, (p[1] + q[1]) / 2) - gmin) * 3; if (s > doorScore) { doorScore = s; doorEdge = i; } });
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
    if (L < 0.3) return;
    const ux = dx / L, uz = dz / L;
    const edgeGround = Math.min(local(p[0], p[1]), local(q[0], q[1]), local((p[0] + q[0]) / 2, (p[1] + q[1]) / 2));
    const sill0 = Math.max(gmin + 0.45, edgeGround + 0.35);
    P.edgeBox(M!.concrete, p[0], p[1], ux, uz, 0, L, gmin - 1.2, sill0, -T, 0.02);
    // window columns along the edge, skipping corners; a door replaces one ground-floor window
    const n = Math.floor((L - 1.2) / 2.7), pitchU = n > 0 ? (L - 1.2) / n : L;
    const opens: { u0: number; u1: number; y0: number; y1: number; door?: boolean; lit: boolean }[] = [];
    for (let s = 0; s < storeys; s++) {
      const floorY = gmin + 0.5 + s * storeyH;
      for (let k = 0; k < n; k++) {
        const uc = 0.6 + pitchU * (k + 0.5);
        const door = i === doorEdge && s === 0 && k === Math.floor(n / 2) && floorY + 0.1 >= edgeGround - 0.2;
        const w = door ? 1.0 : Math.min(1.3, pitchU - 0.8), y0 = door ? floorY : floorY + 0.95, y1 = door ? floorY + 2.1 : floorY + Math.min(2.3, storeyH - 0.4);
        if (y0 < edgeGround + 0.3 && !door) continue; // below the slope on the uphill side
        if (w < 0.5 || y1 > eave - 0.15) continue;
        opens.push({ u0: uc - w / 2, u1: uc + w / 2, y0, y1, door, lit: r() < 0.2 });
      }
    }
    // wall panels between and around the openings (cut by rows, then columns)
    const rows = [...new Set(opens.flatMap((o) => [o.y0, o.y1]))].sort((a, b2) => a - b2);
    const bands = [sill0, ...rows.filter((y) => y > sill0 && y < eave), eave];
    for (let k = 0; k < bands.length - 1; k++) {
      const ya = bands[k], yb = bands[k + 1], mid = (ya + yb) / 2;
      const holes = opens.filter((o) => o.y0 <= mid && o.y1 >= mid).sort((a, b2) => a.u0 - b2.u0);
      let u = 0;
      for (const o of holes) { P.edgeBox(wallMat, p[0], p[1], ux, uz, u, o.u0, ya, yb, -T, 0); u = o.u1; }
      P.edgeBox(wallMat, p[0], p[1], ux, uz, u, L, ya, yb, -T, 0);
    }
    for (const o of opens) {
      const f = 0.08;
      P.edgeBox(trim, p[0], p[1], ux, uz, o.u0 - f, o.u0, o.y0, o.y1 + f, -0.05, 0.05);
      P.edgeBox(trim, p[0], p[1], ux, uz, o.u1, o.u1 + f, o.y0, o.y1 + f, -0.05, 0.05);
      P.edgeBox(trim, p[0], p[1], ux, uz, o.u0 - f, o.u1 + f, o.y1, o.y1 + f, -0.05, 0.06);
      if (o.door) {
        P.edgeBox(M!.door, p[0], p[1], ux, uz, o.u0, o.u1, o.y0, o.y1, -0.12, -0.08);
        P.edgeBox(M!.concrete, p[0], p[1], ux, uz, o.u0 - 0.4, o.u1 + 0.4, o.y0 - 0.2, o.y0, 0, 1.0);
        P.edgeBox(trim, p[0], p[1], ux, uz, o.u0 - 0.5, o.u1 + 0.5, o.y1 + 0.25, o.y1 + 0.35, 0, 1.0); // door canopy
        P.edgeBox(M!.snow, p[0], p[1], ux, uz, o.u0 - 0.45, o.u1 + 0.45, o.y1 + 0.35, o.y1 + 0.45, 0.05, 0.95);
      } else {
        P.edgeBox(trim, p[0], p[1], ux, uz, o.u0 - 0.12, o.u1 + 0.12, o.y0 - 0.06, o.y0, -0.05, 0.1); // sill
        P.edgeBox(o.lit ? M!.lit : M!.glass, p[0], p[1], ux, uz, o.u0, o.u1, o.y0, o.y1, -0.14, -0.12);
        if (o.u1 - o.u0 > 1) P.edgeBox(trim, p[0], p[1], ux, uz, (o.u0 + o.u1) / 2 - 0.03, (o.u0 + o.u1) / 2 + 0.03, o.y0, o.y1, -0.13, -0.09);
      }
    }
    // balconies on the long, downhill-facing upper storeys of condos
    if (storeys >= 2 && L > 10 && i === doorEdge) {
      for (let s = 1; s < storeys; s++) {
        const y = gmin + 0.5 + s * storeyH - 0.05;
        P.edgeBox(M!.deck, p[0], p[1], ux, uz, 0.4, L - 0.4, y - 0.18, y, 0, 1.6);
        P.edgeBox(trim, p[0], p[1], ux, uz, 0.4, L - 0.4, y + 0.95, y + 1.02, 1.5, 1.6);
        for (let u = 0.45; u < L - 0.4; u += 0.14) P.edgeBox(trim, p[0], p[1], ux, uz, u, u + 0.03, y, y + 0.95, 1.53, 1.56);
        P.edgeBox(M!.snow, p[0], p[1], ux, uz, 0.45, L - 0.45, y + 1.02, y + 1.07, 1.5, 1.6);
      }
    }
  });
  // roof
  const o = obb(pts), over = 0.55;
  const yaw = Math.atan2(-o.az, o.ax);
  const roofGroup = (g: THREE.BufferGeometry, m: THREE.Material) => { g.rotateY(yaw); g.translate(o.cx, 0, o.cz); P.add(g, m); };
  if (pitched && pts.length <= 6) {
    const hl = o.L / 2 + over, hw = o.W / 2 + over, rise = ridgeTop - eave, slope = Math.atan2(rise, o.W / 2);
    for (const side of [-1, 1]) {
      const plane = Math.hypot(hw, rise * hw / (o.W / 2));
      for (const [m, lift, thick] of [[roofMat, 0, 0.14], [M.snow, 0.14, 0.2]] as const) {
        const g = new THREE.BoxGeometry(hl * 2, thick, plane);
        g.translate(0, thick / 2 + lift, side * plane / 2);
        g.rotateX(side * slope);
        g.translate(0, ridgeTop - 0.02, 0);
        roofGroup(g, m);
      }
      // fascia along the eave
      const fa = new THREE.BoxGeometry(hl * 2, 0.25, 0.05); fa.translate(0, eave - over * Math.tan(slope) - 0.05, side * hw); roofGroup(fa, trim);
    }
    // gable ends
    for (const end of [-1, 1]) {
      const tri = new THREE.BufferGeometry();
      const x = end * o.L / 2;
      tri.setAttribute('position', new THREE.Float32BufferAttribute([x, eave, -o.W / 2, x, eave, o.W / 2, x, ridgeTop, 0], 3));
      if (end < 0) tri.setIndex([0, 1, 2]); else tri.setIndex([0, 2, 1]);
      tri.computeVertexNormals(); tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      roofGroup(tri, wallMat);
      const vent = new THREE.BoxGeometry(0.05, 0.5, 0.7); vent.translate(x + end * 0.02, eave + (ridgeTop - eave) * 0.55, 0); roofGroup(vent, trim);
    }
    // chimney through the roof near one end
    if (r() < 0.75) {
      const cxL = (r() < 0.5 ? -1 : 1) * o.L * 0.28, czL = (r() - 0.5) * o.W * 0.3, hR = ridgeTop - Math.abs(czL) * Math.tan(slope);
      const ch = new THREE.BoxGeometry(0.7, hR - eave + 1.3, 0.7); ch.translate(cxL, (eave + hR + 1.3) / 2, czL); roofGroup(ch, M.stone);
      const cap = new THREE.BoxGeometry(0.85, 0.12, 0.85); cap.translate(cxL, hR + 1.36, czL); roofGroup(cap, M.snow);
    }
  } else if (pitched) {
    // complex footprint: hipped roof as a frustum from the eave outline to a reduced ridge outline
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const k = 0.45, pos: number[] = [], pos2: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const po = [cx + (p[0] - cx) * 1.06, cz + (p[1] - cz) * 1.06], qo = [cx + (q[0] - cx) * 1.06, cz + (q[1] - cz) * 1.06];
      const pi = [cx + (p[0] - cx) * k, cz + (p[1] - cz) * k], qi = [cx + (q[0] - cx) * k, cz + (q[1] - cz) * k];
      for (const [arr, lift] of [[pos, 0], [pos2, 0.18]] as const)
        arr.push(po[0], eave + lift, po[1], qo[0], eave + lift, qo[1], qi[0], ridgeTop + lift, qi[1], po[0], eave + lift, po[1], qi[0], ridgeTop + lift, qi[1], pi[0], ridgeTop + lift, pi[1]);
    }
    for (const [arr, m] of [[pos, roofMat], [pos2, M.snow]] as const) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals();
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(arr.length / 3 * 2), 2));
      P.add(g, m);
    }
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2((p[0] - cx) * k, -(p[1] - cz) * k)));
    const top = new THREE.ShapeGeometry(shape); top.rotateX(-Math.PI / 2); top.translate(cx, ridgeTop + 0.18, cz); P.add(top, M.snow);
  } else {
    // flat roof: membrane, parapet cap and snow
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0] - cx, -(p[1] - cz))));
    const slab = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false }); slab.rotateX(-Math.PI / 2); slab.translate(cx, eave, cz); P.add(slab, trim);
    const sn = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false }); sn.rotateX(-Math.PI / 2); sn.scale(0.97, 1, 0.97); sn.translate(cx * 0.03, eave + 0.35, cz * 0.03); P.add(sn, M.snow);
  }
  const group = new THREE.Group(); group.name = b.name || `building-${b.id}`;
  P.build(group);
  colliders.add({ type: 'box', x: o.cx, z: o.cz, hx: o.L / 2, hz: o.W / 2, yaw: -Math.atan2(o.az, o.ax), top: ridgeTop });
  return group;
}
