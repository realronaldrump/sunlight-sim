// A Snowriders' Club lesson (Sunlight Ski & Ride School, ages 7 to 12): an instructor and five kids in
// numbered bibs follow one continuous itinerary on the shared resort clock. They line up at the Lesson
// Line-Up Area by the lodge, ski single file to Segundo, take the open lane and two consecutive chairs,
// regroup at the top, follow the instructor's tracks down Segundo Road and Ute with stops along the way,
// then skate back to the lodge and do it again. Every client computes the same positions from the same
// clock, so two friends see the same group in the same place. A player can tag along to learn the route.
import * as THREE from 'three/webgpu';
import { SkierModel } from '../skier/skierModel';
import { orientSkier } from '../skier/orientation';
import type { LiftSystem } from '../lifts/liftSystem';
import type { TerrainProbe, Vec3 } from '../../../shared/skiPhysics';
import type { RunInfo } from '../game';
import { RIDER_ROOT_BELOW_SEAT, RIDER_ROOT_FORWARD, type LiftPath } from '../../../shared/lifts';
import { dressBib } from './bib';
import { registerGuest, type Guest } from './guests';
import type { ColliderGrid, Collider } from '../../../shared/collision';

export const LINEUP = { x: 88, z: -966 };
/** Lesson loops are counted from this instant so every client agrees on the schedule. */
const EPOCH = Date.UTC(2026, 0, 1) / 1000;
const LINEUP_TIME = 150;
const GAP = 5.5, LAG = 0.7;           // follow-the-leader spacing while skiing
const SNAKE_A = 2.0, SNAKE_K = (2 * Math.PI) / 17; // the instructor's round turns, followed track for track
const BOARD = 0.85, STAND = 0.6;

interface P2 { x: number; z: number }

/** A smoothed, evenly resampled centreline with arc-length lookup; extrapolates beyond both ends. */
export class Route {
  readonly pts: P2[] = [];
  readonly cum: number[] = [];
  readonly length: number;
  constructor(raw: P2[], step = 3) {
    const dense: P2[] = [];
    for (let i = 1; i < raw.length; i++) {
      const a = raw[i - 1], b = raw[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
      for (let k = 0; k < n; k++) dense.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
    }
    dense.push(raw[raw.length - 1]);
    for (let i = 0; i < dense.length; i++) {
      if (i === 0 || i === dense.length - 1) { this.pts.push(dense[i]); continue; }
      let x = 0, z = 0, w = 0;
      for (let j = -2; j <= 2; j++) {
        const q = dense[Math.max(0, Math.min(dense.length - 1, i + j))], k = 3 - Math.abs(j);
        x += q.x * k; z += q.z * k; w += k;
      }
      this.pts.push({ x: x / w, z: z / w });
    }
    let s = 0;
    this.cum.push(0);
    for (let i = 1; i < this.pts.length; i++) { s += Math.hypot(this.pts[i].x - this.pts[i - 1].x, this.pts[i].z - this.pts[i - 1].z); this.cum.push(s); }
    this.length = s;
  }
  /** Position and unit tangent at arc length s. */
  at(s: number) {
    const c = this.cum, n = this.pts.length;
    let i: number;
    if (s <= 0) i = 0;
    else if (s >= this.length) i = n - 2;
    else { let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; } i = lo; }
    const a = this.pts[i], b = this.pts[i + 1], L = c[i + 1] - c[i] || 1;
    const tx = (b.x - a.x) / L, tz = (b.z - a.z) / L, u = s - c[i];
    return { x: a.x + tx * u, z: a.z + tz * u, tx, tz };
  }
  /** Arc length of the point nearest (x, z). */
  project(x: number, z: number) {
    let best = Infinity, bs = 0;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i], b = this.pts[i + 1], L = this.cum[i + 1] - this.cum[i] || 1;
      const t = Math.max(0, Math.min(L, ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / L));
      const px = a.x + (b.x - a.x) * t / L, pz = a.z + (b.z - a.z) * t / L, d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < best) { best = d; bs = this.cum[i] + t; }
    }
    return { s: bs, d: Math.sqrt(best) };
  }
}

