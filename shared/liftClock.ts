/** A continuous lift timeline. Fast-forward ends at an unload deadline, even after suspension. */
export const LIFT_FAST_RATE = 8;
export interface LiftPlayback { time: number; at: number; rate: number; until?: number }

export class LiftClock {
  private state: LiftPlayback;
  constructor(private wall = () => Date.now() / 1000) {
    const t = wall(); this.state = { time: t, at: t, rate: 1 };
  }
  now(at = this.wall()) {
    const s = this.state, elapsed = Math.max(0, at - s.at);
    const fastSeconds = s.until === undefined ? elapsed : Math.min(elapsed, Math.max(0, s.until - s.time) / s.rate);
    return s.time + fastSeconds * s.rate + (elapsed - fastSeconds);
  }
  get rate() { return this.state.until !== undefined && this.now() >= this.state.until ? 1 : this.state.rate; }
  setRate(rate: 1 | 8, until?: number) {
    const at = this.wall();
    this.state = { time: this.now(at), at, rate, until: rate > 1 ? until : undefined };
  }
  snapshot(): LiftPlayback {
    return { time: this.now(), at: this.wall(), rate: this.rate, until: this.rate > 1 ? this.state.until : undefined };
  }
  sync(s: LiftPlayback, serverNow: number) {
    if (![s.time, s.at, s.rate, serverNow].every(Number.isFinite) || ![1, LIFT_FAST_RATE].includes(s.rate) ||
        (s.until !== undefined && !Number.isFinite(s.until))) return;
    this.state = { ...s, at: this.wall() - Math.max(0, serverNow - s.at) };
  }
}
