// Anatomical CC0 MakeHuman/MPFB mesh dressed by pipeline/build_skier.ts.
// Bones are driven by ski-specific IK, so hands, knees and feet follow the actual skiing pose.
import * as THREE from 'three/webgpu';
import { attribute, uniform, float } from 'three/tsl';
import { clothingSurface, faceStyle, jacketAccent, loadWinterClothing } from './winterClothing';

interface RestBone { name: string; parent: string; position: number[]; quaternion: number[]; inverse: number[] }
export interface HumanAsset {
  version: number; bones: RestBone[]; position: number[]; normal: number[]; index: number[];
  skinIndex: number[]; skinWeight: number[]; color: number[]; jacket: number[]; skin: number[]; roughness: number[]; uv?: number[];
}
let asset: HumanAsset | null = null;
let geometry: THREE.BufferGeometry;
let crowdGeometry: THREE.BufferGeometry | null = null;
function buildGeometry(data: HumanAsset) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(data.skinIndex, 4));
  const weights = new THREE.Float32BufferAttribute(data.skinWeight, 4);
  const weight = new THREE.Vector4();
  for (let i = 0; i < weights.count; i++) {
    weight.fromBufferAttribute(weights, i);
    const sum = weight.manhattanLength();
    if (sum) weight.multiplyScalar(1 / sum); else weight.set(1, 0, 0, 0);
    weights.setXYZW(i, weight.x, weight.y, weight.z, weight.w);
  }
  geometry.setAttribute('skinWeight', weights);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.color, 3));
  // One vertex buffer for the material attributes, including the UV islands used by uniform prints.
  const surface = new Float32Array(data.jacket.length * 5);
  for (let i = 0; i < data.jacket.length; i++) {
    surface.set([data.uv?.[2*i] ?? 0, data.uv?.[2*i+1] ?? 0, data.jacket[i], data.skin[i], data.roughness[i]], i * 5);
  }
  const packed = new THREE.InterleavedBuffer(surface, 5);
  geometry.setAttribute('uv', new THREE.InterleavedBufferAttribute(packed, 2, 0));
  geometry.setAttribute('jacket', new THREE.InterleavedBufferAttribute(packed, 1, 2));
  geometry.setAttribute('skinTone', new THREE.InterleavedBufferAttribute(packed, 1, 3));
  geometry.setAttribute('roughness', new THREE.InterleavedBufferAttribute(packed, 1, 4));
  geometry.setIndex(data.index);
  return geometry;
}
export function prepareHumanAsset(data: HumanAsset) {
  if (data.version !== 1 || data.bones.length < 20) throw new Error('Invalid human character asset');
  asset = data;
  geometry = buildGeometry(data);
}
export async function fetchCharacterAsset<T>(url: string | URL) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Human character asset: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = bytes[0] === 0x1f
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}
/** Simplified crowd mesh with the identical rig (pipeline/build_crowd_human.ts). Falls back to the full mesh. */
export async function loadCrowdHumanAsset(base: string) {
  if (crowdGeometry) return;
  const data = await fetchCharacterAsset<HumanAsset>(`${base}/models/skier-human-crowd.json.gz?kit=2`);
  if (asset && data.bones.length !== asset.bones.length) throw new Error('Crowd human rig mismatch');
  crowdGeometry = buildGeometry(data);
}
export async function loadHumanAsset(base: string) {
  if (asset) return;
  const [data] = await Promise.all([fetchCharacterAsset<HumanAsset>(`${base}/models/skier-human.json.gz?kit=2`), loadWinterClothing()]);
  prepareHumanAsset(data);
}

type Joints = Record<string, THREE.Vector3>;
export class HumanBody {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  private bones = new Map<string, THREE.Bone>();
  private rest = new Map<string, { p: THREE.Vector3; q: THREE.Quaternion; parent: string }>();
  private jacket;
  private accent;
  private face;
  private skinTint;
  readonly fabric;
  private delta = new THREE.Quaternion();
  private direction = new THREE.Vector3();
  private restDirection = new THREE.Vector3();

