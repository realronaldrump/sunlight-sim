// The visible haul rope uses the same sampled path as the carriers, including exact
// support points and both turnaround arcs. A smoothing spline can miss the sheaves.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GAUGE, LiftPath } from '../../../shared/lifts';

export const CABLE_RADIUS = .03;

export function cableLineGeometry(path: LiftPath, side: number) {
  const distances = new Set(path.def.supports.map(s => Math.max(0, Math.min(path.horiz, s.s))));
  const n = Math.ceil(path.horiz / 1.5);
  for (let i = 0; i <= n; i++) distances.add(path.horiz * i / n);
  const H = [...distances].sort((a, b) => a - b), rings = 6;
  const positions: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let i = 0; i < H.length; i++) {
    const h = H[i], p = path.ropePoint(h, side);
    const before = path.ropePoint(Math.max(0, h - .1), side), after = path.ropePoint(Math.min(path.horiz, h + .1), side);
    const pitch = Math.atan2(after.y - before.y, Math.hypot(after.x - before.x, after.z - before.z));
    const nx = -path.ax * Math.sin(pitch), ny = Math.cos(pitch), nz = -path.az * Math.sin(pitch);
    for (let j = 0; j <= rings; j++) {
      const a = j / rings * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const x = path.rx * c + nx * s, y = ny * s, z = path.rz * c + nz * s;
      positions.push(p.x + CABLE_RADIUS * x, p.y + CABLE_RADIUS * y, p.z + CABLE_RADIUS * z);
      normals.push(x, y, z); uv.push(h / 4, j / rings);
      if (i < H.length - 1 && j < rings) {
        const a = i * (rings + 1) + j, b = a + 1, c = a + rings + 1, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.userData.sampleDistances = H;
  return geometry;
}

export function cableLoopGeometry(path: LiftPath) {
  const arc = Math.PI * GAUGE / 2;
  class WheelArc extends THREE.Curve<THREE.Vector3> {
    constructor(private start: number) { super(); }
    getPoint(t: number, target = new THREE.Vector3()) {
      const p = path.loopPoint(this.start + t * arc).p;
      return target.set(p.x, p.y, p.z);
    }
  }
  const parts = [cableLineGeometry(path, 1), cableLineGeometry(path, -1),
    new THREE.TubeGeometry(new WheelArc(path.lineLen), 48, CABLE_RADIUS, 6, false),
    new THREE.TubeGeometry(new WheelArc(2 * path.lineLen + arc), 48, CABLE_RADIUS, 6, false)];
  const result = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return result;
}
