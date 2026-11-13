// Engelmann spruce, subalpine fir and Douglas-fir in winter. Each bough is a drooping needle fan with a
// hanging side curtain, so the crown is full from every direction instead of a stack of edge-on cards.
// Geometry is modeled in meters and normalized to height 1 and crown radius 1 for lidar instancing.
import * as THREE from 'three/webgpu';
import { CONIFER_FORMS, CONIFER_HEIGHT, CONIFER_RADIUS, CONIFER_VARIANTS, boughRise, coniferBoughs } from '../../../shared/treeData';

const ATLAS = 1024;
/** Atlas regions in canvas pixels: [x, y, width, height]. */
const REGION = {
  fanLight: [0, 0, 512, 384], fanHeavy: [512, 0, 512, 384],
  curtainCapped: [0, 384, 512, 256], curtainBare: [512, 384, 512, 256],
  tip: [0, 640, 256, 256], dead: [256, 640, 512, 128], bark: [0, 934, 1024, 84],
} as const;
type Region = keyof typeof REGION;
const uvOf = (name: Region) => {
  const [x, y, w, h] = REGION[name];
  return { u0: x / ATLAS, u1: (x + w) / ATLAS, top: 1 - y / ATLAS, bottom: 1 - (y + h) / ATLAS };
};

