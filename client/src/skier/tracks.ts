// Ski tracks: two ribbons pressed into the snow behind each ski, fading over time.
import * as THREE from 'three/webgpu';

const MAX = 1600; // segments per ribbon

export class SkiTracks {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private head = 0;
  private count = 0;
  private last: THREE.Vector3[] | null = null;
  private geo: THREE.BufferGeometry;

  constructor() {
    // each segment = 2 ribbons x quad (4 verts, 6 idx), stored as non-indexed triangles (12 verts)
    this.pos = new Float32Array(MAX * 12 * 3);
    this.col = new Float32Array(MAX * 12 * 4);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshBasicNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, color: 0x8ea3c2 });
    mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Add the current ski positions (left, right) on the snow; call while skiing on the ground. */
  add(left: THREE.Vector3, right: THREE.Vector3, dir: THREE.Vector3, width: number, strength: number) {
    if (!this.last) { this.last = [left.clone(), right.clone()]; return; }
    if (left.distanceTo(this.last[0]) < 0.6) return;
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(width / 2);
    const quads: [THREE.Vector3, THREE.Vector3][] = [[this.last[0], left], [this.last[1], right]];
    let o = this.head * 12;
    for (const [a, b] of quads) {
      const p = [a.clone().sub(side), a.clone().add(side), b.clone().add(side), b.clone().sub(side)];
      for (const q of p) q.y += 0.02;
      for (const k of [0, 1, 2, 0, 2, 3]) {
        this.pos[o * 3] = p[k].x; this.pos[o * 3 + 1] = p[k].y; this.pos[o * 3 + 2] = p[k].z;
        this.col[o * 4] = 1; this.col[o * 4 + 1] = 1; this.col[o * 4 + 2] = 1; this.col[o * 4 + 3] = 0.32 * strength;
        o++;
      }
    }
    this.head = (this.head + 1) % MAX;
    this.count = Math.min(MAX, this.count + 1);
    this.last = [left.clone(), right.clone()];
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('color').needsUpdate = true;
  }

  break() { this.last = null; }

  /** Slowly fade old segments. */
  fade(dt: number) {
    const k = Math.exp(-dt / 90);
    for (let i = 3; i < this.col.length; i += 4) this.col[i] *= k;
    this.geo.getAttribute('color').needsUpdate = true;
  }
}
