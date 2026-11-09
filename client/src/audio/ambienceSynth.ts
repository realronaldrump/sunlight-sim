// Original synthesized ambience for places without a field recording (CC0, generated here):
// the lodge's conversation, cups, espresso machine and register, ski boots on wooden floors,
// and dry aspen branches knocking in the wind. All deterministic, built once per audio context.

type Ctx = BaseAudioContext;

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/** Two-pole resonator (band-pass) state for streaming synthesis. */
class Resonator {
  private y1 = 0; private y2 = 0; private a1 = 0; private a2 = 0; private g = 0;
  constructor(private rate: number) {}
  tune(freq: number, q: number) {
    const w = 2 * Math.PI * freq / this.rate, r = Math.exp(-w / (2 * q));
    this.a1 = 2 * r * Math.cos(w); this.a2 = -r * r; this.g = (1 - r * r) * 0.5;
  }
  step(x: number) { const y = this.g * x + this.a1 * this.y1 + this.a2 * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}

/** Indistinct conversation in a room: several talkers, syllables with formant glides and pauses. */
export function babble(ctx: Ctx, seconds = 14, talkers = 9, seed = 77) {
  const sr = ctx.sampleRate, n = Math.round(sr * seconds), buf = ctx.createBuffer(2, n, sr);
  const L = buf.getChannelData(0), R = buf.getChannelData(1), r = rng(seed);
  for (let t = 0; t < talkers; t++) {
    const f1 = new Resonator(sr), f2 = new Resonator(sr);
    const pitch = 95 + r() * 140, pan = (r() - 0.5) * 1.4, level = 0.5 + r() * 0.5;
    let env = 0, target = 0, next = 0, phase = 0, a = 0, b = 0;
    let talking = r() < 0.6, turn = sr * (1 + r() * 4);
    for (let i = 0; i < n; i++) {
      if (--turn <= 0) { talking = !talking; turn = sr * (talking ? 1.5 + r() * 5 : 0.8 + r() * 3.5); }
      if (--next <= 0) {
        // a syllable: new vowel formants, a short gap now and then
        next = sr * (0.12 + r() * 0.16);
        target = talking && r() > 0.12 ? 0.6 + r() * 0.4 : 0;
        a = 300 + r() * 550; b = 950 + r() * 1500;
        f1.tune(a, 6); f2.tune(b, 8);
      }
      env += (target - env) * 0.0016;
      phase += (pitch * (1 + 0.03 * Math.sin(i / sr * 5.1 + t))) / sr;
      const glottal = (phase % 1) < 0.08 ? 1 : 0;                 // buzzy source for vowels
      const breath = (r() - 0.5) * 0.35;                           // noise for consonants and breath
      const src = glottal * 0.9 + breath;
      const y = (f1.step(src) * 1.2 + f2.step(src) * 0.8) * env * level;
      L[i] += y * (1 - pan) * 0.25; R[i] += y * (1 + pan) * 0.25;
    }
  }
  // room: a touch of smearing, then normalize
  let peak = 1e-6;
  for (const d of [L, R]) {
    let z = 0;
    for (let i = 0; i < n; i++) { z = z * 0.6 + d[i] * 0.4; d[i] = z; peak = Math.max(peak, Math.abs(z)); }
  }
  for (const d of [L, R]) for (let i = 0; i < n; i++) d[i] *= 0.7 / peak;
  seamless(buf);
  return buf;
}

/** A cup or glass set down: a few inharmonic partials with a fast decay. */
export function clink(ctx: Ctx, seed = 3) {
  const sr = ctx.sampleRate, n = Math.round(sr * 0.5), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0), r = rng(seed);
  const partials = [[2650, 1, 0.09], [4120, 0.6, 0.07], [5480, 0.45, 0.05], [7710, 0.25, 0.035], [1180, 0.3, 0.05]];
  for (const [f, a, tau] of partials) {
    const ff = f * (0.95 + r() * 0.1), ph = r() * 6;
    for (let i = 0; i < n; i++) { const t = i / sr; d[i] += a * Math.exp(-t / tau) * Math.sin(2 * Math.PI * ff * t + ph); }
  }
  for (let i = 0; i < Math.min(n, 60); i++) d[i] += (r() - 0.5) * (1 - i / 60) * 0.8; // the tap itself
  normalize(d, 0.8);
  return buf;
}

