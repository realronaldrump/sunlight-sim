// Fair-weather cloud on the shared resort clock: how much cumulus and cirrus there is and where the
// wind has carried it. A pure function of time, so friends in a room see the same clouds and the same
// cloud shadows crossing the same runs.
export type SkyMode = 'changing' | 'clear' | 'snow';

/** Cumulus base (m above sea level): about 1,300 m over Primo's summit. */
export const CUMULUS_BASE = 4300;
export const CIRRUS_ALT = 9500;
/** Size of one repeat of the cumulus noise on the ground (m). */
export const CUMULUS_TILE = 14000;
export const CIRRUS_TILE = 46000;
/** Cumulus drift: toward the east-northeast (bearing 60 degrees) like the squalls, about 20 mph. */
export const CUMULUS_WIND = { x: Math.sin(1.05) * 9, z: -Math.cos(1.05) * 9 };
/** Cirrus rides the faster westerlies aloft. */
export const CIRRUS_WIND = { x: 24, z: -5 };

export interface CloudState {
  /** Share of the sky under cumulus, 0..1. */
  cover: number;
  /** Amount of high cirrus, 0..1. */
  cirrus: number;
  /** Texture offsets (in repeats, 0..1) for the shape, regional, detail and the two cirrus samples. */
  shape: [number, number]; region: [number, number]; detail: [number, number]; high: [number, number]; high2: [number, number];
}

const fract = (v: number) => v - Math.floor(v);
function hash(i: number, salt: number) { const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return s - Math.floor(s); }
/** Smooth 1D value noise, 0..1. */
function vnoise(t: number, salt: number) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return hash(i, salt) * (1 - u) + hash(i + 1, salt) * u;
}

export const REGION_SCALE = 0.21, DETAIL_SCALE = 4.1, HIGH2_SCALE = 2.7;

export function cloudStateAt(now: number, mode: SkyMode): CloudState {
  // slow swings: a spell lasts twenty minutes or so
  const a = vnoise(now / 1300, 1), b = vnoise(now / 520, 2), c = vnoise(now / 1900, 3);
  const swing = 0.7 * a + 0.3 * b;
  const cover = mode === 'snow' ? 0.92 : mode === 'clear' ? 0.07 + 0.17 * swing : 0.1 + 0.5 * swing * swing + 0.08 * b;
  const cirrus = mode === 'snow' ? 0 : mode === 'clear' ? 0.12 + 0.4 * c : 0.2 + 0.55 * c;
  const off = (wx: number, wz: number, scale: number, tile: number): [number, number] => [fract(wx * now * scale / tile), fract(wz * now * scale / tile)];
  return {
    cover, cirrus,
    shape: off(CUMULUS_WIND.x, CUMULUS_WIND.z, 1, CUMULUS_TILE),
    region: off(CUMULUS_WIND.x, CUMULUS_WIND.z, REGION_SCALE, CUMULUS_TILE),
    // the billows drift a little across the heaps, so a cloud changes shape as it travels
    detail: off(CUMULUS_WIND.x + 0.5, CUMULUS_WIND.z + 0.7, DETAIL_SCALE, CUMULUS_TILE),
    high: off(CIRRUS_WIND.x, CIRRUS_WIND.z, 1, CIRRUS_TILE),
    high2: off(CIRRUS_WIND.x * 1.12, CIRRUS_WIND.z * 1.12, HIGH2_SCALE, CIRRUS_TILE),
  };
}

const rad = Math.PI / 180;
/** Relative optical air mass (Kasten and Young 1989), valid to just below the horizon. */
export function airMass(elevationDeg: number) {
  const e = Math.max(elevationDeg, -1.6);
  return 1 / (Math.sin(e * rad) + 0.50572 * Math.pow(e + 6.07995, -1.6364));
}

/** Vertical optical depth for red, green and blue at Sunlight's altitude (about 72% of the sea-level air). */
const TAU = [0.060 * 0.72, 0.105 * 0.72, 0.21 * 0.72];
const REF = [0, 1, 2].map((i) => Math.exp(-TAU[i] * airMass(26.8)));

/** Direct sunlight colour and strength relative to the default 11 AM January sun (which is 1, 1, 1). */
export function sunTransmission(elevationDeg: number): [number, number, number] {
  const m = airMass(elevationDeg);
  return [0, 1, 2].map((i) => Math.exp(-TAU[i] * m) / REF[i]) as [number, number, number];
}
