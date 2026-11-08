// Local player: ski physics, collisions, lift boarding/riding, and the animated model.
import * as THREE from 'three/webgpu';
import { SkierState, createSkier, stepSkier, getUp, SkiInput, TerrainProbe, headingFromDir } from '../../../shared/skiPhysics';
import { ColliderGrid } from '../../../shared/collision';
import { SkierModel } from './skierModel';
import type { LiftSystem } from '../lifts/liftSystem';
import { UNLOAD_OFFSET } from '../../../shared/lifts';

export interface RideState { lift: number; chair: number; seat: number; boardedAt: number }

export class Player {
  st: SkierState;
  model: SkierModel;
  ride: RideState | null = null;
  fallenBlend = 0;
  sitBlend = 0;
  time = 0;
  lastInput: SkiInput = { steer: 0, tuck: false, plow: 0, stop: false, push: false };
  inLoadZone = -1;
  onUnload?: (lift: number) => void;
  onBoard?: (ride: RideState) => void;
  requestBoard?: (lift: number, chair: number, seat: number) => void; // multiplayer hook
  private tmp = new THREE.Vector3();

  constructor(pos: THREE.Vector3, heading: number, private probe: TerrainProbe, private colliders: ColliderGrid, private lifts: LiftSystem) {
    this.st = createSkier({ x: pos.x, y: pos.y, z: pos.z }, heading);
    this.model = new SkierModel();
  }

  get position() { return new THREE.Vector3(this.st.pos.x, this.st.pos.y, this.st.pos.z); }

  teleport(x: number, z: number, heading: number) {
    this.ride = null;
    this.st = createSkier({ x, y: this.probe.height(x, z), z }, heading);
  }

  getUp() { return getUp(this.st); }

  board(lift: number, chair: number, seat: number) {
    this.ride = { lift, chair, seat, boardedAt: this.lifts.now() };
    this.st.mode = 'riding';
    this.st.vel = { x: 0, y: 0, z: 0 };
    this.onBoard?.(this.ride);
  }

  unload() {
    if (!this.ride) return;
    const path = this.lifts.paths[this.ride.lift];
    const lift = this.ride.lift;
    const seat = this.ride.seat;
    const up = path.unloadPoint();
    // spread riders across the ramp by seat
    const off = (seat - (path.def.seats - 1) / 2) * 0.9;
    const x = up.x + path.rx * off, z = up.z + path.rz * off;
    this.ride = null;
    this.st = createSkier({ x, y: this.probe.height(x, z), z }, up.heading);
    this.st.mode = 'skiing';
    this.st.vel = { x: path.ax * 2.0, y: 0, z: path.az * 2.0 };
    this.onUnload?.(lift);
  }

  /** Skip the rest of the ride (fast-forward to the top). */
  skipRide() { if (this.ride) this.unload(); }

  update(dt: number, input: SkiInput) {
    this.time += dt;
    this.lastInput = input;
    const st = this.st;
    if (this.ride) {
      const r = this.ride;
      const info = this.lifts.seatTransform(r.lift, r.chair, r.seat, this.lifts.now(), this.tmp);
      st.pos.x = this.tmp.x; st.pos.y = this.tmp.y - 0.45; st.pos.z = this.tmp.z;
      st.heading = info.heading;
      const path = this.lifts.paths[r.lift];
      st.speed = path.def.speed;
      if (info.uphill && info.h >= path.horiz - UNLOAD_OFFSET && this.lifts.now() - r.boardedAt > 5) this.unload();
      else if (!info.uphill) this.unload(); // safety
    } else {
      stepSkier(st, input, this.probe, dt);
      this.colliders.collide(st);
      // lift loading
      this.inLoadZone = -1;
      if ((st.mode === 'standing' || st.mode === 'skiing') && st.speed < 3.5) {
        const t = this.lifts.now();
        for (let li = 0; li < this.lifts.paths.length; li++) {
          const path = this.lifts.paths[li];
          if (!path.inLoadZone(st.pos.x, st.pos.z)) continue;
          this.inLoadZone = li;
          // a chair "scoops" the rider when it passes the rider's position along the line
          const b = path.def.bottom;
          const along = (st.pos.x - b[0]) * path.ax + (st.pos.z - b[2]) * path.az;
          const uRider = path.sAtH(Math.max(0.5, along));
          const next = path.nextChairAt(uRider, t);
          if (next.arrive - t < dt * 1.5) {
            // seat chosen by lateral position in the zone
            const across = (st.pos.x - b[0]) * path.rx + (st.pos.z - b[2]) * path.rz - 2.6;
            const seats = path.def.seats;
            const seat = Math.max(0, Math.min(seats - 1, Math.round(across / 0.6 + (seats - 1) / 2)));
            if (this.requestBoard) this.requestBoard(li, next.index, seat);
            else this.board(li, next.index, seat);
          }
        }
      }
    }
    // animation blends
    const fallenTarget = st.mode === 'fallen' ? 1 : 0;
    const upRate = st.mode === 'gettingUp' ? 1 / 1.6 : 4;
    this.fallenBlend += Math.sign(fallenTarget - this.fallenBlend) * Math.min(Math.abs(fallenTarget - this.fallenBlend), dt * (fallenTarget ? 3 : upRate));
    this.sitBlend += ((this.ride ? 1 : 0) - this.sitBlend) * Math.min(1, dt * 4);
    this.model.root.position.set(st.pos.x, st.pos.y, st.pos.z);
    this.model.root.rotation.set(0, st.heading, 0);
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
