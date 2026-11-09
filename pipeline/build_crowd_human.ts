// Crowd level of detail for the CC0 winter human: the same rig, skin weights and clothing attributes
// with about a seventh of the triangles, for the dozens of people around the base area.
// Input: client/public/models/skier-human.json.gz (from build_skier.ts). Output: skier-human-crowd.json.gz.
// Run: npm run data:crowd
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { MeshoptSimplifier } from 'meshoptimizer';

const TARGET_TRIANGLES = 12000;
const src = JSON.parse(gunzipSync(await readFile('client/public/models/skier-human.json.gz')).toString());
await MeshoptSimplifier.ready;
const positions = new Float32Array(src.position);
const vertexCount = positions.length / 3;
const indices = new Uint32Array(src.index);
// Colour and clothing region weigh in so seams between jacket, skin and trousers survive.
const attrStride = 5;
const attrs = new Float32Array(vertexCount * attrStride);
for (let i = 0; i < vertexCount; i++) {
  attrs[i * 5] = src.color[i * 3]; attrs[i * 5 + 1] = src.color[i * 3 + 1]; attrs[i * 5 + 2] = src.color[i * 3 + 2];
  attrs[i * 5 + 3] = src.jacket[i]; attrs[i * 5 + 4] = src.skin[i];
}
const [simplified, error] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attrs, attrStride,
  [0.5, 0.5, 0.5, 1, 1], null, TARGET_TRIANGLES * 3, 0.01, []);
// keep only the vertices that are still referenced
const remap = new Int32Array(vertexCount).fill(-1);
const order: number[] = [];
const index = Array.from(simplified, (v) => { if (remap[v] < 0) { remap[v] = order.length; order.push(v); } return remap[v]; });
const pick = (a: number[], n: number) => order.flatMap((v) => a.slice(v * n, v * n + n));
const out = {
  ...src,
  lod: 'crowd', sourceTriangles: indices.length / 3, simplificationError: +error.toFixed(5),
  position: pick(src.position, 3), normal: pick(src.normal, 3), index,
  skinIndex: pick(src.skinIndex, 4), skinWeight: pick(src.skinWeight, 4),
  color: pick(src.color, 3), jacket: pick(src.jacket, 1), skin: pick(src.skin, 1), roughness: pick(src.roughness, 1),
};
const encoded = gzipSync(JSON.stringify(out), { level: 9 });
await writeFile('client/public/models/skier-human-crowd.json.gz', encoded);
console.log(`Crowd human: ${order.length} vertices, ${index.length / 3} triangles (from ${indices.length / 3}), error ${error.toFixed(4)}, ${(encoded.length / 1e6).toFixed(2)} MB`);