export interface Stop { s: number; dwell: number; label: string; say?: string; side: number; start?: boolean }
export interface Section { to: number; pace: number; skate?: boolean; amp?: number }

/** The leader's schedule along a route: travel at section paces, dwell at stops. Followers replay it. */
export class Schedule {
  private knots: { t: number; s: number }[] = [];
  readonly duration: number;
  constructor(readonly route: Route, readonly stops: Stop[], readonly sections: Section[]) {
    let t = 0, s = 0;
    const first = stops[0];
    // a starting stop: the leader begins there, already waiting for the group
    if (first?.start) { s = first.s; this.knots.push({ t, s }); t += first.dwell; }
    this.knots.push({ t, s });
    for (const stop of [...stops.filter((x) => !x.start), { s: route.length, dwell: 0 } as Stop]) {
      // integrate the travel time section by section
      let cur = s;
      for (const sec of this.sections) {
        if (sec.to <= cur) continue;
        const end = Math.min(sec.to, stop.s);
        if (end <= cur) break;
        t += (end - cur) / sec.pace; cur = end; this.knots.push({ t, s: cur });
        if (cur >= stop.s) break;
      }
      s = stop.s;
      if (stop.dwell > 0) { t += stop.dwell; this.knots.push({ t, s }); }
    }
    this.duration = t;
  }
  /** Leader arc length at schedule time t (clamped to the ends). */
  s(t: number) {
    const k = this.knots;
    if (t <= k[0].t) return k[0].s;
    for (let i = 1; i < k.length; i++) if (t <= k[i].t) {
      const a = k[i - 1], b = k[i];
      return b.t > a.t ? a.s + (b.s - a.s) * (t - a.t) / (b.t - a.t) : b.s;
    }
    return k[k.length - 1].s;
  }
  section(s: number) { return this.sections.find((x) => s < x.to) ?? this.sections[this.sections.length - 1]; }
  /** Which stop this arc length belongs to (within a few meters), if any. */
  stopNear(s: number, back = 0) {
    let best: Stop | null = null, bd = 6;
    for (const st of this.stops) { const d = Math.abs(s - (st.s - back)); if (d < bd) { bd = d; best = st; } }
    return best ? { stop: best, d: bd } : null;
  }
}

export interface LessonPose {
  x: number; z: number; heading: number; speed: number; edge: number; plow: number;
  sit: number; ride?: { chair: number; seat: number; t: number }; skate: boolean; facing?: number;
}

interface Member { guest: Guest; model: SkierModel; role: 'instructor' | 'kid'; scale: number; seat: number; chair: 0 | 1; plow: number; time: number }

type Phase = 'lineup' | 'toLift' | 'lift' | 'descent';
export interface LessonStatus {
  phase: Phase; label: string; next: string; say: string | null; sayKey: string;
  instructor: { x: number; y: number; z: number }; loop: number; tau: number;
}

const KIDS: { jacket: number; hat: number; skin: number[]; scale: number; plow: number }[] = [
  { jacket: 0x2e5aa8, hat: 0xf2f2f0, skin: [0.96, 0.86, 0.77], scale: 0.72, plow: 0.6 },
  { jacket: 0xd23c76, hat: 0x7b3fbf, skin: [0.64, 0.49, 0.39], scale: 0.76, plow: 0.5 },
  { jacket: 0x2e9e44, hat: 0x1a1a1c, skin: [1, 1, 1], scale: 0.8, plow: 0.35 },
  { jacket: 0x6a3fa0, hat: 0xd8642a, skin: [0.84, 0.68, 0.56], scale: 0.74, plow: 0.55 },
  { jacket: 0x111317, hat: 0x1aa3a3, skin: [0.47, 0.35, 0.28], scale: 0.84, plow: 0.25 },
];
export const INSTRUCTOR_NAME = 'Maya';
export const LESSON_NAME = "Snowriders' Club";

