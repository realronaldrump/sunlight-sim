// Snowcats grooming after last chair. Each works one groomed run in overlapping passes, down and back
// up, on the shared resort clock, with headlights, a work-light bar and an amber beacon. Behind the
// tiller the corduroy is restored: traffic wear is cleared and old ski tracks disappear.
import * as THREE from 'three/webgpu';
import type { RunInfo } from '../game';
import type { TerrainProbe, Vec3 } from '../../../shared/skiPhysics';
import { Route } from './lesson';

const SPEED = 3.0;          // m/s, a working groomer
const TURN = 18;            // s to stop, pivot and line up the next pass
const PASSES = [-4.6, 0, 4.6, -2.3, 2.3];
const TILLER_BACK = 4.6;    // m from the cat's centre to the tiller
export const GROOM_HALF_WIDTH = 2.9;

const red = new THREE.MeshStandardNodeMaterial({ color: 0xc0161d, roughness: 0.45, metalness: 0.1 });
const dark = new THREE.MeshStandardNodeMaterial({ color: 0x1b1c1f, roughness: 0.8 });
const steel = new THREE.MeshStandardNodeMaterial({ color: 0x8d949b, roughness: 0.4, metalness: 0.75 });
const glass = new THREE.MeshStandardNodeMaterial({ color: 0x14202a, roughness: 0.08, metalness: 0.6 });
const rubber = new THREE.MeshStandardNodeMaterial({ color: 0x232426, roughness: 0.95 });
const lens = new THREE.MeshStandardNodeMaterial({ color: 0xfff6dc, emissive: new THREE.Color(0xfff2cc), emissiveIntensity: 0 });
const beaconMat = new THREE.MeshStandardNodeMaterial({ color: 0xff8a00, emissive: new THREE.Color(0xff7a00), emissiveIntensity: 0, transparent: true, opacity: 0.9 });

function box(w: number, h: number, l: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
}

/** A PistenBully-style groomer, about 4.2 m over the tracks with a 5.4 m blade and 5.8 m tiller. Faces -z. */
export function buildSnowcat() {
  const g = new THREE.Group(); g.name = 'snowcat';
  // tracks with idler wheels at both ends
  for (const s of [-1, 1]) {
    box(1.15, 0.85, 4.1, rubber, s * 1.55, 0.5, 0, g);
    for (const z of [-2.05, 2.05]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 1.15, 20), rubber);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(s * 1.55, 0.5, z); wheel.castShadow = true; g.add(wheel);
    }
    for (let z = -1.8; z <= 1.8; z += 0.3) box(1.17, 0.05, 0.08, dark, s * 1.55, 0.94, z, g); // grousers on top
  }
  box(2.3, 0.9, 3.9, red, 0, 1.35, 0.3, g);                     // engine deck and chassis
  box(2.2, 0.15, 3.9, dark, 0, 0.9, 0.3, g);
  const cab = new THREE.Group(); cab.position.set(0, 1.8, -0.75); g.add(cab);
  box(2.1, 1.35, 1.9, red, 0, 0.68, 0, cab);
  box(2.13, 0.62, 1.6, glass, 0, 0.85, -0.05, cab);              // window band all round
  box(1.8, 0.62, 0.05, glass, 0, 0.85, -0.97, cab);
  box(2.2, 0.08, 2.0, dark, 0, 1.39, 0, cab);                    // roof
  // roof light bar: six work lights, plus the amber beacon
  box(1.9, 0.12, 0.18, dark, 0, 1.5, -0.85, cab);
  const lamps: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) { const l = box(0.2, 0.14, 0.06, lens, -0.8 + i * 0.32, 1.5, -0.95, cab); lamps.push(l); }
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 14), beaconMat); beacon.position.set(0.7, 1.55, 0.6); cab.add(beacon);
  // headlights on the front of the deck
  for (const s of [-1, 1]) box(0.32, 0.18, 0.06, lens, s * 0.85, 1.55, -1.62, g);
  // exhaust
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 10), steel); stack.position.set(-0.85, 2.3, 0.9); g.add(stack);
  // twelve-way blade on push arms
  for (const s of [-1, 1]) box(0.14, 0.14, 1.4, steel, s * 0.9, 0.85, -2.6, g);
  const blade = box(5.4, 1.15, 0.12, steel, 0, 0.7, -3.35, g); blade.rotation.x = -0.12;
  box(5.4, 0.08, 0.35, steel, 0, 0.15, -3.3, g);
  // rear tiller with its comb finisher, which lays the corduroy
  for (const s of [-1, 1]) box(0.14, 0.14, 1.2, steel, s * 0.8, 0.8, 2.75, g);
  box(5.8, 0.7, 0.75, dark, 0, 0.5, 3.6, g);
  box(5.8, 0.1, 0.55, red, 0, 0.9, 3.6, g);
  const comb = box(5.7, 0.05, 1.0, rubber, 0, 0.08, 4.35, g); comb.rotation.x = 0.08;
  return { root: g, lamps, beacon };
}

interface Cat { root: THREE.Group; beacon: THREE.Mesh; route: Route; phase: number; pool: THREE.Mesh; name: string; x: number; z: number; heading: number; tillerX: number; tillerZ: number; active: boolean }

