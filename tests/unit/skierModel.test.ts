import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as THREE from 'three/webgpu';
import { SkierModel, type SkierPose } from '../../client/src/skier/skierModel';
import { prepareHumanAsset } from '../../client/src/skier/humanBody';
import { orientSkier } from '../../client/src/skier/orientation';

const pose: SkierPose = { speed: 8, edge: 0, plow: 0, tuck: 0, skid: 0, fallen: 0, sitting: 0, time: 2, pushing: false };

describe('skier rendering', () => {
  beforeAll(() => prepareHumanAsset(JSON.parse(gunzipSync(readFileSync('client/public/models/skier-human.json.gz')).toString())));
  const joint = (model: SkierModel, name: string) => model.human.mesh.skeleton.bones.find(b => b.name === name)!.position.clone();
  const kneeAngle = (model: SkierModel, side: string) => {
    const knee = joint(model, `calf_${side}`);
    return joint(model, `thigh_${side}`).sub(knee).angleTo(joint(model, `foot_${side}`).sub(knee));
  };
  const settle = (model: SkierModel, change: Partial<SkierPose>) => {
    for (let i = 0; i <= 90; i++) model.update({ ...pose, ...change, time: i / 60 });
  };

  it('loads the outside leg, flexes the inside knee and counter-rotates the shoulders in either turn', () => {
    for (const edge of [-.8, .8]) {
      const model = new SkierModel(); settle(model, { edge, terrain: { height: () => 0 } });
      const outside = edge > 0 ? 'l' : 'r', inside = edge > 0 ? 'r' : 'l';
      expect(kneeAngle(model, outside) - kneeAngle(model, inside)).toBeGreaterThan(.12);
      expect(joint(model, 'pelvis').x * Math.sign(edge)).toBeGreaterThan(.2);
      const shoulders = joint(model, 'upperarm_r').sub(joint(model, 'upperarm_l'));
      const hips = joint(model, 'thigh_r').sub(joint(model, 'thigh_l'));
      expect(shoulders.z * edge).toBeLessThan(0);
      expect(hips.z * edge).toBeGreaterThan(0);
      for (const side of ['l', 'r']) {
        expect(joint(model, `thigh_${side}`).distanceTo(joint(model, `calf_${side}`))).toBeCloseTo(.46, 5);
        expect(joint(model, `calf_${side}`).distanceTo(joint(model, `foot_${side}`))).toBeCloseTo(.46, 5);
      }
    }
  });

  it('absorbs different snow heights independently while both ski bases stay on the snow', () => {
    const model = new SkierModel(), terrain = { height: (x: number) => x < 0 ? .12 : -.04 };
    settle(model, { terrain }); model.root.updateMatrixWorld(true);
    expect(joint(model, 'foot_l').y - joint(model, 'foot_r').y).toBeCloseTo(.16, 5);
    expect(kneeAngle(model, 'l')).toBeLessThan(kneeAngle(model, 'r'));
    for (const ski of (model as any).skis as THREE.Group[]) {
      const base = new THREE.Vector3().applyMatrix4(ski.matrixWorld);
      expect(base.y - terrain.height(base.x)).toBeGreaterThanOrEqual(0);
      expect(base.y - terrain.height(base.x)).toBeLessThan(.03);
    }
  });

  it('keeps slope contact correct for an adult and a scaled child', () => {
    for (const scale of [1, .76]) {
      const model = new SkierModel(), terrain = { height: (x: number, z: number) => 2400 + .32 * x - .2 * z };
      model.root.scale.setScalar(scale); model.root.position.set(30, terrain.height(30, -60), -60);
      orientSkier(model.root, .7, { x: -.32, y: 1, z: .2 });
      settle(model, { terrain }); model.root.updateMatrixWorld(true);
      for (const ski of (model as any).skis as THREE.Group[]) for (const along of [-.65, 0, .65]) {
        const point = new THREE.Vector3(0, 0, along).applyMatrix4(ski.matrixWorld);
        expect(point.y - terrain.height(point.x, point.z)).toBeGreaterThan(0);
        expect(point.y - terrain.height(point.x, point.z)).toBeLessThan(.03);
      }
    }
  });

  it('transfers weight continuously across a turn and settles consistently at different frame rates', () => {
    const end: number[] = [];
    for (const hz of [30, 120]) {
      const model = new SkierModel(); settle(model, { edge: .8 });
      const before = joint(model, 'pelvis').x;
      model.update({ ...pose, edge: -.8, time: 1.5 + 1 / hz });
      expect(joint(model, 'pelvis').x).toBeGreaterThan(0);
      expect(before - joint(model, 'pelvis').x).toBeLessThan(.2);
      for (let i = 2; i <= hz; i++) model.update({ ...pose, edge: -.8, time: 1.5 + i / hz });
      end.push(joint(model, 'pelvis').x);
      expect(end.at(-1)).toBeLessThan(-.2);
      model.update({ ...pose, edge: -.8, sitting: 1, time: 2.6 });
      expect(joint(model, 'pelvis').x).toBe(0);
      expect(joint(model, 'upperarm_l').z).toBeCloseTo(joint(model, 'upperarm_r').z, 6);
    }
    expect(Math.abs(end[0] - end[1])).toBeLessThan(.005);
  });
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
