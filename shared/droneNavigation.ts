import { DRONE, NO_DRONE_INPUT, type DroneInput, type DroneState, type FlightArea, type FlightWorld } from './dronePhysics';
import type { Vec3 } from './skiPhysics';

export type FlightPace = 'gentle' | 'cruise' | 'fast';
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

/** Direct scene navigation uses the same acceleration, clearance and collision solver as manual flight. */
export class DroneNavigation {
  target: Vec3 | null = null;
  message = '';
  pace: FlightPace = 'gentle';
  private stalled = 0;
  private bestDistance = Infinity;

  setTarget(target: Vec3, world: FlightWorld, area: FlightArea) {
    const p = { ...target }; area.constrain(p);
    const ground = world.height(p.x, p.z);
    p.y = clamp(p.y, ground + 12, ground + DRONE.ceiling - 2);
    this.target = p; this.stalled = 0; this.bestDistance = Infinity; this.message = 'Flying to marker';
  }
  stop(message = 'Hovering') { this.target = null; this.stalled = 0; this.message = message; }

  input(s: DroneState, world: FlightWorld, dt: number): DroneInput {
    const input = { ...NO_DRONE_INPUT, precision: this.pace === 'gentle', fast: this.pace === 'fast' };
    const target = this.target; if (!target) return input;
    // Re-sample after streaming: a coarse tap must never become a below-ground destination.
    target.y = clamp(target.y, world.height(target.x,target.z)+12, world.height(target.x,target.z)+DRONE.ceiling-2);
    const dx = target.x-s.pos.x, dz = target.z-s.pos.z, distance = Math.hypot(dx,dz);
    const maxSpeed = input.precision ? DRONE.precisionSpeed : input.fast ? DRONE.fastSpeed : DRONE.normalSpeed;
    // Ease into the destination instead of overshooting and oscillating. Sample the
    // approach for a hill/roof and climb before moving into its collision envelope.
    let safeHeight = target.y;
    const ahead = Math.min(distance, Math.max(6, s.speed * 2));
    for (let i = 0; i <= 4; i++) {
      const k = distance > .01 ? ahead * i / 4 / distance : 0;
      const x = s.pos.x + dx*k, z = s.pos.z + dz*k;
      safeHeight = Math.max(safeHeight, world.height(x,z)+8);
      for (const obstacle of world.obstacles?.(x,z) ?? []) {
        if (Math.hypot(obstacle.x-x,obstacle.z-z) < (obstacle.r ?? Math.hypot(obstacle.hx ?? 0,obstacle.hz ?? 0))+2)
          safeHeight = Math.max(safeHeight, obstacle.top+3);
      }
    }
    safeHeight = Math.min(safeHeight, world.height(s.pos.x,s.pos.z)+DRONE.ceiling-2);
    const dy = safeHeight-s.pos.y;
    if (distance < .7 && Math.abs(dy) < .6 && s.speed < .7) { this.stop('Arrived · hovering'); return { ...input, brake: true }; }
    const magnitude = Math.min(1, distance * .85 / maxSpeed) * (dy > 5 ? .15 : 1);
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    input.forward = distance > .01 ? (dx*fx+dz*fz)/distance*magnitude : 0;
    input.right = distance > .01 ? (dx*-fz+dz*fx)/distance*magnitude : 0;
    input.up = clamp(dy*.8 / (input.precision ? 2 : DRONE.climbSpeed),-1,1);
    // Dragging can cancel this auto-heading at any time; there is no hidden persistent steering.
    const yaw = Math.atan2(-dx,-dz), turn = Math.atan2(Math.sin(yaw-s.yaw), Math.cos(yaw-s.yaw));
    input.yaw = distance > 2 ? clamp(turn*1.4,-.7,.7) : 0;
    const remaining = Math.hypot(distance,dy);
    if (remaining < this.bestDistance-.2) { this.bestDistance = remaining; this.stalled = 0; }
    else this.stalled += Math.max(0,dt);
    this.message = s.warning === 'loading' ? 'Waiting for terrain' : dy > 5 ? 'Climbing for clearance' : 'Flying to marker';
    if (this.stalled > 8) { this.stop('Path blocked · tap a closer destination'); return { ...input, brake:true }; }
    return input;
  }
}