  constructor(jacket: THREE.Color, skinTint = new THREE.Color(1, 1, 1), lod: 'full' | 'crowd' = 'full', size = 1) {
    if (!asset) throw new Error('Load human character assets before constructing skiers');
    this.jacket = uniform(jacket.clone()); this.skinTint = uniform(skinTint.clone());
    this.accent = uniform(jacketAccent(jacket, new THREE.Color()));
    this.face = uniform(faceStyle(jacket.getHex(), size));
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
    this.fabric = clothingSurface(this.jacket.rgb, this.accent.rgb, this.skinTint.rgb, this.face,
      attribute('jacket', 'float'), attribute('skinTone', 'float'), float(1));
    mat.colorNode = this.fabric.colorNode;
    mat.roughnessNode = attribute('roughness', 'float').add(this.fabric.roughnessDelta);
    const bones: THREE.Bone[] = [];
    for (const b of asset.bones) {
      const bone = new THREE.Bone(); bone.name = b.name;
      bone.position.fromArray(b.position); bone.quaternion.fromArray(b.quaternion).normalize();
      this.bones.set(b.name, bone); bones.push(bone); this.root.add(bone);
      this.rest.set(b.name, { p: bone.position.clone(), q: bone.quaternion.clone(), parent: b.parent });
    }
    const skeleton = new THREE.Skeleton(bones, asset.bones.map(b => new THREE.Matrix4().fromArray(b.inverse)));
    this.mesh = new THREE.SkinnedMesh(lod === 'crowd' && crowdGeometry ? crowdGeometry : geometry, mat);
    this.mesh.name = 'anatomical-skier';
    this.mesh.bind(skeleton, new THREE.Matrix4());
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
  }

  setJacket(color: THREE.ColorRepresentation, size = 1) {
    this.jacket.value.set(color);
    jacketAccent(this.jacket.value, this.accent.value);
    this.face.value = faceStyle(this.jacket.value.getHex(), size);
  }
  setSkin(color: THREE.ColorRepresentation) { this.skinTint.value.set(color); }

  private segment(name: string, child: string, start: THREE.Vector3, end: THREE.Vector3) {
    const b = this.bones.get(name)!, r = this.rest.get(name)!, c = this.rest.get(child)!;
    this.restDirection.copy(c.p).sub(r.p);
    this.direction.copy(end).sub(start);
    const ratio = this.direction.length() / this.restDirection.length();
    this.delta.setFromUnitVectors(this.restDirection.normalize(), this.direction.normalize());
    b.position.copy(start); b.quaternion.copy(this.delta).multiply(r.q); b.scale.set(1, ratio, 1);
  }

