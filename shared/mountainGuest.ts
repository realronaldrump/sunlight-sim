import type { ColliderGrid } from './collision';
import { GuestNavigation, type GuestWaypoint, type Point } from './mountainGuestNavigation';
import { createSkier, getUp, headingFromDir, PARAMS, stepSkier, type SkierState, type Vec3 } from './skiPhysics';
import { createWalker, stepWalker, WalkSurfaces } from './walk';
import { newSantaFestivities, readSantaFestivities, santaActionDuration, SANTA_STAR_LIFE, SANTA_STAR_RELEASE,
  type SantaActionPose, type SantaFestivities, type SantaStarPose } from './santaFestivities';

const STEP = 1 / 30;
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const bareSnow = new WalkSurfaces();
const ease = (t: number) => { const s = clamp(t); return s * s * (3 - 2 * s); };

export interface GuestRide { lift: number; chair: number; seat: number; boardedAt: number; unloadAt: number }
export interface GuestPose {
  x: number; y: number; z: number; heading: number;
  speed: number; edge: number; skid: number; tuck: number; plow: number; fallen: number;
  airborne: boolean; touring: number; stride: number; pushing: boolean; waiting: boolean;
  ride: GuestRide | null;
  action?: SantaActionPose;
  star?: SantaStarPose;
}
export type GuestSeatFree = (lift: number, chair: number, seat: number) => boolean;

export interface GuestCheckpoint {
  v: 1; st: SkierState; seed: number; run: number | null; visits: number[];
  route: GuestWaypoint[]; cursor: number; ride: GuestRide | null; liftTimes: number[];
  stride: number; touring: number; age: number; rest: number;
  festivities?: SantaFestivities;
}

export function readGuestCheckpoint(value: unknown, nav: GuestNavigation): GuestCheckpoint | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as GuestCheckpoint, s = p.st;
  const point = (v: Point | undefined) => v && Number.isFinite(v.x) && Number.isFinite(v.z) && nav.contains(v.x, v.z);
  const lift = (i: number) => Number.isInteger(i) && i >= 0 && i < nav.lifts.length;
  if (p.v !== 1 || !s || !point(s.pos) || !s.vel || !s.normal ||
    ![s.pos.y, s.vel.x, s.vel.y, s.vel.z, s.normal.x, s.normal.y, s.normal.z, s.heading,
      s.speed, s.edge, s.tuck, s.skid, s.plow, s.modeTime, p.seed, p.age, p.rest, p.stride, p.touring].every(Number.isFinite) ||
    !['standing', 'skiing', 'fallen', 'gettingUp', 'air', 'riding'].includes(s.mode) ||
    !Array.isArray(p.route) || p.route.length > 5000 || !p.route.every(w => point(w) && (w.lift === undefined || lift(w.lift))) ||
    !Array.isArray(p.visits) || p.visits.length !== nav.courses.length || !p.visits.every(Number.isFinite) ||
    !Array.isArray(p.liftTimes) || p.liftTimes.length !== nav.lifts.length || !p.liftTimes.every(Number.isFinite) ||
    !Number.isInteger(p.cursor) || p.cursor < 0 || p.cursor > p.route.length) return null;
  const r = p.ride;
  if (r && (!lift(r.lift) || !Number.isInteger(r.chair) || r.chair < 0 || r.chair >= nav.lifts[r.lift].chairCount ||
    !Number.isInteger(r.seat) || r.seat < 0 || r.seat >= nav.lifts[r.lift].def.seats ||
    !Number.isFinite(r.boardedAt) || !Number.isFinite(r.unloadAt))) return null;
  return { ...p, festivities: readSantaFestivities(p.festivities, (x, z) => nav.contains(x, z)) };
}

/** One continuous skier per world. Nobody's position, camera or graphics preset enters this simulation. */
export class MountainGuest {
  private s: GuestCheckpoint;
  private elapsed = 0;
  private stuck = 0;
  private best = Infinity;
  private recover = 0;
  private pushing = false;
  private waiting = false;
  private courseRetry = 0;
  private detours = 0;

