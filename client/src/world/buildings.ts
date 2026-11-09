// Base-area buildings: Sunlight-specific models (main lodge, Brettelberg, base modular buildings) and
// lidar-measured generic buildings (houses.ts) from OSM footprints, plus small resort extras.
import * as THREE from 'three/webgpu';
import type { ColliderGrid } from '../../../shared/collision';
import { buildSunlightStructure, type BuildingDef } from './sunlightBuildings';
import { buildGenericBuilding, type MeasuredBuilding } from './houses';

export function buildBuildings(defs: BuildingDef[], height: (x: number, z: number) => number, colliders: ColliderGrid): THREE.Group {
  const group = new THREE.Group(); group.name = 'buildings';
  defs.forEach((b, idx) => {
    const specific = buildSunlightStructure(b, height, colliders);
    if (specific) { group.add(specific); return; }
    const g = buildGenericBuilding(b as MeasuredBuilding, height, colliders);
    if (g) group.add(g);
    void idx;
  });
  return group;
}

/** Small procedural structures not in OSM: ski patrol HQ at the summit and the ticket window at the base. */
export function buildResortExtras(lifts: { name: string; bottom: number[]; top: number[] }[], height: (x: number, z: number) => number,
  slope: (x: number, z: number) => number, colliders: ColliderGrid): THREE.Group {
  const group = new THREE.Group(); group.name = 'extras';
  const signTex = (text: string, bg: string, fg: string, cross = false) => {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const g = cv.getContext('2d')!;
    g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
    if (cross) { g.fillStyle = '#d61f1f'; g.fillRect(28, 44, 72, 40); g.fillRect(44, 28, 40, 72); }
    g.fillStyle = fg; g.font = 'bold 54px Helvetica, Arial, sans-serif'; g.textBaseline = 'middle';
    g.fillText(text, cross ? 120 : 30, 66);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const hut = (x: number, z: number, w: number, d: number, h: number, yaw: number, label: THREE.Texture, wall: number) => {
    let gmin = Infinity, gmax = -Infinity;
    for (const [dx, dz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const gy = height(x + c * dx + s * dz, z - s * dx + c * dz); gmin = Math.min(gmin, gy); gmax = Math.max(gmax, gy);
    }
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h + (gmax - gmin) + 0.5, d), new THREE.MeshStandardNodeMaterial({ color: wall, roughness: 0.85 }));
    body.position.y = gmin - 0.5 + (h + (gmax - gmin) + 0.5) / 2; body.castShadow = true; body.receiveShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.45, d + 0.8), new THREE.MeshStandardNodeMaterial({ color: 0xf2f5f8, roughness: 0.8 }));
    roof.position.y = gmax + h + 0.2; roof.castShadow = true;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, w * 0.2), new THREE.MeshStandardNodeMaterial({ map: label, roughness: 0.6 }));
    sign.position.set(0, gmax + h - 0.55, d / 2 + 0.02);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 2.05), new THREE.MeshStandardNodeMaterial({ color: 0x3b2a1e }));
    door.position.set(-w * 0.25, gmax + 1.03, d / 2 + 0.01);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshStandardNodeMaterial({ color: 0x2a3540, roughness: 0.2 }));
    win.position.set(w * 0.2, gmax + 1.4, d / 2 + 0.01);
    g.add(body, roof, sign, door, win);
    g.position.set(x, 0, z); g.rotation.y = yaw;
    group.add(g);
    colliders.add({ type: 'box', x, z, hx: w / 2, hz: d / 2, yaw: yaw, top: gmax + h });
  };
  const flattest = (cx: number, cz: number, rMin: number, rMax: number) => {
    let best = { x: cx, z: cz, s: Infinity };
    for (let r = rMin; r <= rMax; r += 4) for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const s = slope(x, z) + r * 0.02;
      if (s < best.s && !colliders.query(x, z).some((c) => Math.hypot(c.x - x, c.z - z) < 7)) best = { x, z, s };
    }
    return best;
  };
  const primo = lifts.find((l) => l.name === 'Primo');
  if (primo) {
    const p = flattest(primo.top[0], primo.top[2], 22, 45);
    const yaw = Math.atan2(primo.top[0] - p.x, primo.top[2] - p.z); // door faces the lift top
    hut(p.x, p.z, 7, 5.5, 3.0, yaw, signTex('SKI PATROL', '#ffffff', '#c21b1b', true), 0x7a3b2c);
  }
  const seg = lifts.find((l) => l.name === 'Segundo');
  if (seg) {
    const p = flattest(seg.bottom[0], seg.bottom[2], 26, 50);
    const yaw = Math.atan2(seg.bottom[0] - p.x, seg.bottom[2] - p.z);
    hut(p.x, p.z, 4.2, 3, 2.7, yaw, signTex('LIFT TICKETS', '#1d3b5e', '#ffffff'), 0x8a6a4a);
  }
  return group;
}
