// Local player: ski physics, collisions, lift boarding/riding, and the animated model.
import * as THREE from 'three/webgpu';
import { SkierState, createSkier, stepSkier, getUp, SkiInput, TerrainProbe, headingFromDir } from '../../../shared/skiPhysics';
import { ColliderGrid } from '../../../shared/collision';
import { SkierModel } from './skierModel';
import { orientSkier } from './orientation';
import type { LiftSystem } from '../lifts/liftSystem';
import { BOARD_FACING_COS } from '../../../shared/lifts';

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
  private pickupOffset: THREE.Vector3 | null = null;
  private pickupHeading = 0;
  private pickupStartedAt = 0;
  private pickupSitStart = 0;
  liftPreparation = 0;

  constructor(pos: THREE.Vector3, heading: number, private probe: TerrainProbe, private colliders: ColliderGrid, private lifts: LiftSystem) {
    this.st = createSkier({ x: pos.x, y: pos.y, z: pos.z }, heading);
    this.model = new SkierModel();
  }

  get position() { return new THREE.Vector3(this.st.pos.x, this.st.pos.y, this.st.pos.z); }

  teleport(x: number, z: number, heading: number) {
    if (this.ride) { const l = this.ride.lift; this.ride = null; this.onUnload?.(l, true); }
    this.st = createSkier({ x, y: this.probe.height(x, z), z }, heading);
    this.sitBlend = 0; this.fallenBlend = 0; this.pickupOffset = null; this.inLoadZone = -1;
    this.previousLiftTime = this.lifts.now();
  }

  getUp() { return getUp(this.st); }

  terrainHeight(x: number, z: number) { return this.probe.height(x, z); }

  terrainNormal(x: number, z: number) { return this.probe.normal(x, z, { x: 0, y: 1, z: 0 }); }

  board(lift: number, chair: number, seat: number) {
    const path = this.lifts.paths[lift], t = this.lifts.now();
    if (!path || !Number.isInteger(chair) || chair < 0 || chair >= path.chairCount || !Number.isInteger(seat) || seat < 0 || seat >= path.def.seats) return;
    const target = path.riderPoint(chair, seat, t).p;
    this.pickupOffset = this.position.sub(new THREE.Vector3(target.x, target.y, target.z));
    this.pickupHeading = this.st.heading;
    this.pickupStartedAt = t; this.pickupSitStart = this.sitBlend;
    this.liftPreparation = 1;
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
    this.pickupOffset = null;
    this.st = createSkier({ x, y: this.probe.height(x, z), z }, up.heading);
    this.st.mode = 'skiing';
    this.st.vel = { x: path.ax * path.def.speed, y: 0, z: path.az * path.def.speed };
    this.st.speed = path.def.speed;
    if (skipped) this.sitBlend = 0;
    this.onUnload?.(lift, skipped);
  }

  /** A denied multiplayer pickup returns to the saved snow contact, never midair. */
  rejectBoard(saved: SkierState) {
    this.ride = null; this.pickupOffset = null; this.sitBlend = 0;
    this.st = saved;
    this.st.pos.y = this.probe.height(saved.pos.x, saved.pos.z);
  }

  confirmSeat(seat: number) {
    if (!this.ride || this.ride.seat === seat) return;
    this.ride.seat = seat;
    const t = this.lifts.now(), p = this.lifts.paths[this.ride.lift].riderPoint(this.ride.chair, seat, t).p;
    this.pickupOffset = this.position.sub(new THREE.Vector3(p.x, p.y, p.z));
    this.pickupHeading = this.st.heading; this.pickupStartedAt = t; this.pickupSitStart = this.sitBlend;
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
      const from = { ...st.pos };
      stepSkier(st, input, this.probe, dt);
      this.colliders.collide(st);
      this.inLoadZone = -1;
      this.liftPreparation = 0;
      if (st.mode === 'standing' || st.mode === 'skiing' || st.mode === 'air') {
        for (let li = 0; li < this.lifts.paths.length; li++) {
          const path = this.lifts.paths[li];
          if (!path.inBoardingApproach(st.pos.x, st.pos.z) && !path.inBoardingApproach(from.x, from.z)) continue;
          this.inLoadZone = li;
          const facing = Math.cos(st.heading - path.loadPoint().heading) >= BOARD_FACING_COS;
          const along = (st.pos.x - path.def.bottom[0]) * path.ax + (st.pos.z - path.def.bottom[2]) * path.az;
          const next = path.nextChairAt(path.sAtH(Math.max(0, along)), t);
          if (facing) this.liftPreparation = Math.max(0, 1 - (next.arrive - t) / 1.4);
          const contact = path.boardingContact(from, st.pos, previous, t);
          if (contact && facing) {
            if (this.requestBoard) this.requestBoard(li, contact.chair, contact.seat);
            else this.board(li, contact.chair, contact.seat);
          } else if (contact) {
            // A misaligned skier is pushed by the moving seat instead of letting it
            // pass through their legs. Turning uphill allows the next contact to load.
            const correction = Math.max(0, .52 - contact.along);
            st.pos.x += path.ax * correction; st.pos.z += path.az * correction;
            st.pos.y = this.probe.height(st.pos.x, st.pos.z);
            const alongSpeed = st.vel.x * path.ax + st.vel.z * path.az;
            st.vel.x += path.ax * Math.max(0, path.def.speed - alongSpeed);
            st.vel.z += path.az * Math.max(0, path.def.speed - alongSpeed);
            st.speed = Math.hypot(st.vel.x, st.vel.y, st.vel.z);
          }
          break;
        }
      }
    }
    if (parked && !this.ride) {
      st.vel = { x: 0, y: 0, z: 0 }; st.speed = 0; st.edge = 0; st.plow = 0; st.tuck = 0; st.skid = 0;
      this.inLoadZone = -1;
    }
    // animation blends
    const fallenTarget = st.mode === 'fallen' ? 1 : 0;
    const upRate = st.mode === 'gettingUp' ? 1 / 1.6 : 4;
    this.fallenBlend += Math.sign(fallenTarget - this.fallenBlend) * Math.min(Math.abs(fallenTarget - this.fallenBlend), dt * (fallenTarget ? 3 : upRate));
    if (this.ride && this.pickupOffset) {
      const progress = Math.min(1, Math.max(0, (t - this.pickupStartedAt) / .85));
      const blend = progress * progress * (3 - 2 * progress);
      const point = this.lifts.paths[this.ride.lift].riderPoint(this.ride.chair, this.ride.seat, t);
      st.pos = { x: point.p.x + this.pickupOffset.x * (1 - blend), y: point.p.y + this.pickupOffset.y * (1 - blend), z: point.p.z + this.pickupOffset.z * (1 - blend) };
      st.heading = this.pickupHeading + Math.atan2(Math.sin(point.heading - this.pickupHeading), Math.cos(point.heading - this.pickupHeading)) * blend;
      this.sitBlend = this.pickupSitStart + (1 - this.pickupSitStart) * blend;
      if (progress === 1) this.pickupOffset = null;
    } else this.sitBlend += ((this.ride ? 1 : 0) - this.sitBlend) * Math.min(1, dt * 5);
    this.model.root.position.set(st.pos.x, st.pos.y, st.pos.z);
    if (!this.ride) this.model.root.position.y += this.sitBlend * .18;
    orientSkier(this.model.root, st.heading, this.ride ? undefined : st.normal);
    const footGroundY = this.ride ? this.probe.height(st.pos.x - Math.sin(st.heading) * .2, st.pos.z - Math.cos(st.heading) * .2) - st.pos.y : undefined;
    const groundNormal = this.ride ? this.terrainNormal(st.pos.x, st.pos.z) : st.normal;
    const footGroundPitch = Math.atan2(groundNormal.x * Math.sin(st.heading) + groundNormal.z * Math.cos(st.heading), groundNormal.y);
    this.model.update({
      speed: st.speed, edge: st.edge, plow: st.plow, tuck: st.tuck, skid: st.skid, fallen: this.fallenBlend,
      sitting: this.sitBlend, liftPreparation: this.liftPreparation, footGroundY, footGroundPitch, time: this.time, pushing: input.push && st.speed < 4 && st.mode !== 'fallen' && !this.ride,
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
