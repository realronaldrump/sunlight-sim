// Missed-unload gates: an orange wand on a post just past the end of each top unload ramp, at the
// height of a seated rider's skis. A rider who stays seated clips it; the wand whips forward and springs
// back. (On a real lift it would stop the lift; the sim plays it for laughs, see shared/missedUnload.)
import * as THREE from 'three/webgpu';
import { SEAT_SPACING, UNLOAD_OFFSET, UNLOAD_WINDOW, type LiftPath } from '../../../shared/lifts';

interface Gate { pivot: THREE.Group; hit: number; at: THREE.Vector3 }

export class MissedUnloadGates {
  readonly group = new THREE.Group();
  private gates: Gate[] = [];

  constructor(paths: LiftPath[], height: (x: number, z: number) => number) {
    this.group.name = 'missed-unload-gates';
    const post = new THREE.MeshStandardNodeMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.6 });
    const orange = new THREE.MeshStandardNodeMaterial({ color: 0xff6a13, roughness: 0.45 });
    const white = new THREE.MeshStandardNodeMaterial({ color: 0xf2f2f0, roughness: 0.5 });
    const sign = new THREE.MeshStandardNodeMaterial({ map: signTexture(), roughness: 0.6 });
    for (const path of paths) {
      const h = path.horiz - UNLOAD_OFFSET + UNLOAD_WINDOW.after + 0.35;
      const reach = path.def.seats * SEAT_SPACING / 2 + 0.55, rope = path.ropePoint(h, 1);
      const x = rope.x + path.rx * reach, z = rope.z + path.rz * reach, y = height(x, z);
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = Math.atan2(path.rx, path.rz);
      // local +z points away from the lift line (the post stands outside the seats), +x uphill; the wand reaches back across the seats
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.3, 10), post); p.position.y = 0.65; g.add(p);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), sign); plate.position.set(-0.07, 1.05, 0); plate.rotation.y = -Math.PI / 2; g.add(plate);
      const pivot = new THREE.Group(); pivot.position.set(0, 0.58, 0); g.add(pivot);
      const length = path.def.seats * SEAT_SPACING + 1.0;
      for (let i = 0; i < 6; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, length / 6, 8), i % 2 ? white : orange);
        seg.rotation.x = Math.PI / 2; seg.position.z = -(i + 0.5) * length / 6; pivot.add(seg);
      }
      for (const m of g.children) m.castShadow = true;
      this.group.add(g);
      this.gates.push({ pivot, hit: Infinity, at: new THREE.Vector3(rope.x, y + 0.7, rope.z) });
    }
  }

  /** The skis clip the wand: it whips forward and springs back. */
  trigger(lift: number) { const g = this.gates[lift]; if (g) g.hit = 0; }
  /** Where the comic "BONK!" goes. */
  position(lift: number) { return this.gates[lift]?.at; }

  update(dt: number) {
    for (const g of this.gates) {
      if (!Number.isFinite(g.hit)) continue;
      g.hit += dt;
      const a = 1.35 * Math.exp(-2.4 * g.hit) * Math.cos(9 * g.hit);
      g.pivot.rotation.y = -Math.max(-0.5, a);
      if (g.hit > 4) { g.hit = Infinity; g.pivot.rotation.y = 0; }
    }
  }
}

function signTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 180;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffd400'; g.fillRect(0, 0, 256, 180); g.strokeStyle = '#111'; g.lineWidth = 10; g.strokeRect(5, 5, 246, 170);
  g.fillStyle = '#111'; g.font = 'bold 42px Helvetica, Arial, sans-serif'; g.textAlign = 'center';
  g.fillText('UNLOAD', 128, 70); g.fillText('HERE!', 128, 130);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