export class LessonGroup {
  readonly group = new THREE.Group();
  readonly members: Member[] = [];
  private toLift!: Schedule;
  private descent!: Schedule;
  private lineupSlots: { x: number; z: number; heading: number }[] = [];
  private li: number;
  private path: LiftPath;
  private chairs = new Map<number, { a: number; arriveA: number; b: number; arriveB: number }>();
  private times!: { lineup: number; toLift: number; lift: number; descent: number; period: number; ride: number; interval: number };
  private normal: Vec3 = { x: 0, y: 1, z: 0 };
  /** Solo only: seconds the group has waited for a tag-along player who fell behind. */
  hold = 0;
  private holdStop = '';
  private holdUsed = 0;
  private lastWaitNow = 0;
  ready = false;
  readonly poses: LessonPose[] = [];

  constructor(private lifts: LiftSystem, private probe: TerrainProbe, runs: RunInfo[], private colliders?: ColliderGrid) {
    this.group.name = 'snowriders-lesson';
    this.li = lifts.paths.findIndex((p) => p.def.name === 'Segundo');
    this.path = lifts.paths[this.li];
    if (this.li < 0) return;
    const road = runs.find((r) => r.name === 'Segundo Road' && r.kind === 'line');
    const ute = runs.find((r) => r.name === 'Ute' && r.kind === 'line');
    if (!road || !ute) return;
    this.buildRoutes(road, ute);
    this.buildMembers();
    this.ready = true;
  }

  /** Points relative to the Segundo load line: d meters behind it (downhill), lat meters to the right. */
  private lane(d: number, lat: number): P2 {
    const lp = this.path.loadPoint(), p = this.path;
    return { x: lp.x - p.ax * d + p.rx * lat, z: lp.z - p.az * d + p.rz * lat };
  }

  private buildRoutes(road: RunInfo, ute: RunInfo) {
    const P = (p: number[]) => ({ x: p[0], z: p[2] });
    // Lesson Line-Up Area by the lodge, single file to the back of the Segundo maze, around the sign
    // board and into the open lane (the ski school lane) behind the crowd lane.
    const toLift = new Route([LINEUP, { x: 77, z: -977 }, { x: 63, z: -991 }, { x: 49, z: -1005 }, { x: 42, z: -1016 },
      this.lane(19.5, 7), this.lane(18.5, 1.5), this.lane(16.5, 0)], 2);
    this.toLift = new Schedule(toLift, [], [{ to: Infinity, pace: 2.3 }]);
    // Off the Segundo unload ramp, down Segundo Road to its junction with Ute, Ute home, skate to the lodge.
    const up = this.path.unloadPoint(), fx = -Math.sin(up.heading), fz = -Math.cos(up.heading);
    const roadPts = road.points.map(P);
    const joinAt = ute.points.findIndex((p) => Math.hypot(p[0] - roadPts[roadPts.length - 1].x, p[2] - roadPts[roadPts.length - 1].z) < 15);
    const utePts = ute.points.slice(Math.max(0, joinAt + 1)).map(P);
    const ramp = { x: up.x + fx * 9, z: up.z + fz * 9 };
    const skateBack = [{ x: 55, z: -979 }, { x: 68, z: -967 }, { x: 80, z: -965 }, LINEUP];
    const raw = [ramp, ...roadPts.filter((p) => Math.hypot(p.x - ramp.x, p.z - ramp.z) > 12), ...utePts, ...skateBack];
    const descent = new Route(raw, 3);
    const roadEnd = descent.project(roadPts[roadPts.length - 1].x, roadPts[roadPts.length - 1].z).s;
    const uteEnd = descent.project(utePts[utePts.length - 1].x, utePts[utePts.length - 1].z).s;
    const stops: Stop[] = [
      { s: 34, dwell: 40, start: true, label: 'Regroup at the top of Segundo Road', side: 0.7, say: `Our route home is Segundo Road, then Ute all the way to the lodge. Both are green. Follow my tracks, round turns, pizza to slow down.` },
      { s: roadEnd - 10, dwell: 32, label: 'Regroup where Segundo Road meets Ute', side: 1.2, say: 'This is where Segundo Road joins Ute. Look uphill for faster skiers, then follow me left onto Ute.' },
      { s: roadEnd + (uteEnd - roadEnd) * 0.45, dwell: 28, label: 'Regroup on Ute', side: 2.4, say: 'Ute is long and gentle. Keep a little speed on the flats so you do not have to skate.' },
      { s: uteEnd - 140, dwell: 25, label: 'Regroup above the base', side: 2.4, say: 'Almost home. The lifts are just below us. Stay together and watch for people stopping.' },
    ];
    // Segundo Road is a narrow cat track through the trees: smaller turns there, rounder ones on Ute
    this.descent = new Schedule(descent, stops, [{ to: roadEnd, pace: 3.8, amp: 1.1 }, { to: uteEnd, pace: 4.3 }, { to: Infinity, pace: 1.4, skate: true }]);
    // line-up formation: the kids side by side facing the instructor, who faces them from the lodge side
    const ax = 0.8, az = 0.6; // toward the lodge
    for (let i = 0; i < 6; i++) {
      if (i === 0) { this.lineupSlots.push({ x: LINEUP.x + ax * 3.4, z: LINEUP.z + az * 3.4, heading: Math.atan2(ax, az) }); continue; }
      const k = i - 3;
      this.lineupSlots.push({ x: LINEUP.x - az * k * 1.5, z: LINEUP.z + ax * k * 1.5, heading: Math.atan2(-ax, -az) });
    }
    // timeline
    const p = this.path, interval = p.spacing / p.def.speed;
    const ride = (p.unloadU - p.loadU) / p.def.speed;
    const lineup = LINEUP_TIME, toLiftT = this.toLift.duration + 5 * LAG + 2;
    const lift = 32 + 2 * interval + ride + 50;
    const descentT = this.descent.duration + 5 * LAG + 8;
    this.times = { lineup, toLift: toLiftT, lift, descent: descentT, period: lineup + toLiftT + lift + descentT, ride, interval };
  }

