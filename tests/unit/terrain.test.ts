import { describe, it, expect, beforeAll } from 'vitest';
import { loadWorld } from '../harness/world';
import { Heightfield } from '../../client/src/terrain/heightfield';

let world: Awaited<ReturnType<typeof loadWorld>>;
beforeAll(async () => { world = await loadWorld(); });

describe('terrain tiles', () => {
  it('index covers 1 m resort area and far terrain', () => {
    const idx = world.hf.index;
    expect(idx.levels['0'].tiles.length).toBeGreaterThan(250);
    expect(idx.maxLevel).toBe(8);
    expect(idx.levels['8'].tileSize).toBe(65536);
  });

  it('decodes a 1 m tile with plausible heights', async () => {
    const t = await world.hf.ensureTile(0, 0, 3);
    expect(t).not.toBeNull();
    expect(t!.n).toBe(259);
    expect(t!.min).toBeGreaterThan(2200);
    expect(t!.max).toBeLessThan(3200);
  });

  it('neighbouring tiles agree on shared edges (seamless)', async () => {
    const a = (await world.hf.ensureTile(0, 0, 2))!, b = (await world.hf.ensureTile(0, 1, 2))!;
    let maxd = 0;
    for (let j = 1; j < 258; j++) maxd = Math.max(maxd, Math.abs(a.heights[j * 259 + 257] - b.heights[j * 259 + 1]));
    expect(maxd).toBeLessThan(0.02);
  });

  it('coarse levels match the 1 m data', async () => {
    const hf = world.hf;
    await hf.ensureArea(0, 0, 500, 300);
    await hf.ensureArea(2, 0, 500, 300);
    let sum = 0, n = 0;
    for (let x = -200; x <= 200; x += 37) for (let nn = 300; nn <= 700; nn += 41) {
      const h0 = Heightfield.sampleTile(hf.getTile(0, Math.floor(x / 256), Math.floor(nn / 256))!, x, nn);
      const h2 = Heightfield.sampleTile(hf.getTile(2, Math.floor(x / 1024), Math.floor(nn / 1024))!, x, nn);
      sum += Math.abs(h0 - h2); n++;
    }
    expect(sum / n).toBeLessThan(1.0);
  });

  it('summit height matches Compass Peak (9,895 ft)', async () => {
    const primo = world.resort.lifts.find((l: any) => l.name === 'Primo');
    await world.hf.ensureArea(0, primo.top[0], -primo.top[2], 100);
    let max = 0;
    for (let dx = -60; dx <= 60; dx += 2) for (let dz = -60; dz <= 60; dz += 2) max = Math.max(max, world.hf.heightAt(primo.top[0] + dx, primo.top[2] + dz));
    expect(Math.abs(max * 3.28084 - 9895)).toBeLessThan(40);
  });
});
