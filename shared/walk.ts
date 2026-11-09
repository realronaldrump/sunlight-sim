// On-foot movement in ski boots: walking and jogging over snow, building floors, decks and stairs.
// Shared by the client and tests. Building floors are oriented rectangles (optionally sloped like a
// stair flight); walls, furniture and trees are the same ColliderGrid obstacles the skier uses.
import type { Collider, ColliderGrid } from './collision';

/** Oriented walkable rectangle. Height is y0 at local z = -hz and y1 at +hz (stairs and ramps). */
export interface WalkSurface { cx: number; cz: number; yaw: number; hx: number; hz: number; y0: number; y1?: number; name?: string }
/** Enclosed interior volume (for lighting, camera and eye adaptation). */
export interface IndoorVolume { cx: number; cz: number; yaw: number; hx: number; hz: number; y0: number; y1: number; name: string }

export function toLocal(s: { cx: number; cz: number; yaw: number }, x: number, z: number) {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), dx = x - s.cx, dz = z - s.cz;
  return { lx: c * dx - sn * dz, lz: sn * dx + c * dz };
}
export function toWorld(s: { cx: number; cz: number; yaw: number }, lx: number, lz: number) {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  return { x: s.cx + c * lx + sn * lz, z: s.cz - sn * lx + c * lz };
}

const CELL = 16;
const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

export class WalkSurfaces {
  readonly surfaces: WalkSurface[] = [];
  readonly volumes: IndoorVolume[] = [];
  private grid = new Map<number, number[]>();
  private vgrid = new Map<number, number[]>();

  private index(map: Map<number, number[]>, s: { cx: number; cz: number; hx: number; hz: number }, id: number) {
    const r = Math.hypot(s.hx, s.hz);
    for (let i = Math.floor((s.cx - r) / CELL); i <= Math.floor((s.cx + r) / CELL); i++)
      for (let j = Math.floor((s.cz - r) / CELL); j <= Math.floor((s.cz + r) / CELL); j++) {
        const k = key(i, j); let a = map.get(k); if (!a) map.set(k, a = []); a.push(id);
      }
  }
  add(s: WalkSurface) { this.surfaces.push(s); this.index(this.grid, s, this.surfaces.length - 1); }
  addVolume(v: IndoorVolume) { this.volumes.push(v); this.index(this.vgrid, v, this.volumes.length - 1); }

  /** Heights of every surface under (x, z). */
  heightsAt(x: number, z: number, out: number[] = []) {
    out.length = 0;
    const ids = this.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!ids) return out;
    for (const id of ids) {
      const s = this.surfaces[id];
      const { lx, lz } = toLocal(s, x, z);
      if (Math.abs(lx) > s.hx || Math.abs(lz) > s.hz) continue;
      const t = (lz + s.hz) / (2 * s.hz);
      out.push(s.y1 === undefined ? s.y0 : s.y0 + (s.y1 - s.y0) * t);
    }
    return out;
  }

  indoor(x: number, y: number, z: number): IndoorVolume | null {
    const ids = this.vgrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!ids) return null;
    for (const id of ids) {
      const v = this.volumes[id];
      if (y < v.y0 - 0.2 || y > v.y1) continue;
      const { lx, lz } = toLocal(v, x, z);
      if (Math.abs(lx) <= v.hx && Math.abs(lz) <= v.hz) return v;
    }
    return null;
  }

  clear() { this.surfaces.length = 0; this.volumes.length = 0; this.grid.clear(); this.vgrid.clear(); }
}

export interface WalkState {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  heading: number;   // facing direction, same convention as the skier (0 = -z, + = toward -x)
  grounded: boolean;
  speed: number;     // horizontal m/s
  stride: number;    // gait phase in strides (for animation and footsteps)
  onSnow: boolean;   // standing on terrain snow rather than a built floor
  indoor: string | null;
}
/** Desired horizontal motion in world space; |(x, z)| <= 1. */
export interface WalkInput { x: number; z: number; run: boolean }

export const WALK = {
  radius: 0.28,
  walk: 1.15,         // m/s: deliberate walking pace in stiff alpine ski boots
  run: 2.3,           // m/s: a clumsy jog in ski boots
  accel: 5.5, decel: 8,
  stepUp: 0.42,       // tallest step taken without a climb (stair risers are 0.18 m)
  headroom: 1.95,     // clearance needed to walk under a deck or landing
  snapDown: 0.55,
  gravity: 9.81,
  turnRate: 7,        // rad/s
  strideLength: 0.62, // m per step in ski boots
  /** Snow steeper than this slows walking; the boot slips on anything above `maxSnowSlope`. */
  slowSlope: 14, maxSnowSlope: 32,
};

export function createWalker(x: number, y: number, z: number, heading: number): WalkState {
  return { pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, heading, grounded: true, speed: 0, stride: 0, onSnow: true, indoor: null };
}

const heights: number[] = [];
/** Supporting surface height under (x, z) for feet currently at `y`, or null if every surface is a wall. */
export function supportHeight(x: number, z: number, y: number, terrain: (x: number, z: number) => number, surfaces: WalkSurfaces) {
  let best = -Infinity, onSnow = false;
  const t = terrain(x, z);
  if (t <= y + WALK.stepUp) { best = t; onSnow = true; }
  for (const h of surfaces.heightsAt(x, z, heights)) {
    if (h <= y + WALK.stepUp) { if (h > best) { best = h; onSnow = false; } }
    else if (h < y + WALK.headroom) return null; // a floor edge too high to step onto and too low to pass under
  }
  return best === -Infinity ? null : { h: best, onSnow };
}

