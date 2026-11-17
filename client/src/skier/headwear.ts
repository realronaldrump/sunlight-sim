// Original headwear, in the head joint's frame. The skier looks along -Z.
import * as THREE from 'three/webgpu';
import { mergeStatic } from '../world/mergeStatic';

export type Hat = 'helmet' | 'beanie';
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const finish = (color: number, roughness: number, metalness = 0) =>
  new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
const webbing = finish(0x252a31, 0.91),
  edge = finish(0x151b20, 0.54),
  trim = finish(0x83959c, 0.36, 0.49);
const tinted = (color: number, roughness: number) => {
  const m = finish(color, roughness);
  m.vertexColors = true;
  m.userData.headwearTint = true;
  return m;
};
const shell = tinted(0x394653, 0.36),
  yarn = tinted(0x784956, 0.96);
const lens = new THREE.MeshPhysicalNodeMaterial({
  vertexColors: true,
  metalness: 0.48,
  roughness: 0.165,
  clearcoat: 0.88,
  clearcoatRoughness: 0.12,
});

function grid(
  parent: THREE.Group,
  mat: THREE.Material,
  rows: number,
  cols: number,
  point: (u: number, v: number) => THREE.Vector3,
  pigment?: (u: number, v: number) => THREE.Color,
) {
  const pos: number[] = [],
    col: number[] = [],
    ind: number[] = [];
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const u = i / cols,
        v = j / rows;
      pos.push(...point(u, v).toArray());
      if (pigment) col.push(...pigment(u, v).toArray());
      if (i < cols && j < rows) {
        const a = j * (cols + 1) + i,
          b = a + cols + 1;
        ind.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(ind);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (pigment) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  parent.add(new THREE.Mesh(geo, mat));
}

function oval(group: THREE.Group, mat: THREE.Material, p: THREE.Vector3, size: THREE.Vector3, seg = 18) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, seg, Math.ceil(seg * 0.65)), mat);
  m.position.copy(p);
  m.scale.copy(size);
  group.add(m);
  return m;
}
function cord(group: THREE.Group, mat: THREE.Material, points: THREE.Vector3[], r: number) {
  group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 14, r, 6, false), mat));
}
const gray = (n: number) => new THREE.Color(n, n, n);

