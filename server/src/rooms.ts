// Room and authority logic, independent of the transport so it can be unit tested.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LiftPath, LiftDef, BOARD_FACING_COS, UNLOAD_GRACE, UNLOAD_SLOWDOWN } from '../../shared/lifts';
import { DRONE, FlightArea } from '../../shared/dronePhysics';
import { LiftClock, isLiftSpeed, type LiftSpeed } from '../../shared/liftClock';
import { CHAIR_SWING, carriedSwing, createChairSwing, swingEnergy, chairReleaseVelocity, swingingRiderPoint, validChairSwing, type ChairSwing } from '../../shared/chairSwing';
import type { NetDrone } from '../../shared/protocol';
import { MountainGuest, readGuestCheckpoint, type GuestCheckpoint } from '../../shared/mountainGuest';
import type { GuestNavigation } from '../../shared/mountainGuestNavigation';
import type { ColliderGrid } from '../../shared/collision';
import type { Vec3 } from '../../shared/skiPhysics';
import {
  ClientMsg, ServerMsg, PlayerInfo, NetSkier, MAX_PLAYERS, MAX_SPEED, sanitizeName, sanitizeColor, sanitizeRoom,
} from '../../shared/protocol';

export interface Conn { send(msg: ServerMsg): void; close(): void }

interface Player extends PlayerInfo { conn: Conn; lastRx: number; unloadAt?: number; initialized: boolean; liftSpeed?: LiftSpeed; swingAt?: number }

let liftCache: LiftPath[] | null = null;
let droneArea: FlightArea | null = null;
export function loadLifts(): LiftPath[] {
  if (liftCache) return liftCache;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../client/public/world/resort.json'),
    path.resolve(here, '../world/resort.json'),
    path.resolve(process.cwd(), 'client/public/world/resort.json'),
  ];
  for (const c of candidates) {
    try {
      const resort = JSON.parse(readFileSync(c, 'utf8'));
      if (resort.boundary?.length >= 3) droneArea = new FlightArea(resort.boundary);
      liftCache = (resort.lifts as LiftDef[]).map((d) => new LiftPath(d));
      return liftCache;
    } catch { /* try next */ }
  }
  console.warn('resort.json not found; lift validation disabled');
  liftCache = [];
  return liftCache;
}

let nextId = 1;
export const now = () => Date.now() / 1000;

export class Room {
  readonly liftClocks: LiftClock[];
  players = new Map<string, Player>();
  // seat occupancy: `${lift}/${chair}` -> seat -> player id
  seats = new Map<string, Map<number, string>>();
  private guestTick = now();
  constructor(public code: string, private lifts: LiftPath[], private flightArea = droneArea, readonly guest?: MountainGuest) {
    this.liftClocks = lifts.map(() => new LiftClock());
    const saved = guest?.checkpoint();
    // Resume the same trip after an empty room or a restart. Nobody is on the
    // other chairs yet, so only the resident's occupied cable needs anchoring.
    if (saved?.ride) {
      const i = saved.ride.lift, at = now();
      this.liftClocks[i].sync({ time: saved.liftTimes[i], at, rate: 1 }, at);
    }
  }

  get size() { return this.players.size; }

  join(conn: Conn, name: string, color: string, controlMode: 'skier' | 'drone' = 'skier'): Player | null {
    if (this.players.size >= MAX_PLAYERS) return null;
    const id = 'p' + (nextId++).toString(36);
    const p: Player = {
      id, name: sanitizeName(name), color: sanitizeColor(color), conn, lastRx: now(), t: now(), ride: null, controlMode, initialized:false,
      s: { x: 0, y: 0, z: 0, heading: 0, vx: 0, vy: 0, vz: 0, mode: 'standing', edge: 0, plow: 0, tuck: 0, fallen: 0 },
    };
    this.players.set(id, p);
    conn.send({ type: 'welcome', id, room: this.code, serverTime: now(), manualUnload: true, mountainGuest: this.guest?.pose(), liftPlayback: this.liftClocks.map(clock => clock.snapshot()), players: [...this.players.values()].filter((q) => q.id !== id).map(info) });
    this.broadcast({ type: 'joined', player: info(p) }, id);
    return p;
  }

