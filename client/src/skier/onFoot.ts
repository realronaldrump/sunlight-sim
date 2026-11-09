// On foot: skis off, walking around the base area and through the lodge in ski boots. Owns the
// walker state, the pedestrian model and a third/first-person camera that respects walls and ceilings.
import * as THREE from 'three/webgpu';
import { createWalker, stepWalker, supportHeight, type WalkState } from '../../../shared/walk';
import type { ColliderGrid, Collider } from '../../../shared/collision';
import { walkable } from '../world/walkable';
import { PedestrianModel } from '../world/pedestrian';

export interface WalkControls { forward: number; right: number; run: boolean }

export class OnFoot {
  active = false;
  st: WalkState = createWalker(0, 0, 0, 0);
  readonly model: PedestrianModel;
  firstPerson = false;
  private yaw = 0;          // camera azimuth (same convention as heading: 0 looks toward -z)
  private pitch = 0.22;     // rad, positive looks down at the walker
  private dist = 3.3;
  private dragging = false;
  private userYawTime = 0;
  private time = 0;
  private camPos = new THREE.Vector3();
  private hits: Collider[] = [];

  constructor(scene: THREE.Scene, private terrain: (x: number, z: number) => number, private colliders: ColliderGrid,
    private camera: THREE.PerspectiveCamera, dom: HTMLElement, jacket: THREE.Color) {
    this.model = new PedestrianModel({ jacket, hat: 'helmet' });
    this.model.root.visible = false;
    scene.add(this.model.root);
    let lx = 0, ly = 0;
    dom.addEventListener('mousedown', (e) => { if (!this.active) return; this.dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging || !this.active) return;
      this.yaw -= (e.clientX - lx) * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - ly) * 0.004, -0.5, 1.2);
      this.userYawTime = 2.5;
      lx = e.clientX; ly = e.clientY;
    });
    dom.addEventListener('wheel', (e) => { if (this.active) this.dist = THREE.MathUtils.clamp(this.dist * (1 + Math.sign(e.deltaY) * 0.1), 1.6, 12); }, { passive: true });
  }

  setJacket(c: THREE.ColorRepresentation) { this.model.setJacket(c); }

  enter(x: number, y: number, z: number, heading: number) {
    this.st = createWalker(x, y, z, heading);
    this.yaw = heading; this.pitch = 0.22; this.active = true; this.model.root.visible = true;
    this.camPos.set(1e9, 0, 0);
  }

  exit() { this.active = false; this.model.root.visible = false; this.dragging = false; }

  /** True when standing on open snow where skis can be clicked back on. */
  canClickIn() { return this.st.onSnow && !this.st.indoor && this.st.grounded; }

  update(dt: number, c: WalkControls) {
    if (!this.active) return;
    this.time += dt;
    // controls are relative to the camera view, like any third-person walk
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    const ix = fx * c.forward + rx * c.right, iz = fz * c.forward + rz * c.right;
    const terrain = this.terrain;
    stepWalker(this.st, { x: ix, z: iz, run: c.run }, terrain, walkable.surfaces, this.colliders, dt);
    // the camera drifts behind the walker unless the player has just looked around
    this.userYawTime = Math.max(0, this.userYawTime - dt);
    if (this.st.speed > 0.4 && this.userYawTime === 0 && !this.firstPerson && Math.abs(c.right) < 0.5) {
      let d = this.st.heading - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 1.6);
    }
    const st = this.st;
    this.model.root.position.set(st.pos.x, st.pos.y, st.pos.z);
    this.model.root.rotation.set(0, st.heading, 0);
    this.model.update({ mode: st.speed > 0.15 ? 'walk' : 'stand', stride: st.stride, speed: st.speed, time: this.time, carry: true });
    this.model.root.visible = !this.firstPerson;
    this.updateCamera(dt);
  }

  private blocked(p: THREE.Vector3) {
    for (const c of this.colliders.query(p.x, p.z, this.hits)) {
      if (p.y > c.top || (c.bottom !== undefined && p.y < c.bottom)) continue;
      if (c.type === 'cyl') { if (Math.hypot(p.x - c.x, p.z - c.z) < c.r! + 0.15) return true; }
      else {
        const cs = Math.cos(c.yaw ?? 0), sn = Math.sin(c.yaw ?? 0), dx = p.x - c.x, dz = p.z - c.z;
        if (Math.abs(cs * dx - sn * dz) < c.hx! + 0.15 && Math.abs(sn * dx + cs * dz) < c.hz! + 0.15) return true;
      }
    }
    return false;
  }

  private updateCamera(dt: number) {
    const st = this.st, cam = this.camera;
    const head = new THREE.Vector3(st.pos.x, st.pos.y + 1.62, st.pos.z);
    const room = walkable.surfaces.indoor(st.pos.x, st.pos.y + 0.9, st.pos.z);
    if (this.firstPerson) {
      cam.position.copy(head).add(new THREE.Vector3(-Math.sin(this.yaw) * 0.12, 0, -Math.cos(this.yaw) * 0.12));
      cam.rotation.set(-this.pitch * 0.9 + 0.1, this.yaw, 0, 'YXZ');
      return;
    }
    const pivot = head.clone().add(new THREE.Vector3(0, -0.1, 0));
    const back = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    let d = room ? Math.min(this.dist, 2.6) : this.dist;
    // pull the camera in front of walls, rails and trees between it and the walker's head
    const probe = new THREE.Vector3();
    for (let s = 0.3; s <= d; s += 0.15) {
      probe.copy(pivot).addScaledVector(back, s);
      if (this.blocked(probe)) { d = Math.max(0.35, s - 0.25); break; }
    }
    const want = pivot.clone().addScaledVector(back, d);
    if (room) want.y = Math.min(want.y, room.y1 - 0.18);
    const sup = supportHeight(want.x, want.z, want.y, this.terrain, walkable.surfaces);
    if (sup && want.y < sup.h + 0.4) want.y = sup.h + 0.4;
    if (this.camPos.x > 1e8 || this.camPos.distanceTo(want) > 6) this.camPos.copy(want);
    else this.camPos.lerp(want, Math.min(1, dt * 10));
    cam.position.copy(this.camPos);
    cam.lookAt(pivot.x, pivot.y - 0.05, pivot.z);
  }
}
