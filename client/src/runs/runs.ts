// Run lookup (which run am I on), trail signs at run entrances, and ski area boundary markers.
import * as THREE from 'three/webgpu';
import { browserLoader } from '../terrain/heightfield';
import type { RunInfo, ResortData } from '../game';
import type { ColliderGrid } from '../../../shared/collision';

async function gunzip(buf: ArrayBuffer) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b) return await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return buf;
}

export const DIFF_COLOR: Record<string, string> = { green: '#2e9e44', blue: '#1f5fd6', black: '#111111', double: '#111111', park: '#f08a1c', hike: '#7a5230' };

export function drawDiffSymbol(g: CanvasRenderingContext2D, d: string, cx: number, cy: number, s: number) {
  g.save();
  g.fillStyle = DIFF_COLOR[d] ?? '#888';
  if (d === 'green') { g.beginPath(); g.arc(cx, cy, s / 2, 0, Math.PI * 2); g.fill(); }
  else if (d === 'blue') g.fillRect(cx - s / 2, cy - s / 2, s, s);
  else if (d === 'black' || d === 'double') {
    const one = (x: number) => { g.beginPath(); g.moveTo(x, cy - s * 0.6); g.lineTo(x + s * 0.45, cy); g.lineTo(x, cy + s * 0.6); g.lineTo(x - s * 0.45, cy); g.closePath(); g.fill(); };
    if (d === 'black') one(cx); else { one(cx - s * 0.5); one(cx + s * 0.5); }
  } else if (d === 'park') { g.beginPath(); g.roundRect(cx - s * 0.7, cy - s * 0.3, s * 1.4, s * 0.6, s * 0.3); g.fill(); }
  else { g.fillRect(cx - s * 0.6, cy - s * 0.15, s * 1.2, s * 0.3); }
  g.restore();
}

export class RunSystem {
  readonly group = new THREE.Group();
  private ids: Uint16Array | null = null;
  private x0 = 0; private n0 = 0; private res = 2; private w = 0; private h = 0;

  constructor(private resort: ResortData) { this.group.name = 'runs'; }

  async load(base: string) {
    const raw = await gunzip(await browserLoader(`${base}/runs.bin.gz`));
    const dv = new DataView(raw);
    this.x0 = dv.getFloat32(4, true); this.n0 = dv.getFloat32(8, true); this.res = dv.getFloat32(12, true);
    this.w = dv.getUint16(16, true); this.h = dv.getUint16(18, true);
    this.ids = new Uint16Array(raw.slice(20, 20 + this.w * this.h * 2));
  }

  runAt(x: number, z: number): RunInfo | null {
    if (!this.ids) return null;
    const i = Math.floor((x - this.x0) / this.res), j = Math.floor((-z - this.n0) / this.res);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return null;
    const id = this.ids[j * this.w + i];
    return id ? this.resort.runs[id - 1] : null;
  }

  /** The point at the top of each named run (highest start among its ways). */
  runTops(): Map<string, { run: RunInfo; x: number; y: number; z: number; dx: number; dz: number }> {
    const tops = new Map<string, { run: RunInfo; x: number; y: number; z: number; dx: number; dz: number }>();
    for (const r of this.resort.runs) {
      let p: number[]; let q: number[];
      if (r.kind === 'line') { p = r.points[0]; q = r.points[Math.min(2, r.points.length - 1)]; }
      else {
        let k = 0;
        r.points.forEach((pt, i) => { if (pt[1] > r.points[k][1]) k = i; });
        p = r.points[k];
        // direction toward the polygon centroid
        const cx = r.points.reduce((a, b) => a + b[0], 0) / r.points.length, cz = r.points.reduce((a, b) => a + b[2], 0) / r.points.length;
        q = [cx, 0, cz];
      }
      const prev = tops.get(r.name);
      if (!prev || p[1] > prev.y) {
        const dx = q[0] - p[0], dz = q[2] - p[2], L = Math.hypot(dx, dz) || 1;
        tops.set(r.name, { run: r, x: p[0], y: p[1], z: p[2], dx: dx / L, dz: dz / L });
      }
    }
    return tops;
  }

