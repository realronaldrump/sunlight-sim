// Chairlift geometry and timing shared by client, server and tests.
// A lift is a closed haul-rope loop: uphill line, top bull wheel, downhill line, bottom bull wheel.
// Chair positions are a pure function of (lift clock time), so every client and the server agree.

export interface LiftSupport { s: number; kind: 'bottom' | 'tower' | 'top'; ground: number; cable: number }
export interface LiftDef {
  name: string; kind: string; seats: number; speed: number; capacity: number; chairSpacing: number;
  bottom: [number, number, number]; top: [number, number, number];
  horizontalLength: number; slopeLength: number; vertical: number;
  supports: LiftSupport[];
  chairCount?: number;
  reference?: { url: string; lengthFt: number; verticalFt: number; rideMinutes: number; towers: number };
}

export const GAUGE = 5.2;        // m between uphill and downhill rope
export const HANGER = 3.0;       // m from rope to seat surface
export const SAG_FRAC = 0.018;   // must match pipeline/build_osm.py
export const LOAD_OFFSET = 7.0;  // m from bottom bull wheel center to the load line
export const UNLOAD_OFFSET = 6.5; // m before the top bull wheel center where riders stand up
export const SEAT_SPACING = 0.6;
export const SEAT_TOP = 0.035;
export const LOAD_SEAT_HEIGHT = 0.52; // estimated maintained snow-to-seat clearance, not a surveyed Sunlight dimension
export const RIDER_ROOT_BELOW_SEAT = 0.44; // seated hip joint is 0.54 m above origin; pelvis rests 0.10 m above cushion
export const RIDER_ROOT_FORWARD = 0.25; // seated hips are 0.25 m behind the model origin
export const BOARD_FACING_COS = Math.cos(35 * Math.PI / 180);

export interface P3 { x: number; y: number; z: number }

export class LiftPath {
  readonly def: LiftDef;
  readonly ax: number; readonly az: number;      // unit horizontal axis bottom->top (game x,z)
  readonly rx: number; readonly rz: number;      // unit right-hand side when facing uphill
  readonly horiz: number;
  readonly lineLen: number;                      // 3D rope length along one line (approx)
  readonly loopLen: number;
  readonly chairCount: number;
  readonly spacing: number;
  private sTable: number[] = [];                 // cumulative 3D length at sample i
  private hTable: number[] = [];                 // horizontal distance at sample i

  constructor(def: LiftDef) {
    this.def = def;
    const dx = def.top[0] - def.bottom[0], dz = def.top[2] - def.bottom[2];
    this.horiz = Math.hypot(dx, dz);
    this.ax = dx / this.horiz; this.az = dz / this.horiz;
    // facing uphill along (ax, az); right = (-az, ax) rotated: right of forward f=(fx,fz) in x/z with y up is (-fz, fx)?
    // forward (0,-1) (north) -> right is east (1,0) => right = (-fz, fx)
    this.rx = -this.az; this.rz = this.ax;
    // tabulate rope length vs horizontal distance
    const N = Math.max(200, Math.ceil(this.horiz / 2));
    let acc = 0, prevY = this.cableY(0);
    this.sTable.push(0); this.hTable.push(0);
    for (let i = 1; i <= N; i++) {
      const h = (this.horiz * i) / N;
      const y = this.cableY(h);
      acc += Math.hypot(this.horiz / N, y - prevY);
      prevY = y;
      this.sTable.push(acc); this.hTable.push(h);
    }
    this.lineLen = acc;
    this.loopLen = 2 * this.lineLen + Math.PI * GAUGE;
    this.chairCount = def.chairCount ?? Math.max(2, Math.round(this.loopLen / def.chairSpacing));
    this.spacing = this.loopLen / this.chairCount;
  }

  /** Rope height (absolute y) at horizontal distance h from the bottom bull wheel. */
  cableY(h: number): number {
    const S = this.def.supports;
    if (h <= S[0].s) return S[0].cable;
    for (let i = 0; i < S.length - 1; i++) {
      const a = S[i], b = S[i + 1];
      if (h <= b.s) {
        const L = b.s - a.s;
        const t = L > 0 ? (h - a.s) / L : 0;
        return a.cable + (b.cable - a.cable) * t - 4 * SAG_FRAC * L * t * (1 - t);
      }
    }
    return S[S.length - 1].cable;
  }

