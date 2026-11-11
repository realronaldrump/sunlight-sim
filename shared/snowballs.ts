// The same snowball flight and hit rules run in solo play and in the room authority.
import type { Vec3, SkierState } from './skiPhysics';
import { fall } from './skiPhysics';
import type { ColliderGrid } from './collision';
import { coversPoint } from './mountainGuestNavigation';

export const SNOWBALL = { speed: 20, gravity: 12, life: 2.8, cooldown: .85, range: 38, radius: .12, max: 48 } as const;
export interface SnowballActor {
  id: string; name: string; kind: 'player' | 'npc'; pos: Vec3; vel: Vec3; heading: number;
  /** Fallen skiers, lift riders, walkers and drone pilots cannot participate. */
  active: boolean;
}
export interface SnowballShot {
  id: string; owner: string; name: string; at: number; pos: Vec3; vel: Vec3;
}
export interface SnowballHit {
  type: 'hit'; id: string; owner: string; name: string; at: number; pos: Vec3;
  target?: string; targetName?: string; targetPos?: Vec3; velocity?: Vec3; seed: number;
}
export type SnowballEvent = { type: 'throw'; shot: SnowballShot } | SnowballHit;
export interface SnowballFall { at: number; seed: number }

export function snowballPosition(s: SnowballShot, at: number): Vec3 {
  const t = Math.max(0, at - s.at);
  return { x: s.pos.x + s.vel.x * t, y: s.pos.y + s.vel.y * t - .5 * SNOWBALL.gravity * t * t, z: s.pos.z + s.vel.z * t };
}

export function makeSnowball(a: SnowballActor, yaw: number, pitch: number, at: number, id: string): SnowballShot {
  const x = -Math.sin(yaw), z = -Math.cos(yaw);
  return { id, owner: a.id, name: a.name, at,
    pos: { x: a.pos.x + x * .48, y: a.pos.y + 1.3, z: a.pos.z + z * .48 },
    vel: { x: x * SNOWBALL.speed + a.vel.x * .25, y: SNOWBALL.speed * Math.tan(pitch), z: z * SNOWBALL.speed + a.vel.z * .25 } };
}

/** A small moving-target assist, including the thrower's inherited skiing velocity. */
export function aimSnowball(a: SnowballActor, b: SnowballActor) {
  let t = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) / SNOWBALL.speed;
  let dx = 0, dz = 0;
  for (let i = 0; i < 3; i++) {
    dx = b.pos.x - a.pos.x + (b.vel.x - a.vel.x * .25) * t;
    dz = b.pos.z - a.pos.z + (b.vel.z - a.vel.z * .25) * t;
    t = Math.max(.03, (Math.hypot(dx, dz) - .48) / SNOWBALL.speed);
  }
  const dy = b.pos.y + 1.0 - (a.pos.y + 1.3) + b.vel.y * Math.min(t, .4);
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.max(-.55, Math.min(.65, Math.atan2(dy + .5 * SNOWBALL.gravity * t * t, SNOWBALL.speed * t))) };
}

/** A startled loss of balance, rather than an implausible explosion from a ball of snow. */
export function snowballKnockdown(st: SkierState, hit: SnowballHit) {
  const dx = hit.pos.x - st.pos.x, dz = hit.pos.z - st.pos.z, len = Math.hypot(dx, dz) || 1;
  st.vel.x -= dx / len * .65; st.vel.z -= dz / len * .65;
  fall(st, Math.max(2.3, st.speed * .4));
  st.tuck = 0; st.plow = 0;
}

export class SnowballWorld {
  readonly shots = new Map<string, SnowballShot>();
  private lastThrow = new Map<string, number>();
  private lastReply = new Map<string, number>();
  private replies: { npc: string; player: string; due: number }[] = [];
  private tickAt: number | null = null;
  private serial = 0;
  readonly events: SnowballEvent[] = [];
  onHit?: (hit: SnowballHit) => void;

