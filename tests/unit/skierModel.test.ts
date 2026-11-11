import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three/webgpu';
import { SkierModel, type SkierPose } from '../../client/src/skier/skierModel';
import { prepareHumanAsset } from '../../client/src/skier/humanBody';

const pose: SkierPose = { speed: 8, edge: 0, plow: 0, tuck: 0, skid: 0, fallen: 0, sitting: 0, time: 2, pushing: false };

describe('skier rendering', () => {
  beforeAll(() => prepareHumanAsset(JSON.parse(gunzipSync(readFileSync('client/public/models/skier-human.json.gz')).toString())));
  it('keeps skis on the loading snow while the knees fold into the chair', () => {
    const model = new SkierModel();
    for (const sitting of [0, .2, .5, .8, 1]) {
      const footGroundY = -.08 * sitting, footGroundPitch = .1;
      model.update({ ...pose, speed: 2.54, sitting, footGroundY, footGroundPitch, liftPreparation: 1 });
      model.root.updateMatrixWorld(true);
      for (const ski of (model as any).skis as THREE.Group[]) for (const z of [-.6, 0, .6]) {
        const point = new THREE.Vector3(0, 0, z).applyMatrix4(ski.matrixWorld);
        const snow = footGroundY - Math.tan(footGroundPitch) * (point.z + .2);
        expect(point.y - snow).toBeGreaterThan(-.05);
      }
    }
  });
  it('uses a detailed articulated human instead of capsule limbs', () => {
    const model = new SkierModel();
    const meshes: THREE.Mesh[] = [];
    model.root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const human = meshes.find(m => (m as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
    expect(human.skeleton.bones).toHaveLength(53);
    expect(human.geometry.attributes.position.count).toBeGreaterThan(20000);
    expect(meshes.some(m => m.geometry.type === 'CapsuleGeometry')).toBe(false);
  });

  it('releases skis during a snowball tumble and restores the finite rig after getting up', () => {
    const model = new SkierModel(); model.hitBySnowball(17);
    for (let i = 0; i < 120; i++) {
      model.update({ ...pose, time: 2 + i / 60, fallen: 1 });
      model.root.updateMatrixWorld(true);
      expect((model as any).skis.every((s: THREE.Object3D) => !s.visible)).toBe(true);
      expect((model as any).body.rotation.toArray().slice(0,3).every(Number.isFinite)).toBe(true);
    }
    for (let i = 0; i < 130; i++) model.update({ ...pose, time: 4 + i / 60, fallen: Math.max(0, 1 - i / 96) });
    model.update({ ...pose, time: 7, fallen: 0 });
    expect((model as any).skis.every((s: THREE.Object3D) => s.visible)).toBe(true);
    model.hitBySnowball(17); model.resetSnowballs(); model.update({...pose,time:8});
    expect((model as any).skis.every((s: THREE.Object3D) => s.visible)).toBe(true);
  });

  it('keeps finite poses attached to the skier after world translation and rotation', () => {
    const model = new SkierModel();
    const skin = model.root.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    expect(skin).toBeDefined();
    for (const change of [{}, { edge: 0.7 }, { plow: 1 }, { tuck: 1 }, { fallen: 1 }, { sitting: 1 }]) {
      model.root.position.set(0, 0, 0); model.root.rotation.set(0, 0, 0);
      model.update({ ...pose, ...change }); model.root.updateMatrixWorld(true);
      const local: THREE.Vector3[] = [];
      for (let i = 0; i < skin.geometry.attributes.position.count; i += 31) {
        const p = skin.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(skin.geometry.attributes.position, i));
        expect(Number.isFinite(p.length())).toBe(true);
        expect(p.length()).toBeLessThan(3.5);
        local.push(p);
      }
      model.root.position.set(1100, 2900, -600); model.root.rotation.y = 1.2;
      model.root.updateMatrixWorld(true);
      let j = 0;
      for (let i = 0; i < skin.geometry.attributes.position.count; i += 31) {
        const p = skin.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(skin.geometry.attributes.position, i));
        // Float32 weights at 3 km world offsets should remain within a millimeter.
        expect(p.distanceTo(local[j++])).toBeLessThan(0.001);
      }
    }
  });
});
