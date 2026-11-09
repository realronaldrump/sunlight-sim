import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { readFileSync } from 'node:fs';
import { LiftPath } from '../../shared/lifts';
import { cableLineGeometry, cableLoopGeometry, CABLE_RADIUS } from '../../client/src/lifts/cableGeometry';
import { buildTerminal, buildTower } from '../../client/src/lifts/liftStructures';
import { mergeStatic } from '../../client/src/world/mergeStatic';

const paths = JSON.parse(readFileSync('client/public/world/resort.json', 'utf8')).lifts.map((d: any) => new LiftPath(d)) as LiftPath[];
beforeAll(() => {
  // Geometry tests need canvas-backed material metadata, not a raster/GL context.
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }) });
});

describe('lift structure and rope alignment', () => {
  it('puts the visible cable centre exactly through every shared tower support', () => {
    for (const p of paths) for (const side of [-1, 1]) {
      const g = cableLineGeometry(p, side), a = g.attributes.position, H = g.userData.sampleDistances as number[];
      for (const support of p.def.supports) {
        const h = Math.max(0, Math.min(p.horiz, support.s)), i = H.indexOf(h);
        expect(i).toBeGreaterThanOrEqual(0);
        const centre = new THREE.Vector3();
        for (let j = 0; j < 6; j++) centre.add(new THREE.Vector3().fromBufferAttribute(a, i * 7 + j));
        centre.multiplyScalar(1 / 6);
        const q = p.ropePoint(h, side);
        expect(centre.distanceTo(new THREE.Vector3(q.x, q.y, q.z))).toBeLessThan(.001);
      }
      expect([...g.attributes.normal.array].every(Number.isFinite)).toBe(true);
      g.dispose();
      const loop = cableLoopGeometry(p); expect(loop.index!.count).toBeGreaterThan(0); loop.dispose();
    }
  });

  it('keeps support and compression sheave grooves tangent to a sloped rope', () => {
    for (const compression of [false, true]) for (const pitch of [-.3, .25]) {
      const { object } = buildTower('primo', 9, 0, 1, pitch, compression);
      object.updateMatrixWorld(true);
      const train = object.getObjectByName('aligned-sheave-train')!;
      const tyre = train.children.find(o => (o as THREE.Mesh).geometry?.type === 'TorusGeometry') as THREE.Mesh<THREE.TorusGeometry>;
      const r = tyre.geometry.parameters.radius + tyre.geometry.parameters.tube;
      const normal = new THREE.Vector3(0, compression ? -1 : 1, 0).transformDirection(train.matrixWorld);
      const contact = tyre.getWorldPosition(new THREE.Vector3()).addScaledVector(normal, r + CABLE_RADIUS);
      expect(contact.y).toBeCloseTo(9 + Math.tan(pitch) * contact.z, 7);
    }
  });

  it('retains moving bullwheels and correct drive ends through static batching', () => {
    for (const style of ['primo', 'segundo', 'tercero'] as const) for (const top of [false, true]) {
      const t = buildTerminal(style, top, 4, 1, z => ({ height: 4 + .1 * z, pitch: Math.atan(.1) }));
      expect(t.kind).toBe(style === 'tercero' ? 'riblet' : (style === 'primo') === top ? 'drive' : 'return');
      const wheel = t.object.getObjectByName('rotating-bullwheel')!;
      expect(wheel.userData.spin.radius).toBe(2.6);
      expect(wheel.children).toHaveLength(2);
      mergeStatic(t.object);
      expect(wheel.parent).not.toBeNull();
      expect(wheel.children).toHaveLength(2);
      const mesh = wheel.children[0] as THREE.Mesh;
      const vertex = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, 0);
      t.object.updateMatrixWorld(true); const before = vertex.clone().applyMatrix4(mesh.matrixWorld);
      wheel.rotation.y = .5; t.object.updateMatrixWorld(true);
      expect(vertex.clone().applyMatrix4(mesh.matrixWorld).distanceTo(before)).toBeGreaterThan(.2);
    }
  });

  it('keeps Riblet guard hoops out of the hanger path and distinguishes its two stations', () => {
    const tower = buildTower('tercero', 9, 0, 1).object;
    const ring = tower.getObjectByName('chair-guard-ring') as THREE.Mesh;
    ring.geometry.computeBoundingBox();
    expect(ring.geometry.boundingBox!.max.x).toBeLessThan(2.4);
    expect(ring.geometry.boundingBox!.min.x).toBeGreaterThan(-2.4);
    const top = buildTerminal('tercero', true, 4, 1), bottom = buildTerminal('tercero', false, 4, 1);
    expect(top.object.userData.configuration).toBe('counterweight-tension');
    expect(top.object.getObjectByName('tercero-counterweight')).toBeDefined();
    expect(bottom.object.userData.configuration).toBe('vault-drive');
    expect(bottom.object.getObjectByName('tercero-drive-vault')).toBeDefined();
    // Low structures have their own collision ceiling instead of an invisible tall obstacle.
    expect(bottom.colliders.find(c => c.hx !== undefined)?.top).toBe(.2);
  });
});
