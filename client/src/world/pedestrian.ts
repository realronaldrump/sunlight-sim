// A person on foot at the resort: the same anatomical CC0 human as the skiers, in ski boots, carrying
// skis on the shoulder and poles in the other hand, or seated at a table. Poses are procedural
// two-bone IK like the skier: a short, stiff-ankled ski-boot gait, idle weight shifts and sitting.
import * as THREE from 'three/webgpu';
import { HumanBody } from '../skier/humanBody';
import { helmetAndGoggles, skiBoot, skiWithBindings, skiPole, jacketCollar } from '../skier/skiEquipment';

export interface PedestrianPose {
  mode: 'walk' | 'stand' | 'sit';
  stride: number;    // gait phase in steps (WalkState.stride)
  speed: number;     // m/s
  time: number;      // s, for idle motion
  seat?: number;     // seat height above the feet, when sitting
  carry?: boolean;   // skis on the shoulder and poles in hand
  handsOnTable?: number; // table height above the feet, when seated at one
  lookYaw?: number;  // head turn, rad
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

function solveIK(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3) {
  const d = target.clone().sub(root);
  const dist = Math.min(d.length(), l1 + l2 - 1e-3);
  const dir = d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const pd = pole.clone().sub(root); pd.sub(dir.clone().multiplyScalar(pd.dot(dir))).normalize();
  return out.copy(root).addScaledVector(dir, a).addScaledVector(pd, h);
}

/** Knit beanie with a pom-pom, a common alternative to a helmet when walking around the base. */
function beanie(color: THREE.Color) {
  const g = new THREE.Group();
  const knit = new THREE.MeshStandardNodeMaterial({ color, roughness: 1 });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), knit);
  cap.scale.set(1, 1.05, 1.12); cap.position.set(0, 0.025, 0.01); g.add(cap);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.106, 0.108, 0.045, 18, 1, true), knit);
  cuff.position.set(0, 0.0, 0.01); cuff.scale.z = 1.12; g.add(cuff);
  const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035, 1), new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0xf3f0ea), roughness: 1 }));
  pom.position.set(0, 0.135, 0.01); g.add(pom);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

export interface Appearance { jacket: THREE.Color; skin?: THREE.Color; hat?: 'helmet' | 'beanie'; hatColor?: THREE.Color }

export class PedestrianModel {
  readonly root = new THREE.Group();
  readonly human: HumanBody;
  private head: THREE.Group;
  private boots = [skiBoot(), skiBoot()];
  private skis = [skiWithBindings(), skiWithBindings()];
  private poles = [skiPole(), skiPole()];
  private collar;
  private stand = Math.random() * 10;

