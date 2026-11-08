// Chunked quadtree terrain LOD. Each chunk is 64x64 quads at spacing 2^L built on the CPU from
// height tiles; skirts hide cracks between LOD levels.
import * as THREE from 'three/webgpu';
import { Heightfield, HeightTile } from './heightfield';

const CELLS = 64;
const VERTS = CELLS + 1;
const SKIRT_VERTS = 4 * VERTS;

interface Chunk {
  L: number; cx: number; cn: number;
  mesh: THREE.Mesh | null;
  building: boolean;
  lastUsed: number;
}

let sharedIndex: THREE.BufferAttribute | null = null;
function getIndex(): THREE.BufferAttribute {
  if (sharedIndex) return sharedIndex;
  const idx: number[] = [];
  const v = (i: number, j: number) => j * VERTS + i;
  for (let j = 0; j < CELLS; j++) {
    for (let i = 0; i < CELLS; i++) {
      const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
      idx.push(a, b, c, a, c, d);
    }
  }
  // skirts: ring order south edge (j=0, i asc), east (i=64, j asc), north (j=64, i desc), west (i=0, j desc)
  const base = VERTS * VERTS;
  const edge = (k: number) => {
    // returns [topIndex, skirtIndex] for k-th vertex along the ring (k < 4*VERTS)
    const side = Math.floor(k / VERTS), t = k % VERTS;
    let top: number;
    if (side === 0) top = v(t, 0);
    else if (side === 1) top = v(CELLS, t);
    else if (side === 2) top = v(CELLS - t, CELLS);
    else top = v(0, CELLS - t);
    return [top, base + k];
  };
  for (let side = 0; side < 4; side++) {
    for (let t = 0; t < CELLS; t++) {
      const [a, as] = edge(side * VERTS + t);
      const [b, bs] = edge(side * VERTS + t + 1);
      // outward facing skirt quads (double-sided cheapness avoided: winding chosen to face out)
      idx.push(a, as, b, b, as, bs);
    }
  }
  sharedIndex = new THREE.BufferAttribute(new Uint32Array(idx), 1);
  return sharedIndex;
}

export class TerrainRenderer {
  readonly group = new THREE.Group();
  private chunks = new Map<string, Chunk>();
  private frame = 0;
  splitFactor = 1.5;
  maxBuildsPerFrame = 6;
  shadowMaxLevel = 2;
  visibleCount = 0;
  triangles = 0;
  private roots: [number, number][] = [];
  private buildQueue: Chunk[] = [];

