// Opaque static architecture needs its exact silhouette in a sun map. Paint, normal maps and
// separate timber/metal finishes can share that draw. Moving wheels and cutout materials keep
// their own shadow geometry.
import * as THREE from 'three/webgpu';

const originals = new WeakSet<THREE.Object3D>();
const batches = new WeakMap<THREE.Object3D, THREE.Mesh[]>();
const shadowMaterials = new Map<string, THREE.MeshBasicNodeMaterial>();
const CELL = 96;

export function batchStaticShadows(root: THREE.Object3D) {
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert(), transform = new THREE.Matrix4();
  const groups = new Map<string, { vertices: number[]; material: THREE.MeshBasicNodeMaterial }>();
  const vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const visit = (obj: THREE.Object3D) => {
    if (!obj.visible || obj.userData.spin) return;
    const m = obj as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardNodeMaterial>;
    if (m.isMesh && m.castShadow && !(obj instanceof THREE.InstancedMesh) && !Array.isArray(m.material)) {
      const mat = m.material;
      if (!mat.transparent && !mat.alphaTest && !mat.alphaMap && !mat.displacementMap && !mat.positionNode &&
          !mat.castShadowNode && !mat.maskShadowNode && !mat.alphaToCoverage) {
        const side = mat.side + '/' + mat.shadowSide;
        let material = shadowMaterials.get(side);
        if (!material) {
          material = new THREE.MeshBasicNodeMaterial({ side: mat.side });
          material.shadowSide = mat.shadowSide;
          shadowMaterials.set(side, material);
        }
        transform.multiplyMatrices(inv, m.matrixWorld);
        const g = m.geometry, pos = g.getAttribute('position'), index = g.index;
        const end = Math.min(index?.count ?? pos.count, g.drawRange.start + g.drawRange.count);
        for (let i = g.drawRange.start; i + 2 < end; i += 3) {
          for (let j = 0; j < 3; j++) vertices[j].fromBufferAttribute(pos, index ? index.getX(i + j) : i + j).applyMatrix4(transform);
          const [a, b, c] = vertices;
          const key = `${side}/${Math.floor((a.x + b.x + c.x) / (3 * CELL))}/${Math.floor((a.z + b.z + c.z) / (3 * CELL))}`;
          let group = groups.get(key);
          if (!group) groups.set(key, group = { vertices: [], material });
          group.vertices.push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z);
        }
        originals.add(m);
      }
    }
    for (const child of obj.children) visit(child);
  };
  visit(root);
  batches.set(root, [...groups.values()].map(({ vertices, material }) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'static shadow'; mesh.castShadow = true; mesh.matrixWorld = root.matrixWorld;
    return mesh;
  }));
}

export const hasBatchedShadow = (object: THREE.Object3D) => originals.has(object);
export const staticShadowsFor = (root: THREE.Object3D) => batches.get(root);
