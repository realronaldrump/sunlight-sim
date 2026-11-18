// A person on foot at the resort: the same anatomical CC0 human as the skiers, in ski boots, carrying
// skis on the shoulder and poles in the other hand, or seated at a table. Poses are procedural
// two-bone IK like the skier: a short, stiff-ankled ski-boot gait, idle weight shifts and sitting.
import * as THREE from 'three/webgpu';
import { HumanBody } from '../skier/humanBody';
import { holdPole, skiBoot, skiWithBindings, skiPole, jacketCollar } from '../skier/skiEquipment';
import type { CrowdGear } from './crowdGear';
import { headwear, type Hat } from '../skier/headwear';
import { guestBuild } from '../skier/winterClothing';

export interface PedestrianPose {
  mode: 'walk' | 'stand' | 'sit';
  stride: number;    // gait phase in steps (WalkState.stride)
  speed: number;     // m/s
  time: number;      // s, for idle motion
  seat?: number;     // seat height above the feet, when sitting
  carry?: boolean;   // skis on the shoulder and poles in hand
  skis?: 'shoulder' | 'feet' | 'planted' | 'none'; // overrides `carry`: on the feet in a lift line, planted beside a group
  handsOnTable?: number; // table height above the feet, when seated at one
  lookYaw?: number;  // head turn, rad
  /** Right arm: wave beside the head, point toward `yaw` (local, 0 = ahead), or a lift operator's raised-arm signal. */
  gesture?: { kind: 'wave' | 'point' | 'signal'; amount: number; yaw?: number };
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const BOARD_PALM = V(0.035, -0.012, -0.085);
const BOARD_EDGE = V(0.031, -0.004, -0.111);

function solveIK(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3) {
  const d = target.clone().sub(root);
  const dist = Math.min(d.length(), l1 + l2 - 1e-3);
  const dir = d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const pd = pole.clone().sub(root); pd.sub(dir.clone().multiplyScalar(pd.dot(dir))).normalize();
  return out.copy(root).addScaledVector(dir, a).addScaledVector(pd, h);
}

export interface Appearance { jacket: THREE.Color; skin?: THREE.Color; hat?: Hat; scale?: number; hatColor?: THREE.Color; instancedGear?: boolean; lod?: 'full' | 'crowd' }
export interface SignWalkerOutfit { head: THREE.Group; boot: () => THREE.Group; board: THREE.Group }

export class PedestrianModel {
  readonly root = new THREE.Group();
  readonly human: HumanBody;
  private head: THREE.Group;
  private boots: THREE.Group[];
  private skis: THREE.Group[];
  private poles: THREE.Group[];
  private collar;
  private collarAnchor: THREE.Group;
  private lastTime = NaN;
  private gaze = 0;
  private stand = Math.random() * 10;
  carrying = true;

  constructor(readonly look: Appearance, private readonly outfit?: SignWalkerOutfit) {
    this.human = new HumanBody(look.jacket, look.skin ?? new THREE.Color(1, 1, 1), look.lod ?? 'full', look.scale);
    this.collar = outfit || look.instancedGear ? null : jacketCollar(look.jacket);
    this.collarAnchor = this.collar?.group ?? new THREE.Group();
    if (look.hatColor && !outfit) guestBuild(this.root.scale, look.jacket.getHex(), look.hatColor.getHex(), look.scale);
    // Crowd members keep empty anchors; CrowdGear draws their gear instanced at these transforms.
    const anchor = (make: () => THREE.Group) => look.instancedGear || outfit ? new THREE.Group() : make();
    this.head = outfit?.head ?? anchor(() => headwear(look.hat ?? 'helmet', look.hatColor));
    this.boots = outfit ? [outfit.boot(), outfit.boot()] : [anchor(() => skiBoot(-1)), anchor(() => skiBoot(1))];
    this.skis = [anchor(skiWithBindings), anchor(skiWithBindings)];
    this.poles = [anchor(skiPole), anchor(skiPole)];
    this.root.add(this.human.root, this.head, ...this.boots, ...this.skis, ...this.poles);
    if (!outfit) this.root.add(this.collarAnchor);
    if (outfit) this.root.add(outfit.board);
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.update({ mode: 'stand', stride: 0, speed: 0, time: 0, carry: true });
  }

  setJacket(c: THREE.ColorRepresentation) { this.look.jacket.set(c); this.human.setJacket(c); this.collar?.material.color.set(c); }

