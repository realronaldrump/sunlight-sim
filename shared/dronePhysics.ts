// Stabilized camera-drone flight in meters. Independent of rendering and browser input.
import type { Vec3 } from './skiPhysics';
import type { Collider } from './collision';

export const DRONE = { normalSpeed: 12, fastSpeed: 16, precisionSpeed: 3, climbSpeed: 5,
  acceleration: 7, braking: 11, clearance: 1.4, ceiling: 120, radius: .32, boundaryMargin: 60 } as const;
export interface DroneInput { forward: number; right: number; up: number; yaw: number; pitch: number; fast: boolean; precision: boolean; brake: boolean }
export const NO_DRONE_INPUT: DroneInput = { forward: 0, right: 0, up: 0, yaw: 0, pitch: 0, fast: false, precision: false, brake: false };
export type FlightWarning = '' | 'boundary' | 'ceiling' | 'ground' | 'obstacle' | 'loading';
export interface DroneState {
  pos: Vec3; vel: Vec3; yaw: number; pitch: number; bank: number; tilt: number;
  speed: number; agl: number; rpm: number[]; warning: FlightWarning;
}
export interface FlightWorld {
  height(x: number, z: number): number;
  ready?(x: number, z: number): boolean;
  obstacles?(x: number, z: number): Collider[];
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const wrapAngle = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));

/** Actual resort polygon plus a modest launch/viewing apron, not its large rectangular map. */
export class FlightArea {
  readonly points: { x: number; z: number }[];
  constructor(points: number[][], public margin: number = DRONE.boundaryMargin) {
    this.points = points.filter(p => p.length >= 3 && Number.isFinite(p[0]) && Number.isFinite(p[2])).map(p => ({ x: p[0], z: p[2] }));
    if (this.points.length < 3) throw new Error('A ski-area polygon is required for drone flight');
  }
  nearest(x: number, z: number) {
    let inside = false, distance = Infinity, nx = x, nz = z;
    for (let i = 0, j = this.points.length - 1; i < this.points.length; j = i++) {
      const a = this.points[j], b = this.points[i], dx = b.x-a.x, dz = b.z-a.z;
      if ((a.z > z) !== (b.z > z) && x < (b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x) inside = !inside;
      const k = clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz || 1), 0, 1);
      const px = a.x+dx*k, pz = a.z+dz*k, d = Math.hypot(x-px,z-pz);
      if (d < distance) { distance = d; nx = px; nz = pz; }
    }
    return { x: nx, z: nz, inside, distance, remaining: inside ? this.margin+distance : this.margin-distance };
  }
  contains(x: number, z: number) { return this.nearest(x,z).remaining >= -1e-7; }
  constrain(p: Vec3) {
    const n = this.nearest(p.x,p.z);
    if (n.remaining >= 0) return false;
    const k = Math.max(0,this.margin-.01)/Math.max(.001,n.distance);
    p.x = n.x+(p.x-n.x)*k; p.z = n.z+(p.z-n.z)*k;
    return true;
  }
}

export function createDrone(pos: Vec3, yaw: number, world: FlightWorld, area: FlightArea): DroneState {
  const p = { ...pos }; area.constrain(p);
  p.y = clamp(p.y, world.height(p.x,p.z)+DRONE.clearance, world.height(p.x,p.z)+DRONE.ceiling);
  return { pos: p, vel: { x: 0,y: 0,z: 0 }, yaw, pitch: -.16, bank: 0, tilt: 0, speed: 0,
    agl: p.y-world.height(p.x,p.z), rpm: [5700,5750,5680,5730], warning: '' };
}

/** Sphere against the existing tree/tower/building volumes. Small integration steps prevent tunneling. */
export function droneObstacle(p: Vec3, c: Collider, radius: number = DRONE.radius): boolean {
  if (p.y-radius > c.top) return false;
  if (c.type === 'cyl') return Math.hypot(p.x-c.x,p.z-c.z) < (c.r ?? 0)+radius;
  const co = Math.cos(c.yaw ?? 0), si = Math.sin(c.yaw ?? 0), dx = p.x-c.x, dz = p.z-c.z;
  return Math.abs(dx*co-dz*si) < (c.hx ?? 0)+radius && Math.abs(dx*si+dz*co) < (c.hz ?? 0)+radius;
}

