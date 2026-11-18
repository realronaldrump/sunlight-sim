// Four neighboring DEM chunks share one set of vertices. A four-bit mask selects exactly
// the chunks visible in the player view. Individual chunks still have their own shadow draws.
import * as THREE from 'three/webgpu';
import type { TerrainChunkMesh } from './terrainShadows';

const indices = new Map<number, THREE.BufferAttribute>();
function selectedIndex(mask: number, topology: THREE.BufferAttribute, vertices: number) {
  let index = indices.get(mask);
  if (!index) {
    const slots = [0, 1, 2, 3].filter(i => mask & (1 << i));
    const data = new Uint16Array(slots.length * topology.count);
    for (const [j, slot] of slots.entries()) {
      for (let k = 0; k < topology.count; k++) data[j * topology.count + k] = topology.getX(k) + slot * vertices;
    }
    index = new THREE.BufferAttribute(data, 1);
    indices.set(mask, index);
  }
  return index;
}

/** All fragments must lie beyond the original snow relief and glint fade distances. */
export function snowMaterialFor(bounds: THREE.Box3, viewer: THREE.Vector3, close: THREE.Material, far: THREE.Material) {
  const dx = Math.max(bounds.min.x - viewer.x, 0, viewer.x - bounds.max.x);
  const dz = Math.max(bounds.min.z - viewer.z, 0, viewer.z - bounds.max.z);
  return dx * dx + dz * dz > 64 * 64 ? far : close;
}

export class TerrainPage {
  readonly mesh: THREE.Mesh;
  private owners = 4;
  constructor(readonly chunks: TerrainChunkMesh[], private topology: THREE.BufferAttribute) {
    const vertices = chunks[0].vertices, stride = 8;
    const data = new Float32Array(4 * vertices * stride);
    const g = new THREE.BufferGeometry(), bounds = new THREE.Box3();
    for (const [slot, c] of chunks.entries()) {
      const shape = c.geometry, p = shape.getAttribute('position'), n = shape.getAttribute('normal'), uv = shape.getAttribute('grooming');
      let dst = slot * vertices * stride;
      for (let v = c.vertexOffset; v < c.vertexOffset + vertices; v++) {
        data[dst++] = p.getX(v); data[dst++] = p.getY(v); data[dst++] = p.getZ(v);
        data[dst++] = n.getX(v); data[dst++] = n.getY(v); data[dst++] = n.getZ(v);
        data[dst++] = uv.getX(v); data[dst++] = uv.getY(v);
      }
      bounds.union(shape.boundingBox!);
    }
    const interleaved = new THREE.InterleavedBuffer(data, stride);
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
    g.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleaved, 3, 3));
    g.setAttribute('grooming', new THREE.InterleavedBufferAttribute(interleaved, 2, 6));
    g.boundingBox = bounds; g.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
    this.mesh = new THREE.Mesh(g, chunks[0].material);
    this.mesh.name = 'terrain page';
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; // every included chunk was individually tested
    this.mesh.matrixWorld = chunks[0].matrixWorld;
    for (const [slot, c] of chunks.entries()) {
      c.usePage(this, slot * vertices, selectedIndex(1 << slot, topology, vertices));
    }
  }

  releaseMember() {
    if (--this.owners === 0) {
      this.mesh.geometry.setIndex(null); // visibility masks are shared across pages
      this.mesh.geometry.dispose();
      this.mesh.dispose();
    }
  }

  select(mask: number, viewer: THREE.Vector3) {
    this.mesh.material = snowMaterialFor(this.mesh.geometry.boundingBox!, viewer, this.chunks[0].material, this.chunks[0].farMaterial);
    this.mesh.geometry.setIndex(selectedIndex(mask, this.topology, this.chunks[0].vertices));
    return this.mesh;
  }
}

export class TerrainGroup extends THREE.Group {
  batches: (TerrainChunkMesh | TerrainChunkMesh[])[] = [];
  constructor(readonly topology: THREE.BufferAttribute) { super(); this.name = 'terrain'; }

  regroup() {
    const regions = new Map<string, TerrainChunkMesh[]>();
    this.batches = [];
    for (const obj of this.children) {
      const c = obj as TerrainChunkMesh;
      const key = `${c.userData.level}/${Math.floor(c.x / (2 * c.size))}/${Math.floor(-c.z / (2 * c.size))}`;
      let group = regions.get(key);
      if (!group) regions.set(key, group = []);
      group.push(c);
    }
    for (const chunks of regions.values()) {
      if (chunks.length === 4 && chunks.every(c => c.material === chunks[0].material && c.farMaterial === chunks[0].farMaterial)) {
        chunks.sort((a, b) => b.z - a.z || a.x - b.x);
        this.batches.push(chunks);
      } else this.batches.push(...chunks);
    }
  }
}
