// Local player: ski physics, collisions, lift boarding/riding, and the animated model.
import * as THREE from 'three/webgpu';
import { SkierState, createSkier, stepSkier, getUp, SkiInput, TerrainProbe, headingFromDir } from '../../../shared/skiPhysics';
import { ColliderGrid } from '../../../shared/collision';
import { SkierModel } from './skierModel';
import { orientSkier } from './orientation';
import type { LiftSystem } from '../lifts/liftSystem';
import { GAUGE, MAX_BOARD_SPEED, SEAT_SPACING } from '../../../shared/lifts';

export interface RideState { lift: number; chair: number; seat: number; boardedAt: number; unloadAt: number }

export class Player {
  st: SkierState;
  model: SkierModel;
  ride: RideState | null = null;
  fallenBlend = 0;
  sitBlend = 0;
  time = 0;
  lastInput: SkiInput = { steer: 0, tuck: false, plow: 0, stop: false, push: false };
  inLoadZone = -1;
  justUnloaded = false;
  onUnload?: (lift: number, teleport: boolean) => void;
  onBoard?: (ride: RideState) => void;
  requestBoard?: (lift: number, chair: number, seat: number) => void; // multiplayer hook
  private tmp = new THREE.Vector3();
  private previousLiftTime: number | null = null;
  private pickupFrom: THREE.Vector3 | null = null;

  constructor(pos: THREE.Vector3, heading: number, private probe: TerrainProbe, private colliders: ColliderGrid, private lifts: LiftSystem) {
    this.st = createSkier({ x: pos.x, y: pos.y, z: pos.z }, heading);
    this.model = new SkierModel();
  }

  get position() { return new THREE.Vector3(this.st.pos.x, this.st.pos.y, this.st.pos.z); }

  teleport(x: number, z: number, heading: number) {
    if (this.ride) { const l = this.ride.lift; this.ride = null; this.onUnload?.(l, true); }
    this.st = createSkier({ x, y: this.probe.height(x, z), z }, heading);
    this.sitBlend = 0; this.fallenBlend = 0; this.pickupFrom = null; this.inLoadZone = -1;
    this.previousLiftTime = this.lifts.now();
  }

  getUp() { return getUp(this.st); }

  terrainNormal(x: number, z: number) { return this.probe.normal(x, z, { x: 0, y: 1, z: 0 }); }

  board(lift: number, chair: number, seat: number) {
    const path = this.lifts.paths[lift], t = this.lifts.now();
    if (!path || !Number.isInteger(chair) || chair < 0 || chair >= path.chairCount || !Number.isInteger(seat) || seat < 0 || seat >= path.def.seats) return;
    this.pickupFrom = this.position;
    this.ride = { lift, chair, seat, boardedAt: t, unloadAt: t + path.remainingRideTime(chair, t) };
    this.st.mode = 'riding';
    this.st.vel = { x: 0, y: 0, z: 0 };
    this.st.edge = 0; this.st.plow = 0; this.st.tuck = 0; this.st.skid = 0; this.st.grounded = false;
    this.inLoadZone = -1;
    this.onBoard?.(this.ride);
  }

  unload(skipped = false) {
    if (!this.ride) return;
    this.justUnloaded = true;
    const path = this.lifts.paths[this.ride.lift];
    const lift = this.ride.lift;
    const seat = this.ride.seat;
    const up = path.unloadPoint(seat);
    const x = up.x, z = up.z;
    this.ride = null;
    this.pickupFrom = null;
    this.st = createSkier({ x, y: this.probe.height(x, z), z }, up.heading);
    this.st.mode = 'skiing';
    this.st.vel = { x: path.ax * path.def.speed, y: 0, z: path.az * path.def.speed };
    this.st.speed = path.def.speed;
    if (skipped) this.sitBlend = 0;
    this.onUnload?.(lift, skipped);
  }

  /** Skip the rest of the ride (fast-forward to the top). */
  skipRide() { if (this.ride) this.unload(true); }

