// Alpine hardgoods in metres. Each moving piece shares a fixed geometry template across skiers.
import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeStatic } from '../world/mergeStatic';

const material = (color: number, roughness: number, metalness = 0) =>
  new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
const rubber = material(0x22272c, 0.92),
  shell = material(0x35454c, 0.37);
const tongue = material(0x526371, 0.43),
  metal = material(0xc0c6c7, 0.28, 0.72);
const orange = material(0xe58746, 0.45),
  cream = material(0xf3e8d3, 0.3),
  lacquer = material(0xa7283b, 0.32, 0.18);
const steel = material(0x919caa, 0.3, 0.67),
  base = material(0x1d2b32, 0.7);
const print = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.12 });

function part(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}
function box(
  parent: THREE.Group,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  r = 0.004,
) {
  return part(new RoundedBoxGeometry(w, h, d, 1, r), mat, parent, x, y, z);
}
function oval(
  parent: THREE.Group,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
) {
  const m = part(new THREE.SphereGeometry(1, 18, 12), mat, parent, x, y, z);
  m.scale.set(rx, ry, rz);
  return m;
}
function strap(
  parent: THREE.Group,
  mat: THREE.Material,
  y: number,
  height: number,
  rx: number,
  rz: number,
  z: number,
) {
  const band = part(new THREE.CylinderGeometry(rx, rx * 0.97, height, 26, 1, true), mat, parent, 0, y, z);
  band.scale.z = rz / rx;
  band.rotation.x = -0.105;
  return band;
}
const prototypes = new Map<string, THREE.Group>();
function piece(name: string, build: (g: THREE.Group) => void) {
  let template = prototypes.get(name);
  if (!template) {
    template = new THREE.Group();
    template.name = name;
    build(template);
    mergeStatic(template);
    prototypes.set(name, template);
  }
  return template.clone();
}

export function skiBoot(side = 1) {
  return piece(side < 0 ? 'left-four-buckle-boot' : 'right-four-buckle-boot', (g) => {
    box(g, rubber, 0, -0.093, -0.052, 0.129, 0.026, 0.308, 0.009);
    for (const z of [-0.167, -0.13, 0.034, 0.076]) box(g, rubber, 0, -0.106, z, 0.119, 0.008, 0.022);
    // A stiff lower clog has a flat toe ledge, a sloping instep and a narrower heel.
    // Sections give the toe and buckles a common surface, including when viewed from above.
    const sections = [
      [-0.211, 0.046, -0.059],
      [-0.199, 0.057, -0.046],
      [-0.17, 0.064, -0.03],
      [-0.127, 0.068, -0.008],
      [-0.086, 0.069, 0.024],
      [-0.046, 0.068, 0.05],
      [-0.007, 0.066, 0.061],
      [0.041, 0.063, 0.038],
      [0.078, 0.055, 0.005],
      [0.086, 0.044, -0.037],
    ];
    const pos: number[] = [],
      ids: number[] = [];
    const count = 14,
      sole = -0.08;
    sections.forEach(([z, w, top], j) => {
      for (let k = 0; k <= count; k++) {
        const a = (k * Math.PI) / count;
        pos.push(-w * Math.cos(a), sole + (top - sole) * Math.sin(a) ** 0.66, z);
        if (j + 1 < sections.length && k < count) {
          const i = j * (count + 1) + k,
            b = i + count + 1;
          ids.push(i, b, i + 1, i + 1, b, b + 1);
        }
      }
    });
    for (const j of [0, sections.length - 1]) {
      const a = j * (count + 1);
      for (let k = 1; k < count; k++) ids.push(a, j === 0 ? a + k : a + k + 1, j === 0 ? a + k + 1 : a + k);
    }
    const geo = new THREE.BufferGeometry();
    geo.setIndex(ids);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    part(geo, shell, g);
    const cuff = strap(g, shell, 0.066, 0.188, 0.068, 0.074, 0.01);
    cuff.scale.x = 0.98;
    strap(g, rubber, 0.157, 0.035, 0.06, 0.067, 0.001);
    const shin = oval(g, tongue, 0, 0.081, -0.052, 0.05, 0.09, 0.026);
    shin.rotation.x = -0.13;
    strap(g, rubber, 0.133, 0.028, 0.069, 0.078, 0.003);
    box(g, orange, side * 0.041, 0.135, -0.067, 0.026, 0.016, 0.007);
    for (const [y, z, upper] of [
      [0.095, -0.077, 1],
      [0.045, -0.076, 1],
      [-0.002, -0.127, 0],
      [-0.025, -0.17, 0],
    ]) {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i < 7; i++) {
        const u = i / 3 - 1;
        points.push(
          new THREE.Vector3(
            u * 0.055,
            y - (upper ? 0.002 : 0.028) * u * u,
            z + (upper ? 0.028 : 0.006) * u * u,
          ),
        );
      }
      const curve = new THREE.CatmullRomCurve3(points);
      part(new THREE.TubeGeometry(curve, 9, 0.0038, 6, false), metal, g);
      const end = points[side < 0 ? 0 : 6];
      const lever = box(g, tongue, end.x, end.y + 0.001, end.z, 0.018, 0.014, 0.036);
      lever.rotation.y = side * 0.31;
      box(g, orange, end.x, end.y + 0.006, end.z + 0.002, 0.012, 0.006, 0.021);
    }
    for (const s of [-1, 1]) {
      const rivet = part(
        new THREE.CylinderGeometry(0.015, 0.015, 0.006, 14),
        metal,
        g,
        s * 0.073,
        0.018,
        0.015,
      );
      rivet.rotation.z = Math.PI / 2;
    }
    box(g, tongue, 0, 0.062, 0.083, 0.044, 0.086, 0.016);
    box(g, rubber, 0, 0.169, 0.064, 0.03, 0.044, 0.012);
  });
}

