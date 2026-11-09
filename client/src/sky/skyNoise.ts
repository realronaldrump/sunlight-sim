// Tileable noise for the cloud layers, built once at start-up (deterministic, no downloads).
// R: cumulus shapes, histogram-equalized so a threshold of (1 - cover) covers that share of the sky.
// G: billowy detail (inverted cellular noise). B: fibrous streaks for cirrus. A: regional cover.

function lcg(seed: number) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/** Gradient noise that repeats every `period` lattice cells (period <= 256). */
function tileablePerlin(seed: number) {
  const r = lcg(seed), perm = new Uint8Array(512), gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; const a = r() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, y: number, period: number) => {
    const xf = Math.floor(x), yf = Math.floor(y), fx = x - xf, fy = y - yf;
    const x0 = ((xf % period) + period) % period, y0 = ((yf % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const g = (ix: number, iy: number, dx: number, dy: number) => { const h = perm[perm[ix] + iy]; return gx[h] * dx + gy[h] * dy; };
    const u = fade(fx), v = fade(fy);
    const a = g(x0, y0, fx, fy), b = g(x1, y0, fx - 1, fy), c = g(x0, y1, fx, fy - 1), d = g(x1, y1, fx - 1, fy - 1);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v; // about -0.7 .. 0.7
  };
}

/** Distance to the nearest feature point, repeating every `period` cells: 0 at a point, about 1 between. */
function tileableWorley(seed: number, period: number) {
  const r = lcg(seed), px = new Float32Array(period * period), py = new Float32Array(period * period);
  for (let i = 0; i < px.length; i++) { px[i] = r(); py[i] = r(); }
  return (x: number, y: number) => {
    const xf = Math.floor(x), yf = Math.floor(y);
    let best = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = xf + i, cy = yf + j, k = (((cy % period) + period) % period) * period + (((cx % period) + period) % period);
      const dx = cx + px[k] - x, dy = cy + py[k] - y, d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
}

/** Map values to their rank so the result is uniformly distributed over 0..1. */
export function equalize(values: Float32Array) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < values.length; i++) { const v = values[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const BINS = 4096, hist = new Uint32Array(BINS), scale = (BINS - 1) / Math.max(1e-9, hi - lo);
  for (let i = 0; i < values.length; i++) hist[Math.floor((values[i] - lo) * scale)]++;
  const cdf = new Float32Array(BINS); let sum = 0;
  for (let b = 0; b < BINS; b++) { sum += hist[b]; cdf[b] = sum / values.length; }
  for (let i = 0; i < values.length; i++) values[i] = cdf[Math.floor((values[i] - lo) * scale)];
  return values;
}

/** RGBA8 cloud noise, `size` pixels square, seamless on both axes. */
export function makeCloudNoise(size = 512, seed = 20260109): Uint8Array {
  const n = size * size, out = new Uint8Array(n * 4);
  const shape = new Float32Array(n), region = new Float32Array(n), streak = new Float32Array(n), detail = new Float32Array(n);
  const p1 = tileablePerlin(seed), p2 = tileablePerlin(seed + 77), p3 = tileablePerlin(seed + 191), p4 = tileablePerlin(seed + 313);
  const w1 = tileableWorley(seed + 5, 7), w2 = tileableWorley(seed + 9, 19);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size, k = j * size + i;
    // cumulus: broad heaps with smaller lobes on their edges
    let s = 0, amp = 1, f = 4;
    for (let o = 0; o < 5; o++) { s += amp * p1(u * f, v * f, f); amp *= 0.5; f *= 2; }
    shape[k] = s;
    // regional cover: clear spells and cloudier patches tens of kilometres across
    region[k] = p2(u * 2, v * 2, 2) + 0.5 * p2(u * 4 + 3.7, v * 4 + 1.3, 4) + 0.25 * p2(u * 8 + 5.1, v * 8 + 9.2, 8);
    // cirrus: warped, ridged filaments
    const wx = p3(u * 4, v * 4, 4) * 0.35, wy = p3(u * 4 + 9.3, v * 4 + 2.1, 4) * 0.35;
    let c = 0; amp = 1; f = 4;
    for (let o = 0; o < 6; o++) { const q = 1 - Math.abs(p4((u + wx) * f, (v + wy) * f, f)) * 1.6; c += amp * q * q; amp *= 0.55; f *= 2; }
    streak[k] = c;
    // billows: rounded cells at two sizes
    detail[k] = 0.62 * (1 - Math.min(1, w1(u * 7, v * 7))) + 0.38 * (1 - Math.min(1, w2(u * 19, v * 19)));
  }
  equalize(shape); equalize(region); equalize(streak); equalize(detail);
  for (let k = 0; k < n; k++) {
    out[k * 4] = Math.round(shape[k] * 255); out[k * 4 + 1] = Math.round(detail[k] * 255);
    out[k * 4 + 2] = Math.round(streak[k] * 255); out[k * 4 + 3] = Math.round(region[k] * 255);
  }
  return out;
}
