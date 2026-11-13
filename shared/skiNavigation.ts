import { Frontier, type GuestNavigation, type GuestRun, type Point } from './mountainGuestNavigation';

export type RouteMode = 'ski' | 'walk' | 'lift';
export interface RouteLeg {
  mode: RouteMode; name: string; difficulty?: string; lift?: number;
  points: Point[]; distance: number;
}
export interface SkiRoute {
  destination: Point; legs: RouteLeg[]; distance: number; walking: number; seconds: number;
}
export interface SharedRoute { destination: Point; route: SkiRoute | null }
export interface MapRoute extends SharedRoute { id: string; name: string; color: string; self?: boolean }
export const routeDistance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.z - a.z);
const copyPoint = (p: Point): Point => ({ x: p.x, z: p.z });
const WALK_PRIORITY = 1_000_000;
const rating: Record<string, number> = { green: 1, blue: 1.25, black: 2.2, double: 3.8, park: 2.5, hike: 2 };
interface Travel { walk: number; cost: number; seconds: number }

/** Directed routing on the measured snow, with walking minimized before travel cost.
 * The 5 m graph is sampled at <=1.2 m along every edge. Skiing includes poling
 * on nearly level snow, but cannot climb a hillside to avoid taking a lift. */
export class SkiNavigation {
  private grid;
  private runs: GuestRun[];
  private runAt: Int16Array;
  private costs: Float32Array;
  private walks: Float32Array;
  constructor(readonly nav: GuestNavigation, runs: GuestRun[]) {
    this.grid = nav.routingGrid();
    this.runs = runs.filter(r => r.kind === 'line');
    this.runAt = new Int16Array(this.grid.heights.length).fill(-1);
    this.costs = new Float32Array(this.grid.heights.length * 8).fill(-1);
    this.walks = new Float32Array(this.costs.length);
    // Rasterize named trail corridors for instruction names and difficulty costs.
    // Geometry still has to pass terrain and collision checks, even on a mapped run.
    const nearest = new Float32Array(this.runAt.length).fill(Infinity);
    const g = this.grid;
    this.runs.forEach((run, ri) => {
      for (let k = 1; k < run.points.length; k++) {
        const [ax, , az] = run.points[k - 1], [bx, , bz] = run.points[k];
        const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz || 1;
        const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - 24 - g.x0) / g.cell));
        const x1 = Math.min(g.width - 1, Math.ceil((Math.max(ax, bx) + 24 - g.x0) / g.cell));
        const z0 = Math.max(0, Math.floor((Math.min(az, bz) - 24 - g.z0) / g.cell));
        const z1 = Math.min(g.rows - 1, Math.ceil((Math.max(az, bz) + 24 - g.z0) / g.cell));
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
          const i = z * g.width + x, p = g.point(i);
          const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / length2));
          const d = Math.hypot(p.x - ax - dx * t, p.z - az - dz * t);
          if (d < 24 && d < nearest[i]) { nearest[i] = d; this.runAt[i] = ri; }
        }
      }
    });
  }

  private run(p: Point) {
    const g = this.grid, x = Math.round((p.x - g.x0) / g.cell), z = Math.round((p.z - g.z0) / g.cell);
    return x >= 0 && z >= 0 && x < g.width && z < g.rows ? this.runs[this.runAt[z * g.width + x]] : undefined;
  }

  /** Public for verification and for safe simplification; never smooth across a hazard. */
  travel(a: Point, b: Point): Travel | null {
    const length = routeDistance(a, b);
    if (!length) return { walk: 0, cost: 0, seconds: 0 };
    const steps = Math.ceil(length / 1.2), step = length / steps;
    let prev = this.nav.probe.height(a.x, a.z), climb = 0, maxRise = 0, cost = 0, seconds = 0, hike = false;
    const first = prev;
    for (let j = 1; j <= steps; j++) {
      const t = j / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const y = this.nav.probe.height(x, z), rise = y - prev;
      if (!Number.isFinite(y) || !this.nav.contains(x, z) || rise > step * .55 + .12 || -rise > step * 1.05 + .12 ||
        this.nav.blocked(x, z, y, .65)) return null;
      climb += Math.max(0, rise); maxRise = Math.max(maxRise, rise);
      const snow = this.nav.probe.surface(x, z), run = this.run({ x, z });
      hike ||= run?.difficulty === 'hike';
      const slope = Math.max(0, -rise / step);
      const speed = Math.min(10, 2.5 + slope * 20);
      seconds += step / speed;
      cost += step / speed * ((rating[run?.difficulty ?? ''] ?? 1.6) +
        (1 - Math.max(snow.piste, snow.groomed)) * 12 + (run ? 0 : 2));
      prev = y;
    }
    // Tiny snow undulations and <=3% poling grades are skiable. Sustained uphill
    // or a steep local step is explicitly a walking leg, never disguised as skiing.
    const stationShuffle = length <= 24 && this.nav.liftLinks.some(l => [l.load, l.exit].some(p =>
      routeDistance(a, p) < 13 && routeDistance(b, p) < 13)) &&
      prev - first <= .20 * length + .08 && climb <= .24 * length + .18 && maxRise <= step * .40 + .10;
    const walking = hike || (!stationShuffle && (prev - first > .03 * length + .08 || climb > .045 * length + .18 || maxRise > step * .22 + .10));
    if (walking) return { walk: length + climb * 4, cost: length / .8, seconds: length / .8 };
    return { walk: 0, cost, seconds };
  }

  private connections(p: Point, outgoing: boolean) {
    const g = this.grid, ix = Math.round((p.x - g.x0) / g.cell), iz = Math.round((p.z - g.z0) / g.cell);
    const result: { node: number; travel: Travel }[] = [];
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const x = ix + dx, z = iz + dz, node = z * g.width + x;
      if (x < 0 || z < 0 || x >= g.width || z >= g.rows || !Number.isFinite(g.heights[node])) continue;
      const at = g.point(node), travel = this.travel(outgoing ? p : at, outgoing ? at : p);
      if (travel) result.push({ node, travel });
    }
    return result;
  }

  plan(from: Point, destination: Point, options: { liftsOpen?: boolean; riding?: number } = {}): SkiRoute | null {
    const nav = this.nav, g = this.grid;
    if (![from.x, from.z, destination.x, destination.z].every(Number.isFinite) ||
      !nav.contains(destination.x, destination.z) || nav.blocked(destination.x, destination.z, nav.probe.height(destination.x, destination.z), .65)) return null;
    const ridden = options.riding === undefined ? undefined : nav.liftLinks.find(l => l.index === options.riding);
    const origin = ridden?.exit ?? from;
    if (!nav.contains(origin.x, origin.z)) return null;
    const starts = this.connections(origin, true), goals = new Map(this.connections(destination, false).map(c => [c.node, c.travel]));
    if (!starts.length || !goals.size) return null;
    const end = g.heights.length, start = end + 1, count = end + 2;
    const costs = new Float64Array(count).fill(Infinity), parents = new Int32Array(count).fill(-1);
    const viaLift = new Int8Array(count).fill(-1), closed = new Uint8Array(count), queue = new Frontier();
    costs[start] = 0;
    const add = (a: number, b: number, cost: number, lift = -1) => {
      const total = costs[a] + cost;
      if (total >= costs[b]) return;
      costs[b] = total; parents[b] = a; viaLift[b] = lift;
      queue.push(b, total + (b === end ? 0 : routeDistance(g.point(b), destination) / 25));
    };
    for (const c of starts) add(start, c.node, c.travel.walk * WALK_PRIORITY + c.travel.cost);
    // Include both checked approach and exit connectors in each directed lift edge.
    const liftEdges = new Map<number, { to: number; index: number; cost: number }[]>();
    if (options.liftsOpen !== false) for (const link of nav.liftLinks) {
      const a = this.travel(g.point(link.from), link.approach), b = this.travel(link.approach, link.load);
      const c = this.travel(link.exit, g.point(link.to));
      if (!a || !b || !c) continue;
      const lift = nav.lifts[link.index];
      const edge = { to: link.to, index: link.index, cost: (a.walk + b.walk + c.walk) * WALK_PRIORITY +
        a.cost + b.cost + c.cost + lift.rideTime() + 20 };
      liftEdges.set(link.from, [...(liftEdges.get(link.from) ?? []), edge]);
    }
    while (queue.size) {
      const node = queue.pop();
      if (closed[node]) continue;
      if (node === end) break;
      closed[node] = 1;
      const tail = goals.get(node);
      if (tail) add(node, end, tail.walk * WALK_PRIORITY + tail.cost);
      const bits = g.links(node);
      for (let k = 0; k < 8; k++) {
        if (!(bits & (1 << k))) continue;
        const [dx, dz] = g.directions[k], next = node + dx + dz * g.width, slot = node * 8 + k;
        if (closed[next]) continue;
        if (this.costs[slot] < 0) {
          const t = this.travel(g.point(node), g.point(next));
          this.costs[slot] = t?.cost ?? Infinity; this.walks[slot] = t?.walk ?? 0;
        }
        add(node, next, this.costs[slot] + this.walks[slot] * WALK_PRIORITY);
      }
      for (const lift of liftEdges.get(node) ?? []) add(node, lift.to, lift.cost, lift.index);
    }
    if (parents[end] < 0) return null;
    const chain: number[] = [];
    for (let n = end; n !== start; n = parents[n]) chain.push(n);
    chain.reverse();
    const legs: RouteLeg[] = [];
    const ground = (a: Point, b: Point) => {
      if (routeDistance(a, b) < .01) return;
      const t = this.travel(a, b)!;
      const run = this.run({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
      const baseHeight = Math.min(...nav.lifts.map(l => l.def.bottom[1]));
      const base = nav.lifts.some(l => l.def.bottom[1] < baseHeight + 30 && routeDistance(b, { x: l.def.bottom[0], z: l.def.bottom[2] }) < 125);
      const mode = t.walk > 0 ? 'walk' : 'ski', name = base ? 'Base area' : run?.name ?? (this.nav.probe.surface(b.x, b.z).piste > .4 ? 'Trail connection' : 'Off piste');
      const last = legs.at(-1);
      if (last?.mode === mode && last.name === name) last.points.push(copyPoint(b));
      else legs.push({ mode, name, ...(run && !base ? { difficulty: run.difficulty } : {}), points: [copyPoint(a), copyPoint(b)], distance: 0 });
    };
    const liftLeg = (index: number, a: Point) => {
      const link = nav.liftLinks.find(l => l.index === index)!, lift = nav.lifts[index];
      const up = lift.unloadPoint(link.seat);
      legs.push({ mode: 'lift', name: lift.def.name, lift: index, points: [copyPoint(a), copyPoint(up), copyPoint(link.exit)], distance: 0 });
    };
    if (ridden) liftLeg(ridden.index, from);
    let previous = origin;
    for (const node of chain) {
      const point = node === end ? destination : g.point(node), li = viaLift[node];
      if (li >= 0) {
        const link = nav.liftLinks.find(l => l.index === li)!;
        ground(previous, link.approach); ground(link.approach, link.load);
        liftLeg(li, link.load); ground(link.exit, point);
      } else ground(previous, point);
      previous = point;
    }
    let walking = 0, distance = 0, seconds = 0;
    for (const leg of legs) {
      if (leg.mode !== 'lift') {
        const smoothed = [leg.points[0]];
        for (let i = 0; i < leg.points.length - 1;) {
          let next = i + 1;
          // Bounded line-of-sight smoothing, preserving walking classification and
          // the named corridor. Do not cut across a switchback or through trees.
          for (let j = i + 2; j < Math.min(leg.points.length, i + 7); j++) {
            if (routeDistance(leg.points[i], leg.points[j]) > 24) break;
            const t = this.travel(leg.points[i], leg.points[j]);
            if (!t || (t.walk > 0) !== (leg.mode === 'walk')) break;
            const middle = this.run({ x: (leg.points[i].x + leg.points[j].x) / 2, z: (leg.points[i].z + leg.points[j].z) / 2 });
            if (leg.name !== 'Base area' && middle && middle.name !== leg.name) break;
            next = j;
          }
          smoothed.push(leg.points[next]); i = next;
        }
        leg.points = smoothed;
      }
      for (let i = 1; i < leg.points.length; i++) leg.distance += routeDistance(leg.points[i - 1], leg.points[i]);
      distance += leg.distance;
      if (leg.mode === 'walk') walking += leg.distance;
      if (leg.mode === 'lift') seconds += nav.lifts[leg.lift!].rideTime() + 20;
      else for (let i = 1; i < leg.points.length; i++) seconds += this.travel(leg.points[i - 1], leg.points[i])!.seconds;
    }
    return { destination: { ...destination }, legs, distance, walking, seconds };
  }
}

/** Projection for route progress; lift legs are never considered skiable shortcuts. */
export function nearestRoutePosition(route: SkiRoute, point: Point, firstLeg = 0) {
  let best = { distance: Infinity, leg: firstLeg, segment: 0, fraction: 0, remaining: 0 };
  for (let li = firstLeg; li < route.legs.length; li++) {
    const leg = route.legs[li];
    if (leg.mode === 'lift') break;
    let remaining = leg.distance;
    for (let i = 1; i < leg.points.length; i++) {
      const a = leg.points[i - 1], b = leg.points[i], dx = b.x - a.x, dz = b.z - a.z;
      const length = Math.hypot(dx, dz), t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length || 1)));
      const d = Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t);
      if (d < best.distance) best = { distance: d, leg: li, segment: i - 1, fraction: t, remaining: remaining - length * t };
      remaining -= length;
    }
  }
  return best;
}