  private buildMembers() {
    const instructor: Guest = registerGuest({ id: 900001, persona: 'intermediate', group: 'lesson',
      look: { jacket: 0xb5121b, skin: [0.96, 0.86, 0.77], hat: 'helmet', hatColor: 0x16181c } });
    this.addMember(instructor, 'instructor', 1, 0, 0, 0.05, { color: '#b5121b', ink: '#ffffff', cut: 'uniform', frontTitle: 'SUNLIGHT', backName: 'SUNLIGHT', backTitle: 'SKI & RIDE SCHOOL  ·  INSTRUCTOR' });
    KIDS.forEach((k, i) => {
      const g = registerGuest({ id: 900002 + i, persona: 'beginner', group: 'lesson', look: { jacket: k.jacket, skin: k.skin, hat: 'helmet', hatColor: k.hat, scale: k.scale, bib: { color: 0xff7a1a, number: String(i + 1) } } });
      const n = i + 1;
      this.addMember(g, 'kid', k.scale, n < 3 ? 0 : 1, n < 3 ? n : n - 3, k.plow, { color: '#ff7a1a', ink: '#151515', cut: 'bib', number: String(n), frontTitle: 'SKI SCHOOL', backTitle: 'SUNLIGHT SKI & RIDE SCHOOL' });
    });
  }

  private addMember(guest: Guest, role: Member['role'], scale: number, chair: 0 | 1, seat: number, plow: number, print: Parameters<typeof dressBib>[3]) {
    const look = guest.look;
    const model = new SkierModel(new THREE.Color(look.jacket), 'crowd', new THREE.Color(...look.skin as [number, number, number]));
    model.dress(look);
    dressBib(model.human, new THREE.Color(look.jacket), new THREE.Color(...look.skin as [number, number, number]), print);
    model.root.name = role === 'instructor' ? 'lesson-instructor' : `lesson-kid-${this.members.length}`;
    this.group.add(model.root);
    this.members.push({ guest, model, role, scale, chair, seat, plow, time: this.members.length * 3.1 });
    this.poses.push({ x: 0, z: 0, heading: 0, speed: 0, edge: 0, plow: 0, sit: 0, skate: false });
  }

