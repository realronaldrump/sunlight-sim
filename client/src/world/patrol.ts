// Ski patrol at closing: three patrollers in red jackets with white crosses sweep the mountain after
// last chair (Ute from the top of Primo, Sun King and Midway, and Segundo from the top of Segundo),
// calling the last run. Once the sweep has passed, closure ropes go up across the run entrances.
import * as THREE from 'three/webgpu';
import { SkierModel } from '../skier/skierModel';
import { orientSkier } from '../skier/orientation';
import type { RunInfo } from '../game';
import type { TerrainProbe, Vec3 } from '../../../shared/skiPhysics';
import { Route } from './lesson';
import { dressBib } from './bib';
import { HOURS, runsClosed, sweeping, type ClockMode } from './resortDay';

const SWEEP_SPEED = 9.5;   // m/s, an easy patrol pace on groomers
const LOOP = 480;          // s: in Free Explore the sweep repeats while the clock is set to closing time

interface Patroller { model: SkierModel; route: Route; time: number; x: number; z: number; heading: number; speed: number; visible: boolean; name: string }

export const PATROL_CALL = 'Ski patrol sweep! Last run, please head down to the base.';

export class Patrol {
  readonly group = new THREE.Group();
  readonly members: Patroller[] = [];
  private ropes = new Map<string, THREE.Group>();
  private ropeMat = new THREE.MeshStandardNodeMaterial({ color: 0xf4a300, roughness: 0.7 });
  private postMat = new THREE.MeshStandardNodeMaterial({ color: 0x2a2a2a, roughness: 0.6 });
  private signMat: THREE.MeshStandardNodeMaterial;
  private normal: Vec3 = { x: 0, y: 1, z: 0 };
  private ropeTimer = 0;

  constructor(runs: RunInfo[], private probe: TerrainProbe, private tops: Map<string, { run: RunInfo; x: number; y: number; z: number; dx: number; dz: number }>,
    lifts: { name: string; top: number[] }[]) {
    this.group.name = 'ski-patrol';
    const line = (name: string) => runs.filter((r) => r.name === name && r.kind === 'line').sort((a, b) => b.points.length - a.points.length)[0];
    const P = (p: number[]) => ({ x: p[0], z: p[2] });
    const plans: { name: string; pts: { x: number; z: number }[] }[] = [];
    const ute = line('Ute'); if (ute) plans.push({ name: 'Ute', pts: ute.points.map(P) });
    const sk = line('Sun King'), mid = line('Midway');
    if (sk && mid) plans.push({ name: 'Sun King and Midway', pts: [...sk.points.map(P), ...mid.points.map(P)] });
    const seg = line('Segundo'), segTop = lifts.find((l) => l.name === 'Segundo');
    if (seg) plans.push({ name: 'Segundo', pts: [...(segTop ? [{ x: segTop.top[0] - 6, z: segTop.top[2] - 12 }] : []), ...seg.points.map(P)] });
    plans.forEach((plan, i) => {
      const model = new SkierModel(new THREE.Color(0xc4161c), 'crowd', new THREE.Color(...([[0.96, 0.86, 0.77], [0.84, 0.68, 0.56], [1, 1, 1]][i] as [number, number, number])));
      model.dress({ jacket: 0xc4161c, skin: [[0.96, 0.86, 0.77], [0.84, 0.68, 0.56], [1, 1, 1]][i], hatColor: 0x1a1a1c });
      dressBib(model.human, new THREE.Color(0xc4161c), new THREE.Color(1, 1, 1), { color: '#c4161c', ink: '#ffffff', cut: 'uniform', frontTitle: 'PATROL', backName: 'SKI PATROL', cross: true });
      model.root.name = `ski-patroller-${i}`;
      model.root.visible = false;
      this.group.add(model.root);
      this.members.push({ model, route: new Route(plan.pts, 3), time: i * 2.3, x: 0, z: 0, heading: 0, speed: 0, visible: false, name: plan.name });
    });
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#f2b500'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#111'; g.lineWidth = 8; g.strokeRect(4, 4, 248, 120);
    g.fillStyle = '#111'; g.font = 'bold 64px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('CLOSED', 128, 68);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    this.signMat = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide });
  }

  /** Sweep progress 0..1, or null when nobody is sweeping. */
  private progress(mode: ClockMode, hour: number, now: number) {
    if (!sweeping(hour)) return null;
    if (mode === 'day') return Math.min(1, Math.max(0, (hour - (HOURS.lastChair - 0.05)) / (HOURS.sweepEnd + 0.05 - HOURS.lastChair)));
    return ((now % LOOP) + LOOP) % LOOP / LOOP;
  }