/** Bounded, copied room annotations. These never authorize movement or lift boarding. */
export function readSharedRoute(value: unknown, contains: (x: number, z: number) => boolean, liftCount: number): SharedRoute | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const v = value as SharedRoute;
  const point = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.z) && contains(p.x, p.z);
  if (!point(v.destination)) return undefined;
  const copyPoint = (p: Point) => ({ x: p.x, z: p.z });
  if (v.route === null) return { destination: copyPoint(v.destination), route: null };
  const r = v.route;
  if (!r || !point(r.destination) || routeDistance(r.destination, v.destination) > .1 || !Array.isArray(r.legs) || r.legs.length > 256 ||
    ![r.distance, r.walking, r.seconds].every(n => Number.isFinite(n) && n >= 0 && n <= 1e6)) return undefined;
  let points = 0;
  const legs: RouteLeg[] = [];
  for (const l of r.legs) {
    if (!l || !['ski', 'walk', 'lift'].includes(l.mode) || typeof l.name !== 'string' || l.name.length > 64 ||
      !Array.isArray(l.points) || l.points.length < 2 || (points += l.points.length) > 2000 || !l.points.every(point) ||
      !Number.isFinite(l.distance) || l.distance < 0 || l.distance > 1e6 ||
      (l.mode === 'lift' && (!Number.isInteger(l.lift) || l.lift! < 0 || l.lift! >= liftCount))) return undefined;
    legs.push({ mode: l.mode, name: l.name, points: l.points.map(copyPoint), distance: l.distance,
      ...(l.mode === 'lift' ? { lift: l.lift } : {}), ...(typeof l.difficulty === 'string' && Object.hasOwn(rating, l.difficulty) ? { difficulty: l.difficulty } : {}) });
  }
  return { destination: copyPoint(v.destination), route: { destination: copyPoint(r.destination), legs, distance: r.distance, walking: r.walking, seconds: r.seconds } };
}
