import { describe, expect, it } from 'vitest';
import { mapHeading, mapPoint, nearestTrailPoint } from '../../client/src/ui/minimapGeometry';
import { headingDir } from '../../shared/skiPhysics';

describe('minimap navigation', () => {
  const view = { x: 420, z: -650, width: 260, height: 220, span: 800 };

  it('keeps the skier centered and places north above and east to the right', () => {
    expect(mapPoint(view, 420, -650)).toEqual([130, 110]);
    expect(mapPoint(view, 420, -1050)).toEqual([130, -20]);
    expect(mapPoint(view, 820, -650)).toEqual([260, 110]);
  });

  it('follows a teleport without clamping the player at the terrain image boundary', () => {
    const moved = { ...view, x: 1800, z: -1900 };
    expect(mapPoint(moved, 1800, -1900)).toEqual([130, 110]);
    expect(mapPoint({ ...moved, span: 400 }, 2000, -1900)).toEqual([260, 110]);
  });

  it('points the marker in the same direction as ski physics for all compass headings', () => {
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2, .73]) {
      const direction = headingDir(heading), angle = mapHeading(heading);
      expect(Math.sin(angle)).toBeCloseTo(direction.x);
      expect(-Math.cos(angle)).toBeCloseTo(direction.z);
    }
  });

  it('finds a nearby trail when both segment endpoints are outside the minimap', () => {
    expect(nearestTrailPoint([[-1000, 2800, 10], [1000, 2600, 10]], 0, 0)).toEqual({ x: 0, z: 10, distance: 10 });
  });

  it('handles duplicate vertices and clamps to the trail endpoint', () => {
    expect(nearestTrailPoint([[10, 2800, 20], [10, 2800, 20], [30, 2700, 20]], 40, 20)).toEqual({ x: 30, z: 20, distance: 10 });
    expect(nearestTrailPoint([], 0, 0).distance).toBe(Infinity);
  });
});