  constructor(private hf: Heightfield, private material: THREE.Material) {
    this.group.name = 'terrain';
    const L = hf.maxLevel;
    const C = CELLS * 2 ** L;
    // roots: all chunks of the top level covered by its tiles
    for (const [tx, tn] of hf.tileRange(L)) {
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) this.roots.push([tx * 4 + a, tn * 4 + b]);
    }
    void C;
  }

  private key(L: number, cx: number, cn: number) { return `${L}/${cx}/${cn}`; }

  private tileFor(L: number, cx: number, cn: number): HeightTile | undefined {
    return this.hf.getTile(L, Math.floor(cx / 4), Math.floor(cn / 4));
  }
  private tileExists(L: number, cx: number, cn: number) {
    return this.hf.hasTile(L, Math.floor(cx / 4), Math.floor(cn / 4));
  }

  private getChunk(L: number, cx: number, cn: number): Chunk {
    const k = this.key(L, cx, cn);
    let c = this.chunks.get(k);
    if (!c) { c = { L, cx, cn, mesh: null, building: false, lastUsed: 0 }; this.chunks.set(k, c); }
    c.lastUsed = this.frame;
    return c;
  }

  /** Is the chunk ready to draw (tile loaded and mesh built)? Requests loading/building otherwise. */
  private ready(c: Chunk): boolean {
    if (c.mesh) return true;
    const t = this.tileFor(c.L, c.cx, c.cn);
    if (!t) { void this.hf.ensureTile(c.L, Math.floor(c.cx / 4), Math.floor(c.cn / 4)); return false; }
    if (!c.building) { c.building = true; this.buildQueue.push(c); }
    return false;
  }

  private buildMesh(c: Chunk) {
    const t = this.tileFor(c.L, c.cx, c.cn)!;
    const r = t.r;
    const C = CELLS * r;
    const ox = c.cx * C, on = c.cn * C; // chunk origin (local x, n)
    const i0 = (c.cx - t.tx * 4) * CELLS + 1; // index into tile samples (border offset 1)
    const j0 = (c.cn - t.tn * 4) * CELLS + 1;
    const N = t.n, H = t.heights;
    const count = VERTS * VERTS + SKIRT_VERTS;
    const pos = new Float32Array(count * 3);
    const nrm = new Float32Array(count * 3);
    let minH = Infinity, maxH = -Infinity;
    for (let j = 0; j < VERTS; j++) {
      for (let i = 0; i < VERTS; i++) {
        const ti = i0 + i, tj = j0 + j;
        const h = H[tj * N + ti];
        const k = (j * VERTS + i) * 3;
        pos[k] = i * r; pos[k + 1] = h; pos[k + 2] = -j * r;
        const hl = H[tj * N + ti - 1], hr = H[tj * N + ti + 1];
        const hs = H[(tj - 1) * N + ti], hn = H[(tj + 1) * N + ti];
        // gradient in (x, n); game normal = (-dh/dx, 1, +dh/dn) since z = -n
        const gx = (hr - hl) / (2 * r), gn = (hn - hs) / (2 * r);
        const inv = 1 / Math.hypot(gx, 1, gn);
        nrm[k] = -gx * inv; nrm[k + 1] = inv; nrm[k + 2] = gn * inv;
        if (h < minH) minH = h; if (h > maxH) maxH = h;
      }
    }
    const skirt = Math.max(2, r * 3);
    for (let k = 0; k < SKIRT_VERTS; k++) {
      const side = Math.floor(k / VERTS), tt = k % VERTS;
      let i: number, j: number;
      if (side === 0) { i = tt; j = 0; } else if (side === 1) { i = CELLS; j = tt; }
      else if (side === 2) { i = CELLS - tt; j = CELLS; } else { i = 0; j = CELLS - tt; }
      const src = (j * VERTS + i) * 3, dst = (VERTS * VERTS + k) * 3;
      pos[dst] = pos[src]; pos[dst + 1] = pos[src + 1] - skirt; pos[dst + 2] = pos[src + 2];
      nrm[dst] = nrm[src]; nrm[dst + 1] = nrm[src + 1]; nrm[dst + 2] = nrm[src + 2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(getIndex());
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, minH - skirt, -C), new THREE.Vector3(C, maxH, 0));
    g.boundingSphere = new THREE.Sphere();
    g.boundingBox.getBoundingSphere(g.boundingSphere);
    // curvature drop at the horizon can push far chunks below their box; enlarge sphere to be safe
    g.boundingSphere.radius += 2 ** c.L * 40;
    const m = new THREE.Mesh(g, this.material);
    m.position.set(ox, 0, -on);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.receiveShadow = true;
    m.castShadow = c.L <= this.shadowMaxLevel;
    m.userData.level = c.L;
    m.frustumCulled = true;
    c.mesh = m;
    c.building = false;
  }

  /** Distance from point to the chunk's AABB (local x/n coords, height y). */
  private dist(c: Chunk, px: number, py: number, pn: number) {
    const C = CELLS * 2 ** c.L;
    const x0 = c.cx * C, n0 = c.cn * C;
    const t = this.tileFor(c.L, c.cx, c.cn);
    const y0 = t ? t.min : py, y1 = t ? t.max : py;
    const dx = Math.max(x0 - px, 0, px - (x0 + C));
    const dn = Math.max(n0 - pn, 0, pn - (n0 + C));
    const dy = Math.max(y0 - py, 0, py - y1);
    return Math.hypot(dx, dy, dn);
  }

  /** Select and attach the visible set of chunks for a viewer at game position p. */
  update(p: THREE.Vector3) {
    this.frame++;
    const px = p.x, pn = -p.z, py = p.y;
    const visible: Chunk[] = [];
    const visit = (c: Chunk): boolean => {
      // returns true if this subtree drew something covering the chunk
      const C = CELLS * 2 ** c.L;
      const wantSplit = c.L > 0 && this.dist(c, px, py, pn) < this.splitFactor * C;
      if (wantSplit) {
        const kids: Chunk[] = [];
        let allExist = true;
        for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
          const L = c.L - 1, kx = c.cx * 2 + a, kn = c.cn * 2 + b;
          if (!this.tileExists(L, kx, kn)) { allExist = false; break; }
          kids.push(this.getChunk(L, kx, kn));
        }
        if (allExist && kids.length === 4) {
          const kidsReady = kids.map((k) => this.ready(k));
          if (kidsReady.every(Boolean)) {
            for (const k of kids) visit(k);
            return true;
          }
        }
      }
      if (this.ready(c)) { visible.push(c); return true; }
      return false;
    };
    for (const [cx, cn] of this.roots) {
      const c = this.getChunk(this.hf.maxLevel, cx, cn);
      visit(c);
    }
    // build queued meshes, nearest first
    this.buildQueue.sort((a, b) => a.L - b.L || this.dist(a, px, py, pn) - this.dist(b, px, py, pn));
    const t0 = performance.now();
    let built = 0;
    while (this.buildQueue.length && built < this.maxBuildsPerFrame && performance.now() - t0 < 6) {
      const c = this.buildQueue.shift()!;
      if (this.tileFor(c.L, c.cx, c.cn)) { this.buildMesh(c); built++; } else c.building = false;
    }
    // attach visible set
    const want = new Set(visible.map((c) => c.mesh!));
    for (const m of [...this.group.children]) if (!want.has(m as THREE.Mesh)) this.group.remove(m);
    for (const m of want) if (m.parent !== this.group) this.group.add(m);
    this.visibleCount = visible.length;
    this.triangles = visible.length * CELLS * CELLS * 2;
    // garbage collect stale chunks
    if (this.frame % 120 === 0) {
      for (const [k, c] of this.chunks) {
        if (this.frame - c.lastUsed > 600 && c.mesh) {
          c.mesh.geometry.dispose();
          this.chunks.delete(k);
        }
      }
    }
  }

  /** True when every chunk needed for the current view is built (used by tests/screenshots). */
  get idle() { return this.buildQueue.length === 0; }
}