  buildSigns(height: (x: number, z: number) => number, colliders: ColliderGrid) {
    const postMat = new THREE.MeshStandardNodeMaterial({ color: 0x6b4a2b, roughness: 0.9 });
    const postGeo = new THREE.BoxGeometry(0.12, 2.4, 0.12);
    // Keep the original 512 by 192 lettering on both sides. Shared atlas pages let the
    // static merger draw many signs together, including in the three shadow passes.
    const width = 512, heightPx = 192, pad = 8, columns = 4, rows = 4;
    const w = width + 2 * pad, h = heightPx + 2 * pad;
    const side = new THREE.BoxGeometry(1.4, 0.52, 0.05);
    const faces = side.clone();
    side.setIndex(Array.from(side.index!.array).slice(0, 24));
    faces.setIndex(Array.from(faces.index!.array).slice(24));
    side.clearGroups(); faces.clearGroups();
    let atlas: HTMLCanvasElement, printed: THREE.MeshStandardNodeMaterial;
    const signs = [...this.runTops()].filter(([, t]) => t.run.difficulty !== 'hike');
    for (const [i, [name, t]] of signs.entries()) {
      const slot = i % (columns * rows);
      if (slot === 0) {
        atlas = document.createElement('canvas'); atlas.width = columns * w; atlas.height = rows * h;
        const map = new THREE.CanvasTexture(atlas);
        map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
        printed = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.7 });
      }
      const left = (slot % columns) * w + pad, top = Math.floor(slot / columns) * h + pad;
      const g = atlas!.getContext('2d')!;
      g.save(); g.translate(left, top);
      g.fillStyle = '#2a2a2a'; g.fillRect(-pad, -pad, w, h);
      g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, 512, 192);
      g.strokeStyle = '#2a2a2a'; g.lineWidth = 10; g.strokeRect(5, 5, 502, 182);
      drawDiffSymbol(g, t.run.difficulty, 80, 96, 70);
      g.fillStyle = '#1a1a1a';
      let fs = 64;
      g.font = `bold ${fs}px Helvetica, Arial, sans-serif`;
      while (g.measureText(name).width > 330 && fs > 28) { fs -= 4; g.font = `bold ${fs}px Helvetica, Arial, sans-serif`; }
      g.textBaseline = 'middle';
      g.fillText(name, 150, 96);
      g.restore();
      const face = faces.clone(), uv = face.getAttribute('uv');
      for (let k = 0; k < uv.count; k++) {
        uv.setXY(k, (left + uv.getX(k) * width) / atlas!.width,
          1 - (top + (1 - uv.getY(k)) * heightPx) / atlas!.height);
      }
      const panel = new THREE.Mesh(face, printed!);
      const rim = new THREE.Mesh(side, postMat);
      rim.position.y = 1.95;
      // place 5 m to the side of the run entrance, facing uphill skiers
      const sx = t.x + -t.dz * 5, sz = t.z + t.dx * 5;
      const gy = height(sx, sz);
      const sign = new THREE.Group();
      for (const px of [-0.62, 0.62]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(px, 1.0, -0.06); post.castShadow = true;
        sign.add(post);
      }
      panel.position.y = 1.95; panel.castShadow = true;
      sign.add(rim, panel);
      sign.position.set(sx, gy, sz);
      sign.rotation.y = Math.atan2(t.dx, t.dz); // panel normal (+z) points back uphill toward arriving skiers
      sign.userData.run = name;
      this.group.add(sign);
      colliders.add({ type: 'cyl', x: sx, z: sz, r: 0.15, top: gy + 2.3 });
    }
  }

  /** Orange boundary poles with rope segments along the ski area boundary. */
  buildBoundary(height: (x: number, z: number) => number) {
    const b = (this.resort as unknown as { boundary?: number[][] }).boundary;
    if (!b || b.length < 3) return;
    const poleMat = new THREE.MeshStandardNodeMaterial({ color: 0xff7a1a, roughness: 0.6 });
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < b.length - 1; i++) {
      const a = b[i], c = b[i + 1];
      const L = Math.hypot(c[0] - a[0], c[2] - a[2]);
      const n = Math.max(1, Math.round(L / 18));
      for (let k = 0; k < n; k++) {
        const x = a[0] + (c[0] - a[0]) * k / n, z = a[2] + (c[2] - a[2]) * k / n;
        pts.push(new THREE.Vector3(x, height(x, z), z));
      }
    }
    const pole = new THREE.CylinderGeometry(0.03, 0.03, 1.6, 5);
    pole.translate(0, 0.8, 0);
    const inst = new THREE.InstancedMesh(pole, poleMat, pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((p, i) => { m.makeTranslation(p.x, p.y, p.z); inst.setMatrixAt(i, m); });
    inst.castShadow = true;
    this.group.add(inst);
  }
}
