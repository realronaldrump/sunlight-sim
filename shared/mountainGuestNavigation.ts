// The guest plans over measured snow. Trail lines supply destinations and checkpoints,
// while this grid supplies traversable lines between them, including the working lifts.
import { FlightArea } from './dronePhysics';
import type { Collider, ColliderGrid } from './collision';
import type { LiftPath } from './lifts';
import type { TerrainProbe } from './skiPhysics';
import type { SantaFirStop } from './santaFestivities';
import { ornamentBranches } from './treeData';

export interface Point { x: number; z: number }
export interface GuestWaypoint extends Point { lift?: number; gate?: 'approach' | 'exit' }
export interface GuestRun { id: number; name: string; difficulty: string; kind: string; points: number[][] }
export interface GuestCourse { run: GuestRun; marks: Point[] }

const CELL = 5;
const NEIGHBORS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

export function guestCourses(runs: GuestRun[]): GuestCourse[] {
  return runs.filter(r => r.kind === 'line' && r.difficulty !== 'hike' && r.points.length > 1).map(run => {
    // Retain the endpoints and sample by distance, including on sparsely mapped runs.
    const points = run.points[0][1] >= run.points.at(-1)![1] ? run.points : run.points.slice().reverse();
    const marks: Point[] = [{ x: points[0][0], z: points[0][2] }];
    let next = 34;
    for (let i = 1; i < points.length; i++) {
      const [ax, , az] = points[i - 1], [bx, , bz] = points[i];
      const len = Math.hypot(bx - ax, bz - az);
      while (next < len) {
        marks.push({ x: ax + (bx - ax) * next / len, z: az + (bz - az) * next / len });
        next += 34;
      }
      next -= len;
    }
    const [x, , z] = points.at(-1)!;
    marks.push({ x, z });
    return { run, marks };
  });
}

export function coversPoint(c: Collider, x: number, z: number, padding = 0) {
  const dx = x - c.x, dz = z - c.z;
  if (c.type === 'cyl') return dx * dx + dz * dz < ((c.r ?? 0) + padding) ** 2;
  const cos = Math.cos(c.yaw ?? 0), sin = Math.sin(c.yaw ?? 0);
  return Math.abs(dx * cos - dz * sin) < c.hx! + padding && Math.abs(dx * sin + dz * cos) < c.hz! + padding;
}

interface LiftLink {
  index: number; seat: number; from: number; to: number; load: Point; approach: GuestWaypoint; exit: GuestWaypoint;
}

class Frontier {
  private entries: { node: number; priority: number }[] = [];
  get size() { return this.entries.length; }
  push(node: number, priority: number) {
    const entries = this.entries;
    let i = entries.length;
    entries.push({ node, priority });
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (entries[parent].priority <= priority) break;
      entries[i] = entries[parent]; i = parent;
    }
    entries[i] = { node, priority };
  }
  pop() {
    const entries = this.entries, node = entries[0].node, last = entries.pop()!;
    if (!entries.length) return node;
    let i = 0;
    while (i * 2 + 1 < entries.length) {
      let child = i * 2 + 1;
      if (entries[child + 1] && entries[child + 1].priority < entries[child].priority) child++;
      if (last.priority <= entries[child].priority) break;
      entries[i] = entries[child]; i = child;
    }
    entries[i] = last;
    return node;
  }
}

export class GuestNavigation {
  readonly courses: GuestCourse[];
  readonly liftLinks: LiftLink[] = [];
  private area: FlightArea;
  private x0: number;
  private z0: number;
  private width: number;
  private rows: number;
  private heights: Float32Array;
  private snow: Float32Array;
  private edges: Int16Array;
  private contacts: Collider[] = [];

