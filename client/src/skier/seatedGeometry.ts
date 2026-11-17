// Offline-baked poses of the dressed skier. The two headwear shapes and two distances share
// geometry across all lifts; a changing seat only uploads its transform and its guest's colours.
import * as THREE from 'three/webgpu';
import { attribute, mix, vec3 } from 'three/tsl';
import { clothingSurface, faceStyle, guestBuild, jacketAccent } from './winterClothing';
import { fetchCharacterAsset } from './humanBody';
import type { GuestLook } from '../world/guests';

const geometry: THREE.BufferGeometry[] = [];
let material: THREE.MeshStandardNodeMaterial;

export async function loadSeatedRiders() {
  if (geometry.length) return;
  const data = await fetchCharacterAsset<{ version: number; meshes: { vertices: number[]; index: number[] }[] }>(
    new URL('./assets/chair-riders.json.gz', import.meta.url),
  );
  if (data.version !== 1 || data.meshes.length !== 4) throw new Error('Invalid chair passenger geometry');
  for (const mesh of data.meshes) {
    const g = new THREE.BufferGeometry();
    const buffer = new THREE.InterleavedBuffer(new Float32Array(mesh.vertices), 17);
    const attr = (name: string, size: number, offset: number) =>
      g.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, size, offset));
    attr('position', 3, 0);
    attr('normal', 3, 3);
    attr('color', 3, 6);
    attr('uv', 2, 9);
    attr('mask', 3, 11); // jacket, skin, headwear
    attr('finish', 3, 14); // roughness, metalness, clothing atlas coverage
    g.setIndex(mesh.index);
    geometry.push(g);
  }
}

function riderMaterial() {
  if (material) return material;
  material = new THREE.MeshStandardNodeMaterial();
  const mask = attribute('mask', 'vec3'),
    finish = attribute('finish', 'vec3');
  const cloth = clothingSurface(
    attribute('riderColor', 'vec3'),
    attribute('riderAccent', 'vec3'),
    attribute('riderSkin', 'vec3'),
    attribute('riderFace', 'float'),
    mask.x,
    mask.y,
    finish.z,
  );
  material.colorNode = cloth.colorNode.mul(mix(vec3(1), attribute('riderHat', 'vec3'), mask.z));
  material.roughnessNode = finish.x.add(cloth.roughnessDelta);
  material.metalnessNode = finish.y;
  return material;
}

const appearances = new WeakMap<GuestLook, { paint: Float32Array; size: THREE.Vector3 }>();
function appearance(look: GuestLook) {
  let saved = appearances.get(look);
  if (!saved) {
    const jacket = new THREE.Color(look.jacket);
    const paint = new Float32Array(13);
    jacket.toArray(paint, 0);
    jacketAccent(jacket, new THREE.Color()).toArray(paint, 3);
    paint.set(look.skin, 6);
    new THREE.Color(look.hatColor).toArray(paint, 9);
    paint[12] = faceStyle(look.jacket, look.scale);
    saved = { paint, size: guestBuild(new THREE.Vector3(), look.jacket, look.hatColor, look.scale) };
    appearances.set(look, saved);
  }
  return saved;
}

export class SeatedRiders {
  readonly meshes: THREE.InstancedMesh[];
  private paints: THREE.InstancedInterleavedBuffer[] = [];
  private matrix = new THREE.Matrix4();

  constructor(capacity: number, parent: THREE.Group) {
    if (geometry.length !== 4) throw new Error('Load the chair passengers before building lifts');
    this.meshes = geometry.map((template, index) => {
      // A lift owns its instance attributes, but all lifts point to the same baked vertex buffers.
      const g = new THREE.BufferGeometry();
      g.setIndex(template.index);
      for (const [name, attr] of Object.entries(template.attributes)) g.setAttribute(name, attr);
      const paint = new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * 13), 13).setUsage(
        THREE.DynamicDrawUsage,
      );
      for (const [i, name] of ['riderColor', 'riderAccent', 'riderSkin', 'riderHat'].entries())
        g.setAttribute(name, new THREE.InterleavedBufferAttribute(paint, 3, i * 3));
      g.setAttribute('riderFace', new THREE.InterleavedBufferAttribute(paint, 1, 12));
      this.paints.push(paint);
      const m = new THREE.InstancedMesh(g, riderMaterial(), capacity);
      m.name = `chair-riders-${index < 2 ? 'helmet' : 'beanie'}-${index % 2 ? 'far' : 'near'}`;
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = index % 2 === 0;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parent.add(m);
      return m;
    });
  }

  begin() {
    for (const m of this.meshes) m.count = 0;
  }
  seat(look: GuestLook, position: THREE.Vector3, rotation: THREE.Quaternion, near: boolean) {
    const index = (look.hat === 'beanie' ? 2 : 0) + (near ? 0 : 1),
      mesh = this.meshes[index];
    const { paint, size } = appearance(look);
    mesh.setMatrixAt(mesh.count, this.matrix.compose(position, rotation, size));
    (this.paints[index].array as Float32Array).set(paint, mesh.count * 13);
    mesh.count++;
  }
  end() {
    for (const [i, m] of this.meshes.entries()) {
      m.visible = m.count > 0;
      if (m.visible) {
        m.instanceMatrix.needsUpdate = true;
        this.paints[i].needsUpdate = true;
      }
    }
  }
}
