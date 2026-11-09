// Shared between the local simulation worker and the multiplayer server.
// Use a resident set of fine tiles so the route and physics never depend on a viewer's terrain LOD.
import { Heightfield, type Loader } from '../terrain/heightfield';
import { ColliderGrid } from '../../../shared/collision';
import { LiftPath, type LiftDef } from '../../../shared/lifts';
import { LiftStations } from '../../../shared/liftStations';
import { mogulOffset } from '../../../shared/moguls';
import { GuestNavigation, type GuestRun } from '../../../shared/mountainGuestNavigation';
import type { TerrainProbe } from '../../../shared/skiPhysics';
import { SurfaceMap } from '../../../shared/surface';
import { addTreeCollider, decodeTreeTile } from '../../../shared/treeData';

export interface GuestResort {
  boundary: number[][];
  runs: GuestRun[];
  lifts: LiftDef[];
  buildings: { id?: number; points: number[][]; roofTop?: number }[];
}

export async function loadGuestWorld(base: string, resort: GuestResort, loader: Loader) {
  const terrain = new Heightfield(base, loader);
  const [surface, treeIndex] = await Promise.all([
    SurfaceMap.load(base, loader),
    loader(`${base}/trees/index.json`).then(bytes => JSON.parse(new TextDecoder().decode(bytes)) as {
      tileSize: number; tiles: [number, number, number][];
    }),
    terrain.init(),
  ]);
  terrain.modifier = (x, n) => mogulOffset(x, n, surface.mogulsLocal(x, n));

  const x0 = Math.min(...resort.boundary.map(p => p[0])) - 28, x1 = Math.max(...resort.boundary.map(p => p[0])) + 28;
  const n0 = -Math.max(...resort.boundary.map(p => p[2])) - 28, n1 = -Math.min(...resort.boundary.map(p => p[2])) + 28;
  const inside = (tx: number, tn: number, size: number) =>
    tx * size <= x1 && (tx + 1) * size >= x0 && tn * size <= n1 && (tn + 1) * size >= n0;
  const colliders = new ColliderGrid();
  const jobs: (() => Promise<unknown>)[] = [];
  for (const [tx, tn] of terrain.tileRange(0)) if (inside(tx, tn, terrain.tileSize(0))) {
    jobs.push(async () => {
      if (!await terrain.ensureTile(0, tx, tn)) throw new Error('Could not load fine terrain for the mountain guest');
    });
  }
  for (const [tx, tn] of treeIndex.tiles) if (inside(tx, tn, treeIndex.tileSize)) {
    jobs.push(async () => {
      const { n, x, z, y, h, r, s, seed } = await decodeTreeTile(await loader(`${base}/trees/${tx}_${tn}.bin.gz`));
      for (let i = 0; i < n; i++) if (x[i] >= x0 && x[i] <= x1 && -z[i] >= n0 && -z[i] <= n1) {
        addTreeCollider(colliders, x[i], z[i], y[i], h[i], r[i], s[i], seed[i]);
      }
    });
  }
  // Keep the background loader bounded on phones and on slower connections.
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < jobs.length) await jobs[next++]();
  }));
  const lifts = resort.lifts.map(def => new LiftPath(def));
  const ground: TerrainProbe = {
    height: (x, z) => terrain.heightAt(x, z),
    normal: (x, z, out) => Object.assign(out, terrain.normalAt(x, z, 1)),
    surface: (x, z) => surface.at(x, z),
  };
  const probe = new LiftStations(lifts, ground);
  for (const b of resort.buildings) {
    // The winter scene omits the summer tent and models the Tercero vault
    // as part of the lift, with no above-ground building in the loading lane.
    if (b.id === 789088639 || b.id === 789106639) continue;
    const xs = b.points.map(p => p[0]), zs = b.points.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
    if (x < x0 || x > x1 || -z < n0 || -z > n1) continue;
    colliders.add({ type: 'box', x, z, hx: (maxX - minX) / 2 + 1, hz: (maxZ - minZ) / 2 + 1, top: b.roofTop ?? ground.height(x, z) + 10 });
  }
  for (const lift of lifts) for (const support of lift.def.supports) {
    const p = lift.ropePoint(support.s, 0);
    // The uphill rope is offset from the terminal mast by half the rope gauge.
    colliders.add({ type: 'cyl', x: p.x, z: p.z, r: support.kind === 'tower' ? .8 : 1.6, top: p.y + 1 });
  }
  const navigation = new GuestNavigation(resort.boundary, resort.runs, lifts, probe, colliders, (x, z) => surface.canopy(x, z));
  return { navigation, colliders };
}