  pose(j: Joints, headTilt: THREE.Euler, boardPalm?: THREE.Vector3, twist?: { pelvis: number; chest: number },
      relaxedHands = false) {
    const p = j.pelvis, neck = j.neck;
    const s1 = p.clone().lerp(neck, 0.15), s2 = p.clone().lerp(neck, 0.27), s3 = p.clone().lerp(neck, 0.38);
    this.segment('pelvis', 'spine_01', p, s1);
    this.segment('spine_01', 'spine_02', s1, s2);
    this.segment('spine_02', 'spine_03', s2, s3);
    this.segment('spine_03', 'neck_01', s3, neck);
    // Rotate around each spine segment, preserving its bend and length. Shoulder movement alone
    // does not twist the skinned jacket because this rig stores bones in a common local frame.
    if (twist) {
      for (const [name, a, b, k] of [
        ['pelvis', p, s1, 0], ['spine_01', s1, s2, .25],
        ['spine_02', s2, s3, .55], ['spine_03', s3, neck, 1],
      ] as const) {
        const angle = THREE.MathUtils.lerp(twist.pelvis, twist.chest, k);
        this.direction.copy(b).sub(a).normalize();
        this.bones.get(name)!.quaternion.premultiply(this.delta.setFromAxisAngle(this.direction, angle));
      }
    }
    this.segment('neck_01', 'head', neck, j.head);
    const head = this.bones.get('head')!;
    head.position.copy(j.head); head.quaternion.setFromEuler(headTilt).multiply(this.rest.get('head')!.q);
    for (const [side, label] of [['l', 'L'], ['r', 'R']]) {
      const shoulder = j['shoulder' + label], elbow = j['elbow' + label], wrist = j['hand' + label];
      const clavicle = j.chest.clone().add(new THREE.Vector3(label === 'L' ? -0.025 : 0.025, 0.055, 0));
      if (twist) clavicle.sub(j.chest).applyAxisAngle(new THREE.Vector3(0, 1, 0), twist.chest).add(j.chest);
      this.segment('clavicle_' + side, 'upperarm_' + side, clavicle, shoulder);
      this.segment('upperarm_' + side, 'lowerarm_' + side, shoulder, elbow);
      this.segment('lowerarm_' + side, 'hand_' + side, elbow, wrist);
      this.segment('thigh_' + side, 'calf_' + side, j['hip' + label], j['knee' + label]);
      this.segment('calf_' + side, 'foot_' + side, j['knee' + label], j['ankle' + label]);
      const hand = this.bones.get('hand_' + side)!, restHand = this.rest.get('hand_' + side)!;
      const holdingBoard = side === 'r' && boardPalm;
      // Turn the right palm up under the sign. The default grip curls down around a ski pole.
      const palmEnd = wrist.clone().add(holdingBoard || new THREE.Vector3(0, -0.09, -0.03));
      this.segment('hand_' + side, 'middle_01_' + side, wrist, palmEnd);
      if (holdingBoard) hand.quaternion.premultiply(this.delta.setFromAxisAngle(this.direction, -0.85));
      const handDelta = hand.quaternion.clone().multiply(restHand.q.clone().invert());
      for (const [name, rest] of this.rest) {
        if (!name.endsWith('_' + side) || !/index|middle|ring|pinky|thumb/.test(name)) continue;
        const bone = this.bones.get(name)!;
        bone.position.copy(rest.p).sub(restHand.p).applyQuaternion(handDelta).add(wrist);
        bone.quaternion.copy(handDelta).multiply(rest.q);
      }
      // Oppose the thumb across the grip. Leaving it in the source's spread-hand pose sent
      // the thumb straight out of the glove on both sides.
      if (!holdingBoard) {
        const inwards = side === 'l' ? 1 : -1;
        const first = 'thumb_01_' + side, middle = 'thumb_02_' + side, last = 'thumb_03_' + side;
        const base = this.bones.get(first)!.position;
        const knuckle = base.clone().add(new THREE.Vector3(inwards * .020, -.022, -.012));
        const tip = knuckle.clone().add(new THREE.Vector3(inwards * (relaxedHands ? .014 : -.004), -.031, -.009));
        this.segment(first, middle, base, knuckle);
        this.segment(middle, last, knuckle, tip);
        const end = this.bones.get(last)!;
        end.position.copy(tip);
        end.quaternion.copy(this.delta).multiply(this.rest.get(last)!.q);
      }
      const curls = holdingBoard ? [0, 1.75, 2.28, 2.55]
        : relaxedHands ? [0, -.23, -.56, -.85] : [0, -0.65, -1.45, -2.05];
      for (const finger of ['index', 'middle', 'ring', 'pinky']) {
        let start: THREE.Vector3 | null = null;
        for (let part = 1; part <= 3; part++) {
          const name = `${finger}_0${part}_${side}`, rest = this.rest.get(name)!, bone = this.bones.get(name)!;
          const curl = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), curls[part]);
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
