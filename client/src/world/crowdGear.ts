// The lift line, lodge and ski racks share equipment draws. Beyond 33 m the small buckles and
// seams disappear first; boots, skis, poles and headwear still have complete silhouettes.
import * as THREE from 'three/webgpu';
import { headwear } from '../skier/headwear';
import { jacketCollar, skiBoot, skiWithBindings, skiPole } from '../skier/skiEquipment';
import { mergeStatic } from './mergeStatic';

type GearKind = 'helmet' | 'beanie' | 'collar' | 'leftBoot' | 'rightBoot' | 'ski' | 'pole';
const white = new THREE.Color(0xffffff);

function distantGear(kind: GearKind) {
  const g = new THREE.Group();
  const mat = (color: number) => new THREE.MeshStandardNodeMaterial({ color, roughness: 0.74 });
  const add = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  if (kind === 'helmet' || kind === 'beanie') {
    const dye = mat(0xffffff);
    dye.userData.headwearTint = true;
    add(new THREE.SphereGeometry(1, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.6), dye, 0, 0.055, 0).scale.set(
      0.112,
      0.128,
      0.134,
    );
    if (kind === 'helmet') {
      add(new THREE.SphereGeometry(1, 12, 6), mat(0x867a71), 0, 0.035, -0.06).scale.set(0.115, 0.039, 0.087);
    } else {
      add(new THREE.CylinderGeometry(0.102, 0.105, 0.045, 12), dye, 0, 0.062, 0.005).scale.z = 1.2;
      add(new THREE.IcosahedronGeometry(0.026, 0), mat(0xd6c8b6), 0.007, 0.168, 0.019);
    }
  } else if (kind === 'leftBoot' || kind === 'rightBoot') {
    const boot = mat(0x394952);
    add(new THREE.SphereGeometry(1, 10, 6), boot, 0, -0.039, -0.054).scale.set(0.07, 0.065, 0.145);
    add(new THREE.CylinderGeometry(0.074, 0.067, 0.215, 10), boot, 0, 0.057, 0.011);
  } else if (kind === 'ski') {
    const shape = new THREE.Shape();
    shape.moveTo(0.76, 0);
    shape.lineTo(0.77, 0.038);
    shape.lineTo(0.66, 0.02);
    shape.lineTo(-0.68, 0.02);
    shape.quadraticCurveTo(-0.93, 0.072, -0.96, 0.121);
    shape.lineTo(-0.96, 0.103);
    shape.quadraticCurveTo(-0.9, 0.044, -0.68, 0.005);
    shape.lineTo(0.67, 0.005);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.092, bevelEnabled: false, curveSegments: 4 });
    geo.rotateY(-Math.PI / 2);
    geo.translate(0.046, 0, 0);
    add(geo, mat(0x3c6471), 0, 0, 0);
  } else if (kind === 'pole') {
    add(new THREE.CylinderGeometry(0.008, 0.005, 1.16, 5), mat(0x959da2), 0, 0, 0);
  }
  mergeStatic(g);
  return g;
}

export class CrowdGear {
  readonly group = new THREE.Group();
  private batches = new Map<string, { parts: THREE.InstancedMesh[]; count: number }>();

  constructor(capacity: number) {
    this.group.name = 'crowd-gear';
    const pieces = {
      helmet: headwear('helmet', white),
      beanie: headwear('beanie', white),
      leftBoot: skiBoot(-1),
      rightBoot: skiBoot(1),
      collar: jacketCollar(white).group,
      ski: skiWithBindings(),
      pole: skiPole(),
    };
    for (const kind of Object.keys(pieces) as GearKind[])
      for (const detail of [true, false]) {
        if (!detail && kind === 'collar') continue;
        const source = detail ? pieces[kind] : distantGear(kind);
        const count = capacity * (kind === 'ski' || kind === 'pole' ? 2 : 1);
        const parts = source.children.map((child) => {
          const m = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardNodeMaterial>;
          const mesh = new THREE.InstancedMesh(m.geometry, m.material, count);
          mesh.count = 0;
          mesh.frustumCulled = false;
          mesh.castShadow = detail;
          mesh.receiveShadow = true;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          if (m.material.userData.headwearTint || m.material.userData.jacketTint) {
            mesh.setColorAt(0, white);
            mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
          }
          this.group.add(mesh);
          return mesh;
        });
        this.batches.set(kind + detail, { parts, count: 0 });
      }
  }

  begin() {
    for (const batch of this.batches.values()) batch.count = 0;
  }
  push(kind: GearKind, world: THREE.Matrix4, detail: boolean, color?: THREE.Color) {
    const batch = this.batches.get(kind + detail)!;
    if (batch.count >= batch.parts[0].instanceMatrix.count) return;
    for (const mesh of batch.parts) {
      mesh.setMatrixAt(batch.count, world);
      if (mesh.instanceColor) mesh.setColorAt(batch.count, color ?? white);
    }
    batch.count++;
  }
  end() {
    for (const { parts, count } of this.batches.values())
      for (const mesh of parts) {
        mesh.count = count;
        mesh.visible = count > 0;
        if (count) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      }
  }
}
