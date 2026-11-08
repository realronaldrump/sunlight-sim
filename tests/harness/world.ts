// Node-side world loader for tests and the physics harness (reads the same files the client serves).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Heightfield } from '../../client/src/terrain/heightfield';
import type { TerrainProbe, Vec3, SurfaceInfo } from '../../shared/skiPhysics';
import { SurfaceMap } from '../../shared/surface';

export const WORLD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/public/world');

export const fsLoader = async (p: string) => {
  const rel = p.replace(/^.*?world\//, '');
  const b = await readFile(path.join(WORLD_DIR, rel));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

export interface Resort {
  lifts: any[]; runs: { id: number; name: string; difficulty: string; grooming: string; kind: string; points: number[][] }[];
  buildings: any[]; roads: any[]; peaks: any[];
}

export async function loadWorld() {
  const hf = new Heightfield('/world', fsLoader);
  await hf.init();
  const resort: Resort = JSON.parse(await readFile(path.join(WORLD_DIR, 'resort.json'), 'utf8'));
  let surface: SurfaceMap | null = null;
  try {
    surface = await SurfaceMap.load('/world', fsLoader);
  } catch { surface = null; }
  return { hf, resort, surface };
}

export function makeProbe(hf: Heightfield, surface: SurfaceMap | null): TerrainProbe {
  return {
    height: (x, z) => hf.heightAt(x, z),
    normal: (x, z, out: Vec3) => { const n = hf.normalAt(x, z, 1); out.x = n.x; out.y = n.y; out.z = n.z; return out; },
    surface: (x, z): SurfaceInfo => surface ? surface.at(x, z) : { groomed: 1, piste: 1, moguls: 0 },
  };
}

export async function loadAreaForPath(hf: Heightfield, pts: number[][], margin = 60) {
  const xs = pts.map((p) => p[0]), ns = pts.map((p) => -p[2]);
  const x0 = Math.min(...xs) - margin, x1 = Math.max(...xs) + margin;
  const n0 = Math.min(...ns) - margin, n1 = Math.max(...ns) + margin;
  const S = 256;
  const jobs = [];
  for (let tn = Math.floor(n0 / S); tn <= Math.floor(n1 / S); tn++)
    for (let tx = Math.floor(x0 / S); tx <= Math.floor(x1 / S); tx++) jobs.push(hf.ensureTile(0, tx, tn));
  await Promise.all(jobs);
}
