import type { Point } from './mountainGuestNavigation';
import type { Vec3 } from './skiPhysics';

export const SANTA_STAR_LIFE = 60;
export const SANTA_STAR_RELEASE = .62;
export const SANTA_HANG_TIME = 2.45;
export const SANTA_TIP_TIME = 1.6;

export interface SantaFirStop { at: Point; anchor: Vec3 }
export interface SantaActionPose {
  kind: 'hat-tip' | 'hang-star';
  progress: number;
  heading: number;
  anchor?: Vec3;
}
export interface SantaStarPose extends Vec3 { remaining: number }
export interface SantaFestivities {
  searchAt: number;
  greetAt: number;
  stop?: SantaFirStop & { from: Point; until: number; returning?: boolean };
  action?: Omit<SantaActionPose, 'progress'> & { startedAt: number };
  star?: Vec3 & { until: number };
}

export function newSantaFestivities(age: number, seed: number): SantaFestivities {
  return { searchAt: age + 85 + (seed >>> 0) % 71, greetAt: age };
}

export function santaActionDuration(kind: SantaActionPose['kind']) {
  return kind === 'hang-star' ? SANTA_HANG_TIME : SANTA_TIP_TIME;
}

/** A corrupt optional ornament must not discard the skier's older saved trip. */
export function readSantaFestivities(value: unknown, contains: (x: number, z: number) => boolean): SantaFestivities | undefined {
  if (!value || typeof value !== 'object') return;
  const f = value as SantaFestivities;
  if (!Number.isFinite(f.searchAt) || !Number.isFinite(f.greetAt)) return;
  const point = (p?: Point) => !!p && Number.isFinite(p.x) && Number.isFinite(p.z) && contains(p.x, p.z);
  const anchor = (p?: Vec3) => point(p) && Number.isFinite(p?.y) && p!.y > 2200 && p!.y < 3300;
  if (f.stop && (!point(f.stop.at) || !point(f.stop.from) || !anchor(f.stop.anchor) || !Number.isFinite(f.stop.until))) return;
  if (f.action && (!['hat-tip', 'hang-star'].includes(f.action.kind) ||
    !Number.isFinite(f.action.startedAt) || !Number.isFinite(f.action.heading) ||
    (f.action.kind === 'hang-star' && !anchor(f.action.anchor)))) return;
  if (f.star && (!anchor(f.star) || !Number.isFinite(f.star.until))) return;
  return f;
}
