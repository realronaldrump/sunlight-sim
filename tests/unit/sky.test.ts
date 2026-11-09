// Clouds on the shared clock, sunlight through the air, the cloud noise and the mountains' own shadows.
import { describe, it, expect } from 'vitest';
import { cloudStateAt, sunTransmission, airMass, CUMULUS_WIND, CUMULUS_TILE } from '../../client/src/sky/cloudWeather';
import { makeCloudNoise } from '../../client/src/sky/skyNoise';
import { horizonTangents, CELL, NEAR } from '../../client/src/sky/mountainShadow';

describe('fair-weather cloud on the shared clock', () => {
  it('is the same for everyone at the same moment', () => {
    expect(cloudStateAt(1_700_000_123.5, 'changing')).toEqual(cloudStateAt(1_700_000_123.5, 'changing'));
  });

  it('keeps clear days mostly blue, changing days cloudier, and a snow day overcast', () => {
    let clearMax = 0, changingMax = 0, changingMin = 1;
    for (let t = 0; t < 86400; t += 97) {
      const c = cloudStateAt(1_700_000_000 + t, 'clear'), v = cloudStateAt(1_700_000_000 + t, 'changing');
      clearMax = Math.max(clearMax, c.cover); changingMax = Math.max(changingMax, v.cover); changingMin = Math.min(changingMin, v.cover);
      expect(c.cover).toBeGreaterThan(0.04); expect(c.cirrus).toBeGreaterThanOrEqual(0); expect(c.cirrus).toBeLessThanOrEqual(1);
      for (const o of [c.shape, c.region, c.detail, c.high, c.high2]) for (const k of o) { expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThan(1); }
    }
    expect(clearMax).toBeLessThan(0.26);
    expect(changingMax).toBeGreaterThan(0.45);
    expect(changingMin).toBeLessThan(0.2);
    expect(cloudStateAt(1_700_000_000, 'snow').cover).toBeGreaterThan(0.85);
  });

  it('drifts east-northeast at about 20 mph', () => {
    const a = cloudStateAt(5000, 'clear'), b = cloudStateAt(5010, 'clear');
    const wrap = (d: number) => d - Math.round(d);
    const dx = wrap(b.shape[0] - a.shape[0]) * CUMULUS_TILE, dz = wrap(b.shape[1] - a.shape[1]) * CUMULUS_TILE;
    expect(dx / 10).toBeCloseTo(CUMULUS_WIND.x, 3); expect(dz / 10).toBeCloseTo(CUMULUS_WIND.z, 3);
    expect(dx).toBeGreaterThan(0);               // east
    expect(dz).toBeLessThan(0);                  // north
    expect(Math.hypot(dx, dz) / 10).toBeCloseTo(9, 1);
  });
});

describe('sunlight through the air', () => {
  it('is neutral at the default 11 AM sun and reddens and dims as the sun sinks', () => {
    const noon = sunTransmission(26.8);
    for (const c of noon) expect(c).toBeCloseTo(1, 5);
    let last = sunTransmission(30);
    for (const el of [20, 12, 8, 5, 2, 0, -1]) {
      const c = sunTransmission(el);
      expect(c[0]).toBeGreaterThan(c[1]); expect(c[1]).toBeGreaterThan(c[2]);
      for (let i = 0; i < 3; i++) expect(c[i]).toBeLessThan(last[i]);
      last = c;
    }
    // golden hour keeps roughly half the light; the last light on the peaks is deep red
    expect(sunTransmission(5)[0]).toBeGreaterThan(0.55);
    expect(sunTransmission(5)[2]).toBeLessThan(0.4);
    expect(sunTransmission(0)[2]).toBeLessThan(0.02);
  });

  it('matches the standard air mass at the zenith and near the horizon', () => {
    expect(airMass(90)).toBeCloseTo(1, 2);
    expect(airMass(30)).toBeCloseTo(2, 1);
    expect(airMass(0)).toBeGreaterThan(30); expect(airMass(0)).toBeLessThan(40);
  });
});

describe('cloud noise', () => {
  const N = 96, px = makeCloudNoise(N, 7);
  it('is deterministic', () => { expect(Array.from(makeCloudNoise(32, 7))).toEqual(Array.from(makeCloudNoise(32, 7))); });

  it('covers the share of sky its threshold asks for', () => {
    for (const ch of [0, 1, 2, 3]) {
      let over = 0, sum = 0;
      for (let k = 0; k < N * N; k++) { const v = px[k * 4 + ch] / 255; sum += v; if (v > 0.8) over++; }
      expect(sum / (N * N)).toBeCloseTo(0.5, 1);
      expect(over / (N * N)).toBeCloseTo(0.2, 1);
    }
  });

  it('repeats without a seam', () => {
    // the step across the wrap is no bigger than the steps inside the texture
    let inside = 0, seam = 0;
    for (let j = 0; j < N; j++) {
      seam += Math.abs(px[(j * N) * 4] - px[(j * N + N - 1) * 4]) + Math.abs(px[j * 4] - px[((N - 1) * N + j) * 4]);
      inside += Math.abs(px[(j * N + 40) * 4] - px[(j * N + 41) * 4]) + Math.abs(px[(40 * N + j) * 4] - px[(41 * N + j) * 4]);
    }
    expect(seam).toBeLessThan(inside * 1.6);
  });
});

describe('mountain shadows', () => {
  // flat ground at 2,500 m with a 600 m ridge running north to south, 5 km east of the map centre
  const n = 400, data = new Float32Array(n * n).fill(2500);
  const ridgeI = 200 + Math.round(5000 / CELL);
  for (let j = 0; j < n; j++) for (let i = ridgeI; i < ridgeI + 3; i++) data[j * n + i] = 3100;
  const grid = { data, n, x0: -200 * CELL, z0: -200 * CELL };
  const map = { n: 5, x0: -2.5 * CELL, z0: -2.5 * CELL, cell: CELL };
  const out = new Float32Array(25);

  it('finds the ridge on the horizon when looking toward it', () => {
    horizonTangents(grid, map, 1, 0, out);
    const tan = out[12];
    // 600 m of ridge less the viewer's lift and the earth's curve, 5 km away: about 6.6 degrees
    expect(tan).toBeGreaterThan(0.105); expect(tan).toBeLessThan(0.12);
    // a low sun in that direction is hidden, a higher one is not
    expect(Math.tan(4 * Math.PI / 180)).toBeLessThan(tan);
    expect(Math.tan(9 * Math.PI / 180)).toBeGreaterThan(tan);
  });

  it('sees an open horizon the other way', () => {
    horizonTangents(grid, map, -1, 0, out);
    expect(out[12]).toBeLessThan(0);
  });

  it('leaves nearby ground to the shadow maps', () => {
    // a wall closer than NEAR does not count
    const near = new Float32Array(n * n).fill(2500);
    for (let j = 0; j < n; j++) near[j * n + 200 + Math.floor((NEAR - 2 * CELL) / CELL)] = 2900;
    horizonTangents({ ...grid, data: near }, map, 1, 0, out);
    expect(out[12]).toBeLessThan(0);
  });
});