  update(dt: number, now: number, mode: ClockMode, hour: number, camera: THREE.Vector3) {
    const p = this.progress(mode, hour, now);
    for (const m of this.members) {
      m.time += dt;
      if (p === null) { m.model.root.visible = m.visible = false; continue; }
      // a steady sweep down the route, finishing together; in Free Explore each takes its own time
      const dist = mode === 'day' ? p * m.route.length : Math.min(m.route.length, p * LOOP * SWEEP_SPEED);
      if (dist >= m.route.length - 1) { m.model.root.visible = m.visible = false; continue; }
      const lateral = (s: number) => 2.6 * Math.sin(s * (2 * Math.PI / 26));
      const a = m.route.at(dist), b = m.route.at(dist + 1);
      const la = lateral(dist), lb = lateral(dist + 1);
      m.x = a.x - a.tz * la; m.z = a.z + a.tx * la;
      const bx = b.x - b.tz * lb, bz = b.z + b.tx * lb;
      m.heading = Math.atan2(-(bx - m.x), -(bz - m.z));
      m.speed = mode === 'day' ? m.route.length / ((HOURS.sweepEnd + 0.05 - HOURS.lastChair) * 360) : SWEEP_SPEED;
      m.visible = true;
      const d = Math.hypot(m.x - camera.x, m.z - camera.z);
      m.model.root.visible = d < 500;
      if (!m.model.root.visible) continue;
      m.model.root.position.set(m.x, this.probe.height(m.x, m.z), m.z);
      orientSkier(m.model.root, m.heading, this.probe.normal(m.x, m.z, this.normal));
      const curv = -2.6 * (2 * Math.PI / 26) ** 2 * Math.sin(dist * (2 * Math.PI / 26));
      m.model.update({ speed: m.speed, edge: THREE.MathUtils.clamp(Math.atan(m.speed * m.speed * curv / 9.81), -0.7, 0.7), plow: 0, tuck: 0, skid: 0.1, fallen: 0, sitting: 0, time: m.time, pushing: false });
    }
    if ((this.ropeTimer -= dt) <= 0) { this.ropeTimer = 1; this.updateRopes(runsClosed(hour), camera); }
  }

  /** A patroller within earshot of (x, z), if any. */
  nearby(x: number, z: number, radius = 40) {
    return this.members.find((m) => m.visible && Math.hypot(m.x - x, m.z - z) < radius) ?? null;
  }

  /** Closure ropes across run entrances near you, after the sweep and before opening. */
  private updateRopes(closed: boolean, camera: THREE.Vector3) {
    for (const [name, top] of this.tops) {
      if (top.run.difficulty === 'hike') continue;
      const near = Math.hypot(top.x - camera.x, top.z - camera.z) < 650;
      let rope = this.ropes.get(name);
      if (closed && near && !rope) { rope = this.buildRope(top); this.ropes.set(name, rope); this.group.add(rope); }
      if (rope) rope.visible = closed && near;
    }
  }

  private buildRope(top: { x: number; z: number; dx: number; dz: number }) {
    const g = new THREE.Group(); g.name = 'closure-rope';
    const L = Math.hypot(top.dx, top.dz) || 1, fx = top.dx / L, fz = top.dz / L, rx = -fz, rz = fx;
    // a few meters into the run, across its entrance
    const cx = top.x + fx * 3, cz = top.z + fz * 3, half = 7;
    const pts: THREE.Vector3[] = [];
    for (const s of [-1, 1]) {
      const x = cx + rx * half * s, z = cz + rz * half * s, y = this.probe.height(x, z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.3, 8), this.postMat);
      post.position.set(x, y + 0.6, z); post.castShadow = true; g.add(post);
      pts.push(new THREE.Vector3(x, y + 1.1, z));
    }
    const mid = pts[0].clone().add(pts[1]).multiplyScalar(0.5); mid.y = Math.max(mid.y, this.probe.height(mid.x, mid.z) + 0.8) - 0.12;
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(pts[0], mid, pts[1]), 16, 0.012, 5), this.ropeMat));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.35), this.signMat);
    sign.position.set(mid.x, mid.y - 0.22, mid.z); sign.rotation.y = Math.atan2(fx, fz); sign.castShadow = true;
    g.add(sign);
    return g;
  }
}
