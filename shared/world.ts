// Shared world constants and coordinate helpers (client, server, tests).
// Game axes: +x east, +y up, +z south (z = -north). Local (x, n) = (E - ORIGIN_E, N - ORIGIN_N) in UTM 13N.

export const ORIGIN_E = 298500.5;
export const ORIGIN_N = 4362800.5;
export const LAT = 39.40; // approx resort latitude (deg)
export const LON = -107.34; // approx resort longitude (deg)
export const EARTH_R_EFF = 6371000 * 7 / 6; // refraction-corrected radius for curvature drop

export const toGame = (x: number, n: number) => ({ x, z: -n });
export const toLocal = (x: number, z: number) => ({ x, n: -z });

export const MS_TO_KMH = 3.6;
export const G = 9.81;
