// Resort Day versus Free Explore. Free Explore keeps the time you choose and runs the lifts at any
// hour. Resort Day runs a compressed day on the shared resort clock, so everyone in a room shares the
// same hour: dawn grooming, lifts 9 AM to 4 PM, the patrol sweep at close, and evening grooming.
export type ClockMode = 'explore' | 'day';

export const HOURS = { first: 7, open: 9, lastChair: 16, sweepEnd: 16.6, last: 20.5 };
/** Real seconds per resort hour in Resort Day (six-minute hours: the lift day takes 42 minutes). */
export const SECONDS_PER_HOUR = 360;
const SPAN = (HOURS.last - HOURS.first) * SECONDS_PER_HOUR;
const MODE_KEY = 'sunlight.clockMode';

/** The shared Resort Day hour for a resort-clock time. */
export function resortDayHour(now: number) {
  const t = ((now % SPAN) + SPAN) % SPAN;
  return HOURS.first + t / SECONDS_PER_HOUR;
}

export function liftsOpen(mode: ClockMode, hour: number) {
  return mode === 'explore' || (hour >= HOURS.open && hour < HOURS.lastChair);
}

/** Runs are closed and roped after the sweep and before opening (shown in both modes). */
export function runsClosed(hour: number) { return hour >= HOURS.sweepEnd - 0.2 || hour < HOURS.open - 0.25; }

/** The patrol sweep window: from last chair until the last run is cleared. */
export function sweeping(hour: number) { return hour >= HOURS.lastChair - 0.05 && hour < HOURS.sweepEnd + 0.1; }

/** Guests on the mountain: a few early, busiest late morning and early afternoon, none after the sweep. */
export function crowdLevel(mode: ClockMode, hour: number) {
  if (mode === 'explore') return 1;
  if (hour < HOURS.open - 0.5 || hour >= HOURS.sweepEnd) return 0;
  if (hour < HOURS.open) return 0.3;
  if (hour >= HOURS.lastChair) return 0.4;
  return Math.min(1, 0.55 + 0.45 * Math.sin(Math.PI * (hour - HOURS.open) / (HOURS.lastChair - HOURS.open)));
}

export function savedClockMode(): ClockMode {
  try { return localStorage.getItem(MODE_KEY) === 'day' ? 'day' : 'explore'; } catch { return 'explore'; }
}
export function saveClockMode(mode: ClockMode) {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* storage blocked */ }
}
