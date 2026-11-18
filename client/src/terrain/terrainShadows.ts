// The ordinary front-sided snow material casts its back faces into the directional shadow map.
// Submit those faces and a conservative margin around grazing incidence, keeping every skirt.
import * as THREE from 'three/webgpu';

const STEPS = 32;
const CURVATURE_MARGIN = .002; // slope change from viewer-relative curvature within 8 km

export class TerrainChunkMesh extends THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  private shadowMesh?: THREE.Mesh;
  private lastDirection = -1;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, private cells: number) {
    super(geometry, material);
  }

  caster(sun: THREE.Vector3, viewer: THREE.Vector3) {
    const shape = this.geometry, pos = shape.getAttribute('position'), source = shape.index!;
    const size = pos.getX(this.cells);
    if (Math.abs(this.position.x + size / 2 - viewer.x) > 8000 || Math.abs(this.position.z - size / 2 - viewer.z) > 8000) return this;
    const sx = Math.round(sun.x * STEPS), sy = Math.round(sun.y * STEPS), sz = Math.round(sun.z * STEPS);
    const key = ((sx + STEPS) * 65 + sy + STEPS) * 65 + sz + STEPS;
    if (!this.shadowMesh) {
      const g = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(shape.attributes)) g.setAttribute(name, attr);
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(source.count), 1).setUsage(THREE.DynamicDrawUsage));
      g.boundingSphere = shape.boundingSphere;
      const proxy = this.shadowMesh = new THREE.Mesh(g, this.material);
      proxy.castShadow = true;
      proxy.name = 'terrain shadow';
      // These two draws represent the same chunk, in different render passes.
      proxy.matrixWorld = this.matrixWorld;
      shape.addEventListener('dispose', () => g.dispose());
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
        const a = row * stride + col, b = a + 1, d = a + stride, c = d + 1;
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
