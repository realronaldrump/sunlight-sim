// Pipeline output checks: official runs, lifts, trees, surface map and run lookup.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadWorld, WORLD_DIR } from '../harness/world';

let world: Awaited<ReturnType<typeof loadWorld>>;
beforeAll(async () => { world = await loadWorld(); });

const OFFICIAL_COUNT = 75; // names on the 2024-25 trail map + East Ridge map (incl. Sherick Park and Hike-Out)

describe('resort data', () => {
  it('contains every official run with an official difficulty', () => {
    const names = new Set(world.resort.runs.map((r) => r.name));
    expect(names.size).toBe(OFFICIAL_COUNT);
    for (const r of world.resort.runs) expect(['green', 'blue', 'black', 'double', 'park', 'hike']).toContain(r.difficulty);
    expect((world.resort as any).missingOfficialRuns).toEqual([]);
    const byName = Object.fromEntries(world.resort.runs.map((r) => [r.name, r.difficulty]));
    expect(byName['Ute']).toBe('green');
    expect(byName['Sun King']).toBe('blue');
    expect(byName['Defiance']).toBe('black');
    expect(byName['The Heathen']).toBe('double');
  });

  it('every run has a boundary outline derived from lidar', () => {
    const missing = world.resort.runs.filter((r: any) => !r.outline?.length).map((r) => r.name);
    expect(missing.length).toBeLessThan(3);
  });

  it('tree tiles hold lidar trees with all four species', () => {
    const idx = JSON.parse(readFileSync(path.join(WORLD_DIR, 'trees/index.json'), 'utf8'));
    const total = idx.tiles.reduce((a: number, t: number[]) => a + t[2], 0);
    expect(total).toBeGreaterThan(150000);
    for (const k of Object.keys(idx.counts)) expect(idx.counts[k]).toBeGreaterThan(1000);
  });

  it('surface map marks groomed runs and the run raster finds runs', () => {
    expect(world.surface).not.toBeNull();
    const mid = world.resort.runs.find((r) => r.name === 'Midway' && r.kind === 'line')!;
    const p = mid.points[Math.floor(mid.points.length / 2)];
    const s = world.surface!.at(p[0], p[2]);
    expect(s.piste).toBeGreaterThan(0.5);
    expect(s.groomed).toBeGreaterThan(0.5);
  });
});
