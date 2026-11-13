// @ts-nocheck -- TSL node graphs: @types/three node typings are too strict to be useful here.
// Every lidar-detected tree, instanced. Near trees (within NEAR_DIST) are procedural 3D meshes that cast
// shadows and have collision; farther trees are crossed-quad impostors grouped per 512 m tile, baked
// from those same meshes. Each species has several growth forms, chosen per tree from its seed.
import * as THREE from 'three/webgpu';
import {
  Fn, texture, uv, vec2, vec3, float, attribute, transformNormalToView, positionWorld, positionLocal, positionGeometry,
  cameraPosition, length, smoothstep, normalViewGeometry, normalView, positionViewDirection, faceDirection,
  diffuseColor, dot, max, pow, sin, cos, time, mix, uniform, screenCoordinate, fract,
} from 'three/tsl';
import { coniferGeometry, aspenGeometry, oakGeometry, crossQuadGeometry } from './treeAssets';
import { coniferAtlasCanvas } from './conifer';
import { aspenBarkCanvas, aspenTwigCanvas, canvasTexture } from './aspen';
import { bakeImpostorAtlas, canvasSampler, solidSampler, modelRadius, IMPOSTOR_HEADROOM } from './impostor';
import type { ColliderGrid } from '../../../shared/collision';
import { addTreeCollider, decodeTreeTile, ASPEN_CLUMPS, aspenClumpIndex, CONIFER_VARIANTS, coniferVariant } from '../../../shared/treeData';

const CELL = 64;
/** Trees closer than this use the full-detail meshes; the rest of the near ring uses the light meshes. */
const HIGH_DETAIL_DIST = 85;
/** Trees closer than this shade the snow at their base. */
const CONTACT_DIST = 130;
const LOD_BLEND = 20;
const OAK_VARIANTS = 2;
const UP = new THREE.Vector3(0, 1, 0), RIGHT = new THREE.Vector3(1, 0, 0);

/** One growth form of one species. Trees pick theirs from the lidar seed, like the colliders do. */
const MODELS: { species: number; variant: number }[] = [];
for (const kind of [0, 1]) for (let v = 0; v < CONIFER_VARIANTS; v++) MODELS.push({ species: kind, variant: v });
const ASPEN0 = MODELS.length;
ASPEN_CLUMPS.forEach((_, v) => MODELS.push({ species: 2, variant: v }));
const OAK0 = MODELS.length;
for (let v = 0; v < OAK_VARIANTS; v++) MODELS.push({ species: 3, variant: v });
const modelOf = (s: number, seed: number) =>
  s <= 1 ? s * CONIFER_VARIANTS + coniferVariant(seed) : s === 2 ? ASPEN0 + aspenClumpIndex(seed) : OAK0 + seed % OAK_VARIANTS;
const geometryOf = (m: { species: number; variant: number }, detail: 'high' | 'low') =>
  m.species <= 1 ? coniferGeometry(m.species, detail, m.variant) : m.species === 2 ? aspenGeometry(detail, m.variant) : oakGeometry(detail, m.variant);

/** Needles and fine twigs scatter light: it wraps past the terminator and glows through the crown
 * when the sun is behind it. Both terms use the shadowed light colour, so shade stays shade. */
class FoliageLighting extends THREE.PhysicalLightingModel {
  constructor(private through, private wrap) { super(); }
  direct(input, builder) {
    super.direct(input, builder);
    const { lightDirection, lightColor, reflectedLight } = input;
    const nl = dot(normalView, lightDirection);
    const wrapped = max(nl.add(this.wrap).div(1 + this.wrap), 0).sub(max(nl, 0));
    const back = pow(max(dot(lightDirection.negate(), positionViewDirection), 0), 4).mul(this.through);
    reflectedLight.directDiffuse.addAssign(lightColor.mul(diffuseColor.rgb.div(Math.PI)).mul(wrapped.mul(0.6).add(back)));
  }
}

/** Light air moves the crowns: stems lean with slow gusts and the outer twigs tremble. Runs after
 * instancing, so `positionLocal` is in world meters and `positionGeometry` is the normalized tree. */
