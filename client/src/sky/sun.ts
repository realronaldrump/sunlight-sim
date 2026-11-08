// Solar position (NOAA simplified algorithm). Returns elevation/azimuth in degrees and a game-space
// direction vector pointing toward the sun (+x east, +y up, +z south).
export interface SunPosition { elevation: number; azimuth: number; dir: { x: number; y: number; z: number } }

const rad = Math.PI / 180;

export function sunPosition(date: Date, latDeg: number, lonDeg: number): SunPosition {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad)) / rad;
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqTime = 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) +
    4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) -
    1.25 * e * e * Math.sin(2 * M * rad));
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const tst = (utcMin + eqTime + 4 * lonDeg + 1440) % 1440;
  let ha = tst / 4 - 180;
  if (ha < -180) ha += 360;
  const cosZ = Math.sin(latDeg * rad) * Math.sin(decl * rad) + Math.cos(latDeg * rad) * Math.cos(decl * rad) * Math.cos(ha * rad);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZ))) / rad;
  const elevation = 90 - zen;
  const az = Math.atan2(Math.sin(ha * rad), Math.cos(ha * rad) * Math.sin(latDeg * rad) - Math.tan(decl * rad) * Math.cos(latDeg * rad)) / rad + 180;
  const azimuth = (az + 360) % 360; // degrees clockwise from north
  const el = elevation * rad, a = azimuth * rad;
  return {
    elevation, azimuth,
    dir: { x: Math.cos(el) * Math.sin(a), y: Math.sin(el), z: -Math.cos(el) * Math.cos(a) },
  };
}

/** Date for a local Mountain Standard Time (UTC-7) hour on a January day. */
export function januaryMST(hour: number, day = 15, year = 2026): Date {
  const h = Math.floor(hour), m = Math.round((hour - h) * 60);
  return new Date(Date.UTC(year, 0, day, h + 7, m));
}