  constructor(readonly nav: GuestNavigation, private colliders: ColliderGrid, seed: number, checkpoint?: GuestCheckpoint) {
    if (checkpoint) { this.s = structuredClone(checkpoint); return; }
    // Choose a quiet initial section away from the lodge. This is the only spawn.
    const courses = nav.courses.filter(c => c.marks.length >= 8 && c.run.points[0][1] > 2780 && c.run.difficulty !== 'double');
    const start = courses[(seed >>> 0) % courses.length] ?? nav.courses[0];
    const remaining = { ...start, marks: start.marks.slice(Math.floor(start.marks.length * .27)) };
    const point = nav.safeStart(remaining.marks[0]);
    if (!point) throw new Error('No snow available for the mountain guest');
    const next = remaining.marks[1], heading = headingFromDir(next.x - point.x, next.z - point.z);
    this.s = {
      v: 1, st: createSkier({ ...point, y: nav.probe.height(point.x, point.z) }, heading),
      seed: seed >>> 0, run: nav.courses.indexOf(start), visits: nav.courses.map(() => 0),
      route: nav.plan(point, remaining, seed, false) ?? [], cursor: 0, ride: null,
      liftTimes: nav.lifts.map(() => 0), stride: 0, touring: 0, age: 0, rest: 0,
    };
  }

  get ride() { return this.s.ride; }
  get run() { return this.s.run === null ? null : this.nav.courses[this.s.run]?.run.name ?? null; }
  checkpoint() { return structuredClone(this.s); }

  pose(): GuestPose {
    const { st, ride, touring, stride, age, festivities } = this.s;
    const action = festivities?.action, star = festivities?.star;
    const fallen = st.mode === 'fallen' ? ease(st.modeTime / .38) :
      st.mode === 'gettingUp' ? 1 - ease(st.modeTime / PARAMS.getUpTime) : 0;
    return {
      ...st.pos, heading: st.heading, speed: st.speed, edge: st.edge, skid: st.skid,
      tuck: st.tuck, plow: st.plow, fallen, airborne: !st.grounded && !ride,
      touring, stride, pushing: this.pushing, waiting: this.waiting, ride,
      action: action && !ride && age < action.startedAt + santaActionDuration(action.kind) ? {
        kind: action.kind, heading: action.heading, anchor: action.anchor,
        progress: clamp((age - action.startedAt) / santaActionDuration(action.kind)),
      } : undefined,
      star: star && star.until > age ? { x: star.x, y: star.y, z: star.z, remaining: star.until - age } : undefined,
    };
  }

  private random() {
    this.s.seed = (Math.imul(1664525, this.s.seed) + 1013904223) >>> 0;
    return this.s.seed / 2 ** 32;
  }

  private chooseRoute(useLifts: boolean) {
    const p = this.s.st.pos, needsLift = useLifts && p.y < 2640 && this.random() < .73;
    const entries = this.nav.courses.map((course, index) => {
      const top = course.marks[0], rise = this.nav.probe.height(top.x, top.z) - p.y;
      const trip = needsLift ? (rise > 85 ? -.95 : 1.2) : Math.max(0, rise) * .006;
      return { course, index, score: this.s.visits[index] * 3 + distance(p, top) / 1150 + this.random() * 2.1
        + trip + (this.s.run === index ? 4 : 0) };
    }).sort((a, b) => a.score - b.score);
    for (const { course, index } of entries.slice(0, 5)) {
      const route = this.nav.plan(p, course, this.s.seed, useLifts);
      if (!route || route.length < 3) continue;
      this.s.route = route;
      this.s.run = index;
      this.s.cursor = 0;
      this.best = Infinity;
      this.stuck = 0; this.detours = 0;
      return true;
    }
    this.courseRetry = 2;
    return false;
  }

  /** Reserve once the cushion actually reaches the guest. Full chairs pass and he waits for another. */
  private board(wp: GuestWaypoint, times: number[], previous: number[], free: GuestSeatFree) {
    const index = wp.lift!;
    const path = this.nav.lifts[index], st = this.s.st;
    if (distance(st.pos, wp) > .4 || st.speed > 1.5 || Math.abs(angle(st.heading - path.loadPoint().heading)) > .35) return;
    const t = times[index], before = Math.max(t - 1, previous[index]);
    const hit = path.boardingContact(st.pos, st.pos, before, t);
    if (!hit || !free(index, hit.chair, hit.seat)) return;
    const boardedAt = before + (t - before) * hit.fraction;
    this.s.ride = { lift: index, chair: hit.chair, seat: hit.seat, boardedAt,
      unloadAt: boardedAt + path.remainingRideTime(hit.chair, boardedAt) };
    st.mode = 'riding';
    this.s.cursor++;
    this.waiting = false;
    this.best = Infinity; this.stuck = 0; this.recover = 0;
  }

