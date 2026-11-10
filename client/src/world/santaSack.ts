import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { SkierPose } from '../skier/skierModel';
import { mergeStatic } from './mergeStatic';
import { makeSantaOrnament } from './santaOrnament';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const wool = new THREE.MeshStandardNodeMaterial({ color: 0x28583e, roughness: .94, vertexColors: true });
const leather = new THREE.MeshStandardNodeMaterial({ color: 0x57342a, roughness: .76, side: THREE.DoubleSide });
const thread = new THREE.MeshStandardNodeMaterial({ color: 0xc1934b, roughness: .69 });
const brass = new THREE.MeshStandardNodeMaterial({ color: 0xd4a65d, roughness: .34, metalness: .61 });
const holly = new THREE.MeshPhysicalNodeMaterial({ color: 0x215d39, roughness: .48, clearcoat: .25, side: THREE.DoubleSide });
const berries = new THREE.MeshStandardNodeMaterial({ color: 0xb81e34, roughness: .32 });

function add(root: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function makeParcel(w: number, h: number, d: number, paper: number) {
  const parcel = new THREE.Group();
  const ribbon = new THREE.MeshStandardNodeMaterial({ color: 0xe8c78c, roughness: .44 });
  add(parcel, new RoundedBoxGeometry(w, h, d, 2, .006), new THREE.MeshStandardNodeMaterial({ color: paper, roughness: .74 }));
  add(parcel, new THREE.BoxGeometry(w * .22, h + .002, d + .003), ribbon);
  add(parcel, new THREE.BoxGeometry(w + .003, h + .002, d * .19), ribbon);
  for (const side of [-1, 1]) {
    const loop = add(parcel, new THREE.TorusGeometry(.013, .003, 5, 16), ribbon, side * .013, h * .5 + .009, 0);
    loop.scale.set(1, .62, 1);
    loop.rotation.x = side * .77;
  }
  mergeStatic(parcel);
  return parcel;
}

function decorate(sack: THREE.Group) {
  const pin = new THREE.Group(); pin.position.set(.055, -.035, -.062);
  pin.rotation.set(-.42, -.48, -.3);
  const leaf = new THREE.Shape();
  leaf.moveTo(0, 0);
  leaf.bezierCurveTo(-.006, .019, -.032, .024, -.027, .034);
  leaf.quadraticCurveTo(-.005, .036, -.022, .053);
  leaf.quadraticCurveTo(-.006, .050, 0, .077);
  leaf.quadraticCurveTo(.008, .057, .023, .057);
  leaf.quadraticCurveTo(.010, .040, .032, .034);
  leaf.bezierCurveTo(.021, .025, .006, .014, 0, 0);
  for (const angle of [-.83, .08, .95]) {
    const foliage = add(pin, new THREE.ShapeGeometry(leaf, 9), holly);
    foliage.rotation.z = angle;
    add(pin, new THREE.SphereGeometry(.0095, 10, 7), berries, angle * .012, .011 + Math.abs(angle) * .01, -.008);
  }
  sack.add(pin);
  for (const [x, tilt] of [[-.045, .26], [-.073, -.18]]) {
    const jingle = add(sack, new THREE.SphereGeometry(.016, 18, 12), brass, x, -.074, -.094);
    jingle.rotation.z = tilt;
    add(sack, new THREE.BoxGeometry(.025, .003, .002), leather, x, -.077, -.109).rotation.z = tilt;
    add(sack, new THREE.TorusGeometry(.008, .002, 6, 16), brass, x, -.055, -.091).rotation.y = tilt;
  }
}

export function makeSantaAccessories() {
  const root = new THREE.Group(); root.name = 'santa-accessories';
  const sack = new THREE.Group(); sack.name = 'santa-gift-sack';
  const profile = [[.009, -.32], [.061, -.314], [.111, -.289], [.137, -.231], [.136, -.166],
    [.115, -.099], [.073, -.056], [.050, -.024], [.063, .012]].map(([r, y]) => new THREE.Vector2(r, y));
  const cloth = new THREE.LatheGeometry(profile, 48);
  const v = cloth.getAttribute('position'), fibers = new Float32Array(v.count * 3);
  for (let i = 0; i < v.count; i++) {
    const y = v.getY(i), a = Math.atan2(v.getZ(i), v.getX(i));
    const fold = 1 + .046 * Math.sin(a * 7 - y * 32) + .035 * Math.cos(a * 11 + y * 19);
    v.setXYZ(i, v.getX(i) * fold - .024 * Math.sin(y * 8), y, v.getZ(i) * fold * .86);
    const nap = .89 + .079 * Math.sin(a * 7 - y * 32) + .029 * Math.cos(y * 281 + a * 89);
    fibers.set([nap, nap, nap], i * 3);
  }
  cloth.setAttribute('color', new THREE.BufferAttribute(fibers, 3));
  cloth.computeVertexNormals();
  add(sack, cloth, wool);
  for (let i = 0; i < 2; i++) {
    const tie = add(sack, new THREE.TorusGeometry(.059, .005, 7, 32), thread, 0, -.027 + i * .008, 0);
    tie.rotation.x = Math.PI / 2;
    tie.scale.y = .87;
  }
  const cord = [V(-.034, -.029, -.04), V(-.064, -.032, -.072), V(-.086, -.071, -.093), V(-.056, -.12, -.102)];
  add(sack, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cord), 15, .004, 6), thread);
  const seam = [V(.105,-.261,-.037), V(.121,-.218,-.049), V(.122,-.154,-.051), V(.095,-.093,-.053), V(.055,-.048,-.035)];
  add(sack, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seam), 18, .0025, 6), thread);
  decorate(sack);
  mergeStatic(sack);

  const parcels = [
    { model: makeParcel(.095, .122, .082, 0xb72637), x: -.032, y: .024, z: -.016, angle: -.24 },
    { model: makeParcel(.077, .093, .070, 0x3c7068), x: .049, y: .004, z: .015, angle: .30 },
    { model: makeParcel(.062, .080, .046, 0xe8ddc7), x: .017, y: .051, z: -.045, angle: -.32 },
  ];
  for (const { model } of parcels) sack.add(model);
  const ornament = makeSantaOrnament();
  ornament.group.visible = false;
  ornament.glow(.95, 0, 0);

  // The cross-body sling runs over the actual torso, so the bag can swing
  // toward the hip while seated without cutting through the chair back.
  const strapGeometry = new THREE.BufferGeometry();
  const segments = 30, vertices = new Float32Array((segments + 1) * 2 * 3);
  const indices = [];
  for (let i = 0; i < segments; i++) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  strapGeometry.setIndex(indices);
  strapGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3).setUsage(THREE.DynamicDrawUsage));
  const strap = add(root, strapGeometry, leather);
  strap.frustumCulled = false;
  root.add(sack, ornament.group);

  let roll = 0, rollV = 0, pitch = 0, pitchV = 0, previousSpeed = 0;
  const vertex = V(), tangent = V(), across = V(), torso = V();
  const strapPoints = Array.from({ length: 9 }, () => V());
  const curve = new THREE.CatmullRomCurve3(strapPoints, true);

  return {
    root,
    pose(dt: number, p: SkierPose, chest: THREE.Vector3, pelvis: THREE.Vector3, hand: THREE.Vector3) {
      const h = Math.min(dt, .05), lean = p.edge * Math.min(1, p.speed / 3);
      const targetRoll = -.22 * lean + .15 * (p.rockX ?? 0) + Math.sin(p.time * 4.6) * Math.min(.029, p.speed * .004);
      const accel = h > .001 ? THREE.MathUtils.clamp((p.speed - previousSpeed) / h, -6, 6) : 0;
      previousSpeed = p.speed;
      rollV += (34 * (targetRoll - roll) - 8.7 * rollV) * h; roll += rollV * h;
      pitchV += (31 * (-.018 * accel - pitch) - 8.2 * pitchV) * h; pitch += pitchV * h;
      sack.position.copy(pelvis).lerp(chest, .48);
      sack.position.add(V(.289 + .007 * p.sitting, .037 - .057 * p.sitting, .142 - .444 * p.sitting));
      sack.rotation.set(pitch - .26 * p.sitting, -.24 - .25 * p.sitting, roll - .11);
      for (const [i, parcel] of parcels.entries()) {
        parcel.model.position.set(parcel.x + .031 * roll, parcel.y + Math.min(.009, Math.abs(pitchV) * .013), parcel.z + .022 * pitch);
        parcel.model.rotation.set(-.08 + pitch * (1.1 + i * .25), parcel.angle + .30 * roll, parcel.angle * .37 + roll * (1 + i * .19));
      }
      strapPoints[0].copy(chest).add(V(-.164, .128, .002));
      strapPoints[1].copy(chest).add(V(-.143, .070, -.173));
      strapPoints[2].copy(chest).add(V(-.053, -.060, -.207));
      strapPoints[3].copy(pelvis).lerp(chest, .45).add(V(.089, .026, -.212));
      strapPoints[4].copy(pelvis).lerp(chest, .43).add(V(.215, .047, -.121));
      strapPoints[5].copy(sack.position).add(V(.014, -.036, -.05));
      strapPoints[6].copy(pelvis).lerp(chest, .50).add(V(.209, .039, .146 - p.sitting * .05));
      strapPoints[7].copy(chest).add(V(.02, -.092, .176));
      strapPoints[8].copy(chest).add(V(-.151, .065, .097));
      const attr = strapGeometry.getAttribute('position'), torsoHeight = Math.max(.1, chest.y - pelvis.y);
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        curve.getPoint(t, vertex);
        curve.getTangent(t, tangent);
        torso.copy(pelvis).lerp(chest, THREE.MathUtils.clamp((vertex.y - pelvis.y) / torsoHeight, 0, 1));
        across.copy(vertex).sub(torso).cross(tangent).normalize().multiplyScalar(.016);
        attr.setXYZ(i * 2, vertex.x + across.x, vertex.y + across.y, vertex.z + across.z);
        attr.setXYZ(i * 2 + 1, vertex.x - across.x, vertex.y - across.y, vertex.z - across.z);
      }
      attr.needsUpdate = true;
      strapGeometry.computeVertexNormals();
      const action = p.costumeAction;
      ornament.group.visible = action?.kind === 'hang-star' && !action.released && action.amount > .03;
      if (ornament.group.visible) {
        ornament.group.position.copy(hand).add(V(-.028, -.022, -.072));
        ornament.group.rotation.y = -.29 + roll;
      }
    },
  };
}
