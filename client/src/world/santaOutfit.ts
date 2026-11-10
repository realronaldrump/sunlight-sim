import * as THREE from 'three/webgpu';
import { atan, attribute, bumpMap, color as tint, float, max, mix, smoothstep, texture, vec2 } from 'three/tsl';
import type { HumanBody } from '../skier/humanBody';
import { SkierModel } from '../skier/skierModel';
import { skiPole, skiWithBindings } from '../skier/skiEquipment';
import { mergeStatic } from './mergeStatic';
import { santaPortrait } from './santaLikeness';
import { santaHair } from './santaHair';
import { makeSantaAccessories } from './santaSack';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const smooth = THREE.MathUtils.smoothstep;
const gauss = (d: number, width: number) => Math.exp(-((d / width) ** 2));
const cloth = (color: number, roughness = .84) => new THREE.MeshStandardNodeMaterial({ color, roughness });

function ellipsoid(group: THREE.Group, material: THREE.Material, at: THREE.Vector3, scale: THREE.Vector3, detail = 16) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, detail, Math.ceil(detail * .65)), material);
  mesh.position.copy(at);
  mesh.scale.copy(scale);
  group.add(mesh);
  return mesh;
}

/** Fleece has a soft silhouette, with overlapping tufts instead of a smooth white tube. */
function fleece(group: THREE.Group, at: THREE.Vector3, radius: THREE.Vector3, count: number, ring = false) {
  const fibers = [cloth(0xf4eee2), cloth(0xfffaf1), cloth(0xeae2d5)];
  const center = at.clone();
  if (ring) {
    const brim = new THREE.Mesh(new THREE.TorusGeometry(radius.x, .017, 12, 64), fibers[0]);
    brim.position.copy(center); brim.rotation.x = Math.PI / 2; brim.scale.y = radius.z / radius.x;
    group.add(brim);
  } else ellipsoid(group, fibers[0], center, radius.clone().multiplyScalar(.91), 24);
  for (let i = 0; i < count; i++) {
    const theta = i * (ring ? Math.PI * 2 / count : 2.3999632);
    const y = ring ? .006 * Math.sin(i * 2.41) : 2 * (i + .5) / count - 1;
    const r = ring ? 1 : Math.sqrt(1 - y * y) * .86;
    const p = V(radius.x * r * Math.cos(theta), ring ? y : radius.y * y * .86, radius.z * r * Math.sin(theta)).add(center);
    const n = .0032 + .0041 * (.5 + .5 * Math.sin(i * 7.351));
    ellipsoid(group, fibers[i % 7 < 4 ? 0 : i % 7 < 6 ? 1 : 2], p, V(n, n * 1.1, n), 7);
  }
}

function fabricMap() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const threads = 23 * Math.sin(x * Math.PI / 4) * Math.sin(y * Math.PI / 8) + 10 * Math.sin((x + y) * Math.PI / 4);
    const grain = Math.imul(x + y * 128, 0x45d9f3b) >>> 26;
    const i = (y * 128 + x) * 4;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 99 + threads + grain;
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return map;
}

