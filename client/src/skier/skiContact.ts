import * as THREE from 'three/webgpu';

export interface SkiContact { offset: number; pitch: number }
export interface SnowSurface { height(x: number, z: number): number }

/** Each ski follows its own patch of measured snow, in the slope-aligned rig's local frame. */
export class SkiContacts {
  readonly feet: SkiContact[] = [{ offset: 0, pitch: 0 }, { offset: 0, pitch: 0 }];
  private point = new THREE.Vector3();
  private up = new THREE.Vector3();

  sample(root: THREE.Object3D, ankles: THREE.Vector3[], yaw: number[], snow: SnowSurface) {
    const upY = this.up.set(0, 1, 0).applyQuaternion(root.quaternion).y;
    for (let i = 0; i < 2; i++) {
      const ankle = ankles[i], c = Math.cos(yaw[i]), s = Math.sin(yaw[i]);
      const residual = (along: number) => {
        const p = this.point.set(ankle.x + s * along, 0, ankle.z - .05 + c * along)
          .multiply(root.scale).applyQuaternion(root.quaternion).add(root.position);
        // Vertical height residual projected onto the local surface normal, in unscaled rig meters.
        return (snow.height(p.x, p.z) - p.y) * upY / root.scale.y;
      };
      const tip = residual(-.65), boot = residual(0), tail = residual(.65);
      const pitch = THREE.MathUtils.clamp(Math.atan2(tip - tail, 1.3), -.24, .24);
      const offset = Math.max(boot, tip - .65 * Math.tan(pitch), tail + .65 * Math.tan(pitch));
      this.feet[i].offset = THREE.MathUtils.clamp(offset + .026, -.16, .28);
      this.feet[i].pitch = pitch;
    }
    return this.feet;
  }
}
