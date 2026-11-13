import type { ColliderGrid } from './collision';

/** Owner photograph IMG_2598: the blue board above the two base lifts.
 * World placement and dimensions are photo-based estimates. */
export const BASE_TRAIL_MAP = { x: 48, z: -1005.5, yaw: .58, width: 3.5, height: 4.2 };

/** Players and the solo/room NPC navigation use the same physical obstacle. */
export function addBaseTrailMapCollider(grid: ColliderGrid, height: (x: number, z: number) => number) {
  const { x, z, yaw } = BASE_TRAIL_MAP, ground = height(x, z);
  grid.add({ type: 'box', x, z, hx: 1.83, hz: .23, yaw, bottom: ground - .4, top: ground + 4.23 });
}