  private onChair(ride: GuestRide, time: number) {
    const path = this.nav.lifts[ride.lift], st = this.s.st;
    const root = path.riderPoint(ride.chair, ride.seat, Math.min(time, ride.unloadAt));
    st.pos = root.p; st.heading = root.heading;
    st.speed = path.def.speed;
    if (time < ride.unloadAt) return;
    // Release at the seat transform, retaining forward cable velocity. Gravity
    // and the shared groomed ramp put the skis onto the snow on the next steps.
    this.s.ride = null;
    st.mode = 'air'; st.modeTime = 0; st.grounded = false;
    st.vel = { x: path.ax * path.def.speed, y: 0, z: path.az * path.def.speed };
    st.edge = 0; st.skid = 0; st.tuck = 0; st.plow = 0;
  }

  advance(dt: number, liftTimes: number[], free: GuestSeatFree = () => true, open = true, visitors: readonly Vec3[] = []) {
    const previous = this.s.liftTimes;
    this.s.liftTimes = liftTimes;
    // Real time moves the lifts. Bounded fixed steps handle timer stalls without a physics jump.
    this.elapsed += Math.min(.25, Math.max(0, dt));
    const steps = Math.floor((this.elapsed + 1e-8) / STEP);
    if (!steps) return;
    this.elapsed -= steps * STEP;
    let last = previous;
    for (let i = 1; i <= steps; i++) {
      const times = liftTimes.map((t, j) => previous[j] ? previous[j] + (t - previous[j]) * i / steps : t);
      this.step(times, last, free, open, visitors);
      last = times;
    }
  }

  /** This is the same state machine in the room server and the solo worker. */
  private festiveStep(wp: GuestWaypoint | undefined, visitors: readonly Vec3[]) {
    const { st, age } = this.s;
    const f = this.s.festivities ??= newSantaFestivities(age, this.s.seed);
    if (f.star && age >= f.star.until) f.star = undefined;
    const action = f.action;
    if (action) {
      const elapsed = age - action.startedAt, duration = santaActionDuration(action.kind);
      if (action.kind === 'hang-star' && action.anchor && elapsed >= duration * SANTA_STAR_RELEASE && !f.star) {
        f.star = { ...action.anchor, until: action.startedAt + duration + SANTA_STAR_LIFE };
      }
      if (elapsed < duration) {
        this.ski(0, .85, false, false, true);
        return true;
      }
      f.action = undefined;
      if (f.stop) { f.stop.returning = true; f.stop.until = age + 19; }
    }

    if (f.stop && age >= f.stop.until) f.stop = undefined;
    if (!f.stop && age >= f.searchAt && !wp?.gate && wp?.lift === undefined && st.speed < 3.2) {
      const stop = this.nav.santaFirStop(st.pos);
      f.searchAt = age + (stop ? 330 + (this.s.seed >>> 0) % 241 : 4);
      if (stop) f.stop = { ...stop, from: { x: st.pos.x, z: st.pos.z }, until: age + 21 };
    }
    const stop = f.stop;
    if (stop) {
      this.waiting = false;
      const target = stop.returning ? stop.from : stop.at;
      const distanceToStop = distance(st.pos, target);
      if (stop.returning && distanceToStop < .65) {
        f.stop = undefined; this.best = Infinity; this.stuck = 0;
        return false;
      }
      const aim = !stop.returning && distanceToStop < .75 ? stop.anchor : target;
      const heading = headingFromDir(aim.x - st.pos.x, aim.z - st.pos.z);
      const turn = angle(heading - st.heading);
      if (!stop.returning && distanceToStop < .24 && st.speed < .47 && Math.abs(turn) < .28) {
        f.action = { kind: 'hang-star', startedAt: age, heading, anchor: stop.anchor };
        this.ski(0, .85, false, false, true);
      } else if (st.speed > 2.5) {
        this.pushing = false;
        this.ski(clamp(-turn * 1.5, -1, 1), .96, false, st.speed > 3.6, false);
      } else this.tourTo(target, heading, true);
      return true;
    }

    const stoppedAtLift = wp?.lift !== undefined && distance(st.pos, wp) < .65;
    if (age >= f.greetAt && st.speed < .85 && (this.s.rest > 0 || stoppedAtLift)) {
      let nearest: Vec3 | undefined, closest = 9;
      for (const visitor of visitors) {
        if (Math.abs(visitor.y - st.pos.y) > 2.7) continue;
        const d = distance(visitor, st.pos);
        if (d < closest) { nearest = visitor; closest = d; }
      }
      if (nearest) {
        f.action = { kind: 'hat-tip', startedAt: age, heading: headingFromDir(nearest.x - st.pos.x, nearest.z - st.pos.z) };
        f.greetAt = age + 40;
        this.ski(0, .85, false, false, true);
        return true;
      }
    }
    return false;
  }

