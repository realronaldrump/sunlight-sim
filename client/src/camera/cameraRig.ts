// Camera modes: chase (third person), first person, and side profile (best for judging steepness).
import * as THREE from 'three/webgpu';

export type CamMode = 'chase' | 'first' | 'side';
interface BodyMotion { pitch: number; roll: number; airborne: boolean; fallen: boolean; impact: number }

export class CameraRig {
  enabled = true;
  mode: CamMode = 'chase';
  private yawOffset = 0;
  private pitchOffset = 0;
  private smoothDir = new THREE.Vector3(0, 0, -1);
  private pos = new THREE.Vector3();
  private initialized = false;
  private wasAirborne = false;
  private impactTime = 10;
  private impactStrength = 0;
  distance = 6.5;
  private dragging = false;
  /** Optional obstacle test for camera placement. */
  blocked: ((x: number, z: number) => boolean) | null = null;

  constructor(public camera: THREE.PerspectiveCamera, dom: HTMLElement, private ground: (x: number, z: number) => number) {
    let lx = 0, ly = 0;
    dom.addEventListener('mousedown', (e) => { if (!this.enabled) return; this.dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging || !this.enabled) return;
      this.yawOffset -= (e.clientX - lx) * 0.005;
      this.pitchOffset = THREE.MathUtils.clamp(this.pitchOffset + (e.clientY - ly) * 0.004, -0.6, 1.0);
      lx = e.clientX; ly = e.clientY;
    });
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      this.distance = THREE.MathUtils.clamp(this.distance * (1 + Math.sign(e.deltaY) * 0.1), 2.5, 40);
    }, { passive: true });
  }

  reset() { this.initialized = false; this.dragging = false; this.yawOffset = 0; this.pitchOffset = 0; }

  cycle() {
    this.mode = this.mode === 'chase' ? 'first' : this.mode === 'first' ? 'side' : 'chase';
    this.yawOffset = 0; this.pitchOffset = 0; this.initialized = false;
    return this.mode;
  }

  /**
   * @param target skier feet position
   * @param heading ski heading (rad)
   * @param vel velocity
   * @param fallLine horizontal unit vector pointing downhill (for side view)
   */
  update(dt: number, target: THREE.Vector3, heading: number, vel: THREE.Vector3, fallLine: THREE.Vector3, riding: boolean, motion?: BodyMotion) {
    const cam = this.camera;
    if (this.wasAirborne && motion?.fallen) { this.impactTime = 0; this.impactStrength = Math.min(1, motion.impact / 12); }
    this.wasAirborne = !!motion?.airborne;
    this.impactTime += dt;
    const impact = -.15 * this.impactStrength * Math.exp(-this.impactTime * 8) * Math.sin(this.impactTime * 22);
    const speed = Math.hypot(vel.x, vel.z);
    // desired view direction: travel direction when moving, ski heading when slow
    const want = speed > 2 && !riding ? new THREE.Vector3(vel.x, 0, vel.z).normalize()
      : new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading));
    const k = Math.min(1, dt * (speed > 2 ? 2.2 : 1.2));
    if (!this.initialized || this.smoothDir.dot(want) < -0.9) this.smoothDir.copy(want);
    else this.smoothDir.lerp(want, k).normalize();
    if (!this.dragging) { this.yawOffset *= Math.pow(0.4, dt); }
    const dir = this.smoothDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yawOffset);

    if (this.mode === 'first') {
      const offset = new THREE.Vector3(0, riding ? 1.15 : motion?.fallen ? .48 : 1.62, 0);
      if (riding || motion?.airborne) offset.applyEuler(new THREE.Euler(motion?.pitch ?? 0, heading, motion?.roll ?? 0, 'YXZ'));
      const eye = target.clone().add(offset).addScaledVector(dir, 0.15);
      eye.y += impact;
      eye.y = Math.max(eye.y, this.ground(eye.x, eye.z) + .3);
      cam.position.copy(eye);
      const look = eye.clone().addScaledVector(dir, 10);
      look.y += -this.pitchOffset * 6 - 1.2;
      cam.lookAt(look);
      cam.rotateZ((motion?.roll ?? 0) * (riding ? .7 : .3));
      this.initialized = false;
      return;
    }

    let desired: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.mode === 'side') {
      // look across the fall line so the slope profile is seen side-on
      const fl = fallLine.lengthSq() > 1e-4 ? fallLine.clone().normalize() : dir.clone();
      const side = new THREE.Vector3(-fl.z, 0, fl.x);
      // pick the side whose camera spot is free of obstacles (buildings, huts, dense trees)
      if (this.blocked) {
        const a = target.clone().addScaledVector(side, this.distance * 2.2), b = target.clone().addScaledVector(side, -this.distance * 2.2);
        if (this.blocked(a.x, a.z) && !this.blocked(b.x, b.z)) side.negate();
      }
      desired = target.clone().addScaledVector(side, this.distance * 2.2).add(new THREE.Vector3(0, 1.2 + this.pitchOffset * 4, 0));
      look = target.clone().add(new THREE.Vector3(0, 1.0, 0));
    } else if (riding) {
      // beside and behind the chair so the hanger does not block the view up the lift line
      const right = new THREE.Vector3(-dir.z, 0, dir.x);
      desired = target.clone().addScaledVector(dir, -this.distance * 0.7).addScaledVector(right, -3.2)
        .add(new THREE.Vector3(0, 1.6 + this.pitchOffset * 4, 0));
      look = target.clone().add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(dir, 8);
    } else {
      const height = 2.2 + this.pitchOffset * this.distance * 0.6;
      desired = target.clone().addScaledVector(dir, -this.distance).add(new THREE.Vector3(0, height, 0));
      look = target.clone().add(new THREE.Vector3(0, 1.1, 0)).addScaledVector(dir, 3);
    }
    // keep the camera above the snow
    const g = this.ground(desired.x, desired.z);
    if (desired.y < g + 1.0) desired.y = g + 1.0;
    if (riding && this.mode === 'chase') { this.pos.copy(desired); this.initialized = true; }
    if (!this.initialized) { this.pos.copy(desired); this.initialized = true; }
    this.pos.lerp(desired, Math.min(1, dt * 6));
    const g2 = this.ground(this.pos.x, this.pos.z);
    if (this.pos.y < g2 + 0.8) this.pos.y = g2 + 0.8;
    cam.position.copy(this.pos);
    cam.lookAt(look);
    cam.position.y += impact;
  }
}
