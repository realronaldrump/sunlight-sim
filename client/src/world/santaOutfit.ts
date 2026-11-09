import * as THREE from 'three/webgpu';
import { atan, attribute, bumpMap, color as tint, float, max, mix, smoothstep, texture, vec2 } from 'three/tsl';
import type { HumanBody } from '../skier/humanBody';
import { SkierModel } from '../skier/skierModel';
import { skiPole, skiWithBindings } from '../skier/skiEquipment';
import { mergeStatic } from './mergeStatic';

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
  head.name = 'Santa hat, swept hair and facial details';
  const top = new THREE.Group();
  top.position.y = .115;
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
    const t = row / 30, p = shape.getPointAt(t), radius = .092 * (1 - t) ** 1.18 + .003;
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
  fleece(head, V(0, .126, .011), V(.088, .018, .100), 112, true);

  const colors = [cloth(0xa38058, .72), cloth(0xc9a776, .68), cloth(0xe4c48d, .66), cloth(0xf4d5a0, .64)];
  const lock = (points: THREE.Vector3[], width: number, material: THREE.Material) => {
    const curve = new THREE.CatmullRomCurve3(points);
    const mesh = new THREE.TubeGeometry(curve, 14, width, 6);
    const attr = mesh.getAttribute('position'), v = new THREE.Vector3();
    for (let row = 0; row <= 14; row++) {
      const t = row / 14, center = curve.getPointAt(t);
      const taper = .05 + .95 * Math.sin(Math.PI * (.13 + .87 * t));
      for (let col = 0; col <= 6; col++) {
        const i = row * 7 + col;
        v.fromBufferAttribute(attr, i).sub(center).multiplyScalar(taper).add(center);
        attr.setXYZ(i, v.x, v.y, v.z);
      }
    }
    mesh.computeVertexNormals();
    head.add(new THREE.Mesh(mesh, material));
  };
  // Low side-part, layered front sweep, then finer individual wisps that catch sunlight.
  for (let i = 0; i < 18; i++) {
    const t = i / 17, shift = .018 * t;
    lock([V(.062 + shift, .12, -.061), V(.016, .131 + shift * .32, -.111 - shift * .8),
      V(-.032 - shift * .55, .107 + shift, -.120 + shift * .20), V(-.079, .080 + shift * 1.65, -.085 + shift * .8)], .0058, colors[i % 4]);
    lock([V(.068, .121, -.057 + t * .15), V(.081 + t * .011, .102, -.042 + t * .147),
      V(.082 + t * .013, .059 - t * .018, -.018 + t * .104)], .0044, colors[i % 3]);
    lock([V(-.066, .120, -.025 + t * .121), V(-.083, .097, -.007 + t * .11),
      V(-.075, .054 - t * .012, .014 + t * .077)], .0046, colors[(i + 1) % 3]);
  }
  for (let i = 0; i < 25; i++) {
    const q = i / 24;
    lock([V(.052 + .032 * q, .126, -.07), V(.005, .128 + q * .009, -.119 - q * .006),
      V(-.044, .112 + q * .015, -.113 - .01 * q), V(-.077, .09 + q * .019, -.089)], .0012, colors[2 + i % 2]);
  }

  const whites = cloth(0xdcd2c3, .51), blue = cloth(0x54798d, .39), pupil = cloth(0x23303a, .38);
  for (const side of [-1, 1]) {
    const eye = ellipsoid(head, whites, V(side * .035, .0405, -.1036), V(.010, .00225, .0023), 16);
    eye.rotation.z = side * .07;
    ellipsoid(head, blue, V(side * .034, .0405, -.1055), V(.0033, .00215, .0011));
    ellipsoid(head, pupil, V(side * .034, .0405, -.1063), V(.00125, .00135, .0006));
    lock([V(side * .020, .0565, -.113), V(side * .035, .0585, -.111),
      V(side * .050, .056, -.102), V(side * .059, .052, -.094)], .0028, colors[1]);
  }
  mergeStatic(head);
  head.add(top);
  return { head, top };
}

