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
import { buildChairModel, chairMaterials, numberedChairPlates, BAR_PIVOT, type ChairMotion } from './chairModel';
import { buildHut, buildTerminal, buildTower, liftStyle } from './liftStructures';


const rope = new THREE.MeshStandardNodeMaterial({ color: 0x2b2b2b, roughness: 0.6, metalness: 0.5 });

const riderMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
riderMat.colorNode = attribute('color', 'vec3').mul(mix(vec3(1), attribute('riderColor', 'vec3'), attribute('jacket', 'float')));

export class LiftSystem {
  readonly group = new THREE.Group();
  readonly paths: LiftPath[] = [];
  readonly colliders: Collider[] = [];
  private chairMeshes: { near: { mesh: THREE.InstancedMesh; motion: ChairMotion }[]; far: { mesh: THREE.InstancedMesh; motion: ChairMotion }[]; labels: THREE.InstancedMesh }[] = [];
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
      const materials = chairMaterials(def.name);
      const makeInstances = (detailed: boolean) => buildChairModel(def.name, def.seats, detailed).map(part => {
        const mesh = new THREE.InstancedMesh(part.geometry, materials[part.finish], path.chairCount);
        mesh.name = `${part.name}-${detailed ? 'near' : 'far'}`;
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
        this.group.add(mesh);
        return { mesh, motion: part.motion };
      });
      const labels = numberedChairPlates(def.name, path.chairCount); this.group.add(labels);
      this.chairMeshes.push({ near: makeInstances(true), far: makeInstances(false), labels });
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
      if (kind === 'floor') o.position.y = gmax + 0.12;
      else if (kind === 'hut') o.position.y = gmax + 1.3;
      else if (kind === 'footing') o.position.y = gmax - 1.6;
      else o.position.y = gmax + 3.2;
    });
  }

  private buildStatic(path: LiftPath) {
    const def = path.def;
    const g = new THREE.Group();
    g.name = def.name;
    const yaw = Math.atan2(-path.ax, -path.az); // heading facing uphill
    // towers and terminals: per-lift reconstructions from photo surveys (liftStructures.ts)
    const style = liftStyle(def.name);
    let towerIndex = 0;
    const place = (obj: THREE.Object3D, x: number, y: number, z: number, dx: number, dz: number, local: { x: number; z: number; r: number }[], top: number) => {
      const th = Math.atan2(dx, dz), c = Math.cos(th), sn = Math.sin(th);
      obj.position.set(x, y, z); obj.rotation.y = th; g.add(obj);
      for (const l of local) this.colliders.push({ type: 'cyl', x: x + l.x * c + l.z * sn, z: z - l.x * sn + l.z * c, r: l.r, top });
    };
    for (const s of def.supports) {
      const p = path.ropePoint(s.s, 0);
      if (s.kind === 'tower') {
        const t = buildTower(style, s.cable - s.ground, towerIndex++, 1.5);
        place(t.object, p.x, s.ground, p.z, path.ax, path.az, t.colliders, s.cable);
      } else {
        const top = s.kind === 'top';
        const t = buildTerminal(style, top, s.cable - s.ground, 2.5);
        t.object.name = `${def.name}-${top ? 'top' : 'bottom'}-${t.kind}-terminal`;
        place(t.object, p.x, s.ground, p.z, top ? -path.ax : path.ax, top ? -path.az : path.az, t.colliders, s.cable + 2);
        // operator hut beside the terminal (left side, away from the loading side), door facing the line
        const hutX = p.x - path.rx * (GAUGE / 2 + 4.5) + path.ax * (top ? -3 : 3);
        const hutZ = p.z - path.rz * (GAUGE / 2 + 4.5) + path.az * (top ? -3 : 3);
        const hut = buildHut(style, top);
        hut.object.position.set(hutX, s.ground, hutZ);
        hut.object.rotation.y = Math.atan2(path.rx, path.rz);
        hut.object.userData.settle = 'floor';
        g.add(hut.object);
        const e = Math.max(hut.hx, hut.hz);
        this.colliders.push({ type: 'box', x: hutX, z: hutZ, hx: e, hz: e, yaw, top: s.ground + hut.height });
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

  update(occupied: { lift: number; chair: number }[] = [], viewer?: THREE.Vector3) {
    const t = this.now();
    for (let li = 0; li < this.paths.length; li++) {
      const path = this.paths[li];
      const models = this.chairMeshes[li];
      const bar = new THREE.Matrix4(), grip = new THREE.Matrix4(), local = new THREE.Matrix4();
      let nearCount = 0, farCount = 0;
      const labelUV = models.labels.geometry.getAttribute('labelUV') as THREE.InstancedBufferAttribute;
      const cols = models.labels.userData.atlasColumns, rows = models.labels.userData.atlasRows;
      for (let i = 0; i < path.chairCount; i++) {
        const u = path.chairU(i, t), lp = path.loopPoint(u);
        const bank = path.chairBank(u);
        this.e.set(0, lp.heading, bank, 'YXZ'); this.q.setFromEuler(this.e);
        this.m4.compose(new THREE.Vector3(lp.p.x, lp.p.y, lp.p.z), this.q, new THREE.Vector3(1, 1, 1));
        bar.copy(this.m4).multiply(local.makeTranslation(BAR_PIVOT.x, BAR_PIVOT.y, BAR_PIVOT.z));
        bar.multiply(local.makeRotationX(path.restraintAngle(lp.h, lp.uphill)));
        const next = path.loopPoint(u + .1).p;
        const pitch = Math.atan2(next.y - lp.p.y, Math.hypot(next.x - lp.p.x, next.z - lp.p.z));
        grip.copy(this.m4).multiply(local.makeRotationZ(-bank)).multiply(local.makeRotationX(pitch));
        const near = !viewer || Math.hypot(viewer.x - lp.p.x, viewer.y - lp.p.y, viewer.z - lp.p.z) < 90 || occupied.some(o => o.lift === li && o.chair === i);
        const instance = near ? nearCount++ : farCount++;
        for (const part of near ? models.near : models.far) {
          part.mesh.setMatrixAt(instance, part.motion === 'restraint' ? bar : part.motion === 'grip' ? grip : this.m4);
        }
        if (near) {
          models.labels.setMatrixAt(instance, this.m4);
          labelUV.setXY(instance, (i % cols) / cols, (rows - 1 - Math.floor(i / cols)) / rows);
        }
      }
      for (const part of models.near) { part.mesh.count = nearCount; part.mesh.instanceMatrix.needsUpdate = true; }
      for (const part of models.far) { part.mesh.count = farCount; part.mesh.instanceMatrix.needsUpdate = true; }
      models.labels.count = nearCount; labelUV.needsUpdate = true;
      models.labels.instanceMatrix.needsUpdate = true;
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
