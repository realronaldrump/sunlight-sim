// Base-area buildings from OSM footprints: wood/stucco walls with window bands and snow-covered roofs
// (gable roofs on rectangular footprints, flat snowy roofs otherwise), plus box colliders.
import * as THREE from 'three/webgpu';
import type { ColliderGrid } from '../../../shared/collision';

interface BuildingDef { id: number; name: string; levels: number; base: number; points: number[][] }

function facadeTexture(seed: number) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
  const g = cv.getContext('2d')!;
  const woods = ['#7a5536', '#6b4a2f', '#8a6a4a', '#a08060', '#5d4430'];
  g.fillStyle = woods[seed % woods.length]; g.fillRect(0, 0, 256, 256);
  // vertical siding
  for (let x = 0; x < 256; x += 8) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 1, 256); }
  // one storey = 128 px; windows
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 14 + col * 62, y = 30 + row * 128;
      g.fillStyle = '#e8e2d4'; g.fillRect(x - 3, y - 3, 40, 52);
      g.fillStyle = '#29343f'; g.fillRect(x, y, 34, 46);
      g.fillStyle = 'rgba(160,190,220,0.35)'; g.fillRect(x, y, 34, 14);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

export function buildBuildings(defs: BuildingDef[], height: (x: number, z: number) => number, colliders: ColliderGrid): THREE.Group {
  const group = new THREE.Group(); group.name = 'buildings';
  const roofMat = new THREE.MeshStandardNodeMaterial({ color: 0xf1f4f8, roughness: 0.8 });
  const trimMat = new THREE.MeshStandardNodeMaterial({ color: 0x3b2a1e, roughness: 0.9 });
  defs.forEach((b, idx) => {
    const pts = b.points;
    if (pts.length < 3) return;
    // ground under the footprint
    let gmin = Infinity, gmax = -Infinity;
    for (const p of pts) { const h = height(p[0], p[1]); gmin = Math.min(gmin, h); gmax = Math.max(gmax, h); }
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    gmin = Math.min(gmin, height(cx, cz)); gmax = Math.max(gmax, height(cx, cz));
    const storeys = Math.max(1, b.levels || 2);
    const wallH = storeys * 3.1 + (gmax - gmin);
    const base = gmin - 0.6;
    // walls: extrude footprint (shape in x / -z plane), then stand it up
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0] - cx, -(p[1] - cz))));
    const walls = new THREE.ExtrudeGeometry(shape, { depth: wallH + 0.6, bevelEnabled: false });
    walls.rotateX(-Math.PI / 2);
    // UVs: set per-vertex world-scale UVs for the facade texture (u along wall, v up)
    const pos = walls.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      uv[i * 2] = (x + z) / 6.2; uv[i * 2 + 1] = (y - (gmax - gmin) - 0.6) / 6.2;
    }
    walls.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    walls.computeVertexNormals();
    const wallMat = new THREE.MeshStandardNodeMaterial({ map: facadeTexture(b.id + idx), roughness: 0.85 });
    const wm = new THREE.Mesh(walls, wallMat);
    wm.position.set(cx, base, cz);
    wm.castShadow = true; wm.receiveShadow = true;
    group.add(wm);
    const top = base + wallH + 0.6;
    // principal axis for roof / collider
    let sxx = 0, szz = 0, sxz = 0;
    for (const p of pts) { const dx = p[0] - cx, dz = p[1] - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const ax = Math.cos(ang), az = Math.sin(ang);
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const p of pts) {
      const dx = p[0] - cx, dz = p[1] - cz;
      const a = dx * ax + dz * az, bb = -dx * az + dz * ax;
      minA = Math.min(minA, a); maxA = Math.max(maxA, a); minB = Math.min(minB, bb); maxB = Math.max(maxB, bb);
    }
    const L = maxA - minA, Wd = maxB - minB;
    const ocx = cx + ax * (minA + maxA) / 2 - az * (minB + maxB) / 2;
    const ocz = cz + az * (minA + maxA) / 2 + ax * (minB + maxB) / 2;
    if (pts.length <= 6) {
      // gable roof along the long axis, 30 deg pitch, with eaves
      const ridge = Math.tan(Math.PI / 6) * (Wd / 2 + 0.6);
      const roof = new THREE.BufferGeometry();
      const hl = L / 2 + 0.6, hw = Wd / 2 + 0.6;
      const v = [
        -hl, 0, -hw, hl, 0, -hw, hl, ridge, 0, -hl, 0, -hw, hl, ridge, 0, -hl, ridge, 0,
        -hl, 0, hw, -hl, ridge, 0, hl, ridge, 0, -hl, 0, hw, hl, ridge, 0, hl, 0, hw,
        -hl, 0, -hw, -hl, ridge, 0, -hl, 0, hw, hl, 0, -hw, hl, 0, hw, hl, ridge, 0,
      ];
      roof.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      roof.computeVertexNormals();
      const rm = new THREE.Mesh(roof, [roofMat][0]);
      rm.position.set(ocx, top, ocz);
      rm.rotation.y = -ang;
      rm.castShadow = true; rm.receiveShadow = true;
      (rm.material as THREE.Material).side = THREE.DoubleSide;
      group.add(rm);
    } else {
      const cap = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
      cap.rotateX(-Math.PI / 2);
      const cm = new THREE.Mesh(cap, roofMat);
      cm.position.set(cx, top, cz); cm.castShadow = true; cm.receiveShadow = true;
      group.add(cm);
      const trim = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false }).rotateX(-Math.PI / 2), trimMat);
      trim.position.set(cx, top - 0.3, cz); trim.scale.set(1.02, 1, 1.02); group.add(trim);
    }
    colliders.add({ type: 'box', x: ocx, z: ocz, hx: L / 2, hz: Wd / 2, yaw: -ang, top });
  });
  return group;
}
