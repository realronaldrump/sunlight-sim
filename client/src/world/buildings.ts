// Base-area buildings: Sunlight-specific models (main lodge, Brettelberg, base modular buildings) and
// lidar-measured generic buildings (houses.ts) from OSM footprints, plus small resort extras.
import * as THREE from 'three/webgpu';
import type { ColliderGrid } from '../../../shared/collision';
import { buildSunlightStructure, type BuildingDef } from './sunlightBuildings';
import { buildGenericBuilding, type MeasuredBuilding } from './houses';

export function buildBuildings(defs: BuildingDef[], height: (x: number, z: number) => number, colliders: ColliderGrid): THREE.Group {
  const group = new THREE.Group(); group.name = 'buildings';
  defs.forEach((b, idx) => {
    const specific = buildSunlightStructure(b, height, colliders);
    if (specific) { group.add(specific); return; }
    const g = buildGenericBuilding(b as MeasuredBuilding, height, colliders);
    if (g) group.add(g);
    void idx;
  });
  return group;
}