export function stepDrone(s: DroneState, input: DroneInput, world: FlightWorld, area: FlightArea, elapsed: number) {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return;
  const count = Math.ceil(Math.min(elapsed,.1)*120), dt = Math.min(elapsed,.1)/count;
  s.warning = '';
  for (let step = 0; step < count; step++) {
    s.yaw = wrapAngle(s.yaw+clamp(input.yaw,-1,1)*1.5*dt);
    s.pitch = clamp(s.pitch+clamp(input.pitch,-1,1)*1.05*dt, -Math.PI*.49, Math.PI*.38);
    const f = { x: -Math.sin(s.yaw), z: -Math.cos(s.yaw) }, r = { x: -f.z, z: f.x };
    let u = clamp(input.forward,-1,1), v = clamp(input.right,-1,1), up = clamp(input.up,-1,1);
    const norm = Math.max(1,Math.hypot(u,v)); u /= norm; v /= norm;
    if (input.brake) { u = 0; v = 0; up = 0; }
    const maxSpeed = input.precision ? DRONE.precisionSpeed : input.fast ? DRONE.fastSpeed : DRONE.normalSpeed;
    const target = { x: (f.x*u+r.x*v)*maxSpeed, y: up*(input.precision ? 2 : DRONE.climbSpeed), z: (f.z*u+r.z*v)*maxSpeed };
    const old = { ...s.vel }, delta = { x: target.x-old.x,y: target.y-old.y,z: target.z-old.z };
    const length = Math.hypot(delta.x,delta.y,delta.z);
    const braking = input.brake || Math.hypot(u,v,up) < .01;
    const k = Math.min(1, (braking ? DRONE.braking : DRONE.acceleration)*dt/Math.max(.001,length));
    s.vel.x += delta.x*k; s.vel.y += delta.y*k; s.vel.z += delta.z*k;
    const next = { x: s.pos.x+s.vel.x*dt, y: s.pos.y+s.vel.y*dt,z: s.pos.z+s.vel.z*dt };
    if (area.constrain(next)) { s.vel.x = 0; s.vel.z = 0; s.warning = 'boundary'; }
    if (world.ready && !world.ready(next.x,next.z)) {
      next.x = s.pos.x; next.z = s.pos.z; s.vel.x = 0; s.vel.z = 0; s.warning = 'loading';
    }
    const ground = world.height(next.x,next.z);
    if (next.y < ground+DRONE.clearance) { next.y = ground+DRONE.clearance; s.vel.y = Math.max(0,s.vel.y); s.warning = 'ground'; }
    if (next.y > ground+DRONE.ceiling) { next.y = ground+DRONE.ceiling; s.vel.y = Math.min(0,s.vel.y); s.warning = 'ceiling'; }
    const obstacles = world.obstacles?.(next.x,next.z) ?? [];
    if (obstacles.some(c => droneObstacle(next,c))) {
      // Stop before contact; upward movement can clear a trunk, roof or tower.
      next.x = s.pos.x; next.z = s.pos.z;
      if (next.y < s.pos.y) next.y = s.pos.y;
      s.vel.x = 0; s.vel.z = 0; s.vel.y = Math.max(0,s.vel.y); s.warning = 'obstacle';
    }
    s.pos = next;
    const ax = (s.vel.x-old.x)/dt+s.vel.x*.18, az = (s.vel.z-old.z)/dt+s.vel.z*.18;
    const tilt = clamp(-Math.atan2(ax*f.x+az*f.z,9.81),-.48,.48);
    const bank = clamp(-Math.atan2(ax*r.x+az*r.z,9.81),-.48,.48);
    s.tilt += (tilt-s.tilt)*(1-Math.exp(-5*dt)); s.bank += (bank-s.bank)*(1-Math.exp(-5*dt));
    const rpm = 5750+Math.max(-450,s.vel.y*220)+Math.hypot(s.vel.x,s.vel.z)*38+Math.hypot(ax,az)*40;
    s.rpm = [0,1,2,3].map(i => clamp(rpm+(i < 2 ? -1 : 1)*s.tilt*520+(i%2 ? 1 : -1)*s.bank*520+(i%3 ? -1 : 1)*input.yaw*100+i*17,4400,9000));
  }
  s.speed = Math.hypot(s.vel.x,s.vel.y,s.vel.z);
  s.agl = s.pos.y-world.height(s.pos.x,s.pos.z);
}