  private step(times: number[], previous: number[], free: GuestSeatFree, open: boolean, visitors: readonly Vec3[]) {
    const s = this.s, st = s.st, probe = this.nav.probe;
    s.age += STEP;
    if (s.ride) { this.onChair(s.ride, times[s.ride.lift]); return; }
    if (st.mode === 'fallen' || st.mode === 'gettingUp') {
      if (s.festivities) s.festivities.action = undefined;
      this.pushing = this.waiting = false;
      this.ski(0, 0, false, false, false);
      if (st.modeTime > 2) getUp(st);
      return;
    }

    let wp = s.route[s.cursor];
    if (st.grounded && this.festiveStep(wp, visitors)) return;
    if (!wp && st.grounded) {
      if (s.route.length) {
        if (s.run !== null) s.visits[s.run]++;
        s.route = []; s.cursor = 0;
        s.rest = 3 + 7 * this.random();
      }
      s.rest -= STEP;
      this.courseRetry -= STEP;
      if (s.rest <= 0 && this.courseRetry <= 0 && this.chooseRoute(open)) wp = s.route[s.cursor];
      else {
        this.ski(0, .85, false, st.speed > 1.3, true);
        return;
      }
    }
    if (!wp) { this.ski(0, 0, false, false, false); return; }

    const reached = (w: GuestWaypoint) => {
      if (distance(st.pos, w) < (w.gate ? 1.0 : Math.min(2.45, 1.4 + st.speed * .14))) return true;
      if (w.gate) return false;
      const previous = s.route[s.cursor - 1], next = s.route[s.cursor + 1];
      if (!previous || !next || next.lift !== undefined || next.gate || distance(st.pos, w) > 6.5) return false;
      const passed = (st.pos.x - w.x) * (w.x - previous.x) + (st.pos.z - w.z) * (w.z - previous.z) >= 0;
      return passed && distance(st.pos, next) < 8 && this.nav.clear(st.pos, next, .8);
    };
    while (wp.lift === undefined && reached(wp) && s.cursor < s.route.length) {
      this.best = Infinity; this.stuck = 0; this.recover = Math.max(0, this.recover - 4);
      const next = s.route[++s.cursor];
      if (!next) return;
      wp = next;
    }

    const d = distance(st.pos, wp);
    if (d + .45 < this.best) { this.best = d; this.stuck = 0; }
    else this.stuck += STEP;
    if (wp.lift !== undefined && !open) {
      this.ski(0, .85, false, st.speed > 1.3, true);
      return;
    }

    this.waiting = wp.lift !== undefined && d < .65;
    if (this.waiting && open) {
      this.board(wp, times, previous, free);
      if (s.ride) return;
    }
    if (this.stuck > 4 && !this.waiting) {
      this.recover = 12;
      if (this.stuck > 7 && st.grounded && st.speed < 2.5 && wp.lift === undefined && !wp.gate) {
        this.detours++;
        let ahead = s.cursor + 1;
        while (ahead + 1 < s.route.length && ahead < s.cursor + 6 && !s.route[ahead].gate && s.route[ahead].lift === undefined) ahead++;
        const target = s.route[Math.min(ahead - 1, s.route.length - 1)];
        const detour = this.nav.detour(st.pos, target, s.seed + this.detours);
        if (detour?.length && this.detours <= 5) {
          s.route = [...detour, ...s.route.slice(ahead)]; s.cursor = 0; wp = s.route[0];
        } else if (this.detours > 5 && this.chooseRoute(open)) {
          wp = s.route[s.cursor];
        }
        this.stuck = 0;
        this.best = Infinity;
      }
    }
    this.recover = Math.max(0, this.recover - STEP);

    // Aim beyond the next few grid points only where a direct line stays clear.
    let aim = wp;
    const look = 9 + Math.min(9, st.speed * .85);
    if (wp.lift === undefined && !wp.gate && this.nav.clear(st.pos, wp, .58)) {
      for (let i = s.cursor + 1; i < s.route.length; i++) {
        const candidate = s.route[i];
        if (candidate.lift !== undefined || candidate.gate || distance(st.pos, candidate) > look) break;
        if (this.nav.clear(st.pos, candidate, .82)) aim = candidate;
      }
    }
    const vertical = probe.height(aim.x, aim.z) - st.pos.y, rise = vertical / Math.max(distance(st.pos, aim), .5);
    const targetHeading = headingFromDir(aim.x - st.pos.x, aim.z - st.pos.z);
    const err = angle(targetHeading - st.heading);
    const tour = wp.lift !== undefined || this.recover > 0 || (vertical > .65 && rise > .09)
      || (s.touring > .2 && vertical > .25 && rise > .045) || (d < 4 && Math.abs(err) > 1.25);
    if (st.grounded && tour && st.speed < 2.7) {
      const heading = this.waiting ? this.nav.lifts[wp.lift!].loadPoint().heading : targetHeading;
      this.tourTo(aim, heading, wp.lift !== undefined);
      return;
    }
    let desired = headingFromDir(aim.x - st.pos.x, aim.z - st.pos.z);
    const base = probe.surface(st.pos.x, st.pos.z);
    const amplitude = Math.min(3.8, 1.4 + st.speed * .18) * Math.max(base.groomed, base.piste);
    if (!tour && distance(st.pos, aim) > 5 && rise < -.10 && st.speed > 3) {
      // Connected turns vary with each outing and are cut short by trees or a narrow trail.
      const phase = s.age * (.75 + (s.seed % 13) / 50) + s.seed % 120;
      const lateral = Math.sin(phase) * amplitude;
      const turn = { x: aim.x + Math.cos(desired) * lateral, z: aim.z - Math.sin(desired) * lateral };
      if (this.nav.contains(turn.x, turn.z) && this.nav.clear(st.pos, turn, 1.12)) {
        desired = headingFromDir(turn.x - st.pos.x, turn.z - st.pos.z);
      }
    }
    const turn = angle(desired - st.heading);
    const wantsSlow = tour || !this.nav.clear(st.pos, aim, .51);
    const topSpeed = wantsSlow ? 1.9 : clamp(9.3 + 3.1 * base.groomed - 3.5 * base.moguls - 6 * Math.abs(turn), 3.1, 13);
    const brake = st.speed > topSpeed + 4.1 || (wantsSlow && st.speed > 3.4);
    const plow = clamp((st.speed - topSpeed + .5) / 3);
    this.pushing = st.speed < 3.2 && Math.abs(turn) < .55 && !wantsSlow;
    this.ski(clamp(-turn * 1.65, -1, 1), plow, !wantsSlow && st.speed > 6 && Math.abs(turn) < .19 && st.speed < topSpeed - 1.2,
      brake, false);
  }