function makeHead() {
  const head = new THREE.Group();
  head.name = 'santa-head-pivot';
  const portrait = santaPortrait();
  head.add(portrait.mesh);
  const collarProfile = [[.081, -.153], [.077, -.137], [.067, -.121], [.063, -.104],
    [.061, -.086], [.060, -.072], [.057, -.068]].map(([r, y]) => new THREE.Vector2(r, y));
  const collarMaterial = new THREE.MeshStandardNodeMaterial({
    color: 0xa91632, roughness: .9, bumpMap: fabricMap(), bumpScale: .0011,
  });
  const collar = new THREE.Mesh(new THREE.LatheGeometry(collarProfile, 48), collarMaterial);
  collar.name = 'santa-knit-collar';
  collar.position.z = -.024;
  collar.scale.z = 1.07;
  collar.castShadow = true;
  collar.receiveShadow = true;
  head.add(collar);
  const hat = new THREE.Group();
  hat.name = 'santa-hat';
  hat.position.set(0, .151, .024);
  hat.rotation.x = .145;
  const top = new THREE.Group();
  top.name = 'santa-cap-and-pom';
  const velvet = new THREE.MeshPhysicalNodeMaterial({
    color: 0xb51231, roughness: .82, sheen: .65, sheenColor: new THREE.Color(0xea6669), sheenRoughness: .67,
    bumpMap: fabricMap(), bumpScale: .0015,
  });
  // A sewn, tapered stocking cap which hangs back to the side of his head.
  const shape = new THREE.CatmullRomCurve3([
    V(0, 0, .010), V(0, .038, .010), V(.012, .081, .021), V(.043, .111, .044),
    V(.086, .098, .066), V(.122, .062, .084), V(.130, .027, .089),
  ]);
  const geometry = new THREE.TubeGeometry(shape, 30, 1, 28);
  const positions = geometry.getAttribute('position'), vertex = new THREE.Vector3();
  for (let row = 0; row <= 30; row++) {
    const t = row / 30, p = shape.getPointAt(t), radius = .099 * (1 - t) ** 1.18 + .003;
    for (let j = 0; j <= 28; j++) {
      const i = row * 29 + j, theta = j / 28 * 2 * Math.PI;
      const folds = 1 + .045 * Math.sin(theta * 6 + t * 8) + .028 * Math.cos(theta * 11 - t * 13);
      vertex.fromBufferAttribute(positions, i).sub(p).multiplyScalar(radius * folds);
      vertex.z *= 1.13;
      vertex.add(p);
      positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
  }
  geometry.computeVertexNormals();
  top.add(new THREE.Mesh(geometry, velvet));
  fleece(top, shape.getPoint(1), V(.033, .035, .033), 136);
  mergeStatic(top);
  fleece(hat, V(0, .011, .008), V(.098, .018, .113), 112, true);
  mergeStatic(hat);
  hat.add(top);

  head.add(santaHair(portrait.mesh.geometry, portrait.skullIndexCount), hat);
  return { head, hat, top };
}

/** Sculpt and paint a new costume on this one instance of the existing skin. */
function tailor(human: HumanBody) {
  const geometry = human.mesh.geometry.clone();
  const pos = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const colors = geometry.getAttribute('color');
  const skin = geometry.getAttribute('skinTone');
  const joints = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
  const bones = human.mesh.skeleton.bones.map(b => b.name);
  const shape = new Float32Array(pos.count * 4), detail = new Float32Array(pos.count * 2);
  const red = new THREE.Color(0xb4102b), shadowRed = new THREE.Color(0x850f26);
  const ivory = new THREE.Color(0xf4ebdc), leather = new THREE.Color(0x242023);
  const bodyIndices = [];
  const index = geometry.index!;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    if (skin.getX(a) || skin.getX(b) || skin.getX(c)) continue;
    bodyIndices.push(a, b, c);
  }
  geometry.setIndex(bodyIndices);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); n.fromBufferAttribute(normals, i);
    const { x, y, z } = p, ax = Math.abs(x);
    let sleeves = 0, hands = 0, wrist = 0;
    for (let k = 0; k < 4; k++) {
      const bone = bones[joints.getComponent(i, k)], w = weights.getComponent(i, k);
      if (/arm|clavicle/.test(bone)) sleeves += w;
      if (/hand|index|middle|ring|pinky|thumb/.test(bone)) hands += w;
      if (/lowerarm|hand/.test(bone)) wrist += w;
    }
    const noise = Math.sin(i * 93.881) * .5 + .5;
    if (skin.getX(i)) continue;
    const torso = (1 - smooth(sleeves, .15, .64)) * (1 - smooth(hands, .1, .55));
    const coat = torso * smooth(y, .899, .95) * (1 - smooth(y, 1.50, 1.535));
    const belly = torso * gauss(y - 1.103, .19);
    p.x *= 1 + belly * .22;
    p.z += n.z * belly * .062;
    const cuff = wrist * gauss(y - (1.112 + .22 * (ax - .47)), .028);
    const hem = torso * gauss(y - .941, .029);
    const collar = torso * gauss(y - 1.467, .042);
    const belt = torso * gauss(y - 1.085, .055);
    const glove = smooth(hands, .18, .62), boot = 1 - smooth(y, .19, .29);
    const fold = .5 + .5 * Math.cos(67 * y + 31 * x + 17 * z);
    const seam = gauss(ax - (.115 + (y - 1.1) * .14), .0034) * coat * (1 - smooth(z, -.09, -.065));
    color.copy(red).lerp(shadowRed, .14 * fold + .2 * seam)
      .lerp(leather, Math.max(glove, boot)).multiplyScalar(.965 + .05 * noise);
    p.addScaledVector(n, .007 * Math.max(cuff, hem, collar) + .004 * belt - .0018 * seam);
    const bump = 1 - .75 * glove;
    pos.setXYZ(i, p.x, p.y, p.z);
    colors.setXYZ(i, color.r, color.g, color.b);
    shape.set([x, y, z, torso], i * 4);
    detail.set([bump, wrist], i * 2);
  }
  geometry.deleteAttribute('jacket');
  geometry.deleteAttribute('skinTone');
  geometry.deleteAttribute('roughness');
  geometry.setAttribute('outfit', new THREE.BufferAttribute(shape, 4));
  geometry.setAttribute('fabric', new THREE.BufferAttribute(detail, 2));
  human.mesh.geometry = geometry;

  // The trims are evaluated per fragment, so seams and hardware stay crisp
  // even where the underlying rig has long, thin triangles.
  const material = new THREE.MeshPhysicalNodeMaterial({ sheen: .55, sheenRoughness: .77 });
  const cut = attribute('outfit', 'vec4'), fabric = attribute('fabric', 'vec2');
  const x = cut.x.abs(), y = cut.y, front = smoothstep(.067, .114, cut.z.negate());
  const torso = cut.w;
  const band = (center: number, half: number, feather: number) =>
    smoothstep(half, half + feather, y.sub(center).abs()).oneMinus();
  const hem = torso.mul(band(.942, .027, .003));
  const collar = torso.mul(band(1.469, .029, .011));
  const cuffCenter = x.sub(.47).mul(.22).add(1.112);
  const cuffs = fabric.y.mul(smoothstep(.026, .032, y.sub(cuffCenter).abs()).oneMinus());
  const opening = torso.mul(front, band(1.21, .25, .016), smoothstep(.020, .028, x).oneMinus());
  const trim = max(hem, collar, cuffs, opening).clamp();
  const belt = torso.mul(band(1.085, .038, .003));
  const buckle = belt.mul(front, smoothstep(.050, .053, x).oneMinus(), band(1.085, .031, .002));
  const frame = max(smoothstep(.035, .039, x), smoothstep(.020, .023, y.sub(1.085).abs()));
  const prong = smoothstep(.003, .006, y.sub(1.085).abs()).oneMinus();
  const gold = buckle.mul(max(frame, prong));
  const coords = vec2(atan(cut.x, cut.z.negate()).mul(2.45), y.mul(12.2));
  const nap = texture(fabricMap(), coords).r;
  const wool = mix(tint(0xe4d9c7), tint(0xfff8ec), nap.mul(1.4));
  const base = attribute('color', 'vec3').mul(mix(float(1), nap.sub(.4).mul(.23).add(1), fabric.x));
  material.colorNode = mix(mix(mix(base, wool, trim), tint(0x211e21), belt), tint(0xe2b067), gold);
  material.metalnessNode = gold.mul(.68);
  material.roughnessNode = mix(float(.84), .5, belt).sub(gold.mul(.16));
  material.sheenNode = tint(0x9c424b).mul(belt.oneMinus()).mul(trim.oneMinus());
  material.normalNode = bumpMap(nap, fabric.x.mul(belt.oneMinus()).mul(.016));
  human.mesh.material = material;
}

export function makeSantaSkier() {
  const { head, hat, top } = makeHead();
  const model = new SkierModel(new THREE.Color(0xb4102b), 'full', new THREE.Color(1, 1, 1), {
    headGear: head,
    accessories: makeSantaAccessories(),
    ski: () => { const ski = skiWithBindings(true); mergeStatic(ski); return ski; },
    pole: () => { const pole = skiPole(true); mergeStatic(pole); return pole; },
  });
  tailor(model.human);
  model.root.name = 'mountain-guest';
  let swing = 0, velocity = 0;
  return { model, animateHat(dt: number, speed: number, edge: number, time: number, tip = 0) {
    const target = edge * .15 + Math.sin(time * 7.1) * Math.min(.065, speed * .006);
    velocity += (26 * (target - swing) - 8 * velocity) * dt;
    swing += velocity * dt;
    hat.rotation.z = -.23 * tip;
    hat.rotation.x = .145 - .09 * tip;
    top.rotation.z = swing;
    top.rotation.x = Math.min(.21, speed * .012) + Math.sin(time * 4.3) * .019;
  } };
}
