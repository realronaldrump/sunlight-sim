import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { SkiTracks } from '../../client/src/skier/tracks';

const dir = new THREE.Vector3(0, 0, -1);
function pair(z: number, height: (x: number, z: number) => number) {
  return [-0.2, 0.2].map((x) => new THREE.Vector3(x, height(x, z), z)) as [THREE.Vector3, THREE.Vector3];
}

describe('snow tracks', () => {
  it('keeps the entire groove on a sloping surface, including its shoulders', () => {
    const height = (x: number, z: number) => 2800 + x * 0.6 + z * 0.35;
    const tracks = new SkiTracks(height);
    tracks.add(...pair(0, height), dir, 0.25, 1.2);
    tracks.update(0.1);
    tracks.add(...pair(-1, height), dir, 0.25, 1.2);
    const geo = tracks.mesh.geometry;
    const pos = geo.getAttribute('position'), normals = geo.getAttribute('normal');
    const used = new Set(Array.from(geo.index!.array).slice(0, geo.drawRange.count));
    expect(used.size).toBeGreaterThan(8);
    for (const i of used) {
      expect(pos.getY(i) - height(pos.getX(i), pos.getZ(i))).toBeGreaterThan(0.006);
      expect(pos.getY(i) - height(pos.getX(i), pos.getZ(i))).toBeLessThan(0.025);
      expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))).toBeCloseTo(1, 5);
    }
  });

  it('never connects a teleport, a lift ride, or an airborne break with a snow ribbon', () => {
    const height = () => 2700, tracks = new SkiTracks(height);
    tracks.add(...pair(0, height), dir, 0.1, 1);
    tracks.add(...pair(-1, height), dir, 0.1, 1);
    const before = tracks.mesh.geometry.drawRange.count;
    tracks.add(...pair(-1000, height), dir, 0.1, 1);
    expect(tracks.mesh.geometry.drawRange.count).toBe(before);
    tracks.break();
    tracks.add(...pair(-2000, height), dir, 0.1, 1);
    expect(tracks.mesh.geometry.drawRange.count).toBe(before);
  });

  it('fades old impressions gradually and clears transient powder after emission stops', () => {
    const height = () => 2700, tracks = new SkiTracks(height);
    tracks.add(...pair(0, height), dir, 0.3, 1.6);
    tracks.update(0.05);
    tracks.add(...pair(-0.5, height), dir, 0.3, 1.6);
    tracks.update(0.05);
    expect(tracks.mesh.children[0].visible).toBe(true);
    const colors = tracks.mesh.geometry.getAttribute('color');
    const before = Math.max(...Array.from({ length: colors.count }, (_, i) => colors.getW(i)));
    tracks.fade(90);
    const after = Math.max(...Array.from({ length: colors.count }, (_, i) => colors.getW(i)));
    expect(after / before).toBeCloseTo(Math.exp(-1), 5);
    tracks.update(2);
    expect(tracks.mesh.children[0].visible).toBe(false);
  });
});
