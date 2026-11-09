// Anatomical human skier with CC0 MakeHuman/MPFB skin and original ski equipment.
// Ski-specific two-bone IK drives the shared poses for the player, friends and ambient skiers.
import * as THREE from 'three/webgpu';
import { HumanBody } from './humanBody';
import { helmetAndGoggles, skiBoot, skiWithBindings, skiPole, jacketCollar } from './skiEquipment';

export interface SkierPose {
  speed: number;     // m/s
  edge: number;      // rad, + = right turn
  plow: number;      // 0..1
  tuck: number;      // 0..1
  skid: number;      // 0..1
  fallen: number;    // 0..1 blend
  sitting: number;   // 0..1 blend (on the chair)
  time: number;      // seconds (for idle motion)
  pushing: boolean;
  liftPreparation?: number; // preparing knees/hands for an approaching chair
  footGroundY?: number; // snow height relative to the root, used until skis leave the ramp
  footGroundPitch?: number;
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

function solveIK(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, outMid: THREE.Vector3) {
  const d = target.clone().sub(root);
  let dist = d.length();
  dist = Math.min(dist, l1 + l2 - 1e-3);
  const dir = d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const poleDir = pole.clone().sub(root);
  poleDir.sub(dir.clone().multiplyScalar(poleDir.dot(dir))).normalize();
  outMid.copy(root).addScaledVector(dir, a).addScaledVector(poleDir, h);
  return outMid;
}

export class SkierModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group(); // tilted for falls
  readonly human: HumanBody;
  private headGear = helmetAndGoggles();
  private boots = [skiBoot(), skiBoot()];
  private skis = [skiWithBindings(), skiWithBindings()];
  private poles = [skiPole(), skiPole()];
  private collar;
  private fallSide = 1;
  private lastFallen = 0;
  private lastEdgeSign = 0;
  private plant = 0;      // 0..1 pole plant animation phase
  private lastTime = 0;
  private plantSide = 1;  // which pole (+1 right, -1 left)

  constructor(jacket = new THREE.Color('#d33a2c')) {
    this.human = new HumanBody(jacket);
    this.collar = jacketCollar(jacket);
    this.root.add(this.body);
    this.body.add(this.human.root, this.headGear, this.collar.group, ...this.boots, ...this.skis, ...this.poles);
    this.root.traverse(o => { o.frustumCulled = false; });
    this.update({ speed: 0, edge: 0, plow: 0, tuck: 0, skid: 0, fallen: 0, sitting: 0, time: 0, pushing: false });
  }

  setJacket(c: THREE.ColorRepresentation) { this.human.setJacket(c); this.collar.material.color.set(c); }

