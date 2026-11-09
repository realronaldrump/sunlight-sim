// Personal ski log: every descent with its line, distance, vertical, moving time and speeds; time on
// skis and on lifts; ski days; and how much of each trail you have skied. Kept in this browser
// (localStorage) across solo and multiplayer sessions. Durations are real play time, independent of
// the resort clock and of lift fast-forward.
import type { RunInfo } from '../game';

export const LOG_KEY = 'sunlight.skilog.v1';
const BIN = 10;               // m of trail per coverage bin
const NEAR = 12;              // m from a centreline that always counts as skiing that trail
const ON_RUN = 45;            // m from the centreline while inside that trail's mapped area
const CROSSING = 4;           // m: another trail's line counts only where you actually cross or join it
const MIN_PARTIAL = 5;        // bins (50 m) before a trail shows as partly skied
const COMPLETE = 0.75;        // share of a trail's bins in one descent that completes it
const MAX_DESCENTS = 400, MAX_TRACES = 60;
const MAX_VALID_SPEED = 40;   // m/s; faster is a teleport or glitch, not skiing

export interface Trail { key: string; name: string; difficulty: string; ways: number[][][]; bins: number; length: number; top: number; bottom: number; binY: number[] }
export interface Totals { dist: number; vert: number; moving: number; lift: number; elapsed: number; top: number; descents: number }
export interface DescentRun { key: string; frac: number; done: boolean }
export interface Descent {
  id: number; start: number; end: number; dist: number; vert: number; moving: number; top: number;
  startY: number; endY: number; runs: DescentRun[];
  /** Flat [x, z, y, speed] samples: positions in decimeters, speed in cm/s. Kept for recent descents. */
  trace?: number[];
}
interface TrailState { bins: string; laps: number; last?: number }
interface Stored { v: 1; totals: Totals; daily: Record<string, Totals>; trails: Record<string, TrailState>; descents: Descent[]; nextId: number }

export interface SkiSample {
  x: number; y: number; z: number; speed: number;
  /** On skis on the snow (not riding, walking or flying). */
  skiing: boolean; riding: boolean; fallen: boolean;
  /** Mapped run under the skier, if any. */
  run: string | null;
}