  constructor(private ground: (x: number, z: number) => number, private obstacles?: ColliderGrid) {}

  throw(a: SnowballActor, yaw: number, pitch: number, at: number, token?: string) {
    if (!a.active || ![yaw, pitch, at].every(Number.isFinite) || Math.abs(pitch) > .66 || Math.abs(yaw) > Math.PI * 4 ||
        at - (this.lastThrow.get(a.id) ?? -Infinity) < SNOWBALL.cooldown || this.shots.size >= SNOWBALL.max) return null;
    this.lastThrow.set(a.id, at);
    this.tickAt ??= at;
    const id = `${a.id}/${token ?? ++this.serial}`;
    if (this.shots.has(id)) return null;
    const shot = makeSnowball(a, yaw, pitch, at, id);
    this.shots.set(id, shot); this.events.push({ type: 'throw', shot });
    return shot;
  }

  advance(at: number, actors: readonly SnowballActor[]) {
    // Drop a long suspended frame rather than replaying a fight into a new scene.
    const from = Math.max(at - .25, this.tickAt ?? at - 1 / 60);
    this.tickAt = at;
    for (const shot of this.shots.values()) {
      const start = Math.max(from, shot.at), end = Math.min(at, shot.at + SNOWBALL.life);
      const steps = Math.ceil(Math.max(0, end - start) * 150);
      let hit: SnowballHit | null = null;
      for (let i = 0; i <= steps; i++) {
        const t = steps ? start + (end - start) * i / steps : end;
        const pos = snowballPosition(shot, t);
        // Fine substeps prevent tunnelling through a body, trunk or wall between network ticks.
        const blocked = pos.y <= this.ground(pos.x, pos.z) + SNOWBALL.radius ||
          this.obstacles?.query(pos.x, pos.z).some(c => pos.y - SNOWBALL.radius <= c.top &&
            (c.bottom === undefined || pos.y + SNOWBALL.radius >= c.bottom) && coversPoint(c, pos.x, pos.z, SNOWBALL.radius));
        const target = blocked ? undefined : actors.find(a => a.active && a.id !== shot.owner &&
          Math.hypot(pos.x - (a.pos.x + a.vel.x * (t - at)), pos.z - (a.pos.z + a.vel.z * (t - at))) < .48 + SNOWBALL.radius &&
          pos.y > a.pos.y + .15 && pos.y < a.pos.y + 1.78);
        if (blocked || target) {
          const seed = Array.from(shot.id).reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
          hit = { type: 'hit', id: shot.id, owner: shot.owner, name: shot.name, at: t, pos, seed,
            ...(target ? { target: target.id, targetName: target.name, targetPos: { ...target.pos }, velocity: { ...target.vel } } : {}) };
          if (target) target.active = false;
          if (target?.kind === 'npc' && actors.find(a => a.id === shot.owner)?.kind === 'player' &&
              at - (this.lastReply.get(target.id) ?? -Infinity) > 8) {
            this.lastReply.set(target.id, at);
            this.replies.push({ npc: target.id, player: shot.owner, due: at + 5.2 + (seed % 10) * .08 });
          }
          break;
        }
      }
      if (hit || at - shot.at > SNOWBALL.life) {
        this.shots.delete(shot.id);
        if (hit) { this.events.push(hit); this.onHit?.(hit); }
      }
    }
    this.replies = this.replies.filter(r => {
      if (at < r.due) return true;
      const a = actors.find(a => a.id === r.npc), b = actors.find(a => a.id === r.player);
      if (!a || !b) return false;
      if (!a.active && at < r.due + 5) return true; // finish gathering their skis first
      if (a.active && b.active && Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) < SNOWBALL.range) {
        const aim = aimSnowball(a, b); this.throw(a, aim.yaw, aim.pitch, at);
      }
      return false;
    });
    const ids = new Set(actors.map(a => a.id));
    for (const map of [this.lastThrow, this.lastReply]) for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
  }

  drain() { return this.events.splice(0); }
}