const sway = (amount: number) => Fn(() => {
  const p = positionLocal, g = positionGeometry;
  const phase = p.x.mul(0.19).add(p.z.mul(0.13));
  const gust = sin(time.mul(0.8).add(phase)).mul(0.6).add(sin(time.mul(1.9).add(phase.mul(2.3))).mul(0.4));
  const flutter = sin(time.mul(4.3).add(g.y.mul(37)).add(phase.mul(3.1)));
  const lean = g.y.mul(g.y).mul(0.05).mul(gust);
  return p.add(vec3(lean.mul(0.8), length(g.xz).mul(amount).mul(flutter.mul(0.5).add(gust.mul(0.5))), lean.mul(0.6)));
})();

/** Needle and bark colour varies tree to tree and drifts from stand to stand. */
function treeTint(s: number, x: number, z: number, out: THREE.Color) {
  const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
  const k = Math.abs(Math.sin(x * 4.898 + z * 7.23) * 2371.3) % 1;
  const stand = 0.5 + 0.5 * Math.sin(x * 0.011 + 1.7) * Math.cos(z * 0.013 - 0.4);
  if (s <= 1) {
    const b = 0.78 + 0.34 * h + 0.12 * stand; // blue-green spruce through yellow-green fir
    return out.setRGB(b * (0.9 + 0.24 * k), b, b * (1.1 - 0.28 * k));
  }
  const b = s === 2 ? 0.9 + 0.16 * h : 0.84 + 0.3 * h;
  return out.setRGB(b, b * (0.975 + 0.035 * k), b * (0.93 + 0.08 * k));
}

interface TileData {
  tx: number; tn: number; n: number;
  x: Float32Array; z: Float32Array; y: Float32Array; h: Float32Array; r: Float32Array; s: Uint8Array; seed: Uint8Array;
  mesh: THREE.InstancedMesh | null;
  cellOf: Int32Array; // cell key per tree index
  excluded: Uint8Array;
  slope: Float32Array; // ground gradient (dy/dx, dy/dz) per tree, NaN until first needed
}

const cellKey = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);

export class TreeSystem {
  readonly group = new THREE.Group();
  private tiles = new Map<string, TileData>();
  private cells = new Map<number, { tile: TileData; idx: number[] }[]>();
  /** nearMeshes[tier][model]; tier 0 is full detail. */
  private nearMeshes: THREE.InstancedMesh[][] = [[], []];
  private nearCells = new Set<number>();
  private impostorMat: THREE.MeshStandardNodeMaterial;
  private quad = crossQuadGeometry();
  /** Baked cell half-width per model, in crown radii. */
  private halfWidth: number[] = [];
  private contact: THREE.InstancedMesh;
  total = 0;
  loaded = 0;
  private lastCam = new THREE.Vector3(1e9, 0, 0);
  private viewPosition = uniform(new THREE.Vector3());
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private tint = new THREE.Color();
  enabled = true;