  /** Loop number and time within the loop for a shared resort time. */
  clock(now: number) {
    const t = now - EPOCH - this.hold, P = this.times.period;
    const loop = Math.floor(t / P);
    return { loop, tau: this.freezeTau ?? t - loop * P };
  }
  /** Test hook: hold the whole lesson at one moment of its loop. */
  freezeTau: number | null = null;

  private boardChairs(loop: number, liftStartWall: number, liftOffset: number) {
    let c = this.chairs.get(loop);
    if (!c) {
      const p = this.path, ready = liftStartWall + 30 + liftOffset;
      const a = p.nextChairAt(p.loadU, ready), b = p.nextChairAt(p.loadU, a.arrive + 0.5);
      c = { a: a.index, arriveA: a.arrive, b: b.index, arriveB: b.arrive };
      this.chairs.set(loop, c);
      if (this.chairs.size > 4) this.chairs.delete(this.chairs.keys().next().value!);
    }
    return c;
  }

  /** Arc-length position of follower i on a schedule (the leader's motion, i lags later and i gaps shorter). */
  private follow(sched: Schedule, i: number, t: number) {
    return sched.s(t - i * LAG) - i * GAP;
  }

  private onRoute(sched: Schedule, i: number, t: number, out: LessonPose, startSlot?: { x: number; z: number }) {
    const s = this.follow(sched, i, t), s2 = this.follow(sched, i, t + 0.25);
    const r = sched.route;
    const speed = Math.max(0, (s2 - s) / 0.25);
    const near = sched.stopNear(s, i * GAP);
    const dwellBlend = near ? 1 - THREE.MathUtils.smoothstep(near.d, 0, 7) : 0;
    const sec = sched.section(Math.max(0, s));
    const amp = sec.skate ? 0.2 : (sec.amp ?? SNAKE_A) * (1 - dwellBlend);
    const lat = (sp: number) => amp * Math.sin(SNAKE_K * sp) + dwellBlend * (near?.stop.side ?? 1);
    const a = r.at(s), b = r.at(s + 0.5);
    const la = lat(s), lb = lat(s + 0.5);
    let x = a.x - a.tz * la, z = a.z + a.tx * la;
    const bx = b.x - b.tz * lb, bz = b.z + b.tx * lb;
    let heading = Math.atan2(-(bx - x), -(bz - z));
    if (startSlot && s < 0) {
      // still waiting at the line-up: step into the file over the last few meters
      const k = THREE.MathUtils.smoothstep(s, -5, 0);
      const r0 = r.at(0);
      x = startSlot.x + (r0.x - startSlot.x) * k; z = startSlot.z + (r0.z - startSlot.z) * k;
      if (k <= 0) heading = out.facing ?? heading;
    }
    // curvature of the followed track -> edge angle (positive: turning right)
    const curv = -amp * SNAKE_K * SNAKE_K * Math.sin(SNAKE_K * s);
    out.x = x; out.z = z; out.heading = heading; out.speed = speed;
    out.edge = THREE.MathUtils.clamp(Math.atan(speed * speed * curv / 9.81), -0.55, 0.55);
    out.skate = !!sec.skate && speed > 0.2;
    out.sit = 0; out.ride = undefined;
  }

  private glide(poly: P2[], d: number, out: LessonPose) {
    let rem = Math.max(0, d);
    for (let k = 1; k < poly.length; k++) {
      const a = poly[k - 1], b = poly[k], L = Math.hypot(b.x - a.x, b.z - a.z);
      if (rem <= L || k === poly.length - 1) {
        const u = L > 0 ? Math.min(1, rem / L) : 1;
        out.x = a.x + (b.x - a.x) * u; out.z = a.z + (b.z - a.z) * u;
        if (L > 0.05) out.heading = Math.atan2(-(b.x - a.x), -(b.z - a.z));
        return rem <= L;
      }
      rem -= L;
    }
    return false;
  }

