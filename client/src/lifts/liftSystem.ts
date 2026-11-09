// Chairlift rendering (towers, terminals, bull wheels, sagging haul rope, moving chairs) and chair
// transforms for riders. Chair motion comes from shared/lifts.ts on the shared lift clock.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LiftPath, LiftDef, GAUGE, HANGER, LOAD_OFFSET } from '../../../shared/lifts';
import type { Collider } from '../../../shared/collision';
import { LiftStations } from '../../../shared/liftStations';
import type { TerrainProbe } from '../../../shared/skiPhysics';
import { attribute, mix, vec3 } from 'three/tsl';
import { seatedSkierGeometry } from '../skier/seatedGeometry';


const steel = new THREE.MeshStandardNodeMaterial({ color: 0x6f7780, roughness: 0.45, metalness: 0.7 });
const darkSteel = new THREE.MeshStandardNodeMaterial({ color: 0x3a3f45, roughness: 0.5, metalness: 0.6 });
const rope = new THREE.MeshStandardNodeMaterial({ color: 0x2b2b2b, roughness: 0.6, metalness: 0.5 });
const wood = new THREE.MeshStandardNodeMaterial({ color: 0x7a5a3a, roughness: 0.9 });
const roofMat = new THREE.MeshStandardNodeMaterial({ color: 0x4a2f22, roughness: 0.8 });
const chairMat = new THREE.MeshStandardNodeMaterial({ color: 0x2f3338, roughness: 0.55, metalness: 0.4 });
const seatMat = new THREE.MeshStandardNodeMaterial({ color: 0x1e4f8a, roughness: 0.7 });
const terminalPaint = new THREE.MeshStandardNodeMaterial({ color: 0x24527a, roughness: 0.5, metalness: 0.3 });
const concrete = new THREE.MeshStandardNodeMaterial({ color: 0x77736c, roughness: 0.95 });
let hutMats: THREE.Material[] | null = null;
/** Operator hut walls: wood siding with a window on every side and a door on one. */
function hutMaterials() {
  if (hutMats) return hutMats;
  const make = (door: boolean) => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#7a5536'; g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 10) { g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(x, 0, 2, 256); }
    g.fillStyle = '#efe9dc'; g.fillRect(door ? 128 : 60, 60, 100, 80);
    g.fillStyle = '#26323d'; g.fillRect(door ? 134 : 66, 66, 88, 68);
    if (door) { g.fillStyle = '#3b2a1e'; g.fillRect(28, 70, 70, 186); g.fillStyle = '#c9a54a'; g.fillRect(84, 160, 8, 8); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const side = new THREE.MeshStandardNodeMaterial({ map: make(false), roughness: 0.85 });
  const front = new THREE.MeshStandardNodeMaterial({ map: make(true), roughness: 0.85 });
  hutMats = [side, side, wood, wood, front, side];
  return hutMats;
}

const riderMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
riderMat.colorNode = attribute('color', 'vec3').mul(mix(vec3(1), attribute('riderColor', 'vec3'), attribute('jacket', 'float')));

function chairGeometry(seats: number) {
  const w = seats * 0.6 + 0.1;
  const parts: THREE.BufferGeometry[] = [];
  // The hanger bends behind the backrest; a straight central rod would pass through
  // the middle passenger's torso on a triple chair.
  const hanger = new THREE.BoxGeometry(0.07, HANGER - 0.6, 0.07); hanger.translate(0, -(HANGER - 0.6) / 2, 0.5); parts.push(hanger);
  const grip = new THREE.BoxGeometry(0.07, 0.07, 0.5); grip.translate(0, -0.035, 0.25); parts.push(grip);
  const frame = new THREE.BoxGeometry(w, 0.06, 0.06); frame.translate(0, -HANGER + 0.55, 0.38); parts.push(frame);
  const back = new THREE.BoxGeometry(w, 0.5, 0.06); back.translate(0, -HANGER + 0.3, 0.38); parts.push(back);
  const sideL = new THREE.BoxGeometry(0.05, 0.6, 0.55); sideL.translate(-w / 2, -HANGER + 0.15, 0.12); parts.push(sideL);
  const sideR = sideL.clone(); sideR.translate(w, 0, 0); parts.push(sideR);
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  const seat = new THREE.BoxGeometry(w, 0.07, 0.48); seat.translate(0, -HANGER, 0.12);
  // Pivot relative to (-HANGER + 0.65, z=0.35); lift the entire bar and footrest
  // above the skier at stations, lower them in transit. Dimensions are estimates.
  const restraint: THREE.BufferGeometry[] = [];
  const bar = new THREE.BoxGeometry(w, 0.045, 0.045); bar.translate(0, -0.22, -0.85); restraint.push(bar);
  for (const side of [-1, 1]) {
    const arm = new THREE.BoxGeometry(0.04, 0.04, 0.88); arm.rotateX(-0.25); arm.translate(side * w / 2, -0.11, -0.425); restraint.push(arm);
    const stem = new THREE.BoxGeometry(0.035, 0.83, 0.035); stem.translate(side * w * 0.28, -0.635, -0.85); restraint.push(stem);
  }
  const foot = new THREE.BoxGeometry(w * 0.8, 0.04, 0.13); foot.translate(0, -1.05, -0.85); restraint.push(foot);
  return { frame: g, seat, restraint: mergeGeometries(restraint.map(p => p.toNonIndexed()))! };
}

export class LiftSystem {
  readonly group = new THREE.Group();
  readonly paths: LiftPath[] = [];
  readonly colliders: Collider[] = [];
  private chairMeshes: { frame: THREE.InstancedMesh; seat: THREE.InstancedMesh; restraint: THREE.InstancedMesh }[] = [];
  /** Ambient riders: per lift, list of (chair, seat) occupied by other (non-player) skiers. */
  private riders: { mesh: THREE.InstancedMesh; slots: { chair: number; seat: number }[] }[] = [];
  clockOffset = 0; // seconds added to Date.now()/1000 to get the shared lift clock
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  constructor(defs: LiftDef[]) {
    this.group.name = 'lifts';
    for (const def of defs) {
      const path = new LiftPath(def);
      this.paths.push(path);
      this.buildStatic(path);
      const { frame, seat, restraint } = chairGeometry(def.seats);
      const fm = new THREE.InstancedMesh(frame, chairMat, path.chairCount);
      const sm = new THREE.InstancedMesh(seat, seatMat, path.chairCount);
      const bm = new THREE.InstancedMesh(restraint, chairMat, path.chairCount);
      for (const m of [fm, sm, bm]) { m.castShadow = true; m.frustumCulled = false; this.group.add(m); }
      this.chairMeshes.push({ frame: fm, seat: sm, restraint: bm });
      // about a third of the chairs carry 1-3 riders (deterministic per lift)
      let seed = def.name.length * 7919;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const slots: { chair: number; seat: number }[] = [];
      for (let c = 0; c < path.chairCount; c++) {
        if (rnd() > 0.34) continue;
        const n = 1 + Math.floor(rnd() * Math.min(3, def.seats));
        const start = Math.floor(rnd() * (def.seats - n + 1));
        for (let k = 0; k < n; k++) slots.push({ chair: c, seat: start + k });
      }
      const rm = new THREE.InstancedMesh(seatedSkierGeometry(), riderMat, slots.length);
      const col = new THREE.Color();
      const palette = [0xd33a2c, 0x1f6fd1, 0xf2b705, 0x2e9e44, 0x7b3fbf, 0xff6f91, 0x222222, 0x1aa3a3, 0xe86a1a, 0x5b6b7a];
      const riderColors = new Float32Array(slots.length * 3);
      for (let i = 0; i < slots.length; i++) col.setHex(palette[Math.floor(rnd() * palette.length)]).toArray(riderColors, i * 3);
      rm.geometry.setAttribute('riderColor', new THREE.InstancedBufferAttribute(riderColors, 3));
      rm.castShadow = true; rm.frustumCulled = false;
      this.group.add(rm);
      this.riders.push({ mesh: rm, slots });
    }
  }

  now() { return Date.now() / 1000 + this.clockOffset; }

  buildStationSurfaces(terrain: TerrainProbe) {
    const stations = new LiftStations(this.paths, terrain);
    const mat = new THREE.MeshStandardNodeMaterial({ color: 0xe8f0f4, roughness: 0.95 });
    const group = new THREE.Group(); group.name = 'station-snow';
    for (const ramp of stations.ramps) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(ramp.positions, 3));
      geometry.setIndex(ramp.indices); geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, mat); mesh.receiveShadow = true;
      mesh.name = `${ramp.path.def.name}-${ramp.top ? 'unload' : 'load'}-snow-ramp`;
      group.add(mesh);
    }
    this.group.add(group);
    this.group.traverse(o => {
      if (o.userData.loadStripe) o.position.y = stations.height(o.position.x, o.position.z) + 0.025;
    });
    return stations;
  }

  /** Re-seat ground-standing props once fine terrain is loaded (huts sit on the uphill corner of their footprint). */
  settle(height: (x: number, z: number) => number) {
    this.group.traverse((o) => {
      const kind = o.userData.settle;
      if (!kind) return;
      let gmax = -Infinity;
      for (const [dx, dz] of [[-1.6, -1.8], [1.6, -1.8], [-1.6, 1.8], [1.6, 1.8], [0, 0]]) gmax = Math.max(gmax, height(o.position.x + dx, o.position.z + dz));
      if (kind === 'hut') o.position.y = gmax + 1.3;
      else if (kind === 'footing') o.position.y = gmax - 1.6;
      else o.position.y = gmax + 3.2;
    });
  }

  private buildStatic(path: LiftPath) {
    const def = path.def;
    const g = new THREE.Group();
    g.name = def.name;
    const yaw = Math.atan2(-path.ax, -path.az); // heading facing uphill
    // towers
    for (const s of def.supports) {
      const p = path.ropePoint(s.s, 0);
      if (s.kind === 'tower') {
        const h = s.cable - s.ground + 0.4;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, h, 10), steel);
        pole.position.set(p.x, s.ground + h / 2 - 0.3, p.z);
        pole.castShadow = true;
        g.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(GAUGE + 1.4, 0.35, 0.35), steel);
        arm.position.set(p.x, s.cable + 0.55, p.z); arm.rotation.y = yaw; arm.castShadow = true;
        g.add(arm);
        for (const side of [-1, 1]) {
          const sheave = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.35, 2.4), darkSteel);
          sheave.position.set(p.x + path.rx * side * GAUGE / 2, s.cable + 0.2, p.z + path.rz * side * GAUGE / 2);
          sheave.rotation.y = yaw; sheave.castShadow = true; g.add(sheave);
        }
        // service ladder hint
        const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.3, h * 0.9, 0.05), darkSteel);
        ladder.position.set(p.x - path.ax * 0.42, s.ground + h * 0.45, p.z - path.az * 0.42); ladder.rotation.y = yaw; g.add(ladder);
        this.colliders.push({ type: 'cyl', x: p.x, z: p.z, r: 0.45, top: s.cable });
      } else {
        // terminal: bull wheel on a frame + operator hut + ramp
        const top = s.kind === 'top';
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(GAUGE / 2, 0.12, 8, 40), darkSteel);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(p.x, s.cable, p.z);
        g.add(wheel);
        // bull wheel cover (a flat rounded hood) and, at the top drive terminal, the gearbox/motor house
        const hood = new THREE.Mesh(new THREE.CylinderGeometry(GAUGE / 2 + 0.5, GAUGE / 2 + 0.8, 0.7, 28), terminalPaint);
        hood.position.set(p.x, s.cable + 0.75, p.z); hood.castShadow = true; g.add(hood);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.0, 12), darkSteel);
        hub.position.set(p.x, s.cable + 0.2, p.z); g.add(hub);
        if (top) {
          const drive = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.6, 2.6), terminalPaint);
          drive.position.set(p.x + path.ax * 1.8, s.cable + 1.6, p.z + path.az * 1.8); drive.rotation.y = yaw; drive.castShadow = true; g.add(drive);
        }
        // boom from the column frame to the wheel
        const boom = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 3.4), steel);
        boom.position.set(p.x + path.ax * (top ? 1.2 : -1.2), s.cable + 0.25, p.z + path.az * (top ? 1.2 : -1.2)); boom.rotation.y = yaw; g.add(boom);
        for (const side of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, s.cable - s.ground + 0.2, 0.4), steel);
          const off = top ? 2.4 : -2.4;
          leg.position.set(p.x + path.ax * off + path.rx * side * 0.9, (s.cable + s.ground) / 2, p.z + path.az * off + path.rz * side * 0.9);
          leg.castShadow = true; g.add(leg);
          this.colliders.push({ type: 'cyl', x: leg.position.x, z: leg.position.z, r: 0.35, top: s.cable });
        }
        // operator hut beside the terminal (left side, away from the loading side)
        const hutX = p.x - path.rx * (GAUGE / 2 + 4.5) + path.ax * (top ? -3 : 3);
        const hutZ = p.z - path.rz * (GAUGE / 2 + 4.5) + path.az * (top ? -3 : 3);
        const hut = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 3.6), hutMaterials());
        hut.position.set(hutX, s.ground + 1.3, hutZ);
        hut.userData.settle = 'hut';
        const footing = new THREE.Mesh(new THREE.BoxGeometry(3.3, 3.2, 3.7), concrete);
        footing.position.set(hutX, s.ground - 1.6, hutZ); footing.rotation.y = yaw; footing.userData.settle = 'footing';
        g.add(footing); hut.rotation.y = yaw; hut.castShadow = true; hut.receiveShadow = true;
        g.add(hut);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(2.9, 1.2, 4), roofMat);
        roof.position.set(hutX, s.ground + 3.2, hutZ); roof.rotation.y = yaw + Math.PI / 4; roof.castShadow = true; g.add(roof);
        roof.userData.settle = 'roof';
        this.colliders.push({ type: 'box', x: hutX, z: hutZ, hx: 1.7, hz: 1.9, yaw, top: s.ground + 3 });
      }
    }
    // haul rope: two lines + bull wheel arcs, as thin tubes
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      const n = Math.ceil(path.horiz / 3);
      for (let i = 0; i <= n; i++) {
        const p = path.ropePoint((path.horiz * i) / n, side);
        pts.push(new THREE.Vector3(p.x, p.y, p.z));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, n, 0.03, 4, false), rope);
      g.add(tube);
    }
    // load line marker (painted stripe on the snow)
    const lp = path.ropePoint(LOAD_OFFSET, 1);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.02, 0.18), new THREE.MeshStandardNodeMaterial({ color: 0xd42020, roughness: 0.6 }));
    stripe.position.set(lp.x, def.supports[0].ground + 0.03, lp.z); stripe.rotation.y = yaw;
    stripe.userData.loadStripe = true;
    g.add(stripe);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).receiveShadow = true; });
    this.group.add(g);
  }

  /** Seat transform of a chair at time t. Returns position of the seat surface center for seatIndex. */
  seatTransform(lift: number, chair: number, seat: number, t: number, outPos: THREE.Vector3) {
    const path = this.paths[lift];
    const lp = path.seatPoint(chair, seat, t);
    outPos.set(lp.p.x, lp.p.y, lp.p.z);
    return { heading: lp.heading, uphill: lp.uphill, h: lp.h };
  }

  update(occupied: { lift: number; chair: number }[] = []) {
    const t = this.now();
    for (let li = 0; li < this.paths.length; li++) {
      const path = this.paths[li];
      const { frame, seat, restraint } = this.chairMeshes[li];
      for (let i = 0; i < path.chairCount; i++) {
        const lp = path.loopPoint(path.chairU(i, t));
        // Fixed-grip carriers follow the haul rope through the terminals at line speed.
        this.e.set(0, lp.heading, 0, 'YXZ');
        this.q.setFromEuler(this.e);
        this.m4.compose(new THREE.Vector3(lp.p.x, lp.p.y, lp.p.z), this.q, new THREE.Vector3(1, 1, 1));
        frame.setMatrixAt(i, this.m4);
        seat.setMatrixAt(i, this.m4);
        this.m4.multiply(new THREE.Matrix4().makeTranslation(0, -HANGER + 0.65, 0.35));
        this.m4.multiply(new THREE.Matrix4().makeRotationX(path.restraintAngle(lp.h, lp.uphill)));
        restraint.setMatrixAt(i, this.m4);
      }
      frame.instanceMatrix.needsUpdate = true;
      seat.instanceMatrix.needsUpdate = true;
      restraint.instanceMatrix.needsUpdate = true;
      // ambient riders sit on their chairs on the way up; hidden on the way down
      const R = this.riders[li];
      if (R) {
        const p = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
        R.slots.forEach((sl, k) => {
          const info = this.seatTransform(li, sl.chair, sl.seat, t, p);
          if (!info.uphill || info.h < 12 || info.h > path.horiz - 10 || occupied.some(o => o.lift === li && o.chair === sl.chair)) { R.mesh.setMatrixAt(k, zero); return; }
          this.e.set(0, info.heading, 0, 'YXZ'); this.q.setFromEuler(this.e);
          this.m4.compose(p, this.q, new THREE.Vector3(1, 1, 1));
          R.mesh.setMatrixAt(k, this.m4);
        });
        R.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
