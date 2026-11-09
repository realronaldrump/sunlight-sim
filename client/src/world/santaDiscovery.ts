import type { Collider, ColliderGrid } from '../../../shared/collision';
import { coversPoint } from '../../../shared/mountainGuestNavigation';
import type { Vec3 } from '../../../shared/skiPhysics';

export const SANTA_ACHIEVEMENT = 'Santa Sighting';
export const SANTA_ACHIEVEMENT_KEY = 'sunlight.santa-sighting.v1';
export const SIGHTING_RANGE = 23;

/** Near enough to recognize him and actually looking at him for a moment. */
export class SantaDiscovery {
  private sightTime = 0;
  foundAt: number | null;

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null) { this.foundAt = this.read(); }

  private read() {
    try {
      const t = Number(this.storage?.getItem(SANTA_ACHIEVEMENT_KEY));
      if (Number.isFinite(t) && t > 0) return t;
    } catch { /* storage blocked */ }
    return null;
  }

  update(dt: number, inView: boolean) {
    if (this.foundAt) return false;
    this.sightTime = inView ? this.sightTime + Math.min(dt, .1) : 0;
    if (this.sightTime < .72) return false;
    const earlier = this.read();
    this.foundAt = earlier ?? Date.now();
    try { if (!earlier) this.storage?.setItem(SANTA_ACHIEVEMENT_KEY, String(this.foundAt)); } catch { /* storage blocked */ }
    return !earlier;
  }
}

export function sightLine(from: Vec3, to: Vec3, ground: (x: number, z: number) => number, colliders: ColliderGrid, nearby: Collider[] = []) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const steps = Math.ceil(Math.hypot(dx, dy, dz) / .32);
  // Check the terrain and the same solid trunks and structures used by the skier.
  for (let i = 1; i < steps; i++) {
    const t = i / steps, x = from.x + dx * t, y = from.y + dy * t, z = from.z + dz * t;
    if (y < ground(x, z) - .06) return false;
    if (colliders.query(x, z, nearby).some(c => y <= c.top && (c.bottom === undefined || y >= c.bottom) && coversPoint(c, x, z))) return false;
  }
  return true;
}
