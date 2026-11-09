// Connected, terrain-conforming ski grooves with feathered shoulders and kicked-up snow.
// Several skiers can write at once (each with its own writer id). Tracks last across laps; new snow
// covers them, a groomer's tiller erases them, and the set can be saved and restored between visits.
import * as THREE from 'three/webgpu';
import { SnowSpray } from './snowSpray';

const PROFILE = [0, 0.12, 0.25, 0.5, 0.75, 0.88, 1];
const ROWS = PROFILE.length;
const VERTS = ROWS * 4; // two skis, start/end cross sections
const INDICES = (ROWS - 1) * 12;
/** Saved per segment: left/right ski centres at both ends (12), width and strength at both ends (4), remaining opacity (1). */
const REC = 17;
interface Section { centers: THREE.Vector3[]; side: THREE.Vector3; width: number; strength: number }
export interface TrackOptions { max?: number; life?: number; spray?: boolean }

export class SkiTracks {
  readonly mesh: THREE.Mesh;
  readonly max: number;
  private life: number;
  private pos: Float32Array;
  private col: Float32Array;
  private normal: Float32Array;
  private rec: Float32Array;
  private head = 0;
  private count = 0;
  private last = new Map<number, Section>();
  private geo = new THREE.BufferGeometry();
  private spray: SnowSpray | null;
  private elapsed = 0;
  private n = new THREE.Vector3();

