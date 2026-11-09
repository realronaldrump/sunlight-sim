// Room and authority logic, independent of the transport so it can be unit tested.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LiftPath, LiftDef, LOAD_OFFSET, MAX_BOARD_SPEED } from '../../shared/lifts';
import {
  ClientMsg, ServerMsg, PlayerInfo, NetSkier, MAX_PLAYERS, MAX_SPEED, sanitizeName, sanitizeColor, sanitizeRoom,
} from '../../shared/protocol';

export interface Conn { send(msg: ServerMsg): void; close(): void }

interface Player extends PlayerInfo { conn: Conn; lastRx: number; unloadAt?: number }

let liftCache: LiftPath[] | null = null;
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
  players = new Map<string, Player>();
  // seat occupancy: `${lift}/${chair}` -> seat -> player id
  seats = new Map<string, Map<number, string>>();
  constructor(public code: string, private lifts: LiftPath[]) {}

  get size() { return this.players.size; }

  join(conn: Conn, name: string, color: string): Player | null {
    if (this.players.size >= MAX_PLAYERS) return null;
    const id = 'p' + (nextId++).toString(36);
    const p: Player = {
      id, name: sanitizeName(name), color: sanitizeColor(color), conn, lastRx: now(), t: now(), ride: null,
      s: { x: 0, y: 0, z: 0, heading: 0, vx: 0, vy: 0, vz: 0, mode: 'standing', edge: 0, plow: 0, tuck: 0, fallen: 0 },
    };
    this.players.set(id, p);
    conn.send({ type: 'welcome', id, room: this.code, serverTime: now(), players: [...this.players.values()].filter((q) => q.id !== id).map(info) });
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
    const k = `${p.ride.lift}/${p.ride.chair}`;
    const m = this.seats.get(k);
    if (m && m.get(p.ride.seat) === p.id) m.delete(p.ride.seat);
    if (m && m.size === 0) this.seats.delete(k);
    p.ride = null;
    p.unloadAt = undefined;
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
        if (p.ride) { p.s = { ...p.s, mode: 'riding' }; p.t = t; return; } // chair position is server-derived
        const dt = Math.max(0.02, t - p.t);
        const dist = Math.hypot(s.x - p.s.x, s.z - p.s.z);
        const first = p.s.x === 0 && p.s.z === 0;
        if (!first && !msg.teleport && dist > MAX_SPEED * dt + 5) {
          // implausible jump: keep the authoritative position and tell the client
          p.conn.send({ type: 'correct', s: p.s });
          return;
        }
        const sp = Math.hypot(s.vx, s.vy, s.vz);
        const k = sp > MAX_SPEED ? MAX_SPEED / sp : 1;
        p.s = { ...s, vx: s.vx * k, vy: s.vy * k, vz: s.vz * k, mode: String(s.mode).slice(0, 12) };
        p.t = t;
        return;
      }
      case 'board': {
        const lift = this.lifts[msg.lift];
        const reject = (reason: string) => p.conn.send({ type: 'boardRejected', reason });
        if (!Number.isInteger(msg.lift) || !lift) { reject('no such lift'); return; }
        if (!Number.isInteger(msg.chair) || msg.chair < 0 || msg.chair >= lift.chairCount || !Number.isInteger(msg.seat) || msg.seat < 0 || msg.seat >= lift.def.seats) {
          reject('invalid chair or seat'); return;
        }
        if (p.ride) {
          if (p.ride.lift === msg.lift && p.ride.chair === msg.chair) p.conn.send({ type: 'boarded', id: p.id, ...p.ride });
          else reject('already riding');
          return;
        }
        const along = (p.s.x - lift.def.bottom[0]) * lift.ax + (p.s.z - lift.def.bottom[2]) * lift.az;
        if (!lift.inLoadZone(p.s.x, p.s.z) || Math.abs(along - LOAD_OFFSET) > 0.8 || Math.abs(p.s.y - lift.stationHeight(false)) > 0.8 ||
            !['standing', 'skiing'].includes(p.s.mode) || Math.hypot(p.s.vx, p.s.vy, p.s.vz) > MAX_BOARD_SPEED ||
            Math.cos(p.s.heading - lift.loadPoint().heading) < 0.5) {
          reject('stand facing uphill at the load line'); return;
        }
        // A bounded network allowance around the load crossing, not anywhere on the loop.
        const u = lift.chairU(msg.chair, t);
        const delta = Math.abs(u - lift.loadU), du = Math.min(delta, lift.loopLen - delta);
        if (du > lift.def.speed * 0.75 + 0.15) {
          p.conn.send({ type: 'boardRejected', reason: 'chair not at the load line' }); return;
        }
        const key = `${msg.lift}/${msg.chair}`;
        let m = this.seats.get(key);
        if (!m) { m = new Map(); this.seats.set(key, m); }
        let seat = msg.seat;
        if (m.has(seat)) {
          const free = [...Array(lift.def.seats).keys()].filter((i) => !m!.has(i));
          if (!free.length) { p.conn.send({ type: 'boardRejected', reason: 'chair full' }); return; }
          free.sort((a, b) => Math.abs(a - seat) - Math.abs(b - seat));
          seat = free[0];
        }
        m.set(seat, p.id);
        p.ride = { lift: msg.lift, chair: msg.chair, seat };
        p.unloadAt = t + lift.remainingRideTime(msg.chair, t);
        this.broadcast({ type: 'boarded', id: p.id, ...p.ride });
        return;
      }
      case 'unload':
        this.unload(p);
        return;
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

  /** Authoritative snapshot (riders are placed on their chair by the server's lift clock). */
  snapshot(): ServerMsg {
    const t = now();
    for (const p of this.players.values()) {
      if (p.ride) {
        const lift = this.lifts[p.ride.lift];
        if (lift) {
          const lp = lift.riderPoint(p.ride.chair, p.ride.seat, t);
          p.s = { ...p.s, x: lp.p.x, y: lp.p.y, z: lp.p.z, heading: lp.heading, vx: 0, vy: 0, vz: 0, mode: 'riding' };
          p.t = t;
          // Deadline also catches a suspended client which missed an entire loop.
          if (t >= (p.unloadAt ?? Infinity) || !lp.uphill) this.unload(p);
        }
      }
    }
    return { type: 'snapshot', serverTime: t, players: [...this.players.values()].map(info) };
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
  return { id: p.id, name: p.name, color: p.color, s: p.s, ride: p.ride, t: p.t };
}

export class Lobby {
  rooms = new Map<string, Room>();
  constructor(private lifts: LiftPath[] = loadLifts()) {}

  join(conn: Conn, room: string, name: string, color: string) {
    const code = sanitizeRoom(room);
    if (!code) { conn.send({ type: 'error', reason: 'bad room code' }); return null; }
    let r = this.rooms.get(code);
    if (!r) { r = new Room(code, this.lifts); this.rooms.set(code, r); }
    const p = r.join(conn, name, color);
    if (!p) { conn.send({ type: 'error', reason: 'room is full (8 players)' }); return null; }
    return { room: r, id: p.id };
  }

  leave(code: string, id: string) {
    const r = this.rooms.get(code);
    if (!r) return;
    r.leave(id);
    if (r.size === 0) this.rooms.delete(code);
  }

  tick() {
    for (const [code, r] of this.rooms) {
      r.reap();
      if (r.size === 0) { this.rooms.delete(code); continue; }
      const snap = r.snapshot();
      r.broadcast(snap);
    }
  }
}

export type { NetSkier };
