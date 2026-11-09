// Today's resort conditions: a deterministic snow and grooming report for the date on the shared
// resort clock (Mountain Time), so everyone in a room reads the same board.
import type { RunInfo } from '../game';
import type { Conditions } from './conditionsBoard';
import { rng } from './guests';

/** Calendar date at Sunlight (America/Denver) for a resort-clock time in seconds. */
export function resortDate(now: number) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now * 1000));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

export function dayNumber(now: number) {
  const { y, m, d } = resortDate(now);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** Overnight snowfall in inches for a day number (about two storm days a week). */
export function overnightSnow(day: number) {
  const r = rng(day * 2654435 + 17);
  const a = r();
  return a < 0.62 ? 0 : a < 0.85 ? 1 + Math.floor(r() * 3) : 3 + Math.floor(r() * 7);
}

/** Groomers work the cat tracks and main blues every night and rotate through the rest. */
export function groomedRuns(runs: RunInfo[], day: number) {
  const always = ['Ute', 'Midway', 'Grizzly Road', 'Segundo Road', 'Loop', 'Sun King', 'Beaujolais'];
  const pool = [...new Set(runs.filter((r) => r.kind === 'line' && r.grooming === 'groomed' && ['green', 'blue', 'black'].includes(r.difficulty) && !always.includes(r.name)).map((r) => r.name))].sort();
  const r = rng(day * 7919 + 3);
  const extra = pool.filter(() => r() < 0.4).slice(0, 7);
  return [...always.filter((n) => runs.some((r) => r.name === n)), ...extra];
}

export function formatClock(hour: number) {
  const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function conditionsFor(o: { now: number; hour: number; snowing: boolean; runs: RunInfo[]; liftNames: string[]; lesson: string; fallenToday?: number }): Conditions {
  const day = dayNumber(o.now);
  const today = overnightSnow(day), yesterday = overnightSnow(day - 1);
  // a storm passing over the mountain adds to today's total while it snows
  const falling = o.fallenToday ?? 0;
  const { y, m } = resortDate(o.now);
  const seasonStart = Date.UTC(m >= 7 ? y : y - 1, 10, 20) / 86400000;
  let season = 0;
  for (let d = Math.max(seasonStart, day - 200); d <= day; d++) season += overnightSnow(d);
  season = Math.max(season, 24) + falling;
  const base = Math.round(28 + Math.min(40, season * 0.35));
  // January temperatures at the base: coldest at dawn, warmest early afternoon
  const t = Math.cos(((o.hour - 14.5) / 12) * Math.PI);
  const tempF = Math.round(17 + 10 * (t + 1) / 2 - (o.snowing ? 3 : 0));
  const weather = o.snowing ? 'Snowing' : o.hour < 7 || o.hour > 17.5 ? 'Clear' : today > 0 ? 'Clearing' : 'Sunny';
  const open = o.hour >= 9 && o.hour < 16;
  const lineRuns = new Set(o.runs.filter((r) => r.kind === 'line').map((r) => r.name));
  return {
    clock: formatClock(o.hour), weather, tempF,
    snow: { since4: Math.round(today + falling), day: Math.round(today + falling), twoDay: Math.round(today + yesterday + falling), season: Math.round(season) },
    baseIn: base,
    surface: today + falling >= 3 ? ['Powder', 'Packed powder'] : today > 0 ? ['Packed powder', 'Groomed'] : ['Groomed', 'Packed powder'],
    lifts: o.liftNames.map((name) => ({ name, open: true, status: open ? 'Open' : 'Free explore' })),
    trailsOpen: lineRuns.size, trailsTotal: lineRuns.size,
    groomed: groomedRuns(o.runs, day), groomedAt: 'overnight',
    lesson: o.lesson,
  };
}
