// Player-facing measurements always use U.S. units. Simulation inputs are SI.
import type { RunInfo } from '../game';

const METERS_PER_FOOT = 0.3048;
const METERS_PER_MILE = 1609.344;
const wholeNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatSpeedMph(metersPerSecond: number): string {
  return wholeNumber.format(metersPerSecond * 3600 / METERS_PER_MILE);
}

export function formatFeet(meters: number): string {
  return `${wholeNumber.format(meters / METERS_PER_FOOT)} ft`;
}

export function formatDistance(meters: number): string {
  return meters < METERS_PER_MILE
    ? formatFeet(meters)
    : `${(meters / METERS_PER_MILE).toFixed(1)} mi`;
}

export function formatRunPitch(run: RunInfo): string {
  if (!run.stats) return '';
  const { avgDeg, maxDeg } = run.stats;
  return run.kind === 'line'
    ? `Trail pitch ${avgDeg}° avg · ${maxDeg}° steepest 33 ft`
    : `Terrain ${avgDeg}° avg · ${maxDeg}° at 98th percentile`;
}