function helmet() {
  const g = new THREE.Group();
  g.name = 'helmet-and-goggles';
  const crown = (a: number, p: number, lift = 0) =>
    V(
      (0.111 + lift) * Math.sin(p) * Math.sin(a),
      0.052 + (0.128 + lift) * Math.cos(p),
      0.004 - (0.137 + lift) * Math.sin(p) * Math.cos(a),
    );
  const brim = (a: number) => 1.75 - 0.19 * Math.cos(a);
  grid(
    g,
    shell,
    20,
    52,
    (u, v) => {
      const a = u * Math.PI * 2;
      return crown(a, brim(a) * (1 - v) + 0.001);
    },
    (u, v) =>
      gray(
        0.91 + 0.09 * Math.sin((v * Math.PI) / 2) - 0.075 * Math.exp(-((Math.sin(u * Math.PI * 2) * 5) ** 2)),
      ),
  );
  const rim: THREE.Vector3[] = [];
  for (let i = 0; i <= 56; i++) {
    const a = (i / 56) * 2 * Math.PI;
    rim.push(crown(a, brim(a)));
  }
  g.add(
    new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim, false), 64, 0.0036, 6, false), edge),
  );
  // Rounded vent throats conform to the crown; their raised rims follow its curvature.
  for (const side of [-1, 1])
    for (const [az, start, end] of [
      [0.66, 0.39, 0.82],
      [1.2, 0.66, 1.08],
      [2.48, 0.53, 1.01],
    ]) {
      const vent = (width: number, lift: number) => (u: number, v: number) => {
        const p = end + (start - end) * v;
        const w = width * Math.sqrt(Math.max(0.018, 1 - (2 * v - 1) ** 8));
        return crown(side * az + (u - 0.5) * w + side * (p - start) * 0.16, p, lift);
      };
      grid(g, webbing, 14, 4, vent(0.17, 0.001));
      grid(g, edge, 14, 3, vent(0.105, 0.0018));
    }
  // Strap printed in two restrained bands around the back of the helmet.
  const band = (u: number, v: number, r: number) => {
    const a = 1.0 + u * (2 * Math.PI - 2);
    return V(r * Math.sin(a), 0.026 + 0.029 * v + 0.005 * Math.cos(a), 0.006 - r * 1.23 * Math.cos(a));
  };
  grid(g, webbing, 2, 48, (u, v) => band(u, v, 0.112));
  grid(g, trim, 1, 48, (u, v) => band(u, 0.7 + 0.08 * v, 0.1126));

  for (const side of [-1, 1]) {
    const pad = oval(g, webbing, V(side * 0.095, -0.013, 0.009), V(0.019, 0.046, 0.043));
    pad.rotation.z = side * 0.12;
    cord(
      g,
      edge,
      [V(side * 0.1, 0.012, -0.04), V(side * 0.084, -0.057, -0.032), V(side * 0.054, -0.085, -0.01)],
      0.0045,
    );
    cord(
      g,
      webbing,
      [V(side * 0.098, 0.008, 0.046), V(side * 0.083, -0.052, 0.0), V(side * 0.067, -0.075, -0.013)],
      0.0045,
    );
  }
  const glassPoint = (u: number, v: number, border: boolean) => {
    const q = u * 2 - 1,
      corner = 1 - 0.089 * Math.abs(2 * v - 1) ** 4 * Math.abs(q) ** 5;
    const angle = q * (border ? 1.2 : 1.16) * corner,
      r = border ? 0.126 : 0.129;
    const round = 1 - 0.33 * Math.abs(q) ** 3;
    const notch = 0.021 * Math.exp(-((q / 0.23) ** 2));
    const bot = 0.034 - (border ? 0.037 : 0.031) * round + notch;
    const top = 0.035 + (border ? 0.041 : 0.036) * round;
    return V(
      r * Math.sin(angle),
      bot + v * (top - bot),
      -0.004 - (0.143 + 0.004 * Math.sin(v * Math.PI) + (border ? 0 : 0.003)) * Math.cos(angle),
    );
  };
  grid(g, edge, 10, 40, (u, v) => glassPoint(u, v, true));
  const sky = new THREE.Color(0x4977a2),
    copper = new THREE.Color(0xbc684c),
    ice = new THREE.Color(0xbfd7da),
    forest = new THREE.Color(0x465866);
  grid(
    g,
    lens,
    23,
    48,
    (u, v) => glassPoint(u, v, false),
    (u, v) => {
      const horizon = 0.4 + 0.035 * Math.sin(u * 10) + 0.02 * Math.sin(u * 22);
      const snow = THREE.MathUtils.smoothstep(v, horizon - 0.06, horizon);
      const ridge = THREE.MathUtils.smoothstep(v, horizon, horizon + 0.065);
      return forest
        .clone()
        .lerp(ice, snow * 0.9)
        .lerp(copper, ridge * 0.93)
        .lerp(sky, THREE.MathUtils.smoothstep(v, 0.55, 1) * 0.95)
        .multiplyScalar(0.8 + 0.2 * Math.cos((u - 0.5) * Math.PI));
    },
  );
  mergeStatic(g);
  return g;
}