function rand(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

type V3 = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Accumulates non-indexed triangles in normalized tree space. */
class Builder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = [];
  /** Lowest height a vertex may take: boughs rest on the snow instead of passing through it. */
  floor = 0;
  constructor(private R: number, private H: number) {}
  private vert(p: V3, n: V3, u: number, v: number, c: number, tint: readonly number[]) {
    this.pos.push(p.x / this.R, Math.max(this.floor, p.y) / this.H, p.z / this.R);
    // inverse-transpose of the normalizing scale, so instance scaling restores the modeled direction
    const nx = n.x * this.R, ny = n.y * this.H, nz = n.z * this.R, l = Math.hypot(nx, ny, nz) || 1;
    this.nor.push(nx / l, ny / l, nz / l);
    this.uv.push(u, v);
    this.col.push(c * tint[0], c * tint[1], c * tint[2]);
  }
  /** Ribbon through `pts`; edge A is pts + sides (v = vA), edge B is pts - sides (v = vB). */
  ribbon(pts: V3[], sides: V3[], us: number[], vA: number, vB: number, normals: V3[], shadeA: number[], shadeB: number[], tint: readonly number[] = [1, 1, 1]) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a0 = pts[i].clone().add(sides[i]), b0 = pts[i].clone().sub(sides[i]);
      const a1 = pts[i + 1].clone().add(sides[i + 1]), b1 = pts[i + 1].clone().sub(sides[i + 1]);
      const n0 = normals[i], n1 = normals[i + 1], j = i + 1;
      this.vert(a0, n0, us[i], vA, shadeA[i], tint); this.vert(b0, n0, us[i], vB, shadeB[i], tint); this.vert(a1, n1, us[j], vA, shadeA[j], tint);
      this.vert(b0, n0, us[i], vB, shadeB[i], tint); this.vert(b1, n1, us[j], vB, shadeB[j], tint); this.vert(a1, n1, us[j], vA, shadeA[j], tint);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

export function coniferGeometry(kind: 0 | 1, detail: 'high' | 'low', variant = 0): THREE.BufferGeometry {
  const H = CONIFER_HEIGHT, R = CONIFER_RADIUS, high = detail === 'high';
  const form = CONIFER_FORMS[kind][variant % CONIFER_VARIANTS];
  const out = new Builder(R, H);
  const up = v3(0, 1, 0);
  const lerp = THREE.MathUtils.lerp;

  // Trunk: flared at the root, bark from the atlas strip, shaded inside the crown.
  const bark = uvOf('bark'), girth = kind === 1 ? 1.18 : 1;
  const barkTint = kind === 1 ? [.8, .7, .64] : [1, .97, .95];
  const rings = high ? [0, .45, 1.5, 4, 8, 11.5, H] : [0, 1.5, 7, H];
  const sidesN = high ? 8 : 5;
  const radius = (y: number) => (.016 + .175 * (1 - y / H) ** 1.15 + .07 * Math.exp(-y * 2.5)) * girth;
  for (let k = 0; k < sidesN; k++) {
    const a0 = k / sidesN * Math.PI * 2, a1 = (k + 1) / sidesN * Math.PI * 2;
    const pts = rings.map(y => v3(Math.cos((a0 + a1) / 2) * radius(y) * Math.cos(Math.PI / sidesN), y, Math.sin((a0 + a1) / 2) * radius(y) * Math.cos(Math.PI / sidesN)));
    const side = rings.map(y => v3(-Math.sin((a0 + a1) / 2), 0, Math.cos((a0 + a1) / 2)).multiplyScalar(radius(y) * Math.sin(Math.PI / sidesN)));
    const n = rings.map(() => v3(Math.cos((a0 + a1) / 2), .08, Math.sin((a0 + a1) / 2)).normalize());
    const shade = rings.map(y => y < H * form.base ? .95 : .62);
    const vA = lerp(bark.bottom, bark.top, (k + 1) / sidesN), vB = lerp(bark.bottom, bark.top, k / sidesN);
    out.ribbon(pts, side, rings.map(y => lerp(bark.u0, bark.u1, y / H)), vA, vB, n, shade, shade, barkTint);
  }

  out.floor = .05;
  const fanLight = uvOf('fanLight'), fanHeavy = uvOf('fanHeavy'), capped = uvOf('curtainCapped'), bare = uvOf('curtainBare'), dead = uvOf('dead');
  const sections = high ? [.04, .38, .72, 1] : [.04, .55, 1];
  for (const b of coniferBoughs(kind, detail, variant)) {
    const d = v3(Math.cos(b.angle), 0, -Math.sin(b.angle)), l = v3(-d.z, 0, d.x);
    const at = (s: number) => d.clone().multiplyScalar(b.reach * s).setY(b.level + boughRise(b, s));
    const crownT = THREE.MathUtils.clamp((b.level / H - form.base) / (1 - form.base), 0, 1);
    // Needles near the trunk and low in the crown see less sky.
    const ao = (s: number) => (.5 + .5 * s ** .7) * (.8 + .2 * crownT);
    const normal = (s: number) => d.clone().multiplyScalar(.5 + .4 * s).addScaledVector(up, .62).normalize();
    if (b.dead) {
      const len = b.reach, pts = [at(0), at(1)], us = [dead.u0, dead.u1], n = [normal(.5), normal(.5)];
      out.ribbon(pts, [up.clone().multiplyScalar(len * .13), up.clone().multiplyScalar(len * .13)], us, dead.top, dead.bottom, n, [.9, .9], [.9, .9]);
      if (high) out.ribbon(pts, [l.clone().multiplyScalar(len * .13), l.clone().multiplyScalar(len * .13)], us, dead.top, dead.bottom, n, [.9, .9], [.9, .9]);
      continue;
    }
    const wide = high ? 1 : 1.6;
    const pts = sections.map(at), us = sections.map(s => (s - .04) / .96);
    const normals = sections.map(normal);
    // Fan: the flat spray of branchlets, rolled a little so no two lie in the same plane.
    const fan = b.snow > .62 ? fanHeavy : fanLight;
    const hw = (.14 + .33 * b.reach) * wide;
    const fanSides = sections.map(s => l.clone().multiplyScalar(Math.cos(b.roll)).addScaledVector(up, Math.sin(b.roll)).multiplyScalar(hw * (s > .9 ? .62 : 1)));
    const shadeF = sections.map(s => ao(s) * b.shades[0]);
    out.ribbon(pts, fanSides, us.map(u => lerp(fan.u0, fan.u1, u)), fan.top, fan.bottom, normals, shadeF, shadeF);
    // Curtain: branchlets hanging below the limb, which carries the silhouette seen from the side.
    const curtain = b.snow > .34 ? capped : bare;
    const hc = (.42 + .2 * b.reach) * (high ? 1 : 1.75);
    const drape = sections.map(s => at(s).addScaledVector(up, -hc * .3));
    const curtainSides = sections.map(() => up.clone().multiplyScalar(hc / 2));
    out.ribbon(drape, curtainSides, us.map(u => lerp(curtain.u0, curtain.u1, u)), curtain.top, curtain.bottom, normals,
      sections.map(s => ao(s) * b.shades[1]), sections.map(s => ao(s) * b.shades[1] * .78));
    if (!high || !b.forked) continue;
    // Side sprays fork off the limb and sag at their outer edge.
    [[.34, 1, .52], [.58, -1, .4]].forEach(([s, sign, share], i) => {
      const dir = d.clone().multiplyScalar(Math.cos(.75)).addScaledVector(l, sign * Math.sin(.75));
      const len = b.reach * share, start = at(s);
      const slope = (-b.drop + 2 * b.lift * s) / b.reach - .18;
      const end = start.clone().addScaledVector(dir, len); end.y += slope * len;
      const across = v3(-dir.z, 0, dir.x).multiplyScalar(.1 + .3 * len).setY(-sign * .12 * len);
      const f = (b.snow + i * .3) % 1 > .55 ? fanHeavy : fanLight;
      const shade = ao(s + .2) * b.shades[2 + i];
      out.ribbon([start, end], [across, across.clone().multiplyScalar(.62)], [f.u0, f.u1], f.top, f.bottom, [normal(s), normal(Math.min(1, s + .3))], [shade * .9, shade], [shade * .9, shade]);
    });
  }

  // Crown top: a leader spray, twin leaders, or a weathered dead spike left bare.
  const tip = uvOf('tip');
  const leader = (x: number, z: number, y0: number, y1: number, hw: number, turn: number) => {
    for (const a of [turn, turn + Math.PI / 2]) {
      const side = v3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(hw);
      const n = v3(Math.cos(a + .8) * .5, .8, Math.sin(a + .8) * .5).normalize();
      out.ribbon([v3(x, y0, z), v3(x * .4, y1, z * .4)], [side, side.clone().multiplyScalar(.55)], [tip.u0, tip.u1], tip.top, tip.bottom, [n, n], [.82, 1], [.82, 1]);
    }
  };
  if (form.top === 0) leader(0, 0, H - (high ? 1.5 : 1.9), H, high ? .5 : .62, variant);
  if (form.top === 2) { leader(.32, .1, H - 1.9, H, .46, 1); leader(-.3, -.14, H - 2.5, H - .7, .46, 2.2); }
  return out.geometry();
}

// ---------------------------------------------------------------------------------------------
// Needle atlas. Every region is drawn with its limb running left to right from the trunk end.

type Ctx = CanvasRenderingContext2D;
const GREENS = [[40, 60, 42], [33, 54, 46], [52, 68, 38], [29, 44, 33], [46, 66, 50]];
const rgb = (c: number[], k = 1) => `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0})`;

/** A woody twig from (x, y) toward `a`, clothed in needles. Returns the points it passed through. */
function twig(g: Ctx, r: () => number, x: number, y: number, a: number, len: number, curl: number, needle: number, tone: number, bareTwig = false) {
  const steps = Math.max(2, Math.ceil(len / 7));
  const pts: [number, number, number][] = [[x, y, a]];
  for (let i = 0; i < steps; i++) {
    a += curl / steps + (r() - .5) * .12;
    x += Math.cos(a) * len / steps; y += Math.sin(a) * len / steps;
    pts.push([x, y, a]);
  }
  g.strokeStyle = bareTwig ? rgb([104, 94, 86], .8 + r() * .4) : rgb([58, 44, 34], .8 + r() * .4);
  g.lineWidth = bareTwig ? 1.6 : 1.1;
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) g.lineTo(p[0], p[1]);
  g.stroke();
  if (bareTwig) return pts;
  // Two tones per twig: shaded needles underneath, sunlit ones over them.
  for (const layer of [.62, 1]) {
    g.strokeStyle = rgb(GREENS[(r() * GREENS.length) | 0], tone * layer * (.8 + r() * .45));
    g.lineWidth = layer < 1 ? 1.9 : 1.25;
    g.beginPath();
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0, dir] = pts[i], [x1, y1] = pts[i + 1];
      for (let k = 0; k < 4; k++) {
        const t = (k + r()) / 4, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
        for (const side of [-1, 1]) {
          const na = dir + side * (.55 + r() * .6), nl = needle * (.65 + r() * .55);
          g.moveTo(px, py); g.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl);
        }
      }
    }
    g.stroke();
  }
  return pts;
}

