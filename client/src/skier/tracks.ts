// Connected, terrain-conforming ski grooves with feathered shoulders and kicked-up snow.
import * as THREE from 'three/webgpu';
import { SnowSpray } from './snowSpray';

const MAX = 1800;
const PROFILE = [0, 0.12, 0.25, 0.5, 0.75, 0.88, 1];
const ROWS = PROFILE.length;
const VERTS = ROWS * 4; // two skis, start/end cross sections
const INDICES = (ROWS - 1) * 12;
interface Section { centers: THREE.Vector3[]; side: THREE.Vector3; width: number; strength: number }

export class SkiTracks {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(MAX * VERTS * 3);
  private col = new Float32Array(MAX * VERTS * 4);
  private normal = new Float32Array(MAX * VERTS * 3);
  private head = 0;
  private count = 0;
  private last: Section | null = null;
  private geo = new THREE.BufferGeometry();
  private spray = new SnowSpray();
  private elapsed = 0;

  constructor(private heightAt?: (x: number, z: number) => number) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.normal, 3).setUsage(THREE.DynamicDrawUsage));
    const indices = new Uint32Array(MAX * INDICES);
    let index = 0;
    for (let seg = 0; seg < MAX; seg++) for (let ski = 0; ski < 2; ski++) {
      const base = seg * VERTS + ski * ROWS * 2;
      for (let j = 0; j < ROWS - 1; j++) {
        const a = base + j, b = a + 1, c = b + ROWS, d = a + ROWS;
        for (const v of [a, b, c, a, c, d]) indices[index++] = v;
      }
    }
    this.geo.setIndex(new THREE.BufferAttribute(indices, 1));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.87, side: THREE.DoubleSide });
    mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -1;
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.name = 'pressed ski grooves';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.mesh.add(this.spray.mesh);
  }

  /** Width includes the displaced shoulder; actual ski impressions remain about 10 cm wide. */
  add(left: THREE.Vector3, right: THREE.Vector3, dir: THREE.Vector3, width: number, strength: number) {
    const section: Section = { centers: [left.clone(), right.clone()], side: new THREE.Vector3(-dir.z, 0, dir.x).normalize(), width, strength };
    if (!this.last) { this.last = section; this.elapsed = 0; return; }
    const distance = Math.max(left.distanceTo(this.last.centers[0]), right.distanceTo(this.last.centers[1]));
    if (distance > 8) { this.last = section; this.elapsed = 0; return; }
    if (distance < 0.25) return;
    this.spray.emit(left, right, dir, width, strength, distance / Math.max(this.elapsed, 1 / 120));
    let vertex = this.head * VERTS;
    for (let ski = 0; ski < 2; ski++) for (const end of [this.last, section]) {
      const center = end.centers[ski];
      const sample = (x: number, z: number) => this.heightAt?.(x, z) ?? center.y;
      const gx = (sample(center.x + 0.15, center.z) - sample(center.x - 0.15, center.z)) / 0.3;
      const gz = (sample(center.x, center.z + 0.15) - sample(center.x, center.z - 0.15)) / 0.3;
      for (const u of PROFILE) {
        const shoulder = Math.exp(-(((Math.abs(u - 0.5) - 0.31) / 0.1) ** 2));
        const edge = Math.min(1, u / 0.16, (1 - u) / 0.16);
        const x = center.x + end.side.x * (u - 0.5) * end.width * 1.6;
        const z = center.z + end.side.z * (u - 0.5) * end.width * 1.6;
        const k = vertex * 3, c = vertex * 4;
        this.pos[k] = x; this.pos[k + 1] = sample(x, z) + 0.008 + shoulder * 0.012; this.pos[k + 2] = z;
        // A compacted cool trough and bright powder shoulders, both lit by the real scene lights.
        const trough = 1 - shoulder;
        this.col[c] = 0.93 - trough * 0.28; this.col[c + 1] = 0.96 - trough * 0.23; this.col[c + 2] = 0.99 - trough * 0.15;
        this.col[c + 3] = edge * Math.min(0.65, 0.32 * end.strength);
        const ridgeSlope = shoulder * -2 * (Math.abs(u - 0.5) - 0.31) / 0.01
          * Math.sign(u - 0.5) * 0.012 / (end.width * 1.6);
        const n = new THREE.Vector3(-gx - end.side.x * ridgeSlope, 1, -gz - end.side.z * ridgeSlope).normalize();
        this.normal[k] = n.x; this.normal[k + 1] = n.y; this.normal[k + 2] = n.z;
        vertex++;
      }
    }
    this.head = (this.head + 1) % MAX;
    this.count = Math.min(MAX, this.count + 1);
    this.geo.setDrawRange(0, this.count * INDICES);
    this.last = section;
    this.elapsed = 0;
    for (const key of ['position', 'color', 'normal']) this.geo.getAttribute(key).needsUpdate = true;
  }

  break() { this.last = null; this.elapsed = 0; }

  update(dt: number) { this.elapsed += dt; this.spray.update(dt); }

  /** Slowly fade old segments without erasing the snow underneath. */
  fade(dt: number) {
    const factor = Math.exp(-dt / 90);
    for (let i = 3; i < this.count * VERTS * 4; i += 4) this.col[i] *= factor;
    this.geo.getAttribute('color').needsUpdate = true;
  }
}