function beanie() {
  const g = new THREE.Group();
  g.name = 'rib-knit-beanie';
  const hair = finish(0x47382f, 0.94);
  const point = (a: number, r: number, y: number) => V(r * Math.sin(a), y, 0.001 - r * 1.23 * Math.cos(a));
  const crownY = (a: number) => 0.07 + 0.009 * Math.cos(a);
  grid(
    g,
    yarn,
    27,
    112,
    (u, v) => {
      const a = u * Math.PI * 2,
        phi = ((1 - v) * Math.PI) / 2;
      const r = (0.1 + 0.003 * Math.sin(v * Math.PI)) * Math.sin(phi) * (1 + 0.0025 * Math.cos(a * 28));
      const p = point(a, r, crownY(a) + 0.104 * Math.cos(phi));
      p.x += 0.01 * v * v;
      p.z += 0.017 * v * v;
      return p;
    },
    (u, v) =>
      gray(0.88 + 0.045 * Math.cos(u * Math.PI * 56) + 0.04 * Math.cos((v * 32 + u * 28) * Math.PI * 2)),
  );
  grid(
    g,
    yarn,
    16,
    144,
    (u, v) => {
      const a = u * Math.PI * 2,
        r = 0.1 + 0.005 * Math.sin(v * Math.PI) + 0.0009 * Math.cos(a * 36);
      return point(a, r, crownY(a) - 0.014 + 0.036 * v);
    },
    (u, v) => gray((0.88 + 0.11 * Math.cos(u * Math.PI * 72)) * (v > 0.61 && v < 0.76 ? 0.52 : 1)),
  );
  const wool = finish(0xbfb4a1, 0.97);
  const pom = oval(g, wool, V(0.01, 0.179, 0.02), V(0.024, 0.021, 0.025), 14);
  const fibers = pom.geometry.getAttribute('position');
  for (let i = 0; i < fibers.count; i++) {
    const x = fibers.getX(i),
      y = fibers.getY(i),
      z = fibers.getZ(i),
      r = 1 + 0.085 * Math.sin(x * 13 + z * 22) * Math.cos(y * 18);
    fibers.setXYZ(i, x * r, y * r, z * r);
  }
  pom.geometry.computeVertexNormals();
  const eye = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.49 });
  const sclera = new THREE.Color(0xb2a094),
    iris = new THREE.Color(0x5a5846),
    pupil = new THREE.Color(0x292322);
  for (const side of [-1, 1]) {
    // Seat each eye behind the mesh eyelids. The iris is clipped by the almond opening.
    grid(
      g,
      eye,
      14,
      30,
      (u, v) => {
        const q = 2 * u - 1,
          h = Math.max(0, 1 - q * q),
          dx = q * 0.0145;
        return V(
          side * 0.034 + dx,
          0.0405 + side * dx * 0.065 + (v - 0.43) * 0.0088 * h,
          -0.0988 + side * dx * 0.3 + 0.0046 * q * q + 0.0012 * (2 * v - 1) ** 2,
        );
      },
      (u, v) => {
        const q = 2 * u - 1,
          dx = q * 0.0145,
          dy = (v - 0.43) * 0.0088 * (1 - q * q);
        const r = Math.hypot(dx, dy);
        const ink = sclera
          .clone()
          .lerp(iris, 1 - THREE.MathUtils.smoothstep(r, 0.0047, 0.0057))
          .lerp(pupil, 1 - THREE.MathUtils.smoothstep(r, 0.002, 0.0026));
        return ink.multiplyScalar(0.65 + 0.3 * Math.sin(Math.PI * v));
      },
    );
    // One scalloped hairline follows the skull under the cuff instead of hanging clear of the ears.
    grid(g, hair, 3, 22, (u, v) => {
      const a = side > 0 ? 1.11 + u * 1.1 : -2.21 + u * 1.1;
      const bottom = 0.01 + 0.015 * Math.cos(a * 3) + 0.004 * Math.sin(a * 18);
      return point(a, 0.088 + 0.009 * v, bottom + (crownY(a) - bottom) * v);
    });
  }
  mergeStatic(g);
  return g;
}

const shapes = new Map<Hat, THREE.Group>();
export function headwear(kind: Hat, tint?: THREE.Color) {
  let shape = shapes.get(kind);
  if (!shape) {
    shape = kind === 'helmet' ? helmet() : beanie();
    shapes.set(kind, shape);
  }
  const group = shape.clone();
  // Only dyes are per wearer. Lens, webbing, hair and geometry stay shared.
  for (const child of group.children) {
    const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardNodeMaterial>;
    if (mesh.material.userData.headwearTint) {
      mesh.material = mesh.material.clone();
      if (tint) mesh.material.color.copy(tint);
    }
  }
  return group;
}

export function tintHeadwear(group: THREE.Group, color: THREE.ColorRepresentation) {
  for (const child of group.children) {
    const mat = (child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardNodeMaterial>).material;
    if (mat?.userData.headwearTint) mat.color.set(color);
  }
}
