// Ambient skiers using the same physics and bot logic as the test harness. They come from the lifts:
// whenever a chair carrying riders reaches the unload line, its riders ski off the ramp and down a run
// that starts near that lift's top, chosen to suit their ability. At the bottom they head back into the
// lift lines (handled by baseLife.ts). A few more start mid-run near the player so slopes are never empty.
import * as THREE from 'three/webgpu';
import { createSkier, stepSkier, SkierState, TerrainProbe, headingFromDir } from '../../../shared/skiPhysics';
import { SkiBot, PERSONAS, Persona } from '../../../shared/skiBot';
import { SkierModel } from '../skier/skierModel';
import { orientSkier } from '../skier/orientation';
import type { RunInfo } from '../game';
import type { LiftSystem } from '../lifts/liftSystem';

const COLORS = ['#1f6fd1', '#f2b705', '#2e9e44', '#7b3fbf', '#ff6f91', '#111111', '#1aa3a3', '#e86a1a', '#f5f5f5', '#8b1e3f', '#1d2a44', '#6d1f2f', '#4b5a2a', '#5f8fc4'];
const SKINS = [[1, 1, 1], [0.96, 0.86, 0.77], [0.84, 0.68, 0.56], [0.64, 0.49, 0.39], [0.47, 0.35, 0.28]];

interface Agent { st: SkierState; bot: SkiBot; model: SkierModel; time: number; run: string; fromLift: boolean }

export class AmbientSkiers {
  readonly group = new THREE.Group();
  private agents: Agent[] = [];
  private spare: SkierModel[] = [];
  private runs: RunInfo[];
  private lastLiftT: number | null = null;

  constructor(runs: RunInfo[], private probe: TerrainProbe, private count = 8, private lifts: LiftSystem | null = null) {
    this.group.name = 'ambient-skiers';
    this.runs = runs.filter((r) => r.kind === 'line' && ['green', 'blue', 'black'].includes(r.difficulty) && r.points.length > 3);
  }

  /** Read-only contacts for spatial pass-by sound; uses the same state as the visible skiers. */
  soundSources() {
    return this.agents.map(a => ({ pos: a.st.pos, speed: a.st.speed, skid: a.st.skid,
      groomed: this.probe.surface(a.st.pos.x, a.st.pos.z).groomed,
      active: a.st.grounded && a.st.mode !== 'riding' && a.st.mode !== 'air' }));
  }

  private model() {
    const m = this.spare.pop();
    if (m) { m.root.visible = true; return m; }
    const sk = SKINS[Math.floor(Math.random() * SKINS.length)];
    const model = new SkierModel(new THREE.Color(COLORS[Math.floor(Math.random() * COLORS.length)]), 'crowd', new THREE.Color(sk[0], sk[1], sk[2]));
    this.group.add(model.root);
    return model;
  }

  private release(a: Agent) { a.model.root.visible = false; this.spare.push(a.model); }

  private persona(difficulty: string): Persona {
    const r = Math.random();
    if (difficulty === 'green') return r < 0.6 ? 'beginner' : 'intermediate';
    if (difficulty === 'black') return 'intermediate';
    return r < 0.8 ? 'intermediate' : 'beginner';
  }