/** Espresso machine: the steam wand frothing milk (bright hiss with a gurgle). */
export function steam(ctx: Ctx, seconds = 3.6, seed = 9) {
  const sr = ctx.sampleRate, n = Math.round(sr * seconds), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0), r = rng(seed);
  const hiss = new Resonator(sr), gurgle = new Resonator(sr);
  hiss.tune(4200, 1.2); gurgle.tune(420, 3);
  for (let i = 0; i < n; i++) {
    const t = i / sr, env = Math.min(1, t / 0.15) * Math.min(1, (seconds - t) / 0.4);
    const w = r() - 0.5;
    const bubble = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * (9 + 4 * Math.sin(t * 1.7)));
    d[i] = (hiss.step(w) * 1.0 + gurgle.step(w) * 0.6 * bubble * Math.min(1, t / 1.2)) * env;
  }
  normalize(d, 0.7);
  return buf;
}

/** The burr grinder before an espresso: a rough whirr. */
export function grinder(ctx: Ctx, seconds = 2.2, seed = 13) {
  const sr = ctx.sampleRate, n = Math.round(sr * seconds), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0), r = rng(seed);
  const body = new Resonator(sr), grit = new Resonator(sr);
  body.tune(310, 4); grit.tune(2400, 2);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, env = Math.min(1, t / 0.08) * Math.min(1, (seconds - t) / 0.12);
    phase += 118 / sr;
    const motor = Math.sin(2 * Math.PI * phase) * 0.3 + Math.sin(4 * Math.PI * phase) * 0.15;
    const w = r() - 0.5, crunch = r() < 0.004 ? (r() - 0.5) * 3 : 0;
    d[i] = (motor + body.step(w) * 1.2 + grit.step(w + crunch) * 0.5) * env;
  }
  normalize(d, 0.6);
  return buf;
}

/** The register's two short beeps when an order is rung up. */
export function registerBeep(ctx: Ctx) {
  const sr = ctx.sampleRate, n = Math.round(sr * 0.32), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / sr, on = (t < 0.09) || (t > 0.16 && t < 0.25);
    d[i] = on ? Math.sin(2 * Math.PI * 2350 * t) * 0.4 * Math.min(1, (t % 0.16) / 0.004) : 0;
  }
  return buf;
}

/** A plastic ski boot set down on a wooden floor or deck: a hollow thump and a heel click. */
export function bootOnWood(ctx: Ctx, seed = 21) {
  const sr = ctx.sampleRate, n = Math.round(sr * 0.32), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0), r = rng(seed);
  const board = new Resonator(sr), shell = new Resonator(sr);
  board.tune(140 + r() * 40, 5); shell.tune(1900 + r() * 500, 4);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const impact = i < sr * 0.004 ? (r() - 0.5) * 2 : 0;
    const heel = Math.abs(t - 0.035) < 0.003 ? (r() - 0.5) * 1.2 : 0;
    d[i] = board.step(impact * 3) * 2.2 * Math.exp(-t / 0.07) + shell.step(impact + heel) * 0.8 * Math.exp(-t / 0.03);
  }
  normalize(d, 0.85);
  return buf;
}

/** Bare aspen branches knocking together in the wind. */
export function branchKnock(ctx: Ctx, seed = 31) {
  const sr = ctx.sampleRate, n = Math.round(sr * 0.25), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0), r = rng(seed);
  const wood = new Resonator(sr), wood2 = new Resonator(sr);
  wood.tune(780 + r() * 300, 12); wood2.tune(1650 + r() * 400, 10);
  for (let i = 0; i < n; i++) {
    const t = i / sr, x = i < 40 ? (r() - 0.5) * 2 : 0, x2 = Math.abs(t - 0.05) < 0.0015 ? (r() - 0.5) : 0;
    d[i] = wood.step(x + x2) * Math.exp(-t / 0.04) + wood2.step(x) * 0.5 * Math.exp(-t / 0.02);
  }
  normalize(d, 0.7);
  return buf;
}

/** Room tone: ventilation and a refrigerated case, low and steady. */
export function roomTone(ctx: Ctx, seconds = 9, seed = 41) {
  const sr = ctx.sampleRate, n = Math.round(sr * seconds), buf = ctx.createBuffer(2, n, sr), r = rng(seed);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = 0.992 * last + 0.008 * (r() - 0.5);
      d[i] = last * 6 + Math.sin(2 * Math.PI * 60 * i / sr) * 0.012 + Math.sin(2 * Math.PI * 120 * i / sr) * 0.008;
    }
  }
  seamless(buf);
  return buf;
}

function normalize(d: Float32Array, to: number) {
  let peak = 1e-6; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < d.length; i++) d[i] *= to / peak;
}

/** Crossfade the loop seam so looping layers do not click. */
function seamless(buf: AudioBuffer) {
  const n = Math.round(buf.sampleRate * 0.25);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c), L = d.length;
    for (let i = 0; i < n; i++) { const k = i / n; d[L - n + i] = d[L - n + i] * (1 - k) + d[i] * k; }
  }
}
