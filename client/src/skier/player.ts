// Local player: ski physics, collisions, lift boarding/riding, and the animated model.
import * as THREE from 'three/webgpu';
import { SkierState, createSkier, stepSkier, getUp, fall, SkiInput, TerrainProbe, headingFromDir } from '../../../shared/skiPhysics';
import { ColliderGrid } from '../../../shared/collision';
import { SkierModel } from './skierModel';
import { orientSkier } from './orientation';
import type { LiftSystem } from '../lifts/liftSystem';
import { BOARD_FACING_COS } from '../../../shared/lifts';
import { carriedSwing, createChairSwing, stepChairSwing, swingingRiderPoint, chairReleaseVelocity, type ChairSwing } from '../../../shared/chairSwing';

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
  /** A wave or a point downhill, blended in and out by the game. */
  gesture: { kind: 'wave' | 'point'; amount: number; yaw?: number } | null = null;
  justUnloaded = false;
  onUnload?: (lift: number, teleport: boolean) => void;
  onBoard?: (ride: RideState) => void;
  onLiftFall?: (ride: RideState, swing: ChairSwing) => void;
  chairSwing = createChairSwing();
  tumble: { pitch: number; roll: number; pitchV: number; rollV: number } | null = null;
  private boardCooldown = 0;
  requestBoard?: (lift: number, chair: number, seat: number) => void; // multiplayer hook
  private tmp = new THREE.Vector3();
  private previousLiftTimes: number[] = [];
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
  get rideSwing() { return carriedSwing(this.chairSwing, this.ride ? this.lifts.chairSwing?.(this.ride.lift, this.ride.chair) : undefined); }

  teleport(x: number, z: number, heading: number) {
    if (this.ride) { const l = this.ride.lift; this.ride = null; this.onUnload?.(l, true); }
    this.st = createSkier({ x, y: this.probe.height(x, z), z }, heading);
    this.sitBlend = 0; this.fallenBlend = 0; this.pickupOffset = null; this.inLoadZone = -1;
    this.chairSwing = createChairSwing(); this.tumble = null; this.boardCooldown = 0;
    this.previousLiftTimes = this.lifts.paths.map((_, i) => this.lifts.now(i));
  }

  getUp() { return getUp(this.st); }

  terrainHeight(x: number, z: number) { return this.probe.height(x, z); }

  terrainNormal(x: number, z: number) { return this.probe.normal(x, z, { x: 0, y: 1, z: 0 }); }

  board(lift: number, chair: number, seat: number) {
    const path = this.lifts.paths[lift], t = this.lifts.now(lift);
    if (!path || !Number.isInteger(chair) || chair < 0 || chair >= path.chairCount || !Number.isInteger(seat) || seat < 0 || seat >= path.def.seats) return;
    const target = path.riderPoint(chair, seat, t).p;
    this.pickupOffset = this.position.sub(new THREE.Vector3(target.x, target.y, target.z));
    this.pickupHeading = this.st.heading;
    this.pickupStartedAt = t; this.pickupSitStart = this.sitBlend;
    this.liftPreparation = 1;
    this.chairSwing = createChairSwing(); this.tumble = null;
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
    const t = this.lifts.now(this.ride.lift), p = this.lifts.paths[this.ride.lift].riderPoint(this.ride.chair, seat, t).p;
    this.pickupOffset = this.position.sub(new THREE.Vector3(p.x, p.y, p.z));
    this.pickupHeading = this.st.heading; this.pickupStartedAt = t; this.pickupSitStart = this.sitBlend;
  }

  /** Skip the rest of the ride (fast-forward to the top). */
  skipRide() { if (this.ride) this.unload(true); }

  /** Leave the current seat continuously, with cable, swing and sliding momentum. */
  fallFromLift() {
    const r = this.ride;
    if (!r) return;
    const path = this.lifts.paths[r.lift], t = this.lifts.now(r.lift), swing = this.rideSwing;
    const point = swingingRiderPoint(path, r.chair, r.seat, t, swing);
    this.st.pos = { ...point.p };
    this.st.heading = point.heading;
    this.st.vel = chairReleaseVelocity(path, r.chair, r.seat, t, swing);
    this.st.speed = Math.hypot(this.st.vel.x, this.st.vel.y, this.st.vel.z);
    this.st.grounded = false;
    fall(this.st, 0);
    this.tumble = { pitch: swing.pitch, roll: swing.roll, pitchV: swing.pitchV, rollV: swing.rollV };
    this.ride = null; this.pickupOffset = null; this.inLoadZone = -1; this.liftPreparation = 0;
    this.boardCooldown = 3;
    this.onLiftFall?.(r, { ...this.chairSwing });
  }

  update(dt: number, input: SkiInput, parked = false) {
    this.time += dt;
    this.lastInput = input;
    this.boardCooldown = Math.max(0, this.boardCooldown - dt);
    let st = this.st;
    const times = this.lifts.paths.map((_, i) => this.lifts.now(i));
    const previousTimes = this.previousLiftTimes;
    this.previousLiftTimes = times;
    const t = times[this.ride?.lift ?? 0];
    if (this.ride) {
      const r = this.ride;
      const path = this.lifts.paths[r.lift];
      const settled = t - this.pickupStartedAt > 1.2;
      // Snow ramps and terminal approaches are not a place to excite the pendulum.
      const h = path.loopPoint(path.chairU(r.chair, t)).h;
      const onLine = settled && h > 24 && h < path.horiz - 24;
      const released = stepChairSwing(this.chairSwing, onLine && !parked
        ? { right: input.steer, forward: Number(input.push || input.tuck) - input.plow }
        : { right: 0, forward: 0 }, dt, onLine);
      this.lifts.setChairSwing?.(r.lift, r.chair, this.chairSwing);
      const info = swingingRiderPoint(path, r.chair, r.seat, t, this.rideSwing);
      st.pos = { ...info.p };
      st.heading = info.heading;
      st.speed = path.def.speed;
      st.vel = chairReleaseVelocity(path, r.chair, r.seat, t, this.rideSwing);
      if (t >= r.unloadAt || !info.uphill) { this.unload(); st = this.st; }
      else if (released) this.fallFromLift();
    } else if (!parked || this.tumble) {
      const from = { ...st.pos };
      // waiting in a loading lane: plant the poles and hold the spot on the sloped loading snow
      if (!input.push && st.speed < 1.5 && this.lifts.paths.some((p) => p.inBoardingApproach(st.pos.x, st.pos.z))) input = { ...input, hold: true };
      stepSkier(st, input, this.probe, dt);
      this.colliders.collide(st);
      this.inLoadZone = -1;
      this.liftPreparation = 0;
      if (!this.boardCooldown && (st.mode === 'standing' || st.mode === 'skiing' || st.mode === 'air')) {
        for (let li = 0; li < this.lifts.paths.length; li++) {
          const path = this.lifts.paths[li], t = times[li], previous = previousTimes[li] ?? t - dt;
          if (!path.inBoardingApproach(st.pos.x, st.pos.z) && !path.inBoardingApproach(from.x, from.z)) continue;
          this.inLoadZone = li;
          const facing = Math.cos(st.heading - path.loadPoint().heading) >= BOARD_FACING_COS;
          const along = (st.pos.x - path.def.bottom[0]) * path.ax + (st.pos.z - path.def.bottom[2]) * path.az;
          const next = path.nextChairAt(path.sAtH(Math.max(0, along)), t);
          if (facing) this.liftPreparation = Math.max(0, 1 - (next.arrive - t) / 1.4);
          const contact = path.boardingContact(from, st.pos, previous, t);
          if (contact && facing && !this.lifts.closed) {
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
    if (this.tumble) {
      if (!st.grounded) {
        this.tumble.pitch += this.tumble.pitchV * dt; this.tumble.roll += this.tumble.rollV * dt;
        this.tumble.pitchV *= Math.exp(-.18 * dt); this.tumble.rollV *= Math.exp(-.18 * dt);
      } else this.tumble = null;
    }
    if (parked && !this.ride && !this.tumble) {
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
      const point = swingingRiderPoint(this.lifts.paths[this.ride.lift], this.ride.chair, this.ride.seat, t, this.rideSwing);
      st.pos = { x: point.p.x + this.pickupOffset.x * (1 - blend), y: point.p.y + this.pickupOffset.y * (1 - blend), z: point.p.z + this.pickupOffset.z * (1 - blend) };
      st.heading = this.pickupHeading + Math.atan2(Math.sin(point.heading - this.pickupHeading), Math.cos(point.heading - this.pickupHeading)) * blend;
      this.sitBlend = this.pickupSitStart + (1 - this.pickupSitStart) * blend;
      if (progress === 1) this.pickupOffset = null;
    } else this.sitBlend += ((this.ride ? 1 : 0) - this.sitBlend) * Math.min(1, dt * 5);
    this.model.root.position.set(st.pos.x, st.pos.y, st.pos.z);
    if (!this.ride) this.model.root.position.y += this.sitBlend * .18;
    orientSkier(this.model.root, st.heading, this.ride || !st.grounded ? undefined : st.normal);
    if (this.ride) this.model.root.rotation.set(this.rideSwing.pitch, st.heading, this.rideSwing.roll, 'YXZ');
    else if (this.tumble) this.model.root.rotation.set(this.tumble.pitch, st.heading, this.tumble.roll, 'YXZ');
    const footGroundY = this.ride ? this.probe.height(st.pos.x - Math.sin(st.heading) * .2, st.pos.z - Math.cos(st.heading) * .2) - st.pos.y : undefined;
    const groundNormal = this.ride ? this.terrainNormal(st.pos.x, st.pos.z) : st.normal;
    const footGroundPitch = Math.atan2(groundNormal.x * Math.sin(st.heading) + groundNormal.z * Math.cos(st.heading), groundNormal.y);
    this.model.update({
      speed: st.speed, edge: st.edge, plow: st.plow, tuck: st.tuck, skid: st.skid, fallen: this.fallenBlend,
      sitting: this.sitBlend, liftPreparation: this.liftPreparation, footGroundY, footGroundPitch, time: this.time, pushing: input.push && st.speed < 4 && st.mode !== 'fallen' && !this.ride,
      airborne: !!this.tumble, rockX: this.ride ? this.chairSwing.leanX : 0, rockZ: this.ride ? this.chairSwing.leanZ : 0,
      slipping: this.ride ? this.chairSwing.slip : 0,
      gesture: this.gesture && !this.ride ? this.gesture : undefined,
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