  constructor(boundary: number[][], runs: GuestRun[], readonly lifts: LiftPath[], readonly probe: TerrainProbe,
    private colliders: ColliderGrid, canopy: (x: number, z: number) => number) {
    this.area = new FlightArea(boundary);
    this.courses = guestCourses(runs);
    this.x0 = Math.floor(Math.min(...boundary.map(p => p[0])) / CELL) * CELL;
    this.z0 = Math.floor(Math.min(...boundary.map(p => p[2])) / CELL) * CELL;
    this.width = Math.ceil((Math.max(...boundary.map(p => p[0])) - this.x0) / CELL) + 1;
    this.rows = Math.ceil((Math.max(...boundary.map(p => p[2])) - this.z0) / CELL) + 1;
    const size = this.width * this.rows;
    this.heights = new Float32Array(size).fill(NaN);
    this.snow = new Float32Array(size);
    this.edges = new Int16Array(size).fill(-1);
    for (let i = 0; i < size; i++) {
      const { x, z } = this.point(i);
      if (!this.area.contains(x, z)) continue;
      const y = this.probe.height(x, z);
      if (this.blocked(x, z, y, .85)) continue;
      this.heights[i] = y;
      const s = this.probe.surface(x, z);
      this.snow[i] = (1 - Math.max(s.piste, s.groomed)) * (2 + 5 * canopy(x, z));
    }
    lifts.forEach((lift, index) => {
      const seat = Math.floor((lift.def.seats - 1) / 2), offset = lift.seatOffset(seat);
      const p = lift.loadPoint(), u = lift.unloadPoint(seat);
      const load = { x: p.x + lift.rx * offset, z: p.z + lift.rz * offset };
      const approach: GuestWaypoint = { x: load.x - lift.ax * 4, z: load.z - lift.az * 4, gate: 'approach' };
      const exit: GuestWaypoint = { x: u.x + lift.ax * 5, z: u.z + lift.az * 5, gate: 'exit' };
      const from = this.nearest(approach, 18, true), to = this.nearest(exit, 18, true);
      if (from >= 0 && to >= 0) this.liftLinks.push({ index, seat, from, to, load, approach, exit });
    });
  }

  contains(x: number, z: number) { return this.area.contains(x, z); }

  blocked(x: number, z: number, y: number, padding: number) {
    return this.colliders.query(x, z, this.contacts).some(c => c.top > y + .3 && (c.bottom === undefined || y + 1.65 > c.bottom) && coversPoint(c, x, z, padding));
  }

  /** Find a real bough near safe snow, with enough clearance for a brief stop. */
  santaFirStop(p: Point): SantaFirStop | null {
    const trees = new Set(this.colliders.query(p.x, p.z));
    const here = this.probe.height(p.x, p.z);
    let best: SantaFirStop | null = null, closest = 11;
    for (const c of trees) {
      const tree = c.fir;
      if (!tree || Math.abs(tree.y - here) > 4.2 || distance(p, tree) > 14) continue;
      if (this.colliders.query(tree.x, tree.z, this.contacts).some(b => b.type === 'box' && coversPoint(b, tree.x, tree.z))) continue;
      for (const anchor of ornamentBranches(tree, here + 4.2)) {
        const dx = anchor.x - tree.x, dz = anchor.z - tree.z, radius = Math.hypot(dx, dz) || 1;
        const at = { x: anchor.x + (dx * .69 - dz * .10) / radius, z: anchor.z + (dz * .69 + dx * .10) / radius };
        const d = distance(at, p);
        if (d >= closest || !this.contains(at.x, at.z)) continue;
        const ground = this.probe.height(at.x, at.z), reach = anchor.y - ground;
        if (reach < 1.29 || reach > 1.77 || this.probe.normal(at.x, at.z, { x: 0, y: 1, z: 0 }).y < .961) continue;
        if (this.blocked(at.x, at.z, ground, .64) || !this.clear(p, at, .60, .46)) continue;
        best = { at, anchor };
        closest = d;
      }
    }
    return best;
  }

  private point(i: number): Point { return { x: this.x0 + (i % this.width) * CELL, z: this.z0 + Math.floor(i / this.width) * CELL }; }
  private index(x: number, z: number) { return z >= 0 && z < this.rows && x >= 0 && x < this.width ? z * this.width + x : -1; }

  nearest(p: Point, radius = 22, clear = false) {
    const ix = Math.round((p.x - this.x0) / CELL), iz = Math.round((p.z - this.z0) / CELL);
    const n = Math.ceil(radius / CELL);
    let best = -1, bestCost = Infinity;
    for (let dz = -n; dz <= n; dz++) for (let dx = -n; dx <= n; dx++) {
      const i = this.index(ix + dx, iz + dz);
      if (i < 0 || !Number.isFinite(this.heights[i])) continue;
      const point = this.point(i);
      const cost = distance(p, point) + this.snow[i] * 1.6;
      if (cost >= bestCost || distance(p, point) > radius || (clear && !this.clear(p, point, .58))) continue;
      best = i; bestCost = cost;
    }
    return best;
  }

  /** Check a short segment for trunks, rock/road cuts and excessively steep uphill steps. */
  clear(a: Point, b: Point, margin: number, uphill = .7) {
    const len = distance(a, b), steps = Math.ceil(len / 1.2);
    if (!steps) return true;
    const dx = (b.x - a.x) / steps, dz = (b.z - a.z) / steps, step = len / steps;
    let prev = this.probe.height(a.x, a.z);
    for (let i = 1; i <= steps; i++) {
      const x = a.x + dx * i, z = a.z + dz * i, y = this.probe.height(x, z);
      if (!this.area.contains(x, z) || y - prev > step * uphill + .16 || prev - y > step * 1.45 + .18 || this.blocked(x, z, y, margin)) return false;
      prev = y;
    }
    return true;
  }