function overlaps(c: Collider, y: number) {
  // ignore obstacles entirely below the knees (kerbs, benches seen as steps) or above the head
  return y < c.top - 0.35 && (c.bottom === undefined || y + 1.75 > c.bottom);
}

/** Push a circle out of cylinders and oriented boxes; returns contact normals summed. */
export function resolveWalkCollisions(st: WalkState, colliders: ColliderGrid, out: Collider[] = []) {
  const r = WALK.radius;
  for (let iter = 0; iter < 2; iter++) {
    for (const c of colliders.query(st.pos.x, st.pos.z, out)) {
      if (!overlaps(c, st.pos.y)) continue;
      if (c.type === 'cyl') {
        const dx = st.pos.x - c.x, dz = st.pos.z - c.z, d = Math.hypot(dx, dz), min = c.r! + r;
        if (d >= min || d < 1e-6) continue;
        const nx = dx / d, nz = dz / d;
        st.pos.x = c.x + nx * min; st.pos.z = c.z + nz * min;
        const vn = st.vel.x * nx + st.vel.z * nz; if (vn < 0) { st.vel.x -= nx * vn; st.vel.z -= nz * vn; }
      } else {
        const yaw = c.yaw ?? 0, cs = Math.cos(yaw), sn = Math.sin(yaw);
        const dx = st.pos.x - c.x, dz = st.pos.z - c.z;
        const lx = cs * dx - sn * dz, lz = sn * dx + cs * dz;
        // closest point on the box, so corners are rounded and sliding along walls is smooth
        const qx = Math.max(-c.hx!, Math.min(c.hx!, lx)), qz = Math.max(-c.hz!, Math.min(c.hz!, lz));
        let ex = lx - qx, ez = lz - qz, d = Math.hypot(ex, ez);
        if (d >= r) continue;
        if (d < 1e-6) { // centre inside: leave along the shallowest face
          const px = c.hx! - Math.abs(lx), pz = c.hz! - Math.abs(lz);
          if (px < pz) { ex = Math.sign(lx) || 1; ez = 0; } else { ex = 0; ez = Math.sign(lz) || 1; }
          d = 0;
        } else { ex /= d; ez /= d; }
        const push = r - d + (d === 0 ? Math.min(c.hx! - Math.abs(lx), c.hz! - Math.abs(lz)) : 0);
        const nx = cs * ex + sn * ez, nz = -sn * ex + cs * ez;
        st.pos.x += nx * push; st.pos.z += nz * push;
        const vn = st.vel.x * nx + st.vel.z * nz; if (vn < 0) { st.vel.x -= nx * vn; st.vel.z -= nz * vn; }
      }
    }
  }
}

/** Advance the walker by dt. `terrain` is the snow surface (DEM plus groomed station snow). */
export function stepWalker(st: WalkState, inp: WalkInput, terrain: (x: number, z: number) => number, surfaces: WalkSurfaces, colliders: ColliderGrid, dt: number) {
  const len = Math.hypot(inp.x, inp.z), mag = Math.min(1, len);
  const dirx = len > 1e-6 ? inp.x / len : 0, dirz = len > 1e-6 ? inp.z / len : 0;
  let target = (inp.run ? WALK.run : WALK.walk) * mag;
  // steep snow slows a booted walker and stops them below the slip limit
  if (st.onSnow && st.grounded && mag > 0) {
    const e = 0.6, h0 = terrain(st.pos.x, st.pos.z);
    const ahead = terrain(st.pos.x + dirx * e, st.pos.z + dirz * e);
    const grade = Math.atan2(ahead - h0, e) * 180 / Math.PI;
    if (grade > WALK.slowSlope) target *= Math.max(0.12, 1 - (grade - WALK.slowSlope) / (WALK.maxSnowSlope - WALK.slowSlope));
  }
  const tx = dirx * target, tz = dirz * target;
  const rate = mag > 0 ? WALK.accel : WALK.decel;
  const k = Math.min(1, rate * dt / Math.max(0.2, Math.hypot(tx - st.vel.x, tz - st.vel.z)));
  st.vel.x += (tx - st.vel.x) * k; st.vel.z += (tz - st.vel.z) * k;
  // turn the body toward the travel direction at a human rate
  if (mag > 0.05) {
    const want = Math.atan2(-dirx, -dirz);
    let d = want - st.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    st.heading += Math.sign(d) * Math.min(Math.abs(d), WALK.turnRate * dt);
  }
  const px = st.pos.x, pz = st.pos.z;
  st.pos.x += st.vel.x * dt; st.pos.z += st.vel.z * dt;
  resolveWalkCollisions(st, colliders);
  // vertical: step onto floors and stairs, fall off ledges
  const sup = supportHeight(st.pos.x, st.pos.z, st.pos.y, terrain, surfaces);
  if (!sup) { st.pos.x = px; st.pos.z = pz; st.vel.x = 0; st.vel.z = 0; }
  const ground = sup ?? supportHeight(st.pos.x, st.pos.z, st.pos.y + 1, terrain, surfaces);
  if (ground) {
    if (st.grounded && st.pos.y - ground.h <= WALK.snapDown) { st.pos.y = ground.h; st.vel.y = 0; }
    else {
      st.vel.y -= WALK.gravity * dt; st.pos.y += st.vel.y * dt;
      if (st.pos.y <= ground.h) { st.pos.y = ground.h; st.vel.y = 0; }
    }
    st.grounded = st.pos.y - ground.h < 0.02;
    st.onSnow = ground.onSnow;
  }
  st.speed = Math.hypot(st.vel.x, st.vel.z);
  st.stride += st.speed * dt / WALK.strideLength;
  st.indoor = surfaces.indoor(st.pos.x, st.pos.y + 0.9, st.pos.z)?.name ?? null;
}