  leave(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.freeSeat(p);
    this.players.delete(id);
    this.broadcast({ type: 'left', id });
  }

  private freeSeat(p: Player) {
    if (!p.ride) return;
    const lift = p.ride.lift;
    const k = `${lift}/${p.ride.chair}`;
    const m = this.seats.get(k);
    if (m && m.get(p.ride.seat) === p.id) m.delete(p.ride.seat);
    if (m && m.size === 0) this.seats.delete(k);
    p.ride = null;
    p.unloadAt = undefined;
    p.liftSpeed = 1;
    this.updateLiftSpeed(lift);
  }

  private updateLiftSpeed(lift: number) {
    const clock = this.liftClocks[lift];
    const owner = [...this.players.values()].find(p => p.ride?.lift === lift && (p.liftSpeed ?? 1) > 1 && p.unloadAt! - UNLOAD_SLOWDOWN > clock.now());
    // back to normal speed a little before the ramp, so riders can get ready to stand up
    clock.setRate(owner?.liftSpeed ?? 1, owner?.unloadAt === undefined ? undefined : owner.unloadAt - UNLOAD_SLOWDOWN);
  }

  private unload(p: Player) {
    if (!p.ride) return;
    const path = this.lifts[p.ride.lift], up = path.unloadPoint(p.ride.seat);
    p.s = { ...p.s, x: up.x, y: path.stationHeight(true), z: up.z, heading: up.heading,
      vx: path.ax * path.def.speed, vy: 0, vz: path.az * path.def.speed, mode: 'skiing', edge: 0, plow: 0, tuck: 0, fallen: 0 };
    p.t = now();
    this.freeSeat(p);
    this.broadcast({ type: 'unloaded', id: p.id });
  }