export function skiWithBindings(festive = false) {
  return piece(festive ? 'holiday-sidecut-ski' : 'sidecut-ski-and-bindings', (g) => {
    const surface = (t: number, u: number, underside = false) => {
      const tip = Math.max(0, (t - 0.84) / 0.16),
        tail = Math.max(0, (0.075 - t) / 0.075);
      const width =
        (0.042 + 0.02 * Math.abs((t - 0.44) * 1.78) ** 1.6) * (1 - 0.75 * tip ** 5) * (1 - 0.29 * tail ** 4);
      const top = 0.021 + 0.104 * tip ** 2 + 0.025 * tail ** 2 + 0.004 * Math.sin(t * Math.PI);
      return [u * width, top - (underside ? 0.015 : 0), 0.78 - t * 1.74];
    };
    // The diagonals are part of the laminate. Pin the strip boundaries in the mesh so even
    // the long, narrow tips stay sharp at an oblique view and on a distant chair.
    const stops = [
      0, 0.019, 0.065, 0.08, 0.093, 0.119, 0.129, 0.175, 0.239, 0.247, 0.26, 0.277, 0.36, 0.44, 0.56, 0.64,
      0.681, 0.695, 0.712, 0.755, 0.782, 0.795, 0.823, 0.842, 0.863, 0.886, 0.909, 0.93, 0.955, 0.979, 1,
    ];
    const colors = (
      festive
        ? ['#912a39', '#b45d45', '#e2b15e', '#f0dfba', '#a42b3e']
        : ['#1d3846', '#356472', '#b7d7c8', '#e79a50', '#365963']
    ).map((c) => new THREE.Color(c));
    const n = 6,
      p: number[] = [],
      c: number[] = [],
      normals: number[] = [],
      idx: number[] = [];
    for (let j = 0; j < stops.length - 1; j++) {
      const lo = stops[j],
        hi = stops[j + 1],
        m = (lo + hi) / 2;
      const ink =
        m < 0.25 ? [0, 1, 2, 0, 3, 1, 0, 4, 2][j % 9] : m < 0.67 ? 0 : [1, 0, 2, 1, 4, 3, 0, 2][j % 8];
      const offset = p.length / 3;
      for (const t of [lo, hi])
        for (let k = 0; k <= n; k++) {
          const u = (k / n) * 2 - 1;
          const bend = Math.sin(t * Math.PI) * (0.022 * u + 0.014 * Math.abs(u + 0.24));
          const v = t + bend;
          p.push(...surface(v, u));
          const pigment = colors[ink].clone().multiplyScalar(1 - 0.12 * Math.abs(u));
          if (k === 0 || k === n) pigment.lerp(colors[0], 0.28);
          c.push(...pigment.toArray());
          const eps = 0.0005,
            slope = (surface(v + eps, u)[1] - surface(v - eps, u)[1]) / (2 * eps * 1.74);
          const normal = new THREE.Vector3(0, 1, slope).normalize();
          normals.push(...normal.toArray());
        }
      for (let k = 0; k < n; k++) {
        const a = offset + k,
          b = a + n + 1;
        idx.push(a, a + 1, b + 1, a, b + 1, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    geo.setIndex(idx);
    part(geo, print, g);
    const faces: number[][] = [[], []];
    const quad = (arr: number[], a: number[], b: number[], c: number[], d: number[]) =>
      arr.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 72; i++) {
      const t = i / 72,
        s = (i + 1) / 72;
      const a = surface(t, -1, true),
        b = surface(t, 1, true),
        c = surface(s, 1, true),
        d = surface(s, -1, true);
      quad(faces[0], a, d, c, b);
      quad(faces[1], surface(t, -1), surface(s, -1), d, a);
      quad(faces[1], surface(s, 1), surface(t, 1), b, c);
    }
    quad(faces[1], surface(0, 1), surface(0, -1), surface(0, -1, true), surface(0, 1, true));
    quad(faces[1], surface(1, -1), surface(1, 1), surface(1, 1, true), surface(1, -1, true));
    faces.forEach((positions, i) => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.computeVertexNormals();
      part(geom, i === 0 ? base : steel, g);
    });
    box(g, steel, 0, 0.031, -0.024, 0.066, 0.017, 0.403);
    // Toe wings, heel cup, release lever and brake arms straddle the boot sole.
    box(g, rubber, 0, 0.046, -0.185, 0.087, 0.031, 0.075, 0.008);
    for (const s of [-1, 1]) {
      const wing = box(g, metal, s * 0.045, 0.06, -0.162, 0.018, 0.035, 0.059);
      wing.rotation.y = s * 0.3;
      const brake = box(g, steel, s * 0.049, 0.045, 0.075, 0.008, 0.009, 0.116);
      brake.rotation.y = s * 0.14;
    }
    box(g, rubber, 0, 0.058, 0.13, 0.084, 0.055, 0.073, 0.009);
    const lever = box(g, tongue, 0, 0.084, 0.163, 0.058, 0.02, 0.077);
    lever.rotation.x = -0.33;
    box(g, orange, 0, 0.089, 0.135, 0.045, 0.008, 0.024);
  });
}

const poleAxis = new THREE.Vector3(0, 1, 0);
const poleDirection = new THREE.Vector3();

/** Keep the centre of the grip inside the curled glove, even when the basket aim changes. */
export function holdPole(pole: THREE.Group, wrist: THREE.Vector3, aim: THREE.Vector3, lateralOffset = 0) {
  pole.position.set(wrist.x + lateralOffset, wrist.y - .056, wrist.z - .022);
  poleDirection.copy(aim).sub(pole.position).normalize();
  pole.quaternion.setFromUnitVectors(poleAxis, poleDirection);
  pole.position.addScaledVector(poleDirection, .51);
}

export function skiPole(festive = false) {
  return piece(festive ? 'candy-striped-pole' : 'ski-pole', (g) => {
    part(new THREE.CylinderGeometry(0.007, 0.004, 1.14, 10), festive ? cream : metal, g);
    part(new THREE.CylinderGeometry(0.016, 0.018, 0.13, 16), rubber, g, 0, -0.51);
    for (let i = 0; i < 4; i++)
      part(new THREE.TorusGeometry(0.016, 0.0024, 5, 14), tongue, g, 0, -0.464 - i * 0.024).rotation.x =
        Math.PI / 2;
    for (const [y, l] of [
      [-0.35, 0.087],
      [-0.292, 0.013],
      [-0.265, 0.008],
    ])
      part(new THREE.CylinderGeometry(0.0073, 0.0073, l, 10), orange, g, 0, y);
    if (festive) {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 110; i++) {
        const t = i / 110,
          r = 0.004 + t * 0.003;
        points.push(new THREE.Vector3(Math.cos(t * 61) * r, t * 0.95 - 0.46, Math.sin(t * 61) * r));
      }
      part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 110, 0.0023, 5, false), lacquer, g);
    }
    part(new THREE.TorusGeometry(0.036, 0.005, 6, 18), rubber, g, 0, 0.49).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++)
      box(g, rubber, 0, 0.49, 0, 0.071, 0.005, 0.005, 0.002).rotation.y = (i * Math.PI) / 3;
    part(new THREE.ConeGeometry(0.0048, 0.032, 8), steel, g, 0, 0.576);
    const loop = part(new THREE.TorusGeometry(0.027, 0.0033, 6, 20), rubber, g, 0.022, -0.491);
    loop.scale.y = 1.65;
    loop.rotation.z = -0.27;
  });
}

