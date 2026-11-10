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
  skiContact?: { offset: number; pitch: number }[];
  airborne?: boolean;
  /** Weight and step phase when shuffling uphill or along a loading ramp. */
  touring?: { amount: number; stride: number };
  rockX?: number; rockZ?: number; slipping?: number;
  /** 0..1 windmilling arms and kicking legs (whirled around the bull wheel, flung through the air). */
  flail?: number;
  /** False while skis and poles lie scattered in a yard sale. */
  gear?: boolean;
  /** A wave (pole hand up beside the helmet) or a point (arm out toward `yaw`, local, 0 = straight ahead). */
  gesture?: { kind: 'wave' | 'point'; amount: number; yaw?: number };
  costumeAction?: { kind: 'hat-tip' | 'hang-star'; amount: number; yaw: number; anchor?: THREE.Vector3; released?: boolean };
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

interface SkierCostume {
  headGear: THREE.Group;
  ski: () => THREE.Group;
  pole: () => THREE.Group;
  accessories?: {
    root: THREE.Group;
    pose(dt: number, p: SkierPose, chest: THREE.Vector3, pelvis: THREE.Vector3, hand: THREE.Vector3): void;
  };
}

export class SkierModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group(); // tilted for falls
  readonly human: HumanBody;
  private headGear: THREE.Group;
  private boots = [skiBoot(), skiBoot()];
  private skis: THREE.Group[];
  private poles: THREE.Group[];
  private collar;
  private fallSide = 1;
  private lastFallen = 0;
  private lastEdgeSign = 0;
  private plant = 0;      // 0..1 pole plant animation phase
  private lastTime = 0;
  private accessories?: SkierCostume['accessories'];
  private plantSide = 1;  // which pole (+1 right, -1 left)

  constructor(jacket = new THREE.Color('#d33a2c'), lod: 'full' | 'crowd' = 'full', skin = new THREE.Color(1, 1, 1), costume?: SkierCostume) {
    this.human = new HumanBody(jacket, skin, lod);
    this.headGear = costume?.headGear ?? helmetAndGoggles();
    const ski = costume?.ski ?? skiWithBindings, pole = costume?.pole ?? skiPole;
    this.skis = [ski(), ski()];
    this.poles = [pole(), pole()];
    this.collar = jacketCollar(jacket);
    this.collar.group.visible = !costume;
    this.root.add(this.body);
    this.body.add(this.human.root, this.headGear, this.collar.group, ...this.boots, ...this.skis, ...this.poles);
    this.accessories = costume?.accessories;
    if (this.accessories) this.body.add(this.accessories.root);
    this.root.traverse(o => { o.frustumCulled = false; });
    this.update({ speed: 0, edge: 0, plow: 0, tuck: 0, skid: 0, fallen: 0, sitting: 0, time: 0, pushing: false });
  }

  setJacket(c: THREE.ColorRepresentation) { this.human.setJacket(c); this.collar.material.color.set(c); }
  private helmetShell: THREE.MeshStandardNodeMaterial | null = null;
  /** Give this skier a helmet colour of their own (the shell material is otherwise shared). */
  setHelmet(c: THREE.ColorRepresentation) {
    if (!this.helmetShell) {
      const shell = this.headGear.children[0] as THREE.Mesh;
      this.helmetShell = (shell.material as THREE.MeshStandardNodeMaterial).clone();
      shell.material = this.helmetShell;
    }
    this.helmetShell.color.set(c);
  }
  /** Dress as a particular resort guest: jacket, skin tone, helmet (or beanie colour) and body size. */
  dress(look: { jacket: number; skin: number[]; hatColor: number; scale?: number }) {
    this.setJacket(look.jacket);
    this.human.setSkin(new THREE.Color(look.skin[0], look.skin[1], look.skin[2]));
    this.setHelmet(look.hatColor);
    this.root.scale.setScalar(look.scale ?? 1);
  }

  /** Update joint positions. Local frame: feet at origin, skier faces -z, +x right. */
  update(p: SkierPose) {
    const t = p.time;
    const gear = p.gear !== false;
    for (const o of [...this.skis, ...this.poles]) o.visible = gear;
    const sit = p.sitting, tour = (p.touring?.amount ?? 0) * (1 - sit);
    const stride = (p.touring?.stride ?? 0) * Math.PI;
    const step = Math.sin(stride);
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
    const bounce = Math.sin(t * 9) * 0.008 * Math.min(1, p.speed / 8) * (1 - p.tuck)
      + tour * .021 * Math.abs(Math.sin(stride));

    // feet (ankles) on the skis
    const ankleL = V(-stanceW, 0.12, 0.02);
    const ankleR = V(stanceW, 0.12, 0.02);
    ankleL.add(V(-.025 * tour, tour * .11 * Math.max(0, Math.cos(stride)), -.24 * tour * step));
    ankleR.add(V(.025 * tour, tour * .11 * Math.max(0, -Math.cos(stride)), .24 * tour * step));
    // inclination: shift the body toward the turn center
    const lateral = Math.sin(incline) * 0.75;
    let pelvisH = 0.98 - flex * 0.9 + bounce;
    let pelvis = V(lateral, pelvisH, 0.06 + flex * 0.25);
    // chest leans forward with tuck
    const lean = 0.25 + 0.75 * p.tuck + 0.15 * flex;
    let chest = pelvis.clone().add(V(Math.sin(incline) * 0.25, Math.cos(lean) * 0.5, -Math.sin(lean) * 0.5));

    if (sit > 0) {
      // sitting on the chair: hips back on the seat, thighs horizontal, legs hanging
      const sp = V(0, 0.54, 0.25), sc = V((p.rockX ?? 0) * .19, 1.07 - (p.slipping ?? 0) * .24, .33 - (p.rockZ ?? 0) * .2);
      pelvis = pelvis.lerp(sp, sit); chest = chest.lerp(sc, sit);
      const footY = Math.max(-.05, (p.footGroundY ?? -Infinity) + .145);
      ankleL.lerp(V(-0.14, footY, -0.2), sit); ankleR.lerp(V(0.14, footY, -0.2), sit);
      pelvisH = pelvis.y;
    }
    if (p.skiContact && sit === 0 && !p.airborne && p.fallen < .1) {
      ankleL.y += p.skiContact[0].offset;
      ankleR.y += p.skiContact[1].offset;
    }
    if (p.airborne) {
      ankleL.add(V(-.1, .12, -.12)); ankleR.add(V(.13, .2, .1));
    }
    const flail = p.flail ?? 0;
    if (flail > 0) { ankleL.add(V(-.08, .22 * Math.sin(t * 15) * flail, .1 * flail)); ankleR.add(V(.08, .22 * Math.sin(t * 15 + 2.4) * flail, -.1 * flail)); }
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
    handL.z += tour * .31 * step; handR.z -= tour * .31 * step;
    handL.y += tour * .07 * step; handR.y -= tour * .07 * step;
    if (p.tuck > 0) {
      handL.lerp(head.clone().add(V(-0.12, -0.2, -0.3)), p.tuck);
      handR.lerp(head.clone().add(V(0.12, -0.2, -0.3)), p.tuck);
    }
    if (sit > 0) {
      handL.lerp(V(-0.25, 0.65, -0.1), sit); handR.lerp(V(0.25, 0.65, -0.1), sit);
    }
    if (p.airborne) { handL = chest.clone().add(V(-.5, -.08, -.15)); handR = chest.clone().add(V(.48, .12, -.24)); }
    if (flail > 0) {
      // windmilling: each hand circles beside the shoulders, out of phase
      handL.lerp(chest.clone().add(V(-.42, .22 + .38 * Math.sin(t * 13), -.1 + .38 * Math.cos(t * 13))), flail);
      handR.lerp(chest.clone().add(V(.42, .22 + .38 * Math.sin(t * 13 + 2.2), -.1 + .38 * Math.cos(t * 13 + 2.2))), flail);
    }
    if (p.gesture && p.gesture.amount > 0 && !p.airborne && p.fallen < 0.5) {
      const k = Math.min(1, p.gesture.amount);
      if (p.gesture.kind === 'wave') handR.lerp(head.clone().add(V(0.3 + Math.sin(t * 9) * 0.13, 0.2, -0.04)), k);
      else {
        const yaw = p.gesture.yaw ?? 0, dir = V(-Math.sin(yaw), -0.2, -Math.cos(yaw)).normalize();
        handR.lerp(shR.clone().addScaledVector(dir, 0.57), k);
      }
    }
    const action = p.costumeAction;
    const tip = action?.kind === 'hat-tip' ? action.amount : 0;
    const headTilt = new THREE.Euler(-.10 + .3 * p.tuck + .15 * tip,
      action ? THREE.MathUtils.clamp(action.yaw, -.85, .85) * action.amount : 0,
      -incline * .2 + tip * .14);
    if (action) {
      const reach = action.kind === 'hat-tip'
        ? head.clone().add(V(.132, .146, -.056).applyEuler(headTilt))
        : action.anchor?.clone().add(V(.025, -.021, .063));
      if (reach) handR.lerp(reach.sub(shR).clampLength(0, .568).add(shR), action.amount);
    }
    const elL = new THREE.Vector3(), elR = new THREE.Vector3();
    solveIK(shL, handL, 0.3, 0.28, shL.clone().add(V(-0.4, -0.4, 0.4)), elL);
    solveIK(shR, handR, 0.3, 0.28, shR.clone().add(V(0.4, -0.4, 0.4)), elR);

    this.human.pose({ pelvis, chest, neck, head, hipL, hipR, kneeL, kneeR, ankleL, ankleR,
      shoulderL: shL, shoulderR: shR, elbowL: elL, elbowR: elR, handL, handR },
      headTilt);
    this.headGear.position.copy(head);
    this.headGear.rotation.copy(headTilt);
    this.accessories?.pose(dt, p, chest, pelvis, handR);
    this.collar.group.position.copy(neck);
    this.collar.group.rotation.x = -lean * 0.35;
    this.boots[0].position.copy(ankleL);
    this.boots[1].position.copy(ankleR);

    // skis: edged with inclination, toes in for the wedge
    const toe = 0.32 * wedge - 0.20 * tour;
    const edgeTilt = -incline * 0.9;
    const sk = this.skis;
    sk[0].position.set(ankleL.x, ankleL.y - 0.13, ankleL.z - 0.05);
    sk[1].position.set(ankleR.x, ankleR.y - 0.13, ankleR.z - 0.05);
    sk[0].rotation.set(0, -toe, edgeTilt + wedge * 0.18, 'YXZ');
    sk[1].rotation.set(0, toe, edgeTilt - wedge * 0.18, 'YXZ');
    sk[0].rotation.x -= tour * .17 * Math.max(0, Math.cos(stride));
    sk[1].rotation.x -= tour * .17 * Math.max(0, -Math.cos(stride));
    if (p.skiContact && sit === 0 && !p.airborne && p.fallen < .1) {
      sk.forEach((ski, i) => { ski.rotation.x += p.skiContact![i].pitch; });
    }
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
      if (p.pushing) tipPos.z += push * side * 0.25 * (1 - tour);
      tipPos.z += tour * (-.43 + .35 * step * side);
      // Carry poles forward and clear of the snow during pickup and sitting.
      const carry = Math.min(1, Math.max(sit * 2, prepare));
      tipPos.lerp(hand.clone().add(V(side * .08, .2, -1.15)), carry);
      if (side > 0 && action) tipPos.lerp(hand.clone().add(V(.14, -1.13, .17)), action.amount);
      const d = tipPos.clone().sub(hand);
      pole.position.copy(hand).addScaledVector(d, 0.5);
      pole.quaternion.setFromUnitVectors(UP, d.normalize());
    };
    placePole(this.poles[0], handL, -1);
    placePole(this.poles[1], handR, 1);

    // ---- fall: tip the whole body onto its side ----
    const f = p.airborne ? 0 : p.fallen;
    this.body.rotation.set(-0.25 * f, 0, this.fallSide * f * 1.35);
    this.body.position.set(this.fallSide * f * 0.35, f * 0.12, 0);
  }
}