  handle(id: string, msg: ClientMsg) {
    const p = this.players.get(id);
    if (!p) return;
    const t = now();
    p.lastRx = t;
    switch (msg.type) {
      case 'state': {
        const s = msg.s;
        if (!s || ![s.x, s.y, s.z, s.heading, s.vx, s.vy, s.vz].every(Number.isFinite)) return;
        if (p.controlMode === 'drone') {
          const anchor = !p.initialized || msg.teleport ? s : p.s;
          const parked = {...anchor, mode:'drone', vx:0, vy:0, vz:0, edge:0, plow:0, tuck:0, fallen:0};
          if (msg.drone && this.validDrone(msg.drone,{...p,s:parked},t)) {
            p.drone = {...msg.drone,rpm:[...msg.drone.rpm]};
            p.s = parked; p.initialized = true;
          }
          // No skier motion, falling, boarding or flight exit can be requested by this session.
          p.t = t; return;
        }
        if (msg.drone == null) p.drone = null;
        else if (this.validDrone(msg.drone,p,t)) p.drone = { ...msg.drone, rpm: [...msg.drone.rpm] };
        if (p.ride) {
          // Clients report bounded stance; positions and release momentum are
          // derived here from their actual reserved chair, never client coordinates.
          const swing = s.swing, old = p.s.swing, dt = Math.min(.5, Math.max(.02, t - (p.swingAt ?? t)));
          if (validChairSwing(swing) && Math.abs(swing.roll - (old?.roll ?? 0)) <= dt * 3 + .08 &&
              Math.abs(swing.pitch - (old?.pitch ?? 0)) <= dt * 3 + .08 &&
              swing.slip <= (old?.slip ?? 0) + dt * 1.7 + .05 &&
              (!swing.slip || !!old?.slip || Math.hypot(swing.roll, swing.pitch) >= CHAIR_SWING.releaseAngle - .05)) {
            p.s.swing = { ...swing }; p.swingAt = t;
          }
          p.s = { ...p.s, mode: 'riding' }; p.t = t; return;
        }
        const dt = Math.max(0.02, t - p.t);
        const dist = Math.hypot(s.x - p.s.x, s.z - p.s.z);
        const first = !p.initialized;
        if (!first && !msg.teleport && dist > MAX_SPEED * dt + 5) {
          // implausible jump: keep the authoritative position and tell the client
          p.conn.send({ type: 'correct', s: p.s });
          return;
        }
        const sp = Math.hypot(s.vx, s.vy, s.vz);
        const k = sp > MAX_SPEED ? MAX_SPEED / sp : 1;
        const tumble = s.tumble && [s.tumble.pitch, s.tumble.roll].every(v => Number.isFinite(v) && Math.abs(v) < 30)
          ? { ...s.tumble } : undefined;
        p.s = { ...s, swing: undefined, tumble, vx: s.vx * k, vy: s.vy * k, vz: s.vz * k, mode: String(s.mode).slice(0, 12) };
        p.initialized = true;
        p.t = t;
        return;
      }
      case 'board': {
        const lift = this.lifts[msg.lift];
        const reject = (reason: string) => p.conn.send({ type: 'boardRejected', reason });
        if (p.controlMode === 'drone') { reject('drone-only session'); return; }
        if (!Number.isInteger(msg.lift) || !lift) { reject('no such lift'); return; }
        if (!Number.isInteger(msg.chair) || msg.chair < 0 || msg.chair >= lift.chairCount || !Number.isInteger(msg.seat) || msg.seat < 0 || msg.seat >= lift.def.seats) {
          reject('invalid chair or seat'); return;
        }
        if (p.ride) {
          if (p.ride.lift === msg.lift && p.ride.chair === msg.chair) p.conn.send({ type: 'boarded', id: p.id, ...p.ride });
          else reject('already riding');
          return;
        }
        if (!lift.inBoardingApproach(p.s.x, p.s.z) || !['standing', 'skiing', 'air'].includes(p.s.mode) ||
            Math.cos(p.s.heading - lift.loadPoint().heading) < BOARD_FACING_COS) {
          reject('face uphill in the loading approach'); return;
        }
        const clock = this.liftClocks[msg.lift], liftTime = clock.now();
        const point = { x: p.s.x, y: p.s.y, z: p.s.z };
        const contact = lift.boardingContact(point, point, liftTime - .75 * clock.rate, liftTime + .1 * clock.rate, msg.chair);
        if (!contact) { reject('chair has not reached you'); return; }
        const key = `${msg.lift}/${msg.chair}`;
        let m = this.seats.get(key);
        if (!m) { m = new Map(); this.seats.set(key, m); }
        let seat = msg.seat;
        const guest = this.guest?.ride;
        const occupied = (i: number) => m!.has(i) || (guest?.lift === msg.lift && guest.chair === msg.chair && guest.seat === i);
        if (occupied(seat)) {
          const free = [...Array(lift.def.seats).keys()].filter(i => !occupied(i));
          if (!free.length) { p.conn.send({ type: 'boardRejected', reason: 'chair full' }); return; }
          free.sort((a, b) => Math.abs(a - seat) - Math.abs(b - seat));
          seat = free[0];
        }
        m.set(seat, p.id);
        p.ride = { lift: msg.lift, chair: msg.chair, seat, boardedAt: liftTime };
        p.s.swing = undefined; p.s.tumble = undefined; p.swingAt = t;
        p.unloadAt = liftTime + lift.remainingRideTime(msg.chair, liftTime);
        this.broadcast({ type: 'boarded', id: p.id, ...p.ride });
        return;
      }
      case 'unload':
        this.unload(p);
        return;
      case 'liftFall': {
        const swing = msg.swing, previous = p.s.swing;
        // A rocked-off fall must have built up through reported slip; jumping off by choice needs no rocking.
        if (!p.ride || p.controlMode === 'drone' || !validChairSwing(swing)) return;
        if (msg.jump !== true && (!previous || swing.slip < CHAIR_SWING.releaseSlip || previous.slip < .4 ||
            Math.abs(swing.roll - previous.roll) > .5 || Math.abs(swing.pitch - previous.pitch) > .5)) return;
        const r = p.ride, path = this.lifts[r.lift], time = this.liftClocks[r.lift].now();
        let carrier = swing;
        for (const other of this.players.values()) if (other.ride?.lift === r.lift && other.ride.chair === r.chair &&
            other.s.swing && swingEnergy(other.s.swing) > swingEnergy(carrier)) carrier = other.s.swing;
        const physical = carriedSwing(swing, carrier);
        const point = swingingRiderPoint(path, r.chair, r.seat, time, physical);
        const vel = chairReleaseVelocity(path, r.chair, r.seat, time, physical);
        p.s = { ...p.s, x: point.p.x, y: point.p.y, z: point.p.z, heading: point.heading,
          vx: vel.x, vy: vel.y, vz: vel.z, mode: 'fallen', fallen: 0, edge: 0, plow: 0, tuck: 0,
          swing: undefined, tumble: { pitch: physical.pitch, roll: physical.roll } };
        p.t = t;
        this.freeSeat(p);
        this.broadcast({ type: 'liftFell', id: p.id, s: p.s });
        return;
      }
      case 'liftSpeed': {
        if (!p.ride || p.controlMode === 'drone') return;
        // Older clients can still request/cancel their original 8x control.
        if (msg.cancel === true || msg.fast === false) p.liftSpeed = 1;
        else {
          const rate = msg.rate ?? (msg.fast === true ? 8 : undefined);
          if (!isLiftSpeed(rate)) return;
          // A deliberate choice sets the actual shared lift speed. A previous rider's
          // later pause/disconnect must not undo the newer rider's choice.
          for (const other of this.players.values()) if (other.ride?.lift === p.ride.lift) other.liftSpeed = 1;
          p.liftSpeed = rate;
        }
        this.updateLiftSpeed(p.ride.lift);
        this.broadcast(this.snapshot());
        return;
      }
      case 'chat': {
        const text = String(msg.text ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 200).trim();
        if (text) this.broadcast({ type: 'chat', id: p.id, name: p.name, text });
        return;
      }
      case 'ping':
        p.conn.send({ type: 'pong', t: msg.t, serverTime: now() });
        return;
    }
  }

