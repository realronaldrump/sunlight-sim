// The ordinary front-sided snow material casts its back faces into the directional shadow map.
// Submit those faces and a conservative margin around grazing incidence, keeping every skirt.
import * as THREE from 'three/webgpu';
import type { TerrainPage } from './terrainPages';

const STEPS = 32;
const CURVATURE_MARGIN = .002; // slope change from viewer-relative curvature within 8 km

export class TerrainChunkMesh extends THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  readonly vertices: number;
  readonly farMaterial: THREE.Material;
  vertexOffset = 0;
  page?: TerrainPage;
  hiddenByTerrain = false;
  private minima?: Float32Array;
  private shadowMesh?: THREE.Mesh;
  private lastDirection = -1;

  constructor(geometry: THREE.BufferGeometry, materials: [THREE.Material, THREE.Material], private cells: number, readonly x: number, readonly z: number, readonly size: number) {
    super(geometry, materials[0]);
    this.farMaterial = materials[1];
    this.vertices = geometry.getAttribute('position').count;
  }

  usePage(page: TerrainPage, offset: number, index: THREE.BufferAttribute) {
    const shape = this.geometry;
    this.disposeShadow();
    if (this.page) this.page.releaseMember();
    else {
      // Release the original private vertex buffers. All four chunks now point into one buffer.
      for (const attr of Object.values(shape.attributes)) (attr as THREE.BufferAttribute).dispose();
    }
    this.page = page; this.vertexOffset = offset;
    for (const [name, attr] of Object.entries(page.mesh.geometry.attributes)) shape.setAttribute(name, attr);
    shape.setIndex(index);
  }

  private disposeShadow() {
    if (!this.shadowMesh) return;
    const g = this.shadowMesh.geometry;
    for (const key of Object.keys(g.attributes)) g.deleteAttribute(key); // borrowed vertex data
    g.dispose();
    this.shadowMesh.dispose();
    this.shadowMesh = undefined;
    this.lastDirection = -1;
  }

  release() {
    this.disposeShadow();
    this.geometry.setIndex(null); // shared topology
    if (this.page) {
      for (const key of Object.keys(this.geometry.attributes)) this.geometry.deleteAttribute(key);
      this.page.releaseMember();
      this.page = undefined;
    }
    this.geometry.dispose();
    this.dispose();
  }

  /** A lower bound across the entire 32 m square, even if the underlying DEM is coarser. */
  minimumAt(x: number, north: number) {
    const spacing = this.size / this.cells, block = Math.max(32, spacing);
    const side = this.size / block;
    if (!this.minima) {
      const pos = this.geometry.getAttribute('position'), step = block / spacing;
      this.minima = new Float32Array(side * side);
      for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
        let low = Infinity;
        for (let y = 0; y <= step; y++) {
          const start = this.vertexOffset + (j * step + y) * (this.cells + 1) + i * step;
          for (let k = 0; k <= step; k++) low = Math.min(low, pos.getY(start + k));
        }
        this.minima[j * side + i] = low;
      }
    }
    return this.minima[Math.floor(north / block) * side + Math.floor(x / block)];
  }

  heightAt(x: number, z: number) {
    const gx = (x - this.x) * this.cells / this.size, gy = (this.z - z) * this.cells / this.size;
    const i = Math.min(this.cells - 1, Math.max(0, Math.floor(gx))), j = Math.min(this.cells - 1, Math.max(0, Math.floor(gy)));
    const a = this.vertexOffset + j * (this.cells + 1) + i, d = a + this.cells + 1, u = gx - i, v = gy - j;
    const pos = this.geometry.getAttribute('position');
    const ha = pos.getY(a), hb = pos.getY(a + 1), hc = pos.getY(d + 1), hd = pos.getY(d);
    return u >= v ? ha + (hb - ha) * u + (hc - hb) * v : ha + (hc - hd) * u + (hd - ha) * v;
  }

  caster(sun: THREE.Vector3, viewer: THREE.Vector3) {
    const shape = this.geometry, pos = shape.getAttribute('position'), source = shape.index!;
    const size = this.size;
    if (Math.abs(this.x + size / 2 - viewer.x) > 8000 || Math.abs(this.z - size / 2 - viewer.z) > 8000) return this;
    const sx = Math.round(sun.x * STEPS), sy = Math.round(sun.y * STEPS), sz = Math.round(sun.z * STEPS);
    const key = ((sx + STEPS) * 65 + sy + STEPS) * 65 + sz + STEPS;
    if (!this.shadowMesh) {
      const g = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(shape.attributes)) g.setAttribute(name, attr);
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(source.count), 1));
      g.boundingSphere = shape.boundingSphere;
      const proxy = this.shadowMesh = new THREE.Mesh(g, this.material);
      proxy.castShadow = true;
      proxy.name = 'terrain shadow';
      // These two draws represent the same chunk, in different render passes.
      proxy.matrixWorld = this.matrixWorld;
    }
    if (key !== this.lastDirection) {
      this.lastDirection = key;
      const g = this.shadowMesh.geometry, index = g.index!, out = index.array;
      const stride = this.cells + 1, spacing = size / this.cells;
      const margin = STEPS * CURVATURE_MARGIN;
      let count = 0;
      const keep = (dx: number, dn: number) =>
        sy * spacing - sx * dx + sz * dn <= .5 * (spacing + Math.abs(dx) + Math.abs(dn)) + margin * spacing;
      for (let row = 0; row < this.cells; row++) for (let col = 0; col < this.cells; col++) {
        const a = this.vertexOffset + row * stride + col, b = a + 1, d = a + stride, c = d + 1;
        const ha = pos.getY(a), hb = pos.getY(b), hc = pos.getY(c), hd = pos.getY(d);
        if (keep(hb - ha, hc - hb)) { out[count++] = a; out[count++] = b; out[count++] = c; }
        if (keep(hc - hd, hd - ha)) { out[count++] = a; out[count++] = c; out[count++] = d; }
      }
      const skirt = source.array.subarray(this.cells * this.cells * 6);
      out.set(skirt, count);
      count += skirt.length;
      index.clearUpdateRanges(); index.addUpdateRange(0, count); index.needsUpdate = true;
      g.setDrawRange(0, count);
    }
    return this.shadowMesh;
  }
}
