import { beforeAll, describe, expect, it } from 'vitest';
import { createSkier, headingFromDir, stepSkier } from '../../shared/skiPhysics';
import { loadWorld, makeProbe } from '../harness/world';
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

  it('runs out of momentum on the climb with a slow entry and no pole push', () => {
    const bottom = opening[261], ahead = opening[271];
    const heading = headingFromDir(ahead.x - bottom.x, ahead.z - bottom.z);
    const st = createSkier({ x: bottom.x, y: bottom.height, z: bottom.z }, heading);
    const probe = makeProbe(world.hf, world.surface);
    const dx = -Math.sin(heading), dz = -Math.cos(heading);
    const normal = probe.normal(bottom.x, bottom.z, st.normal);
    const dy = -(normal.x * dx + normal.z * dz) / normal.y;
    const horizontalSpeed = 4 / Math.hypot(1, dy);
    st.vel = { x: horizontalSpeed * dx, y: horizontalSpeed * dy, z: horizontalSpeed * dz };
    let farthest = 0, forwardSpeed = 4;
    for (let i = 0; i < 600 && forwardSpeed > .1; i++) {
      stepSkier(st, { steer: 0, tuck: false, plow: 0, stop: false, push: false }, probe, 1 / 60);
      farthest = Math.max(farthest, dx * (st.pos.x - bottom.x) + dz * (st.pos.z - bottom.z));
      forwardSpeed = dx * st.vel.x + dz * st.vel.z;
    }
    expect(farthest).toBeGreaterThan(2);
    expect(farthest).toBeLessThan(15);
    expect(forwardSpeed).toBeLessThanOrEqual(.1);
    expect(st.pos.y).toBeLessThan(opening[307].height - 3);
  });
});
