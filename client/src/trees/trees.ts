// @ts-nocheck -- TSL node graphs: @types/three node typings are too strict to be useful here.
// Every lidar-detected tree, instanced. Near trees (within NEAR_DIST) are procedural 3D meshes that cast
// shadows and have collision; farther trees are crossed-quad impostors grouped per 512 m tile.
import * as THREE from 'three/webgpu';
import { texture, uv, vec2, vec3, float, attribute, transformNormalToView, mix, positionWorld, cameraPosition, length, smoothstep } from 'three/tsl';
import { coniferGeometry, aspenGeometry, oakGeometry, impostorAtlas, crossQuadGeometry } from './treeAssets';
import type { ColliderGrid } from '../../../shared/collision';

const CELL = 64;

interface TileData {
  tx: number; tn: number; n: number;
  x: Float32Array; z: Float32Array; y: Float32Array; h: Float32Array; r: Float32Array; s: Uint8Array; seed: Uint8Array;
  mesh: THREE.InstancedMesh | null;
  cellOf: Int32Array; // cell key per tree index
  hidden: Set<number>; // cell keys hidden (near) in this tile's impostor mesh
}

async function gunzip(buf: ArrayBuffer) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    return await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return buf;
}

const cellKey = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);

export class TreeSystem {
  readonly group = new THREE.Group();
  private tiles = new Map<string, TileData>();
  private cells = new Map<number, { tile: TileData; idx: number[] }[]>();
  private nearMeshes: THREE.InstancedMesh[] = [];
  private nearCells = new Set<number>();
  private impostorMat: THREE.MeshStandardNodeMaterial;
  private quad = crossQuadGeometry();
  total = 0;
  loaded = 0;
  private lastCam = new THREE.Vector3(1e9, 0, 0);
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  enabled = true;