  /** Update joint positions. Local frame: feet at origin, skier faces -z, +x right. */
  update(p: SkierPose) {
    const t = p.time;
    const sit = p.sitting;
    // fall side chosen when a fall starts
    if (p.fallen > 0.01 && this.lastFallen <= 0.01) this.fallSide = p.edge >= 0 ? 1 : -1;
    this.lastFallen = p.fallen;

    // pole plant: when the edges change sign at speed, plant the new inside pole
    const es = Math.abs(p.edge) > 0.12 ? Math.sign(p.edge) : 0;
    if (es !== 0 && es !== this.lastEdgeSign && p.speed > 3 && p.tuck < 0.3 && sit === 0) { this.plant = 1; this.plantSide = es; }
    if (es !== 0) this.lastEdgeSign = es;
    const dt = Math.max(0, Math.min(0.1, t - this.lastTime)); this.lastTime = t;
    this.plant = Math.max(0, this.plant - dt * 2.1);
    // ---- stance parameters ----
    const prepare = (p.liftPreparation ?? 0) * (1 - sit);
    const flex = 0.12 + 0.06 * Math.min(1, p.speed / 15) + 0.35 * p.tuck + 0.08 * p.plow + .08 * prepare;
    const incline = THREE.MathUtils.clamp(p.edge * 0.75, -0.75, 0.75) * Math.min(1, p.speed / 4) * (1 - sit);
    const wedge = p.plow * (1 - sit);
    const stanceW = 0.14 + 0.2 * wedge;
    const bounce = Math.sin(t * 9) * 0.008 * Math.min(1, p.speed / 8) * (1 - p.tuck);

    // feet (ankles) on the skis
    const ankleL = V(-stanceW, 0.12, 0.02);
    const ankleR = V(stanceW, 0.12, 0.02);
    // inclination: shift the body toward the turn center
    const lateral = Math.sin(incline) * 0.75;
    let pelvisH = 0.98 - flex * 0.9 + bounce;
    let pelvis = V(lateral, pelvisH, 0.06 + flex * 0.25);
    // chest leans forward with tuck
    const lean = 0.25 + 0.75 * p.tuck + 0.15 * flex;
    let chest = pelvis.clone().add(V(Math.sin(incline) * 0.25, Math.cos(lean) * 0.5, -Math.sin(lean) * 0.5));

    if (sit > 0) {
      // sitting on the chair: hips back on the seat, thighs horizontal, legs hanging
      const sp = V(0, 0.54, 0.25), sc = V(0, 1.07, 0.33);
      pelvis = pelvis.lerp(sp, sit); chest = chest.lerp(sc, sit);
      const footY = Math.max(-.05, (p.footGroundY ?? -Infinity) + .145);
      ankleL.lerp(V(-0.14, footY, -0.2), sit); ankleR.lerp(V(0.14, footY, -0.2), sit);
      pelvisH = pelvis.y;
    }
    const neck = chest.clone().add(V(0, 0.12, -0.03));
    const head = neck.clone().add(V(0, 0.10, -0.01 - 0.04 * p.tuck));

    // hips and legs (2-bone IK with knees pointing forward)
    const hipL = pelvis.clone().add(V(-0.1, -0.02, 0));
    const hipR = pelvis.clone().add(V(0.1, -0.02, 0));
    const kneeL = new THREE.Vector3(), kneeR = new THREE.Vector3();
    const poleFwd = (hip: THREE.Vector3, x: number) => hip.clone().add(V(x, 0, -1.2));
    solveIK(hipL, ankleL, 0.46, 0.46, poleFwd(hipL, wedge * 0.25), kneeL);
    solveIK(hipR, ankleR, 0.46, 0.46, poleFwd(hipR, -wedge * 0.25), kneeR);

    // arms: hands forward and wide; tuck brings them in front of the face; pushing swings them
    const push = p.pushing ? Math.sin(t * 5) : 0;
    const shL = chest.clone().add(V(-0.19, 0.06, 0)), shR = chest.clone().add(V(0.19, 0.06, 0));
    let handL = chest.clone().add(V(-0.32, -0.28, -0.32 + push * 0.2));
    let handR = chest.clone().add(V(0.32, -0.28, -0.32 + push * 0.2));
    if (p.tuck > 0) {
      handL.lerp(head.clone().add(V(-0.12, -0.2, -0.3)), p.tuck);
      handR.lerp(head.clone().add(V(0.12, -0.2, -0.3)), p.tuck);
    }
    if (sit > 0) {
      handL.lerp(V(-0.25, 0.65, -0.1), sit); handR.lerp(V(0.25, 0.65, -0.1), sit);
    }
    const elL = new THREE.Vector3(), elR = new THREE.Vector3();
    solveIK(shL, handL, 0.3, 0.28, shL.clone().add(V(-0.4, -0.4, 0.4)), elL);
    solveIK(shR, handR, 0.3, 0.28, shR.clone().add(V(0.4, -0.4, 0.4)), elR);

    this.human.pose({ pelvis, chest, neck, head, hipL, hipR, kneeL, kneeR, ankleL, ankleR,
      shoulderL: shL, shoulderR: shR, elbowL: elL, elbowR: elR, handL, handR },
      new THREE.Euler(-0.10 + 0.3 * p.tuck, 0, -incline * 0.2));
    this.headGear.position.copy(head);
    this.headGear.rotation.set(-0.10 + 0.3 * p.tuck, 0, -incline * 0.2);
    this.collar.group.position.copy(neck);
    this.collar.group.rotation.x = -lean * 0.35;
    this.boots[0].position.copy(ankleL);
    this.boots[1].position.copy(ankleR);

    // skis: edged with inclination, toes in for the wedge
    const toe = 0.32 * wedge;
    const edgeTilt = -incline * 0.9;
    const sk = this.skis;
    sk[0].position.set(ankleL.x, ankleL.y - 0.13, ankleL.z - 0.05);
    sk[1].position.set(ankleR.x, ankleR.y - 0.13, ankleR.z - 0.05);
    sk[0].rotation.set(0, -toe, edgeTilt + wedge * 0.18, 'YXZ');
    sk[1].rotation.set(0, toe, edgeTilt - wedge * 0.18, 'YXZ');
    if (sit > 0 || p.footGroundY !== undefined) {
      const clearance = Math.max(0, -.18 - (p.footGroundY ?? -Infinity));
      const hanging = Math.min(1, clearance / .3);
      for (const s of sk) s.rotation.x = (p.footGroundPitch ?? 0) * (1 - hanging) + .35 * sit * hanging;
    }
    this.boots[0].rotation.copy(sk[0].rotation);
    this.boots[1].rotation.copy(sk[1].rotation);

    // poles from hands angled back
    const placePole = (pole: THREE.Group, hand: THREE.Vector3, side: number) => {
      const tipPos = hand.clone().add(V(side * 0.12, -1.05, 0.55 + 0.3 * p.tuck));
      if (this.plant > 0 && side === this.plantSide) {
        // swing the tip forward and down beside the ski tip, then let it trail
        const k = Math.sin(this.plant * Math.PI);
        tipPos.lerp(hand.clone().add(V(side * 0.25, -1.0, -0.45)), k);
      }
      if (p.tuck > 0.3) tipPos.lerp(hand.clone().add(V(side * 0.1, -0.35, 1.0)), p.tuck);
      if (p.pushing) tipPos.z += push * side * 0.25;
      // Carry poles forward and clear of the snow during pickup and sitting.
      const carry = Math.min(1, Math.max(sit * 2, prepare));
      tipPos.lerp(hand.clone().add(V(side * .08, .2, -1.15)), carry);
      const d = tipPos.clone().sub(hand);
      pole.position.copy(hand).addScaledVector(d, 0.5);
      pole.quaternion.setFromUnitVectors(UP, d.normalize());
    };
    placePole(this.poles[0], handL, -1);
    placePole(this.poles[1], handR, 1);

    // ---- fall: tip the whole body onto its side ----
    const f = p.fallen;
    this.body.rotation.set(-0.25 * f, 0, this.fallSide * f * 1.35);
    this.body.position.set(this.fallSide * f * 0.35, f * 0.12, 0);
  }
}
