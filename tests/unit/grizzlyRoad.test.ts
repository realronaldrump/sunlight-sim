import { beforeAll, describe, expect, it } from 'vitest';
import { loadWorld } from '../harness/world';

import { sampleGrizzlyOpening } from '../harness/grizzlyRoad';

let world: Awaited<ReturnType<typeof loadWorld>>;
let opening: { x: number; z: number; height: number }[];

beforeAll(async () => {
  world = await loadWorld();
  opening = await sampleGrizzlyOpening(world);
});

describe('Grizzly Road below Primo', () => {
  it('packs the open approach, downhill shoulder and uphill shoulder for the skis', () => {
    for (const [x, z] of [[15, 982], [165, 873], [234, 839], [265, 797]]) {
      expect(world.surface!.at(x, z), `snow at ${x}, ${z}`).toMatchObject({ groomed: 1, piste: 1, moguls: 0 });
    }
    // Tree stand immediately north of the narrow saddle passage.
    expect(world.surface!.at(189, 850).piste).toBe(0);
  });

  it('follows the measured downhill roll, saddle and return crest on the 1 m skiing surface', () => {
    // Survey control elevations are from the native USGS raster, in NAVD88 meters.
    const low = Math.min(...opening.slice(240, 276).map(p => p.height));
    const crest = Math.max(...opening.slice(287, 325).map(p => p.height));
    expect(low).toBeCloseTo(2949.3, 0);
    expect(crest).toBeCloseTo(2953.6, 0);
    const pitch = (i: number) => Math.atan2(opening[i + 10].height - opening[i].height, 10) * 180 / Math.PI;
    const steepest = (from: number, to: number, sign: number) =>
      Math.max(...opening.slice(from, to).map((_, k) => sign * pitch(from + k)));
    expect(steepest(145, 206, -1)).toBeGreaterThan(20);
    expect(steepest(255, 309, 1)).toBeGreaterThan(7);
    expect(steepest(255, 309, 1)).toBeLessThan(10);
  });
});