  constructor(private base: string, private colliders: ColliderGrid, private nearDist = 210, private farDist = 3200) {
    this.group.name = 'trees';
    const atlas = impostorAtlas();
    const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.95 });
    const sp = attribute('species', 'float');
    const tint = attribute('tint', 'float');
    const tuv = uv().mul(vec2(0.25, 1)).add(vec2(sp.mul(0.25), 0));
    const texel = texture(atlas, tuv);
    mat.colorNode = texel.rgb.mul(tint);
    mat.opacityNode = texel.a;
    mat.normalNode = transformNormalToView(vec3(0, 1, 0)).normalize();
    // fade out impostors beyond farDist
    const d = length(positionWorld.sub(cameraPosition));
    // keep coverage at distance (mipmapped alpha thins out foliage) and fade out at the far limit
    const cover = float(1).add(d.div(450.0));
    mat.opacityNode = texel.a.mul(cover).mul(float(1).sub(smoothstep(this.farDist * 0.85, this.farDist, d)));
    this.impostorMat = mat;

    const nearMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9 });
    const geos = [coniferGeometry(0, 'high'), coniferGeometry(1, 'high'), aspenGeometry('high'), oakGeometry('high')];
    for (let s = 0; s < 4; s++) {
      const m = new THREE.InstancedMesh(geos[s], nearMat, 24000);
      m.count = 0;
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      this.nearMeshes.push(m);
      this.group.add(m);
    }
  }

  async init(center: { x: number; z: number }) {
    const idx = await (await fetch(`${this.base}/trees/index.json`)).json();
    const tiles: [number, number, number][] = idx.tiles;
    this.total = tiles.reduce((a, t) => a + t[2], 0);
    const S = idx.tileSize as number;
    // nearest tiles first
    tiles.sort((a, b) => Math.hypot((a[0] + 0.5) * S - center.x, (a[1] + 0.5) * S + center.z) - Math.hypot((b[0] + 0.5) * S - center.x, (b[1] + 0.5) * S + center.z));
    const first = tiles.slice(0, 6), rest = tiles.slice(6);
    await Promise.all(first.map((t) => this.loadTile(t[0], t[1])));
    // remaining tiles in the background, a few at a time
    (async () => {
      for (let i = 0; i < rest.length; i += 4) await Promise.all(rest.slice(i, i + 4).map((t) => this.loadTile(t[0], t[1])));
    })();
  }

  private async loadTile(tx: number, tn: number) {
    const buf = await gunzip(await (await fetch(`${this.base}/trees/${tx}_${tn}.bin.gz`)).arrayBuffer());
    const dv = new DataView(buf);
    const n = dv.getUint32(4, true);
    let o = 8;
    const f32 = () => { const a = new Float32Array(buf.slice(o, o + n * 4)); o += n * 4; return a; };
    const x = f32(), z = f32(), y = f32();
    const hc = new Uint16Array(buf.slice(o, o + n * 2)); o += n * 2;
    const rd = new Uint8Array(buf.slice(o, o + n)); o += n;
    const s = new Uint8Array(buf.slice(o, o + n)); o += n;
    const seed = new Uint8Array(buf.slice(o, o + n));
    const h = new Float32Array(n), r = new Float32Array(n);
    for (let i = 0; i < n; i++) { h[i] = hc[i] / 100; r[i] = rd[i] / 20; }
    const t: TileData = { tx, tn, n, x, z, y, h, r, s, seed, mesh: null, cellOf: new Int32Array(n), hidden: new Set() };
    for (let i = 0; i < n; i++) {
      const k = cellKey(Math.floor(x[i] / CELL), Math.floor(z[i] / CELL));
      t.cellOf[i] = k;
      let list = this.cells.get(k);
      if (!list) { list = []; this.cells.set(k, list); }
      let entry = list.find((e) => e.tile === t);
      if (!entry) { entry = { tile: t, idx: [] }; list.push(entry); }
      entry.idx.push(i);
      if (h[i] > 3 && s[i] !== 3) {
        const trunk = 0.1 + 0.012 * h[i] + (s[i] <= 1 ? 0.3 : 0.05);
        this.colliders.add({ type: 'cyl', x: x[i], z: z[i], r: trunk, top: y[i] + h[i] });
      }
    }
    this.buildImpostors(t);
    this.tiles.set(`${tx}_${tn}`, t);
    this.loaded += n;
    this.lastCam.set(1e9, 0, 0); // force near-set refresh
  }

  private buildImpostors(t: TileData) {
    const g = this.quad.clone();
    const sp = new Float32Array(t.n), tint = new Float32Array(t.n);
    for (let i = 0; i < t.n; i++) { sp[i] = t.s[i]; tint[i] = 0.82 + (t.seed[i] / 255) * 0.3; }
    g.setAttribute('species', new THREE.InstancedBufferAttribute(sp, 1));
    g.setAttribute('tint', new THREE.InstancedBufferAttribute(tint, 1));
    const m = new THREE.InstancedMesh(g, this.impostorMat, t.n);
    for (let i = 0; i < t.n; i++) this.writeImpostor(m, t, i, false);
    m.receiveShadow = true;
    m.castShadow = false;
    m.computeBoundingSphere();
    m.frustumCulled = true;
    t.mesh = m;
    this.group.add(m);
  }

  private writeImpostor(m: THREE.InstancedMesh, t: TileData, i: number, hide: boolean) {
    const h = t.h[i], r = t.r[i];
    const rot = (t.seed[i] / 255) * Math.PI;
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), rot);
    const w = t.s[i] === 2 ? r * 1.05 : t.s[i] === 3 ? r : r * 1.18;
    this.sc.set(hide ? 0 : w, hide ? 0 : h * 1.04, hide ? 0 : w);
    this.m4.compose(this.v.set(t.x[i], t.y[i] - 0.15, t.z[i]), this.q, this.sc);
    m.setMatrixAt(i, this.m4);
  }

  /** Update the near/far split around the camera. */
  update(cam: THREE.Vector3) {
    this.group.visible = this.enabled;
    if (!this.enabled) return;
    if (cam.distanceToSquared(this.lastCam) < 15 * 15) return;
    this.lastCam.copy(cam);
    const ci = Math.floor(cam.x / CELL), cj = Math.floor(cam.z / CELL);
    const rad = Math.ceil(this.nearDist / CELL) + 1;
    const want = new Set<number>();
    for (let i = ci - rad; i <= ci + rad; i++) for (let j = cj - rad; j <= cj + rad; j++) {
      const cx = (i + 0.5) * CELL, cz = (j + 0.5) * CELL;
      if (Math.hypot(cx - cam.x, cz - cam.z) < this.nearDist) want.add(cellKey(i, j));
    }
    // update impostor visibility per tile for changed cells
    const changedTiles = new Set<TileData>();
    const setCell = (k: number, hide: boolean) => {
      const list = this.cells.get(k);
      if (!list) return;
      for (const e of list) {
        if (!e.tile.mesh) continue;
        for (const i of e.idx) this.writeImpostor(e.tile.mesh, e.tile, i, hide);
        if (hide) e.tile.hidden.add(k); else e.tile.hidden.delete(k);
        changedTiles.add(e.tile);
      }
    };
    for (const k of this.nearCells) if (!want.has(k)) setCell(k, false);
    for (const k of want) if (!this.nearCells.has(k) || !this.isHidden(k)) setCell(k, true);
    this.nearCells = want;
    for (const t of changedTiles) t.mesh!.instanceMatrix.needsUpdate = true;
    // rebuild near meshes
    const counts = [0, 0, 0, 0];
    for (const k of want) {
      const list = this.cells.get(k);
      if (!list) continue;
      for (const e of list) {
        const t = e.tile;
        for (const i of e.idx) {
          const s = t.s[i];
          const mesh = this.nearMeshes[s];
          if (counts[s] >= mesh.instanceMatrix.count) continue;
          const rot = (t.seed[i] / 255) * Math.PI * 2;
          this.q.setFromAxisAngle(this.v.set(0, 1, 0), rot);
          const lean = ((t.seed[i] * 7) % 255) / 255 * 0.04 - 0.02;
          const q2 = new THREE.Quaternion().setFromAxisAngle(this.v.set(1, 0, 0), lean);
          this.q.multiply(q2);
          this.sc.set(t.r[i], t.h[i], t.r[i]);
          this.m4.compose(this.v.set(t.x[i], t.y[i] - 0.2, t.z[i]), this.q, this.sc);
          mesh.setMatrixAt(counts[s]++, this.m4);
        }
      }
    }
    for (let s = 0; s < 4; s++) {
      this.nearMeshes[s].count = counts[s];
      this.nearMeshes[s].instanceMatrix.needsUpdate = true;
    }
  }

  private isHidden(k: number) {
    const list = this.cells.get(k);
    if (!list) return true;
    return list.every((e) => e.tile.hidden.has(k));
  }

  /** Nearest trunk distance (for audio/AI); returns Infinity if none within maxD. */
  countNear(x: number, z: number, radius: number) {
    let c = 0;
    const list = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return 0;
    for (const e of list) for (const i of e.idx) if (Math.hypot(e.tile.x[i] - x, e.tile.z[i] - z) < radius) c++;
    return c;
  }
}