  /** Every member's pose at shared resort time `now` (seconds). */
  compute(now: number) {
    const T = this.times, { loop, tau } = this.clock(now);
    const liftOffset = this.lifts.now(this.li) - now;
    const p = this.path, uphill = Math.atan2(-p.ax, -p.az);
    const tLift = T.lineup + T.toLift, tDesc = tLift + T.lift;
    let phase: Phase;
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i], out = this.poses[i];
      out.plow = m.plow; out.sit = 0; out.ride = undefined; out.skate = false; out.edge = 0; out.speed = 0;
      if (tau < T.lineup) {
        phase = 'lineup';
        const slot = this.lineupSlots[i];
        // the previous lap's arrival glides into the line-up
        const prev = { ...out }; this.onRoute(this.descent, i, T.descent, prev);
        const k = THREE.MathUtils.smoothstep(tau, 0, 7);
        out.x = prev.x + (slot.x - prev.x) * k; out.z = prev.z + (slot.z - prev.z) * k;
        out.heading = k < 0.6 ? prev.heading : slot.heading; out.speed = k < 1 ? 1 : 0;
        out.facing = slot.heading; out.plow = 0;
        if (k >= 1) out.heading = slot.heading;
      } else if (tau < tLift) {
        phase = 'toLift';
        out.facing = this.lineupSlots[i].heading;
        this.onRoute(this.toLift, i, tau - T.lineup, out, this.lineupSlots[i]);
      } else if (tau < tDesc) {
        phase = 'lift';
        const t = tau - tLift, wall = now - t; // wall time when the lift phase began
        const c = this.boardChairs(loop, wall, liftOffset);
        const L = now + liftOffset; // current lift clock
        const chair = m.chair === 0 ? c.a : c.b, arrive = m.chair === 0 ? c.arriveA : c.arriveB;
        const unloadAt = arrive + T.ride;
        if (L < arrive) {
          // into the open lane: trio A to the load line, trio B one row back until A's chair leaves
          const end = this.toLift.route.length;
          const filed = this.toLift.route.at(end - i * GAP);
          const lat = p.seatOffset(m.seat);
          const reached = !this.glide([filed, this.lane(16.5, 0), this.lane(5, lat), this.lane(m.chair === 0 ? 0.6 : 2.8, lat)], t * 1.3, out);
          out.speed = reached ? 0 : 1.3;
          if (reached) {
            out.heading = uphill;
            // trio B steps up to the load line once the first chair has scooped up trio A
            const step = m.chair === 1 ? THREE.MathUtils.clamp((L - c.arriveA - 1.2) / 2.2, 0, 1) : 0;
            if (step > 0) { const a = this.lane(2.8, lat), b = this.lane(0.6, lat); out.x = a.x + (b.x - a.x) * step; out.z = a.z + (b.z - a.z) * step; out.speed = step < 1 ? 1 : 0; }
          }
        } else if (L < unloadAt) {
          // seated, riding the actual chair on the shared lift clock
          out.ride = { chair, seat: m.seat, t: L };
          out.sit = Math.min(1, (L - arrive) / BOARD);
          out.heading = uphill;
        } else {
          // stand at the unload line and glide down the ramp to the regroup line on Segundo Road
          const up = p.unloadPoint(m.seat);
          const target = this.descent.route.at(this.follow(this.descent, i, 0));
          const tgtLat = this.descent.stops[0].side;
          const tgt = { x: target.x - target.tz * tgtLat, z: target.z + target.tx * tgtLat };
          const since = (L - unloadAt);
          const moving = this.glide([{ x: up.x, z: up.z }, this.descent.route.at(0), tgt], since * 2.6, out);
          out.speed = moving ? 2.6 : 0;
          out.sit = Math.max(0, 1 - since / STAND);
          if (!moving) out.heading = Math.atan2(-target.tx, -target.tz);
        }
      } else {
        phase = 'descent';
        this.onRoute(this.descent, i, tau - tDesc, out);
      }
    }
    return { phase: phase!, loop, tau };
  }

  /** Current activity and what comes next, for the tag-along panel. */
  status(now: number): LessonStatus {
    const T = this.times, { phase, loop, tau } = this.compute(now);
    const tLift = T.lineup + T.toLift, tDesc = tLift + T.lift;
    let label = '', next = '', say: string | null = null, sayKey = '';
    if (phase === 'lineup') {
      label = 'Lining up at the Lesson Line-Up Area by the lodge';
      next = `Skiing to Segundo in ${Math.ceil(T.lineup - tau)} s`;
      say = `Good morning, Snowriders! Skis on, poles in your hands. We are riding Segundo and skiing Ute home.`; sayKey = `${loop}/lineup`;
    } else if (phase === 'toLift') {
      label = 'Single file to the Segundo lift line'; next = 'Ski school lane, then two chairs together';
      say = 'Follow me in single file to Segundo. Ski school uses the open lane next to the crowd lane.'; sayKey = `${loop}/tolift`;
    } else if (phase === 'lift') {
      const p = this.poses[0];
      if (p.ride) { label = 'Riding Segundo'; next = 'Unload, glide straight off the ramp and regroup'; say = 'Bar up when we pass the last tower. Tips up, stand and glide straight off the ramp.'; sayKey = `${loop}/ride`; }
      else if (p.sit > 0) { label = 'Unloading at the top of Segundo'; next = 'Regroup at the top of Segundo Road'; }
      else { label = 'In the Segundo lift line'; next = 'Board two chairs together'; say = 'Look back over your outside shoulder for the chair, sit all the way back, then bar down.'; sayKey = `${loop}/queue`; }
    } else {
      const s = this.follow(this.descent, 0, tau - tDesc);
      const near = this.descent.stopNear(s);
      const upcoming = this.descent.stops.find((st) => st.s > s + 6);
      const run = s < this.descent.stops[1].s + 12 ? 'Segundo Road' : s < this.descent.stops[3].s + 145 ? 'Ute' : 'the lodge';
      if (near && near.d < 3) { label = near.stop.label; say = near.stop.say ?? null; sayKey = `${loop}/stop${this.descent.stops.indexOf(near.stop)}`; }
      else label = run === 'the lodge' ? 'Skating back to the lodge' : `Skiing ${run} (green)`;
      next = upcoming ? upcoming.label : 'Back to the Lesson Line-Up Area';
      if (run === 'the lodge' && !near) { say = 'Skate back up to the lodge. Great lap, everyone!'; sayKey = `${loop}/home`; }
    }
    const p0 = this.poses[0];
    return { phase, label, next, say, sayKey, instructor: { x: p0.x, y: this.probe.height(p0.x, p0.z), z: p0.z }, loop, tau };
  }

  /** Whether the instructor is about to leave a stop (solo tag-along waits here for the player). */
  waitingPoint(now: number): string | null {
    const T = this.times, { loop, tau } = this.clock(now);
    const tLift = T.lineup + T.toLift, tDesc = tLift + T.lift;
    if (tau > T.lineup - 4 && tau < T.lineup) return `${loop}/lineup`;
    if (tau >= tDesc) {
      const t = tau - tDesc, s = this.descent.s(t), ahead = this.descent.s(t + 3);
      if (ahead > s + 0.5) { const near = this.descent.stopNear(s); if (near && near.d < 0.5) return `${loop}/stop${this.descent.stops.indexOf(near.stop)}`; }
    }
    return null;
  }

  /** Solo: hold the lesson at a stop while a tag-along player catches up (at most two minutes per stop). */
  waitFor(now: number, dt: number, behind: boolean) {
    // hold by real elapsed time: the lesson clock is real time, frame time can be clamped when slow
    const real = this.lastWaitNow ? Math.min(1, Math.max(0, now - this.lastWaitNow)) : dt;
    this.lastWaitNow = now;
    dt = real;
    const point = this.waitingPoint(now);
    if (!point || !behind) return false;
    if (point !== this.holdStop) { this.holdStop = point; this.holdUsed = 0; }
    if (this.holdUsed > 120) return false;
    this.hold += dt; this.holdUsed += dt;
    return true;
  }

  /** The route the lesson follows, for the trail map. */
  routeLines(): P2[][] {
    if (!this.ready) return [];
    const top = this.path.unloadPoint(), lp = this.path.loadPoint();
    return [this.toLift.route.pts, [lp, top], this.descent.route.pts];
  }

  /** Whether the lesson is out on the mountain (Resort Day keeps it to lesson hours). */
  out = true;

  update(dt: number, now: number, camera: THREE.Vector3) {
    if (!this.ready) return;
    this.group.visible = this.out;
    if (!this.out) return;
    this.compute(now);
    const p = this.path;
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i], pose = this.poses[i];
      m.time += dt;
      if (pose.ride) {
        this.lifts.reserveTrip(this.li, pose.ride.chair);
        const lp = p.seatPoint(pose.ride.chair, pose.ride.seat, pose.ride.t);
        const fx = Math.sin(lp.heading), fz = Math.cos(lp.heading);
        const k = Math.min(1, pose.sit);
        // children's hips sit lower and closer to the seat back than the adult rider offset
        const ry = lp.p.y - RIDER_ROOT_BELOW_SEAT * m.scale, rx = lp.p.x - fx * RIDER_ROOT_FORWARD * m.scale, rz = lp.p.z - fz * RIDER_ROOT_FORWARD * m.scale;
        if (k < 1) {
          // boarding: blend from the load line spot into the seat
          const spot = this.lane(0.6, p.seatOffset(pose.ride.seat)), gy = this.probe.height(spot.x, spot.z);
          m.model.root.position.set(spot.x + (rx - spot.x) * k, gy + (ry - gy) * k, spot.z + (rz - spot.z) * k);
        } else m.model.root.position.set(rx, ry, rz);
        pose.x = m.model.root.position.x; pose.z = m.model.root.position.z;
        orientSkier(m.model.root, lp.heading);
      } else {
        this.clearTrees(pose);
        const y = this.probe.height(pose.x, pose.z);
        m.model.root.position.set(pose.x, y, pose.z);
        orientSkier(m.model.root, pose.heading, this.probe.normal(pose.x, pose.z, this.normal));
      }
      const d = m.model.root.position.distanceTo(camera);
      m.model.root.visible = d < 450;
      if (!m.model.root.visible) continue;
      const moving = pose.speed > 0.3;
      m.model.update({ speed: pose.speed, edge: pose.edge, plow: moving ? pose.plow : 0.05, tuck: 0, skid: moving ? 0.15 : 0, fallen: 0,
        sitting: pose.ride ? Math.min(1, pose.sit) : pose.sit, time: m.time, pushing: pose.skate, liftPreparation: pose.ride ? 1 : 0 });
    }
  }

  private hits: Collider[] = [];
  /** Narrow cat tracks run close to trunks: step around any tree or tower the shared line would clip.
   * Purely visual and local; the shared schedule is unchanged. */
  private clearTrees(pose: LessonPose) {
    if (!this.colliders) return;
    for (const c of this.colliders.query(pose.x, pose.z, this.hits)) {
      if (c.type !== 'cyl') continue;
      const dx = pose.x - c.x, dz = pose.z - c.z, d = Math.hypot(dx, dz), min = c.r! + 0.5;
      if (d >= min) continue;
      if (d < 1e-3) { pose.x += min; continue; }
      pose.x = c.x + dx / d * min; pose.z = c.z + dz / d * min;
    }
  }

  /** Reachable positions of all members (for tests and sound). */
  positions() { return this.members.map((m) => m.model.root.position.clone()); }
  get period() { return this.times?.period ?? 0; }
  get timeline() { return this.times; }
}