  private validDrone(d: NetDrone,p: Player,t: number) {
    if (![d.x,d.y,d.z,d.yaw,d.pitch,d.bank,d.tilt].every(Number.isFinite) ||
      !Array.isArray(d.rpm) || d.rpm.length !== 4 || !d.rpm.every(v => Number.isFinite(v) && v >= 0 && v <= 12000)) return false;
    if (!this.flightArea?.contains(d.x,d.z) || d.y < 2000 || d.y > 3500 || Math.abs(d.pitch) > Math.PI/2 || Math.abs(d.bank) > .7 || Math.abs(d.tilt) > .7 || Math.abs(d.yaw)>1e6) return false;
    if (!p.initialized && p.controlMode === 'drone') return true; // A reconnect resumes the aircraft within the validated flight area.
    // First launch and recall must stay near the parked skier. Normal updates are speed-limited.
    const launch = {x:p.s.x,y:p.s.y,z:p.s.z}; this.flightArea.constrain(launch);
    const nearSkier = Math.hypot(d.x-launch.x,d.z-launch.z) < 70;
    if (!p.drone) return nearSkier;
    return nearSkier || Math.hypot(d.x-p.drone.x,d.y-p.drone.y,d.z-p.drone.z) <= (DRONE.fastSpeed+DRONE.climbSpeed)*Math.max(.02,t-p.t)+4;
  }