export class Snowcats {
  readonly group = new THREE.Group();
  readonly cats: Cat[] = [];
  private normal: Vec3 = { x: 0, y: 1, z: 0 };
  private basis = new THREE.Matrix4();
  private groomTimer = 0;
  /** Called under each working tiller (restore corduroy, erase tracks). */
  onGroom: ((x: number, z: number, halfWidth: number) => void) | null = null;

  constructor(runs: RunInfo[], private probe: TerrainProbe, routes = ['Midway', 'Loop', 'Sun King']) {
    this.group.name = 'snowcats';
    const poolTex = radialTexture();
    routes.forEach((name, i) => {
      const run = runs.filter((r) => r.name === name && r.kind === 'line').sort((a, b) => b.points.length - a.points.length)[0];
      if (!run) return;
      const route = new Route(run.points.map((p) => ({ x: p[0], z: p[2] })), 3);
      const cat = buildSnowcat();
      cat.root.name = `snowcat-${name}`;
      // pool of headlight on the snow ahead
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 15), new THREE.MeshBasicNodeMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff0d0 }));
      pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.18, -11.5); pool.renderOrder = 2;
      (pool.material as THREE.Material).polygonOffset = true; (pool.material as THREE.Material).polygonOffsetFactor = -2;
      cat.root.add(pool);
      cat.root.visible = false;
      this.group.add(cat.root);
      this.cats.push({ root: cat.root, beacon: cat.beacon, route, phase: i * 397, pool, name, x: 0, z: 0, heading: 0, tillerX: 0, tillerZ: 0, active: false });
    });
  }

  /** Grooming happens after the lifts close and the patrol sweep, and before they open. */
  static working(hour: number) { return hour >= 16.4 || hour < 8.5; }

  /** Position of a cat at resort time `now` (seconds): passes down and up its run with turnarounds. */
  private place(c: Cat, now: number) {
    const L = c.route.length, pass = L / SPEED + TURN, cycle = pass * PASSES.length;
    const t = ((now + c.phase) % cycle + cycle) % cycle;
    const k = Math.floor(t / pass), u = t - k * pass;
    const down = k % 2 === 0, off = PASSES[k];
    const drive = Math.min(u, L / SPEED);
    let s = down ? drive * SPEED : L - drive * SPEED;
    const turning = u > L / SPEED;
    const p = c.route.at(Math.max(0, Math.min(L, s)));
    const dir = down ? 1 : -1;
    let tx = p.tx * dir, tz = p.tz * dir;
    if (turning) {
      // pivot to face back along the run for the next pass
      const f = (u - L / SPEED) / TURN, a = Math.atan2(tx, tz) + Math.PI * f;
      tx = Math.sin(a); tz = Math.cos(a);
      s = down ? L : 0;
    }
    c.x = p.x - p.tz * off; c.z = p.z + p.tx * off;
    c.heading = Math.atan2(-tx, -tz);
    c.tillerX = c.x - tx * TILLER_BACK; c.tillerZ = c.z - tz * TILLER_BACK;
    return !turning;
  }

  update(dt: number, now: number, hour: number, night: number, camera: THREE.Vector3) {
    const working = Snowcats.working(hour);
    this.groomTimer += dt;
    const groomNow = this.groomTimer > 0.25;
    if (groomNow) this.groomTimer = 0;
    lens.emissiveIntensity = 0.6 + 7 * night;
    beaconMat.emissiveIntensity = (0.5 + 0.5 * Math.sin(now * 7.5)) * (2 + 6 * night);
    for (const c of this.cats) {
      c.active = working;
      if (!working) { c.root.visible = false; continue; }
      const driving = this.place(c, now);
      const d = Math.hypot(c.x - camera.x, c.z - camera.z);
      c.root.visible = d < 2500;
      if (groomNow && driving) this.onGroom?.(c.tillerX, c.tillerZ, GROOM_HALF_WIDTH);
      if (!c.root.visible) continue;
      const y = this.probe.height(c.x, c.z);
      c.root.position.set(c.x, y, c.z);
      // sit on the snow: align the hull with the slope under it
      const n = this.probe.normal(c.x, c.z, this.normal);
      const up = new THREE.Vector3(n.x, n.y, n.z).normalize();
      const fwd = new THREE.Vector3(-Math.sin(c.heading), 0, -Math.cos(c.heading));
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
      this.basis.makeBasis(right, up, fwd.clone().negate());
      c.root.quaternion.setFromRotationMatrix(this.basis);
      (c.pool.material as THREE.MeshBasicNodeMaterial).opacity = 0.45 * night;
      c.pool.visible = night > 0.05;
      c.beacon.rotation.y = now * 6;
    }
  }

  /** For tests and the status board. */
  positions() { return this.cats.map((c) => ({ name: c.name, x: c.x, z: c.z, active: c.active })); }
}

function radialTexture() {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
  const g = cv.getContext('2d')!;
  // an ellipse that fades to nothing before every edge of the quad, brightest nearer the cat
  g.scale(1, 2);
  const grad = g.createRadialGradient(32, 36, 1, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.5, 'rgba(255,255,255,.4)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
