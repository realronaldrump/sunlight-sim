import * as THREE from 'three/webgpu';
import panelUrl from './assets/trail-board.webp';

/** The roofed kiosk in the gap between the red shack and east porch, in lodge coordinates.
 * Placement and dimensions are estimates from the February 2020 base-area photographs. */
export const BASE_TRAIL_MAP = { x: 21.7, z: -24.4, yaw: Math.PI / 2, width: 2.3, height: 4.0 };
let panelTexture: THREE.Texture | undefined;

export async function prepareTrailMapBoard() {
  if (panelTexture) return;
  panelTexture = await new THREE.TextureLoader().loadAsync(panelUrl);
  panelTexture.colorSpace = THREE.SRGBColorSpace;
  panelTexture.anisotropy = 8;
}

function timberTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 512;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#69503b'; c.fillRect(0, 0, 128, 512);
  let seed = 317;
  const random = () => ((seed = seed * 16807 % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 220; i++) {
    const x = random() * 128, y = random() * 512;
    c.strokeStyle = i % 3 ? 'rgba(22,14,9,.2)' : 'rgba(209,186,146,.2)';
    c.lineWidth = .5 + random() * 2;
    c.beginPath(); c.moveTo(x, y); c.bezierCurveTo(x + 3, y + 35, x - 3, y + 70, x + random() * 4, y + 120); c.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

export function buildTrailMapBoard(ground: number) {
  if (!panelTexture) throw new Error('Prepare the printed trail map before building its kiosk');
  const group = new THREE.Group(); group.name = 'base-trail-map-kiosk';
  group.position.set(BASE_TRAIL_MAP.x, ground, BASE_TRAIL_MAP.z); group.rotation.y = BASE_TRAIL_MAP.yaw;
  group.userData.reference = 'February 2020 east lodge deck photographs';
  const wood = new THREE.MeshStandardNodeMaterial({ map: timberTexture(), roughness: .94, color: 0x9c8064 });
  const endGrain = new THREE.MeshStandardNodeMaterial({ color: 0x3d2b1e, roughness: .96 });
  const roof = new THREE.MeshStandardNodeMaterial({ color: 0x434e46, roughness: .83, metalness: .12 });
  const snow = new THREE.MeshStandardNodeMaterial({ color: 0xe8eff1, roughness: .95 });
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0x6a6b65, metalness: .7, roughness: .55 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true; group.add(m); return m;
  };
  const box = (w: number, h: number, depth: number, x: number, y: number, z: number, mat = wood) =>
    add(new THREE.BoxGeometry(w, h, depth), mat, x, y, z);
  const beam = (a: number[], b: number[], width: number, depth: number, mat = wood) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
    const m = box(width, delta.length(), depth, 0, 0, 0, mat);
    m.position.copy(start).add(end).multiplyScalar(.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return m;
  };

  // Weathered upright timbers, a plank back and a recessed printed panel.
  for (const x of [-1.18, 1.18]) {
    box(.18, 3.4, .2, x, 1.39, 0);
    box(.2, .045, .22, x, .10, 0, steel);
  }
  for (let i = 0; i < 10; i++) box(.228, 1.92, .075, -1.035 + i * .23, 1.98, -.06);
  for (const y of [1.03, 2.94]) box(2.52, .14, .16, 0, y, .005);
  for (const x of [-1.1, 1.1]) box(.09, 1.8, .12, x, 1.99, .03);
  const panel = add(new THREE.PlaneGeometry(2.12, 1.59),
    new THREE.MeshStandardNodeMaterial({ map: panelTexture, roughness: .88, metalness: 0 }), 0, 2.0, .101);
  panel.name = 'base-trail-map-panel'; panel.userData.keep = true;
  panel.userData.printedSize = [3072, 2304]; panel.castShadow = false;
  // Galvanized face screws, corner plates and the rail behind the map.
  for (const x of [-1.10, 1.10]) for (const y of [1.12, 2.87]) {
    const bolt = add(new THREE.CylinderGeometry(.017, .017, .012, 10), steel, x, y, .108);
    bolt.rotation.x = Math.PI / 2;
  }
  box(2.5, .12, .15, 0, .63, -.08);
  for (const side of [-1, 1]) beam([side * 1.18, 2.53, -.18], [side * .68, 3.05, -.18], .11, .12);

  // The photographed steep little gable has exposed rafters and a dark timber infill.
  const eave = 3.06, rise = .69, half = 1.42, angle = Math.atan2(rise, half);
  for (const z of [-.43, .43]) {
    beam([-half, eave, z], [0, eave + rise, z], .13, .13);
    beam([0, eave + rise, z], [half, eave, z], .13, .13);
    box(half * 2, .12, .13, 0, eave, z);
  }
  for (let x = -1.12; x <= 1.12; x += .14) {
    const h = rise * (1 - Math.abs(x) / half);
    box(.115, h, .045, x, eave + h / 2, .36, endGrain);
  }
  for (const side of [-1, 1]) {
    const r = box(Math.hypot(half, rise) + .12, .065, 1.06, side * half / 2, eave + rise / 2 + .065, 0, roof);
    r.rotation.z = -side * angle;
    const cap = box(Math.hypot(half, rise) + .08, .13, 1.09, side * half / 2, eave + rise / 2 + .16, 0, snow);
    cap.rotation.z = -side * angle;
  }
  box(.13, .11, 1.1, 0, eave + rise + .18, 0, snow);
  return group;
}
