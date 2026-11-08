// Scripted skier ("bot") that follows a run centerline using the same inputs a player has.
// Used by the physics test harness and as an autopilot demo. Personas: cautious beginner (keeps
// speed low with turns and wedge), intermediate (linked turns) and racer (tuck, minimal turning).
import { SkierState, SkiInput, headingFromDir } from './skiPhysics';

export type Persona = 'beginner' | 'intermediate' | 'racer';

export interface BotConfig {
  persona: Persona;
  targetSpeed: number; // m/s
  lookAhead: number;   // m
}

export const PERSONAS: Record<Persona, BotConfig> = {
  beginner: { persona: 'beginner', targetSpeed: 5.0, lookAhead: 14 },     // ~18 km/h
  intermediate: { persona: 'intermediate', targetSpeed: 11, lookAhead: 22 },
  racer: { persona: 'racer', targetSpeed: 40, lookAhead: 30 },
};

function wrap(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export class SkiBot {
  private idx = 0;
  private turnPhase = 0;
  private turnSide = 1;
  private stuckTime = 0;
  done = false;

  constructor(private path: { x: number; z: number }[], public cfg: BotConfig) {}

  /** Index of path vertex nearest the skier, searched forward from the last index. */
  private advance(st: SkierState) {
    let best = this.idx, bestD = Infinity;
    for (let i = this.idx; i < Math.min(this.path.length, this.idx + 40); i++) {
      const d = Math.hypot(this.path[i].x - st.pos.x, this.path[i].z - st.pos.z);
      if (d < bestD) { bestD = d; best = i; }
    }
    this.idx = best;
    if (this.idx >= this.path.length - 2 && bestD < 12) this.done = true;
    return bestD;
  }

  private target(st: SkierState) {
    // walk forward along the path by lookAhead meters
    let remain = this.cfg.lookAhead;
    let p = { x: st.pos.x, z: st.pos.z };
    for (let i = this.idx + 1; i < this.path.length; i++) {
      const q = this.path[i];
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d >= remain) {
        const t = remain / d;
        return { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t };
      }
      remain -= d; p = q;
    }
    return this.path[this.path.length - 1];
  }

  input(st: SkierState, dt: number): SkiInput {
    const inp: SkiInput = { steer: 0, tuck: false, plow: 0, stop: false, push: false };
    if (st.mode === 'fallen') return inp;
    const off = this.advance(st);
    const tgt = this.target(st);
    const desired = headingFromDir(tgt.x - st.pos.x, tgt.z - st.pos.z);
    const speed = st.speed;
    const over = speed - this.cfg.targetSpeed;
    let err = wrap(desired - st.heading);
    // speed control by turning: the faster we are above target the more we swing across the hill
    if (this.cfg.persona !== 'racer') {
      this.turnPhase += dt;
      const period = this.cfg.persona === 'beginner' ? 3.2 : 2.2;
      if (this.turnPhase > period) { this.turnPhase = 0; this.turnSide = -this.turnSide; }
      const swing = Math.min(1.1, Math.max(0, over / this.cfg.targetSpeed) * 1.4 + (this.cfg.persona === 'beginner' ? 0.35 : 0.25));
      err = wrap(err + this.turnSide * swing * (off < 25 ? 1 : 0.3));
    }
    inp.steer = Math.max(-1, Math.min(1, -err * 1.8));
    if (this.cfg.persona === 'beginner') {
      inp.plow = Math.max(0, Math.min(1, over / 2.0 + 0.15));
      if (speed < 1.5) inp.plow = 0;
    } else if (this.cfg.persona === 'intermediate') {
      inp.plow = 0;
      if (over > 6) inp.stop = false;
    } else {
      inp.tuck = Math.abs(err) < 0.25;
    }
    inp.push = speed < 3 && Math.abs(err) < 0.6;
    // stuck on a flat or after turning uphill: point at the target and skate
    this.stuckTime = speed < 1.0 ? this.stuckTime + dt : 0;
    if (this.stuckTime > 2) {
      const e2 = wrap(desired - st.heading);
      inp.steer = Math.max(-1, Math.min(1, -e2 * 2.5));
      inp.plow = 0; inp.tuck = false;
      inp.push = Math.abs(e2) < 0.8;
    }
    return inp;
  }
}