function collarShape() {
  const g = new THREE.Group();
  g.name = 'shell-collar-and-hood';
  const cloth = material(0xffffff, 0.86);
  cloth.vertexColors = true;
  cloth.userData.jacketTint = true;
  const pos: number[] = [],
    color: number[] = [],
    ind: number[] = [];
  // The hood is stowed over the shoulder blades. Its hollow folded lip rises into the collar.
  const rings = [
    [0.151, 0.14, -0.118, 0.054],
    [0.148, 0.141, -0.082, 0.057],
    [0.126, 0.119, -0.035, 0.045],
    [0.089, 0.091, 0.041, 0.012],
    [0.079, 0.083, 0.044, 0.01],
    [0.078, 0.081, -0.013, 0.01],
  ];
  rings.forEach(([rx, rz, h, cz], j) => {
    for (let i = 0; i <= 36; i++) {
      const a = (i * Math.PI * 2) / 36,
        front = (1 + Math.cos(a)) * 0.5;
      pos.push(rx * Math.sin(a), h - 0.018 * front ** 4, cz - rz * Math.cos(a));
      const shade = [0.62, 0.84, 0.7, 0.93, 0.41, 0.27][j];
      color.push(shade, shade, shade);
      if (j < rings.length - 1 && i < 36) {
        const k = j * 37 + i;
        ind.push(k, k + 37, k + 1, k + 1, k + 37, k + 38);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setIndex(ind);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geo.computeVertexNormals();
  cloth.side = THREE.DoubleSide;
  part(geo, cloth, g);
  const fleece = part(
    new THREE.LatheGeometry(
      [
        [0.076, -0.025],
        [0.079, 0.012],
        [0.075, 0.031],
        [0.073, 0.041],
        [0.074, 0.047],
        [0.072, 0.056],
        [0.068, 0.06],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      32,
    ),
    rubber,
    g,
    0,
    0,
    0.002,
  );
  fleece.scale.z = 1.11;
  fleece.rotation.x = -0.11;
  mergeStatic(g);
  return g;
}
let collarTemplate: THREE.Group;
export function jacketCollar(color: THREE.Color) {
  collarTemplate ??= collarShape();
  const group = collarTemplate.clone(),
    mesh = group.children.find(
      (o) => (o as THREE.Mesh<THREE.BufferGeometry, THREE.Material>).material.userData.jacketTint,
    ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardNodeMaterial>;
  const material = mesh.material.clone();
  material.color.copy(color);
  mesh.material = material;
  return { group, material };
}