  /** Densify a run centerline into bot waypoints with a little personal line choice. */
  private waypoints(points: number[][], from = 0) {
    const path: { x: number; z: number }[] = [];
    const wander = (Math.random() - 0.5) * 8;
    for (let i = from; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 4));
      const L = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1, nx = -(b[2] - a[2]) / L, nz = (b[0] - a[0]) / L;
      for (let k = 0; k < n; k++) {
        const t = k / n, w = wander + Math.sin((i + t) * 0.7) * 2;
        path.push({ x: a[0] + (b[0] - a[0]) * t + nx * w, z: a[2] + (b[2] - a[2]) * t + nz * w });
      }
    }
    return path;
  }

  private agent(path: { x: number; z: number }[], run: RunInfo, fromLift: boolean, heading?: number): Agent | null {
    if (path.length < 4) return null;
    const persona = this.persona(run.difficulty);
    const cfg = { ...PERSONAS[persona], targetSpeed: PERSONAS[persona].targetSpeed * (0.8 + Math.random() * 0.4) };
    const p0 = path[0];
    const st = createSkier({ x: p0.x, y: this.probe.height(p0.x, p0.z), z: p0.z }, heading ?? headingFromDir(path[3].x - p0.x, path[3].z - p0.z));
    return { st, bot: new SkiBot(path, cfg), model: this.model(), time: Math.random() * 10, run: run.name, fromLift };
  }

  /** Riders leaving a chair at the unload line ski off the ramp onto a run that starts near that lift top. */
  private fromLiftTop(li: number, seat: number) {
    const path = this.lifts!.paths[li], up = path.unloadPoint(seat);
    const near = this.runs.filter((r) => Math.hypot(r.points[0][0] - up.x, r.points[0][2] - up.z) < 260);
    if (!near.length) return null;
    const run = near[Math.floor(Math.random() * near.length)];
    // straight off the unload ramp, peel away to the side, then join the run's line
    const fx = -Math.sin(up.heading), fz = -Math.cos(up.heading), side = seat < (path.def.seats - 1) / 2 ? -1 : 1;
    const lead = [{ x: up.x, z: up.z }, { x: up.x + fx * 5, z: up.z + fz * 5 }, { x: up.x + fx * 10 - fz * side * 6, z: up.z + fz * 10 + fx * side * 6 }];
    const pts = this.waypoints(run.points);
    return this.agent([...lead, ...pts], run, true, up.heading);
  }

  private onSlopeNear(near: THREE.Vector3) {
    const cands = this.runs.filter((r) => r.points.some((p) => Math.hypot(p[0] - near.x, p[2] - near.z) < 700));
    const pool = cands.length ? cands : this.runs;
    const run = pool[Math.floor(Math.random() * pool.length)];
    // start a little above the point of the run nearest the player, so they ski past
    let nearest = 0, best = Infinity;
    run.points.forEach((p, i) => { const d = Math.hypot(p[0] - near.x, p[2] - near.z); if (d < best) { best = d; nearest = i; } });
    const from = Math.max(0, Math.min(run.points.length - 4, nearest - 1 - Math.floor(Math.random() * 3)));
    return this.agent(this.waypoints(run.points, from), run, false);
  }

  update(dt: number, player: THREE.Vector3, camera: THREE.Vector3) {
    if (this.lifts) {
      const t = this.lifts.now();
      if (this.lastLiftT !== null) {
        this.lifts.paths.forEach((path, li) => {
          const top = path.unloadPoint();
          if (Math.hypot(top.x - player.x, top.z - player.z) > 1600) return;
          for (const chair of this.lifts!.chairsPassing(li, path.unloadU, this.lastLiftT!, t)) {
            for (const seat of this.lifts!.riderSeats(li, chair)) {
              if (this.agents.length >= this.count) return;
              const a = this.fromLiftTop(li, seat);
              if (a) this.agents.push(a);
            }
          }
        });
      }
      this.lastLiftT = t;
    }
    // half the budget belongs to riders arriving off the lifts; the rest keep the slopes near the player busy
    while (this.agents.filter((a) => !a.fromLift).length < Math.ceil(this.count / 2) && this.agents.length < this.count) {
      const a = this.onSlopeNear(player);
      if (!a) break;
      this.agents.push(a);
    }
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i];
      a.time += dt;
      const inp = a.bot.input(a.st, dt);
      stepSkier(a.st, inp, this.probe, dt);
      if (a.st.mode === 'fallen' && a.st.speed < 0.5 && a.st.modeTime > 2.5) { a.st.mode = 'standing'; }
      const far = Math.hypot(a.st.pos.x - player.x, a.st.pos.z - player.z) > 1700;
      if (a.bot.done || far || a.time > 900) { this.release(a); this.agents.splice(i, 1); continue; }
      const dCam = Math.hypot(a.st.pos.x - camera.x, a.st.pos.z - camera.z);
      a.model.root.visible = dCam < 400;
      if (!a.model.root.visible) continue;
      a.model.root.position.set(a.st.pos.x, a.st.pos.y, a.st.pos.z);
      orientSkier(a.model.root, a.st.heading, a.st.normal);
      a.model.update({ speed: a.st.speed, edge: a.st.edge, plow: a.st.plow, tuck: a.st.tuck, skid: a.st.skid, fallen: a.st.mode === 'fallen' ? 1 : 0, sitting: 0, time: a.time, pushing: inp.push && a.st.speed < 3 });
    }
  }
}
