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
const lipColor = new THREE.Color(.43, .135, .115);
const bell = (distance: number, width: number) => Math.exp(-((distance / width) ** 2));
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
    // Warm the cheeks, ear rims and nose. Shade the lips and sockets on the actual face.
    const ax = Math.abs(v.x), front = THREE.MathUtils.smoothstep(-v.z, .06, .115);
    const cheeks = bell(ax - .053, .028) * bell(v.y - 1.625, .024) * front;
    const nose = bell(v.x, .019) * bell(v.y - 1.62, .022) * front;
    const ears = bell(ax - .084, .013) * bell(v.y - 1.632, .033);
    const lips = bell(v.x, .024) * bell(v.y - (1.577 + .002 * Math.cos(v.x * 130)), .007) * front;
    const socket = bell(ax - .035, .024) * bell(v.y - 1.654, .012) * front;
    const warmth = cheeks + nose * .75 + ears * .6;
    rgba.setRGB(.66 + warmth * .064, .405 - warmth * .045, .284 - warmth * .018);
    rgba.lerp(lipColor, lips * .87);
    rgba.multiplyScalar((1 - .24 * socket) * (.98 + grain * .035));
    skin[i] = 1; rough[i] = .7 - lips * .17 - nose * .10;
  } else if (hand) {
    // Insulated gloves follow the actual hands and fingers.
    v.addScaledVector(n, .0065); rgba.setRGB(.043, .050, .061); rough[i] = .72;
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
    // Gather the shell at the waist and elbow. The atlas supplies the unbroken zipper and seams.
    const compression = arm ? bell(v.y - 1.21, .088) : bell(v.y - 1.058, .062);
    v.addScaledVector(n, Math.sin(v.y * 101 + Math.abs(v.x) * 28 + v.z * 32) * (.0016 + .0058 * compression));
    const hem = !arm ? bell(v.y - 1.01, .017) : 0;
    v.addScaledVector(n, .007 * hem);
    const c = .91 - hem * .13 + grain * .015;
    rgba.setRGB(c, c, c); jacket[i] = 1; rough[i] = .79 + .07 * compression;
  } else {
    // Insulated ski pants, loose at thigh/knee and tucked into the boot cuff.
    const gathered = bell(v.y - .29, .065) + .65 * bell(v.y - .525, .079);
    const fold = Math.sin(v.y * 93 + Math.abs(v.x) * 24 + v.z * 32) * (.0016 + .006 * gathered);
    v.addScaledVector(n, .034 + fold);
    rgba.setRGB(.057, .073, .089).multiplyScalar(.97 + grain * .05); rough[i] = .89;
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
  uv: round(g.getAttribute('uv').array),
  position: round(p.array), normal: round(g.getAttribute('normal').array), index: indices,
  skinIndex: Array.from(joints.array), skinWeight: round(weights.array),
  color: round(color, 4), jacket: Array.from(jacket), skin: Array.from(skin), roughness: round(rough, 3),
};
await mkdir('client/public/models', { recursive: true });
const encoded = gzipSync(JSON.stringify(result), { level: 9 });
await writeFile('client/public/models/skier-human.json.gz', encoded);
console.log(`CC0 winter human: ${p.count} vertices, ${indices.length / 3} triangles, ${bones.length} bones, ${(encoded.length / 1e6).toFixed(2)} MB compressed`);
