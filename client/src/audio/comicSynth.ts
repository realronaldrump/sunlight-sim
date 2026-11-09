// Synthesized one-shots for the missed-unload gag (original, CC0): a springy BOING when the skis clip the
// gate, a rising whoosh for the whirl, a deep snow thud for the landing, and the lift operator's whistle.
type Ctx = BaseAudioContext;
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const buffer = (ctx: Ctx, seconds: number) => ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);

export function boing(ctx: Ctx) {
  const b = buffer(ctx, 0.9), d = b.getChannelData(0), sr = ctx.sampleRate; let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr, f = 190 + 260 * Math.exp(-t * 9) + 28 * Math.sin(t * 2 * Math.PI * 17) * Math.exp(-t * 2);
    ph += f / sr;
    d[i] = (Math.sin(2 * Math.PI * ph) * 0.8 + Math.sin(4 * Math.PI * ph) * 0.2) * Math.exp(-t * 4.2) * Math.min(1, t / 0.004);
  }
  return b;
}

export function whoosh(ctx: Ctx, seconds = 2.4) {
  const b = buffer(ctx, seconds), d = b.getChannelData(0), sr = ctx.sampleRate, r = rng(5);
  let y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr, k = t / seconds;
    // a band-pass whose centre sweeps up and down with the turns of the chair
    const f = 380 + 1500 * (0.5 + 0.5 * Math.sin(k * Math.PI * 4 - Math.PI / 2)) * (0.4 + k), w = 2 * Math.PI * f / sr, q = 3, rr = Math.exp(-w / (2 * q));
    const y = (1 - rr * rr) * 0.5 * (r() - 0.5) + 2 * rr * Math.cos(w) * y1 - rr * rr * y2; y2 = y1; y1 = y;
    d[i] = y * 9 * Math.sin(Math.PI * Math.min(1, k * 1.05));
  }
  return b;
}

export function thud(ctx: Ctx) {
  const b = buffer(ctx, 0.7), d = b.getChannelData(0), sr = ctx.sampleRate, r = rng(9); let lp = 0, ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr; ph += (62 + 40 * Math.exp(-t * 20)) / sr;
    lp += (r() - 0.5 - lp) * 0.08;
    d[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7) * 0.9 + lp * 3.5 * Math.exp(-t * 5);
  }
  return b;
}

export function whistle(ctx: Ctx) {
  const b = buffer(ctx, 0.75), d = b.getChannelData(0), sr = ctx.sampleRate; let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr, on = t < 0.22 || (t > 0.32 && t < 0.7);
    ph += (2650 + 160 * Math.sin(t * 2 * Math.PI * 38)) / sr;
    d[i] = on ? Math.sin(2 * Math.PI * ph) * 0.35 * Math.min(1, (t < 0.22 ? t : t - 0.32) / 0.01) : 0;
  }
  return b;
}

export const COMIC = { boing, whoosh, thud, whistle };
export type ComicSound = keyof typeof COMIC;
