// A ray from above continuous terrain must hit it before reaching a point below it. Test
// whole chunk bounds against lower bounds on the *currently drawn* heightfield. Missing
// coverage, building cutouts and a camera below ground always leave the candidate visible.
import * as THREE from 'three/webgpu';
import { TerrainChunkMesh } from './terrainShadows';
import { EARTH_R_EFF } from '../../../shared/world';

const CELL = 32, SIDE = 64;
const HORIZONTAL = 4, VERTICAL = 1;
const DISTANCES = [48, 96, 192, 384, 640, 896];
export type CutoutTest = (x0: number, z0: number, x1: number, z1: number) => boolean;

export class TerrainOcclusion {
  private low = new Float32Array(SIDE * SIDE);
  private owners: (TerrainChunkMesh | null)[] = new Array(SIDE * SIDE).fill(null);
  private x0 = Infinity;
  private z0 = Infinity;
  private origin = new THREE.Vector3(Infinity, Infinity, Infinity);
  private complete = false;
  private above = false;

  constructor(private overlapsCutout: CutoutTest) {}

  update(view: THREE.Vector3, meshes: readonly THREE.Object3D[], changed: boolean) {
    const half = SIDE * CELL / 2;
    const refresh = changed || Math.abs(view.x - (this.x0 + half)) > 96 || Math.abs(view.z - (this.z0 + half)) > 96;
    if (refresh) {
      this.x0 = Math.floor(view.x / CELL) * CELL - half;
      this.z0 = Math.floor(view.z / CELL) * CELL - half;
      this.owners.fill(null);
      for (const obj of meshes) {
        const mesh = obj as TerrainChunkMesh, x = mesh.x, z = mesh.z, size = mesh.size;
        const left = Math.max(0, (x - this.x0) / CELL), right = Math.min(SIDE, (x + size - this.x0) / CELL);
        const bottom = Math.max(0, (z - size - this.z0) / CELL), top = Math.min(SIDE, (z - this.z0) / CELL);
        for (let j = bottom; j < top; j++) for (let i = left; i < right; i++) {
          const ox = this.x0 + (i + .5) * CELL - x, north = z - this.z0 - (j + .5) * CELL;
          this.low[j * SIDE + i] = mesh.minimumAt(ox, north);
          this.owners[j * SIDE + i] = mesh;
        }
      }
      this.complete = !this.owners.includes(null);
    }
    const here = this.owners[Math.floor((view.z - this.z0) / CELL) * SIDE + Math.floor((view.x - this.x0) / CELL)];
    const above = this.complete && !!here && view.y > here.heightAt(view.x, view.z) + .05;
    if (!refresh && above === this.above && Math.abs(view.x - this.origin.x) <= HORIZONTAL &&
      Math.abs(view.z - this.origin.z) <= HORIZONTAL && Math.abs(view.y - this.origin.y) <= VERTICAL) return;
    this.origin.copy(view); this.above = above;
    for (const obj of meshes) {
      const m = obj as TerrainChunkMesh;
      m.hiddenByTerrain = above && this.hides(m);
    }
  }

  private hides(mesh: TerrainChunkMesh) {
    const eye = this.origin, x = mesh.x, z = mesh.z, size = mesh.size;
    const distance = Math.max(x - eye.x, eye.x - x - size, z - size - eye.z, eye.z - z);
    if (distance < 64) return false;
    const high = mesh.geometry.boundingBox!.max.y;
    for (const d of DISTANCES) {
      if (d >= distance) break;
      const t = d / distance, pad = HORIZONTAL * (1 - t) + .1;
      const ax = eye.x + (x - eye.x) * t - pad, bx = eye.x + (x + size - eye.x) * t + pad;
      const az = eye.z + (z - size - eye.z) * t - pad, bz = eye.z + (z - eye.z) * t + pad;
      if (bx - ax > 160) break;
      const i0 = Math.floor((ax - this.x0) / CELL), i1 = Math.floor((bx - this.x0) / CELL);
      const j0 = Math.floor((az - this.z0) / CELL), j1 = Math.floor((bz - this.z0) / CELL);
      if (i0 < 0 || j0 < 0 || i1 >= SIDE || j1 >= SIDE) break;
      const y = (eye.y + VERTICAL) * (1 - t) + high * t;
      // Lowest possible rendered snow includes curvature and rounding at LOD seams.
      const curvature = (d + size * t + 2 * HORIZONTAL) ** 2 / EARTH_R_EFF;
      const limit = y + curvature + 1;
      let blocked = true;
      for (let j = j0; j <= j1 && blocked; j++) for (let i = i0; i <= i1; i++) {
        if (this.low[j * SIDE + i] <= limit) { blocked = false; break; }
      }
      if (blocked && !this.overlapsCutout(Math.min(ax, eye.x - HORIZONTAL), Math.min(az, eye.z - HORIZONTAL),
        Math.max(bx, eye.x + HORIZONTAL), Math.max(bz, eye.z + HORIZONTAL))) return true;
    }
    return false;
  }
}