  constructor(private heightAt?: (x: number, z: number) => number, opts: TrackOptions = {}) {
    this.max = opts.max ?? 1800;
    this.life = opts.life ?? 90;
    this.pos = new Float32Array(this.max * VERTS * 3);
    this.col = new Float32Array(this.max * VERTS * 4);
    this.normal = new Float32Array(this.max * VERTS * 3);
    this.rec = new Float32Array(this.max * REC);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.normal, 3).setUsage(THREE.DynamicDrawUsage));
    const indices = new Uint32Array(this.max * INDICES);
    let index = 0;
    for (let seg = 0; seg < this.max; seg++) for (let ski = 0; ski < 2; ski++) {
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
    this.spray = opts.spray === false ? null : new SnowSpray();
    if (this.spray) this.mesh.add(this.spray.mesh);
  }

  get segments() { return this.count; }

  /** Width includes the displaced shoulder; actual ski impressions remain about 10 cm wide.
   * `minStep`: shortest segment written (longer chords for distant crowds keep the buffer for more laps). */
  add(left: THREE.Vector3, right: THREE.Vector3, dir: THREE.Vector3, width: number, strength: number, writer = 0, minStep = 0.25) {
    const section: Section = { centers: [left.clone(), right.clone()], side: new THREE.Vector3(-dir.z, 0, dir.x).normalize(), width, strength };
    const last = this.last.get(writer);
    if (!last) { this.last.set(writer, section); this.elapsed = 0; return; }
    const distance = Math.max(left.distanceTo(last.centers[0]), right.distanceTo(last.centers[1]));
    if (distance > 8) { this.last.set(writer, section); this.elapsed = 0; return; }
    if (distance < minStep) return;
    if (this.spray && writer === 0) this.spray.emit(left, right, dir, width, strength, distance / Math.max(this.elapsed, 1 / 120));
    this.write(last, section, 1);
    this.last.set(writer, section);
    if (writer === 0) this.elapsed = 0;
  }

  private write(a: Section, b: Section, opacity: number) {
    let vertex = this.head * VERTS;
    for (let ski = 0; ski < 2; ski++) for (const end of [a, b]) {
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
        this.col[c + 3] = edge * Math.min(0.65, 0.32 * end.strength) * opacity;
        const ridgeSlope = shoulder * -2 * (Math.abs(u - 0.5) - 0.31) / 0.01
          * Math.sign(u - 0.5) * 0.012 / (end.width * 1.6);
        const n = this.n.set(-gx - end.side.x * ridgeSlope, 1, -gz - end.side.z * ridgeSlope).normalize();
        this.normal[k] = n.x; this.normal[k + 1] = n.y; this.normal[k + 2] = n.z;
        vertex++;
      }
    }
    const r = this.head * REC, R = this.rec;
    [a.centers[0], a.centers[1], b.centers[0], b.centers[1]].forEach((p, i) => { R[r + i * 3] = p.x; R[r + i * 3 + 1] = p.y; R[r + i * 3 + 2] = p.z; });
    R[r + 12] = a.width; R[r + 13] = b.width; R[r + 14] = a.strength; R[r + 15] = b.strength; R[r + 16] = opacity;
    const v0 = this.head * VERTS;
    (this.geo.getAttribute('position') as THREE.BufferAttribute).addUpdateRange(v0 * 3, VERTS * 3);
    (this.geo.getAttribute('normal') as THREE.BufferAttribute).addUpdateRange(v0 * 3, VERTS * 3);
    (this.geo.getAttribute('color') as THREE.BufferAttribute).addUpdateRange(v0 * 4, VERTS * 4);
    for (const key of ['position', 'color', 'normal']) this.geo.getAttribute(key).needsUpdate = true;
    this.head = (this.head + 1) % this.max;
    this.count = Math.min(this.max, this.count + 1);
    this.geo.setDrawRange(0, this.count * INDICES);
  }

  break(writer = 0) { this.last.delete(writer); if (writer === 0) this.elapsed = 0; }

  update(dt: number) { this.elapsed += dt; this.spray?.update(dt); }

  /** Multiply every segment's opacity (fading with age, covering with new snow). */
  private scale(factor: number, where?: (i: number) => boolean) {
    const col = this.col, R = this.rec;
    let touched = false;
    for (let i = 0; i < this.count; i++) {
      if (where && !where(i)) continue;
      const f = where ? 0 : factor;
      R[i * REC + 16] *= f;
      for (let v = i * VERTS * 4 + 3, end = (i + 1) * VERTS * 4; v < end; v += 4) col[v] *= f;
      touched = true;
    }
    if (touched) { const c = this.geo.getAttribute('color') as THREE.BufferAttribute; c.clearUpdateRanges(); c.needsUpdate = true; }
  }

  /** Slowly fade old segments without erasing the snow underneath. */
  fade(dt: number) { this.scale(Math.exp(-dt / this.life)); }

  /** New snow settles into the grooves: `amount` 0..1 of their remaining depth is filled. */
  cover(amount: number) { if (amount > 0) this.scale(1 - Math.min(1, amount)); }

  /** A groomer's tiller passes: erase every segment within `radius` of (x, z). Returns segments erased. */
  clearNear(x: number, z: number, radius: number) {
    const R = this.rec, r2 = radius * radius;
    let n = 0;
    this.scale(0, (i) => {
      if (R[i * REC + 16] <= 0.01) return false;
      const o = i * REC, cx = (R[o] + R[o + 3] + R[o + 6] + R[o + 9]) / 4, cz = (R[o + 2] + R[o + 5] + R[o + 8] + R[o + 11]) / 4;
      const hit = (cx - x) ** 2 + (cz - z) ** 2 < r2;
      if (hit) n++;
      return hit;
    });
    return n;
  }

  /** Visible segments, oldest first, as a flat array (REC numbers each) for saving. */
  serialize(minOpacity = 0.05) {
    const out: number[] = [];
    for (let k = 0; k < this.count; k++) {
      const i = this.count < this.max ? k : (this.head + k) % this.max;
      const o = i * REC;
      if (this.rec[o + 16] < minOpacity) continue;
      for (let j = 0; j < REC; j++) out.push(this.rec[o + j]);
    }
    return out;
  }

  /** Rebuild saved segments (after `serialize`). */
  restore(flat: ArrayLike<number>) {
    // Saved grooves keep their recorded heights: distant terrain may still be coarse while loading.
    const height = this.heightAt; this.heightAt = undefined;
    try { this.rebuild(flat); } finally { this.heightAt = height; }
  }

  private rebuild(flat: ArrayLike<number>) {
    const v = new THREE.Vector3();
    for (let o = 0; o + REC <= flat.length; o += REC) {
      const p = (j: number) => new THREE.Vector3(flat[o + j * 3], flat[o + j * 3 + 1], flat[o + j * 3 + 2]);
      const l0 = p(0), r0 = p(1), l1 = p(2), r1 = p(3);
      const side0 = v.subVectors(r0, l0).setY(0).normalize().clone(), side1 = v.subVectors(r1, l1).setY(0).normalize().clone();
      this.write({ centers: [l0, r0], side: side0, width: flat[o + 12], strength: flat[o + 14] },
        { centers: [l1, r1], side: side1, width: flat[o + 13], strength: flat[o + 15] }, flat[o + 16]);
    }
  }
}