  private ski(steer: number, plow: number, tuck: boolean, stop: boolean, hold: boolean) {
    const { st } = this.s, x = st.pos.x, z = st.pos.z;
    stepSkier(st, { steer, plow, tuck, stop, hold, push: this.pushing && !hold }, this.nav.probe, STEP);
    this.colliders.collide(st);
    if (!this.nav.contains(st.pos.x, st.pos.z)) {
      // The resort boundary is a hard stop. Undo just this integration step.
      st.pos.x = x; st.pos.z = z; st.vel.x = 0; st.vel.z = 0; st.speed = 0;
      this.recover = 12;
    }
    this.s.touring = Math.max(0, this.s.touring - STEP * 4);
  }

  private tourTo(wp: Point, heading: number, loading: boolean) {
    const { st } = this.s, probe = this.nav.probe;
    const d = distance(st.pos, wp);
    const walker = createWalker(st.pos.x, st.pos.y, st.pos.z, st.heading);
    walker.vel = st.vel;
    walker.stride = this.s.stride;
    const speed = Math.min(1, d * (loading ? 1.3 : 1.7));
    const mx = (wp.x - st.pos.x) / (d || 1), mz = (wp.z - st.pos.z) / (d || 1);
    stepWalker(walker, { x: mx * speed, z: mz * speed, run: !loading && d > 3 }, probe.height, bareSnow, this.colliders, STEP);
    if (!this.nav.contains(walker.pos.x, walker.pos.z)) return;
    st.pos = walker.pos; st.vel = walker.vel; st.speed = walker.speed;
    st.heading += clamp(angle(heading - st.heading), -STEP * 3.7, STEP * 3.7);
    st.grounded = walker.grounded; st.mode = walker.grounded ? 'skiing' : 'air';
    st.edge *= .86; st.plow *= .86; st.skid *= .86; st.tuck *= .86;
    this.s.stride = walker.stride;
    this.s.touring += (clamp(st.speed / 1.35) - this.s.touring) * STEP * 5;
    this.pushing = st.speed > .3;
  }
}