/** A lumpy pad of settled snow with a blue-grey shaded underside. */
function snowPad(g: Ctx, r: () => number, x: number, y: number, rx: number, ry: number, rot: number) {
  const lobes = 2 + ((r() * 3) | 0);
  for (const [fill, dy, k] of [['rgb(166,184,208)', 2.2, 1], ['rgb(238,243,250)', 0, .9]] as const) {
    g.fillStyle = fill;
    for (let i = 0; i < lobes; i++) {
      const o = (i / Math.max(1, lobes - 1) - .5) * rx * 1.1;
      g.beginPath();
      g.ellipse(x + Math.cos(rot) * o, y + Math.sin(rot) * o + dy, rx * (.55 + (i % 2) * .2) * k, ry * (.8 + ((i + 1) % 2) * .3) * k, rot, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** Top view of a bough: branchlets sweep forward off the limb in a pointed fan. */
function paintFan(g: Ctx, r: () => number, [x0, y0, w, h]: readonly number[], heavy: boolean) {
  const yc = y0 + h / 2, len = w - 14, xs = x0 + 4;
  const shape = (t: number) => Math.sin(Math.PI * t ** .72) ** .75;
  // an opaque shaded core, so the bough never thins to nothing at a distance
  g.fillStyle = 'rgb(24,37,29)';
  g.beginPath(); g.moveTo(xs, yc);
  for (let i = 0; i <= 24; i++) g.lineTo(xs + len * i / 24, yc - h * .3 * shape(i / 24));
  for (let i = 24; i >= 0; i--) g.lineTo(xs + len * i / 24, yc + h * .3 * shape(i / 24));
  g.fill();
  const sprays: { x: number; y: number; a: number; len: number }[] = [];
  for (let x = 10; x < len - 6; x += 9 + r() * 5) {
    const t = x / len;
    for (const side of [-1, 1]) {
      const a = side * (1.0 - .42 * t + (r() - .5) * .25), l2 = h * .47 * shape(t) * (.72 + r() * .28);
      if (l2 < 6) continue;
      const tone = .85 + r() * .4;
      const pts = twig(g, r, xs + x, yc, a, l2, -side * .25, 6.5, tone);
      sprays.push({ x: xs + x, y: yc, a, len: l2 });
      for (let i = 2; i < pts.length - 1; i += 2) {
        const [px, py, pa] = pts[i], rest = 1 - i / pts.length;
        twig(g, r, px, py, pa + (i % 4 ? 1 : -1) * (.6 + r() * .3), (10 + r() * 12) * (.5 + rest), 0, 5.5, tone * (.9 + r() * .3));
      }
    }
  }
  twig(g, r, xs, yc, 0, len, 0, 6, 1.05);
  // fresh growth catches the light at the tips
  for (const s of sprays) if (r() < .5) twig(g, r, s.x + Math.cos(s.a) * s.len * .86, s.y + Math.sin(s.a) * s.len * .86, s.a - Math.sign(s.a) * .2, s.len * .16, 0, 5, 1.5);
  if (heavy) {
    for (let x = 26; x < len * .86; x += 30 + r() * 26) snowPad(g, r, xs + x, yc + (r() - .5) * 8, 20 + r() * 14, 9 + r() * 5, (r() - .5) * .3);
    for (const s of sprays) if (s.len > 34 && r() < .5) {
      const k = .3 + r() * .2;
      snowPad(g, r, s.x + Math.cos(s.a) * s.len * k, s.y + Math.sin(s.a) * s.len * k, s.len * .3, 5 + r() * 4, s.a);
    }
  } else {
    for (const s of sprays) if (s.len > 30 && r() < .2) {
      const k = .2 + r() * .45;
      snowPad(g, r, s.x + Math.cos(s.a) * s.len * k, s.y + Math.sin(s.a) * s.len * k, 6 + r() * 9, 3 + r() * 3, s.a);
    }
  }
  // a dusting caught on the needles
  g.fillStyle = 'rgba(232,238,246,0.85)';
  for (let i = 0; i < (heavy ? 420 : 170); i++) {
    const t = r(), x = xs + len * t, y = yc + (r() * 2 - 1) * h * .42 * shape(t);
    g.fillRect(x, y, 1 + r() * 1.6, 1 + r() * 1.2);
  }
}

/** Side view of a bough: branchlets hang below the limb and their tips sweep forward. */
function paintCurtain(g: Ctx, r: () => number, [x0, y0, w, h]: readonly number[], capped: boolean) {
  const len = w - 12, xs = x0 + 4;
  const spine = (t: number) => y0 + h * (.2 + .05 * Math.sin(Math.PI * t));
  const shape = (t: number) => .4 + .6 * Math.sin(Math.PI * Math.min(1, t * 1.05) ** .8);
  g.fillStyle = 'rgb(23,35,28)';
  g.beginPath(); g.moveTo(xs, spine(0) - 3);
  for (let i = 0; i <= 20; i++) g.lineTo(xs + len * i / 20, spine(i / 20) - 5);
  for (let i = 20; i >= 0; i--) g.lineTo(xs + len * i / 20, spine(i / 20) + h * (capped ? .3 : .14) * shape(i / 20));
  g.fill();
  for (let x = 6; x < len - 4; x += 8 + r() * 5) {
    const t = x / len, y = spine(t);
    if (!capped && r() < .5) {
      // old limbs: a few bare twigs and strands of pale beard lichen
      if (r() < .4) twig(g, r, xs + x, y, 1.1 + r() * .5, h * .3 * (.4 + r()), -.3, 0, 1, true);
      if (r() < .35) { g.strokeStyle = 'rgba(158,170,142,0.9)'; g.lineWidth = 1; g.beginPath(); g.moveTo(xs + x, y); g.lineTo(xs + x + (r() - .5) * 5, y + 10 + r() * 24); g.stroke(); }
      continue;
    }
    const tone = .8 + r() * .45, l2 = h * .7 * shape(t) * (.55 + r() * .45);
    const pts = twig(g, r, xs + x, y, 1.3 - .35 * t + (r() - .5) * .3, l2, -.75, 6.5, tone);
    for (let i = 2; i < pts.length - 1; i += 2) {
      const [px, py, pa] = pts[i];
      twig(g, r, px, py, pa + (i % 4 ? .7 : -.7), 9 + r() * 12, 0, 5.5, tone * (.9 + r() * .3));
    }
    if (r() < .45) twig(g, r, xs + x, y, -(.45 + r() * .5), 10 + r() * 16, .2, 6, tone * 1.15);
  }
  twig(g, r, xs, spine(0), .06, len, -.1, 6, 1);
  if (capped) {
    for (let x = 14; x < len * .93; x += 20 + r() * 16) {
      if (r() < .2) continue;
      snowPad(g, r, xs + x, spine(x / len) - 6 - r() * 3, 13 + r() * 12, 5 + r() * 4, .05);
    }
    g.fillStyle = 'rgba(232,238,246,0.85)';
    for (let i = 0; i < 150; i++) g.fillRect(xs + r() * len, y0 + h * (.2 + r() * .5), 1 + r() * 1.5, 1 + r());
  }
}

/** Atlas canvas shared by the near meshes and the impostor bake. */
export function coniferAtlasCanvas(): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = cv.height = ATLAS;
  const g = cv.getContext('2d')!;
  g.lineCap = 'round';
  const r = rand(83);
  paintFan(g, r, REGION.fanLight, false);
  paintFan(g, r, REGION.fanHeavy, true);
  paintCurtain(g, r, REGION.curtainCapped, true);
  paintCurtain(g, r, REGION.curtainBare, false);
  { // leader spray: short ascending shoots around the top of the stem
    const [x0, y0, w, h] = REGION.tip, yc = y0 + h / 2;
    g.fillStyle = 'rgb(24,37,29)';
    g.beginPath(); g.moveTo(x0 + 4, yc - h * .2); g.lineTo(x0 + w * .8, yc); g.lineTo(x0 + 4, yc + h * .2); g.fill();
    for (let x = 4; x < w - 30; x += 7 + r() * 4) {
      const t = x / w;
      for (const side of [-1, 1]) twig(g, r, x0 + x, yc, side * (.95 - .3 * t), h * .44 * (1 - t) ** .8 * (.7 + r() * .3) + 6, -side * .5, 6.5, .9 + r() * .4);
    }
    twig(g, r, x0 + 2, yc, 0, w - 10, 0, 6, 1.1);
    for (let x = 30; x < w - 40; x += 34 + r() * 20) snowPad(g, r, x0 + x, yc + (r() - .5) * 26 * (1 - x / w), 9 + r() * 7, 4 + r() * 3, (r() - .5));
    snowPad(g, r, x0 + w - 14, yc, 7, 4, 0);
  }
  { // weathered dead limb
    const [x0, y0, w, h] = REGION.dead, yc = y0 + h / 2;
    const pts = twig(g, r, x0 + 3, yc, 0, w - 10, .1, 0, 1, true);
    g.lineWidth = 3; g.strokeStyle = 'rgb(96,86,78)'; g.beginPath(); g.moveTo(x0 + 3, yc); g.lineTo(x0 + w * .55, pts[Math.floor(pts.length * .55)][1]); g.stroke();
    for (let i = 3; i < pts.length - 2; i += 3) twig(g, r, pts[i][0], pts[i][1], (i % 2 ? 1 : -1) * (.5 + r() * .5), (h * .42) * (.4 + r() * .6), (r() - .5), 0, 1, true);
  }
  { // bark strip: furrows run along the trunk (u), plates and lichen break it up
    const [x0, y0, w, h] = [0, 924, 1024, 100];
    g.fillStyle = 'rgb(88,76,70)'; g.fillRect(x0, y0, w, h);
    for (let i = 0; i < 520; i++) {
      const x = r() * w, y = y0 + r() * h, l = 24 + r() * 120, dark = r() < .55;
      g.strokeStyle = dark ? `rgba(38,30,27,${.5 + r() * .4})` : `rgba(${128 + r() * 30 | 0},${112 + r() * 26 | 0},${102 + r() * 24 | 0},${.35 + r() * .35})`;
      g.lineWidth = dark ? 1.4 + r() * 2.2 : 2 + r() * 3;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y + (r() - .5) * 7, x + l, y + (r() - .5) * 5); g.stroke();
    }
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(150,160,134,${.25 + r() * .3})`; g.fillRect(r() * w, y0 + r() * h, 3 + r() * 9, 2 + r() * 4); }
  }
  return cv;
}
