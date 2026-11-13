import * as THREE from 'three/webgpu';
import type { ColliderGrid } from '../../../shared/collision';
import { BASE_TRAIL_MAP, addBaseTrailMapCollider } from '../../../shared/baseTrailMap';
import panelUrl from './assets/trail-board.webp';

/** The owner's IMG_2598 shows this board on the descent to Segundo and Tercero.
 * Its placement follows the owner's circled overhead view beside the Tercero line.
 * Dimensions are photo-based estimates, not a survey. */
let panelTexture: THREE.Texture | undefined;

export async function prepareTrailMapBoard() {
  if (panelTexture) return;
  panelTexture = await new THREE.TextureLoader().loadAsync(panelUrl);
  panelTexture.colorSpace = THREE.SRGBColorSpace;
  panelTexture.anisotropy = 8;
}

function bannerTexture(cyan = false) {
  const cv = document.createElement('canvas'); cv.width = 1536; cv.height = 160;
  const c = cv.getContext('2d')!;
  c.fillStyle = cyan ? '#52c8e6' : '#171b20'; c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = cyan ? '#17385c' : '#f8f1df'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `bold ${cyan ? 58 : 76}px Georgia, serif`;
  c.fillText(cyan ? 'GLENWOOD SPRINGS  ·  COLORADO' : 'GO LOCAL WITH A LOCAL', 768, 79, 1450);
  if (!cyan) { c.fillStyle = '#c73342'; c.fillRect(22, 126, 1492, 16); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function buildTrailMapBoard(height: (x: number, z: number) => number, colliders: ColliderGrid) {
  if (!panelTexture) throw new Error('Prepare the printed trail map before building its frame');
  const { x, z, yaw } = BASE_TRAIL_MAP, ground = height(x, z);
  const group = new THREE.Group(); group.name = 'base-trail-map-board';
  group.position.set(x, ground, z); group.rotation.y = yaw;
  group.userData.reference = 'Owner photograph IMG_2598.JPG, approach to the two base lifts';
  const black = new THREE.MeshStandardNodeMaterial({ color: 0x151b20, roughness: .72, metalness: .45 });
  const back = new THREE.MeshStandardNodeMaterial({ color: 0x485054, roughness: .82, metalness: .25 });
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0x949c9e, metalness: .75, roughness: .45 });
  const pad = new THREE.MeshStandardNodeMaterial({ color: 0xf6b51a, roughness: .96 });
  const orange = new THREE.MeshStandardNodeMaterial({ color: 0xf45c17, roughness: .85 });
  const white = new THREE.MeshStandardNodeMaterial({ color: 0xf4eee1, roughness: .8 });
  const sample = (lx: number, lz: number) => height(x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw)) - ground;
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, px: number, py: number, pz: number) => {
    const m = new THREE.Mesh(geometry, material); m.position.set(px, py, pz);
    m.castShadow = true; m.receiveShadow = true; group.add(m); return m;
  };
  const box = (w: number, h: number, depth: number, px: number, py: number, pz: number, mat = black) =>
    add(new THREE.BoxGeometry(w, h, depth), mat, px, py, pz);
  const face = (w: number, h: number, py: number, tex: THREE.Texture) => {
    const p = add(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardNodeMaterial({ map: tex, roughness: .88 }), 0, py, .126);
    p.castShadow = false; return p;
  };

  // Tall square black posts with the conspicuous yellow safety pads seen in the photo.
  for (const px of [-1.68, 1.68]) {
    const floor = sample(px, 0), bottom = floor - .25;
    box(.17, 4.18 - bottom, .19, px, (4.18 + bottom) / 2, 0);
    box(.19, .06, .21, px, 4.2, 0);
    box(.31, 1.03, .31, px, floor + .505, .015, pad);
    box(.025, .96, .012, px + .12, floor + .51, .178, orange);
    for (const py of [.14, .82]) box(.315, .025, .322, px, floor + py, .015);
    box(.29, .035, .31, px, floor + 1.035, .015, pad);
  }
  box(3.5, .13, .2, 0, 4.12, 0);
  box(3.5, .10, .2, 0, 3.61, 0);
  box(3.5, .13, .2, 0, 1.19, 0);
  box(3.5, .10, .2, 0, .83, 0);
  box(3.18, 2.39, .075, 0, 2.4, .06, back);
  const panel = face(3.12, 2.34, 2.4, panelTexture);
  panel.name = 'base-trail-map-panel'; panel.userData.keep = true; panel.userData.printedSize = [3072, 2304];
  for (const px of [-1.6, 1.6]) box(.06, 2.4, .13, px, 2.4, .05);

  // Separate advertising bands match the legible slogan, without inventing tiny contact details.
  const band = bannerTexture();
  box(3.18, .34, .08, 0, 3.91, .05, back); face(3.12, .32, 3.91, band);
  face(3.12, .17, 3.65, bannerTexture(true));
  box(3.18, .27, .08, 0, 1.0, .05, back); face(3.12, .25, 1.0, band);
  for (const px of [-1.57, 1.57]) for (const py of [1.24, 3.56, 3.91]) {
    const bolt = add(new THREE.CylinderGeometry(.014, .014, .014, 10), steel, px, py, .135);
    bolt.rotation.x = Math.PI / 2;
  }
  for (const py of [1.48, 3.26]) box(3.35, .10, .12, 0, py, -.14);
  const cx = -1.12, cz = .65, cy = sample(cx, cz);
  box(.46, .045, .46, cx, cy + .025, cz, orange);
  add(new THREE.ConeGeometry(.19, .7, 16), orange, cx, cy + .38, cz);
  add(new THREE.CylinderGeometry(.086, .114, .10, 16), white, cx, cy + .37, cz);
  addBaseTrailMapCollider(colliders, height);
  return group;
}
