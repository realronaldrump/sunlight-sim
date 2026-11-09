export interface TerrainDetailRegion {
  name: string;
  /** Local east/north bounds, in meters: [x0, x1, n0, n1]. */
  extent: [number, number, number, number];
  /** Coarsest permitted level inside this landmark; L2 = 4 m. */
  maxLevel: number;
}

/** Keep measured landmark geometry even when normal distance LOD would erase it. */
export function needsLandmarkDetail(
  regions: readonly TerrainDetailRegion[], level: number, x: number, n: number, size: number,
): boolean {
  return regions.some(({ extent: [x0, x1, n0, n1], maxLevel }) =>
    level > maxLevel && x < x1 && x + size > x0 && n < n1 && n + size > n0);
}