  private links(i: number) {
    if (this.edges[i] >= 0) return this.edges[i];
    let bits = 0;
    const x = i % this.width, z = Math.floor(i / this.width), a = this.point(i);
    NEIGHBORS.forEach(([dx, dz], bit) => {
      const next = this.index(x + dx, z + dz);
      if (next >= 0 && Number.isFinite(this.heights[next]) && this.clear(a, this.point(next), .61)) bits |= 1 << bit;
    });
    return this.edges[i] = bits;
  }

  /** Live A* with a seeded preference for different lanes. Uplift is a real boarding action. */
  private route(start: number, goal: number, seed: number, useLifts: boolean) {
    const frontier = new Frontier(), end = this.point(goal);
    const parent = new Map<number, { from: number; lift?: LiftLink }>();
    const cost = new Map([[start, 0]]);
    const closed = new Set<number>();
    frontier.push(start, 0);
    while (frontier.size) {
      const from = frontier.pop();
      if (from === goal) {
        const result: GuestWaypoint[] = [];
        for (let node = goal; node !== start;) {
          const p = parent.get(node)!;
          result.push(this.point(node));
          if (p.lift) result.push(p.lift.exit, { ...p.lift.load, lift: p.lift.index }, p.lift.approach);
          node = p.from;
        }
        return result.reverse();
      }
      if (closed.has(from)) continue;
      closed.add(from);
      const add = (next: number, step: number, lift?: LiftLink) => {
        const total = cost.get(from)! + step;
        if (total >= (cost.get(next) ?? Infinity)) return;
        cost.set(next, total); parent.set(next, { from, lift });
        frontier.push(next, total + distance(end, this.point(next)));
      };
      const bits = this.links(from);
      for (let k = 0; k < 8; k++) {
        if (!(bits & 1 << k)) continue;
        const [dx, dz] = NEIGHBORS[k], next = from + dx + dz * this.width;
        const length = dx && dz ? CELL * Math.SQRT2 : CELL;
        const climb = Math.max(0, this.heights[next] - this.heights[from] - .25);
        const noise = (Math.imul((next >> 1) ^ seed, 0x45d9f3b) >>> 24) / 255;
        add(next, length * (1 + this.snow[next] + .52 * noise) + climb * 34);
      }
      if (useLifts) for (const lift of this.liftLinks) {
        if (lift.from === from) add(lift.to, 38 + this.lifts[lift.index].rideTime() * 3, lift);
      }
    }
    return null;
  }

  detour(from: Point, to: Point, seed: number) {
    const start = this.nearest(from, 24, true), end = this.nearest(to, 16);
    if (start < 0 || end < 0) return null;
    const tail = this.route(start, end, seed, false);
    return tail ? [this.point(start), ...tail] : null;
  }

  safeStart(p: Point) {
    const i = this.nearest(p);
    return i < 0 ? null : this.point(i);
  }

  /** Plan to the top and through the selected run, allowing detours around hazards. */
  plan(p: Point, course: GuestCourse, seed: number, useLifts: boolean) {
    let from = this.nearest(p, 34, true);
    if (from < 0) return null;
    const result: GuestWaypoint[] = [this.point(from)];
    // For a significant ascent, favor a lift he can reach from below. The
    // normal graph can still use a second lift, or detour without a lift.
    if (useLifts) {
      const top = course.marks[0], here = this.probe.height(p.x, p.z), target = this.probe.height(top.x, top.z);
      const links = this.liftLinks.filter(l => {
        const station = this.heights[l.from], summit = this.heights[l.to];
        return target > here + 55 && station < here + 36 && summit > target - 75 && summit > here + 80;
      });
      const liftCost = (l: LiftLink) => distance(p, l.approach) + 1.2 * distance(top, l.exit) + Math.max(0, this.heights[l.from] - here) * 18;
      links.sort((a, b) => liftCost(a) - liftCost(b));
      for (const link of links) {
        const approach = this.route(from, link.from, seed, false);
        if (!approach) continue;
        result.push(...approach, link.approach, { ...link.load, lift: link.index }, link.exit, this.point(link.to));
        from = link.to;
        break;
      }
    }
    for (const [i, mark] of course.marks.entries()) {
      const goal = this.nearest(mark);
      if (goal < 0) return null;
      const part = this.route(from, goal, seed + i, useLifts && i === 0);
      if (!part) return null;
      for (const wp of part) result.push(wp);
      from = goal;
    }
    return result;
  }
}