  /** Authoritative snapshot (riders are placed on their chair by the server's lift clock). */
  snapshot(): ServerMsg {
    const t = now();
    const carriers = new Map<string, ChairSwing>();
    for (const p of this.players.values()) if (p.ride && p.s.swing) {
      const key = `${p.ride.lift}/${p.ride.chair}`, old = carriers.get(key);
      if (!old || swingEnergy(p.s.swing) > swingEnergy(old)) carriers.set(key, p.s.swing);
    }
    for (const p of this.players.values()) {
      if (p.ride) {
        const lift = this.lifts[p.ride.lift];
        if (lift) {
          const liftTime = this.liftClocks[p.ride.lift].now();
          const swing = carriedSwing(p.s.swing ?? createChairSwing(), carriers.get(`${p.ride.lift}/${p.ride.chair}`));
          const lp = swingingRiderPoint(lift, p.ride.chair, p.ride.seat, liftTime, swing);
          p.s = { ...p.s, x: lp.p.x, y: lp.p.y, z: lp.p.z, heading: lp.heading, vx: 0, vy: 0, vz: 0, mode: 'riding' };
          p.t = t;
          // Riders get off themselves (by hand on the ramp, automatically, or flung off the bull wheel) and
          // report it. The deadline frees the seat of a client that never did, e.g. a suspended tab.
          if (liftTime >= (p.unloadAt ?? Infinity) + UNLOAD_GRACE) this.unload(p);
        }
      }
    }
    if (this.guest) {
      const visitors = [...this.players.values()].flatMap<Vec3>(p => p.drone ? [p.drone] :
        p.initialized && p.controlMode !== 'drone' ? [p.s] : []);
      this.guest.advance(t - this.guestTick, this.liftClocks.map(clock => clock.now(t)),
        (lift, chair, seat) => !this.seats.get(`${lift}/${chair}`)?.has(seat), true, visitors);
    }
    this.guestTick = t;
    return { type: 'snapshot', serverTime: t, mountainGuest: this.guest?.pose(), liftPlayback: this.liftClocks.map(clock => clock.snapshot()), players: [...this.players.values()].map(info) };
  }

  broadcast(msg: ServerMsg, except?: string) {
    for (const p of this.players.values()) if (p.id !== except) p.conn.send(msg);
  }

  /** Drop players that have been silent for too long. */
  reap(timeout = 30) {
    const t = now();
    for (const p of [...this.players.values()]) if (t - p.lastRx > timeout) { p.conn.close(); this.leave(p.id); }
  }
}

function info(p: Player): PlayerInfo {
  return { id: p.id, name: p.name, color: p.color, s: p.s, ride: p.ride, t: p.t, drone: p.drone ?? null, controlMode:p.controlMode };
}

export class Lobby {
  rooms = new Map<string, Room>();
  constructor(private lifts: LiftPath[] = loadLifts(), private world?: { navigation: GuestNavigation; colliders: ColliderGrid },
    readonly guestCheckpoints = new Map<string, unknown>()) {}

  private rememberGuest(r: Room) {
    if (!r.guest) return;
    this.guestCheckpoints.delete(r.code);
    this.guestCheckpoints.set(r.code, r.guest.checkpoint());
    while (this.guestCheckpoints.size > 128) this.guestCheckpoints.delete(this.guestCheckpoints.keys().next().value!);
  }

  saveGuests() {
    for (const r of this.rooms.values()) this.rememberGuest(r);
    return this.guestCheckpoints;
  }

  join(conn: Conn, room: string, name: string, color: string, controlMode: 'skier' | 'drone' = 'skier') {
    const code = sanitizeRoom(room);
    if (!code) { conn.send({ type: 'error', reason: 'bad room code' }); return null; }
    let r = this.rooms.get(code);
    if (!r) {
      const seed = Array.from(code).reduce((hash, c) => Math.imul(hash ^ c.charCodeAt(0), 16777619), 2166136261);
      let guest: MountainGuest | undefined;
      if (this.world) {
        const { navigation, colliders } = this.world;
        const saved = readGuestCheckpoint(this.guestCheckpoints.get(code), navigation);
        guest = new MountainGuest(navigation, colliders, seed, saved ?? undefined);
      }
      r = new Room(code, this.lifts, droneArea, guest);
      this.rooms.set(code, r);
    }
    const p = r.join(conn, name, color, controlMode);
    if (!p) { conn.send({ type: 'error', reason: 'room is full (8 players)' }); return null; }
    return { room: r, id: p.id };
  }

  leave(code: string, id: string) {
    const r = this.rooms.get(code);
    if (!r) return;
    r.leave(id);
    if (r.size === 0) { this.rememberGuest(r); this.rooms.delete(code); }
  }

  tick() {
    for (const [code, r] of this.rooms) {
      r.reap();
      if (r.size === 0) { this.rememberGuest(r); this.rooms.delete(code); continue; }
      const snap = r.snapshot();
      r.broadcast(snap);
    }
  }
}

export type { NetSkier };