const zero = (): Totals => ({ dist: 0, vert: 0, moving: 0, lift: 0, elapsed: 0, top: 0, descents: 0 });
export function localDay(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Trail catalog: every named, skiable mapped run (green to double black and the park), one per name. */
export function buildTrails(runs: RunInfo[]): Trail[] {
  const byName = new Map<string, RunInfo[]>();
  for (const r of runs) {
    if (r.kind !== 'line' || r.points.length < 2 || !['green', 'blue', 'black', 'double', 'park'].includes(r.difficulty)) continue;
    const list = byName.get(r.name); if (list) list.push(r); else byName.set(r.name, [r]);
  }
  const trails: Trail[] = [];
  for (const [name, ways] of byName) {
    // stable key: the lowest OSM way id with this name survives renames of the display name
    const key = `osm:${Math.min(...ways.map((w) => w.id))}`;
    let length = 0; const binY: number[] = [];
    for (const w of ways) {
      let carry = 0;
      for (let i = 1; i < w.points.length; i++) {
        const a = w.points[i - 1], b = w.points[i], L = Math.hypot(b[0] - a[0], b[2] - a[2]);
        for (let s = carry; s < L; s += BIN) binY.push(a[1] + (b[1] - a[1]) * (s / L));
        carry = (carry - L) % BIN; if (carry < 0) carry += BIN;
        length += L;
      }
    }
    const ys = binY.length ? binY : [0];
    trails.push({ key, name, difficulty: ways[0].difficulty, ways: ways.map((w) => w.points), bins: binY.length, length, top: Math.max(...ys), bottom: Math.min(...ys), binY });
  }
  return trails.sort((a, b) => a.name.localeCompare(b.name));
}

interface BinRef { t: number; b: number; x: number; z: number }

export class SkiLog {
  readonly trails: Trail[];
  private grid = new Map<string, BinRef[]>();
  private data: Stored;
  session = zero();
  private current: { d: Descent; bins: Map<number, Set<number>>; lastSample: { x: number; z: number; t: number }; idle: number; lastY: number } | null = null;
  private last: { x: number; y: number; z: number } | null = null;
  private saveTimer = 0;
  private visited: Uint8Array[];
  /** Called when a descent is recorded (for toasts). */
  onDescent: ((d: Descent, completed: string[]) => void) | null = null;

  constructor(runs: RunInfo[], private storage: Storage | null = safeStorage()) {
    this.trails = buildTrails(runs);
    this.trails.forEach((tr, t) => {
      let b = 0;
      for (const way of tr.ways) {
        let carry = 0;
        for (let i = 1; i < way.length; i++) {
          const a = way[i - 1], c = way[i], L = Math.hypot(c[0] - a[0], c[2] - a[2]);
          for (let s = carry; s < L; s += BIN) {
            const x = a[0] + (c[0] - a[0]) * (s / L), z = a[2] + (c[2] - a[2]) * (s / L);
            const k = `${Math.floor(x / 25)}/${Math.floor(z / 25)}`;
            const cell = this.grid.get(k); const ref = { t, b: b++, x, z };
            if (cell) cell.push(ref); else this.grid.set(k, [ref]);
          }
          carry = (carry - L) % BIN; if (carry < 0) carry += BIN;
        }
      }
    });
    this.data = this.load();
    this.visited = this.trails.map((tr) => decodeBits(this.data.trails[tr.key]?.bins ?? '', tr.bins));
  }

  private load(): Stored {
    try {
      const raw = this.storage?.getItem(LOG_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Stored;
        if (s && s.v === 1 && s.totals && Array.isArray(s.descents)) return { ...s, daily: s.daily ?? {}, trails: s.trails ?? {}, nextId: s.nextId ?? s.descents.length + 1 };
      }
    } catch { /* unreadable or blocked storage: start a fresh log */ }
    return { v: 1, totals: zero(), daily: {}, trails: {}, descents: [], nextId: 1 };
  }

  save() {
    this.saveTimer = 0;
    this.data.trails = Object.fromEntries(this.trails.map((tr, t) => {
      const prev = this.data.trails[tr.key];
      return [tr.key, { bins: encodeBits(this.visited[t]), laps: prev?.laps ?? 0, last: prev?.last }];
    }).filter(([, st]) => (st as TrailState).bins !== '' || (st as TrailState).laps > 0));
    try { this.storage?.setItem(LOG_KEY, JSON.stringify(this.data)); } catch { /* storage full or blocked */ }
  }

  get totals() { return this.data.totals; }
  get descents() { return this.data.descents; }
  today() { return this.data.daily[localDay()] ?? zero(); }
  get days() { return Object.keys(this.data.daily).filter((k) => this.data.daily[k].dist > 0).sort(); }

  /** Per-trail state: share of the trail ever skied, completed laps, last lap. */
  coverage() {
    return this.trails.map((tr, t) => {
      const v = this.visited[t]; let n = 0; for (let i = 0; i < v.length; i++) n += v[i];
      const st = this.data.trails[tr.key];
      const laps = st?.laps ?? 0;
      return { trail: tr, frac: tr.bins ? n / tr.bins : 0, laps, last: st?.last, status: laps > 0 ? 'completed' as const : n >= Math.min(MIN_PARTIAL, tr.bins) ? 'partial' as const : 'unvisited' as const };
    });
  }

  private add(t: Totals, f: (x: Totals) => void) { f(t); }
  private bump(f: (x: Totals) => void) {
    const day = localDay();
    const d = this.data.daily[day] ?? (this.data.daily[day] = zero());
    for (const t of [this.session, this.data.totals, d]) this.add(t, f);
  }

  /** Call every frame with real (unscaled) elapsed time. `paused`: nothing should accrue but session time. */
  update(dt: number, s: SkiSample, teleported = false) {
    if (!(dt > 0) || dt > 1) return;
    this.bump((t) => { t.elapsed += dt; });
    if (s.riding) this.bump((t) => { t.lift += dt; });
    const jumped = !!this.last && (teleported || Math.hypot(s.x - this.last.x, s.z - this.last.z) > Math.max(6, s.speed * dt * 3 + 2));
    const prev = this.last;
    this.last = { x: s.x, y: s.y, z: s.z };
    if (!s.skiing || jumped) { this.endDescent(); return; }
    // movement on skis
    if (prev) {
      const step = Math.hypot(s.x - prev.x, s.y - prev.y, s.z - prev.z);
      if (step > 0 && step < 30) {
        const speed = Math.min(s.speed, MAX_VALID_SPEED);
        const moving = speed > 0.5;
        this.bump((t) => { t.dist += step; if (moving) t.moving += dt; if (!s.fallen && speed > t.top) t.top = speed; });
      }
    }
    if (!this.current) {
      if (s.speed < 1) return;
      const now = Date.now();
      this.current = { d: { id: this.data.nextId++, start: now, end: now, dist: 0, vert: 0, moving: 0, top: 0, startY: s.y, endY: s.y, runs: [], trace: [] },
        bins: new Map(), lastSample: { x: s.x, z: s.z, t: now }, idle: 0, lastY: s.y };
      this.pushTrace(s);
    }
    const c = this.current, d = c.d;
    if (prev) {
      const step = Math.hypot(s.x - prev.x, s.y - prev.y, s.z - prev.z);
      if (step < 30) d.dist += step;
    }
    // vertical: count descent along the way, ignore bumps under 0.4 m
    if (s.y < c.lastY - 0.4) { d.vert += c.lastY - s.y; this.bump((t) => { t.vert += c.lastY - s.y; }); c.lastY = s.y; }
    else if (s.y > c.lastY + 0.4) c.lastY = s.y;
    const speed = Math.min(s.speed, MAX_VALID_SPEED);
    if (speed > 0.5) { d.moving += dt; c.idle = 0; } else c.idle += dt;
    if (!s.fallen && speed > d.top) d.top = speed;
    d.end = Date.now(); d.endY = s.y;
    this.markBins(s, c.bins);
    const ls = c.lastSample;
    if (Math.hypot(s.x - ls.x, s.z - ls.z) >= 5 || d.end - ls.t > 3000) this.pushTrace(s);
    if (c.idle > 240) this.endDescent();
    if ((this.saveTimer += dt) > 10) this.save();
  }

  private pushTrace(s: SkiSample) {
    const c = this.current!;
    c.d.trace!.push(Math.round(s.x * 10), Math.round(s.z * 10), Math.round(s.y * 10), Math.round(Math.min(s.speed, MAX_VALID_SPEED) * 100));
    c.lastSample = { x: s.x, z: s.z, t: Date.now() };
  }

  private nearest = new Map<number, { ref: BinRef; d: number }>();
  /** Credit the bin of each trail level with the skier (their projection onto its line), if they are on it. */
  private markBins(s: SkiSample, into: Map<number, Set<number>>) {
    const cx = Math.floor(s.x / 25), cz = Math.floor(s.z / 25), near = this.nearest;
    near.clear();
    for (let i = cx - 2; i <= cx + 2; i++) for (let j = cz - 2; j <= cz + 2; j++) {
      for (const ref of this.grid.get(`${i}/${j}`) ?? []) {
        const d = Math.hypot(ref.x - s.x, ref.z - s.z), best = near.get(ref.t);
        if (!best || d < best.d) near.set(ref.t, { ref, d });
      }
    }
    for (const [t, { ref, d }] of near) {
      const tr = this.trails[t];
      // On a mapped run, credit that run across its width; brush past others only where the lines meet.
      if (tr.name === s.run ? d > ON_RUN : d > (s.run ? CROSSING : NEAR)) continue;
      let set = into.get(t); if (!set) into.set(t, set = new Set());
      for (const b of [ref.b - 1, ref.b, ref.b + 1]) if (b >= 0 && b < tr.bins) { set.add(b); this.visited[t][b] = 1; }
    }
  }

  /** Close the current descent. Short shuffles are not descents, but their distance still counts. */
  endDescent() {
    const c = this.current;
    if (!c) return;
    this.current = null;
    const d = c.d;
    if (d.dist < 60 || d.vert < 12) return;
    const completed: string[] = [];
    d.runs = this.runsFor(c.bins);
    for (const r of d.runs) if (r.done) {
      const st = this.data.trails[r.key] ?? (this.data.trails[r.key] = { bins: '', laps: 0 });
      st.laps++; st.last = d.end; completed.push(this.trailByKey(r.key)!.name);
    }
    this.data.descents.push(d);
    this.bump((t) => { t.descents++; });
    if (this.data.descents.length > MAX_DESCENTS) this.data.descents.splice(0, this.data.descents.length - MAX_DESCENTS);
    for (let i = 0; i < this.data.descents.length - MAX_TRACES; i++) delete this.data.descents[i].trace;
    this.save();
    this.onDescent?.(d, completed);
  }

  /** Trails skied in one descent: share of each trail's bins, and whether that was a full lap. */
  private runsFor(bins: Map<number, Set<number>>) {
    const runs: DescentRun[] = [];
    for (const [t, set] of bins) {
      const tr = this.trails[t], frac = set.size / Math.max(1, tr.bins);
      // a lap means most of the trail, including its upper and lower sections, in one continuous descent
      const span = tr.top - tr.bottom, ys = [...set].map((b) => tr.binY[b]);
      const reachedTop = Math.max(...ys) >= tr.top - span * 0.2, reachedBottom = Math.min(...ys) <= tr.bottom + span * 0.2;
      const done = frac >= COMPLETE && reachedTop && reachedBottom;
      if ((frac < 0.05 || set.size < MIN_PARTIAL) && !done) continue;
      runs.push({ key: tr.key, frac: Math.min(1, frac), done });
    }
    return runs.sort((a, b) => b.frac - a.frac);
  }

  /** The descent being skied right now, if it is long enough to show. */
  active(): Descent | null {
    const c = this.current;
    if (!c || c.d.dist < 30) return null;
    return { ...c.d, runs: this.runsFor(c.bins), trace: c.d.trace?.slice() };
  }

  trailByKey(key: string) { return this.trails.find((t) => t.key === key); }

  /** Forget everything (from the log's reset button). */
  reset() {
    this.data = { v: 1, totals: zero(), daily: {}, trails: {}, descents: [], nextId: 1 };
    this.visited = this.trails.map((tr) => new Uint8Array(tr.bins));
    this.session = zero(); this.current = null;
    this.save();
  }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function encodeBits(v: Uint8Array) {
  let any = false; const bytes = new Uint8Array(Math.ceil(v.length / 8));
  for (let i = 0; i < v.length; i++) if (v[i]) { bytes[i >> 3] |= 1 << (i & 7); any = true; }
  if (!any) return '';
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function decodeBits(s: string, n: number) {
  const v = new Uint8Array(n);
  if (!s) return v;
  try {
    const raw = atob(s);
    for (let i = 0; i < n; i++) if ((raw.charCodeAt(i >> 3) >> (i & 7)) & 1) v[i] = 1;
  } catch { /* corrupt entry: treat as unvisited */ }
  return v;
}
