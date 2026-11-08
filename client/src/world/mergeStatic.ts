// Merge static meshes under a group into one mesh per material (fewer draw calls). Meshes with
// material arrays, instanced meshes, sprites and objects flagged userData.keep are left alone.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mergeStatic(root: THREE.Object3D, opts: { castShadow?: boolean; receiveShadow?: boolean } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const remove: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material) || m.userData.keep) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const mat = m.material as THREE.Material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat)!.push(g);
    remove.push(m);
  });
  for (const m of remove) m.parent?.remove(m);
  let n = 0;
  for (const [mat, geos] of byMat) {
    // color attribute must be all-or-nothing within a merge
    const withColor = geos.filter((g) => g.getAttribute('color')), without = geos.filter((g) => !g.getAttribute('color'));
    for (const set of [withColor, without]) {
      if (!set.length) continue;
      const merged = mergeGeometries(set);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      root.add(mesh);
      n++;
    }
  }
  return n;
}
