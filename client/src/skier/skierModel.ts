// Procedurally rigged and animated skier. Joint positions are computed each frame from pose
// parameters (stance height, inclination, wedge, tuck, fall, sitting) with 2-bone IK for the legs and
// arms; limb meshes are then placed between joints. No external assets or licenses involved.
import * as THREE from 'three/webgpu';

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
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

function limb(r: number, mat: THREE.Material) {
  const g = new THREE.CapsuleGeometry(r, 1, 4, 10);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

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
  private parts: Record<string, THREE.Mesh> = {};
  private skis: THREE.Mesh[] = [];
  private poles: THREE.Mesh[] = [];
  readonly jacketMat: THREE.MeshStandardNodeMaterial;
  private fallSide = 1;
  private lastFallen = 0;
  private lastEdgeSign = 0;
  private plant = 0;      // 0..1 pole plant animation phase
  private plantSide = 1;  // which pole (+1 right, -1 left)

  constructor(jacket = new THREE.Color('#d33a2c')) {
    const jacketMat = new THREE.MeshStandardNodeMaterial({ color: jacket, roughness: 0.75 });
    this.jacketMat = jacketMat;
    const pantsMat = new THREE.MeshStandardNodeMaterial({ color: 0x1d2330, roughness: 0.8 });
    const helmetMat = new THREE.MeshStandardNodeMaterial({ color: 0xf2f2f2, roughness: 0.35 });
    const goggleMat = new THREE.MeshStandardNodeMaterial({ color: 0xffa52a, roughness: 0.1, metalness: 0.6 });
    const skinMat = new THREE.MeshStandardNodeMaterial({ color: 0xd9a585, roughness: 0.7 });
    const bootMat = new THREE.MeshStandardNodeMaterial({ color: 0x2a2a2e, roughness: 0.5 });
    const gloveMat = new THREE.MeshStandardNodeMaterial({ color: 0x111111, roughness: 0.8 });
    const skiMat = new THREE.MeshStandardNodeMaterial({ color: 0x1565c0, roughness: 0.4 });
    const poleMat = new THREE.MeshStandardNodeMaterial({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.8 });

    this.root.add(this.body);
    const add = (name: string, m: THREE.Mesh) => { this.parts[name] = m; this.body.add(m); return m; };
    // jacket body: lathe profile hips -> waist -> chest -> shoulders, oval cross-section, unit height
    const prof = [[0.0, 0.0], [0.155, 0.0], [0.16, 0.12], [0.15, 0.3], [0.17, 0.55], [0.175, 0.75], [0.15, 0.9], [0.08, 1.0], [0.0, 1.0]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const torsoGeo = new THREE.LatheGeometry(prof, 18);
    torsoGeo.scale(1.12, 1, 0.8);
    const torso = new THREE.Mesh(torsoGeo, jacketMat); torso.castShadow = true; torso.userData.lathe = true;
    add('torso', torso);
    // zipper and hem details
    const zip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.9, 0.01), new THREE.MeshStandardNodeMaterial({ color: 0x222222 }));
    zip.position.set(0, 0.5, -0.142); torso.add(zip);
    add('shoulders', limb(0.1, jacketMat));
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.09, 12), jacketMat); add('collar', collar);
    add('pelvis', limb(0.14, pantsMat));
    for (const s of ['L', 'R']) {
      add('thigh' + s, limb(0.075, pantsMat));
      add('shin' + s, limb(0.065, pantsMat));
      add('upper' + s, limb(0.055, jacketMat));
      add('fore' + s, limb(0.05, jacketMat));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), gloveMat); hand.castShadow = true; add('hand' + s, hand);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.26, 0.33), bootMat); boot.castShadow = true; add('boot' + s, boot);
      const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.03, 0.12), poleMat); buckle.position.set(0, 0.04, -0.03); boot.add(buckle);
      const ski = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.025, 1.65), skiMat);
      ski.castShadow = true;
      // turned-up tip
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.18), skiMat);
      tip.position.set(0, 0.03, -0.86); tip.rotation.x = 0.45; ski.add(tip);
      this.skis.push(ski); this.body.add(ski);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 1.2, 6), poleMat);
      const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 10), new THREE.MeshStandardNodeMaterial({ color: 0x222222 }));
      basket.position.y = -0.52; pole.add(basket);
      pole.castShadow = true; this.poles.push(pole); this.body.add(pole);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skinMat); head.castShadow = true; add('head', head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), helmetMat);
    helmet.castShadow = true; head.add(helmet); helmet.position.y = 0.02;
    const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), goggleMat);
    goggles.position.set(0, 0.03, -0.1); head.add(goggles);
    this.root.traverse((o) => { o.frustumCulled = false; });
  }

  setJacket(c: THREE.ColorRepresentation) { this.jacketMat.color = new THREE.Color(c); }

  private place(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number) {
    const d = b.clone().sub(a);
    const len = d.length();
    if (m.userData.lathe) {
      // lathe meshes are unit height from their base: position at a, stretch to b
      m.position.copy(a);
      m.quaternion.setFromUnitVectors(UP, d.normalize());
      m.scale.set(1, len, 1);
      return;
    }
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, d.normalize());
    // capsule geometry has length 1 + 2r: scale the cylinder part only approximately
    m.scale.set(1, Math.max(0.01, (len) / (1 + 2 * radius)), 1);
  }

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
    this.plant = Math.max(0, this.plant - 0.035);
    // ---- stance parameters ----
    const flex = 0.12 + 0.06 * Math.min(1, p.speed / 15) + 0.35 * p.tuck + 0.08 * p.plow;
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
      const sp = V(0, 0.45, 0.25), sc = V(0, 0.98, 0.33);
      pelvis = pelvis.lerp(sp, sit); chest = chest.lerp(sc, sit);
      ankleL.lerp(V(-0.14, -0.05, -0.2), sit); ankleR.lerp(V(0.14, -0.05, -0.2), sit);
      pelvisH = pelvis.y;
    }
    const neck = chest.clone().add(V(0, 0.12, -0.03));
    const head = neck.clone().add(V(0, 0.14, -0.02 - 0.06 * p.tuck));

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

    // ---- place meshes ----
    this.place(this.parts.pelvis, hipL.clone().add(V(0, 0.04, 0)), hipR.clone().add(V(0, 0.04, 0)), 0.14);
    this.parts.pelvis.position.y += 0.02;
    this.place(this.parts.torso, pelvis.clone().add(V(0, -0.02, 0)), neck.clone().add(V(0, 0.0, 0)), 0.16);
    this.place(this.parts.shoulders, shL, shR, 0.1);
    this.parts.collar.position.copy(neck).add(V(0, -0.02, 0));
    this.parts.collar.rotation.x = -lean * 0.5;
    this.parts.head.position.copy(head);
    this.parts.head.rotation.set(-0.15 + 0.5 * p.tuck, 0, -incline * 0.3);
    this.place(this.parts.thighL, hipL, kneeL, 0.075);
    this.place(this.parts.thighR, hipR, kneeR, 0.075);
    this.place(this.parts.shinL, kneeL, ankleL, 0.065);
    this.place(this.parts.shinR, kneeR, ankleR, 0.065);
    this.place(this.parts.upperL, shL, elL, 0.055);
    this.place(this.parts.upperR, shR, elR, 0.055);
    this.place(this.parts.foreL, elL, handL, 0.05);
    this.place(this.parts.foreR, elR, handR, 0.05);
    this.parts.handL.position.copy(handL);
    this.parts.handR.position.copy(handR);
    this.parts.bootL.position.copy(ankleL).add(V(0, -0.02, -0.03));
    this.parts.bootR.position.copy(ankleR).add(V(0, -0.02, -0.03));

    // skis: edged with inclination, toes in for the wedge
    const toe = 0.32 * wedge;
    const edgeTilt = -incline * 0.9;
    const sk = this.skis;
    sk[0].position.set(ankleL.x, ankleL.y - 0.13, ankleL.z - 0.05);
    sk[1].position.set(ankleR.x, ankleR.y - 0.13, ankleR.z - 0.05);
    sk[0].rotation.set(0, -toe, edgeTilt + wedge * 0.18, 'YXZ');
    sk[1].rotation.set(0, toe, edgeTilt - wedge * 0.18, 'YXZ');
    this.parts.bootL.rotation.copy(sk[0].rotation);
    this.parts.bootR.rotation.copy(sk[1].rotation);
    if (sit > 0) { for (const s of sk) s.rotation.x = 0.35 * sit; }

    // poles from hands angled back
    const placePole = (pole: THREE.Mesh, hand: THREE.Vector3, side: number) => {
      const tipPos = hand.clone().add(V(side * 0.12, -1.05, 0.55 + 0.3 * p.tuck));
      if (this.plant > 0 && side === this.plantSide) {
        // swing the tip forward and down beside the ski tip, then let it trail
        const k = Math.sin(this.plant * Math.PI);
        tipPos.lerp(hand.clone().add(V(side * 0.25, -1.0, -0.45)), k);
      }
      if (p.tuck > 0.3) tipPos.lerp(hand.clone().add(V(side * 0.1, -0.35, 1.0)), p.tuck);
      if (p.pushing) tipPos.z += push * side * 0.25;
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
