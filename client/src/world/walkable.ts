// Shared registry of built walkable surfaces, interior volumes and terrain cut-outs. Buildings register
// into it while they are constructed; the on-foot walker, NPCs, camera and terrain material read it.
import { WalkSurfaces } from '../../../shared/walk';

/** Terrain fragments inside this oriented rectangle and below `y` are hidden (snow cannot show through floors). */
export interface TerrainCutout { cx: number; cz: number; yaw: number; hx: number; hz: number; y: number }

/** A point of interest for pedestrians (doors, tables, counters, racks). */
export interface Poi { kind: 'door' | 'seat' | 'counter' | 'rack' | 'stand' | 'lift' | 'parking'; x: number; y: number; z: number; heading: number; indoor: string | null; tag?: string }

export const walkable = {
  surfaces: new WalkSurfaces(),
  cutouts: [] as TerrainCutout[],
  pois: [] as Poi[],
};
