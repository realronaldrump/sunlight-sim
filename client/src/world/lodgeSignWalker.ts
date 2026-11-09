import * as THREE from 'three/webgpu';
import { attribute, mix, texture, vec2 } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { HumanBody } from '../skier/humanBody';
import type { SignWalkerOutfit } from './pedestrian';
import { mergeStatic } from './mergeStatic';
import signArt from './assets/rob-ittner-sign.svg?url';

export const LODGE_SIGN_WALKER = 'lodge-sign-walker';
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const cloth = (color: number) => new THREE.MeshStandardNodeMaterial({ color, roughness: 0.92 });

export function makeSignWalkerOutfit(): SignWalkerOutfit {
  const print = new THREE.TextureLoader().load(signArt);
  print.colorSpace = THREE.SRGBColorSpace;
  print.anisotropy = 8;
  const face = new THREE.MeshStandardNodeMaterial({ map: print, roughness: 0.83 });
  const edge = cloth(0xf4f3ed);
  const board = new THREE.Group();
  board.name = 'rob-ittner-sign';
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.775, 0.006), [edge, edge, edge, edge, face, face]);
  panel.position.set(0.09, 0.775 / 2, 0.003);
  panel.receiveShadow = true;
  board.add(panel);
  const boot = makeBoot();
  return { head: makeHead(), boot: () => boot.clone(), board };
}

function makeBoot() {
  const group = new THREE.Group();
  group.name = 'walking-boot';
  const rubber = cloth(0x222120), leather = cloth(0x493d34), lace = cloth(0x887665);
  const part = (w: number, h: number, d: number, y: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.018), material);
    mesh.position.set(0, y, z);
    group.add(mesh);
  };
  part(0.124, 0.032, 0.27, -0.095, -0.056, rubber);
  part(0.113, 0.084, 0.254, -0.048, -0.055, leather);
  part(0.115, 0.157, 0.125, 0.029, 0.004, leather);
  for (let i = 0; i < 3; i++) part(0.061, 0.005, 0.007, -0.003 + i * 0.012, -0.124 + i * 0.021, lace);
  mergeStatic(group);
  return group;
}