/** Sculpt and paint a new costume on this one instance of the existing skin. */
function tailor(human: HumanBody) {
  const geometry = human.mesh.geometry.clone();
  const pos = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const colors = geometry.getAttribute('color'), rough = geometry.getAttribute('roughness');
  const skin = geometry.getAttribute('skinTone');
  const joints = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
  const bones = human.mesh.skeleton.bones.map(b => b.name);
  const shape = new Float32Array(pos.count * 4), detail = new Float32Array(pos.count * 4);
  const red = new THREE.Color(0xb4102b), shadowRed = new THREE.Color(0x850f26);
  const ivory = new THREE.Color(0xf4ebdc), leather = new THREE.Color(0x242023);
  const skinColor = new THREE.Color(0xe1a285), flushed = new THREE.Color(0xc18169), lip = new THREE.Color(0x995f57);
  const lidShadow = new THREE.Color(0x98766c);
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
    let bump = .9, torso = 0;
    if (skin.getX(i)) {
      const front = 1 - smooth(z, -.119, -.082);
      const jaw = gauss(y - 1.578, .042), chin = front * gauss(y - 1.555, .016);
      p.x *= 1 + .31 * jaw;
      p.y -= .006 * chin;
      const bags = front * gauss(ax - .041, .018) * gauss(y - 1.636 + (ax - .038) * .12, .0049);
      const cheek = front * gauss(ax - .053, .018) * gauss(y - 1.621, .032);
      p.z -= .006 * chin + .008 * cheek + .0026 * bags;
      const mouthLine = y - (1.582 + .0035 * gauss(x, .019) - .0018 * Math.sin(x * 63));
      const mouth = gauss(mouthLine, .0034) * gauss(x, .024) * front;
      p.z -= mouth * .0026;
      const socket = front * gauss(ax - .034, .019) * gauss(y - 1.649, .014);
      const lid = front * gauss(ax - .038, .016) * gauss(y - (1.646 + (ax - .034) * .17), .0025);
      const crease = front * gauss(ax - (.023 + (1.622 - y) * .37), .0038) * gauss(y - 1.602, .021);
      color.copy(skinColor).lerp(flushed, .43 * cheek + .18 * crease)
        .lerp(ivory, socket * .16).lerp(lidShadow, .24 * bags + .26 * lid)
        .lerp(lip, mouth * .93).multiplyScalar(.979 + .028 * noise);
      rough.setX(i, .69 + .1 * socket);
      bump = .14;
    } else {
      torso = (1 - smooth(sleeves, .15, .64)) * (1 - smooth(hands, .1, .55));
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
      rough.setX(i, .84);
      bump = 1 - .75 * glove;
    }
    pos.setXYZ(i, p.x, p.y, p.z);
    colors.setXYZ(i, color.r, color.g, color.b);
    shape.set([x, y, z, torso], i * 4);
    detail.set([rough.getX(i), bump, wrist, skin.getX(i)], i * 4);
  }
  geometry.deleteAttribute('jacket');
  geometry.deleteAttribute('skinTone');
  geometry.deleteAttribute('roughness');
  geometry.setAttribute('outfit', new THREE.BufferAttribute(shape, 4));
  geometry.setAttribute('fabric', new THREE.BufferAttribute(detail, 4));
  human.mesh.geometry = geometry;

  // The trims are evaluated per fragment, so seams and hardware stay crisp
  // even where the underlying rig has long, thin triangles.
  const material = new THREE.MeshPhysicalNodeMaterial({ sheen: .55, sheenRoughness: .77 });
  const cut = attribute('outfit', 'vec4'), fabric = attribute('fabric', 'vec4');
  const x = cut.x.abs(), y = cut.y, front = smoothstep(.067, .114, cut.z.negate());
  const torso = cut.w.mul(fabric.w.oneMinus());
  const band = (center: number, half: number, feather: number) =>
    smoothstep(half, half + feather, y.sub(center).abs()).oneMinus();
  const hem = torso.mul(band(.942, .027, .003));
  const collar = torso.mul(band(1.469, .029, .011));
  const cuffCenter = x.sub(.47).mul(.22).add(1.112);
  const cuffs = fabric.z.mul(smoothstep(.026, .032, y.sub(cuffCenter).abs()).oneMinus());
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
  const base = attribute('color', 'vec3').mul(mix(float(1), nap.sub(.4).mul(.23).add(1), fabric.y));
  material.colorNode = mix(mix(mix(base, wool, trim), tint(0x211e21), belt), tint(0xe2b067), gold);
  material.metalnessNode = gold.mul(.68);
  material.roughnessNode = mix(fabric.x, .5, belt).sub(gold.mul(.16));
  material.sheenNode = tint(0x9c424b).mul(fabric.w.oneMinus()).mul(belt.oneMinus()).mul(trim.oneMinus());
  material.normalNode = bumpMap(nap, fabric.y.mul(belt.oneMinus()).mul(.016));
  human.mesh.material = material;
}

export function makeSantaSkier() {
  const { head, top } = makeHead();
  const model = new SkierModel(new THREE.Color(0xb4102b), 'full', new THREE.Color(1, 1, 1), {
    headGear: head,
    ski: () => { const ski = skiWithBindings(true); mergeStatic(ski); return ski; },
    pole: () => { const pole = skiPole(true); mergeStatic(pole); return pole; },
  });
  tailor(model.human);
  model.root.name = 'mountain-guest';
  let swing = 0, velocity = 0;
  return { model, animateHat(dt: number, speed: number, edge: number, time: number) {
    const target = edge * .15 + Math.sin(time * 7.1) * Math.min(.065, speed * .006);
    velocity += (26 * (target - swing) - 8 * velocity) * dt;
    swing += velocity * dt;
    top.rotation.z = swing;
    top.rotation.x = Math.min(.21, speed * .012) + Math.sin(time * 4.3) * .019;
  } };
}