  /** Draw this person's gear through the shared crowd instancer (call after update()). */
  pushGear(gear: CrowdGear, detail: boolean) {
    // The anchors are direct children. Updating the skeleton here repeats the renderer's skinning setup.
    this.root.updateWorldMatrix(true, false);
    for (const o of [this.head, ...this.boots, this.collarAnchor, ...this.skis, ...this.poles]) o.updateMatrixWorld();
    gear.push(this.look.hat ?? 'helmet', this.head.matrixWorld, detail, this.look.hatColor);
    gear.push('leftBoot', this.boots[0].matrixWorld, detail);
    gear.push('rightBoot', this.boots[1].matrixWorld, detail);
    if (detail) gear.push('collar', this.collarAnchor.matrixWorld, true, this.look.jacket);
    if (this.carrying) {
      for (const ski of this.skis) gear.push('ski', ski.matrixWorld, detail);
      for (const pole of this.poles) gear.push('pole', pole.matrixWorld, detail);
    }
  }

  /** Local frame: feet at the origin, facing -z, +x to the right. */
  update(p: PedestrianPose) {
    const t = p.time + this.stand;
    const skiMode = this.outfit ? 'none' : p.skis ?? ((p.carry ?? true) ? 'shoulder' : 'none');
    const carry = skiMode === 'shoulder';
    const onSkis = skiMode === 'feet';
    let pelvis: THREE.Vector3, chest: THREE.Vector3, ankleL: THREE.Vector3, ankleR: THREE.Vector3;
    let handL: THREE.Vector3, handR: THREE.Vector3;
    let liftL = 0, liftR = 0, footPitchL = 0, footPitchR = 0;
    const kneePole = V(0, 0.3, -1.2);
    if (p.mode === 'sit') {
      const seat = (p.seat ?? 0.45) / this.root.scale.y;
      pelvis = V(0, seat + 0.1, 0.06);
      chest = pelvis.clone().add(V(0, 0.48, -0.06));
      ankleL = V(-0.13, 0.12, -0.42); ankleR = V(0.13, 0.12, -0.4);
      const table = p.handsOnTable === undefined ? undefined : p.handsOnTable / this.root.scale.y;
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
      ankleL = V(onSkis ? -0.13 : -0.11, 0.115, -Math.sin(theta) * S * (onSkis ? 0.4 : 1));
      ankleR = V(onSkis ? 0.13 : 0.11, 0.115, Math.sin(theta) * S * (onSkis ? 0.4 : 1));
      liftL = Math.max(0, Math.cos(theta)) * (0.07 + 0.05 * run) * walking;
      liftR = Math.max(0, -Math.cos(theta)) * (0.07 + 0.05 * run) * walking;
      if (onSkis) { liftL = 0; liftR = 0; } // skis glide; boots stay clicked in
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
      if (onSkis) { // hands forward on the pole grips, pushing gently when shuffling forward
        const push = Math.sin(theta) * 0.12 * walking;
        handL = chest.clone().add(V(-0.3, -0.42, -0.22 + push)); handR = chest.clone().add(V(0.3, -0.42, -0.22 + push));
        pelvis.y -= 0.05; pelvis.z += 0.04;
      }
    }
    if (this.outfit) {
      const sway = Math.sin(Math.PI * p.stride) * Math.min(p.speed, 1);
      handR = chest.clone().add(V(0.42, -0.32 + sway * 0.012, -0.21 + sway * 0.015));
      // The board's origin is where its bottom edge meets the raised right palm.
      this.outfit.board.position.copy(handR).add(BOARD_EDGE);
      this.outfit.board.rotation.set(-0.05, -0.29, 0.18 + sway * 0.04);
    }
    const stepTurn = p.mode === 'walk' && !onSkis ? .11 * Math.cos(Math.PI * p.stride) * Math.min(1, p.speed / .8) : 0;
    chest.y += .005 * Math.sin(t * 1.53);
    const neck = chest.clone().add(V(0, 0.12, -0.02));
    const head = neck.clone().add(V(0, 0.1, -0.015));
    const hipL = pelvis.clone().add(V(-0.1, -0.02, 0)), hipR = pelvis.clone().add(V(0.1, -0.02, 0));
    const kneeL = new THREE.Vector3(), kneeR = new THREE.Vector3();
    solveIK(hipL, ankleL, 0.46, 0.46, hipL.clone().add(kneePole), kneeL);
    solveIK(hipR, ankleR, 0.46, 0.46, hipR.clone().add(kneePole), kneeR);
    const shL = chest.clone().add(V(-0.19, 0.06, 0).applyAxisAngle(UP, stepTurn)), shR = chest.clone().add(V(0.19, 0.06, 0).applyAxisAngle(UP, stepTurn));
    if (p.gesture && p.gesture.amount > 0) {
      const k = Math.min(1, p.gesture.amount);
      if (p.gesture.kind === 'signal') handR.lerp(shR.clone().add(V(0.08, 0.55, -0.08)), k);
      else if (p.gesture.kind === 'wave') handR.lerp(head.clone().add(V(0.3 + Math.sin(t * 9) * 0.13, 0.22, -0.04)), k);
      else {
        const yaw = p.gesture.yaw ?? 0, dir = V(-Math.sin(yaw), -0.15, -Math.cos(yaw)).normalize();
        handR.lerp(shR.clone().addScaledVector(dir, 0.57), k);
      }
    }
    const elL = new THREE.Vector3(), elR = new THREE.Vector3();
    solveIK(shL, handL, 0.3, 0.28, shL.clone().add(V(-0.3, -0.5, 0.4)), elL);
    solveIK(shR, handR, 0.3, 0.28, shR.clone().add(V(0.35, -0.5, 0.3)), elR);
    const targetGaze = p.lookYaw ?? Math.sin(t * .34) * (p.mode === 'walk' ? .09 : .28);
    const elapsed = p.time - this.lastTime;
    this.gaze += (targetGaze - this.gaze) * (elapsed >= 0 && elapsed < 1 ? 1 - Math.exp(-6 * elapsed) : 1);
    this.lastTime = p.time;
    const look = new THREE.Euler(-.06 + (p.mode === 'sit' ? .10 : 0) + .014 * Math.sin(t * .83), this.gaze, stepTurn * .14, 'YXZ');
    this.human.pose({ pelvis, chest, neck, head, hipL, hipR, kneeL, kneeR, ankleL, ankleR,
      shoulderL: shL, shoulderR: shR, elbowL: elL, elbowR: elR, handL, handR }, look,
      this.outfit ? BOARD_PALM : undefined, { pelvis: -stepTurn * .35, chest: stepTurn },
      p.mode === 'sit' || skiMode === 'none' || skiMode === 'planted');
    this.head.position.copy(head); this.head.rotation.copy(look);
    this.collarAnchor.position.copy(neck); this.collarAnchor.rotation.set(-.05, stepTurn, 0);
    this.boots[0].position.copy(ankleL); this.boots[1].position.copy(ankleR);
    this.boots[0].rotation.set(footPitchL, 0, 0); this.boots[1].rotation.set(footPitchR, 0, 0);

    this.carrying = skiMode !== 'none' && p.mode !== 'sit';
    for (const s of this.skis) s.visible = this.carrying;
    for (const s of this.poles) s.visible = this.carrying;
    if (onSkis && p.mode !== 'sit') {
      // clicked in: skis under the boots, pole baskets planted beside the ski tips
      const ankles = [ankleL, ankleR];
      for (let i = 0; i < 2; i++) { this.skis[i].position.set(ankles[i].x, ankles[i].y - 0.13, ankles[i].z - 0.05); this.skis[i].rotation.set(0, 0, 0); }
      for (let i = 0; i < 2; i++) {
        const hand = i === 0 ? handL : handR, side = i === 0 ? -1 : 1;
        const tip = V(side * 0.42, 0.02, hand.z + 0.1);
        holdPole(this.poles[i], hand, tip);
      }
    } else if (skiMode === 'planted' && p.mode !== 'sit') {
      // skis standing tail-down in the snow at the person's right side, poles leaning against them
      for (let i = 0; i < 2; i++) { this.skis[i].position.set(0.45 + i * 0.05, 0.76, -0.08 + i * 0.02); this.skis[i].rotation.set(Math.PI / 2 - 0.06, 0, i === 0 ? 0.03 : -0.03); }
      for (let i = 0; i < 2; i++) {
        const top = V(0.48 + i * 0.03, 1.25, -0.02), tip = V(0.62 + i * 0.1, 0.0, 0.25 - i * 0.12);
        const d = tip.clone().sub(top);
        this.poles[i].position.copy(top).addScaledVector(d, 0.5);
        this.poles[i].quaternion.setFromUnitVectors(UP, d.normalize());
      }
    } else if (carry && p.mode !== 'sit') {
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
        holdPole(this.poles[i], handL, tip, (i - .5) * .021);
      }
    }
  }
}