  /** Horizontal distance for a rope arc length along one line. */
  hAtS(s: number): number {
    const T = this.sTable, H = this.hTable;
    if (s <= 0) return 0;
    if (s >= this.lineLen) return this.horiz;
    let lo = 0, hi = T.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] < s) lo = m; else hi = m; }
    const t = (s - T[lo]) / (T[hi] - T[lo]);
    return H[lo] + (H[hi] - H[lo]) * t;
  }

  /** Point on the rope at horizontal distance h, side +1 = uphill line (right), -1 = downhill line. */
  ropePoint(h: number, side: number, out: P3 = { x: 0, y: 0, z: 0 }): P3 {
    const b = this.def.bottom;
    out.x = b[0] + this.ax * h + this.rx * side * GAUGE / 2;
    out.z = b[2] + this.az * h + this.rz * side * GAUGE / 2;
    out.y = this.cableY(h);
    return out;
  }

  /**
   * Chair grip position and travel direction for loop parameter u in [0, loopLen).
   * u = 0 at the bottom bull wheel on the uphill side; increases in the direction of travel.
   */
  loopPoint(u: number, out: P3 = { x: 0, y: 0, z: 0 }): { p: P3; heading: number; uphill: boolean; h: number } {
    const L = this.lineLen, R = GAUGE / 2;
    u = ((u % this.loopLen) + this.loopLen) % this.loopLen;
    const fwdHeading = Math.atan2(-this.ax, -this.az); // heading facing uphill
    if (u < L) {
      const h = this.hAtS(u);
      this.ropePoint(h, 1, out);
      return { p: out, heading: fwdHeading, uphill: true, h };
    }
    u -= L;
    const arc = Math.PI * R;
    if (u < arc) {
      // around the top bull wheel from right side to left side
      const a = u / R; // 0..pi
      const t = this.def.top;
      const cx = t[0], cz = t[2];
      const ox = Math.cos(a) * R, of = Math.sin(a) * R; // along right axis, forward axis
      out.x = cx + this.rx * ox + this.ax * of;
      out.z = cz + this.rz * ox + this.az * of;
      out.y = this.cableY(this.horiz);
      return { p: out, heading: fwdHeading + a, uphill: false, h: this.horiz };
    }
    u -= arc;
    if (u < L) {
      const h = this.hAtS(L - u);
      this.ropePoint(h, -1, out);
      return { p: out, heading: fwdHeading + Math.PI, uphill: false, h };
    }
    u -= L;
    const a = Math.min(Math.PI, u / R);
    const bt = this.def.bottom;
    const ox = -Math.cos(a) * R, of = -Math.sin(a) * R;
    out.x = bt[0] + this.rx * ox + this.ax * of;
    out.z = bt[2] + this.rz * ox + this.az * of;
    out.y = this.cableY(0);
    return { p: out, heading: fwdHeading + Math.PI + a, uphill: true, h: 0 };
  }

  /** Loop parameter of chair i at lift clock time t (seconds). */
  chairU(i: number, t: number) {
    return (((t * this.def.speed + i * this.spacing) % this.loopLen) + this.loopLen) % this.loopLen;
  }

  /** Loop parameter of the load line (where riders are scooped up). */
  get loadU() { return this.sAtH(LOAD_OFFSET); }
  get unloadU() { return this.sAtH(this.horiz - UNLOAD_OFFSET); }
  sAtH(h: number) {
    h = Math.max(0, Math.min(this.horiz, h));
    const T = this.sTable, H = this.hTable;
    let lo = 0, hi = H.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (H[m] < h) lo = m; else hi = m; }
    const t = (h - H[lo]) / ((H[hi] - H[lo]) || 1);
    return T[lo] + (T[hi] - T[lo]) * t;
  }

  /** Index of the next chair to reach loop parameter u after time t, and when it arrives. */
  nextChairAt(u: number, t: number): { index: number; arrive: number } {
    const base = (t * this.def.speed) % this.loopLen;
    // chair i at u_i = base + i*spacing (mod loop). Want smallest dt >= 0 with u_i + v*dt = u.
    let best = -1, bestDt = Infinity;
    for (let i = 0; i < this.chairCount; i++) {
      let d = u - ((base + i * this.spacing) % this.loopLen);
      d = ((d % this.loopLen) + this.loopLen) % this.loopLen;
      const dt = d / this.def.speed;
      if (dt < bestDt) { bestDt = dt; best = i; }
    }
    return { index: best, arrive: t + bestDt };
  }

  /** The load zone: world point where a rider should stand, and the uphill heading. */
  loadPoint(): { x: number; z: number; heading: number } {
    const p = this.ropePoint(LOAD_OFFSET, 1);
    return { x: p.x, z: p.z, heading: Math.atan2(-this.ax, -this.az) };
  }
  unloadPoint(seat = (this.def.seats - 1) / 2): { x: number; z: number; heading: number } {
    const p = this.ropePoint(this.horiz - UNLOAD_OFFSET, 1);
    const off = this.seatOffset(seat);
    p.x += this.rx * off; p.z += this.rz * off;
    return { x: p.x, z: p.z, heading: Math.atan2(-this.ax, -this.az) };
  }

  seatOffset(seat: number) { return (seat - (this.def.seats - 1) / 2) * SEAT_SPACING; }

  /** One seat transform for rendering, player physics and the authoritative server. */
  seatPoint(chair: number, seat: number, t: number) {
    const u = this.chairU(chair, t), lp = this.loopPoint(u);
    const off = this.seatOffset(seat), h = lp.heading;
    const bank = this.chairBank(u), y = -HANGER + SEAT_TOP;
    const x = off * Math.cos(bank) - y * Math.sin(bank);
    lp.p.x += Math.cos(h) * x + Math.sin(h) * 0.12;
    lp.p.z += -Math.sin(h) * x + Math.cos(h) * 0.12;
    lp.p.y += off * Math.sin(bank) + y * Math.cos(bank);
    return lp;
  }

  riderPoint(chair: number, seat: number, t: number) {
    const lp = this.seatPoint(chair, seat, t);
    lp.p.x -= Math.sin(lp.heading) * RIDER_ROOT_FORWARD;
    lp.p.z -= Math.cos(lp.heading) * RIDER_ROOT_FORWARD;
    lp.p.y -= RIDER_ROOT_BELOW_SEAT;
    return lp;
  }

  stationHeight(top: boolean, h = top ? this.horiz - UNLOAD_OFFSET : LOAD_OFFSET) {
    return this.cableY(Math.max(0, Math.min(this.horiz, h))) - HANGER + SEAT_TOP - LOAD_SEAT_HEIGHT;
  }

  /** Catch a chair which actually crossed the load line, including across a slow render frame. */
  crossingChair(previousTime: number, t: number): number | null {
    if (t < previousTime || t - previousTime > 2) return null;
    const next = this.nextChairAt(this.loadU, previousTime);
    return next.arrive <= t + 1e-7 ? next.index : null;
  }

  /** Swept carrier/skier contact on the straight loading approach. The red stripe
   * is a guide, not a trigger. Both the skier and seat may move during the frame. */
  boardingContact(from: P3, to: P3, start: number, end: number, onlyChair?: number): { chair: number; seat: number; fraction: number; along: number } | null {
    if (end < start) return null;
    if (end - start > 2) start = end;
    const maxU = this.sAtH(LOAD_OFFSET + 12);
    const bodyReach = .27, acrossReach = this.def.seats * SEAT_SPACING / 2 + bodyReach;
    let best: { chair: number; seat: number; fraction: number; along: number } | null = null;
    const min = onlyChair ?? 0, max = onlyChair === undefined ? this.chairCount : onlyChair + 1;
    for (let chair = min; chair < max; chair++) {
      const u = this.chairU(chair, end);
      if (u > maxU + this.def.speed * (end - start)) continue;
      const sampleStart = Math.max(start, end - u / this.def.speed);
      const startFraction = end > start ? (sampleStart - start) / (end - start) : 0;
      const sampledFrom = { x: from.x + (to.x - from.x) * startFraction, y: from.y + (to.y - from.y) * startFraction, z: from.z + (to.z - from.z) * startFraction };
      const a = this.seatPoint(chair, (this.def.seats - 1) / 2, sampleStart).p;
      const b = this.seatPoint(chair, (this.def.seats - 1) / 2, end).p;
      const project = (p: P3, q: P3) => ({ along: (p.x - q.x) * this.ax + (p.z - q.z) * this.az, across: (p.x - q.x) * this.rx + (p.z - q.z) * this.rz });
      const r0 = project(sampledFrom, a), r1 = project(to, b);
      let enter = 0, exit = 1;
      // At seat height the knees are ahead of the ski-root origin. The front of
      // the cushion must actually reach the backs of the legs before pickup.
      for (const [v0, v1, low, high] of [[r0.along, r1.along, -.3, .2], [r0.across, r1.across, -acrossReach, acrossReach]]) {
        const delta = v1 - v0;
        if (Math.abs(delta) < 1e-9) { if (v0 < low || v0 > high) exit = -1; }
        else {
          const t0 = (low - v0) / delta, t1 = (high - v0) / delta;
          enter = Math.max(enter, Math.min(t0, t1)); exit = Math.min(exit, Math.max(t0, t1));
        }
      }
      if (enter > exit || enter > 1 || exit < 0) continue;
      const hitTime = sampleStart + (end - sampleStart) * enter, hitU = this.chairU(chair, hitTime);
      if (hitU > maxU) continue; // never collect a rider from the return rope or mid-mountain
      const clearance = a.y + (b.y - a.y) * enter - (sampledFrom.y + (to.y - sampledFrom.y) * enter);
      if (clearance < .25 || clearance > 1.05) continue;
      const across = r0.across + (r1.across - r0.across) * enter;
      const seat = Math.max(0, Math.min(this.def.seats - 1, Math.round(across / SEAT_SPACING + (this.def.seats - 1) / 2)));
      if (!best || enter < best.fraction) best = { chair, seat, fraction: enter, along: r1.along };
    }
    return best;
  }

  inBoardingApproach(x: number, z: number) {
    const dx = x - this.def.bottom[0], dz = z - this.def.bottom[2];
    const along = dx * this.ax + dz * this.az, across = dx * this.rx + dz * this.rz;
    return along >= -1 && along <= LOAD_OFFSET + 13 && Math.abs(across - GAUGE / 2) <= this.def.seats * SEAT_SPACING / 2 + .4;
  }

  remainingRideTime(chair: number, t: number) {
    return Math.max(0, (this.unloadU - this.chairU(chair, t)) / this.def.speed);
  }

  restraintAngle(h: number, uphill: boolean) {
    const smooth = (v: number) => { const x = Math.max(0, Math.min(1, v)); return x * x * (3 - 2 * x); };
    const closed = uphill ? smooth((h - LOAD_OFFSET - 4) / 10) * smooth((this.horiz - UNLOAD_OFFSET - h - 6) / 14) : 0;
    return (1 - closed) * Math.PI * 0.96;
  }

  /** Smooth quasi-static outward bank on the bullwheel, from v²/r and gravity.
   * This approximates empty-chair swing, not a full pendulum/cable dynamics solver. */
  chairBank(u: number) {
    u = ((u % this.loopLen) + this.loopLen) % this.loopLen;
    const arc = Math.PI * GAUGE / 2;
    const a = u >= this.lineLen && u < this.lineLen + arc ? (u - this.lineLen) / arc
      : u >= 2 * this.lineLen + arc ? (u - 2 * this.lineLen - arc) / arc : 0;
    return Math.atan(this.def.speed ** 2 / ((GAUGE / 2) * 9.81)) * Math.sin(Math.PI * a) ** 2;
  }

  /** Is a ground point inside the load zone (in front of the uphill line, near the load line)? */
  inLoadZone(x: number, z: number): boolean {
    const b = this.def.bottom;
    const dx = x - b[0], dz = z - b[2];
    const along = dx * this.ax + dz * this.az;
    const across = dx * this.rx + dz * this.rz;
    return along > LOAD_OFFSET - 4.5 && along < LOAD_OFFSET + 1.2 && Math.abs(across - GAUGE / 2) < this.def.seats * SEAT_SPACING / 2 + 0.2;
  }

  rideTime() { return (this.unloadU - this.loadU) / this.def.speed; }
}