  constructor(look: Appearance) {
    this.human = new HumanBody(look.jacket, look.skin ?? new THREE.Color(1, 1, 1));
    this.collar = jacketCollar(look.jacket);
    this.head = look.hat === 'beanie' ? beanie(look.hatColor ?? new THREE.Color(0x2b4a7a)) : helmetAndGoggles();
    this.root.add(this.human.root, this.head, this.collar.group, ...this.boots, ...this.skis, ...this.poles);
    this.root.traverse((o) => { o.frustumCulled = false; if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.update({ mode: 'stand', stride: 0, speed: 0, time: 0, carry: true });
  }

  setJacket(c: THREE.ColorRepresentation) { this.human.setJacket(c); this.collar.material.color.set(c); }

  /** Local frame: feet at the origin, facing -z, +x to the right. */
  update(p: PedestrianPose) {
    const t = p.time + this.stand;
    const carry = p.carry ?? true;
    let pelvis: THREE.Vector3, chest: THREE.Vector3, ankleL: THREE.Vector3, ankleR: THREE.Vector3;
    let handL: THREE.Vector3, handR: THREE.Vector3;
    let liftL = 0, liftR = 0, footPitchL = 0, footPitchR = 0;
    const kneePole = V(0, 0.3, -1.2);
    if (p.mode === 'sit') {
      const seat = p.seat ?? 0.45;
      pelvis = V(0, seat + 0.1, 0.06);
      chest = pelvis.clone().add(V(0, 0.48, -0.06));
      ankleL = V(-0.13, 0.12, -0.42); ankleR = V(0.13, 0.12, -0.4);
      const table = p.handsOnTable;
      const breathe = Math.sin(t * 1.3) * 0.01;
      handL = table ? V(-0.2, table + 0.04, -0.36 + breathe) : V(-0.16, seat + 0.18, -0.22);
      handR = table ? V(0.2, table + 0.04 + Math.max(0, Math.sin(t * 0.7)) * 0.12, -0.38) : V(0.16, seat + 0.18, -0.22);
    } else {
      const walking = p.mode === 'walk' ? Math.min(1, p.speed / 0.6) : 0;
      const run = Math.max(0, Math.min(1, (p.speed - 1.4) / 0.9));
      const theta = Math.PI * p.stride; // a full gait cycle is two steps
      const S = (0.3 + 0.14 * run) * walking; // half stride (ski boots shorten the step)
      const sway = Math.sin(theta) * 0.025 * walking;
      const idle = (1 - walking) * Math.sin(t * 0.6) * 0.02;
      ankleL = V(-0.11, 0.115, -Math.sin(theta) * S);
      ankleR = V(0.11, 0.115, Math.sin(theta) * S);
      liftL = Math.max(0, Math.cos(theta)) * (0.07 + 0.05 * run) * walking;
      liftR = Math.max(0, -Math.cos(theta)) * (0.07 + 0.05 * run) * walking;
      ankleL.y += liftL; ankleR.y += liftR;
      // stiff boots: the sole rolls from heel to toe rather than flexing at the ankle
      footPitchL = -Math.cos(theta) * 0.18 * walking; footPitchR = Math.cos(theta) * 0.18 * walking;
      const bob = Math.abs(Math.cos(theta)) * 0.025 * walking;
      pelvis = V(sway + idle, 0.9 - 0.04 * walking - 0.04 * run + bob, 0.03);
      chest = pelvis.clone().add(V(sway * 0.4, 0.49, -0.05 - 0.06 * run - 0.03 * walking));
      // free arm swings opposite the leg; the carrying hand stays on the skis
      const swing = Math.sin(theta) * (0.18 + 0.12 * run) * walking;
      handL = chest.clone().add(V(-0.27, -0.55, -swing + 0.02));
      handR = carry ? chest.clone().add(V(0.2, -0.05, -0.32)) : chest.clone().add(V(0.27, -0.55, swing + 0.02));
    }
    const neck = chest.clone().add(V(0, 0.12, -0.02));
    const head = neck.clone().add(V(0, 0.1, -0.015));
    const hipL = pelvis.clone().add(V(-0.1, -0.02, 0)), hipR = pelvis.clone().add(V(0.1, -0.02, 0));
    const kneeL = new THREE.Vector3(), kneeR = new THREE.Vector3();
    solveIK(hipL, ankleL, 0.46, 0.46, hipL.clone().add(kneePole), kneeL);
    solveIK(hipR, ankleR, 0.46, 0.46, hipR.clone().add(kneePole), kneeR);
    const shL = chest.clone().add(V(-0.19, 0.06, 0)), shR = chest.clone().add(V(0.19, 0.06, 0));
    const elL = new THREE.Vector3(), elR = new THREE.Vector3();
    solveIK(shL, handL, 0.3, 0.28, shL.clone().add(V(-0.3, -0.5, 0.4)), elL);
    solveIK(shR, handR, 0.3, 0.28, shR.clone().add(V(0.35, -0.5, 0.3)), elR);
    const look = new THREE.Euler(-0.06 + (p.mode === 'sit' ? 0.1 : 0), p.lookYaw ?? Math.sin(t * 0.21) * 0.25 * (p.mode === 'walk' ? 0.3 : 1), 0, 'YXZ');
    this.human.pose({ pelvis, chest, neck, head, hipL, hipR, kneeL, kneeR, ankleL, ankleR,
      shoulderL: shL, shoulderR: shR, elbowL: elL, elbowR: elR, handL, handR }, look);
    this.head.position.copy(head); this.head.rotation.copy(look);
    this.collar.group.position.copy(neck); this.collar.group.rotation.x = -0.05;
    this.boots[0].position.copy(ankleL); this.boots[1].position.copy(ankleR);
    this.boots[0].rotation.set(footPitchL, 0, 0); this.boots[1].rotation.set(footPitchR, 0, 0);

    for (const s of this.skis) s.visible = carry && p.mode !== 'sit';
    for (const s of this.poles) s.visible = carry && p.mode !== 'sit';
    if (carry && p.mode !== 'sit') {
      // both skis base to base on the right shoulder, bindings just behind it, tips forward and low
      const shoulder = shR.clone().add(V(0.02, 0.06, 0));
      for (let i = 0; i < 2; i++) {
        const s = this.skis[i];
        // on edge (roll 90 degrees) so the bases face each other across x, then pitched tips-down
        s.position.copy(shoulder).add(V(i === 0 ? 0.022 : -0.022, 0.0, 0.05));
        s.rotation.set(-0.42, 0, i === 0 ? Math.PI / 2 : -Math.PI / 2, 'XYZ');
      }
      // poles in the left hand, tips trailing slightly behind
      for (let i = 0; i < 2; i++) {
        const tip = handL.clone().add(V(-0.05 - i * 0.04, -0.98, 0.32 + i * 0.05));
        const d = tip.clone().sub(handL);
        this.poles[i].position.copy(handL).addScaledVector(d, 0.5);
        this.poles[i].quaternion.setFromUnitVectors(UP, d.normalize());
      }
    }
  }
}
