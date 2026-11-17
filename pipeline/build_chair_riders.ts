/** Pose the actual crowd rig on a seat and make two detail levels for each kind of headwear.
 * Only the build runs skinning and simplification. Each lift shares the resulting static buffers.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { prepareHumanAsset } from '../client/src/skier/humanBody';
import { SkierModel } from '../client/src/skier/skierModel';
import type { Hat } from '../client/src/skier/headwear';
import { RIDER_ROOT_BELOW_SEAT, RIDER_ROOT_FORWARD } from '../shared/lifts';

prepareHumanAsset(
  JSON.parse(gunzipSync(await readFile('client/public/models/skier-human-crowd.json.gz')).toString()),
);
await MeshoptSimplifier.ready;

function posedRider(hat: Hat) {
  const model = new SkierModel();
  model.dress({ jacket: 0xffffff, skin: [1, 1, 1], hatColor: 0xffffff, hat, scale: 1 });
  model.update({
    speed: 0,
    edge: 0,
    plow: 0,
    tuck: 0,
    skid: 0,
    fallen: 0,
    sitting: 1,
    time: 0,
    pushing: false,
  });
  model.root.position.set(0, -RIDER_ROOT_BELOW_SEAT, -RIDER_ROOT_FORWARD);
  model.root.updateMatrixWorld(true);
  const positions: number[] = [],
    normals: number[] = [],
    paints: number[] = [],
    surfaces: number[] = [],
    indices: number[] = [];
  model.root.traverseVisible((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const m = o as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardNodeMaterial>;
    const skinned = m as THREE.SkinnedMesh;
    const geo = m.geometry,
      mat = m.material,
      offset = positions.length / 3;
    const p = new THREE.Vector3(),
      n = new THREE.Vector3(),
      c = new THREE.Color();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    for (let i = 0; i < geo.attributes.position.count; i++) {
      p.fromBufferAttribute(geo.attributes.position, i);
      n.fromBufferAttribute(geo.attributes.normal, i);
      if (skinned.isSkinnedMesh) {
        // Transform both ends of a normal by the same blend of bone matrices.
        skinned.applyBoneTransform(i, n.add(p));
        skinned.applyBoneTransform(i, p);
        n.sub(p);
      }
      p.applyMatrix4(m.matrixWorld);
      n.applyNormalMatrix(normalMatrix);
      positions.push(...p.toArray());
      normals.push(...n.toArray());
      c.copy(mat.color);
      if (geo.attributes.color) c.multiply(new THREE.Color().fromBufferAttribute(geo.attributes.color, i));
      paints.push(...c.toArray());
      surfaces.push(
        skinned.isSkinnedMesh ? geo.attributes.uv.getX(i) : 0,
        skinned.isSkinnedMesh ? geo.attributes.uv.getY(i) : 0,
        geo.attributes.jacket?.getX(i) ?? Number(!!mat.userData.jacketTint),
        geo.attributes.skinTone?.getX(i) ?? 0,
        Number(!!mat.userData.headwearTint),
        geo.attributes.roughness?.getX(i) ?? mat.roughness,
        mat.metalness,
        Number(!!skinned.isSkinnedMesh),
      );
    }
    for (let i = 0; i < (geo.index?.count ?? geo.attributes.position.count); i++)
      indices.push(offset + (geo.index?.getX(i) ?? i));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(paints, 3));
  // mergeVertices hashes up to four components per attribute.
  const uvMasks: number[] = [],
    finish: number[] = [];
  for (let i = 0; i < surfaces.length; i += 8) {
    uvMasks.push(...surfaces.slice(i, i + 4));
    finish.push(...surfaces.slice(i + 4, i + 8));
  }
  g.setAttribute('uvMasks', new THREE.Float32BufferAttribute(uvMasks, 4));
  g.setAttribute('finish', new THREE.Float32BufferAttribute(finish, 4));
  g.setIndex(indices);
  return mergeVertices(g, 0.0001);
}

function simplify(g: THREE.BufferGeometry, near: boolean) {
  const p = g.attributes.position,
    indices = new Uint32Array(g.index!.array);
  const attrs = new Float32Array(p.count * 11);
  for (let i = 0; i < p.count; i++) {
    let a = i * 11;
    for (const name of ['color', 'uvMasks', 'finish']) {
      const attr = g.attributes[name];
      for (let k = 0; k < attr.itemSize; k++) attrs[a++] = attr.getComponent(i, k);
    }
  }
  const [ids] = MeshoptSimplifier.simplifyWithAttributes(
    indices,
    new Float32Array(p.array),
    3,
    attrs,
    11,
    [0.28, 0.28, 0.28, near ? 0.55 : 0.13, near ? 0.55 : 0.13, 0.7, 0.7, 0.7, 0.1, 0.1, 0.7],
    null,
    (near ? 8400 : 1050) * 3,
    near ? 0.018 : 0.12,
    ['Permissive', 'Prune'],
  );
  const [remap, count] = MeshoptSimplifier.compactMesh(ids);
  const vertices = new Array<number>(count * 17);
  for (let i = 0; i < remap.length; i++) {
    if (remap[i] === 0xffffffff) continue;
    let o = remap[i] * 17;
    for (const name of ['position', 'normal', 'color', 'uvMasks', 'finish']) {
      const attr = g.attributes[name];
      for (let k = 0; k < attr.itemSize; k++) vertices[o++] = +attr.getComponent(i, k).toFixed(5);
    }
  }
  console.log(`${near ? 'Near' : 'Far'} seated skier: ${ids.length / 3} triangles, ${count} vertices`);
  return { vertices, index: Array.from(ids) };
}

const meshes = [];
for (const kind of ['helmet', 'beanie'] as const) {
  const geometry = posedRider(kind);
  meshes.push(simplify(geometry, true), simplify(geometry, false));
}
const file = gzipSync(JSON.stringify({ version: 1, meshes }), { level: 9 });
await writeFile('client/src/skier/assets/chair-riders.json.gz', file);
console.log(`Seat atlas: ${file.length.toLocaleString()} bytes`);
