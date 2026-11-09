import type { LiftPath } from '../../../shared/lifts';
import type { SkierState, SurfaceInfo } from '../../../shared/skiPhysics';
import { sourcePan, type AudioPoint, type AudioState } from './audioModel';

interface Ride { lift: number; chair: number }
export interface SkierSoundSource { pos: AudioPoint; speed: number; skid: number; groomed: number; active: boolean }

/** Derives events from continuous travel, suppressing teleports and skipped rides. */
export class AudioScene {
  private previous: { pos: AudioPoint; ride: string; h: number; grounded: boolean; mode: string; normalSpeed: number; airTime: number } | null = null;

  sample(dt: number, st: SkierState, ride: Ride | null, paths: LiftPath[], surf: SurfaceInfo,
    forward: AudioPoint, snowing: boolean, neighbors: SkierSoundSource[] = []): AudioState {
    const prev = this.previous;
    const key = ride ? `${ride.lift}:${ride.chair}` : '';
    const path = ride ? paths[ride.lift] : null;
    const h = path ? (st.pos.x-path.def.bottom[0])*path.ax + (st.pos.z-path.def.bottom[2])*path.az : -1;
    const moved = prev ? Math.hypot(st.pos.x-prev.pos.x, st.pos.y-prev.pos.y, st.pos.z-prev.pos.z) : 0;
    const discontinuity = !prev || moved > Math.max(8, Math.max(st.speed, path?.def.speed ?? 0)*Math.max(dt, .016)*3);
    const sameChair = !!key && key === prev?.ride;
    const towerPass = !discontinuity && sameChair && h > prev!.h && !!path?.def.supports.some(
      s => s.kind === 'tower' && prev!.h < s.s && h >= s.s);
    const listener = { x: st.pos.x, y: st.pos.y+1.6, z: st.pos.z };
    const terminals = paths.flatMap((p, li) => [p.def.bottom, p.def.top].map((point, end) => {
      const support = end ? p.def.supports.at(-1)! : p.def.supports[0];
      const source = { x: point[0], y: support.ground+3, z: point[2] };
      return { id: `${li}:${end}`, speed: p.def.speed, variant: li+end*.4,
        distance: Math.hypot(source.x-listener.x, source.y-listener.y, source.z-listener.z),
        pan: sourcePan(listener, forward, source) };
    }));
    const normalSpeed = st.vel.x*st.normal.x + st.vel.y*st.normal.y + st.vel.z*st.normal.z;
    const airTime = !st.grounded && !ride && !discontinuity ? (prev?.airTime ?? 0)+dt : 0;
    const landing = !discontinuity && !ride && !prev?.ride && st.grounded && prev && !prev.grounded && prev.airTime > .08
      ? Math.max(0, -prev.normalSpeed) : 0;
    const result: AudioState = {
      speed: st.speed, skid: st.skid, edge: st.edge, grounded: st.grounded,
      groomed: surf.groomed, moguls: surf.moguls, plow: st.plow, riding: !!ride,
      nearTerminal: Math.min(...terminals.map(t => t.distance)), towerPass,
      fell: !discontinuity && st.grounded && st.mode === 'fallen' && prev?.mode !== 'fallen',
      inAir: !st.grounded && !ride, tuck: st.tuck, fallen: st.mode === 'fallen',
      altitude: st.pos.y, snowing, impact: st.lastImpact, landing,
      boarded: !discontinuity && !!ride && !prev?.ride,
      unloaded: !discontinuity && !ride && !!prev?.ride && st.grounded,
      liftDrop: !discontinuity && !ride && !!prev?.ride && !st.grounded && st.mode === 'fallen',
      discontinuity, liftSpeed: path?.def.speed, terminals,
      skiers: neighbors.map(p => ({ speed: p.speed, skid: p.skid, groomed: p.groomed, active: p.active,
        distance: Math.hypot(p.pos.x-listener.x, p.pos.y-listener.y, p.pos.z-listener.z),
        pan: sourcePan(listener, forward, p.pos) })),
    };
    this.previous = { pos: { ...st.pos }, ride: key, h, grounded: st.grounded, mode: st.mode, normalSpeed, airTime };
    return result;
  }
}
