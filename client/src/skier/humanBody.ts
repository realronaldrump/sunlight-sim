// Anatomical CC0 MakeHuman/MPFB mesh dressed by pipeline/build_skier.ts.
// Bones are driven by ski-specific IK, so hands, knees and feet follow the actual skiing pose.
import * as THREE from 'three/webgpu';
import { attribute, uniform, vec3, mix } from 'three/tsl';

interface RestBone { name: string; parent: string; position: number[]; quaternion: number[]; inverse: number[] }
export interface HumanAsset {
  version: number; bones: RestBone[]; position: number[]; normal: number[]; index: number[];
  skinIndex: number[]; skinWeight: number[]; color: number[]; jacket: number[]; skin: number[]; roughness: number[];
}
let asset: HumanAsset | null = null;
let geometry: THREE.BufferGeometry;
export function prepareHumanAsset(data: HumanAsset) {
  if (data.version !== 1 || data.bones.length < 20) throw new Error('Invalid human character asset');
  asset = data;
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(data.skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(data.skinWeight, 4));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.color, 3));
  geometry.setAttribute('jacket', new THREE.Float32BufferAttribute(data.jacket, 1));
  geometry.setAttribute('skinTone', new THREE.Float32BufferAttribute(data.skin, 1));
  geometry.setAttribute('roughness', new THREE.Float32BufferAttribute(data.roughness, 1));
  geometry.setIndex(data.index);
}
export async function loadHumanAsset(base: string) {
  if (asset) return;
  const response = await fetch(`${base}/models/skier-human.json.gz`);
  if (!response.ok) throw new Error(`Human character asset: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = bytes[0] === 0x1f
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(bytes);
  prepareHumanAsset(JSON.parse(text));
}

type Joints = Record<string, THREE.Vector3>;
export class HumanBody {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  private bones = new Map<string, THREE.Bone>();
  private rest = new Map<string, { p: THREE.Vector3; q: THREE.Quaternion; parent: string }>();
  private jacket;
  private skinTint;
  private delta = new THREE.Quaternion();
  private direction = new THREE.Vector3();
  private restDirection = new THREE.Vector3();

  constructor(jacket: THREE.Color, skinTint = new THREE.Color(1, 1, 1)) {
    if (!asset) throw new Error('Load human character assets before constructing skiers');
    this.jacket = uniform(jacket.clone()); this.skinTint = uniform(skinTint.clone());
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
    mat.colorNode = attribute('color', 'vec3').mul(mix(vec3(1), this.jacket, attribute('jacket', 'float'))).mul(mix(vec3(1), this.skinTint, attribute('skinTone', 'float')));
    mat.roughnessNode = attribute('roughness', 'float');
    const bones: THREE.Bone[] = [];
    for (const b of asset.bones) {
      const bone = new THREE.Bone(); bone.name = b.name;
      bone.position.fromArray(b.position); bone.quaternion.fromArray(b.quaternion).normalize();
      this.bones.set(b.name, bone); bones.push(bone); this.root.add(bone);
      this.rest.set(b.name, { p: bone.position.clone(), q: bone.quaternion.clone(), parent: b.parent });
    }
    const skeleton = new THREE.Skeleton(bones, asset.bones.map(b => new THREE.Matrix4().fromArray(b.inverse)));
    this.mesh = new THREE.SkinnedMesh(geometry, mat);
    this.mesh.normalizeSkinWeights();
    this.mesh.name = 'anatomical-skier';
    this.mesh.bind(skeleton, new THREE.Matrix4());
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
  }

  setJacket(color: THREE.ColorRepresentation) { this.jacket.value.set(color); }

  private segment(name: string, child: string, start: THREE.Vector3, end: THREE.Vector3) {
    const b = this.bones.get(name)!, r = this.rest.get(name)!, c = this.rest.get(child)!;
    this.restDirection.copy(c.p).sub(r.p);
    this.direction.copy(end).sub(start);
    const ratio = this.direction.length() / this.restDirection.length();
    this.delta.setFromUnitVectors(this.restDirection.normalize(), this.direction.normalize());
    b.position.copy(start); b.quaternion.copy(this.delta).multiply(r.q); b.scale.set(1, ratio, 1);
  }

  pose(j: Joints, headTilt: THREE.Euler) {
    const p = j.pelvis, neck = j.neck;
    const s1 = p.clone().lerp(neck, 0.15), s2 = p.clone().lerp(neck, 0.27), s3 = p.clone().lerp(neck, 0.38);
    this.segment('pelvis', 'spine_01', p, s1);
    this.segment('spine_01', 'spine_02', s1, s2);
    this.segment('spine_02', 'spine_03', s2, s3);
    this.segment('spine_03', 'neck_01', s3, neck);
    this.segment('neck_01', 'head', neck, j.head);
    const head = this.bones.get('head')!;
    head.position.copy(j.head); head.quaternion.setFromEuler(headTilt).multiply(this.rest.get('head')!.q);
    for (const [side, label] of [['l', 'L'], ['r', 'R']]) {
      const shoulder = j['shoulder' + label], elbow = j['elbow' + label], wrist = j['hand' + label];
      const clavicle = j.chest.clone().add(new THREE.Vector3(label === 'L' ? -0.025 : 0.025, 0.055, 0));
      this.segment('clavicle_' + side, 'upperarm_' + side, clavicle, shoulder);
      this.segment('upperarm_' + side, 'lowerarm_' + side, shoulder, elbow);
      this.segment('lowerarm_' + side, 'hand_' + side, elbow, wrist);
      this.segment('thigh_' + side, 'calf_' + side, j['hip' + label], j['knee' + label]);
      this.segment('calf_' + side, 'foot_' + side, j['knee' + label], j['ankle' + label]);
      const hand = this.bones.get('hand_' + side)!, restHand = this.rest.get('hand_' + side)!;
      // A vertical, relaxed pole grip. The wrist stays aligned to the forearm, fingers curl below it.
      const palmEnd = wrist.clone().add(new THREE.Vector3(0, -0.09, -0.03));
      this.segment('hand_' + side, 'middle_01_' + side, wrist, palmEnd);
      const handDelta = hand.quaternion.clone().multiply(restHand.q.clone().invert());
      for (const [name, rest] of this.rest) {
        if (!name.endsWith('_' + side) || !/index|middle|ring|pinky|thumb/.test(name)) continue;
        const bone = this.bones.get(name)!;
        bone.position.copy(rest.p).sub(restHand.p).applyQuaternion(handDelta).add(wrist);
        bone.quaternion.copy(handDelta).multiply(rest.q);
      }
      for (const finger of ['index', 'middle', 'ring', 'pinky']) {
        let start: THREE.Vector3 | null = null;
        for (let part = 1; part <= 3; part++) {
          const name = `${finger}_0${part}_${side}`, rest = this.rest.get(name)!, bone = this.bones.get(name)!;
          const curl = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -[0, 0.65, 1.45, 2.05][part]);
          bone.position.copy(start ?? rest.p.clone().sub(restHand.p).applyQuaternion(handDelta).add(wrist));
          bone.quaternion.copy(curl).multiply(handDelta).multiply(rest.q);
          if (part < 3) {
            const next = this.rest.get(`${finger}_0${part + 1}_${side}`)!;
            start = next.p.clone().sub(rest.p).applyQuaternion(handDelta).applyQuaternion(curl).add(bone.position);
          }
        }
      }
      const foot = this.bones.get('foot_' + side)!, ball = this.bones.get('ball_' + side)!;
      foot.position.copy(j['ankle' + label]); foot.quaternion.copy(this.rest.get('foot_' + side)!.q);
      ball.position.copy(foot.position).add(new THREE.Vector3(0, -0.05, -0.14));
      ball.quaternion.copy(this.rest.get('ball_' + side)!.q);
    }
  }
}
