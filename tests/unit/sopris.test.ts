import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { loadWorld } from '../harness/world';
import { browserLoader, Heightfield } from '../../client/src/terrain/heightfield';
import { needsLandmarkDetail } from '../../client/src/terrain/landmarkDetail';

let world: Awaited<ReturnType<typeof loadWorld>>;
beforeAll(async () => { world = await loadWorld(); });

describe('Mount Sopris landmark terrain', () => {
  it('revalidates the index and versions cached tile requests after a terrain release', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
    vi.stubGlobal('fetch', fetcher);
    try {
      await browserLoader('/world/terrain/index.json');
      await browserLoader('/world/terrain/L2/14_-15.bin.gz', 'sopris-new');
      expect(fetcher.mock.calls[0]).toEqual(['/world/terrain/index.json', { cache: 'no-cache' }]);
      expect(fetcher.mock.calls[1][0]).toBe('/world/terrain/L2/14_-15.bin.gz?v=sopris-new');
    } finally { vi.unstubAllGlobals(); }
  });
  it('retains 4 m summit geometry through every quadtree ancestor from the resort', () => {
    const hf = world.hf, regions = hf.index.detailRegions ?? [];
    // Test the same four-child availability gate as the real renderer. A missing
    // intermediate level would silently leave Sopris in its original coarse LOD.
    for (const [x, n] of [[14731, -14803], [15900, -15600], [13800, -14300]]) {
      for (let L = hf.maxLevel; L > 2; L--) {
        const size = 64 * 2 ** L;
        const cx = Math.floor(x / size), cn = Math.floor(n / size);
        expect(needsLandmarkDetail(regions, L, cx * size, cn * size, size)).toBe(true);
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
          expect(hf.hasTile(L - 1, Math.floor((cx * 2 + a) / 4), Math.floor((cn * 2 + b) / 4))).toBe(true);
        }
      }
    }
    expect(needsLandmarkDetail(regions, 2, 14592, -14848, 256)).toBe(false);
    expect(needsLandmarkDetail(regions, 6, -32768, 32768, 4096)).toBe(false);
    expect(needsLandmarkDetail(regions, 2, -256, -256, 256)).toBe(false);
  });

  it('preserves both measured summit heights and the saddle between them', async () => {
    const manifest = JSON.parse(await fs.readFile('client/public/world/terrain/sopris.json', 'utf8'));
    expect(manifest.sourceResolutionM).toBe(1);
    expect(manifest.summits).toHaveLength(2);
    const hf = world.hf;
    for (const p of manifest.summits) {
      await hf.ensureArea(2, p.x, p.n, 16);
      expect(p.elevation).toBeGreaterThan(3950);
      expect(p.elevation).toBeLessThan(3960);
      expect(Math.abs(hf.heightAtLocal(p.x, p.n) - p.elevation)).toBeLessThan(2);
    }
    const [a, b] = manifest.summits;
    expect(Math.hypot(a.x - b.x, a.n - b.n)).toBeGreaterThan(900);
    const x = (a.x + b.x) / 2, n = (a.n + b.n) / 2;
    await hf.ensureArea(2, x, n, 10);
    expect(hf.heightAtLocal(x, n)).toBeLessThan(Math.min(a.elevation, b.elevation) - 50);
  });

  it('keeps landmark data cached when the skier remains at Sunlight', async () => {
    const hf = world.hf;
    const tile = await hf.ensureTile(2, 14, -15);
    expect(tile).not.toBeNull();
    hf.evict(0, 0, 900);
    expect(hf.getTile(2, 14, -15)).toBe(tile);
  });

  it('joins the measured 4 m summit tiles without cracks or elevation scaling', async () => {
    const a = (await world.hf.ensureTile(2, 14, -15))!;
    const b = (await world.hf.ensureTile(2, 15, -15))!;
    let error = 0;
    for (let j = 1; j <= 257; j++) error = Math.max(error,
      Math.abs(a.heights[j * 259 + 257] - b.heights[j * 259 + 1]));
    expect(error).toBeLessThan(0.03);
    expect(Heightfield.sampleTile(a, 14731, -14803)).toBeGreaterThan(3800);
  });
});
