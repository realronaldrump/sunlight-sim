/** Make a winter-clothed human from the CC0 MakeHuman/MPFB anatomical mesh.
 * Source and derived mesh are CC0. Original download stays in data/raw/.
 * Rebuild with npm run data:skier. No Blender, paid asset or account is needed.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const source = 'https://www.innerscene.com/api/library/human-base-mesh-with-editable-53-bone-rig-8e7c8ab1/download';
const rawPath = 'data/raw/characters/human-base-rigged.glb';
await mkdir('data/raw/characters', { recursive: true });
let raw: Buffer;
try { raw = await readFile(rawPath); } catch {
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Human source download: ${response.status}`);
  raw = Buffer.from(await response.arrayBuffer()); await writeFile(rawPath, raw);
}
const expectedHash = 'f3cd655e44af0a79786b1b4349c4acf1ae342fe6bd0d5fc714e68470dea1b429';
if (createHash('sha256').update(raw).digest('hex') !== expectedHash) throw new Error('Human source changed. Review its license and geometry before updating the pinned SHA-256.');
const gltf = await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, '');
gltf.scene.updateMatrixWorld(true);
let body!: THREE.SkinnedMesh;
gltf.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) body = o as THREE.SkinnedMesh; });
if (!body) throw new Error('Source must have an anatomical skinned mesh');
const g = body.geometry.clone();
// Source faces +Z. Game faces -Z. Scale to a 1.77 m adult before helmet and boots.
const conversion = new THREE.Matrix4().makeRotationY(Math.PI).scale(new THREE.Vector3(1.05, 1.05, 1.05));
g.applyMatrix4(conversion);
// The source splits vertices along UV seams. Average normals by position before padding clothing,
// otherwise equal positions inflate in different directions and create seams and faceted cloth.
function smoothNormals(geo: THREE.BufferGeometry) {
  geo.computeVertexNormals();
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
  const sums = new Map<string, THREE.Vector3>();
  const key = (i: number) => `${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`;
  for (let i = 0; i < p.count; i++) {
    const k = key(i), sum = sums.get(k) ?? new THREE.Vector3();
    sum.x += n.getX(i); sum.y += n.getY(i); sum.z += n.getZ(i); sums.set(k, sum);
  }
  for (const sum of sums.values()) sum.normalize();
  for (let i = 0; i < p.count; i++) { const v = sums.get(key(i))!; n.setXYZ(i, v.x, v.y, v.z); }
}
smoothNormals(g);
const p = g.getAttribute('position'), normal = g.getAttribute('normal');
const joints = g.getAttribute('skinIndex'), weights = g.getAttribute('skinWeight');
const names = body.skeleton.bones.map(b => b.name);
const color = new Float32Array(p.count * 3), jacket = new Float32Array(p.count), skin = new Float32Array(p.count), rough = new Float32Array(p.count);
const regions = new Uint8Array(p.count);
const v = new THREE.Vector3(), n = new THREE.Vector3();
const rgba = new THREE.Color();
for (let i = 0; i < p.count; i++) {
  v.fromBufferAttribute(p, i); n.fromBufferAttribute(normal, i);
  let max = -1, bone = '';
  for (let k = 0; k < 4; k++) if (weights.getComponent(i, k) > max) { max = weights.getComponent(i, k); bone = names[joints.getComponent(i, k)]; }
  const hand = /hand|index|middle|ring|pinky|thumb/.test(bone);
  const arm = /arm|clavicle/.test(bone);
  const face = !hand && !arm && v.y > 1.53;
  const neck = !hand && !arm && v.y > 1.48 && !face;
  const boot = !hand && !arm && v.y < 0.22;
  const coat = !face && !hand && !boot && (arm || v.y > 1.0);
  regions[i] = boot ? 0 : face ? 1 : hand ? 2 : coat ? 3 : 4;
  const noise = Math.sin(i * 12.9898 + v.x * 78.233) * 43758.5453;
  const grain = noise - Math.floor(noise);
  if (neck) {
    v.addScaledVector(n, 0.008 * Math.max(0, Math.min(1, (1.53 - v.y) / 0.025))); rgba.setRGB(0.025, 0.031, 0.038); rough[i] = 0.96;
  } else if (face) {
    // Natural skin shading over the anatomical face; cheeks/nose get a little cold-weather warmth.
    rgba.setRGB(0.70, 0.48, 0.34);
    const cheek = Math.exp(-((Math.abs(v.x) - 0.05) ** 2 / 0.001 + (v.y - 1.65) ** 2 / 0.001));
    rgba.r += cheek * 0.045; rgba.g -= cheek * 0.025;
    rgba.multiplyScalar(0.96 + grain * 0.07); skin[i] = 1; rough[i] = 0.76;
  } else if (hand) {
    // Insulated gloves follow the actual hands and fingers.
    v.addScaledVector(n, 0.006); rgba.setRGB(0.025, 0.03, 0.038); rough[i] = 0.82;
  } else if (coat) {
    // A loose technical shell: soften body contours under fabric, broaden the shoulders and cuffs.
    const collarFade = !arm ? Math.max(0.1, Math.min(1, (1.48 - v.y) / 0.08)) : 1;
    v.addScaledVector(n, (arm ? 0.037 : 0.045) * collarFade);
    if (!arm && Math.abs(v.x) < 0.21 && v.y < 1.40) {
      // Smooth the chest into the shell's oval section rather than exposing anatomical contours.
      const rx = 0.215 - Math.max(0, 1.22 - v.y) * 0.08;
      const rz = 0.135;
      const f = Math.sqrt((v.x / rx) ** 2 + ((v.z - 0.014) / rz) ** 2);
      if (f > 0.01 && f < 1) { v.x /= f; v.z = 0.014 + (v.z - 0.014) / f; }
    }
    // Small fabric folds follow the sleeve and waist, never change the body underneath.
    v.addScaledVector(n, Math.sin(v.y * 91 + v.x * 22) * Math.sin(v.z * 37) * 0.0028);
    const hem = Math.abs(v.y - 1.005) < 0.018;
    const sidePanel = !arm && Math.abs(v.x) > 0.17;
    const zip = !arm && Math.abs(v.x) < 0.006 && v.z < -0.09;
    const seam = !arm && Math.abs(Math.abs(v.x) - 0.115) < 0.003 && v.z < -0.07;
    const c = zip ? 0.032 : hem ? 0.18 : sidePanel ? 0.42 : seam ? 0.65 : 0.84 + grain * 0.08;
    rgba.setRGB(c, c, c); jacket[i] = zip ? 0 : 1; rough[i] = 0.91;
  } else {
    // Insulated ski pants, loose at thigh/knee and tucked into the boot cuff.
    const fold = Math.sin(v.y * 73 + v.x * 14) * Math.sin(v.z * 33) * 0.0035;
    v.addScaledVector(n, 0.031 + fold);
    rgba.setRGB(0.032, 0.044, 0.064).multiplyScalar(0.92 + grain * 0.16); rough[i] = 0.94;
  }
  p.setXYZ(i, v.x, v.y, v.z);
  color.set(rgba.toArray(), i * 3);
}
// Boots are purpose-built hard shells, so the feet are hidden rather than visible through them.
const indices: number[] = [];
for (let i = 0; i < g.index!.count; i += 3) {
  const a = g.index!.getX(i), b = g.index!.getX(i + 1), c = g.index!.getX(i + 2);
  if (regions[a] === 0 && regions[b] === 0 && regions[c] === 0) continue;
  indices.push(a, b, c);
}
g.setIndex(indices); smoothNormals(g);
const round = (a: ArrayLike<number>, digits = 5) => Array.from(a, x => +x.toFixed(digits));
const bones = body.skeleton.bones.map(b => {
  const m = new THREE.Matrix4().multiplyMatrices(conversion, b.matrixWorld);
  const pos = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3(); m.decompose(pos, q, scale);
  // Mesh vertices already carry the scale. Bone rest transforms must be rigid in the new coordinates.
  const bind = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
  return { name: b.name, parent: b.parent?.name ?? '', position: round(pos.toArray()), quaternion: round(q.toArray(), 7), inverse: round(bind.invert().elements, 8) };
});
const result = {
  version: 1, license: 'CC0-1.0', source, height: 1.77, bones,
  position: round(p.array), normal: round(g.getAttribute('normal').array), index: indices,
  skinIndex: Array.from(joints.array), skinWeight: round(weights.array),
  color: round(color, 4), jacket: Array.from(jacket), skin: Array.from(skin), roughness: round(rough, 3),
};
await mkdir('client/public/models', { recursive: true });
const encoded = gzipSync(JSON.stringify(result), { level: 9 });
await writeFile('client/public/models/skier-human.json.gz', encoded);
console.log(`CC0 winter human: ${p.count} vertices, ${indices.length / 3} triangles, ${bones.length} bones, ${(encoded.length / 1e6).toFixed(2)} MB compressed`);
