import type { Point } from './mountainGuestNavigation';
import type { Vec3 } from './skiPhysics';
import type { FirInstance } from './treeData';

export const SANTA_STAR_LIFE = 25 * 60;
export const SANTA_TRACK_LIFE = 15 * 60;
export const SANTA_FIR_LIMIT = 12;
export const SANTA_TRACK_LIMIT = 3200;
export const SANTA_TRACK_STEP = 2.6;
export const SANTA_WAVE_RANGE = 14;
export const SANTA_STAR_RELEASE = .62;
export const SANTA_HANG_TIME = 2.45;
export const SANTA_TIP_TIME = 1.6;

export interface SantaFirStop { at: Point; anchor: Vec3; tree?: FirInstance }
export interface SantaVisitor extends Vec3 { waving?: boolean }
export interface SantaActionPose {
  kind: 'hat-tip' | 'hang-star';
  progress: number;
  heading: number;
  anchor?: Vec3;
}
export interface SantaStarPose extends Vec3 { remaining: number }
export interface SantaLitFir { anchor: Vec3; tree?: FirInstance; litAt: number }
/** A ground position at guest time. A negative edge begins a new trail after a gap. */
export type SantaTrack = [at: number, x: number, z: number, edge: number];
export interface SantaTraces { firs?: SantaLitFir[]; tracks: SantaTrack[] }
export interface SantaFestivities {
  searchAt: number;
  greetAt: number;
  waveAt?: number;
  stop?: SantaFirStop & { from: Point; until: number; returning?: boolean };
  action?: Omit<SantaActionPose, 'progress'> & { startedAt: number };
  firs?: SantaLitFir[];
  tracks?: SantaTrack[];
}

export function newSantaFestivities(age: number, seed: number): SantaFestivities {
  return { searchAt: age + 10 + (seed >>> 0) % 17, greetAt: age };
}

export function santaActionDuration(kind: SantaActionPose['kind']) {
  return kind === 'hang-star' ? SANTA_HANG_TIME : SANTA_TIP_TIME;
}

/** History is optional in old saves. Drop invalid traces without discarding the trip. */
export function readSantaFestivities(value: unknown, age: number, contains: (x: number, z: number) => boolean): SantaFestivities | undefined {
  if (!value || typeof value !== 'object') return;
  const f = value as SantaFestivities & { star?: Vec3 & { until: number } };
  if (!Number.isFinite(f.searchAt) || !Number.isFinite(f.greetAt)) return;
  const point = (p?: Point) => !!p && Number.isFinite(p.x) && Number.isFinite(p.z) && contains(p.x, p.z);
  const anchor = (p?: Vec3) => !!p && point(p) && Number.isFinite(p.y) && p.y > 2200 && p.y < 3300;
  const treeAt = (tree: FirInstance | undefined, hook: Vec3) => tree && anchor(tree) &&
    tree.height > 3 && tree.height <= 16 && tree.radius >= .6 && tree.radius < 13 &&
    (tree.kind === 0 || tree.kind === 1) && Number.isInteger(tree.seed) && tree.seed >= 0 && tree.seed <= 255 &&
    Math.hypot(tree.x - hook.x, tree.z - hook.z) <= tree.radius + .1 ? tree : undefined;
  const stop = f.stop && point(f.stop.at) && point(f.stop.from) && anchor(f.stop.anchor) && Number.isFinite(f.stop.until)
    ? { ...f.stop, tree: treeAt(f.stop.tree, f.stop.anchor) } : undefined;
  const action = f.action && (f.action.kind === 'hat-tip' || f.action.kind === 'hang-star') &&
    Number.isFinite(f.action.startedAt) && Number.isFinite(f.action.heading) &&
    (f.action.kind === 'hat-tip' || anchor(f.action.anchor)) ? f.action : undefined;
  const firs = Array.isArray(f.firs) ? f.firs.slice(-SANTA_FIR_LIMIT)
    .filter(fir => fir && anchor(fir.anchor) && Number.isFinite(fir.litAt) && fir.litAt <= age && age - fir.litAt < SANTA_STAR_LIFE)
    .map(fir => ({ anchor: fir.anchor, tree: treeAt(fir.tree, fir.anchor), litAt: fir.litAt }))
    .sort((a, b) => a.litAt - b.litAt) : [];
  // Preserve a star already hanging in an older room. Its checkpoint did not identify the tree.
  if (!firs.length && f.star && anchor(f.star) && Number.isFinite(f.star.until) && f.star.until > age) {
    const { x, y, z, until } = f.star;
    firs.push({ anchor: { x, y, z }, tree: undefined, litAt: Math.min(age, until - 60) });
  }
  const tracks: SantaTrack[] = [];
  for (const mark of Array.isArray(f.tracks) ? f.tracks.slice(-SANTA_TRACK_LIMIT) : []) {
    if (!Array.isArray(mark) || mark.length !== 4) continue;
    const [at, x, z, edge] = mark;
    if (!mark.every(Number.isFinite) || at <= (tracks.at(-1)?.[0] ?? age - SANTA_TRACK_LIFE) || at > age + .01 ||
      edge < -1 || edge > 1 || !contains(x, z)) continue;
    tracks.push(mark);
  }
  return { searchAt: f.searchAt, greetAt: f.greetAt, waveAt: Number.isFinite(f.waveAt) ? f.waveAt : undefined, stop, action, firs, tracks };
}
