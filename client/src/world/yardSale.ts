// A yard sale: after a spectacular fall, skis and poles lie scattered across the snow until the skier
// gets up and collects them.
import * as THREE from 'three/webgpu';
import { skiPole, skiWithBindings } from '../skier/skiEquipment';

export class YardSale {
  readonly group = new THREE.Group();
  active = false;
  constructor() { this.group.name = 'yard-sale'; this.group.visible = false; }

  /** Scatter the gear ahead of the landing, along the direction of travel. */
  scatter(at: { x: number; z: number }, dir: { x: number; z: number }, height: (x: number, z: number) => number) {
    this.clear();
    const n = Math.hypot(dir.x, dir.z) || 1, fx = dir.x / n, fz = dir.z / n, sx = -fz, sz = fx;
    const items: [THREE.Object3D, number, number, boolean][] = [
      [skiWithBindings(), 2.8, -1.1, false], [skiWithBindings(), 5.2, 1.6, false],
      [skiPole(), 1.6, 1.4, true], [skiPole(), 4.0, -2.3, true],
    ];
    for (const [o, ahead, side, pole] of items) {
      const x = at.x + fx * ahead + sx * side, z = at.z + fz * ahead + sz * side;
      o.position.set(x, height(x, z) + (pole ? 0.03 : 0.02), z);
      if (pole) o.rotation.order = 'YXZ';
      o.rotation.set(pole ? Math.PI / 2 : 0, Math.random() * Math.PI * 2, pole ? 0 : (Math.random() - 0.5) * 0.4);
      o.traverse((m) => { m.castShadow = true; });
      this.group.add(o);
    }
    this.group.visible = true; this.active = true;
  }

  /** Strew the gear along the slide from where the skier landed to where they stopped. */
  strew(from: { x: number; z: number }, to: { x: number; z: number }, dir: { x: number; z: number }, height: (x: number, z: number) => number) {
    const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz);
    if (d < 3) { this.scatter(to, dir, height); return; }
    this.clear();
    const sx = -dz / d, sz = dx / d;
    const items: [THREE.Object3D, number, number, boolean][] = [
      [skiPole(), 0.12, 1.2, true], [skiWithBindings(), 0.35, -1.0, false], [skiWithBindings(), 0.62, 1.3, false], [skiPole(), 0.85, -0.8, true],
    ];
    for (const [o, k, side, pole] of items) {
      const x = from.x + dx * k + sx * side, z = from.z + dz * k + sz * side;
      o.position.set(x, height(x, z) + (pole ? 0.03 : 0.02), z);
      if (pole) o.rotation.order = 'YXZ';
      o.rotation.set(pole ? Math.PI / 2 : 0, Math.random() * Math.PI * 2, pole ? 0 : (Math.random() - 0.5) * 0.4);
      o.traverse((m) => { m.castShadow = true; });
      this.group.add(o);
    }
    this.group.visible = true; this.active = true;
  }

  clear() { this.group.clear(); this.group.visible = false; this.active = false; }
}