  update(dt: number, input: SkiInput, parked = false) {
    this.time += dt;
    this.lastInput = input;
    let st = this.st;
    const t = this.lifts.now();
    const previous = this.previousLiftTime ?? t - dt;
    this.previousLiftTime = t;
    if (this.ride) {
      const r = this.ride;
      const path = this.lifts.paths[r.lift];
      const info = path.riderPoint(r.chair, r.seat, t);
      st.pos = { ...info.p };
      st.heading = info.heading;
      st.speed = path.def.speed;
      const next = path.riderPoint(r.chair, r.seat, t + 0.01).p;
      st.vel = { x: (next.x - info.p.x) * 100, y: (next.y - info.p.y) * 100, z: (next.z - info.p.z) * 100 };
      if (t >= r.unloadAt || !info.uphill) { this.unload(); st = this.st; }
    } else if (!parked) {
      // A slow, upright skier facing uphill gets a short alignment assist to the load stripe.
      // Holding a turn or pushing leaves ordinary ski physics in control.
      this.inLoadZone = -1;
      if ((st.mode === 'standing' || st.mode === 'skiing') && st.grounded && st.speed <= MAX_BOARD_SPEED && !input.push && Math.abs(input.steer) < 0.1) {
        for (let li = 0; li < this.lifts.paths.length; li++) {
          const path = this.lifts.paths[li];
          if (!path.inLoadZone(st.pos.x, st.pos.z)) continue;
          const lp = path.loadPoint();
          if (Math.cos(st.heading - lp.heading) < 0.5) continue;
          this.inLoadZone = li;
          const b = path.def.bottom;
          const across = (st.pos.x - b[0]) * path.rx + (st.pos.z - b[2]) * path.rz - GAUGE / 2;
          const seat = Math.max(0, Math.min(path.def.seats - 1, Math.round(across / SEAT_SPACING + (path.def.seats - 1) / 2)));
          const tx = lp.x + path.rx * path.seatOffset(seat), tz = lp.z + path.rz * path.seatOffset(seat);
          const dx = tx - st.pos.x, dz = tz - st.pos.z, distance = Math.hypot(dx, dz);
          const k = Math.min(1, dt * 1.25 / Math.max(distance, 0.001));
          st.pos.x += dx * k; st.pos.z += dz * k; st.pos.y = this.probe.height(st.pos.x, st.pos.z);
          st.heading += Math.atan2(Math.sin(lp.heading - st.heading), Math.cos(lp.heading - st.heading)) * Math.min(1, dt * 6);
          st.vel = { x: 0, y: 0, z: 0 }; st.speed = 0; st.edge = 0; st.plow = 0; st.tuck = 0;
          const chair = path.crossingChair(previous, t);
          if (distance < 0.15 && chair !== null) {
            if (this.requestBoard) this.requestBoard(li, chair, seat);
            else this.board(li, chair, seat);
          }
          break;
        }
      }
      if (this.inLoadZone < 0 && !this.ride) { stepSkier(st, input, this.probe, dt); this.colliders.collide(st); }
    }
    if (parked && !this.ride) {
      st.vel = { x: 0, y: 0, z: 0 }; st.speed = 0; st.edge = 0; st.plow = 0; st.tuck = 0; st.skid = 0;
      this.inLoadZone = -1;
    }
    // animation blends
    const fallenTarget = st.mode === 'fallen' ? 1 : 0;
    const upRate = st.mode === 'gettingUp' ? 1 / 1.6 : 4;
    this.fallenBlend += Math.sign(fallenTarget - this.fallenBlend) * Math.min(Math.abs(fallenTarget - this.fallenBlend), dt * (fallenTarget ? 3 : upRate));
    this.sitBlend += ((this.ride ? 1 : 0) - this.sitBlend) * Math.min(1, dt * 4);
    this.model.root.position.set(st.pos.x, st.pos.y, st.pos.z);
    if (this.ride && this.pickupFrom) {
      const blend = Math.min(1, Math.max(0, (t - this.ride.boardedAt) / 0.45));
      this.model.root.position.lerpVectors(this.pickupFrom, this.tmp.set(st.pos.x, st.pos.y, st.pos.z), blend);
      if (blend === 1) this.pickupFrom = null;
    } else if (!this.ride) this.model.root.position.y += this.sitBlend * 0.18;
    orientSkier(this.model.root, st.heading, this.ride ? undefined : st.normal);
    this.model.update({
      speed: st.speed, edge: st.edge, plow: st.plow, tuck: st.tuck, skid: st.skid, fallen: this.fallenBlend,
      sitting: this.sitBlend, time: this.time, pushing: input.push && st.speed < 4 && st.mode !== 'fallen' && !this.ride,
    });
  }

  /** Downhill unit vector at the player's position (horizontal). */
  fallLine(out: THREE.Vector3) {
    const n = this.st.normal;
    out.set(n.x, 0, n.z);
    if (out.lengthSq() > 1e-6) out.normalize();
    return out;
  }

  static headingTo(dx: number, dz: number) { return headingFromDir(dx, dz); }
}