  constructor(private base: string, private colliders: ColliderGrid, private nearDist = 210, private farDist = 3200,
    private buildings: { points: number[][] }[] = [], msaa = true, private ground?: (x: number, z: number) => number) {
    this.group.name = 'trees';
    const dist = length(positionWorld.sub(cameraPosition));
    const lodDistance = length(positionWorld.xz.sub(this.viewPosition.xz));
    const farWeight = smoothstep(this.nearDist - LOD_BLEND, this.nearDist + LOD_BLEND, lodDistance);
    // Complementary coverage masks avoid a double-dark transparent overlap. The 40 m band is
    // continuous as the camera moves, even between the CPU's instance-list refreshes.
    const noise = fract(fract(dot(screenCoordinate.xy, vec2(.06711056, .00583715))).mul(52.9829189));
    const coniferCanvas = coniferAtlasCanvas(), twigCanvas = aspenTwigCanvas(), barkCanvas = aspenBarkCanvas();

    const nearMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9 });
    const coniferMat = new THREE.MeshStandardNodeMaterial({
      vertexColors: true, map: canvasTexture(coniferCanvas), alphaTest: msaa ? 0.3 : 0.45, side: THREE.DoubleSide, roughness: 0.88,
    });
    coniferMat.alphaToCoverage = msaa;
    // Shading normals follow the crown, not the card, and must not flip on a card's back face.
    coniferMat.normalNode = normalViewGeometry;
    // hold needle coverage as mipmaps thin the texture with distance
    coniferMat.opacityNode = float(1).add(dist.div(60)).min(2.6);
    coniferMat.positionNode = sway(0.03);
    coniferMat.setupLightingModel = () => new FoliageLighting(0.22, 0.35);
    coniferMat.envMapIntensity = 0.5;
    const barkMat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, map: canvasTexture(barkCanvas, true), roughness: 0.82 });
    barkMat.positionNode = sway(0.02);
    const twigTex = canvasTexture(twigCanvas);
    const twigMat = new THREE.MeshStandardNodeMaterial({
      vertexColors: true, map: twigTex, alphaTest: msaa ? 0.16 : 0.4, side: THREE.DoubleSide, roughness: 0.95,
    });
    twigMat.alphaToCoverage = msaa;
    twigMat.normalNode = normalViewGeometry;
    twigMat.opacityNode = float(1).add(dist.div(160)).min(1.7);
    twigMat.positionNode = sway(0.02);
    twigMat.setupLightingModel = () => new FoliageLighting(0.12, 0.5);
    // shadows keep only the solid twigs, so crowns cast lacy rather than card-shaped shadows
    twigMat.maskShadowNode = texture(twigTex).a.greaterThan(0.45);
    twigMat.envMapIntensity = 0.6;
    for (const m of [nearMat, coniferMat, barkMat, twigMat]) m.maskNode = farWeight.lessThanEqual(noise);
    nearMat.maskShadowNode = barkMat.maskShadowNode = farWeight.lessThan(.5);
    coniferMat.maskShadowNode = farWeight.lessThan(.5).and(texture(coniferMat.map).a.greaterThan(.4));
    twigMat.maskShadowNode = farWeight.lessThan(.5).and(texture(twigTex).a.greaterThan(.45));

    const caps = [[14000, 4000, 9000, 6000], [24000, 12000, 30000, 16000]];
    const share = [CONIFER_VARIANTS, CONIFER_VARIANTS, ASPEN_CLUMPS.length, OAK_VARIANTS];
    const full: THREE.BufferGeometry[] = [];
    for (const [tier, detail] of (['high', 'low'] as const).entries()) {
      for (const model of MODELS) {
        const s = model.species, geo = geometryOf(model, detail);
        if (tier === 0) full.push(geo);
        const mat = s <= 1 ? coniferMat : s === 2 ? [barkMat, twigMat] : nearMat;
        const m = new THREE.InstancedMesh(geo, mat, Math.ceil(caps[tier][s] / share[s] * 1.6));
        m.setColorAt(0, this.tint.setRGB(1, 1, 1));
        m.count = 0;
        m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
        this.nearMeshes[tier].push(m);
        this.group.add(m);
      }
    }

    // Far trees: the full-detail models, baked from two directions with their own textures.
    const needles = canvasSampler(coniferCanvas, 8, 1.7), twigs = canvasSampler(twigCanvas, 8, 2.4), barkS = canvasSampler(barkCanvas, 4, 1, true);
    this.halfWidth = full.map((g) => modelRadius(g) * 1.06);
    const baked = bakeImpostorAtlas(MODELS.map((model, i) => ({
      geometry: full[i], halfWidth: this.halfWidth[i],
      samplers: model.species <= 1 ? [needles] : model.species === 2 ? [barkS, twigs] : [solidSampler],
    })));
    const atlasOf = (data: Uint8Array, colorSpace) => {
      const t = new THREE.DataTexture(data, baked.width, baked.height, THREE.RGBAFormat);
      t.colorSpace = colorSpace; t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4;
      t.needsUpdate = true;
      return t;
    };
    const albedo = atlasOf(baked.albedo, THREE.SRGBColorSpace), normals = atlasOf(baked.normal, THREE.NoColorSpace);
    // With MSAA, alpha-to-coverage keeps thin winter crowns translucent instead of speckled cut-outs.
    const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, alphaTest: msaa ? 0.03 : 0.5, roughness: 0.92 });
    mat.alphaToCoverage = msaa;
    // Per-tree data in one buffer (WebGPU allows eight): tint in xyz, atlas column plus yaw turn in w.
    const tree = attribute('tree', 'vec4'), view = attribute('view', 'float');
    const turn = tree.w.fract().mul(Math.PI * 2 * 256 / 255);
    const tuv = vec2(uv().x.add(tree.w.floor()).div(MODELS.length), uv().y.add(view).mul(0.5));
    const texel = texture(albedo, tuv);
    mat.colorNode = texel.rgb.mul(tree.xyz);
    // The baked normal is in tree space. Seen from behind, a quad shows the mirror image of the far
    // side of the crown, so the component along its baking direction reverses.
    const n = texture(normals, tuv).rgb.mul(2).sub(1), qn = mix(vec3(0, 0, 1), vec3(1, 0, 0), view), yaw = vec2(cos(turn), sin(turn)).toVarying();
    const seen = n.sub(qn.mul(dot(n, qn)).mul(float(1).sub(faceDirection)));
    mat.normalNode = transformNormalToView(vec3(seen.x.mul(yaw.x).add(seen.z.mul(yaw.y)), seen.y, seen.z.mul(yaw.x).sub(seen.x.mul(yaw.y)))).normalize();
    // keep coverage at distance (mipmapped alpha thins out foliage) and fade out at the far limit
    const cover = float(1).add(dist.div(msaa ? 1600.0 : 450.0));
    mat.opacityNode = texel.a.mul(cover).mul(float(1).sub(smoothstep(this.farDist * 0.85, this.farDist, dist)));
    mat.setupLightingModel = () => new FoliageLighting(0.2, 0.4);
    mat.envMapIntensity = 0.5;
    mat.maskNode = farWeight.greaterThan(noise);
    this.impostorMat = mat;

    // Contact shade: each near tree darkens the snow in its well and under its boughs. It multiplies
    // what is already there, so it reads as shelter from the sky in sun, shade and at night alike.
    const disc = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    const contactMat = new THREE.MeshBasicNodeMaterial({
      transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: true,
      toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const rr = length(uv().sub(0.5)).mul(2);
    const shelter = float(1).sub(smoothstep(0.2, 1, rr)).mul(0.5).add(float(1).sub(smoothstep(0, 0.32, rr)).mul(0.3));
    const near = float(1).sub(smoothstep(CONTACT_DIST * 0.7, CONTACT_DIST, dist));
    contactMat.colorNode = mix(vec3(1), vec3(0.42, 0.52, 0.7), shelter.mul(attribute('strength', 'float')).mul(near));
    disc.setAttribute('strength', new THREE.InstancedBufferAttribute(new Float32Array(9000), 1));
    this.contact = new THREE.InstancedMesh(disc, contactMat, 9000);
    this.contact.count = 0; this.contact.frustumCulled = false; this.contact.renderOrder = 1;
    this.contact.name = 'tree-contact-shade';
    this.group.add(this.contact);
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
    const data = await (await fetch(`${this.base}/trees/${tx}_${tn}.bin.gz`)).arrayBuffer();
    const { n, x, z, y, h, r, s, seed } = await decodeTreeTile(data);
    const excluded = new Uint8Array(n);
    for (const b of this.buildings) {
      const xs=b.points.map(p=>p[0]), zs=b.points.map(p=>p[1]);
      const minX=Math.min(...xs)-1, maxX=Math.max(...xs)+1, minZ=Math.min(...zs)-1, maxZ=Math.max(...zs)+1;
      for (let i=0;i<n;i++) {
        if(x[i]<minX || x[i]>maxX || z[i]<minZ || z[i]>maxZ)continue;
        let inside=false;
        for(let a=0,prev=b.points.length-1;a<b.points.length;prev=a++){
          const p=b.points[a],q=b.points[prev];
          if((p[1]>z[i])!==(q[1]>z[i]) && x[i]<(q[0]-p[0])*(z[i]-p[1])/(q[1]-p[1])+p[0])inside=!inside;
        }
        if(inside)excluded[i]=1;
      }
    }
    const t: TileData = { tx, tn, n, x, z, y, h, r, s, seed, mesh: null, cellOf: new Int32Array(n), excluded, slope: new Float32Array(n * 2).fill(NaN) };
    for (let i = 0; i < n; i++) {
      const k = cellKey(Math.floor(x[i] / CELL), Math.floor(z[i] / CELL));
      t.cellOf[i] = k;
      let list = this.cells.get(k);
      if (!list) { list = []; this.cells.set(k, list); }
      let entry = list.find((e) => e.tile === t);
      if (!entry) { entry = { tile: t, idx: [] }; list.push(entry); }
      entry.idx.push(i);
      if (!excluded[i]) addTreeCollider(this.colliders, x[i], z[i], y[i], h[i], r[i], s[i], seed[i]);
    }
    this.buildImpostors(t);
    this.tiles.set(`${tx}_${tn}`, t);
    this.loaded += n;
    this.lastCam.set(1e9, 0, 0); // force near-set refresh
  }

  private buildImpostors(t: TileData) {
    const g = this.quad.clone();
    const tree = new Float32Array(t.n * 4);
    for (let i = 0; i < t.n; i++) {
      treeTint(t.s[i], t.x[i], t.z[i], this.tint).toArray(tree, i * 4);
      tree[i * 4 + 3] = modelOf(t.s[i], t.seed[i]) + t.seed[i] / 256;
    }
    g.setAttribute('tree', new THREE.InstancedBufferAttribute(tree, 4));
    const m = new THREE.InstancedMesh(g, this.impostorMat, t.n);
    for (let i = 0; i < t.n; i++) this.writeImpostor(m, t, i, false);
    m.receiveShadow = true;
    m.castShadow = false;
    m.computeBoundingSphere();
    m.frustumCulled = true;
    t.mesh = m;
    this.group.add(m);
  }

  /** Same yaw and lean for a tree at every level of detail, so it keeps its silhouette. */
  private pose(t: TileData, i: number) {
    this.q.setFromAxisAngle(UP, (t.seed[i] / 255) * Math.PI * 2);
    return this.q.multiply(this.q2.setFromAxisAngle(RIGHT, ((t.seed[i] * 7) % 255) / 255 * 0.04 - 0.02));
  }

  private writeImpostor(m: THREE.InstancedMesh, t: TileData, i: number, hide: boolean) {
    hide ||= !!t.excluded[i];
    const w = hide ? 0 : t.r[i] * this.halfWidth[modelOf(t.s[i], t.seed[i])];
    this.sc.set(w, hide ? 0 : t.h[i] * IMPOSTOR_HEADROOM, w);
    this.m4.compose(this.v.set(t.x[i], t.y[i] - 0.2, t.z[i]), this.pose(t, i), this.sc);
    m.setMatrixAt(i, this.m4);
  }

  /** Update the near/far split around the camera. */
  update(cam: THREE.Vector3) {
    this.viewPosition.value.copy(cam);
    this.group.visible = this.enabled;
    if (!this.enabled) return;
    if (cam.distanceToSquared(this.lastCam) < 10 * 10) return;
    this.lastCam.copy(cam);
    const ci = Math.floor(cam.x / CELL), cj = Math.floor(cam.z / CELL);
    const radius = this.nearDist + LOD_BLEND + CELL;
    const rad = Math.ceil(radius / CELL) + 1;
    const want = new Set<number>();
    for (let i = ci - rad; i <= ci + rad; i++) for (let j = cj - rad; j <= cj + rad; j++) {
      const cx = (i + 0.5) * CELL, cz = (j + 0.5) * CELL;
      if (Math.hypot(cx - cam.x, cz - cam.z) < radius) want.add(cellKey(i, j));
    }
    // update impostor visibility per tile for changed cells
    const changedTiles = new Set<TileData>();
    const setCell = (k: number, near: boolean) => {
      const list = this.cells.get(k);
      if (!list) return;
      for (const e of list) {
        if (!e.tile.mesh) continue;
        const t = e.tile;
        for (const i of e.idx) {
          const margin = t.r[i] * this.halfWidth[modelOf(t.s[i], t.seed[i])] + 11;
          const hide = near && Math.hypot(t.x[i] - cam.x, t.z[i] - cam.z) < this.nearDist - LOD_BLEND - margin;
          this.writeImpostor(t.mesh!, t, i, hide);
        }
        changedTiles.add(e.tile);
      }
    };
    for (const k of this.nearCells) if (!want.has(k)) setCell(k, false);
    for (const k of want) setCell(k, true);
    this.nearCells = want;
    for (const t of changedTiles) t.mesh!.instanceMatrix.needsUpdate = true;
    // rebuild near meshes
    const counts = [MODELS.map(() => 0), MODELS.map(() => 0)];
    const high2 = HIGH_DETAIL_DIST * HIGH_DETAIL_DIST, contact2 = CONTACT_DIST * CONTACT_DIST;
    const strength = this.contact.geometry.getAttribute('strength');
    let shaded = 0;
    for (const k of want) {
      const list = this.cells.get(k);
      if (!list) continue;
      for (const e of list) {
        const t = e.tile;
        for (const i of e.idx) {
          if (t.excluded[i]) continue;
          const s = t.s[i], model = modelOf(s, t.seed[i]);
          const dx = t.x[i] - cam.x, dz = t.z[i] - cam.z, d2 = dx * dx + dz * dz;
          const margin = t.r[i] * this.halfWidth[model] + 11;
          if (d2 > (this.nearDist + LOD_BLEND + margin) ** 2) continue;
          if (d2 < contact2 && shaded < strength.count && this.ground) {
            if (Number.isNaN(t.slope[i * 2])) {
              t.slope[i * 2] = (this.ground(t.x[i] + 1.5, t.z[i]) - this.ground(t.x[i] - 1.5, t.z[i])) / 3;
              t.slope[i * 2 + 1] = (this.ground(t.x[i], t.z[i] + 1.5) - this.ground(t.x[i], t.z[i] - 1.5)) / 3;
            }
            const radius = s <= 1 ? t.r[i] * 1.2 + 0.3 : s === 2 ? t.r[i] * 0.7 + 0.4 : t.r[i] * 1.1;
            this.v.set(-t.slope[i * 2], 1, -t.slope[i * 2 + 1]).normalize();
            this.q.setFromUnitVectors(this.sc.set(0, 1, 0), this.v);
            this.m4.compose(this.v.multiplyScalar(0.05).add(this.sc.set(t.x[i], t.y[i], t.z[i])), this.q, this.sc.set(radius, 1, radius));
            this.contact.setMatrixAt(shaded, this.m4);
            strength.setX(shaded++, s <= 1 ? 1 : s === 2 ? 0.55 : 0.8);
          }
          let tier = d2 < high2 ? 0 : 1;
          if (tier === 0 && counts[0][model] >= this.nearMeshes[0][model].instanceMatrix.count) tier = 1;
          const mesh = this.nearMeshes[tier][model];
          if (counts[tier][model] >= mesh.instanceMatrix.count) continue;
          this.sc.set(t.r[i], t.h[i], t.r[i]);
          this.m4.compose(this.v.set(t.x[i], t.y[i] - 0.2, t.z[i]), this.pose(t, i), this.sc);
          mesh.setColorAt(counts[tier][model], treeTint(s, t.x[i], t.z[i], this.tint));
          mesh.setMatrixAt(counts[tier][model]++, this.m4);
        }
      }
    }
    for (let tier = 0; tier < 2; tier++) for (let m = 0; m < MODELS.length; m++) {
      const mesh = this.nearMeshes[tier][m];
      mesh.count = counts[tier][m];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
    this.contact.count = shaded;
    this.contact.instanceMatrix.needsUpdate = true;
    strength.needsUpdate = true;
  }

  /** Nearest trunk distance (for audio/AI); returns Infinity if none within maxD. */
  countNear(x: number, z: number, radius: number) {
    let c = 0;
    const list = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return 0;
    for (const e of list) for (const i of e.idx) if (!e.tile.excluded[i] && Math.hypot(e.tile.x[i] - x, e.tile.z[i] - z) < radius) c++;
    return c;
  }
}
