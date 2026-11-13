import type { ColliderGrid } from './collision';

/** The owner circled this site on the north-up lodge view. Its center was projected
 * back onto the measured snow. Dimensions remain estimates from IMG_2598.JPG. */
export const BASE_TRAIL_MAP = { x: 76.6, z: -967.7, yaw: .45, width: 3.5, height: 4.2 };

/** Players and the solo/room NPC navigation use the same physical obstacle. */
export function addBaseTrailMapCollider(grid: ColliderGrid, height: (x: number, z: number) => number) {
  const { x, z, yaw } = BASE_TRAIL_MAP, ground = height(x, z);
  grid.add({ type: 'box', x, z, hx: 1.83, hz: .23, yaw, bottom: ground - .4, top: ground + 4.23 });
}