/** Hair and frames are in the anatomical rig's head-pivot frame. */
function makeHead() {
  const group = new THREE.Group();
  group.name = 'hair-and-glasses';
  const hair = [cloth(0x938571), cloth(0xaaa08e), cloth(0xc4b9a4)];
  const capGeometry = new THREE.SphereGeometry(1, 28, 14, 0, 2 * Math.PI, 0, 1.75);
  const capVertices = capGeometry.getAttribute('position');
  for (let i = 0; i < capVertices.count; i++) {
    const y = capVertices.getY(i), radius = Math.sqrt(Math.max(0, 1 - y * y));
    if (radius < 1e-5) continue;
    const x = capVertices.getX(i) / radius, z = capVertices.getZ(i) / radius;
    const down = Math.acos(y) * (1 + 0.19 * z);
    capVertices.setXYZ(i, x * Math.sin(down), Math.cos(down), z * Math.sin(down));
  }
  capGeometry.computeVertexNormals();
  const cap = new THREE.Mesh(capGeometry, hair[0]);
  cap.scale.set(0.094, 0.092, 0.117);
  cap.position.set(0, 0.077, -0.005);
  group.add(cap);

  const lock = (points: THREE.Vector3[], width: number, material: THREE.Material) => {
    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = new THREE.TubeGeometry(curve, 10, width, 5, false);
    const vertices = geometry.getAttribute('position');
    const strand = new THREE.Vector3();
    for (let row = 0; row <= 10; row++) {
      const t = row / 10, center = curve.getPointAt(t), taper = 0.08 + 0.92 * Math.sin(Math.PI * (0.22 + t * 0.78));
      for (let i = row * 6; i < row * 6 + 6; i++) {
        strand.fromBufferAttribute(vertices, i).sub(center).multiplyScalar(taper).add(center);
        vertices.setXYZ(i, strand.x, strand.y, strand.z);
      }
    }
    geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry, material));
  };
  for (let i = 0; i < 9; i++) {
    const z = -0.068 + i * 0.020;
    const height = Math.sin(Math.PI * i / 8) * 0.027;
    lock([V(0.033, 0.139 + height, z), V(-0.028, 0.150 + height, z - 0.012),
      V(-0.080, 0.111, z - 0.012), V(-0.093, 0.063 + height, z + 0.011)], 0.012, hair[i % hair.length]);
    lock([V(0.032, 0.142 + height, z), V(0.076, 0.124 + height, z + 0.013),
      V(0.097, 0.064, z + 0.03)], 0.010, hair[(i + 1) % hair.length]);
  }
  lock([V(0.026, 0.153, -0.065), V(0.013, 0.132, -0.105), V(-0.015, 0.070, -0.112)], 0.009, hair[2]);
  lock([V(0.011, 0.156, -0.067), V(-0.016, 0.132, -0.103), V(-0.042, 0.090, -0.113)], 0.008, hair[1]);

  const frames = new THREE.MeshStandardNodeMaterial({ color: 0x2a2927, roughness: 0.37 });
  const whites = cloth(0xd6ccba), irises = cloth(0x4b514d), pupils = cloth(0x1c201d);
  const eyePart = (x: number, z: number, sx: number, sy: number, sz: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, 0.043, z);
    group.add(mesh);
  };
  const frameZ = (x: number) => -0.119 + Math.abs(x) * 0.30;
  const tube = (points: THREE.Vector3[], radius: number, closed = false) => {
    group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed), closed ? 32 : 8, radius, 6, closed), frames));
  };
  for (const side of [-1, 1]) {
    eyePart(side * 0.035, -0.100, 0.013, 0.0044, 0.0057, whites);
    eyePart(side * 0.035, -0.104, 0.0048, 0.0038, 0.0027, irises);
    eyePart(side * 0.035, -0.106, 0.0023, 0.0024, 0.0014, pupils);
    lock([V(side * 0.019, 0.060, -0.107), V(side * 0.037, 0.064, -0.108), V(side * 0.061, 0.060, -0.092)], 0.0028, hair[0]);
    const outline = new THREE.Path();
    outline.moveTo(0.016, 0.065);
    outline.lineTo(0.058, 0.066);
    outline.quadraticCurveTo(0.074, 0.066, 0.075, 0.054);
    outline.lineTo(0.071, 0.036);
    outline.quadraticCurveTo(0.069, 0.026, 0.058, 0.026);
    outline.lineTo(0.020, 0.026);
    outline.quadraticCurveTo(0.010, 0.026, 0.010, 0.036);
    outline.lineTo(0.009, 0.054);
    outline.quadraticCurveTo(0.008, 0.065, 0.016, 0.065);
    tube(outline.getPoints(3).slice(0, -1).map(({ x, y }) => V(side * x, y, frameZ(x))), 0.0024, true);
    tube([V(side * 0.074, 0.057, frameZ(0.074)), V(side * 0.084, 0.055, -0.066), V(side * 0.086, 0.042, 0.010)], 0.0025);
  }
  tube([V(-0.013, 0.057, -0.116), V(0, 0.062, -0.120), V(0.013, 0.057, -0.116)], 0.0025);
  mergeStatic(group);
  return group;
}

function vestTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#a9242d';
  ctx.fillRect(0, 0, 1024, 512);
  for (const [width, color] of [[9, '#9d2028'], [3, '#771a22'], [1, '#8c2029']] as const) {
    ctx.beginPath();
    for (let x = -512; x <= 1536; x += 74) {
      ctx.moveTo(x, 0); ctx.lineTo(x + 512, 512);
      ctx.moveTo(x, 0); ctx.lineTo(x - 512, 512);
    }
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  ctx.fillStyle = '#663029';
  ctx.fillRect(0, 492, 1024, 20);
  // The left half is the front, with the lined opening above the zipper.
  ctx.fillStyle = '#45392f';
  ctx.fill(new Path2D('M168 0H346Q309 63 283 149L263 223H248L227 149Q205 69 168 0Z'));
  ctx.fillStyle = '#537399';
  ctx.fill(new Path2D('M181 0H332Q299 65 274 146L256 209L237 146Q213 70 181 0Z'));
  ctx.fillStyle = '#405d7b';
  ctx.fillRect(253, 45, 6, 154);
  for (const y of [72, 123, 172]) {
    ctx.beginPath(); ctx.arc(256, y, 3, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.fillStyle = '#651e24';
  ctx.fillRect(248, 215, 16, 283);
  ctx.fillStyle = '#54423b';
  ctx.fillRect(254, 215, 4, 283);
  ctx.fillStyle = '#c4b9ab';
  ctx.fillRect(251, 215, 9, 13);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/** Re-dress the CC0 body without changing the shared crowd geometry or skeleton. */
export function dressSignWalker(human: HumanBody) {
  const geometry = human.mesh.geometry.clone();
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const joints = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
  const skin = geometry.getAttribute('skinTone');
  const colors = geometry.getAttribute('color'), bones = human.mesh.skeleton.bones;
  // UV, coverage and front/back blend share a vertex buffer to fit the WebGPU limit.
  const vest = new Float32Array(position.count * 4);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const denim = new THREE.Color(0x537399), pants = new THREE.Color(0x454951);
  const hand = new THREE.Color(0xd39d7d), lip = new THREE.Color(0xa46053), tint = new THREE.Color();
  const sleeveBones = bones.map(({ name }) => /upperarm|lowerarm/.test(name));
  const handBones = bones.map(({ name }) => /hand|index|middle|ring|pinky|thumb/.test(name));
  const smooth = THREE.MathUtils.smoothstep;
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    n.fromBufferAttribute(normal, i);
    const { x, y, z } = p;
    let sleeve = 0, bareHand = 0;
    for (let j = 0; j < 4; j++) {
      const bone = joints.getComponent(i, j), weight = weights.getComponent(i, j);
      if (sleeveBones[bone]) sleeve += weight;
      if (handBones[bone]) bareHand += weight;
    }
    const upperBody = Math.max(sleeve, smooth(y, 0.988, 1.025));
    const bare = smooth(bareHand, 0.25, 0.78);
    if (skin.getX(i)) {
      p.x *= 1 + 0.13 * Math.exp(-(((y - 1.602) / 0.043) ** 2));
      const mouth = z < -0.123 ? Math.exp(-(((y - 1.577) / 0.004) ** 2 + (x / 0.025) ** 4)) : 0;
      tint.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i)).multiplyScalar(0.92).lerp(lip, mouth * 0.65);
    } else {
      p.addScaledVector(n, -0.016 * sleeve - 0.005 * bare - 0.01 * (1 - upperBody) * (1 - bare));
      tint.copy(pants).lerp(denim, upperBody).multiplyScalar(0.95 + 0.05 * Math.sin(y * 78 + z * 15)).lerp(hand, bare);
      vest[i * 4 + 2] = smooth(y, 0.991, 1.024) * (1 - smooth(y, 1.453, 1.49)) * (1 - smooth(sleeve, 0.16, 0.62)) * (1 - bare);
    }
    colors.setXYZ(i, tint.r, tint.g, tint.b);
    position.setXYZ(i, p.x, p.y, p.z);
    vest[i * 4] = THREE.MathUtils.clamp(0.5 + x / 0.55, 0.003, 0.997);
    vest[i * 4 + 1] = (y - 0.99) / 0.51;
    vest[i * 4 + 3] = smooth(-z, -0.022, 0.062);
  }
  geometry.setAttribute('vest', new THREE.BufferAttribute(vest, 4));
  human.mesh.geometry = geometry;

  const map = vestTexture(), fit = attribute('vest', 'vec4');
  const frontUv = fit.xy.mul(vec2(0.5, 1));
  const print = mix(texture(map, frontUv.add(vec2(0.5, 0))).rgb, texture(map, frontUv).rgb, fit.w);
  const material = human.mesh.material as THREE.MeshStandardNodeMaterial;
  material.colorNode = mix(attribute('color', 'vec3'), print, fit.z);
}
