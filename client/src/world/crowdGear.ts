// Shared, instanced ski gear for crowds. Every NPC's helmet or beanie, boots, skis and poles are drawn
// by a handful of InstancedMeshes (one per accessory material) instead of ~60 meshes per person.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { helmetAndGoggles, skiBoot, skiWithBindings, skiPole } from '../skier/skiEquipment';

export type GearKind = 'helmet' | 'beanie' | 'boot' | 'ski' | 'pole';

function beanieGroup() {
  const g = new THREE.Group();
  const knit = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 1 });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), knit);
  cap.scale.set(1, 1.05, 1.12); cap.position.set(0, 0.025, 0.01); g.add(cap);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.106, 0.108, 0.045, 18, 1, true), knit);
  cuff.position.set(0, 0, 0.01); cuff.scale.z = 1.12; g.add(cuff);
  const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035, 1), knit);
  pom.position.set(0, 0.135, 0.01); g.add(pom);
  return g;
}

/** Merge a group's meshes into one geometry per material, in the group's local frame. */
function template(group: THREE.Object3D) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const mat = m.material as THREE.Material;
    let a = byMat.get(mat); if (!a) byMat.set(mat, a = []); a.push(g);
  });
  const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  for (const [mat, geos] of byMat) {
    const withColor = geos.filter((g) => g.getAttribute('color')), plain = geos.filter((g) => !g.getAttribute('color'));
    for (const set of [withColor, plain]) if (set.length) parts.push({ geo: mergeGeometries(set)!, mat });
  }
  return parts;
}

export class CrowdGear {
  readonly group = new THREE.Group();
  private meshes = new Map<GearKind, THREE.InstancedMesh[]>();
  private counts = new Map<GearKind, number>();

  constructor(capacity: number) {
    this.group.name = 'crowd-gear';
    const sources: Record<GearKind, THREE.Object3D> = { helmet: helmetAndGoggles(), beanie: beanieGroup(), boot: skiBoot(), ski: skiWithBindings(), pole: skiPole() };
    const per: Record<GearKind, number> = { helmet: 1, beanie: 1, boot: 2, ski: 2, pole: 2 };
    for (const kind of Object.keys(sources) as GearKind[]) {
      const list: THREE.InstancedMesh[] = [];
      for (const [i, part] of template(sources[kind]).entries()) {
        // the tinted shell/knit starts white so per-person colours read true
        const mat = i === 0 && (kind === 'helmet' || kind === 'beanie') ? (() => { const m = (part.mat as THREE.MeshStandardNodeMaterial).clone(); m.color.set(0xffffff); return m; })() : part.mat;
        const mesh = new THREE.InstancedMesh(part.geo, mat, capacity * per[kind]);
        mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
        list.push(mesh); this.group.add(mesh);
      }
      this.meshes.set(kind, list);
    }
  }

  begin() { for (const k of this.meshes.keys()) this.counts.set(k, 0); }

  push(kind: GearKind, world: THREE.Matrix4, color?: THREE.Color) {
    const list = this.meshes.get(kind)!, i = this.counts.get(kind)!;
    if (i >= list[0].instanceMatrix.count) return;
    for (const m of list) {
      m.setMatrixAt(i, world);
      // the tint only applies to the shell/knit (first part); goggles and buckles keep their colours
      if (color && m === list[0]) m.setColorAt(i, color);
      else if (m.instanceColor) m.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    this.counts.set(kind, i + 1);
  }

  end() {
    for (const [k, list] of this.meshes) {
      const n = this.counts.get(k)!;
      for (const m of list) { m.count = n; m.visible = n > 0; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    }
  }
}
